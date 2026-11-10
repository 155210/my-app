package com.example.gproxyisland;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 检查 gproxyisland-N 的最新版：先查 GitHub Releases，查不到再查 GitLab 备份；下载并调起安装。
 *
 * 下载：先直连 GitHub；连不上或卡住再退回 ghfast 镜像。
 * 安装前把文件的 SHA-256 和 GitHub 接口给的 digest 比对，不一致就删掉不装
 * （仓库是公开的，签名密钥也在里面，光靠签名挡不住镜像换包）。
 */
final class Updater {
    /** GitHub 主源（公开仓库）；GH_PROXY 是直连失败时的后备镜像 */
    static final String GH_API = "https://api.github.com/repos/155210/my-app/releases?per_page=40";
    static final String GH_PAGE = "https://github.com/155210/my-app/releases";
    static final String GH_PROXY = "https://ghfast.top/";
    /** GitLab 备份：项目 1151032/app/my-app 的 ID（用 ID 定位，不用路径），私有，要只读令牌 */
    static final String PROJECT_ID = "88673288";
    static final String GL_API = "https://gitlab.com/api/v4/projects/" + PROJECT_ID + "/releases?per_page=40";
    static final String GL_PAGE = "https://gitlab.com/1151032/app/my-app/-/releases";
    private static final String TAG = "gproxyisland-";

    static final class Latest {
        int build;
        String apk;
        /** GitHub 接口给的安装包 SHA-256（小写十六进制）；没有 = null */
        String sha256;
        /** true = 来自 GitLab 备份 */
        boolean gitlab;
    }

    private Updater() {}

    static int current(Context c) {
        try {
            if (Build.VERSION.SDK_INT >= 28)
                return (int) c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode();
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** 网络调用，别在主线程。GitHub 优先；GitHub 出错或没有发布时，填了令牌就查 GitLab */
    static Latest latest(Context c) throws Exception {
        Exception ghErr;
        try {
            return github();
        } catch (Exception e) {
            ghErr = e;
        }
        String token = Cfg.gitlabToken(c);
        if (token.isEmpty()) throw ghErr;
        try {
            return gitlab(token);
        } catch (Exception e) {
            throw new Exception(ghErr.getMessage() + "；GitLab 备份也失败：" + e.getMessage());
        }
    }

    private static String get(String url, String hdr, String val) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(10000);
        h.setReadTimeout(15000);
        h.setRequestProperty("User-Agent", "gproxyisland");
        if (hdr != null) h.setRequestProperty(hdr, val);
        int code = h.getResponseCode();
        if (code != 200) throw new Exception("返回 " + code);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = h.getInputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }

    private static int buildOf(String tag) {
        if (!tag.startsWith(TAG)) return -1;
        try { return Integer.parseInt(tag.substring(TAG.length())); } catch (Exception e) { return -1; }
    }

    private static Latest github() throws Exception {
        String body;
        try {
            body = get(GH_API, "Accept", "application/vnd.github+json");
        } catch (Exception e) {
            throw new Exception("GitHub " + e.getMessage());
        }
        JSONArray arr = new JSONArray(body);
        Latest best = null;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject r = arr.getJSONObject(i);
            int b = buildOf(r.optString("tag_name"));
            if (b < 0 || r.optBoolean("draft") || r.optBoolean("prerelease")) continue;
            JSONArray assets = r.optJSONArray("assets");
            String apk = null, sha = null;
            for (int j = 0; assets != null && j < assets.length(); j++) {
                JSONObject as = assets.getJSONObject(j);
                String u = as.optString("browser_download_url");
                if (!u.endsWith(".apk")) continue;
                apk = u;
                String d = as.isNull("digest") ? "" : as.optString("digest");
                if (d.startsWith("sha256:")) sha = d.substring(7).trim().toLowerCase(java.util.Locale.US);
                break;
            }
            if (apk == null) continue;
            if (best == null || b > best.build) {
                best = new Latest();
                best.build = b;
                best.apk = apk;
                best.sha256 = sha;
            }
        }
        if (best == null) throw new Exception("GitHub 上没找到 gproxy 岛的发布");
        return best;
    }

    private static Latest gitlab(String token) throws Exception {
        String body;
        try {
            body = get(GL_API, "PRIVATE-TOKEN", token);
        } catch (Exception e) {
            throw new Exception("令牌无效或网络不通（" + e.getMessage() + "）");
        }
        JSONArray arr = new JSONArray(body);
        Latest best = null;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject r = arr.getJSONObject(i);
            int b = buildOf(r.optString("tag_name"));
            if (b < 0 || r.optBoolean("upcoming_release")) continue;
            JSONObject as = r.optJSONObject("assets");
            JSONArray links = as == null ? null : as.optJSONArray("links");
            String apk = null;
            for (int j = 0; links != null && j < links.length(); j++) {
                JSONObject ln = links.getJSONObject(j);
                if (ln.optString("name").endsWith(".apk") || ln.optString("url").endsWith(".apk")) { apk = ln.optString("url"); break; }
            }
            if (apk == null) continue;
            if (best == null || b > best.build) {
                best = new Latest();
                best.build = b;
                best.apk = apk;
                best.gitlab = true;
            }
        }
        if (best == null) throw new Exception("没找到 gproxy 岛的发布");
        return best;
    }

    /** 允许本应用安装 APK？没有就跳到开关页，返回 false */
    static boolean canInstall(Activity a) {
        if (Build.VERSION.SDK_INT < 26 || a.getPackageManager().canRequestPackageInstalls()) return true;
        try {
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + a.getPackageName())));
        } catch (Exception ignored) {}
        return false;
    }

    /** end = true 表示这次更新流程结束了（成功或失败），false 只是中途进度 */
    interface Done { void on(String msg, boolean end); }

    /** 多久没有新数据就算卡住：后面还有备用地址时 20 秒，最后一个地址 60 秒 */
    private static final long STALL_MS = 20000, STALL_LAST_MS = 60000;

    /** 依次试的下载地址：GitHub 先直连，再走镜像（没有 SHA-256 可校验时不走镜像）；GitLab 只有一个 */
    static java.util.List<String> urls(Latest l) {
        java.util.List<String> out = new java.util.ArrayList<>();
        out.add(l.apk);
        if (!l.gitlab && l.sha256 != null) out.add(GH_PROXY + l.apk);
        return out;
    }

    static String sha256(InputStream in) throws Exception {
        java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        StringBuilder b = new StringBuilder();
        for (byte x : md.digest()) b.append(String.format(java.util.Locale.US, "%02x", x & 0xff));
        return b.toString();
    }

    /** 用系统下载器下载（GitLab 私有项目带令牌请求头），校验通过后自动弹安装 */
    static void download(Activity a, Latest l, Done done) {
        new Job(a.getApplicationContext(), l, done).start(0);
    }

    /** 一次更新下载：按 urls 逐个试，全在主线程上跑 */
    private static final class Job {
        final Context app;
        final DownloadManager dm;
        final Latest l;
        final Done done;
        final java.util.List<String> urls;
        final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
        /** 当前这次下载的 id；-1 = 没有在下 */
        long id = -1;
        int idx;
        long lastBytes, lastProgressAt;
        boolean registered, ended;

        Job(Context app, Latest l, Done done) {
            this.app = app;
            this.dm = (DownloadManager) app.getSystemService(Context.DOWNLOAD_SERVICE);
            this.l = l;
            this.done = done;
            this.urls = urls(l);
        }

        final BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (ended || id < 0 || i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                if (status() == DownloadManager.STATUS_SUCCESSFUL) finishDownload();
                else next(false);
            }
        };

        /** 盯着进度：一直没有新数据就换下一个地址 */
        final Runnable watch = new Runnable() {
            @Override
            public void run() {
                if (ended || id < 0) return;
                long bytes = 0;
                int st = -1;
                try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id))) {
                    if (cur != null && cur.moveToFirst()) {
                        st = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        bytes = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    }
                } catch (Exception ignored) {}
                // 成功由广播处理；这里只管失败和卡住
                if (st == DownloadManager.STATUS_SUCCESSFUL) return;
                long now = android.os.SystemClock.uptimeMillis();
                if (bytes > lastBytes) {
                    lastBytes = bytes;
                    lastProgressAt = now;
                }
                boolean last = idx + 1 >= urls.size();
                if (st == DownloadManager.STATUS_FAILED || now - lastProgressAt > (last ? STALL_LAST_MS : STALL_MS)) {
                    next(false);
                    return;
                }
                ui.postDelayed(this, 2000);
            }
        };

        void start(int i) {
            idx = i;
            String name = "GproxyIsland-" + l.build + ".apk";
            try {
                // 上次没下完 / 没通过校验的同名文件先删掉，免得系统下载器另起名字
                java.io.File dir = app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null) new java.io.File(dir, name).delete();
            } catch (Exception ignored) {}
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(urls.get(i)));
            String token = Cfg.gitlabToken(app);
            if (l.gitlab && !token.isEmpty()) req.addRequestHeader("PRIVATE-TOKEN", token);
            req.setTitle("gproxy 岛 build " + l.build);
            req.setMimeType("application/vnd.android.package-archive");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(app, Environment.DIRECTORY_DOWNLOADS, name);
            if (!registered) {
                IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
                if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, f, Context.RECEIVER_EXPORTED);
                else app.registerReceiver(receiver, f);
                registered = true;
            }
            lastBytes = 0;
            lastProgressAt = android.os.SystemClock.uptimeMillis();
            id = dm.enqueue(req);
            ui.removeCallbacks(watch);
            ui.postDelayed(watch, 2000);
        }

        int status() {
            try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id))) {
                if (cur != null && cur.moveToFirst())
                    return cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            } catch (Exception ignored) {}
            return -1;
        }

        /** 下载完成：先校验，再调起安装 */
        void finishDownload() {
            if (l.sha256 != null) {
                String got = null;
                try (InputStream in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(dm.openDownloadedFile(id))) {
                    got = sha256(in);
                } catch (Exception ignored) {}
                if (!l.sha256.equalsIgnoreCase(got)) {
                    next(true);
                    return;
                }
            }
            Uri uri = dm.getUriForDownloadedFile(id);
            if (uri == null) {
                next(false);
                return;
            }
            try {
                Intent in = new Intent(Intent.ACTION_VIEW);
                in.setDataAndType(uri, "application/vnd.android.package-archive");
                in.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                app.startActivity(in);
                end("已下载 build " + l.build + (l.sha256 != null ? "，校验通过" : "") + "，按提示安装（设置会保留）");
            } catch (Exception e) {
                end("调起安装失败，已用浏览器打开下载");
                openBrowser(app, l);
            }
        }

        /** 这个地址不行（下载失败 / 卡住 / 校验不一致）：删掉，换下一个；没有下一个就收尾 */
        void next(boolean badHash) {
            long old = id;
            id = -1;
            ui.removeCallbacks(watch);
            try { dm.remove(old); } catch (Exception ignored) {}
            if (idx + 1 < urls.size()) {
                done.on(badHash ? "安装包校验不一致，已删除，换个地址重下…" : "直连 GitHub 下载不动，改走镜像…", false);
                start(idx + 1);
            } else if (badHash) {
                end("安装包校验不一致，已删除没有安装（下载到的文件和 GitHub 上的不是同一个）。开着代理再试一次");
            } else {
                end("下载失败，已用浏览器打开下载");
                openBrowser(app, l);
            }
        }

        void end(String msg) {
            ended = true;
            id = -1;
            ui.removeCallbacks(watch);
            if (registered) {
                try { app.unregisterReceiver(receiver); } catch (Exception ignored) {}
                registered = false;
            }
            done.on(msg, true);
        }
    }

    /** 删掉已经装过（build ≤ 当前）的安装包，打开设置页时调用 */
    static void cleanup(Context c) {
        try {
            java.io.File dir = c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            java.io.File[] fs = dir == null ? null : dir.listFiles();
            if (fs == null) return;
            int cur = current(c);
            for (java.io.File f : fs) {
                String n = f.getName();
                if (!n.startsWith("GproxyIsland-") || !n.endsWith(".apk")) continue;
                int b;
                try { b = Integer.parseInt(n.substring(13, n.length() - 4)); } catch (Exception e) { b = 0; }
                if (b <= cur) f.delete();
            }
        } catch (Exception ignored) {}
    }

    /** 下载失败时用浏览器打开：GitHub 打开官方下载链接（不走镜像，浏览器里没法校验）；GitLab 打开发布页（要在浏览器里登录） */
    static void openBrowser(Context c, Latest l) {
        try {
            c.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(l.gitlab ? GL_PAGE : l.apk))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {}
    }
}
