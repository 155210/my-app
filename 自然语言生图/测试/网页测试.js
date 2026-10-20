// 网页层无头浏览器测试：假 AI 接口 + 假 NAI（回 zip），走一遍 设置 → 写提示词 → 出图 → 图库
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/网页测试.js
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
function png(w, h, texts) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 120; raw[o + 2] = 60; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...Object.entries(texts || {}).map(([k, v]) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'utf8')]))), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
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

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  let aiCalls = 0, naiBody = null;
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/models')) return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ id: 'm-a' }, { id: 'm-b' }] }) });
    aiCalls++;
    const reply = aiCalls === 1 ? '好的，我来写：没有 JSON' : '<think>想一想</think>```json\n{"tag":"1girl, long hair, black hair, smile, looking back, rooftop, sunset","nl":"A girl smiles on a rooftop.","negative":"glasses","size":"landscape"}\n```';
    const sse = [...reply].reduce((a, ch, i) => (i % 8 === 0 ? a.push(ch) : a[a.length - 1] += ch, a), []).map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n').join('') + 'data: [DONE]\n\n';
    return r.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse });
  });
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const b = JSON.parse(req.postData() || 'null');
    if (!b || !b.input) return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: '{}' });
    naiBody = b;
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/x-zip-compressed' }, body: zip('image_0.png', png(64, 96, { Title: 'NovelAI generated image', Software: 'NovelAI', Source: 'NovelAI Diffusion V4.5 4BDE2A90', Comment: JSON.stringify({ prompt: naiBody.input, uc: naiBody.parameters.negative_prompt, seed: 4242, steps: 28, scale: 5.5, sampler: 'k_euler', width: 1216, height: 832, v4_prompt: { caption: { base_caption: naiBody.input, char_captions: [{ char_caption: 'girl, 黑发', centers: [] }] } } }) }), 8) });
  });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-write');

  // 纯函数
  const unit = await page.evaluate(async () => {
    const r = {};
    r.p1 = Writer.parseReply('前缀 {"tag":["a","b"],"size":"横图"} 后缀');
    try { Writer.parseReply('{"nl":"x"}'); r.p2 = 'no-throw'; } catch (e) { r.p2 = e.message; }
    const s = Params.normalize({ nai: { key: 'k', artist: 'artist:foo' } });
    const b = Nai.buildBody(s.nai, { tag: 'cat', nl: 'A cat.', negative: 'dog', size: 'landscape', seed: 7 });
    r.b = { w: b.meta.width, h: b.meta.height, pos: b.meta.positive, neg: b.meta.negative.slice(-5), seed: b.body.parameters.seed, v4: b.body.parameters.v4_prompt.caption.base_caption === b.meta.positive };
    try { Params.parseSize('800×1200'); r.sz = 'no-throw'; } catch (e) { r.sz = e.message; }
    return r;
  });
  ok(unit.p1.tag === 'a, b' && unit.p1.size === 'landscape', '解析 AI 回复：数组 tag、中文画幅');
  ok(/没有 tag/.test(unit.p2), '缺 tag 时报错');
  ok(unit.b.w === 1216 && unit.b.h === 832 && unit.b.seed === 7 && unit.b.v4, '横图尺寸、固定种子、v4_prompt 同源');
  ok(unit.b.pos.startsWith('artist:foo, cat, very aesthetic') && unit.b.pos.endsWith('. A cat.'), '正面 = 画师串 + tag + 质量词 + 英文描述：' + unit.b.pos);
  ok(unit.b.neg === ', dog', '负面末尾接 AI 补的负面词');
  ok(/64 的倍数/.test(unit.sz), '尺寸不是 64 倍数时报错');

  // 设置页
  await page.click('#btn-settings');
  await page.fill('[data-k="ai.url"]', 'https://ai.test/v1');
  await page.fill('[data-k="ai.key"]', 'sk-1');
  await page.click('[data-act="models"]');
  await page.click('.pick[data-m="m-b"]');
  ok(await page.inputValue('[data-k="ai.model"]') === 'm-b', '拉取模型列表并选中');
  await page.click('.tabs button[data-tab="nai"]');
  await page.fill('[data-k="nai.url"]', 'https://nai.test');
  await page.fill('[data-k="nai.key"]', 'pst-1');
  await page.screenshot({ path: OUT + '/设置.png', fullPage: false });
  await page.click('.page-head [data-close]');

  // 创作：写提示词（第一次格式不对，自动重试）→ 自动出图
  await page.fill('#c-desc', '黄昏天台上黑长发女孩回头笑，不要眼镜');
  await page.click('#c-write');
  await page.waitForFunction(() => document.querySelector('#c-tag').value.includes('1girl'), null, { timeout: 8000 });
  ok(aiCalls === 2, 'AI 格式不对时自动重试一次（调用 ' + aiCalls + ' 次）');
  ok(await page.inputValue('#c-neg') === 'glasses', '补充负面词填好');
  ok(await page.$eval('#c-size button.on', (b) => b.dataset.v) === 'landscape', '画幅按 AI 选的横图');
  await page.waitForSelector('#c-result img', { timeout: 8000 });
  ok(naiBody && naiBody.model === 'nai-diffusion-5-full' && naiBody.parameters.width === 1216, '发给 NAI 的请求：模型、横图宽度');
  ok(naiBody && naiBody.input.includes('very aesthetic, masterpiece') && naiBody.parameters.negative_prompt.endsWith('glasses'), '请求里带质量词、负面词');
  const nat = await page.$eval('#c-result img', (i) => new Promise((res) => (i.complete ? res(i.naturalWidth) : (i.onload = () => res(i.naturalWidth)))));
  ok(nat === 64, '从 zip 里解出的图片能显示（宽 ' + nat + '）');
  await page.screenshot({ path: OUT + '/创作.png', fullPage: true });

  // 图库
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForSelector('.thumb');
  ok((await page.$$('.thumb')).length === 1, '图库里有 1 张');
  ok(await page.evaluate(async () => (await Gallery.list())[0].ext) === 'png', '默认不转 JPG，保留 NAI 原 PNG');
  // 杂色大图：PNG 自动转存 JPG
  const conv = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 480;
    const g = c.getContext('2d'), d = g.createImageData(320, 480);
    for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
    g.putImageData(d, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    await Gallery.setPrefs({ jpg: true });
    const it = await Gallery.add(png, 'png', { desc: '杂色', tag: 'noise', meta: { positive: 'noise', negative: '', width: 320, height: 480, seed: 1, model: 'nai-diffusion-5-full', sampler: 'k_euler', steps: 28, scale: 5, size: 'portrait', characterPrompts: [{ prompt: 'x' }] } });
    const blob = await Gallery.getBlob(it.id);
    await Gallery.setPrefs({ jpg: false });
    const it2 = await Gallery.add(png, 'png', { desc: '不转', tag: 'raw', meta: {} });
    await Gallery.remove(it2.id);
    return { ext: it.ext, orig: it.origExt, type: blob.type, smaller: blob.size < png.size, ext2: it2.ext };
  });
  ok(conv.ext === 'jpg' && conv.orig === 'png' && conv.type === 'image/jpeg' && conv.smaller, 'PNG 自动转存成 JPG 且更小');
  ok(conv.ext2 === 'png', '关掉开关后保留 PNG');

  // 读取图片信息：NAI 的 tEXt Comment
  const info = await page.evaluate(async () => {
    const it = (await Gallery.list()).find((x) => x.tag && x.tag.includes('1girl'));
    return Gallery.readInfo(await Gallery.getBlob(it.id));
  });
  ok(info && info.prompt.includes('1girl') && info.negative.endsWith('glasses') && info.params.seed === 4242 && info.source.includes('V4.5') && info.chars[0].prompt === 'girl, 黑发', '读出 PNG 里的 NAI 信息：正负面、种子、模型、角色');
  // 隐写（透明通道最低位，stealth_pngcomp）
  const stg = await page.evaluate(async () => {
    const W = 64, H = 64;
    const json = JSON.stringify({ Comment: JSON.stringify({ prompt: 'stealth cat', uc: 'bad', seed: 9 }), Software: 'NovelAI' });
    const gz = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const bits = [];
    const push = (b) => { for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1); };
    [...'stealth_pngcomp'].forEach((ch) => push(ch.charCodeAt(0)));
    const n = gz.length * 8; for (let k = 31; k >= 0; k--) bits.push((n >>> k) & 1);
    gz.forEach(push);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), d = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const x = Math.floor(i / H), y = i % H, o = (y * W + x) * 4; d.data[o] = 120; d.data[o + 1] = 80; d.data[o + 2] = 200; d.data[o + 3] = 254 | (bits[i] || 0); }
    g.putImageData(d, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const a = await Gallery.readInfo(blob);
    const none = await Gallery.readInfo(await new Promise((r) => { const k = document.createElement('canvas'); k.width = k.height = 32; k.toBlob(r, 'image/png'); }));
    return { a, none };
  });
  ok(stg.a && stg.a.prompt === 'stealth cat' && stg.a.params.seed === 9 && stg.a.from === '隐写', '读出透明通道里隐写的 NAI 信息');
  ok(stg.none === null, '没信息的图返回空');
  await page.evaluate(() => GalleryPage.refresh()); await page.waitForTimeout(100);
  ok((await page.$$('.thumb')).length === 2, '图库里有 2 张');

  // 四档大小
  for (const [v, cols] of [['s', 4], ['l', 2], ['full', 1], ['m', 3]]) {
    await page.click('#g-size [data-v="' + v + '"]');
    await page.waitForSelector('.grid.size-' + v);
    const n = await page.$eval('.grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    ok(n === cols, '显示大小「' + v + '」→ 每行 ' + n + ' 张');
  }
  ok(await page.evaluate(async () => (await Store.get('galleryPrefs')).size) === 'm', '显示大小记住了');

  // 长按 → 读图片里藏的信息 → 填到创作页
  const tb2 = await page.$('.thumb:nth-child(2)'); const bb2 = await tb2.boundingBox();
  await page.mouse.move(bb2.x + 20, bb2.y + 20); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.click('.sheet .menu-item[data-k="read"]');
  await page.waitForSelector('.sheet pre.recipe');
  const infoText = await page.$eval('.sheet', (x) => x.textContent);
  ok(infoText.includes('4242') && infoText.includes('角色 1') && infoText.includes('PNG 文本'), '图片信息页显示种子、角色、来源');
  await page.waitForTimeout(250); await page.screenshot({ path: OUT + '/图片信息.png' });
  await page.evaluate(() => { document.querySelector('#c-tag').value = ''; });
  await page.click('.sheet [data-a="use"]');
  ok(await page.$eval('#view-create', (v) => !v.hidden) && await page.inputValue('#c-tag') === '1girl, long hair, black hair, smile, looking back, rooftop, sunset' && await page.inputValue('#c-neg') === 'glasses', '填到创作页时去掉了质量词和默认负面词');
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForSelector('.thumb');

  // 选项里一键转换已有 PNG
  await page.click('#g-opts');
  await page.click('#g-conv');
  await page.click('.dialog [data-yes]');
  await page.waitForFunction(() => document.querySelector('#g-conv').textContent === '转好了');
  ok(await page.evaluate(async () => (await Gallery.list()).every((x) => x.ext === 'jpg')), '一键把已有 PNG 全转成 JPG');
  await page.click('.sheet [data-close]');

  // 缩略图长按弹菜单
  const tb = await page.$('.thumb[data-id]');
  const bb = await tb.boundingBox();
  await page.mouse.move(bb.x + 20, bb.y + 20); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  ok(!!await page.$('.sheet .menu-item[data-k="save"]'), '长按缩略图弹出菜单');
  await page.evaluate(() => window.__appBack());
  ok(!await page.$('.viewer'), '长按后不会误开大图');

  // 大图：打开第二张（较早出的那张）
  await page.click('.thumb:nth-child(2)');
  await page.waitForSelector('.v-stage img');
  const count = () => page.$eval('[data-count]', (e) => e.textContent.replace(/\s/g, ''));
  ok(await count() === '2/2', '大图显示第 2 / 2 张');
  const st = await (await page.$('.v-stage')).boundingBox();
  const cx = st.x + st.width / 2, cy = st.y + st.height / 2;
  // 向右滑 → 上一张
  await page.mouse.move(cx - 100, cy); await page.mouse.down(); await page.mouse.move(cx, cy, { steps: 5 }); await page.mouse.move(cx + 100, cy, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(450);
  ok(await count() === '1/2', '右滑换到上一张');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(450);
  ok(await count() === '2/2', '方向键换到下一张');
  // 双击放大、再双击还原
  const scale = () => page.$eval('.v-stage img', (i) => { const m = /scale\(([\d.]+)\)/.exec(i.style.transform); return m ? +m[1] : 1; });
  await page.mouse.click(cx, cy); await page.waitForTimeout(80); await page.mouse.click(cx, cy);
  ok(await scale() === 2.5, '双击放大到 2.5 倍');
  await page.waitForTimeout(400);
  await page.mouse.click(cx, cy); await page.waitForTimeout(80); await page.mouse.click(cx, cy);
  ok(await scale() === 1, '再双击还原');
  // 双指缩放（合成两个触点）
  await page.waitForTimeout(400);
  await page.evaluate(([x, y]) => {
    const s = document.querySelector('.v-stage');
    const f = (type, id, px) => s.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: px, clientY: y, bubbles: true, pointerType: 'touch' }));
    f('pointerdown', 11, x - 40); f('pointerdown', 12, x + 40);
    for (let k = 1; k <= 10; k++) { f('pointermove', 11, x - 40 - k * 6); f('pointermove', 12, x + 40 + k * 6); }
    f('pointerup', 11, x - 100); f('pointerup', 12, x + 100);
  }, [cx, cy]);
  const s2 = await scale();
  ok(Math.abs(s2 - 2.5) < 0.05, '双指张开放大（' + s2.toFixed(2) + ' 倍）');
  ok(await count() === '2/2', '放大时不会误换图');
  await page.mouse.click(cx, cy); await page.waitForTimeout(80); await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);
  // 长按大图 → 菜单
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  ok(!!await page.$('.sheet .menu-item[data-k="save"]'), '长按大图弹出保存菜单');
  await page.click('.sheet .menu-item[data-k="recipe"]');
  await page.waitForSelector('.sheet pre.recipe');
  const recipe = await page.$$eval('.sheet pre.recipe', (p) => p.map((x) => x.textContent).join('\n'));
  ok(recipe.includes('黄昏天台') && recipe.includes('种子') && recipe.includes('1216×832') && recipe.includes('glasses') && recipe.includes('A girl smiles'), '配方里有描述、标签、英文描述、负面、参数');
  await page.waitForTimeout(300); await page.screenshot({ path: OUT + '/配方.png' });
  await page.evaluate(() => window.__appBack());
  await page.screenshot({ path: OUT + '/图库大图.png' });
  // 其他参数（后面的功能加进 meta 的字段）也显示
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(450);
  await page.click('[data-a="recipe"]');
  ok((await page.$$eval('.sheet pre.recipe', (p) => p.map((x) => x.textContent).join('\n'))).includes('characterPrompts'), '配方显示其他参数');
  await page.evaluate(() => window.__appBack());
  // 上滑看配方
  await page.mouse.move(cx, cy + 100); await page.mouse.down(); await page.mouse.move(cx, cy, { steps: 5 }); await page.mouse.move(cx, cy - 100, { steps: 5 }); await page.mouse.up();
  ok(!!await page.$('.sheet pre.recipe'), '上滑打开配方');
  await page.evaluate(() => window.__appBack());
  // 删除当前（杂色那张）→ 自动显示剩下那张
  await page.click('.viewer [data-a="del"]');
  await page.click('.dialog [data-yes]');
  await page.waitForFunction(() => document.querySelector('[data-count]').textContent.replace(/\s/g, '') === '1/1');
  ok(true, '大图里删除后显示剩下那张');
  await page.click('.viewer [data-a="reuse"]');
  ok(await page.$eval('#view-create', (v) => !v.hidden), '「用这套重画」回到创作页');
  await page.screenshot({ path: OUT + '/创作重画.png' });
  await page.click('#tabbar [data-tab="gallery"]');
  await page.screenshot({ path: OUT + '/图库.png' });

  // 多选：批量删除、批量保存
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      const c = document.createElement('canvas'); c.width = 32; c.height = 48;
      const b = await new Promise((r) => c.toBlob(r, 'image/png'));
      await Gallery.add(b, 'png', { desc: '多选' + i, tag: 'm' + i, meta: { width: 32, height: 48 } });
    }
    await GalleryPage.refresh();
  });
  ok((await page.$$('.thumb')).length === 4, '多选前有 4 张');
  await page.screenshot({ path: OUT + '/图库栏.png' });
  await page.click('#g-sel');
  await page.waitForSelector('.grid.selecting');
  await page.click('.thumb:nth-child(1)'); await page.click('.thumb:nth-child(2)');
  ok(await page.textContent('#g-sel-n') === '已选 2 张' && !await page.$('.viewer'), '多选模式点图是勾选，不打开大图');
  await page.click('#g-sel-all');
  ok(await page.textContent('#g-sel-n') === '已选 4 张' && await page.textContent('#g-sel-all') === '全不选', '全选');
  await page.click('#g-sel-all');
  ok(await page.textContent('#g-sel-n') === '已选 0 张' && await page.$eval('#g-sel-del', (b) => b.disabled), '全不选后删除按钮变灰');
  ok(await page.evaluate(() => window.__appBack()) === true && !await page.$('.grid.selecting'), '返回键先退出多选');
  // 长按 → 多选，带上这一张
  const tb3 = await page.$('.thumb:nth-child(1)'); const bb3 = await tb3.boundingBox();
  await page.mouse.move(bb3.x + 10, bb3.y + 10); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.click('.sheet .menu-item[data-k="multi"]');
  await page.waitForSelector('.grid.selecting');
  ok(await page.textContent('#g-sel-n') === '已选 1 张', '长按菜单「多选」带上这一张');
  await page.click('.thumb:nth-child(2)'); await page.click('.thumb:nth-child(3)');
  await page.screenshot({ path: OUT + '/多选.png' });
  // 批量保存（浏览器里走下载）
  const dls = [];
  page.on('download', (d) => dls.push(d.suggestedFilename()));
  await page.click('#g-sel-save');
  await page.waitForTimeout(800);
  ok(dls.length === 3, '批量保存 3 张（' + dls.length + '）');
  await page.click('#g-sel-del');
  await page.click('.dialog [data-yes]');
  await page.waitForFunction(() => !document.querySelector('.grid.selecting'));
  const left = await page.evaluate(async () => (await Gallery.list()).map((x) => x.desc));
  ok(left.length === 1 && left[0].includes('黄昏'), '批量删除选中的 3 张，留下没选的');
  ok((await page.$$('.thumb')).length === 1, '删完退出多选、网格刷新');

  // 保存位置：默认隐藏文件夹；告诉外壳；自己选文件夹
  const calls = await page.evaluate(async () => {
    const log = [];
    window.AndroidBridge = { setSaveTarget: (m, t, h) => log.push([m, t, h]), pickSaveFolder: () => setTimeout(() => window.__onSaveFolder('content://tree/abc', 'NAI图'), 10) };
    log.push((await Gallery.getPrefs()).save);
    return log;
  });
  ok(calls[0] === 'hidden', '保存位置默认是隐藏文件夹');
  await page.click('#g-opts');
  await page.click('input[name="g-save"][value="custom"]');
  await page.waitForFunction(() => (document.querySelector('[data-help="custom"]') || {}).textContent === '现在是：NAI图');
  await page.click('#g-hide');
  await page.click('input[name="g-save"][value="album"]');
  await page.waitForTimeout(100);
  const after = await page.evaluate(async () => { const p = await Gallery.getPrefs(); return [p.save, p.saveTree, p.saveTreeName, p.saveHide]; });
  ok(after[0] === 'album' && after[1] === 'content://tree/abc' && after[2] === 'NAI图' && after[3] === false, '选了文件夹、关掉隐藏、再切回相册都记住了');
  await page.click('input[name="g-save"][value="custom"]');
  await page.waitForTimeout(100);
  ok((await page.evaluate(async () => (await Gallery.getPrefs()).save)) === 'custom', '已选过文件夹时直接切回，不再弹选择器');
  await page.screenshot({ path: OUT + '/保存位置.png' });
  await page.click('.sheet [data-close]');
  await page.evaluate(async () => { await Gallery.setPrefs({ save: 'hidden' }); delete window.AndroidBridge; });

  // 重开页面：设置、草稿、图库都还在
  await page.reload();
  await page.waitForSelector('#c-write');
  ok((await page.inputValue('#c-tag')).includes('1girl'), '重开后草稿还在');
  const kept = await page.evaluate(async () => [(await Store.get('settings')).nai.key, (await Gallery.list()).length]);
  ok(kept[0] === 'pst-1' && kept[1] === 1, '重开后设置和图库还在');

  // 返回键：先关浮层，再回创作页
  await page.click('#tabbar [data-tab="gallery"]');
  ok(await page.evaluate(() => window.__appBack()) === true && await page.$eval('#view-create', (v) => !v.hidden), '返回键从图库回到创作页');
  ok(await page.evaluate(() => window.__appBack()) === false, '创作页再按返回交给系统');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
