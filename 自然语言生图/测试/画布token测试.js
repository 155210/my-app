// 多画布（新建、切换、复制、改名、删除、参数跟着走、重开还在）和 token 读数（三种分词器、下载缓存、超上限变红、估算）
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/画布token测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

// 假分词器：T5 是 HF 的 Unigram tokenizer.json，NAI 的 .def 是 raw deflate 压过的
const T5 = { model: { type: 'Unigram', unk_id: 2, vocab: [['<pad>', 0], ['</s>', 0], ['<unk>', 0], ['▁', -3], ['▁long', -2], ['▁hair', -2], ['▁lo', -4], ['ng', -4], [',', -3], ['▁1', -3], ['girl', -3], ['▁girl', -2.5], ['a', -6], ['b', -6]] } };
// CLIP：NAI 的 clip_tokenizer.def 是 { text: 合并表 }
const CLIP = { text: '#version\nh e\nl l\nhe ll\nhell o</w>\n' };
// qwen：NAI 的 { config, vocab, merges }，字节级
const QWEN = { config: { splitRegex: "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+" }, specialTokens: [], vocab: { 'Ġcat': 9, 'cat': 8 }, merges: ['c a', 'ca t', 'Ġ c', 'Ġ cat'] };
const DEFS = { t5_tokenizer: T5, clip_tokenizer: CLIP, qwen35_tokenizer: QWEN };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  const hits = {};
  let block = false;
  await ctx.route('https://novelai.net/tokenizer/**', (r) => {
    const n = /compressed\/(\w+)\.def/.exec(r.request().url())[1];
    hits[n] = (hits[n] || 0) + 1;
    if (block) return r.fulfill({ status: 403, headers: CORS, body: '' });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/octet-stream' }, body: zlib.deflateRawSync(Buffer.from(JSON.stringify(DEFS[n]))) });
  });
  await ctx.route(/hf-mirror\.com|huggingface\.co/, (r) => r.fulfill({ status: 404, headers: CORS, body: '' }));
  await ctx.route('https://nai.test/**', (r) => r.fulfill({ status: 404, headers: CORS, body: '' }));
  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');
  await page.goto(url);
  await page.waitForSelector('#c-write');
  await page.evaluate(() => {
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k', model: 'nai-diffusion-4-5-full', qualityToggle: false });
    UI.saveSettings(); CreatePage.refresh();
  });

  // ---------------- 分词器本身 ----------------
  const n = await page.evaluate((d) => {
    const t5 = TokenCount.build(JSON.stringify(d.T5)), clip = TokenCount.build(JSON.stringify(d.CLIP)), qw = TokenCount.build(JSON.stringify(d.QWEN));
    return { t5a: t5('long hair'), t5b: t5('long hair, 1girl'), t5c: t5('xyzq'), clip: clip('Hello hello'), clipx: clip('he'), qw: qw('cat cat'), qw2: qw("It's") };
  }, { T5, CLIP, QWEN });
  ok(n.t5a === 2, 'T5（Unigram）：long hair = ▁long ▁hair 2 个（' + n.t5a + '）');
  ok(n.t5b === 5, 'T5：long hair, 1girl = ▁long ▁hair , ▁1 girl 按最高分切（' + n.t5b + '）');
  ok(n.t5c === 2, 'T5：生字连着算一个 unk（▁ + unk = ' + n.t5c + '）');
  ok(n.clip === 2, 'CLIP：大小写不分，hello 合成一个（' + n.clip + '）');
  ok(n.clipx === 2, 'CLIP：he 结尾带 </w>，没有这条合并就是 2 个（' + n.clipx + '）');
  ok(n.qw === 2, 'Qwen（字节级 BPE，(?i:) 正则）：cat cat = cat Ġcat（' + n.qw + '）');
  ok(n.qw2 > 0, 'Qwen：带撇号的也能切（' + n.qw2 + '）');
  const w = await page.evaluate(() => TokenCount.stripWeights('1.2::long hair::, {{smile}}, [[hat]]'));
  ok(!/[:{}[\]]|1\.2/.test(w) && /long hair/.test(w), '权重写法不算 token');

  // ---------------- 创作页那一行 ----------------
  await page.fill('#c-tag', 'long hair');
  await page.dispatchEvent('#c-tag', 'input');
  await page.waitForFunction(() => /正面 \d+ \/ 512/.test((document.querySelector('#c-tok') || {}).textContent || '') && !/约/.test(document.querySelector('#c-tok').textContent), null, { timeout: 5000 });
  const line = await page.textContent('#c-tok');
  ok(hits.t5_tokenizer === 1, 'V4.5 自动下载 T5 分词器（官网 .def，raw deflate）');
  const exp = await page.evaluate(() => TokenCount.count(Nai.buildBody(UI.settings.nai, CreatePage.draft).meta.positive).n);
  ok(line.includes('正面 ' + exp + ' / 512'), '正面数的是实际发送的全文（带质量词）：' + line);
  ok(await page.evaluate(() => Store.get('tok:t5').then((v) => !!v && v.length > 10)), '分词器存进本机 tok:t5');
  ok(await page.evaluate(async () => { const k = await Store.keys(); return k.includes('tok:t5'); }), 'tok: 键在库里');
  const bk = fs.readFileSync(path.join(ROOT, '备份.js'), 'utf8');
  ok(/startsWith\('tok:'\)/.test(bk), '分词器不进备份');

  // 超上限变红
  await page.fill('#c-tag', Array(600).fill('long hair').join(', '));
  await page.dispatchEvent('#c-tag', 'input');
  await page.waitForSelector('#c-tok .tok-over', { timeout: 3000 });
  ok(true, '超过 512 变红');
  await page.click('#c-tok');
  const sheet = await page.textContent('.sheet');
  ok(/超 \d+/.test(sheet) && /T5/.test(sheet) && /准数/.test(sheet), '点开看明细：超了多少、用的哪个分词器');
  await page.click('.sheet [data-close]');

  // 多角色另算
  await page.evaluate(() => { Characters.set([{ on: true, tag: 'long hair', negative: '', pos: '' }]); CreatePage.refresh(); });
  await page.waitForFunction(() => /角色 1 个共 2/.test(document.querySelector('#c-tok').textContent), null, { timeout: 3000 }).then(() => ok(true, '多角色另算'), () => ok(false, '多角色另算：' + ''));
  await page.evaluate(() => { Characters.set([]); CreatePage.refresh(); });

  // V3 换 CLIP，上限 225；V5 qwen 不显示上限
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-3'; UI.saveSettings(); CreatePage.refresh(); });
  await page.waitForFunction(() => / \/ 225/.test(document.querySelector('#c-tok').textContent) && !/约/.test(document.querySelector('#c-tok').textContent), null, { timeout: 5000 }).then(() => ok(hits.clip_tokenizer === 1, 'V3 换 CLIP 分词器，上限 225'), () => ok(false, 'V3 换 CLIP：' + ''));
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-5-full'; UI.saveSettings(); CreatePage.refresh(); });
  await page.waitForFunction(() => !/ \/ /.test(document.querySelector('#c-tok').textContent) && !/约/.test(document.querySelector('#c-tok').textContent), null, { timeout: 5000 }).then(() => ok(hits.qwen35_tokenizer === 1, 'V5 换 Qwen 分词器，不显示上限'), () => ok(false, 'V5 Qwen'));

  // 下载不了：估算显示「约」，明细里能重新下载
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  block = true;
  await p2.evaluate(() => 0);
  await p2.goto(url);
  await p2.waitForSelector('#c-write');
  await p2.evaluate(async () => { await Store.del('tok:t5'); });
  await p2.reload();
  await p2.waitForSelector('#c-tok');
  await p2.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-full'; UI.saveSettings(); CreatePage.refresh(); });
  await p2.waitForFunction(() => /约/.test(document.querySelector('#c-tok').textContent) && !/下载分词器中/.test(document.querySelector('#c-tok').textContent), null, { timeout: 5000 }).then(() => ok(true, '下载不了：按字数估，显示「约」'), () => ok(false, '下载不了时估算'));
  await p2.click('#c-tok');
  ok(/下载失败/.test(await p2.textContent('.sheet')), '明细里写着下载失败');
  block = false;
  await p2.click('.sheet [data-a="dl"]');
  await p2.waitForFunction(() => !/约/.test(document.querySelector('#c-tok').textContent), null, { timeout: 5000 }).then(() => ok(true, '点「重新下载分词器」后变准数'), () => ok(false, '重新下载'));
  await p2.evaluate(() => UI.$$('.sheet [data-close]').forEach((b) => b.click()));
  await p2.close();

  // ---------------- 多画布 ----------------
  await page.reload();
  await page.waitForSelector('#c-canvas .cv-chip');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-4-5-full'; UI.settings.nai.steps = 23; UI.saveSettings(); CreatePage.refresh(); });
  ok((await page.$$('#c-canvas [data-id]')).length === 1 && /画布 1/.test(await page.textContent('#c-canvas')), '老用户打开：现在的样子就是「画布 1」');
  await page.fill('#c-desc', '天台黄昏的女孩');
  await page.dispatchEvent('#c-desc', 'input');
  await page.fill('#c-tag', 'rooftop, sunset');
  await page.dispatchEvent('#c-tag', 'input');
  await page.evaluate(() => { Characters.set([{ on: true, tag: 'girl, red hair', negative: '', pos: '' }]); });
  await page.click('#c-canvas [data-a="add"]');
  await page.waitForFunction(() => document.querySelectorAll('#c-canvas [data-id]').length === 2);
  ok(await page.inputValue('#c-desc') === '' && await page.inputValue('#c-tag') === '', '＋ 新建：提示词是空的');
  ok(await page.evaluate(() => UI.settings.nai.steps === 23 && Characters.get().length === 1), '新建：出图参数、多角色接着用刚才的');
  await page.fill('#c-tag', 'forest');
  await page.dispatchEvent('#c-tag', 'input');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-3'; UI.settings.nai.steps = 40; UI.saveSettings(); Characters.set([]); CreatePage.refresh(); });
  // 切回画布 1
  await page.click('#c-canvas [data-id]:nth-child(1)');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === 'rooftop, sunset');
  ok(await page.inputValue('#c-desc') === '天台黄昏的女孩', '切回画布 1：描述、提示词都回来了');
  ok(await page.evaluate(() => UI.settings.nai.model === 'nai-diffusion-4-5-full' && UI.settings.nai.steps === 23), '切回画布 1：模型、步数回来了');
  ok(await page.evaluate(() => Characters.get().length === 1 && Characters.get()[0].tag === 'girl, red hair'), '切回画布 1：多角色回来了');
  ok(/天台黄昏/.test(await page.textContent('#c-canvas .cv-chip.on')), '画布上的小字是描述开头');
  await page.click('#c-canvas [data-id]:nth-child(2)');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === 'forest');
  ok(await page.evaluate(() => UI.settings.nai.model === 'nai-diffusion-3' && UI.settings.nai.steps === 40 && Characters.get().length === 0), '画布 2 记着自己的参数');

  // 复制
  await page.click('#c-canvas > [data-a="copy"]');
  await page.waitForFunction(() => document.querySelectorAll('#c-canvas [data-id]').length === 3);
  ok(/画布 2 副本/.test(await page.textContent('#c-canvas .cv-chip.on')) && await page.inputValue('#c-tag') === 'forest', '复制：原样一份，切到副本');
  const order = await page.$$eval('#c-canvas [data-id] .cv-name', (a) => a.map((x) => x.textContent));
  ok(order.join('|') === '画布 1|画布 2|画布 2 副本', '副本排在原画布后面');
  await page.fill('#c-tag', 'forest, night');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-canvas [data-id]:nth-child(2)');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === 'forest');
  ok(true, '改副本不影响原画布');

  // 点正在用的 → 菜单：改名
  await page.click('#c-canvas .cv-chip.on');
  await page.click('.sheet [data-m="ren"]');
  await page.fill('.dialog [data-n]', '森林');
  await page.click('.dialog [data-ok]');
  await page.waitForFunction(() => /森林/.test(document.querySelector('#c-canvas .cv-chip.on').textContent));
  ok(true, '点正在用的画布 → 改名');

  // 重开还在
  await page.reload();
  await page.waitForSelector('#c-canvas .cv-chip');
  ok((await page.$$('#c-canvas [data-id]')).length === 3 && /森林/.test(await page.textContent('#c-canvas .cv-chip.on')) && await page.inputValue('#c-tag') === 'forest', '重开 App：画布都在，停在上次那个');
  await page.click('#c-canvas [data-id]:nth-child(3)');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === 'forest, night');
  ok(true, '重开后副本的内容也在');

  // 删除（删正在用的 → 切到前一个）
  await page.click('#c-canvas .cv-chip.on');
  await page.click('.sheet [data-m="del"]');
  await page.click('.dialog [data-yes]');
  await page.waitForFunction(() => document.querySelectorAll('#c-canvas [data-id]').length === 2);
  ok(await page.inputValue('#c-tag') === 'forest' && /森林/.test(await page.textContent('#c-canvas .cv-chip.on')), '删掉正在用的：切到前一个');
  ok(await page.evaluate(async () => (await Store.get('canvases')).list.length === 2), '存进 canvases 键');
  const bkKeys = await page.evaluate(async () => { const all = await Store.dumpAll(); return Object.keys(all); });
  ok(bkKeys.includes('canvases'), 'canvases 在库里（跟着设置导出）');

  // 预设下拉跟着画布
  await page.evaluate(async () => { Presets.get().list.push({ id: 'pr_x', name: '甲', nai: Presets.snapshot().nai, chars: [], time: 1 }); Presets.get().cur = 'pr_x'; });
  await page.click('#c-canvas [data-id]:nth-child(1)');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === 'rooftop, sunset');
  ok(await page.evaluate(() => Presets.get().cur === ''), '切画布：预设下拉换成那个画布当时选的');
  await page.click('#c-canvas [data-id]:nth-child(2)');
  await page.waitForFunction(() => document.querySelector('#c-tag').value === 'forest');
  ok(await page.evaluate(() => Presets.get().cur === 'pr_x'), '切回来：预设下拉也回来');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
