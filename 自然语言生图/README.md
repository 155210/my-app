# 自然语言生图（独立 App）

用中文描述画面 → 自己填的 AI 接口（OpenAI 兼容）写出 NovelAI 用的正面标签、英文描述、补充负面词、横竖画幅 → 可以手改 → 调 NovelAI 出图，自动存进 App 图库，可以存到手机相册。

请求格式、各模型默认质量词 / 负面词、写提示词的规范都参考「柏宝绘」（ST-BaiBai-Image）。柏宝绘原仓库没有许可证，这个 App 只自用，不公开发布。

## 下载 / 更新

推送到 `main` 且改动了 `自然语言生图/**` 时，Actions（`.github/workflows/自然语言生图.yml`）自动打包，
发到仓库 **Releases**，标签 `shengtu-<构建号>`，附件显示为「自然语言生图.apk」（实际文件名 NlImage.apk）。
PR 上也会打包，但只放在 Actions 的附件里，不发 Release。
签名固定（`自然语言生图.keystore`，密码 shengtu123），新版直接覆盖安装，设置和图库保留。

## 结构

```
自然语言生图/
├── build.gradle                包名 com.example.nlimage，版本号 = Actions 构建号
├── 自然语言生图.keystore
├── 测试/网页测试.js            无头浏览器测试（假 AI + 假 NAI），见下
├── 测试/备份更新测试.js        设置导出导入、检查更新（假 GitHub 接口）
├── 测试/队列测试.js            队列：多张、并发、429 重试、取消、失败重试、重绘
├── 测试/标签库测试.js          标签库的测试
├── 工具/做标签库.py            生成 依赖/标签.json（换数据源时才跑）；工具/标签补译.txt 是手动补的中文
└── src/main/
    ├── java/com/example/nlimage/   从自制AI问答机照搬的外壳
    │   ├── MainActivity.java     WebView 外壳，加载 assets/www/首页.html，JS 桥 AndroidBridge
    │   ├── NativeHttp.java       请求代发（无跨域限制、支持 http、流式逐块回传）
    │   ├── FileSaver.java        图片存进 相册/自然语言生图/，其他文件进 下载/自然语言生图/
    │   └── KeepAliveService.java 写提示词、出图期间开的前台服务，切后台不断
    └── assets/www/
        ├── 首页.html             页面骨架（顶栏 + 创作/图库 两个标签 + 浮层）
        ├── 样式.css
        ├── 桥接.js               fetch 走原生、保存文件、剪贴板、轻提示（同问答机）
        ├── 存储.js               IndexedDB：settings / draft / gallery / img:<id>
        ├── 接口.js               OpenAI 兼容接口：拉模型列表、对话（流式/非流式）（同问答机）
        ├── 参数.js               【出图参数】模型表（V5/V4.5/V4/V3）、默认质量词/负面词、采样器、尺寸预设、默认设置
        ├── 写词.js               【AI 流水线】内置规范、拼消息、解析 JSON、格式不对自动重试
        ├── 出图.js               【NAI】拼请求 body、解 zip、测试连接查 Anlas
        ├── 队列.js               【队列】并发数可调、429 限流自动等待重试、单张/全部取消、失败重试、队列面板、设置页「出图队列」
        ├── 图库.js               【图库数据】存图（可选转 JPG，默认关以保留 NAI 信息）、缩略图、配方、存相册、读图片里的 NAI 信息、图库偏好 galleryPrefs
        ├── 工具.js               共用界面小工具（浮层、对话框、列表选择、设置读写）
        ├── 页面-设置.js          设置页（AI 接口 / NAI 出图 / 提示词规范）
        ├── 风格.js               画风模板（前缀/后缀/负面，多套）：设置页的「画风模板」标签页
        ├── 快捷栏.js             创作页的模型/画风/尺寸/锁种子快捷栏（包一层 CreatePage，不改创作页文件）+ 顶栏 Anlas 余额
        ├── 页面-创作.js          创作页
        ├── 页面-图库.js          图库页（四档大小、长按菜单）、大图（左右滑、双指/双击缩放、长按保存、上滑配方）、完整配方、读取图片信息
        ├── 备份.js               设置导出 / 导入（设置页「备份」标签，图库不进备份）
        ├── 更新.js               检查更新：查 Releases 里最新 shengtu-N，和本机 1.0.N 比，交给浏览器下载
        ├── 标签库.js             【标签库】中英对照、搜索、点一下加进提示词；给 AI 参考标签、写完纠错
        ├── 依赖/标签.json        标签库数据（4 万多个，由 工具/做标签库.py 生成）
        └── 启动.js               启动、底部标签切换
```

### 扩展口（新功能尽量加新文件，少改现有文件）

- `Nai.addHook(fn)`：`fn(parameters, nai设置, 本次提示词)`，出图请求发出前改参数。多角色、Vibe 用它。
- `Writer.addContext(fn)`：`fn(设置, 中文描述)` 返回一段参考文字，附在发给 AI 的消息后面。角色库、标签库候选用它。
- `Writer.addFilter(fn)`：`fn(结果, 设置)` 返回改过的结果（`{tag, nl, negative, size}`），AI 回复解析成功后依次执行。标签库纠错用它。
- `TagLib`：`load()` 读数据，`fix(标签串)` 纠正写法，`canon(一个标签)`，`candidates(中文)` 找候选，`open()` 打开标签库页面。
- `SettingsPage.addTab({ id, label, html, acts })`：给设置页加一个标签页，表单项写 `data-k="路径"` 自动绑定保存。
- 新设置字段加在 `参数.js` 的 `DEFAULTS` 里，老用户打开时自动补上。
- 队列的设置（`nai.concurrency`、`nai.retry429`、`nai.maxRetries`）没进 `DEFAULTS`，默认值在 `队列.js` 的 `CFG_DEFAULTS`。
- `Queue.add(fn, { label, retry })`：排一张进队列；`label` 显示在队列面板，`retry` 是失败后点「重试」时调的函数。

## 图片里的出图信息

存进图库和相册的都是 NAI 回的原 PNG，里面带 NAI 写的出图信息（tEXt 的 `Comment` JSON，和透明通道最低位的隐写 `stealth_pngcomp`），能拖回 NovelAI 官网读出提示词。
图库「读取图片信息」两种都能读。转 JPG（图库选项里，默认关）会丢掉这些信息，App 里自己存的配方不受影响。

## 出图怎么拼

- 正面 = 画风模板前缀, AI 写的标签, 画风模板后缀, 质量词（设置里留空 = 模型默认）；4.5 / V5 且开了「英文描述」时再接 `. 英文描述`
- 负面 = 负面词（留空 = 模型默认）, 画风模板负面词, AI 补的负面词
- V3 不发 `v4_prompt`（只读 `input`，带 `sm` 等老字段）；V4 发 `v4_prompt` 但不接英文描述；V5 选了 DDIM 自动换 Euler Ancestral
- 出完一张 `出图.js` 发 `nai-drawn` 事件（快捷栏据此刷新 Anlas），`Nai.state.lastSeed` 是上一张的种子
- 请求：`POST {NAI 地址}/ai/generate-image`，返回 zip，取第一张图（有的第三方站直接回 PNG 也认）

## 测试

```
PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/网页测试.js
```

（`测试/队列测试.js` 同样的跑法。）

起本地静态服务、拦截假 AI 和假 NAI 接口，走一遍：设置 → 拉模型 → 写提示词（第一次故意回错格式，测自动重试）→ 自动出图 → 图库（读 PNG 文本 / 隐写里的 NAI 信息、PNG 转 JPG、四档大小、长按菜单、大图滑动/缩放/长按、完整配方、删除）→ 重开页面数据还在 → 返回键。

`测试/出图参数测试.js`（同样的运行方式）：V3/V4/V5 请求结构、尺寸预设和自定义、画风模板（新建、切换、旧画师串迁移）、快捷栏、锁定种子、Anlas 自动刷新。

## 标签库

数据 `依赖/标签.json`：`{"v":1,"tags":[[英文, 中文, 热度, 类别]...],"alias":{别名: 标签}}`，类别 0 通用 1 画师 3 作品 4 角色 5 元数据，按热度从高到低。
英文标签和热度来自 NAIWeaver 的 `Tags/high-frequency-tags-list.json`；中文先用 a1111-sd-webui-tagcomplete-CN（人工翻译），再用 BooruTagCart，都没有的通用标签在 `工具/标签补译.txt` 里手动补；角色、作品机翻不好的用 NAIWeaver 别名里的中/日文名；画师不翻译。

- 写提示词前：在中文描述里按最长匹配找标签库的中文词，把「中文=英文」最多 40 个附给 AI（设置 → 标签库 → 第一个开关）
- AI 写完：逐个标签对照标签库，别名换成正名、单复数/连字符/下划线/大小写统一、去重；带 `:` `{}` `[]` 的权重/画师写法和标签库里没有的原样保留（第二个开关）

## 本地调试

在 `src/main/assets/www` 起个静态服务器，浏览器打开 `首页.html`。没有 AndroidBridge 时网络/保存/剪贴板退回浏览器原生行为（接口要允许跨域）。

## 后续功能分组

见 `后续计划.md`。
