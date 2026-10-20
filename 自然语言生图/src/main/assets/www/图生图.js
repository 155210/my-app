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
        const out = Object.assign({ image: pngB64(img, size.width, size.height), width: size.width, height: size.height, from: id }, opt.i2i);
        if (opt.mask) {
            const mm = maskB64(await loadUrl(opt.mask), size.width, size.height);
            if (!mm.any) throw new Error('底图的遮罩是空的，重新涂一下');
            Object.assign(out, { mask: mm.b64, kind: 'infill' });
            delete out.noise;
        }
        return out;
    }

    function loadUrl(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('图片读不出来'));
            img.src = src;
        });
    }

    /**
     * 局部重绘贴回原图：没涂的地方用原图原尺寸的像素，涂的地方用 NAI 画的，交界处按 feather 像素羽化过渡
     * 解决「重画的那块和周围清晰度、颜色对不上，边上一圈方块」：
     *   NAI 回的整张图都过了一遍编码解码（会轻微变糊、偏色），遮罩又是 8×8 的方块，硬边很显眼；
     *   原图比 NAI 上限大（放大过的图）时，发出去要先缩小，回来整张都变小变糊。
     * 返回 { blob, width, height }
     */
    async function composite(i2i, blob) {
        const item = (await Gallery.list()).find((x) => x.id === i2i.from);
        const srcBlob = item && await Gallery.getBlob(i2i.from);
        if (!srcBlob) return null;
        const [orig, res, mimg] = await Promise.all([loadImg(srcBlob), loadImg(blob), loadUrl('data:image/png;base64,' + i2i.mask)]);
        const W = orig.naturalWidth, H = orig.naturalHeight;
        // 黑白遮罩 → 透明度遮罩
        const a = canvas(mimg.naturalWidth, mimg.naturalHeight), ag = a.getContext('2d');
        ag.drawImage(mimg, 0, 0);
        const d = ag.getImageData(0, 0, a.width, a.height);
        for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; }
        ag.putImageData(d, 0, 0);
        // 放到原图尺寸再羽化
        const k = W / i2i.width, f = Math.max(0, Number(i2i.feather) || 0) * k;
        const m = canvas(W, H), mg = m.getContext('2d');
        if (f > 0) mg.filter = 'blur(' + (f / 2).toFixed(1) + 'px)';
        mg.drawImage(a, 0, 0, W, H);
        // NAI 画的那块
        const gen = canvas(W, H), gg = gen.getContext('2d');
        gg.imageSmoothingQuality = 'high';
        gg.drawImage(res, 0, 0, W, H);
        gg.globalCompositeOperation = 'destination-in';
        gg.drawImage(m, 0, 0);
        // 原图 + 画的那块
        const out = canvas(W, H), og = out.getContext('2d');
        og.drawImage(orig, 0, 0);
        og.drawImage(gen, 0, 0);
        const b = await new Promise((r) => out.toBlob(r, 'image/png'));
        return b ? { blob: b, width: W, height: H } : null;
    }

    // 创作页底图：真出图前才读图（排队时只记 id）
    const generate = Nai.generate;
    Nai.generate = async function (n, p, signal) {
        if (p && p.i2iRef && !p.i2i) {
            const r = p.i2iRef;
            p = Object.assign({}, p, { i2i: await makeI2i(r.id, { mask: r.mask, i2i: { kind: 'img2img', strength: r.strength, noise: r.noise, feather: r.feather } }) });
            // V5 Curated 还没有 inpainting，借 V4.5 Curated（同编辑页）
            if (p.i2i.mask && String(n.model).includes('nai-diffusion-5-curated')) n = Object.assign({}, n, { model: 'nai-diffusion-4-5-curated' });
        }
        const out = await generate.call(this, n, p, signal);
        const e = p && p.i2i;
        if (e && e.mask && e.feather != null && e.feather >= 0) {
            const c = await composite(e, out.blob).catch(() => null);
            if (c) {
                out.blob = c.blob;
                out.ext = 'png';
                out.meta = Object.assign({}, out.meta, { width: c.width, height: c.height });
                out.meta.edit = Object.assign({}, out.meta.edit, { feather: e.feather });
            }
        }
        return out;
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
    const ED = { img2img: { strength: 0.7, noise: 0 }, infill: { strength: 1, feather: 16, pre: false, post: false, postLocal: true, preStrength: 0.35, postStrength: 0.3 }, enhance: { strength: 0.5, noise: 0, scale: 1.5 }, brush: 48 };

    /**
     * 手指涂遮罩：mk 是盖在图上的 canvas（内部分辨率 = 出图尺寸），stage 是外框，sw×sh 是原图尺寸
     * isOn() 为假时不响应（编辑页切到别的模式）；onEnd() 每画完一笔调一次
     * 返回 { erase, undo(), clear(), place(), destroy() }
     */
    function painter(stage, mk, sw, sh, isOn, onEnd) {
        const g = mk.getContext('2d');
        const stack = [];
        const pen = { erase: false };
        // 遮罩画布盖在图片实际显示的位置上
        function place() {
            const W = stage.clientWidth, H = stage.clientHeight;
            const s = Math.min(W / sw, H / sh);
            const w = sw * s, h = sh * s;
            Object.assign(mk.style, { left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px', width: w + 'px', height: h + 'px' });
        }
        requestAnimationFrame(place);
        window.addEventListener('resize', place);
        let painting = null;
        const toCanvas = (e) => {
            const r = mk.getBoundingClientRect();
            return { x: (e.clientX - r.left) / r.width * mk.width, y: (e.clientY - r.top) / r.height * mk.height };
        };
        const line = (a, b) => {
            g.globalCompositeOperation = pen.erase ? 'destination-out' : 'source-over';
            g.strokeStyle = '#e2a65b';
            g.lineCap = g.lineJoin = 'round';
            g.lineWidth = ED.brush * 2;
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.stroke();
        };
        mk.addEventListener('pointerdown', (e) => {
            if (!isOn() || painting) return;
            try { mk.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件 */ }
            stack.push(g.getImageData(0, 0, mk.width, mk.height));
            if (stack.length > 20) stack.shift();
            const p = toCanvas(e);
            painting = { id: e.pointerId, last: p };
            line(p, p);
            e.preventDefault();
        });
        mk.addEventListener('pointermove', (e) => {
            if (!painting || painting.id !== e.pointerId) return;
            const p = toCanvas(e);
            line(painting.last, p);
            painting.last = p;
        });
        const stop = (e) => { if (painting && painting.id === e.pointerId) { painting = null; if (onEnd) onEnd(); } };
        mk.addEventListener('pointerup', stop);
        mk.addEventListener('pointercancel', stop);
        pen.undo = () => { const d = stack.pop(); if (d) g.putImageData(d, 0, 0); else toast('info', '没有可以撤销的了'); };
        pen.clear = () => { stack.push(g.getImageData(0, 0, mk.width, mk.height)); g.clearRect(0, 0, mk.width, mk.height); };
        pen.place = place;
        pen.destroy = () => window.removeEventListener('resize', place);
        return pen;
    }

    const penTools = (erase) => '<div class="row ed-tools"><div class="seg" data-pen><button data-v="0" class="' + (erase ? '' : 'on') + '">涂</button><button data-v="1" class="' + (erase ? 'on' : '') + '">擦</button></div>'
        + '<input type="range" min="8" max="160" step="4" data-brush value="' + ED.brush + '" class="grow" aria-label="笔刷大小">'
        + '<button class="btn small" data-undo>撤销</button><button class="btn small" data-clear>清空</button></div>';

    /** 涂 / 擦、撤销、清空 这一排的点击；处理了返回 true（笔刷大小走 input 事件） */
    function penClick(t, pen, root) {
        const b = t.closest('[data-pen] button');
        if (b) { pen.erase = b.dataset.v === '1'; UI.$$('[data-pen] button', root).forEach((x) => x.classList.toggle('on', x === b)); return true; }
        if (t.closest('[data-undo]')) { pen.undo(); return true; }
        if (t.closest('[data-clear]')) { pen.clear(); return true; }
        return false;
    }

    /** 边缘过渡（贴回原图时羽化几像素；-1 = 不贴回，直接用 NAI 回的整张） */
    const featherSlider = (v) => '<div class="vibe-slider"><span>边缘过渡</span><input type="range" min="-1" max="64" step="1" data-feather value="' + v + '"><b>' + (v < 0 ? '不处理' : v) + '</b></div>';
    const featherLabel = (v) => (v < 0 ? '不处理' : String(v));

    /** 画风模板下拉（编辑页用自己的选择，不改全局） */
    const styleSelect = (cur) => '<div class="field"><label>画风模板</label><select data-style>'
        + [['', '不用模板']].concat(nai().styles.map((x) => [x.id, x.name || '未命名']))
            .map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></div>';

    /** 整张精修的尺寸：放大 1.5 倍（超上限就 1 倍） */
    function enhancePlan(w, h) {
        const k = r64(w * 1.5) * r64(h * 1.5) <= MAX_PIXELS ? 1.5 : 1;
        return { scale: k, width: r64(w * k), height: r64(h * k) };
    }
    const enhanceCost = (w, h, strength) => { const z = enhancePlan(w, h); return Price.enhance(nai(), z.width, z.height, strength, false); };

    /** 把图库里一张整张精修一遍（照它配方里的提示词，不套画风参考），排进队列 */
    /** limit = { mask, width, feather }：只把精修结果贴回遮罩附近，别的地方保持原样（真人照片的脸不会被改） */
    async function enhanceItem(item, strength, label, after, limit) {
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '图找不到了'); return null; }
        const img = await loadImg(blob);
        const z = enhancePlan(img.naturalWidth, img.naturalHeight);
        const m = item.meta || {};
        const raw = m.positive ? { positive: m.positive, negative: m.negative || '' } : null;
        const n = Object.assign({}, nai(), { vibes: [] });
        const p = { tag: item.tag || (raw && raw.positive) || 'masterpiece', nl: item.nl || '', negative: item.extraNegative || '', size: m.size, characters: m.characters || [],
            i2i: { kind: 'enhance', image: pngB64(img, z.width, z.height), width: z.width, height: z.height, from: item.id, strength, noise: 0, scale: z.scale, raw } };
        if (!limit) return queueGenerate(n, label, item, p, after);
        return queue(label, item, async (signal) => {
            const out = await Nai.generate(n, p, signal);
            const c = await composite({ from: item.id, mask: limit.mask, width: limit.width, feather: limit.feather }, out.blob).catch(() => null);
            if (c) {
                out.blob = c.blob;
                out.ext = 'png';
                out.meta = Object.assign({}, out.meta, { width: c.width, height: c.height });
                out.meta.edit = Object.assign({}, out.meta.edit, { local: true });
            }
            return out;
        }, after);
    }

    /** 局部重绘时附给 AI 的要求 */
    const infillNote = (want) => '这次是局部重绘：图里只有被涂掉的那一块会重画，要画成：' + want
        + '\n输出的仍然是整张图的提示词：原图其余部分（人物、外貌、服装、场景、构图、镜头）照原样保留；把和涂掉那块有关的标签换成新内容，删掉和新内容冲突的旧标签。';

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
        const styleIdOf = (name) => (name ? (nai().styles.find((x) => x.name === name) || {}).id || nai().styleId : '');
        const st = { tag: item.tag || '', nl: item.nl || '', negative: item.extraNegative || '', desc: item.desc || '', fill: '', hint: '',
            styleId: m.style != null ? styleIdOf(m.style) : nai().styleId };
        let writing = null; // AI 正在写时的 AbortController

        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>编辑这张图</b></div>'
            + '<div class="tabs" data-modes>' + Object.keys(KIND_LABEL).map((k) => '<button data-m="' + k + '">' + KIND_LABEL[k] + '</button>').join('') + '</div>'
            + '<div class="page-body">'
            + '<div class="ed-stage" data-stage><img data-img alt="" draggable="false" src="' + url + '"><canvas data-mask></canvas></div>'
            + '<div data-ctl></div></div>',
        { onClose: () => URL.revokeObjectURL(url) });
        const stage = $('[data-stage]', L.box), view = $('[data-img]', L.box), mk = $('[data-mask]', L.box), ctl = $('[data-ctl]', L.box);
        mk.width = base.width; mk.height = base.height;
        const pen = painter(stage, mk, sw, sh, () => mode === 'infill', () => renderCost());
        const prevClose = L.onClose;
        L.onClose = () => { pen.destroy(); if (writing) writing.abort(); prevClose(); };

        function prompts() {
            if (mode === 'enhance') {
                return '<div class="card-sub">精修照这张图原来那套提示词，把图放大后再细化一遍，画面基本不变。</div>';
            }
            const fill = mode === 'infill';
            return '<div class="field"><label>' + (fill ? '用中文说涂掉的地方要画成什么' : '用中文描述想要的画面（可以改原来的描述）') + '</label>'
                + '<textarea class="ta small" data-f="' + (fill ? 'fill' : 'desc') + '" placeholder="' + (fill ? '比如：换成红色的连衣裙 / 手里拿一把伞 / 背景换成海边' : '比如：同一个女孩，换成在雨里撑伞') + '">' + esc(fill ? st.fill : st.desc) + '</textarea></div>'
                + '<div class="row" style="justify-content:flex-end;margin:-6px 0 10px"><button class="btn small" data-ai="rewrite">AI 重写</button><button class="btn small primary" data-ai="write"></button></div>'
                + '<pre class="live" data-live hidden></pre>'
                + styleSelect(st.styleId)
                + '<div class="field"><label>正面提示词（英文标签，可以直接改）</label><textarea class="ta small" data-f="tag">' + esc(st.tag) + '</textarea></div>'
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
            if (mode === 'infill') {
                // 先变清晰 + 重画 + 画完精修，加起来
                const o = ED.infill, z = o.pre ? fitSize(enhancePlan(sw, sh).width, enhancePlan(sw, sh).height) : base;
                const parts = [o.pre ? enhanceCost(sw, sh, o.preStrength) : 0, Price.img2img(nai(), z.width, z.height, o.strength), o.post ? enhanceCost(z.width, z.height, o.postStrength) : 0];
                return parts.some((x) => x < 0) ? -1 : parts.reduce((x, y) => x + y, 0);
            }
            return Price.img2img(nai(), base.width, base.height, ED[mode].strength);
        }
        function renderCost() {
            const b = $('[data-go]', ctl);
            if (!b) return;
            b.textContent = mode === 'enhance' ? '开始精修' : mode === 'infill' ? '重画涂了的地方' : '照这张重画';
            const c = cost();
            Price.tag(b, c);
            const pc = $('[data-cost-pre]', ctl), qc = $('[data-cost-post]', ctl);
            if (pc) pc.textContent = '（多' + Price.label(enhanceCost(sw, sh, ED.infill.preStrength)) + '）';
            if (qc) { const z = ED.infill.pre ? enhancePlan(sw, sh) : base; qc.textContent = '（多' + Price.label(enhanceCost(z.width, z.height, ED.infill.postStrength)) + '）'; }
            const s = $('[data-size]', ctl);
            if (s) {
                if (mode === 'enhance') { const z = enhanceSize(); s.textContent = sw + '×' + sh + ' → ' + z.out.width + '×' + z.out.height + ' · ' + Price.label(c); } else if (mode === 'infill' && (ED.infill.pre || ED.infill.post)) {
                    const z = ED.infill.pre ? fitSize(enhancePlan(sw, sh).width, enhancePlan(sw, sh).height) : base;
                    s.textContent = '出图尺寸 ' + z.width + '×' + z.height + ' · 几步加起来 ' + Price.label(c);
                } else s.textContent = '出图尺寸 ' + base.width + '×' + base.height + ' · ' + Price.label(c);
            }
        }

        function render() {
            UI.$$('[data-modes] button', L.box).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
            stage.classList.toggle('painting', mode === 'infill');
            mk.hidden = mode !== 'infill';
            const o = ED[mode];
            let h = '';
            if (mode === 'infill') {
                h += penTools(pen.erase)
                    + '<div class="card-sub">用手指把要重画的地方涂上颜色，没涂的地方保持原样。</div>';
            }
            h += prompts();
            h += slider(mode === 'infill' ? '重画强度' : '强度', 'strength', 0.01, mode === 'infill' ? 1 : 0.99, 0.01, o.strength);
            if (mode !== 'infill') h += slider('噪声', 'noise', 0, 0.99, 0.01, o.noise);
            if (mode === 'infill') {
                h += featherSlider(o.feather)
                    + '<div class="card-sub">重画完把结果贴回原图：没涂的地方保持原图原样（原尺寸、原清晰度），交界处按这个像素数慢慢过渡，不会有一圈硬边。拉到最左 = 不处理，直接用 NAI 回的整张。</div>'
                    + '<div class="label" style="margin-top:12px">原图本身比较糊时（重画的那块清楚、别的地方糊）：</div>'
                    + '<label class="check" style="margin:6px 0 2px"><span class="switch"><input type="checkbox" data-opt="pre"' + (o.pre ? ' checked' : '') + '><span></span></span>'
                    + '<span>画之前先把整张图变清晰 <span class="card-sub" data-cost-pre style="display:inline"></span></span></label>'
                    + '<div class="card-sub">先精修一遍（放大 ' + enhancePlan(sw, sh).scale + ' 倍，强度 ' + o.preStrength + '），再在变清晰的图上重画涂的地方，整张一样清楚。<b class="warn" style="display:inline">会改动整张图：真人照片的脸可能变样、变得像动漫，真人照片不建议开。</b></div>'
                    + '<label class="check" style="margin:10px 0 2px"><span class="switch"><input type="checkbox" data-opt="post"' + (o.post ? ' checked' : '') + '><span></span></span>'
                    + '<span>画完再整体精修一遍 <span class="card-sub" data-cost-post style="display:inline"></span></span></label>'
                    + '<div class="card-sub">重画好以后再精修一次（强度 ' + o.postStrength + '），让新画的那块和周围的清晰度、笔触、光影统一。</div>'
                    + '<label class="check" style="margin:6px 0 2px 50px"><span class="switch"><input type="checkbox" data-opt="postLocal"' + (o.postLocal ? ' checked' : '') + '><span></span></span>'
                    + '<span>只融合重画那块周围（推荐）</span></label>'
                    + '<div class="card-sub" style="margin-left:50px">开着：精修的结果只贴回涂的地方和旁边一圈，脸和其他没涂的地方一个像素都不动。关掉：整张都换成精修后的，真人照片的脸可能会变。</div>';
            }
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
            renderAi();
        }

        function renderAi() {
            const w = $('[data-ai="write"]', ctl), r = $('[data-ai="rewrite"]', ctl);
            if (!w) return;
            w.textContent = writing ? '停止' : 'AI 写提示词';
            w.classList.toggle('danger', !!writing);
            r.disabled = !!writing;
        }

        /** AI 写 / 重写提示词（走创作页同一套：自定义提示词、角色库、标签库纠错都生效） */
        async function runAi(kind, hint) {
            if (writing) { writing.abort(); return; }
            let opt;
            if (kind === 'write' && mode === 'infill') {
                const want = st.fill.trim();
                if (!want) { toast('warning', '先用中文写涂掉的地方要画成什么'); return; }
                opt = { text: [st.desc.trim(), '局部重绘：' + want].filter(Boolean).join('\n'), rewrite: { tag: st.tag, nl: st.nl, negative: st.negative, hint: infillNote(want) } };
            } else if (kind === 'write') {
                if (!st.desc.trim()) { toast('warning', '先用中文描述想要的画面'); return; }
                opt = { text: st.desc };
            } else {
                opt = { text: st.desc.trim() || '（没有中文描述，照下面当前的提示词重写）', rewrite: { tag: st.tag, nl: st.nl, negative: st.negative, hint } };
            }
            writing = new AbortController();
            const live = () => $('[data-live]', ctl);
            if (live()) { live().hidden = false; live().textContent = 'AI 正在写…'; }
            renderAi();
            Queue.Busy.on();
            try {
                const res = await Writer.run(Object.assign({
                    settings: UI.settings, signal: writing.signal,
                    onDelta: (c) => { const l = live(); if (l) { l.textContent = c || 'AI 正在写…'; l.scrollTop = l.scrollHeight; } },
                }, opt));
                Object.assign(st, { tag: res.tag || '', nl: res.nl || '', negative: res.negative || '' });
                ['tag', 'nl', 'negative'].forEach((f) => { const el = $('[data-f="' + f + '"]', ctl); if (el) el.value = st[f]; });
                if (live()) live().hidden = true;
                toast('success', UI.settings.autoDraw ? '写好了，开始出图' : '写好了，看一眼再点下面的按钮');
                if (UI.settings.autoDraw) go();
            } catch (e) {
                if (e.name === 'AbortError') { if (live()) live().hidden = true; toast('info', '已停止'); } else {
                    if (live()) live().textContent = '出错了：' + (e.message || e);
                    toast('error', e.message || String(e), '写提示词失败');
                }
            } finally {
                writing = null;
                Queue.Busy.off();
                renderAi();
            }
        }

        function askRewrite() {
            const D = UI.openLayer('dialog', '<h3>AI 重写提示词</h3>'
                + '<p>照下面现在的提示词，把同一个画面重写一遍。想改哪里可以写一句（不写也行）。</p>'
                + '<div class="field"><textarea class="ta small" data-hint placeholder="比如：表情再害羞一点 / 换成全身 / 加上下雨"></textarea></div>'
                + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-go>重写</button></div>');
            const ta = $('[data-hint]', D.box);
            ta.value = st.hint;
            $('[data-go]', D.box).onclick = () => { st.hint = ta.value.trim(); UI.closeLayer(D); runAi('rewrite', st.hint); };
        }

        L.box.addEventListener('click', (e) => {
            const t = e.target;
            const mb = t.closest('[data-modes] button');
            if (mb) { mode = mb.dataset.m; render(); requestAnimationFrame(pen.place); return; }
            if (penClick(t, pen, L.box)) return;
            const ai = t.closest('[data-ai]');
            if (ai) { if (ai.dataset.ai === 'write') runAi('write'); else askRewrite(); return; }
            const sc = t.closest('[data-scale] button');
            if (sc) { ED.enhance.scale = sc.dataset.v === 'max' ? 'max' : Number(sc.dataset.v); render(); return; }
            if (t.closest('[data-go]')) go();
        });
        L.box.addEventListener('input', (e) => {
            const t = e.target;
            if (t.dataset.f) { st[t.dataset.f] = t.value; return; }
            if (t.dataset.style !== undefined) { st.styleId = t.value; return; }
            if (t.dataset.feather !== undefined) { ED.infill.feather = Number(t.value); t.nextElementSibling.textContent = featherLabel(ED.infill.feather); return; }
            if (t.dataset.opt) { ED.infill[t.dataset.opt] = t.checked; renderCost(); return; }
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
                if (!st.tag.trim()) { toast('warning', '正面提示词是空的，先让 AI 写或者自己填'); return; }
                n.styleId = st.styleId;
                const i2i = { kind: mode, image: pngB64(img, base.width, base.height), width: base.width, height: base.height, from: item.id, strength: o.strength };
                if (mode === 'infill') {
                    const mm = maskB64(mk, base.width, base.height);
                    if (!mm.any) { toast('warning', '先用手指把要重画的地方涂上'); stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
                    i2i.mask = mm.b64;
                    i2i.feather = o.feather;
                    if (String(n.model).includes('nai-diffusion-5-curated')) n.model = 'nai-diffusion-4-5-curated';
                } else i2i.noise = o.noise;
                p = { desc: item.desc, tag: st.tag, nl: st.nl, negative: st.negative, size: m.size, characters: m.characters || [], i2i };
            }
            try { Nai.buildBody(n, p); } catch (err) { toast('error', err.message); return; }
            const show = (res) => { if (L.el.isConnected) window.ImgTools && ImgTools.compare(item, res); };
            if (mode !== 'infill' || (!o.pre && !o.post)) {
                queueGenerate(n, label, src, p, show);
            } else {
                // 原图糊：先精修整张 → 在清楚的图上重画；或者重画完再整张精修一遍
                const postFor = (i2i) => (o.post ? (res) => enhanceItem(res, o.postStrength, (o.postLocal ? '周围融合' : '整体精修') + (name ? '：' + name : ''), show,
                    o.postLocal ? { mask: i2i.mask, width: i2i.width, feather: Math.max(48, o.feather * 3) } : null) : show);
                if (!o.pre) queueGenerate(n, label, src, p, postFor(p.i2i));
                else {
                    const maskUrl = mk.toDataURL('image/png');
                    const f = o.feather, s1 = o.strength;
                    enhanceItem(item, o.preStrength, '先变清晰' + (name ? '：' + name : ''), async (sharp) => {
                        try {
                            const i2i = await makeI2i(sharp.id, { mask: maskUrl, i2i: { kind: 'infill', strength: s1, feather: f } });
                            queueGenerate(n, label, src, Object.assign({}, p, { i2i }), postFor(i2i));
                        } catch (err) { toast('error', err.message, '局部重绘失败'); }
                    });
                }
            }
            toast('info', '已排进出图队列');
        }

        render();
    }

    // ------------------------------------------------------------
    // 创作页：底图卡片（图库里选一张当底图）
    // ------------------------------------------------------------
    let baseCfg = { id: '', on: true, strength: 0.7, noise: 0, fillStrength: 1, feather: 16 };
    let baseItem = null, baseSize = null, card = null;
    let baseMask = null; // { id 底图, data 涂好的遮罩 PNG dataURL }，存在 i2iMask 键
    const saveBase = () => Store.set('i2iBase', baseCfg);
    const maskOn = () => !!(baseMask && baseMask.data && baseMask.id === baseCfg.id);

    /** 只涂遮罩的页面（创作页底图用）；返回 dataURL，取消返回 null */
    async function paintMask(item, prev) {
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '底图的文件找不到了'); return null; }
        const img = await loadImg(blob);
        const sw = img.naturalWidth, sh = img.naturalHeight, z = fitSize(sw, sh);
        const url = URL.createObjectURL(blob);
        let pen = null;
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>涂要重画的地方</b></div>'
                + '<div class="page-body"><div class="ed-stage" data-stage><img alt="" draggable="false" src="' + url + '"><canvas data-mask></canvas></div>'
                + penTools(false)
                + '<div class="card-sub">用手指把要重画的地方涂上颜色。回到创作页写描述、让 AI 写提示词，点「出图」就只重画涂了的地方。</div>'
                + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-ok>用这个遮罩</button></div></div>',
            { onClose: () => { URL.revokeObjectURL(url); if (pen) pen.destroy(); if (!done) resolve(null); } });
            const stage = $('[data-stage]', L.box), mk = $('[data-mask]', L.box);
            mk.width = z.width; mk.height = z.height;
            pen = painter(stage, mk, sw, sh, () => true);
            if (prev) loadUrl(prev).then((m) => mk.getContext('2d').drawImage(m, 0, 0, z.width, z.height)).catch(() => {});
            L.box.addEventListener('click', (e) => {
                if (penClick(e.target, pen, L.box)) return;
                if (!e.target.closest('[data-ok]')) return;
                if (!maskB64(mk, z.width, z.height).any) { toast('warning', '还没涂，先用手指把要重画的地方涂上'); return; }
                done = true;
                resolve(mk.toDataURL('image/png'));
                UI.closeLayer(L);
            });
            L.box.addEventListener('input', (e) => { if (e.target.dataset.brush !== undefined) ED.brush = Number(e.target.value); });
        });
    }
    const baseCost = () => (baseSize ? Price.img2img(nai(), baseSize.width, baseSize.height, maskOn() ? baseCfg.fillStrength : baseCfg.strength) : null);
    const baseCostText = () => '按底图尺寸 ' + baseSize.width + '×' + baseSize.height + ' 出图（竖图/横图不管用）<br>每张 ' + esc(Price.label(baseCost()));

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
        let h = '<div class="row"><div class="label grow" style="margin:0">底图（图生图）' + (on && baseItem ? ' <span class="badge acc">' + (maskOn() ? '局部重绘' : '开') + '</span>' : '') + '</div>'
            + '<button class="btn small" data-a="pick">' + (baseCfg.id ? '换一张' : '从图库选') + '</button></div>';
        if (!baseCfg.id) {
            h += '<div class="card-sub">选一张图库里的图当底图，出图时照着它的构图和颜色重画（官方叫 Image2Image）。</div>';
        } else if (!baseItem) {
            h += '<div class="warn">底图在图库里找不到了（可能删了），换一张或者去掉。</div><div class="row" style="justify-content:flex-end"><button class="btn small danger" data-a="clear">去掉底图</button></div>';
        } else {
            const mo = maskOn();
            h += '<div class="vibe-item" style="border:0;margin:0"><div class="row"><img class="vibe-thumb" src="' + esc(baseItem.thumb || '') + '" alt="">'
                + '<div class="grow card-sub" data-cost>' + (baseSize ? baseCostText() : '') + '</div>'
                + '<label class="switch"><input type="checkbox" data-f="on"' + (baseCfg.on ? ' checked' : '') + ' aria-label="启用"><span></span></label></div>'
                + (mo
                    ? '<div class="vibe-slider"><span>重画强度</span><input type="range" min="0.01" max="1" step="0.01" data-f="fillStrength" value="' + baseCfg.fillStrength + '"><b>' + baseCfg.fillStrength + '</b></div>'
                        + '<div class="vibe-slider"><span>边缘过渡</span><input type="range" min="-1" max="64" step="1" data-f="feather" value="' + baseCfg.feather + '"><b>' + featherLabel(baseCfg.feather) + '</b></div>'
                    : '<div class="vibe-slider"><span>强度</span><input type="range" min="0.01" max="0.99" step="0.01" data-f="strength" value="' + baseCfg.strength + '"><b>' + baseCfg.strength + '</b></div>'
                        + '<div class="vibe-slider"><span>噪声</span><input type="range" min="0" max="0.99" step="0.01" data-f="noise" value="' + baseCfg.noise + '"><b>' + baseCfg.noise + '</b></div>')
                + '<div class="row" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn small" data-a="mask">' + (mo ? '改遮罩…' : '涂要重画的地方…') + '</button>'
                + (mo ? '<button class="btn small" data-a="unmask">不重绘了</button>' : '')
                + '<button class="btn small danger" data-a="clear">去掉底图</button></div></div>'
                + '<div class="card-sub">' + (mo ? '局部重绘：点「出图」只重画涂了的地方，别的照底图。上面的描述照常写整张图（想把涂的地方改成什么写进去），AI 写的提示词照常用。'
                    : '强度越大越不像底图。开着时点「出图」就是照底图重画，提示词照常用上面那格。想只改一块就点「涂要重画的地方」。') + '</div>';
        }
        card.innerHTML = h;
    }

    function bindCard() {
        card.addEventListener('input', (e) => {
            const f = e.target.dataset.f; if (!f) return;
            if (f === 'on') { baseCfg.on = e.target.checked; saveBase(); renderCard(); return; }
            baseCfg[f] = Number(e.target.value);
            e.target.nextElementSibling.textContent = f === 'feather' ? featherLabel(baseCfg.feather) : e.target.value;
            if (baseSize) $('[data-cost]', card).innerHTML = baseCostText();
            saveBase();
        });
        card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'pick') {
                const it = await pickFromGallery('选一张当底图');
                if (!it) return;
                await setBase(it);
            }
            if (b.dataset.a === 'clear') { baseCfg.id = ''; saveBase(); baseMask = null; Store.set('i2iMask', null); await loadBase(); renderCard(); }
            if (b.dataset.a === 'mask' && baseItem) {
                const data = await paintMask(baseItem, maskOn() ? baseMask.data : null);
                if (!data) return;
                baseMask = { id: baseCfg.id, data };
                await Store.set('i2iMask', baseMask);
                baseCfg.on = true; saveBase();
                renderCard();
            }
            if (b.dataset.a === 'unmask') { baseMask = null; await Store.set('i2iMask', null); renderCard(); }
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
        baseMask = await Store.get('i2iMask', null);
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
            const ref = maskOn() ? { id: baseCfg.id, mask: baseMask.data, strength: baseCfg.fillStrength, feather: baseCfg.feather } : { id: baseCfg.id, strength: baseCfg.strength, noise: baseCfg.noise };
            p = { desc: d.desc, tag: d.tag, nl: d.nl, negative: d.negative, size: d.size, i2iRef: ref };
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
        // 底图局部重绘出的：底图和遮罩还是那一套就照样再来
        if (e && e.kind === 'infill' && e.from && e.from === baseCfg.id && maskOn()) {
            return CreatePage.draw({ desc: item.desc, tag: item.tag, nl: item.nl, negative: item.extraNegative, size: item.meta.size,
                seed: Math.floor(Math.random() * 2 ** 32), characters: item.meta.characters || [], i2iRef: { id: e.from, mask: baseMask.data, strength: e.strength, feather: baseCfg.feather } }, 1);
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
