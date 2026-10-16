package com.example.aitoolbox;

import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 网页里的跨域 fetch 由这里代发：没有 CORS 限制、允许 http、响应逐块回传（流式输出照常工作）。
 * 回调网页：window.__nativeHttp.head / data / end / error
 */
class NativeHttp {
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> conns = new ConcurrentHashMap<>();
    private final Set<String> aborted = ConcurrentHashMap.newKeySet();

    NativeHttp(WebView web) {
        this.web = web;
    }

    void start(final String id, final String method, final String url, final String headersJson, final String bodyB64) {
        pool.execute(() -> run(id, method, url, headersJson, bodyB64));
    }

    void abort(String id) {
        aborted.add(id);
        HttpURLConnection c = conns.remove(id);
        if (c != null) {
            pool.execute(() -> {
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                }
            });
        }
    }

    void shutdown() {
        for (String id : conns.keySet()) abort(id);
        pool.shutdownNow();
    }

    private void run(String id, String method, String url, String headersJson, String bodyB64) {
        HttpURLConnection c = null;
        try {
            if (aborted.contains(id)) return;
            c = (HttpURLConnection) new URL(url).openConnection();
            conns.put(id, c);
            c.setConnectTimeout(30000);
            c.setReadTimeout(0); // 无响应超时由网页端自己控制（AbortController）
            c.setInstanceFollowRedirects(true);
            c.setUseCaches(false);
            c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);

            JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
            Iterator<String> keys = h.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String lk = k.toLowerCase(Locale.ROOT);
                if (lk.equals("host") || lk.equals("content-length") || lk.equals("connection")
                        || lk.equals("accept-encoding") || lk.equals("origin") || lk.equals("referer")) continue;
                c.setRequestProperty(k, h.optString(k));
            }

            byte[] body = (bodyB64 == null || bodyB64.isEmpty()) ? null : Base64.decode(bodyB64, Base64.DEFAULT);
            if (body != null && body.length > 0) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body);
                }
            }

            int code = c.getResponseCode();
            if (aborted.contains(id)) return;
            String msg = c.getResponseMessage();
            JSONObject rh = new JSONObject();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null) continue;
                String lk = e.getKey().toLowerCase(Locale.ROOT);
                if (lk.equals("content-encoding") || lk.equals("content-length") || lk.equals("transfer-encoding")
                        || lk.startsWith("x-android-")) continue;
                rh.put(e.getKey(), String.join(", ", e.getValue()));
            }
            js("head", id, String.valueOf(code), JSONObject.quote(msg == null ? "" : msg), JSONObject.quote(rh.toString()));

            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (aborted.contains(id)) return;
                    if (n > 0) js("data", id, "'" + Base64.encodeToString(buf, 0, n, Base64.NO_WRAP) + "'");
                }
                in.close();
            }
            if (!aborted.contains(id)) js("end", id);
        } catch (Throwable t) {
            if (!aborted.contains(id)) {
                String m = t.getClass().getSimpleName() + (t.getMessage() != null ? ": " + t.getMessage() : "");
                js("error", id, JSONObject.quote(m));
            }
        } finally {
            conns.remove(id);
            aborted.remove(id);
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private void js(String fn, String id, String... args) {
        StringBuilder sb = new StringBuilder("window.__nativeHttp&&window.__nativeHttp.")
                .append(fn).append("(").append(JSONObject.quote(id));
        for (String a : args) sb.append(",").append(a);
        sb.append(")");
        final String code = sb.toString();
        main.post(() -> web.evaluateJavascript(code, null));
    }
}
