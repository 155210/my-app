// 创作页「出的图打上标签」：选了一直记着，出的图都放进那个相册；图库点标签能全选删掉
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/出图标签测试.js
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
const fails = [];
// waitForFunction 遇到 async 函数会直接当成真，这里自己轮询
async function until(page, fn, arg, ms) { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (await page.evaluate(fn, arg)) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('等太久：' + fn); }
const galleryLen = async (n) => (await Gallery.list()).length === n; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 0 } }) });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });
  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(url);
  await page.waitForSelector('#c-album');
  await page.evaluate(async () => { UI.settings.nai.url = 'https://nai.test'; UI.settings.nai.key = 'k'; await UI.saveSettings(); await Gallery.setPrefs({ jpg: false }); });

  const n = await page.$$eval('#c-album option', (o) => o.map((x) => x.textContent));
  ok(n.join() === '不加,＋ 新标签…', '默认「不加」，能新建：' + n.join());

  // 不加标签出一张
  await page.fill('#c-tag', '1girl, smile');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-draw');
  await until(page, galleryLen, 1);

  // 新建「4.5底图」
  await page.selectOption('#c-album', '+');
  await page.waitForSelector('.layer [data-v]');
  await page.fill('.layer [data-v]', '4.5底图');
  await page.click('.layer [data-ok]');
  await page.waitForFunction(() => document.querySelector('#c-album').selectedOptions[0].textContent === '4.5底图');
  ok(true, '新建标签后自动选上');

  // 一次出 2 张，都带标签
  await page.selectOption('#c-count', '2');
  await page.click('#c-draw');
  await until(page, galleryLen, 3);
  const r1 = await page.evaluate(async () => { const a = (await Gallery.albums())[0]; const l = await Gallery.list(); return { name: a.name, tagged: l.filter((x) => (x.albums || []).includes(a.id)).length, first: !!l[2].albums }; });
  ok(r1.name === '4.5底图' && r1.tagged === 2 && !r1.first, '之后出的 2 张进了标签，之前那张没有');

  // 重开 App 还选着
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('#c-album');
  await page.waitForFunction(() => document.querySelector('#c-album').selectedOptions[0].textContent === '4.5底图');
  ok(true, '重开 App 标签还选着');

  // 图库里新建相册，创作页下拉跟着有
  await page.evaluate(() => Gallery.addAlbum('壁纸'));
  await page.waitForFunction(() => [...document.querySelectorAll('#c-album option')].some((o) => o.textContent === '壁纸'));
  ok(await page.$eval('#c-album', (s) => s.selectedOptions[0].textContent) === '4.5底图', '图库新建相册后下拉更新，选的不变');

  // ---------- 跟着模型换 ----------
  const label = () => page.$eval('#c-album', (s) => s.selectedOptions[0].textContent);
  await page.selectOption('[data-q="model"]', 'nai-diffusion-4-5-full');
  await page.waitForTimeout(100);
  ok(await label() === '4.5底图', '没勾「跟着模型」：切模型标签不变');
  await page.click('label:has(#c-album-model) .switch');
  await page.waitForTimeout(100);
  ok(await label() === '4.5底图', '勾上后当前模型（4.5）接着用「4.5底图」');
  await page.selectOption('[data-q="model"]', 'nai-diffusion-5-full');
  await page.waitForFunction(() => document.querySelector('#c-album').value === '');
  ok(true, '切到 V5：还没选过，显示「不加」');
  await page.selectOption('#c-album', { label: '壁纸' });
  await page.selectOption('#c-count', '1');
  await page.waitForTimeout(100);
  await page.click('#c-draw');
  await until(page, galleryLen, 4);
  ok(await page.evaluate(async () => { const a = (await Gallery.albums()).find((x) => x.name === '壁纸'); return ((await Gallery.list())[0].albums || []).join() === a.id; }), 'V5 出的图进了「壁纸」');
  await page.selectOption('[data-q="model"]', 'nai-diffusion-4-5-full');
  await page.waitForFunction(() => document.querySelector('#c-album').selectedOptions[0].textContent === '4.5底图');
  ok(true, '切回 4.5 自动换回「4.5底图」');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('#c-album');
  await page.waitForFunction(() => document.querySelector('#c-album').selectedOptions[0].textContent === '4.5底图' && document.querySelector('#c-album-model').checked);
  await page.selectOption('[data-q="model"]', 'nai-diffusion-5-full');
  await page.waitForFunction(() => document.querySelector('#c-album').selectedOptions[0].textContent === '壁纸');
  ok(true, '重开 App 勾选和每个模型的标签都还在');
  await page.click('label:has(#c-album-model) .switch');
  await page.selectOption('[data-q="model"]', 'nai-diffusion-4-5-full');
  await page.waitForTimeout(100);
  ok(await label() === '壁纸', '取消勾选：留下当前那个，切模型不再变');
  await page.selectOption('#c-album', { label: '4.5底图' });
  await page.evaluate(async () => { const l = await Gallery.list(); await Gallery.removeMany([l[0].id]); });

  // 图库：点标签 → 全选 → 删除
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForSelector('#g-views');
  const id = await page.evaluate(async () => (await Gallery.albums())[0].id);
  await page.click('#g-views [data-view="' + id + '"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  ok(true, '图库点「4.5底图」只看这 2 张');
  await page.screenshot({ path: OUT + '/出图标签-图库.png' });
  await page.evaluate(() => GalleryPage.startSelect());
  await page.click('#g-sel-all');
  const delBtn = await page.$('[data-sel-act="del"], #g-sel-del');
  if (delBtn) await delBtn.click(); else fails.push('找不到删除按钮');
  await page.waitForSelector('.layer .btn.danger');
  await page.click('.layer .btn.danger');
  await until(page, galleryLen, 1);
  ok(true, '全选删掉标签里的 2 张，别的图还在');

  // 删掉相册后创作页回到「不加」
  await page.evaluate(async () => Gallery.removeAlbum((await Gallery.albums())[0].id));
  await page.waitForFunction(() => document.querySelector('#c-album').value === '');
  ok(true, '标签删了，创作页回到「不加」');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
