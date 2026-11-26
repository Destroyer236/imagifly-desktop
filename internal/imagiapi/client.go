// Package imagiapi is a complete client for the imagifly.net web API.
//
// The client is deliberately transport-faithful: it speaks the same cookie
// session, the same Origin requirement and the same idempotency handshake the
// official web client uses. Endpoints and headers are documented in
// API-COVERAGE.md at the repository root.
package imagiapi

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	BaseURL   = "https://imagifly.net"
	UserAgent = "ImagiflyDesktop/1.0 (Windows; Go)"
	// localeCookie mirrors the site preference cookie so community content and
	// server-side messages come back in Chinese.
	localeCookie = "imagifly-locale=zh"
)

// registrationKey is the fixed AES-256-GCM key that the official web bundle
// uses to mint the X-Registration-Timestamp proof. The token is not a secret:
// it only carries a fresh millisecond timestamp.
var registrationKey = []byte{
	0x17, 0xe5, 0x30, 0xa0, 0x0c, 0xa9, 0xc1, 0xbc,
	0xcf, 0xe2, 0xd4, 0x48, 0xef, 0x56, 0x0f, 0xee,
	0x02, 0xe8, 0x42, 0x3b, 0x1c, 0xeb, 0xff, 0xfc,
	0x84, 0x34, 0x2f, 0xdd, 0x22, 0xc0, 0x54, 0x42,
}

// Error is the normalized error envelope described in spec §0.3.
type Error struct {
	Status      int    `json:"status"`
	Code        string `json:"code,omitempty"`
	Message     string `json:"message"`
	Limit       int    `json:"limit,omitempty"`
	ActiveCount int    `json:"activeCount,omitempty"`
	Raw         string `json:"-"`
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%d %s: %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("%d: %s", e.Status, e.Message)
}

// IsAuthError reports whether the failure means "no valid session".
func IsAuthError(err error) bool {
	var e *Error
	if errors.As(err, &e) {
		return e.Status == 401 || e.Code == "AUTH_REQUIRED" || e.Code == "NO_SESSION"
	}
	return false
}

// AsError unwraps an *Error.
func AsError(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

// Client holds one session at a time.
type Client struct {
	Base string
	HTTP *http.Client

	// Hook observes every upstream call (used by the in-app request log).
	Hook func(method, path string, status int, dur time.Duration)

	mu      sync.RWMutex
	session string
}

func New() *Client {
	return &Client{
		Base: BaseURL,
		HTTP: &http.Client{
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				MaxIdleConns:          32,
				MaxIdleConnsPerHost:   16,
				IdleConnTimeout:       90 * time.Second,
				TLSHandshakeTimeout:   15 * time.Second,
				ResponseHeaderTimeout: 60 * time.Second,
				ForceAttemptHTTP2:     true,
			},
			Timeout: 120 * time.Second,
		},
	}
}

func (c *Client) SetSession(s string) {
	c.mu.Lock()
	c.session = strings.TrimSpace(s)
	c.mu.Unlock()
}

func (c *Client) Session() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.session
}

func (c *Client) LoggedIn() bool { return c.Session() != "" }

// FileField is one multipart file part.
type FileField struct {
	Field       string
	Filename    string
	ContentType string
	Data        []byte
}

// Form is a multipart body. Fields may repeat (referenceImages) so values are
// stored as slices.
type Form struct {
	Fields map[string][]string
	Files  []FileField
}

func NewForm() *Form { return &Form{Fields: map[string][]string{}} }

func (f *Form) Add(key, value string) {
	if value == "" {
		return
	}
	f.Fields[key] = append(f.Fields[key], value)
}

func (f *Form) Set(key, value string) {
	if value == "" {
		delete(f.Fields, key)
		return
	}
	f.Fields[key] = []string{value}
}

// Request describes one HTTP call to the upstream API.
type Request struct {
	Method  string
	Path    string
	Query   url.Values
	Body    any    // JSON body, ignored when Form is set
	RawBody []byte // raw body, used for MCP JSON-RPC or binary uploads
	// RawContentType overrides the default application/json for RawBody.
	RawContentType string
	Form           *Form

	Auth        bool   // attach imagifly_session
	Bearer      string // MCP API key, replaces session auth
	Timestamp   bool   // attach X-Registration-Timestamp
	Idempotency string // Idempotency-Key header
	NotifyAcct  string // X-Notification-Account header
	Timeout     time.Duration

	// timestampOverride is filled in when the site rejects a locally minted
	// proof (clock skew) and we retry with the server clock.
	timestampOverride int64
}

// Call performs the request and returns the JSON body.
func (c *Client) Call(ctx context.Context, r Request) (json.RawMessage, error) {
	_, body, err := c.Do(ctx, r)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(body), nil
}

// Do performs the request and returns the raw response as well (needed to read
// Set-Cookie on login).
func (c *Client) Do(ctx context.Context, r Request) (*http.Response, []byte, error) {
	if r.Method == "" {
		r.Method = http.MethodGet
	}
	if r.Path == "" {
		return nil, nil, errors.New("empty path")
	}
	if r.Auth && c.Session() == "" {
		return nil, nil, &Error{Status: http.StatusUnauthorized, Code: "NO_SESSION", Message: "尚未登录，请先登录账号"}
	}

	attempt := 0
	started := time.Now()
	for {
		attempt++
		resp, body, err := c.once(ctx, r)
		if err == nil {
			c.observe(r, resp.StatusCode, started)
			return resp, body, nil
		}
		var apiErr *Error
		if errors.As(err, &apiErr) && apiErr.Status == http.StatusForbidden &&
			apiErr.Code == "registrationTimestamp" && r.Timestamp && attempt == 1 {
			ts, tsErr := c.ServerTimestamp(ctx)
			if tsErr == nil {
				r.timestampOverride = ts
				continue
			}
		}
		status := 0
		if errors.As(err, &apiErr) {
			status = apiErr.Status
		}
		c.observe(r, status, started)
		return resp, body, err
	}
}

func (c *Client) observe(r Request, status int, started time.Time) {
	if c.Hook == nil {
		return
	}
	c.Hook(r.Method, r.Path, status, time.Since(started))
}

// timestampOverride was declared on Request above.

func (c *Client) once(ctx context.Context, r Request) (*http.Response, []byte, error) {
	u := strings.TrimRight(c.Base, "/") + r.Path
	if len(r.Query) > 0 {
		u += "?" + r.Query.Encode()
	}

	var bodyReader io.Reader
	contentType := ""
	switch {
	case r.Form != nil:
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		for key, values := range r.Form.Fields {
			for _, v := range values {
				if err := mw.WriteField(key, v); err != nil {
					return nil, nil, err
				}
			}
		}
		for _, f := range r.Form.Files {
			ct := f.ContentType
			if ct == "" {
				ct = "application/octet-stream"
			}
			h := textproto.MIMEHeader{}
			h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, f.Field, escapeQuotes(f.Filename)))
			h.Set("Content-Type", ct)
			part, err := mw.CreatePart(h)
			if err != nil {
				return nil, nil, err
			}
			if _, err = part.Write(f.Data); err != nil {
				return nil, nil, err
			}
		}
		if err := mw.Close(); err != nil {
			return nil, nil, err
		}
		bodyReader = &buf
		contentType = mw.FormDataContentType()
	case len(r.RawBody) > 0:
		bodyReader = bytes.NewReader(r.RawBody)
		contentType = r.RawContentType
		if contentType == "" {
			contentType = "application/json"
		}
	case r.Body != nil:
		b, err := json.Marshal(r.Body)
		if err != nil {
			return nil, nil, err
		}
		bodyReader = bytes.NewReader(b)
		contentType = "application/json"
	}

	req, err := http.NewRequestWithContext(ctx, r.Method, u, bodyReader)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Cache-Control", "no-store")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		// Every write endpoint rejects requests without this Origin.
		req.Header.Set("Origin", BaseURL)
	}
	if r.Idempotency != "" {
		req.Header.Set("Idempotency-Key", r.Idempotency)
	}
	if r.NotifyAcct != "" {
		req.Header.Set("X-Notification-Account", r.NotifyAcct)
	}
	if r.Timestamp {
		ms := time.Now().UnixMilli()
		if r.timestampOverride > 0 {
			ms = r.timestampOverride
		}
		token, err := RegistrationToken(ms)
		if err != nil {
			return nil, nil, err
		}
		req.Header.Set("X-Registration-Timestamp", token)
	}

	cookies := []string{localeCookie}
	if s := c.Session(); s != "" {
		cookies = append([]string{"imagifly_session=" + s}, cookies...)
	}
	req.Header.Set("Cookie", strings.Join(cookies, "; "))

	if r.Bearer != "" {
		req.Header.Set("Authorization", "Bearer "+r.Bearer)
	}

	if r.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, r.Timeout)
		defer cancel()
		req = req.WithContext(ctx)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, &Error{Status: 0, Code: "NETWORK", Message: "网络请求失败: " + err.Error()}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return resp, nil, &Error{Status: resp.StatusCode, Code: "READ", Message: "读取响应失败: " + err.Error()}
	}
	if resp.StatusCode >= 400 {
		return resp, body, parseError(resp, body)
	}
	return resp, body, nil
}

// RegistrationToken mints the X-Registration-Timestamp value: base64 of
// iv(12) || AES-256-GCM(ciphertext(8) + tag(16)).
func RegistrationToken(ms int64) (string, error) {
	block, err := aes.NewCipher(registrationKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain := make([]byte, 8)
	binary.BigEndian.PutUint64(plain, uint64(ms))
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, iv, plain, nil)
	return base64.StdEncoding.EncodeToString(append(iv, sealed...)), nil
}

// ServerTimestamp fetches the site clock used as a fallback for the proof.
func (c *Client) ServerTimestamp(ctx context.Context) (int64, error) {
	raw, err := c.Call(ctx, Request{Path: "/api/auth/register/timestamp"})
	if err != nil {
		return 0, err
	}
	var out struct {
		Timestamp int64 `json:"timestamp"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return 0, err
	}
	if out.Timestamp <= 0 {
		return 0, errors.New("无效的服务器时间戳")
	}
	return out.Timestamp, nil
}

func parseError(resp *http.Response, body []byte) *Error {
	e := &Error{Status: resp.StatusCode, Raw: string(body)}
	ct := resp.Header.Get("Content-Type")
	trimmed := strings.TrimSpace(string(body))
	if strings.Contains(ct, "json") || strings.HasPrefix(trimmed, "{") {
		var m map[string]any
		if json.Unmarshal(body, &m) == nil {
			if code, ok := m["code"].(string); ok {
				e.Code = code
			}
			switch v := m["error"].(type) {
			case string:
				e.Message = v
			case map[string]any:
				if msg, ok := v["message"].(string); ok {
					e.Message = msg
				}
				if code, ok := v["code"].(float64); ok {
					e.Code = strconv.Itoa(int(code))
				}
			}
			if msg, ok := m["message"].(string); ok && e.Message == "" {
				e.Message = msg
			}
			if n, ok := m["limit"].(float64); ok {
				e.Limit = int(n)
			}
			if n, ok := m["activeCount"].(float64); ok {
				e.ActiveCount = int(n)
			}
		}
	} else if strings.Contains(ct, "html") || strings.HasPrefix(trimmed, "<") {
		e.Message = "接口返回了 HTML 页面（路由不存在或请求未被受理）"
	}
	if e.Message == "" {
		e.Message = strings.TrimSpace(trimmed)
		if len(e.Message) > 200 {
			e.Message = e.Message[:200]
		}
	}
	if e.Message == "" {
		e.Message = http.StatusText(resp.StatusCode)
	}
	e.Message = LocalizedError(e.Code, e.Status, e.Message)
	return e
}

func escapeQuotes(s string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, "\\\"").Replace(s)
}

// UUID returns a v4 UUID.
func UUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]), hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]), hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]))
}

// Download fetches a CDN asset. Range is passed through for video seeking.
func (c *Client) Download(ctx context.Context, rawURL, rangeHeader string) (*http.Response, error) {
	if err := ValidateAssetURL(rawURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", UserAgent)
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusPartialContent {
		defer resp.Body.Close()
		return nil, &Error{Status: resp.StatusCode, Code: "ASSET", Message: "资源获取失败（HTTP " + strconv.Itoa(resp.StatusCode) + "）"}
	}
	return resp, nil
}

// ValidateAssetURL keeps the local proxy from becoming an open relay.
func ValidateAssetURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return errors.New("只允许 https 资源")
	}
	host := strings.ToLower(u.Hostname())
	if host != "imagifly.net" && !strings.HasSuffix(host, ".imagifly.net") {
		return errors.New("不允许的资源域名: " + host)
	}
	return nil
}
