package com.example.gproxyisland;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * 读 gproxy 的用量接口。
 * 登录：POST /portal/api/login {name,password} → token；
 * 之后把 token 放进 cookie gproxy_session（管理接口只认 cookie 形式的会话，Bearer 会被当成 API Key）。
 */
class GproxyClient {

    static class Summary {
        long requests, input, output, cached;
        double cost;
    }

    static class Record {
        String id, model, state;
        long startedAt;
        long input = -1, output = -1, durationMs = -1;
        double cost = -1;

        boolean failed() {
            return state != null && state.toLowerCase().matches(".*(fail|error|cancel).*");
        }
    }

    static class HttpError extends IOException {
        final int code;

        HttpError(int code, String msg) {
            super(msg);
            this.code = code;
        }
    }

    private final String base, user, pass;
    private String token;

    GproxyClient(String base, String user, String pass) {
        String b = base == null ? "" : base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        this.base = b;
        this.user = user;
        this.pass = pass;
    }

    /** 今天 0 点到现在的汇总 */
    Summary today() throws IOException {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        JSONObject s = json(get("/admin/api/usage?fromMs=" + c.getTimeInMillis())).optJSONObject("summary");
        Summary r = new Summary();
        if (s == null) return r;
        r.requests = s.optLong("requests");
        r.input = s.optLong("inputTokens");
        r.output = s.optLong("outputTokens");
        r.cached = s.optLong("cachedInputTokens");
        r.cost = parse(s.optString("cost", "0"));
        return r;
    }

    /** 最近 n 条请求，最新的在前 */
    List<Record> recent(int n) throws IOException {
        List<Record> out = new ArrayList<>();
        if (n <= 0) return out;
        JSONArray items = json(get("/admin/api/usage/records?page=1&pageSize=" + n)).optJSONArray("items");
        if (items == null) return out;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null) continue;
            Record r = new Record();
            r.id = o.optString("requestId", "");
            r.model = o.optString("model", "?");
            r.state = o.isNull("state") ? null : o.optString("state");
            r.startedAt = o.optLong("startedAtMs");
            JSONObject t = o.optJSONObject("tokens");
            if (t != null) {
                if (!t.isNull("inputTokens")) r.input = t.optLong("inputTokens", -1);
                if (!t.isNull("outputTokens")) r.output = t.optLong("outputTokens", -1);
            }
            if (!o.isNull("cost")) r.cost = parse(o.optString("cost", "-1"));
            if (!o.isNull("durationMs")) r.durationMs = o.optLong("durationMs", -1);
            out.add(r);
        }
        return out;
    }

    /** 一条正在进行的上游请求 */
    static class Flight {
        String id, model;
        long startedAt;
        /** 已经收到首字 */
        boolean responding;
    }

    /**
     * 正在进行的请求。来自上游日志（state = in_progress）。
     * gproxy 只有「上游日志」和「上游日志正文」都开着时，才会在请求进行中把这一行写进库
     * （只开上游日志 = 只记元数据，要等请求结束才一次性写入），否则这里永远是空的。
     */
    List<Flight> inflight() throws IOException {
        long from = System.currentTimeMillis() - 30 * 60 * 1000L;
        JSONArray items = json(get("/admin/api/logs/upstream?limit=10&fromMs=" + from)).optJSONArray("items");
        List<Flight> out = new ArrayList<>();
        if (items == null) return out;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null || !"in_progress".equals(o.optString("state"))) continue;
            Flight f = new Flight();
            f.id = o.optString("requestId", "");
            f.model = o.isNull("model") ? "?" : o.optString("model", "?");
            f.startedAt = o.optLong("startedAtMs");
            f.responding = !o.isNull("firstResponseAtMs");
            out.add(f);
        }
        return out;
    }


    // ───────────── 日志设置 ─────────────

    /** gproxy 的日志开关：「生成中」要上游日志 + 上游日志正文都开 */
    static class LogFlags {
        boolean upstream, upstreamBody;

        boolean live() {
            return upstream && upstreamBody;
        }
    }

    LogFlags logFlags() throws IOException {
        JSONObject l = json(get("/admin/api/settings")).optJSONObject("logging");
        LogFlags f = new LogFlags();
        if (l != null) {
            f.upstream = l.optBoolean("enableUpstreamLog");
            f.upstreamBody = l.optBoolean("enableUpstreamLogBody");
        }
        return f;
    }

    /** 打开上游日志和上游日志正文（PATCH /admin/api/settings，只改这两项） */
    LogFlags enableLiveLog() throws IOException {
        JSONObject body = new JSONObject();
        try {
            JSONObject l = new JSONObject();
            l.put("enableUpstreamLog", true);
            l.put("enableUpstreamLogBody", true);
            body.put("logging", l);
        } catch (Exception ignored) {
        }
        call("PATCH", "/admin/api/settings", body.toString(), 15000);
        return logFlags();
    }

    // ───────────── 上游额度 ─────────────

    static class Cred {
        String id, providerId, name, status;
        /** 岛上用的短名：provider + 账户名前 3 位，避免整个邮箱撑满一行 */
        String shortName;
        boolean enabled;
    }

    /** 一行额度：一个窗口/余额 */
    static class QuotaRow {
        String name;
        /** 0~100，未知 = -1 */
        double percent = -1;
        String used, limit, remaining, unit;
        /** 重置/结束时间，未知 = 0 */
        long resetAt;
        /** 窗口开始时间，未知 = 0（算「按此速度何时用完」用） */
        long startAt;
    }

    static class Quota {
        /** 读数时间（上次查询时间），没查过 = 0 */
        long at;
        List<QuotaRow> rows = new ArrayList<>();
        /** 被上游挡住到什么时候，没有 = 0 */
        long blockedUntil;
        /** 查询（probe）的原始返回，用来存到本机；历史读数为 null */
        String raw;
    }

    /** 凭据列表，名字优先用 label，其次 provider 名 */
    List<Cred> credentials() throws IOException {
        java.util.Map<String, String> names = new java.util.HashMap<>();
        try {
            JSONArray ps = json(get("/admin/api/providers?page=1&pageSize=200")).optJSONArray("items");
            if (ps != null) {
                for (int i = 0; i < ps.length(); i++) {
                    JSONObject p = ps.optJSONObject(i);
                    if (p == null) continue;
                    String n = str(p, "displayName");
                    if (n == null) n = str(p, "name");
                    names.put(p.optString("id"), n == null ? p.optString("id") : n);
                }
            }
        } catch (IOException ignored) {
        }
        List<Cred> out = new ArrayList<>();
        JSONArray items = json(get("/admin/api/credentials?page=1&pageSize=200")).optJSONArray("items");
        if (items == null) return out;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null) continue;
            Cred c = new Cred();
            c.id = o.optString("id");
            c.providerId = o.optString("providerId");
            c.status = o.optString("status", "");
            c.enabled = o.optBoolean("enabled", true);
            String pn = names.get(c.providerId);
            String label = str(o, "label");
            String head = pn != null ? pn : c.id.length() > 8 ? c.id.substring(0, 8) : c.id;
            c.shortName = label != null ? head + " · " + label.substring(0, Math.min(3, label.length())) : head;
            c.name = label != null ? (pn != null ? pn + " · " + label : label)
                    : (pn != null ? pn : c.id.length() > 8 ? c.id.substring(0, 8) : c.id);
            out.add(c);
        }
        return out;
    }

    /** 历史：gproxy 已存的最近读数（不请求上游） */
    Quota quotaHistory(String credId) throws IOException {
        JSONObject o = json(get("/admin/api/credentials/" + enc(credId) + "/quota"));
        Quota q = new Quota();
        JSONArray cycles = o.optJSONArray("cycles");
        if (cycles != null) {
            java.util.Set<String> seen = new java.util.HashSet<>();
            for (int i = 0; i < cycles.length(); i++) {
                JSONObject c = cycles.optJSONObject(i);
                if (c == null || !c.isNull("closedAtMs")) continue;
                String w = c.optString("windowId");
                if (!seen.add(w)) continue;
                QuotaRow r = new QuotaRow();
                r.name = windowName(w);
                if (!c.isNull("endsAtMs")) r.resetAt = c.optLong("endsAtMs");
                r.startAt = c.optLong("startsAtMs");
                JSONObject s = c.optJSONObject("sample");
                if (s != null) {
                    r.percent = num(str(s, "usedPercent"));
                    r.used = str(s, "used");
                    r.limit = str(s, "limit");
                    q.at = Math.max(q.at, s.optLong("atMs"));
                }
                q.rows.add(r);
            }
        }
        q.blockedUntil = blocks(o.optJSONArray("blocks"));
        return q;
    }

    /** 查询：让 gproxy 去问上游（可能有频率限制，只在用户点「查询」时调） */
    Quota quotaProbe(String credId) throws IOException {
        String raw = call("POST", "/admin/api/credentials/" + enc(credId) + "/quota-probe", null, 30000);
        Quota q = parseSnapshot(json(raw));
        q.raw = raw;
        return q;
    }

    static Quota parseSnapshot(JSONObject o) {
        Quota q = new Quota();
        q.at = o.optLong("observedAtMs");
        JSONArray es = o.optJSONArray("entries");
        if (es == null) return q;
        for (int i = 0; i < es.length(); i++) {
            JSONObject e = es.optJSONObject(i);
            if (e == null) continue;
            String kind = e.optString("kind");
            if ("breakdown".equals(kind)) continue;
            QuotaRow r = new QuotaRow();
            String label = str(e, "label");
            r.name = label != null ? label : windowName(e.optString("id"));
            JSONObject a = e.optJSONObject("allowance");
            JSONObject b = e.optJSONObject("balance");
            if (a != null) {
                if (a.optBoolean("unlimited")) r.remaining = "不限";
                r.percent = num(str(a, "usedPercent"));
                r.used = str(a, "used");
                r.limit = str(a, "limit");
                if (r.remaining == null) r.remaining = str(a, "remaining");
                r.unit = str(a, "unit");
                if (!a.isNull("periodEndMs")) r.resetAt = a.optLong("periodEndMs");
                if (!a.isNull("periodStartMs")) r.startAt = a.optLong("periodStartMs");
            } else if (b != null) {
                r.name = label != null ? label : "余额";
                r.remaining = str(b, "remaining");
                r.unit = str(b, "unit");
            }
            q.rows.add(r);
        }
        return q;
    }

    private static long blocks(JSONArray bs) {
        long until = 0;
        if (bs == null) return 0;
        for (int i = 0; i < bs.length(); i++) {
            JSONObject b = bs.optJSONObject(i);
            if (b != null) until = Math.max(until, b.optLong("untilMs"));
        }
        return until;
    }

    /** five_hour → 5小时 之类，认不出就原样 */
    static String windowName(String id) {
        if (id == null || id.isEmpty()) return "额度";
        String s = id.toLowerCase();
        if (s.contains("five_hour") || s.equals("5h")) return "5小时";
        if (s.startsWith("seven_day_")) {
            // 按模型单独算的 7 天额度：seven_day_fable → 7天 Fable
            String f = id.substring("seven_day_".length()).replace('_', ' ');
            return f.isEmpty() ? "7天" : "7天 " + Character.toUpperCase(f.charAt(0)) + f.substring(1);
        }
        if (s.equals("seven_day") || s.equals("7d") || s.contains("week")) return "7天";
        if (s.contains("day") || s.equals("1d")) return "每天";
        if (s.contains("month")) return "每月";
        return id;
    }

    private static String str(JSONObject o, String k) {
        if (o == null || o.isNull(k)) return null;
        String v = o.optString(k, null);
        return v == null || v.isEmpty() ? null : v;
    }

    private static double num(String s) {
        if (s == null) return -1;
        try {
            return Double.parseDouble(s);
        } catch (Exception e) {
            return -1;
        }
    }

    private static String enc(String s) {
        try {
            return java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return s;
        }
    }

    private String get(String path) throws IOException {
        return call("GET", path, null, 8000);
    }

    /** 带登录的请求：没有 token 先登录；401/403 重新登录再试一次 */
    private String call(String method, String path, String body, int readTimeout) throws IOException {
        if (token == null) login();
        try {
            return request(method, path, body, readTimeout);
        } catch (HttpError e) {
            if (e.code != 401 && e.code != 403) throw e;
            token = null;
            login();
            return request(method, path, body, readTimeout);
        }
    }

    private void login() throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("name", user);
            body.put("password", pass);
        } catch (Exception ignored) {
        }
        String r;
        try {
            r = request("POST", "/portal/api/login", body.toString(), 8000);
        } catch (HttpError e) {
            if (e.code == 401 || e.code == 403) throw new HttpError(e.code, "登录失败，检查用户名和密码");
            throw e;
        }
        String t = json(r).optString("token", "");
        if (t.isEmpty()) throw new IOException("登录返回里没有 token");
        token = t;
    }

    private String request(String method, String path, String body, int readTimeout) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            c.setConnectTimeout(4000);
            c.setReadTimeout(readTimeout);
            c.setRequestMethod(method);
            c.setRequestProperty("accept", "application/json");
            if (token != null) c.setRequestProperty("cookie", "gproxy_session=" + token);
            // cookie 认证的 POST/PATCH 要过 gproxy 的同源检查：Origin 必须和 Host 一致
            if (!"GET".equals(method)) c.setRequestProperty("origin", origin());
            if (body != null) {
                byte[] b = body.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("content-type", "application/json");
                c.setFixedLengthStreamingMode(b.length);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(b);
                }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = read(in);
            if (code >= 400) {
                String msg = text;
                try {
                    JSONObject err = new JSONObject(text).optJSONObject("error");
                    if (err != null) msg = err.optString("message", text);
                } catch (Exception ignored) {
                }
                if (msg.length() > 80) msg = msg.substring(0, 80);
                throw new HttpError(code, "HTTP " + code + " " + msg);
            }
            return text;
        } finally {
            c.disconnect();
        }
    }

    /** http://127.0.0.1:8787/xxx → http://127.0.0.1:8787 */
    private String origin() {
        try {
            URL u = new URL(base);
            return u.getProtocol() + "://" + u.getHost() + (u.getPort() >= 0 ? ":" + u.getPort() : "");
        } catch (Exception e) {
            return base;
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream s = in) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        }
    }

    private static JSONObject json(String s) throws IOException {
        try {
            return new JSONObject(s);
        } catch (Exception e) {
            throw new IOException("返回的不是 JSON");
        }
    }

    private static double parse(String s) {
        try {
            return Double.parseDouble(s);
        } catch (Exception e) {
            return 0;
        }
    }
}
