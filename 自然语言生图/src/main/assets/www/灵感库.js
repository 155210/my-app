/*
 * 灵感库.js —— 存常用的提示词片段（角色 / 画风 / 场景 / 自己起的分类），每条带一张预览图，点一下加进创作页
 *
 * 数据在 Store 的 inspo 键：{ v: 1, list: [{ id, cat 分类, name, tags 正面, negative 负面, note 备注, thumb 预览图 dataURL, time }] }
 * 预览图存成 360px 宽的 JPEG（进设置备份，不能太大）。来源：App 图库、手机、或者直接用这条片段出一张。
 * 入口：创作页「正面提示词」标题旁边、大图下面「存灵感」（带上这张图的提示词和图）、设置页「灵感库」。
 *
 * 对外：InspoLib.open()、add(条目)、apply(条目, { neg })、list
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const KEY = 'inspo';
    const CATS = ['角色', '画风', '场景', '其他'];
    const THUMB_W = 360;
    let data = { v: 1, list: [] };
    const ui = { cat: '', q: '' };

    const ready = Store.get(KEY, null).then((d) => {
        if (d && Array.isArray(d.list)) data = { v: 1, list: d.list.filter((x) => x && x.id).map(norm) };
    }).catch((e) => console.warn(e));
    const save = () => Store.set(KEY, data).catch((e) => toast('error', e.message, '保存灵感库失败'));

    function norm(x) {
        return { id: x.id, cat: String(x.cat || '其他').trim() || '其他', name: String(x.name || ''), tags: String(x.tags || ''), negative: String(x.negative || ''),
            note: String(x.note || ''), thumb: typeof x.thumb === 'string' ? x.thumb : '', time: x.time || Date.now() };
    }
    const newId = () => 'in_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    /** 现有的分类：内置四个在前，自己起的跟在后面 */
    const allCats = () => CATS.concat([...new Set(data.list.map((x) => x.cat))].filter((c) => !CATS.includes(c)));

    // ------------------------------------------------------------
    // 预览图
    // ------------------------------------------------------------
    function thumbOf(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const s = Math.min(1, THUMB_W / img.naturalWidth);
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.naturalWidth * s));
                c.height = Math.max(1, Math.round(img.naturalHeight * s));
                const g = c.getContext('2d');
                g.fillStyle = '#fff';
                g.fillRect(0, 0, c.width, c.height);
                g.drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                resolve(c.toDataURL('image/jpeg', 0.82));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('读不出这张图')); };
            img.src = url;
        });
    }
    async function thumbOfItem(item) {
        const blob = await Gallery.getBlob(item.id).catch(() => null);
        return blob ? thumbOf(blob).catch(() => item.thumb || '') : (item.thumb || '');
    }

    // ------------------------------------------------------------
    // 数据
    // ------------------------------------------------------------
    function add(x) {
        const it = norm(Object.assign({}, x, { id: newId(), time: Date.now() }));
        data.list.unshift(it);
        save();
        return it;
    }
    function remove(id) {
        data.list = data.list.filter((x) => x.id !== id);
        save();
    }

    /** 把片段并进一个格子：逗号分隔，已经有的不重复加 */
    function merge(cur, add) {
        const key = (s) => s.trim().toLowerCase().replace(/_/g, ' ');
        const parts = String(cur || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        const have = new Set(parts.map(key));
        String(add || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean).forEach((t) => { if (!have.has(key(t))) { parts.push(t); have.add(key(t)); } });
        return parts.join(', ');
    }
    function fill(sel, text) {
        const box = $(sel);
        if (!box || !String(text || '').trim()) return false;
        box.value = merge(box.value, text);
        box.dispatchEvent(new Event('input', { bubbles: true })); // 让创作页存草稿
        return true;
    }
    /** 加进创作页：正面并进「正面提示词」，负面并进「补充负面词」 */
    function apply(it, opts) {
        opts = opts || {};
        if (!$('#c-tag')) { UI.copyText(it.tags); return; }
        if (UI.currentTab && UI.currentTab() !== 'create') UI.showTab('create');
        const a = fill('#c-tag', it.tags);
        const b = opts.neg !== false && fill('#c-neg', it.negative);
        toast('success', a ? (b ? '正面和负面都加上了' : '已加进正面提示词') : (b ? '已加进负面词' : '这条是空的'), '「' + (it.name || '灵感') + '」');
    }

    // ------------------------------------------------------------
    // 界面
    // ------------------------------------------------------------
    function cardHtml(it) {
        return '<div class="in-card" data-id="' + esc(it.id) + '">'
            + (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="">' : '<div class="in-noimg">没有预览图</div>')
            + '<div class="in-meta"><b>' + esc(it.name || '（没起名字）') + '</b><span class="badge">' + esc(it.cat) + '</span></div>'
            + '<div class="in-tags">' + esc(it.tags || '（没有正面词）') + '</div></div>';
    }

    function filtered() {
        const q = ui.q.trim().toLowerCase();
        return data.list.filter((x) => (!ui.cat || x.cat === ui.cat)
            && (!q || (x.name + '\n' + x.tags + '\n' + x.negative + '\n' + x.note).toLowerCase().includes(q)));
    }

    async function open() {
        await ready;
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>灵感库</b>'
            + '<span class="card-sub in-count"></span><button class="btn small primary" data-new>新建</button></div>'
            + '<div class="in-top"><input type="text" class="in-q" placeholder="搜索名字、标签、备注"><div class="tabs in-cats"></div></div>'
            + '<div class="page-body"><div class="in-grid"></div></div>');
        const q = $('.in-q', L.box);
        q.value = ui.q;
        const draw = () => {
            const cats = allCats();
            if (ui.cat && !cats.includes(ui.cat)) ui.cat = '';
            const count = (c) => data.list.filter((x) => x.cat === c).length;
            $('.in-cats', L.box).innerHTML = '<button data-c=""' + (ui.cat ? '' : ' class="on"') + '>全部 ' + data.list.length + '</button>'
                + cats.map((c) => '<button data-c="' + esc(c) + '"' + (ui.cat === c ? ' class="on"' : '') + '>' + esc(c) + ' ' + count(c) + '</button>').join('');
            const list = filtered();
            $('.in-count', L.box).textContent = '';
            $('.in-grid', L.box).innerHTML = list.length ? list.map(cardHtml).join('')
                : data.list.length ? '<div class="empty" style="grid-column:1/-1">没有找到</div>'
                    : '<div class="empty" style="grid-column:1/-1"><b>灵感库是空的</b>点「新建」存一段常用的提示词（某个角色、某种画风、某个场景），配一张预览图；或者在图库大图下面点「存灵感」，把那张图的提示词连图一起存进来</div>';
        };
        draw();
        let t = 0;
        q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { ui.q = q.value; draw(); }, 150); });
        $('.in-cats', L.box).addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { ui.cat = b.dataset.c; draw(); } });
        $('[data-new]', L.box).onclick = () => edit(null, draw);
        $('.in-grid', L.box).addEventListener('click', (e) => {
            const c = e.target.closest('[data-id]');
            const it = c && data.list.find((x) => x.id === c.dataset.id);
            if (it) detail(it, draw, L);
        });
        return L;
    }

    /** 点一张卡片：大图 + 内容 + 加进创作页 */
    function detail(it, redraw, page) {
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>' + esc(it.name || '（没起名字）') + ' <span class="badge">' + esc(it.cat) + '</span></h3>'
            + '<div style="max-height:62vh;overflow-y:auto">'
            + (it.thumb ? '<img class="in-big" src="' + esc(it.thumb) + '" alt="">' : '')
            + '<div class="label">正面</div><pre class="recipe">' + esc(it.tags || '（空）') + '</pre>'
            + (it.negative ? '<div class="label" style="margin-top:8px">负面</div><pre class="recipe">' + esc(it.negative) + '</pre>' : '')
            + (it.note ? '<div class="card-sub" style="margin-top:8px">' + esc(it.note) + '</div>' : '') + '</div>'
            + '<div class="btns" style="flex-wrap:wrap">'
            + '<button class="btn" data-a="edit">编辑</button><button class="btn" data-a="copy">复制正面</button>'
            + (it.negative ? '<button class="btn" data-a="pos">只加正面</button>' : '')
            + '<button class="btn primary" data-a="use">加进创作页</button></div>');
        L.box.addEventListener('click', (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            const a = b.dataset.a;
            if (a === 'copy') { UI.copyText(it.tags); return; }
            if (a === 'edit') { UI.closeLayer(L, true); edit(it, redraw); return; }
            UI.closeLayer(L, true);
            if (page) UI.closeLayer(page, true);
            apply(it, { neg: a !== 'pos' });
        });
    }

    /** 编辑一条；it 为 null 时新建，preset 是新建时预填的内容 */
    function edit(it, onDone, preset) {
        const isNew = !it;
        const d = norm(it || Object.assign({ id: '', cat: ui.cat || '角色' }, preset || {}));
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>' + (isNew ? '新建灵感' : '编辑灵感') + '</b>'
            + '<button class="btn small primary" data-save>保存</button></div>'
            + '<div class="page-body">'
            + '<div class="in-pv"></div>'
            + '<div class="btns" style="justify-content:flex-start;flex-wrap:wrap;margin:8px 0 14px">'
            + '<button class="btn small" data-p="gallery">从图库选</button><button class="btn small" data-p="phone">从手机选</button>'
            + '<button class="btn small" data-p="draw">用这段出一张</button><button class="btn small danger" data-p="clear">去掉图</button></div>'
            + '<div class="field"><label>名字</label><input type="text" data-f="name" placeholder="比如 赛博朋克夜景 / 小雪校服 / 厚涂画风"></div>'
            + '<div class="field"><label>分类</label><div class="in-catpick"></div>'
            + '<input type="text" data-f="cat" placeholder="也可以自己起一个分类" style="margin-top:6px"></div>'
            + '<div class="field"><label>正面（英文标签，逗号分隔）</label><textarea class="ta" data-f="tags" placeholder="比如 neon lights, rain, night city, cyberpunk"></textarea></div>'
            + '<div class="field"><label>负面（可留空）</label><textarea class="ta small" data-f="negative"></textarea></div>'
            + '<div class="field"><label>备注（只给自己看）</label><textarea class="ta small" data-f="note"></textarea></div>'
            + (isNew ? '' : '<div class="btns" style="justify-content:flex-start"><button class="btn danger" data-del>删除这条</button></div>')
            + '</div>');
        const box = L.box;
        const pv = () => {
            $('.in-pv', box).innerHTML = d.thumb ? '<img class="in-big" src="' + esc(d.thumb) + '" alt="">' : '<div class="in-noimg in-big">还没有预览图</div>';
            $('[data-p="clear"]', box).hidden = !d.thumb;
        };
        const cats = () => {
            $('.in-catpick', box).innerHTML = '<div class="seg" style="flex-wrap:wrap">' + allCats().map((c) => '<button data-cat="' + esc(c) + '"' + (c === d.cat ? ' class="on"' : '') + '>' + esc(c) + '</button>').join('') + '</div>';
        };
        $$('[data-f]', box).forEach((el) => {
            el.value = d[el.dataset.f] || '';
            el.addEventListener('input', () => { d[el.dataset.f] = el.value; if (el.dataset.f === 'cat') $$('[data-cat]', box).forEach((b) => b.classList.toggle('on', b.dataset.cat === el.value.trim())); });
        });
        $('.in-catpick', box).addEventListener('click', (e) => {
            const b = e.target.closest('[data-cat]'); if (!b) return;
            d.cat = b.dataset.cat;
            $('[data-f="cat"]', box).value = d.cat;
            cats();
        });
        pv();
        cats();
        if (window.PromptEdit && PromptEdit.attach) $$('textarea[data-f="tags"], textarea[data-f="negative"]', box).forEach((ta) => { try { PromptEdit.attach(ta); } catch (e) { /* 没有联想也能用 */ } });

        $('.btns', box).addEventListener('click', async (e) => {
            const b = e.target.closest('[data-p]'); if (!b) return;
            const p = b.dataset.p;
            if (p === 'clear') { d.thumb = ''; pv(); return; }
            if (p === 'draw') { drawPreview(d, pv, b); return; }
            const f = p === 'phone' ? await window.RefPick.pickPhone('image/*') : await window.RefPick.pickGallery();
            if (!f) return;
            try { d.thumb = await thumbOf(f); pv(); } catch (err) { toast('error', err.message); }
        });

        $('[data-save]', box).onclick = () => {
            d.name = d.name.trim();
            d.cat = d.cat.trim() || '其他';
            d.tags = d.tags.trim();
            d.negative = d.negative.trim();
            if (!d.name) { toast('warning', '先起个名字'); return; }
            if (!d.tags && !d.negative) { toast('warning', '正面、负面至少写一个'); return; }
            if (isNew) add(d);
            else { Object.assign(it, d, { id: it.id, time: it.time }); save(); }
            UI.closeLayer(L);
            toast('success', '已存进灵感库');
            if (onDone) onDone();
        };
        const del = $('[data-del]', box);
        if (del) del.onclick = async () => {
            if (!await UI.confirmBox('删除「' + (it.name || '这条') + '」？', '只删灵感库里这一条，图库里的图不受影响。', '删除', true)) return;
            remove(it.id);
            UI.closeLayer(L);
            if (onDone) onDone();
        };
        return L;
    }

    /** 用这段提示词出一张图当预览（走出图队列，出好的图也进图库） */
    function drawPreview(d, pv, btn) {
        if (!d.tags.trim()) { toast('warning', '先写正面'); return; }
        const jobs = CreatePage.draw({ desc: '灵感预览：' + (d.name || ''), tag: d.tags, nl: '', negative: d.negative, size: 'portrait', characters: [], label: '灵感预览 ' + (d.name || '') }, 1);
        if (!jobs || !jobs[0]) return;
        btn.disabled = true;
        btn.textContent = '出图中…';
        Promise.resolve(jobs[0]).then(async (item) => {
            if (!item) return;
            d.thumb = await thumbOfItem(item);
            pv();
            toast('success', '预览图出好了，记得点保存');
        }).catch((e) => toast('error', e.message || String(e), '出预览图失败')).finally(() => { btn.disabled = false; btn.textContent = '用这段出一张'; });
    }

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.in-entry{float:right;color:var(--accent);text-decoration:none;font-size:13px;margin-right:12px}'
        + '.in-top{flex:none;padding:10px 12px 10px;border-bottom:1px solid var(--line)}.in-top .tabs{padding:10px 0 0}'
        + '.in-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}'
        + '.in-card{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg2);cursor:pointer;min-width:0}'
        + '.in-card img,.in-card .in-noimg{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:var(--bg3)}'
        + '.in-noimg{display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:12px;background:var(--bg3)}'
        + '.in-meta{display:flex;gap:6px;align-items:center;padding:6px 8px 0}.in-meta b{flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
        + '.in-tags{padding:2px 8px 8px;font-size:12px;color:var(--dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}'
        + '.in-big{display:block;max-width:100%;max-height:42vh;margin:0 auto 10px;border-radius:10px;object-fit:contain}'
        + 'div.in-big{width:150px;height:200px;border-radius:10px}'
        + '.in-catpick .seg button{padding:5px 12px}'
        + '</style>');

    // 创作页「正面提示词」标题旁边放个入口（创作页重画时自动补上）
    function addEntry() {
        const box = $('#c-tag');
        if (!box || $('#c-inspo')) return;
        const label = (box.closest('.field') || box.parentNode).querySelector('label');
        if (!label) return;
        label.insertAdjacentHTML('beforeend', '<a href="#" id="c-inspo" class="in-entry">灵感库</a>');
        $('#c-inspo').addEventListener('click', (e) => { e.preventDefault(); open(); });
    }
    const view = $('#view-create');
    if (view) new MutationObserver(addEntry).observe(view, { childList: true, subtree: true });
    addEntry();

    // 大图下面「存灵感」：带上这张图的提示词和图
    if (window.GalleryPage && GalleryPage.addViewerAction) {
        GalleryPage.addViewerAction({
            id: 'inspo', label: '存灵感',
            icon: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
            run: async (item) => {
                await ready;
                const thumb = await thumbOfItem(item);
                edit(null, null, { name: String(item.desc || '').replace(/\s+/g, ' ').slice(0, 16), tags: item.tag || '', negative: item.extraNegative || '', note: item.desc || '', thumb });
            },
        });
    }

    SettingsPage.addTab({
        id: 'inspo', label: '灵感库', after: 'tags',
        html: () => '<div class="help" style="margin-bottom:12px">存常用的提示词片段，按角色 / 画风 / 场景分类，每条配一张预览图，用的时候点一下加进创作页。现在存了 ' + data.list.length + ' 条。</div>'
            + '<div class="btns" style="justify-content:flex-start"><button class="btn primary" data-act="inspo-open">打开灵感库</button></div>',
        acts: { 'inspo-open': () => open() },
    });

    setTimeout(() => {
        if (!window.Help || !Help.add) return;
        // 入口在创作页顶上，不弹新手提示：启动时的轻提示挡住顶栏时它会抢在「?」前面
        Help.add({ id: 'inspo', group: '创作页', title: '灵感库',
            text: '「正面提示词」旁边的「灵感库」：按角色、画风、场景（也能自己起分类）存提示词片段，每条配一张预览图（从图库选、从手机选，或者直接用这段出一张）。点一条再点「加进创作页」，正面并进正面提示词、负面并进补充负面词，已经有的标签不重复加。图库大图下面的「存灵感」能把那张图的提示词连图一起存进来。' });
    });

    window.InspoLib = { ready, open, edit, add, remove, apply, merge, CATS, get list() { return data.list; } };
})();
