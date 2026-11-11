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
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.text.SpannableStringBuilder;
import android.text.TextUtils;
import android.text.style.AbsoluteSizeSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
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
 * 收起时固定三段「状态图标 · 主信息 · 次信息」，按优先级显示：
 *   代理异常（整颗变红）＞ 生成中（跳动条 + 计时）＞ 刚完成/刚失败的提示（15 秒）＞ 今日花费（预算进度环）。
 * 没设预算时图标是圆点：绿 = 正常；红 = 最近一次失败或出错；灰 = 连不上 gproxy。
 * 点一下展开成面板；展开后长按显示调试信息。
 *
 * 刷新：空闲按设置的间隔；有请求在跑或刚跑完的 20 秒内每 2 秒一次。熄屏暂停。
 * 「生成中」读 gproxy 上游日志里 state = in_progress 的行，需要 gproxy 打开「上游日志」和「上游日志正文」。
 */
public class IslandService extends Service {
    static final String ACTION_STOP = "com.example.gproxyisland.STOP";
    private static final String CH = "island";
    private static final int NID = 1;

    private static final long FAST_MS = 2000, ACTIVE_TAIL_MS = 20000, POP_MS = 15000, PROXY_MS = 10000;
    /** 多久读一次 gproxy 日志开关、额度历史 */
    private static final long FLAGS_MS = 60000, QUOTA_MS = 60000;
    /** 预算提醒线 */
    private static final double WARN_RATIO = 0.8;

    private WindowManager wm;
    private WindowManager.LayoutParams lp;
    private LinearLayout root, row, detail;
    /** 收起态的三段：图标、主信息、分隔线、次信息 */
    private Ui.Glyph glyph;
    private TextView head, tail;
    private View sep;
    private GradientDrawable bg;

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
    private List<QItem> quota = new ArrayList<>();
    /** 展开后长按切换 */
    private boolean showDebug;
    /** 岛上「查询额度」的状态，null = 空闲 */
    private String probeMsg;
    private ProxyCheck.State proxy;
    private boolean probing;
    private String enableMsg;

    /** 展开面板里一个凭据的额度 */
    static class QItem {
        String name, warn;
        long at;
        final List<QRow> rows = new ArrayList<>();
    }

    /** 额度里的一行：有进度条（fill 0~1）或只有文字（fill = -1） */
    static class QRow {
        String label, right;
        float fill = -1;
        int color = Ui.GREEN;

        QRow(String label, String right) {
            this.label = label;
            this.right = right;
        }
    }

    /** 调试信息：展开后长按显示，方便截图定位 */
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
        if (glyph != null) glyph.stop();
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

    /** 按岛大小缩放的 sp，换成像素 */
    private int spx(float sp) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp * k, getResources().getDisplayMetrics()));
    }

    private TextView text(float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp * k);
        t.setTextColor(color);
        t.setSingleLine(true);
        t.setIncludeFontPadding(false);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private LinearLayout hrow() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        l.setBaselineAligned(false);
        return l;
    }

    private static LinearLayout.LayoutParams lp(int w, int h, float weight) {
        return new LinearLayout.LayoutParams(w, h, weight);
    }

    private static final int WRAP = LinearLayout.LayoutParams.WRAP_CONTENT, MATCH = LinearLayout.LayoutParams.MATCH_PARENT;

    /** 一段文字里前半截和后半截用不同颜色 / 粗细 */
    private static CharSequence two(String a, int colorA, boolean boldA, String b, int colorB) {
        SpannableStringBuilder sb = new SpannableStringBuilder(a + b);
        sb.setSpan(new ForegroundColorSpan(colorA), 0, a.length(), 0);
        if (boldA) sb.setSpan(new StyleSpan(Typeface.BOLD), 0, a.length(), 0);
        sb.setSpan(new ForegroundColorSpan(colorB), a.length(), sb.length(), 0);
        return sb;
    }

    private void buildIsland() {
        wm = getSystemService(WindowManager.class);
        k = Cfg.scale(this) / 100f;

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        bg = new GradientDrawable();
        bg.setColor(Color.BLACK);
        bg.setCornerRadius(sdp(18));
        root.setBackground(bg);
        root.setLayoutTransition(new LayoutTransition());

        // 收起态固定三段：状态图标 · 主信息 · 次信息
        row = hrow();
        glyph = new Ui.Glyph(this);
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(sdp(20), sdp(20));
        glp.rightMargin = sdp(9);
        row.addView(glyph, glp);
        head = text(14, Ui.FG, true);
        head.setEllipsize(TextUtils.TruncateAt.END);
        head.setText("gproxy 连接中…");
        row.addView(head);
        sep = new View(this);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(Math.max(1, dp(1)), sdp(14));
        slp.leftMargin = sdp(10);
        slp.rightMargin = sdp(10);
        row.addView(sep, slp);
        tail = text(14, Ui.MUTED, false);
        row.addView(tail);
        root.addView(row);

        detail = new LinearLayout(this);
        detail.setOrientation(LinearLayout.VERTICAL);
        detail.setVisibility(View.GONE);
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
        render();
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
            boolean drag, held;
            /** 展开时长按：显示 / 收起调试信息 */
            final Runnable hold = () -> {
                if (!expanded || !Cfg.debug(IslandService.this)) return;
                held = true;
                showDebug = !showDebug;
                render();
            };

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
                        held = false;
                        ui.postDelayed(hold, ViewConfiguration.getLongPressTimeout());
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float mx = e.getRawX() - downX, my = e.getRawY() - downY;
                        if (!drag && Math.hypot(mx, my) > slop) {
                            drag = true;
                            ui.removeCallbacks(hold);
                        }
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
                    case MotionEvent.ACTION_CANCEL:
                        ui.removeCallbacks(hold);
                        return true;
                    case MotionEvent.ACTION_UP:
                        ui.removeCallbacks(hold);
                        if (held) return true;
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

    /** 今日花费占预算的比例；没设预算或还没数据 = -1 */
    private double budgetRatio() {
        float budget = Cfg.budget(this);
        return budget > 0 && summary != null ? summary.cost / budget : -1;
    }

    /** 预算进度的颜色 */
    private static int ratioColor(double ratio) {
        return ratio >= 1 ? Ui.RED : ratio >= WARN_RATIO ? Ui.AMBER : Ui.GREEN;
    }

    private void render() {
        if (root == null || dead) return;
        long now = System.currentTimeMillis();
        renderPill(now);
        detail.removeAllViews();
        if (expanded) renderPanel(now);
        row.setVisibility(expanded ? View.GONE : View.VISIBLE);
        detail.setVisibility(expanded ? View.VISIBLE : View.GONE);
        if (expanded) {
            bg.setColor(Color.BLACK);
            bg.setStroke(0, 0);
            bg.setCornerRadius(sdp(26));
            root.setPadding(sdp(18), sdp(18), sdp(18), sdp(14));
        } else {
            bg.setCornerRadius(sdp(18));
            root.setPadding(sdp(9), sdp(8), sdp(14), sdp(8));
        }
        fit();

        // 有请求在跑时每秒刷新计时
        ui.removeCallbacks(tick);
        if (!flights.isEmpty()) ui.postDelayed(tick, 1000);
    }

    /** 收起态：状态图标 · 主信息 · 次信息。优先级：代理异常 ＞ 连不上 ＞ 生成中 ＞ 完成 / 失败提示 ＞ 今日花费 */
    private void renderPill(long now) {
        int pillBg = Color.BLACK, fg = Ui.FG, stroke = 0;
        int mode = Ui.Glyph.DOT, color = Ui.GREY, tailColor = Ui.MUTED;
        float progress = 0;
        boolean tailBold = false;
        CharSequence main, side = null;

        boolean proxyBad = proxy != null && !proxy.ok();
        if (proxyBad) {
            // 代理没开 / 不是指定节点：整颗岛变红，盖过别的状态
            pillBg = Ui.RED;
            fg = Color.BLACK;
            tailColor = Color.BLACK;
            mode = Ui.Glyph.SHIELD;
            color = Color.BLACK;
            main = proxy.on() ? "代理错误" : "代理没开";
            side = proxy.on() ? (proxy.node != null ? proxy.node : "不是指定节点") : "NekoBox";
            tailBold = true;
        } else if (summary == null) {
            color = error != null && !error.startsWith("连不上") ? Ui.RED : Ui.GREY;
            main = error != null ? error : "gproxy 连接中…";
        } else if (!flights.isEmpty()) {
            GproxyClient.Flight f = flights.get(0);
            mode = Ui.Glyph.BARS;
            color = Ui.AMBER;
            // 上游日志进行中时 firstResponseAtMs 不会实时写回，所以不区分「等待/生成」
            main = Cfg.model(f.model) + (flights.size() > 1 ? " +" + (flights.size() - 1) : "");
            side = Cfg.clock(now - f.startedAt);
            tailColor = Ui.AMBER;
            tailBold = true;
        } else if (popRecord != null) {
            GproxyClient.Record r = popRecord;
            if (r.failed()) {
                mode = Ui.Glyph.CROSS;
                color = Ui.RED;
                stroke = Ui.RED;
                main = Cfg.model(r.model) + " 失败";
                int n = failStreak();
                if (n > 1) {
                    side = "连续 " + n + " 次";
                    tailColor = Ui.RED_SOFT;
                }
            } else {
                mode = Ui.Glyph.CHECK;
                color = Ui.GREEN;
                String d = Cfg.dur(r.durationMs);
                main = d.isEmpty() ? Cfg.model(r.model) : two(Cfg.model(r.model), Ui.FG, true, "  " + d, Ui.MUTED);
                if (r.cost >= 0) {
                    side = "+" + Cfg.money(r.cost);
                    tailColor = Ui.GREEN;
                    tailBold = true;
                }
            }
        } else {
            double ratio = budgetRatio();
            boolean bad = failStreak() > 0 || error != null;
            if (ratio >= 0 && !bad) {
                // 设了预算：圆点换成进度环，一眼看出用了多少
                mode = Ui.Glyph.RING;
                color = ratioColor(ratio);
                progress = (float) Math.min(1, ratio);
            } else {
                color = bad ? Ui.RED : Ui.GREEN;
            }
            main = Cfg.money(summary.cost);
            if (ratio >= WARN_RATIO) {
                float budget = Cfg.budget(this);
                side = ratio >= 1 ? "超 " + Cfg.money(summary.cost - budget) : "剩 " + Cfg.money(budget - summary.cost);
                tailColor = ratioColor(ratio);
                tailBold = true;
            } else {
                side = summary.requests + " 次";
            }
        }

        bg.setColor(pillBg);
        bg.setStroke(stroke != 0 ? Math.max(2, dp(1.5f)) : 0, stroke);
        glyph.set(mode, color, progress);
        head.setTextColor(fg);
        head.setText(main);
        head.setMaxWidth(screenW() - dp(48) - sdp(side == null ? 44 : 130));
        boolean hasSide = side != null;
        sep.setVisibility(hasSide ? View.VISIBLE : View.GONE);
        tail.setVisibility(hasSide ? View.VISIBLE : View.GONE);
        if (hasSide) {
            sep.setBackgroundColor(pillBg == Ui.RED ? 0xFF7A2625 : 0xFF33363D);
            tail.setText(side);
            tail.setTextColor(tailColor);
            tail.setTypeface(tailBold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        }
    }

    /** 往展开面板里加一块，上面留 top（已按岛大小缩放）的空 */
    private void add(View v, int top) {
        LinearLayout.LayoutParams p = lp(MATCH, WRAP, 0);
        p.topMargin = top;
        detail.addView(v, p);
    }

    private TextView caption(String s) {
        TextView t = text(11, Ui.MUTED, true);
        t.setLetterSpacing(0.06f);
        t.setText(s);
        return t;
    }

    private TextView note(String s, int color) {
        TextView t = text(12, color, false);
        t.setSingleLine(false);
        t.setLineSpacing(0, 1.25f);
        t.setText(s);
        return t;
    }

    /** 展开面板：今日花费 → 进行中 → 最近请求 → 上游额度 → 代理和操作 */
    private void renderPanel(long now) {
        int inner = Math.min(screenW() - dp(24), sdp(366)) - sdp(36);
        detail.setLayoutParams(new LinearLayout.LayoutParams(inner, WRAP));
        boolean first = true;

        if (proxy != null && !proxy.ok()) {
            TextView t = note(proxy.on()
                    ? "代理错误：不是指定节点" + (proxy.node != null ? " · " + proxy.node : "")
                    : "代理没开（NekoBox 没启动？）", Color.BLACK);
            t.setTypeface(Typeface.DEFAULT_BOLD);
            t.setBackground(Ui.round(Ui.RED, sdp(12)));
            t.setPadding(sdp(12), sdp(9), sdp(12), sdp(9));
            add(t, 0);
            first = false;
        }

        // ── 今日 ──
        if (summary != null) {
            float budget = Cfg.budget(this);
            LinearLayout top = hrow();
            top.setGravity(Gravity.BOTTOM);
            TextView cost = text(13, Ui.MUTED, false);
            SpannableStringBuilder sb = new SpannableStringBuilder(Cfg.money(summary.cost));
            sb.setSpan(new AbsoluteSizeSpan(spx(30)), 0, sb.length(), 0);
            sb.setSpan(new StyleSpan(Typeface.BOLD), 0, sb.length(), 0);
            sb.setSpan(new ForegroundColorSpan(Ui.FG), 0, sb.length(), 0);
            if (budget > 0) sb.append("  / " + Cfg.money(budget) + " 预算");
            cost.setText(sb);
            top.addView(cost, lp(0, WRAP, 1));
            TextView cnt = text(13, Ui.MUTED, false);
            cnt.setText("今日 " + summary.requests + " 次");
            top.addView(cnt);
            add(top, first ? 0 : sdp(14));
            double ratio = budgetRatio();
            if (ratio >= 0) {
                Ui.Bar bar = new Ui.Bar(this).set((float) ratio, ratioColor(ratio));
                LinearLayout.LayoutParams bp = lp(MATCH, sdp(6), 0);
                bp.topMargin = sdp(10);
                detail.addView(bar, bp);
                if (ratio >= WARN_RATIO) {
                    add(note(ratio >= 1 ? "已超出今日预算" : "已用 " + Math.round(ratio * 100) + "% 预算，快到了", ratioColor(ratio)), sdp(6));
                }
            }
            LinearLayout trio = hrow();
            String[][] cells = {{"输入", Cfg.w(summary.input)}, {"输出", Cfg.w(summary.output)}, {"缓存", Cfg.w(summary.cached)}};
            for (String[] c : cells) {
                LinearLayout cell = new LinearLayout(this);
                cell.setOrientation(LinearLayout.VERTICAL);
                TextView l = text(11, Ui.MUTED, false);
                l.setText(c[0]);
                cell.addView(l);
                TextView v = text(15, Ui.FG, true);
                v.setText(c[1]);
                LinearLayout.LayoutParams vp = lp(WRAP, WRAP, 0);
                vp.topMargin = sdp(3);
                cell.addView(v, vp);
                trio.addView(cell, lp(0, WRAP, 1));
            }
            add(trio, sdp(12));
        } else {
            TextView t = note(error != null ? error : "gproxy 连接中…", error != null ? Ui.RED_SOFT : Ui.MUTED);
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14 * k);
            add(t, first ? 0 : sdp(14));
        }
        int fails = failStreak();
        if (fails > 0) {
            add(note(fails >= records.size() && fails > 1
                    ? "最近 " + fails + " 次都失败了" : "最近连续失败 " + fails + " 次", Ui.RED_SOFT), sdp(10));
        }
        if (error != null && summary != null) add(note(error, Ui.RED_SOFT), sdp(10));

        // ── 进行中 ──
        boolean firstFlight = true;
        for (GproxyClient.Flight f : flights) {
            LinearLayout r = hrow();
            r.setBackground(Ui.round(Ui.AMBER_BG, sdp(14)));
            r.setPadding(sdp(12), sdp(10), sdp(12), sdp(10));
            Ui.Glyph g = new Ui.Glyph(this);
            g.set(Ui.Glyph.BARS, Ui.AMBER, 0);
            LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(sdp(18), sdp(18));
            gp.rightMargin = sdp(10);
            r.addView(g, gp);
            TextView m = text(14, Ui.FG, true);
            m.setEllipsize(TextUtils.TruncateAt.END);
            m.setText("生成中 · " + Cfg.model(f.model));
            r.addView(m, lp(0, WRAP, 1));
            TextView c = text(14, Ui.AMBER, true);
            c.setText(Cfg.clock(now - f.startedAt));
            r.addView(c);
            add(r, firstFlight ? sdp(16) : sdp(6));
            firstFlight = false;
        }

        // ── 最近请求 ──
        int show = Math.min(Cfg.recent(this), records.size());
        if (Cfg.recent(this) > 0 && summary != null) {
            add(caption("最近请求"), sdp(16));
            if (show == 0) add(note("今天还没有请求", Ui.MUTED), sdp(8));
        }
        for (int i = 0; i < show; i++) {
            GproxyClient.Record rec = records.get(i);
            boolean bad = rec.failed();
            LinearLayout r = hrow();
            TextView time = text(13, Ui.MUTED, false);
            time.setText(Cfg.hm(rec.startedAt));
            r.addView(time, lp(sdp(46), WRAP, 0));
            TextView mid = text(13, Ui.FG, false);
            mid.setEllipsize(TextUtils.TruncateAt.END);
            String tokens = (rec.input >= 0 ? "  入" + Cfg.w(rec.input) : "") + (rec.output >= 0 ? " 出" + Cfg.w(rec.output) : "");
            mid.setText(two(Cfg.model(rec.model), bad ? Ui.RED_SOFT : Ui.FG, true, tokens, bad ? Ui.RED_SOFT : Ui.MUTED));
            r.addView(mid, lp(0, WRAP, 1));
            TextView dur = text(13, bad ? Ui.RED_SOFT : Ui.MUTED, false);
            dur.setGravity(Gravity.END);
            dur.setText(bad ? "失败" : Cfg.dur(rec.durationMs));
            r.addView(dur, lp(sdp(52), WRAP, 0));
            TextView cost = text(13, rec.cost >= 0 ? Ui.FG : Ui.MUTED, rec.cost >= 0);
            cost.setGravity(Gravity.END);
            cost.setText(rec.cost >= 0 ? Cfg.money(rec.cost) : "—");
            r.addView(cost, lp(sdp(56), WRAP, 0));
            add(r, sdp(8));
        }

        // ── 「生成中」不可用 ──
        if (flags != null && !flags.live()) {
            TextView t = note(enableMsg != null ? enableMsg
                    : "「生成中」不可用：gproxy 没开" + (flags.upstream ? "「上游日志正文」" : "「上游日志」和「上游日志正文」")
                    + "。点这里一键打开", Ui.AMBER);
            t.setBackground(Ui.round(Ui.AMBER_BG, sdp(12)));
            t.setPadding(sdp(12), sdp(10), sdp(12), sdp(10));
            t.setOnClickListener(v -> enableLog());
            add(t, sdp(14));
        }

        // ── 上游额度 ──
        if (!quota.isEmpty()) {
            long at = 0;
            for (QItem q : quota) at = Math.max(at, q.at);
            LinearLayout h = hrow();
            h.addView(caption("上游额度"), lp(0, WRAP, 1));
            if (at > 0) {
                TextView t = text(11, Ui.MUTED, false);
                t.setText(Cfg.when(at) + " 查询");
                h.addView(t);
            }
            add(h, sdp(16));
        }
        for (QItem q : quota) {
            LinearLayout r = hrow();
            TextView name = text(13, Ui.FG, false);
            name.setEllipsize(TextUtils.TruncateAt.END);
            name.setText(q.name);
            LinearLayout.LayoutParams np = lp(sdp(92), WRAP, 0);
            np.rightMargin = sdp(10);
            r.addView(name, np);
            LinearLayout col = new LinearLayout(this);
            col.setOrientation(LinearLayout.VERTICAL);
            for (int i = 0; i < q.rows.size(); i++) {
                QRow qr = q.rows.get(i);
                LinearLayout line = hrow();
                TextView l = text(11, Ui.MUTED, false);
                l.setEllipsize(TextUtils.TruncateAt.END);
                l.setText(qr.label);
                if (qr.fill >= 0) {
                    line.addView(l, lp(sdp(40), WRAP, 0));
                    LinearLayout.LayoutParams bp = lp(0, sdp(5), 1);
                    bp.leftMargin = sdp(6);
                    bp.rightMargin = sdp(8);
                    line.addView(new Ui.Bar(this).set(qr.fill, qr.color), bp);
                } else {
                    line.addView(l, lp(0, WRAP, 1));
                }
                TextView v = text(12, qr.fill >= 0 && qr.color != Ui.GREEN ? qr.color : Ui.FG, false);
                v.setGravity(Gravity.END);
                v.setText(qr.right);
                line.addView(v, lp(qr.fill >= 0 ? sdp(46) : WRAP, WRAP, 0));
                LinearLayout.LayoutParams lpp = lp(MATCH, WRAP, 0);
                if (i > 0) lpp.topMargin = sdp(5);
                col.addView(line, lpp);
            }
            r.addView(col, lp(0, WRAP, 1));
            add(r, sdp(10));
            if (q.warn != null) {
                TextView w = note(q.warn, Ui.AMBER);
                w.setPadding(sdp(102), 0, 0, 0);
                add(w, sdp(5));
            }
        }

        // ── 代理 + 操作 ──
        View line = new View(this);
        line.setBackgroundColor(Ui.LINE);
        LinearLayout.LayoutParams dl = lp(MATCH, Math.max(1, dp(1)), 0);
        dl.topMargin = sdp(14);
        detail.addView(line, dl);
        LinearLayout foot = hrow();
        if (proxy != null && proxy.ok()) {
            LinearLayout chip = hrow();
            chip.setBackground(Ui.round(Ui.CARD, sdp(15)));
            chip.setPadding(sdp(10), sdp(7), sdp(11), sdp(7));
            View dot = new View(this);
            dot.setBackground(Ui.round(Ui.GREEN, sdp(3)));
            LinearLayout.LayoutParams dp6 = new LinearLayout.LayoutParams(sdp(6), sdp(6));
            dp6.rightMargin = sdp(6);
            chip.addView(dot, dp6);
            TextView t = text(12, Ui.FG, false);
            t.setEllipsize(TextUtils.TruncateAt.END);
            String where = (proxy.node != null ? proxy.node : proxy.nodeType != null ? proxy.nodeType : "已开")
                    + (proxy.exit != null ? " · " + proxy.exit : "");
            t.setText("代理 " + where);
            chip.addView(t);
            foot.addView(chip, lp(0, WRAP, 1));
            View gapV = new View(this);
            foot.addView(gapV, lp(sdp(8), 1, 0));
        } else {
            foot.addView(new View(this), lp(0, 1, 1));
        }
        TextView btn = text(13, probing ? Ui.MUTED : Ui.FG, true);
        btn.setText(probing ? "查询中…" : "查询额度");
        GradientDrawable bb = Ui.round(Color.TRANSPARENT, sdp(20));
        bb.setStroke(Math.max(1, dp(1)), 0xFF3A3D44);
        btn.setBackground(bb);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(sdp(16), 0, sdp(16), 0);
        if (!probing) btn.setOnClickListener(v -> probeAll());
        foot.addView(btn, lp(WRAP, sdp(40), 0));
        add(foot, sdp(12));
        if (probeMsg != null && !probing) add(note(probeMsg, Ui.MUTED), sdp(8));
        if (proxy != null && proxy.on() && proxy.node == null) {
            // 读不到节点名时说明原因，方便照着处理
            add(note(!proxy.listening
                    ? (Cfg.listenerGranted(this)
                    ? "节点名：通知使用权已给但还没连上，关掉岛再开（不行就重启手机）"
                    : "节点名：要在设置里给「通知使用权」")
                    : !proxy.notif
                    ? "节点名：没看到 NekoBox 通知（在系统里把 NekoBox 的通知打开）"
                    : "节点名：NekoBox 通知里没有标题", Ui.MUTED), sdp(8));
        }

        // ── 调试：展开后长按才显示 ──
        if (showDebug && Cfg.debug(this)) {
            TextView t = note(debugText(now), Ui.GREY);
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10 * k);
            add(t, sdp(10));
        }
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
        List<QItem> ql = null;
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
        final List<QItem> fql = ql;
        final ProxyCheck.State fproxy = ioProxy;
        final boolean fproxyAlert = proxyAlert;
        ui.post(() -> {
            if (dead) return;
            error = ferr;
            diag = fdiag;
            if (fflags != null) flags = fflags;
            if (fql != null) quota = fql;
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
            List<QItem> ql = quotaSummary();
            ioQuotaAt = System.currentTimeMillis();
            final String m = Cfg.hm(System.currentTimeMillis()) + " 已查 " + ok + " 个"
                    + (fail > 0 ? "，失败 " + fail + " 个" + (lastErr != null ? "：" + lastErr : "") : "");
            ui.post(() -> {
                probing = false;
                probeMsg = m;
                quota = ql;
                render();
            });
        });
    }

    /** 展开面板里的额度：只读 gproxy 存的历史和本机上次查询，不请求上游 */
    private List<QItem> quotaSummary() {
        List<QItem> out = new ArrayList<>();
        try {
            for (GproxyClient.Cred c : client.credentials()) {
                if (!c.enabled) continue;
                GproxyClient.Quota q = Cfg.bestQuota(this, c.id, client.quotaHistory(c.id));
                if (q == null || q.rows.isEmpty()) continue;
                QItem it = new QItem();
                it.name = c.shortName;
                it.at = q.at;
                for (GproxyClient.QuotaRow r : q.rows) {
                    String v = Cfg.quotaValue(r);
                    if (v == null) continue;
                    QRow row = new QRow(r.name, v);
                    if (r.percent >= 0) {
                        row.fill = (float) (r.percent / 100.0);
                        row.color = Ui.usedColor(r.percent);
                    }
                    it.rows.add(row);
                    long t = Cfg.exhaustAt(r, q.at);
                    if (t > 0 && it.warn == null) it.warn = r.name + "额度按此速度" + Cfg.day(t) + "用完";
                    if (it.rows.size() >= 3) break;
                }
                if (q.blockedUntil > System.currentTimeMillis()) it.warn = "被上游限流到 " + Cfg.hm(q.blockedUntil);
                if (it.rows.isEmpty()) continue;
                out.add(it);
                if (out.size() >= 4) break;
            }
        } catch (Exception ignored) {
        }
        if (!Cfg.naiKey(this).isEmpty()) {
            NaiClient.Quota n = NaiClient.last(this);
            QItem it = new QItem();
            if (n == null) {
                it.name = "NAI";
                it.rows.add(new QRow("还没查询过", ""));
            } else {
                it.name = "NAI · " + n.tier;
                it.at = n.at;
                if (n.percent >= 0) {
                    // NAI 给的是剩余量，条也画剩余
                    QRow row = new QRow("V5", n.empty ? "用完" : "剩" + Math.round(n.percent) + "%");
                    row.fill = n.empty ? 0f : (float) (n.percent / 100.0);
                    row.color = n.empty ? Ui.RED : Ui.GREEN;
                    it.rows.add(row);
                }
                if (n.anlas >= 0) it.rows.add(new QRow("Anlas", NaiClient.anlas(n.anlas)));
                if (it.rows.isEmpty()) it.rows.add(new QRow("没有额度读数", ""));
            }
            out.add(it);
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
