/*
 * 多角色.js —— 多角色出图（NAI 的 Character Prompts）：每个角色单独的正面 / 负面提示词，拖圆点摆位置，角色之间的互动
 *
 * 角色列表存在 charSlots 键里（跟草稿一样，切走、重开都在）：[{ id, on, tag, negative, pos }]
 *   （以前存在 characters 键，和角色库撞了，打开时自动搬过来）
 * 互动存在 charActs 键：[{ id, a, b 角色 id, act 英文动作, mutual 互相 }]，出图时摊成 source#动作 / target#动作 / mutual#动作 加在角色提示词最前面。
 * 位置 pos = 'x,y'（0–1）：V5 原样发（自由摆位），V4 / 4.5 吸到 5×5 网格；有一个角色有位置就开 use_coords。
 * 出图时用 Nai.addHook 写进 v4_prompt / v4_negative_prompt 的 char_captions（V4 起才有，V3 忽略）。
 * 正面提示词里写场景和人数（2girls 之类），每个角色格子里写这个人的外貌、表情、动作。
 * 出的图在配方里记下 meta.characters；「重绘」「用这套重画」按那张图的角色来。
 * 创作页上的卡片：包一层 CreatePage.init / refresh / reuse，插在提示词卡片后面，不改创作页文件。
 */
(function () {
    'use strict';

    const KEY = 'charSlots';
    const ACT_KEY = 'charActs';

    const { $, $$, esc, toast } = UI;
    const maxChars = () => (Params.isV5(UI.settings.nai.model) ? 10 : 6); // V4/4.5 官方上限 6 个；V5 放宽，这里给 10 个
    // V4 / 4.5 只认 5×5 网格（0.1 0.3 0.5 0.7 0.9），V5 可以任意位置
    const GRID = [0.1, 0.3, 0.5, 0.7, 0.9];
    const snap = (v) => GRID.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    const freeform = (model) => Params.isV5(model);

    // 互动预设：中文名 → NAI 动作标签；mutual = 默认是「互相」的动作
    const ACTS = [
        { zh: '拥抱', tag: 'hug' }, { zh: '牵手', tag: 'holding hands', mutual: true }, { zh: '亲吻', tag: 'kiss' },
        { zh: '摸头', tag: 'headpat' }, { zh: '看着', tag: 'looking at another' }, { zh: '对视', tag: 'eye contact', mutual: true },
        { zh: '喂食', tag: 'feeding' }, { zh: '公主抱', tag: 'princess carry' }, { zh: '背着', tag: 'piggyback' },
        { zh: '搭肩', tag: "hand on another's shoulder" }, { zh: '握手', tag: 'handshake', mutual: true }, { zh: '指着', tag: 'pointing at another' },
        { zh: '拉住手臂', tag: "grabbing another's arm" }, { zh: '递东西', tag: 'giving' }, { zh: '膝枕', tag: 'lap pillow' },
        { zh: '靠在身上', tag: 'leaning on person' }, { zh: '捏脸', tag: 'cheek pinching' }, { zh: '挠痒', tag: 'tickling' },
        { zh: '击掌', tag: 'high five', mutual: true }, { zh: '背靠背', tag: 'back-to-back', mutual: true },
        { zh: '打（拳）', tag: 'punching' }, { zh: '踢', tag: 'kicking' }, { zh: '打架', tag: 'fighting', mutual: true },
    ];

    let list = [];   // 角色格子 [{ id, on, tag, negative, pos }]，pos = 'x,y'（0–1，左上角是 0,0）或 '' 自动
    let acts = [];   // 互动 [{ id, a: 角色 id, b: 角色 id, act: 英文动作, mutual }]
    let card = null;
    let saveTimer = 0;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { Store.set(KEY, list); Store.set(ACT_KEY, acts); }, 300);
    }

    const clean = (s) => String(s || '').trim().replace(/^,+|,+$/g, '').trim();
    const parsePos = (pos) => {
        const [x, y] = String(pos || '').split(',').map(Number);
        return x > 0 && y > 0 ? { x, y } : null;
    };
    const fmt = (v) => String(Math.round(v * 1000) / 1000);
    /** 发给 NAI 的坐标：V5 原样（三位小数），V4/4.5 吸到网格上 */
    function center(pos, model) {
        const c = parsePos(pos);
        if (!c) return { x: 0.5, y: 0.5 };
        return freeform(model) ? { x: Number(fmt(c.x)), y: Number(fmt(c.y)) } : { x: snap(c.x), y: snap(c.y) };
    }
    /** 角色格子只描述一个人：1girl / 2boys 这种数人数的标签换成 girl / boy（柏宝绘同口径） */
    function caption(tag) {
        return clean(tag).split(',').map((x) => {
            const v = x.trim();
            if (/^\d+\s*girls?$/i.test(v)) return 'girl';
            if (/^\d+\s*boys?$/i.test(v)) return 'boy';
            return v;
        }).filter(Boolean).join(', ');
    }
    /** 实际要发的角色：开着的、正面不空的 */
    const active = (chars) => (chars || []).filter((c) => c && c.on !== false && clean(c.tag));
    /**
     * 记进配方 / 给重绘用的快照：[{ tag, negative, pos, acts: ['source#hug', …] }]
     * 互动直接摊成每个角色身上的 source# / target# / mutual# 标签，快照自己就完整，重绘不用再查互动表
     */
    function snapshot(chars, interactions) {
        const on = active(chars);
        const ids = on.map((c) => c.id);
        return on.map((c) => {
            const own = Array.isArray(c.acts) ? c.acts.slice() : [];
            (interactions || []).forEach((x) => {
                const act = clean(x.act);
                if (!act || !ids.includes(x.a) || !ids.includes(x.b) || x.a === x.b) return;
                if (x.mutual) { if (c.id === x.a || c.id === x.b) own.push('mutual#' + act); }
                else if (c.id === x.a) own.push('source#' + act);
                else if (c.id === x.b) own.push('target#' + act);
            });
            return { tag: clean(c.tag), negative: clean(c.negative), pos: c.pos || '', acts: own };
        });
    }
    const fullCaption = (c) => [].concat(c.acts || [], [caption(c.tag)]).filter(Boolean).join(', ');

    // p.characters 给了就用它（重绘、用这套重画），没给用创作页现在的列表
    Nai.addHook((params, nai, p, extra) => {
        const chars = Array.isArray(p.characters) ? snapshot(p.characters.map((c, i) => Object.assign({ id: 'p' + i }, c)), []) : snapshot(list, acts);
        if (!chars.length || !params.v4_prompt) return; // V3 没有角色提示词
        const coords = chars.some((c) => parsePos(c.pos));
        params.use_coords = coords;
        params.v4_prompt.use_coords = coords;
        params.v4_prompt.caption.char_captions = chars.map((c) => ({ char_caption: fullCaption(c), centers: [center(c.pos, nai.model)] }));
        params.v4_negative_prompt.caption.char_captions = chars.map((c) => ({ char_caption: c.negative, centers: [center(c.pos, nai.model)] }));
        // 官网前端两份都发，有的第三方站读的是这一份
        params.characterPrompts = chars.map((c) => ({ prompt: fullCaption(c), uc: c.negative, center: center(c.pos, nai.model), enabled: true }));
        extra.characters = chars;
    });

    // ------------------------------------------------------------
    // 创作页上的卡片：角色格子 + 摆位置的小画布 + 互动
    // ------------------------------------------------------------
    const orientation = () => { const b = $('#c-size button.on'); return b && b.dataset.v === 'landscape' ? 'landscape' : 'portrait'; };
    const placing = () => list.some((c) => parsePos(c.pos));
    const nameOf = (id) => { const i = list.findIndex((c) => c.id === id); return i < 0 ? '?' : '角色 ' + (i + 1); };
    /** 打开「自己摆位置」时给还没位置的角色排一排 */
    function spread() {
        const n = list.length;
        list.forEach((c, i) => { if (!parsePos(c.pos)) c.pos = fmt((i + 1) / (n + 1)) + ',0.5'; });
    }

    function padHtml() {
        if (!placing()) return '';
        const model = UI.settings.nai.model, free = freeform(model);
        const land = orientation() === 'landscape';
        return '<div class="pos-wrap"><div class="pos-pad' + (free ? '' : ' grid5') + '" style="aspect-ratio:' + (land ? '3 / 2' : '2 / 3') + '">'
            + list.map((c, i) => {
                const p = parsePos(c.pos) || { x: 0.5, y: 0.5 };
                const q = free ? p : { x: snap(p.x), y: snap(p.y) };
                return '<div class="pos-dot' + (c.on === false ? ' off' : '') + '" data-dot="' + i + '" style="left:' + q.x * 100 + '%;top:' + q.y * 100 + '%">' + (i + 1) + '</div>';
            }).join('') + '</div></div>'
            + '<div class="card-sub">按住圆点拖到想要的位置。' + (free ? 'V5 可以放在任意位置。' : '当前模型只认 5×5 的格子，松手会吸到最近的格子上（V5 才能随便放）。') + '</div>';
    }

    function actsHtml() {
        const ids = list.map((c) => c.id);
        acts = acts.filter((x) => ids.includes(x.a) && ids.includes(x.b));
        if (list.length < 2) return '';
        const opt = (v) => list.map((c, i) => '<option value="' + c.id + '"' + (c.id === v ? ' selected' : '') + '>角色 ' + (i + 1) + '</option>').join('');
        return '<div class="label row" style="margin-top:12px"><span class="grow">角色互动' + (acts.length ? ' <span class="badge acc">' + acts.length + '</span>' : '') + '</span>'
            + '<button class="btn small" data-a="act-add">加一个互动</button></div>'
            + (acts.length ? '' : '<div class="card-sub">比如「角色 1 拥抱 角色 2」，会给两人分别加上 source# / target# 标签，NAI 就知道谁对谁做什么。</div>')
            + acts.map((x, i) => {
                const preset = ACTS.find((a) => a.tag === x.act);
                return '<div class="act-item" data-k="' + i + '">'
                    + '<div class="row"><select data-g="a">' + opt(x.a) + '</select>'
                    + '<select data-g="pick">' + ACTS.map((a) => '<option value="' + esc(a.tag) + '"' + (preset === a ? ' selected' : '') + '>' + a.zh + '</option>').join('')
                    + '<option value=""' + (preset ? '' : ' selected') + '>自己写…</option></select>'
                    + '<select data-g="b">' + opt(x.b) + '</select></div>'
                    + '<div class="row"><input type="text" data-g="act" value="' + esc(x.act) + '" placeholder="英文动作标签，如 hug" class="grow">'
                    + '<label class="check" style="margin:0"><input type="checkbox" data-g="mutual"' + (x.mutual ? ' checked' : '') + '><span>互相</span></label>'
                    + '<button class="btn small danger" data-a="act-del">删除</button></div>'
                    + '<div class="card-sub">' + esc(x.mutual ? nameOf(x.a) + ' 和 ' + nameOf(x.b) + ' 互相 ' : nameOf(x.a) + ' → ' + nameOf(x.b) + '：') + esc(preset ? preset.zh : x.act || '（还没填）') + '</div>'
                    + '</div>';
            }).join('');
    }

    function render() {
        if (!card) return;
        const v3 = Params.isV3(UI.settings.nai.model);
        const n = active(list).length, max = maxChars();
        card.innerHTML = '<div class="row"><div class="label grow" style="margin:0">多角色' + (n ? ' <span class="badge acc">' + n + ' 个</span>' : '') + '</div>'
            + (list.length ? '<button class="btn small" data-a="clear">清空</button>' : '')
            + '<button class="btn small" data-a="add"' + (list.length >= max ? ' disabled' : '') + '>加一个角色</button></div>'
            + (list.length ? '<div class="card-sub">' + (v3
                ? 'V3 不支持分角色，出图时这些会被忽略；换 V4 以上的模型才有用。'
                : '上面的正面提示词写场景和人数（如 2girls），每个角色只写这个人的外貌、表情、动作。') + '</div>' : '')
            + list.map((c, i) => '<div class="char-item" data-i="' + i + '">'
                + '<div class="row"><label class="check grow" style="margin:0"><span class="switch"><input type="checkbox" data-f="on"' + (c.on !== false ? ' checked' : '') + '><span></span></span><span>角色 ' + (i + 1) + '</span></label>'
                + '<button class="btn small danger" data-a="del">删除</button></div>'
                + '<div class="field"><textarea class="ta small" data-f="tag" placeholder="这个角色的英文标签，如 girl, long black hair, blue eyes, smile；角色库里的名字也行">' + esc(c.tag) + '</textarea></div>'
                + '<div class="field" style="margin-bottom:0"><textarea class="ta small" data-f="negative" placeholder="这个角色不想要的（可留空）">' + esc(c.negative) + '</textarea></div>'
                + '</div>').join('')
            + (list.length ? '<label class="check" style="margin:12px 0 6px"><span class="switch"><input type="checkbox" data-a="place"' + (placing() ? ' checked' : '') + '><span></span></span>'
                + '<span>自己摆位置<span class="help">（关着 = 让模型自己安排）</span></span></label>' + padHtml() : '')
            + actsHtml();
    }

    /** 拖圆点 */
    function bindPad() {
        let drag = null;
        card.addEventListener('pointerdown', (e) => {
            const dot = e.target.closest('[data-dot]'); if (!dot) return;
            e.preventDefault();
            drag = { dot, i: Number(dot.dataset.dot), pad: dot.parentNode };
            dot.setPointerCapture(e.pointerId);
            dot.classList.add('drag');
        });
        card.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const r = drag.pad.getBoundingClientRect();
            const x = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
            const y = Math.min(0.98, Math.max(0.02, (e.clientY - r.top) / r.height));
            drag.dot.style.left = x * 100 + '%';
            drag.dot.style.top = y * 100 + '%';
            drag.x = x; drag.y = y;
        });
        const end = () => {
            if (!drag) return;
            const d = drag; drag = null;
            d.dot.classList.remove('drag');
            if (d.x === undefined) return;
            const free = freeform(UI.settings.nai.model);
            list[d.i].pos = fmt(free ? d.x : snap(d.x)) + ',' + fmt(free ? d.y : snap(d.y));
            save();
            render();
        };
        card.addEventListener('pointerup', end);
        card.addEventListener('pointercancel', end);
    }

    function bind() {
        card.addEventListener('input', (e) => {
            const f = e.target.dataset.f, g = e.target.dataset.g;
            if (g) {
                const x = acts[Number(e.target.closest('[data-k]').dataset.k)];
                if (g === 'act') x.act = e.target.value;
                else if (g === 'mutual') x.mutual = e.target.checked;
                else if (g === 'pick') { if (e.target.value) { x.act = e.target.value; x.mutual = !!(ACTS.find((a) => a.tag === x.act) || {}).mutual; } }
                else x[g] = e.target.value;
                save();
                if (g !== 'act') render();
                return;
            }
            const box = e.target.closest('[data-i]');
            if (!f || !box) return;
            const c = list[Number(box.dataset.i)];
            if (f === 'on') c.on = e.target.checked;
            else c[f] = e.target.value;
            save();
            if (f === 'on') render();
        });
        card.addEventListener('change', (e) => {
            if (e.target.dataset.g === 'act') render(); // 自己写的动作：改完再刷新下面那行说明
        });
        card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            const a = b.dataset.a;
            if (a === 'place') {
                if (b.checked) spread(); else list.forEach((c) => { c.pos = ''; });
                save(); render();
                return;
            }
            if (a === 'add') {
                if (list.length >= maxChars()) return;
                list.push({ id: 'ch_' + Date.now().toString(36), on: true, tag: '', negative: '', pos: '' });
                if (placing()) spread();
                save(); render();
                const tas = $$('textarea[data-f="tag"]', card);
                if (tas.length) tas[tas.length - 1].focus();
            }
            if (a === 'del') {
                const i = Number(b.closest('[data-i]').dataset.i);
                if (clean(list[i].tag) && !await UI.confirmBox('删除角色 ' + (i + 1) + '？', '', '删除', true)) return;
                list.splice(i, 1);
                save(); render();
            }
            if (a === 'clear') {
                if (!await UI.confirmBox('清空所有角色？', '互动也一起清空。', '清空', true)) return;
                list = []; acts = [];
                save(); render();
            }
            if (a === 'act-add') {
                acts.push({ id: 'ia_' + Date.now().toString(36), a: list[0].id, b: list[1].id, act: 'hug', mutual: false });
                save(); render();
            }
            if (a === 'act-del') {
                acts.splice(Number(b.closest('[data-k]').dataset.k), 1);
                save(); render();
            }
        });
        bindPad();
    }

    async function mount() {
        let saved = await Store.get(KEY, null);
        // 老版本存在 characters 键里，和角色库撞了同一个键：是数组的就是这里的，搬过来
        if (!Array.isArray(saved)) {
            const old = await Store.get('characters', null);
            saved = Array.isArray(old) ? old : [];
            if (Array.isArray(old)) Store.set(KEY, old);
        }
        list = saved;
        acts = (await Store.get(ACT_KEY, [])) || [];
        const tagCard = $('#c-tag') && $('#c-tag').closest('.card');
        if (!tagCard) return;
        card = document.createElement('div');
        card.className = 'card';
        card.id = 'c-chars';
        tagCard.parentNode.insertBefore(card, tagCard.nextSibling);
        bind();
        render();
        $('#c-size').addEventListener('click', () => setTimeout(() => { if (placing()) render(); })); // 横竖换了，画布跟着换
    }

    /**
     * 换成某张图的角色（没记角色的老图 = 清空）
     * 快照里每个角色身上的 source# / target# / mutual# 拆回互动表
     */
    function set(chars) {
        const t = Date.now().toString(36);
        const own = [];
        list = (chars || []).map((c, i) => {
            const id = 'ch_' + t + i;
            const tagActs = (Array.isArray(c.acts) ? c.acts : []);
            own.push({ id, acts: tagActs });
            return { id, on: true, tag: c.tag || '', negative: c.negative || '', pos: c.pos || '' };
        });
        acts = [];
        const by = {}; // 动作 → { source: [], target: [], mutual: [] }
        own.forEach((o) => o.acts.forEach((x) => {
            const m = /^(source|target|mutual)#(.+)$/.exec(String(x).trim());
            if (!m) return;
            (by[m[2]] = by[m[2]] || { source: [], target: [], mutual: [] })[m[1]].push(o.id);
        }));
        Object.keys(by).forEach((act, k) => {
            const g = by[act];
            g.source.forEach((a, j) => { const b = g.target[j] || g.target[0]; if (b) acts.push({ id: 'ia_' + t + k + 's' + j, a, b, act, mutual: false }); });
            for (let j = 0; j + 1 < g.mutual.length; j += 2) acts.push({ id: 'ia_' + t + k + 'm' + j, a: g.mutual[j], b: g.mutual[j + 1], act, mutual: true });
        });
        save();
        render();
    }

    const init = CreatePage.init, refresh = CreatePage.refresh, reuse = CreatePage.reuse;
    CreatePage.init = async function () { await init.apply(this, arguments); await mount(); };
    // refresh 很频繁（队列每变一次都调），整块重画会打断正在输入的格子：只在换了模型时重画（V3 提示、网格/自由摆位、人数上限）
    let lastModel = null;
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        const m = UI.settings.nai.model;
        if (m !== lastModel) { lastModel = m; render(); }
    };
    // 图库的图按它的配方换角色；item.characters 给了就用它（批量页是 []）；两个都没有（拆多张的那几张）就不动现在的角色
    CreatePage.reuse = function (item) {
        if (item.characters !== undefined) set(item.characters);
        else if (item.meta) set(item.meta.characters);
        return reuse.apply(this, arguments);
    };

    window.Characters = { get: () => list, getActs: () => acts, set, snapshot: (chars) => snapshot(chars || list, chars ? [] : acts), caption, ACTS };
})();
