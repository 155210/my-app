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

    /**
     * 空闲时的刷新间隔（秒），3~120，默认 5；有请求在跑时自动加快到 2 秒。
     * 旧版存的 key「interval」默认 30、最少 10，太慢，绿灯常常错过，所以换了新 key。
     */
    static int interval(Context c) {
        return Math.max(3, Math.min(120, sp(c).getInt("interval2", 5)));
    }

    /** 展开岛最下面显示调试信息 */
    static boolean debug(Context c) {
        return sp(c).getBoolean("debug", true);
    }

    // ── 上游额度：本机记下每个凭据最后一次「查询」的原始返回 ──

    static void saveProbe(Context c, String credId, String json) {
        sp(c).edit().putString("probe:" + credId, json).apply();
    }

    static GproxyClient.Quota probe(Context c, String credId) {
        String s = sp(c).getString("probe:" + credId, null);
        if (s == null) return null;
        try {
            return GproxyClient.parseSnapshot(new org.json.JSONObject(s));
        } catch (Exception e) {
            return null;
        }
    }

    /** gproxy 存的历史和本机上次查询结果，取更新的那个 */
    static GproxyClient.Quota bestQuota(Context c, String credId, GproxyClient.Quota history) {
        GproxyClient.Quota local = probe(c, credId);
        if (local == null) return history;
        if (history == null || local.at >= history.at) {
            if (history != null) local.blockedUntil = Math.max(local.blockedUntil, history.blockedUntil);
            return local;
        }
        return history;
    }

    /** 一行摘要：5小时 42% · 7天 18% · 14:30 查询；没有读数返回 null */
    static String quotaLine(GproxyClient.Quota q) {
        if (q == null || q.rows.isEmpty()) return null;
        StringBuilder b = new StringBuilder();
        int n = 0;
        for (GproxyClient.QuotaRow r : q.rows) {
            String v = quotaValue(r);
            if (v == null) continue;
            if (n++ > 0) b.append(" · ");
            b.append(r.name).append(" ").append(v);
            if (n >= 3) break;
        }
        if (n == 0) return q.at > 0 ? "无读数 · " + when(q.at) + " 查询" : "还没查询过";
        if (q.blockedUntil > System.currentTimeMillis()) b.append(" · 限流到 ").append(hm(q.blockedUntil));
        if (q.at > 0) b.append(" · ").append(when(q.at)).append(" 查询");
        return b.toString();
    }

    static String quotaValue(GproxyClient.QuotaRow r) {
        if (r.percent >= 0) return Math.round(r.percent) + "%";
        if (r.used != null && r.limit != null) return r.used + "/" + r.limit;
        if (r.remaining != null) return "剩 " + r.remaining + (r.unit != null ? " " + r.unit : "");
        return null;
    }

    /** 今天的显示 HH:mm，否则 MM-dd HH:mm */
    static String when(long ms) {
        boolean today = new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date(ms))
                .equals(new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date()));
        return new SimpleDateFormat(today ? "HH:mm" : "MM-dd HH:mm", Locale.US).format(new Date(ms));
    }

    /** 重置倒计时：3小时12分后 */
    static String until(long ms) {
        long m = (ms - System.currentTimeMillis()) / 60000;
        if (m <= 0) return "已到重置时间";
        if (m < 60) return m + "分后重置";
        if (m < 48 * 60) return (m / 60) + "小时" + (m % 60) + "分后重置";
        return (m / 1440) + "天后重置";
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

    static String hms(long ms) {
        return new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date(ms));
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
