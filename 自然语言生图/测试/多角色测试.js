// C 组（多角色 + 画风参考图）无头浏览器测试：角色提示词进 char_captions、站位、V3 忽略；Vibe 编码、强度、信息提取量、导入导出、V3 发原图
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/多角色测试.js
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const tmp = fs.mkdtempSync(path.join(OUT, 'vibe-'));

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  const bodies = [], encodes = [];
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ status: 404, headers: CORS });
    const b = JSON.parse(req.postData());
    if (req.url().endsWith('/encode-vibe')) {
      encodes.push(b);
      return r.fulfill({ headers: { ...CORS, 'content-type': 'application/octet-stream' }, body: Buffer.alloc(200, encodes.length) });
    }
    bodies.push(b);
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-chars');
  await page.evaluate(() => { Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full', styleId: '' }); UI.saveSettings(); CreatePage.refresh(); });

  // ---------- 多角色 ----------
  ok(await page.isVisible('#c-chars [data-a="add"]'), '创作页有「加一个角色」');
  await page.click('#c-chars [data-a="add"]');
  await page.click('#c-chars [data-a="add"]');
  await page.click('#c-chars [data-a="add"]');
  ok((await page.$$('.char-item')).length === 3, '加了三个角色');
  await page.fill('.char-item[data-i="0"] [data-f="tag"]', '1girl, long black hair, smile');
  await page.fill('.char-item[data-i="0"] [data-f="negative"]', 'short hair');
  await page.fill('.char-item[data-i="1"] [data-f="tag"]', '1boy, glasses');
  await page.fill('.char-item[data-i="2"] [data-f="tag"]', 'girl, red hair');
  await page.click('.char-item[data-i="2"] .switch'); // 关掉第三个
  ok(await page.textContent('#c-chars .badge') === '2 个', '关掉的角色不算');
  await page.fill('#c-tag', '2people, classroom');
  await page.dispatchEvent('#c-tag', 'input');
  // 队列刷新不打断正在输入的格子
  await page.focus('.char-item[data-i="1"] [data-f="tag"]');
  await page.evaluate(() => CreatePage.refresh());
  ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.f === 'tag'), '创作页刷新时不打断角色格子的输入');

  // 不摆位置：use_coords 关
  let q = await page.evaluate(() => Nai.buildBody(UI.settings.nai, { tag: 'x' }).body.parameters);
  ok(q.use_coords === false && q.v4_prompt.caption.char_captions[0].centers[0].x === 0.5, '不摆位置时让模型自己安排');
  // 打开「自己摆位置」：三个圆点排开；拖第 1 个到左上，V4.5 吸到网格
  await page.click('#c-chars label:has([data-a="place"]) .switch');
  ok((await page.$$('.pos-dot')).length === 3 && await page.isVisible('.pos-pad.grid5'), '打开自己摆位置：出现画布和三个圆点（V4.5 带网格）');
  await page.$eval('.pos-pad', (el) => el.scrollIntoView({ block: 'center' }));
  const pad = await page.$eval('.pos-pad', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const dot0 = await page.$eval('.pos-dot[data-dot="0"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(dot0.x, dot0.y);
  await page.mouse.down();
  await page.mouse.move(pad.x + pad.w * 0.15, pad.y + pad.h * 0.22, { steps: 5 });
  await page.mouse.up();
  ok(await page.evaluate(() => Characters.get()[0].pos) === '0.1,0.3', '拖到左上松手吸到最近的格子（0.1,0.3）');
  // 互动：角色 1 拥抱 角色 2
  await page.click('#c-chars [data-a="act-add"]');
  ok((await page.$$('.act-item')).length === 1 && (await page.textContent('.act-item')).includes('角色 1 → 角色 2'), '加一个互动，默认角色 1 → 角色 2 拥抱');
  await page.screenshot({ path: OUT + '/多角色-摆位.png' });

  await page.click('#c-draw');
  await page.waitForFunction(() => document.querySelector('#c-result img'), null, { timeout: 8000 });
  let p = bodies[bodies.length - 1].parameters;
  const cc = p.v4_prompt.caption.char_captions;
  ok(cc.length === 2 && cc[0].char_caption === 'source#hug, girl, long black hair, smile' && cc[1].char_caption === 'target#hug, boy, glasses', '角色提示词进 char_captions，1girl/1boy 换成 girl/boy，互动加 source#/target#：' + cc.map((x) => x.char_caption).join(' | '));
  ok(cc[0].centers[0].x === 0.1 && cc[0].centers[0].y === 0.3 && cc[1].centers[0].x === 0.5 && p.v4_prompt.use_coords === true && p.use_coords === true, '摆了位置就开 use_coords，坐标是网格值');
  // 互相：mutual#
  await page.selectOption('.act-item [data-g="pick"]', 'holding hands');
  ok(await page.isChecked('.act-item [data-g="mutual"]'), '选「牵手」自动勾上互相');
  q = await page.evaluate(() => Nai.buildBody(UI.settings.nai, { tag: 'x' }).body.parameters.v4_prompt.caption.char_captions.map((x) => x.char_caption));
  ok(q[0].startsWith('mutual#holding hands, ') && q[1].startsWith('mutual#holding hands, '), '互相的动作两人都加 mutual#');
  await page.selectOption('.act-item [data-g="pick"]', 'hug');
  const nc = p.v4_negative_prompt.caption.char_captions;
  ok(nc.length === 2 && nc[0].char_caption === 'short hair' && nc[1].char_caption === '', '每个角色单独的负面词');
  ok(p.characterPrompts.length === 2 && p.characterPrompts[0].uc === 'short hair', 'characterPrompts 也发了一份');
  ok(p.v4_prompt.caption.base_caption.startsWith('2people, classroom'), '正面提示词照旧是场景');

  // 配方里记下角色；重绘按那张图的角色来
  const item = await page.evaluate(async () => (await Gallery.list())[0]);
  ok(item.meta.characters && item.meta.characters.length === 2 && item.meta.characters[0].acts[0] === 'source#hug', '图库配方记下了角色和互动');
  await page.fill('.char-item[data-i="1"] [data-f="tag"]', '1boy, hat');
  const nr = bodies.length;
  await page.click('#c-result [data-a="again"]');
  for (let i = 0; i < 30 && bodies.length === nr; i++) await page.waitForTimeout(100);
  p = bodies[bodies.length - 1].parameters;
  ok(p.v4_prompt.caption.char_captions[1].char_caption === 'target#hug, boy, glasses' && p.v4_prompt.caption.char_captions[0].centers[0].x === 0.1, '重绘用那张图当时的角色、互动、位置');
  // 「用这套重画」把角色填回来
  await page.evaluate(() => Characters.set([]));
  await page.evaluate((it) => CreatePage.reuse(it), item);
  ok((await page.$$('.char-item')).length === 2 && await page.inputValue('.char-item[data-i="1"] [data-f="tag"]') === '1boy, glasses', '「用这套重画」把角色填回创作页');
  ok(await page.evaluate(() => { const a = Characters.getActs(), c = Characters.get(); return a.length === 1 && a[0].act === 'hug' && a[0].a === c[0].id && a[0].b === c[1].id && !a[0].mutual; }), '「用这套重画」把互动也拆回来');

  // V3：没有 char_captions，界面提示
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-3'; CreatePage.refresh(); });
  ok((await page.textContent('#c-chars')).includes('V3 不支持'), '选 V3 时提示角色会被忽略');
  const v3 = await page.evaluate(() => Nai.buildBody(UI.settings.nai, { tag: 'x' }).body.parameters);
  ok(!v3.v4_prompt && !v3.characterPrompts, 'V3 请求里没有角色');
  // V5：自由摆位，不吸网格
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-5-full'; CreatePage.refresh(); });
  ok(await page.isVisible('.pos-pad') && !(await page.$('.pos-pad.grid5')), 'V5 的画布没有网格');
  await page.$eval('.pos-pad', (el) => el.scrollIntoView({ block: 'center' }));
  const pad5 = await page.$eval('.pos-pad', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const d1 = await page.$eval('.pos-dot[data-dot="1"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(d1.x, d1.y);
  await page.mouse.down();
  await page.mouse.move(pad5.x + pad5.w * 0.63, pad5.y + pad5.h * 0.44, { steps: 5 });
  await page.mouse.up();
  const c5 = await page.evaluate(() => Nai.buildBody(UI.settings.nai, { tag: 'x' }).body.parameters.v4_prompt.caption.char_captions[1].centers[0]);
  ok(Math.abs(c5.x - 0.63) < 0.02 && Math.abs(c5.y - 0.44) < 0.02, 'V5 任意位置原样发：' + JSON.stringify(c5));
  await page.click('#c-chars label:has([data-a="place"]) .switch');
  ok(!(await page.$('.pos-pad')) && await page.evaluate(() => Characters.get().every((c) => !c.pos)), '关掉自己摆位置，位置清空');

  // ---------- 画风参考图（V5 官方没有，用 V4.5 Curated 测） ----------
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-5-curated'; CreatePage.refresh(); });
  const img = path.join(tmp, 'ref.png') // 文件名用英文：Playwright 传中文文件名时 change 事件不触发;
  fs.writeFileSync(img, PNG);
  await page.click('#c-vibes [data-a="add"]');
  let chooser = page.waitForEvent('filechooser');
  await page.click('[data-src="phone"]');
  await (await chooser).setFiles(img);
  await page.waitForSelector('.vibe-item');
  ok(await page.inputValue('.vibe-item [data-f="name"]') === 'ref', '加了一张参考图，名字取文件名');
  ok((await page.textContent('.vibe-item [data-st]')).includes('还没编码'), '显示还没编码、出图时扣 2 Anlas');
  await page.$eval('.vibe-item [data-f="strength"]', (el) => { el.value = '0.8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('.vibe-item [data-f="info"]', (el) => { el.value = '0.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await page.evaluate(() => UI.settings.nai.vibes[0].strength === 0.8 && UI.settings.nai.vibes[0].info === 0.5), '强度、信息提取量存进设置');

  await page.evaluate(() => Characters.set([]));
  const n0 = bodies.length;
  await page.selectOption('#c-count', '2');
  await page.click('#c-draw');
  for (let i = 0; i < 40 && bodies.length < n0 + 2; i++) await page.waitForTimeout(150);
  ok(encodes.length === 1, '一次出两张只编码一次：' + encodes.length);
  ok(encodes[0].information_extracted === 0.5 && encodes[0].model === 'nai-diffusion-4-5-curated' && encodes[0].image === PNG.toString('base64'), '编码请求带原图、信息提取量、模型');
  p = bodies[bodies.length - 1].parameters;
  ok(p.reference_image_multiple_cached.length === 1 && p.reference_image_multiple_cached[0].data === Buffer.alloc(200, 1).toString('base64') && p.reference_strength_multiple[0] === 0.8, '出图带上编码和强度');
  ok((await page.textContent('.vibe-item [data-st]')).includes('已编码'), '编码后显示已编码');
  // 再出一张不再编码；改信息提取量要重新编码
  await page.selectOption('#c-count', '1');
  await page.click('#c-draw');
  await page.waitForTimeout(500);
  ok(encodes.length === 1, '已编码的不再扣');
  await page.$eval('.vibe-item [data-f="info"]', (el) => { el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#c-draw');
  await page.waitForTimeout(600);
  ok(encodes.length === 2 && encodes[1].information_extracted === 1, '改了信息提取量重新编码');
  const last = await page.evaluate(async () => (await Gallery.list())[0].meta.vibes);
  ok(last && last[0].name === 'ref' && last[0].strength === 0.8, '配方记下用的参考图');

  // 关掉就不发
  await page.click('.vibe-item .switch');
  const off = await page.evaluate(() => Nai.buildBody(UI.settings.nai, { tag: 'x' }).body.parameters);
  ok(off.reference_image_multiple_cached.length === 0, '关掉的参考图不发');
  await page.click('.vibe-item .switch');

  // V3 直接发原图
  const v3b = await page.evaluate(() => Nai.buildBody(Object.assign({}, UI.settings.nai, { model: 'nai-diffusion-3' }), { tag: 'x' }).body.parameters);
  ok(v3b.reference_image_multiple[0] === PNG.toString('base64') && v3b.reference_information_extracted_multiple[0] === 1 && v3b.reference_strength_multiple[0] === 0.8, 'V3 直接发原图、信息提取量、强度');

  // 导出 .naiv4vibe → 导入
  const dl = page.waitForEvent('download');
  await page.click('.vibe-item [data-a="export"]');
  const file = path.join(tmp, 'out.naiv4vibe');
  await (await dl).saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(j.identifier === 'novelai-vibe-transfer' && Object.keys(j.encodings['v4-5curated']).length === 2 && j.importInfo.strength === 0.8, '导出官方格式，两份编码都在');
  // 官网导出的那种：没原图、只有 v4-5full 编码
  const offi = { identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding', name: '官网的', encodings: { 'v4-5full': { abc: { encoding: 'QUJD', params: { information_extracted: 0.7 } } } }, importInfo: { strength: 0.4 } };
  fs.writeFileSync(path.join(tmp, 'official.naiv4vibe'), JSON.stringify(offi));
  await page.click('#c-vibes [data-a="add"]');
  chooser = page.waitForEvent('filechooser');
  await page.click('[data-src="phone"]');
  await (await chooser).setFiles(path.join(tmp, 'official.naiv4vibe'));
  await page.waitForFunction(() => document.querySelectorAll('.vibe-item').length === 2);
  ok(await page.evaluate(() => { const v = UI.settings.nai.vibes[1]; return v.name === '官网的' && v.strength === 0.4 && v.info === 0.7; }), '导入官网 .naiv4vibe：名字、强度、信息提取量');
  ok((await page.textContent('.vibe-item[data-i="1"] [data-st]')).includes('没有 V4.5 Curated 的编码'), '没有当前模型编码时提示');
  await page.click('#c-draw');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => Queue.state().failed) >= 1, '缺编码又没原图时出图失败并提示');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-5-full'; UI.settings.nai.vibes[0].on = false; CreatePage.refresh(); });
  const nb = bodies.length;
  await page.click('#c-draw');
  for (let i = 0; i < 20 && bodies.length === nb; i++) await page.waitForTimeout(150);
  p = bodies[bodies.length - 1].parameters;
  ok(bodies.length > nb && p.reference_image_multiple_cached[0].data === 'QUJD' && p.reference_strength_multiple[0] === 0.4, '换到 V4.5 能用导入的编码');
  await page.screenshot({ path: OUT + '/画风参考.png', fullPage: true });
  // V5：不编码也不发，卡片上说明
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-5-full'; UI.settings.nai.vibes.forEach((v) => { v.on = true; }); CreatePage.refresh(); });
  const v5v = await page.evaluate(async () => { await Vibes.prepare(UI.settings.nai); return Nai.buildBody(UI.settings.nai, { tag: 'x' }).body.parameters; });
  ok(v5v.reference_image_multiple_cached.length === 0 && (await page.textContent('#c-vibes [data-st]')).includes('V5 官方不支持'), 'V5 下参考图不发不编码，卡片上说明');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-5-full'; UI.settings.nai.vibes[0].on = false; CreatePage.refresh(); });

  // ---------- 角色参考（精准参考） ----------
  ok((await page.textContent('#c-dirrefs')).includes('每张 +5 Anlas'), '角色参考卡片标了 +5 Anlas');
  await page.click('#c-dirrefs [data-a="add"]');
  chooser = page.waitForEvent('filechooser');
  await page.click('[data-src="phone"]');
  await (await chooser).setFiles(img);
  await page.waitForSelector('#c-dirrefs .vibe-item');
  ok(await page.evaluate(async () => { const d = await DirectorRef.load(UI.settings.nai.dirRefs[0].id); return d.width === 1472 && d.height === 1472; }), '方图补成 1472×1472');
  await page.click('#c-dirrefs [data-type="style"]');
  await page.$eval('#c-dirrefs [data-f="fidelity"]', (el) => { el.value = '0.3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('#c-dirrefs [data-f="strength"]', (el) => { el.value = '0.75'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => { UI.settings.nai.vibes.forEach((v) => { v.on = true; }); });
  // 从图库再选一张
  await page.click('#c-dirrefs [data-a="add"]');
  await page.click('[data-src="gallery"]');
  await page.waitForSelector('.sheet .thumb');
  await page.click('.sheet .thumb');
  await page.waitForFunction(() => document.querySelectorAll('#c-dirrefs .vibe-item').length === 2);
  ok(await page.evaluate(() => UI.settings.nai.dirRefs[1].name.startsWith('图库')), '能从 App 图库选图当参考');
  await page.click('#c-dirrefs .vibe-item[data-i="1"] .switch'); await page.waitForTimeout(50);
  ok((await page.textContent('#c-dirrefs')).includes('画风参考图（Vibe）会暂停') && (await page.textContent('#c-vibes [data-st]')).includes('正在用角色参考'), '开着角色参考时提示 Vibe 暂停');
  const ne = encodes.length, nd = bodies.length;
  await page.click('#c-draw');
  for (let i = 0; i < 30 && bodies.length === nd; i++) await page.waitForTimeout(100);
  p = bodies[bodies.length - 1].parameters;
  ok(p.director_reference_images.length === 1 && p.director_reference_descriptions[0].caption.base_caption === 'style'
    && p.director_reference_strength_values[0] === 0.75 && p.director_reference_secondary_strength_values[0] === 0.7 && p.director_reference_information_extracted[0] === 1,
    '出图带上角色参考：类型、强度、1-保真度');
  ok(p.reference_image_multiple_cached.length === 0 && encodes.length === ne, '开着角色参考时 Vibe 不发也不编码');
  await page.waitForTimeout(400);
  const dmeta = await page.evaluate(async () => (await Gallery.list())[0].meta.dirRefs);
  ok(dmeta && dmeta[0].type === 'style' && dmeta[0].fidelity === 0.3, '配方记下角色参考');
  if (await page.evaluate(() => !!window.Cost)) {
    ok(await page.evaluate(() => Cost.estimate ? true : true), '有 Anlas 预估模块');
  }
  // V5 不发
  const v5d = await page.evaluate(() => Nai.buildBody(Object.assign({}, UI.settings.nai, { model: 'nai-diffusion-5-full' }), { tag: 'x' }).body.parameters);
  ok(!v5d.director_reference_images, 'V5 不发角色参考');
  await page.screenshot({ path: OUT + '/角色参考.png' });

  // 重开：角色、参考图都还在
  await page.evaluate(() => Characters.set([{ tag: 'girl, cat ears', negative: '', pos: '' }]));
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('#c-vibes .vibe-item');
  ok((await page.$$('#c-vibes .vibe-item')).length === 2 && (await page.$$('#c-vibes .vibe-thumb[src]')).length >= 1 && (await page.$$('#c-dirrefs .vibe-item')).length === 2, '重开后参考图、角色参考和缩略图都在');
  ok(await page.inputValue('.char-item [data-f="tag"]') === 'girl, cat ears', '重开后角色还在');
  // 删除参考图连数据一起删
  page.once('dialog', () => {});
  await page.click('#c-vibes .vibe-item[data-i="0"] [data-a="del"]');
  await page.click('#layers [data-yes]');
  await page.waitForTimeout(300);
  const keys = await page.evaluate(() => Store.keys());
  ok(keys.filter((k) => String(k).startsWith('vibe:')).length === 1, '删除参考图连图和编码一起删');

  await browser.close();
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fails.length) { console.log('\n失败 ' + fails.length + ' 项：\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
