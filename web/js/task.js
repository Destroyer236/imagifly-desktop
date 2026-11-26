import { api } from './api.js';
import { S, modelLabel } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { R } from './runtime.js';

export async function openTaskSheet(id) {
  let timer = null;
  let status = '';
  const sheet = UI.openSheet({
    title: '作品详情',
    subtitle: id,
    size: 'wide',
    body: `<div class="loading-page"><div class="skel" style="height:220px"></div><div class="skel" style="height:80px"></div></div>`,
    onClose: () => timer && clearInterval(timer),
  });

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const load = async () => {
    try {
      const data = await api('/local/generations/' + encodeURIComponent(id));
      const item = data.generation;
      status = item.status;
      paint(sheet, item);
      if (status !== 'generating') stop();
    } catch (e) {
      sheet.body.innerHTML = `<div class="banner error">${icon('alert', 20)}<div>${UI.esc(e.message)}</div></div>`;
      stop();
    }
  };

  const beginPolling = () => {
    if (!timer && status === 'generating') {
      timer = setInterval(load, 3000);
    }
  };

  const paint = (sheetRef, item) => {
    sheetRef.dialog.querySelector('.dialog-head .t').textContent = item.mode === 'video' ? '视频作品' : '图片作品';
    sheetRef.dialog.querySelector('.dialog-head .s').textContent = `${item.model || ''} · ${item.id}`;
    const media = mediaBlock(item);
    const tags = (item.tags || []).map((t) => `<span class="chip static">${UI.esc(t.name || t.id)}</span>`).join('');
    const rejected = item.moderationStatus === 'rejected';
    const canPublish = Boolean(item.communityGenerationId);
    const body = `
      <div class="detail">
        ${media}
        <div class="detail-info">
          <div class="chips">
            ${UI.statusPill(item)}
            <span class="chip static">${icon(item.mode === 'video' ? 'movie' : 'image', 14)}${item.mode === 'video' ? '视频' : '图片'}</span>
            ${canPublish ? `<span class="pill ${item.communityVisibility === 'private' ? '' : 'ok'}">${item.communityVisibility === 'private' ? '仅自己可见' : '社区公开'}</span>` : ''}
            ${rejected ? `<span class="pill warn">审核原因：${UI.esc(item.moderationReason || '未知')}</span>` : ''}
          </div>
          <p class="detail-prompt">${UI.esc(item.prompt || '（无提示词）')}</p>
          ${item.negativePrompt ? `<div class="detail-neg"><span>反向提示词</span>${UI.esc(item.negativePrompt)}</div>` : ''}
          ${item.status === 'failed' && item.error ? `<div class="banner error">${icon('alert', 20)}<div>${UI.esc(item.error)}</div></div>` : ''}
          ${item.status === 'generating' ? `<div class="gen-row">${UI.wavyRing(44, 2.6, 8)}<div><div class="t">正在生成</div><div class="s">${UI.esc(UI.elapsedText(item))}</div></div></div>` : ''}
          <div class="kv-grid">
            <div><div class="k">模型</div><div class="v">${UI.esc(modelLabel(item.model))}</div></div>
            <div><div class="k">尺寸</div><div class="v">${UI.esc(item.size || '—')}</div></div>
            <div><div class="k">张数</div><div class="v">${UI.esc(item.imageCount || 1)}</div></div>
            <div><div class="k">消耗</div><div class="v">${UI.fmtNum(item.cost || 0)} 额度</div></div>
            <div><div class="k">耗时</div><div class="v">${item.durationMs ? UI.msHuman(item.durationMs) : UI.esc(UI.elapsedText(item))}</div></div>
            <div><div class="k">创建</div><div class="v">${UI.fmtDate(item.createdAt, true)}</div></div>
            <div><div class="k">完成</div><div class="v">${UI.fmtDate(item.completedAt, true)}</div></div>
            <div><div class="k">幂等提交</div><div class="v mono">${UI.esc((item.submissionId || '').slice(0, 8))}…</div></div>
          </div>
          ${tags ? `<div class="chips" style="margin-top:12px">${tags}</div>` : ''}
        </div>
      </div>`;
    sheetRef.body.innerHTML = body;

    const foot = sheetRef.dialog.querySelector('.dialog-actions') || document.createElement('div');
    foot.className = 'dialog-actions';
    foot.innerHTML = `
      ${item.status === 'success' ? `<button class="btn tonal" id="t-dl">${icon('download', 18)}保存到本地</button>` : ''}
      <button class="btn text" id="t-copy">${icon('copy', 18)}复制提示词</button>
      ${canPublish ? `<button class="btn outlined" id="t-vis">${icon(item.communityVisibility === 'private' ? 'globe' : 'lock', 18)}${item.communityVisibility === 'private' ? '公开到社区' : '设为私密'}</button>` : ''}
      <button class="btn text" id="t-reuse">${icon('sparkle', 18)}复用参数</button>
      <button class="btn text" id="t-refresh">${icon('refresh', 18)}刷新</button>
      <button class="btn danger" id="t-del">${icon('trash', 18)}删除</button>`;
    if (!foot.parentElement) sheetRef.dialog.appendChild(foot);

    foot.querySelector('#t-refresh')?.addEventListener('click', () => load());
    foot.querySelector('#t-copy')?.addEventListener('click', async () => {
      const ok = await UI.copyText(item.prompt || '');
      UI.toast(ok ? '提示词已复制' : '复制失败', ok ? 'ok' : 'error');
    });
    foot.querySelector('#t-dl')?.addEventListener('click', () => {
      UI.downloadAsset(UI.assetURL(item), `imagifly-${item.model || 'gen'}-${String(item.id).slice(-6)}`);
    });
    foot.querySelector('#t-reuse')?.addEventListener('click', () => {
      S.compose.prompt = item.prompt || '';
      if (item.mode === 'video') {
        S.compose.mode = 'video';
        if (S.models.video.some((m) => m.id === item.model)) S.compose.videoModel = item.model;
        if (item.size && item.size.includes('x')) S.compose.size = item.size;
      } else {
        S.compose.mode = 'image';
        if (S.models.image.some((m) => m.id === item.model)) S.compose.imageModel = item.model;
        S.compose.size = item.size && item.size.includes('x') ? item.size : '';
      }
      sheetRef.close();
      R.navigate('create');
    });
    foot.querySelector('#t-vis')?.addEventListener('click', async () => {
      const next = item.communityVisibility === 'private' ? 'public' : 'private';
      try {
        await api('/local/community/' + encodeURIComponent(item.communityGenerationId), {
          method: 'PATCH',
          body: { generationIds: [item.id], visibility: next },
        });
        UI.toast(next === 'public' ? '已提交公开' : '已设为私密', 'ok');
        await load();
        R.rerender();
      } catch (e) {
        UI.toast(e.message, 'error');
      }
    });
    foot.querySelector('#t-del')?.addEventListener('click', async () => {
      const ok = await UI.confirmSheet({ title: '删除作品', text: '删除后无法恢复，确定继续？', confirm: '删除', danger: true });
      if (!ok) return;
      try {
        await api('/local/generations/' + encodeURIComponent(item.id), { method: 'DELETE' });
        UI.toast('已删除', 'ok');
        sheetRef.close();
        R.refreshTasks(true);
        R.rerender();
      } catch (e) {
        UI.toast(e.message, 'error');
      }
    });
  };

  const mediaBlock = (item) => {
    const asset = item.assets?.[0];
    const videoSrc = UI.proxyMediaURL(UI.assetURL(item));
    if (item.mode === 'video') {
      if (!videoSrc) {
        return `<div class="detail-media ph">${icon('movie', 44)}<span>${item.status === 'generating' ? '正在渲染' : '暂无文件'}</span></div>`;
      }
      return `<div class="detail-media"><video src="${videoSrc}" controls autoplay muted loop playsinline poster="${UI.mediaURL(asset?.thumbnailUrl || item.previewThumbnailUrl)}"></video></div>`;
    }
    const image = UI.detailImageHTML(asset, item.previewThumbnailUrl, item.prompt || '');
    if (!image) {
      return `<div class="detail-media ph">${icon('image', 44)}<span>${item.status === 'generating' ? '正在渲染' : '暂无文件'}</span></div>`;
    }
    return image;
  };

  await load();
  beginPolling();
  const pollGuard = setInterval(() => {
    if (!sheet.root.isConnected) {
      clearInterval(pollGuard);
      stop();
      return;
    }
    if (!timer && status === 'generating') beginPolling();
  }, 1500);
}

export const taskActions = {
  async 'open-task'(d) {
    await openTaskSheet(d.id);
  },
};
