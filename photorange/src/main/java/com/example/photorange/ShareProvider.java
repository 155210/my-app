package com.example.photorange;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.Locale;

/**
 * 把存储里的照片以 content:// 的形式交给别的 App（百度网盘）读。
 * 只读、不导出，对方只能读这次分享里授权的那几个文件。
 * 地址直接带文件路径（content://…share/storage/emulated/0/DCIM/Camera/IMG_x.jpg），
 * 不靠内存里的对照表，本 App 被系统回收后网盘照样能接着读。
 */
public class ShareProvider extends ContentProvider {
    static final String AUTHORITY = "com.example.photorange.share";

    static Uri uriFor(File f) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY)
                .encodedPath(Uri.encode(f.getAbsolutePath(), "/")).build();
    }

    /** 只放行外部存储里真实存在的文件 */
    private static File fileFor(Uri uri) throws FileNotFoundException {
        String p = uri.getPath();
        if (p == null) throw new FileNotFoundException("空路径");
        File f = new File(p);
        String c = PhotoScanner.canonical(f);
        if (!(c.startsWith("/storage/") || c.startsWith("/sdcard/") || c.startsWith("/mnt/")) || !f.isFile()) {
            throw new FileNotFoundException(p);
        }
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            String c = cols[i];
            if (OpenableColumns.DISPLAY_NAME.equals(c)) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(c)) row[i] = f.length();
            else if ("_data".equals(c)) row[i] = f.getAbsolutePath(); // 有些 App 只认真实路径
            else if ("mime_type".equals(c)) row[i] = getType(uri);
            else if ("date_modified".equals(c)) row[i] = f.lastModified() / 1000;
            else if ("last_modified".equals(c)) row[i] = f.lastModified();
            else row[i] = null;
        }
        MatrixCursor cur = new MatrixCursor(cols, 1);
        cur.addRow(row);
        return cur;
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot >= 0) {
                String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                if (mime != null) return mime;
            }
        }
        return "application/octet-stream";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode != null && !"r".equals(mode)) throw new FileNotFoundException("只读");
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
}
