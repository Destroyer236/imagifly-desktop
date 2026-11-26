# Imagifly Desktop

imagifly.net 的 Windows 桌面客户端。Go 单文件后端 + WebView2 原生窗口，界面按 **Material 3 Expressive** 设计，把 API 规范里的全部 47 项端点逐条落到实现与界面中。

- 不需要浏览器插件、不需要 Node 运行时；发布物是一个 `imagifly-desktop.exe`。
- 所有上游请求由 Go 进程发出，统一处理 Origin、Cookie、`X-Registration-Timestamp`、`Idempotency-Key`、错误信封，并把上游错误码转换成中文提示，避免把原始 JSON 直接弹给用户。
- 启动时并行读取配置、会话和模型；社区/设置/积分页的只读 GET 结果有短时内存缓存，写操作自动失效；图片直接走 CDN 的 HTTP/2 和社区 WebP 缩略图，失败时回退本地媒体缓存；固定首选端口让 WebView2 的缓存能跨启动复用。设置里可以自定义主题强调色，按浅色/深色模式自动生成 M3 角色色。Windows 图标使用 imagifly.net 官方像素图标制作的多尺寸 ICO。
- 支持多账号登录与一键切换；每个账号的会话 Cookie 都用 Windows DPAPI 加密保存在本机，退出程序不会掉登录。

## 功能

| 模块 | 能力 |
| --- | --- |
| 创作 | 图片/视频生成、模型与参数联动、参考图/首末帧/参考视频音频、Seedance 2.0/2.5 变体、成本预览、提示词优化、并发位与 429 提示 |
| 作品 | 最近生成、作品库、自动轮询、详情/下载/删除/复制提示词、可见性、二创复用 |
| 社区 | 今日精选、社区/关注动态、图片/视频筛选、搜索、标签、点赞、关注、举报、二创登记、详情、下载 |
| 积分 | 额度仪表、签到、额度构成与流水、套餐与 Stripe 支付、邀请返利 |
| 设置 | 多账号添加/切换/移除、账号资料/头像/改密、账号 ID/注册时间/社区数据、关注/公开作品/收到点赞/点赞了别人关系页、通知、安全与本地、已授权设备、下载目录 |
| 开发者 | API Key 增删与明文一次性展示、MCP JSON-RPC 控制台、14 项公共接口自检、47 行覆盖清单、上游请求日志 |

界面采用 M3E 的角色化配色、`surfaceContainer*` 表面层级、全圆角按钮与按下形变、圆环额度仪表、LargeExtendedFAB、自适应 navigation rail。每个信息密集页面只保留一处强表达：创作页是 LargeExtendedFAB，社区页是今日精选横滑，积分页是额度圆环仪表，作品页则刻意收敛为列表密度；设置页把账号资料、通知和本地配置集中到一处。

**清晰度与动效**：exe 内嵌 `PerMonitorV2` DPI manifest，并在创建 WebView2 前调用 `SetProcessDpiAwarenessContext` 兜底；窗口按 1440×920 设计视口结合当前显示器缩放打开，WebView2 直接按物理像素渲染，不再被 DWM 位图拉伸。页面进入、参数区、FAB、额度仪表、卡片悬停和缩略图缩放均有短促的 M3E 动效；这些反馈动效独立于 Windows“显示动画”开关，避免系统关闭动画时整个界面变成静态。

## 运行要求

- Windows 10 1809 及以上（64 位）。
- **Microsoft Edge WebView2 Runtime**。Win10/11 通常已随 Edge 安装；缺失时程序会尝试用 Edge 的 `--app` 窗口启动。
- 运行发布版不需要 Go；自行构建需要 Go 1.24+（开发时使用 Go 1.27.4）、`CGO_ENABLED=0`，以及 PowerShell 7（`pwsh`）。

## 构建

```powershell
git clone https://github.com/Destroyer236/imagifly-desktop.git
cd imagifly-desktop

# 首次构建要能访问 Go 模块代理；国内网络建议先设代理
$env:GOPROXY = 'https://goproxy.cn,direct'

.\build.ps1            # 生成 imagifly-desktop.exe
.\build.ps1 -Package   # 再生成 dist\ImagiflyDesktop-1.2.15-win64.zip
.\build.ps1 -Test      # 构建前先跑 go test ./...
```

`build.ps1` 要求 **PowerShell 7**（`pwsh`）；Windows 自带的 5.1 会因为脚本头的 `#Requires -Version 7.0` 直接拒绝执行。

等价的手工命令：

```powershell
$env:CGO_ENABLED = '0'
$env:GOPROXY = 'https://goproxy.cn,direct'
go build -trimpath -ldflags "-s -w" -o imagifly-desktop.exe .
```

`rsrc_windows_amd64.syso` 已随仓库提供，内含 PerMonitorV2 manifest 和多尺寸图标，因此克隆后**不需要安装 `rsrc`** 也能构建出带图标和 DPI 声明的 exe。

`web/` 通过 `go:embed` 打进 exe；改了前端必须重新 `go build`，不能只替换 HTML。`build.ps1` 会在 `app.manifest` 或 `assets/app.ico` 比 `rsrc_windows_amd64.syso` 新时自动重跑 `rsrc`；手工构建前若改过这两个文件，也要先执行 `rsrc -manifest app.manifest -ico assets\app.ico -o rsrc_windows_amd64.syso`，否则 DPI/图标资源不会更新。

## 使用

直接双击 `imagifly-desktop.exe`。窗口关闭即退出；不会常驻托盘。

| 启动参数 | 用途 |
| --- | --- |
| `-selftest` | 跑 14 项公共接口实机自检并在控制台输出，失败返回码 1 |
| `-headless` | 只启动本地 UI 服务、不开窗口，打印 `local UI: http://127.0.0.1:…` |
| `-demo` | 用演示数据启动（无账号也能看界面），仅用于预览/截图 |
| `-browser` | 不创建 WebView2 窗口，改用 Edge `--app` 窗口 |

快捷键：`Ctrl+Enter` 提交生成，`Esc` 关闭弹窗/菜单。

## 数据与安全

| 内容 | 位置 |
| --- | --- |
| 配置（主题、主题色、下载目录） | `%AppData%\ImagiflyDesktop\config.json` |
| 账号会话 | `%AppData%\ImagiflyDesktop\accounts.bin`，多个账号的 Cookie 一并 DPAPI 加密，仅当前 Windows 用户可解密 |
| WebView2 缓存 | `%AppData%\ImagiflyDesktop\webview2` |
| 默认下载目录 | `%USERPROFILE%\Pictures\Imagifly` |

- 本地 HTTP 服务只监听 `127.0.0.1`，优先固定端口 `7586`（被占用时依次尝试 7587/7588/随机端口），不对外网开放；同时校验 `Host` 与 `Origin`，阻止其他本地网页/端口扫描驱动 API。
- 图片正常直连 `https://*.imagifly.net` 的 CDN WebP 变体，和官网卡片使用同一套资源；仅视频和图片加载失败时走媒体代理。代理只允许 `https://*.imagifly.net`，支持 Range，视频可拖动进度，并把图片写入本地磁盘缓存。
- 外链只允许 `http/https`，避免借 `file:` 或自定义协议触发本机程序。
- 密码只在登录/改密时经本地进程转发，不写入磁盘。DPAPI 只保护各账号的会话 Cookie，不保存密码。
- API Key 只在创建响应里显示一次；MCP 控制台里的 Key 只存在于当前输入框。

## 架构

```
main.go                 窗口/参数/嵌入 web
internal/imagiapi       47 项上游 API 的客户端封装、错误信封、注册令牌、自检
internal/app            本地 HTTP 服务、路由、multipart、DPAPI、媒体代理、覆盖清单、demo
web/                    内嵌 UI（原生 ES modules，无构建步骤）
```

请求链路：

```
WebView2
  └─ fetch /local/*            （127.0.0.1，本地 JSON 信封）
       └─ internal/app handler
            └─ internal/imagiapi Client
                 └─ https://imagifly.net/api/*
```

`internal/imagiapi` 统一注入：

- `Origin: https://imagifly.net`（所有写请求；站点会校验）
- `Cookie: imagifly_session=…; imagifly-locale=zh`
- `X-Registration-Timestamp`：AES-256-GCM 令牌，base64(iv12‖ct8‖tag16)，共 36 字节；遇到 `403 registrationTimestamp` 自动改用服务器时间重试一次
- `Idempotency-Key: <submissionId>:<requestIndex>`
- `X-Notification-Account`（通知标记/清空）

## 接口覆盖

规范中的 47 项逐条对应见 [API-COVERAGE.md](API-COVERAGE.md)，程序内「开发者 → 接口覆盖」也能筛选查看。

汇总：

- **45 项**有客户端方法，其中 44 项接入界面或业务流程。
- **#6 `/api/auth/locale`**：规范明确“方法未确认、POST 实测 405、语言由 `imagifly-locale` Cookie 承担，实现时可省略”；本客户端每个请求都带该 Cookie，因此不单独发请求。
- **#42 `/api/billing/webhook`**：Stripe 服务端回调，规范明确“客户端不要调用”；桌面端只创建 Checkout 并轮询 `checkout/status`。
- **#47 `/api/admin/community/{id}`**：已定义客户端方法与本地路由；普通账号调用只会得到 403，未在常规 UI 暴露入口。

未验证项（规范本身标注“未验证”，代码按最合理推断实现，失败会显示中文提示，并保留上游错误码供排查）：

- `/api/profile/password` 的请求体：`{currentPassword,newPassword}`。
- `/api/prompts/optimize` 的响应结构：兼容 string / `prompt` / `optimizedPrompt` / `text`。
- `remix`、`PATCH community`、`reports` 的成功响应体。
- `POST /api/gallery/likes` 已实测：返回 `{isLiked, likeCount}`；取消赞用同一路径的 `DELETE`，社区详情传 `cmg_…` ID。
- `POST /api/profile/avatar` 按官网前端行为发送原始图片字节（不是 multipart），上限 5 MB；`DELETE` 同一路径可移除头像。

## 自检与复查

```powershell
# 14 项公共接口实机探测（不需要登录）
.\imagifly-desktop.exe -selftest

# 单元测试：请求头、multipart 字段、错误信封与错误码中文映射、注册令牌、资源域名白名单
go test ./...

# 界面预览（另开终端）
.\imagifly-desktop.exe -headless -demo
```

程序内「开发者」页还可以：一键重跑自检、查看 47 行覆盖状态、筛选未接入项、查看最近 80 条上游请求的状态码与耗时。

## 已知限制

- 本机保留了之前登录的会话，已完成登录态接口的实机核验：会话/资料概览、额度流水、任务列表与详情、作品库、关注列表、通知、邀请、API Key 列表、设备列表、管理员接口 403；点赞/取消赞、关注/取关写操作已用真实账号验证并恢复原状态。
- 仅支持 Windows；DPAPI 与 WebView2 都是 Windows 能力。
- 不包含自动更新、系统托盘、开机自启；这些不在 API 规范范围内。
- 社区审核台（#47）只保留 API 能力，没有做管理员界面。

## 目录

```
imagifly-desktop/
├─ main.go
├─ build.ps1
├─ README.md
├─ API-COVERAGE.md
├─ internal/
│  ├─ imagiapi/          client / auth / endpoints / generate / types / selftest
│  └─ app/               server / handlers / media / config / coverage / demo
└─ web/
   ├─ index.html
   ├─ css/app.css
   └─ js/                app / screens / task / ui / api / store / icons / runtime
```

## 许可

[MIT](LICENSE) © 2026 Zephyr








