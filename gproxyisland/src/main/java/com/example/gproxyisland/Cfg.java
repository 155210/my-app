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

    /** 空闲时的刷新间隔（秒），最少 5；有请求在跑时自动加快到 2 秒 */
    static int interval(Context c) {
        return Math.max(5, sp(c).getInt("interval", 15));
    }

    /** 展开后显示最近几次，0~10 */
    static int recent(Context c) {
        return Math.max(0, Math.min(10, sp(c).getInt("recent", 3)));
    }

    /** 请求完成/失败时胶囊短暂提示 */
    static boolean pop(Context c) {
        return sp(c).getBoolean("pop", true);
    }

    /** 预算提醒、失败时震动 */
    static boolean vibrate(Context c) {
        return sp(c).getBoolean("vibrate", true);
    }

    /** 每日预算（美元），0 = 不提醒 */
    static float budget(Context c) {
        return Math.max(0f, sp(c).getFloat("budget", 0f));
    }

    /** 允许拖动；默认锁定在顶部居中 */
    static boolean draggable(Context c) {
        return sp(c).getBoolean("drag", false);
    }

    static boolean enabled(Context c) {
        return sp(c).getBoolean("enabled", false);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
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

    /** 12s / 1m05s */
    static String secs(long ms) {
        long s = Math.max(0, ms / 1000);
        if (s < 60) return s + "s";
        return (s / 60) + "m" + String.format(Locale.US, "%02d", s % 60) + "s";
    }

    /** 完成耗时：12.3s */
    static String dur(long ms) {
        if (ms < 0) return "";
        if (ms < 60000) return String.format(Locale.US, "%.1fs", ms / 1000.0);
        return secs(ms);
    }

    static String model(String m) {
        if (m == null) return "?";
        String s = m.startsWith("claude-") ? m.substring(7) : m;
        return s.length() > 18 ? s.substring(0, 18) + "…" : s;
    }
}
