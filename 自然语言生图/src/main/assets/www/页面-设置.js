/*
 * 页面-设置.js —— 设置页：AI 接口、NAI 出图、提示词规范
 *
 * 表单项用 data-k="ai.url" 这样的路径直接绑到 UI.settings，改了自动保存。
 */
(function () {
    'use strict';

    const { $, $$, esc, toast } = UI;
    let tab = 'ai';

    const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), UI.settings);
    function set(path, v) {
        const ks = path.split('.');
        const last = ks.pop();
        ks.reduce((o, k) => o[k], UI.settings)[last] = v;
        UI.saveSettings();
    }

    const text = (label, k, opts) => {
        opts = opts || {};
        return '<div class="field"><label>' + esc(label) + '</label>'
            + (opts.multiline
                ? '<textarea class="ta' + (opts.big ? ' big' : '') + '" data-k="' + k + '" placeholder="' + esc(opts.ph || '') + '"></textarea>'
                : '<input type="' + (opts.type || 'text') + '" data-k="' + k + '" placeholder="' + esc(opts.ph || '') + '"' + (opts.step ? ' step="' + opts.step + '"' : '') + '>')
            + (opts.help ? '<div class="help">' + opts.help + '</div>' : '') + '</div>';
    };
    const select = (label, k, list, help) => '<div class="field"><label>' + esc(label) + '</label><select data-k="' + k + '">'
        + list.map((x) => '<option value="' + esc(x.value) + '">' + esc(x.label) + '</option>').join('') + '</select>'
        + (help ? '<div class="help">' + help + '</div>' : '') + '</div>';
    /** 尺寸：预设下拉 + 自定义 */
    function sizeField(label, key) {
        const v = UI.settings.nai[key];
        const preset = Params.SIZES.some((x) => x.value === v);
        return '<div class="field"><label>' + esc(label) + '</label><select data-size="' + key + '">'
            + Params.SIZES.map((x) => '<option value="' + esc(x.value) + '"' + (x.value === v ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('')
            + '<option value=""' + (preset ? '' : ' selected') + '>自定义…</option></select>'
            + '<input type="text" data-k="nai.' + key + '" placeholder="宽×高，64 的倍数" style="margin-top:6px"' + (preset ? ' hidden' : '') + '></div>';
    }

    const check = (label, k, help) => '<label class="check"><span class="switch"><input type="checkbox" data-k="' + k + '"><span></span></span><span>' + esc(label)
        + (help ? '<div class="help">' + help + '</div>' : '') + '</span></label>';

    function tabAi() {
        return text('接口地址', 'ai.url', { ph: 'https://api.openai.com/v1', help: '填法和酒馆「自定义 OpenAI 兼容」一样，官方、中转站、反代都行' })
            + text('API Key', 'ai.key', { type: 'password' })
            + '<div class="field"><label>模型</label><div class="row"><input class="grow" type="text" data-k="ai.model" placeholder="比如 gpt-4o-mini、deepseek-chat">'
            + '<button class="btn" data-act="models">拉取列表</button></div></div>'
            + check('流式输出（边写边显示）', 'ai.stream', '有的中转站不支持流式，出错时关掉试试')
            + text('温度', 'ai.temperature', { type: 'number', step: '0.1', help: '越低越稳定，写提示词 0.5~0.8 比较合适' })
            + text('额外请求头（JSON，可留空）', 'ai.headers', { multiline: true, ph: '{"X-Foo":"bar"}' })
            + text('额外请求参数（JSON，可留空）', 'ai.extra', { multiline: true, ph: '{"max_tokens":2000}' })
            + '<div class="btns"><button class="btn primary" data-act="test-ai">测试一下</button></div>';
    }

    function tabNai() {
        const n = UI.settings.nai;
        return text('NAI 地址', 'nai.url', { ph: Params.NAI_OFFICIAL, help: '官方填 ' + Params.NAI_OFFICIAL + '；第三方站填它给的地址' })
            + text('NAI Key', 'nai.key', { type: 'password', help: '官方 Key 在 NovelAI 网页 → 设置 → Account → Get Persistent API Token' })
            + '<div class="btns" style="margin-top:-4px;margin-bottom:14px"><button class="btn" data-act="test-nai">测试连接、查 Anlas</button></div>'
            + select('模型', 'nai.model', Params.MODELS, Params.supportsNl(n.model) ? '' : '这个模型只认英文标签，不发英文画面描述')
            + '<div class="grid2">'
            + select('采样器', 'nai.sampler', Params.samplersFor(n.model))
            + select('噪声调度', 'nai.noiseSchedule', Params.NOISE)
            + text('步数', 'nai.steps', { type: 'number', help: 'Opus 会员 28 步以内不扣 Anlas' })
            + text('CFG（提示词相关度）', 'nai.scale', { type: 'number', step: '0.1' })
            + sizeField('竖图尺寸', 'portraitSize')
            + sizeField('横图尺寸', 'landscapeSize')
            + text('CFG Rescale', 'nai.cfgRescale', { type: 'number', step: '0.05' })
            + '</div>'
            + '<div class="field"><label>种子</label><div class="row"><input class="grow" type="number" data-k="nai.seed">'
            + '<button class="btn" data-act="seed-last">用上一张的</button><button class="btn" data-act="seed-random">随机</button></div>'
            + '<div class="help">0 = 每次随机；填了数字就锁定，每张都用这个种子（创作页也能一键锁定）</div></div>'
            + check('Variety Boost（画面更多样）', 'nai.varietyBoost', 'V5 不需要，开着也不影响')
            + check('生成英文自然语言描述', 'nai.naturalLanguage', 'NAI 4.5 / V5 能读英文句子。提示词有长度上限，觉得画面怪可以关掉，只用标签')
            + '<div class="field"><label>画风模板（画师串）</label><div class="row"><select class="grow" data-k="nai.styleId">'
            + '<option value="">不用模板</option>' + n.styles.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name || '未命名') + '</option>').join('')
            + '</select><button class="btn" data-act="styles">管理</button></div>'
            + '<div class="help">模板里存前缀（画师串）、后缀、负面词，创作页也能下拉切换</div></div>'
            + '<div class="field"><label>质量词（拼在正面最后）</label><textarea class="ta" data-k="nai.quality" placeholder="' + esc(Params.QUALITY[n.model] || '') + '"></textarea>'
            + '<div class="help">留空 = 用模型默认（灰字就是默认值）。<a href="#" data-act="reset-q">恢复默认</a></div></div>'
            + '<div class="field"><label>负面词</label><textarea class="ta" data-k="nai.negative" placeholder="' + esc(Params.NEGATIVE[n.model] || '') + '"></textarea>'
            + '<div class="help">留空 = 用模型默认（灰字就是默认值）。AI 补的负面词会接在后面。<a href="#" data-act="reset-n">恢复默认</a></div></div>';
    }

    function tabSpec() {
        return '<div class="field"><label>AI 写提示词的规范</label><textarea class="ta big" data-k="prompts.system"></textarea>'
            + '<div class="help">告诉 AI 怎么把中文写成 NAI 提示词。留空 = 用内置规范。改的时候要保留「只输出 JSON」那段格式要求，不然程序读不了。</div></div>'
            + '<div class="btns"><button class="btn" data-act="fill-spec">把内置规范填进来改</button><button class="btn danger" data-act="reset-spec">恢复内置</button></div>';
    }

    // 标签页表：以后的功能（备份、更新、角色库…）用 SettingsPage.addTab 加自己的页，不用改这里
    const TABS = [
        { id: 'ai', label: 'AI 接口', html: tabAi },
        { id: 'nai', label: 'NAI 出图', html: tabNai },
        { id: 'spec', label: '提示词规范', html: tabSpec },
    ];
    const extraActs = {};
    /** t: { id, label, html() 返回表单 HTML（data-k 自动绑定）, acts: { 名字: async (按钮, 重画) => {} } } */
    function addTab(t) {
        TABS.push(t);
        Object.assign(extraActs, t.acts || {});
    }

    function render(L) {
        const body = $('.page-body', L.box);
        $$('.tabs button', L.box).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
        body.innerHTML = (TABS.find((t) => t.id === tab) || TABS[0]).html();
        $$('[data-k]', body).forEach((el) => {
            const v = get(el.dataset.k);
            if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
            el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
                let nv = el.type === 'checkbox' ? el.checked : el.value;
                if (el.type === 'number') nv = nv === '' ? 0 : Number(nv);
                set(el.dataset.k, nv);
                if (el.dataset.k === 'nai.model') render(L); // 默认质量词/负面词跟着模型变
            });
        });
        $$('[data-size]', body).forEach((el) => el.addEventListener('change', () => {
            const input = el.nextElementSibling;
            input.hidden = !!el.value;
            if (el.value) set('nai.' + el.dataset.size, el.value); else input.focus();
        }));
        $$('[data-act]', body).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); act(b.dataset.act, b, L); }));
    }

    function checkJson(path, label) {
        const v = String(get(path) || '').trim();
        if (!v) return true;
        try { JSON.parse(v); return true; } catch (e) { toast('error', label + '不是合法的 JSON'); return false; }
    }

    async function act(a, btn, L) {
        const s = UI.settings;
        if (extraActs[a]) return extraActs[a](btn, () => render(L));
        if (a === 'models' || a === 'test-ai') {
            if (!checkJson('ai.headers', '额外请求头') || !checkJson('ai.extra', '额外请求参数')) return;
            btn.disabled = true;
            try {
                const list = await Api.listModels(s.ai);
                if (!list.length) { toast('warning', '接口通了，但没返回模型列表，手动填模型名吧'); return; }
                if (a === 'test-ai') { toast('success', '接口正常，共 ' + list.length + ' 个模型'); return; }
                const m = await UI.pickFrom('选择模型', list, s.ai.model);
                if (m) { set('ai.model', m); render(L); }
            } catch (e) {
                toast('error', e.message || String(e), '连接失败');
            } finally { btn.disabled = false; }
        } else if (a === 'test-nai') {
            btn.disabled = true;
            try { toast('success', await Nai.test(s.nai)); } catch (e) { toast('error', e.message || String(e)); } finally { btn.disabled = false; }
        } else if (a === 'reset-q') { set('nai.quality', ''); render(L); }
        else if (a === 'reset-n') { set('nai.negative', ''); render(L); }
        else if (a === 'seed-last') {
            if (!Nai.state.lastSeed) { toast('info', '这次打开还没出过图'); return; }
            set('nai.seed', Nai.state.lastSeed); render(L);
        } else if (a === 'seed-random') { set('nai.seed', 1 + Math.floor(Math.random() * (2 ** 32 - 1))); render(L); }
        else if (a === 'styles') { tab = 'style'; render(L); }
        else if (a === 'fill-spec') { set('prompts.system', Writer.DEFAULT_SPEC); render(L); }
        else if (a === 'reset-spec') {
            if (await UI.confirmBox('恢复内置规范？', '你改过的规范会被清掉。', '恢复', true)) { set('prompts.system', ''); render(L); }
        }
    }

    function open(which) {
        if (which) tab = which;
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>设置</b></div>'
            + '<div class="tabs">' + TABS.map((t) => '<button data-tab="' + t.id + '">' + esc(t.label) + '</button>').join('') + '</div>'
            + '<div class="page-body"></div>', { onClose: () => window.CreatePage && CreatePage.refresh() });
        $$('.tabs button', L.box).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(L); }));
        render(L);
    }

    window.SettingsPage = { open, addTab };
})();
