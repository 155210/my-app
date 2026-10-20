// 复制实际发给 NAI 的正负面：创作页「实际发送」、图库配方；存进配方的请求不带图片数据
// 运行：PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/请求复制测试.js
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => fails.push('页面报错 ' + e.message));
  let reply = '';
  const bodies = [];
  await page.route('https://ai.test/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
  });
  await page.route('https://nai.test/**', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/user/subscription')) return r.fulfill({ status: 404, headers: CORS, body: '' });
    bodies.push(JSON.parse(req.postData()));
    return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PNG });
  });
  await page.goto('http://localhost:' + srv.address().port + '/' + encodeURIComponent('首页.html'));
  await page.waitForSelector('#c-write');
  await page.evaluate(() => {
    Object.assign(UI.settings.ai, { url: 'https://ai.test/v1', key: 'k', model: 'm', stream: false });
    Object.assign(UI.settings.nai, { url: 'https://nai.test', key: 'k' });
    UI.settings.autoDraw = true;
    UI.saveSettings(); CreatePage.refresh();
  });
  await page.evaluate(() => { window.__copied = []; UI.copyText = (t) => { window.__copied.push(t); }; });
  const last = () => page.evaluate(() => window.__copied[window.__copied.length - 1]);

  // 创作页「实际发送」
  await page.fill('#c-tag', '1girl, rooftop');
  await page.dispatchEvent('#c-tag', 'input');
  await page.click('#c-preview');
  await page.click('.sheet [data-a="copy"]');
  const pre = await last();
  ok(/^正面提示词：\n.*1girl, rooftop.*very aesthetic/.test(pre) && /\n\n负面提示词：\nlowres/.test(pre), '「实际发送」复制正负面（带画风、质量词，和发出去的一样）');
  ok(!/seed|steps|sampler|"/.test(pre), '只有正负面，没有参数');
  await page.click('.sheet [data-close]');

  // 出一张：配方里存了请求，大段 base64 被去掉
  const big = 'A'.repeat(5000);
  await page.evaluate((b) => Nai.addHook((params) => { params.reference_image_multiple_cached = [{ cache_secret_key: 'x', data: b }]; }), big);
  await page.click('#c-draw');
  await page.waitForSelector('#c-result img', { timeout: 8000 });
  ok(bodies.length === 1 && bodies[0].parameters.reference_image_multiple_cached[0].data === big, '实际发出去的请求带着原数据');
  const req = await page.evaluate(async () => (await Gallery.list())[0].meta.request);
  ok(req && req.input.includes('1girl, rooftop') && /图片数据已省略/.test(req.parameters.reference_image_multiple_cached[0].data), '配方里存了请求，图片数据换成说明');

  // 图库配方：复制发给 NAI 的内容
  await page.evaluate(async () => { GalleryPage.openRecipe((await Gallery.list())[0]); });
  await page.click('.sheet [data-a="req"]');
  const g = await last();
  ok(g === pre.replace(/\n\n角色[\s\S]*$/, '') && !g.includes(big), '图库配方「复制正负面」和发出去的一样');
  ok(!(await page.$eval('.sheet', (s) => s.textContent)).includes('"request"'), '配方的「其他参数」里不重复列请求');
  await page.evaluate(() => UI.$$('.sheet [data-close]').forEach((b) => b.click()));

  // 多角色：每个角色的正负面也带上
  const mc = await page.evaluate(() => Nai.promptText({}, { input: 'p', parameters: { negative_prompt: 'n', v4_prompt: { caption: { char_captions: [{ char_caption: 'girl, red hair' }, { char_caption: 'boy' }] } }, v4_negative_prompt: { caption: { char_captions: [{ char_caption: 'hat' }, { char_caption: '' }] } } } }));
  ok(mc === '正面提示词：\np\n\n负面提示词：\nn\n\n角色 1 正面：\ngirl, red hair\n角色 1 负面：\nhat\n\n角色 2 正面：\nboy', '分角色的正负面也带上');

  // 旧图没存请求
  await page.evaluate(() => { document.querySelectorAll('.sheet').forEach((s) => s.closest('.layer, .overlay, .mask') ? s.closest('.layer, .overlay, .mask').remove() : s.remove()); });
  await page.evaluate(() => GalleryPage.openRecipe({ id: 'old', time: Date.now(), tag: 'cat', meta: { positive: 'cat, best', negative: 'bad', model: 'nai-diffusion-4-full', seed: 3 } }));
  await page.click('.sheet [data-a="req"]');
  const o = await last();
  ok(o === '正面提示词：\ncat, best\n\n负面提示词：\nbad', '旧图（没存请求）也能复制正负面');

  await browser.close(); srv.close();
  console.log(fails.length ? '\n失败 ' + fails.length + ' 项：\n' + fails.join('\n') : '\n全部通过');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
