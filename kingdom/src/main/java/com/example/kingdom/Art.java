package com.example.kingdom;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

import java.util.Random;

/**
 * 全部美术都用代码绘制（低多边形卡通风格：绿草地、土路、白色山崖、松树、木屋、
 * 红色蛮兵、金甲蓝披风国王、虚线角标地块）。坐标原点 = 物体脚底中心。
 */
final class Art {
    private Art() {}

    static final Paint P = new Paint(Paint.ANTI_ALIAS_FLAG);
    static final Paint S = new Paint(Paint.ANTI_ALIAS_FLAG);
    static final Path PATH = new Path();
    static final RectF R = new RectF();

    // 调色板
    static final int GRASS = 0xFF62B07D;
    static final int DIRT_EDGE = 0xFFCDB68C, DIRT = 0xFFDBC69E, DIRT_LIGHT = 0xFFE4D3B0;
    static final int WOOD_D = 0xFF5B3A22, WOOD = 0xFF7B5233, WOOD_L = 0xFF9A6C45, WOOD_LL = 0xFFB4875C;
    static final int PLASTER = 0xFFEAE2D1, PLASTER_D = 0xFFCFC5B1;
    static final int GOLD_D = 0xFFB07A0C, GOLD = 0xFFF2BC2A, GOLD_L = 0xFFFFE07A;
    static final int CAPE = 0xFF2F66DA, CAPE_D = 0xFF1E44A0;

    // ---------- 基础 ----------
    static void fill(int color) {
        P.setStyle(Paint.Style.FILL);
        P.setColor(color);
    }

    static void line(Canvas c, float x1, float y1, float x2, float y2, float w, int color) {
        S.setStyle(Paint.Style.STROKE);
        S.setStrokeCap(Paint.Cap.ROUND);
        S.setStrokeWidth(w);
        S.setColor(color);
        c.drawLine(x1, y1, x2, y2, S);
    }

    static void poly(Canvas c, int color, float... p) {
        PATH.reset();
        PATH.moveTo(p[0], p[1]);
        for (int i = 2; i < p.length; i += 2) PATH.lineTo(p[i], p[i + 1]);
        PATH.close();
        fill(color);
        c.drawPath(PATH, P);
    }

    static void oval(Canvas c, int color, float cx, float cy, float rx, float ry) {
        fill(color);
        R.set(cx - rx, cy - ry, cx + rx, cy + ry);
        c.drawOval(R, P);
    }

    static void circle(Canvas c, int color, float x, float y, float r) {
        fill(color);
        c.drawCircle(x, y, r, P);
    }

    static void rect(Canvas c, int color, float l, float t, float r, float b) {
        fill(color);
        c.drawRect(l, t, r, b, P);
    }

    static void shadow(Canvas c, float x, float y, float rx, float ry) {
        oval(c, 0x33103020, x + rx * 0.15f, y, rx, ry);
    }

    // ---------- 场景 ----------
    static void pine(Canvas c, float x, float y, float s) {
        oval(c, 0x30103020, x + 10 * s, y + 2, 24 * s, 9 * s);
        rect(c, 0xFF5E4029, x - 3 * s, y - 14 * s, x + 3 * s, y);
        float base = y - 10 * s;
        for (int t = 0; t < 3; t++) {
            float w = (24 - t * 6) * s;
            float bottom = base - t * 20 * s;
            float top = bottom - 34 * s;
            poly(c, 0xFF2A6E50, x, top, x - w, bottom, x + w, bottom);
            poly(c, 0xFF378A62, x, top, x, bottom, x + w, bottom);
        }
    }

    static void bush(Canvas c, float x, float y, float s) {
        oval(c, 0x30103020, x + 6, y + 2, 20 * s, 7 * s);
        circle(c, 0xFF3A8C5E, x - 9 * s, y - 8 * s, 11 * s);
        circle(c, 0xFF3A8C5E, x + 9 * s, y - 8 * s, 11 * s);
        circle(c, 0xFF48A06C, x, y - 14 * s, 13 * s);
    }

    /** 左侧白色低多边形山崖 */
    static void cliff(Canvas c, long seed) {
        Random r = new Random(seed);
        float y = -320;
        while (y < 1000) {
            float h = 110 + r.nextFloat() * 130;
            float edge = 50 + r.nextFloat() * 70 - (y > 650 ? (y - 650) * 0.35f : 0);
            float midY = y + h * (0.35f + r.nextFloat() * 0.2f);
            // 暗面
            poly(c, 0xFFA9A49B, -420, y, edge - 20, y - 6, edge + 26, midY, edge + 6, y + h, -420, y + h + 8);
            // 中间面
            poly(c, 0xFFCAC5BC, -420, y, edge - 20, y - 6, edge + 26, midY, edge - 30, y + h * 0.8f, -420, y + h * 0.9f);
            // 亮顶
            poly(c, 0xFFEDEAE4, -420, y, edge - 20, y - 6, edge - 6, midY - h * 0.1f, edge - 60, midY + 10, -420, y + h * 0.55f);
            y += h * 0.78f;
        }
    }

    // ---------- 地块（虚线角标格子） ----------
    static void plotPad(Canvas c, float x, float y, float scale, float time, float progress, String num, String label) {
        c.save();
        c.translate(x, y);
        c.scale(scale, scale * 0.78f);
        c.rotate(-28);
        float h = 58;
        fill(0xCC3D8A5C);
        R.set(-h, -h, h, h);
        c.drawRoundRect(R, 10, 10, P);
        fill(0x33FFFFFF);
        R.set(-h + 6, -h + 6, h - 6, h - 6);
        S.setStyle(Paint.Style.STROKE);
        S.setStrokeWidth(2);
        S.setColor(0x22FFFFFF);
        c.drawRoundRect(R, 8, 8, S);
        // 角标 + 边中虚线
        S.setStrokeWidth(7);
        S.setStrokeCap(Paint.Cap.ROUND);
        S.setColor(0xF5FFFFFF);
        float e = h + 8, k = 22;
        float[][] corners = {{-e, -e, 1, 1}, {e, -e, -1, 1}, {e, e, -1, -1}, {-e, e, 1, -1}};
        for (float[] q : corners) {
            c.drawLine(q[0], q[1], q[0] + q[2] * k, q[1], S);
            c.drawLine(q[0], q[1], q[0], q[1] + q[3] * k, S);
        }
        float off = (time * 18) % 30;
        for (int side = 0; side < 4; side++) {
            for (float t = -e + 34 + off; t < e - 34; t += 30) {
                float t2 = Math.min(t + 12, e - 34);
                if (side == 0) c.drawLine(t, -e, t2, -e, S);
                else if (side == 1) c.drawLine(e, t, e, t2, S);
                else if (side == 2) c.drawLine(-t, e, -t2, e, S);
                else c.drawLine(-e, -t, -e, -t2, S);
            }
        }
        if (progress > 0) {
            fill(0x66FFD54A);
            R.set(-h, h - 2 * h * progress, h, h);
            c.drawRect(R, P);
        }
        // 数字 + 金币
        Paint t = GameView.TEXT;
        t.setTextSize(46);
        t.setTextAlign(Paint.Align.LEFT);
        float tw = t.measureText(num);
        float total = tw + 40;
        GameView.outlinedLeft(c, num, -total / 2, 16, 46, 0xFFFFFFFF);
        coin(c, -total / 2 + tw + 22, 0, 17);
        if (label != null) GameView.outlined(c, label, 0, 46, 18, 0xE6FFFFFF);
        c.restore();
    }

    static void coin(Canvas c, float x, float y, float r) {
        circle(c, GOLD_D, x, y + r * 0.12f, r);
        circle(c, GOLD, x, y, r);
        circle(c, 0xFFFFD34A, x, y, r * 0.72f);
        crownShape(c, x, y + r * 0.05f, r * 0.42f, GOLD_D);
    }

    static void crownShape(Canvas c, float x, float y, float s, int color) {
        poly(c, color,
                x - s, y + s * 0.6f, x - s, y - s * 0.5f, x - s * 0.5f, y,
                x, y - s * 0.7f, x + s * 0.5f, y, x + s, y - s * 0.5f, x + s, y + s * 0.6f);
    }

    static void crown(Canvas c, float x, float y, float s) {
        crownShape(c, x, y + 2, s, GOLD_D);
        crownShape(c, x, y, s, GOLD);
        circle(c, 0xFFE53935, x, y + s * 0.15f, s * 0.18f);
        circle(c, GOLD_L, x - s, y - s * 0.5f, s * 0.14f);
        circle(c, GOLD_L, x, y - s * 0.7f, s * 0.14f);
        circle(c, GOLD_L, x + s, y - s * 0.5f, s * 0.14f);
    }

    // ---------- 建筑 ----------
    /** 木板屋顶（平行四边形 + 木板纹） */
    static void plankRoof(Canvas c, float l, float r, float eaveY, float ridgeY, float overhang, int light, int dark) {
        // 前坡
        poly(c, dark, l - overhang, eaveY, r + overhang, eaveY, r + overhang * 0.4f, ridgeY, l - overhang * 0.4f, ridgeY);
        poly(c, light, l - overhang, eaveY - 3, r + overhang, eaveY - 3, r + overhang * 0.4f, ridgeY, l - overhang * 0.4f, ridgeY);
        // 木板缝
        int n = Math.max(4, (int) ((r - l) / 14));
        for (int i = 1; i < n; i++) {
            float f = i / (float) n;
            float bx = (l - overhang) + (r - l + 2 * overhang) * f;
            float tx = (l - overhang * 0.4f) + (r - l + overhang * 0.8f) * f;
            line(c, bx, eaveY - 3, tx, ridgeY, 1.6f, 0x55402814);
        }
        line(c, l - overhang * 0.4f, ridgeY, r + overhang * 0.4f, ridgeY, 5, WOOD_D);
        line(c, l - overhang, eaveY - 1, r + overhang, eaveY - 1, 3, 0x66402814);
    }

    static void timberWall(Canvas c, float l, float t, float r, float b) {
        rect(c, PLASTER_D, l, t, r, b);
        rect(c, PLASTER, l, t, r - (r - l) * 0.28f, b);
        line(c, l, t + 2, r, t + 2, 4, WOOD);
        line(c, l + 2, t, l + 2, b, 4, WOOD);
        line(c, r - 2, t, r - 2, b, 4, WOOD);
        line(c, (l + r) / 2, t, (l + r) / 2, b, 3, WOOD);
    }

    static void window(Canvas c, float x, float y, float s, boolean lit) {
        rect(c, WOOD_D, x - s, y - s, x + s, y + s);
        rect(c, lit ? 0xFFFFD86A : 0xFF8FB2CC, x - s + 2, y - s + 2, x + s - 2, y + s - 2);
        line(c, x, y - s, x, y + s, 2, WOOD_D);
        line(c, x - s, y, x + s, y, 2, WOOD_D);
    }

    static void chimney(Canvas c, float x, float top, float bottom) {
        rect(c, 0xFF4A3426, x - 9, top, x + 9, bottom);
        rect(c, 0xFF2E2019, x - 12, top - 6, x + 12, top + 2);
        rect(c, 0xFF1C140F, x - 6, top - 6, x + 6, top - 2);
    }

    /** 小木屋（房屋） */
    static void cabin(Canvas c, float x, float y, int lv, boolean night) {
        float w = 36 + lv * 5;
        shadow(c, x + 10, y + 2, w + 18, 14);
        oval(c, DIRT, x, y + 2, w + 22, 16);
        timberWall(c, x - w, y - 40, x + w, y);
        rect(c, WOOD_D, x - 9, y - 26, x + 9, y);
        window(c, x - w + 16, y - 22, 7, night || lv >= 3);
        window(c, x + w - 16, y - 22, 7, night || lv >= 3);
        chimney(c, x + w * 0.45f, y - 96 - lv * 4, y - 60);
        plankRoof(c, x - w, x + w, y - 38, y - 78 - lv * 4, 12, lv >= 3 ? 0xFF8E6240 : WOOD_L, WOOD_D);
        if (lv >= 2) {
            // 柴堆
            for (int i = 0; i < 3; i++) circle(c, i % 2 == 0 ? WOOD_L : WOOD, x - w - 10, y - 6 - i * 9, 5);
        }
    }

    /** 主城：木制大会堂（带黄色城徽、楼梯、高脚平台） */
    static void townHall(Canvas c, float x, float y, int lv, float time, boolean hit) {
        shadow(c, x + 20, y + 80, 160, 34);
        oval(c, DIRT, x, y + 82, 150, 40);
        // 高脚平台
        for (int i = -3; i <= 3; i++) rect(c, WOOD_D, x + i * 34 - 4, y + 30, x + i * 34 + 4, y + 82);
        rect(c, WOOD, x - 120, y + 22, x + 120, y + 36);
        rect(c, WOOD_L, x - 120, y + 22, x + 120, y + 27);
        // 侧翼
        timberWall(c, x + 40, y - 40, x + 130, y + 24);
        window(c, x + 90, y - 12, 9, lv >= 2);
        plankRoof(c, x + 40, x + 130, y - 38, y - 80, 10, WOOD_L, WOOD_D);
        // 主楼
        timberWall(c, x - 90, y - 110, x + 40, y + 24);
        window(c, x - 55, y - 70, 12, lv >= 1);
        window(c, x - 55, y - 20, 12, lv >= 1);
        // 黄色城徽
        float bx = x + 6, by = y - 72;
        rect(c, GOLD_D, bx - 20, by - 18, bx + 20, by + 22);
        rect(c, GOLD, bx - 18, by - 16, bx + 18, by + 18);
        rect(c, GOLD, bx - 18, by - 24, bx - 10, by - 16);
        rect(c, GOLD, bx - 4, by - 24, bx + 4, by - 16);
        rect(c, GOLD, bx + 10, by - 24, bx + 18, by - 16);
        rect(c, GOLD_D, bx - 5, by + 4, bx + 5, by + 18);
        plankRoof(c, x - 90, x + 40, y - 108, y - 176 - lv * 8, 16, WOOD_L, WOOD_D);
        chimney(c, x - 60, y - 200 - lv * 8, y - 140);
        // 门 + 楼梯
        rect(c, WOOD_D, x - 22, y - 26, x + 4, y + 22);
        for (int i = 0; i < 5; i++) {
            float sy = y + 30 + i * 11, sx = x - 18 - i * 6;
            rect(c, i % 2 == 0 ? WOOD_LL : WOOD_L, sx - 16, sy, sx + 16, sy + 8);
        }
        line(c, x - 36, y + 30, x - 60, y + 86, 4, WOOD_D);
        // 木箱
        rect(c, WOOD, x - 128, y - 6, x - 96, y + 22);
        rect(c, WOOD_L, x - 128, y - 6, x - 96, y);
        line(c, x - 128, y - 6, x - 96, y + 22, 2, WOOD_D);
        // 旗帜
        float fx = x - 25, fy = y - 176 - lv * 8;
        line(c, fx, fy, fx, fy - 60, 4, WOOD_D);
        float wv = (float) Math.sin(time * 4) * 6;
        poly(c, CAPE, fx, fy - 60, fx + 50, fy - 52 + wv, fx + 44, fy - 44 + wv, fx, fy - 36);
        for (int i = 0; i < lv; i++) crown(c, x - 70 + i * 26, y - 130, 8);
        // 火把
        torch(c, x + 150, y + 30, time);
        torch(c, x - 150, y + 40, time + 1.3f);
        if (hit) {
            fill(0x55FF4040);
            c.drawRect(x - 135, y - 190, x + 135, y + 85, P);
        }
    }

    static void torch(Canvas c, float x, float y, float time) {
        shadow(c, x + 3, y + 2, 8, 4);
        rect(c, WOOD_D, x - 3, y - 54, x + 3, y);
        rect(c, 0xFF8A2B20, x - 7, y - 60, x + 7, y - 52);
        float f = (float) Math.sin(time * 13) * 2;
        circle(c, 0x44FFB030, x, y - 70, 22 + f);
        poly(c, 0xFFFF8A1E, x - 9, y - 60, x + 9, y - 60, x + f, y - 86);
        poly(c, 0xFFFFE070, x - 4, y - 60, x + 4, y - 60, x + f * 0.5f, y - 74);
    }

    /** 弩车哨塔 */
    static void ballistaTower(Canvas c, float x, float y, int lv, float aim) {
        float h = 50 + lv * 14;
        shadow(c, x + 12, y + 2, 44, 15);
        if (lv >= 3) {
            rect(c, 0xFF8E8A82, x - 38, y - 18, x + 38, y + 4);
            rect(c, 0xFFB5B0A7, x - 38, y - 18, x + 38, y - 10);
        }
        // 腿
        for (int s = -1; s <= 1; s += 2) {
            rect(c, WOOD_D, x + s * 30 - 4, y - h, x + s * 30 + 4, y);
            rect(c, WOOD, x + s * 18 - 3, y - h, x + s * 18 + 3, y - 4);
        }
        line(c, x - 28, y - 8, x + 28, y - h + 12, 4, WOOD);
        line(c, x + 28, y - 8, x - 28, y - h + 12, 4, WOOD);
        // 平台
        rect(c, WOOD_D, x - 42, y - h - 10, x + 42, y - h + 6);
        for (int i = 0; i < 6; i++) rect(c, i % 2 == 0 ? WOOD_L : WOOD_LL, x - 42 + i * 14, y - h - 14, x - 29 + i * 14, y - h - 2);
        // 弩车
        float py = y - h - 22;
        float ax = (float) Math.cos(aim), ay = (float) Math.sin(aim) * 0.7f;
        float px = -ay, pyy = ax;
        line(c, x - ax * 22, py - ay * 22, x + ax * 28, py + ay * 28, 8, WOOD_D);
        line(c, x - ax * 22, py - ay * 22, x + ax * 28, py + ay * 28, 4, WOOD_LL);
        float bx = x + ax * 16, by = py + ay * 16;
        line(c, bx, by, bx + px * 30 - ax * 10, by + pyy * 30 - ay * 10, 5, WOOD);
        line(c, bx, by, bx - px * 30 - ax * 10, by - pyy * 30 - ay * 10, 5, WOOD);
        line(c, bx + px * 30 - ax * 10, by + pyy * 30 - ay * 10, x - ax * 14, py - ay * 14, 1.5f, 0xFFEFE6D0);
        line(c, bx - px * 30 - ax * 10, by - pyy * 30 - ay * 10, x - ax * 14, py - ay * 14, 1.5f, 0xFFEFE6D0);
        line(c, x - ax * 8, py - ay * 8, x + ax * 40, py + ay * 40, 3, 0xFFDCD4C4);
        circle(c, 0xFFB8BEC6, x + ax * 41, py + ay * 41, 3);
        if (lv >= 2) {
            // 顶棚
            line(c, x - 38, y - h - 10, x - 38, y - h - 70, 4, WOOD_D);
            line(c, x + 38, y - h - 10, x + 38, y - h - 70, 4, WOOD_D);
            plankRoof(c, x - 38, x + 38, y - h - 66, y - h - 96, 10, 0xFFB03A2C, 0xFF7A231A);
        }
        if (lv >= 3) {
            line(c, x, y - h - 96, x, y - h - 128, 3, WOOD_D);
            poly(c, CAPE, x, y - h - 128, x + 26, y - h - 122, x, y - h - 114);
        }
    }

    /** 木栅栏城墙 */
    static void palisade(Canvas c, float cx, float cy, float dirX, float dirY, int lv, boolean alive) {
        float px = -dirY, py = dirX;
        int n = 9 + lv * 2;
        float gap = 12;
        for (int row = (lv >= 3 ? 1 : 0); row >= 0; row--) {
            float rx = cx - dirX * row * 14, ry = cy - dirY * row * 14;
            for (int i = 0; i < n; i++) {
                float o = (i - (n - 1) / 2f) * gap;
                float x = rx + px * o, y = ry + py * o;
                float h = alive ? 48 + lv * 6 + ((i * 7) % 3) * 3 : 10 + (i % 3) * 5;
                oval(c, 0x30103020, x + 6, y + 2, 8, 4);
                rect(c, WOOD, x - 6, y - h, x + 6, y);
                rect(c, WOOD_LL, x - 6, y - h, x - 2, y);
                rect(c, WOOD_D, x + 3, y - h, x + 6, y);
                if (alive) {
                    poly(c, WOOD_L, x - 6, y - h, x + 6, y - h, x, y - h - 12);
                    poly(c, 0xFFD9B98E, x - 6, y - h, x, y - h, x, y - h - 12);
                } else {
                    poly(c, 0xFFD9B98E, x - 6, y - h, x + 6, y - h + 3, x + 2, y - h - 4);
                }
            }
            if (alive && lv >= 2) {
                float o = (n - 1) / 2f * gap;
                line(c, rx - px * o, ry - py * o - 18, rx + px * o, ry + py * o - 18, 4, 0xFF4E4A47);
                line(c, rx - px * o, ry - py * o - 34, rx + px * o, ry + py * o - 34, 4, 0xFF4E4A47);
            }
        }
        if (alive) {
            float o = (n - 1) / 2f * gap + 10;
            float ex = cx + px * o, ey = cy + py * o;
            rect(c, WOOD_D, ex - 9, ey - 78 - lv * 6, ex + 9, ey + 2);
            rect(c, WOOD_L, ex - 9, ey - 78 - lv * 6, ex - 3, ey + 2);
        }
    }

    /** 兵营：帐篷 + 武器架 + 旗 */
    static void barracks(Canvas c, float x, float y, int lv, float time) {
        shadow(c, x + 10, y + 2, 62, 18);
        oval(c, DIRT, x, y + 2, 64, 20);
        // 帐篷
        poly(c, 0xFFC9C1B0, x - 50, y, x + 10, y, x - 20, y - 70);
        poly(c, 0xFFEDE7DA, x - 50, y, x - 20, y, x - 20, y - 70);
        poly(c, CAPE_D, x - 30, y, x - 10, y, x - 20, y - 34);
        line(c, x - 20, y - 70, x - 20, y - 84, 3, WOOD_D);
        // 第二顶帐篷
        if (lv >= 2) {
            poly(c, 0xFFC9C1B0, x + 8, y + 6, x + 56, y + 6, x + 32, y - 50);
            poly(c, 0xFFEDE7DA, x + 8, y + 6, x + 32, y + 6, x + 32, y - 50);
        }
        // 武器架
        line(c, x + 22, y - 12, x + 62, y - 12, 4, WOOD_D);
        for (int i = 0; i < 3; i++) {
            float sx = x + 28 + i * 13;
            line(c, sx, y + 2, sx + 4, y - 46, 3, WOOD);
            poly(c, 0xFFCFD5DD, sx + 1, y - 44, sx + 8, y - 44, sx + 5, y - 58);
        }
        // 旗
        float fx = x + 46, fy = y - 60;
        line(c, fx, fy + 60, fx, fy - 40, 4, WOOD_D);
        float wv = (float) Math.sin(time * 5 + x) * 5;
        poly(c, CAPE, fx, fy - 40, fx + 34, fy - 32 + wv, fx + 30, fy - 22 + wv, fx, fy - 16);
        crownShape(c, fx + 14, fy - 28 + wv * 0.5f, 6, GOLD);
    }

    /** 城堡升级：金冠石碑 */
    static void monument(Canvas c, float x, float y, int lv, float time) {
        shadow(c, x + 8, y + 2, 36, 12);
        rect(c, 0xFFA9A49B, x - 26, y - 34, x + 26, y);
        rect(c, 0xFFE2DED6, x - 26, y - 34, x + 8, y);
        rect(c, 0xFFCAC5BC, x - 30, y - 40, x + 30, y - 32);
        float bob = (float) Math.sin(time * 3) * 3;
        circle(c, 0x33FFE07A, x, y - 60 + bob, 26);
        crown(c, x, y - 58 + bob, 16 + lv * 2);
    }

    static void pips(Canvas c, float x, float y, int lv) {
        for (int i = 0; i < lv; i++) {
            float px = x - (lv - 1) * 10 + i * 20;
            circle(c, 0xFF5A3D08, px, y + 1, 7.5f);
            circle(c, GOLD, px, y, 6.5f);
            circle(c, GOLD_L, px - 2, y - 2, 2.5f);
        }
    }

    // ---------- 角色 ----------
    /** 红色蛮兵。kind: 0 步兵 1 快兵 2 重甲蛮牛 3 首领 */
    static void brute(Canvas c, float x, float y, float r, int kind, float fx, float fy, float phase, boolean flash) {
        float bob = (float) Math.abs(Math.sin(phase)) * r * 0.18f;
        float step = (float) Math.sin(phase) * r * 0.25f;
        oval(c, 0x40102018, x + r * 0.2f, y, r * 1.05f, r * 0.42f);
        int body = flash ? 0xFFFFFFFF : (kind == 1 ? 0xFFF0472E : kind == 3 ? 0xFFB3121F : 0xFFE0262B);
        int dark = flash ? 0xFFE0E0E0 : (kind == 3 ? 0xFF6E0710 : 0xFF95141A);
        int light = flash ? 0xFFFFFFFF : 0xFFFF5A52;
        int metal = flash ? 0xFFFFFFFF : 0xFF9AA0A8, metalD = flash ? 0xFFDDDDDD : 0xFF62676E;
        float by = y - bob;
        if (kind == 3) {
            // 首领披风
            poly(c, 0xFF3A0A12, x - r * 1.0f, by - r * 1.4f, x + r * 1.0f, by - r * 1.4f, x + r * 1.25f, by + r * 0.1f, x - r * 1.25f, by + r * 0.1f);
        }
        // 腿
        oval(c, dark, x - r * 0.42f, y - r * 0.12f + step * 0.3f, r * 0.28f, r * 0.2f);
        oval(c, dark, x + r * 0.42f, y - r * 0.12f - step * 0.3f, r * 0.28f, r * 0.2f);
        // 身体
        circle(c, dark, x, by - r * 0.62f, r * 0.92f);
        circle(c, body, x - r * 0.06f, by - r * 0.7f, r * 0.84f);
        circle(c, light, x - r * 0.32f, by - r * 0.98f, r * 0.3f);
        // 肩甲
        circle(c, dark, x - r * 0.8f, by - r * 0.95f, r * 0.42f);
        circle(c, body, x - r * 0.84f, by - r * 1.0f, r * 0.36f);
        circle(c, dark, x + r * 0.8f, by - r * 0.95f, r * 0.42f);
        circle(c, body, x + r * 0.76f, by - r * 1.0f, r * 0.36f);
        // 头盔
        circle(c, metalD, x, by - r * 1.52f, r * 0.5f);
        circle(c, metal, x - r * 0.06f, by - r * 1.58f, r * 0.44f);
        rect(c, 0xFF2A1A1A, x - r * 0.28f, by - r * 1.5f, x + r * 0.28f, by - r * 1.4f);
        if (kind >= 2) {
            int horn = flash ? 0xFFFFFFFF : 0xFFF1E9D6;
            poly(c, horn, x - r * 0.38f, by - r * 1.8f, x - r * 0.95f, by - r * 2.45f, x - r * 0.58f, by - r * 1.62f);
            poly(c, horn, x + r * 0.38f, by - r * 1.8f, x + r * 0.95f, by - r * 2.45f, x + r * 0.58f, by - r * 1.62f);
        }
        if (kind == 3) crown(c, x, by - r * 2.05f, r * 0.42f);
        // 武器（斧 / 棒）
        float side = fx >= 0 ? 1 : -1;
        float hx = x + side * r * 0.95f, hy = by - r * 0.8f;
        float swing = (float) Math.sin(phase * 0.5f) * 0.25f;
        float tx = hx + side * r * (0.4f + swing), ty = hy - r * 1.1f;
        line(c, hx, hy + r * 0.3f, tx, ty, r * 0.16f, WOOD_D);
        if (kind == 2 || kind == 3) {
            circle(c, WOOD, tx, ty, r * 0.3f);
            circle(c, metal, tx - r * 0.2f, ty - r * 0.15f, r * 0.08f);
            circle(c, metal, tx + r * 0.18f, ty + r * 0.1f, r * 0.08f);
        } else {
            poly(c, metal, tx, ty - r * 0.05f, tx + side * r * 0.45f, ty - r * 0.3f, tx + side * r * 0.45f, ty + r * 0.35f, tx, ty + r * 0.2f);
            poly(c, metalD, tx, ty + r * 0.08f, tx + side * r * 0.45f, ty + r * 0.1f, tx + side * r * 0.45f, ty + r * 0.35f, tx, ty + r * 0.2f);
        }
    }

    /** 银甲骑士（兵营士兵） */
    static void knight(Canvas c, float x, float y, float swing, float phase) {
        float bob = (float) Math.abs(Math.sin(phase)) * 2;
        oval(c, 0x40102018, x + 3, y, 13, 5);
        float by = y - bob;
        circle(c, 0xFF6F7680, x, by - 11, 12);
        circle(c, 0xFFCDD3DB, x - 1, by - 12, 10.5f);
        circle(c, 0xFFF5F7FA, x - 4, by - 15, 3.5f);
        circle(c, 0xFF6F7680, x, by - 27, 8.5f);
        circle(c, 0xFFB9C0C9, x - 1, by - 28, 7.5f);
        rect(c, 0xFF2A2A30, x - 5, by - 28, x + 5, by - 25);
        poly(c, 0xFFE53935, x - 2, by - 35, x + 2, by - 35, x + 6, by - 44);
        // 盾
        R.set(x - 18, by - 22, x - 6, by - 4);
        fill(CAPE_D);
        c.drawRoundRect(R, 4, 4, P);
        R.set(x - 17, by - 21, x - 7, by - 6);
        fill(CAPE);
        c.drawRoundRect(R, 3, 3, P);
        // 剑
        float a = swing > 0 ? -0.8f + (0.2f - swing) * 8 : -1.2f;
        float sx = x + 10, sy = by - 12;
        line(c, sx, sy, sx + (float) Math.cos(a) * 22, sy + (float) Math.sin(a) * 22, 3, 0xFFE8ECF2);
    }

    /** 金甲蓝披风国王 */
    static void king(Canvas c, float x, float y, float fx, float fy, float walk, float swing, float time) {
        float bob = (float) Math.abs(Math.sin(walk)) * 3;
        oval(c, 0x48102018, x + 4, y + 2, 26, 9);
        float by = y - bob;
        // 披风（向移动反方向飘）
        float cx = -fx * 14, cy = -fy * 8;
        float flap = (float) Math.sin(time * 8) * 3;
        poly(c, CAPE_D, x - 16, by - 34, x + 16, by - 34, x + 22 + cx + flap, by - 2 + cy, x - 22 + cx - flap, by - 2 + cy);
        poly(c, CAPE, x - 14, by - 34, x + 6, by - 34, x + 6 + cx + flap, by - 4 + cy, x - 20 + cx - flap, by - 4 + cy);
        // 腿
        float st = (float) Math.sin(walk) * 4;
        oval(c, GOLD_D, x - 7, by - 2 + st * 0.4f, 6, 4);
        oval(c, GOLD_D, x + 7, by - 2 - st * 0.4f, 6, 4);
        // 身体金甲
        circle(c, GOLD_D, x, by - 18, 17);
        circle(c, GOLD, x - 1, by - 20, 15);
        circle(c, GOLD_L, x - 6, by - 25, 5);
        line(c, x - 12, by - 14, x + 12, by - 14, 3, GOLD_D);
        // 肩甲
        circle(c, GOLD_D, x - 15, by - 28, 7);
        circle(c, GOLD, x - 16, by - 29, 5.5f);
        circle(c, GOLD_D, x + 15, by - 28, 7);
        circle(c, GOLD, x + 14, by - 29, 5.5f);
        // 头 + 金盔 + 王冠
        circle(c, 0xFFE0A86A, x, by - 42, 10);
        circle(c, 0xFFF2C38B, x - 1, by - 43, 9);
        oval(c, 0xFF8A5528, x, by - 35, 6.5f, 4.5f); // 胡子
        circle(c, 0xFF2A1A10, x - 3.5f + fx * 2, by - 44 + fy, 1.6f);
        circle(c, 0xFF2A1A10, x + 3.5f + fx * 2, by - 44 + fy, 1.6f);
        R.set(x - 11, by - 56, x + 11, by - 40);
        fill(GOLD_D);
        c.drawArc(R, 180, 180, true, P);
        crown(c, x, by - 58, 9);
        // 金锤
        double base = Math.atan2(fy, fx);
        double ang = swing > 0 ? base - 1.6 + (0.22f - swing) / 0.22f * 3.2 : base + 0.9;
        float hx = x + (float) Math.cos(ang) * 14, hy = by - 20 + (float) Math.sin(ang) * 10;
        float ex = hx + (float) Math.cos(ang) * 30, ey = hy + (float) Math.sin(ang) * 22;
        line(c, hx, hy, ex, ey, 4, WOOD_D);
        circle(c, GOLD_D, ex, ey + 1, 9);
        circle(c, GOLD, ex, ey, 8);
        circle(c, GOLD_L, ex - 2, ey - 3, 3);
        if (swing > 0) {
            S.setStyle(Paint.Style.STROKE);
            S.setStrokeCap(Paint.Cap.ROUND);
            S.setStrokeWidth(10);
            S.setColor(0x99FFE07A);
            R.set(x - 58, by - 78, x + 58, by + 38);
            c.drawArc(R, (float) Math.toDegrees(base) - 70, 140, false, S);
            S.setStrokeWidth(4);
            S.setColor(0xDDFFFFFF);
            c.drawArc(R, (float) Math.toDegrees(base) - 50, 100, false, S);
        }
    }

    /** 弩箭 */
    static void bolt(Canvas c, float x, float y, float vx, float vy) {
        line(c, x - vx * 30, y - vy * 30, x, y, 3.5f, 0xFF7B5233);
        line(c, x - vx * 30, y - vy * 30, x - vx * 22, y - vy * 22, 5, 0xFFF2F2F2);
        line(c, x - vx * 6, y - vy * 6, x + vx * 4, y + vy * 4, 4, 0xFFC9D0D8);
    }

    static void fireball(Canvas c, float x, float y, float time) {
        circle(c, 0x55FFB030, x, y, 14 + (float) Math.sin(time * 30) * 2);
        circle(c, 0xFFFF8A1E, x, y, 8);
        circle(c, 0xFFFFE070, x - 2, y - 2, 4);
    }

    /** 蓝白闪电击中特效 */
    static void spark(Canvas c, float x, float y, float life, long seed) {
        Random r = new Random(seed);
        float a = Math.min(1, life / 0.25f);
        int alpha = (int) (a * 255);
        circle(c, (alpha / 3) << 24 | 0xBFE4FF, x, y, 26 * (1.4f - a));
        for (int i = 0; i < 6; i++) {
            double ang = r.nextDouble() * Math.PI * 2;
            float len = 18 + r.nextFloat() * 22;
            float mx = x + (float) Math.cos(ang + 0.3) * len * 0.5f, my = y + (float) Math.sin(ang + 0.3) * len * 0.5f;
            float ex = x + (float) Math.cos(ang) * len, ey = y + (float) Math.sin(ang) * len;
            line(c, x, y, mx, my, 3, alpha << 24 | 0xE6F4FF);
            line(c, mx, my, ex, ey, 2, alpha << 24 | 0x9FD3FF);
        }
        circle(c, alpha << 24 | 0xFFFFFF, x, y, 7 * a);
    }

    /** 标题字（粗金字 + 深棕描边） */
    static void logo(Canvas c, String s, float x, float y, float size) {
        Paint t = GameView.TEXT;
        t.setTextSize(size);
        t.setTextAlign(Paint.Align.CENTER);
        t.setStyle(Paint.Style.STROKE);
        t.setStrokeJoin(Paint.Join.ROUND);
        t.setStrokeWidth(size * 0.32f);
        t.setColor(0xFF4A2A10);
        c.drawText(s, x, y + size * 0.06f, t);
        t.setStrokeWidth(size * 0.16f);
        t.setColor(0xFFB0700C);
        c.drawText(s, x, y, t);
        t.setStyle(Paint.Style.FILL);
        t.setColor(0xFFFFD447);
        c.drawText(s, x, y, t);
        t.setColor(0x66FFFFFF);
        c.save();
        c.clipRect(x - size * s.length(), y - size, x + size * s.length(), y - size * 0.45f);
        c.drawText(s, x, y, t);
        c.restore();
    }
}
