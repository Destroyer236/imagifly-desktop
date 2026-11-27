package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"imagiflydesk/internal/imagiapi"
)

// --- auth ------------------------------------------------------------------

func (s *Server) handleSession(ctx context.Context, r *http.Request) (any, error) {
	empty := map[string]any{"user": nil, "billing": nil}

	s.accountsMu.Lock()
	book := loadAccountBook()
	hasAccounts := len(book.Accounts) > 0
	s.accountsMu.Unlock()
	if !hasAccounts {
		s.API.SetSession("")
		return empty, nil
	}

	// Try the selected account first. If its cookie expired, drop it and fall
	// through to the next remembered account instead of showing a blank login.
	for attempt := 0; attempt < len(book.Accounts); attempt++ {
		s.accountsMu.Lock()
		book = loadAccountBook()
		active := book.active()
		if active == nil {
			s.accountsMu.Unlock()
			break
		}
		s.API.SetSession(active.Session)
		s.accountsMu.Unlock()

		me, err := s.API.Me(ctx)
		if err != nil {
			if !imagiapi.IsAuthError(err) {
				return nil, err
			}
			s.accountsMu.Lock()
			book = loadAccountBook()
			book.removeActive()
			_ = saveAccountBook(book)
			s.accountsMu.Unlock()
			continue
		}
		if me.User == nil {
			s.accountsMu.Lock()
			book = loadAccountBook()
			book.removeActive()
			_ = saveAccountBook(book)
			s.accountsMu.Unlock()
			continue
		}
		s.accountsMu.Lock()
		book = loadAccountBook()
		book.upsert(me.User, me.Billing, s.API.Session(), true)
		_ = saveAccountBook(book)
		s.accountsMu.Unlock()
		return me, nil
	}

	s.API.SetSession("")
	return empty, nil
}

func (s *Server) handleAccounts(ctx context.Context, r *http.Request) (any, error) {
	s.accountsMu.Lock()
	defer s.accountsMu.Unlock()
	book := loadAccountBook()
	if active := book.active(); active != nil && s.API.Session() == "" {
		s.API.SetSession(active.Session)
	}
	return book.view(), nil
}

func (s *Server) handleAddAccount(ctx context.Context, r *http.Request) (any, error) {
	if s.Demo {
		return nil, badRequest("演示模式不支持添加账号")
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	in.Email = strings.TrimSpace(in.Email)
	if in.Email == "" || in.Password == "" {
		return nil, badRequest("请填写邮箱和密码")
	}

	// Use a temporary client so an unsuccessful add can never disturb the
	// account that is currently active in the main API client.
	client := imagiapi.New()
	client.Hook = s.API.Hook
	sess, err := client.Login(ctx, in.Email, in.Password)
	if err != nil {
		return nil, err
	}
	if sess.User == nil {
		me, meErr := client.Me(ctx)
		if meErr != nil {
			return nil, meErr
		}
		sess = me
	}
	if sess.User == nil {
		return nil, badRequest("登录成功但未能读取账号资料")
	}

	s.accountsMu.Lock()
	defer s.accountsMu.Unlock()
	book := loadAccountBook()
	account := book.upsert(sess.User, sess.Billing, client.Session(), true)
	if account == nil {
		return nil, badRequest("账号信息不完整")
	}
	if err := saveAccountBook(book); err != nil {
		return nil, fmt.Errorf("账号保存失败: %w", err)
	}
	s.API.SetSession(account.Session)
	return map[string]any{
		"ok":       true,
		"user":     sess.User,
		"billing":  sess.Billing,
		"accounts": book.view(),
	}, nil
}

func (s *Server) handleSwitchAccount(ctx context.Context, r *http.Request) (any, error) {
	if s.Demo {
		return nil, badRequest("演示模式不支持切换账号")
	}
	var in struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	in.ID = strings.TrimSpace(in.ID)
	if in.ID == "" {
		return nil, badRequest("缺少账号 ID")
	}

	s.accountsMu.Lock()
	defer s.accountsMu.Unlock()
	book := loadAccountBook()
	account := book.find(in.ID)
	if account == nil {
		return nil, badRequest("账号不在本机账号列表中")
	}
	book.ActiveID = account.ID
	if err := saveAccountBook(book); err != nil {
		return nil, fmt.Errorf("账号保存失败: %w", err)
	}
	s.API.SetSession(account.Session)
	return map[string]any{"ok": true, "accounts": book.view()}, nil
}

func (s *Server) handleRemoveAccount(ctx context.Context, r *http.Request) (any, error) {
	if s.Demo {
		return nil, badRequest("演示模式不支持移除账号")
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		return nil, badRequest("缺少账号 ID")
	}

	s.accountsMu.Lock()
	book := loadAccountBook()
	target := book.find(id)
	if target == nil {
		s.accountsMu.Unlock()
		return nil, badRequest("账号不在本机账号列表中")
	}
	wasActive := book.active() != nil && book.active().ID == target.ID
	session := target.Session
	s.accountsMu.Unlock()

	// Best-effort upstream logout of the account being removed. Failure (for
	// example an already expired cookie) must not keep it on this device.
	client := imagiapi.New()
	client.Hook = s.API.Hook
	client.SetSession(session)
	_ = client.Logout(ctx)

	s.accountsMu.Lock()
	defer s.accountsMu.Unlock()
	book = loadAccountBook()
	book.remove(id)
	if wasActive {
		if next := book.active(); next != nil {
			s.API.SetSession(next.Session)
		} else {
			s.API.SetSession("")
			_ = ClearSession()
		}
	}
	if err := saveAccountBook(book); err != nil {
		return nil, fmt.Errorf("账号保存失败: %w", err)
	}
	return map[string]any{
		"ok":       true,
		"loggedIn": s.API.LoggedIn(),
		"accounts": book.view(),
	}, nil
}

func (s *Server) handleLogin(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	in.Email = strings.TrimSpace(in.Email)
	if in.Email == "" || in.Password == "" {
		return nil, badRequest("请填写邮箱和密码")
	}
	sess, err := s.API.Login(ctx, in.Email, in.Password)
	if err != nil {
		return nil, err
	}
	if sess.User == nil {
		me, meErr := s.API.Me(ctx)
		if meErr != nil {
			return nil, meErr
		}
		sess = me
	}
	if sess.User == nil {
		return nil, badRequest("登录成功但未能读取账号资料")
	}
	s.accountsMu.Lock()
	book := loadAccountBook()
	account := book.upsert(sess.User, sess.Billing, s.API.Session(), true)
	s.accountsMu.Unlock()
	if account == nil {
		return nil, badRequest("账号信息不完整")
	}
	if err := saveAccountBook(book); err != nil {
		return nil, fmt.Errorf("会话保存失败: %w", err)
	}
	return sess, nil
}

func (s *Server) handleRegister(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if len([]rune(in.Name)) < 2 {
		return nil, badRequest("昵称至少需要 2 个字符")
	}
	if strings.TrimSpace(in.Email) == "" || len(in.Password) < 6 {
		return nil, badRequest("请填写有效邮箱和至少 6 位密码")
	}
	sess, err := s.API.Register(ctx, in.Name, strings.TrimSpace(in.Email), in.Password)
	if err != nil {
		return nil, err
	}
	if s.API.LoggedIn() {
		if sess.User == nil {
			if me, meErr := s.API.Me(ctx); meErr == nil {
				sess = me
			}
		}
		if sess.User != nil {
			s.accountsMu.Lock()
			book := loadAccountBook()
			book.upsert(sess.User, sess.Billing, s.API.Session(), true)
			s.accountsMu.Unlock()
			if err := saveAccountBook(book); err != nil {
				return nil, fmt.Errorf("会话保存失败: %w", err)
			}
		}
	}
	return map[string]any{
		"registered": true,
		"loggedIn":   s.API.LoggedIn(),
		"user":       sess.User,
	}, nil
}

func (s *Server) handleLogout(ctx context.Context, r *http.Request) (any, error) {
	if s.Demo {
		return nil, badRequest("演示模式不支持退出登录")
	}
	err := s.API.Logout(ctx)

	s.accountsMu.Lock()
	defer s.accountsMu.Unlock()
	book := loadAccountBook()
	book.removeActive()
	if next := book.active(); next != nil {
		s.API.SetSession(next.Session)
	} else {
		s.API.SetSession("")
		_ = ClearSession()
	}
	if saveErr := saveAccountBook(book); saveErr != nil {
		return nil, fmt.Errorf("账号保存失败: %w", saveErr)
	}
	if err != nil && !imagiapi.IsAuthError(err) {
		// The local account is already removed; treat an unreachable upstream as
		// a local logout rather than trapping the user in a broken session.
		return map[string]any{"ok": true, "loggedIn": s.API.LoggedIn(), "accounts": book.view()}, nil
	}
	return map[string]any{"ok": true, "loggedIn": s.API.LoggedIn(), "accounts": book.view()}, nil
}

// --- profile ---------------------------------------------------------------

func (s *Server) handleUpdateProfile(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Name    string `json:"name"`
		Bio     string `json:"profileBio"`
		HasName bool   `json:"hasName"`
		HasBio  bool   `json:"hasBio"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	name := in.Name
	bio := in.Bio
	if in.HasName && len([]rune(name)) < 2 {
		return nil, badRequest("昵称至少需要 2 个字符")
	}
	return s.API.UpdateProfile(ctx, name, bio)
}

func (s *Server) handleAvatar(ctx context.Context, r *http.Request) (any, error) {
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		return nil, badRequest("头像上传解析失败: " + err.Error())
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("avatar")
	}
	if err != nil {
		return nil, badRequest("缺少头像文件")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (5<<20)+1))
	if err != nil {
		return nil, badRequest("读取头像失败")
	}
	if len(data) > 5<<20 {
		return nil, badRequest("头像不能超过 5 MB")
	}
	ct := header.Header.Get("Content-Type")
	if ct == "" {
		ct = http.DetectContentType(data)
	}
	return s.API.UploadAvatar(ctx, data, header.Filename, ct)
}

func (s *Server) handleDeleteAvatar(ctx context.Context, r *http.Request) (any, error) {
	return s.API.DeleteAvatar(ctx)
}

func (s *Server) handlePassword(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Current string `json:"currentPassword"`
		New     string `json:"newPassword"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.Current == "" || len(in.New) < 6 {
		return nil, badRequest("请填写当前密码，且新密码至少 6 位")
	}
	return s.API.ChangePassword(ctx, in.Current, in.New)
}

// --- generation -----------------------------------------------------------

func (s *Server) handleGenerateImage(ctx context.Context, r *http.Request) (any, error) {
	opts, err := readImageOptions(r)
	if err != nil {
		return nil, err
	}
	return s.API.GenerateImage(ctx, opts)
}

func (s *Server) handleGenerateVideo(ctx context.Context, r *http.Request) (any, error) {
	opts, err := readVideoOptions(r)
	if err != nil {
		return nil, err
	}
	return s.API.GenerateVideo(ctx, opts)
}

func isMultipart(r *http.Request) bool {
	return strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data")
}

func readImageOptions(r *http.Request) (imagiapi.ImageOptions, error) {
	var o imagiapi.ImageOptions
	if isMultipart(r) {
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			return o, badRequest("表单解析失败: " + err.Error())
		}
		o.Prompt = strings.TrimSpace(formValue(r, "prompt"))
		o.NegativePrompt = formValue(r, "negativePrompt")
		o.Model = formValue(r, "model")
		o.N = atoiDefault(formValue(r, "n"), 1)
		o.Size = formValue(r, "size")
		o.ResolutionTier = formValue(r, "resolutionTier")
		o.Steps = formValue(r, "steps")
		o.Quality = formValue(r, "quality")
		o.Ratio = formValue(r, "ratio")
		o.OutputFormat = formValue(r, "outputFormat")
		o.ResponseFormat = formValue(r, "responseFormat")
		o.CommunityVisibility = formValue(r, "communityVisibility")
		o.Extra = formExtras(r)
		refs, err := collectReferences(r.MultipartForm)
		if err != nil {
			return o, err
		}
		o.References = refs
	} else {
		var in struct {
			Prompt              string            `json:"prompt"`
			NegativePrompt      string            `json:"negativePrompt"`
			Model               string            `json:"model"`
			N                   int               `json:"n"`
			Size                string            `json:"size"`
			ResolutionTier      string            `json:"resolutionTier"`
			Steps               string            `json:"steps"`
			Quality             string            `json:"quality"`
			Ratio               string            `json:"ratio"`
			OutputFormat        string            `json:"outputFormat"`
			ResponseFormat      string            `json:"responseFormat"`
			CommunityVisibility string            `json:"communityVisibility"`
			Extra               map[string]string `json:"extra"`
		}
		if err := decodeJSON(r, &in); err != nil {
			return o, err
		}
		o.Prompt, o.NegativePrompt, o.Model, o.Size = in.Prompt, in.NegativePrompt, in.Model, in.Size
		o.N, o.ResolutionTier, o.Steps = in.N, in.ResolutionTier, in.Steps
		o.Quality, o.Ratio, o.OutputFormat = in.Quality, in.Ratio, in.OutputFormat
		o.ResponseFormat, o.CommunityVisibility = in.ResponseFormat, in.CommunityVisibility
		o.Extra = imagiapi.CleanExtra(in.Extra)
	}
	if strings.TrimSpace(o.Prompt) == "" {
		return o, badRequest("提示词不能为空")
	}
	if o.N <= 0 {
		o.N = 1
	}
	if o.N > 4 {
		o.N = 4
	}
	return o, nil
}

func readVideoOptions(r *http.Request) (imagiapi.VideoOptions, error) {
	var o imagiapi.VideoOptions
	if isMultipart(r) {
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			return o, badRequest("表单解析失败: " + err.Error())
		}
		o.Prompt = strings.TrimSpace(formValue(r, "prompt"))
		o.NegativePrompt = formValue(r, "negativePrompt")
		o.Model = formValue(r, "model")
		o.Variant = formValue(r, "variant")
		o.WorkflowFormat = formValue(r, "workflowFormat")
		o.Duration = formValue(r, "duration")
		o.FPS = atoiDefault(formValue(r, "fps"), 0)
		o.Size = formValue(r, "size")
		o.Ratio = formValue(r, "ratio")
		o.Quality = formValue(r, "quality")
		o.Seed, _ = strconv.ParseInt(formValue(r, "seed"), 10, 64)
		o.Extra = formExtras(r)
		refs, err := collectReferences(r.MultipartForm)
		if err != nil {
			return o, err
		}
		o.References = refs
	} else {
		var in struct {
			Prompt         string            `json:"prompt"`
			NegativePrompt string            `json:"negativePrompt"`
			Model          string            `json:"model"`
			Variant        string            `json:"variant"`
			WorkflowFormat string            `json:"workflowFormat"`
			Duration       string            `json:"duration"`
			FPS            int               `json:"fps"`
			Size           string            `json:"size"`
			Ratio          string            `json:"ratio"`
			Quality        string            `json:"quality"`
			Seed           int64             `json:"seed"`
			Extra          map[string]string `json:"extra"`
		}
		if err := decodeJSON(r, &in); err != nil {
			return o, err
		}
		o.Prompt, o.NegativePrompt, o.Model = in.Prompt, in.NegativePrompt, in.Model
		o.Variant, o.WorkflowFormat, o.Duration = in.Variant, in.WorkflowFormat, in.Duration
		o.FPS, o.Size, o.Ratio = in.FPS, in.Size, in.Ratio
		o.Quality, o.Seed = in.Quality, in.Seed
		o.Extra = imagiapi.CleanExtra(in.Extra)
	}
	if strings.TrimSpace(o.Prompt) == "" {
		return o, badRequest("提示词不能为空")
	}
	return o, nil
}

func collectReferences(form *multipart.Form) ([]imagiapi.Reference, error) {
	if form == nil {
		return nil, nil
	}
	kinds := map[string]string{
		"ref_image": "image",
		"ref_video": "video",
		"ref_audio": "audio",
		"ref_first": "firstFrame",
		"ref_last":  "lastFrame",
	}
	var refs []imagiapi.Reference
	for field, kind := range kinds {
		files := form.File[field]
		for _, fh := range files {
			if fh.Size > 10<<20 {
				return nil, badRequest("参考素材超过 10MB：" + fh.Filename)
			}
			f, err := fh.Open()
			if err != nil {
				return nil, err
			}
			data, err := io.ReadAll(io.LimitReader(f, 10<<20))
			f.Close()
			if err != nil {
				return nil, err
			}
			ct := fh.Header.Get("Content-Type")
			if ct == "" || ct == "application/octet-stream" {
				ct = http.DetectContentType(data)
			}
			ref := imagiapi.Reference{Kind: kind, Filename: fh.Filename, MIME: ct, Data: data, SizeBytes: fh.Size}
			if kind == "image" || kind == "firstFrame" || kind == "lastFrame" {
				ref.Width, ref.Height = imagiapi.DecodeImageSize(data)
			}
			refs = append(refs, ref)
		}
	}
	return refs, nil
}

func formValue(r *http.Request, key string) string {
	if r.MultipartForm == nil {
		return ""
	}
	if v := r.MultipartForm.Value[key]; len(v) > 0 {
		return strings.TrimSpace(v[0])
	}
	return ""
}

// formExtras picks up model-catalog parameters that this build has no typed
// field for. CleanExtra drops reserved keys (prompt/model/…) and anything that
// is not a short scalar, so only genuine upstream parameters survive.
func formExtras(r *http.Request) map[string]string {
	if r.MultipartForm == nil || len(r.MultipartForm.Value) == 0 {
		return nil
	}
	raw := make(map[string]string, len(r.MultipartForm.Value))
	for key, values := range r.MultipartForm.Value {
		if len(values) > 0 {
			raw[key] = values[0]
		}
	}
	return imagiapi.CleanExtra(raw)
}

func atoiDefault(s string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return def
	}
	return n
}

func (s *Server) handleTasks(ctx context.Context, r *http.Request) (any, error) {
	limit := atoiDefault(r.URL.Query().Get("limit"), 20)
	return s.API.Tasks(ctx, limit, r.URL.Query().Get("submissionId"))
}

func (s *Server) handleGenerationDetail(ctx context.Context, r *http.Request) (any, error) {
	return s.API.Generation(ctx, r.PathValue("id"))
}

func (s *Server) handleDeleteGeneration(ctx context.Context, r *http.Request) (any, error) {
	return s.API.DeleteGeneration(ctx, r.PathValue("id"))
}

// --- gallery ---------------------------------------------------------------

func (s *Server) handleGallery(ctx context.Context, r *http.Request) (any, error) {
	return s.API.GallerySection(ctx, r.URL.Query().Get("section"), atoiDefault(r.URL.Query().Get("offset"), 0), atoiDefault(r.URL.Query().Get("limit"), 24))
}

func (s *Server) handleLike(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		GenerationID string `json:"generationId"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.GenerationID == "" {
		return nil, badRequest("缺少 generationId")
	}
	return s.API.LikeGeneration(ctx, in.GenerationID)
}

func (s *Server) handleUnlike(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		GenerationID string `json:"generationId"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.GenerationID == "" {
		return nil, badRequest("缺少 generationId")
	}
	return s.API.UnlikeGeneration(ctx, in.GenerationID)
}

// --- community -------------------------------------------------------------

func (s *Server) handleFollows(ctx context.Context, r *http.Request) (any, error) {
	return s.API.FollowsPage(ctx, atoiDefault(r.URL.Query().Get("offset"), 0))
}

func communityQuery(r *http.Request) imagiapi.CommunityQuery {
	q := r.URL.Query()
	return imagiapi.CommunityQuery{
		Mode:   q.Get("mode"),
		Tag:    q.Get("tag"),
		Q:      q.Get("q"),
		Author: q.Get("author"),
		Offset: atoiDefault(q.Get("offset"), 0),
	}
}

func (s *Server) handleCommunity(ctx context.Context, r *http.Request) (any, error) {
	return s.API.Community(ctx, communityQuery(r))
}

func (s *Server) handleCommunityDynamic(ctx context.Context, r *http.Request) (any, error) {
	return s.API.CommunityDynamic(ctx, communityQuery(r))
}

func (s *Server) handleCommunityItem(ctx context.Context, r *http.Request) (any, error) {
	return s.API.CommunityItem(ctx, r.PathValue("id"))
}

func (s *Server) handleRemix(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		CommunityID  string `json:"communityGenerationId"`
		GenerationID string `json:"generationId"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.CommunityID == "" || in.GenerationID == "" {
		return nil, badRequest("缺少二创参数")
	}
	return s.API.Remix(ctx, in.CommunityID, in.GenerationID)
}

func (s *Server) handleCommunityPatch(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		GenerationIDs []string `json:"generationIds"`
		Visibility    string   `json:"visibility"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if len(in.GenerationIDs) == 0 {
		return nil, badRequest("缺少 generationIds")
	}
	if in.Visibility != "public" && in.Visibility != "private" {
		return nil, badRequest("visibility 只能是 public 或 private")
	}
	return s.API.SetCommunityVisibility(ctx, r.PathValue("id"), in.GenerationIDs, in.Visibility)
}

func (s *Server) handleFollow(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		ViewerID  string `json:"viewerId"`
		CreatorID string `json:"creatorId"`
		Following bool   `json:"following"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.CreatorID == "" {
		return nil, badRequest("缺少 creatorId")
	}
	return s.API.SetFollow(ctx, in.ViewerID, in.CreatorID, in.Following)
}

func (s *Server) handleReport(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		CommunityID string `json:"communityGenerationId"`
		Reason      string `json:"reason"`
		Details     string `json:"details"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.CommunityID == "" || strings.TrimSpace(in.Reason) == "" {
		return nil, badRequest("请选择举报原因")
	}
	return s.API.Report(ctx, in.CommunityID, in.Reason, in.Details)
}

// --- notifications ---------------------------------------------------------

func (s *Server) handleNotificationsPatch(ctx context.Context, r *http.Request) (any, error) {
	q := r.URL.Query()
	all := q.Get("all") == "1"
	id := q.Get("id")
	if !all && id == "" {
		return nil, badRequest("缺少 id 或 all=1")
	}
	return s.API.MarkNotification(ctx, q.Get("uid"), id, all)
}

func (s *Server) handleNotificationsClear(ctx context.Context, r *http.Request) (any, error) {
	return s.API.ClearNotifications(ctx, r.URL.Query().Get("uid"))
}

// --- referral / redemption / billing --------------------------------------

func (s *Server) handleCapture(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	in.Token = strings.TrimSpace(in.Token)
	if in.Token == "" {
		return nil, badRequest("请输入邀请码")
	}
	return s.API.CaptureReferral(ctx, in.Token)
}

func (s *Server) handleRedeem(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Code   string `json:"code"`
		UserID string `json:"userId"`
		Locale string `json:"locale"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	code := strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(in.Code))
	if len(code) != 24 || !isHex(code) {
		return nil, badRequest("兑换码需为 24 位十六进制字符串")
	}
	if in.UserID == "" {
		me, err := s.API.Me(ctx)
		if err != nil || me.User == nil {
			return nil, badRequest("未登录，无法确定入账账号")
		}
		in.UserID = me.User.ID
	}
	if in.Locale == "" {
		in.Locale = "zh"
	}
	return s.API.Redeem(ctx, code, in.UserID, in.Locale)
}

func isHex(s string) bool {
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

func (s *Server) handleCheckout(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		PackageID string `json:"packageId"`
		Period    string `json:"period"`
		Locale    string `json:"locale"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.PackageID == "" {
		return nil, badRequest("缺少 packageId")
	}
	if in.Period == "" {
		in.Period = "monthly"
	}
	if in.Locale == "" {
		in.Locale = "zh"
	}
	return s.API.Checkout(ctx, in.PackageID, in.Period, in.Locale)
}

func (s *Server) handleOptimizePrompt(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Prompt string `json:"prompt"`
		Model  string `json:"model"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Prompt) == "" {
		return nil, badRequest("提示词为空")
	}
	return s.API.OptimizePrompt(ctx, in.Prompt, in.Model)
}

func (s *Server) handleCreateKey(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return nil, badRequest("请填写 Key 名称")
	}
	return s.API.CreateAPIKey(ctx, in.Name)
}

func (s *Server) handleMCP(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Key    string          `json:"key"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		ID     any             `json:"id"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Key) == "" {
		return nil, badRequest("请填写 API Key（MCP 只接受 Bearer 鉴权）")
	}
	if in.Method == "" {
		in.Method = "tools/list"
	}
	payload := map[string]any{"jsonrpc": "2.0", "id": in.ID, "method": in.Method}
	if len(in.Params) > 0 {
		payload["params"] = in.Params
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return s.API.MCP(ctx, strings.TrimSpace(in.Key), raw)
}

// --- misc ------------------------------------------------------------------

func (s *Server) handleReveal(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		Path string `json:"path"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	if in.Path == "" {
		in.Path = s.Cfg.DownloadDir
	}
	if _, err := os.Stat(in.Path); err != nil {
		return nil, badRequest("路径不存在: " + in.Path)
	}
	if err := revealInExplorer(in.Path); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func (s *Server) handleOpenExternal(ctx context.Context, r *http.Request) (any, error) {
	var in struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return nil, err
	}
	u, err := url.Parse(in.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, badRequest("只允许打开 http/https 链接")
	}
	if err := openExternal(u.String()); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func mkdirAll(dir string) error { return os.MkdirAll(filepath.Clean(dir), 0o755) }
