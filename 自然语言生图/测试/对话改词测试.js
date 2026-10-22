// 对话改词测试：多轮对话改提示词、每轮列出增删的标签、挑着接受、没接受的告诉下一轮
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/对话改词测试.js
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

  // 假 AI：重写模式下按这轮要求回不同的提示词
  const asked = [];
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData());
    const user = body.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    asked.push(user);
    const cur = (user.match(/^tag: (.*)$/m) || [])[1] || '';
    const hint = (user.match(/【用户对这次重写的额外要求（优先级最高）】\n(.*)/) || [])[1] || '';
    let tag = cur, negative = (user.match(/^negative: (.*)$/m) || [])[1] || '', nl = (user.match(/^nl: (.*)$/m) || [])[1] || 'Old.';
    if (/雨天/.test(hint)) { tag = cur.replace('sunny', 'rain').replace('smile', '1.2::smile::') + ', umbrella, wet'; negative = 'sun'; nl = 'Rainy street.'; }
    else if (/一样/.test(hint)) tag = cur;
    else if (/去掉/.test(hint)) tag = cur.split(', ').filter((x) => x !== 'glasses').join(', ');
    const reply = JSON.stringify({ tag, nl, negative, size: 'portrait', changes: [] });
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\ndata: [DONE]\n\n';
    await r.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse });
  });

  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(url);
  await page.waitForSelector('#c-chat');
  await page.evaluate(() => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm' });
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full' });
    UI.settings.autoDraw = false;
    UI.saveSettings(); CreatePage.refresh();
  });

  // 纯函数
  const unit = await page.evaluate(() => {
    const d = PromptChat.diff('1girl, smile, sunny, glasses', '1girl, 1.2::smile::, rain, glasses, umbrella');
    const pk = { add: [true, false], del: [true], mod: [false] };
    return { d, applied: PromptChat.applyPicks('1girl, smile, sunny, glasses', '1girl, 1.2::smile::, rain, glasses, umbrella', d, pk), note: Writer.rewriteNote({ tag: 'a', hint: 'b', history: ['要求：x。用户没接受：加 y'] }) };
  });
  ok(JSON.stringify(unit.d.add) === '["rain","umbrella"]' && JSON.stringify(unit.d.del) === '["sunny"]' && unit.d.mod.length === 1 && unit.d.mod[0][1] === '1.2::smile::', '比较：加上、去掉、改权重分开');
  ok(unit.applied === '1girl, smile, rain, glasses', '挑着接受：只加 rain、只删 sunny，权重和 umbrella 不要（' + unit.applied + '）');
  ok(/前几轮的对话/.test(unit.note) && /用户没接受：加 y/.test(unit.note), '重写说明带前几轮对话');

  await page.fill('#c-desc', '街上的女孩');
  await page.dispatchEvent('#c-desc', 'input');
  await page.fill('#c-tag', '1girl, smile, sunny, glasses');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-chat');
  await page.waitForSelector('.pc-foot');
  ok(await page.isVisible('.pc-empty'), '打开时有说明');

  // 第一轮：雨天
  await page.fill('[data-a="input"]', '换成雨天');
  await page.click('[data-a="send"]');
  await page.waitForSelector('[data-a="ok"]');
  const last = asked[asked.length - 1];
  ok(/这次是重写提示词/.test(last) && /换成雨天/.test(last) && /街上的女孩/.test(last), '发给 AI：重写模式 + 这轮要求 + 描述');
  const chips = await page.$$eval('.pc-chip', (a) => a.map((b) => b.className.split(' ')[1] + ':' + b.textContent));
  ok(chips.some((c) => /^add:\+rain/.test(c)) && chips.some((c) => /^add:\+umbrella/.test(c)) && chips.some((c) => /^del:−sunny/.test(c)) && chips.some((c) => /^mod:≈smile → 1.2::smile::/.test(c)), '列出加上、去掉、改权重的标签');
  ok(chips.some((c) => /^add:\+sun/.test(c)) && await page.isVisible('[data-a="nl"]'), '负面词改动和英文描述也列出来');
  // 不要 umbrella 和权重
  await page.click('.pc-chip.add:has-text("umbrella")');
  await page.click('.pc-chip.mod');
  ok((await page.$$('.pc-chip.off')).length === 2 && /接受选中（5）/.test(await page.textContent('[data-a="ok"]')), '点标签切换不要，按钮上数字跟着变');
  await page.click('[data-a="ok"]');
  const d1 = await page.evaluate(() => ({ tag: CreatePage.draft.tag, neg: CreatePage.draft.negative, nl: CreatePage.draft.nl }));
  ok(d1.tag === '1girl, smile, rain, glasses, wet' && d1.neg === 'sun' && d1.nl === 'Rainy street.', '接受选中写回创作页（' + d1.tag + '）');
  ok(/已接受 5 项/.test(await page.textContent('.pc-state')) && (await page.$$('.pc-chip:disabled')).length > 0, '接受后锁住并显示接受了几项');

  // 第二轮：去掉眼镜，前情里有没接受的 umbrella
  await page.fill('[data-a="input"]', '去掉眼镜');
  await page.click('[data-a="send"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-a="ok"]').length === 1);
  const l2 = asked[asked.length - 1];
  ok(/前几轮的对话/.test(l2) && /换成雨天/.test(l2) && /用户没接受：加 umbrella/.test(l2) && /tag: 1girl, smile, rain, glasses, wet/.test(l2), '第二轮带上前一轮要求和没接受的改动，锚点是接受后的提示词');
  await page.click('[data-a="skip"]');
  ok(await page.evaluate(() => CreatePage.draft.tag) === '1girl, smile, rain, glasses, wet' && /没要这版/.test(await page.textContent('.pc-ai[data-t="1"] .pc-state')), '都不要：创作页不变');

  // 没改动
  await page.fill('[data-a="input"]', '保持一样');
  await page.click('[data-a="send"]');
  await page.waitForFunction(() => /没有改动/.test(document.querySelector('.pc-body').textContent));
  ok(true, 'AI 没改时说明没有改动');

  // 重开 App 对话还在；清空
  await page.evaluate(() => UI.closeLayer());
  await page.reload();
  await page.waitForSelector('#c-chat');
  await page.click('#c-chat');
  await page.waitForSelector('.pc-ask');
  ok((await page.$$('.pc-ask')).length === 3, '重开 App 对话记录还在');
  await page.click('[data-a="clear"]');
  await page.click('.dialog [data-yes]');
  ok(await page.isVisible('.pc-empty'), '清空对话');
  ok(await page.evaluate(() => !!Help && document.body.textContent !== null), '说明已注册');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
