/*
 * 队列.js —— 出图队列：一张一张排队出，可整体取消
 *
 * 现在并发固定 1。以后加「并发数可调、限流自动等待重试、一次出多张」都改这里。
 * Queue.add(任务函数(signal) => Promise) 返回该任务的 Promise。
 * Queue.onChange(fn) 订阅排队数变化（{ running, waiting }）。
 */
(function () {
    'use strict';

    const waiting = [];
    let running = null;
    const subs = [];
    const bridge = window.AndroidBridge || null;

    function notify() {
        const st = { running: running ? 1 : 0, waiting: waiting.length };
        subs.forEach((f) => { try { f(st); } catch (e) { /* ignore */ } });
        if (bridge && bridge.keepAlive) bridge.keepAlive(!!(running || waiting.length) || Busy.count > 0);
    }

    // 写提示词也算「忙」：期间切到后台不被系统冻结
    const Busy = {
        count: 0,
        on() { this.count++; notify(); },
        off() { this.count = Math.max(0, this.count - 1); notify(); },
    };

    function pump() {
        if (running || !waiting.length) { notify(); return; }
        const job = waiting.shift();
        running = job;
        notify();
        job.fn(job.ctrl.signal).then(job.resolve, job.reject).finally(() => {
            running = null;
            pump();
        });
    }

    function add(fn) {
        return new Promise((resolve, reject) => {
            waiting.push({ fn, resolve, reject, ctrl: new AbortController() });
            pump();
        });
    }

    function cancelAll() {
        while (waiting.length) {
            const j = waiting.shift();
            j.reject(new DOMException('已取消', 'AbortError'));
        }
        if (running) running.ctrl.abort();
        notify();
    }

    window.Queue = { add, cancelAll, onChange: (f) => subs.push(f), Busy };
})();
