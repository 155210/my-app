// 漫画模式测试：一页多格（分镜框走多角色）、几页、黑白/阅读顺序、分镜一格一张
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/漫画测试.js
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
function png(w, h) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 120; raw[o + 2] = 60; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });

  // 假 AI：按发来的内容回不同的东西；记下每次的用户消息
  const asked = []; let badOnce = false;
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData());
    const user = body.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    asked.push(user);
    let reply;
    if (/这次画成漫画/.test(user)) {
      if (badOnce) { badOnce = false; reply = '{"pages":[{"tag":"1girl","boxes":[]}]}'; }
      else {
        const n = /画成 (\d) 页/.test(user) ? Number(RegExp.$1) : 1;
        reply = JSON.stringify({ pages: Array.from({ length: n }, (_, i) => ({ desc: '第' + (i + 1) + '页', tag: '2girls, comic, monochrome, greyscale', layout: 'The page is divided into three panels: one full-width top panel above two small panels side by side. Read right to left, then top to bottom.', negative: '', size: 'portrait',
          boxes: [{ name: '小星', desc: '两人看罐子', prompt: 'In the full-width top panel, medium shot: girl p' + (i + 1) + ', pale hair', negative: '' }, { name: '小月', desc: '小月伸手', prompt: 'In the full-width top panel, medium shot: girl B, dark hair', negative: 'hat' }, { name: '手部特写', desc: '拧盖子', prompt: 'In the small right panel, tight close-up: two hands', negative: '' }] })), changes: [{ name: '小星', field: 'new', fields: { sex: '1girl', hair: 'pale hair', eyes: 'grey eyes' } }] });
      }
    } else if (/这次要把上面的描述拆成多张图/.test(user)) {
      const n = /一共 (\d) 张/.test(user) ? Number(RegExp.$1) : 2;
      reply = JSON.stringify({ images: Array.from({ length: n }, (_, i) => ({ desc: '远景：第' + (i + 1) + '格', tag: '1girl, shot ' + (i + 1), nl: '', negative: '', size: 'portrait' })) });
    } else reply = JSON.stringify({ tag: '1girl, single', nl: '', negative: '', size: 'portrait' });
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\ndata: [DONE]\n\n';
    await r.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse });
  });
  const naiPrompts = [];
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.method() === 'GET') return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: '{}' });
    naiPrompts.push(JSON.parse(req.postData()));
    await sleep(50);
    await r.fulfill({ headers: { ...CORS, 'content-type': 'application/x-zip-compressed' }, body: zip('image_0.png', png(64, 96), 8) });
  });

  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(url);
  await page.waitForSelector('#c-write');
  await page.evaluate(() => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm' });
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full' });
    UI.settings.autoDraw = false;
    UI.saveSettings(); CreatePage.refresh();
  });
  const idle = () => page.waitForFunction(() => { const s = Queue.state(); return s.running + s.waiting === 0; }, null, { timeout: 30000 });

  // 纯函数
  const unit = await page.evaluate(() => {
    const r = {};
    r.note = Comic.comicNote({ panels: '4', pages: 2, mono: true, rtl: false, layout: 'column', bubble: true });
    r.note2 = Comic.comicNote({ panels: 'auto', pages: 1, mono: false, rtl: true, layout: 'auto', bubble: false });
    try { Comic.parse('{"pages":[{"tag":"1girl","boxes":[' + Array(7).fill('{"prompt":"x"}').join(',') + ']}]}', { pages: 1 }); r.many = 'no'; } catch (e) { r.many = e.message; }
    try { Comic.parse('{"pages":[{"tag":"1girl","boxes":[{"prompt":"x"}]}]}', { pages: 2 }); r.short = 'no'; } catch (e) { r.short = e.message; }
    r.p = Comic.parse('<think>x</think>```json\n{"tag":"1girl","layout":"L","size":"横","panels":[{"name":"a","positive":"In the top panel: a"},{"prompt":""}]}```', { pages: 1 });
    return r;
  });
  ok(/画成 2 页/.test(unit.note) && /每页 4 格/.test(unit.note) && /comic, monochrome, greyscale/.test(unit.note) && /left to right/.test(unit.note) && /single column/.test(unit.note) && /speech bubble/.test(unit.note), '漫画说明：页数、格数、黑白、左往右读、版式、对白');
  ok(/一般 3～5 格/.test(unit.note2) && /接 comic。/.test(unit.note2) && /right to left/.test(unit.note2) && /不要对白气泡/.test(unit.note2) && !/明暗：pale/.test(unit.note2), '漫画说明：AI 定格数、彩色、日漫顺序、不要文字');
  ok(/最多 6 个/.test(unit.many), '超过 6 个框算格式不对');
  ok(/只给了 1 页/.test(unit.short), '页数不够算格式不对');
  ok(unit.p.pages.length === 1 && unit.p.pages[0].boxes.length === 1 && unit.p.pages[0].size === 'landscape' && unit.p.pages[0].boxes[0].prompt === 'In the top panel: a', '解析：单页对象、panels/positive 别名、空框跳过');

  // 选项：选漫画才显示
  ok(await page.isHidden('#c-comic-opts'), '没选漫画时不显示漫画选项');
  await page.selectOption('#c-plan', 'comic');
  ok(await page.isVisible('#c-comic-opts [data-for="comic"] [data-o="pages"]') && await page.isHidden('#c-comic-opts [data-for="story"]'), '选了画成漫画：显示格数/页数/版式');
  ok(await page.textContent('#c-write') === 'AI 画漫画', '按钮变「AI 画漫画」');
  await page.selectOption('#c-comic-opts [data-for="comic"] [data-o="pages"]', '2');
  await page.selectOption('#c-comic-opts [data-for="comic"] [data-o="panels"]', '3');
  await page.fill('#c-desc', '小星和小月一起拧罐子');
  await page.dispatchEvent('#c-desc', 'input');
  badOnce = true;
  const n0 = asked.length;
  await page.click('#c-write');
  await page.waitForSelector('#c-comic-card');
  ok(asked.length === n0 + 2, '第一次没框自动重试');
  ok(/画成 2 页/.test(asked[asked.length - 1]) && /每页 3 格/.test(asked[asked.length - 1]), '请求里写了页数和格数');
  ok((await page.$$('#c-comic-card .comic-page')).length === 2 && (await page.$$('#c-comic-card .comic-page[data-i="0"] .comic-boxes li')).length === 3, '卡片列出 2 页、每页 3 个框');
  ok(await page.evaluate(() => !!CharLib.find('小星')), '漫画回的 changes 照常建档');
  await page.screenshot({ path: OUT + '/漫画-结果.png', fullPage: true });

  // 出这页：分镜框进 char_captions，不摆位置；版式进正面
  naiPrompts.length = 0;
  await page.click('#c-comic-card .comic-page[data-i="1"] [data-one]');
  await idle();
  const b = naiPrompts[0];
  const caps = b && b.parameters.v4_prompt.caption.char_captions;
  ok(caps && caps.length === 3 && /girl p2/.test(caps[0].char_caption) && /two hands/.test(caps[2].char_caption), '出这页：3 个分镜框作为角色提示词发出（第 2 页）');
  ok(b && b.parameters.v4_prompt.use_coords === false, '分镜框不摆位置');
  ok(b && /2girls, comic, monochrome/.test(b.input) && /divided into three panels/.test(b.input), '主正面带人数和版式');
  ok(b && b.parameters.v4_negative_prompt.caption.char_captions[1].char_caption === 'hat', '分镜框的负面也发');
  ok(/已出 1 次/.test(await page.textContent('#c-comic-card .comic-page[data-i="1"]')), '标出已出几次');
  ok(await page.evaluate(() => Characters.get().length) === 0, '出漫画不动创作页的多角色格子');
  ok(/no text/.test(b.input), '没要对白时质量词里的 no text 照留');
  await page.evaluate(() => { Comic.get().bubble = true; });
  naiPrompts.length = 0;
  await page.click('#c-comic-card .comic-page[data-i="0"] [data-one]');
  await idle();
  ok(!/no text/.test(naiPrompts[0].input) && !/no text/.test(naiPrompts[0].parameters.v4_prompt.caption.base_caption), '要对白气泡：去掉 no text');
  await page.evaluate(() => { Comic.get().bubble = false; });

  // 全部出图
  naiPrompts.length = 0;
  await page.click('#c-comic-card [data-all]');
  await idle();
  ok(naiPrompts.length === 2 && /girl p1/.test(naiPrompts[0].parameters.v4_prompt.caption.char_captions[0].char_caption), '全部出图：2 页按顺序出');

  // V3：没有角色提示词，全拼进正面
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-3'; CreatePage.refresh(); });
  naiPrompts.length = 0;
  await page.click('#c-comic-card .comic-page[data-i="0"] [data-one]');
  await idle();
  ok(naiPrompts[0] && /two hands/.test(naiPrompts[0].input) && !naiPrompts[0].parameters.v4_prompt, 'V3：分镜框拼进正面');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-5-full'; CreatePage.refresh(); });

  // 填到上面
  await page.click('#c-comic-card .comic-page[data-i="0"] [data-fill]');
  ok(/divided into three panels/.test(await page.inputValue('#c-tag')) && await page.evaluate(() => Characters.get().length) === 3, '填到上面：版式进正面、分镜框进多角色格子');

  // 重开还在
  await page.reload();
  await page.waitForSelector('#c-comic-card');
  ok(await page.inputValue('#c-plan') === 'comic' && await page.inputValue('#c-comic-opts [data-for="comic"] [data-o="pages"]') === '2' && (await page.$$('#c-comic-card .comic-page')).length === 2, '重开 App 漫画结果和选项还在');
  await page.click('#c-comic-card [data-close-comic]');
  ok(!(await page.$('#c-comic-card')), '收起漫画卡片');

  // 分镜一格一张
  await page.selectOption('#c-plan', 'story');
  ok(await page.textContent('#c-write') === 'AI 拆分镜' && await page.isVisible('#c-comic-opts [data-for="story"] [data-o="panels"]') && await page.isHidden('#c-comic-opts [data-for="comic"] [data-o="pages"]'), '分镜一格一张：按钮和选项');
  ok(await page.inputValue('#c-comic-opts [data-for="story"] [data-o="panels"]') === '3', '格数和漫画共用');
  await page.click('#c-write');
  await page.waitForSelector('#c-plan-card');
  const last = asked[asked.length - 1];
  ok(/一共 3 张/.test(last) && /按漫画分镜来拆/.test(last) && /monochrome, greyscale/.test(last), '分镜：走拆成多张，附上分镜要求和黑白');
  ok(/分镜 3 格/.test(await page.textContent('#c-plan-card .card-title')) && (await page.$$('#c-plan-card .plan-item')).length === 3, '结果在拆多张卡片里，标题是分镜');
  naiPrompts.length = 0;
  await page.click('#c-plan-card [data-all]');
  await idle();
  ok(naiPrompts.length === 3, '分镜全部出图出了 3 张');

  // 不选漫画时照旧
  await page.selectOption('#c-plan', '');
  ok(await page.textContent('#c-write') === 'AI 写提示词' && await page.isHidden('#c-comic-opts'), '切回不拆：按钮和选项恢复');

  await browser.close(); srv.close();
  if (fails.length) { console.log('\n失败 ' + fails.length + ' 项'); fails.forEach((f) => console.log(' - ' + f)); process.exit(1); }
  console.log('\n全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
