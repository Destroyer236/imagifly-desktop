package app

// Coverage is the machine-readable version of API-COVERAGE.md. The Developer
// screen renders it so every spec endpoint is visibly accounted for.
type CoverageRow struct {
	No     int    `json:"no"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Client string `json:"client"`
	UI     string `json:"ui"`
	Spec   string `json:"spec"`
	State  string `json:"state"`
	Note   string `json:"note,omitempty"`
}

var Coverage = []CoverageRow{
	{1, "POST", "/api/auth/login", "Login", "登录页", "实测", "已接入", "Set-Cookie 落到 DPAPI 加密的 accounts.bin"},
	{2, "POST", "/api/auth/logout", "Logout", "账号", "实测", "已接入", ""},
	{3, "GET", "/api/auth/me", "Me", "启动 / 全屏刷新", "实测", "已接入", "user:null（200）按未登录处理"},
	{4, "POST", "/api/auth/register", "Register", "登录页 · 注册", "实测", "已接入", "本地生成 X-Registration-Timestamp"},
	{5, "GET", "/api/auth/register/timestamp", "ServerTimestamp", "内部", "实测", "已接入", "时钟偏差时自动回退"},
	{6, "—", "/api/auth/locale", "—", "—", "未验证", "跳过", "POST 实测 405，语言由 imagifly-locale Cookie 承担"},
	{7, "POST", "/api/credits/daily", "Daily", "账号 · 每日签到", "实测", "已接入", "按天幂等，claimed:false 不报错"},
	{8, "GET", "/api/profile/summary", "ProfileSummary", "账号", "实测", "已接入", ""},
	{9, "GET", "/api/profile/credit-history", "CreditHistory", "账号 · 额度流水", "实测", "已接入", ""},
	{10, "PATCH", "/api/profile", "UpdateProfile", "资料编辑", "实测", "已接入", "profileBio 不允许 null"},
	{11, "POST/DELETE", "/api/profile/avatar", "UploadAvatar / DeleteAvatar", "资料编辑 · 头像", "实测成功", "已接入", "原始图片字节上传，5 MB 上限；不是 multipart"},
	{12, "POST", "/api/profile/password", "ChangePassword", "账号 · 安全", "未验证", "已接入", "请求体按 {currentPassword,newPassword} 推测"},
	{13, "POST", "/api/images/generate", "GenerateImage", "创作 · 图片", "实测", "已接入", "Idempotency-Key=submissionId:requestIndex；参考图走 multipart"},
	{14, "POST", "/api/videos/generate", "GenerateVideo", "创作 · 视频", "实测 401 + 源码", "已接入", "含 workflowFormat / duration / fps / seed / 首末帧"},
	{15, "GET", "/api/generations/tasks", "Tasks", "作品 · 最近", "实测", "已接入", "列表 assets 为空，缩略图用 previewThumbnailUrl"},
	{16, "GET", "/api/generations/{id}", "Generation", "详情弹窗", "实测", "已接入", ""},
	{17, "DELETE", "/api/generations/{id}", "DeleteGeneration", "详情弹窗", "实测", "已接入", ""},
	{18, "GET", "/api/generations/activity", "Activity", "创作 · 并发位", "实测", "已接入", "429 之前先禁用按钮"},
	{19, "GET", "/api/models", "Models", "创作 / 全站", "实测", "已接入", "10 分钟本地缓存"},
	{20, "GET", "/api/models/durations", "ModelDurations", "创作 · 预计耗时", "实测", "已接入", ""},
	{21, "GET", "/api/gallery?section=summary/likes", "Gallery / GallerySection", "作品库 / 点赞关系", "实测成功", "已接入", "likes 同时含我赞过和获赞作品；summary.likeCount 是点赞了别人"},
	{22, "POST/DELETE", "/api/gallery/likes", "LikeGeneration / UnlikeGeneration", "社区 / 作品点赞", "实测成功", "已接入", "返回 {isLiked,likeCount}；社区详情用 cmg_… ID 点赞/取消"},
	{23, "GET", "/api/community", "Community", "社区", "实测", "已接入", "mode/tag/q/author/offset，每页 12"},
	{24, "GET", "/api/community/dynamic", "CommunityDynamic", "社区 · 动态", "实测", "已接入", ""},
	{25, "GET", "/api/community/{id}", "CommunityItem", "社区详情", "实测", "已接入", ""},
	{26, "POST", "/api/community/remix", "Remix", "二创后登记", "源码", "已接入", "生成二创成功后静默登记"},
	{27, "PATCH", "/api/community/{id}", "SetCommunityVisibility", "详情 · 可见性", "源码", "已接入", "免费账号 private 会 403"},
	{28, "GET", "/api/community/follows", "Follows / FollowsPage", "社区 · 关注列表", "实测成功", "已接入", "支持 offset；关注与点赞分开"},
	{29, "PUT", "/api/community/follows", "SetFollow", "社区详情 · 关注/取关", "实测成功", "已接入", "viewerId 以会话为准；测试后恢复"},
	{30, "GET", "/api/homepage/community", "HomepageCommunity", "社区 · 精选轮播", "实测", "已接入", ""},
	{31, "POST", "/api/reports", "Report", "社区详情 · 举报", "源码 + 401", "已接入", "成功响应体未验证"},
	{32, "GET", "/api/notifications", "Notifications", "账号 · 通知", "实测", "已接入", ""},
	{33, "PATCH", "/api/notifications", "MarkNotification", "账号 · 通知", "实测", "已接入", "带 X-Notification-Account"},
	{34, "DELETE", "/api/notifications", "ClearNotifications", "账号 · 通知", "源码", "已接入", ""},
	{35, "GET", "/api/referral/summary", "ReferralSummary", "账号 · 邀请", "实测", "已接入", ""},
	{36, "GET", "/api/referral/share-code", "ShareCode", "账号 · 邀请", "实测", "已接入", ""},
	{37, "POST", "/api/referral/capture", "CaptureReferral", "账号 · 邀请", "实测", "已接入", "无效码返回 captured:false"},
	{38, "POST", "/api/redemption-codes", "Redeem", "账号 · 兑换码", "实测", "已接入", "无需 Cookie，按 body userId 入账"},
	{39, "GET", "/api/billing/packages", "BillingPackages", "账号 · 订阅", "实测", "已接入", ""},
	{40, "POST", "/api/billing/checkout", "Checkout", "账号 · 订阅", "源码 + 401", "已接入", "返回 Stripe URL，用系统浏览器打开"},
	{41, "GET", "/api/billing/checkout/status", "CheckoutStatus", "账号 · 支付回跳", "源码 + 401", "已接入", "1.5s × 10 轮询"},
	{42, "POST", "/api/billing/webhook", "—", "—", "实测", "不调用", "服务端验签，客户端无法伪造"},
	{43, "POST", "/api/prompts/optimize", "OptimizePrompt", "创作 · 优化提示词", "实测 200/400", "已接入", "仅 Wai-SDXL 系列 + 中文提示词，其它模型 400"},
	{44, "GET/POST/DELETE", "/api/developer/api-keys", "APIKeys / CreateAPIKey / DeleteAPIKey", "开发者 · API Key", "实测", "已接入", "明文在 plaintextKey，recoverable:true"},
	{45, "GET/DELETE", "/api/oauth/devices", "Devices / DeleteDevice", "账号 · 设备", "实测", "已接入", ""},
	{46, "POST", "/api/mcp", "MCP", "开发者 · MCP 控制台", "实测", "已接入", "Bearer imf_…，JSON-RPC 2.0"},
	{47, "GET", "/api/admin/community/{id}", "AdminCommunity", "定义保留", "实测 403", "已定义", "需管理员角色，普通账号只读入口"},
	{48, "POST", "/api/feed/events/view", "FeedEventView", "社区 · 打开详情", "实测", "已接入", "曝光埋点，202 {counted:true}"},
	{49, "POST", "/api/feed/events/dwell", "FeedEventDwell", "社区 · 关闭详情", "实测", "已接入", "停留埋点，1s–30min，过短不计"},
	{50, "GET", "/api/notifications?inbox=1", "NotificationsInbox", "账号 · 收件箱", "实测", "已接入", "与系统通知是两套数据；已读/清空带 inbox=1"},
	{51, "GET", "/api/auth/me?include=likesReceived", "MeWithLikes", "账号 · 资料卡兜底", "实测", "已接入", "多返回 likesReceived 聚合数"},
}
