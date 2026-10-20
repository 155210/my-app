/*
 * 页面-图库.js —— 图库页：缩略图网格；点开看大图和完整出图配方，存相册、复制、用这套重画、删除
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const root = () => $('#view-gallery');

    async function refresh() {
        const r = root();
        if (!r) return;
        const items = await Gallery.list();
        if (!items.length) {
            r.innerHTML = '<div class="empty"><b>还没有图</b>在「创作」里出的图会自动存在这里</div>';
            return;
        }
        r.innerHTML = '<div class="grid">' + items.map((x) => '<button class="thumb" data-id="' + x.id + '">'
            + (x.thumb ? '<img src="' + x.thumb + '" alt="" loading="lazy">' : '<span>' + esc(x.ext) + '</span>') + '</button>').join('') + '</div>';
        r.querySelector('.grid').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openViewer(b.dataset.id); };
    }

    async function openViewer(id) {
        const items = await Gallery.list();
        const item = items.find((x) => x.id === id);
        if (!item) return;
        const blob = await Gallery.getBlob(id);
        const url = blob ? URL.createObjectURL(blob) : item.thumb;
        const m = item.meta || {};
        const d = new Date(item.time);
        const L = UI.openLayer('page', '<div class="page-head"><button class="icon-btn" data-close>' + UI.ICON.back + '</button><b>' + esc(d.toLocaleString()) + '</b></div>'
            + '<div class="page-body viewer">'
            + '<img src="' + url + '" alt="">'
            + '<div class="acts big">'
            + '<button data-a="save">' + UI.ICON.save + '存到相册</button>'
            + '<button data-a="reuse">' + UI.ICON.reuse + '用这套重画</button>'
            + '<button data-a="copy">' + UI.ICON.copy + '复制正面</button>'
            + '<button data-a="del" class="danger">' + UI.ICON.del + '删除</button></div>'
            + (item.desc ? '<div class="label">中文描述</div><pre class="recipe">' + esc(item.desc) + '</pre>' : '')
            + '<div class="label">正面（实际发送）</div><pre class="recipe">' + esc(m.positive) + '</pre>'
            + '<div class="label">负面（实际发送）</div><pre class="recipe">' + esc(m.negative) + '</pre>'
            + '<div class="label">参数</div><pre class="recipe">' + esc([
                '模型：' + Params.modelLabel(m.model),
                '尺寸：' + m.width + '×' + m.height,
                '种子：' + m.seed,
                '采样器：' + m.sampler + '，' + m.steps + ' 步，CFG ' + m.scale,
            ].join('\n')) + '</pre>'
            + '</div>', { onClose: () => { if (blob) URL.revokeObjectURL(url); } });
        $('.acts', L.box).onclick = async (e) => {
            const b = e.target.closest('button'); if (!b) return;
            const a = b.dataset.a;
            if (a === 'save') {
                try { toast('success', await Gallery.saveToPhone(item), '已保存'); } catch (err) { toast('error', err.message, '保存失败'); }
            } else if (a === 'copy') {
                UI.copyText(m.positive || item.tag);
            } else if (a === 'reuse') {
                UI.closeLayer(L);
                CreatePage.reuse(item);
            } else if (a === 'del') {
                if (!await UI.confirmBox('删除这张图？', '只删 App 里的，已经存到相册的不受影响。', '删除', true)) return;
                await Gallery.remove(item.id);
                UI.closeLayer(L);
                refresh();
            }
        };
    }

    window.GalleryPage = { refresh, openViewer };
})();
