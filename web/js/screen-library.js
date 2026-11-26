import { api, clearApiCache } from './api.js';
import { S } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { R } from './runtime.js';

export async function renderLibrary(view) {
  const tab = S.library.tab || 'recent';
  view.innerHTML = `<div class="page">
    ${UI.sectionHead('作品库', '缩略图用 previewThumbnailUrl，打开大图才请求详情', `<button class="icon-btn" data-act="lib-refresh" data-tip="刷新">${icon('refresh', 22)}</button><button class="btn tonal sm" data-act="nav" data-route="create">${icon('plus', 16)}新建</button>`)}
    <div class="tabs">
      <button class="tab ${tab === 'recent' ? 'selected' : ''}" data-act="lib-tab" data-tab="recent">最近生成 <span class="muted num">${S.tasks.length || ''}</span></button>
      <button class="tab ${tab === 'gallery' ? 'selected' : ''}" data-act="lib-tab" data-tab="gallery">我的作品库</button>
    </div>
    <div id="libraryBody">${UI.skeletonPage(2)}</div>
  </div>`;

  const body = view.querySelector('#libraryBody');
  if (tab === 'recent') {
    paintRecent(body);
    R.refreshTasks(true).then(() => paintRecent(body)).catch(() => {});
  } else {
    await loadGallery(body);
  }
}

function paintRecent(body) {
  const sorted = [...S.tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  body.innerHTML = `
    <div class="banner" style="margin-bottom:16px">${icon('info', 20)}<div>列表接口的 <span class="mono">assets</span> 通常为空，卡片显示的是缩略图；点开详情才会拉取原图与原视频。生成中的任务会在 3 秒内自动刷新。</div></div>
    <div class="grid cards" id="libraryGrid"></div>`;
  UI.paintTaskGrid(body.querySelector('#libraryGrid'), sorted);
}

async function loadGallery(body) {
  body.innerHTML = UI.skeletonPage(2);
  try {
    if (!S.library.gallery) {
      S.library.gallery = await api('/local/gallery?offset=0&limit=24');
    }
    paintGallery(body);
  } catch (e) {
    body.innerHTML = `<div class="banner error">${icon('alert', 20)}<div>作品库加载失败：${UI.esc(e.message)}</div></div>`;
  }
}

function paintGallery(body) {
  const g = S.library.gallery;
  if (!g) return;
  const quota = g.quota || {};
  const items = g.items || [];
  const freeLimited = Number(quota.recentLimit) === 0;
  const banner = freeLimited
    ? `<div class="banner warn" style="margin-bottom:16px">${icon('info', 20)}<div>当前套餐的作品库保留位为 <b>0</b>，所以这里通常为空。历史作品仍可在「最近生成」和任务列表里找到；升级 Plus 及以上可获得作品库配额。</div></div>`
    : `<div class="banner" style="margin-bottom:16px">${icon('library', 20)}<div>作品库 ${items.length} 件 · 保留 ${quota.recentRetentionDays || '—'} 天 · 点赞 ${g.likeCount || 0}</div></div>`;

  body.innerHTML = `${banner}
    <div class="grid cards" id="galleryGrid"></div>
    ${g.hasMore ? `<div style="display:flex;justify-content:center;margin-top:22px"><button class="btn tonal" data-act="gallery-more">${icon('chevronDown', 18)}加载更多</button></div>` : ''}`;
  const grid = body.querySelector('#galleryGrid');
  if (!items.length) {
    grid.innerHTML = UI.emptyState('library', '作品库是空的', freeLimited ? '免费套餐没有作品库保留位，去「最近生成」看看历史作品吧。' : '发布到社区或升级套餐后，作品会归档到这里。', `<button class="btn filled" data-act="nav" data-route="create">${icon('sparkle', 18)}去创作</button>`);
  } else {
    UI.paintTaskGrid(grid, items);
  }
}

export function updateLibraryTasks() {
  if (S.library.tab !== 'recent') return;
  const grid = document.getElementById('libraryGrid');
  if (grid) UI.paintTaskGrid(grid, [...S.tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
}

export const libraryActions = {
  'lib-tab': (d) => {
    S.library.tab = d.tab;
    renderLibrary(document.getElementById('view'));
  },
  'lib-refresh': () => {
    clearApiCache();
    S.library.gallery = null;
    renderLibrary(document.getElementById('view'));
  },
  'gallery-more': async () => {
    const g = S.library.gallery;
    if (!g) return;
    try {
      const next = await api(`/local/gallery?offset=${g.nextOffset || 0}&limit=24`);
      S.library.gallery = { ...next, items: [...(g.items || []), ...(next.items || [])] };
      paintGallery(document.getElementById('libraryBody'));
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
};
