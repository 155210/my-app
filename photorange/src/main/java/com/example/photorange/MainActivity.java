package com.example.photorange;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 照片按月复制：按文件名里的日期（IMG_20141114_164041.jpg）选「从某年某月 到 某年某月」，
 * 把范围内的照片复制到指定文件夹。
 */
public class MainActivity extends Activity {

    private static final int BG = 0xFF121316, CARD = 0xFF1B1D22, FG = 0xFFF1EFE8, MUTED = 0xFFA3A199;
    private static final int ACCENT = 0xFF5B8DEF, AMBER = 0xFFEF9F27, RED = 0xFFE24B4A, GREEN = 0xFF5DCAA5;
    private static final int REQ_PERM = 1;
    private static final String BAIDU_PKG = "com.baidu.netdisk";
    /** 一次交给网盘多少个：太多会超出系统单次传递的上限 */
    private static final int[] BATCH_SIZES = {50, 100, 200, 500};

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;

    private LinearLayout permCard;
    private TextView srcText, dstText, scanText, rangeText, statusText;
    private LinearLayout histBox;
    private CheckBox cbRecursive, cbVideo, cbMtime, cbByMonth;
    private Spinner spFromY, spFromM, spToY, spToM;
    private Button btnScan, btnCopy, btnBaidu, btnCancel;
    private ProgressBar progress;

    private File srcDir, dstDir;
    /** 年*100+月 */
    private int fromYm, toYm;
    private final List<Integer> years = new ArrayList<>();

    private PhotoScanner.Result scan;
    private boolean scanning, copying, autoAsked;
    private AtomicBoolean cancelFlag = new AtomicBoolean();

    // ───────────────────────── 生命周期 ─────────────────────────

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("cfg", MODE_PRIVATE);
        File internal = Environment.getExternalStorageDirectory();
        srcDir = new File(prefs.getString("src", new File(internal, "DCIM/Camera").getAbsolutePath()));
        dstDir = new File(prefs.getString("dst", new File(internal, "Pictures/按月复制").getAbsolutePath()));
        int nowYm = nowYm();
        fromYm = prefs.getInt("from", 0);
        toYm = prefs.getInt("to", 0);
        if (fromYm == 0 || toYm == 0) {
            fromYm = (nowYm / 100) * 100 + 1;
            toYm = nowYm;
        }
        buildUi();
        rebuildYears();
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean ok = hasStoragePermission();
        permCard.setVisibility(ok ? View.GONE : View.VISIBLE);
        if (!ok) {
            // 自动提权：第一次打开直接跳到授权页，不用用户自己找
            if (!autoAsked) {
                autoAsked = true;
                Toast.makeText(this, "需要「所有文件访问权限」才能读相册、写目标文件夹，请打开开关后返回", Toast.LENGTH_LONG).show();
                requestStoragePermission();
            }
            updateButtons();
            return;
        }
        if (scan == null && !scanning) startScan();
        updateButtons();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERM) onResume();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (copying) {
            Toast.makeText(this, "正在复制，要退出请先点「取消」", Toast.LENGTH_SHORT).show();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        cancelFlag.set(true);
        worker.shutdownNow();
        super.onDestroy();
    }

    // ───────────────────────── 权限 ─────────────────────────

    private boolean hasStoragePermission() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestStoragePermission() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                } catch (Exception e2) {
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName())));
                }
            }
        } else {
            requestPermissions(new String[]{
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
        }
    }

    // ───────────────────────── 界面 ─────────────────────────

    private void buildUi() {
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(BG);
        sv.setFillViewport(true);
        LinearLayout root = vbox();
        int pad = dp(16);
        root.setPadding(pad, dp(20), pad, dp(32));
        sv.addView(root);

        TextView title = text("照片按月复制", 22, FG);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);
        TextView sub = text("按文件名里的日期（如 IMG_20141114_164041.jpg）挑出某段年月的照片，复制到指定文件夹。原图不动。", 13, MUTED);
        sub.setPadding(0, dp(4), 0, dp(12));
        root.addView(sub);

        // 权限提示
        permCard = card(root);
        permCard.setBackground(round(0xFF2B2110, dp(14)));
        permCard.addView(text("还没有「所有文件访问权限」，读不了相册文件夹。", 14, AMBER));
        Button bPerm = button("去开启权限", true);
        bPerm.setOnClickListener(v -> requestStoragePermission());
        permCard.addView(bPerm, topMargin(dp(8)));

        // 1. 源文件夹
        LinearLayout c1 = card(root);
        c1.addView(label("① 照片所在文件夹"));
        srcText = text(FolderPicker.pretty(srcDir), 15, FG);
        c1.addView(row(srcText, button("选择", false, v -> FolderPicker.show(this, "选照片所在文件夹", srcDir, d -> {
            srcDir = d;
            prefs.edit().putString("src", d.getAbsolutePath()).apply();
            srcText.setText(FolderPicker.pretty(d));
            startScan();
        }))));
        cbRecursive = check("包含子文件夹", prefs.getBoolean("rec", false));
        cbVideo = check("也复制视频（VID_xxxx.mp4 等）", prefs.getBoolean("vid", false));
        cbMtime = check("文件名里没日期的，按修改时间算", prefs.getBoolean("mtime", false));
        for (CheckBox cb : new CheckBox[]{cbRecursive, cbVideo, cbMtime}) {
            c1.addView(cb);
            cb.setOnCheckedChangeListener((b, on) -> {
                saveChecks();
                startScan();
            });
        }
        btnScan = button("重新扫描", false);
        btnScan.setOnClickListener(v -> startScan());
        c1.addView(btnScan, topMargin(dp(6)));
        scanText = text("", 13, MUTED);
        scanText.setPadding(0, dp(8), 0, 0);
        c1.addView(scanText);
        histBox = vbox();
        c1.addView(histBox);

        // 2. 年月范围
        LinearLayout c2 = card(root);
        c2.addView(label("② 日期范围（含首尾两个月）"));
        spFromY = new Spinner(this);
        spFromM = new Spinner(this);
        spToY = new Spinner(this);
        spToM = new Spinner(this);
        c2.addView(rangeRow("从", spFromY, spFromM));
        c2.addView(rangeRow("到", spToY, spToM));
        List<String> months = new ArrayList<>();
        for (int m = 1; m <= 12; m++) months.add(m + " 月");
        spFromM.setAdapter(adapter(months));
        spToM.setAdapter(adapter(months));
        AdapterView.OnItemSelectedListener l = new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                readSpinners();
            }

            @Override
            public void onNothingSelected(AdapterView<?> p) {
            }
        };
        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        quick.addView(button("全部", false, v -> {
            if (scan != null && !scan.items.isEmpty()) setRange(scan.minYm(), scan.maxYm());
        }), weight());
        quick.addView(button("今年", false, v -> setRange(nowYm() / 100 * 100 + 1, nowYm())), weight());
        quick.addView(button("去年", false, v -> {
            int y = nowYm() / 100 - 1;
            setRange(y * 100 + 1, y * 100 + 12);
        }), weight());
        c2.addView(quick, topMargin(dp(4)));
        rangeText = text("", 15, FG);
        rangeText.setPadding(0, dp(8), 0, 0);
        c2.addView(rangeText);

        // 3. 目标文件夹
        LinearLayout c3 = card(root);
        c3.addView(label("③ 复制到"));
        dstText = text(FolderPicker.pretty(dstDir), 15, FG);
        c3.addView(row(dstText, button("选择", false, v -> FolderPicker.show(this, "选复制到哪个文件夹", dstDir, d -> {
            dstDir = d;
            prefs.edit().putString("dst", d.getAbsolutePath()).apply();
            dstText.setText(FolderPicker.pretty(d));
            updateRangeInfo();
        }))));
        cbByMonth = check("按年月分子文件夹（2014-11/、2014-12/…）", prefs.getBoolean("bymonth", false));
        cbByMonth.setOnCheckedChangeListener((b, on) -> saveChecks());
        c3.addView(cbByMonth);
        c3.addView(text("目标里已有同名同大小的文件会跳过；同名不同大小的另存为「名字 (1).jpg」。", 12, MUTED));

        // 4. 开始
        btnCopy = button("开始复制", true);
        btnCopy.setOnClickListener(v -> confirmCopy());
        root.addView(btnCopy, topMargin(dp(14)));
        btnBaidu = button("上传到百度网盘（不复制，直接交给网盘 App）", false);
        btnBaidu.setMinHeight(dp(50));
        btnBaidu.setOnClickListener(v -> shareToBaidu());
        root.addView(btnBaidu, topMargin(dp(8)));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(1000);
        progress.setVisibility(View.GONE);
        root.addView(progress, topMargin(dp(12)));
        statusText = text("", 14, FG);
        statusText.setPadding(0, dp(6), 0, 0);
        root.addView(statusText);
        btnCancel = button("取消", false);
        btnCancel.setVisibility(View.GONE);
        btnCancel.setOnClickListener(v -> cancelFlag.set(true));
        root.addView(btnCancel, topMargin(dp(8)));

        spFromY.setOnItemSelectedListener(l);
        spFromM.setOnItemSelectedListener(l);
        spToY.setOnItemSelectedListener(l);
        spToM.setOnItemSelectedListener(l);

        setContentView(sv);
    }

    private void saveChecks() {
        prefs.edit()
                .putBoolean("rec", cbRecursive.isChecked())
                .putBoolean("vid", cbVideo.isChecked())
                .putBoolean("mtime", cbMtime.isChecked())
                .putBoolean("bymonth", cbByMonth.isChecked())
                .apply();
    }

    // ───────────────────────── 年月下拉 ─────────────────────────

    /** 年份下拉：从最早照片那年（或范围起点）到今年 */
    private void rebuildYears() {
        int minY = Math.min(fromYm / 100, toYm / 100);
        int maxY = Math.max(nowYm() / 100, Math.max(fromYm / 100, toYm / 100));
        if (scan != null && !scan.items.isEmpty()) {
            minY = Math.min(minY, scan.minYm() / 100);
            maxY = Math.max(maxY, scan.maxYm() / 100);
        }
        years.clear();
        List<String> labels = new ArrayList<>();
        for (int y = minY; y <= maxY; y++) {
            years.add(y);
            labels.add(y + " 年");
        }
        spFromY.setAdapter(adapter(labels));
        spToY.setAdapter(adapter(labels));
        applyRangeToSpinners();
    }

    private void setRange(int from, int to) {
        fromYm = from;
        toYm = to;
        if (years.isEmpty() || from / 100 < years.get(0) || to / 100 > years.get(years.size() - 1)) {
            rebuildYears();
        } else {
            applyRangeToSpinners();
        }
        saveRange();
        updateRangeInfo();
    }

    private void applyRangeToSpinners() {
        spFromY.setSelection(Math.max(0, years.indexOf(fromYm / 100)), false);
        spFromM.setSelection(fromYm % 100 - 1, false);
        spToY.setSelection(Math.max(0, years.indexOf(toYm / 100)), false);
        spToM.setSelection(toYm % 100 - 1, false);
        updateRangeInfo();
    }

    private void readSpinners() {
        if (years.isEmpty()) return;
        int fy = years.get(Math.max(0, spFromY.getSelectedItemPosition()));
        int ty = years.get(Math.max(0, spToY.getSelectedItemPosition()));
        fromYm = fy * 100 + spFromM.getSelectedItemPosition() + 1;
        toYm = ty * 100 + spToM.getSelectedItemPosition() + 1;
        saveRange();
        updateRangeInfo();
    }

    private void saveRange() {
        prefs.edit().putInt("from", fromYm).putInt("to", toYm).apply();
    }

    private List<PhotoScanner.Item> selected() {
        List<PhotoScanner.Item> out = new ArrayList<>();
        if (scan == null) return out;
        for (PhotoScanner.Item it : scan.items) if (it.ym >= fromYm && it.ym <= toYm) out.add(it);
        return out;
    }

    private void updateRangeInfo() {
        if (rangeText == null) return;
        if (fromYm > toYm) {
            rangeText.setTextColor(RED);
            rangeText.setText("起始月份晚于结束月份，请调整");
        } else if (scan == null) {
            rangeText.setTextColor(MUTED);
            rangeText.setText(scanning ? "正在扫描…" : "还没扫描");
        } else {
            List<PhotoScanner.Item> sel = selected();
            long bytes = 0;
            for (PhotoScanner.Item it : sel) bytes += it.size;
            rangeText.setTextColor(sel.isEmpty() ? AMBER : GREEN);
            rangeText.setText(String.format(Locale.ROOT, "%s ～ %s：共 %d 个文件，%s",
                    ymLabel(fromYm), ymLabel(toYm), sel.size(), size(bytes)));
        }
        updateButtons();
    }

    // ───────────────────────── 扫描 ─────────────────────────

    private void startScan() {
        if (copying) return;
        if (!hasStoragePermission()) {
            scanText.setTextColor(AMBER);
            scanText.setText("没有权限，无法扫描");
            return;
        }
        cancelFlag.set(true); // 停掉上一次还没扫完的
        AtomicBoolean cancel = new AtomicBoolean();
        cancelFlag = cancel;
        scanning = true;
        scan = null;
        histBox.removeAllViews();
        scanText.setTextColor(MUTED);
        scanText.setText("正在扫描…");
        updateRangeInfo();
        final File src = srcDir, dst = dstDir;
        final boolean rec = cbRecursive.isChecked(), vid = cbVideo.isChecked(), mt = cbMtime.isChecked();
        worker.execute(() -> {
            PhotoScanner.Result r = PhotoScanner.scan(src, rec, vid, mt, dst, cancel,
                    n -> main.post(() -> {
                        if (cancelFlag == cancel) scanText.setText("正在扫描… 已看 " + n + " 个文件");
                    }));
            main.post(() -> {
                if (cancelFlag != cancel || r.cancelled || isFinishing()) return;
                scanning = false;
                onScanned(r);
            });
        });
    }

    private void onScanned(PhotoScanner.Result r) {
        if (r.error != null) {
            scan = null;
            scanText.setTextColor(RED);
            scanText.setText(r.error);
            updateRangeInfo();
            return;
        }
        scan = r;
        StringBuilder sb = new StringBuilder();
        if (r.items.isEmpty()) {
            sb.append("没找到文件名带日期的照片");
            scanText.setTextColor(AMBER);
        } else {
            long bytes = 0;
            int mtime = 0;
            for (PhotoScanner.Item it : r.items) {
                bytes += it.size;
                if (it.fromMtime) mtime++;
            }
            sb.append(String.format(Locale.ROOT, "共 %d 个（%s），最早 %s，最晚 %s",
                    r.items.size(), size(bytes), ymLabel(r.minYm()), ymLabel(r.maxYm())));
            if (mtime > 0) sb.append("\n其中 ").append(mtime).append(" 个按修改时间算");
            scanText.setTextColor(MUTED);
        }
        if (r.unrecognized > 0) sb.append("\n另有 ").append(r.unrecognized).append(" 个文件名里认不出日期，已忽略");
        scanText.setText(sb);

        // 每年一行，点一下把范围设成那一年
        histBox.removeAllViews();
        TreeMap<Integer, TreeMap<Integer, Integer>> h = r.histogram();
        if (!h.isEmpty()) {
            TextView tip = text("点某一年可以直接把范围设成那一年：", 12, MUTED);
            tip.setPadding(0, dp(8), 0, dp(2));
            histBox.addView(tip);
        }
        for (Map.Entry<Integer, TreeMap<Integer, Integer>> e : h.descendingMap().entrySet()) {
            int y = e.getKey();
            int total = 0;
            StringBuilder ms = new StringBuilder();
            for (Map.Entry<Integer, Integer> m : e.getValue().entrySet()) {
                total += m.getValue();
                if (ms.length() > 0) ms.append("  ");
                ms.append(m.getKey()).append("月:").append(m.getValue());
            }
            TextView row = text(y + " 年  共 " + total + "\n" + ms, 13, FG);
            row.setPadding(dp(10), dp(8), dp(10), dp(8));
            row.setBackground(round(0xFF24272E, dp(10)));
            row.setOnClickListener(v -> setRange(y * 100 + 1, y * 100 + 12));
            histBox.addView(row, topMargin(dp(6)));
        }

        // 第一次扫描且没存过范围：默认选全部
        if (!r.items.isEmpty() && !prefs.contains("from")) {
            fromYm = r.minYm();
            toYm = r.maxYm();
            saveRange();
        }
        rebuildYears();
    }

    // ───────────────────────── 复制 ─────────────────────────

    private void confirmCopy() {
        List<PhotoScanner.Item> sel = selected();
        if (sel.isEmpty()) {
            Toast.makeText(this, "范围内没有照片", Toast.LENGTH_SHORT).show();
            return;
        }
        if (PhotoScanner.canonical(srcDir).equals(PhotoScanner.canonical(dstDir)) && !cbByMonth.isChecked()) {
            Toast.makeText(this, "目标文件夹和源文件夹是同一个，请换一个", Toast.LENGTH_LONG).show();
            return;
        }
        long bytes = 0;
        for (PhotoScanner.Item it : sel) bytes += it.size;
        long free = freeSpace(dstDir);
        String msg = String.format(Locale.ROOT, "把 %s ～ %s 的 %d 个文件（%s）\n复制到：%s%s",
                ymLabel(fromYm), ymLabel(toYm), sel.size(), size(bytes), FolderPicker.pretty(dstDir),
                cbByMonth.isChecked() ? "/年-月/" : "");
        if (free > 0 && free < bytes) msg += "\n\n⚠ 剩余空间只有 " + size(free) + "，可能不够";
        new AlertDialog.Builder(this)
                .setTitle("确认复制")
                .setMessage(msg)
                .setPositiveButton("开始", (d, w) -> startCopy(sel))
                .setNegativeButton("取消", null)
                .show();
    }

    private void startCopy(List<PhotoScanner.Item> sel) {
        final AtomicBoolean cancel = new AtomicBoolean();
        cancelFlag = cancel;
        copying = true;
        long total = 0;
        for (PhotoScanner.Item it : sel) total += it.size;
        final long totalBytes = Math.max(1, total);
        final int count = sel.size();
        final File dst = dstDir;
        final boolean byMonth = cbByMonth.isChecked();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        progress.setProgress(0);
        progress.setVisibility(View.VISIBLE);
        btnCancel.setVisibility(View.VISIBLE);
        statusText.setTextColor(FG);
        statusText.setText("准备复制…");
        updateButtons();
        final long t0 = System.currentTimeMillis();
        worker.execute(() -> {
            final long[] lastUi = {0};
            Copier.Stats s = Copier.copy(sel, dst, byMonth, cancel, (done, bytesDone, name) -> {
                long now = System.currentTimeMillis();
                if (now - lastUi[0] < 150 && done < count) return;
                lastUi[0] = now;
                main.post(() -> {
                    progress.setProgress((int) (bytesDone * 1000 / totalBytes));
                    statusText.setText(String.format(Locale.ROOT, "%d / %d   %s / %s\n%s",
                            done, count, size(bytesDone), size(totalBytes), name));
                });
            });
            // 让新文件出现在相册里
            if (!s.newPaths.isEmpty()) {
                String[] paths = s.newPaths.toArray(new String[0]);
                MediaScannerConnection.scanFile(getApplicationContext(), paths, null, null);
            }
            long secs = Math.max(1, (System.currentTimeMillis() - t0) / 1000);
            main.post(() -> onCopied(s, secs));
        });
    }

    private void onCopied(Copier.Stats s, long secs) {
        copying = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        btnCancel.setVisibility(View.GONE);
        if (!s.cancelled) progress.setProgress(1000);
        StringBuilder sb = new StringBuilder();
        sb.append(s.cancelled ? "已取消。" : "完成！").append(String.format(Locale.ROOT,
                "复制 %d 个（%s），用时 %d 秒", s.copied, size(s.bytes), secs));
        if (s.skipped > 0) sb.append("\n跳过已存在 ").append(s.skipped).append(" 个");
        if (s.renamed > 0) sb.append("\n同名改名保存 ").append(s.renamed).append(" 个");
        if (s.failed > 0) sb.append("\n失败 ").append(s.failed).append(" 个，最后一个错误：").append(s.lastError);
        statusText.setTextColor(s.failed > 0 ? AMBER : s.cancelled ? MUTED : GREEN);
        statusText.setText(sb);
        updateButtons();
    }

    // ───────────────────────── 上传到百度网盘 ─────────────────────────

    /** 把范围内的照片分批交给百度网盘 App，在它里面选网盘文件夹上传 */
    private void shareToBaidu() {
        List<PhotoScanner.Item> sel = selected();
        if (sel.isEmpty()) {
            Toast.makeText(this, "范围内没有照片", Toast.LENGTH_SHORT).show();
            return;
        }
        Collections.sort(sel, (a, b) -> a.file.getName().compareTo(b.file.getName()));
        showBatchDialog(sel);
    }

    private void showBatchDialog(final List<PhotoScanner.Item> sel) {
        final int per = prefs.getInt("batch", 200);
        final int n = (sel.size() + per - 1) / per;
        final boolean[] sent = new boolean[n];
        final ArrayAdapter<String> ad = new ArrayAdapter<>(this,
                android.R.layout.simple_list_item_1, new ArrayList<String>());
        final Runnable fill = () -> {
            ad.clear();
            for (int i = 0; i < n; i++) {
                int from = i * per, to = Math.min(sel.size(), from + per);
                long bytes = 0;
                for (int k = from; k < to; k++) bytes += sel.get(k).size;
                ad.add(String.format(Locale.ROOT, "%s第 %d 批：%d 个，%s\n%s ～ %s",
                        sent[i] ? "✓ 已发送  " : "", i + 1, to - from, size(bytes),
                        sel.get(from).file.getName(), sel.get(to - 1).file.getName()));
            }
            ad.notifyDataSetChanged();
        };
        fill.run();

        ListView lv = new ListView(this);
        TextView hint = text(n > 1
                ? "点一批 → 在百度网盘里选上传位置 → 回到这里再点下一批。"
                : "点下面这一批 → 在百度网盘里选上传位置。", 13, MUTED);
        hint.setPadding(dp(20), dp(6), dp(20), dp(8));
        lv.addHeaderView(hint, null, false);
        lv.setAdapter(ad);
        final AlertDialog dlg = new AlertDialog.Builder(this)
                .setTitle(String.format(Locale.ROOT, "%s ～ %s 共 %d 个", ymLabel(fromYm), ymLabel(toYm), sel.size()))
                .setView(lv)
                .setPositiveButton("关闭", null)
                .setNeutralButton("每批 " + per + " 个 ▸", null)
                .create();
        lv.setOnItemClickListener((p, v, pos, id) -> {
            int i = (int) id; // 有表头，用 id 才是第几批
            if (i < 0 || i >= n) return;
            int from = i * per, to = Math.min(sel.size(), from + per);
            if (sendToBaidu(new ArrayList<>(sel.subList(from, to)))) {
                sent[i] = true;
                fill.run();
            }
        });
        dlg.setOnShowListener(d -> dlg.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
            // 轮流切换每批数量：网盘那边一次吃不下就调小
            int next = BATCH_SIZES[0];
            for (int k = 0; k < BATCH_SIZES.length; k++) {
                if (BATCH_SIZES[k] == per) next = BATCH_SIZES[(k + 1) % BATCH_SIZES.length];
            }
            prefs.edit().putInt("batch", next).apply();
            dlg.dismiss();
            showBatchDialog(sel);
        }));
        dlg.show();
    }

    /** @return true = 已经调起了网盘（或系统分享面板） */
    private boolean sendToBaidu(List<PhotoScanner.Item> items) {
        ArrayList<Uri> uris = new ArrayList<>();
        boolean allImages = true;
        for (PhotoScanner.Item it : items) {
            uris.add(ShareProvider.uriFor(it.file));
            if (!PhotoScanner.isMedia(it.file.getName(), false)) allImages = false;
        }
        Intent i;
        if (uris.size() == 1) {
            i = new Intent(Intent.ACTION_SEND);
            i.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        } else {
            i = new Intent(Intent.ACTION_SEND_MULTIPLE);
            i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        }
        i.setType(allImages ? "image/*" : "*/*");
        // 读权限要靠 ClipData 才会覆盖到每一个文件
        ClipData clip = ClipData.newRawUri("photos", uris.get(0));
        for (int k = 1; k < uris.size(); k++) clip.addItem(new ClipData.Item(uris.get(k)));
        i.setClipData(clip);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.setPackage(BAIDU_PKG);
        try {
            startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            // 没装百度网盘（或装的是别的版本）：退回系统分享面板自己挑
            i.setPackage(null);
            try {
                Toast.makeText(this, "没找到百度网盘 App，请在列表里自己选", Toast.LENGTH_LONG).show();
                startActivity(Intent.createChooser(i, "发送到"));
                return true;
            } catch (Exception e2) {
                Toast.makeText(this, "发送失败：" + e2.getMessage(), Toast.LENGTH_LONG).show();
                return false;
            }
        } catch (Exception e) {
            Toast.makeText(this, "发送失败，把每批数量调小再试：" + e.getMessage(), Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private void updateButtons() {
        if (btnCopy == null) return;
        boolean ok = !copying && !scanning && scan != null && fromYm <= toYm && hasStoragePermission();
        btnCopy.setEnabled(ok);
        btnCopy.setAlpha(ok ? 1f : 0.4f);
        btnBaidu.setEnabled(ok);
        btnBaidu.setAlpha(ok ? 1f : 0.4f);
        btnScan.setEnabled(!copying);
    }

    // ───────────────────────── 小工具 ─────────────────────────

    private static int nowYm() {
        Calendar c = Calendar.getInstance();
        return c.get(Calendar.YEAR) * 100 + c.get(Calendar.MONTH) + 1;
    }

    private static String ymLabel(int ym) {
        return (ym / 100) + "年" + (ym % 100) + "月";
    }

    private static long freeSpace(File dir) {
        File d = dir;
        while (d != null && !d.exists()) d = d.getParentFile();
        return d == null ? 0 : d.getUsableSpace();
    }

    static String size(long b) {
        if (b < 1024) return b + " B";
        if (b < 1024L * 1024) return String.format(Locale.ROOT, "%.1f KB", b / 1024.0);
        if (b < 1024L * 1024 * 1024) return String.format(Locale.ROOT, "%.1f MB", b / 1048576.0);
        return String.format(Locale.ROOT, "%.2f GB", b / 1073741824.0);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private static GradientDrawable round(int color, float r) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(r);
        return g;
    }

    private LinearLayout vbox() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private LinearLayout card(LinearLayout parent) {
        LinearLayout c = vbox();
        c.setPadding(dp(14), dp(12), dp(14), dp(14));
        c.setBackground(round(CARD, dp(14)));
        parent.addView(c, topMargin(dp(12)));
        return c;
    }

    private TextView text(String s, float sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        return t;
    }

    private TextView label(String s) {
        TextView t = text(s, 13, ACCENT);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, 0, 0, dp(6));
        return t;
    }

    private Button button(String s, boolean primary) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(primary ? 0xFFFFFFFF : FG);
        b.setBackground(round(primary ? ACCENT : 0xFF2A2D35, dp(10)));
        b.setMinHeight(dp(primary ? 50 : 40));
        b.setPadding(dp(14), 0, dp(14), 0);
        return b;
    }

    private Button button(String s, boolean primary, View.OnClickListener l) {
        Button b = button(s, primary);
        b.setOnClickListener(l);
        return b;
    }

    private CheckBox check(String s, boolean on) {
        CheckBox cb = new CheckBox(this);
        cb.setText(s);
        cb.setTextColor(FG);
        cb.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        cb.setChecked(on);
        return cb;
    }

    private LinearLayout row(View main, View right) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.addView(main, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(10);
        r.addView(right, lp);
        return r;
    }

    private LinearLayout rangeRow(String label, Spinner y, Spinner m) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        TextView t = text(label, 15, FG);
        r.addView(t, new LinearLayout.LayoutParams(dp(32), ViewGroup.LayoutParams.WRAP_CONTENT));
        r.addView(y, new LinearLayout.LayoutParams(0, dp(48), 1.2f));
        r.addView(m, new LinearLayout.LayoutParams(0, dp(48), 1f));
        return r;
    }

    private ArrayAdapter<String> adapter(List<String> items) {
        ArrayAdapter<String> a = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, items);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return a;
    }

    private LinearLayout.LayoutParams topMargin(int px) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = px;
        return lp;
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        lp.rightMargin = dp(6);
        return lp;
    }
}
