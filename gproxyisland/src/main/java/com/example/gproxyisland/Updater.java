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

/** 检查 GitHub Releases 里 gproxyisland-N 的最新版，下载并调起安装 */
final class Updater {
    static final String PROXY = "https://ghfast.top/";
    private static final String API = "https://api.github.com/repos/155210/my-app/releases?per_page=40";
    private static final String TAG = "gproxyisland-";

    static final class Latest {
        int build;
        String apk;
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

    /** 网络调用，别在主线程 */
    static Latest latest() throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(API).openConnection();
        h.setConnectTimeout(10000);
        h.setReadTimeout(15000);
        h.setRequestProperty("Accept", "application/vnd.github+json");
        h.setRequestProperty("User-Agent", "gproxyisland");
        int code = h.getResponseCode();
        if (code != 200) throw new Exception("GitHub 返回 " + code);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = h.getInputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        JSONArray arr = new JSONArray(out.toString("UTF-8"));
        Latest best = null;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject r = arr.getJSONObject(i);
            String tag = r.optString("tag_name");
            if (!tag.startsWith(TAG) || r.optBoolean("draft") || r.optBoolean("prerelease")) continue;
            int b;
            try { b = Integer.parseInt(tag.substring(TAG.length())); } catch (Exception e) { continue; }
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

    interface Done { void on(String msg); }

    /** 用系统下载器下载（走 ghfast 代理），下完自动弹安装 */
    static void download(Activity a, Latest l, Done done) {
        Context app = a.getApplicationContext();
        DownloadManager dm = (DownloadManager) app.getSystemService(Context.DOWNLOAD_SERVICE);
        String name = "GproxyIsland-" + l.build + ".apk";
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(PROXY + l.apk));
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
                    done.on("下载失败，已用浏览器打开下载链接");
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
                    done.on("调起安装失败，已用浏览器打开下载链接");
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

    static void openBrowser(Context c, Latest l) {
        try {
            c.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(PROXY + l.apk))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {}
    }
}
