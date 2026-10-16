package com.example.noveltranslate;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;

/** 纯代码搭界面的小工具和配色。没有 XML 布局，改样式只改这里。 */
final class Ui {
    private Ui() {}

    static final int BG = 0xFF14161B;
    static final int CARD = 0xFF1E222A;
    static final int FIELD = 0xFF262B35;
    static final int BORDER = 0xFF323845;
    static final int TEXT = 0xFFE9EAEC;
    static final int SUB = 0xFF9AA1AC;
    static final int ACCENT = 0xFF3D8BFD;
    static final int GREEN = 0xFF27AE60;
    static final int RED = 0xFFE5534B;
    static final int ORANGE = 0xFFE8A33D;
    static final int PURPLE = 0xFF8E6AD8;
    static final int BTN = 0xFF2F3644;

    static float density = 1f;

    static int dp(float v) {
        return Math.round(v * density);
    }

    static GradientDrawable round(int color, float radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    static GradientDrawable roundStroke(int color, int stroke, float radiusDp) {
        GradientDrawable g = round(color, radiusDp);
        g.setStroke(dp(1), stroke);
        return g;
    }

    static TextView text(Context c, String s, float sp, int color) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    static TextView title(Context c, String s) {
        TextView t = text(c, s, 15, TEXT);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    static TextView hint(Context c, String s) {
        TextView t = text(c, s, 12, SUB);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    static Button button(Context c, String s, int color) {
        Button b = new Button(c);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(0xFFFFFFFF);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setMinHeight(dp(40));
        b.setMinimumHeight(dp(40));
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(10), 0, dp(10), 0);
        b.setStateListAnimator(null);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), round(color, 8), null));
        return b;
    }

    static Button small(Context c, String s) {
        Button b = button(c, s, BTN);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        b.setMinHeight(dp(34));
        b.setMinimumHeight(dp(34));
        return b;
    }

    static EditText edit(Context c, String hint, boolean multiline) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setHintTextColor(0xFF6B7280);
        e.setTextColor(TEXT);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        e.setBackground(roundStroke(FIELD, BORDER, 8));
        e.setPadding(dp(10), dp(8), dp(10), dp(8));
        if (multiline) {
            e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            e.setGravity(Gravity.TOP | Gravity.START);
            e.setHorizontallyScrolling(false);
        } else {
            e.setSingleLine(true);
        }
        return e;
    }

    static EditText number(Context c, String hint, boolean decimal) {
        EditText e = edit(c, hint, false);
        e.setInputType(decimal
                ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
                : InputType.TYPE_CLASS_NUMBER);
        return e;
    }

    /**
     * 让卡在 ScrollView 里的多行输入框能自己滚动。
     * 不加的话手指一滑，外层页面先把滚动抢走了，长文本根本翻不动。
     */
    static void nestedScroll(View e) {
        e.setVerticalScrollBarEnabled(true);
        e.setOnTouchListener((v, ev) -> {
            if (v.canScrollVertically(1) || v.canScrollVertically(-1)) {
                v.getParent().requestDisallowInterceptTouchEvent(true);
                if ((ev.getActionMasked() & MotionEvent.ACTION_MASK) == MotionEvent.ACTION_UP) {
                    v.getParent().requestDisallowInterceptTouchEvent(false);
                }
            }
            return false;
        });
    }

    static LinearLayout col(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    /** 一行按钮等宽平分 */
    static LinearLayout buttonRow(Context c, View... views) {
        LinearLayout r = row(c);
        for (int i = 0; i < views.length; i++) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            if (i > 0) lp.leftMargin = dp(6);
            r.addView(views[i], lp);
        }
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.topMargin = dp(6);
        r.setLayoutParams(rp);
        return r;
    }

    /** 带标题的卡片，返回卡片本身；往里 addView 即可 */
    static LinearLayout card(Context c, String title) {
        LinearLayout card = col(c);
        card.setBackground(round(CARD, 12));
        card.setPadding(dp(14), dp(12), dp(14), dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(12), dp(10), dp(12), 0);
        card.setLayoutParams(lp);
        if (title != null) {
            TextView t = title(c, title);
            t.setPadding(0, 0, 0, dp(6));
            card.addView(t);
        }
        return card;
    }

    /** 标签 + 输入框，竖排 */
    static LinearLayout field(Context c, String label, View input) {
        LinearLayout l = col(c);
        TextView t = text(c, label, 12, SUB);
        t.setPadding(0, dp(6), 0, dp(4));
        l.addView(t);
        l.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return l;
    }

    /** 两个字段并排 */
    static LinearLayout pair(Context c, View a, View b) {
        LinearLayout r = row(c);
        r.setGravity(Gravity.TOP);
        LinearLayout.LayoutParams la = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        LinearLayout.LayoutParams lb = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lb.leftMargin = dp(10);
        r.addView(a, la);
        r.addView(b, lb);
        return r;
    }

    static Switch toggle(Context c, String label, boolean on) {
        Switch s = new Switch(c);
        s.setText(label);
        s.setTextColor(TEXT);
        s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        s.setChecked(on);
        s.setPadding(0, dp(8), 0, dp(4));
        return s;
    }

    static CheckBox check(Context c) {
        CheckBox cb = new CheckBox(c);
        cb.setFocusable(false);
        cb.setClickable(false);
        cb.setButtonTintList(ColorStateList.valueOf(ACCENT));
        return cb;
    }

    interface OnText {
        void on(String s);
    }

    static void onText(EditText e, OnText cb) {
        e.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                cb.on(s.toString());
            }
        });
    }

    static int parseInt(String s, int def) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    static double parseDouble(String s, double def) {
        try {
            return Double.parseDouble(s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    static String fmtTk(int tk) {
        return tk >= 1000 ? String.format(java.util.Locale.ROOT, "%.1fk", tk / 1000f) : String.valueOf(tk);
    }
}
