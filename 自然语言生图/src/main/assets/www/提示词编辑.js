/*
 * 提示词编辑.js —— 写提示词的格子（正面、负面、多角色、画风模板、质量词…）加三样东西：
 *  1. 联想：光标所在的那个标签，中文英文都能联想（标签库），点一下换上；写 __ 时联想通配符名字
 *  2. 调权重：联想条最左边 − 1.1 ＋，给光标所在的标签加减权重（V4 起写成 1.1::标签::，V3 写成 {标签} / [标签]）；ⓘ 看标签说明
 *  3. 语法高亮：加权（橙）、减权（蓝）、负权重（红）、画师（紫）、通配符（绿）、标签库里没有的标签（虚下划线）
 *
 * 高亮做法：格子背后垫一层同样字体、同样排版的 div，里面的字透明，只画彩色底色和虚下划线；格子本身的字照常显示。
 * （以前是格子的字透明、背后那层显示彩色字，手机上两层排版只要差一点，就会出现滑不到底、选字选到一半停住，所以改成这样：
 *  滑动、选字、光标都是格子自己的，背后那层就算偏一点也只是色块偏一点。）
 * 别的代码直接改 .value 不发 input 事件也没关系：每个格子的 value 赋值被接管了，改完自动重画。
 * 开关在设置 → 标签库（tags.complete、tags.highlight）。
 */
(function () {
    'use strict';

    const { $, esc } = UI;
    const SEL = ['#c-tag', '#c-neg', '#c-chars textarea[data-f]', 'textarea[data-k$="prefix"]', 'textarea[data-k$="suffix"]',
        'textarea[data-k^="nai.styles"][data-k$="quality"]', 'textarea[data-k$=".uc"]', 'textarea[data-k^="nai.styles"][data-k$="negative"]',
        'textarea[data-k="nai.quality"]', 'textarea[data-k="nai.negative"]',
        // 图生图「编辑这张图」、通配符的每一行
        'textarea[data-f="tag"]', 'textarea[data-f="negative"]', 'textarea[data-k^="tags.wildcards"][data-k$=".lines"]',
        // 单行的：多角色互动动作、写真自己补的姿势/场景、衣柜每件衣服、表情/上色提示词、角色库外貌各栏；以后的格子加 data-tags 就行
        '#c-chars input[data-g="act"]', 'input[data-ps="customPose"]', 'input[data-ps="customScene"]', 'input[data-ws]', 'input[type="text"][data-p]',
        ...['fandom', 'sex', 'hair', 'eyes', 'skin', 'body', 'extra', 'outfit'].map((k) => 'input[type="text"][data-f="' + k + '"]'),
        'textarea[data-tags]', 'input[data-tags]'].join(',');
    const opt = () => UI.settings.tags || {};
    const V3 = () => Params.isV3(UI.settings.nai.model);

    // ------------------------------------------------------------
    // 光标所在的标签
    // ------------------------------------------------------------
    /** 返回 { start, end, raw, pre, inner, post, w }：raw 是逗号之间去掉首尾空格的那段，inner 是去掉权重写法后的标签 */
    function tokenAt(text, pos) {
        let a = pos, b = pos;
        while (a > 0 && !/[,，\n]/.test(text[a - 1])) a--;
        while (b < text.length && !/[,，\n]/.test(text[b])) b++;
        while (a < b && /\s/.test(text[a])) a++;
        let e = b;
        while (e > a && /\s/.test(text[e - 1])) e--;
        const raw = text.slice(a, e);
        return Object.assign({ start: a, end: e, raw }, parseWeight(raw));
    }

    /** 拆权重：1.2::tag:: / {{tag}} / [tag]；返回 { pre, inner, post, w } */
    function parseWeight(raw) {
        let m = raw.match(/^(-?\d*\.?\d+)::([\s\S]*?)(::)?$/);
        if (m) return { pre: m[1] + '::', inner: m[2], post: m[3] || '', w: Number(m[1]) };
        m = raw.match(/^(\{+)([^{}]*?)(\}*)$/);
        if (m) return { pre: m[1], inner: m[2], post: m[3], w: Math.pow(1.05, m[1].length) };
        m = raw.match(/^(\[+)([^[\]]*?)(\]*)$/);
        if (m) return { pre: m[1], inner: m[2], post: m[3], w: Math.pow(1.05, -m[1].length) };
        return { pre: '', inner: raw, post: '', w: 1 };
    }

    const round = (x) => Math.round(x * 100) / 100;
    /** 按权重拼回去 */
    function withWeight(inner, w, v3) {
        if (v3) {
            const n = Math.round(Math.log(w) / Math.log(1.05));
            return n > 0 ? '{'.repeat(n) + inner + '}'.repeat(n) : n < 0 ? '['.repeat(-n) + inner + ']'.repeat(-n) : inner;
        }
        w = round(w);
        return Math.abs(w - 1) < 0.001 ? inner : w + '::' + inner + '::';
    }

    function replaceRange(ta, a, b, s, caret) {
        const v = ta.value;
        ta.value = v.slice(0, a) + s + v.slice(b);
        const c = caret == null ? a + s.length : caret;
        ta.setSelectionRange(c, c);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /** 光标所在标签加减权重；d = +1 / -1 */
    function bump(ta, d) {
        const t = tokenAt(ta.value, ta.selectionStart);
        if (!t.inner.trim()) return;
        const v3 = V3();
        let w;
        if (v3) w = Math.pow(1.05, Math.round(Math.log(t.w) / Math.log(1.05)) + d);
        else w = round(t.w + d * 0.1);
        if (!v3 && Math.abs(w) < 0.001) w = d > 0 ? 0.1 : -0.1; // 跳过 0
        const s = withWeight(t.inner, w, v3);
        replaceRange(ta, t.start, t.end, s, t.start + s.indexOf(t.inner) + t.inner.length);
    }

    /** 用联想到的标签换掉光标所在标签（保留权重写法） */
    function pick(ta, tag) {
        const t = tokenAt(ta.value, ta.selectionStart);
        const s = t.pre + tag + t.post;
        const one = ta.tagName === 'INPUT' && ta.dataset.g === 'act'; // 互动动作只填一个标签，不补逗号
        const atEnd = !one && !/\S/.test(ta.value.slice(t.end).replace(/^[,，\s]*/, '')) && !/[,，]\s*$/.test(ta.value.slice(t.end));
        if (atEnd) replaceRange(ta, t.start, ta.value.length, s + ', ');
        else replaceRange(ta, t.start, t.end, s);
        if (ta.tagName === 'INPUT') ta.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ------------------------------------------------------------
    // 联想条
    // ------------------------------------------------------------
    let strip = null, cur = null, hideT = 0;

    function ensureStrip() {
        if (strip) return strip;
        strip = document.createElement('div');
        strip.className = 'pe-strip';
        // 点联想条不让格子失焦（不然键盘会收起）
        strip.addEventListener('pointerdown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
        strip.addEventListener('mousedown', (e) => e.preventDefault());
        strip.addEventListener('click', (e) => {
            if (!cur) return;
            const b = e.target.closest('[data-a]');
            if (!b) return;
            const a = b.dataset.a;
            if (a === 'up') bump(cur, 1);
            else if (a === 'down') bump(cur, -1);
            else if (a === 'wiki' && window.TagWiki) TagWiki.open(b.dataset.t);
            else if (a === 'pick') pick(cur, b.dataset.t);
            else if (a === 'wc') pick(cur, '__' + b.dataset.t + '__');
            cur.focus();
            update();
        });
        return strip;
    }

    function update() {
        const ta = cur;
        if (!ta || document.activeElement !== ta || !opt().complete) { hide(); return; }
        const t = tokenAt(ta.value, ta.selectionStart);
        const q = t.inner.trim();
        const s = ensureStrip();
        let chips = '';
        if (/^_{1,2}/.test(q) && window.Wildcards) {
            const k = q.replace(/^_+|_+$/g, '');
            chips = Wildcards.names().filter((n) => n.includes(k)).slice(0, 12)
                .map((n) => '<button data-a="wc" data-t="' + esc(n) + '"><b>__' + esc(n) + '__</b></button>').join('');
        } else if (q && TagLib.loaded) {
            const k = TagLib.norm(q);
            chips = TagLib.suggest(q, 15).filter((x) => x[0] !== k || /[一-鿿]/.test(q))
                .map((x) => '<button data-a="pick" data-t="' + esc(x[0]) + '">' + (x[1] ? '<b>' + esc(x[1]) + '</b> ' : '') + esc(x[0]) + '</button>').join('');
        }
        const known = q && TagLib.loaded && TagLib.canon(q);
        const w = q ? (V3() ? '{' + Math.round(Math.log(t.w) / Math.log(1.05)) + '}' : String(round(t.w))) : '';
        s.innerHTML = (q ? '<span class="pe-w"><button data-a="down" aria-label="减权重">−</button><em>' + esc(w) + '</em><button data-a="up" aria-label="加权重">＋</button></span>' : '')
            + (known && window.TagWiki ? '<button data-a="wiki" data-t="' + esc(known) + '" class="pe-i">ⓘ ' + esc((TagLib.get(known) || [])[1] || '说明') + '</button>' : '')
            + chips;
        if (!s.innerHTML) { hide(); return; }
        // 单行框常和按钮挤在一行（.row）里，联想条放到那一行下面
        const at = ta.tagName === 'INPUT' ? (ta.closest('.row') || ta) : ta;
        if (s.previousElementSibling !== at) at.after(s);
        s.hidden = false;
        s.scrollLeft = 0;
    }
    function hide() { if (strip) strip.hidden = true; }

    // ------------------------------------------------------------
    // 语法高亮
    // ------------------------------------------------------------
    /** 把提示词变成带颜色的 HTML（纯函数，可测） */
    function highlight(text) {
        const out = [];
        // 逐段（逗号、换行分开）判断：画师、通配符、不认识
        const re = /([^,，\n|]*)([,，\n|]?)/g;
        let m, wNum = null, brace = 0, bracket = 0;
        while ((m = re.exec(text)) && (m[0] || re.lastIndex < text.length)) {
            if (!m[0]) { re.lastIndex++; continue; }
            const seg = m[1];
            let html = '';
            const lead = seg.match(/^\s*/)[0];
            const body = seg.slice(lead.length);
            // 段内逐字：权重符号单独上色，其余按当前权重上色
            let buf = '', cls = null;
            const flush = () => { if (buf) { html += cls ? '<span class="' + cls + '">' + esc(buf) + '</span>' : esc(buf); buf = ''; } };
            const state = () => {
                if (wNum != null) return wNum < 0 ? 'pe-neg' : wNum > 1 ? 'pe-up' : wNum < 1 ? 'pe-dn' : null;
                if (brace > bracket) return 'pe-up';
                if (bracket > brace) return 'pe-dn';
                return null;
            };
            for (let j = 0; j < body.length;) {
                const rest = body.slice(j);
                let mm;
                if ((mm = rest.match(/^-?\d*\.?\d+::/)) && (j === 0 || /[\s{[(]/.test(body[j - 1]))) {
                    flush(); wNum = parseFloat(mm[0]); html += '<span class="pe-op">' + esc(mm[0]) + '</span>'; j += mm[0].length; continue;
                }
                if (rest.startsWith('::')) { flush(); wNum = null; html += '<span class="pe-op">::</span>'; j += 2; continue; }
                const ch = body[j];
                if ('{}[]'.indexOf(ch) >= 0) {
                    flush();
                    if (ch === '{') brace++; else if (ch === '}') brace = Math.max(0, brace - 1);
                    else if (ch === '[') bracket++; else bracket = Math.max(0, bracket - 1);
                    html += '<span class="pe-op">' + ch + '</span>'; j++; continue;
                }
                if ((mm = rest.match(/^__[^\s_](?:[^\s]*?[^\s_])?__/))) { flush(); html += '<span class="pe-wc">' + esc(mm[0]) + '</span>'; j += mm[0].length; continue; }
                if ((mm = rest.match(/^artist:/i))) { flush(); cls = 'pe-art'; buf += mm[0]; j += mm[0].length; continue; }
                const c = cls === 'pe-art' ? 'pe-art' : state();
                if (c !== cls) { flush(); cls = c; }
                buf += ch; j++;
            }
            flush();
            // 不认识的标签：去掉权重写法后查标签库
            const bare = body.replace(/-?\d*\.?\d+::|::|[{}[\]]/g, '').trim();
            if (bare && TagLib.loaded && !/^artist:|__|[.!?。]$|\s{2}/i.test(bare) && bare.split(' ').length <= 6 && !TagLib.canon(bare)) {
                html = '<span class="pe-unk">' + html + '</span>';
            }
            out.push(esc(lead) + html);
            if (m[2]) out.push(m[2] === '|' ? '<span class="pe-op">|</span>' : esc(m[2]));
            if (re.lastIndex >= text.length) break;
        }
        return out.join('') + '\n'; // 末尾补一行，和 textarea 的高度对齐
    }

    const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRadius', 'tabSize', 'wordSpacing', 'textIndent'];
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    const protoIn = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    function attach(ta) {
        if (ta.dataset.pe) return;
        ta.dataset.pe = '1';
        const one = ta.tagName === 'INPUT'; // 单行框只联想、调权重，不垫高亮
        const P = one ? protoIn : proto;
        let back = null;
        const draw = () => {
            if (one) return;
            if (!opt().highlight || !ta.isConnected) { if (back) { back.remove(); back = null; ta.classList.remove('pe-on'); } return; }
            if (!back) {
                back = document.createElement('div');
                back.className = 'pe-back';
                back.setAttribute('aria-hidden', 'true');
                ta.before(back);
                ta.classList.add('pe-on');
                const p = ta.parentNode;
                if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
            }
            const cs = getComputedStyle(ta);
            COPY.forEach((k) => { back.style[k] = cs[k]; });
            back.style.left = ta.offsetLeft + 'px';
            back.style.top = ta.offsetTop + 'px';
            back.style.width = ta.offsetWidth + 'px';
            back.style.height = ta.offsetHeight + 'px';
            back.innerHTML = highlight(proto.get.call(ta));
            back.scrollTop = ta.scrollTop;
        };
        Object.defineProperty(ta, 'value', {
            configurable: true,
            get() { return P.get.call(this); },
            set(v) { P.set.call(this, v); draw(); if (cur === ta) update(); },
        });
        // 挂上之前就已经点进去的格子没有 focus 事件，打字时补上
        ta.addEventListener('input', () => { draw(); if (document.activeElement === ta) { clearTimeout(hideT); cur = ta; } if (cur === ta) update(); });
        ta.addEventListener('scroll', () => { if (back) back.scrollTop = ta.scrollTop; });
        ta.addEventListener('focus', () => { clearTimeout(hideT); cur = ta; update(); });
        ta.addEventListener('blur', () => { hideT = setTimeout(() => { if (cur === ta) { cur = null; hide(); } }, 150); });
        ['click', 'keyup'].forEach((n) => ta.addEventListener(n, () => { if (cur === ta) update(); }));
        if (window.ResizeObserver && !one) new ResizeObserver(draw).observe(ta);
        ta.__peDraw = draw;
        draw();
    }

    function scan() { document.querySelectorAll(SEL).forEach(attach); }
    let st = 0;
    new MutationObserver(() => { clearTimeout(st); st = setTimeout(scan, 30); }).observe(document.body, { childList: true, subtree: true });
    TagLib.load().then(() => document.querySelectorAll('textarea[data-pe]').forEach((t) => t.__peDraw && t.__peDraw())).catch(() => {});
    const redrawAll = () => document.querySelectorAll('textarea[data-pe]').forEach((t) => t.__peDraw && t.__peDraw());
    // 面板展开收起、横竖屏变化时格子位置会变
    window.addEventListener('resize', redrawAll);
    // 设置里开关了高亮（关设置页时会调 CreatePage.refresh）
    let lastHl = null;
    const refresh = CreatePage.refresh;
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        if (opt().highlight !== lastHl) { lastHl = opt().highlight; redrawAll(); }
    };
    setTimeout(scan, 0);

    document.head.insertAdjacentHTML('beforeend', '<style>'
        + '.pe-back{position:absolute;z-index:0;box-sizing:border-box;border-style:solid;border-color:transparent;white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;color:transparent;pointer-events:none;background:var(--bg);-webkit-text-size-adjust:none;text-size-adjust:none;-webkit-user-select:none;user-select:none}'
        + 'textarea.pe-on{position:relative;z-index:1;background:transparent!important}'
        + '.pe-back span{border-radius:3px}'
        + '.pe-up{background:rgba(240,180,106,.28)}.pe-dn{background:rgba(134,174,232,.28)}.pe-neg{background:rgba(239,125,117,.32)}.pe-art{background:rgba(201,162,239,.26)}.pe-wc{background:rgba(127,207,154,.28)}'
        + '.pe-unk{text-decoration:underline dotted rgba(232,179,94,.85);text-underline-offset:3px}'
        + '.pe-strip{display:flex;gap:6px;overflow-x:auto;padding:6px 0 2px;scrollbar-width:none}.pe-strip::-webkit-scrollbar{display:none}'
        + '.pe-strip button{flex:none;border:1px solid var(--line);background:var(--bg3);border-radius:999px;padding:3px 10px;font-size:13px;color:var(--dim);white-space:nowrap}'
        + '.pe-strip button b{color:var(--text);font-weight:500}'
        + '.pe-w{flex:none;display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;overflow:hidden}'
        + '.pe-w button{border:0;border-radius:0;padding:3px 10px;font-size:15px;color:var(--text)}.pe-w em{font-style:normal;font-size:12px;color:var(--accent);min-width:30px;text-align:center}'
        + '.pe-strip .pe-i{color:var(--accent);border-color:rgba(226,166,91,.5)}'
        + '</style>');

    window.PromptEdit = { tokenAt, parseWeight, withWeight, highlight, bump, pick, attach, SEL };
})();
