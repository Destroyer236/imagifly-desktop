package imagiapi

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Check is one row of the built-in live self-test (app flag -selftest).
type Check struct {
	Name     string `json:"name"`
	Method   string `json:"method"`
	Path     string `json:"path"`
	OK       bool   `json:"ok"`
	Status   string `json:"status"`
	Detail   string `json:"detail"`
	Duration string `json:"duration"`
}

// SelfTest probes the public surface plus a few auth guards. It uses a fresh
// client without a session so it can run before login.
func SelfTest(ctx context.Context) []Check {
	c := New()
	var checks []Check

	record := func(chk Check, err error, raw json.RawMessage, fn func(json.RawMessage) (string, bool)) {
		if err != nil {
			if e, ok := AsError(err); ok {
				chk.Status = fmt.Sprintf("HTTP %d", e.Status)
				chk.Detail = strings.TrimSpace(e.Code + " " + e.Message)
				if strings.Contains(e.Message, "HTML") {
					chk.Detail += "（Content-Type 非 JSON，已按 HTML 拦截）"
				}
			} else {
				chk.Status = "ERR"
				chk.Detail = err.Error()
			}
			checks = append(checks, chk)
			return
		}
		chk.Status = "HTTP 200"
		chk.Detail, chk.OK = fn(raw)
		checks = append(checks, chk)
	}

	get := func(name, path string, fn func(json.RawMessage) (string, bool)) {
		start := time.Now()
		raw, err := c.Call(ctx, Request{Path: path})
		record(Check{Name: name, Method: "GET", Path: path, Duration: time.Since(start).Round(time.Millisecond).String()}, err, raw, fn)
	}

	post := func(name, path string, body any, fn func(json.RawMessage) (string, bool)) {
		start := time.Now()
		raw, err := c.Call(ctx, Request{Method: http.MethodPost, Path: path, Body: body})
		record(Check{Name: name, Method: "POST", Path: path, Duration: time.Since(start).Round(time.Millisecond).String()}, err, raw, fn)
	}

	expectError := func(name, method, path string, want int, body any) {
		start := time.Now()
		var raw json.RawMessage
		var err error
		if method == http.MethodGet {
			raw, err = c.Call(ctx, Request{Path: path})
		} else {
			raw, err = c.Call(ctx, Request{Method: method, Path: path, Body: body})
		}
		chk := Check{Name: name, Method: method, Path: path, Duration: time.Since(start).Round(time.Millisecond).String()}
		if e, ok := AsError(err); ok {
			chk.Status = fmt.Sprintf("HTTP %d", e.Status)
			chk.OK = e.Status == want
			chk.Detail = strings.TrimSpace(e.Code + " " + e.Message)
			if path == "/api/__nonexistent_route__" && strings.Contains(string(e.Raw), "<") {
				chk.Detail = "HTML 404 被识别并拦截"
			}
		} else if err == nil {
			chk.Status = "HTTP 200"
			chk.Detail = "预期错误码但成功返回: " + truncate(string(raw), 80)
		} else {
			chk.Status = "ERR"
			chk.Detail = err.Error()
		}
		checks = append(checks, chk)
	}

	get("模型目录", "/api/models", func(raw json.RawMessage) (string, bool) {
		var m struct {
			ImageModels []struct{ ID string } `json:"imageModels"`
			VideoModels []struct{ ID string } `json:"videoModels"`
		}
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		return fmt.Sprintf("图片模型 %d 个 / 视频模型 %d 个", len(m.ImageModels), len(m.VideoModels)), len(m.ImageModels) > 0
	})

	get("平均耗时", "/api/models/durations", func(raw json.RawMessage) (string, bool) {
		var m struct {
			Models map[string]int64 `json:"models"`
		}
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		return fmt.Sprintf("%d 个模型", len(m.Models)), len(m.Models) > 0
	})

	var firstCommunityID string
	get("社区流", "/api/community?mode=image", func(raw json.RawMessage) (string, bool) {
		var m struct {
			Items []struct{ ID string } `json:"items"`
			Tags  []struct{ ID string } `json:"tags"`
		}
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		if len(m.Items) > 0 {
			firstCommunityID = m.Items[0].ID
		}
		return fmt.Sprintf("作品 %d 条 / 标签 %d 个", len(m.Items), len(m.Tags)), true
	})

	get("动态流", "/api/community/dynamic?mode=image", func(raw json.RawMessage) (string, bool) {
		var m struct {
			Items []json.RawMessage `json:"items"`
		}
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		return fmt.Sprintf("%d 条", len(m.Items)), true
	})

	if firstCommunityID != "" {
		get("社区详情", "/api/community/"+firstCommunityID, func(raw json.RawMessage) (string, bool) {
			var m struct {
				Item struct{ ID string } `json:"item"`
			}
			if json.Unmarshal(raw, &m) != nil {
				return "JSON 解析失败", false
			}
			return "id=" + m.Item.ID, m.Item.ID != ""
		})
	}

	get("首页精选", "/api/homepage/community", func(raw json.RawMessage) (string, bool) {
		var m struct {
			Artworks []json.RawMessage `json:"artworks"`
		}
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		return fmt.Sprintf("%d 条", len(m.Artworks)), true
	})

	get("套餐目录", "/api/billing/packages", func(raw json.RawMessage) (string, bool) {
		var m struct {
			Packages []json.RawMessage `json:"packages"`
		}
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		return fmt.Sprintf("%d 个套餐", len(m.Packages)), len(m.Packages) > 0
	})

	get("匿名会话", "/api/auth/me", func(raw json.RawMessage) (string, bool) {
		var m SessionResponse
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		return fmt.Sprintf("user=null 判定=%v", m.User == nil), true
	})

	get("服务器时间戳", "/api/auth/register/timestamp", func(raw json.RawMessage) (string, bool) {
		var m struct {
			Timestamp int64 `json:"timestamp"`
		}
		if json.Unmarshal(raw, &m) != nil {
			return "JSON 解析失败", false
		}
		return fmt.Sprintf("%d", m.Timestamp), m.Timestamp > 1_000_000_000_000
	})

	post("邀请码捕获(无效码)", "/api/referral/capture", map[string]string{"token": "ZZZZ0000"}, func(raw json.RawMessage) (string, bool) {
		return truncate(string(raw), 60), strings.Contains(string(raw), "captured")
	})

	expectError("鉴权守卫 /generations/tasks", "GET", "/api/generations/tasks", http.StatusUnauthorized, nil)
	expectError("鉴权守卫 /developer/api-keys", "GET", "/api/developer/api-keys", http.StatusUnauthorized, nil)
	expectError("HTML 404 回退", "GET", "/api/__nonexistent_route__", http.StatusNotFound, nil)

	// Local crypto check: mint a proof and decrypt it back.
	start := time.Now()
	ms := time.Now().UnixMilli()
	token, err := RegistrationToken(ms)
	chk := Check{Name: "注册时间戳令牌", Method: "LOCAL", Path: "AES-256-GCM", Duration: time.Since(start).String()}
	if err == nil {
		decoded, derr := decodeToken(token)
		if derr == nil && decoded == ms {
			chk.OK = true
			chk.Status = "48 chars"
			chk.Detail = "36 字节密文解密回原毫秒时间戳"
		} else {
			chk.Status = "FAIL"
			chk.Detail = fmt.Sprint(derr)
		}
	} else {
		chk.Status = "FAIL"
		chk.Detail = err.Error()
	}
	checks = append(checks, chk)

	return checks
}

func decodeToken(token string) (int64, error) {
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return 0, err
	}
	if len(raw) != 36 {
		return 0, fmt.Errorf("长度 %d != 36", len(raw))
	}
	block, err := aes.NewCipher(registrationKey)
	if err != nil {
		return 0, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return 0, err
	}
	plain, err := gcm.Open(nil, raw[:12], raw[12:], nil)
	if err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(plain)), nil
}

// Summary renders the checks as a small table.
func Summary(checks []Check) string {
	var b strings.Builder
	pass := 0
	for _, c := range checks {
		if c.OK {
			pass++
		}
	}
	fmt.Fprintf(&b, "自检: %d/%d 通过\n", pass, len(checks))
	for _, c := range checks {
		mark := "FAIL"
		if c.OK {
			mark = " OK "
		}
		fmt.Fprintf(&b, "[%s] %-26s %-5s %-42s %s\n", mark, c.Name, c.Method, c.Path, c.Detail)
	}
	return b.String()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
