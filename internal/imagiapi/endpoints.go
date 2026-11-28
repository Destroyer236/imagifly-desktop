package imagiapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// --- Profile & credits -----------------------------------------------------

func (c *Client) ProfileSummary(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/profile/summary", Auth: true})
}

func (c *Client) CreditHistory(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/profile/credit-history", Auth: true})
}

// UpdateProfile patches name / bio. Empty strings are allowed (bio ""), null is
// rejected by the site.
func (c *Client) UpdateProfile(ctx context.Context, name, bio string) (json.RawMessage, error) {
	body := map[string]any{"name": name, "profileBio": bio}
	return c.Call(ctx, Request{Method: http.MethodPatch, Path: "/api/profile", Body: body, Auth: true})
}

// UploadAvatar mirrors the official site: the selected image is POSTed as the
// raw request body, not as multipart form data. The site sniffs the image type
// from its bytes and caps the file at 5 MB.
func (c *Client) UploadAvatar(ctx context.Context, data []byte, filename, contentType string) (json.RawMessage, error) {
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	return c.Call(ctx, Request{
		Method:         http.MethodPost,
		Path:           "/api/profile/avatar",
		RawBody:        data,
		RawContentType: contentType,
		Auth:           true,
		Timeout:        60 * time.Second,
	})
}

func (c *Client) DeleteAvatar(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodDelete, Path: "/api/profile/avatar", Auth: true, Timeout: 30 * time.Second})
}

func (c *Client) ChangePassword(ctx context.Context, current, next string) (json.RawMessage, error) {
	body := map[string]string{"currentPassword": current, "newPassword": next}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/profile/password", Body: body, Auth: true})
}

// --- Models ----------------------------------------------------------------

func (c *Client) Models(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/models"})
}

func (c *Client) ModelDurations(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/models/durations"})
}

// --- Generations -----------------------------------------------------------

func (c *Client) Tasks(ctx context.Context, limit int, submissionID string) (json.RawMessage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", itoa(limit))
	}
	if submissionID != "" {
		q.Set("submissionId", submissionID)
	}
	return c.Call(ctx, Request{Path: "/api/generations/tasks", Query: q, Auth: true})
}

func (c *Client) Generation(ctx context.Context, id string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/generations/" + url.PathEscape(id), Auth: true})
}

func (c *Client) DeleteGeneration(ctx context.Context, id string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodDelete, Path: "/api/generations/" + url.PathEscape(id), Auth: true})
}

func (c *Client) Activity(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/generations/activity", Auth: true})
}

// --- Gallery ---------------------------------------------------------------

func (c *Client) Gallery(ctx context.Context, offset, limit int) (json.RawMessage, error) {
	return c.GallerySection(ctx, "", offset, limit)
}

// GallerySection reads /api/gallery sections. The official gallery uses
// section=summary for quotas and section=likes for works the viewer liked plus
// their own works that received likes.
func (c *Client) GallerySection(ctx context.Context, section string, offset, limit int) (json.RawMessage, error) {
	q := url.Values{}
	if section != "" {
		q.Set("section", section)
	}
	if offset > 0 {
		q.Set("offset", itoa(offset))
	}
	if limit > 0 {
		q.Set("limit", itoa(limit))
	}
	return c.Call(ctx, Request{Path: "/api/gallery", Query: q, Auth: true})
}

func (c *Client) LikeGeneration(ctx context.Context, generationID string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/gallery/likes", Body: map[string]string{"generationId": generationID}, Auth: true})
}

func (c *Client) UnlikeGeneration(ctx context.Context, generationID string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodDelete, Path: "/api/gallery/likes", Body: map[string]string{"generationId": generationID}, Auth: true})
}

// --- Community -------------------------------------------------------------

type CommunityQuery struct {
	Mode   string
	Tag    string
	Q      string
	Author string
	Offset int
}

func (q CommunityQuery) values() url.Values {
	v := url.Values{}
	if q.Mode != "" {
		v.Set("mode", q.Mode)
	}
	if q.Tag != "" {
		v.Set("tag", q.Tag)
	}
	if q.Q != "" {
		v.Set("q", q.Q)
	}
	if q.Author != "" {
		v.Set("author", q.Author)
	}
	if q.Offset > 0 {
		v.Set("offset", itoa(q.Offset))
	}
	return v
}

func (c *Client) Community(ctx context.Context, q CommunityQuery) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/community", Query: q.values()})
}

func (c *Client) CommunityDynamic(ctx context.Context, q CommunityQuery) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/community/dynamic", Query: q.values()})
}

func (c *Client) CommunityItem(ctx context.Context, id string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/community/" + url.PathEscape(id)})
}

func (c *Client) Remix(ctx context.Context, communityID, generationID string) (json.RawMessage, error) {
	body := map[string]string{"communityGenerationId": communityID, "generationId": generationID}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/community/remix", Body: body, Auth: true})
}

func (c *Client) SetCommunityVisibility(ctx context.Context, cmgID string, generationIDs []string, visibility string) (json.RawMessage, error) {
	body := map[string]any{"generationIds": generationIDs, "visibility": visibility}
	return c.Call(ctx, Request{Method: http.MethodPatch, Path: "/api/community/" + url.PathEscape(cmgID), Body: body, Auth: true})
}

func (c *Client) Follows(ctx context.Context) (json.RawMessage, error) {
	return c.FollowsPage(ctx, 0)
}

func (c *Client) FollowsPage(ctx context.Context, offset int) (json.RawMessage, error) {
	q := url.Values{}
	if offset > 0 {
		q.Set("offset", itoa(offset))
	}
	return c.Call(ctx, Request{Path: "/api/community/follows", Query: q, Auth: true})
}

func (c *Client) SetFollow(ctx context.Context, viewerID, creatorID string, following bool) (json.RawMessage, error) {
	body := map[string]any{"viewerId": viewerID, "creatorId": creatorID, "following": following}
	return c.Call(ctx, Request{Method: http.MethodPut, Path: "/api/community/follows", Body: body, Auth: true})
}

func (c *Client) HomepageCommunity(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/homepage/community"})
}

func (c *Client) Report(ctx context.Context, communityID, reason, details string) (json.RawMessage, error) {
	body := map[string]string{"communityGenerationId": communityID, "reason": reason, "details": details}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/reports", Body: body, Auth: true})
}

// --- Notifications ---------------------------------------------------------

func (c *Client) Notifications(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/notifications", Auth: true})
}

// NotificationsInbox reads the notification inbox (?inbox=1), which is a
// separate feed from the system notifications returned by Notifications.
func (c *Client) NotificationsInbox(ctx context.Context) (json.RawMessage, error) {
	q := url.Values{}
	q.Set("inbox", "1")
	return c.Call(ctx, Request{Path: "/api/notifications", Query: q, Auth: true})
}

func (c *Client) MarkNotification(ctx context.Context, userID, id string, all, inbox bool) (json.RawMessage, error) {
	q := url.Values{}
	if all {
		q.Set("all", "1")
	} else if id != "" {
		q.Set("id", id)
	}
	if inbox {
		q.Set("inbox", "1")
	}
	return c.Call(ctx, Request{Method: http.MethodPatch, Path: "/api/notifications", Query: q, Auth: true, NotifyAcct: userID})
}

func (c *Client) ClearNotifications(ctx context.Context, userID string, inbox bool) (json.RawMessage, error) {
	q := url.Values{}
	if inbox {
		q.Set("inbox", "1")
	}
	return c.Call(ctx, Request{Method: http.MethodDelete, Path: "/api/notifications", Query: q, Auth: true, NotifyAcct: userID})
}

// --- Community feed telemetry ---------------------------------------------

// FeedEventView reports a community item impression. The site deduplicates per
// viewer/item and answers {"counted":true}; failures are not user-facing.
func (c *Client) FeedEventView(ctx context.Context, imageID string) (json.RawMessage, error) {
	return c.Call(ctx, Request{
		Method:  http.MethodPost,
		Path:    "/api/feed/events/view",
		Body:    map[string]string{"imageId": imageID},
		Auth:    true,
		Timeout: 15 * time.Second,
	})
}

// FeedEventDwell reports an attention span. The site only accepts 1s–30min and
// silently clamps outside that window.
func (c *Client) FeedEventDwell(ctx context.Context, imageID string, durationMs int) (json.RawMessage, error) {
	return c.Call(ctx, Request{
		Method:  http.MethodPost,
		Path:    "/api/feed/events/dwell",
		Body:    map[string]any{"imageId": imageID, "durationMs": durationMs},
		Auth:    true,
		Timeout: 15 * time.Second,
	})
}

// --- Referral & redemption ------------------------------------------------

func (c *Client) ReferralSummary(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/referral/summary", Auth: true})
}

func (c *Client) ShareCode(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/referral/share-code", Auth: true})
}

func (c *Client) CaptureReferral(ctx context.Context, token string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/referral/capture", Body: map[string]string{"token": token}})
}

func (c *Client) Redeem(ctx context.Context, code, userID, locale string) (json.RawMessage, error) {
	body := map[string]string{"code": code, "userId": userID, "locale": locale}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/redemption-codes", Body: body, Timeout: 60 * time.Second})
}

// --- Billing ---------------------------------------------------------------

func (c *Client) BillingPackages(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/billing/packages"})
}

func (c *Client) Checkout(ctx context.Context, packageID, period, locale string) (json.RawMessage, error) {
	body := map[string]string{"packageId": packageID, "period": period, "locale": locale}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/billing/checkout", Body: body, Auth: true})
}

func (c *Client) CheckoutStatus(ctx context.Context, sessionID string) (json.RawMessage, error) {
	q := url.Values{}
	q.Set("session_id", sessionID)
	return c.Call(ctx, Request{Path: "/api/billing/checkout/status", Query: q, Auth: true})
}

// Webhook (spec §9.4) is server-to-server only; the desktop client never calls it.

// --- Prompts ---------------------------------------------------------------

func (c *Client) OptimizePrompt(ctx context.Context, prompt, model string) (json.RawMessage, error) {
	body := map[string]string{"prompt": prompt, "model": model}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/prompts/optimize", Body: body, Auth: true, Timeout: 35 * time.Second})
}

// --- Developer -------------------------------------------------------------

func (c *Client) APIKeys(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/developer/api-keys", Auth: true})
}

func (c *Client) CreateAPIKey(ctx context.Context, name string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/developer/api-keys", Body: map[string]string{"name": name}, Auth: true})
}

func (c *Client) DeleteAPIKey(ctx context.Context, id string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodDelete, Path: "/api/developer/api-keys/" + url.PathEscape(id), Auth: true})
}

func (c *Client) Devices(ctx context.Context) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/oauth/devices", Auth: true})
}

func (c *Client) DeleteDevice(ctx context.Context, id string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodDelete, Path: "/api/oauth/devices/" + url.PathEscape(id), Auth: true})
}

// MCP performs a JSON-RPC 2.0 call against /api/mcp with the user's API key.
func (c *Client) MCP(ctx context.Context, apiKey string, payload []byte) (json.RawMessage, error) {
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/mcp", RawBody: payload, Bearer: apiKey, Timeout: 120 * time.Second})
}

func (c *Client) AdminCommunity(ctx context.Context, id string) (json.RawMessage, error) {
	return c.Call(ctx, Request{Path: "/api/admin/community/" + url.PathEscape(id), Auth: true})
}

func itoa(n int) string { return strconv.Itoa(n) }
