package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imagiflydesk/internal/imagiapi"
)

const assetHostHint = "https://cache.imagifly.net/generations/..."

const maxMediaCacheBytes = 16 << 20

func defaultMediaCacheDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "ImagiflyDesktop", "media-cache")
}

func (s *Server) mediaCachePath(target string) string {
	if s.mediaCacheDir == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(target))
	return filepath.Join(s.mediaCacheDir, hex.EncodeToString(sum[:])+".bin")
}

func (s *Server) readMediaCache(target string) ([]byte, bool) {
	path := s.mediaCachePath(target)
	if path == "" {
		return nil, false
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return nil, false
	}
	ct := http.DetectContentType(data)
	if !strings.HasPrefix(ct, "image/") {
		_ = os.Remove(path)
		return nil, false
	}
	return data, true
}

func serveMediaBytes(w http.ResponseWriter, r *http.Request, target string, data []byte, mod time.Time) {
	ct := http.DetectContentType(data)
	if strings.HasPrefix(ct, "image/") {
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "private, max-age=86400")
	}
	http.ServeContent(w, r, target, mod, bytes.NewReader(data))
}

// streamImage sends bytes to the WebView as they arrive instead of waiting for
// the whole asset. This is the difference between a blank detail pane for five
// seconds and the image appearing immediately; it also fills the disk cache in
// the same pass. Oversized or unknown-length images simply stream through.
func (s *Server) streamImage(w http.ResponseWriter, r *http.Request, target string, resp *http.Response) {
	ct := resp.Header.Get("Content-Type")
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	for _, h := range []string{"Content-Length", "Accept-Ranges", "ETag", "Last-Modified"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.WriteHeader(http.StatusOK)

	if resp.ContentLength > 0 && resp.ContentLength <= maxMediaCacheBytes {
		path := s.mediaCachePath(target)
		if path != "" {
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
				tmp := fmt.Sprintf("%s.%d.tmp", path, time.Now().UnixNano())
				if f, err := os.Create(tmp); err == nil {
					n, copyErr := io.Copy(io.MultiWriter(w, f), resp.Body)
					closeErr := f.Close()
					if copyErr == nil && closeErr == nil && n == resp.ContentLength {
						_ = os.Rename(tmp, path)
					} else {
						_ = os.Remove(tmp)
					}
					return
				}
			}
		}
	}
	_, _ = io.Copy(w, resp.Body)
}

// handleMedia proxies CDN assets through loopback for videos and as a fallback
// for images. Images normally load directly from the CDN (same HTTP/2 origin as
// the website); the local disk cache keeps fallback loads instant across
// launches.
func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("u")
	if err := imagiapi.ValidateAssetURL(target); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if data, ok := s.readMediaCache(target); ok {
		serveMediaBytes(w, r, target, data, time.Time{})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	resp, err := s.API.Download(ctx, target, r.Header.Get("Range"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode == http.StatusOK && r.Header.Get("Range") == "" && strings.HasPrefix(ct, "image/") {
		s.streamImage(w, r, target, resp)
		return
	}
	for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("u")
	if err := imagiapi.ValidateAssetURL(target); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()
	resp, err := s.API.Download(ctx, target, "")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	ext := extensionFor(resp.Header.Get("Content-Type"), target)
	base := sanitizeName(r.URL.Query().Get("name"))
	if base == "" {
		base = "imagifly-" + time.Now().Format("20060102-150405")
	}
	if !strings.HasSuffix(strings.ToLower(base), ext) {
		base += ext
	}
	s.cfgMu.Lock()
	dir := s.Cfg.DownloadDir
	s.cfgMu.Unlock()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, "下载目录不可用", http.StatusInternalServerError)
		return
	}
	path := uniquePath(filepath.Join(dir, base))
	f, err := os.Create(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	n, err := io.Copy(f, resp.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = writeJSONSimple(w, map[string]any{"ok": true, "path": path, "name": filepath.Base(path), "size": n})
}

func writeJSONSimple(w http.ResponseWriter, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": v})
}

func extensionFor(contentType, rawURL string) string {
	ct := strings.ToLower(strings.Split(contentType, ";")[0])
	switch ct {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "video/quicktime":
		return ".mov"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	}
	if i := strings.LastIndex(rawURL, "."); i > 0 && i > len(rawURL)-6 {
		return rawURL[i:]
	}
	return ".bin"
}

func sanitizeName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	name = filepath.Base(name)
	repl := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	name = repl.Replace(name)
	name = strings.Trim(name, ". ")
	if len(name) > 90 {
		ext := filepath.Ext(name)
		name = name[:90-len(ext)] + ext
	}
	return name
}

func uniquePath(path string) string {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	for i := 1; i < 1000; i++ {
		candidate := stem + " (" + strconv.Itoa(i) + ")" + ext
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return stem + "-" + strconv.Itoa(time.Now().Nanosecond()) + ext
}
