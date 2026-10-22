/*
 * R18显示.js —— 设置页「R18」开关（默认关）：关着时，提示词里带 nsfw 类标签的图在图库、大图左右滑、灵感库、
 *               「从图库选一张」里都不显示；打开才显示。只是不显示，图和配方都还在。
 *
 *   设置 settings.view = { r18: false 显示 R18 图, r18Tags: '' 自己的判定标签（逗号或换行隔开，留空 = 内置 DEFAULT_TAGS） }
 *   判定看图的正面提示词（实际发送的 meta.positive、AI 写的 tag、多角色每个人的 tag），按逗号拆成标签，
 *   去掉权重写法（{} [] () 1.2::x:: x:1.2）、下划线当空格，和判定标签一样就算；判定标签末尾带 * 是前缀匹配（cum* 也算 cum on body）。
 *
 * 对外：R18.on()、R18.isNsfw(图库项)、R18.visible(图库项)、R18.tagsNsfw(标签串)、R18.inspoVisible(灵感条目)
 */
(function () {
    'use strict';

    const { esc } = UI;
    const DEFAULT_TAGS = [
        'nsfw', 'explicit', 'rating:explicit', 'nude', 'completely nude', 'naked', 'topless', 'bottomless',
        'nipples', 'areolae', 'pussy', 'vagina', 'penis', 'testicles', 'clitoris', 'pubic hair', 'erection',
        'sex', 'vaginal', 'anal', 'oral', 'fellatio', 'handjob', 'paizuri', 'masturbation', 'after sex',
        'cum*', 'ejaculation', 'uncensored', 'mosaic censoring', 'bar censor',
    ];

    const view = () => (UI.settings && UI.settings.view) || {};
    const on = () => !!view().r18;

    let rulesSrc = null, exact = new Set(), prefix = [];
    function rules() {
        const src = String(view().r18Tags || '').trim();
        if (src !== rulesSrc) {
            rulesSrc = src;
            const list = (src ? src.split(/[,，\n]/) : DEFAULT_TAGS).map(norm).filter(Boolean);
            exact = new Set(list.filter((t) => !t.endsWith('*')));
            prefix = list.filter((t) => t.endsWith('*')).map((t) => t.slice(0, -1).trim()).filter(Boolean);
        }
    }
    /** 一个标签 → 小写、去权重括号、下划线换空格 */
    function norm(t) {
        let s = String(t || '').toLowerCase().replace(/_/g, ' ');
        s = s.replace(/-?\d+(\.\d+)?::/g, '').replace(/::/g, '');      // V4 起的 1.2::tag:: 写法
        s = s.replace(/[{}\[\]()]/g, '').replace(/:\s*-?\d+(\.\d+)?\s*$/, ''); // {tag} [tag] (tag:1.2)
        return s.replace(/\s+/g, ' ').trim();
    }
    function tagsNsfw(str) {
        rules();
        return String(str || '').split(/[,，\n|]/).some((raw) => {
            const t = norm(raw);
            return t && (exact.has(t) || prefix.some((p) => t.startsWith(p)));
        });
    }

    function isNsfw(item) {
        if (!item) return false;
        const m = item.meta || {};
        return tagsNsfw(m.positive) || tagsNsfw(item.tag) || (m.characters || []).some((c) => tagsNsfw(c && c.tag));
    }
    const visible = (item) => on() || !isNsfw(item);
    const inspoVisible = (it) => on() || !tagsNsfw(it && it.tags);

    // 改了开关 / 判定标签：图库马上重新筛
    document.addEventListener('change', (e) => {
        const k = e.target && e.target.dataset && e.target.dataset.k;
        if (k !== 'view.r18' && k !== 'view.r18Tags') return;
        if (window.GalleryPage) setTimeout(() => GalleryPage.refresh(), 0);
    });

    if (window.SettingsPage && SettingsPage.addTab) {
        SettingsPage.addTab({
            id: 'r18', label: 'R18',
            html: () => '<div class="help" style="margin-bottom:12px">关着时，提示词里带 nsfw、nude 这类标签的图不显示（图库、大图、灵感库、从图库选图都看不到），图和配方都还在，打开就回来。</div>'
                + '<label class="check"><span class="switch"><input type="checkbox" data-k="view.r18"><span></span></span><span>显示 R18 图'
                + '<div class="help">默认关</div></span></label>'
                + '<div class="field"><label>判定标签（提示词里有任意一个就算 R18）</label><textarea class="ta" data-k="view.r18Tags" placeholder="' + esc(DEFAULT_TAGS.join(', ')) + '"></textarea>'
                + '<div class="help">逗号或换行隔开；留空 = 用内置的（灰字）。末尾加 * 是「以它开头的都算」，比如 cum* 。大小写、下划线、权重括号都不影响。</div></div>',
        });
    }

    if (window.Help && Help.add) {
        Help.add({ id: 'r18', group: '设置', title: 'R18 开关',
            text: '设置页「R18」：默认关。关着时，正面提示词里带 nsfw、explicit、nude 等标签的图在图库、大图左右滑、灵感库、从图库选图里都不显示；打开「显示 R18 图」才显示。只是藏起来，不删图。判定用哪些标签可以自己改。刚出好的图在创作页结果里照常显示。' });
    }

    window.R18 = { on, isNsfw, visible, tagsNsfw, inspoVisible, norm, DEFAULT_TAGS };
})();
