/*
 * 参数预设.js —— 把「整套出图参数 + 多角色 + 参考图」存成一个预设，创作页最上面下拉一键切换
 *
 * 存在 Store 的 presets 键：{ list: [{ id, name, nai, chars, time }], cur }（设置导出时自动带上）。
 * nai：设置里 NAI 那一整块，去掉地址、Key、画风模板库（模板库是共用的，预设只记选了哪套）；
 *      以后别的功能往 nai 里加的字段也会自动跟着存。
 * 参考图：只记开关、强度、信息提取量；切换时预设里没有的参考图关掉，已经删掉的跳过（图不复制，省空间）。
 * chars：创作页多角色格子。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const SKIP = ['url', 'key', 'styles'];
    let data = { list: [], cur: '' };
    let bar = null;

    const clone = (x) => JSON.parse(JSON.stringify(x));
    const save = () => Store.set('presets', data);
    const cur = () => data.list.find((x) => x.id === data.cur) || null;

    function snapshot() {
        const nai = {};
        Object.keys(UI.settings.nai).forEach((k) => { if (!SKIP.includes(k)) nai[k] = clone(UI.settings.nai[k]); });
        nai.vibes = (nai.vibes || []).map((v) => ({ id: v.id, on: v.on !== false, strength: v.strength, info: v.info }));
        const chars = window.Characters ? clone(Characters.get()).map((c) => ({ on: c.on !== false, tag: c.tag || '', negative: c.negative || '', pos: c.pos || '' })) : [];
        return { nai, chars };
    }
    const same = (p) => { const s = snapshot(); return JSON.stringify(s.nai) === JSON.stringify(p.nai) && JSON.stringify(s.chars) === JSON.stringify(p.chars); };

    function apply(p) {
        const n = UI.settings.nai;
        const want = new Map((p.nai.vibes || []).map((v) => [v.id, v]));
        Object.keys(p.nai).forEach((k) => { if (!SKIP.includes(k) && k !== 'vibes') n[k] = clone(p.nai[k]); });
        (n.vibes || []).forEach((v) => {
            const w = want.get(v.id);
            if (w) Object.assign(v, { on: w.on, strength: w.strength, info: w.info }); else v.on = false;
        });
        if (n.styleId && !(n.styles || []).some((x) => x.id === n.styleId)) n.styleId = '';
        UI.saveSettings();
        if (window.Characters) Characters.set(clone(p.chars || []));
        data.cur = p.id;
        save();
        CreatePage.refresh();
        if (window.Vibes) Vibes.render();
        if (window.QuickBar) QuickBar.render();
        render();
    }

    function askName(title, def) {
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('dialog', '<h3>' + esc(title) + '</h3><div class="field"><input type="text" data-n value="' + esc(def || '') + '" placeholder="比如：V5 竖图 双人"></div>'
                + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-ok>保存</button></div>',
            { onClose: () => { if (!done) resolve(null); } });
            const inp = $('[data-n]', L.box);
            setTimeout(() => { inp.focus(); inp.select(); }, 50);
            const ok = () => { const v = inp.value.trim(); if (!v) { toast('warning', '起个名字'); return; } done = true; UI.closeLayer(L, true); resolve(v); };
            $('[data-ok]', L.box).onclick = ok;
            inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
        });
    }

    async function saveNew() {
        const name = await askName('存成新预设', '预设' + (data.list.length + 1));
        if (!name) return;
        const p = Object.assign({ id: 'pr_' + Date.now().toString(36), name, time: Date.now() }, snapshot());
        data.list.push(p);
        data.cur = p.id;
        await save();
        render();
        toast('success', '已存成「' + name + '」');
    }

    function menu() {
        const p = cur();
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>预设</h3>'
            + '<div class="card-sub" style="margin-bottom:10px">预设记的是：NAI 出图的全部参数（模型、尺寸、步数、种子、画风模板选哪套、质量词、负面词…）、多角色、参考图开关和强度。不记提示词。</div>'
            + '<div class="pre-menu">'
            + '<button class="btn primary" data-m="new">把现在的设置存成新预设</button>'
            + (p ? '<button class="btn" data-m="over">用现在的设置覆盖「' + esc(p.name) + '」</button>'
                + '<button class="btn" data-m="ren">改名「' + esc(p.name) + '」</button>'
                + '<button class="btn danger" data-m="del">删除「' + esc(p.name) + '」</button>' : '')
            + '</div>'
            + (data.list.length ? '<div class="label" style="margin-top:14px">全部预设（点一下切换）</div>' + data.list.map((x) => '<div class="pick' + (x.id === data.cur ? ' on' : '') + '" data-p="' + x.id + '">' + esc(x.name)
                + ' <span class="card-sub">' + esc(Params.modelLabel(x.nai.model)) + (x.chars.length ? ' · ' + x.chars.length + ' 个角色' : '') + ((x.nai.vibes || []).some((v) => v.on) ? ' · 参考图' : '') + '</span></div>').join('') : '')
            + '<div class="btns"><button class="btn" data-close>关闭</button></div>');
        L.box.addEventListener('click', async (e) => {
            const pk = e.target.closest('[data-p]');
            if (pk) { UI.closeLayer(L); apply(data.list.find((x) => x.id === pk.dataset.p)); toast('success', '已切换'); return; }
            const m = e.target.closest('[data-m]');
            if (!m) return;
            UI.closeLayer(L);
            if (m.dataset.m === 'new') saveNew();
            if (m.dataset.m === 'over') { Object.assign(p, snapshot(), { time: Date.now() }); await save(); render(); toast('success', '已覆盖「' + p.name + '」'); }
            if (m.dataset.m === 'ren') { const n = await askName('改名', p.name); if (n) { p.name = n; await save(); render(); } }
            if (m.dataset.m === 'del') {
                if (!await UI.confirmBox('删除预设「' + p.name + '」？', '只删预设，现在的设置不变。', '删除', true)) return;
                data.list = data.list.filter((x) => x !== p);
                data.cur = '';
                await save();
                render();
            }
        });
    }

    function render() {
        if (!bar) return;
        const p = cur();
        const sel = $('select', bar);
        sel.innerHTML = '<option value="">' + (data.list.length ? '不用预设' : '还没有预设') + '</option>'
            + data.list.map((x) => '<option value="' + x.id + '"' + (x.id === data.cur ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
        $('.pre-mod', bar).hidden = !p || same(p);
    }

    function mount() {
        const view = $('#view-create');
        if (!view || $('#c-preset')) return;
        bar = document.createElement('div');
        bar.id = 'c-preset';
        bar.className = 'row pre-bar';
        bar.innerHTML = '<span class="pre-label">预设</span><select class="grow" aria-label="预设"></select><span class="badge pre-mod" hidden title="现在的设置和预设不一样">改过</span>'
            + '<button class="btn small" data-a="menu">存 / 管理</button>';
        view.insertBefore(bar, view.firstChild);
        $('select', bar).addEventListener('change', (e) => {
            const p = data.list.find((x) => x.id === e.target.value);
            if (p) { apply(p); toast('success', '已切换到「' + p.name + '」'); } else { data.cur = ''; save(); render(); }
        });
        $('[data-a="menu"]', bar).addEventListener('click', menu);
        render();
    }

    const init = CreatePage.init, refresh = CreatePage.refresh;
    CreatePage.init = async function () {
        const d = await Store.get('presets', null);
        if (d && Array.isArray(d.list)) data = d;
        await init.apply(this, arguments);
        mount();
    };
    // refresh 很频繁，只更新「改过」标记
    let t = 0;
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        clearTimeout(t);
        t = setTimeout(() => { if (bar) $('.pre-mod', bar).hidden = !cur() || same(cur()); }, 200);
    };

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.pre-bar{margin:0 0 10px}.pre-bar select{padding:6px 8px}.pre-label{font-size:13px;color:var(--dim);flex:none}'
        + '.pre-menu{display:flex;flex-direction:column;gap:8px}.pre-menu .btn{text-align:left}'
        + '</style>');

    window.Presets = { snapshot, apply, get: () => data, saveNew };
})();
