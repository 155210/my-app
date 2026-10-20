/*
 * 接口.js —— 调 OpenAI 兼容接口（官方、中转站、反代都行，填法和酒馆「自定义 OpenAI 兼容」一样）
 */
(function () {
    'use strict';

    function base(url) {
        let u = String(url || '').trim().replace(/\/+$/, '');
        u = u.replace(/\/chat\/completions$/i, '');
        return u;
    }
    function chatUrl(url) {
        const u = String(url || '').trim().replace(/\/+$/, '');
        if (/\/chat\/completions$/i.test(u)) return u;
        return u + '/chat/completions';
    }

    function headersFor(api) {
        const h = { 'Content-Type': 'application/json' };
        if (api.key) h.Authorization = 'Bearer ' + api.key.trim();
        if (api.headers) {
            try { Object.assign(h, JSON.parse(api.headers)); } catch (e) { /* 设置页已校验 */ }
        }
        return h;
    }

    function errText(status, body) {
        let msg = '';
        try {
            const j = JSON.parse(body);
            msg = (j.error && (j.error.message || j.error.msg || (typeof j.error === 'string' ? j.error : ''))) || j.message || j.detail || '';
            if (!msg) msg = body;
        } catch (e) { msg = body; }
        msg = String(msg || '').slice(0, 800);
        return 'HTTP ' + status + (msg ? '：' + msg : '');
    }

    async function listModels(api) {
        const r = await fetch(base(api.url) + '/models', { headers: headersFor(api) });
        const t = await r.text();
        if (!r.ok) throw new Error(errText(r.status, t));
        let j;
        try { j = JSON.parse(t); } catch (e) { throw new Error('返回的不是 JSON：' + t.slice(0, 200)); }
        const arr = Array.isArray(j) ? j : (j.data || j.models || []);
        return arr.map((m) => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean).map((s) => String(s).replace(/^models\//, '')).sort();
    }

    /**
     * 从一块返回数据里取出正文/思考/结束原因/错误。认得这些格式：
     *  OpenAI chat（choices）、Claude 原生（content_block_delta / content 数组）、Gemini（candidates.parts）、
     *  OpenAI Responses（response.output_text.delta / output）
     */
    function extract(j) {
        const out = { content: '', reasoning: '', finish: '', error: '' };
        if (!j || typeof j !== 'object') return out;
        const errOf = (e) => (typeof e === 'string' ? e : (e && (e.message || e.msg)) || JSON.stringify(e));
        if (j.error) { out.error = errOf(j.error); return out; }
        if (j.type === 'error') { out.error = errOf(j.error || j); return out; }
        const blocks = (arr) => {
            (arr || []).forEach((x) => {
                if (typeof x === 'string') { out.content += x; return; }
                if (!x) return;
                if (x.type === 'thinking' || x.type === 'reasoning' || x.thought === true) out.reasoning += x.thinking || x.text || '';
                else if (x.type === 'redacted_thinking') { /* 加密思考，不显示 */ }
                else if (typeof x.text === 'string') out.content += x.text;
            });
        };
        // OpenAI chat
        if (Array.isArray(j.choices)) {
            const ch = j.choices[0] || {};
            const d = ch.delta || ch.message || {};
            if (Array.isArray(d.content)) blocks(d.content);
            else if (typeof d.content === 'string') out.content += d.content;
            if (typeof ch.text === 'string') out.content += ch.text;
            const r = d.reasoning_content || d.reasoning || d.thinking;
            if (typeof r === 'string') out.reasoning += r;
            if (Array.isArray(d.reasoning_details)) d.reasoning_details.forEach((x) => { if (x && typeof x.text === 'string') out.reasoning += x.text; });
            out.finish = ch.finish_reason || '';
            return out;
        }
        // Claude 原生流式
        if (j.type === 'content_block_delta' && j.delta) {
            if (j.delta.type === 'thinking_delta') out.reasoning += j.delta.thinking || '';
            else if (typeof j.delta.text === 'string') out.content += j.delta.text;
            return out;
        }
        if (j.type === 'content_block_start' && j.content_block) { blocks([j.content_block]); return out; }
        if (j.type === 'message_delta' && j.delta) { out.finish = j.delta.stop_reason || ''; return out; }
        if (j.type === 'message_start') return out;
        // Claude 原生非流式
        if (Array.isArray(j.content) && (j.role === 'assistant' || j.type === 'message')) { blocks(j.content); out.finish = j.stop_reason || ''; return out; }
        // Gemini
        if (Array.isArray(j.candidates)) {
            const c = j.candidates[0] || {};
            blocks((c.content && c.content.parts) || []);
            out.finish = c.finishReason || '';
            if (!out.content && j.promptFeedback && j.promptFeedback.blockReason) out.finish = 'blocked:' + j.promptFeedback.blockReason;
            return out;
        }
        // OpenAI Responses
        if (typeof j.type === 'string' && j.type.startsWith('response.')) {
            if (j.type === 'response.output_text.delta' && typeof j.delta === 'string') out.content += j.delta;
            else if (/reasoning.*\.delta$/.test(j.type) && typeof j.delta === 'string') out.reasoning += j.delta;
            else if (j.type === 'response.completed' && j.response) out.finish = j.response.status || '';
            else if (j.type === 'response.failed') out.error = errOf((j.response && j.response.error) || j);
            return out;
        }
        if (Array.isArray(j.output)) {
            j.output.forEach((o) => { if (o && o.type === 'reasoning') blocks((o.summary || []).map((x) => ({ type: 'reasoning', text: x.text }))); else if (o) blocks(o.content); });
            out.finish = j.status || '';
            return out;
        }
        if (typeof j.output_text === 'string') out.content += j.output_text;
        return out;
    }

    /**
     * 发送对话
     * opt: { api, model, messages, params, signal, onDelta(fullText, fullReasoning) }
     * 返回 { content, reasoning, finish, raw, sent }
     */
    async function chat(opt) {
        const { api, params } = opt;
        const body = {
            model: opt.model || api.model,
            messages: opt.messages,
            stream: !!params.stream,
        };
        if (params.temperature !== undefined && params.temperature !== null && params.temperature !== '') body.temperature = Number(params.temperature);
        // 新版 Claude（Opus/Sonnet 4.1 以后、5.x）不允许 temperature 和 top_p 同时发，自动只发 temperature
        const newClaude = /(opus|sonnet|haiku)[^\d]{0,3}(4[.\-_][1-9](?!\d{2})|[5-9])|claude[-_ ]?[5-9]/i.test(String(opt.model || api.model || ''));
        if (params.top_p !== undefined && Number(params.top_p) !== 1 && !api.noTopP && !(newClaude && body.temperature !== undefined)) body.top_p = Number(params.top_p);
        if (api.sendTopK && Number(params.top_k) > 0) body.top_k = Number(params.top_k);
        if (Number(params.frequency_penalty)) body.frequency_penalty = Number(params.frequency_penalty);
        if (Number(params.presence_penalty)) body.presence_penalty = Number(params.presence_penalty);
        if (Number(params.max_tokens) > 0) body.max_tokens = Number(params.max_tokens);
        if (api.extra) {
            try { Object.assign(body, JSON.parse(api.extra)); } catch (e) { /* 设置页已校验 */ }
        }
        const last = body.messages[body.messages.length - 1];
        const sent = { top_p: body.top_p !== undefined, temperature: body.temperature !== undefined,
            prefill: !!(last && last.role === 'assistant'), max_tokens: body.max_tokens, stream: body.stream };

        const r = await fetch(chatUrl(api.url), {
            method: 'POST', headers: headersFor(api), body: JSON.stringify(body), signal: opt.signal,
        });
        if (!r.ok) throw new Error(errText(r.status, await r.text()));

        const res = { content: '', reasoning: '', finish: '', raw: '', sent };
        let errMsg = '';
        const RAW_MAX = 1500;
        const keepRaw = (t) => { if (res.raw.length < RAW_MAX) res.raw += t.slice(0, RAW_MAX - res.raw.length); };
        const emit = () => { if (opt.onDelta) opt.onDelta(res.content, res.reasoning); };
        const take = (j) => {
            const d = extract(j);
            if (d.error) { errMsg = d.error; return; }
            res.content += d.content; res.reasoning += d.reasoning;
            if (d.finish) res.finish = d.finish;
        };
        const handleLine = (line) => {
            line = line.trim();
            if (!line.startsWith('data:')) return;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') return;
            let j;
            try { j = JSON.parse(data); } catch (e) { return; }
            take(j);
        };

        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!body.stream || ct.includes('application/json')) {
            const t = await r.text();
            keepRaw(t);
            let j = null;
            try { j = JSON.parse(t); } catch (e) {
                // 有的中转站即使不要流式也回 SSE
                if (/^\s*data:/m.test(t)) t.split('\n').forEach(handleLine);
                else if (t.trim()) throw new Error('返回的不是 JSON：' + t.slice(0, 300));
            }
            if (j) take(j);
            if (errMsg) throw new Error(errText(r.status, errMsg));
            emit();
            return res;
        }

        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = dec.decode(value, { stream: true });
            keepRaw(chunk);
            buf += chunk;
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(handleLine);
            emit();
        }
        buf += dec.decode();
        if (buf) {
            // 整个流里一行 data 都没有、只有一段 JSON（有的中转报错时这样回）
            if (!/^\s*data:/m.test(buf) && /^\s*\{/.test(buf)) { try { take(JSON.parse(buf)); } catch (e) { /* ignore */ } }
            else handleLine(buf);
        }
        emit();
        if (errMsg && !res.content) throw new Error(errMsg);
        return res;
    }

    /** 空回复时给用户看的诊断 */
    function explainEmpty(res) {
        const f = String(res.finish || '').toLowerCase();
        const tips = [];
        if (/length|max_tokens|max_output/.test(f)) tips.push('回复长度上限被用完了（多半是思考把额度吃光了）。把预设或「通用」里的「最大回复长度」调大，比如 8000 以上。');
        else if (/filter|safety|refusal|blocked|prohibited|recitation/.test(f)) tips.push('被模型或中转站的安全过滤拦下了。');
        if (!res.raw.trim()) tips.push('接口什么都没返回。可能是中转站不支持这个模型名，或者不支持流式——可以在预设参数里关掉「流式输出」再试。');
        if (res.sent && res.sent.prefill) tips.push('这次带了「AI 回复预填」（assistant_prefill）。新版 Claude（Opus 4.6 及以后）不支持预填，在预设编辑页把它清空。');
        if (res.sent && res.sent.top_p && res.sent.temperature) tips.push('这次同时发了 temperature 和 top_p。新版 Claude 不允许两个一起发，可以在接口设置里勾上「不发 top_p」。');
        let s = '接口返回了空内容' + (res.finish ? '（结束原因：' + res.finish + '）' : '');
        if (tips.length) s += '\n\n可能的原因：\n· ' + tips.join('\n· ');
        s += '\n\n接口原始返回（前 ' + Math.min(res.raw.length, 1500) + ' 字）：\n' + (res.raw.trim() ? res.raw : '（空）');
        return s;
    }

    window.Api = { listModels, chat, chatUrl, base, explainEmpty, extract };
})();
