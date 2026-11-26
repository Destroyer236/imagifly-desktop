package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// demoMiddleware serves fixture data for authenticated screens when the app is
// started with -demo. Public endpoints (models, community, packages) still go
// to the real site, so the preview always tracks live catalog data.
func (s *Server) demoMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Demo && r.Method == http.MethodGet {
			if data, ok := demoFixture(r.URL.Path); ok {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func demoFixture(path string) (any, bool) {
	now := time.Now()
	iso := func(d time.Duration) string { return now.Add(-d).Format(time.RFC3339) }
	user := map[string]any{
		"id": "usr_demo", "name": "Zephyr", "email": "demo@imagifly.net",
		"avatarUrl": nil, "profileBio": "把想象做成作品。",
		"role": "user", "credits": 5006, "createdAt": iso(30 * 24 * time.Hour),
		"hasPassword": true,
	}
	billing := map[string]any{"activePlan": map[string]any{"tier": "plus", "packageId": "plus_monthly", "expiresAt": iso(-20 * 24 * time.Hour)}}

	tasks := []any{
		map[string]any{"id": "gen_demo_01", "mode": "image", "model": "gpt-image-2", "prompt": "清晨的玻璃温室，薄雾、柠檬树与一束斜光，安静的电影感", "status": "success", "createdAt": iso(90 * time.Minute), "cost": 2, "size": "1024x1024", "durationMs": 18200},
		map[string]any{"id": "gen_demo_02", "mode": "video", "model": "MiniMax-H3", "prompt": "海浪拍打黑色礁石，慢镜头，黄昏金色反光", "status": "generating", "createdAt": iso(40 * time.Second), "cost": 12, "size": "1280x720", "previewThumbnailUrl": ""},
		map[string]any{"id": "gen_demo_03", "mode": "image", "model": "nano-banana-2", "prompt": "极简主义海报：一枚悬浮的银色圆环，米白背景，柔和阴影", "status": "success", "createdAt": iso(5 * time.Hour), "cost": 2, "size": "1024x1024", "durationMs": 9600},
		map[string]any{"id": "gen_demo_04", "mode": "image", "model": "Z-Image-Turbo", "prompt": "雨夜的便利店橱窗，青蓝色霓虹，行人撑伞走过", "status": "failed", "createdAt": iso(8 * time.Hour), "cost": 0, "error": "上游超时"},
		map[string]any{"id": "gen_demo_05", "mode": "image", "model": "Wai-SDXL-V150", "prompt": "手绘植物图鉴：银杏叶、标注与米色纸张纹理", "status": "success", "createdAt": iso(26 * time.Hour), "cost": 1, "size": "832x1216", "durationMs": 12400},
		map[string]any{"id": "gen_demo_06", "mode": "image", "model": "Qwen-Image-Edit", "prompt": "把照片改成陶土质感的雕塑，保留轮廓与光影", "status": "success", "createdAt": iso(2 * 24 * time.Hour), "cost": 2, "size": "1024x1024", "durationMs": 15100},
	}

	summary := map[string]any{
		"stats":       map[string]any{"imageGenerations": 8, "videoGenerations": 1, "likeCount": 12, "publicCommunityCount": 3, "successfulGenerations": 8, "spentCredits": 16},
		"creditUsage": map[string]any{"totalCredits": 5070, "availableCredits": 5006, "usedCredits": 64, "usedPercentage": 1.26},
		"creditBreakdown": []any{
			map[string]any{"source": "daily", "credits": 6, "percentage": 0.12},
			map[string]any{"source": "subscription", "credits": 1200, "percentage": 23.6},
			map[string]any{"source": "other", "credits": 3800, "percentage": 76.28},
		},
	}

	history := map[string]any{"transactions": []any{
		map[string]any{"id": "ctx_1", "kind": "free_daily_grant", "credits": 10, "description": "每日免费额度", "createdAt": iso(2 * time.Hour), "expiresAt": iso(-22 * time.Hour)},
		map[string]any{"id": "ctx_2", "kind": "generation_debit", "credits": -2, "description": "生成图片", "model": "gpt-image-2", "createdAt": iso(90 * time.Minute)},
		map[string]any{"id": "ctx_3", "kind": "referral_rebate", "credits": 30, "description": "邀请返利", "createdAt": iso(3 * 24 * time.Hour)},
	}}

	notifications := map[string]any{"userId": "usr_demo", "items": []any{
		map[string]any{"id": "ntf_1", "type": "like", "title": "收到 3 个赞", "message": "你的作品《清晨的玻璃温室》被 3 人点赞。", "read": false, "createdAt": iso(20 * time.Minute)},
		map[string]any{"id": "ntf_2", "type": "moderation", "title": "作品已通过审核", "message": "《雨夜的便利店橱窗》已公开到社区。", "read": true, "createdAt": iso(6 * time.Hour)},
	}}

	referral := map[string]any{"summary": map[string]any{
		"inviteLink": "https://imagifly.net/r/DEMO2026", "canInvite": true,
		"earnedCredits": 30, "pendingCredits": 0, "availableCredits": 30, "expiringCredits": 0,
		"debtCredits": 0, "signups": 2, "paying": 1, "rebates": []any{}, "friends": []any{}, "nextCursor": nil,
	}}

	keys := map[string]any{"ok": true, "keys": []any{
		map[string]any{"id": "apikey_demo", "name": "本地脚本", "keyPrefix": "imf_demo1234", "createdAt": iso(10 * 24 * time.Hour), "lastUsedAt": iso(time.Hour), "expiresAt": nil, "recoverable": true},
	}}

	devices := map[string]any{"devices": []any{
		map[string]any{"id": "dev_demo", "name": "Visual Studio Code", "platform": "mcp", "createdAt": iso(10 * 24 * time.Hour), "lastSeenAt": iso(time.Hour)},
	}}

	accounts := map[string]any{
		"activeId": "usr_demo",
		"count":    2,
		"accounts": []any{
			map[string]any{"id": "usr_demo", "name": "Zephyr", "email": "demo@imagifly.net", "avatarUrl": nil, "plan": "plus", "active": true, "addedAt": iso(30 * 24 * time.Hour)},
			map[string]any{"id": "usr_demo_2", "name": "Wai", "email": "wai@imagifly.net", "avatarUrl": nil, "plan": "free", "active": false, "addedAt": iso(2 * 24 * time.Hour)},
		},
	}

	switch path {
	case "/local/session":
		return map[string]any{"user": user, "billing": billing}, true
	case "/local/accounts":
		return accounts, true
	case "/local/generations/tasks":
		return map[string]any{"tasks": tasks}, true
	case "/local/generations/activity":
		return map[string]any{"activity": map[string]any{"activeCount": 1, "limit": 3}}, true
	case "/local/profile/summary":
		return summary, true
	case "/local/profile/credit-history":
		return history, true
	case "/local/notifications":
		return notifications, true
	case "/local/referral/summary":
		return referral, true
	case "/local/referral/share-code":
		return map[string]any{"code": "DEMO2026", "ownerId": "usr_demo"}, true
	case "/local/developer/api-keys":
		return keys, true
	case "/local/oauth/devices":
		return devices, true
	case "/local/gallery":
		return map[string]any{"quota": map[string]any{"tier": "plus", "recentLimit": 2, "recentRetentionDays": 2}, "items": []any{}, "likeCount": 12, "recentCount": 6, "hasMore": false, "nextOffset": 0}, true
	case "/local/coverage", "/local/log", "/local/config", "/local/health":
		return nil, false
	}
	if strings.HasPrefix(path, "/local/generations/gen_demo_") {
		id := strings.TrimPrefix(path, "/local/generations/")
		for _, t := range tasks {
			if m, ok := t.(map[string]any); ok && m["id"] == id {
				return map[string]any{"generation": m}, true
			}
		}
	}
	return nil, false
}
