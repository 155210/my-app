/*
 * 页面-图库.js —— 图库页：缩略图网格（小 / 中 / 大 / 铺满四档），长按弹菜单；
 * 点开看大图：左右滑动换图、双指 / 双击缩放、长按保存，上滑或点「配方」看完整出图配方，下滑关闭；
 * 「读图」：从手机里选一张 NAI 出的图，读出里面藏的提示词和参数（Gallery.readInfo）
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const root = () => $('#view-gallery');
    const ICON_MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
    const ICON_READ = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/></svg>';
    const ICON_INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';

    const mb = (n) => (n < 102400 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB');

    // ------------------------------------------------------------
    // 长按：按住 500ms 不动就触发，并吞掉随后那次 click
    // ------------------------------------------------------------
    function onLongPress(el, pick, cb) {
        let timer = 0, sx = 0, sy = 0, fired = false;
        const stop = () => { clearTimeout(timer); timer = 0; };
        el.addEventListener('pointerdown', (e) => {
            const t = pick(e); if (!t) return;
            fired = false; sx = e.clientX; sy = e.clientY;
            stop();
            timer = setTimeout(() => { timer = 0; fired = true; cb(t, e); }, 500);
        });
        el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) stop(); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => el.addEventListener(n, stop));
        el.addEventListener('click', (e) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
        el.addEventListener('contextmenu', (e) => { if (pick(e)) e.preventDefault(); });
    }

    /** 底部菜单，返回选中的 key 或 null */
    function menu(title, opts) {
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('sheet', '<div class="grip"></div>' + (title ? '<h3>' + esc(title) + '</h3>' : '')
                + opts.map((o) => '<button class="menu-item' + (o.danger ? ' danger' : '') + '" data-k="' + o.k + '">' + (o.icon || '') + esc(o.label) + '</button>').join(''),
            { onClose: () => { if (!done) resolve(null); } });
            L.box.onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; done = true; UI.closeLayer(L, true); resolve(b.dataset.k); };
        });
    }

    async function save(item) {
        try { toast('success', await Gallery.saveToPhone(item), '已保存'); } catch (err) { toast('error', err.message, '保存失败'); }
    }

    async function confirmDelete(item) {
        if (!await UI.confirmBox('删除这张图？', '只删 App 里的，已经存到相册的不受影响。', '删除', true)) return false;
        await Gallery.remove(item.id);
        return true;
    }

    // ------------------------------------------------------------
    // 网格
    // ------------------------------------------------------------
    let gridUrls = [];
    let observer = null;

    async function refresh() {
        const r = root();
        if (!r) return;
        gridUrls.forEach((u) => URL.revokeObjectURL(u));
        gridUrls = [];
        if (observer) observer.disconnect();
        const items = await Gallery.list();
        const p = await Gallery.getPrefs();
        if (!items.length) {
            r.innerHTML = '<div class="empty"><b>还没有图</b>在「创作」里出的图会自动存在这里'
                + '<div class="btns" style="justify-content:center"><button class="btn" id="g-read">读取图片信息</button></div></div>';
            $('#g-read', r).onclick = pickAndRead;
            return;
        }
        const total = items.reduce((a, x) => a + (x.bytes || 0), 0);
        const full = p.size === 'full';
        r.innerHTML = '<div class="g-bar"><span class="card-sub">共 ' + items.length + ' 张' + (total ? ' · ' + mb(total) : '') + '</span>'
            + '<div class="seg" id="g-size">' + Gallery.SIZES.map(([k, t]) => '<button data-v="' + k + '"' + (k === p.size ? ' class="on"' : '') + '>' + t + '</button>').join('') + '</div>'
            + '<button class="icon-btn" id="g-read" aria-label="读取图片信息">' + ICON_READ + '</button>'
            + '<button class="icon-btn" id="g-opts" aria-label="图库选项">' + ICON_MORE + '</button></div>'
            + '<div class="grid size-' + p.size + '">' + items.map((x) => {
                const m = x.meta || {};
                const ar = full && m.width && m.height ? ' style="aspect-ratio:' + m.width + '/' + m.height + '"' : '';
                return '<button class="thumb" data-id="' + x.id + '"' + ar + '>'
                    + (x.thumb ? '<img src="' + x.thumb + '" alt="" draggable="false">' : '<span>' + esc(x.ext) + '</span>') + '</button>';
            }).join('') + '</div>';
        const grid = r.querySelector('.grid');
        grid.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openViewer(b.dataset.id); };
        onLongPress(grid, (e) => e.target.closest && e.target.closest('[data-id]'), (b) => thumbMenu(b.dataset.id));
        $('#g-size', r).onclick = async (e) => {
            const b = e.target.closest('[data-v]'); if (!b) return;
            await Gallery.setPrefs({ size: b.dataset.v });
            refresh();
        };
        $('#g-opts', r).onclick = openOptions;
        $('#g-read', r).onclick = pickAndRead;
        // 大 / 铺满：缩略图不够清楚，滚到眼前时换成原图
        if ((p.size === 'l' || full) && 'IntersectionObserver' in window) {
            observer = new IntersectionObserver((ents) => ents.forEach(async (en) => {
                if (!en.isIntersecting) return;
                observer.unobserve(en.target);
                const blob = await Gallery.getBlob(en.target.dataset.id);
                const img = en.target.querySelector('img');
                if (!blob || !img) return;
                const u = URL.createObjectURL(blob);
                gridUrls.push(u);
                img.src = u;
            }), { rootMargin: '300px 0px' });
            r.querySelectorAll('.thumb').forEach((t) => observer.observe(t));
        }
    }

    async function thumbMenu(id) {
        const item = (await Gallery.list()).find((x) => x.id === id);
        if (!item) return;
        const k = await menu('', [
            { k: 'save', label: '存到相册', icon: UI.ICON.save },
            { k: 'recipe', label: '看配方', icon: ICON_INFO },
            { k: 'read', label: '读图片里藏的信息', icon: ICON_READ },
            { k: 'copy', label: '复制正面', icon: UI.ICON.copy },
            { k: 'del', label: '删除', icon: UI.ICON.del, danger: true },
        ]);
        if (k === 'save') save(item);
        if (k === 'recipe') openRecipe(item);
        if (k === 'read') readItem(item);
        if (k === 'copy') UI.copyText((item.meta || {}).positive || item.tag);
        if (k === 'del' && await confirmDelete(item)) refresh();
    }

    async function openOptions() {
        const p = await Gallery.getPrefs();
        const items = await Gallery.list();
        const pngs = items.filter((x) => String(x.ext).toLowerCase() === 'png');
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>图库选项</h3>'
            + '<label class="check"><span class="switch"><input type="checkbox" id="g-jpg"' + (p.jpg ? ' checked' : '') + '><span></span></span>'
            + '<span>新图自动转存成 JPG<div class="help">NAI 回的是 PNG，一张 1~2 MB；转成 JPG 大约省一半以上，肉眼看不出差别。App 里的配方另外存着不受影响，'
            + '<b>但 JPG 里没有 NAI 的出图信息了，拖回 NovelAI 官网、或用「读取图片信息」都读不出提示词。</b>想留着这个就别开。</div></span></label>'
            + '<div class="field"><label>JPG 质量</label><select id="g-q">'
            + [[0.8, '80（更省空间）'], [0.9, '90'], [0.92, '92（默认）'], [0.95, '95'], [0.98, '98（更清楚）']].map(([v, t]) => '<option value="' + v + '"' + (Math.abs(p.quality - v) < 1e-6 ? ' selected' : '') + '>' + t + '</option>').join('')
            + '</select></div>'
            + '<div class="card"><div class="card-title">已有的 PNG：' + pngs.length + ' 张</div>'
            + '<div class="card-sub">' + (pngs.length ? '一共 ' + mb(pngs.reduce((a, x) => a + (x.bytes || 0), 0)) + '，可以一次全转成 JPG。' : '没有要转的。') + '</div>'
            + '<div class="btns"><button class="btn" id="g-conv"' + (pngs.length ? '' : ' disabled') + '>全部转成 JPG</button></div></div>'
            + '<div class="btns"><button class="btn primary" data-close>好</button></div>');
        $('#g-jpg', L.box).onchange = (e) => Gallery.setPrefs({ jpg: e.target.checked });
        $('#g-q', L.box).onchange = (e) => Gallery.setPrefs({ quality: Number(e.target.value) });
        $('#g-conv', L.box).onclick = async (e) => {
            const b = e.target;
            if (!await UI.confirmBox('全部转成 JPG？', '能省不少空间，但转完的图里就没有 NAI 的出图信息了（拖回官网读不出提示词），转了改不回来。App 里的配方不受影响。', '转换')) return;
            b.disabled = true;
            const r = await Gallery.convertAll((i, n) => { b.textContent = '转换中 ' + i + '/' + n; });
            b.textContent = '转好了';
            toast('success', '转了 ' + r.n + ' 张，省下 ' + mb(r.saved));
            refresh();
        };
    }

    // ------------------------------------------------------------
    // 完整配方
    // ------------------------------------------------------------
    const KNOWN = ['positive', 'negative', 'width', 'height', 'seed', 'model', 'sampler', 'steps', 'scale', 'size', 'cfgRescale', 'noiseSchedule', 'style'];

    function recipeText(item) {
        const m = item.meta || {};
        const rows = [
            ['模型', Params.modelLabel(m.model)],
            ['画风模板', m.style],
            ['尺寸', m.width && m.height ? m.width + '×' + m.height : ''],
            ['画幅', { portrait: '竖图', landscape: '横图', square: '方图' }[m.size] || m.size],
            ['种子', m.seed],
            ['采样器', m.sampler],
            ['步数', m.steps],
            ['CFG', m.scale],
            ['CFG Rescale', m.cfgRescale],
            ['噪声调度', m.noiseSchedule],
            ['出图时间', new Date(item.time).toLocaleString()],
            ['文件', String(item.ext || '').toUpperCase() + (item.origExt ? '（原 ' + item.origExt.toUpperCase() + '，已转存）' : '') + (item.bytes ? '，' + mb(item.bytes) : '')],
        ].filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '');
        const extra = {};
        Object.keys(m).forEach((k) => { if (!KNOWN.includes(k)) extra[k] = m[k]; });
        const blocks = [
            ['中文描述', item.desc],
            ['AI 写的标签', item.tag],
            ['英文描述', item.nl],
            ['AI 补的负面词', item.extraNegative],
            ['正面（实际发送）', m.positive],
            ['负面（实际发送）', m.negative],
            ['参数', rows.map((r) => r[0] + '：' + r[1]).join('\n')],
        ];
        if (Object.keys(extra).length) blocks.push(['其他参数', JSON.stringify(extra, null, 2)]);
        return blocks.filter((b) => String(b[1] == null ? '' : b[1]).trim());
    }

    function openRecipe(item, onReuse) {
        const blocks = recipeText(item);
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>出图配方</h3>'
            + blocks.map((b, i) => '<div class="label row"><span class="grow">' + esc(b[0]) + '</span><button class="btn small" data-copy="' + i + '">复制</button></div>'
                + '<pre class="recipe">' + esc(b[1]) + '</pre>').join('')
            + '<div class="btns"><button class="btn" data-a="all">复制全部</button><button class="btn" data-a="seed">复制种子</button>'
            + '<button class="btn primary" data-a="reuse">用这套重画</button></div>');
        L.box.onclick = (e) => {
            const c = e.target.closest('[data-copy]');
            if (c) { UI.copyText(blocks[+c.dataset.copy][1]); return; }
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'all') UI.copyText(blocks.map((x) => '【' + x[0] + '】\n' + x[1]).join('\n\n'));
            if (b.dataset.a === 'seed') UI.copyText(String((item.meta || {}).seed));
            if (b.dataset.a === 'reuse') {
                UI.closeLayer(L);
                if (onReuse) onReuse();
                CreatePage.reuse(item);
            }
        };
        return L;
    }


    // ------------------------------------------------------------
    // 读取图片信息：NAI PNG 里藏的提示词和参数
    // ------------------------------------------------------------
    function pickAndRead() {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/png,image/*';
        inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) showInfo(f, f.name); };
        inp.click();
    }

    async function readItem(item) {
        const blob = await Gallery.getBlob(item.id);
        if (!blob) { toast('error', '原图找不到了'); return; }
        showInfo(blob, Gallery.fileName(item));
    }

    /** 把读出来的提示词拆回创作页的格式：去掉当前画风的前缀 / 后缀 / 负面、质量词、模型默认负面词，免得重画时又叠一遍 */
    function toDraft(info) {
        const nai = UI.settings.nai;
        const st = (Nai.activeStyle && Nai.activeStyle(nai)) || {};
        const clean = (x) => String(x || '').trim().replace(/^,+|,+$/g, '').trim();
        const cutHead = (t, h) => (h && t.startsWith(h) ? t.slice(h.length).replace(/^\s*,\s*/, '') : t);
        const cutTail = (t, h) => (h && t.endsWith(h) ? t.slice(0, t.length - h.length).replace(/\s*,\s*$/, '') : t);
        let tag = info.prompt.trim(), nl = '';
        const q = clean(Params.qualityOf(nai));
        const qi = q ? tag.lastIndexOf(q) : -1;
        if (qi >= 0) {
            const rest = tag.slice(qi + q.length);
            if (!rest || rest.startsWith('. ')) { nl = rest.slice(2); tag = tag.slice(0, qi).replace(/\s*,\s*$/, ''); }
        }
        tag = cutTail(cutHead(tag, clean(st.prefix)), clean(st.suffix));
        let neg = cutHead(cutHead(info.negative.trim(), clean(Params.negativeOf(nai))), clean(st.negative));
        const p = info.params;
        return { desc: '', tag, nl, extraNegative: neg, meta: { size: p.width > p.height ? 'landscape' : 'portrait' } };
    }

    async function showInfo(blob, name) {
        let info;
        try { info = await Gallery.readInfo(blob); } catch (e) { info = null; }
        if (!info) {
            UI.confirmBox('这张图里没读到出图信息', (name ? name + '\n' : '') + '只有 NAI 直接出的 PNG 原图才带。转成 JPG、截图、或者发过微信 / QQ 的图，信息已经被去掉了。', '知道了');
            return;
        }
        const p = info.params;
        const rows = [
            ['尺寸', p.width && p.height ? p.width + '×' + p.height : ''],
            ['种子', p.seed], ['采样器', p.sampler], ['步数', p.steps], ['CFG', p.scale],
            ['CFG Rescale', p.cfg_rescale], ['噪声调度', p.noise_schedule],
            ['图生图强度', p.strength], ['软件', info.software], ['模型', info.source],
            ['信息藏在', info.from],
        ].filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '');
        const blocks = [['正面提示词', info.prompt], ['负面提示词', info.negative]];
        info.chars.forEach((c, i) => {
            blocks.push(['角色 ' + (i + 1) + ' 正面', c.prompt]);
            if (c.negative) blocks.push(['角色 ' + (i + 1) + ' 负面', c.negative]);
        });
        blocks.push(['参数', rows.map((r) => r[0] + '：' + r[1]).join('\n')]);
        const shown = blocks.filter((b) => String(b[1] == null ? '' : b[1]).trim());
        const L = UI.openLayer('sheet', '<div class="grip"></div><h3>图片信息</h3>'
            + (name ? '<div class="card-sub" style="margin:-6px 0 10px">' + esc(name) + '</div>' : '')
            + shown.map((b, i) => '<div class="label row"><span class="grow">' + esc(b[0]) + '</span><button class="btn small" data-copy="' + i + '">复制</button></div>'
                + '<pre class="recipe">' + esc(b[1]) + '</pre>').join('')
            + '<div class="btns"><button class="btn" data-a="seed"' + (p.seed === undefined ? ' disabled' : '') + '>复制种子</button>'
            + '<button class="btn primary" data-a="use">填到创作页</button></div>');
        L.box.onclick = (e) => {
            const c = e.target.closest('[data-copy]');
            if (c) { UI.copyText(String(shown[+c.dataset.copy][1])); return; }
            const b = e.target.closest('[data-a]'); if (!b) return;
            if (b.dataset.a === 'seed') UI.copyText(String(p.seed));
            if (b.dataset.a === 'use') {
                UI.closeLayer(L);
                // 从大图里读的，连大图一起关掉
                while (UI.$('#layers').lastElementChild) UI.closeLayer();
                CreatePage.reuse(toDraft(info));
            }
        };
    }

    // ------------------------------------------------------------
    // 大图
    // ------------------------------------------------------------
    async function openViewer(id) {
        const items = await Gallery.list();
        let idx = items.findIndex((x) => x.id === id);
        if (idx < 0) return;
        let url = '';
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b data-title></b><span class="badge" data-count></span></div>'
            + '<div class="viewer"><div class="v-stage"><img data-img alt="" draggable="false"></div>'
            + '<div class="v-tip" data-tip>左右滑换图 · 双指或双击放大 · 长按保存 · 上滑看配方</div>'
            + '<div class="acts big">'
            + '<button data-a="save">' + UI.ICON.save + '存到相册</button>'
            + '<button data-a="recipe">' + ICON_INFO + '配方</button>'
            + '<button data-a="reuse">' + UI.ICON.reuse + '用这套重画</button>'
            + '<button data-a="copy">' + UI.ICON.copy + '复制正面</button>'
            + '<button data-a="del" class="danger">' + UI.ICON.del + '删除</button></div></div>',
        { onClose: () => { if (url) URL.revokeObjectURL(url); document.removeEventListener('keydown', onKey); } });
        const stage = $('.v-stage', L.box), img = $('[data-img]', L.box);
        const cur = () => items[idx];
        const close = () => UI.closeLayer(L);

        // 缩放状态：transform-origin 左上角，translate(x,y) scale(s)
        const z = { s: 1, x: 0, y: 0 };
        const apply = (anim) => {
            img.style.transition = anim ? 'transform .18s' : 'none';
            img.style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')';
            stage.classList.toggle('zoomed', z.s > 1);
        };
        const clampZ = () => {
            const W = stage.clientWidth, H = stage.clientHeight;
            z.s = Math.min(5, Math.max(1, z.s));
            z.x = Math.min(0, Math.max(W - W * z.s, z.x));
            z.y = Math.min(0, Math.max(H - H * z.s, z.y));
        };
        const resetZ = (anim) => { z.s = 1; z.x = 0; z.y = 0; apply(anim); };
        /** 以屏幕上 (cx,cy) 为中心缩放到 s */
        const zoomAt = (s, cx, cy, anim) => {
            const r = stage.getBoundingClientRect();
            const px = (cx - r.left - z.x) / z.s, py = (cy - r.top - z.y) / z.s;
            z.s = s; z.x = cx - r.left - px * s; z.y = cy - r.top - py * s;
            clampZ(); apply(anim);
        };

        async function load(i) {
            idx = i;
            const item = cur();
            const blob = await Gallery.getBlob(item.id);
            if (url) URL.revokeObjectURL(url);
            url = blob ? URL.createObjectURL(blob) : '';
            img.src = url || item.thumb || '';
            resetZ(false);
            $('[data-title]', L.box).textContent = new Date(item.time).toLocaleString();
            $('[data-count]', L.box).textContent = (idx + 1) + ' / ' + items.length;
        }

        /** 换到上一张(-1) / 下一张(1)，带滑动动画；到头了弹回去 */
        function go(dir) {
            const j = idx + dir;
            const W = stage.clientWidth;
            if (j < 0 || j >= items.length) {
                img.style.transition = 'transform .18s';
                img.style.transform = 'translateX(0)';
                if (dir) toast('info', dir < 0 ? '已经是最新的一张' : '已经是最后一张');
                return;
            }
            img.style.transition = 'transform .15s';
            img.style.transform = 'translateX(' + (-dir * W) + 'px)';
            setTimeout(async () => {
                await load(j);
                img.style.transition = 'none';
                img.style.transform = 'translateX(' + (dir * W * 0.4) + 'px)';
                void img.offsetWidth;
                img.style.transition = 'transform .15s';
                img.style.transform = 'translateX(0)';
            }, 150);
        }

        function onKey(e) {
            if (UI.$('#layers').lastElementChild !== L.el) return;
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
        }
        document.addEventListener('keydown', onKey);

        // ---- 手势 ----
        const pts = new Map();
        let g = null;          // 当前手势：{ mode: tap/pan/h/v/pinch, sx, sy, bx, by, ... }
        let longTimer = 0, lastTap = null, tapTimer = 0;
        const hideTip = () => { const t = $('[data-tip]', L.box); if (t) t.remove(); };

        const startSingle = (p) => { g = { mode: 'tap', sx: p.x, sy: p.y, bx: z.x, by: z.y, t: Date.now() }; };
        stage.addEventListener('pointerdown', (e) => {
            try { stage.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件抓不了，无所谓 */ }
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            clearTimeout(longTimer);
            if (pts.size === 1) {
                startSingle(pts.get(e.pointerId));
                longTimer = setTimeout(() => { if (g && g.mode === 'tap') { g.mode = 'long'; longMenu(); } }, 550);
            } else if (pts.size === 2) {
                const [a, b] = [...pts.values()];
                g = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: z.s };
            }
        });
        stage.addEventListener('pointermove', (e) => {
            if (!pts.has(e.pointerId) || !g) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (g.mode === 'pinch' && pts.size >= 2) {
                const [a, b] = [...pts.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                zoomAt(Math.min(5, Math.max(1, g.s0 * d / g.d0)), (a.x + b.x) / 2, (a.y + b.y) / 2, false);
                // 缩放中心跟着手指走：下一帧以当前比例为基准
                g.s0 = z.s; g.d0 = d;
                return;
            }
            const p = pts.get(e.pointerId);
            const dx = p.x - g.sx, dy = p.y - g.sy;
            if (g.mode === 'tap' && Math.hypot(dx, dy) > 10) {
                clearTimeout(longTimer);
                g.mode = z.s > 1 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
                hideTip();
            }
            if (g.mode === 'pan') {
                z.x = g.bx + dx; z.y = g.by + dy; clampZ(); apply(false);
            } else if (g.mode === 'h') {
                const edge = (dx > 0 && idx === 0) || (dx < 0 && idx === items.length - 1);
                img.style.transition = 'none';
                img.style.transform = 'translateX(' + (edge ? dx / 3 : dx) + 'px)';
            } else if (g.mode === 'v') {
                img.style.transition = 'none';
                img.style.transform = 'translateY(' + dy / 2 + 'px)';
                img.style.opacity = dy > 0 ? String(Math.max(0.4, 1 - dy / 400)) : '';
            }
        });
        const end = (e) => {
            if (!pts.has(e.pointerId)) return;
            const p = pts.get(e.pointerId);
            pts.delete(e.pointerId);
            clearTimeout(longTimer);
            if (!g) return;
            if (g.mode === 'pinch') {
                // 松开一根手指：剩下那根接着拖
                if (pts.size === 1) { startSingle([...pts.values()][0]); g.mode = 'pan'; }
                else { g = null; if (z.s < 1.05) resetZ(true); }
                return;
            }
            if (pts.size) return;
            const dx = p.x - g.sx, dy = p.y - g.sy, mode = g.mode;
            g = null;
            img.style.opacity = '';
            if (e.type === 'pointercancel') { if (z.s === 1) resetZ(true); return; }
            if (mode === 'h') {
                if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
                else go(0);
            } else if (mode === 'v') {
                resetZ(true);
                if (dy < -60) openRecipe(cur(), close);
                else if (dy > 90) close();
            } else if (mode === 'tap') {
                const now = Date.now();
                if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
                    clearTimeout(tapTimer);
                    lastTap = null;
                    if (z.s > 1) resetZ(true); else zoomAt(2.5, p.x, p.y, true);
                } else {
                    lastTap = { t: now, x: p.x, y: p.y };
                    tapTimer = setTimeout(() => { lastTap = null; L.box.classList.toggle('bare'); }, 300);
                }
            }
        };
        stage.addEventListener('pointerup', end);
        stage.addEventListener('pointercancel', end);
        stage.addEventListener('contextmenu', (e) => e.preventDefault());
        stage.addEventListener('wheel', (e) => { // 电脑上调试用
            e.preventDefault();
            zoomAt(z.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY, false);
        }, { passive: false });

        async function longMenu() {
            const k = await menu('', [
                { k: 'save', label: '存到相册', icon: UI.ICON.save },
                { k: 'copy', label: '复制正面', icon: UI.ICON.copy },
                { k: 'recipe', label: '看配方', icon: ICON_INFO },
                { k: 'read', label: '读图片里藏的信息', icon: ICON_READ },
            ]);
            if (k === 'save') save(cur());
            if (k === 'copy') UI.copyText((cur().meta || {}).positive || cur().tag);
            if (k === 'recipe') openRecipe(cur(), close);
            if (k === 'read') readItem(cur());
        }

        $('.acts', L.box).onclick = async (e) => {
            const b = e.target.closest('button'); if (!b) return;
            const a = b.dataset.a, item = cur();
            if (a === 'save') save(item);
            else if (a === 'recipe') openRecipe(item, close);
            else if (a === 'copy') UI.copyText((item.meta || {}).positive || item.tag);
            else if (a === 'reuse') { close(); CreatePage.reuse(item); }
            else if (a === 'del') {
                if (!await confirmDelete(item)) return;
                refresh();
                if (!items.length) { close(); return; }
                load(Math.min(idx, items.length - 1));
            }
        };

        await load(idx);
    }

    window.GalleryPage = { refresh, openViewer, openRecipe, showInfo };
})();
