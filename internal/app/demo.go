package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// demoDeleteDelay simulates a slow upstream DELETE so the optimistic delete
// path can be exercised without touching a real account.
const demoDeleteDelay = 6 * time.Second

var demoDeleted sync.Map

// demoMiddleware serves fixture data for authenticated screens when the app is
// started with -demo. Public endpoints (models, community, packages) still go
// to the real site, so the preview always tracks live catalog data.
func (s *Server) demoMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Demo {
			if r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/local/generations/") {
				id := strings.TrimPrefix(r.URL.Path, "/local/generations/")
				select {
				case <-time.After(demoDeleteDelay):
				case <-r.Context().Done():
					return
				}
				demoDeleted.Store(id, true)
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
				return
			}
			if r.Method == http.MethodGet {
				if id, ok := strings.CutPrefix(r.URL.Path, "/local/generations/"); ok && id != "" {
					if _, gone := demoDeleted.Load(id); gone {
						w.Header().Set("Content-Type", "application/json; charset=utf-8")
						w.Header().Set("Cache-Control", "no-store")
						_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": map[string]any{"status": 404, "code": "not_found", "message": "请求的内容不存在或已被删除"}})
						return
					}
				}
				if data, ok := demoFixture(r.URL.Path); ok {
					w.Header().Set("Content-Type", "application/json; charset=utf-8")
					w.Header().Set("Cache-Control", "no-store")
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// demoModelParams adds two parameters the live catalog does not declare yet.
// It only affects -demo previews and exists to show that a new upstream
// `<x>Options` array turns into a control without any client change.
func demoModelParams(raw json.RawMessage) json.RawMessage {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return raw
	}
	if list, ok := payload["imageModels"].([]any); ok && len(list) > 0 {
		if m, ok := list[0].(map[string]any); ok {
			m["aspectRatios"] = []any{"1:1", "4:3", "16:9", "21:9", "9:16"}
			m["qualityOptions"] = []any{
				map[string]any{"id": "standard", "label": "标准"},
				map[string]any{"id": "high", "label": "高清"},
				map[string]any{"id": "ultra", "label": "超清（演示）"},
			}
			m["lightingOptions"] = []any{
				map[string]any{"id": "studio", "label": "棚拍光"},
				map[string]any{"id": "golden", "label": "黄金时刻"},
				map[string]any{"id": "neon", "label": "霓虹"},
			}
		}
	}
	if list, ok := payload["videoModels"].([]any); ok && len(list) > 0 {
		if m, ok := list[0].(map[string]any); ok {
			m["cameraMotionOptions"] = []any{
				map[string]any{"id": "static", "label": "固定机位"},
				map[string]any{"id": "pan", "label": "横摇"},
				map[string]any{"id": "zoom", "label": "推拉"},
			}
		}
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return out
}

func demoVisibleTasks(tasks []any) []any {
	visible := make([]any, 0, len(tasks))
	for _, t := range tasks {
		if m, ok := t.(map[string]any); ok {
			if id, ok := m["id"].(string); ok {
				if _, gone := demoDeleted.Load(id); gone {
					continue
				}
			}
		}
		visible = append(visible, t)
	}
	return visible
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
		"stats":       map[string]any{"imageGenerations": 8, "videoGenerations": 1, "likeCount": 12, "publicCommunityCount": 3, "successfulGenerations": 8, "spentCredits": 64},
		"creditUsage": map[string]any{"totalCredits": 5070, "availableCredits": 5006, "usedCredits": 64, "usedPercentage": 1.26},
		"creditBreakdown": []any{
			map[string]any{"source": "daily", "credits": 6, "percentage": 0.12},
			map[string]any{"source": "subscription", "credits": 1200, "percentage": 23.6},
			map[string]any{"source": "other", "credits": 3800, "percentage": 76.28},
		},
		"creditExpiryBreakdown": []any{
			map[string]any{"key": "3d", "label": "3 天内", "credits": 17, "percentage": 0.34, "nearestExpiresAt": iso(-15 * time.Hour)},
			map[string]any{"key": "3to7", "label": "3–7 天", "credits": 0, "percentage": 0},
			map[string]any{"key": "7plus", "label": "7 天以上", "credits": 4989, "percentage": 99.66},
		},
	}

	usageDays := []int{1, 2, 4, 6, 9, 11, 14, 17, 21, 25, 28, 32, 36, 41, 46, 52, 59, 67, 76, 86}
	usageCosts := []float64{2, 3, 1, 4, 2, 5, 3, 2, 6, 4, 2, 5, 1, 7, 3, 2, 2, 4, 1, 3}
	transactions := []any{
		map[string]any{"id": "ctx_1", "kind": "free_daily_grant", "credits": 10, "description": "每日免费额度", "createdAt": iso(2 * time.Hour), "expiresAt": iso(-22 * time.Hour)},
		map[string]any{"id": "ctx_2", "kind": "generation_debit", "credits": -2, "description": "生成图片", "model": "gpt-image-2", "createdAt": iso(90 * time.Minute)},
		map[string]any{"id": "ctx_3", "kind": "referral_rebate", "credits": 30, "description": "邀请返利", "createdAt": iso(3 * 24 * time.Hour)},
	}
	for i, day := range usageDays {
		transactions = append(transactions, map[string]any{
			"id":          fmt.Sprintf("ctx_use_%02d", i+1),
			"kind":        "generation_debit",
			"credits":     -usageCosts[i],
			"description": "生成图片",
			"model":       []string{"gpt-image-2", "nano-banana-2", "Wai-SDXL-V150", "Z-Image-Turbo"}[i%4],
			"createdAt":   iso(time.Duration(day*24+i) * time.Hour),
		})
	}
	history := map[string]any{"transactions": transactions}

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
		return map[string]any{"tasks": demoVisibleTasks(tasks)}, true
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
		galleryTasks := demoVisibleTasks(tasks)
		items := make([]any, 0, len(galleryTasks))
		for _, t := range galleryTasks {
			if m, ok := t.(map[string]any); ok && m["status"] == "success" {
				items = append(items, m)
			}
		}
		return map[string]any{"quota": map[string]any{"tier": "plus", "recentLimit": 4, "recentRetentionDays": 2}, "items": items, "likeCount": 12, "recentCount": len(items), "hasMore": false, "nextOffset": 0}, true
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
