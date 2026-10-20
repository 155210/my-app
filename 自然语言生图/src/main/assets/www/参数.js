/*
 * 参数.js —— 出图参数：模型表、各模型默认质量词 / 负面词、采样器、尺寸、默认设置
 *
 * 质量词、负面词与「柏宝绘」同口径（NAI 官方推荐值）。设置里留空 = 用这里的模型默认值。
 * 模型 V5 / V4.5 / V4 / V3；尺寸预设；画风模板默认值（模板逻辑见 风格.js）。
 */
(function () {
    'use strict';

    const MODELS = [
        { value: 'nai-diffusion-5-full', label: 'V5 Full（最新，无过滤）' },
        { value: 'nai-diffusion-5-curated', label: 'V5 Curated（有内容过滤）' },
        { value: 'nai-diffusion-4-5-full', label: 'V4.5 Full（无过滤）' },
        { value: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated（有内容过滤）' },
        { value: 'nai-diffusion-4-full', label: 'V4 Full（只认标签）' },
        { value: 'nai-diffusion-4-curated-preview', label: 'V4 Curated（只认标签，有过滤）' },
        { value: 'nai-diffusion-3', label: 'V3（老模型，只认标签）' },
    ];

    const QUALITY = {
        'nai-diffusion-5-full': 'very aesthetic, masterpiece, no text',
        'nai-diffusion-5-curated': 'very aesthetic, masterpiece, no text',
        'nai-diffusion-4-5-full': 'location, very aesthetic, masterpiece, no text',
        'nai-diffusion-4-5-curated': 'location, masterpiece, no text, -0.8::feet::, rating:general',
        'nai-diffusion-4-full': 'no text, best quality, very aesthetic, absurdres',
        'nai-diffusion-4-curated-preview': 'rating:general, best quality, very aesthetic, absurdres',
        'nai-diffusion-3': 'best quality, amazing quality, very aesthetic, absurdres',
    };

    const NEGATIVE = {
        'nai-diffusion-5-full':
            'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, text, watermark, signature, username, artist name, bad anatomy, bad hands, bad feet, extra digits, fewer digits, extra fingers, fused fingers, extra limbs, missing limbs, long neck, blurry, poorly drawn, unfinished, plastic skin, waxy skin, oversaturated, washed out',
        'nai-diffusion-5-curated':
            'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
        'nai-diffusion-4-5-full':
            'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
        'nai-diffusion-4-5-curated':
            'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
        'nai-diffusion-4-full':
            'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
        'nai-diffusion-4-curated-preview':
            'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
        'nai-diffusion-3':
            'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
    };

    const SAMPLERS = [
        { value: 'k_euler', label: 'Euler' },
        { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
        { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
        { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
        { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
        { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
        { value: 'ddim_v3', label: 'DDIM V3（V5 不支持）' },
    ];

    const NOISE = [
        { value: 'karras', label: 'Karras（推荐）' },
        { value: 'native', label: 'Native' },
        { value: 'exponential', label: 'Exponential' },
        { value: 'polyexponential', label: 'Polyexponential' },
    ];

    /** 尺寸预设：free = Opus 会员不扣 Anlas（≤ 1024×1024 像素、≤ 28 步、一次一张）；标签里的「标准 / 小」也是这个意思 */
    const SIZES = [
        { value: '832×1216', label: '竖 832×1216（标准）', free: true },
        { value: '1216×832', label: '横 1216×832（标准）', free: true },
        { value: '1024×1024', label: '方 1024×1024（标准）', free: true },
        { value: '1024×1536', label: '竖 1024×1536（大）' },
        { value: '1536×1024', label: '横 1536×1024（大）' },
        { value: '1472×1472', label: '方 1472×1472（大）' },
        { value: '1088×1920', label: '竖 1088×1920（壁纸）' },
        { value: '1920×1088', label: '横 1920×1088（壁纸）' },
        { value: '512×768', label: '竖 512×768（小）', free: true },
        { value: '768×512', label: '横 768×512（小）', free: true },
        { value: '640×640', label: '方 640×640（小）', free: true },
    ];

    /** 内置画风模板（来自柏宝绘的默认画师串）；可改可删，删光了就是「不用模板」 */
    const DEFAULT_STYLES = [
        {
            id: 'st_default',
            name: '柏宝绘默认画师串',
            prefix: '0.8::nnmbpx::,0.8::artist:yalmyu::,0.1::smilesmile1312,::,  artist:sh_(shinh), 0.4::chen bin::,0.4::dayama::,healthyman,bacheally,',
            suffix: '',
            negative: '',
        },
    ];

    const NAI_OFFICIAL = 'https://image.novelai.net';

    const DEFAULTS = {
        ai: { url: '', key: '', model: '', headers: '', extra: '', stream: true, temperature: 0.7 },
        nai: {
            url: NAI_OFFICIAL,
            key: '',
            model: 'nai-diffusion-5-full',
            sampler: 'k_euler',
            steps: 28,
            scale: 5.5,
            cfgRescale: 0,
            noiseSchedule: 'karras',
            seed: 0,            // 0 = 每次随机
            varietyBoost: true,
            portraitSize: '832×1216',
            landscapeSize: '1216×832',
            artist: '',         // 旧版的画师串，打开时自动搬进画风模板
            styles: DEFAULT_STYLES, // 画风模板：{ id, name, prefix 前缀, quality 绑定的质量词, uc 绑定的负面提示词, suffix 后缀, negative 额外负面 }
            styleId: 'st_default',  // 当前用的模板，'' = 不用
            quality: '',        // 留空 = 模型默认
            negative: '',       // 留空 = 模型默认
            naturalLanguage: true,
            vibes: [],          // 画风参考图：{ id, name, on, strength 强度, info 信息提取量 }；图和编码另存在 vibe:<id>（见 参考图.js）
        },
        // 留空 = 内置（规范见 写词.js，破限词、思维链见 自定义提示词.js）；heavy = 重型提示词（酒馆预设），打开时在 自定义提示词.js 里补全
        prompts: { system: '', jailbreak: '', thinking: '', useJailbreak: true, useThinking: true, retries: 1, heavy: null },
        autoDraw: true,          // 写完提示词自动出图
        tags: { hint: true, fix: true, complete: true, highlight: true }, // 标签库：给 AI 参考标签、写完纠错（见 标签库.js）；联想、高亮（提示词编辑.js）；wildcards 通配符（通配符.js）
        chars: { inject: true, autoCreate: true, autoUpdate: true }, // 角色库：外貌发给 AI、自动建档、永久变化自动更新（见 角色库.js）
    };

    /** 合并存储里的设置和默认值（新版本加的字段自动补上） */
    function normalize(s) {
        s = s || {};
        const nai = Object.assign({}, DEFAULTS.nai, s.nai);
        nai.styles = (Array.isArray(nai.styles) ? nai.styles : []).map((x) => Object.assign({ id: '', name: '', prefix: '', quality: '', uc: '', suffix: '', negative: '' }, x));
        // 旧版只有一格画师串：搬成一套模板并选中
        if (String(nai.artist || '').trim()) {
            const id = 'st_' + Date.now().toString(36);
            nai.styles = [{ id, name: '我的画师串', prefix: nai.artist.trim(), suffix: '', negative: '' }].concat(nai.styles);
            nai.styleId = id;
        }
        nai.artist = '';
        nai.vibes = (Array.isArray(nai.vibes) ? nai.vibes : []).filter((x) => x && x.id).map((x) => Object.assign({ name: '', on: true, strength: 0.6, info: 1 }, x));
        if (nai.styleId && !nai.styles.some((x) => x.id === nai.styleId)) nai.styleId = '';
        if (!MODELS.some((m) => m.value === nai.model)) nai.model = DEFAULTS.nai.model;
        return {
            ai: Object.assign({}, DEFAULTS.ai, s.ai),
            nai,
            prompts: Object.assign({}, DEFAULTS.prompts, s.prompts),
            autoDraw: s.autoDraw === undefined ? DEFAULTS.autoDraw : !!s.autoDraw,
            tags: Object.assign({}, DEFAULTS.tags, s.tags),
            chars: Object.assign({}, DEFAULTS.chars, s.chars),
        };
    }

    const isV5 = (m) => String(m).includes('nai-diffusion-5');
    const isV45 = (m) => String(m).includes('nai-diffusion-4-5');
    const isV3 = (m) => String(m) === 'nai-diffusion-3';
    /** 这个模型能用的采样器（V5 没有 DDIM） */
    const samplersFor = (m) => (isV5(m) ? SAMPLERS.filter((x) => x.value !== 'ddim_v3') : SAMPLERS);
    /** 4.5 / V5 才吃英文自然语言描述 */
    const supportsNl = (m) => isV5(m) || isV45(m);

    // 质量词 / 负面提示词的回落链（同柏宝绘的画风配方）：当前画风模板绑定的 → 「NAI 出图」页填的 → 模型默认
    const styleOf = (nai) => (nai.styleId && (nai.styles || []).find((x) => x.id === nai.styleId)) || {};
    const globalQuality = (nai) => (nai.quality || '').trim() || QUALITY[nai.model] || '';
    const globalNegative = (nai) => (nai.negative || '').trim() || NEGATIVE[nai.model] || '';
    const qualityOf = (nai) => String(styleOf(nai).quality || '').trim() || globalQuality(nai);
    const negativeOf = (nai) => String(styleOf(nai).uc || '').trim() || globalNegative(nai);

    /** 解析「832×1216 / 832x1216 / 832*1216」；宽高须为 64 的倍数、256–2048 */
    function parseSize(text) {
        const m = String(text || '').match(/(\d+)\s*[×xX*]\s*(\d+)/);
        if (!m) throw new Error('尺寸格式不对：' + (text || '（空）') + '，应该像 832×1216');
        const width = +m[1], height = +m[2];
        if (width % 64 || height % 64) throw new Error('尺寸 ' + width + '×' + height + ' 不是 64 的倍数');
        if (width < 256 || height < 256 || width > 2048 || height > 2048) throw new Error('尺寸 ' + width + '×' + height + ' 超出范围（256–2048）');
        return { width, height };
    }

    function modelLabel(v) {
        const m = MODELS.find((x) => x.value === v);
        return m ? m.label.replace(/（.*/, '') : v;
    }

    window.Params = {
        MODELS, QUALITY, NEGATIVE, SAMPLERS, NOISE, SIZES, DEFAULT_STYLES, NAI_OFFICIAL, DEFAULTS,
        normalize, isV5, isV45, isV3, samplersFor, supportsNl, qualityOf, negativeOf, globalQuality, globalNegative, parseSize, modelLabel,
    };
})();
