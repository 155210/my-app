package com.example.noveltranslate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * 前台服务：只负责「让进程别被杀」。真正干活的是 Engine 的线程。
 * 切到后台、锁屏、划掉界面，翻译都继续跑；通知栏显示进度。
 */
public class TranslateService extends Service {
    static final String CHANNEL = "translate";
    static final int NOTIFY_ID = 1001;
    private static volatile boolean alive;

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NovelTranslate:run");
            wakeLock.setReferenceCounted(false);
            // 上限 12 小时，防止异常时一直不放锁耗电
            wakeLock.acquire(12L * 60 * 60 * 1000);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = build(this, "正在翻译…", Engine.get(this).progressLine());
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFY_ID, n);
        }
        alive = true;
        // 翻译已经结束（比如服务被系统重启）就别赖着
        if (!Engine.get(this).isRunning()) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        alive = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "翻译进度", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("后台翻译时显示进度");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    static Notification build(Context ctx, String title, String text) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, CHANNEL)
                : new Notification.Builder(ctx);
        b.setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true);
        Engine e = Engine.get(ctx);
        int total = e.chapters.size();
        if (total > 0) b.setProgress(total, e.countDone(), false);
        return b.build();
    }

    static void updateNotification(Context ctx, String text) {
        if (!alive) return;
        Engine e = Engine.get(ctx);
        if (!e.isRunning()) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            nm.notify(NOTIFY_ID, build(ctx, "正在翻译 · " + e.runLabel, text));
        } catch (Exception ignored) {
            // 没有通知权限时 notify 会静默失败或抛异常，不影响翻译本身
        }
    }
}
