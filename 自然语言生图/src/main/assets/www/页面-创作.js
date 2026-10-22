/*
 * 页面-创作.js —— 创作页：写中文描述 → AI 写提示词（可改）→ 出图
 *
 * 「拆成多张」选了张数时，AI 写提示词改成一段描述规划多张（结果卡片在 规划.js）；
 * 「AI 重写」照当前提示词重写一遍，可以附一句要求。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const root = () => $('#view-create');

    // 草稿：描述和提示词，切走、重开 App 都还在
    let draft = { desc: '', tag: '', nl: '', negative: '', size: 'portrait', count: 1, plan: '', hint: '' };
    let writing = null;   // 正在写提示词时的 AbortController
    let results = [];     // 本次打开后出的图，最新的在前，最多显示 RESULT_MAX 张
    const RESULT_MAX = 4;

    let saveTimer = 0;
    function saveDraft() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => Store.set('draft', draft), 300);
    }

    const PLAN_OPTS = [['', '不拆，写一张'], ['auto', 'AI 定张数']].concat([2, 3, 4, 5, 6].map((n) => [String(n), '拆成 ' + n + ' 张']));
    // 扩展口：CreatePage.addMode({ value, label, button, write(runAi, draft) })，「拆成多张」下拉里多一项（漫画.js 用）
    const modes = [];
    const modeOf = () => modes.find((m) => m.value === draft.plan) || null;

    function nlVisible() {
        const n = UI.settings.nai;
        return n.naturalLanguage && Params.supportsNl(n.model);
    }

    function html() {
        return '<div class="card">'
            + '<div class="label">用中文描述你想要的画面</div>'
            + '<textarea class="ta" id="c-desc" placeholder="比如：黄昏的天台上，一个黑长发蓝眼睛穿白裙子的女孩回头笑着看我，风吹起头发"></textarea>'
            + '<div class="row" style="margin-top:10px">'
            + '<label class="check grow" style="margin:0"><span class="switch"><input type="checkbox" id="c-auto"><span></span></span><span>写完自动出图</span></label>'
            + '<button class="btn primary" id="c-write">AI 写提示词</button></div>'
            + '<div class="row" style="margin-top:8px">'
            + '<select id="c-plan" style="width:auto;padding:6px 4px" aria-label="一段描述拆成多张">' + PLAN_OPTS.concat(modes.map((m) => [m.value, m.label])).map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>'
            + '<label class="check grow" style="margin:0;justify-content:flex-end" id="c-nlsw-wrap"><span id="c-nlsw-text" style="font-size:13px;color:var(--dim)">英文描述</span>'
            + '<span class="switch"><input type="checkbox" id="c-nlsw"><span></span></span></label></div>'
            + '<pre class="live" id="c-live" hidden></pre>'
            + '</div>'

            + '<div class="card">'
            + '<div class="field"><label>正面提示词（英文标签，可以直接改）</label><textarea class="ta" id="c-tag" placeholder="AI 写好会填在这里，也可以自己写"></textarea></div>'
            + '<div class="field" id="c-nl-wrap"><label>英文画面描述（NAI 4.5 / V5 用）</label><textarea class="ta" id="c-nl"></textarea></div>'
            + '<div class="field"><label>补充负面词（不想出现的东西）</label><textarea class="ta small" id="c-neg" placeholder="可留空；通用负面词在设置里，会自动加"></textarea></div>'
            + '<div class="row" style="flex-wrap:wrap">'
            + '<div class="seg" id="c-size" style="flex-shrink:0"><button data-v="portrait">竖图</button><button data-v="landscape">横图</button><button data-v="auto">AI 定</button></div>'
            + '<span class="grow"></span>'
            + '<button class="btn" id="c-rewrite">AI 重写</button>'
            + '<button class="btn" id="c-preview">实际发送</button>'
            + '<select id="c-count" style="width:auto;padding:8px 4px" aria-label="一次出几张">' + [1, 2, 3, 4].map((v) => '<option value="' + v + '">' + v + ' 张</option>').join('') + '</select>'
            + '<button class="btn primary" id="c-draw">出图</button></div>'
            + '<div class="row" style="margin-top:8px"><label for="c-album" style="font-size:13px;color:var(--dim);flex-shrink:0">出的图打上标签</label>'
            + '<select id="c-album" class="grow" style="width:auto;min-width:0;padding:6px 4px" aria-label="这次出的图放进哪个标签"><option value="">不加</option></select></div>'
            + '<label class="check" style="margin:6px 0 0"><span class="switch"><input type="checkbox" id="c-album-model"><span></span></span>'
            + '<span style="font-size:13px;color:var(--dim)">跟着模型换（每个模型记自己的标签）</span></label>'
            + '<div class="row" style="margin-top:8px"><div class="card-sub grow" id="c-status" style="margin:0"></div>'
            + '<button class="btn small" id="c-queue" hidden>队列</button><button class="btn small danger" id="c-cancel" hidden>全部取消</button></div>'
            + '</div>'

            + '<div id="c-plan-box"></div>'
            + '<div id="c-result"></div>';
    }

    function fill() {
        const r = root();
        $('#c-desc', r).value = draft.desc;
        $('#c-tag', r).value = draft.tag;
        $('#c-nl', r).value = draft.nl;
        $('#c-neg', r).value = draft.negative;
        $('#c-auto', r).checked = UI.settings.autoDraw;
        $('#c-count', r).value = String(draft.count || 1);
        $('#c-plan', r).value = draft.plan || '';
        fillAlbums();
        refresh();
    }

    // 「出的图打上标签」：就是图库的相册，选了一直记着，出的每张图都放进去，到图库点这个标签就能全选删掉
    // 打开「跟着模型换」时每个模型一个：draft.modelAlbums = { 模型: 相册 id }，切模型就换成那个模型的
    const curAlbum = (model) => (draft.albumByModel ? (draft.modelAlbums || {})[model || UI.settings.nai.model] : draft.album) || '';
    function setAlbum(id) {
        if (draft.albumByModel) draft.modelAlbums = Object.assign({}, draft.modelAlbums, { [UI.settings.nai.model]: id });
        else draft.album = id;
    }
    async function fillAlbums() {
        const sel = root() && $('#c-album', root());
        if (!sel) return;
        const list = await Gallery.albums();
        const has = (id) => list.some((a) => a.id === id);
        let gone = false;
        if (draft.album && !has(draft.album)) { draft.album = ''; gone = true; }
        for (const m in draft.modelAlbums || {}) if (!has(draft.modelAlbums[m])) { delete draft.modelAlbums[m]; gone = true; }
        if (gone) saveDraft();
        $('#c-album-model', root()).checked = !!draft.albumByModel;
        sel.innerHTML = '<option value="">不加</option>'
            + list.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>').join('')
            + '<option value="+">＋ 新标签…</option>';
        sel.value = curAlbum();
    }
    async function pickAlbum(v) {
        if (v === '+') {
            const a = window.GalleryPage && GalleryPage.newAlbum ? await GalleryPage.newAlbum('新标签', '比如：4.5底图、待删') : null;
            if (a) { setAlbum(a.id); toast('success', '之后' + (draft.albumByModel ? '用这个模型' : '') + '出的图都会放进「' + a.name + '」'); }
        } else setAlbum(v);
        saveDraft();
        fillAlbums();
    }

    let refilling = false;
    /** 设置改了以后刷新（模型变了，英文描述那格要不要显示） */
    function refresh() {
        const r = root();
        if (!r || !$('#c-tag', r)) return;
        $('#c-nl-wrap', r).hidden = !nlVisible();
        if (draft.albumByModel && $('#c-album', r).value !== curAlbum()) $('#c-album', r).value = curAlbum(); // 切了模型
        // 「生成英文描述」开关（同设置里那个）；V4 / V3 不吃英文句子，开关灰掉
        const nlOk = Params.supportsNl(UI.settings.nai.model);
        $('#c-nlsw', r).checked = !!UI.settings.nai.naturalLanguage && nlOk;
        $('#c-nlsw', r).disabled = !nlOk;
        $('#c-nlsw-text', r).textContent = nlOk ? '生成英文描述' : '英文描述（这个模型不支持）';
        // 「AI 定」亮着：AI 写完按它选的横竖；点了竖图 / 横图就固定，AI 不再改（sizeAuto 没存过的老草稿算 AI 定）
        UI.$$('#c-size button', r).forEach((b) => b.classList.toggle('on', b.dataset.v === 'auto' ? draft.sizeAuto !== false : b.dataset.v === draft.size));
        const s = UI.settings;
        const q = Queue.state();
        const busy = q.running + q.waiting;
        let qs = '';
        if (busy) {
            const n = q.running - q.retrying;
            qs = [n ? '出图中 ' + n + ' 张' : '', q.waiting ? '排队 ' + q.waiting + ' 张' : '',
                q.retrying ? '限流等待 ' + q.wait + ' 秒后重试' : ''].filter(Boolean).join('，') + ' · ';
        }
        $('#c-queue', r).hidden = !busy && !q.failed;
        $('#c-queue', r).textContent = q.failed && !busy ? '失败 ' + q.failed + ' 张' : '队列';
        $('#c-cancel', r).hidden = !busy;
        // 设置里改了并发数；refill 会通知队列变化又调回 refresh，防一下套娃（以前每次 refresh 要套一千多层到爆栈）
        if (!refilling) { refilling = true; try { Queue.refill(); } finally { refilling = false; } }
        $('#c-status', r).textContent = qs
            + Params.modelLabel(s.nai.model) + ' · ' + (draft.size === 'landscape' ? s.nai.landscapeSize : s.nai.portraitSize)
            + (Number(s.nai.seed) > 0 ? ' · 种子 ' + s.nai.seed : '');
        $('#c-write', r).textContent = writing ? '停止' : modeOf() ? modeOf().button : draft.plan ? 'AI 拆成多张' : 'AI 写提示词';
        $('#c-write', r).classList.toggle('danger', !!writing);
        $('#c-rewrite', r).disabled = !!writing;
    }

    function bind() {
        const r = root();
        const on = (id, ev, fn) => $(id, r).addEventListener(ev, fn);
        on('#c-desc', 'input', (e) => { draft.desc = e.target.value; saveDraft(); });
        on('#c-tag', 'input', (e) => { draft.tag = e.target.value; saveDraft(); });
        on('#c-nl', 'input', (e) => { draft.nl = e.target.value; saveDraft(); });
        on('#c-neg', 'input', (e) => { draft.negative = e.target.value; saveDraft(); });
        on('#c-auto', 'change', (e) => { UI.settings.autoDraw = e.target.checked; UI.saveSettings(); });
        on('#c-size', 'click', (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.v === 'auto') {
                if (draft.sizeAuto === false) toast('info', '横竖交给 AI：写完提示词按 AI 选的来');
                draft.sizeAuto = true;
            } else {
                if (draft.sizeAuto !== false) toast('info', '固定' + (b.dataset.v === 'landscape' ? '横图' : '竖图') + '，AI 写完也不改；想让 AI 选就点「AI 定」');
                draft.size = b.dataset.v;
                draft.sizeAuto = false;
            }
            saveDraft(); refresh();
        });
        on('#c-write', 'click', () => (writing ? writing.abort() : write()));
        on('#c-count', 'change', (e) => { draft.count = Number(e.target.value) || 1; saveDraft(); });
        on('#c-album', 'change', (e) => pickAlbum(e.target.value));
        on('#c-album-model', 'change', (e) => {
            const now = curAlbum();
            draft.albumByModel = e.target.checked;
            // 打开时当前模型接着用现在选的；关掉时留下当前显示的那个
            if (draft.albumByModel) { if (!(UI.settings.nai.model in (draft.modelAlbums || {}))) setAlbum(now); } else draft.album = now;
            if (draft.albumByModel) toast('info', '每个模型记自己的标签：在这个模型下选好，切到别的模型再选一个，之后切模型会自动换');
            saveDraft(); fillAlbums();
        });
        document.addEventListener('gallery-albums', fillAlbums); // 图库里新建 / 改名 / 删了相册
        on('#c-draw', 'click', () => CreatePage.draw()); // 走 CreatePage 上的，别的文件（底图）能包一层
        on('#c-queue', 'click', () => Queue.openPanel());
        on('#c-cancel', 'click', () => Queue.cancelAll());
        on('#c-preview', 'click', preview);
        on('#c-rewrite', 'click', askRewrite);
        on('#c-plan', 'change', (e) => { draft.plan = e.target.value; saveDraft(); refresh(); });
        on('#c-nlsw', 'change', (e) => { UI.settings.nai.naturalLanguage = e.target.checked; UI.saveSettings(); refresh(); });
    }

    /** 调一次 AI（写 / 拆多张 / 重写）：AI 的输出边写边显示在描述下面，期间按钮变「停止」 */
    async function runAi(opt, done, what) {
        if (writing) return;
        const r = root();
        const live = $('#c-live', r);
        writing = new AbortController();
        live.hidden = false;
        live.textContent = 'AI 正在写…';
        refresh();
        Queue.Busy.on();
        try {
            const res = await Writer.run(Object.assign({
                settings: UI.settings, text: draft.desc, signal: writing.signal,
                onDelta: (c) => { live.textContent = c || 'AI 正在写…'; live.scrollTop = live.scrollHeight; },
            }, opt));
            live.hidden = true;
            done(res);
        } catch (e) {
            if (e.name === 'AbortError') { live.hidden = true; toast('info', '已停止'); }
            else { live.textContent = '出错了：' + (e.message || e); toast('error', e.message || String(e), what + '失败'); }
        } finally {
            writing = null;
            Queue.Busy.off();
            refresh();
        }
    }

    function apply(res) {
        Object.assign(draft, { tag: res.tag, nl: res.nl, negative: res.negative, size: draft.sizeAuto === false ? draft.size : res.size });
        saveDraft();
        fill();
    }

    function write() {
        if (modeOf()) return modeOf().write(runAi, draft);
        if (draft.plan) {
            const desc = draft.desc;
            return runAi({ plan: draft.plan === 'auto' ? 0 : Number(draft.plan) }, (res) => {
                Planner.show(desc, res.images);
                if (UI.settings.autoDraw) Planner.drawAll();
            }, 'AI 拆多张');
        }
        return runAi({}, (res) => { apply(res); if (UI.settings.autoDraw) draw(); }, '写提示词');
    }

    /** AI 重写：照现在框里的提示词重写，可以附一句要求（比如「表情再害羞一点」） */
    function askRewrite() {
        if (writing) return;
        if (!String(draft.tag).trim() && !String(draft.desc).trim()) { toast('warning', '先写描述或提示词'); return; }
        const L = UI.openLayer('dialog', '<h3>AI 重写提示词</h3>'
            + '<p>照现在框里的提示词，把同一个画面重写一遍。想改哪里可以写一句（不写也行）。</p>'
            + '<div class="field"><textarea class="ta small" data-hint placeholder="比如：表情再害羞一点 / 换成全身 / 加上下雨"></textarea></div>'
            + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-go>重写</button></div>');
        const ta = $('[data-hint]', L.box);
        ta.value = draft.hint || '';
        $('[data-go]', L.box).onclick = () => {
            draft.hint = ta.value.trim();
            saveDraft();
            UI.closeLayer(L);
            rewrite(draft.hint);
        };
    }

    function rewrite(hint) {
        return runAi({
            text: String(draft.desc).trim() || '（没有中文描述，照下面当前的提示词重写）',
            rewrite: { tag: draft.tag, nl: nlVisible() ? draft.nl : '', negative: draft.negative, hint },
        }, (res) => { apply(res); toast('success', '重写好了' + (UI.settings.autoDraw ? '，开始出图' : '')); if (UI.settings.autoDraw) draw(); }, 'AI 重写');
    }

    const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

    /**
     * 出图：一次排 count 张进队列（重画时传入旧的那套提示词）
     * p.seed 给了就用它；锁了种子又一次出多张时，第 2 张起种子 +1、+2…，不然出来一模一样
     */
    function draw(p, count) {
        p = p || { desc: draft.desc, tag: draft.tag, nl: draft.nl, negative: draft.negative, size: draft.size };
        count = count || Number(draft.count) || 1;
        if (!String(p.tag || '').trim()) { toast('warning', '正面提示词是空的，先让 AI 写或者自己填'); return null; }
        // 先校验尺寸等，免得排进队才报错
        try { Nai.buildBody(UI.settings.nai, p); } catch (e) { toast('error', e.message); return null; }
        const nai = Object.assign({}, UI.settings.nai); // 排队期间改设置不影响这批
        if (p.album == null && curAlbum(nai.model)) p = Object.assign({}, p, { album: curAlbum(nai.model) }); // 标签也按排队那一刻的
        const locked = Number(nai.seed) > 0 ? Number(nai.seed) : 0;
        const name = p.label || String(p.desc || p.tag).trim().replace(/\s+/g, ' ').slice(0, 24);
        const jobs = [];
        for (let i = 0; i < count; i++) {
            const one = Object.assign({}, p);
            delete one.label;
            if (one.seed == null && locked && count > 1) one.seed = (locked + i) % 2 ** 32;
            jobs.push(enqueue(nai, one, name + (count > 1 ? '（' + (i + 1) + '/' + count + '）' : '')));
        }
        return jobs; // 每张一个 Promise（出好是图库里那一项），批量页用来跟踪
    }

    function enqueue(nai, p, label) {
        const job = Queue.add(async (signal) => {
            const out = await Nai.generate(nai, p, signal);
            const info = { desc: p.desc || '', tag: p.tag, nl: p.nl || '', extraNegative: p.negative || '', meta: out.meta };
            if (p.album && (await Gallery.albums()).some((a) => a.id === p.album)) info.albums = [p.album];
            return Gallery.add(out.blob, out.ext, info);
        }, {
            label,
            // 失败后在队列里点「重试」：同一套提示词、同一个种子（如果原来指定了）再排一次
            retry: () => enqueue(nai, p, label),
        });
        job.then((item) => {
            results = [item].concat(results.filter((x) => x.id !== item.id)).slice(0, RESULT_MAX);
            showResult();
            if (window.GalleryPage) GalleryPage.refresh();
        }).catch((e) => {
            if (e.name !== 'AbortError') toast('error', e.message || String(e), '出图失败');
        }).finally(refresh);
        return job;
    }

    /** 重绘：同一套提示词（连同那张图的角色）换个种子再出一张 */
    function redraw(item) {
        return draw({ desc: item.desc, tag: item.tag, nl: item.nl, negative: item.extraNegative, size: item.meta.size, seed: randomSeed(), characters: item.meta.characters || [] }, 1);
    }

    let urls = [], showSeq = 0;
    async function showResult() {
        const box = $('#c-result', root());
        const my = ++showSeq;
        const list = [];
        for (const item of results) {
            const blob = await Gallery.getBlob(item.id);
            if (blob) list.push({ item, url: URL.createObjectURL(blob) });
        }
        // 连着出好几张时，只让最后一次刷新生效
        if (my !== showSeq) { list.forEach((x) => URL.revokeObjectURL(x.url)); return; }
        urls.forEach((u) => URL.revokeObjectURL(u));
        urls = list.map((x) => x.url);
        box.innerHTML = list.map((x, i) => '<div class="card result" data-i="' + i + '"><img src="' + x.url + '" alt="">'
            + '<div class="acts"><button data-a="view">' + UI.ICON.reuse + '看配方</button><button data-a="again">' + UI.ICON.regen + '重绘</button>'
            + '<button data-a="save">' + UI.ICON.save + '存到相册</button>'
            + '<button data-a="del" class="danger">' + UI.ICON.del + '删除</button></div></div>').join('');
        UI.$$('.result', box).forEach((card) => {
            const item = list[Number(card.dataset.i)].item;
            $('img', card).onclick = () => GalleryPage.openViewer(item.id);
            card.querySelector('.acts').onclick = async (e) => {
                const b = e.target.closest('button'); if (!b) return;
                if (b.dataset.a === 'view') GalleryPage.openViewer(item.id);
                if (b.dataset.a === 'again') CreatePage.redraw(item);
                if (b.dataset.a === 'save') {
                    try { toast('success', await Gallery.saveToPhone(item), '已保存'); } catch (err) { toast('error', err.message, '保存失败'); }
                }
                if (b.dataset.a === 'del') {
                    // 和图库里删一样：确认后连图库里的这张一起删
                    if (!await UI.confirmBox('删除这张图？', '图库里的这张也会一起删掉。已经存到手机相册的不受影响。', '删除', true)) return;
                    await Gallery.remove(item.id);
                    results = results.filter((x) => x.id !== item.id);
                    showResult();
                    if (window.GalleryPage) GalleryPage.refresh();
                    toast('success', '删掉了');
                }
            };
        });
    }

    function preview() {
        let body;
        try { body = Nai.buildBody(UI.settings.nai, draft); } catch (e) { toast('error', e.message); return; }
        const m = body.meta;
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>实际发给 NAI 的内容</h3>'
            + '<div class="label">正面</div><pre class="recipe">' + esc(m.positive) + '</pre>'
            + '<div class="label">负面</div><pre class="recipe">' + esc(m.negative) + '</pre>'
            + '<div class="card-sub">' + esc(Params.modelLabel(m.model) + ' · ' + m.width + '×' + m.height + ' · ' + m.sampler + ' · ' + m.steps + ' 步 · CFG ' + m.scale) + '</div>'
            + '<div class="btns"><button class="btn primary" data-a="copy">复制正负面</button><button class="btn" data-close>关闭</button></div>');
        L.box.addEventListener('click', (e) => {
            if (e.target.closest('[data-a="copy"]')) UI.copyText(Nai.promptText(m, body.body));
        });
    }

    /** 从图库「用这套重画」、批量页「填到创作页」、拆多张的「填到上面」：把这套提示词填回来 */
    function reuse(item, quiet) {
        Object.assign(draft, { desc: item.desc || draft.desc, tag: item.tag, nl: item.nl || '', negative: item.extraNegative || item.negative || '', size: (item.meta && item.meta.size) || item.size || 'portrait' });
        saveDraft();
        fill();
        UI.showTab('create');
        if (!quiet) toast('info', '已填回创作页，改完点「出图」');
    }

    async function init() {
        draft = Object.assign(draft, await Store.get('draft', {}));
        root().innerHTML = html();
        bind();
        fill();
        Queue.onChange(refresh);
    }

    setTimeout(() => {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'create.del', group: '创作页', title: '删除刚出的图', target: '.result [data-a="del"]', tip: '不满意的图在这里直接删',
            text: '出好的图下面有「删除」，确认后这张图连同图库里的一起删掉，不用再去图库找。已经存到手机相册的不受影响。不花 Anlas。' });
    });

    const addMode = (m) => modes.push(m);
    window.CreatePage = { init, refresh, reuse, draw, redraw, addMode, get draft() { return draft; }, get busy() { return !!writing; } };
})();
