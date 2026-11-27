package app

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"imagiflydesk/internal/imagiapi"
)

/* 下载队列：把「保存到本地」从一条阻塞请求变成一个可观察的后台任务。
   页面只轮询 /local/downloads，服务端负责落盘、限并发、统计速度。 */

const (
	dlQueued      = "queued"
	dlDownloading = "downloading"
	dlDone        = "done"
	dlError       = "error"
	dlCanceled    = "canceled"

	dlMaxConcurrent = 2
	dlMaxLifetime   = 30 * time.Minute
)

type downloadTask struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	State     string    `json:"state"`
	Received  int64     `json:"received"`
	Total     int64     `json:"total"`
	Speed     float64   `json:"speed"`
	Path      string    `json:"path"`
	Error     string    `json:"error"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	ctx       context.Context
	cancel    context.CancelFunc
	lastAt    time.Time
	lastBytes int64
}

type downloadManager struct {
	mu    sync.Mutex
	tasks map[string]*downloadTask
	api   *imagiapi.Client
	dir   func() string
	sem   chan struct{}
}

func newDownloadManager(api *imagiapi.Client, dir func() string) *downloadManager {
	return &downloadManager{
		tasks: map[string]*downloadTask{},
		api:   api,
		dir:   dir,
		sem:   make(chan struct{}, dlMaxConcurrent),
	}
}

func (m *downloadManager) dirNow() string {
	if m.dir == nil {
		return ""
	}
	return m.dir()
}

func (m *downloadManager) snapshotLocked(t *downloadTask) map[string]any {
	return map[string]any{
		"id":        t.ID,
		"url":       t.URL,
		"name":      t.Name,
		"kind":      t.Kind,
		"state":     t.State,
		"received":  t.Received,
		"total":     t.Total,
		"speed":     t.Speed,
		"path":      t.Path,
		"error":     t.Error,
		"createdAt": t.CreatedAt.Format(time.RFC3339),
		"updatedAt": t.UpdatedAt.Format(time.RFC3339),
	}
}

func (m *downloadManager) list() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := make([]map[string]any, 0, len(m.tasks))
	for _, t := range m.tasks {
		items = append(items, m.snapshotLocked(t))
	}
	sort.Slice(items, func(i, j int) bool {
		ai := items[i]["state"] == dlDownloading || items[i]["state"] == dlQueued
		aj := items[j]["state"] == dlDownloading || items[j]["state"] == dlQueued
		if ai != aj {
			return ai
		}
		return items[i]["createdAt"].(string) > items[j]["createdAt"].(string)
	})
	return items
}

func (m *downloadManager) start(rawURL, name string) (map[string]any, error) {
	if err := imagiapi.ValidateAssetURL(rawURL); err != nil {
		return nil, badRequest(err.Error())
	}
	now := time.Now()
	id := fmt.Sprintf("dl-%x", now.UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), dlMaxLifetime)
	t := &downloadTask{
		ID:        id,
		URL:       rawURL,
		Name:      strings.TrimSpace(name),
		Kind:      mediaKind(rawURL),
		State:     dlQueued,
		CreatedAt: now,
		UpdatedAt: now,
		ctx:       ctx,
		cancel:    cancel,
		lastAt:    now,
	}
	m.mu.Lock()
	m.tasks[id] = t
	snap := m.snapshotLocked(t)
	m.mu.Unlock()

	go m.run(t)
	return snap, nil
}

func mediaKind(rawURL string) string {
	switch strings.ToLower(filepath.Ext(rawURL)) {
	case ".mp4", ".webm", ".mov", ".m4v", ".mkv":
		return "video"
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif":
		return "image"
	case ".mp3", ".wav", ".m4a", ".flac":
		return "audio"
	}
	return "file"
}

func (m *downloadManager) fail(t *downloadTask, msg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t.State == dlCanceled || t.State == dlDone {
		return
	}
	t.State = dlError
	t.Error = msg
	t.Speed = 0
	t.UpdatedAt = time.Now()
}

func (m *downloadManager) run(t *downloadTask) {
	select {
	case m.sem <- struct{}{}:
		defer func() { <-m.sem }()
	case <-t.ctx.Done():
		m.mu.Lock()
		if t.State != dlDone && t.State != dlError {
			t.State = dlCanceled
			t.Error = "已取消"
			t.UpdatedAt = time.Now()
		}
		m.mu.Unlock()
		return
	}

	m.mu.Lock()
	if t.ctx.Err() != nil {
		t.State = dlCanceled
		t.Error = "已取消"
		t.UpdatedAt = time.Now()
		m.mu.Unlock()
		return
	}
	t.State = dlDownloading
	t.UpdatedAt = time.Now()
	m.mu.Unlock()

	resp, err := m.api.Download(t.ctx, t.URL, "")
	if err != nil {
		if t.ctx.Err() != nil {
			m.mu.Lock()
			t.State = dlCanceled
			t.Error = "已取消"
			t.UpdatedAt = time.Now()
			m.mu.Unlock()
			return
		}
		m.fail(t, "连接失败："+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		m.fail(t, fmt.Sprintf("服务器返回 %d", resp.StatusCode))
		return
	}

	ct := resp.Header.Get("Content-Type")
	kind := mediaKind(t.URL)
	if strings.HasPrefix(ct, "video/") {
		kind = "video"
	} else if strings.HasPrefix(ct, "image/") {
		kind = "image"
	} else if strings.HasPrefix(ct, "audio/") {
		kind = "audio"
	}

	dir := m.dirNow()
	if dir == "" {
		m.fail(t, "下载目录不可用")
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		m.fail(t, "下载目录不可用："+err.Error())
		return
	}
	base := sanitizeName(t.Name)
	if base == "" {
		base = "imagifly-" + time.Now().Format("20060102-150405")
	}
	ext := extensionFor(ct, t.URL)
	if !strings.HasSuffix(strings.ToLower(base), ext) {
		base += ext
	}
	path := uniquePath(filepath.Join(dir, base))
	part := path + ".part"

	f, err := os.Create(part)
	if err != nil {
		m.fail(t, "无法创建文件："+err.Error())
		return
	}

	m.mu.Lock()
	t.Total = resp.ContentLength
	t.Kind = kind
	t.UpdatedAt = time.Now()
	m.mu.Unlock()

	reader := &countingReader{src: resp.Body, onRead: func(n int64) {
		m.mu.Lock()
		t.Received += n
		now := time.Now()
		if now.Sub(t.lastAt) >= 300*time.Millisecond {
			dt := now.Sub(t.lastAt).Seconds()
			delta := t.Received - t.lastBytes
			if dt > 0 && delta > 0 {
				inst := float64(delta) / dt
				if t.Speed <= 0 {
					t.Speed = inst
				} else {
					t.Speed = t.Speed*0.65 + inst*0.35
				}
			}
			t.lastAt = now
			t.lastBytes = t.Received
		}
		t.UpdatedAt = now
		m.mu.Unlock()
	}}

	written, copyErr := io.Copy(f, reader)
	closeErr := f.Close()

	if copyErr != nil {
		_ = os.Remove(part)
		if t.ctx.Err() != nil {
			m.mu.Lock()
			t.State = dlCanceled
			t.Error = "已取消"
			t.Speed = 0
			t.UpdatedAt = time.Now()
			m.mu.Unlock()
			return
		}
		m.fail(t, "下载中断："+copyErr.Error())
		return
	}
	if closeErr != nil {
		_ = os.Remove(part)
		m.fail(t, "写入失败："+closeErr.Error())
		return
	}
	if resp.ContentLength > 0 && written != resp.ContentLength {
		_ = os.Remove(part)
		m.fail(t, fmt.Sprintf("文件不完整（%d / %d 字节）", written, resp.ContentLength))
		return
	}
	if t.ctx.Err() != nil {
		_ = os.Remove(part)
		m.mu.Lock()
		t.State = dlCanceled
		t.Error = "已取消"
		t.Speed = 0
		t.UpdatedAt = time.Now()
		m.mu.Unlock()
		return
	}
	if err := os.Rename(part, path); err != nil {
		_ = os.Remove(part)
		m.fail(t, "保存失败："+err.Error())
		return
	}

	m.mu.Lock()
	t.State = dlDone
	t.Path = path
	t.Received = written
	if t.Total <= 0 {
		t.Total = written
	}
	t.Speed = 0
	t.Error = ""
	t.UpdatedAt = time.Now()
	m.mu.Unlock()
}

func (m *downloadManager) cancel(id string) error {
	m.mu.Lock()
	t, ok := m.tasks[id]
	if !ok {
		m.mu.Unlock()
		return badRequest("下载任务不存在")
	}
	state := t.State
	if state == dlDone || state == dlError || state == dlCanceled {
		m.mu.Unlock()
		return badRequest("这个任务已经结束")
	}
	t.State = dlCanceled
	t.Error = "已取消"
	t.Speed = 0
	t.UpdatedAt = time.Now()
	cancel := t.cancel
	m.mu.Unlock()
	cancel()
	return nil
}

func (m *downloadManager) remove(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tasks[id]
	if !ok {
		return badRequest("下载任务不存在")
	}
	if t.State == dlDownloading || t.State == dlQueued {
		return badRequest("任务还在进行，请先取消")
	}
	delete(m.tasks, id)
	return nil
}

func (m *downloadManager) clear() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for id, t := range m.tasks {
		if t.State == dlDone || t.State == dlError || t.State == dlCanceled {
			delete(m.tasks, id)
			n++
		}
	}
	return n
}

type countingReader struct {
	src    io.Reader
	onRead func(int64)
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.src.Read(p)
	if n > 0 && c.onRead != nil {
		c.onRead(int64(n))
	}
	return n, err
}
