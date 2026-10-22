/*
 * 多画布.js —— 创作页顶上一排「画布」：每个画布存一整套描述 + 提示词 + 出图参数，点一下来回切换，可以复制
 *
 * 存在 Store 的 canvases 键：{ list: [{ id, name, draft, snap, preset, time }], cur }（设置导出时自动带上）。
 * draft：创作页草稿（描述、正负面、英文描述、横竖、几张、标签…，以后加进草稿的字段自动跟着走）；
 * snap：Presets.snapshot()，NAI 参数 + 多角色格子 + 参考图开关强度（同预设，地址、Key、画风模板库不记）；
 * preset：当时预设下拉选的哪个。
 * 正在用的画布以创作页现在的样子为准，切走时才存进去；老用户第一次打开时现在的样子就是「画布 1」。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const MAX = 20;
    let data = { list: [], cur: '' };
    let bar = null;

    const clone = (x) => JSON.parse(JSON.stringify(x));
    const save = () => Store.set('canvases', data);
    const cur = () => data.list.find((x) => x.id === data.cur) || null;
    const newId = () => 'cv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    /** 把创作页现在的样子存进画布 c */
    function capture(c) {
        c.draft = clone(CreatePage.draft);
        c.snap = Presets.snapshot();
        c.preset = Presets.get().cur || '';
        c.time = Date.now();
    }
    function load(c) {
        CreatePage.setDraft(clone(c.draft || {}));
        if (c.snap) Presets.apply({ id: '', nai: clone(c.snap.nai), chars: clone(c.snap.chars || []) }, c.preset || '');
        data.cur = c.id;
    }
    function ensure() {
        if (cur()) return;
        if (!data.list.length) data.list.push({ id: newId(), name: '画布 1' });
        data.cur = data.list[0].id;
    }
    function nextName() {
        let i = data.list.length + 1;
        while (data.list.some((x) => x.name === '画布 ' + i)) i++;
        return '画布 ' + i;
    }

    async function switchTo(id) {
        const t = data.list.find((x) => x.id === id);
        if (!t || id === data.cur) return;
        if (CreatePage.busy) { toast('warning', 'AI 正在写，写完再切画布'); return; }
        capture(cur());
        load(t);
        await save();
        render();
    }

    /** 新建：提示词全空，出图参数接着用现在的 */
    async function add() {
        if (data.list.length >= MAX) { toast('warning', '最多 ' + MAX + ' 个画布，删掉不用的再建'); return; }
        if (CreatePage.busy) { toast('warning', 'AI 正在写，写完再建'); return; }
        const c = cur();
        capture(c);
        const d = clone(c.draft);
        ['desc', 'tag', 'nl', 'negative', 'hint'].forEach((k) => { d[k] = ''; });
        const n = { id: newId(), name: nextName(), draft: d, snap: c.snap, preset: c.preset, time: Date.now() };
        data.list.push(n);
        load(n);
        await save();
        render();
        toast('success', '新建了「' + n.name + '」，出图参数接着用刚才的');
    }

    /** 复制：一模一样再来一份（提示词、参数、多角色都带上），切到副本上 */
    async function copy(c) {
        if (data.list.length >= MAX) { toast('warning', '最多 ' + MAX + ' 个画布，删掉不用的再复制'); return; }
        if (CreatePage.busy) { toast('warning', 'AI 正在写，写完再复制'); return; }
        if (c.id === data.cur) capture(c);
        else capture(cur());
        const n = Object.assign(clone(c), { id: newId(), name: c.name + ' 副本', time: Date.now() });
        data.list.splice(data.list.indexOf(c) + 1, 0, n);
        load(n);
        await save();
        render();
        toast('success', '复制成「' + n.name + '」，现在改的是副本');
    }

    async function remove(c) {
        if (data.list.length < 2) { toast('warning', '只剩这一个画布了'); return; }
        if (!await UI.confirmBox('删除「' + c.name + '」？', '这个画布里的描述、提示词和参数会一起删掉，图库里的图不受影响。', '删除', true)) return;
        const i = data.list.indexOf(c);
        data.list.splice(i, 1);
        if (c.id === data.cur) load(data.list[Math.max(0, i - 1)]);
        await save();
        render();
    }

    function askName(def) {
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('dialog', '<h3>画布改名</h3><div class="field"><input type="text" data-n maxlength="20" value="' + esc(def) + '" placeholder="比如：天台黄昏"></div>'
                + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-ok>保存</button></div>',
            { onClose: () => { if (!done) resolve(null); } });
            const inp = $('[data-n]', L.box);
            setTimeout(() => { inp.focus(); inp.select(); }, 50);
            const ok = () => { const v = inp.value.trim(); if (!v) { toast('warning', '起个名字'); return; } done = true; UI.closeLayer(L, true); resolve(v); };
            $('[data-ok]', L.box).onclick = ok;
            inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
        });
    }

    /** 一个画布的小字：描述或提示词开头 */
    function brief(c) {
        const d = c.id === data.cur ? CreatePage.draft : (c.draft || {});
        return String(d.desc || d.tag || '').trim().replace(/\s+/g, ' ').slice(0, 14) || '空白';
    }

    function menu(c) {
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>' + esc(c.name) + '</h3>'
            + '<div class="card-sub" style="margin-bottom:10px">每个画布单独存一套：中文描述、正负面提示词、英文描述、横竖和张数，还有出图参数（模型、尺寸、步数、种子、画风模板、多角色、参考图开关）。切换时自动存好。</div>'
            + '<div class="pre-menu">'
            + (c.id !== data.cur ? '<button class="btn primary" data-m="go">切到这个画布</button>' : '')
            + '<button class="btn" data-m="copy">复制一份</button>'
            + '<button class="btn" data-m="ren">改名</button>'
            + '<button class="btn danger" data-m="del"' + (data.list.length < 2 ? ' disabled' : '') + '>删除</button>'
            + '</div><div class="btns"><button class="btn" data-close>关闭</button></div>');
        L.box.addEventListener('click', async (e) => {
            const m = e.target.closest('[data-m]');
            if (!m) return;
            UI.closeLayer(L);
            if (m.dataset.m === 'go') switchTo(c.id);
            if (m.dataset.m === 'copy') copy(c);
            if (m.dataset.m === 'ren') { const n = await askName(c.name); if (n) { c.name = n; await save(); render(); } }
            if (m.dataset.m === 'del') remove(c);
        });
    }

    function render() {
        if (!bar) return;
        const strip = $('.cv-strip', bar);
        const x = strip.scrollLeft;
        strip.innerHTML = data.list.map((c) => '<button class="cv-chip' + (c.id === data.cur ? ' on' : '') + '" data-id="' + c.id + '">'
            + '<span class="cv-name">' + esc(c.name) + '</span><span class="cv-sub">' + esc(brief(c)) + '</span></button>').join('')
            + '<button class="cv-chip cv-add" data-a="add" aria-label="新建画布">＋</button>';
        strip.scrollLeft = x;
        const on = $('.cv-chip.on', strip);
        if (on && (on.offsetLeft < strip.scrollLeft || on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth)) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function mount() {
        const view = $('#view-create');
        if (!view || $('#c-canvas')) return;
        bar = document.createElement('div');
        bar.id = 'c-canvas';
        bar.className = 'cv-bar';
        bar.innerHTML = '<div class="cv-strip"></div><button class="btn small" data-a="copy" title="复制这个画布">复制</button>';
        const pre = $('#c-preset', view);
        view.insertBefore(bar, pre ? pre.nextSibling : view.firstChild);
        // 点别的画布 = 切换；点正在用的那个 / 长按 = 菜单（改名、复制、删除）
        let pressTimer = 0, pressed = false;
        const strip = $('.cv-strip', bar);
        strip.addEventListener('pointerdown', (e) => {
            const b = e.target.closest('[data-id]');
            pressed = false;
            if (!b) return;
            pressTimer = setTimeout(() => { pressed = true; menu(data.list.find((x) => x.id === b.dataset.id)); }, 500);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => strip.addEventListener(ev, () => clearTimeout(pressTimer)));
        strip.addEventListener('scroll', () => clearTimeout(pressTimer), { passive: true });
        strip.addEventListener('contextmenu', (e) => e.preventDefault());
        strip.addEventListener('click', (e) => {
            if (pressed) { pressed = false; return; }
            if (e.target.closest('[data-a="add"]')) { add(); return; }
            const b = e.target.closest('[data-id]');
            if (!b) return;
            const c = data.list.find((x) => x.id === b.dataset.id);
            if (c.id === data.cur) menu(c); else switchTo(c.id);
        });
        $('[data-a="copy"]', bar).addEventListener('click', () => copy(cur()));
        render();
    }

    const init = CreatePage.init;
    CreatePage.init = async function () {
        const d = await Store.get('canvases', null);
        if (d && Array.isArray(d.list)) data = d;
        await init.apply(this, arguments);
        ensure();
        mount();
        save();
        addHelp();
    };
    // 小字跟着正在用的画布的描述走
    let t = 0;
    document.addEventListener('input', (e) => {
        if (!bar || !e.target.closest || !e.target.closest('#c-desc, #c-tag')) return;
        clearTimeout(t);
        t = setTimeout(() => { const s = $('.cv-chip.on .cv-sub', bar); if (s) s.textContent = brief(cur()); }, 300);
    });

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.cv-bar{display:flex;align-items:center;gap:8px;margin:0 0 10px}'
        + '.cv-strip{flex:1;min-width:0;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.cv-strip::-webkit-scrollbar{display:none}'
        + '.cv-chip{flex:none;display:flex;flex-direction:column;align-items:flex-start;max-width:132px;padding:5px 10px;border:1px solid var(--line);border-radius:10px;background:none;color:var(--text);text-align:left;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}'
        + '.cv-chip.on{border-color:var(--accent);background:var(--accent-faint)}'
        + '.cv-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}'
        + '.cv-sub{font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}'
        + '.cv-add{justify-content:center;align-items:center;font-size:18px;color:var(--dim);min-width:44px}'
        + '</style>');

    // 说明在创作页起来以后再加：新手提示按添加顺序弹，排在「?」「设置」那几条后面
    function addHelp() {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'create.canvas', group: '创作页', title: '多画布', target: '#c-canvas', tip: '这一排是画布：每个画布单独存一套提示词和参数，点一下切换，＋ 新建',
            text: '创作页顶上一排是画布。每个画布单独存一套：中文描述、正负面提示词、英文描述、横竖、张数、出图参数（模型、尺寸、步数、种子、画风模板）、多角色、参考图开关。'
                + '点别的画布就切过去，切走时自动存好；＋ 新建一个空白的（出图参数接着用现在的）；「复制」把现在这个原样复制一份再切过去，适合同一个画面试不同参数。'
                + '点正在用的画布或长按任意画布可以改名、复制、删除。最多 ' + MAX + ' 个，跟着设置导出。不花 Anlas。' });
    }

    window.Canvases = { get: () => data, switchTo, add, copy, remove, capture };
})();
