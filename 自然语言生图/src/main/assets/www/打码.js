/*
 * 打码.js —— 【自动打码】在手机上识别敏感部位，打马赛克 / 模糊 / 黑条 / 白光，结果另存一张进图库（原图不动）
 *
 * 模型和运行库在 依赖/打码/（不进 git，Actions 打包前由 工具/下载打码模型.py 下载）：
 *   动漫.onnx  deepghs/anime_censor_detection（YOLOv8）：nipple_f / penis / pussy，二次元图用
 *   写实.onnx  NudeNet 320n（YOLOv8）：露出的胸部、下体、肛门、臀部……偏写实的图用
 *   *.json     { imgsz: [宽, 高], labels: [...], pad: 先补成正方形再缩 }
 *   ort.js / ort.wasm  onnxruntime-web 纯 WASM 单线程版，第一次用到才加载
 * 两个模型的输出都是 YOLOv8 的 [1, 4 + 类别数, 框数]（中心 xywh + 每类分数），这里自己做阈值和 NMS。
 *
 * 入口：大图下面「打码」（编辑页：点框开关、拖一下手动加框、换样式、调力度和范围）；
 *       设置页「打码」标签：模型、要打的部位、默认样式、灵敏度、出图后自动另存一张打码版。
 * 设置在 settings.nai.censor（老设置没有就用 CFG_DEFAULTS）。
 * 打码的图配方照原图抄，加 meta.edit = { kind: 'censor', label: '打码', from, style, n }，所以有「对比原图」。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const DIR = '依赖/打码/';

    const MODELS = [
        { value: 'anime', label: '动漫（二次元图，默认）' },
        { value: 'real', label: '写实（偏真人的图，多认臀部、肛门）' },
        { value: 'both', label: '两个都用（慢一倍，漏得少）' },
    ];
    const PARTS = [['nipple', '乳头'], ['breast', '露出的胸部'], ['pussy', '女性下体'], ['penis', '男性下体'], ['anus', '肛门'], ['butt', '臀部']];
    const PART_NAME = Object.fromEntries(PARTS);
    /** 模型的类别 → 部位（不在表里的类别不管） */
    const LABEL_PART = {
        nipple_f: 'nipple', penis: 'penis', pussy: 'pussy',
        FEMALE_BREAST_EXPOSED: 'breast', FEMALE_GENITALIA_EXPOSED: 'pussy', MALE_GENITALIA_EXPOSED: 'penis', ANUS_EXPOSED: 'anus', BUTTOCKS_EXPOSED: 'butt',
    };
    const STYLES = [['mosaic', '马赛克'], ['blur', '模糊'], ['black', '黑条'], ['white', '白光']];
    const SHAPES = [['rect', '方形'], ['round', '圆形']];
    const CFG_DEFAULTS = {
        model: 'anime', style: 'mosaic', shape: 'rect', strength: 50, expand: 15, threshold: 30, auto: false,
        parts: { nipple: true, breast: true, pussy: true, penis: true, anus: true, butt: false },
    };

    function cfg() {
        const n = UI.settings.nai;
        if (!n.censor || typeof n.censor !== 'object') n.censor = {};
        const c = n.censor;
        for (const k in CFG_DEFAULTS) if (c[k] === undefined) c[k] = k === 'parts' ? Object.assign({}, CFG_DEFAULTS.parts) : CFG_DEFAULTS[k];
        for (const k in CFG_DEFAULTS.parts) if (c.parts[k] === undefined) c.parts[k] = CFG_DEFAULTS.parts[k];
        return c;
    }
    const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

    // ------------------------------------------------------------
    // 识别
    // ------------------------------------------------------------
    let ortP = null;
    function loadOrt() {
        if (!ortP) {
            ortP = (async () => {
                if (!window.ort) {
                    await new Promise((res, rej) => {
                        const s = document.createElement('script');
                        s.src = DIR + 'ort.js';
                        s.onload = res;
                        s.onerror = () => rej(new Error('这个安装包里没有识别程序（依赖/打码/ort.js）'));
                        document.head.appendChild(s);
                    });
                }
                const r = await fetch(DIR + 'ort.wasm');
                if (!r.ok) throw new Error('这个安装包里没有识别程序（依赖/打码/ort.wasm）');
                ort.env.wasm.wasmBinary = await r.arrayBuffer();
                ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': DIR + 'ort.wasm', 'ort-wasm.wasm': DIR + 'ort.wasm' };
                ort.env.wasm.numThreads = 1; // WebView 里没有跨源隔离，多线程用不了
                ort.env.wasm.proxy = false;
                return window.ort;
            })().catch((e) => { ortP = null; throw e; });
        }
        return ortP;
    }

    const sessions = {};
    function loadModel(k) {
        const file = k === 'real' ? '写实' : '动漫';
        if (!sessions[file]) {
            sessions[file] = (async () => {
                const ort = await loadOrt();
                const [ri, rm] = await Promise.all([fetch(DIR + file + '.json'), fetch(DIR + file + '.onnx')]);
                if (!ri.ok || !rm.ok) throw new Error('这个安装包里没有「' + file + '」识别模型，设置页「打码」换一个模型试试');
                const info = await ri.json();
                const s = await ort.InferenceSession.create(new Uint8Array(await rm.arrayBuffer()), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
                return { s, info, file };
            })().catch((e) => { delete sessions[file]; throw e; });
        }
        return sessions[file];
    }

    /** 图 → 模型输入（RGB、0~1、CHW）；pad：先在右下补黑成正方形（NudeNet），否则直接拉伸（deepghs） */
    function toTensor(img, info) {
        const [W, H] = info.imgsz;
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
        let sx, sy;
        if (info.pad) {
            const side = Math.max(w, h);
            g.drawImage(img, 0, 0, w * W / side, h * H / side);
            sx = side / W; sy = side / H;
        } else {
            g.drawImage(img, 0, 0, W, H);
            sx = w / W; sy = h / H;
        }
        const px = g.getImageData(0, 0, W, H).data, n = W * H;
        const data = new Float32Array(3 * n);
        for (let i = 0; i < n; i++) {
            data[i] = px[i * 4] / 255;
            data[n + i] = px[i * 4 + 1] / 255;
            data[2 * n + i] = px[i * 4 + 2] / 255;
        }
        return { data, W, H, sx, sy, w, h };
    }

    const iou = (a, b) => {
        const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
        const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
        return i / (a.w * a.h + b.w * b.h - i || 1);
    };
    /** 同一部位重叠的框只留分数高的 */
    function nms(boxes, th) {
        boxes = boxes.slice().sort((a, b) => b.score - a.score);
        const out = [];
        for (const b of boxes) if (!out.some((o) => o.part === b.part && iou(o, b) > th)) out.push(b);
        return out;
    }

    /**
     * YOLOv8 输出 → 框。out：Float32Array，dims [1, 4 + 类别数, 框数]；m：toTensor 的结果（缩放比例、原图大小）
     * 返回 [{ x, y, w, h, part, score, label }]（原图像素），只留 parts 里开着的部位、分数 ≥ th 的
     */
    function parse(out, dims, labels, m, parts, th) {
        const C = dims[1], N = dims[2], boxes = [];
        if (C !== 4 + labels.length) throw new Error('识别模型的输出不对（' + dims.join('×') + '）');
        for (let i = 0; i < N; i++) {
            let best = 0, bi = -1;
            for (let c = 4; c < C; c++) { const v = out[c * N + i]; if (v > best) { best = v; bi = c - 4; } }
            if (best < th) continue;
            const part = LABEL_PART[labels[bi]];
            if (!part || !parts[part]) continue;
            const cx = out[i] * m.sx, cy = out[N + i] * m.sy, bw = out[2 * N + i] * m.sx, bh = out[3 * N + i] * m.sy;
            const x = Math.max(0, cx - bw / 2), y = Math.max(0, cy - bh / 2);
            const b = { x, y, w: Math.min(m.w, cx + bw / 2) - x, h: Math.min(m.h, cy + bh / 2) - y, part, score: best, label: labels[bi] };
            if (b.w > 1 && b.h > 1) boxes.push(b);
        }
        return nms(boxes, 0.45);
    }

    /** 识别一张图（HTMLImageElement / canvas），返回框（原图像素） */
    async function detect(img, opt) {
        const c = Object.assign({}, cfg(), opt || {});
        const th = num(c.threshold, 5, 95, 30) / 100;
        const keys = c.model === 'both' ? ['anime', 'real'] : [c.model === 'real' ? 'real' : 'anime'];
        let all = [];
        for (const k of keys) {
            const md = await loadModel(k);
            const t = toTensor(img, md.info);
            const res = await md.s.run({ [md.s.inputNames[0]]: new window.ort.Tensor('float32', t.data, [1, 3, t.H, t.W]) });
            const o = res[md.s.outputNames[0]];
            all = all.concat(parse(o.data, o.dims, md.info.labels, t, c.parts, th).map((b) => Object.assign(b, { model: md.file })));
        }
        return nms(all, 0.45);
    }

    // ------------------------------------------------------------
    // 打码
    // ------------------------------------------------------------
    /** 框按 expand%（每边加框宽高的这么多）放大，不出图 */
    function grow(b, expand, w, h) {
        const ex = b.w * expand / 100, ey = b.h * expand / 100;
        const x = Math.max(0, b.x - ex), y = Math.max(0, b.y - ey);
        return { x, y, w: Math.min(w, b.x + b.w + ex) - x, h: Math.min(h, b.y + b.h + ey) - y };
    }

    /** 把 boxes（on !== false 的）打上码，返回原尺寸的 canvas；c: { style, shape, strength, expand } */
    function render(img, boxes, c, into) {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const cv = into || document.createElement('canvas');
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
        const g = cv.getContext('2d');
        g.clearRect(0, 0, w, h);
        g.drawImage(img, 0, 0);
        const list = boxes.filter((b) => b.on !== false);
        if (!list.length) return cv;
        const k = num(c.strength, 1, 100, 50) / 100, long = Math.max(w, h);
        let fill = null; // 马赛克 / 模糊：先把整张做一遍，再按框裁进来（马赛克格子全图对齐）
        if (c.style === 'mosaic') {
            const cell = Math.max(3, Math.round(long * (0.005 + 0.035 * k)));
            const sw = Math.max(1, Math.ceil(w / cell)), sh = Math.max(1, Math.ceil(h / cell));
            const s = document.createElement('canvas'); s.width = sw; s.height = sh;
            const sg = s.getContext('2d');
            sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'medium';
            sg.drawImage(img, 0, 0, sw * cell, sh * cell, 0, 0, sw, sh); // 右下多出来的半格按原图边缘取
            fill = document.createElement('canvas'); fill.width = w; fill.height = h;
            const fg = fill.getContext('2d');
            fg.imageSmoothingEnabled = false;
            fg.drawImage(s, 0, 0, sw * cell, sh * cell);
        } else if (c.style === 'blur') {
            const r = Math.max(2, Math.round(long * (0.004 + 0.03 * k)));
            fill = document.createElement('canvas'); fill.width = w; fill.height = h;
            const fg = fill.getContext('2d');
            fg.filter = 'blur(' + r + 'px)';
            fg.drawImage(img, 0, 0);
            fg.filter = 'blur(' + r + 'px)';
            fg.drawImage(fill, 0, 0); // 糊两遍，力度大时看不出轮廓
            fg.filter = 'none';
        }
        for (const b of list) {
            const r = grow(b, num(c.expand, 0, 100, 15), w, h);
            g.save();
            g.beginPath();
            if (c.shape === 'round') g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
            else g.rect(r.x, r.y, r.w, r.h);
            g.clip();
            if (fill) g.drawImage(fill, 0, 0);
            else {
                if (c.style === 'white') {
                    const gr = g.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 0, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) / 2);
                    gr.addColorStop(0, '#fff'); gr.addColorStop(0.75, 'rgba(255,255,255,.98)'); gr.addColorStop(1, 'rgba(255,255,255,.85)');
                    g.fillStyle = gr;
                } else g.fillStyle = '#000';
                g.fillRect(r.x, r.y, r.w, r.h);
            }
            g.restore();
        }
        return cv;
    }

    const toBlob = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('存不了这张图'))), 'image/png'));

    /** 存成图库里新的一张（文字字段、配方照原图） */
    async function saveItem(item, cv, boxes, c, auto) {
        const n = boxes.filter((b) => b.on !== false).length;
        const edit = { kind: 'censor', label: '打码', from: item.id, style: c.style, n };
        if (auto) edit.auto = true;
        const blob = await toBlob(cv);
        const res = await Gallery.add(blob, 'png', {
            desc: item.desc || '', tag: item.tag || '', nl: item.nl || '', extraNegative: item.extraNegative || '',
            albums: item.albums ? item.albums.slice() : undefined,
            meta: Object.assign({}, item.meta, { width: cv.width, height: cv.height, edit }),
        });
        if (window.GalleryPage) GalleryPage.refresh();
        return res;
    }

    // ------------------------------------------------------------
    // 编辑页
    // ------------------------------------------------------------
    const ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/></svg>';

    async function open(item) {
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '这张图的文件找不到了'); return null; }
        const img = await ImgEdit.loadImg(blob);
        const c0 = cfg();
        const st = { style: c0.style, shape: c0.shape, strength: num(c0.strength, 1, 100, 50), expand: num(c0.expand, 0, 100, 15) };
        let boxes = [], busy = false;
        const seg = (k, list, v) => '<div class="seg" data-seg="' + k + '">' + list.map((x) => '<button data-v="' + x[0] + '" class="' + (x[0] === v ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>';
        const slider = (k, label, min, max, v, unit) => '<div class="vibe-slider"><span>' + label + '</span><input type="range" min="' + min + '" max="' + max + '" step="1" data-r="' + k + '" value="' + v + '"><b>' + v + (unit || '') + '</b></div>';
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>打码</b><span class="grow"></span>'
            + '<button class="btn small" data-a="redo">重新识别</button></div>'
            + '<div class="cz-stage" data-stage><canvas data-cv></canvas><div class="cz-boxes" data-boxes></div></div>'
            + '<div class="cz-panel">'
            + '<div class="cz-status" data-status>识别中…（第一次要加载模型，稍等几秒）</div>'
            + '<div class="cz-chips" data-chips></div>'
            + '<div class="cz-tip">点框 = 打 / 不打这一处；在图上拖一下 = 手动加一个框</div>'
            + '<div class="cz-row">' + seg('style', STYLES, st.style) + seg('shape', SHAPES, st.shape) + '</div>'
            + slider('strength', '力度', 1, 100, st.strength) + slider('expand', '扩大范围', 0, 60, st.expand, '%')
            + '<div class="btns"><button class="btn" data-a="clear">全部不打</button><button class="btn primary" data-a="save">保存（另存一张）</button></div>'
            + '</div>');
        const cv = $('[data-cv]', L.box), lay = $('[data-boxes]', L.box), stage = $('[data-stage]', L.box);
        const status = (t) => { $('[data-status]', L.box).textContent = t; };
        const W = img.naturalWidth, H = img.naturalHeight;

        const draw = () => {
            render(img, boxes, st, cv);
            // 框的位置：和画布在屏幕上的位置对齐
            const r = cv.getBoundingClientRect(), sr = stage.getBoundingClientRect();
            Object.assign(lay.style, { left: r.left - sr.left + 'px', top: r.top - sr.top + 'px', width: r.width + 'px', height: r.height + 'px' });
            lay.innerHTML = boxes.map((b, i) => '<div class="cz-box' + (b.on === false ? ' off' : '') + (b.manual ? ' manual' : '') + '" data-i="' + i + '" style="left:' + b.x / W * 100 + '%;top:' + b.y / H * 100
                + '%;width:' + b.w / W * 100 + '%;height:' + b.h / H * 100 + '%"><i>' + (i + 1) + '</i></div>').join('');
            $('[data-chips]', L.box).innerHTML = boxes.map((b, i) => '<button class="ps-chip' + (b.on === false ? '' : ' on') + '" data-i="' + i + '">' + (i + 1) + ' ' + esc(PART_NAME[b.part] || '手动')
                + (b.manual ? '' : ' ' + Math.round(b.score * 100) + '%') + '</button>').join('');
        };
        const toggle = (i) => {
            const b = boxes[i]; if (!b) return;
            if (b.manual && b.on !== false) boxes.splice(i, 1); else b.on = b.on === false;
            draw();
        };

        async function run() {
            if (busy) return;
            busy = true;
            status('识别中…');
            try {
                const t0 = Date.now();
                const found = await detect(img);
                boxes = boxes.filter((b) => b.manual).concat(found.map((b) => Object.assign(b, { on: true })));
                status(found.length ? '找到 ' + found.length + ' 处（' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒），不对的点一下关掉' : '没认出要打码的地方，可以在图上拖一下手动加框');
            } catch (e) {
                status('识别失败：' + (e.message || e) + '。还是可以手动拖框打码');
            } finally { busy = false; draw(); }
        }

        // 拖一下加框，点一下开关
        let start = null;
        const at = (ev) => { const r = lay.getBoundingClientRect(); return { x: Math.min(W, Math.max(0, (ev.clientX - r.left) / r.width * W)), y: Math.min(H, Math.max(0, (ev.clientY - r.top) / r.height * H)), cx: ev.clientX, cy: ev.clientY }; };
        let ghost = null;
        lay.addEventListener('pointerdown', (ev) => {
            start = at(ev);
            start.hit = ev.target.closest('.cz-box');
            try { lay.setPointerCapture(ev.pointerId); } catch (_) { /* 合成事件 */ }
        });
        lay.addEventListener('pointermove', (ev) => {
            if (!start) return;
            const p = at(ev);
            if (Math.abs(p.cx - start.cx) + Math.abs(p.cy - start.cy) < 10) return;
            if (!ghost) { ghost = document.createElement('div'); ghost.className = 'cz-box manual ghost'; lay.appendChild(ghost); }
            Object.assign(ghost.style, { left: Math.min(p.x, start.x) / W * 100 + '%', top: Math.min(p.y, start.y) / H * 100 + '%', width: Math.abs(p.x - start.x) / W * 100 + '%', height: Math.abs(p.y - start.y) / H * 100 + '%' });
        });
        const end = (ev) => {
            if (!start) return;
            const p = at(ev), s = start;
            start = null;
            if (ghost) { ghost.remove(); ghost = null; }
            if (Math.abs(p.cx - s.cx) + Math.abs(p.cy - s.cy) < 10) { if (s.hit) toggle(Number(s.hit.dataset.i)); return; }
            const b = { x: Math.min(p.x, s.x), y: Math.min(p.y, s.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y), part: '', score: 1, manual: true, on: true };
            if (b.w > 4 && b.h > 4) { boxes.push(b); draw(); }
        };
        lay.addEventListener('pointerup', end);
        lay.addEventListener('pointercancel', () => { start = null; if (ghost) { ghost.remove(); ghost = null; } });

        $('[data-chips]', L.box).onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) toggle(Number(b.dataset.i)); };
        $$('[data-seg]', L.box).forEach((s) => { s.onclick = (e) => {
            const b = e.target.closest('[data-v]'); if (!b) return;
            st[s.dataset.seg] = b.dataset.v;
            $$('button', s).forEach((x) => x.classList.toggle('on', x === b));
            draw();
        }; });
        $$('[data-r]', L.box).forEach((r) => { r.oninput = () => { st[r.dataset.r] = Number(r.value); r.nextElementSibling.textContent = r.value + (r.dataset.r === 'expand' ? '%' : ''); draw(); }; });
        $('[data-a="redo"]', L.box).onclick = run;
        $('[data-a="clear"]', L.box).onclick = () => { boxes = boxes.filter((b) => !b.manual); boxes.forEach((b) => { b.on = false; }); draw(); };
        $('[data-a="save"]', L.box).onclick = async (e) => {
            if (!boxes.some((b) => b.on !== false)) { toast('warning', '还没有要打码的地方'); return; }
            e.target.disabled = true;
            try {
                const res = await saveItem(item, render(img, boxes, st), boxes, st);
                // 这次选的样式记成默认
                Object.assign(cfg(), { style: st.style, shape: st.shape, strength: st.strength, expand: st.expand });
                UI.saveSettings();
                UI.closeLayer(L);
                toast('success', '打码的图另存进图库了，原图没动');
                if (window.ImgTools && ImgTools.compare) ImgTools.compare(item, res);
            } catch (err) {
                toast('error', err.message || String(err), '保存失败');
                e.target.disabled = false;
            }
        };
        const onResize = () => draw();
        window.addEventListener('resize', onResize);
        const prev = L.onClose;
        L.onClose = () => { window.removeEventListener('resize', onResize); if (prev) prev(); };
        draw();
        run();
        L.state = () => ({ boxes, st, busy }); // 测试用
        return L;
    }

    // ------------------------------------------------------------
    // 出图后自动另存一张打码版
    // ------------------------------------------------------------
    let autoQ = Promise.resolve();
    async function autoOne(item) {
        try {
            const blob = await Gallery.getBlob(item.id);
            if (!blob) return null;
            const img = await ImgEdit.loadImg(blob);
            const boxes = await window.Censor.detect(img); // 走 window.Censor，测试能换掉
            if (!boxes.length) return null;
            const c = cfg();
            const res = await saveItem(item, render(img, boxes, c), boxes, c, true);
            toast('info', '找到 ' + boxes.length + ' 处，已另存一张打码版', '自动打码');
            return res;
        } catch (e) {
            toast('warning', e.message || String(e), '自动打码失败');
            return null;
        }
    }
    const rawAdd = Gallery.add;
    Gallery.add = async function (blob, ext, info) {
        const item = await rawAdd.apply(this, arguments);
        // 只管新出的图：编辑、放大、打码出来的（meta.edit）和导入的不自动打
        if (cfg().auto && info && info.meta && !info.meta.edit && !info.imported) {
            const p = autoQ.then(() => autoOne(item));
            autoQ = p.catch(() => null);
            if (window.__censorAuto) window.__censorAuto.push(p); // 测试用
        }
        return item;
    };

    // ------------------------------------------------------------
    // 大图按钮、设置页
    // ------------------------------------------------------------
    if (window.GalleryPage && GalleryPage.addViewerAction) {
        GalleryPage.addViewerAction({ id: 'censor', label: '打码', icon: ICON, run: (item) => open(item) });
    }

    if (window.SettingsPage && SettingsPage.addTab) {
        const check = (label, k, help) => '<label class="check"><span class="switch"><input type="checkbox" data-k="' + k + '"><span></span></span><span>' + esc(label)
            + (help ? '<div class="help">' + help + '</div>' : '') + '</span></label>';
        const select = (label, k, list, help) => '<div class="field"><label>' + esc(label) + '</label><select data-k="' + k + '">'
            + list.map((x) => '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>').join('') + '</select>' + (help ? '<div class="help">' + help + '</div>' : '') + '</div>';
        const range = (label, k, min, max, help) => '<div class="field"><label>' + esc(label) + '</label><input type="range" min="' + min + '" max="' + max + '" step="1" data-k="' + k + '">'
            + (help ? '<div class="help">' + help + '</div>' : '') + '</div>';
        SettingsPage.addTab({
            id: 'censor', label: '打码',
            html: () => {
                cfg();
                return '<div class="help" style="margin-bottom:12px">在手机上认出敏感部位自动打码，不联网、不花 Anlas。大图下面点「打码」，认出来的框可以点掉、也可以自己拖框。打码的图另存一张，原图不动。</div>'
                    + select('识别模型', 'nai.censor.model', MODELS.map((m) => [m.value, m.label]), '二次元图用「动漫」；偏真人、厚涂的图「写实」更准')
                    + '<div class="label">要打码的部位</div>'
                    + PARTS.map((p) => check(p[1], 'nai.censor.parts.' + p[0], p[0] === 'breast' ? '「写实」模型认的是整个胸部；「动漫」模型只认乳头' : p[0] === 'anus' || p[0] === 'butt' ? '只有「写实」模型认' : '')).join('')
                    + range('灵敏度（越往左越容易认出，也越容易认错）', 'nai.censor.threshold', 10, 70, '默认 30')
                    + select('默认样式', 'nai.censor.style', STYLES) + select('形状', 'nai.censor.shape', SHAPES)
                    + range('力度（马赛克格子、模糊程度）', 'nai.censor.strength', 1, 100) + range('扩大范围（框往外扩多少）', 'nai.censor.expand', 0, 60)
                    + check('出图后自动打码', 'nai.censor.auto', '每出好一张就认一遍，认出来了就另存一张打码版（原图也留着）；编辑、放大出来的图和导入的图不自动打');
            },
        });
    }

    const css = document.createElement('style');
    css.textContent = [
        '.cz-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; }',
        '.cz-stage canvas { max-width: 100%; max-height: 100%; display: block; }',
        '.cz-boxes { position: absolute; touch-action: none; user-select: none; -webkit-user-select: none; }',
        '.cz-box { position: absolute; border: 2px solid #ff4d6d; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0,0,0,.5); }',
        '.cz-box.manual { border-color: #4dabff; }',
        '.cz-box.off { border-style: dashed; opacity: .6; }',
        '.cz-box.ghost { border-style: dashed; pointer-events: none; }',
        '.cz-box i { position: absolute; left: -2px; top: -18px; font: 600 11px/16px sans-serif; font-style: normal; padding: 0 5px; border-radius: 4px; background: #ff4d6d; color: #fff; }',
        '.cz-box.manual i { background: #4dabff; }',
        '.cz-panel { flex: none; max-height: 46vh; overflow-y: auto; padding: 10px 16px calc(12px + var(--safe-bottom)); border-top: 1px solid var(--line); }',
        '.cz-status { font-size: 13px; color: var(--dim); margin-bottom: 8px; }',
        '.cz-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }',
        '.cz-chips:empty { display: none; }',
        '.cz-tip { font-size: 12px; color: var(--faint); margin-bottom: 10px; }',
        '.cz-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }',
        '.cz-row .seg button { padding: 6px 11px; }',
    ].join('\n');
    document.head.appendChild(css);

    if (window.Help && Help.add) {
        Help.add({ id: 'censor', group: '图库', title: '打码', target: '[data-q="censor"]', tip: '自动认出敏感部位打码，另存一张，原图不动',
            text: '大图下面「打码」：在手机上自动认出乳头、下体等敏感部位，打上马赛克 / 模糊 / 黑条 / 白光。红框是认出来的，点一下就不打这处；在图上拖一下能手动加框（蓝框）。可以调力度、扩大范围、换方形圆形。保存是另存一张，原图不动，存好自动打开前后对比。\n设置页「打码」：换识别模型（动漫 / 写实 / 两个都用）、选要打的部位、灵敏度；打开「出图后自动打码」，每出一张就自动另存一张打码版。\n全在手机上算，不联网、不花 Anlas。' });
    }

    window.Censor = { open, detect, render, parse, cfg, autoOne, CFG_DEFAULTS, PARTS, LABEL_PART };
})();
