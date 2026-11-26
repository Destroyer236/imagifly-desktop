package app

import (
	"testing"

	"imagiflydesk/internal/imagiapi"
)

func testUser(id, name, email string) *imagiapi.User {
	return &imagiapi.User{ID: id, Name: name, Email: email}
}

func TestAccountBookUpsertAndView(t *testing.T) {
	book := &accountBook{}
	first := book.upsert(testUser("u1", "Alpha", "a@example.com"), &imagiapi.Billing{
		ActivePlan: imagiapi.ActivePlan{Tier: "plus"},
	}, "session-1", true)
	if first == nil || first.Plan != "plus" {
		t.Fatalf("first account = %#v", first)
	}
	if book.ActiveID != "u1" {
		t.Fatalf("active = %q", book.ActiveID)
	}

	updated := book.upsert(testUser("u1", "Alpha 2", "a2@example.com"), nil, "session-1b", true)
	if updated == nil || updated.Name != "Alpha 2" || updated.Session != "session-1b" {
		t.Fatalf("updated = %#v", updated)
	}
	if len(book.Accounts) != 1 {
		t.Fatalf("accounts = %d", len(book.Accounts))
	}

	second := book.upsert(testUser("u2", "Beta", "b@example.com"), nil, "session-2", false)
	if second == nil || second.Plan != "free" {
		t.Fatalf("second = %#v", second)
	}
	if book.ActiveID != "u1" {
		t.Fatalf("active = %q", book.ActiveID)
	}

	view := book.view()
	if view.Count != 2 || len(view.Accounts) != 2 {
		t.Fatalf("view = %#v", view)
	}
	if !view.Accounts[0].Active || view.Accounts[1].Active {
		t.Fatalf("active flags = %#v", view.Accounts)
	}
}

func TestAccountBookRemoveActiveFallsBack(t *testing.T) {
	book := &accountBook{}
	book.upsert(testUser("u1", "Alpha", "a@example.com"), nil, "session-1", true)
	book.upsert(testUser("u2", "Beta", "b@example.com"), nil, "session-2", false)

	removed := book.removeActive()
	if removed == nil || removed.ID != "u1" {
		t.Fatalf("removed = %#v", removed)
	}
	if active := book.active(); active == nil || active.ID != "u2" {
		t.Fatalf("active = %#v", active)
	}
	if len(book.Accounts) != 1 {
		t.Fatalf("accounts = %d", len(book.Accounts))
	}
}

func TestAccountBookViewFallsBackToFirst(t *testing.T) {
	book := &accountBook{Accounts: []storedAccount{
		{Name: "Legacy", Session: "legacy-session"},
		{ID: "u2", Name: "Beta", Session: "session-2"},
	}}
	view := book.view()
	if len(view.Accounts) != 2 || !view.Accounts[0].Active || view.Accounts[1].Active {
		t.Fatalf("view = %#v", view)
	}
	if view.ActiveID != "" {
		t.Fatalf("active id = %q", view.ActiveID)
	}
}

func TestAccountBookRemoveLegacyActiveBySession(t *testing.T) {
	book := &accountBook{Accounts: []storedAccount{{Name: "Legacy", Session: "legacy-session"}}}
	if removed := book.removeActive(); removed == nil || removed.Session != "legacy-session" {
		t.Fatalf("removed = %#v", removed)
	}
	if len(book.Accounts) != 0 || book.ActiveID != "" {
		t.Fatalf("book = %#v", book)
	}
}
