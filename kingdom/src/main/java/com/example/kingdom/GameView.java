package com.example.kingdom;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Random;

/**
 * 小小王国守卫战
 *
 * 玩法（参考"走上格子投金币建造 + 夜晚守城"类广告的核心玩法，全部原创实现）：
 * - 拖动屏幕任意位置 = 虚拟摇杆，控制骑士国王移动
 * - 站在地块上会自动把金币投进去，投满即可建造；站在已建好的建筑上可继续升级（最高 3 级）
 * - 白天建造，点「迎战」开始夜晚，敌人沿土路进攻城堡
 * - 骑士会自动攻击身边敌人；箭塔、城墙、兵营、城堡升级帮你守城；房屋在天亮时产出金币
 * - 击败敌人掉落金币，靠近自动吸取；城堡被攻破即失败
 */
public class GameView extends View {

    // ======================== 常量 ========================
    static final float W = 1000f, H = 1700f;
    static final int T_TOWER = 0, T_WALL = 1, T_HOUSE = 2, T_BARRACKS = 3, T_CASTLE = 4;
    static final int MAX_LV = 3;
    static final float CASTLE_X = 500f, CASTLE_Y = 320f;
    static final float SPAWN_X = 500f, SPAWN_Y = 520f;
    static final String[] TYPE_NAME = {"箭塔", "城墙", "房屋", "兵营", "城堡"};

    enum State { MENU, PLAY, OVER }

    // ======================== 数据结构 ========================
    static class Route {
        final int fromNight;
        final float[] x, y, cum;
        final float total;

        Route(int fromNight, float... p) {
            this.fromNight = fromNight;
            int n = p.length / 2;
            x = new float[n];
            y = new float[n];
            cum = new float[n];
            for (int i = 0; i < n; i++) {
                x[i] = p[2 * i];
                y[i] = p[2 * i + 1];
                if (i > 0) cum[i] = cum[i - 1] + dist(x[i - 1], y[i - 1], x[i], y[i]);
            }
            total = cum[n - 1];
        }

        /** out = {x, y, dirX, dirY} */
        void pointAt(float d, float[] out) {
            if (d < 0) d = 0;
            if (d > total - 0.01f) d = total - 0.01f;
            for (int i = 1; i < x.length; i++) {
                if (cum[i] >= d) {
                    float seg = cum[i] - cum[i - 1];
                    float t = (d - cum[i - 1]) / seg;
                    out[0] = x[i - 1] + (x[i] - x[i - 1]) * t;
                    out[1] = y[i - 1] + (y[i] - y[i - 1]) * t;
                    out[2] = (x[i] - x[i - 1]) / seg;
                    out[3] = (y[i] - y[i - 1]) / seg;
                    return;
                }
            }
        }

        float distTo(float px, float py) {
            float best = Float.MAX_VALUE;
            for (int i = 1; i < x.length; i++) {
                best = Math.min(best, segDist(px, py, x[i - 1], y[i - 1], x[i], y[i]));
            }
            return best;
        }
    }

    static class Plot {
        int type, base, unlock, level, paid, route = -1;
        float x, y, sx, sy, hp, maxHp, cd, dirX, dirY, rallyX, rallyY, pulse, aim = 1.57f;
        boolean lockUntilLeave;

        int nextCost() { return base * (level + 1); }
        boolean maxed() { return level >= MAX_LV; }
    }

    static class Enemy {
        int kind, route, wp, reward;
        float x, y, hp, maxHp, speed, dmg, cd, r, hit, phase, lane, faceX = 0, faceY = 1;
        boolean dead;
    }

    static class Soldier {
        Plot home;
        int idx;
        float x, y, hp, maxHp, cd, swing;
        boolean dead;
    }

    static class Arrow {
        float x, y, tx, ty, dmg, vx, vy;
        Enemy target;
        boolean done, big;
    }

    static class Coin {
        float x, y, vx, vy, z, vz, life;
        int value;
        boolean magnet;
    }

    static class Particle {
        float x, y, vx, vy, life, max, size;
        int color;
    }

    static class Spark {
        float x, y, life;
        long seed;
    }

    static class FText {
        String s;
        float x, y, life, size;
        int color;
    }

    // ======================== 状态 ========================
    private final ArrayList<Route> routes = new ArrayList<>();
    private final ArrayList<Plot> plots = new ArrayList<>();
    private final ArrayList<Enemy> enemies = new ArrayList<>();
    private final ArrayList<Soldier> soldiers = new ArrayList<>();
    private final ArrayList<Arrow> arrows = new ArrayList<>();
    private final ArrayList<Coin> coinsOnGround = new ArrayList<>();
    private final ArrayList<Particle> particles = new ArrayList<>();
    private final ArrayList<FText> texts = new ArrayList<>();
    private final ArrayList<Spark> sparks = new ArrayList<>();
    private final ArrayList<int[]> spawnQueue = new ArrayList<>();
    private final ArrayList<float[]> trees = new ArrayList<>();

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dash = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF rect = new RectF();
    private final Random rnd = new Random();
    private final float[] tmp = new float[4];
    private final SharedPreferences prefs;
    private final float dp;

    private State state = State.MENU;
    private int night, coins, kills, best;
    private boolean isNight, builtSomething;
    private float spawnTimer, spawnInterval, nightAlpha, overTimer, time;
    private String banner = "";
    private float bannerLife;

    // 英雄
    private float hx, hy, hHp, hMax, hDmg, hCd, hSwing, hFaceX = 0, hFaceY = 1, hRespawn, hWalk, drainTimer;
    private boolean hDead;

    // 城堡
    private float cHp, cMax, cCd, cHit;
    private Plot castlePlot;

    // 屏幕/摇杆
    private float sc = 1, offX, offY, camX = CASTLE_X, camY = CASTLE_Y + 300, bgScale = 1;
    // 背景图覆盖的世界范围
    static final float BX0 = -220, BY0 = -260, BX1 = 1220, BY1 = 2020;
    private final android.graphics.Rect bgSrc = new android.graphics.Rect();
    private final RectF bgDst = new RectF();
    private final Paint bgPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private int sw, sh;
    private Bitmap bg;
    private boolean joyOn;
    private int joyId = -1;
    private float joyOX, joyOY, joyX, joyY;
    private final RectF btnNight = new RectF();
    private long lastNanos;

    public GameView(Context ctx) {
        super(ctx);
        dp = ctx.getResources().getDisplayMetrics().density;
        prefs = ctx.getSharedPreferences("kingdom", Context.MODE_PRIVATE);
        best = prefs.getInt("best", 0);

        dash.setStyle(Paint.Style.STROKE);
        dash.setStrokeCap(Paint.Cap.ROUND);

        // 三条进攻道路（第 1 / 2 / 3 夜开放）
        routes.add(new Route(1, 520, 1960, 470, 1500, 600, 1250, 640, 1050, 470, 850, 430, 650, 500, 440));
        routes.add(new Route(2, -260, 1180, 160, 1080, 260, 880, 300, 640, 500, 440));
        routes.add(new Route(3, 1260, 1000, 860, 900, 800, 700, 700, 540, 500, 440));

        resetGame();
        generateTrees();
    }

    void onPauseGame() {
        lastNanos = 0;
        joyOn = false;
        joyId = -1;
    }

    // ======================== 初始化 ========================
    private Plot addPlot(int type, float x, float y, int cost, int unlock) {
        Plot p = new Plot();
        p.type = type;
        p.x = x;
        p.y = y;
        p.base = cost;
        p.sx = x;
        p.sy = y + 78;
        p.unlock = unlock;
        if (type == T_BARRACKS) {
            float bestD = Float.MAX_VALUE;
            for (Route r : routes) {
                for (float d = 0; d < r.total; d += 8) {
                    r.pointAt(d, tmp);
                    float dd = dist(x, y, tmp[0], tmp[1]);
                    if (dd < bestD) {
                        bestD = dd;
                        p.rallyX = tmp[0];
                        p.rallyY = tmp[1];
                    }
                }
            }
        }
        plots.add(p);
        return p;
    }

    private void addWall(int route, float fromEnd, int cost, int unlock) {
        Route r = routes.get(route);
        r.pointAt(r.total - fromEnd, tmp);
        Plot p = addPlot(T_WALL, tmp[0], tmp[1], cost, unlock);
        p.route = route;
        p.dirX = tmp[2];
        p.dirY = tmp[3];
        p.sx = p.x - p.dirY * 150;
        p.sy = p.y + p.dirX * 150;
        if (p.sx < 60 || p.sx > W - 60) { p.sx = p.x + p.dirY * 150; p.sy = p.y - p.dirX * 150; }
    }

    private void resetGame() {
        plots.clear();
        enemies.clear();
        soldiers.clear();
        arrows.clear();
        coinsOnGround.clear();
        particles.clear();
        texts.clear();
        sparks.clear();
        spawnQueue.clear();

        addPlot(T_HOUSE, 330, 250, 5, 1);
        addPlot(T_HOUSE, 690, 220, 5, 1);
        addPlot(T_TOWER, 590, 640, 8, 1);
        addPlot(T_TOWER, 345, 760, 10, 1);
        addWall(0, 430, 6, 1);

        castlePlot = addPlot(T_CASTLE, 660, 380, 20, 2);
        addPlot(T_BARRACKS, 240, 520, 15, 2);
        addPlot(T_TOWER, 720, 1160, 15, 2);
        addPlot(T_TOWER, 150, 870, 15, 2);
        addWall(1, 300, 8, 2);

        addPlot(T_HOUSE, 190, 360, 8, 3);
        addPlot(T_HOUSE, 830, 400, 8, 3);
        addPlot(T_TOWER, 910, 760, 15, 3);
        addPlot(T_TOWER, 470, 1190, 15, 3);
        addWall(2, 300, 8, 3);

        addPlot(T_BARRACKS, 790, 1000, 20, 4);
        addPlot(T_TOWER, 640, 1450, 25, 4);
        addWall(0, 760, 12, 4);

        addPlot(T_TOWER, 180, 1260, 25, 5);

        night = 1;
        isNight = false;
        coins = 20;
        kills = 0;
        builtSomething = false;
        nightAlpha = 0;
        cMax = 300;
        cHp = cMax;
        hMax = 100;
        hHp = hMax;
        hDmg = 20;
        hDead = false;
        hx = SPAWN_X;
        hy = SPAWN_Y;
        showBanner("第 1 天 · 建造你的王国");
    }

    private void generateTrees() {
        Random r = new Random(7);
        trees.clear();
        for (int i = 0; i < 1600 && trees.size() < 170; i++) {
            float x = -260 + r.nextFloat() * 1520;
            float y = -300 + r.nextFloat() * 2350;
            if (x < 90 && y < 1000 && x > -260) continue; // 左侧山崖
            if (x > 340 && x < 660 && y > 120 && y < 470) continue; // 城堡
            if (dist(x, y, SPAWN_X, SPAWN_Y) < 90) continue;
            boolean bad = false;
            for (Route rt : routes) {
                if (rt.distTo(x, y) < 75) { bad = true; break; }
            }
            if (bad) continue;
            for (Plot p : plots) {
                if (dist(x, y, p.x, p.y) < 105 || dist(x, y, p.sx, p.sy) < 70) { bad = true; break; }
            }
            if (bad) continue;
            for (float[] t : trees) {
                if (dist(x, y, t[0], t[1]) < 34) { bad = true; break; }
            }
            if (bad) continue;
            trees.add(new float[]{x, y, 0.8f + r.nextFloat() * 0.55f});
        }
        Collections.sort(trees, (a, b) -> Float.compare(a[1], b[1]));
    }

    // ======================== 尺寸 / 背景 ========================
    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        if (w <= 0 || h <= 0) return;
        sw = w;
        sh = h;
        // 镜头跟随国王：竖屏可见约 640 个世界单位宽
        sc = w / 640f;
        updateCamera(1f);
        float bw = 220 * dp, bh = 60 * dp;
        btnNight.set((w - bw) / 2f, h - bh - 24 * dp, (w + bw) / 2f, h - 24 * dp);
        buildBackground();
    }

    private void buildBackground() {
        if (bg != null) bg.recycle();
        // 背景按 0.8 倍分辨率预渲染整张地图，绘制时放大，节省内存
        bgScale = sc * 0.8f;
        int bw = (int) ((BX1 - BX0) * bgScale), bh = (int) ((BY1 - BY0) * bgScale);
        bg = Bitmap.createBitmap(bw, bh, Bitmap.Config.RGB_565);
        Canvas c = new Canvas(bg);
        c.drawColor(Art.GRASS);
        c.save();
        c.scale(bgScale, bgScale);
        c.translate(-BX0, -BY0);

        Random r = new Random(3);
        for (int i = 0; i < 60; i++) {
            Art.circle(c, r.nextBoolean() ? 0x10FFFFFF : 0x0E00301A,
                    -300 + r.nextFloat() * 1600, -400 + r.nextFloat() * 2600, 60 + r.nextFloat() * 160);
        }
        // 草丛小斑点
        for (int i = 0; i < 260; i++) {
            float x = -300 + r.nextFloat() * 1600, y = -400 + r.nextFloat() * 2600;
            Art.line(c, x, y, x - 3, y - 7, 2, 0x2A1E5A3A);
            Art.line(c, x, y, x + 3, y - 8, 2, 0x2A1E5A3A);
        }

        Art.cliff(c, 11);

        // 土路：柔边 + 轻微起伏的宽度
        float[][] pass = {{52, 0x40C9B289}, {42, Art.DIRT_EDGE}, {34, Art.DIRT}};
        for (float[] ps : pass) {
            for (int ri = 0; ri < routes.size(); ri++) {
                Route rt = routes.get(ri);
                for (float d = 0; d < rt.total; d += 6) {
                    rt.pointAt(d, tmp);
                    float n = (float) (Math.sin(d * 0.021 + ri * 3) * 5 + Math.sin(d * 0.057 + ri) * 3);
                    Art.circle(c, (int) ps[1], tmp[0], tmp[1], ps[0] + n);
                }
            }
        }
        for (Route rt : routes) {
            for (float d = 20; d < rt.total; d += 34) {
                rt.pointAt(d, tmp);
                Art.oval(c, Art.DIRT_LIGHT, tmp[0] + (r.nextFloat() - 0.5f) * 30, tmp[1] + (r.nextFloat() - 0.5f) * 30,
                        8 + r.nextFloat() * 10, 4 + r.nextFloat() * 5);
                Art.circle(c, 0x40A08660, tmp[0] + (r.nextFloat() - 0.5f) * 50, tmp[1] + (r.nextFloat() - 0.5f) * 50, 2 + r.nextFloat() * 2);
            }
        }
        // 主城前空地
        Art.oval(c, Art.DIRT_EDGE, CASTLE_X, CASTLE_Y + 150, 150, 70);
        Art.oval(c, Art.DIRT, CASTLE_X, CASTLE_Y + 150, 140, 62);

        // 树和灌木
        for (int i = 0; i < trees.size(); i++) {
            float[] t = trees.get(i);
            if (i % 7 == 3) Art.bush(c, t[0], t[1], t[2]);
            else Art.pine(c, t[0], t[1], t[2]);
        }
        c.restore();
    }

    // ======================== 主循环 ========================
    @Override
    protected void onDraw(Canvas c) {
        long now = System.nanoTime();
        float dt = lastNanos == 0 ? 0.016f : (now - lastNanos) / 1e9f;
        lastNanos = now;
        if (dt > 0.05f) dt = 0.05f;
        time += dt;

        if (state == State.PLAY) update(dt);
        else if (state == State.OVER) {
            overTimer += dt;
            updateEffects(dt);
        }

        updateCamera(dt);
        c.drawColor(Art.GRASS);
        if (bg != null) {
            // 屏幕可见的世界区域 -> 背景图像素
            float wl = -offX / sc, wt = -offY / sc, wr = wl + sw / sc, wb = wt + sh / sc;
            bgSrc.set((int) ((wl - BX0) * bgScale), (int) ((wt - BY0) * bgScale),
                    (int) Math.ceil((wr - BX0) * bgScale), (int) Math.ceil((wb - BY0) * bgScale));
            float k = sc / bgScale;
            bgDst.set(offX + (BX0 + bgSrc.left / bgScale) * sc, offY + (BY0 + bgSrc.top / bgScale) * sc, 0, 0);
            bgDst.right = bgDst.left + bgSrc.width() * k;
            bgDst.bottom = bgDst.top + bgSrc.height() * k;
            c.drawBitmap(bg, bgSrc, bgDst, bgPaint);
        }
        else c.drawColor(0xFF63AF7C);

        c.save();
        c.translate(offX, offY);
        c.scale(sc, sc);
        drawWorld(c);
        c.restore();

        if (nightAlpha > 0.01f) {
            fill.setColor(((int) (nightAlpha * 110) << 24) | 0x0A1840);
            c.drawRect(0, 0, sw, sh, fill);
        }

        drawHud(c);
        postInvalidateOnAnimation();
    }

    private void updateCamera(float dt) {
        if (sw == 0) return;
        float tx, ty;
        if (state == State.MENU) { tx = CASTLE_X; ty = CASTLE_Y + 260; }
        else if (hDead) { tx = SPAWN_X; ty = SPAWN_Y; }
        else { tx = hx; ty = hy - 40; }
        float k = Math.min(1f, dt * 4f);
        camX += (tx - camX) * k;
        camY += (ty - camY) * k;
        float vw = sw / sc / 2f, vh = sh / sc / 2f;
        camX = clamp(camX, BX0 + vw, BX1 - vw);
        camY = clamp(camY, BY0 + vh, BY1 - vh);
        offX = sw / 2f - camX * sc;
        offY = sh / 2f - camY * sc;
    }

    private void update(float dt) {
        nightAlpha += ((isNight ? 1f : 0f) - nightAlpha) * Math.min(1, dt * 2);
        if (bannerLife > 0) bannerLife -= dt;
        if (cHit > 0) cHit -= dt;

        updateHero(dt);
        updatePlotsBuild(dt);
        updateBuildings(dt);
        updateSoldiers(dt);
        updateEnemies(dt);
        updateArrows(dt);
        updateCoins(dt);
        updateEffects(dt);

        if (isNight) {
            if (!spawnQueue.isEmpty()) {
                spawnTimer -= dt;
                if (spawnTimer <= 0) {
                    int[] s = spawnQueue.remove(0);
                    spawnEnemy(s[0], s[1]);
                    // 队内紧凑出发，队与队之间留间隔
                    spawnTimer = s[2] == 1 ? spawnInterval * (3f + rnd.nextFloat() * 2f) : 0.28f + rnd.nextFloat() * 0.12f;
                }
            } else if (enemies.isEmpty()) {
                endNight();
            }
        }
    }

    // ======================== 英雄 ========================
    private void updateHero(float dt) {
        if (hDead) {
            hRespawn -= dt;
            if (hRespawn <= 0) {
                hDead = false;
                hHp = hMax;
                hx = SPAWN_X;
                hy = SPAWN_Y;
                addText("国王复活!", hx, hy - 60, 0xFFFFFFFF, 30);
            }
            return;
        }
        if (joyOn) {
            float jx = (joyX - joyOX), jy = (joyY - joyOY);
            float len = (float) Math.sqrt(jx * jx + jy * jy);
            float maxLen = 55 * dp;
            if (len > 6 * dp) {
                float k = Math.min(1f, len / maxLen);
                float nx = jx / len, ny = jy / len;
                float sp = 290 * k;
                hx += nx * sp * dt;
                hy += ny * sp * dt;
                hFaceX = nx;
                hFaceY = ny;
                hWalk += dt * 12 * k;
            }
        }
        hx = clamp(hx, 20, W - 20);
        hy = clamp(hy, 60, H - 20);
        // 不能走进城堡主体
        if (hx > 400 && hx < 600 && hy > 200 && hy < 405) {
            float dl = hx - 400, dr = 600 - hx, du = hy - 200, dd = 405 - hy;
            float m = Math.min(Math.min(dl, dr), Math.min(du, dd));
            if (m == dl) hx = 400; else if (m == dr) hx = 600; else if (m == du) hy = 200; else hy = 405;
        }

        hHp = Math.min(hMax, hHp + dt * 3);
        if (hCd > 0) hCd -= dt;
        if (hSwing > 0) hSwing -= dt;
        if (hCd <= 0) {
            Enemy t = null;
            float bd = Float.MAX_VALUE;
            for (Enemy e : enemies) {
                if (e.dead) continue;
                float d = dist(hx, hy, e.x, e.y) - e.r;
                if (d < 62 && d < bd) { bd = d; t = e; }
            }
            if (t != null) {
                hCd = 0.42f;
                hSwing = 0.22f;
                float d = dist(hx, hy, t.x, t.y);
                if (d > 1) { hFaceX = (t.x - hx) / d; hFaceY = (t.y - hy) / d; }
                addSpark(t.x, t.y - t.r);
                damageEnemy(t, hDmg);
                for (Enemy e : enemies) {
                    if (e != t && !e.dead && dist(e.x, e.y, t.x, t.y) < 55) damageEnemy(e, hDmg * 0.5f);
                }
            }
        }
    }

    private void hitHero(float d) {
        if (hDead) return;
        hHp -= d;
        burst(hx, hy - 10, 0xFFFF5050, 4, 120);
        if (hHp <= 0) {
            hDead = true;
            hRespawn = 6;
            burst(hx, hy, 0xFFFFD54A, 18, 260);
            addText("国王倒下了… 6秒后复活", hx, hy - 60, 0xFFFF8080, 26);
        }
    }

    // ======================== 建造（投金币） ========================
    private void updatePlotsBuild(float dt) {
        Plot on = null;
        for (Plot p : plots) {
            if (p.unlock > night) continue;
            if (p.pulse > 0) p.pulse -= dt;
            float d = p.level == 0 ? dist(hx, hy, p.x, p.y) : dist(hx, hy, p.sx, p.sy);
            boolean inside = !hDead && d < (p.level == 0 ? 52 : 40);
            if (!inside) p.lockUntilLeave = false;
            if (inside && on == null && !p.maxed() && !p.lockUntilLeave) on = p;
        }
        if (on == null) { drainTimer = 0; return; }
        drainTimer += dt;
        while (drainTimer >= 0.05f && coins > 0) {
            drainTimer -= 0.05f;
            coins--;
            on.paid++;
            if (on.paid >= on.nextCost()) {
                on.paid = 0;
                on.level++;
                on.lockUntilLeave = true;
                onBuilt(on);
                break;
            }
        }
        if (coins <= 0) drainTimer = 0;
    }

    private void onBuilt(Plot p) {
        builtSomething = true;
        p.pulse = 0.5f;
        burst(p.x, p.y - 30, 0xFFFFD54A, 22, 300);
        addText(p.level == 1 ? TYPE_NAME[p.type] + " 建成!" : TYPE_NAME[p.type] + " 升到 " + p.level + " 级!", p.x, p.y - 90, 0xFFFFF2A8, 30);
        switch (p.type) {
            case T_WALL:
                p.maxHp = 220 * p.level;
                p.hp = p.maxHp;
                break;
            case T_BARRACKS:
                refillSoldiers(p);
                break;
            case T_CASTLE:
                cMax += 200;
                cHp = Math.min(cMax, cHp + 200);
                hMax += 40;
                hHp = hMax;
                hDmg += 8;
                break;
            default:
                break;
        }
    }

    private void refillSoldiers(Plot p) {
        for (int i = soldiers.size() - 1; i >= 0; i--) if (soldiers.get(i).home == p) soldiers.remove(i);
        int n = p.level + 1;
        for (int i = 0; i < n; i++) {
            Soldier s = new Soldier();
            s.home = p;
            s.idx = i;
            s.x = p.x;
            s.y = p.y;
            s.maxHp = 60 + 20 * p.level;
            s.hp = s.maxHp;
            soldiers.add(s);
        }
    }

    // ======================== 建筑攻击 ========================
    private void updateBuildings(float dt) {
        for (Plot p : plots) {
            if (p.level <= 0) continue;
            if (p.type == T_TOWER) {
                if (p.cd > 0) p.cd -= dt;
                if (p.cd <= 0) {
                    float range = 250 + 30 * p.level;
                    Enemy t = nearestEnemy(p.x, p.y, range);
                    if (t != null) {
                        p.cd = 1.0f - 0.18f * p.level;
                        p.aim = (float) Math.atan2(t.y - p.y, t.x - p.x);
                        fireArrow(p.x, p.y - 72 - p.level * 14, t, 10 + 7 * p.level, false);
                    }
                }
            }
        }
        if (castlePlot.level > 0) {
            if (cCd > 0) cCd -= dt;
            if (cCd <= 0) {
                Enemy t = nearestEnemy(CASTLE_X, CASTLE_Y + 40, 330);
                if (t != null) {
                    cCd = 1.1f - 0.15f * castlePlot.level;
                    fireArrow(CASTLE_X - 25, CASTLE_Y - 200, t, 16 * castlePlot.level, true);
                }
            }
        }
    }

    private Enemy nearestEnemy(float x, float y, float range) {
        Enemy t = null;
        float bd = range;
        for (Enemy e : enemies) {
            if (e.dead) continue;
            float d = dist(x, y, e.x, e.y);
            if (d < bd) { bd = d; t = e; }
        }
        return t;
    }

    private void fireArrow(float x, float y, Enemy t, float dmg, boolean big) {
        Arrow a = new Arrow();
        a.x = x;
        a.y = y;
        a.target = t;
        a.tx = t.x;
        a.ty = t.y;
        a.dmg = dmg;
        a.big = big;
        arrows.add(a);
    }

    private void updateArrows(float dt) {
        for (int i = arrows.size() - 1; i >= 0; i--) {
            Arrow a = arrows.get(i);
            if (a.target != null && !a.target.dead) { a.tx = a.target.x; a.ty = a.target.y - 10; }
            float d = dist(a.x, a.y, a.tx, a.ty);
            float step = 1000 * dt;
            if (d <= step + 4) {
                if (a.target != null && !a.target.dead) {
                    addSpark(a.tx, a.ty);
                    damageEnemy(a.target, a.dmg);
                    if (a.big) {
                        for (Enemy e : enemies) {
                            if (e != a.target && !e.dead && dist(e.x, e.y, a.tx, a.ty) < 60) damageEnemy(e, a.dmg * 0.4f);
                        }
                        burst(a.tx, a.ty, 0xFFFFE08A, 8, 200);
                    }
                }
                arrows.remove(i);
            } else {
                a.vx = (a.tx - a.x) / d;
                a.vy = (a.ty - a.y) / d;
                a.x += a.vx * step;
                a.y += a.vy * step;
            }
        }
    }

    // ======================== 士兵 ========================
    private void updateSoldiers(float dt) {
        for (int i = soldiers.size() - 1; i >= 0; i--) {
            Soldier s = soldiers.get(i);
            if (s.dead) { soldiers.remove(i); continue; }
            if (s.cd > 0) s.cd -= dt;
            if (s.swing > 0) s.swing -= dt;
            int n = s.home.level + 1;
            double ang = s.idx * Math.PI * 2 / n;
            float rx = s.home.rallyX + (float) Math.cos(ang) * 26;
            float ry = s.home.rallyY + (float) Math.sin(ang) * 26;
            Enemy t = null;
            float bd = 180;
            for (Enemy e : enemies) {
                if (e.dead) continue;
                float d = dist(rx, ry, e.x, e.y);
                if (d < bd) { bd = d; t = e; }
            }
            if (t != null) {
                float d = dist(s.x, s.y, t.x, t.y);
                if (d > t.r + 16) moveToward(s, t.x, t.y, 130 * dt);
                else if (s.cd <= 0) {
                    s.cd = 0.8f;
                    s.swing = 0.2f;
                    damageEnemy(t, 6 + 5 * s.home.level);
                }
            } else {
                moveToward(s, rx, ry, 110 * dt);
            }
        }
    }

    private void moveToward(Soldier s, float x, float y, float step) {
        float d = dist(s.x, s.y, x, y);
        if (d < 1) return;
        float k = Math.min(1, step / d);
        s.x += (x - s.x) * k;
        s.y += (y - s.y) * k;
    }

    // ======================== 敌人 ========================
    private void spawnEnemy(int kind, int routeIdx) {
        Route r = routes.get(routeIdx);
        Enemy e = new Enemy();
        e.kind = kind;
        e.route = routeIdx;
        e.wp = 1;
        e.x = r.x[0] + (rnd.nextFloat() - 0.5f) * 30;
        e.y = r.y[0] + (rnd.nextFloat() - 0.5f) * 30;
        e.phase = rnd.nextFloat() * 6;
        e.lane = (rnd.nextFloat() - 0.5f) * 150;
        float hp, sp, dmg, rad;
        int rew;
        switch (kind) {
            case 1: hp = 14; sp = 112; dmg = 4; rad = 14; rew = 1; break;      // 快腿小鬼
            case 2: hp = 140; sp = 42; dmg = 14; rad = 25; rew = 3; break;     // 蛮牛
            case 3: hp = 750; sp = 34; dmg = 30; rad = 38; rew = 20; break;    // 首领
            default: hp = 22; sp = 62; dmg = 6; rad = 17; rew = 1; break;      // 红帽兵
        }
        float mult = 1 + 0.15f * (night - 1);
        e.maxHp = hp * mult;
        e.hp = e.maxHp;
        e.speed = sp * (0.92f + rnd.nextFloat() * 0.16f);
        e.dmg = dmg * (1 + 0.08f * (night - 1));
        e.r = rad;
        e.reward = rew;
        enemies.add(e);
    }

    private void updateEnemies(float dt) {
        for (int i = enemies.size() - 1; i >= 0; i--) {
            Enemy e = enemies.get(i);
            if (e.dead) { enemies.remove(i); continue; }
            e.phase += dt * 10;
            if (e.hit > 0) e.hit -= dt;
            if (e.cd > 0) e.cd -= dt;

            // 1) 被城墙挡住
            Plot wall = null;
            for (Plot p : plots) {
                if (p.type == T_WALL && p.level > 0 && p.hp > 0 && p.route == e.route
                        && dist(e.x, e.y, p.x, p.y) < e.r + 30) { wall = p; break; }
            }
            if (wall != null) {
                if (e.cd <= 0) {
                    e.cd = 1f;
                    wall.hp -= e.dmg;
                    burst(wall.x, wall.y - 20, 0xFFB98A5A, 3, 120);
                    if (wall.hp <= 0) {
                        wall.hp = 0;
                        burst(wall.x, wall.y - 20, 0xFF9C6A3F, 20, 260);
                        addText("城墙被攻破!", wall.x, wall.y - 70, 0xFFFF8080, 28);
                    }
                }
                continue;
            }

            // 2) 攻击附近的国王或士兵
            float aggro = e.kind == 3 ? 150 : 105;
            float tx = 0, ty = 0, tr = 0;
            Soldier ts = null;
            boolean targetHero = false;
            float bd = aggro;
            if (!hDead) {
                float d = dist(e.x, e.y, hx, hy);
                if (d < bd) { bd = d; targetHero = true; tx = hx; ty = hy; tr = 18; }
            }
            for (Soldier s : soldiers) {
                if (s.dead) continue;
                float d = dist(e.x, e.y, s.x, s.y);
                if (d < bd) { bd = d; targetHero = false; ts = s; tx = s.x; ty = s.y; tr = 12; }
            }
            if (targetHero || ts != null) {
                float d = dist(e.x, e.y, tx, ty);
                if (d > e.r + tr + 4) {
                    step(e, tx, ty, dt);
                } else if (e.cd <= 0) {
                    e.cd = 1f;
                    if (targetHero) hitHero(e.dmg);
                    else {
                        ts.hp -= e.dmg;
                        if (ts.hp <= 0) { ts.dead = true; burst(ts.x, ts.y, 0xFFDDE6F5, 10, 180); }
                    }
                }
                continue;
            }

            // 3) 沿路前进 / 攻城
            Route r = routes.get(e.route);
            if (e.wp >= r.x.length) {
                if (e.cd <= 0) {
                    e.cd = 1.2f;
                    cHp -= e.dmg;
                    cHit = 0.15f;
                    burst(CASTLE_X + (rnd.nextFloat() - 0.5f) * 120, 400, 0xFFCFC3AE, 3, 140);
                    if (cHp <= 0) { gameOver(); return; }
                }
                continue;
            }
            float wx = r.x[e.wp], wy = r.y[e.wp];
            if (e.wp == r.x.length - 1) {
                // 城门前散开排队
                wx += e.lane;
                wy += 10;
            }
            boolean last = e.wp == r.x.length - 1;
            boolean reached = dist(e.x, e.y, wx, wy) < (last ? 10 : 26);
            if (!reached && !last && e.wp > 0) {
                // 被挤过了路点（沿路段方向已越过）也算到达，避免互相推挤卡住
                float sx = r.x[e.wp] - r.x[e.wp - 1], sy = r.y[e.wp] - r.y[e.wp - 1];
                reached = (e.x - r.x[e.wp]) * sx + (e.y - r.y[e.wp]) * sy > 0;
            }
            if (reached) e.wp++;
            else step(e, wx, wy, dt);
        }

        // 简单分离，避免叠成一团
        int n = enemies.size();
        for (int i = 0; i < n; i++) {
            Enemy a = enemies.get(i);
            for (int j = i + 1; j < n; j++) {
                Enemy b = enemies.get(j);
                float dx = b.x - a.x, dy = b.y - a.y;
                float min = (a.r + b.r) * 0.85f;
                float d2 = dx * dx + dy * dy;
                if (d2 < min * min && d2 > 0.01f) {
                    float d = (float) Math.sqrt(d2);
                    float push = (min - d) * 0.25f;
                    float nx = dx / d, ny = dy / d;
                    a.x -= nx * push; a.y -= ny * push;
                    b.x += nx * push; b.y += ny * push;
                }
            }
        }
    }

    private void step(Enemy e, float x, float y, float dt) {
        float d = dist(e.x, e.y, x, y);
        if (d < 0.5f) return;
        float s = Math.min(d, e.speed * dt);
        e.faceX = (x - e.x) / d;
        e.faceY = (y - e.y) / d;
        e.x += e.faceX * s;
        e.y += e.faceY * s;
    }

    private void damageEnemy(Enemy e, float d) {
        if (e.dead) return;
        e.hp -= d;
        e.hit = 0.1f;
        burst(e.x, e.y - 10, 0xFFFFFFFF, 2, 100);
        if (e.hp <= 0) {
            e.dead = true;
            kills++;
            burst(e.x, e.y, 0xFFE04040, 12, 220);
            for (int i = 0; i < e.reward; i++) dropCoin(e.x, e.y);
        }
    }

    private void dropCoin(float x, float y) {
        Coin c = new Coin();
        c.x = x;
        c.y = y;
        double a = rnd.nextDouble() * Math.PI * 2;
        float sp = 40 + rnd.nextFloat() * 90;
        c.vx = (float) Math.cos(a) * sp;
        c.vy = (float) Math.sin(a) * sp;
        c.vz = 180 + rnd.nextFloat() * 120;
        c.value = 1;
        c.life = 25;
        coinsOnGround.add(c);
    }

    private void updateCoins(float dt) {
        for (int i = coinsOnGround.size() - 1; i >= 0; i--) {
            Coin c = coinsOnGround.get(i);
            c.life -= dt;
            if (c.life <= 0) { coinsOnGround.remove(i); continue; }
            if (c.z > 0 || c.vz > 0) {
                c.vz -= 700 * dt;
                c.z += c.vz * dt;
                c.x += c.vx * dt;
                c.y += c.vy * dt;
                if (c.z <= 0) { c.z = 0; c.vz = c.vz < -80 ? -c.vz * 0.35f : 0; c.vx *= 0.5f; c.vy *= 0.5f; }
            }
            if (!hDead) {
                float d = dist(c.x, c.y, hx, hy);
                if (d < 140 || c.magnet) {
                    c.magnet = true;
                    float sp = 650 * dt;
                    if (d < sp + 16) {
                        coins += c.value;
                        coinsOnGround.remove(i);
                        continue;
                    }
                    c.x += (hx - c.x) / d * sp;
                    c.y += (hy - c.y) / d * sp;
                }
            }
        }
    }

    // ======================== 昼夜 ========================
    private void startNight() {
        isNight = true;
        spawnQueue.clear();
        ArrayList<Integer> act = new ArrayList<>();
        for (int i = 0; i < routes.size(); i++) if (routes.get(i).fromNight <= night) act.add(i);
        int total = 8 + night * 4;
        // 敌人成队出现（同一队走同一条路），看起来像一条长长的红色队伍
        int squad = 3 + night / 2, gi = 0;
        for (int i = 0; i < total; i++) {
            if (i > 0 && i % squad == 0) gi++;
            int kind = 0;
            float r = rnd.nextFloat();
            if (night >= 2 && r < 0.25f) kind = 1;
            else if (night >= 3 && r < 0.25f + Math.min(0.3f, 0.05f * night)) kind = 2;
            spawnQueue.add(new int[]{kind, act.get(gi % act.size()), i % squad == squad - 1 ? 1 : 0});
        }
        if (night % 5 == 0) {
            for (int b = 0; b < night / 5; b++) spawnQueue.add(new int[]{3, act.get(b % act.size()), 1});
        }
        spawnTimer = 1.2f;
        spawnInterval = Math.max(0.5f, 1.2f - 0.05f * night);
        showBanner(night % 5 == 0 ? "第 " + night + " 夜 · 首领来袭!" : "第 " + night + " 夜 · 敌人来袭!");
    }

    private void endNight() {
        isNight = false;
        int income = 6 + 2 * night;
        for (Plot p : plots) {
            if (p.type == T_HOUSE) income += p.level * 4;
            if (p.type == T_WALL && p.level > 0) p.hp = p.maxHp;
            if (p.type == T_BARRACKS && p.level > 0) refillSoldiers(p);
        }
        coins += income;
        cHp = Math.min(cMax, cHp + cMax * 0.3f);
        if (hDead) { hDead = false; hx = SPAWN_X; hy = SPAWN_Y; }
        hHp = hMax;
        if (night > best) {
            best = night;
            prefs.edit().putInt("best", best).apply();
        }
        showBanner("守住了第 " + night + " 夜！ 天亮收入 +" + income + " 金币");
        night++;
        boolean newPlot = false;
        for (Plot p : plots) {
            if (p.unlock == night) {
                newPlot = true;
                p.pulse = 2f;
                addText("新地块!", p.x, p.y - 70, 0xFFFFFFFF, 26);
            }
        }
        for (Route r : routes) {
            if (r.fromNight == night) { addText("注意：今晚出现新的进攻路线!", 500, 700, 0xFFFF9090, 32); break; }
        }
        if (newPlot) addText("解锁了新的建造地块", 500, 620, 0xFFFFF2A8, 30);
    }

    private void gameOver() {
        state = State.OVER;
        overTimer = 0;
        if (night - 1 > best) {
            best = night - 1;
            prefs.edit().putInt("best", best).apply();
        }
        burst(CASTLE_X, CASTLE_Y, 0xFFFF7040, 40, 400);
    }

    // ======================== 特效 ========================
    private void burst(float x, float y, int color, int n, float sp) {
        if (particles.size() > 400) return;
        for (int i = 0; i < n; i++) {
            Particle p = new Particle();
            p.x = x;
            p.y = y;
            double a = rnd.nextDouble() * Math.PI * 2;
            float s = sp * (0.3f + rnd.nextFloat() * 0.7f);
            p.vx = (float) Math.cos(a) * s;
            p.vy = (float) Math.sin(a) * s - 60;
            p.max = p.life = 0.35f + rnd.nextFloat() * 0.35f;
            p.size = 3 + rnd.nextFloat() * 5;
            p.color = color;
            particles.add(p);
        }
    }

    private void addSpark(float x, float y) {
        if (sparks.size() > 40) return;
        Spark k = new Spark();
        k.x = x;
        k.y = y;
        k.life = 0.25f;
        k.seed = rnd.nextLong();
        sparks.add(k);
    }

    private void addText(String s, float x, float y, int color, float size) {
        FText t = new FText();
        t.s = s;
        t.x = x;
        t.y = y;
        t.color = color;
        t.size = size;
        t.life = 1.8f;
        texts.add(t);
    }

    private void showBanner(String s) {
        banner = s;
        bannerLife = 3f;
    }

    private void updateEffects(float dt) {
        for (int i = particles.size() - 1; i >= 0; i--) {
            Particle p = particles.get(i);
            p.life -= dt;
            if (p.life <= 0) { particles.remove(i); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 400 * dt;
        }
        for (int i = sparks.size() - 1; i >= 0; i--) {
            Spark k = sparks.get(i);
            k.life -= dt;
            if (k.life <= 0) sparks.remove(i);
        }
        for (int i = texts.size() - 1; i >= 0; i--) {
            FText t = texts.get(i);
            t.life -= dt;
            t.y -= 30 * dt;
            if (t.life <= 0) texts.remove(i);
        }
    }

    // ======================== 绘制世界 ========================
    private final ArrayList<Object> drawList = new ArrayList<>();
    private static final Object HERO = new Object(), CASTLE = new Object();

    private float footY(Object o) {
        if (o == HERO) return hy;
        if (o == CASTLE) return CASTLE_Y + 82;
        if (o instanceof Enemy) return ((Enemy) o).y;
        if (o instanceof Soldier) return ((Soldier) o).y;
        return ((Plot) o).y;
    }

    private void drawWorld(Canvas c) {
        // 1) 地面层：地块、金币
        for (Plot p : plots) {
            if (p.unlock > night) continue;
            if (p.level == 0) {
                float pulse = p.pulse > 0 ? 1 + 0.12f * (float) Math.sin(p.pulse * 18) : 1;
                int cost = p.nextCost();
                Art.plotPad(c, p.x, p.y, pulse, time, p.paid / (float) cost, String.valueOf(cost - p.paid),
                        p.type == T_CASTLE ? "城堡升级" : TYPE_NAME[p.type]);
            } else if (!p.maxed() && !hDead && dist(hx, hy, p.sx, p.sy) < 220) {
                int cost = p.nextCost();
                Art.plotPad(c, p.sx, p.sy, 0.62f, time, p.paid / (float) cost, String.valueOf(cost - p.paid), "升级");
            }
        }
        for (Coin k : coinsOnGround) {
            if (k.life < 5 && ((int) (k.life * 8)) % 2 == 0) continue;
            Art.oval(c, 0x33103020, k.x + 2, k.y + 3, 9, 4);
            Art.coin(c, k.x, k.y - k.z - 7, 10);
        }

        // 2) 立体层：按脚底 y 排序
        drawList.clear();
        drawList.add(CASTLE);
        for (Plot p : plots) if (p.level > 0) drawList.add(p);
        for (Enemy e : enemies) if (!e.dead) drawList.add(e);
        for (Soldier s : soldiers) if (!s.dead) drawList.add(s);
        if (!hDead) drawList.add(HERO);
        Collections.sort(drawList, (a, b) -> Float.compare(footY(a), footY(b)));
        for (Object o : drawList) {
            if (o == CASTLE) {
                Art.townHall(c, CASTLE_X, CASTLE_Y, castlePlot.level, time, cHit > 0);
                if (cHp < cMax) drawBar(c, CASTLE_X, CASTLE_Y - 230 - castlePlot.level * 8, 200, 14, cHp / cMax, 0xFF4CD964);
            } else if (o == HERO) {
                Art.king(c, hx, hy, hFaceX, hFaceY, hWalk, hSwing, time);
                if (hHp < hMax) drawBar(c, hx, hy - 84, 56, 8, hHp / hMax, 0xFF4CD964);
            } else if (o instanceof Enemy) {
                Enemy e = (Enemy) o;
                Art.brute(c, e.x, e.y, e.r, e.kind, e.faceX, e.faceY, e.phase, e.hit > 0);
                if (e.hp < e.maxHp) drawBar(c, e.x, e.y - e.r * 2.6f - 10, e.r * 2.6f, 7, e.hp / e.maxHp, 0xFFFF4D4D);
            } else if (o instanceof Soldier) {
                Soldier s = (Soldier) o;
                Art.knight(c, s.x, s.y, s.swing, time * 8 + s.idx);
                if (s.hp < s.maxHp) drawBar(c, s.x, s.y - 52, 30, 5, s.hp / s.maxHp, 0xFF4CD964);
            } else {
                drawBuilding(c, (Plot) o);
            }
        }
        if (hDead && state == State.PLAY) {
            outlined(c, "复活 " + (int) Math.ceil(hRespawn), SPAWN_X, SPAWN_Y, 30, 0xFFFFFFFF);
        }

        // 3) 飞行物与特效
        for (Arrow a : arrows) {
            if (a.big) Art.fireball(c, a.x, a.y, time);
            else Art.bolt(c, a.x, a.y, a.vx, a.vy);
        }
        for (Spark k : sparks) Art.spark(c, k.x, k.y, k.life, k.seed);
        for (Particle p : particles) {
            fill.setColor(p.color);
            fill.setAlpha((int) (255 * Math.max(0, p.life / p.max)));
            c.drawCircle(p.x, p.y, p.size, fill);
        }
        fill.setAlpha(255);
        for (FText t : texts) {
            int a = (int) (255 * Math.min(1, t.life / 0.6f));
            outlined(c, t.s, t.x, t.y, t.size, (t.color & 0x00FFFFFF) | (a << 24));
        }
    }

    private void drawBuilding(Canvas c, Plot p) {
        boolean near = !hDead && dist(hx, hy, p.x, p.y) < 200;
        switch (p.type) {
            case T_TOWER:
                if (near) {
                    stroke.setStyle(Paint.Style.STROKE);
                    stroke.setStrokeWidth(2);
                    stroke.setColor(0x55FFFFFF);
                    c.drawCircle(p.x, p.y, 250 + 30 * p.level, stroke);
                }
                Art.ballistaTower(c, p.x, p.y, p.level, p.aim);
                break;
            case T_WALL:
                Art.palisade(c, p.x, p.y, p.dirX, p.dirY, p.level, p.hp > 0);
                if (p.hp > 0 && p.hp < p.maxHp) drawBar(c, p.x, p.y - 90, 90, 10, p.hp / p.maxHp, 0xFFFFB13B);
                if (p.hp <= 0) outlined(c, "已损坏·天亮修复", p.x, p.y - 34, 18, 0xCCFFFFFF);
                break;
            case T_HOUSE:
                Art.cabin(c, p.x, p.y, p.level, isNight);
                if (!isNight) outlined(c, "+" + (p.level * 4), p.x, p.y - 108, 20, 0xFFFFE27A);
                break;
            case T_BARRACKS:
                Art.barracks(c, p.x, p.y, p.level, time);
                break;
            default:
                Art.monument(c, p.x, p.y, p.level, time);
                break;
        }
        Art.pips(c, p.x, p.y + 18, p.level);
    }

    private void drawBar(Canvas c, float x, float y, float w, float h, float f, int color) {
        f = clamp(f, 0, 1);
        fill.setColor(0xAA000000);
        rect.set(x - w / 2 - 2, y - 2, x + w / 2 + 2, y + h + 2);
        c.drawRoundRect(rect, h / 2 + 2, h / 2 + 2, fill);
        fill.setColor(color);
        rect.set(x - w / 2, y, x - w / 2 + w * f, y + h);
        c.drawRoundRect(rect, h / 2, h / 2, fill);
    }

    static final Paint TEXT = new Paint(Paint.ANTI_ALIAS_FLAG);
    static {
        TEXT.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
    }

    static void outlined(Canvas c, String s, float x, float y, float size, int color) {
        TEXT.setTextAlign(Paint.Align.CENTER);
        drawOutlined(c, s, x, y, size, color);
    }

    static void outlinedLeft(Canvas c, String s, float x, float y, float size, int color) {
        TEXT.setTextAlign(Paint.Align.LEFT);
        drawOutlined(c, s, x, y, size, color);
    }

    private static void drawOutlined(Canvas c, String s, float x, float y, float size, int color) {
        TEXT.setTextSize(size);
        TEXT.setStyle(Paint.Style.STROKE);
        TEXT.setStrokeJoin(Paint.Join.ROUND);
        TEXT.setStrokeWidth(size * 0.18f);
        TEXT.setColor((color & 0xFF000000) | 0x002A1A0A);
        c.drawText(s, x, y, TEXT);
        TEXT.setStyle(Paint.Style.FILL);
        TEXT.setColor(color);
        c.drawText(s, x, y, TEXT);
    }

    private void drawLabel(Canvas c, String s, float x, float y, float size, int color) {
        outlined(c, s, x, y, size, color);
    }

    private void drawLabelLeft(Canvas c, String s, float x, float y, float size, int color) {
        outlinedLeft(c, s, x, y, size, color);
    }

    // ======================== HUD ========================
    private void drawHud(Canvas c) {
        float u = dp;
        if (state == State.MENU) { drawMenu(c); return; }

        // 金币
        fill.setColor(0x99000000);
        rect.set(14 * u, 34 * u, 150 * u, 78 * u);
        c.drawRoundRect(rect, 22 * u, 22 * u, fill);
        Art.coin(c, 38 * u, 56 * u, 13 * u);
        drawLabelLeft(c, String.valueOf(coins), 58 * u, 65 * u, 26 * u, 0xFFFFE27A);

        // 天数
        String title = isNight ? "第 " + night + " 夜" : "第 " + night + " 天";
        fill.setColor(isNight ? 0xAA1A1F4A : 0x99000000);
        rect.set(sw / 2f - 70 * u, 34 * u, sw / 2f + 70 * u, 78 * u);
        c.drawRoundRect(rect, 22 * u, 22 * u, fill);
        drawLabel(c, title, sw / 2f, 64 * u, 22 * u, 0xFFFFFFFF);

        // 最佳
        fill.setColor(0x99000000);
        rect.set(sw - 150 * u, 34 * u, sw - 14 * u, 78 * u);
        c.drawRoundRect(rect, 22 * u, 22 * u, fill);
        drawLabel(c, "最佳 " + best + " 夜", sw - 82 * u, 62 * u, 17 * u, 0xFFFFFFFF);

        // 主城血量
        drawLabelLeft(c, "主城", 18 * u, 103 * u, 14 * u, 0xFFFFFFFF);
        drawBar(c, 60 * u + 70 * u, 93 * u, 140 * u, 12 * u, cHp / cMax, cHit > 0 ? 0xFFFF5050 : 0xFF4CD964);
        if (isNight) {
            int left = spawnQueue.size();
            for (Enemy e : enemies) if (!e.dead) left++;
            drawLabel(c, "剩余敌人 " + left, sw - 80 * u, 104 * u, 16 * u, 0xFFFFB0B0);
        }

        // 白天：来袭方向提示 + 开战按钮
        if (state == State.PLAY && !isNight) {
            drawThreatMarkers(c);
            float pulse = 1 + 0.03f * (float) Math.sin(time * 5);
            float cx = btnNight.centerX(), cy = btnNight.centerY();
            float bw = btnNight.width() / 2 * pulse, bh = btnNight.height() / 2 * pulse;
            fill.setColor(0xFF7A1A12);
            rect.set(cx - bw, cy - bh + 5 * u, cx + bw, cy + bh + 5 * u);
            c.drawRoundRect(rect, 20 * u, 20 * u, fill);
            fill.setColor(0xFFD9442E);
            rect.set(cx - bw, cy - bh, cx + bw, cy + bh);
            c.drawRoundRect(rect, 20 * u, 20 * u, fill);
            drawLabel(c, "迎战第 " + night + " 夜", cx, cy + 9 * u, 24 * u, 0xFFFFFFFF);
        }

        // 新手提示
        if (state == State.PLAY && !builtSomething && night == 1) {
            float y = isNight ? sh - 40 * u : btnNight.top - 22 * u;
            drawLabel(c, "按住屏幕拖动移动国王", sw / 2f, y - 26 * u, 17 * u, 0xFFFFFFFF);
            drawLabel(c, "站上虚线格子，自动投金币建造", sw / 2f, y, 17 * u, 0xFFFFF2A8);
        }

        // 横幅
        if (bannerLife > 0 && state == State.PLAY) {
            int a = (int) (255 * Math.min(1, bannerLife / 0.5f));
            fill.setColor((a * 150 / 255) << 24);
            rect.set(0, sh * 0.28f - 34 * u, sw, sh * 0.28f + 22 * u);
            c.drawRect(rect, fill);
            drawLabel(c, banner, sw / 2f, sh * 0.28f + 2 * u, 22 * u, (a << 24) | 0xFFFFFF);
        }

        // 摇杆
        if (joyOn && state == State.PLAY) {
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(3 * u);
            stroke.setColor(0x66FFFFFF);
            c.drawCircle(joyOX, joyOY, 55 * u, stroke);
            float jx = joyX - joyOX, jy = joyY - joyOY;
            float len = (float) Math.sqrt(jx * jx + jy * jy);
            if (len > 55 * u) { jx = jx / len * 55 * u; jy = jy / len * 55 * u; }
            fill.setColor(0x88FFFFFF);
            c.drawCircle(joyOX + jx, joyOY + jy, 24 * u, fill);
        }

        if (state == State.OVER) {
            fill.setColor(0xB0000000);
            c.drawRect(0, 0, sw, sh, fill);
            drawLabel(c, "城堡陷落", sw / 2f, sh * 0.38f, 44 * u, 0xFFFF7A6A);
            drawLabel(c, "坚守了 " + (night - 1) + " 夜 · 击败 " + kills + " 个敌人", sw / 2f, sh * 0.38f + 52 * u, 20 * u, 0xFFFFFFFF);
            drawLabel(c, "最佳记录：" + best + " 夜", sw / 2f, sh * 0.38f + 86 * u, 18 * u, 0xFFFFE27A);
            if (overTimer > 1) {
                int a = (int) (180 + 75 * Math.sin(time * 4));
                drawLabel(c, "点击屏幕重新开始", sw / 2f, sh * 0.38f + 150 * u, 22 * u, (a << 24) | 0xFFFFFF);
            }
        }
    }

    private void drawThreatMarkers(Canvas c) {
        float u = dp;
        for (Route r : routes) {
            if (r.fromNight > night) continue;
            for (float d = 0; d < r.total; d += 15) {
                r.pointAt(d, tmp);
                float sx = offX + tmp[0] * sc, sy = offY + tmp[1] * sc;
                if (sx > 34 * u && sx < sw - 34 * u && sy > 120 * u && sy < sh - 110 * u) {
                    float pulse = 1 + 0.15f * (float) Math.sin(time * 6);
                    fill.setColor(0xFF7A1A12);
                    c.drawCircle(sx, sy + 2 * u, 20 * u * pulse, fill);
                    fill.setColor(0xFFE53935);
                    c.drawCircle(sx, sy, 20 * u * pulse, fill);
                    drawLabel(c, "!", sx, sy + 9 * u, 26 * u, 0xFFFFFFFF);
                    break;
                }
            }
        }
    }

    private void drawMenu(Canvas c) {
        float u = dp;
        fill.setColor(0x99000000);
        c.drawRect(0, 0, sw, sh, fill);
        float y = sh * 0.30f;
        Art.crown(c, sw / 2f, y - 74 * u, 30 * u);
        Art.logo(c, "小小王国守卫战", sw / 2f, y, 44 * u);
        drawLabel(c, "白天建造 · 夜晚守城", sw / 2f, y + 40 * u, 20 * u, 0xFFFFFFFF);
        String[] lines = {
                "· 按住屏幕拖动，控制国王移动",
                "· 站上虚线格子投金币：箭塔 / 城墙 / 房屋 / 兵营",
                "· 站在建筑上可继续升级（最高 3 级）",
                "· 国王会自动挥剑，打倒敌人掉金币",
                "· 房屋在天亮时产出金币，守住城堡！"
        };
        for (int i = 0; i < lines.length; i++) {
            drawLabel(c, lines[i], sw / 2f, y + (100 + i * 34) * u, 16 * u, 0xFFEDEDED);
        }
        if (best > 0) drawLabel(c, "最佳记录：" + best + " 夜", sw / 2f, y + 300 * u, 18 * u, 0xFFFFE27A);
        int a = (int) (180 + 75 * Math.sin(time * 4));
        drawLabel(c, "点击开始", sw / 2f, y + 360 * u, 28 * u, (a << 24) | 0xFFFFFF);
    }

    // ======================== 触摸 ========================
    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        int action = ev.getActionMasked();
        int idx = ev.getActionIndex();
        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN: {
                float x = ev.getX(idx), y = ev.getY(idx);
                if (state == State.MENU) {
                    state = State.PLAY;
                    lastNanos = 0;
                    return true;
                }
                if (state == State.OVER) {
                    if (overTimer > 1) {
                        resetGame();
                        state = State.PLAY;
                    }
                    return true;
                }
                if (!isNight && btnNight.contains(x, y)) {
                    startNight();
                    return true;
                }
                if (!joyOn) {
                    joyOn = true;
                    joyId = ev.getPointerId(idx);
                    joyOX = joyX = x;
                    joyOY = joyY = y;
                }
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                if (joyOn) {
                    int pi = ev.findPointerIndex(joyId);
                    if (pi >= 0) {
                        joyX = ev.getX(pi);
                        joyY = ev.getY(pi);
                        // 手指拖得太远时让摇杆中心跟随
                        float dx = joyX - joyOX, dy = joyY - joyOY;
                        float len = (float) Math.sqrt(dx * dx + dy * dy);
                        float max = 80 * dp;
                        if (len > max) {
                            joyOX = joyX - dx / len * max;
                            joyOY = joyY - dy / len * max;
                        }
                    }
                }
                return true;
            }
            case MotionEvent.ACTION_POINTER_UP: {
                if (ev.getPointerId(idx) == joyId) { joyOn = false; joyId = -1; }
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                joyOn = false;
                joyId = -1;
                return true;
        }
        return super.onTouchEvent(ev);
    }

    // ======================== 工具 ========================
    static float dist(float ax, float ay, float bx, float by) {
        float dx = ax - bx, dy = ay - by;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    static float segDist(float px, float py, float ax, float ay, float bx, float by) {
        float dx = bx - ax, dy = by - ay;
        float l2 = dx * dx + dy * dy;
        float t = l2 == 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
        t = clamp(t, 0, 1);
        return dist(px, py, ax + dx * t, ay + dy * t);
    }

    static float clamp(float v, float lo, float hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
