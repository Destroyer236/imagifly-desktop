package app

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

func backgroundURL(name string) string {
	if name == "" {
		return ""
	}
	return "/local/background?v=" + url.QueryEscape(name)
}

func backgroundPayload(cfg *Config) map[string]any {
	return map[string]any{
		"background":    cfg.Background,
		"backgroundURL": backgroundURL(cfg.Background),
		"bgBlur":        cfg.BgBlur,
		"bgVeil":        cfg.BgVeil,
	}
}

func (s *Server) serveBackground(w http.ResponseWriter, r *http.Request) {
	s.cfgMu.Lock()
	name := s.Cfg.Background
	s.cfgMu.Unlock()
	if !validBackgroundName(name) {
		http.NotFound(w, r)
		return
	}
	dir, err := configDir()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, path)
}

func (s *Server) handleBackgroundUpload(w http.ResponseWriter, r *http.Request) (any, error) {
	s.cfgMu.Lock()
	theme := s.Cfg.Theme
	s.cfgMu.Unlock()
	if theme != "dark" {
		return nil, badRequest("自定义背景仅在深色模式下可用")
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBackgroundBytes+(1<<20))
	if err := r.ParseMultipartForm(maxBackgroundBytes); err != nil {
		return nil, badRequest("背景图片不能大于 8 MB")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return nil, badRequest("没有收到背景图片")
	}
	defer file.Close()
	if header.Size > maxBackgroundBytes {
		return nil, badRequest("背景图片不能大于 8 MB")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBackgroundBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBackgroundBytes {
		return nil, badRequest("背景图片不能大于 8 MB")
	}

	var ext string
	switch http.DetectContentType(data) {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	case "image/gif":
		ext = ".gif"
	default:
		return nil, badRequest("只支持 JPG、PNG、WebP 或 GIF 图片")
	}

	dir, err := configDir()
	if err != nil {
		return nil, err
	}
	name := fmt.Sprintf("background-%d%s", time.Now().UnixNano(), ext)
	finalPath := filepath.Join(dir, name)
	tmpPath := finalPath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return nil, err
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		os.Remove(tmpPath)
		return nil, err
	}

	s.cfgMu.Lock()
	old := s.Cfg.Background
	s.Cfg.Background = name
	if err := SaveConfig(s.Cfg); err != nil {
		s.Cfg.Background = old
		s.cfgMu.Unlock()
		os.Remove(finalPath)
		return nil, err
	}
	payload := backgroundPayload(s.Cfg)
	s.cfgMu.Unlock()

	if old != "" && old != name {
		os.Remove(filepath.Join(dir, old))
	}
	return payload, nil
}

func (s *Server) handleBackgroundDelete(r *http.Request) (any, error) {
	s.cfgMu.Lock()
	old := s.Cfg.Background
	s.Cfg.Background = ""
	if err := SaveConfig(s.Cfg); err != nil {
		s.Cfg.Background = old
		s.cfgMu.Unlock()
		return nil, err
	}
	payload := backgroundPayload(s.Cfg)
	s.cfgMu.Unlock()

	if old != "" {
		if dir, err := configDir(); err == nil {
			os.Remove(filepath.Join(dir, old))
		}
	}
	return payload, nil
}
