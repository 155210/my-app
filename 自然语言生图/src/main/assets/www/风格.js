/*
 * 风格.js —— 画风模板（画师串）：多套保存，每套有前缀、后缀、负面词，下拉一键切换
 *
 * 数据在 settings.nai.styles / settings.nai.styleId（默认值见 参数.js）。
 * 拼进提示词的地方在 出图.js 的 fullPrompts。
 * 这里只做设置页里的「画风模板」标签页，创作页的下拉在 快捷栏.js。
 */
(function () {
    'use strict';

    const { esc, toast } = UI;
    const nai = () => UI.settings.nai;
    const newId = () => 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    function add(from) {
        const st = Object.assign({ name: '', prefix: '', quality: '', uc: '', suffix: '', nlSuffix: '', negative: '' }, from, { id: newId() });
        if (from) st.name = (from.name || '未命名') + ' 副本';
        nai().styles.push(st);
        UI.saveSettings();
        return st;
    }

    function use(id) {
        nai().styleId = id;
        UI.saveSettings();
    }

    function html() {
        const n = nai();
        const list = n.styles.map((x, i) => {
            const k = 'nai.styles.' + i + '.';
            const on = x.id === n.styleId;
            return '<div class="card style-card' + (on ? ' on' : '') + '">'
                + '<div class="row" style="margin-bottom:8px"><input class="grow" type="text" data-k="' + k + 'name" placeholder="模板名字">'
                + (on ? '<span class="badge acc">正在用</span>' : '<button class="btn" data-act="style-use" data-i="' + i + '">用这套</button>') + '</div>'
                + '<div class="field"><label>前缀（画师串，拼在正面最前）</label><textarea class="ta small" data-k="' + k + 'prefix" placeholder="artist:xxx, 0.8::artist:yyy::"></textarea></div>'
                + (x.blank ? '<div class="help" style="margin-bottom:12px">空白模板：质量词、负面提示词都不加（不用「NAI 出图」页的，也不用模型默认的），只发你自己写的标签。</div>'
                    : '<div class="field"><label>正面质量词（这套专用，拼在正面最后）' + setBadge(x.quality) + '</label><textarea class="ta small" data-k="' + k + 'quality" placeholder="' + esc(Params.globalQuality(n)) + '"></textarea>'
                + '<div class="help">留空 = 用「NAI 出图」页的质量词（灰字就是现在会用的）</div></div>'
                + '<div class="field"><label>负面提示词（这套专用）' + setBadge(x.uc) + '</label><textarea class="ta small" data-k="' + k + 'uc" placeholder="' + esc(Params.globalNegative(n)) + '"></textarea>'
                + '<div class="help">留空 = 用「NAI 出图」页的负面词（灰字就是现在会用的）</div></div>')
                + '<div class="field"><label>后缀（拼在画面标签后、质量词前）</label><textarea class="ta small" data-k="' + k + 'suffix" placeholder="可留空，比如 flat color, cel shading"></textarea></div>'
                + '<div class="field"><label>描述后缀（接在英文画面描述后面）</label><textarea class="ta small" data-k="' + k + 'nlSuffix" placeholder="可留空，比如 The lighting is soft and warm."></textarea>'
                + '<div class="help">英文句子，V4.5 / V5 才发；没有英文描述时就单独接在正面最后</div></div>'
                + '<div class="field"><label>额外负面词（接在负面提示词后面）</label><textarea class="ta small" data-k="' + k + 'negative" placeholder="可留空"></textarea></div>'
                + '<div class="btns"><button class="btn" data-act="style-copy" data-i="' + i + '">复制一套</button>'
                + '<button class="btn danger" data-act="style-del" data-i="' + i + '">删除</button></div></div>';
        }).join('');
        return '<div class="help" style="margin-bottom:12px">画风模板 = 一套画师串 + 质量词 + 负面提示词，切换模板三样一起换（同柏宝绘）。出图时：正面 = 前缀, 画面标签, 后缀, 质量词. 英文描述 描述后缀；负面 = 负面提示词, 额外负面词, AI 补的负面词。质量词、负面提示词留空就用「NAI 出图」页的。</div>'
            + '<div class="field"><label>当前用</label><select data-k="nai.styleId"><option value="">不用模板</option>'
            + n.styles.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name || '未命名') + '</option>').join('') + '</select></div>'
            + list
            + '<div class="btns"><button class="btn primary" data-act="style-add">新建一套</button>'
            + (n.styles.some((x) => x.id === 'st_default') ? '' : '<button class="btn" data-act="style-builtin">加回内置那套</button>')
            + (n.styles.some((x) => x.blank) ? '' : '<button class="btn" data-act="style-blank">加一套空白模板</button>') + '</div>';
    }

    const setBadge = (v) => (String(v || '').trim() ? ' <span class="badge acc">已设置</span>' : ' <span class="badge">未设置</span>');
    const idx = (btn) => Number(btn.dataset.i);

    SettingsPage.addTab({
        id: 'style',
        label: '画风模板',
        html,
        acts: {
            'style-use': (btn, redraw) => { use(nai().styles[idx(btn)].id); redraw(); },
            'style-add': (btn, redraw) => { const st = add(); st.name = '模板 ' + nai().styles.length; use(st.id); redraw(); },
            'style-copy': (btn, redraw) => { add(nai().styles[idx(btn)]); redraw(); },
            'style-blank': (btn, redraw) => { nai().styles.push(Object.assign({}, Params.BLANK_STYLE)); UI.saveSettings(); redraw(); },
            'style-builtin': (btn, redraw) => { nai().styles.push(Object.assign({}, Params.DEFAULT_STYLES[0])); UI.saveSettings(); redraw(); },
            'style-del': async (btn, redraw) => {
                const st = nai().styles[idx(btn)];
                if (!await UI.confirmBox('删除「' + (st.name || '未命名') + '」？', '删了就找不回来了。', '删除', true)) return;
                nai().styles.splice(idx(btn), 1);
                if (nai().styleId === st.id) nai().styleId = '';
                UI.saveSettings();
                toast('info', '已删除');
                redraw();
            },
        },
    });

    window.Styles = { add, use };
})();
