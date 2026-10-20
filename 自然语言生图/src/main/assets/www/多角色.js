/*
 * 多角色.js —— 多角色出图（NAI 的 Character Prompts）：每个角色单独的正面 / 负面提示词，可选站位
 *
 * 角色列表存在 charSlots 键里（跟草稿一样，切走、重开都在）：[{ id, on, tag, negative, pos }]
 *   （以前存在 characters 键，和角色库撞了，打开时自动搬过来）
 * 出图时用 Nai.addHook 写进 v4_prompt / v4_negative_prompt 的 char_captions（V4 起才有，V3 忽略）。
 * 正面提示词里写场景和人数（2girls 之类），每个角色格子里写这个人的外貌、表情、动作。
 * 出的图在配方里记下 meta.characters；「重绘」「用这套重画」按那张图的角色来。
 * 创作页上的卡片：包一层 CreatePage.init / refresh / reuse，插在提示词卡片后面，不改创作页文件。
 */
(function () {
    'use strict';

    const KEY = 'charSlots';

    const { $, $$, esc, toast } = UI;
    const MAX = 6; // NAI 一次最多 6 个角色
    // 站位：NAI 的 5×5 网格取中间九格；'' = 让模型自己安排
    const POS = [
        { value: '', label: '位置自动' },
        { value: '0.3,0.3', label: '左上' }, { value: '0.5,0.3', label: '上' }, { value: '0.7,0.3', label: '右上' },
        { value: '0.3,0.5', label: '左' }, { value: '0.5,0.5', label: '中' }, { value: '0.7,0.5', label: '右' },
        { value: '0.3,0.7', label: '左下' }, { value: '0.5,0.7', label: '下' }, { value: '0.7,0.7', label: '右下' },
    ];

    let list = [];
    let card = null;
    let saveTimer = 0;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => Store.set(KEY, list), 300);
    }

    const clean = (s) => String(s || '').trim().replace(/^,+|,+$/g, '').trim();
    const center = (pos) => {
        const [x, y] = String(pos || '').split(',').map(Number);
        return x > 0 && y > 0 ? { x, y } : { x: 0.5, y: 0.5 };
    };
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
    /** 记进配方 / 给重绘用的快照 */
    const snapshot = (chars) => active(chars).map((c) => ({ tag: clean(c.tag), negative: clean(c.negative), pos: c.pos || '' }));

    // p.characters 给了就用它（重绘、用这套重画），没给用创作页现在的列表
    Nai.addHook((params, nai, p, extra) => {
        const chars = snapshot(Array.isArray(p.characters) ? p.characters : list);
        if (!chars.length || !params.v4_prompt) return; // V3 没有角色提示词
        const coords = chars.some((c) => c.pos);
        params.use_coords = coords;
        params.v4_prompt.use_coords = coords;
        params.v4_prompt.caption.char_captions = chars.map((c) => ({ char_caption: caption(c.tag), centers: [center(c.pos)] }));
        params.v4_negative_prompt.caption.char_captions = chars.map((c) => ({ char_caption: c.negative, centers: [center(c.pos)] }));
        // 官网前端两份都发，有的第三方站读的是这一份
        params.characterPrompts = chars.map((c) => ({ prompt: caption(c.tag), uc: c.negative, center: center(c.pos), enabled: true }));
        extra.characters = chars;
    });

    // ------------------------------------------------------------
    // 创作页上的卡片
    // ------------------------------------------------------------
    function render() {
        if (!card) return;
        const v3 = Params.isV3(UI.settings.nai.model);
        const n = active(list).length;
        card.innerHTML = '<div class="row"><div class="label grow" style="margin:0">多角色' + (n ? ' <span class="badge acc">' + n + ' 个</span>' : '') + '</div>'
            + (list.length ? '<button class="btn small" data-a="clear">清空</button>' : '')
            + '<button class="btn small" data-a="add"' + (list.length >= MAX ? ' disabled' : '') + '>加一个角色</button></div>'
            + (list.length ? '<div class="card-sub">' + (v3
                ? 'V3 不支持分角色，出图时这些会被忽略；换 V4 以上的模型才有用。'
                : '上面的正面提示词写场景和人数（如 2girls），每个角色只写这个人的外貌、表情、动作。') + '</div>' : '')
            + list.map((c, i) => '<div class="char-item" data-i="' + i + '">'
                + '<div class="row"><label class="check grow" style="margin:0"><span class="switch"><input type="checkbox" data-f="on"' + (c.on !== false ? ' checked' : '') + '><span></span></span><span>角色 ' + (i + 1) + '</span></label>'
                + '<select data-f="pos" style="width:auto;padding:6px 4px">' + POS.map((x) => '<option value="' + x.value + '"' + (x.value === (c.pos || '') ? ' selected' : '') + '>' + x.label + '</option>').join('') + '</select>'
                + '<button class="btn small danger" data-a="del">删除</button></div>'
                + '<div class="field"><textarea class="ta small" data-f="tag" placeholder="这个角色的英文标签，如 girl, long black hair, blue eyes, smile；角色库里的名字也行">' + esc(c.tag) + '</textarea></div>'
                + '<div class="field" style="margin-bottom:0"><textarea class="ta small" data-f="negative" placeholder="这个角色不想要的（可留空）">' + esc(c.negative) + '</textarea></div>'
                + '</div>').join('');
    }

    function bind() {
        card.addEventListener('input', (e) => {
            const f = e.target.dataset.f, box = e.target.closest('[data-i]');
            if (!f || !box) return;
            const c = list[Number(box.dataset.i)];
            if (f === 'on') c.on = e.target.checked;
            else c[f] = e.target.value;
            save();
            if (f === 'on') render();
        });
        card.addEventListener('change', (e) => {
            if (e.target.dataset.f !== 'pos') return;
            list[Number(e.target.closest('[data-i]').dataset.i)].pos = e.target.value;
            save();
        });
        card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'add') {
                if (list.length >= MAX) return;
                list.push({ id: 'ch_' + Date.now().toString(36), on: true, tag: '', negative: '', pos: '' });
                save(); render();
                const tas = $$('textarea[data-f="tag"]', card);
                if (tas.length) tas[tas.length - 1].focus();
            }
            if (b.dataset.a === 'del') {
                const i = Number(b.closest('[data-i]').dataset.i);
                if (clean(list[i].tag) && !await UI.confirmBox('删除角色 ' + (i + 1) + '？', '', '删除', true)) return;
                list.splice(i, 1);
                save(); render();
            }
            if (b.dataset.a === 'clear') {
                if (!await UI.confirmBox('清空所有角色？', '', '清空', true)) return;
                list = [];
                save(); render();
            }
        });
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
        const tagCard = $('#c-tag') && $('#c-tag').closest('.card');
        if (!tagCard) return;
        card = document.createElement('div');
        card.className = 'card';
        card.id = 'c-chars';
        tagCard.parentNode.insertBefore(card, tagCard.nextSibling);
        bind();
        render();
    }

    /** 换成某张图的角色（没记角色的老图 = 清空） */
    function set(chars) {
        list = (chars || []).map((c, i) => ({ id: 'ch_' + Date.now().toString(36) + i, on: true, tag: c.tag || '', negative: c.negative || '', pos: c.pos || '' }));
        save();
        render();
    }

    const init = CreatePage.init, refresh = CreatePage.refresh, reuse = CreatePage.reuse;
    CreatePage.init = async function () { await init.apply(this, arguments); await mount(); };
    // refresh 很频繁（队列每变一次都调），整块重画会打断正在输入的格子：只在 V3 / 非 V3 切换时重画提示
    let wasV3 = null;
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        const v3 = Params.isV3(UI.settings.nai.model);
        if (v3 !== wasV3) { wasV3 = v3; render(); }
    };
    // 图库的图按它的配方换角色；item.characters 给了就用它（批量页是 []）；两个都没有（拆多张的那几张）就不动现在的角色
    CreatePage.reuse = function (item) {
        if (item.characters !== undefined) set(item.characters);
        else if (item.meta) set(item.meta.characters);
        return reuse.apply(this, arguments);
    };

    window.Characters = { get: () => list, set, snapshot, caption };
})();
