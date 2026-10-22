/*
 * Vibe库.js —— 独立的 Vibe 库管理页：所有加过的画风参考图都收在这里，按分组整理，要用哪张再放进创作页
 *
 * 索引在 Store 的 vibeLib 键：{ v: 1, list: [{ id, name, group 分组, strength 默认强度, info 默认信息提取量, time }] }
 * 图和编码还是 参考图.js 的 vibe:<id>（和创作页卡片共用一份，编码过的模型不用再扣 Anlas）。
 * 创作页卡片 nai.vibes 只是「现在用着的」；卡片上「移出」不删数据，在库里「删除」才连图和编码一起删。
 * 老数据：第一次打开时把 nai.vibes 里已有的都收进库。
 *
 * 对外：VibeLib.open()、pick()（选一张放进创作页）、adopt(v)、has(id)、rename(id, 名字)、list
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const KEY = 'vibeLib';
    const nai = () => UI.settings.nai;
    let data = { v: 1, list: [] };
    const ui = { group: null, q: '' }; // group：null 全部，'' 没分组

    const loaded = Store.get(KEY, null).then((d) => {
        if (d && Array.isArray(d.list)) data = { v: 1, list: d.list.filter((x) => x && x.id).map(norm) };
    }).catch((e) => console.warn(e));
    const save = () => Store.set(KEY, data).catch((e) => toast('error', e.message, '保存 Vibe 库失败'));

    function norm(x) {
        const num = (v, def) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : def);
        return { id: x.id, name: String(x.name || '参考图'), group: String(x.group || '').trim(), strength: num(x.strength, 0.6), info: num(x.info, 1), time: x.time || Date.now() };
    }
    const find = (id) => data.list.find((x) => x.id === id);
    const has = (id) => !!find(id);
    const groups = () => [...new Set(data.list.map((x) => x.group).filter(Boolean))];
    const onCard = (id) => (nai().vibes || []).find((x) => x.id === id);

    /** 收进库（参考图.js 加图时调）；已经在就不动 */
    function adopt(v) {
        if (has(v.id)) return;
        data.list.unshift(norm(v));
        save();
    }
    function rename(id, name) {
        const x = find(id);
        if (!x || x.name === name) return;
        x.name = name;
        save();
    }

    // 老用户：创作页卡片上已有的参考图收进库（要等设置读出来，所以挂在创作页初始化前面）
    let migrated = false;
    async function ready() {
        await loaded;
        if (migrated) return;
        migrated = true;
        let n = 0;
        (nai().vibes || []).forEach((v) => { if (!has(v.id)) { data.list.push(norm(v)); n++; } });
        if (n) save();
    }
    const init = CreatePage.init;
    CreatePage.init = async function () { await ready(); return init.apply(this, arguments); };

    // ------------------------------------------------------------
    // 列表
    // ------------------------------------------------------------
    function encText(d) {
        if (!d) return '数据找不到了';
        const keys = [...new Set((d.enc || []).map((e) => e.key))].map((k) => Vibes.KEY_LABEL[k] || k);
        return (keys.length ? '已编码：' + keys.join('、') : '还没编码过') + (d.image ? '' : ' · 没带原图');
    }

    function rowHtml(x, d) {
        const c = onCard(x.id);
        return '<div class="vl-row" data-id="' + esc(x.id) + '">'
            + (d && d.thumb ? '<img class="vibe-thumb" src="' + esc(d.thumb) + '" alt="">' : '<div class="vibe-thumb"></div>')
            + '<div class="grow" style="min-width:0"><div class="vl-name">' + esc(x.name)
            + (c ? ' <span class="badge acc">' + (c.on !== false ? '用着' : '在创作页（关着）') + '</span>' : '')
            + (x.group ? ' <span class="badge">' + esc(x.group) + '</span>' : '') + '</div>'
            + '<div class="card-sub">' + esc(encText(d)) + '</div>'
            + '<div class="card-sub">强度 ' + x.strength + ' · 信息提取量 ' + x.info + '</div></div>'
            + '<button class="btn small' + (c ? '' : ' primary') + '" data-use>' + (c ? '移出' : '用上') + '</button></div>';
    }

    function filtered() {
        const q = ui.q.trim().toLowerCase();
        return data.list.filter((x) => (ui.group === null || x.group === ui.group) && (!q || (x.name + ' ' + x.group).toLowerCase().includes(q)));
    }

    async function open() {
        await ready();
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>Vibe 库</b>'
            + '<button class="btn small" data-many>批量导入</button><button class="btn small primary" data-add>加图</button></div>'
            + '<div class="vl-top"><input type="text" class="vl-q" placeholder="搜索名字、分组"><div class="tabs vl-groups"></div></div>'
            + '<div class="page-body"><div class="help vl-tip" style="margin-bottom:10px"></div><div class="vl-list"></div></div>');
        const q = $('.vl-q', L.box);
        q.value = ui.q;
        const draw = async () => {
            const gs = groups();
            if (ui.group && !gs.includes(ui.group)) ui.group = null;
            const noGroup = data.list.filter((x) => !x.group).length;
            $('.vl-groups', L.box).innerHTML = '<button data-g="*"' + (ui.group === null ? ' class="on"' : '') + '>全部 ' + data.list.length + '</button>'
                + gs.map((g) => '<button data-g="' + esc(g) + '"' + (ui.group === g ? ' class="on"' : '') + '>' + esc(g) + ' ' + data.list.filter((x) => x.group === g).length + '</button>').join('')
                + (gs.length && noGroup ? '<button data-g=""' + (ui.group === '' ? ' class="on"' : '') + '>没分组 ' + noGroup + '</button>' : '');
            const used = (nai().vibes || []).filter((x) => x.on !== false).length;
            $('.vl-tip', L.box).innerHTML = '库里的图点「用上」放进创作页的「画风参考图」卡片，在那里调这次的强度；点一行改名字、分组、默认强度，或导出。'
                + (used ? '创作页现在用着 ' + used + ' 张。' : '')
                + (Params.isV5(nai().model) ? '<br><b>现在是 V5，官方不支持 Vibe，换 V4.5 / V4 / V3 才会用上。</b>' : '');
            const list = filtered();
            const ds = await Promise.all(list.map((x) => Vibes.load(x.id).catch(() => null)));
            $('.vl-list', L.box).innerHTML = list.length ? list.map((x, i) => rowHtml(x, ds[i])).join('')
                : data.list.length ? '<div class="empty">没有找到</div>'
                    : '<div class="empty"><b>Vibe 库是空的</b>点「加图」选手机里的图片、App 图库里的图，或者官网导出的 .naiv4vibe 文件。创作页加过的参考图也都会收在这里</div>';
        };
        await draw();
        let t = 0;
        q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { ui.q = q.value; draw(); }, 150); });
        $('.vl-groups', L.box).addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) { ui.group = b.dataset.g === '*' ? null : b.dataset.g; draw(); } });
        $('[data-add]', L.box).onclick = async () => {
            const f = await RefPick.pick('加进 Vibe 库', '手机里的图片或 .naiv4vibe');
            if (!f) return;
            try { const v = await Vibes.importFile(f); toast('success', '「' + v.name + '」' + (v.hasImage ? '' : '（只有编码，没带原图）'), '已加进 Vibe 库'); draw(); } catch (err) { toast('error', err.message || String(err), '加图失败'); }
        };
        $('[data-many]', L.box).onclick = () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.multiple = true;
            inp.accept = 'image/*,.naiv4vibe,application/json';
            inp.onchange = async () => {
                const files = Array.from(inp.files || []);
                let okN = 0;
                for (const f of files) {
                    try { await Vibes.importFile(f); okN++; } catch (err) { toast('error', (f.name || '') + '：' + (err.message || err), '导入失败'); }
                }
                if (okN) toast('success', '导入了 ' + okN + ' 张');
                draw();
            };
            inp.click();
        };
        $('.vl-list', L.box).addEventListener('click', (e) => {
            const row = e.target.closest('[data-id]'); if (!row) return;
            const x = find(row.dataset.id); if (!x) return;
            if (e.target.closest('[data-use]')) { toggleUse(x); draw(); return; }
            edit(x, draw);
        });
        return L;
    }

    function toggleUse(x) {
        const list = nai().vibes, i = list.findIndex((v) => v.id === x.id);
        if (i >= 0) {
            list.splice(i, 1);
            UI.saveSettings();
            Vibes.render();
            Vibes.changed();
            toast('info', '已从创作页移出「' + x.name + '」');
        } else {
            Vibes.use(x);
            toast('success', '已放进创作页的画风参考图', '「' + x.name + '」');
        }
    }

    /** 点一行：改名字、分组、默认强度 / 信息提取量，导出，删除 */
    async function edit(x, redraw) {
        const d = await Vibes.load(x.id).catch(() => null);
        const gs = groups();
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>' + esc(x.name) + '</h3>'
            + '<div style="max-height:64vh;overflow-y:auto">'
            + (d && d.thumb ? '<img class="vl-big" src="' + esc(d.thumb) + '" alt="">' : '')
            + '<div class="card-sub" style="margin-bottom:10px">' + esc(encText(d)) + '</div>'
            + '<div class="field"><label>名字</label><input type="text" data-f="name"></div>'
            + '<div class="field"><label>分组（可留空）</label><input type="text" data-f="group" placeholder="比如 水彩 / 厚涂 / 赛博朋克">'
            + (gs.length ? '<div class="vl-gpick">' + gs.map((g) => '<button class="btn small" data-g="' + esc(g) + '">' + esc(g) + '</button>').join('') + '</div>' : '') + '</div>'
            + '<div class="label">放进创作页时的默认值</div>'
            + '<div class="vibe-slider"><span>强度</span><input type="range" min="0" max="1" step="0.05" data-f="strength"><b></b></div>'
            + '<div class="vibe-slider"><span>信息提取量</span><input type="range" min="0.05" max="1" step="0.05" data-f="info"><b></b></div>'
            + '<div class="card-sub">换了信息提取量，V4 起第一次用要重新编码一次（扣 2 Anlas）。</div></div>'
            + '<div class="btns" style="flex-wrap:wrap"><button class="btn danger" data-a="del">删除</button><button class="btn" data-a="export">导出 .naiv4vibe</button>'
            + '<button class="btn primary" data-a="done">好了</button></div>', { onClose: () => commit() });
        const box = L.box;
        $$('[data-f]', box).forEach((el) => {
            el.value = x[el.dataset.f];
            const show = () => { if (el.type === 'range') el.nextElementSibling.textContent = el.value; };
            show();
            el.addEventListener('input', show);
        });
        const gp = $('.vl-gpick', box);
        if (gp) gp.onclick = (e) => { const b = e.target.closest('[data-g]'); if (b) $('[data-f="group"]', box).value = b.dataset.g; };
        let gone = false;
        function commit() {
            if (gone) return;
            const v = (k) => $('[data-f="' + k + '"]', box).value;
            const name = v('name').trim() || x.name;
            Object.assign(x, norm(Object.assign({}, x, { name, group: v('group'), strength: v('strength'), info: v('info') })));
            save();
            const c = onCard(x.id);
            if (c && c.name !== x.name) { c.name = x.name; UI.saveSettings(); Vibes.render(); }
            if (redraw) redraw();
        }
        box.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'done') { UI.closeLayer(L); return; }
            if (b.dataset.a === 'export') { commit(); Vibes.exportVibe(x).catch((err) => toast('error', err.message, '导出失败')); return; }
            if (b.dataset.a === 'del') {
                if (!await UI.confirmBox('删除「' + x.name + '」？', '图和编码一起删掉，创作页用着的也会拿掉，以后再加要重新编码。', '删除', true)) return;
                gone = true;
                await remove(x.id);
                UI.closeLayer(L, true);
                if (redraw) redraw();
            }
        });
    }

    async function remove(id) {
        data.list = data.list.filter((x) => x.id !== id);
        save();
        const list = nai().vibes, i = list.findIndex((v) => v.id === id);
        if (i >= 0) { list.splice(i, 1); UI.saveSettings(); }
        Vibes.forget(id);
        await Store.del('vibe:' + id);
        Vibes.render();
        Vibes.changed();
    }

    /** 创作页卡片上「Vibe 库」：选一张放进来，或者去管理页 */
    async function pick() {
        await ready();
        const rest = data.list.filter((x) => !onCard(x.id));
        const ds = await Promise.all(rest.map((x) => Vibes.load(x.id).catch(() => null)));
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>从 Vibe 库选</h3>'
            + (rest.length ? '<div class="vl-pick">' + rest.map((x, i) => '<div class="vl-cell" data-id="' + esc(x.id) + '">'
                + (ds[i] && ds[i].thumb ? '<img src="' + esc(ds[i].thumb) + '" alt="">' : '<div class="vibe-thumb"></div>')
                + '<span>' + esc(x.name) + '</span></div>').join('') + '</div>'
                : '<div class="card-sub">' + (data.list.length ? '库里的图都已经在创作页上了。' : '库里还没有图。') + '</div>')
            + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-manage>管理 Vibe 库</button></div>');
        $('[data-manage]', L.box).onclick = () => { UI.closeLayer(L, true); open(); };
        const grid = $('.vl-pick', L.box);
        if (grid) grid.onclick = (e) => {
            const c = e.target.closest('[data-id]'); if (!c) return;
            const x = find(c.dataset.id);
            UI.closeLayer(L, true);
            Vibes.use(x);
            toast('success', '已放进画风参考图', '「' + x.name + '」');
        };
    }

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.vl-top{flex:none;padding:10px 12px;border-bottom:1px solid var(--line)}.vl-top .tabs{padding:10px 0 0}'
        + '.vl-row{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer}'
        + '.vl-name{font-weight:600;overflow-wrap:anywhere}.vl-row .card-sub{margin-top:2px}'
        + '.vl-big{display:block;max-width:100%;max-height:30vh;margin:0 auto 8px;border-radius:10px}'
        + '.vl-gpick{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}'
        + '.vl-pick{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:56vh;overflow-y:auto}'
        + '.vl-cell{cursor:pointer;text-align:center;font-size:12px;color:var(--dim);min-width:0}'
        + '.vl-cell img,.vl-cell .vibe-thumb{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover;border-radius:8px;margin-bottom:4px}'
        + '.vl-cell span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
        + '</style>');

    SettingsPage.addTab({
        id: 'vibelib', label: 'Vibe 库', after: 'inspo',
        html: () => '<div class="help" style="margin-bottom:12px">加过的画风参考图（Vibe）都收在这里，可以分组、改默认强度、导入导出 .naiv4vibe，要用哪张再放进创作页。现在库里有 ' + data.list.length + ' 张。</div>'
            + '<div class="btns" style="justify-content:flex-start"><button class="btn primary" data-act="vibelib-open">打开 Vibe 库</button></div>',
        acts: { 'vibelib-open': () => open() },
    });

    setTimeout(() => {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'vibelib', group: '多角色与参考图', title: 'Vibe 库', target: '#c-vibes [data-a="lib"]', tip: '所有参考图都收在 Vibe 库，要用哪张选哪张',
            text: '「画风参考图」卡片上的「Vibe 库」（设置里也有入口）：加过的参考图都在这里，能分组、搜索、改名字和默认强度 / 信息提取量、批量导入图片或 .naiv4vibe、导出。点「用上」放进创作页；卡片上的「移出」只是不用了，图和编码还在库里，下次用不用重新编码。在库里删除才会真删。' });
    });

    window.VibeLib = { open, pick, adopt, has, rename, remove, ready, get list() { return data.list; } };
})();
