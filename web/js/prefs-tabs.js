import { icon } from './icons.js';

/* 设置 / 更新 / 关于共用的一组二级标签。三个页面各自把它放在 .page 顶部，
   这样更新页局部重绘（进度、测速）时标签不会消失。 */
export function prefsTabsHTML(active) {
  const items = [
    ['settings', '设置', 'tune'],
    ['update', '更新', 'speed'],
    ['about', '关于', 'info'],
  ];
  return `<div class="tabs prefs-tabs" role="tablist" aria-label="设置分类">
    ${items.map(([route, label, ic]) => `<button class="tab ${route === active ? 'selected' : ''}" role="tab" aria-selected="${route === active}" data-act="nav" data-route="${route}">${icon(ic, 16)}<span>${label}</span></button>`).join('')}
  </div>`;
}
