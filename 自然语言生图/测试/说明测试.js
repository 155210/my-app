// 新手提示 + 功能说明页（说明.js / 说明-内容.js）
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/说明测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  const url = 'http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html');

  // 不强制时（自动化浏览器）不弹提示，其他测试不受影响
  await page.goto(url);
  await page.waitForSelector('#c-write');
  await sleep(2600);
  ok(!(await page.$('.guide-bubble')), '自动化浏览器里默认不弹提示');
  const order = await page.$$eval('#topbar > *', (els) => els.map((e) => e.id));
  ok(order.indexOf('btn-help') === order.indexOf('btn-settings') - 1, '「?」在齿轮左边：' + order.join(','));

  // 打开说明页
  await page.click('#btn-help');
  await page.waitForSelector('.help-page .help-item');
  const info = await page.evaluate(() => ({
    n: document.querySelectorAll('.help-item').length,
    groups: [...document.querySelectorAll('.help-group')].map((x) => x.textContent),
    drawAnlas: !!document.querySelector('.help-item[data-id="create.draw"] .badge.anlas'),
    writeAnlas: !!document.querySelector('.help-item[data-id="create.write"] .badge.anlas'),
    vibeNote: (document.querySelector('.help-item[data-id="create.vibes"] .help-anlas') || {}).textContent || '',
  }));
  const badSel = await page.evaluate(() => Help.list.filter((e) => e.target).filter((e) => { try { document.querySelectorAll(e.target); return false; } catch (x) { return true; } }).map((e) => e.id));
  ok(!badSel.length, '所有提示的选择器都合法' + (badSel.length ? '：' + badSel.join(',') : ''));
  ok(info.n >= 40, '说明页条目 ' + info.n + ' 条');
  ok(['开始之前', '创作页', '批量页', '图库', '设置'].every((g) => info.groups.includes(g)), '分组：' + info.groups.join('、'));
  ok(info.drawAnlas && !info.writeAnlas, '出图标了花 Anlas，AI 写提示词没标');
  ok(/2 Anlas/.test(info.vibeNote), '参考图写了编码扣 2 Anlas');
  await page.fill('.help-page [data-q]', '种子');
  const hits = await page.$$eval('.help-item', (els) => els.map((e) => e.dataset.id));
  ok(hits.includes('create.seed') && !hits.includes('gallery.select'), '搜「种子」：' + hits.join(','));
  await page.evaluate(() => window.__appBack());
  ok(!(await page.$('.help-page')), '返回键关掉说明页');

  // 强制打开提示，重新进
  await ctx.addInitScript(() => { window.GUIDE_FORCE = true; });
  await page.reload();
  await page.waitForSelector('#c-write');
  await page.waitForSelector('.guide-bubble', { timeout: 5000 });
  let t = await page.textContent('.guide-bubble');
  ok(/问号/.test(t) && (await page.$('#btn-help.guide-on')), '第一条提示指向「?」：' + t.slice(0, 20));
  await page.click('.guide-bubble [data-g="ok"]');
  await page.waitForSelector('.guide-bubble', { timeout: 5000 });
  t = await page.textContent('.guide-bubble');
  ok(/AI 接口/.test(t), '点「知道了」后下一条：设置');
  // 点屏幕别处：提示消失，点击照常生效
  await page.click('#c-desc');
  ok(!(await page.$('.guide-bubble')) && await page.evaluate(() => document.activeElement.id === 'c-desc'), '点别处关掉提示，点击不被挡');
  await sleep(300);
  let st = await page.evaluate(() => Store.get('guide'));
  ok(st && st.seen.includes('start.help') && st.seen.includes('start.settings'), '看过的记下来：' + (st && st.seen.join(',')));
  // 「全部说明」跳到那一条
  await page.waitForSelector('.guide-bubble', { timeout: 5000 });
  const curId = await page.$eval('.guide-bubble', (e) => e.dataset.id);
  await page.click('.guide-bubble [data-g="help"]');
  await page.waitForSelector('.help-item.flash');
  ok(await page.$eval('.help-item.flash', (e) => e.dataset.id) === curId, '「全部说明」跳到这一条：' + curId);
  await page.evaluate(() => window.__appBack());

  // 重开：看过的不再弹
  await page.reload();
  await page.waitForSelector('#c-write');
  await page.waitForSelector('.guide-bubble', { timeout: 5000 });
  const ids = await page.evaluate(() => Store.get('guide').then((s) => s.seen));
  ok(!(await page.$('#btn-help.guide-on')) && ids.length >= 3, '重开后看过的不再弹');

  // 别的功能用 Help.add / data-guide 加提示
  await page.evaluate(async () => {
    await Store.set('guide', { off: false, seen: Help.list.map((e) => e.id) });
  });
  await page.reload();
  await page.waitForSelector('#c-write');
  await page.evaluate(() => {
    Help.add({ id: 'test.new', group: '新功能组', title: '测试功能', text: '详细说明', tip: '这是新功能', target: '#t-new', anlas: true });
    const b = document.createElement('button'); b.id = 't-new'; b.className = 'btn'; b.textContent = '新按钮';
    document.querySelector('#view-create').prepend(b);
  });
  await page.waitForSelector('.guide-bubble', { timeout: 5000 });
  t = await page.textContent('.guide-bubble');
  ok(/这是新功能/.test(t) && /花 Anlas/.test(t), 'Help.add 加的提示会弹，带花 Anlas');
  await page.click('.guide-bubble [data-g="ok"]');
  await page.evaluate(() => {
    const b = document.createElement('button'); b.className = 'btn'; b.dataset.guide = '属性写的提示'; b.textContent = '属性按钮';
    b.insertAdjacentHTML('beforeend', Help.link('test.new'));
    document.querySelector('#view-create').prepend(b);
  });
  await page.waitForSelector('.guide-bubble', { timeout: 5000 });
  ok(/属性写的提示/.test(await page.textContent('.guide-bubble')), 'data-guide 属性的提示会弹');
  await page.click('.guide-bubble [data-g="ok"]');
  await page.click('[data-help-open="test.new"]');
  await page.waitForSelector('.help-item.flash');
  ok(await page.$eval('.help-item.flash', (e) => e.dataset.id) === 'test.new'
    && (await page.$$eval('.help-group', (els) => els.map((x) => x.textContent))).includes('新功能组'), 'Help.link 打开那一条，新分组也显示');

  // 重新显示全部 / 不再提示
  await page.click('[data-reset]');
  await sleep(300);
  st = await page.evaluate(() => Store.get('guide'));
  ok(st.seen.length === 0 && !st.off, '「重新显示全部提示」清空');
  await page.evaluate(() => window.__appBack());
  await page.waitForSelector('.guide-bubble', { timeout: 5000 });
  await page.click('.guide-bubble [data-g="off"]');
  await sleep(300);
  await page.reload();
  await page.waitForSelector('#c-write');
  await sleep(2600);
  ok(!(await page.$('.guide-bubble')), '「不再提示」后重开也不弹');
  await page.click('#btn-help');
  ok(!(await page.$eval('[data-on]', (e) => e.checked)), '说明页里开关显示关着');

  await browser.close();
  srv.close();
  if (fails.length) { console.log('\n失败 ' + fails.length + ' 项：\n' + fails.join('\n')); process.exit(1); }
  console.log('\n全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
