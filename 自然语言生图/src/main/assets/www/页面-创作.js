/*
 * 页面-创作.js —— 创作页：写中文描述 → AI 写提示词（可改）→ 出图
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const root = () => $('#view-create');

    // 草稿：描述和提示词，切走、重开 App 都还在
    let draft = { desc: '', tag: '', nl: '', negative: '', size: 'portrait' };
    let writing = null;   // 正在写提示词时的 AbortController
    let drawing = 0;      // 排队 + 正在出的张数
    let lastItem = null;  // 本次打开后最近出的一张

    let saveTimer = 0;
    function saveDraft() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => Store.set('draft', draft), 300);
    }

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
            + '<pre class="live" id="c-live" hidden></pre>'
            + '</div>'

            + '<div class="card">'
            + '<div class="field"><label>正面提示词（英文标签，可以直接改）</label><textarea class="ta" id="c-tag" placeholder="AI 写好会填在这里，也可以自己写"></textarea></div>'
            + '<div class="field" id="c-nl-wrap"><label>英文画面描述（NAI 4.5 / V5 用）</label><textarea class="ta" id="c-nl"></textarea></div>'
            + '<div class="field"><label>补充负面词（不想出现的东西）</label><textarea class="ta small" id="c-neg" placeholder="可留空；通用负面词在设置里，会自动加"></textarea></div>'
            + '<div class="row">'
            + '<div class="seg" id="c-size"><button data-v="portrait">竖图</button><button data-v="landscape">横图</button></div>'
            + '<span class="grow"></span>'
            + '<button class="btn" id="c-preview">实际发送</button>'
            + '<button class="btn primary" id="c-draw">出图</button></div>'
            + '<div class="card-sub" id="c-status"></div>'
            + '</div>'

            + '<div id="c-result"></div>';
    }

    function fill() {
        const r = root();
        $('#c-desc', r).value = draft.desc;
        $('#c-tag', r).value = draft.tag;
        $('#c-nl', r).value = draft.nl;
        $('#c-neg', r).value = draft.negative;
        $('#c-auto', r).checked = UI.settings.autoDraw;
        refresh();
    }

    /** 设置改了以后刷新（模型变了，英文描述那格要不要显示） */
    function refresh() {
        const r = root();
        if (!r || !$('#c-tag', r)) return;
        $('#c-nl-wrap', r).hidden = !nlVisible();
        UI.$$('#c-size button', r).forEach((b) => b.classList.toggle('on', b.dataset.v === draft.size));
        const s = UI.settings;
        $('#c-status', r).textContent = (drawing ? '出图中' + (drawing > 1 ? '（还有 ' + (drawing - 1) + ' 张排队）' : '') + '… · ' : '')
            + Params.modelLabel(s.nai.model) + ' · ' + (draft.size === 'landscape' ? s.nai.landscapeSize : s.nai.portraitSize)
            + (Number(s.nai.seed) > 0 ? ' · 种子 ' + s.nai.seed : '');
        $('#c-write', r).textContent = writing ? '停止' : 'AI 写提示词';
        $('#c-write', r).classList.toggle('danger', !!writing);
    }

    function bind() {
        const r = root();
        const on = (id, ev, fn) => $(id, r).addEventListener(ev, fn);
        on('#c-desc', 'input', (e) => { draft.desc = e.target.value; saveDraft(); });
        on('#c-tag', 'input', (e) => { draft.tag = e.target.value; saveDraft(); });
        on('#c-nl', 'input', (e) => { draft.nl = e.target.value; saveDraft(); });
        on('#c-neg', 'input', (e) => { draft.negative = e.target.value; saveDraft(); });
        on('#c-auto', 'change', (e) => { UI.settings.autoDraw = e.target.checked; UI.saveSettings(); });
        on('#c-size', 'click', (e) => { const b = e.target.closest('button'); if (!b) return; draft.size = b.dataset.v; saveDraft(); refresh(); });
        on('#c-write', 'click', () => (writing ? writing.abort() : write()));
        on('#c-draw', 'click', () => draw());
        on('#c-preview', 'click', preview);
    }

    async function write() {
        const r = root();
        const live = $('#c-live', r);
        writing = new AbortController();
        live.hidden = false;
        live.textContent = 'AI 正在写…';
        refresh();
        Queue.Busy.on();
        try {
            const res = await Writer.run({
                settings: UI.settings, text: draft.desc, signal: writing.signal,
                onDelta: (c) => { live.textContent = c || 'AI 正在写…'; live.scrollTop = live.scrollHeight; },
            });
            Object.assign(draft, { tag: res.tag, nl: res.nl, negative: res.negative, size: res.size });
            saveDraft();
            fill();
            live.hidden = true;
            if (UI.settings.autoDraw) draw();
        } catch (e) {
            if (e.name === 'AbortError') { live.hidden = true; toast('info', '已停止'); }
            else { live.textContent = '出错了：' + (e.message || e); toast('error', e.message || String(e), '写提示词失败'); }
        } finally {
            writing = null;
            Queue.Busy.off();
            refresh();
        }
    }

    /** 出图（重画时传入旧的那套提示词） */
    function draw(p) {
        p = p || { desc: draft.desc, tag: draft.tag, nl: draft.nl, negative: draft.negative, size: draft.size };
        if (!String(p.tag || '').trim()) { toast('warning', '正面提示词是空的，先让 AI 写或者自己填'); return; }
        // 先校验尺寸等，免得排进队才报错
        try { Nai.buildBody(UI.settings.nai, p); } catch (e) { toast('error', e.message); return; }
        drawing++;
        refresh();
        const nai = Object.assign({}, UI.settings.nai); // 排队期间改设置不影响这张
        Queue.add(async (signal) => {
            const out = await Nai.generate(nai, p, signal);
            return Gallery.add(out.blob, out.ext, {
                desc: p.desc || '', tag: p.tag, nl: p.nl || '', extraNegative: p.negative || '', meta: out.meta,
            });
        }).then((item) => {
            lastItem = item;
            showResult();
            if (window.GalleryPage) GalleryPage.refresh();
        }).catch((e) => {
            if (e.name !== 'AbortError') toast('error', e.message || String(e), '出图失败');
        }).finally(() => { drawing--; refresh(); });
    }

    async function showResult() {
        const box = $('#c-result', root());
        if (!lastItem) { box.innerHTML = ''; return; }
        const blob = await Gallery.getBlob(lastItem.id);
        if (!blob) { box.innerHTML = ''; return; }
        const url = URL.createObjectURL(blob);
        box.innerHTML = '<div class="card result"><img src="' + url + '" alt="">'
            + '<div class="acts"><button data-a="view">' + UI.ICON.reuse + '看配方</button><button data-a="again">' + UI.ICON.regen + '同提示词再出一张</button>'
            + '<button data-a="save">' + UI.ICON.save + '存到相册</button></div></div>';
        const item = lastItem;
        $('img', box).onclick = () => GalleryPage.openViewer(item.id);
        box.querySelector('.acts').onclick = async (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.a === 'view') GalleryPage.openViewer(item.id);
            if (b.dataset.a === 'again') draw({ desc: item.desc, tag: item.tag, nl: item.nl, negative: item.extraNegative, size: item.meta.size });
            if (b.dataset.a === 'save') {
                try { toast('success', await Gallery.saveToPhone(item), '已保存'); } catch (err) { toast('error', err.message, '保存失败'); }
            }
        };
    }

    function preview() {
        let body;
        try { body = Nai.buildBody(UI.settings.nai, draft); } catch (e) { toast('error', e.message); return; }
        const m = body.meta;
        UI.openLayer('sheet', '<div class="grip"></div><h3>实际发给 NAI 的内容</h3>'
            + '<div class="label">正面</div><pre class="recipe">' + esc(m.positive) + '</pre>'
            + '<div class="label">负面</div><pre class="recipe">' + esc(m.negative) + '</pre>'
            + '<div class="card-sub">' + esc(Params.modelLabel(m.model) + ' · ' + m.width + '×' + m.height + ' · ' + m.sampler + ' · ' + m.steps + ' 步 · CFG ' + m.scale) + '</div>'
            + '<div class="btns"><button class="btn" data-close>关闭</button></div>');
    }

    /** 从图库「用这套重画」：把配方填回来 */
    function reuse(item) {
        Object.assign(draft, { desc: item.desc || draft.desc, tag: item.tag, nl: item.nl || '', negative: item.extraNegative || '', size: item.meta.size || 'portrait' });
        saveDraft();
        fill();
        UI.showTab('create');
        toast('info', '已填回创作页，改完点「出图」');
    }

    async function init() {
        draft = Object.assign(draft, await Store.get('draft', {}));
        root().innerHTML = html();
        bind();
        fill();
        Queue.onChange(refresh);
    }

    window.CreatePage = { init, refresh, reuse, draw };
})();
