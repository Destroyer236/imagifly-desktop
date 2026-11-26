import { api } from './api.js';
import { S } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { openCommunity } from './screen-community.js';
import { R } from './runtime.js';

const SOURCE_LABELS = {
  daily: '每日签到',
  other: '其他额度',
  signup: '注册赠送',
  referral: '邀请返利',
  subscription: '订阅额度',
  promo: '活动赠送',
};

const NOTIF_TYPES = {
  like: '收到点赞',
  comment: '收到评论',
  follow: '新增关注',
  remix: '作品被二创',
  system: '系统通知',
  moderation: '审核结果',
  billing: '订阅变更',
};

const CREDIT_REQUESTS = [
  ['summary', '/local/profile/summary'],
  ['gallery', '/local/gallery?section=summary'],
  ['history', '/local/profile/credit-history'],
  ['referral', '/local/referral/summary'],
  ['share', '/local/referral/share-code'],
  ['packages', '/local/billing/packages'],
];

function settingsRequests() {
  return [
    ['summary', '/local/profile/summary'],
    ['gallery', '/local/gallery?section=summary'],
    ['follows', '/local/community/follows'],
    ['notifications', '/local/notifications'],
    ['devices', '/local/oauth/devices'],
    ['accounts', '/local/accounts'],
  ];
}

function errorBanner(errors) {
  return errors.length
    ? `<div class="banner error" style="margin-bottom:16px">${icon('alert', 20)}<div>部分数据加载失败：${UI.esc(errors.join('；'))}</div></div>`
    : '';
}

async function loadBlocks(requests, view) {
  view.innerHTML = `<div class="page">${UI.skeletonPage(5)}</div>`;
  const settled = await Promise.allSettled(requests.map(([, path]) => api(path)));
  const errors = [];
  settled.forEach((r, i) => {
    const [name] = requests[i];
    if (r.status === 'fulfilled') S.account[name] = r.value;
    else errors.push(r.reason?.message || '加载失败');
  });
  return errors;
}

export async function renderCredits(view) {
  const errors = await loadBlocks(CREDIT_REQUESTS, view);
  view.innerHTML = `<div class="page">
    ${errorBanner(errors)}
    ${creditHero()}
    ${statsBlock()}
    ${historyBlock()}
    ${packagesBlock()}
    ${referralBlock()}
  </div>`;
}

export async function renderSettings(view) {
  const errors = await loadBlocks(settingsRequests(), view);
  view.innerHTML = `<div class="page narrow">
    ${errorBanner(errors)}
    <div class="settings-stack">
      ${profileBlock()}
      ${appearanceBlock()}
      ${accountsBlock()}
      ${notifBlock()}
      ${securityBlock()}
      ${devicesBlock()}
      ${localBlock()}
    </div>
  </div>`;
  bindAvatar(view);
  bindThemePicker(view);
}

const RELATION_META = {
  following: {
    title: '关注',
    sub: '你关注的创作者',
    icon: 'userPlus',
    emptyTitle: '还没有关注任何创作者',
    emptyText: '在社区作品里点「关注」，喜欢的作者就会出现在这里。',
    cta: '<button class="btn tonal sm" data-act="nav" data-route="community">去社区看看</button>',
  },
  received: {
    title: '收到点赞',
    sub: '别人赞了你的公开作品',
    icon: 'heart',
    emptyTitle: '还没有收到点赞',
    emptyText: '作品公开到社区后，收到的赞会按作品显示在这里。',
    cta: '<button class="btn tonal sm" data-act="nav" data-route="community">去社区看看</button>',
  },
  liked: {
    title: '点赞了别人',
    sub: '你在社区赞过的作品',
    icon: 'heart',
    emptyTitle: '还没有点赞社区作品',
    emptyText: '在社区里点赞的作品会按时间收在这里。',
    cta: '<button class="btn tonal sm" data-act="nav" data-route="community">去社区看看</button>',
  },
  works: {
    title: '公开作品',
    sub: '你公开到社区的图片和视频',
    icon: 'globe',
    emptyTitle: '还没有公开作品',
    emptyText: '在作品详情里公开到社区后，作品会显示在这里。',
    cta: '<button class="btn tonal sm" data-act="nav" data-route="library">去作品库</button>',
  },
};

function workThumb(item) {
  const asset = item.assets?.[0];
  const rawThumb = item.previewThumbnailUrl || asset?.thumbnailUrl || '';
  const image = UI.assetImageURL(asset) || UI.mediaURL(rawThumb);
  const video = UI.proxyMediaURL(asset?.url || item.previewVideoUrl);
  if (item.mode === 'video' && video) {
    return `<video src="${video}"${image ? ` poster="${image}"` : ''} muted playsinline preload="metadata"></video>`;
  }
  if (image) {
    const fallback = UI.proxyMediaURL(rawThumb || asset?.url || '');
    return `<img src="${image}" alt="" loading="lazy" decoding="async"${fallback ? ` data-fallback="${UI.esc(fallback)}"` : ''}>`;
  }
  return `<div class="ph">${icon(item.mode === 'video' ? 'movie' : 'image', 28)}</div>`;
}

function relationWorkRow(item, kind) {
  const date = item.likedAt || item.approvedAt || item.createdAt;
  const likeCount = Number(item.likeCount) || 0;
  const meta = kind === 'liked'
    ? `${UI.esc(item.authorName || '社区作者')} · ${date ? UI.fmtDate(date, true) : '已点赞'}`
    : `${likeCount} 个赞${date ? ' · ' + UI.fmtDate(date, true) : ''}`;
  return `<button class="relation-row work" data-act="open-work" data-id="${UI.esc(item.communityGenerationId || item.id || '')}">
    <div class="relation-thumb">${workThumb(item)}</div>
    <div class="main"><div class="t">${UI.esc(item.prompt || '未命名作品')}</div><div class="s">${meta}</div></div>
    <span class="pill">${icon('heart', 12)}${likeCount}</span>
    <span class="go">${icon('chevronRight', 15)}</span>
  </button>`;
}

function relationPersonRow(item) {
  return `<button class="relation-row" data-act="open-creator" data-id="${UI.esc(item.id || '')}">
    ${UI.avatarHTML(item, 'md')}
    <div class="main"><div class="t">${UI.esc(item.name || '未命名创作者')}</div><div class="s mono">${UI.esc(item.id || '')}</div></div>
    <span class="pill ${item.available === false ? 'warn' : 'ok'}">${item.available === false ? '不可用' : '已关注'}</span>
    <span class="go">${icon('chevronRight', 15)}</span>
  </button>`;
}

export async function renderRelations(view) {
  const kind = ['following', 'received', 'liked', 'works'].includes(S.account.relationKind) ? S.account.relationKind : 'following';
  const meta = RELATION_META[kind];
  const title = document.getElementById('pageTitle');
  const sub = document.getElementById('pageSub');
  if (title) title.textContent = meta.title;
  if (sub) sub.textContent = meta.sub;
  view.innerHTML = `<div class="page narrow">${UI.skeletonPage(5)}</div>`;
  try {
    let count = 0;
    let countMore = false;
    let rows = '';
    if (kind === 'following') {
      const data = await api('/local/community/follows?offset=0');
      S.account.follows = data;
      const items = Array.isArray(data.items) ? data.items : [];
      S.account.relationItems = items;
      count = items.length;
      countMore = !!data.hasMore;
      rows = items.map(relationPersonRow).join('');
    } else if (kind === 'liked') {
      const [data, summary] = await Promise.all([
        api('/local/gallery?section=likes&limit=48&offset=0'),
        api('/local/gallery?section=summary'),
      ]);
      S.account.gallery = summary;
      const items = (Array.isArray(data.items) ? data.items : [])
        .filter((x) => x.userId !== S.user?.id)
        .sort((a, b) => String(b.likedAt || '').localeCompare(String(a.likedAt || '')));
      S.account.likedWorks = items;
      count = typeof summary.likeCount === 'number' ? summary.likeCount : items.length;
      countMore = !!data.hasMore;
      rows = items.map((x) => relationWorkRow(x, 'liked')).join('');
    } else if (kind === 'works') {
      const me = encodeURIComponent(S.user?.id || '');
      const [imgs, vids] = await Promise.all([
        api(`/local/community?mode=image&author=${me}`),
        api(`/local/community?mode=video&author=${me}`),
      ]);
      const items = [...(imgs.items || []), ...(vids.items || [])]
        .sort((a, b) => String(b.approvedAt || b.createdAt || '').localeCompare(String(a.approvedAt || a.createdAt || '')));
      S.account.publicWorks = items;
      count = typeof S.account.summary?.stats?.publicCommunityCount === 'number' ? S.account.summary.stats.publicCommunityCount : items.length;
      countMore = !!(imgs.hasMore || vids.hasMore);
      rows = items.map((x) => relationWorkRow(x, 'works')).join('');
    } else {
      const me = encodeURIComponent(S.user?.id || '');
      const [imgs, vids] = await Promise.all([
        api(`/local/community?mode=image&author=${me}`),
        api(`/local/community?mode=video&author=${me}`),
      ]);
      const items = [...(imgs.items || []), ...(vids.items || [])]
        .filter((x) => (Number(x.likeCount) || 0) > 0)
        .sort((a, b) => (Number(b.likeCount) || 0) - (Number(a.likeCount) || 0));
      const total = [...(imgs.items || []), ...(vids.items || [])].reduce((sum, x) => sum + (Number(x.likeCount) || 0), 0);
      S.account.receivedWorks = items;
      count = total;
      countMore = !!(imgs.hasMore || vids.hasMore);
      rows = items.map((x) => relationWorkRow(x, 'received')).join('');
    }
    const countText = countMore ? `${count}+` : count;
    view.innerHTML = `<div class="page narrow">
      <div class="relation-head">
        <button class="icon-btn" data-act="nav" data-route="settings" data-tip="返回设置">${icon('chevronLeft', 20)}</button>
        <div class="relation-title"><div class="eyebrow">账号 · 社区关系</div><div class="h2">${meta.title}</div><div class="s">${meta.sub}</div></div>
        <span class="pill relation-count">${countText}</span>
      </div>
      ${rows ? `<div class="relation-list">${rows}</div>` : UI.emptyState(meta.icon, meta.emptyTitle, meta.emptyText, meta.cta)}
    </div>`;
  } catch (e) {
    view.innerHTML = `<div class="page narrow">
      <div class="relation-head"><button class="icon-btn" data-act="nav" data-route="settings" data-tip="返回设置">${icon('chevronLeft', 20)}</button><div class="relation-title"><div class="eyebrow">账号 · 社区关系</div><div class="h2">${meta.title}</div><div class="s">${meta.sub}</div></div></div>
      <div class="banner error" style="margin-top:16px">${icon('alert', 20)}<div><b>加载失败</b><br>${UI.esc(e.message)}</div></div>
      <div style="margin-top:14px"><button class="btn tonal" data-act="refresh">重新加载</button></div>
    </div>`;
  }
}

async function openCreator(id) {
  const item = (S.account.relationItems || []).find((x) => x.id === id) || { id, name: '创作者' };
  const sheet = UI.openSheet({
    title: item.name || '创作者',
    subtitle: '创作者资料',
    size: 'wide',
    body: `<div class="loading-page"><div class="skel" style="height:90px"></div><div class="skel" style="height:180px"></div></div>`,
  });
  try {
    const author = encodeURIComponent(item.id || id);
    const [imgs, vids] = await Promise.all([
      api(`/local/community?mode=image&author=${author}`),
      api(`/local/community?mode=video&author=${author}`),
    ]);
    const works = [...(imgs.items || []), ...(vids.items || [])]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const countLabel = `${works.length}${(imgs.hasMore || vids.hasMore) ? '+' : ''}`;
    const cards = works.length
      ? `<div class="creator-works">${works.slice(0, 8).map((w) => `<button class="creator-work" data-work-id="${UI.esc(w.id || '')}">
          <div class="thumb">${workThumb(w)}</div><div class="cap"><span>${UI.esc(w.prompt || '未命名作品')}</span><b>${icon('heart', 12)}${Number(w.likeCount) || 0}</b></div>
        </button>`).join('')}</div>`
      : `<div class="field-help" style="margin-top:14px">这位创作者还没有公开作品。</div>`;
    sheet.body.innerHTML = `<div class="creator-profile">
      ${UI.avatarHTML(item, 'lg')}
      <div class="profile-meta"><div class="n">${UI.esc(item.name || '未命名创作者')}</div><div class="e mono">${UI.esc(item.id || '')}</div>
        <div class="creator-tags"><span class="pill ok">已关注</span><span class="pill">${item.available === false ? '账号不可用' : '社区创作者'}</span><span class="pill">公开作品 ${countLabel}</span></div>
      </div>
      <button class="btn outlined sm" id="creator-unfollow">取消关注</button>
    </div>
    <div class="creator-works-head"><div class="t">公开作品</div><div class="s">点击作品查看完整信息</div></div>
    ${cards}`;
    sheet.body.querySelector('#creator-unfollow')?.addEventListener('click', async () => {
      try {
        await api('/local/community/follows', {
          method: 'PUT',
          body: { viewerId: S.user?.id || '', creatorId: item.id, following: false },
        });
        if (S.account.follows?.items) S.account.follows.items = S.account.follows.items.filter((x) => x.id !== item.id);
        if (S.community?.follows instanceof Set) S.community.follows.delete(item.id);
        UI.closeSheet();
        UI.toast(`已取消关注${item.name ? ' ' + item.name : ''}`, 'ok');
        renderRelations(document.getElementById('view'));
      } catch (e) {
        UI.toast(e.message, 'error');
      }
    });
    sheet.body.querySelectorAll('[data-work-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const workId = btn.dataset.workId;
        UI.closeSheet();
        if (workId) openCommunity(workId);
      });
    });
  } catch (e) {
    sheet.body.innerHTML = `<div class="banner error">${icon('alert', 20)}<div>${UI.esc(e.message)}</div></div>`;
  }
}

function refreshCurrentAccountPage() {
  const view = document.getElementById('view');
  if (!view) return;
  if (S.route === 'settings') renderSettings(view);
  else if (S.route === 'credits') renderCredits(view);
}

function creditHero() {
  const summary = S.account.summary;
  const usage = summary?.creditUsage || {};
  const available = usage.availableCredits ?? S.user?.credits ?? 0;
  const total = usage.totalCredits ?? available;
  const used = usage.usedCredits ?? 0;
  const pct = usage.usedPercentage ?? (total ? (used / total) * 100 : 0);
  const tier = S.billing?.activePlan?.tier || 'free';
  const availablePct = Math.max(0, Math.min(100, 100 - pct));
  return `<section class="credit-hero">
    <div class="gauge">${UI.gaugeSVG(availablePct)}<div class="inner"><div class="big num">${UI.fmtCredits(available)}</div><div class="unit">可用额度</div></div></div>
    <div class="credit-info">
      <div class="label-row"><span class="pill">${icon('card', 13)}${tier.toUpperCase()} 套餐</span><span class="pill">${icon('sparkle', 13)}已用 ${UI.fmtCredits(used)}</span></div>
      <div class="amount num">${UI.fmtCredits(available)} <span style="font-size:13px;color:var(--on-surface-variant);font-weight:500">额度</span></div>
      <div class="facts"><span>总额度 ${UI.fmtCredits(total)}</span><span>使用率 ${pct.toFixed(1)}%</span><span>${S.account.summary?.stats?.successfulGenerations || 0} 次成功生成</span></div>
      <div class="credit-actions">
        <button class="btn tonal" data-act="daily">${icon('gift', 18)}每日签到</button>
        <button class="btn outlined" data-act="redeem">${icon('checkCircle', 18)}兑换码</button>
        <button class="btn text" data-act="account-refresh">${icon('refresh', 18)}刷新</button>
      </div>
    </div>
  </section>`;
}

function statsBlock() {
  const st = S.account.summary?.stats || {};
  const items = [
    ['图片生成', st.imageGenerations || 0],
    ['视频生成', st.videoGenerations || 0],
    ['成功生成', st.successfulGenerations || 0],
    ['消耗额度', UI.fmtCredits(st.spentCredits || 0)],
    ['点赞了别人', typeof S.account.gallery?.likeCount === 'number' ? S.account.gallery.likeCount : '—'],
    ['公开作品', st.publicCommunityCount || 0],
  ];
  return `<section class="sect">${UI.sectionHead('统计', '来自 /api/profile/summary')}<div class="stat-grid">${items.map(([k, v]) => `<div class="stat"><div class="v num">${v}</div><div class="k">${k}</div></div>`).join('')}</div></section>`;
}

function historyBlock() {
  const h = S.account.history;
  const txs = (h?.transactions || []).slice(0, 8);
  const breakdown = S.account.summary?.creditBreakdown || [];
  const bars = breakdown.map((b) => `<div class="bar-row"><span>${UI.esc(SOURCE_LABELS[b.source] || b.source)}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, b.percentage || 0))}%"></i></span><span class="pct">${UI.fmtCredits(b.credits)} · ${(b.percentage || 0).toFixed(1)}%</span></div>`).join('');
  const rows = txs.length
    ? txs.map((t) => {
      const positive = Number(t.credits) >= 0;
      return `<div class="list-row">
        <span class="ic">${icon(positive ? 'plus' : 'sparkle', 18)}</span>
        <div class="main"><div class="t">${UI.esc(t.description || t.kind)}</div><div class="s">${UI.fmtDate(t.createdAt, true)}${t.model ? ' · ' + UI.esc(t.model) : ''}${t.expiresAt ? ' · 到期 ' + UI.fmtDate(t.expiresAt) : ''}</div></div>
        <span class="pill ${positive ? 'ok' : 'warn'}">${positive ? '+' : ''}${UI.fmtCredits(t.credits)}</span>
      </div>`;
    }).join('')
    : UI.emptyState('history', '暂无额度流水', '签到或生成后这里会出现记录。');
  return `<section class="sect">${UI.sectionHead('额度构成与流水', 'creditBreakdown + credit-history')}
    <div class="card pad-sm" style="padding:18px">${bars || '<span class="field-help">暂无构成数据</span>'}<hr class="divider"><div class="list">${rows}</div></div></section>`;
}

function packagesBlock() {
  const list = S.account.packages?.packages || [];
  const tier = S.billing?.activePlan?.tier || 'free';
  const cards = list
    .filter((p) => p.kind === 'plan')
    .map((p) => {
      const price = p.amountCents ? `$${(p.amountCents / 100).toFixed(2)}` : '—';
      const isCurrent = p.name?.toLowerCase().includes(tier) && tier !== 'free';
      return `<div class="pkg ${p.featured ? 'featured' : ''}">
        <div class="top"><h4>${UI.esc(p.name)}</h4>${p.featured ? `<span class="pill">推荐</span>` : ''}${isCurrent ? `<span class="pill ok">当前</span>` : ''}</div>
        <div class="price">${price}<small> / ${UI.esc(p.currency?.toUpperCase() || 'USD')}</small></div>
        <div class="field-help">${UI.fmtNum(p.credits)} 额度${p.creditBonusPercent ? ` · +${p.creditBonusPercent}% 赠送` : ''}</div>
        <ul>${(p.features || []).slice(0, 3).map((f) => `<li>${UI.esc(f)}</li>`).join('')}</ul>
        <button class="btn ${p.featured ? 'filled' : 'tonal'} sm wide" data-act="checkout" data-id="${UI.esc(p.id)}" ${p.checkoutReady === false ? 'disabled' : ''}>${icon('card', 16)}${isCurrent ? '续费' : '订阅'}</button>
      </div>`;
    })
    .join('');
  return `<section class="sect">${UI.sectionHead('订阅套餐', '价格由服务端决定，客户端不传金额')}<div class="pkg-grid">${cards || '<span class="field-help">暂无套餐</span>'}</div></section>`;
}

function ownPublicWorks() {
  const imgs = S.account.mineImages?.items || [];
  const vids = S.account.mineVideos?.items || [];
  return [...imgs, ...vids].filter((x) => x.userId === S.user?.id);
}

function receivedLikeCount() {
  const stats = S.account.summary?.stats;
  if (stats && typeof stats.likeCount === 'number') return stats.likeCount;
  if (!S.account.mineImages || !S.account.mineVideos) return null;
  return ownPublicWorks().reduce((sum, x) => sum + (Number(x.likeCount) || 0), 0);
}

function profileBlock() {
  const u = S.user || {};
  const tier = (S.billing?.activePlan?.tier || 'free').toUpperCase();
  const stats = S.account.summary?.stats;
  const st = (key) => (stats ? (stats[key] || 0) : '—');
  const follows = S.account.follows;
  const followItems = Array.isArray(follows?.items) ? follows.items : [];
  const followingLabel = follows ? `${followItems.length}${follows.hasMore ? '+' : ''}` : '—';
  const received = receivedLikeCount();
  const receivedLabel = received == null ? '—' : received;
  const likedOthers = S.account.gallery?.likeCount;
  const likedOthersLabel = typeof likedOthers === 'number' ? likedOthers : '—';
  const clickable = (kind, label, value) => `<button class="pstat click" data-act="nav" data-route="relations" data-kind="${kind}" aria-label="查看${label}">
    <span class="v num">${value}</span><span class="k">${label}</span><span class="go">${icon('chevronRight', 13)}</span>
  </button>`;
  return `<section class="card">
    <div class="profile-row">
      ${UI.avatarHTML(u, 'lg')}
      <div class="profile-meta"><div class="n">${UI.esc(u.name || '')}</div><div class="e">${UI.esc(u.email || '')}</div></div>
      <button class="icon-btn sm" data-act="edit-profile" data-tip="编辑资料" style="margin-left:auto">${icon('edit', 18)}</button>
    </div>
    <div class="field-help" style="margin-top:12px">${UI.esc(u.profileBio || '还没有简介')}</div>
    <div class="profile-details">
      <div class="detail-cell wide">
        <span class="k">账号 ID</span><span class="v mono">${UI.esc(u.id || '未登录')}</span>
        <button class="icon-btn sm" data-act="copy-account-id" data-tip="复制账号 ID">${icon('copy', 15)}</button>
      </div>
      <div class="detail-cell"><span class="k">注册时间</span><span class="v">${u.createdAt ? UI.fmtDate(u.createdAt) : '—'}</span></div>
      <div class="detail-cell"><span class="k">当前套餐</span><span class="v">${tier}</span></div>
    </div>
    <div class="profile-stats">
      ${clickable('following', '关注', followingLabel)}
      ${clickable('works', '公开作品', st('publicCommunityCount'))}
      ${clickable('received', '收到点赞', receivedLabel)}
      ${clickable('liked', '点赞了别人', likedOthersLabel)}
      <div class="pstat"><span class="v num">${st('successfulGenerations')}</span><span class="k">成功生成</span></div>
    </div>
    <div class="profile-hint">${icon('info', 13)}点击「关注」「公开作品」「收到点赞」或「点赞了别人」查看名单与作品</div>
    <hr class="divider">
    <div class="chips">
      <button class="btn text xs" data-act="upload-avatar">${icon('camera', 15)}更换头像</button>
      <button class="btn text xs" data-act="change-password">${icon('lock', 15)}修改密码</button>
    </div>
  </section>`;
}

function accountsBlock() {
  const data = S.account.accounts || {};
  const list = data.accounts || [];
  const rows = list.map((a) => {
    const active = !!a.active;
    const name = a.name || a.email || '已保存账号';
    return `<div class="list-row account-row ${active ? 'active' : ''}">
      ${UI.avatarHTML(a)}
      <div class="main">
        <div class="t">${UI.esc(name)}${active ? '<span class="pill ok" style="margin-left:8px">当前</span>' : ''}</div>
        <div class="s">${UI.esc(a.email || '')} · ${(a.plan || 'free').toUpperCase()}</div>
      </div>
      <div class="trail">
        ${active ? '' : `<button class="btn text xs" data-act="switch-account" data-id="${UI.esc(a.id || '')}">切换</button>`}
        <button class="btn text xs" data-act="remove-account" data-id="${UI.esc(a.id || '')}">${active ? '退出' : '移除'}</button>
      </div>
    </div>`;
  }).join('');
  const add = `<button class="btn tonal xs" data-act="add-account">${icon('plus', 15)}添加账号</button>`;
  return `<section class="sect">${UI.sectionHead('账号切换', `本机已保存 ${list.length} 个账号`, add)}
    <div class="card pad-sm account-list" style="padding:8px 14px">
      ${rows || UI.emptyState('person', '还没有保存的账号', '添加第二个账号后，可在多个账号之间一键切换。')}
    </div>
    <div class="field-help" style="margin-top:8px">切换时会重新加载该账号的额度、作品和通知；密码不会保存，只有 DPAPI 加密的会话 Cookie。</div>
  </section>`;
}

function notifBlock() {  const list = S.account.notifications?.items || [];
  const rows = list.slice(0, 6).map((n) => {
    const unread = !(n.read || n.isRead);
    const title = n.title || NOTIF_TYPES[n.type] || '通知';
    const body = n.message || n.body || '';
    return `<div class="notif ${unread ? 'unread' : ''}">
      <div class="t">${unread ? '<span class="dot"></span>' : ''}${UI.esc(title)}<span class="muted" style="margin-left:auto;font-size:10.5px">${UI.timeAgo(n.createdAt)}</span></div>
      ${body ? `<div class="b">${UI.esc(body)}</div>` : ''}
      ${unread && n.id ? `<div style="margin-top:8px"><button class="btn text xs" data-act="notif-read" data-id="${UI.esc(n.id)}">标记已读</button></div>` : ''}
    </div>`;
  }).join('');
  return `<section class="sect">${UI.sectionHead('通知', `${list.length} 条`, `<button class="btn text xs" data-act="notif-read-all">全部已读</button><button class="btn text xs" data-act="notif-clear">清空</button>`)}
    <div class="card pad-sm" style="padding:14px">${rows || UI.emptyState('bell', '没有通知', '点赞、关注与审核结果会出现在这里。')}</div></section>`;
}

function referralBlock() {
  const ref = S.account.referral?.summary || S.account.referral || {};
  const code = S.account.share?.code || '';
  const link = ref.inviteLink || (code ? `https://imagifly.net/r/${code}` : '');
  const stats = [
    ['注册', ref.signups || 0],
    ['付费', ref.paying || 0],
    ['已赚', UI.fmtCredits(ref.earnedCredits || 0)],
    ['待入账', UI.fmtCredits(ref.pendingCredits || 0)],
  ];
  return `<section class="sect">${UI.sectionHead('邀请', 'referral summary / share-code')}
    <div class="card pad-sm" style="padding:16px">
      <div class="field-box" style="min-height:42px">${icon('link', 18)}<input readonly value="${UI.esc(link)}" id="inviteLink"><button class="icon-btn sm" data-act="copy-invite" data-tip="复制">${icon('copy', 16)}</button></div>
      <div class="stat-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:12px">${stats.map(([k, v]) => `<div class="stat" style="padding:10px 12px"><div class="v" style="font-size:18px">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
      <div class="chips" style="margin-top:12px">
        <span class="chip static">${icon('key', 15)}${UI.esc(code || '—')}</span>
        <button class="btn text xs" data-act="copy-code">复制邀请码</button>
        <button class="btn text xs" data-act="capture-referral">${icon('userPlus', 15)}绑定朋友的邀请码</button>
      </div>
    </div></section>`;
}

function securityBlock() {
  return `<section class="sect">${UI.sectionHead('安全与本地', '')}
    <div class="card pad-sm" style="padding:14px">
      <div class="list-row"><span class="ic">${icon('lock', 18)}</span><div class="main"><div class="t">会话存储</div><div class="s">DPAPI 加密 · %AppData%\\ImagiflyDesktop\\accounts.bin（每个账号一份）</div></div><span class="pill ok">已加密</span></div>
      <div class="list-row"><span class="ic">${icon('logout', 18)}</span><div class="main"><div class="t">退出当前账号</div><div class="s">其他已保存账号会保留，可在账号切换中一键切回</div></div><button class="btn text xs" data-act="logout">退出</button></div>
    </div></section>`;
}

function devicesBlock() {
  const list = S.account.devices;
  const items = list?.devices || list?.items || [];
  const rows = items.map((d) => `<div class="list-row">
    <span class="ic">${icon('key', 18)}</span>
    <div class="main"><div class="t">${UI.esc(d.name || d.platform || d.id)}</div><div class="s">${UI.esc(d.id || '')} · 最近活跃 ${UI.timeAgo(d.lastSeenAt || d.createdAt)}</div></div>
    <button class="btn text xs" data-act="revoke-device" data-id="${UI.esc(d.id)}">撤销</button>
  </div>`).join('');
  return `<section class="sect">${UI.sectionHead('已授权设备', 'oauth/devices')}
    <div class="card pad-sm" style="padding:14px">${rows || UI.emptyState('key', '没有授权设备', '通过 MCP 或 OAuth 授权的设备会列在这里。')}</div></section>`;
}

function localBlock() {
  const dir = S.cfg?.downloadDir || '';
  return `<section class="sect">${UI.sectionHead('下载与本地', '媒体代理只允许 imagifly.net 域名')}
    <div class="card pad-sm" style="padding:16px">
      <div class="field"><label>下载目录</label><div class="field-box">${icon('folder', 18)}<input readonly value="${UI.esc(dir)}"><button class="icon-btn sm" data-act="set-download-dir" data-tip="更改目录">${icon('edit', 16)}</button><button class="icon-btn sm" data-act="open-download-dir" data-tip="打开目录">${icon('external', 16)}</button></div></div>
      <div class="field-help" style="margin-top:8px">保存原图/原视频时自动创建目录并去重命名。</div>
      <hr class="divider">
      <div class="list-row" style="padding:4px 0"><span class="ic">${icon('image', 18)}</span><div class="main"><div class="t">媒体加载</div><div class="s">通过本地 /local/media 代理，支持视频 Range 拖动</div></div><span class="pill ok">已启用</span></div>
    </div></section>`;
}

const ACCENT_PRESETS = [
  { name: '品牌蓝', color: '' },
  { name: '雾紫', color: '#6750A4' },
  { name: '薄荷', color: '#006A5E' },
  { name: '落日', color: '#8A4F00' },
  { name: '樱粉', color: '#9C405C' },
  { name: '海蓝', color: '#00677A' },
];

function appearanceBlock() {
  const accent = UI.normalizeAccent(S.cfg?.accent || '');
  const inputColor = accent || '#0061A6';
  const dots = ACCENT_PRESETS.map((preset) => {
    const selected = preset.color ? preset.color.toLowerCase() === accent.toLowerCase() : !accent;
    const dot = preset.color || '#0061A6';
    return `<button class="theme-dot ${selected ? 'selected' : ''}" data-act="set-accent" data-color="${preset.color}" data-accent-option="${preset.color}" data-tip="${preset.name}" aria-label="${preset.name}" style="--dot:${dot}">${selected ? `<span class="theme-dot-check">${icon('check', 13)}</span>` : ''}</button>`;
  }).join('');
  return `<section class="sect" id="themeColorSection" data-theme-section>${UI.sectionHead('主题色', '强调色 · M3 角色自动生成')}
    <div class="card pad-sm" style="padding:16px">
      <div class="theme-color-head">
        <span class="theme-color-swatch" style="background:${accent || '#0061A6'}" aria-hidden="true"></span>
        <div class="main"><div class="t">主题强调色</div><div class="s" id="themeColorValue">${accent ? UI.esc(accent) : '默认品牌蓝'}</div></div>
        <button class="btn text xs" data-act="reset-accent" ${accent ? '' : 'hidden'}>恢复默认</button>
      </div>
      <div class="theme-dots" role="group" aria-label="预设主题色">
        ${dots}
        <label class="theme-custom" data-tip="自定义颜色">
          <input id="themeColorInput" type="color" value="${inputColor}" aria-label="自定义主题色">
          ${icon('palette', 16)}
        </label>
      </div>
      <div class="field-help" style="margin-top:10px">选预设，或点击右侧调色盘选择任意颜色；按钮、卡片、侧栏与背景会立即同步。</div>
    </div></section>`;
}

function bindThemePicker(view) {
  const input = view.querySelector('#themeColorInput');
  if (!input) return;
  input.addEventListener('input', () => {
    UI.applyAccent(input.value);
    const normalized = UI.normalizeAccent(input.value);
    const label = view.querySelector('#themeColorValue');
    if (label) label.textContent = normalized || '默认品牌蓝';
    const swatch = view.querySelector('.theme-color-swatch');
    if (swatch) swatch.style.background = normalized || '#0061A6';
  });
  input.addEventListener('change', () => persistAccent(input.value));
}

function syncAccentUI(color) {
  const section = document.getElementById('themeColorSection');
  if (!section) return;
  const normalized = UI.normalizeAccent(color || '');
  section.querySelectorAll('[data-accent-option]').forEach((el) => {
    const value = el.dataset.accentOption || '';
    const selected = value ? value === normalized : !normalized;
    el.classList.toggle('selected', selected);
    el.innerHTML = selected ? `<span class="theme-dot-check">${icon('check', 13)}</span>` : '';
  });
  const label = section.querySelector('#themeColorValue');
  if (label) label.textContent = normalized || '默认品牌蓝';
  const swatch = section.querySelector('.theme-color-swatch');
  if (swatch) swatch.style.background = normalized || '#0061A6';
  const reset = section.querySelector('[data-act="reset-accent"]');
  if (reset) reset.hidden = !normalized;
  const input = section.querySelector('#themeColorInput');
  if (input) input.value = normalized || '#0061A6';
}

async function persistAccent(color) {
  const previous = UI.normalizeAccent(S.cfg?.accent || '');
  const next = UI.normalizeAccent(color);
  if (next === previous) {
    syncAccentUI(next);
    return;
  }
  UI.applyAccent(next);
  try {
    const cfg = await api('/local/config', { method: 'PATCH', body: { accent: next } });
    S.cfg = { ...(S.cfg || {}), ...cfg };
    syncAccentUI(next);
    UI.toast(next ? '主题色已更新' : '已恢复默认主题色', 'ok');
  } catch (e) {
    UI.applyAccent(previous);
    syncAccentUI(previous);
    UI.toast(e.message, 'error');
  }
}

function bindAvatar(view) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.hidden = true;
  view.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      UI.toast('头像不能超过 5 MB', 'error');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      UI.toast('头像只支持 JPG、PNG 或 WebP', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/local/profile/avatar', { method: 'POST', form: fd });
      await R.refreshSession();
      refreshCurrentAccountPage();
      UI.toast('头像已更新', 'ok');
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  });
  view._avatarInput = input;
}

/* --- actions ------------------------------------------------------------- */

async function doDaily() {
  try {
    const res = await api('/local/credits/daily', { method: 'POST', body: {} });
    if (res.user?.credits !== undefined) {
      S.user.credits = res.user.credits;
      R.paintCredits();
    }
    if (res.claimed) UI.toast(`签到成功，+${UI.fmtCredits(res.creditsGranted)} 额度`, 'ok');
    else UI.toast(`今天已经签到过了（今日共 ${UI.fmtCredits(res.todayCreditsGranted)}）`, 'ok');
    await R.refreshSession();
    refreshCurrentAccountPage();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function doRedeem() {
  const code = await UI.promptSheet({
    title: '兑换码',
    label: '24 位兑换码',
    placeholder: '0123456789ABCDEF01234567',
    subtitle: '空格与连字符会自动清理并转大写',
    confirm: '兑换',
  });
  if (!code) return;
  try {
    const res = await api('/local/redemption-codes', { method: 'POST', body: { code, userId: S.user?.id || '', locale: 'zh' } });
    const reward = res.reward || {};
    let msg = res.alreadyRedeemed ? '该兑换码已被使用' : '兑换成功';
    if (reward.credits) msg += `：+${UI.fmtCredits(reward.credits)} 额度`;
    if (reward.tier) msg += `：${reward.tier.toUpperCase()} ${reward.months || ''} 个月`;
    UI.toast(msg, res.alreadyRedeemed ? 'warn' : 'ok');
    await R.refreshSession();
    S.account.summary = null;
    refreshCurrentAccountPage();
  } catch (e) {
    UI.toast(e.code === 'unavailable' ? '兑换码不存在或已被使用' : e.message, 'error');
  }
}

function editProfile() {
  const u = S.user || {};
  const sheet = UI.openSheet({
    title: '编辑资料',
    subtitle: '昵称至少 2 个字符；简介留空也可以。',
    size: 'narrow',
    body: `<div class="field"><label>昵称</label><div class="field-box"><input id="pfName" value="${UI.esc(u.name || '')}"></div></div>
      <div class="field" style="margin-top:12px"><label>简介</label><div class="field-box area"><textarea id="pfBio" placeholder="一句话介绍自己…">${UI.esc(u.profileBio || '')}</textarea></div></div>`,
    actions: `<button class="btn text" id="pf-cancel">取消</button><button class="btn filled" id="pf-save">保存</button>`,
  });
  sheet.root.querySelector('#pf-cancel').onclick = () => sheet.close();
  sheet.root.querySelector('#pf-save').onclick = async () => {
    const name = sheet.root.querySelector('#pfName').value.trim();
    const bio = sheet.root.querySelector('#pfBio').value;
    if (name.length < 2) return UI.toast('昵称至少需要 2 个字符', 'error');
    try {
      const res = await api('/local/profile', { method: 'PATCH', body: { name, profileBio: bio, hasName: true, hasBio: true } });
      if (res.user) {
        S.user = { ...S.user, ...res.user };
        R.paintCredits();
      }
      UI.toast('资料已保存', 'ok');
      sheet.close();
      refreshCurrentAccountPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  };
}

function addAccountSheet() {
  const sheet = UI.openSheet({
    title: '添加账号',
    subtitle: '验证成功后会立即切换到这个账号；密码不会保存。',
    size: 'narrow',
    body: `<div id="acErr"></div>
      <div class="field"><label>邮箱</label><div class="field-box">${icon('send', 18)}<input id="acEmail" type="email" placeholder="user@example.com" autocomplete="username"></div></div>
      <div class="field" style="margin-top:12px"><label>密码</label><div class="field-box">${icon('lock', 18)}<input id="acPass" type="password" placeholder="••••••••" autocomplete="current-password"></div></div>
      <div class="field-help" style="margin-top:10px">每个账号的会话 Cookie 都会独立加密保存在本机，之后切换无需再次输入密码。</div>`,
    actions: `<button class="btn text" id="ac-cancel">取消</button><button class="btn filled" id="ac-add">${icon('plus', 18)}添加并切换</button>`,
  });
  const errBox = sheet.root.querySelector('#acErr');
  const emailEl = sheet.root.querySelector('#acEmail');
  const passEl = sheet.root.querySelector('#acPass');
  const submit = sheet.root.querySelector('#ac-add');
  sheet.root.querySelector('#ac-cancel').onclick = () => sheet.close();

  const run = async () => {
    errBox.innerHTML = '';
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      errBox.innerHTML = `<div class="field-error">请填写邮箱和密码</div>`;
      return;
    }
    submit.disabled = true;
    const old = submit.innerHTML;
    submit.innerHTML = `${UI.wavyRing(20, 2, 6, 4)}<span>验证中…</span>`;
    try {
      const res = await api('/local/accounts/login', { method: 'POST', body: { email, password } });
      if (!res?.user) throw new Error('登录未返回用户信息');
      UI.toast(`已添加 ${res.user.name || res.user.email}`, 'ok');
      setTimeout(() => location.reload(), 350);
    } catch (e) {
      errBox.innerHTML = `<div class="banner error">${icon('alert', 18)}<div>${UI.esc(e.message)}${e.status ? `（HTTP ${e.status}）` : ''}</div></div>`;
      submit.disabled = false;
      submit.innerHTML = old;
    }
  };
  submit.onclick = run;
  [emailEl, passEl].forEach((el) => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  }));
}

async function switchAccount(id) {
  if (!id) return;
  try {
    await api('/local/accounts/switch', { method: 'POST', body: { id } });
    UI.toast('正在切换账号…', 'ok');
    setTimeout(() => location.reload(), 400);
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function removeAccount(id) {
  if (!id) return;
  const list = S.account.accounts?.accounts || [];
  const target = list.find((a) => a.id === id);
  if (!target) return;
  const active = !!target.active;
  const single = list.length <= 1;
  const name = target.name || target.email;
  const ok = await UI.confirmSheet({
    title: active ? '退出当前账号' : '移除账号',
    text: active
      ? (single
        ? `退出 ${name} 后将清除本机保存的账号，下次需要重新登录。`
        : `退出 ${name} 后会自动切换到下一个已保存账号；该账号的会话将从本机移除。`)
      : `只从本机移除 ${name}，不会影响当前账号。`,
    confirm: active ? '退出' : '移除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api('/local/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
    UI.toast(active ? '已退出当前账号' : '账号已移除', 'ok');
    setTimeout(() => location.reload(), 350);
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

function changePassword() {
  const sheet = UI.openSheet({
    title: '修改密码',
    size: 'narrow',
    body: `<div class="field"><label>当前密码</label><div class="field-box"><input type="password" id="pwCur"></div></div>
      <div class="field" style="margin-top:12px"><label>新密码</label><div class="field-box"><input type="password" id="pwNew" placeholder="至少 6 位"></div></div>
      <div class="field" style="margin-top:12px"><label>确认新密码</label><div class="field-box"><input type="password" id="pwRepeat"></div></div>
      <div class="field-help" style="margin-top:8px">该接口在规范中标注为未验证，成功后可能需要重新登录。</div>`,
    actions: `<button class="btn text" id="pw-cancel">取消</button><button class="btn filled" id="pw-save">修改</button>`,
  });
  sheet.root.querySelector('#pw-cancel').onclick = () => sheet.close();
  sheet.root.querySelector('#pw-save').onclick = async () => {
    const cur = sheet.root.querySelector('#pwCur').value;
    const next = sheet.root.querySelector('#pwNew').value;
    const repeat = sheet.root.querySelector('#pwRepeat').value;
    if (!cur || next.length < 6) return UI.toast('请填写当前密码，新密码至少 6 位', 'error');
    if (next !== repeat) return UI.toast('两次输入的新密码不一致', 'error');
    try {
      await api('/local/profile/password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      UI.toast('密码已修改', 'ok');
      sheet.close();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  };
}

async function checkout(packageId) {
  try {
    const res = await api('/local/billing/checkout', { method: 'POST', body: { packageId, period: 'monthly', locale: 'zh' } });
    if (!res.url) throw new Error('未返回支付链接');
    UI.openExternal(res.url);
    const sessionMatch = String(res.url).match(/cs_[A-Za-z0-9]+/);
    const sessionId = sessionMatch ? sessionMatch[0] : '';
    const sheet = UI.openSheet({
      title: '支付已打开',
      subtitle: '请在系统浏览器完成 Stripe 支付，然后回到这里刷新状态',
      size: 'narrow',
      body: `<div class="banner">${icon('info', 20)}<div>支付链接：<br><span class="mono">${UI.esc(res.url)}</span></div></div>
        <div id="payStatus" class="field-help" style="margin-top:12px">${sessionId ? '会话 ' + UI.esc(sessionId) : '未解析到 session_id，可直接刷新账号查看套餐变化。'}</div>`,
      actions: `<button class="btn text" id="pay-open">${icon('external', 18)}重新打开</button><button class="btn filled" id="pay-check">我已支付，刷新状态</button>`,
    });
    sheet.root.querySelector('#pay-open').onclick = () => UI.openExternal(res.url);
    sheet.root.querySelector('#pay-check').onclick = async (e) => {
      const btn = e.currentTarget;
      const status = sheet.root.querySelector('#payStatus');
      btn.disabled = true;
      try {
        let paid = false;
        if (sessionId) {
          for (let i = 0; i < 10; i++) {
            await sleep(1500);
            try {
              const st = await api('/local/billing/checkout/status?session_id=' + encodeURIComponent(sessionId));
              if (st?.order?.status === 'paid' || st?.billing?.activePlan?.tier !== 'free') {
                paid = true;
                break;
              }
            } catch (err) {
              status.textContent = '查询失败：' + err.message;
              break;
            }
          }
        }
        await R.refreshSession();
        if (paid) {
          UI.toast('支付成功，套餐已更新', 'ok');
          sheet.close();
          S.account.summary = null;
          refreshCurrentAccountPage();
        } else {
          status.textContent = '暂未检测到支付完成；若已扣款，请稍等片刻再刷新。';
        }
      } finally {
        btn.disabled = false;
      }
    };
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const accountActions = {
  'account-refresh': () => refreshCurrentAccountPage(),
  'open-creator': (d) => (d.id ? openCreator(d.id) : null),
  'open-work': (d) => (d.id ? openCommunity(d.id) : null),
  'copy-account-id': async () => {
    const ok = await UI.copyText(S.user?.id || '');
    UI.toast(ok ? '账号 ID 已复制' : '复制失败', ok ? 'ok' : 'error');
  },
  'unfollow-creator': async (d) => {
    try {
      await api('/local/community/follows', {
        method: 'PUT',
        body: { viewerId: S.user?.id || '', creatorId: d.id, following: false },
      });
      if (S.account.follows?.items) S.account.follows.items = S.account.follows.items.filter((f) => f.id !== d.id);
      if (S.community?.follows instanceof Set) S.community.follows.delete(d.id);
      UI.toast(`已取消关注${d.name ? ' ' + d.name : ''}`, 'ok');
      refreshCurrentAccountPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  daily: doDaily,
  redeem: doRedeem,
  'edit-profile': editProfile,
  'add-account': addAccountSheet,
  'switch-account': (d) => switchAccount(d.id),
  'remove-account': (d) => removeAccount(d.id),
  'upload-avatar': () => document.getElementById('view')?._avatarInput?.click(),
  'change-password': changePassword,
  'notif-read': async (d) => {
    try {
      await api(`/local/notifications?id=${encodeURIComponent(d.id)}&uid=${encodeURIComponent(S.user?.id || '')}`, { method: 'PATCH' });
      S.account.notifications = await api('/local/notifications');
      refreshCurrentAccountPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'notif-read-all': async () => {
    try {
      await api(`/local/notifications?all=1&uid=${encodeURIComponent(S.user?.id || '')}`, { method: 'PATCH' });
      S.account.notifications = await api('/local/notifications');
      UI.toast('已全部标记为已读', 'ok');
      refreshCurrentAccountPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'notif-clear': async () => {
    const ok = await UI.confirmSheet({ title: '清空通知', text: '将删除全部通知，确定继续？', confirm: '清空', danger: true });
    if (!ok) return;
    try {
      await api(`/local/notifications?uid=${encodeURIComponent(S.user?.id || '')}`, { method: 'DELETE' });
      S.account.notifications = { items: [] };
      refreshCurrentAccountPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'copy-invite': async () => {
    const ref = S.account.referral?.summary || S.account.referral || {};
    const link = ref.inviteLink || '';
    const ok = await UI.copyText(link);
    UI.toast(ok ? '邀请链接已复制' : '复制失败', ok ? 'ok' : 'error');
  },
  'copy-code': async () => {
    const code = S.account.share?.code || '';
    const ok = await UI.copyText(code);
    UI.toast(ok ? '邀请码已复制' : '复制失败', ok ? 'ok' : 'error');
  },
  'capture-referral': async () => {
    const token = await UI.promptSheet({ title: '绑定邀请码', label: '朋友的邀请码或 /r/ 后缀', confirm: '绑定' });
    if (!token) return;
    const clean = String(token).trim().split('/').pop();
    try {
      const res = await api('/local/referral/capture', { method: 'POST', body: { token: clean } });
      UI.toast(res.captured ? '邀请码已绑定' : '邀请码无效或不能邀请自己', res.captured ? 'ok' : 'warn');
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  checkout: (d) => checkout(d.id),
  'revoke-device': async (d) => {
    const ok = await UI.confirmSheet({ title: '撤销设备', text: '撤销后该设备的 API Key / OAuth 授权会失效。', confirm: '撤销', danger: true });
    if (!ok) return;
    try {
      await api('/local/oauth/devices/' + encodeURIComponent(d.id), { method: 'DELETE' });
      S.account.devices = await api('/local/oauth/devices');
      UI.toast('已撤销', 'ok');
      refreshCurrentAccountPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'set-accent': async (d) => {
    await persistAccent(d.color || '');
  },
  'reset-accent': async () => {
    await persistAccent('');
  },
  'set-download-dir': async () => {
    const dir = await UI.promptSheet({ title: '下载目录', label: '本地绝对路径', value: S.cfg?.downloadDir || '', confirm: '保存' });
    if (!dir) return;
    try {
      const cfg = await api('/local/config', { method: 'PATCH', body: { downloadDir: dir } });
      S.cfg = { ...(S.cfg || {}), ...cfg };
      UI.toast('下载目录已更新', 'ok');
      refreshCurrentAccountPage();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'open-download-dir': () => {
    api('/local/reveal', { method: 'POST', body: { path: S.cfg?.downloadDir || '' } }).catch((e) => UI.toast(e.message, 'error'));
  },
};
