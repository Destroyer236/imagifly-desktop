package app

import (
	"sync"
	"time"
)

// LogEntry is one upstream request observed by the client hook.
type LogEntry struct {
	Time   string `json:"time"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Status int    `json:"status"`
	MS     int64  `json:"ms"`
}

type ringLog struct {
	mu      sync.Mutex
	entries []LogEntry
}

func newRingLog(size int) *ringLog {
	return &ringLog{entries: make([]LogEntry, 0, size)}
}

func (l *ringLog) Add(e LogEntry) {
	e.Time = time.Now().Format("15:04:05.000")
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) >= cap(l.entries) {
		copy(l.entries, l.entries[1:])
		l.entries = l.entries[:len(l.entries)-1]
	}
	l.entries = append(l.entries, e)
}

func (l *ringLog) List() []LogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]LogEntry, 0, len(l.entries))
	for i := len(l.entries) - 1; i >= 0; i-- {
		out = append(out, l.entries[i])
	}
	return out
}
