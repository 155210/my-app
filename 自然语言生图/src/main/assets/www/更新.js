/*
 * 更新.js —— 应用内检查更新（设置页「更新」标签 + 启动时自动看一眼）
 *
 * 看仓库 Releases 里标签为 shengtu-<构建号> 的最新一版，和本机版本号 1.0.<构建号> 比。
 * 有新版就弹框，点「下载」由外壳（ApkUpdater.java）下载 APK，下完直接调起系统安装（签名固定，覆盖安装，设置和图库都保留）。
 * 没开「允许安装未知应用」时先跳系统设置，开好返回 App 自动接着装。浏览器调试时退回打开下载地址。
 * 自动检查的开关、上次检查时间、「这版不再提醒」存在存储键 update 里（不进设置备份）。
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;
    const REPO = '155210/my-app';
    const API = 'https://api.github.com/repos/' + REPO + '/releases?per_page=30';
    const PAGE = 'https://github.com/' + REPO + '/releases';
    const AUTO_EVERY = 12 * 3600 * 1000;

    let state = { auto: true, last: 0, skip: 0 };
    let latest = null; // 最近一次查到的 { build, url, time, notes, page }

    const saveState = () => Store.set('update', state).catch(() => {});
    const loaded = Store.get('update', {}).then((v) => { state = Object.assign(state, v); }).catch(() => {});

    /** 本机构建号；浏览器里调试时没有，返回 0 */
    function currentBuild() {
        try {
            const v = window.AndroidBridge && window.AndroidBridge.appVersion();
            const m = String(v || '').match(/(\d+)\s*$/);
            return m ? +m[1] : 0;
        } catch (e) { return 0; }
    }
    function currentLabel() {
        const b = currentBuild();
        return b ? 'build ' + b : '（浏览器调试，没有版本号）';
    }

    async function fetchLatest() {
        let r;
        try {
            r = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
        } catch (e) {
            throw new Error('连不上 GitHub，检查一下网络（国内可能要开代理）');
        }
        if (r.status === 403 || r.status === 429) throw new Error('GitHub 限制了查询次数，过一小时再试');
        if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
        const list = await r.json();
        let best = null;
        (Array.isArray(list) ? list : []).forEach((rel) => {
            const m = /^shengtu-(\d+)$/.exec(rel.tag_name || '');
            if (!m || rel.draft || rel.prerelease) return;
            const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name || ''));
            if (!apk) return;
            const build = +m[1];
            if (!best || build > best.build) {
                best = { build, url: apk.browser_download_url, time: rel.published_at, notes: (rel.body || '').trim(), page: rel.html_url || PAGE, size: apk.size };
            }
        });
        if (!best) throw new Error('Releases 里还没有这个 App 的安装包');
        latest = best;
        state.last = Date.now();
        saveState();
        return best;
    }

    const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '');
    const fmtSize = (n) => (n ? (n / 1048576).toFixed(1) + ' MB' : '');

    /** App 里：自己下载，下完调起系统安装；浏览器调试时退回打开下载地址 */
    function download(info) {
        const B = window.AndroidBridge;
        if (!B || !B.updateDownload) {
            toast('info', '已交给浏览器下载，下完点开安装包覆盖安装就行');
            location.href = info.url;
            return;
        }
        let finished = false;
        const L = UI.openLayer('dialog', '<h3>下载新版 build ' + info.build + '</h3>'
            + '<p data-msg>准备下载…</p><div class="up-bar"><div data-bar></div></div>'
            + '<p class="help" data-tip>下载完会自动打开安装界面。第一次安装要在系统里允许「安装未知应用」，开好后返回 App 会接着装。</p>'
            + '<div class="btns"><button class="btn" data-cancel>取消</button><button class="btn primary" data-install hidden>安装</button></div>',
        { onClose: () => { if (!finished) B.updateCancel(); cleanup(); } });
        const msg = $('[data-msg]', L.box), bar = $('[data-bar]', L.box), btnI = $('[data-install]', L.box), btnC = $('[data-cancel]', L.box);
        const mb = (n) => (n / 1048576).toFixed(1);
        function cleanup() { window.__updateProgress = null; window.__updateDone = null; }
        function install() {
            const r = String(B.updateInstall() || '');
            if (r === 'OK') { msg.textContent = '已打开安装界面，点「安装」覆盖就行，设置和图库都保留。'; }
            else if (r === 'PERMISSION') { msg.textContent = '请在打开的系统设置里允许「安装未知应用」，然后返回 App，会自动接着安装。'; }
            else { msg.textContent = r.replace(/^ERR:/, ''); }
            btnI.hidden = false;
        }
        window.__updateProgress = (done, total) => {
            msg.textContent = '正在下载 ' + mb(done) + (total > 0 ? ' / ' + mb(total) : '') + ' MB';
            bar.style.width = (total > 0 ? Math.min(100, done * 100 / total) : 50) + '%';
        };
        window.__updateDone = (ok, err) => {
            finished = true;
            if (!ok) { msg.textContent = '下载失败：' + err; btnC.textContent = '关闭'; return; }
            btnC.textContent = '关闭';
            install();
        };
        btnC.onclick = () => UI.closeLayer(L);
        btnI.onclick = install;
        B.updateDownload(info.url);
    }

    /** 弹框问要不要下载；auto = 启动时自动弹的，多一个「这版不再提醒」 */
    function offer(info, auto) {
        return new Promise((resolve) => {
            let done = false;
            const L = UI.openLayer('dialog', '<h3>有新版：build ' + info.build + '</h3>'
                + '<p>现在是 ' + esc(currentLabel()) + '。新版发布于 ' + esc(fmtTime(info.time)) + (info.size ? '，' + fmtSize(info.size) : '') + '。</p>'
                + (info.notes ? '<p style="white-space:pre-wrap;max-height:30vh;overflow-y:auto">' + esc(info.notes) + '</p>' : '')
                + '<p class="help">下载完自动弹出安装，直接覆盖安装，设置和图库都保留。</p>'
                + '<div class="btns">' + (auto ? '<button class="btn" data-skip>这版不再提醒</button>' : '')
                + '<button class="btn" data-no>以后再说</button><button class="btn primary" data-yes>下载</button></div>',
            { onClose: () => { if (!done) resolve(false); } });
            const close = (v) => { done = true; UI.closeLayer(L, true); resolve(v); };
            $('[data-no]', L.box).onclick = () => close(false);
            $('[data-yes]', L.box).onclick = () => { close(true); download(info); };
            const sk = $('[data-skip]', L.box);
            if (sk) sk.onclick = () => { state.skip = info.build; saveState(); close(false); };
        });
    }

    /** 手动检查（设置页按钮）。返回查到的信息 */
    async function check() {
        const info = await fetchLatest();
        const cur = currentBuild();
        if (cur && info.build <= cur) toast('success', '已经是最新版（build ' + cur + '）');
        else await offer(info, false);
        return info;
    }

    /** 启动时自动检查：开着开关、离上次超过 12 小时才查，出错不打扰 */
    let autoDone = false;
    async function autoCheck() {
        if (autoDone) return;
        autoDone = true;
        await loaded;
        const cur = currentBuild();
        if (!state.auto || !cur || Date.now() - (state.last || 0) < AUTO_EVERY) return;
        try {
            const info = await fetchLatest();
            if (info.build > cur && info.build !== state.skip) await offer(info, true);
        } catch (e) { /* 静默 */ }
    }

    function html() {
        const cur = currentBuild();
        let st = '';
        if (latest) {
            st = cur && latest.build <= cur ? '已经是最新版' : '最新是 build ' + latest.build + '（' + esc(fmtTime(latest.time)) + '）';
        }
        return '<div class="card"><div class="card-title">当前版本 <span class="badge acc">' + esc(currentLabel()) + '</span></div>'
            + '<div class="card-sub">' + (st || '新版在 GitHub 仓库的 Releases 里，名字是 shengtu-数字，数字越大越新。')
            + (state.last ? '<br>上次检查：' + esc(fmtTime(state.last)) : '') + '</div>'
            + '<div class="btns"><button class="btn primary" data-act="up-check">检查更新</button><button class="btn" data-act="up-page">打开发布页</button></div></div>'
            + '<label class="check"><span class="switch"><input type="checkbox" id="up-auto"' + (state.auto ? ' checked' : '') + '><span></span></span>'
            + '<span>打开 App 时自动检查<div class="help">最多 12 小时查一次，有新版才弹框</div></span></label>';
    }

    SettingsPage.addTab({
        id: 'update',
        label: '更新',
        html,
        acts: {
            'up-check': async (btn, redraw) => {
                btn.disabled = true;
                try { await check(); } catch (e) { toast('error', e.message || String(e), '检查失败'); } finally { btn.disabled = false; redraw(); }
            },
            'up-page': async () => { location.href = latest ? latest.page : PAGE; },
        },
    });
    // 开关不是 data-k 绑定（不在 settings 里），自己监听
    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'up-auto') { state.auto = e.target.checked; saveState(); }
    });

    window.Updater = { check, autoCheck, fetchLatest, currentBuild };
    // 等启动.js 读完设置再查，不抢首屏
    setTimeout(() => autoCheck().catch(() => {}), 3000);
})();
