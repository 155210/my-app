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
├── 测试/角色系统测试.js        衣柜（穿脱、遮挡）、AI 一句话生成角色、写真模式
├── 测试/角色库测试.js          角色库：建档、名字换外貌、AI 自动建档/永久变化、全局角色、撤销
├── 测试/自定义提示词测试.js    破限词/规范/思维链、重型提示词（酒馆预设）的测试
├── 测试/计价测试.js          Anlas 预估（对实测数）、出图按钮上的数字、透明背景、Furry
├── 测试/批量测试.js          拆成多张、AI 重写（附要求）、创作页英文描述开关、批量页
├── 测试/提示词工具测试.js      联想、调权重、高亮、标签说明、通配符、预设
├── 工具/做标签说明.py          生成 依赖/标签说明.json
├── 测试/图库整理测试.js      收藏、相册、排序、文件名规则、导入外部图片并填回创作页、主题配色
├── 工具/做标签库.py            生成 依赖/标签.json（换数据源时才跑）；工具/标签补译.txt 是手动补的中文
└── src/main/
    ├── java/com/example/nlimage/   从自制AI问答机照搬的外壳
    │   ├── MainActivity.java     WebView 外壳，加载 assets/www/首页.html，JS 桥 AndroidBridge
    │   ├── NativeHttp.java       请求代发（无跨域限制、支持 http、流式逐块回传）
    │   ├── ApkUpdater.java     应用内更新：下载新版 APK、调起系统安装（FileProvider）
    │   ├── FileSaver.java        图片按保存位置存：隐藏文件夹 下载/自然语言生图/图片/（带 .nomedia，默认）/ 相册 / 自选文件夹（SAF）；其他文件进 下载/自然语言生图/
    │   └── KeepAliveService.java 写提示词、出图期间开的前台服务，切后台不断
    └── assets/www/
        ├── 首页.html             页面骨架（顶栏 + 创作/图库 两个标签 + 浮层）
        ├── 样式.css
        ├── 桥接.js               fetch 走原生、保存文件、剪贴板、轻提示（同问答机）
        ├── 存储.js               IndexedDB：settings / draft / gallery / img:<id>
        ├── 接口.js               OpenAI 兼容接口：拉模型列表、对话（流式/非流式）（同问答机）
        ├── 参数.js               【出图参数】模型表（V5/V4.5/V4/V3）、默认质量词/负面词、采样器、尺寸预设、默认设置
        ├── 写词.js               【AI 流水线】内置规范、拼消息、解析 JSON、格式不对自动重试；拆成多张（plan）、重写（rewrite）
        ├── 出图.js               【NAI】拼请求 body、解 zip、测试连接查 Anlas；V5 透明背景、Furry 模式
        ├── 计价.js               【Anlas 预估】官网同款算法：出图、图生图、精修、放大、图像工具；按钮上的花费标记
        ├── 队列.js               【队列】并发数可调、429 限流自动等待重试、单张/全部取消、失败重试、队列面板、设置页「出图队列」
        ├── 图库.js               【图库数据】存图（可选转 JPG，默认关以保留 NAI 信息）、缩略图、配方、存相册、读图片里的 NAI 信息、图库偏好 galleryPrefs（含排序 sort、文件名规则 nameRule / 计数 nameCounter）、收藏 fav、相册 galleryAlbums（图上只记相册 id，不动文件）
        ├── 工具.js               共用界面小工具（浮层、对话框、列表选择、设置读写）
        ├── 页面-设置.js          设置页（AI 接口 / NAI 出图）
        ├── 自定义提示词.js       【照搬柏宝绘】设置页「自定义提示词」（破限词、生图规范、思维链，可改可关）和「重型提示词」（导入酒馆预设，格式不对时重试用）
        ├── 风格.js               画风模板（前缀/后缀/负面，多套）：设置页的「画风模板」标签页
        ├── 多角色.js             【多角色】创作页「多角色」卡片：每个角色单独正面/负面、站位，进 char_captions（V4 起）
        ├── 角色参考.js           【角色参考】Director Reference（精准参考）：角色 / 画风 / 角色+画风，强度、保真度；只有 V4.5；开着时 Vibe 暂停；每张 +5 Anlas
        ├── 参考图.js             【画风参考】创作页「画风参考图」卡片：Vibe 强度、信息提取量，自动编码，导入导出 .naiv4vibe
        ├── 快捷栏.js             创作页的模型/画风/尺寸/锁种子快捷栏（包一层 CreatePage，不改创作页文件）+ 顶栏 Anlas 余额
        ├── 页面-创作.js          创作页（AI 写 / 拆多张 / 重写都走 runAi，输出实时显示；英文描述开关）
        ├── 规划.js               【拆成多张】AI 拆好的结果卡片：填到上面、出这张、全部出图（存 plan 键）
        ├── 页面-批量.js          【批量页】一行一条描述，挨个写提示词、写完一条出一条（存 batch 键）
        ├── 页面-图库.js          图库页（四档大小、长按菜单、多选批量保存/删除/收藏/进相册、保存位置、文件名规则、收藏和相册切换、排序、导入外部图片）、大图（左右滑、双指/双击缩放、长按保存、上滑配方）、完整配方、读取图片信息
        ├── 备份.js               设置导出 / 导入（设置页「备份」标签，图库不进备份）
        ├── 更新.js               检查更新：查 Releases 里最新 shengtu-N，和本机 1.0.N 比，外壳下载后调起安装
        ├── 标签库.js             【标签库】中英对照、搜索、点一下加进提示词；给 AI 参考标签、写完纠错
        ├── 主题.js               主题配色：8 套预设 + 自定义（背景/文字/强调色推出整套 CSS 变量），存 Store 'theme'，设置页「主题」
        ├── 图库角色.js           图库按角色筛选 / 搜索：从配方认出角色库的角色、Danbooru 角色和作品标签（中文名）
        ├── 角色库.js             【角色库】存固定外貌、名字换外貌标签、AI 自动建档和永久变化、全局角色（AI 不改）
        ├── 角色生成.js           【角色系统】AI 一句话生成角色外貌 + 初始衣柜（填进编辑页，保存才入库）
        ├── 衣柜.js               【角色系统】每个角色多套衣服、每件穿脱状态、里层被外层挡住不写（照 NAIWeaver 改写）
        ├── 写真.js               【角色系统】写真模式：选角色/衣服/表情/姿势/镜头/场景，不经 AI 直接出图
        ├── 依赖/标签.json        标签库数据（4 万多个，由 工具/做标签库.py 生成）
        ├── 标签说明.js           【标签说明】Danbooru Wiki，第一次看时用 AI 接口翻成中文并缓存（wikiZh 键），只显示中文
        ├── 依赖/标签说明.json    标签说明英文原文（2.2 万个，由 工具/做标签说明.py 生成）
        ├── 提示词编辑.js         【提示词格子】联想（中英文、通配符）、− ＋ 调权重、ⓘ 看说明、语法高亮
        ├── 通配符.js             【通配符】__名字__ 出图时随机换一行（设置 tags.wildcards，设置页「通配符」）
        ├── 参数预设.js           【预设】整套 NAI 参数 + 多角色 + 参考图开关强度，创作页顶上下拉切换（presets 键）
        └── 启动.js               启动、底部标签切换
```

### 扩展口（新功能尽量加新文件，少改现有文件）

- `Nai.addTagFilter(fn)`：`fn(画面标签串, nai设置, 本次提示词)` 返回新的标签串，拼正面之前执行（预览、配方里看到的也是改过的）。角色库用它把名字换成外貌。
- `Nai.addHook(fn)`：`fn(parameters, nai设置, 本次提示词, extra)`，出图请求发出前改参数，往 `extra` 里放的会记进配方。多角色、Vibe、角色库用它。
- `Writer.addContext(fn)`：`fn(设置, 中文描述)` 返回一段参考文字，附在发给 AI 的消息后面。角色库、标签库候选用它。
- `Writer.addMessages(fn)`：`fn(消息数组, 设置, { attempt, parseFailed })` 返回新的消息数组，发给 AI 前依次执行。破限词、思维链、重型提示词用它。`Writer.messagesFor()` 拿到实际要发的消息（预览用）。
- `Writer.addFilter(fn)`：`fn(结果, 设置)` 返回改过的结果（`{tag, nl, negative, size}`），AI 回复解析成功后依次执行。标签库纠错用它。
- `TagLib`：`load()` 读数据，`fix(标签串)` 纠正写法，`canon(一个标签)`，`candidates(中文)` 找候选，`open()` 打开标签库页面。
- `SettingsPage.addTab({ id, label, html, acts, after })`：给设置页加一个标签页（`after` 放在哪个标签后面，id 已有就替换），表单项写 `data-k="路径"` 自动绑定保存。
- 新设置字段加在 `参数.js` 的 `DEFAULTS` 里，老用户打开时自动补上。
- 队列的设置（`nai.concurrency`、`nai.retry429`、`nai.maxRetries`）没进 `DEFAULTS`，默认值在 `队列.js` 的 `CFG_DEFAULTS`。
- `Queue.add(fn, { label, retry })`：排一张进队列；`label` 显示在队列面板，`retry` 是失败后点「重试」时调的函数。
- `CreatePage.draw(p, 张数)` 返回每张一个 Promise（出好是图库那一项，校验没过返回 null）；`p.label` 是队列里显示的名字，`p.characters` 给了就不用创作页的多角色格子。
- `Writer.run({ plan: 张数 })`（0 = AI 定 2~6 张）返回 `{ images: [{ desc, tag, nl, negative, size }] }`；`Writer.run({ rewrite: { tag, nl, negative, hint } })` 照原画面重写。

## 多角色和画风参考图

- 角色列表存在 `charSlots` 键（像草稿一样跟着创作页走；以前存在 `characters`，和角色库撞键，打开时自动搬）：`[{ id, on, tag, negative, pos }]`，最多 6 个。出图时写进 `v4_prompt` / `v4_negative_prompt` 的 `char_captions`，另发一份 `characterPrompts`；1girl/1boy 换成 girl/boy；选了站位就开 `use_coords`。V3 忽略。配方记 `meta.characters`，「重绘」「用这套重画」按那张图的角色来。角色库的 `Nai.addHook` 会把角色格子里整项是角色名的换成外貌。
- 参考图索引在 `nai.vibes`（`{ id, name, on, strength, info }`），图和编码在 `vibe:<id>`（`{ image, thumb, enc: [{ key, info, data }] }`，进备份）。V5 官方没有 Vibe，V5 下不编码也不发。V4 起出图前（包了一层 `Nai.generate`）缺哪个模型 / 信息提取量的编码就调 `/ai/encode-vibe` 补上（官方每次扣 2 Anlas，同一张排了几张只编一次），放进 `reference_image_multiple_cached`；V3 直接发原图。配方记 `meta.vibes`。
- 摆位置：创作页「自己摆位置」打开后拖圆点，`pos = 'x,y'`（0–1）。V5 原样发（三位小数），V4/4.5 吸到 5×5 网格（0.1…0.9）。
- 互动存在 `charActs` 键 `[{ id, a, b, act, mutual }]`，出图时摊成 `source#动作` / `target#动作` / `mutual#动作` 放在角色提示词最前；快照 `meta.characters[].acts` 自带这些标签，`Characters.set` 会拆回互动表。
- 角色参考（`角色参考.js`）：索引 `nai.dirRefs`，图在 `dref:<id>`（已补黑边到 1024×1536 / 1536×1024 / 1472×1472 的 PNG）。发 `director_reference_images / _descriptions / _strength_values / _secondary_strength_values (= 1 - 保真度) / _information_extracted`；只在 V4.5 发；开着时 `参考图.js` 的 Vibe 不发也不编码（官网同样二选一）。配方记 `meta.dirRefs`。
- 花费：`参考图.js`、`角色参考.js` 各自 `Cost.addExtra` 注册（参考图首次编码 2、超过 4 张每张 +2；角色参考每张 +5），改了调 `Cost.refresh()`。`RefPick.pick()` 选图：手机或 App 图库。
- `Nai.addHook(fn)` 的 `fn` 有第 4 个参数 `extra`：往里放的东西合进这张图的 `meta`。

## 图片里的出图信息

存进图库和相册的都是 NAI 回的原 PNG，里面带 NAI 写的出图信息（tEXt 的 `Comment` JSON，和透明通道最低位的隐写 `stealth_pngcomp`），能拖回 NovelAI 官网读出提示词。
图库「读取图片信息」两种都能读。转 JPG（图库选项里，默认关）会丢掉这些信息，App 里自己存的配方不受影响。

## 出图怎么拼

- 正面 = 画风模板前缀, AI 写的标签, 画风模板后缀, 质量词（模板绑定的 → NAI 出图页的 → 模型默认，`Params.qualityOf`）；4.5 / V5 且开了「英文描述」时再接 `. 英文描述`
- 负面 = 负面提示词（模板绑定的 `uc` → NAI 出图页的 → 模型默认，`Params.negativeOf`）, 模板额外负面词 `negative`, AI 补的负面词
- V3 不发 `v4_prompt`（只读 `input`，带 `sm` 等老字段）；V4 发 `v4_prompt` 但不接英文描述；V5 选了 DDIM 自动换 Euler Ancestral
- 出完一张 `出图.js` 发 `nai-drawn` 事件（快捷栏据此刷新 Anlas），`Nai.state.lastSeed` 是上一张的种子
- 请求：`POST {NAI 地址}/ai/generate-image`，返回 zip，取第一张图（有的第三方站直接回 PNG 也认）

## Anlas 预估（计价.js）

算法照官网网页端（社区逆向，同 novelai-python 的 `_cost.py`）：一张 = ceil(2.951823174884865e-6×像素 + 5.753298233447344e-7×像素×步数)，V5 再 ×1.5，有底图 × 强度，最少 2，单张超过 140 官网拒绝。
Opus（查到订阅才知道，查不到按非 Opus 算并注明）：≤1024×1024、≤28 步免一张；V5 要 Opus 额度没透支。4 倍放大只收 ≤1024×1024 的图，1~4；图像工具按 V3 28 步、图缩放到 1~3 百万像素算，去背景 = 3×价+5 且不免。

- `Cost.estimate(nai, p, 张数)` → `{ total, perImage, once, free, parts, text, over }`；p 里 `size`（横竖）、`width/height`（直接给尺寸）、`img2img`/`image` + `strength`
- `Cost.image / enhance / upscale / tool` 返回数字（0 免费，-1 超限）；`Cost.label(n)`「免费 / 约 N Anlas」；`Cost.tag(按钮, n 或 estimate, 前缀)` 在按钮上挂小标记
- `Cost.addExtra(fn)`：`fn(nai, p)` 返回 `{ perImage, once, label }`，参考图、角色参考等注册自己的加价；`Cost.refresh()` 让按钮重算，`Cost.onRefresh(fn)` 订阅
- 快捷栏.js 给 出图、拆多张的「出这张 / 全部出图」、批量页「开始 / 写好的全部出图」（每张）挂标记；按钮悬停 / 长按看明细

## 透明背景、Furry 模式

快捷栏两个开关（存 `nai.transparent`、`nai.furry`）。透明背景只 V5：质量词前面加 `transparent background`，参数带 `tag_hint_transparent_background`、`straight_alpha`（同官网）；出的 PNG 背景透明，别开图库转 JPG。Furry：正面最前面加 `fur dataset`（V4 起，V3 不加）。配方记 `meta.transparent / furry`。

## 测试

```
PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/网页测试.js
```

（`测试/队列测试.js` 同样的跑法。）

起本地静态服务、拦截假 AI 和假 NAI 接口，走一遍：设置 → 拉模型 → 写提示词（第一次故意回错格式，测自动重试）→ 自动出图 → 图库（读 PNG 文本 / 隐写里的 NAI 信息、PNG 转 JPG、四档大小、长按菜单、大图滑动/缩放/长按、完整配方、删除）→ 重开页面数据还在 → 返回键。

`测试/图库整理测试.js`：排序四种、长按 / 多选 / 大图星星收藏、只看收藏、新建相册、一张进多个相册、移出、改名、删相册图还在、文件名规则和计数、导入外部图（带 / 不带 NAI 信息，原样不转 JPG）、一键填回创作页、主题切换 / 自定义颜色 / 重开还在 / 进备份。

`测试/多角色测试.js`：角色进 char_captions、站位、重绘按原角色、V3 忽略；参考图编码（只编一次、改提取量重编）、强度、V3 发原图、导出导入 .naiv4vibe、重开还在、删除连数据删。

`测试/出图参数测试.js`（同样的运行方式）：V3/V4/V5 请求结构、尺寸预设和自定义、画风模板（新建、切换、旧画师串迁移）、快捷栏、锁定种子、Anlas 自动刷新。

## 自定义提示词（照搬柏宝绘）

设置 → 「自定义提示词」：发给 AI 的顺序是 破限词 → 生图规范 → 思维链 → 中文描述（附标签库参考等）。
三份都能改、恢复默认，破限词和思维链能单独关掉；没改过就用内置（破限词是柏宝绘同款，思维链照柏宝绘的 NAI 思维链改成单张图版）。
规范和思维链里可以写 `{{#nl}}…{{/nl}}`（只在开了英文描述时保留）、`{{^nl}}…{{/nl}}`（关了时保留）。AI 的 `<thinking>` 块解析时自动去掉。
「格式不对自动重试次数」0~5，默认 1（存在 `prompts.retries`）。

设置 → 「重型提示词」：导入酒馆聊天补全预设 JSON。每次先发默认那套，AI 回的格式不对，剩下的重试改用预设拼的消息链，下次写提示词又从默认开始（同柏宝绘）。
按 `prompt_order`（优先 100001）排序和取开关；角色卡、世界书等标记条目不导入，「聊天记录」换成📌「自然语言生图提示词」，就是默认那整串消息；深度条目插进这串消息里；不在顺序里的条目收在「没在顺序里的条目」，不发送。
条目可开关、按住 ≡ 拖动排序、改名字/身份/位置/深度/顺序/内容、多选删除、新建；能预览实际发出的消息。酒馆宏（`{{user}}`=用户、`{{char}}`=AI、变量、随机等）照搬问答机 `预设.js`。

## AI 进阶 + 批量（照柏宝绘）

- **拆成多张**：创作页描述下面选「拆成 N 张 / AI 定张数」，按钮变「AI 拆成多张」。AI 回 `{"images":[...],"changes":[]}`，按描述里事情的先后拆成不同的瞬间，同一角色外貌、衣服保持一致；张数不对算格式不对，自动重试。changes 只按第一张执行一次。结果卡片每张可「填到上面」「出这张」，或「全部出图」（开了写完自动出图就直接全排进队列），每张按创作页选的「几张」出，带创作页的多角色。
- **AI 重写**：提示词卡片的「AI 重写」，可附一句要求（记住上次写的）。把当前 tag / nl / 负面当锚点发给 AI，画面不变只重写；附加要求优先级最高（同柏宝绘 slotPlan + rewriteHint）。这次 AI 回的 changes 丢掉。
- **英文描述开关**：创作页上也有一个，和设置里「生成英文自然语言描述」是同一个；V4 / V3 灰掉。
- **实时显示**：写、拆、重写时 AI 的输出都边写边显示在描述下面；批量页显示在正在写的那一条里。
- **批量页**（底部第二个标签）：一行一条描述，「开始」后 AI 挨个写，写完一条马上排进出图队列（关了「写完就出图」就停在「写好了」，之后点「写好的全部出图」）。每条可重新写、再出一次、填到创作页、删除；失败的可「重试失败的」（写失败重写、出图失败重出）。「停止」只停写提示词，已经排进队列的图在出图队列里取消。批量出图不带创作页的多角色格子。

## 标签库

数据 `依赖/标签.json`：`{"v":1,"tags":[[英文, 中文, 热度, 类别]...],"alias":{别名: 标签}}`，类别 0 通用 1 画师 3 作品 4 角色 5 元数据，按热度从高到低。
英文标签和热度来自 NAIWeaver 的 `Tags/high-frequency-tags-list.json`；中文先用 a1111-sd-webui-tagcomplete-CN（人工翻译），再用 BooruTagCart，都没有的通用标签在 `工具/标签补译.txt` 里手动补；角色、作品机翻不好的用 NAIWeaver 别名里的中/日文名；画师不翻译。

- 写提示词前：在中文描述里按最长匹配找标签库的中文词，把「中文=英文」最多 40 个附给 AI（设置 → 标签库 → 第一个开关）
- AI 写完：逐个标签对照标签库，别名换成正名、单复数/连字符/下划线/大小写统一、去重；带 `:` `{}` `[]` 的权重/画师写法和标签库里没有的原样保留（第二个开关）

## 提示词工具

- **联想**（`提示词编辑.js`）：给正面、负面、多角色、画风模板、质量词这些格子用。光标所在那一段（逗号之间）去掉权重写法后拿去 `TagLib.suggest` 联想，中文按中文名、英文按前缀 / 单词开头 / 包含，别名也算；点候选换掉那一段（保留权重），在最后一段时补 `, `。打 `__` 联想通配符名字。联想条用 pointerdown preventDefault 保住焦点（键盘不收）。
- **调权重**：联想条左边 − 数值 ＋。V4 起每下 ±0.1，写成 `1.1::标签::`，回到 1 就去掉；V3 写成 `{}` / `[]`（每层 1.05 倍）。认 `数字::…::`、`{{…}}`、`[…]` 三种写法。
- **高亮**：格子背后垫一层 `.pe-back`（复制格子的字体、内边距、边框宽），格子文字透明。每个格子的 `value` setter 被接管，程序改值也会重画。`PromptEdit.highlight(文本)` 是纯函数。
- **标签说明**（`标签说明.js`）：`TagWiki.open(标签)`。原文只在 `依赖/标签说明.json`，翻译走设置里的 AI 接口（非流式、温度 0.3），译文存 `wikiZh`，有「重新翻译」。入口：联想条的 ⓘ、标签库每行的 ⓘ。
- **通配符**（`通配符.js`）：`Wildcards.resolve(文本)`；最多套 5 层。画面标签走 `Nai.addTagFilter`（在角色库换外貌之前），负面和多角色走 `Nai.addHook`，配方里的 `positive` / `negative` 是换好的。
- **预设**（`参数预设.js`）：存 `nai` 里除 `url`、`key`、`styles` 以外的全部字段（以后加的字段自动带上）、参考图只记 `{id,on,strength,info}`、多角色格子。切换时预设里没有的参考图关掉。和现在不一样时显示「改过」。

## 角色库

数据存在 `Store` 的 `characters` 键（`{v:1, list:[...]}`），设置导出/导入自动带上。每个角色：名字、别名（逗号分隔，比如「我」）、全局角色开关、8 个外貌字段（同人身份 / 性别 / 头发 / 眼睛 / 肤色 / 体型 / 标志特征 / 固定着装，同柏宝绘）、备注、改动记录。

- 写提示词前（`Writer.addContext`）：告诉 AI 库里有哪些角色（全局的标出来）；描述里出现的角色（名字或别名）附上外貌标签，要求照抄
- AI 回的 JSON 可以多一个 `changes` 数组（格式同柏宝绘）：`{"name","field":"new","fields":{...}}` 建新角色；`{"name","field":"hair","to":"...","reason"}` 永久变化。全局角色一律不改；已有角色收到 `new` 只补空字段。开关在设置 → 角色库
- 名字换外貌（`Writer.addFilter` + `Nai.addTagFilter`，多角色的角色提示词用最后注册的 `Nai.addHook`）：逗号分隔的某一项整个是角色名/别名就换成外貌标签并去重。性别标签单独处理：提示词里已有人数标签（`2girls`、`3people`…）就不加，没有就按角色数合成（两个 1girl → `2girls`）
- 改动记录：每次改字段都记一条（最多 30 条），AI 改的可以点「撤销」
- 扩展口：`CharLib.addListAction({ label, run })` 角色库页面顶上加按钮；`CharLib.addEditorPart({ html(d, isNew), bind(box, d, 刷新预览, L) })` 编辑页里加一块（衣柜、AI 生成、写真入口用它）
- `CharLib`：`find(名字)`、`tagsOf(角色)`、`expand(标签串)`、`mentioned(中文描述)`、`applyChanges(changes)`、`open()`

## 衣柜、AI 生成角色、写真

- 衣柜存在角色上：`角色.wardrobe = { current, outfits: [{ id, name, items: { 部位: { tags, state } } }] }`。部位 10 个（outerwear 外套 / top 上衣 / dress 连衣裙 / bottom 下装 / bra / panties / legwear 袜子 / footwear 鞋 / headwear 头饰 / accessory 配饰），状态 intact 穿好 / unbuttoned / open / lifted / pulled_down / aside / around_ankles / removed（每个部位只允许合理的几种）。
- `Wardrobe.render(一套)` → `{ tags, nsfw, hidden, removed }`：上衣 / 连衣裙 / 合襟长外套穿好时胸罩、内裤不写；脱掉写 topless / bottomless / no bra / barefoot（穿着袜子不写 barefoot），上下都露合成 nude / completely nude；看得见的衣服不整齐时加 nsfw。
- `CharLib.tagsOf(角色)`：选了「正在穿」的那套就用它代替「固定着装」（固定着装仍接在后面），所以名字换外貌、发给 AI 的外貌都带衣服。
- AI 生成：设置里的 AI 接口，回 `{ name, alias, fields, outfits }`，格式不对自动重试一次。
- 写真：标签 = 外貌（含这次选的衣服和临时穿脱状态）, 表情, 姿势, 自定义姿势, 镜头, 场景, 自定义场景；走 `CreatePage.draw`（`characters: []`，不带创作页多角色格子），配方 desc 是「写真：名字」。选择存在 `photoshoot` 键。出图按钮用 `Cost.estimate` / `Cost.tag` 标 Anlas（没有 `window.Cost` 就不标）。

## 本地调试

在 `src/main/assets/www` 起个静态服务器，浏览器打开 `首页.html`。没有 AndroidBridge 时网络/保存/剪贴板退回浏览器原生行为（接口要允许跨域）。

## 后续功能分组

见 `后续计划.md`。
