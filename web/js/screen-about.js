import { S } from './store.js';
import { icon } from './icons.js';
import * as UI from './ui.js';
import { prefsTabsHTML } from './prefs-tabs.js';

function versionLabel() {
  const raw = String(S.cfg?.version || '').trim();
  if (!raw) return '开发版';
  return /^v/i.test(raw) ? raw : `v${raw}`;
}

export async function renderAbout(view) {
  const version = versionLabel();
  view.innerHTML = `<div class="page about-page">
    ${prefsTabsHTML('about')}
    <section class="about-hero">
      <div class="about-hero-top">
        <div class="about-icon"><img src="/assets/app-icon.png" alt="Imagifly 图标"></div>
        <div class="about-headline">
          <div class="about-eyebrow">imagifly.net · Windows Desktop</div>
          <h1>Imagifly</h1>
          <p>AI Image &amp; Video Studio</p>
        </div>
        <span class="pill about-version" aria-label="当前版本 ${UI.esc(version)}">版本号 ${UI.esc(version)}</span>
      </div>
      <p class="about-lede">把想象，变成作品。图片与视频生成、作品库、社区、额度与订阅，全部收在一个窗口里。</p>
      <div class="about-actions">
        <button class="btn tonal sm" data-act="nav" data-route="create">${icon('sparkle', 18)}开始创作</button>
        <button class="btn text sm" data-act="nav" data-route="settings">${icon('tune', 18)}打开设置</button>
      </div>
    </section>

    <section class="sect about-section">
      ${UI.sectionHead('主要作者', '这个桌面客户端的作者')}
      <article class="about-person">
        <div class="about-avatar zephyr"><img src="/assets/about-zephyr.jpg" alt="Zephyr 的头像" loading="lazy"></div>
        <div class="about-person-body">
          <div class="about-role">主要作者</div>
          <div class="about-name">Zephyr</div>
          <div class="about-note">Imagifly Desktop 的作者</div>
        </div>
        <span class="about-badge">${icon('sparkle', 14)}作者</span>
      </article>
    </section>

    <section class="sect about-section">
      ${UI.sectionHead('特别鸣谢', '感谢为本项目提供帮助的人')}
      <div class="about-thanks-grid">
        <article class="about-person compact">
          <div class="about-avatar"><img src="/assets/about-amoorzheyu.jpg" alt="amoorzheyu 的头像" loading="lazy"></div>
          <div class="about-person-body">
            <div class="about-role">特别鸣谢</div>
            <div class="about-name">amoorzheyu</div>
            <div class="about-note">感谢对本项目的帮助与支持</div>
          </div>
        </article>
        <article class="about-person compact">
          <div class="about-team-avatar">${icon('code', 28)}</div>
          <div class="about-person-body">
            <div class="about-role">特别鸣谢</div>
            <div class="about-name">Imagifly 的开发者们</div>
            <div class="about-note">感谢 Imagifly 团队与所有开发者</div>
          </div>
        </article>
      </div>
    </section>
  </div>`;
}
