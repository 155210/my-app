package com.example.gproxyisland;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/** 设置页：填 gproxy 地址和账号，授权悬浮窗，开关悬浮岛 */
public class MainActivity extends Activity {
    private EditText url, user, pass, interval, recent, budget, naiKey, clashApi, clashSecret, nodeAlias;
    private CheckBox proxyCheck;
    private TextView naiText;
    private Button naiProbe;
    private CheckBox pop, vibrate, drag, debug;
    private TextView status, testResult, logState;
    private LinearLayout quotaBox;
    private TextView quotaMsg;
    private Button toggle;

    private static final int FG = 0xFFF1EFE8, MUTED = 0xFFB4B2A9, ACCENT = 0xFF5DCAA5;

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        ScrollView sv = new ScrollView(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(28), dp(20), dp(28));
        sv.addView(box);

        TextView title = label("gproxy 岛", 22, FG);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(title);
        TextView sub = label("在屏幕顶部显示 gproxy 今日用量。请求进行中黄灯闪烁并计时，完成亮绿灯，失败亮红灯。点一下展开看详情。", 13, MUTED);
        sub.setPadding(0, dp(6), 0, dp(18));
        box.addView(sub);

        Button upd = button(box, "检查更新（当前 build " + Updater.current(this) + "）", false);
        TextView updMsg = label("", 12, MUTED);
        box.addView(updMsg);
        upd.setOnClickListener(v -> checkUpdate(upd, updMsg, true));
        checkUpdate(upd, updMsg, false);
        new Thread(() -> Updater.cleanup(this)).start();

        url = field(box, "gproxy 地址", Cfg.url(this), InputType.TYPE_TEXT_VARIATION_URI);
        user = field(box, "管理员用户名", Cfg.user(this), InputType.TYPE_CLASS_TEXT);
        pass = field(box, "管理员密码", Cfg.pass(this),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        float b0 = Cfg.budget(this);
        budget = field(box, "每日预算（美元，0 = 不提醒；用到 80% 变黄，超了变红）",
                b0 > 0 ? trim(b0) : "0", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        interval = field(box, "空闲时刷新间隔（秒，3~120，默认 5；有请求时自动每 2 秒）",
                String.valueOf(Cfg.interval(this)), InputType.TYPE_CLASS_NUMBER);
        recent = field(box, "展开后显示最近几次（0~10）", String.valueOf(Cfg.recent(this)), InputType.TYPE_CLASS_NUMBER);

        pop = check(box, "请求完成/失败时胶囊短暂提示（绿灯/红灯）", Cfg.pop(this));
        vibrate = check(box, "预算提醒和请求失败时震动", Cfg.vibrate(this));
        drag = check(box, "解锁位置，允许拖动悬浮岛（不勾 = 锁定在顶部居中）", Cfg.draggable(this));
        proxyCheck = check(box, "检测代理（NekoBox）有没有开，没开岛变红并震动提醒", Cfg.proxyCheck(this));
        Button nl = button(box, "给通知使用权（只读 NekoBox 通知标题 = 节点名）", false);
        nl.setOnClickListener(v -> openListenerSettings());
        clashApi = field(box, "NekoBox Clash API 地址（看当前节点用；要在 NekoBox 设置里打开「启用 Clash API」，留空不读节点）",
                Cfg.clashApi(this), InputType.TYPE_TEXT_VARIATION_URI);
        clashSecret = field(box, "Clash API 密钥（一般留空）", Cfg.clashSecret(this),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        String last = Cfg.lastNode(this);
        nodeAlias = field(box, "节点改名（每行一条「原名=新名」；原名可以只写一部分）。没改名的节点岛上只显示前 3 个字",
                Cfg.nodeAlias(this), InputType.TYPE_CLASS_TEXT);
        nodeAlias.setSingleLine(false);
        nodeAlias.setMinLines(2);
        nodeAlias.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        nodeAlias.setHint("例：香港 IEPL 01=港1");
        if (!last.isEmpty()) {
            TextView ln = label("最近读到的节点：" + Cfg.mask(last) + "（点一下显示全名）", 12, MUTED);
            ln.setPadding(0, dp(4), 0, 0);
            boolean[] shown = {false};
            ln.setOnClickListener(v -> {
                shown[0] = !shown[0];
                ln.setText("最近读到的节点：" + (shown[0] ? last : Cfg.mask(last) + "（点一下显示全名）"));
            });
            box.addView(ln);
        }
        debug = check(box, "展开时显示调试信息（刷新次数、最新记录、上游日志开关、错误）", Cfg.debug(this));

        TextView logTip = label("想看到「生成中」：gproxy 要同时打开「上游日志」和「上游日志正文」。"
                + "只开上游日志时，gproxy 要等请求结束才写记录，进行中看不到。"
                + "正文会占一些存储（gproxy 默认保留 7 天、最多 2GB，可在 gproxy 设置里改）。", 12, MUTED);
        logTip.setPadding(0, dp(4), 0, dp(4));
        box.addView(logTip);
        logState = label("", 13, MUTED);
        box.addView(logState);
        Button enableLog = button(box, "一键打开 gproxy 上游日志 + 正文", false);
        enableLog.setOnClickListener(v -> enableLog());

        Button test = button(box, "测试连接", false);
        testResult = label("", 13, MUTED);
        testResult.setPadding(0, dp(6), 0, dp(6));
        box.addView(testResult);
        test.setOnClickListener(v -> testConnection());

        status = label("", 13, MUTED);
        status.setPadding(0, dp(18), 0, dp(8));
        box.addView(status);

        Button perm = button(box, "授予悬浮窗权限", false);
        perm.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName()))));

        toggle = button(box, "", true);
        toggle.setOnClickListener(v -> {
            if (IslandService.running) {
                Cfg.sp(this).edit().putBoolean("enabled", false).apply();
                IslandService.stop(this);
                toggle.postDelayed(this::refresh, 300);
            } else {
                save();
                if (!Settings.canDrawOverlays(this)) {
                    status.setText("还没有悬浮窗权限：点上面的「授予悬浮窗权限」，在设置里打开开关后再回来。");
                    status.setTextColor(0xFFF09595);
                    return;
                }
                Cfg.sp(this).edit().putBoolean("enabled", true).apply();
                IslandService.start(this);
                toggle.postDelayed(this::refresh, 300);
            }
        });

        Button apply = button(box, "保存设置并重启悬浮岛", false);
        apply.setOnClickListener(v -> {
            save();
            if (IslandService.running) {
                IslandService.stop(this);
                toggle.postDelayed(() -> {
                    IslandService.start(this);
                    toggle.postDelayed(this::refresh, 300);
                }, 300);
            }
            testResult.setText("已保存");
        });

        Button reset = button(box, "悬浮岛位置复原（解锁拖动后用）", false);
        reset.setOnClickListener(v -> {
            Cfg.sp(this).edit().remove("x").remove("y").apply();
            if (IslandService.running) {
                IslandService.stop(this);
                toggle.postDelayed(() -> {
                    IslandService.start(this);
                    toggle.postDelayed(this::refresh, 300);
                }, 300);
            }
            testResult.setTextColor(MUTED);
            testResult.setText("位置已复原");
        });

        Button app = button(box, "打开本应用的系统设置（自启动、省电策略）", false);
        app.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()))));

        TextView qt = label("上游额度", 17, FG);
        qt.setTypeface(Typeface.DEFAULT_BOLD);
        qt.setPadding(0, dp(24), 0, dp(4));
        box.addView(qt);
        TextView qs = label("打开页面只显示历史读数（gproxy 已存的 + 本机上次查询），不请求上游；"
                + "点某个凭据的「查询」才会让 gproxy 去问上游。", 12, MUTED);
        box.addView(qs);
        Button qr = button(box, "刷新历史（不请求上游）", false);
        qr.setOnClickListener(v -> loadQuota());
        quotaMsg = label("", 13, MUTED);
        quotaMsg.setPadding(0, dp(6), 0, 0);
        box.addView(quotaMsg);
        quotaBox = new LinearLayout(this);
        quotaBox.setOrientation(LinearLayout.VERTICAL);
        box.addView(quotaBox);

        TextView nt = label("NovelAI 额度", 17, FG);
        nt.setTypeface(Typeface.DEFAULT_BOLD);
        nt.setPadding(0, dp(24), 0, dp(4));
        box.addView(nt);
        naiKey = field(box, "NovelAI API Key（只用来查额度，留空就不显示；和柏宝绘里填的是同一个）", Cfg.naiKey(this),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        naiText = label("", 13, FG);
        naiText.setPadding(0, dp(8), 0, 0);
        box.addView(naiText);
        naiProbe = button(box, "查询 NovelAI 额度", false);
        naiProbe.setOnClickListener(v -> probeNai());
        showNai(NaiClient.last(this), null);

        TextView tip = label("小米手机建议：在系统设置里把本应用的「省电策略」设为「无限制」，否则锁屏久了可能被系统停掉。"
                + "熄屏时悬浮岛会自动暂停刷新，不额外耗电。", 12, MUTED);
        tip.setPadding(0, dp(14), 0, 0);
        box.addView(tip);

        setContentView(sv);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
        if (!Cfg.pass(this).isEmpty()) {
            loadQuota();
            checkLog();
        }
    }

    private GproxyClient client() {
        return new GproxyClient(Cfg.url(this), Cfg.user(this), Cfg.pass(this));
    }

    private static String msg(Exception e) {
        if (e instanceof java.net.ConnectException) return "连不上 gproxy";
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    private void showFlags(GproxyClient.LogFlags f) {
        logState.setTextColor(f.live() ? ACCENT : 0xFFEF9F27);
        logState.setText("gproxy 上游日志：" + (f.upstream ? "开" : "关") + " · 上游日志正文：" + (f.upstreamBody ? "开" : "关")
                + (f.live() ? " ✓ 「生成中」可用" : " → 「生成中」不可用"));
    }

    private void checkLog() {
        final GproxyClient c = client();
        new Thread(() -> {
            try {
                GproxyClient.LogFlags f = c.logFlags();
                runOnUiThread(() -> showFlags(f));
            } catch (Exception e) {
                runOnUiThread(() -> logState.setText("读不到 gproxy 设置：" + msg(e)));
            }
        }).start();
    }

    private void enableLog() {
        save();
        logState.setTextColor(MUTED);
        logState.setText("正在打开…");
        final GproxyClient c = client();
        new Thread(() -> {
            try {
                GproxyClient.LogFlags f = c.enableLiveLog();
                runOnUiThread(() -> showFlags(f));
            } catch (Exception e) {
                runOnUiThread(() -> {
                    logState.setTextColor(0xFFF09595);
                    logState.setText("打开失败：" + msg(e) + "\n可以到 gproxy 控制台「设置 → 日志」手动打开。");
                });
            }
        }).start();
    }

    // ───────────── 上游额度 ─────────────

    private void showNai(NaiClient.Quota q, String err) {
        StringBuilder b = new StringBuilder();
        if (err != null) b.append("查询失败：").append(err).append("\n");
        if (q == null) {
            b.append("还没有查询记录");
        } else {
            b.append("订阅：").append(q.tier).append(q.active ? "" : "（未生效）");
            if (q.expiresAt > 0) b.append("（到 ").append(new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                    .format(new java.util.Date(q.expiresAt))).append("）");
            if (q.anlas >= 0) b.append("\nAnlas 余额：").append(NaiClient.anlas(q.anlas));
            if (q.percent >= 0) {
                b.append("\nV5 免费额度：").append(q.empty ? "已用完，再出 V5 会扣 Anlas"
                        : "剩 " + Math.round(q.percent) + "%（约 " + Math.round(q.percent * NaiClient.IMAGES_PER_PERCENT) + " 张）");
                String r = NaiClient.refill(q);
                if (!r.isEmpty()) b.append("\n").append(r);
                double now = NaiClient.nowPercent(q);
                if (now >= 0 && Math.round(now) > Math.round(q.percent)) b.append("\n按回复速度估计现在约 ").append(Math.round(now)).append("%");
            }
            b.append("\n上次查询：").append(Cfg.when(q.at));
        }
        naiText.setTextColor(err != null ? 0xFFF09595 : FG);
        naiText.setText(b.toString());
    }

    private void probeNai() {
        save();
        final String key = Cfg.naiKey(this);
        if (key.isEmpty()) {
            showNai(NaiClient.last(this), "先填 API Key");
            return;
        }
        naiProbe.setEnabled(false);
        naiProbe.setText("查询中…");
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
            runOnUiThread(() -> {
                naiProbe.setEnabled(true);
                naiProbe.setText("查询 NovelAI 额度");
                showNai(fq, fe);
            });
        }).start();
    }

    private void loadQuota() {
        quotaMsg.setTextColor(MUTED);
        quotaMsg.setText("读取中…");
        final GproxyClient c = client();
        new Thread(() -> {
            try {
                List<GproxyClient.Cred> cs = c.credentials();
                List<GproxyClient.Quota> qs = new ArrayList<>();
                for (GproxyClient.Cred cr : cs) {
                    GproxyClient.Quota h = null;
                    try {
                        h = c.quotaHistory(cr.id);
                    } catch (Exception ignored) {
                    }
                    qs.add(Cfg.bestQuota(this, cr.id, h));
                }
                runOnUiThread(() -> {
                    quotaBox.removeAllViews();
                    quotaMsg.setText(cs.isEmpty() ? "gproxy 里没有凭据" : "共 " + cs.size() + " 个凭据");
                    for (int i = 0; i < cs.size(); i++) quotaCard(cs.get(i), qs.get(i));
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    quotaMsg.setTextColor(0xFFF09595);
                    quotaMsg.setText("读取失败：" + msg(e));
                });
            }
        }).start();
    }

    private void quotaCard(GproxyClient.Cred cr, GproxyClient.Quota q) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable g = new GradientDrawable();
        g.setColor(0xFF1E2025);
        g.setCornerRadius(dp(12));
        card.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        quotaBox.addView(card, lp);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView name = label(cr.name + (!cr.enabled ? "（已停用）" : "dead".equals(cr.status) ? "（失效）" : ""), 14, FG);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        top.addView(name, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        Button probe = new Button(this);
        probe.setText("查询");
        probe.setAllCaps(false);
        probe.setTextColor(Color.BLACK);
        GradientDrawable pg = new GradientDrawable();
        pg.setColor(ACCENT);
        pg.setCornerRadius(dp(10));
        probe.setBackground(pg);
        probe.setStateListAnimator(null);
        probe.setMinWidth(0);
        probe.setMinimumWidth(0);
        probe.setPadding(dp(14), 0, dp(14), 0);
        top.addView(probe, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(34)));
        card.addView(top);

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        card.addView(body);
        fillQuota(body, q, null);

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
                GproxyClient.Quota h = null;
                try {
                    h = c.quotaHistory(cr.id);
                } catch (Exception ignored) {
                }
                final GproxyClient.Quota fr = r, fh = h;
                final String fe = err;
                runOnUiThread(() -> {
                    probe.setEnabled(true);
                    probe.setText("查询");
                    GproxyClient.Quota show = fr != null ? fr : Cfg.bestQuota(this, cr.id, fh);
                    if (fr != null && fh != null) fr.blockedUntil = fh.blockedUntil;
                    fillQuota(body, show, fe);
                });
            }).start();
        });
    }

    private void fillQuota(LinearLayout body, GproxyClient.Quota q, String err) {
        body.removeAllViews();
        if (err != null) {
            TextView t = label("查询失败：" + err, 12, 0xFFF09595);
            t.setPadding(0, dp(4), 0, 0);
            body.addView(t);
        }
        if (q == null || q.rows.isEmpty()) {
            TextView t = label(q != null && q.at > 0 ? "上游没返回额度读数（" + Cfg.when(q.at) + " 查询）"
                    : "还没有查询记录，点「查询」看看", 12, MUTED);
            t.setPadding(0, dp(4), 0, 0);
            body.addView(t);
            return;
        }
        for (GproxyClient.QuotaRow r : q.rows) {
            String v = Cfg.quotaValue(r);
            StringBuilder b = new StringBuilder(r.name).append("：").append(v == null ? "—" : v);
            if (r.percent >= 0 && r.used != null && r.limit != null) b.append("（").append(r.used).append("/").append(r.limit).append("）");
            if (r.percent >= 0 && r.remaining != null) b.append(" · 剩 ").append(r.remaining);
            if (r.resetAt > 0) b.append(" · ").append(Cfg.until(r.resetAt)).append("（").append(Cfg.when(r.resetAt)).append("）");
            int color = r.percent >= 90 ? 0xFFF09595 : r.percent >= 70 ? 0xFFEF9F27 : FG;
            TextView t = label(b.toString(), 13, color);
            t.setPadding(0, dp(4), 0, 0);
            body.addView(t);
            long ex = Cfg.exhaustAt(r, q.at);
            if (ex > 0) {
                TextView w = label("　按此速度 " + Cfg.day(ex) + " 用完，早于重置（" + Cfg.day(r.resetAt) + "）", 12, 0xFFEF9F27);
                body.addView(w);
            }
        }
        if (q.blockedUntil > System.currentTimeMillis()) {
            TextView t = label("被上游限流，到 " + Cfg.when(q.blockedUntil) + " 前不会选用", 12, 0xFFF09595);
            t.setPadding(0, dp(4), 0, 0);
            body.addView(t);
        }
        TextView at = label(q.at > 0 ? "上次查询：" + Cfg.when(q.at) : "上次查询：无", 11, MUTED);
        at.setPadding(0, dp(4), 0, 0);
        body.addView(at);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        // 授权回来后，之前开着的自动恢复
        if (Cfg.enabled(this) && !IslandService.running && Settings.canDrawOverlays(this)) {
            IslandService.start(this);
            toggle.postDelayed(this::refresh, 300);
        }
    }

    private void refresh() {
        boolean can = Settings.canDrawOverlays(this);
        status.setTextColor(can ? MUTED : 0xFFF09595);
        status.setText((can ? "悬浮窗权限：已授予" : "悬浮窗权限：未授予")
                + "\n悬浮岛：" + (IslandService.running ? "运行中" : "未开启")
                + "\n通知使用权（读节点名）：" + (listenerOn() ? "已给" : "未给"));
        toggle.setText(IslandService.running ? "关闭悬浮岛" : "开启悬浮岛");
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

    private boolean listenerOn() {
        return Cfg.listenerGranted(this);
    }

    private void save() {
        int iv = parse(interval.getText().toString(), 5);
        int rc = parse(recent.getText().toString(), 3);
        Cfg.sp(this).edit()
                .putString("url", url.getText().toString().trim())
                .putString("user", user.getText().toString().trim())
                .putString("pass", pass.getText().toString())
                .putInt("interval2", Math.max(3, Math.min(120, iv)))
                .putInt("recent", Math.max(0, Math.min(10, rc)))
                .putBoolean("pop", pop.isChecked())
                .putBoolean("vibrate", vibrate.isChecked())
                .putBoolean("drag", drag.isChecked())
                .putBoolean("debug", debug.isChecked())
                .putBoolean("proxyCheck", proxyCheck.isChecked())
                .putString("clashApi", clashApi.getText().toString().trim())
                .putString("clashSecret", clashSecret.getText().toString().trim())
                .putString("nodeAlias", nodeAlias.getText().toString().trim())
                .putFloat("budget", Math.max(0f, parseF(budget.getText().toString())))
                .putString("naiKey", naiKey.getText().toString().trim())
                .apply();
    }

    private void testConnection() {
        save();
        testResult.setTextColor(MUTED);
        testResult.setText("连接中…");
        final GproxyClient c = new GproxyClient(Cfg.url(this), Cfg.user(this), Cfg.pass(this));
        new Thread(() -> {
            String msg;
            boolean ok = false;
            try {
                GproxyClient.Summary s = c.today();
                msg = "连接成功：今日 " + s.requests + " 次 · " + Cfg.money(s.cost)
                        + " · 入 " + Cfg.w(s.input) + " · 出 " + Cfg.w(s.output);
                ok = true;
                try {
                    GproxyClient.LogFlags f = c.logFlags();
                    msg += f.live() ? "\n上游日志 + 正文已开，「生成中」可用"
                            : "\n「生成中」不可用：gproxy 没开" + (f.upstream ? "「上游日志正文」" : "「上游日志」和「上游日志正文」")
                            + "，点上面的「一键打开」";
                    runOnUiThread(() -> showFlags(f));
                } catch (Exception e) {
                    msg += "\n读不到 gproxy 日志设置：" + e.getMessage();
                }
                try {
                    c.inflight();
                } catch (Exception e) {
                    msg += "\n读不到上游日志：" + e.getMessage();
                }
            } catch (java.net.ConnectException e) {
                msg = "连不上：gproxy 没在运行，或地址/端口不对";
            } catch (Exception e) {
                msg = "失败：" + (e.getMessage() == null ? e.toString() : e.getMessage());
            }
            final String m = msg;
            final boolean good = ok;
            runOnUiThread(() -> {
                testResult.setTextColor(good ? ACCENT : 0xFFF09595);
                testResult.setText(m);
            });
        }).start();
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

    private CheckBox check(LinearLayout box, String text, boolean on) {
        CheckBox c = new CheckBox(this);
        c.setText(text);
        c.setTextColor(FG);
        c.setChecked(on);
        c.setPadding(0, dp(4), 0, dp(4));
        box.addView(c);
        return c;
    }

    private static int parse(String s, int def) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private TextView label(String s, float sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        return t;
    }

    private EditText field(LinearLayout box, String name, String value, int type) {
        TextView l = label(name, 13, MUTED);
        l.setPadding(0, dp(10), 0, dp(4));
        box.addView(l);
        EditText e = new EditText(this);
        e.setText(value);
        e.setInputType(type == InputType.TYPE_TEXT_VARIATION_URI
                ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI : type);
        e.setTextColor(FG);
        e.setHintTextColor(MUTED);
        e.setSingleLine(true);
        GradientDrawable g = new GradientDrawable();
        g.setColor(0xFF1E2025);
        g.setCornerRadius(dp(10));
        e.setBackground(g);
        e.setPadding(dp(12), dp(10), dp(12), dp(10));
        box.addView(e, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        return e;
    }

    private Updater.Latest latest;

    /** click=false：打开页面时静默查一次，有新版就把按钮改成「更新」 */
    private void checkUpdate(Button upd, TextView msg, boolean click) {
        int cur = Updater.current(this);
        if (click && latest != null && latest.build > cur) {
            if (!Updater.canInstall(this)) {
                msg.setText("先打开「允许安装未知应用」，返回再点一次");
                return;
            }
            msg.setText("下载中…（通知栏看进度，走 ghfast 代理）");
            upd.setEnabled(false);
            Updater.download(this, latest, m -> runOnUiThread(() -> {
                msg.setText(m);
                upd.setEnabled(true);
            }));
            return;
        }
        if (click) msg.setText("检查中…");
        new Thread(() -> {
            try {
                Updater.Latest l = Updater.latest();
                runOnUiThread(() -> {
                    latest = l;
                    if (l.build > cur) {
                        upd.setText("有新版 build " + l.build + "，点这里更新（当前 " + cur + "）");
                        msg.setText("");
                    } else {
                        upd.setText("检查更新（当前 build " + cur + "）");
                        if (click) msg.setText("已经是最新版");
                    }
                });
            } catch (Exception e) {
                if (click) runOnUiThread(() -> msg.setText("检查失败：" + e.getMessage() + "（GitHub 要开代理）"));
            }
        }).start();
    }

    private Button button(LinearLayout box, String text, boolean primary) {
        Button bt = new Button(this);
        bt.setText(text);
        bt.setAllCaps(false);
        bt.setTextColor(primary ? Color.BLACK : FG);
        bt.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setColor(primary ? ACCENT : 0xFF2C2C2A);
        g.setCornerRadius(dp(12));
        bt.setBackground(g);
        bt.setStateListAnimator(null);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46));
        p.topMargin = dp(10);
        box.addView(bt, p);
        bt.setVisibility(View.VISIBLE);
        return bt;
    }
}
