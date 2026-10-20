/*
 * 出图.js —— 调 NovelAI 出图（协议与官方 image.novelai.net 一致，第三方兼容站也能填）
 *
 * 请求格式照「柏宝绘」的 backends/nai.ts：
 *   POST {地址}/ai/generate-image，body { input, model, action:'generate', parameters }
 *   返回 zip，取第一张图。
 * 正面 = 画风前缀, 画面 tag, 画风后缀, 质量词（4.5/V5 开了自然语言再接 ". 英文描述"）
 * 负面 = 设置里的负面词（留空用模型默认）, 画风负面, AI 补的负面词
 * V3 不认 v4_prompt 那套结构，只读 input。
 */
(function () {
    'use strict';

    function endpoint(url, path) {
        const base = String(url || '').trim().replace(/\/+$/, '');
        if (!base) throw new Error('请先在设置里填 NAI 地址');
        const seg = path.replace(/^\/+/, '');
        if (base.endsWith('/ai/' + seg) || base.endsWith('/' + seg)) return base;
        return base + '/ai/' + seg;
    }

    /** 当前选中的画风模板，没选 → null */
    const activeStyle = (nai) => (nai.styleId && (nai.styles || []).find((x) => x.id === nai.styleId)) || null;

    const joinTags = (...parts) => parts.map((s) => String(s || '').trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');

    /**
     * 拼出实际发送的正负面全文
     * p: { tag, nl, negative }  —— 创作页里可编辑的那几格
     */
    function fullPrompts(nai, p) {
        const st = activeStyle(nai) || {};
        const tag = tagFilters.reduce((t, fn) => fn(t, nai, p) || t, p.tag || '');
        // V5 透明背景：官网把 transparent background 放在质量词前面；Furry 模式：最前面加 fur dataset（V3 没有）
        const clear = nai.transparent && Params.isV5(nai.model) && !/transparent background/i.test(tag) ? 'transparent background' : '';
        const fur = nai.furry && !Params.isV3(nai.model) && !/^\s*fur dataset\b/i.test(st.prefix || tag) ? 'fur dataset' : '';
        let positive = joinTags(fur, st.prefix, tag, st.suffix, clear, Params.qualityOf(nai));
        const nl = String(p.nl || '').trim();
        if (nai.naturalLanguage && Params.supportsNl(nai.model) && nl) positive += '. ' + nl;
        const negative = joinTags(Params.negativeOf(nai), st.negative, p.negative);
        return { positive, negative };
    }

    // 扩展口：出图前改画面标签，Nai.addTagFilter(fn)，fn(标签串, nai, p) 返回新的（角色库把角色名换成外貌）
    const tagFilters = [];
    const addTagFilter = (fn) => tagFilters.push(fn);

    // 扩展口：多角色、Vibe 等功能各自在自己的文件里 Nai.addHook(fn)，
    // fn(params, nai, p, extra) 直接改 parameters，不用改这个文件；往 extra 里放的东西会记进这张图的配方（meta）
    const hooks = [];
    const addHook = (fn) => hooks.push(fn);
    // 扩展口：改 parameters 以外的部分（action、model、input），Nai.addBodyHook(fn)，fn(body, nai, p)。图生图 / 局部重绘用它
    const bodyHooks = [];
    const addBodyHook = (fn) => bodyHooks.push(fn);

    function randomSeed() { return Math.floor(Math.random() * 2 ** 32); }

    /** 构造请求 body（纯函数，可测） */
    function buildBody(nai, p) {
        const orientation = p.size === 'landscape' ? 'landscape' : 'portrait';
        const { width, height } = Params.parseSize(orientation === 'landscape' ? nai.landscapeSize : nai.portraitSize);
        const seed = p.seed != null ? p.seed : (Number(nai.seed) > 0 ? Number(nai.seed) : randomSeed());
        const { positive, negative } = fullPrompts(nai, p);
        const v5 = Params.isV5(nai.model);
        // variety boost：按像素量算 skip_cfg_above_sigma（V5 不用）
        const skipCfg = nai.varietyBoost && !v5
            ? Math.pow((width * height) / 1011712, 0.5) * (Params.isV45(nai.model) ? 58 : 19)
            : null;
        let sampler = nai.sampler || 'k_euler';
        if (!Params.samplersFor(nai.model).some((x) => x.value === sampler)) sampler = 'k_euler_ancestral';
        const params = {
            params_version: v5 ? 4 : 3,
            width, height,
            scale: Number(nai.scale),
            sampler,
            steps: Number(nai.steps),
            n_samples: 1,
            ucPreset: 3,
            qualityToggle: true,
            dynamic_thresholding: false,
            controlnet_strength: 1,
            legacy: false,
            legacy_uc: false,
            add_original_image: true,
            cfg_rescale: Number(nai.cfgRescale) || 0,
            noise_schedule: nai.noiseSchedule || 'karras',
            skip_cfg_above_sigma: skipCfg,
            legacy_v3_extend: false,
            stream: 'msgpack',
            seed,
            negative_prompt: negative,
            reference_strength_multiple: [],
            normalize_reference_strength_multiple: true,
            use_coords: false,
        };
        if (Params.isV3(nai.model)) {
            Object.assign(params, { sm: false, sm_dyn: false, reference_image_multiple: [], reference_information_extracted_multiple: [] });
        } else {
            Object.assign(params, {
                reference_image_multiple_cached: [],
                characterPrompts: [],
                v4_prompt: { caption: { base_caption: positive, char_captions: [] }, use_coords: false, use_order: true },
                v4_negative_prompt: { caption: { base_caption: negative, char_captions: [] }, legacy_uc: false },
            });
        }
        if (nai.transparent && v5) Object.assign(params, { tag_hint_transparent_background: true, straight_alpha: true });
        const extra = {};
        hooks.forEach((h) => h(params, nai, p, extra));
        if (sampler === 'k_euler_ancestral') {
            params.deliberate_euler_ancestral_bug = false;
            params.prefer_brownian = true;
        }
        const body = { input: positive, model: nai.model, action: 'generate', parameters: params, use_new_shared_trial: true };
        bodyHooks.forEach((h) => h(body, nai, p));
        return {
            body,
            meta: Object.assign({ positive, negative, width, height, seed, model: nai.model, sampler, steps: params.steps, scale: params.scale, size: orientation, style: (activeStyle(nai) || {}).name || '', transparent: !!(nai.transparent && v5), furry: !!(nai.furry && !Params.isV3(nai.model)) }, extra),
        };
    }

    // ------------------------------------------------------------
    // 解 zip：只认 store(0) 和 deflate(8)，按中央目录取第一张图
    // ------------------------------------------------------------
    async function inflateRaw(bytes) {
        const ds = new DecompressionStream('deflate-raw');
        const out = new Blob([bytes]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(out).arrayBuffer());
    }

    async function unzipFirstImage(buf) {
        const u8 = new Uint8Array(buf);
        const dv = new DataView(buf);
        // 本身就是图片（有的第三方站直接回 PNG/JPEG）
        if (u8[0] === 0x89 && u8[1] === 0x50) return { bytes: u8, ext: 'png' };
        if (u8[0] === 0xff && u8[1] === 0xd8) return { bytes: u8, ext: 'jpg' };
        if (!(u8[0] === 0x50 && u8[1] === 0x4b)) throw new Error('返回的不是图片也不是 zip，可能是地址填错了');
        let eocd = -1;
        for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('zip 包损坏');
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const entries = [];
        for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
            const method = dv.getUint16(p + 10, true);
            const csize = dv.getUint32(p + 20, true);
            const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
            const local = dv.getUint32(p + 42, true);
            const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
            entries.push({ name, method, csize, local });
            p += 46 + nameLen + extraLen + commentLen;
        }
        const e = entries.find((x) => /\.(png|jpe?g|webp)$/i.test(x.name)) || entries[0];
        if (!e) throw new Error('zip 包里没有图片');
        const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
        const raw = u8.subarray(start, start + e.csize);
        const bytes = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
        if (!bytes) throw new Error('不支持的 zip 压缩方式：' + e.method);
        const ext = (e.name.split('.').pop() || 'png').toLowerCase();
        return { bytes, ext: ext === 'jpeg' ? 'jpg' : ext };
    }

    async function httpError(r, label) {
        const t = (await r.text().catch(() => '')).trim();
        let detail = t;
        try { const j = JSON.parse(t); if (typeof j.message === 'string') detail = j.message; } catch (e) { /* 原文 */ }
        switch (r.status) {
            case 401: return new Error(label + '：NAI 的 Key 不对或已失效');
            case 402: return new Error(label + '：需要有效的 NAI 订阅（402）');
            case 429: return new Error(label + '：请求太频繁（429），稍等一会再试');
            default: return new Error(label + '（' + r.status + '）：' + detail.slice(0, 300));
        }
    }

    /**
     * 出一张图
     * 返回 { blob, ext, meta }
     */
    async function generate(nai, p, signal) {
        if (!String(nai.key || '').trim()) throw new Error('请先在设置里填 NAI 的 Key');
        if (!String(p.tag || '').trim()) throw new Error('正面提示词是空的');
        const { body, meta } = buildBody(nai, p);
        const r = await fetch(endpoint(nai.url, 'generate-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + nai.key.trim() },
            body: JSON.stringify(body),
            signal,
        });
        if (!r.ok) throw await httpError(r, '出图失败');
        const { bytes, ext } = await unzipFirstImage(await r.arrayBuffer());
        state.lastSeed = meta.seed;
        // 出完一张：Anlas 余额等跟着刷新
        window.dispatchEvent(new CustomEvent('nai-drawn', { detail: meta }));
        const type = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
        return { blob: new Blob([bytes], { type }), ext, meta };
    }

    /** 查订阅：返回 { tier, active, anlas, usage }；站点没有这个接口 → null */
    async function subscription(nai) {
        if (!String(nai.key || '').trim()) throw new Error('请先填 Key');
        const base = String(nai.url || '').trim().replace(/\/+$/, '');
        const official = /\/\/image\.novelai\.net$/i.test(base);
        // 官方 2026-08 起把订阅接口挪到了出图域名，老的 api.novelai.net 会回 400「update to the image URL」，留作后备
        const urls = official
            ? ['https://image.novelai.net/user/subscription', 'https://api.novelai.net/user/subscription']
            : [base + '/user/subscription', endpoint(base, 'user/subscription')];
        let r = null, err = null, missing = 0;
        for (const url of urls) {
            try {
                r = await fetch(url, { headers: { Authorization: 'Bearer ' + nai.key.trim() } });
            } catch (e) {
                err = err || e;
                r = null;
                continue;
            }
            if (r.ok) break;
            if (r.status === 404) missing++;
            else if (!err || r.status === 401) err = await httpError(r, '连接失败');
            r = null;
        }
        if (!r) {
            if (err) throw err;
            if (missing) return null;
        }
        const d = await r.json().catch(() => ({}));
        const tier = ['免费', 'Tablet', 'Scroll', 'Opus'][Number(d.tier)] || ('等级 ' + d.tier);
        const steps = d.trainingStepsLeft;
        const anlas = typeof steps === 'number' ? steps
            : (Number(steps && steps.fixedTrainingStepsLeft) || 0) + (Number(steps && steps.purchasedTrainingSteps) || 0);
        return { tier, active: d.active !== false, anlas, usage: opusUsage(d.usage) };
    }

    /**
     * Opus 的 V5 免费额度（官网「Opusの利用上限」那条）：只有官方出图域名、Opus 订阅才有
     * usage: { percent 剩余 0–100, isNegative 已透支（V5 每张都扣 Anlas）, timeUntilNextPercent 每回 1% 要几秒 }
     * 张数按官网口径：1% ≈ 17.3 张
     */
    function opusUsage(u) {
        if (!u || typeof u.percent !== 'number') return null;
        const left = u.isNegative ? 0 : Math.max(0, Math.min(100, u.percent));
        const secs = Number(u.timeUntilNextPercent) || 0;
        const perDay = secs > 0 ? Math.round(86400 / secs * 10) / 10 : 0;
        return {
            percent: Math.round(left), empty: !!u.isNegative || left <= 0,
            imagesLeft: Math.round(17.3 * left), perDay, imagesPerDay: Math.round(17.3 * perDay),
        };
    }

    /** 额度的中文说明，提示和设置页共用 */
    function usageText(u) {
        if (!u) return '';
        const refill = u.perDay ? '，每天回 ' + u.perDay + '%（约 ' + u.imagesPerDay + ' 张）' : '';
        return u.empty ? 'Opus 免费额度用完了，现在每张 V5 都扣 Anlas' + refill
            : 'Opus 免费额度剩 ' + u.percent + '%（约 ' + u.imagesLeft + ' 张）' + refill;
    }

    /** 测试连接：官方站查订阅和 Anlas 余额；第三方站没有这个接口就只验证能连上 */
    async function test(nai) {
        const d = await subscription(nai);
        if (!d) return '能连上，但这个站没有订阅接口；以实际出图为准';
        window.dispatchEvent(new CustomEvent('nai-anlas', { detail: d }));
        return '连接正常：' + d.tier + (d.active ? '' : '（订阅未激活）') + '，Anlas 余额 ' + d.anlas + (d.usage ? '\n' + usageText(d.usage) : '');
    }

    // lastSeed：最近出的一张的种子（锁定种子用）
    const state = { lastSeed: 0 };

    window.Nai = { generate, test, subscription, usageText, buildBody, fullPrompts, activeStyle, unzipFirstImage, endpoint, addHook, addBodyHook, addTagFilter, state };
})();
