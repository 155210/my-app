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
 *   生成中（黄灯闪烁 + 计时）＞ 刚完成/刚失败的提示（15 秒，绿灯/红灯）＞ 今日花费。
 * 状态点：绿 = 正常；黄 = 到预算提醒线；红 = 超预算或最近一次失败；灰 = 连不上 gproxy。
 *
 * 刷新：空闲按设置的间隔；有请求在跑或刚跑完的 20 秒内每 2 秒一次。熄屏暂停。
 * 「生成中」读 gproxy 上游日志里 state = in_progress 的行，需要 gproxy 打开「上游日志」和「上游日志正文」。
 */
public class IslandService extends Service {
    static final String ACTION_STOP = "com.example.gproxyisland.STOP";
    private static final String CH = "island";
    private static final int NID = 1;

    private static final int GREEN = 0xFF5DCAA5, AMBER = 0xFFEF9F27, RED = 0xFFE24B4A, GREY = 0xFF888780;
    private static final long FAST_MS = 2000, ACTIVE_TAIL_MS = 20000, POP_MS = 15000, PROXY_MS = 10000;
    /** 多久读一次 gproxy 日志开关、额度历史 */
    private static final long FLAGS_MS = 60000, QUOTA_MS = 60000;
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
    /** 上次列表里的 id；null = 还没拉过 */
    private java.util.Set<String> ioSeen;
    private long ioSummaryAt, ioActiveUntil, ioFlagsAt, ioQuotaAt;
    private GproxyClient.LogFlags ioFlags;
    private final Diag ioDiag = new Diag();
    private volatile boolean wantQuota;
    private ProxyCheck.State ioProxy;
    private long ioProxyAt;
    /** 代理从开着变成没开时提醒一次 */
    private boolean ioProxyWasOn = true;

    // ── 只在 ui 线程用 ──
    private volatile boolean expanded;
    private volatile boolean screenOn = true;
    private GproxyClient.Summary summary;
    private List<GproxyClient.Record> records = new ArrayList<>();
    private List<GproxyClient.Flight> flights = new ArrayList<>();
    private GproxyClient.Record popRecord;
    private String error;
    private long updatedAt;
    private GproxyClient.LogFlags flags;
    private Diag diag = new Diag();
    private List<String> quotaLines = new ArrayList<>();
    /** 岛上「查询额度」的状态，null = 空闲 */
    private String probeMsg;
    private ProxyCheck.State proxy;
    private boolean probing;
    private String enableMsg;

    /** 调试信息：展开岛最下面显示，方便截图定位 */
    static class Diag {
        long polls, lastPollAt, lastOkAt, newestAt;
        String newestId = "", newestState, inflightErr, lastErr;
        int inflight, records;

        Diag copy() {
            Diag d = new Diag();
            d.polls = polls;
            d.lastPollAt = lastPollAt;
            d.lastOkAt = lastOkAt;
            d.newestAt = newestAt;
            d.newestId = newestId;
            d.newestState = newestState;
            d.inflightErr = inflightErr;
            d.lastErr = lastErr;
            d.inflight = inflight;
            d.records = records;
            return d;
        }
    }

    static boolean running;
    /** 服务已销毁：还在路上的后台结果回到主线程后直接丢掉，不再画、不再排计时 */
    private volatile boolean dead;

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
        // 刚给完通知使用权时系统有时不立即绑定，这里请求重绑一次
        if (Cfg.listenerGranted(this) && !NodeListener.connected) {
            try {
                android.service.notification.NotificationListenerService.requestRebind(
                        new android.content.ComponentName(this, NodeListener.class));
            } catch (Exception ignored) {}
        }
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
        dead = true;
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

    /** 水平对齐：0 = 居中，1 = 贴左（gap = 离左边距离），2 = 贴右（gap = 离右边距离）。
     *  贴哪边就从哪边往里展开，展开 / 收起、文字变长变短都不会左右晃 */
    private int anchor, gap;

    private int screenW() {
        return getResources().getDisplayMetrics().widthPixels;
    }

    /** 按对齐方式和宽度 w 摆窗口：一律按左边缘定位，宽度也写死，宽度和位置一次更新，靠右 / 居中展开时不跳。返回是否有变化 */
    private boolean place(int w) {
        int W = screenW();
        int x;
        if (anchor == 1) x = gap;
        else if (anchor == 2) x = W - gap - w;
        else x = (W - w) / 2;
        x = Math.max(0, Math.min(x, W - w));
        int g = Gravity.TOP | Gravity.LEFT;
        if (g == lp.gravity && x == lp.x && w == lp.width) return false;
        lp.gravity = g;
        lp.x = x;
        lp.width = w;
        return true;
    }

    /** 先量出内容的新宽度，再把宽度和位置一起交给窗口 */
    private void fit() {
        if (root == null || lp == null) return;
        root.measure(View.MeasureSpec.makeMeasureSpec(screenW(), View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        if (place(root.getMeasuredWidth()) && root.isAttachedToWindow()) {
            try {
                wm.updateViewLayout(root, lp);
            } catch (Exception ignored) {
            }
        }
    }

    /** 岛的缩放（设置页滑条） */
    private float k = 1f;

    /** 按岛大小缩放的 dp */
    private int sdp(float v) {
        return dp(v * k);
    }

    private TextView text(float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp * k);
        t.setTextColor(color);
        t.setSingleLine(true);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void buildIsland() {
        wm = getSystemService(WindowManager.class);
        k = Cfg.scale(this) / 100f;

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(sdp(14), sdp(7), sdp(14), sdp(7));
        bg = new GradientDrawable();
        bg.setColor(Color.BLACK);
        bg.setCornerRadius(sdp(18));
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
        LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(sdp(7), sdp(7));
        dlp.rightMargin = sdp(8);
        row.addView(dot, dlp);
        head = text(13, Color.WHITE, true);
        head.setText("gproxy 连接中…");
        row.addView(head);
        root.addView(row);

        detail = new LinearLayout(this);
        detail.setOrientation(LinearLayout.VERTICAL);
        detail.setVisibility(View.GONE);
        detail.setPadding(0, sdp(6), 0, sdp(2));
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
        // 拖到哪就存哪；锁定后也停在存的位置，只有「位置复原」清掉后才回顶部居中
        android.content.SharedPreferences sp = Cfg.sp(this);
        if (sp.contains("anchor")) {
            anchor = sp.getInt("anchor", 0);
            gap = sp.getInt("gap", 0);
        } else {
            // 旧版存的是离中心的偏移，粗略换算成贴边
            int ox = sp.getInt("x", 0);
            anchor = Math.abs(ox) < dp(20) ? 0 : ox < 0 ? 1 : 2;
            gap = Math.max(0, screenW() / 2 - Math.abs(ox) - dp(60));
        }
        lp.y = Math.max(minY(), sp.getInt("y", minY() + dp(4)));
        fit();
        // 兜底：内容在 render 之外变了宽度（比如字体加载）时重新摆一次
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            if (r - l != or - ol) root.post(this::fit);
        });
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
                        int[] loc = new int[2];
                        root.getLocationOnScreen(loc);
                        startX = loc[0];
                        startY = lp.y;
                        drag = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float mx = e.getRawX() - downX, my = e.getRawY() - downY;
                        if (!drag && Math.hypot(mx, my) > slop) drag = true;
                        if (drag && draggable) {
                            // 拖动时临时按左边缘定位
                            lp.gravity = Gravity.TOP | Gravity.LEFT;
                            lp.x = Math.max(0, Math.min(screenW() - root.getWidth(), startX + Math.round(mx)));
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
                                int w = root.getWidth(), left = lp.x, right = screenW() - left - w;
                                if (Math.abs(left + w / 2 - screenW() / 2) < dp(24)) {
                                    anchor = 0;
                                    gap = 0;
                                } else if (left <= right) {
                                    anchor = 1;
                                    gap = left;
                                } else {
                                    anchor = 2;
                                    gap = right;
                                }
                                place(w);
                                try {
                                    wm.updateViewLayout(root, lp);
                                } catch (Exception ignored) {
                                }
                                fit();
                                Cfg.sp(IslandService.this).edit().putInt("anchor", anchor).putInt("gap", gap)
                                        .putInt("y", lp.y).apply();
                            }
                        } else {
                            expanded = !expanded;
                            popRecord = null;
                            render();
                            if (expanded) {
                                wantQuota = true;
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
        if (root == null || dead) return;
        long now = System.currentTimeMillis();
        int max = getResources().getDisplayMetrics().widthPixels - dp(48);
        head.setMaxWidth(max);
        boolean pulsing = false;

        boolean proxyBad = proxy != null && !proxy.ok();
        if (proxyBad && !expanded) {
            // 代理没开 / 不是指定节点：最高优先级，盖过连不上、生成中、完成提示
            dotBg.setColor(RED);
            head.setText(proxy.on()
                    ? "⚠ 代理错误 · 不是指定节点" + (proxy.node != null ? " · " + proxy.node : "")
                    : "⚠ 代理没开（NekoBox 没启动？）");
        } else if (summary == null) {
            dotBg.setColor(error != null && !error.startsWith("连不上") ? RED : GREY);
            head.setText(error != null ? error : "gproxy 连接中…");
        } else if (!flights.isEmpty() && !expanded) {
            GproxyClient.Flight f = flights.get(0);
            dotBg.setColor(AMBER);
            pulsing = true;
            // 上游日志进行中时 firstResponseAtMs 不会实时写回，所以不区分「等待/生成」
            head.setText("生成中 · " + Cfg.model(f.model)
                    + " · " + Cfg.secs(now - f.startedAt)
                    + (flights.size() > 1 ? " +" + (flights.size() - 1) : ""));
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
        } else {
            boolean busy = expanded && !flights.isEmpty() && !proxyBad;
            dotBg.setColor(proxyBad ? RED : busy ? AMBER : baseColor());
            pulsing = busy;
            head.setText(expanded
                    ? "今日 " + summary.requests + " 次 · " + costText()
                    : (proxyBad ? (proxy.on() ? "⚠ 代理错误 · " : "⚠ 代理没开 · ") : "")
                    + costText() + " · " + summary.requests + "次");
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
                t.setText("▶ 生成中 " + Cfg.model(f.model)
                        + " · " + Cfg.secs(now - f.startedAt));
                detail.addView(t);
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
            if (proxy != null) {
                TextView t = text(12, proxy.ok() ? 0xFFB4B2A9 : RED, false);
                t.setMaxWidth(max);
                t.setSingleLine(false);
                t.setPadding(0, dp(5), 0, 0);
                t.setText(proxy.on()
                        ? (proxy.wrongNode ? "⚠ 代理错误：不是指定节点" : "代理已开") + (proxy.exit != null ? " · 出口 " + proxy.exit : "") + (proxy.node != null ? " · 节点 " + proxy.node
                        : (proxy.nodeType != null ? " · " + proxy.nodeType : "")
                        + (!proxy.listening
                        ? (Cfg.listenerGranted(this)
                        ? " · 通知使用权已给但还没连上，关掉岛再开（不行就重启手机）"
                        : " · 节点名要在设置里给「通知使用权」")
                        : !proxy.notif
                        ? " · 没看到 NekoBox 通知（在系统里把 NekoBox 的通知打开）"
                        : " · NekoBox 通知里没有标题"))
                        : "⚠ 代理没开（NekoBox 没启动？）");
                detail.addView(t);
            }
            if (flags != null && !flags.live()) {
                TextView t = text(12, AMBER, false);
                t.setMaxWidth(max);
                t.setSingleLine(false);
                t.setPadding(0, dp(6), 0, 0);
                t.setText(enableMsg != null ? enableMsg
                        : "「生成中」不可用：gproxy 没开" + (flags.upstream ? "「上游日志正文」" : "「上游日志」和「上游日志正文」")
                        + "。点这行一键打开");
                t.setOnClickListener(v -> enableLog());
                detail.addView(t);
            }
            for (String q : quotaLines) {
                TextView t = text(12, q.contains("⚠") ? AMBER : 0xFFB4B2A9, false);
                t.setMaxWidth(max);
                t.setSingleLine(false);
                t.setPadding(0, dp(5), 0, 0);
                t.setText(q);
                detail.addView(t);
            }
            {
                TextView t = text(12, probing ? GREY : GREEN, true);
                t.setMaxWidth(max);
                t.setSingleLine(false);
                t.setPadding(0, dp(6), 0, dp(2));
                t.setText(probing ? "额度查询中…" : "⟳ 查询额度（会请求上游）" + (probeMsg != null ? " · " + probeMsg : ""));
                if (!probing) t.setOnClickListener(v -> probeAll());
                detail.addView(t);
            }
            if (Cfg.debug(this)) {
                TextView t = text(10, GREY, false);
                t.setMaxWidth(max);
                t.setSingleLine(false);
                t.setPadding(0, dp(6), 0, 0);
                t.setText(debugText(now));
                detail.addView(t);
            }
        }
        detail.setVisibility(expanded ? View.VISIBLE : View.GONE);
        bg.setCornerRadius(expanded ? sdp(20) : sdp(18));
        fit();

        // 有请求在跑时每秒刷新计时
        ui.removeCallbacks(tick);
        if (!flights.isEmpty()) ui.postDelayed(tick, 1000);
    }

    private String debugText(long now) {
        Diag d = diag;
        StringBuilder b = new StringBuilder("调试 · 第 ").append(d.polls).append(" 次刷新");
        if (d.lastPollAt > 0) b.append(" · ").append((now - d.lastPollAt) / 1000).append("s 前");
        b.append(" · 间隔 ").append(Cfg.interval(this)).append("s");
        b.append("\n上次成功 ").append(d.lastOkAt > 0 ? Cfg.hms(d.lastOkAt) : "无")
                .append(" · 记录 ").append(d.records).append(" 条");
        if (!d.newestId.isEmpty()) {
            b.append("\n最新 ").append(d.newestId.length() > 10 ? d.newestId.substring(0, 10) : d.newestId)
                    .append(" · ").append(Cfg.hms(d.newestAt))
                    .append(d.newestState != null ? " · " + d.newestState : "");
        }
        b.append("\n进行中 ").append(d.inflight).append(" 条 · 上游日志 ")
                .append(flags == null ? "?" : flags.upstream ? "开" : "关")
                .append(" · 正文 ").append(flags == null ? "?" : flags.upstreamBody ? "开" : "关");
        if (d.inflightErr != null) b.append("\n读上游日志出错：").append(d.inflightErr);
        if (d.lastErr != null) b.append("\n最近错误：").append(d.lastErr);
        return b.toString();
    }

    /** 一键打开 gproxy 上游日志 + 正文 */
    private void enableLog() {
        enableMsg = "正在打开上游日志…";
        render();
        io.post(() -> {
            String msg;
            GproxyClient.LogFlags f = null;
            try {
                f = client.enableLiveLog();
                msg = f.live() ? null : "打开失败：gproxy 设置没变";
            } catch (Exception e) {
                msg = "打开失败：" + (e.getMessage() == null ? e.toString() : e.getMessage());
            }
            if (f != null) {
                ioFlags = f;
                ioFlagsAt = System.currentTimeMillis();
            }
            final String m = msg;
            final GproxyClient.LogFlags ff = f;
            ui.post(() -> {
                if (dead) return;
                enableMsg = m;
                if (ff != null) flags = ff;
                if (ff != null && ff.live()) Toast.makeText(this, "已打开，下次请求就能看到「生成中」", Toast.LENGTH_LONG).show();
                render();
            });
        });
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
            // 刷新进行中被点开 / 亮屏会另外排进一次刷新，这里先清掉，保证始终只有一条刷新循环
            io.removeCallbacks(this);
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
        List<String> ql = null;
        String err = null;
        ioDiag.polls++;
        ioDiag.lastPollAt = now;
        boolean proxyAlert = false;
        if (!Cfg.proxyCheck(this)) {
            ioProxy = null;
        } else if (ioProxy == null || now - ioProxyAt >= PROXY_MS) {
            ioProxy = ProxyCheck.check(this);
            ioProxyAt = now;
            boolean on = ioProxy.ok();
            proxyAlert = ioProxyWasOn && !on;
            ioProxyWasOn = on;
        }
        try {
            rs = client.recent(Math.max(5, Cfg.recent(this)));
            // 列表按开始时间排，长请求完成时不一定在第一条：出现了上次没见过的 id 就算有新完成
            java.util.Set<String> ids = new java.util.HashSet<>();
            for (GproxyClient.Record r : rs) ids.add(r.id);
            if (ioSeen != null) {
                for (GproxyClient.Record r : rs) {
                    if (!r.id.isEmpty() && !ioSeen.contains(r.id)) {
                        fresh = r;
                        break;
                    }
                }
            }
            boolean first = ioSeen == null;
            ioSeen = ids;
            if (fresh != null) ioActiveUntil = now + ACTIVE_TAIL_MS;
            ioDiag.records = rs.size();
            if (!rs.isEmpty()) {
                GproxyClient.Record n = rs.get(0);
                ioDiag.newestId = n.id;
                ioDiag.newestAt = n.startedAt;
                ioDiag.newestState = n.state;
            }
            if (first || fresh != null || now - ioSummaryAt >= Cfg.interval(this) * 1000L) {
                s = client.today();
                ioSummaryAt = now;
            }
            if (ioFlags == null || now - ioFlagsAt >= FLAGS_MS) {
                try {
                    ioFlags = client.logFlags();
                } catch (Exception ignored) {
                    // 非管理员读不到设置，不影响别的
                }
                ioFlagsAt = now;
            }
            try {
                fl = client.inflight();
                ioDiag.inflightErr = null;
            } catch (Exception e) {
                fl = new ArrayList<>();
                ioDiag.inflightErr = e.getMessage() == null ? e.toString() : e.getMessage();
            }
            ioDiag.inflight = fl.size();
            if (!fl.isEmpty()) ioActiveUntil = now + ACTIVE_TAIL_MS;
            if (wantQuota || (expanded && now - ioQuotaAt >= QUOTA_MS)) {
                wantQuota = false;
                ioQuotaAt = now;
                ql = quotaSummary();
            }
            ioDiag.lastOkAt = now;
        } catch (java.net.ConnectException | java.net.SocketTimeoutException e) {
            err = "连不上 gproxy，没在运行？";
        } catch (Exception e) {
            err = e.getMessage() == null ? e.toString() : e.getMessage();
        }
        if (err != null) {
            ioDiag.lastErr = Cfg.hms(now) + " " + err;
            // 界面可能已清掉汇总，恢复后的第一次刷新就重读，不等满一个间隔
            ioSummaryAt = 0;
        }
        final GproxyClient.Summary fs = s;
        final List<GproxyClient.Record> frs = rs;
        final List<GproxyClient.Flight> ffl = fl;
        final GproxyClient.Record ffresh = fresh;
        final String ferr = err;
        final GproxyClient.LogFlags fflags = ioFlags;
        final Diag fdiag = ioDiag.copy();
        final List<String> fql = ql;
        final ProxyCheck.State fproxy = ioProxy;
        final boolean fproxyAlert = proxyAlert;
        ui.post(() -> {
            if (dead) return;
            error = ferr;
            diag = fdiag;
            if (fflags != null) flags = fflags;
            if (fql != null) quotaLines = fql;
            proxy = fproxy;
            if (fproxyAlert) {
                Toast.makeText(this, fproxy != null && fproxy.on()
                        ? "代理错误：当前不是指定节点" + (fproxy.node != null ? "（" + fproxy.node + "）" : "")
                        : "代理没开：NekoBox 没在运行", Toast.LENGTH_LONG).show();
                buzz(new long[]{0, 200, 120, 200});
            }
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
                if (Cfg.pop(this)) {
                    popRecord = ffresh;
                    ui.removeCallbacks(endPop);
                    ui.postDelayed(endPop, POP_MS);
                }
            }
            render();
        });
        return now < ioActiveUntil;
    }

    /** 岛上点「查询额度」：每个启用的凭据都让 gproxy 去问一次上游，结果存本机 */
    private void probeAll() {
        probing = true;
        probeMsg = null;
        render();
        io.post(() -> {
            int ok = 0, fail = 0;
            String lastErr = null;
            try {
                for (GproxyClient.Cred c : client.credentials()) {
                    if (!c.enabled) continue;
                    try {
                        GproxyClient.Quota q = client.quotaProbe(c.id);
                        if (q.raw != null) Cfg.saveProbe(this, c.id, q.raw);
                        ok++;
                    } catch (Exception e) {
                        fail++;
                        lastErr = e.getMessage();
                    }
                }
            } catch (Exception e) {
                fail++;
                lastErr = e.getMessage();
            }
            String nk = Cfg.naiKey(this);
            if (!nk.isEmpty()) {
                try {
                    NaiClient.probe(this, nk);
                    ok++;
                } catch (Exception e) {
                    fail++;
                    lastErr = "NAI " + e.getMessage();
                }
            }
            List<String> ql = quotaSummary();
            ioQuotaAt = System.currentTimeMillis();
            final String m = Cfg.hm(System.currentTimeMillis()) + " 已查 " + ok + " 个"
                    + (fail > 0 ? "，失败 " + fail + " 个" + (lastErr != null ? "：" + lastErr : "") : "");
            ui.post(() -> {
                probing = false;
                probeMsg = m;
                quotaLines = ql;
                render();
            });
        });
    }

    /** 展开岛里的额度摘要：只读 gproxy 存的历史，不请求上游 */
    private List<String> quotaSummary() {
        List<String> out = new ArrayList<>();
        try {
            for (GproxyClient.Cred c : client.credentials()) {
                if (!c.enabled) continue;
                GproxyClient.Quota q = Cfg.bestQuota(this, c.id, client.quotaHistory(c.id));
                String line = Cfg.quotaLine(q);
                if (line == null) continue;
                out.add("额度 " + c.shortName + " · " + line);
                if (out.size() >= 4) break;
            }
        } catch (Exception ignored) {
        }
        if (!Cfg.naiKey(this).isEmpty()) {
            NaiClient.Quota n = NaiClient.last(this);
            out.add(n != null ? "额度 " + NaiClient.line(n) : "额度 NAI · 还没查询过");
        }
        return out;
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
