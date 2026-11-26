package imagiapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
)

// Reference is one uploaded reference asset.
type Reference struct {
	Kind      string // image | video | audio | firstFrame | lastFrame
	Filename  string
	MIME      string
	Data      []byte
	Width     int
	Height    int
	SizeBytes int64
}

// ImageOptions maps 1:1 to POST /api/images/generate (spec §5.1).
type ImageOptions struct {
	Prompt              string
	NegativePrompt      string
	Model               string
	N                   int
	Size                string
	ResolutionTier      string
	Steps               string
	Quality             string
	Ratio               string
	OutputFormat        string
	ResponseFormat      string
	CommunityVisibility string

	SubmissionID string
	BatchID      string
	RequestIndex int
	RequestCount int

	References []Reference
}

// VideoOptions maps 1:1 to POST /api/videos/generate (spec §5.2).
type VideoOptions struct {
	Prompt         string
	NegativePrompt string
	Model          string
	Variant        string
	WorkflowFormat string
	Duration       string
	FPS            int
	Size           string
	Ratio          string
	Quality        string
	Seed           int64

	SubmissionID string
	BatchID      string
	RequestIndex int
	RequestCount int

	References []Reference
}

// GenerateImage submits one image request. The Idempotency-Key is derived from
// submissionId:requestIndex exactly as the site requires.
func (c *Client) GenerateImage(ctx context.Context, o ImageOptions) (json.RawMessage, error) {
	if strings.TrimSpace(o.Prompt) == "" {
		return nil, &Error{Status: http.StatusBadRequest, Code: "EMPTY_PROMPT", Message: "提示词不能为空"}
	}
	normalizeBatch(&o.SubmissionID, &o.BatchID, &o.RequestIndex, &o.RequestCount)
	if o.N <= 0 {
		o.N = 1
	}
	idem := fmt.Sprintf("%s:%d", o.SubmissionID, o.RequestIndex)

	fields := map[string]any{
		"prompt":       o.Prompt,
		"model":        o.Model,
		"n":            o.N,
		"requestIndex": o.RequestIndex,
		"requestCount": o.RequestCount,
		"submissionId": o.SubmissionID,
	}
	// Optional fields are only sent when they have a value: the upstream
	// validators treat an empty string differently from an absent field.
	for key, value := range map[string]string{
		"negativePrompt":      o.NegativePrompt,
		"size":                o.Size,
		"resolutionTier":      o.ResolutionTier,
		"steps":               o.Steps,
		"quality":             o.Quality,
		"ratio":               o.Ratio,
		"outputFormat":        o.OutputFormat,
		"responseFormat":      o.ResponseFormat,
		"communityVisibility": o.CommunityVisibility,
		"batchId":             o.BatchID,
	} {
		if strings.TrimSpace(value) != "" {
			fields[key] = value
		}
	}

	images := filterRefs(o.References, "image")
	if len(images) == 0 {
		return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/images/generate", Body: fields, Auth: true, Idempotency: idem})
	}

	form := NewForm()
	for k, v := range fields {
		switch value := v.(type) {
		case string:
			form.Set(k, value)
		case int:
			form.Set(k, fmt.Sprintf("%d", value))
		}
	}
	meta := make([]map[string]any, 0, len(images))
	for _, ref := range images {
		form.Files = append(form.Files, FileField{Field: "referenceImages", Filename: ref.Filename, ContentType: ref.MIME, Data: ref.Data})
		meta = append(meta, map[string]any{
			"name": ref.Filename, "mimeType": ref.MIME, "width": ref.Width, "height": ref.Height,
		})
	}
	if b, err := json.Marshal(meta); err == nil {
		form.Set("referenceImageMetadata", string(b))
	}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/images/generate", Form: form, Auth: true, Idempotency: idem, Timeout: 180 * time.Second})
}

// GenerateVideo submits one video request.
func (c *Client) GenerateVideo(ctx context.Context, o VideoOptions) (json.RawMessage, error) {
	if strings.TrimSpace(o.Prompt) == "" {
		return nil, &Error{Status: http.StatusBadRequest, Code: "EMPTY_PROMPT", Message: "提示词不能为空"}
	}
	normalizeBatch(&o.SubmissionID, &o.BatchID, &o.RequestIndex, &o.RequestCount)
	idem := fmt.Sprintf("%s:%d", o.SubmissionID, o.RequestIndex)

	fields := map[string]any{
		"prompt":         o.Prompt,
		"negativePrompt": o.NegativePrompt,
		"model":          o.Model,
		"variant":        o.Variant,
		"workflowFormat": o.WorkflowFormat,
		"duration":       o.Duration,
		"fps":            o.FPS,
		"size":           o.Size,
		"ratio":          o.Ratio,
		"quality":        o.Quality,
		"requestIndex":   o.RequestIndex,
		"requestCount":   o.RequestCount,
		"submissionId":   o.SubmissionID,
		"batchId":        o.BatchID,
	}
	if o.Seed != 0 {
		fields["seed"] = o.Seed
	}

	refs := o.References
	if len(refs) == 0 {
		return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/videos/generate", Body: fields, Auth: true, Idempotency: idem})
	}

	form := NewForm()
	for k, v := range fields {
		switch value := v.(type) {
		case string:
			form.Set(k, value)
		case int:
			form.Set(k, fmt.Sprintf("%d", value))
		case int64:
			form.Set(k, fmt.Sprintf("%d", value))
		}
	}
	imageMeta := make([]map[string]any, 0)
	videoMeta := make([]map[string]any, 0)
	for _, ref := range refs {
		switch ref.Kind {
		case "image":
			form.Files = append(form.Files, FileField{Field: "referenceImages", Filename: ref.Filename, ContentType: ref.MIME, Data: ref.Data})
			imageMeta = append(imageMeta, map[string]any{"name": ref.Filename, "mimeType": ref.MIME, "width": ref.Width, "height": ref.Height})
		case "video":
			form.Files = append(form.Files, FileField{Field: "referenceVideos", Filename: ref.Filename, ContentType: ref.MIME, Data: ref.Data})
			videoMeta = append(videoMeta, map[string]any{"name": ref.Filename, "mimeType": ref.MIME})
		case "audio":
			form.Files = append(form.Files, FileField{Field: "referenceAudios", Filename: ref.Filename, ContentType: ref.MIME, Data: ref.Data})
		case "firstFrame":
			form.Files = append(form.Files, FileField{Field: "firstFrame", Filename: ref.Filename, ContentType: ref.MIME, Data: ref.Data})
		case "lastFrame":
			form.Files = append(form.Files, FileField{Field: "lastFrame", Filename: ref.Filename, ContentType: ref.MIME, Data: ref.Data})
		}
	}
	if len(imageMeta) > 0 {
		if b, err := json.Marshal(imageMeta); err == nil {
			form.Set("referenceImageMetadata", string(b))
		}
	}
	if len(videoMeta) > 0 {
		if b, err := json.Marshal(videoMeta); err == nil {
			form.Set("referenceVideoMetadata", string(b))
		}
	}
	return c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/videos/generate", Form: form, Auth: true, Idempotency: idem})
}

func normalizeBatch(submission, batch *string, index, count *int) {
	if *submission == "" {
		*submission = UUID()
	}
	if *batch == "" {
		*batch = UUID()
	}
	if *index <= 0 {
		*index = 1
	}
	if *count <= 0 {
		*count = *index
	}
}

func filterRefs(refs []Reference, kind string) []Reference {
	out := make([]Reference, 0, len(refs))
	for _, ref := range refs {
		if ref.Kind == kind || (kind == "image" && ref.Kind == "") {
			out = append(out, ref)
		}
	}
	return out
}

// DecodeImageSize reads pixel dimensions for reference metadata. Unknown
// formats return 0,0 and are still uploaded.
func DecodeImageSize(data []byte) (int, int) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
}
