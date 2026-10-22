/*
 * 图库日期.js —— 图库按出图日期筛选：今天、近 7 天、近 30 天、指定日期范围（按手机本地时间，整天算）
 *
 *   筛选条件 d = { k: '' 全部 / 'today' / '7' / '30' / 'range', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *   只在这次打开 App 时有效（同搜索、人物筛选），不存。界面按钮在 页面-图库.js 的排序旁边。
 */
(function () {
    'use strict';

    const { $, esc } = UI;
    const DAY = 86400000;
    const OPTS = [['', '全部日期'], ['today', '今天'], ['7', '近 7 天'], ['30', '近 30 天'], ['range', '指定日期…']];

    const p2 = (n) => String(n).padStart(2, '0');
    const ymd = (t) => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
    const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    /** 'YYYY-MM-DD' → 那天 0 点（本地时间）；格式不对返回 NaN */
    const parse = (s) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim()); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN; };

    /** 条件 → [起, 止)（毫秒）；不筛返回 null */
    function bounds(d, now) {
        if (!d || !d.k) return null;
        const today = startOfDay(now || Date.now());
        if (d.k === 'today') return [today, today + DAY];
        if (d.k === '7' || d.k === '30') return [today - (Number(d.k) - 1) * DAY, today + DAY];
        if (d.k === 'range') {
            let a = parse(d.from), b = parse(d.to);
            if (isNaN(a) && isNaN(b)) return null;
            if (isNaN(a)) a = -Infinity;
            if (isNaN(b)) b = Infinity; else b += DAY; // 截止那天整天都算
            return a <= b ? [a, b] : [b - DAY, a + DAY];
        }
        return null;
    }
    const on = (d) => !!bounds(d);
    function match(item, d, now) {
        const r = bounds(d, now);
        return !r || (item.time >= r[0] && item.time < r[1]);
    }

    const short = (s) => { const t = parse(s); if (isNaN(t)) return ''; const x = new Date(t); return (x.getFullYear() === new Date().getFullYear() ? '' : x.getFullYear() + '/') + (x.getMonth() + 1) + '/' + x.getDate(); };
    function label(d) {
        if (!on(d)) return '全部日期';
        if (d.k !== 'range') return OPTS.find((o) => o[0] === d.k)[1];
        const a = short(d.from), b = short(d.to);
        if (a && b) return a === b ? a : a + '–' + b;
        return a ? a + ' 起' : b + ' 前';
    }

    /** 弹出选择，返回新的条件；取消返回 null */
    function pick(cur, items) {
        cur = cur || { k: '' };
        const count = (d) => (items || []).filter((x) => match(x, d)).length;
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('sheet', '<div class="grip"></div><h3>按日期筛选</h3>'
                + OPTS.map(([k, t]) => '<button class="menu-item' + ((cur.k || '') === k ? ' on' : '') + '" data-k="' + k + '">' + esc(t)
                    + (k !== 'range' && items ? '<span class="g-date-n">' + count({ k }) + ' 张</span>' : '') + '</button>').join(''),
            { onClose: () => { if (!done) resolve(null); } });
            L.box.onclick = async (e) => {
                const b = e.target.closest('[data-k]'); if (!b) return;
                done = true;
                UI.closeLayer(L, true);
                resolve(b.dataset.k === 'range' ? await pickRange(cur, items) : { k: b.dataset.k });
            };
        });
    }

    /** 指定日期范围：两个日期框，可以只填一头 */
    function pickRange(cur, items) {
        const all = (items || []).map((x) => x.time);
        const oldest = all.length ? ymd(Math.min.apply(null, all)) : '';
        const from0 = cur.k === 'range' ? cur.from || '' : ymd(Date.now() - 6 * DAY);
        const to0 = cur.k === 'range' ? cur.to || '' : ymd(Date.now());
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('dialog', '<h3>指定日期范围</h3>'
                + '<div class="field"><label>从</label><input type="date" data-from value="' + esc(from0) + '"' + (oldest ? ' min="' + oldest + '"' : '') + '></div>'
                + '<div class="field"><label>到（这天也算）</label><input type="date" data-to value="' + esc(to0) + '"></div>'
                + '<div class="help" data-n></div>'
                + '<div class="help">只填一个也行：只填「从」就是那天以后，只填「到」就是那天以前。</div>'
                + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-ok>筛选</button></div>',
            { onClose: () => { if (!done) resolve(null); } });
            const f = $('[data-from]', L.box), t = $('[data-to]', L.box), n = $('[data-n]', L.box);
            const cond = () => ({ k: 'range', from: f.value, to: t.value });
            const show = () => { n.textContent = on(cond()) ? label(cond()) + '：' + (items || []).filter((x) => match(x, cond())).length + ' 张' : '两个都空着就是不筛'; };
            f.oninput = t.oninput = show;
            show();
            $('[data-ok]', L.box).onclick = () => {
                done = true;
                UI.closeLayer(L, true);
                resolve(on(cond()) ? cond() : { k: '' });
            };
        });
    }

    window.GalleryDate = { match, label, pick, on, bounds, ymd, OPTS };
    if (window.Help) Help.add({ id: 'gallery.date', group: '图库', title: '按日期筛选', target: '#g-date', tip: '按出图日期筛：今天、近 7 天、近 30 天、指定日期',
        text: '排序旁边的「日期」：今天、近 7 天、近 30 天（都含今天），或者「指定日期…」选从哪天到哪天（只填一头也行）。按手机本地时间整天算。能和收藏、相册、人物、搜索一起用；筛出来的图点开大图只在这些里滑。' });
})();
