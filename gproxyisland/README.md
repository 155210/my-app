# gproxy 岛

在屏幕顶部悬浮一颗黑色胶囊，显示 [gproxy](https://github.com/LeenHawk/gproxy) 今日用量（仿灵动岛，无需 root）。

- 收起成三段：状态图标、主信息、次信息。平时是 `● $27.18 | 14 次`；设了预算后圆点变成进度环，右边显示 `剩 $2.82`（超了显示 `超 $x`）。
- 图标和颜色：绿 = 正常；黄 = 到预算 80%；红 = 超预算；灰 = 连不上 gproxy。
- 请求进行中：三根跳动的黄条 + `opus-4-6 | 0:12`（需要 gproxy 同时打开「上游日志」和「上游日志正文」；设置页和展开的岛里都有一键打开）。系统关了动画时画静止的条。
- 请求完成：绿色对勾 `opus-4-6 · 23.4s | +$2.32`，15 秒后回到花费（新请求开始会马上切到生成中）；失败：红色叉 + 红描边 `opus-4-6 失败 | 连续 N 次` 并短震。
- 代理没开 / 节点不对：整颗岛变红底 + 盾牌图标，优先级最高。
- 每日预算：跨过 80% 和 100% 时各提醒一次（Toast + 震动）。
- 点一下展开成面板：大号今日花费 + 预算进度条、请求 / 输入 / 输出三格、进行中的请求、最近几次请求（对齐成列）、上游额度进度条（只读历史）、底部代理状态和「查询额度」。调试信息默认不显示，**展开后长按**才出来。
- 设置页：首页是状态卡（岛的预览、总开关、权限）加分组列表，每行显示当前值，点进去是分页。改动即时保存，没有「保存」按钮；地址、账号、大小、解锁位置这类要重启岛的，离开分页时自动重启一次。
- 上游额度：设置页「上游额度」分页，每个凭据一张卡片显示历史读数；点「查询」才请求上游。
- 位置默认锁定在顶部居中（状态栏正下方）；设置里解锁后才能拖动。状态栏区域是系统下拉手势区，岛不会进去。
- 刷新：空闲按设置间隔（默认 5 秒）；有请求进行中或刚完成 20 秒内每 2 秒一次；熄屏暂停。

## 数据来源

- `POST /portal/api/login {name,password}` 拿 token
- 之后请求带 `cookie: gproxy_session=<token>`（管理接口只认 cookie；Bearer 会被当成 API Key 校验而 401）
- `GET /admin/api/usage?fromMs=<今天0点>` → `summary`
- `GET /admin/api/usage/records?page=1&pageSize=N` → `items`（最新在前，`requestId` 变了 = 有请求完成）
- `GET /admin/api/logs/upstream?limit=10&fromMs=<30分钟前>` → `state == "in_progress"` 的行 = 进行中（下游日志要等请求结束才写；上游日志只开元数据时也要等结束才写，必须开正文）
- `GET/PATCH /admin/api/settings` → `logging.enableUpstreamLog` / `enableUpstreamLogBody`（cookie 认证的 PATCH/POST 要带 `Origin`，和 Host 一致）
- 额度：`GET /admin/api/credentials`、`GET /admin/api/providers`、`GET /admin/api/credentials/{id}/quota`（历史）、`POST …/quota-probe`（查询，打上游）
- GET 不进 gproxy 审计日志，频繁刷新不会堆审计记录

## 结构

| 文件 | 作用 |
| --- | --- |
| `MainActivity.java` | 设置页。单 Activity，`open(页名)` 切换首页和各分页（连接、外观与位置、预算与提醒、刷新、「生成中」检测、代理检测、上游额度、检查更新） |
| `Ui.java` | 岛和设置页共用的颜色、状态图标 `Glyph`、进度条 `Bar`、箭头、自动换行容器 |
| `IslandService.java` | 前台服务 + 悬浮窗胶囊 + 定时刷新 |
| `GproxyClient.java` | 登录与用量接口 |
| `Cfg.java` | SharedPreferences 设置项、数字格式化 |
| `Updater.java` | 设置页「检查更新」：先查 GitHub Releases 里最大的 `gproxyisland-N`（先直连下载，不行再走 ghfast 镜像；安装前和 GitHub 接口给的 SHA-256 比对）；GitHub 不通且本机填了只读令牌时，改查 GitLab 备份项目（ID `88673288`）。和 versionCode 比，下载后调起安装 |

签名固定为 `gproxyisland.keystore`，新版可覆盖安装。
