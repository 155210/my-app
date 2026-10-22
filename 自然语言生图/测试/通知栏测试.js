// 通知栏进度测试：出图时外壳收到的进度（第几张 / 一共几张、排队、限流倒计时）、出完的「出好了」、取消、关掉提醒
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/通知栏测试.js
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
  const idle = () => page.waitForFunction(() => { const s = Queue.state(); return s.running + s.waiting === 0; }, null, { timeout: 30000 });
  // 假外壳：只装通知相关的方法（fetch 照样走浏览器）
  await page.evaluate(() => {
    window.__log = { prog: [], done: [], keep: [] };
    window.AndroidBridge = {
      queueProgress: (t, x, e, n) => __log.prog.push({ t, x, e, n }),
      queueDone: (t, x) => __log.done.push({ t, x }),
    };
  });
  const log = () => page.evaluate(() => window.__log);
  const reset = () => page.evaluate(() => { __log.prog = []; __log.done = []; });

  // 一次 3 张
  await page.selectOption('#c-count', '3');
  await page.click('#c-draw');
  await idle();
  let L = await log();
  ok(L.prog.length >= 3, '出图时外壳收到进度更新（' + L.prog.length + ' 次）');
  ok(L.prog[0].t === '正在出图 1 / 3' && L.prog[0].n === 3, '第一条：正在出图 1 / 3（' + L.prog[0].t + '）');
  ok(/排队 2 张/.test(L.prog[0].x), '内容里有排队几张（' + L.prog[0].x + '）');
  ok(L.prog.some((p) => p.t === '正在出图 3 / 3' && p.e === 2), '出到第三张时进度 2 / 3');
  ok(!L.done.length, '还没确认结束前不弹「出好了」');
  await sleep(1800);
  L = await log();
  ok(L.done.length === 1 && L.done[0].t === '出好了 3 张图', '出完弹一条「出好了 3 张图」（' + JSON.stringify(L.done) + '）');

  // 限流：进度里有倒计时
  await reset();
  fail429 = 1;
  await page.selectOption('#c-count', '1');
  await page.click('#c-draw');
  await page.waitForFunction(() => __log.prog.some((p) => /限流了，\d+ 秒后自动重试/.test(p.x)), null, { timeout: 10000 });
  ok(true, '限流时通知里显示倒计时');
  await idle();
  await sleep(1800);
  L = await log();
  ok(L.prog.every((p) => p.n === 1), '只出 1 张时一共 = 1（外壳转圈）');
  ok(L.done.length === 1 && L.done[0].t === '出好了 1 张图', '限流重试成功后也弹「出好了」');

  // 取消：一轮里出 1 张、取消 2 张
  await reset();
  delay = 800;
  await page.selectOption('#c-count', '3');
  await page.click('#c-draw');
  await page.waitForFunction(() => Queue.state().running === 1);
  await sleep(1100);
  await page.evaluate(() => Queue.cancelAll());
  await idle();
  await sleep(1800);
  L = await log();
  ok(L.done.length === 1 && /取消 \d 张/.test(L.done[0].x), '有取消的：提醒里写取消几张（' + JSON.stringify(L.done) + '）');
  delay = 300;

  // 设置里关掉「出完提醒」
  await reset();
  await page.click('#btn-settings');
  await page.click('.tabs button[data-tab="queue"]');
  ok(await page.isChecked('[data-k="nai.doneNotify"]'), '设置页「出图队列」有「出完了在通知栏提醒」，默认开');
  await page.click('label.check:has([data-k="nai.doneNotify"]) .switch');
  ok(!(await page.isChecked('[data-k="nai.doneNotify"]')), '能关掉');
  await page.click('.page-head [data-close]');
  await page.click('#c-draw');
  await idle();
  await sleep(1800);
  L = await log();
  ok(L.prog.length > 0 && !L.done.length, '关掉后还显示进度，但不弹「出好了」');

  // 写提示词期间
  await reset();
  await page.evaluate(() => { Queue.Busy.on(); });
  await sleep(300);
  L = await log();
  ok(L.prog.length && L.prog[L.prog.length - 1].t === 'AI 正在写提示词', '只在写提示词时通知显示「AI 正在写提示词」');
  await page.evaluate(() => { Queue.Busy.off(); });

  ok(await page.evaluate(() => Help.list.some((e) => e.id === 'queue.notify')), '说明里有「通知栏进度」');

  await browser.close();
  srv.close();
  if (fails.length) { console.log('\n失败 ' + fails.length + ' 项'); process.exit(1); }
  console.log('\n全部通过');
})();
