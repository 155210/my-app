/*
 * token读数.js —— 创作页实时显示提示词占了多少 token
 *
 * 数的是实际发给 NAI 的正面 / 负面全文（带画风模板、质量词、角色库换好的外貌），多角色每个角色另算。
 * 分词器和官网一样按模型分：V5 = qwen35，V4 / V4.5 = T5，V3 = CLIP。
 * 分词器文件第一次用到时自动下载（novelai.net 官网同款文件，不行再试 HuggingFace 镜像），存在 Store 的 tok:<种类> 键（不进备份）；
 * 没下载好之前按字数估，显示「约」。
 * 上限：V4 / V4.5 是 512，V3 是 225（75×3），V5 官方没公布，只显示个数。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const NAI_DEF = (n) => 'https://novelai.net/tokenizer/compressed/' + n + '.def?v=2&static=true';
    const SRC = {
        t5: [NAI_DEF('t5_tokenizer'), 'https://hf-mirror.com/google/t5-v1_1-xxl/resolve/main/tokenizer.json', 'https://huggingface.co/google/t5-v1_1-xxl/resolve/main/tokenizer.json'],
        clip: [NAI_DEF('clip_tokenizer'), 'https://hf-mirror.com/openai/clip-vit-large-patch14/resolve/main/tokenizer.json', 'https://huggingface.co/openai/clip-vit-large-patch14/resolve/main/tokenizer.json'],
        qwen: [NAI_DEF('qwen35_tokenizer')],
    };
    const NAME = { t5: 'T5（V4 / V4.5）', clip: 'CLIP（V3）', qwen: 'Qwen3.5（V5）' };
    const LIMIT = { t5: 512, clip: 225, qwen: 0 };
    const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

    const kindOf = (model) => (Params.isV5(model) ? 'qwen' : Params.isV3(model) ? 'clip' : 't5');

    // 权重写法不占 token：1.2::xxx::、{{ }}、[[ ]]
    const stripWeights = (s) => String(s || '').replace(/-?\d+(?:\.\d+)?::/g, ' ').replace(/::/g, ' ').replace(/[{}[\]]/g, ' ');

    // ------------------------------------------------------------
    // 分词器（只数个数，不要 id）
    // ------------------------------------------------------------

    // GPT-2 / CLIP 的字节 → 可见字符表
    const BYTE_CH = (() => {
        const bs = [];
        for (let i = 33; i <= 126; i++) bs.push(i);
        for (let i = 161; i <= 172; i++) bs.push(i);
        for (let i = 174; i <= 255; i++) bs.push(i);
        const cs = bs.slice();
        let n = 0;
        for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
        const out = new Array(256);
        bs.forEach((b, i) => { out[b] = String.fromCharCode(cs[i]); });
        return out;
    })();
    const enc = new TextEncoder();
    const byteChars = (s) => Array.from(enc.encode(s), (b) => BYTE_CH[b]);

    /** 按合并顺序做 BPE，返回切出来几段；whole 给了且整段在词表里就算 1 个 */
    function bpe(symbols, ranks) {
        if (symbols.length < 2) return symbols.length;
        const s = symbols.slice();
        for (;;) {
            let best = -1, bi = -1;
            for (let i = 0; i < s.length - 1; i++) {
                const r = ranks.get(s[i] + ' ' + s[i + 1]);
                if (r !== undefined && (best < 0 || r < best)) { best = r; bi = i; }
            }
            if (bi < 0) break;
            const a = s[bi], b = s[bi + 1];
            // 同一对一次全合掉
            for (let i = 0; i < s.length - 1; i++) if (s[i] === a && s[i + 1] === b) s.splice(i, 2, a + b);
            if (s.length < 2) break;
        }
        return s.length;
    }
    const mergeRanks = (merges) => {
        const m = new Map();
        merges.forEach((x, i) => { const k = Array.isArray(x) ? x.join(' ') : String(x); if (!m.has(k)) m.set(k, i); });
        return m;
    };
    function cached(fn) {
        const c = new Map();
        return (w) => { let n = c.get(w); if (n === undefined) { n = fn(w); if (c.size > 20000) c.clear(); c.set(w, n); } return n; };
    }

    const CLIP_SPLIT = /'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu;
    function clipTok(merges) {
        const ranks = mergeRanks(merges);
        const word = cached((w) => { const s = byteChars(w); s[s.length - 1] += '</w>'; return bpe(s, ranks); });
        return (text) => {
            const t = String(text).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
            let n = 0;
            for (const m of t.matchAll(CLIP_SPLIT)) n += word(m[0]);
            return n;
        };
    }

    // Rust / Python 正则 → JS：去掉占有量词；(?i:…) 老 WebView 不认就当普通分组
    function jsRegex(src) {
        const s = String(src).replace(/(?<!\\)([+*?])\+/g, '$1');
        for (const t of [s, s.replace(/\(\?i:/g, '(?:')]) { try { return new RegExp(t, 'gu'); } catch (e) { /* 再试 */ } }
        return /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
    }
    /** 字节级 BPE（qwen；NAI 的 .def 是 {config, vocab, merges}，HF 的 tokenizer.json 也认） */
    function byteTok({ vocab, merges, split, ignoreMerges, raw }) {
        const ranks = mergeRanks(merges);
        const has = (w) => vocab && Object.prototype.hasOwnProperty.call(vocab, w);
        const word = cached((w) => {
            const s = raw ? Array.from(w) : byteChars(w);
            if (ignoreMerges && has(s.join(''))) return 1;
            return bpe(s, ranks);
        });
        const re = jsRegex(split);
        return (text) => {
            let n = 0;
            for (const m of String(text).matchAll(re)) if (m[0]) n += word(m[0]);
            return n;
        };
    }

    /** Unigram（T5，sentencepiece）：按空白切词、前面加 ▁，Viterbi 取分数最高的切法；连着的生字算一个 */
    function unigramTok(vocab, unkScore) {
        const score = new Map();
        let maxLen = 1, min = 0;
        vocab.forEach(([p, s]) => {
            if (!score.has(p)) score.set(p, s);
            const l = Array.from(p).length;
            if (l > maxLen) maxLen = l;
            if (s < min) min = s;
        });
        maxLen = Math.min(maxLen, 48);
        const unk = unkScore != null ? unkScore : min - 10;
        const word = cached((w) => {
            const ch = Array.from('▁' + w);
            const L = ch.length;
            const best = new Array(L + 1).fill(-Infinity), cnt = new Array(L + 1).fill(0), viaUnk = new Array(L + 1).fill(false);
            best[0] = 0;
            for (let i = 0; i < L; i++) {
                if (best[i] === -Infinity) continue;
                let piece = '', single = false;
                for (let l = 1; l <= maxLen && i + l <= L; l++) {
                    piece += ch[i + l - 1];
                    const s = score.get(piece);
                    if (s === undefined) continue;
                    if (l === 1) single = true;
                    const v = best[i] + s;
                    if (v > best[i + l]) { best[i + l] = v; cnt[i + l] = cnt[i] + 1; viaUnk[i + l] = false; }
                }
                if (!single) {
                    const v = best[i] + unk;
                    if (v > best[i + 1]) { best[i + 1] = v; cnt[i + 1] = cnt[i] + (viaUnk[i] ? 0 : 1); viaUnk[i + 1] = true; }
                }
            }
            return cnt[L];
        });
        return (text) => {
            let n = 0;
            for (const w of String(text).normalize('NFKC').split(/\s+/)) if (w) n += word(w);
            return n;
        };
    }

    /** 认分词器文件：NAI 的 .def（解压后是 JSON）或 HF 的 tokenizer.json */
    function build(text) {
        const d = JSON.parse(text);
        if (typeof d.text === 'string') return clipTok(d.text.split('\n').slice(1, 49152 - 256 - 2 + 1).filter((l) => l.trim()).map((l) => l.trim()));
        const m = d.model;
        if (m && m.type === 'Unigram') {
            return unigramTok(m.vocab, null);
        }
        if (m && m.type === 'BPE' && m.end_of_word_suffix) return clipTok(m.merges);
        if (m && m.type === 'BPE') {
            const pre = JSON.stringify(d.pre_tokenizer || {});
            const pat = /"Regex":"((?:[^"\\]|\\.)*)"/.exec(pre);
            return byteTok({ vocab: m.vocab, merges: m.merges, split: pat ? JSON.parse('"' + pat[1] + '"') : '', ignoreMerges: !!m.ignore_merges });
        }
        if (d.vocab && d.merges) {
            const c = d.config || {};
            return byteTok({ vocab: d.vocab, merges: d.merges, split: c.splitRegex || '', ignoreMerges: !!c.ignoreMerges, raw: Object.prototype.hasOwnProperty.call(d.vocab, ' ') });
        }
        throw new Error('认不出这个分词器文件');
    }

    /** 没有分词器时估一下：英文单词按长度、标点和数字一个算一个 */
    function estimate(text) {
        let n = 0;
        for (const m of String(text).matchAll(/\p{L}+|\p{N}|[^\s\p{L}\p{N}]/gu)) {
            const w = m[0];
            n += /\p{L}/u.test(w) ? (/^[a-z]+$/i.test(w) ? Math.max(1, Math.ceil(w.length / 6)) : Array.from(w).length) : 1;
        }
        return n;
    }

    // ------------------------------------------------------------
    // 下载、缓存
    // ------------------------------------------------------------
    async function inflate(bytes) {
        if (bytes[0] === 0x7b) return new TextDecoder().decode(bytes); // 已经是 JSON
        for (const f of ['deflate-raw', 'gzip', 'deflate']) {
            try {
                const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(f));
                const t = new TextDecoder().decode(await new Response(out).arrayBuffer());
                if (/^\s*[{[]/.test(t)) return t;
            } catch (e) { /* 换一种 */ }
        }
        throw new Error('解压失败');
    }

    const tok = {};      // 种类 → 数 token 的函数
    const state = {};    // 种类 → { loading, error }

    async function download(kind) {
        let last = null;
        for (const url of SRC[kind]) {
            try {
                const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const bytes = new Uint8Array(await r.arrayBuffer());
                const fn = build(await inflate(bytes));
                await Store.set('tok:' + kind, bytes);
                return fn;
            } catch (e) { last = e; }
        }
        throw last || new Error('下载失败');
    }

    /** 拿到这个种类的分词器（先读本地，没有再下载）；同一种同时只下一次 */
    function load(kind, force) {
        if (tok[kind]) return Promise.resolve(tok[kind]);
        const st = state[kind] || (state[kind] = {});
        if (st.loading) return st.loading;
        if (st.error && !force) return Promise.resolve(null);
        st.error = '';
        st.loading = (async () => {
            const saved = await Store.get('tok:' + kind, null);
            if (saved) { try { return build(await inflate(new Uint8Array(saved))); } catch (e) { await Store.del('tok:' + kind); } }
            return download(kind);
        })().then((fn) => { tok[kind] = fn; return fn; }, (e) => { st.error = e.message || String(e); return null; })
            .finally(() => { st.loading = null; schedule(); });
        return st.loading;
    }

    /** 数一段文字：{ n, exact }；分词器还没好就估，并在后台去拿 */
    function count(text, model) {
        const kind = kindOf(model || UI.settings.nai.model);
        const t = stripWeights(text);
        if (tok[kind]) return { n: tok[kind](t), exact: true, kind };
        load(kind);
        return { n: estimate(t), exact: false, kind };
    }

    // ------------------------------------------------------------
    // 创作页那一行
    // ------------------------------------------------------------
    function measure() {
        const nai = UI.settings.nai;
        let body, meta;
        try { ({ body, meta } = Nai.buildBody(nai, CreatePage.draft)); } catch (e) { return null; }
        const v4 = body.parameters.v4_prompt;
        const chars = v4 ? v4.caption.char_captions.map((c) => c.char_caption || '') : [];
        const charNeg = body.parameters.v4_negative_prompt ? body.parameters.v4_negative_prompt.caption.char_captions.map((c) => c.char_caption || '') : [];
        const pos = count(meta.positive, nai.model), neg = count(meta.negative, nai.model);
        return {
            kind: pos.kind, exact: pos.exact, limit: LIMIT[pos.kind], pos: pos.n, neg: neg.n,
            chars: chars.map((c, i) => ({ pos: count(c, nai.model).n, neg: count(charNeg[i] || '', nai.model).n })),
        };
    }

    function line(r) {
        if (!r) return '';
        const a = r.exact ? '' : '约 ';
        const part = (label, n) => {
            const over = r.limit && n > r.limit;
            return '<span class="' + (over ? 'tok-over' : '') + '">' + label + ' ' + a + n + (r.limit ? ' / ' + r.limit : '') + '</span>';
        };
        const cp = r.chars.reduce((s, c) => s + c.pos, 0);
        return 'token：' + part('正面', r.pos) + ' · ' + part('负面', r.neg)
            + (r.chars.length ? ' · <span' + (r.limit && r.chars.some((c) => c.pos > r.limit || c.neg > r.limit) ? ' class="tok-over"' : '') + '>角色 ' + r.chars.length + ' 个共 ' + a + cp + '</span>' : '')
            + (state[r.kind] && state[r.kind].loading ? ' <span class="tok-dim">（下载分词器中）</span>' : '');
    }

    let box = null, last = null, timer = 0;
    function schedule() { clearTimeout(timer); timer = setTimeout(render, 250); }
    function render() {
        const view = $('#view-create');
        if (!view || !$('#c-neg', view)) return;
        if (!box || !box.isConnected) {
            box = document.createElement('div');
            box.id = 'c-tok';
            box.className = 'tok-line';
            box.setAttribute('role', 'button');
            box.dataset.guide = '点这里看 token 明细';
            const field = $('#c-neg', view).closest('.field');
            field.parentNode.insertBefore(box, field.nextSibling);
            box.addEventListener('click', details);
        }
        last = measure();
        box.innerHTML = line(last);
    }

    function details() {
        const r = last || measure();
        if (!r) return;
        const st = state[r.kind] || {};
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>提示词 token 数</h3>'
            + '<div class="card-sub" style="margin-bottom:10px">数的是实际发给 NAI 的全文（带画风模板、质量词、负面词、角色库换好的外貌），权重写法不算。'
            + (r.limit ? '这个模型每段上限 ' + r.limit + '，超出的部分 NAI 会截掉不看。' : 'V5 官方没公布上限，只显示个数。') + '</div>'
            + '<div class="tok-rows">'
            + row('正面', r.pos, r) + row('负面', r.neg, r)
            + r.chars.map((c, i) => row('角色 ' + (i + 1) + ' 正面', c.pos, r) + row('角色 ' + (i + 1) + ' 负面', c.neg, r)).join('')
            + '</div>'
            + '<div class="card-sub" style="margin-top:10px">分词器：' + esc(NAME[r.kind]) + ' · '
            + (r.exact ? '已下载，数的是准数' : st.loading ? '正在下载…' : st.error ? '下载失败（' + esc(st.error) + '），先按字数估' : '还没下载，先按字数估') + '</div>'
            + '<div class="btns">' + (r.exact ? '' : '<button class="btn" data-a="dl">重新下载分词器</button>') + '<button class="btn primary" data-close>关闭</button></div>');
        L.box.addEventListener('click', async (e) => {
            if (!e.target.closest('[data-a="dl"]')) return;
            e.target.disabled = true;
            e.target.textContent = '下载中…';
            const fn = await load(r.kind, true);
            UI.closeLayer(L);
            if (fn) { toast('success', '分词器下好了'); render(); details(); } else toast('error', (state[r.kind] || {}).error || '下载失败', '分词器下载失败');
        });
    }
    function row(label, n, r) {
        const over = r.limit && n > r.limit;
        return '<div class="row tok-row"><span class="grow">' + esc(label) + '</span><b class="' + (over ? 'tok-over' : '') + '">' + (r.exact ? '' : '约 ') + n + (r.limit ? ' / ' + r.limit : '') + '</b>'
            + (over ? '<span class="tok-over" style="margin-left:6px">超 ' + (n - r.limit) + '</span>' : '') + '</div>';
    }

    // 创作页里任何格子改了（提示词、多角色、画风…）都重数；设置改了 CreatePage.refresh 会被调到
    const init = CreatePage.init, refresh = CreatePage.refresh;
    CreatePage.init = async function () {
        await init.apply(this, arguments);
        const view = $('#view-create');
        view.addEventListener('input', schedule);
        view.addEventListener('change', schedule);
        render();
        addHelp();
    };
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        schedule();
    };

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.tok-line{font-size:12px;color:var(--dim);margin:-4px 0 10px;cursor:pointer}.tok-over{color:var(--danger);font-weight:600}.tok-dim{opacity:.7}'
        + '.tok-row{padding:6px 0;border-bottom:1px solid var(--line)}'
        + '</style>');

    // 说明在创作页起来以后再加：新手提示按添加顺序弹，排在「?」「设置」那几条后面
    function addHelp() {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'create.tokens', group: '创作页', title: 'token 读数', target: '#c-tok', tip: '这里实时显示提示词占了多少 token，超了会变红',
            text: '负面词下面那一行是实际发给 NAI 的正面、负面（带画风模板、质量词）各占多少 token，多角色另算。V4 / V4.5 每段上限 512，V3 是 225，超出的部分 NAI 不看，数字会变红；V5 官方没公布上限，只显示个数。'
                + '分词器和官网同款，第一次用到时自动下载（存在本机，不进备份），下好之前显示「约」，按字数估。点这一行看明细、重新下载。不花 Anlas。' });
    }

    window.TokenCount = { count, estimate, build, load, kindOf, stripWeights, measure, render, LIMIT };
})();
