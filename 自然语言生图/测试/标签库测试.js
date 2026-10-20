// 标签库无头浏览器测试：数据能读、搜索（中/英/别名）、分类、点一下加进提示词、给 AI 的参考、AI 写完纠错
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/标签库测试.js
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
  let lastUser = '';
  await page.route('https://ai.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    lastUser = JSON.parse(req.postData()).messages.slice(-1)[0].content;
    const reply = '{"tag":"1girl, Black_Hair, blue eye, hires, 1girl, artist:foo, {smile}, made up tag","nl":"","negative":"Glasses","size":"portrait"}';
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
  });

  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');

  const unit = await page.evaluate(async () => {
    const t0 = performance.now();
    const all = await TagLib.load();
    const ms = performance.now() - t0;
    const f = TagLib.fix('hires, Blue_Eye, 1girl, 1girl, artist:foo, {smile}, weird tag xyz, black hat');
    const c = TagLib.candidates('黄昏的天台上，黑发蓝眼睛的初音未来穿着白色连衣裙回头笑').map((x) => x[1]);
    return { n: all.length, ms, f, c, cats: [...new Set(all.map((t) => t[3]))].sort(), zh: all.find((t) => t[0] === 'long hair')[1] };
  });
  ok(unit.n > 20000, '标签库读到 ' + unit.n + ' 个标签（' + Math.round(unit.ms) + 'ms）');
  ok(unit.cats.join() === '0,1,3,4,5', '有通用/画师/作品/角色/元数据五类');
  ok(unit.zh === '长发', 'long hair 的中文是「长发」');
  ok(unit.f.text === 'highres, blue eyes, 1girl, artist:foo, {smile}, weird tag xyz, black hat', '纠错：别名、单复数、下划线大小写、去重，特殊写法和不认识的保留：' + unit.f.text);
  ok(unit.f.unknown.join() === 'weird tag xyz', '认不出的标签单独列出');
  ok(['black hair', 'hatsune miku', 'white dress'].every((x) => unit.c.includes(x)), '中文描述里找到候选：' + unit.c.join(', '));

  // 写提示词：参考附给 AI、写完纠错
  await page.evaluate(() => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm', stream: false });
    UI.settings.autoDraw = false;
    UI.saveSettings();
    const d = document.querySelector('#c-desc');
    d.value = '黑发蓝眼睛的初音未来';
    d.dispatchEvent(new Event('input'));
  });
  await page.click('#c-write');
  await page.waitForFunction(() => document.querySelector('#c-tag').value.includes('1girl'));
  const tagVal = await page.$eval('#c-tag', (e) => e.value);
  ok(lastUser.includes('【标签库参考】') && lastUser.includes('初音未来=hatsune miku'), '发给 AI 的消息里带标签库参考');
  ok(tagVal === '1girl, black hair, blue eyes, highres, artist:foo, {smile}, made up tag', 'AI 写完自动纠错：' + tagVal);
  ok(await page.$eval('#c-neg', (e) => e.value) === 'glasses', '负面词也统一写法');
  ok(await page.evaluate(() => [...document.querySelectorAll('.ask-toast')].some((t) => t.textContent.includes('标签库纠正了'))), '提示纠正了哪些');

  // 关掉纠错就不改
  await page.evaluate(() => { UI.settings.tags.fix = false; });
  await page.click('#c-write');
  await page.waitForFunction(() => document.querySelector('#c-tag').value.includes('Black_Hair'));
  ok(true, '设置里关掉纠错后原样保留');
  await page.evaluate(() => { UI.settings.tags.fix = true; const t = document.querySelector('#c-tag'); t.value = '1girl'; t.dispatchEvent(new Event('input')); });

  // 标签库页面
  await page.click('#c-tag-lib');
  await page.waitForSelector('.tg-row');
  const first = await page.$$eval('.tg-row', (rs) => rs.slice(0, 3).map((r) => [r.querySelector('.tg-zh').textContent, r.querySelector('.tg-en').textContent]));
  ok(first[0][1] === '1girl' && first[0][0] === '1个女孩', '默认按热度排，第一列中文：' + JSON.stringify(first));
  ok(await page.$eval('.tg-row[data-t="1girl"]', (e) => e.classList.contains('on')), '已经在提示词里的标签高亮');

  await page.fill('.tg-q', '黑发');
  await page.waitForFunction(() => document.querySelector('.tg-row') && document.querySelector('.tg-row').dataset.t === 'black hair');
  ok(true, '搜中文「黑发」第一个是 black hair');
  await page.click('.tg-row[data-t="black hair"]');
  ok((await page.$eval('#c-tag', (e) => e.value)) === '1girl, black hair', '点一下加进正面提示词');
  ok((await page.$eval('.tg-foot span', (e) => e.textContent)).includes('有 2 个'), '底部显示提示词里的标签数');
  await page.screenshot({ path: path.join(OUT, '标签库-搜索.png') });
  await page.click('.tg-row[data-t="black hair"]');
  ok((await page.$eval('#c-tag', (e) => e.value)) === '1girl', '再点一下去掉');

  await page.fill('.tg-q', 'hires');
  await page.waitForFunction(() => document.querySelector('.tg-row') && document.querySelector('.tg-row').dataset.t === 'highres');
  ok(true, '搜别名 hires 找到 highres');

  await page.fill('.tg-q', '');
  await page.click('.tg-cats [data-c="4"]');
  await page.waitForFunction(() => document.querySelector('.tg-row').dataset.t === 'hatsune miku');
  ok(true, '分类「角色」第一个是 hatsune miku');
  await page.click('.tg-sort [data-s="cold"]');
  const cold = await page.$$eval('.tg-row .tg-n', (rs) => rs.slice(0, 2).map((r) => r.textContent));
  ok(cold.length === 2 && parseInt(cold[0]) <= parseInt(cold[1]), '热度↑ 排序');
  await page.click('.tg-cats [data-c="-1"]');
  await page.click('.tg-sort [data-s="hot"]');

  const before = await page.$$eval('.tg-row', (r) => r.length);
  await page.$eval('.tg-body', (b) => { b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction((n) => document.querySelectorAll('.tg-row').length > n, before);
  ok(true, '往下滑自动加载更多（' + before + ' → ' + await page.$$eval('.tg-row', (r) => r.length) + '）');
  await page.screenshot({ path: path.join(OUT, '标签库.png') });

  const back = await page.evaluate(() => window.__appBack() && !document.querySelector('.tg-list'));
  ok(back, '返回键关掉标签库');

  // 设置页的标签库标签
  await page.click('#btn-settings');
  await page.click('.tabs button[data-tab="tags"]');
  ok(await page.$eval('[data-k="tags.hint"]', (e) => e.checked) && await page.$eval('[data-k="tags.fix"]', (e) => e.checked), '设置页有标签库开关，默认都开');
  await page.click('[data-act="tags-open"]');
  await page.waitForSelector('.tg-row');
  ok(true, '设置页能打开标签库');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
