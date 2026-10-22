// 导出时处理图片信息（保留 / 清除 / 改写、分享）和图库按日期筛选
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/导出与日期测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, texts) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 120; raw[o + 2] = (x * 9) & 255; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...Object.entries(texts || {}).map(([k, v]) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'utf8')]))), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
/** 检查 PNG 的每个块 CRC 都对 */
function crcOk(buf) { for (let o = 8; o + 12 <= buf.length;) { const len = buf.readUInt32BE(o); const td = buf.subarray(o + 4, o + 8 + len); if (crc32(td) !== buf.readUInt32BE(o + 8 + len)) return false; if (td.subarray(0, 4).toString() === 'IEND') return true; o += 12 + len; } return false; }
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

const COMMENT = JSON.stringify({ prompt: '1girl, 秘密的提示词, masterpiece', uc: 'lowres, bad hands', seed: 424242, steps: 28, scale: 5, sampler: 'k_euler_ancestral', width: 64, height: 48,
  v4_prompt: { caption: { base_caption: '1girl, 秘密的提示词, masterpiece', char_captions: [] } }, v4_negative_prompt: { caption: { base_caption: 'lowres, bad hands', char_captions: [] } } });

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');

  const naiPng = png(64, 48, { Title: 'NovelAI generated image', Description: '1girl, 秘密的提示词', Software: 'NovelAI', Source: 'NovelAI Diffusion V4.5', Comment: COMMENT }).toString('base64');

  // 四张图：今天、3 天前、20 天前、60 天前；第一张带 PNG 文本信息，第二张是带隐写的
  await page.evaluate(async ({ naiPng }) => {
    await Gallery.setPrefs({ jpg: false });
    const b64 = (s) => new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], { type: 'image/png' });
    // 隐写：透明通道最低位按列从上到下写 'stealth_pnginfo' + 32 位长度 + 内容
    const stealth = async (text) => {
      const W = 64, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, W, H);
      const d = g.getImageData(0, 0, W, H);
      const data = new TextEncoder().encode(text), sig = new TextEncoder().encode('stealth_pnginfo');
      const bits = [];
      for (const b of sig) for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1);
      const n = data.length * 8; for (let k = 31; k >= 0; k--) bits.push(Math.floor(n / 2 ** k) % 2);
      for (const b of data) for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1);
      for (let i = 0; i < W * H; i++) { const x = Math.floor(i / H), y = i % H; d.data[(y * W + x) * 4 + 3] = 254 | (i < bits.length ? bits[i] : 1); }
      g.putImageData(d, 0, 0);
      return new Promise((r) => c.toBlob(r, 'image/png'));
    };
    const plain = async () => { const c = document.createElement('canvas'); c.width = 30; c.height = 20; c.getContext('2d').fillRect(0, 0, 30, 20); return new Promise((r) => c.toBlob(r, 'image/png')); };
    const DAY = 86400000;
    const add = async (blob, desc, ago, meta) => { const it = await Gallery.add(blob, 'png', { desc, tag: desc, meta: meta || {} }); it.time = Date.now() - ago; return it; };
    await add(await plain(), '六十天前', 60 * DAY);
    await add(await plain(), '二十天前', 20 * DAY);
    await add(await stealth(JSON.stringify({ Comment: JSON.stringify({ prompt: 'stealth secret prompt', uc: 'bad', seed: 7 }), Software: 'NovelAI' })), '三天前隐写', 3 * DAY);
    await add(b64(naiPng), '今天', 1000, { positive: 'app positive', seed: 1 });
    await Store.set('gallery', await Gallery.list());
  }, { naiPng });
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForSelector('#g-date');

  // ---------- 读得出原始信息 ----------
  const info = (desc) => page.evaluate(async (desc) => { const it = (await Gallery.list()).find((x) => x.desc === desc); return Gallery.readInfo(await Gallery.getBlob(it.id)); }, desc);
  ok((await info('今天')).prompt.includes('秘密的提示词'), '原图读得出 PNG 文本信息');
  ok(((await info('三天前隐写')) || {}).prompt === 'stealth secret prompt', '原图读得出隐写信息');

  // ---------- 日期筛选 ----------
  const thumbs = () => page.$$eval('.thumb', (a) => a.length);
  const pickDate = async (k) => { await page.click('#g-date'); await page.click('.sheet .menu-item[data-k="' + k + '"]'); await page.waitForTimeout(120); };
  ok(await thumbs() === 4, '一开始 4 张');
  await page.click('#g-date');
  const counts = await page.$$eval('.sheet .menu-item', (a) => a.map((x) => x.textContent));
  ok(counts.join('|').includes('今天1 张') && counts.join('|').includes('近 7 天2 张') && counts.join('|').includes('近 30 天3 张'), '日期菜单上有张数：' + counts.join('|'));
  await page.click('.sheet .menu-item[data-k="today"]'); await page.waitForTimeout(120);
  ok(await thumbs() === 1, '今天：1 张');
  ok((await page.textContent('#g-date')).includes('今天') && await page.$('#g-date.on'), '日期按钮显示「今天」并高亮');
  ok((await page.textContent('.g-bar .card-sub')).includes('筛出 1 / 4'), '顶上显示筛出 1 / 4');
  await pickDate('7'); ok(await thumbs() === 2, '近 7 天：2 张');
  await pickDate('30'); ok(await thumbs() === 3, '近 30 天：3 张');
  // 指定范围：70 天前 ~ 50 天前
  const ymd = (ago) => page.evaluate((ago) => GalleryDate.ymd(Date.now() - ago * 86400000), ago);
  await page.click('#g-date'); await page.click('.sheet .menu-item[data-k="range"]');
  await page.fill('.dialog [data-from]', await ymd(70));
  await page.fill('.dialog [data-to]', await ymd(50));
  ok((await page.textContent('.dialog [data-n]')).includes('1 张'), '范围对话框里实时显示张数：' + await page.textContent('.dialog [data-n]'));
  await page.click('.dialog [data-ok]'); await page.waitForTimeout(120);
  ok(await thumbs() === 1 && (await page.evaluate(async () => (await Gallery.list()).find((x) => x.id === document.querySelector('.thumb').dataset.id).desc)) === '六十天前', '指定范围：只剩六十天前那张');
  // 只填「从」
  await page.click('#g-date'); await page.click('.sheet .menu-item[data-k="range"]');
  await page.fill('.dialog [data-from]', await ymd(21)); await page.fill('.dialog [data-to]', '');
  await page.click('.dialog [data-ok]'); await page.waitForTimeout(120);
  ok(await thumbs() === 3, '只填开始日期：那天以后 3 张');
  // 截止那天整天都算：从今天到今天
  await page.click('#g-date'); await page.click('.sheet .menu-item[data-k="range"]');
  await page.fill('.dialog [data-from]', await ymd(0)); await page.fill('.dialog [data-to]', await ymd(0));
  await page.click('.dialog [data-ok]'); await page.waitForTimeout(120);
  ok(await thumbs() === 1, '范围是今天到今天：1 张（截止当天算进去）');
  // 和收藏一起用
  await page.evaluate(async () => { const l = await Gallery.list(); await Gallery.mark([l.find((x) => x.desc === '二十天前').id], { fav: true }); });
  await pickDate('30');
  await page.click('#g-views [data-view="fav"]'); await page.waitForTimeout(120);
  ok(await thumbs() === 1, '近 30 天 + 收藏：1 张');
  await pickDate('today');
  ok((await page.textContent('.empty')).includes('今天没有图'), '筛空了有提示');
  await page.click('#g-views [data-view=""]'); await page.waitForTimeout(80);
  await pickDate(''); ok(await thumbs() === 4, '全部日期：回到 4 张');
  // 跨天：边界
  ok(await page.evaluate(() => {
    const now = new Date(2026, 9, 22, 0, 5).getTime();
    const y = new Date(2026, 9, 21, 23, 59).getTime(), sixAgo = new Date(2026, 9, 16, 0, 0).getTime(), sevenAgo = new Date(2026, 9, 15, 23, 59).getTime();
    return !GalleryDate.match({ time: y }, { k: 'today' }, now) && GalleryDate.match({ time: sixAgo }, { k: '7' }, now) && !GalleryDate.match({ time: sevenAgo }, { k: '7' }, now);
  }), '按本地日期整天算：昨天 23:59 不算今天；近 7 天含今天往前 6 天');

  // ---------- 清除信息 ----------
  const stripped = await page.evaluate(async () => {
    const l = await Gallery.list();
    const one = async (desc) => {
      const it = l.find((x) => x.desc === desc), blob = await Gallery.getBlob(it.id);
      const out = await ExportInfo.strip(blob);
      const u8 = new Uint8Array(await out.arrayBuffer());
      const txt = new TextDecoder('latin1').decode(u8);
      const px = async (b) => { const bmp = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return [...g.getImageData(0, 0, c.width, c.height).data]; };
      const a = await px(blob), b = await px(out);
      let diff = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3 && Math.abs(a[i] - b[i]) > 2) diff++;
      return { info: await Gallery.readInfo(out), hasText: /tEXt|iTXt|zTXt/.test(txt), secret: txt.includes('masterpiece'), diff, w: (await createImageBitmap(out)).width, b64: btoa(String.fromCharCode(...u8)) };
    };
    return { nai: await one('今天'), st: await one('三天前隐写') };
  });
  ok(!stripped.nai.info && !stripped.nai.hasText && !stripped.nai.secret, '清除：PNG 文本块全去掉，读不出信息');
  ok(crcOk(Buffer.from(stripped.nai.b64, 'base64')), '清除后的 PNG 每块 CRC 都对');
  ok(stripped.nai.diff === 0 && stripped.nai.w === 64, '清除：画面一点没变');
  ok(!stripped.st.info, '清除：隐写信息也抹掉了，读不出来');
  ok(stripped.st.diff === 0, '清除隐写：颜色没变（只动了透明度最低位）');

  // JPG：EXIF 和注释去掉，图还能打开
  const jpg = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 40, 30);
    const j = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const seg = (m, s) => { const b = new TextEncoder().encode(s); return [0xff, m, (b.length + 2) >> 8, (b.length + 2) & 255, ...b]; };
    const withMeta = new Uint8Array([0xff, 0xd8, ...seg(0xe1, 'Exif\0\0SECRET-EXIF'), ...seg(0xfe, 'SECRET-COMMENT'), ...j.subarray(2)]);
    const out = await ExportInfo.strip(new Blob([withMeta], { type: 'image/jpeg' }));
    const t = new TextDecoder('latin1').decode(new Uint8Array(await out.arrayBuffer()));
    let w = 0; try { w = (await createImageBitmap(out)).width; } catch (e) { w = -1; }
    return { secret: t.includes('SECRET'), w, type: out.type, smaller: out.size < withMeta.length };
  });
  ok(!jpg.secret && jpg.w === 40 && jpg.type === 'image/jpeg', 'JPG 清除：EXIF、注释去掉，还是 JPG、能正常打开');

  // ---------- 改写 ----------
  const rw = await page.evaluate(async () => {
    const it = (await Gallery.list()).find((x) => x.desc === '今天'), blob = await Gallery.getBlob(it.id);
    const out = await ExportInfo.rewrite(blob, { prompt: '改过的正面', negative: '改过的负面', seed: '99', software: 'MyApp', source: '', title: '', keepParams: true });
    const t = await Gallery.pngText(await out.arrayBuffer());
    const c = JSON.parse(t.Comment);
    const out2 = await ExportInfo.rewrite(blob, { prompt: 'only prompt', negative: '', seed: '', software: '', keepParams: false });
    const c2 = JSON.parse((await Gallery.pngText(await out2.arrayBuffer())).Comment);
    return { info: await Gallery.readInfo(out), soft: t.Software, title: t.Title, c, c2, old: JSON.stringify(t).includes('秘密'), b64: btoa(String.fromCharCode(...new Uint8Array(await out.arrayBuffer()))) };
  });
  ok(rw.info.prompt === '改过的正面' && rw.info.negative === '改过的负面' && rw.info.params.seed === 99, '改写：读出来是改过的正面 / 负面 / 种子');
  ok(rw.soft === 'MyApp' && rw.title === undefined && !rw.old, '改写：软件名换了，空的不写，原来的提示词一点不剩');
  ok(rw.c.steps === 28 && rw.c.sampler === 'k_euler_ancestral' && rw.c.v4_prompt.caption.base_caption === '改过的正面' && rw.c.v4_negative_prompt.caption.base_caption === '改过的负面', '改写：保留其他参数，V4 的 base_caption 也跟着改');
  ok(rw.c2.prompt === 'only prompt' && rw.c2.steps === undefined && rw.c2.seed === undefined, '改写：不保留参数时只写填了的');
  ok(crcOk(Buffer.from(rw.b64, 'base64')), '改写后的 PNG 每块 CRC 都对');

  // ---------- 界面：图库选项里设成「清除」，保存下来的文件没有信息 ----------
  await page.click('#g-opts');
  ok(!!await page.$('.sheet input[name="g-exinfo"][value="keep"]:checked'), '图库选项里有「保存 / 分享时的图片信息」，默认保留');
  await page.check('.sheet input[name="g-exinfo"][value="strip"]');
  await page.waitForFunction(async () => (await Gallery.getPrefs()).exportInfo === 'strip');
  await page.click('.sheet [data-close]');
  await page.waitForFunction(() => !document.querySelector('#layers').children.length);
  const longPress = async (sel) => { const b = await (await page.$(sel)).boundingBox(); await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); };
  const dlBuf = async (d) => fs.readFileSync(await d.path());
  let [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await longPress('.thumb:nth-child(1)'); await page.click('.sheet .menu-item[data-k="save"]'); })()]);
  let buf = await dlBuf(dl);
  ok(!buf.toString('latin1').includes('Comment') && buf.subarray(1, 4).toString() === 'PNG', '设成清除后，长按保存的 PNG 里没有出图信息');
  ok(!!(await page.evaluate(async () => Gallery.readInfo(await Gallery.getBlob((await Gallery.list()).find((x) => x.desc === '今天').id)))), 'App 里的原图不受影响，信息还在');

  // 设成每次问 → 点保存弹出选择
  await page.evaluate(() => Gallery.setPrefs({ exportInfo: 'ask' }));
  await page.click('.thumb:nth-child(1)');
  await page.waitForSelector('.acts [data-a="share"]');
  await page.click('.acts [data-a="save"]');
  await page.waitForSelector('.sheet input[name="x-mode"]');
  ok((await page.$$('.sheet input[name="x-mode"]')).length === 3, '每次问：点保存弹出 保留 / 清除 / 改写');
  ok(await page.$eval('.sheet .x-form', (x) => x.hidden), '改写的表单默认收着');
  await page.check('.sheet input[name="x-mode"][value="rewrite"]');
  ok(!await page.$eval('.sheet .x-form', (x) => x.hidden) && (await page.inputValue('.sheet [data-f="prompt"]')).includes('秘密的提示词'), '选改写：表单展开，填好了图里原来的提示词');
  ok(await page.inputValue('.sheet [data-f="seed"]') === '424242', '种子也填好了');
  await page.fill('.sheet [data-f="prompt"]', '分享用的正面');
  await page.click('.sheet [data-clear="negative"]');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet [data-go="save"]')]);
  buf = await dlBuf(dl);
  const rInfo = await page.evaluate(async (b64) => Gallery.readInfo(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])), buf.toString('base64'));
  ok(rInfo && rInfo.prompt === '分享用的正面' && rInfo.negative === '' && rInfo.params.seed === 424242, '改写后保存：文件里是改过的提示词，负面清空了，种子保留');
  await page.waitForFunction(() => !document.querySelector('.sheet input[name="x-mode"]'));
  ok((await page.evaluate(() => Gallery.getPrefs())).exportInfo === 'ask', '改写不会改掉「每次问」的设置');

  // ---------- 分享：假的 App 外壳 ----------
  await page.evaluate(() => {
    window.__shared = { files: {}, sent: null };
    window.AndroidBridge = {
      shareBegin: (n) => { const t = 's' + Object.keys(__shared.files).length; __shared.files[t] = { name: n, b64: '' }; return t; },
      shareChunk: (t, b) => { __shared.files[t].b64 += '|' + b; return 'OK'; },
      shareEnd: () => 'OK',
      shareSend: (tk, mime, title) => { __shared.sent = { tk: JSON.parse(tk), mime, title }; return 'OK'; },
    };
  });
  await page.click('.acts [data-a="share"]');
  await page.waitForSelector('.sheet input[name="x-mode"]');
  ok(await page.$eval('.sheet [data-go="share"]', (b) => b.classList.contains('primary')), '从「分享」点进来，分享按钮是主按钮');
  await page.check('.sheet input[name="x-mode"][value="strip"]');
  await page.check('.sheet [data-remember]');
  await page.click('.sheet [data-go="share"]');
  await page.waitForFunction(() => window.__shared.sent);
  const sh = await page.evaluate(async () => {
    const f = Object.values(__shared.files)[0];
    const bytes = f.b64.split('|').filter(Boolean).map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    const blob = new Blob(bytes, { type: 'image/png' });
    return { name: f.name, sent: __shared.sent, info: await Gallery.readInfo(blob), pref: (await Gallery.getPrefs()).exportInfo };
  });
  ok(sh.sent.tk.length === 1 && sh.sent.mime === 'image/png' && /\.png$/.test(sh.name), '分享：交给外壳一张 PNG，带文件名 ' + sh.name);
  ok(!sh.info, '分享前清除了信息');
  ok(sh.pref === 'strip', '勾了「以后都这样」：设置变成清除');
  await page.evaluate(() => window.__appBack());
  await page.waitForTimeout(200);

  // 多选分享两张
  await page.evaluate(() => { __shared.files = {}; __shared.sent = null; });
  await page.click('#g-sel');
  await page.click('.thumb:nth-child(1)'); await page.click('.thumb:nth-child(2)');
  await page.click('#g-sel-share');
  await page.waitForFunction(() => window.__shared.sent);
  ok((await page.evaluate(() => __shared.sent.tk.length)) === 2 && (await page.evaluate(() => __shared.sent.title)).includes('2'), '多选两张一起分享');
  // 多选菜单里的「导出」只有保留 / 清除
  await page.click('#g-sel-more');
  await page.click('.sheet .menu-item[data-k="export"]');
  await page.waitForSelector('.sheet input[name="x-mode"]');
  ok((await page.$$('.sheet input[name="x-mode"]')).length === 2, '多张导出：只有保留 / 清除（改写只能单张）');
  await page.screenshot({ path: path.join(require('os').tmpdir(), '导出选择.png') });
  await page.click('.sheet [data-close]');
  await page.evaluate(() => { delete window.AndroidBridge; });

  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  await browser.close(); srv.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
