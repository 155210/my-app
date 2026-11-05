package com.example.gproxyisland;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.Collections;
import java.util.Iterator;

/**
 * 检测代理 App（用户用的是 NekoBox，包名 moe.nb4a，内核 sing-box）有没有开、当前节点是什么。
 *
 * - 有没有开：系统里有 VPN 网络，或者有 tun 网卡，或者 Clash API 能连上，任一成立就算开着。
 *   （本 App 如果被 NekoBox 的分应用代理排除，可能看不到 VPN 网络，所以多看两样。）
 * - 节点：NekoBox 设置里打开「启用 Clash API」后，sing-box 在 127.0.0.1:9090 提供 Clash API，
 *   GET /proxies 里 Selector 组的 now 就是当前节点；没有组时取唯一的非内置出站。
 */
final class ProxyCheck {
    private ProxyCheck() {
    }

    static class State {
        boolean vpn, tun, api;
        /** 从 NekoBox 通知读到的节点名（最准） */
        String node;
        /** Clash API 里 proxy 出站的协议，比如 VLESS（读不到名字时退而求其次） */
        String nodeType;
        /** 通知监听连着；notif = NekoBox 常驻通知在 */
        boolean listening, notif;
        String apiErr;
        /** 出口位置（Cloudflare trace 的 loc + colo），比如「美国 LAX」；不存 IP */
        String exit;

        boolean on() {
            // 通知可能被用户关掉，所以通知不在时仍看其他迹象
            return notif || vpn || tun || api;
        }
    }

    static State check(Context c) {
        State s = new State();
        try {
            ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
            if (cm != null) {
                for (Network n : cm.getAllNetworks()) {
                    NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                    if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) s.vpn = true;
                }
            }
        } catch (Exception ignored) {
        }
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                String name = ni.getName();
                if (name != null && name.startsWith("tun") && ni.isUp()) s.tun = true;
            }
        } catch (Exception ignored) {
        }
        s.listening = NodeListener.connected;
        s.notif = NodeListener.nekoShown;
        if (s.listening && s.notif) s.node = NodeListener.nodeTitle;
        String api = Cfg.clashApi(c);
        if (!api.isEmpty()) {
            try {
                JSONObject o = new JSONObject(get(api + "/proxies", Cfg.clashSecret(c)));
                if (s.node == null) s.node = node(o);
                JSONObject ps = o.optJSONObject("proxies");
                JSONObject p = ps == null ? null : ps.optJSONObject("proxy");
                if (p != null) s.nodeType = p.optString("type", null);
                s.api = true;
            } catch (Exception e) {
                s.apiErr = e.getMessage() == null ? e.toString() : e.getMessage();
            }
        }
        if (s.on()) s.exit = exit(s.node);
        if (s.node != null) {
            Cfg.saveLastNode(c, s.node);
            s.node = Cfg.nodeShown(c, s.node);
        }
        return s;
    }

    private static final java.util.Set<String> BUILTIN = new java.util.HashSet<>(java.util.Arrays.asList(
            "direct", "bypass", "block", "dns-out", "global", "reject", "dns", "pass"));

    static String node(JSONObject o) {
        JSONObject ps = o.optJSONObject("proxies");
        if (ps == null) return null;
        // 先找名叫 proxy 的组，再找任意 Selector / URLTest 组
        String best = null;
        for (Iterator<String> it = ps.keys(); it.hasNext(); ) {
            String k = it.next();
            JSONObject p = ps.optJSONObject(k);
            if (p == null) continue;
            String type = p.optString("type").toLowerCase();
            String now = p.optString("now", "");
            if (now.isEmpty() || !(type.contains("selector") || type.contains("urltest") || type.contains("fallback"))) continue;
            if (k.equalsIgnoreCase("proxy")) return follow(ps, now);
            if (best == null && !k.equalsIgnoreCase("global")) best = now;
        }
        if (best != null) return follow(ps, best);
        String only = null;
        int n = 0;
        for (Iterator<String> it = ps.keys(); it.hasNext(); ) {
            String k = it.next();
            JSONObject p = ps.optJSONObject(k);
            String type = p == null ? "" : p.optString("type").toLowerCase();
            if (BUILTIN.contains(k.toLowerCase()) || type.equals("direct") || type.equals("reject")
                    || type.equals("dns") || type.equals("block")) continue;
            only = k;
            n++;
        }
        return n == 1 ? only : null;
    }

    /** 组套组时一路找到最终节点 */
    private static String follow(JSONObject ps, String name) {
        for (int i = 0; i < 5; i++) {
            JSONObject p = ps.optJSONObject(name);
            if (p == null) return name;
            String now = p.optString("now", "");
            if (now.isEmpty() || now.equals(name)) return name;
            name = now;
        }
        return name;
    }

    // 只在轮询线程用
    private static String exitText, exitNode;
    private static long exitAt;

    /** 走代理访问 Cloudflare trace，拿出口国家和机房。节点变了立刻重查，否则 5 分钟一次，失败 1 分钟后再试 */
    private static String exit(String node) {
        long now = System.currentTimeMillis();
        boolean changed = node != null && !node.equals(exitNode);
        long ttl = exitText == null ? 60_000 : 300_000;
        if (!changed && now - exitAt < ttl) return exitText;
        exitAt = now;
        exitNode = node;
        try {
            String loc = null, colo = null;
            for (String line : get("https://www.cloudflare.com/cdn-cgi/trace", null).split("\n")) {
                if (line.startsWith("loc=")) loc = line.substring(4).trim();
                else if (line.startsWith("colo=")) colo = line.substring(5).trim();
            }
            exitText = loc == null ? null : country(loc) + (colo == null || colo.isEmpty() ? "" : " " + colo);
        } catch (Exception e) {
            if (changed) exitText = null;
        }
        return exitText;
    }

    private static String country(String cc) {
        switch (cc) {
            case "US": return "美国";
            case "JP": return "日本";
            case "HK": return "香港";
            case "TW": return "台湾";
            case "SG": return "新加坡";
            case "KR": return "韩国";
            case "GB": return "英国";
            case "DE": return "德国";
            case "FR": return "法国";
            case "NL": return "荷兰";
            case "CA": return "加拿大";
            case "AU": return "澳大利亚";
            case "MY": return "马来西亚";
            case "TH": return "泰国";
            case "VN": return "越南";
            case "PH": return "菲律宾";
            case "IN": return "印度";
            case "RU": return "俄罗斯";
            case "TR": return "土耳其";
            case "AE": return "阿联酋";
            case "CN": return "中国大陆";
            case "MO": return "澳门";
            default: return cc;
        }
    }

    private static String get(String url, String secret) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(1500);
            c.setReadTimeout(3000);
            if (secret != null && !secret.isEmpty()) c.setRequestProperty("authorization", "Bearer " + secret);
            int code = c.getResponseCode();
            if (code == 401) throw new Exception("Clash API 密钥不对（401）");
            if (code >= 400) throw new Exception("Clash API 返回 " + code);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int k;
                while ((k = in.read(buf)) > 0) bo.write(buf, 0, k);
                return bo.toString("UTF-8");
            }
        } catch (java.net.ConnectException e) {
            throw new Exception("连不上 Clash API（NekoBox 没开，或没打开「启用 Clash API」）");
        } finally {
            c.disconnect();
        }
    }
}
