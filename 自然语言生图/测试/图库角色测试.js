// 图库按角色筛选 / 搜索：角色库名字、同人标签、Danbooru 角色和作品标签（中文名），筛选条、搜索框、大图只在筛选结果里滑
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/图库角色测试.js
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
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');
  await page.evaluate(() => CharLib.ready);

  // 角色库：原创角色「小雪」+ 同人角色「将军」（同人身份标签 raiden shogun）
  await page.evaluate(async () => {
    CharLib.create({ name: '小雪', alias: '雪酱', fields: { sex: '1girl', hair: 'long white hair' } });
    CharLib.create({ name: '将军', fields: { fandom: 'raiden shogun (genshin impact)', sex: '1girl' } });
    const c = document.createElement('canvas'); c.width = 32; c.height = 48;
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    const add = (desc, positive, chars) => Gallery.add(b, 'png', { desc, tag: positive, meta: { positive, width: 32, height: 48, characters: chars } });
    await add('雪酱在海边散步', '1girl, long white hair, beach, very aesthetic');
    await add('初音未来唱歌', '1girl, {hatsune_miku}, vocaloid, singing');
    await add('两个人', '2girls, park', [{ tag: 'girl, hatsune miku' }, { tag: 'girl, raiden shogun (genshin impact), purple hair' }]);
    await add('风景', 'no humans, mountain, scenery');
  });
  const det = await page.evaluate(async () => {
    const items = await Gallery.list();
    const m = await GalleryChars.index(items);
    return items.map((x) => [x.desc, m.get(x.id).map((c) => c.label + ':' + c.kind).sort().join(' ')]);
  });
  const by = Object.fromEntries(det);
  ok(by['雪酱在海边散步'] === '小雪:char', '别名写在描述里 → 认出角色库的「小雪」：' + by['雪酱在海边散步']);
  ok(by['初音未来唱歌'] === '初音未来:char 博歌樂:work', '权重写法 {hatsune_miku} 也认，作品单独列：' + by['初音未来唱歌']);
  ok(by['两个人'] === '初音未来:char 将军:char', '多角色里的标签也认；同人身份标签算到角色库「将军」名下：' + by['两个人']);
  ok(by['风景'] === '', '没角色的图什么都不列');
  // 标签库里没有的新角色（AI 写成「名字 (作品)」）
  const det2 = await page.evaluate(async () => {
    const items = [
      { id: 'a', desc: '', tag: '1girl, zzyzx girl (my original series), smile', meta: {} },
      { id: 'b', desc: '', tag: '1girl, hatsune miku (vocaloid)', meta: {} },
      { id: 'c', desc: '', tag: '1girl, bow (weapon), star (sky), shirt, canvas (medium), artist:hoshi (snacherubi), 0.8::artist:abc (def)::', meta: {} },
    ];
    const m = await GalleryChars.index(items);
    return items.map((x) => m.get(x.id).map((c) => c.label + ':' + c.kind).join(' '));
  });
  ok(det2[0] === 'zzyzx girl (my original series):char', '标签库里没有的新角色也列出来：' + det2[0]);
  ok(det2[1] === '初音未来:char', '「名字 (作品)」括号前对得上已有角色就算那个角色：' + det2[1]);
  ok(det2[2] === '', '弓 (武器)、canvas (medium)、artist:画师 这些都不算人物：' + det2[2]);

  // 界面：筛选条
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForSelector('#g-chips');
  const chips = await page.$$eval('#g-chips button', (b) => b.map((x) => x.textContent));
  ok(chips[0] === '全部4' && chips[1] === '初音未来2' && chips.includes('小雪1') && chips.includes('将军1') && chips[chips.length - 1] === '作品博歌樂1', '筛选条：角色按张数排前，作品在后：' + chips.join(' / '));
  await page.click('#g-chips button:nth-child(2)');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  ok((await page.textContent('.g-bar .card-sub')).includes('筛出 2 / 4'), '点「初音未来」只剩 2 张');
  await page.screenshot({ path: OUT + '/图库角色.png' });
  // 大图只在筛选结果里滑
  await page.click('.thumb:nth-child(1)');
  await page.waitForSelector('[data-count]');
  ok((await page.textContent('[data-count]')).replace(/\s/g, '') === '1/2', '大图里显示 1 / 2（只在筛出的图里换）');
  await page.evaluate(() => window.__appBack());
  await page.click('#g-chips button:nth-child(2)');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4);
  ok(true, '再点一次取消筛选');

  // 搜索：中文名、英文标签、描述、多个词
  const search = async (q, n, msg) => {
    await page.fill('#g-q', q);
    await page.waitForFunction((n) => document.querySelectorAll('.thumb').length === n, n, { timeout: 3000 }).catch(() => {});
    ok((await page.$$('.thumb')).length === n, msg + '（' + (await page.$$('.thumb')).length + ' 张）');
  };
  await search('将军', 1, '搜角色库名字「将军」');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'g-q'), '搜索时输入框不丢焦点');
  await search('初音', 2, '搜中文「初音」');
  await search('miku', 2, '搜英文「miku」');
  await search('雪', 1, '搜「雪」');
  await search('海边', 1, '搜描述里的字');
  await search('初音 唱歌', 1, '两个词都要命中');
  await search('不存在的角色', 0, '搜不到');
  ok(!!await page.$('.empty'), '搜不到时有提示');
  await search('', 4, '清空搜索');
  // 多选模式下全选只选筛出的
  await page.click('#g-chips button:nth-child(2)');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  await page.click('#g-sel');
  await page.click('#g-sel-all');
  ok(await page.textContent('#g-sel-n') === '已选 2 张', '筛选后多选「全选」只选筛出的 2 张');

  // 改中文名：长按筛选条上的名字
  await page.evaluate(() => window.__appBack()); // 退出多选
  await page.click('#g-chips button:nth-child(2)'); // 取消筛选
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4);
  const chip = await page.$('#g-chips button:nth-child(2)'); const cb = await chip.boundingBox();
  await page.mouse.move(cb.x + 10, cb.y + 5); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.waitForSelector('.dialog [data-zh]');
  ok((await page.textContent('.dialog p')).includes('hatsune miku'), '长按「初音未来」弹出改名框，显示英文标签');
  await page.fill('.dialog [data-zh]', '初音ミク');
  await page.click('.dialog [data-ok]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '初音ミク2'));
  ok(true, '筛选条马上换成新名字');
  ok((await page.$$('.thumb')).length === 4, '长按改名不会误点成筛选');
  ok(JSON.stringify(await page.evaluate(() => Store.get('tagZh'))) === '{"hatsune miku":"初音ミク"}', '改的名字存起来了');
  await page.fill('#g-q', 'ミク');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2, null, { timeout: 3000 }).catch(() => {});
  ok((await page.$$('.thumb')).length === 2, '用新名字能搜到');
  await page.fill('#g-q', '');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4);
  ok(await page.evaluate(() => TagLib.candidates('画一个初音ミク').some((c) => c[1] === 'hatsune miku')), '写提示词时的参考也认新名字');
  // 标签库里也是新名字，长按一行能恢复原译
  await page.evaluate(() => TagLib.open());
  await page.waitForSelector('.tg-row');
  await page.fill('.tg-q', 'hatsune miku');
  await page.waitForFunction(() => { const r = document.querySelector('.tg-row'); return r && r.dataset.t === 'hatsune miku'; });
  ok(await page.$eval('.tg-row .tg-zh', (z) => z.textContent === '初音ミク' && z.classList.contains('mine')), '标签库中文列显示改过的名字，有标记');
  const row = await page.$('.tg-row'); const rb = await row.boundingBox();
  await page.mouse.move(rb.x + 20, rb.y + 10); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.waitForSelector('.dialog [data-reset]');
  ok((await page.textContent('.dialog p')).includes('初音未来'), '改名框里显示原来的翻译');
  await page.click('.dialog [data-reset]');
  await page.waitForFunction(() => document.querySelector('.tg-row .tg-zh').textContent === '初音未来');
  ok(JSON.stringify(await page.evaluate(() => Store.get('tagZh'))) === '{}', '恢复原译后不再存');
  await page.evaluate(() => window.__appBack());
  // 重开后改的名字还在
  await page.evaluate(() => TagLib.setZh('vocaloid', 'VOCALOID'));
  await page.reload();
  await page.waitForSelector('#c-tag');
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '作品VOCALOID1'), null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '作品VOCALOID1')), '重开后改的名字还在');
  await page.screenshot({ path: OUT + '/改中文名.png' });

  // ---------- 全部标签列表、AI 翻成中文、给新人物起名 ----------
  let aiAsk = '';
  await page.route('https://ai.test/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    aiAsk = JSON.parse(r.request().postData()).messages.map((m) => m.content).join('\n');
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: '好的：{"zzyzx girl (my original series)": "兹兹女孩", "kafka (honkai: star rail)": "卡芙卡"}' } }] }) });
  });
  await page.evaluate(async () => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', model: 'm', key: 'x' }); UI.saveSettings();
    const c = document.createElement('canvas'); c.width = 32; c.height = 48;
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    await Gallery.add(b, 'png', { desc: '新人物', tag: '1girl, zzyzx girl (my original series), canvas (medium)', meta: { positive: '1girl, zzyzx girl (my original series), canvas (medium)' } });
    await Gallery.add(b, 'png', { desc: '星铁', tag: '1girl, kafka (honkai: star rail)', meta: { positive: '1girl, kafka (honkai: star rail)' } });
    await GalleryPage.refresh();
  });
  await page.waitForSelector('#g-chip-more');
  ok(!(await page.$$eval('#g-chips button', (b) => b.map((x) => x.textContent))).some((t) => t.includes('canvas')), '筛选条里没有 canvas (medium)');
  await page.click('#g-chip-more');
  await page.waitForSelector('.g-cp-body [data-key]');
  const groups = await page.$$eval('.g-cp-body .section-title', (x) => x.map((e) => e.textContent));
  ok(groups.length === 2 && groups[0].startsWith('人物') && groups[1].startsWith('作品'), '点「N 个 ▾」打开全部列表，分人物、作品：' + groups.join(' / '));
  await page.fill('.g-cp-q', 'zzyzx');
  ok((await page.$$('.g-cp-body [data-key]')).length === 1, '列表里能搜');
  await page.fill('.g-cp-q', '');
  ok((await page.textContent('[data-tr]')).includes('AI 翻成中文'), '有「AI 翻成中文」按钮：' + await page.textContent('[data-tr]'));
  // 先自己给一个起名，AI 不覆盖
  await page.evaluate(() => GalleryChars.setZh('kafka (honkai: star rail)', '我的卡芙卡', 'me'));
  await page.click('[data-tr]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent.startsWith('兹兹女孩')), null, { timeout: 5000 }).catch(() => {});
  const chips3 = await page.$$eval('#g-chips button', (b) => b.map((x) => x.textContent));
  ok(chips3.some((t) => t.startsWith('兹兹女孩')), 'AI 翻译后筛选条显示中文：' + chips3.join(' / '));
  ok(chips3.some((t) => t.startsWith('我的卡芙卡')) && !aiAsk.includes('kafka'), '自己起的名字不发给 AI、不被覆盖');
  ok(JSON.stringify(await page.evaluate(() => Store.get('charZh'))).includes('兹兹女孩'), '翻译结果存起来了');
  // 长按新人物改名
  const zz = await page.$('#g-chips button[data-key="tag:zzyzx girl (my original series)"]'); const zb = await zz.boundingBox();
  await page.mouse.move(zb.x + 10, zb.y + 5); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.waitForSelector('.dialog [data-v]');
  await page.fill('.dialog [data-v]', '小兹');
  await page.click('.dialog [data-ok]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent.startsWith('小兹')));
  ok(true, '标签库里没有的新人物也能长按改中文名');
  await page.click('#g-chip-more');
  await page.click('.g-cp-body [data-key="tag:zzyzx girl (my original series)"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 1);
  ok(true, '在列表里点一个 → 只看这个人物');
  await page.screenshot({ path: OUT + '/人物列表.png' });

  // ---------- 手动把图放进 / 移出人物标签 ----------
  await page.click('#g-chips button[data-key=""]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 6);
  const landId = await page.evaluate(async () => (await Gallery.list()).find((x) => x.desc === '风景').id);
  const lp = async (sel) => { const b = await (await page.$(sel)).boundingBox(); await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); };
  await lp('.thumb[data-id="' + landId + '"]');
  await page.click('.sheet .menu-item[data-k="chars"]');
  await page.waitForSelector('.g-cp-body [data-key]');
  ok(!(await page.$('.g-cp-body button.on')), '「风景」原来没有人物标签，列表里都不亮');
  await page.click('.g-cp-body [data-key="tag:hatsune miku"]');
  await page.waitForSelector('.g-cp-body button.on[data-key="tag:hatsune miku"]');
  ok(true, '点「初音未来」→ 这张放进去，按钮亮了');
  // 新起一个人物标签
  await page.click('.sheet [data-new]');
  await page.fill('.dialog [data-v]', '我的原创');
  await page.click('.dialog [data-ok]');
  await page.waitForSelector('.g-cp-body button.on[data-key="me:我的原创"]');
  ok(true, '新的人物标签也能起');
  await page.click('.sheet [data-close]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '我的原创1'));
  const miku = await page.$eval('#g-chips button[data-key="tag:hatsune miku"]', (b) => b.textContent);
  ok(miku.endsWith('3'), '筛选条上「初音未来」多了一张：' + miku);
  ok(await page.evaluate(async (id) => (await Gallery.list()).length === 6 && !!(await Gallery.getBlob(id)), landId), '图没有被移动或复制');
  // 多选：移出当前筛选的标签
  await page.click('#g-chips button[data-key="tag:hatsune miku"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 3);
  await page.click('#g-sel');
  await page.click('.thumb[data-id="' + landId + '"]');
  await page.click('#g-sel-more');
  await page.click('.sheet .menu-item[data-k="charOut"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  ok(true, '多选后「移出「初音未来」」，这张从这个标签里拿走');
  // 自动认出来的也能移出：多选两张放进「我的原创」
  await page.click('#g-chips button[data-key="me:我的原创"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 1);
  await page.click('#g-chips button[data-key=""]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 6);
  await page.click('#g-sel');
  await page.click('.thumb:nth-child(1)'); await page.click('.thumb:nth-child(2)');
  await page.click('#g-sel-more');
  await page.click('.sheet .menu-item[data-k="chars"]');
  await page.click('.g-cp-body [data-key="me:我的原创"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '我的原创3'), null, { timeout: 4000 }).catch(() => {});
  ok(await page.evaluate(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '我的原创3')), '多选两张一起放进标签');
  // 重开后还在
  await page.reload();
  await page.waitForSelector('#c-tag');
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '我的原创3'), null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => [...document.querySelectorAll('#g-chips button')].some((b) => b.textContent === '我的原创3')), '重开后手动放的标签还在');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
