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

  // 假 AI：记下发去的用户消息
  const asked = [];
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const user = JSON.parse(req.postData()).messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    asked.push(user);
    const reply = JSON.stringify(/局部重绘/.test(user) ? { tag: '1girl, smile, red dress', nl: '', negative: 'blue dress', size: 'portrait' }
      : /这次是重写提示词/.test(user) ? { tag: '1girl, rewritten', nl: '', negative: '', size: 'portrait' }
        : { tag: '1girl, umbrella, rain', nl: '', negative: 'sun', size: 'portrait' });
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\ndata: [DONE]\n\n';
    return r.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse });
  });
  const lastAsk = () => asked[asked.length - 1] || '';

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-i2i');
  // 假 NAI 回的图：512×768 的 PNG（放大回 4 倍大小）
  const mkPng = (w, h) => page.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, w, h); g.fillStyle = '#33c'; g.fillRect(0, 0, w / 2, h); return c.toDataURL('image/png').split(',')[1]; }, [w, h]);
  const PNG = Buffer.from(await mkPng(512, 768), 'base64');
  const BIG = Buffer.from(await mkPng(2048, 3072), 'base64');
  const MID = Buffer.from(await mkPng(768, 1152), 'base64');
  const GREEN = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 512; c.height = 768; const g = c.getContext('2d'); g.fillStyle = '#0f0'; g.fillRect(0, 0, 512, 768); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  let greenFor = ''; // 这种 action 回全绿的图（看贴回原图对不对）
  const reqs = [];
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ status: 404, headers: CORS });
    const b = JSON.parse(req.postData());
    reqs.push({ url: req.url(), b });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: req.url().endsWith('/upscale') ? BIG : greenFor && b.action === greenFor ? GREEN : b.parameters && b.parameters.width === 768 ? MID : PNG });
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

  // ================= 编辑页让 AI 写提示词、画风模板、局部重绘贴回原图 =================
  await page.evaluate(() => { Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm', key: 'x' }); UI.settings.autoDraw = false; Object.assign(UI.settings.nai, { portraitSize: '512x768', model: 'nai-diffusion-4-5-full' }); });
  ok(await page.evaluate(() => UI.settings.nai.styles.some((x) => x.blank && x.name.startsWith('空白'))), '内置了「空白（不加任何词）」画风模板');
  await page.evaluate((id) => GalleryPage.openViewer(id), first.id);
  await page.waitForSelector('[data-quick] [data-q="edit"]');
  await page.click('[data-quick] [data-q="edit"]');
  await page.waitForSelector('[data-f="desc"]');
  ok(await page.isVisible('[data-ai="write"]') && await page.isVisible('[data-ai="rewrite"]') && await page.isVisible('[data-style]'), '编辑页有中文描述、AI 写提示词、AI 重写、画风模板');
  await page.fill('[data-f="desc"]', '同一个女孩在雨里撑伞');
  await page.click('[data-ai="write"]');
  await page.waitForFunction(() => document.querySelector('[data-f="tag"]').value === '1girl, umbrella, rain');
  ok(lastAsk().includes('同一个女孩在雨里撑伞'), 'AI 写提示词：发的是编辑页的中文描述');
  ok(await page.inputValue('[data-f="negative"]') === 'sun', 'AI 写的负面词也填上了');
  // AI 重写（附要求）
  await page.click('[data-ai="rewrite"]');
  await page.fill('.dialog [data-hint]', '表情再害羞一点');
  await page.click('.dialog [data-go]');
  await page.waitForFunction(() => document.querySelector('[data-f="tag"]').value === '1girl, rewritten');
  ok(/这次是重写提示词/.test(lastAsk()) && lastAsk().includes('1girl, umbrella, rain') && lastAsk().includes('表情再害羞一点'), 'AI 重写：拿现在的提示词当锚点，带上要求');
  // 空白画风模板：不加质量词、负面词
  const blankId = await page.evaluate(() => UI.settings.nai.styles.find((x) => x.blank).id);
  await page.selectOption('[data-style]', blankId);
  let n0 = reqs.length;
  await page.click('[data-go]');
  await waitReq(n0 + 1);
  b = lastReq().b;
  ok(b.input === '1girl, rewritten' && b.parameters.negative_prompt === '', '选空白模板：正面只有标签、负面是空的（不加默认质量词和负面词）');
  ok(await page.evaluate(() => UI.settings.nai.styleId) !== blankId, '编辑页选模板不改创作页的');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');

  // 局部重绘：AI 只改涂的那块
  await page.click('[data-modes] [data-m="infill"]');
  await page.fill('[data-f="fill"]', '换成红色的连衣裙');
  await page.click('[data-ai="write"]');
  await page.waitForFunction(() => document.querySelector('[data-f="tag"]').value === '1girl, smile, red dress');
  ok(lastAsk().includes('换成红色的连衣裙') && /只有被涂掉的那一块/.test(lastAsk()) && lastAsk().includes('1girl, rewritten'), '局部重绘的 AI：说明只改涂的那块，拿原来的提示词当锚点');
  // 贴回原图：NAI 回全绿，涂过的地方绿、没涂的地方还是原图
  greenFor = 'infill';
  await page.$eval('[data-mask]', (el) => el.scrollIntoView({ block: 'nearest' }));
  let mb = await (await page.$('[data-mask]')).boundingBox();
  await page.mouse.move(mb.x + mb.width * 0.6, mb.y + mb.height * 0.4); await page.mouse.down();
  await page.mouse.move(mb.x + mb.width * 0.8, mb.y + mb.height * 0.5, { steps: 5 }); await page.mouse.up();
  await shot('8-重绘AI');
  n0 = reqs.length;
  await page.click('[data-go]');
  await waitReq(n0 + 1);
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  const px = (id, fx, fy) => page.evaluate(async ([id, fx, fy]) => {
    const blob = await Gallery.getBlob(id); const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(Math.round(img.width * fx), Math.round(img.height * fy), 1, 1).data.slice(0, 3)).concat([img.width]);
  }, [id, fx, fy]);
  let res = await page.evaluate(async () => (await Gallery.list())[0]);
  const inside = await px(res.id, 0.7, 0.45), outside = await px(res.id, 0.1, 0.1), outR = await px(res.id, 0.9, 0.9);
  ok(inside[1] > 200 && inside[0] < 50, '涂过的地方是 NAI 画的：' + inside);
  ok(outside[2] > 150 && outside[1] < 80 && outR[0] > 150 && outR[1] < 80, '没涂的地方和原图一样：' + outside + ' / ' + outR);
  ok(res.meta.edit.feather === 16, '配方记下边缘过渡');
  await page.click('.layer:last-child [data-close]');

  // 原图糊：先整张变清晰再重绘（精修 → 在 768×1152 上重绘）
  await page.click('[data-opt="pre"] + span');
  ok(/几步加起来 约 \d+|几步加起来 \d+/.test(await page.textContent('[data-size]')), '勾了先变清晰，显示几步加起来的花费：' + await page.textContent('[data-size]'));
  ok(/多/.test(await page.textContent('[data-cost-pre]')) && /真人照片/.test(await page.textContent('[data-ctl]')), '先变清晰标了花费，提醒真人照片会变');
  n0 = reqs.length;
  await page.click('[data-go]');
  await waitReq(n0 + 2);
  const r1 = reqs[n0].b, r2 = reqs[n0 + 1].b;
  ok(r1.action === 'img2img' && r1.parameters.width === 768 && r1.parameters.strength === 0.35, '先精修整张：768×1152，强度 0.35');
  ok(r2.action === 'infill' && r2.parameters.width === 768 && r2.parameters.height === 1152 && typeof r2.parameters.mask === 'string', '再在变清晰的图上局部重绘（遮罩跟着放大）');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  await page.click('.layer:last-child [data-close]');
  await page.click('[data-opt="pre"] + span');

  // 画完只融合周围
  await page.click('[data-opt="post"] + span');
  ok(await page.isChecked('[data-opt="postLocal"]'), '「只融合重画那块周围」默认开着');
  greenFor = 'infill';
  n0 = reqs.length;
  await page.click('[data-go]');
  await waitReq(n0 + 2);
  ok(reqs[n0].b.action === 'infill' && reqs[n0 + 1].b.action === 'img2img', '重绘完接着精修一遍');
  await page.waitForSelector('[data-cmp]', { timeout: 8000 });
  res = await page.evaluate(async () => (await Gallery.list())[0]);
  const far = await px(res.id, 0.1, 0.9);
  ok(res.meta.edit.local === true && far[2] > 150 && far[1] < 80 && far[3] === 512, '融合只贴回涂的周围，远处（脸）一个像素不动、尺寸不变：' + far);
  await page.click('.layer:last-child [data-close]');
  await page.click('.layer:last-child [data-close]');
  await page.click('.layer:last-child [data-close]');
  greenFor = '';

  // 创作页底图卡片：涂遮罩 → 出图就是局部重绘
  await page.click('#c-i2i [data-f="on"] + span');
  await page.click('#c-i2i [data-a="mask"]');
  await page.waitForSelector('.layer [data-ok]');
  await page.click('.layer [data-ok]');
  await page.waitForTimeout(200);
  ok(await page.isVisible('.layer [data-ok]'), '没涂不让用');
  await page.$eval('.layer [data-mask]', (el) => el.scrollIntoView({ block: 'nearest' }));
  mb = await (await page.$('.layer [data-mask]')).boundingBox();
  await page.mouse.move(mb.x + mb.width * 0.4, mb.y + mb.height * 0.8); await page.mouse.down(); // 避开中间的提示条
  await page.mouse.move(mb.x + mb.width * 0.6, mb.y + mb.height * 0.9, { steps: 5 }); await page.mouse.up();
  await page.click('.layer [data-ok]');
  await page.waitForSelector('#c-i2i [data-a="unmask"]');
  ok((await page.textContent('#c-i2i')).includes('局部重绘') && await page.isVisible('#c-i2i [data-f="fillStrength"]'), '底图卡片变成局部重绘，有重画强度');
  n0 = reqs.length;
  await page.click('#c-draw');
  await waitReq(n0 + 1);
  b = lastReq().b;
  ok(b.action === 'infill' && b.parameters.strength === 1 && typeof b.parameters.mask === 'string', '创作页出图走局部重绘');
  await page.waitForTimeout(800);
  await page.click('#c-i2i [data-a="unmask"]');
  n0 = reqs.length;
  await page.click('#c-draw');
  await waitReq(n0 + 1);
  ok(lastReq().b.action === 'img2img', '「不重绘了」又变回普通图生图');

  await page.waitForTimeout(500);
  await browser.close();
  srv.close();
  if (fails.length) { console.log('\n失败 ' + fails.length + ' 项：\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
