// 创作页横竖：「AI 定」时按 AI 选的；点了竖图 / 横图就固定，AI 写完、拆多张都不改
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/横竖测试.js
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  let reply = '';
  const bodies = [];
  await page.route('https://ai.test/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
  });
  await page.route('https://nai.test/**', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ status: 404, headers: CORS, body: '' });
    bodies.push(JSON.parse(req.postData()));
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-write');
  await page.evaluate(() => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', key: 'k', model: 'm', stream: false });
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k' });
    UI.settings.autoDraw = true;
    UI.saveSettings(); CreatePage.refresh();
  });
  const on = () => page.$$eval('#c-size button.on', (bs) => bs.map((b) => b.dataset.v).join(','));
  const write = async (n) => {
    await page.click('#c-write');
    await page.waitForFunction((k) => document.querySelectorAll('#c-result img').length >= k, n, { timeout: 8000 });
  };
  reply = '{"tag":"1girl, rooftop","nl":"","negative":"","size":"landscape"}';

  ok(await on() === 'portrait,auto', '默认：AI 定');
  await page.fill('#c-desc', '天台上的女孩');
  await write(1);
  ok(await on() === 'landscape,auto' && bodies[0].parameters.width === 1216, 'AI 定时按 AI 选的横图出');

  await page.click('#c-size [data-v="portrait"]');
  ok(await on() === 'portrait', '点竖图：固定竖图，「AI 定」灭了');
  await write(2);
  ok(await on() === 'portrait' && bodies[1].parameters.width === 832, 'AI 回横图也不改，照竖图出');

  await page.click('#c-size [data-v="landscape"]');
  reply = '{"tag":"1girl","nl":"","negative":"","size":"portrait"}';
  await write(3);
  ok(await on() === 'landscape' && bodies[2].parameters.width === 1216, '固定横图：AI 回竖图也照横图出');

  // 重开页面还记得固定了
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('#c-write');
  ok(await on() === 'landscape', '重开后还是固定横图');

  await page.click('#c-size [data-v="auto"]');
  await write(1);
  ok((await on()).endsWith('auto') && (await on()).startsWith('portrait'), '点回「AI 定」：又按 AI 选的');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
