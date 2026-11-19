package com.example.photorange;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 照片按月复制：按文件名里的日期（IMG_20141114_164041.jpg）选「从某年某月 到 某年某月」，
 * 把范围内的照片复制到指定文件夹，或者一次全部交给百度网盘上传。
 */
public class MainActivity extends Activity {

    private static final int REQ_PERM = 1;
    private static final String BAIDU_PKG = "com.baidu.netdisk";
    /** 分批发送时每批多少个，轮流切换 */
    private static final int[] BATCH_SIZES = {100, 200, 500, ShareProvider.ONE_SHOT_MAX};

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;

    private LinearLayout permCard;
    private TextView srcText, dstText, scanText, rangeTitle, rangeText, timelineHint, statusText;
    private TextView btnScan, btnCopy, btnBaidu, btnBatches, btnCancel;
    private Switch swRecursive, swVideo, swMtime, swByMonth;
    private Spinner spFromY, spFromM, spToY, spToM;
    private HorizontalScrollView timelineScroll;
    private TimelineView timeline;
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
            Toast.makeText(this, "正在复制，要退出请先点「取消复制」", Toast.LENGTH_SHORT).show();
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
        sv.setBackgroundColor(Ui.BG);
        sv.setFillViewport(true);
        LinearLayout root = vbox();
        root.setPadding(dp(20), dp(28), dp(20), dp(40));
        sv.addView(root);

        // ── 抬头：名字 + 照片在哪 ──
        TextView title = Ui.text(this, "照片按月复制", 28, Ui.PAPER);
        title.setTypeface(Ui.SERIF_BOLD);
        root.addView(title);

        srcText = Ui.text(this, labeled("照片在", FolderPicker.pretty(srcDir)), 15, Ui.PAPER);
        TextView changeSrc = Ui.link(this, "更换");
        changeSrc.setOnClickListener(v -> FolderPicker.show(this, "选照片所在文件夹", srcDir, d -> {
            srcDir = d;
            prefs.edit().putString("src", d.getAbsolutePath()).apply();
            srcText.setText(labeled("照片在", FolderPicker.pretty(d)));
            startScan();
        }));
        root.addView(row(srcText, changeSrc), top(dp(10)));

        scanText = Ui.text(this, "", 13, Ui.MIST);
        btnScan = Ui.link(this, "重新扫描");
        btnScan.setOnClickListener(v -> startScan());
        root.addView(row(scanText, btnScan));

        // ── 没权限时的提示 ──
        permCard = vbox();
        permCard.setPadding(dp(18), dp(16), dp(18), dp(18));
        permCard.setBackground(Ui.outline(Ui.SUN, dp(1.5f), dp(20)));
        permCard.addView(Ui.text(this, "还没有「所有文件访问权限」，读不了照片文件夹。打开开关后回到这里就会自动扫描。", 14, Ui.PAPER));
        TextView bPerm = Ui.primaryButton(this, "去开启权限");
        bPerm.setOnClickListener(v -> requestStoragePermission());
        permCard.addView(bPerm, top(dp(12)));
        root.addView(permCard, top(dp(12)));

        // ── 时间轴面板：整页唯一的一块「卡片」 ──
        LinearLayout panel = vbox();
        panel.setPadding(dp(20), dp(22), dp(20), dp(20));
        panel.setBackground(Ui.round(Ui.PANEL, dp(26)));
        root.addView(panel, top(dp(14)));

        // 整页最大的字：选中的起止年月，写成 2014.11 – 2015.3
        rangeTitle = Ui.text(this, "", 30, Ui.PAPER);
        rangeTitle.setTypeface(Ui.SERIF);
        rangeTitle.setFontFeatureSettings("tnum");
        rangeTitle.setMaxLines(1);
        if (Build.VERSION.SDK_INT >= 26) {
            // 窄屏上自动缩一点，保证一行放得下
            rangeTitle.setAutoSizeTextTypeUniformWithConfiguration(18, 30, 1, TypedValue.COMPLEX_UNIT_SP);
        }
        panel.addView(rangeTitle);
        rangeText = Ui.text(this, "", 15, Ui.SUN);
        rangeText.setTypeface(Ui.MEDIUM);
        rangeText.setFontFeatureSettings("tnum");
        panel.addView(rangeText, top(dp(4)));

        timeline = new TimelineView(this);
        timeline.setOnRange((f, t) -> setRange(f, t, true));
        timelineScroll = new HorizontalScrollView(this);
        timelineScroll.setFillViewport(true);
        timelineScroll.setHorizontalScrollBarEnabled(false);
        timelineScroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        timelineScroll.addView(timeline, new HorizontalScrollView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        timelineScroll.setVisibility(View.GONE);
        panel.addView(timelineScroll, top(dp(14)));
        timelineHint = Ui.text(this, "", 12, Ui.MIST);
        panel.addView(timelineHint, top(dp(6)));

        spFromY = pillSpinner();
        spFromM = pillSpinner();
        spToY = pillSpinner();
        spToM = pillSpinner();
        panel.addView(rangeRow("从", spFromY, spFromM), top(dp(16)));
        panel.addView(rangeRow("到", spToY, spToM), top(dp(8)));
        List<String> months = new ArrayList<>();
        for (int m = 1; m <= 12; m++) months.add(m + " 月");
        spFromM.setAdapter(adapter(months));
        spToM.setAdapter(adapter(months));

        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        TextView cAll = Ui.chip(this, "全部");
        cAll.setOnClickListener(v -> {
            if (scan != null && !scan.items.isEmpty()) setRange(scan.minYm(), scan.maxYm(), true);
        });
        TextView cThis = Ui.chip(this, "今年");
        cThis.setOnClickListener(v -> setRange(nowYm() / 100 * 100 + 1, nowYm(), true));
        TextView cLast = Ui.chip(this, "去年");
        cLast.setOnClickListener(v -> {
            int y = nowYm() / 100 - 1;
            setRange(y * 100 + 1, y * 100 + 12, true);
        });
        for (TextView c : new TextView[]{cAll, cThis, cLast}) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = dp(8);
            quick.addView(c, lp);
        }
        panel.addView(quick, top(dp(14)));

        // ── 去向一：复制到文件夹 ──
        dstText = Ui.text(this, labeled("复制到", FolderPicker.pretty(dstDir)), 15, Ui.PAPER);
        TextView changeDst = Ui.link(this, "更换");
        changeDst.setOnClickListener(v -> FolderPicker.show(this, "选复制到哪个文件夹", dstDir, d -> {
            dstDir = d;
            prefs.edit().putString("dst", d.getAbsolutePath()).apply();
            dstText.setText(labeled("复制到", FolderPicker.pretty(d)));
        }));
        root.addView(row(dstText, changeDst), top(dp(26)));
        swByMonth = Ui.switchRow(this, root, "按年月分到子文件夹（2014-11、2014-12…）", prefs.getBoolean("bymonth", false));
        swByMonth.setOnCheckedChangeListener((b, on) -> saveSwitches());

        btnCopy = Ui.primaryButton(this, "复制");
        btnCopy.setOnClickListener(v -> confirmCopy());
        root.addView(btnCopy, top(dp(10)));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(1000);
        progress.setProgressTintList(ColorStateList.valueOf(Ui.SUN));
        progress.setProgressBackgroundTintList(ColorStateList.valueOf(Ui.PILL));
        progress.setVisibility(View.GONE);
        root.addView(progress, top(dp(14)));
        statusText = Ui.text(this, "", 14, Ui.PAPER);
        statusText.setFontFeatureSettings("tnum");
        statusText.setVisibility(View.GONE);
        root.addView(statusText, top(dp(6)));
        btnCancel = Ui.link(this, "取消复制");
        btnCancel.setVisibility(View.GONE);
        btnCancel.setOnClickListener(v -> cancelFlag.set(true));
        root.addView(btnCancel, wrap(dp(2)));

        // ── 去向二：百度网盘 ──
        btnBaidu = Ui.outlineButton(this, "上传到百度网盘");
        btnBaidu.setOnClickListener(v -> shareToBaidu(false));
        root.addView(btnBaidu, top(dp(12)));
        TextView baiduNote = Ui.text(this, "不占手机空间：照片一次全部交给百度网盘 App，在它里面选网盘文件夹。", 12, Ui.MIST);
        btnBatches = Ui.link(this, "分批发送");
        btnBatches.setOnClickListener(v -> shareToBaidu(true));
        root.addView(row(baiduNote, btnBatches), top(dp(6)));

        // ── 扫描选项 ──
        root.addView(Ui.divider(this), top(dp(22)));
        TextView optTitle = Ui.text(this, "扫描选项", 13, Ui.MIST);
        root.addView(optTitle, top(dp(16)));
        swRecursive = Ui.switchRow(this, root, "包含子文件夹", prefs.getBoolean("rec", false));
        root.addView(Ui.divider(this));
        swVideo = Ui.switchRow(this, root, "包含视频（VID_xxxx.mp4 等）", prefs.getBoolean("vid", false));
        root.addView(Ui.divider(this));
        swMtime = Ui.switchRow(this, root, "文件名里没日期的，按修改时间算", prefs.getBoolean("mtime", false));
        for (Switch s : new Switch[]{swRecursive, swVideo, swMtime}) {
            s.setOnCheckedChangeListener((b, on) -> {
                saveSwitches();
                startScan();
            });
        }
        root.addView(Ui.divider(this));
        root.addView(Ui.text(this, "原图不会被改动或删除。复制时，目标里已有同名同大小的文件会跳过；同名不同大小的另存为「名字 (1).jpg」。", 12, Ui.MIST), top(dp(16)));

        AdapterView.OnItemSelectedListener l = new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                readSpinners();
            }

            @Override
            public void onNothingSelected(AdapterView<?> p) {
            }
        };
        spFromY.setOnItemSelectedListener(l);
        spFromM.setOnItemSelectedListener(l);
        spToY.setOnItemSelectedListener(l);
        spToM.setOnItemSelectedListener(l);

        setContentView(sv);
    }

    private void saveSwitches() {
        prefs.edit()
                .putBoolean("rec", swRecursive.isChecked())
                .putBoolean("vid", swVideo.isChecked())
                .putBoolean("mtime", swMtime.isChecked())
                .putBoolean("bymonth", swByMonth.isChecked())
                .apply();
    }

    // ───────────────────────── 年月范围 ─────────────────────────

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

    /** @param byUser 用户自己选的才记下来；第一次扫描自动选「全部」不算 */
    private void setRange(int from, int to, boolean byUser) {
        fromYm = from;
        toYm = to;
        if (byUser) saveRange();
        if (years.isEmpty() || from / 100 < years.get(0) || to / 100 > years.get(years.size() - 1)) {
            rebuildYears();
        } else {
            applyRangeToSpinners();
        }
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
        int f = fy * 100 + spFromM.getSelectedItemPosition() + 1;
        int t = ty * 100 + spToM.getSelectedItemPosition() + 1;
        if (f == fromYm && t == toYm) return; // 程序自己设的，不是用户改的
        fromYm = f;
        toYm = t;
        saveRange();
        updateRangeInfo();
    }

    private void saveRange() {
        prefs.edit().putInt("from", fromYm).putInt("to", toYm).putBoolean("picked", true).apply();
    }

    private List<PhotoScanner.Item> selected() {
        List<PhotoScanner.Item> out = new ArrayList<>();
        if (scan == null) return out;
        for (PhotoScanner.Item it : scan.items) if (it.ym >= fromYm && it.ym <= toYm) out.add(it);
        return out;
    }

    /** 「张照片」还是「个文件」 */
    private String unit() {
        return swVideo != null && swVideo.isChecked() ? " 个文件" : " 张照片";
    }

    private void updateRangeInfo() {
        if (rangeText == null) return;
        rangeTitle.setText(fromYm == toYm ? ymDot(fromYm) : ymDot(fromYm) + " – " + ymDot(toYm));
        timeline.setSelection(fromYm, toYm);
        int n = 0;
        if (fromYm > toYm) {
            rangeText.setTextColor(Ui.CORAL);
            rangeText.setText("起点比终点晚，把「从」调早或把「到」调晚");
        } else if (scan == null) {
            rangeText.setTextColor(Ui.MIST);
            rangeText.setText(scanning ? "正在扫描…" : "还没扫描");
        } else {
            List<PhotoScanner.Item> sel = selected();
            n = sel.size();
            long bytes = 0;
            for (PhotoScanner.Item it : sel) bytes += it.size;
            if (n == 0) {
                rangeText.setTextColor(Ui.MIST);
                rangeText.setText("这段时间没有照片");
            } else {
                rangeText.setTextColor(Ui.SUN);
                rangeText.setText(n + unit() + "，" + size(bytes));
            }
        }
        btnCopy.setText(n > 0 ? "复制 " + n + unit() : "复制");
        btnBaidu.setText(n > 0 ? "上传 " + n + unit() + "到百度网盘" : "上传到百度网盘");
        updateButtons();
    }

    // ───────────────────────── 扫描 ─────────────────────────

    private void startScan() {
        if (copying) return;
        if (!hasStoragePermission()) {
            scanText.setTextColor(Ui.CORAL);
            scanText.setText("没有权限，无法扫描");
            return;
        }
        cancelFlag.set(true); // 停掉上一次还没扫完的
        AtomicBoolean cancel = new AtomicBoolean();
        cancelFlag = cancel;
        scanning = true;
        scan = null;
        scanText.setTextColor(Ui.MIST);
        scanText.setText("正在扫描…");
        updateRangeInfo();
        final File src = srcDir, dst = dstDir;
        final boolean rec = swRecursive.isChecked(), vid = swVideo.isChecked(), mt = swMtime.isChecked();
        worker.execute(() -> {
            PhotoScanner.Result r = PhotoScanner.scan(src, rec, vid, mt, dst, cancel,
                    n -> main.post(() -> {
                        if (cancelFlag == cancel) scanText.setText("正在扫描，已看 " + n + " 个文件…");
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
            scanText.setTextColor(Ui.CORAL);
            scanText.setText(r.error);
            showTimeline(null);
            updateRangeInfo();
            return;
        }
        scan = r;
        StringBuilder sb = new StringBuilder();
        if (r.items.isEmpty()) {
            sb.append("这个文件夹里没找到文件名带日期的照片。换个文件夹，或在下面打开「按修改时间算」。");
            scanText.setTextColor(Ui.SUN);
        } else {
            long bytes = 0;
            int mtime = 0;
            for (PhotoScanner.Item it : r.items) {
                bytes += it.size;
                if (it.fromMtime) mtime++;
            }
            sb.append("共 ").append(r.items.size()).append(unit()).append("，").append(size(bytes));
            if (mtime > 0) sb.append("，其中 ").append(mtime).append(" 个按修改时间算");
            scanText.setTextColor(Ui.MIST);
        }
        if (r.unrecognized > 0) {
            sb.append("\n另有 ").append(r.unrecognized).append(" 个文件名里认不出日期，没算进来");
        }
        scanText.setText(sb);
        showTimeline(r);

        // 用户还没自己选过范围：默认选全部
        if (!r.items.isEmpty() && !prefs.getBoolean("picked", false)) {
            fromYm = r.minYm();
            toYm = r.maxYm();
        }
        rebuildYears();
        // 把选中的起点滚到看得见的地方
        // （等时间轴按新数据排好版再滚）
        timelineScroll.postDelayed(() -> timelineScroll.scrollTo(Math.max(0, timeline.xOf(fromYm) - dp(40)), 0), 150);
    }

    /** 把扫描结果画成每月一根柱子 */
    private void showTimeline(PhotoScanner.Result r) {
        if (r == null || r.items.isEmpty()) {
            timelineScroll.setVisibility(View.GONE);
            timelineHint.setText("扫描到照片后，这里会按月画出每个月拍了多少张。");
            return;
        }
        int min = r.minYm(), max = r.maxYm();
        int m0 = (min / 100) * 12 + min % 100 - 1, m1 = (max / 100) * 12 + max % 100 - 1;
        int[] counts = new int[m1 - m0 + 1];
        for (PhotoScanner.Item it : r.items) counts[(it.ym / 100) * 12 + it.ym % 100 - 1 - m0]++;
        timeline.setData(min, counts);
        timelineScroll.setVisibility(View.VISIBLE);
        timelineHint.setText(counts.length > 1
                ? "每根柱子是一个月。点一个月设为起点，再点另一个月设为终点。"
                : "这个文件夹里的照片都在同一个月。");
    }

    // ───────────────────────── 复制 ─────────────────────────

    private void confirmCopy() {
        List<PhotoScanner.Item> sel = selected();
        if (sel.isEmpty()) {
            Toast.makeText(this, "这段时间没有照片", Toast.LENGTH_SHORT).show();
            return;
        }
        if (PhotoScanner.canonical(srcDir).equals(PhotoScanner.canonical(dstDir)) && !swByMonth.isChecked()) {
            Toast.makeText(this, "目标文件夹和照片所在文件夹是同一个，请换一个", Toast.LENGTH_LONG).show();
            return;
        }
        long bytes = 0;
        for (PhotoScanner.Item it : sel) bytes += it.size;
        long free = freeSpace(dstDir);
        String msg = String.format(Locale.ROOT, "把 %s 至 %s 的 %d%s（%s）\n复制到：%s%s",
                ymLabel(fromYm), ymLabel(toYm), sel.size(), unit(), size(bytes), FolderPicker.pretty(dstDir),
                swByMonth.isChecked() ? "/年-月/" : "");
        if (free > 0 && free < bytes) msg += "\n\n剩余空间只有 " + size(free) + "，可能不够。";
        new AlertDialog.Builder(this)
                .setTitle("复制这些照片？")
                .setMessage(msg)
                .setPositiveButton("复制", (d, w) -> startCopy(sel))
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
        final boolean byMonth = swByMonth.isChecked();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        progress.setProgress(0);
        progress.setVisibility(View.VISIBLE);
        btnCancel.setVisibility(View.VISIBLE);
        statusText.setVisibility(View.VISIBLE);
        statusText.setTextColor(Ui.PAPER);
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
                    statusText.setText(String.format(Locale.ROOT, "%d / %d，%s / %s\n%s",
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
        sb.append(s.cancelled ? "已取消。" : "已复制完。").append(String.format(Locale.ROOT,
                "复制了 %d 个（%s），用时 %d 秒", s.copied, size(s.bytes), secs));
        if (s.skipped > 0) sb.append("\n目标里已有、跳过 ").append(s.skipped).append(" 个");
        if (s.renamed > 0) sb.append("\n同名改名保存 ").append(s.renamed).append(" 个");
        if (s.failed > 0) sb.append("\n失败 ").append(s.failed).append(" 个，最后一个：").append(s.lastError);
        statusText.setTextColor(s.failed > 0 ? Ui.CORAL : s.cancelled ? Ui.MIST : Ui.SUN);
        statusText.setText(sb);
        updateButtons();
    }

    // ───────────────────────── 上传到百度网盘 ─────────────────────────

    /**
     * 把范围内的照片交给百度网盘 App，在它里面选网盘文件夹上传。
     * 默认一次全部交出去；超过一次能交的上限，或用户点了「分批发送」，才分批。
     */
    private void shareToBaidu(boolean inBatches) {
        List<PhotoScanner.Item> sel = selected();
        if (sel.isEmpty()) {
            Toast.makeText(this, "这段时间没有照片", Toast.LENGTH_SHORT).show();
            return;
        }
        Collections.sort(sel, (a, b) -> a.file.getName().compareTo(b.file.getName()));
        if (inBatches) {
            showBatchDialog(sel, prefs.getInt("batch", 200));
        } else if (sel.size() > ShareProvider.ONE_SHOT_MAX) {
            showBatchDialog(sel, ShareProvider.ONE_SHOT_MAX);
        } else {
            sendToBaidu(sel);
        }
    }

    private void showBatchDialog(final List<PhotoScanner.Item> sel, final int per) {
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
                ad.add(String.format(Locale.ROOT, "%s第 %d 批：%d 个，%s\n%s 至 %s",
                        sent[i] ? "✓ 已发送  " : "", i + 1, to - from, size(bytes),
                        sel.get(from).file.getName(), sel.get(to - 1).file.getName()));
            }
            ad.notifyDataSetChanged();
        };
        fill.run();

        ListView lv = new ListView(this);
        String why = sel.size() > ShareProvider.ONE_SHOT_MAX
                ? "系统一次最多能交给别的 App 约 " + ShareProvider.ONE_SHOT_MAX + " 个文件，所以分成几批。"
                : "";
        TextView hint = Ui.text(this, why + (n > 1
                ? "点一批，在百度网盘里选上传位置，回到这里再点下一批。"
                : "点下面这一批，在百度网盘里选上传位置。"), 13, Ui.MIST);
        hint.setPadding(dp(24), dp(6), dp(24), dp(8));
        lv.addHeaderView(hint, null, false);
        lv.setAdapter(ad);
        final AlertDialog dlg = new AlertDialog.Builder(this)
                .setTitle("分批发送，共 " + sel.size() + " 个")
                .setView(lv)
                .setPositiveButton("关闭", null)
                .setNeutralButton("每批 " + per + " 个，点这里换", null)
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
            int next = BATCH_SIZES[0];
            for (int k = 0; k < BATCH_SIZES.length; k++) {
                if (BATCH_SIZES[k] == per) next = BATCH_SIZES[(k + 1) % BATCH_SIZES.length];
            }
            prefs.edit().putInt("batch", next).apply();
            dlg.dismiss();
            showBatchDialog(sel, next);
        }));
        dlg.show();
    }

    /** @return true = 已经调起了网盘（或系统分享面板） */
    private boolean sendToBaidu(List<PhotoScanner.Item> items) {
        List<File> files = new ArrayList<>(items.size());
        boolean allImages = true;
        for (PhotoScanner.Item it : items) {
            files.add(it.file);
            if (!PhotoScanner.isMedia(it.file.getName(), false)) allImages = false;
        }
        ArrayList<Uri> uris;
        try {
            uris = ShareProvider.newSession(this, files);
        } catch (Exception e) {
            Toast.makeText(this, "没能准备好要上传的文件清单：" + e.getMessage(), Toast.LENGTH_LONG).show();
            return false;
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
                Toast.makeText(this, "没发出去：" + e2.getMessage(), Toast.LENGTH_LONG).show();
                return false;
            }
        } catch (Exception e) {
            Toast.makeText(this, "一次交出去的文件太多，系统没接住。点「分批发送」再试。", Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private void updateButtons() {
        if (btnCopy == null) return;
        boolean ok = !copying && !scanning && scan != null && fromYm <= toYm && hasStoragePermission()
                && !selected().isEmpty();
        Ui.setEnabled(btnCopy, ok);
        Ui.setEnabled(btnBaidu, ok);
        Ui.setEnabled(btnBatches, ok);
        Ui.setEnabled(btnScan, !copying);
    }

    // ───────────────────────── 小工具 ─────────────────────────

    private static int nowYm() {
        Calendar c = Calendar.getInstance();
        return c.get(Calendar.YEAR) * 100 + c.get(Calendar.MONTH) + 1;
    }

    private static String ymLabel(int ym) {
        return (ym / 100) + "年" + (ym % 100) + "月";
    }

    /** 2014.11 */
    private static String ymDot(int ym) {
        return (ym / 100) + "." + (ym % 100);
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
        return Ui.dp(this, v);
    }

    /** 「照片在 内部存储/DCIM/Camera」：前半截淡一点 */
    private static CharSequence labeled(String label, String value) {
        SpannableString s = new SpannableString(label + "  " + value);
        s.setSpan(new ForegroundColorSpan(Ui.MIST), 0, label.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    private LinearLayout vbox() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    /** 左边撑满、右边一个小控件 */
    private LinearLayout row(View left, View right) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(8);
        r.addView(right, lp);
        return r;
    }

    private Spinner pillSpinner() {
        Spinner s = new Spinner(this);
        s.setBackground(Ui.round(Ui.PILL, dp(22)));
        s.setPopupBackgroundDrawable(Ui.round(Ui.PILL, dp(14)));
        return s;
    }

    private LinearLayout rangeRow(String label, Spinner y, Spinner m) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.addView(Ui.text(this, label, 15, Ui.MIST), new LinearLayout.LayoutParams(dp(30), ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams ly = new LinearLayout.LayoutParams(0, dp(44), 1.25f);
        ly.rightMargin = dp(8);
        r.addView(y, ly);
        r.addView(m, new LinearLayout.LayoutParams(0, dp(44), 1f));
        return r;
    }

    /** 下拉框收起时的样子：相纸白的字 + 小箭头，和药丸底配套 */
    private ArrayAdapter<String> adapter(List<String> items) {
        ArrayAdapter<String> a = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, items) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView t = (TextView) super.getView(position, convertView, parent);
                t.setText(getItem(position) + "  ▾");
                t.setTextColor(Ui.PAPER);
                t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
                t.setGravity(Gravity.CENTER_VERTICAL);
                t.setPadding(dp(16), 0, dp(12), 0);
                return t;
            }
        };
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return a;
    }

    private LinearLayout.LayoutParams top(int px) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = px;
        return lp;
    }

    /** 不撑满宽度、靠左 */
    private LinearLayout.LayoutParams wrap(int topPx) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = topPx;
        return lp;
    }
}
