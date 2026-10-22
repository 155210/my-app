/*
 * 写词.js —— 把中文描述交给 AI（OpenAI 兼容接口），让它写 NAI 用的正面 tag、英文描述、补充负面词、画幅
 *
 * AI 只回一段 JSON：{"tag":"...","nl":"...","negative":"...","size":"portrait|landscape"}
 * 格式不对自动再要（次数在设置里改）。规范在设置里可以改，留空用下面的内置规范（参考「柏宝绘」的 NAI 规范改写）。
 *
 * 另外两种写法（照柏宝绘）：
 *   一段描述拆成多张：run({ plan: 张数（0 = AI 自己定 2~6 张） })，AI 回 {"images":[{desc,tag,nl,negative,size}...]}
 *   重写提示词：run({ rewrite: { tag, nl, negative, hint 附加要求, history 前几轮对话 } })，照原来那个画面重写一遍，这次的 changes 不要
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
    // 扩展口：发送前改整条消息链，Writer.addMessages(fn)，fn(消息数组, settings, { attempt 第几次（0 起）, parseFailed 之前格式不对过 })
    // 返回新数组（破限词、思维链、重型提示词用，见 自定义提示词.js）
    const msgHooks = [];
    const addMessages = (fn) => msgHooks.push(fn);
    /** 实际发给 AI 的消息（buildMessages 再过一遍 addMessages 的扩展） */
    function messagesFor(settings, text, extra, state) {
        state = state || { attempt: 0, parseFailed: false };
        return msgHooks.reduce((m, fn) => fn(m, settings, state) || m, buildMessages(settings, text, extra));
    }
    /** 格式不对自动重试几次（设置 prompts.retries，0~5，默认 1） */
    function retriesOf(settings) {
        const n = Math.floor(Number(settings.prompts && settings.prompts.retries));
        return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 1;
    }

    const PLAN_MAX = 6;
    /** 拆成多张时附在描述后面的任务说明（规则照柏宝绘的「按剧情节奏规划多张图」） */
    function planNote(count, nlOn) {
        const n = Math.max(0, Math.min(PLAN_MAX, Math.floor(Number(count)) || 0));
        const one = { desc: '这张画什么（一句中文）', tag: '...', nl: nlOn ? '...' : '', negative: '', size: 'portrait' };
        return '【这次要把上面的描述拆成多张图】\n'
            + (n ? '一共 ' + n + ' 张，不多不少。' : '张数你自己定，2～' + PLAN_MAX + ' 张，按描述里值得画的画面来，不要为了凑数硬拆。') + '\n'
            + '- 按描述里事情发生的先后顺序排，每张是一个单一瞬间；相邻两张要有明显不同的动作、表情、场景或状态，不要只是同一刻换个镜头。\n'
            + '- 同一个角色每张的外貌（发色、发型、瞳色、体型）一字不差；衣服没换就一直写同一套，写具体（颜色、款式、关键部件）。\n'
            + '- 每张都按上面的规范完整写（人数、外貌、服装、表情视线、动作、场景、景别、光线、色调），不能省略成「同上」。\n'
            + '- desc 用一句中文说这张画的是哪一刻，给用户看的。\n'
            + '这次输出的 JSON 改成下面这样（images 里每一项的字段和单张时一样；有 changes 的话照常放在最外层）：\n'
            + JSON.stringify({ images: [one], changes: [] });
    }

    /** 重写时附在描述后面：当前提示词当锚点，照同一个画面重写；有附加要求时以要求为准（照柏宝绘 slotPlan + rewriteHint） */
    function rewriteNote(cur) {
        cur = cur || {};
        const hint = String(cur.hint || '').replace(/\r\n?/g, '\n').trim().slice(0, 500);
        const lines = ['【这次是重写提示词】',
            '画的还是原来那个画面：不要另选画面、不要换主体。把下面这套提示词重写一遍——依据描述写得更准、更具体，补上漏掉的，修掉和描述不符或含糊的地方。',
            '', '当前的提示词（要重写的就是它）：', 'tag: ' + (cur.tag || '（空）')];
        if (cur.nl) lines.push('nl: ' + cur.nl);
        if (cur.negative) lines.push('negative: ' + cur.negative);
        lines.push('', '这次不用写 changes。');
        // 对话改词：前几轮的要求和用户没接受的改动（对话改词.js 传进来）
        const hist = (Array.isArray(cur.history) ? cur.history : []).map((x) => String(x || '').trim()).filter(Boolean);
        if (hist.length) {
            lines.push('', '【前几轮的对话（上面当前的提示词已经是按这些改过、用户挑着接受之后的结果）】');
            hist.forEach((x, i) => lines.push((i + 1) + '. ' + x.slice(0, 300)));
            lines.push('用户没接受的改动说明他不想要，这轮别再改回去；这轮只按下面的新要求改，没提到的地方尽量不动。');
        }
        if (hint) {
            lines.push('', '【用户对这次重写的额外要求（优先级最高）】', hint,
                '按这条要求改写。它和上面「不要换画面」等约束冲突时，以这条要求为准；要求没提到的部分照旧保持原来的画面。');
        }
        return lines.join('\n');
    }

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

    /** 拆成多张时的回复：{ images: [{ desc, tag, nl, negative, size }] }，一张都解析不出来就抛错 */
    function parsePlan(text, count) {
        let t = String(text || '');
        t = t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '');
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b <= a) throw new Error('AI 没有按格式回复 JSON');
        let j;
        try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error('AI 回的 JSON 解析不了'); }
        const list = Array.isArray(j.images) ? j.images : Array.isArray(j) ? j : (j.tag ? [j] : null);
        if (!list) throw new Error('AI 回复里没有 images 数组');
        const images = [];
        list.forEach((im) => {
            if (!im || typeof im !== 'object') return;
            try {
                const r = parseReply(JSON.stringify(im));
                r.desc = typeof im.desc === 'string' ? im.desc.trim() : '';
                images.push(r);
            } catch (e) { /* 缺 tag 的那张跳过 */ }
        });
        if (!images.length) throw new Error('AI 规划的图里都没有 tag');
        const n = Math.floor(Number(count)) || 0;
        if (n && images.length < n) throw new Error('要 ' + n + ' 张，AI 只给了 ' + images.length + ' 张');
        return { images: images.slice(0, n || PLAN_MAX) };
    }

    /**
     * 写提示词
     * opt: { settings, text, signal, onDelta(全文), retries, plan, rewrite }
     * 返回 { tag, nl, negative, size, raw }；拆成多张（opt.plan 不是 undefined/false）时返回 { images: [同上 + desc], raw }
     */
    async function run(opt) {
        const { settings } = opt;
        const api = settings.ai;
        if (!String(api.url || '').trim()) throw new Error('请先在设置里填 AI 接口地址');
        if (!String(api.model || '').trim()) throw new Error('请先在设置里选 AI 模型');
        if (!String(opt.text || '').trim()) throw new Error('先写一句中文描述');
        const tries = 1 + (opt.retries == null ? retriesOf(settings) : opt.retries);
        const planning = opt.plan !== undefined && opt.plan !== false && opt.plan !== null;
        const nlOn = settings.nai.naturalLanguage && Params.supportsNl(settings.nai.model);
        const task = planning ? planNote(opt.plan, nlOn) : opt.rewrite ? rewriteNote(opt.rewrite) : '';
        let lastErr = null, hint = '';
        for (let i = 0; i < tries; i++) {
            const r = await Api.chat({
                api, model: api.model,
                messages: messagesFor(settings, opt.text, [task, hint].filter(Boolean).join('\n\n'), { attempt: i, parseFailed: !!lastErr }),
                params: { stream: api.stream !== false, temperature: api.temperature },
                signal: opt.signal,
                onDelta: (c) => opt.onDelta && opt.onDelta(c),
            });
            let res;
            try {
                res = planning ? parsePlan(r.content, opt.plan) : parseReply(r.content);
            } catch (e) {
                lastErr = e;
                hint = '（上次你的回复格式不对：' + e.message + '。这次只输出一段 JSON，不要别的内容。）';
                continue;
            }
            // 重写不要 changes（建档在第一次写时已经做过，柏宝绘也是丢掉）；多张时 changes 只跟第一张走一次
            const raw = opt.rewrite ? '' : r.content;
            const filt = (x, rawOf) => filters.reduce((y, fn) => fn(y, settings) || y, Object.assign(x, { raw: rawOf }));
            if (planning) return { images: res.images.map((x, k) => Object.assign(filt(x, k ? '' : raw), { raw: k ? '' : r.content })), raw: r.content };
            return Object.assign(filt(res, raw), { raw: r.content });
        }
        throw new Error(lastErr.message + '（已自动重试）');
    }

    window.Writer = { DEFAULT_SPEC, PLAN_MAX, run, parseReply, parsePlan, planNote, rewriteNote, buildMessages, messagesFor, retriesOf, addContext, addFilter, addMessages };
})();
