// 自定义提示词（破限词 / 生图规范 / 思维链）、重型提示词（酒馆预设，格式不对时重试用）的无头浏览器测试
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/自定义提示词测试.js
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

// 一份酒馆预设：有聊天记录标记、角色卡标记、深度条目、只在 continue 触发的条目、没在顺序里的条目
const PRESET = {
  squash_system_messages: false,
  prompts: [
    { identifier: 'main', name: '主提示词', role: 'system', content: '你是{{char}}，为{{user}}服务。{{setvar::x::甲}}' },
    { identifier: 'charDescription', name: 'Char Description', marker: true },
    { identifier: 'chatHistory', name: 'Chat History', marker: true },
    { identifier: 'deep', name: '深度条目', role: 'system', content: '深度一的提醒，变量={{getvar::x}}', injection_position: 1, injection_depth: 1, injection_order: 100 },
    { identifier: 'cont', name: '只在继续时', role: 'user', content: '继续', injection_trigger: ['continue'] },
    { identifier: 'tail', name: '结尾', role: 'assistant', content: '好的，我先思考。' },
    { identifier: 'off', name: '关着的', role: 'system', content: '不该出现' },
    { identifier: 'orphan', name: '孤儿条目', role: 'system', content: '没在顺序里' },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: 'main', enabled: true }] },
    { character_id: 100001, order: [
      { identifier: 'main', enabled: true }, { identifier: 'charDescription', enabled: true }, { identifier: 'chatHistory', enabled: true },
      { identifier: 'deep', enabled: true }, { identifier: 'cont', enabled: true }, { identifier: 'off', enabled: false }, { identifier: 'tail', enabled: true },
    ] },
  ],
};

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  const sent = [];
  let replies = [];
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    sent.push(JSON.parse(req.postData()).messages);
    const reply = replies.shift() || '<thinking>1. 人物：一个女孩</thinking>{"tag":"1girl, smile","nl":"A girl smiles.","negative":"","size":"portrait"}';
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
  });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');

  // —— 纯函数 ——
  const unit = await page.evaluate((preset) => {
    const C = CustomPrompts;
    const r = C.parseSTPreset(preset);
    const names = r.entries.map((e) => e.name + (e.enabled ? '' : '(关)'));
    const ctx = { user: '用户', char: 'AI', vars: {}, gvars: {} };
    const msgs = C.assemble(r.entries, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], (t) => C.macros(t, ctx), false);
    const sq = C.assemble(r.entries, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], (t) => t, true);
    return {
      names, extras: r.extras.map((e) => e.name + (e.enabled ? '' : '(关)')), dropped: r.droppedMarkers,
      msgs: msgs.map((m) => m.role[0] + ':' + m.content), sq: sq.length,
      nlOn: C.expandNl('a{{#nl}}B{{/nl}}{{^nl}}C{{/nl}}', true), nlOff: C.expandNl('a{{#nl}}B{{/nl}}{{^nl}}C{{/nl}}', false),
      norm: C.normHeavy({ entries: [{ id: 'x', content: 'c' }, { id: 'x' }] }).entries.map((e) => e.id).join(),
    };
  }, PRESET);
  ok(unit.names.join('|') === '主提示词|自然语言生图提示词（默认那一套）|深度条目|只在继续时(关)|关着的(关)|结尾', '按 prompt_order(100001) 排序、取开关，聊天记录换成占位：' + unit.names.join('|'));
  ok(unit.dropped === 1, '角色卡等标记条目不导入');
  ok(unit.extras.join() === '孤儿条目(关)', '没在顺序里的条目单独收着、关闭');
  ok(unit.msgs.join(' / ') === 's:你是AI，为用户服务。 / s:S / s:深度一的提醒，变量=甲 / u:U / a:好的，我先思考。', '拼装：相对顺序、深度 1 插在倒数第 1 条前、宏展开：' + unit.msgs.join(' / '));
  ok(unit.sq === 3, '合并相邻系统消息（3 条系统并成 1 条）');
  ok(unit.nlOn === 'aB' && unit.nlOff === 'aC', '{{#nl}} / {{^nl}} 条件段');
  ok(unit.norm === 'x,nl-default-prompt', '补全：去重、缺占位补到末尾');

  // —— 默认请求：破限词 → 规范 → 思维链 → 中文描述 ——
  await page.evaluate(() => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm', stream: false });
    UI.settings.autoDraw = false;
    UI.saveSettings();
    const d = document.querySelector('#c-desc');
    d.value = '一个女孩在笑';
    d.dispatchEvent(new Event('input'));
  });
  const write = async () => {
    const n = sent.length;
    await page.click('#c-write');
    await page.waitForFunction(() => document.querySelector('#c-write').textContent === 'AI 写提示词');
    return sent.slice(n);
  };
  let got = await write();
  let m = got[0];
  ok(m.length === 4 && m[0].content.includes('nvwa_standalone_core') && m[1].content.includes('NovelAI') && m[2].content.includes('【输出前思考清单】') && m[3].role === 'user',
    '默认 4 条：破限词、规范、思维链、中文描述');
  ok(m[2].content.includes('英文描述') && !m[2].content.includes('{{'), '思维链按英文描述开关展开条件段');
  ok(await page.$eval('#c-tag', (e) => e.value) === '1girl, smile', '带 <thinking> 的回复也能读出 JSON');

  await page.evaluate(() => { UI.settings.nai.naturalLanguage = false; UI.settings.prompts.useJailbreak = false; });
  m = (await write())[0];
  ok(m.length === 3 && m[0].content.includes('NovelAI') && !m[1].content.includes('英文描述'), '关掉破限词就不发；关掉英文描述时思维链不提 nl');
  await page.evaluate(() => { UI.settings.prompts.useThinking = false; });
  m = (await write())[0];
  ok(m.length === 2, '再关掉思维链，只剩规范和描述（和以前一样）');
  await page.evaluate(() => { Object.assign(UI.settings.prompts, { useJailbreak: true, useThinking: true }); UI.settings.nai.naturalLanguage = true; });

  // —— 设置页：编辑破限词 ——
  await page.click('#btn-settings');
  await page.click('.tabs button[data-tab="spec"]');
  ok((await page.textContent('.tabs')).includes('自定义提示词') && (await page.textContent('.tabs')).includes('重型提示词'), '设置页有「自定义提示词」「重型提示词」两个标签');
  ok(await page.$$eval('.cp-item', (x) => x.map((e) => e.querySelector('.card-title').textContent).join()) === '破限词默认,生图规范默认,思维链默认', '三份都显示「默认」');
  await page.screenshot({ path: path.join(OUT, '自定义提示词.png') });
  await page.click('[data-act="cp-edit"][data-key="jailbreak"]');
  ok((await page.$eval('[data-draft]', (e) => e.value)).includes('nvwa_standalone_core'), '编辑框预填内置破限词');
  await page.fill('[data-draft]', '我的破限词');
  await page.click('[data-ok]');
  ok((await page.textContent('.cp-item')).includes('已自定义'), '改完显示「已自定义」');
  await page.click('[data-act="cp-edit"][data-key="thinking"]');
  ok(await page.$$eval('[data-mac]', (x) => x.length) === 3, '思维链编辑框有 {{#nl}} 等插入按钮');
  await page.click('.dialog [data-close]');
  await page.click('[data-act="cp-preview"]');
  ok(await page.$$eval('.cp-msg', (x) => x.length) === 4 && (await page.textContent('.cp-msg')).includes('我的破限词'), '预览里看到改过的破限词');
  await page.click('.dialog [data-close]');
  await page.fill('[data-k="prompts.retries"]', '2');

  // —— 重型提示词 ——
  await page.click('.tabs button[data-tab="heavy"]');
  ok((await page.textContent('.hv-bar')).includes('未导入预设'), '还没导入时显示「未导入预设」');
  await page.evaluate((p) => CustomPrompts.importText(JSON.stringify(p), '我的预设.json'), PRESET);
  await page.$eval('[data-act="hv-redraw"]', (b) => b.click());
  ok((await page.textContent('.hv-bar')).includes('我的预设') && (await page.textContent('.hv-bar')).includes('已启用 3/5'), '导入后显示预设名和启用数');
  ok(await page.$$eval('.hv-row', (x) => x.length) === 6, '列表 6 行（含📌占位）');
  await page.click('[data-act="hv-extras"]');
  ok((await page.textContent('.hv-list + .card')).includes('孤儿条目'), '展开「没在顺序里的条目」');
  await page.screenshot({ path: path.join(OUT, '重型提示词.png') });

  // 拖动：把「结尾」拖到最上面
  const rows = await page.$$('.hv-row .hv-handle');
  const a = await rows[5].boundingBox(), b = await rows[0].boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const order = await page.evaluate(() => UI.settings.prompts.heavy.entries.map((e) => e.name));
  ok(order[0] === '结尾', '按住 ≡ 拖动能换顺序：' + order.join('|'));
  ok((await page.$$eval('.hv-name', (x) => x.map((e) => e.textContent)))[0] === '结尾', '拖完列表重画');
  // 拖回去
  await page.evaluate(() => { const l = UI.settings.prompts.heavy.entries; l.push(l.shift()); });

  // 编辑条目
  await page.$eval('[data-act="hv-redraw"]', (b) => b.click());
  await page.click('.hv-open[data-act="hv-edit"]');
  await page.fill('[data-f="content"]', '你是{{char}}，重型主提示词。');
  await page.click('[data-ok]');
  ok(await page.evaluate(() => UI.settings.prompts.heavy.entries[0].content) === '你是{{char}}，重型主提示词。', '改条目内容');
  // 开关
  await page.click('.hv-row:nth-child(5) input[type=checkbox]');
  ok(await page.evaluate(() => UI.settings.prompts.heavy.entries[4].enabled) === true, '行首勾选框开关条目');
  await page.click('.hv-row:nth-child(5) input[type=checkbox]');
  await page.click('[data-act="hv-preview"]');
  ok((await page.textContent('.dialog')).includes('重型主提示词'), '预览重型请求');
  await page.click('.dialog [data-close]');

  // 多选删除
  await page.click('[data-act="hv-sel-on"]');
  await page.click('.hv-row:nth-child(5) .hv-open');
  await page.click('[data-act="hv-del"]');
  await page.click('.dialog [data-yes]');
  ok(await page.evaluate(() => UI.settings.prompts.heavy.entries.map((e) => e.name).join('|')) === '主提示词|自然语言生图提示词（默认那一套）|深度条目|只在继续时|结尾', '多选删除');
  await page.evaluate(() => window.__appBack());

  // —— 格式不对时：第一次默认、重试用重型、下一次又从默认开始 ——
  replies = ['我不会', '还是不会'];
  got = await write();
  ok(got.length === 3, '格式不对，重试次数 2：共请求 3 次');
  ok(got[0][0].content === '我的破限词' && got[0].length === 4, '第 1 次是默认那套');
  const h = got[1].map((x) => x.role[0] + ':' + x.content.slice(0, 12));
  ok(got[1][0].content === '你是AI，重型主提示词。' && got[1][1].content === '我的破限词' && got[1][got[1].length - 1].content === '好的，我先思考。', '第 2 次改用重型：主提示词 → 默认整套 → 结尾：' + h.join(' / '));
  ok(got[1].some((x) => x.content.startsWith('深度一的提醒')) && got[1][got[1].length - 3].content.startsWith('深度一的提醒'), '深度条目插在默认那套的最后一条前');
  ok(got[1].some((x) => x.role === 'user' && x.content.includes('上次你的回复格式不对')), '重型请求里也带上「上次格式不对」的提示');
  ok(got[2][0].content.startsWith('你是AI'), '第 3 次还是重型');
  ok(await page.$eval('#c-tag', (e) => e.value) === '1girl, smile', '第 3 次读到结果');
  ok(await page.evaluate(() => [...document.querySelectorAll('.ask-toast')].some((t) => t.textContent.includes('改用重型提示词'))), '提示改用了重型提示词');
  got = await write();
  ok(got.length === 1 && got[0][0].content === '我的破限词', '下一次写提示词重新从默认开始');

  // 关掉重型开关：重试也用默认
  await page.evaluate(() => { UI.settings.prompts.heavy.enabled = false; });
  replies = ['不会'];
  got = await write();
  ok(got.length === 2 && got[1][0].content === '我的破限词', '关掉重型提示词，重试还用默认那套');

  // 重试次数 0
  await page.evaluate(() => { UI.settings.prompts.retries = 0; UI.settings.prompts.heavy.enabled = true; });
  replies = ['不会'];
  got = await write();
  ok(got.length === 1 && (await page.textContent('#c-live')).includes('出错'), '重试次数 0：只请求一次就报错');

  // 存储后重开还在
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('#c-tag');
  const kept = await page.evaluate(() => [UI.settings.prompts.jailbreak, UI.settings.prompts.heavy.name, UI.settings.prompts.heavy.entries.length]);
  ok(kept[0] === '我的破限词' && kept[1] === '我的预设' && kept[2] === 5, '重开后自定义提示词和重型预设都还在');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
