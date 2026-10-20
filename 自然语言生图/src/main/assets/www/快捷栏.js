/*
 * 快捷栏.js —— 创作页上的出图快捷设置 + 顶栏常驻的 Anlas 余额
 *
 * 快捷栏：模型、画风模板、尺寸（当前横竖画幅那一格）、锁定种子，改了直接存进设置。
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
        card.innerHTML = '<div class="grid2">'
            + '<div class="field"><label>模型</label><select data-q="model">' + opts(Params.MODELS.map((m) => ({ value: m.value, label: Params.modelLabel(m.value) })), n.model) + '</select></div>'
            + '<div class="field"><label>画风模板</label><select data-q="style">' + opts([{ value: '', label: '不用模板' }].concat(n.styles.map((x) => ({ value: x.id, label: x.name || '未命名' }))), n.styleId) + '</select></div>'
            + '<div class="field"><label>' + (key === 'landscapeSize' ? '横图' : '竖图') + '尺寸</label><select data-q="size">' + opts(sizes, n[key]) + '</select></div>'
            + '<div class="field"><label>种子</label><button class="btn' + (seed ? ' primary' : '') + '" data-q="seed" style="width:100%">'
            + (seed ? '已锁定 ' + n.seed : '每次随机') + '</button></div>'
            + '</div>';
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
        render();
    }

    const init = CreatePage.init, refresh = CreatePage.refresh;
    CreatePage.init = async function () { await init.apply(this, arguments); mount(); };
    CreatePage.refresh = function () { refresh.apply(this, arguments); render(); };

    // ------------------------------------------------------------
    // Anlas 余额（只有官方站或带订阅接口的站才显示）
    // ------------------------------------------------------------
    const chip = document.createElement('button');
    chip.id = 'anlas-chip';
    chip.className = 'badge';
    chip.hidden = true;
    chip.title = '点一下刷新';
    $('#topbar').insertBefore(chip, $('#btn-settings'));

    function show(n) {
        chip.hidden = n == null;
        chip.textContent = 'Anlas ' + n;
    }

    let busy = false, timer = 0;
    async function refreshAnlas(manual) {
        if (busy || !String(nai().key || '').trim()) return;
        busy = true;
        try {
            const d = await Nai.subscription(nai());
            show(d ? d.anlas : null);
            if (manual) toast(d ? 'success' : 'info', d ? 'Anlas 余额 ' + d.anlas : '这个站查不到余额');
        } catch (e) {
            if (manual) toast('error', e.message || String(e));
        } finally { busy = false; }
    }

    chip.addEventListener('click', () => refreshAnlas(true));
    window.addEventListener('nai-anlas', (e) => show(e.detail));
    window.addEventListener('nai-drawn', () => { clearTimeout(timer); timer = setTimeout(refreshAnlas, 1500); });
    // 启动后设置读好了再查
    setTimeout(function first() { if (!$('#c-tag')) { setTimeout(first, 300); return; } refreshAnlas(); }, 300);

    window.QuickBar = { render, refreshAnlas };
})();
