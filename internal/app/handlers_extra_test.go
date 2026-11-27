package app

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"
)

// The local generate route must pick up model-catalog parameters it has no
// typed field for, while never letting them override prompt/model.
func TestReadImageOptionsCapturesCatalogExtras(t *testing.T) {
	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	for key, value := range map[string]string{
		"prompt":       "a cat",
		"model":        "gpt-image-2",
		"n":            "2",
		"cameraMotion": "pan",
		"stylePreset":  "film",
	} {
		if err := mw.WriteField(key, value); err != nil {
			t.Fatalf("write field %s: %v", key, err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest("POST", "/local/images/generate", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	opts, err := readImageOptions(req)
	if err != nil {
		t.Fatalf("readImageOptions: %v", err)
	}
	if opts.Prompt != "a cat" || opts.Model != "gpt-image-2" || opts.N != 2 {
		t.Fatalf("typed fields broken: %+v", opts)
	}
	if opts.Extra["cameraMotion"] != "pan" || opts.Extra["stylePreset"] != "film" {
		t.Fatalf("catalog extras missing: %+v", opts.Extra)
	}
	for _, reserved := range []string{"prompt", "model", "n"} {
		if _, ok := opts.Extra[reserved]; ok {
			t.Fatalf("reserved key leaked into extras: %s", reserved)
		}
	}
}
