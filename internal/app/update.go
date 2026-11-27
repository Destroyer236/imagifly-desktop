package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Self-update lives entirely in the local server: the web UI never talks to
// GitHub directly, so downloads keep working with the app's own HTTP stack.
const (
	updateRepo     = "Destroyer236/imagifly-desktop"
	updateAPIURL   = "https://api.github.com/repos/" + updateRepo + "/releases/latest"
	updatePageURL  = "https://github.com/" + updateRepo + "/releases"
	updateUserAgen = "ImagiflyDesktop-Updater"
)

var updateHTTPClient = &http.Client{Timeout: 30 * time.Second}

// updateMirrors lists the download front-ends offered in the update screen.
// Prefix is prepended to the GitHub asset URL; an empty prefix means direct.
var updateMirrors = []updateMirror{
	{ID: "github", Name: "GitHub 直连", Hint: "官方源，国内网络可能不稳定"},
	{ID: "gh-proxy", Name: "gh-proxy.com", Prefix: "https://gh-proxy.com/", Hint: "公共加速节点，实测较快"},
	{ID: "hk-gh-proxy", Name: "hk.gh-proxy.com（香港）", Prefix: "https://hk.gh-proxy.com/", Hint: "香港节点，延迟较低"},
	{ID: "ghproxy-net", Name: "ghproxy.net", Prefix: "https://ghproxy.net/", Hint: "公共加速，偶发限速"},
}

type updateMirror struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Prefix string `json:"prefix"`
	Hint   string `json:"hint"`
}

type updateAsset struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
	URL    string `json:"url"`
}

type updateInfo struct {
	Current     string         `json:"current"`
	Latest      string         `json:"latest"`
	HasUpdate   bool           `json:"hasUpdate"`
	PublishedAt string         `json:"publishedAt"`
	Notes       string         `json:"notes"`
	PageURL     string         `json:"pageURL"`
	Assets      []updateAsset  `json:"assets"`
	Mirrors     []updateMirror `json:"mirrors"`
	CheckedAt   time.Time      `json:"checkedAt"`
}

type updateProgress struct {
	State    string  `json:"state"`
	Mirror   string  `json:"mirror"`
	Asset    string  `json:"asset"`
	Kind     string  `json:"kind"`
	Total    int64   `json:"total"`
	Received int64   `json:"received"`
	Speed    float64 `json:"speed"`
	Error    string  `json:"error,omitempty"`
	Path     string  `json:"path,omitempty"`
}

// --- release metadata ------------------------------------------------------

type ghRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
	Assets      []struct {
		Name   string `json:"name"`
		Size   int64  `json:"size"`
		URL    string `json:"browser_download_url"`
		Digest string `json:"digest"`
	} `json:"assets"`
}

func parseVersionParts(raw string) [3]int {
	var out [3]int
	v := strings.TrimSpace(strings.ToLower(raw))
	v = strings.TrimPrefix(v, "v")
	core := v
	for i := 0; i < len(core); i++ {
		c := core[i]
		if (c < '0' || c > '9') && c != '.' {
			core = core[:i]
			break
		}
	}
	parts := strings.Split(core, ".")
	for i := 0; i < 3 && i < len(parts); i++ {
		out[i], _ = strconv.Atoi(parts[i])
	}
	return out
}

// compareVersion reports 1 when a > b, -1 when a < b, 0 when equal.
func compareVersion(a, b string) int {
	pa, pb := parseVersionParts(a), parseVersionParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] > pb[i] {
			return 1
		}
		if pa[i] < pb[i] {
			return -1
		}
	}
	return 0
}

func assetKind(name string) string {
	lower := strings.ToLower(name)
	if strings.HasSuffix(lower, "-setup.exe") {
		return "setup"
	}
	if strings.HasSuffix(lower, ".zip") && strings.Contains(lower, "portable") {
		return "portable"
	}
	return ""
}

func (s *Server) fetchLatestRelease(force bool) (*updateInfo, error) {
	s.relMu.Lock()
	if !force && s.relInfo != nil && time.Since(s.relAt) < 5*time.Minute {
		info := *s.relInfo
		s.relMu.Unlock()
		return &info, nil
	}
	s.relMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, updateAPIURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", updateUserAgen)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := updateHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 GitHub：%v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub 返回 HTTP %d", resp.StatusCode)
	}
	var rel ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&rel); err != nil {
		return nil, fmt.Errorf("解析发布信息失败：%v", err)
	}

	latest := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	info := &updateInfo{
		Current:     s.Version,
		Latest:      latest,
		HasUpdate:   compareVersion(latest, s.Version) > 0,
		PublishedAt: rel.PublishedAt,
		Notes:       strings.TrimSpace(rel.Body),
		PageURL:     updatePageURL,
		Mirrors:     updateMirrors,
		CheckedAt:   time.Now(),
		Assets:      make([]updateAsset, 0, 2),
	}
	for _, a := range rel.Assets {
		kind := assetKind(a.Name)
		if kind == "" {
			continue
		}
		info.Assets = append(info.Assets, updateAsset{Kind: kind, Name: a.Name, Size: a.Size, Digest: a.Digest, URL: a.URL})
	}

	s.relMu.Lock()
	s.relInfo = info
	s.relAt = time.Now()
	s.relMu.Unlock()

	copied := *info
	return &copied, nil
}

func findAsset(info *updateInfo, kind string) (updateAsset, bool) {
	for _, a := range info.Assets {
		if a.Kind == kind {
			return a, true
		}
	}
	return updateAsset{}, false
}

func findMirror(id string) (updateMirror, bool) {
	for _, m := range updateMirrors {
		if m.ID == id {
			return m, true
		}
	}
	return updateMirror{}, false
}

// --- mirror probing --------------------------------------------------------

type mirrorTest struct {
	ID    string `json:"id"`
	OK    bool   `json:"ok"`
	MS    int64  `json:"ms"`
	Error string `json:"error,omitempty"`
}

func probeMirror(ctx context.Context, m updateMirror, asset string) mirrorTest {
	out := mirrorTest{ID: m.ID}
	client := &http.Client{Timeout: 12 * time.Second}
	url := m.Prefix + asset
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err == nil {
		req.Header.Set("User-Agent", updateUserAgen)
		var resp *http.Response
		resp, err = client.Do(req)
		if err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1))
			resp.Body.Close()
			if resp.StatusCode >= 400 {
				err = fmt.Errorf("HTTP %d", resp.StatusCode)
			}
		}
	}
	out.MS = time.Since(start).Milliseconds()
	if err != nil {
		if ctx.Err() != nil {
			out.Error = "超时"
		} else if strings.Contains(err.Error(), "certificate") || strings.Contains(err.Error(), "SSL") {
			out.Error = "证书错误"
		} else {
			out.Error = err.Error()
			if len(out.Error) > 60 {
				out.Error = out.Error[:60]
			}
		}
		return out
	}
	out.OK = true
	return out
}

// --- downloader ------------------------------------------------------------

type updateSink struct {
	s     *Server
	mu    sync.Mutex
	last  time.Time
	inner int64
}

func (p *updateSink) Write(b []byte) (int, error) {
	n := len(b)
	p.mu.Lock()
	p.inner += int64(n)
	now := time.Now()
	var speed float64
	if d := now.Sub(p.last); d >= 700*time.Millisecond {
		speed = float64(p.inner) / d.Seconds()
		p.inner = 0
		p.last = now
	}
	p.mu.Unlock()

	p.s.updMu.Lock()
	p.s.updProg.Received += int64(n)
	if speed > 0 {
		p.s.updProg.Speed = speed
	}
	p.s.updMu.Unlock()
	return n, nil
}

func updatesDir() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, "updates")
	return path, os.MkdirAll(path, 0o755)
}

func (s *Server) progressSnapshot() updateProgress {
	s.updMu.Lock()
	defer s.updMu.Unlock()
	return s.updProg
}

func (s *Server) startDownload(mirrorID, kind string) (updateProgress, error) {
	info, err := s.fetchLatestRelease(false)
	if err != nil {
		return updateProgress{}, err
	}
	asset, ok := findAsset(info, kind)
	if !ok {
		return updateProgress{}, badRequest("这个版本没有提供该格式的安装包")
	}
	mirror, ok := findMirror(mirrorID)
	if !ok {
		return updateProgress{}, badRequest("未知的下载镜像")
	}

	s.updMu.Lock()
	if s.updProg.State == "downloading" {
		s.updMu.Unlock()
		return updateProgress{}, &clientError{status: http.StatusConflict, code: "busy", message: "已有下载任务在进行，请先等待或取消"}
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.updCancel = cancel
	s.updProg = updateProgress{
		State:  "downloading",
		Mirror: mirror.ID,
		Asset:  asset.Name,
		Kind:   asset.Kind,
		Total:  asset.Size,
	}
	s.updMu.Unlock()

	go s.download(ctx, mirror, asset)
	return s.progressSnapshot(), nil
}

func (s *Server) download(ctx context.Context, mirror updateMirror, asset updateAsset) {
	fail := func(err error) {
		s.updMu.Lock()
		if ctx.Err() != nil {
			// Cancelled by the user: go back to idle instead of an error state.
			s.updProg.State = "idle"
			s.updProg.Error = ""
		} else {
			s.updProg.State = "error"
			s.updProg.Error = err.Error()
		}
		s.updCancel = nil
		s.updMu.Unlock()
	}

	dir, err := updatesDir()
	if err != nil {
		fail(fmt.Errorf("无法创建下载目录：%v", err))
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mirror.Prefix+asset.URL, nil)
	if err != nil {
		fail(err)
		return
	}
	req.Header.Set("User-Agent", updateUserAgen)
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		if ctx.Err() != nil {
			fail(errors.New("下载已取消"))
		} else {
			fail(fmt.Errorf("%s 下载失败：%v", mirror.Name, err))
		}
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fail(fmt.Errorf("%s 返回 HTTP %d", mirror.Name, resp.StatusCode))
		return
	}

	dest := filepath.Join(dir, filepath.Base(asset.Name))
	part := dest + ".part"
	file, err := os.Create(part)
	if err != nil {
		fail(fmt.Errorf("无法写入安装包：%v", err))
		return
	}

	s.updMu.Lock()
	if resp.ContentLength > 0 {
		s.updProg.Total = resp.ContentLength
	}
	s.updMu.Unlock()

	sink := &updateSink{s: s, last: time.Now()}
	written, copyErr := io.Copy(file, io.TeeReader(resp.Body, sink))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(part)
		if ctx.Err() != nil {
			fail(errors.New("下载已取消"))
		} else if copyErr != nil {
			fail(fmt.Errorf("下载中断：%v", copyErr))
		} else {
			fail(fmt.Errorf("写入失败：%v", closeErr))
		}
		return
	}
	if err := os.Rename(part, dest); err != nil {
		_ = os.Remove(part)
		fail(fmt.Errorf("保存安装包失败：%v", err))
		return
	}

	s.updMu.Lock()
	s.updProg.State = "done"
	s.updProg.Received = written
	s.updProg.Total = written
	s.updProg.Path = dest
	s.updProg.Speed = 0
	s.updCancel = nil
	s.updMu.Unlock()

	// A freshly downloaded package replaces every older one.
	pruneInstallers(dest, 0)
}

func (s *Server) cancelDownload() updateProgress {
	s.updMu.Lock()
	cancel := s.updCancel
	s.updMu.Unlock()
	if cancel != nil {
		cancel()
	}
	s.updMu.Lock()
	if s.updProg.State == "downloading" {
		s.updProg.State = "idle"
		s.updProg.Error = ""
	}
	s.updProg.Speed = 0
	s.updMu.Unlock()
	return s.progressSnapshot()
}

func (s *Server) installDownloaded() (any, error) {
	p := s.progressSnapshot()
	if p.State != "done" || p.Path == "" {
		return nil, badRequest("安装包还没有下载完成")
	}
	if !strings.HasSuffix(strings.ToLower(p.Path), ".exe") {
		return nil, badRequest("便携版是压缩包，请点「打开下载目录」后手动解压；安装版才可以直接安装")
	}
	if _, err := os.Stat(p.Path); err != nil {
		return nil, badRequest("安装包不存在，请重新下载")
	}
	cmd := exec.Command(p.Path,
		"/VERYSILENT",
		"/SUPPRESSMSGBOXES",
		"/NORESTART",
		"/CLOSEAPPLICATIONS",
		"/SRC="+p.Path,
	)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动安装程序失败：%v", err)
	}
	// The installer closes this process; the new build deletes the package.
	go func() {
		time.Sleep(20 * time.Second)
		pruneInstallers(p.Path, 5*time.Minute)
	}()
	return map[string]any{"started": true, "path": p.Path}, nil
}

// pruneInstallers deletes leftover installers in the updates directory except
// keep. maxAge 0 means "delete regardless of age".
func pruneInstallers(keep string, maxAge time.Duration) {
	dir, err := updatesDir()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	keepAbs := ""
	if keep != "" {
		if abs, err := filepath.Abs(keep); err == nil {
			keepAbs = abs
		}
	}
	now := time.Now()
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := strings.ToLower(e.Name())
		if !strings.HasSuffix(name, ".exe") && !strings.HasSuffix(name, ".zip") && !strings.HasSuffix(name, ".part") {
			continue
		}
		full := filepath.Join(dir, e.Name())
		if abs, err := filepath.Abs(full); err == nil && abs == keepAbs {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if maxAge > 0 && now.Sub(info.ModTime()) < maxAge {
			continue
		}
		_ = os.Remove(full)
	}
}

// removeWithRetry deletes a file the installer just used; Windows releases the
// handle a moment after the setup process exits.
func removeWithRetry(path string) {
	path = strings.Trim(strings.TrimSpace(path), `"`)
	if path == "" {
		return
	}
	for i := 0; i < 40; i++ {
		err := os.Remove(path)
		if err == nil || errors.Is(err, os.ErrNotExist) {
			return
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// CleanupInstallers runs at startup: it honours the installer's cleanup flag
// and sweeps stale packages left behind by earlier updates.
func CleanupInstallers() {
	// Strip our own flags so flag.Parse does not reject the installer's args.
	if len(os.Args) > 1 {
		kept := os.Args[:1]
		for _, arg := range os.Args[1:] {
			if strings.HasPrefix(strings.ToLower(arg), "--cleanup-installer=") {
				path := arg[len("--cleanup-installer="):]
				if strings.TrimSpace(path) != "" {
					go removeWithRetry(path)
				}
				continue
			}
			kept = append(kept, arg)
		}
		os.Args = kept
	}
	go pruneInstallers("", 60*time.Minute)
}

// --- HTTP handlers ---------------------------------------------------------

func (s *Server) handleUpdateInfo(ctx context.Context, r *http.Request) (any, error) {
	force := r.URL.Query().Get("force") != ""
	return s.fetchLatestRelease(force)
}

func (s *Server) handleUpdateMirrorTest(ctx context.Context, r *http.Request) (any, error) {
	info, err := s.fetchLatestRelease(false)
	if err != nil {
		return nil, err
	}
	asset := ""
	if a, ok := findAsset(info, "setup"); ok {
		asset = a.URL
	} else if a, ok := findAsset(info, "portable"); ok {
		asset = a.URL
	}
	if asset == "" {
		return nil, badRequest("最新版本没有可下载的资产")
	}
	results := make([]mirrorTest, len(updateMirrors))
	var wg sync.WaitGroup
	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	for i, m := range updateMirrors {
		wg.Add(1)
		go func(i int, m updateMirror) {
			defer wg.Done()
			results[i] = probeMirror(cctx, m, asset)
		}(i, m)
	}
	wg.Wait()
	return map[string]any{"mirrors": results, "at": time.Now()}, nil
}

func (s *Server) handleUpdateDownload(ctx context.Context, r *http.Request) (any, error) {
	var body struct {
		Mirror string `json:"mirror"`
		Kind   string `json:"kind"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil {
		return nil, badRequest("请求格式不正确")
	}
	if body.Kind != "setup" && body.Kind != "portable" {
		return nil, badRequest("未知的安装包格式")
	}
	progress, err := s.startDownload(body.Mirror, body.Kind)
	if err != nil {
		return nil, err
	}
	return map[string]any{"progress": progress}, nil
}

func (s *Server) handleUpdateStatus(ctx context.Context, r *http.Request) (any, error) {
	dir, err := updatesDir()
	if err != nil {
		dir = ""
	}
	return map[string]any{"progress": s.progressSnapshot(), "dir": dir}, nil
}

func (s *Server) handleUpdateCancel(ctx context.Context, r *http.Request) (any, error) {
	return map[string]any{"progress": s.cancelDownload()}, nil
}

func (s *Server) handleUpdateInstall(ctx context.Context, r *http.Request) (any, error) {
	return s.installDownloaded()
}

func (s *Server) handleUpdateOpenFolder(ctx context.Context, r *http.Request) (any, error) {
	dir, err := updatesDir()
	if err != nil {
		return nil, err
	}
	if p := s.progressSnapshot(); p.Path != "" {
		if _, statErr := os.Stat(p.Path); statErr == nil {
			return map[string]any{"opened": p.Path}, revealInExplorer(p.Path)
		}
	}
	return map[string]any{"opened": dir}, openFolder(dir)
}
