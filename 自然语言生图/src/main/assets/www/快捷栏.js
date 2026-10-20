/*
 * 快捷栏.js —— 创作页上的出图快捷设置 + 顶栏常驻的 Anlas 余额
 *
 * 快捷栏：模型、画风模板、尺寸（当前横竖画幅那一格）、锁定种子、V5 透明背景、Furry 模式，改了直接存进设置。
 * 出图按钮（还有拆多张、批量页的出图按钮）上挂预计花多少 Anlas（算法见 计价.js）。
 * 不改 页面-创作.js：包一层 CreatePage.init / refresh，把卡片插在提示词卡片前面。
 * Anlas：启动时查一次，出完图（出图.js 发 nai-drawn 事件）自动刷新，点一下也刷新。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const nai = () => UI.settings.nai;
    let card = null;

    const opts = (list, v) => list.map((x) => '<option value="' + esc(x.value) + '"' + (x.value === v ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('');
    /** 创作页现在选的是横图还是竖图（读按钮状态，不碰创作页的草稿） */
    const orientation = () => { const b = $('#c-size button.on'); return b && b.dataset.v === 'landscape' ? 'landscape' : 'portrait'; };

    function render() {
        if (!card) return;
        const n = nai();
        const key = orientation() === 'landscape' ? 'landscapeSize' : 'portraitSize';
        // 下拉窄，只显示数字
        const sizes = Params.SIZES.map((x) => ({ value: x.value, label: x.value + (x.free ? ' 免费' : '') }));
        if (!sizes.some((x) => x.value === n[key])) sizes.push({ value: n[key], label: n[key] + ' 自定义' });
        const seed = Number(n.seed) > 0;
        const v5 = Params.isV5(n.model), v3 = Params.isV3(n.model);
        const sw = (k, text, on, off, note) => '<label class="check grow" style="margin:0' + (off ? ';opacity:.5' : '') + '"><span class="switch"><input type="checkbox" data-q="' + k + '"'
            + (on ? ' checked' : '') + (off ? ' disabled' : '') + '><span></span></span><span>' + text + (note ? '<span class="card-sub" style="display:inline"> ' + note + '</span>' : '') + '</span></label>';
        card.innerHTML = '<div class="grid2">'
            + '<div class="field"><label>模型</label><select data-q="model">' + opts(Params.MODELS.map((m) => ({ value: m.value, label: Params.modelLabel(m.value) })), n.model) + '</select></div>'
            + '<div class="field"><label>画风模板</label><select data-q="style">' + opts([{ value: '', label: '不用模板' }].concat(n.styles.map((x) => ({ value: x.id, label: x.name || '未命名' }))), n.styleId) + '</select></div>'
            + '<div class="field"><label>' + (key === 'landscapeSize' ? '横图' : '竖图') + '尺寸</label><select data-q="size">' + opts(sizes, n[key]) + '</select></div>'
            + '<div class="field"><label>种子</label><button class="btn' + (seed ? ' primary' : '') + '" data-q="seed" style="width:100%">'
            + (seed ? '已锁定 ' + n.seed : '每次随机') + '</button></div>'
            + '</div>'
            + '<div class="row quick-sw">'
            + sw('transparent', '透明背景', n.transparent && v5, !v5, v5 ? '' : '（V5 才有）')
            + sw('furry', 'Furry 模式', n.furry && !v3, v3, v3 ? '（V3 没有）' : '')
            + '</div>';
        card.querySelectorAll('input[data-q]').forEach((el) => el.addEventListener('change', () => {
            n[el.dataset.q] = el.checked;
            UI.saveSettings();
            toast('info', el.dataset.q === 'transparent'
                ? (el.checked ? '透明背景开了：提示词里自动加 transparent background，出的 PNG 背景透明（别开图库的转 JPG）' : '透明背景关了')
                : (el.checked ? 'Furry 模式开了：正面最前面加 fur dataset（兽人数据集）' : 'Furry 模式关了'));
            CreatePage.refresh();
        }));
        card.querySelectorAll('select').forEach((el) => el.addEventListener('change', () => {
            if (el.dataset.q === 'model') n.model = el.value;
            if (el.dataset.q === 'style') n.styleId = el.value;
            if (el.dataset.q === 'size') n[key] = el.value;
            UI.saveSettings();
            CreatePage.refresh();
        }));
        $('[data-q="seed"]', card).onclick = () => {
            if (seed) { n.seed = 0; toast('info', '种子改回每次随机'); }
            else {
                n.seed = Nai.state.lastSeed || 1 + Math.floor(Math.random() * (2 ** 32 - 1));
                toast('info', (Nai.state.lastSeed ? '锁定了上一张的种子 ' : '锁定种子 ') + n.seed);
            }
            UI.saveSettings();
            CreatePage.refresh();
        };
    }

    function mount() {
        const tagCard = $('#c-tag') && $('#c-tag').closest('.card');
        if (!tagCard) return;
        card = document.createElement('div');
        card.className = 'card quickbar';
        card.id = 'c-quick';
        tagCard.parentNode.insertBefore(card, tagCard);
        $('#c-size').addEventListener('click', () => setTimeout(render)); // 换横竖后尺寸那格跟着换
        $('#c-count').addEventListener('change', () => setTimeout(costs));
        $('#c-size').addEventListener('click', () => setTimeout(costs));
        // 拆多张的结果卡片、批量页是各自重画的，按钮一变就补上标记
        let t = 0;
        new MutationObserver(() => { clearTimeout(t); t = setTimeout(costs, 50); }).observe(document.body, { childList: true, subtree: true });
        render();
    }

    // ------------------------------------------------------------
    // 出图按钮上的 Anlas 预估
    // ------------------------------------------------------------
    let tagging = false;
    function costs() {
        if (tagging || !window.Cost) return;
        tagging = true;
        try {
            const n = nai(), d = CreatePage.draft || {};
            const size = orientation(), count = Number(($('#c-count') || {}).value) || Number(d.count) || 1;
            Cost.tag($('#c-draw'), Cost.estimate(n, { size, tag: d.tag }, count));
            // 拆多张：「出这张」按创作页的张数，「全部出图」× 卡片数
            const ones = UI.$$('#c-plan-box [data-one]');
            const one = Cost.estimate(n, { size }, count);
            ones.forEach((b) => Cost.tag(b, one));
            const all = $('#c-plan-box [data-all]');
            if (all) Cost.tag(all, Cost.estimate(n, { size }, count * Math.max(1, ones.length)));
            // 批量页：每条张数不定，标「每张」
            const per = Cost.estimate(n, { size }, 1);
            ['#b-go', '#b-drawall'].forEach((id) => Cost.tag($(id), per, '每张'));
        } finally { setTimeout(() => { tagging = false; }); }
    }
    if (window.Cost) Cost.onRefresh(costs);

    const init = CreatePage.init, refresh = CreatePage.refresh;
    CreatePage.init = async function () { await init.apply(this, arguments); mount(); };
    CreatePage.refresh = function () { refresh.apply(this, arguments); render(); costs(); };

    // ------------------------------------------------------------
    // Anlas 余额 + Opus 免费额度（只有官方站或带订阅接口的站才显示）
    // ------------------------------------------------------------
    const chip = document.createElement('button');
    chip.id = 'anlas-chip';
    chip.className = 'badge';
    chip.hidden = true;
    chip.title = '点一下刷新';
    $('#topbar').insertBefore(chip, $('#btn-settings'));

    // d：Nai.subscription 的结果
    function show(d) {
        chip.hidden = !d;
        if (!d) return;
        chip.textContent = 'Anlas ' + d.anlas + (d.usage ? ' · Opus ' + d.usage.percent + '%' : '');
        chip.classList.toggle('low', !!(d.usage && d.usage.percent < 5));
    }

    let busy = false, timer = 0;
    async function refreshAnlas(manual) {
        if (busy || !String(nai().key || '').trim()) return;
        busy = true;
        try {
            const d = await Nai.subscription(nai());
            show(d);
            if (manual) toast(d ? 'success' : 'info', d ? 'Anlas 余额 ' + d.anlas + (d.usage ? '\n' + Nai.usageText(d.usage) : '') : '这个站查不到余额');
        } catch (e) {
            if (manual) toast('error', e.message || String(e));
        } finally { busy = false; }
    }

    chip.addEventListener('click', () => refreshAnlas(true));
    window.addEventListener('nai-anlas', (e) => show(e.detail));
    window.addEventListener('nai-drawn', () => { clearTimeout(timer); timer = setTimeout(refreshAnlas, 1500); });
    // 启动后设置读好了再查
    setTimeout(function first() { if (!$('#c-tag')) { setTimeout(first, 300); return; } refreshAnlas(); }, 300);

    window.QuickBar = { render, refreshAnlas, costs };
})();
