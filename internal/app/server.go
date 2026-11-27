package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"imagiflydesk/internal/imagiapi"
)

// Server is the local loopback API + static file host. All upstream traffic
// flows through it so cookies, Origin and idempotency live in one place.
type Server struct {
	Web     fs.FS
	Cfg     *Config
	API     *imagiapi.Client
	Version string
	Demo    bool
	Logs    *ringLog

	mediaCacheDir string

	cfgMu sync.Mutex

	accountsMu sync.Mutex

	relMu   sync.Mutex
	relInfo *updateInfo
	relAt   time.Time

	updMu     sync.Mutex
	updProg   updateProgress
	updCancel context.CancelFunc
}

func NewServer(web fs.FS, cfg *Config, api *imagiapi.Client, version string, demo bool) *Server {
	s := &Server{Web: web, Cfg: cfg, API: api, Version: version, Demo: demo, Logs: newRingLog(80), mediaCacheDir: defaultMediaCacheDir()}
	api.Hook = func(method, path string, status int, dur time.Duration) {
		s.Logs.Add(LogEntry{Method: method, Path: path, Status: status, MS: dur.Milliseconds()})
	}
	return s
}

// Listen binds a loopback port and returns its address. The primary port is
// stable so WebView2 can reuse its image/JSON cache across launches; if it is
// occupied we fall back to nearby ports, then an ephemeral one.
func (s *Server) Listen() (string, error) {
	var ln net.Listener
	var err error
	for _, port := range []string{"7586", "7587", "7588"} {
		ln, err = net.Listen("tcp", "127.0.0.1:"+port)
		if err == nil {
			break
		}
	}
	if ln == nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return "", err
		}
	}
	go func() {
		if err := http.Serve(ln, s.Handler()); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Println("local server:", err)
		}
	}()
	return "http://" + ln.Addr().String(), nil
}

type clientError struct {
	status  int
	code    string
	message string
}

func (e *clientError) Error() string { return e.message }

func badRequest(msg string) error {
	return &clientError{status: http.StatusBadRequest, code: "BAD_REQUEST", message: msg}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// --- meta ------------------------------------------------------------
	mux.HandleFunc("GET /local/health", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return map[string]any{
			"app":      "Imagifly Desktop",
			"version":  s.Version,
			"base":     imagiapi.BaseURL,
			"loggedIn": s.API.LoggedIn(),
			"time":     time.Now().Format(time.RFC3339),
		}, nil
	}, 5*time.Second))

	mux.HandleFunc("GET /local/coverage", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return Coverage, nil
	}, 5*time.Second))

	mux.HandleFunc("GET /local/log", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.Logs.List(), nil
	}, 5*time.Second))
	mux.HandleFunc("GET /local/selftest", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return map[string]any{"checks": imagiapi.SelfTest(ctx)}, nil
	}, 180*time.Second))

	mux.HandleFunc("GET /local/config", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		s.cfgMu.Lock()
		defer s.cfgMu.Unlock()
		return map[string]any{
			"theme":         s.Cfg.Theme,
			"accent":        s.Cfg.Accent,
			"downloadDir":   s.Cfg.DownloadDir,
			"configDir":     mustConfigDir(),
			"sessionCookie": s.API.LoggedIn(),
			"version":       s.Version,
		}, nil
	}, 5*time.Second))

	mux.HandleFunc("PATCH /local/config", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		var in struct {
			Theme       *string `json:"theme"`
			Accent      *string `json:"accent"`
			DownloadDir *string `json:"downloadDir"`
		}
		if err := decodeJSON(r, &in); err != nil {
			return nil, err
		}
		s.cfgMu.Lock()
		defer s.cfgMu.Unlock()
		if in.Theme != nil {
			if *in.Theme != "dark" && *in.Theme != "light" {
				return nil, badRequest("主题只能是 dark 或 light")
			}
			s.Cfg.Theme = *in.Theme
		}
		if in.Accent != nil {
			raw := strings.TrimSpace(*in.Accent)
			if raw != "" {
				normalized := normalizeAccent(raw)
				if normalized == "" {
					return nil, badRequest("主题色必须是 #RRGGBB 格式")
				}
				s.Cfg.Accent = normalized
			} else {
				s.Cfg.Accent = ""
			}
		}
		if in.DownloadDir != nil && strings.TrimSpace(*in.DownloadDir) != "" {
			if err := ensureDir(*in.DownloadDir); err != nil {
				return nil, badRequest("下载目录不可用: " + err.Error())
			}
			s.Cfg.DownloadDir = *in.DownloadDir
		}
		if err := SaveConfig(s.Cfg); err != nil {
			return nil, err
		}
		return s.Cfg, nil
	}, 10*time.Second))

	// --- auth ------------------------------------------------------------
	mux.HandleFunc("GET /local/session", s.wrap(s.handleSession, 20*time.Second))
	mux.HandleFunc("GET /local/accounts", s.wrap(s.handleAccounts, 10*time.Second))
	mux.HandleFunc("POST /local/accounts/login", s.wrap(s.handleAddAccount, 40*time.Second))
	mux.HandleFunc("POST /local/accounts/switch", s.wrap(s.handleSwitchAccount, 10*time.Second))
	mux.HandleFunc("DELETE /local/accounts/{id}", s.wrap(s.handleRemoveAccount, 30*time.Second))
	mux.HandleFunc("POST /local/auth/login", s.wrap(s.handleLogin, 40*time.Second))
	mux.HandleFunc("POST /local/auth/logout", s.wrap(s.handleLogout, 20*time.Second))
	mux.HandleFunc("POST /local/auth/register", s.wrap(s.handleRegister, 40*time.Second))
	mux.HandleFunc("GET /local/auth/register/timestamp", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		ts, err := s.API.ServerTimestamp(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]int64{"timestamp": ts}, nil
	}, 20*time.Second))
	mux.HandleFunc("POST /local/credits/daily", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.Daily(ctx)
	}, 30*time.Second))

	// --- models ----------------------------------------------------------
	modelsCache := &ttlCache{}
	mux.HandleFunc("GET /local/models", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		if v, ok := modelsCache.Get(); ok {
			return v, nil
		}
		raw, err := s.API.Models(ctx)
		if err != nil {
			return nil, err
		}
		if s.Demo {
			raw = demoModelParams(raw)
		}
		modelsCache.Put(raw, 10*time.Minute)
		return raw, nil
	}, 30*time.Second))
	mux.HandleFunc("GET /local/models/durations", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.ModelDurations(ctx)
	}, 30*time.Second))

	// --- profile ---------------------------------------------------------
	mux.HandleFunc("GET /local/profile/summary", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.ProfileSummary(ctx)
	}, 30*time.Second))
	mux.HandleFunc("GET /local/profile/credit-history", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.CreditHistory(ctx)
	}, 30*time.Second))
	mux.HandleFunc("PATCH /local/profile", s.wrap(s.handleUpdateProfile, 30*time.Second))
	mux.HandleFunc("POST /local/profile/avatar", s.wrap(s.handleAvatar, 90*time.Second))
	mux.HandleFunc("DELETE /local/profile/avatar", s.wrap(s.handleDeleteAvatar, 30*time.Second))
	mux.HandleFunc("POST /local/profile/password", s.wrap(s.handlePassword, 30*time.Second))

	// --- generation ------------------------------------------------------
	mux.HandleFunc("POST /local/images/generate", s.wrap(s.handleGenerateImage, 240*time.Second))
	mux.HandleFunc("POST /local/videos/generate", s.wrap(s.handleGenerateVideo, 240*time.Second))
	mux.HandleFunc("GET /local/generations/tasks", s.wrap(s.handleTasks, 40*time.Second))
	mux.HandleFunc("GET /local/generations/activity", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.Activity(ctx)
	}, 20*time.Second))
	mux.HandleFunc("GET /local/generations/{id}", s.wrap(s.handleGenerationDetail, 40*time.Second))
	mux.HandleFunc("DELETE /local/generations/{id}", s.wrap(s.handleDeleteGeneration, 40*time.Second))

	// --- gallery & community ---------------------------------------------
	mux.HandleFunc("GET /local/gallery", s.wrap(s.handleGallery, 40*time.Second))
	mux.HandleFunc("POST /local/gallery/likes", s.wrap(s.handleLike, 30*time.Second))
	mux.HandleFunc("DELETE /local/gallery/likes", s.wrap(s.handleUnlike, 30*time.Second))
	mux.HandleFunc("GET /local/community", s.wrap(s.handleCommunity, 40*time.Second))
	mux.HandleFunc("GET /local/community/dynamic", s.wrap(s.handleCommunityDynamic, 40*time.Second))
	mux.HandleFunc("GET /local/community/follows", s.wrap(s.handleFollows, 30*time.Second))
	mux.HandleFunc("PUT /local/community/follows", s.wrap(s.handleFollow, 30*time.Second))
	mux.HandleFunc("POST /local/community/remix", s.wrap(s.handleRemix, 40*time.Second))
	mux.HandleFunc("GET /local/community/{id}", s.wrap(s.handleCommunityItem, 30*time.Second))
	mux.HandleFunc("PATCH /local/community/{id}", s.wrap(s.handleCommunityPatch, 30*time.Second))
	mux.HandleFunc("GET /local/homepage/community", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.HomepageCommunity(ctx)
	}, 30*time.Second))
	mux.HandleFunc("POST /local/reports", s.wrap(s.handleReport, 30*time.Second))

	// --- notifications ---------------------------------------------------
	mux.HandleFunc("GET /local/notifications", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.Notifications(ctx)
	}, 30*time.Second))
	mux.HandleFunc("PATCH /local/notifications", s.wrap(s.handleNotificationsPatch, 30*time.Second))
	mux.HandleFunc("DELETE /local/notifications", s.wrap(s.handleNotificationsClear, 30*time.Second))

	// --- referral / redemption -------------------------------------------
	mux.HandleFunc("GET /local/referral/summary", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.ReferralSummary(ctx)
	}, 30*time.Second))
	mux.HandleFunc("GET /local/referral/share-code", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.ShareCode(ctx)
	}, 30*time.Second))
	mux.HandleFunc("POST /local/referral/capture", s.wrap(s.handleCapture, 30*time.Second))
	mux.HandleFunc("POST /local/redemption-codes", s.wrap(s.handleRedeem, 60*time.Second))

	// --- billing ---------------------------------------------------------
	mux.HandleFunc("GET /local/billing/packages", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.BillingPackages(ctx)
	}, 30*time.Second))
	mux.HandleFunc("POST /local/billing/checkout", s.wrap(s.handleCheckout, 40*time.Second))
	mux.HandleFunc("GET /local/billing/checkout/status", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		sid := r.URL.Query().Get("session_id")
		if sid == "" {
			return nil, badRequest("缺少 session_id")
		}
		return s.API.CheckoutStatus(ctx, sid)
	}, 30*time.Second))

	// --- prompts ---------------------------------------------------------
	mux.HandleFunc("POST /local/prompts/optimize", s.wrap(s.handleOptimizePrompt, 45*time.Second))

	// --- developer -------------------------------------------------------
	mux.HandleFunc("GET /local/developer/api-keys", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.APIKeys(ctx)
	}, 30*time.Second))
	mux.HandleFunc("POST /local/developer/api-keys", s.wrap(s.handleCreateKey, 30*time.Second))
	mux.HandleFunc("DELETE /local/developer/api-keys/{id}", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.DeleteAPIKey(ctx, r.PathValue("id"))
	}, 30*time.Second))
	mux.HandleFunc("GET /local/oauth/devices", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.Devices(ctx)
	}, 30*time.Second))
	mux.HandleFunc("DELETE /local/oauth/devices/{id}", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.DeleteDevice(ctx, r.PathValue("id"))
	}, 30*time.Second))
	mux.HandleFunc("POST /local/mcp", s.wrap(s.handleMCP, 130*time.Second))
	mux.HandleFunc("GET /local/admin/community/{id}", s.wrap(func(ctx context.Context, r *http.Request) (any, error) {
		return s.API.AdminCommunity(ctx, r.PathValue("id"))
	}, 30*time.Second))

	// --- media & shell ---------------------------------------------------
	// --- self update -----------------------------------------------------
	mux.HandleFunc("POST /local/translate", s.wrap(s.handleTranslate, 40*time.Second))
	mux.HandleFunc("GET /local/update/info", s.wrap(s.handleUpdateInfo, 40*time.Second))
	mux.HandleFunc("POST /local/update/mirrors/test", s.wrap(s.handleUpdateMirrorTest, 40*time.Second))
	mux.HandleFunc("POST /local/update/download", s.wrap(s.handleUpdateDownload, 30*time.Second))
	mux.HandleFunc("GET /local/update/status", s.wrap(s.handleUpdateStatus, 10*time.Second))
	mux.HandleFunc("POST /local/update/cancel", s.wrap(s.handleUpdateCancel, 10*time.Second))
	mux.HandleFunc("POST /local/update/install", s.wrap(s.handleUpdateInstall, 20*time.Second))
	mux.HandleFunc("POST /local/update/open-folder", s.wrap(s.handleUpdateOpenFolder, 20*time.Second))

	mux.HandleFunc("GET /local/media", s.handleMedia)
	mux.HandleFunc("GET /local/download", s.handleDownload)
	mux.HandleFunc("POST /local/reveal", s.wrap(s.handleReveal, 20*time.Second))
	mux.HandleFunc("POST /local/open", s.wrap(s.handleOpenExternal, 20*time.Second))

	// static UI
	mux.Handle("GET /", http.FileServer(http.FS(s.Web)))

	var h http.Handler = mux
	if s.Demo {
		h = s.demoMiddleware(h)
	}
	return loopbackOnly(h)
}

// loopbackOnly stops a web page on another origin from driving the local API
// (DNS rebinding / localhost port scanning). The WebView loads the same
// 127.0.0.1 origin, so its fetch traffic passes; foreign Origin and Host do not.
func loopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		host = strings.Trim(host, "[]")
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
				http.Error(w, "forbidden origin", http.StatusForbidden)
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			// The WebView loads the API from 127.0.0.1 but media from
			// localhost so thumbnails get a separate connection pool.
			// Only the read-only media proxy may be cross-site.
			if !(r.Method == http.MethodGet && r.URL.Path == "/local/media") {
				http.Error(w, "forbidden site", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// wrap turns a handler returning (data, error) into the JSON envelope the UI
// understands. Upstream errors keep their HTTP status inside the payload so
// fetch() never hides the message.
func (s *Server) wrap(fn func(context.Context, *http.Request) (any, error), timeout time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		data, err := fn(ctx, r)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		enc := json.NewEncoder(w)
		if err != nil {
			var apiErr *imagiapi.Error
			var local *clientError
			payload := map[string]any{"ok": false}
			switch {
			case errors.As(err, &apiErr):
				e := map[string]any{"status": apiErr.Status, "message": apiErr.Message}
				if apiErr.Code != "" {
					e["code"] = apiErr.Code
				}
				if apiErr.Limit > 0 {
					e["limit"] = apiErr.Limit
					e["activeCount"] = apiErr.ActiveCount
				}
				payload["error"] = e
			case errors.As(err, &local):
				payload["error"] = map[string]any{"status": local.status, "code": local.code, "message": local.message}
			case errors.Is(err, context.DeadlineExceeded):
				payload["error"] = map[string]any{"status": 0, "code": "TIMEOUT", "message": "请求超时，请稍后重试"}
			default:
				payload["error"] = map[string]any{"status": 0, "code": "INTERNAL", "message": err.Error()}
			}
			_ = enc.Encode(payload)
			return
		}
		payload := map[string]any{"ok": true}
		if data != nil {
			payload["data"] = data
		}
		_ = enc.Encode(payload)
	}
}

func decodeJSON(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 16<<20)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return badRequest("请求体解析失败: " + err.Error())
	}
	return nil
}

func mustConfigDir() string {
	dir, err := configDir()
	if err != nil {
		return ""
	}
	return dir
}

func ensureDir(dir string) error {
	return mkdirAll(dir)
}

// ttlCache memoizes /api/models (it changes rarely and is needed on every
// screen).
type ttlCache struct {
	mu    sync.Mutex
	val   any
	until time.Time
}

func (c *ttlCache) Get() (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Now().Before(c.until) && c.val != nil {
		return c.val, true
	}
	return nil, false
}

func (c *ttlCache) Put(v any, ttl time.Duration) {
	c.mu.Lock()
	c.val = v
	c.until = time.Now().Add(ttl)
	c.mu.Unlock()
}

func (s *Server) String() string { return fmt.Sprintf("server(%s)", s.Version) }
