/* 上游模型目录 → 参数控件 的通用映射。
 *
 * 上游 /api/models 里任何一个形如 `<name>Options` 的数组，都会自动变成一组
 * chips，并以 `<name>` 作为表单字段提交。因此上游新增/改参数（cameraMotion、
 * stylePreset…）不需要客户端发版，只要刷新模型目录即可。
 *
 * 这里只做两件事：把键名转成可读的中文标签、把各种 options 形态归一化成
 * { value, label }。真正的渲染与提交在 screen-create.js。
 */

const KNOWN_OPTION_KEYS = new Set([
  'durationOptions',
  'fpsOptions',
  'resolutionOptions',
  'stepsOptions',
  'stepOptions',
  'aspectRatios',
  'ratioOptions',
  'variants',
  'variantOptions',
  'workflowFormats',
  'qualityOptions',
  'sizeOptions',
]);

// 与 internal/imagiapi/generate.go 的 reservedFormFields 保持一致。
const RESERVED_FORM_KEYS = new Set([
  'prompt',
  'negativePrompt',
  'model',
  'n',
  'variant',
  'workflowFormat',
  'duration',
  'fps',
  'size',
  'ratio',
  'quality',
  'seed',
  'resolutionTier',
  'steps',
  'outputFormat',
  'responseFormat',
  'communityVisibility',
]);

const TOKENS = {
  camera: '镜头',
  shot: '景别',
  motion: '运动',
  movement: '运动',
  style: '风格',
  preset: '预设',
  effect: '效果',
  light: '光线',
  lighting: '光照',
  angle: '视角',
  music: '音乐',
  tempo: '节奏',
  strength: '强度',
  guidance: '引导',
  detail: '细节',
  background: '背景',
  enhancement: '增强',
  upscale: '超分',
  language: '语言',
  voice: '音色',
  speed: '速度',
  scale: '缩放',
  variation: '变化',
  tone: '色调',
  color: '色彩',
  texture: '质感',
  level: '级别',
  mode: '模式',
  type: '类型',
  format: '格式',
  quality: '质量',
  resolution: '分辨率',
  duration: '时长',
  loop: '循环',
  transition: '转场',
  face: '人脸',
  body: '人物',
  emotion: '情绪',
  character: '角色',
  audio: '音频',
  subtitle: '字幕',
  watermark: '水印',
};

export function optionFormKey(optionKey) {
  const base = String(optionKey).replace(/Options$/, '');
  return base.charAt(0).toLowerCase() + base.slice(1);
}

function splitWords(key) {
  return String(key)
    .replace(/Options$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s-]+/)
    .filter(Boolean);
}

// cameraMotionOptions → 镜头运动；无法识别时回退原始键名，保证不会丢参数。
export function humanLabel(optionKey) {
  const words = splitWords(optionKey).map((w) => w.toLowerCase());
  const parts = words.map((w) => TOKENS[w]).filter(Boolean);
  if (!parts.length) return String(optionKey).replace(/Options$/, '');
  return parts.join('');
}

function optionValue(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object') {
    const value = raw.value ?? raw.id ?? raw.size ?? raw.key ?? raw.resolution ?? raw.name ?? '';
    return value === null || value === undefined ? '' : String(value);
  }
  return '';
}

function optionLabel(raw, value) {
  if (raw && typeof raw === 'object') {
    const label = raw.label ?? raw.name ?? raw.title ?? raw.resolution ?? raw.id ?? value;
    return String(label ?? value);
  }
  return value;
}

export function normalizeOptions(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const value = optionValue(raw).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: optionLabel(raw, value) });
  }
  return out;
}

// 把 spec（模型或某个变体）里所有未知的 `<x>Options` 数组变成参数控件定义。
export function extraParams(spec) {
  if (!spec || typeof spec !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(spec)) {
    if (!/Options$/.test(key) || KNOWN_OPTION_KEYS.has(key)) continue;
    if (!Array.isArray(value)) continue;
    const formKey = optionFormKey(key);
    if (!formKey || RESERVED_FORM_KEYS.has(formKey)) continue;
    const options = normalizeOptions(value);
    if (!options.length) continue;
    out.push({ key, formKey, label: humanLabel(key), options });
  }
  return out;
}

// 上游若给了 defaultXxx，就作为该参数的初始值；否则交给用户选。
export function defaultExtraValue(spec, param) {
  if (!spec || !param) return '';
  const base = param.key.replace(/Options$/, '');
  const key = `default${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  const raw = spec[key];
  if (raw === null || raw === undefined || raw === '') return '';
  return String(raw);
}
