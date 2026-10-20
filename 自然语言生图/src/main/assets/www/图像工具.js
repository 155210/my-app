/*
 * 图像工具.js —— NAI 官方 4 倍放大、6 个图像工具（Director Tools）、处理前后对比、大图上的快捷按钮
 *
 * 接口照 NAIWeaver 的 novel_ai_service.dart：
 *   放大：POST {api}/ai/upscale { image, width, height, scale }，输出每边不超过 4096，超了就退到 2 倍；返回 zip
 *     官方站放大还在 api.novelai.net，不行再试 image.novelai.net
 *   图像工具：POST {image}/ai/augment-image { image, width, height, req_type, defry?, prompt? }，返回 zip
 *     req_type：bg-removal 去背景 / lineart 线稿 / sketch 草图 / colorize 上色 / emotion 换表情 / declutter 去杂物
 *     上色、换表情可以带 prompt 和 defry（0~5，越大越接近原图）；换表情的 prompt = 「表情;;补充说明」
 * 结果都存进图库，配方 meta 照原图抄一份，加 meta.edit = { kind, label, from }，「对比原图」靠 from。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const nai = () => UI.settings.nai;
    const E = ImgEdit;

    const TOOLS = [
        { k: 'bg-removal', label: '去背景', help: '把人物抠出来，背景变透明' },
        { k: 'lineart', label: '线稿', help: '提取干净的线稿' },
        { k: 'sketch', label: '草图', help: '变成铅笔草图的样子' },
        { k: 'colorize', label: '上色', help: '给线稿 / 草图上色，可以写想要的颜色', prompt: true },
        { k: 'emotion', label: '换表情', help: '人物换一种表情，别的不变', prompt: true },
        { k: 'declutter', label: '去杂物', help: '去掉文字、对话框、多余的小东西' },
    ];
    const TOOL_LABEL = Object.fromEntries(TOOLS.map((t) => [t.k, t.label]));

    // 换表情 24 种（顺序同官网）
    const MOODS = [
        ['neutral', '平静'], ['happy', '开心'], ['sad', '难过'], ['angry', '生气'], ['scared', '害怕'], ['surprised', '惊讶'],
        ['tired', '疲惫'], ['excited', '兴奋'], ['nervous', '紧张'], ['thinking', '思考'], ['confused', '困惑'], ['shy', '害羞'],
        ['disgusted', '嫌弃'], ['smug', '得意'], ['bored', '无聊'], ['laughing', '大笑'], ['irritated', '烦躁'], ['aroused', '动情'],
        ['embarrassed', '难为情'], ['worried', '担心'], ['love', '爱慕'], ['determined', '坚定'], ['hurt', '受伤'], ['playful', '调皮'],
    ];

    const ICON = {
        edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
        enhance: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
        up: '<svg viewBox="0 0 24 24"><path d="M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7"/></svg>',
        bg: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/></svg>',
        tools: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
        cmp: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20"/></svg>',
    };

    // ------------------------------------------------------------
    // 花费
    // ------------------------------------------------------------
    const UPSCALE_MAX_SIDE = 4096;
    /** 放大倍数：4 倍超了每边 4096 就退到 2 倍，还超返回 0 */
    const upScale = (w, h) => (w * 4 <= UPSCALE_MAX_SIDE && h * 4 <= UPSCALE_MAX_SIDE ? 4 : w * 2 <= UPSCALE_MAX_SIDE && h * 2 <= UPSCALE_MAX_SIDE ? 2 : 0);

    /** 放大只收 ≤ 1024×1024 像素量的图，超了返回 -1 */
    function upscaleCost(w, h) {
        if (window.Cost && Cost.upscale) return Cost.upscale(w, h);
        return w * h <= 1048576 ? 1 : -1;
    }
    function toolCost(k, w, h) {
        if (window.Cost && Cost.tool) return Cost.tool(k, w, h);
        const base = E.genCost(w, h, 28, 1);
        return k === 'bg-removal' ? base * 3 + 5 : base;
    }

    /** 精修默认那一档：1.5 倍（超了上限就 1 倍），强度 0.5，同编辑页默认 */
    function enhanceCost(w, h) {
        const r = (x) => Math.max(64, Math.round(x / 64) * 64);
        const k = r(w * 1.5) * r(h * 1.5) <= E.MAX_PIXELS ? 1.5 : 1;
        return E.Price.enhance(nai(), r(w * k), r(h * k), 0.5, false);
    }

    // ------------------------------------------------------------
    // 请求
    // ------------------------------------------------------------
    async function post(urls, body, label, signal) {
        let last = null;
        for (const url of urls) {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(nai().key || '').trim() },
                body: JSON.stringify(body),
                signal,
            });
            if (r.ok) return Nai.unzipFirstImage(await r.arrayBuffer());
            const t = (await r.text().catch(() => '')).trim();
            let detail = t;
            try { const j = JSON.parse(t); if (typeof j.message === 'string') detail = j.message; } catch (e) { /* 原文 */ }
            const err = new Error(r.status === 401 ? label + '：NAI 的 Key 不对或已失效'
                : r.status === 402 ? label + '：需要有效的 NAI 订阅（402）'
                    : r.status === 429 ? label + '：请求太频繁（429），稍等一会再试'
                        : label + '失败（' + r.status + '）：' + detail.slice(0, 200));
            err.status = r.status;
            last = err;
            if (![404, 405].includes(r.status)) break; // 只有「没这个接口」才换下一个地址
        }
        throw last;
    }

    const isOfficial = (url) => /\/\/image\.novelai\.net\/?$/i.test(String(url || '').trim());

    function checkKey() {
        if (String(nai().key || '').trim()) return true;
        toast('warning', '请先在设置里填 NAI 的 Key');
        return false;
    }

    const typeOf = (ext) => (ext === 'jpg' ? 'image/jpeg' : 'image/' + ext);

    /** 4 倍放大（太大就 2 倍） */
    async function upscale(item) {
        if (!checkKey()) return null;
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '这张图的文件找不到了'); return null; }
        const img = await E.loadImg(blob);
        const w = img.naturalWidth, h = img.naturalHeight, s = upScale(w, h);
        if (!s || upscaleCost(w, h) < 0) { toast('warning', '这张图已经很大了（' + w + '×' + h + '），官方放大只收 1024×1024 像素以内的图；可以用「精修」放大'); return null; }
        const image = E.pngB64(img, w, h);
        const n = nai();
        const urls = isOfficial(n.url) ? ['https://api.novelai.net/ai/upscale', 'https://image.novelai.net/ai/upscale'] : [Nai.endpoint(n.url, 'upscale')];
        const label = s + ' 倍放大';
        return E.queue(label + '：' + w + '×' + h + ' → ' + w * s + '×' + h * s, item, async (signal) => {
            const out = await post(urls, { image, width: w, height: h, scale: s }, label, signal);
            window.dispatchEvent(new CustomEvent('nai-drawn', { detail: {} }));
            return { blob: new Blob([out.bytes], { type: typeOf(out.ext) }), ext: out.ext,
                meta: Object.assign({}, item.meta, { width: w * s, height: h * s, edit: { kind: 'upscale', label, from: item.id, scale: s } }) };
        }, (res) => compare(item, res));
    }

    /** 图像工具；opt: { prompt, defry, mood } */
    async function augment(item, k, opt) {
        if (!checkKey()) return null;
        opt = opt || {};
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '这张图的文件找不到了'); return null; }
        const img = await E.loadImg(blob);
        const w = img.naturalWidth, h = img.naturalHeight;
        const body = { req_type: k, width: w, height: h, image: E.pngB64(img, w, h) };
        let label = TOOL_LABEL[k];
        if (k === 'emotion') {
            const mood = opt.mood || 'neutral';
            body.prompt = mood + ';;' + String(opt.prompt || '').trim();
            body.defry = opt.defry || 0;
            label += '（' + (MOODS.find((x) => x[0] === mood) || [0, mood])[1] + '）';
        } else if (k === 'colorize') {
            body.prompt = String(opt.prompt || '').trim();
            body.defry = opt.defry || 0;
        }
        const edit = { kind: k, label, from: item.id };
        if (body.prompt) edit.prompt = body.prompt;
        if (body.defry != null) edit.defry = body.defry;
        return E.queue(label, item, async (signal) => {
            const out = await post([Nai.endpoint(nai().url, 'augment-image')], body, label, signal);
            window.dispatchEvent(new CustomEvent('nai-drawn', { detail: {} }));
            return { blob: new Blob([out.bytes], { type: typeOf(out.ext) }), ext: out.ext, meta: Object.assign({}, item.meta, { width: w, height: h, edit }) };
        }, (res) => compare(item, res));
    }

    // ------------------------------------------------------------
    // 工具面板
    // ------------------------------------------------------------
    async function openTools(item) {
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '这张图的文件找不到了'); return; }
        const { width: w, height: h } = await E.sizeOf(item, blob);
        const s = upScale(w, h) && upscaleCost(w, h) >= 0 ? upScale(w, h) : 0, z = E.fitSize(w, h);
        const row = (k, label, help, c) => '<button class="menu-item tool-item" data-k="' + k + '"><span class="grow"><b>' + esc(label) + '</b><small>' + esc(help) + '</small></span><span class="badge">' + esc(c) + '</span></button>';
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>图像工具</h3>'
            + row('edit', '图生图', '照这张图重画，可以改提示词（强度 0.7 时）', E.Price.label(E.Price.img2img(nai(), z.width, z.height, 0.7)))
            + row('infill', '局部重绘', '手指涂出要重画的地方（强度 1 时）', E.Price.label(E.Price.img2img(nai(), z.width, z.height, 1)))
            + row('enhance', '精修放大', '放大 1.5 / 2 倍再细化，V5 有 MAX（1.5 倍时）', E.Price.label(enhanceCost(w, h)))
            + row('upscale', s ? s + ' 倍放大' : '放大', s ? '官方放大，' + w + '×' + h + ' → ' + w * s + '×' + h * s : '这张太大了（超过 1024×1024），官方放大不收，用精修', s ? E.Price.label(upscaleCost(w, h)) : '—')
            + TOOLS.map((t) => row(t.k, t.label, t.help, E.Price.label(toolCost(t.k, w, h)))).join('')
            + '<div class="card-sub">花费是按官网规则估的，实际以 NAI 扣的为准。</div>');
        L.box.onclick = (e) => {
            const b = e.target.closest('[data-k]'); if (!b) return;
            const k = b.dataset.k;
            UI.closeLayer(L);
            if (k === 'edit') E.openEditor(item, 'img2img');
            else if (k === 'infill') E.openEditor(item, 'infill');
            else if (k === 'enhance') E.openEditor(item, 'enhance');
            else if (k === 'upscale') upscale(item);
            else if (k === 'emotion' || k === 'colorize') askTool(item, k, w, h);
            else augment(item, k).then((j) => { if (j) toast('info', '已排进队列：' + TOOL_LABEL[k]); });
        };
    }

    const last = { mood: 'happy', emotionPrompt: '', colorPrompt: '', defry: 0 };

    /** 换表情 / 上色：先选参数 */
    function askTool(item, k, w, h) {
        const emo = k === 'emotion';
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>' + TOOL_LABEL[k] + '</h3>'
            + (emo ? '<div class="label">选一种表情</div><div class="mood-grid">' + MOODS.map((m) => '<button data-m="' + m[0] + '" class="' + (m[0] === last.mood ? 'on' : '') + '">' + m[1] + '</button>').join('') + '</div>' : '')
            + '<div class="field"><label>' + (emo ? '补充说明（英文，可不写，比如 blush, tears）' : '想要的颜色（英文，可不写，比如 blue dress, silver hair）') + '</label>'
            + '<input type="text" data-p value="' + esc(emo ? last.emotionPrompt : last.colorPrompt) + '"></div>'
            + '<div class="vibe-slider"><span>保留原样</span><input type="range" min="0" max="5" step="1" data-d value="' + last.defry + '"><b>' + last.defry + '</b></div>'
            + '<div class="card-sub">0 改得最多，5 最接近原图。</div>'
            + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-go>开始</button></div>');
        Price_tag($('[data-go]', L.box), toolCost(k, w, h));
        L.box.addEventListener('click', (e) => {
            const m = e.target.closest('[data-m]');
            if (m) { last.mood = m.dataset.m; UI.$$('[data-m]', L.box).forEach((b) => b.classList.toggle('on', b === m)); }
        });
        $('[data-d]', L.box).oninput = (e) => { e.target.nextElementSibling.textContent = e.target.value; };
        $('[data-go]', L.box).onclick = () => {
            const prompt = $('[data-p]', L.box).value;
            last.defry = Number($('[data-d]', L.box).value) || 0;
            if (emo) last.emotionPrompt = prompt; else last.colorPrompt = prompt;
            UI.closeLayer(L);
            augment(item, k, { mood: last.mood, prompt, defry: last.defry }).then((j) => { if (j) toast('info', '已排进队列：' + TOOL_LABEL[k]); });
        };
    }
    const Price_tag = (b, v) => E.Price.tag(b, v);

    // ------------------------------------------------------------
    // 处理前后对比：左右拖动分界线
    // ------------------------------------------------------------
    async function compare(before, after) {
        const [b1, b2] = await Promise.all([Gallery.getBlob(before.id), Gallery.getBlob(after.id)]);
        if (!b1 || !b2) { toast('warning', '原图或结果找不到了，没法对比'); return; }
        const u1 = URL.createObjectURL(b1), u2 = URL.createObjectURL(b2);
        const e = (after.meta && after.meta.edit) || {};
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>对比：' + esc(e.label || '处理') + '前后</b></div>'
            + '<div class="viewer"><div class="cmp" data-cmp><img src="' + u2 + '" alt="" draggable="false"><img class="cmp-before" src="' + u1 + '" alt="" draggable="false">'
            + '<div class="cmp-line"><i></i></div><span class="cmp-tag l">处理前</span><span class="cmp-tag r">处理后</span></div>'
            + '<div class="v-tip">左右拖动看前后区别</div>'
            + '<div class="acts big"><button data-a="view">' + ICON.cmp + '看结果大图</button><button data-a="save">' + UI.ICON.save + '保存结果</button>'
            + '<button data-a="more">' + ICON.tools + '继续处理</button></div></div>',
        { onClose: () => { URL.revokeObjectURL(u1); URL.revokeObjectURL(u2); } });
        const box = $('[data-cmp]', L.box), top = $('.cmp-before', L.box), line = $('.cmp-line', L.box);
        const set = (pct) => {
            pct = Math.max(0, Math.min(100, pct));
            top.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
            line.style.left = pct + '%';
        };
        set(50);
        let drag = false;
        const at = (ev) => { const r = box.getBoundingClientRect(); set((ev.clientX - r.left) / r.width * 100); };
        box.addEventListener('pointerdown', (ev) => { drag = true; try { box.setPointerCapture(ev.pointerId); } catch (_) { /* 合成事件 */ } at(ev); });
        box.addEventListener('pointermove', (ev) => { if (drag) at(ev); });
        ['pointerup', 'pointercancel'].forEach((n) => box.addEventListener(n, () => { drag = false; }));
        $('.acts', L.box).onclick = async (ev) => {
            const b = ev.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'view') GalleryPage.openViewer(after.id);
            if (b.dataset.a === 'save') { try { toast('success', await Gallery.saveToPhone(after), '已保存'); } catch (err) { toast('error', err.message, '保存失败'); } }
            if (b.dataset.a === 'more') openTools(after);
        };
        return L;
    }

    /** 这张是处理出来的、原图还在 → 原图那一项 */
    async function sourceOf(item) {
        const f = item.meta && item.meta.edit && item.meta.edit.from;
        if (!f) return null;
        return (await Gallery.list()).find((x) => x.id === f) || null;
    }

    // ------------------------------------------------------------
    // 大图上的快捷按钮（每个都标花费）
    // ------------------------------------------------------------
    async function decorate(btn, item, fn) {
        try {
            const blob = await Gallery.getBlob(item.id);
            const { width, height } = await E.sizeOf(item, blob);
            E.Price.tag(btn, fn(width, height));
        } catch (e) { /* 算不出就不标 */ }
    }

    if (window.GalleryPage && GalleryPage.addViewerAction) {
        GalleryPage.addViewerAction({ id: 'edit', label: '编辑', icon: ICON.edit, run: (item) => E.openEditor(item, 'img2img'),
            decorate: (b, item) => decorate(b, item, (w, h) => { const z = E.fitSize(w, h); return E.Price.img2img(nai(), z.width, z.height, 0.7); }) });
        GalleryPage.addViewerAction({ id: 'enhance', label: '精修', icon: ICON.enhance, run: (item) => E.openEditor(item, 'enhance'),
            decorate: (b, item) => decorate(b, item, enhanceCost) });
        GalleryPage.addViewerAction({ id: 'upscale', label: '放大', icon: ICON.up, run: (item) => upscale(item).then((j) => { if (j) toast('info', '已排进队列：放大'); }),
            decorate: (b, item) => decorate(b, item, (w, h) => (upScale(w, h) ? upscaleCost(w, h) : null)) });
        GalleryPage.addViewerAction({ id: 'bg', label: '去背景', icon: ICON.bg, run: (item) => augment(item, 'bg-removal').then((j) => { if (j) toast('info', '已排进队列：去背景'); }),
            decorate: (b, item) => decorate(b, item, (w, h) => toolCost('bg-removal', w, h)) });
        GalleryPage.addViewerAction({ id: 'tools', label: '工具', icon: ICON.tools, run: (item) => openTools(item) });
        GalleryPage.addViewerAction({ id: 'cmp', label: '对比原图', icon: ICON.cmp, show: (item) => !!(item.meta && item.meta.edit && item.meta.edit.from),
            run: async (item) => { const s = await sourceOf(item); if (s) compare(s, item); else toast('warning', '原图已经删掉了'); } });
    }

    const css = document.createElement('style');
    css.textContent = [
        '.v-quick { margin-top: 0 !important; overflow-x: auto; }',
        '.v-quick button { flex: 1 0 auto; }',
        '.tool-item { gap: 10px; }',
        '.tool-item b { display: block; font-weight: 500; }',
        '.tool-item small { display: block; font-size: 12px; color: var(--faint); margin-top: 2px; }',
        '.mood-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 0 0 14px; }',
        '.mood-grid button { border: 1px solid var(--line); background: none; border-radius: 10px; padding: 7px 0; color: var(--dim); }',
        '.mood-grid button.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }',
        '.cmp { position: relative; flex: 1; min-height: 0; background: #000; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; }',
        '.cmp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none;',
        '  background: repeating-conic-gradient(#2a2a2a 0 25%, #1c1c1c 0 50%) 0 0 / 16px 16px; }',
        '.cmp-line { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; pointer-events: none; box-shadow: 0 0 4px rgba(0,0,0,.6); }',
        '.cmp-line i { position: absolute; top: 50%; left: -13px; width: 28px; height: 28px; margin-top: -14px; border-radius: 50%; background: #fff; box-shadow: 0 0 6px rgba(0,0,0,.5); }',
        '.cmp-tag { position: absolute; top: 8px; font-size: 12px; padding: 2px 8px; border-radius: 8px; background: rgba(0,0,0,.55); color: #fff; pointer-events: none; }',
        '.cmp-tag.l { left: 8px; } .cmp-tag.r { right: 8px; }',
    ].join('\n');
    document.head.appendChild(css);

    // 帮助 / 首次提示（有 Help 才加）
    if (window.Help && Help.add) {
        const G = '图生图与编辑';
        [
            { id: 'i2i-base', title: '底图（图生图）', text: '创作页「底图」卡片：从图库选一张，开着时点「出图」就照这张的构图和颜色重画。强度越大越不像底图。', tip: '选一张图当底图，出图就照着它重画', target: '#c-i2i', anlas: '按出图尺寸 × 强度算，有底图时 Opus 也不免费' },
            { id: 'i2i-edit', title: '编辑（图生图）', text: '大图下面「编辑」：照这张图重画，可以改提示词，强度 0.5～0.7 常用。', target: '[data-q="edit"]', anlas: '按出图尺寸 × 强度算' },
            { id: 'i2i-infill', title: '局部重绘', text: '编辑页的「局部重绘」：用手指把要重画的地方涂上，没涂的地方保持原样。可以切「擦」、调笔刷大小、撤销、清空。', anlas: '按出图尺寸 × 强度算' },
            { id: 'i2i-enhance', title: '精修放大', text: '大图下面「精修」：把图放大 1.5 / 2 倍后再细化一遍，画面基本不变。V5 多一个 MAX，服务器直接放到最大。', target: '[data-q="enhance"]', anlas: '按放大后的尺寸 × 强度算；MAX 再 ×1.46，Opus 也扣' },
            { id: 'i2i-upscale', title: '4 倍放大', text: '大图下面「放大」：NAI 官方放大，只收 1024×1024 像素以内的图，放大 4 倍（超过 4096 就 2 倍）。', target: '[data-q="upscale"]', anlas: true },
            { id: 'i2i-tools', title: '图像工具', text: '大图下面「工具」：去背景、线稿、草图、上色、换表情（24 种）、去杂物，每行右边是花费。', target: '[data-q="tools"]', anlas: '去背景 = 3 × 价 + 5，Opus 也扣；其他按图大小算' },
            { id: 'i2i-ai', title: '编辑页让 AI 写提示词', text: '编辑页上面写中文：图生图写想要的画面，局部重绘写涂掉的地方要画成什么，点「AI 写提示词」。「AI 重写」照现在的提示词重写，可以附一句要求。画风模板在编辑页单独选，不影响创作页。', target: '[data-ai="write"]' },
            { id: 'i2i-seam', title: '局部重绘不割裂', text: '重画完会把结果贴回原图：没涂的地方一个像素不动，交界处按「边缘过渡」慢慢过渡。原图本身糊的话可以勾「画之前先把整张图变清晰」（整张会变，真人照片不建议）或「画完再整体精修一遍」（默认只融合涂的周围，脸不动）。', anlas: '每多勾一项多花一次精修的 Anlas，按钮上是加起来的' },
            { id: 'style-blank', title: '空白画风模板', text: '画风模板里有一套「空白（不加任何词）」：画师串、质量词、负面提示词全都不加，只发你自己写的标签。' },
            { id: 'i2i-compare', title: '前后对比', text: '处理完自动打开对比页，左右拖白线看前后区别。处理出的图在大图下面有「对比原图」。' },
        ].forEach((h) => Help.add(Object.assign({ group: G }, h)));
    }

    window.ImgTools = { upscale, augment, openTools, compare, upScale, upscaleCost, toolCost, TOOLS, MOODS };
})();
