package com.example.photorange;

import java.io.File;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 扫描文件夹，从文件名里认出拍摄年月。
 * 认 IMG_20141114_164041.jpg 这一类：文件名里一段 YYYYMMDD（也认 2016-01-01 / 2016_01_01，前后不能再挨着数字），
 * 所以 VID_、PANO_、MVIMG_、Screenshot_20141114-…、IMG_20141114_164041_1.jpg 也都能认。
 */
final class PhotoScanner {
    private PhotoScanner() {
    }

    static final class Item {
        final File file;
        /** 年*100+月，例如 201411 */
        final int ym;
        final long size;
        /** true = 文件名里没日期，用的是修改时间 */
        final boolean fromMtime;

        Item(File file, int ym, long size, boolean fromMtime) {
            this.file = file;
            this.ym = ym;
            this.size = size;
            this.fromMtime = fromMtime;
        }
    }

    static final class Result {
        final List<Item> items = new ArrayList<>();
        /** 文件名里认不出日期、也没开「用修改时间」而被跳过的图片/视频数 */
        int unrecognized;
        boolean cancelled;
        /** 源文件夹不存在或读不了 */
        String error;

        int minYm() {
            int m = Integer.MAX_VALUE;
            for (Item it : items) m = Math.min(m, it.ym);
            return items.isEmpty() ? 0 : m;
        }

        int maxYm() {
            int m = 0;
            for (Item it : items) m = Math.max(m, it.ym);
            return m;
        }

        /** 年 → (月 → 数量) */
        TreeMap<Integer, TreeMap<Integer, Integer>> histogram() {
            TreeMap<Integer, TreeMap<Integer, Integer>> h = new TreeMap<>();
            for (Item it : items) {
                TreeMap<Integer, Integer> months = h.get(it.ym / 100);
                if (months == null) {
                    months = new TreeMap<>();
                    h.put(it.ym / 100, months);
                }
                Integer n = months.get(it.ym % 100);
                months.put(it.ym % 100, n == null ? 1 : n + 1);
            }
            return h;
        }
    }

    interface Progress {
        void onProgress(int scannedFiles);
    }

    private static final Pattern DATE = Pattern.compile("(?<!\\d)((?:19|20)\\d{2})[-_.]?(\\d{2})[-_.]?(\\d{2})(?!\\d)");

    private static final String[] IMAGE_EXT = {"jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "dng", "bmp"};
    private static final String[] VIDEO_EXT = {"mp4", "mov", "3gp", "mkv", "m4v", "webm"};

    /** 从文件名取年月，取不到返回 0 */
    static int ymFromName(String name) {
        Matcher m = DATE.matcher(name);
        while (m.find()) {
            int y = Integer.parseInt(m.group(1));
            int mo = Integer.parseInt(m.group(2));
            int d = Integer.parseInt(m.group(3));
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y * 100 + mo;
        }
        return 0;
    }

    static int ymFromMtime(long mtime) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(mtime);
        return c.get(Calendar.YEAR) * 100 + (c.get(Calendar.MONTH) + 1);
    }

    static boolean isMedia(String name, boolean includeVideo) {
        int dot = name.lastIndexOf('.');
        if (dot < 0) return false;
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        for (String e : IMAGE_EXT) if (e.equals(ext)) return true;
        if (includeVideo) for (String e : VIDEO_EXT) if (e.equals(ext)) return true;
        return false;
    }

    /**
     * @param exclude 不往里扫的文件夹（目标文件夹放在源文件夹里面时，避免把复制出来的又算进去）
     */
    static Result scan(File root, boolean recursive, boolean includeVideo, boolean useMtime,
                       File exclude, AtomicBoolean cancel, Progress progress) {
        Result r = new Result();
        if (root == null || !root.isDirectory()) {
            r.error = "源文件夹不存在：" + (root == null ? "" : root.getPath());
            return r;
        }
        String excludePath = exclude == null ? null : canonical(exclude);
        ArrayList<File> stack = new ArrayList<>();
        stack.add(root);
        int seen = 0;
        boolean firstDir = true;
        while (!stack.isEmpty()) {
            if (cancel.get()) {
                r.cancelled = true;
                return r;
            }
            File dir = stack.remove(stack.size() - 1);
            File[] list = dir.listFiles();
            if (list == null) {
                if (firstDir) {
                    r.error = "读不了源文件夹（多半是还没给「所有文件访问权限」）：" + root.getPath();
                    return r;
                }
                continue;
            }
            firstDir = false;
            for (File f : list) {
                String name = f.getName();
                if (name.startsWith(".")) continue; // .thumbnails、.trashed-xxx 之类
                if (f.isDirectory()) {
                    if (recursive && (excludePath == null || !excludePath.equals(canonical(f)))) stack.add(f);
                    continue;
                }
                if (!isMedia(name, includeVideo)) continue;
                seen++;
                if (progress != null && seen % 200 == 0) progress.onProgress(seen);
                int ym = ymFromName(name);
                boolean mt = false;
                if (ym == 0 && useMtime) {
                    ym = ymFromMtime(f.lastModified());
                    mt = true;
                }
                if (ym == 0) {
                    r.unrecognized++;
                    continue;
                }
                r.items.add(new Item(f, ym, f.length(), mt));
            }
        }
        if (progress != null) progress.onProgress(seen);
        return r;
    }

    static String canonical(File f) {
        try {
            return f.getCanonicalPath();
        } catch (Exception e) {
            return f.getAbsolutePath();
        }
    }
}
