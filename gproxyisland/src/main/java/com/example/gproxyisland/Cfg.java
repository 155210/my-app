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
        for (GproxyClient.QuotaRow r : q.rows) {
            long t = exhaustAt(r, q.at);
            if (t > 0) b.append(" · ⚠").append(r.name).append(" 按此速度").append(day(t)).append("用完");
        }
        if (q.blockedUntil > System.currentTimeMillis()) b.append(" · 限流到 ").append(hm(q.blockedUntil));
        if (q.at > 0) b.append(" · ").append(when(q.at)).append(" 查询");
        return b.toString();
    }

    /** 窗口长度：5小时 / 7天…，认不出 = 0 */
    static long windowMs(String name) {
        if (name == null) return 0;
        if (name.startsWith("5小时")) return 5 * 3600_000L;
        if (name.startsWith("7天")) return 7 * 86400_000L;
        if (name.startsWith("每天")) return 86400_000L;
        return 0;
    }

    /**
     * 按目前的速度（窗口开始到读数时间，线性）预计什么时候用完。
     * 只有会早于重置时间用完才返回时间，否则 0。读数太少（<3% 或窗口刚开始 10 分钟内）不算。
     */
    static long exhaustAt(GproxyClient.QuotaRow r, long at) {
        if (r.percent < 3 || r.percent >= 100 || r.resetAt <= 0) return 0;
        long start = r.startAt;
        long len = windowMs(r.name);
        if (len > 0 && (start <= 0 || r.resetAt - start > len + 3600_000L)) start = r.resetAt - len;
        if (start <= 0) return 0;
        long t0 = at > 0 ? at : System.currentTimeMillis();
        long elapsed = t0 - start;
        if (elapsed < 10 * 60_000L) return 0;
        long t = start + (long) (elapsed * 100.0 / r.percent);
        return t < r.resetAt && t > System.currentTimeMillis() - 3600_000L ? t : 0;
    }

    /** 今天 09:00 / 明天 09:00 / 周一 09:00 */
    static String day(long ms) {
        java.util.Calendar a = java.util.Calendar.getInstance(), b = java.util.Calendar.getInstance();
        b.setTimeInMillis(ms);
        int d = (int) ((startOfDay(b) - startOfDay(a)) / 86400_000L);
        String w = d == 0 ? "今天" : d == 1 ? "明天" : d == 2 ? "后天"
                : "周" + "日一二三四五六".charAt(b.get(java.util.Calendar.DAY_OF_WEEK) - 1);
        return w + " " + hm(ms);
    }

    private static long startOfDay(java.util.Calendar c) {
        java.util.Calendar x = (java.util.Calendar) c.clone();
        x.set(java.util.Calendar.HOUR_OF_DAY, 0);
        x.set(java.util.Calendar.MINUTE, 0);
        x.set(java.util.Calendar.SECOND, 0);
        x.set(java.util.Calendar.MILLISECOND, 0);
        return x.getTimeInMillis();
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

    /** NovelAI API Key，只用来查额度；空 = 不显示 NAI 额度 */
    static String naiKey(Context c) {
        return sp(c).getString("naiKey", "");
    }

    /** 检测代理（NekoBox）有没有开，没开就警告 */
    static boolean proxyCheck(Context c) {
        return sp(c).getBoolean("proxyCheck", false);
    }

    /** NekoBox 的 Clash API 地址（NekoBox 设置里「启用 Clash API」后是 127.0.0.1:9090）；空 = 不读节点 */
    static String clashApi(Context c) {
        String s = sp(c).getString("clashApi", "http://127.0.0.1:9090").trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    static String clashSecret(Context c) {
        return sp(c).getString("clashSecret", "");
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
