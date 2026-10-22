// R18 开关：默认关时带 nsfw 类标签的图在图库、大图、灵感库、选图里不显示；打开就显示；判定标签可改
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/R18测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');

  // 判定
  const j = await page.evaluate(() => ({
    def: UI.settings.view.r18,
    a: R18.tagsNsfw('1girl, {{NSFW}}, smile'), b: R18.tagsNsfw('1girl, completely_nude'), c: R18.tagsNsfw('1.2::cum on body::, bed'),
    d: R18.tagsNsfw('1girl, nude color scheme, sexy'), e: R18.tagsNsfw('(nipples:1.3)'), f: R18.tagsNsfw('1girl, school uniform'),
  }));
  ok(j.def === false, '默认关');
  ok(j.a && j.b && j.c && j.e, '认出 nsfw / completely_nude / 权重写法 / cum* 前缀');
  ok(!j.d && !j.f, '不是整个标签的不算（nude color scheme、sexy、普通图）');

  await page.evaluate(async () => {
    const mk = () => new Promise((r) => { const c = document.createElement('canvas'); c.width = 16; c.height = 24; c.toBlob(r, 'image/png'); });
    const add = async (desc, tag, chars) => { await Gallery.add(await mk(), 'png', { desc, tag, meta: { positive: tag, characters: chars } }); await new Promise((r) => setTimeout(r, 15)); };
    await add('普通', '1girl, smile');
    await add('色图', '1girl, nsfw, nude');
    await add('角色里有', '2girls, bed', [{ tag: 'girl, topless' }, { tag: 'girl' }]);
    await add('海边', 'beach, sea');
    await InspoLib.ready;
    InspoLib.add({ cat: '角色', name: '正常片段', tags: 'red hair' });
    InspoLib.add({ cat: '角色', name: '色片段', tags: 'nsfw, pussy' });
  });
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForSelector('#g-views');
  const descs = () => page.evaluate(async () => { const l = await Gallery.list(); return [...document.querySelectorAll('#page-gallery .thumb, .thumb')].map((t) => (l.find((x) => x.id === t.dataset.id) || {}).desc).filter(Boolean); });
  ok((await descs()).join() === '海边,普通', '关着：图库只显示普通图（多角色里的也算）：' + (await descs()).join());

  // 大图左右滑只在显示的里
  const n = await page.evaluate(async () => { const l = await Gallery.list(); GalleryPage.openViewer(l.find((x) => x.desc === '海边').id); await new Promise((r) => setTimeout(r, 200)); return document.querySelector('[data-count]').textContent; });
  ok(/2/.test(n) && !/4/.test(n), '大图张数只算显示的：' + n);
  await page.evaluate(() => { const b = document.querySelector('.layer [data-close]'); if (b) b.click(); });
  await page.waitForTimeout(300);

  // 灵感库
  await page.evaluate(() => InspoLib.open());
  await page.waitForSelector('.in-grid');
  let names = await page.$$eval('.in-grid .in-meta b', (x) => x.map((e) => e.textContent));
  ok(names.includes('正常片段') && !names.includes('色片段'), '关着：灵感库不显示 R18 片段');
  await page.evaluate(() => { const b = document.querySelector('.layer [data-close]'); if (b) b.click(); });
  await page.waitForTimeout(300);

  // 设置页打开开关
  await page.evaluate(() => SettingsPage.open('r18'));
  await page.waitForSelector('[data-k="view.r18"]', { state: 'attached' });
  await page.click('label.check:has([data-k="view.r18"])');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => UI.settings.view.r18 === true), '设置页打开开关');
  await page.evaluate(() => { const b = document.querySelector('.layer [data-close]'); if (b) b.click(); });
  await page.waitForTimeout(300);
  ok((await descs()).length === 4, '打开后图库四张都显示');
  await page.evaluate(() => InspoLib.open());
  await page.waitForSelector('.in-grid');
  names = await page.$$eval('.in-grid .in-meta b', (x) => x.map((e) => e.textContent));
  ok(names.includes('色片段'), '打开后灵感库显示 R18 片段');
  await page.evaluate(() => { const b = document.querySelector('.layer [data-close]'); if (b) b.click(); });

  // 自己的判定标签
  const k = await page.evaluate(() => { UI.settings.view.r18 = false; UI.settings.view.r18Tags = 'beach'; return [R18.isNsfw({ tag: 'beach, sea' }), R18.isNsfw({ tag: 'nsfw' })]; });
  ok(k[0] && !k[1], '自定义判定标签代替内置的');
  await page.evaluate(() => { UI.settings.view.r18Tags = ''; return GalleryPage.refresh(); });

  // 全是 R18 的时候
  await page.evaluate(async () => { for (const x of (await Gallery.list()).slice()) if (!R18.isNsfw(x)) await Gallery.remove(x.id); await GalleryPage.refresh(); });
  ok(await page.evaluate(() => !!document.querySelector('#g-r18')), '只剩 R18 图时提示去设置打开');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
