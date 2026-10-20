/*
 * 图生图.js —— 图生图 / 局部重绘 / 精修放大（都走 /ai/generate-image），外加共用的图片小工具和 Anlas 预估
 *
 * 请求格式照 NAIWeaver 的 nai_request_builder.dart：
 *   图生图：action 'img2img'，parameters 加 image（底图 PNG base64，尺寸 = 出图尺寸）、strength、noise、extra_noise_seed
 *   局部重绘：action 'infill'，model 换成 xxx-inpainting（V5 Curated 官方还没有，借 V4.5 Curated 的），再加 mask（黑底白涂，按 8×8 格对齐）
 *   精修（Enhance）：就是把原图放大 1 / 1.5 / 2 倍再图生图一次；V5 的 MAX：按原尺寸发，加 upscaled_enhance，服务器放到 314 万像素上限
 * 出图时在 p 里放 i2i：{ image, mask?, width, height, strength, noise, kind, from, max?, raw? }，
 *   本文件的 Nai.addHook / Nai.addBodyHook 把它写进请求；raw = { positive, negative } 时照原样发（精修用原图那套提示词）。
 * 创作页的「底图」卡片：p.i2iRef = { id 图库里那张, strength, noise }，真出图前（包一层 Nai.generate）才读图编码。
 * 出的图配方里记 meta.edit = { kind, label, from, strength, noise, … }，大图的「对比原图」靠 from 找回原图。
 *
 * Anlas 预估：有 window.Cost（计价.js）就用它，没有就用这里的公式兜底（同 NAIWeaver 的 nai_cost_estimator）。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const nai = () => UI.settings.nai;
    const MAX_PIXELS = 3145728;           // NAI V4 起单张像素上限
    const KIND_LABEL = { img2img: '图生图', infill: '局部重绘', enhance: '精修放大' };

    // ------------------------------------------------------------
    // 图片小工具
    // ------------------------------------------------------------
    function loadImg(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('读不出这张图')); };
            img.src = url;
        });
    }

    const r64 = (n) => Math.max(64, Math.round(n / 64) * 64);

    /** 宽高取 64 的倍数，超过 cap 像素就按比例缩 */
    function fitSize(w, h, cap) {
        const s = Math.min(1, Math.sqrt((cap || MAX_PIXELS) / (w * h)));
        let W = r64(w * s), H = r64(h * s);
        while (W * H > (cap || MAX_PIXELS)) { if (W >= H) W -= 64; else H -= 64; }
        return { width: W, height: H };
    }

    function canvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }
    const dataPart = (u) => u.slice(u.indexOf(',') + 1);

    /** 画到 w×h（白底，去透明）转 PNG base64 */
    function pngB64(img, w, h) {
        const c = canvas(w, h), g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, w, h);
        return dataPart(c.toDataURL('image/png'));
    }
    /** 原样（保留透明）转 PNG base64，不缩放 */
    function rawB64(img) {
        const c = canvas(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0);
        return dataPart(c.toDataURL('image/png'));
    }

    /**
     * 涂好的遮罩（任意大小的 canvas，涂过的地方不透明）→ NAI 要的黑底白涂 PNG，按 8×8 格对齐（同 NAIWeaver / ComfyUI）
     * 返回 { b64, any }，any = 涂了没有
     */
    function maskB64(src, w, h) {
        const gw = Math.ceil(w / 8), gh = Math.ceil(h / 8);
        const small = canvas(gw, gh), sg = small.getContext('2d');
        sg.imageSmoothingEnabled = true;
        sg.drawImage(src, 0, 0, gw, gh);
        const a = sg.getImageData(0, 0, gw, gh).data;
        const out = canvas(w, h), g = out.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff';
        let any = false;
        for (let y = 0; y < gh; y++) {
            for (let x = 0; x < gw; x++) {
                if (a[(y * gw + x) * 4 + 3] > 8) { any = true; g.fillRect(x * 8, y * 8, 8, 8); }
            }
        }
        return { b64: dataPart(out.toDataURL('image/png')), any };
    }

    /** 图库那一张的宽高：配方里有就用，没有就解图 */
    async function sizeOf(item, blob) {
        const m = item.meta || {};
        if (m.width && m.height && !item.origExt) return { width: m.width, height: m.height };
        const img = await loadImg(blob || await Gallery.getBlob(item.id));
        return { width: img.naturalWidth, height: img.naturalHeight };
    }

    // ------------------------------------------------------------
    // Anlas 预估（有 Cost 用 Cost）
    // ------------------------------------------------------------
    function genCost(w, h, steps, strength) {
        const area = Math.max(1, w) * Math.max(1, h);
        const raw = 2.951823174884865e-6 * area + 5.753298233447344e-7 * area * steps;
        return Math.max(Math.ceil(Math.ceil(raw) * strength), 2);
    }
    const Price = {
        /** 图生图 / 局部重绘：按出图尺寸、强度打折，有底图时 Opus 也不免费 */
        img2img(n, w, h, strength) {
            const steps = Number(n.steps) || 28;
            if (window.Cost && Cost.enhance) return Cost.enhance({ width: w, height: h, model: n.model, steps, scale: 1, strength });
            return genCost(w, h, steps, strength);
        },
        /** 精修：按输出尺寸算；MAX 再乘 1.46（NAIWeaver 实测拟合，Opus 也扣） */
        enhance(n, outW, outH, strength, max) {
            // MAX 按 NAIWeaver 实测（V5 Full 四次都对得上）：普通价 × 强度 × 1.46，不再乘 V5 的 1.5，也不受 140 上限
            if (max) return genCost(outW, outH, Number(n.steps) || 28, strength * 1.46);
            return Price.img2img(n, outW, outH, strength);
        },
        label(v) {
            if (window.Cost && Cost.label) return Cost.label(v);
            return v == null ? '' : v < 0 ? '超出范围' : v === 0 ? '免费' : '约 ' + v + ' Anlas';
        },
        /** 按钮上挂小标记 */
        tag(btn, v) {
            if (!btn) return;
            if (window.Cost && Cost.tag) { Cost.tag(btn, v); return; }
            let s = btn.querySelector('.cost-tag');
            if (!s) { s = document.createElement('small'); s.className = 'cost-tag'; btn.appendChild(s); }
            s.textContent = v == null ? '' : v < 0 ? '超限' : v === 0 ? '免费' : '约 ' + v;
        },
    };

    // ------------------------------------------------------------
    // 写进请求
    // ------------------------------------------------------------
    /** 局部重绘用的模型；V5 Curated 官方还没有 inpainting，借 V4.5 Curated 的（同官网） */
    function inpaintModel(model) {
        const m = String(model);
        if (m.includes('nai-diffusion-5-curated')) return 'nai-diffusion-4-5-curated-inpainting';
        return m.endsWith('-inpainting') ? m : m + '-inpainting';
    }

    Nai.addHook((params, n, p, extra) => {
        const e = p && p.i2i;
        if (!e) return;
        params.width = e.width;
        params.height = e.height;
        if (params.skip_cfg_above_sigma != null) {
            params.skip_cfg_above_sigma = Math.pow((e.width * e.height) / 1011712, 0.5) * (Params.isV45(n.model) ? 58 : 19);
        }
        if (e.raw) {
            if (params.v4_prompt) params.v4_prompt.caption.base_caption = e.raw.positive;
            params.negative_prompt = e.raw.negative;
            if (params.v4_negative_prompt) params.v4_negative_prompt.caption.base_caption = e.raw.negative;
            extra.positive = e.raw.positive;
            extra.negative = e.raw.negative;
        }
        params.image = e.image;
        params.strength = e.strength;
        params.add_original_image = true;
        if (e.mask) {
            params.mask = e.mask;
            params.inpaintImg2ImgStrength = e.strength;
        } else {
            params.noise = e.noise || 0;
            params.extra_noise_seed = params.seed;
            if (e.max) params.upscaled_enhance = true;
        }
        extra.width = e.width;
        extra.height = e.height;
        extra.edit = Object.assign({ kind: e.kind, label: KIND_LABEL[e.kind] || e.kind, from: e.from || '', strength: e.strength },
            e.mask ? {} : { noise: e.noise || 0 }, e.max ? { max: true } : {}, e.scale ? { scale: e.scale } : {});
    });

    Nai.addBodyHook((body, n, p) => {
        const e = p && p.i2i;
        if (!e) return;
        if (e.raw) body.input = e.raw.positive;
        if (e.mask) { body.action = 'infill'; body.model = inpaintModel(body.model); } else body.action = 'img2img';
    });

    /** 图库那一张 → i2i（底图按 size 缩放；没给 size 用原图尺寸取 64 的倍数） */
    async function makeI2i(id, opt) {
        const item = (await Gallery.list()).find((x) => x.id === id);
        const blob = item && await Gallery.getBlob(id);
        if (!blob) throw new Error('底图在图库里找不到了，重新选一张');
        const img = await loadImg(blob);
        const size = opt.size || fitSize(img.naturalWidth, img.naturalHeight);
        return Object.assign({ image: pngB64(img, size.width, size.height), width: size.width, height: size.height, from: id }, opt.i2i);
    }

    // 创作页底图：真出图前才读图（排队时只记 id）
    const generate = Nai.generate;
    Nai.generate = async function (n, p, signal) {
        if (p && p.i2iRef && !p.i2i) {
            const r = p.i2iRef;
            p = Object.assign({}, p, { i2i: await makeI2i(r.id, { i2i: { kind: 'img2img', strength: r.strength, noise: r.noise } }) });
        }
        return generate.call(this, n, p, signal);
    };

    // ------------------------------------------------------------
    // 排进队列、存进图库
    // ------------------------------------------------------------
    /**
     * 排一张编辑任务；work(signal) 返回 { blob, ext, meta }，出好的存进图库（文字字段照原图）
     * 返回图库那一项的 Promise
     */
    function queue(label, src, work, after) {
        const job = Queue.add(async (signal) => {
            const out = await work(signal);
            return Gallery.add(out.blob, out.ext, {
                desc: src.desc || '', tag: src.tag || '', nl: src.nl || '', extraNegative: src.extraNegative || '', meta: out.meta,
            });
        }, { label, retry: () => queue(label, src, work, after) });
        job.then((item) => {
            if (window.GalleryPage) GalleryPage.refresh();
            toast('success', label, '好了，已存进图库');
            if (after) after(item);
        }).catch((e) => { if (e.name !== 'AbortError') toast('error', e.message || String(e), label + '失败'); });
        return job;
    }

    /** 走 generate-image 的编辑：p 是提示词那几格 + i2i */
    function queueGenerate(n, label, src, p, after) {
        return queue(label, src, (signal) => Nai.generate(n, p, signal), after);
    }

    // ------------------------------------------------------------
    // 编辑页：图生图 / 局部重绘 / 精修放大
    // ------------------------------------------------------------
    const ED = { img2img: { strength: 0.7, noise: 0 }, infill: { strength: 1 }, enhance: { strength: 0.5, noise: 0, scale: 1.5 }, brush: 48 };

    /**
     * 打开编辑页
     * item：图库那一张；mode：'img2img' | 'infill' | 'enhance'
     */
    async function openEditor(item, mode) {
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '这张图的文件找不到了'); return; }
        const img = await loadImg(blob);
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const base = fitSize(sw, sh);                 // 图生图 / 重绘的出图尺寸
        const url = URL.createObjectURL(blob);
        mode = mode || 'img2img';
        const m = item.meta || {};
        const st = { tag: item.tag || '', nl: item.nl || '', negative: item.extraNegative || '' };

        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>编辑这张图</b></div>'
            + '<div class="tabs" data-modes>' + Object.keys(KIND_LABEL).map((k) => '<button data-m="' + k + '">' + KIND_LABEL[k] + '</button>').join('') + '</div>'
            + '<div class="page-body">'
            + '<div class="ed-stage" data-stage><img data-img alt="" draggable="false" src="' + url + '"><canvas data-mask></canvas></div>'
            + '<div data-ctl></div></div>',
        { onClose: () => URL.revokeObjectURL(url) });
        const stage = $('[data-stage]', L.box), view = $('[data-img]', L.box), mk = $('[data-mask]', L.box), ctl = $('[data-ctl]', L.box);
        mk.width = base.width; mk.height = base.height;
        const mg = mk.getContext('2d');
        const undo = [];

        // 遮罩画布盖在图片实际显示的位置上
        function place() {
            const W = stage.clientWidth, H = stage.clientHeight;
            const s = Math.min(W / sw, H / sh);
            const w = sw * s, h = sh * s;
            Object.assign(mk.style, { left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px', width: w + 'px', height: h + 'px' });
        }
        requestAnimationFrame(place);
        window.addEventListener('resize', place);
        const prevClose = L.onClose;
        L.onClose = () => { window.removeEventListener('resize', place); prevClose(); };

        // ---- 手指涂遮罩 ----
        let painting = null, erase = false;
        const toCanvas = (e) => {
            const r = mk.getBoundingClientRect();
            return { x: (e.clientX - r.left) / r.width * mk.width, y: (e.clientY - r.top) / r.height * mk.height };
        };
        const dot = (a, b) => {
            mg.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
            mg.strokeStyle = mg.fillStyle = '#e2a65b';
            mg.lineCap = mg.lineJoin = 'round';
            mg.lineWidth = ED.brush * 2;
            mg.beginPath();
            mg.moveTo(a.x, a.y);
            mg.lineTo(b.x, b.y);
            mg.stroke();
        };
        mk.addEventListener('pointerdown', (e) => {
            if (mode !== 'infill' || painting) return;
            try { mk.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件 */ }
            undo.push(mg.getImageData(0, 0, mk.width, mk.height));
            if (undo.length > 20) undo.shift();
            const p = toCanvas(e);
            painting = { id: e.pointerId, last: p };
            dot(p, p);
            e.preventDefault();
        });
        mk.addEventListener('pointermove', (e) => {
            if (!painting || painting.id !== e.pointerId) return;
            const p = toCanvas(e);
            dot(painting.last, p);
            painting.last = p;
        });
        const stop = (e) => { if (painting && painting.id === e.pointerId) { painting = null; renderCost(); } };
        mk.addEventListener('pointerup', stop);
        mk.addEventListener('pointercancel', stop);

        function prompts() {
            if (mode === 'enhance') {
                return '<div class="card-sub">精修照这张图原来那套提示词，把图放大后再细化一遍，画面基本不变。</div>';
            }
            return '<div class="field"><label>正面提示词（英文标签）</label><textarea class="ta small" data-f="tag">' + esc(st.tag) + '</textarea></div>'
                + (Params.supportsNl(nai().model) && nai().naturalLanguage ? '<div class="field"><label>英文画面描述</label><textarea class="ta small" data-f="nl">' + esc(st.nl) + '</textarea></div>' : '')
                + '<div class="field"><label>补充负面词</label><textarea class="ta small" data-f="negative">' + esc(st.negative) + '</textarea></div>';
        }
        const slider = (label, f, min, max, step, v) => '<div class="vibe-slider"><span>' + label + '</span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" data-s="' + f + '" value="' + v + '"><b>' + v + '</b></div>';

        const v5 = () => Params.isV5(nai().model);
        const maxOk = () => v5() && sw * sh < MAX_PIXELS * 0.8;
        const scales = () => [1, 1.5, 2].filter((s) => r64(sw * s) * r64(sh * s) <= MAX_PIXELS);
        /** 精修的发送尺寸和输出尺寸 */
        function enhanceSize() {
            const o = ED.enhance;
            if (o.scale === 'max') {
                const send = { width: r64(sw), height: r64(sh) };
                if (4 * send.width * send.height <= MAX_PIXELS) return { send, out: { width: send.width * 2, height: send.height * 2 } };
                const k = Math.sqrt(MAX_PIXELS / (send.width * send.height));
                return { send, out: { width: Math.floor(send.width * k), height: Math.floor(send.height * k) } };
            }
            const s = { width: r64(sw * o.scale), height: r64(sh * o.scale) };
            return { send: s, out: s };
        }

        function cost() {
            if (mode === 'enhance') {
                const z = enhanceSize();
                return Price.enhance(nai(), z.out.width, z.out.height, ED.enhance.strength, ED.enhance.scale === 'max');
            }
            return Price.img2img(nai(), base.width, base.height, ED[mode].strength);
        }
        function renderCost() {
            const b = $('[data-go]', ctl);
            if (!b) return;
            b.textContent = mode === 'enhance' ? '开始精修' : mode === 'infill' ? '重画涂了的地方' : '照这张重画';
            const c = cost();
            Price.tag(b, c);
            const s = $('[data-size]', ctl);
            if (s) {
                if (mode === 'enhance') { const z = enhanceSize(); s.textContent = sw + '×' + sh + ' → ' + z.out.width + '×' + z.out.height + ' · ' + Price.label(c); } else s.textContent = '出图尺寸 ' + base.width + '×' + base.height + ' · ' + Price.label(c);
            }
        }

        function render() {
            UI.$$('[data-modes] button', L.box).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
            stage.classList.toggle('painting', mode === 'infill');
            mk.hidden = mode !== 'infill';
            const o = ED[mode];
            let h = '';
            if (mode === 'infill') {
                h += '<div class="row ed-tools"><div class="seg" data-pen><button data-v="0" class="' + (erase ? '' : 'on') + '">涂</button><button data-v="1" class="' + (erase ? 'on' : '') + '">擦</button></div>'
                    + '<input type="range" min="8" max="160" step="4" data-brush value="' + ED.brush + '" class="grow" aria-label="笔刷大小">'
                    + '<button class="btn small" data-undo>撤销</button><button class="btn small" data-clear>清空</button></div>'
                    + '<div class="card-sub">用手指把要重画的地方涂上颜色，没涂的地方保持原样。</div>';
            }
            h += prompts();
            h += slider(mode === 'infill' ? '重画强度' : '强度', 'strength', 0.01, mode === 'infill' ? 1 : 0.99, 0.01, o.strength);
            if (mode !== 'infill') h += slider('噪声', 'noise', 0, 0.99, 0.01, o.noise);
            if (mode === 'enhance') {
                const sc = scales().map((s) => [s, s + ' 倍']);
                if (maxOk()) sc.push(['max', 'MAX']);
                if (!sc.some((x) => x[0] === o.scale)) o.scale = sc.length ? sc[sc.length - 1][0] : 1;
                h += '<div class="row" style="margin:8px 0"><span class="card-sub" style="margin:0">放大</span><div class="seg" data-scale>'
                    + sc.map((x) => '<button data-v="' + x[0] + '" class="' + (x[0] === o.scale ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div></div>'
                    + (v5() ? '' : '<div class="card-sub">MAX 只有 V5 有（服务器直接放到最大尺寸）。</div>');
            }
            h += '<div class="card-sub" data-size></div>'
                + '<div class="card-sub">' + (mode === 'enhance' ? '强度越大改动越多，0.3～0.5 比较稳。' : mode === 'infill' ? '强度 1 = 涂的地方完全重画；低一点会参考原来的样子。' : '强度越大越不像原图，0.5～0.7 常用；噪声加一点能多些细节。') + '</div>'
                + '<div class="btns"><button class="btn primary" data-go></button></div>';
            ctl.innerHTML = h;
            renderCost();
        }

        L.box.addEventListener('click', (e) => {
            const t = e.target;
            const mb = t.closest('[data-modes] button');
            if (mb) { mode = mb.dataset.m; render(); requestAnimationFrame(place); return; }
            const pen = t.closest('[data-pen] button');
            if (pen) { erase = pen.dataset.v === '1'; render(); return; }
            const sc = t.closest('[data-scale] button');
            if (sc) { ED.enhance.scale = sc.dataset.v === 'max' ? 'max' : Number(sc.dataset.v); render(); return; }
            if (t.closest('[data-undo]')) { const d = undo.pop(); if (d) mg.putImageData(d, 0, 0); else toast('info', '没有可以撤销的了'); return; }
            if (t.closest('[data-clear]')) { undo.push(mg.getImageData(0, 0, mk.width, mk.height)); mg.clearRect(0, 0, mk.width, mk.height); return; }
            if (t.closest('[data-go]')) go();
        });
        L.box.addEventListener('input', (e) => {
            const t = e.target;
            if (t.dataset.f) { st[t.dataset.f] = t.value; return; }
            if (t.dataset.brush !== undefined) { ED.brush = Number(t.value); return; }
            if (t.dataset.s) {
                ED[mode][t.dataset.s] = Number(t.value);
                t.nextElementSibling.textContent = t.value;
                renderCost();
            }
        });

        function go() {
            const n = Object.assign({}, nai());
            if (!String(n.key || '').trim()) { toast('warning', '请先在设置里填 NAI 的 Key'); return; }
            const o = ED[mode];
            const src = { desc: item.desc, tag: item.tag, nl: item.nl, extraNegative: item.extraNegative };
            const name = String(item.desc || item.tag || '').trim().replace(/\s+/g, ' ').slice(0, 16);
            let p, label = KIND_LABEL[mode] + (name ? '：' + name : '');
            if (mode === 'enhance') {
                const z = enhanceSize();
                const raw = m.positive ? { positive: m.positive, negative: m.negative || '' } : null;
                n.vibes = []; // 精修不再套画风参考
                p = {
                    tag: item.tag || (raw && raw.positive) || 'masterpiece', nl: item.nl || '', negative: item.extraNegative || '', size: m.size,
                    characters: m.characters || [],
                    i2i: { kind: 'enhance', image: pngB64(img, z.send.width, z.send.height), width: z.send.width, height: z.send.height, from: item.id,
                        strength: o.strength, noise: o.noise, max: ED.enhance.scale === 'max', scale: ED.enhance.scale, raw },
                };
                if (ED.enhance.scale === 'max') label = '精修 MAX' + (name ? '：' + name : '');
            } else {
                if (!st.tag.trim()) { toast('warning', '正面提示词是空的'); return; }
                const i2i = { kind: mode, image: pngB64(img, base.width, base.height), width: base.width, height: base.height, from: item.id, strength: o.strength };
                if (mode === 'infill') {
                    const mm = maskB64(mk, base.width, base.height);
                    if (!mm.any) { toast('warning', '先用手指把要重画的地方涂上'); stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
                    i2i.mask = mm.b64;
                    if (String(n.model).includes('nai-diffusion-5-curated')) n.model = 'nai-diffusion-4-5-curated';
                } else i2i.noise = o.noise;
                p = { desc: item.desc, tag: st.tag, nl: st.nl, negative: st.negative, size: m.size, characters: m.characters || [], i2i };
            }
            try { Nai.buildBody(n, p); } catch (err) { toast('error', err.message); return; }
            queueGenerate(n, label, src, p, (res) => { if (L.el.isConnected) window.ImgTools && ImgTools.compare(item, res); });
            toast('info', '已排进出图队列');
        }

        render();
    }

    // ------------------------------------------------------------
    // 创作页：底图卡片（图库里选一张当底图）
    // ------------------------------------------------------------
    let baseCfg = { id: '', on: true, strength: 0.7, noise: 0 };
    let baseItem = null, baseSize = null, card = null;
    const saveBase = () => Store.set('i2iBase', baseCfg);

    /** 从图库挑一张，返回那一项或 null */
    async function pickFromGallery(title) {
        const items = (await Gallery.list()).slice(0, 300);
        if (!items.length) { toast('info', '图库里还没有图'); return null; }
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>' + esc(title || '选一张图') + '</b></div>'
                + '<div class="page-body"><div class="grid">' + items.map((x) => '<button class="thumb" data-id="' + esc(x.id) + '"><img src="' + esc(x.thumb || '') + '" alt=""></button>').join('') + '</div></div>',
            { onClose: () => { if (!done) resolve(null); } });
            $('.grid', L.box).onclick = (e) => {
                const b = e.target.closest('[data-id]'); if (!b) return;
                done = true;
                UI.closeLayer(L, true);
                resolve(items.find((x) => x.id === b.dataset.id));
            };
        });
    }

    async function loadBase() {
        baseItem = null; baseSize = null;
        if (!baseCfg.id) return;
        baseItem = (await Gallery.list()).find((x) => x.id === baseCfg.id) || null;
        if (baseItem) {
            const s = await sizeOf(baseItem).catch(() => null);
            baseSize = s && fitSize(s.width, s.height);
        }
    }

    function renderCard() {
        if (!card) return;
        const on = baseCfg.id && baseCfg.on;
        let h = '<div class="row"><div class="label grow" style="margin:0">底图（图生图）' + (on && baseItem ? ' <span class="badge acc">开</span>' : '') + '</div>'
            + '<button class="btn small" data-a="pick">' + (baseCfg.id ? '换一张' : '从图库选') + '</button></div>';
        if (!baseCfg.id) {
            h += '<div class="card-sub">选一张图库里的图当底图，出图时照着它的构图和颜色重画（官方叫 Image2Image）。</div>';
        } else if (!baseItem) {
            h += '<div class="warn">底图在图库里找不到了（可能删了），换一张或者去掉。</div><div class="row" style="justify-content:flex-end"><button class="btn small danger" data-a="clear">去掉底图</button></div>';
        } else {
            const c = baseSize ? Price.img2img(nai(), baseSize.width, baseSize.height, baseCfg.strength) : null;
            h += '<div class="vibe-item" style="border:0;margin:0"><div class="row"><img class="vibe-thumb" src="' + esc(baseItem.thumb || '') + '" alt="">'
                + '<div class="grow card-sub" data-cost>' + (baseSize ? '按底图尺寸 ' + baseSize.width + '×' + baseSize.height + ' 出图（竖图/横图不管用）<br>每张 ' + esc(Price.label(c)) : '') + '</div>'
                + '<label class="switch"><input type="checkbox" data-f="on"' + (baseCfg.on ? ' checked' : '') + ' aria-label="启用"><span></span></label></div>'
                + '<div class="vibe-slider"><span>强度</span><input type="range" min="0.01" max="0.99" step="0.01" data-f="strength" value="' + baseCfg.strength + '"><b>' + baseCfg.strength + '</b></div>'
                + '<div class="vibe-slider"><span>噪声</span><input type="range" min="0" max="0.99" step="0.01" data-f="noise" value="' + baseCfg.noise + '"><b>' + baseCfg.noise + '</b></div>'
                + '<div class="row" style="justify-content:flex-end"><button class="btn small" data-a="paint">局部重绘…</button><button class="btn small danger" data-a="clear">去掉底图</button></div></div>'
                + '<div class="card-sub">强度越大越不像底图。开着时点「出图」就是照底图重画，提示词照常用上面那格。</div>';
        }
        card.innerHTML = h;
    }

    function bindCard() {
        card.addEventListener('input', (e) => {
            const f = e.target.dataset.f; if (!f) return;
            if (f === 'on') { baseCfg.on = e.target.checked; saveBase(); renderCard(); return; }
            baseCfg[f] = Number(e.target.value);
            e.target.nextElementSibling.textContent = e.target.value;
            if (f === 'strength' && baseSize) {
                const c = Price.img2img(nai(), baseSize.width, baseSize.height, baseCfg.strength);
                $('[data-cost]', card).innerHTML = '按底图尺寸 ' + baseSize.width + '×' + baseSize.height + ' 出图（竖图/横图不管用）<br>每张 ' + esc(Price.label(c));
            }
            saveBase();
        });
        card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'pick') {
                const it = await pickFromGallery('选一张当底图');
                if (!it) return;
                await setBase(it);
            }
            if (b.dataset.a === 'clear') { baseCfg.id = ''; saveBase(); await loadBase(); renderCard(); }
            if (b.dataset.a === 'paint' && baseItem) openEditor(baseItem, 'infill');
        });
    }

    async function setBase(item) {
        baseCfg.id = item.id;
        baseCfg.on = true;
        saveBase();
        await loadBase();
        renderCard();
    }

    const init = CreatePage.init, refresh = CreatePage.refresh;
    let lastModel = null;
    CreatePage.init = async function () {
        await init.apply(this, arguments);
        baseCfg = Object.assign(baseCfg, await Store.get('i2iBase', {}));
        await loadBase();
        const result = $('#c-result');
        if (result) {
            card = document.createElement('div');
            card.className = 'card';
            card.id = 'c-i2i';
            result.parentNode.insertBefore(card, result);
            bindCard();
            renderCard();
        }
        lastModel = nai().model;
    };
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        if (nai().model !== lastModel) { lastModel = nai().model; renderCard(); }
    };

    // 创作页的「出图」按钮：底图开着就带上
    const draw = CreatePage.draw;
    CreatePage.draw = function (p, count) {
        if (!p && baseCfg.id && baseCfg.on && baseItem) {
            const d = CreatePage.draft;
            p = { desc: d.desc, tag: d.tag, nl: d.nl, negative: d.negative, size: d.size, i2iRef: { id: baseCfg.id, strength: baseCfg.strength, noise: baseCfg.noise } };
        }
        return draw.call(this, p, count);
    };
    // 「重绘」：图生图出的那张，照原底图再来一张
    const redraw = CreatePage.redraw;
    CreatePage.redraw = function (item) {
        const e = item.meta && item.meta.edit;
        if (e && e.kind === 'img2img' && e.from) {
            return CreatePage.draw({ desc: item.desc, tag: item.tag, nl: item.nl, negative: item.extraNegative, size: item.meta.size,
                seed: Math.floor(Math.random() * 2 ** 32), characters: item.meta.characters || [], i2iRef: { id: e.from, strength: e.strength, noise: e.noise || 0 } }, 1);
        }
        return redraw.apply(this, arguments);
    };

    // ------------------------------------------------------------
    // 样式（不动 样式.css，免得和别的改动打架）
    // ------------------------------------------------------------
    const css = document.createElement('style');
    css.textContent = [
        '.ed-stage { position: relative; height: 46vh; background: #000; border-radius: 12px; overflow: hidden; margin-bottom: 12px; }',
        '.ed-stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; user-select: none; }',
        '.ed-stage canvas { position: absolute; opacity: .55; touch-action: none; }',
        '.ed-tools { margin: 0 0 6px; }',
        '.ed-tools input[type=range] { accent-color: var(--accent); }',
        'small.cost-tag { display: block; font-size: 10px; opacity: .8; font-weight: 400; line-height: 1.1; }',
        '.btn small.cost-tag { display: inline; margin-left: 6px; font-size: 11px; }',
    ].join('\n');
    document.head.appendChild(css);

    window.ImgEdit = { loadImg, fitSize, pngB64, rawB64, maskB64, sizeOf, inpaintModel, makeI2i, openEditor, pickFromGallery, setBase, queue, Price, genCost, MAX_PIXELS, KIND_LABEL };
})();
