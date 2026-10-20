// A 组（出图参数 + 画风模板）无头浏览器测试：V3/V4 请求结构、尺寸预设、锁定种子、画风模板、Anlas 余额
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/出图参数测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');
const OUT = process.env.OUT || require('os').tmpdir();

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

// 1×1 PNG（NAI 直接回图片也认）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  let anlas = 1000, subCalls = 0; const bodies = [];
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) {
      subCalls++;
      return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: anlas, purchasedTrainingSteps: 5 } }) });
    }
    bodies.push(JSON.parse(req.postData()));
    anlas -= 20;
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-quick select');

  // ---------- 纯函数 ----------
  const u = await page.evaluate(() => {
    const r = {};
    const base = Params.normalize({ nai: { key: 'k' } });
    r.defStyle = base.nai.styleId === 'st_default' && Nai.fullPrompts(base.nai, { tag: 'cat' }).positive.startsWith('0.8::nnmbpx::');
    // 旧版画师串自动搬进模板
    const old = Params.normalize({ nai: { artist: 'artist:foo', styles: [] } });
    r.migrate = old.nai.styles.filter((x) => !x.blank).length === 1 && old.nai.styles[0].prefix === 'artist:foo' && old.nai.styleId === old.nai.styles[0].id && old.nai.artist === '';
    // 前缀 / 后缀 / 负面
    const n = Object.assign({}, base.nai, { styles: [{ id: 's1', name: '平涂', prefix: 'artist:a', suffix: 'flat color', negative: '3d' }], styleId: 's1' });
    const fp = Nai.fullPrompts(n, { tag: 'cat', negative: 'dog' });
    r.pos = fp.positive; r.negTail = fp.negative.slice(-9);
    r.noStyle = Nai.fullPrompts(Object.assign({}, n, { styleId: '' }), { tag: 'cat' }).positive.startsWith('cat, ');
    r.meta = Nai.buildBody(n, { tag: 'cat' }).meta.style;
    // 模板绑定的质量词 / 负面提示词：填了用模板的，留空跟「NAI 出图」页
    const nb = Object.assign({}, n, { quality: 'global q', styles: [{ id: 's1', name: 'x', prefix: '', quality: 'tpl q', uc: 'tpl uc', suffix: '', negative: 'extra' }] });
    const fb = Nai.fullPrompts(nb, { tag: 'cat', negative: 'dog' });
    const fc = Nai.fullPrompts(Object.assign({}, nb, { styles: [{ id: 's1', name: 'x', prefix: '', quality: '', uc: '', suffix: '', negative: '' }] }), { tag: 'cat' });
    r.bound = fb.positive === 'cat, tpl q' && fb.negative === 'tpl uc, extra, dog' && fc.positive === 'cat, global q' && fc.negative === Params.NEGATIVE[nb.model];
    // V3：没有 v4_prompt，有 sm；默认质量词
    const v3 = Nai.buildBody(Object.assign({}, n, { model: 'nai-diffusion-3', styleId: '' }), { tag: 'cat', nl: 'A cat.' }).body;
    r.v3 = !v3.parameters.v4_prompt && v3.parameters.sm === false && Array.isArray(v3.parameters.reference_image_multiple) && v3.parameters.params_version === 3
      && v3.input === 'cat, best quality, amazing quality, very aesthetic, absurdres' && v3.parameters.negative_prompt.includes('{bad}');
    // V4：有 v4_prompt，不接英文描述
    const v4 = Nai.buildBody(Object.assign({}, n, { model: 'nai-diffusion-4-full', styleId: '' }), { tag: 'cat', nl: 'A cat.' }).body;
    r.v4 = !!v4.parameters.v4_prompt && !v4.input.includes('A cat.') && v4.input.endsWith('absurdres');
    // V5 不支持 DDIM：自动换成 Euler Ancestral
    const v5 = Nai.buildBody(Object.assign({}, n, { sampler: 'ddim_v3' }), { tag: 'cat' }).body.parameters;
    r.v5ddim = v5.sampler === 'k_euler_ancestral' && v5.prefer_brownian === true;
    r.v5samplers = Params.samplersFor('nai-diffusion-5-full').every((x) => x.value !== 'ddim_v3') && Params.samplersFor('nai-diffusion-3').some((x) => x.value === 'ddim_v3');
    r.badModel = Params.normalize({ nai: { model: 'nai-diffusion-9' } }).nai.model === 'nai-diffusion-5-full';
    r.sizes = Params.SIZES.every((x) => { try { Params.parseSize(x.value); return true; } catch (e) { return false; } });
    return r;
  });
  ok(u.defStyle, '新用户默认用内置画风模板');
  ok(u.migrate, '旧版画师串自动搬成一套模板并选中');
  ok(u.pos === 'artist:a, cat, flat color, very aesthetic, masterpiece, no text', '正面 = 前缀, 标签, 后缀, 质量词：' + u.pos);
  ok(u.negTail === ', 3d, dog', '负面 = 通用, 模板负面, AI 补的');
  ok(u.noStyle, '不用模板时没有前缀');
  ok(u.meta === '平涂', '配方里记下用的模板名');
  ok(u.v3, 'V3 请求：不带 v4_prompt、带 sm，用 V3 默认质量词/负面词');
  ok(u.v4, 'V4 请求：带 v4_prompt，不接英文描述');
  ok(u.v5ddim, 'V5 选了 DDIM 自动换成 Euler Ancestral');
  ok(u.v5samplers, 'V5 的采样器列表里没有 DDIM');
  ok(u.badModel, '存了不认识的模型时回到 V5 Full');
  ok(u.sizes, '尺寸预设都合法');

  // ---------- 设置页 ----------
  await page.click('#btn-settings');
  await page.click('.tabs button[data-tab="nai"]');
  await page.fill('[data-k="nai.url"]', 'https://nai.test');
  await page.fill('[data-k="nai.key"]', 'pst-1');
  ok((await page.$$('[data-k="nai.model"] option')).length === 7, '模型下拉有 V5 / V4.5 / V4 / V3 共 7 个');
  await page.selectOption('[data-size="portraitSize"]', '1024×1536');
  ok(await page.evaluate(() => UI.settings.nai.portraitSize) === '1024×1536', '竖图尺寸选预设');
  await page.selectOption('[data-size="landscapeSize"]', '');
  ok(await page.isVisible('[data-k="nai.landscapeSize"]'), '选「自定义」出现输入框');
  await page.fill('[data-k="nai.landscapeSize"]', '1280×768');
  // 画风模板页：新建一套
  await page.click('[data-act="styles"]');
  await page.waitForSelector('[data-act="style-add"]');
  await page.click('[data-act="style-add"]');
  const cards = await page.$$('.style-card');
  ok(cards.length === 3, '新建一套模板（内置那套 + 空白 + 新的）');
  await page.fill('[data-k="nai.styles.2.name"]', '厚涂');
  await page.fill('[data-k="nai.styles.2.prefix"]', 'artist:thick');
  await page.fill('[data-k="nai.styles.2.negative"]', 'flat');
  await page.screenshot({ path: OUT + '/画风模板.png' });
  await page.click('.page-head [data-close]');

  // ---------- 创作页快捷栏 ----------
  await page.waitForTimeout(300);
  ok(await page.$eval('[data-q="style"]', (s) => s.options[s.selectedIndex].text) === '厚涂', '快捷栏画风跟着设置变');
  await page.selectOption('[data-q="model"]', 'nai-diffusion-4-5-full');
  ok(await page.evaluate(() => UI.settings.nai.model) === 'nai-diffusion-4-5-full', '快捷栏切模型');
  ok(await page.$eval('[data-q="size"]', (s) => s.value) === '1024×1536', '快捷栏显示竖图尺寸');
  await page.click('#c-size button[data-v="landscape"]');
  await page.waitForTimeout(50);
  ok(await page.$eval('[data-q="size"]', (s) => s.value) === '1280×768', '切横图后显示横图尺寸（自定义的）');
  await page.click('#c-size button[data-v="portrait"]');
  await page.waitForTimeout(50);

  // 出图 → 锁定种子 → 再出图种子相同；Anlas 自动刷新
  await page.fill('#c-tag', '1girl, smile');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-draw');
  await page.waitForFunction(() => document.querySelector('#c-result img'), null, { timeout: 8000 });
  const b1 = bodies[bodies.length - 1];
  ok(b1.input.startsWith('artist:thick, 1girl, smile') && b1.parameters.negative_prompt.endsWith('flat') && b1.parameters.height === 1536, '出图请求用了新模板和尺寸');
  await page.waitForFunction(() => !document.querySelector('#anlas-chip').hidden && document.querySelector('#anlas-chip').textContent.includes('985'), null, { timeout: 5000 });
  ok(true, '出图后 Anlas 自动刷新（985）');
  await page.click('[data-q="seed"]');
  ok(await page.evaluate(() => UI.settings.nai.seed) === b1.parameters.seed, '一键锁定上一张的种子');
  ok((await page.textContent('[data-q="seed"]')).includes('已锁定'), '种子按钮显示已锁定');
  await page.click('#c-draw');
  await page.waitForTimeout(500);
  ok(bodies.length === 2 && bodies[1].parameters.seed === b1.parameters.seed, '锁定后再出一张种子相同');
  await page.screenshot({ path: OUT + '/快捷栏.png', fullPage: true });
  await page.click('[data-q="seed"]');
  ok(await page.evaluate(() => UI.settings.nai.seed) === 0, '再点一下解锁');

  // 重开：设置都在，启动时查余额
  await page.waitForTimeout(400);
  const before = subCalls;
  await page.reload();
  await page.waitForSelector('#c-quick select');
  await page.waitForFunction(() => !document.querySelector('#anlas-chip').hidden, null, { timeout: 5000 });
  ok(subCalls > before, '启动时查一次 Anlas');
  const kept = await page.evaluate(() => [UI.settings.nai.styles.length, Nai.activeStyle(UI.settings.nai).name, UI.settings.nai.landscapeSize]);
  ok(kept[0] === 3 && kept[1] === '厚涂' && kept[2] === '1280×768', '重开后模板和尺寸还在');

  ok(u.bound, '画风模板绑定的质量词、负面提示词优先，留空跟 NAI 出图页');
  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
