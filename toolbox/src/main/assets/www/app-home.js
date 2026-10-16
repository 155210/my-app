/*
 * app-home.js —— 首页：三个工具入口 + 统一 API 设置
 *
 * 统一 API 设置存在 localStorage('toolboxApi')。
 * 打开「TXT转世界书」或「小说翻译」时，把它填进模块自己的 API 输入框并触发 change，
 * 模块会按自己的逻辑保存；用户在模块里改 API，也会反写回这里。
 */
(function () {
    'use strict';
    const KEY = 'toolboxApi';
    const $ = (id) => document.getElementById(id);

    const FIELD_MAP = {
        worldbook: { provider: 'ttw-api-provider', endpoint: 'ttw-api-endpoint', key: 'ttw-api-key', model: 'ttw-api-model' },
        translate: { provider: 'ntr-provider', endpoint: 'ntr-endpoint', key: 'ntr-key', model: 'ntr-model' },
    };

    function load() {
        try { return Object.assign({ provider: 'openai-compatible', endpoint: '', key: '', model: '' }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
        catch (e) { return { provider: 'openai-compatible', endpoint: '', key: '', model: '' }; }
    }
    function store(g) { localStorage.setItem(KEY, JSON.stringify(g)); }
    function isSet(g) { return !!(g.endpoint || g.key || g.model); }

    function readForm() {
        return {
            provider: $('g-provider').value,
            endpoint: $('g-endpoint').value.trim(),
            key: $('g-key').value.trim(),
            model: $('g-model').value.trim(),
        };
    }
    function fillForm(g) {
        $('g-provider').value = g.provider;
        $('g-endpoint').value = g.endpoint;
        $('g-key').value = g.key;
        $('g-model').value = g.model;
        updateHints();
    }
    function updateBadge() {
        const g = load();
        const el = $('api-state');
        if (isSet(g)) { el.textContent = g.model || '已设置'; el.className = 'pill ok'; }
        else { el.textContent = '未设置'; el.className = 'pill'; }
    }
    function updateHints() {
        const p = $('g-provider').value;
        const hint = { 'openai-compatible': '例如 https://你的中转站/v1', gemini: '留空即官方地址', anthropic: '留空即官方地址' }[p];
        $('g-endpoint-hint').textContent = hint;
        $('g-endpoint').placeholder = p === 'openai-compatible' ? 'https://api.example.com/v1'
            : p === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.anthropic.com';
    }
    function status(msg, cls) { const s = $('g-status'); s.textContent = msg || ''; s.className = 'status ' + (cls || ''); }

    // ---------- 网络（与小说翻译模块同一套地址规则） ----------
    function normBase(u) { u = (u || '').trim().replace(/\/+$/, ''); if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u; return u; }
    async function getJSON(url, opt) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 30000);
        let r;
        try { r = await fetch(url, Object.assign({}, opt, { signal: ctl.signal })); }
        catch (e) { throw new Error(e.name === 'AbortError' ? '请求超时（30 秒）' : '网络错误：' + e.message); }
        finally { clearTimeout(t); }
        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON */ }
        if (!r.ok) throw new Error('HTTP ' + r.status + '：' + ((data && (data.error && data.error.message || data.message)) || text.slice(0, 200)));
        if (data === null) throw new Error('返回的不是 JSON：' + text.slice(0, 200));
        return data;
    }
    async function listModels(g) {
        if (g.provider === 'anthropic') {
            if (!g.key) throw new Error('请先填写 API Key');
            const base = normBase(g.endpoint || 'https://api.anthropic.com').replace(/\/v1\/messages$/i, '').replace(/\/v1$/i, '');
            const d = await getJSON(base + '/v1/models', { headers: { 'x-api-key': g.key, 'anthropic-version': '2023-06-01' } });
            return (d.data || []).map((m) => m.id).filter(Boolean);
        }
        if (g.provider === 'gemini') {
            if (!g.key) throw new Error('请先填写 API Key');
            const base = normBase(g.endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/models$/i, '');
            const d = await getJSON(base + '/models?pageSize=200&key=' + encodeURIComponent(g.key));
            return (d.models || []).filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
                .map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
        }
        let url = normBase(g.endpoint || 'https://api.openai.com/v1');
        if (/\/chat\/completions$/i.test(url)) url = url.replace(/\/chat\/completions$/i, '/models');
        else if (!/\/models$/i.test(url)) url += '/models';
        const h = {};
        if (g.key) h.Authorization = 'Bearer ' + g.key;
        const d = await getJSON(url, { headers: h });
        const arr = Array.isArray(d.data) ? d.data : Array.isArray(d) ? d : Array.isArray(d.models) ? d.models : [];
        return arr.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
    }
    async function testChat(g) {
        if (!g.model) throw new Error('请先填写模型');
        const prompt = '回复「OK」两个字即可。';
        if (g.provider === 'anthropic') {
            if (!g.key) throw new Error('请先填写 API Key');
            const base = normBase(g.endpoint || 'https://api.anthropic.com').replace(/\/v1\/messages$/i, '').replace(/\/v1$/i, '');
            const d = await getJSON(base + '/v1/messages', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-api-key': g.key, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model: g.model, max_tokens: 32, messages: [{ role: 'user', content: prompt }] }),
            });
            return (d.content || []).map((c) => c.text || '').join('');
        }
        if (g.provider === 'gemini') {
            if (!g.key) throw new Error('请先填写 API Key');
            const base = normBase(g.endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/models$/i, '');
            const d = await getJSON(base + '/models/' + encodeURIComponent(g.model) + ':generateContent?key=' + encodeURIComponent(g.key), {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
            });
            return ((d.candidates || [])[0]?.content?.parts || []).map((p) => p.text || '').join('');
        }
        let url = normBase(g.endpoint || 'https://api.openai.com/v1');
        if (!/\/chat\/completions$/i.test(url)) url += '/chat/completions';
        const h = { 'content-type': 'application/json' };
        if (g.key) h.Authorization = 'Bearer ' + g.key;
        const d = await getJSON(url, {
            method: 'POST', headers: h,
            body: JSON.stringify({ model: g.model, max_tokens: 32, stream: false, messages: [{ role: 'user', content: prompt }] }),
        });
        const m = (d.choices || [])[0]?.message;
        return (m && (m.content || m.reasoning_content)) || JSON.stringify(d).slice(0, 120);
    }

    // ---------- 同步到模块 ----------
    let applying = false;
    function applyToModule(name) {
        const g = load();
        if (!isSet(g)) return;
        const f = FIELD_MAP[name];
        const prov = $(f.provider);
        if (!prov) return;
        applying = true;
        try {
            prov.value = g.provider;
            prov.dispatchEvent(new Event('change', { bubbles: true }));
            ['endpoint', 'key', 'model'].forEach((k) => {
                const el = $(f[k]);
                if (!el) return;
                el.value = g[k];
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            if (name === 'worldbook') {
                // 模块里「已拉取模型」下拉框若在显示，会覆盖模型名，这里收起
                const sel = $('ttw-model-select-container');
                if (sel) sel.style.display = 'none';
                const inp = $('ttw-model-input-container');
                if (inp) inp.style.display = 'block';
                $(f.model)?.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } finally { applying = false; }
    }
    // 模块里手动改 API → 反写首页
    document.addEventListener('change', (e) => {
        if (applying) return;
        const id = e.target && e.target.id;
        for (const f of Object.values(FIELD_MAP)) {
            const k = Object.keys(f).find((kk) => f[kk] === id);
            if (k) {
                const g = load();
                g[k] = String(e.target.value || '').trim();
                store(g);
                fillForm(g);
                updateBadge();
                return;
            }
        }
        if (id === 'ttw-model-select' || id === 'ntr-model-select') {
            const g = load();
            g.model = String(e.target.value || '').trim();
            if (g.model) { store(g); fillForm(g); updateBadge(); }
        }
    }, true);

    // ---------- 打开工具 ----------
    async function waitFor(fn, ms) {
        const t0 = Date.now();
        while (!fn()) {
            if (Date.now() - t0 > ms) return false;
            await new Promise((r) => setTimeout(r, 50));
        }
        return true;
    }
    async function openTool(name) {
        if (name === 'worldbook') {
            if (!(await waitFor(() => window.TxtToWorldbook, 8000))) return toastr.error('TXT转世界书模块未加载');
            await window.TxtToWorldbook.open();
            await waitFor(() => $('ttw-api-provider'), 3000);
            applyToModule('worldbook');
        } else if (name === 'epub') {
            if (!window.EpubToTxt) return toastr.error('EPUB转TXT模块未加载');
            window.EpubToTxt.open();
        } else if (name === 'translate') {
            if (!window.NovelTranslate) return toastr.error('小说翻译模块未加载');
            await window.NovelTranslate.open();
            await waitFor(() => $('ntr-provider'), 3000);
            applyToModule('translate');
        }
    }

    // ---------- 绑定 ----------
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openTool(b.dataset.open)));
    $('g-provider').addEventListener('change', updateHints);
    $('g-key-eye').addEventListener('click', () => {
        const k = $('g-key');
        k.type = k.type === 'password' ? 'text' : 'password';
        $('g-key-eye').textContent = k.type === 'password' ? '显示' : '隐藏';
    });
    $('g-models').addEventListener('change', (e) => { if (e.target.value) $('g-model').value = e.target.value; });
    $('g-save').addEventListener('click', () => {
        store(readForm());
        updateBadge();
        status('已保存。打开工具时会自动填入。', 'ok');
    });
    $('g-fetch').addEventListener('click', async () => {
        const b = $('g-fetch');
        b.disabled = true;
        status('正在拉取模型列表…', 'busy');
        try {
            const list = await listModels(readForm());
            const sel = $('g-models');
            sel.innerHTML = '<option value="">— 选择模型 —</option>' + list.map((m) => `<option>${String(m).replace(/[<&>"]/g, '')}</option>`).join('');
            $('g-models-wrap').hidden = !list.length;
            status(list.length ? `拉取到 ${list.length} 个模型` : '接口没有返回模型列表，请手动填写模型名', list.length ? 'ok' : 'err');
        } catch (e) { status('拉取失败：' + e.message, 'err'); }
        finally { b.disabled = false; }
    });
    $('g-test').addEventListener('click', async () => {
        const b = $('g-test');
        b.disabled = true;
        status('正在测试…', 'busy');
        const t0 = Date.now();
        try {
            const reply = await testChat(readForm());
            status(`连接成功（${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n模型回复：${String(reply).trim().slice(0, 100)}`, 'ok');
        } catch (e) { status('测试失败：' + e.message, 'err'); }
        finally { b.disabled = false; }
    });

    fillForm(load());
    updateBadge();
    try { $('ver').textContent = '版本 ' + (window.AndroidBridge ? window.AndroidBridge.appVersion() : '网页调试'); } catch (e) { /* ignore */ }
})();
