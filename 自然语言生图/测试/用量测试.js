// 用量统计（用量.js）的无头浏览器测试：出图后按天记张数和 Anlas、统计页、当天明细、清空
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/用量测试.js
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
  let tier = 0, fail = false;
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) {
      return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ tier, active: true, trainingStepsLeft: 500 }) });
    }
    if (fail) return r.fulfill({ status: 500, headers: CORS, body: 'x' });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');
  await page.evaluate(() => {
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full', steps: 28, portraitSize: '832×1216', seed: 0 });
  });
  await page.evaluate(() => QuickBar.refreshAnlas(true));

  // ---------- 认请求、估花费 ----------
  const e = await page.evaluate(() => ({
    gen: Usage.entryFor('https://nai.test/ai/generate-image', JSON.stringify({ model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { width: 832, height: 1216, steps: 28, n_samples: 1 } })),
    ref: Usage.entryFor('https://nai.test/ai/generate-image', JSON.stringify({ model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { width: 832, height: 1216, steps: 28, n_samples: 1, director_reference_images: ['a'] } })),
    i2i: Usage.entryFor('https://nai.test/ai/generate-image', JSON.stringify({ model: 'nai-diffusion-4-5-full', action: 'img2img', parameters: { width: 832, height: 1216, steps: 28, strength: 0.5 } })),
    up: Usage.entryFor('https://api.novelai.net/ai/upscale', JSON.stringify({ width: 512, height: 512, scale: 4 })),
    tool: Usage.entryFor('https://nai.test/ai/augment-image', JSON.stringify({ req_type: 'bg-removal', width: 832, height: 1216 })),
    vibe: Usage.entryFor('https://nai.test/ai/encode-vibe', '{}'),
    sub: Usage.entryFor('https://nai.test/user/subscription', null),
    std: Cost.image({ width: 832, height: 1216, steps: 28, model: 'nai-diffusion-4-5-full' }, { opus: false, active: true }),
  }));
  ok(e.gen.k === 'generate' && e.gen.n === 1 && e.gen.a === e.std, '出图按官网算法估：' + e.gen.a);
  ok(e.ref.a === e.std + 5, '角色参考每张 +5');
  ok(e.i2i.k === 'img2img' && e.i2i.a === Math.ceil(e.std * 0.5), '图生图按强度打折：' + e.i2i.a);
  ok(e.up.k === 'upscale' && e.up.a === 1, '放大 512×512 = 1');
  ok(e.tool.k === 'tool' && e.tool.x === '去背景' && e.tool.a > 5, '图像工具认出名字和花费');
  ok(e.vibe.k === 'vibe' && e.vibe.a === 2 && e.vibe.n === 0, '参考图编码 2 Anlas、不算张数');
  ok(e.sub === null, '查余额不记账');

  // ---------- 真出图：成功的记，失败的不记 ----------
  await page.fill('#c-tag', '1girl, smile');
  await page.dispatchEvent('#c-tag', 'input');
  await page.selectOption('#c-count', '2');
  await page.click('#c-draw');
  await page.waitForFunction(() => document.querySelectorAll('#c-result .result').length >= 2, null, { timeout: 15000 });
  fail = true;
  await page.selectOption('#c-count', '1');
  await page.click('#c-draw');
  await page.waitForTimeout(1500);
  fail = false;
  const d = await page.evaluate(async () => { const u = await Usage.load(); return u.days[Usage.dayKey()]; });
  ok(d && d.n === 2, '出了 2 张记 2 张，失败的不记：' + (d && d.n));
  ok(d && d.anlas === e.std * 2, '花费合计 ' + (d && d.anlas));
  ok(d && d.kinds.generate === 2 && d.models['nai-diffusion-4-5-full'] === 2, '按种类、按模型都记了');
  ok(d && d.bal0 === 500, '记下当天看到的余额');

  // Opus 免费的记作免费
  tier = 3;
  await page.evaluate(() => QuickBar.refreshAnlas(true));
  await page.waitForTimeout(300);
  await page.evaluate(() => Object.assign(UI.settings.nai, { portraitSize: '832×1216' }));
  await page.click('#c-draw');
  await page.waitForFunction(() => document.querySelectorAll('#c-result .result').length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const d2 = await page.evaluate(async () => (await Usage.load()).days[Usage.dayKey()]);
  ok(d2.n === 3 && d2.free === 1 && d2.anlas === e.std * 2, 'Opus 免费的一张算张数不算 Anlas');

  // ---------- 统计页 ----------
  await page.evaluate(() => SettingsPage.open('usage'));
  await page.click('[data-act="usage-open"]');
  await page.waitForSelector('.u-chart');
  const txt = await page.evaluate(() => document.querySelector('#layers').innerText);
  ok(txt.includes('用量统计') && txt.includes('今天'), '统计页打开了');
  const bars = await page.evaluate(() => document.querySelectorAll('.u-chart .u-bar').length);
  ok(bars === 30, '默认近 30 天：' + bars);
  await page.click('#u-range button[data-v="7"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelectorAll('.u-chart .u-bar').length) === 7, '切到 7 天');
  await page.click('#u-metric button[data-v="a"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector('.u-chart').getAttribute('aria-label').includes('Anlas')), '切到 Anlas');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(wide, '手机宽度不横向滚动');
  await page.click('.u-chart .u-bar.today .u-fill');
  await page.waitForSelector('.sheet .u-items');
  const day = await page.evaluate(() => document.querySelector('.sheet').innerText);
  ok(day.includes('按种类') && day.includes('出图') && day.includes('免费') && day.includes('500 → 500'), '当天明细有种类、每一笔、余额');
  if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, '用量明细.png') });
  await page.click('.sheet [data-close]');
  if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, '用量统计.png') });

  // 新出一张，开着的统计页自己刷新
  await page.evaluate(() => Usage.record({ k: 'upscale', n: 1, a: 1, w: 512, h: 512 }));
  await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => document.querySelector('.u-stats b').textContent);
  ok(t2 === '4', '开着的统计页跟着刷新：' + t2);

  // 清空
  await page.click('[data-act="clear"]');
  await page.click('.dialog [data-yes]');
  await page.waitForTimeout(300);
  const d3 = await page.evaluate(async () => (await Usage.load()).days);
  ok(!Object.keys(d3).length, '清空了');

  // 进备份
  const bk = await page.evaluate(async () => { await Usage.record({ k: 'generate', n: 1, a: 3 }); return Object.keys((await Store.dumpAll())).includes('usage'); });
  ok(bk, '用量存在 usage 键里（进设置备份）');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项' : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})();
