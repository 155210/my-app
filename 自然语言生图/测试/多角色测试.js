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
  await page.selectOption('.char-item[data-i="0"] [data-f="pos"]', '0.3,0.5');
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

  await page.click('#c-draw');
  await page.waitForFunction(() => document.querySelector('#c-result img'), null, { timeout: 8000 });
  let p = bodies[bodies.length - 1].parameters;
  const cc = p.v4_prompt.caption.char_captions;
  ok(cc.length === 2 && cc[0].char_caption === 'girl, long black hair, smile' && cc[1].char_caption === 'boy, glasses', '角色提示词进 char_captions，1girl/1boy 换成 girl/boy');
  ok(cc[0].centers[0].x === 0.3 && cc[1].centers[0].x === 0.5 && p.v4_prompt.use_coords === true && p.use_coords === true, '指定了站位就开 use_coords');
  const nc = p.v4_negative_prompt.caption.char_captions;
  ok(nc.length === 2 && nc[0].char_caption === 'short hair' && nc[1].char_caption === '', '每个角色单独的负面词');
  ok(p.characterPrompts.length === 2 && p.characterPrompts[0].uc === 'short hair', 'characterPrompts 也发了一份');
  ok(p.v4_prompt.caption.base_caption.startsWith('2people, classroom'), '正面提示词照旧是场景');

  // 配方里记下角色；重绘按那张图的角色来
  const item = await page.evaluate(async () => (await Gallery.list())[0]);
  ok(item.meta.characters && item.meta.characters.length === 2, '图库配方记下了角色');
  await page.fill('.char-item[data-i="1"] [data-f="tag"]', '1boy, hat');
  const nr = bodies.length;
  await page.click('#c-result [data-a="again"]');
  for (let i = 0; i < 30 && bodies.length === nr; i++) await page.waitForTimeout(100);
  p = bodies[bodies.length - 1].parameters;
  ok(p.v4_prompt.caption.char_captions[1].char_caption === 'boy, glasses', '重绘用那张图当时的角色');
  // 「用这套重画」把角色填回来
  await page.evaluate(() => Characters.set([]));
  await page.evaluate((it) => CreatePage.reuse(it), item);
  ok((await page.$$('.char-item')).length === 2 && await page.inputValue('.char-item[data-i="1"] [data-f="tag"]') === '1boy, glasses', '「用这套重画」把角色填回创作页');

  // V3：没有 char_captions，界面提示
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-3'; CreatePage.refresh(); });
  ok((await page.textContent('#c-chars')).includes('V3 不支持'), '选 V3 时提示角色会被忽略');
  const v3 = await page.evaluate(() => Nai.buildBody(UI.settings.nai, { tag: 'x' }).body.parameters);
  ok(!v3.v4_prompt && !v3.characterPrompts, 'V3 请求里没有角色');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-5-full'; CreatePage.refresh(); });
  await page.screenshot({ path: OUT + '/多角色.png', fullPage: true });

  // ---------- 画风参考图 ----------
  const img = path.join(tmp, 'ref.png') // 文件名用英文：Playwright 传中文文件名时 change 事件不触发;
  fs.writeFileSync(img, PNG);
  let chooser = page.waitForEvent('filechooser');
  await page.click('#c-vibes [data-a="add"]');
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
  ok(encodes[0].information_extracted === 0.5 && encodes[0].model === 'nai-diffusion-5-full' && encodes[0].image === PNG.toString('base64'), '编码请求带原图、信息提取量、模型');
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
  ok(j.identifier === 'novelai-vibe-transfer' && Object.keys(j.encodings.v5full).length === 2 && j.importInfo.strength === 0.8, '导出官方格式，两份编码都在');
  // 官网导出的那种：没原图、只有 v4-5full 编码
  const offi = { identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding', name: '官网的', encodings: { 'v4-5full': { abc: { encoding: 'QUJD', params: { information_extracted: 0.7 } } } }, importInfo: { strength: 0.4 } };
  fs.writeFileSync(path.join(tmp, 'official.naiv4vibe'), JSON.stringify(offi));
  chooser = page.waitForEvent('filechooser');
  await page.click('#c-vibes [data-a="add"]');
  await (await chooser).setFiles(path.join(tmp, 'official.naiv4vibe'));
  await page.waitForFunction(() => document.querySelectorAll('.vibe-item').length === 2);
  ok(await page.evaluate(() => { const v = UI.settings.nai.vibes[1]; return v.name === '官网的' && v.strength === 0.4 && v.info === 0.7; }), '导入官网 .naiv4vibe：名字、强度、信息提取量');
  ok((await page.textContent('.vibe-item[data-i="1"] [data-st]')).includes('没有 V5 Full 的编码'), '没有当前模型编码时提示');
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

  // 重开：角色、参考图都还在
  await page.evaluate(() => Characters.set([{ tag: 'girl, cat ears', negative: '', pos: '' }]));
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.vibe-item');
  ok((await page.$$('.vibe-item')).length === 2 && (await page.$$('.vibe-thumb[src]')).length >= 1, '重开后参考图和缩略图都在');
  ok(await page.inputValue('.char-item [data-f="tag"]') === 'girl, cat ears', '重开后角色还在');
  // 删除参考图连数据一起删
  page.once('dialog', () => {});
  await page.click('.vibe-item[data-i="0"] [data-a="del"]');
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
