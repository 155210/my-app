package com.example.photorange;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

/**
 * 时间轴：每个月一根柱子，高度是那个月的照片数；选中的范围是日光黄。
 * 点一个月设为起点，再点另一个月设为终点。放在 HorizontalScrollView 里左右拖。
 */
final class TimelineView extends View {
    interface OnRange {
        void onRange(int fromYm, int toYm);
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private final int pad, minStep, maxStep, barsH, labelH, topPad;

    /** 第 0 根柱子是哪个月（年*12+月-1） */
    private int startMonth;
    private int[] counts = new int[0];
    private int maxCount = 1;
    /** 选中范围，含两端；可以落在柱子范围之外 */
    private int selFrom = 0, selTo = -1;
    /** 刚点过起点，在等终点 */
    private int anchor = -1;
    private float downX;
    private OnRange listener;

    TimelineView(Context c) {
        super(c);
        pad = Ui.dp(c, 4);
        minStep = Ui.dp(c, 15);
        maxStep = Ui.dp(c, 44);
        barsH = Ui.dp(c, 96);
        labelH = Ui.dp(c, 22);
        topPad = Ui.dp(c, 8);
        paint.setTextSize(Ui.dp(c, 11));
        setClickable(true);
        setOnClickListener(v -> onTap(downX));
    }

    void setOnRange(OnRange l) {
        listener = l;
    }

    private static int toMonth(int ym) {
        return (ym / 100) * 12 + (ym % 100) - 1;
    }

    private static int toYm(int month) {
        return (month / 12) * 100 + (month % 12) + 1;
    }

    /** @param minYm 最早的月份；counts[i] 是它之后第 i 个月的张数 */
    void setData(int minYm, int[] counts) {
        this.startMonth = toMonth(minYm);
        this.counts = counts;
        int m = 1;
        for (int c : counts) m = Math.max(m, c);
        this.maxCount = m;
        this.anchor = -1;
        requestLayout();
        invalidate();
    }

    void setSelection(int fromYm, int toYm) {
        selFrom = toMonth(fromYm) - startMonth;
        selTo = toMonth(toYm) - startMonth;
        invalidate();
    }

    private float step() {
        int n = Math.max(1, counts.length);
        float s = (getWidth() - 2f * pad) / n;
        return Math.max(minStep, Math.min(maxStep, s));
    }

    /** 第 i 根柱子左边缘的位置，用来把选中范围滚到看得见的地方 */
    int xOf(int ym) {
        return Math.round(pad + (toMonth(ym) - startMonth) * step());
    }

    @Override
    protected void onMeasure(int widthSpec, int heightSpec) {
        int natural = 2 * pad + Math.max(1, counts.length) * minStep;
        int w = MeasureSpec.getMode(widthSpec) == MeasureSpec.EXACTLY
                ? MeasureSpec.getSize(widthSpec) : natural;
        setMeasuredDimension(w, topPad + barsH + labelH);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (e.getActionMasked() == MotionEvent.ACTION_DOWN) downX = e.getX();
        return super.onTouchEvent(e);
    }

    private void onTap(float x) {
        if (counts.length == 0) return;
        int i = (int) Math.floor((x - pad) / step());
        if (i < 0 || i >= counts.length) return;
        if (anchor < 0) {
            anchor = i;
            selFrom = selTo = i;
        } else {
            selFrom = Math.min(anchor, i);
            selTo = Math.max(anchor, i);
            anchor = -1;
        }
        invalidate();
        if (listener != null) listener.onRange(toYm(startMonth + selFrom), toYm(startMonth + selTo));
    }

    @Override
    protected void onDraw(Canvas c) {
        int n = counts.length;
        if (n == 0) return;
        float step = step();
        float barW = Math.min(step * 0.68f, Ui.dp(getContext(), 22));
        float base = topPad + barsH;
        float r = Math.min(barW / 2f, Ui.dp(getContext(), 4));

        // 选中范围的底衬：没照片的月份也看得出选到了哪
        int a = Math.max(0, selFrom), b = Math.min(n - 1, selTo);
        if (a <= b) {
            paint.setColor(Ui.PILL);
            rect.set(pad + a * step, 0, pad + (b + 1) * step, base + Ui.dp(getContext(), 3));
            float rr = Ui.dp(getContext(), 8);
            c.drawRoundRect(rect, rr, rr, paint);
        }

        float minBar = Ui.dp(getContext(), 4);
        float dot = Ui.dp(getContext(), 2);
        for (int i = 0; i < n; i++) {
            float cx = pad + i * step + step / 2f;
            boolean sel = i >= selFrom && i <= selTo;
            if (counts[i] > 0) {
                // 开方：少的月份也看得见，多的月份不至于一柱擎天
                float h = Math.max(minBar, (float) Math.sqrt(counts[i] / (double) maxCount) * barsH);
                paint.setColor(sel ? Ui.SUN : Ui.BAR);
                rect.set(cx - barW / 2f, base - h, cx + barW / 2f, base);
                c.drawRoundRect(rect, r, r, paint);
            } else {
                paint.setColor(sel ? 0x99FFC857 : 0x806C91C6);
                c.drawCircle(cx, base - dot, dot, paint);
            }
            // 每年 1 月下面标年份；开头不是 1 月、离下一个 1 月又够远时也标一下
            int month = (startMonth + i) % 12;
            if (month == 0 || (i == 0 && month <= 9)) {
                paint.setColor(Ui.MIST);
                c.drawText(String.valueOf((startMonth + i) / 12), pad + i * step + (step - barW) / 2f,
                        base + labelH - Ui.dp(getContext(), 5), paint);
                if (month == 0 && i > 0) {
                    paint.setColor(Ui.LINE);
                    c.drawRect(pad + i * step - 1, topPad, pad + i * step, base, paint);
                }
            }
        }
    }
}
