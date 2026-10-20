/*
 * 图库.js —— 图库数据：每张图的原图（Blob）和出图配方
 *
 *   gallery       索引数组（新的在前）：{ id, time, ext, bytes, origExt, thumb, desc, tag, nl, extraNegative, meta }
 *   img:<id>      原图 Blob
 *   galleryPrefs  图库自己的偏好：{ size: 小/中/大/铺满, jpg: PNG 自动转 JPG, quality: JPG 质量 }
 * 界面在 页面-图库.js。
 */
(function () {
    'use strict';

    let index = null;

    const SIZES = [['s', '小'], ['m', '中'], ['l', '大'], ['full', '铺满']];
    const PREFS = { size: 'm', jpg: true, quality: 0.92 };
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

    window.Gallery = { list, add, getBlob, remove, saveToPhone, fileName, getPrefs, setPrefs, convertAll, SIZES };
})();
