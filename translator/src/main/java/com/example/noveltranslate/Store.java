package com.example.noveltranslate;

import android.util.JsonWriter;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 设置 / 任务 / 配置的 JSON 读写。
 *
 * 字段和网页版保持一致：网页版导出的「任务 json」「配置 json」这里能直接导入，反之亦然。
 * 写用 JsonWriter 流式输出——整本小说原文加译文可能有十几 MB，拼成一个大字符串很吃内存。
 */
final class Store {
    private Store() {}

    static final String TYPE_TASK = "novelTranslateTask";
    static final String TYPE_CONFIG = "novelTranslateConfig";
    static final String VERSION = "1.0.0-android";

    // ================= 写 =================

    static void writeSettings(JsonWriter w, Settings s, boolean withKey) throws IOException {
        w.name("apiProvider").value(s.apiProvider);
        w.name("apiEndpoint").value(s.apiEndpoint);
        if (withKey) w.name("apiKey").value(s.apiKey);
        w.name("apiModel").value(s.apiModel);
        w.name("apiTimeout").value(s.apiTimeout);
        w.name("temperature").value(s.temperature);
        w.name("maxTokens").value(s.maxTokens);
        w.name("maxRetries").value(s.maxRetries);
        w.name("blockAsChapter").value(s.blockAsChapter);
        w.name("chunkTokens").value(s.chunkTokens);
        w.name("concurrency").value(s.concurrency);
        w.name("warmupChapters").value(s.warmupChapters);
        w.name("contextPrevChars").value(s.contextPrevChars);
        w.name("contextNextChars").value(s.contextNextChars);
        w.name("customPrompt").value(s.customPrompt);
        w.name("glossaryEnabled").value(s.glossaryEnabled);
        w.name("autoGlossary").value(s.autoGlossary);
        w.name("chapterRegex").value(s.chapterRegex);
        w.name("exportSplitByRegex").value(s.exportSplitByRegex);
        w.name("bookTitle").value(s.bookTitle);
        w.name("bookAuthor").value(s.bookAuthor);
        w.name("txtTitleFormat").value(s.txtTitleFormat);
        w.name("glossary").beginArray();
        for (Settings.Term t : s.glossarySnapshot()) {
            w.beginObject().name("source").value(t.source).name("target").value(t.target).endObject();
        }
        w.endArray();
    }

    static void writeChapters(JsonWriter w, List<Chapter> list) throws IOException {
        w.name("chapters").beginArray();
        for (Chapter c : list) {
            w.beginObject();
            w.name("index").value(c.index);
            w.name("num").value(c.num);
            w.name("unit").value(c.unit);
            w.name("rawTitle").value(c.rawTitle);
            w.name("title").value(c.title);
            w.name("source").value(c.source);
            w.name("translated").value(c.translated);
            // 运行中的块落盘时记成待翻译，进程被杀后重开不会卡在「翻译中」
            String st = Chapter.RUNNING.equals(c.status) ? Chapter.PENDING : c.status;
            w.name("status").value(st);
            w.name("error").value(c.error);
            w.endObject();
        }
        w.endArray();
    }

    /** 应用内部存档：设置（含 Key）+ 当前任务 */
    static void writeState(OutputStream os, Settings s, String fileName, int startIndex, List<Chapter> list) throws IOException {
        JsonWriter w = new JsonWriter(new OutputStreamWriter(os, StandardCharsets.UTF_8));
        w.beginObject();
        w.name("type").value("novelTranslateState");
        w.name("settings").beginObject();
        writeSettings(w, s, true);
        w.endObject();
        w.name("fileName").value(fileName);
        w.name("startIndex").value(startIndex);
        writeChapters(w, list);
        w.endObject();
        w.flush();
    }

    /** 导出任务：原文 + 译文 + 术语表 + 分块/导出相关设置。不含 API Key。 */
    static void writeTask(OutputStream os, Settings s, String fileName, List<Chapter> list) throws IOException {
        JsonWriter w = new JsonWriter(new OutputStreamWriter(os, StandardCharsets.UTF_8));
        w.setIndent(" ");
        w.beginObject();
        w.name("type").value(TYPE_TASK);
        w.name("version").value(VERSION);
        w.name("exportedAt").value(String.valueOf(System.currentTimeMillis()));
        w.name("fileName").value(fileName);
        w.name("blockAsChapter").value(s.blockAsChapter);
        w.name("chunkTokens").value(s.chunkTokens);
        w.name("chapterRegex").value(s.chapterRegex);
        w.name("bookTitle").value(s.bookTitle);
        w.name("bookAuthor").value(s.bookAuthor);
        w.name("glossary").beginArray();
        for (Settings.Term t : s.glossarySnapshot()) {
            w.beginObject().name("source").value(t.source).name("target").value(t.target).endObject();
        }
        w.endArray();
        writeChapters(w, list);
        w.endObject();
        w.flush();
    }

    static void writeConfig(OutputStream os, Settings s, boolean withKey) throws IOException {
        JsonWriter w = new JsonWriter(new OutputStreamWriter(os, StandardCharsets.UTF_8));
        w.setIndent("  ");
        w.beginObject();
        w.name("type").value(TYPE_CONFIG);
        w.name("version").value(VERSION);
        writeSettings(w, s, withKey);
        w.endObject();
        w.flush();
    }

    // ================= 读 =================

    /**
     * 把 JSON 里认得的设置项合并进 s。
     * @return 实际读到的设置项个数
     */
    static int readSettings(JSONObject o, Settings s, boolean allowKey) {
        int n = 0;
        if (o.has("apiProvider")) { s.apiProvider = normProvider(o.optString("apiProvider")); n++; }
        if (o.has("apiEndpoint")) { s.apiEndpoint = o.optString("apiEndpoint", ""); n++; }
        if (allowKey && o.has("apiKey") && !o.optString("apiKey", "").isEmpty()) { s.apiKey = o.optString("apiKey"); n++; }
        if (o.has("apiModel")) { s.apiModel = o.optString("apiModel", ""); n++; }
        if (o.has("apiTimeout")) {
            int t = o.optInt("apiTimeout", s.apiTimeout);
            if (t > 1000) t = t / 1000; // 有的版本按毫秒存
            if (t > 0) s.apiTimeout = t;
            n++;
        }
        if (o.has("temperature")) { s.temperature = o.optDouble("temperature", s.temperature); n++; }
        if (o.has("maxTokens")) { s.maxTokens = Math.max(0, o.optInt("maxTokens", 0)); n++; }
        if (o.has("maxRetries")) { s.maxRetries = clamp(o.optInt("maxRetries", 3), 0, 10); n++; }
        if (o.has("blockAsChapter")) { s.blockAsChapter = o.optBoolean("blockAsChapter"); n++; }
        else if (o.has("forceChunkMode")) { s.blockAsChapter = o.optBoolean("forceChunkMode"); n++; }
        if (o.has("chunkTokens")) { s.chunkTokens = clamp(o.optInt("chunkTokens", s.chunkTokens), 200, 200000); n++; }
        if (o.has("concurrency")) { s.concurrency = clamp(o.optInt("concurrency", s.concurrency), 1, 20); n++; }
        if (o.has("warmupChapters")) { s.warmupChapters = clamp(o.optInt("warmupChapters", 0), 0, 50); n++; }
        if (o.has("contextPrevChars")) { s.contextPrevChars = clamp(o.optInt("contextPrevChars", 0), 0, 5000); n++; }
        if (o.has("contextNextChars")) { s.contextNextChars = clamp(o.optInt("contextNextChars", 0), 0, 5000); n++; }
        if (o.has("customPrompt") && !o.optString("customPrompt", "").trim().isEmpty()) {
            s.customPrompt = o.optString("customPrompt"); n++;
        }
        if (o.has("glossaryEnabled")) { s.glossaryEnabled = o.optBoolean("glossaryEnabled", true); n++; }
        if (o.has("autoGlossary")) { s.autoGlossary = o.optBoolean("autoGlossary", true); n++; }
        if (o.has("chapterRegex") && !o.optString("chapterRegex", "").isEmpty()) { s.chapterRegex = o.optString("chapterRegex"); n++; }
        if (o.has("exportSplitByRegex")) { s.exportSplitByRegex = o.optBoolean("exportSplitByRegex", true); n++; }
        if (o.has("bookTitle")) { s.bookTitle = o.optString("bookTitle", ""); n++; }
        if (o.has("bookAuthor")) { s.bookAuthor = o.optString("bookAuthor", ""); n++; }
        if (o.has("txtTitleFormat")) { s.txtTitleFormat = o.optString("txtTitleFormat", "original"); n++; }
        JSONArray g = o.optJSONArray("glossary");
        if (g != null) {
            List<Settings.Term> terms = readTerms(g);
            synchronized (s.glossary) {
                s.glossary.clear();
                s.glossary.addAll(terms);
            }
            n++;
        }
        return n;
    }

    static List<Settings.Term> readTerms(JSONArray g) {
        List<Settings.Term> out = new ArrayList<>();
        for (int i = 0; i < g.length(); i++) {
            JSONObject t = g.optJSONObject(i);
            if (t == null) continue;
            String src = t.optString("source", t.optString("original", "")).trim();
            String dst = t.optString("target", t.optString("translation", "")).trim();
            if (!src.isEmpty() && !dst.isEmpty()) out.add(new Settings.Term(src, dst));
        }
        return out;
    }

    static List<Chapter> readChapters(JSONArray arr) {
        List<Chapter> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Chapter c = new Chapter();
            c.index = out.size();
            c.num = o.optString("num", String.valueOf(out.size() + 1));
            c.unit = o.optString("unit", "");
            c.rawTitle = o.optString("rawTitle", "第" + (out.size() + 1) + "部分");
            c.title = o.optString("title", c.rawTitle);
            c.source = o.optString("source", "");
            c.translated = o.isNull("translated") ? "" : o.optString("translated", "");
            String st = o.optString("status", Chapter.PENDING);
            if (Chapter.RUNNING.equals(st)) st = Chapter.PENDING;
            if (!Chapter.DONE.equals(st) && !Chapter.FAILED.equals(st)) st = Chapter.PENDING;
            if (Chapter.DONE.equals(st) && TextUtil.isBlank(c.translated)) st = Chapter.PENDING;
            c.status = st;
            c.error = o.optString("error", "");
            out.add(c);
        }
        return out;
    }

    static String normProvider(String p) {
        if (p == null) return Settings.P_OPENAI;
        String x = p.toLowerCase();
        if (x.contains("gemini") || x.contains("google")) return Settings.P_GEMINI;
        if (x.contains("anthropic") || x.contains("claude")) return Settings.P_ANTHROPIC;
        return Settings.P_OPENAI;
    }

    static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
