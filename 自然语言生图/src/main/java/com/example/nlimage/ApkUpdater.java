package com.example.nlimage;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内更新：自己下载新版 APK 到缓存目录，下完调起系统安装界面。
 * 没开「允许安装未知应用」时先跳到系统设置，用户开完回到 App 自动继续安装。
 * 进度回调网页：window.__updateProgress(已下字节, 总字节)、window.__updateDone(成功?, 出错信息)
 */
class ApkUpdater {
    private final Activity act;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile int gen; // 每次下载加一，旧的下载线程看到不一致就停
    private boolean pendingInstall;

    ApkUpdater(Activity act, WebView web) {
        this.act = act;
        this.web = web;
    }

    private File apkFile() {
        File dir = new File(act.getCacheDir(), "update");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, "NlImage.apk");
    }

    private void js(String code) {
        main.post(() -> web.evaluateJavascript(code, null));
    }

    void download(final String url) {
        final int my = ++gen;
        new Thread(() -> {
            File out = apkFile();
            File part = new File(out.getPath() + ".part");
            HttpURLConnection c = null;
            try {
                String u = url;
                // GitHub 会跳到另一个域名的下载地址，手动跟随，最多 5 次
                for (int i = 0; ; i++) {
                    c = (HttpURLConnection) new URL(u).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && i < 5) {
                        String loc = c.getHeaderField("Location");
                        c.disconnect();
                        if (loc == null) throw new Exception("下载地址跳转出错");
                        u = new URL(new URL(u), loc).toString();
                        continue;
                    }
                    if (code != 200) throw new Exception("下载失败（HTTP " + code + "）");
                    break;
                }
                long total = c.getContentLengthLong();
                long done = 0, last = 0;
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (my != gen) throw new Exception("已取消");
                        os.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - last > 300) {
                            last = now;
                            js("window.__updateProgress && window.__updateProgress(" + done + "," + total + ")");
                        }
                    }
                }
                if (total > 0 && done != total) throw new Exception("下载不完整，网络断了？再试一次");
                if (out.exists()) //noinspection ResultOfMethodCallIgnored
                    out.delete();
                if (!part.renameTo(out)) throw new Exception("保存安装包失败");
                js("window.__updateProgress && window.__updateProgress(" + done + "," + done + ")");
                js("window.__updateDone && window.__updateDone(true, '')");
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                String msg = e.getMessage() == null ? e.toString() : e.getMessage();
                js("window.__updateDone && window.__updateDone(false, " + JSONObject.quote(msg) + ")");
            } finally {
                if (c != null) c.disconnect();
            }
        }, "apk-update").start();
    }

    void cancel() {
        gen++;
    }

    /** 返回 OK（已打开安装界面）/ PERMISSION（去设置里开权限了）/ ERR:原因 */
    String install() {
        File f = apkFile();
        if (!f.exists()) return "ERR:安装包不见了，重新下载一次";
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            pendingInstall = true;
            main.post(() -> {
                try {
                    act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + act.getPackageName())));
                } catch (Exception e) {
                    act.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
                }
            });
            return "PERMISSION";
        }
        main.post(this::launchInstaller);
        return "OK";
    }

    private void launchInstaller() {
        pendingInstall = false;
        try {
            Uri uri = FileProvider.getUriForFile(act, act.getPackageName() + ".files", apkFile());
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) {
            js("window.__toast && window.__toast('error', " + JSONObject.quote("打不开安装界面：" + e.getMessage()) + ")");
        }
    }

    /** 从「允许安装未知应用」设置页回来时调用：开了就接着装 */
    void onResume() {
        if (!pendingInstall) return;
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            pendingInstall = false;
            js("window.__toast && window.__toast('warning', '没开「允许安装未知应用」，装不了。开好后再点一次「安装」')");
            return;
        }
        launchInstaller();
    }
}
