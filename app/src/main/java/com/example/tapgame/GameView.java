package com.example.tapgame;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LightingColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Iterator;
import java.util.Random;

/**
 * 数字门大作战：
 * - 左右拖动控制小队，小队自动向前射击
 * - 射击 "+/-" 数字门，每打中一发数字 +1；穿过门按数字增减士兵；"×" "÷" 门打不变
 * - 打爆「武器+1」桶火力升级，撞上没打爆的桶按剩余血量扣兵
 * - 僵尸碰到小队会消灭士兵；关底 Boss 冲到面前时，用兵数和它的剩余血量硬拼
 */
final class GameView extends View {
    private enum State { MENU, PLAYING, WIN, LOSE }

    private static final int G_ADD = 0, G_MUL = 1, G_DIV = 2;
    private static final int MAX_SOLDIERS = 999;
    private static final int MAX_DRAWN_SOLDIERS = 40;

    static final class Gate { float y, flash; boolean left, used; int type, value; }
    static final class Barrel { float y, flash; boolean left, dead, used; int hp; }
    static final class Zombie { float x, y, phase, flash; int hp, variant; }
    static final class Bullet { float x, y; }
    static final class Particle { float x, y, vx, vy, life, max, size; int color; }
    static final class FloatText { String s; float x, y, life; int color; }
    static final class Deco { float x, y; Bitmap bmp; }
    static final class Corpse { float x, y, life; }

    private static final Comparator<Zombie> BY_Y = (a, b) -> Float.compare(a.y, b.y);

    private final ArrayList<Gate> gates = new ArrayList<>();
    private final ArrayList<Barrel> barrels = new ArrayList<>();
    private final ArrayList<Zombie> zombies = new ArrayList<>();
    private final ArrayList<Bullet> bullets = new ArrayList<>();
    private final ArrayList<Particle> particles = new ArrayList<>();
    private final ArrayList<FloatText> texts = new ArrayList<>();
    private final ArrayList<Deco> decos = new ArrayList<>();
    private final ArrayList<Corpse> corpses = new ArrayList<>();

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bmpPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint flashPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint fadePaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final RectF rect = new RectF();
    private final Path path = new Path();
    private final Random rnd = new Random();
    private final SharedPreferences prefs;
    private final float dp;
    private final Sprites sp;

    private Bitmap roadTile, grassTile;
    private float tileH;

    private State state = State.MENU;
    private int level = 1, bestLevel;
    private int soldiers, weapon;
    private float squadX, lastTouchX;
    private float fireTimer, muzzle, shake, animTime, worldScroll;
    private float decoGapL, decoGapR;
    private long lastFrame;
    private final float[] streamX = new float[16];
    private int streamCount;

    private boolean bossAlive;
    private float bossY, bossStartY, bossFlash;
    private int bossHp, bossMaxHp;

    GameView(Context context) {
        super(context);
        dp = getResources().getDisplayMetrics().density;
        sp = new Sprites(dp);
        prefs = context.getSharedPreferences("numbergate", Context.MODE_PRIVATE);
        bestLevel = prefs.getInt("bestLevel", 1);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        flashPaint.setColorFilter(new LightingColorFilter(0xFFFFFF, 0x909090));
        lastFrame = System.nanoTime();
    }

    // ---------- 布局 ----------
    private float W() { return getWidth(); }
    private float H() { return getHeight(); }
    private float roadL() { return W() * 0.15f; }
    private float roadR() { return W() * 0.85f; }
    private float mid() { return W() / 2f; }
    private float playerY() { return H() * 0.78f; }
    private float gateH() { return 62 * dp; }
    private float spacing() { return 15 * dp; }
    private float laneLeft(boolean left) { return left ? roadL() : mid() + 3 * dp; }
    private float laneRight(boolean left) { return left ? mid() - 3 * dp : roadR(); }

    private int squadCols() {
        int n = Math.max(1, Math.min(soldiers, MAX_DRAWN_SOLDIERS));
        return Math.max(1, Math.min(7, (int) Math.ceil(Math.sqrt(n * 1.3))));
    }

    private float squadHalfW() { return squadCols() * spacing() / 2f + 8 * dp; }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        if (w <= 0 || h <= 0) return;
        buildTiles();
        decos.clear();
        decoGapL = decoGapR = 0;
        for (int i = 0; i < 300; i++) updateDecos(h / 150f);
        if (state == State.MENU) squadX = mid();
    }

    // ---------- 地面纹理（可无缝滚动） ----------
    private void buildTiles() {
        tileH = Math.round(300 * dp);
        int th = (int) tileH;
        int rw = Math.max(1, Math.round(roadR() - roadL()));
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        Random r = new Random(42);

        roadTile = Bitmap.createBitmap(rw, th, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(roadTile);
        c.drawColor(0xFF6F665B);
        for (int i = 0; i < 16; i++) {
            p.setColor(r.nextBoolean() ? 0x1A000000 : 0x12FFFFFF);
            wrapCircle(c, r.nextFloat() * rw, r.nextFloat() * th, (20 + r.nextFloat() * 50) * dp, p, th);
        }
        for (int i = 0; i < 1100; i++) {
            p.setColor(r.nextBoolean() ? 0x26000000 : 0x1CFFFFFF);
            wrapCircle(c, r.nextFloat() * rw, r.nextFloat() * th, (0.5f + r.nextFloat()) * dp, p, th);
        }
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1.3f * dp);
        p.setColor(0x60302A22);
        for (int i = 0; i < 7; i++) {
            Path crack = new Path();
            float x = r.nextFloat() * rw, y = r.nextFloat() * th;
            crack.moveTo(x, y);
            for (int k = 0; k < 6; k++) {
                x += (r.nextFloat() - 0.5f) * 30 * dp;
                y += r.nextFloat() * 14 * dp;
                crack.lineTo(x, y);
            }
            for (int k = -1; k <= 1; k++) {
                c.save();
                c.translate(0, k * th);
                c.drawPath(crack, p);
                c.restore();
            }
        }
        p.setStyle(Paint.Style.FILL);
        p.setColor(0x90E8D9A0);
        for (float y = 0; y < th; y += 60 * dp) c.drawRect(rw / 2f - 2 * dp, y, rw / 2f + 2 * dp, y + 30 * dp, p);
        p.setColor(0x50000000);
        c.drawRect(0, 0, 7 * dp, th, p);
        c.drawRect(rw - 7 * dp, 0, rw, th, p);

        int gw = Math.max(1, (int) W());
        grassTile = Bitmap.createBitmap(gw, th, Bitmap.Config.ARGB_8888);
        c = new Canvas(grassTile);
        c.drawColor(0xFF4C7A33);
        for (int i = 0; i < 40; i++) {
            p.setColor(r.nextBoolean() ? 0x30203A10 : 0x2090C060);
            wrapCircle(c, r.nextFloat() * gw, r.nextFloat() * th, (10 + r.nextFloat() * 35) * dp, p, th);
        }
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeWidth(1.4f * dp);
        for (int i = 0; i < 900; i++) {
            p.setColor(r.nextBoolean() ? 0xFF5E9440 : 0xFF3E6A28);
            float x = r.nextFloat() * gw, y = 6 * dp + r.nextFloat() * (th - 12 * dp);
            c.drawLine(x, y, x + (r.nextFloat() - 0.5f) * 4 * dp, y - 5 * dp, p);
        }
        for (int i = 0; i < 40; i++) {
            p.setColor(r.nextBoolean() ? 0xFFFFF59D : 0xFFF5F5F5);
            wrapCircle(c, r.nextFloat() * gw, r.nextFloat() * th, 1.6f * dp, p, th);
        }
    }

    private static void wrapCircle(Canvas c, float x, float y, float rad, Paint p, float th) {
        c.drawCircle(x, y, rad, p);
        if (y - rad < 0) c.drawCircle(x, y + th, rad, p);
        if (y + rad > th) c.drawCircle(x, y - th, rad, p);
    }

    // ---------- 场景装饰 ----------
    private void updateDecos(float move) {
        for (Iterator<Deco> it = decos.iterator(); it.hasNext(); ) {
            Deco d = it.next();
            d.y += move;
            if (d.y > H()) it.remove();
        }
        decoGapL -= move;
        decoGapR -= move;
        if (decoGapL <= 0) spawnDeco(true);
        if (decoGapR <= 0) spawnDeco(false);
    }

    private void spawnDeco(boolean left) {
        Deco d = new Deco();
        boolean building = rnd.nextFloat() < 0.6f;
        d.bmp = building ? sp.buildings[rnd.nextInt(sp.buildings.length)] : sp.trees[rnd.nextInt(sp.trees.length)];
        float bw = d.bmp.getWidth();
        if (left) {
            d.x = building ? roadL() - 14 * dp - bw + rnd.nextFloat() * 8 * dp
                    : rnd.nextFloat() * Math.max(1, roadL() - bw * 0.6f) - bw * 0.35f;
        } else {
            d.x = building ? roadR() + 14 * dp - rnd.nextFloat() * 8 * dp
                    : roadR() + 6 * dp + rnd.nextFloat() * Math.max(1, W() - roadR() - bw * 0.4f);
        }
        d.y = -d.bmp.getHeight();
        decos.add(d);
        float gap = d.bmp.getHeight() * (0.75f + rnd.nextFloat() * 0.5f);
        if (left) decoGapL = gap; else decoGapR = gap;
    }

    // ---------- 关卡生成 ----------
    private void startLevel(int lv) {
        level = lv;
        soldiers = 5;
        weapon = 1;
        squadX = mid();
        fireTimer = 0;
        gates.clear(); barrels.clear(); zombies.clear(); bullets.clear();
        texts.clear(); particles.clear(); corpses.clear();

        float gap = H() * 0.42f;
        float y = -H() * 0.1f;
        int rows = 8 + lv * 2;
        for (int i = 0; i < rows; i++) {
            int pick = i % 3 == 0 ? 0 : rnd.nextInt(3);
            if (pick == 0) addGatePair(y, lv);
            else if (pick == 1) addZombies(y, lv);
            else addBarrelRow(y, lv);
            y -= gap;
        }
        bossAlive = true;
        bossStartY = bossY = y - gap * 0.3f;
        bossMaxHp = bossHp = 60 + lv * 45;
        state = State.PLAYING;
    }

    private void addGatePair(float y, int lv) {
        boolean goodLeft = rnd.nextBoolean();
        Gate a = new Gate(), b = new Gate();
        a.y = b.y = y;
        a.left = goodLeft;
        b.left = !goodLeft;
        int r = rnd.nextInt(100);
        if (r < 18) {
            a.type = G_MUL; a.value = lv >= 3 && rnd.nextBoolean() ? 3 : 2;
            b.type = G_ADD; b.value = -(4 + rnd.nextInt(4 + lv));
        } else if (r < 28) {
            a.type = G_ADD; a.value = 1 + rnd.nextInt(3);
            b.type = G_DIV; b.value = 2;
        } else if (r < 55) {
            a.type = G_ADD; a.value = -(2 + rnd.nextInt(4));
            b.type = G_ADD; b.value = -(6 + rnd.nextInt(6 + lv));
        } else {
            a.type = G_ADD; a.value = 2 + rnd.nextInt(5 + lv);
            b.type = G_ADD; b.value = -(3 + rnd.nextInt(6 + lv * 2));
        }
        gates.add(a);
        gates.add(b);
    }

    private void addZombies(float y, int lv) {
        int n = 6 + lv * 3 + rnd.nextInt(6);
        float l = roadL() + 16 * dp, rr = roadR() - 16 * dp;
        int lane = rnd.nextInt(3);
        if (lane == 0) rr = mid() - 10 * dp;
        if (lane == 1) l = mid() + 10 * dp;
        for (int i = 0; i < n; i++) {
            Zombie z = new Zombie();
            z.x = l + rnd.nextFloat() * (rr - l);
            z.y = y + rnd.nextFloat() * 120 * dp - 60 * dp;
            boolean armored = lv >= 2 && rnd.nextInt(4) == 0;
            z.hp = 1 + lv / 3 + (armored ? 2 : 0);
            z.variant = armored ? 2 : rnd.nextInt(2);
            z.phase = rnd.nextFloat() * 4;
            zombies.add(z);
        }
    }

    private void addBarrelRow(float y, int lv) {
        Barrel b = new Barrel();
        b.y = y;
        b.left = rnd.nextBoolean();
        b.hp = 8 + rnd.nextInt(6) + lv * 4;
        barrels.add(b);
        if (rnd.nextBoolean()) {
            Gate g = new Gate();
            g.y = y;
            g.left = !b.left;
            g.type = G_ADD;
            g.value = rnd.nextBoolean() ? 1 + rnd.nextInt(4) : -(2 + rnd.nextInt(4 + lv));
            gates.add(g);
        }
    }

    // ---------- 特效 ----------
    private void burst(float x, float y, int n, int color, float speed, float size) {
        for (int i = 0; i < n; i++) {
            Particle p = new Particle();
            double ang = rnd.nextDouble() * Math.PI * 2;
            float v = speed * dp * (0.3f + rnd.nextFloat());
            p.x = x; p.y = y;
            p.vx = (float) Math.cos(ang) * v;
            p.vy = (float) Math.sin(ang) * v;
            p.max = p.life = 0.35f + rnd.nextFloat() * 0.35f;
            p.size = size * dp * (0.6f + rnd.nextFloat() * 0.6f);
            p.color = color;
            particles.add(p);
        }
    }

    private void addText(String s, float x, float y, int color) {
        FloatText t = new FloatText();
        t.s = s; t.x = x; t.y = y; t.life = 1.1f; t.color = color;
        texts.add(t);
    }

    private void setSoldiers(int n) { soldiers = Math.max(0, Math.min(MAX_SOLDIERS, n)); }

    private void hurt(int amount, float x, float y) {
        if (amount <= 0) return;
        setSoldiers(soldiers - amount);
        burst(x, y, Math.min(20, 3 + amount), 0xFFE53935, 120, 3);
        shake = Math.max(shake, Math.min(10, 3 + amount * 0.5f) * dp);
    }

    // ---------- 逻辑 ----------
    private void update(float dt) {
        float speed = H() * 0.22f * (1 + 0.04f * level);
        float move = speed * dt;
        worldScroll += move;
        updateDecos(move);

        float halfW = squadHalfW();
        squadX = Math.max(roadL() + halfW, Math.min(roadR() - halfW, squadX));
        boolean inLeft = squadX < mid();
        float py = playerY();

        // 开火
        fireTimer -= dt;
        if (fireTimer <= 0 && soldiers > 0) {
            fireTimer = 0.11f;
            muzzle = 0.06f;
            streamCount = Math.min(Math.min(weapon + 1, streamX.length), Math.max(1, soldiers));
            float span = Math.min(halfW * 1.6f, streamCount * 11 * dp);
            for (int i = 0; i < streamCount; i++) {
                Bullet b = new Bullet();
                b.x = streamCount == 1 ? squadX : squadX - span / 2 + span * i / (streamCount - 1);
                b.y = py - 30 * dp;
                streamX[i] = b.x;
                bullets.add(b);
            }
        }

        for (Gate g : gates) { g.y += move; g.flash = Math.max(0, g.flash - dt * 5); }
        for (Barrel b : barrels) { b.y += move; b.flash = Math.max(0, b.flash - dt * 6); }
        for (Zombie z : zombies) {
            z.y += move + H() * 0.05f * dt;
            z.phase += dt * 7;
            z.flash = Math.max(0, z.flash - dt * 8);
        }
        for (Corpse c : corpses) { c.y += move; c.life -= dt * 0.5f; }
        if (bossAlive) {
            bossY += bossY < H() * 0.25f ? move : move * 0.35f;
            bossFlash = Math.max(0, bossFlash - dt * 8);
        }

        // 子弹命中
        float bulletMove = H() * 1.5f * dt;
        float zr = 11 * dp, bossR = 52 * dp, gh = gateH() / 2;
        Iterator<Bullet> bi = bullets.iterator();
        outer:
        while (bi.hasNext()) {
            Bullet b = bi.next();
            b.y -= bulletMove;
            if (b.y < 0) { bi.remove(); continue; }

            if (bossAlive && Math.abs(b.x - mid()) < bossR && Math.abs(b.y - bossY) < bossR) {
                bossHp--;
                bossFlash = 1;
                bi.remove();
                burst(b.x, b.y, 2, 0xFF9CCC65, 90, 3);
                if (bossHp <= 0) {
                    bossAlive = false;
                    burst(mid(), bossY, 50, 0xFF7CB342, 260, 5);
                    burst(mid(), bossY, 30, 0xFFFFB300, 220, 4);
                    shake = 14 * dp;
                    addText("BOSS 击败！", mid(), bossY, 0xFFFFD54F);
                    winLevel();
                    return;
                }
                continue;
            }
            for (Iterator<Zombie> zi = zombies.iterator(); zi.hasNext(); ) {
                Zombie z = zi.next();
                float dx = b.x - z.x, dy = b.y - z.y;
                if (dx * dx + dy * dy < zr * zr * 1.4f) {
                    z.flash = 1;
                    bi.remove();
                    if (--z.hp <= 0) {
                        zi.remove();
                        burst(z.x, z.y, 9, 0xFF7CB342, 140, 3.2f);
                        burst(z.x, z.y, 4, 0xFF8B0000, 100, 2.6f);
                        Corpse c = new Corpse();
                        c.x = z.x; c.y = z.y; c.life = 1;
                        corpses.add(c);
                    } else {
                        burst(b.x, b.y, 2, z.variant == 2 ? 0xFFCFD8DC : 0xFF9CCC65, 80, 2.4f);
                    }
                    continue outer;
                }
            }
            for (Barrel br : barrels) {
                if (br.dead || br.y < 0) continue;
                if (b.x > laneLeft(br.left) + 14 * dp && b.x < laneRight(br.left) - 14 * dp && Math.abs(b.y - br.y) < gh) {
                    br.flash = 1;
                    bi.remove();
                    burst(b.x, br.y + gh * 0.6f, 2, 0xFFFFB74D, 110, 2.4f);
                    if (--br.hp <= 0) {
                        br.dead = true;
                        weapon = Math.min(8, weapon + 1);
                        float cx = (laneLeft(br.left) + laneRight(br.left)) / 2;
                        burst(cx, br.y, 30, 0xFFFF7043, 260, 5);
                        burst(cx, br.y, 20, 0xFFFFEB3B, 200, 3.5f);
                        burst(cx, br.y, 12, 0xFF616161, 140, 6);
                        shake = Math.max(shake, 7 * dp);
                        addText("火力升级！", cx, br.y, 0xFFFFB300);
                    }
                    continue outer;
                }
            }
            for (Gate g : gates) {
                if (g.used || g.y < 0) continue;
                if (b.x > laneLeft(g.left) && b.x < laneRight(g.left) && Math.abs(b.y - g.y) < gh) {
                    if (g.type == G_ADD && g.value < 99) { g.value++; g.flash = 1; }
                    bi.remove();
                    burst(b.x, g.y + gh * 0.8f, 1, 0xFFFFFFFF, 80, 2);
                    continue outer;
                }
            }
        }

        // 穿过门 / 撞桶
        for (Gate g : gates) {
            if (g.used || g.y < py) continue;
            g.used = true;
            if (g.left != inLeft) continue;
            int before = soldiers;
            if (g.type == G_ADD) setSoldiers(soldiers + g.value);
            else if (g.type == G_MUL) setSoldiers(soldiers * g.value);
            else setSoldiers((soldiers + 1) / g.value);
            int diff = soldiers - before;
            addText((diff >= 0 ? "+" : "") + diff, squadX, py - 64 * dp, diff >= 0 ? 0xFF69F0AE : 0xFFFF5252);
            if (diff < 0) {
                burst(squadX, py, Math.min(24, -diff + 3), 0xFFE53935, 140, 3);
                shake = Math.max(shake, 5 * dp);
            } else {
                burst(squadX, py, 14, 0xFF64B5F6, 160, 3);
            }
        }
        for (Barrel br : barrels) {
            if (br.used || br.y < py) continue;
            br.used = true;
            if (!br.dead && br.left == inLeft) {
                addText("-" + br.hp, squadX, py - 64 * dp, 0xFFFF5252);
                hurt(br.hp, squadX, py);
                br.dead = true;
            }
        }

        // 僵尸接触
        for (Iterator<Zombie> zi = zombies.iterator(); zi.hasNext(); ) {
            Zombie z = zi.next();
            if (z.y > H() + 40 * dp) { zi.remove(); continue; }
            if (z.y > py - 14 * dp && z.y < py + 60 * dp && Math.abs(z.x - squadX) < halfW + zr * 0.6f) {
                zi.remove();
                hurt(1, z.x, z.y);
            }
        }

        // Boss 硬拼
        if (bossAlive && bossY + bossR * 0.8f > py) {
            bossAlive = false;
            int hp = bossHp;
            hurt(hp, squadX, py);
            burst(mid(), bossY, 40, 0xFF7CB342, 240, 5);
            shake = 14 * dp;
            if (soldiers > 0) {
                addText("硬拼成功！", mid(), py - 80 * dp, 0xFFFFD54F);
                winLevel();
                return;
            }
        }

        float limit = H() + 80 * dp;
        for (Iterator<Gate> it = gates.iterator(); it.hasNext(); ) if (it.next().y > limit) it.remove();
        for (Iterator<Barrel> it = barrels.iterator(); it.hasNext(); ) if (it.next().y > limit) it.remove();
        for (Iterator<Corpse> it = corpses.iterator(); it.hasNext(); ) {
            Corpse c = it.next();
            if (c.life <= 0 || c.y > limit) it.remove();
        }

        if (soldiers <= 0) {
            state = State.LOSE;
            shake = 12 * dp;
        }
    }

    private void updateEffects(float dt) {
        animTime += dt;
        muzzle = Math.max(0, muzzle - dt);
        shake = Math.max(0, shake - 30 * dp * dt);
        for (Iterator<Particle> it = particles.iterator(); it.hasNext(); ) {
            Particle p = it.next();
            p.life -= dt;
            if (p.life <= 0) { it.remove(); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= 0.92f;
            p.vy *= 0.92f;
        }
        for (Iterator<FloatText> it = texts.iterator(); it.hasNext(); ) {
            FloatText t = it.next();
            t.life -= dt;
            t.y -= 45 * dp * dt;
            if (t.life <= 0) it.remove();
        }
    }

    private void winLevel() {
        state = State.WIN;
        if (level + 1 > bestLevel) {
            bestLevel = level + 1;
            prefs.edit().putInt("bestLevel", bestLevel).apply();
        }
    }

    // ---------- 输入 ----------
    @Override
    public boolean onTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                lastTouchX = e.getX();
                if (state == State.MENU) startLevel(bestLevel);
                else if (state == State.WIN) startLevel(level + 1);
                else if (state == State.LOSE) startLevel(level);
                break;
            case MotionEvent.ACTION_MOVE:
                if (state == State.PLAYING) squadX += (e.getX() - lastTouchX) * 1.3f;
                lastTouchX = e.getX();
                break;
        }
        return true;
    }

    // ---------- 绘制 ----------
    @Override
    protected void onDraw(Canvas c) {
        long now = System.nanoTime();
        float dt = Math.min(0.05f, (now - lastFrame) / 1e9f);
        lastFrame = now;
        if (getWidth() == 0 || roadTile == null) { postInvalidateOnAnimation(); return; }

        if (state == State.PLAYING) {
            update(dt);
        } else {
            float move = H() * 0.08f * dt;
            worldScroll += move;
            updateDecos(move);
        }
        updateEffects(dt);

        c.save();
        if (shake > 0) c.translate((rnd.nextFloat() - 0.5f) * 2 * shake, (rnd.nextFloat() - 0.5f) * 2 * shake);
        drawWorld(c);
        c.restore();

        if (state == State.PLAYING) drawHud(c);
        else drawOverlay(c);
        postInvalidateOnAnimation();
    }

    private void drawTiled(Canvas c, Bitmap tile, float x) {
        float off = worldScroll % tileH;
        for (float y = off - tileH; y < H(); y += tileH) c.drawBitmap(tile, x, y, bmpPaint);
    }

    private void drawWorld(Canvas c) {
        drawTiled(c, grassTile, 0);
        for (Deco d : decos) c.drawBitmap(d.bmp, d.x, d.y, bmpPaint);
        drawTiled(c, roadTile, roadL());
        drawRails(c);
        if (state == State.MENU) return;

        for (Corpse cp : corpses) {
            fadePaint.setAlpha((int) (Math.max(0, Math.min(1, cp.life)) * 220));
            Bitmap b = sp.corpse;
            c.drawBitmap(b, cp.x - b.getWidth() / 2f, cp.y - b.getHeight() / 2f, fadePaint);
        }
        for (Barrel b : barrels) drawBarrel(c, b);
        for (Gate g : gates) drawGate(c, g);

        Collections.sort(zombies, BY_Y);
        for (Zombie z : zombies) {
            if (z.y < -40 * dp || z.y > H() + 40 * dp) continue;
            Bitmap b = sp.zombie[z.variant][((int) z.phase) & 3];
            c.drawBitmap(b, z.x - b.getWidth() / 2f, z.y - b.getHeight() * 0.62f, z.flash > 0 ? flashPaint : bmpPaint);
        }
        if (bossAlive && bossY > -120 * dp) drawBoss(c);

        // 子弹
        for (Bullet b : bullets) {
            paint.setColor(0x55FFC107);
            rect.set(b.x - 3 * dp, b.y - 10 * dp, b.x + 3 * dp, b.y + 4 * dp);
            c.drawRoundRect(rect, 3 * dp, 3 * dp, paint);
            paint.setColor(0xFFFFFDE7);
            rect.set(b.x - 1.2f * dp, b.y - 9 * dp, b.x + 1.2f * dp, b.y + 2 * dp);
            c.drawRoundRect(rect, dp, dp, paint);
        }
        if (soldiers > 0 && state != State.LOSE) drawSquad(c);

        for (Particle p : particles) {
            float k = p.life / p.max;
            paint.setColor((p.color & 0x00FFFFFF) | ((int) (k * 255) << 24));
            c.drawCircle(p.x, p.y, p.size * (0.5f + k * 0.5f), paint);
        }
        for (FloatText t : texts) {
            float k = Math.min(1, t.life);
            float pop = 1 + Math.max(0, t.life - 0.9f) * 2;
            outlined(c, t.s, t.x, t.y, 28 * dp * pop, (t.color & 0x00FFFFFF) | ((int) (k * 255) << 24),
                    ((int) (k * 230) << 24), null);
        }
    }

    private void drawRails(Canvas c) {
        float off = worldScroll % (48 * dp);
        for (int s = 0; s < 2; s++) {
            float x0 = s == 0 ? roadL() - 8 * dp : roadR() + 2 * dp;
            paint.setColor(0xFF78909C);
            c.drawRect(x0, 0, x0 + 6 * dp, H(), paint);
            paint.setColor(0xFFCFD8DC);
            c.drawRect(x0 + 1.5f * dp, 0, x0 + 3 * dp, H(), paint);
            paint.setColor(0xFF455A64);
            for (float y = off - 48 * dp; y < H(); y += 48 * dp) {
                c.drawRect(x0 - 2 * dp, y, x0 + 8 * dp, y + 7 * dp, paint);
            }
        }
    }

    private void drawGate(Canvas c, Gate g) {
        float gh = gateH() / 2;
        if (g.y < -gh * 2 || g.y > H() + gh) return;
        float l = laneLeft(g.left), r = laneRight(g.left);
        float top = g.y - gh, bot = g.y + gh;
        boolean good = g.type == G_MUL || (g.type == G_ADD && g.value > 0);
        int light = good ? 0xFF64B5F6 : 0xFFEF5350;
        int deep = good ? 0xFF0D47A1 : 0xFFB71C1C;
        int alpha = g.used ? 0x50 : 0xC8;

        // 地面投影
        paint.setColor(0x33000000);
        c.drawRect(l + 10 * dp, bot - 4 * dp, r - 6 * dp, bot + 6 * dp, paint);
        // 能量面板
        paint.setShader(new LinearGradient(0, top, 0, bot,
                (light & 0x00FFFFFF) | (alpha << 24), (deep & 0x00FFFFFF) | (alpha << 24), Shader.TileMode.CLAMP));
        rect.set(l + 9 * dp, top + 8 * dp, r - 9 * dp, bot);
        c.drawRoundRect(rect, 6 * dp, 6 * dp, paint);
        paint.setShader(null);
        paint.setColor(0x40FFFFFF);
        c.drawRect(l + 9 * dp, top + 8 * dp, r - 9 * dp, top + 15 * dp, paint);
        for (float x = l + 20 * dp; x < r - 14 * dp; x += 16 * dp) {
            paint.setColor(0x18FFFFFF);
            c.drawRect(x, top + 15 * dp, x + 6 * dp, bot, paint);
        }
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2 * dp);
        paint.setColor((0xFFFFFF) | ((g.used ? 0x40 : 0xA0) << 24));
        c.drawRoundRect(rect, 6 * dp, 6 * dp, paint);
        paint.setStyle(Paint.Style.FILL);
        if (g.flash > 0) {
            paint.setColor(Color.argb((int) (g.flash * 110), 255, 255, 255));
            c.drawRoundRect(rect, 6 * dp, 6 * dp, paint);
        }
        // 金属立柱 + 顶灯
        for (int s = 0; s < 2; s++) {
            float px = s == 0 ? l + 2 * dp : r - 10 * dp;
            paint.setShader(new LinearGradient(px, 0, px + 8 * dp, 0,
                    new int[]{0xFF37474F, 0xFFB0BEC5, 0xFF37474F}, null, Shader.TileMode.CLAMP));
            rect.set(px, top - 6 * dp, px + 8 * dp, bot + 2 * dp);
            c.drawRoundRect(rect, 2 * dp, 2 * dp, paint);
            paint.setShader(null);
            paint.setColor((light & 0x00FFFFFF) | 0x66000000);
            c.drawCircle(px + 4 * dp, top - 8 * dp, 8 * dp, paint);
            paint.setColor(g.used ? 0xFF607D8B : light);
            c.drawCircle(px + 4 * dp, top - 8 * dp, 4.5f * dp, paint);
        }
        String label;
        if (g.type == G_MUL) label = "×" + g.value;
        else if (g.type == G_DIV) label = "÷" + g.value;
        else label = (g.value > 0 ? "+" : "") + g.value;
        float size = 32 * dp * (1 + g.flash * 0.18f);
        outlined(c, label, (l + r) / 2, g.y + 14 * dp, size, g.used ? 0x99FFFFFF : 0xFFFFFFFF,
                g.used ? 0x55000000 : (deep | 0xFF000000), null);
    }

    private void drawBarrel(Canvas c, Barrel b) {
        if (b.dead || b.y < -80 * dp || b.y > H() + 60 * dp) return;
        float cx = (laneLeft(b.left) + laneRight(b.left)) / 2;
        float bw = Math.min(laneRight(b.left) - laneLeft(b.left) - 30 * dp, 96 * dp);
        float l = cx - bw / 2, r = cx + bw / 2, top = b.y - 36 * dp, bot = b.y + 30 * dp;

        paint.setColor(0x44000000);
        rect.set(l - 4 * dp, bot - 8 * dp, r + 10 * dp, bot + 8 * dp);
        c.drawOval(rect, paint);
        paint.setShader(new LinearGradient(l, 0, r, 0,
                new int[]{0xFF6D0000, 0xFFD32F2F, 0xFFFF8A80, 0xFFC62828, 0xFF6D0000},
                new float[]{0, 0.28f, 0.42f, 0.7f, 1}, Shader.TileMode.CLAMP));
        rect.set(l, top + 6 * dp, r, bot);
        c.drawRoundRect(rect, 8 * dp, 8 * dp, paint);
        paint.setShader(null);
        paint.setColor(0xFFE57373);
        rect.set(l, top, r, top + 13 * dp);
        c.drawOval(rect, paint);
        paint.setColor(0xFF8E1B1B);
        rect.set(l + 6 * dp, top + 3 * dp, r - 6 * dp, top + 10 * dp);
        c.drawOval(rect, paint);
        paint.setColor(0xFF4A0A0A);
        c.drawRect(l, top + 20 * dp, r, top + 24 * dp, paint);
        c.drawRect(l, bot - 14 * dp, r, bot - 10 * dp, paint);
        if (b.flash > 0) {
            paint.setColor(Color.argb((int) (b.flash * 120), 255, 255, 255));
            rect.set(l, top, r, bot);
            c.drawRoundRect(rect, 8 * dp, 8 * dp, paint);
        }
        // 枪械图标
        float gy = b.y + 2 * dp;
        paint.setColor(0xFFFFD54F);
        c.drawRect(cx - 18 * dp, gy - 3 * dp, cx + 14 * dp, gy + 3 * dp, paint);
        c.drawRect(cx + 14 * dp, gy - 1.5f * dp, cx + 22 * dp, gy + 1.5f * dp, paint);
        c.drawRect(cx - 24 * dp, gy - 2 * dp, cx - 16 * dp, gy + 6 * dp, paint);
        c.drawRect(cx - 2 * dp, gy + 3 * dp, cx + 4 * dp, gy + 10 * dp, paint);
        outlined(c, "武器+1", cx, top + 34 * dp, 14 * dp, 0xFFFFE082, 0xFF4A0A0A, null);
        outlined(c, String.valueOf(b.hp), cx, bot - 16 * dp + 20 * dp, 22 * dp, 0xFFFFFFFF, 0xFF4A0A0A, null);
    }

    private void drawBoss(Canvas c) {
        Bitmap b = sp.boss[((int) (animTime * 5)) & 3];
        float bob = (float) Math.sin(animTime * 10) * 2 * dp;
        c.drawBitmap(b, mid() - b.getWidth() / 2f, bossY - b.getHeight() * 0.55f + bob,
                bossFlash > 0 ? flashPaint : bmpPaint);
        float bw = 150 * dp, top = bossY - b.getHeight() * 0.55f - 22 * dp;
        paint.setColor(0xCC000000);
        rect.set(mid() - bw / 2 - 3 * dp, top - 3 * dp, mid() + bw / 2 + 3 * dp, top + 13 * dp);
        c.drawRoundRect(rect, 8 * dp, 8 * dp, paint);
        float k = bossHp / (float) bossMaxHp;
        paint.setShader(new LinearGradient(0, top, 0, top + 10 * dp, 0xFFFF8A80, 0xFFC62828, Shader.TileMode.CLAMP));
        rect.set(mid() - bw / 2, top, mid() - bw / 2 + bw * k, top + 10 * dp);
        c.drawRoundRect(rect, 5 * dp, 5 * dp, paint);
        paint.setShader(null);
        outlined(c, "变异屠夫  " + bossHp, mid(), top - 8 * dp, 18 * dp, 0xFFFFFFFF, 0xFF4A0000, null);
    }

    private void drawSquad(Canvas c) {
        int n = Math.min(soldiers, MAX_DRAWN_SOLDIERS);
        int cols = squadCols();
        float s = spacing(), py = playerY();
        for (int i = 0; i < n; i++) {
            int row = i / cols, col = i % cols;
            float x = squadX + (col - (cols - 1) / 2f) * s + ((row & 1) == 1 ? s * 0.3f : 0);
            float y = py + row * s * 0.75f;
            Bitmap b = sp.soldier[((int) (animTime * 9) + i) & 3];
            c.drawBitmap(b, x - b.getWidth() / 2f, y - b.getHeight() * 0.85f, bmpPaint);
        }
        if (muzzle > 0) {
            for (int i = 0; i < streamCount; i++) {
                float x = streamX[i], y = py - 31 * dp;
                paint.setColor(0x88FFB300);
                c.drawCircle(x, y, 7 * dp, paint);
                paint.setColor(0xFFFFFDE7);
                c.drawCircle(x, y, 3.5f * dp, paint);
            }
        }
        // 兵数气泡
        String t = String.valueOf(soldiers);
        paint.setTextSize(20 * dp);
        float tw = Math.max(44 * dp, paint.measureText(t) + 26 * dp);
        float top = py - 66 * dp;
        paint.setShader(new LinearGradient(0, top, 0, top + 28 * dp, 0xFF42A5F5, 0xFF1565C0, Shader.TileMode.CLAMP));
        rect.set(squadX - tw / 2, top, squadX + tw / 2, top + 28 * dp);
        c.drawRoundRect(rect, 14 * dp, 14 * dp, paint);
        paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2 * dp);
        paint.setColor(0xFFFFFFFF);
        c.drawRoundRect(rect, 14 * dp, 14 * dp, paint);
        paint.setStyle(Paint.Style.FILL);
        path.reset();
        path.moveTo(squadX - 6 * dp, top + 27 * dp);
        path.lineTo(squadX + 6 * dp, top + 27 * dp);
        path.lineTo(squadX, top + 35 * dp);
        path.close();
        paint.setColor(0xFF1565C0);
        c.drawPath(path, paint);
        outlined(c, t, squadX, top + 21 * dp, 20 * dp, 0xFFFFFFFF, 0xFF0D2A5C, null);
    }

    private void drawHud(Canvas c) {
        float w = W();
        paint.setColor(0xB0101820);
        rect.set(10 * dp, 10 * dp, w - 10 * dp, 54 * dp);
        c.drawRoundRect(rect, 14 * dp, 14 * dp, paint);
        paint.setTextAlign(Paint.Align.LEFT);
        outlined(c, "第 " + level + " 关", 22 * dp, 39 * dp, 19 * dp, 0xFFFFD54F, 0xFF3E2700, null);
        paint.setTextAlign(Paint.Align.RIGHT);
        outlined(c, "火力 Lv" + weapon, w - 22 * dp, 39 * dp, 16 * dp, 0xFFFFB74D, 0xFF3E2700, null);
        paint.setTextAlign(Paint.Align.CENTER);
        Bitmap icon = sp.soldier[0];
        float ix = w / 2 - 34 * dp;
        c.drawBitmap(icon, ix - icon.getWidth() / 2f, 14 * dp, bmpPaint);
        paint.setTextAlign(Paint.Align.LEFT);
        outlined(c, "× " + soldiers, ix + 14 * dp, 39 * dp, 18 * dp, 0xFFFFFFFF, 0xFF102030, null);
        paint.setTextAlign(Paint.Align.CENTER);
        // Boss 距离进度条
        float total = playerY() - bossStartY;
        float prog = total <= 0 ? 1 : Math.max(0, Math.min(1, 1 - (playerY() - bossY) / total));
        float bl = 24 * dp, br = w - 24 * dp, by = 60 * dp;
        paint.setColor(0x80000000);
        rect.set(bl, by, br, by + 6 * dp);
        c.drawRoundRect(rect, 3 * dp, 3 * dp, paint);
        paint.setColor(0xFFFF7043);
        rect.set(bl, by, bl + (br - bl) * prog, by + 6 * dp);
        c.drawRoundRect(rect, 3 * dp, 3 * dp, paint);
    }

    private void drawOverlay(Canvas c) {
        float w = W(), h = H();
        paint.setColor(state == State.MENU ? 0x66000000 : 0x99000000);
        c.drawRect(0, 0, w, h, paint);

        float pl = w * 0.07f, pr = w * 0.93f, pt = h * 0.14f, pb = h * 0.86f;
        paint.setColor(0xE6141C26);
        rect.set(pl, pt, pr, pb);
        c.drawRoundRect(rect, 22 * dp, 22 * dp, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2 * dp);
        paint.setColor(0x80FFD54F);
        c.drawRoundRect(rect, 22 * dp, 22 * dp, paint);
        paint.setStyle(Paint.Style.FILL);

        String title, sub;
        if (state == State.MENU) { title = "数字门大作战"; sub = "当前进度：第 " + bestLevel + " 关"; }
        else if (state == State.WIN) { title = "第 " + level + " 关 通过！"; sub = "剩余士兵 " + soldiers; }
        else { title = "小队全灭"; sub = "倒在了第 " + level + " 关"; }

        float ty = pt + 64 * dp;
        LinearGradient gold = new LinearGradient(0, ty - 36 * dp, 0, ty, 0xFFFFF59D, 0xFFFF8F00, Shader.TileMode.CLAMP);
        int titleColor = state == State.LOSE ? 0xFFFF5252 : 0xFFFFFFFF;
        outlined(c, title, w / 2, ty, 36 * dp, titleColor, 0xFF3E1F00, state == State.LOSE ? null : gold);
        paint.setColor(0xFFB0BEC5);
        paint.setTextSize(17 * dp);
        c.drawText(sub, w / 2, ty + 34 * dp, paint);

        // 角色展示
        float showY = ty + 130 * dp;
        Bitmap boss = sp.boss[((int) (animTime * 5)) & 3];
        Bitmap z0 = sp.zombie[0][((int) (animTime * 7)) & 3];
        Bitmap z2 = sp.zombie[2][((int) (animTime * 7) + 2) & 3];
        if (state != State.WIN) {
            c.drawBitmap(boss, w / 2 - boss.getWidth() / 2f, showY - boss.getHeight() * 0.7f, bmpPaint);
            c.drawBitmap(z0, w * 0.22f - z0.getWidth() / 2f, showY - z0.getHeight() * 0.3f, bmpPaint);
            c.drawBitmap(z2, w * 0.78f - z2.getWidth() / 2f, showY - z2.getHeight() * 0.3f, bmpPaint);
        }
        for (int i = 0; i < 7; i++) {
            Bitmap s = sp.soldier[((int) (animTime * 9) + i) & 3];
            float x = w / 2 + (i - 3) * 22 * dp;
            float y = showY + 74 * dp + (i % 2) * 8 * dp;
            c.drawBitmap(s, x - s.getWidth() / 2f, y - s.getHeight() * 0.85f, bmpPaint);
        }

        if (state == State.MENU) {
            String[] tips = {
                    "左右拖动控制小队，自动开火",
                    "射击数字门，每发子弹让数字 +1",
                    "穿过门：士兵按门上数字增减",
                    "打爆「武器+1」桶，火力升级",
                    "消灭僵尸，最后硬刚变异屠夫"
            };
            paint.setColor(0xFFCFD8DC);
            paint.setTextSize(15 * dp);
            float y0 = showY + 110 * dp;
            for (int i = 0; i < tips.length; i++) c.drawText(tips[i], w / 2, y0 + i * 25 * dp, paint);
        }

        // 按钮
        float pulse = 1 + (float) Math.sin(animTime * 5) * 0.04f;
        float bw = 190 * dp * pulse, bh = 52 * dp * pulse, by = pb - 50 * dp;
        paint.setShader(new LinearGradient(0, by - bh / 2, 0, by + bh / 2, 0xFFFFCA28, 0xFFF57C00, Shader.TileMode.CLAMP));
        rect.set(w / 2 - bw / 2, by - bh / 2, w / 2 + bw / 2, by + bh / 2);
        c.drawRoundRect(rect, bh / 2, bh / 2, paint);
        paint.setShader(null);
        paint.setColor(0x50FFFFFF);
        rect.set(w / 2 - bw / 2 + 8 * dp, by - bh / 2 + 4 * dp, w / 2 + bw / 2 - 8 * dp, by - 2 * dp);
        c.drawRoundRect(rect, bh / 3, bh / 3, paint);
        String action = state == State.MENU ? "开始战斗" : state == State.WIN ? "下一关" : "再来一次";
        outlined(c, action, w / 2, by + 8 * dp, 22 * dp, 0xFFFFFFFF, 0xFF6D3300, null);
    }

    /** 描边文字：先画深色粗描边再画填充，跟广告里的大字效果类似。 */
    private void outlined(Canvas c, String s, float x, float y, float size, int fill, int stroke, Shader fillShader) {
        paint.setTextSize(size);
        paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeWidth(size * 0.18f);
        paint.setColor(stroke);
        c.drawText(s, x, y, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(fill);
        paint.setShader(fillShader);
        c.drawText(s, x, y, paint);
        paint.setShader(null);
    }
}
