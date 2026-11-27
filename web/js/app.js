import { api, clearApiCache } from './api.js';
import { S, setSession, resetSession, modelInfo } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { R } from './runtime.js';
import { renderCreate, createActions, updateCreateTasks } from './screen-create.js';
import { renderLibrary, libraryActions, updateLibraryTasks } from './screen-library.js';
import { renderCommunity, communityActions } from './screen-community.js';
import { renderCredits, renderSettings, renderRelations, accountActions } from './screen-account.js';
import { renderDev, devActions } from './screen-dev.js';
import { renderAbout } from './screen-about.js';
import { renderUpdate, updateActions } from './screen-update.js';
import { taskActions } from './task.js';

const ROUTES = {
  create: { title: '创作', sub: '写下画面，交给模型', icon: 'sparkle', render: renderCreate, actions: createActions, updateTasks: updateCreateTasks },
  library: { title: '作品', sub: '最近生成与我的作品库', icon: 'library', render: renderLibrary, actions: libraryActions, updateTasks: updateLibraryTasks },
  community: { title: '社区', sub: '看看别人正在生成什么', icon: 'globe', render: renderCommunity, actions: communityActions },
  credits: { title: '积分', sub: '额度、签到与订阅', icon: 'star', render: renderCredits, actions: accountActions },
  settings: { title: '设置', sub: '账号、通知与本地设置', icon: 'tune', render: renderSettings, actions: accountActions },
  relations: { title: '关注与点赞', sub: '账号的社区关系', icon: 'person', hidden: true, render: renderRelations, actions: accountActions },
  dev: { title: '开发者', sub: 'API Key、MCP 与接口覆盖', icon: 'code', render: renderDev, actions: devActions },
  update: { title: '更新', sub: '检查新版本、镜像下载与安装', icon: 'speed', render: renderUpdate, actions: updateActions },
  about: { title: '关于', sub: '版本、作者与致谢', icon: 'info', render: renderAbout, actions: {} },
};

let pollTimer = null;
let booted = false;

/* Icon-only desktop controls need an accessible name; their data-tip already
   carries the wording, so mirror it into aria-label as nodes appear. */
function hydrateA11y(root = document) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.dataset.tip);
  });
}

const a11yObserver = new MutationObserver(() => hydrateA11y());

/* --- theme --------------------------------------------------------------- */

function applyTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = mode;
  UI.applyAccent(S.cfg?.accent || '');
  const btns = document.querySelectorAll('[data-act="toggle-theme"]');
  btns.forEach((b) => {
    b.innerHTML = icon(mode === 'dark' ? 'sun' : 'moon', 22);
    b.dataset.tip = mode === 'dark' ? '切换到浅色' : '切换到深色';
  });
}

function paintCredits() {
  const credits = document.getElementById('railCredits');
  if (credits) credits.textContent = S.user ? UI.fmtCredits(S.user.credits) : '—';
  const plan = document.getElementById('railPlan');
  if (plan) plan.textContent = (S.billing?.activePlan?.tier || 'free').toUpperCase();
  const avatarSlot = document.getElementById('railAvatar');
  if (avatarSlot && S.user) avatarSlot.innerHTML = UI.avatarHTML(S.user);
  const nameSlot = document.getElementById('railName');
  if (nameSlot && S.user) nameSlot.textContent = S.user.name || S.user.email;
  const planSlot = document.getElementById('railUserPlan');
  if (planSlot && S.user) planSlot.textContent = (S.billing?.activePlan?.tier || 'free') + ' 套餐';
}

/* --- model bootstrap ----------------------------------------------------- */

async function loadModels() {
  const [modelsRaw, durationsRaw] = await Promise.all([api('/local/models'), api('/local/models/durations')]);
  S.modelsRaw = modelsRaw;
  S.models = { image: modelsRaw.imageModels || [], video: modelsRaw.videoModels || [] };
  S.durations = durationsRaw.models || {};
  syncComposeToModel();
}

function syncComposeToModel() {
  const im = S.models.image || [];
  const vm = S.models.video || [];
  if (!im.find((m) => m.id === S.compose.imageModel)) S.compose.imageModel = im[0]?.id || '';
  if (!vm.find((m) => m.id === S.compose.videoModel)) S.compose.videoModel = vm[0]?.id || '';

  const img = modelInfo('image', S.compose.imageModel);
  if (img) {
    const tiers = img.resolutionOptions || [];
    if (!tiers.find((t) => t.id === S.compose.resolutionTier)) S.compose.resolutionTier = img.defaultResolutionTier || tiers[0]?.id || '';
    const steps = img.stepsOptions || [];
    if (!steps.map(String).includes(String(S.compose.steps))) S.compose.steps = String(img.defaultSteps || steps[0] || '');
  }
  const vid = modelInfo('video', S.compose.videoModel);
  if (vid && S.compose.mode === 'video') {
    const variants = (vid.variants || vid.variantOptions || []).map((v) => (typeof v === 'string' ? { id: v } : v));
    if (variants.length && !variants.find((v) => String(v.id) === String(S.compose.variant))) {
      S.compose.variant = String(variants[0].id);
    }
    const spec = variants.find((v) => String(v.id) === String(S.compose.variant)) || vid;
    const ratios = spec.aspectRatios || [];
    if (ratios.length && !ratios.includes(S.compose.ratio)) S.compose.ratio = ratios[0];
    const durs = spec.durationOptions || [];
    if (durs.length && !durs.includes(S.compose.duration)) S.compose.duration = durs[0] || '5s';
    if (!spec.fpsOptions?.includes(S.compose.fps)) S.compose.fps = spec.defaultFps || spec.fpsOptions?.[0] || 24;
    if (spec.size) S.compose.size = spec.size;
    const wfs = (vid.workflowFormats || []).map((w) => w.id);
    if (wfs.length && !wfs.includes(S.compose.workflowFormat)) S.compose.workflowFormat = wfs[0];
  }
  if (S.compose.mode === 'image') S.compose.size = '';
}

/* --- shell --------------------------------------------------------------- */

function shellTemplate() {
  return `<div class="shell">
    <aside class="rail">
      <nav class="rail-nav">
        ${Object.entries(ROUTES).filter(([, r]) => !r.hidden).map(([key, r]) => `<button class="rail-item" data-act="nav" data-route="${key}" data-tip="${r.title}">${icon(r.icon, 24)}<span class="label">${r.title}</span></button>`).join('')}
      </nav>
      <div class="rail-spacer"></div>
      <div class="rail-foot">
        <button class="credit-pill" data-act="nav" data-route="credits" data-tip="额度">
          ${icon('sparkle', 20)}<span id="railCredits">—</span><span class="num" id="railPlan">FREE</span>
        </button>
        <div class="rail-tools">
          <button class="icon-btn sm" data-act="toggle-theme" data-tip="切换主题">${icon('moon', 20)}</button>
          <button class="icon-btn sm" data-act="nav" data-route="dev" data-tip="开发者工具">${icon('code', 20)}</button>
          <button class="icon-btn sm" data-act="logout" data-tip="退出登录">${icon('logout', 20)}</button>
        </div>
        <button class="rail-user" data-act="nav" data-route="settings">
          <span id="railAvatar">${S.user ? UI.avatarHTML(S.user) : ''}</span>
          <div class="who"><div class="n" id="railName">${UI.esc(S.user?.name || '')}</div><div class="p" id="railUserPlan"></div></div>
        </button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-head">
          <div class="topbar-title" id="pageTitle"></div>
          <div class="topbar-sub" id="pageSub"></div>
        </div>
        <div class="topbar-actions">
          <span class="pill" id="activityChip" hidden></span>
          <div class="divider"></div>
          <button class="icon-btn" data-act="new-create" data-tip="新建创作">${icon('plus', 22)}</button>
          <button class="icon-btn" data-act="refresh" data-tip="刷新当前页面">${icon('refresh', 22)}</button>
        </div>
      </header>
      <div class="content" id="view"></div>
    </div>
  </div>`;
}

async function enterApp() {
  const boot = document.getElementById('boot');
  if (boot) boot.remove();
  const app = document.getElementById('app');
  app.hidden = false;
  app.innerHTML = shellTemplate();
  paintCredits();
  hydrateA11y(app);
  if (!booted) {
    booted = true;
    UI.initRipple();
    document.addEventListener('click', onGlobalClick);
    a11yObserver.observe(app, { childList: true, subtree: true });
  }
  await navigate(S.route || 'create');
  hydrateA11y(app);
  if (!['create', 'library'].includes(S.route)) refreshTasks(true);
}

async function navigate(route) {
  if (route === 'account') route = 'settings';
  if (!ROUTES[route]) route = 'create';
  S.route = route;
  UI.closeSheet();
  const def = ROUTES[route];
  document.querySelectorAll('.rail-item').forEach((el) => el.classList.toggle('active', el.dataset.route === (route === 'relations' ? 'settings' : route)));
  const title = document.getElementById('pageTitle');
  const sub = document.getElementById('pageSub');
  if (title) title.textContent = def.title;
  if (sub) sub.textContent = def.sub;
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = UI.skeletonPage(4);
  view.scrollTop = 0;
  try {
    await def.render(view);
  } catch (e) {
    view.innerHTML = `<div class="page narrow"><div class="banner error" style="margin-top:20px">${icon('alert', 20)}<div><b>页面加载失败</b><br>${UI.esc(e.message)}</div></div><div style="margin-top:14px"><button class="btn tonal" data-act="refresh">重新加载</button></div></div>`;
  }
}

async function refreshTasks(silent = true) {
  try {
    const [data, act] = await Promise.all([
      api('/local/generations/tasks?limit=24'),
      api('/local/generations/activity').catch(() => null),
    ]);
    S.tasks = data.tasks || [];
    if (act?.activity) S.activity = act.activity;
    paintActivity();
    ROUTES[S.route]?.updateTasks?.();
    ensurePolling();
  } catch (e) {
    if (!silent) UI.toast(e.message, 'error');
  }
}

function preloadImage(src, priority = 'low') {
  if (!src) return;
  const img = new Image();
  img.decoding = 'async';
  try { img.fetchPriority = priority; } catch {}
  img.src = src;
}

// Fill the read-through cache while the user is still on the create screen.
// The first community/settings/credits visit then comes from memory instead of
// waiting for several upstream round trips.
function warmCache() {
  const community = api('/local/community?mode=image');
  community.then((data) => {
    // Preload the same WebP cards the community page will request, so a later
    // navigation can paint them from the browser cache.
    for (const item of (data.items || []).slice(0, 12)) {
      preloadImage(UI.assetImageURL(item.assets?.[0]) || UI.mediaURL(item.previewThumbnailUrl), 'auto');
    }
  }).catch(() => {});
  const home = api('/local/homepage/community');
  home.then((data) => {
    for (const item of (data.artworks || []).slice(0, 8)) preloadImage(UI.mediaURL(item.src), 'low');
  }).catch(() => {});
  const paths = [
    '/local/profile/summary',
    '/local/gallery?section=summary',
    '/local/community/follows',
    '/local/notifications',
    '/local/accounts',
  ];
  const run = () => {
    for (const path of paths) api(path).catch(() => {});
  };
  if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 700);
}

function paintActivity() {  const el = document.getElementById('activityChip');
  if (!el) return;
  if (!S.activity) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const { activeCount, limit } = S.activity;
  el.className = 'pill' + (activeCount > 0 ? ' run' : '');
  el.innerHTML = `${icon('bolt', 13)}${activeCount}/${limit} 并发`;
  el.dataset.tip = `当前套餐并发上限 ${limit}`;
}

function ensurePolling() {
  const running = S.tasks.some((t) => t.status === 'generating');
  if (running && !pollTimer) {
    pollTimer = setInterval(() => {
      if (S.tasks.some((t) => t.status === 'generating')) refreshTasks(true);
      else ensurePolling();
    }, 3000);
  }
  if (!running && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshSession() {
  try {
    const sess = await api('/local/session');
    if (sess && sess.user) {
      setSession(sess.user, sess.billing);
      paintCredits();
    } else {
      clearLocalAndLogin();
    }
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

function clearLocalAndLogin() {
  resetSession();
  showLogin('login');
}

/* --- login --------------------------------------------------------------- */

function showLogin(tab = 'login') {
  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.remove();
  const app = document.getElementById('app');
  app.hidden = false;
  app.innerHTML = `<div class="login">
    <section class="login-art">
      <div class="orb a"></div><div class="orb b"></div>
      <div class="big">把想象，<em>变成作品</em>。</div>
      <div class="sub">imagifly.net 的桌面客户端。图片与视频生成、作品库、社区、额度与订阅，全部收在一个窗口里。</div>
      <div class="points">
        <div class="point"><span class="ic">${icon('sparkle', 19)}</span><span>7 个图像模型、3 类视频工作流，价格与并发位实时同步</span></div>
        <div class="point"><span class="ic">${icon('lock', 19)}</span><span>支持多账号登录；每个账号的会话 Cookie 使用 Windows DPAPI 加密保存在本机</span></div>
        <div class="point"><span class="ic">${icon('palette', 19)}</span><span>Material 3 Expressive：形变按钮、波浪进度与色调表面</span></div>
      </div>
    </section>
    <section class="login-side">
      <form class="login-card" id="loginForm" autocomplete="on">
        <div class="login-tabs">
          <button type="button" data-tab="login" class="${tab === 'login' ? 'selected' : ''}">登录</button>
          <button type="button" data-tab="register" class="${tab === 'register' ? 'selected' : ''}">注册</button>
        </div>
        <h2>${tab === 'login' ? '欢迎回来' : '创建账号'}</h2>
        <div class="hint">${tab === 'login' ? '使用你的 imagifly.net 邮箱登录' : '注册后可直接在桌面端使用每日免费额度'}</div>
        <div id="loginErr"></div>
        ${tab === 'register' ? `<div class="field"><label>昵称</label><div class="field-box">${icon('person', 18)}<input id="lgName" placeholder="至少 2 个字符" autocomplete="nickname"></div></div>` : ''}
        <div class="field"><label>邮箱</label><div class="field-box">${icon('send', 18)}<input id="lgEmail" type="email" placeholder="user@example.com" autocomplete="username" required></div></div>
        <div class="field"><label>密码</label><div class="field-box">${icon('lock', 18)}<input id="lgPass" type="password" placeholder="••••••••" autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" required></div></div>
        <button class="btn filled lg wide" id="lgSubmit" type="submit">${tab === 'login' ? '登录' : '注册'}</button>
        <div class="login-foot">本应用为第三方桌面客户端，与 imagifly 官方无隶属关系。登录即代表你同意该网站的服务条款；会话仅保存在本机。</div>
      </form>
    </section>
  </div>`;

  app.querySelectorAll('.login-tabs button').forEach((b) => {
    b.addEventListener('click', () => showLogin(b.dataset.tab));
  });

  const form = app.querySelector('#loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = app.querySelector('#lgEmail').value.trim();
    const password = app.querySelector('#lgPass').value;
    const name = tab === 'register' ? app.querySelector('#lgName').value.trim() : '';
    const errBox = app.querySelector('#loginErr');
    const submit = app.querySelector('#lgSubmit');
    errBox.innerHTML = '';
    if (!email || !password) {
      errBox.innerHTML = `<div class="field-error">请填写邮箱和密码</div>`;
      return;
    }
    submit.disabled = true;
    const old = submit.innerHTML;
    submit.innerHTML = `${UI.wavyRing(22, 2, 7, 4)}<span>处理中…</span>`;
    try {
      if (tab === 'register') {
        const res = await api('/local/auth/register', { method: 'POST', body: { name, email, password } });
        if (res.loggedIn) {
          await afterLogin();
        } else {
          UI.toast('注册成功，请登录', 'ok');
          showLogin('login');
        }
      } else {
        const sess = await api('/local/auth/login', { method: 'POST', body: { email, password } });
        if (!sess?.user) throw new Error('登录未返回用户信息');
        setSession(sess.user, sess.billing);
        await afterLogin();
      }
    } catch (err) {
      const info = { message: err.message, status: err.status };
      errBox.innerHTML = `<div class="banner error">${icon('alert', 20)}<div>${UI.esc(info.message)}${info.status ? `（HTTP ${info.status}）` : ''}</div></div>`;
      submit.disabled = false;
      submit.innerHTML = old;
    }
  });
}

async function afterLogin() {
  try {
    const sess = await api('/local/session');
    if (sess?.user) setSession(sess.user, sess.billing);
    await loadModels();
    UI.toast(`已登录：${S.user?.name || S.user?.email || ''}`, 'ok');
    await enterApp();
  } catch (e) {
    UI.toast(`初始化失败：${e.message}`, 'error');
    await enterApp();
  }
}

/* --- global actions ------------------------------------------------------ */

const sharedActions = {
  nav: (d) => {
    if (d.kind) S.account.relationKind = d.kind;
    navigate(d.route || 'create');
  },
  refresh: () => {
    clearApiCache();
    navigate(S.route);
  },
  'new-create': () => navigate('create'),
  'toggle-theme': async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { window.nativeTheme?.(next); } catch {}
    S.cfg = { ...(S.cfg || {}), theme: next };
    try {
      await api('/local/config', { method: 'PATCH', body: { theme: next } });
    } catch {}
  },
  logout: async () => {
    const ok = await UI.confirmSheet({
      title: '退出当前账号',
      text: '将退出当前账号。其他已保存账号会保留，可稍后切换；如果没有其他账号，下次需要重新登录。',
      confirm: '退出',
      danger: true,
    });
    if (!ok) return;
    let res = null;
    try {
      res = await api('/local/auth/logout', { method: 'POST', body: {} });
    } catch {}
    resetSession();
    if (res?.loggedIn) {
      UI.toast('已切换到下一个账号', 'ok');
      await afterLogin();
    } else {
      showLogin('login');
    }
  },
  'copy-prompt': async (d) => {
    const ok = await UI.copyText(d.prompt || '');
    UI.toast(ok ? '提示词已复制' : '复制失败', ok ? 'ok' : 'error');
  },
  'quick-download': (d) => UI.downloadAsset(d.url, d.name),
  'open-external': (d) => UI.openExternal(d.url),
  'close-sheet': () => UI.closeSheet(),
};

function buildActions() {
  return { ...sharedActions, ...taskActions, ...createActions, ...libraryActions, ...communityActions, ...accountActions, ...devActions, ...updateActions };
}

let actionMap = {};

async function onGlobalClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const name = el.dataset.act;
  const fn = actionMap[name];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    await fn(el.dataset, el, e);
  } catch (err) {
    UI.toast(UI.extractError(err).message || '操作失败', 'error');
  }
}

/* --- window chrome ------------------------------------------------------- */

function paintWindowVersion() {
  const el = document.getElementById('windowVersion');
  if (!el) return;
  const version = S.cfg?.version;
  el.textContent = version ? `v${version}` : '';
  el.hidden = !version;
}

function updateWinMaxButton(maximized) {
  const btn = document.querySelector('[data-win="max"]');
  if (!btn) return;
  btn.innerHTML = icon(maximized ? 'restore' : 'maximize', 14, 1.5);
  btn.dataset.tip = maximized ? '还原' : '最大化';
  btn.setAttribute('aria-label', maximized ? '还原' : '最大化');
}

async function syncWindowMax() {
  if (typeof window.winIsMaximized !== 'function') return;
  try {
    updateWinMaxButton(!!(await window.winIsMaximized()));
  } catch {}
}

function bindWindowBar() {
  const nativeFrame = !!window.chrome?.webview && typeof window.winMinimize === 'function';
  if (!nativeFrame) return;

  const controls = document.getElementById('windowControls');
  if (controls) controls.hidden = false;
  const resizeHandles = document.getElementById('resizeHandles');
  if (resizeHandles) resizeHandles.hidden = false;

  const drag = document.getElementById('titlebarDrag');
  if (drag && typeof window.winStartDrag === 'function') {
    drag.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, a')) return;
      window.winStartDrag();
    });
  }

  if (typeof window.winStartResize === 'function') {
    resizeHandles?.querySelectorAll('[data-resize]').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        window.winStartResize(handle.dataset.resize);
      });
    });
  }

  controls?.querySelector('[data-win="min"]')?.addEventListener('click', () => window.winMinimize?.());
  controls?.querySelector('[data-win="max"]')?.addEventListener('click', async () => {
    if (typeof window.winToggleMaximize !== 'function') return;
    try {
      const maximized = await window.winToggleMaximize();
      if (typeof maximized === 'boolean') updateWinMaxButton(maximized);
    } catch {}
  });
  controls?.querySelector('[data-win="close"]')?.addEventListener('click', () => window.winClose?.());

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncWindowMax, 90);
  }, { passive: true });
  syncWindowMax();
}

/* --- init ---------------------------------------------------------------- */

async function boot() {
  const status = document.getElementById('bootStatus');
  const initialRoute = new URLSearchParams(location.search).get('route');
  if (initialRoute && ROUTES[initialRoute]) S.route = initialRoute;
  try {
    const modelsPromise = loadModels().catch(() => {});
    const [cfg, sess] = await Promise.all([api('/local/config'), api('/local/session')]);
    S.cfg = cfg;
    applyTheme(cfg.theme || 'dark');
    paintWindowVersion();
    if (sess && sess.user) {
      setSession(sess.user, sess.billing);
      await modelsPromise;
      await enterApp();
      warmCache();
    } else {
      showLogin('login');
    }
    actionMap = buildActions();
  } catch (e) {
    if (status) status.textContent = `无法连接本地服务：${e.message}`;
    const bootEl = document.getElementById('boot');
    if (bootEl) {
      const btn = document.createElement('button');
      btn.className = 'btn tonal';
      btn.textContent = '重试';
      btn.style.marginTop = '12px';
      btn.addEventListener('click', () => location.reload());
      bootEl.appendChild(btn);
    }
  }
}

R.navigate = navigate;
R.rerender = () => {
  clearApiCache();
  navigate(S.route);
};
R.refreshSession = refreshSession;
R.refreshTasks = refreshTasks;
R.paintCredits = paintCredits;

// Boot splash wave
const bootWavy = document.getElementById('bootWavy');
if (bootWavy) bootWavy.innerHTML = UI.wavyRing(56, 2.8, 8, 6);

bindWindowBar();
boot();
