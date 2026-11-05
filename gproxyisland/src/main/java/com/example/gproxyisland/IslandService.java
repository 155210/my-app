package com.example.gproxyisland;

import android.animation.LayoutTransition;
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
 * 前台服务：在屏幕顶部画一颗黑色胶囊（悬浮窗），定时读 gproxy 用量。
 * 点一下展开/收起，按住拖动换位置；有新请求时胶囊会短暂显示这次的模型和花费。
 * 熄屏时暂停刷新，亮屏马上刷新一次。
 */
public class IslandService extends Service {
    static final String ACTION_STOP = "com.example.gproxyisland.STOP";
    private static final String CH = "island";
    private static final int NID = 1;

    private static final int GREEN = 0xFF5DCAA5, AMBER = 0xFFEF9F27, RED = 0xFFE24B4A, GREY = 0xFF888780;

    private WindowManager wm;
    private WindowManager.LayoutParams lp;
    private LinearLayout root, detail;
    private TextView head;
    private View dot;
    private GradientDrawable bg, dotBg;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private HandlerThread worker;
    private Handler io;
    private GproxyClient client;

    private boolean expanded, screenOn = true, popping;
    private String lastSeenId;
    private GproxyClient.Summary summary;
    private List<GproxyClient.Record> records = new ArrayList<>();
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
        lp.x = Cfg.sp(this).getInt("x", 0);
        lp.y = Cfg.sp(this).getInt("y", dp(40));
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
                        if (drag) {
                            lp.x = startX + Math.round(mx);
                            lp.y = Math.max(0, startY + Math.round(my));
                            try {
                                wm.updateViewLayout(root, lp);
                            } catch (Exception ignored) {
                            }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (drag) {
                            Cfg.sp(IslandService.this).edit().putInt("x", lp.x).putInt("y", lp.y).apply();
                        } else {
                            expanded = !expanded;
                            popping = false;
                            render();
                            if (expanded) io.post(once);
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });

        wm.addView(root, lp);
    }

    private void render() {
        if (root == null) return;
        int max = getResources().getDisplayMetrics().widthPixels - dp(48);
        head.setMaxWidth(max);

        if (error != null && summary == null) {
            dotBg.setColor(error.startsWith("连不上") ? GREY : RED);
            head.setText(error);
        } else if (summary == null) {
            dotBg.setColor(GREY);
            head.setText("gproxy 连接中…");
        } else if (popping && !expanded && !records.isEmpty()) {
            GproxyClient.Record r = records.get(0);
            dotBg.setColor(r.failed() ? RED : AMBER);
            head.setText(Cfg.model(r.model) + (r.cost >= 0 ? " · " + Cfg.money(r.cost) : "")
                    + (r.failed() ? " · 失败" : ""));
        } else {
            dotBg.setColor(error != null ? RED : GREEN);
            head.setText(expanded
                    ? "今日 " + summary.requests + " 次 · " + Cfg.money(summary.cost)
                    : Cfg.money(summary.cost) + " · " + summary.requests + "次");
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
            }
            if (error != null && summary != null) {
                TextView e = text(12, RED, false);
                e.setMaxWidth(max);
                e.setText(error);
                detail.addView(e);
            }
            for (GproxyClient.Record r : records) {
                TextView t = text(12, r.failed() ? 0xFFF09595 : 0xFFF1EFE8, false);
                t.setMaxWidth(max);
                t.setPadding(0, dp(5), 0, 0);
                t.setText(Cfg.hm(r.startedAt) + "  " + Cfg.model(r.model)
                        + "  入" + Cfg.w(r.input) + " 出" + Cfg.w(r.output)
                        + (r.cost >= 0 ? "  " + Cfg.money(r.cost) : "")
                        + (r.failed() ? "  失败" : ""));
                detail.addView(t);
            }
            if (summary != null && records.isEmpty() && Cfg.recent(this) > 0) {
                TextView t = text(12, 0xFF888780, false);
                t.setText("今天还没有请求");
                detail.addView(t);
            }
        }
        detail.setVisibility(expanded ? View.VISIBLE : View.GONE);
        bg.setCornerRadius(expanded ? dp(20) : dp(18));
    }

    // ───────────── 刷新 ─────────────

    private final Runnable once = this::fetch;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            fetch();
            if (screenOn) io.postDelayed(this, Cfg.interval(IslandService.this) * 1000L);
        }
    };

    private final Runnable endPop = () -> {
        popping = false;
        render();
    };

    /** 在后台线程跑 */
    private void fetch() {
        GproxyClient.Summary s = null;
        List<GproxyClient.Record> rs = null;
        String err = null;
        try {
            s = client.today();
            rs = client.recent(Math.max(1, Cfg.recent(this)));
        } catch (java.net.ConnectException | java.net.SocketTimeoutException e) {
            err = "连不上 gproxy，没在运行？";
        } catch (Exception e) {
            err = e.getMessage() == null ? e.toString() : e.getMessage();
        }
        final GproxyClient.Summary fs = s;
        final List<GproxyClient.Record> frs = rs;
        final String ferr = err;
        ui.post(() -> {
            error = ferr;
            if (fs != null) {
                summary = fs;
                updatedAt = System.currentTimeMillis();
            } else if (ferr != null && ferr.startsWith("连不上")) {
                summary = null;
            }
            if (frs != null) {
                String newest = frs.isEmpty() ? null : frs.get(0).id;
                boolean fresh = lastSeenId != null && newest != null && !newest.equals(lastSeenId);
                if (newest != null) lastSeenId = newest;
                else if (lastSeenId == null) lastSeenId = "";
                int keep = Cfg.recent(this);
                records = new ArrayList<>(frs.subList(0, Math.min(keep, frs.size())));
                if (keep == 0 && !frs.isEmpty()) records = new ArrayList<>(frs.subList(0, 1));
                if (fresh && Cfg.pop(this) && !expanded) {
                    popping = true;
                    ui.removeCallbacks(endPop);
                    ui.postDelayed(endPop, 6000);
                }
                if (keep == 0 && !popping) records.clear();
            }
            render();
        });
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
