/*
 * 通配符.js —— 提示词里写 __名字__，每次出图随机换成那个通配符里的一行
 *
 * 通配符存在设置的 tags.wildcards：[{ name, lines }]（lines 一行一个，空行和 # 开头的不算），设置页「通配符」标签里管理。
 * 能套娃（某一行里再写 __别的__），最多套 5 层；名字没建过的原样留着。
 * 画面标签走 Nai.addTagFilter，负面词、多角色的角色提示词走 Nai.addHook；配方里记的是换好以后的。
 */
(function () {
    'use strict';

    const { esc, toast } = UI;
    const RE = /__([^\s_](?:[^\s]*?[^\s_])?)__/g;
    const SAMPLES = [
        { name: '发色', lines: 'black hair\nblonde hair\nbrown hair\nsilver hair\npink hair\nblue hair\nred hair\nwhite hair' },
        { name: '表情', lines: 'smile\ngrin\nblush\nembarrassed\npout\nsurprised\nexpressionless\nsmug\nlaughing' },
        { name: '天气', lines: 'sunny, blue sky\nrain, wet\nsnow, snowing\ncloudy sky\nsunset, orange sky\nnight, starry sky' },
    ];

    const list = () => {
        const t = UI.settings.tags;
        if (!Array.isArray(t.wildcards)) t.wildcards = SAMPLES.map((x) => Object.assign({}, x));
        return t.wildcards;
    };
    const linesOf = (w) => String(w.lines || '').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
    const find = (name) => list().find((w) => w.name.trim() === name);

    /** 把文字里的 __名字__ 随机换掉；rand 可传进来（测试用） */
    function resolve(text, rand) {
        rand = rand || Math.random;
        let s = String(text || '');
        for (let depth = 0; depth < 5 && RE.test(s); depth++) {
            RE.lastIndex = 0;
            s = s.replace(RE, (m, name) => {
                const w = find(name);
                const ls = w ? linesOf(w) : [];
                return ls.length ? ls[Math.floor(rand() * ls.length)] : m;
            });
            RE.lastIndex = 0;
        }
        RE.lastIndex = 0;
        return s;
    }
    const has = (text) => { RE.lastIndex = 0; const r = RE.test(String(text || '')); RE.lastIndex = 0; return r; };

    Nai.addTagFilter((tag) => (has(tag) ? resolve(tag) : tag));
    Nai.addHook((params, nai, p, extra) => {
        if (has(params.negative_prompt)) {
            const old = params.negative_prompt;
            params.negative_prompt = resolve(old);
            const v4n = params.v4_negative_prompt;
            if (v4n && v4n.caption && v4n.caption.base_caption === old) v4n.caption.base_caption = params.negative_prompt;
            extra.negative = params.negative_prompt;
        }
        // 多角色：char_captions 和 characterPrompts 是同一个角色，换成同一行
        const pos = params.v4_prompt && params.v4_prompt.caption && params.v4_prompt.caption.char_captions || [];
        const neg = params.v4_negative_prompt && params.v4_negative_prompt.caption && params.v4_negative_prompt.caption.char_captions || [];
        const cps = params.characterPrompts || [];
        pos.forEach((c, i) => {
            if (!has(c.char_caption)) return;
            c.char_caption = resolve(c.char_caption);
            if (cps[i]) cps[i].prompt = c.char_caption;
        });
        neg.forEach((c, i) => {
            if (!has(c.char_caption)) return;
            c.char_caption = resolve(c.char_caption);
            if (cps[i]) cps[i].uc = c.char_caption;
        });
    });

    SettingsPage.addTab({
        id: 'wildcards', label: '通配符',
        html: () => '<div class="help" style="margin-bottom:12px">提示词里写 <b>__名字__</b>（前后各两个下划线），每次出图随机换成下面那个通配符里的一行。'
            + '正面、负面、多角色的提示词里都能用；一行里也能再写别的 __名字__。# 开头的行不算。</div>'
            + list().map((w, i) => '<div class="card"><div class="row"><input class="grow" type="text" data-k="tags.wildcards.' + i + '.name" placeholder="名字">'
                + '<button class="btn small danger" data-act="wc-del" data-i="' + i + '">删除</button></div>'
                + '<div class="card-sub" style="margin:6px 0 4px">用法：__' + esc(w.name || '名字') + '__ · ' + linesOf(w).length + ' 行</div>'
                + '<textarea class="ta small" data-k="tags.wildcards.' + i + '.lines" placeholder="一行一个，比如&#10;black hair&#10;blonde hair"></textarea></div>').join('')
            + '<div class="btns" style="justify-content:flex-start"><button class="btn primary" data-act="wc-add">新建通配符</button></div>',
        acts: {
            'wc-add': (btn, redraw) => {
                const ws = list();
                let n = ws.length + 1;
                while (find('通配符' + n)) n++;
                ws.push({ name: '通配符' + n, lines: '' });
                UI.saveSettings();
                redraw();
            },
            'wc-del': async (btn, redraw) => {
                const ws = list(), i = +btn.dataset.i;
                if (!ws[i] || !(await UI.confirmBox('删除通配符「' + ws[i].name + '」？', '', '删除', true))) return;
                ws.splice(i, 1);
                UI.saveSettings();
                redraw();
                toast('success', '已删除');
            },
        },
    });

    window.Wildcards = { resolve, has, names: () => list().map((w) => w.name.trim()).filter(Boolean), list };
})();
