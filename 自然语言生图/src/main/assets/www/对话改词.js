/*
 * 对话改词.js —— 和 AI 多轮对话改提示词
 *
 * 创作页提示词卡片上的「对话改」打开一个整页：底下输入一句要求（比如「换成雨天」「表情再害羞一点」），
 * AI 照当前提示词改一版（走 Writer.run 的重写模式，自定义提示词、角色库、标签库纠错都生效），
 * 每轮列出这次加了 / 去掉了 / 改了权重的标签，点一下切换要不要，「接受选中」才写回创作页。
 * 下一轮把前几轮的要求和用户没要的改动一起告诉 AI，别再改回去。
 * 对话存在 promptChat 键（{ turns }），切走、重开 App 都还在；「清空」重新开始。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const KEY = 'promptChat';
    const MAX_TURNS = 30;
    let turns = [];       // [{ ask, base: {tag,nl,negative}, res: {tag,nl,negative}, diff, picks, state: 'wait'|'ready'|'done'|'skip'|'error', err, live }]
    let busy = null;      // 正在问 AI 时的 AbortController
    let L = null;         // 打开着的整页
    let loaded = false;

    async function load() {
        if (loaded) return;
        loaded = true;
        try { turns = ((await Store.get(KEY, {})) || {}).turns || []; } catch (e) { turns = []; }
        turns.forEach((t) => { if (t.state === 'wait') { t.state = 'error'; t.err = '上次没写完'; } });
    }
    function save() {
        const keep = turns.slice(-MAX_TURNS).map((t) => Object.assign({}, t, { live: undefined }));
        Store.set(KEY, { turns: keep });
    }

    // ------------------------------------------------------------
    // 标签比较：按逗号拆开，去掉权重写法、大小写、下划线后比
    // ------------------------------------------------------------
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/_/g, ' ').replace(/\\([()])/g, '$1').replace(/\s+/g, ' ');
    function innerOf(raw) {
        return window.PromptEdit && PromptEdit.parseWeight ? PromptEdit.parseWeight(raw).inner : raw;
    }
    function tokens(str) {
        return String(str || '').split(/[,，\n]/).map((x) => x.trim()).filter(Boolean)
            .map((raw) => ({ raw, key: norm(innerOf(raw)) }));
    }
    const same = (a, b) => a.replace(/\s+/g, ' ') === b.replace(/\s+/g, ' ');

    /** 旧串 → 新串：add 新加的、del 去掉的、mod 同一个标签换了写法（多半是权重） */
    function diff(oldStr, newStr) {
        const o = tokens(oldStr), n = tokens(newStr);
        const oMap = new Map(o.map((t) => [t.key, t])), nKeys = new Set(n.map((t) => t.key));
        const seen = new Set();
        const add = [], mod = [];
        n.forEach((t) => {
            if (seen.has(t.key)) return;
            seen.add(t.key);
            const was = oMap.get(t.key);
            if (!was) add.push(t.raw);
            else if (!same(was.raw, t.raw)) mod.push([was.raw, t.raw]);
        });
        const del = o.filter((t) => !nKeys.has(t.key)).map((t) => t.raw);
        return { add, del, mod };
    }

    /**
     * 把挑中的改动用到 cur（现在框里的，可能中途手改过）上：
     * 去掉挑中的 del、换掉挑中的 mod，挑中的 add 插在 AI 那版里它前一个标签后面
     */
    function applyPicks(cur, newStr, d, pk) {
        const out = tokens(cur);
        const delKeys = new Set(d.del.filter((_, i) => pk.del[i]).map((r) => norm(innerOf(r))));
        let list = out.filter((t) => !delKeys.has(t.key));
        d.mod.forEach((m, i) => {
            if (!pk.mod[i]) return;
            const k = norm(innerOf(m[1]));
            list.forEach((t) => { if (t.key === k) t.raw = m[1]; });
        });
        const addKeys = new Set(d.add.filter((_, i) => pk.add[i]).map((r) => norm(innerOf(r))));
        const nt = tokens(newStr);
        nt.forEach((t, j) => {
            if (!addKeys.has(t.key) || list.some((x) => x.key === t.key)) return;
            let at = 0;
            for (let k = j - 1; k >= 0; k--) {
                const p = list.findIndex((x) => x.key === nt[k].key);
                if (p >= 0) { at = p + 1; break; }
            }
            list.splice(at, 0, t);
        });
        return list.map((t) => t.raw).join(', ');
    }

    function makePicks(d) {
        const all = (a) => a.map(() => true);
        return { tag: { add: all(d.tag.add), del: all(d.tag.del), mod: all(d.tag.mod) }, neg: { add: all(d.neg.add), del: all(d.neg.del), mod: all(d.neg.mod) }, nl: !!d.nl };
    }
    function countPicks(t, onlyOn) {
        let n = 0;
        ['tag', 'neg'].forEach((g) => ['add', 'del', 'mod'].forEach((k) => t.picks[g][k].forEach((v) => { if (v || !onlyOn) n++; })));
        if (t.diff.nl && (t.picks.nl || !onlyOn)) n++;
        return n;
    }

    /** 给下一轮 AI 的前情：每轮要求 + 改了什么 + 用户没要什么 */
    function historyLines() {
        const lines = [];
        turns.forEach((t) => {
            if (t.state !== 'done' && t.state !== 'skip') return;
            let s = '要求：' + t.ask;
            if (t.state === 'skip') { lines.push(s + '。你那版用户整轮没要。'); return; }
            const no = [];
            ['tag', 'neg'].forEach((g) => {
                const d = t.diff[g], p = t.picks[g], pre = g === 'neg' ? '负面' : '';
                d.add.forEach((r, i) => { if (!p.add[i]) no.push(pre + '加 ' + r); });
                d.del.forEach((r, i) => { if (!p.del[i]) no.push(pre + '删 ' + r); });
                d.mod.forEach((m, i) => { if (!p.mod[i]) no.push(pre + m[0] + ' 改成 ' + m[1]); });
            });
            if (t.diff.nl && !t.picks.nl) no.push('换英文描述');
            lines.push(s + (no.length ? '。用户没接受：' + no.join('、') : '。用户全部接受了'));
        });
        return lines.slice(-8);
    }

    // ------------------------------------------------------------
    // 问 AI
    // ------------------------------------------------------------
    function nlVisible() {
        const n = UI.settings.nai;
        return n.naturalLanguage && Params.supportsNl(n.model);
    }

    async function send(ask) {
        ask = String(ask || '').trim();
        if (!ask || busy) return;
        if (window.CreatePage && CreatePage.busy) { toast('warning', '创作页 AI 正在写，等它写完'); return; }
        const d = CreatePage.draft;
        if (!String(d.tag).trim() && !String(d.desc).trim()) { toast('warning', '先在创作页写描述或提示词'); return; }
        const nlOn = nlVisible();
        const base = { tag: d.tag, nl: nlOn ? d.nl : '', negative: d.negative };
        // 还没处理的上一轮当作不要
        turns.forEach((x) => { if (x.state === 'ready') x.state = 'skip'; });
        const history = historyLines();
        const t = { ask, base, state: 'wait', live: '' };
        turns.push(t);
        save();
        render(true);
        busy = new AbortController();
        Queue.Busy.on();
        try {
            const res = await Writer.run({
                settings: UI.settings,
                text: String(d.desc).trim() || '（没有中文描述，照下面当前的提示词改）',
                rewrite: Object.assign({}, base, { hint: ask, history }),
                signal: busy.signal,
                onDelta: (c) => { t.live = c; liveUpdate(t); },
            });
            t.res = { tag: res.tag, nl: nlOn ? res.nl : '', negative: res.negative };
            t.diff = { tag: diff(base.tag, res.tag), neg: diff(base.negative, res.negative), nl: nlOn && !!res.nl && !same(base.nl, res.nl) };
            t.picks = makePicks(t.diff);
            t.state = countPicks(t) ? 'ready' : 'skip';
            if (t.state === 'skip') t.nochange = true;
        } catch (e) {
            t.state = 'error';
            t.err = e.name === 'AbortError' ? '已停止' : (e.message || String(e));
        } finally {
            busy = null;
            t.live = undefined;
            Queue.Busy.off();
            save();
            render(true);
        }
    }

    function accept(t, all) {
        if (all) t.picks = makePicks(t.diff);
        const d = CreatePage.draft;
        const pk = t.picks;
        const everything = countPicks(t, true) === countPicks(t);
        // 全接受且中途没手改：直接用 AI 那版（保留它的顺序）
        const tag = everything && d.tag === t.base.tag ? t.res.tag : applyPicks(d.tag, t.res.tag, t.diff.tag, pk.tag);
        const negative = everything && d.negative === t.base.negative ? t.res.negative : applyPicks(d.negative, t.res.negative, t.diff.neg, pk.neg);
        const nl = t.diff.nl && pk.nl ? t.res.nl : d.nl;
        CreatePage.reuse({ desc: d.desc, tag, nl, negative, size: d.size }, true);
        t.state = 'done';
        save();
        render();
        toast('success', '已改到创作页');
    }

    // ------------------------------------------------------------
    // 界面
    // ------------------------------------------------------------
    function zhOf(raw) {
        if (!window.TagLib || !TagLib.loaded) return '';
        const e = TagLib.get(innerOf(raw));
        return e && e[1] ? e[1] : '';
    }
    function chip(g, k, i, label, on, locked, cls) {
        const zh = zhOf(k === 'mod' ? label[1] : label);
        const text = k === 'mod' ? esc(label[0]) + ' → ' + esc(label[1]) : esc(label);
        return '<button class="pc-chip ' + cls + (on ? '' : ' off') + '"' + (locked ? ' disabled' : '') + ' data-g="' + g + '" data-k="' + k + '" data-i="' + i + '">'
            + '<span class="pc-sign">' + (k === 'add' ? '+' : k === 'del' ? '−' : '≈') + '</span>' + text + (zh ? '<small>' + esc(zh) + '</small>' : '') + '</button>';
    }
    function groupHtml(t, g, locked) {
        const d = t.diff[g], p = t.picks[g], pre = g === 'neg' ? '负面' : '';
        let h = '';
        if (d.add.length) h += '<div class="pc-gl">' + pre + '加上</div><div class="pc-chips">' + d.add.map((r, i) => chip(g, 'add', i, r, p.add[i], locked, 'add')).join('') + '</div>';
        if (d.del.length) h += '<div class="pc-gl">' + pre + '去掉</div><div class="pc-chips">' + d.del.map((r, i) => chip(g, 'del', i, r, p.del[i], locked, 'del')).join('') + '</div>';
        if (d.mod.length) h += '<div class="pc-gl">' + pre + '改写法 / 权重</div><div class="pc-chips">' + d.mod.map((m, i) => chip(g, 'mod', i, m, p.mod[i], locked, 'mod')).join('') + '</div>';
        return h;
    }
    function turnHtml(t, i) {
        let h = '<div class="pc-ask"><span>' + esc(t.ask) + '</span></div><div class="pc-ai card" data-t="' + i + '">';
        if (t.state === 'wait') return h + '<pre class="live pc-live">' + esc(t.live || 'AI 正在改…') + '</pre></div>';
        if (t.state === 'error') return h + '<div class="pc-err">出错了：' + esc(t.err) + '</div><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn small" data-a="retry">再问一次</button></div></div>';
        if (t.nochange) return h + '<div class="card-sub">AI 这版和现在的一样，没有改动。换个说法试试？</div></div>';
        const locked = t.state !== 'ready';
        h += groupHtml(t, 'tag', locked) + groupHtml(t, 'neg', locked);
        if (t.diff.nl) {
            h += '<label class="check pc-nl"><input type="checkbox" data-a="nl"' + (t.picks.nl ? ' checked' : '') + (locked ? ' disabled' : '') + '><span>英文描述换成新的</span></label>'
                + '<div class="card-sub pc-nltext">' + esc(t.res.nl) + '</div>';
        }
        if (t.state === 'ready') {
            h += '<div class="card-sub" style="margin-top:6px">点标签切换要不要，灰掉的不改</div>'
                + '<div class="row" style="justify-content:flex-end;margin-top:8px;gap:8px">'
                + '<button class="btn small" data-a="skip">都不要</button>'
                + '<button class="btn small primary" data-a="ok">接受选中（' + countPicks(t, true) + '）</button></div>';
        } else {
            const n = countPicks(t, true);
            h += '<div class="pc-state">' + (t.state === 'done' ? '已接受 ' + n + ' 项' + (n < countPicks(t) ? '，其余没要' : '') : '没要这版') + '</div>';
        }
        return h + '</div>';
    }

    function curHtml() {
        const d = CreatePage.draft;
        return '<div class="pc-cur"><div class="label">现在的正面提示词</div><div class="card-sub">' + (esc(d.tag) || '（空）') + '</div>'
            + (d.negative ? '<div class="label" style="margin-top:4px">补充负面词</div><div class="card-sub">' + esc(d.negative) + '</div>' : '') + '</div>';
    }

    function render(scroll) {
        if (!L) return;
        const body = $('.page-body', L.box);
        body.innerHTML = curHtml() + (turns.length ? turns.map(turnHtml).join('')
            : '<div class="pc-empty">说一句想怎么改，AI 照现在的提示词改一版，列出改了哪些标签，你挑着接受。<br>比如：换成雨天的街道 / 表情再害羞一点 / 去掉眼镜 / 镜头拉远到全身</div>');
        const go = $('[data-a="send"]', L.box);
        go.textContent = busy ? '停止' : '发送';
        go.classList.toggle('danger', !!busy);
        $('[data-a="clear"]', L.box).disabled = !!busy;
        if (scroll) body.scrollTop = body.scrollHeight;
    }
    function liveUpdate(t) {
        if (!L) return;
        const pre = $('.pc-ai[data-t="' + turns.indexOf(t) + '"] .pc-live', L.box);
        if (pre) { pre.textContent = t.live || 'AI 正在改…'; pre.scrollTop = pre.scrollHeight; }
    }

    async function open() {
        await load();
        if (window.TagLib && !TagLib.loaded) TagLib.load().then(() => render()).catch(() => {});
        L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>对话改提示词</b>'
            + '<button class="btn small" data-a="clear">清空</button></div>'
            + '<div class="page-body pc-body"></div>'
            + '<div class="pc-foot"><textarea class="ta small" data-a="input" rows="1" placeholder="想怎么改？比如：换成雨天"></textarea>'
            + '<div class="pc-btns"><button class="btn small" data-a="draw">出图</button><button class="btn primary" data-a="send">发送</button></div></div>',
        { onClose: () => { L = null; } });
        render(true);
        const input = $('[data-a="input"]', L.box);

        L.box.addEventListener('click', async (e) => {
            const c = e.target.closest('.pc-chip');
            if (c && !c.disabled) {
                const t = turns[Number(c.closest('[data-t]').dataset.t)];
                const arr = t.picks[c.dataset.g][c.dataset.k], i = Number(c.dataset.i);
                arr[i] = !arr[i];
                save(); render();
                return;
            }
            const b = e.target.closest('[data-a]');
            if (!b) return;
            const a = b.dataset.a;
            const tEl = b.closest('[data-t]'), t = tEl ? turns[Number(tEl.dataset.t)] : null;
            if (a === 'send') {
                if (busy) { busy.abort(); return; }
                const v = input.value;
                if (!v.trim()) { input.focus(); return; }
                input.value = '';
                send(v);
            } else if (a === 'ok' && t) accept(t);
            else if (a === 'skip' && t) { t.state = 'skip'; save(); render(); }
            else if (a === 'retry' && t) { turns.splice(turns.indexOf(t), 1); send(t.ask); }
            else if (a === 'draw') { UI.closeLayer(L); CreatePage.draw(); }
            else if (a === 'clear') {
                if (!turns.length) return;
                if (await UI.confirmBox('清空对话', '清掉这些对话记录，重新开始（创作页的提示词不变）。', '清空')) { turns = []; save(); render(); }
            }
        });
        L.box.addEventListener('change', (e) => {
            if (e.target.dataset.a !== 'nl') return;
            const t = turns[Number(e.target.closest('[data-t]').dataset.t)];
            t.picks.nl = e.target.checked;
            save(); render();
        });
    }

    // 创作页「AI 重写」旁边加「对话改」
    function mount() {
        const rw = $('#c-rewrite');
        if (!rw || $('#c-chat')) return;
        rw.insertAdjacentHTML('afterend', '<button class="btn" id="c-chat">对话改</button>');
        $('#c-chat').addEventListener('click', open);
    }
    const init = CreatePage.init;
    CreatePage.init = async function () { await init.apply(this, arguments); mount(); };
    mount();

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.pc-body{display:flex;flex-direction:column;gap:10px}'
        + '.pc-cur{padding:8px 10px;border:1px dashed var(--line);border-radius:10px}.pc-cur .label{font-size:12px;color:var(--dim)}'
        + '.pc-empty{color:var(--dim);font-size:14px;text-align:center;padding:24px 8px;line-height:1.8}'
        + '.pc-ask{display:flex;justify-content:flex-end}.pc-ask span{background:var(--user);border-radius:14px 14px 4px 14px;padding:7px 12px;max-width:85%;overflow-wrap:anywhere;white-space:pre-wrap}'
        + '.pc-ai{margin:0}.pc-live{margin:0;max-height:160px;overflow:auto}'
        + '.pc-gl{font-size:12px;color:var(--dim);margin:6px 0 4px}.pc-gl:first-child{margin-top:0}'
        + '.pc-chips{display:flex;flex-wrap:wrap;gap:6px}'
        + '.pc-chip{border:1px solid var(--line);background:var(--bg3);color:var(--text);border-radius:8px;padding:3px 8px;font-size:13px;text-align:left;overflow-wrap:anywhere;max-width:100%}'
        + '.pc-chip small{display:block;font-size:11px;color:var(--dim)}'
        + '.pc-chip .pc-sign{font-weight:700;margin-right:4px}'
        + '.pc-chip.add{border-color:var(--ok)}.pc-chip.add .pc-sign{color:var(--ok)}'
        + '.pc-chip.del{border-color:var(--danger)}.pc-chip.del .pc-sign{color:var(--danger)}'
        + '.pc-chip.mod{border-color:var(--accent-soft)}.pc-chip.mod .pc-sign{color:var(--accent)}'
        + '.pc-chip.off{opacity:.4;text-decoration:line-through;border-style:dashed}'
        + '.pc-chip:disabled{cursor:default}'
        + '.pc-nl{margin:8px 0 2px}.pc-nltext{white-space:pre-wrap}'
        + '.pc-state{font-size:12px;color:var(--faint);margin-top:8px;text-align:right}'
        + '.pc-err{color:var(--danger);font-size:13px;overflow-wrap:anywhere}'
        + '.pc-foot{flex:none;display:flex;align-items:flex-end;gap:8px;padding:8px 12px calc(8px + var(--safe-bottom));border-top:1px solid var(--line)}'
        + '.pc-foot textarea{flex:1;min-height:40px;max-height:120px;margin:0}.pc-btns{display:flex;flex-direction:column;gap:6px}'
        + '</style>');

    setTimeout(() => {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'create.chat', group: '创作页', title: '对话改提示词', target: '#c-chat', tip: '说一句想怎么改，AI 改完你挑着接受',
            text: '提示词卡片上的「对话改」：在底下说一句要求（比如「换成雨天」「去掉眼镜」），AI 照现在的提示词改一版，列出这次加上 / 去掉 / 改了权重的标签。点标签切换要不要（灰掉的不改），「接受选中」才改到创作页；可以接着说下一句，一轮轮改。没接受的改动会告诉 AI，下一轮不会再改回去。对话记录会保留，右上角「清空」重新开始。用的是设置里的 AI 接口，不花 Anlas。' });
    });

    window.PromptChat = { open, send, diff, applyPicks, get turns() { return turns; } };
})();
