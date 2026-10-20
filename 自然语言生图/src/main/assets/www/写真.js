/*
 * 写真.js —— 写真模式：选角色、选衣服（可以临时改穿脱状态）、选表情 / 姿势 / 镜头 / 场景，一键出图
 *
 * 不经过 AI：直接拼标签 = 角色外貌（含正在穿的衣服）, 表情, 姿势, 镜头, 场景；然后走创作页同一条出图队列（CreatePage.draw），
 * 出的图进图库，配方里能看到。创作页的多角色格子不参与（只画这一个角色）。
 * 姿势 / 场景预设照 NAIWeaver 的 photoshoot（MIT）翻成中文。
 * 这次选了什么存在 Store 的 photoshoot 键，下次打开还在。按钮上的 Anlas 花费用 计价.js 的 Cost（没有就不显示）。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const KEY = 'photoshoot';

    const P = (label, tags) => ({ label, tags });
    const EXPRESSIONS = [
        P('微笑', 'smile, closed mouth'), P('大笑', 'laughing, open mouth'), P('害羞', 'blush, embarrassed'), P('温柔', 'light smile, half-closed eyes'),
        P('坏笑', 'smug, grin'), P('无表情', 'expressionless'), P('生气', 'angry, pout'), P('惊讶', 'surprised, open mouth'),
        P('哭', 'crying, tears'), P('闭眼', 'closed eyes'), P('眨眼', 'one eye closed, wink'), P('吐舌', 'tongue out'),
    ];
    const POSES = [
        P('站着', 'standing'), P('站着看镜头', 'standing, looking at viewer'), P('回头看', 'standing, looking back, from behind'),
        P('手背在身后', 'standing, arms behind back'), P('叉腰', 'standing, hands on hips'), P('抱臂', 'standing, crossed arms'),
        P('走路', 'walking'), P('跑步', 'running, motion lines'), P('坐着', 'sitting'), P('坐在椅子上', 'sitting, on chair'),
        P('跪坐', 'kneeling'), P('蹲下', 'squatting'), P('躺着（仰）', 'lying, on back'), P('侧躺', 'lying, on side'), P('趴着', 'lying, on stomach'),
        P('前倾', 'leaning forward'), P('后仰', 'leaning back'), P('托腮', 'hand on own chin'), P('撩头发', 'hand in own hair'),
        P('挥手', 'waving'), P('比耶', 'v, hand up'), P('伸懒腰', 'stretching'), P('跳舞', 'dancing'),
        P('看书', 'reading, holding book'), P('看手机', 'holding phone, looking at phone'), P('喝东西', 'drinking, holding cup'),
        P('动感姿势', 'dynamic pose'), P('第一人称', 'pov, looking at viewer'),
    ];
    const SHOTS = [
        P('不指定', ''), P('特写', 'close-up, portrait'), P('上半身', 'upper body'), P('七分身', 'cowboy shot'), P('全身', 'full body'),
        P('俯拍', 'from above'), P('仰拍', 'from below'), P('侧面', 'from side'),
    ];
    const SCENES = [
        P('卧室', 'bedroom, indoors'), P('客厅', 'living room, indoors'), P('厨房', 'kitchen, indoors'), P('浴室', 'bathroom, indoors'),
        P('咖啡馆', 'cafe, indoors'), P('图书馆', 'library, indoors, bookshelf'), P('教室', 'classroom, indoors'), P('办公室', 'office, indoors'),
        P('神社', 'shrine, outdoors'), P('海边', 'beach, ocean, outdoors'), P('森林', 'forest, tree, outdoors'), P('公园', 'park, outdoors'),
        P('花园', 'garden, flower, outdoors'), P('街道', 'street, outdoors, road'), P('小巷', 'alley, outdoors'), P('天台', 'rooftop, outdoors, cityscape'),
        P('城市', 'cityscape, outdoors, building'), P('夜晚城市', 'cityscape, night, neon lights'), P('山上', 'mountain, outdoors, sky'),
        P('草地', 'field, grass, outdoors'), P('雪地', 'snow, outdoors, winter'), P('夕阳', 'sunset, sky, outdoors'), P('星空', 'night sky, stars, outdoors'),
        P('影棚白底', 'simple background, white background'), P('背景虚化', 'blurry background, bokeh, depth of field'),
    ];

    // 这次的选择（存起来，下次打开还在）
    let sel = { charId: '', outfitId: '', states: {}, expr: [], pose: [], shot: 0, scene: [], customPose: '', customScene: '', size: 'portrait', count: 1 };
    const loaded = Store.get(KEY, null).then((d) => { if (d) sel = Object.assign(sel, d); }).catch(() => {});
    let saveTimer = 0;
    function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => Store.set(KEY, sel).catch(() => {}), 300); }

    const charOf = () => CharLib.list.find((c) => c.id === sel.charId) || null;

    /** 写真用的衣服：选中的那套 + 这次临时改的穿脱状态（不改衣柜） */
    function workingOutfit(c) {
        const w = Wardrobe.normalize(c && c.wardrobe);
        const o = w.outfits.find((x) => x.id === sel.outfitId);
        if (!o) return null;
        const copy = JSON.parse(JSON.stringify(o));
        const st = sel.states[o.id] || {};
        Object.keys(copy.items).forEach((k) => { if (st[k] && Wardrobe.SLOTS.find((s) => s.k === k).states.includes(st[k])) copy.items[k].state = st[k]; });
        return copy;
    }

    const pick = (list, idx) => (idx || []).map((i) => list[i]).filter(Boolean).map((x) => x.tags);
    const join = (arr) => arr.map((s) => String(s || '').trim()).filter(Boolean).join(', ');

    /** 拼出这次的正面标签 */
    function buildTag() {
        const c = charOf();
        if (!c) return '';
        let look;
        if (sel.outfitId === '') look = CharLib.tagsOf(Object.assign({}, c, { wardrobe: null }));     // 不用衣柜：固定着装
        else {
            const o = workingOutfit(c);
            look = CharLib.tagsOf(Object.assign({}, c, { wardrobe: o ? { current: o.id, outfits: [o] } : null }));
        }
        return join([look, ...pick(EXPRESSIONS, sel.expr), ...pick(POSES, sel.pose), sel.customPose, (SHOTS[sel.shot] || SHOTS[0]).tags, ...pick(SCENES, sel.scene), sel.customScene]);
    }

    function chips(list, chosen, group, single) {
        return '<div class="ps-chips" data-g="' + group + '"' + (single ? ' data-single' : '') + '>'
            + list.map((x, i) => '<button class="ps-chip' + ((single ? chosen === i : chosen.includes(i)) ? ' on' : '') + '" data-i="' + i + '">' + esc(x.label) + '</button>').join('') + '</div>';
    }

    function outfitPart(c) {
        const w = Wardrobe.normalize(c.wardrobe);
        const opts = '<option value="">不用衣柜（固定着装）</option>' + w.outfits.map((o) => '<option value="' + esc(o.id) + '"' + (o.id === sel.outfitId ? ' selected' : '') + '>' + esc(o.name) + (o.id === w.current ? '（正在穿）' : '') + '</option>').join('');
        let h = '<div class="field"><label>衣服</label><select data-ps="outfit">' + opts + '</select>'
            + (w.outfits.length ? '' : '<div class="help">这个角色的衣柜是空的，在角色库里编辑角色可以加衣服</div>') + '</div>';
        const o = workingOutfit(c);
        if (o && Object.keys(o.items).length) {
            const r = Wardrobe.render(o);
            h += '<div class="ps-states">' + Wardrobe.SLOTS.filter((s) => o.items[s.k]).map((s) => '<div class="ps-st"><span>' + esc(s.label.replace(/（.*|\s\/.*/, '')) + '</span>'
                + '<select data-pst="' + s.k + '">' + s.states.map((v) => '<option value="' + v + '"' + (v === o.items[s.k].state ? ' selected' : '') + '>' + Wardrobe.STATE_LABEL[v] + '</option>').join('') + '</select></div>').join('') + '</div>'
                + (r.hidden.length ? '<div class="help">被挡住不画：' + r.hidden.map((k) => Wardrobe.SLOTS.find((s) => s.k === k).label.replace(/（.*|\s\/.*/, '')).join('、') + '</div>' : '')
                + '<div class="btns" style="justify-content:flex-start;margin-top:6px"><button class="btn small" data-ps="dress">全部穿好</button><button class="btn small" data-ps="keep">把状态存回衣柜</button></div>';
        }
        return h;
    }

    function bodyHtml() {
        const c = charOf();
        const chars = CharLib.list.filter((x) => x.name);
        if (!chars.length) return '<div class="empty"><b>角色库是空的</b>先在角色库里建一个角色（也可以让 AI 一句话生成）</div>';
        return '<div class="field"><label>角色</label><select data-ps="char">' + chars.map((x) => '<option value="' + esc(x.id) + '"' + (c && x.id === c.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>'
            + (c ? outfitPart(c) : '')
            + '<div class="label">表情</div>' + chips(EXPRESSIONS, sel.expr, 'expr')
            + '<div class="label">姿势（可多选）</div>' + chips(POSES, sel.pose, 'pose')
            + '<input type="text" data-ps="customPose" placeholder="自己补姿势标签，比如 peace sign, head tilt" style="margin:6px 0 12px">'
            + '<div class="label">镜头</div>' + chips(SHOTS, sel.shot, 'shot', true)
            + '<div class="label" style="margin-top:12px">场景</div>' + chips(SCENES, sel.scene, 'scene')
            + '<input type="text" data-ps="customScene" placeholder="自己补场景标签，比如 cherry blossoms, petals" style="margin:6px 0 12px">'
            + '<div class="label">实际发送的画面标签</div><pre class="recipe ps-prev"></pre>'
            + '<div class="ps-results"></div>';
    }

    function footHtml() {
        return '<div class="ps-foot"><div class="seg" data-ps-size><button data-v="portrait">竖图</button><button data-v="landscape">横图</button></div>'
            + '<select data-ps="count" style="width:auto;padding:8px 4px">' + [1, 2, 3, 4].map((v) => '<option value="' + v + '"' + (v === Number(sel.count) ? ' selected' : '') + '>' + v + ' 张</option>').join('') + '</select>'
            + '<span class="grow"></span><button class="btn primary" data-ps="go">出图</button></div>';
    }

    /** 出图按钮上标花多少 Anlas（计价.js 合进来之前不显示） */
    function costLabel(L) {
        const btn = $('[data-ps="go"]', L.box);
        if (!btn) return;
        btn.textContent = '出图';
        if (!window.Cost) return;
        try {
            const e = Cost.estimate(UI.settings.nai, { size: sel.size, characters: [] }, Number(sel.count) || 1);
            if (typeof Cost.tag === 'function') Cost.tag(btn, e);
            else if (e && e.text) btn.textContent = '出图（' + e.text + '）';
        } catch (err) { console.warn(err); }
    }

    function refreshPreview(L) {
        const pre = $('.ps-prev', L.box);
        if (pre) pre.textContent = buildTag() || '（先选角色）';
        $$('[data-ps-size] button', L.box).forEach((b) => b.classList.toggle('on', b.dataset.v === sel.size));
        costLabel(L);
    }

    let results = [];
    async function showResults(L) {
        const box = $('.ps-results', L.box);
        if (!box) return;
        const html = [];
        for (const r of results) {
            if (r.item) {
                const blob = await Gallery.getBlob(r.item.id);
                if (blob) { r.url = r.url || URL.createObjectURL(blob); html.push('<img src="' + r.url + '" data-id="' + esc(r.item.id) + '" alt="">'); continue; }
            }
            html.push('<div class="ps-wait">' + (r.error ? '失败' : '出图中…') + '</div>');
        }
        box.innerHTML = results.length ? '<div class="label">这次出的图（点开看大图）</div><div class="ps-grid">' + html.join('') + '</div>' : '';
    }

    function go(L) {
        const c = charOf();
        const tag = buildTag();
        if (!c || !tag) { toast('warning', '先选一个角色'); return; }
        const count = Number(sel.count) || 1;
        const jobs = CreatePage.draw({ desc: '写真：' + c.name, tag, nl: '', negative: '', size: sel.size, characters: [], label: '写真 ' + c.name }, count);
        if (!jobs) return;
        const mine = jobs.map((j) => {
            const r = { item: null, error: false };
            j.then((item) => { r.item = item; }).catch(() => { r.error = true; }).finally(() => showResults(L));
            return r;
        });
        results = mine.concat(results).slice(0, 8);
        showResults(L);
        toast('info', '已排进出图队列（' + count + ' 张）');
    }

    function render(L) {
        $('.page-body', L.box).innerHTML = bodyHtml();
        $$('[data-ps="customPose"], [data-ps="customScene"]', L.box).forEach((el) => { el.value = sel[el.dataset.ps] || ''; });
        refreshPreview(L);
        showResults(L);
    }

    async function open(charId) {
        await Promise.all([loaded, CharLib.ready]);
        if (charId) { if (charId !== sel.charId) sel.outfitId = null; sel.charId = charId; }
        const chars = CharLib.list.filter((x) => x.name);
        if (!charOf() && chars.length) { sel.charId = chars[0].id; sel.outfitId = null; }
        // 第一次选这个角色：默认用他正在穿的那套
        const c = charOf();
        if (c && (sel.outfitId == null || (sel.outfitId && !Wardrobe.normalize(c.wardrobe).outfits.some((o) => o.id === sel.outfitId)))) {
            sel.outfitId = Wardrobe.normalize(c.wardrobe).current || '';
        }
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>写真模式</b></div>'
            + '<div class="page-body"></div>' + footHtml(), { onClose: () => results.forEach((r) => r.url && URL.revokeObjectURL(r.url)) });
        results = [];
        render(L);

        L.box.addEventListener('click', async (e) => {
            const chip = e.target.closest('.ps-chip');
            if (chip) {
                const g = chip.parentNode.dataset.g, i = Number(chip.dataset.i);
                if (chip.parentNode.hasAttribute('data-single')) sel[g] = i;
                else sel[g] = sel[g].includes(i) ? sel[g].filter((x) => x !== i) : sel[g].concat(i);
                UI.$$('.ps-chip', chip.parentNode).forEach((b) => {
                    const j = Number(b.dataset.i);
                    b.classList.toggle('on', chip.parentNode.hasAttribute('data-single') ? sel[g] === j : sel[g].includes(j));
                });
                save(); refreshPreview(L); return;
            }
            const sz = e.target.closest('[data-ps-size] button');
            if (sz) { sel.size = sz.dataset.v; save(); refreshPreview(L); return; }
            const img = e.target.closest('.ps-grid img');
            if (img) { GalleryPage.openViewer(img.dataset.id); return; }
            const b = e.target.closest('button[data-ps]');
            if (!b) return;
            const c = charOf();
            if (b.dataset.ps === 'go') go(L);
            else if (b.dataset.ps === 'dress') { delete sel.states[sel.outfitId]; save(); render(L); }
            else if (b.dataset.ps === 'keep' && c) {
                const o = workingOutfit(c);
                c.wardrobe = Wardrobe.normalize(c.wardrobe);
                const real = c.wardrobe.outfits.find((x) => x.id === o.id);
                if (real) Object.keys(real.items).forEach((k) => { real.items[k].state = o.items[k].state; });
                CharLib.save();
                toast('success', '穿脱状态已存回「' + o.name + '」');
            }
        });
        L.box.addEventListener('change', (e) => {
            const el = e.target;
            if (el.dataset.ps === 'char') { sel.charId = el.value; const c = charOf(); sel.outfitId = Wardrobe.normalize(c && c.wardrobe).current || ''; save(); render(L); }
            else if (el.dataset.ps === 'outfit') { sel.outfitId = el.value; save(); render(L); }
            else if (el.dataset.ps === 'count') { sel.count = Number(el.value) || 1; save(); refreshPreview(L); }
            else if (el.dataset.pst) {
                sel.states[sel.outfitId] = Object.assign({}, sel.states[sel.outfitId], { [el.dataset.pst]: el.value });
                save(); render(L);
            }
        });
        L.box.addEventListener('input', (e) => {
            const k = e.target.dataset.ps;
            if (k === 'customPose' || k === 'customScene') { sel[k] = e.target.value; save(); refreshPreview(L); }
        });
        return L;
    }

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.ps-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}'
        + '.ps-chip{border:1px solid var(--line);background:var(--bg2);color:var(--dim);border-radius:999px;padding:6px 12px;font-size:13px}'
        + '.ps-chip.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}'
        + '.ps-states{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}.ps-st{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--dim)}.ps-st span{flex:none;min-width:2.5em}.ps-st select{flex:1;min-width:0;padding:6px 4px}'
        + '.ps-foot{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px calc(8px + var(--safe-bottom));border-top:1px solid var(--line)}.ps-foot .grow{flex:1}'
        + '.ps-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ps-grid img{width:100%;border-radius:10px;display:block}'
        + '.ps-wait{aspect-ratio:2/3;border:1px dashed var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:13px}'
        + '.ps-entry{float:right;color:var(--accent);text-decoration:none;font-size:13px;font-weight:400;margin-left:12px}'
        + '</style>');

    // 入口：角色库页面顶上、角色编辑页、创作页描述标题旁（「角色库」左边）
    CharLib.addListAction({ label: '写真模式', run: () => open() });
    CharLib.addEditorPart({
        html: (d, isNew) => (isNew ? '' : '<div class="btns" style="justify-content:flex-start;margin:0 0 14px"><button class="btn" data-ps-open>用这个角色拍写真</button></div>'),
        bind(box, d) { const b = $('[data-ps-open]', box); if (b) b.onclick = () => open(d.id); },
    });
    function addEntry() {
        const lib = $('#c-char-lib');
        if (!lib || $('#c-photo')) return;
        lib.insertAdjacentHTML('afterend', '<a href="#" id="c-photo" class="ps-entry">写真</a>');
        $('#c-photo').addEventListener('click', (e) => { e.preventDefault(); open(); });
    }
    const view = $('#view-create');
    if (view) new MutationObserver(addEntry).observe(view, { childList: true, subtree: true });
    addEntry();

    window.Photoshoot = { open, buildTag, EXPRESSIONS, POSES, SHOTS, SCENES, get sel() { return sel; } };
})();
