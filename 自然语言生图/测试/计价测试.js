// Anlas 预估 + V5 透明背景 + Furry 模式 的无头浏览器测试
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/计价测试.js
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
  let tier = 3, negative = false; const bodies = [];
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) {
      return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ tier, active: true, trainingStepsLeft: 500, usage: { percent: negative ? -3 : 40, isNegative: negative, timeUntilNextPercent: 3600 } }) });
    }
    bodies.push(JSON.parse(req.postData()));
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-quick select');

  // ---------- 纯算法（不看账号） ----------
  const u = await page.evaluate(() => {
    const r = {}, no = { opus: false, active: true };
    const v5 = 'nai-diffusion-5-full', v45 = 'nai-diffusion-4-5-full';
    r.v4std = Cost.image({ width: 832, height: 1216, steps: 28, model: v45 }, no);
    r.v5s = Cost.image({ width: 512, height: 768, steps: 23, model: v5 }, no);
    r.v5n = Cost.image({ width: 832, height: 1216, steps: 23, model: v5 }, no);
    r.v5l23 = Cost.image({ width: 1024, height: 1536, steps: 23, model: v5 }, no);
    r.v5l28 = Cost.image({ width: 1024, height: 1536, steps: 28, model: v5 }, no);
    r.i2i = Cost.image({ width: 832, height: 1216, steps: 28, model: v45, strength: 0.5 }, no);
    r.min2 = Cost.image({ width: 512, height: 512, steps: 1, model: v45, strength: 0.01 }, no);
    r.over = Cost.image({ width: 2048, height: 2048, steps: 50, model: v5 }, no);
    const op = { opus: true, active: true };
    r.opusFree = Cost.image({ width: 832, height: 1216, steps: 28, model: v45 }, op);
    r.opus29 = Cost.image({ width: 832, height: 1216, steps: 29, model: v45 }, op);
    r.opusBig = Cost.image({ width: 1024, height: 1536, steps: 28, model: v45 }, op);
    r.opusBatch = Cost.image({ width: 832, height: 1216, steps: 28, model: v45, n: 3 }, op);
    r.opusV5Empty = Cost.image({ width: 832, height: 1216, steps: 28, model: v5 }, { opus: true, active: true, usageEmpty: true });
    r.up = [Cost.upscale(512, 768), Cost.upscale(1024, 1024), Cost.upscale(1216, 832 * 2)];
    r.bg = Cost.tool('bg-removal', 832, 1216, op);
    r.line = [Cost.tool('lineart', 832, 1216, op), Cost.tool('lineart', 832, 1216, no)];
    r.label = [Cost.label(0), Cost.label(20)];
    return r;
  });
  ok(u.v4std === 20, 'V4.5 标准竖图 28 步 = 20：' + u.v4std);
  ok(u.v5s === 11 && u.v5n === 26 && u.v5l23 === 39 && u.v5l28 === 45, 'V5 小/标准/大 和实测一致（11/26/39/45）：' + [u.v5s, u.v5n, u.v5l23, u.v5l28]);
  ok(u.i2i === 10 && u.min2 === 2, '图生图按强度打折，最少 2');
  ok(u.over === -1, '单张超过 140 判超限');
  ok(u.opusFree === 0 && u.opus29 === 20 && u.opusBig > 0 && u.opusBatch === 40, 'Opus 免费规则（≤1MP、≤28 步、一次免一张）');
  ok(u.opusV5Empty === 30, 'Opus 额度透支后 V5 照常扣');
  ok(u.up.join() === '1,1,-1', '4 倍放大价格表：' + u.up);
  ok(u.bg === 65 && u.line[0] === 0 && u.line[1] === 20, '图像工具：去背景 3×价+5，其他 Opus 免费：' + u.bg + ',' + u.line);
  ok(u.label.join('|') === '免费|约 20 Anlas', '中文标签');

  // ---------- 创作页：按钮上的数字 ----------
  await page.evaluate(() => {
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-5-full', steps: 28, portraitSize: '832×1216' });
    UI.saveSettings(); CreatePage.refresh();
  });
  const tagText = () => page.evaluate(() => (document.querySelector('#c-draw .cost-tag') || {}).textContent);
  await page.waitForFunction(() => document.querySelector('#c-draw .cost-tag'));
  ok(/^(30 Anlas|免费)$/.test(await tagText()), '出图按钮上有花费：' + await tagText());
  tier = 3; await page.evaluate(() => QuickBar.refreshAnlas(true));
  await page.waitForFunction(() => document.querySelector('#c-draw .cost-tag').textContent === '免费');
  ok(true, 'Opus 账号、额度没用完 → 出图按钮显示免费');
  negative = true; await page.evaluate(() => QuickBar.refreshAnlas(true));
  await page.waitForFunction(() => document.querySelector('#c-draw .cost-tag').textContent === '30 Anlas');
  ok(true, 'Opus 额度透支 → 显示 30 Anlas');
  await page.selectOption('#c-count', '3');
  await page.waitForFunction(() => document.querySelector('#c-draw .cost-tag').textContent === '90 Anlas');
  ok(true, '改成 3 张 → 90 Anlas');
  // 别的功能注册的额外花费
  await page.evaluate(() => { Cost.addExtra(() => ({ perImage: 2, once: 4, label: '参考图' })); Cost.refresh(); });
  await page.waitForFunction(() => document.querySelector('#c-draw .cost-tag').textContent === '100 Anlas');
  const title = await page.getAttribute('#c-draw', 'title');
  ok(title.includes('参考图 10'), '额外花费进明细：' + title.replace(/\n/g, ' / '));

  // ---------- 透明背景 / Furry ----------
  await page.click('#c-quick label:has(input[data-q="transparent"])');
  await page.click('#c-quick label:has(input[data-q="furry"])');
  const b = await page.evaluate(() => {
    const n = UI.settings.nai;
    const v5 = Nai.buildBody(n, { tag: 'cat' }).body;
    const v45 = Nai.buildBody(Object.assign({}, n, { model: 'nai-diffusion-4-5-full', styleId: '' }), { tag: 'cat' }).body;
    const v3 = Nai.buildBody(Object.assign({}, n, { model: 'nai-diffusion-3', styleId: '' }), { tag: 'cat' }).body;
    return { saved: n.transparent && n.furry, v5in: v5.input, v5p: v5.parameters, v45in: v45.input, v45p: v45.parameters, v3in: v3.input };
  });
  ok(b.saved, '两个开关存进设置');
  ok(b.v5in.startsWith('fur dataset, ') && /cat, (.*, )?transparent background, very aesthetic/.test(b.v5in), 'V5：最前面 fur dataset，质量词前 transparent background：' + b.v5in.slice(0, 60) + '…');
  ok(b.v5p.tag_hint_transparent_background === true && b.v5p.straight_alpha === true && b.v5p.v4_prompt.caption.base_caption === b.v5in, 'V5 带透明通道参数');
  ok(b.v45in.startsWith('fur dataset, cat') && !b.v45in.includes('transparent') && !('straight_alpha' in b.v45p), 'V4.5 只有 Furry，没有透明背景');
  ok(!b.v3in.includes('fur dataset'), 'V3 不加 fur dataset');
  // 真出一张：请求里带上
  await page.fill('#c-tag', 'cat');
  await page.dispatchEvent('#c-tag', 'input');
  await page.selectOption('#c-count', '1');
  await page.click('#c-draw');
  await page.waitForFunction(() => document.querySelector('#c-result img'), null, { timeout: 8000 });
  const last = bodies[bodies.length - 1];
  ok(last && last.parameters.straight_alpha === true && last.input.startsWith('fur dataset'), '实际出图请求带透明背景和 fur dataset');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
