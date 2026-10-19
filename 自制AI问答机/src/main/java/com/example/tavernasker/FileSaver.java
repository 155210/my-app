package com.example.tavernasker;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** 把网页导出的文件分块写进 下载/自制AI问答机/ */
class FileSaver {
    static final String FOLDER = "自制AI问答机";

    private final Context ctx;
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();

    private static class Job {
        OutputStream out;
        Uri uri;       // Android 10+
        File file;     // Android 9-
        String name;
    }

    FileSaver(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    static String mimeFor(String name, String fallback) {
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot >= 0) ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        switch (ext) {
            case "json": return "application/json";
            case "txt": return "text/plain";
            case "epub": return "application/epub+zip";
            case "png": return "image/png";
            case "md": return "text/markdown";
        }
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (m != null) return m;
        if (fallback != null && !fallback.isEmpty()) return fallback.split(";")[0].trim();
        return "application/octet-stream";
    }

    String begin(String name, String mime) {
        try {
            Job j = new Job();
            j.name = name;
            String type = mimeFor(name, mime);
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver cr = ctx.getContentResolver();
                j.uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (j.uri == null) return "ERR:无法在「下载」中创建文件";
                j.out = cr.openOutputStream(j.uri);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER);
                if (!dir.exists() && !dir.mkdirs()) {
                    dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER);
                    dir.mkdirs();
                }
                File f = new File(dir, name);
                String base = name, ext = "";
                int dot = name.lastIndexOf('.');
                if (dot > 0) { base = name.substring(0, dot); ext = name.substring(dot); }
                for (int i = 1; f.exists(); i++) f = new File(dir, base + " (" + i + ")" + ext);
                j.file = f;
                j.out = new FileOutputStream(f);
            }
            String token = "f" + seq.incrementAndGet();
            jobs.put(token, j);
            return token;
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    String chunk(String token, String b64) {
        Job j = jobs.get(token);
        if (j == null) return "ERR:写入已中断";
        try {
            j.out.write(Base64.decode(b64, Base64.DEFAULT));
            return "OK";
        } catch (Exception e) {
            abort(token);
            return "ERR:" + e.getMessage();
        }
    }

    String end(String token) {
        Job j = jobs.remove(token);
        if (j == null) return "ERR:写入已中断";
        try {
            j.out.close();
            String shown = j.name;
            if (j.uri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                ctx.getContentResolver().update(j.uri, v, null, null);
                try (Cursor c = ctx.getContentResolver().query(j.uri,
                        new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst()) shown = c.getString(0);
                } catch (Exception ignored) {
                }
                return "OK:下载/" + FOLDER + "/" + shown;
            }
            MediaScannerConnection.scanFile(ctx, new String[]{j.file.getAbsolutePath()}, null, null);
            return "OK:" + j.file.getAbsolutePath();
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    private void abort(String token) {
        Job j = jobs.remove(token);
        if (j == null) return;
        try { j.out.close(); } catch (Exception ignored) { }
        if (j.uri != null) {
            try { ctx.getContentResolver().delete(j.uri, null, null); } catch (Exception ignored) { }
        } else if (j.file != null) {
            //noinspection ResultOfMethodCallIgnored
            j.file.delete();
        }
    }
}
