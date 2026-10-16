package com.example.noveltranslate;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 全局状态 + 翻译调度。整个进程只有一个实例。
 *
 * 界面（Activity）随时可能被销毁重建，翻译不能挂在它身上；
 * 这里的工作线程由前台服务保活，Activity 只是来回订阅。
 */
final class Engine {
    interface Listener {
        /** 块状态 / 进度变了，刷新列表 */
        void onChanged();

        /** 实时输出更新（已节流） */
        void onStream(String text);

        void onLog(String line);
    }

    private static Engine instance;

    static synchronized Engine get(Context ctx) {
        if (instance == null) {
            instance = new Engine(ctx.getApplicationContext());
            instance.load();
        }
        return instance;
    }

    final Context app;
    final Settings settings = new Settings();
    volatile List<Chapter> chapters = new ArrayList<>();
    String fileName = "";
    int startIndex = 0;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<Listener> listeners = new ArrayList<>();

    // ---- 运行状态 ----
    private volatile boolean running;
    private volatile boolean stopped;
    private final List<ApiClient.Cancel> cancels = Collections.synchronizedList(new ArrayList<>());
    private final Map<Integer, StringBuilder> live = Collections.synchronizedMap(new LinkedHashMap<>());
    private volatile int focusIndex = -1;
    private final StringBuilder logBuf = new StringBuilder();
    private long runStartedAt;
    private final AtomicInteger runDone = new AtomicInteger();
    private int runTotal;
    String runLabel = "";

    private Engine(Context app) {
        this.app = app;
    }

    boolean isRunning() {
        return running;
    }

    // ================= 订阅 =================

    void addListener(Listener l) {
        if (!listeners.contains(l)) listeners.add(l);
    }

    void removeListener(Listener l) {
        listeners.remove(l);
    }

    private boolean changedPosted;
    private long lastChanged;

    void fireChanged() {
        // 并发跑的时候状态变化很密，界面每秒最多刷 6 次就够了
        synchronized (this) {
            if (changedPosted) return;
            changedPosted = true;
        }
        long wait = Math.max(0, 160 - (SystemClock.uptimeMillis() - lastChanged));
        main.postDelayed(() -> {
            synchronized (Engine.this) {
                changedPosted = false;
            }
            lastChanged = SystemClock.uptimeMillis();
            for (Listener l : new ArrayList<>(listeners)) l.onChanged();
            TranslateService.updateNotification(app, progressLine());
        }, wait);
    }

    private boolean streamPosted;

    private void fireStream() {
        synchronized (this) {
            if (streamPosted) return;
            streamPosted = true;
        }
        main.postDelayed(() -> {
            synchronized (Engine.this) {
                streamPosted = false;
            }
            String t = streamText();
            for (Listener l : new ArrayList<>(listeners)) l.onStream(t);
        }, 150);
    }

    void log(String msg) {
        final String line = msg;
        synchronized (logBuf) {
            logBuf.append(line).append('\n');
            if (logBuf.length() > 20000) logBuf.delete(0, logBuf.length() - 15000);
        }
        main.post(() -> {
            for (Listener l : new ArrayList<>(listeners)) l.onLog(line);
        });
    }

    String logText() {
        synchronized (logBuf) {
            return logBuf.toString();
        }
    }

    /** 实时输出只盯一块：最早开始、还没跑完的那块，免得几块交错在一起看不懂 */
    String streamText() {
        int idx = focusIndex;
        StringBuilder sb = idx >= 0 ? live.get(idx) : null;
        if (sb == null) {
            synchronized (live) {
                for (Map.Entry<Integer, StringBuilder> e : live.entrySet()) {
                    idx = e.getKey();
                    sb = e.getValue();
                    break;
                }
            }
        }
        if (sb == null) return "";
        String body;
        synchronized (sb) {
            body = TextUtil.tail(sb.toString(), 3000);
        }
        return "【第" + (idx + 1) + "块】\n" + body;
    }

    // ================= 统计 =================

    int countStatus(String st) {
        int n = 0;
        for (Chapter c : chapters) if (st.equals(c.status)) n++;
        return n;
    }

    int countDone() {
        int n = 0;
        for (Chapter c : chapters) if (c.isDone()) n++;
        return n;
    }

    int totalTokens() {
        int n = 0;
        for (Chapter c : chapters) n += c.tokens();
        return n;
    }

    String progressLine() {
        int total = chapters.size();
        int done = countDone();
        int failed = countStatus(Chapter.FAILED);
        StringBuilder sb = new StringBuilder();
        sb.append("已完成 ").append(done).append('/').append(total);
        if (failed > 0) sb.append(" · 失败 ").append(failed);
        if (running) {
            int d = runDone.get();
            if (d > 0 && runTotal > d) {
                long per = (SystemClock.elapsedRealtime() - runStartedAt) / d;
                long left = per * (runTotal - d) / 1000;
                sb.append(" · 剩余约 ").append(formatDuration(left));
            }
        }
        return sb.toString();
    }

    static String formatDuration(long sec) {
        if (sec < 60) return sec + "秒";
        if (sec < 3600) return (sec / 60) + "分" + (sec % 60) + "秒";
        return (sec / 3600) + "小时" + (sec % 3600 / 60) + "分";
    }

    // ================= 存档 =================

    private File stateFile() {
        return new File(app.getFilesDir(), "state.json");
    }

    private void load() {
        File f = stateFile();
        if (!f.exists()) return;
        try {
            byte[] b = readFile(f);
            JSONObject o = new JSONObject(new String(b, "UTF-8"));
            JSONObject so = o.optJSONObject("settings");
            if (so != null) Store.readSettings(so, settings, true);
            chapters = Store.readChapters(o.optJSONArray("chapters"));
            fileName = o.optString("fileName", "");
            startIndex = Math.max(0, Math.min(o.optInt("startIndex", 0), Math.max(0, chapters.size() - 1)));
        } catch (Exception e) {
            log("读取存档失败: " + e.getMessage());
        }
    }

    static byte[] readFile(File f) throws IOException {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream((int) Math.max(1024, f.length()));
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        }
    }

    private volatile boolean savePending;

    /** 节流存盘：一秒内多次改动只写一次。先写临时文件再改名，写一半被杀也不会坏档。 */
    void saveSoon() {
        if (savePending) return;
        savePending = true;
        io.execute(() -> {
            try {
                Thread.sleep(800);
            } catch (InterruptedException ignored) {
            }
            savePending = false;
            saveNowBlocking();
        });
    }

    synchronized void saveNowBlocking() {
        File f = stateFile();
        File tmp = new File(f.getParentFile(), "state.json.tmp");
        try (FileOutputStream os = new FileOutputStream(tmp)) {
            Store.writeState(os, settings, fileName, startIndex, new ArrayList<>(chapters));
            os.getFD().sync();
        } catch (Exception e) {
            log("保存失败: " + e.getMessage());
            return;
        }
        if (!tmp.renameTo(f)) {
            f.delete();
            tmp.renameTo(f);
        }
    }

    // ================= 编辑操作（只允许在空闲时做） =================

    void setChapters(List<Chapter> list, String name) {
        chapters = list;
        if (name != null) fileName = name;
        startIndex = 0;
        saveSoon();
        fireChanged();
    }

    /** 合并、删除、重切后替换列表：保留文件名，起始块收敛到范围内 */
    void replaceChapters(List<Chapter> list) {
        TextUtil.renumber(list);
        chapters = list;
        if (startIndex >= list.size()) startIndex = 0;
        saveSoon();
        fireChanged();
    }

    // ================= 翻译调度 =================

    /** 从 startIndex 起，翻所有还没完成的块 */
    void startFrom(Context ctx, int from) {
        List<Chapter> targets = new ArrayList<>();
        List<Chapter> list = chapters;
        for (int i = Math.max(0, from); i < list.size(); i++) {
            if (!list.get(i).isDone()) targets.add(list.get(i));
        }
        start(ctx, targets, from > 0 ? "从第" + (from + 1) + "块开始" : "开始翻译");
    }

    void start(Context ctx, List<Chapter> targets, String label) {
        if (running) return;
        if (targets.isEmpty()) {
            log("没有需要翻译的块");
            return;
        }
        running = true;
        stopped = false;
        runLabel = label;
        runTotal = targets.size();
        runDone.set(0);
        runStartedAt = SystemClock.elapsedRealtime();
        live.clear();
        focusIndex = -1;

        Intent it = new Intent(ctx, TranslateService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(it);
        else ctx.startService(it);

        final List<Chapter> todo = new ArrayList<>(targets);
        log("🚀 " + label + "：共 " + todo.size() + " 块，并发 " + settings.concurrency
                + "，" + (settings.blockAsChapter ? "一块 = 一章" : "沿用原文章节"));
        fireChanged();

        Thread t = new Thread(() -> runAll(todo), "translate-main");
        t.start();
    }

    private void runAll(List<Chapter> todo) {
        try {
            // 预热：前几块串行跑，先把人名地名的译法定下来，后面并发时术语表已经有货了
            int warm = Math.min(Math.max(0, settings.warmupChapters), todo.size());
            int i = 0;
            for (; i < warm && !stopped; i++) runOne(todo.get(i));

            if (!stopped && i < todo.size()) {
                int conc = Math.max(1, Math.min(20, settings.concurrency));
                ExecutorService pool = Executors.newFixedThreadPool(conc);
                for (int k = i; k < todo.size(); k++) {
                    final Chapter c = todo.get(k);
                    pool.execute(() -> {
                        if (!stopped) runOne(c);
                    });
                }
                pool.shutdown();
                while (!pool.awaitTermination(1, TimeUnit.SECONDS)) {
                    if (stopped) {
                        pool.shutdownNow();
                        pool.awaitTermination(5, TimeUnit.SECONDS);
                        break;
                    }
                }
            }
        } catch (InterruptedException ignored) {
        } finally {
            int failed = 0;
            for (Chapter c : todo) {
                if (Chapter.RUNNING.equals(c.status)) c.status = c.isDone() ? Chapter.DONE : Chapter.PENDING;
                if (Chapter.FAILED.equals(c.status)) failed++;
            }
            running = false;
            live.clear();
            saveNowBlocking();
            long sec = (SystemClock.elapsedRealtime() - runStartedAt) / 1000;
            log((stopped ? "⏹ 已停止" : "✅ " + runLabel + "完成")
                    + "，本轮完成 " + runDone.get() + " 块" + (failed > 0 ? "，失败 " + failed + " 块" : "")
                    + "，用时 " + formatDuration(sec));
            main.post(() -> app.stopService(new Intent(app, TranslateService.class)));
            fireChanged();
        }
    }

    void stop() {
        if (!running) return;
        stopped = true;
        synchronized (cancels) {
            for (ApiClient.Cancel c : cancels) c.cancel();
        }
        log("正在停止…");
    }

    private void runOne(Chapter ch) {
        ch.status = Chapter.RUNNING;
        ch.error = "";
        fireChanged();

        List<Chapter> list = chapters;
        int pos = list.indexOf(ch);
        String prev = pos > 0 ? TextUtil.tail(list.get(pos - 1).source, settings.contextPrevChars) : "";
        String next = pos >= 0 && pos + 1 < list.size() ? TextUtil.head(list.get(pos + 1).source, settings.contextNextChars) : "";

        int maxRetries = Math.max(0, settings.maxRetries);
        String lastErr = "";
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            if (stopped) {
                ch.status = ch.isDone() ? Chapter.DONE : Chapter.PENDING;
                fireChanged();
                return;
            }
            // 每次重试都重新取术语表：前面并发跑完的块可能刚补了新术语
            List<Settings.Term> terms = settings.glossaryEnabled
                    ? PromptBuilder.relevantTerms(settings.glossarySnapshot(), ch.source)
                    : new ArrayList<Settings.Term>();
            String prompt = PromptBuilder.build(settings, ch, prev, next, terms);

            final StringBuilder buf = new StringBuilder();
            live.put(ch.index, buf);
            if (focusIndex < 0 || live.get(focusIndex) == null) focusIndex = ch.index;
            ApiClient.Cancel cancel = new ApiClient.Cancel();
            cancels.add(cancel);
            try {
                ApiClient.Result r = ApiClient.chat(settings, prompt, true, 0, d -> {
                    synchronized (buf) {
                        buf.append(d);
                    }
                    if (focusIndex == ch.index) fireStream();
                }, cancel);

                String tr = PromptBuilder.extractTranslation(r.text);
                if (TextUtil.isBlank(tr)) {
                    throw new ApiClient.ApiException(0, "返回内容为空" + (r.finishReason.isEmpty() ? "" : "（" + r.finishReason + "）"));
                }
                if (settings.glossaryEnabled && settings.autoGlossary) {
                    int added = settings.addTerms(PromptBuilder.extractTerms(r.text));
                    if (added > 0) log("📗 第" + (ch.index + 1) + "块新增术语 " + added + " 条");
                }
                ch.translated = tr;
                if (r.truncated()) {
                    // 半截译文先留着，用户可以在详情里看、手改后保存
                    ch.status = Chapter.FAILED;
                    ch.error = "输出被截断（达到最大输出），请调大「最大输出」或调小「每块token上限」后重翻";
                    log("⚠️ 第" + (ch.index + 1) + "块输出被截断");
                } else {
                    ch.status = Chapter.DONE;
                    ch.error = "";
                    runDone.incrementAndGet();
                }
                finishLive(ch);
                saveSoon();
                fireChanged();
                return;
            } catch (Exception e) {
                if (stopped || cancel.cancelled) {
                    ch.status = ch.isDone() ? Chapter.DONE : Chapter.PENDING;
                    finishLive(ch);
                    fireChanged();
                    return;
                }
                lastErr = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                boolean retry = !(e instanceof ApiClient.ApiException) || ((ApiClient.ApiException) e).retryable();
                if (!retry || attempt >= maxRetries) break;
                int code = e instanceof ApiClient.ApiException ? ((ApiClient.ApiException) e).code : 0;
                long wait = code == 429 ? 15000L * (attempt + 1) : 3000L * (1L << attempt);
                log("↻ 第" + (ch.index + 1) + "块失败，" + (wait / 1000) + "秒后重试（" + (attempt + 1) + "/" + maxRetries + "）：" + lastErr);
                sleepUnlessStopped(wait);
            } finally {
                cancels.remove(cancel);
            }
        }
        ch.status = Chapter.FAILED;
        ch.error = lastErr;
        finishLive(ch);
        log("❌ 第" + (ch.index + 1) + "块失败：" + lastErr);
        saveSoon();
        fireChanged();
    }

    private void finishLive(Chapter ch) {
        live.remove(ch.index);
        if (focusIndex == ch.index) {
            focusIndex = -1;
            synchronized (live) {
                for (Integer k : live.keySet()) {
                    focusIndex = k;
                    break;
                }
            }
        }
        fireStream();
    }

    private void sleepUnlessStopped(long ms) {
        long end = SystemClock.elapsedRealtime() + ms;
        while (!stopped && SystemClock.elapsedRealtime() < end) {
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                return;
            }
        }
    }
}
