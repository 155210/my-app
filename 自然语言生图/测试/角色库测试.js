// 角色库无头浏览器测试：新建/编辑角色、名字换外貌、外貌发给 AI、AI 自动建档和永久变化、全局角色不被改、撤销、出图前替换、重开还在
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/角色库测试.js
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
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  let lastUser = '', reply = '';
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    lastUser = JSON.parse(req.postData()).messages.slice(-1)[0].content;
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
  });

  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(url);
  await page.waitForSelector('#c-tag');
  await page.evaluate(() => CharLib.ready);

  // 创作页入口 → 新建角色
  await page.click('#c-char-lib');
  await page.waitForSelector('.cl-list .empty');
  ok(true, '创作页有角色库入口，空的时候有说明');
  await page.click('[data-new]');
  await page.fill('[data-f="name"]', '小雪');
  await page.fill('[data-f="sex"]', '1girl');
  await page.fill('[data-f="hair"]', 'long black hair');
  await page.fill('[data-f="eyes"]', 'blue eyes');
  await page.fill('[data-f="outfit"]', 'white dress');
  ok((await page.$eval('.cl-preview', (e) => e.textContent)) === '1girl, long black hair, blue eyes, white dress', '编辑时实时显示拼好的外貌标签');
  await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, '角色库-编辑.png'), animations: 'disabled' });
  await page.click('[data-save]');
  await page.waitForSelector('.cl-card');

  // 全局角色
  await page.click('[data-new]');
  await page.fill('[data-f="name"]', '阿明');
  await page.fill('[data-f="alias"]', '我, 主角');
  await page.click('label.check:has([data-f="global"])');
  await page.fill('[data-f="sex"]', '1boy');
  await page.fill('[data-f="hair"]', 'short brown hair');
  await page.fill('[data-f="eyes"]', 'brown eyes');
  await page.click('[data-save]');
  await page.waitForFunction(() => document.querySelectorAll('.cl-card').length === 2);
  ok(await page.$eval('.cl-list', (e) => e.textContent.includes('全局 · AI 不改')), '全局角色有标记、排在前面');
  await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, '角色库.png'), animations: 'disabled' });

  // 重名不让存
  await page.click('[data-new]');
  await page.fill('[data-f="name"]', '小雪');
  await page.click('[data-save]');
  ok(await page.$('[data-f="name"]') !== null && await page.evaluate(() => [...document.querySelectorAll('.ask-toast')].some((t) => t.textContent.includes('已经有叫'))), '重名不让存');
  await page.evaluate(() => { window.__appBack(); window.__appBack(); });

  const unit = await page.evaluate(() => ({
    e1: CharLib.expand('小雪, smile, 1girl, looking at viewer'),
    e2: CharLib.expand('主角, 小雪, sitting'),
    e3: CharLib.expand('1girl, smile'),
    e4: CharLib.expand('小雪, 莉莉替身, smile'),
    m: CharLib.mentioned('我和小雪在海边').map((c) => c.name).sort().join(),
  }));
  ok(unit.e1 === 'long black hair, blue eyes, white dress, smile, 1girl, looking at viewer', '提示词里的名字换成外貌，已有人数标签就不再加：' + unit.e1);
  ok(unit.e2 === '1girl, 1boy, short brown hair, brown eyes, long black hair, blue eyes, white dress, sitting', '别名也换：' + unit.e2);
  ok(unit.e3 === '1girl, smile', '没有角色名的不动');
  ok(unit.e4 === '1girl, long black hair, blue eyes, white dress, 莉莉替身, smile', '没人数标签时按角色补上 1girl：' + unit.e4);
  ok(unit.m === '小雪,阿明', '描述里认出角色（含别名「我」）：' + unit.m);

  // 写提示词：外貌发给 AI；AI 建新角色、改小雪发型、想改全局角色被拦
  await page.evaluate(() => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm', stream: false });
    UI.settings.autoDraw = false;
    UI.saveSettings();
    const d = document.querySelector('#c-desc');
    d.value = '小雪剪了短发染成红色，和我还有新来的同学莉莉在教室里聊天';
    d.dispatchEvent(new Event('input'));
  });
  reply = JSON.stringify({
    tag: '3people, 小雪, smile, 莉莉, classroom', nl: '', negative: '', size: 'landscape',
    changes: [
      { name: '小雪', field: 'hair', to: 'short red hair', reason: '剪短染红' },
      { name: '莉莉', field: 'new', fields: { sex: '1girl', hair: 'twintails, blonde hair', eyes: 'green eyes' }, reason: '新同学' },
      { name: '阿明', field: 'hair', to: 'long blue hair', reason: '乱改' },
      { name: '路人', field: 'new', fields: {} },
    ],
  });
  await page.click('#c-write');
  await page.waitForFunction(() => document.querySelector('#c-tag').value.includes('classroom'));
  ok(lastUser.includes('【角色固定外貌库】') && lastUser.includes('小雪：1girl, long black hair, blue eyes, white dress') && lastUser.includes('阿明（也叫 我, 主角）：1boy'), '描述里出现的角色外貌发给了 AI');
  ok(lastUser.includes('阿明（全局）') && lastUser.includes('【角色建档】') && lastUser.includes('"changes"'), '告诉 AI 哪些是全局角色、怎么写 changes');
  const st = await page.evaluate(() => ({
    xue: CharLib.find('小雪').fields.hair, ming: CharLib.find('阿明').fields.hair,
    lili: CharLib.find('莉莉') && CharLib.tagsOf(CharLib.find('莉莉')), liliSrc: CharLib.find('莉莉') && CharLib.find('莉莉').source,
    lu: !!CharLib.find('路人'), tag: document.querySelector('#c-tag').value,
  }));
  ok(st.xue === 'short red hair', '永久变化自动更新：小雪 → short red hair');
  ok(st.ming === 'short brown hair', '全局角色 AI 改不动');
  ok(st.lili === '1girl, twintails, blonde hair, green eyes' && st.liliSrc === 'ai', 'AI 自动给新角色建档');
  ok(!st.lu, '没外貌的建档请求不收');
  const two = await page.evaluate(() => CharLib.expand('小雪, 莉莉, 阿明, smile'));
  ok(two === '2girls, 1boy, short red hair, blue eyes, white dress, twintails, blonde hair, green eyes, short brown hair, brown eyes, smile', '两个女生一个男生自动算成 2girls, 1boy：' + two);
  ok(st.tag === '3people, short red hair, blue eyes, white dress, smile, twintails, blonde hair, green eyes, classroom', 'AI 写的提示词里名字换成了外貌：' + st.tag);
  ok(await page.evaluate(() => [...document.querySelectorAll('.ask-toast')].some((t) => t.textContent.includes('角色库更新了') && t.textContent.includes('新建「莉莉」'))), '提示角色库改了什么');

  // 关掉自动建档 / 自动更新
  await page.evaluate(() => { UI.settings.chars.autoCreate = false; UI.settings.chars.autoUpdate = false; });
  reply = JSON.stringify({ tag: '1girl, classroom', nl: '', negative: '', size: 'portrait', changes: [{ name: '小美', field: 'new', fields: { hair: 'pink hair' } }, { name: '小雪', field: 'eyes', to: 'red eyes' }] });
  await page.click('#c-write');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === '1girl, classroom');
  const off = await page.evaluate(() => ({ mei: !!CharLib.find('小美'), eyes: CharLib.find('小雪').fields.eyes }));
  ok(!off.mei && off.eyes === 'blue eyes' && !lastUser.includes('【角色建档】'), '关掉开关后不建档、不更新、不要求 changes');
  await page.evaluate(() => { UI.settings.chars.autoCreate = true; UI.settings.chars.autoUpdate = true; });

  // 出图前：手写提示词里的名字也换
  const body = await page.evaluate(() => {
    const b = Nai.buildBody(UI.settings.nai, { tag: '阿明, smile', nl: '', negative: '', size: 'portrait', seed: 1 });
    return { pos: b.meta.positive, cap: b.body.parameters.v4_prompt.caption.base_caption };
  });
  ok(body.pos.includes('1boy, short brown hair, brown eyes, smile') && !body.pos.includes('阿明'), '出图时手写的角色名换成外貌');
  ok(body.cap === body.pos, 'v4_prompt 里也是换过的');
  const cc = await page.evaluate(() => CharLib.expandParams({
    v4_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: '小雪, smile', centers: [] }] } }, characterPrompts: [{ prompt: '小雪, smile' }],
  }));
  ok(cc.v4_prompt.caption.char_captions[0].char_caption.startsWith('1girl, short red hair') && cc.characterPrompts[0].prompt.startsWith('1girl, short red hair'), '多角色的角色提示词里名字也换');

  // 撤销 AI 的改动
  await page.click('#c-char-lib');
  await page.click('.cl-card:has-text("小雪")');
  await page.waitForSelector('[data-undo]');
  ok((await page.$eval('[data-f="hair"]', (e) => e.value)) === 'short red hair', '编辑页显示改过的头发');
  await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, '角色库-改动记录.png'), animations: 'disabled' });
  await page.click('[data-undo]');
  ok((await page.$eval('[data-f="hair"]', (e) => e.value)) === 'long black hair' && await page.evaluate(() => CharLib.find('小雪').fields.hair === 'long black hair'), '撤销 AI 改的头发');
  await page.evaluate(() => { window.__appBack(); window.__appBack(); });

  // 设置页
  await page.click('#btn-settings');
  await page.click('.tabs button[data-tab="chars"]');
  ok(await page.$eval('[data-k="chars.inject"]', (e) => e.checked) && await page.$eval('[data-k="chars.autoCreate"]', (e) => e.checked) && await page.$eval('[data-k="chars.autoUpdate"]', (e) => e.checked), '设置页有角色库开关，默认都开');
  await page.click('[data-act="chars-open"]');
  await page.waitForSelector('.cl-card');
  ok(true, '设置页能打开角色库');
  await page.evaluate(() => { window.__appBack(); window.__appBack(); });

  // 删除
  await page.click('#c-char-lib');
  await page.click('.cl-card:has-text("莉莉")');
  await page.click('[data-del]');
  await page.click('[data-yes]');
  await page.waitForFunction(() => document.querySelectorAll('.cl-card').length === 2);
  ok(true, '删除角色');
  await page.evaluate(() => window.__appBack());

  // 导出设置里带角色库
  const bk = await page.evaluate(async () => { const b = await Backup.build(); return JSON.stringify(b); });
  ok(bk.includes('short brown hair'), '导出设置里带着角色库');

  // 重开还在
  await page.waitForTimeout(400);
  await page.goto(url);
  await page.waitForSelector('#c-tag');
  const after = await page.evaluate(async () => { await CharLib.ready; return CharLib.list.map((c) => c.name + (c.global ? '*' : '')).join(); });
  ok(after === '小雪,阿明*', '重开 App 角色库还在：' + after);

  await browser.close();
  srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
