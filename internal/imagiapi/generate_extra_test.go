package imagiapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// A model-catalog parameter the client has no typed field for must reach the
// upstream request untouched, while reserved keys can never be overridden.
func TestGenerateImageExtraFields(t *testing.T) {
	var got map[string]any
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	defer done()

	_, err := c.GenerateImage(context.Background(), ImageOptions{
		Prompt: "a cat",
		Model:  "m1",
		Extra: map[string]string{
			"cameraMotion": "pan",
			"stylePreset":  "film",
			"prompt":       "hijacked",
			"model":        "other",
		},
	})
	if err != nil {
		t.Fatalf("GenerateImage: %v", err)
	}
	if got["cameraMotion"] != "pan" || got["stylePreset"] != "film" {
		t.Fatalf("extra params not forwarded: %+v", got)
	}
	if got["prompt"] != "a cat" || got["model"] != "m1" {
		t.Fatalf("reserved fields were overridden: %+v", got)
	}
}

func TestGenerateVideoExtraFieldsMultipart(t *testing.T) {
	var form map[string][]string
	c, done := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		form = r.MultipartForm.Value
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	defer done()

	_, err := c.GenerateVideo(context.Background(), VideoOptions{
		Prompt: "a dog",
		Model:  "v1",
		Extra:  map[string]string{"cameraMotion": "zoom"},
		References: []Reference{{
			Kind: "image", Filename: "a.png", MIME: "image/png",
			Data: []byte("fakepng"),
		}},
	})
	if err != nil {
		t.Fatalf("GenerateVideo: %v", err)
	}
	if len(form["cameraMotion"]) == 0 || form["cameraMotion"][0] != "zoom" {
		t.Fatalf("extra param missing from multipart form: %+v", form["cameraMotion"])
	}
}

func TestCleanExtraFiltersUnsafeKeys(t *testing.T) {
	in := map[string]string{
		"cameraMotion": "pan",
		"9bad":         "x",
		"has space":    "x",
		"prompt":       "x",
		"empty":        " ",
		"long":         strings.Repeat("x", 130),
	}
	out := CleanExtra(in)
	if len(out) != 1 || out["cameraMotion"] != "pan" {
		t.Fatalf("unexpected cleaned extras: %+v", out)
	}
}
