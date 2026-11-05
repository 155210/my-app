# gproxy 岛

在屏幕顶部悬浮一颗黑色胶囊，显示 [gproxy](https://github.com/LeenHawk/gproxy) 今日用量（仿灵动岛，无需 root）。

- 收起：`$27.18 · 14次`（设了预算显示 `$27.18/$30.00 · 14次`）。
- 状态点：绿 = 正常；黄 = 到预算 80%；红 = 超预算或最近一次请求失败；灰 = 连不上 gproxy。
- 请求进行中：黄灯闪烁 + `生成中 · opus-4-6 · 12s`（需要 gproxy 打开「上游日志」）。
- 请求完成：绿灯 `✓ opus-4-6 · 23.4s · $2.32`，6 秒后回到花费；失败：红灯 `✗ … 失败` 并短震。
- 每日预算：跨过 80% 和 100% 时各提醒一次（Toast + 震动）。
- 点一下展开：今日输入/输出/缓存、预算进度、连续失败、进行中的请求、最近几次请求（含耗时）。
- 位置默认锁定在顶部居中（状态栏正下方）；设置里解锁后才能拖动。状态栏区域是系统下拉手势区，岛不会进去。
- 刷新：空闲按设置间隔（默认 15 秒）；有请求进行中或刚完成 20 秒内每 2 秒一次；熄屏暂停。

## 数据来源

- `POST /portal/api/login {name,password}` 拿 token
- 之后请求带 `cookie: gproxy_session=<token>`（管理接口只认 cookie；Bearer 会被当成 API Key 校验而 401）
- `GET /admin/api/usage?fromMs=<今天0点>` → `summary`
- `GET /admin/api/usage/records?page=1&pageSize=N` → `items`（最新在前，`requestId` 变了 = 有请求完成）
- `GET /admin/api/logs/upstream?limit=10&fromMs=<30分钟前>` → `state == "in_progress"` 的行 = 进行中（gproxy 的下游日志要等请求结束才写，所以用上游日志）
- GET 不进 gproxy 审计日志，频繁刷新不会堆审计记录

## 结构

| 文件 | 作用 |
| --- | --- |
| `MainActivity.java` | 设置页（地址、账号、刷新间隔、最近条数、授权、开关） |
| `IslandService.java` | 前台服务 + 悬浮窗胶囊 + 定时刷新 |
| `GproxyClient.java` | 登录与用量接口 |
| `Cfg.java` | SharedPreferences 设置项、数字格式化 |

签名固定为 `gproxyisland.keystore`，新版可覆盖安装。
