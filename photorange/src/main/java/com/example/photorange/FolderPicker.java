package com.example.photorange;

import android.app.AlertDialog;
import android.content.Context;
import android.os.Environment;
import android.text.InputType;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** 简单的文件夹选择框：点进子文件夹、返回上一级、新建文件夹、选定当前文件夹。 */
final class FolderPicker {
    interface Callback {
        void onPicked(File dir);
    }

    private final Context ctx;
    private final Callback cb;
    private final List<File> roots;
    /** null = 在「存储设备列表」那一层 */
    private File current;
    private final List<File> entries = new ArrayList<>();
    private final ArrayAdapter<String> adapter;
    private AlertDialog dialog;

    private FolderPicker(Context ctx, File start, Callback cb) {
        this.ctx = ctx;
        this.cb = cb;
        this.roots = storageRoots(ctx);
        this.adapter = new ArrayAdapter<>(ctx, android.R.layout.simple_list_item_1, new ArrayList<>());
        File s = start;
        while (s != null && !s.isDirectory()) s = s.getParentFile();
        this.current = s != null && underSomeRoot(s) ? s : roots.get(0);
    }

    static void show(Context ctx, String title, File start, Callback cb) {
        new FolderPicker(ctx, start, cb).open(title);
    }

    private void open(String title) {
        ListView lv = new ListView(ctx);
        lv.setAdapter(adapter);
        lv.setOnItemClickListener((p, v, pos, id) -> {
            File f = entries.get(pos);
            if (f == null) {
                current = isRoot(current) ? null : current.getParentFile();
            } else {
                current = f;
            }
            refresh();
        });
        dialog = new AlertDialog.Builder(ctx)
                .setTitle(title)
                .setView(lv)
                .setPositiveButton("选这个文件夹", null)
                .setNeutralButton("新建文件夹", null)
                .setNegativeButton("取消", null)
                .create();
        dialog.setOnShowListener(d -> {
            // 自己接管按钮，避免点了就关
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                if (current == null) {
                    Toast.makeText(ctx, "先点进一个存储设备", Toast.LENGTH_SHORT).show();
                    return;
                }
                dialog.dismiss();
                cb.onPicked(current);
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> askNewFolder());
        });
        refresh();
        dialog.show();
    }

    private void refresh() {
        entries.clear();
        List<String> labels = new ArrayList<>();
        if (current == null) {
            for (int i = 0; i < roots.size(); i++) {
                entries.add(roots.get(i));
                labels.add(i == 0 ? "📱 内部存储" : "💾 " + roots.get(i).getPath());
            }
        } else {
            entries.add(null);
            labels.add("⬆  上一级");
            File[] subs = current.listFiles(File::isDirectory);
            if (subs != null) {
                Arrays.sort(subs, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
                for (File f : subs) {
                    if (f.getName().startsWith(".")) continue;
                    entries.add(f);
                    labels.add("📁 " + f.getName());
                }
            }
        }
        adapter.clear();
        adapter.addAll(labels);
        adapter.notifyDataSetChanged();
        if (dialog != null) dialog.setTitle(current == null ? "选择存储设备" : pretty(current));
    }

    private void askNewFolder() {
        if (current == null) return;
        EditText et = new EditText(ctx);
        et.setInputType(InputType.TYPE_CLASS_TEXT);
        et.setHint("文件夹名");
        new AlertDialog.Builder(ctx)
                .setTitle("在 " + current.getName() + " 里新建")
                .setView(et)
                .setPositiveButton("建立", (d, w) -> {
                    String name = et.getText().toString().trim();
                    if (name.isEmpty() || name.contains("/")) {
                        Toast.makeText(ctx, "名字不能为空或带 /", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    File f = new File(current, name);
                    if (f.isDirectory() || f.mkdirs()) {
                        current = f;
                        refresh();
                    } else {
                        Toast.makeText(ctx, "建立失败（检查权限）", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private boolean isRoot(File f) {
        for (File r : roots) if (r.equals(f)) return true;
        return false;
    }

    private boolean underSomeRoot(File f) {
        String p = f.getAbsolutePath();
        for (File r : roots) {
            String rp = r.getAbsolutePath();
            if (p.equals(rp) || p.startsWith(rp + "/")) return true;
        }
        return false;
    }

    /** /storage/emulated/0/DCIM/Camera → 内部存储/DCIM/Camera */
    static String pretty(File f) {
        String p = f.getAbsolutePath();
        String internal = Environment.getExternalStorageDirectory().getAbsolutePath();
        if (p.equals(internal)) return "内部存储";
        if (p.startsWith(internal + "/")) return "内部存储" + p.substring(internal.length());
        return p;
    }

    /** 内部存储 + 插着的 SD 卡/U 盘根目录 */
    static List<File> storageRoots(Context ctx) {
        List<File> out = new ArrayList<>();
        out.add(Environment.getExternalStorageDirectory());
        File[] dirs = ctx.getExternalFilesDirs(null);
        if (dirs != null) {
            for (int i = 1; i < dirs.length; i++) {
                File d = dirs[i];
                if (d == null) continue;
                String p = d.getAbsolutePath();
                int idx = p.indexOf("/Android/data/");
                if (idx > 0) out.add(new File(p.substring(0, idx)));
            }
        }
        return out;
    }
}
