// 灵感库 + Vibe 库无头浏览器测试：新建灵感（分类、预览图从图库选 / 用这段出一张）、搜索和分类筛选、加进创作页不重复、大图「存灵感」、重开还在；
// Vibe 库：老数据收进库、加图、用上 / 移出、改名同步、分组、从卡片「Vibe 库」选、删除连数据删、进备份
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/灵感库测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');
const OUT = process.env.OUT || require('os').tmpdir();

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const tmp = fs.mkdtempSync(path.join(OUT, 'inspo-'));

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  const bodies = [];
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ status: 404, headers: CORS });
    if (req.url().endsWith('/encode-vibe')) return r.fulfill({ headers: { ...CORS, 'content-type': 'application/octet-stream' }, body: Buffer.alloc(200, 1) });
    bodies.push(JSON.parse(req.postData()));
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });

  // 先放一份「老数据」：创作页卡片上已经有一张参考图，还没有 Vibe 库
  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(url);
  await page.waitForSelector('#c-tag');
  await page.evaluate(async (b64) => {
    const s = await Store.get('settings', {});
    s.nai = Object.assign(s.nai || {}, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full', styleId: '', vibes: [{ id: 'vb_old', name: '老参考图', on: true, strength: 0.7, info: 0.8 }] });
    await Store.set('settings', s);
    await Store.set('vibe:vb_old', { image: b64, thumb: 'data:image/png;base64,' + b64, enc: [{ key: 'v4-5full', info: 0.8, data: 'AAAA' }] });
    await Store.del('vibeLib');
  }, PNG.toString('base64'));
  await page.reload();
  await page.waitForSelector('#c-vibes .vibe-item');

  // ---------- Vibe 库 ----------
  ok(await page.evaluate(() => VibeLib.list.length === 1 && VibeLib.list[0].id === 'vb_old' && VibeLib.list[0].strength === 0.7), '老用户：创作页上已有的参考图自动收进 Vibe 库');
  ok((await page.textContent('#c-vibes [data-a="del"]')) === '移出', '库里有的参考图，卡片上的按钮是「移出」');
  await page.click('#c-vibes [data-a="lib"]');
  await page.waitForSelector('.sheet [data-manage]');
  ok((await page.textContent('.sheet')).includes('都已经在创作页上了'), '卡片「Vibe 库」：库里的都用着时有说明');
  await page.click('.sheet [data-manage]');
  await page.waitForSelector('.vl-row');
  ok((await page.textContent('.vl-row')).includes('用着') && (await page.textContent('.vl-row')).includes('V4.5 Full'), '管理页显示「用着」和已编码的模型');

  // 加图（从手机选）：进库但不放进创作页
  const img = path.join(tmp, 'water.png');
  fs.writeFileSync(img, PNG);
  await page.click('[data-add]');
  let chooser = page.waitForEvent('filechooser');
  await page.click('[data-src="phone"]');
  await (await chooser).setFiles(img);
  await page.waitForFunction(() => document.querySelectorAll('.vl-row').length === 2);
  ok(await page.evaluate(() => UI.settings.nai.vibes.length === 1 && VibeLib.list.some((x) => x.name === 'water')), '管理页加的图进库，不自动放进创作页');

  // 点一行：改名、分组、默认强度
  await page.click('.vl-row[data-id^="vb_"]:not([data-id="vb_old"]) .vl-name');
  await page.waitForSelector('.sheet [data-f="group"]');
  await page.fill('.sheet [data-f="name"]', '水彩');
  await page.fill('.sheet [data-f="group"]', '水彩类');
  await page.$eval('.sheet [data-f="strength"]', (el) => { el.value = '0.45'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('.sheet [data-a="done"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const x = VibeLib.list.find((v) => v.name === '水彩'); return x && x.group === '水彩类' && x.strength === 0.45; }), '改名字、分组、默认强度');
  ok((await page.textContent('.vl-groups')).includes('水彩类 1') && (await page.textContent('.vl-groups')).includes('没分组 1'), '分组标签：水彩类 1、没分组 1');
  await page.click('.vl-groups [data-g="水彩类"]');
  ok((await page.$$('.vl-row')).length === 1, '按分组筛选');
  await page.click('.vl-groups [data-g="*"]');
  await page.screenshot({ path: path.join(OUT, 'Vibe库.png') });

  // 用上：放进创作页，用默认强度
  await page.click('.vl-row:has-text("水彩") [data-use]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const v = UI.settings.nai.vibes.find((x) => x.name === '水彩'); return v && v.on && v.strength === 0.45; }), '「用上」放进创作页，带默认强度');
  ok((await page.textContent('.vl-row:has-text("水彩")')).includes('用着'), '用上后显示「用着」');
  await page.click('.vl-row:has-text("水彩") [data-use]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !UI.settings.nai.vibes.some((x) => x.name === '水彩') && VibeLib.list.some((x) => x.name === '水彩')), '再点「移出」：创作页拿掉，库里还在');
  await page.evaluate(() => window.__appBack());

  // 卡片上「Vibe 库」选一张放进来；卡片改名同步到库
  await page.click('#c-vibes [data-a="lib"]');
  await page.waitForSelector('.vl-cell');
  await page.click('.vl-cell');
  await page.waitForFunction(() => document.querySelectorAll('#c-vibes .vibe-item').length === 2);
  ok(true, '卡片「Vibe 库」选一张放进创作页');
  await page.fill('#c-vibes .vibe-item[data-i="1"] [data-f="name"]', '水彩2');
  ok(await page.evaluate(() => VibeLib.list.some((x) => x.name === '水彩2')), '卡片上改名字，库里跟着改');
  // 卡片上加图也进库
  await page.click('#c-vibes [data-a="add"]');
  chooser = page.waitForEvent('filechooser');
  await page.click('[data-src="phone"]');
  await (await chooser).setFiles(img);
  await page.waitForFunction(() => document.querySelectorAll('#c-vibes .vibe-item').length === 3);
  ok(await page.evaluate(() => VibeLib.list.length === 3), '创作页卡片加的参考图也收进 Vibe 库');
  // 出图照常带上
  await page.fill('#c-tag', '1girl');
  await page.dispatchEvent('#c-tag', 'input');
  const n0 = bodies.length;
  await page.click('#c-draw');
  for (let i = 0; i < 40 && bodies.length === n0; i++) await page.waitForTimeout(100);
  ok(bodies.length > n0 && bodies[bodies.length - 1].parameters.reference_image_multiple_cached.length === 3, '用着的三张参考图都发出去了');
  // 删除：连数据、创作页一起
  const del = await page.evaluate(() => VibeLib.list.find((x) => x.name === '水彩2').id);
  await page.evaluate(() => VibeLib.open());
  await page.waitForSelector('.vl-row');
  await page.click('.vl-row[data-id="' + del + '"] .vl-name');
  await page.waitForSelector('.sheet [data-a="del"]');
  await page.click('.sheet [data-a="del"]');
  await page.click('#layers [data-yes]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(async (id) => !VibeLib.list.some((x) => x.id === id) && !UI.settings.nai.vibes.some((x) => x.id === id) && !(await Store.get('vibe:' + id, null)), del), '在库里删除：库、创作页、图和编码都删掉');
  ok((await page.$$('.vl-row')).length === 2 && (await page.$$('#c-vibes .vibe-item')).length === 2, '列表和卡片都刷新了');
  await page.evaluate(() => window.__appBack());

  // ---------- 灵感库 ----------
  await page.click('#c-inspo');
  await page.waitForSelector('.in-grid .empty');
  ok((await page.textContent('.in-grid')).includes('灵感库是空的'), '创作页有灵感库入口，空的时候有说明');
  await page.click('[data-new]');
  await page.fill('#layers [data-f="name"]', '赛博夜景');
  await page.click('[data-cat="场景"]');
  await page.fill('textarea[data-f="tags"]', 'neon lights, rain, night city');
  await page.fill('textarea[data-f="negative"]', 'daylight');
  // 预览图从 App 图库选
  await page.click('[data-p="gallery"]');
  await page.waitForSelector('.sheet .thumb');
  await page.click('.sheet .thumb');
  await page.waitForSelector('.in-pv img.in-big');
  ok(await page.$eval('.in-pv img', (e) => e.src.startsWith('data:image/jpeg')), '预览图从图库选，存成 JPEG');
  await page.click('[data-save]');
  await page.waitForSelector('.in-card');

  await page.click('[data-new]');
  await page.fill('#layers [data-f="name"]', '厚涂');
  await page.fill('[data-f="cat"]', '我的画风');
  await page.fill('textarea[data-f="tags"]', 'impasto, oil painting');
  // 用这段出一张
  const n1 = bodies.length;
  await page.click('[data-p="draw"]');
  await page.waitForSelector('.in-pv img.in-big', { timeout: 8000 });
  ok(bodies.length === n1 + 1 && bodies[bodies.length - 1].input.includes('impasto, oil painting'), '「用这段出一张」用这段提示词出图当预览');
  await page.click('[data-save]');
  await page.waitForFunction(() => document.querySelectorAll('.in-card').length === 2);
  ok((await page.textContent('.in-cats')).includes('我的画风 1') && (await page.textContent('.in-cats')).includes('场景 1'), '自己起的分类也出现在分类标签里');
  await page.screenshot({ path: path.join(OUT, '灵感库.png') });

  // 搜索、分类
  await page.fill('.in-q', 'rain');
  await page.waitForTimeout(300);
  ok((await page.$$('.in-card')).length === 1, '搜索标签');
  await page.fill('.in-q', '');
  await page.waitForTimeout(300);
  await page.click('.in-cats [data-c="我的画风"]');
  ok((await page.$$('.in-card')).length === 1 && (await page.textContent('.in-card')).includes('厚涂'), '按分类筛选');
  await page.click('.in-cats [data-c=""]');

  // 加进创作页：并进去不重复，负面进补充负面词
  await page.fill('#c-tag', '1girl, rain');
  await page.fill('#c-neg', '');
  await page.click('.in-card:has-text("赛博夜景")');
  await page.waitForSelector('.sheet [data-a="use"]');
  await page.click('.sheet [data-a="use"]');
  await page.waitForTimeout(200);
  ok(await page.inputValue('#c-tag') === '1girl, rain, neon lights, night city' && await page.inputValue('#c-neg') === 'daylight', '加进创作页：正面并进去不重复、负面进补充负面词');
  ok(!(await page.$('.in-grid')), '加完自动关掉灵感库');
  ok(await page.evaluate(() => CreatePage.draft.tag === '1girl, rain, neon lights, night city'), '草稿跟着存');

  // 大图「存灵感」：带上提示词和图
  await page.evaluate(async () => GalleryPage.openViewer((await Gallery.list())[0].id));
  await page.waitForSelector('[data-quick] button');
  const btn = await page.$$eval('[data-quick] button', (bs) => bs.findIndex((b) => b.textContent.includes('存灵感')));
  ok(btn >= 0, '大图下面有「存灵感」');
  await page.click('[data-quick] button:has-text("存灵感")');
  await page.waitForSelector('[data-save]');
  ok((await page.inputValue('textarea[data-f="tags"]')).includes('impasto') && await page.$('.in-pv img.in-big'), '存灵感：预填这张图的提示词和图');
  await page.fill('#layers [data-f="name"]', '从图库存的');
  await page.click('[data-save]');
  await page.waitForTimeout(400);

  // 重开还在；进备份
  await page.reload();
  await page.waitForSelector('#c-inspo');
  const bk = await page.evaluate(async () => Object.keys((await Backup.build(false)).data));
  ok(bk.includes('inspo') && bk.includes('vibeLib'), '灵感库、Vibe 库都进设置备份');
  ok(await page.evaluate(() => VibeLib.list.length === 2), '重开后 Vibe 库还在');

  await browser.close();
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fails.length) { console.log('\n失败 ' + fails.length + ' 项：\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
