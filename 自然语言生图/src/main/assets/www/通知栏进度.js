/*
 * 通知栏进度.js —— 出图时把队列进度显示在通知栏（就是「后台运行」那条常驻通知），出完了再弹一条「出好了」
 *
 * 外壳（MainActivity.Bridge）提供：
 *   queueProgress(标题, 内容, 已结束张数, 一共张数)  更新常驻通知（一共 ≤ 1 张时进度条转圈）
 *   queueDone(标题, 内容)                           App 在后台时弹「出好了」，在前台不弹
 * 通知上的「全部取消」由外壳调 Queue.cancelAll()。
 * 设置 nai.doneNotify（默认开）：出完要不要弹「出好了」；设置页「出图队列」里有开关。
 */
(function () {
    'use strict';

    const shell = () => window.AndroidBridge || null;   // 用的时候再取（测试里页面加载后才装假外壳）
    let last = '';

    function text(st) {
        const ended = st.done + st.lost + st.cancelled;
        let title, body;
        if (st.running + st.waiting === 0) {
            title = 'AI 正在写提示词';
            body = st.total ? '已出好 ' + st.done + ' 张，写完接着出' : '写完就开始出图';
        } else {
            title = '正在出图 ' + Math.min(ended + 1, st.total) + ' / ' + st.total;
            const parts = [];
            if (st.retrying && st.wait) parts.push('限流了，' + st.wait + ' 秒后自动重试');
            else if (st.current) parts.push(st.current);
            if (st.waiting) parts.push('排队 ' + st.waiting + ' 张');
            if (st.lost) parts.push('失败 ' + st.lost + ' 张');
            if (st.writing) parts.push('还在写提示词');
            body = parts.join(' · ') || '切到后台也会继续';
        }
        return { title, body, ended };
    }

    function update(st) {
        const bridge = shell();
        if (!bridge || typeof bridge.queueProgress !== 'function') return;
        if (st.running + st.waiting === 0 && !st.writing) { last = ''; return; }
        const t = text(st);
        const key = t.title + '|' + t.body + '|' + t.ended + '|' + st.total;
        if (key === last) return;
        last = key;
        try { bridge.queueProgress(t.title, t.body, t.ended, st.total); } catch (e) { /* 老外壳 */ }
    }

    function finish(r) {
        last = '';
        const bridge = shell();
        if (!bridge || typeof bridge.queueDone !== 'function') return;
        const n = (window.UI && UI.settings && UI.settings.nai) || {};
        if (n.doneNotify === false || !(r.done + r.lost)) return;
        const title = r.done ? '出好了 ' + r.done + ' 张图' : '这一轮没出成';
        const parts = [];
        if (r.lost) parts.push('失败 ' + r.lost + ' 张，在出图队列里能重试');
        if (r.cancelled) parts.push('取消 ' + r.cancelled + ' 张');
        try { bridge.queueDone(title, parts.join(' · ') || '点开去图库看看'); } catch (e) { /* 老外壳 */ }
    }

    // 一次排几张时是一张一张加进队列的，攒 100 毫秒再发，免得先闪一下「1 / 1」
    let timer = 0;
    Queue.onChange(() => {
        if (!timer) timer = setTimeout(() => { timer = 0; update(Queue.state()); }, 100);
    });
    Queue.onFinish(finish);
    window.QueueNotify = { text };

    if (window.Help) {
        Help.add({
            id: 'queue.notify', group: '出图队列', title: '通知栏进度',
            text: '出图时通知栏那条「后台运行」通知会显示进度：第几张 / 一共几张、正在出哪张、排队几张、限流倒计时，通知上能直接「全部取消」。\n'
                + '全部出完（或失败）时如果 App 在后台，会再弹一条「出好了 N 张图」，点一下回到 App。不想要可以在 设置 → 出图队列 里关掉。\n'
                + '安卓 13 起要允许本 App 发通知才看得到（第一次打开时会问）。',
        });
    }
})();
