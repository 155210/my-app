// 角色系统测试：衣柜（多套、穿脱状态、遮挡）、AI 一句话生成角色和衣柜、写真模式出图
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/角色系统测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');
const OUT = process.env.OUT || require('os').tmpdir();

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(OUT, name), animations: 'disabled' }); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  let aiReply = '', aiSystem = '';
  const bodies = [];
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    aiSystem = JSON.parse(req.postData()).messages[0].content;
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: aiReply } }] }) });
  });
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription') || req.method() === 'GET') return r.fulfill({ status: 404, headers: CORS });
    bodies.push(JSON.parse(req.postData()));
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });

  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(url);
  await page.waitForSelector('#c-tag');
  await page.evaluate(async () => {
    await CharLib.ready;
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm', stream: false });
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full', styleId: '' });
    UI.settings.autoDraw = false;
    UI.saveSettings();
  });

  // ---------- 遮挡和状态（纯函数） ----------
  const r = await page.evaluate(() => {
    const o = (items) => Wardrobe.render(Wardrobe.normalizeOutfit({ items }));
    const base = { top: 'white shirt', bottom: 'pleated skirt', bra: 'white bra', panties: 'white panties', legwear: 'black thighhighs', footwear: 'loafers' };
    const st = (over) => { const it = {}; Object.keys(base).forEach((k) => { it[k] = { tags: base[k], state: over[k] || 'intact' }; }); return o(it); };
    return {
      dressed: st({}),
      shirtOpen: st({ top: 'open' }),
      topless: st({ top: 'removed', bra: 'removed' }),
      noShoes: st({ footwear: 'removed' }),
      nude: st({ top: 'removed', bra: 'removed', bottom: 'removed', panties: 'removed' }),
      allOff: o({ top: { tags: 'shirt', state: 'removed' }, bottom: { tags: 'skirt', state: 'removed' } }),
      kimono: o({ outerwear: { tags: 'kimono' }, bra: { tags: 'white bra' }, panties: { tags: 'white panties' } }),
      lift: st({ bottom: 'lifted' }),
    };
  });
  ok(r.dressed.tags === 'white shirt, pleated skirt, black thighhighs, loafers' && r.dressed.hidden.join() === 'bra,panties' && !r.dressed.nsfw, '穿好时内衣被挡住不写：' + r.dressed.tags);
  ok(r.shirtOpen.tags.includes('open shirt') && r.shirtOpen.tags.includes('white bra') && r.shirtOpen.nsfw, '敞开衬衫露出胸罩、加 nsfw：' + r.shirtOpen.tags);
  ok(r.topless.tags.includes('topless') && !r.topless.tags.includes('shirt'), '上衣和胸罩都脱：topless');
  ok(!r.noShoes.tags.includes('barefoot') && !r.noShoes.tags.includes('loafers'), '穿着袜子脱鞋不写 barefoot');
  ok(r.nude.tags.includes('nude') && !r.nude.tags.includes('completely nude') && r.nude.tags.includes('thighhighs'), '还穿着袜子：nude 不是 completely nude：' + r.nude.tags);
  ok(r.allOff.tags === 'completely nude', '什么都没穿：completely nude');
  ok(r.kimono.tags === 'kimono', '和服挡住内衣');
  ok(r.lift.tags.includes('skirt lift') && r.lift.tags.includes('white panties'), '掀起裙子露出内裤：' + r.lift.tags);

  // ---------- AI 一句话生成 ----------
  aiReply = JSON.stringify({
    name: '小铃', alias: '', fields: { sex: '1girl', hair: 'long silver hair', eyes: 'red eyes', extra: 'cat ears, cat tail', outfit: '' },
    outfits: [
      { name: '女仆装', items: { dress: 'maid dress, black dress', headwear: 'maid headdress', legwear: 'white thighhighs', footwear: 'mary janes', bra: 'white bra', nonsense: 'x' } },
      { name: '休息日', items: { top: 'grey hoodie', bottom: 'denim shorts', footwear: 'sneakers' } },
    ],
  });
  await page.click('#c-char-lib');
  await page.click('[data-la]:has-text("AI 生成角色")');
  await page.waitForSelector('[data-cg-q]');
  await page.fill('[data-cg-q]', '二十岁的猫娘女仆，银发红眼');
  await page.click('[data-cg-go]');
  await page.waitForFunction(() => document.querySelector('[data-f="name"]').value === '小铃');
  ok(aiSystem.includes('outerwear（外套）') && aiSystem.includes('只输出一段 JSON'), '发给 AI 的规范里有部位说明');
  ok((await page.$eval('[data-f="hair"]', (e) => e.value)) === 'long silver hair' && (await page.$eval('[data-f="extra"]', (e) => e.value)) === 'cat ears, cat tail', 'AI 生成的外貌填进编辑页');
  ok((await page.$$('.wd-card')).length === 2 && await page.$eval('.wd-card.on', (e) => e.textContent.includes('女仆装')), '生成两套衣服，第一套默认穿上');
  const prev = await page.$eval('.cl-preview', (e) => e.textContent);
  ok(prev === '1girl, long silver hair, red eyes, cat ears, cat tail, maid dress, black dress, white thighhighs, mary janes, maid headdress', '外貌预览带上正在穿的衣服（胸罩被裙子挡住）：' + prev);
  await shot(page, '角色系统-AI生成.png');

  // 编辑衣柜：换一套、改状态
  await page.click('.wd-card:has-text("休息日") [data-wa="wear"]');
  ok((await page.$eval('.cl-preview', (e) => e.textContent)).includes('grey hoodie, denim shorts'), '换一套穿');
  await page.click('.wd-card:has-text("休息日") [data-wa="toggle"]');
  await page.selectOption('.wd-card:has-text("休息日") [data-wst="footwear"]', 'removed');
  ok(!(await page.$eval('.cl-preview', (e) => e.textContent)).includes('sneakers') && (await page.$eval('.cl-preview', (e) => e.textContent)).includes('barefoot'), '改穿脱状态马上反映到预览（脱鞋 → barefoot）');
  await page.fill('.wd-card:has-text("休息日") [data-ws="headwear"]', 'baseball cap');
  ok((await page.$eval('.cl-preview', (e) => e.textContent)).includes('baseball cap'), '加衣服');
  await shot(page, '角色系统-衣柜.png');
  await page.click('[data-save]');
  await page.waitForSelector('.cl-card');
  const saved = await page.evaluate(() => { const c = CharLib.find('小铃'); return { n: c.wardrobe.outfits.length, cur: Wardrobe.current(c).name, exp: CharLib.expand('小铃, smile') }; });
  ok(saved.n === 2 && saved.cur === '休息日', '保存后衣柜在角色库里');
  ok(saved.exp.includes('grey hoodie') && saved.exp.includes('barefoot') && saved.exp.includes('baseball cap'), '提示词写名字时带上正在穿的衣服：' + saved.exp);

  // ---------- 写真模式 ----------
  await page.click('[data-la]:has-text("写真模式")');
  await page.waitForSelector('.ps-chips');
  ok(await page.$eval('[data-ps="outfit"]', (e) => e.selectedOptions[0].textContent.includes('休息日')), '默认用正在穿的那套');
  await page.selectOption('[data-ps="outfit"]', { label: '女仆装' });
  await page.click('[data-g="expr"] .ps-chip:has-text("害羞")');
  await page.click('[data-g="pose"] .ps-chip:has-text("托腮")');
  await page.click('[data-g="shot"] .ps-chip:has-text("上半身")');
  await page.click('[data-g="scene"] .ps-chip:has-text("咖啡馆")');
  await page.fill('[data-ps="customScene"]', 'window');
  await page.selectOption('[data-pst="dress"]', 'lifted');
  const tag = await page.$eval('.ps-prev', (e) => e.textContent);
  ok(tag.startsWith('1girl, long silver hair, red eyes, cat ears, cat tail, maid dress, black dress, dress lift') && tag.includes('nsfw, blush, embarrassed, hand on own chin, upper body, cafe, indoors, window'), '拼出的标签：外貌 + 衣服状态 + 表情 + 姿势 + 镜头 + 场景：' + tag);
  ok(await page.evaluate(() => Wardrobe.normalize(CharLib.find('小铃').wardrobe).outfits[0].items.dress.state === 'intact'), '写真里临时改状态不动衣柜');
  await page.click('[data-ps-size] [data-v="landscape"]');
  await page.selectOption('[data-ps="count"]', '2');
  await shot(page, '角色系统-写真.png');
  await page.click('[data-ps="go"]');
  await page.waitForFunction(() => document.querySelectorAll('.ps-grid img').length === 2, null, { timeout: 15000 });
  ok(bodies.length === 2, '出了 2 张');
  const b = bodies[0];
  ok(b.input.includes('dress lift') && b.input.includes('cafe') && b.parameters.width > b.parameters.height, '请求里是写真的标签、横图');
  ok(b.parameters.v4_prompt.caption.char_captions.length === 0, '创作页的多角色格子不参与');
  const g = await page.evaluate(async () => (await Gallery.list()).slice(0, 2).map((x) => x.desc));
  ok(g.every((d) => d === '写真：小铃'), '进了图库，配方里写着「写真：小铃」');
  await shot(page, '角色系统-写真结果.png');

  // 存回衣柜
  await page.click('[data-ps="keep"]');
  ok(await page.evaluate(() => Wardrobe.normalize(CharLib.find('小铃').wardrobe).outfits[0].items.dress.state === 'lifted'), '「把状态存回衣柜」');
  await page.evaluate(() => { window.__appBack(); window.__appBack(); });

  // 创作页入口、重开还在
  ok(await page.isVisible('#c-photo'), '创作页有「写真」入口');
  await page.waitForTimeout(500);
  await page.goto(url);
  await page.waitForSelector('#c-tag');
  const after = await page.evaluate(async () => { await CharLib.ready; const c = CharLib.find('小铃'); return c && c.wardrobe.outfits.length + Photoshoot.sel.size; });
  ok(after === '2landscape', '重开 App 衣柜和写真选择都在');

  await browser.close();
  srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
