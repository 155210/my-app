# 自制AI问答机（独立 App）

酒馆外的「纯净提问窗口」：不带酒馆聊天记录、不带世界书、不跑正则，可以导入酒馆预设，自定义 API，随时换模型问。

## 下载 / 更新

推送到 `main` 且改动了 `自制AI问答机/**` 时，Actions（`.github/workflows/自制AI问答机.yml`）自动打包，
发到仓库 **Releases**，标签 `wenda-<构建号>`，附件显示为「自制AI问答机.apk」（GitHub 附件文件名不支持中文，实际文件名 AiAsker.apk）。签名固定（`自制AI问答机.keystore`，密码 asker123），新版直接覆盖安装，数据保留。

## 结构

```
自制AI问答机/
├── build.gradle                包名 com.example.tavernasker（包名/Java 类名只能用英文），版本号 = Actions 构建号
├── 自制AI问答机.keystore
└── src/main/
    ├── java/com/example/tavernasker/
    │   ├── MainActivity.java     WebView 外壳，加载 assets/www/首页.html，JS 桥 AndroidBridge
    │   ├── NativeHttp.java       请求代发（无跨域限制、支持 http、流式逐块回传）
    │   ├── FileSaver.java        备份/导出写入 下载/自制AI问答机/
    │   └── KeepAliveService.java 只在生成回复期间开的前台服务，切后台不断流
    └── assets/www/
        ├── 首页.html             页面骨架
        ├── 样式.css
        ├── 桥接.js               fetch 走原生、保存文件、剪贴板、轻提示
        ├── 存储.js               IndexedDB：settings / apis / presets / chatIndex / chat:<id>
        ├── 预设.js               酒馆预设导入导出、宏替换、按预设组装 messages
        ├── 接口.js               OpenAI 兼容接口：拉模型列表、对话（流式/非流式、思考内容）
        ├── 界面.js               全部界面逻辑
        └── 依赖/                 marked（Markdown）、DOMPurify（过滤 AI 回复里的危险 HTML）
```

## 预设怎么发

按 `prompt_order`（优先 character_id 100001）的顺序和开关：
- 普通条目照发（宏替换后）；`chatHistory` 位置放对话；世界书/角色卡/人设等占位条目没有数据，跳过
- `injection_position = 1` 的条目按深度插进对话
- `new_chat_prompt` 放在对话最前，`assistant_prefill` 作为最后一条 assistant
- 之后按「通用 → 消息整理」合并同角色 / 严格模式
- 预设里有、但 prompt_order 里没有的条目（酒馆条目列表里也看不到）不放进顺序，编辑页底下单独列出
- 不执行正则，也不执行酒馆助手 EJS 模板

## 只发最近 N 层

通用设置 `keepLast`（0 = 全部），每个对话可在切换面板单独设（`chat.keepLast`，留空跟随通用）。
一条消息算一层，只截对话部分，预设条目照发；界面上画分界线、更早的消息变暗。

## 附件

输入框左边的回形针：图片压到最长边 1600 的 JPEG，按 OpenAI 多模态格式（content 数组 + image_url 的 base64）发；
文本类文件（txt/md/json/代码等）把内容拼进正文。

## 本地调试

在 `src/main/assets/www` 起个静态服务器，浏览器打开 `首页.html`。没有 AndroidBridge 时网络/保存/剪贴板退回浏览器原生行为（接口要允许跨域）。
