/*
 * 启动.js —— 读设置、初始化各页面、底部标签切换
 */
(function () {
    'use strict';

    const { $, $$, toast } = UI;
    const TITLES = { create: '创作', batch: '批量', gallery: '图库' };
    let current = 'create';

    function showTab(t) {
        current = t;
        $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
        $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + t; });
        $('#title').textContent = TITLES[t];
        if (t === 'gallery') GalleryPage.refresh();
        if (t === 'batch') BatchPage.refresh();
    }
    UI.showTab = showTab;
    UI.currentTab = () => current;

    $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
    $('#btn-settings').addEventListener('click', () => SettingsPage.open());

    Queue.onChange((st) => {
        const n = st.running + st.waiting;
        const chip = $('#queue-chip');
        chip.hidden = !n;
        chip.textContent = '出图中 ' + n;
    });

    async function boot() {
        const s = await UI.loadSettings();
        await CreatePage.init();
        await GalleryPage.refresh();
        if (!s.ai.url || !s.nai.key) {
            setTimeout(() => toast('info', '先点右上角齿轮，填好 AI 接口和 NAI 的 Key'), 400);
        }
    }
    boot().catch((e) => { console.error(e); toast('error', e.message || String(e), '启动失败'); });
})();
