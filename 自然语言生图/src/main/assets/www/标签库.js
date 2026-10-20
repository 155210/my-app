/*
 * 标签库.js —— 4 万多个 Danbooru 标签（通用 / 角色 / 作品 / 画师 / 元数据），按热度排序、中英文都能搜，
 * 左边一列是中文；点一下加进（再点去掉）创作页的正面提示词。
 *
 * 另外两件事让 AI 写的标签更准（设置 → 标签库 里可以关）：
 *  1. 写提示词前：从中文描述里找出标签库认识的词（黑发、初音未来…），把对应的英文标签附给 AI 当参考（Writer.addContext）
 *  2. AI 写完后：对照标签库纠正写法（hires → highres、blue eye → blue eyes、下划线、大小写…），重复的去掉（Writer.addFilter）
 *
 * 数据：依赖/标签.json，由 工具/做标签库.py 生成，格式见那个脚本。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const CATS = [
        { v: -1, label: '全部' }, { v: 0, label: '通用' }, { v: 4, label: '角色' },
        { v: 3, label: '作品' }, { v: 1, label: '画师' }, { v: 5, label: '元数据' },
    ];
    const CAT_NAME = { 0: '通用', 1: '画师', 3: '作品', 4: '角色', 5: '元数据' };

    // ------------------------------------------------------------
    // 数据
    // ------------------------------------------------------------
    let tags = null;      // [[英文, 中文, 热度, 类别], ...] 热度从高到低
    let byName = null;    // 英文 → 条目
    let alias = {};       // 别名 → 英文
    let zhIndex = null;   // 中文 → 条目（同一个中文取最热的那个）
    let loading = null;

    function load() {
        if (tags) return Promise.resolve(tags);
        if (!loading) {
            loading = fetch('依赖/标签.json').then((r) => {
                if (!r.ok) throw new Error('标签库数据读不到（' + r.status + '）');
                return r.json();
            }).then((d) => {
                tags = d.tags;
                alias = d.alias || {};
                byName = new Map();
                for (const t of tags) byName.set(t[0], t);
                return tags;
            }).catch((e) => { loading = null; throw e; });
        }
        return loading;
    }

    const norm = (s) => String(s || '').trim().toLowerCase().replace(/_/g, ' ').replace(/\\([()])/g, '$1').replace(/\s+/g, ' ');

    function fmtCount(n) {
        if (n >= 1e4) return (n >= 1e5 ? Math.round(n / 1e4) : (n / 1e4).toFixed(1)) + '万';
        return String(n);
    }

    // ------------------------------------------------------------
    // 纠错：AI 写完的标签对照标签库
    // ------------------------------------------------------------
    /** 一个标签换成标签库里的写法；认不出返回 null */
    function canon(t) {
        const k = norm(t);
        if (!k) return null;
        if (byName.has(k)) return k;
        if (alias[k]) return alias[k];
        const tries = [k + 's', k.replace(/s$/, ''), k.replace(/es$/, ''), k.replace(/-/g, ' '), k.replace(/ /g, '-'), k.replace(/colour/g, 'color'), k.replace(/grey/g, 'gray'), k.replace(/gray/g, 'grey')];
        for (const x of tries) if (x !== k && byName.has(x)) return x;
        return null;
    }

    /**
     * 纠正一串逗号分隔的标签
     * 返回 { text, changes: [[原写法, 新写法]], unknown: [标签库里没有的] }
     */
    function fix(text) {
        const out = [], seen = new Set(), changes = [], unknown = [];
        for (const raw of String(text || '').split(/[,，\n]/)) {
            const t = raw.trim();
            if (!t) continue;
            // 带权重、画师前缀之类的特殊写法原样保留
            if (/[:{}[\]]/.test(t) || /^\d*\.?\d+$/.test(t)) { if (!seen.has(t)) { seen.add(t); out.push(t); } continue; }
            const c = canon(t);
            const v = c || t;
            if (c && c !== norm(t)) changes.push([t, c]);
            if (!c) unknown.push(t);
            const key = norm(v);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(v);
        }
        return { text: out.join(', '), changes, unknown };
    }

    // ------------------------------------------------------------
    // 候选：中文描述里出现了哪些标签库认识的词
    // ------------------------------------------------------------
    function buildZhIndex() {
        zhIndex = new Map();
        for (const t of tags) {
            if (t[3] === 1 || t[3] === 5 || !t[1]) continue;
            const names = [t[1], t[1].replace(/[（(].*?[）)]/g, '')];
            for (let z of names) {
                z = z.trim();
                if (z.length < 2 || z.length > 12 || !/[一-鿿]/.test(z)) continue;
                if (!zhIndex.has(z)) zhIndex.set(z, t); // tags 已按热度排好，先到的就是最热的
            }
        }
    }

    /** 返回 [[中文, 英文], ...]，最多 max 个 */
    function candidates(text, max) {
        if (!tags) return [];
        if (!zhIndex) buildZhIndex();
        const s = String(text || ''), found = [], used = new Set();
        for (let i = 0; i < s.length;) {
            let hit = 0;
            for (let L = Math.min(12, s.length - i); L >= 2; L--) {
                const t = zhIndex.get(s.substr(i, L));
                if (t) {
                    if (!used.has(t[0])) { used.add(t[0]); found.push([s.substr(i, L), t[0]]); }
                    hit = L;
                    break;
                }
            }
            i += hit || 1;
            if (found.length >= (max || 40)) break;
        }
        return found;
    }

    Writer.addContext((settings, text) => {
        if (!settings.tags || !settings.tags.hint) return '';
        if (!tags) { load().catch(() => {}); return ''; }
        const c = candidates(text, 40);
        if (!c.length) return '';
        return '【标签库参考】描述里这些词在 Danbooru 标签库里的标准写法如下（中文=英文标签），用到时照这个写：\n'
            + c.map((x) => x[0] + '=' + x[1]).join('，');
    });

    Writer.addFilter((res, settings) => {
        if (!settings.tags || !settings.tags.fix || !tags) return res;
        const r = fix(res.tag);
        if (r.changes.length) {
            toast('info', r.changes.slice(0, 6).map((x) => x[0] + ' → ' + x[1]).join('\n') + (r.changes.length > 6 ? '\n…' : ''), '标签库纠正了 ' + r.changes.length + ' 个写法');
        }
        const n = res.negative ? fix(res.negative).text : res.negative;
        return Object.assign({}, res, { tag: r.text, negative: n, tagFix: r });
    });

    // ------------------------------------------------------------
    // 标签库页面
    // ------------------------------------------------------------
    const PAGE = 120;
    const ui = { q: '', cat: -1, sort: 'hot', list: [], shown: 0 };

    function promptBox() { return $('#c-tag'); }
    function promptSet() {
        const box = promptBox();
        return new Set(String(box ? box.value : '').split(/[,，\n]/).map(norm).filter(Boolean));
    }
    function togglePrompt(name) {
        const box = promptBox();
        if (!box) return false;
        const parts = box.value.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
        const i = parts.findIndex((x) => norm(x) === name);
        if (i >= 0) parts.splice(i, 1); else parts.push(name);
        box.value = parts.join(', ');
        box.dispatchEvent(new Event('input', { bubbles: true })); // 让创作页存草稿
        return i < 0;
    }

    function filter() {
        const q = norm(ui.q), cat = ui.cat;
        let list = tags;
        if (cat >= 0) list = list.filter((t) => t[3] === cat);
        if (q) {
            const exact = [], pre = [], mid = [];
            for (const t of list) {
                const zh = t[1];
                if (t[0] === q || zh === ui.q.trim()) exact.push(t);
                else if (t[0].startsWith(q) || (zh && zh.startsWith(ui.q.trim()))) pre.push(t);
                else if (t[0].includes(q) || (zh && zh.includes(ui.q.trim()))) mid.push(t);
            }
            // 别名命中（比如搜 hires 找到 highres）
            const a = alias[q] && byName.get(alias[q]);
            if (a && !exact.includes(a) && (cat < 0 || a[3] === cat)) exact.unshift(a);
            list = exact.concat(pre, mid);
        }
        if (ui.sort === 'cold') list = list.slice().reverse();
        else if (ui.sort === 'az') list = list.slice().sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
        ui.list = list;
        ui.shown = 0;
    }

    function rowHtml(t, inPrompt) {
        return '<div class="tg-row' + (inPrompt.has(t[0]) ? ' on' : '') + '" data-t="' + esc(t[0]) + '">'
            + '<span class="tg-zh">' + (t[1] ? esc(t[1]) : '<i>' + (t[3] === 1 ? '画师' : '—') + '</i>') + '</span>'
            + '<span class="tg-en">' + esc(t[0]) + '</span>'
            + '<span class="tg-n">' + (t[3] && t[3] !== 0 && ui.cat < 0 ? '<em>' + CAT_NAME[t[3]] + '</em>' : '') + fmtCount(t[2]) + '</span></div>';
    }

    function drawMore(L, reset) {
        const box = $('.tg-list', L.box);
        if (reset) { box.innerHTML = ''; box.parentNode.scrollTop = 0; }
        const inPrompt = promptSet();
        const next = ui.list.slice(ui.shown, ui.shown + PAGE);
        ui.shown += next.length;
        box.insertAdjacentHTML('beforeend', next.map((t) => rowHtml(t, inPrompt)).join(''));
        $('.tg-count', L.box).textContent = ui.list.length ? ui.list.length + ' 个' : '';
        $('.tg-empty', L.box).hidden = !!ui.list.length;
    }

    function drawFoot(L) {
        const n = promptSet().size;
        $('.tg-foot span', L.box).textContent = promptBox() ? '点标签加进正面提示词，再点去掉 · 现在有 ' + n + ' 个' : '点标签复制';
    }

    async function open() {
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>标签库</b><span class="tg-count card-sub"></span></div>'
            + '<div class="tg-top"><input type="text" class="tg-q" placeholder="搜索：中文或英文都行，比如 黑发 / black hair">'
            + '<div class="tabs tg-cats">' + CATS.map((c) => '<button data-c="' + c.v + '">' + c.label + '</button>').join('') + '</div>'
            + '<div class="tg-sort"><span style="white-space:nowrap">排序</span><div class="seg"><button data-s="hot">热度↓</button><button data-s="cold">热度↑</button><button data-s="az">A-Z</button></div>'
            + '</div>'
            + '<div class="tg-head"><span class="tg-zh">中文</span><span class="tg-en">英文标签</span><span class="tg-n">热度</span></div></div>'
            + '<div class="page-body tg-body"><div class="tg-list"></div><div class="empty tg-empty" hidden>没有找到</div></div>'
            + '<div class="tg-foot"><span></span><button class="btn primary" data-close>完成</button></div>');
        const mark = () => {
            $$('.tg-cats button', L.box).forEach((b) => b.classList.toggle('on', +b.dataset.c === ui.cat));
            $$('.tg-sort button', L.box).forEach((b) => b.classList.toggle('on', b.dataset.s === ui.sort));
        };
        const redo = () => { filter(); drawMore(L, true); mark(); };
        const q = $('.tg-q', L.box);
        q.value = ui.q;
        mark();
        drawFoot(L);
        $('.tg-list', L.box).innerHTML = '<div class="card-sub" style="padding:12px">正在读取标签库…</div>';
        try { await load(); } catch (e) { $('.tg-list', L.box).innerHTML = '<div class="card-sub" style="padding:12px">' + esc(e.message) + '</div>'; return; }
        redo();

        let t = 0;
        q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { ui.q = q.value; redo(); }, 150); });
        $('.tg-cats', L.box).addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { ui.cat = +b.dataset.c; redo(); } });
        $('.tg-sort', L.box).addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { ui.sort = b.dataset.s; redo(); } });
        const body = $('.tg-body', L.box);
        body.addEventListener('scroll', () => {
            if (ui.shown < ui.list.length && body.scrollTop + body.clientHeight > body.scrollHeight - 600) drawMore(L);
        });
        $('.tg-list', L.box).addEventListener('click', (e) => {
            const row = e.target.closest('[data-t]');
            if (!row) return;
            if (!promptBox()) { UI.copyText(row.dataset.t); return; }
            const added = togglePrompt(row.dataset.t);
            row.classList.toggle('on', added);
            drawFoot(L);
        });
    }

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.tg-entry{float:right;color:var(--accent);text-decoration:none;font-size:13px}'
        + '.tg-top{flex:none;padding:10px 12px 0;border-bottom:1px solid var(--line)}'
        + '.tg-top .tabs{padding:10px 0 0}'
        + '.tg-sort{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--dim)}.tg-sort .seg button{padding:4px 12px;font-size:13px;white-space:nowrap}'
        + '.tg-head,.tg-row{display:flex;gap:10px;align-items:center}'
        + '.tg-head{font-size:12px;padding:8px 4px 6px}.tg-head span{color:var(--faint)}'
        + '.tg-zh{flex:1 1 0;min-width:0;overflow-wrap:anywhere}.tg-zh i{color:var(--faint);font-style:normal}'
        + '.tg-en{flex:1.3 1 0;min-width:0;overflow-wrap:anywhere;color:var(--dim)}'
        + '.tg-n{flex:none;width:68px;text-align:right;font-size:12px;color:var(--faint)}.tg-n em{font-style:normal;margin-right:4px;color:var(--dim)}'
        + '.tg-body{padding:0 12px calc(12px + var(--safe-bottom))}'
        + '.tg-row{padding:10px 4px;border-bottom:1px solid var(--line);cursor:pointer}'
        + '.tg-row.on{background:rgba(226,166,91,.12)}.tg-row.on .tg-en{color:var(--accent)}'
        + '.tg-foot{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px calc(8px + var(--safe-bottom));border-top:1px solid var(--line);font-size:13px;color:var(--dim)}.tg-foot span{flex:1}'
        + '</style>');

    // 创作页「正面提示词」那一栏的标题旁边放个入口（创作页重画时自动补上）
    function addEntry() {
        const box = promptBox();
        if (!box || $('#c-tag-lib')) return;
        const label = box.parentNode.querySelector('label');
        if (!label) return;
        label.insertAdjacentHTML('beforeend', '<a href="#" id="c-tag-lib" class="tg-entry">标签库</a>');
        $('#c-tag-lib').addEventListener('click', (e) => { e.preventDefault(); open(); });
    }
    const view = $('#view-create');
    if (view) new MutationObserver(addEntry).observe(view, { childList: true, subtree: true });
    addEntry();

    // 设置页加一个「标签库」标签
    SettingsPage.addTab({
        id: 'tags', label: '标签库',
        html: () => '<label class="check"><span class="switch"><input type="checkbox" data-k="tags.hint"><span></span></span><span>写提示词时给 AI 参考标签'
            + '<div class="help">从中文描述里找出标签库认识的词（比如「黑发」「初音未来」），把标准英文写法一起发给 AI</div></span></label>'
            + '<label class="check"><span class="switch"><input type="checkbox" data-k="tags.fix"><span></span></span><span>AI 写完自动纠正标签写法'
            + '<div class="help">对照标签库改掉错拼、别名、单复数（hires → highres），去掉重复的；标签库里没有的标签原样保留</div></span></label>'
            + '<div class="btns" style="justify-content:flex-start"><button class="btn primary" data-act="tags-open">打开标签库</button></div>'
            + '<div class="help" style="margin-top:14px">标签和热度来自 NAIWeaver 的标签表（Danbooru），中文翻译来自 a1111-sd-webui-tagcomplete-CN、BooruTagCart，缺的部分手动补译。</div>',
        acts: { 'tags-open': () => open() },
    });

    // 启动后空闲时先把数据读进来，第一次写提示词就能用上
    setTimeout(() => load().catch((e) => console.warn(e)), 1500);

    window.TagLib = { load, fix, canon, candidates, open, get loaded() { return !!tags; } };
})();
