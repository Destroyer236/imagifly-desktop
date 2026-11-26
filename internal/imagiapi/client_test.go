package imagiapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestClient(t *testing.T, h http.HandlerFunc) (*Client, func()) {
	t.Helper()
	srv := httptest.NewServer(h)
	c := New()
	c.Base = srv.URL
	c.SetSession("test-session")
	return c, srv.Close
}

func TestGenerateImageJSON(t *testing.T) {
	var got map[string]any
	var idem, origin, cookie string
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/images/generate" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		idem = r.Header.Get("Idempotency-Key")
		origin = r.Header.Get("Origin")
		cookie = r.Header.Get("Cookie")
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	defer done()

	_, err := c.GenerateImage(context.Background(), ImageOptions{
		Prompt:       "a cat",
		Model:        "gpt-image-2",
		N:            2,
		Ratio:        "1:1",
		SubmissionID: "sub-1",
		RequestIndex: 1,
		RequestCount: 1,
	})
	if err != nil {
		t.Fatalf("GenerateImage: %v", err)
	}
	if idem != "sub-1:1" {
		t.Fatalf("idempotency = %q", idem)
	}
	if origin != BaseURL {
		t.Fatalf("origin = %q", origin)
	}
	if !strings.Contains(cookie, "imagifly_session=test-session") || !strings.Contains(cookie, "imagifly-locale=zh") {
		t.Fatalf("cookie = %q", cookie)
	}
	if got["prompt"] != "a cat" || got["model"] != "gpt-image-2" || got["requestIndex"] != float64(1) {
		t.Fatalf("body = %#v", got)
	}
}

func TestGenerateImageMultipartMetadata(t *testing.T) {
	var fileField string
	var meta string
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		if len(r.MultipartForm.File["referenceImages"]) != 1 {
			t.Fatalf("referenceImages = %d", len(r.MultipartForm.File["referenceImages"]))
		}
		fileField = r.MultipartForm.File["referenceImages"][0].Filename
		meta = r.FormValue("referenceImageMetadata")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	defer done()

	_, err := c.GenerateImage(context.Background(), ImageOptions{
		Prompt:       "with ref",
		Model:        "gpt-image-2",
		SubmissionID: "sub-2",
		References:   []Reference{{Kind: "image", Filename: "ref.png", MIME: "image/png", Data: []byte("png"), Width: 64, Height: 32}},
	})
	if err != nil {
		t.Fatalf("GenerateImage: %v", err)
	}
	if fileField != "ref.png" {
		t.Fatalf("filename = %q", fileField)
	}
	var arr []map[string]any
	if err := json.Unmarshal([]byte(meta), &arr); err != nil || len(arr) != 1 {
		t.Fatalf("metadata = %q err=%v", meta, err)
	}
	if arr[0]["width"] != float64(64) || arr[0]["height"] != float64(32) {
		t.Fatalf("metadata = %#v", arr[0])
	}
}

func TestGenerateVideoReferenceFields(t *testing.T) {
	var fields = map[string]int{}
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		for _, k := range []string{"referenceImages", "referenceVideos", "referenceAudios", "firstFrame", "lastFrame"} {
			fields[k] = len(r.MultipartForm.File[k])
		}
		if r.FormValue("variant") != "2.5" || r.FormValue("workflowFormat") != "fl2v" || r.FormValue("seed") != "42" {
			t.Errorf("form = variant %q workflow %q seed %q", r.FormValue("variant"), r.FormValue("workflowFormat"), r.FormValue("seed"))
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	defer done()

	refs := []Reference{
		{Kind: "image", Filename: "a.png", MIME: "image/png", Data: []byte("a")},
		{Kind: "video", Filename: "b.mp4", MIME: "video/mp4", Data: []byte("b")},
		{Kind: "audio", Filename: "c.mp3", MIME: "audio/mpeg", Data: []byte("c")},
		{Kind: "firstFrame", Filename: "d.png", MIME: "image/png", Data: []byte("d")},
		{Kind: "lastFrame", Filename: "e.png", MIME: "image/png", Data: []byte("e")},
	}
	_, err := c.GenerateVideo(context.Background(), VideoOptions{
		Prompt: "clip", Model: "seedance", Variant: "2.5", WorkflowFormat: "fl2v",
		Duration: "10s", FPS: 24, Size: "1920x1080", Seed: 42,
		SubmissionID: "sub-3", References: refs,
	})
	if err != nil {
		t.Fatalf("GenerateVideo: %v", err)
	}
	for k, n := range fields {
		if n != 1 {
			t.Fatalf("%s files = %d", k, n)
		}
	}
}

func TestLoginCapturesSessionCookie(t *testing.T) {
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			http.SetCookie(w, &http.Cookie{Name: "imagifly_session", Value: "cookie-value", Path: "/"})
			_, _ = w.Write([]byte(`{"user":{"id":"usr_1","email":"a@b.c"},"billing":{"activePlan":{"tier":"plus"}}}`))
			return
		}
		http.NotFound(w, r)
	})
	defer done()

	sess, err := c.Login(context.Background(), "a@b.c", "secret")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if c.Session() != "cookie-value" {
		t.Fatalf("session = %q", c.Session())
	}
	if sess.User == nil || sess.User.ID != "usr_1" || sess.Billing.ActivePlan.Tier != "plus" {
		t.Fatalf("session = %#v", sess)
	}
}

func TestErrorEnvelopeIncludesLimit(t *testing.T) {
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"Too many","code":"GENERATION_CONCURRENCY_LIMIT","limit":2,"activeCount":2}`))
	})
	defer done()

	_, err := c.Call(context.Background(), Request{Path: "/api/generations/tasks", Auth: true})
	e, ok := AsError(err)
	if !ok {
		t.Fatalf("err = %v", err)
	}
	if e.Status != 429 || e.Code != "GENERATION_CONCURRENCY_LIMIT" || e.Limit != 2 || e.ActiveCount != 2 {
		t.Fatalf("error = %#v", e)
	}
	if !strings.Contains(e.Message, "并发任务已达上限") {
		t.Fatalf("message = %q", e.Message)
	}
}

func TestLocalizedErrorMessages(t *testing.T) {
	cases := []struct {
		code string
		want string
	}{
		{"invalid_image", "图片文件无效或过大"},
		{"too_large", "文件过大"},
		{"upload_timeout", "上传超时"},
		{"AUTH_REQUIRED", "登录状态已失效"},
	}
	for _, tc := range cases {
		if got := LocalizedError(tc.code, 400, `{"code":"`+tc.code+`"}`); !strings.Contains(got, tc.want) {
			t.Errorf("%s => %q, want contains %q", tc.code, got, tc.want)
		}
	}
}

func TestRegistrationTokenRoundTrip(t *testing.T) {
	ms := int64(1764000000000)
	token, err := RegistrationToken(ms)
	if err != nil {
		t.Fatalf("RegistrationToken: %v", err)
	}
	if len(token) != 48 {
		t.Fatalf("token length = %d", len(token))
	}
	got, err := decodeToken(token)
	if err != nil || got != ms {
		t.Fatalf("decode = %d err=%v", got, err)
	}
}

func TestValidateAssetURL(t *testing.T) {
	good := []string{
		"https://imagifly.net/a.png",
		"https://cache.imagifly.net/generations/1/2/0/a.png",
	}
	for _, u := range good {
		if err := ValidateAssetURL(u); err != nil {
			t.Errorf("expected ok: %s: %v", u, err)
		}
	}
	bad := []string{
		"http://imagifly.net/a.png",
		"https://evil.com/a.png",
		"https://imagifly.net.evil.com/a.png",
		"file:///C:/x.png",
	}
	for _, u := range bad {
		if err := ValidateAssetURL(u); err == nil {
			t.Errorf("expected reject: %s", u)
		}
	}
}

func TestHTTPErrorHTMLDetection(t *testing.T) {
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, "<!doctype html><title>404</title>")
	})
	defer done()
	_, err := c.Call(context.Background(), Request{Path: "/api/nope", Auth: true})
	e, ok := AsError(err)
	if !ok || !strings.Contains(e.Message, "HTML") {
		t.Fatalf("err = %#v", err)
	}
}
