import { icon } from './icons.js';
import { S, modelLabel, visibleTasks } from './store.js';
import { api } from './api.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtNum(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: Number.isInteger(num) ? 0 : 1 }).format(num);
}

export function fmtCredits(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return Number.isInteger(num) ? fmtNum(num) : num.toFixed(1);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const base = d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return withTime ? `${base} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : base;
}

export function msHuman(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function safeURL(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw, location.href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.href;
  } catch {
    return '';
  }
}

/* --- accent color -------------------------------------------------------- */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function normalizeAccent(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (!value.startsWith('#')) value = '#' + value;
  if (!/^#[0-9a-f]{6}$/i.test(value)) return '';
  return value.toUpperCase();
}

function accentRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function rgbHSL(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslRGB(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    t = (t + 360) % 360;
    if (t < 60) return p + (q - p) * t / 60;
    if (t < 180) return q;
    if (t < 240) return p + (q - p) * (240 - t) / 60;
    return p;
  };
  return {
    r: hue(h * 360 + 120) * 255,
    g: hue(h * 360) * 255,
    b: hue(h * 360 - 120) * 255,
  };
}

// M3-ish tonal roles: preserve the chosen hue, then use fixed lightness
// targets so dark/light themes and on-color contrast stay coherent.
function accentTone(hex, lightness, saturation = 1) {
  const { r, g, b } = accentRGB(hex);
  const hsl = rgbHSL(r, g, b);
  const tone = hslRGB(hsl.h, hsl.s * saturation, lightness);
  return rgbHex(tone.r, tone.g, tone.b);
}

function accentTint(hex, lightness, saturation) {
  const { r, g, b } = accentRGB(hex);
  const hsl = rgbHSL(r, g, b);
  const tone = hslRGB(hsl.h, clamp(saturation, 0, 100), lightness);
  return rgbHex(tone.r, tone.g, tone.b);
}

function relativeLuminance(hex) {
  const { r, g, b } = accentRGB(hex);
  const channel = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function bestOn(hex) {
  const l = relativeLuminance(hex);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#FFFFFF';
}

function accentTokens(hex) {
  const dark = (document.documentElement.dataset.theme || 'dark') !== 'light';
  const { r, g, b } = accentRGB(hex);
  const seed = rgbHSL(r, g, b);
  const surfaceSat = seed.s < 5 ? 0 : clamp(seed.s * .11, 3, 8);
  const textSat = seed.s < 5 ? 0 : clamp(seed.s * .2, 2, 9);
  const primary = accentTone(hex, dark ? 82 : 38, dark ? .92 : .9);
  const container = accentTone(hex, dark ? 28 : 88, dark ? .88 : .85);
  const secondary = accentTone(hex, dark ? 78 : 42, .3);
  const secondaryContainer = accentTone(hex, dark ? 30 : 90, .36);
  const surfaces = dark ? {
    surface: accentTint(hex, 8, surfaceSat),
    surfaceDim: accentTint(hex, 4.5, surfaceSat),
    surfaceBright: accentTint(hex, 20, surfaceSat),
    surfaceLowest: accentTint(hex, 4.5, surfaceSat),
    surfaceLow: accentTint(hex, 10, surfaceSat),
    surfaceContainer: accentTint(hex, 12, surfaceSat),
    surfaceHigh: accentTint(hex, 15, surfaceSat),
    surfaceHighest: accentTint(hex, 18, surfaceSat),
    onSurface: accentTint(hex, 89, textSat),
    onSurfaceVariant: accentTint(hex, 78, textSat),
    outline: accentTint(hex, 62, textSat),
    outlineVariant: accentTint(hex, 31, textSat),
    inverseSurface: accentTint(hex, 89, textSat),
    inverseOnSurface: accentTint(hex, 18, textSat),
  } : {
    surface: accentTint(hex, 98, surfaceSat),
    surfaceDim: accentTint(hex, 85, surfaceSat),
    surfaceBright: accentTint(hex, 100, surfaceSat),
    surfaceLowest: accentTint(hex, 100, surfaceSat),
    surfaceLow: accentTint(hex, 96, surfaceSat),
    surfaceContainer: accentTint(hex, 93, surfaceSat),
    surfaceHigh: accentTint(hex, 91, surfaceSat),
    surfaceHighest: accentTint(hex, 88, surfaceSat),
    onSurface: accentTint(hex, 12, textSat),
    onSurfaceVariant: accentTint(hex, 30, textSat),
    outline: accentTint(hex, 52, textSat),
    outlineVariant: accentTint(hex, 80, textSat),
    inverseSurface: accentTint(hex, 18, textSat),
    inverseOnSurface: accentTint(hex, 91, textSat),
  };
  return {
    primary,
    onPrimary: dark ? accentTone(hex, 18, .55) : bestOn(primary),
    primaryContainer: container,
    onPrimaryContainer: bestOn(container),
    primaryFixed: accentTone(hex, 90, .65),
    primaryFixedDim: accentTone(hex, 78, .75),
    secondary,
    onSecondary: bestOn(secondary),
    secondaryContainer,
    onSecondaryContainer: bestOn(secondaryContainer),
    ...surfaces,
  };
}

export function applyAccent(raw) {
  const hex = normalizeAccent(raw);
  const root = document.documentElement;
  const props = [
    '--primary', '--on-primary', '--primary-container', '--on-primary-container',
    '--primary-fixed', '--primary-fixed-dim', '--brand-gradient',
    '--secondary', '--on-secondary', '--secondary-container', '--on-secondary-container',
    '--surface', '--surface-dim', '--surface-bright', '--surface-lowest', '--surface-low',
    '--surface-container', '--surface-high', '--surface-highest',
    '--on-surface', '--on-surface-variant', '--outline', '--outline-variant',
    '--inverse-surface', '--inverse-on-surface',
  ];
  if (!hex) {
    for (const prop of props) root.style.removeProperty(prop);
    return;
  }
  const t = accentTokens(hex);
  root.style.setProperty('--primary', t.primary);
  root.style.setProperty('--on-primary', t.onPrimary);
  root.style.setProperty('--primary-container', t.primaryContainer);
  root.style.setProperty('--on-primary-container', t.onPrimaryContainer);
  root.style.setProperty('--primary-fixed', t.primaryFixed);
  root.style.setProperty('--primary-fixed-dim', t.primaryFixedDim);
  root.style.setProperty('--secondary', t.secondary);
  root.style.setProperty('--on-secondary', t.onSecondary);
  root.style.setProperty('--secondary-container', t.secondaryContainer);
  root.style.setProperty('--on-secondary-container', t.onSecondaryContainer);
  root.style.setProperty('--surface', t.surface);
  root.style.setProperty('--surface-dim', t.surfaceDim);
  root.style.setProperty('--surface-bright', t.surfaceBright);
  root.style.setProperty('--surface-lowest', t.surfaceLowest);
  root.style.setProperty('--surface-low', t.surfaceLow);
  root.style.setProperty('--surface-container', t.surfaceContainer);
  root.style.setProperty('--surface-high', t.surfaceHigh);
  root.style.setProperty('--surface-highest', t.surfaceHighest);
  root.style.setProperty('--on-surface', t.onSurface);
  root.style.setProperty('--on-surface-variant', t.onSurfaceVariant);
  root.style.setProperty('--outline', t.outline);
  root.style.setProperty('--outline-variant', t.outlineVariant);
  root.style.setProperty('--inverse-surface', t.inverseSurface);
  root.style.setProperty('--inverse-on-surface', t.inverseOnSurface);
  const { r: pr, g: pg, b: pb } = accentRGB(t.primary);
  const { r: cr, g: cg, b: cb } = accentRGB(t.primaryContainer);
  root.style.setProperty('--brand-gradient', `linear-gradient(135deg, rgba(${pr},${pg},${pb},.16), rgba(${cr},${cg},${cb},.28) 55%, rgba(240,196,108,.10))`);
}

function localMediaURL(path) {
  // Video/fallback media stays on a second loopback origin so it cannot
  // consume the browser's six connections for the JSON API.
  if (location.hostname === '127.0.0.1' && location.port) {
    return `http://localhost:${location.port}${path}`;
  }
  return path;
}

function isImagiflyURL(u) {
  const host = u.hostname.toLowerCase();
  return host === 'imagifly.net' || host.endsWith('.imagifly.net');
}

// Images go straight to the CDN, exactly like the website. The CDN speaks
// HTTP/2 (many thumbnails multiplex over one connection) and WebView2 keeps
// its HTTP cache across launches. The local proxy remains only as a fallback.
export function mediaURL(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw, location.href);
    if (u.protocol !== 'https:' || !isImagiflyURL(u)) return '';
    return u.href;
  } catch {
    return '';
  }
}

export function proxyMediaURL(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw, location.href);
    if (u.protocol !== 'https:' || !isImagiflyURL(u)) return '';
    return localMediaURL('/local/media?u=' + encodeURIComponent(u.href));
  } catch {
    return '';
  }
}

// The community API ships the exact WebP widths generated for the site.
// Pick the largest variant no wider than 580px: it is the same ~32 KB asset
// the website uses in its cards. Detail views reuse that cached image instead
// of downloading the original multi-megabyte PNG.
export function imageVariantURL(raw, width) {
  if (!raw || !width) return '';
  try {
    const u = new URL(raw, location.href);
    if (u.protocol !== 'https:' || !isImagiflyURL(u)) return '';
    if (!/\.(?:png|jpe?g|webp)$/i.test(u.pathname) || /\.community-v1-\d+\.webp$/i.test(u.pathname)) return '';
    return `${u.origin}${u.pathname}.community-v1-${width}.webp`;
  } catch {
    return '';
  }
}

export function assetImageURL(asset, maxWidth = 580) {
  if (!asset) return '';
  const widths = Array.isArray(asset.communityThumbnailWidths)
    ? asset.communityThumbnailWidths.map(Number).filter((n) => n > 0)
    : [];
  if (widths.length) {
    const eligible = widths.filter((n) => n <= maxWidth);
    const chosen = eligible.length ? Math.max(...eligible) : Math.min(...widths);
    const variant = imageVariantURL(asset.url || asset.detailUrl, chosen);
    if (variant) return variant;
  }
  return mediaURL(asset.thumbnailUrl || asset.url || asset.detailUrl || '');
}

export function detailImageHTML(asset, fallbackThumb = '', alt = '') {
  const src = assetImageURL(asset) || mediaURL(fallbackThumb);
  if (!src) return '';
  const fallback = proxyMediaURL(asset?.thumbnailUrl || fallbackThumb || asset?.url || '');
  return `<div class="detail-media"><img src="${esc(src)}" alt="${esc(alt)}" decoding="async" fetchpriority="high"${fallback ? ` data-fallback="${esc(fallback)}"` : ''}></div>`;
}

// If a CDN variant is missing or the direct CDN request fails, retry through
// the local proxy, which can serve a previously cached thumbnail or original.
if (typeof document !== 'undefined') {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.imageFallbackApplied === '1') return;
    const fallback = img.getAttribute('data-fallback');
    if (!fallback || img.src === fallback) return;
    img.dataset.imageFallbackApplied = '1';
    img.removeAttribute('srcset');
    img.src = fallback;
  }, true);
}

export function assetURL(item) {
  if (!item) return '';
  if (item.mode === 'video') {
    const a = (item.assets || [])[0];
    return (a && a.url) || item.previewVideoUrl || item.previewThumbnailUrl || '';
  }
  const a = (item.assets || [])[0];
  return (a && a.url) || item.previewThumbnailUrl || (a && a.thumbnailUrl) || '';
}

export function thumbURL(item) {
  if (!item) return '';
  if (item.mode === 'video') {
    return item.previewVideoUrl || item.previewThumbnailUrl || assetURL(item);
  }
  const a = (item.assets || [])[0];
  return item.previewThumbnailUrl || (a && a.thumbnailUrl) || (a && a.url) || '';
}

/* --- wavy progress (M3 Expressive signature) ----------------------------- */

function wavyCirclePath(cx, cy, r, amp, waves, steps = 200) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rr = r + amp * Math.sin(waves * t);
    const x = cx + rr * Math.cos(t);
    const y = cy + rr * Math.sin(t);
    d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
  }
  return d + 'Z';
}

export function wavyRing(size = 46, amp = 1.8, waves = 11, stroke = 5) {
  const d = wavyCirclePath(32, 32, 24, Math.min(1.8, amp), Math.max(10, waves));
  return `<span class="wavy-ring" style="width:${size}px;height:${size}px" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="${size}" height="${size}">
      <path d="${d}" fill="none" stroke="var(--primary)" stroke-width="${stroke}" stroke-linejoin="round"/>
    </svg></span>`;
}

export function gaugeSVG(percent) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const frac = Math.max(pct / 100, 0.004);
  const circumference = 2 * Math.PI * 55;
  const offset = circumference * (1 - frac);
  return `<svg viewBox="0 0 152 152" aria-hidden="true">
    <circle cx="76" cy="76" r="55" fill="none" stroke="var(--surface-highest)" stroke-width="11"/>
    <circle class="arc" cx="76" cy="76" r="55" fill="none" stroke="var(--primary)" stroke-width="11"
      stroke-linecap="round" stroke-dasharray="${circumference.toFixed(2)} ${circumference.toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 76 76)"/>
  </svg>`;
}

/* --- pills & cards ------------------------------------------------------- */

export function statusPill(item) {
  if (!item) return '';
  if (item.status === 'generating') return `<span class="pill run">${icon('dot', 13)}生成中</span>`;
  if (item.status === 'failed') return `<span class="pill err">${icon('warning', 13)}失败</span>`;
  if (item.moderationStatus === 'rejected') return `<span class="pill warn">${icon('warning', 13)}审核未通过</span>`;
  return `<span class="pill ok">${icon('check', 13)}完成</span>`;
}

export function shortPrompt(text, n = 40) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t || '无提示词';
}

export function taskCard(item) {
  const isVideo = item.mode === 'video';
  const asset = item.assets?.[0];
  const rawThumb = thumbURL(item);
  const thumb = isVideo
    ? proxyMediaURL(rawThumb)
    : (assetImageURL(asset) || mediaURL(rawThumb));
  const imageFallback = isVideo ? '' : proxyMediaURL(asset?.thumbnailUrl || rawThumb || asset?.url);
  const running = item.status === 'generating';
  const failed = item.status === 'failed';
  const cost = Number(item.cost) || 0;
  const canDownload = item.status === 'success' && !item.moderationStatus?.includes('rejected');
  const name = `imagifly-${item.model || 'gen'}-${String(item.id || '').slice(-6)}`;
  return `<div class="media-card" data-act="open-task" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="作品 ${esc(item.id)}">
    <div class="frame">
      ${thumb ? (isVideo ? `<video src="${thumb}" muted loop preload="metadata"></video>` : `<img src="${thumb}" loading="lazy" decoding="async" alt=""${imageFallback ? ` data-fallback="${esc(imageFallback)}"` : ''}>`) : `<div class="ph">${icon(isVideo ? 'movie' : 'image', 36)}</div>`}
      ${running ? `<div class="gen-overlay">${wavyRing(52, 2.6, 8, 6)}<span>${esc(elapsedText(item))}</span></div>` : ''}
      ${failed ? `<div class="gen-overlay failed">${icon('cloudOff', 30)}<span>生成失败</span></div>` : ''}
      <span class="status">${statusPill(item)}</span>
      <span class="pill dark badge-type">${icon(isVideo ? 'movie' : 'image', 12)}${isVideo ? '视频' : '图片'}</span>
      ${canDownload ? `<div class="hoverbar">
        <button class="icon-btn sm" data-act="quick-download" data-url="${esc(assetURL(item)) || esc(item.previewThumbnailUrl)}" data-name="${esc(name)}" data-tip="保存到本地">${icon('download', 16)}</button>
        <button class="icon-btn sm" data-act="copy-prompt" data-prompt="${esc(item.prompt)}" data-tip="复制提示词">${icon('copy', 16)}</button>
      </div>` : ''}
    </div>
    <div class="meta">
      <div class="line1"><span class="name">${esc(shortPrompt(item.prompt, 34))}</span></div>
      <div class="sub">
        <span>${esc(modelLabel(item.model))}</span>
        <span>${esc(timeAgo(item.createdAt))}</span>
        ${cost ? `<span>${fmtNum(cost)} 额度</span>` : ''}
      </div>
    </div>
  </div>`;
}

export function elapsedText(item) {
  const start = new Date(item.createdAt).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const expected = S.durations?.[item.model];
  if (expected) return `${secs}s / 约 ${Math.round(expected / 1000)}s`;
  return `${secs}s`;
}

export function paintTaskGrid(container, items, badgeIds = []) {
  if (!container) return;
  const visible = visibleTasks(items);
  if (!visible.length) {
    container.innerHTML = emptyState('image', '还没有作品', '写下第一段提示词，生成结果会出现在这里。');
    return;
  }
  container.innerHTML = visible.map(taskCard).join('');
  const keys = new Set((Array.isArray(badgeIds) ? badgeIds : [badgeIds])
    .map((v) => String(v || ''))
    .filter(Boolean));
  if (!keys.size) return;
  for (const card of container.querySelectorAll('.media-card')) {
    if (!keys.has(String(card.dataset.id))) continue;
    card.classList.add('is-new');
    const frame = card.querySelector('.frame');
    if (frame) frame.insertAdjacentHTML('beforeend', '<span class="new-corner">NEW</span>');
  }
}

export function activeCard(item) {
  return `<div class="run-card">
    <div class="ring">${wavyRing(46, 2.4, 8)}</div>
    <div class="info">
      <div class="t">${esc(shortPrompt(item.prompt, 44))}</div>
      <div class="s">${esc(modelLabel(item.model))} · ${esc(elapsedText(item))}</div>
    </div>
    <button class="icon-btn sm" data-act="open-task" data-id="${esc(item.id)}" data-tip="查看">${icon('chevronRight', 18)}</button>
  </div>`;
}

export function emptyState(iconName, title, text, action = '') {
  return `<div class="empty">
    <div class="ico">${icon(iconName, 30)}</div>
    <h4>${esc(title)}</h4>
    <p>${esc(text)}</p>
    ${action}
  </div>`;
}

export function skeletonPage(rows = 3) {
  return `<div class="loading-page">
    <div class="skel" style="height:28px;width:220px"></div>
    ${Array.from({ length: rows }).map(() => `<div class="skel" style="height:96px"></div>`).join('')}
  </div>`;
}

export function sectionHead(title, sub = '', actions = '') {
  return `<div class="sect-head">
    <div><div class="sect-title">${esc(title)}</div>${sub ? `<div class="sect-sub">${esc(sub)}</div>` : ''}</div>
    ${actions ? `<div class="sect-actions">${actions}</div>` : ''}
  </div>`;
}

export function avatarURL(raw) {
  if (!raw) return '';
  let href = String(raw).trim();
  if (!href) return '';
  if (href.startsWith('data:image/')) return href;
  if (href.startsWith('/')) href = 'https://imagifly.net' + href;
  try {
    const u = new URL(href);
    if (u.protocol !== 'https:') return '';
    // Avatars are tiny; load them from their CDN origin like the website so
    // they can use the browser cache and HTTP/2 as well.
    return u.href;
  } catch {
    return '';
  }
}

export function avatarHTML(user, cls = '') {
  if (!user) return `<div class="avatar ${cls}">?</div>`;
  const url = avatarURL(user.avatarUrl || user.authorAvatarUrl || user.avatar);
  const ch = (user.name || user.email || '?').trim().slice(0, 1).toUpperCase();
  if (url) {
    const fallback = esc(ch).replace(/'/g, '&#39;');
    return `<div class="avatar ${cls}"><img src="${url}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.onerror=null;this.parentElement.textContent='${fallback}'"></div>`;
  }
  return `<div class="avatar ${cls}">${esc(ch)}</div>`;
}

/* --- toast --------------------------------------------------------------- */

export function toast(message, kind = 'info', action = null) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' err' : kind === 'ok' ? ' ok' : '');
  const iconName = kind === 'error' ? 'alert' : kind === 'warn' ? 'warning' : 'checkCircle';
  el.innerHTML = `${icon(iconName, 18)}<span>${esc(message)}</span>`;
  let dismiss = null;
  if (action && action.label) {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      try {
        action.fn && action.fn();
      } finally {
        dismiss && dismiss();
      }
    });
    el.appendChild(b);
  }
  root.appendChild(el);
  dismiss = () => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 220);
  };
  setTimeout(dismiss, action && action.label ? 6500 : 3200);
}

/* --- sheet / dialogs ----------------------------------------------------- */

let sheetState = null;

function keyHandler(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSheet();
  }
}

export function openSheet({ title, subtitle = '', body = '', actions = '', size = '', onClose = null }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  if (sheetState && sheetState.onClose) {
    try {
      sheetState.onClose();
    } catch {}
  }
  document.removeEventListener('keydown', keyHandler);
  root.innerHTML = `<div class="scrim"></div>
    <div class="dialog-wrap">
      <div class="dialog ${size}" role="dialog" aria-modal="true">
        <div class="dialog-head">
          <div><div class="t">${esc(title)}</div>${subtitle ? `<div class="s">${esc(subtitle)}</div>` : ''}</div>
          <button class="icon-btn x" aria-label="关闭">${icon('close', 22)}</button>
        </div>
        <div class="dialog-body">${body}</div>
        ${actions ? `<div class="dialog-actions">${actions}</div>` : ''}
      </div>
    </div>`;
  const scrim = root.querySelector('.scrim');
  const dialog = root.querySelector('.dialog');
  root.querySelector('.x').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', keyHandler);
  const sheet = { root, dialog, body: dialog.querySelector('.dialog-body'), actionsEl: dialog.querySelector('.dialog-actions'), close: closeSheet, onClose };
  sheetState = sheet;
  requestAnimationFrame(() => {
    scrim.classList.add('show');
    dialog.classList.add('show');
  });
  setTimeout(() => {
    const input = dialog.querySelector('input, textarea');
    if (input) input.focus();
  }, 60);
  return sheet;
}

export function closeSheet() {
  if (!sheetState) return;
  const state = sheetState;
  sheetState = null;
  document.removeEventListener('keydown', keyHandler);
  const scrim = state.root.querySelector('.scrim');
  if (scrim) scrim.classList.remove('show');
  state.dialog.classList.remove('show');
  setTimeout(() => {
    if (state.root.contains(state.dialog)) {
      state.root.innerHTML = '';
      state.onClose && state.onClose();
    }
  }, 260);
}

export function confirmSheet({ title, text, confirm = '确定', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const state = openSheet({
      title,
      body: `<p class="body" style="margin:2px 0 6px">${esc(text)}</p>`,
      size: 'narrow',
      actions: `<button class="btn text" id="cf-no">取消</button><button class="btn ${danger ? 'danger' : 'filled'}" id="cf-yes">${esc(confirm)}</button>`,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(false);
        }
      },
    });
    state.root.querySelector('#cf-no').onclick = () => state.close();
    state.root.querySelector('#cf-yes').onclick = () => {
      done = true;
      resolve(true);
      state.close();
    };
  });
}

export function promptSheet({ title, label = '', value = '', placeholder = '', multiline = false, confirm = '保存', subtitle = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const field = multiline
      ? `<div class="field-box area"><textarea id="pd-in" placeholder="${esc(placeholder)}"></textarea></div>`
      : `<div class="field-box"><input id="pd-in" placeholder="${esc(placeholder)}"></div>`;
    const state = openSheet({
      title,
      subtitle,
      body: `<div class="field"><label>${esc(label)}</label>${field}</div>`,
      size: 'narrow',
      actions: `<button class="btn text" id="pd-no">取消</button><button class="btn filled" id="pd-yes">${esc(confirm)}</button>`,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(null);
        }
      },
    });
    const input = state.root.querySelector('#pd-in');
    input.value = value;
    const submit = () => {
      const v = input.value;
      done = true;
      resolve(v);
      state.close();
    };
    state.root.querySelector('#pd-no').onclick = () => state.close();
    state.root.querySelector('#pd-yes').onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !multiline) {
        e.preventDefault();
        submit();
      }
    });
  });
}

/* --- clipboard / media --------------------------------------------------- */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export async function downloadAsset(url, name) {
  if (!url) {
    toast('该作品还没有可下载的文件', 'error');
    return;
  }
  try {
    await api('/local/downloads', { method: 'POST', body: { url, name: name || '' } });
    toast('已加入下载队列', 'ok', {
      label: '查看进度',
      fn: () => document.querySelector('.rail-item[data-route="downloads"]')?.click(),
    });
  } catch (e) {
    toast(e.message || '下载失败', 'error');
  }
}

export function revealPath(path) {
  api('/local/reveal', { method: 'POST', body: { path } }).catch((e) => toast(e.message, 'error'));
}

export function openExternal(url) {
  api('/local/open', { method: 'POST', body: { url } }).catch((e) => toast(e.message, 'error'));
}

/* --- ripple -------------------------------------------------------------- */

export function initRipple() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.btn, .icon-btn, .fab-ext, .rail-item, .chip, .seg-item, .menu-item, .media-card, .card.click, .hero-tile');
    if (!el || el.disabled) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top = `${e.clientY - rect.top - size / 2}px`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(span);
    setTimeout(() => span.remove(), 600);
  });
}

export function jsonPretty(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
