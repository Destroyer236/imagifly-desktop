package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const appDirName = "ImagiflyDesktop"

// Config is persisted to %AppData%\ImagiflyDesktop\config.json.
type Config struct {
	Theme       string `json:"theme"`
	Accent      string `json:"accent"`
	DownloadDir string `json:"downloadDir"`
	Background  string `json:"background"`
	BgBlur      int    `json:"bgBlur"`
	BgVeil      int    `json:"bgVeil"`
}

const (
	maxBackgroundBytes = 8 << 20
	maxBgBlur          = 40
	maxBgVeil          = 90
)

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// validBackgroundName only accepts the generated file names, never a path.
func validBackgroundName(name string) bool {
	if name == "" || filepath.Base(name) != name || !strings.HasPrefix(name, "background-") {
		return false
	}
	ext := filepath.Ext(name)
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		return false
	}
	stem := strings.TrimSuffix(strings.TrimPrefix(name, "background-"), ext)
	if stem == "" {
		return false
	}
	for i := 0; i < len(stem); i++ {
		if stem[i] < '0' || stem[i] > '9' {
			return false
		}
	}
	return true
}

// normalizeAccent accepts #RRGGBB only; an empty value means the built-in
// brand palette. Invalid persisted values fall back to the default silently.
func normalizeAccent(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	if len(value) != 7 || value[0] != '#' {
		return ""
	}
	for i := 1; i < len(value); i++ {
		c := value[i]
		if (c < '0' || c > '9') && (c < 'A' || c > 'F') {
			return ""
		}
	}
	return value
}

func configDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, appDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func defaultDownloadDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	dir := filepath.Join(home, "Pictures", "Imagifly")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func LoadConfig() *Config {
	cfg := &Config{Theme: "dark", DownloadDir: defaultDownloadDir(), BgBlur: 14, BgVeil: 45}
	dir, err := configDir()
	if err != nil {
		return cfg
	}
	raw, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(raw, cfg)
	if cfg.Theme != "light" && cfg.Theme != "dark" {
		cfg.Theme = "dark"
	}
	cfg.Accent = normalizeAccent(cfg.Accent)
	if strings.TrimSpace(cfg.DownloadDir) == "" {
		cfg.DownloadDir = defaultDownloadDir()
	}
	cfg.BgBlur = clampInt(cfg.BgBlur, 0, maxBgBlur)
	cfg.BgVeil = clampInt(cfg.BgVeil, 0, maxBgVeil)
	if !validBackgroundName(cfg.Background) {
		cfg.Background = ""
	} else if _, err := os.Stat(filepath.Join(dir, cfg.Background)); err != nil {
		cfg.Background = ""
	}
	return cfg
}

func SaveConfig(cfg *Config) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o600)
}

// LoadSession returns the saved cookie value, decrypted with DPAPI.
func LoadSession() string {
	dir, err := configDir()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(dir, "session.bin"))
	if err != nil || len(raw) == 0 {
		return ""
	}
	plain, err := unprotect(raw)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(plain))
}

func SaveSession(value string) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	if value == "" {
		return ClearSession()
	}
	blob, err := protect([]byte(value))
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "session.bin"), blob, 0o600)
}

func ClearSession() error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, "session.bin"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
