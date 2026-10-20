/*
 * 参数.js —— 出图参数：模型表、各模型默认质量词 / 负面词、采样器、尺寸、默认设置
 *
 * 质量词、负面词与「柏宝绘」同口径（NAI 官方推荐值）。设置里留空 = 用这里的模型默认值。
 * 以后加 V4 / V3、尺寸预设、多张出图等，都改这个文件。
 */
(function () {
    'use strict';

    const MODELS = [
        { value: 'nai-diffusion-5-full', label: 'V5 Full（最新，无过滤）' },
        { value: 'nai-diffusion-5-curated', label: 'V5 Curated（有内容过滤）' },
        { value: 'nai-diffusion-4-5-full', label: 'V4.5 Full（无过滤）' },
        { value: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated（有内容过滤）' },
    ];

    const QUALITY = {
        'nai-diffusion-5-full': 'very aesthetic, masterpiece, no text',
        'nai-diffusion-5-curated': 'very aesthetic, masterpiece, no text',
        'nai-diffusion-4-5-full': 'location, very aesthetic, masterpiece, no text',
        'nai-diffusion-4-5-curated': 'location, masterpiece, no text, -0.8::feet::, rating:general',
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
    };

    const SAMPLERS = [
        { value: 'k_euler', label: 'Euler' },
        { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
        { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
        { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
        { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
        { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
    ];

    const NOISE = [
        { value: 'karras', label: 'Karras（推荐）' },
        { value: 'native', label: 'Native' },
        { value: 'exponential', label: 'Exponential' },
        { value: 'polyexponential', label: 'Polyexponential' },
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
            artist: '',         // 画师串：拼在正面提示词最前
            quality: '',        // 留空 = 模型默认
            negative: '',       // 留空 = 模型默认
            naturalLanguage: true,
        },
        prompts: { system: '' }, // 留空 = 内置规范（见 写词.js）
        autoDraw: true,          // 写完提示词自动出图
    };

    /** 合并存储里的设置和默认值（新版本加的字段自动补上） */
    function normalize(s) {
        s = s || {};
        return {
            ai: Object.assign({}, DEFAULTS.ai, s.ai),
            nai: Object.assign({}, DEFAULTS.nai, s.nai),
            prompts: Object.assign({}, DEFAULTS.prompts, s.prompts),
            autoDraw: s.autoDraw === undefined ? DEFAULTS.autoDraw : !!s.autoDraw,
        };
    }

    const isV5 = (m) => String(m).includes('nai-diffusion-5');
    const isV45 = (m) => String(m).includes('nai-diffusion-4-5');
    /** 4.5 / V5 才吃英文自然语言描述 */
    const supportsNl = (m) => isV5(m) || isV45(m);

    const qualityOf = (nai) => (nai.quality || '').trim() || QUALITY[nai.model] || '';
    const negativeOf = (nai) => (nai.negative || '').trim() || NEGATIVE[nai.model] || '';

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
        MODELS, QUALITY, NEGATIVE, SAMPLERS, NOISE, NAI_OFFICIAL, DEFAULTS,
        normalize, isV5, isV45, supportsNl, qualityOf, negativeOf, parseSize, modelLabel,
    };
})();
