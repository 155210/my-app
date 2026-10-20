// 设置导出 / 导入、检查更新的无头浏览器测试（假 GitHub 接口）
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/备份更新测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const RELEASES = [
  { tag_name: 'kingdom-50', assets: [{ name: 'Kingdom.apk', browser_download_url: 'https://dl.test/k.apk' }] },
  { tag_name: 'shengtu-4', published_at: '2026-10-19T10:00:00Z', body: '', assets: [{ name: 'NlImage.apk', size: 3e6, browser_download_url: 'https://dl.test/s4.apk' }] },
  { tag_name: 'shengtu-5', published_at: '2026-10-20T10:00:00Z', body: '加了备份', html_url: 'https://gh.test/r5', assets: [{ name: 'NlImage.apk', size: 3e6, browser_download_url: 'https://dl.test/s5.apk' }] },
  { tag_name: 'shengtu-6', draft: true, assets: [{ name: 'NlImage.apk', browser_download_url: 'https://dl.test/s6.apk' }] },
];

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  let ghCalls = 0, dlUrl = '';
  await page.route('https://api.github.com/**', (r) => { ghCalls++; r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(RELEASES) }); });
  await page.route('https://dl.test/**', (r) => { dlUrl = r.request().url(); r.fulfill({ body: 'apk' }); });

  const home = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(home);
  await page.waitForSelector('#c-write');
  await page.waitForTimeout(3300); // 浏览器里没有版本号，自动检查不应该发请求
  ok(ghCalls === 0, '浏览器调试时不自动检查更新');

  // ---------- 备份 ----------
  await page.evaluate(async () => {
    UI.settings.ai.url = 'https://ai.test/v1'; UI.settings.ai.key = 'sk-1'; UI.settings.ai.model = 'm-a';
    UI.settings.nai.key = 'nai-1'; UI.settings.nai.artist = 'artist:abc';
    UI.saveSettings();
    await Store.set('gallery', [{ id: 'x' }]); await Store.set('img:x', 'blob'); await Store.set('draft', { d: 1 });
    await Store.set('roles', [{ name: '小红' }]); // 以后别的组自己存的键，也要进备份
  });
  await page.click('#btn-settings');
  await page.click('.tabs [data-tab="backup"]');
  ok(await page.isVisible('[data-act="bk-export"]'), '设置页有「备份」标签');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="bk-export"]')]);
  const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(file.kind === 'nl-image-settings' && file.data.settings.ai.url === 'https://ai.test/v1' && file.data.settings.nai.artist === 'artist:abc', '导出内容含设置');
  ok(file.data.settings.ai.key === '' && file.data.settings.nai.key === '', '默认不导出 Key');
  ok(!file.data.gallery && !file.data['img:x'] && !file.data.draft, '图库、原图、草稿不进备份');
  ok(file.data.roles && file.data.roles[0].name === '小红', '其他键（角色库等）进备份');
  await page.click('label:has(#bk-keys)');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="bk-export"]')]);
  const file2 = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
  ok(file2.data.settings.ai.key === 'sk-1' && file2.data.settings.nai.key === 'nai-1', '勾选后连 Key 一起导出');

  // 改乱再导入（文件里不带 Key → 保留现有 Key）
  await page.evaluate(async () => { UI.settings.ai.url = 'https://other/v1'; UI.settings.nai.artist = ''; UI.settings.ai.key = 'sk-new'; UI.saveSettings(); await Store.del('roles'); });
  await page.waitForTimeout(300);
  const tmp = path.join(require('os').tmpdir(), 'nl-backup-test.json');
  fs.writeFileSync(tmp, JSON.stringify(file));
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="bk-import"]')]);
  await fc.setFiles(tmp);
  await page.waitForSelector('.dialog [data-yes]');
  ok((await page.textContent('.dialog')).includes('导入这份设置'), '导入前确认');
  await Promise.all([page.waitForNavigation(), page.click('.dialog [data-yes]')]);
  await page.waitForSelector('#c-write');
  const after = await page.evaluate(async () => ({ s: UI.settings, style: Nai.activeStyle(UI.settings.nai), roles: await Store.get('roles'), gallery: await Store.get('gallery') }));
  // 旧版画师串导入后会搬进画风模板（见 参数.js normalize）
  ok(after.s.ai.url === 'https://ai.test/v1' && after.style && after.style.prefix === 'artist:abc', '导入后设置恢复');
  ok(after.s.ai.key === 'sk-new' && after.s.nai.key === 'nai-1', '文件没带 Key 时保留手机上的 Key');
  ok(after.roles && after.roles[0].name === '小红', '其他键也恢复');
  ok(after.gallery && after.gallery[0].id === 'x', '图库没被动');
  const bad = await page.evaluate(async () => { try { Backup.parse('{"a":1}'); return ''; } catch (e) { return e.message; } });
  ok(bad.includes('不是'), '错文件报错：' + bad);

  // ---------- 检查更新 ----------
  await page.evaluate(() => { window.AndroidBridge = { appVersion: () => '1.0.3' }; });
  await page.click('#btn-settings');
  await page.click('.tabs [data-tab="update"]');
  ok((await page.textContent('.page-body')).includes('build 3'), '显示当前版本 build 3');
  await page.click('[data-act="up-check"]');
  await page.waitForSelector('.dialog [data-yes]');
  const dt = await page.textContent('.dialog');
  ok(dt.includes('build 5') && dt.includes('加了备份') && !dt.includes('不再提醒'), '手动检查：找到 shengtu-5（跳过草稿和别的 App）');
  await page.click('.dialog [data-yes]');
  await page.waitForTimeout(300);
  ok(dlUrl === 'https://dl.test/s5.apk', '点下载打开 APK 地址');
  await page.goto(home);
  await page.waitForSelector('#c-write');

  // App 里：外壳自己下载，下完调起安装；第一次要去开「安装未知应用」
  await page.evaluate(() => {
    window.__calls = [];
    let n = 0;
    window.AndroidBridge = {
      appVersion: () => '1.0.3',
      updateDownload: (u) => { __calls.push('dl:' + u); setTimeout(() => __updateProgress(1048576, 3145728), 50); setTimeout(() => __updateDone(true, ''), 150); },
      updateCancel: () => __calls.push('cancel'),
      updateInstall: () => { __calls.push('install'); return ++n === 1 ? 'PERMISSION' : 'OK'; },
    };
  });
  await page.evaluate(() => { Updater.check(); });
  await page.waitForSelector('.dialog [data-yes]');
  await page.click('.dialog [data-yes]');
  await page.waitForSelector('.dialog [data-msg]');
  await page.waitForFunction(() => /1\.0 \/ 3\.0 MB/.test(document.querySelector('.dialog [data-msg]').textContent));
  ok(true, '下载进度显示 1.0 / 3.0 MB');
  await page.waitForFunction(() => __calls.includes('install'));
  ok((await page.textContent('.dialog [data-msg]')).includes('安装未知应用'), '没权限时提示去开「安装未知应用」');
  await page.click('.dialog [data-install]');
  ok((await page.textContent('.dialog [data-msg]')).includes('已打开安装界面'), '再点安装调起系统安装');
  const calls = await page.evaluate(() => __calls);
  ok(calls[0] === 'dl:https://dl.test/s5.apk' && calls.filter((c) => c === 'install').length === 2 && !calls.includes('cancel'), '外壳调用顺序：下载 → 安装 ×2，没误取消');
  await page.click('.dialog [data-cancel]');
  ok(!(await page.$('.dialog')), '关闭下载框');

  await page.evaluate(() => { window.AndroidBridge = { appVersion: () => '1.0.5' }; });
  const n0 = ghCalls;
  await page.evaluate(() => Updater.check());
  await page.waitForTimeout(200);
  ok(ghCalls > n0 && !(await page.$('.dialog')) && (await page.textContent('#ask-toasts')).includes('已经是最新版'), '已是最新版时只提示');

  // 自动检查：12 小时内不重复查；超过就查，「这版不再提醒」后不再弹
  await page.evaluate(() => { window.AndroidBridge = { appVersion: () => '1.0.4' }; });
  const n1 = ghCalls;
  await page.evaluate(() => Updater.autoCheck());
  ok(ghCalls === n1, '12 小时内不重复自动检查');
  await page.evaluate(async () => { const s = await Store.get('update'); s.last = 0; await Store.set('update', s); });
  await page.goto(home); await page.waitForSelector('#c-write');
  await page.evaluate(() => { window.AndroidBridge = { appVersion: () => '1.0.4' }; Updater.autoCheck(); });
  await page.waitForSelector('.dialog [data-skip]');
  ok(true, '自动检查发现新版弹框（带「这版不再提醒」）');
  await page.click('.dialog [data-skip]');
  await page.waitForTimeout(300);
  await page.evaluate(async () => { const s = await Store.get('update'); s.last = 0; await Store.set('update', s); });
  await page.goto(home); await page.waitForSelector('#c-write');
  await page.evaluate(() => { window.AndroidBridge = { appVersion: () => '1.0.4' }; return Updater.autoCheck(); });
  ok(!(await page.$('.dialog')), '选了不再提醒的版本不再弹');
  const st = await page.evaluate(() => Store.get('update'));
  ok(st.skip === 5 && st.auto === true, '更新状态已保存');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
