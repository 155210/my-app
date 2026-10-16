package com.example.tapgame;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.Random;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(new GameView(this));
    }

    /**
     * 数字门大作战：
     * - 左右拖动控制小队，小队自动向前射击
     * - 射击 "+/-" 数字门会让数字 +1，穿过门按数字增减士兵；"×" "÷" 门不能被打变
     * - 打爆 "武器+1" 桶可以增加火力，撞上没打爆的桶会损失士兵
     * - 僵尸碰到小队会消灭士兵，关底 Boss 碰到小队时用士兵数和它的剩余血量硬拼
     */
    static class GameView extends View {
        private enum State { MENU, PLAYING, WIN, LOSE }

        private static final int G_ADD = 0, G_MUL = 1, G_DIV = 2;
        private static final int MAX_SOLDIERS = 999;

        static class Gate { float y; boolean left; int type; int value; float flash; boolean used; }
        static class Barrel { float y; boolean left; int hp; float flash; boolean dead; boolean used; }
        static class Zombie { float x, y; int hp; float phase; }
        static class Bullet { float x, y; }
        static class FloatText { String s; float x, y, life; int color; }

        private final ArrayList<Gate> gates = new ArrayList<>();
        private final ArrayList<Barrel> barrels = new ArrayList<>();
        private final ArrayList<Zombie> zombies = new ArrayList<>();
        private final ArrayList<Bullet> bullets = new ArrayList<>();
        private final ArrayList<FloatText> texts = new ArrayList<>();

        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        private final Random rnd = new Random();
        private final SharedPreferences prefs;
        private final float dp;

        private State state = State.MENU;
        private int level = 1, bestLevel;
        private int soldiers, weapon;
        private float squadX, lastTouchX;
        private float fireTimer, roadScroll;
        private long lastFrame;

        private boolean bossAlive;
        private float bossY, bossFlash;
        private int bossHp, bossMaxHp;

        GameView(Context context) {
            super(context);
            dp = getResources().getDisplayMetrics().density;
            prefs = context.getSharedPreferences("numbergate", Context.MODE_PRIVATE);
            bestLevel = prefs.getInt("bestLevel", 1);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
        }

        // ---------- 布局辅助 ----------
        private float W() { return getWidth(); }
        private float H() { return getHeight(); }
        private float roadL() { return W() * 0.06f; }
        private float roadR() { return W() * 0.94f; }
        private float mid() { return W() / 2f; }
        private float playerY() { return H() * 0.80f; }
        private float gateH() { return 58 * dp; }
        private float spacing() { return 13 * dp; }

        private int squadCols() {
            int n = Math.min(soldiers, 60);
            return Math.max(1, Math.min(8, (int) Math.ceil(Math.sqrt(n))));
        }

        private float squadHalfW() { return squadCols() * spacing() / 2f + 6 * dp; }

        private float laneLeft(boolean left) { return left ? roadL() : mid() + 4 * dp; }
        private float laneRight(boolean left) { return left ? mid() - 4 * dp : roadR(); }

        // ---------- 关卡 ----------
        private void startLevel(int lv) {
            level = lv;
            soldiers = 5;
            weapon = 1;
            squadX = mid();
            fireTimer = 0;
            gates.clear(); barrels.clear(); zombies.clear(); bullets.clear(); texts.clear();

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
            bossY = y - gap * 0.3f;
            bossMaxHp = bossHp = 60 + lv * 45;
            state = State.PLAYING;
            lastFrame = System.nanoTime();
        }

        private void addGatePair(float y, int lv) {
            boolean goodLeft = rnd.nextBoolean();
            Gate a = new Gate(), b = new Gate();
            a.y = b.y = y;
            a.left = goodLeft;
            b.left = !goodLeft;
            int r = rnd.nextInt(100);
            if (r < 18) {                      // 乘法门 vs 减法门
                a.type = G_MUL; a.value = lv >= 3 && rnd.nextBoolean() ? 3 : 2;
                b.type = G_ADD; b.value = -(4 + rnd.nextInt(4 + lv));
            } else if (r < 28) {               // 除法门 vs 小加法门
                a.type = G_ADD; a.value = 1 + rnd.nextInt(3);
                b.type = G_DIV; b.value = 2;
            } else if (r < 55) {               // 两个都是负的，打得多的那个就变好
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
            int hp = 1 + lv / 3;
            float l = roadL() + 20 * dp, rr = roadR() - 20 * dp;
            int lane = rnd.nextInt(3); // 0 左, 1 右, 2 全宽
            if (lane == 0) rr = mid() - 10 * dp;
            if (lane == 1) l = mid() + 10 * dp;
            for (int i = 0; i < n; i++) {
                Zombie z = new Zombie();
                z.x = l + rnd.nextFloat() * (rr - l);
                z.y = y + rnd.nextFloat() * 110 * dp - 55 * dp;
                z.hp = hp;
                z.phase = rnd.nextFloat() * 6.28f;
                zombies.add(z);
            }
        }

        private void addBarrelRow(float y, int lv) {
            Barrel b = new Barrel();
            b.y = y;
            b.left = rnd.nextBoolean();
            b.hp = 8 + rnd.nextInt(6) + lv * 4;
            barrels.add(b);
            if (rnd.nextBoolean()) { // 另一边放一个数字门
                Gate g = new Gate();
                g.y = y;
                g.left = !b.left;
                g.type = G_ADD;
                g.value = rnd.nextBoolean() ? 1 + rnd.nextInt(4) : -(2 + rnd.nextInt(4 + lv));
                gates.add(g);
            }
        }

        // ---------- 逻辑 ----------
        private void addText(String s, float x, float y, int color) {
            FloatText t = new FloatText();
            t.s = s; t.x = x; t.y = y; t.life = 1f; t.color = color;
            texts.add(t);
        }

        private void setSoldiers(int n) {
            soldiers = Math.max(0, Math.min(MAX_SOLDIERS, n));
        }

        private void update(float dt) {
            float speed = H() * 0.22f * (1 + 0.04f * level);
            float move = speed * dt;
            roadScroll = (roadScroll + move) % (60 * dp);

            float halfW = squadHalfW();
            squadX = Math.max(roadL() + halfW, Math.min(roadR() - halfW, squadX));
            boolean inLeft = squadX < mid();
            float py = playerY();

            // 开火
            fireTimer -= dt;
            if (fireTimer <= 0) {
                fireTimer = 0.11f;
                int streams = Math.min(weapon + 1, Math.max(1, soldiers));
                float span = Math.min(halfW * 1.6f, streams * 10 * dp);
                for (int i = 0; i < streams; i++) {
                    Bullet b = new Bullet();
                    b.x = streams == 1 ? squadX : squadX - span / 2 + span * i / (streams - 1);
                    b.y = py - 14 * dp;
                    bullets.add(b);
                }
            }

            // 移动物体
            for (Gate g : gates) { g.y += move; g.flash = Math.max(0, g.flash - dt * 5); }
            for (Barrel b : barrels) { b.y += move; b.flash = Math.max(0, b.flash - dt * 5); }
            for (Zombie z : zombies) { z.y += move + H() * 0.05f * dt; z.phase += dt * 8; }
            if (bossAlive) {
                bossY += bossY < H() * 0.25f ? move : move * 0.35f;
                bossFlash = Math.max(0, bossFlash - dt * 5);
            }

            // 子弹碰撞
            float bulletMove = H() * 1.5f * dt;
            float zr = 9 * dp, bossR = 46 * dp;
            Iterator<Bullet> bi = bullets.iterator();
            outer:
            while (bi.hasNext()) {
                Bullet b = bi.next();
                b.y -= bulletMove;
                if (b.y < 0) { bi.remove(); continue; }

                if (bossAlive && Math.abs(b.x - mid()) < bossR && Math.abs(b.y - bossY) < bossR) {
                    bossHp--; bossFlash = 1; bi.remove();
                    if (bossHp <= 0) {
                        bossAlive = false;
                        addText("Boss 击败！", mid(), bossY, 0xFFFFD54F);
                        winLevel();
                        return;
                    }
                    continue;
                }
                for (Iterator<Zombie> zi = zombies.iterator(); zi.hasNext(); ) {
                    Zombie z = zi.next();
                    float dx = b.x - z.x, dy = b.y - z.y;
                    if (dx * dx + dy * dy < (zr + 3 * dp) * (zr + 3 * dp)) {
                        if (--z.hp <= 0) zi.remove();
                        bi.remove();
                        continue outer;
                    }
                }
                float gh = gateH() / 2;
                for (Barrel br : barrels) {
                    if (br.dead || br.y < 0) continue;
                    if (b.x > laneLeft(br.left) && b.x < laneRight(br.left) && Math.abs(b.y - br.y) < gh) {
                        br.flash = 1; bi.remove();
                        if (--br.hp <= 0) {
                            br.dead = true;
                            weapon = Math.min(8, weapon + 1);
                            addText("火力升级！", (laneLeft(br.left) + laneRight(br.left)) / 2, br.y, 0xFFFFB300);
                        }
                        continue outer;
                    }
                }
                for (Gate g : gates) {
                    if (g.used || g.y < 0) continue;
                    if (b.x > laneLeft(g.left) && b.x < laneRight(g.left) && Math.abs(b.y - g.y) < gh) {
                        if (g.type == G_ADD && g.value < 99) { g.value++; g.flash = 1; }
                        bi.remove();
                        continue outer;
                    }
                }
            }

            // 穿过门
            for (Gate g : gates) {
                if (g.used || g.y < py) continue;
                g.used = true;
                if (g.left != inLeft) continue;
                int before = soldiers;
                if (g.type == G_ADD) setSoldiers(soldiers + g.value);
                else if (g.type == G_MUL) setSoldiers(soldiers * g.value);
                else setSoldiers((soldiers + 1) / g.value);
                int diff = soldiers - before;
                addText((diff >= 0 ? "+" : "") + diff, squadX, py - 40 * dp,
                        diff >= 0 ? 0xFF69F0AE : 0xFFFF5252);
            }
            for (Barrel br : barrels) {
                if (br.used || br.y < py) continue;
                br.used = true;
                if (!br.dead && br.left == inLeft) {
                    setSoldiers(soldiers - br.hp);
                    addText("-" + br.hp, squadX, py - 40 * dp, 0xFFFF5252);
                    br.dead = true;
                }
            }

            // 僵尸接触
            for (Iterator<Zombie> zi = zombies.iterator(); zi.hasNext(); ) {
                Zombie z = zi.next();
                if (z.y > H() + 40 * dp) { zi.remove(); continue; }
                if (z.y > py - 10 * dp && z.y < py + 60 * dp && Math.abs(z.x - squadX) < halfW + zr) {
                    setSoldiers(soldiers - 1);
                    zi.remove();
                }
            }

            // Boss 接触：兵数和剩余血量硬拼
            if (bossAlive && bossY + bossR > py) {
                bossAlive = false;
                int left = soldiers - bossHp;
                setSoldiers(left);
                if (soldiers > 0) {
                    addText("硬拼成功！", mid(), py - 60 * dp, 0xFFFFD54F);
                    winLevel();
                    return;
                }
            }

            // 清理
            float limit = H() + 80 * dp; // 不用 removeIf：它需要 Android 7.0+
            for (Iterator<Gate> gi = gates.iterator(); gi.hasNext(); ) if (gi.next().y > limit) gi.remove();
            for (Iterator<Barrel> ri = barrels.iterator(); ri.hasNext(); ) if (ri.next().y > limit) ri.remove();
            for (Iterator<FloatText> ti = texts.iterator(); ti.hasNext(); ) {
                FloatText t = ti.next();
                t.life -= dt;
                t.y -= 40 * dp * dt;
                if (t.life <= 0) ti.remove();
            }

            if (soldiers <= 0) state = State.LOSE;
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
                    invalidate();
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
            if (state == State.PLAYING && getWidth() > 0) update(dt);

            drawWorld(c);
            if (state == State.PLAYING) {
                drawHud(c);
            } else {
                drawOverlay(c);
            }
            postInvalidateOnAnimation();
        }

        private void drawWorld(Canvas c) {
            float w = W(), h = H();
            c.drawColor(0xFF4E7A3A); // 草地
            paint.setColor(0xFF8D7B62);
            c.drawRect(roadL(), 0, roadR(), h, paint);
            paint.setColor(0xFF6D5E4A);
            c.drawRect(roadL() - 6 * dp, 0, roadL(), h, paint);
            c.drawRect(roadR(), 0, roadR() + 6 * dp, h, paint);
            // 中线
            paint.setColor(0x55FFFFFF);
            float seg = 60 * dp;
            for (float y = -seg + roadScroll; y < h; y += seg) {
                c.drawRect(mid() - 2 * dp, y, mid() + 2 * dp, y + seg * 0.5f, paint);
            }
            if (state == State.MENU) return;

            float gh = gateH() / 2;
            // 门
            for (Gate g : gates) {
                if (g.y < -gh || g.y > h + gh) continue;
                float l = laneLeft(g.left), r = laneRight(g.left);
                boolean good = g.type == G_MUL || (g.type == G_ADD && g.value > 0);
                int base = good ? 0xFF2979FF : 0xFFE53935;
                paint.setColor(g.used ? 0x55FFFFFF & base : (0xB0FFFFFF & base));
                rect.set(l + 4 * dp, g.y - gh, r - 4 * dp, g.y + gh);
                c.drawRoundRect(rect, 10 * dp, 10 * dp, paint);
                if (g.flash > 0) {
                    paint.setColor(Color.argb((int) (g.flash * 120), 255, 255, 255));
                    c.drawRoundRect(rect, 10 * dp, 10 * dp, paint);
                }
                paint.setColor(0xFF37474F);
                c.drawRect(l, g.y - gh - 6 * dp, l + 6 * dp, g.y + gh, paint);
                c.drawRect(r - 6 * dp, g.y - gh - 6 * dp, r, g.y + gh, paint);
                String label;
                if (g.type == G_MUL) label = "×" + g.value;
                else if (g.type == G_DIV) label = "÷" + g.value;
                else label = (g.value > 0 ? "+" : "") + g.value;
                paint.setColor(Color.WHITE);
                paint.setTextSize(30 * dp);
                c.drawText(label, (l + r) / 2, g.y + 11 * dp, paint);
            }
            // 武器桶
            for (Barrel b : barrels) {
                if (b.dead || b.y < -gh || b.y > h + gh) continue;
                float l = laneLeft(b.left) + 18 * dp, r = laneRight(b.left) - 18 * dp;
                paint.setColor(b.flash > 0 ? 0xFFFF8A65 : 0xFFC62828);
                rect.set(l, b.y - gh, r, b.y + gh);
                c.drawRoundRect(rect, 8 * dp, 8 * dp, paint);
                paint.setColor(0xFF8E0000);
                c.drawRect(l, b.y - gh * 0.55f, r, b.y - gh * 0.4f, paint);
                c.drawRect(l, b.y + gh * 0.4f, r, b.y + gh * 0.55f, paint);
                paint.setColor(0xFFFFD54F);
                paint.setTextSize(15 * dp);
                c.drawText("武器+1", (l + r) / 2, b.y - 6 * dp, paint);
                paint.setColor(Color.WHITE);
                paint.setTextSize(24 * dp);
                c.drawText(String.valueOf(b.hp), (l + r) / 2, b.y + 20 * dp, paint);
            }
            // 僵尸
            float zr = 9 * dp;
            for (Zombie z : zombies) {
                if (z.y < -zr || z.y > h + zr) continue;
                float wob = (float) Math.sin(z.phase) * 2 * dp;
                paint.setColor(0xFF2E5E3E);
                c.drawCircle(z.x + wob, z.y + 4 * dp, zr, paint);
                paint.setColor(z.hp > 1 ? 0xFF9CCC65 : 0xFF7CB342);
                c.drawCircle(z.x + wob, z.y - 5 * dp, zr * 0.65f, paint);
            }
            // Boss
            if (bossAlive && bossY > -60 * dp) {
                float br = 46 * dp;
                paint.setColor(bossFlash > 0 ? 0xFFCE93D8 : 0xFF6A1B9A);
                c.drawCircle(mid(), bossY, br, paint);
                paint.setColor(0xFF4A148C);
                c.drawCircle(mid(), bossY - br * 0.6f, br * 0.45f, paint);
                paint.setColor(0xFFFF1744);
                c.drawCircle(mid() - 8 * dp, bossY - br * 0.65f, 4 * dp, paint);
                c.drawCircle(mid() + 8 * dp, bossY - br * 0.65f, 4 * dp, paint);
                // 血条
                float bw = 120 * dp, top = bossY - br - 26 * dp;
                paint.setColor(0xAA000000);
                c.drawRect(mid() - bw / 2, top, mid() + bw / 2, top + 10 * dp, paint);
                paint.setColor(0xFFFF5252);
                c.drawRect(mid() - bw / 2, top, mid() - bw / 2 + bw * bossHp / bossMaxHp, top + 10 * dp, paint);
                paint.setColor(Color.WHITE);
                paint.setTextSize(20 * dp);
                c.drawText("BOSS " + bossHp, mid(), top - 6 * dp, paint);
            }
            // 子弹
            paint.setColor(0xFFFFF176);
            for (Bullet b : bullets) {
                c.drawRect(b.x - 1.5f * dp, b.y - 7 * dp, b.x + 1.5f * dp, b.y + 3 * dp, paint);
            }
            // 小队
            if (soldiers > 0) drawSquad(c);
            // 飘字
            for (FloatText t : texts) {
                paint.setColor((t.color & 0x00FFFFFF) | ((int) (Math.min(1, t.life) * 255) << 24));
                paint.setTextSize(26 * dp);
                c.drawText(t.s, t.x, t.y, paint);
            }
        }

        private void drawSquad(Canvas c) {
            int n = Math.min(soldiers, 60);
            int cols = squadCols();
            float sp = spacing(), py = playerY();
            for (int i = 0; i < n; i++) {
                int row = i / cols, col = i % cols;
                float x = squadX + (col - (cols - 1) / 2f) * sp;
                float y = py + row * sp * 0.85f;
                paint.setColor(0xFF5D4037);
                c.drawCircle(x, y + 3 * dp, 5.5f * dp, paint);
                paint.setColor(0xFFFFCC80);
                c.drawCircle(x, y - 3 * dp, 3.8f * dp, paint);
                paint.setColor(0xFFFFD54F);
                c.drawCircle(x, y - 5 * dp, 3.2f * dp, paint);
            }
            // 兵数气泡
            String s = String.valueOf(soldiers);
            paint.setTextSize(20 * dp);
            float tw = paint.measureText(s) + 20 * dp;
            float top = py - 44 * dp;
            paint.setColor(0xFF1E88E5);
            rect.set(squadX - tw / 2, top, squadX + tw / 2, top + 26 * dp);
            c.drawRoundRect(rect, 13 * dp, 13 * dp, paint);
            paint.setColor(Color.WHITE);
            c.drawText(s, squadX, top + 20 * dp, paint);
        }

        private void drawHud(Canvas c) {
            paint.setColor(0x88000000);
            c.drawRect(0, 0, W(), 44 * dp, paint);
            paint.setColor(Color.WHITE);
            paint.setTextSize(17 * dp);
            paint.setTextAlign(Paint.Align.LEFT);
            c.drawText("第 " + level + " 关", 14 * dp, 29 * dp, paint);
            paint.setTextAlign(Paint.Align.RIGHT);
            c.drawText("火力 Lv" + weapon + "   士兵 " + soldiers, W() - 14 * dp, 29 * dp, paint);
            paint.setTextAlign(Paint.Align.CENTER);
        }

        private void drawOverlay(Canvas c) {
            float w = W(), h = H();
            paint.setColor(0xB0000000);
            c.drawRect(0, 0, w, h, paint);
            paint.setColor(Color.WHITE);
            paint.setTextSize(40 * dp);
            String title, sub;
            if (state == State.MENU) {
                title = "数字门大作战";
                sub = "从第 " + bestLevel + " 关开始";
            } else if (state == State.WIN) {
                title = "第 " + level + " 关通过！";
                sub = "剩余士兵 " + soldiers;
            } else {
                title = "小队全灭";
                sub = "第 " + level + " 关";
            }
            c.drawText(title, w / 2, h * 0.32f, paint);
            paint.setTextSize(19 * dp);
            paint.setColor(0xFFB0BEC5);
            c.drawText(sub, w / 2, h * 0.32f + 40 * dp, paint);

            if (state == State.MENU) {
                paint.setTextSize(16 * dp);
                String[] tips = {
                        "左右拖动屏幕控制小队，自动开火",
                        "射击数字门，每打中一发数字 +1",
                        "穿过门：士兵按门上数字增减",
                        "打爆「武器+1」桶，火力升级",
                        "躲开或消灭僵尸，最后打败 Boss"
                };
                for (int i = 0; i < tips.length; i++) {
                    c.drawText(tips[i], w / 2, h * 0.47f + i * 28 * dp, paint);
                }
            }
            paint.setColor(0xFFFFB300);
            paint.setTextSize(22 * dp);
            String action = state == State.MENU ? "点击屏幕开始"
                    : state == State.WIN ? "点击进入下一关" : "点击重新挑战";
            c.drawText(action, w / 2, h * 0.80f, paint);
        }
    }
}
