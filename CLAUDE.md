# 仓库说明

一个 Gradle 工程里放了几个独立的安卓 App，各自有 GitHub Actions 工作流，打包后发到 Releases：

| 模块 | App | 工作流 |
| --- | --- | --- |
| `app/` | NumberGate 小游戏 | `.github/workflows/build.yml` |
| `kingdom/` | 小小王国守卫战 | `.github/workflows/kingdom.yml` |
| `translator/` | 小说翻译（原生 Java 版） | `.github/workflows/translator.yml` |
| `toolbox/` | 自制ai工具箱（WebView 包装的小说/世界书工具） | `.github/workflows/toolbox.yml` |
| `自制AI问答机/` | 自制AI问答机（纯净提问窗口，导入酒馆预设、自定义 API） | `.github/workflows/自制AI问答机.yml` |

改哪个 App 就只看哪个目录。改 toolbox 前先读 `toolbox/README.md`（结构、桥接口、对原插件的改动），改自制AI问答机前先读 `自制AI问答机/README.md`，再只打开要改的文件。
本地没有 Android SDK，验证靠推送后看 Actions 结果；toolbox 的网页层可以用无头浏览器单独测。
