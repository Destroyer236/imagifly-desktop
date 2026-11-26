package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imagiflydesk/internal/imagiapi"
)

// Accounts are stored together in one DPAPI-sealed file. The file contains the
// session cookie for every remembered account plus a small profile snapshot so
// the switcher can render before any network call. Passwords are never stored.
const accountsFileName = "accounts.bin"

type storedAccount struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
	Plan      string  `json:"plan,omitempty"`
	Session   string  `json:"session"`
	AddedAt   string  `json:"addedAt,omitempty"`
}

type accountBook struct {
	ActiveID string          `json:"activeId"`
	Accounts []storedAccount `json:"accounts"`
}

type accountView struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
	Plan      string  `json:"plan,omitempty"`
	Active    bool    `json:"active"`
	AddedAt   string  `json:"addedAt,omitempty"`
}

type accountsView struct {
	Accounts []accountView `json:"accounts"`
	ActiveID string        `json:"activeId"`
	Count    int           `json:"count"`
}

func loadAccountBook() *accountBook {
	book := &accountBook{}
	dir, err := configDir()
	if err != nil {
		return book
	}
	path := filepath.Join(dir, accountsFileName)
	raw, err := os.ReadFile(path)
	if err == nil {
		plain, unsealErr := unprotect(raw)
		if unsealErr == nil {
			_ = json.Unmarshal(plain, book)
		}
		book.normalize()
		return book
	}
	if !errors.Is(err, os.ErrNotExist) {
		return book
	}

	// One-time migration from the single-session file used before 1.2.0.
	if cookie := LoadSession(); cookie != "" {
		book.Accounts = []storedAccount{{
			Session: cookie,
			AddedAt: time.Now().Format(time.RFC3339),
		}}
	}
	return book
}

func saveAccountBook(book *accountBook) error {
	if book == nil {
		book = &accountBook{}
	}
	book.normalize()
	dir, err := configDir()
	if err != nil {
		return err
	}
	plain, err := json.Marshal(book)
	if err != nil {
		return err
	}
	blob, err := protect(plain)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, accountsFileName), blob, 0o600)
}

// LoadActiveSession is used once at process start so the API client begins on
// the last selected account.
func LoadActiveSession() string {
	book := loadAccountBook()
	if active := book.active(); active != nil {
		return active.Session
	}
	return ""
}

func (b *accountBook) normalize() {
	if b == nil {
		return
	}
	out := b.Accounts[:0]
	for _, a := range b.Accounts {
		a.Session = strings.TrimSpace(a.Session)
		if a.Session == "" {
			continue
		}
		if a.Plan == "" {
			a.Plan = "free"
		}
		out = append(out, a)
	}
	b.Accounts = out
	if len(b.Accounts) == 0 {
		b.ActiveID = ""
		return
	}
	if b.ActiveID == "" {
		return
	}
	for _, a := range b.Accounts {
		if a.ID == b.ActiveID {
			return
		}
	}
	b.ActiveID = ""
}

func (b *accountBook) active() *storedAccount {
	if b == nil || len(b.Accounts) == 0 {
		return nil
	}
	if b.ActiveID != "" {
		for i := range b.Accounts {
			if b.Accounts[i].ID == b.ActiveID {
				return &b.Accounts[i]
			}
		}
	}
	return &b.Accounts[0]
}

func (b *accountBook) find(id string) *storedAccount {
	if b == nil || id == "" {
		return nil
	}
	for i := range b.Accounts {
		if b.Accounts[i].ID == id {
			return &b.Accounts[i]
		}
	}
	return nil
}

func (b *accountBook) upsert(user *imagiapi.User, billing *imagiapi.Billing, session string, activate bool) *storedAccount {
	session = strings.TrimSpace(session)
	if b == nil || user == nil || session == "" {
		return nil
	}
	var target *storedAccount
	for i := range b.Accounts {
		a := &b.Accounts[i]
		if (user.ID != "" && a.ID == user.ID) || a.Session == session {
			target = a
			break
		}
	}
	if target == nil {
		b.Accounts = append(b.Accounts, storedAccount{AddedAt: time.Now().Format(time.RFC3339)})
		target = &b.Accounts[len(b.Accounts)-1]
	}
	if user.ID != "" {
		target.ID = user.ID
	}
	target.Name = user.Name
	target.Email = user.Email
	target.AvatarURL = user.AvatarURL
	target.Session = session
	if target.Plan == "" {
		target.Plan = "free"
	}
	if billing != nil {
		target.Plan = strings.ToLower(billing.ActivePlan.Tier)
		if target.Plan == "" {
			target.Plan = "free"
		}
	}
	if activate {
		b.ActiveID = target.ID
	}
	return target
}

func (b *accountBook) remove(id string) *storedAccount {
	if b == nil {
		return nil
	}
	idx := -1
	for i := range b.Accounts {
		if id != "" && b.Accounts[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil
	}
	removed := b.Accounts[idx]
	b.Accounts = append(b.Accounts[:idx], b.Accounts[idx+1:]...)
	if b.ActiveID == removed.ID || idx == 0 && b.ActiveID == "" {
		b.ActiveID = ""
		if len(b.Accounts) > 0 {
			b.ActiveID = b.Accounts[0].ID
		}
	}
	return &removed
}

func (b *accountBook) removeActive() *storedAccount {
	active := b.active()
	if active == nil {
		return nil
	}
	if active.ID != "" {
		return b.remove(active.ID)
	}
	idx := -1
	for i := range b.Accounts {
		if &b.Accounts[i] == active {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil
	}
	removed := b.Accounts[idx]
	b.Accounts = append(b.Accounts[:idx], b.Accounts[idx+1:]...)
	b.ActiveID = ""
	if len(b.Accounts) > 0 {
		b.ActiveID = b.Accounts[0].ID
	}
	return &removed
}

func (b *accountBook) view() accountsView {
	active := b.active()
	out := accountsView{Accounts: make([]accountView, 0, len(b.Accounts)), ActiveID: b.ActiveID, Count: len(b.Accounts)}
	for i := range b.Accounts {
		a := &b.Accounts[i]
		out.Accounts = append(out.Accounts, accountView{
			ID:        a.ID,
			Name:      a.Name,
			Email:     a.Email,
			AvatarURL: a.AvatarURL,
			Plan:      a.Plan,
			Active:    active == a || (active != nil && a.ID != "" && active.ID == a.ID),
			AddedAt:   a.AddedAt,
		})
	}
	if active != nil {
		out.ActiveID = active.ID
	}
	return out
}
