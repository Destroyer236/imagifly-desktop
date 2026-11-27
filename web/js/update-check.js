import { api } from './api.js';
import { S } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { R } from './runtime.js';

/* 启动后静默检查一次 Release，有新版本就弹窗；同一个版本只提示一次，
   之后可以在「更新」页手动检查。 */

const SEEN_KEY = 'imagifly.update.seen';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let started = false;

export function startUpdateWatcher() {
  if (started) return;
  started = true;
  setTimeout(() => {
    checkForUpdate();
  }, 2600);
  setInterval(() => {
    checkForUpdate();
  }, CHECK_INTERVAL);
}

export async function checkForUpdate() {
  if (S.route === 'update') return;
  let info = null;
  try {
    info = await api('/local/update/info', { noCache: true });
  } catch {
    return;
  }
  if (!info?.hasUpdate) return;
  const latest = String(info.latest || '').replace(/^v/i, '').trim();
  if (!latest) return;
  if (localStorage.getItem(SEEN_KEY) === latest) return;
  // 记下已提示的版本：即使这次被关掉，也不会在轮询里反复弹。
  try { localStorage.setItem(SEEN_KEY, latest); } catch {}
  showUpdateSheet(info, latest);
}

function notesHTML(notes) {
  const lines = String(notes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s*$/.test(line) && !/^---+$/.test(line))
    .slice(0, 5)
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '· ').replace(/\*\*|`/g, ''));
  if (!lines.length) return '';
  return `<div class="upd-pop-notes">${lines.map((line) => `<div>${UI.esc(line)}</div>`).join('')}</div>`;
}

function showUpdateSheet(info, latest) {
  const current = String(info.current || S.cfg?.version || '').replace(/^v/i, '') || '当前版本';
  const published = info.publishedAt ? UI.fmtDate(info.publishedAt) : '';
  const sheet = UI.openSheet({
    title: `发现新版本 v${latest}`,
    subtitle: 'Imagifly Desktop 自更新',
    size: 'narrow',
    body: `<div class="upd-pop">
      <div class="upd-pop-ver"><span>v${UI.esc(current)}</span>${icon('chevronRight', 18)}<b>v${UI.esc(latest)}</b></div>
      <p class="upd-pop-sub">${published ? `发布于 ${UI.esc(published)}。` : ''}更新页内置了加速镜像，安装完成后会自动删除旧安装包。</p>
      ${notesHTML(info.notes)}
      <div class="upd-pop-acts-note">${icon('info', 15)}<span>现在可以继续创作，稍后再更新。</span></div>
    </div>`,
    actions: `<button class="btn text" id="upd-later">稍后</button><button class="btn filled" id="upd-go">${icon('bolt', 16)}去更新</button>`,
  });
  sheet.root.querySelector('#upd-later').onclick = () => sheet.close();
  sheet.root.querySelector('#upd-go').onclick = () => {
    sheet.close();
    R.navigate('update');
  };
}
