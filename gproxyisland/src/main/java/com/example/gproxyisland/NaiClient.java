package com.example.gproxyisland;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.NumberFormat;
import java.util.Locale;

/**
 * NovelAI 订阅额度（和柏宝绘 src/naiQuota/quota.ts 同一套口径）。
 * GET https://image.novelai.net/user/subscription（旧地址 api.novelai.net 做后备），Authorization: Bearer <API Key>。
 * 只在用户点「查询」时请求，结果原样存本机 cfg 的 nai.raw / nai.at。
 */
final class NaiClient {
    private NaiClient() {
    }

    static final String[] URLS = {
            "https://image.novelai.net/user/subscription",
            "https://api.novelai.net/user/subscription",
    };
    /** 电量 1% 约等于几张 V5（官网口径，1024×1024 以内、28 步以内） */
    static final double IMAGES_PER_PERCENT = 17.3;
    static final String[] TIERS = {"免费", "Tablet", "Scroll", "Opus"};

    static class Quota {
        String tier;
        boolean active;
        long expiresAt;
        /** Anlas 余额，未知 = -1 */
        long anlas = -1;
        /** V5 免费额度（利用上限）剩余 %，未知 = -1 */
        double percent = -1;
        boolean empty;
        /** 再回 1% 要多少秒，未知 = 0 */
        long secondsToNext;
        long at;
    }

    /** 查一次并存本机 */
    static Quota probe(Context c, String key) throws IOException {
        IOException first = null;
        for (String u : URLS) {
            try {
                String raw = get(u, key);
                long now = System.currentTimeMillis();
                // 先解析：返回的不是 JSON 时不覆盖上次的好数据
                Quota q = parse(new JSONObject(raw), now);
                Cfg.sp(c).edit().putString("nai.raw", raw).putLong("nai.at", now).apply();
                return q;
            } catch (IOException e) {
                if (e.getMessage() != null && e.getMessage().contains("401")) throw e;
                if (first == null) first = e;
            } catch (Exception e) {
                if (first == null) first = new IOException("订阅接口返回的不是 JSON");
            }
        }
        throw first != null ? first : new IOException("订阅接口不可用");
    }

    /** 本机上次查询结果，没有 = null */
    static Quota last(Context c) {
        String raw = Cfg.sp(c).getString("nai.raw", null);
        if (raw == null) return null;
        try {
            return parse(new JSONObject(raw), Cfg.sp(c).getLong("nai.at", 0));
        } catch (Exception e) {
            return null;
        }
    }

    static Quota parse(JSONObject o, long at) {
        JSONObject sub = o.optJSONObject("subscription");
        if (sub == null) sub = o;
        Quota q = new Quota();
        q.at = at;
        int tier = sub.optInt("tier", 0);
        q.tier = tier >= 0 && tier < TIERS.length ? TIERS[tier] : "Tier " + tier;
        q.active = sub.optBoolean("active", true);
        long exp = sub.optLong("expiresAt", 0);
        if (exp > 0) q.expiresAt = exp < 1_000_000_000_000L ? exp * 1000 : exp;
        Object steps = sub.has("trainingStepsLeft") ? sub.opt("trainingStepsLeft") : o.opt("trainingStepsLeft");
        if (steps instanceof Number) {
            q.anlas = ((Number) steps).longValue();
        } else if (steps instanceof JSONObject) {
            JSONObject s = (JSONObject) steps;
            if (s.has("fixedTrainingStepsLeft") || s.has("purchasedTrainingSteps")) {
                q.anlas = s.optLong("fixedTrainingStepsLeft") + s.optLong("purchasedTrainingSteps");
            }
        }
        JSONObject usage = o.optJSONObject("usage");
        if (usage == null) usage = sub.optJSONObject("usage");
        if (usage != null && usage.has("percent")) {
            q.percent = Math.max(0, Math.min(100, usage.optDouble("percent", 0)));
            q.empty = q.percent <= 0 || usage.optBoolean("isNegative");
            q.secondsToNext = usage.optLong("timeUntilNextPercent", 0);
        }
        return q;
    }

    /** 按查询后过去的时间估算现在回到多少 %（不超过 100） */
    static double nowPercent(Quota q) {
        if (q.percent < 0) return -1;
        if (q.secondsToNext <= 0 || q.at <= 0) return q.percent;
        double perSec = 1.0 / q.secondsToNext;
        double p = q.percent + (System.currentTimeMillis() - q.at) / 1000.0 * perSec;
        return Math.min(100, p);
    }

    static String anlas(long v) {
        return NumberFormat.getIntegerInstance(Locale.US).format(v);
    }

    /** 岛上一行：NAI Opus · V5 剩 67%（约1159张）· Anlas 8,749 · 01:30 查询 */
    static String line(Quota q) {
        StringBuilder b = new StringBuilder("NAI ").append(q.tier);
        if (q.percent >= 0) {
            if (q.empty) b.append(" · V5 免费额度用完");
            else b.append(" · V5 剩 ").append(Math.round(q.percent)).append("%（约")
                    .append(Math.round(q.percent * IMAGES_PER_PERCENT)).append("张）");
        }
        if (q.anlas >= 0) b.append(" · Anlas ").append(anlas(q.anlas));
        if (q.at > 0) b.append(" · ").append(Cfg.when(q.at)).append(" 查询");
        return b.toString();
    }

    /** 每天回 11%（约 190 张），约 3 天回满；没有速度返回空串 */
    static String refill(Quota q) {
        if (q.secondsToNext <= 0 || q.percent >= 100 || q.percent < 0) return "";
        double perDay = Math.round(86400.0 / q.secondsToNext * 10) / 10.0;
        String rate = perDay >= 1
                ? "每天回 " + trim(perDay) + "%（约 " + Math.round(perDay * IMAGES_PER_PERCENT) + " 张）"
                : "约 " + (long) Math.ceil(q.secondsToNext / 3600.0) + " 小时回 1%";
        double days = (100 - q.percent) / Math.max(0.01, perDay);
        String full = days < 1 ? "约 " + Math.max(1, (long) Math.ceil(days * 24)) + " 小时回满" : "约 " + (long) Math.ceil(days) + " 天回满";
        return rate + "，" + full;
    }

    private static String trim(double d) {
        String s = String.valueOf(d);
        return s.endsWith(".0") ? s.substring(0, s.length() - 2) : s;
    }

    private static String get(String url, String key) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            c.setRequestProperty("accept", "application/json");
            c.setRequestProperty("authorization", "Bearer " + key.trim());
            int code = c.getResponseCode();
            if (code == 401) throw new IOException("API Key 无效（401）");
            if (code >= 400) throw new IOException("订阅接口返回 " + code);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                return bo.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }
}
