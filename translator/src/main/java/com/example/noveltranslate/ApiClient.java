package com.example.noveltranslate;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 三家接口（OpenAI 兼容 / Gemini / Anthropic）的请求与流式解析。
 *
 * 原生请求不走浏览器同源策略，没有 CORS 限制，Anthropic 也不需要
 * anthropic-dangerous-direct-browser-access 那个头。
 *
 * 流式读取用 HttpURLConnection 一行行读 SSE。readTimeout 是「两次读之间」的超时，
 * 正好就是「多久没收到新内容就判定卡死」的语义。
 */
final class ApiClient {
    private ApiClient() {}

    interface DeltaListener {
        void onDelta(String text);
    }

    /** 停止翻译时用来掐断正在进行的连接 */
    static final class Cancel {
        volatile boolean cancelled;
        volatile HttpURLConnection conn;

        void cancel() {
            cancelled = true;
            HttpURLConnection c = conn;
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    static final class Result {
        String text = "";
        String finishReason = "";

        boolean truncated() {
            String f = finishReason == null ? "" : finishReason.toLowerCase();
            return f.equals("length") || f.equals("max_tokens") || f.equals("max_output_tokens");
        }
    }

    static final class ApiException extends IOException {
        final int code;

        ApiException(int code, String msg) {
            super(msg);
            this.code = code;
        }

        /** 限流、服务端错误、超时值得重试；鉴权、模型不存在之类重试也没用 */
        boolean retryable() {
            return code == 0 || code == 408 || code == 409 || code == 425 || code == 429 || code >= 500;
        }
    }

    // ================= 地址 =================

    private static String withScheme(String url, String def) {
        String u = url == null ? "" : url.trim();
        if (u.isEmpty()) u = def;
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        if (!u.matches("(?i)^https?://.*")) u = "https://" + u;
        return u;
    }

    static String openaiChatUrl(String endpoint) {
        String u = withScheme(endpoint, "https://api.openai.com/v1");
        if (u.toLowerCase().endsWith("/chat/completions")) return u;
        if (u.toLowerCase().endsWith("/models")) u = u.substring(0, u.length() - "/models".length());
        return u + "/chat/completions";
    }

    static String openaiModelsUrl(String endpoint) {
        String u = withScheme(endpoint, "https://api.openai.com/v1");
        if (u.toLowerCase().endsWith("/chat/completions")) return u.substring(0, u.length() - "/chat/completions".length()) + "/models";
        if (u.toLowerCase().endsWith("/models")) return u;
        return u + "/models";
    }

    static String anthropicBase(String endpoint) {
        String u = withScheme(endpoint, "https://api.anthropic.com");
        if (u.toLowerCase().endsWith("/v1/messages")) u = u.substring(0, u.length() - "/v1/messages".length());
        if (u.toLowerCase().endsWith("/v1")) u = u.substring(0, u.length() - "/v1".length());
        return u;
    }

    static String geminiBase(String endpoint) {
        String u = withScheme(endpoint, "https://generativelanguage.googleapis.com/v1beta");
        if (u.toLowerCase().endsWith("/models")) u = u.substring(0, u.length() - "/models".length());
        return u;
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    // ================= 对话 =================

    static Result chat(Settings s, String prompt, boolean stream, int maxTokensOverride,
                       DeltaListener listener, Cancel cancel) throws Exception {
        String provider = s.apiProvider == null ? Settings.P_OPENAI : s.apiProvider;
        int maxTokens = maxTokensOverride > 0 ? maxTokensOverride : s.maxTokens;
        String url;
        JSONObject body = new JSONObject();
        HttpURLConnection conn;

        if (Settings.P_ANTHROPIC.equals(provider)) {
            url = anthropicBase(s.apiEndpoint) + "/v1/messages";
            body.put("model", s.apiModel);
            body.put("max_tokens", maxTokens > 0 ? maxTokens : 16000);
            JSONArray msgs = new JSONArray();
            msgs.put(new JSONObject().put("role", "user").put("content", prompt));
            body.put("messages", msgs);
            body.put("temperature", s.temperature);
            body.put("stream", stream);
            conn = open(url, s);
            conn.setRequestProperty("x-api-key", s.apiKey == null ? "" : s.apiKey);
            conn.setRequestProperty("anthropic-version", "2023-06-01");
        } else if (Settings.P_GEMINI.equals(provider)) {
            String base = geminiBase(s.apiEndpoint) + "/models/" + s.apiModel;
            url = stream
                    ? base + ":streamGenerateContent?alt=sse&key=" + enc(s.apiKey)
                    : base + ":generateContent?key=" + enc(s.apiKey);
            JSONArray contents = new JSONArray();
            contents.put(new JSONObject().put("role", "user")
                    .put("parts", new JSONArray().put(new JSONObject().put("text", prompt))));
            body.put("contents", contents);
            JSONObject gen = new JSONObject();
            gen.put("temperature", s.temperature);
            if (maxTokens > 0) gen.put("maxOutputTokens", maxTokens);
            body.put("generationConfig", gen);
            // 小说里打斗、恋爱情节很常见，默认的安全过滤会把正常段落拦掉
            JSONArray safety = new JSONArray();
            for (String cat : new String[] {"HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
                    "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"}) {
                safety.put(new JSONObject().put("category", cat).put("threshold", "BLOCK_NONE"));
            }
            body.put("safetySettings", safety);
            conn = open(url, s);
        } else {
            url = openaiChatUrl(s.apiEndpoint);
            body.put("model", TextUtil.isBlank(s.apiModel) ? "local-model" : s.apiModel);
            JSONArray msgs = new JSONArray();
            msgs.put(new JSONObject().put("role", "user").put("content", prompt));
            body.put("messages", msgs);
            body.put("temperature", s.temperature);
            body.put("stream", stream);
            if (maxTokens > 0) body.put("max_tokens", maxTokens);
            conn = open(url, s);
            if (!TextUtil.isBlank(s.apiKey)) conn.setRequestProperty("Authorization", "Bearer " + s.apiKey.trim());
        }

        if (cancel != null) {
            cancel.conn = conn;
            if (cancel.cancelled) throw new IOException("已停止");
        }
        if (stream) {
            conn.setRequestProperty("Accept", "text/event-stream");
            // 有的网关对 gzip 的 SSE 会整段缓冲，流式就变成一次性蹦出来
            conn.setRequestProperty("Accept-Encoding", "identity");
        }
        conn.setDoOutput(true);
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(payload.length);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload);
        }

        int code;
        try {
            code = conn.getResponseCode();
        } catch (SocketTimeoutException e) {
            throw new ApiException(0, "等待响应超时（" + s.apiTimeout + "秒）");
        }
        if (code >= 400) {
            String err = readAll(conn.getErrorStream());
            conn.disconnect();
            throw new ApiException(code, "HTTP " + code + ": " + errorMessage(err));
        }

        Result r = new Result();
        try {
            String ctype = conn.getContentType() == null ? "" : conn.getContentType().toLowerCase();
            if (stream && !ctype.contains("application/json")) {
                readStream(provider, conn.getInputStream(), r, listener);
            } else {
                // 没开流式，或者服务端无视 stream 直接回了一整个 JSON
                String all = readAll(conn.getInputStream());
                String trimmed = all.trim();
                if (trimmed.startsWith("data:")) {
                    readStream(provider, new java.io.ByteArrayInputStream(all.getBytes(StandardCharsets.UTF_8)), r, listener);
                } else {
                    parseWhole(provider, trimmed, r);
                    if (listener != null && !r.text.isEmpty()) listener.onDelta(r.text);
                }
            }
        } catch (SocketTimeoutException e) {
            throw new ApiException(0, "超过 " + s.apiTimeout + " 秒没有收到新内容，判定卡死");
        } finally {
            conn.disconnect();
        }
        return r;
    }

    private static HttpURLConnection open(String url, Settings s) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(30000);
        c.setReadTimeout(Math.max(10, s.apiTimeout) * 1000);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        c.setUseCaches(false);
        return c;
    }

    private static void readStream(String provider, InputStream in, Result r, DeltaListener listener) throws Exception {
        StringBuilder text = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            StringBuilder data = new StringBuilder();
            while ((line = br.readLine()) != null) {
                if (line.isEmpty()) {
                    if (data.length() > 0) {
                        if (handleEvent(provider, data.toString(), r, text, listener)) break;
                        data.setLength(0);
                    }
                    continue;
                }
                if (line.startsWith(":")) continue; // SSE 注释 / 心跳
                if (line.startsWith("data:")) {
                    String d = line.substring(5);
                    if (d.startsWith(" ")) d = d.substring(1);
                    // 大多数服务一行一个事件；遇到多行 data 时拼起来
                    if (data.length() > 0) data.append('\n');
                    data.append(d);
                    // 单行就是完整 JSON 时立即处理，不必等空行（有的服务不发空行）
                    String cur = data.toString().trim();
                    if (cur.equals("[DONE]") || (cur.startsWith("{") && cur.endsWith("}") && looksComplete(cur))) {
                        if (handleEvent(provider, cur, r, text, listener)) break;
                        data.setLength(0);
                    }
                }
            }
            if (data.length() > 0) handleEvent(provider, data.toString(), r, text, listener);
        }
        r.text = text.toString();
    }

    private static boolean looksComplete(String json) {
        try {
            new JSONObject(json);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** @return true 表示流结束 */
    private static boolean handleEvent(String provider, String data, Result r, StringBuilder text,
                                       DeltaListener listener) throws Exception {
        String d = data.trim();
        if (d.isEmpty()) return false;
        if (d.equals("[DONE]")) return true;
        JSONObject o;
        try {
            o = new JSONObject(d);
        } catch (Exception e) {
            return false;
        }
        if (o.has("error")) {
            Object e = o.opt("error");
            String msg = e instanceof JSONObject ? ((JSONObject) e).optString("message", e.toString()) : String.valueOf(e);
            throw new ApiException(500, "接口在流中返回错误: " + msg);
        }
        String delta = "";
        if (Settings.P_ANTHROPIC.equals(provider)) {
            String type = o.optString("type");
            if ("content_block_delta".equals(type)) {
                JSONObject dl = o.optJSONObject("delta");
                if (dl != null) delta = dl.optString("text", "");
            } else if ("message_delta".equals(type)) {
                JSONObject dl = o.optJSONObject("delta");
                if (dl != null && !dl.isNull("stop_reason")) r.finishReason = dl.optString("stop_reason", "");
            } else if ("message_stop".equals(type)) {
                return true;
            }
        } else if (Settings.P_GEMINI.equals(provider)) {
            delta = geminiText(o, r);
        } else {
            JSONArray ch = o.optJSONArray("choices");
            if (ch != null && ch.length() > 0) {
                JSONObject c0 = ch.optJSONObject(0);
                if (c0 != null) {
                    JSONObject dl = c0.optJSONObject("delta");
                    if (dl != null && !dl.isNull("content")) delta = dl.optString("content", "");
                    else if (c0.has("text") && !c0.isNull("text")) delta = c0.optString("text", "");
                    if (!c0.isNull("finish_reason")) {
                        String f = c0.optString("finish_reason", "");
                        if (!f.isEmpty()) r.finishReason = f;
                    }
                }
            }
        }
        if (!delta.isEmpty()) {
            text.append(delta);
            if (listener != null) listener.onDelta(delta);
        }
        return false;
    }

    private static String geminiText(JSONObject o, Result r) throws ApiException {
        JSONObject fb = o.optJSONObject("promptFeedback");
        if (fb != null && fb.has("blockReason")) {
            throw new ApiException(400, "Gemini 拒绝了这段内容（" + fb.optString("blockReason") + "）");
        }
        StringBuilder sb = new StringBuilder();
        JSONArray cands = o.optJSONArray("candidates");
        if (cands != null && cands.length() > 0) {
            JSONObject c0 = cands.optJSONObject(0);
            if (c0 != null) {
                String f = c0.optString("finishReason", "");
                if (!f.isEmpty() && !"STOP".equals(f)) r.finishReason = f;
                JSONObject content = c0.optJSONObject("content");
                JSONArray parts = content == null ? null : content.optJSONArray("parts");
                if (parts != null) {
                    for (int i = 0; i < parts.length(); i++) {
                        JSONObject p = parts.optJSONObject(i);
                        // thought=true 的是思考过程，不算译文
                        if (p != null && !p.optBoolean("thought", false)) sb.append(p.optString("text", ""));
                    }
                }
            }
        }
        return sb.toString();
    }

    private static void parseWhole(String provider, String json, Result r) throws Exception {
        JSONObject o = new JSONObject(json);
        if (Settings.P_ANTHROPIC.equals(provider)) {
            JSONArray content = o.optJSONArray("content");
            StringBuilder sb = new StringBuilder();
            if (content != null) {
                for (int i = 0; i < content.length(); i++) {
                    JSONObject c = content.optJSONObject(i);
                    if (c != null && "text".equals(c.optString("type", "text"))) sb.append(c.optString("text", ""));
                }
            }
            r.text = sb.toString();
            r.finishReason = o.optString("stop_reason", "");
        } else if (Settings.P_GEMINI.equals(provider)) {
            r.text = geminiText(o, r);
        } else {
            JSONArray ch = o.optJSONArray("choices");
            if (ch != null && ch.length() > 0) {
                JSONObject c0 = ch.getJSONObject(0);
                JSONObject msg = c0.optJSONObject("message");
                if (msg != null && !msg.isNull("content")) r.text = msg.optString("content", "");
                else r.text = c0.optString("text", "");
                r.finishReason = c0.isNull("finish_reason") ? "" : c0.optString("finish_reason", "");
            }
        }
    }

    // ================= 拉取模型 =================

    static List<String> fetchModels(Settings s) throws Exception {
        String provider = s.apiProvider == null ? Settings.P_OPENAI : s.apiProvider;
        String url;
        HttpURLConnection c;
        if (Settings.P_ANTHROPIC.equals(provider)) {
            if (TextUtil.isBlank(s.apiKey)) throw new IOException("请先填写 API Key");
            url = anthropicBase(s.apiEndpoint) + "/v1/models?limit=100";
            c = get(url);
            c.setRequestProperty("x-api-key", s.apiKey.trim());
            c.setRequestProperty("anthropic-version", "2023-06-01");
        } else if (Settings.P_GEMINI.equals(provider)) {
            if (TextUtil.isBlank(s.apiKey)) throw new IOException("请先填写 API Key");
            url = geminiBase(s.apiEndpoint) + "/models?pageSize=200&key=" + enc(s.apiKey.trim());
            c = get(url);
        } else {
            url = openaiModelsUrl(s.apiEndpoint);
            c = get(url);
            if (!TextUtil.isBlank(s.apiKey)) c.setRequestProperty("Authorization", "Bearer " + s.apiKey.trim());
        }
        int code = c.getResponseCode();
        if (code >= 400) {
            String err = readAll(c.getErrorStream());
            c.disconnect();
            throw new ApiException(code, "HTTP " + code + ": " + errorMessage(err));
        }
        String all = readAll(c.getInputStream());
        c.disconnect();

        List<String> out = new ArrayList<>();
        String t = all.trim();
        if (t.startsWith("[")) {
            JSONArray arr = new JSONArray(t);
            for (int i = 0; i < arr.length(); i++) addModel(out, arr.opt(i), false);
            return out;
        }
        JSONObject o = new JSONObject(t);
        JSONArray arr = o.optJSONArray("data");
        if (arr == null) arr = o.optJSONArray("models");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            Object m = arr.opt(i);
            if (Settings.P_GEMINI.equals(provider) && m instanceof JSONObject) {
                JSONArray methods = ((JSONObject) m).optJSONArray("supportedGenerationMethods");
                if (methods != null && !methods.toString().contains("generateContent")) continue;
            }
            addModel(out, m, Settings.P_GEMINI.equals(provider));
        }
        return out;
    }

    private static void addModel(List<String> out, Object m, boolean stripPrefix) {
        String id;
        if (m instanceof JSONObject) {
            JSONObject j = (JSONObject) m;
            id = j.optString("id", j.optString("name", ""));
        } else {
            id = String.valueOf(m);
        }
        if (stripPrefix && id.startsWith("models/")) id = id.substring("models/".length());
        if (!id.isEmpty() && !out.contains(id)) out.add(id);
    }

    private static HttpURLConnection get(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("GET");
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        return c;
    }

    // ================= 工具 =================

    static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            char[] buf = new char[8192];
            int n;
            while ((n = br.read(buf)) > 0) sb.append(buf, 0, n);
        }
        return sb.toString();
    }

    static String errorMessage(String body) {
        if (body == null) return "";
        String b = body.trim();
        try {
            Object parsed = b.startsWith("[") ? new JSONArray(b).opt(0) : new JSONObject(b);
            if (parsed instanceof JSONObject) {
                JSONObject o = (JSONObject) parsed;
                Object e = o.opt("error");
                if (e instanceof JSONObject) return ((JSONObject) e).optString("message", e.toString());
                if (e != null) return String.valueOf(e);
                if (o.has("message")) return o.optString("message");
            }
        } catch (Exception ignored) {
        }
        return b.length() > 300 ? b.substring(0, 300) : b;
    }
}
