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
├── 测试/通知栏测试.js          通知栏进度：第几张 / 一共几张、排队、限流倒计时、出完提醒、取消、关掉提醒
├── 测试/标签库测试.js          标签库的测试
├── 测试/角色系统测试.js        衣柜（穿脱、遮挡）、AI 一句话生成角色、写真模式
├── 测试/角色库测试.js          角色库：建档、名字换外貌、AI 自动建档/永久变化、全局角色、撤销
├── 测试/自定义提示词测试.js    破限词/规范/思维链、重型提示词（酒馆预设）的测试
├── 测试/说明测试.js          新手提示、说明页、Help.add / data-guide、重新显示 / 不再提示
├── 测试/横竖测试.js          创作页横竖：「AI 定」按 AI 选的，点了竖图/横图就固定（草稿 sizeAuto）
├── 测试/请求复制测试.js      复制实际发给 NAI 的正负面（创作页「实际发送」、图库配方；配方存 meta.request，去掉图片数据）
├── 测试/计价测试.js          Anlas 预估（对实测数）、出图按钮上的数字、透明背景、Furry
├── 测试/批量测试.js          拆成多张、AI 重写（附要求）、创作页英文描述开关、批量页
├── 测试/对话改词测试.js      多轮对话改提示词：增删标签比较、挑着接受、没接受的告诉下一轮、记录保留
├── 测试/漫画测试.js          漫画模式：一页多格（分镜框走多角色）、几页、黑白/阅读顺序/对白、分镜一格一张
├── 测试/提示词工具测试.js      联想、调权重、高亮、标签说明、通配符、预设
├── 工具/做标签说明.py          生成 依赖/标签说明.json
├── 测试/打码测试.js          自动打码：YOLO 输出解析、四种样式只改框里、编辑页拖框/点框、另存、设置页、出图后自动打码（模型真跑一遍）
├── 工具/下载打码模型.py        下载 依赖/打码/ 里的模型和运行库（不进 git，Actions 打包前跑）
├── 测试/图库整理测试.js      收藏、相册、排序、文件名规则、导入外部图片并填回创作页、主题配色
├── 工具/做标签库.py            生成 依赖/标签.json（换数据源时才跑）；工具/标签补译.txt 是手动补的中文
└── src/main/
    ├── java/com/example/nlimage/   从自制AI问答机照搬的外壳
    │   ├── MainActivity.java     WebView 外壳，加载 assets/www/首页.html，JS 桥 AndroidBridge
    │   ├── NativeHttp.java       请求代发（无跨域限制、支持 http、流式逐块回传）
    │   ├── ApkUpdater.java     应用内更新：下载新版 APK、调起系统安装（FileProvider）
    │   ├── ShareHelper.java     分享：图片分块写进 cache/share/，经 FileProvider 交给系统分享面板
    │   ├── FileSaver.java        图片按保存位置存：隐藏文件夹 下载/自然语言生图/图片/（带 .nomedia，默认）/ 相册 / 自选文件夹（SAF）；其他文件进 下载/自然语言生图/
    │   └── KeepAliveService.java 写提示词、出图期间开的前台服务，切后台不断；常驻通知显示出图进度、「全部取消」，一轮出完 App 在后台时弹「出好了」
    └── assets/www/
        ├── 首页.html             页面骨架（顶栏 + 创作/图库 两个标签 + 浮层）
        ├── 样式.css
        ├── 桥接.js               fetch 走原生、保存文件、剪贴板、轻提示（同问答机）
        ├── 存储.js               IndexedDB：settings / draft / gallery / img:<id>
        ├── 接口.js               OpenAI 兼容接口：拉模型列表、对话（流式/非流式）（同问答机）
        ├── 参数.js               【出图参数】模型表（V5/V4.5/V4/V3）、默认质量词/负面词、采样器、尺寸预设、默认设置
        ├── 对话改词.js           【对话改提示词】多轮对话、每轮列出增删的标签、挑着接受（见「AI 进阶」）
        ├── 写词.js               【AI 流水线】内置规范、拼消息、解析 JSON、格式不对自动重试；拆成多张（plan）、重写（rewrite）
        ├── 出图.js               【NAI】拼请求 body、解 zip、测试连接查 Anlas；V5 透明背景、Furry 模式
        ├── 计价.js               【Anlas 预估】官网同款算法：出图、图生图、精修、放大、图像工具；按钮上的花费标记
        ├── 队列.js               【队列】并发数可调、429 限流自动等待重试、单张/全部取消、失败重试、队列面板、设置页「出图队列」
        ├── 通知栏进度.js         【通知栏】订阅 Queue.onChange / onFinish，调外壳 queueProgress / queueDone；设置 nai.doneNotify（出完提醒，默认开）
        ├── 图库.js               【图库数据】存图（可选转 JPG，默认关以保留 NAI 信息）、缩略图、配方、存相册、读图片里的 NAI 信息、图库偏好 galleryPrefs（含排序 sort、文件名规则 nameRule / 计数 nameCounter）、收藏 fav、相册 galleryAlbums（图上只记相册 id，不动文件）
        ├── 工具.js               共用界面小工具（浮层、对话框、列表选择、设置读写）
        ├── 说明.js               【说明】新手提示（按钮第一次出现时弹一句，看过存 guide 键）+ 顶栏「?」功能说明页
        ├── 说明-内容.js          现有功能的说明条目（新功能的说明写在自己文件里调 Help.add）
        ├── 页面-设置.js          设置页（AI 接口 / NAI 出图）
        ├── 自定义提示词.js       【照搬柏宝绘】设置页「自定义提示词」（破限词、生图规范、思维链，可改可关）和「重型提示词」（导入酒馆预设，格式不对时重试用）
        ├── 风格.js               画风模板（前缀/后缀/负面，多套）：设置页的「画风模板」标签页
        ├── 多角色.js             【多角色】创作页「多角色」卡片：每个角色单独正面/负面、站位，进 char_captions（V4 起）
        ├── 角色参考.js           【角色参考】Director Reference（精准参考）：角色 / 画风 / 角色+画风，强度、保真度；只有 V4.5；开着时 Vibe 暂停；每张 +5 Anlas
        ├── 参考图.js             【画风参考】创作页「画风参考图」卡片：Vibe 强度、信息提取量，自动编码，导入导出 .naiv4vibe
        ├── 快捷栏.js             创作页的模型/画风/尺寸/锁种子快捷栏（包一层 CreatePage，不改创作页文件）+ 顶栏 Anlas 余额
        ├── 页面-创作.js          创作页（AI 写 / 拆多张 / 重写都走 runAi，输出实时显示；英文描述开关）
        ├── 规划.js               【拆成多张】AI 拆好的结果卡片：填到上面、出这张、全部出图（存 plan 键）
        ├── 漫画.js               【漫画模式】「拆成多张」下拉里的「画成漫画（一页多格）」「分镜：一格一张」，结果卡片（存 comic 键）
        ├── 页面-批量.js          【批量页】一行一条描述，挨个写提示词、写完一条出一条（存 batch 键）
        ├── 页面-图库.js          图库页（四档大小、长按菜单、多选批量保存/删除/收藏/进相册、保存位置、文件名规则、收藏和相册切换、排序、导入外部图片）、大图（左右滑、双指/双击缩放、长按保存、上滑配方）、完整配方、读取图片信息
        ├── 备份.js               设置导出 / 导入（设置页「备份」标签，图库不进备份）
        ├── 更新.js               检查更新：查 Releases 里最新 shengtu-N，和本机 1.0.N 比，外壳下载后调起安装
        ├── 标签库.js             【标签库】中英对照、搜索、点一下加进提示词；给 AI 参考标签、写完纠错
        ├── 主题.js               主题配色：8 套预设 + 自定义（背景/文字/强调色推出整套 CSS 变量），存 Store 'theme'，设置页「主题」
        ├── 导出.js               【导出】保存 / 分享时图片信息保留、清除（PNG 文字块 + 隐写、JPG EXIF）、改写；分享（外壳 share* / navigator.share）
        ├── 图库日期.js           图库按日期筛选：今天、近 7 / 30 天、指定范围
        ├── 图库角色.js           图库按角色筛选 / 搜索：从配方认出角色库的角色、Danbooru 角色和作品标签（中文名）
        ├── 图生图.js             【图生图与编辑】编辑页（图生图 / 局部重绘涂遮罩 / 精修放大含 V5 MAX）、创作页「底图」卡片、编辑类花费预估
        ├── 图像工具.js           【图生图与编辑】官方 4 倍放大、6 个图像工具（去背景、线稿、草图、上色、换表情 24 种、去杂物）、前后对比滑块、大图快捷按钮
        ├── 角色库.js             【角色库】存固定外貌、名字换外貌标签、AI 自动建档和永久变化、全局角色（AI 不改）
        ├── 角色生成.js           【角色系统】AI 一句话生成角色外貌 + 初始衣柜（填进编辑页，保存才入库）
        ├── 衣柜.js               【角色系统】每个角色多套衣服、每件穿脱状态、里层被外层挡住不写（照 NAIWeaver 改写）
        ├── 写真.js               【角色系统】写真模式：选角色/衣服/表情/姿势/镜头/场景，不经 AI 直接出图
        ├── 依赖/标签.json        标签库数据（4 万多个，由 工具/做标签库.py 生成）
        ├── 标签说明.js           【标签说明】Danbooru Wiki，第一次看时用 AI 接口翻成中文并缓存（wikiZh 键），只显示中文
        ├── 依赖/标签说明.json    标签说明英文原文（2.2 万个，由 工具/做标签说明.py 生成）
        ├── 提示词编辑.js         【提示词格子】联想（中英文、通配符）、− ＋ 调权重、ⓘ 看说明、语法高亮
        ├── 通配符.js             【通配符】__名字__ 出图时随机换一行（设置 tags.wildcards，设置页「通配符」）
        ├── 多画布.js             【多画布】创作页顶上一排画布：每个存一套草稿 + 出图参数 + 多角色（canvases 键），点一下切换、＋新建、复制、改名、删除
        ├── token读数.js          【token 读数】负面词下面一行：实际发送的正负面、多角色各占多少 token；官网同款分词器（V5 qwen35 / V4 T5 / V3 CLIP）第一次用到时下载，存 tok:<种类>（不进备份）
        ├── 参数预设.js           【预设】整套 NAI 参数 + 多角色 + 参考图开关强度，创作页顶上下拉切换（presets 键）
        ├── 打码.js               【自动打码】手机上跑 YOLO 认敏感部位（onnxruntime-web），马赛克/模糊/黑条/白光，另存一张；设置页「打码」；出图后自动打码
        ├── 依赖/打码/            模型 + 运行库（不进 git，见下「自动打码」）
        └── 启动.js               启动、底部标签切换
```

### 扩展口（新功能尽量加新文件，少改现有文件）

- `Nai.addBodyHook(fn)`：`fn(body, nai设置, 本次提示词)`，改 parameters 以外的部分（`action`、`model`、`input`）。图生图 / 局部重绘用它。
- `GalleryPage.addViewerAction({ id, label, icon, show, decorate, run })`：大图下面第二排快捷按钮；`decorate(按钮, 图)` 用来挂花费。
- `Nai.addTagFilter(fn)`：`fn(画面标签串, nai设置, 本次提示词)` 返回新的标签串，拼正面之前执行（预览、配方里看到的也是改过的）。角色库用它把名字换成外貌。
- `Nai.addHook(fn)`：`fn(parameters, nai设置, 本次提示词, extra)`，出图请求发出前改参数，往 `extra` 里放的会记进配方。多角色、Vibe、角色库用它。
- `Writer.addContext(fn)`：`fn(设置, 中文描述)` 返回一段参考文字，附在发给 AI 的消息后面。角色库、标签库候选用它。
- `Writer.addMessages(fn)`：`fn(消息数组, 设置, { attempt, parseFailed })` 返回新的消息数组，发给 AI 前依次执行。破限词、思维链、重型提示词用它。`Writer.messagesFor()` 拿到实际要发的消息（预览用）。
- `Writer.addFilter(fn)`：`fn(结果, 设置)` 返回改过的结果（`{tag, nl, negative, size}`），AI 回复解析成功后依次执行。标签库纠错用它。
- `TagLib`：`load()` 读数据，`fix(标签串)` 纠正写法，`canon(一个标签)`，`candidates(中文)` 找候选，`open()` 打开标签库页面。
- `SettingsPage.addTab({ id, label, html, acts, after })`：给设置页加一个标签页（`after` 放在哪个标签后面，id 已有就替换），表单项写 `data-k="路径"` 自动绑定保存。
- **说明和新手提示**（每个新功能都要加）：`Help.add({ id, group, title, text, tip, target, anlas })`。`group` 是说明页分组（开始之前 / 创作页 / 批量页 / 图库 / 出图队列 / 设置 / 其他，写新名字就新建一组）；`text` 进说明页；`tip` + `target`（CSS 选择器）= 那个元素第一次出现在屏幕上时弹一句；会花 Anlas 的 `anlas: true` 或写一句怎么扣。只要提示不进说明页：元素上写 `data-guide="一句话"`（可加 `data-guide-id`、`data-guide-anlas`）。`Help.link(id)` 返回一个小「?」链接，`Help.open(id)` 打开说明页跳到那条。无头测试里默认不弹提示（`navigator.webdriver`），要测就先设 `window.GUIDE_FORCE = true`。
- 新设置字段加在 `参数.js` 的 `DEFAULTS` 里，老用户打开时自动补上。
- 队列的设置（`nai.concurrency`、`nai.retry429`、`nai.maxRetries`）没进 `DEFAULTS`，默认值在 `队列.js` 的 `CFG_DEFAULTS`。
- `Queue.add(fn, { label, retry })`：排一张进队列；`label` 显示在队列面板，`retry` 是失败后点「重试」时调的函数。
- `Queue.state()` 里还有这一轮的 `total / done / lost / cancelled / writing / current`；`Queue.onFinish(fn)` 这一轮全部结束（队列空、没在写提示词，停 1.5 秒确认）时调 `fn({ total, done, lost, cancelled })`。通知栏进度用它们。
- `CreatePage.draw(p, 张数)` 返回每张一个 Promise（出好是图库那一项，校验没过返回 null）；`p.label` 是队列里显示的名字，`p.characters` 给了就不用创作页的多角色格子。
- `Writer.run({ plan: 张数 })`（0 = AI 定 2~6 张）返回 `{ images: [{ desc, tag, nl, negative, size }] }`；`Writer.run({ rewrite: { tag, nl, negative, hint } })` 照原画面重写。
- `Writer.run({ task, parse })`：自带任务说明和解析（解析的结果原样返回加 `raw`，要过 `addFilter` 的扩展自己调 `Writer.applyFilters(结果, 设置)`）；`note` 附在任务说明后面（比如给拆多张加要求）。
- `CreatePage.addMode({ value, label, button, write(runAi, draft) })`：「拆成多张」下拉里多一项，选了按钮文字换成 `button`，点了调 `write`；`runAi(写法, 完成回调, 失败标题)` 就是创作页自己写 / 拆多张用的那个（边写边显示、停止）。漫画.js 用它。
- `Planner.show(描述, images, 标题)`：标题可选，`{n}` 换成张数。

## 多角色和画风参考图

- 角色列表存在 `charSlots` 键（像草稿一样跟着创作页走；以前存在 `characters`，和角色库撞键，打开时自动搬）：`[{ id, on, tag, negative, pos }]`，最多 6 个。出图时写进 `v4_prompt` / `v4_negative_prompt` 的 `char_captions`，另发一份 `characterPrompts`；1girl/1boy 换成 girl/boy；选了站位就开 `use_coords`。V3 忽略。配方记 `meta.characters`，「重绘」「用这套重画」按那张图的角色来。角色库的 `Nai.addHook` 会把角色格子里整项是角色名的换成外貌。
- 参考图索引在 `nai.vibes`（`{ id, name, on, strength, info }`），图和编码在 `vibe:<id>`（`{ image, thumb, enc: [{ key, info, data }] }`，进备份）。V5 官方没有 Vibe，V5 下不编码也不发。V4 起出图前（包了一层 `Nai.generate`）缺哪个模型 / 信息提取量的编码就调 `/ai/encode-vibe` 补上（官方每次扣 2 Anlas，同一张排了几张只编一次），放进 `reference_image_multiple_cached`；V3 直接发原图。配方记 `meta.vibes`。
- 摆位置：创作页「自己摆位置」打开后拖圆点，`pos = 'x,y'`（0–1）。V5 原样发（三位小数），V4/4.5 吸到 5×5 网格（0.1…0.9）。
- 互动存在 `charActs` 键 `[{ id, a, b, act, mutual }]`，出图时摊成 `source#动作` / `target#动作` / `mutual#动作` 放在角色提示词最前；快照 `meta.characters[].acts` 自带这些标签，`Characters.set` 会拆回互动表。
- 角色参考（`角色参考.js`）：索引 `nai.dirRefs`，图在 `dref:<id>`（已补黑边到 1024×1536 / 1536×1024 / 1472×1472 的 PNG）。发 `director_reference_images / _descriptions / _strength_values / _secondary_strength_values (= 1 - 保真度) / _information_extracted`；只在 V4.5 发；开着时 `参考图.js` 的 Vibe 不发也不编码（官网同样二选一）。配方记 `meta.dirRefs`。
- 花费：`参考图.js`、`角色参考.js` 各自 `Cost.addExtra` 注册（参考图首次编码 2、超过 4 张每张 +2；角色参考每张 +5），改了调 `Cost.refresh()`。`RefPick.pick()` 选图：手机或 App 图库。
- `Nai.addHook(fn)` 的 `fn` 有第 4 个参数 `extra`：往里放的东西合进这张图的 `meta`。

## 图生图与编辑

- 入口：大图下面第二排「编辑 / 精修 / 放大 / 去背景 / 工具」，每个按钮下面小字是预估 Anlas；处理出来的图多一个「对比原图」。「工具」里是全部 10 项（图生图、局部重绘、精修、放大、6 个图像工具），每行右边标花费。
- 编辑页（`ImgEdit.openEditor(图, 'img2img'|'infill'|'enhance')`）：
  - 图生图：`action: 'img2img'`，`parameters.image` = 原图按原尺寸（64 的倍数、不超过 314 万像素）转 PNG，`strength`（默认 0.7）、`noise`、`extra_noise_seed` = 种子。提示词可改，照常拼画风、质量词。
  - 局部重绘：手指涂（涂 / 擦 / 笔刷大小 / 撤销 / 清空），遮罩按 8×8 格对齐、黑底白涂；`action: 'infill'`，模型换成 `xxx-inpainting`（V5 Curated 借 `nai-diffusion-4-5-curated-inpainting`，同官网），`strength` 默认 1。
  - 精修：原图放大 1 / 1.5 / 2 倍（不超上限的才给选）再图生图，强度默认 0.5；照原图配方里实际发送的正负面原样发（`i2i.raw`），不套画风参考。V5 多一个 MAX：按原尺寸发 + `upscaled_enhance: true`，服务器放大。
- 编辑页（图生图 / 局部重绘）上面有中文描述框和「AI 写提示词」「AI 重写」，走 `Writer.run`（自定义提示词、角色库、标签库纠错都生效）。局部重绘写的是「涂掉的地方要画成什么」，用重写模式：原图提示词当锚点 + `infillNote` 要求只改涂的那块。编辑页有自己的画风模板下拉（`n.styleId` 只改这次）。
- 局部重绘贴回原图（`composite`）：NAI 回的整张过了一遍编码解码、遮罩是 8×8 方块，直接用会有一圈硬边、清晰度对不上。所以结果按遮罩（羽化「边缘过渡」像素，`i2i.feather`，-1 = 不处理）贴回原图原尺寸，没涂的地方一个像素不变。
  原图本身糊时两个可选项（默认关）：「画之前先把整张图变清晰」= 先 `enhanceItem` 精修 1.5 倍再在结果上重绘（整张会变，真人照片不建议）；「画完再整体精修一遍」默认「只融合重画那块周围」（精修结果只按放宽的遮罩贴回，脸等远处不动）。花费按钮上是几步加起来的。
- 画风模板有内置的「空白（不加任何词）」（`Params.BLANK_STYLE`，`blank: true`）：质量词、负面提示词也不回落到默认，全空。老用户打开时自动补一次（`nai.blankAdded`）。
- 创作页「底图」卡片：从图库挑一张，开着时「出图」就变成图生图（按底图尺寸，竖图/横图不管用），存在 `i2iBase` 键；「涂要重画的地方」涂了遮罩（存 `i2iMask` 键）就变成局部重绘；排队时只记 id（`p.i2iRef`），真出图前才读图。图生图出的图点「重绘」照原底图再来。
- 放大：`POST /ai/upscale { image, width, height, scale }`，4 倍超过每边 4096 就 2 倍；官方站走 `api.novelai.net`，不行再试 `image.novelai.net`。
- 图像工具：`POST /ai/augment-image { req_type, width, height, image, prompt?, defry? }`。换表情 prompt = `表情;;补充`，上色 prompt = 颜色说明，`defry` 0~5（越大越接近原图）。
- 结果都存进图库，配方 `meta.edit = { kind, label, from, strength, … }`；做完自动打开前后对比（左右拖分界线），`from` 那张还在时大图有「对比原图」。
- 花费：有 `window.Cost`（计价.js）就用它的 `enhance / upscale / tool / label / tag`，没有就用 `ImgEdit.Price` 的兜底公式（同 NAIWeaver 的 nai_cost_estimator；放大、图像工具的价目是估的）。
- 测试：`测试/图生图测试.js`（`SHOT=目录` 时顺便截图）。

## 自动打码

- 全在手机上算，不联网、不花 Anlas。入口：大图下面「打码」；设置页「打码」标签；设置里打开「出图后自动打码」后每出一张新图（`meta.edit` 为空、不是导入的）就认一遍，认出来就另存一张（包了一层 `Gallery.add`）。
- 模型（`依赖/打码/`，`.gitignore` 掉了，Actions 里 `工具/下载打码模型.py` 下载并缓存；本地测试跑 `python3 工具/下载打码模型.py --skip-missing`，沙箱里 HuggingFace 不通就只有写实模型）：
  - `动漫.onnx`：deepghs/anime_censor_detection（MIT，`censor_detect_v1.0_s`，640）：nipple_f / penis / pussy。输入直接拉伸到 imgsz（同 imgutils）。
  - `写实.onnx`：NudeNet 3.4 的 320n（MIT，320）：多认肛门、臀部、整个露出的胸部。输入在右下补黑成正方形再缩（同 NudeNet）。
  - `*.json`：`{ name, imgsz: [宽, 高], labels, pad, threshold? }`，imgsz / labels 从模型元数据读。
  - `ort.js` / `ort.wasm`：onnxruntime-web 1.18.0 的 `ort.wasm-core.min.js` + `ort-wasm-simd.wasm`（IR 10 的模型要 ≥1.18；1.19 起换成 .mjs，WebViewAssetLoader 给不出 JS 的 MIME，所以停在 1.18）。wasm 自己 fetch 成 ArrayBuffer 交给 `ort.env.wasm.wasmBinary`，单线程（WebView 没有跨源隔离）。
- 两个模型输出都是 YOLOv8 的 `[1, 4+类别数, 框数]`，`Censor.parse` 取最高分类别 → 部位（`LABEL_PART`）→ 阈值（设置「灵敏度」，默认 0.30）→ 同部位 NMS 0.45。「两个都用」两次结果合并再 NMS。
- 打码（`Censor.render`）：框按「扩大范围」% 往外扩，方形 / 圆形裁剪；马赛克先把整张缩小再放大（格子全图对齐），模糊整张 blur 两遍再按框贴，黑条 / 白光直接填。框外一个像素不动。
- 结果存 PNG，配方照原图抄、`meta.edit = { kind: 'censor', label: '打码', from, style, n, auto? }`，有「对比原图」。编辑页里选的样式 / 形状 / 力度 / 范围记成默认。
- 设置在 `settings.nai.censor`（默认值在 `打码.js` 的 `CFG_DEFAULTS`）：`{ model, style, shape, strength, expand, threshold, auto, parts: { nipple, breast, pussy, penis, anus, butt } }`。
- 测试：`测试/打码测试.js`。

## 图片里的出图信息

存进图库和相册的都是 NAI 回的原 PNG，里面带 NAI 写的出图信息（tEXt 的 `Comment` JSON，和透明通道最低位的隐写 `stealth_pngcomp`），能拖回 NovelAI 官网读出提示词。
图库「读取图片信息」两种都能读。转 JPG（图库选项里，默认关）会丢掉这些信息，App 里自己存的配方不受影响。

导出时（保存到手机、分享）可以处理这些信息（`导出.js`，设置存 `galleryPrefs.exportInfo`：keep 默认 / strip / ask）：
- 清除：PNG 去掉 tEXt / zTXt / iTXt / eXIf / tIME 块（逐块重拼，不重新压缩）；还读得出隐写就重画一遍，透明度最低位都改成 1（全透明的不动），颜色不变。JPG 去掉 APP1（EXIF/XMP）、APP3~13、APP15、注释，留 JFIF / ICC / Adobe。其他格式重新编码。
- 改写（单张）：先清除，再在 IHDR 后面写 Title / Description / Software / Source / Comment（Comment 是 NAI 格式 JSON，`prompt` / `uc` / `seed`，勾「保留其他参数」时用原 Comment 里的其余参数并同步 V4 的 base_caption）。不是 PNG 的存成 PNG。
- 分享：外壳 `shareBegin / shareChunk / shareEnd / shareSend`（`ShareHelper.java`，文件写进 cache/share/ 经 FileProvider 给系统分享面板，一小时前的旧文件顺手删）；浏览器里用 navigator.share，不支持就下载。
- 入口：大图「分享」、长按菜单「分享」「导出（处理图片信息）…」、多选栏分享按钮和「收藏 / 相册」菜单里的「导出」。App 里的原图不动。

图库按日期筛选（`图库日期.js`）：排序旁边的日期按钮，今天 / 近 7 天 / 近 30 天（含今天，按本地日期整天算）/ 指定日期范围（可只填一头，截止那天整天算），和收藏、相册、人物、搜索叠加，不存。

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

`测试/导出与日期测试.js`：日期筛选（今天、近 7/30 天、指定范围、只填一头、跨天边界、和收藏叠加）；清除 PNG 文本 / 隐写 / JPG EXIF（画面不变、CRC 对）；改写（保留 / 不保留参数、V4 base_caption）；设成清除后保存、每次问弹选择并改写保存、假外壳分享单张 / 多张。

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
- **对话改提示词**（`对话改词.js`）：提示词卡片「对话改」打开整页，一轮说一句要求，走 `Writer.run({ rewrite: { …, hint: 这轮要求, history } })`。回来的 tag / 负面按逗号拆开比（去权重、大小写、下划线），分「加上 / 去掉 / 改写法·权重」三组标签片，英文描述变了单独一个勾；点片切换要不要，「接受选中」用 `applyPicks` 改到现在框里的（中途手改过也不丢；全接受且没手改就原样用 AI 那版），走 `CreatePage.reuse(…, true)`。`rewriteNote` 的 `history` = 前几轮要求 + 用户没接受的改动（最多 8 轮），叫 AI 别改回去。没处理就发下一句，上一轮算「没要」。记录存 `promptChat` 键（最多 30 轮）。
- **英文描述开关**：创作页上也有一个，和设置里「生成英文自然语言描述」是同一个；V4 / V3 灰掉。
- **实时显示**：写、拆、重写时 AI 的输出都边写边显示在描述下面；批量页显示在正在写的那一条里。
- **批量页**（底部第二个标签）：一行一条描述，「开始」后 AI 挨个写，写完一条马上排进出图队列（关了「写完就出图」就停在「写好了」，之后点「写好的全部出图」）。每条可重新写、再出一次、填到创作页、删除；失败的可「重试失败的」（写失败重写、出图失败重出）。「停止」只停写提示词，已经排进队列的图在出图队列里取消。批量出图不带创作页的多角色格子。

## 漫画模式

分镜规则参考 Plana-App 的漫画模式（它的预设是 GPL，这里是照意思自己写的说明，没抄原文）。创作页「拆成多张」下拉里多两项：

- **画成漫画（一页多格）**：一张图 = 一整页漫画。选项：每页几格（AI 定 = 一般 3～5 格）、几页（多页就是把剧情拆成几页，下一页接上一页）、版式（AI 定 / 竖着一列 / 两列网格 / 一大格 + 小格）、黑白、从右往左读、对白气泡。
  AI 回 `{"pages":[{ desc, tag, layout, negative, size, boxes:[{ name, desc, prompt, negative }] }]}`：`tag` 只写整页的人数（按不同的人去重，不写 solo）+ `comic`（黑白加 `monochrome, greyscale`）；`layout` 是版式句（总格数、每行怎么排、阅读顺序）；`boxes` 是分镜内容框——一格里一个看得见的人一个框，只有手 / 道具 / 空镜的格子一个框，`prompt` 一律 `In the <格子位置大小> panel, <景别机位>: <这格看得见的>`，按阅读顺序，最多 6 个（超了算格式不对，自动重试）。
  出图：`tag + layout` 进主正面，`boxes` 当多角色的角色提示词发（`p.characters`，不摆位置，不动创作页的多角色格子）；V3 没有角色提示词就全拼进正面。要对白气泡时这一页去掉质量词里的 `no text`（`Nai.addBodyHook`，看 `p.comicText`）。
  结果卡片 `#c-comic-box`：每页「填到上面」（版式进正面、框进多角色格子）、「出这页」，或「全部出图」。标签库纠错、角色库建档照常（建档只跟第一页）。
- **分镜：一格一张**：走拆成多张（`Writer.run({ plan, note })`），附上分镜要求（第一格交代场景、景别轮换、持物延续，黑白时每张加 monochrome）；结果在拆多张的卡片里，标题「分镜 N 格（一格一张）」。

## 标签库

数据 `依赖/标签.json`：`{"v":1,"tags":[[英文, 中文, 热度, 类别]...],"alias":{别名: 标签}}`，类别 0 通用 1 画师 3 作品 4 角色 5 元数据，按热度从高到低。
英文标签和热度来自 NAIWeaver 的 `Tags/high-frequency-tags-list.json`；中文先用 a1111-sd-webui-tagcomplete-CN（人工翻译），再用 BooruTagCart，都没有的通用标签在 `工具/标签补译.txt` 里手动补；角色、作品机翻不好的用 NAIWeaver 别名里的中/日文名；画师不翻译。

- 写提示词前：在中文描述里按最长匹配找标签库的中文词，把「中文=英文」最多 40 个附给 AI（设置 → 标签库 → 第一个开关）
- AI 写完：逐个标签对照标签库，别名换成正名、单复数/连字符/下划线/大小写统一、去重；带 `:` `{}` `[]` 的权重/画师写法和标签库里没有的原样保留（第二个开关）

## 提示词工具

- **联想**（`提示词编辑.js`）：给正面、负面、多角色、画风模板、质量词这些格子用。光标所在那一段（逗号之间）去掉权重写法后拿去 `TagLib.suggest` 联想，中文按中文名、英文按前缀 / 单词开头 / 包含，别名也算；点候选换掉那一段（保留权重），在最后一段时补 `, `。打 `__` 联想通配符名字。单行框也接：多角色互动动作（只填一个标签，不补逗号，选完发 change）、写真自己补的姿势/场景、衣柜每件衣服、表情/上色提示词、角色库外貌各栏；图生图「编辑这张图」、通配符每一行也接。单行框只联想和调权重，不垫高亮，联想条放在所在 `.row` 下面。新格子加 `data-tags` 属性就会自动接上（名单是 `PromptEdit.SEL`）。中文联想也查标签库以外的中文名：图库给人物 / 作品起的（`GalleryChars.zhAll()`，Store `charZh`）、角色库角色的名字和别名（换成它的同人身份标签）。联想条用 pointerdown preventDefault 保住焦点（键盘不收）。
- **调权重**：联想条左边 − 数值 ＋。V4 起每下 ±0.1，写成 `1.1::标签::`，回到 1 就去掉；V3 写成 `{}` / `[]`（每层 1.05 倍）。认 `数字::…::`、`{{…}}`、`[…]` 三种写法。
- **高亮**：格子背后垫一层 `.pe-back`（复制格子的字体、内边距、边框宽），格子文字透明。每个格子的 `value` setter 被接管，程序改值也会重画。`PromptEdit.highlight(文本)` 是纯函数。
- **标签说明**（`标签说明.js`）：`TagWiki.open(标签)`。原文只在 `依赖/标签说明.json`，翻译走设置里的 AI 接口（非流式、温度 0.3），译文存 `wikiZh`，有「重新翻译」。入口：联想条的 ⓘ、标签库每行的 ⓘ。
- **通配符**（`通配符.js`）：`Wildcards.resolve(文本)`；最多套 5 层。画面标签走 `Nai.addTagFilter`（在角色库换外貌之前），负面和多角色走 `Nai.addHook`，配方里的 `positive` / `negative` 是换好的。
- **预设**（`参数预设.js`）：存 `nai` 里除 `url`、`key`、`styles` 以外的全部字段（以后加的字段自动带上）、参考图只记 `{id,on,strength,info}`、多角色格子。切换时预设里没有的参考图关掉。和现在不一样时显示「改过」。

## 多画布、token 读数

- **多画布**（`多画布.js`）：`canvases` 键 `{ list: [{ id, name, draft, snap, preset, time }], cur }`。`draft` 是创作页草稿整份（以后加进草稿的字段自动跟着走），`snap` 是 `Presets.snapshot()`（NAI 参数 + 多角色 + 参考图开关），`preset` 是当时预设下拉选的哪个。正在用的画布以创作页现在的样子为准，切走时才 `capture`；切过去用 `CreatePage.setDraft(草稿)` + `Presets.apply(快照, 预设id)`（第二个参数给了就不把预设下拉改成快照）。AI 正在写时不让切。最多 20 个。测试：`测试/画布token测试.js`。
- **token 读数**（`token读数.js`）：数 `Nai.buildBody` 拼出来的 `meta.positive / negative` 和 `char_captions`，权重写法（`1.2::`、`::`、`{}`、`[]`）先去掉。分词器按模型：V5 → `qwen35_tokenizer.def`（字节级 BPE，`{config.splitRegex, vocab, merges}`），V4/4.5 → `t5_tokenizer.def`（HF tokenizer.json，Unigram，Viterbi），V3 → `clip_tokenizer.def`（`{text: 合并表}`）；地址 `https://novelai.net/tokenizer/compressed/<名>.def?v=2&static=true`（raw deflate，同 novelai-python），T5 / CLIP 下不到再试 hf-mirror / HuggingFace。没下好之前按字数估、显示「约」。上限 V4/4.5 512、V3 225，V5 不显示。`TokenCount.count(文本, 模型)` → `{ n, exact, kind }`。

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
