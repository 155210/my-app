# gproxy 岛

在屏幕顶部悬浮一颗黑色胶囊，显示 [gproxy](https://github.com/LeenHawk/gproxy) 今日用量（仿灵动岛，无需 root）。

- 收起：`$27.18 · 14次`（设了预算显示 `$27.18/$30.00 · 14次`）。
- 状态点：绿 = 正常；黄 = 到预算 80%；红 = 超预算或最近一次请求失败；灰 = 连不上 gproxy。
- 请求进行中：黄灯闪烁 + `生成中 · opus-4-6 · 12s`（需要 gproxy 同时打开「上游日志」和「上游日志正文」；设置页和展开的岛里都有一键打开）。
- 请求完成：绿灯 `✓ opus-4-6 · 23.4s · $2.32`，15 秒后回到花费（新请求开始会马上切到生成中）；失败：红灯 `✗ … 失败` 并短震。
- 每日预算：跨过 80% 和 100% 时各提醒一次（Toast + 震动）。
- 点一下展开：今日输入/输出/缓存、预算进度、连续失败、进行中的请求、最近几次请求（含耗时）、上游额度摘要（只读历史）、调试信息。
- 上游额度：设置页「上游额度」区，每个凭据一张卡片显示历史读数；点「查询」才请求上游。
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
| `MainActivity.java` | 设置页（地址、账号、刷新间隔、最近条数、授权、开关） |
| `IslandService.java` | 前台服务 + 悬浮窗胶囊 + 定时刷新 |
| `GproxyClient.java` | 登录与用量接口 |
| `Cfg.java` | SharedPreferences 设置项、数字格式化 |
| `Updater.java` | 设置页「检查更新」：先查 GitHub Releases 里最大的 `gproxyisland-N`（先直连下载，不行再走 ghfast 镜像；安装前和 GitHub 接口给的 SHA-256 比对）；GitHub 不通且本机填了只读令牌时，改查 GitLab 备份项目（ID `88673288`）。和 versionCode 比，下载后调起安装 |

签名固定为 `gproxyisland.keystore`，新版可覆盖安装。
