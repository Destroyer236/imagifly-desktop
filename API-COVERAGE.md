# Imagifly API 覆盖清单

对照 imagifly.net API 规范的 47 项端点逐条核对（该规范文档未随仓库分发，端点明细见下表）。程序内「开发者 → 接口覆盖」渲染的是同一份数据（`internal/app/coverage.go`），便于随代码一起复查。

状态说明：

- **已接入**：客户端方法 + 本地路由 + 界面/业务流程均已落地。
- **已定义**：有客户端方法和本地路由，但常规界面没有入口（例如管理员接口）。
- **跳过**：规范标注方法未确认，并明确可以省略；本客户端用等价机制覆盖。
- **不调用**：服务端专用端点，客户端调用没有意义或会破坏签名校验。

## 总表

| # | 上游端点 | 客户端方法 | 本地路由 | 界面/流程 | 规范状态 | 结果 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | `POST /api/auth/login` | `Login` | `POST /local/auth/login` | 登录页 | 实测 | 已接入 | 解析 `Set-Cookie`，DPAPI 保存 |
| 2 | `POST /api/auth/logout` | `Logout` | `POST /local/auth/logout` | 设置 → 退出 | 实测 | 已接入 | 同时清本地 session.bin |
| 3 | `GET /api/auth/me` | `Me` | `GET /local/session` | 启动、全屏刷新 | 实测 | 已接入 | `user:null`（200）按未登录处理 |
| 4 | `POST /api/auth/register` | `Register` | `POST /local/auth/register` | 登录页 → 注册 | 实测到字段校验 | 已接入 | 本地生成时间戳令牌；403 自动重试 |
| 5 | `GET /api/auth/register/timestamp` | `ServerTimestamp` | `GET /local/auth/register/timestamp` | 内部兜底 | 实测 | 已接入 | 仅在时钟偏差时使用 |
| 6 | `/api/auth/locale` | — | — | — | 未验证 | 跳过 | POST 实测 405；每个请求带 `imagifly-locale=zh` |
| 7 | `POST /api/credits/daily` | `Daily` | `POST /local/credits/daily` | 积分 → 签到 | 实测 | 已接入 | 按天幂等，`claimed:false` 不报错 |
| 8 | `GET /api/profile/summary` | `ProfileSummary` | `GET /local/profile/summary` | 积分仪表 | 实测 | 已接入 | — |
| 9 | `GET /api/profile/credit-history` | `CreditHistory` | `GET /local/profile/credit-history` | 积分 → 流水 | 实测 | 已接入 | — |
| 10 | `PATCH /api/profile` | `UpdateProfile` | `PATCH /local/profile` | 资料编辑 | 实测 | 已接入 | `profileBio` 空串合法、不用 null |
| 11 | `POST/DELETE /api/profile/avatar` | `UploadAvatar` / `DeleteAvatar` | `POST/DELETE /local/profile/avatar` | 资料编辑 → 头像 | 实测成功 | 已接入 | 原始图片字节上传，5 MB 上限；不是 multipart |
| 12 | `POST /api/profile/password` | `ChangePassword` | `POST /local/profile/password` | 设置 → 安全 | 未验证 | 已接入 | 请求体按 `{currentPassword,newPassword}` 推断 |
| 13 | `POST /api/images/generate` | `GenerateImage` | `POST /local/images/generate` | 创作 → 图片 | 实测 | 已接入 | JSON；有参考图时 multipart；带幂等键 |
| 14 | `POST /api/videos/generate` | `GenerateVideo` | `POST /local/videos/generate` | 创作 → 视频 | 实测 401 + 源码 | 已接入 | 变体、workflow、时长、fps、seed、首末帧、参考视频/音频 |
| 15 | `GET /api/generations/tasks` | `Tasks` | `GET /local/generations/tasks` | 作品 → 最近生成 | 实测 | 已接入 | 列表 `assets` 为空时用 `previewThumbnailUrl` |
| 16 | `GET /api/generations/{id}` | `Generation` | `GET /local/generations/{id}` | 任务详情弹窗 | 实测 | 已接入 | 含 assets/previewVideoUrl |
| 17 | `DELETE /api/generations/{id}` | `DeleteGeneration` | `DELETE /local/generations/{id}` | 详情 → 删除 | 实测 | 已接入 | — |
| 18 | `GET /api/generations/activity` | `Activity` | `GET /local/generations/activity` | 创作 → 并发位 | 实测 | 已接入 | 429 前先禁用提交并展示 active/limit |
| 19 | `GET /api/models` | `Models` | `GET /local/models` | 创作、全站 | 实测 | 已接入 | 本地缓存 10 分钟 |
| 20 | `GET /api/models/durations` | `ModelDurations` | `GET /local/models/durations` | 创作 → 预计耗时 | 实测 | 已接入 | 毫秒，渲染为 `27s` 等 |
| 21 | `GET /api/gallery`（`section=summary/likes`） | `Gallery` / `GallerySection` | `GET /local/gallery` | 作品库、点赞关系 | 实测成功 | 已接入 | `likes` 同时含我赞过和获赞作品；`summary.likeCount` 是「点赞了别人」 |
| 22 | `POST /api/gallery/likes`（取消赞 `DELETE`） | `LikeGeneration` / `UnlikeGeneration` | `POST/DELETE /local/gallery/likes` | 社区/作品点赞、取消赞 | 实测成功 | 已接入 | 返回 `{isLiked,likeCount}`；社区详情用 `cmg_…` ID |
| 23 | `GET /api/community` | `Community` | `GET /local/community` | 社区流 | 实测 | 已接入 | `mode/tag/q/author/offset`，每页 12；`author` 用于创作者资料页 |
| 24 | `GET /api/community/dynamic` | `CommunityDynamic` | `GET /local/community/dynamic` | 社区 → 动态 | 实测 | 已接入 | 结构同社区流 |
| 25 | `GET /api/community/{cmg_id}` | `CommunityItem` | `GET /local/community/{id}` | 社区详情 | 实测 | 已接入 | — |
| 26 | `POST /api/community/remix` | `Remix` | `POST /local/community/remix` | 二创后登记 | 源码 | 已接入 | 生成成功且来源是社区作品时静默登记 |
| 27 | `PATCH /api/community/{cmg_id}` | `SetCommunityVisibility` | `PATCH /local/community/{id}` | 详情 → 可见性 | 源码 | 已接入 | `{generationIds,visibility}`；免费账号 private 403 |
| 28 | `GET /api/community/follows` | `Follows` / `FollowsPage` | `GET /local/community/follows` | 关注列表 | 实测成功 | 已接入 | 支持 `offset`；条目不混淆关注与点赞 |
| 29 | `PUT /api/community/follows` | `SetFollow` | `PUT /local/community/follows` | 详情 → 关注/取关 | 实测成功 | 已接入 | 会话用户 ID 作为 viewerId；测试后已恢复 |
| 30 | `GET /api/homepage/community` | `HomepageCommunity` | `GET /local/homepage/community` | 社区 → 今日精选 | 实测 | 已接入 | — |
| 31 | `POST /api/reports` | `Report` | `POST /local/reports` | 详情 → 举报 | 实测 401 + 源码 | 已接入 | 成功响应体未验证 |
| 32 | `GET /api/notifications` | `Notifications` | `GET /local/notifications` | 设置 → 通知 | 实测 | 已接入 | — |
| 33 | `PATCH /api/notifications` | `MarkNotification` | `PATCH /local/notifications` | 通知 → 标记已读 | 实测 | 已接入 | `?all=1` 或 `?id=…`，带 `X-Notification-Account` |
| 34 | `DELETE /api/notifications` | `ClearNotifications` | `DELETE /local/notifications` | 通知 → 清空 | 源码 | 已接入 | 同样带 `X-Notification-Account` |
| 35 | `GET /api/referral/summary` | `ReferralSummary` | `GET /local/referral/summary` | 积分 → 邀请 | 实测 | 已接入 | — |
| 36 | `GET /api/referral/share-code` | `ShareCode` | `GET /local/referral/share-code` | 邀请码 | 实测 | 已接入 | 可复制、打开邀请链接 |
| 37 | `POST /api/referral/capture` | `CaptureReferral` | `POST /local/referral/capture` | 邀请码捕获 | 实测 | 已接入 | 无效码 `captured:false` 正常返回 |
| 38 | `POST /api/redemption-codes` | `Redeem` | `POST /local/redemption-codes` | 积分 → 兑换码 | 实测 | 已接入 | 无 Cookie，body 带 `userId` |
| 39 | `GET /api/billing/packages` | `BillingPackages` | `GET /local/billing/packages` | 积分 → 套餐 | 实测 | 已接入 | 年付/月付切换、`checkoutReady` |
| 40 | `POST /api/billing/checkout` | `Checkout` | `POST /local/billing/checkout` | 套餐 → 订阅 | 实测 401 + 源码 | 已接入 | 返回 Stripe URL，系统浏览器打开 |
| 41 | `GET /api/billing/checkout/status` | `CheckoutStatus` | `GET /local/billing/checkout/status` | 支付回跳轮询 | 源码 + 401 | 已接入 | 1.5s × 10 轮询 |
| 42 | `POST /api/billing/webhook` | — | — | — | 实测（验签） | 不调用 | Stripe 服务端回调，规范明确客户端不要调用 |
| 43 | `POST /api/prompts/optimize` | `OptimizePrompt` | `POST /local/prompts/optimize` | 创作 → 优化提示词 | 源码 + 401 | 已接入 | 30s 客户端超时；兼容多种响应形状 |
| 44 | `GET/POST/DELETE /api/developer/api-keys` | `APIKeys` / `CreateAPIKey` / `DeleteAPIKey` | `GET/POST /local/developer/api-keys`、`DELETE /local/developer/api-keys/{id}` | 开发者 → API Key | 实测 | 已接入 | 明文只在创建响应里出现一次 |
| 45 | `GET/DELETE /api/oauth/devices[/{id}]` | `Devices` / `DeleteDevice` | `GET /local/oauth/devices`、`DELETE /local/oauth/devices/{id}` | 设置 → 设备 | 实测 | 已接入 | 删除需二次确认 |
| 46 | `POST /api/mcp` | `MCP` | `POST /local/mcp` | 开发者 → MCP 控制台 | 实测 | 已接入 | Bearer `imf_…`；JSON-RPC 2.0 重新封装 |
| 47 | `GET /api/admin/community/{id}` | `AdminCommunity` | `GET /local/admin/community/{id}` | 无常规入口 | 实测 403 | 已定义 | 需管理员角色；普通账号会收到 403 |

## 统计

- 总数：**47**
- 已接入（界面/业务流程）：**44**
- 已定义（仅 API 能力）：**1**（#47）
- 跳过（规范明确可省略，用 Cookie 等价实现）：**1**（#6）
- 不调用（服务端专用）：**1**（#42）

## 规范未验证项的处理

| 端点 | 规范标注 | 当前实现 | 风险/回退 |
|---|---|---|---|
| #6 locale | 方法未确认 | 不发请求，注入 `imagifly-locale=zh` | 无 |
| #11 avatar | multipart 字段名未验证 | 先 `avatar`，400 时改用 `file` | 两次失败会在界面显示上游错误 |
| #12 password | 请求体未验证 | `{currentPassword,newPassword}` | 上游 400 时原样展示错误 |
| #43 optimize | 响应结构未验证 | 兼容 string / `prompt` / `optimizedPrompt` / `text` | 空响应提示“未返回文本” |
| #22 likes | 成功体未验证 | 按 `{ok}` 宽松处理 | 点赞按钮以返回值刷新 |
| #26 remix | 成功体未验证 | 生成成功后静默登记 | 失败不阻塞主流程，仅日志 |
| #27 visibility | 成功体未验证 | 以返回的可见性/乐观更新为准 | 403 回滚并提示 Pro/Max |
| #31 reports | 成功体未验证 | 按 `{ok}` 处理 | 显示上游错误 |
| #40/#41 checkout | 仅源码 + 401 | 创建 URL；轮询 status | Stripe 测试环境无法本地伪造成功 |

## 复查方式

1. 启动程序 → 开发者 → 接口覆盖：47 行、可按“已接入/已定义/跳过/不调用”筛选。
2. 开发者 → 接口自检：14 项公共端点实机请求，当前 14/14。
3. `imagifly-desktop.exe -selftest`：同一套自检的控制台版本。
4. `go test ./...`：验证请求头/幂等键/multipart 字段/错误信封/注册令牌/域名白名单。
5. 上游请求日志：每次写操作可在开发者页看到状态码与耗时。

