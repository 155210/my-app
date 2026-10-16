package com.example.aitoolbox;

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
 * 前台服务：App 打开期间常驻一条通知，让系统不要在后台/锁屏时杀掉或冻结 WebView，
 * 这样转世界书、翻译这类要跑很久的任务切到后台也能继续。
 */
public class KeepAliveService extends Service {
    private static final String CH = "keepalive";
    private PowerManager.WakeLock lock;

    static void start(Context c) {
        try {
            Intent i = new Intent(c, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
        }
    }

    static void stop(Context c) {
        try {
            c.stopService(new Intent(c, KeepAliveService.class));
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CH, "后台运行", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("保持转换、翻译任务在后台继续");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_launcher_fg)
                .setContentTitle("自制ai工具箱 运行中")
                .setContentText("后台任务会继续进行，点此返回")
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(1, n);
            }
        } catch (Exception e) {
            stopSelf();
            return;
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AiToolbox:keepalive");
            lock.setReferenceCounted(false);
            lock.acquire();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 用户从最近任务里划掉 App：结束服务
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
