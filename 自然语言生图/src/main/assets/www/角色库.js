/*
 * 角色库.js —— 存角色的固定外貌（发型、眼睛、体型、固定着装…），用名字代替一长串外貌标签
 *
 *  1. 写提示词前：描述里出现了已建档的角色（名字或别名），把他的外貌标签附给 AI，让它一字不改照抄（Writer.addContext）
 *  2. 提示词里直接写名字（比如正面提示词里写「小雪, smile」）：AI 写完、出图前都会把名字换成外貌标签
 *     （Writer.addFilter + Nai.addTagFilter；多角色的角色提示词也换，见文件末尾的 Nai.addHook）
 *  3. AI 自动建档 / 更新：让 AI 在 JSON 里多回一个 changes 数组（格式同「柏宝绘」）——
 *       新角色 {"name":"小雪","field":"new","fields":{"hair":"long black hair",...},"reason":"..."}
 *       永久变化 {"name":"小雪","field":"hair","to":"short red hair","reason":"剪短染红了"}
 *  4. 全局角色（玩家、主角这类固定角色）：AI 的 changes 对它一律无效，只有自己能改
 *
 * 数据存在 Store 的 characters 键：{ v:1, list:[角色] }，设置导出时自动带上（见 备份.js）。
 * 角色：{ id, name, alias 别名（逗号分隔）, global, fields:{ FIELDS 各项 }, note, source:'manual'|'ai', history:[{ at, field, from, to, reason, by }] }
 * 开关在 settings.chars：{ inject 发给 AI, autoCreate 自动建档, autoUpdate 永久变化自动更新 }
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    const KEY = 'characters';
    const HISTORY_MAX = 30;

    // 拼外貌标签的顺序同柏宝绘：同人身份 → 性别 → 头发 → 眼睛 → 肤色 → 体型 → 标志特征 → 着装
    const FIELDS = [
        { k: 'fandom', label: '同人身份标签', ph: '已有作品的角色：角色名 (作品名)，如 hatsune miku (vocaloid)；原创留空' },
        { k: 'sex', label: '性别 / 人数', ph: '1girl / 1boy' },
        { k: 'hair', label: '头发', ph: '发色 + 长度/发型，如 long black hair, hime cut' },
        { k: 'eyes', label: '眼睛', ph: '如 blue eyes' },
        { k: 'skin', label: '肤色', ph: '可留空，如 pale skin / dark skin' },
        { k: 'body', label: '体型', ph: '可留空，如 petite / tall, muscular' },
        { k: 'extra', label: '标志特征', ph: '可留空，如 mole under eye, cat ears' },
        { k: 'outfit', label: '固定着装', ph: '可留空，如 school uniform, red scarf' },
    ];
    const FIELD_KEYS = FIELDS.map((f) => f.k);
    const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.k, f.label]));

    // ------------------------------------------------------------
    // 数据
    // ------------------------------------------------------------
    let list = [];
    let saveTimer = 0;
    const newId = () => 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    function normalizeOne(c) {
        c = c || {};
        const fields = {};
        FIELD_KEYS.forEach((k) => { fields[k] = String((c.fields || {})[k] || '').trim(); });
        return {
            id: c.id || newId(),
            name: String(c.name || '').trim(),
            alias: String(c.alias || '').trim(),
            global: !!c.global,
            fields,
            note: String(c.note || ''),
            source: c.source === 'ai' ? 'ai' : 'manual',
            history: Array.isArray(c.history) ? c.history.slice(-HISTORY_MAX) : [],
        };
    }

    const ready = Store.get(KEY, null).then((d) => {
        list = (d && Array.isArray(d.list) ? d.list : []).map(normalizeOne);
        return list;
    }).catch((e) => { console.warn(e); return list; });

    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => Store.set(KEY, { v: 1, list }).catch((e) => toast('error', e.message, '保存角色库失败')), 200);
    }

    const opts = () => Object.assign({ inject: true, autoCreate: true, autoUpdate: true }, UI.settings.chars);

    /** 一个角色的全部称呼：名字 + 别名 */
    const namesOf = (c) => [c.name].concat(c.alias.split(/[,，、\n]/)).map((x) => x.trim()).filter(Boolean);
    const lower = (s) => String(s || '').trim().toLowerCase();

    function find(name) {
        const k = lower(name);
        if (!k) return null;
        return list.find((c) => lower(c.name) === k) || list.find((c) => namesOf(c).some((n) => lower(n) === k)) || null;
    }

    /** 外貌标签串（按固定顺序拼） */
    function tagsOf(c) {
        return FIELD_KEYS.map((k) => c.fields[k]).map((s) => s.replace(/^[,，\s]+|[,，\s]+$/g, '')).filter(Boolean).join(', ');
    }

    /** 中文描述里出现了哪些角色（名字或别名是描述的一部分） */
    function mentioned(text) {
        const s = lower(text);
        if (!s) return [];
        return list.filter((c) => c.name && namesOf(c).some((n) => s.includes(lower(n))));
    }

    // 人数标签：1girl / 2girls / 1boy / 3people / multiple girls …
    const COUNT_RE = /^(\d+\+?\s*(girls?|boys?|others?|people)|multiple (girls|boys)|solo)$/i;
    function countTags(sexes) {
        const n = { girl: 0, boy: 0 }, other = [];
        sexes.forEach((s) => {
            const m = s.match(/^1\s*(girl|boy)$/i);
            if (m) n[m[1].toLowerCase()]++; else other.push(s);
        });
        const one = (k) => (n[k] === 1 ? '1' + k : n[k] >= 6 ? '6+' + k + 's' : n[k] + k + 's');
        return ['girl', 'boy'].filter((k) => n[k]).map(one).concat(other);
    }

    /**
     * 把逗号分隔的提示词里「整个就是一个角色名」的那一项换成外貌标签，换完去重
     * 人数：提示词里本来就有人数标签就不加角色的性别；没有就按角色算（两个 1girl → 2girls），放在最前面
     * 返回 { text, used: [角色名] }
     */
    function expandDetail(text) {
        const used = [];
        if (!list.length || !String(text || '').trim()) return { text: text || '', used };
        const parts = String(text).split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
        const hasCount = parts.some((t) => COUNT_RE.test(t));
        const out = [], seen = new Set(), sexes = [];
        const push = (t) => { const k = lower(t); if (!k || seen.has(k)) return; seen.add(k); out.push(t); };
        let hit = false;
        for (const t of parts) {
            const c = find(t);
            const tags = c && tagsOf(c);
            if (!tags) { push(t); continue; }
            hit = true;
            if (!used.includes(c.name)) {
                used.push(c.name);
                c.fields.sex.split(/\s*,\s*/).filter(Boolean).forEach((x) => sexes.push(x));
            }
            tagsOf(Object.assign({}, c, { fields: Object.assign({}, c.fields, { sex: '' }) })).split(/\s*,\s*/).forEach(push);
        }
        if (!hit) return { text, used };
        const head = hasCount ? [] : countTags(sexes).filter((x) => !seen.has(lower(x)));
        return { text: head.concat(out).join(', '), used };
    }
    const expand = (text) => expandDetail(text).text;

    // ------------------------------------------------------------
    // 改动（手动、AI 都走这里，记历史，可撤销）
    // ------------------------------------------------------------
    function record(c, field, from, to, reason, by) {
        c.history.push({ at: Date.now(), field, from, to, reason: reason || '', by: by || 'manual' });
        if (c.history.length > HISTORY_MAX) c.history.splice(0, c.history.length - HISTORY_MAX);
    }

    function create(data, by, reason) {
        const c = normalizeOne(Object.assign({}, data, { id: newId(), source: by === 'ai' ? 'ai' : 'manual', history: [] }));
        record(c, 'new', '', tagsOf(c), reason, by);
        list.push(c);
        save();
        return c;
    }

    function remove(id) {
        const i = list.findIndex((c) => c.id === id);
        if (i >= 0) { list.splice(i, 1); save(); }
    }

    /** 撤销一条历史：字段改回原值 */
    function undo(c, h) {
        if (!FIELD_KEYS.includes(h.field)) return false;
        const cur = c.fields[h.field];
        c.fields[h.field] = h.from;
        record(c, h.field, cur, h.from, '撤销「' + (h.reason || h.to) + '」', 'manual');
        save();
        return true;
    }

    /** 从 AI 回复原文里取出 changes 数组 */
    function parseChanges(raw) {
        let t = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '');
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b <= a) return [];
        try {
            const j = JSON.parse(t.slice(a, b + 1));
            return Array.isArray(j.changes) ? j.changes.filter((x) => x && typeof x === 'object') : [];
        } catch (e) { return []; }
    }

    const str = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '').trim();

    /**
     * 执行 AI 给的 changes，返回做了什么（给提示用）：[{ kind:'new'|'set'|'skip', name, field, to, why }]
     */
    function applyChanges(changes, o) {
        o = o || opts();
        const done = [];
        for (const ch of changes) {
            const name = str(ch.name);
            const field = String(ch.field || '').trim();
            if (!name || !field) continue;
            const c = find(name);
            if (field === 'new') {
                if (c) {
                    // 已经有了：只补空着的字段（全局角色不动）
                    if (c.global || !o.autoUpdate) continue;
                    const f = ch.fields || {};
                    FIELD_KEYS.forEach((k) => {
                        const v = str(f[k]);
                        if (v && !c.fields[k]) { record(c, k, '', v, '补档：' + str(ch.reason), 'ai'); c.fields[k] = v; done.push({ kind: 'set', name: c.name, field: k, to: v }); }
                    });
                    continue;
                }
                if (!o.autoCreate) continue;
                const fields = {};
                FIELD_KEYS.forEach((k) => { fields[k] = str((ch.fields || {})[k]); });
                if (!FIELD_KEYS.some((k) => fields[k])) continue;
                create({ name, fields }, 'ai', str(ch.reason));
                done.push({ kind: 'new', name });
                continue;
            }
            if (!FIELD_KEYS.includes(field) || !c) continue;
            if (c.global) { done.push({ kind: 'skip', name: c.name, why: '全局角色，AI 不改' }); continue; }
            if (!o.autoUpdate) continue;
            const to = str(ch.to != null ? ch.to : ch.value);
            if (to === c.fields[field]) continue;
            record(c, field, c.fields[field], to, str(ch.reason), 'ai');
            c.fields[field] = to;
            done.push({ kind: 'set', name: c.name, field, to });
        }
        if (done.length) save();
        return done;
    }

    // ------------------------------------------------------------
    // 接进写提示词流程
    // ------------------------------------------------------------
    function contextText(text) {
        const o = opts();
        const parts = [];
        if (o.inject && list.length) {
            const hit = mentioned(text).filter((c) => tagsOf(c));
            const names = list.filter((c) => c.name).map((c) => c.name + (c.global ? '（全局）' : ''));
            let s = '【角色固定外貌库】已建档的角色：' + names.join('、') + '。';
            if (hit.length) {
                s += '\n这次描述里出现的已建档角色，tag 里照抄下面的外貌标签，一字不改、不换写法、不另加外貌词（服装如果描述里另有说明，以描述为准）：\n'
                    + hit.map((c) => '- ' + c.name + (c.alias ? '（也叫 ' + c.alias + '）' : '') + '：' + tagsOf(c)).join('\n');
            }
            parts.push(s);
        }
        if (o.autoCreate || o.autoUpdate) {
            const rules = [];
            if (o.autoCreate) {
                rules.push('描述里出现了有名字、但上面库里没有的角色（没名字的一次性路人不算）：加一条 {"name":"名字原文","field":"new","fields":{"sex":"1girl","hair":"long black hair","eyes":"blue eyes","skin":"","body":"","extra":"","outfit":"","fandom":""},"reason":"一句话说明"}。'
                    + 'name 照描述原文写，中文名不翻译不拼音。hair 必须有发色和长度/发型，eyes 必须有瞳色，描述里没说就按人设合理补；skin、body、extra、outfit 只写长期不变的特征，没有就留空；fandom 只给已有作品的角色写「角色名 (作品名)」，原创留空。');
            }
            if (o.autoUpdate) {
                rules.push('描述里写了已建档角色的永久变化（染发、剪发、永久变身等）：加一条 {"name":"库里的名字","field":"hair","to":"变化后的完整写法","reason":"一句话说明"}，field 只能是 ' + FIELD_KEYS.join(' / ') + '。假发、美瞳、湿发、灯光、换衣服这类临时变化不写。标「全局」的角色不要写。');
            }
            parts.push('【角色建档】在 JSON 里多加一个 "changes" 数组（没有就写 []）：\n- ' + rules.join('\n- '));
        }
        return parts.join('\n\n');
    }

    Writer.addContext((settings, text) => contextText(text));

    Writer.addFilter((res) => {
        const done = applyChanges(parseChanges(res.raw));
        const msg = done.map((d) => (d.kind === 'new' ? '新建「' + d.name + '」'
            : d.kind === 'set' ? d.name + ' 的' + FIELD_LABEL[d.field] + ' → ' + (d.to || '（清空）')
                : d.name + '：' + d.why));
        if (msg.length) toast('info', msg.slice(0, 6).join('\n') + (msg.length > 6 ? '\n…' : ''), '角色库更新了');
        const e = expandDetail(res.tag);
        return Object.assign({}, res, { tag: e.text, charChanges: done });
    });

    // 出图前：正面提示词里的角色名换成外貌（手写的提示词也生效）
    if (Nai.addTagFilter) Nai.addTagFilter((tag) => expand(tag));
    // 多角色的每个角色提示词也换；等别的扩展都注册完再挂，保证在它们后面执行
    function expandParams(params) {
        const cap = params.v4_prompt && params.v4_prompt.caption;
        if (cap && Array.isArray(cap.char_captions)) cap.char_captions.forEach((x) => { if (x && typeof x.char_caption === 'string') x.char_caption = expand(x.char_caption); });
        if (Array.isArray(params.characterPrompts)) params.characterPrompts.forEach((x) => { if (x && typeof x.prompt === 'string') x.prompt = expand(x.prompt); });
        return params;
    }
    setTimeout(() => Nai.addHook(expandParams), 0);

    // ------------------------------------------------------------
    // 界面
    // ------------------------------------------------------------
    function cardHtml(c) {
        const tags = tagsOf(c);
        return '<div class="card cl-card" data-id="' + esc(c.id) + '">'
            + '<div class="card-title">' + esc(c.name || '（没起名字）')
            + (c.global ? '<span class="badge acc">全局 · AI 不改</span>' : '')
            + (c.source === 'ai' ? '<span class="badge">AI 建的</span>' : '') + '</div>'
            + (c.alias ? '<div class="card-sub">也叫：' + esc(c.alias) + '</div>' : '')
            + '<div class="cl-tags">' + (tags ? esc(tags) : '<i>还没填外貌</i>') + '</div></div>';
    }

    function listHtml() {
        if (!list.length) {
            return '<div class="empty"><b>角色库是空的</b>点「新建角色」存一个，或者在描述里写有名字的角色，AI 会自动建档</div>';
        }
        const g = list.filter((c) => c.global), o = list.filter((c) => !c.global);
        return (g.length ? '<div class="label">全局角色</div>' + g.map(cardHtml).join('') : '')
            + (o.length ? '<div class="label">' + (g.length ? '其他角色' : '全部角色') + '</div>' + o.map(cardHtml).join('') : '');
    }

    const HELP = '描述或提示词里写角色的名字，就会自动换成这里存的外貌标签，同一个角色每张图长得一样。';

    async function open() {
        await ready;
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>角色库</b>'
            + '<button class="btn small primary" data-new>新建角色</button></div>'
            + '<div class="page-body"><div class="help" style="margin-bottom:12px">' + HELP + '</div><div class="cl-list"></div></div>');
        const draw = () => { $('.cl-list', L.box).innerHTML = listHtml(); };
        draw();
        $('[data-new]', L.box).onclick = () => edit(null, draw);
        $('.cl-list', L.box).addEventListener('click', (e) => {
            const card = e.target.closest('[data-id]');
            if (card) edit(list.find((c) => c.id === card.dataset.id), draw);
        });
        return L;
    }

    function historyHtml(c) {
        if (!c.history.length) return '';
        const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return '<div class="label" style="margin-top:18px">改动记录</div>' + c.history.slice().reverse().map((h, i) => {
            const n = c.history.length - 1 - i;
            const what = h.field === 'new' ? '建档' : (FIELD_LABEL[h.field] || h.field) + '：' + (h.from || '（空）') + ' → ' + (h.to || '（空）');
            return '<div class="cl-his">'
                + '<div class="grow"><div>' + esc(what) + '</div><div class="card-sub">' + fmt(h.at) + ' · ' + (h.by === 'ai' ? 'AI' : '手动')
                + (h.reason ? ' · ' + esc(h.reason) : '') + '</div></div>'
                + (h.field !== 'new' && h.by === 'ai' ? '<button class="btn small" data-undo="' + n + '">撤销</button>' : '') + '</div>';
        }).join('');
    }

    /** 编辑一个角色；c 为 null 时新建 */
    function edit(c, onDone) {
        const isNew = !c;
        const d = normalizeOne(c || { name: '' });
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>' + (isNew ? '新建角色' : '编辑角色') + '</b>'
            + '<button class="btn small primary" data-save>保存</button></div>'
            + '<div class="page-body">'
            + '<div class="field"><label>名字</label><input type="text" data-f="name" placeholder="描述里怎么叫就怎么写，比如 小雪"></div>'
            + '<div class="field"><label>别名（可留空）</label><input type="text" data-f="alias" placeholder="逗号分隔，比如 我, 主角"><div class="help">描述里出现别名也算这个角色。玩家角色可以把「我」设成别名。</div></div>'
            + '<label class="check"><span class="switch"><input type="checkbox" data-f="global"><span></span></span><span>全局角色（AI 不改）'
            + '<div class="help">玩家、主角这类固定角色。AI 不会改它的外貌，只有你自己能改</div></span></label>'
            + '<div class="label" style="margin-top:14px">固定外貌（英文标签，逗号分隔）</div>'
            + FIELDS.map((f) => '<div class="field"><label>' + esc(f.label) + '</label><input type="text" data-f="' + f.k + '" placeholder="' + esc(f.ph) + '"></div>').join('')
            + '<div class="field"><label>拼出来的外貌标签</label><pre class="recipe cl-preview"></pre></div>'
            + '<div class="field"><label>备注（只给自己看）</label><textarea class="ta small" data-f="note"></textarea></div>'
            + (isNew ? '' : '<div class="btns" style="justify-content:flex-start"><button class="btn danger" data-del>删除这个角色</button></div>')
            + '<div class="cl-history">' + (isNew ? '' : historyHtml(c)) + '</div>'
            + '</div>');
        const box = L.box;
        const preview = () => { $('.cl-preview', box).textContent = tagsOf(d) || '（还没填）'; };
        $$('[data-f]', box).forEach((el) => {
            const k = el.dataset.f;
            const isField = FIELD_KEYS.includes(k);
            const v = isField ? d.fields[k] : d[k];
            if (el.type === 'checkbox') el.checked = !!v; else el.value = v || '';
            el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
                const nv = el.type === 'checkbox' ? el.checked : el.value;
                if (isField) d.fields[k] = nv; else d[k] = nv;
                preview();
            });
        });
        preview();

        $('[data-save]', box).onclick = () => {
            d.name = d.name.trim();
            if (!d.name) { toast('warning', '先起个名字'); return; }
            const dup = find(d.name);
            if (dup && (isNew || dup.id !== c.id)) { toast('warning', '已经有叫「' + d.name + '」的角色了'); return; }
            FIELD_KEYS.forEach((k) => { d.fields[k] = String(d.fields[k] || '').trim(); });
            if (isNew) create(d, 'manual');
            else {
                FIELD_KEYS.forEach((k) => { if (d.fields[k] !== c.fields[k]) record(c, k, c.fields[k], d.fields[k], '', 'manual'); });
                Object.assign(c, { name: d.name, alias: d.alias.trim(), global: d.global, fields: d.fields, note: d.note });
                save();
            }
            UI.closeLayer(L);
            toast('success', '已保存');
            if (onDone) onDone();
        };
        const del = $('[data-del]', box);
        if (del) del.onclick = async () => {
            if (!await UI.confirmBox('删除「' + (c.name || '这个角色') + '」？', '删了就找不回来了。', '删除', true)) return;
            remove(c.id);
            UI.closeLayer(L);
            if (onDone) onDone();
        };
        $('.cl-history', box).addEventListener('click', (e) => {
            const b = e.target.closest('[data-undo]');
            if (!b) return;
            const h = c.history[Number(b.dataset.undo)];
            if (!h || !undo(c, h)) return;
            d.fields[h.field] = c.fields[h.field];
            const inp = $('[data-f="' + h.field + '"]', box);
            if (inp) inp.value = c.fields[h.field];
            preview();
            $('.cl-history', box).innerHTML = historyHtml(c);
            toast('info', '已撤销');
            if (onDone) onDone();
        });
        return L;
    }

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.cl-entry{float:right;color:var(--accent);text-decoration:none;font-size:13px;font-weight:400}'
        + '.cl-card{cursor:pointer}.cl-card .card-title{flex-wrap:wrap}'
        + '.cl-tags{margin-top:6px;font-size:13px;color:var(--dim);overflow-wrap:anywhere}.cl-tags i{color:var(--faint);font-style:normal}'
        + '.cl-his{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}.cl-his .grow{flex:1;min-width:0}'
        + '</style>');

    // 创作页「用中文描述…」标题旁边放个入口（创作页重画时自动补上）
    function addEntry() {
        const desc = $('#c-desc');
        if (!desc || $('#c-char-lib')) return;
        const label = desc.parentNode.querySelector('.label');
        if (!label) return;
        label.insertAdjacentHTML('beforeend', '<a href="#" id="c-char-lib" class="cl-entry">角色库</a>');
        $('#c-char-lib').addEventListener('click', (e) => { e.preventDefault(); open(); });
    }
    const view = $('#view-create');
    if (view) new MutationObserver(addEntry).observe(view, { childList: true, subtree: true });
    addEntry();

    // 设置页「角色库」标签
    SettingsPage.addTab({
        id: 'chars', label: '角色库',
        html: () => '<div class="help" style="margin-bottom:12px">' + HELP + ' 现在存了 ' + list.length + ' 个角色。</div>'
            + '<div class="btns" style="justify-content:flex-start;margin:0 0 16px"><button class="btn primary" data-act="chars-open">打开角色库</button></div>'
            + '<label class="check"><span class="switch"><input type="checkbox" data-k="chars.inject"><span></span></span><span>写提示词时把角色外貌发给 AI'
            + '<div class="help">描述里出现已建档的角色，AI 照抄存好的外貌标签</div></span></label>'
            + '<label class="check"><span class="switch"><input type="checkbox" data-k="chars.autoCreate"><span></span></span><span>AI 自动给新角色建档'
            + '<div class="help">描述里出现有名字、库里没有的角色，AI 定好外貌存进角色库，下次就用这一套</div></span></label>'
            + '<label class="check"><span class="switch"><input type="checkbox" data-k="chars.autoUpdate"><span></span></span><span>永久变化自动更新'
            + '<div class="help">描述里写了染发、剪发这类永久变化，自动改角色库（全局角色不改）。改错了在角色的「改动记录」里撤销</div></span></label>',
        acts: { 'chars-open': () => open() },
    });

    window.CharLib = {
        ready, open, edit, find, mentioned, tagsOf, expand, expandDetail, expandParams, parseChanges, applyChanges, contextText, create, remove, undo,
        FIELDS, get list() { return list; },
    };
})();
