package imagiapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

// Login exchanges credentials for a session cookie (spec §3.1).
func (c *Client) Login(ctx context.Context, email, password string) (*SessionResponse, error) {
	resp, body, err := c.Do(ctx, Request{
		Method: http.MethodPost,
		Path:   "/api/auth/login",
		Body:   map[string]string{"email": email, "password": password},
	})
	if err != nil {
		return nil, err
	}
	session := ""
	for _, ck := range resp.Cookies() {
		if ck.Name == "imagifly_session" && ck.Value != "" {
			session = ck.Value
		}
	}
	if session == "" {
		return nil, &Error{Status: http.StatusUnauthorized, Code: "NO_COOKIE", Message: "登录成功但未收到会话 Cookie"}
	}
	c.SetSession(session)

	var out SessionResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	if out.User == nil {
		// Fill user+tier from /api/auth/me.
		me, meErr := c.Me(ctx)
		if meErr == nil {
			out = *me
		}
	}
	return &out, nil
}

// Register creates an account. The site issues the session cookie on success
// when email verification is not required; otherwise the caller should log in.
func (c *Client) Register(ctx context.Context, name, email, password string) (*SessionResponse, error) {
	resp, body, err := c.Do(ctx, Request{
		Method:    http.MethodPost,
		Path:      "/api/auth/register",
		Body:      map[string]string{"name": name, "email": email, "password": password},
		Timestamp: true,
	})
	if err != nil {
		return nil, err
	}
	session := ""
	for _, ck := range resp.Cookies() {
		if ck.Name == "imagifly_session" && ck.Value != "" {
			session = ck.Value
		}
	}
	var out SessionResponse
	_ = json.Unmarshal(body, &out)
	if session != "" {
		c.SetSession(session)
		me, meErr := c.Me(ctx)
		if meErr == nil {
			return me, nil
		}
	}
	return &out, nil
}

// Me returns the current account. An anonymous call is a 200 with user:null.
func (c *Client) Me(ctx context.Context) (*SessionResponse, error) {
	raw, err := c.Call(ctx, Request{Path: "/api/auth/me", Auth: true})
	if err != nil {
		return nil, err
	}
	var out SessionResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if out.User == nil {
		c.SetSession("")
	}
	return &out, nil
}

// Logout destroys the session and clears it locally.
func (c *Client) Logout(ctx context.Context) error {
	raw, err := c.Call(ctx, Request{Method: http.MethodPost, Path: "/api/auth/logout", Auth: true})
	c.SetSession("")
	if err != nil {
		return err
	}
	var out struct {
		OK bool `json:"ok"`
	}
	_ = json.Unmarshal(raw, &out)
	if !out.OK {
		return errors.New("退出登录未返回 ok")
	}
	return nil
}

// Daily claims the daily credit grant (spec §4.1). Idempotent per day.
func (c *Client) Daily(ctx context.Context) (*DailyResult, error) {
	raw, err := c.Call(ctx, Request{
		Method:    http.MethodPost,
		Path:      "/api/credits/daily",
		Auth:      true,
		Timestamp: true,
	})
	if err != nil {
		return nil, err
	}
	var out DailyResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
