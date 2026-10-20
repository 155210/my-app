// AI 进阶 + 批量测试：一段描述拆成多张、AI 重写（附要求）、创作页英文描述开关、批量页
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/批量测试.js
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
  const asked = []; let aiDelay = 0, badPlanOnce = false;
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData());
    const user = body.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    asked.push(user);
    let reply;
    if (/这次要把上面的描述拆成多张图/.test(user)) {
      if (badPlanOnce) { badPlanOnce = false; reply = '{"images":[]}'; }
      else {
        const n = /一共 (\d) 张/.test(user) ? Number(RegExp.$1) : 2;
        reply = '<thinking>拆</thinking>' + JSON.stringify({ images: Array.from({ length: n }, (_, i) => ({ desc: '第' + (i + 1) + '刻', tag: '1girl, scene ' + (i + 1), nl: 'Scene ' + (i + 1) + '.', negative: '', size: i ? 'landscape' : 'portrait' })), changes: [{ name: '小雪', field: 'new', fields: { sex: '1girl', hair: 'long white hair', eyes: 'red eyes' } }] });
      }
    } else if (/这次是重写提示词/.test(user)) {
      reply = JSON.stringify({ tag: '1girl, blush, shy, rewritten', nl: 'Rewritten.', negative: '', size: 'portrait', changes: [{ name: '阿重', field: 'new', fields: { sex: '1boy', hair: 'short black hair', eyes: 'blue eyes' } }] });
    } else {
      const m = user.match(/批量(\d+)/);
      if (/坏的/.test(user)) reply = '不给 JSON';
      else reply = JSON.stringify({ tag: m ? '1girl, batch ' + m[1] : '1girl, single', nl: 'One.', negative: '', size: 'portrait' });
    }
    if (aiDelay) await sleep(aiDelay);
    const sse = [...reply].reduce((a, ch, i) => (i % 10 === 0 ? a.push(ch) : a[a.length - 1] += ch, a), []).map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n').join('') + 'data: [DONE]\n\n';
    try { await r.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse }); } catch (e) { /* 停止了 */ }
  });
  const naiPrompts = []; let naiDelay = 100;
  await page.route('https://nai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.method() === 'GET') return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: '{}' });
    const b = JSON.parse(req.postData());
    naiPrompts.push(b);
    await sleep(naiDelay);
    try { await r.fulfill({ headers: { ...CORS, 'content-type': 'application/x-zip-compressed' }, body: zip('image_0.png', png(64, 96), 8) }); } catch (e) { /* 已取消 */ }
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
  await page.waitForSelector('#c-plan');
  const idle = () => page.waitForFunction(() => { const s = Queue.state(); return s.running + s.waiting === 0; }, null, { timeout: 30000 });
  const count = () => page.evaluate(async () => (await Gallery.list()).length);

  // 纯函数
  const unit = await page.evaluate(() => {
    const r = {};
    r.p = Writer.parsePlan('<think>x</think>{"images":[{"desc":"a","tag":"cat"},{"tag":""},{"tag":["dog","run"],"size":"横"}],"changes":[]}');
    try { Writer.parsePlan('{"images":[{"tag":"a"}]}', 3); r.short = 'no-throw'; } catch (e) { r.short = e.message; }
    r.note = Writer.rewriteNote({ tag: 'old tag', hint: '更害羞' });
    r.plan3 = Writer.planNote(3, true);
    return r;
  });
  ok(unit.p.images.length === 2 && unit.p.images[0].desc === 'a' && unit.p.images[1].tag === 'dog, run' && unit.p.images[1].size === 'landscape', '解析多张：跳过没 tag 的、数组 tag、中文画幅');
  ok(/只给了 1 张/.test(unit.short), '张数不够时报错（交给自动重试）');
  ok(/old tag/.test(unit.note) && /更害羞/.test(unit.note) && /优先级最高/.test(unit.note), '重写说明带当前提示词和附加要求');
  ok(/一共 3 张/.test(unit.plan3) && /"images"/.test(unit.plan3), '拆多张说明写明张数和格式');

  // 创作页英文描述开关：和设置同步，V4 时灰掉
  ok(await page.isChecked('#c-nlsw') && !(await page.isHidden('#c-nl-wrap')), '英文描述开关默认开着，英文描述格显示');
  await page.click('#c-nlsw + span');
  ok(await page.evaluate(() => UI.settings.nai.naturalLanguage === false) && await page.isHidden('#c-nl-wrap'), '创作页关掉英文描述：设置跟着关，英文描述格藏起来');
  await page.fill('#c-desc', '黄昏教室');
  await page.dispatchEvent('#c-desc', 'input');
  await page.click('#c-write');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === '1girl, single');
  ok(/nl 字段写空字符串/.test(asked[asked.length - 1]), '关了英文描述时告诉 AI 不写 nl');
  await page.click('#c-nlsw + span');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-full'; CreatePage.refresh(); });
  ok(await page.isDisabled('#c-nlsw') && /不支持/.test(await page.textContent('#c-nlsw-text')), 'V4 时英文描述开关灰掉');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-5-full'; CreatePage.refresh(); });

  // AI 重写：带要求，结果填回，changes 丢掉
  await page.fill('#c-tag', '1girl, smile, classroom');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-rewrite');
  await page.fill('.dialog [data-hint]', '表情再害羞一点');
  await page.click('.dialog [data-go]');
  await page.waitForFunction(() => document.querySelector('#c-tag').value.includes('rewritten'));
  const last = asked[asked.length - 1];
  ok(/这次是重写提示词/.test(last) && /1girl, smile, classroom/.test(last) && /表情再害羞一点/.test(last) && /黄昏教室/.test(last), 'AI 重写：发了描述、当前提示词和附加要求');
  ok(await page.evaluate(() => !CharLib.find('阿重')), '重写时 AI 回的 changes 不进角色库');
  await page.click('#c-rewrite');
  ok(await page.inputValue('.dialog [data-hint]') === '表情再害羞一点', '重写要求记住上次写的');
  await page.click('.dialog [data-close]');

  // 拆成多张：选 3 张
  await page.selectOption('#c-plan', '3');
  ok(/拆成多张/.test(await page.textContent('#c-write')), '选了拆多张，按钮变「AI 拆成多张」');
  await page.fill('#c-desc', '小雪早上起床、上学、放学');
  await page.dispatchEvent('#c-desc', 'input');
  await page.click('#c-write');
  await page.waitForSelector('#c-plan-card');
  ok((await page.$$('#c-plan-card .plan-item')).length === 3, '拆成 3 张，卡片列出 3 张');
  ok(/一共 3 张/.test(asked[asked.length - 1]), '请求里写了张数');
  ok(await page.evaluate(() => !!CharLib.find('小雪')), '拆多张时 changes 照常建档（只建一次）');
  await page.screenshot({ path: OUT + '/批量-拆多张.png', fullPage: true });
  // 填到上面
  await page.click('#c-plan-card .plan-item[data-i="1"] [data-fill]');
  ok(await page.inputValue('#c-tag') === '1girl, scene 2' && await page.evaluate(() => CreatePage.draft.size) === 'landscape', '「填到上面」把第 2 张填进提示词框');
  // 全部出图
  naiPrompts.length = 0;
  const g0 = await count();
  await page.click('#c-plan-card [data-all]');
  await idle();
  ok(await count() === g0 + 3, '「全部出图」出了 3 张');
  ok(naiPrompts.map((b) => /scene (\d)/.exec(b.input)[1]).join(',') === '1,2,3', '按顺序出（' + naiPrompts.map((b) => /scene (\d)/.exec(b.input)[1]).join(',') + '）');
  ok(/已出 1 次/.test(await page.textContent('#c-plan-card')), '每张标出已出几次');
  // 重开还在
  await page.reload();
  await page.waitForSelector('#c-plan-card');
  ok((await page.$$('#c-plan-card .plan-item')).length === 3 && await page.inputValue('#c-plan') === '3', '重开 App 拆好的还在、张数选项还在');
  await page.waitForFunction(() => window.CharLib && CharLib.find('小雪'), null, { timeout: 3000 }).catch(() => {});
  ok(await page.evaluate(() => !!CharLib.find('小雪') && Array.isArray(Characters.get())), '重开后角色库还在，多角色格子不再和角色库抢同一个存储键');
  // AI 定张数 + 第一次格式不对自动重试
  await page.selectOption('#c-plan', 'auto');
  badPlanOnce = true;
  const n0 = asked.length;
  await page.click('#c-write');
  await page.waitForFunction(() => document.querySelectorAll('#c-plan-card .plan-item').length === 2);
  ok(asked.length === n0 + 2 && /2～6 张/.test(asked[n0]), 'AI 定张数：回空的自动重试一次，拿到 2 张');
  // 收起
  await page.click('#c-plan-card [data-close-plan]');
  ok(!(await page.$('#c-plan-card')), '收起拆多张卡片');
  await page.selectOption('#c-plan', '');

  // 写完自动出图 + 拆多张：直接全部排队
  await page.evaluate(() => { UI.settings.autoDraw = true; });
  await page.selectOption('#c-plan', '2');
  const g1 = await count();
  await page.click('#c-write');
  await page.waitForSelector('#c-plan-card');
  await idle();
  ok(await count() === g1 + 2, '开了写完自动出图：拆完 2 张自动都出');
  await page.selectOption('#c-plan', '');
  await page.evaluate(() => { UI.settings.autoDraw = false; });

  // ---------------- 批量页 ----------------
  await page.click('#tabbar [data-tab="batch"]');
  await page.waitForSelector('#b-input');
  ok(await page.textContent('#title') === '批量', '底部有「批量」标签');
  ok(await page.isDisabled('#b-go'), '列表空时「开始」不能点');
  await page.fill('#b-input', '批量1 早上\n\n批量2 中午\n坏的一条\n批量3 晚上');
  await page.click('#b-add');
  ok((await page.$$('.b-item')).length === 4, '一行一条加进列表（空行跳过）');
  await page.selectOption('#b-count', '2');
  naiPrompts.length = 0; aiDelay = 300;
  const g2 = await count();
  await page.evaluate(() => { window.__lives = []; new MutationObserver(() => { const el = document.querySelector('.b-item [data-live]'); if (el) window.__lives.push(el.textContent); }).observe(document.querySelector('#b-list'), { subtree: true, childList: true, characterData: true }); });
  await page.click('#b-go');
  await page.waitForSelector('.b-item [data-live]');
  ok(/写提示词中/.test(await page.textContent('.b-item')), '第一条显示「写提示词中」');
  await page.waitForFunction(() => window.__lives.some((t) => /1girl/.test(t)), null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => window.__lives.some((t) => /"tag":"1girl/.test(t))), '批量页实时显示 AI 输出');
  await page.waitForFunction(() => /开始/.test(document.querySelector('#b-go').textContent), null, { timeout: 20000 });
  await idle();
  await page.waitForFunction(() => !BatchPage.items.some((x) => x.state === 'drawing'));
  const st = await page.evaluate(() => BatchPage.items.map((x) => x.state + ':' + x.images.length));
  ok(st.join(',') === 'done:2,done:2,failed:0,done:2', '挨个写、写完就出，每条 2 张；坏的那条失败、后面接着写（' + st.join(',') + '）');
  ok(await count() === g2 + 6, '批量出了 6 张进图库');
  ok(naiPrompts.every((b) => !b.parameters.v4_prompt.caption.char_captions.length), '批量出图不带创作页的多角色');
  ok(/重试失败的/.test(await page.textContent('#b-retry')) && !(await page.isHidden('#b-retry')), '有失败的时显示「重试失败的」');
  ok((await page.$$('.b-item .b-thumbs img')).length === 6, '每条下面显示缩略图');
  await page.screenshot({ path: OUT + '/批量-列表.png', fullPage: true });
  // 点缩略图打开大图
  await page.click('.b-item .b-thumbs img');
  await page.waitForSelector('.viewer');
  await page.evaluate(() => UI.closeLayer());
  // 填到创作页
  await page.click('.b-item[data-id] [data-a="fill"]');
  ok(await page.textContent('#title') === '创作' && await page.inputValue('#c-tag') === '1girl, batch 1', '「填到创作页」跳回创作页并填好');
  await page.click('#tabbar [data-tab="batch"]');

  // 停止：再加两条、关掉写完就出图，写第一条时停
  await page.click('#b-auto + span');
  aiDelay = 1500;
  await page.fill('#b-input', '批量4\n批量5');
  await page.click('#b-add');
  await page.click('#b-go');
  await sleep(300);
  await page.click('#b-go');
  await page.waitForFunction(() => /开始/.test(document.querySelector('#b-go').textContent));
  const st2 = await page.evaluate(() => BatchPage.items.slice(4).map((x) => x.state));
  ok(st2.join(',') === 'wait,wait', '停止后正在写的退回「等着写」（' + st2.join(',') + '）');
  aiDelay = 0;
  await page.click('#b-go');
  await page.waitForFunction(() => BatchPage.items.slice(4).every((x) => x.state === 'written'), null, { timeout: 10000 });
  ok(!(await page.isHidden('#b-drawall')), '关了写完就出图：写好后显示「写好的全部出图」');
  const g3 = await count();
  await page.click('#b-drawall');
  await idle();
  await page.waitForFunction(() => BatchPage.items.slice(4).every((x) => x.state === 'done'));
  ok(await count() === g3 + 4, '「写好的全部出图」每条 2 张');

  // 重开：列表和选项都在
  await page.reload();
  await page.waitForSelector('#c-write');
  await page.click('#tabbar [data-tab="batch"]');
  await page.waitForSelector('.b-item');
  ok((await page.$$('.b-item')).length === 6 && await page.inputValue('#b-count') === '2' && !(await page.isChecked('#b-auto')), '重开 App 批量列表和选项还在');
  // 删除一条、清空
  await page.click('.b-item:nth-child(3) [data-a="del"]');
  ok((await page.$$('.b-item')).length === 5, '删除一条');
  await page.click('#b-clear');
  await page.click('.dialog [data-yes]');
  ok((await page.$$('.b-item')).length === 0, '清空列表');
  // 返回键回创作页
  await page.evaluate(() => window.__appBack());
  ok(await page.textContent('#title') === '创作', '批量页按返回键回创作页');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
