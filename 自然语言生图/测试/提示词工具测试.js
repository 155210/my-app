// 提示词工具测试：联想（中英文、通配符）、调权重（V4+ 数字 / V3 括号）、语法高亮、标签说明（AI 翻成中文、缓存）、通配符、预设
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/提示词工具测试.js
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
  let aiCalls = 0, aiUser = '';
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    aiCalls++;
    aiUser = JSON.parse(req.postData()).messages.slice(-1)[0].content;
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: '比肩膀长、最长到腰的头发。' } }] }) });
  });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');
  await page.evaluate(() => TagLib.load());

  // ---------- 纯函数 ----------
  const u = await page.evaluate(() => {
    const P = PromptEdit;
    return {
      tok: P.tokenAt('1girl, 1.2::long hair::, smile', 12),
      br: P.parseWeight('{{blush}}'),
      w1: P.withWeight('smile', 1.1, false), w0: P.withWeight('smile', 1, false), w3: P.withWeight('smile', 1.05 * 1.05, true), w3d: P.withWeight('smile', 1 / 1.05, true),
      hl: P.highlight('1.3::smile::, [blush], -1::hat::, artist:foo, __发色__, notarealtag zzz, long hair'),
      sugEn: TagLib.suggest('long h', 5).map((x) => x[0]), sugZh: TagLib.suggest('黑发', 5).map((x) => x[0]), sugAl: TagLib.suggest('hires', 3).map((x) => x[0]),
    };
  });
  ok(u.tok.inner === 'long hair' && u.tok.w === 1.2 && u.tok.raw === '1.2::long hair::', '找到光标所在的标签和它的权重');
  ok(u.br.inner === 'blush' && Math.abs(u.br.w - 1.1025) < 1e-9, '认得 {{}} 加权');
  ok(u.w1 === '1.1::smile::' && u.w0 === 'smile' && u.w3 === '{{smile}}' && u.w3d === '[smile]', '权重拼回去：V4+ 数字、1 去掉、V3 括号');
  ok(/pe-up[^>]*>smile/.test(u.hl) && /pe-dn[^>]*>blush/.test(u.hl) && /pe-neg[^>]*>hat/.test(u.hl), '高亮：加权橙、减权蓝、负权重红');
  ok(u.hl.includes('pe-art') && u.hl.includes('<span class="pe-wc">__发色__</span>'), '高亮：画师、通配符');
  ok(u.hl.includes('<span class="pe-unk">notarealtag zzz</span>') && !/pe-unk">long hair/.test(u.hl), '标签库里没有的标签带虚下划线，认识的不带');
  ok(u.sugEn[0] === 'long hair', '英文联想：long h → ' + u.sugEn.join(', '));
  ok(u.sugZh[0] === 'black hair', '中文联想：黑发 → ' + u.sugZh.join(', '));
  ok(u.sugAl[0] === 'highres', '别名联想：hires → highres');

  // ---------- 创作页里联想、调权重、高亮 ----------
  const tag = page.locator('#c-tag');
  await tag.click();
  await page.keyboard.type('1girl, 黑发');
  await page.waitForSelector('.pe-strip:not([hidden]) [data-a="pick"]');
  ok(await page.$eval('.pe-strip [data-a="pick"]', (b) => b.dataset.t) === 'black hair', '打中文「黑发」联想条第一个是 black hair');
  await page.screenshot({ path: path.join(OUT, '提示词-联想.png') });
  await page.click('.pe-strip [data-a="pick"]');
  ok(await tag.inputValue() === '1girl, black hair, ', '点一下换成英文并补上逗号');
  ok(await page.evaluate(() => document.activeElement.id === 'c-tag'), '点联想条后光标还在格子里');
  await page.keyboard.type('smil');
  await page.waitForFunction(() => [...document.querySelectorAll('.pe-strip [data-a="pick"]')].some((b) => b.dataset.t === 'smile'));
  await page.click('.pe-strip [data-a="pick"][data-t="smile"]');
  ok(await tag.inputValue() === '1girl, black hair, smile, ', '英文联想 smil → smile');
  // 光标放回 black hair 上加权
  await page.evaluate(() => { const t = document.querySelector('#c-tag'); t.focus(); t.setSelectionRange(10, 10); t.dispatchEvent(new Event('click')); });
  await page.waitForSelector('.pe-w');
  await page.click('.pe-w [data-a="up"]');
  await page.click('.pe-w [data-a="up"]');
  ok(await tag.inputValue() === '1girl, 1.2::black hair::, smile, ', '＋ 两下：1.2::black hair::');
  ok(await page.$eval('.pe-w em', (e) => e.textContent) === '1.2', '联想条显示当前权重 1.2');
  await page.click('.pe-w [data-a="down"]'); await page.click('.pe-w [data-a="down"]'); await page.click('.pe-w [data-a="down"]');
  ok(await tag.inputValue() === '1girl, 0.9::black hair::, smile, ', '− 三下：0.9::black hair::');
  ok(await page.evaluate(() => !!document.querySelector('.pe-back .pe-dn')), '格子背后的高亮层跟着变（减权蓝色）');
  // 程序直接改 value 也会重画高亮
  await page.evaluate(() => { document.querySelector('#c-tag').value = '1.5::smile::'; });
  ok(await page.evaluate(() => document.querySelector('.pe-back').textContent.trim() === '1.5::smile::'), '直接改 value 高亮层也更新');
  await page.screenshot({ path: path.join(OUT, '提示词-权重.png') });
  // V3 用括号
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-3'; const t = document.querySelector('#c-tag'); t.value = 'smile'; t.focus(); t.setSelectionRange(2, 2); t.dispatchEvent(new Event('click')); });
  await page.click('.pe-w [data-a="up"]');
  ok(await tag.inputValue() === '{smile}', 'V3 加权写成 {smile}');
  await page.evaluate(() => { UI.settings.nai.model = 'nai-diffusion-5-full'; });

  // ---------- 通配符 ----------
  const wc = await page.evaluate(() => {
    let i = 0; const seq = [0, 0.99];
    const r = Wildcards.resolve('1girl, __发色__, __没有的__', () => seq[i++ % 2]);
    UI.settings.tags.wildcards.push({ name: '套娃', lines: '__表情__, sitting' });
    const nest = Wildcards.resolve('__套娃__', () => 0);
    const body = Nai.buildBody(UI.settings.nai, { tag: '__发色__', negative: '__表情__', size: 'portrait' });
    return { r, nest, pos: body.body.input, neg: body.body.parameters.negative_prompt, v4neg: body.body.parameters.v4_negative_prompt.caption.base_caption, metaNeg: body.meta.negative, metaPos: body.meta.positive };
  });
  ok(wc.r === '1girl, black hair, __没有的__', '通配符随机换一行，没建过的原样留着：' + wc.r);
  ok(wc.nest === 'smile, sitting', '通配符能套娃');
  ok(!wc.pos.includes('__') && !wc.neg.includes('__') && wc.v4neg === wc.neg && wc.metaNeg === wc.neg && wc.metaPos === wc.pos, '出图请求和配方里都是换好的');
  await page.evaluate(() => { const t = document.querySelector('#c-tag'); t.value = ''; t.focus(); });
  await page.keyboard.type('__');
  await page.waitForSelector('.pe-strip [data-a="wc"]');
  await page.click('.pe-strip [data-a="wc"][data-t="天气"]');
  ok(await tag.inputValue() === '__天气__, ', '打 __ 联想通配符名字');

  // ---------- 标签说明 ----------
  await page.evaluate(() => { Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm', stream: false }); });
  await page.evaluate(() => TagWiki.open('long_hair'));
  await page.waitForFunction(() => document.querySelector('.tw-body') && document.querySelector('.tw-body').textContent.includes('肩膀'));
  ok(aiCalls === 1 && aiUser.includes('Hair longer than the shoulders'), '第一次看：把英文说明发给 AI 翻译');
  const tw = await page.evaluate(() => ({ title: document.querySelector('.tw-title').textContent, body: document.querySelector('.tw-body').textContent }));
  ok(tw.title === '长发' && !/[a-z]{4,}/i.test(tw.body), '只显示中文：' + tw.title + ' / ' + tw.body);
  await page.screenshot({ path: path.join(OUT, '提示词-说明.png') });
  await page.evaluate(() => UI.closeLayer());
  await page.evaluate(() => TagWiki.open('long hair'));
  await page.waitForFunction(() => document.querySelector('.tw-body').textContent.includes('肩膀'));
  ok(aiCalls === 1, '第二次看直接用存下的译文，不再调 AI');
  await page.evaluate(() => UI.closeLayer());
  await page.evaluate(() => TagWiki.open('cowboy shot'));
  await page.waitForSelector('.tw-rel');
  ok(await page.$eval('.tw-rel', (b) => b.dataset.t) === 'cropped legs', '相关标签显示出来');
  await page.evaluate(() => UI.closeLayer());
  // 标签库每行的 ⓘ
  await page.click('#c-tag-lib');
  await page.waitForSelector('.tg-row .tg-i');
  await page.click('.tg-row[data-t="long hair"] .tg-i');
  await page.waitForSelector('.tw-title');
  ok(await page.$eval('.tw-title', (e) => e.textContent) === '长发', '标签库里点 ⓘ 打开说明');
  await page.evaluate(() => { UI.closeLayer(); UI.closeLayer(); });

  // ---------- 预设 ----------
  await page.waitForSelector('#c-preset select');
  await page.evaluate(async () => {
    UI.settings.nai.model = 'nai-diffusion-4-5-full'; UI.settings.nai.steps = 23; UI.settings.nai.portraitSize = '640×1536';
    UI.settings.nai.vibes = [{ id: 'v1', name: 'A', on: true, strength: 0.4, info: 0.7 }, { id: 'v2', name: 'B', on: false, strength: 0.6, info: 1 }];
    Characters.set([{ tag: 'girl, red hair', negative: 'hat', pos: 'B2' }]);
    UI.saveSettings();
  });
  await page.click('#c-preset [data-a="menu"]');
  await page.click('[data-m="new"]');
  await page.fill('[data-n]', '双人竖图');
  await page.click('[data-ok]');
  await page.waitForFunction(() => Presets.get().list.length === 1);
  // 改一堆再切回来
  await page.evaluate(() => {
    const n = UI.settings.nai; n.model = 'nai-diffusion-5-full'; n.steps = 40; n.portraitSize = '832×1216'; n.vibes[0].on = false; n.vibes[1].on = true;
    UI.settings.nai.key = 'secret-key';
    Characters.set([]);
    UI.saveSettings(); CreatePage.refresh();
  });
  await page.waitForFunction(() => !document.querySelector('#c-preset .pre-mod').hidden);
  ok(true, '改了设置以后预设旁边显示「改过」');
  await page.selectOption('#c-preset select', { label: '双人竖图' });
  const pr = await page.evaluate(() => ({ n: UI.settings.nai, c: Characters.get() }));
  ok(pr.n.model === 'nai-diffusion-4-5-full' && pr.n.steps === 23 && pr.n.portraitSize === '640×1536', '切回预设：模型、步数、尺寸都回来了');
  ok(pr.n.vibes[0].on === true && pr.n.vibes[0].strength === 0.4 && pr.n.vibes[1].on === false, '参考图开关和强度回来了');
  ok(pr.c.length === 1 && pr.c[0].tag === 'girl, red hair' && pr.c[0].pos === 'B2', '多角色回来了');
  ok(pr.n.key === 'secret-key', 'Key 不跟着预设变');
  ok(await page.evaluate(() => document.querySelector('#c-preset .pre-mod').hidden), '切换后不显示「改过」');
  await page.screenshot({ path: path.join(OUT, '提示词-预设.png') });

  // 重开还在
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('#c-preset select');
  ok(await page.$eval('#c-preset select', (s) => s.selectedOptions[0].textContent) === '双人竖图', '重开后预设还在、还是选中的');
  ok(await page.evaluate(async () => { await TagLib.load(); await TagWiki.load(); return !!(await Store.get('wikiZh', {}))['long hair']; }), '重开后译文还在');

  // ---------- 单行框也能中文联想 ----------
  await page.evaluate(() => { Characters.set([{ tag: 'girl' }, { tag: 'boy' }]); CreatePage.refresh(); });
  await page.click('#c-chars [data-a="act-add"]');
  await page.fill('#c-chars input[data-g="act"]', '');
  await page.focus('#c-chars input[data-g="act"]');
  await page.keyboard.type('拥抱');
  await page.waitForSelector('.pe-strip:not([hidden]) button[data-t="hug"]');
  ok(await page.evaluate(() => { const s = document.querySelector('.pe-strip'); return s.previousElementSibling === document.querySelector('#c-chars input[data-g="act"]').closest('.row'); }), '互动动作框打中文出联想，联想条在那一行下面');
  await page.click('.pe-strip button[data-t="hug"]');
  ok(await page.evaluate(() => Characters.getActs()[0].act === 'hug'), '点联想后互动动作变成 hug（不补逗号）');
  await page.evaluate(() => {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = '<input type="text" data-f="hair" id="t-hair"><button>x</button>';
    document.querySelector('#view-create').appendChild(r);
  });
  await page.waitForFunction(() => document.querySelector('#t-hair').dataset.pe);
  await page.focus('#t-hair');
  await page.keyboard.type('黑发');
  await page.waitForSelector('.pe-strip:not([hidden]) button[data-t="black hair"]');
  await page.click('.pe-strip button[data-t="black hair"]');
  ok(await page.$eval('#t-hair', (e) => e.value) === 'black hair, ', '角色库这类外貌栏打「黑发」选完变成 black hair');
  ok(await page.evaluate(() => !document.querySelector('#t-hair').previousElementSibling || !document.querySelector('#t-hair').previousElementSibling.classList.contains('pe-back')), '单行框不垫高亮层');
  ok(await page.evaluate(() => ['input[data-ps="customPose"]', 'input[data-ws]', 'textarea[data-f="negative"]', 'input[type="text"][data-p]'].every((q) => { const d = document.createElement('div'); d.innerHTML = q.startsWith('textarea') ? '<textarea data-f="negative"></textarea>' : q.includes('data-ps') ? '<input data-ps="customPose">' : q.includes('data-ws') ? '<input data-ws="top">' : '<input type="text" data-p>'; return d.firstChild.matches(PromptEdit.SEL); })), '写真、衣柜、表情上色、图生图的格子都在名单里');
  await page.evaluate(() => document.querySelector('#t-hair').closest('.row').remove());

  // 设置页：通配符、开关
  await page.click('#btn-settings');
  await page.click('.tabs button[data-tab="wildcards"]');
  ok(await page.$$eval('[data-k^="tags.wildcards"][data-k$=".name"]', (x) => x.length) >= 3, '设置页有通配符列表');
  await page.click('[data-act="wc-add"]');
  ok(await page.evaluate(() => UI.settings.tags.wildcards.some((w) => w.name.startsWith('通配符'))), '能新建通配符');
  await page.click('.tabs button[data-tab="tags"]');
  ok(await page.$eval('[data-k="tags.complete"]', (e) => e.checked) && await page.$eval('[data-k="tags.highlight"]', (e) => e.checked), '设置里有联想、高亮开关，默认开');
  await page.click('label.check:has([data-k="tags.highlight"]) .switch');
  ok(await page.evaluate(() => UI.settings.tags.highlight === false), '点开关关掉高亮');
  await page.evaluate(() => UI.closeLayer());
  ok(await page.evaluate(() => !document.querySelector('#c-tag').classList.contains('pe-on') && !document.querySelector('.pe-back')), '关掉高亮后所有格子恢复原样');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
