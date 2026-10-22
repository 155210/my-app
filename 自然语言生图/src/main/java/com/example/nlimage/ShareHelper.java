package com.example.nlimage;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 分享图片：网页把（处理过信息的）图片分块写进 cache/share/，写完一起交给系统分享面板。
 * 每个文件放在自己的小文件夹里，同名也不冲突；一小时前的旧文件下次分享时顺手删掉。
 */
class ShareHelper {
    private final Activity act;
    private final Map<String, File> files = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> outs = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();

    ShareHelper(Activity act) {
        this.act = act;
    }

    private File root() {
        return new File(act.getCacheDir(), "share");
    }

    private static void clean(File f, long before) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) clean(k, before);
        if (f.lastModified() < before) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    String begin(String name) {
        try {
            File[] old = root().listFiles();
            long before = System.currentTimeMillis() - 3600_000L;
            if (old != null) for (File o : old) clean(o, before);
            String token = "s" + System.currentTimeMillis() + "_" + seq.incrementAndGet();
            File dir = new File(root(), token);
            if (!dir.mkdirs()) return "ERR:无法创建临时文件";
            File f = new File(dir, name);
            outs.put(token, new FileOutputStream(f));
            files.put(token, f);
            return token;
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    String chunk(String token, String b64) {
        OutputStream o = outs.get(token);
        if (o == null) return "ERR:写入已中断";
        try {
            o.write(Base64.decode(b64, Base64.DEFAULT));
            return "OK";
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    String end(String token) {
        OutputStream o = outs.remove(token);
        if (o == null) return "ERR:写入已中断";
        try {
            o.close();
            return "OK";
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    /** tokensJson = ["s1", ...]，mime = image/png 之类（多种格式时传 image/*） */
    String send(String tokensJson, String mime, String title) {
        try {
            JSONArray arr = new JSONArray(tokensJson);
            ArrayList<Uri> uris = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                File f = files.remove(arr.getString(i));
                if (f != null && f.exists()) uris.add(FileProvider.getUriForFile(act, act.getPackageName() + ".files", f));
            }
            if (uris.isEmpty()) return "ERR:没有可分享的文件";
            Intent i;
            if (uris.size() == 1) {
                i = new Intent(Intent.ACTION_SEND);
                i.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            } else {
                i = new Intent(Intent.ACTION_SEND_MULTIPLE);
                i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            }
            i.setType(mime == null || mime.isEmpty() ? "image/*" : mime);
            ClipData clip = ClipData.newRawUri("", uris.get(0));
            for (int k = 1; k < uris.size(); k++) clip.addItem(new ClipData.Item(uris.get(k)));
            i.setClipData(clip);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            final Intent chooser = Intent.createChooser(i, title == null || title.isEmpty() ? "分享图片" : title);
            act.runOnUiThread(() -> {
                try {
                    act.startActivity(chooser);
                } catch (Exception ignored) {
                }
            });
            return "OK";
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }
}
