/*
 * 标签说明.js —— 看一个标签是什么意思（Danbooru Wiki），只显示中文
 *
 * 英文原文在 依赖/标签说明.json（工具/做标签说明.py 生成，2 万多个），第一次看某个标签时
 * 用设置里的 AI 接口翻成中文，译文存在 Store 的 wikiZh 键 { 标签: 中文 }，以后直接显示（设置导出时自动带上）。
 * 入口：标签库每行右边的 ⓘ、写提示词时联想条上的 ⓘ。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const CAT_NAME = { 0: '通用', 1: '画师', 3: '作品', 4: '角色', 5: '元数据' };

    let wiki = null, loading = null;
    let zh = null; // 译文缓存
    const pending = new Map(); // 正在翻译的：标签 → Promise

    function load() {
        if (wiki) return Promise.resolve(wiki);
        if (!loading) {
            loading = Promise.all([
                fetch('依赖/标签说明.json').then((r) => { if (!r.ok) throw new Error('标签说明数据读不到（' + r.status + '）'); return r.json(); }),
                Store.get('wikiZh', {}),
                TagLib.load(),
            ]).then(([d, z]) => { wiki = d.d || {}; zh = z || {}; return wiki; })
                .catch((e) => { loading = null; throw e; });
        }
        return loading;
    }

    const PROMPT = '你是翻译。把用户给的 Danbooru 标签说明翻成简体中文：通顺、口语化，保留原意，不要加解释或评论，不要输出英文原文。'
        + '里面提到的其他标签名，后面用括号保留英文原名，比如「中长发（medium hair）」。只输出译文。';

    /** 翻译一个标签的说明（有缓存直接返回） */
    function translate(tag, force) {
        if (!force && zh[tag]) return Promise.resolve(zh[tag]);
        if (pending.has(tag)) return pending.get(tag);
        const api = UI.settings.ai;
        if (!String(api.url || '').trim() || !String(api.model || '').trim()) {
            return Promise.reject(new Error('要先在设置 → AI 接口里填好地址和模型，才能把说明翻成中文'));
        }
        const p = Api.chat({
            api, model: api.model,
            messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: '标签：' + tag + '\n说明：\n' + wiki[tag][0] }],
            params: { stream: false, temperature: 0.3 },
        }).then(async (r) => {
            const t = String(r.content || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
            if (!t) throw new Error('AI 没有回译文');
            zh[tag] = t;
            await Store.set('wikiZh', zh);
            return t;
        }).finally(() => pending.delete(tag));
        pending.set(tag, p);
        return p;
    }

    function chip(t) {
        const e = TagLib.get(t);
        return '<button class="tw-rel" data-t="' + esc(t) + '">' + (e && e[1] ? esc(e[1]) + ' <small>' + esc(t) + '</small>' : esc(t)) + '</button>';
    }

    /** 打开一个标签的说明 */
    async function open(tag) {
        await TagLib.load();
        const t = TagLib.canon(tag) || TagLib.norm(tag);
        const e = TagLib.get(t);
        const box = document.querySelector('#c-tag');
        const L = UI.openLayer('sheet', '<div class="grip"></div>'
            + '<h3 class="tw-title">' + esc(e && e[1] ? e[1] : t) + '</h3>'
            + '<div class="card-sub">' + esc(t) + (e ? ' · ' + CAT_NAME[e[3]] + ' · 用过 ' + e[2] + ' 次' : ' · 标签库里没有') + '</div>'
            + '<div class="tw-body">正在读取说明…</div>'
            + '<div class="tw-rels"></div>'
            + '<div class="btns">' + (e ? '<button class="btn" data-edit>改中文名</button>' : '')
            + '<button class="btn" data-retr hidden>重新翻译</button>'
            + (box ? '<button class="btn primary" data-add>加进正面提示词</button>' : '<button class="btn" data-close>关闭</button>') + '</div>');
        const body = $('.tw-body', L.box);
        L.box.addEventListener('click', async (ev) => {
            const rel = ev.target.closest('.tw-rel');
            if (rel) { UI.closeLayer(L); open(rel.dataset.t); return; }
            if (ev.target.closest('[data-edit]')) {
                const r = await TagLib.editZh(t);
                if (r !== null) $('.tw-title', L.box).textContent = TagLib.get(t)[1] || t;
            }
            if (ev.target.closest('[data-add]')) {
                const parts = box.value.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
                if (!parts.some((x) => TagLib.norm(x) === t)) parts.push(t);
                box.value = parts.join(', ');
                box.dispatchEvent(new Event('input', { bubbles: true }));
                toast('success', '已加进正面提示词');
                UI.closeLayer(L);
            }
            if (ev.target.closest('[data-retr]')) show(true);
        });

        async function show(force) {
            try { await load(); } catch (err) { body.textContent = err.message; return; }
            const w = wiki[t];
            if (!w) { body.innerHTML = '<span class="card-sub">这个标签没有说明。</span>'; return; }
            $('.tw-rels', L.box).innerHTML = w[1].length ? '<div class="label">相关标签</div>' + w[1].map(chip).join('') : '';
            if (zh[t] && !force) { body.textContent = zh[t]; $('[data-retr]', L.box).hidden = false; return; }
            body.innerHTML = '<span class="card-sub">正在用 AI 翻译成中文…</span>';
            try {
                const r = await translate(t, force);
                if (L.el.isConnected) { body.textContent = r; $('[data-retr]', L.box).hidden = false; }
            } catch (err) {
                body.innerHTML = '<span class="card-sub">翻译失败：' + esc(err.message || String(err)) + '</span>';
            }
        }
        show(false);
        return L;
    }

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.tw-body{margin:12px 0;white-space:pre-wrap;line-height:1.7}'
        + '.tw-rels .label{margin-top:4px}'
        + '.tw-rel{border:1px solid var(--line);background:var(--bg3);border-radius:999px;padding:3px 10px;margin:0 6px 6px 0;font-size:13px}'
        + '.tw-rel small{color:var(--faint)}'
        + '</style>');

    window.TagWiki = { load, open, translate, has: (t) => !!(wiki && wiki[t]) };
})();
