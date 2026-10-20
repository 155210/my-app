/*
 * 桥接.js —— 安卓外壳与网页之间的桥（从「自制AI问答机」照搬）
 *
 *  1. fetch 转发：跨域请求交给原生层发，绕开 CORS / 允许 http 地址，流式数据逐块回传
 *  2. 文件保存：window.__saveBlob(blob, 文件名) 写进手机（图片进相册 Pictures/自然语言生图/）
 *  3. 剪贴板：navigator.clipboard.writeText 走原生
 *  4. 轻提示：window.__toast(类型, 内容, 标题)
 *  返回键由 界面.js 里的 window.__appBack 处理。
 *
 * 不在 APK 里（浏览器直接打开 首页.html 调试）时，1~3 自动退回浏览器原生行为。
 */
(function () {
    'use strict';

    const bridge = window.AndroidBridge || null;
    window.__IN_APP__ = !!bridge;

    // ------------------------------------------------------------
    // 工具
    // ------------------------------------------------------------
    function bytesToB64(bytes) {
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        }
        return btoa(s);
    }
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // ------------------------------------------------------------
    // toastr 替代
    // ------------------------------------------------------------
    function toast(type, msg, title, opts) {
        let box = document.getElementById('ask-toasts');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ask-toasts';
            (document.body || document.documentElement).appendChild(box);
        }
        const el = document.createElement('div');
        el.className = 'ask-toast ' + type;
        if (title) {
            const b = document.createElement('b');
            b.textContent = String(title);
            el.appendChild(b);
        }
        el.appendChild(document.createTextNode(String(msg == null ? '' : msg).replace(/<[^>]+>/g, '')));
        box.appendChild(el);
        while (box.children.length > 4) box.firstChild.remove();
        const ms = (opts && opts.timeOut) || (type === 'error' ? 5000 : 3000);
        const kill = () => el.remove();
        el.addEventListener('click', kill);
        setTimeout(kill, ms);
        return el;
    }
    window.toastr = {
        success: (m, t, o) => toast('success', m, t, o),
        info: (m, t, o) => toast('info', m, t, o),
        warning: (m, t, o) => toast('warning', m, t, o),
        error: (m, t, o) => toast('error', m, t, o),
        clear: () => { const b = document.getElementById('ask-toasts'); if (b) b.innerHTML = ''; },
        remove: () => {},
        options: {},
    };
    window.__toast = toast;

    if (!bridge) return; // 以下只在 APK 内生效

    // ------------------------------------------------------------
    // 1. fetch 转发
    // ------------------------------------------------------------
    const nativeFetch = window.fetch.bind(window);
    const pending = new Map();
    let seq = 0;

    function needsProxy(url) {
        try {
            const u = new URL(url, location.href);
            return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== location.origin;
        } catch (e) {
            return false;
        }
    }
    function abortErr(signal) {
        if (signal && signal.reason !== undefined) return signal.reason;
        return new DOMException('The operation was aborted.', 'AbortError');
    }

    async function encodeBody(body, headers) {
        if (body === undefined || body === null) return '';
        if (typeof body === 'string') return bytesToB64(new TextEncoder().encode(body));
        // 其他类型（Blob/FormData/URLSearchParams/ArrayBuffer…）借 Request 统一序列化
        const r = new Request('https://body.invalid/', { method: 'POST', body });
        const ct = r.headers.get('content-type');
        if (ct && !headers.has('content-type')) headers.set('content-type', ct);
        return bytesToB64(new Uint8Array(await r.arrayBuffer()));
    }

    window.fetch = async function (input, init) {
        init = init || {};
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        const url = isReq ? input.url : String(input);
        if (!needsProxy(url)) return nativeFetch(input, init);

        const method = String(init.method || (isReq ? input.method : 'GET')).toUpperCase();
        const headers = new Headers(init.headers || (isReq ? input.headers : undefined));
        const signal = init.signal || (isReq ? input.signal : undefined);
        let body = init.body;
        if (body === undefined && isReq && method !== 'GET' && method !== 'HEAD') {
            body = await input.clone().arrayBuffer();
        }
        if (signal && signal.aborted) throw abortErr(signal);
        const bodyB64 = await encodeBody(body, headers);
        if (signal && signal.aborted) throw abortErr(signal);

        const id = String(++seq);
        const hdrObj = {};
        headers.forEach((v, k) => { hdrObj[k] = v; });

        return new Promise((resolve, reject) => {
            const p = { resolve, reject, controller: null, headed: false, done: false, url };
            p.stream = new ReadableStream({
                start(c) { p.controller = c; },
                cancel() { finish(); bridge.httpAbort(id); },
            });
            function finish() {
                p.done = true;
                pending.delete(id);
                if (signal) signal.removeEventListener('abort', onAbort);
            }
            function onAbort() {
                if (p.done) return;
                const err = abortErr(signal);
                bridge.httpAbort(id);
                if (!p.headed) reject(err);
                else { try { p.controller.error(err); } catch (e) { /* ignore */ } }
                finish();
            }
            p.finish = finish;
            if (signal) signal.addEventListener('abort', onAbort);
            pending.set(id, p);
            bridge.httpStart(id, method, url, JSON.stringify(hdrObj), bodyB64);
        });
    };

    window.__nativeHttp = {
        head(id, status, statusText, headersJson) {
            const p = pending.get(id);
            if (!p) return;
            p.headed = true;
            let hdrs;
            try { hdrs = new Headers(JSON.parse(headersJson || '{}')); } catch (e) { hdrs = new Headers(); }
            let st = status | 0;
            if (st < 200 || st > 599) st = st >= 600 ? 599 : 502;
            const nullBody = st === 204 || st === 205 || st === 304;
            const resp = new Response(nullBody ? null : p.stream, { status: st, statusText: statusText || '', headers: hdrs });
            try { Object.defineProperty(resp, 'url', { value: p.url }); } catch (e) { /* ignore */ }
            if (nullBody) { try { p.controller.close(); } catch (e) { /* ignore */ } p.finish(); }
            p.resolve(resp);
        },
        data(id, b64) {
            const p = pending.get(id);
            if (!p) return;
            try { p.controller.enqueue(b64ToBytes(b64)); } catch (e) { /* stream closed */ }
        },
        end(id) {
            const p = pending.get(id);
            if (!p) return;
            try { p.controller.close(); } catch (e) { /* ignore */ }
            p.finish();
        },
        error(id, msg) {
            const p = pending.get(id);
            if (!p) return;
            const err = new TypeError('Failed to fetch: ' + msg);
            if (!p.headed) p.reject(err);
            else { try { p.controller.error(err); } catch (e) { /* ignore */ } }
            p.finish();
        },
    };

    // ------------------------------------------------------------
    // 2. 文件保存
    // ------------------------------------------------------------
    const blobMap = new Map();
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
        const u = origCreate(obj);
        if (obj instanceof Blob) blobMap.set(u, obj);
        return u;
    };
    URL.revokeObjectURL = function (u) {
        // 模块常在 click() 后立刻 revoke，这里延后，保证我们读得到
        setTimeout(() => { blobMap.delete(u); origRevoke(u); }, 120000);
    };

    async function saveBlob(blob, name) {
        name = String(name || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'download';
        const token = bridge.fileBegin(name, blob.type || '');
        if (!token || token.startsWith('ERR:')) throw new Error(token ? token.slice(4) : '无法创建文件');
        const CH = 512 * 1024;
        for (let off = 0; off < blob.size; off += CH) {
            const buf = new Uint8Array(await blob.slice(off, off + CH).arrayBuffer());
            const r = bridge.fileChunk(token, bytesToB64(buf));
            if (r && r.startsWith('ERR:')) throw new Error(r.slice(4));
        }
        const res = bridge.fileEnd(token);
        if (!res || res.startsWith('ERR:')) throw new Error(res ? res.slice(4) : '保存失败');
        return res.replace(/^OK:/, '');
    }
    window.__saveBlob = saveBlob;

    async function saveFromAnchor(a) {
        const href = a.href;
        const name = a.getAttribute('download') || decodeURIComponent((href.split('/').pop() || 'download').split('?')[0]);
        try {
            let blob = blobMap.get(href);
            if (!blob) blob = await (await nativeFetch(href)).blob();
            const where = await saveBlob(blob, name);
            toast('success', where, '已保存');
        } catch (e) {
            toast('error', e.message || String(e), '保存失败');
        }
    }

    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download') && this.href) { saveFromAnchor(this); return; }
        return origClick.call(this);
    };
    document.addEventListener('click', (e) => {
        const a = e.target && e.target.closest && e.target.closest('a[download]');
        if (a && a.href) { e.preventDefault(); saveFromAnchor(a); }
    }, true);

    // ------------------------------------------------------------
    // 3. 剪贴板
    // ------------------------------------------------------------
    const clip = {
        writeText: (t) => { bridge.copyText(String(t)); return Promise.resolve(); },
        readText: () => Promise.resolve(bridge.readClipboard() || ''),
    };
    try {
        if (navigator.clipboard) {
            navigator.clipboard.writeText = clip.writeText;
            navigator.clipboard.readText = clip.readText;
        } else {
            Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
        }
    } catch (e) {
        try { Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true }); } catch (e2) { /* ignore */ }
    }
    document.execCommand = (function (orig) {
        return function (cmd) {
            if (String(cmd).toLowerCase() === 'copy') {
                const sel = String(window.getSelection ? window.getSelection() : '');
                const ae = document.activeElement;
                const txt = sel || (ae && 'value' in ae ? ae.value.substring(ae.selectionStart, ae.selectionEnd) : '');
                if (txt) { bridge.copyText(txt); return true; }
            }
            return orig.apply(document, arguments);
        };
    })(document.execCommand);

})();
