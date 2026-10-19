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

    function pickDelta(choice) {
        const d = (choice && (choice.delta || choice.message)) || {};
        let c = d.content;
        if (Array.isArray(c)) c = c.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).join('');
        const r = d.reasoning_content || d.reasoning || d.thinking || '';
        return { content: typeof c === 'string' ? c : '', reasoning: typeof r === 'string' ? r : '' };
    }

    /**
     * 发送对话
     * opt: { api, model, messages, params, signal, onDelta(fullText, fullReasoning) }
     * 返回 { content, reasoning }
     */
    async function chat(opt) {
        const { api, params } = opt;
        const body = {
            model: opt.model || api.model,
            messages: opt.messages,
            stream: !!params.stream,
        };
        if (params.temperature !== undefined && params.temperature !== null && params.temperature !== '') body.temperature = Number(params.temperature);
        if (params.top_p !== undefined && Number(params.top_p) !== 1) body.top_p = Number(params.top_p);
        if (api.sendTopK && Number(params.top_k) > 0) body.top_k = Number(params.top_k);
        if (Number(params.frequency_penalty)) body.frequency_penalty = Number(params.frequency_penalty);
        if (Number(params.presence_penalty)) body.presence_penalty = Number(params.presence_penalty);
        if (Number(params.max_tokens) > 0) body.max_tokens = Number(params.max_tokens);
        if (api.extra) {
            try { Object.assign(body, JSON.parse(api.extra)); } catch (e) { /* 设置页已校验 */ }
        }

        const r = await fetch(chatUrl(api.url), {
            method: 'POST', headers: headersFor(api), body: JSON.stringify(body), signal: opt.signal,
        });
        if (!r.ok) throw new Error(errText(r.status, await r.text()));

        let content = '', reasoning = '';
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const emit = () => { if (opt.onDelta) opt.onDelta(content, reasoning); };

        if (!body.stream || ct.includes('application/json')) {
            const t = await r.text();
            let j;
            try { j = JSON.parse(t); } catch (e) {
                // 有的中转站即使不要流式也回 SSE
                if (/^\s*data:/m.test(t)) return parseSSEText(t, opt);
                throw new Error('返回的不是 JSON：' + t.slice(0, 300));
            }
            if (j.error) throw new Error(errText(r.status, t));
            const d = pickDelta(j.choices && j.choices[0]);
            content = d.content; reasoning = d.reasoning;
            emit();
            return { content, reasoning };
        }

        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let errMsg = '';
        const handleLine = (line) => {
            line = line.trim();
            if (!line.startsWith('data:')) return;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') return;
            let j;
            try { j = JSON.parse(data); } catch (e) { return; }
            if (j.error) { errMsg = (j.error.message || JSON.stringify(j.error)); return; }
            const d = pickDelta(j.choices && j.choices[0]);
            if (d.content) content += d.content;
            if (d.reasoning) reasoning += d.reasoning;
        };
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(handleLine);
            emit();
        }
        buf += dec.decode();
        if (buf) handleLine(buf);
        emit();
        if (errMsg && !content) throw new Error(errMsg);
        return { content, reasoning };
    }

    function parseSSEText(t, opt) {
        let content = '', reasoning = '';
        t.split('\n').forEach((line) => {
            line = line.trim();
            if (!line.startsWith('data:')) return;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') return;
            try {
                const j = JSON.parse(data);
                const d = pickDelta(j.choices && j.choices[0]);
                content += d.content; reasoning += d.reasoning;
            } catch (e) { /* ignore */ }
        });
        if (opt.onDelta) opt.onDelta(content, reasoning);
        return { content, reasoning };
    }

    window.Api = { listModels, chat, chatUrl, base };
})();
