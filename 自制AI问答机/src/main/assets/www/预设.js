/*
 * 预设.js —— 酒馆（SillyTavern）对话补全预设的导入、宏替换、组装发送消息
 *
 * 照酒馆的规则：
 *  - 按 prompt_order 的顺序和开关排列条目
 *  - 「聊天记录」标记处放对话；世界书/角色描述/人设等标记在这里没有数据，直接跳过
 *  - 注入位置为「绝对」(injection_position=1) 的条目按深度插进对话里
 *  - new_chat_prompt 放在对话最前，assistant_prefill 作为最后一条 assistant 预填
 *  - 不跑任何正则
 */
(function () {
    'use strict';

    const MARKERS = new Set(['chatHistory', 'worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality',
        'scenario', 'personaDescription', 'dialogueExamples']);
    const MARKER_NAMES = {
        chatHistory: '聊天记录', worldInfoBefore: '世界书（前）', worldInfoAfter: '世界书（后）', charDescription: '角色描述',
        charPersonality: '角色性格', scenario: '场景', personaDescription: '用户人设', dialogueExamples: '对话示例',
    };
    const DEFAULT_NAMES = {
        main: '主提示词', nsfw: '辅助提示词', jailbreak: '越狱/后置指令', enhanceDefinitions: '增强定义',
    };

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // ------------------------------------------------------------
    // 导入
    // ------------------------------------------------------------
    function pickOrder(raw) {
        const po = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
        if (!po.length) return null;
        const byId = (id) => po.find((x) => Number(x && x.character_id) === id);
        const best = byId(100001) || byId(100000)
            || po.slice().sort((a, b) => ((b.order || []).length - (a.order || []).length))[0];
        return best && Array.isArray(best.order) ? best.order : null;
    }

    function num(v, def) {
        const n = Number(v);
        return Number.isFinite(n) ? n : def;
    }

    /** 把酒馆预设 JSON 转成本 App 的预设对象；不是预设时抛错 */
    function importPreset(raw, fileName) {
        if (!raw || typeof raw !== 'object') throw new Error('不是有效的 JSON 对象');
        if (!Array.isArray(raw.prompts)) {
            if (raw.entries || raw.data || raw.spec) throw new Error('这看起来是世界书或角色卡，不是对话补全预设');
            throw new Error('没有找到 prompts 字段，不是酒馆对话补全预设');
        }
        const prompts = raw.prompts.filter((p) => p && p.identifier).map((p) => ({
            identifier: String(p.identifier),
            name: p.name || DEFAULT_NAMES[p.identifier] || MARKER_NAMES[p.identifier] || String(p.identifier),
            role: ['system', 'user', 'assistant'].includes(p.role) ? p.role : 'system',
            content: typeof p.content === 'string' ? p.content : '',
            marker: !!p.marker || MARKERS.has(p.identifier),
            injection_position: num(p.injection_position, 0),
            injection_depth: num(p.injection_depth, 4),
            injection_order: num(p.injection_order, 100),
        }));
        const ids = new Set(prompts.map((p) => p.identifier));
        let order = pickOrder(raw);
        if (order) {
            order = order.filter((o) => o && ids.has(String(o.identifier)))
                .map((o) => ({ identifier: String(o.identifier), enabled: o.enabled !== false }));
        } else {
            order = prompts.map((p) => ({ identifier: p.identifier, enabled: raw.prompts.find((x) => x.identifier === p.identifier).enabled !== false }));
        }
        // 预设里有、但顺序表里没有的条目（酒馆的条目列表里也看不到、不会发送）不放进顺序，
        // 编辑页底下单独列出，需要的话可以手动加入

        const params = {
            temperature: num(raw.temperature, 1),
            top_p: num(raw.top_p, 1),
            top_k: num(raw.top_k, 0),
            frequency_penalty: num(raw.frequency_penalty, 0),
            presence_penalty: num(raw.presence_penalty, 0),
            max_tokens: num(raw.openai_max_tokens, 4096),
            max_context: num(raw.openai_max_context, 0),
            stream: raw.stream_openai !== false,
        };
        const name = (raw.name || raw.preset_name || String(fileName || '').replace(/\.json$/i, '') || '未命名预设').trim();
        const warn = [];
        const allText = prompts.map((p) => p.content).join('\n');
        if (/<%[\s\S]*?%>/.test(allText)) warn.push('含酒馆助手 EJS 模板（<% %>），这里不会执行，会原样发出');
        return {
            id: uid(),
            name,
            importedAt: Date.now(),
            prompts,
            order,
            params,
            new_chat_prompt: typeof raw.new_chat_prompt === 'string' ? raw.new_chat_prompt : '',
            assistant_prefill: typeof raw.assistant_prefill === 'string' ? raw.assistant_prefill : '',
            raw,
            warn,
        };
    }

    /** 导出成酒馆能再导入的 JSON（在原文件基础上写回改动） */
    function exportPreset(p) {
        const raw = JSON.parse(JSON.stringify(p.raw || {}));
        const byId = new Map(p.prompts.map((x) => [x.identifier, x]));
        raw.prompts = (raw.prompts || []).map((x) => {
            const m = x && byId.get(x.identifier);
            if (!m) return x;
            return Object.assign({}, x, { name: m.name, role: m.role, content: m.content,
                injection_position: m.injection_position, injection_depth: m.injection_depth, injection_order: m.injection_order });
        });
        p.prompts.forEach((m) => {
            if (!raw.prompts.some((x) => x && x.identifier === m.identifier)) {
                raw.prompts.push({ identifier: m.identifier, name: m.name, role: m.role, content: m.content, system_prompt: false,
                    marker: false, injection_position: m.injection_position, injection_depth: m.injection_depth, injection_order: m.injection_order });
            }
        });
        const order = p.order.map((o) => ({ identifier: o.identifier, enabled: !!o.enabled }));
        if (!Array.isArray(raw.prompt_order) || !raw.prompt_order.length) raw.prompt_order = [{ character_id: 100001, order }];
        else {
            let hit = raw.prompt_order.find((x) => Number(x.character_id) === 100001) || raw.prompt_order.find((x) => Number(x.character_id) === 100000);
            if (!hit) hit = raw.prompt_order[0];
            hit.order = order;
        }
        raw.temperature = p.params.temperature;
        raw.top_p = p.params.top_p;
        raw.top_k = p.params.top_k;
        raw.frequency_penalty = p.params.frequency_penalty;
        raw.presence_penalty = p.params.presence_penalty;
        raw.openai_max_tokens = p.params.max_tokens;
        raw.openai_max_context = p.params.max_context;
        raw.stream_openai = p.params.stream;
        raw.new_chat_prompt = p.new_chat_prompt;
        raw.assistant_prefill = p.assistant_prefill;
        return raw;
    }

    // ------------------------------------------------------------
    // 宏
    // ------------------------------------------------------------
    const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    function pad(n) { return String(n).padStart(2, '0'); }

    function rollDice(expr) {
        const m = String(expr).trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
        if (!m) {
            const n = parseInt(expr, 10);
            return Number.isFinite(n) && n > 0 ? String(1 + Math.floor(Math.random() * n)) : '';
        }
        const cnt = Math.min(parseInt(m[1] || '1', 10), 100);
        const sides = parseInt(m[2], 10);
        let sum = 0;
        for (let i = 0; i < cnt; i++) sum += 1 + Math.floor(Math.random() * sides);
        return String(sum + (m[3] ? parseInt(m[3], 10) : 0));
    }

    function splitArgs(s) {
        // {{random::a::b}} 或 {{random:a,b}}
        if (s.startsWith('::')) return s.slice(2).split('::');
        if (s.startsWith(':')) return s.slice(1).split(/(?<!\\),/).map((x) => x.replace(/\\,/g, ','));
        if (s.startsWith(' ')) return s.trim().split(/(?<!\\),/).map((x) => x.replace(/\\,/g, ','));
        return [];
    }

    /**
     * ctx: { user, char, model, vars(对话变量对象), gvars(全局变量对象), lastUser, lastChar, lastMsg }
     */
    function macros(text, ctx) {
        if (!text || text.indexOf('{{') < 0) return text || '';
        const keep = [];
        let s = String(text);
        // 注释 {{// ...}} 可以跨行
        s = s.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
        for (let pass = 0; pass < 12; pass++) {
            let changed = false;
            s = s.replace(/\{\{([^{}]*)\}\}/g, (all, inner) => {
                changed = true;
                const r = one(inner, ctx);
                if (r === null) { keep.push(all); return '\u0000K' + (keep.length - 1) + '\u0000'; }
                return r;
            });
            if (!changed) break;
        }
        // {{trim}}：去掉它前后的空白
        s = s.replace(/\s*\u0000T\u0000\s*/g, '');
        return s.replace(/\u0000K(\d+)\u0000/g, (a, i) => keep[+i]);
    }

    function one(inner, ctx) {
        const raw = inner;
        const t = inner.trim();
        const low = t.toLowerCase();
        const now = new Date();
        switch (low) {
            case 'user': return ctx.user || 'User';
            case 'char': return ctx.char || 'Assistant';
            case 'group': case 'charifnotgroup': return ctx.char || 'Assistant';
            case 'model': return ctx.model || '';
            case 'newline': return '\n';
            case 'trim': return '\u0000T\u0000';
            case 'noop': return '';
            case 'time': return pad(now.getHours()) + ':' + pad(now.getMinutes());
            case 'date': return now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
            case 'weekday': return WEEK[now.getDay()];
            case 'isotime': return pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
            case 'isodate': return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
            case 'idle_duration': return '刚刚';
            case 'lastusermessage': case 'input': return ctx.lastUser || '';
            case 'lastcharmessage': return ctx.lastChar || '';
            case 'lastmessage': return ctx.lastMsg || '';
            case 'lastmessageid': return String(Math.max(0, (ctx.count || 1) - 1));
            case 'maxprompt': return String(ctx.maxContext || '');
            // 角色卡/人设/世界书类：这里没有角色卡，给空
            case 'description': case 'personality': case 'scenario': case 'persona': case 'mesexamples': case 'mesexamplesraw':
            case 'charprompt': case 'charinstruction': case 'charjailbreak': case 'chardepthprompt': case 'creatornotes':
            case 'charversion': case 'char_version': case 'original': case 'wibefore': case 'wiafter': case 'lorebefore': case 'loreafter':
                return '';
        }
        let m;
        if ((m = t.match(/^(setvar|setglobalvar)::([^:]+)::([\s\S]*)$/i))) {
            (m[1].toLowerCase() === 'setvar' ? ctx.vars : ctx.gvars)[m[2].trim()] = m[3];
            return '';
        }
        if ((m = t.match(/^(addvar|addglobalvar)::([^:]+)::([\s\S]*)$/i))) {
            const bag = m[1].toLowerCase() === 'addvar' ? ctx.vars : ctx.gvars;
            const k = m[2].trim(); const cur = bag[k];
            const a = Number(cur), b = Number(m[3]);
            bag[k] = (cur !== undefined && Number.isFinite(a) && Number.isFinite(b)) ? String(a + b) : String(cur || '') + m[3];
            return '';
        }
        if ((m = t.match(/^(incvar|decvar|incglobalvar|decglobalvar)::([\s\S]+)$/i))) {
            const glob = /global/i.test(m[1]);
            const bag = glob ? ctx.gvars : ctx.vars;
            const k = m[2].trim();
            const v = (Number(bag[k]) || 0) + (/^inc/i.test(m[1]) ? 1 : -1);
            bag[k] = String(v);
            return String(v);
        }
        if ((m = t.match(/^(getvar|getglobalvar)::([\s\S]+)$/i))) {
            const bag = m[1].toLowerCase() === 'getvar' ? ctx.vars : ctx.gvars;
            const v = bag[m[2].trim()];
            return v === undefined || v === null ? '' : String(v);
        }
        if ((m = raw.match(/^\s*(random|pick)([\s\S]*)$/i)) && /^(::|:| )/.test(m[2])) {
            const opts = splitArgs(m[2]);
            if (!opts.length) return '';
            return opts[Math.floor(Math.random() * opts.length)];
        }
        if ((m = t.match(/^roll[: ]+([\s\S]+)$/i))) return rollDice(m[1]);
        if ((m = t.match(/^reverse:([\s\S]*)$/i))) return Array.from(m[1]).reverse().join('');
        if (/^banned\s/i.test(t)) return '';
        if ((m = t.match(/^(datetimeformat|time_utc)/i))) return now.toLocaleString();
        return null; // 不认识的宏原样保留（酒馆也是这样）
    }

    // ------------------------------------------------------------
    // 组装
    // ------------------------------------------------------------
    function estTokens(s) {
        s = String(s || '');
        let cjk = 0;
        for (const ch of s) { if (/[⺀-鿿가-힯＀-￯]/.test(ch)) cjk++; }
        return Math.ceil(cjk * 1.0 + (s.length - cjk) / 3.6);
    }

    function insertInjections(history, inj) {
        // inj: [{role, content, depth, order}]；depth 0 = 最后一条之后
        if (!inj.length) return history;
        const out = history.slice();
        const depths = Array.from(new Set(inj.map((x) => x.depth))).sort((a, b) => a - b);
        // 从浅到深插入时，要按“原始位置”算，所以先算好位置再从深到浅插
        const plan = depths.map((d) => {
            const items = inj.filter((x) => x.depth === d);
            const msgs = [];
            ['system', 'user', 'assistant'].forEach((role) => {
                const parts = items.filter((x) => x.role === role).sort((a, b) => a.order - b.order).map((x) => x.content).filter(Boolean);
                if (parts.length) msgs.push({ role, content: parts.join('\n') });
            });
            return { pos: Math.max(0, history.length - d), msgs };
        });
        plan.sort((a, b) => b.pos - a.pos).forEach((p) => { out.splice(p.pos, 0, ...p.msgs); });
        return out;
    }

    function postProcess(msgs, mode) {
        let out = msgs.filter((m) => m && typeof m.content === 'string' && (m.content.trim() !== '' || (m.images && m.images.length)));
        if (mode === 'none') return out;
        if (mode === 'strict' || mode === 'semi') {
            // 只保留开头连续的 system，后面的 system 改成 user
            let head = true;
            out = out.map((m) => {
                if (m.role !== 'system') head = false;
                return (!head && m.role === 'system') ? { role: 'user', content: m.content, images: m.images } : m;
            });
        }
        // 合并相邻同角色
        const merged = [];
        out.forEach((m) => {
            const last = merged[merged.length - 1];
            if (last && last.role === m.role) {
                last.content = [last.content, m.content].filter((x) => x.trim()).join('\n\n');
                if (m.images && m.images.length) last.images = (last.images || []).concat(m.images);
            } else merged.push({ role: m.role, content: m.content, images: m.images && m.images.length ? m.images.slice() : undefined });
        });
        if (mode === 'strict') {
            // system 之后第一条必须是 user
            const i = merged.findIndex((m) => m.role !== 'system');
            if (i >= 0 && merged[i].role !== 'user') merged.splice(i, 0, { role: 'user', content: '[Start a new chat]' });
            if (i < 0) merged.push({ role: 'user', content: '[Start a new chat]' });
        }
        return merged;
    }

    /**
     * 组装要发给 API 的 messages
     * opt: { preset|null, history:[{role,content}], settings, vars, gvars, model }
     * 返回 { messages, params, dropped }
     */
    function build(opt) {
        const st = opt.settings || {};
        const hist = opt.history.filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'));
        const lastU = [...hist].reverse().find((m) => m.role === 'user');
        const lastA = [...hist].reverse().find((m) => m.role === 'assistant');
        const preset = opt.preset;
        const ctx = {
            user: st.userName || 'User', char: st.charName || 'Assistant', model: opt.model || '',
            vars: opt.vars || {}, gvars: opt.gvars || {},
            lastUser: lastU ? lastU.content : '', lastChar: lastA ? lastA.content : '',
            lastMsg: hist.length ? hist[hist.length - 1].content : '', count: hist.length,
            maxContext: preset ? preset.params.max_context : 0,
        };
        const M = (s) => macros(s, ctx);
        let params;
        let before = [], after = [], inj = [], newChat = '', prefill = '';
        let hasHistoryMarker = false;

        if (!preset) {
            params = Object.assign({ temperature: 1, top_p: 1, top_k: 0, frequency_penalty: 0, presence_penalty: 0, max_tokens: 4096, max_context: 0, stream: true }, st.plainParams || {});
            if (st.plainSystemPrompt) before.push({ role: 'system', content: M(st.plainSystemPrompt) });
        } else {
            params = Object.assign({}, preset.params);
            const byId = new Map(preset.prompts.map((p) => [p.identifier, p]));
            let seenHistory = false;
            preset.order.forEach((o) => {
                if (!o.enabled) return;
                const p = byId.get(o.identifier);
                if (!p) return;
                if (p.identifier === 'chatHistory') { seenHistory = true; hasHistoryMarker = true; return; }
                if (p.marker) return; // 世界书/角色卡等，没有数据
                if (p.injection_position === 1) {
                    inj.push({ role: p.role, content: M(p.content), depth: Math.max(0, p.injection_depth | 0), order: p.injection_order });
                    return;
                }
                const msg = { role: p.role, content: M(p.content) };
                (seenHistory ? after : before).push(msg);
            });
            newChat = M(preset.new_chat_prompt || '');
            prefill = M(preset.assistant_prefill || '');
        }

        // 附件：文本文件拼进正文，图片单独带着，最后转成 OpenAI 多模态格式
        const filesText = (files) => (files || []).map((f) => '\n\n【附件：' + f.name + '】\n```\n' + f.text + '\n```').join('');
        let history = hist.map((m) => ({
            role: m.role,
            content: (m.role === 'user' ? M(m.content || '') : (m.content || '')) + filesText(m.files),
            images: m.images && m.images.length ? m.images.slice() : undefined,
        }));
        // 预设里关掉/没有「聊天记录」时，对话仍然附在所有条目之后，不然问题发不出去

        // 上下文长度：超了就从最早的对话开始丢
        let dropped = 0;
        if (params.max_context > 0) {
            const fixed = [...before, ...after, ...inj].reduce((a, m) => a + estTokens(m.content), 0) + estTokens(newChat) + estTokens(prefill);
            const budget = params.max_context - (params.max_tokens || 0) - fixed;
            let used = history.reduce((a, m) => a + estTokens(m.content), 0);
            while (history.length > 1 && used > budget) {
                used -= estTokens(history[0].content);
                history.shift();
                dropped++;
            }
        }

        history = insertInjections(history, inj);
        if (newChat) history.unshift({ role: 'system', content: newChat });

        let messages = [...before, ...history, ...after];
        messages = postProcess(messages, st.postProcess || 'merge');
        if (prefill) messages.push({ role: 'assistant', content: prefill });
        messages = messages.map((m) => {
            if (!m.images || !m.images.length) return { role: m.role, content: m.content };
            const parts = [];
            if (m.content.trim()) parts.push({ type: 'text', text: m.content });
            m.images.forEach((url) => parts.push({ type: 'image_url', image_url: { url } }));
            return { role: m.role, content: parts };
        });
        return { messages, params, dropped, prefill };
    }

    window.Preset = { importPreset, exportPreset, macros, build, postProcess, estTokens, MARKER_NAMES, uid };
})();
