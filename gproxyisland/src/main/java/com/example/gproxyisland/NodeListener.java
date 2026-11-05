package com.example.gproxyisland;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * 只看 NekoBox（moe.nb4a）的常驻通知：它的标题就是当前节点名（sing-box 配置里节点只叫 proxy，读不到名字）。
 * 别的 App 的通知一律忽略，不存、不发。需要用户在系统里给「通知使用权」。
 */
public class NodeListener extends NotificationListenerService {
    static final String NEKO = "moe.nb4a";

    /** 监听已连上（用户给了权限且系统已绑定） */
    static volatile boolean connected;
    /** NekoBox 通知还在 */
    static volatile boolean nekoShown;
    static volatile String nodeTitle;

    @Override
    public void onListenerConnected() {
        connected = true;
        scan();
    }

    @Override
    public void onListenerDisconnected() {
        connected = false;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn != null && NEKO.equals(sbn.getPackageName())) scan();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        if (sbn != null && NEKO.equals(sbn.getPackageName())) scan();
    }

    private void scan() {
        boolean shown = false;
        String title = null;
        try {
            StatusBarNotification[] all = getActiveNotifications();
            if (all != null) {
                for (StatusBarNotification s : all) {
                    if (!NEKO.equals(s.getPackageName())) continue;
                    // 有的系统前台服务通知不带 ongoing 标记，所以不强求；有常驻的就优先用常驻的标题
                    Bundle ex = s.getNotification().extras;
                    CharSequence t = ex == null ? null : ex.getCharSequence(Notification.EXTRA_TITLE);
                    if (t == null || t.length() == 0) { shown = true; continue; }
                    if (title == null || s.isOngoing()) title = t.toString();
                    shown = true;
                }
            }
        } catch (Exception ignored) {
        }
        nekoShown = shown;
        nodeTitle = title;
    }
}
