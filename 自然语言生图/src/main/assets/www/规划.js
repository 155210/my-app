/*
 * 规划.js —— 一段描述拆成多张图（照柏宝绘「按画面节奏规划多张」）：AI 拆好的结果卡片
 *
 * 创作页「拆成 N 张」选了以后点「AI 拆成多张」，Writer.run({ plan }) 回来的 images 交给 Planner.show。
 * 卡片在创作页提示词下面（#c-plan-box）：每张可以「填到上面」改了再出，也可以「出这张」，或者「全部出图」。
 * 结果存在 Store 的 plan 键（{ desc, images, time }），重开 App 还在。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    let plan = null;

    function save() { Store.set('plan', plan).catch(() => {}); }

    const toP = (im) => ({ desc: im.desc ? plan.desc + '（' + im.desc + '）' : plan.desc, tag: im.tag, nl: im.nl, negative: im.negative, size: im.size });

    function render() {
        const box = $('#c-plan-box');
        if (!box) return;
        if (!plan || !plan.images || !plan.images.length) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="card" id="c-plan-card"><div class="card-title"><span class="grow" style="flex:1">AI 拆成了 ' + plan.images.length + ' 张</span>'
            + '<button class="btn small primary" data-all>全部出图</button><button class="btn small" data-close-plan>收起</button></div>'
            + '<div class="card-sub">' + esc(plan.desc.slice(0, 80)) + '</div>'
            + plan.images.map((im, i) => '<div class="plan-item" data-i="' + i + '">'
                + '<div class="row"><b class="grow">第 ' + (i + 1) + ' 张 <span class="badge">' + (im.size === 'landscape' ? '横图' : '竖图') + '</span>'
                + (im.drawn ? ' <span class="badge acc">已出 ' + im.drawn + ' 次</span>' : '') + '</b>'
                + '<button class="btn small" data-fill>填到上面</button><button class="btn small" data-one>出这张</button></div>'
                + (im.desc ? '<div class="plan-desc">' + esc(im.desc) + '</div>' : '')
                + '<div class="plan-tag">' + esc(im.tag) + '</div></div>').join('')
            + '</div>';
        $('[data-all]', box).onclick = drawAll;
        $('[data-close-plan]', box).onclick = () => { plan = null; save(); render(); };
        UI.$$('.plan-item', box).forEach((el) => {
            const i = Number(el.dataset.i);
            $('[data-fill]', el).onclick = () => { CreatePage.reuse(toP(plan.images[i]), true); toast('info', '第 ' + (i + 1) + ' 张填到上面了，可以改了再出图或者让 AI 重写'); };
            $('[data-one]', el).onclick = () => drawOne(i);
            $('.plan-tag', el).onclick = (e) => e.currentTarget.classList.toggle('open');
        });
    }

    function drawOne(i) {
        const im = plan.images[i];
        const jobs = CreatePage.draw(Object.assign(toP(im), { label: '第 ' + (i + 1) + ' 张 · ' + (im.desc || plan.desc).slice(0, 18) }));
        if (!jobs) return false;
        im.drawn = (im.drawn || 0) + 1;
        save();
        render();
        return true;
    }

    /** 按顺序全部排进出图队列（每张按创作页选的「几张」出） */
    function drawAll() {
        if (!plan) return;
        let n = 0;
        for (let i = 0; i < plan.images.length; i++) if (drawOne(i)) n++;
        if (n) toast('info', n + ' 张排进出图队列了');
    }

    function show(desc, images) {
        plan = { desc: String(desc || '').trim(), images: images.map((x) => ({ desc: x.desc || '', tag: x.tag, nl: x.nl, negative: x.negative, size: x.size })), time: Date.now() };
        save();
        render();
        const card = $('#c-plan-card');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    const css = document.createElement('style');
    css.textContent = '.plan-item{border-top:1px solid var(--line);margin-top:10px;padding-top:8px}'
        + '.plan-item b{font-weight:600;font-size:14px}.plan-desc{font-size:13px;color:var(--text);margin-top:4px}'
        + '.plan-tag{font-size:12px;color:var(--faint);margin-top:2px;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
        + '.plan-tag.open{display:block}#c-plan-card .card-title .btn{flex:none}';
    document.head.appendChild(css);

    const init = CreatePage.init;
    CreatePage.init = async function () {
        await init.apply(this, arguments);
        plan = await Store.get('plan', null);
        render();
    };

    window.Planner = { show, drawAll, drawOne, get: () => plan };
})();
