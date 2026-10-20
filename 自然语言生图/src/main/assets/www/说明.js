/*
 * 说明.js —— 新手提示（每个按钮第一次看到时弹一句说明）+ 右上角「?」的全部功能说明页
 *
 * 新功能怎么加说明（两种，选一种就行）：
 *   1. Help.add({ id, group, title, text, tip, target, anlas })
 *        id      唯一，比如 'create.draw'；同 id 再 add 就替换
 *        group   说明页里的分组：开始之前 / 创作页 / 批量页 / 图库 / 设置 / 其他，写新名字就新建一组
 *        title   功能名；text 说明页里的详细说明（\n 换行）
 *        tip     第一次看到按钮时弹的那句（不写就不弹，只进说明页）
 *        target  弹提示指向的元素（CSS 选择器），元素出现在屏幕上、没被挡住时才弹
 *        anlas   会花 NAI 点数的写 true 或一句说明（说明页和提示上都标「花 Anlas」）
 *   2. 只要提示不进说明页：在按钮的 HTML 上写 data-guide="一句话"（可加 data-guide-id="唯一名"、data-guide-anlas）
 *
 * Help.open(id) 打开说明页并跳到那一条；Help.link(id) 返回一个小「?」链接的 HTML，点了打开那一条。
 * 看过哪些提示存在 Store 的 guide 键 { off, seen: [id…] }；说明页底部可以重新显示全部提示、或者关掉提示。
 * 无头浏览器测试（navigator.webdriver）里默认不弹提示，免得挡住按钮；要测提示就先设 window.GUIDE_FORCE = true。
 */
(function () {
    'use strict';

    const { $, $$, esc } = UI;
    const GROUPS = ['开始之前', '创作页', '批量页', '图库', '图生图与编辑', '出图队列', '设置', '其他'];
    const list = [];
    let state = { off: false, seen: [] };
    let loaded = false;

    function add(e) {
        if (!e || !e.id) return;
        const i = list.findIndex((x) => x.id === e.id);
        if (i >= 0) list[i] = e; else list.push(e);
    }
    const anlasNote = (a) => (typeof a === 'string' ? a : 'Opus 会员出标准或小尺寸、28 步以内、一次一张不扣点；其他情况每张都扣 Anlas。按钮上的小标记是这次的预估');
    const ANLAS_BADGE = '<span class="badge anlas">花 Anlas</span>';
    const fmt = (t) => esc(t).replace(/\n/g, '<br>');

    async function save() { try { await Store.set('guide', state); } catch (e) { /* 存不了就下次再提示 */ } }

    // ------------------------------------------------------------
    // 第一次看到按钮时弹一句
    // ------------------------------------------------------------
    let bubble = null, cur = null;

    const enabled = () => loaded && !state.off && (!navigator.webdriver || window.GUIDE_FORCE);

    /** 元素在屏幕上、中心点没被别的东西挡住（打开的浮层里只看最上面那层） */
    function visible(el) {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const cy = Math.min(Math.max(r.top + Math.min(r.height, 40) / 2, 1), innerHeight - 1);
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
        const hit = document.elementFromPoint(cx, cy);
        return !!hit && (hit === el || el.contains(hit) || (hit.tagName === 'LABEL' && hit.control === el));
    }

    function candidates() {
        const out = [];
        list.forEach((e) => { if (e.tip && e.target) out.push({ id: e.id, tip: e.tip, anlas: e.anlas, sel: e.target }); });
        $$('[data-guide]').forEach((el) => out.push({ id: el.dataset.guideId || 'g:' + el.dataset.guide, tip: el.dataset.guide, anlas: el.hasAttribute('data-guide-anlas'), el }));
        return out;
    }

    function scan() {
        if (cur || !enabled() || document.hidden) return;
        for (const c of candidates()) {
            if (state.seen.includes(c.id)) continue;
            const el = c.el || $$(c.sel).find(visible);
            if (el && visible(el)) { show(c, el); return; }
        }
    }

    function show(c, el) {
        cur = { c, el };
        el.classList.add('guide-on');
        bubble = document.createElement('div');
        bubble.className = 'guide-bubble';
        bubble.dataset.id = c.id;
        bubble.innerHTML = '<div class="guide-arrow"></div><div class="guide-text">' + (c.anlas ? ANLAS_BADGE + ' ' : '') + fmt(c.tip) + '</div>'
            + '<div class="guide-btns"><button data-g="off">不再提示</button><button data-g="help">全部说明</button><button data-g="ok" class="on">知道了</button></div>';
        document.body.appendChild(bubble);
        bubble.addEventListener('click', (e) => {
            const b = e.target.closest('[data-g]'); if (!b) return;
            if (b.dataset.g === 'off') { state.off = true; save(); done(true); UI.toast('info', '不再弹提示了。想再看，点右上角「?」最下面'); }
            else if (b.dataset.g === 'help') { const id = c.id; done(true); open(id); }
            else done(true);
        });
        place();
    }

    function place() {
        if (!cur) return;
        if (!visible(cur.el)) { done(false); return; } // 滚走了 / 被挡住了，下次再提示
        const r = cur.el.getBoundingClientRect();
        const bw = Math.min(300, innerWidth - 24);
        bubble.style.width = bw + 'px';
        const bh = bubble.offsetHeight;
        const below = r.bottom + 10 + bh < innerHeight - 8 || r.top - 10 - bh < 8;
        const left = Math.min(Math.max(r.left + r.width / 2 - bw / 2, 12), innerWidth - bw - 12);
        bubble.style.left = left + 'px';
        bubble.style.top = (below ? r.bottom + 10 : r.top - 10 - bh) + 'px';
        bubble.classList.toggle('above', !below);
        const arrow = $('.guide-arrow', bubble);
        arrow.style.left = Math.min(Math.max(r.left + r.width / 2 - left - 7, 12), bw - 26) + 'px';
    }

    /** seen：记成看过（点了按钮、或者点了屏幕别处） */
    function done(seen) {
        if (!cur) return;
        if (seen && !state.seen.includes(cur.c.id)) { state.seen.push(cur.c.id); save(); }
        cur.el.classList.remove('guide-on');
        if (bubble) bubble.remove();
        bubble = null; cur = null;
        if (seen) setTimeout(scan, 600);
    }

    // 点屏幕上别的地方：这条算看过，点击照常生效（不挡操作）
    document.addEventListener('pointerdown', (e) => { if (cur && !bubble.contains(e.target)) done(true); }, true);
    window.addEventListener('scroll', () => place(), true);
    window.addEventListener('resize', () => place());
    setInterval(scan, 900);

    // ------------------------------------------------------------
    // 说明页
    // ------------------------------------------------------------
    function open(focusId) {
        if (cur) done(false);
        const groups = GROUPS.slice();
        list.forEach((e) => { if (!groups.includes(e.group || '其他')) groups.push(e.group); });
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>功能说明</b></div>'
            + '<div class="page-body help-page">'
            + '<div class="field"><input type="search" data-q placeholder="搜功能，比如 种子、角色、保存"></div>'
            + '<div class="card-sub">' + ANLAS_BADGE + ' 标出来的会花 NovelAI 的点数（Anlas）。AI 写提示词用的是你自己填的 AI 接口，不花 Anlas。</div>'
            + '<div data-list></div>'
            + '<div class="card" style="margin-top:18px"><div class="card-title">新手提示</div>'
            + '<div class="card-sub">每个按钮第一次出现时会弹一句说明，点一下屏幕任意地方就关掉，以后不再弹。</div>'
            + '<label class="check"><span class="switch"><input type="checkbox" data-on' + (state.off ? '' : ' checked') + '><span></span></span><span>显示新手提示</span></label>'
            + '<div class="btns" style="justify-content:flex-start"><button class="btn" data-reset>重新显示全部提示</button></div></div>'
            + '</div>');
        const box = $('[data-list]', L.box), q = $('[data-q]', L.box);
        const draw = () => {
            const k = q.value.trim().toLowerCase();
            const hit = (e) => !k || [e.title, e.text, e.tip, e.group].some((s) => String(s || '').toLowerCase().includes(k));
            const html = groups.map((g) => {
                const items = list.filter((e) => (e.group || '其他') === g && hit(e));
                if (!items.length) return '';
                return '<h4 class="help-group">' + esc(g) + '</h4>' + items.map((e) => '<div class="help-item" data-id="' + esc(e.id) + '">'
                    + '<b>' + esc(e.title || e.id) + '</b>' + (e.anlas ? ' ' + ANLAS_BADGE : '')
                    + '<div class="help-text">' + fmt(e.text || e.tip || '') + (e.anlas ? '<div class="help-anlas">' + fmt(anlasNote(e.anlas)) + '</div>' : '') + '</div></div>').join('');
            }).join('');
            box.innerHTML = html || '<div class="empty" style="margin-top:6vh"><b>没找到</b>换个词试试</div>';
        };
        q.oninput = draw;
        draw();
        $('[data-on]', L.box).onchange = (e) => { state.off = !e.target.checked; save(); };
        $('[data-reset]', L.box).onclick = () => {
            state = { off: false, seen: [] };
            $('[data-on]', L.box).checked = true;
            save();
            UI.toast('success', '提示都会重新显示');
        };
        if (focusId) {
            const el = $$('.help-item', box).find((x) => x.dataset.id === focusId);
            if (el) { el.classList.add('flash'); setTimeout(() => el.scrollIntoView({ block: 'center' }), 50); }
        }
        return L;
    }

    const link = (id) => '<a href="#" class="help-link" data-help-open="' + esc(id) + '" aria-label="说明">?</a>';
    document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-help-open]');
        if (a) { e.preventDefault(); e.stopPropagation(); open(a.dataset.helpOpen); }
    });

    // 顶栏「?」按钮，放在齿轮前面
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.id = 'btn-help';
    btn.setAttribute('aria-label', '功能说明');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>';
    btn.onclick = () => open();
    // 等所有脚本跑完再放（排在快捷栏加的 Anlas 余额后面），紧挨齿轮
    const put = () => $('#topbar').insertBefore(btn, $('#btn-settings'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put); else put();

    Store.get('guide', null).then((v) => {
        if (v && Array.isArray(v.seen)) state = { off: !!v.off, seen: v.seen.slice() };
    }).catch(() => {}).then(() => { loaded = true; setTimeout(scan, 3000); /* 等启动时的轻提示先过去 */ });

    window.Help = { add, open, link, get list() { return list.slice(); }, reset() { state = { off: false, seen: [] }; save(); }, scan };
})();
