/*
 * 衣柜.js —— 角色衣柜：每个角色存多套衣服，每件衣服有穿脱状态，里面的衣服被外面的挡住时不写进提示词
 *
 * 照 NAIWeaver 的 outfit_slots / outfit_renderer 改写（MIT）：
 *   部位：外套 / 上衣 / 连衣裙 / 下装 / 胸罩 / 内裤 / 袜子 / 鞋 / 头饰 / 配饰
 *   状态：穿好 / 解开扣子 / 敞开 / 掀起 / 拉下 / 拨到一边 / 褪到脚踝 / 脱掉（每个部位只能选合理的几种）
 *   遮挡：上衣、连衣裙、合襟的长外套（和服、斗篷…）穿好时胸罩不写；下装、连衣裙、长外套穿好时内裤不写；
 *         穿着袜子脱了鞋不写 barefoot；上下都露了合成 nude / completely nude；衣服不整齐时加 nsfw
 *
 * 数据挂在角色上：角色.wardrobe = { current: 正在穿的那套 id（'' = 不用衣柜，用「固定着装」）, outfits: [{ id, name, items: { 部位: { tags, state } } }] }
 * 角色库.js 的 tagsOf 会调 Wardrobe.outfitTags(角色)，所以名字换外貌、发给 AI 的外貌、写真都自动带上正在穿的衣服。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;

    const S = (k, label, states, ph) => ({ k, label, states, ph });
    const SLOTS = [
        S('outerwear', '外套', ['intact', 'unbuttoned', 'open', 'removed'], 'black jacket / white cardigan / kimono'),
        S('top', '上衣', ['intact', 'unbuttoned', 'open', 'lifted', 'removed'], 'white shirt, sailor collar'),
        S('dress', '连衣裙 / 连体衣', ['intact', 'unbuttoned', 'open', 'pulled_down', 'lifted', 'removed'], 'white sundress（和上衣、下装二选一）'),
        S('bottom', '下装（裙子 / 裤子）', ['intact', 'unbuttoned', 'lifted', 'pulled_down', 'around_ankles', 'removed'], 'pleated skirt, blue skirt'),
        S('bra', '胸罩', ['intact', 'lifted', 'pulled_down', 'removed'], 'white bra'),
        S('panties', '内裤', ['intact', 'pulled_down', 'aside', 'around_ankles', 'removed'], 'white panties'),
        S('legwear', '袜子', ['intact', 'pulled_down', 'around_ankles', 'removed'], 'black thighhighs / white socks'),
        S('footwear', '鞋', ['intact', 'removed'], 'loafers / sneakers'),
        S('headwear', '头饰 / 帽子', ['intact', 'removed'], 'hair ribbon / beret'),
        S('accessory', '配饰', ['intact', 'removed'], 'choker, glasses'),
    ];
    const SLOT_KEYS = SLOTS.map((x) => x.k);
    const SLOT = Object.fromEntries(SLOTS.map((x) => [x.k, x]));
    const STATE_LABEL = {
        intact: '穿好', unbuttoned: '解开扣子', open: '敞开', lifted: '掀起', pulled_down: '拉下',
        aside: '拨到一边', around_ankles: '褪到脚踝', removed: '脱掉',
    };
    // 脱掉时写的裸露标签
    const REMOVED_TAG = { top: 'topless', bottom: 'bottomless', bra: 'no bra', panties: 'no panties', footwear: 'barefoot' };
    // 衣服不整齐（且看得见）时加 nsfw 的部位
    const NSFW_SLOTS = new Set(['top', 'bottom', 'dress', 'bra', 'panties', 'legwear']);
    // 合襟外套：穿好时挡住胸口；长的还挡住下身
    const CLOSED_FRONT = ['haori', 'happi', 'kimono', 'yukata', 'hanfu', 'ruqun', 'robe', 'bathrobe', 'dressing gown', 'cloak', 'mantle', 'shawl', 'surcoat', 'tabard', 'poncho', 'serape', 'dotera', 'kosode'];
    const LONG_CLOSED_FRONT = ['kimono', 'yukata', 'robe', 'bathrobe', 'dressing gown', 'cloak', 'hanfu', 'ruqun'];

    const newId = () => 'of_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const clean = (s) => String(s || '').split(/[,，\n]/).map((x) => x.trim()).filter(Boolean).join(', ');

    // ------------------------------------------------------------
    // 数据
    // ------------------------------------------------------------
    function normalizeOutfit(o) {
        o = o || {};
        const items = {};
        const src = o.items || {};
        SLOT_KEYS.forEach((k) => {
            let it = src[k];
            if (typeof it === 'string' || Array.isArray(it)) it = { tags: it };
            if (!it) return;
            const tags = clean(Array.isArray(it.tags) ? it.tags.join(', ') : it.tags);
            if (!tags) return;
            const state = SLOT[k].states.includes(it.state) ? it.state : 'intact';
            items[k] = { tags, state };
        });
        return { id: o.id || newId(), name: String(o.name || '').trim() || '未命名', items };
    }

    function normalize(w) {
        w = w && typeof w === 'object' ? w : {};
        const outfits = (Array.isArray(w.outfits) ? w.outfits : []).map(normalizeOutfit);
        const current = outfits.some((o) => o.id === w.current) ? w.current : '';
        return { current, outfits };
    }

    /** 角色正在穿的那套，没选 → null */
    function current(c) {
        const w = c && c.wardrobe;
        if (!w || !w.current || !Array.isArray(w.outfits)) return null;
        return w.outfits.find((o) => o.id === w.current) || null;
    }

    // ------------------------------------------------------------
    // 拼标签（遮挡 + 状态）
    // ------------------------------------------------------------
    const has = (items, k) => items[k] && items[k].tags;
    const st = (items, k) => (has(items, k) ? items[k].state || 'intact' : null);
    const garment = (items, k) => (has(items, k) ? items[k].tags.toLowerCase() : '');
    const any = (g, list) => list.some((w) => g.includes(w));

    function braConcealed(items) {
        if (['intact', 'unbuttoned', 'lifted'].includes(st(items, 'dress'))) return true;
        if (['intact', 'unbuttoned'].includes(st(items, 'top'))) return true;
        return st(items, 'outerwear') === 'intact' && any(garment(items, 'outerwear'), CLOSED_FRONT);
    }
    function pantiesConcealed(items) {
        if (['intact', 'unbuttoned', 'open', 'pulled_down'].includes(st(items, 'dress'))) return true;
        if (['intact', 'unbuttoned'].includes(st(items, 'bottom'))) return true;
        return st(items, 'outerwear') === 'intact' && any(garment(items, 'outerwear'), LONG_CLOSED_FRONT);
    }
    const braCovers = (items) => st(items, 'bra') === 'intact' && !braConcealed(items);
    const pantiesCover = (items) => st(items, 'panties') === 'intact' && !pantiesConcealed(items);

    function renderSlot(k, base, state, g) {
        if (state === 'intact') return base;
        const skirt = g.includes('skirt');
        const add = {
            top: { unbuttoned: 'unbuttoned shirt, partially unbuttoned', open: 'open shirt, open clothes', lifted: 'shirt lift, clothes lift' },
            outerwear: { unbuttoned: 'unbuttoned jacket', open: 'open jacket, open clothes' },
            bottom: {
                unbuttoned: skirt ? '' : 'unbuttoned pants', lifted: skirt ? 'skirt lift, clothes lift' : 'clothes lift',
                pulled_down: skirt ? 'clothes pull' : 'pants pull, clothes pull', around_ankles: 'pants around one leg',
            },
            bra: { lifted: 'bra lift', pulled_down: 'bra pull' },
            panties: { pulled_down: 'panties pull, clothes pull', aside: 'panties aside, clothing aside', around_ankles: 'panties around one leg, panties around ankles' },
            legwear: { pulled_down: 'stocking pull', around_ankles: 'socks around one leg' },
            dress: { unbuttoned: 'unbuttoned dress', open: 'open dress, open clothes', pulled_down: 'dress pull, clothes pull', lifted: 'dress lift, clothes lift' },
        }[k];
        const extra = add && add[state];
        return extra ? base + ', ' + extra : base;
    }

    /**
     * 一套衣服 → 标签
     * 返回 { tags, nsfw 衣服不整齐, hidden: [被挡住的部位], removed: [脱掉的部位] }
     */
    function render(outfit) {
        const items = (outfit && outfit.items) || {};
        const parts = [], hidden = [], removed = [];
        let nsfw = false, torsoBare = false, pelvisBare = false;
        for (const k of SLOT_KEYS) {
            if (!has(items, k)) continue;
            const state = st(items, k), base = items[k].tags;
            if ((k === 'bra' && braConcealed(items)) || (k === 'panties' && pantiesConcealed(items))) { hidden.push(k); continue; }
            if (state !== 'intact' && NSFW_SLOTS.has(k)) nsfw = true;
            if (state === 'removed') {
                removed.push(k);
                if (k === 'dress') {
                    if (!braCovers(items)) torsoBare = true;
                    if (!pantiesCover(items)) pelvisBare = true;
                } else if (k === 'top') { if (!braCovers(items)) torsoBare = true; }
                else if (k === 'bottom') { if (!pantiesCover(items)) pelvisBare = true; }
                else if (k === 'footwear' && st(items, 'legwear') === 'intact') { /* 穿着袜子，不算光脚 */ }
                else if (REMOVED_TAG[k]) parts.push(REMOVED_TAG[k]);
                continue;
            }
            parts.push(renderSlot(k, base, state, base.toLowerCase()));
            if (k === 'dress' && state === 'pulled_down' && !braCovers(items)) parts.push('breasts out');
        }
        // 上衣和下装都没写：上身/下身本来就没东西遮
        let out = parts;
        const drop = (t) => { out = out.filter((p) => p !== t); };
        if (torsoBare && pelvisBare) {
            const allOff = ['legwear', 'footwear', 'headwear', 'outerwear', 'accessory'].every((k) => !has(items, k) || st(items, k) === 'removed');
            ['no bra', 'no panties'].forEach(drop);
            if (allOff) { drop('barefoot'); out.push('completely nude'); } else out.push('nude');
        } else if (torsoBare) { drop('no bra'); out.push('topless'); } else if (pelvisBare) { drop('no panties'); out.push('bottomless'); }
        return { tags: out.filter(Boolean).join(', '), nsfw, hidden, removed };
    }

    /** 角色正在穿的衣服标签（衣服不整齐时末尾加 nsfw）；没用衣柜 → null（角色库就用「固定着装」） */
    function outfitTags(c) {
        const o = current(c);
        if (!o) return null;
        const r = render(o);
        const fixed = clean(c.fields && c.fields.outfit); // 固定着装（围巾、项圈这类不换的）仍然带上
        return [r.tags, fixed, r.nsfw ? 'nsfw' : ''].filter(Boolean).join(', ');
    }

    // ------------------------------------------------------------
    // 编辑页里的「衣柜」一块
    // ------------------------------------------------------------
    let openId = null; // 展开的那套

    function stateSelect(k, v, attrs) {
        return '<select ' + attrs + '>' + SLOT[k].states.map((s) => '<option value="' + s + '"' + (s === v ? ' selected' : '') + '>' + STATE_LABEL[s] + '</option>').join('') + '</select>';
    }

    function summary(o) {
        const r = render(o);
        const names = (ks) => ks.map((k) => SLOT[k].label.replace(/（.*|\s\/.*/, '')).join('、');
        return '<div class="wd-tags">' + (r.tags ? esc(r.tags) + (r.nsfw ? ', nsfw' : '') : '<i>还没有衣服</i>') + '</div>'
            + (r.hidden.length ? '<div class="card-sub">被挡住、不写进提示词：' + names(r.hidden) + '</div>' : '')
            + (r.removed.length ? '<div class="card-sub">已脱掉：' + names(r.removed) + '</div>' : '');
    }

    function outfitHtml(w, o) {
        const on = w.current === o.id, open = openId === o.id;
        let h = '<div class="card wd-card' + (on ? ' on' : '') + '" data-o="' + esc(o.id) + '">'
            + '<div class="row"><b class="grow wd-name">' + esc(o.name) + '</b>'
            + (on ? '<span class="badge acc">正在穿</span>' : '<button class="btn small" data-wa="wear">穿这套</button>')
            + '<button class="btn small" data-wa="toggle">' + (open ? '收起' : '编辑') + '</button></div>'
            + '<div class="wd-sum">' + summary(o) + '</div>';
        if (open) {
            h += '<div class="field" style="margin-top:10px"><label>这套叫什么</label><input type="text" data-wn value="' + esc(o.name) + '"></div>'
                + SLOTS.map((s) => {
                    const it = o.items[s.k] || { tags: '', state: 'intact' };
                    return '<div class="wd-slot"><label>' + esc(s.label) + '</label><div class="row">'
                        + '<input class="grow" type="text" data-ws="' + s.k + '" value="' + esc(it.tags) + '" placeholder="' + esc(s.ph) + '">'
                        + stateSelect(s.k, it.state, 'data-wst="' + s.k + '" style="width:auto"') + '</div></div>';
                }).join('')
                + '<div class="btns"><button class="btn small" data-wa="dress">全部穿好</button><button class="btn small" data-wa="copy">复制一套</button>'
                + (on ? '<button class="btn small" data-wa="off">不穿这套</button>' : '') + '<button class="btn small danger" data-wa="del">删除</button></div>';
        }
        return h + '</div>';
    }

    function blockHtml(w) {
        return '<div class="label" style="margin-top:14px">衣柜</div>'
            + '<div class="help" style="margin-bottom:8px">存几套衣服，选「穿这套」后写名字就带上这套衣服（不选就用上面的「固定着装」）。每件可以设穿脱状态，里面的衣服被外面挡住时自动不写。</div>'
            + w.outfits.map((o) => outfitHtml(w, o)).join('')
            + '<div class="btns" style="justify-content:flex-start;margin:0 0 14px"><button class="btn" data-wa="add">加一套衣服</button></div>';
    }

    CharLib.addEditorPart({
        html: () => '<div class="wd-box"></div>',
        bind(box, d, refresh) {
            d.wardrobe = normalize(d.wardrobe);
            openId = null;
            const wrap = $('.wd-box', box);
            const draw = () => { wrap.innerHTML = blockHtml(d.wardrobe); refresh(); };
            const outfitOf = (el) => { const card = el.closest('[data-o]'); return card && d.wardrobe.outfits.find((o) => o.id === card.dataset.o); };
            // 输入时只刷新这一套的摘要，不重画（不然输入框会丢焦点）
            const soft = (o, el) => { $('.wd-sum', el.closest('[data-o]')).innerHTML = summary(o); refresh(); };
            wrap.addEventListener('input', (e) => {
                const el = e.target, o = outfitOf(el);
                if (!o) return;
                if (el.dataset.wn != null) { o.name = el.value; $('.wd-name', el.closest('[data-o]')).textContent = el.value; return; }
                const k = el.dataset.ws;
                if (!k) return;
                const v = clean(el.value);
                if (v) o.items[k] = Object.assign(o.items[k] || { state: 'intact' }, { tags: v }); else delete o.items[k];
                soft(o, el);
            });
            wrap.addEventListener('change', (e) => {
                const el = e.target, o = outfitOf(el), k = el.dataset.wst;
                if (!o || !k) return;
                if (o.items[k]) o.items[k].state = el.value;
                soft(o, el);
            });
            wrap.addEventListener('click', async (e) => {
                const b = e.target.closest('[data-wa]');
                if (!b) return;
                const w = d.wardrobe, o = outfitOf(b), a = b.dataset.wa;
                if (a === 'add') { const n = normalizeOutfit({ name: '第 ' + (w.outfits.length + 1) + ' 套' }); w.outfits.push(n); openId = n.id; if (!w.current) w.current = n.id; }
                else if (a === 'wear') w.current = o.id;
                else if (a === 'off') w.current = '';
                else if (a === 'toggle') openId = openId === o.id ? null : o.id;
                else if (a === 'dress') Object.values(o.items).forEach((it) => { it.state = 'intact'; });
                else if (a === 'copy') { const n = normalizeOutfit(JSON.parse(JSON.stringify(Object.assign({}, o, { id: '', name: o.name + ' 副本' })))); w.outfits.push(n); openId = n.id; }
                else if (a === 'del') {
                    if (!await UI.confirmBox('删除「' + o.name + '」这套衣服？', '点右上角「保存」后才真正删掉。', '删除', true)) return;
                    w.outfits = w.outfits.filter((x) => x !== o);
                    if (w.current === o.id) w.current = '';
                }
                draw();
            });
            draw();
            // 给 AI 生成用：外面改了 d.wardrobe 之后重画
            wrap.__redraw = draw;
        },
    });

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.wd-card .row{gap:6px}.wd-name{overflow-wrap:anywhere}'
        + '.wd-tags{margin-top:6px;font-size:13px;color:var(--dim);overflow-wrap:anywhere}.wd-tags i{color:var(--faint);font-style:normal}'
        + '.wd-slot{margin-top:8px}.wd-slot label{display:block;font-size:12px;color:var(--faint);margin-bottom:4px}.wd-slot select{padding:8px 4px;width:6.5em!important;flex:none}'
        + '</style>');

    window.Wardrobe = { SLOTS, STATE_LABEL, normalize, normalizeOutfit, current, render, outfitTags };
})();
