// 图生图与编辑 无头浏览器测试：图生图、局部重绘（涂遮罩）、精修（含 V5 MAX）、4 倍放大、6 个图像工具、对比滑块、大图快捷按钮、创作页底图、花费标注
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/图生图测试.js
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

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-i2i');
  // 假 NAI 回的图：512×768 的 PNG（放大回 4 倍大小）
  const mkPng = (w, h) => page.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, w, h); g.fillStyle = '#33c'; g.fillRect(0, 0, w / 2, h); return c.toDataURL('image/png').split(',')[1]; }, [w, h]);
  const PNG = Buffer.from(await mkPng(512, 768), 'base64');
  const BIG = Buffer.from(await mkPng(2048, 3072), 'base64');
  const reqs = [];
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ status: 404, headers: CORS });
    const b = JSON.parse(req.postData());
    reqs.push({ url: req.url(), b });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: req.url().endsWith('/upscale') ? BIG : PNG });
  });
  const shot = (n) => process.env.SHOT ? page.screenshot({ path: path.join(process.env.SHOT, n + '.png') }) : null;
  const lastReq = () => reqs[reqs.length - 1];
  const waitReq = async (n) => { for (let i = 0; i < 80 && reqs.length < n; i++) await page.waitForTimeout(100); };
  const galleryLen = () => page.evaluate(async () => (await Gallery.list()).length);
  const waitGallery = async (n) => { for (let i = 0; i < 80 && await galleryLen() < n; i++) await page.waitForTimeout(100); };

  await page.evaluate(() => { Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full', styleId: '', portraitSize: '512x768' }); UI.saveSettings(); CreatePage.refresh(); });

  // ---------- 先出一张普通图 ----------
  await page.fill('#c-tag', '1girl, smile');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-draw');
  await waitGallery(1);
  ok(lastReq().b.action === 'generate', '普通出图 action 还是 generate');
  const first = await page.evaluate(async () => (await Gallery.list())[0]);

  // ---------- 大图快捷按钮 ----------
  await page.evaluate((id) => GalleryPage.openViewer(id), first.id);
  await page.waitForSelector('[data-quick] [data-q="edit"]');
  await page.waitForTimeout(400);
  await shot('1-大图');
  const quick = await page.$$eval('[data-quick] button', (bs) => bs.map((b) => b.textContent));
  ok(['编辑', '精修', '放大', '去背景', '工具'].every((k) => quick.some((t) => t.startsWith(k))), '大图下面有 编辑/精修/放大/去背景/工具：' + quick.join(' | '));
  ok(!quick.some((t) => t.startsWith('对比')), '普通图没有「对比原图」');
  ok(quick.filter((t) => /约 \d+|\d+ Anlas|免费/.test(t)).length >= 4, '要花 Anlas 的快捷按钮都标了花费');

  // ---------- 图生图 ----------
  await page.click('[data-quick] [data-q="edit"]');
  await page.waitForSelector('[data-modes] button.on');
  ok(await page.inputValue('[data-f="tag"]') === '1girl, smile', '编辑页带出原图的提示词');
  ok(/约 \d+ Anlas|免费/.test(await page.textContent('[data-size]')), '编辑页显示出图尺寸和花费：' + await page.textContent('[data-size]'));
  ok(/约 \d+|\d+ Anlas|免费/.test(await page.textContent('[data-go]')), '开始按钮上标了花费');
  await page.fill('[data-f="tag"]', '1girl, smile, hat');
  let n = reqs.length;
  await page.click('[data-go]');
  await waitReq(n + 1);
  let b = lastReq().b, p = b.parameters;
  ok(b.action === 'img2img' && typeof p.image === 'string' && p.image.length > 100, '图生图：action img2img，带底图');
  ok(p.width === 512 && p.height === 768, '图生图按原图尺寸出 512×768');
  ok(p.strength === 0.7 && p.noise === 0 && p.extra_noise_seed === p.seed, '强度 0.7、噪声 0、extra_noise_seed = 种子');
  ok(b.input.startsWith('1girl, smile, hat'), '用改过的提示词');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  ok(true, '做完自动打开前后对比');
  const res1 = await page.evaluate(async () => (await Gallery.list())[0]);
  ok(res1.meta.edit && res1.meta.edit.kind === 'img2img' && res1.meta.edit.from === first.id, '配方记下 edit（从哪张图来的）');
  // 对比滑块
  await shot('2-对比');
  const box = await page.$('[data-cmp]');
  const bb = await box.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height / 2, { steps: 4 });
  await page.mouse.up();
  const clip = await page.$eval('.cmp-before', (el) => el.style.clipPath);
  ok(/inset\(0(px)? 8\d(\.\d+)?% 0(px)? 0(px)?\)/.test(clip), '拖动分界线，处理前那张只剩左边：' + clip);
  await page.click('.layer:last-child [data-close]'); // 关对比
  await page.click('.layer:last-child [data-close]'); // 关编辑页

  // ---------- 局部重绘 ----------
  await page.click('[data-quick] [data-q="tools"]');
  await page.waitForSelector('.tool-item');
  await page.click('.tool-item[data-k="infill"]');
  await page.waitForSelector('[data-mask]:not([hidden])');
  n = reqs.length;
  await page.click('[data-go]');
  await page.waitForTimeout(300);
  ok(reqs.length === n, '没涂遮罩不发请求');
  await page.waitForTimeout(400);
  const mk = await (await page.$('[data-mask]')).boundingBox();
  await page.mouse.move(mk.x + mk.width * 0.3, mk.y + mk.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(mk.x + mk.width * 0.6, mk.y + mk.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await page.click('[data-go]');
  await waitReq(n + 1);
  b = lastReq().b; p = b.parameters;
  ok(b.action === 'infill' && b.model === 'nai-diffusion-4-5-full-inpainting', '局部重绘：action infill，模型换成 inpainting');
  ok(typeof p.mask === 'string' && p.strength === 1 && p.add_original_image === true, '带遮罩、强度 1、保留没涂的地方');
  const maskInfo = await page.evaluate(async (m) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + m; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let white = 0, black = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 200) white++; else if (d[i] < 50) black++; }
    return { w: img.width, h: img.height, white, black, corner: d[0], mid: (() => { const x = Math.round(c.width * 0.45), y = Math.round(c.height * 0.35); return d[(y * c.width + x) * 4]; })() };
  }, p.mask);
  await shot('3-重绘');
  ok(maskInfo.w === 512 && maskInfo.h === 768 && maskInfo.white > 0 && maskInfo.black > maskInfo.white, '遮罩图 512×768，黑底白涂');
  ok(maskInfo.corner === 0 && maskInfo.mid === 255, '涂过的地方是白的，没涂的是黑的');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');

  // 撤销、清空
  await page.click('[data-undo]');
  await page.click('[data-clear]');
  n = reqs.length;
  await page.click('[data-go]');
  await page.waitForTimeout(300);
  ok(reqs.length === n, '清空遮罩后不发请求');

  // ---------- 精修 ----------
  await page.click('[data-modes] [data-m="enhance"]');
  ok(await page.isHidden('[data-mask]'), '精修页不显示遮罩');
  const scales = await page.$$eval('[data-scale] button', (bs) => bs.map((x) => x.textContent));
  ok(scales.join() === '1 倍,1.5 倍,2 倍', '4.5 有 1 / 1.5 / 2 倍，没有 MAX：' + scales.join());
  await page.click('[data-scale] [data-v="1.5"]');
  ok((await page.textContent('[data-size]')).includes('512×768 → 768×1152'), '显示精修后尺寸');
  n = reqs.length;
  await page.click('[data-go]');
  await waitReq(n + 1);
  b = lastReq().b; p = b.parameters;
  ok(b.action === 'img2img' && p.width === 768 && p.height === 1152 && p.strength === 0.5, '精修 1.5 倍：图生图 768×1152，强度 0.5');
  ok(b.input === first.meta.positive && p.negative_prompt === first.meta.negative, '精修照原图那套提示词原样发');
  ok(!('upscaled_enhance' in p), '非 MAX 不带 upscaled_enhance');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');

  // V5 的 MAX
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-5-full'; });
  await page.click('[data-modes] [data-m="img2img"]');
  await page.click('[data-modes] [data-m="enhance"]');
  ok((await page.$$eval('[data-scale] button', (bs) => bs.map((x) => x.textContent))).includes('MAX'), 'V5 多一个 MAX');
  await page.click('[data-scale] [data-v="max"]');
  ok((await page.textContent('[data-size]')).includes('→ 1024×1536'), 'MAX 小图放到 2 倍');
  await shot('4-精修');
  const costMax = await page.textContent('[data-go]');
  n = reqs.length;
  await page.click('[data-go]');
  await waitReq(n + 1);
  b = lastReq().b; p = b.parameters;
  ok(p.upscaled_enhance === true && p.width === 512 && p.height === 768, 'MAX：按原尺寸发，带 upscaled_enhance');
  ok(/\d+/.test(costMax), 'MAX 也标了花费：' + costMax);
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');

  // V5 Curated 局部重绘借 4.5 Curated
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-5-curated'; });
  await page.click('[data-modes] [data-m="infill"]');
  await page.$eval('[data-mask]', (el) => el.scrollIntoView({ block: 'nearest' }));
  const mk2 = await (await page.$('[data-mask]')).boundingBox();
  await page.mouse.move(mk2.x + 20, mk2.y + 20); await page.mouse.down(); await page.mouse.move(mk2.x + 60, mk2.y + 60, { steps: 3 }); await page.mouse.up();
  n = reqs.length;
  await page.click('[data-go]');
  await waitReq(n + 1);
  ok(lastReq().b.model === 'nai-diffusion-4-5-curated-inpainting', 'V5 Curated 局部重绘借 V4.5 Curated 的 inpainting');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');
  await page.click('.layer:last-child [data-close]'); // 关编辑页
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-5-full'; });

  // ---------- 4 倍放大 ----------
  n = reqs.length;
  await page.click('[data-quick] [data-q="upscale"]');
  await waitReq(n + 1);
  ok(lastReq().url.endsWith('/ai/upscale') && lastReq().b.scale === 4 && lastReq().b.width === 512, '放大：/ai/upscale，4 倍');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  const up = await page.evaluate(async () => (await Gallery.list())[0]);
  ok(up.meta.width === 2048 && up.meta.edit.kind === 'upscale', '放大结果记下 2048 宽');
  await page.click('.layer:last-child [data-close]');

  // ---------- 图像工具 ----------
  await page.click('[data-quick] [data-q="tools"]');
  await page.waitForSelector('.tool-item');
  await shot('5-工具');
  const toolRows = await page.$$eval('.tool-item', (bs) => bs.map((x) => x.dataset.k + ':' + x.querySelector('.badge').textContent));
  ok(['bg-removal', 'lineart', 'sketch', 'colorize', 'emotion', 'declutter'].every((k) => toolRows.some((r) => r.startsWith(k + ':') && /约 \d+|\d+ Anlas|免费/.test(r))), '6 个工具都在，都标了花费：' + toolRows.join(' | '));
  for (const k of ['lineart', 'sketch', 'declutter']) {
    if (!await page.$('.tool-item')) { await page.click('[data-quick] [data-q="tools"]'); await page.waitForSelector('.tool-item'); }
    n = reqs.length;
    await page.click('.tool-item[data-k="' + k + '"]');
    await waitReq(n + 1);
    ok(lastReq().url.endsWith('/ai/augment-image') && lastReq().b.req_type === k && lastReq().b.width === 512, '工具 ' + k + '：augment-image');
    await page.waitForSelector('[data-cmp]', { timeout: 8000 });
    await page.click('.layer:last-child [data-close]');
  }
  // 去背景（快捷按钮）
  n = reqs.length;
  await page.click('[data-quick] [data-q="bg"]');
  await waitReq(n + 1);
  ok(lastReq().b.req_type === 'bg-removal', '去背景快捷按钮');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');
  // 换表情
  await page.click('[data-quick] [data-q="tools"]');
  await page.waitForSelector('.tool-item');
  await page.click('.tool-item[data-k="emotion"]');
  await shot('6-表情');
  ok((await page.$$('.mood-grid button')).length === 24, '换表情有 24 种');
  ok(await page.textContent('.mood-grid') .then((t) => t.includes('害羞') && t.includes('调皮')), '表情都是中文');
  await page.click('.mood-grid [data-m="shy"]');
  await page.fill('.sheet [data-p]', 'blush');
  await page.$eval('.sheet [data-d]', (el) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(/约 \d+|\d+ Anlas|免费/.test(await page.textContent('.sheet [data-go]')), '换表情的开始按钮标了花费');
  n = reqs.length;
  await page.click('.sheet [data-go]');
  await waitReq(n + 1);
  b = lastReq().b;
  ok(b.req_type === 'emotion' && b.prompt === 'shy;;blush' && b.defry === 2, '换表情：prompt「shy;;blush」，defry 2');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');
  // 上色
  await page.click('[data-quick] [data-q="tools"]');
  await page.waitForSelector('.tool-item');
  await page.click('.tool-item[data-k="colorize"]');
  ok(!(await page.$('.mood-grid')), '上色没有表情格子');
  await page.fill('.sheet [data-p]', 'blue dress');
  n = reqs.length;
  await page.click('.sheet [data-go]');
  await waitReq(n + 1);
  ok(lastReq().b.req_type === 'colorize' && lastReq().b.prompt === 'blue dress', '上色带颜色说明');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');
  await page.click('.layer:last-child [data-close]'); // 关大图

  // 处理过的图在大图上有「对比原图」
  const edited = await page.evaluate(async () => (await Gallery.list())[0]);
  await page.evaluate((id) => GalleryPage.openViewer(id), edited.id);
  await page.waitForSelector('[data-quick] [data-q="cmp"]');
  await page.click('[data-quick] [data-q="cmp"]');
  await page.waitForSelector('[data-cmp]');
  ok(true, '处理出的图点「对比原图」打开对比');
  await page.click('.layer:last-child [data-close]');
  await page.click('.layer:last-child [data-close]');

  // ---------- 创作页底图 ----------
  await page.click('#c-i2i [data-a="pick"]');
  await page.waitForSelector('.layer .grid .thumb');
  await page.click('.layer .grid .thumb[data-id="' + first.id + '"]');
  await page.waitForSelector('#c-i2i .vibe-thumb');
  await page.$eval('#c-i2i', (el) => el.scrollIntoView());
  await shot('7-底图');
  ok((await page.textContent('#c-i2i')).includes('512×768') && /\d+ Anlas/.test(await page.textContent("#c-i2i")), '底图卡片显示尺寸和每张花费');
  await page.evaluate(() => { UI.settings.nai.portraitSize = '832x1216'; });
  n = reqs.length;
  await page.click('#c-draw');
  await waitReq(n + 1);
  b = lastReq().b; p = b.parameters;
  ok(b.action === 'img2img' && p.width === 512 && p.height === 768 && p.strength === 0.7, '底图开着：创作页出图变图生图，按底图尺寸');
  await page.waitForFunction((k) => document.querySelectorAll('#c-result .result').length >= 1, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  n = reqs.length;
  await page.click('#c-result [data-a="again"]');
  await waitReq(n + 1);
  ok(lastReq().b.action === 'img2img', '图生图出的图点「重绘」照原底图再来');
  await page.waitForTimeout(500);
  await page.click('#c-i2i .switch');
  n = reqs.length;
  await page.click('#c-draw');
  await waitReq(n + 1);
  ok(lastReq().b.action === 'generate' && lastReq().b.parameters.width === 832, '关掉底图就是普通出图');
  // 重开还在
  await page.reload();
  await page.waitForSelector('#c-i2i .vibe-thumb');
  ok(!(await page.isChecked('#c-i2i [data-f="on"]')), '重开后底图和开关还在');

  await page.waitForTimeout(500);
  await browser.close();
  srv.close();
  if (fails.length) { console.log('\n失败 ' + fails.length + ' 项：\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
