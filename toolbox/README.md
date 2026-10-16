# 自制ai工具箱（toolbox 模块）

把 SillyTavern 插件 Novel-Auto-Generator v4.0.1（MIT）的网页功能装进安卓 WebView 外壳。
包含：TXT 转世界书、EPUB 转 TXT、小说翻译。去掉了「世界书导出」和「酒馆 API」（离开酒馆没有数据来源）。

## 下载 / 更新

推送到 `main` 且改动了 `toolbox/**` 时，Actions（`.github/workflows/toolbox.yml`）自动打包，
发布到仓库 **Releases**，标签为 `toolbox-<构建号>`。签名固定（`toolbox.keystore`），新版可直接覆盖安装，数据保留。

## 结构（改功能时先看这里，只打开相关文件）

```
toolbox/
├── build.gradle                     包名 com.example.aitoolbox，版本号 = Actions 构建号
├── toolbox.keystore                 固定签名（密码 toolbox123）
└── src/main/
    ├── AndroidManifest.xml
    ├── java/com/example/aitoolbox/
    │   ├── MainActivity.java        WebView 外壳：加载页面、文件选择、返回键、JS 桥 AndroidBridge
    │   ├── NativeHttp.java          跨域请求代发（无 CORS、支持 http、流式逐块回传）
    │   ├── FileSaver.java           导出文件写入 下载/自制ai工具箱/
    │   └── KeepAliveService.java    前台服务 + 唤醒锁，后台继续跑任务
    └── assets/www/
        ├── index.html               首页入口，按顺序加载外壳脚本和三个模块
        ├── app-bridge.js            外壳桥：fetch 改走原生、拦截下载、剪贴板、toastr 替代、返回键
        ├── app-home.js              首页：三个入口 + 统一 API 设置（localStorage 'toolboxApi'，与模块双向同步）
        ├── app.css                  首页样式 + 酒馆主题变量
        ├── vendor/                  jquery、jszip（离线）
        ├── txtToWorldbook/          TXT 转世界书（ES 模块，原插件代码）
        ├── epubToTxt.js             EPUB 转 TXT（原插件代码）
        ├── novelTranslate.js        小说翻译（原插件代码，4600+ 行，不改翻译功能就不用读）
        └── style.css                原插件样式
```

## 对原插件代码的改动（仅此几处）

- `txtToWorldbook/ui/settingsPanel.js`：隐藏「使用酒馆API」，强制关闭
- `txtToWorldbook/services/apiService.js`：`callAPI` 不再走酒馆 API
- `novelTranslate.js`：API 区标题改为「与首页 API 设置同步」

## 原生桥接口（window.AndroidBridge）

| 方法 | 用途 |
| --- | --- |
| `httpStart(id, method, url, headersJson, bodyB64)` / `httpAbort(id)` | 代发请求，结果回调 `window.__nativeHttp.head/data/end/error` |
| `fileBegin(name, mime)` → token, `fileChunk(token, b64)`, `fileEnd(token)` → `OK:路径` | 分块保存文件 |
| `copyText(text)` / `readClipboard()` | 剪贴板 |
| `appVersion()` | 版本号 |

## 本地调试网页层

浏览器直接打开 `assets/www/index.html`（需起个静态服务器，ES 模块不能走 file://）。
没有 AndroidBridge 时，网络/下载/剪贴板自动退回浏览器原生行为。
