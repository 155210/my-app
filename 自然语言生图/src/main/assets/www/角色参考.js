/*
 * 角色参考.js —— Director Reference（官网叫 Precise Reference / 角色参考）：给一张图，让出的人物长得像它、或者画风像它
 *
 * 设置里 nai.dirRefs 存小的索引 { id, name, on, type 参考什么, strength 强度, fidelity 保真度 }，
 * 处理好的图存在 dref:<id>：{ image 发给 NAI 的 PNG base64（已经缩放、黑边补成 1024×1536 / 1536×1024 / 1472×1472）, thumb 缩略图 }。
 *
 * 请求字段（照 NAIWeaver 的 nai_request_builder.dart）：
 *   director_reference_images                    图
 *   director_reference_descriptions              [{ caption: { base_caption: 'character' | 'style' | 'character&style', char_captions: [] }, legacy_uc: false }]
 *   director_reference_strength_values           强度
 *   director_reference_secondary_strength_values 1 - 保真度
 *   director_reference_information_extracted     固定 1
 * 只有 V4.5 能用（V5 官方还没开放）；官网规定和 Vibe 二选一，开了它参考图.js 那边就不发、也不编码。
 * 官网口径每张图每张角色参考 +5 Anlas（Opus 免费额度也不抵），在出图按钮的预估里算上（Cost.addExtra）。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const nai = () => UI.settings.nai;
    const MAX = 4;
    const COST = 5;
    const TARGETS = [[1024, 1536], [1536, 1024], [1472, 1472]];
    const TYPES = [
        { value: 'character', label: '角色' },
        { value: 'style', label: '画风' },
        { value: 'character&style', label: '角色+画风' },
    ];
    const cache = new Map(); // id → dref:<id>

    const list = () => { const n = nai(); if (!Array.isArray(n.dirRefs)) n.dirRefs = []; return n.dirRefs; };
    const supported = (model) => Params.isV45(model);
    const activeOf = (n) => (supported(n.model) ? (n.dirRefs || []).filter((x) => x.on !== false && cache.has(x.id)) : []);
    const round2 = (v) => Math.round(v * 100) / 100;

    async function load(id) {
        if (cache.has(id)) return cache.get(id);
        const d = await Store.get('dref:' + id, null);
        if (d) cache.set(id, d);
        return d;
    }

    Nai.addHook((params, n, p, extra) => {
        const on = activeOf(n);
        if (!on.length) return;
        params.director_reference_images = on.map((x) => cache.get(x.id).image);
        params.director_reference_descriptions = on.map((x) => ({ caption: { base_caption: x.type || 'character', char_captions: [] }, legacy_uc: false }));
        params.director_reference_strength_values = on.map((x) => x.strength);
        params.director_reference_secondary_strength_values = on.map((x) => round2(1 - x.fidelity));
        params.director_reference_information_extracted = on.map(() => 1);
        extra.dirRefs = on.map((x) => ({ name: x.name, type: x.type, strength: x.strength, fidelity: x.fidelity }));
    });

    if (window.Cost && Cost.addExtra) {
        Cost.addExtra((n) => { const k = activeOf(n).length; return k ? { perImage: k * COST, once: 0, label: '角色参考' } : null; });
    }
    const costChanged = () => { if (window.Cost && Cost.refresh) Cost.refresh(); if (window.Vibes) Vibes.render(); };

    // ------------------------------------------------------------
    // 图片处理：按比例挑最接近的尺寸，等比缩放，黑边补满
    // ------------------------------------------------------------
    function readImage(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('读不出这张图')); };
            img.src = url;
        });
    }

    function process(img) {
        const w = img.naturalWidth, h = img.naturalHeight, r = w / h;
        const [tw, th] = TARGETS.reduce((a, b) => (Math.abs(b[0] / b[1] - r) < Math.abs(a[0] / a[1] - r) ? b : a));
        const s = Math.min(tw / w, th / h);
        const dw = Math.round(w * s), dh = Math.round(h * s);
        const c = document.createElement('canvas');
        c.width = tw; c.height = th;
        const g = c.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, tw, th);
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, Math.floor((tw - dw) / 2), Math.floor((th - dh) / 2), dw, dh);
        const t = document.createElement('canvas');
        const ts = 160 / Math.max(w, h);
        t.width = Math.max(1, Math.round(w * ts)); t.height = Math.max(1, Math.round(h * ts));
        t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
        const png = c.toDataURL('image/png');
        return { image: png.slice(png.indexOf(',') + 1), thumb: t.toDataURL('image/jpeg', 0.8), width: tw, height: th };
    }

    async function addFile(f) {
        if (list().length >= MAX) throw new Error('最多 ' + MAX + ' 张');
        const d = process(await readImage(f));
        const id = 'dr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        cache.set(id, d);
        await Store.set('dref:' + id, d);
        list().push({ id, name: String(f.name || '').replace(/\.[^.]+$/, '') || '角色参考', on: true, type: 'character', strength: 1, fidelity: 1 });
        UI.saveSettings();
        render();
        costChanged();
        toast('success', '「' + list()[list().length - 1].name + '」', '已加角色参考');
    }

    // ------------------------------------------------------------
    // 创作页上的卡片（插在画风参考图卡片后面）
    // ------------------------------------------------------------
    let card = null;

    function render() {
        if (!card) return;
        const n = nai(), refs = list(), ok = supported(n.model);
        const on = refs.filter((x) => x.on !== false).length;
        card.innerHTML = '<div class="row"><div class="label grow" style="margin:0">角色参考（精准参考）' + (on ? ' <span class="badge acc">' + on + ' 张</span>' : '')
            + ' <span class="badge">每张 +' + COST + ' Anlas</span></div>'
            + '<button class="btn small" data-a="add"' + (refs.length >= MAX ? ' disabled' : '') + '>加参考</button></div>'
            + '<div class="card-sub">' + (ok
                ? '给一张图，出来的人物长得像它（选「角色」），或者画风像它（选「画风」）。每张参考每出一张图 +' + COST + ' Anlas，Opus 免费额度也不抵。' + (on && (n.vibes || []).some((x) => x.on !== false) ? '<br><b>开着角色参考时，上面的画风参考图（Vibe）会暂停，NAI 不让两个一起用。</b>' : '')
                : '只有 V4.5 能用（V5 官方还没开放），现在的模型出图时不会带上。') + '</div>'
            + refs.map((x, i) => {
                const d = cache.get(x.id);
                return '<div class="vibe-item" data-i="' + i + '">'
                    + '<div class="row">' + (d ? '<img class="vibe-thumb" src="' + esc(d.thumb) + '" alt="">' : '<div class="vibe-thumb"></div>')
                    + '<div class="grow" style="min-width:0"><input type="text" data-f="name" value="' + esc(x.name) + '" placeholder="名字">'
                    + '<div class="seg" style="margin-top:6px">' + TYPES.map((t) => '<button data-type="' + t.value + '"' + (t.value === x.type ? ' class="on"' : '') + '>' + t.label + '</button>').join('') + '</div></div>'
                    + '<label class="switch"><input type="checkbox" data-f="on"' + (x.on !== false ? ' checked' : '') + ' aria-label="启用"><span></span></label></div>'
                    + '<div class="vibe-slider"><span>强度</span><input type="range" min="0" max="1" step="0.05" data-f="strength" value="' + x.strength + '"><b>' + x.strength + '</b></div>'
                    + '<div class="vibe-slider"><span>保真度</span><input type="range" min="0" max="1" step="0.05" data-f="fidelity" value="' + x.fidelity + '"><b>' + x.fidelity + '</b></div>'
                    + '<div class="row" style="justify-content:flex-end"><button class="btn small danger" data-a="del">删除</button></div>'
                    + '</div>';
            }).join('')
            + (refs.length ? '<div class="card-sub">强度：越大越贴近参考图。保真度：越大细节（脸、衣服花纹）越照搬，调低更自由。</div>' : '');
    }

    function bind() {
        card.addEventListener('input', (e) => {
            const f = e.target.dataset.f, box = e.target.closest('[data-i]');
            if (!f || !box) return;
            const x = list()[Number(box.dataset.i)];
            if (f === 'on') { x.on = e.target.checked; UI.saveSettings(); render(); costChanged(); return; }
            if (f === 'name') x.name = e.target.value;
            else { x[f] = round2(Number(e.target.value)); e.target.nextElementSibling.textContent = x[f]; }
            UI.saveSettings();
        });
        card.addEventListener('click', async (e) => {
            const t = e.target.closest('[data-type]');
            if (t) { list()[Number(t.closest('[data-i]').dataset.i)].type = t.dataset.type; UI.saveSettings(); render(); return; }
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'add') {
                const f = await RefPick.pick('加角色参考', '图片', 'image/*');
                if (f) addFile(f).catch((err) => toast('error', err.message || String(err), '加角色参考失败'));
                return;
            }
            const i = Number(b.closest('[data-i]').dataset.i), x = list()[i];
            if (b.dataset.a === 'del') {
                if (!await UI.confirmBox('删除角色参考「' + x.name + '」？', '', '删除', true)) return;
                list().splice(i, 1);
                UI.saveSettings();
                cache.delete(x.id);
                await Store.del('dref:' + x.id);
                render();
                costChanged();
            }
        });
    }

    async function mount() {
        for (const x of list()) await load(x.id).catch(() => null);
        const result = $('#c-result');
        if (!result) return;
        card = document.createElement('div');
        card.className = 'card';
        card.id = 'c-dirrefs';
        result.parentNode.insertBefore(card, result);
        bind();
        render();
        if (window.Vibes) Vibes.render();
    }

    const init = CreatePage.init, refresh = CreatePage.refresh;
    let lastModel = null;
    CreatePage.init = async function () { await init.apply(this, arguments); await mount(); lastModel = nai().model; };
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        if (nai().model !== lastModel) { lastModel = nai().model; render(); }
    };

    window.DirectorRef = {
        /** V4.5 下开着角色参考 → 参考图（Vibe）不发 */
        blocksVibes: (n) => activeOf(n).length > 0,
        cost: (n) => activeOf(n).length * COST,
        addFile, load, render, process,
    };
})();
