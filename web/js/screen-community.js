import { api } from './api.js';
import { S } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { R } from './runtime.js';

function card(item, index = 0) {
  const isVideo = item.mode === 'video';
  const asset = item.assets?.[0];
  // 视频条目没有 previewThumbnailUrl / thumbnailUrl，只有 mp4 本身；把 mp4 塞进
  // <img> 会渲染成裂图。视频卡片改用 <video> 预载首帧，有海报再用海报。
  const poster = isVideo ? UI.mediaURL(item.previewThumbnailUrl || asset?.thumbnailUrl) : '';
  const videoSrc = isVideo ? UI.proxyMediaURL(item.previewVideoUrl || asset?.url || item.previewThumbnailUrl) : '';
  const imageSrc = isVideo ? '' : UI.assetImageURL(asset) || UI.mediaURL(item.previewThumbnailUrl || asset?.thumbnailUrl || asset?.url);
  const imageFallback = isVideo ? '' : UI.proxyMediaURL(asset?.thumbnailUrl || item.previewThumbnailUrl || asset?.url);
  const media = isVideo
    ? `<div class="video-ph">${icon('movie', 30)}<span>视频</span></div>${videoSrc
      ? `<video src="${UI.esc(videoSrc)}${videoSrc.includes('#') ? '' : '#t=0.1'}"${poster ? ` poster="${UI.esc(poster)}"` : ''} muted loop playsinline preload="metadata" disablepictureinpicture aria-hidden="true"></video>`
      : ''}`
    : (imageSrc
      ? `<img src="${imageSrc}" loading="eager" fetchpriority="${index < 6 ? 'high' : 'auto'}" decoding="async" alt=""${imageFallback ? ` data-fallback="${UI.esc(imageFallback)}"` : ''}>`
      : `<div class="ph">${icon('image', 36)}</div>`);
  const author = item.authorName || item.userId || '匿名';
  return `<div class="media-card" data-act="open-community" data-id="${UI.esc(item.id)}" tabindex="0" role="button">
    <div class="frame">
      ${media}
      <span class="pill dark badge-type">${icon(isVideo ? 'movie' : 'image', 12)}${isVideo ? '视频' : '图片'}</span>
      ${item.isPublic ? `<span class="status"><span class="pill ok">${icon('globe', 12)}公开</span></span>` : ''}
    </div>
    <div class="meta">
      <div class="line1">
        ${UI.avatarHTML({ name: author, avatarUrl: item.authorAvatarUrl }, 'xxs')}
        <span class="name">${UI.esc(author)}</span>
        <span class="muted" style="margin-left:auto;font-size:11px">${icon('heart', 12)} ${item.likeCount || 0}</span>
      </div>
      <div class="sub"><span>${UI.esc(item.model || '')}</span><span>${UI.esc(UI.shortPrompt(item.prompt, 22))}</span></div>
    </div>
  </div>`;
}

async function loadFollows() {
  try {
    const data = await api('/local/community/follows');
    const set = new Set();
    for (const it of data.items || []) {
      const id = it.creatorId || it.userId || it.id;
      if (id) set.add(id);
    }
    S.community.follows = set;
  } catch {}
}

// 视频条目本身没有缩略图，只能靠 <video> 的元数据/首帧。CDN 较慢时先在卡片里
// 放一张「视频」占位，等首帧真正解码出来再淡入，避免一整块空白或裂图。
function bindVideoThumbs(root) {
  root.querySelectorAll('video').forEach((video) => {
    const show = () => video.classList.add('ready');
    video.addEventListener('loadeddata', show, { once: true });
    video.addEventListener('seeked', show, { once: true });
    video.addEventListener('loadedmetadata', () => {
      try {
        if (video.currentTime < 0.05) video.currentTime = 0.12;
      } catch {}
    });
    if (video.readyState >= 2) show();
  });
}

async function loadFeed() {
  const c = S.community;
  const endpoint = c.kind === 'dynamic' ? '/local/community/dynamic' : '/local/community';
  const q = new URLSearchParams({ mode: c.mode });
  if (c.q) q.set('q', c.q);
  if (c.offset) q.set('offset', String(c.offset));
  const data = await api(endpoint + '?' + q.toString());
  c.items = c.offset ? [...c.items, ...(data.items || [])] : data.items || [];
  c.hasMore = data.hasMore;
  c.nextOffset = data.nextOffset || 0;
  c.query = data.query || c.q;
  c.loaded = true;
}

export async function renderCommunity(view) {
  const c = S.community;
  const homePromise = c.hero.length
    ? Promise.resolve()
    : api('/local/homepage/community').then((home) => { c.hero = home.artworks || []; }).catch(() => {});
  if (!c.loaded) {
    try {
      await Promise.all([loadFeed(), loadFollows(), homePromise]);
    } catch (e) {
      view.innerHTML = `<div class="page"><div class="banner error">${icon('alert', 20)}<div>社区加载失败：${UI.esc(e.message)}</div></div></div>`;
      return;
    }
  } else {
    await homePromise;
  }
  paint(view);
}

function paint(view) {
  const c = S.community;
  const hero = c.hero.length
    ? `<section class="sect" style="margin-top:0">${UI.sectionHead('今日精选', 'GET /api/homepage/community', '')}
        <div class="hero-strip">${c.hero.map((a, i) => {
          const src = UI.mediaURL(a.src);
          const fallback = UI.proxyMediaURL(a.src);
          return `<div class="hero-tile" data-act="open-community" data-id="${UI.esc(a.id)}">
            ${src ? `<img src="${src}" loading="eager" fetchpriority="${i < 3 ? 'high' : 'auto'}" decoding="async" alt=""${fallback ? ` data-fallback="${UI.esc(fallback)}"` : ''}>` : `<div class="ph">${icon('sparkle', 34)}</div>`}
            <div class="veil"></div>
            <div class="cap"><div class="m">${UI.esc(a.model || '')}</div><div class="t">精选作品</div></div>
          </div>`;
        }).join('')}</div></section>`
    : '';

  view.innerHTML = `<div class="page">
    ${hero}
    <section class="sect" style="margin-top:${hero ? '26px' : '0'}">
      ${UI.sectionHead(c.kind === 'dynamic' ? '关注动态' : '社区作品', c.q ? `搜索「${UI.esc(c.q)}」` : (c.kind === 'dynamic' ? '关注作者的新作品 · GET /api/community/dynamic' : '每页 12 条 · GET /api/community'), `<span class="pill">${icon('globe', 13)}${c.items.length} 条</span>`)}
      <div class="tabs" style="margin-bottom:12px">
        <button class="tab ${c.kind !== 'dynamic' ? 'selected' : ''}" data-act="com-kind" data-kind="community">社区作品</button>
        <button class="tab ${c.kind === 'dynamic' ? 'selected' : ''}" data-act="com-kind" data-kind="dynamic">关注动态</button>
      </div>
      <div class="search-row">
        <div class="seg">
          <button class="seg-item ${c.mode === 'image' ? 'selected' : ''}" data-act="com-mode" data-value="image">${icon('image', 18)}图片</button>
          <button class="seg-item ${c.mode === 'video' ? 'selected' : ''}" data-act="com-mode" data-value="video">${icon('movie', 18)}视频</button>
        </div>
        <div class="field-box">${icon('search', 18)}<input id="comSearch" placeholder="搜索提示词关键词…" value="${UI.esc(c.q || '')}"><button class="icon-btn sm" data-act="com-search" data-tip="搜索">${icon('send', 18)}</button></div>
        ${c.q ? `<button class="btn text sm" data-act="com-search-clear">${icon('close', 16)}清除搜索</button>` : ''}
      </div>
      <div class="grid cards" id="comGrid" style="margin-top:14px"></div>
      ${c.hasMore ? `<div style="display:flex;justify-content:center;margin-top:22px"><button class="btn tonal" data-act="com-more">${icon('chevronDown', 18)}加载更多</button></div>` : ''}
    </section>
  </div>`;

  const grid = view.querySelector('#comGrid');
  grid.innerHTML = c.items.length
    ? c.items.map(card).join('')
    : (c.q
      ? UI.emptyState('search', `没有匹配「${UI.esc(c.q)}」的作品`, '换个关键词试试，或点「清除搜索」回到全部作品。')
      : UI.emptyState('globe', c.kind === 'dynamic' ? '关注的人还没有新作品' : '这里暂时没有作品', c.kind === 'dynamic' ? '去社区关注一些创作者，他们的新作品会出现在这里。' : '切换图片/视频，或换个关键词试试。'));
  bindVideoThumbs(grid);

  const search = view.querySelector('#comSearch');
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applySearch(search.value);
    }
  });
}

async function applySearch(value) {
  const c = S.community;
  const next = String(value || '').replace(/\s+/g, ' ').trim();
  if (next === c.q && c.items.length) return;
  c.q = next;
  c.offset = 0;
  c.loaded = false;
  c.items = [];
  const view = document.getElementById('view');
  await renderCommunity(view);
  // 搜索后把结果区块滚到视口顶部，避免结果落在可视区外
  document.getElementById('comGrid')?.closest('.sect')?.scrollIntoView({ block: 'start', behavior: 'instant' });
}

// 社区曝光埋点：进详情记一次 view，关详情按停留时长补一条 dwell（1s–30min）。
function trackDwell(id, openedAt) {
  if (!openedAt) return;
  const ms = Date.now() - openedAt;
  if (ms < 1000) return;
  api('/local/feed/events/dwell', { method: 'POST', body: { imageId: id, durationMs: Math.min(ms, 1800000) } }).catch(() => {});
}

export async function openCommunity(id) {
  let timer = null;
  let openedAt = 0;
  const sheet = UI.openSheet({
    title: '社区作品',
    subtitle: id,
    size: 'wide',
    body: `<div class="loading-page"><div class="skel" style="height:240px"></div><div class="skel" style="height:80px"></div></div>`,
    onClose: () => {
      if (timer) clearInterval(timer);
      trackDwell(id, openedAt);
    },
  });
  const load = async () => {
    try {
      const data = await api('/local/community/' + encodeURIComponent(id));
      paintCommunity(sheet, data.item, load);
      if (!openedAt) {
        openedAt = Date.now();
        api('/local/feed/events/view', { method: 'POST', body: { imageId: id } }).catch(() => {});
      }
    } catch (e) {
      sheet.body.innerHTML = `<div class="banner error">${icon('alert', 20)}<div>${UI.esc(e.message)}</div></div>`;
    }
  };
  await load();
}

function paintCommunity(sheet, item, reload) {
  const isVideo = item.mode === 'video';
  const asset = item.assets?.[0];
  const videoSrc = UI.proxyMediaURL(asset?.url || item.previewVideoUrl || item.previewThumbnailUrl);
  const poster = UI.mediaURL(asset?.thumbnailUrl || item.previewThumbnailUrl);
  const image = isVideo ? '' : UI.detailImageHTML(asset, item.previewThumbnailUrl, item.prompt || '');
  const media = isVideo && videoSrc
    ? `<div class="detail-media"><video src="${videoSrc}" controls autoplay muted loop playsinline poster="${poster}"></video></div>`
    : image || `<div class="detail-media ph">${icon(isVideo ? 'movie' : 'image', 44)}<span>暂无文件</span></div>`;
  const followSet = S.community.follows;
  const following = followSet.has(item.userId);
  const mine = item.userId === S.user?.id;
  const liked = Boolean(item.isLiked);
  const tags = (item.tags || []).map((t) => `<span class="chip static">${UI.esc(t.name || t.id)}</span>`).join('');
  sheet.body.innerHTML = `<div class="detail">
    ${media}
    <div class="detail-info">
      <div class="profile-row" style="margin-bottom:12px">
        ${UI.avatarHTML({ name: item.authorName || '匿名创作者', avatarUrl: item.authorAvatarUrl }, '')}
        <div class="profile-meta"><div class="n">${UI.esc(item.authorName || '匿名创作者')}</div><div class="e">${UI.esc(item.userId || '')}</div></div>
        <div class="profile-actions">
          ${!mine ? `<button class="btn tonal sm" id="c-follow">${icon(following ? 'check' : 'userPlus', 16)}${following ? '已关注' : '关注'}</button>` : ''}
          <button class="btn outlined sm ${liked ? 'liked' : ''}" id="c-like">${icon('heart', 16)}${item.likeCount || 0}</button>
        </div>
      </div>
      <p class="detail-prompt">${UI.esc(item.prompt || '')}</p>
      <div class="kv-grid">
        <div><div class="k">模型</div><div class="v">${UI.esc(item.model || '')}</div></div>
        <div><div class="k">尺寸</div><div class="v">${UI.esc(item.size || '—')}</div></div>
        <div><div class="k">发布</div><div class="v">${UI.fmtDate(item.approvedAt || item.createdAt)}</div></div>
        <div><div class="k">二创</div><div class="v">${item.remixCount || 0} 次</div></div>
      </div>
      ${tags ? `<div class="chips" style="margin-top:12px">${tags}</div>` : ''}
    </div>
  </div>`;

  const foot = sheet.dialog.querySelector('.dialog-actions') || sheet.dialog.appendChild(Object.assign(document.createElement('div'), { className: 'dialog-actions' }));
  foot.innerHTML = `
    <button class="btn tonal" id="c-remix">${icon('sparkle', 18)}二创</button>
    <button class="btn text" id="c-dl">${icon('download', 18)}保存</button>
    <button class="btn text" id="c-report">${icon('flag', 18)}举报</button>
    ${mine && item.sourceGenerationId ? `<button class="btn text" id="c-vis">${icon(item.communityVisibility === 'private' ? 'globe' : 'lock', 18)}${item.communityVisibility === 'private' ? '公开' : '私密'}</button>` : ''}`;

  sheet.body.querySelector('#c-like')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const willLike = !item.isLiked;
    try {
      const res = await api('/local/gallery/likes', {
        method: willLike ? 'POST' : 'DELETE',
        body: { generationId: item.id },
      });
      if (typeof res?.isLiked === 'boolean') {
        item.isLiked = res.isLiked;
        item.likeCount = typeof res.likeCount === 'number' ? res.likeCount : item.likeCount;
      } else {
        item.isLiked = willLike;
        item.likeCount = Math.max(0, (item.likeCount || 0) + (willLike ? 1 : -1));
      }
      const listItem = S.community.items.find((x) => x.id === item.id);
      if (listItem) {
        listItem.isLiked = item.isLiked;
        listItem.likeCount = item.likeCount;
      }
      UI.toast(item.isLiked ? '已点赞' : '已取消点赞', 'ok');
      paintCommunity(sheet, item, reload);
    } catch (e2) {
      btn.disabled = false;
      UI.toast(e2.message, 'error');
    }
  });

  sheet.body.querySelector('#c-follow')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('/local/community/follows', {
        method: 'PUT',
        body: { viewerId: S.user?.id || '', creatorId: item.userId, following: !following },
      });
      if (following) S.community.follows.delete(item.userId);
      else S.community.follows.add(item.userId);
      UI.toast(following ? '已取消关注' : '已关注', 'ok');
      await reload();
    } catch (err) {
      UI.toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  foot.querySelector('#c-remix')?.addEventListener('click', () => {
    S.compose.prompt = item.prompt || '';
    S.compose.mode = item.mode === 'video' ? 'video' : 'image';
    if (item.mode !== 'video' && S.models.image.some((m) => m.id === item.model)) S.compose.imageModel = item.model;
    if (item.mode === 'video' && S.models.video.some((m) => m.id === item.model)) S.compose.videoModel = item.model;
    S.compose.source = { communityId: item.id };
    sheet.close();
    R.navigate('create');
    UI.toast('已载入提示词，生成成功后会自动登记二创', 'ok');
  });

  foot.querySelector('#c-dl')?.addEventListener('click', () => {
    UI.downloadAsset((item.assets?.[0]?.url) || item.previewThumbnailUrl, `imagifly-${item.model || 'community'}-${String(item.id).slice(-6)}`);
  });

  foot.querySelector('#c-report')?.addEventListener('click', () => openReport(item));
  foot.querySelector('#c-vis')?.addEventListener('click', async () => {
    const next = item.communityVisibility === 'private' ? 'public' : 'private';
    try {
      await api('/local/community/' + encodeURIComponent(item.id), {
        method: 'PATCH',
        body: { generationIds: [item.sourceGenerationId], visibility: next },
      });
      item.communityVisibility = next;
      UI.toast('可见性已更新', 'ok');
      paintCommunity(sheet, item, reload);
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  });
}

function openReport(item) {
  const sheet = UI.openSheet({
    title: '举报作品',
    subtitle: item.id,
    size: 'narrow',
    body: `<div class="field"><label>原因</label><div class="chips">
      ${['不当内容', '侵权', '垃圾信息', '其他'].map((r, i) => `<button class="chip ${i === 0 ? 'selected' : ''}" data-report-reason="${UI.esc(r)}">${UI.esc(r)}</button>`).join('')}
    </div></div>
    <div class="field" style="margin-top:12px"><label>补充说明</label><div class="field-box area"><textarea id="reportDetails" placeholder="可选，描述具体问题…"></textarea></div></div>`,
    actions: `<button class="btn text" id="rp-cancel">取消</button><button class="btn filled" id="rp-send">提交举报</button>`,
  });
  let reason = '不当内容';
  sheet.root.querySelectorAll('[data-report-reason]').forEach((b) => {
    b.addEventListener('click', () => {
      reason = b.dataset.reportReason;
      sheet.root.querySelectorAll('[data-report-reason]').forEach((x) => x.classList.toggle('selected', x === b));
    });
  });
  sheet.root.querySelector('#rp-cancel').onclick = () => sheet.close();
  sheet.root.querySelector('#rp-send').onclick = async () => {
    const details = sheet.root.querySelector('#reportDetails').value;
    try {
      await api('/local/reports', { method: 'POST', body: { communityGenerationId: item.id, reason, details } });
      UI.toast('举报已提交', 'ok');
      sheet.close();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  };
}

export const communityActions = {
  'com-kind': (d) => {
    S.community.kind = d.kind || 'community';
    S.community.offset = 0;
    S.community.items = [];
    S.community.loaded = false;
    renderCommunity(document.getElementById('view'));
  },
  'com-mode': (d) => {
    S.community.mode = d.value;
    S.community.offset = 0;
    S.community.items = [];
    S.community.loaded = false;
    renderCommunity(document.getElementById('view'));
  },
  'com-search': () => applySearch(document.getElementById('comSearch')?.value || ''),
  'com-search-clear': () => applySearch(''),
  'com-more': async () => {
    const c = S.community;
    c.offset = c.nextOffset || c.items.length;
    try {
      await loadFeed();
      paint(document.getElementById('view'));
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'open-community': (d) => openCommunity(d.id),
};
