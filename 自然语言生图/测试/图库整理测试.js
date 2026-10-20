// 图库整理：收藏、相册（不移动文件）、排序、文件名规则、导入外部图片并填回创作页；主题配色
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/图库整理测试.js
const { chromium } = require(process.env.PW || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', 'src', 'main', 'assets', 'www');
const OUT = process.env.OUT || require('os').tmpdir();

const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  const ext = path.extname(f);
  s.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(0);

// 造 PNG（可以带 tEXt）
function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, texts) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 120; raw[o + 2] = 60; } return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...Object.entries(texts || {}).map(([k, v]) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'utf8')]))), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-tag');

  // 四张图：时间、大小、描述都不一样
  await page.evaluate(async () => {
    await Gallery.setPrefs({ jpg: false });
    const mk = async (n) => { const c = document.createElement('canvas'); c.width = 16 * n; c.height = 24 * n; const g = c.getContext('2d'); for (let i = 0; i < 200 * n; i++) { g.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,50%)'; g.fillRect((i * 13) % c.width, (i * 7) % c.height, 3, 3); } return new Promise((r) => c.toBlob(r, 'image/png')); };
    const add = async (desc, tag, n, seed) => { const it = await Gallery.add(await mk(n), 'png', { desc, tag, meta: { positive: tag, seed, width: 16 * n, height: 24 * n } }); await new Promise((r) => setTimeout(r, 15)); return it; };
    await add('白猫', 'cat, white', 1, 11);
    await add('黄昏天台', '1girl, rooftop, sunset', 4, 22);
    await add('a 雨夜', 'night, rain', 2, 33);
    await add('海边', 'beach, sea', 3, 44);
  });
  await page.click('#tabbar [data-tab="gallery"]');
  await page.waitForSelector('#g-views');
  const descs = () => page.evaluate(async () => { const l = await Gallery.list(); return [...document.querySelectorAll('.thumb')].map((t) => l.find((x) => x.id === t.dataset.id).desc); });
  ok((await descs()).join() === '海边,a 雨夜,黄昏天台,白猫', '默认最新的在前');

  // ---------- 排序 ----------
  for (const [v, want, msg] of [['old', '白猫,黄昏天台,a 雨夜,海边', '最早的在前'], ['size', '黄昏天台,海边,a 雨夜,白猫', '按大小（大的在前）'], ['name', '白猫,海边,黄昏天台,a 雨夜', '按名称（中文按拼音）']]) {
    await page.selectOption('#g-sort', v);
    await page.waitForFunction((v) => document.querySelector('#g-sort').value === v, v);
    await page.waitForTimeout(80);
    const got = (await descs()).join();
    ok(got === want, '排序：' + msg + '：' + got);
  }
  ok((await page.evaluate(() => Gallery.getPrefs())).sort === 'name', '排序方式记住了');
  await page.selectOption('#g-sort', 'new'); await page.waitForTimeout(80);

  // ---------- 收藏 ----------
  const longPress = async (sel) => { const b = await (await page.$(sel)).boundingBox(); await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); };
  await longPress('.thumb:nth-child(2)'); // a 雨夜
  await page.click('.sheet .menu-item[data-k="fav"]');
  await page.waitForSelector('.thumb .fav-mark');
  ok((await page.$$('.thumb .fav-mark')).length === 1, '长按菜单收藏，缩略图上出现星星');
  // 多选批量收藏
  await page.click('#g-sel');
  await page.click('.thumb:nth-child(3)'); await page.click('.thumb:nth-child(4)');
  await page.click('#g-sel-more');
  await page.click('.sheet .menu-item[data-k="fav"]');
  await page.waitForFunction(() => !document.querySelector('.grid.selecting'));
  ok((await page.$$('.thumb .fav-mark')).length === 3, '多选后批量收藏');
  await page.click('#g-views [data-view="fav"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 3);
  ok((await page.textContent('#g-views [data-view="fav"]')).includes('3'), '「只看收藏」只剩 3 张，按钮上有数字');
  // 大图里的星星：取消收藏
  await page.click('.thumb:nth-child(1)');
  await page.waitForSelector('[data-fav].on');
  ok((await page.textContent('[data-count]')).replace(/\s/g, '') === '1/3', '在收藏里点开大图，只在收藏里滑');
  await page.click('[data-fav]');
  await page.waitForFunction(() => !document.querySelector('[data-fav].on'));
  ok(!(await page.evaluate(async () => (await Gallery.list()).find((x) => x.desc === 'a 雨夜').fav)), '大图右上角星星取消收藏');
  await page.evaluate(() => window.__appBack());
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  ok(true, '回到收藏页只剩 2 张');
  await page.click('#g-views [data-view=""]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4);

  // ---------- 相册 ----------
  await page.click('#g-views [data-view="+"]');
  await page.fill('.dialog [data-v]', '壁纸');
  await page.click('.dialog [data-ok]');
  await page.waitForFunction(() => document.querySelector('#g-views button.on') && document.querySelector('#g-views button.on').textContent.startsWith('壁纸'));
  ok(!!await page.$('.empty'), '新建相册后直接进到这个相册，空的有提示');
  await page.click('#g-views [data-view=""]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4);
  await longPress('.thumb:nth-child(1)'); // 海边
  await page.click('.sheet .menu-item[data-k="album"]');
  await page.click('.sheet .menu-item:has-text("壁纸")');
  await page.waitForTimeout(150);
  await page.click('#g-sel');
  await page.click('.thumb:nth-child(3)'); // 黄昏天台
  await page.click('#g-sel-more');
  await page.click('.sheet .menu-item[data-k="album"]');
  await page.click('.sheet .menu-item:has-text("新建相册")');
  await page.fill('.dialog [data-v]', '小雪');
  await page.click('.dialog [data-ok]');
  await page.waitForFunction(() => !document.querySelector('.grid.selecting'));
  const st1 = await page.evaluate(async () => ({ albums: (await Gallery.albums()).map((a) => a.name), n: (await Gallery.list()).length, map: Object.fromEntries((await Gallery.list()).map((x) => [x.desc, (x.albums || []).length])) }));
  ok(st1.albums.join() === '壁纸,小雪' && st1.n === 4 && st1.map['海边'] === 1 && st1.map['黄昏天台'] === 1, '两个相册，图还是 4 张没复制没移动：' + JSON.stringify(st1));
  const wall = await page.evaluate(async () => (await Gallery.albums()).find((a) => a.name === '壁纸').id);
  await page.click('#g-views [data-view="' + wall + '"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 1);
  ok(true, '点「壁纸」只看这个相册');
  // 一张图能在多个相册；从相册移出
  await page.evaluate(async (w) => { const it = (await Gallery.list()).find((x) => x.desc === '黄昏天台'); await Gallery.mark([it.id], { album: w, on: true }); await GalleryPage.refresh(); }, wall);
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  await page.click('#g-sel'); await page.click('.thumb:nth-child(2)');
  await page.click('#g-sel-more');
  await page.click('.sheet .menu-item[data-k="out"]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 1);
  ok((await page.evaluate(async () => (await Gallery.list()).find((x) => x.desc === '黄昏天台').albums.length)) === 1, '移出相册：只从这个相册拿走，另一个相册还在、图也在');
  // 长按相册：改名、删除
  await page.waitForTimeout(200);
  await longPress('#g-views [data-view="' + wall + '"]');
  await page.click('.sheet .menu-item[data-k="rename"]');
  await page.fill('.dialog [data-v]', '手机壁纸');
  await page.click('.dialog [data-ok]');
  await page.waitForFunction(() => [...document.querySelectorAll('#g-views button')].some((b) => b.textContent.startsWith('手机壁纸')));
  ok(true, '长按相册改名');
  await page.screenshot({ path: OUT + '/相册.png' });
  await longPress('#g-views [data-view="' + wall + '"]');
  await page.click('.sheet .menu-item[data-k="del"]');
  await page.click('.dialog [data-yes]');
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4);
  const st2 = await page.evaluate(async () => ({ albums: (await Gallery.albums()).map((a) => a.name), n: (await Gallery.list()).length, sea: (await Gallery.list()).find((x) => x.desc === '海边').albums }));
  ok(st2.albums.join() === '小雪' && st2.n === 4 && !st2.sea, '删除相册：图都还在，回到全部');

  // ---------- 文件名规则 ----------
  const names = await page.evaluate(async () => {
    const it = (await Gallery.list()).find((x) => x.desc === '黄昏天台');
    return [Gallery.fileName(it), Gallery.nameByRule(it, '{种子}_{提示词}_{计数}', 7), Gallery.nameByRule(it, '{描述}/{尺寸}:{日期}', 1), Gallery.nameByRule(it, '{种子}', 1)];
  });
  ok(/^生图_\d{8}_\d{6}\.png$/.test(names[0]), '默认文件名不变：' + names[0]);
  ok(names[1] === '22_1girl rooftop sunset_0007', '种子 + 提示词 + 计数：' + names[1]);
  ok(/^黄昏天台 64x96 \d{8}$/.test(names[2]), '不能当文件名的字符换掉：' + names[2]);
  await page.click('#g-opts');
  await page.waitForSelector('#g-rule');
  await page.fill('#g-rule', '');
  await page.click('.g-tokens [data-token="{种子}"]');
  await page.click('.g-tokens [data-token="{计数}"]');
  ok(await page.inputValue('#g-rule') === '{种子}_{计数}', '点格子插进规则：' + await page.inputValue('#g-rule'));
  ok((await page.textContent('#g-rule-eg')).includes('_0001.'), '下面有例子：' + await page.textContent('#g-rule-eg'));
  await page.waitForTimeout(400);
  await page.click('.sheet [data-close]');
  const dls = [];
  page.on('download', (d) => dls.push(d.suggestedFilename()));
  await page.click('#g-sel'); await page.click('.thumb:nth-child(2)'); await page.click('.thumb:nth-child(3)');
  await page.click('#g-sel-save');
  await page.waitForTimeout(800);
  ok(dls.sort().join() === '22_0002.png,33_0001.png', '保存到手机按规则起名、计数一张加一：' + dls.join());
  await page.evaluate(() => window.__appBack());
  ok((await page.evaluate(() => Gallery.getPrefs())).nameCounter === 2, '计数记住了');

  // ---------- 导入外部图片 ----------
  const naiPng = png(64, 96, { Software: 'NovelAI', Source: 'NovelAI Diffusion V4.5 4BDE2A90', Comment: JSON.stringify({ prompt: 'outside girl, red scarf, snow', uc: 'lowres, extra fingers', seed: 777, steps: 23, scale: 6, sampler: 'k_euler_ancestral', width: 64, height: 96 }) });
  const plainPng = png(80, 40);
  await page.click('#g-read');
  let chooser = page.waitForEvent('filechooser');
  await page.click('.sheet .menu-item[data-k="import"]');
  await (await chooser).setFiles([{ name: '官网图.png', mimeType: 'image/png', buffer: naiPng }, { name: '截图.png', mimeType: 'image/png', buffer: plainPng }]);
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 6);
  const imp = await page.evaluate(async () => { const l = await Gallery.list(); return l.filter((x) => x.imported).map((x) => ({ name: x.name, ext: x.ext, tag: x.tag, neg: x.extraNegative, meta: x.meta, origExt: x.origExt })); });
  const nai = imp.find((x) => x.name === '官网图.png'), plain = imp.find((x) => x.name === '截图.png');
  ok(imp.length === 2 && nai.ext === 'png' && !nai.origExt, '导入两张，原样保存不转 JPG');
  ok(nai && nai.tag === 'outside girl, red scarf, snow' && nai.meta.seed === 777 && nai.meta.steps === 23 && nai.meta.width === 64 && nai.neg.includes('extra fingers'), '带 NAI 信息的图：提示词、种子、步数都记进配方');
  ok(plain && plain.meta.width === 80 && !plain.tag, '普通图片也能导入，只记尺寸');
  ok(await page.evaluate(async () => !!(await Gallery.readInfo(await Gallery.getBlob((await Gallery.list()).find((x) => x.name === '官网图.png').id)))), '导入后原图里的信息还在');
  // 单张带信息 → 直接打开大图，一键「用这套重画」填回创作页
  chooser = page.waitForEvent('filechooser');
  await page.click('#g-read');
  await page.click('.sheet .menu-item[data-k="import"]');
  await (await chooser).setFiles([{ name: '又一张.png', mimeType: 'image/png', buffer: png(96, 64, { Software: 'NovelAI', Comment: JSON.stringify({ prompt: 'castle, night sky, stars', uc: 'blurry', seed: 31337, width: 96, height: 64 }) }) }]);
  await page.waitForSelector('.viewer [data-a="reuse"]');
  ok(true, '导入一张带信息的图，直接打开大图');
  await page.click('.viewer [data-a="reuse"]');
  await page.waitForFunction(() => document.querySelector('#c-tag').value.includes('castle'));
  const draft = await page.evaluate(() => CreatePage.draft);
  ok(draft.tag === 'castle, night sky, stars' && draft.negative.includes('blurry') && draft.size === 'landscape', '一键填回创作页：正面、负面、横竖都对');
  await page.screenshot({ path: OUT + '/导入后填回.png' });

  // ---------- 主题 ----------
  await page.evaluate(() => SettingsPage.open('theme'));
  await page.waitForSelector('.theme-card');
  ok((await page.$$('.theme-card')).length === 9, '8 套现成配色 + 自定义');
  ok(await page.$eval('.theme-card.on', (b) => b.dataset.theme) === 'dark', '默认是原来那套');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const bg0 = await bg();
  await page.click('.theme-card[data-theme="paper"]');
  await page.waitForFunction(() => document.querySelector('.theme-card.on').dataset.theme === 'paper');
  ok(await bg() === 'rgb(246, 244, 239)' && await page.evaluate(() => document.documentElement.dataset.theme) === 'light', '点「浅色纸张」立刻变浅色：' + await bg());
  await page.screenshot({ path: OUT + '/主题-浅色.png' });
  // 自己挑颜色
  await page.$eval('#theme-accent', (el) => { el.value = '#ff3366'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(150);
  const acc = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  ok(acc === '#ff3366', '改强调色立刻生效：' + acc);
  ok(await page.$eval('.theme-card.on', (b) => b.dataset.theme) === 'custom', '改颜色后切到「自定义」');
  const saved = await page.evaluate(() => Store.get('theme'));
  ok(saved.id === 'custom' && saved.custom.accent === '#ff3366' && saved.custom.bg === '#f6f4ef', '自定义从当前配色开始改，存起来了：' + JSON.stringify(saved));
  // 重开还是这个颜色
  await page.reload();
  await page.waitForSelector('#c-tag');
  ok(await bg() === 'rgb(246, 244, 239)' && await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) === '#ff3366', '重开 App 颜色还在');
  await page.click('#tabbar [data-tab="gallery"]'); await page.waitForSelector('.thumb');
  await page.screenshot({ path: OUT + '/主题-自定义图库.png' });
  // 备份里带着主题
  ok(await page.evaluate(async () => JSON.stringify(await Backup.build(false)).includes('ff3366')), '导出设置时主题一起带上');
  await page.evaluate(() => SettingsPage.open('theme'));
  await page.click('[data-act="theme-reset"]');
  await page.waitForTimeout(150);
  ok(await bg() === bg0, '恢复默认配色');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
