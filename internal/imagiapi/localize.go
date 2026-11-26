package imagiapi

import (
	"strings"
	"unicode"
)

// codeMessages maps the API's stable error codes to user-facing Chinese. The
// English text in an error envelope is not a contract and often empty for
// upload failures, so never show the raw JSON body in a toast.
var codeMessages = map[string]string{
	"auth_required":                      "登录状态已失效，请重新登录",
	"no_session":                         "尚未登录，请先登录账号",
	"no_cookie":                          "登录成功但未收到会话，请重试",
	"forbidden":                          "没有权限执行此操作",
	"origin_required":                    "请求来源校验失败，请重启客户端后重试",
	"registrationtimestamp":              "注册校验已失效，请返回重新注册",
	"invalid_idempotency_key":            "请求提交标识无效，请重试",
	"generation_concurrency_limit":       "并发任务已达上限，请等待当前任务完成",
	"private_mode_requires_subscription": "仅自己可见需要 Pro / Max 订阅",
	"invalid_image":                      "图片文件无效或过大，请更换图片后重试",
	"too_large":                          "文件过大，请压缩或选择更小的文件后重试",
	"file_too_large":                     "文件过大，请压缩或选择更小的文件后重试",
	"image_too_large":                    "图片过大，请压缩或选择更小的图片后重试",
	"upload_timeout":                     "上传超时，请检查网络后重试",
	"rejected":                           "内容未通过审核，请更换后重试",
	"review_unavailable":                 "审核服务暂不可用，请稍后重试",
	"busy":                               "服务繁忙，请稍后重试",
	"unavailable":                        "内容不存在或已被使用",
	"malformedcode":                      "兑换码格式不正确，请检查后重试",
	"invalid_file_type":                  "文件格式不支持，请更换文件后重试",
	"rate_limited":                       "请求过于频繁，请稍后重试",
	"rate_limit_exceeded":                "请求过于频繁，请稍后重试",
	"too_many_requests":                  "请求过于频繁，请稍后重试",
	"insufficient_credits":               "积分不足，请充值后再试",
	"quota_exceeded":                     "额度不足，请稍后重试",
	"prompt_too_long":                    "提示词过长，请精简后重试",
	"generation_failed":                  "生成失败，请调整提示词后重试",
	"model_not_available":                "当前模型暂不可用，请选择其他模型",
	"not_found":                          "请求的内容不存在或已被删除",
	"already_exists":                     "内容已存在，请勿重复提交",
}

func hasChinese(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func looksTechnical(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return true
	}
	if strings.HasPrefix(s, "{") || strings.HasPrefix(s, "[") || strings.HasPrefix(s, "<") {
		return true
	}
	return false
}

// LocalizedError turns an upstream code/envelope into a concise Chinese
// message. Known codes win even when the API returned an English sentence;
// unknown codes fall back to the HTTP status before the original text.
func LocalizedError(code string, status int, raw string) string {
	if msg, ok := codeMessages[strings.ToLower(strings.TrimSpace(code))]; ok {
		return msg
	}
	if raw != "" && !looksTechnical(raw) && hasChinese(raw) {
		return raw
	}
	switch status {
	case 400:
		return "请求参数有误，请检查后重试"
	case 401:
		return "登录状态已失效，请重新登录"
	case 403:
		return "没有权限执行此操作"
	case 404:
		return "请求的内容不存在或已被删除"
	case 408:
		return "请求超时，请检查网络后重试"
	case 409:
		return "操作冲突，请刷新后重试"
	case 413:
		return "文件过大，请压缩或选择更小的文件后重试"
	case 429:
		return "请求过于频繁，请稍后重试"
	default:
		if status >= 500 {
			return "服务暂时不可用，请稍后重试"
		}
		return "请求失败，请稍后重试"
	}
}
