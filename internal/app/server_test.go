package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoopbackOnly(t *testing.T) {
	cases := []struct {
		name   string
		host   string
		origin string
		site   string
		want   int
	}{
		{"loopback", "127.0.0.1:4321", "", "", http.StatusOK},
		{"localhost", "localhost:4321", "http://localhost:4321", "same-origin", http.StatusOK},
		{"evil host", "evil.example.com", "", "", http.StatusForbidden},
		{"evil origin", "127.0.0.1:4321", "https://evil.example.com", "", http.StatusForbidden},
		{"cross site", "127.0.0.1:4321", "", "cross-site", http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/local/health", nil)
			r.Host = tc.host
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if tc.site != "" {
				r.Header.Set("Sec-Fetch-Site", tc.site)
			}
			w := httptest.NewRecorder()
			loopbackOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})).ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d", w.Code, tc.want)
			}
		})
	}
}
