package com.example.nlimage;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
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

/**
 * 把网页导出的文件分块写进手机。其他文件进 下载/自然语言生图/；图片按「保存位置」：
 *   hidden（默认）  下载/自然语言生图/图片/，里面放 .nomedia，系统相册看不到，文件管理器里能找到
 *   album           相册（Pictures/自然语言生图/）
 *   custom          自己选的文件夹（系统文件夹选择器授权），可选再放 .nomedia 隐藏
 * 写的都是原始字节，NAI 藏在 PNG 里的出图信息不会丢。
 */
class FileSaver {
    static final String FOLDER = "自然语言生图";
    static final String HIDDEN_SUB = "图片";

    private final Context ctx;
    private final SharedPreferences sp;
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();

    private static class Job {
        OutputStream out;
        Uri uri;       // MediaStore（Android 10+）
        Uri doc;       // 自选文件夹里的文件
        File file;     // 直接写文件
        String name;
        String shownDir; // 提示里显示的位置
        boolean image;
        boolean scan = true;
    }

    FileSaver(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.sp = this.ctx.getSharedPreferences("save", Context.MODE_PRIVATE);
    }

    /** 网页设置保存位置：mode = hidden / album / custom；custom 时 tree 是文件夹授权的 Uri，hide = 是否放 .nomedia */
    void setTarget(String mode, String tree, boolean hide) {
        sp.edit().putString("mode", mode == null ? "hidden" : mode).putString("tree", tree == null ? "" : tree).putBoolean("hide", hide).apply();
    }

    /** 自选文件夹的显示名 */
    String treeName(Uri tree) {
        try {
            Uri d = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = ctx.getContentResolver().query(d, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) return c.getString(0);
            }
        } catch (Exception ignored) {
        }
        String last = tree.getLastPathSegment();
        return last == null ? "所选文件夹" : last.replaceFirst("^[^:]*:", "");
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        String base = name, ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) { base = name.substring(0, dot); ext = name.substring(dot); }
        for (int i = 1; f.exists(); i++) f = new File(dir, base + " (" + i + ")" + ext);
        return f;
    }

    /** 隐藏文件夹：先放 .nomedia 再写图（顺序不能反，否则相册已经收录了） */
    private void beginHidden(Job j, String type) throws Exception {
        String rel = Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER + "/" + HIDDEN_SUB;
        j.shownDir = "下载/" + FOLDER + "/" + HIDDEN_SUB + "/";
        j.scan = false;
        try {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER + "/" + HIDDEN_SUB);
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("mkdirs");
            File nm = new File(dir, ".nomedia");
            if (!nm.exists() && !nm.createNewFile()) throw new Exception("nomedia");
            j.file = unique(dir, j.name);
            j.out = new FileOutputStream(j.file);
            return;
        } catch (Exception e) {
            if (Build.VERSION.SDK_INT < 29) throw e;
        }
        // Android 10 不能直接写公共目录，走 MediaStore 的下载集合
        ContentResolver cr = ctx.getContentResolver();
        boolean hasNomedia = false;
        try (Cursor c = cr.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, new String[]{MediaStore.MediaColumns._ID},
                MediaStore.MediaColumns.RELATIVE_PATH + "=? AND " + MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                new String[]{rel + "/", ".nomedia"}, null)) {
            hasNomedia = c != null && c.moveToFirst();
        } catch (Exception ignored) {
        }
        if (!hasNomedia) {
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, ".nomedia");
                v.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, rel);
                Uri u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (u != null) try (OutputStream o = cr.openOutputStream(u)) { if (o != null) o.write(new byte[0]); }
            } catch (Exception ignored) {
            }
        }
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, j.name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, type);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, rel);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        j.uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (j.uri == null) throw new Exception("无法在手机里创建文件");
        j.out = cr.openOutputStream(j.uri);
    }

    /** 自选文件夹（SAF）：授权丢了就报错，让用户重新选 */
    private void beginCustom(Job j, String type, Uri tree, boolean hide) throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        if (hide) {
            boolean has = false;
            Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = cr.query(kids, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                while (c != null && c.moveToNext()) if (".nomedia".equals(c.getString(0))) { has = true; break; }
            } catch (Exception ignored) {
            }
            if (!has) {
                try { DocumentsContract.createDocument(cr, parent, "application/octet-stream", ".nomedia"); } catch (Exception ignored) { }
            }
        }
        j.doc = DocumentsContract.createDocument(cr, parent, type, j.name);
        if (j.doc == null) throw new Exception("没法在所选文件夹里建文件，去图库选项里重新选一下文件夹");
        j.out = cr.openOutputStream(j.doc);
        j.shownDir = treeName(tree) + "/";
        j.scan = false;
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
            j.image = type.startsWith("image/");
            String root = j.image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS;
            String mode = j.image ? sp.getString("mode", "hidden") : "album";
            String tree = sp.getString("tree", "");
            if ("custom".equals(mode) && tree.isEmpty()) mode = "hidden";
            if ("hidden".equals(mode)) {
                beginHidden(j, type);
            } else if ("custom".equals(mode)) {
                beginCustom(j, type, Uri.parse(tree), sp.getBoolean("hide", true));
            } else if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, root + "/" + FOLDER);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver cr = ctx.getContentResolver();
                j.uri = cr.insert(j.image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (j.uri == null) return "ERR:无法在手机里创建文件";
                j.out = cr.openOutputStream(j.uri);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(root), FOLDER);
                if (!dir.exists() && !dir.mkdirs()) {
                    dir = new File(ctx.getExternalFilesDir(root), FOLDER);
                    dir.mkdirs();
                }
                j.file = unique(dir, name);
                j.out = new FileOutputStream(j.file);
            }
            String token = "f" + seq.incrementAndGet();
            jobs.put(token, j);
            return token;
        } catch (SecurityException e) {
            return "ERR:没有写入权限，去图库选项里重新选一下保存文件夹";
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
            if (j.doc != null) return "OK:" + j.shownDir + j.name;
            if (j.uri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                ctx.getContentResolver().update(j.uri, v, null, null);
                try (Cursor c = ctx.getContentResolver().query(j.uri,
                        new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst()) shown = c.getString(0);
                } catch (Exception ignored) {
                }
                return "OK:" + (j.shownDir != null ? j.shownDir : (j.image ? "相册/" : "下载/") + FOLDER + "/") + shown;
            }
            if (j.scan) MediaScannerConnection.scanFile(ctx, new String[]{j.file.getAbsolutePath()}, null, null);
            return "OK:" + (j.shownDir != null ? j.shownDir + j.file.getName() : j.file.getAbsolutePath());
        } catch (Exception e) {
            return "ERR:" + e.getMessage();
        }
    }

    private void abort(String token) {
        Job j = jobs.remove(token);
        if (j == null) return;
        try { j.out.close(); } catch (Exception ignored) { }
        if (j.doc != null) {
            try { DocumentsContract.deleteDocument(ctx.getContentResolver(), j.doc); } catch (Exception ignored) { }
        } else if (j.uri != null) {
            try { ctx.getContentResolver().delete(j.uri, null, null); } catch (Exception ignored) { }
        } else if (j.file != null) {
            //noinspection ResultOfMethodCallIgnored
            j.file.delete();
        }
    }
}
