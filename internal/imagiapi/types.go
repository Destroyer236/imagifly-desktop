package imagiapi

import "encoding/json"

// User mirrors GET /api/auth/me. Numeric fields are float64 because the site
// occasionally reports fractional credits from multipliers.
type User struct {
	ID                           string  `json:"id"`
	Name                         string  `json:"name"`
	AvatarURL                    *string `json:"avatarUrl"`
	ProfileBio                   *string `json:"profileBio"`
	Email                        string  `json:"email"`
	Role                         string  `json:"role"`
	IsLegacyUser                 bool    `json:"isLegacyUser"`
	ParticipatesInUxOptimization bool    `json:"participatesInUxOptimization"`
	Credits                      float64 `json:"credits"`
	CreatedAt                    string  `json:"createdAt"`
	DisabledAt                   *string `json:"disabledAt"`
	HasPassword                  bool    `json:"hasPassword"`
}

type ActivePlan struct {
	Tier      string  `json:"tier"`
	PackageID *string `json:"packageId"`
	ExpiresAt *string `json:"expiresAt"`
}

type Billing struct {
	ActivePlan ActivePlan `json:"activePlan"`
}

type SessionResponse struct {
	User    *User    `json:"user"`
	Billing *Billing `json:"billing"`
}

// DailyResult is POST /api/credits/daily.
type DailyResult struct {
	User                *User   `json:"user"`
	Claimed             bool    `json:"claimed"`
	CreditsGranted      float64 `json:"creditsGranted"`
	TodayCreditsGranted float64 `json:"todayCreditsGranted"`
	CreditMultiplier    float64 `json:"creditMultiplier"`
}

// CreditSummary is GET /api/profile/summary.
type CreditSummary struct {
	Stats struct {
		ImageGenerations      int     `json:"imageGenerations"`
		VideoGenerations      int     `json:"videoGenerations"`
		LikeCount             int     `json:"likeCount"`
		PublicCommunityCount  int     `json:"publicCommunityCount"`
		SuccessfulGenerations int     `json:"successfulGenerations"`
		SpentCredits          float64 `json:"spentCredits"`
	} `json:"stats"`
	CreditUsage struct {
		TotalCredits     float64 `json:"totalCredits"`
		AvailableCredits float64 `json:"availableCredits"`
		UsedCredits      float64 `json:"usedCredits"`
		UsedPercentage   float64 `json:"usedPercentage"`
	} `json:"creditUsage"`
	CreditBreakdown []struct {
		Source           string  `json:"source"`
		Credits          float64 `json:"credits"`
		Percentage       float64 `json:"percentage"`
		NearestExpiresAt *string `json:"nearestExpiresAt"`
	} `json:"creditBreakdown"`
	CreditExpiryBreakdown []json.RawMessage `json:"creditExpiryBreakdown"`
}

// CreditTransaction is one row of GET /api/profile/credit-history.
type CreditTransaction struct {
	ID               string  `json:"id"`
	Kind             string  `json:"kind"`
	Credits          float64 `json:"credits"`
	RemainingCredits *float64 `json:"remainingCredits"`
	Description      string  `json:"description"`
	Model            *string `json:"model"`
	ExpiresAt        *string `json:"expiresAt"`
	CreatedAt        string  `json:"createdAt"`
}

type CreditHistory struct {
	Transactions []CreditTransaction `json:"transactions"`
}

// BillingPackage is one entry of GET /api/billing/packages.
type BillingPackage struct {
	ID                   string   `json:"id"`
	Kind                 string   `json:"kind"`
	Name                 string   `json:"name"`
	Description          string   `json:"description"`
	Credits              float64  `json:"credits"`
	AmountCents          int      `json:"amountCents"`
	Currency             string   `json:"currency"`
	CreditBonusPercent   float64  `json:"creditBonusPercent"`
	GenerationParameters []string `json:"generationParameters"`
	Features             []string `json:"features"`
	Featured             bool     `json:"featured"`
	CheckoutReady        bool     `json:"checkoutReady"`
}

type BillingPackages struct {
	Packages []BillingPackage `json:"packages"`
}

// APIKey is GET /api/developer/api-keys.
type APIKey struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	KeyPrefix   string  `json:"keyPrefix"`
	CreatedAt   string  `json:"createdAt"`
	LastUsedAt  *string `json:"lastUsedAt"`
	ExpiresAt   *string `json:"expiresAt"`
	Recoverable bool    `json:"recoverable"`
}

type APIKeyList struct {
	OK   bool     `json:"ok"`
	Keys []APIKey `json:"keys"`
}

// Device is GET /api/oauth/devices.
type Device struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Platform   string  `json:"platform"`
	UserAgent  string  `json:"userAgent"`
	CreatedAt  string  `json:"createdAt"`
	LastSeenAt *string `json:"lastSeenAt"`
	ExpiresAt  *string `json:"expiresAt"`
}

// Notification is tolerant because the site does not document the schema.
type Notification struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Title     string  `json:"title"`
	Message   string  `json:"message"`
	Body      string  `json:"body"`
	Read      bool    `json:"read"`
	IsRead    bool    `json:"isRead"`
	Link      string  `json:"link"`
	CreatedAt string  `json:"createdAt"`
	ReadAt    *string `json:"readAt"`
}

type NotificationList struct {
	UserID     string         `json:"userId"`
	Items      []Notification `json:"items"`
	NextCursor *string        `json:"nextCursor"`
}
