/*
 * 漫画.js —— 漫画模式：一段剧情画成漫画（分镜规则参考 Plana-App 的漫画模式，自己重写的）
 *
 * 创作页「拆成多张」下拉里多两项（CreatePage.addMode）：
 *   画成漫画（comic）：一张图 = 一整页多格漫画。AI 回
 *     {"pages":[{ desc, tag, layout, negative, size, boxes:[{ name, desc, prompt, negative }] }], "changes":[] }
 *     tag 只放整页的人数（按不同的人去重）+ comic（黑白再加 monochrome, greyscale）；layout 是版式句（一共几格、怎么排、阅读顺序）；
 *     boxes 是分镜内容框：一格里一个看得见的人一个框（只有手 / 道具 / 空镜的格子一个框），按阅读顺序，最多 6 个。
 *     出图时 tag + layout 进主正面，boxes 当多角色的角色提示词发（char_captions，不摆位置）；V3 没有角色提示词就全拼进正面。
 *     页数 > 1 时就是「拆成多张」：一段剧情拆成几页，下一页接着上一页。
 *   分镜一格一张（story）：走原来的拆成多张（Writer.run({ plan, note })），每格一张图，附上分镜的写法要求；结果卡片还是 规划.js 那张。
 * 选项和结果存在 Store 的 comic 键：{ opts, result: { desc, pages, time } }，重开 App 还在。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const BOX_MAX = 6, PAGE_MAX = 4;
    const DEF = { panels: 'auto', pages: 1, mono: true, rtl: true, layout: 'auto', bubble: false };
    let opts = Object.assign({}, DEF);
    let result = null;

    function save() { Store.set('comic', { opts, result }).catch(() => {}); }

    const LAYOUTS = {
        auto: ['AI 定版式', ''],
        column: ['竖着一列', 'Stack every panel in a single column, one above another, each panel full width.'],
        grid: ['两列网格', 'Arrange the panels in a grid of two columns.'],
        big: ['一大格 + 几小格', 'One large main panel takes most of the page; the remaining panels are small.'],
    };

    // ------------------------------------------------------------
    // 发给 AI 的说明
    // ------------------------------------------------------------
    function comicNote(o) {
        const pages = Math.max(1, Math.min(PAGE_MAX, Number(o.pages) || 1));
        const panels = Number(o.panels) || 0;
        const order = o.rtl ? 'Read right to left, then top to bottom.' : 'Read left to right, then top to bottom.';
        const L = [];
        L.push('【这次画成漫画：每张图是一整页多格漫画】');
        L.push(pages > 1 ? '把上面的剧情画成 ' + pages + ' 页，不多不少；按剧情先后分页，下一页从上一页结尾接着画。' : '画成 1 页。');
        L.push(panels ? '每页 ' + panels + ' 格。' : '每页几格按剧情自己定，一般 3～5 格。');
        L.push('每页的分镜内容框（boxes）最多 ' + BOX_MAX + ' 个：人多的话少分几格，或者让一格只拍一个人。');
        L.push('', '本段规则和上面单张图的规范冲突时，以本段为准。每页的字段：');
        L.push('1. tag：整页只写一次的英文标签。最前面写人数，按这一页里出现的「不同的人」算：同一个女生出现在四格还是 1girl，两个女生各自出镜是 2girls，一女一男是 1girl, 1boy。不要写 solo。'
            + (o.mono ? '人数后面接 comic, monochrome, greyscale。' : '人数后面接 comic。')
            + '外貌、动作、场景都不写在这里，写进各个框。');
        L.push('2. layout：一两句英文，只讲版式，不讲画面内容。先说一共几格，再一行一行说每行几格、并排还是上下、谁大谁小，例如：'
            + 'The page is divided into three panels: one full-width top panel above two small panels side by side. '
            + '总格数要和后面一行行列出来的对得上；跨行的大格只算一格。最后写阅读顺序：' + order + ' 不用描写格线。'
            + (LAYOUTS[o.layout] && LAYOUTS[o.layout][1] ? '版式按用户选的：' + LAYOUTS[o.layout][1] : ''));
        L.push('3. boxes：分镜内容框，按阅读顺序排（同一格的几个框挨着）。');
        L.push('   - 一个框 = 一格里一个看得见的人。同一格两个人就两个框，两个框开头用一模一样的格子称呼；只看得见手、道具、脚步或者空镜的格子只用一个框，把整个接触关系写全。');
        L.push('   - prompt 是英文，开头一律写成 In the <格子的位置和大小> panel, <景别和机位>: <这一格看得见的内容>。格子称呼要和 layout 里的叫法一致，用位置和大小区分（the top right panel / the full-width bottom panel / the small inset panel），不要写 Panel 1 这种编号。');
        L.push('   - 只写这一格镜头里看得见的：脸部特写不写裤子鞋子，手部特写不写脸和头发。但同一个人每次出场，发型、' + (o.mono ? '头发和衣服的深浅' : '发色、瞳色') + '、这身衣服显眼的部件都用同样的英文短语再写一遍，不能写「同上」。');
        L.push('   - 前一格已经拿在手里、穿在身上的东西，这一格还看得见就照写；后面才发生的事不要提前画进前面的格子。');
        if (o.mono) L.push('   - 黑白：外貌和衣服里不要写颜色词（blue hair、red eyes 这些），换成明暗：pale hair / dark short hair / light fabric / dark fabric / solid ink fill，每格都一样写。');
        L.push(o.bubble
            ? '   - 有人说话的格子，在说话人自己的框里写 speech bubble, "台词"（喊叫用 jagged speech bubble，心里话用 thought bubble，旁白用 Narrator box），台词要短；同一格的旁白、拟声词只写一次；没有字的格子什么都不写。'
            : '   - 这次不要对白气泡和文字。');
        L.push('   - name：这个框画的是谁（角色名，跨格出现就重复写同一个名字）；没有人的框写画面内容，比如「手部特写」。不要写成「第1格」。');
        L.push('   - desc：一句中文，告诉用户这一格画了什么（有台词就带上）。negative：这一格额外要避免的，没有就空。');
        L.push('4. 剧情要有节奏：交代 → 推进 → 转折或笑点 → 收尾，格和格之间因果接得上。角色外貌、衣服、场景、道具一直延续，用户没说改就不改。');
        L.push('5. desc：一句中文说这一页讲了什么。size：漫画页一般 portrait，用户要横版才写 landscape。');
        const box = { name: '小星', desc: '这一格画什么（一句中文）', prompt: 'In the full-width top panel, medium shot: ...', negative: '' };
        L.push('', '这次输出的 JSON 改成下面这样（有 changes 的话照常放在最外层）：');
        L.push(JSON.stringify({ pages: [{ desc: '这一页讲什么', tag: '1girl, ' + (o.mono ? 'comic, monochrome, greyscale' : 'comic'), layout: 'The page is divided into ... ' + order, negative: '', size: 'portrait', boxes: [box] }], changes: [] }));
        return L.join('\n');
    }

    /** 分镜一格一张：附在「拆成多张」说明后面 */
    function storyNote(o) {
        const L = ['【这次按漫画分镜来拆：每一张就是一个分镜格】',
            '- 像画分镜脚本一样排：第一张先交代场景（远景或全景），中间推进，最后一张收尾或留个钩子。',
            '- 镜头要轮换：景别在 wide shot / full body / cowboy shot / upper body / close-up 之间换，需要时加机位（from above, from below, from side, dutch angle）；相邻两张不要用同一个景别。',
            '- 前一张已经拿在手里、穿在身上的东西，下一张还看得见就照写；后面才发生的事不要提前画。',
            '- desc 写成「镜头：这一格画什么」，比如「特写：她攥紧了信封」。'];
        if (o.mono) L.push('- 每张 tag 里都加 comic, monochrome, greyscale；外貌和衣服不写颜色词，换成明暗（pale hair / dark hair / light fabric / dark fabric）。');
        return L.join('\n');
    }

    // ------------------------------------------------------------
    // 解析
    // ------------------------------------------------------------
    const str = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '').trim();
    /** AI 回复 → { pages: [{ desc, tag, layout, negative, size, boxes: [{ name, desc, prompt, negative }] }] }；不合格抛错（交给自动重试） */
    function parse(text, o) {
        o = o || opts;
        let t = String(text || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '');
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b <= a) throw new Error('AI 没有按格式回复 JSON');
        let j;
        try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error('AI 回的 JSON 解析不了'); }
        const list = Array.isArray(j.pages) ? j.pages : Array.isArray(j) ? j : (j.boxes || j.panels || j.characters ? [j] : null);
        if (!list) throw new Error('AI 回复里没有 pages 数组');
        const pages = [];
        list.forEach((pg, k) => {
            if (!pg || typeof pg !== 'object') return;
            const boxes = (Array.isArray(pg.boxes) ? pg.boxes : Array.isArray(pg.panels) ? pg.panels : Array.isArray(pg.characters) ? pg.characters : [])
                .filter((x) => x && typeof x === 'object')
                .map((x) => ({ name: str(x.name), desc: str(x.desc), prompt: str(x.prompt || x.positive || x.tag), negative: str(x.negative) }))
                .filter((x) => x.prompt);
            if (!boxes.length) return;
            if (boxes.length > BOX_MAX) throw new Error('第 ' + (k + 1) + ' 页有 ' + boxes.length + ' 个框，最多 ' + BOX_MAX + ' 个');
            pages.push({
                desc: str(pg.desc), tag: str(pg.tag || pg.positive), layout: str(pg.layout), negative: str(pg.negative),
                size: /land|横/i.test(String(pg.size || '')) ? 'landscape' : 'portrait', boxes,
            });
        });
        if (!pages.length) throw new Error('AI 画的漫画里没有分镜框');
        const n = Math.max(1, Number(o.pages) || 1);
        if (pages.length < n) throw new Error('要 ' + n + ' 页，AI 只给了 ' + pages.length + ' 页');
        return { pages: pages.slice(0, n) };
    }

    // ------------------------------------------------------------
    // 出图
    // ------------------------------------------------------------
    const joinTags = (...xs) => xs.map((s) => String(s || '').trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');

    /** 一页 → CreatePage.draw 用的 p：主正面 = 人数等标签 + 版式句，分镜框走多角色；V3 没有角色提示词就都拼进正面 */
    function toP(pg) {
        const d = CreatePage.draft;
        const size = d.sizeAuto === false ? d.size : pg.size;
        const v3 = Params.isV3(UI.settings.nai.model);
        const tag = joinTags(pg.tag, pg.layout, v3 ? pg.boxes.map((x) => x.prompt).join(' ') : '');
        const desc = result.desc + (pg.desc ? '（' + pg.desc + '）' : '');
        return {
            desc, tag, nl: '', negative: joinTags(pg.negative, v3 ? pg.boxes.map((x) => x.negative).join(', ') : ''), size,
            characters: v3 ? [] : pg.boxes.map((x) => ({ tag: x.prompt, negative: x.negative, pos: '' })),
            comicText: !!result.bubble,
        };
    }

    // 要对白气泡时，质量词里的 no text 会把字压掉：这一页发出去前去掉
    const dropNoText = (s) => String(s || '').split(',').filter((x) => x.trim().toLowerCase() !== 'no text').join(',').replace(/^\s+/, '');
    Nai.addBodyHook((body, nai, p) => {
        if (!p.comicText) return;
        body.input = dropNoText(body.input);
        const v4 = body.parameters.v4_prompt;
        if (v4) v4.caption.base_caption = dropNoText(v4.caption.base_caption);
    });

    function drawOne(i) {
        const pg = result.pages[i];
        const jobs = CreatePage.draw(Object.assign(toP(pg), { label: '漫画第 ' + (i + 1) + ' 页 · ' + (pg.desc || result.desc).slice(0, 16) }));
        if (!jobs) return false;
        pg.drawn = (pg.drawn || 0) + 1;
        save();
        render();
        return true;
    }

    function drawAll() {
        if (!result) return;
        let n = 0;
        for (let i = 0; i < result.pages.length; i++) if (drawOne(i)) n++;
        if (n) toast('info', n + ' 页漫画排进出图队列了');
    }

    function fillUp(i) {
        const p = toP(result.pages[i]);
        CreatePage.reuse(Object.assign({}, p, { characters: p.characters }), true);
        toast('info', '第 ' + (i + 1) + ' 页填到上面了：版式在正面提示词里，每个分镜框是一个角色格子，可以改了再出');
    }

    // ------------------------------------------------------------
    // 结果卡片（创作页拆多张卡片下面 #c-comic-box）
    // ------------------------------------------------------------
    function render() {
        const box = $('#c-comic-box');
        if (!box) return;
        if (!result || !result.pages || !result.pages.length) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="card" id="c-comic-card"><div class="card-title"><span class="grow" style="flex:1">AI 画了 ' + result.pages.length + ' 页漫画</span>'
            + '<button class="btn small primary" data-all>全部出图</button><button class="btn small" data-close-comic>收起</button></div>'
            + '<div class="card-sub">' + esc(result.desc.slice(0, 80)) + '</div>'
            + result.pages.map((pg, i) => '<div class="comic-page" data-i="' + i + '">'
                + '<div class="row"><b class="grow">第 ' + (i + 1) + ' 页 <span class="badge">' + (toP(pg).size === 'landscape' ? '横图' : '竖图') + '</span>'
                + ' <span class="badge">' + pg.boxes.length + ' 个框</span>'
                + (pg.drawn ? ' <span class="badge acc">已出 ' + pg.drawn + ' 次</span>' : '') + '</b>'
                + '<button class="btn small" data-fill>填到上面</button><button class="btn small" data-one>出这页</button></div>'
                + (pg.desc ? '<div class="plan-desc">' + esc(pg.desc) + '</div>' : '')
                + '<ol class="comic-boxes">' + pg.boxes.map((x) => '<li><b>' + esc(x.name || '画面') + '</b>：' + esc(x.desc || x.prompt) + '</li>').join('') + '</ol>'
                + '<div class="plan-tag">' + esc(joinTags(pg.tag, pg.layout)) + '</div></div>').join('')
            + '</div>';
        $('[data-all]', box).onclick = drawAll;
        $('[data-close-comic]', box).onclick = () => { result = null; save(); render(); };
        $$('.comic-page', box).forEach((el) => {
            const i = Number(el.dataset.i);
            $('[data-fill]', el).onclick = () => fillUp(i);
            $('[data-one]', el).onclick = () => drawOne(i);
            $('.plan-tag', el).onclick = (e) => e.currentTarget.classList.toggle('open');
        });
        costs();
    }

    function costs() {
        if (!window.Cost) return;
        const box = $('#c-comic-box');
        if (!box || !result) return;
        const n = UI.settings.nai, count = Number(CreatePage.draft.count) || 1;
        $$('.comic-page', box).forEach((el) => Cost.tag($('[data-one]', el), Cost.estimate(n, { size: toP(result.pages[Number(el.dataset.i)]).size }, count)));
        Cost.tag($('[data-all]', box), Cost.estimate(n, { size: 'portrait' }, count * result.pages.length));
    }

    function show(desc, pages, bubble) {
        result = { desc: String(desc || '').trim(), pages, bubble: !!bubble, time: Date.now() };
        save();
        render();
        const card = $('#c-comic-card');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // ------------------------------------------------------------
    // 创作页上的选项（描述下面，选了漫画才显示）
    // ------------------------------------------------------------
    const sel = (k, list) => '<select data-o="' + k + '" style="width:auto;padding:6px 4px">' + list.map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>';
    const sw = (k, label) => '<label class="check" style="margin:0"><span class="switch"><input type="checkbox" data-o="' + k + '"><span></span></span><span style="font-size:13px;color:var(--dim)">' + label + '</span></label>';

    function optsHtml() {
        const nums = [2, 3, 4, 5, 6];
        return '<div class="row comic-row" data-for="comic">'
            + sel('panels', [['auto', '格数 AI 定']].concat(nums.map((n) => [String(n), '每页 ' + n + ' 格'])))
            + sel('pages', [1, 2, 3, 4].map((n) => [String(n), n + ' 页']))
            + sel('layout', Object.keys(LAYOUTS).map((k) => [k, LAYOUTS[k][0]])) + '</div>'
            + '<div class="row comic-row" data-for="story">'
            + sel('panels', [['auto', '格数 AI 定']].concat(nums.map((n) => [String(n), n + ' 格（' + n + ' 张）']))) + '</div>'
            + '<div class="row comic-row" data-for="comic story">' + sw('mono', '黑白') + '<span data-for="comic">' + sw('rtl', '从右往左读（日漫）') + '</span></div>'
            + '<div class="row comic-row" data-for="comic">' + sw('bubble', '加对白气泡（V5 才比较画得出字）') + '</div>';
    }

    function mount() {
        const plan = $('#c-plan');
        if (!plan || $('#c-comic-opts')) return;
        const wrap = document.createElement('div');
        wrap.id = 'c-comic-opts';
        wrap.innerHTML = optsHtml();
        plan.closest('.row').after(wrap);
        plan.addEventListener('change', sync); // 创作页自己的 change 先改 draft.plan
        $$('[data-o]', wrap).forEach((el) => {
            const k = el.dataset.o;
            if (el.type === 'checkbox') el.checked = !!opts[k]; else el.value = String(opts[k]);
            el.addEventListener('change', () => {
                opts[k] = el.type === 'checkbox' ? el.checked : el.value;
                if (k === 'panels') $$('[data-o="panels"]', wrap).forEach((x) => { x.value = opts.panels; });
                save();
            });
        });
        const res = document.createElement('div');
        res.id = 'c-comic-box';
        $('#c-plan-box').after(res);
        render();
        sync();
    }

    function sync() {
        const wrap = $('#c-comic-opts');
        if (!wrap) return;
        const m = CreatePage.draft.plan;
        wrap.hidden = m !== 'comic' && m !== 'story';
        $$('[data-for]', wrap).forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(m); });
    }

    // ------------------------------------------------------------
    // 接到创作页
    // ------------------------------------------------------------
    CreatePage.addMode({
        value: 'comic', label: '画成漫画（一页多格）', button: 'AI 画漫画',
        write(runAi, draft) {
            const desc = draft.desc, o = Object.assign({}, opts);
            return runAi({ task: comicNote(o), parse: (t) => parse(t, o) }, (res) => {
                // 解析好以后过一遍扩展（标签库纠错、角色库建档；建档只跟第一页走一次）
                const pages = res.pages.map((pg, k) => {
                    const f = Writer.applyFilters({ tag: pg.tag, nl: '', negative: pg.negative, size: pg.size, raw: k ? '' : res.raw }, UI.settings);
                    return Object.assign({}, pg, { tag: f.tag, negative: f.negative });
                });
                show(desc, pages, o.bubble);
                if (UI.settings.autoDraw) drawAll();
            }, 'AI 画漫画');
        },
    });
    CreatePage.addMode({
        value: 'story', label: '分镜：一格一张', button: 'AI 拆分镜',
        write(runAi, draft) {
            const desc = draft.desc, o = Object.assign({}, opts);
            return runAi({ plan: Number(o.panels) || 0, note: storyNote(o) }, (res) => {
                Planner.show(desc, res.images, '分镜 {n} 格（一格一张）');
                if (UI.settings.autoDraw) Planner.drawAll();
            }, 'AI 拆分镜');
        },
    });

    const css = document.createElement('style');
    css.textContent = '#c-comic-opts .row{margin-top:8px;flex-wrap:wrap;gap:8px}#c-comic-opts [hidden]{display:none!important}'
        + '.comic-page{border-top:1px solid var(--line);margin-top:10px;padding-top:8px}.comic-page b{font-weight:600;font-size:14px}'
        + '.comic-boxes{margin:4px 0 0;padding-left:20px;font-size:13px;color:var(--dim)}.comic-boxes b{font-size:13px;color:var(--text)}'
        + '#c-comic-card .card-title .btn{flex:none}';
    document.head.appendChild(css);

    const init = CreatePage.init, refresh = CreatePage.refresh;
    CreatePage.init = async function () {
        const d = await Store.get('comic', null);
        if (d) { opts = Object.assign({}, DEF, d.opts); result = d.result || null; }
        await init.apply(this, arguments);
        mount();
    };
    CreatePage.refresh = function () { refresh.apply(this, arguments); sync(); costs(); };

    setTimeout(() => {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'create.comic', group: '创作页', title: '漫画模式', target: '#c-comic-opts:not([hidden])',
            tip: '一段剧情画成漫画：可以选格数、页数、黑白、阅读顺序',
            text: '「拆成多张」下拉里选「画成漫画（一页多格）」，按钮变「AI 画漫画」：AI 把剧情编成分镜，一张图就是一整页漫画。'
                + '可以选每页几格、画几页（几页就是把剧情拆成几页，下一页接着上一页）、版式、黑白、从右往左读、要不要对白气泡。'
                + '每一格里的人物各自是一个「分镜框」，出图时当多角色提示词发给 NAI（V4 起才有；V3 全拼进正面，效果差些），所以一页最多 6 个框。'
                + '选「分镜：一格一张」就是一格出一张单独的图，结果在拆成多张的卡片里。' });
        Help.add({ id: 'create.comicresult', group: '创作页', title: '画好的漫画', target: '#c-comic-card', anlas: true,
            tip: '每页可以单独出，也可以全部出图',
            text: '「出这页」按创作页选的「几张」出这一页；「全部出图」每页都出。「填到上面」把这一页的版式放进正面提示词、每个分镜框放进多角色格子，改了再出。每页按一张图扣 Anlas。' });
    });

    window.Comic = { parse, comicNote, storyNote, toP, show, drawAll, drawOne, get: () => result, get opts() { return opts; } };
})();
