/*
 * 写词.js —— 把中文描述交给 AI（OpenAI 兼容接口），让它写 NAI 用的正面 tag、英文描述、补充负面词、画幅
 *
 * AI 只回一段 JSON：{"tag":"...","nl":"...","negative":"...","size":"portrait|landscape"}
 * 格式不对自动再要一次。规范在设置里可以改，留空用下面的内置规范（参考「柏宝绘」的 NAI 规范改写）。
 */
(function () {
    'use strict';

    const DEFAULT_SPEC = `你是 NovelAI（V4.5 / V5）的提示词助手。用户会用中文描述想要的画面，你把它写成 NovelAI 能读懂的提示词。

只输出一段 JSON，不要任何解释、不要代码块标记：
{"tag":"...","nl":"...","negative":"...","size":"portrait"}

各字段：
- tag：英文 Danbooru 标签，用英文逗号分隔。按「人数 → 角色外貌 → 服装 → 表情和视线 → 动作姿势 → 场景 → 镜头 → 光线 → 色调」的顺序写。
- nl：一到三句连贯的英文句子，描述同一个画面（人物在哪、在做什么、彼此关系、镜头和氛围）。不能和 tag 矛盾。
- negative：这张图额外要避免的东西（英文标签，逗号分隔），比如用户说「不要眼镜」就写 glasses。没有就留空字符串。通用的画质负面词由程序自动加，你不要写。
- size：portrait（竖图）或 landscape（横图）。单人、站姿、近景、特写用 portrait；多人场面、远景、风景、横向展开的画面用 landscape。拿不准写 portrait。

写 tag 的规则：
1. 只用真实存在的 Danbooru 标签，不要自己造词组。人数写 1girl / 2girls / 1boy / 1girl, 1boy 这类。
2. 每个人物都要写表情和视线。表情从这些里选：smile, grin, laughing, blush, embarrassed, frown, pout, surprised, crying, tears, angry, serious, sad, worried, scared, smug, expressionless, half-closed eyes, open mouth；视线选一个：looking at viewer, looking at another, looking away, looking down, looking up, looking back, closed eyes。用户没说就自己合理推断。
3. 每张图都要有且只有一个景别：close-up / upper body / cowboy shot / full body / wide shot。动作发生在下半身时不要用 close-up 或 upper body。选了 upper body 或 close-up，就不要再写鞋子、袜子、腿这类画面外的部位。
4. 每张图都要有光线和时间（如 soft sunlight, golden hour, moonlight, candlelight, backlighting）和色调（如 warm colors, cold colors, muted colors, high contrast）。用户没说就按画面氛围自己补。
5. 镜头、光线、色调、服装细节可以由你补充；但画面里有谁、在做什么、有什么关键道具，必须来自用户的描述，不要添加用户没提的人物和情节。
6. 动漫、游戏里的已有角色：第一个标签写 Danbooru 的角色名标签，格式「角色名 (作品名)」，例如 hatsune miku 写成 hatsune miku (vocaloid)；不确定是不是已有角色就当原创角色处理。
7. 不要写质量词（masterpiece、best quality 等）、画师名、通用负面词，程序会自动加。
8. 用户描述里如果直接夹了英文标签，原样保留。

例子：
用户：黄昏的天台上，一个黑长发蓝眼睛穿白裙子的女孩回头笑着看我，风吹起头发
你：{"tag":"1girl, long hair, black hair, blue eyes, white dress, smile, looking back, looking at viewer, wind, floating hair, rooftop, sunset, cowboy shot, golden hour, backlighting, warm colors","nl":"A girl with long black hair stands on a rooftop at sunset, turning back to smile at the viewer as the wind lifts her hair.","negative":"","size":"portrait"}`;

    function specOf(settings) {
        return (settings.prompts.system || '').trim() || DEFAULT_SPEC;
    }

    // 扩展口：角色库、标签库等 Writer.addContext(fn)，fn(settings, text) 返回要附加给 AI 的参考文字（可空）
    const contexts = [];
    const addContext = (fn) => contexts.push(fn);
    // 扩展口：AI 写完后改结果，Writer.addFilter(fn)，fn(结果, settings) 返回新结果（标签库纠错用）
    const filters = [];
    const addFilter = (fn) => filters.push(fn);

    function buildMessages(settings, text, extra) {
        const nlOn = settings.nai.naturalLanguage && Params.supportsNl(settings.nai.model);
        let user = text.trim();
        if (!nlOn) user += '\n\n（这次 nl 字段写空字符串。）';
        contexts.map((fn) => fn(settings, text)).filter(Boolean).forEach((c) => { user += '\n\n' + c; });
        if (extra) user += '\n\n' + extra;
        return [
            { role: 'system', content: specOf(settings) },
            { role: 'user', content: user },
        ];
    }

    /** 从 AI 回复里抠出 JSON；格式不对抛错（交给 run 重试） */
    function parseReply(text) {
        let t = String(text || '');
        t = t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
        t = t.replace(/```(?:json)?/gi, '');
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b <= a) throw new Error('AI 没有按格式回复 JSON');
        let j;
        try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error('AI 回的 JSON 解析不了'); }
        const str = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '').trim();
        const tag = str(j.tag || j.positive || j.prompt);
        if (!tag) throw new Error('AI 回复里没有 tag');
        return {
            tag,
            nl: str(j.nl),
            negative: str(j.negative),
            size: /land|横/i.test(String(j.size || '')) ? 'landscape' : 'portrait',
        };
    }

    /**
     * 写提示词
     * opt: { settings, text, signal, onDelta(全文), retries }
     * 返回 { tag, nl, negative, size, raw }
     */
    async function run(opt) {
        const { settings } = opt;
        const api = settings.ai;
        if (!String(api.url || '').trim()) throw new Error('请先在设置里填 AI 接口地址');
        if (!String(api.model || '').trim()) throw new Error('请先在设置里选 AI 模型');
        if (!String(opt.text || '').trim()) throw new Error('先写一句中文描述');
        const tries = 1 + (opt.retries == null ? 1 : opt.retries);
        let lastErr = null, hint = '';
        for (let i = 0; i < tries; i++) {
            const r = await Api.chat({
                api, model: api.model,
                messages: buildMessages(settings, opt.text, hint),
                params: { stream: api.stream !== false, temperature: api.temperature },
                signal: opt.signal,
                onDelta: (c) => opt.onDelta && opt.onDelta(c),
            });
            let res;
            try {
                res = Object.assign(parseReply(r.content), { raw: r.content });
            } catch (e) {
                lastErr = e;
                hint = '（上次你的回复格式不对：' + e.message + '。这次只输出一段 JSON，不要别的内容。）';
                continue;
            }
            return filters.reduce((x, fn) => fn(x, settings) || x, res);
        }
        throw new Error(lastErr.message + '（已自动重试）');
    }

    window.Writer = { DEFAULT_SPEC, run, parseReply, buildMessages, addContext, addFilter };
})();
