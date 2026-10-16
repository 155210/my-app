package com.example.tapgame;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;

import java.util.Random;

/** 所有角色和场景的美术都在这里用代码画出来，启动时预渲染成位图，运行时直接贴图。 */
final class Sprites {
    interface Drawer { void draw(Canvas c); }

    final Bitmap[] soldier = new Bitmap[4];
    final Bitmap[][] zombie = new Bitmap[3][4];
    final Bitmap[] boss = new Bitmap[4];
    final Bitmap[] buildings = new Bitmap[4];
    final Bitmap[] trees = new Bitmap[3];
    final Bitmap corpse;

    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF r = new RectF();

    private static final int[][] SHIRTS = {
            {0xFF6D8B74, 0xFF3F5A46},
            {0xFF8D6E63, 0xFF5D4037},
            {0xFF546E7A, 0xFF2F3E46},
    };

    Sprites(float dp) {
        for (int f = 0; f < 4; f++) {
            final int ff = f;
            soldier[f] = make(100, 120, 30 * dp, c -> drawSoldier(c, ff));
            boss[f] = make(200, 220, 120 * dp, c -> drawBoss(c, ff));
            for (int v = 0; v < 3; v++) {
                final int vv = v;
                zombie[v][f] = make(100, 120, 28 * dp, c -> drawZombie(c, ff, vv));
            }
        }
        for (int i = 0; i < buildings.length; i++) {
            final int ii = i;
            buildings[i] = make(100, 140, 100 * dp, c -> drawBuilding(c, ii));
        }
        for (int i = 0; i < trees.length; i++) {
            final int ii = i;
            trees[i] = make(100, 100, 58 * dp + i * 8 * dp, c -> drawTree(c, ii));
        }
        corpse = make(100, 60, 30 * dp, this::drawCorpse);
    }

    private Bitmap make(float wu, float hu, float pxW, Drawer d) {
        int w = Math.max(1, Math.round(pxW));
        int h = Math.max(1, Math.round(pxW * hu / wu));
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        c.scale(w / wu, h / hu);
        d.draw(c);
        p.setShader(null);
        p.setStyle(Paint.Style.FILL);
        return b;
    }

    // ---------- 绘图小工具 ----------
    private void fill(int color) { p.setShader(null); p.setStyle(Paint.Style.FILL); p.setColor(color); }

    private void rr(Canvas c, float l, float t, float rt, float b, float rad, int color) {
        fill(color); r.set(l, t, rt, b); c.drawRoundRect(r, rad, rad, p);
    }

    private void oval(Canvas c, float l, float t, float rt, float b, int color) {
        fill(color); r.set(l, t, rt, b); c.drawOval(r, p);
    }

    private void circle(Canvas c, float x, float y, float rad, int color) {
        fill(color); c.drawCircle(x, y, rad, p);
    }

    private void line(Canvas c, int color, float w, float x1, float y1, float x2, float y2) {
        p.setShader(null);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeWidth(w);
        p.setColor(color);
        c.drawLine(x1, y1, x2, y2, p);
        p.setStyle(Paint.Style.FILL);
    }

    private void poly(Canvas c, int color, float... xy) {
        fill(color);
        path.reset();
        path.moveTo(xy[0], xy[1]);
        for (int i = 2; i < xy.length; i += 2) path.lineTo(xy[i], xy[i + 1]);
        path.close();
        c.drawPath(path, p);
    }

    private void hGrad(float l, float rt, int... colors) {
        p.setStyle(Paint.Style.FILL);
        p.setShader(new LinearGradient(l, 0, rt, 0, colors, null, Shader.TileMode.CLAMP));
    }

    private void radial(float x, float y, float rad, int inner, int outer) {
        p.setStyle(Paint.Style.FILL);
        p.setShader(new RadialGradient(x, y, rad, inner, outer, Shader.TileMode.CLAMP));
    }

    // ---------- 士兵（背影，朝上开枪） ----------
    private void drawSoldier(Canvas c, int f) {
        float a = new float[]{0, 6, 0, -6}[f];
        oval(c, 20, 98, 80, 116, 0x55000000);
        // 腿和靴子
        for (int s = -1; s <= 1; s += 2) {
            float x = 50 + s * 9, y = 72 + s * a;
            rr(c, x - 6, y, x + 6, y + 26, 5, 0xFF4B4636);
            rr(c, x - 7, y + 20, x + 7, y + 31, 4, 0xFF221C17);
        }
        // 身体
        hGrad(27, 73, 0xFF5E4728, 0xFFA3844F, 0xFF6E5530);
        r.set(27, 46, 73, 86);
        c.drawRoundRect(r, 12, 12, p);
        rr(c, 28, 76, 72, 82, 2, 0xFF3E2C22);
        rr(c, 46, 76, 54, 82, 1, 0xFFC9A227);
        // 背包
        rr(c, 35, 50, 65, 75, 6, 0xFF4F6B32);
        rr(c, 35, 57, 65, 60, 1, 0xFF3B5124);
        rr(c, 42, 64, 58, 73, 3, 0xFF2F3F1C);
        line(c, 0xFF3B5124, 3, 38, 50, 38, 46);
        line(c, 0xFF3B5124, 3, 62, 50, 62, 46);
        // 手臂
        line(c, 0xFF8A6D40, 11, 30, 54, 45, 31);
        line(c, 0xFF8A6D40, 11, 70, 54, 57, 34);
        // 步枪
        rr(c, 46, 6, 56, 46, 3, 0xFF2E3338);
        rr(c, 48.5f, 0, 53.5f, 10, 1, 0xFF111315);
        rr(c, 47, 14, 55, 18, 1, 0xFF56606A);
        rr(c, 55, 22, 62, 32, 2, 0xFF1C1F22);
        // 手套
        circle(c, 45, 31, 5, 0xFF3A2F25);
        circle(c, 57, 34, 5, 0xFF3A2F25);
        // 耳朵 + 金发后脑勺
        circle(c, 34.5f, 47, 3.8f, 0xFFF2C9A0);
        circle(c, 65.5f, 47, 3.8f, 0xFFF2C9A0);
        circle(c, 50, 45, 16, 0xFFD9A030);
        radial(45, 39, 17, 0xFFFFE590, 0xFFDFA535);
        c.drawCircle(50, 44, 15, p);
        line(c, 0xFFB98220, 1.6f, 44, 32, 41, 52);
        line(c, 0xFFB98220, 1.6f, 52, 31, 53, 54);
        line(c, 0xFFB98220, 1.6f, 59, 34, 61, 52);
        poly(c, 0xFFDFA535, 38, 54, 44, 50, 42, 60);
        poly(c, 0xFFDFA535, 62, 54, 56, 50, 58, 60);
    }

    // ---------- 僵尸（正面，朝玩家走来） ----------
    private void drawZombie(Canvas c, int f, int v) {
        float a = new float[]{0, 6, 0, -6}[f];
        int shirt = SHIRTS[v][0], shirtDark = SHIRTS[v][1];
        oval(c, 20, 98, 80, 116, 0x55000000);
        for (int s = -1; s <= 1; s += 2) {
            float x = 50 + s * 10, y = 70 + s * a;
            rr(c, x - 6.5f, y, x + 6.5f, y + 28, 5, 0xFF3D4A5C);
            rr(c, x - 7, y + 22, x + 7, y + 32, 4, 0xFF2A2A2A);
        }
        // 破烂上衣
        hGrad(28, 72, shirtDark, shirt, shirtDark);
        r.set(28, 46, 72, 84);
        c.drawRoundRect(r, 10, 10, p);
        poly(c, shirtDark, 30, 84, 36, 74, 41, 84);
        poly(c, shirtDark, 50, 84, 55, 72, 60, 84);
        poly(c, 0xFF2E2E2E, 44, 84, 47, 77, 50, 84);
        circle(c, 58, 62, 6, 0xAA7A0E0E);
        circle(c, 63, 69, 4, 0xAA7A0E0E);
        circle(c, 39, 70, 3, 0xAA7A0E0E);
        // 往前伸的手
        float sw = a * 0.6f;
        line(c, 0xFF6F9A40, 10, 31, 52, 23, 92 + sw);
        line(c, 0xFF6F9A40, 10, 69, 52, 77, 92 - sw);
        line(c, shirt, 12, 31, 52, 28, 66);
        line(c, shirt, 12, 69, 52, 72, 66);
        circle(c, 23, 94 + sw, 6.5f, 0xFF5E8533);
        circle(c, 77, 94 - sw, 6.5f, 0xFF5E8533);
        line(c, 0xFF3B2A1A, 1.5f, 20, 98 + sw, 19, 102 + sw);
        line(c, 0xFF3B2A1A, 1.5f, 26, 99 + sw, 26, 103 + sw);
        line(c, 0xFF3B2A1A, 1.5f, 74, 99 - sw, 74, 103 - sw);
        line(c, 0xFF3B2A1A, 1.5f, 80, 98 - sw, 81, 102 - sw);
        // 头
        circle(c, 50, 35, 20, 0xFF5E8533);
        radial(44, 28, 22, 0xFFB9DC72, 0xFF7FA644);
        c.drawCircle(50, 34, 19, p);
        if (v == 2) {
            // 头盔款（更耐打）
            fill(0xFF455A64);
            r.set(29, 13, 71, 55);
            c.drawArc(r, 180, 180, true, p);
            rr(c, 27, 31, 73, 36, 2, 0xFF263238);
            circle(c, 42, 22, 3, 0x55FFFFFF);
        } else {
            poly(c, 0xFF2E2A24, 34, 26, 40, 14, 44, 22, 50, 12, 55, 22, 62, 15, 66, 27, 58, 22, 50, 20, 42, 22);
        }
        // 眼睛
        circle(c, 42, 34, 5.5f, 0xFF2F3D1C);
        circle(c, 58, 34, 5.5f, 0xFF2F3D1C);
        circle(c, 42, 34, 5, 0x66FF1744);
        circle(c, 58, 34, 5, 0x66FF1744);
        circle(c, 42, 34, 3, 0xFFFF1744);
        circle(c, 58, 34, 3, 0xFFFF1744);
        circle(c, 42.5f, 33.5f, 1.1f, 0xFFFFCDD2);
        circle(c, 58.5f, 33.5f, 1.1f, 0xFFFFCDD2);
        // 嘴和牙
        rr(c, 41, 42, 59, 50, 3, 0xFF3B1212);
        for (int i = 0; i < 4; i++) rr(c, 43 + i * 4, 42, 45.5f + i * 4, 45.5f, 0.5f, 0xFFF5F0DC);
        rr(c, 53.5f, 49, 55.5f, 56, 1, 0xFF8B0000);
        // 伤疤缝线
        if (v != 2) {
            line(c, 0xFF3B2A1A, 1.4f, 55, 24, 62, 30);
            line(c, 0xFF3B2A1A, 1.2f, 57, 28, 59, 25);
            line(c, 0xFF3B2A1A, 1.2f, 59.5f, 30, 61.5f, 27);
        }
    }

    // ---------- Boss：巨型变异体 ----------
    private void drawBoss(Canvas c, int f) {
        float s = new float[]{0, 9, 0, -9}[f];
        float a = new float[]{0, 5, 0, -5}[f];
        oval(c, 25, 190, 175, 218, 0x66000000);
        // 腿
        rr(c, 60, 140 + a, 92, 196 + a, 12, 0xFF4A3B2E);
        rr(c, 108, 140 - a, 140, 196 - a, 12, 0xFF4A3B2E);
        rr(c, 56, 184 + a, 96, 204 + a, 8, 0xFF241A12);
        rr(c, 104, 184 - a, 144, 204 - a, 8, 0xFF241A12);
        // 手臂
        line(c, 0xFF4F6B35, 30, 42, 92, 26, 152 + s);
        line(c, 0xFF4F6B35, 30, 158, 92, 174, 152 - s);
        line(c, 0xFF6D8F48, 18, 40, 92, 27, 148 + s);
        line(c, 0xFF6D8F48, 18, 160, 92, 173, 148 - s);
        // 拳头 + 指虎尖刺
        circle(c, 24, 160 + s, 19, 0xFF3F5629);
        circle(c, 176, 160 - s, 19, 0xFF3F5629);
        circle(c, 21, 155 + s, 10, 0xFF5E7F3D);
        circle(c, 173, 155 - s, 10, 0xFF5E7F3D);
        for (int i = -1; i <= 1; i++) {
            poly(c, 0xFFCFD8DC, 24 + i * 9 - 3, 175 + s, 24 + i * 9 + 3, 175 + s, 24 + i * 9, 186 + s);
            poly(c, 0xFFCFD8DC, 176 + i * 9 - 3, 175 - s, 176 + i * 9 + 3, 175 - s, 176 + i * 9, 186 - s);
        }
        // 躯干
        radial(90, 95, 80, 0xFF8DB25F, 0xFF3F5A2A);
        r.set(42, 66, 158, 164);
        c.drawRoundRect(r, 34, 34, p);
        oval(c, 70, 104, 130, 158, 0xFF9DBB74);
        line(c, 0xFF3B2A1A, 2.5f, 78, 122, 124, 132);
        for (int i = 0; i < 6; i++) {
            float x = 82 + i * 7.5f, y = 123 + i * 1.6f;
            line(c, 0xFF3B2A1A, 2, x - 2, y - 5, x + 2, y + 5);
        }
        // 皮带斜挎
        line(c, 0xFF5D4037, 11, 56, 80, 142, 146);
        for (int i = 0; i < 5; i++) circle(c, 70 + i * 16, 91 + i * 12.5f, 2.5f, 0xFFB0BEC5);
        // 铁肩甲 + 尖刺
        for (int sd = -1; sd <= 1; sd += 2) {
            float x = 100 + sd * 54;
            radial(x - 6, 70, 30, 0xFFECEFF1, 0xFF455A64);
            c.drawCircle(x, 78, 26, p);
            poly(c, 0xFFB0BEC5, x - 6, 58, x + 6, 58, x + sd * 4, 34);
            poly(c, 0xFFB0BEC5, x + sd * 10, 64, x + sd * 20, 70, x + sd * 26, 48);
            circle(c, x - 8, 72, 3, 0xFF263238);
            circle(c, x + 8, 86, 3, 0xFF263238);
        }
        // 头
        poly(c, 0xFF3E2723, 78, 38, 64, 6, 88, 30);
        poly(c, 0xFF3E2723, 122, 38, 136, 6, 112, 30);
        radial(92, 40, 34, 0xFFA3C97A, 0xFF4F6B35);
        c.drawCircle(100, 50, 30, p);
        rr(c, 74, 36, 126, 46, 5, 0xFF3F5629);
        circle(c, 88, 48, 7, 0x88FFEA00);
        circle(c, 112, 48, 7, 0x88FFEA00);
        circle(c, 88, 48, 4, 0xFFFFEA00);
        circle(c, 112, 48, 4, 0xFFFFEA00);
        circle(c, 88, 48, 1.5f, 0xFFFFFFFF);
        circle(c, 112, 48, 1.5f, 0xFFFFFFFF);
        rr(c, 78, 60, 122, 80, 10, 0xFF3F5629);
        rr(c, 84, 64, 116, 72, 3, 0xFF2B1010);
        poly(c, 0xFFF5F0DC, 82, 70, 89, 70, 84, 52);
        poly(c, 0xFFF5F0DC, 118, 70, 111, 70, 116, 52);
        line(c, 0xFF2B1A10, 2.5f, 104, 28, 114, 40);
    }

    // ---------- 场景 ----------
    private void drawBuilding(Canvas c, int i) {
        Random rnd = new Random(i * 7919L + 13);
        int[] bases = {0xFF8C8C8C, 0xFF7D7468, 0xFF9A8F80, 0xFF6F7A80};
        int base = bases[i % bases.length];
        rr(c, 8, 10, 100, 140, 2, 0x44000000);              // 投影
        rr(c, 0, 0, 92, 102, 2, base);                      // 楼顶
        rr(c, 4, 4, 88, 98, 2, darker(base, 0.9f));
        rr(c, 0, 100, 92, 136, 1, darker(base, 0.65f));     // 正面墙
        for (int w = 0; w < 5; w++) {                       // 窗户
            float x = 6 + w * 17;
            boolean broken = rnd.nextInt(3) == 0;
            rr(c, x, 106, x + 11, 118, 1, broken ? 0xFF101417 : 0xFF2E3B44);
            rr(c, x, 122, x + 11, 132, 1, rnd.nextBoolean() ? 0xFF2E3B44 : 0xFF101417);
            if (!broken) rr(c, x + 1, 107, x + 4, 112, 0.5f, 0x55B3E5FC);
        }
        // 楼顶的空调、水箱
        for (int k = 0; k < 3; k++) {
            float x = 10 + rnd.nextFloat() * 60, y = 10 + rnd.nextFloat() * 70;
            rr(c, x, y, x + 14, y + 10, 1, 0xFFB0B0B0);
            rr(c, x + 2, y + 2, x + 12, y + 8, 1, 0xFF8A8A8A);
        }
        circle(c, 70, 26, 10, 0xFF6D6D6D);
        circle(c, 70, 26, 7, 0xFF5A5A5A);
        // 裂缝
        for (int k = 0; k < 3; k++) {
            float x = rnd.nextFloat() * 80, y = rnd.nextFloat() * 90;
            line(c, 0x66222222, 1.2f, x, y, x + rnd.nextFloat() * 20 - 10, y + 12);
            line(c, 0x66222222, 1, x + 4, y + 6, x + 12, y + 10);
        }
        // 碎石
        for (int k = 0; k < 14; k++) {
            circle(c, rnd.nextFloat() * 92, rnd.nextFloat() * 100, 1 + rnd.nextFloat() * 2, 0x66333333);
        }
        // 爬藤
        for (int k = 0; k < 9; k++) {
            float x = rnd.nextBoolean() ? rnd.nextFloat() * 18 : 74 + rnd.nextFloat() * 18;
            float y = rnd.nextFloat() * 130;
            circle(c, x, y, 5 + rnd.nextFloat() * 6, 0xFF4E7A30);
            circle(c, x - 2, y - 2, 3 + rnd.nextFloat() * 3, 0xFF6E9E45);
        }
    }

    private void drawTree(Canvas c, int i) {
        Random rnd = new Random(i * 104729L + 5);
        circle(c, 56, 58, 36, 0x44000000);
        int[] dark = {0xFF2F5A23, 0xFF35602A, 0xFF2A4F20};
        int[] light = {0xFF5C9440, 0xFF6BA34A, 0xFF4F8638};
        for (int k = 0; k < 7; k++) {
            float ang = (float) (k / 7.0 * Math.PI * 2);
            float x = 50 + (float) Math.cos(ang) * 18, y = 48 + (float) Math.sin(ang) * 18;
            circle(c, x, y, 18 + rnd.nextFloat() * 6, dark[i]);
        }
        circle(c, 50, 48, 26, dark[i]);
        for (int k = 0; k < 6; k++) {
            float x = 36 + rnd.nextFloat() * 24, y = 30 + rnd.nextFloat() * 24;
            circle(c, x, y, 7 + rnd.nextFloat() * 6, light[i]);
        }
        circle(c, 42, 36, 5, 0x40FFFFFF);
    }

    private void drawCorpse(Canvas c) {
        oval(c, 10, 10, 90, 54, 0x99375A1E);
        circle(c, 30, 20, 9, 0x88234015);
        circle(c, 72, 40, 7, 0x88234015);
        oval(c, 30, 20, 70, 44, 0xFF4E6B35);
        circle(c, 74, 30, 11, 0xFF6F9A40);
        circle(c, 77, 28, 2, 0xFF3B1212);
        circle(c, 20, 44, 5, 0xAA7A0E0E);
        circle(c, 52, 50, 4, 0xAA7A0E0E);
    }

    static int darker(int color, float k) {
        int a = color >>> 24;
        int rr = (int) (((color >> 16) & 0xFF) * k);
        int g = (int) (((color >> 8) & 0xFF) * k);
        int b = (int) ((color & 0xFF) * k);
        return (a << 24) | (rr << 16) | (g << 8) | b;
    }
}
