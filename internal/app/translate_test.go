package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func translateTestServer(t *testing.T, handler func(q string) (string, int)) (*httptest.Server, *int32) {
	t.Helper()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		text, status := handler(r.URL.Query().Get("q"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"responseData":     map[string]any{"translatedText": text},
			"responseStatus":   status,
			"responseDetails":  "",
		})
	}))
	old := translateEndpoint
	translateEndpoint = srv.URL
	t.Cleanup(func() {
		translateEndpoint = old
		srv.Close()
	})
	return srv, &calls
}

func callTranslate(t *testing.T, s *Server, text string) (map[string]any, error) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"text": text, "target": "en"})
	req := httptest.NewRequest(http.MethodPost, "/local/translate", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	res, err := s.handleTranslate(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res.(map[string]any), nil
}

func TestTranslateChunksAndCaches(t *testing.T) {
	_, calls := translateTestServer(t, func(q string) (string, int) { return "translated:" + q, 200 })
	translateCache.m = map[string]translateCacheEntry{}
	s := &Server{Version: "test"}

	long := strings.Repeat("黄昏时分，老城区的巷子里，一位穿风衣的女子走过湿漉漉的石板路，路灯刚刚亮起。", 6)
	res, err := callTranslate(t, s, long)
	if err != nil {
		t.Fatalf("translate failed: %v", err)
	}
	text := res["text"].(string)
	if !strings.HasPrefix(text, "translated:") {
		t.Fatalf("unexpected text: %q", text[:min(20, len(text))])
	}
	n := atomic.LoadInt32(calls)
	if n < 2 {
		t.Fatalf("long prompt should be split into chunks, got %d request(s)", n)
	}
	if strings.Count(text, "translated:") != int(n) {
		t.Fatalf("each chunk should be translated once, text=%q calls=%d", text, n)
	}

	// second call is served from the cache and does not hit the provider
	if _, err := callTranslate(t, s, long); err != nil {
		t.Fatalf("cached translate failed: %v", err)
	}
	if got := atomic.LoadInt32(calls); got != n {
		t.Fatalf("cache miss, provider called %d more time(s)", got-n)
	}
}

func TestTranslateSkipsEnglish(t *testing.T) {
	_, calls := translateTestServer(t, func(q string) (string, int) { return q, 200 })
	translateCache.m = map[string]translateCacheEntry{}
	s := &Server{Version: "test"}
	res, err := callTranslate(t, s, "a girl sitting on white sheets, soft light")
	if err != nil {
		t.Fatalf("skip failed: %v", err)
	}
	if res["skipped"] != true {
		t.Fatalf("expected skipped result, got %v", res)
	}
	if atomic.LoadInt32(calls) != 0 {
		t.Fatalf("English text should not be sent to the provider")
	}
}

func TestTranslateQuotaError(t *testing.T) {
	_, _ = translateTestServer(t, func(q string) (string, int) { return "", 429 })
	translateCache.m = map[string]translateCacheEntry{}
	s := &Server{Version: "test"}
	_, err := callTranslate(t, s, "一个女孩")
	if err == nil {
		t.Fatalf("expected quota error")
	}
	ce, ok := err.(*clientError)
	if !ok || ce.status != http.StatusTooManyRequests {
		t.Fatalf("expected 429 clientError, got %#v", err)
	}
}

func TestSplitTranslateChunks(t *testing.T) {
	text := strings.Repeat("雨夜便利店，青蓝色霓虹。", 40)
	chunks := splitTranslateChunks(text, 900)
	if len(chunks) == 0 {
		t.Fatal("no chunks")
	}
	total := 0
	for _, c := range chunks {
		if len([]byte(c)) > 900 {
			t.Fatalf("chunk too large: %d bytes", len([]byte(c)))
		}
		total += len([]rune(c))
	}
	if total != len([]rune(text)) && total != len([]rune(strings.Join(chunks, ""))) {
		t.Fatalf("text lost in split: %d vs %d", total, len([]rune(text)))
	}
	if strings.Count(strings.Join(chunks, ""), "。") != strings.Count(text, "。") {
		t.Fatal("punctuation lost")
	}
}
