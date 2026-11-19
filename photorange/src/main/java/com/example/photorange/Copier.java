package com.example.photorange;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** 把选中的照片复制到目标文件夹。先写 .part 临时文件，写完再改名，取消或出错不会留下半截照片。 */
final class Copier {
    private Copier() {
    }

    static final class Stats {
        int copied, skipped, renamed, failed;
        long bytes;
        boolean cancelled;
        String lastError;
        /** 新写出来的文件，复制完交给媒体库扫描，相册里才看得到 */
        final List<String> newPaths = new ArrayList<>();
    }

    interface Progress {
        /** done = 已处理文件数，bytesDone = 已处理字节数 */
        void onProgress(int done, long bytesDone, String currentName);
    }

    static Stats copy(List<PhotoScanner.Item> items, File destRoot, boolean byMonthFolder,
                      AtomicBoolean cancel, Progress progress) {
        Stats s = new Stats();
        byte[] buf = new byte[256 * 1024];
        long bytesDone = 0;
        int done = 0;
        for (PhotoScanner.Item it : items) {
            if (cancel.get()) {
                s.cancelled = true;
                break;
            }
            if (progress != null) progress.onProgress(done, bytesDone, it.file.getName());
            File dir = byMonthFolder
                    ? new File(destRoot, String.format(Locale.ROOT, "%04d-%02d", it.ym / 100, it.ym % 100))
                    : destRoot;
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("建不了文件夹 " + dir.getPath());
                File target = new File(dir, it.file.getName());
                if (target.exists()) {
                    if (target.length() == it.size) {
                        // 同名同大小，当作已经复制过
                        s.skipped++;
                        done++;
                        bytesDone += it.size;
                        continue;
                    }
                    target = freeName(dir, it.file.getName());
                    s.renamed++;
                }
                File part = new File(dir, target.getName() + ".part");
                try (InputStream in = new FileInputStream(it.file);
                     OutputStream out = new FileOutputStream(part)) {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancel.get()) break;
                        out.write(buf, 0, n);
                    }
                }
                if (cancel.get()) {
                    //noinspection ResultOfMethodCallIgnored
                    part.delete();
                    s.cancelled = true;
                    break;
                }
                if (!part.renameTo(target)) {
                    //noinspection ResultOfMethodCallIgnored
                    part.delete();
                    throw new IOException("改名失败 " + target.getName());
                }
                // 保留原来的修改时间，相册按时间排序不会乱
                //noinspection ResultOfMethodCallIgnored
                target.setLastModified(it.file.lastModified());
                s.copied++;
                s.bytes += it.size;
                s.newPaths.add(target.getAbsolutePath());
            } catch (Exception e) {
                s.failed++;
                s.lastError = it.file.getName() + "：" + e.getMessage();
            }
            done++;
            bytesDone += it.size;
        }
        if (progress != null) progress.onProgress(done, bytesDone, "");
        return s;
    }

    /** IMG_x.jpg 被占用时依次试 IMG_x (1).jpg、IMG_x (2).jpg… */
    private static File freeName(File dir, String name) {
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; ; i++) {
            File f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
    }
}
