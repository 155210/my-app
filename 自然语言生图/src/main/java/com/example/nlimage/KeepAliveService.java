package com.example.nlimage;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * 前台服务：只在写提示词、出图期间开启，让系统不要在后台/锁屏时杀掉或冻结 WebView。
 * 常驻通知显示出图进度（网页调 progress 更新），带「全部取消」；一轮出完、App 在后台时另弹一条「出好了」。
 */
public class KeepAliveService extends Service {
    private static final String CH = "keepalive";
    private static final String CH_DONE = "done";
    private static final int ID = 1, ID_DONE = 2;
    private static final String ACTION_CANCEL = "com.example.nlimage.CANCEL_QUEUE";

    /** 通知上点「全部取消」时执行（MainActivity 设置，切到网页调 Queue.cancelAll） */
    static volatile Runnable onCancel;
    /** App 在前台时不弹「出好了」 */
    static volatile boolean appVisible;

    private static volatile KeepAliveService self;
    private static volatile String title = "自然语言生图 正在出图";
    private static volatile String text = "切到后台也会继续，点此返回";
    private static volatile int ended, total;

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
        title = "自然语言生图 正在出图";
        text = "切到后台也会继续，点此返回";
        ended = total = 0;
    }

    /** 更新通知栏进度：ended = 已结束张数，total = 这一轮一共几张（≤ 1 时进度条转圈） */
    static void progress(String t, String x, int e, int n) {
        title = t == null || t.isEmpty() ? "自然语言生图 正在出图" : t;
        text = x == null ? "" : x;
        ended = Math.max(0, e);
        total = Math.max(0, n);
        KeepAliveService s = self;
        if (s != null) s.refresh();
    }

    /** 一轮出完：App 在后台才弹 */
    static void finished(Context c, String t, String x) {
        if (appVisible) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        channels(nm);
        Notification n = new Notification.Builder(c, CH_DONE)
                .setSmallIcon(R.drawable.ic_launcher_fg)
                .setContentTitle(t)
                .setContentText(x)
                .setContentIntent(openApp(c))
                .setAutoCancel(true)
                .build();
        try {
            nm.notify(ID_DONE, n);
        } catch (Exception ignored) {
        }
    }

    /** 回到 App 时收起「出好了」 */
    static void clearDone(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(ID_DONE);
    }

    private static void channels(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CH, "后台运行", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("出图时切到后台也继续，显示出图进度");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
        NotificationChannel done = new NotificationChannel(CH_DONE, "出图完成", NotificationManager.IMPORTANCE_DEFAULT);
        done.setDescription("一轮图全部出完时提醒");
        nm.createNotificationChannel(done);
    }

    private static PendingIntent openApp(Context c) {
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification build() {
        Intent cancel = new Intent(this, KeepAliveService.class).setAction(ACTION_CANCEL);
        PendingIntent cp = PendingIntent.getService(this, 1, cancel,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_launcher_fg)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(openApp(this))
                .setOngoing(true)
                .setOnlyAlertOnce(true);
        if (total > 1) b.setProgress(total, Math.min(ended, total), false);
        else if (total == 1) b.setProgress(0, 0, true);
        if (total > 0) {
            b.addAction(new Notification.Action.Builder(
                    Icon.createWithResource(this, R.drawable.ic_launcher_fg), "全部取消", cp).build());
        }
        return b.build();
    }

    private void refresh() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            nm.notify(ID, build());
        } catch (Exception ignored) {
        }
    }

    private boolean foreground() {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(ID, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(ID, build());
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) channels(nm);
        if (!foreground()) {
            stopSelf();
            return;
        }
        self = this;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NlImage:keepalive");
            lock.setReferenceCounted(false);
            lock.acquire();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_CANCEL.equals(intent.getAction())) {
            Runnable r = onCancel;
            if (r != null) r.run();
        } else {
            // 每次 startForegroundService 都要再调一次 startForeground
            foreground();
        }
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
        if (self == this) self = null;
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
