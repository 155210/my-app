/*
 * 主题.js —— 配色：几套现成的 + 自己挑颜色
 *
 * 存在 Store 'theme'：{ id: 预设名 | 'custom', custom: { bg, text, accent } }
 * 同时抄一份到 localStorage，下次打开第一时间就换好颜色，不闪一下默认色。
 * 换色就是改 <html> 上的 CSS 变量（样式.css 开头那一串），别的文件不用管。
 * 手机顶上状态栏的颜色是安卓那边定死的，这里改不了。
 */
(function () {
    'use strict';

    const { esc, toast } = UI;
    const LS = 'nl-theme';

    // ---------- 颜色小工具 ----------
    const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
    function rgb(h) {
        h = String(h || '').replace('#', '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        const n = parseInt(h, 16);
        return isNaN(n) ? [0, 0, 0] : [n >> 16 & 255, n >> 8 & 255, n & 255];
    }
    const toHex = (c) => '#' + c.map(hex2).join('');
    /** a 往 b 走 t（0~1） */
    const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
    const rgba = (h, a) => 'rgba(' + rgb(h).join(', ') + ', ' + a + ')';
    /** 亮度 0~1 */
    const lum = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
    const isColor = (h) => /^#[0-9a-f]{6}$/i.test(String(h || ''));

    /** 三个颜色（背景、文字、强调色）推出整套变量 */
    function derive(bg, text, accent) {
        const light = lum(bg) > 0.5;
        return {
            '--bg': bg,
            '--bg2': mix(bg, text, light ? 0.035 : 0.04),
            '--bg3': mix(bg, text, light ? 0.08 : 0.09),
            '--line': mix(bg, text, light ? 0.15 : 0.16),
            '--text': text,
            '--dim': mix(text, bg, 0.38),
            '--faint': mix(text, bg, 0.55),
            '--accent': accent,
            '--accent-ink': lum(accent) > 0.55 ? '#1e1a14' : '#ffffff',
            '--user': mix(bg, '#4a7ab8', light ? 0.14 : 0.2),
            '--danger': light ? '#c8463e' : '#e0645c',
            '--ok': light ? '#2f8f5e' : '#5fb98a',
            '--accent-soft': rgba(accent, 0.5),
            '--accent-faint': rgba(accent, 0.25),
            '--deep': mix(bg, light ? '#ffffff' : '#000000', light ? 0.6 : 0.3),
            '--pop': mix(bg, text, light ? 0.06 : 0.11),
            scheme: light ? 'light' : 'dark',
        };
    }

    // 默认那套就是样式.css 里原本的值，原样照抄
    const DEFAULT = {
        '--bg': '#15171c', '--bg2': '#1c1f26', '--bg3': '#252932', '--line': '#2f343e',
        '--text': '#e6e3dc', '--dim': '#9a978f', '--faint': '#6d6b66',
        '--accent': '#e2a65b', '--accent-ink': '#1e1a14', '--user': '#24303f',
        '--danger': '#e0645c', '--ok': '#5fb98a',
        '--accent-soft': 'rgba(226, 166, 91, .5)', '--accent-faint': 'rgba(226, 166, 91, .25)',
        '--deep': '#101216', '--pop': '#2a2e37', scheme: 'dark',
    };
    const PRESETS = [
        { id: 'dark', name: '暗夜琥珀（默认）', base: ['#15171c', '#e6e3dc', '#e2a65b'], vars: DEFAULT },
        { id: 'ocean', name: '深海蓝', base: ['#10161f', '#e1e8f0', '#5aa9e6'] },
        { id: 'sakura', name: '樱花粉', base: ['#1c1519', '#f0e3e9', '#f08cb4'] },
        { id: 'forest', name: '森林绿', base: ['#121812', '#e2eadf', '#7cc47f'] },
        { id: 'violet', name: '暮光紫', base: ['#16141f', '#e7e3f2', '#a98bf0'] },
        { id: 'black', name: '纯黑省电', base: ['#000000', '#e8e8e8', '#e2a65b'] },
        { id: 'paper', name: '浅色纸张', base: ['#f6f4ef', '#2a2722', '#b8711f'] },
        { id: 'sky', name: '浅色天空', base: ['#f3f6fa', '#1f2a36', '#2f7fd1'] },
    ];
    for (const p of PRESETS) if (!p.vars) p.vars = derive(...p.base);

    let state = { id: 'dark', custom: null };

    function varsOf(st) {
        if (st.id === 'custom' && st.custom && isColor(st.custom.bg) && isColor(st.custom.text) && isColor(st.custom.accent)) {
            return derive(st.custom.bg, st.custom.text, st.custom.accent);
        }
        return (PRESETS.find((p) => p.id === st.id) || PRESETS[0]).vars;
    }

    function apply(st) {
        const v = varsOf(st), root = document.documentElement;
        for (const k in v) if (k.startsWith('--')) root.style.setProperty(k, v[k]);
        root.style.colorScheme = v.scheme;
        root.dataset.theme = v.scheme;
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.content = v.scheme;
    }

    async function save(st) {
        state = st;
        apply(st);
        try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* 存不了就算了，Store 里还有 */ }
        await Store.set('theme', st);
    }

    /** 当前颜色（自定义打开时用来当起点） */
    function current() {
        if (state.id === 'custom' && state.custom) return Object.assign({}, state.custom);
        const p = PRESETS.find((x) => x.id === state.id) || PRESETS[0];
        return { bg: p.base[0], text: p.base[1], accent: p.base[2] };
    }

    // 别的文件里写死的颜色：浅色主题下换深一点，强调色跟着主题走（写在这里，免得改那些文件）
    document.head.insertAdjacentHTML('beforeend', '<style>'
        + 'textarea.pe-on::selection{background:var(--accent-faint)}.pe-strip .pe-i{border-color:var(--accent-soft)}'
        + ':root[data-theme=light] .pe-up{color:#a8620f}:root[data-theme=light] .pe-dn{color:#2f63b0}:root[data-theme=light] .pe-neg{color:#c0392b}'
        + ':root[data-theme=light] .pe-art{color:#7d4fc4}:root[data-theme=light] .pe-wc{color:#25834a}:root[data-theme=light] .warn{color:#a8620f}'
        + ':root[data-theme=light] .layer .mask{background:rgba(0,0,0,.35)}'
        + '</style>');

    // ---------- 一打开先用 localStorage 里那份，再用 Store 里的校正（导入备份后以 Store 为准） ----------
    try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && s.id) { state = s; apply(s); } } catch (e) { /* 没有就用默认 */ }
    const ready = Store.get('theme', null).then((s) => {
        if (s && s.id && JSON.stringify(s) !== JSON.stringify(state)) { state = s; apply(s); try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { /* 同上 */ } }
    }).catch(() => {});

    // ---------- 设置页「主题」 ----------
    const swatch = (v) => '<span class="sw"><i style="background:' + v['--bg'] + '"></i><i style="background:' + v['--bg3'] + '"></i>'
        + '<i style="background:' + v['--text'] + '"></i><i style="background:' + v['--accent'] + '"></i></span>';
    const COLORS = [['bg', '背景'], ['text', '文字'], ['accent', '强调色（按钮、选中）']];

    function html() {
        const c = current();
        const custom = state.id === 'custom';
        return '<div class="card"><div class="card-title">配色</div><div class="card-sub">点一下就换，立刻生效。不花 Anlas。</div>'
            + '<div class="theme-list">'
            + PRESETS.map((p) => '<button class="theme-card' + (p.id === state.id ? ' on' : '') + '" data-act="theme-pick" data-theme="' + p.id + '">'
                + swatch(p.vars) + '<b>' + esc(p.name) + '</b></button>').join('')
            + '<button class="theme-card' + (custom ? ' on' : '') + '" data-act="theme-pick" data-theme="custom">' + swatch(derive(c.bg, c.text, c.accent)) + '<b>自定义</b></button>'
            + '</div></div>'
            + '<div class="card"><div class="card-title">自己挑颜色</div>'
            + '<div class="card-sub">从当前配色开始改，改哪个都会切到「自定义」。其余深浅色会跟着背景和文字自动配好。</div>'
            + COLORS.map(([k, label]) => '<div class="color-row"><label for="theme-' + k + '">' + esc(label) + '</label>'
                + '<input type="color" id="theme-' + k + '" data-color="' + k + '" value="' + esc(c[k]) + '"></div>').join('')
            + (lum(c.bg) > 0.5 === lum(c.text) > 0.5 ? '<div class="warn">背景和文字一样深 / 一样浅，字会看不清</div>' : '')
            + '<div class="btns"><button class="btn" data-act="theme-reset">恢复默认配色</button></div></div>';
    }

    SettingsPage.addTab({
        id: 'theme',
        label: '主题',
        after: 'nai',
        html,
        acts: {
            'theme-pick': async (btn, redraw) => {
                const id = btn.dataset.theme;
                await save(id === 'custom' ? { id, custom: state.custom || current() } : { id, custom: state.custom });
                redraw();
            },
            'theme-reset': async (btn, redraw) => { await save({ id: 'dark', custom: state.custom }); redraw(); toast('success', '已恢复默认配色'); },
        },
    });
    // 取色器不是 data-k（不在 settings 里），自己监听；拖动时只换色，松手再存
    let redrawTimer = 0;
    function onColor(e, done) {
        const el = e.target;
        if (!el || !el.dataset || !el.dataset.color || !isColor(el.value)) return;
        const custom = Object.assign(current(), { [el.dataset.color]: el.value.toLowerCase() });
        const st = { id: 'custom', custom };
        if (!done) { state = st; apply(st); return; }
        save(st).catch(() => {});
        // 重画一遍让「自定义」卡片高亮、色块更新（隔一会，免得把正在用的取色器关掉）
        clearTimeout(redrawTimer);
        redrawTimer = setTimeout(() => {
            const card = document.querySelector('.theme-card[data-theme="custom"]');
            if (!card) return;
            document.querySelectorAll('.theme-card').forEach((b) => b.classList.toggle('on', b === card));
            card.querySelector('.sw').outerHTML = swatch(derive(custom.bg, custom.text, custom.accent));
        }, 50);
    }
    document.addEventListener('input', (e) => onColor(e, false));
    document.addEventListener('change', (e) => onColor(e, true));

    window.Theme = { PRESETS, derive, apply, save, current, ready, get: () => state };
})();
