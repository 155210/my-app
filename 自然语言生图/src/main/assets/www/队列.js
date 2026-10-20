/*
 * 队列.js —— 出图队列：并发数可调、NAI 限流（429）自动等待重试、单张/全部取消、失败的可重试
 *
 * Queue.add(任务函数(signal) => Promise, { label, retry }) 返回该任务的 Promise。
 *   label：队列面板里显示的一行字；retry：失败后点「重试」时调用（一般是重新 draw 一次）
 * Queue.onChange(fn) 订阅变化，fn({ running, waiting, retrying, failed, wait })
 *   wait = 限流等待中最近一次重试还剩几秒（没有就是 0）
 * Queue.cancel(id) / Queue.cancelAll() 取消；Queue.openPanel() 打开队列面板
 *
 * 设置放在 settings.nai 里（老设置没有就用 CFG_DEFAULTS），设置页多一个「出图队列」标签页。
 */
(function () {
    'use strict';

    const CFG_DEFAULTS = { concurrency: 1, retry429: true, maxRetries: 20 };
    const MAX_FAILED = 20;

    function cfg() {
        const n = (window.UI && UI.settings && UI.settings.nai) || {};
        const c = Math.round(Number(n.concurrency));
        const m = Math.round(Number(n.maxRetries));
        return {
            concurrency: c >= 1 ? Math.min(c, 8) : CFG_DEFAULTS.concurrency,
            retry429: n.retry429 === undefined ? CFG_DEFAULTS.retry429 : !!n.retry429,
            maxRetries: m >= 0 ? Math.min(m, 100) : CFG_DEFAULTS.maxRetries,
        };
    }

    const jobs = [];      // 排队 / 进行中 / 限流等待中
    const failed = [];    // 失败的，最近的在前
    const subs = [];
    let seq = 0;
    const bridge = window.AndroidBridge || null;

    /** 限流等待：第 n 次重试等 5、10、15… 秒，最多 30 秒 */
    const backoff = (n) => Math.min(30, 5 * n) * 1000;

    // NAI 的 429 包括「请求太频繁」和「同时只能出一张（Concurrent generation is locked）」
    const isRateLimit = (e) => e && (e.status === 429 || /429|concurrent generation/i.test(e.message || ''));

    function state() {
        const now = Date.now();
        const retrying = jobs.filter((j) => j.state === 'retry');
        const wait = retrying.length ? Math.max(0, Math.ceil((Math.min(...retrying.map((j) => j.retryAt)) - now) / 1000)) : 0;
        return {
            running: jobs.filter((j) => j.state !== 'waiting').length,
            waiting: jobs.filter((j) => j.state === 'waiting').length,
            retrying: retrying.length,
            failed: failed.length,
            wait,
        };
    }

    function notify() {
        const st = state();
        subs.forEach((f) => { try { f(st); } catch (e) { /* ignore */ } });
        if (bridge && bridge.keepAlive) bridge.keepAlive(jobs.length > 0 || Busy.count > 0);
        if (panel) renderPanel();
    }

    // 限流等待时每秒刷新一次倒计时
    let ticker = 0;
    function tick() {
        const need = jobs.some((j) => j.state === 'retry');
        if (need && !ticker) ticker = setInterval(notify, 1000);
        if (!need && ticker) { clearInterval(ticker); ticker = 0; }
    }

    // 写提示词也算「忙」：期间切到后台不被系统冻结
    const Busy = {
        count: 0,
        on() { this.count++; notify(); },
        off() { this.count = Math.max(0, this.count - 1); notify(); },
    };

    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal.aborted) { reject(abortErr()); return; }
            const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
            function onAbort() { clearTimeout(t); reject(abortErr()); }
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }
    const abortErr = () => new DOMException('已取消', 'AbortError');

    async function runJob(job) {
        const signal = job.ctrl.signal;
        for (;;) {
            job.state = 'running';
            notify();
            try {
                return await job.fn(signal);
            } catch (e) {
                const c = cfg();
                if (signal.aborted || e.name === 'AbortError' || !isRateLimit(e) || !c.retry429 || job.attempt >= c.maxRetries) throw e;
                job.attempt++;
                const ms = backoff(job.attempt);
                job.state = 'retry';
                job.retryAt = Date.now() + ms;
                job.lastError = e.message || String(e);
                notify();
                tick();
                try { await sleep(ms, signal); } finally { tick(); }
            }
        }
    }

    function pump() {
        const limit = cfg().concurrency;
        let active = jobs.filter((j) => j.state !== 'waiting').length;
        for (const job of jobs) {
            if (active >= limit) break;
            if (job.state !== 'waiting') continue;
            active++;
            runJob(job).then(job.resolve, (e) => {
                if (e.name !== 'AbortError') {
                    failed.unshift({ id: job.id, label: job.label, error: e.message || String(e), retry: job.retry });
                    failed.length = Math.min(failed.length, MAX_FAILED);
                }
                job.reject(e);
            }).finally(() => {
                remove(job);
                pump();
            });
        }
        notify();
    }

    function remove(job) {
        const i = jobs.indexOf(job);
        if (i >= 0) jobs.splice(i, 1);
    }

    function add(fn, info) {
        info = info || {};
        return new Promise((resolve, reject) => {
            jobs.push({
                id: ++seq, fn, resolve, reject, ctrl: new AbortController(),
                label: info.label || '第 ' + seq + ' 张', retry: info.retry || null,
                state: 'waiting', attempt: 0, retryAt: 0, lastError: '',
            });
            pump();
        });
    }

    /** 取消一张：排队中的直接拿掉，进行中 / 等待重试的中断请求 */
    function cancel(id) {
        const job = jobs.find((j) => j.id === id);
        if (!job) return;
        if (job.state === 'waiting') {
            remove(job);
            job.reject(abortErr());
            pump();
        } else {
            job.ctrl.abort();
        }
    }

    function cancelAll() {
        jobs.slice().forEach((j) => cancel(j.id));
        notify();
    }

    function retryFailed(id) {
        const i = failed.findIndex((f) => f.id === id);
        if (i < 0) return;
        const f = failed.splice(i, 1)[0];
        if (f.retry) f.retry(); else notify();
    }

    function clearFailed() { failed.length = 0; notify(); }

    // ------------------------------------------------------------
    // 队列面板（点顶栏「出图中」或创作页的「队列」打开）
    // ------------------------------------------------------------
    let panel = null;

    function jobLine(j) {
        const esc = UI.esc;
        const st = j.state === 'waiting' ? '排队中'
            : j.state === 'running' ? (j.attempt ? '出图中（第 ' + (j.attempt + 1) + ' 次尝试）' : '出图中')
                : '限流了，' + Math.max(0, Math.ceil((j.retryAt - Date.now()) / 1000)) + ' 秒后自动重试（已重试 ' + j.attempt + ' 次）';
        return '<div class="q-item"><div class="grow"><div class="q-label">' + esc(j.label) + '</div><div class="q-st' + (j.state === 'retry' ? ' warn' : '') + '">' + esc(st) + '</div></div>'
            + '<button class="btn small danger" data-cancel="' + j.id + '">取消</button></div>';
    }

    function failLine(f) {
        const esc = UI.esc;
        return '<div class="q-item"><div class="grow"><div class="q-label">' + esc(f.label) + '</div><div class="q-st err">' + esc(f.error) + '</div></div>'
            + (f.retry ? '<button class="btn small" data-retry="' + f.id + '">重试</button>' : '') + '</div>';
    }

    function renderPanel() {
        if (!panel || !panel.el.isConnected) { panel = null; return; }
        const c = cfg();
        const list = UI.$('[data-q-list]', panel.box);
        list.innerHTML = (jobs.length ? jobs.map(jobLine).join('') : '<div class="card-sub" style="padding:6px 0">现在没有在出的图</div>')
            + (failed.length ? '<div class="label" style="margin-top:12px">失败的</div>' + failed.map(failLine).join('') : '');
        UI.$('[data-q-info]', panel.box).textContent = '同时出 ' + c.concurrency + ' 张'
            + (c.retry429 ? ' · 限流自动重试（最多 ' + c.maxRetries + ' 次）' : ' · 限流不重试');
        UI.$('[data-q-all]', panel.box).hidden = !jobs.length;
        UI.$('[data-q-clear]', panel.box).hidden = !failed.length;
    }

    function openPanel() {
        if (panel && panel.el.isConnected) return;
        panel = UI.openLayer('sheet', '<div class="grip"></div><h3>出图队列</h3>'
            + '<div class="card-sub" data-q-info style="margin-bottom:8px"></div>'
            + '<div data-q-list style="max-height:55vh;overflow-y:auto"></div>'
            + '<div class="btns"><button class="btn" data-q-set>队列设置</button><button class="btn" data-q-clear>清空失败记录</button>'
            + '<button class="btn danger" data-q-all>全部取消</button><button class="btn" data-close>关闭</button></div>',
        { onClose: () => { panel = null; } });
        panel.box.addEventListener('click', (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.cancel) cancel(Number(b.dataset.cancel));
            else if (b.dataset.retry) retryFailed(Number(b.dataset.retry));
            else if (b.hasAttribute('data-q-all')) cancelAll();
            else if (b.hasAttribute('data-q-clear')) clearFailed();
            else if (b.hasAttribute('data-q-set')) { UI.closeLayer(panel); SettingsPage.open('queue'); }
        });
        renderPanel();
    }

    // ------------------------------------------------------------
    // 设置页标签页 + 顶栏「出图中」点一下打开面板（等其他脚本都加载完）
    // ------------------------------------------------------------
    function settingsTab() {
        const n = UI.settings.nai;
        Object.keys(CFG_DEFAULTS).forEach((k) => { if (n[k] === undefined) n[k] = CFG_DEFAULTS[k]; });
        return '<div class="field"><label>同时出几张</label><select data-k="nai.concurrency">'
            + [1, 2, 3, 4].map((v) => '<option value="' + v + '">' + v + '</option>').join('') + '</select>'
            + '<div class="help">官方 NovelAI 一个账号同时只能出 1 张，填大了会被限流（下面开了自动重试就会自己排队等）。第三方站看它的规则。</div></div>'
            + '<label class="check"><span class="switch"><input type="checkbox" data-k="nai.retry429"><span></span></span><span>被限流（429）时自动等待重试'
            + '<div class="help">等 5 秒、10 秒…最多 30 秒再试，期间可以在队列里取消</div></span></label>'
            + '<div class="field"><label>最多重试几次</label><input type="number" data-k="nai.maxRetries"><div class="help">超过就算失败，可以在队列面板里点「重试」</div></div>';
    }

    const CSS = '.q-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}'
        + '.q-item .grow{flex:1;min-width:0}.q-label{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:62vw}'
        + '#c-size button{white-space:nowrap;padding:7px 11px}.q-st{font-size:12px;color:var(--dim);margin-top:2px}.q-st.warn{color:var(--accent)}.q-st.err{color:var(--danger);word-break:break-all}';

    document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = CSS;
        document.head.appendChild(st);
        if (window.SettingsPage) SettingsPage.addTab({ id: 'queue', label: '出图队列', html: settingsTab });
        const chip = document.getElementById('queue-chip');
        if (chip) { chip.style.cursor = 'pointer'; chip.addEventListener('click', openPanel); }
    });

    // 设置里改了并发数，马上按新的数开始
    const refill = () => pump();

    window.Queue = {
        add, cancel, cancelAll, refill, retryFailed, clearFailed, openPanel,
        onChange: (f) => subs.push(f), state, Busy, isRateLimit, CFG_DEFAULTS,
    };
})();
