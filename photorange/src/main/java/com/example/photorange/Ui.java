package com.example.photorange;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;

/**
 * 配色和小部件。
 * 取的是「蓝晒」老照片的感觉：普鲁士蓝的底、相纸白的字，只有「选中的那段时间」和主按钮用日光黄。
 */
final class Ui {
    private Ui() {
    }

    /** 底色：普鲁士蓝 */
    static final int BG = 0xFF0F274A;
    /** 时间轴那块面板 */
    static final int PANEL = 0xFF173963;
    /** 面板上的小药丸、未选中的开关轨道 */
    static final int PILL = 0xFF234C80;
    /** 分隔线 */
    static final int LINE = 0xFF27477A;
    /** 相纸白：正文 */
    static final int PAPER = 0xFFF5F2E9;
    /** 次要文字 */
    static final int MIST = 0xFFA9BEDB;
    /** 没选中的月份柱 */
    static final int BAR = 0xFF6C91C6;
    /** 日光黄：选中范围、主按钮 */
    static final int SUN = 0xFFFFC857;
    /** 出错 */
    static final int CORAL = 0xFFFF9485;

    static final Typeface SERIF = Typeface.create("serif", Typeface.NORMAL);
    static final Typeface SERIF_BOLD = Typeface.create("serif", Typeface.BOLD);
    static final Typeface MEDIUM = Typeface.create("sans-serif-medium", Typeface.NORMAL);

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static GradientDrawable round(int color, float radiusPx) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radiusPx);
        return g;
    }

    static GradientDrawable outline(int strokeColor, int strokePx, float radiusPx) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(0x00000000);
        g.setStroke(strokePx, strokeColor);
        g.setCornerRadius(radiusPx);
        return g;
    }

    /** 给背景加上按下去的水波 */
    static Drawable pressable(Drawable content, float radiusPx, boolean onLight) {
        return new RippleDrawable(ColorStateList.valueOf(onLight ? 0x33000000 : 0x33FFFFFF),
                content, round(0xFFFFFFFF, radiusPx));
    }

    static TextView text(Context c, CharSequence s, float sp, int color) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    /** 主按钮：日光黄实心 */
    static TextView primaryButton(Context c, String s) {
        TextView t = text(c, s, 17, BG);
        t.setTypeface(MEDIUM);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(c, 56));
        t.setPadding(dp(c, 20), 0, dp(c, 20), 0);
        t.setBackground(pressable(round(SUN, dp(c, 28)), dp(c, 28), true));
        t.setClickable(true);
        return t;
    }

    /** 次按钮：相纸白描边 */
    static TextView outlineButton(Context c, String s) {
        TextView t = text(c, s, 16, PAPER);
        t.setTypeface(MEDIUM);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(c, 52));
        t.setPadding(dp(c, 20), 0, dp(c, 20), 0);
        t.setBackground(pressable(outline(PAPER, dp(c, 1.5f), dp(c, 26)), dp(c, 26), false));
        t.setClickable(true);
        return t;
    }

    /** 小药丸：全部 / 今年 / 去年 */
    static TextView chip(Context c, String s) {
        TextView t = text(c, s, 14, PAPER);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(c, 36));
        t.setPadding(dp(c, 16), 0, dp(c, 16), 0);
        t.setBackground(pressable(round(PILL, dp(c, 18)), dp(c, 18), false));
        t.setClickable(true);
        return t;
    }

    /** 文字链接：更换、重新扫描 */
    static TextView link(Context c, String s) {
        TextView t = text(c, s, 14, SUN);
        t.setTypeface(MEDIUM);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(c, 40));
        t.setPadding(dp(c, 10), 0, dp(c, 10), 0);
        t.setBackground(pressable(round(0x00000000, dp(c, 20)), dp(c, 20), false));
        t.setClickable(true);
        return t;
    }

    static void setEnabled(View v, boolean on) {
        v.setEnabled(on);
        v.setAlpha(on ? 1f : 0.38f);
    }

    static View divider(Context c) {
        View v = new View(c);
        v.setBackgroundColor(LINE);
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(c, 1))));
        return v;
    }

    /** 一行开关：左边文字，右边开关，点整行都能切换 */
    static Switch switchRow(Context c, LinearLayout parent, String label, boolean on) {
        LinearLayout row = new LinearLayout(c);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(c, 52));
        TextView t = text(c, label, 15, PAPER);
        row.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        final Switch sw = new Switch(c);
        sw.setChecked(on);
        int[][] states = {{android.R.attr.state_checked}, {}};
        sw.setThumbTintList(new ColorStateList(states, new int[]{SUN, 0xFFD3DEEE}));
        sw.setTrackTintList(new ColorStateList(states, new int[]{0x80FFC857, 0xFF3A5C91}));
        row.addView(sw);
        row.setOnClickListener(v -> sw.toggle());
        parent.addView(row);
        return sw;
    }
}
