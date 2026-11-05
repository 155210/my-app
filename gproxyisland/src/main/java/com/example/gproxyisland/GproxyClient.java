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
     * 正在进行的请求。来自上游日志（state = in_progress），
     * gproxy 控制台没开「上游日志」时这里永远是空的。
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

    private String get(String path) throws IOException {
        if (token == null) login();
        try {
            return request("GET", path, null);
        } catch (HttpError e) {
            if (e.code != 401 && e.code != 403) throw e;
            token = null;
            login();
            return request("GET", path, null);
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
            r = request("POST", "/portal/api/login", body.toString());
        } catch (HttpError e) {
            if (e.code == 401 || e.code == 403) throw new HttpError(e.code, "登录失败，检查用户名和密码");
            throw e;
        }
        String t = json(r).optString("token", "");
        if (t.isEmpty()) throw new IOException("登录返回里没有 token");
        token = t;
    }

    private String request(String method, String path, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            c.setConnectTimeout(4000);
            c.setReadTimeout(8000);
            c.setRequestMethod(method);
            c.setRequestProperty("accept", "application/json");
            if (token != null) c.setRequestProperty("cookie", "gproxy_session=" + token);
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
