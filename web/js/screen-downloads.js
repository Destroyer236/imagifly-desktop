import { api } from './api.js';
import { S } from './store.js';
import { icon } from './icons.js';
import * as UI from './ui.js';

/* 下载页：消费 /local/downloads 的队列快照，展示每个任务的进度、速度、
   剩余时间与落盘位置。任务由服务端在后台执行，离开页面也不会中断。 */

const state = { items: [], error: '', loading: false };
let view = null;
let timer = null;

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = v;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[i]}`;
}

function fmtSpeed(n) {
  const v = Number(n) || 0;
  return v > 0 ? `${fmtBytes(v)}/s` : '—';
}

function fmtEta(item) {
  if (!item.total || !item.speed || item.state !== 'downloading' || item.received <= 0) return '';
  const left = Math.max(0, item.total - item.received) / item.speed;
  if (!isFinite(left) || left <= 0) return '';
  if (left < 60) return `剩余 ${Math.ceil(left)} 秒`;
  return `剩余 ${Math.floor(left / 60)} 分 ${Math.round(left % 60)} 秒`;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function kindIcon(kind) {
  return kind === 'video' ? 'movie' : kind === 'image' ? 'image' : 'download';
}

function statusPill(item) {
  switch (item.state) {
    case 'queued': return `<span class="pill">排队中</span>`;
    case 'downloading': return `<span class="pill run">${icon('download', 12)}下载中</span>`;
    case 'done': return `<span class="pill ok">${icon('check', 12)}已完成</span>`;
    case 'error': return `<span class="pill err">${icon('alert', 12)}失败</span>`;
    case 'canceled': return `<span class="pill">已取消</span>`;
    default: return `<span class="pill">${UI.esc(item.state)}</span>`;
  }
}

function actionsHTML(item) {
  if (item.state === 'queued' || item.state === 'downloading') {
    return `<button class="btn text sm" data-act="dl-cancel" data-id="${UI.esc(item.id)}">${icon('close', 15)}取消</button>`;
  }
  if (item.state === 'done') {
    return `<button class="btn tonal sm" data-act="dl-reveal" data-path="${UI.esc(item.path)}">${icon('external', 15)}打开文件</button>
      <button class="btn text sm" data-act="dl-reveal" data-path="${UI.esc(item.path)}">${icon('folder', 15)}打开目录</button>`;
  }
  if (item.state === 'error' || item.state === 'canceled') {
    return `<button class="btn tonal sm" data-act="dl-retry" data-id="${UI.esc(item.id)}" data-url="${UI.esc(item.url)}" data-name="${UI.esc(item.name)}">${icon('refresh', 15)}重试</button>
      <button class="btn text sm" data-act="dl-remove" data-id="${UI.esc(item.id)}">${icon('trash', 15)}移除</button>`;
  }
  return '';
}

function taskHTML(item) {
  const pct = item.total > 0 ? Math.min(100, Math.round((item.received / item.total) * 100)) : 0;
  const active = item.state === 'downloading' || item.state === 'queued';
  const connecting = item.state === 'downloading' && item.received <= 0;
  const eta = fmtEta(item);
  const saveTo = item.path || S.cfg?.downloadDir || '';
  const stat = item.state === 'queued'
    ? '排队中，等待空闲通道'
    : connecting
      ? '正在连接 CDN…'
      : item.state === 'downloading'
        ? `${fmtBytes(item.received)}${item.total > 0 ? ' / ' + fmtBytes(item.total) : ''}`
        : item.state === 'done'
          ? fmtBytes(item.received || item.total)
          : item.total > 0
            ? `已下载 ${fmtBytes(item.received)} / ${fmtBytes(item.total)}`
            : `已下载 ${fmtBytes(item.received)}`;
  return `<article class="card pad-sm dl-item" data-dl="${UI.esc(item.id)}">
    <div class="dl-head">
      <span class="dl-kind ${item.kind || 'file'}">${icon(kindIcon(item.kind), 20)}</span>
      <div class="dl-title-box">
        <div class="dl-name" title="${UI.esc(item.name || item.url)}">${UI.esc(item.name || item.url)}</div>
        <div class="dl-sub">${UI.esc(hostOf(item.url))}${item.kind === 'video' ? ' · 视频' : item.kind === 'image' ? ' · 图片' : ''}${item.state === 'done' ? ' · 保存完成' : ''}</div>
      </div>
      ${statusPill(item)}
    </div>
    <div class="upd-bar dl-bar"><i style="width:${item.state === 'downloading' ? Math.max(2, pct) : pct}%"></i></div>
    <div class="dl-meta">
      <span>${stat}${active && item.total > 0 ? `（${pct}%）` : ''}</span>
      ${item.state === 'downloading' ? `<span class="dl-speed">${connecting ? '等待首包…' : fmtSpeed(item.speed)}</span>` : ''}
      ${eta ? `<span class="muted">${eta}</span>` : ''}
      <span class="dl-acts">${actionsHTML(item)}</span>
    </div>
    <div class="dl-path mono" title="${UI.esc(saveTo)}">${icon('folder', 13)}${UI.esc(saveTo || '下载目录未设置')}</div>
  </article>`;
}

function listHTML() {
  if (!state.items.length) {
    return `<div class="card pad-sm dl-empty">${icon('download', 34)}<div class="t">还没有下载任务</div><div class="s">在作品详情或社区卡片点「保存」，任务会出现在这里，并显示实时进度、速度与剩余时间。</div></div>`;
  }
  return `<div class="dl-list">${state.items.map(taskHTML).join('')}</div>`;
}

function heroHTML() {
  const downloading = state.items.filter((i) => i.state === 'downloading');
  const queued = state.items.filter((i) => i.state === 'queued');
  const done = state.items.filter((i) => i.state === 'done').length;
  const speed = downloading.reduce((sum, i) => sum + (Number(i.speed) || 0), 0);
  const title = downloading.length
    ? `${downloading.length} 个下载中${queued.length ? ` <span class="upd-arrow">·</span> ${queued.length} 个排队` : ''}${speed > 0 ? ` <span class="upd-arrow">·</span> ${fmtSpeed(speed)}` : ''}`
    : queued.length ? `${queued.length} 个排队中` : '下载队列空闲';
  const sub = downloading.length || queued.length
    ? `2 个并发通道 · 已完成 ${done} 个 · 文件保存到 ${UI.esc(S.cfg?.downloadDir || '下载目录')}`
    : `已完成 ${done} 个 · 文件保存到 ${UI.esc(S.cfg?.downloadDir || '下载目录')}`;
  return `<section class="card hero dl-hero">
    <div class="dl-hero-main">
      <div class="upd-eyebrow">Downloads · 本机后台下载</div>
      <h1 class="dl-hero-title">${title}</h1>
      <p class="upd-sub">${sub}</p>
    </div>
    <div class="dl-hero-acts">
      <button class="btn text sm" data-act="dl-clear">${icon('trash', 16)}清除已完成</button>
      <button class="btn tonal sm" data-act="dl-open-dir">${icon('folder', 16)}打开下载目录</button>
    </div>
  </section>`;
}

function paint() {
  if (!view) return;
  const top = view.scrollTop;
  view.innerHTML = `<div class="page">
    ${heroHTML()}
    <section class="sect" style="margin-top:22px">
      ${UI.sectionHead('下载任务', `共 ${state.items.length} 个 · 同时最多 2 个，其余排队`)}
      ${state.error ? `<div class="banner error" style="margin-bottom:12px">${icon('alert', 18)}<div>${UI.esc(state.error)}</div></div>` : ''}
      ${listHTML()}
    </section>
  </div>`;
  view.scrollTop = top;
}

async function refresh(silent = false) {
  if (!silent) state.loading = true;
  try {
    const data = await api('/local/downloads', { noCache: true });
    state.items = data.items || [];
    state.error = '';
  } catch (e) {
    if (!silent) state.error = e.message || '下载队列加载失败';
  }
  paint();
}

function scheduleNext(ms) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    if (S.route !== 'downloads' || !view || !view.isConnected) return;
    await refresh(true);
    const active = state.items.some((i) => i.state === 'downloading' || i.state === 'queued');
    scheduleNext(active ? 800 : 2400);
  }, ms);
}

export async function renderDownloads(v) {
  view = v;
  await refresh();
  paint();
  scheduleNext(800);
}

export const downloadActions = {
  'dl-cancel': async (d) => {
    await api('/local/downloads/cancel', { method: 'POST', body: { id: d.id } });
    UI.toast('已取消下载', 'info');
    await refresh();
    scheduleNext(800);
  },
  'dl-remove': async (d) => {
    await api('/local/downloads/remove', { method: 'POST', body: { id: d.id } });
    await refresh();
    scheduleNext(800);
  },
  'dl-retry': async (d) => {
    await api('/local/downloads', { method: 'POST', body: { url: d.url, name: d.name } });
    if (d.id) await api('/local/downloads/remove', { method: 'POST', body: { id: d.id } }).catch(() => {});
    UI.toast('已重新加入下载队列', 'ok');
    await refresh();
    scheduleNext(800);
  },
  'dl-clear': async () => {
    const res = await api('/local/downloads/clear', { method: 'POST', body: {} });
    UI.toast(`已清除 ${res.removed || 0} 个已结束任务`, 'ok');
    await refresh();
    scheduleNext(800);
  },
  'dl-open-dir': () => {
    const dir = S.cfg?.downloadDir || '';
    if (!dir) return UI.toast('下载目录未设置', 'error');
    return UI.revealPath(dir);
  },
  'dl-reveal': (d) => UI.revealPath(d.path || ''),
};
