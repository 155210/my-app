/*
 * 图库.js —— 图库数据：每张图的原图（Blob）和出图配方
 *
 *   gallery       索引数组（新的在前；charsOn / charsOff 是手动放进 / 移出的人物标签）：{ id, time, ext, bytes, origExt, thumb, desc, tag, nl, extraNegative, meta,
 *                 fav 收藏, albums 所在相册 id 数组, imported 外部导入, name 导入时的原文件名 }
 *   galleryAlbums 相册（只是分组，不移动文件；一张图可以在多个相册里）：[{ id, name }]
 *   img:<id>      原图 Blob
 *   galleryPrefs  图库自己的偏好：{ size: 小/中/大/铺满, jpg: PNG 自动转 JPG, quality: JPG 质量,
 *                 save: 存到手机的位置 hidden/album/custom, saveTree / saveTreeName: 自选文件夹, saveHide: 自选文件夹里放 .nomedia,
 *                 sort: new/old/name/size 排序, nameRule: 保存到手机的文件名规则, nameCounter: {计数} 用到哪了 }
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
    const NAME_RULE = '生图_{日期}_{时间}';
    const PREFS = { size: 'm', jpg: false, quality: 0.92, save: 'hidden', saveTree: '', saveTreeName: '', saveHide: true, sort: 'new', nameRule: NAME_RULE, nameCounter: 0 };
    const SORTS = [['new', '最新的在前'], ['old', '最早的在前'], ['name', '按名称'], ['size', '按大小（大的在前）']];
    /** 文件名规则里能用的写法 */
    const NAME_TOKENS = [
        ['{日期}', '出图日期 20261020'], ['{时间}', '时间 153012'], ['{种子}', '种子'], ['{提示词}', '正面提示词前 40 个字'],
        ['{描述}', '中文描述前 20 个字'], ['{模型}', '模型'], ['{尺寸}', '832x1216'], ['{计数}', '每存一张加 1：0001'],
    ];
    const SAVE_MODES = [
        ['hidden', '隐藏文件夹（默认）', '下载/自然语言生图/图片/，系统相册里看不到，文件管理器里能找到'],
        ['album', '相册', '相册里的「自然语言生图」文件夹'],
        ['custom', '自己选的文件夹', ''],
    ];
    let prefs = null;

    /** 把保存位置告诉 App 外壳（浏览器里没有外壳就跳过） */
    function syncTarget() {
        const b = window.AndroidBridge;
        if (!b || !b.setSaveTarget || !prefs) return;
        try { b.setSaveTarget(prefs.save, prefs.saveTree || '', !!prefs.saveHide); } catch (e) { /* 老外壳 */ }
    }
    async function getPrefs() {
        if (!prefs) { prefs = Object.assign({}, PREFS, await Store.get('galleryPrefs', {})); syncTarget(); }
        return prefs;
    }
    async function setPrefs(patch) {
        Object.assign(await getPrefs(), patch);
        await Store.set('galleryPrefs', prefs);
        syncTarget();
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
        const keep = info && info.keepOriginal;
        const item = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: Date.now(), ext }, info);
        delete item.keepOriginal;
        const p = await getPrefs();
        if (!keep && p.jpg && String(ext).toLowerCase() === 'png') {
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

    /** 一次删多张（只写一次索引） */
    async function removeMany(ids) {
        const set = new Set(ids);
        const items = await list();
        for (let i = items.length - 1; i >= 0; i--) if (set.has(items[i].id)) items.splice(i, 1);
        for (const id of set) await Store.del('img:' + id);
        await Store.set('gallery', items);
    }

    async function remove(id) {
        const items = await list();
        const i = items.findIndex((x) => x.id === id);
        if (i >= 0) items.splice(i, 1);
        await Store.del('img:' + id);
        await Store.set('gallery', items);
    }

    // ------------------------------------------------------------
    // 收藏、相册、排序
    // ------------------------------------------------------------
    let albumList = null;
    const albumsChanged = () => document.dispatchEvent(new Event('gallery-albums')); // 创作页的「打上标签」跟着更新
    async function albums() {
        if (!albumList) albumList = await Store.get('galleryAlbums', []);
        return albumList;
    }
    async function addAlbum(name) {
        const list = await albums();
        name = String(name || '').trim();
        if (!name) throw new Error('相册名不能空着');
        const a = { id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name };
        list.push(a);
        await Store.set('galleryAlbums', list);
        albumsChanged();
        return a;
    }
    async function renameAlbum(id, name) {
        const a = (await albums()).find((x) => x.id === id);
        if (!a || !String(name || '').trim()) return;
        a.name = String(name).trim();
        await Store.set('galleryAlbums', albumList);
        albumsChanged();
    }
    /** 删相册：图不删，只是不再属于它 */
    async function removeAlbum(id) {
        albumList = (await albums()).filter((x) => x.id !== id);
        await Store.set('galleryAlbums', albumList);
        const items = await list();
        items.forEach((x) => { if (x.albums) { x.albums = x.albums.filter((a) => a !== id); if (!x.albums.length) delete x.albums; } });
        await Store.set('gallery', items);
        albumsChanged();
    }
    /** 批量改：fav 收藏（true/false），或者 album + on 加进 / 移出相册 */
    async function mark(ids, patch) {
        const set = new Set(ids);
        const items = await list();
        for (const x of items) {
            if (!set.has(x.id)) continue;
            if ('fav' in patch) { if (patch.fav) x.fav = true; else delete x.fav; }
            if (patch.album) {
                const a = new Set(x.albums || []);
                if (patch.on) a.add(patch.album); else a.delete(patch.album);
                if (a.size) x.albums = [...a]; else delete x.albums;
            }
            // 手动放进 / 移出人物标签：charsOn 自己加的 [{ key, label, en, kind }]，charsOff 自动认出来但不要的 key
            if (patch.char) {
                const c = patch.char, on = (x.charsOn || []).filter((y) => y.key !== c.key), off = new Set(x.charsOff || []);
                if (patch.on) { on.push({ key: c.key, label: c.label, en: c.en || '', kind: c.kind || 'char' }); off.delete(c.key); } else off.add(c.key);
                if (on.length) x.charsOn = on; else delete x.charsOn;
                if (off.size) x.charsOff = [...off]; else delete x.charsOff;
            }
        }
        await Store.set('gallery', items);
    }
    const sortName = (x) => String(x.name || x.desc || x.tag || '').trim();
    /** 排好序的新数组（不改原来的顺序） */
    function sorted(items, how) {
        const a = items.slice();
        if (how === 'old') a.sort((x, y) => x.time - y.time);
        else if (how === 'name') a.sort((x, y) => (sortName(x) || '\uffff').localeCompare(sortName(y) || '\uffff', 'zh-Hans-CN') || y.time - x.time);
        else if (how === 'size') a.sort((x, y) => (y.bytes || 0) - (x.bytes || 0) || y.time - x.time);
        else a.sort((x, y) => y.time - x.time);
        return a;
    }

    // ------------------------------------------------------------
    // 文件名规则
    // ------------------------------------------------------------
    const cleanName = (s, n) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/[\s,，]+/g, ' ').trim().slice(0, n).trim();
    /** 按规则拼文件名（不含扩展名）；counter 给 {计数} 用 */
    function nameByRule(item, rule, counter) {
        const d = new Date(item.time);
        const p = (n) => String(n).padStart(2, '0');
        const m = item.meta || {};
        const v = {
            '日期': d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()),
            '时间': p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()),
            '种子': m.seed != null ? String(m.seed) : '',
            '提示词': cleanName(item.tag || m.positive, 40),
            '描述': cleanName(item.desc, 20),
            '模型': cleanName(window.Params && m.model ? Params.modelLabel(m.model) : m.model, 20),
            '尺寸': m.width && m.height ? m.width + 'x' + m.height : '',
            '计数': String(counter || 1).padStart(4, '0'),
        };
        let out = String(rule || NAME_RULE).replace(/\{(日期|时间|种子|提示词|描述|模型|尺寸|计数)\}/g, (_, k) => v[k]);
        out = cleanName(out.replace(/_+/g, '_').replace(/^[_\s-]+|[_\s-]+$/g, ''), 120);
        return out || nameByRule(item, NAME_RULE);
    }
    function fileName(item, counter) {
        return nameByRule(item, (prefs || PREFS).nameRule, counter) + '.' + (item.ext || 'png');
    }

    /** 存到手机相册（App 里）/ 浏览器下载 */
    async function saveToPhone(item) {
        await getPrefs(); // 保证保存位置已经同步给外壳
        const blob = await getBlob(item.id);
        if (!blob) throw new Error('原图找不到了');
        let name = fileName(item);
        if (/\{计数\}/.test(prefs.nameRule || '')) {
            await setPrefs({ nameCounter: (prefs.nameCounter || 0) + 1 });
            name = fileName(item, prefs.nameCounter);
        }
        if (window.__saveBlob) return window.__saveBlob(blob, name);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        return '浏览器下载';
    }

    window.Gallery = { list, add, getBlob, remove, saveToPhone, fileName, getPrefs, setPrefs, convertAll, readInfo, removeMany, SIZES, SAVE_MODES,
        albums, addAlbum, renameAlbum, removeAlbum, mark, sorted, SORTS, nameByRule, NAME_RULE, NAME_TOKENS };
})();
