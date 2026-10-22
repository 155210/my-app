// 自动打码 无头浏览器测试：模型真跑一遍（依赖/打码/ 里有哪个测哪个）、YOLO 输出解析、打码只改框里、编辑页（点框开关、拖框、换样式、保存另存）、对比、设置页、出图后自动打码
// 先下模型：python3 自然语言生图/工具/下载打码模型.py --skip-missing
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/打码测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  // .wasm 故意不给 application/wasm：App 外壳（WebViewAssetLoader）也认不出这个类型
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const has = (f) => fs.existsSync(path.join(ROOT, '依赖', '打码', f));

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');
  const shot = (n) => process.env.SHOT ? page.screenshot({ path: path.join(process.env.SHOT, n + '.png') }) : null;

  // 假 NAI：回一张 512×768 的图（左蓝右红，中间一块白）
  const PNG = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 768; const g = c.getContext('2d');
    g.fillStyle = '#33c'; g.fillRect(0, 0, 256, 768); g.fillStyle = '#c33'; g.fillRect(256, 0, 256, 768);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'hsl(' + i * 9 + ',80%,60%)'; g.fillRect((i * 37) % 480, (i * 53) % 740, 30, 26); }
    return c.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.route('https://nai.test/**', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ status: 404, headers: CORS });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });
  await page.evaluate(() => { Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full', styleId: '', portraitSize: '512x768' }); UI.saveSettings(); CreatePage.refresh(); });
  const galleryLen = () => page.evaluate(async () => (await Gallery.list()).length);
  const waitGallery = async (n) => { for (let i = 0; i < 100 && await galleryLen() < n; i++) await page.waitForTimeout(100); };

  // ---------- 默认设置 ----------
  const c0 = await page.evaluate(() => JSON.parse(JSON.stringify(Censor.cfg())));
  ok(c0.model === 'anime' && c0.style === 'mosaic' && c0.auto === false && c0.parts.nipple && !c0.parts.butt, '默认：动漫模型、马赛克、不自动、臀部不打');

  // ---------- YOLO 输出解析 ----------
  const parsed = await page.evaluate(() => {
    // 3 个框、3 类：nipple_f 高分、penis 低于阈值、pussy 高分但重叠的两个只留一个
    const N = 4, C = 7, o = new Float32Array(C * N);
    const set = (i, cx, cy, w, h, cls, sc) => { o[i] = cx; o[N + i] = cy; o[2 * N + i] = w; o[3 * N + i] = h; o[(4 + cls) * N + i] = sc; };
    set(0, 320, 320, 64, 64, 0, 0.9);
    set(1, 100, 100, 40, 40, 1, 0.1);
    set(2, 500, 200, 80, 80, 2, 0.8);
    set(3, 505, 205, 80, 80, 2, 0.6);
    const m = { sx: 1024 / 640, sy: 1536 / 640, w: 1024, h: 1536 };
    const all = Censor.parse(o, [1, C, N], ['nipple_f', 'penis', 'pussy'], m, { nipple: true, penis: true, pussy: true }, 0.3);
    const noPussy = Censor.parse(o, [1, C, N], ['nipple_f', 'penis', 'pussy'], m, { nipple: true, penis: true, pussy: false }, 0.3);
    let err = '';
    try { Censor.parse(o, [1, 9, N], ['nipple_f'], m, {}, 0.3); } catch (e) { err = e.message; }
    return { all, noPussy, err };
  });
  const nb = parsed.all.find((b) => b.part === 'nipple');
  ok(parsed.all.length === 2 && nb && Math.abs(nb.x - 288 * 1.6) < 0.01 && Math.abs(nb.y - 288 * 2.4) < 0.01 && Math.abs(nb.w - 64 * 1.6) < 0.01,
    '解析：阈值以下不要、重叠只留高分、坐标按比例换回原图：' + JSON.stringify(parsed.all.map((b) => [b.part, Math.round(b.x), Math.round(b.y), Math.round(b.w), +b.score.toFixed(2)])));
  ok(parsed.noPussy.length === 1 && parsed.noPussy[0].part === 'nipple', '关掉的部位不要');
  ok(/输出不对/.test(parsed.err), '类别数对不上时报错：' + parsed.err);

  // ---------- 打码只改框里 ----------
  const px = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d');
    for (let y = 0; y < 300; y += 2) for (let x = 0; x < 400; x += 2) { g.fillStyle = (x + y) % 4 ? '#fff' : '#000'; g.fillRect(x, y, 2, 2); }
    const img = await ImgEdit.loadImg(await new Promise((r) => c.toBlob(r)));
    const box = [{ x: 100, y: 100, w: 100, h: 80, part: 'nipple', score: 1 }];
    const out = {};
    for (const style of ['mosaic', 'blur', 'black', 'white']) {
      const r = Censor.render(img, box, { style, shape: 'rect', strength: 60, expand: 0 });
      const d = r.getContext('2d').getImageData(0, 0, 400, 300).data;
      const o = c.getContext('2d').getImageData(0, 0, 400, 300).data;
      let inDiff = 0, outDiff = 0, inN = 0, outN = 0;
      for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
        const i = (y * 400 + x) * 4, diff = Math.abs(d[i] - o[i]) > 30;
        if (x >= 102 && x < 198 && y >= 102 && y < 178) { inN++; if (diff) inDiff++; } else if (x < 98 || x >= 202 || y < 98 || y >= 182) { outN++; if (diff) outDiff++; }
      }
      out[style] = { inside: inDiff / inN, outside: outDiff / outN, center: [d[(140 * 400 + 150) * 4], d[(140 * 400 + 150) * 4 + 1]] };
    }
    const off = Censor.render(img, [Object.assign({}, box[0], { on: false })], { style: 'black', shape: 'rect', strength: 60, expand: 0 });
    const od = off.getContext('2d').getImageData(150, 140, 1, 1).data, oo = c.getContext('2d').getImageData(150, 140, 1, 1).data;
    const round = Censor.render(img, box, { style: 'black', shape: 'round', strength: 60, expand: 0 }).getContext('2d');
    const grow = Censor.render(img, box, { style: 'black', shape: 'rect', strength: 60, expand: 20 }).getContext('2d');
    return { out, offSame: od[0] === oo[0], roundCorner: round.getImageData(101, 101, 1, 1).data[0] === c.getContext('2d').getImageData(101, 101, 1, 1).data[0], roundCenter: round.getImageData(150, 140, 1, 1).data[0],
      grown: grow.getImageData(85, 90, 1, 1).data[0], grownOut: grow.getImageData(75, 80, 1, 1).data[0], origAt85: c.getContext('2d').getImageData(85, 90, 1, 1).data[0] };
  });
  for (const s of ['mosaic', 'blur', 'black', 'white']) ok(px.out[s].inside > 0.3 && px.out[s].outside === 0, s + '：框里变了 ' + (px.out[s].inside * 100).toFixed(0) + '%，框外一个像素没动');
  ok(px.out.black.center[0] === 0 && px.out.white.center[0] === 255, '黑条是黑的、白光中间是白的');
  ok(px.offSame, '关掉的框不打');
  ok(px.roundCenter === 0 && px.roundCorner, '圆形：角上不打、中间打');
  ok(px.grown === 0 && px.grownOut !== 0, '扩大范围 20%：框外 20px 内也打了，再远不打');

  // ---------- 真模型跑一遍 ----------
  const models = [has('写实.onnx') && 'real', has('动漫.onnx') && 'anime'].filter(Boolean);
  ok(has('ort.js') && has('ort.wasm'), '运行库在 依赖/打码/');
  ok(models.length > 0, '至少有一个模型：' + models.join(', '));
  for (const m of models) {
    const r = await page.evaluate(async (m) => {
      const img = await ImgEdit.loadImg(await (await fetch('依赖/打码/' + (m === 'real' ? '写实' : '动漫') + '.json')).blob().then(() => new Promise((res) => {
        const c = document.createElement('canvas'); c.width = 832; c.height = 1216; const g = c.getContext('2d');
        g.fillStyle = '#f2d0b5'; g.fillRect(0, 0, 832, 1216); g.fillStyle = '#933'; g.beginPath(); g.arc(300, 500, 20, 0, 7); g.arc(530, 500, 20, 0, 7); g.fill();
        c.toBlob(res);
      })));
      const t0 = performance.now();
      try {
        const a = await Censor.detect(img, { model: m, threshold: 5, parts: { nipple: 1, breast: 1, pussy: 1, penis: 1, anus: 1, butt: 1 } });
        const t1 = performance.now();
        await Censor.detect(img, { model: m });
        return { ok: true, n: a.length, ms: Math.round(t1 - t0), ms2: Math.round(performance.now() - t1), sample: a.slice(0, 3) };
      } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    }, m);
    ok(r.ok, m + ' 模型跑通：' + (r.ok ? '第一次 ' + r.ms + 'ms（含加载），第二次 ' + r.ms2 + 'ms，阈值 5% 时框 ' + r.n + ' 个 ' + JSON.stringify(r.sample.map((b) => [b.part, Math.round(b.x), Math.round(b.y), +b.score.toFixed(2)])) : r.err));
  }
  if (!models.includes('anime')) {
    const r = await page.evaluate(async () => { try { await Censor.detect(document.createElement('canvas'), { model: 'anime' }); return ''; } catch (e) { return e.message; } });
    ok(/没有「动漫」识别模型/.test(r), '缺模型时提示：' + r);
  }
  // 后面编辑页用有的那个模型
  await page.evaluate((m) => { Censor.cfg().model = m; }, models[0] || 'real');

  // ---------- 出一张图，大图上点「打码」 ----------
  await page.fill('#c-tag', '1girl');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-draw');
  await waitGallery(1);
  const first = await page.evaluate(async () => (await Gallery.list())[0]);
  await page.evaluate((id) => GalleryPage.openViewer(id), first.id);
  await page.waitForSelector('[data-quick] [data-q="censor"]');
  ok(true, '大图下面有「打码」');
  await page.click('[data-quick] [data-q="censor"]');
  await page.waitForSelector('[data-stage] canvas');
  for (let i = 0; i < 100; i++) { if (!/识别中/.test(await page.textContent('[data-status]'))) break; await page.waitForTimeout(100); }
  const st1 = await page.textContent('[data-status]');
  ok(/找到|没认出/.test(st1), '识别完了：' + st1);
  await shot('打码-1-编辑页');

  // 拖一个框
  const lay = await page.$('[data-boxes]');
  const bb = await lay.boundingBox();
  ok(bb && bb.width > 100 && bb.height > 100, '框层和画布对齐：' + JSON.stringify(bb && [Math.round(bb.width), Math.round(bb.height)]));
  await page.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.45, { steps: 5 });
  await page.mouse.up();
  let boxes = await page.$$eval('.cz-box', (bs) => bs.map((b) => b.className));
  const manual = boxes.filter((c) => /manual/.test(c)).length;
  ok(manual === 1, '拖一下加了一个手动框');
  const chip = await page.$$eval('[data-chips] button', (bs) => bs.map((b) => b.textContent));
  ok(chip.some((t) => /手动/.test(t)), '下面列出了这个框：' + chip.join(' | '));
  // 换样式
  await page.click('[data-seg="style"] [data-v="black"]');
  const center = await page.evaluate(() => { const c = document.querySelector('[data-cv]'); return Array.from(c.getContext('2d').getImageData(Math.round(c.width * 0.4), Math.round(c.height * 0.37), 1, 1).data.slice(0, 3)); });
  ok(center.join() === '0,0,0', '换成黑条，画布上框里是黑的：' + center);
  await shot('打码-2-手动框');
  // 点一下手动框 = 删掉；再拖一个
  const mb = await page.$('.cz-box.manual');
  const mbb = await mb.boundingBox();
  await page.mouse.click(mbb.x + mbb.width / 2, mbb.y + mbb.height / 2);
  ok((await page.$$('.cz-box.manual')).length === 0, '点一下手动框就删掉');
  await page.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.45, { steps: 5 });
  await page.mouse.up();
  await page.fill('[data-r="strength"]', '80');
  await page.dispatchEvent('[data-r="strength"]', 'input');
  // 保存
  const n0 = await galleryLen();
  await page.click('.cz-panel [data-a="save"]');
  await waitGallery(n0 + 1);
  const saved = await page.evaluate(async () => (await Gallery.list())[0]);
  ok(saved.meta && saved.meta.edit && saved.meta.edit.kind === 'censor' && saved.meta.edit.from === first.id && saved.meta.edit.style === 'black', '另存一张：meta.edit = ' + JSON.stringify(saved.meta && saved.meta.edit));
  ok(saved.tag === first.tag && saved.meta.seed === first.meta.seed, '文字字段和配方照原图');
  ok(await page.evaluate(async (id) => !!(await Gallery.getBlob(id)), first.id), '原图还在');
  await page.waitForSelector('[data-cmp]');
  ok(true, '保存后打开前后对比');
  const c1 = await page.evaluate(() => JSON.parse(JSON.stringify(Censor.cfg())));
  ok(c1.style === 'black' && Number(c1.strength) === 80, '这次的样式、力度记成默认');
  await shot('打码-3-对比');
  await page.evaluate(() => { while (document.querySelector('#layers .layer')) UI.closeLayer(); });

  // ---------- 设置页 ----------
  await page.evaluate(() => SettingsPage.open('censor'));
  await page.waitForSelector('[data-k="nai.censor.model"]');
  ok(await page.$eval('[data-k="nai.censor.parts.nipple"]', (e) => e.checked) && !await page.$eval('[data-k="nai.censor.parts.butt"]', (e) => e.checked), '设置页部位开关对上');
  await page.$eval('[data-k="nai.censor.auto"]', (e) => { e.checked = true; e.dispatchEvent(new Event('change')); });
  await page.selectOption('[data-k="nai.censor.style"]', 'mosaic');
  ok(await page.evaluate(() => Censor.cfg().auto === true && Censor.cfg().style === 'mosaic'), '设置页改了就存');
  await shot('打码-4-设置');
  await page.evaluate(() => { while (document.querySelector('#layers .layer')) UI.closeLayer(); });

  // ---------- 出图后自动打码（识别换成假的，认出一处） ----------
  await page.evaluate(() => { window.__censorAuto = []; window.__realDetect = Censor.detect; Censor.detect = async () => [{ x: 50, y: 60, w: 100, h: 90, part: 'nipple', score: 0.9 }]; });
  const n1 = await galleryLen();
  await page.click('#c-draw');
  await waitGallery(n1 + 2);
  await page.evaluate(() => Promise.all(window.__censorAuto));
  const two = await page.evaluate(async () => (await Gallery.list()).slice(0, 2));
  ok(two[0].meta.edit && two[0].meta.edit.kind === 'censor' && two[0].meta.edit.auto && two[0].meta.edit.from === two[1].id && !two[1].meta.edit, '自动打码：原图留着，另存一张打码版');
  // 打码版、编辑出来的图不再自动打
  ok(await page.evaluate(() => window.__censorAuto.length) === 1, '打码版自己不再触发自动打码');
  // 没认出来就不存
  await page.evaluate(() => { Censor.detect = async () => []; });
  const n2 = await galleryLen();
  await page.click('#c-draw');
  await waitGallery(n2 + 1);
  await page.evaluate(() => Promise.all(window.__censorAuto));
  await page.waitForTimeout(300);
  ok(await galleryLen() === n2 + 1, '没认出来就不另存');
  // 关掉
  await page.evaluate(() => { Censor.cfg().auto = false; });
  const n3 = await galleryLen();
  const k3 = await page.evaluate(() => window.__censorAuto.length);
  await page.click('#c-draw');
  await waitGallery(n3 + 1);
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__censorAuto.length) === k3, '关掉就不自动打');

  // ---------- 说明 ----------
  ok(await page.evaluate(() => Help.list.some((h) => h.id === 'censor')), '说明页有「打码」');

  await browser.close();
  srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
