package com.example.photorange;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 把存储里的照片以 content:// 的形式交给别的 App（百度网盘）读。只读、不导出，对方只能读这次分享授权的文件。
 *
 * 地址故意做得很短：content://photorange/&lt;第几次分享&gt;/&lt;第几个文件&gt;。
 * 系统一次能传给别的 App 的数据有上限（约 500KB），地址越短，一次能交出去的照片越多，
 * 这样一千多张也能一次全部发给网盘。
 * 每次分享的文件清单存在应用私有目录里，本 App 被系统回收后网盘照样能接着读。
 */
public class ShareProvider extends ContentProvider {
    static final String AUTHORITY = "photorange";
    /** 一次最多交出去多少个（每个约 220 字节，1500 个约 330KB，给系统上限留余量） */
    static final int ONE_SHOT_MAX = 1500;
    /** 清单保留最近多少次，更早的删掉 */
    private static final int KEEP_SESSIONS = 12;

    private static final Map<String, String[]> CACHE = new HashMap<>();

    /** 登记一次分享，返回每个文件的地址（顺序和 files 一致） */
    static ArrayList<Uri> newSession(Context ctx, List<File> files) throws Exception {
        SharedPreferences sp = ctx.getSharedPreferences("share", Context.MODE_PRIVATE);
        int n = sp.getInt("sid", 0) + 1;
        sp.edit().putInt("sid", n).apply();
        String sid = Integer.toString(n, 36);

        File dir = new File(ctx.getFilesDir(), "share");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("建不了分享清单目录");
        String[] paths = new String[files.size()];
        try (Writer w = new OutputStreamWriter(new FileOutputStream(new File(dir, sid)), StandardCharsets.UTF_8)) {
            for (int i = 0; i < paths.length; i++) {
                paths[i] = files.get(i).getAbsolutePath();
                w.write(paths[i]);
                w.write('\n');
            }
        }
        synchronized (CACHE) {
            CACHE.put(sid, paths);
        }
        // 清掉太旧的清单
        File[] old = dir.listFiles();
        if (old != null && old.length > KEEP_SESSIONS) {
            Arrays.sort(old, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (int i = 0; i < old.length - KEEP_SESSIONS; i++) {
                //noinspection ResultOfMethodCallIgnored
                old[i].delete();
            }
        }
        ArrayList<Uri> uris = new ArrayList<>(paths.length);
        Uri base = new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(sid).build();
        for (int i = 0; i < paths.length; i++) uris.add(Uri.withAppendedPath(base, String.valueOf(i)));
        return uris;
    }

    private String[] session(String sid) throws FileNotFoundException {
        if (!sid.matches("[0-9a-z]{1,8}")) throw new FileNotFoundException("地址不对");
        synchronized (CACHE) {
            String[] cached = CACHE.get(sid);
            if (cached != null) return cached;
        }
        Context ctx = getContext();
        if (ctx == null) throw new FileNotFoundException("还没准备好");
        File f = new File(new File(ctx.getFilesDir(), "share"), sid);
        List<String> lines = new ArrayList<>();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) if (!line.isEmpty()) lines.add(line);
        } catch (Exception e) {
            throw new FileNotFoundException("这次分享的清单已经过期");
        }
        String[] paths = lines.toArray(new String[0]);
        synchronized (CACHE) {
            CACHE.put(sid, paths);
        }
        return paths;
    }

    /** 只放行清单里登记过、且确实在外部存储里的文件 */
    private File fileFor(Uri uri) throws FileNotFoundException {
        List<String> seg = uri.getPathSegments();
        if (seg.size() != 2) throw new FileNotFoundException("地址不对");
        String[] paths = session(seg.get(0));
        int i;
        try {
            i = Integer.parseInt(seg.get(1));
        } catch (NumberFormatException e) {
            throw new FileNotFoundException("地址不对");
        }
        if (i < 0 || i >= paths.length) throw new FileNotFoundException("地址不对");
        File f = new File(paths[i]);
        String c = PhotoScanner.canonical(f);
        if (!(c.startsWith("/storage/") || c.startsWith("/sdcard/") || c.startsWith("/mnt/")) || !f.isFile()) {
            throw new FileNotFoundException(paths[i]);
        }
        return f;
    }

    private static String mime(String name) {
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
            if (m != null) return m;
        }
        return "application/octet-stream";
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
        String name = f.getName();
        Object[] row = new Object[cols.length];
        // 地址里没有文件名，名字、大小、真实路径都从这里给；列名照着系统相册的来
        for (int i = 0; i < cols.length; i++) {
            String c = cols[i];
            if (OpenableColumns.DISPLAY_NAME.equals(c)) row[i] = name;
            else if (OpenableColumns.SIZE.equals(c)) row[i] = f.length();
            else if ("_data".equals(c)) row[i] = f.getAbsolutePath();
            else if ("mime_type".equals(c)) row[i] = mime(name);
            else if ("title".equals(c)) row[i] = name.lastIndexOf('.') > 0 ? name.substring(0, name.lastIndexOf('.')) : name;
            else if ("date_modified".equals(c) || "date_added".equals(c)) row[i] = f.lastModified() / 1000;
            else if ("datetaken".equals(c) || "last_modified".equals(c)) row[i] = f.lastModified();
            else row[i] = null;
        }
        MatrixCursor cur = new MatrixCursor(cols, 1);
        cur.addRow(row);
        return cur;
    }

    @Override
    public String getType(Uri uri) {
        try {
            return mime(fileFor(uri).getName());
        } catch (FileNotFoundException e) {
            return "application/octet-stream";
        }
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
