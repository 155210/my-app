/*
 * 用量.js —— 用量统计：本机按天记出了几张、大约花了多少 Anlas（照 Plana-App 的「用量统计」）
 *
 * 怎么记：包一层 fetch，发往 NAI 的出图 / 放大 / 图像工具 / 参考图编码请求成功了就记一笔，
 *   花费按 计价.js 的官网算法估（含 Opus 免费、角色参考 +5、参考图超过 4 张每张 +2），不是 NAI 回的真实扣点。
 *   所有出图入口（创作页、批量、拆多张、写真、图生图、局部重绘、精修、放大、工具）都走这几个接口，不用各自改。
 * 查到余额时（包一层 Nai.subscription）也记下当天第一次和最后一次看到的余额，明细里给个对照（中间充值了也会算进去）。
 *
 * 存储键 usage：{ v: 1, days: { 'YYYY-MM-DD': { n 张数, anlas, free 免费张数, kinds: { 种类: 张数 }, models: { 模型: 张数 },
 *   bal0, bal1 当天看到的第一次 / 最后一次余额, items: [{ t, k 种类, m 模型, w, h, n, a Anlas, x 工具名 }] } } }
 * 每天最多留 ITEM_MAX 条明细，张数和花费的合计不受影响。进设置备份。
 *
 * 入口：设置页「用量」标签 →「打开用量统计」，或者 Usage.open()。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const KEY = 'usage';
    const ITEM_MAX = 500;
    const KINDS = { generate: '出图', img2img: '图生图', infill: '局部重绘', upscale: '放大', tool: '图像工具', vibe: '参考图编码' };

    const pad = (n) => String(n).padStart(2, '0');
    const dayKey = (d) => { d = d ? new Date(d) : new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const emptyDay = () => ({ n: 0, anlas: 0, free: 0, kinds: {}, models: {}, items: [] });

    // 读写排成一队，几张同时出完也不会互相覆盖
    let chain = Promise.resolve();
    function edit(fn) {
        chain = chain.then(async () => {
            const d = await Store.get(KEY, null) || { v: 1, days: {} };
            if (!d.days) d.days = {};
            fn(d);
            await Store.set(KEY, d);
        }).catch((e) => console.warn('用量记账失败', e));
        return chain;
    }
    const load = () => chain.then(() => Store.get(KEY, null)).then((d) => (d && d.days ? d : { v: 1, days: {} }));

    /** 记一笔：e = { k 种类, m 模型, w, h, n 张数, a Anlas, x 工具名 } */
    function record(e) {
        const n = Math.max(0, Number(e.n) || 0), a = Math.max(0, Number(e.a) || 0);
        return edit((d) => {
            const k = dayKey();
            const day = d.days[k] = Object.assign(emptyDay(), d.days[k]);
            day.n += n;
            day.anlas += a;
            if (!a && n) day.free += n;
            day.kinds[e.k] = (day.kinds[e.k] || 0) + n;
            if (e.m) day.models[e.m] = (day.models[e.m] || 0) + n;
            day.items.unshift(Object.assign({ t: Date.now() }, e));
            if (day.items.length > ITEM_MAX) day.items.length = ITEM_MAX;
        }).then(() => document.dispatchEvent(new CustomEvent('usage-changed')));
    }

    function noteBalance(anlas) {
        if (typeof anlas !== 'number' || !isFinite(anlas)) return;
        edit((d) => {
            const k = dayKey();
            const day = d.days[k] = Object.assign(emptyDay(), d.days[k]);
            if (day.bal0 == null) day.bal0 = anlas;
            day.bal1 = anlas;
        });
    }
    window.addEventListener('nai-anlas', (e) => noteBalance(e.detail && e.detail.anlas));
    const sub = Nai.subscription; // 顶栏刷新余额走这个，不发 nai-anlas
    Nai.subscription = async function () {
        const d = await sub.apply(this, arguments);
        if (d) noteBalance(d.anlas);
        return d;
    };

    // ------------------------------------------------------------
    // 从请求里认出是什么、估花费
    // ------------------------------------------------------------
    const num = (v, d) => (isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
    /** 返回要记的那一笔；不是 NAI 收费的请求返回 null */
    function entryFor(url, body) {
        const m = /\/ai\/(generate-image|upscale|augment-image|encode-vibe)(?:[/?#]|$)/.exec(url);
        if (!m) return null;
        let b = {};
        try { b = typeof body === 'string' ? JSON.parse(body) : {}; } catch (e) { b = {}; }
        const C = window.Cost;
        if (m[1] === 'encode-vibe') return { k: 'vibe', m: b.model || '', n: 0, a: 2 };
        if (m[1] === 'upscale') {
            const w = num(b.width, 0), h = num(b.height, 0);
            const a = C && C.upscale ? C.upscale(w, h) : 0;
            return { k: 'upscale', w, h, n: 1, a: a > 0 ? a : 0 };
        }
        if (m[1] === 'augment-image') {
            const w = num(b.width, 0), h = num(b.height, 0);
            const a = C && C.tool ? C.tool(b.req_type, w, h) : 0;
            return { k: 'tool', x: (C && C.TOOLS && C.TOOLS[b.req_type]) || b.req_type || '', w, h, n: 1, a: a > 0 ? a : 0 };
        }
        const p = b.parameters || {};
        const kind = b.action === 'img2img' ? 'img2img' : b.action === 'infill' ? 'infill' : 'generate';
        const n = num(p.n_samples, 1), w = num(p.width, 832), h = num(p.height, 1216);
        const o = { width: w, height: h, steps: num(p.steps, 28), model: b.model || '', n };
        if (kind !== 'generate' && p.strength != null) o.strength = p.strength;
        let a = C && C.image ? C.image(o) : 0;
        if (a < 0) a = 0;
        // 和 参考图.js / 角色参考.js 注册的额外花费同口径
        const refs = (p.director_reference_images || []).length;
        const vibes = (p.reference_image_multiple || []).length;
        a += n * (refs * 5 + Math.max(0, vibes - 4) * 2);
        return { k: kind, m: b.model || '', w, h, n, a };
    }

    const fetch0 = window.fetch;
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input || '');
        const e = init && /\/ai\//.test(url) && String(init.method || '').toUpperCase() === 'POST' ? entryFor(url, init.body) : null;
        const r = await fetch0.apply(this, arguments);
        if (e && r && r.ok) record(e);
        return r;
    };

    // ------------------------------------------------------------
    // 统计页
    // ------------------------------------------------------------
    const ui = { range: 30, metric: 'n' };
    const fmtN = (v) => (Math.round(v * 10) / 10).toLocaleString('zh-CN');
    const short = (k) => Number(k.slice(5, 7)) + '/' + Number(k.slice(8));
    const modelName = (m) => (window.Params && Params.modelLabel ? Params.modelLabel(m) : m) || m;

    function lastDays(n) {
        const out = [], d = new Date();
        d.setHours(12, 0, 0, 0);
        for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(d.getTime() - i * 86400000)));
        return out;
    }

    function chart(keys, days) {
        const vals = keys.map((k) => (days[k] ? (ui.metric === 'n' ? days[k].n : days[k].anlas) : 0));
        const max = Math.max(1, ...vals);
        // 刻度取个整数：最大值往上凑到 1/2/5 × 10 的几次方
        const p10 = Math.pow(10, Math.floor(Math.log10(max)));
        const top = [1, 2, 5, 10].map((x) => x * p10).find((x) => x >= max);
        const W = 340, H = 150, L = 30, B = 20, T = 8, bw = (W - L) / keys.length;
        const y = (v) => T + (H - T - B) * (1 - v / top);
        let s = '<svg class="u-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="每天' + (ui.metric === 'n' ? '张数' : 'Anlas') + '">';
        [0, top / 2, top].forEach((v) => {
            s += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" class="u-grid"/>'
                + '<text x="' + (L - 4) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="u-axis">' + fmtN(v) + '</text>';
        });
        const step = Math.ceil(keys.length / 6);
        keys.forEach((k, i) => {
            const v = vals[i], x = L + i * bw;
            s += '<g data-day="' + k + '" class="u-bar' + (k === dayKey() ? ' today' : '') + '"><rect x="' + x + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" class="u-hit"/>';
            if (v > 0) s += '<rect x="' + (x + bw * 0.15) + '" y="' + y(v) + '" width="' + Math.max(1, bw * 0.7) + '" height="' + (H - B - y(v)) + '" rx="1.5" class="u-fill"/>';
            s += '</g>';
            if ((keys.length - 1 - i) % step === 0) s += '<text x="' + (x + bw / 2) + '" y="' + (H - 5) + '" text-anchor="middle" class="u-axis">' + short(k) + '</text>';
        });
        return s + '</svg>';
    }

    function sum(keys, days) {
        const t = { n: 0, anlas: 0, free: 0, active: 0 };
        keys.forEach((k) => { const d = days[k]; if (!d) return; t.n += d.n; t.anlas += d.anlas; t.free += d.free; if (d.n || d.anlas) t.active++; });
        return t;
    }

    function stat(v, label) { return '<div class="u-stat"><b>' + v + '</b><span>' + esc(label) + '</span></div>'; }

    async function render(L) {
        const d = await load();
        const keys = lastDays(ui.range);
        const t = sum(keys, d.days), today = d.days[dayKey()] || emptyDay();
        const body = $('.page-body', L.box);
        body.innerHTML = '<div class="card"><div class="card-title">今天</div>'
            + '<div class="u-stats">' + stat(fmtN(today.n), '张') + stat(fmtN(today.anlas), '约 Anlas') + stat(fmtN(today.free), '免费张数') + '</div>'
            + '<div class="btns"><button class="btn small" data-day="' + dayKey() + '">今天的明细</button></div></div>'
            + '<div class="card"><div class="row" style="flex-wrap:wrap;gap:8px">'
            + '<div class="seg" id="u-range">' + [7, 30, 90].map((n) => '<button data-v="' + n + '" class="' + (ui.range === n ? 'on' : '') + '">' + n + ' 天</button>').join('') + '</div>'
            + '<span class="grow"></span>'
            + '<div class="seg" id="u-metric"><button data-v="n" class="' + (ui.metric === 'n' ? 'on' : '') + '">张数</button><button data-v="a" class="' + (ui.metric === 'a' ? 'on' : '') + '">Anlas</button></div></div>'
            + '<div class="u-stats">' + stat(fmtN(t.n), '张') + stat(fmtN(t.anlas), '约 Anlas') + stat(fmtN(t.active ? t.n / t.active : 0), '日均张数') + '</div>'
            + chart(keys, d.days)
            + '<div class="card-sub">点柱子看那天的明细。Anlas 是按官网算法估的，Opus 免费的不算；实际扣点以 NovelAI 为准。</div></div>'
            + '<div class="btns"><button class="btn danger small" data-act="clear">清空用量记录</button></div>';
        $$('#u-range button', body).forEach((b) => b.onclick = () => { ui.range = Number(b.dataset.v); render(L); });
        $$('#u-metric button', body).forEach((b) => b.onclick = () => { ui.metric = b.dataset.v === 'a' ? 'a' : 'n'; render(L); });
        body.onclick = async (e) => {
            const day = e.target.closest('[data-day]');
            if (day) { openDay(day.dataset.day || day.getAttribute('data-day')); return; }
            if (e.target.closest('[data-act="clear"]')) {
                if (!await UI.confirmBox('清空用量记录？', '所有日子的张数和花费都会删掉，图库里的图不受影响。', '清空', true)) return;
                await edit((x) => { x.days = {}; });
                toast('success', '已清空');
                render(L);
            }
        };
    }

    const time = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    function tally(obj, name) {
        const ks = Object.keys(obj || {}).filter((k) => obj[k]).sort((a, b) => obj[b] - obj[a]);
        return ks.length ? ks.map((k) => '<div class="u-line"><span>' + esc(name(k)) + '</span><b>' + fmtN(obj[k]) + ' 张</b></div>').join('') : '';
    }

    async function openDay(k) {
        const d = (await load()).days[k] || emptyDay();
        const items = d.items || [];
        const bal = d.bal0 != null && d.bal1 != null
            ? '<div class="card-sub">这天查到的余额：' + d.bal0 + ' → ' + d.bal1 + '（中间充值、在别处出图也会算进去）</div>' : '';
        UI.openLayer('sheet', '<div class="grip"></div><h3>' + esc(Number(k.slice(5, 7)) + ' 月 ' + Number(k.slice(8)) + ' 日') + '</h3>'
            + '<div class="u-stats">' + stat(fmtN(d.n), '张') + stat(fmtN(d.anlas), '约 Anlas') + stat(fmtN(d.free), '免费张数') + '</div>' + bal
            + (d.n || items.length ? '<div class="label">按种类</div>' + tally(d.kinds, (x) => KINDS[x] || x)
                + (Object.keys(d.models || {}).length ? '<div class="label">按模型</div>' + tally(d.models, modelName) : '')
                + '<div class="label">每一笔（新的在前）</div><div class="u-items">' + items.map((it) => '<div class="u-line"><span>' + time(it.t) + ' · '
                    + esc((KINDS[it.k] || it.k) + (it.x ? '（' + it.x + '）' : '') + (it.m ? ' · ' + modelName(it.m) : '') + (it.w ? ' · ' + it.w + '×' + it.h : '') + (it.n > 1 ? ' × ' + it.n : ''))
                    + '</span><b>' + (it.a ? it.a + ' Anlas' : '免费') + '</b></div>').join('') + '</div>'
                : '<p class="card-sub">这天没有出图记录。</p>')
            + '<div class="btns"><button class="btn" data-close>关闭</button></div>');
    }

    function open() {
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>用量统计</b></div><div class="page-body"></div>', {
            onClose: () => document.removeEventListener('usage-changed', again),
        });
        const again = () => render(L);
        document.addEventListener('usage-changed', again);
        render(L);
        return L;
    }

    SettingsPage.addTab({
        id: 'usage', label: '用量', after: 'nai',
        html: () => '<div class="card"><div class="card-title">用量统计</div>'
            + '<div class="card-sub">每天出了几张图、大约花了多少 Anlas，有趋势图和每天的明细。只记在这台手机上。</div>'
            + '<div class="btns"><button class="btn primary" data-act="usage-open">打开用量统计</button></div></div>',
        acts: { 'usage-open': () => open() },
    });

    setTimeout(() => {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'settings.usage', group: '设置', title: '用量统计', target: '[data-act="usage-open"]', tip: '看每天出了几张、花了多少 Anlas',
            text: '设置 →「用量」→「打开用量统计」。每天出了几张图、大约花了多少 Anlas（出图、图生图、局部重绘、放大、图像工具、参考图编码都算），可以看近 7 / 30 / 90 天的柱状图，点柱子看那天按种类、按模型和每一笔的明细。\nAnlas 是按官网算法估的，Opus 免费的记作免费；实际扣点以 NovelAI 为准。记录只在这台手机上，会跟着设置一起备份。' });
    });

    window.Usage = { open, record, entryFor, load, dayKey };
})();
