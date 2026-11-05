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

/** 设置页：填 gproxy 地址和账号，授权悬浮窗，开关悬浮岛 */
public class MainActivity extends Activity {
    private EditText url, user, pass, interval, recent;
    private CheckBox pop;
    private TextView status, testResult;
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
        TextView sub = label("在屏幕顶部显示 gproxy 今日用量。点一下展开看最近几次请求，按住可以拖动。", 13, MUTED);
        sub.setPadding(0, dp(6), 0, dp(18));
        box.addView(sub);

        url = field(box, "gproxy 地址", Cfg.url(this), InputType.TYPE_TEXT_VARIATION_URI);
        user = field(box, "管理员用户名", Cfg.user(this), InputType.TYPE_CLASS_TEXT);
        pass = field(box, "管理员密码", Cfg.pass(this),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        interval = field(box, "刷新间隔（秒，最少 10）", String.valueOf(Cfg.interval(this)), InputType.TYPE_CLASS_NUMBER);
        recent = field(box, "展开后显示最近几次（0~10）", String.valueOf(Cfg.recent(this)), InputType.TYPE_CLASS_NUMBER);

        pop = new CheckBox(this);
        pop.setText("有新请求时胶囊短暂显示这次的模型和花费");
        pop.setTextColor(FG);
        pop.setChecked(Cfg.pop(this));
        pop.setPadding(0, dp(4), 0, dp(4));
        box.addView(pop);

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

        Button app = button(box, "打开本应用的系统设置（自启动、省电策略）", false);
        app.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()))));

        TextView tip = label("小米手机建议：在系统设置里把本应用的「省电策略」设为「无限制」，否则锁屏久了可能被系统停掉。"
                + "熄屏时悬浮岛会自动暂停刷新，不额外耗电。", 12, MUTED);
        tip.setPadding(0, dp(14), 0, 0);
        box.addView(tip);

        setContentView(sv);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
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
                + "\n悬浮岛：" + (IslandService.running ? "运行中" : "未开启"));
        toggle.setText(IslandService.running ? "关闭悬浮岛" : "开启悬浮岛");
    }

    private void save() {
        int iv = parse(interval.getText().toString(), 30);
        int rc = parse(recent.getText().toString(), 3);
        Cfg.sp(this).edit()
                .putString("url", url.getText().toString().trim())
                .putString("user", user.getText().toString().trim())
                .putString("pass", pass.getText().toString())
                .putInt("interval", Math.max(10, iv))
                .putInt("recent", Math.max(0, Math.min(10, rc)))
                .putBoolean("pop", pop.isChecked())
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
