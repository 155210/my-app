// 出图队列测试：并发数、限流（429）自动等待重试、一次出多张、取消、失败重试、重绘
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/队列测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');
const OUT = process.env.OUT || require('os').tmpdir();

// 本地静态服务
const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

// 造一张 64x96 的 PNG（纯色）
function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 120; raw[o + 2] = 60; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
function zip(name, data, method) {
  const comp = method === 8 ? zlib.deflateRawSync(data) : data;
  const nm = Buffer.from(name), crc = crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(0, 42);
  const local = Buffer.concat([lh, nm, comp]); const central = Buffer.concat([cd, nm]);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(1, 8); e.writeUInt16LE(1, 10); e.writeUInt32LE(central.length, 12); e.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, e]);
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });

  // 假 NAI：mode 控制行为；记录同时在出的最大数、每次请求的种子
  let mode = 'ok', delay = 300, inflight = 0, maxInflight = 0, seeds = [], calls = 0, fail429 = 0, fail500 = 0;
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    // 出图后自动查 Anlas 的 GET，不算出图
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: '{"tier":3,"active":true,"trainingStepsLeft":100}' });
    calls++;
    seeds.push(JSON.parse(req.postData()).parameters.seed);
    if (fail429 > 0) { fail429--; return r.fulfill({ status: 429, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"Concurrent generation is locked"}' }); }
    if (fail500 > 0) { fail500--; return r.fulfill({ status: 500, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"boom"}' }); }
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    await sleep(delay);
    inflight--;
    try { await r.fulfill({ headers: { ...CORS, 'content-type': 'application/x-zip-compressed' }, body: zip('image_0.png', png(64, 96), 8) }); } catch (e) { /* 已取消 */ }
  });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-write');
  await page.evaluate(() => { Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k' }); UI.saveSettings(); });
  await page.fill('#c-tag', '1girl, smile');
  await page.dispatchEvent('#c-tag', 'input');
  const count = () => page.evaluate(async () => (await Gallery.list()).length);
  const idle = () => page.waitForFunction(() => { const s = Queue.state(); return s.running + s.waiting === 0; }, null, { timeout: 30000 });

  // 设置页有「出图队列」标签，默认并发 1
  await page.click('#btn-settings');
  await page.click('.tabs button[data-tab="queue"]');
  ok(await page.inputValue('[data-k="nai.concurrency"]') === '1', '设置页有「出图队列」，默认同时出 1 张');
  ok(await page.isChecked('[data-k="nai.retry429"]'), '默认开着限流自动重试');
  await page.click('.page-head [data-close]');

  // 一次出 3 张，并发 1，锁定种子 → 依次出、种子 +1
  await page.evaluate(() => { UI.settings.nai.seed = 100; });
  await page.selectOption('#c-count', '3');
  await page.click('#c-draw');
  await page.waitForFunction(() => /排队 2 张/.test(document.querySelector('#c-status').textContent));
  ok(!(await page.$eval('#c-cancel', (b) => b.hidden)), '出图时显示「全部取消」');
  await idle();
  ok(await count() === 3, '一次出 3 张，图库有 3 张');
  ok(maxInflight === 1, '并发 1 时同时只有 1 个请求（最多 ' + maxInflight + '）');
  ok(seeds.join(',') === '100,101,102', '锁定种子一次出多张：种子依次 +1（' + seeds.join(',') + '）');
  await page.waitForFunction(() => document.querySelectorAll('#c-result .result').length === 3, null, { timeout: 3000 }).catch(() => {});
  ok((await page.$$('#c-result .result')).length === 3, '创作页显示本次出的 3 张');
  await page.evaluate(() => { UI.settings.nai.seed = 0; });

  // 并发 2
  maxInflight = 0; seeds = [];
  await page.evaluate(() => { UI.settings.nai.concurrency = '2'; });
  await page.selectOption('#c-count', '4');
  await page.click('#c-draw');
  await idle();
  ok(maxInflight === 2, '并发 2 时同时 2 个请求（最多 ' + maxInflight + '）');
  ok(new Set(seeds).size === 4, '不锁种子时每张种子不同');
  await page.evaluate(() => { UI.settings.nai.concurrency = '1'; });

  // 限流：前 1 次 429，自动等待后重试成功
  const before = await count();
  calls = 0; fail429 = 1;
  await page.selectOption('#c-count', '1');
  await page.click('#c-draw');
  await page.waitForFunction(() => /限流等待 \d+ 秒/.test(document.querySelector('#c-status').textContent), null, { timeout: 5000 });
  await page.click('#c-queue');
  ok(/限流了，\d+ 秒后自动重试/.test(await page.textContent('[data-q-list]')), '队列面板显示限流倒计时');
  await sleep(400);
  await page.screenshot({ path: OUT + '/队列-限流.png' });
  await page.click('.sheet [data-close]');
  await idle();
  ok(await count() === before + 1 && calls === 2, '429 后自动等待重试成功（请求 ' + calls + ' 次）');

  // 关掉自动重试：429 直接失败
  calls = 0; fail429 = 1;
  await page.evaluate(() => { UI.settings.nai.retry429 = false; });
  await page.click('#c-draw');
  await idle();
  ok(calls === 1 && (await page.evaluate(() => Queue.state().failed)) === 1, '关掉自动重试时 429 直接算失败');
  await page.evaluate(() => { UI.settings.nai.retry429 = true; Queue.clearFailed(); });

  // 取消：排 3 张，全部取消 → 一张都不进图库
  delay = 1500;
  const b2 = await count();
  await page.selectOption('#c-count', '3');
  await page.click('#c-draw');
  await sleep(300);
  await page.click('#c-cancel');
  await idle();
  await sleep(1800);
  ok(await count() === b2, '生成中全部取消，不进图库');
  ok(await page.$eval('#c-cancel', (b) => b.hidden), '取消后「全部取消」按钮隐藏');

  // 单张取消：排 2 张，在面板里取消排队中的那张
  delay = 3000;
  await page.selectOption('#c-count', '2');
  await page.click('#c-draw');
  await page.click('#c-queue');
  await page.waitForSelector('.sheet [data-q-list]');
  ok(await page.locator('[data-q-list] [data-cancel]').count() === 2, '队列面板列出 2 张');
  // 面板里的行是复用的，状态变了按钮也不换；点「排队中」那一行的取消
  const btnBefore = await page.$('[data-q-list] .q-item:nth-child(2) [data-cancel]');
  await sleep(1100); // 让倒计时 / 状态刷新几次
  ok(await btnBefore.evaluate((b) => b.isConnected), '面板刷新后按钮还是同一个（不会点了没反应）');
  await page.locator('[data-q-list] .q-item', { hasText: '排队中' }).locator('[data-cancel]').click();
  await page.click('.sheet [data-close]');
  await idle();
  ok(await count() === b2 + 1, '取消排队中的 1 张，另 1 张照常出');

  // 失败 → 面板里重试
  delay = 100;
  const b3 = await count();
  fail500 = 1;
  await page.selectOption('#c-count', '1');
  await page.click('#c-draw');
  await idle();
  ok(await page.$eval('#c-queue', (b) => !b.hidden && /失败 1 张/.test(b.textContent)), '失败后创作页显示「失败 1 张」');
  await page.click('#c-queue');
  ok(/boom/.test(await page.textContent('[data-q-list]')), '面板里看到失败原因');
  await page.click('[data-q-list] [data-retry]');
  await idle();
  ok(await count() === b3 + 1, '点「重试」后出图成功');
  await page.click('.sheet [data-close]');

  // 重绘：同提示词、换种子
  seeds = [];
  await page.evaluate(() => { UI.settings.nai.seed = 555; });
  const b4 = await count();
  await page.click('#c-result .result [data-a="again"]');
  await idle();
  ok(await count() === b4 + 1 && seeds[0] !== 555, '「重绘」再出一张，种子换了（' + seeds[0] + '）');
  await page.screenshot({ path: OUT + '/队列-创作.png', fullPage: true });

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
