package com.example.gproxyisland;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * 设置页。首页是一张状态卡（岛的预览、总开关、权限）加分组列表，每行显示当前值，点进去是分页。
 * 改动即时保存；要重启岛才生效的（地址、账号、拖动、大小）在离开分页时自动重启一次。
 */
public class MainActivity extends Activity {
    private static final int WRAP = LinearLayout.LayoutParams.WRAP_CONTENT, MATCH = LinearLayout.LayoutParams.MATCH_PARENT;
    private static final String HOME = "home";

    private ScrollView sv;
    private LinearLayout box;
    private String page = HOME;
    /** 每开一个页面加一，后台结果回来时页面已经换了就丢掉 */
    private int gen;
    /** 这一页改了要重启岛才生效的设置 */
    private boolean needRestart;
    private Updater.Latest latest;

    private int dp(float v) {
        return Ui.dp(this, v);
    }

    private SharedPreferences sp() {
        return Cfg.sp(this);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);
        sv = new ScrollView(this);
        sv.setBackgroundColor(Ui.BG);
        sv.setFillViewport(true);
        setContentView(sv);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
        new Thread(() -> Updater.cleanup(this)).start();
        // 静默查一次更新，有新版时首页右上角会提示
        new Thread(() -> {
            try {
                Updater.Latest l = Updater.latest(this);
                runOnUiThread(() -> {
                    latest = l;
                    if (HOME.equals(page)) open(HOME);
                });
            } catch (Exception ignored) {
            }
        }).start();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 授权回来后，之前开着的自动恢复
        if (Cfg.enabled(this) && !IslandService.running && Settings.canDrawOverlays(this)) {
            IslandService.start(this);
            sv.postDelayed(() -> open(page), 300);
        }
        open(page);
    }

    @Override
    protected void onPause() {
        applyRestart();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (!HOME.equals(page)) open(HOME);
        else super.onBackPressed();
    }

    private void applyRestart() {
        if (!needRestart) return;
        needRestart = false;
        restartIsland();
    }

    private void restartIsland() {
        if (!IslandService.running) return;
        IslandService.stop(this);
        sv.postDelayed(() -> IslandService.start(this), 300);
    }

    private GproxyClient client() {
        return new GproxyClient(Cfg.url(this), Cfg.user(this), Cfg.pass(this));
    }

    private static String msg(Exception e) {
        if (e instanceof java.net.ConnectException) return "连不上 gproxy";
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    /** 后台结果回到主线程；页面已经换了就不再更新 */
    private void post(int g, Runnable r) {
        runOnUiThread(() -> {
            if (g == gen && !isFinishing()) r.run();
        });
    }

    // ───────────── 页面切换 ─────────────

    private void open(String p) {
        boolean same = p.equals(page);
        int keepY = same ? sv.getScrollY() : 0;
        if (!same) applyRestart();
        page = p;
        gen++;
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(20), dp(16), dp(32));
        sv.removeAllViews();
        sv.addView(box, new ScrollView.LayoutParams(MATCH, WRAP));
        switch (p) {
            case "conn": pageConn(); break;
            case "look": pageLook(); break;
            case "budget": pageBudget(); break;
            case "refresh": pageRefresh(); break;
            case "live": pageLive(); break;
            case "proxy": pageProxy(); break;
            case "quota": pageQuota(); break;
            case "update": pageUpdate(); break;
            default: pageHome();
        }
        sv.post(() -> sv.scrollTo(0, keepY));
    }

    // ───────────── 小部件 ─────────────

    private TextView label(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
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

    private LinearLayout vcol() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private static LinearLayout.LayoutParams lp(int w, int h, float weight) {
        return new LinearLayout.LayoutParams(w, h, weight);
    }

    private void add(LinearLayout parent, View v, int top) {
        LinearLayout.LayoutParams p = lp(MATCH, WRAP, 0);
        p.topMargin = top;
        parent.addView(v, p);
    }

    /** 分页顶部：返回箭头 + 标题 */
    private LinearLayout header(String title) {
        LinearLayout h = hrow();
        Ui.Chevron back = new Ui.Chevron(this, true, Ui.FG);
        back.setContentDescription("返回");
        back.setOnClickListener(v -> open(HOME));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(dp(44), dp(44));
        bp.leftMargin = -dp(12);
        h.addView(back, bp);
        h.addView(label(title, 20, Ui.FG, true), lp(0, WRAP, 1));
        box.addView(h, lp(MATCH, WRAP, 0));
        return h;
    }

    private TextView note(LinearLayout parent, String s, int color, int top) {
        TextView t = label(s, 12, color, false);
        t.setLineSpacing(0, 1.3f);
        t.setPadding(dp(4), 0, dp(4), 0);
        add(parent, t, top);
        return t;
    }

    /** 分组：小标题 + 一张圆角卡片，返回卡片 */
    private LinearLayout group(String caption) {
        if (caption != null) {
            TextView c = label(caption, 12, Ui.MUTED, true);
            c.setLetterSpacing(0.06f);
            c.setPadding(dp(4), 0, 0, 0);
            add(box, c, dp(22));
        }
        LinearLayout card = vcol();
        card.setBackground(Ui.round(Ui.CARD, dp(20)));
        card.setPadding(dp(16), 0, dp(16), 0);
        add(box, card, caption != null ? dp(8) : dp(16));
        return card;
    }

    /** 卡片里从第二行起，上面加一条分隔线 */
    private void divider(LinearLayout card) {
        if (card.getChildCount() == 0) return;
        View d = new View(this);
        d.setBackgroundColor(Ui.LINE);
        card.addView(d, lp(MATCH, Math.max(1, dp(1)), 0));
    }

    /** 列表行：标题 + 当前值 + 箭头。返回显示当前值的那行字，方便后台结果回来时更新 */
    private TextView row(LinearLayout card, String title, String summary, Runnable onClick) {
        divider(card);
        LinearLayout r = hrow();
        r.setMinimumHeight(dp(62));
        r.setPadding(0, dp(10), 0, dp(10));
        LinearLayout col = vcol();
        col.addView(label(title, 15, Ui.FG, false));
        TextView s = label(summary, 12, Ui.MUTED, false);
        s.setPadding(0, dp(2), 0, 0);
        col.addView(s);
        r.addView(col, lp(0, WRAP, 1));
        if (onClick != null) {
            r.addView(new Ui.Chevron(this, false, 0xFF6E6C66), new LinearLayout.LayoutParams(dp(20), dp(20)));
            r.setOnClickListener(v -> onClick.run());
        }
        card.addView(r, lp(MATCH, WRAP, 0));
        return s;
    }

    interface OnBool {
        void on(boolean v);
    }

    private Switch toggle(boolean on, OnBool cb) {
        Switch s = new Switch(this);
        s.setChecked(on);
        int[][] states = {{android.R.attr.state_checked}, {}};
        s.setThumbTintList(new android.content.res.ColorStateList(states, new int[]{Ui.GREEN, Ui.MUTED}));
        s.setTrackTintList(new android.content.res.ColorStateList(states, new int[]{0xFF2F6B58, Ui.TRACK}));
        s.setMinHeight(dp(44));
        s.setOnCheckedChangeListener((v, c) -> cb.on(c));
        return s;
    }

    /** 开关行：标题 + 说明 + 开关 */
    private Switch switchRow(LinearLayout card, String title, String summary, boolean on, OnBool cb) {
        divider(card);
        LinearLayout r = hrow();
        r.setMinimumHeight(dp(62));
        r.setPadding(0, dp(10), 0, dp(10));
        LinearLayout col = vcol();
        col.addView(label(title, 15, Ui.FG, false));
        if (summary != null) {
            TextView s = label(summary, 12, Ui.MUTED, false);
            s.setPadding(0, dp(2), dp(8), 0);
            col.addView(s);
        }
        r.addView(col, lp(0, WRAP, 1));
        Switch sw = toggle(on, cb);
        r.addView(sw);
        r.setOnClickListener(v -> sw.toggle());
        card.addView(r, lp(MATCH, WRAP, 0));
        return sw;
    }

    interface OnText {
        void on(String s);
    }

    /** 输入框：上面一行名字，改了就回调（即时保存） */
    private EditText input(LinearLayout parent, String name, String value, int type, OnText cb) {
        TextView l = label(name, 13, Ui.MUTED, false);
        l.setPadding(0, 0, 0, dp(6));
        add(parent, l, dp(14));
        EditText e = new EditText(this);
        e.setText(value);
        e.setInputType(type);
        e.setTextColor(Ui.FG);
        e.setHintTextColor(0xFF6E6C66);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        e.setSingleLine(true);
        e.setBackground(Ui.round(Ui.CARD2, dp(12)));
        e.setPadding(dp(12), dp(12), dp(12), dp(12));
        e.setMinHeight(dp(46));
        e.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {
            }

            @Override
            public void onTextChanged(CharSequence s, int a, int b, int c) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                cb.on(s.toString());
            }
        });
        parent.addView(e, lp(MATCH, WRAP, 0));
        return e;
    }

    private TextView button(LinearLayout parent, String text, boolean primary, int top, Runnable onClick) {
        TextView b = label(text, 14, primary ? Color.BLACK : Ui.FG, true);
        b.setGravity(Gravity.CENTER);
        GradientDrawable g = Ui.round(primary ? Ui.GREEN : Color.TRANSPARENT, dp(23));
        if (!primary) g.setStroke(Math.max(1, dp(1)), 0xFF3A3D44);
        b.setBackground(g);
        b.setPadding(dp(18), 0, dp(18), 0);
        b.setOnClickListener(v -> onClick.run());
        LinearLayout.LayoutParams p = lp(MATCH, dp(46), 0);
        p.topMargin = top;
        parent.addView(b, p);
        return b;
    }

    /** 状态小标签：ok = 绿色对勾，否则黄色提醒，可点 */
    private void chip(Ui.Flow flow, String text, boolean ok, Runnable onClick) {
        LinearLayout c = hrow();
        c.setBackground(Ui.round(ok ? Ui.CARD2 : Ui.AMBER_BG, dp(16)));
        c.setPadding(dp(8), 0, dp(12), 0);
        c.setMinimumHeight(dp(32));
        Ui.Glyph g = new Ui.Glyph(this);
        g.set(ok ? Ui.Glyph.CHECK : Ui.Glyph.DOT, ok ? Ui.GREEN : Ui.AMBER, 0);
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(dp(14), dp(14));
        gp.rightMargin = dp(6);
        c.addView(g, gp);
        c.addView(label(text, 12, ok ? Ui.FG : Ui.AMBER, false));
        if (onClick != null) c.setOnClickListener(v -> onClick.run());
        flow.addView(c, new android.view.ViewGroup.LayoutParams(WRAP, WRAP));
    }

    private void openAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {
        }
    }

    private void openOverlaySettings() {
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {
        }
    }

    private static int parse(String s, int def) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private static float parseF(String s) {
        try {
            return Float.parseFloat(s.trim());
        } catch (Exception e) {
            return 0f;
        }
    }

    private static String trim(float f) {
        String s = String.valueOf(f);
        return s.endsWith(".0") ? s.substring(0, s.length() - 2) : s;
    }

    // ───────────── 首页 ─────────────

    private void pageHome() {
        final int g = gen;
        int cur = Updater.current(this);
        boolean hasNew = latest != null && latest.build > cur;

        LinearLayout top = hrow();
        top.addView(label("gproxy 岛", 24, Ui.FG, true), lp(0, WRAP, 1));
        TextView ver = label(hasNew ? "有新版 build " + latest.build : "build " + cur + (latest != null ? " · 已是最新" : ""),
                12, hasNew ? Color.BLACK : Ui.SOFT, hasNew);
        ver.setBackground(Ui.round(hasNew ? Ui.GREEN : Ui.CARD, dp(16)));
        ver.setGravity(Gravity.CENTER);
        ver.setPadding(dp(12), 0, dp(12), 0);
        ver.setMinHeight(dp(32));
        ver.setOnClickListener(v -> open("update"));
        top.addView(ver);
        box.addView(top, lp(MATCH, WRAP, 0));

        // ── 状态卡：岛的预览、总开关、权限 ──
        LinearLayout card = vcol();
        card.setBackground(Ui.round(Ui.CARD, dp(20)));
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        add(box, card, dp(18));

        LinearLayout strip = hrow();
        strip.setGravity(Gravity.CENTER);
        strip.setBackground(Ui.round(Ui.STRIP, dp(14)));
        LinearLayout pill = hrow();
        pill.setBackground(Ui.round(Color.BLACK, dp(18)));
        pill.setPadding(dp(9), dp(8), dp(14), dp(8));
        Ui.Glyph pg = new Ui.Glyph(this);
        LinearLayout.LayoutParams pgp = new LinearLayout.LayoutParams(dp(20), dp(20));
        pgp.rightMargin = dp(9);
        pill.addView(pg, pgp);
        TextView pMain = label("连接中…", 14, Ui.FG, true);
        pMain.setSingleLine(true);
        pMain.setEllipsize(TextUtils.TruncateAt.END);
        pMain.setMaxWidth(dp(210));
        pill.addView(pMain);
        TextView pSide = label("", 14, Ui.MUTED, false);
        pSide.setPadding(dp(10), 0, 0, 0);
        pill.addView(pSide);
        strip.addView(pill);
        card.addView(strip, lp(MATCH, dp(76), 0));

        boolean running = IslandService.running;
        boolean can = Settings.canDrawOverlays(this);
        LinearLayout sw = hrow();
        LinearLayout col = vcol();
        col.addView(label("悬浮岛", 17, Ui.FG, true));
        TextView state = label(running ? "运行中" : "未开启", 13, running ? Ui.GREEN : Ui.MUTED, false);
        state.setPadding(0, dp(2), 0, 0);
        col.addView(state);
        sw.addView(col, lp(0, WRAP, 1));
        sw.addView(toggle(running, on -> {
            if (on) {
                if (!Settings.canDrawOverlays(this)) {
                    state.setTextColor(Ui.RED_SOFT);
                    state.setText("先给悬浮窗权限，再回来打开");
                    openOverlaySettings();
                    sv.postDelayed(() -> open(HOME), 600);
                    return;
                }
                sp().edit().putBoolean("enabled", true).apply();
                IslandService.start(this);
            } else {
                sp().edit().putBoolean("enabled", false).apply();
                IslandService.stop(this);
            }
            sv.postDelayed(() -> open(HOME), 350);
        }));
        add(card, sw, dp(14));

        Ui.Flow chips = new Ui.Flow(this, dp(8));
        chip(chips, can ? "悬浮窗权限" : "没有悬浮窗权限 · 去授权", can, this::openOverlaySettings);
        if (Cfg.proxyCheck(this)) {
            boolean nl = Cfg.listenerGranted(this);
            chip(chips, nl ? "通知使用权" : "没给通知使用权 · 去授权", nl, this::openListenerSettings);
        }
        boolean power = true;
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            power = pm == null || pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception ignored) {
        }
        if (!power) chip(chips, "省电策略可能会停掉岛 · 去设置", false, this::openAppSettings);
        add(card, chips, dp(12));

        // ── 基本 ──
        LinearLayout basic = group("基本");
        String url = Cfg.url(this).replaceFirst("^https?://", "");
        TextView connSum = row(basic, "连接", url + " · " + Cfg.user(this), () -> open("conn"));
        row(basic, "外观与位置", "大小 " + Cfg.scale(this) + "% · " + (Cfg.draggable(this) ? "可拖动" : "已锁定"), () -> open("look"));
        float budget = Cfg.budget(this);
        row(basic, "预算与提醒", (budget > 0 ? "每日 " + Cfg.money(budget) : "没设预算")
                + " · 完成提示" + (Cfg.pop(this) ? "开" : "关") + " · 震动" + (Cfg.vibrate(this) ? "开" : "关"), () -> open("budget"));
        row(basic, "刷新", "空闲每 " + Cfg.interval(this) + " 秒 · 展开显示最近 " + Cfg.recent(this) + " 次", () -> open("refresh"));

        // ── 监控 ──
        LinearLayout mon = group("监控");
        TextView liveSum = row(mon, "「生成中」检测", "需要 gproxy 打开上游日志和正文", () -> open("live"));
        String allowed = Cfg.allowedNodes(this).trim();
        int nAllowed = allowed.isEmpty() ? 0 : allowed.split("\n").length;
        row(mon, "代理检测", Cfg.proxyCheck(this)
                ? "已开" + (nAllowed > 0 ? " · 指定了 " + nAllowed + " 个节点" : " · 不限节点") : "没开", () -> open("proxy"));
        row(mon, "上游额度", "各凭据用了多少、什么时候重置" + (Cfg.naiKey(this).isEmpty() ? "" : " · NovelAI"), () -> open("quota"));

        // ── 其他 ──
        LinearLayout other = group("其他");
        row(other, "检查更新", hasNew ? "有新版 build " + latest.build : "当前 build " + cur, () -> open("update"));
        switchRow(other, "调试信息", "展开岛后长按，显示刷新次数和错误", Cfg.debug(this),
                on -> sp().edit().putBoolean("debug", on).apply());
        row(other, "系统设置", "自启动、省电策略、通知", this::openAppSettings);

        note(box, "改动即时保存。小米手机建议把本应用的「省电策略」设为「无限制」，否则锁屏久了可能被系统停掉；熄屏时岛会自动暂停刷新。", Ui.MUTED, dp(18));

        // 后台连一次 gproxy：预览里显示真实的今日花费，顺便看上游日志开没开
        if (Cfg.pass(this).isEmpty()) {
            pg.set(Ui.Glyph.DOT, Ui.GREY, 0);
            pMain.setText("还没填管理员密码");
            connSum.setTextColor(Ui.AMBER);
            connSum.setText("还没填管理员密码，点这里填");
            return;
        }
        final GproxyClient c = client();
        new Thread(() -> {
            try {
                GproxyClient.Summary s = c.today();
                post(g, () -> {
                    double ratio = budget > 0 ? s.cost / budget : -1;
                    if (ratio >= 0) pg.set(Ui.Glyph.RING, ratio >= 1 ? Ui.RED : ratio >= 0.8 ? Ui.AMBER : Ui.GREEN, (float) Math.min(1, ratio));
                    else pg.set(Ui.Glyph.DOT, Ui.GREEN, 0);
                    pMain.setText(Cfg.money(s.cost));
                    pSide.setText("|  " + s.requests + " 次");
                    pSide.setTextColor(Ui.MUTED);
                    if (IslandService.running) state.setText("运行中 · 已连上 gproxy");
                });
                try {
                    GproxyClient.LogFlags f = c.logFlags();
                    post(g, () -> {
                        liveSum.setTextColor(f.live() ? Ui.GREEN : Ui.AMBER);
                        liveSum.setText(f.live() ? "上游日志和正文已开，可用" : "不可用：gproxy 没开" + (f.upstream ? "上游日志正文" : "上游日志和正文"));
                    });
                } catch (Exception ignored) {
                }
            } catch (Exception e) {
                post(g, () -> {
                    pg.set(Ui.Glyph.DOT, Ui.RED, 0);
                    pMain.setText(msg(e));
                    pSide.setText("");
                    connSum.setTextColor(Ui.RED_SOFT);
                    connSum.setText(msg(e));
                    if (IslandService.running) {
                        state.setTextColor(Ui.RED_SOFT);
                        state.setText("运行中 · " + msg(e));
                    }
                });
            }
        }).start();
    }

    // ───────────── 连接 ─────────────

    private void pageConn() {
        header("连接");
        LinearLayout card = group(null);
        card.setPadding(dp(16), dp(2), dp(16), dp(16));
        input(card, "gproxy 地址", Cfg.url(this), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI, s -> {
            sp().edit().putString("url", s.trim()).apply();
            needRestart = true;
        });
        input(card, "管理员用户名", Cfg.user(this), InputType.TYPE_CLASS_TEXT, s -> {
            sp().edit().putString("user", s.trim()).apply();
            needRestart = true;
        });
        input(card, "管理员密码", Cfg.pass(this), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, s -> {
            sp().edit().putString("pass", s).apply();
            needRestart = true;
        });
        TextView result = note(box, "", Ui.MUTED, dp(14));
        button(box, "测试连接", true, dp(8), () -> testConnection(result));
        note(box, "地址和账号改完返回上一页，岛会自动重启用上新设置。密码只存在本机。", Ui.MUTED, dp(14));
    }

    private void testConnection(TextView result) {
        final int g = gen;
        result.setTextColor(Ui.MUTED);
        result.setText("连接中…");
        final GproxyClient c = client();
        new Thread(() -> {
            String m;
            boolean ok = false;
            try {
                GproxyClient.Summary s = c.today();
                m = "连接成功：今日 " + s.requests + " 次 · " + Cfg.money(s.cost)
                        + " · 入 " + Cfg.w(s.input) + " · 出 " + Cfg.w(s.output);
                ok = true;
                try {
                    GproxyClient.LogFlags f = c.logFlags();
                    m += f.live() ? "\n上游日志 + 正文已开，「生成中」可用"
                            : "\n「生成中」不可用：gproxy 没开" + (f.upstream ? "「上游日志正文」" : "「上游日志」和「上游日志正文」")
                            + "，到首页「生成中检测」里一键打开";
                } catch (Exception e) {
                    m += "\n读不到 gproxy 日志设置：" + e.getMessage();
                }
                try {
                    c.inflight();
                } catch (Exception e) {
                    m += "\n读不到上游日志：" + e.getMessage();
                }
            } catch (java.net.ConnectException e) {
                m = "连不上：gproxy 没在运行，或地址/端口不对";
            } catch (Exception e) {
                m = "失败：" + (e.getMessage() == null ? e.toString() : e.getMessage());
            }
            final String fm = m;
            final boolean good = ok;
            post(g, () -> {
                result.setTextColor(good ? Ui.GREEN : Ui.RED_SOFT);
                result.setText(fm);
            });
        }).start();
    }

    // ───────────── 外观与位置 ─────────────

    private void pageLook() {
        header("外观与位置");
        LinearLayout card = group(null);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        TextView scaleLabel = label("悬浮岛大小：" + Cfg.scale(this) + "%", 15, Ui.FG, false);
        card.addView(scaleLabel);
        SeekBar scale = new SeekBar(this);
        scale.setMax((140 - 60) / 5);
        scale.setProgress((Cfg.scale(this) - 60) / 5);
        scale.setProgressTintList(android.content.res.ColorStateList.valueOf(Ui.GREEN));
        scale.setThumbTintList(android.content.res.ColorStateList.valueOf(Ui.GREEN));
        scale.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar s, int p, boolean user) {
                scaleLabel.setText("悬浮岛大小：" + (60 + p * 5) + "%");
            }

            @Override
            public void onStartTrackingTouch(SeekBar s) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar s) {
                // 松手立即生效，方便边调边看
                sp().edit().putInt("scale", 60 + s.getProgress() * 5).apply();
                restartIsland();
            }
        });
        add(card, scale, dp(10));
        LinearLayout.LayoutParams slp = (LinearLayout.LayoutParams) scale.getLayoutParams();
        slp.height = dp(44);
        TextView hint = label("60% ~ 140%，松手立即生效", 12, Ui.MUTED, false);
        card.addView(hint);

        LinearLayout pos = group("位置");
        switchRow(pos, "解锁位置", "打开后可以拖动悬浮岛；拖好再关掉，就锁在那里", Cfg.draggable(this), on -> {
            sp().edit().putBoolean("drag", on).apply();
            restartIsland();
        });
        TextView done = note(box, "", Ui.MUTED, dp(12));
        button(box, "位置复原（回到顶部居中）", false, dp(8), () -> {
            sp().edit().remove("x").remove("y").remove("anchor").remove("gap").apply();
            restartIsland();
            done.setText("位置已复原");
        });
        note(box, "状态栏区域是系统下拉手势区，岛放进去会点不到，所以最高只能到状态栏下沿。", Ui.MUTED, dp(14));
    }

    // ───────────── 预算与提醒 ─────────────

    private void pageBudget() {
        header("预算与提醒");
        LinearLayout card = group(null);
        card.setPadding(dp(16), dp(2), dp(16), dp(16));
        float b0 = Cfg.budget(this);
        input(card, "每日预算（美元，0 = 不提醒）", b0 > 0 ? trim(b0) : "0",
                InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL,
                s -> sp().edit().putFloat("budget", Math.max(0f, parseF(s))).apply());
        note(box, "设了预算后，岛上的圆点会变成进度环。用到 80% 变黄，超了变红，各提醒一次。", Ui.MUTED, dp(12));
        LinearLayout sw = group("提醒");
        switchRow(sw, "完成 / 失败提示", "请求结束时岛上显示 15 秒结果", Cfg.pop(this),
                on -> sp().edit().putBoolean("pop", on).apply());
        switchRow(sw, "震动", "预算提醒、请求失败、代理异常时震动", Cfg.vibrate(this),
                on -> sp().edit().putBoolean("vibrate", on).apply());
    }

    // ───────────── 刷新 ─────────────

    private void pageRefresh() {
        header("刷新");
        LinearLayout card = group(null);
        card.setPadding(dp(16), dp(2), dp(16), dp(16));
        input(card, "空闲时刷新间隔（秒，3 ~ 120）", String.valueOf(Cfg.interval(this)), InputType.TYPE_CLASS_NUMBER,
                s -> sp().edit().putInt("interval2", Math.max(3, Math.min(120, parse(s, 5)))).apply());
        input(card, "展开后显示最近几次（0 ~ 10）", String.valueOf(Cfg.recent(this)), InputType.TYPE_CLASS_NUMBER, s -> {
            sp().edit().putInt("recent", Math.max(0, Math.min(10, parse(s, 3)))).apply();
            // 条数变了要重新拉列表，不然多出来的旧记录会被当成新完成的
            needRestart = true;
        });
        note(box, "有请求在跑或刚跑完的 20 秒内，会自动加快到每 2 秒一次。熄屏时暂停刷新，不额外耗电。", Ui.MUTED, dp(12));
    }

    // ───────────── 「生成中」检测 ─────────────

    private void pageLive() {
        final int g = gen;
        header("「生成中」检测");
        LinearLayout card = group(null);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        TextView state = label("正在读取 gproxy 设置…", 15, Ui.MUTED, true);
        card.addView(state);
        TextView detail = label("", 13, Ui.MUTED, false);
        detail.setPadding(0, dp(4), 0, 0);
        card.addView(detail);
        TextView btn = button(box, "一键打开上游日志 + 正文", true, dp(14), () -> {
        });
        note(box, "想看到「生成中」：gproxy 要同时打开「上游日志」和「上游日志正文」。只开上游日志时，gproxy 要等请求结束才写记录，进行中看不到。"
                + "正文会占一些存储（gproxy 默认保留 7 天、最多 2GB，可在 gproxy 设置里改）。", Ui.MUTED, dp(14));
        final GproxyClient c = client();
        Runnable[] load = new Runnable[1];
        load[0] = () -> new Thread(() -> {
            try {
                GproxyClient.LogFlags f = c.logFlags();
                post(g, () -> showFlags(state, detail, btn, f));
            } catch (Exception e) {
                post(g, () -> {
                    state.setTextColor(Ui.RED_SOFT);
                    state.setText("读不到 gproxy 设置");
                    detail.setText(msg(e));
                });
            }
        }).start();
        btn.setOnClickListener(v -> {
            state.setTextColor(Ui.MUTED);
            state.setText("正在打开…");
            new Thread(() -> {
                try {
                    GproxyClient.LogFlags f = c.enableLiveLog();
                    post(g, () -> showFlags(state, detail, btn, f));
                } catch (Exception e) {
                    post(g, () -> {
                        state.setTextColor(Ui.RED_SOFT);
                        state.setText("打开失败");
                        detail.setText(msg(e) + "\n可以到 gproxy 控制台「设置 → 日志」手动打开。");
                    });
                }
            }).start();
        });
        load[0].run();
    }

    private void showFlags(TextView state, TextView detail, TextView btn, GproxyClient.LogFlags f) {
        state.setTextColor(f.live() ? Ui.GREEN : Ui.AMBER);
        state.setText(f.live() ? "可用" : "不可用");
        detail.setText("上游日志：" + (f.upstream ? "开" : "关") + " · 上游日志正文：" + (f.upstreamBody ? "开" : "关"));
        btn.setVisibility(f.live() ? View.GONE : View.VISIBLE);
    }

    // ───────────── 代理检测 ─────────────

    private void pageProxy() {
        final int g = gen;
        header("代理检测");
        boolean on = Cfg.proxyCheck(this);
        LinearLayout card = group(null);
        switchRow(card, "检测 NekoBox", "没开或换错节点时，岛变红并震动", on, v -> {
            sp().edit().putBoolean("proxyCheck", v).apply();
            open("proxy");
        });
        if (on) {
            divider(card);
            LinearLayout trio = hrow();
            trio.setPadding(0, dp(12), 0, dp(14));
            TextView[] vals = new TextView[3];
            String[] names = {"状态", "节点", "出口"};
            for (int i = 0; i < 3; i++) {
                LinearLayout cell = vcol();
                cell.setBackground(Ui.round(Ui.CARD2, dp(12)));
                cell.setPadding(dp(12), dp(10), dp(12), dp(10));
                cell.addView(label(names[i], 11, Ui.MUTED, false));
                vals[i] = label("…", 14, Ui.FG, true);
                vals[i].setSingleLine(true);
                vals[i].setEllipsize(TextUtils.TruncateAt.END);
                vals[i].setPadding(0, dp(3), 0, 0);
                cell.addView(vals[i]);
                LinearLayout.LayoutParams cp = lp(0, WRAP, 1);
                if (i > 0) cp.leftMargin = dp(8);
                trio.addView(cell, cp);
            }
            card.addView(trio, lp(MATCH, WRAP, 0));
            new Thread(() -> {
                ProxyCheck.State s = ProxyCheck.check(this);
                post(g, () -> {
                    vals[0].setText(!s.on() ? "没开" : s.wrongNode ? "节点不对" : "已开");
                    vals[0].setTextColor(s.ok() ? Ui.GREEN : Ui.RED_SOFT);
                    vals[1].setText(s.node != null ? s.node : s.nodeType != null ? s.nodeType : "读不到");
                    vals[2].setText(s.exit != null ? s.exit : "读不到");
                });
            }).start();
        }

        // ── 指定节点 ──
        LinearLayout allow = group("指定节点");
        allow.setPadding(dp(16), dp(16), dp(16), dp(16));
        Ui.Flow tags = new Ui.Flow(this, dp(8));
        List<String> nodes = lines(Cfg.allowedNodes(this));
        for (String n : nodes) {
            tags.addView(tag(n + "  ×", false, () -> {
                List<String> left = lines(Cfg.allowedNodes(this));
                left.remove(n);
                sp().edit().putString("allowedNodes", TextUtils.join("\n", left)).apply();
                open("proxy");
            }));
        }
        tags.addView(tag("+ 添加", true, () -> ask("添加指定节点", "节点名的一部分，或出口国家如「美国」", null, null, (a, b) -> {
            if (a.isEmpty()) return;
            List<String> all = lines(Cfg.allowedNodes(this));
            if (!all.contains(a)) all.add(a);
            sp().edit().putString("allowedNodes", TextUtils.join("\n", all)).apply();
            open("proxy");
        })));
        allow.addView(tags, lp(MATCH, WRAP, 0));
        TextView at = label(nodes.isEmpty() ? "现在不检查节点。加上之后，换到别的节点岛会变红并提醒。"
                : "点标签删除。写节点名的一部分、改后的名字或出口国家都行。", 12, Ui.MUTED, false);
        at.setLineSpacing(0, 1.3f);
        at.setPadding(0, dp(12), 0, 0);
        allow.addView(at);

        // ── 节点改名 ──
        LinearLayout alias = group("节点改名");
        for (String line : lines(Cfg.nodeAlias(this))) {
            int k = line.indexOf('=');
            if (k <= 0) continue;
            String from = line.substring(0, k).trim(), to = line.substring(k + 1).trim();
            divider(alias);
            LinearLayout r = hrow();
            r.setMinimumHeight(dp(56));
            TextView f = label(from, 14, Ui.SOFT, false);
            f.setSingleLine(true);
            f.setEllipsize(TextUtils.TruncateAt.END);
            r.addView(f, lp(0, WRAP, 1));
            r.addView(new Ui.Chevron(this, false, 0xFF6E6C66), new LinearLayout.LayoutParams(dp(20), dp(20)));
            TextView t = label(to, 14, Ui.FG, true);
            t.setGravity(Gravity.END);
            t.setSingleLine(true);
            r.addView(t, lp(dp(96), WRAP, 0));
            r.setOnClickListener(v -> ask("节点改名", "原名（可以只写一部分）", "显示成", new String[]{from, to}, (a, b) -> {
                List<String> all = lines(Cfg.nodeAlias(this));
                all.remove(line);
                if (!a.isEmpty() && !b.isEmpty()) all.add(a + "=" + b);
                sp().edit().putString("nodeAlias", TextUtils.join("\n", all)).apply();
                open("proxy");
            }));
            alias.addView(r, lp(MATCH, WRAP, 0));
        }
        divider(alias);
        String last = Cfg.lastNode(this);
        TextView addAlias = label(last.isEmpty() ? "+ 添加改名" : "+ 给当前节点「" + Cfg.mask(last) + "」改名", 14, Ui.GREEN, true);
        addAlias.setGravity(Gravity.CENTER_VERTICAL);
        addAlias.setMinHeight(dp(56));
        addAlias.setOnClickListener(v -> ask("节点改名", "原名（可以只写一部分）", "显示成",
                new String[]{last, ""}, (a, b) -> {
                    if (a.isEmpty() || b.isEmpty()) return;
                    List<String> all = lines(Cfg.nodeAlias(this));
                    all.add(a + "=" + b);
                    sp().edit().putString("nodeAlias", TextUtils.join("\n", all)).apply();
                    open("proxy");
                }));
        alias.addView(addAlias, lp(MATCH, WRAP, 0));
        note(box, "点一条可以修改，两格都清空就是删除。没改名的节点在岛上只显示前 3 个字，防止截图泄露。", Ui.MUTED, dp(10));

        // ── 读取方式 ──
        LinearLayout how = group("读取方式");
        boolean nl = Cfg.listenerGranted(this);
        TextView nls = row(how, "通知使用权", nl ? "已给，只读 NekoBox 通知的标题（就是节点名）" : "没给，读不到节点名。点这里去授权", this::openListenerSettings);
        nls.setTextColor(nl ? Ui.GREEN : Ui.AMBER);
        divider(how);
        LinearLayout api = vcol();
        api.setPadding(0, 0, 0, dp(16));
        input(api, "Clash API 地址（NekoBox 设置里打开「启用 Clash API」；留空不读）", Cfg.clashApi(this),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI,
                s -> sp().edit().putString("clashApi", s.trim()).apply());
        input(api, "Clash API 密钥（一般留空）", Cfg.clashSecret(this),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                s -> sp().edit().putString("clashSecret", s.trim()).apply());
        how.addView(api, lp(MATCH, WRAP, 0));
    }

    private static List<String> lines(String s) {
        List<String> out = new ArrayList<>();
        for (String l : s.split("\n")) {
            String t = l.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private TextView tag(String text, boolean dashed, Runnable onClick) {
        TextView t = label(text, 14, dashed ? Ui.SOFT : Ui.FG, false);
        GradientDrawable g = Ui.round(dashed ? Color.TRANSPARENT : Ui.CARD2, dp(20));
        if (dashed) g.setStroke(Math.max(1, dp(1)), 0xFF4A4D55, dp(4), dp(3));
        t.setBackground(g);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(14), 0, dp(14), 0);
        t.setMinHeight(dp(40));
        t.setOnClickListener(v -> onClick.run());
        t.setLayoutParams(new android.view.ViewGroup.LayoutParams(WRAP, WRAP));
        return t;
    }

    interface OnTwo {
        void on(String a, String b);
    }

    /** 弹一个填一格或两格的小窗 */
    private void ask(String title, String hintA, String hintB, String[] init, OnTwo cb) {
        LinearLayout v = vcol();
        v.setPadding(dp(20), dp(8), dp(20), 0);
        EditText a = new EditText(this);
        a.setHint(hintA);
        a.setSingleLine(true);
        if (init != null) a.setText(init[0]);
        v.addView(a);
        EditText b = null;
        if (hintB != null) {
            b = new EditText(this);
            b.setHint(hintB);
            b.setSingleLine(true);
            if (init != null) b.setText(init[1]);
            v.addView(b);
        }
        final EditText fb = b;
        new AlertDialog.Builder(this).setTitle(title).setView(v)
                .setPositiveButton("确定", (d, w) -> cb.on(a.getText().toString().trim(), fb == null ? "" : fb.getText().toString().trim()))
                .setNegativeButton("取消", null).show();
    }

    /** 先直接跳到本 App 的通知使用权开关，不行再跳列表，再不行跳应用详情 */
    private void openListenerSettings() {
        Intent[] tries = {
                Build.VERSION.SDK_INT >= 30
                        ? new Intent("android.settings.NOTIFICATION_LISTENER_DETAIL_SETTINGS")
                        .putExtra("android.provider.extra.NOTIFICATION_LISTENER_COMPONENT_NAME",
                                new android.content.ComponentName(this, NodeListener.class).flattenToString())
                        : null,
                new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"),
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())),
        };
        for (Intent i : tries) {
            if (i == null) continue;
            try {
                startActivity(i);
                return;
            } catch (Exception ignored) {
            }
        }
    }

    // ───────────── 上游额度 ─────────────

    private void pageQuota() {
        final int g = gen;
        LinearLayout h = header("上游额度");
        TextView reload = label("刷新", 13, Ui.FG, true);
        GradientDrawable rb = Ui.round(Color.TRANSPARENT, dp(22));
        rb.setStroke(Math.max(1, dp(1)), 0xFF3A3D44);
        reload.setBackground(rb);
        reload.setGravity(Gravity.CENTER);
        reload.setPadding(dp(16), 0, dp(16), 0);
        reload.setOnClickListener(v -> open("quota"));
        h.addView(reload, new LinearLayout.LayoutParams(WRAP, dp(44)));
        note(box, "打开页面只读历史（gproxy 已存的和本机上次查询的），不请求上游。点「查询」才会让 gproxy 去问上游。", Ui.MUTED, dp(6));
        TextView status = note(box, Cfg.pass(this).isEmpty() ? "还没填管理员密码，先到「连接」里填。" : "读取中…", Ui.MUTED, dp(12));
        LinearLayout list = vcol();
        box.addView(list, lp(MATCH, WRAP, 0));

        // ── NovelAI ──
        LinearLayout nai = vcol();
        nai.setBackground(Ui.round(Ui.CARD, dp(20)));
        nai.setPadding(dp(16), dp(16), dp(16), dp(16));
        add(box, nai, dp(12));
        LinearLayout nh = hrow();
        nh.addView(label("NovelAI", 15, Ui.FG, true), lp(0, WRAP, 1));
        LinearLayout nbody = vcol();
        TextView nq = smallButton("查询");
        nh.addView(nq, new LinearLayout.LayoutParams(WRAP, dp(44)));
        nai.addView(nh);
        nai.addView(nbody, lp(MATCH, WRAP, 0));
        showNai(nbody, NaiClient.last(this), null);
        input(nai, "API Key（只用来查额度，留空就不显示；和柏宝绘里填的是同一个）", Cfg.naiKey(this),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                s -> sp().edit().putString("naiKey", s.trim()).apply());
        nq.setOnClickListener(v -> {
            final String key = Cfg.naiKey(this);
            if (key.isEmpty()) {
                showNai(nbody, NaiClient.last(this), "先填 API Key");
                return;
            }
            nq.setEnabled(false);
            nq.setText("查询中…");
            new Thread(() -> {
                NaiClient.Quota q = null;
                String err = null;
                try {
                    q = NaiClient.probe(this, key);
                } catch (Exception e) {
                    err = msg(e);
                }
                final NaiClient.Quota fq = q != null ? q : NaiClient.last(this);
                final String fe = err;
                post(g, () -> {
                    nq.setEnabled(true);
                    nq.setText("查询");
                    showNai(nbody, fq, fe);
                });
            }).start();
        });

        if (Cfg.pass(this).isEmpty()) return;
        final GproxyClient c = client();
        new Thread(() -> {
            try {
                List<GproxyClient.Cred> cs = c.credentials();
                List<GproxyClient.Quota> qs = new ArrayList<>();
                for (GproxyClient.Cred cr : cs) {
                    GproxyClient.Quota hq = null;
                    try {
                        hq = c.quotaHistory(cr.id);
                    } catch (Exception ignored) {
                    }
                    qs.add(Cfg.bestQuota(this, cr.id, hq));
                }
                post(g, () -> {
                    status.setText(cs.isEmpty() ? "gproxy 里没有凭据" : "共 " + cs.size() + " 个凭据");
                    for (int i = 0; i < cs.size(); i++) quotaCard(list, cs.get(i), qs.get(i), g);
                });
            } catch (Exception e) {
                post(g, () -> {
                    status.setTextColor(Ui.RED_SOFT);
                    status.setText("读取失败：" + msg(e));
                });
            }
        }).start();
    }

    private TextView smallButton(String text) {
        TextView b = label(text, 13, Color.BLACK, true);
        b.setBackground(Ui.round(Ui.GREEN, dp(22)));
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(18), 0, dp(18), 0);
        return b;
    }

    /** 一行额度：左边名字，右边数值和说明，下面一条进度条 */
    private void meter(LinearLayout body, String name, String value, int valueColor, String extra, float fill, int color) {
        LinearLayout r = hrow();
        r.addView(label(name, 13, Ui.FG, false), lp(0, WRAP, 1));
        TextView v = label("", 13, Ui.MUTED, false);
        android.text.SpannableStringBuilder sb = new android.text.SpannableStringBuilder(value);
        sb.setSpan(new android.text.style.ForegroundColorSpan(valueColor), 0, sb.length(), 0);
        sb.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), 0, sb.length(), 0);
        if (extra != null) sb.append(" · " + extra);
        v.setText(sb);
        r.addView(v);
        add(body, r, dp(14));
        if (fill >= 0) {
            LinearLayout.LayoutParams bp = lp(MATCH, dp(8), 0);
            bp.topMargin = dp(6);
            body.addView(new Ui.Bar(this).set(fill, color), bp);
        }
    }

    private void warnBox(LinearLayout body, String s, boolean red) {
        TextView t = label(s, 12, red ? Ui.RED_SOFT : Ui.AMBER, false);
        t.setLineSpacing(0, 1.3f);
        t.setBackground(Ui.round(red ? Ui.RED_BG : Ui.AMBER_BG, dp(12)));
        t.setPadding(dp(12), dp(10), dp(12), dp(10));
        add(body, t, dp(8));
    }

    private void quotaCard(LinearLayout list, GproxyClient.Cred cr, GproxyClient.Quota q, int g) {
        LinearLayout card = vcol();
        card.setBackground(Ui.round(Ui.CARD, dp(20)));
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        add(list, card, dp(12));

        LinearLayout top = hrow();
        LinearLayout col = vcol();
        TextView name = label(cr.name, 15, Ui.FG, true);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        col.addView(name);
        TextView sub = label("", 12, Ui.MUTED, false);
        sub.setPadding(0, dp(2), 0, 0);
        col.addView(sub);
        top.addView(col, lp(0, WRAP, 1));
        TextView probe = smallButton("查询");
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(WRAP, dp(44));
        pp.leftMargin = dp(10);
        top.addView(probe, pp);
        card.addView(top);

        LinearLayout body = vcol();
        card.addView(body, lp(MATCH, WRAP, 0));
        String state = !cr.enabled ? "已停用 · " : "dead".equals(cr.status) ? "已失效 · " : "";
        fillQuota(body, sub, state, q, null);

        probe.setOnClickListener(v -> {
            probe.setEnabled(false);
            probe.setText("查询中…");
            final GproxyClient c = client();
            new Thread(() -> {
                GproxyClient.Quota r = null;
                String err = null;
                try {
                    r = c.quotaProbe(cr.id);
                    // 余额类（如 DeepSeek）gproxy 不存历史，只能靠本机记住上次查询结果
                    if (r.raw != null) Cfg.saveProbe(this, cr.id, r.raw);
                } catch (Exception e) {
                    err = msg(e);
                }
                GproxyClient.Quota hq = null;
                try {
                    hq = c.quotaHistory(cr.id);
                } catch (Exception ignored) {
                }
                final GproxyClient.Quota fr = r, fh = hq;
                final String fe = err;
                post(g, () -> {
                    probe.setEnabled(true);
                    probe.setText("查询");
                    GproxyClient.Quota show = fr != null ? fr : Cfg.bestQuota(this, cr.id, fh);
                    if (fr != null && fh != null) fr.blockedUntil = fh.blockedUntil;
                    fillQuota(body, sub, state, show, fe);
                });
            }).start();
        });
    }

    private void fillQuota(LinearLayout body, TextView sub, String state, GproxyClient.Quota q, String err) {
        body.removeAllViews();
        sub.setText(state + (q != null && q.at > 0 ? Cfg.when(q.at) + " 查询" : "还没查询过"));
        if (err != null) warnBox(body, "查询失败：" + err, true);
        if (q == null || q.rows.isEmpty()) {
            TextView t = label(q != null && q.at > 0 ? "上游没返回额度读数" : "还没有查询记录，点「查询」看看", 13, Ui.MUTED, false);
            add(body, t, dp(12));
            return;
        }
        for (GproxyClient.QuotaRow r : q.rows) {
            String v = Cfg.quotaValue(r);
            String extra = null;
            if (r.percent >= 0 && r.used != null && r.limit != null) extra = r.used + "/" + r.limit;
            if (r.percent >= 0 && r.remaining != null) extra = (extra == null ? "" : extra + " · ") + "剩 " + r.remaining;
            if (r.resetAt > 0) extra = (extra == null ? "" : extra + " · ") + Cfg.until(r.resetAt);
            int color = r.percent >= 0 ? Ui.usedColor(r.percent) : Ui.GREEN;
            meter(body, r.name, v == null ? "—" : v, r.percent >= 70 ? (r.percent >= 90 ? Ui.RED_SOFT : Ui.AMBER) : Ui.FG, extra,
                    r.percent >= 0 ? (float) (r.percent / 100.0) : -1, color);
            long ex = Cfg.exhaustAt(r, q.at);
            if (ex > 0) warnBox(body, "按此速度 " + Cfg.day(ex) + " 用完，早于重置（" + Cfg.day(r.resetAt) + "）", false);
        }
        if (q.blockedUntil > System.currentTimeMillis()) {
            warnBox(body, "被上游限流，" + Cfg.when(q.blockedUntil) + " 前不会选用", true);
        }
    }

    private void showNai(LinearLayout body, NaiClient.Quota q, String err) {
        body.removeAllViews();
        if (err != null) warnBox(body, "查询失败：" + err, true);
        if (q == null) {
            add(body, label("还没有查询记录", 13, Ui.MUTED, false), dp(8));
            return;
        }
        String sub = "订阅 " + q.tier + (q.active ? "" : "（未生效）");
        if (q.expiresAt > 0) sub += " · 到 " + new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date(q.expiresAt));
        sub += " · " + Cfg.when(q.at) + " 查询";
        add(body, label(sub, 12, Ui.MUTED, false), dp(2));
        if (q.percent >= 0) {
            meter(body, "V5 免费额度", q.empty ? "已用完" : "剩 " + Math.round(q.percent) + "%", q.empty ? Ui.RED_SOFT : Ui.FG,
                    q.empty ? "再出 V5 会扣 Anlas" : "约 " + Math.round(q.percent * NaiClient.IMAGES_PER_PERCENT) + " 张",
                    q.empty ? 0f : (float) (q.percent / 100.0), q.empty ? Ui.RED : Ui.GREEN);
            String r = NaiClient.refill(q);
            double now = NaiClient.nowPercent(q);
            if (now >= 0 && Math.round(now) > Math.round(q.percent)) r += (r.isEmpty() ? "" : "；") + "按回复速度估计现在约 " + Math.round(now) + "%";
            if (!r.isEmpty()) {
                TextView t = label(r, 12, Ui.MUTED, false);
                add(body, t, dp(6));
            }
        }
        if (q.anlas >= 0) meter(body, "Anlas 余额", NaiClient.anlas(q.anlas), Ui.FG, null, -1, 0);
    }

    // ───────────── 检查更新 ─────────────

    private void pageUpdate() {
        final int g = gen;
        header("检查更新");
        int cur = Updater.current(this);
        LinearLayout card = group(null);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        TextView state = label("当前 build " + cur, 15, Ui.FG, true);
        card.addView(state);
        TextView m = label("", 13, Ui.MUTED, false);
        m.setLineSpacing(0, 1.3f);
        m.setPadding(0, dp(4), 0, 0);
        m.setVisibility(View.GONE);
        m.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence c, int a, int b, int d) {
            }

            public void onTextChanged(CharSequence c, int a, int b, int d) {
            }

            public void afterTextChanged(Editable e) {
                m.setVisibility(e.length() == 0 ? View.GONE : View.VISIBLE);
            }
        });
        card.addView(m);
        TextView btn = button(box, "检查更新", true, dp(14), () -> {
        });
        Runnable[] show = new Runnable[1];
        show[0] = () -> {
            boolean hasNew = latest != null && latest.build > cur;
            state.setText(hasNew ? "有新版 build " + latest.build + "（当前 " + cur + "）" : "当前 build " + cur + (latest != null ? "，已经是最新版" : ""));
            state.setTextColor(hasNew ? Ui.GREEN : Ui.FG);
            btn.setText(hasNew ? "下载并安装 build " + latest.build : "检查更新");
        };
        show[0].run();
        btn.setOnClickListener(v -> {
            if (latest != null && latest.build > cur) {
                if (!Updater.canInstall(this)) {
                    m.setText("先打开「允许安装未知应用」，返回再点一次");
                    return;
                }
                m.setText("下载中…（通知栏看进度）");
                btn.setEnabled(false);
                Updater.download(this, latest, (text, end) -> runOnUiThread(() -> {
                    m.setText(text);
                    if (end) btn.setEnabled(true);
                }));
                return;
            }
            m.setText("检查中…");
            new Thread(() -> {
                try {
                    Updater.Latest l = Updater.latest(this);
                    post(g, () -> {
                        latest = l;
                        m.setText("");
                        show[0].run();
                    });
                } catch (Exception e) {
                    post(g, () -> m.setText("检查失败：" + e.getMessage()));
                }
            }).start();
        });
        note(box, "先直连 GitHub 下载，20 秒没动静再走镜像；安装前会和 GitHub 上的 SHA-256 比对，对不上就不装。覆盖安装，设置保留。", Ui.MUTED, dp(14));
        LinearLayout gl = group("备用源");
        gl.setPadding(dp(16), dp(2), dp(16), dp(16));
        input(gl, "GitLab 只读令牌（可不填。GitHub 查不到时才用 GitLab 备份；只存在本机，建一个只勾 read_api 的令牌）",
                Cfg.gitlabToken(this), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                s -> sp().edit().putString("gitlabToken", s.trim()).apply());
    }
}
