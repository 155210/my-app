package com.example.gproxyisland;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.View;

/** 岛和设置页共用的颜色和小部件（状态图标、进度条） */
final class Ui {
    private Ui() {
    }

    static final int BG = 0xFF0E0F11, CARD = 0xFF17191D, CARD2 = 0xFF1F2228, LINE = 0xFF24262B, TRACK = 0xFF2E3138;
    static final int FG = 0xFFF1EFE8, MUTED = 0xFFA3A199, SOFT = 0xFFC9C7BF;
    static final int GREEN = 0xFF5DCAA5, AMBER = 0xFFEF9F27, RED = 0xFFE24B4A, RED_SOFT = 0xFFF09595, GREY = 0xFF888780;
    static final int AMBER_BG = 0xFF2B2110, RED_BG = 0xFF2B1414, STRIP = 0xFF2A2D33;

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static GradientDrawable round(int color, float radiusPx) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radiusPx);
        return g;
    }

    /** 用量百分比的颜色：70% 以下绿，90% 以下黄，再往上红 */
    static int usedColor(double percent) {
        return percent >= 90 ? RED : percent >= 70 ? AMBER : GREEN;
    }

    /** 状态图标：圆点 / 预算进度环 / 生成中的跳动条 / 对勾 / 叉 / 盾牌警告 */
    static final class Glyph extends View {
        static final int DOT = 0, RING = 1, BARS = 2, CHECK = 3, CROSS = 4, SHIELD = 5;

        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();
        private final Path path = new Path();
        private int mode = DOT, color = GREY;
        /** 进度环走了多少，0~1 */
        private float progress;
        private float phase;
        private ValueAnimator anim;

        Glyph(Context c) {
            super(c);
        }

        void set(int mode, int color, float progress) {
            if (this.mode == mode && this.color == color && this.progress == progress) return;
            this.mode = mode;
            this.color = color;
            this.progress = progress;
            // 只在挂到窗口上时才跑动画，摘下来（onDetachedFromWindow）就停，不会漏
            if (mode == BARS && isAttachedToWindow()) start();
            else if (mode != BARS) stop();
            invalidate();
        }

        int mode() {
            return mode;
        }

        int color() {
            return color;
        }

        boolean animating() {
            return anim != null;
        }

        private void start() {
            // 系统里关了动画（开发者选项 / 省电）就不跳，画静止的三根条
            if (anim != null || !ValueAnimator.areAnimatorsEnabled()) return;
            anim = ValueAnimator.ofFloat(0f, 1f);
            anim.setDuration(900);
            anim.setRepeatCount(ValueAnimator.INFINITE);
            anim.setInterpolator(new android.view.animation.LinearInterpolator());
            anim.addUpdateListener(a -> {
                phase = (float) a.getAnimatedValue();
                invalidate();
            });
            anim.start();
        }

        void stop() {
            if (anim == null) return;
            anim.cancel();
            anim = null;
            phase = 0;
        }

        @Override
        protected void onDetachedFromWindow() {
            stop();
            super.onDetachedFromWindow();
        }

        @Override
        protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            if (mode == BARS) start();
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), s = Math.min(w, h), cx = w / 2f, cy = h / 2f;
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setStrokeJoin(Paint.Join.ROUND);
            switch (mode) {
                case RING: {
                    float sw = s * 0.15f, rad = s / 2f - sw / 2f - s * 0.05f;
                    p.setStyle(Paint.Style.STROKE);
                    p.setStrokeWidth(sw);
                    p.setColor(TRACK);
                    c.drawCircle(cx, cy, rad, p);
                    p.setColor(color);
                    r.set(cx - rad, cy - rad, cx + rad, cy + rad);
                    c.drawArc(r, -90, 360f * Math.max(0.02f, Math.min(1f, progress)), false, p);
                    break;
                }
                case BARS: {
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(color);
                    float bw = s * 0.17f, gap = s * 0.13f, left = cx - (bw * 3 + gap * 2) / 2f;
                    float[] base = {0.45f, 0.85f, 0.55f};
                    for (int i = 0; i < 3; i++) {
                        // 三根条错开相位上下跳
                        double wave = Math.sin((phase + i * 0.33f) * 2 * Math.PI);
                        float bh = s * Math.max(0.25f, Math.min(0.9f, base[i] + 0.22f * (float) wave));
                        float x = left + i * (bw + gap);
                        r.set(x, cy - bh / 2f, x + bw, cy + bh / 2f);
                        c.drawRoundRect(r, bw / 2f, bw / 2f, p);
                    }
                    break;
                }
                case CHECK:
                case CROSS: {
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(color);
                    c.drawCircle(cx, cy, s * 0.45f, p);
                    p.setStyle(Paint.Style.STROKE);
                    p.setStrokeWidth(s * 0.1f);
                    p.setColor(0xFF000000);
                    path.reset();
                    if (mode == CHECK) {
                        path.moveTo(cx - s * 0.2f, cy + s * 0.015f);
                        path.lineTo(cx - s * 0.065f, cy + s * 0.15f);
                        path.lineTo(cx + s * 0.2f, cy - s * 0.125f);
                    } else {
                        path.moveTo(cx - s * 0.15f, cy - s * 0.15f);
                        path.lineTo(cx + s * 0.15f, cy + s * 0.15f);
                        path.moveTo(cx + s * 0.15f, cy - s * 0.15f);
                        path.lineTo(cx - s * 0.15f, cy + s * 0.15f);
                    }
                    c.drawPath(path, p);
                    break;
                }
                case SHIELD: {
                    p.setStyle(Paint.Style.STROKE);
                    p.setStrokeWidth(s * 0.1f);
                    p.setColor(color);
                    path.reset();
                    path.moveTo(cx, cy - s * 0.4f);
                    path.lineTo(cx + s * 0.33f, cy - s * 0.28f);
                    path.lineTo(cx + s * 0.33f, cy - s * 0.02f);
                    path.cubicTo(cx + s * 0.33f, cy + s * 0.2f, cx + s * 0.18f, cy + s * 0.34f, cx, cy + s * 0.42f);
                    path.cubicTo(cx - s * 0.18f, cy + s * 0.34f, cx - s * 0.33f, cy + s * 0.2f, cx - s * 0.33f, cy - s * 0.02f);
                    path.lineTo(cx - s * 0.33f, cy - s * 0.28f);
                    path.close();
                    c.drawPath(path, p);
                    c.drawLine(cx, cy - s * 0.18f, cx, cy + s * 0.03f, p);
                    c.drawPoint(cx, cy + s * 0.2f, p);
                    break;
                }
                default: {
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(color);
                    c.drawCircle(cx, cy, s * 0.2f, p);
                }
            }
        }
    }

    /** 箭头：列表行右边的「›」和页面左上角的「‹」 */
    static final class Chevron extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();
        private final boolean left;

        Chevron(Context c, boolean left, int color) {
            super(c);
            this.left = left;
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setStrokeJoin(Paint.Join.ROUND);
            p.setColor(color);
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), s = Math.min(w, h), cx = w / 2f, cy = h / 2f, d = s * 0.22f;
            p.setStrokeWidth(Math.max(2f, s * 0.09f));
            path.reset();
            float sx = left ? d / 2f : -d / 2f, dir = left ? -1 : 1;
            path.moveTo(cx + sx, cy - d);
            path.lineTo(cx + sx + dir * d, cy);
            path.lineTo(cx + sx, cy + d);
            c.drawPath(path, p);
        }
    }

    /** 自动换行的一排（放标签） */
    static final class Flow extends android.view.ViewGroup {
        private final int gap;

        Flow(Context c, int gapPx) {
            super(c);
            gap = gapPx;
        }

        @Override
        protected void onMeasure(int wSpec, int hSpec) {
            int maxW = MeasureSpec.getSize(wSpec), x = 0, y = 0, rowH = 0;
            for (int i = 0; i < getChildCount(); i++) {
                View v = getChildAt(i);
                if (v.getVisibility() == GONE) continue;
                v.measure(MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
                if (x > 0 && x + v.getMeasuredWidth() > maxW) {
                    x = 0;
                    y += rowH + gap;
                    rowH = 0;
                }
                x += v.getMeasuredWidth() + gap;
                rowH = Math.max(rowH, v.getMeasuredHeight());
            }
            setMeasuredDimension(maxW, y + rowH);
        }

        @Override
        protected void onLayout(boolean changed, int l, int t, int r, int b) {
            int maxW = r - l, x = 0, y = 0, rowH = 0;
            for (int i = 0; i < getChildCount(); i++) {
                View v = getChildAt(i);
                if (v.getVisibility() == GONE) continue;
                if (x > 0 && x + v.getMeasuredWidth() > maxW) {
                    x = 0;
                    y += rowH + gap;
                    rowH = 0;
                }
                v.layout(x, y, x + v.getMeasuredWidth(), y + v.getMeasuredHeight());
                x += v.getMeasuredWidth() + gap;
                rowH = Math.max(rowH, v.getMeasuredHeight());
            }
        }
    }

    /** 圆角进度条 */
    static final class Bar extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();
        private float fraction;
        private int color = GREEN;

        Bar(Context c) {
            super(c);
        }

        Bar set(float fraction, int color) {
            this.fraction = Math.max(0f, Math.min(1f, fraction));
            this.color = color;
            invalidate();
            return this;
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), rad = h / 2f;
            p.setColor(LINE);
            r.set(0, 0, w, h);
            c.drawRoundRect(r, rad, rad, p);
            if (fraction <= 0) return;
            p.setColor(color);
            r.set(0, 0, Math.max(h, w * fraction), h);
            c.drawRoundRect(r, rad, rad, p);
        }
    }
}
