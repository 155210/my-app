// 订阅 / Anlas 接口测试：官方站先查 image.novelai.net/user/subscription，api.novelai.net 回 400 时不再报错
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/订阅测试.js
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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const json = (o, status) => ({ status: status || 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(o) });

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage();
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  let imageMode = 'ok'; const hits = [];
  await page.route('https://image.novelai.net/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    hits.push(r.request().url());
    if (imageMode === '404') return r.fulfill({ status: 404, headers: CORS, body: '' });
    if (imageMode === '401') return r.fulfill(json({ message: 'Unauthorized' }, 401));
    return r.fulfill(json({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 10000, purchasedTrainingSteps: 50 } }));
  });
  await page.route('https://api.novelai.net/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    hits.push(r.request().url());
    if (imageMode === '404') return r.fulfill(json({ tier: 2, active: true, trainingStepsLeft: 777 }));
    return r.fulfill(json({ statusCode: 400, message: 'Please refresh NovelAI.net. If using a third-party tool, update to the image URL.' }, 400));
  });
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForFunction(() => window.Nai && window.Params);

  const run = () => page.evaluate(async () => {
    try { return await Nai.test(Params.normalize({ nai: { url: 'https://image.novelai.net/', key: 'pst-1' } }).nai); } catch (e) { return '错误：' + e.message; }
  });

  let msg = await run();
  ok(/Opus/.test(msg) && /10050/.test(msg), '官方站：走 image.novelai.net/user/subscription，显示 Anlas：' + msg);
  ok(hits[0] === 'https://image.novelai.net/user/subscription' && !hits.some((u) => u.includes('api.novelai.net')), '查到了就不再请求 api.novelai.net');

  imageMode = '404'; hits.length = 0;
  msg = await run();
  ok(/Scroll/.test(msg) && /777/.test(msg), '新地址 404 时退回老地址，trainingStepsLeft 是数字也认：' + msg);

  imageMode = '401';
  msg = await run();
  ok(/Key 不对/.test(msg), 'Key 错时提示 Key 不对，而不是 400 那句：' + msg);

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
