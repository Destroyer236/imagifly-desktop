import { api } from './api.js';
import { S } from './store.js';
import { icon } from './icons.js';
import * as UI from './ui.js';
import { prefsTabsHTML } from './prefs-tabs.js';

/* 更新页：检查 GitHub Release、从内置镜像下载安装包、安装并在安装完成后清理旧包。
   下载与安装都由本地服务完成，页面只负责展示进度。 */

const state = {
  info: null,
  error: '',
  tests: null, // [{ id, ok, ms, error }]
  testing: false,
  progress: null,
  dir: '',
  oneClick: false,
  autoInstall: false,
};

let view = null;
let poller = null;
let lastState = '';
let lastToastState = '';

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
  if (!n) return '';
  return `${fmtBytes(n)}/s`;
}

function versionText(raw) {
  const v = String(raw || '').trim();
  if (!v) return '未知';
  return /^v/i.test(v) ? v : `v${v}`;
}

function mirrorName(id) {
  return (state.info?.mirrors || []).find((m) => m.id === id)?.name || id || '';
}

function assetOf(kind) {
  return (state.info?.assets || []).find((a) => a.kind === kind) || null;
}

function testOf(id) {
  return (state.tests || []).find((t) => t.id === id) || null;
}

function fastestMirror() {
  const ok = (state.tests || []).filter((t) => t.ok);
  if (!ok.length) return null;
  return ok.reduce((best, t) => (t.ms < best.ms ? t : best)).id;
}

/* --- fragments ----------------------------------------------------------- */

function primaryButtonHTML() {
  const downloading = state.progress?.state === 'downloading';
  const done = state.progress?.state === 'done' && state.progress?.kind === 'setup';
  const busy = state.oneClick || downloading;
  const label = busy ? '更新中…' : (done ? '安装并重启' : '一键更新');
  return `<button class="btn filled sm" data-act="upd-oneclick"${busy ? ' disabled' : ''}>${icon('bolt', 16)}${label}</button>`;
}

function heroHTML() {
  const info = state.info;
  const current = versionText(info?.current || S.cfg?.version);
  const status = (() => {
    if (state.error) return `<span class="pill err">${icon('alert', 14)}检查失败</span>`;
    if (!info) return `<span class="pill">正在检查…</span>`;
    if (info.hasUpdate) return `<span class="pill run">${icon('bolt', 14)}发现新版本 ${UI.esc(versionText(info.latest))}</span>`;
    return `<span class="pill ok">${icon('check', 14)}已是最新</span>`;
  })();

  const title = info?.hasUpdate
    ? `${UI.esc(current)} <span class="upd-arrow">→</span> ${UI.esc(versionText(info.latest))}`
    : UI.esc(current);

  const sub = info?.hasUpdate
    ? `发布于 ${UI.esc(UI.fmtDate(info.publishedAt))} · 一键更新会自动测速、下载并静默安装`
    : info
      ? `当前已是最新版本 · 上次检查 ${UI.esc(UI.fmtDate(new Date(info.checkedAt).toISOString(), true))}`
      : '正在向 GitHub 查询最新版本…';

  return `<section class="card hero upd-hero">
    <div class="upd-hero-top">
      <div class="upd-hero-main">
        <div class="upd-eyebrow">Imagifly Desktop · 自更新</div>
        <h1 class="upd-title">${title}</h1>
        <p class="upd-sub">${sub}</p>
        <div class="upd-hero-pills">${status}
          ${info?.hasUpdate && assetOf('setup') ? `<span class="pill">安装版 ${fmtBytes(assetOf('setup').size)}</span>` : ''}
          ${info?.hasUpdate && assetOf('portable') ? `<span class="pill">免安装 ${fmtBytes(assetOf('portable').size)}</span>` : ''}
        </div>
      </div>
      <div class="upd-hero-acts">
        ${primaryButtonHTML()}
        <button class="btn text sm" data-act="upd-release">${icon('external', 16)}打开发布页</button>
        <button class="btn text sm" data-act="upd-folder">${icon('folder', 16)}打开下载目录</button>
      </div>
    </div>
    ${state.error ? `<div class="banner error" style="margin-top:14px">${icon('alert', 18)}<div>${UI.esc(state.error)}</div></div>` : ''}
  </section>`;
}

function progressHTML() {
  const p = state.progress;
  if (!p || p.state === 'idle') return '';
  if (p.state === 'downloading') {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
    return `<section class="sect upd-panel">
      ${UI.sectionHead('正在下载', `${mirrorName(p.mirror)} · ${UI.esc(p.asset || '')}`)}
      <div class="card pad-sm upd-progress-card">
        <div class="upd-bar"><i style="width:${pct}%"></i></div>
        <div class="upd-progress-meta">
          <span data-role="dl-stat">${fmtBytes(p.received)}${p.total > 0 ? ' / ' + fmtBytes(p.total) : ''}${p.total > 0 ? `（${pct}%）` : ''}</span>
          <span class="muted" data-role="dl-speed">${fmtSpeed(p.speed)}</span>
          <button class="btn text sm" data-act="upd-cancel" style="margin-left:auto">取消</button>
        </div>
      </div>
    </section>`;
  }
  if (p.state === 'done') {
    const isSetup = p.kind === 'setup';
    return `<section class="sect upd-panel">
      ${UI.sectionHead('安装包已就绪', `${mirrorName(p.mirror)} · ${UI.esc(p.asset || '')} · ${fmtBytes(p.received)}`)}
      <div class="card pad-sm upd-progress-card">
        <div class="upd-progress-meta">
          <span>${icon('check', 16)}${isSetup ? '已下载到本地，安装完成后会自动删除这个安装包。' : '已下载到本地，解压后覆盖旧目录即可使用。'}</span>
          <div class="upd-progress-acts">
            ${isSetup
              ? `<button class="btn filled sm" data-act="upd-install">${icon('bolt', 16)}安装并重启</button>`
              : `<button class="btn tonal sm" data-act="upd-folder">${icon('folder', 16)}解压免安装版</button>`}
            <button class="btn text sm" data-act="upd-dl" data-kind="${UI.esc(p.kind)}" data-mid="${UI.esc(p.mirror)}">重新下载</button>
          </div>
        </div>
        ${isSetup ? `<p class="field-help" style="margin-top:8px">点击后会以静默方式安装（保留账号与设置），客户端会自动退出并重新打开新版本。</p>` : ''}
      </div>
    </section>`;
  }
  if (p.state === 'error') {
    return `<section class="sect upd-panel">
      ${UI.sectionHead('下载失败', mirrorName(p.mirror))}
      <div class="card pad-sm upd-progress-card">
        <div class="banner error">${icon('alert', 18)}<div>${UI.esc(p.error || '下载失败')}</div></div>
        <div class="upd-progress-meta" style="margin-top:10px">
          <button class="btn tonal sm" data-act="upd-dl" data-kind="${UI.esc(p.kind || 'setup')}" data-mid="${UI.esc(p.mirror || 'gh-proxy')}">换个镜像重试</button>
          <button class="btn text sm" data-act="upd-test">${icon('refresh', 16)}测速后重选</button>
        </div>
      </div>
    </section>`;
  }
  return '';
}

function mirrorRowHTML(m) {
  const t = testOf(m.id);
  const fast = fastestMirror();
  const pill = state.testing && !t
    ? `<span class="pill">测速中…</span>`
    : t
      ? t.ok
        ? `<span class="pill ${m.id === fast ? 'ok' : ''}">${t.ms} ms${m.id === fast ? ' · 最快' : ''}</span>`
        : `<span class="pill err">${UI.esc(t.error || '不可用')}</span>`
      : `<span class="pill">未测速</span>`;
  const enabled = !!state.info?.hasUpdate;
  const downloading = state.progress?.state === 'downloading';
  const dis = enabled && !downloading ? '' : ' disabled';
  return `<article class="card pad-sm upd-mirror${m.id === fast ? ' fast' : ''}">
    <div class="upd-mirror-text">
      <div class="upd-mirror-name">${UI.esc(m.name)}</div>
      <div class="upd-mirror-hint">${UI.esc(m.hint || '')}</div>
    </div>
    ${pill}
    <div class="upd-mirror-acts">
      <button class="btn tonal sm" data-act="upd-dl" data-kind="setup" data-mid="${UI.esc(m.id)}"${dis}>${icon('download', 15)}安装版</button>
      <button class="btn text sm" data-act="upd-dl" data-kind="portable" data-mid="${UI.esc(m.id)}"${dis}>免安装</button>
    </div>
  </article>`;
}

function mirrorsHTML() {
  const list = state.info?.mirrors || [];
  if (!list.length) {
    return `<div class="card pad-sm"><p class="field-help">没有拿到可用的镜像配置，请先检查更新。</p></div>`;
  }
  const hint = state.info?.hasUpdate
    ? '「一键更新」会自动选最快镜像；也可以在这里手动下载。'
    : '当前已是最新版本，有更新后这里会变成可下载。';
  return `${UI.sectionHead('下载镜像', hint, `<button class="btn tonal sm" data-act="upd-test"${state.testing ? ' disabled' : ''}>${icon('speed', 16)}${state.testing ? '测速中…' : '一键测速'}</button>`)}
    <div class="upd-mirrors">${list.map(mirrorRowHTML).join('')}</div>`;
}

function notesHTML() {
  const notes = state.info?.notes || '';
  if (!state.info?.hasUpdate) return '';
  return `<section class="sect upd-panel">
    ${UI.sectionHead('更新说明', `${versionText(state.info.latest)} · ${UI.esc(UI.fmtDate(state.info.publishedAt))}`, `<button class="btn text sm" data-act="upd-release">${icon('external', 16)}在浏览器打开</button>`)}
    <div class="card pad-sm"><pre class="upd-notes">${UI.esc(notes || '这个版本没有填写更新说明。')}</pre></div>
  </section>`;
}

function tipsHTML() {
  return `<section class="sect upd-panel">
    ${UI.sectionHead('说明', '更新流程与本地文件')}
    <div class="card pad-sm upd-tips">
      <ul>
        <li>「一键更新」会自动测速、选最快镜像，下载完成后直接静默安装。</li>
        <li>下载走本机直连镜像，安装包保存在 <span class="mono">${UI.esc(state.dir || '%AppData%\\ImagiflyDesktop\\updates')}</span>。</li>
        <li>安装版为静默安装：保留账号、设置与作品记录，安装完成后客户端会自动重启。</li>
        <li>安装包用完后会自动删除；启动时也会清理遗留的旧安装包。</li>
        <li>免安装版是 zip，需要解压后覆盖原目录使用；安装版是 exe，可直接安装。</li>
        <li>个别镜像有缓存或限速，测速结果只代表当下这一次请求。</li>
      </ul>
    </div>
  </section>`;
}

/* --- painting ------------------------------------------------------------ */

function paint() {
  if (!view) return;
  view.innerHTML = `<div class="page pref-page upd-page">
    ${prefsTabsHTML('update')}
    ${heroHTML()}
    <div class="upd-progress-host">${progressHTML()}</div>
    <section class="sect upd-panel" data-role="mirrors">${mirrorsHTML()}</section>
    ${notesHTML()}
    ${tipsHTML()}
  </div>`;
  const host = view.querySelector('.upd-progress-host');
  if (host) host.dataset.state = state.progress?.state || 'idle';
}

function paintMirrors() {
  const box = view?.querySelector('[data-role="mirrors"]');
  if (box) box.innerHTML = mirrorsHTML();
}

function paintProgress() {
  if (!view) return;
  const host = view.querySelector('.upd-progress-host');
  if (!host) return;
  const p = state.progress;
  const sameDownloading = p?.state === 'downloading'
    && host.dataset.state === 'downloading'
    && host.querySelector('.upd-progress-card .upd-bar');
  if (sameDownloading) {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
    const bar = host.querySelector('.upd-bar > i');
    if (bar) bar.style.width = `${pct}%`;
    const stat = host.querySelector('[data-role="dl-stat"]');
    if (stat) stat.textContent = `${fmtBytes(p.received)}${p.total > 0 ? ' / ' + fmtBytes(p.total) : ''}${p.total > 0 ? `（${pct}%）` : ''}`;
    const speed = host.querySelector('[data-role="dl-speed"]');
    if (speed) speed.textContent = fmtSpeed(p.speed);
    return;
  }
  host.innerHTML = progressHTML();
  host.dataset.state = p?.state || 'idle';
}

/* --- data ---------------------------------------------------------------- */

async function loadInfo(force = false) {
  state.error = '';
  try {
    state.info = await api(`/local/update/info${force ? '?force=1' : ''}`, { noCache: true });
  } catch (e) {
    state.error = e.message || '检查更新失败';
  }
}

async function loadStatus() {
  try {
    const st = await api('/local/update/status', { noCache: true });
    state.progress = st.progress || null;
    state.dir = st.dir || state.dir;
  } catch {}
}

async function runMirrorTest() {
  if (state.testing) return;
  state.testing = true;
  paintMirrors();
  try {
    const res = await api('/local/update/mirrors/test', { method: 'POST', body: {} });
    state.tests = res.mirrors || [];
  } catch (e) {
    state.tests = state.info?.mirrors?.map((m) => ({ id: m.id, ok: false, ms: 0, error: e.message })) || [];
  } finally {
    state.testing = false;
    paintMirrors();
  }
}

function startPolling() {
  stopPolling();
  poller = setInterval(async () => {
    await loadStatus();
    const p = state.progress;
    if (!p || p.state !== 'downloading') {
      stopPolling();
      paint();
      if (p?.state === 'done' && lastToastState !== 'done') {
        lastToastState = 'done';
        if (!state.autoInstall) UI.toast('安装包下载完成，可以安装了', 'ok');
      }
      if (p?.state === 'error' && lastToastState !== 'error') {
        lastToastState = 'error';
        state.autoInstall = false;
        UI.toast(`下载失败：${p.error || '未知原因'}`, 'error');
      }
      if (p?.state === 'done' && state.autoInstall && p.kind === 'setup') {
        state.autoInstall = false;
        UI.toast('下载完成，正在静默安装…', 'ok');
        updateActions['upd-install']();
      }
    }
    paintProgress();
  }, 600);
}

function stopPolling() {
  if (poller) clearInterval(poller);
  poller = null;
}

/* --- entry --------------------------------------------------------------- */

export async function renderUpdate(el) {
  view = el;
  stopPolling();
  state.oneClick = false;
  state.autoInstall = false;
  lastToastState = '';
  el.innerHTML = `<div class="page pref-page upd-page">${prefsTabsHTML('update')}${UI.skeletonPage(3)}</div>`;
  await Promise.all([loadInfo(), loadStatus()]);
  state.tests = state.tests || null;
  paint();
  if (state.progress?.state === 'downloading') startPolling();
  if (state.info?.hasUpdate && !state.tests) runMirrorTest();
}

/* --- actions ------------------------------------------------------------- */

function busyToast(text) {
  UI.toast(text, 'info');
}

export const updateActions = {
  'upd-oneclick': async () => {
    if (state.oneClick || state.progress?.state === 'downloading') {
      UI.toast('正在更新，请稍候…', 'info');
      return;
    }
    if (state.progress?.state === 'done' && state.progress?.kind === 'setup') {
      return updateActions['upd-install']();
    }
    state.oneClick = true;
    paint();
    try {
      if (!state.info?.hasUpdate) await loadInfo(true);
      if (state.error) throw new Error(state.error);
      if (!state.info?.hasUpdate) {
        state.oneClick = false;
        paint();
        UI.toast('已经是最新版本', 'ok');
        return;
      }
      paint();
      UI.toast(`发现新版本 ${versionText(state.info.latest)}，正在选择最快镜像…`, 'ok');
      if (!assetOf('setup')) throw new Error('该版本没有安装版安装包，请在下方手动下载免安装版');
      state.autoInstall = true;
      if (!state.tests || !state.tests.some((t) => t.ok)) await runMirrorTest();
      const mid = fastestMirror()
        || state.info?.mirrors?.find((m) => m.id === 'gh-proxy')?.id
        || state.info?.mirrors?.[0]?.id;
      if (!mid) throw new Error('没有可用的下载镜像');
      UI.toast(`使用 ${mirrorName(mid)} 下载安装包…`, 'info');
      const res = await api('/local/update/download', { method: 'POST', body: { mirror: mid, kind: 'setup' } });
      state.progress = res.progress || null;
      lastToastState = '';
      state.oneClick = false;
      paint();
      startPolling();
    } catch (e) {
      state.oneClick = false;
      state.autoInstall = false;
      paint();
      UI.toast(e.message || '一键更新失败', 'error');
    }
  },
  'upd-check': async () => {
    paint();
    await loadInfo(true);
    paint();
    if (state.error) UI.toast(state.error, 'error');
    else if (state.info?.hasUpdate) {
      UI.toast(`发现新版本 ${versionText(state.info.latest)}`, 'ok');
      runMirrorTest();
    } else UI.toast('已经是最新版本', 'ok');
  },
  'upd-test': async () => {
    await runMirrorTest();
  },
  'upd-dl': async (d) => {
    const kind = d.kind === 'portable' ? 'portable' : 'setup';
    const mid = d.mid || 'gh-proxy';
    state.oneClick = false;
    state.autoInstall = false;
    try {
      busyToast(`开始下载 ${mirrorName(mid)} 的${kind === 'setup' ? '安装版' : '免安装版'}…`);
      const res = await api('/local/update/download', { method: 'POST', body: { mirror: mid, kind } });
      state.progress = res.progress || null;
      lastToastState = '';
      paintProgress();
      startPolling();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'upd-cancel': async () => {
    state.autoInstall = false;
    state.oneClick = false;
    try {
      const res = await api('/local/update/cancel', { method: 'POST', body: {} });
      state.progress = res.progress || null;
      stopPolling();
      paintProgress();
      UI.toast('已取消下载', 'info');
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'upd-install': async () => {
    try {
      await api('/local/update/install', { method: 'POST', body: {} });
      UI.toast('安装程序已启动，客户端即将退出并重启为新版本', 'ok');
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'upd-folder': async () => {
    try {
      await api('/local/update/open-folder', { method: 'POST', body: {} });
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'upd-release': async () => {
    const url = state.info?.pageURL || 'https://github.com/Destroyer236/imagifly-desktop/releases';
    try {
      await UI.openExternal(url);
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
};
