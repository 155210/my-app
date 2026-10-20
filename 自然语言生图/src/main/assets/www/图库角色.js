/*
 * 图库角色.js —— 认出每张图里画了哪些角色 / 哪部作品，给图库的筛选条和搜索用
 *
 * 从配方里找（不用重新调 AI）：
 *  1. 角色库：中文描述或提示词里写了角色的名字 / 别名，或者正面里有它的「同人身份标签」→ 用角色库里的名字
 *  2. 标签库：正面提示词、多角色的角色提示词里出现的 Danbooru 角色标签（类别 4）、作品标签（类别 3）→ 用中文名，没中文用英文
 * 结果：[{ key, label, en, kind: 'char' | 'work' }]，key 形如 lib:<角色库 id> / tag:<英文标签>
 */
(function () {
    'use strict';

    let tagMap = null;   // 英文标签 → { zh, cat }，只留角色和作品
    let tagLoading = null;

    function loadTags() {
        if (tagMap) return Promise.resolve(tagMap);
        if (!window.TagLib) return Promise.resolve(null);
        if (!tagLoading) {
            tagLoading = TagLib.load().then((tags) => {
                tagMap = new Map();
                for (const t of tags) if (t[3] === 4 || t[3] === 3) tagMap.set(t[0], { zh: t[1] || '', cat: t[3] });
                return tagMap;
            }).catch(() => { tagLoading = null; return null; });
        }
        return tagLoading;
    }

    /** 一个提示词片段 → 标签库的写法：去掉 NAI 的权重写法 {{ }} [ ] 1.2:: ::，下划线换空格 */
    const normTag = (s) => String(s || '').replace(/-?\d+(\.\d+)?::/g, '').replace(/::/g, '').replace(/[{}[\]]/g, '')
        .replace(/\\([()])/g, '$1').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const lower = (s) => String(s || '').trim().toLowerCase();

    function tagsOfItem(item) {
        const m = item.meta || {};
        const text = [m.positive || item.tag || '', ...(m.characters || []).map((c) => c.tag || '')].join(',');
        return new Set(text.split(/[,，\n|]/).map(normTag).filter(Boolean));
    }

    function libNames(c) {
        return [c.name].concat(String(c.alias || '').split(/[,，、\s]+/)).map((x) => String(x || '').trim()).filter(Boolean);
    }

    /** 一张图里的角色和作品 */
    function detect(item, lib, tm) {
        const out = [], seen = new Set();
        const add = (x) => { if (!seen.has(x.key)) { seen.add(x.key); out.push(x); } };
        const tags = tagsOfItem(item);
        const text = lower([item.desc, item.tag, (item.meta || {}).positive].join('\n'));
        const covered = new Set(); // 已经算进角色库角色的同人标签，不再单独列
        for (const c of lib) {
            const fandom = normTag(c.fields && c.fields.fandom);
            const byName = libNames(c).some((n) => text.includes(lower(n)));
            const byFandom = fandom && fandom.split(/\s*,\s*/).some((f) => tags.has(f));
            if (byName || byFandom) {
                add({ key: 'lib:' + c.id, label: c.name, en: fandom, kind: 'char' });
                if (fandom) fandom.split(/\s*,\s*/).forEach((f) => covered.add(f));
            }
        }
        if (tm) {
            for (const t of tags) {
                const hit = tm.get(t);
                if (!hit || covered.has(t)) continue;
                add({ key: 'tag:' + t, label: hit.zh || t, en: t, kind: hit.cat === 4 ? 'char' : 'work' });
            }
        }
        return out;
    }

    /** 整个图库：返回 Map(图 id → 角色列表) */
    async function index(items) {
        let lib = [];
        if (window.CharLib) {
            try { await CharLib.ready; lib = CharLib.list || []; } catch (e) { /* 角色库读不到就只用标签库 */ }
        }
        const tm = await loadTags();
        const map = new Map();
        for (const it of items) map.set(it.id, detect(it, lib, tm));
        return map;
    }

    /** 筛选条：所有出现过的角色 / 作品，按张数从多到少（角色在前） */
    function chips(map) {
        const count = new Map();
        for (const list of map.values()) for (const x of list) {
            const c = count.get(x.key) || Object.assign({ n: 0 }, x);
            c.n++;
            count.set(x.key, c);
        }
        return [...count.values()].sort((a, b) => (a.kind === b.kind ? b.n - a.n : a.kind === 'char' ? -1 : 1));
    }

    /** 搜索：角色中文名 / 英文标签 / 角色库名字别名 / 中文描述 / 提示词，空格分开的几个词都要命中 */
    function matches(item, found, q) {
        const words = lower(q).split(/\s+/).filter(Boolean);
        if (!words.length) return true;
        const hay = lower([item.desc, item.tag, (item.meta || {}).positive, ...found.map((x) => x.label + ' ' + (x.en || ''))].join('\n')).replace(/_/g, ' ');
        return words.every((w) => hay.includes(w.replace(/_/g, ' ')));
    }

    window.GalleryChars = { index, chips, matches, detect, normTag };
})();
