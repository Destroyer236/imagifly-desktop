const ERROR_MESSAGES = {
  auth_required: '登录状态已失效，请重新登录',
  no_session: '尚未登录，请先登录账号',
  no_cookie: '登录成功但未收到会话，请重试',
  forbidden: '没有权限执行此操作',
  origin_required: '请求来源校验失败，请重启客户端后重试',
  registrationtimestamp: '注册校验已失效，请返回重新注册',
  invalid_idempotency_key: '请求提交标识无效，请重试',
  generation_concurrency_limit: '并发任务已达上限，请等待当前任务完成',
  private_mode_requires_subscription: '仅自己可见需要 Pro / Max 订阅',
  invalid_image: '图片文件无效或过大，请更换图片后重试',
  too_large: '文件过大，请压缩或选择更小的文件后重试',
  file_too_large: '文件过大，请压缩或选择更小的文件后重试',
  image_too_large: '图片过大，请压缩或选择更小的图片后重试',
  upload_timeout: '上传超时，请检查网络后重试',
  rejected: '内容未通过审核，请更换后重试',
  review_unavailable: '审核服务暂不可用，请稍后重试',
  busy: '服务繁忙，请稍后重试',
  unavailable: '内容不存在或已被使用',
  malformedcode: '兑换码格式不正确，请检查后重试',
  invalid_file_type: '文件格式不支持，请更换文件后重试',
  rate_limited: '请求过于频繁，请稍后重试',
  rate_limit_exceeded: '请求过于频繁，请稍后重试',
  too_many_requests: '请求过于频繁，请稍后重试',
  insufficient_credits: '积分不足，请充值后再试',
  quota_exceeded: '额度不足，请稍后重试',
  prompt_too_long: '提示词过长，请精简后重试',
  generation_failed: '生成失败，请调整提示词后重试',
  model_not_available: '当前模型暂不可用，请选择其他模型',
  not_found: '请求的内容不存在或已被删除',
  already_exists: '内容已存在，请勿重复提交',
};

const STATUS_MESSAGES = {
  400: '请求参数有误，请检查后重试',
  401: '登录状态已失效，请重新登录',
  403: '没有权限执行此操作',
  404: '请求的内容不存在或已被删除',
  408: '请求超时，请检查网络后重试',
  409: '操作冲突，请刷新后重试',
  413: '文件过大，请压缩或选择更小的文件后重试',
  429: '请求过于频繁，请稍后重试',
  500: '服务暂时不可用，请稍后重试',
  502: '服务暂时不可用，请稍后重试',
  503: '服务暂时不可用，请稍后重试',
  504: '服务暂时不可用，请稍后重试',
};

function errorText(info, status) {
  const code = String(info.code || '').toLowerCase();
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  const message = String(info.message || '').trim();
  const technical = !message || /^[\[{<]/.test(message);
  const chinese = /[\u4e00-\u9fff]/.test(message);
  if (!technical && chinese) return message;
  return STATUS_MESSAGES[status] || '请求失败，请稍后重试';
}

const GET_CACHE = new Map();

// Short-lived in-memory cache for expensive read endpoints. Any write clears
// it, so likes/follows/profile changes are never shown stale.
const CACHE_RULES = [
  [/^\/local\/models\/durations(?:\?|$)/, 10 * 60 * 1000],
  [/^\/local\/models(?:\?|$)/, 10 * 60 * 1000],
  [/^\/local\/config(?:\?|$)/, 60 * 1000],
  [/^\/local\/accounts(?:\?|$)/, 10 * 1000],
  [/^\/local\/homepage\/community(?:\?|$)/, 2 * 60 * 1000],
  [/^\/local\/community\/follows(?:\?|$)/, 45 * 1000],
  [/^\/local\/community\/(?!follows(?:\?|$)|dynamic(?:\?|$))[A-Za-z0-9_-]+(?:\?|$)/, 30 * 1000],
  [/^\/local\/community(?:\?|$)/, 30 * 1000],
  [/^\/local\/profile\/summary(?:\?|$)/, 45 * 1000],
  [/^\/local\/profile\/credit-history(?:\?|$)/, 45 * 1000],
  [/^\/local\/gallery(?:\?|$)/, 30 * 1000],
  [/^\/local\/notifications(?:\?|$)/, 30 * 1000],
  [/^\/local\/oauth\/devices(?:\?|$)/, 60 * 1000],
  [/^\/local\/referral\/summary(?:\?|$)/, 60 * 1000],
  [/^\/local\/referral\/share-code(?:\?|$)/, 60 * 1000],
  [/^\/local\/billing\/packages(?:\?|$)/, 5 * 60 * 1000],
];

function cacheTTL(path) {
  const hit = CACHE_RULES.find(([re]) => re.test(path));
  return hit ? hit[1] : 0;
}

const GET_INFLIGHT = new Map();
let GET_EPOCH = 0;

export function clearApiCache(prefix = '') {
  GET_EPOCH += 1;
  GET_INFLIGHT.clear();
  if (!prefix) {
    GET_CACHE.clear();
    return;
  }
  for (const key of GET_CACHE.keys()) {
    if (key.startsWith(prefix)) GET_CACHE.delete(key);
  }
}

export async function api(path, opts = {}) {
  const hasPayload = opts.form !== undefined || opts.body !== undefined;
  const method = opts.method || (hasPayload ? 'POST' : 'GET');
  const ttl = method === 'GET' && !opts.noCache ? cacheTTL(path) : 0;
  if (ttl) {
    const hit = GET_CACHE.get(path);
    if (hit && hit.expires > Date.now()) return hit.data;
    const pending = GET_INFLIGHT.get(path);
    if (pending) return pending;
  }
  const epoch = GET_EPOCH;
  const task = fetchAPI(path, opts, method, ttl, epoch);
  if (ttl) {
    GET_INFLIGHT.set(path, task);
    task.then(
      () => { if (GET_INFLIGHT.get(path) === task) GET_INFLIGHT.delete(path); },
      () => { if (GET_INFLIGHT.get(path) === task) GET_INFLIGHT.delete(path); },
    );
  }
  return task;
}

async function fetchAPI(path, opts, method, ttl, epoch) {
  const init = { method, headers: {} };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    const err = new Error('本地服务未响应，请检查应用是否仍在运行');
    err.status = 0;
    err.code = 'LOCAL_DOWN';
    throw err;
  }
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    const err = new Error('本地服务返回了无法解析的内容');
    err.status = res.status;
    err.code = 'BAD_LOCAL_JSON';
    throw err;
  }
  if (!json || json.ok !== true) {
    const info = (json && json.error) || {};
    const err = new Error(errorText(info, info.status ?? res.status));
    err.status = info.status ?? res.status;
    err.code = info.code || '';
    err.limit = info.limit;
    err.activeCount = info.activeCount;
    throw err;
  }
  if (method !== 'GET') clearApiCache();
  if (ttl && epoch === GET_EPOCH) GET_CACHE.set(path, { data: json.data, expires: Date.now() + ttl });
  return json.data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p, body) => api(p, { method: 'DELETE', body });
