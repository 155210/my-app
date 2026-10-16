package com.example.noveltranslate;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.text.Layout;
import android.text.method.ScrollingMovementMethod;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 唯一的界面。四个页签：任务 / 接口 / 翻译设置 / 导出。
 * 界面只负责展示和收集输入，所有状态都在 Engine 里，Activity 被销毁重建不影响翻译。
 */
public class MainActivity extends Activity implements Engine.Listener {

    private static final int REQ_TXT = 11;
    private static final int REQ_UPDATE = 12;
    private static final int REQ_TASK_IN = 13;
    private static final int REQ_CONFIG_IN = 14;
    private static final int REQ_EPUB_OUT = 21;
    private static final int REQ_TXT_OUT = 22;
    private static final int REQ_TASK_OUT = 23;
    private static final int REQ_CONFIG_OUT = 24;

    private static final String[] PROVIDERS = {Settings.P_OPENAI, Settings.P_GEMINI, Settings.P_ANTHROPIC};
    private static final String[] PROVIDER_NAMES = {"OpenAI 兼容（含 DeepSeek、中转、本地模型）", "Google Gemini", "Anthropic Claude"};
    private static final String[] TITLE_FORMATS = {"original", "chinese", "arabic"};
    private static final String[] TITLE_FORMAT_NAMES = {"编号保持原样", "编号转中文数字（第十二话）", "编号转阿拉伯数字（第12话）"};

    private Engine eng;
    private Settings s;

    private FrameLayout content;
    private final TextView[] tabs = new TextView[4];
    private final View[] pages = new View[4];
    private int curTab;

    // 任务页
    private TextView fileInfo, progressText, streamView, logView, listTitle, selectedCount, setupHint;
    private ProgressBar progress;
    private Button startBtn, stopBtn, repairBtn, startFromBtn, multiBtn;
    private LinearLayout multiBar, streamBox;
    private ListView list;
    private ChunkAdapter adapter;
    private boolean multi;
    private final Set<Integer> selected = new HashSet<>();

    // 接口页
    private TextView modelStatus;
    private EditText modelEdit, endpointEdit;

    // 设置页
    private TextView glossaryInfo, blockHint;

    // 导出页
    private TextView regexResult, exportPreview;
    private EditText regexEdit;

    // 文件选择器回来之后要用的上下文
    private boolean pendingConfigWithKey;
    private String pendingUpdateMode;

    // ======================================================
    // 生命周期
    // ======================================================

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Ui.density = getResources().getDisplayMetrics().density;
        eng = Engine.get(this);
        s = eng.settings;

        Window w = getWindow();
        w.setStatusBarColor(Ui.BG);
        w.setNavigationBarColor(Ui.BG);
        w.getDecorView().setBackgroundColor(Ui.BG);

        LinearLayout root = Ui.col(this);
        root.setBackgroundColor(Ui.BG);

        LinearLayout head = Ui.row(this);
        head.setPadding(Ui.dp(16), Ui.dp(12), Ui.dp(16), Ui.dp(6));
        TextView title = Ui.text(this, "📖 小说翻译", 19, Ui.TEXT);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        head.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView help = Ui.text(this, "❓", 18, Ui.SUB);
        help.setPadding(Ui.dp(10), Ui.dp(4), Ui.dp(4), Ui.dp(4));
        help.setOnClickListener(v -> showHelp());
        head.addView(help);
        root.addView(head);

        LinearLayout tabRow = Ui.row(this);
        tabRow.setPadding(Ui.dp(10), 0, Ui.dp(10), Ui.dp(4));
        String[] names = {"任务", "接口", "翻译设置", "导出"};
        for (int i = 0; i < 4; i++) {
            final int k = i;
            TextView t = Ui.text(this, names[i], 14, Ui.SUB);
            t.setGravity(Gravity.CENTER);
            t.setPadding(0, Ui.dp(9), 0, Ui.dp(9));
            t.setOnClickListener(v -> switchTab(k));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            lp.setMargins(Ui.dp(3), 0, Ui.dp(3), 0);
            tabRow.addView(t, lp);
            tabs[i] = t;
        }
        root.addView(tabRow);

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        buildPages();
        switchTab(0);
        eng.addListener(this);
        refreshTask();
        streamView.setText(eng.streamText());
        logView.setText(TextUtil.tail(eng.logText(), 4000));
    }

    @Override
    protected void onDestroy() {
        eng.removeListener(this);
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        super.onPause();
        eng.saveSoon();
    }

    @Override
    public void onBackPressed() {
        if (multi) {
            setMulti(false);
            return;
        }
        if (curTab != 0) {
            switchTab(0);
            return;
        }
        super.onBackPressed();
    }

    private void buildPages() {
        content.removeAllViews();
        pages[0] = buildTaskPage();
        pages[1] = scroll(buildApiPage());
        pages[2] = scroll(buildSettingsPage());
        pages[3] = scroll(buildExportPage());
        for (View p : pages) content.addView(p, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** 导入配置/任务后整页重建，所有输入框重新读一遍设置 */
    private void rebuild() {
        int tab = curTab;
        buildPages();
        switchTab(tab);
        refreshTask();
    }

    private ScrollView scroll(View v) {
        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        LinearLayout wrap = Ui.col(this);
        wrap.addView(v);
        View pad = new View(this);
        wrap.addView(pad, new LinearLayout.LayoutParams(1, Ui.dp(40)));
        sv.addView(wrap);
        return sv;
    }

    private void switchTab(int i) {
        curTab = i;
        for (int k = 0; k < 4; k++) {
            pages[k].setVisibility(k == i ? View.VISIBLE : View.GONE);
            tabs[k].setTextColor(k == i ? 0xFFFFFFFF : Ui.SUB);
            tabs[k].setBackground(k == i ? Ui.round(Ui.ACCENT, 8) : Ui.round(Ui.CARD, 8));
        }
        if (i == 2) refreshGlossaryInfo();
    }

    private void toast(String m) {
        Toast.makeText(this, m, Toast.LENGTH_SHORT).show();
    }

    private void toastLong(String m) {
        Toast.makeText(this, m, Toast.LENGTH_LONG).show();
    }

    private void confirm(String title, String msg, Runnable ok) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(msg)
                .setPositiveButton("确定", (d, w) -> ok.run())
                .setNegativeButton("取消", null)
                .show();
    }

    private void info(String title, String msg) {
        new AlertDialog.Builder(this).setTitle(title).setMessage(msg).setPositiveButton("知道了", null).show();
    }

    private boolean busy() {
        if (eng.isRunning()) {
            toast("翻译进行中，请先停止");
            return true;
        }
        return false;
    }

    // ======================================================
    // 任务页
    // ======================================================

    private View buildTaskPage() {
        LinearLayout page = Ui.col(this);
        LinearLayout header = Ui.col(this);

        setupHint = Ui.text(this, "👉 第一次用：先到「接口」页填好接口地址、Key 和模型，点「快速测试」确认能通，再回来导入 TXT。", 13, Ui.ORANGE);
        setupHint.setBackground(Ui.roundStroke(0x22E8A33D, 0x66E8A33D, 10));
        setupHint.setPadding(Ui.dp(12), Ui.dp(10), Ui.dp(12), Ui.dp(10));
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.setMargins(Ui.dp(12), Ui.dp(8), Ui.dp(12), 0);
        header.addView(setupHint, hp);

        LinearLayout file = Ui.card(this, "📄 小说");
        fileInfo = Ui.text(this, "", 13, Ui.SUB);
        file.addView(fileInfo);
        Button imp = Ui.button(this, "导入 TXT", Ui.ACCENT);
        Button upd = Ui.small(this, "导入更新章节");
        Button rechunk = Ui.small(this, "重新分块");
        imp.setOnClickListener(v -> importTxt());
        upd.setOnClickListener(v -> importUpdate());
        rechunk.setOnClickListener(v -> rechunk());
        file.addView(Ui.buttonRow(this, imp, upd, rechunk));
        header.addView(file);

        LinearLayout ctl = Ui.card(this, "▶️ 翻译");
        startBtn = Ui.button(this, "开始翻译", Ui.GREEN);
        stopBtn = Ui.button(this, "停止", Ui.RED);
        repairBtn = Ui.small(this, "修复失败");
        startBtn.setOnClickListener(v -> startTranslate());
        stopBtn.setOnClickListener(v -> eng.stop());
        repairBtn.setOnClickListener(v -> repairFailed());
        ctl.addView(Ui.buttonRow(this, startBtn, stopBtn, repairBtn));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(8));
        pp.topMargin = Ui.dp(12);
        ctl.addView(progress, pp);
        progressText = Ui.text(this, "", 12, Ui.SUB);
        progressText.setPadding(0, Ui.dp(6), 0, 0);
        ctl.addView(progressText);

        TextView streamHead = Ui.text(this, "实时输出 / 日志  ▾", 13, Ui.ACCENT);
        streamHead.setPadding(0, Ui.dp(10), 0, Ui.dp(4));
        ctl.addView(streamHead);
        streamBox = Ui.col(this);
        streamView = monoBox(170);
        streamBox.addView(streamView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(170)));
        logView = monoBox(110);
        LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(110));
        lp2.topMargin = Ui.dp(6);
        streamBox.addView(logView, lp2);
        ctl.addView(streamBox);
        streamHead.setOnClickListener(v -> {
            boolean show = streamBox.getVisibility() != View.VISIBLE;
            streamBox.setVisibility(show ? View.VISIBLE : View.GONE);
            streamHead.setText(show ? "实时输出 / 日志  ▾" : "实时输出 / 日志  ▸");
        });
        header.addView(ctl);

        LinearLayout lh = Ui.row(this);
        lh.setPadding(Ui.dp(14), Ui.dp(14), Ui.dp(12), Ui.dp(6));
        listTitle = Ui.title(this, "📋 分块列表");
        lh.addView(listTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        startFromBtn = Ui.small(this, "📍 起始块");
        multiBtn = Ui.small(this, "☑️ 多选");
        startFromBtn.setOnClickListener(v -> showStartFrom());
        multiBtn.setOnClickListener(v -> setMulti(!multi));
        lh.addView(startFromBtn);
        LinearLayout.LayoutParams mlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mlp.leftMargin = Ui.dp(6);
        lh.addView(multiBtn, mlp);
        header.addView(lh);
        TextView tip = Ui.hint(this, "点任意一块可查看 / 编辑 / 复制 / 合并 / 重翻；多选可批量重翻或删除。");
        tip.setPadding(Ui.dp(14), 0, Ui.dp(14), Ui.dp(6));
        header.addView(tip);

        list = new ListView(this);
        list.setDivider(null);
        list.setBackgroundColor(Ui.BG);
        list.setCacheColorHint(Ui.BG);
        list.addHeaderView(header, null, false);
        adapter = new ChunkAdapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, pos, id) -> {
            int idx = pos - list.getHeaderViewsCount();
            if (idx < 0 || idx >= eng.chapters.size()) return;
            if (multi) {
                if (!selected.remove(idx)) selected.add(idx);
                adapter.notifyDataSetChanged();
                updateMultiBar();
            } else {
                showBlock(idx);
            }
        });
        page.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        multiBar = Ui.col(this);
        multiBar.setBackground(Ui.roundStroke(0xFF1B2A40, 0xFF2D5A9A, 0));
        multiBar.setPadding(Ui.dp(10), Ui.dp(6), Ui.dp(10), Ui.dp(10));
        selectedCount = Ui.text(this, "已选 0 块", 13, Ui.ACCENT);
        selectedCount.setPadding(Ui.dp(2), Ui.dp(4), 0, 0);
        multiBar.addView(selectedCount);
        Button all = Ui.small(this, "全选");
        Button inv = Ui.small(this, "反选");
        Button none = Ui.small(this, "清空");
        Button failed = Ui.small(this, "选失败块");
        all.setOnClickListener(v -> {
            for (int i = 0; i < eng.chapters.size(); i++) selected.add(i);
            afterSelect();
        });
        inv.setOnClickListener(v -> {
            Set<Integer> next = new HashSet<>();
            for (int i = 0; i < eng.chapters.size(); i++) if (!selected.contains(i)) next.add(i);
            selected.clear();
            selected.addAll(next);
            afterSelect();
        });
        none.setOnClickListener(v -> {
            selected.clear();
            afterSelect();
        });
        failed.setOnClickListener(v -> {
            selected.clear();
            List<Chapter> l = eng.chapters;
            for (int i = 0; i < l.size(); i++) if (Chapter.FAILED.equals(l.get(i).status)) selected.add(i);
            if (selected.isEmpty()) toast("当前没有失败的块");
            afterSelect();
        });
        multiBar.addView(Ui.buttonRow(this, all, inv, none, failed));
        Button reTr = Ui.button(this, "🔁 重翻选中", Ui.ACCENT);
        Button del = Ui.button(this, "🗑️ 删除选中", Ui.RED);
        Button exit = Ui.small(this, "退出多选");
        reTr.setOnClickListener(v -> batchRetranslate());
        del.setOnClickListener(v -> batchDelete());
        exit.setOnClickListener(v -> setMulti(false));
        multiBar.addView(Ui.buttonRow(this, reTr, del, exit));
        multiBar.setVisibility(View.GONE);
        page.addView(multiBar);
        return page;
    }

    private TextView monoBox(int heightDp) {
        TextView t = Ui.text(this, "", 12, 0xFFC9D1D9);
        t.setTypeface(Typeface.MONOSPACE);
        t.setBackground(Ui.round(0xFF0F1115, 8));
        t.setPadding(Ui.dp(8), Ui.dp(6), Ui.dp(8), Ui.dp(6));
        t.setMovementMethod(new ScrollingMovementMethod());
        t.setTextIsSelectable(false);
        Ui.nestedScroll(t);
        return t;
    }

    private static void scrollToBottom(TextView t) {
        t.post(() -> {
            Layout l = t.getLayout();
            if (l == null) return;
            int y = l.getHeight() - (t.getHeight() - t.getPaddingTop() - t.getPaddingBottom());
            t.scrollTo(0, Math.max(0, y));
        });
    }

    private void afterSelect() {
        adapter.notifyDataSetChanged();
        updateMultiBar();
    }

    private void setMulti(boolean on) {
        multi = on;
        selected.clear();
        multiBar.setVisibility(on ? View.VISIBLE : View.GONE);
        multiBtn.setText(on ? "☑️ 多选中" : "☑️ 多选");
        multiBtn.setBackground(Ui.round(on ? Ui.ACCENT : Ui.BTN, 8));
        afterSelect();
    }

    private void updateMultiBar() {
        selectedCount.setText("已选 " + selected.size() + " 块（点整行勾选）");
    }

    private void refreshTask() {
        List<Chapter> l = eng.chapters;
        boolean running = eng.isRunning();
        boolean configured = !TextUtil.isBlank(s.apiModel) || (Settings.P_OPENAI.equals(s.apiProvider) && !TextUtil.isBlank(s.apiEndpoint));
        setupHint.setVisibility(configured ? View.GONE : View.VISIBLE);

        if (l.isEmpty()) {
            fileInfo.setText("还没有导入小说。点「导入 TXT」选择文件，会自动识别 UTF-8 / GBK 编码。");
        } else {
            long chars = 0;
            for (Chapter c : l) chars += c.source.length();
            fileInfo.setText((TextUtil.isBlank(eng.fileName) ? "（未命名）" : eng.fileName) + "\n"
                    + String.format(java.util.Locale.ROOT, "%.1f", chars / 10000f) + " 万字 · " + l.size() + " 块 · 约 "
                    + Ui.fmtTk(eng.totalTokens()) + " tk · 每块上限 " + s.chunkTokens + " tk");
        }
        int done = eng.countDone();
        progress.setMax(Math.max(1, l.size()));
        progress.setProgress(done);
        progressText.setText(l.isEmpty() ? "" : eng.progressLine());

        startBtn.setEnabled(!running);
        startBtn.setAlpha(running ? 0.5f : 1f);
        startBtn.setText(running ? "翻译中…" : (eng.startIndex > 0 ? "从第" + (eng.startIndex + 1) + "块开始" : "开始翻译"));
        stopBtn.setEnabled(running);
        stopBtn.setAlpha(running ? 1f : 0.4f);
        repairBtn.setEnabled(!running);

        listTitle.setText("📋 分块列表（" + l.size() + "）");
        if (multi) {
            // 列表被合并/删除后，超出范围的勾选要清掉
            selected.removeIf(i -> i >= l.size());
            updateMultiBar();
        }
        adapter.notifyDataSetChanged();
    }

    @Override
    public void onChanged() {
        refreshTask();
    }

    @Override
    public void onStream(String text) {
        streamView.setText(text);
        scrollToBottom(streamView);
    }

    @Override
    public void onLog(String line) {
        logView.setText(TextUtil.tail(eng.logText(), 4000));
        scrollToBottom(logView);
    }

    private final class ChunkAdapter extends BaseAdapter {
        @Override public int getCount() { return eng.chapters.size(); }
        @Override public Object getItem(int p) { return eng.chapters.get(p); }
        @Override public long getItemId(int p) { return p; }

        @Override
        public View getView(int pos, View convert, ViewGroup parent) {
            Holder h;
            if (convert == null) {
                h = new Holder();
                LinearLayout row = Ui.row(MainActivity.this);
                row.setPadding(Ui.dp(12), Ui.dp(10), Ui.dp(12), Ui.dp(10));
                h.check = Ui.check(MainActivity.this);
                row.addView(h.check);
                h.icon = Ui.text(MainActivity.this, "", 14, Ui.TEXT);
                h.icon.setPadding(0, 0, Ui.dp(8), 0);
                row.addView(h.icon);
                LinearLayout mid = Ui.col(MainActivity.this);
                h.title = Ui.text(MainActivity.this, "", 14, Ui.TEXT);
                h.title.setSingleLine(true);
                h.meta = Ui.text(MainActivity.this, "", 11, Ui.SUB);
                h.meta.setSingleLine(true);
                mid.addView(h.title);
                mid.addView(h.meta);
                row.addView(mid, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                h.tk = Ui.text(MainActivity.this, "", 11, Ui.SUB);
                h.tk.setPadding(Ui.dp(8), 0, 0, 0);
                row.addView(h.tk);
                FrameLayout wrap = new FrameLayout(MainActivity.this);
                wrap.setPadding(Ui.dp(10), Ui.dp(3), Ui.dp(10), Ui.dp(3));
                wrap.addView(row);
                h.row = row;
                convert = wrap;
                convert.setTag(h);
            } else {
                h = (Holder) convert.getTag();
            }
            List<Chapter> l = eng.chapters;
            if (pos >= l.size()) return convert;
            Chapter c = l.get(pos);
            String st = c.status;
            String icon = Chapter.DONE.equals(st) ? "✅" : Chapter.FAILED.equals(st) ? "❌" : Chapter.RUNNING.equals(st) ? "🔄" : "⚪";
            h.icon.setText(icon);
            boolean isStart = !multi && pos == eng.startIndex && eng.startIndex > 0;
            h.title.setText((isStart ? "📍 " : "") + "第" + (pos + 1) + "块  " + preview(c.source));
            String meta;
            if (Chapter.FAILED.equals(st)) meta = "失败：" + (TextUtil.isBlank(c.error) ? "未知错误" : c.error);
            else if (c.isDone()) meta = "原文 " + c.source.length() + " 字 → 译文 " + c.translated.length() + " 字";
            else if (Chapter.RUNNING.equals(st)) meta = "翻译中…";
            else meta = "原文 " + c.source.length() + " 字";
            h.meta.setText(meta);
            h.meta.setTextColor(Chapter.FAILED.equals(st) ? Ui.RED : Ui.SUB);
            h.tk.setText(Ui.fmtTk(c.tokens()) + " tk");
            h.check.setVisibility(multi ? View.VISIBLE : View.GONE);
            h.check.setChecked(selected.contains(pos));
            int bg = multi && selected.contains(pos) ? 0xFF22395C
                    : Chapter.RUNNING.equals(st) ? 0xFF1F2E44
                    : Ui.CARD;
            h.row.setBackground(isStart ? Ui.roundStroke(bg, Ui.ORANGE, 10) : Ui.round(bg, 10));
            return convert;
        }
    }

    private static final class Holder {
        LinearLayout row;
        CheckBox check;
        TextView icon, title, meta, tk;
    }

    private static String preview(String src) {
        String t = src == null ? "" : src.trim();
        int nl = t.indexOf('\n');
        if (nl > 0) t = t.substring(0, nl);
        return t.length() > 24 ? t.substring(0, 24) + "…" : t;
    }

    // ---------------- 导入 / 分块 ----------------

    private void openDoc(int req) {
        Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("*/*");
        try {
            startActivityForResult(it, req);
        } catch (Exception e) {
            toast("没有可用的文件选择器");
        }
    }

    private void createDoc(int req, String mime, String name) {
        Intent it = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType(mime);
        it.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(it, req);
        } catch (Exception e) {
            toast("没有可用的文件管理器");
        }
    }

    private void importTxt() {
        if (busy()) return;
        if (eng.countDone() > 0) {
            confirm("导入新小说", "当前任务已有 " + eng.countDone() + " 块译文，导入新文件会覆盖它们。\n\n建议先到「导出」页导出任务备份。确定继续吗？",
                    () -> openDoc(REQ_TXT));
        } else {
            openDoc(REQ_TXT);
        }
    }

    private void importUpdate() {
        if (busy()) return;
        if (eng.chapters.isEmpty()) {
            toast("请先导入原始 TXT");
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("导入更新章节")
                .setItems(new String[] {
                        "➕ 仅新增模式：文件里只有新章节，整个追加到末尾",
                        "📘 完整文件模式：更新后的整本 TXT，自动找出新增部分"
                }, (d, which) -> {
                    pendingUpdateMode = which == 0 ? "append" : "full";
                    openDoc(REQ_UPDATE);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void rechunk() {
        if (busy()) return;
        List<Chapter> l = eng.chapters;
        if (l.isEmpty()) {
            toast("还没有导入文件");
            return;
        }
        List<Chapter> next = TextUtil.splitBySize(TextUtil.joinSources(l), s.chunkTokens);
        int done = eng.countDone();
        confirm("按当前上限重新分块",
                "按 " + s.chunkTokens + " tk 上限重新分块：\n\n" + l.size() + " 块 → " + next.size() + " 块"
                        + (done > 0 ? "\n\n⚠️ 当前有 " + done + " 块已翻译，重新分块后这些译文会全部作废，建议先导出任务备份。" : ""),
                () -> {
                    eng.setChapters(next, null);
                    selected.clear();
                    eng.log("♻️ 已按 " + s.chunkTokens + " tk 重新分块：共 " + next.size() + " 块");
                });
    }

    private String displayName(Uri uri) {
        String name = "";
        try (Cursor c = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        }
        if (name == null || name.isEmpty()) {
            String p = uri.getLastPathSegment();
            name = p == null ? "小说.txt" : p.substring(p.lastIndexOf('/') + 1);
        }
        return name;
    }

    private byte[] readUri(Uri uri) throws IOException {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("打不开文件");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        }
    }

    private OutputStream writeUri(Uri uri) throws IOException {
        OutputStream os;
        try {
            os = getContentResolver().openOutputStream(uri, "wt");
        } catch (Exception e) {
            os = getContentResolver().openOutputStream(uri, "w");
        }
        if (os == null) throw new IOException("无法写入文件");
        return os;
    }

    private interface Work {
        void run() throws Exception;
    }

    /** 读写大文件放后台线程，出错弹提示 */
    private void background(String what, Work work) {
        toast(what + "…");
        new Thread(() -> {
            try {
                work.run();
            } catch (Throwable e) {
                String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                runOnUiThread(() -> info(what + "失败", m));
            }
        }).start();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        switch (req) {
            case REQ_TXT: onTxtPicked(uri); break;
            case REQ_UPDATE: onUpdatePicked(uri); break;
            case REQ_TASK_IN: onTaskPicked(uri); break;
            case REQ_CONFIG_IN: onConfigPicked(uri); break;
            case REQ_EPUB_OUT: doExport(uri, true); break;
            case REQ_TXT_OUT: doExport(uri, false); break;
            case REQ_TASK_OUT: doExportTask(uri); break;
            case REQ_CONFIG_OUT: doExportConfig(uri); break;
            default: break;
        }
    }

    private void onTxtPicked(Uri uri) {
        String name = displayName(uri);
        background("正在读取 " + name, () -> {
            TextUtil.Decoded d = TextUtil.decode(readUri(uri));
            if (TextUtil.isBlank(d.text)) throw new IOException("文件是空的");
            List<Chapter> blocks = TextUtil.splitBySize(d.text, s.chunkTokens);
            runOnUiThread(() -> {
                eng.setChapters(blocks, name);
                selected.clear();
                if (TextUtil.isBlank(s.bookTitle)) s.bookTitle = "";
                eng.log("✅ 已导入 " + name + "：编码 " + d.encoding + "，" + d.text.length() + " 字，按长度切成 " + blocks.size() + " 块");
                toastLong("已导入：" + blocks.size() + " 块（编码 " + d.encoding + "）");
            });
        });
    }

    private void onUpdatePicked(Uri uri) {
        final String mode = pendingUpdateMode == null ? "append" : pendingUpdateMode;
        background("正在读取更新文件", () -> {
            String content = TextUtil.normalizeNewlines(TextUtil.decode(readUri(uri)).text);
            String newPart;
            if ("append".equals(mode)) {
                newPart = TextUtil.trimLines(content);
            } else {
                String old = TextUtil.normalizeNewlines(TextUtil.joinSources(eng.chapters));
                int oldLen = old.length();
                // 拿现有内容末尾一段当锚点定位。先看预期位置，再 lastIndexOf，最后才按长度截取。
                // 不能用 indexOf：小说里常有重复段落，会命中靠前那次，把旧内容当新增又导一遍。
                int anchorLen = Math.min(2000, oldLen);
                String anchor = old.substring(oldLen - anchorLen);
                int expected = oldLen - anchorLen;
                int pos;
                if (anchorLen == 0) pos = -1;
                else if (content.startsWith(anchor, expected)) pos = expected;
                else pos = content.lastIndexOf(anchor);
                if (pos >= 0) newPart = content.substring(pos + anchor.length());
                else newPart = content.length() > oldLen ? content.substring(oldLen) : "";
                newPart = TextUtil.trimLines(newPart);
            }
            if (TextUtil.isBlank(newPart)) {
                runOnUiThread(() -> info("没有新增内容",
                        "未检测到新增章节。\n\n如果文件里只有新章节，请改用「仅新增模式」。\n"
                                + "如果之前编辑或合并过分块，整篇内容和原 TXT 对不上，锚点可能失效，也请改用「仅新增模式」。"));
                return;
            }
            List<Chapter> pieces = TextUtil.splitBySize(newPart, s.chunkTokens);
            final String part = newPart;
            runOnUiThread(() -> {
                int from = eng.chapters.size() + 1;
                confirm("导入更新章节",
                        "检测到约 " + String.format(java.util.Locale.ROOT, "%.1f", part.length() / 1000f) + "k 字新增内容。\n\n"
                                + "将切成 " + pieces.size() + " 块追加到末尾（第 " + from + "~" + (from + pieces.size() - 1) + " 块）。\n"
                                + "已翻译的块不受影响。",
                        () -> {
                            List<Chapter> next = new ArrayList<>(eng.chapters);
                            next.addAll(pieces);
                            eng.replaceChapters(next);
                            eng.log("📗 已追加 " + pieces.size() + " 块，点「开始翻译」只会跑未翻译的块");
                        });
            });
        });
    }

    // ---------------- 翻译 ----------------

    private boolean checkReady() {
        if (eng.chapters.isEmpty()) {
            toast("请先导入 TXT");
            return false;
        }
        if (TextUtil.isBlank(s.apiModel) && !Settings.P_OPENAI.equals(s.apiProvider)) {
            toast("请先到「接口」页填写模型");
            switchTab(1);
            return false;
        }
        if (TextUtil.isBlank(s.apiKey) && !Settings.P_OPENAI.equals(s.apiProvider)) {
            toast("请先到「接口」页填写 API Key");
            switchTab(1);
            return false;
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            // 不给也能翻，只是通知栏看不到进度
            requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 7);
        }
        return true;
    }

    private void startTranslate() {
        if (busy() || !checkReady()) return;
        eng.startFrom(this, eng.startIndex);
    }

    private void repairFailed() {
        if (busy()) return;
        List<Chapter> failed = new ArrayList<>();
        for (Chapter c : eng.chapters) if (Chapter.FAILED.equals(c.status)) failed.add(c);
        if (failed.isEmpty()) {
            toast("没有失败的块");
            return;
        }
        if (!checkReady()) return;
        confirm("修复失败", "将重新翻译 " + failed.size() + " 个失败的块。", () -> eng.start(this, failed, "修复 " + failed.size() + " 个失败块"));
    }

    private List<Chapter> selectedChapters() {
        List<Integer> idx = new ArrayList<>(selected);
        Collections.sort(idx);
        List<Chapter> out = new ArrayList<>();
        List<Chapter> l = eng.chapters;
        for (int i : idx) if (i >= 0 && i < l.size()) out.add(l.get(i));
        return out;
    }

    private void batchRetranslate() {
        if (busy()) return;
        List<Chapter> sel = selectedChapters();
        if (sel.isEmpty()) {
            toast("还没有勾选任何块");
            return;
        }
        if (!checkReady()) return;
        int done = 0;
        for (Chapter c : sel) if (c.isDone()) done++;
        confirm("批量重翻", "重新翻译选中的 " + sel.size() + " 块？\n\n"
                        + (done > 0 ? "其中 " + done + " 块已有译文，会被覆盖。\n\n" : "") + "未选中的块不受影响。",
                () -> {
                    for (Chapter c : sel) c.resetTranslation();
                    setMulti(false);
                    eng.start(this, sel, "批量重翻 " + sel.size() + " 块");
                });
    }

    private void batchDelete() {
        if (busy()) return;
        List<Chapter> sel = selectedChapters();
        if (sel.isEmpty()) {
            toast("还没有勾选任何块");
            return;
        }
        String extra = sel.size() == eng.chapters.size() ? "\n\n⚠️ 这是全部分块！" : "";
        confirm("删除选中", "删除选中的 " + sel.size() + " 块？原文和译文都会丢失，且无法撤销。" + extra, () -> {
            List<Chapter> next = new ArrayList<>(eng.chapters);
            next.removeAll(sel);
            selected.clear();
            eng.replaceChapters(next);
            eng.log("🗑️ 已删除 " + sel.size() + " 块，剩余 " + next.size() + " 块");
        });
    }

    private void showStartFrom() {
        List<Chapter> l = eng.chapters;
        if (l.isEmpty()) {
            toast("请先导入文件");
            return;
        }
        String[] items = new String[l.size()];
        for (int i = 0; i < l.size(); i++) {
            Chapter c = l.get(i);
            String icon = c.isDone() ? "✅" : Chapter.FAILED.equals(c.status) ? "❌" : "⚪";
            items[i] = icon + " 第" + (i + 1) + "块 · " + c.source.length() + "字 · " + Ui.fmtTk(c.tokens()) + "tk";
        }
        final int[] pick = {Math.min(eng.startIndex, l.size() - 1)};
        new AlertDialog.Builder(this)
                .setTitle("📍 从哪一块开始翻译")
                .setSingleChoiceItems(items, pick[0], (d, w) -> pick[0] = w)
                .setPositiveButton("确定", (d, w) -> {
                    eng.startIndex = pick[0];
                    eng.saveSoon();
                    eng.log("📍 起始块设为第 " + (pick[0] + 1) + " 块（之前的块会跳过，已完成的不会重翻）");
                    refreshTask();
                })
                .setNeutralButton("重置为第1块", (d, w) -> {
                    eng.startIndex = 0;
                    eng.saveSoon();
                    refreshTask();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    // ---------------- 分块详情 ----------------

    private void copy(String label, String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText(label, text));
            toast("已复制 " + text.length() + " 字");
        } catch (RuntimeException e) {
            // 系统剪贴板走 Binder，单次大约 1MB 上限，超长内容会失败
            toast("内容太长，剪贴板放不下，请在输入框里手动选择复制");
        }
    }

    private void showBlock(int idx) {
        List<Chapter> l = eng.chapters;
        if (idx < 0 || idx >= l.size()) return;
        Chapter ch = l.get(idx);

        LinearLayout box = Ui.col(this);
        box.setPadding(Ui.dp(16), Ui.dp(6), Ui.dp(16), Ui.dp(6));

        String st = ch.isDone() ? "✅ 已完成" : Chapter.FAILED.equals(ch.status) ? "❌ 失败"
                : Chapter.RUNNING.equals(ch.status) ? "🔄 翻译中" : "⚪ 等待翻译";
        TextView infoText = Ui.text(this, st + " · 原文 " + ch.source.length() + " 字 · 约 " + Ui.fmtTk(ch.tokens())
                + " tk · 译文 " + (TextUtil.isBlank(ch.translated) ? "—" : ch.translated.length() + " 字"), 12, Ui.SUB);
        box.addView(infoText);
        if (!TextUtil.isBlank(ch.error)) {
            TextView err = Ui.text(this, "❌ " + ch.error, 12, Ui.RED);
            err.setPadding(0, Ui.dp(4), 0, 0);
            box.addView(err);
        }

        EditText src = Ui.edit(this, "原文", true);
        src.setText(ch.source);
        src.setTextSize(13);
        Ui.nestedScroll(src);
        EditText dst = Ui.edit(this, "尚未翻译", true);
        dst.setText(ch.translated);
        dst.setTextSize(13);
        Ui.nestedScroll(dst);

        LinearLayout srcHead = Ui.row(this);
        srcHead.setPadding(0, Ui.dp(10), 0, Ui.dp(4));
        srcHead.addView(Ui.text(this, "📝 原文（可编辑）", 13, Ui.TEXT), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button copySrc = Ui.small(this, "📋 复制原文");
        copySrc.setOnClickListener(v -> copy("原文", src.getText().toString()));
        srcHead.addView(copySrc);
        box.addView(srcHead);
        box.addView(src, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(200)));

        LinearLayout dstHead = Ui.row(this);
        dstHead.setPadding(0, Ui.dp(10), 0, Ui.dp(4));
        dstHead.addView(Ui.text(this, "📗 译文（可编辑，保存即生效）", 13, Ui.TEXT), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button copyDst = Ui.small(this, "📋 复制译文");
        copyDst.setOnClickListener(v -> copy("译文", dst.getText().toString()));
        dstHead.addView(copyDst);
        box.addView(dstHead);
        box.addView(dst, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(200)));

        Button mergePrev = Ui.small(this, "⬆️ 并入上一块");
        Button mergeNext = Ui.small(this, "⬇️ 并入下一块");
        Button split = Ui.small(this, "✂️ 按上限重切");
        Button retry = Ui.button(this, "🔁 重翻本块", Ui.ACCENT);
        Button del = Ui.button(this, "🗑️ 删除本块", Ui.RED);
        mergePrev.setEnabled(idx > 0);
        mergePrev.setAlpha(idx > 0 ? 1f : 0.4f);
        mergeNext.setEnabled(idx < l.size() - 1);
        mergeNext.setAlpha(idx < l.size() - 1 ? 1f : 0.4f);
        box.addView(Ui.buttonRow(this, mergePrev, mergeNext, split));
        box.addView(Ui.buttonRow(this, retry, del));

        ScrollView sv = new ScrollView(this);
        sv.addView(box);

        AlertDialog d = new AlertDialog.Builder(this)
                .setTitle("📄 第 " + (idx + 1) + " 块 / 共 " + l.size() + " 块")
                .setView(sv)
                .setPositiveButton("💾 保存", null)
                .setNegativeButton("关闭", null)
                .create();

        d.setOnShowListener(x -> d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String newSrc = src.getText().toString();
            String newDst = dst.getText().toString();
            boolean srcChanged = !newSrc.equals(ch.source);
            boolean dstChanged = !newDst.equals(ch.translated);
            if (srcChanged && eng.isRunning() && Chapter.RUNNING.equals(ch.status)) {
                toast("这一块正在翻译，等它跑完再改原文");
                return;
            }
            if (srcChanged) {
                ch.source = newSrc;
                // 原文改了，旧译文已经对不上；但用户手改的译文要留住
                if (!dstChanged) ch.resetTranslation();
            }
            if (dstChanged) {
                ch.translated = newDst;
                ch.status = TextUtil.isBlank(newDst) ? Chapter.PENDING : Chapter.DONE;
                ch.error = "";
            }
            eng.saveSoon();
            eng.fireChanged();
            d.dismiss();
        }));

        mergePrev.setOnClickListener(v -> mergeInto(d, idx, -1, src.getText().toString()));
        mergeNext.setOnClickListener(v -> mergeInto(d, idx, 1, src.getText().toString()));
        split.setOnClickListener(v -> {
            if (busy()) return;
            List<Chapter> pieces = TextUtil.splitBySize(src.getText().toString(), s.chunkTokens);
            if (pieces.size() <= 1) {
                toast("这一块没有超过当前的 token 上限，不需要再切");
                return;
            }
            confirm("按上限重切", "本块会被切成 " + pieces.size() + " 块，切开后都需要重新翻译。", () -> {
                List<Chapter> next = new ArrayList<>(eng.chapters);
                int at = next.indexOf(ch);
                if (at < 0) return;
                next.remove(at);
                next.addAll(at, pieces);
                eng.replaceChapters(next);
                eng.log("✂️ 已把第 " + (at + 1) + " 块切成 " + pieces.size() + " 块");
                d.dismiss();
            });
        });
        retry.setOnClickListener(v -> {
            if (busy() || !checkReady()) return;
            ch.source = src.getText().toString();
            ch.resetTranslation();
            d.dismiss();
            List<Chapter> one = new ArrayList<>();
            one.add(ch);
            eng.start(this, one, "重翻第" + (idx + 1) + "块");
        });
        del.setOnClickListener(v -> {
            if (busy()) return;
            confirm("删除本块", "确定删除第 " + (idx + 1) + " 块？原文和译文都会丢失。", () -> {
                List<Chapter> next = new ArrayList<>(eng.chapters);
                next.remove(ch);
                eng.replaceChapters(next);
                d.dismiss();
            });
        });
        d.show();
    }

    private void mergeInto(AlertDialog d, int idx, int dir, String curSrc) {
        if (busy()) return;
        List<Chapter> l = eng.chapters;
        int ti = idx + dir;
        if (ti < 0 || ti >= l.size()) return;
        Chapter cur = l.get(idx);
        Chapter target = l.get(ti);
        confirm("合并分块", "把第 " + (idx + 1) + " 块并入" + (dir < 0 ? "上" : "下") + "一块（第 " + (ti + 1) + " 块）？\n\n"
                + "合并后本块会被删除，合并出来的块需要重新翻译。", () -> {
            target.source = dir < 0 ? target.source + "\n\n" + curSrc : curSrc + "\n\n" + target.source;
            target.resetTranslation();
            List<Chapter> next = new ArrayList<>(eng.chapters);
            next.remove(cur);
            eng.replaceChapters(next);
            eng.log("🔗 已合并为第 " + (target.index + 1) + " 块（" + target.source.length() + " 字），需重新翻译");
            d.dismiss();
        });
    }

    // ======================================================
    // 接口页
    // ======================================================

    private Spinner spinner(String[] names, int sel, AdapterView.OnItemSelectedListener l) {
        Spinner sp = new Spinner(this);
        ArrayAdapter<String> a = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, names);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sp.setAdapter(a);
        sp.setSelection(Math.max(0, sel), false);
        sp.setBackground(Ui.roundStroke(Ui.FIELD, Ui.BORDER, 8));
        sp.setPadding(Ui.dp(4), Ui.dp(6), Ui.dp(4), Ui.dp(6));
        sp.setOnItemSelectedListener(l);
        return sp;
    }

    private abstract static class OnPick implements AdapterView.OnItemSelectedListener {
        abstract void pick(int pos);

        @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { pick(pos); }
        @Override public void onNothingSelected(AdapterView<?> p) {}
    }

    private static int indexOf(String[] arr, String v) {
        for (int i = 0; i < arr.length; i++) if (arr[i].equals(v)) return i;
        return 0;
    }

    private String endpointHint() {
        if (Settings.P_GEMINI.equals(s.apiProvider)) return "留空 = https://generativelanguage.googleapis.com/v1beta";
        if (Settings.P_ANTHROPIC.equals(s.apiProvider)) return "留空 = https://api.anthropic.com";
        return "如 https://api.deepseek.com/v1 ，留空 = OpenAI 官方";
    }

    private View buildApiPage() {
        LinearLayout page = Ui.col(this);

        LinearLayout c1 = Ui.card(this, "🔌 接口");
        endpointEdit = Ui.edit(this, endpointHint(), false);
        endpointEdit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        c1.addView(Ui.field(this, "接口类型", spinner(PROVIDER_NAMES, indexOf(PROVIDERS, s.apiProvider), new OnPick() {
            @Override void pick(int pos) {
                if (PROVIDERS[pos].equals(s.apiProvider)) return;
                s.apiProvider = PROVIDERS[pos];
                endpointEdit.setHint(endpointHint());
                eng.saveSoon();
                refreshTask();
            }
        })));
        endpointEdit.setText(s.apiEndpoint);
        Ui.onText(endpointEdit, v -> { s.apiEndpoint = v.trim(); eng.saveSoon(); });
        c1.addView(Ui.field(this, "接口地址", endpointEdit));

        EditText key = Ui.edit(this, "sk-…", false);
        key.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        key.setText(s.apiKey);
        Ui.onText(key, v -> { s.apiKey = v.trim(); eng.saveSoon(); });
        LinearLayout keyRow = Ui.row(this);
        keyRow.addView(key, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button eye = Ui.small(this, "显示");
        eye.setOnClickListener(v -> {
            boolean hidden = (key.getInputType() & InputType.TYPE_TEXT_VARIATION_PASSWORD) == InputType.TYPE_TEXT_VARIATION_PASSWORD;
            key.setInputType(InputType.TYPE_CLASS_TEXT | (hidden ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD : InputType.TYPE_TEXT_VARIATION_PASSWORD));
            key.setSelection(key.getText().length());
            eye.setText(hidden ? "隐藏" : "显示");
        });
        LinearLayout.LayoutParams elp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        elp.leftMargin = Ui.dp(6);
        keyRow.addView(eye, elp);
        c1.addView(Ui.field(this, "API Key（只存在本机）", keyRow));

        modelEdit = Ui.edit(this, "模型名，如 deepseek-chat / gemini-2.5-flash", false);
        modelEdit.setText(s.apiModel);
        Ui.onText(modelEdit, v -> { s.apiModel = v.trim(); eng.saveSoon(); refreshTask(); });
        c1.addView(Ui.field(this, "模型", modelEdit));

        Button fetch = Ui.small(this, "🔄 拉取模型");
        Button test = Ui.button(this, "⚡ 快速测试", Ui.ACCENT);
        fetch.setOnClickListener(v -> fetchModels(fetch));
        test.setOnClickListener(v -> quickTest(test));
        c1.addView(Ui.buttonRow(this, fetch, test));
        modelStatus = Ui.text(this, "", 12, Ui.SUB);
        modelStatus.setPadding(0, Ui.dp(8), 0, 0);
        c1.addView(modelStatus);
        c1.addView(Ui.hint(this, "拉取模型会请求接口的模型列表；快速测试用当前配置发一条最短的请求，验证地址、Key、模型这条链路通不通。"));
        page.addView(c1);

        LinearLayout c2 = Ui.card(this, "🎛️ 参数");
        EditText temp = Ui.number(this, "0.7", true);
        temp.setText(String.valueOf(s.temperature));
        Ui.onText(temp, v -> { s.temperature = Math.max(0, Math.min(2, Ui.parseDouble(v, 0.7))); eng.saveSoon(); });
        EditText maxTk = Ui.number(this, "留空=默认", false);
        maxTk.setText(s.maxTokens > 0 ? String.valueOf(s.maxTokens) : "");
        Ui.onText(maxTk, v -> { s.maxTokens = Math.max(0, Ui.parseInt(v, 0)); eng.saveSoon(); });
        c2.addView(Ui.pair(this, Ui.field(this, "温度", temp), Ui.field(this, "最大输出 token", maxTk)));
        EditText timeout = Ui.number(this, "120", false);
        timeout.setText(String.valueOf(s.apiTimeout));
        Ui.onText(timeout, v -> { s.apiTimeout = Math.max(10, Ui.parseInt(v, 120)); eng.saveSoon(); });
        EditText retries = Ui.number(this, "3", false);
        retries.setText(String.valueOf(s.maxRetries));
        Ui.onText(retries, v -> { s.maxRetries = Math.max(0, Math.min(10, Ui.parseInt(v, 3))); eng.saveSoon(); });
        c2.addView(Ui.pair(this, Ui.field(this, "无响应超时（秒）", timeout), Ui.field(this, "失败重试次数", retries)));
        c2.addView(Ui.hint(this, "无响应超时：连续这么多秒没收到新内容就判定卡死并重试。\n最大输出：译文和原文差不多长，要大于「每块 token 上限」，否则会被截断。"));
        page.addView(c2);

        LinearLayout c3 = Ui.card(this, "🔋 后台运行");
        c3.addView(Ui.hint(this, "翻译时会在通知栏常驻，切到后台、锁屏也继续跑。\n部分国产系统还会额外限制后台，建议点下面的按钮把本应用设为「不受电池优化限制」。"));
        Button battery = Ui.small(this, "允许后台运行（关闭电池优化）");
        battery.setOnClickListener(v -> requestIgnoreBattery());
        c3.addView(Ui.buttonRow(this, battery));
        page.addView(c3);

        LinearLayout c4 = Ui.card(this, "⚙️ 配置备份");
        c4.addView(Ui.hint(this, "配置 = 接口、提示词、正则、术语表等设置，不含小说内容。换手机或重装时用。和网页版的配置文件互通。"));
        Button exp = Ui.small(this, "⚙️ 导出配置");
        Button imp = Ui.small(this, "📂 导入配置");
        exp.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setTitle("导出配置")
                .setMessage("配置里要包含 API Key 吗？\n\n包含：换设备直接能用，但文件别外发。\n不含：适合分享给别人。")
                .setPositiveButton("包含 Key", (d, w) -> { pendingConfigWithKey = true; createDoc(REQ_CONFIG_OUT, "application/json", "小说翻译配置(含Key).json"); })
                .setNegativeButton("不含 Key", (d, w) -> { pendingConfigWithKey = false; createDoc(REQ_CONFIG_OUT, "application/json", "小说翻译配置.json"); })
                .show());
        imp.setOnClickListener(v -> openDoc(REQ_CONFIG_IN));
        c4.addView(Ui.buttonRow(this, exp, imp));
        page.addView(c4);
        return page;
    }

    private void setModelStatus(String text, int color) {
        modelStatus.setText(text);
        modelStatus.setTextColor(color);
    }

    private void fetchModels(Button btn) {
        btn.setEnabled(false);
        setModelStatus("正在拉取模型列表…", Ui.ORANGE);
        new Thread(() -> {
            try {
                List<String> models = ApiClient.fetchModels(s);
                runOnUiThread(() -> {
                    btn.setEnabled(true);
                    if (models.isEmpty()) {
                        setModelStatus("❌ 接口没返回任何模型，手动填模型名即可", Ui.RED);
                        return;
                    }
                    Collections.sort(models);
                    setModelStatus("✅ 拉取到 " + models.size() + " 个模型", Ui.GREEN);
                    String[] arr = models.toArray(new String[0]);
                    new AlertDialog.Builder(this)
                            .setTitle("选择模型（共 " + arr.length + " 个）")
                            .setItems(arr, (d, w) -> {
                                modelEdit.setText(arr[w]);
                                setModelStatus("已选择模型：" + arr[w], Ui.GREEN);
                            })
                            .setNegativeButton("取消", null)
                            .show();
                });
            } catch (Exception e) {
                String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                runOnUiThread(() -> {
                    btn.setEnabled(true);
                    setModelStatus("❌ " + m, Ui.RED);
                });
            }
        }).start();
    }

    private void quickTest(Button btn) {
        if (TextUtil.isBlank(s.apiModel) && !Settings.P_OPENAI.equals(s.apiProvider)) {
            setModelStatus("❌ 请先填写或拉取模型", Ui.RED);
            return;
        }
        btn.setEnabled(false);
        setModelStatus("正在测试连接…", Ui.ORANGE);
        new Thread(() -> {
            long t0 = SystemClock.elapsedRealtime();
            try {
                ApiClient.Result r = ApiClient.chat(s, "回复「OK」两个字即可。", false, 256, null, null);
                long ms = SystemClock.elapsedRealtime() - t0;
                String reply = r.text == null ? "" : r.text.trim();
                runOnUiThread(() -> {
                    btn.setEnabled(true);
                    if (reply.isEmpty()) {
                        setModelStatus("⚠️ 接口通了（" + ms + "ms），但回复为空" + (r.finishReason.isEmpty() ? "" : "（" + r.finishReason + "）")
                                + "。思考型模型可能把测试用的输出额度都花在思考上了，正式翻译一般没问题。", Ui.ORANGE);
                    } else {
                        setModelStatus("✅ 连接正常（" + ms + "ms）· 回复：" + TextUtil.head(reply, 40), Ui.GREEN);
                    }
                });
            } catch (Exception e) {
                String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                runOnUiThread(() -> {
                    btn.setEnabled(true);
                    setModelStatus("❌ " + m, Ui.RED);
                });
            }
        }).start();
    }

    private void requestIgnoreBattery() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) {
                toast("已经是不受限制状态了");
                return;
            }
            Intent it = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            it.setData(Uri.parse("package:" + getPackageName()));
            startActivity(it);
        } catch (Exception e) {
            try {
                startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception e2) {
                toast("这台手机不支持直接跳转，请到系统设置 → 电池 里手动设置");
            }
        }
    }

    // ======================================================
    // 翻译设置页
    // ======================================================

    private void updateBlockHint() {
        blockHint.setText(s.blockAsChapter
                ? "已开启：提示词会要求 AI 把每一块整个当成一章，块内不再分章，也不会自行加编号。适合原文没有规范章节标记的情况。"
                : "未开启：提示词会说明这块只是按长度切出来的，要求 AI 沿用原文自身的话数/章数，不得合并或拆分。原文章节标题照常翻译并单独成行，导出时再用正则划分目录。");
    }

    private View buildSettingsPage() {
        LinearLayout page = Ui.col(this);

        LinearLayout c1 = Ui.card(this, "✍️ 翻译要求（提示词）");
        EditText prompt = Ui.edit(this, "翻译要求", true);
        prompt.setMinLines(7);
        prompt.setMaxLines(14);
        prompt.setText(s.customPrompt);
        Ui.nestedScroll(prompt);
        Ui.onText(prompt, v -> { s.customPrompt = v; eng.saveSoon(); });
        c1.addView(prompt);
        c1.addView(Ui.hint(this, "这里写目标语言和翻译风格。术语表、上下文衔接、章节纪律和输出格式会自动拼在后面，不用自己写。"));
        Button resetPrompt = Ui.small(this, "恢复默认提示词");
        resetPrompt.setOnClickListener(v -> confirm("恢复默认提示词", "当前的翻译要求会被替换成默认内容。", () -> prompt.setText(Settings.DEFAULT_PROMPT)));
        c1.addView(Ui.buttonRow(this, resetPrompt));
        page.addView(c1);

        LinearLayout c2 = Ui.card(this, "✂️ 分块");
        EditText chunk = Ui.number(this, "4000", false);
        chunk.setText(String.valueOf(s.chunkTokens));
        Ui.onText(chunk, v -> { s.chunkTokens = Math.max(200, Ui.parseInt(v, 4000)); eng.saveSoon(); });
        c2.addView(Ui.field(this, "每块 token 上限", chunk));
        c2.addView(Ui.hint(this, "正文一律按这个上限切块。改了之后不会自动重切，要回「任务」页点「重新分块」才生效。"));
        Switch bac = Ui.toggle(this, "强制记忆块为章节", s.blockAsChapter);
        blockHint = Ui.hint(this, "");
        bac.setOnCheckedChangeListener((b, on) -> {
            s.blockAsChapter = on;
            updateBlockHint();
            eng.saveSoon();
        });
        updateBlockHint();
        c2.addView(bac);
        c2.addView(blockHint);
        page.addView(c2);

        LinearLayout c3 = Ui.card(this, "⚡ 并发与衔接");
        EditText conc = Ui.number(this, "3", false);
        conc.setText(String.valueOf(s.concurrency));
        Ui.onText(conc, v -> { s.concurrency = Math.max(1, Math.min(20, Ui.parseInt(v, 3))); eng.saveSoon(); });
        EditText warm = Ui.number(this, "2", false);
        warm.setText(String.valueOf(s.warmupChapters));
        Ui.onText(warm, v -> { s.warmupChapters = Math.max(0, Math.min(50, Ui.parseInt(v, 2))); eng.saveSoon(); });
        c3.addView(Ui.pair(this, Ui.field(this, "并发数", conc), Ui.field(this, "预热块数", warm)));
        EditText prev = Ui.number(this, "300", false);
        prev.setText(String.valueOf(s.contextPrevChars));
        Ui.onText(prev, v -> { s.contextPrevChars = Math.max(0, Math.min(5000, Ui.parseInt(v, 300))); eng.saveSoon(); });
        EditText next = Ui.number(this, "200", false);
        next.setText(String.valueOf(s.contextNextChars));
        Ui.onText(next, v -> { s.contextNextChars = Math.max(0, Math.min(5000, Ui.parseInt(v, 200))); eng.saveSoon(); });
        c3.addView(Ui.pair(this, Ui.field(this, "衔接·上文字数", prev), Ui.field(this, "衔接·下文字数", next)));
        c3.addView(Ui.hint(this, "并发太高容易触发限流，反而更慢。\n预热：前几块串行跑，先把人名地名的译法定下来，后面并发时术语就统一了。\n衔接：把相邻块的一小段原文给 AI 参考，不会被翻译进结果。"));
        page.addView(c3);

        LinearLayout c4 = Ui.card(this, "📗 术语表");
        Switch ge = Ui.toggle(this, "启用术语表", s.glossaryEnabled);
        ge.setOnCheckedChangeListener((b, on) -> { s.glossaryEnabled = on; eng.saveSoon(); });
        Switch ag = Ui.toggle(this, "让 AI 自动补充新术语", s.autoGlossary);
        ag.setOnCheckedChangeListener((b, on) -> { s.autoGlossary = on; eng.saveSoon(); });
        c4.addView(ge);
        c4.addView(ag);
        glossaryInfo = Ui.text(this, "", 13, Ui.SUB);
        glossaryInfo.setPadding(0, Ui.dp(6), 0, 0);
        c4.addView(glossaryInfo);
        c4.addView(Ui.hint(this, "每块只会带上原文里出现过的术语，不会把整张表都塞进请求。自动补充的术语只加新的，不覆盖你手填的。"));
        Button manage = Ui.small(this, "管理术语表");
        Button add = Ui.small(this, "➕ 添加术语");
        manage.setOnClickListener(v -> showGlossary());
        add.setOnClickListener(v -> editTerm(-1));
        c4.addView(Ui.buttonRow(this, manage, add));
        page.addView(c4);
        refreshGlossaryInfo();
        return page;
    }

    private void refreshGlossaryInfo() {
        if (glossaryInfo != null) glossaryInfo.setText("当前共 " + s.glossarySnapshot().size() + " 条术语");
    }

    private void showGlossary() {
        List<Settings.Term> terms = s.glossarySnapshot();
        if (terms.isEmpty()) {
            toast("术语表是空的");
            return;
        }
        String[] items = new String[terms.size()];
        for (int i = 0; i < terms.size(); i++) items[i] = terms.get(i).source + "  →  " + terms.get(i).target;
        new AlertDialog.Builder(this)
                .setTitle("术语表（" + terms.size() + " 条，点击编辑）")
                .setItems(items, (d, w) -> editTerm(w))
                .setNeutralButton("清空全部", (d, w) -> confirm("清空术语表", "确定删除全部 " + terms.size() + " 条术语？", () -> {
                    synchronized (s.glossary) {
                        s.glossary.clear();
                    }
                    eng.saveSoon();
                    refreshGlossaryInfo();
                }))
                .setNegativeButton("关闭", null)
                .show();
    }

    private void editTerm(int index) {
        Settings.Term t = null;
        synchronized (s.glossary) {
            if (index >= 0 && index < s.glossary.size()) t = s.glossary.get(index);
        }
        final Settings.Term term = t;
        LinearLayout box = Ui.col(this);
        box.setPadding(Ui.dp(18), Ui.dp(4), Ui.dp(18), 0);
        EditText src = Ui.edit(this, "原文，如 Alice", false);
        EditText dst = Ui.edit(this, "译文，如 爱丽丝", false);
        if (term != null) {
            src.setText(term.source);
            dst.setText(term.target);
        }
        box.addView(Ui.field(this, "原文", src));
        box.addView(Ui.field(this, "译文", dst));
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(term == null ? "添加术语" : "编辑术语")
                .setView(box)
                .setPositiveButton("保存", (d, w) -> {
                    String a = src.getText().toString().trim();
                    String z = dst.getText().toString().trim();
                    if (a.isEmpty() || z.isEmpty()) {
                        toast("原文和译文都要填");
                        return;
                    }
                    synchronized (s.glossary) {
                        if (term != null) {
                            term.source = a;
                            term.target = z;
                        } else {
                            s.glossary.add(new Settings.Term(a, z));
                        }
                    }
                    eng.saveSoon();
                    refreshGlossaryInfo();
                })
                .setNegativeButton("取消", null);
        if (term != null) {
            b.setNeutralButton("删除", (d, w) -> {
                synchronized (s.glossary) {
                    s.glossary.remove(term);
                }
                eng.saveSoon();
                refreshGlossaryInfo();
            });
        }
        b.show();
    }

    // ======================================================
    // 导出页
    // ======================================================

    private View buildExportPage() {
        LinearLayout page = Ui.col(this);

        LinearLayout c1 = Ui.card(this, "📚 书籍信息");
        EditText bt = Ui.edit(this, "留空 = 文件名（译）", false);
        bt.setText(s.bookTitle);
        Ui.onText(bt, v -> { s.bookTitle = v; eng.saveSoon(); });
        EditText ba = Ui.edit(this, "可留空", false);
        ba.setText(s.bookAuthor);
        Ui.onText(ba, v -> { s.bookAuthor = v; eng.saveSoon(); });
        c1.addView(Ui.pair(this, Ui.field(this, "书名", bt), Ui.field(this, "作者", ba)));
        c1.addView(Ui.field(this, "章节标题编号", spinner(TITLE_FORMAT_NAMES, indexOf(TITLE_FORMATS, s.txtTitleFormat), new OnPick() {
            @Override void pick(int pos) {
                s.txtTitleFormat = TITLE_FORMATS[pos];
                eng.saveSoon();
            }
        })));
        page.addView(c1);

        LinearLayout c2 = Ui.card(this, "🔍 章节正则（不参与切分，只用于导出目录）");
        regexEdit = Ui.edit(this, "章节正则", true);
        regexEdit.setTypeface(Typeface.MONOSPACE);
        regexEdit.setTextSize(12);
        regexEdit.setText(s.chapterRegex);
        Ui.onText(regexEdit, v -> { s.chapterRegex = v.trim(); eng.saveSoon(); });
        c2.addView(Ui.field(this, "组1 = 话数，组2 = 标题（可为空）", regexEdit));
        String[] presetNames = new String[TextUtil.REGEX_PRESETS.length + 1];
        presetNames[0] = "— 常用预设 —";
        for (int i = 0; i < TextUtil.REGEX_PRESETS.length; i++) presetNames[i + 1] = TextUtil.REGEX_PRESETS[i][0];
        final Spinner[] holder = new Spinner[1];
        holder[0] = spinner(presetNames, 0, new OnPick() {
            @Override void pick(int pos) {
                if (pos == 0) return;
                regexEdit.setText(TextUtil.REGEX_PRESETS[pos - 1][1]);
                testRegex(false);
                if (holder[0] != null) holder[0].setSelection(0, false);
            }
        });
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.topMargin = Ui.dp(6);
        c2.addView(holder[0], sp);
        Button reset = Ui.small(this, "🔄 恢复默认");
        Button testSrc = Ui.small(this, "🧪 测原文");
        Button testDst = Ui.button(this, "🧪 测译文", 0xFF1F7A4A);
        reset.setOnClickListener(v -> {
            regexEdit.setText(TextUtil.DEFAULT_CHAPTER_REGEX);
            testRegex(false);
        });
        testSrc.setOnClickListener(v -> testRegex(false));
        testDst.setOnClickListener(v -> testRegex(true));
        c2.addView(Ui.buttonRow(this, reset, testSrc, testDst));
        regexResult = Ui.text(this, "", 12, Ui.SUB);
        regexResult.setPadding(0, Ui.dp(8), 0, 0);
        c2.addView(regexResult);
        c2.addView(Ui.hint(this, "默认正则同时认「第X话」「第X章」「第X节」「第X回」，阿拉伯数字和中文数字都行。导出时沿用原文的单位字。\n原文和译文的章节写法可能不同（原文 Chapter 12、译文第12话），导出前点「测译文」看一眼。"));
        page.addView(c2);

        LinearLayout c3 = Ui.card(this, "📦 导出译文");
        Switch split = Ui.toggle(this, "导出时用正则重新划分章节", s.exportSplitByRegex);
        split.setOnCheckedChangeListener((b, on) -> { s.exportSplitByRegex = on; eng.saveSoon(); });
        c3.addView(split);
        c3.addView(Ui.hint(this, "正文是按长度切的，块边界不等于章节边界。勾选后会把译文拼回整篇，用正则重新划出真正的章节做目录；匹配不到就退回「一块一节」。"));
        Button preview = Ui.small(this, "🔎 预览导出目录");
        preview.setOnClickListener(v -> previewExport());
        c3.addView(Ui.buttonRow(this, preview));
        exportPreview = Ui.text(this, "", 12, Ui.SUB);
        exportPreview.setPadding(0, Ui.dp(8), 0, 0);
        c3.addView(exportPreview);
        Button epub = Ui.button(this, "📚 导出 EPUB", Ui.ACCENT);
        Button txt = Ui.small(this, "📄 导出 TXT");
        epub.setOnClickListener(v -> startExport(true));
        txt.setOnClickListener(v -> startExport(false));
        c3.addView(Ui.buttonRow(this, epub, txt));
        page.addView(c3);

        LinearLayout c4 = Ui.card(this, "💾 任务备份");
        c4.addView(Ui.hint(this, "任务 = 原文 + 译文 + 术语表，「这本书翻到哪了」。导入后可以接着翻。和网页版的任务文件互通。\n应用内的进度会自动保存，这个用于换设备或额外备份。"));
        Button te = Ui.small(this, "📤 导出任务");
        Button ti = Ui.small(this, "📥 导入任务");
        te.setOnClickListener(v -> {
            if (eng.chapters.isEmpty()) {
                toast("还没有任务");
                return;
            }
            String base = TextUtil.isBlank(eng.fileName) ? "小说" : eng.fileName.replaceAll("\\.[^.]*$", "");
            createDoc(REQ_TASK_OUT, "application/json", "翻译任务-" + base + ".json");
        });
        ti.setOnClickListener(v -> {
            if (busy()) return;
            openDoc(REQ_TASK_IN);
        });
        c4.addView(Ui.buttonRow(this, te, ti));
        page.addView(c4);
        return page;
    }

    private void testRegex(boolean translated) {
        List<Chapter> l = eng.chapters;
        if (l.isEmpty()) {
            regexResult.setText("⚠️ 请先导入 TXT 再测试");
            regexResult.setTextColor(Ui.ORANGE);
            return;
        }
        String sample;
        String label;
        if (translated) {
            StringBuilder sb = new StringBuilder();
            int n = 0;
            for (Chapter c : l) {
                if (!c.isDone()) continue;
                if (sb.length() > 0) sb.append("\n\n");
                sb.append(c.translated.trim());
                n++;
            }
            if (n == 0) {
                regexResult.setText("⚠️ 还没有已翻译的内容，先翻几块再测译文");
                regexResult.setTextColor(Ui.ORANGE);
                return;
            }
            sample = sb.toString();
            label = "译文（" + n + "/" + l.size() + " 块已完成）";
        } else {
            sample = TextUtil.joinSources(l);
            label = "原文";
        }
        try {
            int total = TextUtil.countMarks(sample, s.chapterRegex);
            if (total == 0) {
                regexResult.setText("❌ 在" + label + "里一个章节都没匹配到。"
                        + (translated ? "\n译文的章节写法可能和原文不同，照译文改正则。导出时会自动退回「一块一节」。" : "\n请换个预设或检查正则。"));
                regexResult.setTextColor(Ui.RED);
                return;
            }
            List<TextUtil.Mark> marks = TextUtil.findMarks(sample, s.chapterRegex, 10);
            StringBuilder out = new StringBuilder("✅ 在" + label + "里匹配到 " + total + " 个章节"
                    + (translated ? "，导出后目录就是这 " + total + " 条" : "") + "，前 " + marks.size() + " 条：");
            for (TextUtil.Mark m : marks) out.append("\n　").append(m.num).append(m.unit).append(" · ").append(m.title);
            if (total > marks.size()) out.append("\n　…");
            regexResult.setText(out.toString());
            regexResult.setTextColor(Ui.GREEN);
        } catch (RuntimeException e) {
            regexResult.setText("❌ 正则语法错误：" + e.getMessage());
            regexResult.setTextColor(Ui.RED);
        }
    }

    private void previewExport() {
        Exporter.Units u = Exporter.build(s, eng.chapters);
        if (u.list.isEmpty()) {
            exportPreview.setText("⚠️ 还没有已完成的内容");
            exportPreview.setTextColor(Ui.ORANGE);
            return;
        }
        StringBuilder sb = new StringBuilder("regex".equals(u.mode)
                ? "✅ " + u.blockCount + " 块译文 → 正则划出 " + u.list.size() + " 章"
                : "⚠️ 正则没匹配到章节，将按块导出 " + u.list.size() + " 节");
        sb.append("，目录前 ").append(Math.min(10, u.list.size())).append(" 条：");
        for (int i = 0; i < Math.min(10, u.list.size()); i++) sb.append("\n　").append(Exporter.title(s, u.list.get(i), i));
        if (u.list.size() > 10) sb.append("\n　…");
        exportPreview.setText(sb.toString());
        exportPreview.setTextColor("regex".equals(u.mode) ? Ui.GREEN : Ui.ORANGE);
    }

    private void startExport(boolean epub) {
        if (eng.countDone() == 0) {
            toast("还没有已完成的内容可以导出");
            return;
        }
        String title = Exporter.bookTitle(s, eng.fileName).replaceAll("[\\\\/:*?\"<>|]", "_");
        if (epub) createDoc(REQ_EPUB_OUT, "application/epub+zip", title + ".epub");
        else createDoc(REQ_TXT_OUT, "text/plain", title + ".txt");
    }

    private void doExport(Uri uri, boolean epub) {
        final Exporter.Units u = Exporter.build(s, new ArrayList<>(eng.chapters));
        background(epub ? "正在导出 EPUB" : "正在导出 TXT", () -> {
            try (OutputStream os = writeUri(uri)) {
                if (epub) Exporter.writeEpub(s, eng.fileName, u, os);
                else Exporter.writeTxt(s, eng.fileName, u, os);
            }
            String msg = (epub ? "📚 已导出 EPUB：" : "📄 已导出 TXT：") + u.blockCount + " 块译文，"
                    + ("regex".equals(u.mode) ? "按正则划出 " + u.list.size() + " 章" : "按块导出 " + u.list.size() + " 节");
            eng.log(msg);
            runOnUiThread(() -> toastLong(msg));
        });
    }

    private void doExportTask(Uri uri) {
        final List<Chapter> snapshot = new ArrayList<>(eng.chapters);
        background("正在导出任务", () -> {
            try (OutputStream os = writeUri(uri)) {
                Store.writeTask(os, s, eng.fileName, snapshot);
            }
            runOnUiThread(() -> toast("已导出任务：" + snapshot.size() + " 块"));
        });
    }

    private void doExportConfig(Uri uri) {
        final boolean withKey = pendingConfigWithKey;
        background("正在导出配置", () -> {
            try (OutputStream os = writeUri(uri)) {
                Store.writeConfig(os, s, withKey);
            }
            runOnUiThread(() -> toast(withKey ? "已导出配置（含 API Key）" : "已导出配置（不含 API Key）"));
        });
    }

    private void onConfigPicked(Uri uri) {
        background("正在读取配置", () -> {
            JSONObject o = new JSONObject(new String(readUri(uri), "UTF-8"));
            String type = o.optString("type", "");
            if (Store.TYPE_TASK.equals(type) || (type.isEmpty() && o.has("chapters"))) {
                runOnUiThread(() -> info("选错文件了", "这是「翻译任务」文件，请到「导出」页用「导入任务」。"));
                return;
            }
            Settings probe = new Settings();
            int n = Store.readSettings(o, probe, true);
            if (n == 0) {
                runOnUiThread(() -> info("导入失败", "这个 JSON 里没有任何可识别的配置项。"));
                return;
            }
            boolean hasKey = !o.optString("apiKey", "").isEmpty();
            runOnUiThread(() -> confirm("导入配置",
                    "将导入 " + n + " 项配置" + (hasKey ? "（含 API Key）" : "（不含 API Key，需要自己填）") + "。\n\n"
                            + "当前设置会被覆盖，已导入的小说和翻译进度不受影响。",
                    () -> {
                        Store.readSettings(o, s, true);
                        eng.saveSoon();
                        rebuild();
                        toastLong("配置已导入" + (hasKey ? "" : "，记得填 API Key"));
                    }));
        });
    }

    private void onTaskPicked(Uri uri) {
        background("正在读取任务", () -> {
            JSONObject o = new JSONObject(new String(readUri(uri), "UTF-8"));
            String type = o.optString("type", "");
            if (Store.TYPE_CONFIG.equals(type)) {
                runOnUiThread(() -> info("选错文件了", "这是「配置」文件，请到「接口」页用「导入配置」。"));
                return;
            }
            if (o.optJSONArray("chapters") == null) {
                runOnUiThread(() -> info("导入失败", "这个 JSON 里没有 chapters 数组，不是翻译任务文件。"));
                return;
            }
            List<Chapter> loaded = Store.readChapters(o.optJSONArray("chapters"));
            int done = 0;
            for (Chapter c : loaded) if (c.isDone()) done++;
            final int doneCount = done;
            runOnUiThread(() -> confirm("导入任务",
                    "任务里有 " + loaded.size() + " 块，已完成 " + doneCount + " 块。\n\n导入后会替换当前任务。",
                    () -> {
                        // 网页版把部分设置平铺在任务里，也可能嵌在 settings 下，两种都认
                        JSONObject nested = o.optJSONObject("settings");
                        if (nested != null) Store.readSettings(nested, s, false);
                        Store.readSettings(o, s, false);
                        TextUtil.renumber(loaded);
                        eng.setChapters(loaded, o.optString("fileName", ""));
                        selected.clear();
                        rebuild();
                        eng.log("📥 已导入任务：" + loaded.size() + " 块，已完成 " + doneCount + " 块");
                        switchTab(0);
                    }));
        });
    }

    // ======================================================
    // 帮助
    // ======================================================

    private void showHelp() {
        info("使用说明",
                "【流程】接口页配好模型并快速测试 → 任务页导入 TXT → 开始翻译 → 导出页导出 EPUB/TXT。\n\n"
                        + "【分块】正文一律按「每块 token 上限」切。改了上限要点「重新分块」才生效，已有译文会作废。\n\n"
                        + "【强制记忆块为章节】开：每块当一章；关：沿用原文自己的话数/章数，导出时用正则重新分章。\n\n"
                        + "【后台】翻译时通知栏常驻，切后台、锁屏继续跑。国产系统建议在接口页关闭电池优化。\n\n"
                        + "【分块列表】点一块看原文译文，可编辑、复制、合并、重切、单独重翻、删除。"
                        + "「起始块」决定从哪开始跑；「多选」可全选、反选、选失败块，批量重翻或删除。\n\n"
                        + "【导入更新章节】小说更新后追加新章节，已翻译的块不动。\n\n"
                        + "【存档】进度自动保存在本机。任务和配置文件和网页版互通。");
    }
}
