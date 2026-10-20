/*
 * 计价.js —— Anlas 花费预估（照官网网页端的算法，社区逆向，和 novelai-python 的 _cost.py 同口径）
 *
 * 一张图：ceil(2.951823174884865e-6 × 像素 + 5.753298233447344e-7 × 像素 × 步数)，V5 再 ×1.5，
 *   有底图（图生图 / 局部重绘）× 强度，每张最少 2，单张超过 140 官网直接拒绝。
 *   实测对得上：V5 832×1216 23 步 = 26，1024×1536 28 步 = 45。
 * Opus 免费：≤ 1024×1024 像素、≤ 28 步、订阅有效，一次请求里免一张；V5 要 Opus 额度没透支。
 *   有底图也照样免（官网文档写「没有底图」，按网页端代码以计算为准）。
 * 角色参考每个每张 +5；参考图超过 4 张，每多一张每张 +2；新编码参考图每次 2（参考图.js / 角色参考.js 用 addExtra 注册）。
 * 4 倍放大：只收 ≤ 1024×1024 的图，按像素 1~4。
 * 图像工具：图先缩放到 1~3 百万像素之间，按 V3 28 步算；去背景 = 3 × 价 + 5，Opus 也不免。
 *
 * 用法：
 *   Cost.estimate(nai, p, 张数) → { total, perImage, once, free, parts:[{label, anlas}], text, over, count, quota 约用掉的 V5 Opus 额度% }
 *   Cost.image({ width, height, steps, model, strength }, { opus, usageEmpty }) → 一张的数字
 *   Cost.enhance / Cost.upscale / Cost.tool → 数字；Cost.label(数字) → 「免费」「约 20 Anlas」
 *   Cost.tag(按钮, 数字或 estimate 的结果, 前缀) → 在按钮里挂个小标记
 *   Cost.addExtra(fn)：fn(nai, p) 返回 null 或 { perImage, once, label }；Cost.refresh() 让出图按钮的数字重算
 */
(function () {
    'use strict';

    const ANLAS_MAX = 140;
    const OPUS_FREE_PIXELS = 1048576;
    const OPUS_FREE_STEPS = 28;
    const TOOL_MAX_PIXELS = 3145728;
    const UPSCALE_PRICES = [[1048576, 1], [1747627, 2], [2446678, 3], [3145728, 4]];
    const TOOLS = { 'bg-removal': '去背景', lineart: '线稿', sketch: '草图', colorize: '上色', emotion: '换表情', declutter: '去杂物' };

    // 账号：最近一次查订阅的结果（Nai.subscription 包一层记下来）；查不到 = 按非 Opus 算
    let account = null;
    function remember(d) { account = d || null; refresh(); }
    const sub = Nai.subscription;
    Nai.subscription = async function () {
        const d = await sub.apply(this, arguments);
        remember(d);
        return d;
    };
    window.addEventListener('nai-anlas', (e) => remember(e.detail));

    /** { known 查到过订阅, opus, active, usageEmpty Opus 额度透支（V5 才看）} */
    function acct() {
        if (!account) return { known: false, opus: false, active: false, usageEmpty: false };
        return { known: true, opus: account.tier === 'Opus', active: account.active !== false, usageEmpty: !!(account.usage && account.usage.empty) };
    }

    /** 不算免费的一张；超过 140 返回 -1 */
    function raw(o) {
        const px = o.width * o.height, steps = Number(o.steps) || 28;
        let c = Math.ceil(2.951823174884865e-6 * px + 5.753298233447344e-7 * px * steps);
        if (Params.isV5(o.model)) c *= 1.5;
        const strength = o.strength != null && o.strength !== '' ? Math.max(0, Math.min(1, Number(o.strength))) : 1;
        const n = Math.max(Math.ceil(c * strength), 2);
        return n > ANLAS_MAX ? -1 : n;
    }

    /** 这张能不能走 Opus 免费 */
    function opusFree(o, a) {
        a = a || acct();
        const px = o.width * o.height;
        if (!(a.opus && a.active) || px > OPUS_FREE_PIXELS || (Number(o.steps) || 28) > OPUS_FREE_STEPS) return false;
        return !(Params.isV5(o.model) && a.usageEmpty);
    }

    /** 一次请求（n 张一起发）的花费；o: { width, height, steps, model, strength, n } */
    function image(o, a) {
        const one = raw(o);
        if (one < 0) return -1;
        const n = Math.max(1, Number(o.n) || 1);
        return one * (n - (opusFree(o, a) ? 1 : 0));
    }

    /** 精修：按放大后的尺寸做一次图生图；scale 默认 1.5，宽高对齐到 64 */
    function enhance(o, a) {
        const s = Number(o.scale) || 1.5, r64 = (v) => Math.max(64, Math.round(v * s / 64) * 64);
        return image(Object.assign({}, o, { width: r64(o.width), height: r64(o.height), strength: o.strength != null ? o.strength : 0.5 }), a);
    }

    /** NAI 官方 4 倍放大：只收 ≤ 1024×1024 的图；太大返回 -1 */
    function upscale(width, height) {
        const px = width * height;
        if (px > OPUS_FREE_PIXELS) return -1;
        const hit = UPSCALE_PRICES.find((x) => px <= x[0]);
        return hit ? hit[1] : -1;
    }

    /** 图像工具（去背景、线稿、草图、上色、换表情、去杂物） */
    function tool(name, width, height, a) {
        let px = width * height;
        const k = px > TOOL_MAX_PIXELS ? Math.sqrt(TOOL_MAX_PIXELS / px) : px < OPUS_FREE_PIXELS ? Math.sqrt(OPUS_FREE_PIXELS / px) : 1;
        const w = Math.floor(width * k), h = Math.floor(height * k);
        const bg = name === 'bg-removal';
        const o = { width: w, height: h, steps: 28, model: 'nai-diffusion-3' };
        const price = raw(o);
        if (price < 0) return -1;
        if (bg) return 3 * price + 5;
        return opusFree(o, a) ? 0 : price;
    }

    // 扩展口：参考图、角色参考等各自注册额外花费
    const extras = [];
    const addExtra = (fn) => extras.push(fn);

    /** 创作页这一套出 count 张（每张单独一个请求）大概多少 */
    function estimate(nai, p, count) {
        p = p || {};
        count = Math.max(1, Number(count) || 1);
        const a = acct();
        let width, height;
        try {
            ({ width, height } = Params.parseSize(p.size === 'landscape' ? nai.landscapeSize : nai.portraitSize));
        } catch (e) { return { total: 0, perImage: 0, once: 0, free: false, parts: [], text: '尺寸不对', over: false, error: e.message }; }
        if (p.width && p.height) { width = p.width; height = p.height; }
        const o = { width, height, steps: nai.steps, model: nai.model, strength: p.img2img || p.image ? (p.strength != null ? p.strength : 0.7) : null };
        const per = image(o, a);
        const over = per < 0;
        const free = !over && per === 0;
        const parts = [];
        if (!over) parts.push({ label: free ? (Params.isV5(nai.model) ? '出图（Opus 额度内免费）' : '出图（Opus 免费）') : '出图', anlas: per * count });
        let perImage = over ? 0 : per, once = 0;
        for (const fn of extras) {
            let x = null;
            try { x = fn(nai, p); } catch (e) { x = null; }
            if (!x) continue;
            const pi = Number(x.perImage) || 0, on = Number(x.once) || 0;
            if (!pi && !on) continue;
            perImage += pi;
            once += on;
            parts.push({ label: x.label || '其他', anlas: pi * count + on });
        }
        const total = perImage * count + once;
        let text = over ? '单张超过 140 Anlas，官网会拒绝' : label(total);
        // 每张都是单独一个请求（n_samples = 1），所以 Opus 下几张都免费；V5 每张约用掉 1/17.3% 的 Opus 额度
        let quota = 0;
        if (free) {
            if (count > 1) text = '免费 ×' + count + '（每张单独发，Opus 张张免费）';
            if (Params.isV5(nai.model)) {
                quota = Math.round(count / 17.3 * 10) / 10;
                text += '，约用掉 Opus 额度 ' + (quota < 0.1 ? '不到 0.1' : quota) + '%';
                const left = account && account.usage ? account.usage.percent : null;
                if (left != null && quota > left) text += '；额度只剩 ' + left + '%，超出的那几张会扣 Anlas';
            }
        }
        if (!a.known && !over) text += '（按非 Opus 算）';
        return { total, perImage, once, free: total === 0 && !over, parts, text, over, opus: a.opus, known: a.known, count, quota };
    }

    /** 「免费」「约 20 Anlas」 */
    function label(n) {
        if (typeof n === 'object' && n) return n.text;
        if (n < 0) return '超出范围';
        return n === 0 ? '免费' : '约 ' + n + ' Anlas';
    }

    /** 在按钮里挂一个小标记（再调一次就更新）；n 是数字或 estimate 的结果，null 去掉；prefix 加在数字前面（如「每张」） */
    function tag(btn, n, prefix) {
        if (!btn) return;
        let s = btn.querySelector('.cost-tag');
        if (n == null) { if (s) s.remove(); return; }
        if (!s) { s = document.createElement('span'); s.className = 'cost-tag'; btn.appendChild(s); }
        const total = typeof n === 'object' ? n.total : n;
        const over = typeof n === 'object' ? n.over : n < 0;
        const many = typeof n === 'object' && n.count > 1 ? ' ×' + n.count : '';
        const text = over ? '超限' : total === 0 ? '免费' + many : (prefix ? prefix + ' ' : '') + total + ' Anlas';
        if (s.textContent !== text) s.textContent = text; // 没变就不动 DOM，免得观察 DOM 的地方来回触发
        s.classList.toggle('free', !over && total === 0);
        btn.title = typeof n === 'object'
            ? n.text + (n.parts.length > 1 ? '\n' + n.parts.map((x) => x.label + ' ' + x.anlas).join('\n') : '')
            : label(n);
    }

    // 出图按钮等的刷新：谁需要就 Cost.onRefresh(fn)，设置/账号变了调 Cost.refresh()
    const listeners = [];
    const onRefresh = (fn) => listeners.push(fn);
    function refresh() { listeners.forEach((fn) => { try { fn(); } catch (e) { /* 页面还没好 */ } }); }

    const css = document.createElement('style');
    css.textContent = '.cost-tag{display:inline-block;margin-left:6px;font-size:11px;font-weight:400;padding:0 5px;border-radius:6px;background:rgba(0,0,0,.18);vertical-align:1px}'
        + '.cost-tag.free{background:rgba(120,200,120,.25)}';
    document.head.appendChild(css);

    window.Cost = { estimate, image, raw, enhance, upscale, tool, label, tag, addExtra, refresh, onRefresh, account: acct, TOOLS, ANLAS_MAX };
})();
