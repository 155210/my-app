package com.example.gproxyisland;

import android.animation.LayoutTransition;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * 前台服务：在屏幕顶部画一颗黑色胶囊（悬浮窗），读 gproxy 用量。
 *
 * 收起时按优先级显示：
 *   刚完成/刚失败的提示（6 秒，绿灯/红灯）＞ 生成中（黄灯闪烁 + 计时）＞ 今日花费。
 * 状态点：绿 = 正常；黄 = 到预算提醒线；红 = 超预算或最近一次失败；灰 = 连不上 gproxy。
 *
 * 刷新：空闲按设置的间隔；有请求在跑或刚跑完的 20 秒内每 2 秒一次。熄屏暂停。
 * 「生成中」读 gproxy 上游日志里 state = in_progress 的行，需要在 gproxy 控制台打开「上游日志」。
 */
public class IslandService extends Service {
    static final String ACTION_STOP = "com.example.gproxyisland.STOP";
    private static final String CH = "island";
    private static final int NID = 1;

    private static final int GREEN = 0xFF5DCAA5, AMBER = 0xFFEF9F27, RED = 0xFFE24B4A, GREY = 0xFF888780;
    private static final long FAST_MS = 2000, ACTIVE_TAIL_MS = 20000, POP_MS = 6000;
    /** 预算提醒线 */
    private static final double WARN_RATIO = 0.8;

    private WindowManager wm;
    private WindowManager.LayoutParams lp;
    private LinearLayout root, detail;
    private TextView head;
    private View dot;
    private GradientDrawable bg, dotBg;
    private ObjectAnimator blink;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private HandlerThread worker;
    private Handler io;
    private GproxyClient client;

    // ── 只在 io 线程用 ──
    private String ioLastId;
    private long ioSummaryAt, ioActiveUntil;

    // ── 只在 ui 线程用 ──
    private boolean expanded;
    private volatile boolean screenOn = true;
    private GproxyClient.Summary summary;
    private List<GproxyClient.Record> records = new ArrayList<>();
    private List<GproxyClient.Flight> flights = new ArrayList<>();
    private GproxyClient.Record popRecord;
    private String error;
    private long updatedAt;

    static boolean running;

    static void start(Context c) {
        Intent i = new Intent(c, IslandService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, IslandService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        goForeground();
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "没有悬浮窗权限，先在 App 里授权", Toast.LENGTH_LONG).show();
            stopSelf();
            return;
        }
        running = true;
        client = new GproxyClient(Cfg.url(this), Cfg.user(this), Cfg.pass(this));
        buildIsland();
        worker = new HandlerThread("gproxy-poll");
        worker.start();
        io = new Handler(worker.getLooper());
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(screen, f);
        io.post(poll);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Cfg.sp(this).edit().putBoolean("enabled", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            unregisterReceiver(screen);
        } catch (Exception ignored) {
        }
        if (io != null) io.removeCallbacksAndMessages(null);
        if (worker != null) worker.quitSafely();
        ui.removeCallbacksAndMessages(null);
        if (blink != null) blink.cancel();
        if (root != null && wm != null) {
            try {
                wm.removeView(root);
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }

    // ───────────── 前台通知 ─────────────

    private void goForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CH) == null) {
            NotificationChannel ch = new NotificationChannel(CH, "悬浮岛常驻", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, IslandService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_launcher_fg)
                .setContentTitle("gproxy 岛运行中")
                .setContentText("点此打开设置")
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "关闭悬浮岛", stop).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NID, n);
    }

    // ───────────── 悬浮岛 ─────────────

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    /** 岛最高能放到哪：状态栏是系统下拉手势区，放进去就点不到，所以最高到状态栏下沿再往下 2dp */
    private int minY() {
        int h = 0;
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (id > 0) h = getResources().getDimensionPixelSize(id);
        if (h <= 0) h = dp(32);
        return h + dp(2);
    }

    private TextView text(float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setSingleLine(true);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void buildIsland() {
        wm = getSystemService(WindowManager.class);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(14), dp(7), dp(14), dp(7));
        bg = new GradientDrawable();
        bg.setColor(Color.BLACK);
        bg.setCornerRadius(dp(18));
        root.setBackground(bg);
        root.setLayoutTransition(new LayoutTransition());

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        dot = new View(this);
        dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(GREY);
        dot.setBackground(dotBg);
        LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(dp(7), dp(7));
        dlp.rightMargin = dp(8);
        row.addView(dot, dlp);
        head = text(13, Color.WHITE, true);
        head.setText("gproxy 连接中…");
        row.addView(head);
        root.addView(row);

        detail = new LinearLayout(this);
        detail.setOrientation(LinearLayout.VERTICAL);
        detail.setVisibility(View.GONE);
        detail.setPadding(0, dp(6), 0, dp(2));
        root.addView(detail);

        blink = ObjectAnimator.ofFloat(dot, "alpha", 1f, 0.25f);
        blink.setDuration(600);
        blink.setRepeatCount(ValueAnimator.INFINITE);
        blink.setRepeatMode(ValueAnimator.REVERSE);

        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        final boolean draggable = Cfg.draggable(this);
        if (draggable) {
            lp.x = Cfg.sp(this).getInt("x", 0);
            lp.y = Math.max(minY(), Cfg.sp(this).getInt("y", minY() + dp(4)));
        } else {
            // 锁定：顶部居中，紧贴状态栏下方
            lp.x = 0;
            lp.y = minY() + dp(4);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        root.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY;
            int startX, startY;
            boolean drag;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX();
                        downY = e.getRawY();
                        startX = lp.x;
                        startY = lp.y;
                        drag = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float mx = e.getRawX() - downX, my = e.getRawY() - downY;
                        if (!drag && Math.hypot(mx, my) > slop) drag = true;
                        if (drag && draggable) {
                            int half = Math.max(0, (getResources().getDisplayMetrics().widthPixels - root.getWidth()) / 2);
                            lp.x = Math.max(-half, Math.min(half, startX + Math.round(mx)));
                            lp.y = Math.max(minY(), startY + Math.round(my));
                            try {
                                wm.updateViewLayout(root, lp);
                            } catch (Exception ignored) {
                            }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (drag) {
                            if (draggable) {
                                Cfg.sp(IslandService.this).edit().putInt("x", lp.x).putInt("y", lp.y).apply();
                            }
                        } else {
                            expanded = !expanded;
                            popRecord = null;
                            render();
                            if (expanded) {
                                io.removeCallbacks(poll);
                                io.post(poll);
                            }
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });

        wm.addView(root, lp);
    }

    private int failStreak() {
        int n = 0;
        for (GproxyClient.Record r : records) {
            if (!r.failed()) break;
            n++;
        }
        return n;
    }

    /** 正常状态的点颜色：预算、失败 */
    private int baseColor() {
        if (failStreak() > 0) return RED;
        float budget = Cfg.budget(this);
        if (budget > 0 && summary != null) {
            double ratio = summary.cost / budget;
            if (ratio >= 1) return RED;
            if (ratio >= WARN_RATIO) return AMBER;
        }
        return error != null ? RED : GREEN;
    }

    private String costText() {
        float budget = Cfg.budget(this);
        String c = Cfg.money(summary.cost);
        return budget > 0 ? c + "/" + Cfg.money(budget) : c;
    }

    private void render() {
        if (root == null) return;
        long now = System.currentTimeMillis();
        int max = getResources().getDisplayMetrics().widthPixels - dp(48);
        head.setMaxWidth(max);
        boolean pulsing = false;

        if (summary == null) {
            dotBg.setColor(error != null && !error.startsWith("连不上") ? RED : GREY);
            head.setText(error != null ? error : "gproxy 连接中…");
        } else if (popRecord != null && !expanded) {
            GproxyClient.Record r = popRecord;
            dotBg.setColor(r.failed() ? RED : GREEN);
            if (r.failed()) {
                head.setText("✗ " + Cfg.model(r.model) + " 失败");
            } else {
                String d = Cfg.dur(r.durationMs);
                head.setText("✓ " + Cfg.model(r.model)
                        + (d.isEmpty() ? "" : " · " + d)
                        + (r.cost >= 0 ? " · " + Cfg.money(r.cost) : ""));
            }
        } else if (!flights.isEmpty() && !expanded) {
            GproxyClient.Flight f = flights.get(0);
            dotBg.setColor(AMBER);
            pulsing = true;
            head.setText((f.responding ? "生成中 · " : "等待中 · ") + Cfg.model(f.model)
                    + " · " + Cfg.secs(now - f.startedAt)
                    + (flights.size() > 1 ? " +" + (flights.size() - 1) : ""));
        } else {
            dotBg.setColor(baseColor());
            head.setText(expanded
                    ? "今日 " + summary.requests + " 次 · " + costText()
                    : costText() + " · " + summary.requests + "次");
        }

        if (pulsing) {
            if (!blink.isStarted()) blink.start();
        } else if (blink.isStarted()) {
            blink.cancel();
            dot.setAlpha(1f);
        }

        detail.removeAllViews();
        if (expanded) {
            if (summary != null) {
                TextView s = text(12, 0xFFB4B2A9, false);
                s.setMaxWidth(max);
                s.setText("入 " + Cfg.w(summary.input) + " · 出 " + Cfg.w(summary.output)
                        + " · 缓存 " + Cfg.w(summary.cached)
                        + (updatedAt > 0 ? " · " + Cfg.hm(updatedAt) + " 更新" : ""));
                detail.addView(s);

                float budget = Cfg.budget(this);
                if (budget > 0) {
                    double ratio = summary.cost / budget;
                    TextView b = text(12, ratio >= 1 ? RED : ratio >= WARN_RATIO ? AMBER : 0xFFB4B2A9, false);
                    b.setMaxWidth(max);
                    b.setText("预算 " + Cfg.money(summary.cost) + " / " + Cfg.money(budget)
                            + " · " + Math.round(ratio * 100) + "%"
                            + (ratio >= 1 ? " · 已超" : ratio >= WARN_RATIO ? " · 快到了" : ""));
                    detail.addView(b);
                }
            }
            int fails = failStreak();
            if (fails > 0) {
                TextView t = text(12, RED, false);
                t.setMaxWidth(max);
                t.setText(fails >= records.size() && fails > 1
                        ? "最近 " + fails + " 次都失败了" : "最近连续失败 " + fails + " 次");
                detail.addView(t);
            }
            if (error != null && summary != null) {
                TextView e = text(12, RED, false);
                e.setMaxWidth(max);
                e.setText(error);
                detail.addView(e);
            }
            for (GproxyClient.Flight f : flights) {
                TextView t = text(12, AMBER, false);
                t.setMaxWidth(max);
                t.setPadding(0, dp(5), 0, 0);
                t.setText("▶ " + (f.responding ? "生成中 " : "等待中 ") + Cfg.model(f.model)
                        + " · " + Cfg.secs(now - f.startedAt));
                detail.addView(t);
                pulsing = true;
            }
            int show = Math.min(Cfg.recent(this), records.size());
            for (int i = 0; i < show; i++) {
                GproxyClient.Record r = records.get(i);
                TextView t = text(12, r.failed() ? 0xFFF09595 : 0xFFF1EFE8, false);
                t.setMaxWidth(max);
                t.setPadding(0, dp(5), 0, 0);
                String d = Cfg.dur(r.durationMs);
                t.setText(Cfg.hm(r.startedAt) + "  " + Cfg.model(r.model)
                        + "  入" + Cfg.w(r.input) + " 出" + Cfg.w(r.output)
                        + (r.cost >= 0 ? "  " + Cfg.money(r.cost) : "")
                        + (r.failed() ? "  失败" : d.isEmpty() ? "" : "  " + d));
                detail.addView(t);
            }
            if (summary != null && records.isEmpty() && Cfg.recent(this) > 0) {
                TextView t = text(12, GREY, false);
                t.setText("今天还没有请求");
                detail.addView(t);
            }
        }
        detail.setVisibility(expanded ? View.VISIBLE : View.GONE);
        bg.setCornerRadius(expanded ? dp(20) : dp(18));

        // 有请求在跑时每秒刷新计时
        ui.removeCallbacks(tick);
        if (!flights.isEmpty()) ui.postDelayed(tick, 1000);
    }

    private final Runnable tick = this::render;

    private final Runnable endPop = () -> {
        popRecord = null;
        render();
    };

    // ───────────── 提醒 ─────────────

    private void buzz(long[] pattern) {
        if (!Cfg.vibrate(this)) return;
        try {
            Vibrator v = getSystemService(Vibrator.class);
            if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createWaveform(pattern, -1));
        } catch (Exception ignored) {
        }
    }

    /** 跨过预算提醒线/上限时提醒一次（每天每档一次） */
    private void checkBudget() {
        float budget = Cfg.budget(this);
        if (budget <= 0 || summary == null) return;
        double ratio = summary.cost / budget;
        int level = ratio >= 1 ? 2 : ratio >= WARN_RATIO ? 1 : 0;
        if (level == 0) return;
        String key = Cfg.today() + ":" + level;
        if (key.equals(Cfg.sp(this).getString("budgetAlert", ""))
                || (level == 1 && (Cfg.today() + ":2").equals(Cfg.sp(this).getString("budgetAlert", "")))) {
            return;
        }
        Cfg.sp(this).edit().putString("budgetAlert", key).apply();
        Toast.makeText(this, level == 2
                ? "gproxy 今日已超预算：" + Cfg.money(summary.cost) + " / " + Cfg.money(budget)
                : "gproxy 今日已用 " + Math.round(ratio * 100) + "% 预算：" + Cfg.money(summary.cost),
                Toast.LENGTH_LONG).show();
        buzz(level == 2 ? new long[]{0, 120, 120, 120, 120, 120} : new long[]{0, 120, 120, 120});
    }

    // ───────────── 刷新 ─────────────

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            boolean active = fetch();
            if (!screenOn) return;
            long delay = active ? FAST_MS : Cfg.interval(IslandService.this) * 1000L;
            io.postDelayed(this, delay);
        }
    };

    /** 在后台线程跑；返回「现在是活跃期」，用来决定下次多久后刷新 */
    private boolean fetch() {
        long now = System.currentTimeMillis();
        GproxyClient.Summary s = null;
        List<GproxyClient.Record> rs = null;
        List<GproxyClient.Flight> fl = null;
        GproxyClient.Record fresh = null;
        String err = null;
        try {
            rs = client.recent(Math.max(3, Cfg.recent(this)));
            String newest = rs.isEmpty() ? "" : rs.get(0).id;
            boolean changed = ioLastId != null && !newest.isEmpty() && !newest.equals(ioLastId);
            if (changed) {
                fresh = rs.get(0);
                ioActiveUntil = now + ACTIVE_TAIL_MS;
            }
            boolean first = ioLastId == null;
            ioLastId = newest;
            if (first || changed || now - ioSummaryAt >= Cfg.interval(this) * 1000L) {
                s = client.today();
                ioSummaryAt = now;
            }
            try {
                fl = client.inflight();
            } catch (Exception ignored) {
                fl = new ArrayList<>();
            }
            if (!fl.isEmpty()) ioActiveUntil = now + ACTIVE_TAIL_MS;
        } catch (java.net.ConnectException | java.net.SocketTimeoutException e) {
            err = "连不上 gproxy，没在运行？";
        } catch (Exception e) {
            err = e.getMessage() == null ? e.toString() : e.getMessage();
        }
        final GproxyClient.Summary fs = s;
        final List<GproxyClient.Record> frs = rs;
        final List<GproxyClient.Flight> ffl = fl;
        final GproxyClient.Record ffresh = fresh;
        final String ferr = err;
        ui.post(() -> {
            error = ferr;
            if (ferr != null && ferr.startsWith("连不上")) {
                summary = null;
                flights = new ArrayList<>();
            }
            if (fs != null) {
                summary = fs;
                updatedAt = System.currentTimeMillis();
                checkBudget();
            }
            if (frs != null) records = frs;
            if (ffl != null) flights = ffl;
            if (ffresh != null) {
                if (ffresh.failed()) buzz(new long[]{0, 60, 80, 60});
                if (Cfg.pop(this) && !expanded) {
                    popRecord = ffresh;
                    ui.removeCallbacks(endPop);
                    ui.postDelayed(endPop, POP_MS);
                }
            }
            render();
        });
        return now < ioActiveUntil;
    }

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (io == null) return;
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) {
                screenOn = false;
                io.removeCallbacks(poll);
            } else if (Intent.ACTION_SCREEN_ON.equals(i.getAction())) {
                screenOn = true;
                io.removeCallbacks(poll);
                io.post(poll);
            }
        }
    };
}
