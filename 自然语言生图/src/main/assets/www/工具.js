/*
 * 工具.js —— 各页面共用的界面小工具：选择器、转义、浮层（返回键逐层关闭）、对话框、设置读写
 * 挂在 window.UI 上。
 */
(function () {
    'use strict';

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (type, msg, title) => window.__toast(type, msg, title);

    const ICON = {
        close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
        save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
        copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
        del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
        regen: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
        reuse: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    };

    // ------------------------------------------------------------
    // 浮层（整页、底部面板、对话框），返回键逐层关闭
    // ------------------------------------------------------------
    const stack = [];
    function openLayer(kind, html, opts) {
        opts = opts || {};
        const wrap = document.createElement('div');
        wrap.className = 'layer' + (kind === 'dialog' ? ' dialog-wrap' : '');
        wrap.innerHTML = '<div class="mask"></div><div class="' + kind + '">' + html + '</div>';
        $('#layers').appendChild(wrap);
        const layer = { el: wrap, box: wrap.lastElementChild, onClose: opts.onClose };
        stack.push(layer);
        if (kind !== 'page') wrap.firstElementChild.addEventListener('click', () => closeLayer(layer));
        $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', () => closeLayer(layer)));
        return layer;
    }
    function closeLayer(layer, silent) {
        const i = stack.indexOf(layer || stack[stack.length - 1]);
        if (i < 0) return;
        const l = stack.splice(i, 1)[0];
        l.el.remove();
        if (!silent && l.onClose) l.onClose();
    }
    // 安卓返回键：先关浮层，再回到创作页，最后才退到后台
    window.__appBack = function () {
        if (stack.length) { closeLayer(); return true; }
        if (UI.currentTab && UI.currentTab() !== 'create') { UI.showTab('create'); return true; }
        return false;
    };

    function confirmBox(title, text, okText, danger) {
        return new Promise((resolve) => {
            let done = false;
            const L = openLayer('dialog', '<h3>' + esc(title) + '</h3>' + (text ? '<p>' + esc(text) + '</p>' : '')
                + '<div class="btns"><button class="btn" data-no>取消</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-yes>' + esc(okText || '确定') + '</button></div>',
            { onClose: () => { if (!done) resolve(false); } });
            $('[data-no]', L.box).onclick = () => closeLayer(L);
            $('[data-yes]', L.box).onclick = () => { done = true; closeLayer(L, true); resolve(true); };
        });
    }

    /** 列表选择（带搜索），返回选中项或 null */
    function pickFrom(title, list, current) {
        return new Promise((resolve) => {
            let done = false;
            const L = openLayer('dialog', '<h3>' + esc(title) + '</h3><div class="field"><input type="text" data-q placeholder="搜索"></div>'
                + '<div data-list style="max-height:55vh;overflow-y:auto"></div><div class="btns"><button class="btn" data-close>取消</button></div>',
            { onClose: () => { if (!done) resolve(null); } });
            const box = $('[data-list]', L.box), q = $('[data-q]', L.box);
            const draw = () => {
                const k = q.value.trim().toLowerCase();
                const items = list.filter((x) => !k || x.toLowerCase().includes(k));
                box.innerHTML = items.length ? items.map((x) => '<div class="pick' + (x === current ? ' on' : '') + '" data-m="' + esc(x) + '">' + esc(x) + '</div>').join('')
                    : '<div class="card-sub" style="padding:8px">没有匹配的</div>';
            };
            q.oninput = draw;
            box.onclick = (e) => { const it = e.target.closest('[data-m]'); if (!it) return; done = true; closeLayer(L, true); resolve(it.dataset.m); };
            draw();
        });
    }

    async function copyText(t) {
        try {
            await navigator.clipboard.writeText(t);
            toast('success', '已复制');
        } catch (e) {
            toast('error', '复制失败');
        }
    }

    // ------------------------------------------------------------
    // 设置：全局一份，改完调 UI.saveSettings()
    // ------------------------------------------------------------
    let settings = Params.normalize();
    let saveTimer = 0;
    function saveSettings() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => Store.set('settings', settings).catch((e) => toast('error', e.message, '保存设置失败')), 200);
    }
    async function loadSettings() {
        settings = Params.normalize(await Store.get('settings', {}));
        return settings;
    }

    window.UI = {
        $, $$, esc, toast, ICON,
        openLayer, closeLayer, confirmBox, pickFrom, copyText,
        get settings() { return settings; },
        saveSettings, loadSettings,
        // 由 启动.js 填上
        showTab: null, currentTab: null,
    };
})();
