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

/** 检查 gproxyisland-N 的最新版：先查 GitHub Releases，查不到再查 GitLab 备份；下载并调起安装 */
final class Updater {
    /** GitHub 主源（公开仓库，下载走 ghfast 代理） */
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
            String apk = null;
            for (int j = 0; assets != null && j < assets.length(); j++) {
                String u = assets.getJSONObject(j).optString("browser_download_url");
                if (u.endsWith(".apk")) { apk = u; break; }
            }
            if (apk == null) continue;
            if (best == null || b > best.build) {
                best = new Latest();
                best.build = b;
                best.apk = apk;
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

    private static String url(Latest l) {
        return l.gitlab ? l.apk : GH_PROXY + l.apk;
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

    interface Done { void on(String msg); }

    /** 用系统下载器下载（GitHub 走 ghfast 代理；GitLab 私有项目带令牌请求头），下完自动弹安装 */
    static void download(Activity a, Latest l, Done done) {
        Context app = a.getApplicationContext();
        DownloadManager dm = (DownloadManager) app.getSystemService(Context.DOWNLOAD_SERVICE);
        String name = "GproxyIsland-" + l.build + ".apk";
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url(l)));
        String token = Cfg.gitlabToken(app);
        if (l.gitlab && !token.isEmpty()) req.addRequestHeader("PRIVATE-TOKEN", token);
        req.setTitle("gproxy 岛 build " + l.build);
        req.setMimeType("application/vnd.android.package-archive");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setDestinationInExternalFilesDir(app, Environment.DIRECTORY_DOWNLOADS, name);
        final long id = dm.enqueue(req);
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                try { app.unregisterReceiver(this); } catch (Exception ignored) {}
                int status = -1;
                try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id))) {
                    if (cur != null && cur.moveToFirst())
                        status = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                } catch (Exception ignored) {}
                Uri uri = status == DownloadManager.STATUS_SUCCESSFUL ? dm.getUriForDownloadedFile(id) : null;
                if (uri == null) {
                    done.on("下载失败，已用浏览器打开下载");
                    openBrowser(app, l);
                    return;
                }
                try {
                    Intent in = new Intent(Intent.ACTION_VIEW);
                    in.setDataAndType(uri, "application/vnd.android.package-archive");
                    in.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    app.startActivity(in);
                    done.on("已下载 build " + l.build + "，按提示安装（设置会保留）");
                } catch (Exception e) {
                    done.on("调起安装失败，已用浏览器打开下载");
                    openBrowser(app, l);
                }
            }
        };
        IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, f, Context.RECEIVER_EXPORTED);
        else app.registerReceiver(r, f);
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

    /** 下载失败时用浏览器打开：GitHub 直接打开下载链接；GitLab 打开发布页（要在浏览器里登录） */
    static void openBrowser(Context c, Latest l) {
        try {
            c.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(l.gitlab ? GL_PAGE : url(l)))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {}
    }
}
