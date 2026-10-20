/*
 * 存储.js —— 本地数据（IndexedDB，存在手机里，卸载 App 才会清空）
 *
 * 键：
 *   settings        全部设置（AI 接口、NAI 出图参数、自定义提示词、重型提示词）
 *   draft           创作页草稿（描述、提示词）
 *   gallery         图库索引（每张图的出图配方 + 缩略图，新的在前）
 *   img:<id>        单张原图（Blob）
 */
(function () {
    'use strict';

    const DB_NAME = 'nl-image';
    const STORE = 'kv';
    let dbp = null;

    function open() {
        if (dbp) return dbp;
        dbp = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbp;
    }

    async function tx(mode, fn) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const t = db.transaction(STORE, mode);
            const st = t.objectStore(STORE);
            let out;
            Promise.resolve(fn(st)).then((r) => { out = r; });
            t.oncomplete = () => resolve(out);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
    }

    function reqP(r) {
        return new Promise((resolve, reject) => {
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }

    const Store = {
        async get(key, def) {
            const v = await tx('readonly', (st) => reqP(st.get(key)));
            return v === undefined ? def : v;
        },
        async set(key, val) {
            await tx('readwrite', (st) => { st.put(val, key); });
        },
        async del(key) {
            await tx('readwrite', (st) => { st.delete(key); });
        },
        async keys() {
            return tx('readonly', (st) => reqP(st.getAllKeys()));
        },
        async dumpAll() {
            const keys = await Store.keys();
            const out = {};
            for (const k of keys) out[k] = await Store.get(k);
            return out;
        },
        async restoreAll(obj, merge) {
            if (!merge) {
                const keys = await Store.keys();
                await tx('readwrite', (st) => { keys.forEach((k) => st.delete(k)); });
            }
            await tx('readwrite', (st) => { Object.keys(obj).forEach((k) => st.put(obj[k], k)); });
        },
    };

    window.Store = Store;
})();
