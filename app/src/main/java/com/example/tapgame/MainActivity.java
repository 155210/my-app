package com.example.tapgame;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;

import java.util.Random;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(new GameView(this));
    }

    /** 点击小圆点：30 秒内点中越多越好，每点中一次圆会变小一点。 */
    static class GameView extends View {
        private static final long GAME_MS = 30_000;
        private static final int[] COLORS = {
                0xFFFF5252, 0xFFFFB300, 0xFF00C853, 0xFF2979FF, 0xFFD500F9, 0xFF00B8D4
        };

        private enum State { READY, PLAYING, OVER }

        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Random random = new Random();
        private final SharedPreferences prefs;

        private State state = State.READY;
        private float cx, cy, radius;
        private int color;
        private int score, best, misses;
        private long endTime;
        private final float density;

        GameView(Context context) {
            super(context);
            density = getResources().getDisplayMetrics().density;
            prefs = context.getSharedPreferences("game", Context.MODE_PRIVATE);
            best = prefs.getInt("best", 0);
            paint.setTextAlign(Paint.Align.CENTER);
        }

        private void startGame() {
            score = 0;
            misses = 0;
            radius = 60 * density;
            endTime = SystemClock.uptimeMillis() + GAME_MS;
            state = State.PLAYING;
            moveDot();
            invalidate();
        }

        private void moveDot() {
            float top = 110 * density; // 给顶部分数栏留空间
            float w = Math.max(getWidth() - 2 * radius, 1);
            float h = Math.max(getHeight() - top - 2 * radius, 1);
            cx = radius + random.nextFloat() * w;
            cy = top + radius + random.nextFloat() * h;
            color = COLORS[random.nextInt(COLORS.length)];
        }

        private void endGame() {
            state = State.OVER;
            if (score > best) {
                best = score;
                prefs.edit().putInt("best", best).apply();
            }
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (e.getActionMasked() != MotionEvent.ACTION_DOWN) return true;
            if (state != State.PLAYING) {
                startGame();
                return true;
            }
            float dx = e.getX() - cx, dy = e.getY() - cy;
            if (dx * dx + dy * dy <= radius * radius * 1.2f) {
                score++;
                radius = Math.max(22 * density, radius * 0.95f);
                moveDot();
            } else {
                misses++;
            }
            invalidate();
            return true;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            canvas.drawColor(0xFF121826);
            float w = getWidth(), h = getHeight();

            if (state == State.PLAYING) {
                long left = endTime - SystemClock.uptimeMillis();
                if (left <= 0) {
                    endGame();
                } else {
                    paint.setColor(color);
                    canvas.drawCircle(cx, cy, radius, paint);

                    paint.setColor(Color.WHITE);
                    paint.setTextSize(26 * density);
                    canvas.drawText("得分 " + score + "    剩余 " + (left / 1000 + 1) + " 秒",
                            w / 2, 60 * density, paint);
                    paint.setColor(0xFF8892A6);
                    paint.setTextSize(15 * density);
                    canvas.drawText("失误 " + misses + "   最高 " + best, w / 2, 90 * density, paint);

                    postInvalidateOnAnimation(); // 持续刷新倒计时
                    return;
                }
            }

            paint.setColor(Color.WHITE);
            paint.setTextSize(44 * density);
            if (state == State.READY) {
                canvas.drawText("点点乐", w / 2, h / 2 - 60 * density, paint);
                paint.setTextSize(18 * density);
                paint.setColor(0xFFB0B8C8);
                canvas.drawText("30 秒内尽量多点中圆点", w / 2, h / 2, paint);
                canvas.drawText("最高分：" + best, w / 2, h / 2 + 32 * density, paint);
            } else {
                canvas.drawText("时间到！", w / 2, h / 2 - 60 * density, paint);
                paint.setTextSize(26 * density);
                canvas.drawText("得分 " + score, w / 2, h / 2, paint);
                paint.setTextSize(18 * density);
                paint.setColor(0xFFB0B8C8);
                canvas.drawText((score >= best && score > 0 ? "新纪录！" : "最高分 " + best)
                        + "   失误 " + misses, w / 2, h / 2 + 34 * density, paint);
            }
            paint.setColor(0xFFFFB300);
            paint.setTextSize(20 * density);
            canvas.drawText(state == State.READY ? "点击屏幕开始" : "点击屏幕再来一局",
                    w / 2, h / 2 + 100 * density, paint);
        }
    }
}
