package app

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Free machine translation for prompts. MyMemory is keyless and works from
// mainland networks; Google's gtx endpoint is blocked here, so it is not used.
const (
	maxTranslateChars   = 2000
	translateChunkBytes = 900
	translateCacheLimit = 160
)

var translateEndpoint = "https://api.mymemory.translated.net/get"

var translateClient = &http.Client{Timeout: 15 * time.Second}

type translatePayload struct {
	Text   string `json:"text"`
	Target string `json:"target"`
}

type translateCacheEntry struct {
	text string
	at   time.Time
}

var translateCache = struct {
	sync.Mutex
	m map[string]translateCacheEntry
}{m: map[string]translateCacheEntry{}}

type myMemoryResponse struct {
	ResponseData struct {
		TranslatedText string `json:"translatedText"`
	} `json:"responseData"`
	ResponseStatus  json.RawMessage `json:"responseStatus"`
	ResponseDetails string          `json:"responseDetails"`
}

func (s *Server) handleTranslate(ctx context.Context, r *http.Request) (any, error) {
	var p translatePayload
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&p); err != nil {
		return nil, badRequest("翻译请求格式不正确")
	}
	text := strings.TrimSpace(p.Text)
	if text == "" {
		return nil, badRequest("没有可翻译的提示词")
	}
	if utf8.RuneCountInString(text) > maxTranslateChars {
		return nil, badRequest(fmt.Sprintf("提示词超过 %d 字，请精简后再翻译", maxTranslateChars))
	}
	target := strings.ToLower(strings.TrimSpace(p.Target))
	if target == "" {
		target = "en"
	}
	if target != "en" {
		return nil, badRequest("暂只支持翻译成英文")
	}
	if !hasHan(text) {
		return map[string]any{"text": text, "provider": "none", "skipped": true}, nil
	}

	cacheKey := target + "|" + text
	if cached, ok := translateCached(cacheKey); ok {
		return map[string]any{"text": cached, "provider": "MyMemory", "cached": true}, nil
	}

	chunks := splitTranslateChunks(text, translateChunkBytes)
	out := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		translated, err := s.translateChunk(ctx, chunk)
		if err != nil {
			return nil, err
		}
		out = append(out, translated)
	}
	translated := strings.Join(strings.Fields(strings.Join(out, " ")), " ")
	if translated == "" {
		return nil, &clientError{status: http.StatusBadGateway, code: "TRANSLATE_EMPTY", message: "翻译服务没有返回结果，请稍后重试"}
	}
	translateStore(cacheKey, translated)
	return map[string]any{"text": translated, "provider": "MyMemory", "chunks": len(chunks)}, nil
}

func (s *Server) translateChunk(ctx context.Context, chunk string) (string, error) {
	q := url.Values{}
	q.Set("q", chunk)
	q.Set("langpair", "zh-CN|en")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, translateEndpoint+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "ImagiflyDesktop/"+s.Version)
	res, err := translateClient.Do(req)
	if err != nil {
		return "", &clientError{status: http.StatusBadGateway, code: "TRANSLATE_UNAVAILABLE", message: "翻译服务暂时不可用，请检查网络后重试"}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		if res.StatusCode == http.StatusTooManyRequests {
			return "", &clientError{status: http.StatusTooManyRequests, code: "TRANSLATE_LIMIT", message: "免费翻译额度已用完，请稍后再试"}
		}
		return "", &clientError{status: http.StatusBadGateway, code: "TRANSLATE_UNAVAILABLE", message: fmt.Sprintf("翻译服务返回 HTTP %d，请稍后重试", res.StatusCode)}
	}
	var payload myMemoryResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&payload); err != nil {
		return "", &clientError{status: http.StatusBadGateway, code: "TRANSLATE_BAD_JSON", message: "翻译服务返回了无法解析的内容"}
	}
	if !statusOK(payload.ResponseStatus) {
		detail := strings.TrimSpace(payload.ResponseDetails)
		if detail == "" {
			detail = "额度已用完"
		}
		return "", &clientError{status: http.StatusTooManyRequests, code: "TRANSLATE_LIMIT", message: "免费翻译额度已用完（" + detail + "），请稍后再试"}
	}
	text := strings.TrimSpace(html.UnescapeString(payload.ResponseData.TranslatedText))
	if text == "" || strings.Contains(strings.ToUpper(text), "MYMEMORY WARNING") {
		return "", &clientError{status: http.StatusTooManyRequests, code: "TRANSLATE_LIMIT", message: "免费翻译额度已用完，请稍后再试"}
	}
	return text, nil
}

func statusOK(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	s = strings.Trim(s, `"`)
	return s == "" || s == "200"
}

func hasHan(text string) bool {
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// splitTranslateChunks keeps each request under the provider's per-query limit,
// preferring sentence boundaries so the translation stays readable.
func splitTranslateChunks(text string, limit int) []string {
	if utf8.RuneCountInString(text) == 0 {
		return nil
	}
	var chunks []string
	var b strings.Builder
	flush := func() {
		if s := strings.TrimSpace(b.String()); s != "" {
			chunks = append(chunks, s)
		}
		b.Reset()
	}
	bufLen := 0
	for _, r := range text {
		b.WriteRune(r)
		bufLen += utf8.RuneLen(r)
		boundary := r == '。' || r == '！' || r == '？' || r == '\n' || r == '；' || r == ';'
		if (boundary && bufLen >= limit/2) || bufLen >= limit {
			flush()
			bufLen = 0
		}
	}
	flush()
	return chunks
}

func translateCached(key string) (string, bool) {
	translateCache.Lock()
	defer translateCache.Unlock()
	entry, ok := translateCache.m[key]
	if !ok {
		return "", false
	}
	if time.Since(entry.at) > 24*time.Hour {
		delete(translateCache.m, key)
		return "", false
	}
	return entry.text, true
}

func translateStore(key, text string) {
	translateCache.Lock()
	defer translateCache.Unlock()
	if len(translateCache.m) >= translateCacheLimit {
		oldestKey := ""
		var oldest time.Time
		for k, v := range translateCache.m {
			if oldestKey == "" || v.at.Before(oldest) {
				oldestKey, oldest = k, v.at
			}
		}
		if oldestKey != "" {
			delete(translateCache.m, oldestKey)
		}
	}
	translateCache.m[key] = translateCacheEntry{text: text, at: time.Now()}
}
