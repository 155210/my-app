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
        float x, y, hp, maxHp, cd, dirX, dirY, rallyX, rallyY, pulse;
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
    private final ArrayList<int[]> spawnQueue = new ArrayList<>();
    private final ArrayList<float[]> trees = new ArrayList<>();

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
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
    private float sc = 1, offX, offY;
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

        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
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
    }

    private void resetGame() {
        plots.clear();
        enemies.clear();
        soldiers.clear();
        arrows.clear();
        coinsOnGround.clear();
        particles.clear();
        texts.clear();
        spawnQueue.clear();

        addPlot(T_HOUSE, 330, 250, 5, 1);
        addPlot(T_HOUSE, 690, 220, 5, 1);
        addPlot(T_TOWER, 590, 640, 8, 1);
        addPlot(T_TOWER, 350, 790, 10, 1);
        addWall(0, 330, 6, 1);

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
                if (dist(x, y, p.x, p.y) < 105) { bad = true; break; }
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
        sc = Math.min(w / W, h / (H + 60));
        offX = (w - W * sc) / 2f;
        offY = (h - H * sc) / 2f + 20 * sc;
        float bw = 220 * dp, bh = 60 * dp;
        btnNight.set((w - bw) / 2f, h - bh - 24 * dp, (w + bw) / 2f, h - 24 * dp);
        buildBackground();
    }

    private void buildBackground() {
        if (bg != null) bg.recycle();
        bg = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bg);
        c.drawColor(0xFF63AF7C);
        c.save();
        c.translate(offX, offY);
        c.scale(sc, sc);

        // 草地斑块
        Random r = new Random(3);
        for (int i = 0; i < 70; i++) {
            fill.setColor(r.nextBoolean() ? 0x1AFFFFFF : 0x14004020);
            c.drawCircle(-300 + r.nextFloat() * 1600, -400 + r.nextFloat() * 2600, 40 + r.nextFloat() * 120, fill);
        }

        // 左侧低多边形山崖
        drawCliff(c);

        // 土路
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        for (int pass = 0; pass < 2; pass++) {
            stroke.setStrokeWidth(pass == 0 ? 84 : 68);
            stroke.setColor(pass == 0 ? 0xFFC4AE83 : 0xFFDCC79E);
            for (Route rt : routes) {
                path.reset();
                path.moveTo(rt.x[0], rt.y[0]);
                for (int i = 1; i < rt.x.length; i++) path.lineTo(rt.x[i], rt.y[i]);
                c.drawPath(path, stroke);
            }
        }
        // 路面小石子
        fill.setColor(0x33A08660);
        for (Route rt : routes) {
            for (float d = 10; d < rt.total; d += 23) {
                rt.pointAt(d, tmp);
                float ox = (r.nextFloat() - 0.5f) * 44, oy = (r.nextFloat() - 0.5f) * 44;
                c.drawCircle(tmp[0] + ox, tmp[1] + oy, 2 + r.nextFloat() * 3, fill);
            }
        }
        // 城堡前的空地
        fill.setColor(0xFFDCC79E);
        c.drawOval(new RectF(380, 380, 620, 560), fill);

        // 树
        for (float[] t : trees) drawTree(c, t[0], t[1], t[2]);
        c.restore();
    }

    private void drawCliff(Canvas c) {
        Random r = new Random(11);
        float y = -300;
        while (y < 980) {
            float h = 120 + r.nextFloat() * 120;
            float edge = 40 + r.nextFloat() * 60 - (y > 700 ? (y - 700) * 0.25f : 0);
            path.reset();
            path.moveTo(-400, y);
            path.lineTo(edge - 30, y - 10);
            path.lineTo(edge + 20, y + h * 0.4f);
            path.lineTo(edge, y + h);
            path.lineTo(-400, y + h + 10);
            path.close();
            fill.setColor(0xFFB9B4AB);
            c.drawPath(path, fill);
            path.reset();
            path.moveTo(-400, y);
            path.lineTo(edge - 30, y - 10);
            path.lineTo(edge - 10, y + h * 0.35f);
            path.lineTo(-400, y + h * 0.5f);
            path.close();
            fill.setColor(0xFFE2DED7);
            c.drawPath(path, fill);
            y += h * 0.8f;
        }
    }

    private void drawTree(Canvas c, float x, float y, float s) {
        fill.setColor(0x33000000);
        rect.set(x - 18 * s + 6, y - 6 * s, x + 18 * s + 10, y + 8 * s);
        c.drawOval(rect, fill);
        fill.setColor(0xFF6B4A2E);
        c.drawRect(x - 3 * s, y - 14 * s, x + 3 * s, y, fill);
        path.reset();
        path.moveTo(x, y - 72 * s);
        path.lineTo(x - 21 * s, y - 10 * s);
        path.lineTo(x + 21 * s, y - 10 * s);
        path.close();
        fill.setColor(0xFF2C7550);
        c.drawPath(path, fill);
        path.reset();
        path.moveTo(x, y - 72 * s);
        path.lineTo(x, y - 10 * s);
        path.lineTo(x + 21 * s, y - 10 * s);
        path.close();
        fill.setColor(0xFF3A9165);
        c.drawPath(path, fill);
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

        if (bg != null) c.drawBitmap(bg, 0, 0, null);
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
                    spawnTimer = spawnInterval * (0.6f + rnd.nextFloat() * 0.8f);
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
            float d = dist(hx, hy, p.x, p.y);
            boolean inside = !hDead && d < 50;
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
                        fireArrow(p.x, p.y - 80 - p.level * 10, t, 10 + 7 * p.level, false);
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
                    fireArrow(CASTLE_X, CASTLE_Y - 150, t, 16 * castlePlot.level, true);
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
            case 1: hp = 20; sp = 112; dmg = 4; rad = 14; rew = 1; break;      // 快腿小鬼
            case 2: hp = 140; sp = 42; dmg = 14; rad = 25; rew = 3; break;     // 蛮牛
            case 3: hp = 750; sp = 34; dmg = 30; rad = 38; rew = 20; break;    // 首领
            default: hp = 32; sp = 62; dmg = 6; rad = 17; rew = 1; break;      // 红帽兵
        }
        float mult = 1 + 0.2f * (night - 1);
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
            if (dist(e.x, e.y, wx, wy) < 8) e.wp++;
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
        int total = 5 + night * 3;
        for (int i = 0; i < total; i++) {
            int kind = 0;
            float r = rnd.nextFloat();
            if (night >= 2 && r < 0.25f) kind = 1;
            else if (night >= 3 && r < 0.25f + Math.min(0.3f, 0.05f * night)) kind = 2;
            spawnQueue.add(new int[]{kind, act.get(i % act.size())});
        }
        if (night % 5 == 0) {
            for (int b = 0; b < night / 5; b++) spawnQueue.add(new int[]{3, act.get(b % act.size())});
        }
        spawnTimer = 1.2f;
        spawnInterval = Math.max(0.3f, 1.1f - 0.05f * night);
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
        for (int i = texts.size() - 1; i >= 0; i--) {
            FText t = texts.get(i);
            t.life -= dt;
            t.y -= 30 * dt;
            if (t.life <= 0) texts.remove(i);
        }
    }

    // ======================== 绘制世界 ========================
    private void drawWorld(Canvas c) {
        drawCastle(c);
        for (Plot p : plots) {
            if (p.unlock > night) continue;
            drawPlot(c, p);
        }
        for (Coin k : coinsOnGround) drawCoin(c, k);
        for (Enemy e : enemies) if (!e.dead) drawEnemy(c, e);
        for (Soldier s : soldiers) if (!s.dead) drawSoldier(c, s);
        if (!hDead) drawHero(c);
        else if (state == State.PLAY) {
            drawLabel(c, "复活 " + (int) Math.ceil(hRespawn), SPAWN_X, SPAWN_Y, 30, 0xFFFFFFFF);
        }
        for (Arrow a : arrows) drawArrow(c, a);
        for (Particle p : particles) {
            fill.setColor(p.color);
            fill.setAlpha((int) (255 * Math.max(0, p.life / p.max)));
            c.drawCircle(p.x, p.y, p.size, fill);
        }
        fill.setAlpha(255);
        for (FText t : texts) {
            int a = (int) (255 * Math.min(1, t.life / 0.6f));
            drawLabel(c, t.s, t.x, t.y, t.size, (t.color & 0x00FFFFFF) | (a << 24));
        }
    }

    private void shadow(Canvas c, float x, float y, float rx, float ry) {
        fill.setColor(0x38000000);
        rect.set(x - rx, y - ry, x + rx, y + ry);
        c.drawOval(rect, fill);
    }

    private void drawCastle(Canvas c) {
        float x = CASTLE_X, y = CASTLE_Y;
        int lv = castlePlot.level;
        shadow(c, x + 10, y + 85, 130, 30);
        int stone = cHit > 0 ? 0xFFFFE0E0 : 0xFFD3C7B2;
        // 侧塔
        for (int s = -1; s <= 1; s += 2) {
            float tx = x + s * 92;
            fill.setColor(0xFFB9AC95);
            c.drawRect(tx - 26, y - 110 - lv * 10, tx + 26, y + 85, fill);
            fill.setColor(stone);
            c.drawRect(tx - 26, y - 110 - lv * 10, tx + 10, y + 85, fill);
            path.reset();
            path.moveTo(tx - 34, y - 108 - lv * 10);
            path.lineTo(tx + 34, y - 108 - lv * 10);
            path.lineTo(tx, y - 170 - lv * 14);
            path.close();
            fill.setColor(0xFF3B67C2);
            c.drawPath(path, fill);
        }
        // 城墙主体
        fill.setColor(0xFFBDAF97);
        c.drawRect(x - 70, y - 40, x + 70, y + 85, fill);
        fill.setColor(stone);
        c.drawRect(x - 70, y - 40, x + 70, y + 60, fill);
        for (int i = 0; i < 6; i++) c.drawRect(x - 70 + i * 26, y - 56, x - 56 + i * 26, y - 40, fill);
        // 主楼
        fill.setColor(0xFFC8BBA4);
        c.drawRect(x - 42, y - 130, x + 42, y - 40, fill);
        path.reset();
        path.moveTo(x - 52, y - 128);
        path.lineTo(x + 52, y - 128);
        path.lineTo(x, y - 200 - lv * 12);
        path.close();
        fill.setColor(0xFF2F58AE);
        c.drawPath(path, fill);
        // 旗帜
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(4);
        stroke.setColor(0xFF5A3D24);
        float fy = y - 200 - lv * 12;
        c.drawLine(x, fy, x, fy - 50, stroke);
        path.reset();
        float wave = (float) Math.sin(time * 4) * 5;
        path.moveTo(x, fy - 50);
        path.lineTo(x + 40, fy - 42 + wave);
        path.lineTo(x, fy - 30);
        path.close();
        fill.setColor(0xFF2F7BEA);
        c.drawPath(path, fill);
        // 城门
        fill.setColor(0xFF5A3D24);
        rect.set(x - 26, y + 20, x + 26, y + 86);
        c.drawRoundRect(rect, 22, 22, fill);
        fill.setColor(0xFFFFD54A);
        c.drawCircle(x, y - 86, 12, fill);
        if (lv > 0) {
            fill.setColor(0xFFE9B82E);
            for (int i = 0; i < lv; i++) c.drawCircle(x - (lv - 1) * 14 + i * 28, y - 10, 7, fill);
        }
        // 血条
        drawBar(c, x, y - 240 - lv * 12, 200, 14, cHp / cMax, 0xFF4CD964);
    }

    private void drawPlot(Canvas c, Plot p) {
        boolean near = !hDead && dist(hx, hy, p.x, p.y) < 180;
        if (p.level == 0) {
            float pulse = p.pulse > 0 ? 1 + 0.12f * (float) Math.sin(p.pulse * 18) : 1;
            float rx = 66 * pulse, ry = 50 * pulse;
            path.reset();
            path.moveTo(p.x, p.y - ry);
            path.lineTo(p.x + rx, p.y);
            path.lineTo(p.x, p.y + ry);
            path.lineTo(p.x - rx, p.y);
            path.close();
            fill.setColor(0x9935804F);
            c.drawPath(path, fill);
            dash.setColor(0xF2FFFFFF);
            dash.setStrokeWidth(5);
            dash.setPathEffect(new DashPathEffect(new float[]{20, 13}, time * 20));
            c.drawPath(path, dash);
            dash.setPathEffect(null);
            drawCostTag(c, p, p.x, p.y + 4, 36);
            drawLabel(c, p.type == T_CASTLE ? "升级城堡" : TYPE_NAME[p.type], p.x, p.y + 36, 20, 0xDDFFFFFF);
            return;
        }
        switch (p.type) {
            case T_TOWER: drawTower(c, p); break;
            case T_WALL: drawWall(c, p); break;
            case T_HOUSE: drawHouse(c, p); break;
            case T_BARRACKS: drawBarracks(c, p); break;
            case T_CASTLE: drawMonument(c, p); break;
        }
        if (!p.maxed() && near) {
            dash.setColor(0xCCFFFFFF);
            dash.setStrokeWidth(4);
            dash.setPathEffect(new DashPathEffect(new float[]{14, 10}, time * 20));
            rect.set(p.x - 50, p.y - 26, p.x + 50, p.y + 26);
            c.drawOval(rect, dash);
            dash.setPathEffect(null);
            drawCostTag(c, p, p.x, p.y + 52, 26);
        }
        if (p.type == T_TOWER && near) {
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(2);
            stroke.setColor(0x55FFFFFF);
            c.drawCircle(p.x, p.y, 250 + 30 * p.level, stroke);
        }
    }

    private void drawCostTag(Canvas c, Plot p, float x, float y, float size) {
        int cost = p.nextCost();
        String s = (p.level > 0 ? "↑" : "") + (cost - p.paid);
        text.setTextSize(size);
        float tw = text.measureText(s);
        float cx = x - (tw + size * 0.9f) / 2;
        drawLabelLeft(c, s, cx, y + size * 0.36f, size, 0xFFFFFFFF);
        drawCoinIcon(c, cx + tw + size * 0.55f, y, size * 0.36f);
        if (p.paid > 0) {
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(7);
            stroke.setStrokeCap(Paint.Cap.ROUND);
            stroke.setColor(0xFFFFD54A);
            rect.set(x - 40, y - 40, x + 40, y + 40);
            c.drawArc(rect, -90, 360f * p.paid / cost, false, stroke);
        }
    }

    private void drawTower(Canvas c, Plot p) {
        float x = p.x, y = p.y;
        int lv = p.level;
        float h = 52 + lv * 14;
        shadow(c, x + 8, y + 4, 40, 14);
        fill.setColor(lv >= 3 ? 0xFF9A9389 : 0xFF7B5232);
        c.drawRect(x - 28, y - h, x - 20, y, fill);
        c.drawRect(x + 20, y - h, x + 28, y, fill);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(5);
        stroke.setColor(0xFF6A4529);
        c.drawLine(x - 24, y - 6, x + 24, y - h + 10, stroke);
        c.drawLine(x + 24, y - 6, x - 24, y - h + 10, stroke);
        fill.setColor(0xFF8F5E38);
        c.drawRect(x - 36, y - h - 12, x + 36, y - h + 4, fill);
        fill.setColor(0xFFA8744A);
        c.drawRect(x - 36, y - h - 12, x + 36, y - h - 6, fill);
        // 弓箭手
        fill.setColor(0xFF3D7BD9);
        c.drawCircle(x, y - h - 26, 14, fill);
        fill.setColor(0xFFF1C27D);
        c.drawCircle(x, y - h - 42, 9, fill);
        stroke.setColor(0xFFE9D3A1);
        stroke.setStrokeWidth(3);
        rect.set(x + 4, y - h - 44, x + 26, y - h - 12);
        c.drawArc(rect, -80, 160, false, stroke);
        if (lv >= 2) {
            path.reset();
            path.moveTo(x - 42, y - h - 56);
            path.lineTo(x + 42, y - h - 56);
            path.lineTo(x, y - h - 92);
            path.close();
            fill.setColor(0xFFB33A2E);
            c.drawPath(path, fill);
            stroke.setColor(0xFF6A4529);
            stroke.setStrokeWidth(4);
            c.drawLine(x - 34, y - h - 56, x - 34, y - h - 8, stroke);
            c.drawLine(x + 34, y - h - 56, x + 34, y - h - 8, stroke);
        }
        drawPips(c, x, y + 16, lv);
    }

    private void drawWall(Canvas c, Plot p) {
        float px = -p.dirY, py = p.dirX;
        boolean alive = p.hp > 0;
        int stakes = 9;
        for (int i = 0; i < stakes; i++) {
            float o = (i - (stakes - 1) / 2f) * 13;
            float x = p.x + px * o, y = p.y + py * o;
            float h = alive ? 46 + p.level * 6 : 12;
            fill.setColor(0x30000000);
            c.drawCircle(x + 5, y + 3, 8, fill);
            if (p.level >= 3 && alive) {
                fill.setColor(0xFF9A9389);
                c.drawRect(x - 7, y - 14, x + 7, y + 2, fill);
            }
            fill.setColor(alive ? (i % 2 == 0 ? 0xFF9C6A3F : 0xFF8A5C35) : 0xFF6E5038);
            c.drawRect(x - 6, y - h, x + 6, y, fill);
            path.reset();
            path.moveTo(x - 6, y - h);
            path.lineTo(x + 6, y - h);
            path.lineTo(x, y - h - 10);
            path.close();
            c.drawPath(path, fill);
        }
        if (alive && p.level >= 2) {
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(5);
            stroke.setColor(0xFF555A60);
            float o = (stakes - 1) / 2f * 13;
            c.drawLine(p.x - px * o, p.y - py * o - 24, p.x + px * o, p.y + py * o - 24, stroke);
        }
        if (alive && p.hp < p.maxHp) drawBar(c, p.x, p.y - 80, 90, 10, p.hp / p.maxHp, 0xFFFFB13B);
        if (!alive) drawLabel(c, "已损坏·天亮修复", p.x, p.y - 30, 18, 0xCCFFFFFF);
        drawPips(c, p.x, p.y + 20, p.level);
    }

    private void drawHouse(Canvas c, Plot p) {
        float x = p.x, y = p.y;
        int lv = p.level;
        float w = 34 + lv * 4;
        shadow(c, x + 8, y + 4, w + 10, 14);
        fill.setColor(0xFFE8DCC4);
        c.drawRect(x - w, y - 44, x + w, y, fill);
        fill.setColor(0xFFD6C8AD);
        c.drawRect(x + w * 0.4f, y - 44, x + w, y, fill);
        fill.setColor(0xFF5A3D24);
        c.drawRect(x - 8, y - 24, x + 8, y, fill);
        fill.setColor(lv >= 2 ? 0xFFFFE08A : 0xFF8FB4D8);
        c.drawRect(x - w + 8, y - 34, x - w + 20, y - 22, fill);
        c.drawRect(x + w - 20, y - 34, x + w - 8, y - 22, fill);
        fill.setColor(0xFF5C3A20);
        c.drawRect(x + w * 0.4f, y - 92, x + w * 0.4f + 12, y - 60, fill);
        path.reset();
        path.moveTo(x - w - 10, y - 44);
        path.lineTo(x + w + 10, y - 44);
        path.lineTo(x + w - 6, y - 80);
        path.lineTo(x - w + 6, y - 80);
        path.close();
        fill.setColor(lv >= 3 ? 0xFF3B67C2 : 0xFF7A4E2D);
        c.drawPath(path, fill);
        drawPips(c, x, y + 16, lv);
        if (!isNight) drawLabel(c, "+" + (lv * 4), x, y - 98, 20, 0xFFFFE27A);
    }

    private void drawBarracks(Canvas c, Plot p) {
        float x = p.x, y = p.y;
        int lv = p.level;
        shadow(c, x + 8, y + 4, 56, 16);
        fill.setColor(0xFFCDBFA6);
        c.drawRect(x - 46, y - 50, x + 46, y, fill);
        fill.setColor(0xFFB9AA8F);
        c.drawRect(x + 16, y - 50, x + 46, y, fill);
        fill.setColor(0xFF5A3D24);
        rect.set(x - 14, y - 32, x + 14, y);
        c.drawRoundRect(rect, 10, 10, fill);
        path.reset();
        path.moveTo(x - 54, y - 50);
        path.lineTo(x + 54, y - 50);
        path.lineTo(x + 40, y - 82);
        path.lineTo(x - 40, y - 82);
        path.close();
        fill.setColor(0xFF6E4A2E);
        c.drawPath(path, fill);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(4);
        stroke.setColor(0xFF4A3220);
        c.drawLine(x - 40, y - 82, x - 40, y - 130, stroke);
        path.reset();
        float wave = (float) Math.sin(time * 5 + x) * 4;
        path.moveTo(x - 40, y - 130);
        path.lineTo(x - 6, y - 122 + wave);
        path.lineTo(x - 40, y - 108);
        path.close();
        fill.setColor(0xFF2F7BEA);
        c.drawPath(path, fill);
        // 盾徽
        fill.setColor(0xFFE9B82E);
        c.drawCircle(x + 26, y - 30, 10, fill);
        drawPips(c, x, y + 16, lv);
    }

    private void drawMonument(Canvas c, Plot p) {
        float x = p.x, y = p.y;
        shadow(c, x + 6, y + 4, 34, 12);
        fill.setColor(0xFFB9AC95);
        c.drawRect(x - 24, y - 30, x + 24, y, fill);
        fill.setColor(0xFFD3C7B2);
        c.drawRect(x - 24, y - 30, x + 8, y, fill);
        drawCrown(c, x, y - 46, 20);
        drawPips(c, x, y + 16, p.level);
    }

    private void drawCrown(Canvas c, float x, float y, float s) {
        path.reset();
        path.moveTo(x - s, y + s * 0.6f);
        path.lineTo(x - s, y - s * 0.4f);
        path.lineTo(x - s * 0.5f, y + s * 0.1f);
        path.lineTo(x, y - s * 0.7f);
        path.lineTo(x + s * 0.5f, y + s * 0.1f);
        path.lineTo(x + s, y - s * 0.4f);
        path.lineTo(x + s, y + s * 0.6f);
        path.close();
        fill.setColor(0xFFF4C430);
        c.drawPath(path, fill);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(2);
        stroke.setColor(0xFF9C7410);
        c.drawPath(path, stroke);
    }

    private void drawPips(Canvas c, float x, float y, int lv) {
        for (int i = 0; i < lv; i++) {
            float px = x - (lv - 1) * 9 + i * 18;
            fill.setColor(0xFF6B4E0E);
            c.drawCircle(px, y + 1, 7, fill);
            fill.setColor(0xFFFFD54A);
            c.drawCircle(px, y, 6, fill);
        }
    }

    private void drawEnemy(Canvas c, Enemy e) {
        float bob = (float) Math.abs(Math.sin(e.phase)) * 4;
        float x = e.x, y = e.y - bob;
        shadow(c, e.x + 4, e.y + e.r * 0.6f, e.r * 1.0f, e.r * 0.4f);
        int body, dark;
        switch (e.kind) {
            case 1: body = 0xFFFF6A3D; dark = 0xFFB0401F; break;
            case 2: body = 0xFFC62828; dark = 0xFF7A1414; break;
            case 3: body = 0xFF8E2BC9; dark = 0xFF4E137A; break;
            default: body = 0xFFE53935; dark = 0xFF8E1C1A; break;
        }
        if (e.hit > 0) { body = 0xFFFFFFFF; dark = 0xFFDDDDDD; }
        // 角
        if (e.kind >= 2) {
            fill.setColor(0xFFF2EBDC);
            for (int s = -1; s <= 1; s += 2) {
                path.reset();
                path.moveTo(x + s * e.r * 0.5f, y - e.r * 1.1f);
                path.lineTo(x + s * e.r * 1.05f, y - e.r * 1.9f);
                path.lineTo(x + s * e.r * 0.85f, y - e.r * 0.9f);
                path.close();
                c.drawPath(path, fill);
            }
        }
        fill.setColor(dark);
        c.drawCircle(x, y - e.r * 0.5f + 3, e.r, fill);
        fill.setColor(body);
        c.drawCircle(x, y - e.r * 0.5f, e.r * 0.92f, fill);
        // 头盔/头
        fill.setColor(dark);
        c.drawCircle(x, y - e.r * 1.25f, e.r * 0.55f, fill);
        fill.setColor(0xFFFFFFFF);
        float ex = e.faceX * e.r * 0.25f, ey = e.faceY * e.r * 0.15f;
        c.drawCircle(x - e.r * 0.22f + ex, y - e.r * 1.25f + ey, e.r * 0.13f, fill);
        c.drawCircle(x + e.r * 0.22f + ex, y - e.r * 1.25f + ey, e.r * 0.13f, fill);
        if (e.kind == 3) drawCrown(c, x, y - e.r * 1.95f, e.r * 0.45f);
        // 武器
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(e.kind >= 2 ? 6 : 4);
        stroke.setColor(0xFF9E9E9E);
        float wx = x + e.faceX * e.r * 1.1f, wy = y - e.r * 0.4f + e.faceY * e.r * 0.6f;
        c.drawLine(wx, wy, wx + e.faceX * e.r * 0.8f, wy + e.faceY * e.r * 0.8f - e.r * 0.5f, stroke);
        if (e.hp < e.maxHp) drawBar(c, e.x, y - e.r * 2.3f, e.r * 2.6f, 7, e.hp / e.maxHp, 0xFFFF4D4D);
    }

    private void drawSoldier(Canvas c, Soldier s) {
        shadow(c, s.x + 3, s.y + 6, 12, 5);
        fill.setColor(0xFF9FB3CF);
        c.drawCircle(s.x, s.y - 4, 12, fill);
        fill.setColor(0xFFDDE6F5);
        c.drawCircle(s.x, s.y - 6, 10, fill);
        fill.setColor(0xFF7A8899);
        c.drawCircle(s.x, s.y - 20, 7, fill);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(3);
        stroke.setColor(0xFF6A4529);
        float a = s.swing > 0 ? -18 : 0;
        c.drawLine(s.x + 10, s.y + 4, s.x + 16, s.y - 30 + a * 0.3f, stroke);
        fill.setColor(0xFF2F7BEA);
        c.drawRect(s.x - 15, s.y - 12, s.x - 9, s.y + 2, fill);
        if (s.hp < s.maxHp) drawBar(c, s.x, s.y - 36, 30, 5, s.hp / s.maxHp, 0xFF4CD964);
    }

    private void drawHero(Canvas c) {
        float bob = (float) Math.abs(Math.sin(hWalk)) * 3;
        float x = hx, y = hy - bob;
        shadow(c, hx + 4, hy + 10, 24, 9);
        // 披风
        fill.setColor(0xFF2556C9);
        c.drawCircle(x - hFaceX * 8, y - 12 - hFaceY * 6, 22, fill);
        // 身体
        fill.setColor(0xFF8C6A12);
        c.drawCircle(x, y - 12, 19, fill);
        fill.setColor(0xFFE9B82E);
        c.drawCircle(x, y - 14, 17, fill);
        fill.setColor(0xFFF7D774);
        c.drawCircle(x - 5, y - 19, 6, fill);
        // 头 + 王冠
        fill.setColor(0xFFF1C27D);
        c.drawCircle(x, y - 38, 11, fill);
        drawCrown(c, x, y - 52, 10);
        // 剑
        double base = Math.atan2(hFaceY, hFaceX);
        double ang = base + (hSwing > 0 ? (hSwing / 0.22f - 0.5f) * 2.2f : 0.4f);
        float sx = x + (float) Math.cos(ang) * 14, sy = y - 14 + (float) Math.sin(ang) * 14;
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeWidth(6);
        stroke.setColor(0xFFF2F4F8);
        c.drawLine(sx, sy, sx + (float) Math.cos(ang) * 34, sy + (float) Math.sin(ang) * 34, stroke);
        if (hSwing > 0) {
            stroke.setStrokeWidth(4);
            stroke.setColor(0x88FFFFFF);
            rect.set(x - 55, y - 69, x + 55, y + 41);
            c.drawArc(rect, (float) Math.toDegrees(base) - 60, 120, false, stroke);
        }
        if (hHp < hMax) drawBar(c, hx, y - 72, 56, 8, hHp / hMax, 0xFF4CD964);
    }

    private void drawArrow(Canvas c, Arrow a) {
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        if (a.big) {
            fill.setColor(0xFFFFE08A);
            c.drawCircle(a.x, a.y, 9, fill);
            fill.setColor(0xFFFF9C2A);
            c.drawCircle(a.x, a.y, 5, fill);
            return;
        }
        stroke.setStrokeWidth(3);
        stroke.setColor(0xFFF5E6C8);
        c.drawLine(a.x - a.vx * 22, a.y - a.vy * 22, a.x, a.y, stroke);
    }

    private void drawCoin(Canvas c, Coin k) {
        if (k.life < 5 && ((int) (k.life * 8)) % 2 == 0) return;
        shadow(c, k.x + 2, k.y + 4, 9, 4);
        drawCoinIcon(c, k.x, k.y - k.z - 6, 10);
    }

    private void drawCoinIcon(Canvas c, float x, float y, float r) {
        fill.setColor(0xFFB8860B);
        c.drawCircle(x, y + r * 0.15f, r, fill);
        fill.setColor(0xFFFFC928);
        c.drawCircle(x, y, r, fill);
        fill.setColor(0xFFFFE27A);
        c.drawCircle(x - r * 0.25f, y - r * 0.25f, r * 0.45f, fill);
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

    private void drawLabel(Canvas c, String s, float x, float y, float size, int color) {
        text.setTextSize(size);
        text.setTextAlign(Paint.Align.CENTER);
        text.setStyle(Paint.Style.STROKE);
        text.setStrokeWidth(size * 0.16f);
        text.setColor((color & 0xFF000000) | 0x002A1A0A);
        c.drawText(s, x, y, text);
        text.setStyle(Paint.Style.FILL);
        text.setColor(color);
        c.drawText(s, x, y, text);
    }

    private void drawLabelLeft(Canvas c, String s, float x, float y, float size, int color) {
        text.setTextSize(size);
        text.setTextAlign(Paint.Align.LEFT);
        text.setStyle(Paint.Style.STROKE);
        text.setStrokeWidth(size * 0.16f);
        text.setColor((color & 0xFF000000) | 0x002A1A0A);
        c.drawText(s, x, y, text);
        text.setStyle(Paint.Style.FILL);
        text.setColor(color);
        c.drawText(s, x, y, text);
    }

    // ======================== HUD ========================
    private void drawHud(Canvas c) {
        float u = dp;
        if (state == State.MENU) { drawMenu(c); return; }

        // 金币
        fill.setColor(0x99000000);
        rect.set(14 * u, 34 * u, 150 * u, 78 * u);
        c.drawRoundRect(rect, 22 * u, 22 * u, fill);
        drawCoinIcon(c, 38 * u, 56 * u, 13 * u);
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

        if (isNight) {
            int left = spawnQueue.size();
            for (Enemy e : enemies) if (!e.dead) left++;
            drawLabel(c, "剩余敌人 " + left, sw / 2f, 104 * u, 17 * u, 0xFFFFB0B0);
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
            drawLabel(c, "⚔ 迎战第 " + night + " 夜", cx, cy + 9 * u, 24 * u, 0xFFFFFFFF);
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
        drawCrown(c, sw / 2f, y - 70 * u, 34 * u);
        drawLabel(c, "小小王国守卫战", sw / 2f, y, 42 * u, 0xFFFFD54A);
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
