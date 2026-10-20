/*
 * 图库.js —— 图库数据：每张图的原图（Blob）和出图配方
 *
 *   gallery   索引数组（新的在前）：{ id, time, ext, thumb, desc, tag, nl, extraNegative, meta }
 *   img:<id>  原图 Blob
 * 界面在 页面-图库.js。
 */
(function () {
    'use strict';

    let index = null;

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

    async function add(blob, ext, info) {
        const items = await list();
        const item = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: Date.now(), ext }, info);
        item.thumb = await makeThumb(blob);
        await Store.set('img:' + item.id, blob);
        items.unshift(item);
        await Store.set('gallery', items);
        return item;
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

    window.Gallery = { list, add, getBlob, remove, saveToPhone, fileName };
})();
