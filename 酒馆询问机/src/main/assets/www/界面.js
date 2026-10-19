/*
 * 界面.js —— 酒馆询问机的全部界面逻辑
 *
 *  对话：发送 / 停止 / 重新生成（多版本左右切换）/ 编辑 / 删除 / 复制
 *  顶栏右侧胶囊：切换接口、模型、预设，查看实际发送内容
 *  设置：接口、预设（导入酒馆预设、开关条目、改内容）、通用、数据备份
 */
(function () {
    'use strict';

    // ------------------------------------------------------------
    // 基础工具
    // ------------------------------------------------------------
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const uid = () => Preset.uid();
    const toast = (type, msg, title) => window.__toast(type, msg, title);
    const bridge = window.AndroidBridge || null;

    const ICON = {
        copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
        edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
        del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
        regen: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
        left: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
        right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
        close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
        back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
        up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
        down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
        branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/></svg>',
    };

    function fmtTime(t) {
        if (!t) return '';
        const d = new Date(t), n = new Date();
        const p = (x) => String(x).padStart(2, '0');
        const hm = p(d.getHours()) + ':' + p(d.getMinutes());
        if (d.toDateString() === n.toDateString()) return hm;
        if (d.getFullYear() === n.getFullYear()) return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
        return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
    }

    async function copyText(t) {
        try {
            await navigator.clipboard.writeText(t);
            if (!bridge) toast('success', '已复制');
            return true;
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;top:0';
            document.body.appendChild(ta); ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
            ta.remove();
            toast(ok ? 'success' : 'error', ok ? '已复制' : '复制失败');
            return ok;
        }
    }

    async function saveFile(name, text) {
        const blob = new Blob([text], { type: 'application/json' });
        if (window.__saveBlob) {
            try { const where = await window.__saveBlob(blob, name); toast('success', where, '已保存'); }
            catch (e) { toast('error', e.message || String(e), '保存失败'); }
            return;
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    function pickFiles(accept, multiple) {
        return new Promise((resolve) => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = accept || ''; inp.multiple = !!multiple;
            inp.style.display = 'none';
            inp.onchange = () => { resolve(Array.from(inp.files || [])); inp.remove(); };
            document.body.appendChild(inp);
            inp.click();
        });
    }

    // ------------------------------------------------------------
    // 状态
    // ------------------------------------------------------------
    const DEFAULT_SETTINGS = {
        userName: 'User', charName: 'Assistant', postProcess: 'merge', plainSystemPrompt: '',
        plainParams: { temperature: 1, max_tokens: 4096, stream: true },
        enterToSend: false, fontSize: 15, thinkOpen: false,
        lastApiId: '', lastModel: '', lastPresetId: '', gvars: {},
    };
    const S = {
        settings: null, apis: [], presets: [], chatIndex: [], chat: null,
        gen: null, // { ctrl, msgId }
    };

    const saveSettings = () => Store.set('settings', S.settings);
    const saveApis = () => Store.set('apis', S.apis);
    const savePresets = () => Store.set('presets', S.presets);
    const saveIndex = () => Store.set('chatIndex', S.chatIndex);

    let saveTimer = null;
    function saveChat(now) {
        const c = S.chat;
        if (!c) return Promise.resolve();
        c.updatedAt = Date.now();
        const idx = S.chatIndex.find((x) => x.id === c.id);
        const last = c.messages[c.messages.length - 1];
        const summary = { id: c.id, title: c.title, updatedAt: c.updatedAt, count: c.messages.length,
            preview: last ? String(last.content || '').slice(0, 60).replace(/\s+/g, ' ') : '' };
        if (idx) Object.assign(idx, summary); else S.chatIndex.push(summary);
        if (S.settings.lastChatId !== c.id) { S.settings.lastChatId = c.id; saveSettings(); }
        clearTimeout(saveTimer);
        const doit = () => Promise.all([Store.set('chat:' + c.id, c), saveIndex()]);
        if (now) return doit();
        saveTimer = setTimeout(doit, 400);
        return Promise.resolve();
    }

    const apiById = (id) => S.apis.find((a) => a.id === id) || null;
    const presetById = (id) => S.presets.find((p) => p.id === id) || null;
    const curApi = () => (S.chat && apiById(S.chat.apiId)) || apiById(S.settings.lastApiId) || S.apis[0] || null;
    const curModel = () => {
        const api = curApi();
        if (!api) return '';
        if (S.chat && S.chat.apiId === api.id && S.chat.model) return S.chat.model;
        return api.model || '';
    };
    const curPreset = () => {
        if (!S.chat) return null;
        if (S.chat.presetId === '') return null;
        return presetById(S.chat.presetId) || null;
    };

    // ------------------------------------------------------------
    // 浮层（抽屉、底部面板、整页、对话框），返回键逐层关闭
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
    window.__appBack = function () {
        if (stack.length) { closeLayer(); return true; }
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
    function promptBox(title, value, opts) {
        opts = opts || {};
        return new Promise((resolve) => {
            let done = false;
            const input = opts.multiline
                ? '<textarea class="ta' + (opts.big ? ' big' : '') + '" data-v></textarea>'
                : '<input type="text" data-v>';
            const L = openLayer('dialog', '<h3>' + esc(title) + '</h3><div class="field">' + input + '</div>'
                + '<div class="btns"><button class="btn" data-no>取消</button><button class="btn primary" data-yes>保存</button></div>',
            { onClose: () => { if (!done) resolve(null); } });
            const v = $('[data-v]', L.box);
            v.value = value || '';
            setTimeout(() => { v.focus(); if (!opts.multiline) v.select(); }, 50);
            $('[data-no]', L.box).onclick = () => closeLayer(L);
            $('[data-yes]', L.box).onclick = () => { done = true; closeLayer(L, true); resolve(v.value); };
        });
    }

    /** 模型列表选择（带搜索），返回选中的模型名或 null */
    function pickModel(list, current) {
        return new Promise((resolve) => {
            let done = false;
            const L = openLayer('dialog', '<h3>选择模型</h3><div class="field"><input type="text" data-q placeholder="搜索"></div>'
                + '<div data-list style="max-height:55vh;overflow-y:auto"></div><div class="btns"><button class="btn" data-close>取消</button></div>',
            { onClose: () => { if (!done) resolve(null); } });
            const box = $('[data-list]', L.box), q = $('[data-q]', L.box);
            const draw = () => {
                const k = q.value.trim().toLowerCase();
                const items = list.filter((x) => !k || x.toLowerCase().includes(k));
                box.innerHTML = items.length ? items.map((x) => '<div class="chat-item' + (x === current ? ' on' : '') + '" data-m="' + esc(x) + '" style="cursor:pointer"><div class="ci-main"><div class="ci-title">' + esc(x) + '</div></div></div>').join('')
                    : '<div class="card-sub" style="padding:8px">没有匹配的模型</div>';
            };
            q.oninput = draw;
            box.onclick = (e) => { const it = e.target.closest('[data-m]'); if (!it) return; done = true; closeLayer(L, true); resolve(it.dataset.m); };
            draw();
        });
    }

    // ------------------------------------------------------------
    // Markdown
    // ------------------------------------------------------------
    if (window.marked) marked.setOptions({ breaks: true, gfm: true, mangle: false, headerIds: false });

    function splitThink(text) {
        // 把正文开头的 <think>…</think> / <thinking>…</thinking> 拿出来单独折叠显示
        const m = String(text || '').match(/^\s*<(think|thinking)>([\s\S]*?)(<\/\1>|$)/i);
        if (!m) return { think: '', body: text || '' };
        return { think: m[2].trim(), body: String(text).slice(m[0].length).replace(/^\s+/, ''), open: !m[3] };
    }

    function renderMd(text) {
        let html;
        try { html = marked.parse(String(text || '')); } catch (e) { html = '<p>' + esc(text) + '</p>'; }
        html = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style'] });
        const box = document.createElement('div');
        box.innerHTML = html;
        $$('pre', box).forEach((pre) => {
            const code = $('code', pre);
            const lang = code && (code.className.match(/language-([\w+#.-]+)/) || [])[1];
            const wrap = document.createElement('div');
            wrap.className = 'codebox';
            wrap.innerHTML = '<div class="code-head"><span>' + esc(lang || '代码') + '</span><button class="copy-code" type="button">复制</button></div>';
            pre.parentNode.insertBefore(wrap, pre);
            wrap.appendChild(pre);
        });
        $$('a', box).forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
        return box.innerHTML;
    }

    // 代码块复制（事件委托）
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.copy-code');
        if (!b) return;
        const pre = b.closest('.codebox').querySelector('pre');
        copyText((pre.innerText || pre.textContent || '').replace(/\n$/, '')).then((ok) => {
            if (!ok) return;
            b.textContent = '已复制'; b.classList.add('done');
            setTimeout(() => { b.textContent = '复制'; b.classList.remove('done'); }, 1500);
        });
    });

    // ------------------------------------------------------------
    // 消息渲染
    // ------------------------------------------------------------
    const msgsEl = $('#msgs');

    function nearBottom() {
        return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
    }
    function toBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }

    function msgInner(m, streaming) {
        const isA = m.role === 'assistant';
        const parts = splitThink(m.content);
        const reasoning = [m.reasoning, parts.think].filter(Boolean).join('\n\n');
        let h = '';
        if (isA && reasoning) {
            const open = S.settings.thinkOpen || (streaming && !parts.body);
            h += '<details class="think"' + (open ? ' open' : '') + '><summary>思考过程</summary><div class="think-body">' + esc(reasoning) + '</div></details>';
        }
        if (parts.body) h += '<div class="md' + (streaming ? ' cursor' : '') + '">' + renderMd(parts.body) + '</div>';
        else if (streaming) h += '<div class="waiting cursor">' + (reasoning ? '思考中' : '等待回复') + '</div>';
        if (m.error) h += '<div class="err">' + esc(m.error) + '</div>';
        return h;
    }

    function msgActs(m, i) {
        const msgs = S.chat.messages;
        const isLast = i === msgs.length - 1;
        let h = '';
        if (m.role === 'assistant' && m.swipes && m.swipes.length > 1) {
            h += '<button data-act="prev" aria-label="上一版">' + ICON.left + '</button><span class="swipe-n">' + (m.sid + 1) + '/' + m.swipes.length + '</span>'
                + '<button data-act="next" aria-label="下一版">' + ICON.right + '</button>';
        }
        h += '<button data-act="copy" aria-label="复制">' + ICON.copy + '</button>'
            + '<button data-act="edit" aria-label="编辑">' + ICON.edit + '</button>';
        if (m.role === 'assistant' && isLast) h += '<button data-act="regen" aria-label="重新生成">' + ICON.regen + '</button>';
        if (m.role === 'user' && isLast) h += '<button data-act="resend" aria-label="重新回复">' + ICON.regen + '</button>';
        h += '<button data-act="branch" aria-label="从这里开分支">' + ICON.branch + '</button>';
        h += '<button data-act="del" aria-label="删除">' + ICON.del + '</button>';
        return h;
    }

    function msgHTML(m, i) {
        const isA = m.role === 'assistant';
        const who = isA ? (m.model || S.settings.charName || 'AI') : (S.settings.userName || '我');
        return '<div class="msg ' + m.role + (m.error ? ' error' : '') + '" data-id="' + m.id + '">'
            + '<div class="meta"><span class="who">' + esc(who) + '</span><span>' + fmtTime(m.time) + '</span></div>'
            + '<div class="bubble">' + msgInner(m, S.gen && S.gen.msgId === m.id) + '</div>'
            + '<div class="acts">' + (S.gen && S.gen.msgId === m.id ? '' : msgActs(m, i)) + '</div>'
            + '</div>';
    }

    function renderAll(keepScroll) {
        const c = S.chat;
        $('#chat-title').textContent = c ? c.title : '新对话';
        renderChip();
        if (!c || !c.messages.length) {
            const noApi = !S.apis.length;
            msgsEl.innerHTML = '<div class="empty"><b>开个新窗口问吧</b>'
                + (noApi ? '先去设置里填一个 API，就能开始提问。<br><button class="hint-btn" data-go="api">去填 API</button>'
                    : '这里没有酒馆聊天记录，也没有世界书。<br>需要预设的话，点右上角切换。')
                + '</div>';
            const go = $('[data-go]', msgsEl);
            if (go) go.onclick = () => openSettings('api');
            return;
        }
        const top = msgsEl.scrollTop;
        msgsEl.innerHTML = c.messages.map(msgHTML).join('');
        if (keepScroll) msgsEl.scrollTop = top; else toBottom();
    }

    function renderOne(m, streaming) {
        const el = $('.msg[data-id="' + m.id + '"]', msgsEl);
        if (!el) return renderAll(true);
        const i = S.chat.messages.indexOf(m);
        const stick = nearBottom();
        el.className = 'msg ' + m.role + (m.error ? ' error' : '');
        const meta = $('.meta .who', el);
        if (meta && m.role === 'assistant') meta.textContent = m.model || S.settings.charName || 'AI';
        // 保留「思考过程」的展开状态
        const d = $('details.think', el);
        const wasOpen = d ? d.open : null;
        $('.bubble', el).innerHTML = msgInner(m, streaming);
        const d2 = $('details.think', el);
        if (d2 && wasOpen !== null) d2.open = wasOpen;
        $('.acts', el).innerHTML = streaming ? '' : msgActs(m, i);
        if (stick) toBottom();
    }

    function renderChip() {
        const api = curApi();
        const p = curPreset();
        $('#chip-model').textContent = api ? (curModel() || api.name || '未选模型') : '未设置接口';
        $('#chip-preset').textContent = p ? '预设：' + p.name : '无预设';
    }

    msgsEl.addEventListener('click', (e) => {
        const b = e.target.closest('.acts button');
        if (!b) return;
        const el = b.closest('.msg');
        const m = S.chat.messages.find((x) => x.id === el.dataset.id);
        if (!m) return;
        onMsgAction(b.dataset.act, m);
    });

    async function onMsgAction(act, m) {
        const c = S.chat;
        const i = c.messages.indexOf(m);
        if (act === 'copy') {
            copyText(m.content || '');
        } else if (act === 'edit') {
            const v = await promptBox(m.role === 'user' ? '编辑提问' : '编辑回复', m.content, { multiline: true, big: true });
            if (v === null) return;
            m.content = v;
            if (m.swipes && m.swipes[m.sid]) m.swipes[m.sid].content = v;
            m.error = '';
            await saveChat(true);
            renderOne(m);
        } else if (act === 'del') {
            if (S.gen) return toast('warning', '正在生成，先停止');
            const after = c.messages.length - i - 1;
            const L = openLayer('dialog', '<h3>删除消息</h3><p>' + (after ? '后面还有 ' + after + ' 条消息。' : '') + '</p>'
                + '<div class="btns"><button class="btn" data-close>取消</button>'
                + (after ? '<button class="btn danger" data-all>删除这条及之后</button>' : '')
                + '<button class="btn danger" data-one>只删这条</button></div>');
            $('[data-one]', L.box).onclick = async () => { closeLayer(L); c.messages.splice(i, 1); await saveChat(true); renderAll(true); };
            const all = $('[data-all]', L.box);
            if (all) all.onclick = async () => { closeLayer(L); c.messages.splice(i); await saveChat(true); renderAll(true); };
        } else if (act === 'regen') {
            if (S.gen) return;
            generate(m);
        } else if (act === 'resend') {
            if (S.gen) return;
            generate(null);
        } else if (act === 'prev' || act === 'next') {
            if (S.gen) return;
            const n = m.swipes.length;
            m.sid = (m.sid + (act === 'next' ? 1 : -1) + n) % n;
            const s = m.swipes[m.sid];
            m.content = s.content; m.reasoning = s.reasoning || ''; m.model = s.model || m.model; m.time = s.time || m.time; m.error = s.error || '';
            await saveChat(true);
            renderOne(m);
        } else if (act === 'branch') {
            if (S.gen) return toast('warning', '正在生成，先停止');
            const ok = await confirmBox('从这里开分支', '复制本对话到这条消息为止，开一个新对话继续问。', '开分支');
            if (!ok) return;
            const nc = JSON.parse(JSON.stringify(c));
            nc.id = uid(); nc.title = c.title + '（分支）'; nc.createdAt = Date.now();
            nc.messages = nc.messages.slice(0, i + 1);
            await saveChat(true);
            S.chat = nc;
            await saveChat(true);
            renderAll();
            toast('success', '已开分支');
        }
    }

    // ------------------------------------------------------------
    // 对话管理
    // ------------------------------------------------------------
    function newChatObj() {
        return {
            id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(),
            apiId: S.settings.lastApiId || (S.apis[0] && S.apis[0].id) || '',
            model: S.settings.lastModel || '',
            presetId: S.settings.lastPresetId || '',
            messages: [], vars: {},
        };
    }

    async function loadChat(id) {
        const c = await Store.get('chat:' + id, null);
        if (!c) return false;
        S.chat = c;
        S.settings.lastChatId = id;
        saveSettings();
        renderAll();
        return true;
    }

    async function newChat() {
        if (S.gen) stopGen();
        // 当前对话是空的就不用再开
        if (S.chat && !S.chat.messages.length) { renderAll(); $('#input').focus(); return; }
        S.chat = newChatObj();
        renderAll();
        $('#input').focus();
    }

    function openDrawer() {
        const L = openLayer('drawer', '<div class="drawer-head"><b>对话</b><div class="row">'
            + '<button class="btn small primary" data-new>' + '新对话</button>'
            + '<button class="icon-btn" data-close aria-label="关闭">' + ICON.close + '</button></div></div>'
            + '<div class="chat-list"></div>');
        const list = $('.chat-list', L.box);
        const draw = () => {
            const items = S.chatIndex.slice().sort((a, b) => b.updatedAt - a.updatedAt);
            if (!items.length) { list.innerHTML = '<div class="card-sub" style="padding:12px">还没有对话</div>'; return; }
            list.innerHTML = items.map((x) => '<div class="chat-item' + (S.chat && S.chat.id === x.id ? ' on' : '') + '" data-id="' + x.id + '">'
                + '<div class="ci-main"><div class="ci-title">' + esc(x.title) + '</div><div class="ci-sub">' + fmtTime(x.updatedAt) + ' · ' + (x.count || 0) + ' 条 · ' + esc(x.preview || '') + '</div></div>'
                + '<button class="icon-btn" data-ren aria-label="重命名">' + ICON.edit + '</button>'
                + '<button class="icon-btn" data-del aria-label="删除">' + ICON.del + '</button></div>').join('');
        };
        draw();
        $('[data-new]', L.box).onclick = () => { closeLayer(L); newChat(); };
        list.addEventListener('click', async (e) => {
            const item = e.target.closest('.chat-item');
            if (!item) return;
            const id = item.dataset.id;
            const x = S.chatIndex.find((c) => c.id === id);
            if (e.target.closest('[data-del]')) {
                if (!(await confirmBox('删除对话', '「' + x.title + '」删除后不能恢复。', '删除', true))) return;
                if (S.gen && S.chat && S.chat.id === id) stopGen();
                S.chatIndex = S.chatIndex.filter((c) => c.id !== id);
                await Store.del('chat:' + id);
                await saveIndex();
                if (S.chat && S.chat.id === id) { S.chat = newChatObj(); renderAll(); }
                draw();
            } else if (e.target.closest('[data-ren]')) {
                const v = await promptBox('重命名', x.title);
                if (v === null || !v.trim()) return;
                x.title = v.trim();
                if (S.chat && S.chat.id === id) { S.chat.title = x.title; await saveChat(true); renderAll(true); }
                else {
                    const c = await Store.get('chat:' + id, null);
                    if (c) { c.title = x.title; await Store.set('chat:' + id, c); }
                    await saveIndex();
                }
                draw();
            } else {
                if (S.gen && (!S.chat || S.chat.id !== id)) stopGen();
                closeLayer(L);
                await loadChat(id);
            }
        });
    }

    // ------------------------------------------------------------
    // 发送 / 生成
    // ------------------------------------------------------------
    const inputEl = $('#input');
    const sendBtn = $('#btn-send');

    function autoGrow() {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight + 2, window.innerHeight * 0.4) + 'px';
    }
    inputEl.addEventListener('input', autoGrow);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && S.settings.enterToSend && !e.isComposing) {
            e.preventDefault();
            onSend();
        }
    });
    sendBtn.addEventListener('click', () => (S.gen ? stopGen() : onSend()));

    function setGenUI(on) {
        sendBtn.classList.toggle('stop', on);
        sendBtn.setAttribute('aria-label', on ? '停止' : '发送');
    }

    async function onSend() {
        if (S.gen) return;
        if (!S.apis.length) { toast('warning', '先在设置里填一个 API'); openSettings('api'); return; }
        if (!S.chat) S.chat = newChatObj();
        const text = inputEl.value;
        const c = S.chat;
        if (!text.trim()) {
            // 空输入：最后一条是提问时直接让 AI 回复
            const last = c.messages[c.messages.length - 1];
            if (last && last.role === 'user') generate(null);
            return;
        }
        c.messages.push({ id: uid(), role: 'user', content: text, time: Date.now() });
        if (c.title === '新对话') c.title = text.trim().replace(/\s+/g, ' ').slice(0, 24) || '新对话';
        inputEl.value = '';
        autoGrow();
        await saveChat(true);
        renderAll();
        generate(null);
    }

    function stopGen() {
        if (S.gen && S.gen.ctrl) S.gen.ctrl.abort();
    }

    function historyFor(target) {
        // target：要重新生成的那条 assistant；null 表示在最后追加新回复
        const msgs = S.chat.messages;
        const end = target ? msgs.indexOf(target) : msgs.length;
        return msgs.slice(0, end).filter((m) => (m.content || '').trim() && !(m.role === 'assistant' && m.error && !m.content));
    }

    function buildFor(target) {
        const c = S.chat;
        const vars = JSON.parse(JSON.stringify(c.vars || {}));
        const gvars = JSON.parse(JSON.stringify(S.settings.gvars || {}));
        const out = Preset.build({
            preset: curPreset(), history: historyFor(target).map((m) => ({ role: m.role, content: m.content })),
            settings: S.settings, vars, gvars, model: curModel(),
        });
        out.vars = vars; out.gvars = gvars;
        return out;
    }

    async function generate(target) {
        const c = S.chat;
        const api = curApi();
        if (!api) { toast('warning', '先在设置里填一个 API'); return; }
        const model = curModel();
        if (!model) { toast('warning', '还没选模型，点右上角选一个'); openSwitch(); return; }

        let built;
        try { built = buildFor(target); } catch (e) { toast('error', e.message, '组装提示词失败'); return; }
        if (!built.messages.length) { toast('warning', '没有可发送的内容'); return; }
        c.vars = built.vars; S.settings.gvars = built.gvars;

        let m = target;
        if (!m) {
            m = { id: uid(), role: 'assistant', content: '', reasoning: '', model, time: Date.now(), swipes: [], sid: 0 };
            c.messages.push(m);
        }
        if (!m.swipes || !m.swipes.length) m.swipes = [{ content: m.content, reasoning: m.reasoning, model: m.model, time: m.time, error: m.error }];
        const slot = { content: '', reasoning: '', model, time: Date.now() };
        // 重新生成：上一次是失败/空的就直接覆盖那一版
        const prev = m.swipes[m.sid];
        if (target && prev && (prev.content || '').trim()) { m.swipes.push(slot); m.sid = m.swipes.length - 1; }
        else { m.swipes[m.sid] = slot; }
        m.content = ''; m.reasoning = ''; m.model = model; m.time = slot.time; m.error = '';

        const ctrl = new AbortController();
        S.gen = { ctrl, msgId: m.id };
        setGenUI(true);
        renderAll(!!target);
        if (built.dropped) toast('info', '对话太长，最早的 ' + built.dropped + ' 条没有发送（按预设的上下文长度）');
        try { bridge && bridge.keepAlive && bridge.keepAlive(true); } catch (e) { /* ignore */ }

        let lastPaint = 0, timer = null;
        const paint = () => { lastPaint = Date.now(); timer = null; renderOne(m, true); };
        const prefill = built.prefill || '';
        try {
            const res = await Api.chat({
                api, model, messages: built.messages, params: built.params, signal: ctrl.signal,
                onDelta: (content, reasoning) => {
                    m.content = content; m.reasoning = reasoning;
                    if (timer) return;
                    const wait = Math.max(0, 70 - (Date.now() - lastPaint));
                    timer = setTimeout(paint, wait);
                },
            });
            m.content = res.content; m.reasoning = res.reasoning;
            if (!res.content && !res.reasoning) m.error = '接口返回了空内容';
        } catch (e) {
            if (e && e.name === 'AbortError') {
                if (!m.content) m.error = '已停止';
            } else {
                m.error = (e && e.message) || String(e);
                if (/Failed to fetch|NetworkError|Load failed/i.test(m.error) && !bridge) m.error += '\n（浏览器里可能是跨域限制，装成 APK 后不会有这个问题）';
            }
        } finally {
            clearTimeout(timer);
            if (prefill && m.content && !m.content.startsWith(prefill) && S.settings.keepPrefill) m.content = prefill + m.content;
            Object.assign(m.swipes[m.sid], { content: m.content, reasoning: m.reasoning, model, time: m.time, error: m.error });
            S.gen = null;
            setGenUI(false);
            try { bridge && bridge.keepAlive && bridge.keepAlive(false); } catch (e) { /* ignore */ }
            if (S.chat === c) renderOne(m, false);
            await saveChat(true);
            saveSettings();
        }
    }

    // ------------------------------------------------------------
    // 切换面板：接口 / 模型 / 预设
    // ------------------------------------------------------------
    function openSwitch() {
        if (!S.chat) S.chat = newChatObj();
        const c = S.chat;
        const api = curApi();
        const L = openLayer('sheet', '<div class="grip"></div><h3>这个对话用</h3>'
            + '<div class="field"><label>接口</label><div class="row"><select class="grow" data-api>'
            + (S.apis.length ? S.apis.map((a) => '<option value="' + a.id + '"' + (api && api.id === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') : '<option value="">（还没有，去设置里添加）</option>')
            + '</select><button class="btn small" data-manage-api>管理</button></div></div>'
            + '<div class="field"><label>模型</label><div class="row"><input type="text" class="grow" data-model list="model-list" placeholder="模型名">'
            + '<button class="btn small" data-fetch>拉取列表</button></div><datalist id="model-list"></datalist>'
            + '<div class="model-picks" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div></div>'
            + '<div class="field"><label>预设</label><div class="row"><select class="grow" data-preset><option value="">不使用预设（纯净）</option>'
            + S.presets.map((p) => '<option value="' + p.id + '"' + (c.presetId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('')
            + '</select><button class="btn small" data-manage-preset>管理</button></div>'
            + '<div class="help">不发酒馆聊天记录、不发世界书、不跑正则；只发预设条目和这个窗口里的对话。</div></div>'
            + '<div class="btns" style="justify-content:space-between"><button class="btn" data-preview>查看实际发送内容</button><button class="btn primary" data-close>完成</button></div>',
        { onClose: () => { renderChip(); } });

        const selApi = $('[data-api]', L.box), inpModel = $('[data-model]', L.box), selPreset = $('[data-preset]', L.box);
        const picks = $('.model-picks', L.box);
        inpModel.value = curModel();
        const fillModels = () => {
            const a = apiById(selApi.value);
            const list = (a && a.models) || [];
            $('#model-list', L.box).innerHTML = list.map((x) => '<option value="' + esc(x) + '">').join('');
            const fav = (a && a.recent) || [];
            picks.innerHTML = fav.slice(0, 8).map((x) => '<button class="badge acc" style="padding:3px 8px;font-size:12px;background:none" data-pick="' + esc(x) + '">' + esc(x) + '</button>').join('');
        };
        fillModels();
        const apply = () => {
            const a = apiById(selApi.value);
            c.apiId = a ? a.id : '';
            c.model = inpModel.value.trim();
            c.presetId = selPreset.value;
            S.settings.lastApiId = c.apiId; S.settings.lastModel = c.model; S.settings.lastPresetId = c.presetId;
            if (a && c.model) {
                a.recent = [c.model].concat((a.recent || []).filter((x) => x !== c.model)).slice(0, 8);
                saveApis();
            }
            saveSettings();
            if (c.messages.length) saveChat();
            renderChip();
        };
        selApi.onchange = () => { const a = apiById(selApi.value); inpModel.value = (a && a.model) || ''; fillModels(); apply(); };
        inpModel.onchange = apply;
        inpModel.oninput = () => { c.model = inpModel.value.trim(); renderChip(); };
        selPreset.onchange = apply;
        picks.onclick = (e) => { const b = e.target.closest('[data-pick]'); if (b) { inpModel.value = b.dataset.pick; apply(); } };
        $('[data-fetch]', L.box).onclick = async (e) => {
            const a = apiById(selApi.value);
            if (!a) return;
            e.target.disabled = true; e.target.textContent = '拉取中…';
            try {
                a.models = await Api.listModels(a);
                await saveApis();
                fillModels();
            } catch (err) { toast('error', err.message, '拉取失败'); }
            e.target.disabled = false; e.target.textContent = '拉取列表';
            if (a.models && a.models.length) {
                const v = await pickModel(a.models, inpModel.value.trim());
                if (v) { inpModel.value = v; apply(); }
            }
        };
        $('[data-manage-api]', L.box).onclick = () => { closeLayer(L); openSettings('api'); };
        $('[data-manage-preset]', L.box).onclick = () => { closeLayer(L); openSettings('preset'); };
        $('[data-preview]', L.box).onclick = () => { apply(); openPreview(); };
    }

    function openPreview() {
        let built;
        try { built = buildFor(null); } catch (e) { toast('error', e.message); return; }
        const pend = inputEl.value.trim();
        if (pend) built = (function () {
            const c = S.chat;
            const hist = historyFor(null).map((m) => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: inputEl.value }]);
            return Preset.build({ preset: curPreset(), history: hist, settings: S.settings, vars: JSON.parse(JSON.stringify(c.vars || {})), gvars: JSON.parse(JSON.stringify(S.settings.gvars || {})), model: curModel() });
        })();
        const total = built.messages.reduce((a, m) => a + Preset.estTokens(m.content), 0);
        const p = built.params;
        const L = openLayer('page', '<div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + ICON.back + '</button><b>实际发送内容</b></div>'
            + '<div class="page-body"><div class="card-sub" style="margin-bottom:12px">' + built.messages.length + ' 条消息 · 约 ' + total + ' tokens（估算）'
            + ' · 温度 ' + p.temperature + ' · 最大回复 ' + p.max_tokens + (p.stream ? ' · 流式' : '') + (pend ? ' · 含输入框里还没发的内容' : '') + '</div>'
            + built.messages.map((m) => '<div class="preview-msg"><div class="pm-role"><span>' + m.role + '</span><span>约 ' + Preset.estTokens(m.content) + '</span></div><pre>' + esc(m.content) + '</pre></div>').join('')
            + '<div class="btns"><button class="btn" data-copy-json>复制 JSON</button></div></div>');
        $('[data-copy-json]', L.box).onclick = () => copyText(JSON.stringify(built.messages, null, 2));
    }

    // ------------------------------------------------------------
    // 设置页
    // ------------------------------------------------------------
    function openSettings(tab) {
        const L = openLayer('page', '<div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + ICON.back + '</button><b>设置</b></div>'
            + '<div class="tabs"><button data-tab="api">接口</button><button data-tab="preset">预设</button><button data-tab="general">通用</button><button data-tab="data">数据</button></div>'
            + '<div class="page-body"></div>', { onClose: () => renderAll(true) });
        const body = $('.page-body', L.box);
        const show = (t) => {
            $$('.tabs button', L.box).forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
            body.scrollTop = 0;
            ({ api: tabApi, preset: tabPreset, general: tabGeneral, data: tabData })[t](body);
        };
        $('.tabs', L.box).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
        show(tab || 'api');
    }

    // ---------- 接口 ----------
    function tabApi(body) {
        const draw = () => {
            body.innerHTML = '<div class="btns" style="justify-content:flex-start;margin:0 0 12px"><button class="btn primary" data-add>' + '添加接口</button></div>'
                + (S.apis.length ? '' : '<div class="card-sub">填法和酒馆「自定义（OpenAI 兼容）」一样：地址一般以 /v1 结尾，再填 Key 和模型名。可以存好几套，聊天时右上角一键切换。</div>')
                + S.apis.map((a) => '<div class="card' + (curApi() && curApi().id === a.id ? ' on' : '') + '" data-id="' + a.id + '">'
                    + '<div class="card-title">' + esc(a.name) + '</div>'
                    + '<div class="card-sub">' + esc(a.url) + '</div><div class="card-sub">默认模型：' + esc(a.model || '未填') + '</div>'
                    + '<div class="btns"><button class="btn small" data-edit>编辑</button><button class="btn small" data-test>测试</button><button class="btn small" data-dup>复制</button><button class="btn small danger" data-del>删除</button></div></div>').join('');
            $('[data-add]', body).onclick = () => editApi(null, draw);
        };
        body.onclick = async (e) => {
            const card = e.target.closest('.card');
            if (!card) return;
            const a = apiById(card.dataset.id);
            if (e.target.closest('[data-edit]')) editApi(a, draw);
            else if (e.target.closest('[data-dup]')) {
                const n = JSON.parse(JSON.stringify(a)); n.id = uid(); n.name = a.name + ' 副本';
                S.apis.push(n); await saveApis(); draw();
            } else if (e.target.closest('[data-del]')) {
                if (!(await confirmBox('删除接口', '「' + a.name + '」', '删除', true))) return;
                S.apis = S.apis.filter((x) => x.id !== a.id); await saveApis(); draw();
            } else if (e.target.closest('[data-test]')) testApi(a, e.target.closest('[data-test]'));
        };
        draw();
    }

    async function testApi(a, btn) {
        btn.disabled = true; const t0 = btn.textContent; btn.textContent = '测试中…';
        try {
            const res = await Api.chat({ api: a, model: a.model, messages: [{ role: 'user', content: '只回复两个字：收到' }], params: { temperature: 0.2, max_tokens: 64, stream: false } });
            toast('success', (res.content || res.reasoning || '（空）').slice(0, 120), '连接正常 · ' + a.model);
        } catch (e) { toast('error', e.message, '测试失败'); }
        btn.disabled = false; btn.textContent = t0;
    }

    function editApi(a, done) {
        const isNew = !a;
        a = a ? JSON.parse(JSON.stringify(a)) : { id: uid(), name: '', url: '', key: '', model: '', models: [], sendTopK: false, extra: '', headers: '' };
        const L = openLayer('page', '<div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + ICON.back + '</button><b>' + (isNew ? '添加接口' : '编辑接口') + '</b>'
            + '<button class="btn primary small" data-save>保存</button></div><div class="page-body">'
            + '<div class="field"><label>名称</label><input type="text" data-k="name" placeholder="比如：某某中转 Claude"></div>'
            + '<div class="field"><label>地址</label><input type="url" data-k="url" placeholder="https://example.com/v1"><div class="help">和酒馆里填的一样；会自动补上 /chat/completions。http 地址、局域网地址也能用。</div></div>'
            + '<div class="field"><label>Key</label><div class="row"><input type="password" class="grow" data-k="key" autocomplete="off"><button class="btn small" data-eye>显示</button></div></div>'
            + '<div class="field"><label>默认模型</label><div class="row"><input type="text" class="grow" data-k="model" list="api-models"><button class="btn small" data-fetch>拉取列表</button></div><datalist id="api-models"></datalist></div>'
            + '<label class="check"><input type="checkbox" data-k="sendTopK"> 发送 top_k（有的接口不认这个参数会报错，默认不发）</label>'
            + '<div class="section-title">高级（不懂可以不填）</div>'
            + '<div class="field"><label>额外请求参数（JSON，会合并进请求体）</label><textarea class="ta" data-k="extra" placeholder=\'{"reasoning_effort": "high"}\'></textarea></div>'
            + '<div class="field"><label>额外请求头（JSON）</label><textarea class="ta" data-k="headers" placeholder=\'{"X-Title": "asker"}\'></textarea></div>'
            + '</div>');
        const box = L.box;
        $$('[data-k]', box).forEach((el) => {
            const k = el.dataset.k;
            if (el.type === 'checkbox') el.checked = !!a[k]; else el.value = a[k] || '';
        });
        const fill = () => { $('#api-models', box).innerHTML = (a.models || []).map((x) => '<option value="' + esc(x) + '">').join(''); };
        fill();
        const read = () => {
            $$('[data-k]', box).forEach((el) => { a[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
        };
        $('[data-eye]', box).onclick = (e) => {
            const i = $('[data-k="key"]', box); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? '显示' : '隐藏';
        };
        $('[data-fetch]', box).onclick = async (e) => {
            read();
            if (!a.url) return toast('warning', '先填地址');
            e.target.disabled = true; e.target.textContent = '拉取中…';
            try { a.models = await Api.listModels(a); fill(); }
            catch (err) { toast('error', err.message, '拉取失败'); }
            e.target.disabled = false; e.target.textContent = '拉取列表';
            if (a.models && a.models.length) {
                const v = await pickModel(a.models, $('[data-k="model"]', box).value.trim());
                if (v) $('[data-k="model"]', box).value = v;
            }
        };
        $('[data-save]', box).onclick = async () => {
            read();
            if (!a.url) return toast('warning', '地址不能为空');
            if (!/^https?:\/\//i.test(a.url)) return toast('warning', '地址要以 http:// 或 https:// 开头');
            for (const k of ['extra', 'headers']) {
                if (a[k]) { try { const j = JSON.parse(a[k]); if (typeof j !== 'object' || Array.isArray(j)) throw 0; } catch (e) { return toast('warning', (k === 'extra' ? '额外请求参数' : '额外请求头') + '不是有效的 JSON 对象'); } }
            }
            if (!a.name) { try { a.name = new URL(a.url).host; } catch (e) { a.name = '接口'; } }
            const i = S.apis.findIndex((x) => x.id === a.id);
            if (i >= 0) S.apis[i] = a; else S.apis.push(a);
            if (!S.settings.lastApiId) { S.settings.lastApiId = a.id; S.settings.lastModel = a.model; saveSettings(); }
            if (S.chat && !S.chat.apiId) { S.chat.apiId = a.id; S.chat.model = a.model; }
            await saveApis();
            closeLayer(L);
            toast('success', '已保存');
            done && done();
            renderChip();
        };
    }

    // ---------- 预设 ----------
    function tabPreset(body) {
        const draw = () => {
            body.innerHTML = '<div class="btns" style="justify-content:flex-start;margin:0 0 12px"><button class="btn primary" data-import>导入酒馆预设</button></div>'
                + '<div class="card-sub" style="margin-bottom:12px">在酒馆「AI 响应配置」里点导出得到的 .json 就行，可以一次选多个。导入后条目的开关、顺序、内容都能在这里改，不影响酒馆里的原预设。</div>'
                + (S.presets.length ? '' : '<div class="card-sub">还没有预设。不用预设时，就是纯净对话。</div>')
                + S.presets.map((p) => {
                    const on = p.order.filter((o) => o.enabled).length;
                    return '<div class="card' + (curPreset() && curPreset().id === p.id ? ' on' : '') + '" data-id="' + p.id + '">'
                        + '<div class="card-title">' + esc(p.name) + '</div>'
                        + '<div class="card-sub">' + p.prompts.length + ' 个条目，开启 ' + on + ' 个 · 温度 ' + p.params.temperature + ' · 最大回复 ' + p.params.max_tokens + '</div>'
                        + (p.warn || []).map((w) => '<div class="warn">' + esc(w) + '</div>').join('')
                        + '<div class="btns"><button class="btn small" data-use>用于当前对话</button><button class="btn small" data-edit>编辑</button><button class="btn small" data-export>导出</button><button class="btn small danger" data-del>删除</button></div></div>';
                }).join('');
            $('[data-import]', body).onclick = importPresets;
        };
        const importPresets = async () => {
            const files = await pickFiles('.json,application/json', true);
            let n = 0;
            for (const f of files) {
                try {
                    const raw = JSON.parse(await f.text());
                    const p = Preset.importPreset(raw, f.name);
                    const dup = S.presets.findIndex((x) => x.name === p.name);
                    if (dup >= 0 && await confirmBox('同名预设', '已经有「' + p.name + '」，要覆盖吗？选取消会另存一份。', '覆盖')) {
                        p.id = S.presets[dup].id; S.presets[dup] = p;
                    } else {
                        if (dup >= 0) p.name += '（' + new Date().toLocaleDateString() + '）';
                        S.presets.push(p);
                    }
                    n++;
                } catch (e) { toast('error', e.message, f.name + ' 导入失败'); }
            }
            if (n) { await savePresets(); toast('success', '导入了 ' + n + ' 个预设'); draw(); }
        };
        body.onclick = async (e) => {
            const card = e.target.closest('.card');
            if (!card) return;
            const p = presetById(card.dataset.id);
            if (e.target.closest('[data-use]')) {
                if (!S.chat) S.chat = newChatObj();
                S.chat.presetId = p.id; S.settings.lastPresetId = p.id; saveSettings();
                if (S.chat.messages.length) saveChat();
                renderChip(); draw(); toast('success', '当前对话改用「' + p.name + '」');
            } else if (e.target.closest('[data-edit]')) editPreset(p, draw);
            else if (e.target.closest('[data-export]')) saveFile(p.name + '.json', JSON.stringify(Preset.exportPreset(p), null, 4));
            else if (e.target.closest('[data-del]')) {
                if (!(await confirmBox('删除预设', '「' + p.name + '」', '删除', true))) return;
                S.presets = S.presets.filter((x) => x.id !== p.id); await savePresets(); draw(); renderChip();
            }
        };
        draw();
    }

    function editPreset(p, done) {
        const L = openLayer('page', '<div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + ICON.back + '</button><b>' + esc(p.name) + '</b>'
            + '<button class="btn small" data-rename>改名</button></div><div class="page-body"></div>', { onClose: () => done && done() });
        const body = $('.page-body', L.box);
        const save = () => savePresets();
        const byId = () => new Map(p.prompts.map((x) => [x.identifier, x]));
        const draw = () => {
            const pr = p.params;
            const map = byId();
            body.innerHTML = '<div class="section-title" style="margin-top:0">参数</div><div class="grid2">'
                + numField('温度', 'temperature', pr.temperature, 0.05) + numField('Top P', 'top_p', pr.top_p, 0.01)
                + numField('最大回复长度', 'max_tokens', pr.max_tokens, 1) + numField('上下文长度（0 不限）', 'max_context', pr.max_context, 1)
                + numField('频率惩罚', 'frequency_penalty', pr.frequency_penalty, 0.01) + numField('存在惩罚', 'presence_penalty', pr.presence_penalty, 0.01)
                + numField('Top K', 'top_k', pr.top_k, 1) + '<div class="field"><label>&nbsp;</label><label class="check" style="margin:6px 0 0"><input type="checkbox" data-p="stream"' + (pr.stream ? ' checked' : '') + '> 流式输出</label></div>'
                + '</div>'
                + '<div class="section-title">条目（按发送顺序）</div>'
                + p.order.map((o, i) => {
                    const x = map.get(o.identifier);
                    if (!x) return '';
                    const isHist = x.identifier === 'chatHistory';
                    const tags = [];
                    if (isHist) tags.push('<span class="badge acc">这里放对话</span>');
                    else if (x.marker) tags.push('<span class="badge">' + esc(Preset.MARKER_NAMES[x.identifier] || '占位') + '·无数据跳过</span>');
                    else {
                        tags.push('<span class="badge">' + x.role + '</span>');
                        if (x.injection_position === 1) tags.push('<span class="badge acc">深度 ' + x.injection_depth + '</span>');
                        tags.push('<span class="badge">约 ' + Preset.estTokens(x.content) + '</span>');
                    }
                    if (o.orphan) tags.push('<span class="badge">原预设未排序</span>');
                    return '<div class="entry' + (o.enabled ? '' : ' off') + (x.marker ? ' marker' : '') + '" data-i="' + i + '">'
                        + '<label class="switch"><input type="checkbox" data-toggle' + (o.enabled ? ' checked' : '') + '><span></span></label>'
                        + '<div class="e-main" data-open><div class="e-name">' + esc(x.name) + '</div><div class="e-tags">' + tags.join('') + '</div></div>'
                        + '<button class="icon-btn" data-up aria-label="上移">' + ICON.up + '</button><button class="icon-btn" data-down aria-label="下移">' + ICON.down + '</button></div>';
                }).join('')
                + '<div class="btns" style="justify-content:flex-start"><button class="btn small" data-new-entry>' + '新增条目</button></div>'
                + '<div class="section-title">其他</div>'
                + '<div class="field"><label>新对话开头提示（new_chat_prompt）</label><textarea class="ta" data-s="new_chat_prompt"></textarea></div>'
                + '<div class="field"><label>AI 回复预填（assistant_prefill，给 Claude 用）</label><textarea class="ta" data-s="assistant_prefill"></textarea></div>';
            $('[data-s="new_chat_prompt"]', body).value = p.new_chat_prompt || '';
            $('[data-s="assistant_prefill"]', body).value = p.assistant_prefill || '';
        };
        body.addEventListener('change', (e) => {
            const t = e.target;
            if (t.dataset.p) {
                p.params[t.dataset.p] = t.type === 'checkbox' ? t.checked : Number(t.value);
                save();
            } else if (t.dataset.s) {
                p[t.dataset.s] = t.value; save();
            } else if (t.hasAttribute('data-toggle')) {
                const i = +t.closest('.entry').dataset.i;
                p.order[i].enabled = t.checked;
                t.closest('.entry').classList.toggle('off', !t.checked);
                save();
            }
        });
        body.addEventListener('click', async (e) => {
            const row = e.target.closest('.entry');
            if (e.target.closest('[data-new-entry]')) {
                const x = { identifier: uid(), name: '新条目', role: 'system', content: '', marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 };
                p.prompts.push(x); p.order.push({ identifier: x.identifier, enabled: true });
                save(); draw(); editEntry(p, x, draw);
                return;
            }
            if (!row) return;
            const i = +row.dataset.i;
            if (e.target.closest('[data-up]') && i > 0) { [p.order[i - 1], p.order[i]] = [p.order[i], p.order[i - 1]]; save(); draw(); }
            else if (e.target.closest('[data-down]') && i < p.order.length - 1) { [p.order[i + 1], p.order[i]] = [p.order[i], p.order[i + 1]]; save(); draw(); }
            else if (e.target.closest('[data-open]')) {
                const x = byId().get(p.order[i].identifier);
                if (x.marker) return toast('info', x.identifier === 'chatHistory' ? '对话会放在这个位置' : '这是酒馆的占位条目（世界书/角色卡等），这里没有对应数据，发送时跳过');
                editEntry(p, x, draw);
            }
        });
        $('[data-rename]', L.box).onclick = async () => {
            const v = await promptBox('预设名称', p.name);
            if (v && v.trim()) { p.name = v.trim(); $('.page-head b', L.box).textContent = p.name; save(); }
        };
        draw();
    }

    function numField(label, key, val, step) {
        return '<div class="field"><label>' + label + '</label><input type="number" inputmode="decimal" step="' + step + '" data-p="' + key + '" value="' + esc(val) + '"></div>';
    }

    function editEntry(p, x, done) {
        const L = openLayer('page', '<div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + ICON.back + '</button><b>编辑条目</b>'
            + '<button class="btn small danger" data-del>删除</button><button class="btn primary small" data-save>保存</button></div><div class="page-body">'
            + '<div class="field"><label>名称</label><input type="text" data-k="name"></div>'
            + '<div class="grid2"><div class="field"><label>角色</label><select data-k="role"><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></div>'
            + '<div class="field"><label>位置</label><select data-k="injection_position"><option value="0">按顺序（相对）</option><option value="1">插入对话中（深度）</option></select></div>'
            + '<div class="field" data-depth><label>深度（0 = 最后一条之后）</label><input type="number" data-k="injection_depth"></div>'
            + '<div class="field" data-depth><label>同深度排序</label><input type="number" data-k="injection_order"></div></div>'
            + '<div class="field"><label>内容（支持 {{user}} {{char}} {{time}} {{random::a::b}} {{setvar}} 等常用宏）</label><textarea class="ta big" data-k="content"></textarea></div>'
            + '</div>');
        const box = L.box;
        $$('[data-k]', box).forEach((el) => { el.value = x[el.dataset.k]; });
        const syncDepth = () => $$('[data-depth]', box).forEach((d) => { d.style.display = $('[data-k="injection_position"]', box).value === '1' ? '' : 'none'; });
        $('[data-k="injection_position"]', box).onchange = syncDepth;
        syncDepth();
        $('[data-save]', box).onclick = () => {
            $$('[data-k]', box).forEach((el) => {
                const k = el.dataset.k;
                x[k] = (k === 'injection_position' || k === 'injection_depth' || k === 'injection_order') ? Number(el.value) || 0 : el.value;
            });
            savePresets(); closeLayer(L, true); done && done(); toast('success', '已保存');
        };
        $('[data-del]', box).onclick = async () => {
            if (!(await confirmBox('删除条目', '「' + x.name + '」', '删除', true))) return;
            p.prompts = p.prompts.filter((y) => y !== x);
            p.order = p.order.filter((o) => o.identifier !== x.identifier);
            savePresets(); closeLayer(L, true); done && done();
        };
    }

    // ---------- 通用 ----------
    function tabGeneral(body) {
        const st = S.settings;
        const pp = st.plainParams;
        body.innerHTML = '<div class="grid2"><div class="field"><label>你的名字 {{user}}</label><input type="text" data-g="userName"></div>'
            + '<div class="field"><label>AI 的名字 {{char}}</label><input type="text" data-g="charName"></div></div>'
            + '<div class="field"><label>消息整理（相当于酒馆的「提示词后处理」）</label><select data-g="postProcess">'
            + '<option value="none">不处理</option><option value="merge">合并相邻同角色消息（推荐）</option><option value="semi">半严格：中途的 system 改成 user</option><option value="strict">严格：只留开头 system，首条必须是 user</option></select>'
            + '<div class="help">Claude 类接口报「角色顺序」之类的错时，改成严格。</div></div>'
            + '<div class="section-title">不用预设时</div>'
            + '<div class="field"><label>系统提示词（可留空）</label><textarea class="ta" data-g="plainSystemPrompt" placeholder="比如：你是一个简洁的助手，用中文回答。"></textarea></div>'
            + '<div class="grid2">' + numFieldG('温度', 'temperature', pp.temperature, 0.05) + numFieldG('最大回复长度', 'max_tokens', pp.max_tokens, 1) + '</div>'
            + '<label class="check"><input type="checkbox" data-pp="stream"' + (pp.stream ? ' checked' : '') + '> 流式输出</label>'
            + '<div class="section-title">界面</div>'
            + '<label class="check"><input type="checkbox" data-g="enterToSend"> 回车直接发送（关掉时回车是换行，点按钮发送）</label>'
            + '<label class="check"><input type="checkbox" data-g="thinkOpen"> 思考过程默认展开</label>'
            + '<div class="field"><label>字号 <span data-fsv></span></label><input type="range" min="12" max="22" step="1" data-g="fontSize" style="width:100%"></div>';
        $$('[data-g]', body).forEach((el) => {
            const k = el.dataset.g;
            if (el.type === 'checkbox') el.checked = !!st[k]; else el.value = st[k];
        });
        $('[data-fsv]', body).textContent = st.fontSize + 'px';
        body.onchange = body.oninput = (e) => {
            const t = e.target;
            if (t.dataset.g) {
                const k = t.dataset.g;
                st[k] = t.type === 'checkbox' ? t.checked : (t.type === 'range' ? Number(t.value) : t.value);
                if (k === 'fontSize') { applyFont(); $('[data-fsv]', body).textContent = st.fontSize + 'px'; }
            } else if (t.dataset.pp) {
                st.plainParams[t.dataset.pp] = t.type === 'checkbox' ? t.checked : Number(t.value);
            }
            saveSettings();
        };
    }
    function numFieldG(label, key, val, step) {
        return '<div class="field"><label>' + label + '</label><input type="number" inputmode="decimal" step="' + step + '" data-pp="' + key + '" value="' + esc(val) + '"></div>';
    }
    function applyFont() { document.documentElement.style.setProperty('--fs', (S.settings.fontSize || 15) + 'px'); }

    // ---------- 数据 ----------
    function tabData(body) {
        let ver = '网页调试版';
        try { if (bridge) ver = bridge.appVersion(); } catch (e) { /* ignore */ }
        body.innerHTML = '<div class="card"><div class="card-title">备份</div><div class="card-sub">把全部对话、预设、接口（含 Key）、设置导出成一个 JSON 文件，保存在「下载/酒馆询问机」。换手机或重装前先备份。</div>'
            + '<div class="btns"><button class="btn primary small" data-export>导出备份</button><button class="btn small" data-import>导入备份</button></div></div>'
            + '<div class="card"><div class="card-title">统计</div><div class="card-sub">' + S.chatIndex.length + ' 个对话 · ' + S.presets.length + ' 个预设 · ' + S.apis.length + ' 个接口</div></div>'
            + '<div class="card"><div class="card-title">清空</div><div class="card-sub">删除全部对话（预设和接口保留）。</div><div class="btns"><button class="btn small danger" data-clear>清空全部对话</button></div></div>'
            + '<div class="card-sub" style="text-align:center;margin-top:20px">酒馆询问机 ' + esc(ver) + '</div>';
        $('[data-export]', body).onclick = async () => {
            await saveChat(true);
            const all = await Store.dumpAll();
            const d = new Date();
            const name = '酒馆询问机备份-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.json';
            saveFile(name, JSON.stringify({ app: 'tavern-asker', version: 1, time: Date.now(), data: all }));
        };
        $('[data-import]', body).onclick = async () => {
            const [f] = await pickFiles('.json,application/json', false);
            if (!f) return;
            let j;
            try { j = JSON.parse(await f.text()); } catch (e) { return toast('error', '不是有效的 JSON'); }
            if (!j || j.app !== 'tavern-asker' || !j.data) return toast('error', '不是酒馆询问机的备份文件');
            const L = openLayer('dialog', '<h3>导入备份</h3><p>合并：保留现有数据，同名项用备份里的覆盖。\n替换：先清空，再完全用备份。</p>'
                + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn" data-merge>合并</button><button class="btn danger" data-replace>替换</button></div>');
            const go = async (merge) => {
                closeLayer(L, true);
                if (S.gen) stopGen();
                if (merge) {
                    const cur = await Store.dumpAll();
                    const d = j.data;
                    const mergeList = (key) => {
                        const a = cur[key] || [], b = d[key] || [];
                        const m = new Map(a.map((x) => [x.id, x]));
                        b.forEach((x) => m.set(x.id, x));
                        d[key] = Array.from(m.values());
                    };
                    ['apis', 'presets', 'chatIndex'].forEach(mergeList);
                    if (cur.settings && d.settings) d.settings = Object.assign({}, cur.settings, d.settings);
                    await Store.restoreAll(d, true);
                } else {
                    await Store.restoreAll(j.data, false);
                }
                toast('success', '已导入');
                setTimeout(() => location.reload(), 500);
            };
            $('[data-merge]', L.box).onclick = () => go(true);
            $('[data-replace]', L.box).onclick = () => go(false);
        };
        $('[data-clear]', body).onclick = async () => {
            if (!(await confirmBox('清空全部对话', '共 ' + S.chatIndex.length + ' 个对话，删除后不能恢复。', '清空', true))) return;
            if (S.gen) stopGen();
            for (const x of S.chatIndex) await Store.del('chat:' + x.id);
            S.chatIndex = []; await saveIndex();
            S.chat = newChatObj();
            tabData(body);
            toast('success', '已清空');
        };
    }

    // ------------------------------------------------------------
    // 启动
    // ------------------------------------------------------------
    $('#btn-drawer').onclick = openDrawer;
    $('#btn-settings').onclick = () => openSettings();
    $('#switch-chip').onclick = openSwitch;
    $('#chat-title').onclick = async () => {
        if (!S.chat) return;
        const v = await promptBox('对话名称', S.chat.title);
        if (v === null || !v.trim()) return;
        S.chat.title = v.trim();
        await saveChat(true);
        renderAll(true);
    };

    // 切到后台时立刻落盘
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveChat(true); });

    async function boot() {
        S.settings = Object.assign({}, DEFAULT_SETTINGS, await Store.get('settings', {}));
        S.settings.plainParams = Object.assign({}, DEFAULT_SETTINGS.plainParams, S.settings.plainParams || {});
        S.apis = await Store.get('apis', []);
        S.presets = await Store.get('presets', []);
        S.chatIndex = await Store.get('chatIndex', []);
        applyFont();
        const last = S.settings.lastChatId && S.chatIndex.find((x) => x.id === S.settings.lastChatId);
        if (!(last && await loadChat(last.id))) { S.chat = newChatObj(); renderAll(); }
        if (!S.apis.length) setTimeout(() => toast('info', '先点右上角齿轮，在「接口」里填 API'), 400);
    }
    boot().catch((e) => { console.error(e); toast('error', e.message || String(e), '启动失败'); });

    // 调试用
    window.__asker = { S, generate, renderAll };
})();
