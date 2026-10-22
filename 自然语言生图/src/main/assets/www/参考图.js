/*
 * 参考图.js —— Vibe Transfer 画风参考：加几张参考图，每张单独调强度、信息提取量，可开关
 *
 * 设置里 nai.vibes 只存小的索引 { id, name, on, strength 强度, info 信息提取量 }，
 * 图和编码存在 vibe:<id> 键里：{ image 原图 base64, thumb 缩略图 dataURL, enc: [{ key 模型分组, info, data 编码 base64 }] }。
 *
 * NAI 的规矩（照柏宝绘 backends/nai.ts）：
 *   V3 直接发原图：reference_image_multiple + reference_information_extracted_multiple + reference_strength_multiple
 *   V4 起要先 POST /ai/encode-vibe 编码（按模型分组、按信息提取量各算一份，官方每次编码扣 2 Anlas），
 *   出图时编码放进 reference_image_multiple_cached，强度进 reference_strength_multiple（总和超过 1 由 NAI 自动按比例压回）
 * 编码是异步的：包一层 Nai.generate，出图前先把缺的编码补上；拼请求那一步（Nai.addHook）只读已有的。
 * .naiv4vibe 和官网互通，能导入导出。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const nai = () => UI.settings.nai;
    const VIBE_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f'; // 官方文件里编码的固定内层键
    const MAX_SIDE = 1536; // 加图时太大的先缩小
    const cache = new Map(); // id → vibe:<id> 的内容

    /** 编码按模型分组的键（和官方 .naiv4vibe 一致） */
    function modelKey(model) {
        const m = String(model);
        if (m.includes('nai-diffusion-5-curated')) return 'v5curated';
        if (m.includes('nai-diffusion-5-full')) return 'v5full';
        if (m.includes('4-5-curated')) return 'v4-5curated';
        if (m.includes('4-5-full')) return 'v4-5full';
        if (m.includes('4-curated')) return 'v4curated';
        if (m.includes('4-full')) return 'v4full';
        return 'v3';
    }
    const KEY_LABEL = { v5full: 'V5 Full', v5curated: 'V5 Curated', 'v4-5full': 'V4.5 Full', 'v4-5curated': 'V4.5 Curated', v4full: 'V4 Full', v4curated: 'V4 Curated', v3: 'V3' };

    const clamp = (v, def, lo) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? Math.min(1, Math.max(lo || 0, n)) : def; };
    const round2 = (n) => Math.round(n * 100) / 100;
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

    async function load(id) {
        if (cache.has(id)) return cache.get(id);
        const d = await Store.get('vibe:' + id, null);
        if (d) cache.set(id, d);
        return d;
    }
    async function store(id, d) { cache.set(id, d); await Store.set('vibe:' + id, d); }

    /** 这张参考图在这个模型、这个信息提取量下能用的编码；导入的文件没原图时，同模型别的提取量也凑合用 */
    function findEnc(d, key, info) {
        const same = (d.enc || []).filter((e) => e.key === key);
        return same.find((e) => Math.abs(e.info - info) < 0.005) || (d.image ? null : same[0]) || null;
    }

    // ------------------------------------------------------------
    // 编码（V4 起）
    // ------------------------------------------------------------
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

    async function encode(n, image, info, signal) {
        if (!String(n.key || '').trim()) throw new Error('请先在设置里填 NAI 的 Key');
        const r = await fetch(Nai.endpoint(n.url, 'encode-vibe'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + n.key.trim() },
            body: JSON.stringify({ image, information_extracted: info, model: n.model }),
            signal,
        });
        if (!r.ok) {
            const t = (await r.text().catch(() => '')).trim();
            const e = new Error(r.status === 429 ? '参考图编码：请求太频繁（429）' : r.status === 401 ? '参考图编码：NAI 的 Key 不对或已失效' : '参考图编码失败（' + r.status + '）：' + t.slice(0, 200));
            e.status = r.status;
            throw e;
        }
        const u8 = new Uint8Array(await r.arrayBuffer());
        if (u8.length < 100) throw new Error('参考图编码结果不对（只有 ' + u8.length + ' 字节），可能是地址填错了');
        return b64(u8);
    }

    const pending = new Map(); // 同一张图同时排了好几张，只编码一次
    function encodeOnce(n, v, d, key, signal) {
        const k = v.id + '|' + key + '|' + v.info;
        if (!pending.has(k)) {
            pending.set(k, (async () => {
                const data = await encode(n, d.image, v.info, signal);
                d.enc = (d.enc || []).filter((e) => !(e.key === key && Math.abs(e.info - v.info) < 0.005)).concat([{ key, info: v.info, data }]);
                await store(v.id, d);
                costChanged();
                toast('info', '「' + v.name + '」已编码（' + KEY_LABEL[key] + '，信息提取量 ' + v.info + '），以后不再扣');
                render();
            })().finally(() => pending.delete(k)));
        }
        return pending.get(k);
    }

    /** 出图前：读出要用的参考图，缺编码的补上 */
    async function prepare(n, signal) {
        if (blocked(n)) return; // 用着角色参考（精准参考）时参考图不发，也就不用编码
        const v3 = Params.isV3(n.model), key = modelKey(n.model);
        for (const v of (n.vibes || []).filter((x) => x.on !== false)) {
            const d = await load(v.id);
            if (!d) throw new Error('参考图「' + v.name + '」的数据找不到了，删掉重新加');
            if (v3) {
                if (!d.image) throw new Error('参考图「' + v.name + '」是导入的编码文件，没带原图，V3 用不了；关掉它或者换模型');
                continue;
            }
            if (findEnc(d, key, v.info)) continue;
            if (!d.image) throw new Error('参考图「' + v.name + '」没有 ' + KEY_LABEL[key] + ' 的编码，也没带原图没法重新编码；关掉它或者换模型');
            await encodeOnce(n, v, d, key, signal);
        }
    }

    /** V4.5 开了角色参考（精准参考）时，官网会把 Vibe 藏起来：两个一起发 NAI 会回坏图。见 角色参考.js */
    // V5 官方没有 Vibe（网页端不发，/ai/encode-vibe 也拒绝 V5），V5 下整块跳过
    const blocked = (n) => Params.isV5(n.model) || !!(window.DirectorRef && DirectorRef.blocksVibes(n));

    /** 要花的 Anlas（给出图按钮上的预估）：没编码过的每张首次编码 2；一次用超过 4 张，第 5 张起每张图每张参考 +2 */
    function cost(n) {
        if (blocked(n) || Params.isV3(n.model)) return null;
        const on = (n.vibes || []).filter((x) => x.on !== false);
        if (!on.length) return null;
        const key = modelKey(n.model);
        const fresh = on.filter((v) => { const d = cache.get(v.id); return d && d.image && !findEnc(d, key, v.info); }).length;
        const perImage = Math.max(0, on.length - 4) * 2, once = fresh * 2;
        return perImage || once ? { perImage, once, label: '画风参考图' } : null;
    }
    if (window.Cost && Cost.addExtra) Cost.addExtra((n) => cost(n));
    const costChanged = () => { if (window.Cost && Cost.refresh) Cost.refresh(); };

    const generate = Nai.generate;
    Nai.generate = async function (n, p, signal) {
        await prepare(n, signal);
        return generate.apply(this, arguments);
    };

    Nai.addHook((params, n, p, extra) => {
        const on = (n.vibes || []).filter((x) => x.on !== false);
        if (!on.length || blocked(n)) return;
        const v3 = Params.isV3(n.model), key = modelKey(n.model);
        const used = [];
        for (const v of on) {
            const d = cache.get(v.id);
            if (!d) continue;
            if (v3) {
                if (!d.image) continue;
                params.reference_image_multiple.push(d.image);
                params.reference_information_extracted_multiple.push(v.info);
            } else {
                const e = findEnc(d, key, v.info);
                if (!e) continue; // 还没编码（只在「实际发送」预览时会遇到，真出图前 prepare 已补上）
                params.reference_image_multiple_cached.push({ cache_secret_key: uuid(), data: e.data });
            }
            params.reference_strength_multiple.push(v.strength);
            used.push({ name: v.name, strength: v.strength, info: v.info });
        }
        if (used.length) extra.vibes = used;
    });

    // ------------------------------------------------------------
    // 加图 / 导入 / 导出
    // ------------------------------------------------------------
    function readImage(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('读不出这张图')); };
            img.src = url;
        });
    }
    function draw(img, side, type, q) {
        const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s));
        c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const g = c.getContext('2d');
        if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL(type, q);
    }
    const dataPart = (u) => u.slice(u.indexOf(',') + 1);

    async function fromImage(blob, name) {
        const img = await readImage(blob);
        // 不大的 PNG 原样留着；太大的或别的格式统一转成 PNG
        let image;
        if (blob.type === 'image/png' && Math.max(img.naturalWidth, img.naturalHeight) <= MAX_SIDE) image = b64(new Uint8Array(await blob.arrayBuffer()));
        else image = dataPart(draw(img, MAX_SIDE, 'image/png'));
        return { name: name || '参考图', strength: 0.6, info: 1, data: { image, thumb: draw(img, 160, 'image/jpeg', 0.8), enc: [] } };
    }

    /** 解析官网的 .naiv4vibe（JSON） */
    function fromVibeFile(text) {
        let j;
        try { j = JSON.parse(text); } catch (e) { throw new Error('不是图片，也不是 .naiv4vibe 文件'); }
        if (!j || j.identifier !== 'novelai-vibe-transfer') throw new Error('不是 NovelAI 的 Vibe 文件');
        const enc = [];
        Object.keys(j.encodings || {}).forEach((key) => {
            Object.values(j.encodings[key] || {}).forEach((x) => {
                if (x && typeof x.encoding === 'string' && x.encoding) enc.push({ key, info: clamp(x.params && x.params.information_extracted, 1), data: x.encoding });
            });
        });
        const image = typeof j.image === 'string' ? dataPart(j.image) : '';
        if (!enc.length && !image) throw new Error('这个 Vibe 文件里没有编码也没有原图');
        const imp = j.importInfo || {};
        return {
            name: (typeof j.name === 'string' && j.name) || '导入的参考图',
            strength: clamp(imp.strength, 0.6),
            info: clamp(imp.information_extracted, enc.length ? enc[0].info : 1, 0.01),
            data: { image, thumb: typeof j.thumbnail === 'string' ? j.thumbnail : '', enc },
        };
    }

    /** 读一个文件（图片或 .naiv4vibe），存好数据，返回 { id, name, strength, info, hasImage }；不放进创作页 */
    async function importFile(f) {
        const name = String(f.name || '').replace(/\.[^.]+$/, '');
        const head = new Uint8Array(await f.slice(0, 1).arrayBuffer())[0];
        const x = head === 0x7b /* { */ ? fromVibeFile(await f.text()) : await fromImage(f, name);
        if (!x.data.thumb && x.data.image) x.data.thumb = draw(await readImage(new Blob([Uint8Array.from(atob(x.data.image), (c) => c.charCodeAt(0))])), 160, 'image/jpeg', 0.8);
        const id = 'vb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await store(id, x.data);
        const v = { id, name: x.name, strength: round2(x.strength), info: round2(x.info), hasImage: !!x.data.image };
        if (window.VibeLib) VibeLib.adopt(v); // 加过的图都进 Vibe 库
        return v;
    }

    /** 放进创作页的卡片（已经在就打开） */
    function use(v) {
        const list = nai().vibes, had = list.find((x) => x.id === v.id);
        if (had) had.on = true;
        else list.push({ id: v.id, name: v.name, on: true, strength: round2(v.strength), info: round2(v.info) });
        UI.saveSettings();
        load(v.id).catch(() => null).then(() => { render(); costChanged(); });
    }

    async function addFile(f) {
        const v = await importFile(f);
        use(v);
        toast('success', '「' + v.name + '」' + (v.hasImage ? '' : '（只有编码，没带原图）'), '已加画风参考');
    }

    // ------------------------------------------------------------
    // 选图：手机里的文件，或者 App 图库里的一张（角色参考.js 也用）
    // ------------------------------------------------------------
    function pickPhone(accept) {
        return new Promise((resolve) => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = accept || 'image/*';
            inp.onchange = () => resolve((inp.files && inp.files[0]) || null);
            inp.click();
        });
    }

    async function pickGallery() {
        const items = (await Gallery.list()).filter((x) => !window.R18 || R18.visible(x)).slice(0, 90);
        if (!items.length) { toast('info', '图库里还没有图'); return null; }
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('sheet', '<div class="grip"></div><h3>从图库选一张</h3>'
                + '<div class="grid size-s" style="max-height:60vh;overflow-y:auto">' + items.map((x) => '<div class="thumb" data-id="' + esc(x.id) + '"><img src="' + esc(x.thumb) + '" alt=""></div>').join('') + '</div>'
                + '<div class="btns"><button class="btn" data-close>取消</button></div>', { onClose: () => { if (!done) resolve(null); } });
            L.box.querySelector('.grid').onclick = async (e) => {
                const t = e.target.closest('[data-id]'); if (!t) return;
                done = true;
                UI.closeLayer(L, true);
                const it = items.find((x) => x.id === t.dataset.id);
                const blob = await Gallery.getBlob(it.id);
                if (!blob) { toast('error', '原图找不到了'); resolve(null); return; }
                const d = new Date(it.time || Date.now());
                resolve(new File([blob], '图库 ' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + '时' + d.getMinutes() + '分.' + (it.ext || 'png'), { type: blob.type || 'image/png' }));
            };
        });
    }

    /** 先问从哪选，返回 File 或 null */
    function pick(title, phoneLabel, accept) {
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('sheet', '<div class="grip"></div><h3>' + esc(title) + '</h3>'
                + '<div class="btns" style="flex-direction:column;align-items:stretch">'
                + '<button class="btn primary" data-src="phone">从手机选（' + esc(phoneLabel) + '）</button>'
                + '<button class="btn" data-src="gallery">从 App 图库选</button>'
                + '<button class="btn" data-close>取消</button></div>', { onClose: () => { if (!done) resolve(null); } });
            L.box.onclick = (e) => {
                const b = e.target.closest('[data-src]'); if (!b) return;
                done = true;
                UI.closeLayer(L, true);
                // 文件选择框要在点击里直接弹，不能隔一个 await
                resolve(b.dataset.src === 'phone' ? pickPhone(accept || 'image/*,.naiv4vibe,application/json') : pickGallery());
            };
        });
    }
    window.RefPick = { pick, pickPhone, pickGallery };

    /** 导出成官网能导入的 .naiv4vibe（带上所有已编码的模型） */
    async function exportVibe(v) {
        const d = await load(v.id);
        if (!d) { toast('error', '数据找不到了'); return; }
        const encodings = {};
        (d.enc || []).forEach((e, i) => {
            encodings[e.key] = encodings[e.key] || {};
            encodings[e.key][Object.keys(encodings[e.key]).length ? VIBE_KEY.slice(0, 56) + String(i).padStart(8, '0') : VIBE_KEY] = { encoding: e.data, params: { information_extracted: e.info } };
        });
        const first = (d.enc || [])[0];
        const json = JSON.stringify({
            identifier: 'novelai-vibe-transfer', version: 1, type: d.image ? 'image' : 'encoding',
            image: d.image, id: v.id, encodings, name: v.name, thumbnail: d.thumb, createdAt: Date.now(),
            importInfo: { model: first ? first.key : '', information_extracted: v.info, strength: v.strength },
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = (v.name || '参考图').replace(/[\\/:*?"<>|]/g, '_') + '.naiv4vibe';
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (!window.__IN_APP__) toast('success', a.download, '已导出');
    }

    // ------------------------------------------------------------
    // 创作页上的卡片
    // ------------------------------------------------------------
    let card = null;

    function status(v, d) {
        const n = nai();
        if (!d) return '数据找不到了';
        if (Params.isV5(n.model)) return 'V5 官方不支持画风参考图，切到 V4.5 / V4 / V3 才会用上';
        if (blocked(n)) return '正在用角色参考（精准参考），这张先不发';
        if (Params.isV3(n.model)) return d.image ? 'V3 直接发原图' : '没带原图，V3 用不了';
        const key = modelKey(n.model), e = findEnc(d, key, v.info);
        if (e) return KEY_LABEL[key] + ' 已编码' + (Math.abs(e.info - v.info) < 0.005 ? '' : '（文件里只有信息提取量 ' + e.info + ' 的）');
        return d.image ? KEY_LABEL[key] + ' 还没编码：出图时自动编码一次，扣 2 Anlas' : '没有 ' + KEY_LABEL[key] + ' 的编码，换模型或关掉';
    }

    function render() {
        if (!card) return;
        const list = nai().vibes;
        const n = list.filter((x) => x.on !== false).length;
        card.innerHTML = '<div class="row"><div class="label grow" style="margin:0">画风参考图（Vibe）' + (n ? ' <span class="badge acc">' + n + ' 张</span>' : '') + '</div>'
            + (window.VibeLib ? '<button class="btn small" data-a="lib">Vibe 库</button>' : '')
            + '<button class="btn small" data-a="add">加参考图</button></div>'
            + (list.length ? '' : '<div class="card-sub">加一张图让出图模仿它的画风、配色、氛围。可以选手机里的图片，或者官网导出的 .naiv4vibe 文件。</div>')
            + list.map((v, i) => {
                const d = cache.get(v.id);
                return '<div class="vibe-item" data-i="' + i + '">'
                    + '<div class="row">' + (d && d.thumb ? '<img class="vibe-thumb" src="' + esc(d.thumb) + '" alt="">' : '<div class="vibe-thumb"></div>')
                    + '<div class="grow" style="min-width:0"><input type="text" data-f="name" value="' + esc(v.name) + '" placeholder="名字">'
                    + '<div class="card-sub" data-st>' + esc(status(v, d)) + '</div></div>'
                    + '<label class="switch"><input type="checkbox" data-f="on"' + (v.on !== false ? ' checked' : '') + ' aria-label="启用"><span></span></label></div>'
                    + '<div class="vibe-slider"><span>强度</span><input type="range" min="0" max="1" step="0.05" data-f="strength" value="' + v.strength + '"><b>' + v.strength + '</b></div>'
                    + '<div class="vibe-slider"><span>信息提取量</span><input type="range" min="0.05" max="1" step="0.05" data-f="info" value="' + v.info + '"><b>' + v.info + '</b></div>'
                    + '<div class="row" style="justify-content:flex-end"><button class="btn small" data-a="export">导出 .naiv4vibe</button><button class="btn small danger" data-a="del">' + (window.VibeLib && VibeLib.has(v.id) ? '移出' : '删除') + '</button></div>'
                    + '</div>';
            }).join('')
            + (list.length ? '<div class="card-sub">强度：越大越像参考图。信息提取量：越大带过来的细节越多（内容、构图也会跟着像），只想要画风就调低。'
                + (list.length > 1 ? '几张的强度加起来超过 1 时 NAI 会按比例压回。' : '')
                + (n > 4 ? '<br><b>同时开了 ' + n + ' 张：超过 4 张，每出一张图多扣 ' + (n - 4) * 2 + ' Anlas。</b>' : '一次最多 4 张不额外扣 Anlas，第 5 张起每张每次 +2。') + '</div>' : '');
    }

    function bind() {
        card.addEventListener('input', (e) => {
            const f = e.target.dataset.f, box = e.target.closest('[data-i]');
            if (!f || !box) return;
            const v = nai().vibes[Number(box.dataset.i)];
            if (f === 'on') { v.on = e.target.checked; UI.saveSettings(); render(); costChanged(); return; }
            if (f === 'name') { v.name = e.target.value; if (window.VibeLib) VibeLib.rename(v.id, v.name); }
            else {
                v[f] = round2(Number(e.target.value));
                e.target.nextElementSibling.textContent = v[f];
                if (f === 'info') { $('[data-st]', box).textContent = status(v, cache.get(v.id)); costChanged(); }
            }
            UI.saveSettings();
        });
        card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'add') {
                const f = await pick('加画风参考图', '手机里的图片或 .naiv4vibe');
                if (f) addFile(f).catch((err) => toast('error', err.message || String(err), '加参考图失败'));
                return;
            }
            if (b.dataset.a === 'lib') { VibeLib.pick(); return; }
            const i = Number(b.closest('[data-i]').dataset.i), v = nai().vibes[i];
            if (b.dataset.a === 'export') exportVibe(v).catch((err) => toast('error', err.message, '导出失败'));
            if (b.dataset.a === 'del' && window.VibeLib && VibeLib.has(v.id)) {
                nai().vibes.splice(i, 1); // 只从创作页拿掉，图和编码还在 Vibe 库里
                UI.saveSettings();
                render();
                costChanged();
                toast('info', 'Vibe 库里还留着，要用再从库里选', '已移出「' + v.name + '」');
                return;
            }
            if (b.dataset.a === 'del') {
                if (!await UI.confirmBox('删除参考图「' + v.name + '」？', '编码也一起删掉，以后再加要重新编码。', '删除', true)) return;
                nai().vibes.splice(i, 1);
                UI.saveSettings();
                cache.delete(v.id);
                await Store.del('vibe:' + v.id);
                render();
                costChanged();
            }
        });
    }

    async function mount() {
        for (const v of nai().vibes) await load(v.id).catch(() => null);
        const result = $('#c-result');
        if (!result) return;
        card = document.createElement('div');
        card.className = 'card';
        card.id = 'c-vibes';
        result.parentNode.insertBefore(card, result);
        bind();
        render();
    }

    // refresh 很频繁，只在换了模型时重画（编码状态跟模型走）
    const init = CreatePage.init, refresh = CreatePage.refresh;
    let lastModel = null;
    CreatePage.init = async function () { await init.apply(this, arguments); await mount(); lastModel = nai().model; };
    CreatePage.refresh = function () {
        refresh.apply(this, arguments);
        if (nai().model !== lastModel) { lastModel = nai().model; render(); }
    };

    setTimeout(() => {
        if (!window.Help || !Help.add) return;
        Help.add({ id: 'vibes', group: '多角色与参考图', title: '画风参考图（Vibe）', target: '#c-vibes', tip: '让出图模仿一张图的画风',
            anlas: '每张图第一次在某个模型上用要编码一次，扣 2 Anlas；同时开超过 4 张，第 5 张起每张每次 +2',
            text: '加一张图（手机里的、App 图库里的，或官网导出的 .naiv4vibe）。强度越大越像；信息提取量越大带过来的细节越多，只想要画风就调低。V5 官方不支持，开着角色参考时也会暂停。' });
    });

    window.Vibes = { modelKey, prepare, cost, fromVibeFile, addFile, importFile, use, exportVibe, load, render, findEnc, KEY_LABEL, forget: (id) => cache.delete(id), changed: costChanged };
})();
