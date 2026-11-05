# gproxy 岛

在屏幕顶部悬浮一颗黑色胶囊，显示 [gproxy](https://github.com/LeenHawk/gproxy) 今日用量（仿灵动岛，无需 root）。

- 收起：`$27.18 · 14次`，状态点绿色 = 正常，红色 = 出错，灰色 = 连不上 gproxy。
- 点一下展开：今日输入/输出/缓存，以及最近几次请求的时间、模型、输入、输出、花费。
- 按住拖动换位置（会记住）。
- 有新请求时胶囊短暂（6 秒）显示这次的模型和花费，状态点变黄。
- 熄屏暂停刷新，亮屏立即刷新。

## 数据来源

- `POST /portal/api/login {name,password}` 拿 token
- 之后请求带 `cookie: gproxy_session=<token>`（管理接口只认 cookie；Bearer 会被当成 API Key 校验而 401）
- `GET /admin/api/usage?fromMs=<今天0点>` → `summary`
- `GET /admin/api/usage/records?page=1&pageSize=N` → `items`（最新在前）

## 结构

| 文件 | 作用 |
| --- | --- |
| `MainActivity.java` | 设置页（地址、账号、刷新间隔、最近条数、授权、开关） |
| `IslandService.java` | 前台服务 + 悬浮窗胶囊 + 定时刷新 |
| `GproxyClient.java` | 登录与用量接口 |
| `Cfg.java` | SharedPreferences 设置项、数字格式化 |

签名固定为 `gproxyisland.keystore`，新版可覆盖安装。
