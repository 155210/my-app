/*
 * 页面-批量.js —— 批量页：一次排很多条描述，挨个让 AI 写提示词，写完一条就把这条排进出图队列（照柏宝绘的批量）
 *
 * AI 一次只写一条（写下一条的同时，上一条在出图）；出图走 CreatePage.draw → 出图队列，并发、限流重试都按队列设置。
 * 列表存在 Store 的 batch 键：{ items: [...], opts: { count 每条几张, autoDraw 写完就出图 } }，重开 App 还在。
 * 每条：{ id, desc, state, tag, nl, negative, size, error, failedAt: 'write'|'draw', images: [{ id, thumb }] }
 *   state：wait 等着写 → writing 写提示词中 → written 写好了 → drawing 出图中 → done 出完；出错是 failed
 * 批量出的图不带创作页的多角色格子（每条画面不一样）；角色库的名字换外貌照常生效。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const root = () => $('#view-batch');
    const STATE = { wait: '等着写', writing: '写提示词中', written: '写好了', drawing: '出图中', done: '出完了', failed: '失败' };

    let data = { items: [], opts: { count: 1, autoDraw: true } };
    let running = null;   // 正在挨个写时的 AbortController
    let liveText = '';
    let loaded = false;

    let saveTimer = 0;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => Store.set('batch', strip()).catch(() => {}), 300);
    }
    // 存的时候不带运行中的东西
    const strip = () => ({ opts: data.opts, items: data.items.map((x) => { const o = Object.assign({}, x); delete o.pending; delete o.drawErr; return o; }) });

    const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    async function load() {
        if (loaded) return;
        loaded = true;
        const d = await Store.get('batch', null);
        if (d && Array.isArray(d.items)) {
            data.items = d.items.map((x) => {
                const it = Object.assign({ images: [], error: '' }, x);
                // 上次关 App 时还没写完 / 没出完的：写的退回等着写，出图的退回写好了（队列不会跨重启）
                if (it.state === 'writing') it.state = 'wait';
                if (it.state === 'drawing') it.state = it.images.length ? 'done' : 'written';
                return it;
            });
            data.opts = Object.assign(data.opts, d.opts);
        }
    }

    // ------------------------------------------------------------
    // 写提示词（挨个）和出图
    // ------------------------------------------------------------
    async function start() {
        if (running) return;
        if (!data.items.some((x) => x.state === 'wait')) { toast('info', '没有等着写的了'); return; }
        running = new AbortController();
        const signal = running.signal;
        Queue.Busy.on();
        render();
        let wrote = 0;
        try {
            for (;;) {
                if (signal.aborted) break;
                const it = data.items.find((x) => x.state === 'wait');
                if (!it) break;
                it.state = 'writing';
                it.error = '';
                liveText = '';
                render();
                try {
                    const res = await Writer.run({
                        settings: UI.settings, text: it.desc, signal,
                        onDelta: (c) => { liveText = c; showLive(it); },
                    });
                    Object.assign(it, { tag: res.tag, nl: res.nl, negative: res.negative, size: res.size, state: 'written', failedAt: '' });
                    wrote++;
                    if (data.opts.autoDraw) drawItem(it);
                } catch (e) {
                    if (e.name === 'AbortError' || signal.aborted) { it.state = 'wait'; break; }
                    Object.assign(it, { state: 'failed', failedAt: 'write', error: e.message || String(e) });
                    // 接口地址 / 模型没填这种，后面每条都会一样失败，直接停
                    if (/请先在设置里/.test(it.error)) { toast('error', it.error); break; }
                }
                save();
                render();
            }
        } finally {
            const stopped = signal.aborted;
            running = null;
            Queue.Busy.off();
            save();
            render();
            if (stopped) toast('info', '批量已停止');
            else if (wrote) toast('success', '批量写完了 ' + wrote + ' 条' + (data.opts.autoDraw ? '，图在出图队列里' : ''));
        }
    }

    function stop() { if (running) running.abort(); }

    function drawItem(it) {
        const n = data.items.indexOf(it) + 1;
        const jobs = CreatePage.draw({
            desc: it.desc, tag: it.tag, nl: it.nl, negative: it.negative, size: it.size, characters: [],
            label: '批量 #' + n + ' · ' + it.desc.replace(/\s+/g, ' ').slice(0, 16),
        }, Number(data.opts.count) || 1);
        if (!jobs) { Object.assign(it, { state: 'failed', failedAt: 'draw', error: '出图前检查没通过（看上面的提示）' }); save(); render(); return; }
        it.state = 'drawing';
        it.error = '';
        it.drawErr = '';
        it.pending = (it.pending || 0) + jobs.length;
        jobs.forEach((job) => {
            job.then((img) => { it.images.push({ id: img.id, thumb: img.thumb }); },
                (e) => { if (e.name !== 'AbortError') it.drawErr = e.message || String(e); })
                .finally(() => {
                    it.pending--;
                    if (it.pending <= 0) {
                        it.pending = 0;
                        if (it.drawErr) Object.assign(it, { state: 'failed', failedAt: 'draw', error: it.drawErr });
                        else it.state = it.images.length ? 'done' : 'written';
                    }
                    save();
                    render();
                });
        });
        save();
        render();
    }

    function drawAllWritten() {
        const list = data.items.filter((x) => x.state === 'written');
        if (!list.length) { toast('info', '没有写好但还没出图的'); return; }
        list.forEach(drawItem);
        toast('info', list.length + ' 条排进出图队列了');
    }

    function retryFailed() {
        const list = data.items.filter((x) => x.state === 'failed');
        if (!list.length) { toast('info', '没有失败的'); return; }
        list.forEach((it) => { if (it.failedAt === 'draw' && it.tag) drawItem(it); else { it.state = 'wait'; it.error = ''; } });
        save();
        render();
        if (list.some((x) => x.state === 'wait')) start();
    }

    function addLines() {
        const ta = $('#b-input', root());
        const lines = ta.value.split(/\n/).map((x) => x.trim()).filter(Boolean);
        if (!lines.length) { toast('warning', '先写描述，一行一条'); return; }
        lines.forEach((desc) => data.items.push({ id: newId(), desc, state: 'wait', tag: '', nl: '', negative: '', size: 'portrait', error: '', images: [] }));
        ta.value = '';
        save();
        render();
        toast('success', '加了 ' + lines.length + ' 条');
    }

    // ------------------------------------------------------------
    // 界面
    // ------------------------------------------------------------
    function counts() {
        const c = {};
        data.items.forEach((x) => { c[x.state] = (c[x.state] || 0) + 1; });
        return c;
    }

    function itemHtml(it, i) {
        const busy = it.state === 'writing' || it.state === 'drawing';
        const cls = it.state === 'failed' ? ' err' : it.state === 'done' ? ' ok' : busy ? ' acc' : '';
        let h = '<div class="card b-item" data-id="' + it.id + '"><div class="row"><b class="b-no">#' + (i + 1) + '</b>'
            + '<span class="badge' + cls + '">' + STATE[it.state] + (it.state === 'drawing' && it.pending ? ' ' + it.pending + ' 张' : '') + '</span>'
            + '<span class="grow"></span>'
            + (it.images.length ? '<span class="card-sub" style="margin:0">' + it.images.length + ' 张图</span>' : '') + '</div>'
            + '<div class="b-desc">' + esc(it.desc) + '</div>';
        if (it.state === 'writing') h += '<pre class="live" data-live>' + esc(liveText || 'AI 正在写…') + '</pre>';
        if (it.tag && it.state !== 'writing') h += '<div class="b-tag">' + esc(it.tag) + '</div>';
        if (it.error) h += '<div class="b-err">' + esc(it.error) + '</div>';
        if (it.images.length) {
            h += '<div class="b-thumbs">' + it.images.slice(-8).map((g) => '<img data-img="' + esc(g.id) + '" src="' + esc(g.thumb || '') + '" alt="">').join('') + '</div>';
        }
        h += '<div class="acts">';
        if (it.state !== 'writing') {
            h += '<button data-a="write">' + UI.ICON.regen + (it.tag ? '重新写' : '写这条') + '</button>';
            if (it.tag) h += '<button data-a="draw">' + UI.ICON.reuse + (it.images.length ? '再出一次' : '出图') + '</button>'
                + '<button data-a="fill">' + UI.ICON.copy + '填到创作页</button>';
            if (!busy) h += '<button data-a="del" class="danger">' + UI.ICON.del + '删除</button>';
        }
        return h + '</div></div>';
    }

    function render() {
        const r = root();
        if (!r || !$('#b-list', r)) return;
        const c = counts();
        const total = data.items.length;
        $('#b-sum', r).textContent = total
            ? '共 ' + total + ' 条：' + ['wait', 'writing', 'written', 'drawing', 'done', 'failed'].filter((k) => c[k]).map((k) => STATE[k] + ' ' + c[k]).join(' · ')
            : '还没有描述，在上面写好点「加进列表」';
        const go = $('#b-go', r);
        go.textContent = running ? '停止' : '开始';
        go.classList.toggle('danger', !!running);
        go.classList.toggle('primary', !running);
        go.disabled = !running && !c.wait;
        $('#b-drawall', r).hidden = !c.written;
        $('#b-retry', r).hidden = !c.failed;
        $('#b-clear', r).hidden = !total;
        $('#b-list', r).innerHTML = data.items.map(itemHtml).join('');
    }

    function showLive(it) {
        const el = $('.b-item[data-id="' + it.id + '"] [data-live]', root());
        if (!el) return;
        el.textContent = liveText || 'AI 正在写…';
        el.scrollTop = el.scrollHeight;
    }

    function html() {
        return '<div class="card"><div class="label">一行一条描述，AI 挨个写提示词，写完一条出一条</div>'
            + '<textarea class="ta" id="b-input" placeholder="清晨的教室里，女孩趴在桌上睡着了&#10;放学路上下起了雨，两个人共撑一把伞&#10;……"></textarea>'
            + '<div class="row" style="margin-top:10px">'
            + '<label class="check grow" style="margin:0"><span class="switch"><input type="checkbox" id="b-auto"><span></span></span><span>写完就出图</span></label>'
            + '<span style="font-size:13px;color:var(--dim)">每条</span>'
            + '<select id="b-count" style="width:auto;padding:8px 4px">' + [1, 2, 3, 4].map((v) => '<option value="' + v + '">' + v + ' 张</option>').join('') + '</select>'
            + '<button class="btn" id="b-add">加进列表</button></div></div>'
            + '<div class="card"><div class="row"><div class="card-sub grow" id="b-sum" style="margin:0"></div></div>'
            + '<div class="btns"><button class="btn primary" id="b-go">开始</button><button class="btn" id="b-drawall">写好的全部出图</button>'
            + '<button class="btn" id="b-retry">重试失败的</button><button class="btn" id="b-queue">出图队列</button><button class="btn danger" id="b-clear">清空列表</button></div></div>'
            + '<div id="b-list"></div>';
    }

    function bind() {
        const r = root();
        $('#b-add', r).onclick = addLines;
        $('#b-auto', r).onchange = (e) => { data.opts.autoDraw = e.target.checked; save(); };
        $('#b-count', r).onchange = (e) => { data.opts.count = Number(e.target.value) || 1; save(); };
        $('#b-go', r).onclick = () => (running ? stop() : start());
        $('#b-drawall', r).onclick = drawAllWritten;
        $('#b-retry', r).onclick = retryFailed;
        $('#b-queue', r).onclick = () => Queue.openPanel();
        $('#b-clear', r).onclick = async () => {
            if (!(await UI.confirmBox('清空批量列表', '列表里的描述和提示词都删掉（已经出的图还在图库里）。' + (running ? '正在写的也会停下。' : ''), '清空', true))) return;
            stop();
            data.items = [];
            save();
            render();
        };
        $('#b-list', r).addEventListener('click', (e) => {
            const card = e.target.closest('.b-item');
            if (!card) return;
            const it = data.items.find((x) => x.id === card.dataset.id);
            if (!it) return;
            const img = e.target.closest('[data-img]');
            if (img) { GalleryPage.openViewer(img.dataset.img); return; }
            if (e.target.closest('.b-tag')) { e.target.closest('.b-tag').classList.toggle('open'); return; }
            const b = e.target.closest('button[data-a]');
            if (!b) return;
            const a = b.dataset.a;
            if (a === 'write') { it.state = 'wait'; it.error = ''; save(); render(); start(); }
            if (a === 'draw') drawItem(it);
            if (a === 'fill') CreatePage.reuse({ desc: it.desc, tag: it.tag, nl: it.nl, negative: it.negative, size: it.size, characters: [] });
            if (a === 'del') { data.items = data.items.filter((x) => x !== it); save(); render(); }
        });
    }

    async function refresh() {
        await load();
        const r = root();
        if (!$('#b-list', r)) {
            r.innerHTML = html();
            bind();
        }
        $('#b-auto', r).checked = data.opts.autoDraw !== false;
        $('#b-count', r).value = String(data.opts.count || 1);
        render();
    }

    const css = document.createElement('style');
    css.textContent = '.b-item .b-no{font-size:14px}.b-desc{margin-top:4px;font-size:14px;white-space:pre-wrap;word-break:break-word}'
        + '.b-tag{font-size:12px;color:var(--faint);margin-top:4px;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
        + '.b-tag.open{display:block}.b-err{font-size:12px;color:var(--danger);margin-top:4px;word-break:break-all}'
        + '.b-thumbs{display:flex;gap:6px;margin-top:8px;overflow-x:auto}.b-thumbs img{height:84px;border-radius:8px;flex:none;background:var(--bg3)}'
        + '.badge.ok{color:var(--ok);border-color:rgba(95,185,138,.5)}.badge.err{color:var(--danger);border-color:rgba(224,100,92,.5)}';
    document.head.appendChild(css);

    window.BatchPage = { refresh, start, stop, get items() { return data.items; } };
})();
