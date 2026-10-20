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
        ├── 参数.js               【出图参数】模型表、默认质量词/负面词、采样器、尺寸、默认设置
        ├── 写词.js               【AI 流水线】内置规范、拼消息、解析 JSON、格式不对自动重试
        ├── 出图.js               【NAI】拼请求 body、解 zip、测试连接查 Anlas
        ├── 队列.js               【队列】出图排队（现在并发 1）、取消、前台服务开关
        ├── 图库.js               【图库数据】存图、缩略图、配方、存相册
        ├── 工具.js               共用界面小工具（浮层、对话框、列表选择、设置读写）
        ├── 页面-设置.js          设置页（AI 接口 / NAI 出图 / 提示词规范）
        ├── 页面-创作.js          创作页
        ├── 页面-图库.js          图库页、大图和配方
        ├── 备份.js               设置导出 / 导入（设置页「备份」标签，图库不进备份）
        ├── 更新.js               检查更新：查 Releases 里最新 shengtu-N，和本机 1.0.N 比，交给浏览器下载
        └── 启动.js               启动、底部标签切换
```

### 扩展口（新功能尽量加新文件，少改现有文件）

- `Nai.addHook(fn)`：`fn(parameters, nai设置, 本次提示词)`，出图请求发出前改参数。多角色、Vibe 用它。
- `Writer.addContext(fn)`：`fn(设置, 中文描述)` 返回一段参考文字，附在发给 AI 的消息后面。角色库、标签库候选用它。
- `SettingsPage.addTab({ id, label, html, acts })`：给设置页加一个标签页，表单项写 `data-k="路径"` 自动绑定保存。
- 新设置字段加在 `参数.js` 的 `DEFAULTS` 里，老用户打开时自动补上。

## 出图怎么拼

- 正面 = 画师串, AI 写的标签, 质量词（设置里留空 = 模型默认）；4.5 / V5 且开了「英文描述」时再接 `. 英文描述`
- 负面 = 负面词（留空 = 模型默认）, AI 补的负面词
- 请求：`POST {NAI 地址}/ai/generate-image`，返回 zip，取第一张图（有的第三方站直接回 PNG 也认）

## 测试

```
PW=/opt/node-tools/node_modules/playwright CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node 自然语言生图/测试/网页测试.js
```

起本地静态服务、拦截假 AI 和假 NAI 接口，走一遍：设置 → 拉模型 → 写提示词（第一次故意回错格式，测自动重试）→ 自动出图 → 图库大图 → 重开页面数据还在 → 返回键。

## 本地调试

在 `src/main/assets/www` 起个静态服务器，浏览器打开 `首页.html`。没有 AndroidBridge 时网络/保存/剪贴板退回浏览器原生行为（接口要允许跨域）。

## 后续功能分组

见 `后续计划.md`。
