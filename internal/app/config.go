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
	cfg := &Config{Theme: "dark", DownloadDir: defaultDownloadDir()}
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
