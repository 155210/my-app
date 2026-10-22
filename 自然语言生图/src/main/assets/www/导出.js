/*
 * 导出.js —— 保存到手机 / 分享时怎么处理图片里的出图信息
 *
 *   保留 keep    原图原样（默认，NAI 写在 PNG 里的提示词还在，拖回官网能读出来）
 *   清除 strip   PNG 去掉文字块（tEXt / zTXt / iTXt / eXIf / tIME），透明通道最低位的隐写信息抹掉（画面不变）；
 *                JPG 去掉 EXIF / XMP / 注释（保留色彩配置）；其他格式重新编码
 *   改写 rewrite 先清除，再把自己改过的提示词、种子、软件名等写回 PNG（只能一张一张来；不是 PNG 的会存成 PNG）
 *   每次问 ask   图库选项里能设成每次保存 / 分享前都问
 *
 *   设置存在 galleryPrefs.exportInfo（'keep' / 'strip' / 'ask'）。
 *   分享：App 里走外壳 shareBegin/Chunk/End/Send 调系统分享面板；浏览器里用 navigator.share，不支持就改成下载。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const MODES = [
        ['keep', '保留原信息', '原图原样，NAI 写在图里的提示词和参数都在，拖回 NovelAI 官网能读出来'],
        ['strip', '清除信息', '去掉图里藏的提示词、参数、软件名（PNG 文字块和透明通道隐写、JPG 的 EXIF），画面不变'],
        ['rewrite', '改写后导出', '自己改提示词、种子、软件名再写进图里（会存成 PNG）'],
    ];
    const PREF_MODES = [['keep', '保留原信息（默认）'], ['strip', '清除信息'], ['ask', '每次都问']];

    async function pref() {
        const p = await Gallery.getPrefs();
        return ['keep', 'strip', 'ask'].includes(p.exportInfo) ? p.exportInfo : 'keep';
    }

    // ------------------------------------------------------------
    // PNG 块
    // ------------------------------------------------------------
    const CRC = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(parts) {
        let c = 0xffffffff;
        for (const u8 of parts) for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }
    const SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
    const isPng = (u8) => u8.length > 8 && SIG.every((b, i) => u8[i] === b);
    const isJpg = (u8) => u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8;

    function chunks(u8) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
        for (let o = 8; o + 12 <= u8.length;) {
            const len = dv.getUint32(o);
            const type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
            out.push({ type, data: u8.subarray(o + 8, o + 8 + len) });
            o += 12 + len;
            if (type === 'IEND') break;
        }
        return out;
    }
    function buildPng(list) {
        const parts = [SIG];
        for (const c of list) {
            const head = new Uint8Array(8);
            new DataView(head.buffer).setUint32(0, c.data.length);
            head.set(ascii(c.type), 4);
            const tail = new Uint8Array(4);
            new DataView(tail.buffer).setUint32(0, crc32([head.subarray(4), c.data]));
            parts.push(head, c.data, tail);
        }
        return new Blob(parts, { type: 'image/png' });
    }
    const TEXT_TYPES = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'];
    /** tEXt 块（NAI 自己也是把 UTF-8 直接写进 tEXt） */
    function textChunk(key, value) {
        const k = ascii(key), v = new TextEncoder().encode(String(value));
        const data = new Uint8Array(k.length + 1 + v.length);
        data.set(k); data.set(v, k.length + 1);
        return { type: 'tEXt', data };
    }

    /** JPG：去掉 APP1（EXIF / XMP）、APP3~APP13、APP15、注释；留 APP0（JFIF）、APP2（色彩配置）、APP14（Adobe 色彩转换） */
    function stripJpg(u8) {
        const parts = [u8.subarray(0, 2)];
        let o = 2;
        while (o + 4 <= u8.length && u8[o] === 0xff) {
            const m = u8[o + 1];
            if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { parts.push(u8.subarray(o, o + 2)); o += 2; continue; }
            if (m === 0xff) { o += 1; continue; }
            const len = (u8[o + 2] << 8) | u8[o + 3];
            if (m === 0xda) { parts.push(u8.subarray(o)); o = u8.length; break; } // 图像数据开始，后面原样
            const drop = m === 0xfe || (m >= 0xe1 && m <= 0xef && m !== 0xe2 && m !== 0xee);
            if (!drop) parts.push(u8.subarray(o, o + 2 + len));
            o += 2 + len;
        }
        if (o < u8.length) parts.push(u8.subarray(o));
        return new Blob(parts, { type: 'image/jpeg' });
    }

    /** 画到画布再编码：清隐写（透明度最低位）或者转格式用 */
    async function reencode(blob, type, clearLsb) {
        const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        if (clearLsb) {
            const d = g.getImageData(0, 0, c.width, c.height);
            const px = d.data;
            // 不透明度最低位都改成 1（全透明的保持 0）：看不出差别，隐写的标记就读不出来了
            for (let i = 3; i < px.length; i += 4) if (px[i]) px[i] |= 1;
            g.putImageData(d, 0, 0);
        }
        const out = await new Promise((res) => c.toBlob(res, type, 0.95));
        if (!out) throw new Error('图片重新编码失败');
        return out;
    }

    const extOf = (blob, fallback) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type] || fallback || 'png');

    /** 清除图里的出图信息，返回新的 Blob */
    async function strip(blob) {
        const u8 = new Uint8Array(await blob.arrayBuffer());
        if (isPng(u8)) {
            let out = buildPng(chunks(u8).filter((c) => !TEXT_TYPES.includes(c.type)));
            if (await Gallery.stealthText(out)) out = await reencode(out, 'image/png', true);
            return out;
        }
        if (isJpg(u8)) return stripJpg(u8);
        const type = blob.type === 'image/webp' ? 'image/webp' : 'image/png';
        return reencode(blob, type, false);
    }

    /** 图里原来那段 NAI 的 Comment JSON（PNG 文字块或者隐写里的），没有返回 null */
    async function rawComment(blob) {
        try {
            const t = await Gallery.pngText(await blob.arrayBuffer());
            let raw = t.Comment;
            if (!raw) {
                const st = await Gallery.stealthText(blob);
                if (st) { try { const o = JSON.parse(st); raw = typeof o.Comment === 'string' ? o.Comment : JSON.stringify(o.Comment || o); } catch (e) { raw = ''; } }
            }
            const o = raw ? JSON.parse(raw) : null;
            return o && typeof o === 'object' ? o : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 改写：f = { prompt, negative, seed, software, source, title, keepParams }
     * 清掉原信息后写入 Title / Description / Software / Source / Comment（NAI 官网读的是 Comment 里的 prompt / uc）
     */
    async function rewrite(blob, f) {
        const orig = f.keepParams ? await rawComment(blob) : null;
        let png = await strip(blob);
        if (png.type !== 'image/png') png = await reencode(png, 'image/png', false);
        const c = Object.assign({}, orig || (f.keepParams ? f.params || {} : {}));
        c.prompt = f.prompt || '';
        c.uc = f.negative || '';
        if (String(f.seed || '').trim() !== '' && !isNaN(Number(f.seed))) c.seed = Number(f.seed); else delete c.seed;
        const fixCap = (o, text) => { if (o && o.caption && typeof o.caption === 'object') o.caption = Object.assign({}, o.caption, { base_caption: text }); };
        if (c.v4_prompt) { c.v4_prompt = Object.assign({}, c.v4_prompt); fixCap(c.v4_prompt, c.prompt); }
        if (c.v4_negative_prompt) { c.v4_negative_prompt = Object.assign({}, c.v4_negative_prompt); fixCap(c.v4_negative_prompt, c.uc); }
        const list = chunks(new Uint8Array(await png.arrayBuffer()));
        const add = [];
        if (f.title) add.push(textChunk('Title', f.title));
        if (c.prompt) add.push(textChunk('Description', c.prompt));
        if (f.software) add.push(textChunk('Software', f.software));
        if (f.source) add.push(textChunk('Source', f.source));
        if (c.prompt || c.uc || Object.keys(c).length > 2) add.push(textChunk('Comment', JSON.stringify(c)));
        const at = list.findIndex((x) => x.type === 'IHDR') + 1;
        list.splice(at, 0, ...add);
        return buildPng(list);
    }

    /** 一张图按方式处理好：返回 { blob, ext } */
    async function process(item, mode, fields) {
        const blob = await Gallery.getBlob(item.id);
        if (!blob) throw new Error('原图找不到了');
        if (mode === 'strip') { const b = await strip(blob); return { blob: b, ext: extOf(b, item.ext) }; }
        if (mode === 'rewrite') return { blob: await rewrite(blob, fields || {}), ext: 'png' };
        return { blob, ext: item.ext || extOf(blob) };
    }

    // ------------------------------------------------------------
    // 分享
    // ------------------------------------------------------------
    function b64(u8) {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
    }
    /** files = [{ blob, name }] */
    async function shareFiles(files) {
        const br = window.AndroidBridge;
        if (br && br.shareBegin) {
            const tokens = [];
            for (const f of files) {
                const name = String(f.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
                const tk = br.shareBegin(name);
                if (!tk || tk.startsWith('ERR:')) throw new Error(tk ? tk.slice(4) : '无法创建临时文件');
                for (let off = 0; off < f.blob.size; off += 512 * 1024) {
                    const r = br.shareChunk(tk, b64(new Uint8Array(await f.blob.slice(off, off + 512 * 1024).arrayBuffer())));
                    if (r && r.startsWith('ERR:')) throw new Error(r.slice(4));
                }
                const r = br.shareEnd(tk);
                if (r && r.startsWith('ERR:')) throw new Error(r.slice(4));
                tokens.push(tk);
            }
            const types = [...new Set(files.map((f) => f.blob.type || 'image/*'))];
            const r = br.shareSend(JSON.stringify(tokens), types.length === 1 ? types[0] : 'image/*', files.length > 1 ? '分享 ' + files.length + ' 张图' : '分享图片');
            if (r && r.startsWith('ERR:')) throw new Error(r.slice(4));
            return 'app';
        }
        if (br) throw new Error('这个版本的 App 还不能分享，先更新一下');
        const fs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
        if (navigator.canShare && navigator.canShare({ files: fs })) {
            try { await navigator.share({ files: fs }); } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; throw e; }
            return 'web';
        }
        for (const f of files) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(f.blob);
            a.download = f.name;
            a.click();
        }
        return 'download';
    }

    // ------------------------------------------------------------
    // 对外：保存 / 分享 / 选方式
    // ------------------------------------------------------------
    /** 按方式处理并保存 / 分享；onProgress(第几张, 共几张) */
    async function run(items, act, mode, fields, onProgress) {
        if (act === 'share') {
            const files = [];
            for (let i = 0; i < items.length; i++) {
                if (onProgress) onProgress(i + 1, items.length);
                const r = await process(items[i], mode, fields);
                files.push({ blob: r.blob, name: Gallery.fileName(Object.assign({}, items[i], { ext: r.ext })) });
            }
            const how = await shareFiles(files);
            if (how === 'download') toast('info', '这个浏览器不能直接分享，已改成下载' + (mode === 'keep' ? '' : '（已' + (mode === 'strip' ? '清除' : '改写') + '图片信息）'));
            return;
        }
        let ok = 0, where = '', err = '';
        for (let i = 0; i < items.length; i++) {
            if (onProgress) onProgress(i + 1, items.length);
            try { where = await Gallery.saveToPhone(items[i], mode === 'keep' ? null : await process(items[i], mode, fields)); ok++; } catch (x) { err = x.message || String(x); }
        }
        const tail = mode === 'strip' ? '（已清除图片信息）' : mode === 'rewrite' ? '（已改写图片信息）' : '';
        if (ok) toast('success', (items.length > 1 ? '存了 ' + ok + ' 张' + tail + (where ? '\n最后一张：' + where : '') : where + tail), '已保存');
        if (err) toast('error', (items.length > 1 ? (items.length - ok) + ' 张没存上：' : '') + err, '保存失败');
    }

    /** 按设置保存 / 分享（设成「每次都问」就弹选择） */
    async function go(items, act, onProgress) {
        if (!items.length) return;
        const m = await pref();
        if (m === 'ask') return open(items, act);
        try { await run(items, act, m, null, onProgress); } catch (e) { toast('error', e.message || String(e), act === 'share' ? '分享失败' : '保存失败'); }
    }
    const save = (items, onProgress) => go(items, 'save', onProgress);
    const share = (items, onProgress) => go(items, 'share', onProgress);

    /** 改写表单的初始值：图里读到的优先，读不到用 App 里存的配方 */
    async function defaults(item) {
        const blob = await Gallery.getBlob(item.id);
        let info = null;
        try { info = blob && await Gallery.readInfo(blob); } catch (e) { info = null; }
        const m = item.meta || {};
        const pp = (info && info.params) || {};
        const params = {};
        [['width', m.width], ['height', m.height], ['steps', m.steps], ['scale', m.scale], ['sampler', m.sampler], ['cfg_rescale', m.cfgRescale], ['noise_schedule', m.noiseSchedule]]
            .forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params[k] = v; });
        return {
            info,
            prompt: info ? info.prompt : m.positive || item.tag || '',
            negative: info ? info.negative : m.negative || '',
            seed: pp.seed !== undefined ? pp.seed : m.seed !== undefined ? m.seed : '',
            software: (info && info.software) || 'NovelAI',
            source: (info && info.source) || (window.Params && m.model ? Params.modelLabel(m.model) : m.model || ''),
            title: 'NovelAI generated image',
            params,
        };
    }

    /** 弹出选择：怎么处理图片信息，然后保存或分享；act 是先点的那个（高亮） */
    async function open(items, act) {
        if (!items.length) return;
        const one = items.length === 1;
        const cur = await pref();
        const d = one ? await defaults(items[0]) : null;
        const has = one ? (d.info ? '这张图里有出图信息（藏在' + d.info.from + '）' : '这张图里没读到出图信息，清除也就是去掉文件里的其他文字信息') : '选中了 ' + items.length + ' 张';
        const modes = one ? MODES : MODES.slice(0, 2);
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>导出：图片信息怎么处理</h3>'
            + '<div class="card-sub" style="margin:-6px 0 10px">' + esc(has) + '</div>'
            + modes.map(([k, t, h]) => '<label class="check radio"><input type="radio" name="x-mode" value="' + k + '"' + ((cur === 'ask' ? 'keep' : cur) === k ? ' checked' : '') + '>'
                + '<span>' + esc(t) + '<div class="help">' + esc(h) + '</div></span></label>').join('')
            + (one ? '<div class="x-form" hidden>'
                + '<div class="field"><label>正面提示词</label><textarea class="ta small" data-f="prompt">' + esc(d.prompt) + '</textarea></div>'
                + '<div class="field"><label>负面提示词</label><textarea class="ta small" data-f="negative">' + esc(d.negative) + '</textarea></div>'
                + '<div class="field"><label>种子（空着就不写）</label><input type="text" inputmode="numeric" data-f="seed" value="' + esc(d.seed) + '"></div>'
                + '<div class="field"><label>软件</label><input type="text" data-f="software" value="' + esc(d.software) + '"></div>'
                + '<div class="field"><label>模型 / 来源</label><input type="text" data-f="source" value="' + esc(d.source) + '"></div>'
                + '<div class="field"><label>标题</label><input type="text" data-f="title" value="' + esc(d.title) + '"></div>'
                + '<label class="check"><input type="checkbox" data-f="keepParams" checked><span>保留其他出图参数<div class="help">尺寸、步数、采样器、CFG 这些照原来的写回去；不勾就只写上面这几项</div></span></label>'
                + '<div class="btns" style="justify-content:flex-start"><button class="btn small" data-clear="prompt">清空正面</button><button class="btn small" data-clear="negative">清空负面</button><button class="btn small" data-clear="seed">去掉种子</button></div>'
                + '</div>' : '')
            + '<label class="check" data-remember-row><input type="checkbox" data-remember><span>以后保存和分享都这样，不再问<div class="help">在「图库选项」里随时能改</div></span></label>'
            + '<div class="btns"><button class="btn" data-close>取消</button>'
            + '<button class="btn' + (act === 'share' ? ' primary' : '') + '" data-go="share">分享</button>'
            + '<button class="btn' + (act === 'share' ? '' : ' primary') + '" data-go="save">保存到手机</button></div>');
        const form = $('.x-form', L.box), remRow = $('[data-remember-row]', L.box);
        const mode = () => (L.box.querySelector('input[name="x-mode"]:checked') || {}).value || 'keep';
        const sync = () => { if (form) form.hidden = mode() !== 'rewrite'; remRow.hidden = mode() === 'rewrite'; };
        L.box.querySelectorAll('input[name="x-mode"]').forEach((x) => { x.onchange = sync; });
        sync();
        L.box.addEventListener('click', async (e) => {
            const c = e.target.closest('[data-clear]');
            if (c) { $('[data-f="' + c.dataset.clear + '"]', L.box).value = ''; return; }
            const b = e.target.closest('[data-go]'); if (!b) return;
            const m = mode();
            let fields = null;
            if (m === 'rewrite') {
                fields = { params: d.params };
                L.box.querySelectorAll('[data-f]').forEach((x) => { fields[x.dataset.f] = x.type === 'checkbox' ? x.checked : x.value.trim(); });
            }
            if (m !== 'rewrite' && $('[data-remember]', L.box).checked) await Gallery.setPrefs({ exportInfo: m });
            const btns = L.box.querySelectorAll('[data-go]');
            btns.forEach((x) => { x.disabled = true; });
            const label = b.textContent;
            try {
                await run(items, b.dataset.go, m, fields, (i, n) => { if (n > 1) b.textContent = i + '/' + n; });
                UI.closeLayer(L);
            } catch (err) {
                toast('error', err.message || String(err), b.dataset.go === 'share' ? '分享失败' : '保存失败');
                btns.forEach((x) => { x.disabled = false; });
                b.textContent = label;
            }
        });
        return L;
    }

    /** 图库选项里的一段：默认怎么处理 */
    function optionsHtml(p) {
        const cur = ['keep', 'strip', 'ask'].includes(p.exportInfo) ? p.exportInfo : 'keep';
        return '<div class="section-title">保存 / 分享时的图片信息</div>'
            + PREF_MODES.map(([k, t]) => '<label class="check radio"><input type="radio" name="g-exinfo" value="' + k + '"' + (cur === k ? ' checked' : '') + '><span>' + t + '</span></label>').join('')
            + '<div style="margin:-4px 0 14px;font-size:12px;color:var(--faint)">清除：去掉图里藏的提示词和参数再存 / 分享，画面不变，App 里的原图和配方不动。想单张改写提示词，长按图片选「导出（处理图片信息）」。</div>';
    }
    function bindOptions(box) {
        box.querySelectorAll('input[name="g-exinfo"]').forEach((x) => { x.onchange = () => Gallery.setPrefs({ exportInfo: x.value }); });
    }

    if (window.Help) Help.add({ id: 'gallery.export', group: '图库', title: '分享和图片信息', target: '#view-gallery .acts [data-a="share"]', tip: '分享前可以清除或改写图里藏的提示词',
        text: 'NAI 出的 PNG 里藏着提示词和参数。保存或分享时可以：保留原样；清除（去掉 PNG 文字块和透明通道隐写、JPG 的 EXIF，画面不变）；或者改写（自己改提示词、种子、软件名再写进去，只能一张一张来）。\n默认保留，图库选项「保存 / 分享时的图片信息」能改成清除或每次问。长按图片选「导出（处理图片信息）…」随时单独选。App 里的原图和配方都不动。' });

    window.ExportInfo = { save, share, open, run, strip, rewrite, process, shareFiles, optionsHtml, bindOptions, pref };
})();
