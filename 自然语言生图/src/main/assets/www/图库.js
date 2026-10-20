/*
 * 图库.js —— 图库数据：每张图的原图（Blob）和出图配方
 *
 *   gallery       索引数组（新的在前）：{ id, time, ext, bytes, origExt, thumb, desc, tag, nl, extraNegative, meta }
 *   img:<id>      原图 Blob
 *   galleryPrefs  图库自己的偏好：{ size: 小/中/大/铺满, jpg: PNG 自动转 JPG, quality: JPG 质量 }
 * 界面在 页面-图库.js。
 *
 * NAI 出的 PNG 里自带出图信息（tEXt 的 Comment JSON + 透明通道最低位的「隐写」信息），
 * 存原 PNG 才能拖回 NovelAI 官网读出提示词；转成 JPG 这些就没了，所以转 JPG 默认关。
 * readInfo(blob) 把这些信息读出来。
 */
(function () {
    'use strict';

    let index = null;

    const SIZES = [['s', '小'], ['m', '中'], ['l', '大'], ['full', '铺满']];
    const PREFS = { size: 'm', jpg: false, quality: 0.92 };
    let prefs = null;

    async function getPrefs() {
        if (!prefs) prefs = Object.assign({}, PREFS, await Store.get('galleryPrefs', {}));
        return prefs;
    }
    async function setPrefs(patch) {
        Object.assign(await getPrefs(), patch);
        await Store.set('galleryPrefs', prefs);
        return prefs;
    }

    async function list() {
        if (!index) index = await Store.get('gallery', []);
        return index;
    }

    /** 做一张最长边 360 的 JPEG 缩略图（dataURL），图库网格用 */
    async function makeThumb(blob) {
        try {
            const bmp = await createImageBitmap(blob);
            const k = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
            const c = document.createElement('canvas');
            c.width = Math.round(bmp.width * k);
            c.height = Math.round(bmp.height * k);
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            return c.toDataURL('image/jpeg', 0.8);
        } catch (e) {
            return '';
        }
    }

    /** PNG → JPG；转不了或转完反而更大就返回 null（配方另存在索引里，不靠 PNG 里的元数据） */
    async function toJpg(blob, quality) {
        try {
            const bmp = await createImageBitmap(blob);
            const c = document.createElement('canvas');
            c.width = bmp.width;
            c.height = bmp.height;
            const g = c.getContext('2d');
            g.fillStyle = '#fff'; // 透明处垫白
            g.fillRect(0, 0, c.width, c.height);
            g.drawImage(bmp, 0, 0);
            const jpg = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality || PREFS.quality));
            return jpg && jpg.size < blob.size ? jpg : null;
        } catch (e) {
            return null;
        }
    }

    async function add(blob, ext, info) {
        const items = await list();
        const item = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: Date.now(), ext }, info);
        const p = await getPrefs();
        if (p.jpg && String(ext).toLowerCase() === 'png') {
            const jpg = await toJpg(blob, p.quality);
            if (jpg) { blob = jpg; item.origExt = 'png'; item.ext = 'jpg'; }
        }
        item.bytes = blob.size;
        item.thumb = await makeThumb(blob);
        await Store.set('img:' + item.id, blob);
        items.unshift(item);
        await Store.set('gallery', items);
        return item;
    }

    /** 把图库里已有的 PNG 都转成 JPG，onProgress(已处理, 总数)；返回 { n: 转了几张, saved: 省下的字节 } */
    async function convertAll(onProgress) {
        const items = await list();
        const p = await getPrefs();
        const todo = items.filter((x) => String(x.ext).toLowerCase() === 'png');
        let n = 0, saved = 0;
        for (let i = 0; i < todo.length; i++) {
            const item = todo[i];
            const blob = await getBlob(item.id);
            const jpg = blob && await toJpg(blob, p.quality);
            if (jpg) {
                await Store.set('img:' + item.id, jpg);
                saved += blob.size - jpg.size;
                item.origExt = 'png';
                item.ext = 'jpg';
                item.bytes = jpg.size;
                n++;
            }
            if (onProgress) onProgress(i + 1, todo.length);
        }
        if (n) await Store.set('gallery', items);
        return { n, saved, total: todo.length };
    }


    // ------------------------------------------------------------
    // 读图片里的 NAI 出图信息
    // ------------------------------------------------------------
    const latin1 = (u8) => { let t = ''; for (let i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]); return t; };
    const utf8 = (u8) => new TextDecoder().decode(u8);

    async function inflate(u8, format) {
        const ds = new DecompressionStream(format);
        return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
    }

    /** PNG 的 tEXt / iTXt / zTXt 文本块 → { 关键字: 文本 } */
    async function pngText(buf) {
        const u8 = new Uint8Array(buf), dv = new DataView(buf);
        const out = {};
        if (u8.length < 8 || dv.getUint32(0) !== 0x89504e47) return out;
        for (let o = 8; o + 8 <= u8.length;) {
            const len = dv.getUint32(o), type = latin1(u8.subarray(o + 4, o + 8));
            const data = u8.subarray(o + 8, o + 8 + len);
            o += 12 + len;
            if (type === 'IEND') break;
            const z = data.indexOf(0);
            if (z < 0) continue;
            const key = latin1(data.subarray(0, z));
            try {
                if (type === 'tEXt') out[key] = utf8(data.subarray(z + 1));
                else if (type === 'zTXt') out[key] = utf8(await inflate(data.subarray(z + 2), 'deflate'));
                else if (type === 'iTXt') {
                    const comp = data[z + 1];
                    let p = z + 3;
                    p = data.indexOf(0, p) + 1; // 语言
                    p = data.indexOf(0, p) + 1; // 翻译的关键字
                    const body = data.subarray(p);
                    out[key] = utf8(comp ? await inflate(body, 'deflate') : body);
                }
            } catch (e) { /* 坏块跳过 */ }
        }
        return out;
    }

    /** 透明通道最低位隐写（NAI / WebUI 的 stealth pnginfo），按列从上到下读 */
    async function stealthText(blob) {
        let bmp;
        try { bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch (e) { return null; }
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const W = c.width, H = c.height, total = W * H;
        const bit = (i) => px[((i % H) * W + Math.floor(i / H)) * 4 + 3] & 1;
        const bytes = (from, n) => { const b = new Uint8Array(n); for (let k = 0; k < n * 8; k++) b[k >> 3] |= bit(from + k) << (7 - (k & 7)); return b; };
        if (total < 200) return null;
        const sig = latin1(bytes(0, 15));
        if (sig !== 'stealth_pngcomp' && sig !== 'stealth_pnginfo') return null;
        let nbits = 0;
        for (let k = 0; k < 32; k++) nbits = nbits * 2 + bit(120 + k);
        if (!nbits || 152 + nbits > total) return null;
        const data = bytes(152, nbits >> 3);
        try { return utf8(sig === 'stealth_pngcomp' ? await inflate(data, 'gzip') : data); } catch (e) { return null; }
    }

    /**
     * 读图片里的出图信息。返回 null（没有）或
     * { prompt, negative, chars: [{ prompt, negative }], params: {...}, software, source, from: 'PNG 文本' | '隐写' }
     */
    async function readInfo(blob) {
        const buf = await blob.arrayBuffer();
        const t = await pngText(buf);
        let raw = t.Comment, from = 'PNG 文本';
        let extra = {};
        if (!raw) {
            const st = await stealthText(blob);
            if (st) {
                from = '隐写';
                try { const o = JSON.parse(st); extra = o; raw = typeof o.Comment === 'string' ? o.Comment : JSON.stringify(o.Comment || o); } catch (e) { raw = st; }
            }
        }
        if (!raw && t.parameters) return { prompt: t.parameters, negative: '', chars: [], params: {}, software: 'WebUI', source: '', from }; // SD WebUI 格式，原样显示
        if (!raw) return null;
        let c;
        try { c = JSON.parse(raw); } catch (e) { return { prompt: raw, negative: '', chars: [], params: {}, software: t.Software || '', source: t.Source || '', from }; }
        const v4 = c.v4_prompt && c.v4_prompt.caption, v4n = c.v4_negative_prompt && c.v4_negative_prompt.caption;
        const chars = ((v4 && v4.char_captions) || []).map((x, i) => ({
            prompt: x.char_caption || '',
            negative: (v4n && v4n.char_captions && v4n.char_captions[i] && v4n.char_captions[i].char_caption) || '',
        }));
        const params = {};
        ['width', 'height', 'seed', 'steps', 'scale', 'sampler', 'cfg_rescale', 'noise_schedule', 'n_samples', 'strength', 'noise'].forEach((k) => { if (c[k] !== undefined) params[k] = c[k]; });
        return {
            prompt: c.prompt || (v4 && v4.base_caption) || t.Description || '',
            negative: c.uc || (v4n && v4n.base_caption) || '',
            chars, params,
            software: t.Software || extra.Software || '',
            source: t.Source || extra.Source || '',
            from,
        };
    }

    async function getBlob(id) { return Store.get('img:' + id, null); }

    async function remove(id) {
        const items = await list();
        const i = items.findIndex((x) => x.id === id);
        if (i >= 0) items.splice(i, 1);
        await Store.del('img:' + id);
        await Store.set('gallery', items);
    }

    function fileName(item) {
        const d = new Date(item.time);
        const p = (n) => String(n).padStart(2, '0');
        return '生图_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + (item.ext || 'png');
    }

    /** 存到手机相册（App 里）/ 浏览器下载 */
    async function saveToPhone(item) {
        const blob = await getBlob(item.id);
        if (!blob) throw new Error('原图找不到了');
        if (window.__saveBlob) return window.__saveBlob(blob, fileName(item));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName(item);
        a.click();
        return '浏览器下载';
    }

    window.Gallery = { list, add, getBlob, remove, saveToPhone, fileName, getPrefs, setPrefs, convertAll, readInfo, SIZES };
})();
