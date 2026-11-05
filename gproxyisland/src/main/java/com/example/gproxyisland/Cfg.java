package com.example.gproxyisland;

import android.content.Context;
import android.content.SharedPreferences;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** 设置项 + 数字格式化 */
final class Cfg {
    private Cfg() {
    }

    static final String DEFAULT_URL = "http://127.0.0.1:8787";

    static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("cfg", Context.MODE_PRIVATE);
    }

    static String url(Context c) {
        return sp(c).getString("url", DEFAULT_URL);
    }

    static String user(Context c) {
        return sp(c).getString("user", "admin");
    }

    static String pass(Context c) {
        return sp(c).getString("pass", "");
    }

    /** 刷新间隔（秒），最少 10 */
    static int interval(Context c) {
        return Math.max(10, sp(c).getInt("interval", 30));
    }

    /** 展开后显示最近几次，0~10 */
    static int recent(Context c) {
        return Math.max(0, Math.min(10, sp(c).getInt("recent", 3)));
    }

    /** 有新请求时弹出提示 */
    static boolean pop(Context c) {
        return sp(c).getBoolean("pop", true);
    }

    static boolean enabled(Context c) {
        return sp(c).getBoolean("enabled", false);
    }

    /** 1.53万 风格；≥1万 保留一位小数 */
    static String w(long v) {
        if (v < 0) return "-";
        if (v < 10000) return String.valueOf(v);
        double x = Math.floor(v / 1000.0) / 10.0;
        String s = String.format(Locale.US, "%.1f", x);
        if (s.endsWith(".0")) s = s.substring(0, s.length() - 2);
        return s + "万";
    }

    static String money(double v) {
        return String.format(Locale.US, "$%.2f", v);
    }

    static String hm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.US).format(new Date(ms));
    }

    static String model(String m) {
        if (m == null) return "?";
        String s = m.startsWith("claude-") ? m.substring(7) : m;
        return s.length() > 18 ? s.substring(0, 18) + "…" : s;
    }
}
