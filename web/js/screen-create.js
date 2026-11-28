import { api } from './api.js';
import { S, modelInfo, modelLabel, imgModels, videoModels } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { R } from './runtime.js';
import { extraParams, defaultExtraValue, prefersEnglishPrompt } from './model-schema.js';

const IMG_RATIOS = ['1:1', '4:3', '3:2', '16:9', '9:16', '2:3', '3:4', 'Auto'];
const NEW_WINDOW_MS = 10 * 60 * 1000;
const QUALITIES = [
  { id: 'standard', label: '标准' },
  { id: 'high', label: '高清' },
];

let pendingKind = 'image';
let pendingAccept = 'image/*';
let menuAbort = null;

function currentVideoModel() {
  return modelInfo('video', S.compose.videoModel);
}
function currentImageModel() {
  return modelInfo('image', S.compose.imageModel);
}

// 图片比例/质量优先读上游目录：上游加一档比例或画质，桌面端刷新即出现。
function imageRatios() {
  const m = currentImageModel();
  const raw = m?.aspectRatios || m?.ratioOptions;
  const list = Array.isArray(raw)
    ? raw.map((r) => (typeof r === 'string' ? r : r?.value || r?.id || r?.ratio || '')).filter(Boolean)
    : [];
  return list.length ? list : IMG_RATIOS;
}

function imageQualities() {
  const m = currentImageModel();
  const opts = m?.qualityOptions;
  const list = Array.isArray(opts)
    ? opts
        .map((q) => (typeof q === 'string' ? { id: q, label: q } : { id: String(q?.id ?? q?.value ?? ''), label: String(q?.label ?? q?.id ?? q?.value ?? '') }))
        .filter((q) => q.id)
    : [];
  if (list.length) return list;
  if (m && Number(m.highCost) && Number(m.highCost) !== Number(m.standardCost)) return QUALITIES;
  return [QUALITIES[0]];
}

function extrasSource() {
  if (S.compose.mode === 'image') return currentImageModel() || {};
  return { ...(currentVideoModel() || {}), ...(videoSpec() || {}) };
}

// Seedance exposes variants, each with its own size / duration / price. Older
// payloads use plain strings, so normalize both shapes.
function videoVariants(vm = currentVideoModel()) {
  return (vm?.variants || vm?.variantOptions || []).map((v) =>
    typeof v === 'string' ? { id: v, label: v } : { ...v, id: String(v.id) });
}

function videoSpec() {
  const vm = currentVideoModel();
  if (!vm) return null;
  const variants = videoVariants(vm);
  if (!variants.length) return vm;
  return variants.find((v) => v.id === S.compose.variant) || variants[0];
}

function workflowEntry() {
  const vm = currentVideoModel();
  return (vm?.workflowFormats || []).find((w) => w.id === S.compose.workflowFormat) || null;
}

function imageCost() {
  const m = currentImageModel();
  if (!m) return 0;
  const unit = S.compose.quality === 'high' ? m.highCost ?? m.standardCost : m.standardCost;
  const count = m.supportsImageCount ? Math.max(1, S.compose.n) : 1;
  return (Number(unit) || 0) * count;
}

function videoCost() {
  const spec = videoSpec();
  if (!spec) return 0;
  const secs = parseInt(String(S.compose.duration).replace('s', ''), 10) || spec.defaultDurationSeconds || 5;
  const base = spec.durationPricingBaseSeconds || 5;
  const res = (spec.resolutionOptions || []).find((r) => r.size === S.compose.size);
  const unit = Number(res?.imagiflyCredits ?? spec.imagiflyCredits) || 0;
  return Math.round((unit * secs) / base);
}

// 上游目录里声明的额外参数：用户选中就原样提交，键名去掉 Options 后缀。
// 上游新增 cameraMotionOptions → 提交 cameraMotion，客户端无需发版。
function applyExtras(fd) {
  const spec = extrasSource();
  for (const p of extraParams(spec)) {
    const value = S.compose.extra?.[p.key] ?? defaultExtraValue(spec, p);
    if (value) fd.set(p.formKey, String(value));
  }
}

function refLimit() {  if (S.compose.mode === 'image') return currentImageModel()?.referenceImageLimit ?? 0;
  return workflowEntry()?.referenceImageLimit ?? videoSpec()?.referenceImageLimit ?? 0;
}

function canPrivate() {
  const tier = S.billing?.activePlan?.tier || 'free';
  return tier === 'pro' || tier === 'max';
}

function activeRefs() {
  return S.refs;
}

function refsHTML() {
  const limit = refLimit();
  const kindLabels = { image: '参考图', video: '参考视频', audio: '参考音频', firstFrame: '首帧', lastFrame: '尾帧' };
  const items = activeRefs()
    .map((r, i) => {
      const isImage = r.kind === 'image' || r.kind === 'firstFrame' || r.kind === 'lastFrame';
      const visual = isImage
        ? `<img src="${UI.esc(r.url)}" alt="">`
        : r.kind === 'video'
          ? `<video src="${UI.esc(r.url)}" muted preload="metadata"></video>`
          : `<div class="ph">${icon('bolt', 20)}</div>`;
      return `<div class="ref">${visual}<span class="kind">${kindLabels[r.kind] || r.kind}</span><button class="rm" data-act="rm-ref" data-i="${i}" aria-label="移除">${icon('close', 12)}</button></div>`;
    })
    .join('');
  const canAdd = limit > 0 && activeRefs().length < limit;
  let add = '';
  if (canAdd) {
    if (S.compose.mode === 'image') {
      add = `<button class="ref add" data-act="add-ref" data-kind="image">${icon('plus', 22)}<span>参考图</span></button>`;
    } else if (S.compose.workflowFormat === 'fl2v') {
      const hasFirst = activeRefs().some((r) => r.kind === 'firstFrame');
      const hasLast = activeRefs().some((r) => r.kind === 'lastFrame');
      add = `${!hasFirst ? `<button class="ref add" data-act="add-ref" data-kind="firstFrame">${icon('plus', 22)}<span>首帧图</span></button>` : ''}
             ${!hasLast && limit >= 2 ? `<button class="ref add" data-act="add-ref" data-kind="lastFrame">${icon('plus', 22)}<span>尾帧图</span></button>` : ''}`;
    } else if (S.compose.workflowFormat === 'r2v') {
      add = `<button class="ref add" data-act="add-ref" data-kind="image">${icon('plus', 22)}<span>参考图</span></button>
             <button class="ref add" data-act="add-ref" data-kind="video">${icon('plus', 22)}<span>参考视频</span></button>
             <button class="ref add" data-act="add-ref" data-kind="audio">${icon('plus', 22)}<span>参考音频</span></button>`;
    } else if (limit > 0) {
      add = `<button class="ref add" data-act="add-ref" data-kind="image">${icon('plus', 22)}<span>参考图</span></button>`;
    }
  }
  let note = '';
  if (limit === 0) note = `<span class="field-help">该模型不支持参考素材${S.compose.mode === 'video' ? '（文生视频）' : ''}</span>`;
  else if (activeRefs().length >= limit) note = `<span class="field-help">已达上限 ${limit} 个</span>`;
  return `<div class="refs">${items}${add}</div>${note ? `<div style="margin-top:8px">${note}</div>` : ''}`;
}

function extraControlsHTML() {
  const spec = extrasSource();
  const params = extraParams(spec);
  if (!params.length) return '';
  return params
    .map((p) => {
      const value = S.compose.extra?.[p.key] ?? defaultExtraValue(spec, p);
      const auto = !value;
      return `<div class="control-group" data-param="${UI.esc(p.key)}"><span>${UI.esc(p.label)}</span><div class="chips">
        <button class="chip ${auto ? 'selected' : ''}" data-act="create-extra" data-key="${UI.esc(p.key)}" data-value="">自动</button>
        ${p.options.map((o) => `<button class="chip ${!auto && String(value) === o.value ? 'selected' : ''}" data-act="create-extra" data-key="${UI.esc(p.key)}" data-value="${UI.esc(o.value)}">${UI.esc(o.label)}</button>`).join('')}
      </div></div>`;
    })
    .join('');
}

function controlsHTML() {
  if (S.compose.mode === 'image') {
    const m = currentImageModel();
    const tiers = m?.resolutionOptions || [];
    const steps = (m?.stepsOptions || []).map(String);
    const ratios = imageRatios();
    const qualities = imageQualities();
    return `
      <div class="control-group wide"><span>比例</span><div class="chips">${ratios.map((r) => `<button class="chip ${S.compose.ratio === r ? 'selected' : ''}" data-act="create-ratio" data-value="${UI.esc(r)}">${UI.esc(r)}</button>`).join('')}</div></div>
      <div class="control-group"><span>质量</span><div class="seg sm">${qualities.map((q) => `<button class="seg-item ${S.compose.quality === q.id ? 'selected' : ''}" data-act="create-quality" data-value="${UI.esc(q.id)}">${UI.esc(q.label)}</button>`).join('')}</div></div>
      ${m?.supportsImageCount ? `<div class="control-group"><span>张数</span><div class="stepper"><button data-act="n-dec">−</button><span>${S.compose.n}</span><button data-act="n-inc">＋</button></div></div>` : ''}
      ${tiers.length > 1 ? `<div class="control-group"><span>分辨率</span><div class="chips">${tiers.map((t) => `<button class="chip ${S.compose.resolutionTier === t.id ? 'selected' : ''}" data-act="create-tier" data-value="${t.id}">${t.label || t.id}</button>`).join('')}</div></div>` : ''}
      ${steps.length ? `<div class="control-group"><span>步数</span><div class="chips">${steps.map((s) => `<button class="chip ${String(S.compose.steps) === s ? 'selected' : ''}" data-act="create-steps" data-value="${s}">${s}</button>`).join('')}</div></div>` : ''}
      ${extraControlsHTML()}
      <div class="control-group"><span>高级</span><button class="chip ${S.compose.advanced ? 'selected' : ''}" data-act="toggle-advanced">${icon('tune', 15)}参数</button></div>`;
  }

  const vm = currentVideoModel();
  const spec = videoSpec();
  if (!vm || !spec) return '';
  const ratios = spec.aspectRatios || [];
  const durs = spec.durationOptions || [];
  const fps = spec.fpsOptions || [];
  const wfs = vm.workflowFormats || [];
  const variants = videoVariants(vm);
  const resolutions = spec.resolutionOptions || [];
  return `
    ${wfs.length > 1 ? `<div class="control-group"><span>工作流</span><div class="seg sm">${wfs.map((w) => `<button class="seg-item ${S.compose.workflowFormat === w.id ? 'selected' : ''}" data-act="create-wf" data-value="${w.id}" title="${UI.esc(w.mode || '')}">${w.id === 't2v' ? '文生' : w.id === 'r2v' ? '参考' : '首帧'}</button>`).join('')}</div></div>` : ''}
    ${variants.length ? `<div class="control-group"><span>版本</span><div class="chips">${variants.map((v) => `<button class="chip ${S.compose.variant === v.id ? 'selected' : ''}" data-act="create-variant" data-value="${UI.esc(v.id)}">${UI.esc(v.label || v.id)}</button>`).join('')}</div></div>` : ''}
    ${durs.length ? `<div class="control-group"><span>时长</span><div class="chips">${durs.map((d) => `<button class="chip ${S.compose.duration === d ? 'selected' : ''}" data-act="create-duration" data-value="${d}">${d}</button>`).join('')}</div></div>` : ''}
    ${fps.length ? `<div class="control-group"><span>帧率</span><div class="chips">${fps.map((f) => `<button class="chip ${S.compose.fps === f ? 'selected' : ''}" data-act="create-fps" data-value="${f}">${f}fps</button>`).join('')}</div></div>` : ''}
    ${resolutions.length ? `<div class="control-group"><span>分辨率</span><div class="chips">${resolutions.map((r) => `<button class="chip ${S.compose.size === r.size ? 'selected' : ''}" data-act="create-resolution" data-value="${UI.esc(r.size || '')}">${UI.esc(r.label || r.resolution || r.size)}</button>`).join('')}</div></div>` : ''}
    ${ratios.length ? `<div class="control-group wide"><span>比例</span><div class="chips">${ratios.map((r) => `<button class="chip ${S.compose.ratio === r ? 'selected' : ''}" data-act="create-ratio" data-value="${r}">${r}</button>`).join('')}</div></div>` : ''}
    ${extraControlsHTML()}
    <div class="control-group"><span>高级</span><button class="chip ${S.compose.advanced ? 'selected' : ''}" data-act="toggle-advanced">${icon('tune', 15)}参数</button></div>`;
}

function advancedHTML() {
  if (S.compose.mode === 'image') {
    return `
      <div class="field" style="grid-column:1/-1"><label>反向提示词</label><div class="field-box area"><textarea id="negPrompt" placeholder="不希望出现的元素…">${UI.esc(S.compose.negative)}</textarea></div></div>
      <div class="field"><label>尺寸</label><div class="field-box"><input id="sizeInput" placeholder="留空自动推导，例如 1024x1024" value="${UI.esc(S.compose.size)}"></div><div class="field-help">不填由服务端按比例推导</div></div>
      <div class="field"><label>可见性</label>
        <div class="list-row" style="padding:0;border:0">
          <div class="main"><div class="t">仅自己可见</div><div class="s">${canPrivate() ? 'Pro / Max 可用' : '需要 Pro 或 Max 订阅'}</div></div>
          <button class="switch ${S.compose.visibility === 'private' ? 'on' : ''}" data-act="toggle-visibility" ${canPrivate() ? '' : 'disabled'} aria-label="仅自己可见"></button>
        </div>
      </div>`;
  }
  return `
    <div class="field" style="grid-column:1/-1"><label>反向提示词</label><div class="field-box area"><textarea id="negPrompt" placeholder="不希望出现的元素…">${UI.esc(S.compose.negative)}</textarea></div></div>
    <div class="field"><label>随机种子</label><div class="field-box"><input id="seedInput" placeholder="留空随机" value="${UI.esc(S.compose.seed)}"></div></div>
    <div class="field"><label>尺寸</label><div class="field-box"><input id="sizeInput" value="${UI.esc(S.compose.size)}"></div></div>
    <div class="field"><label>可见性</label>
      <div class="list-row" style="padding:0;border:0">
        <div class="main"><div class="t">仅自己可见</div><div class="s">${canPrivate() ? 'Pro / Max 可用' : '需要 Pro 或 Max 订阅'}</div></div>
        <button class="switch ${S.compose.visibility === 'private' ? 'on' : ''}" data-act="toggle-visibility" ${canPrivate() ? '' : 'disabled'} aria-label="仅自己可见"></button>
      </div>
    </div>`;
}

function modelMenuHTML() {
  const list = S.compose.mode === 'video' ? videoModels() : imgModels();
  const selected = S.compose.mode === 'video' ? S.compose.videoModel : S.compose.imageModel;
  const items = list
    .map((m) => {
      const price = S.compose.mode === 'video'
        ? `${UI.fmtNum(m.imagiflyCredits)} / 5s`
        : `标准 ${UI.fmtNum(m.standardCost)} · 高清 ${UI.fmtNum(m.highCost)}`;
      return `<button class="menu-item" data-act="model-pick" data-id="${UI.esc(m.id)}">
        <div><div>${UI.esc(m.label || m.id)}</div><small>${UI.esc(m.id)} · ${price} 额度</small></div>
        ${m.id === selected ? `<span class="sel">${icon('check', 16)}</span>` : ''}
      </button>`;
    })
    .join('');
  return `<div class="menu-scroll">${items}</div>`;
}

function template() {
  const mode = S.compose.mode;
  const m = mode === 'image' ? currentImageModel() : currentVideoModel();
  const cost = mode === 'image' ? imageCost() : videoCost();
  return `<div class="page">
    <div class="create">
      <section class="card hero composer" id="composer">
        <div class="composer-top">
          <div class="seg">
            <button class="seg-item ${mode === 'image' ? 'selected' : ''}" data-act="create-mode" data-value="image">${icon('image', 18)}图片</button>
            <button class="seg-item ${mode === 'video' ? 'selected' : ''}" data-act="create-mode" data-value="video">${icon('movie', 18)}视频</button>
          </div>
          <div class="grow"></div>
          <div class="menu-wrap">
            <button class="chip" data-act="model-open" id="modelBtn">${icon('layers', 15)}${UI.esc(modelDisplayLabel())}${icon('chevronDown', 14)}</button>
            <div class="menu" id="modelMenu" hidden>${modelMenuHTML()}</div>
          </div>
        </div>

        <div class="composer-prompt">
          <textarea id="prompt" rows="3" maxlength="2000" placeholder="${mode === 'image' ? '描述你想要的画面：主体、光线、材质、构图…' : '描述镜头里的动作、场景与运镜…'}">${UI.esc(S.compose.prompt)}</textarea>
        </div>
        <div class="prompt-meta">
          <button class="btn text xs" data-act="optimize" id="optimizeBtn">${icon('sparkle', 16)}优化提示词</button>
          <span id="langSlot">${langSlotHTML(m)}</span>
          <span class="count" id="promptCount">${S.compose.prompt.length} / 2000</span>
        </div>

        <div class="controls" id="controls">${controlsHTML()}</div>
        <div id="refsWrap">${refsHTML()}</div>

        <div class="composer-foot">
          <div class="cost">
            <span class="v" id="costValue">≈ ${UI.fmtNum(cost)} 额度</span>
            <span class="k" id="costHint">${UI.esc(costHint())}</span>
          </div>
          <div class="grow"></div>
          <button class="fab-ext" data-act="generate" id="generateBtn">${icon('sparkle', 26)}<span>${mode === 'image' ? '生成图片' : '生成视频'}</span><span class="kbd">Ctrl ↵</span></button>
        </div>

        <div class="advanced ${S.compose.advanced ? 'open' : ''}" id="advanced">
          <div class="advanced-inner" id="advancedInner">${advancedHTML()}</div>
        </div>
        <input type="file" id="refPick" accept="${pendingAccept}" multiple hidden>
        <input type="file" id="refPickVideo" accept="video/*" hidden>
        <input type="file" id="refPickAudio" accept="audio/*" hidden>
      </section>

      <section class="sect" id="activeSect" hidden>
        ${UI.sectionHead('正在生成', '任务受理即扣额度，完成后自动刷新')}
        <div class="active-strip" id="activeStrip"></div>
      </section>

      <section class="sect latest-sect" id="latestSect" hidden>
        <div class="latest-head">
          <span class="latest-flag">NEW</span>
          <div class="latest-title"><b>刚刚生成</b><span id="latestMeta"></span></div>
          <div class="grow"></div>
          <button class="btn text sm" data-act="latest-dismiss">收起</button>
        </div>
        <div class="latest-stage" id="latestStage" data-act="open-task" tabindex="0" role="button" aria-label="查看刚刚生成的作品"></div>
      </section>

      <section class="sect">
        ${UI.sectionHead('最近作品', '缩略图直接来自 previewThumbnailUrl', `<button class="btn text sm" data-act="nav" data-route="library">全部作品 ${icon('chevronRight', 16)}</button>`)}
        <div class="grid cards" id="recentGrid"></div>
      </section>
    </div>
  </div>`;
}

function langSlotHTML(model) {
  if (!prefersEnglishPrompt(model)) return '';
  return `<button class="btn text xs" data-act="translate-prompt" id="translateBtn" data-tip="该模型更容易理解英文提示词">${icon('translate', 16)}译成英文</button>`;
}

function modelDisplayLabel() {
  if (S.compose.mode === 'image') return currentImageModel()?.label || '选择模型';
  const vm = currentVideoModel();
  if (!vm) return '选择模型';
  const spec = videoSpec();
  const variants = videoVariants(vm);
  return variants.length && spec ? `${vm.label || vm.id} · ${spec.label || spec.id}` : vm.label || vm.id;
}

function costHint() {
  const mode = S.compose.mode;
  if (mode === 'image') {
    const m = currentImageModel();
    const size = S.compose.size || '自动';
    const tier = S.compose.resolutionTier ? ` · ${S.compose.resolutionTier}` : '';
    const count = m?.supportsImageCount ? `${S.compose.n} 张 · ` : '';
    return `${m?.label || ''} · ${count}${size}${tier}`;
  }
  const spec = videoSpec();
  const vm = currentVideoModel();
  const variants = videoVariants(vm);
  const prefix = variants.length && spec ? `${vm?.label || ''} ${spec.label || spec.id}` : (vm?.label || '');
  return `${prefix} · ${S.compose.duration} · ${S.compose.fps}fps · ${S.compose.size || '默认尺寸'}`;
}

function refreshComposer(view) {
  if (!view) return;
  const mode = S.compose.mode;
  const root = view.querySelector('#composer');
  if (!root) return;
  root.querySelectorAll('[data-act="create-mode"]').forEach((b) => b.classList.toggle('selected', b.dataset.value === mode));
  const m = mode === 'image' ? currentImageModel() : currentVideoModel();
  const btn = root.querySelector('#modelBtn');
  if (btn) btn.innerHTML = `${icon('layers', 15)}${UI.esc(modelDisplayLabel())}${icon('chevronDown', 14)}`;
  const menu = root.querySelector('#modelMenu');
  if (menu) {
    menu.innerHTML = modelMenuHTML();
    menu.hidden = true;
  }
  const cost = mode === 'image' ? imageCost() : videoCost();
  const langSlot = root.querySelector('#langSlot');
  if (langSlot) langSlot.innerHTML = langSlotHTML(m);
  const value = root.querySelector('#costValue');
  if (value) value.textContent = `≈ ${UI.fmtNum(cost)} 额度`;
  const hint = root.querySelector('#costHint');
  if (hint) hint.textContent = costHint();
  const controls = root.querySelector('#controls');
  if (controls) controls.innerHTML = controlsHTML();
  const refs = root.querySelector('#refsWrap');
  if (refs) refs.innerHTML = refsHTML();
  const adv = root.querySelector('#advanced');
  if (adv) {
    adv.classList.toggle('open', S.compose.advanced);
    const inner = root.querySelector('#advancedInner');
    if (inner) inner.innerHTML = advancedHTML();
  }
  const gen = root.querySelector('#generateBtn');
  if (gen) {
    gen.innerHTML = `${icon('sparkle', 26)}<span>${mode === 'image' ? '生成图片' : '生成视频'}</span><span class="kbd">Ctrl ↵</span>`;
  }
  const prompt = root.querySelector('#prompt');
  if (prompt) {
    prompt.placeholder = mode === 'image'
      ? '描述你想要的画面：主体、光线、材质、构图…'
      : '描述镜头里的动作、场景与运镜…';
  }
  bindAdvanced(root);
}

function bindAdvanced(root) {
  const neg = root.querySelector('#negPrompt');
  if (neg) neg.addEventListener('input', () => { S.compose.negative = neg.value; });
  const size = root.querySelector('#sizeInput');
  if (size) size.addEventListener('input', () => { S.compose.size = size.value.trim(); });
  const seed = root.querySelector('#seedInput');
  if (seed) seed.addEventListener('input', () => { S.compose.seed = seed.value.trim(); });
}

function bindOnce(view) {
  const ta = view.querySelector('#prompt');
  if (ta) {
    ta.addEventListener('input', () => {
      S.compose.prompt = ta.value;
      const count = view.querySelector('#promptCount');
      if (count) count.textContent = `${ta.value.length} / 2000`;
      ta.style.height = 'auto';
      ta.style.height = Math.min(280, ta.scrollHeight) + 'px';
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        view.querySelector('[data-act="generate"]')?.click();
      }
    });
    requestAnimationFrame(() => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(280, ta.scrollHeight) + 'px';
    });
  }

  const pick = view.querySelector('#refPick');
  if (pick) {
    pick.addEventListener('change', () => {
      addFiles(pick.files, pendingKind, view);
      pick.value = '';
    });
  }
  const pickV = view.querySelector('#refPickVideo');
  if (pickV) pickV.addEventListener('change', () => { addFiles(pickV.files, 'video', view); pickV.value = ''; });
  const pickA = view.querySelector('#refPickAudio');
  if (pickA) pickA.addEventListener('change', () => { addFiles(pickA.files, 'audio', view); pickA.value = ''; });

  menuAbort?.abort();
  menuAbort = new AbortController();
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) {
      const menu = view.querySelector('#modelMenu');
      if (menu) menu.hidden = true;
    }
  }, { signal: menuAbort.signal });
}

function applyVideoSpec(spec) {
  if (!spec) return;
  const ratios = spec.aspectRatios || [];
  if (ratios.length && !ratios.includes(S.compose.ratio)) S.compose.ratio = ratios[0];
  const durs = spec.durationOptions || [];
  if (durs.length && !durs.includes(S.compose.duration)) S.compose.duration = durs[0];
  const fps = spec.fpsOptions || [];
  if (fps.length && !fps.includes(S.compose.fps)) S.compose.fps = spec.defaultFps || fps[0];
  if (spec.size) S.compose.size = spec.size;
}

function addFiles(fileList, kind, view) {
  if (!fileList) return;
  const limit = refLimit();
  if (kind === 'firstFrame' || kind === 'lastFrame') {
    S.refs = S.refs.filter((r) => r.kind !== kind);
  }
  for (const file of fileList) {
    if (S.refs.length >= limit) {
      UI.toast(`参考素材最多 ${limit} 个`, 'error');
      break;
    }
    if (file.size > 10 * 1024 * 1024) {
      UI.toast(`${file.name} 超过 10MB，已跳过`, 'error');
      continue;
    }
    S.refs.push({ kind, file, name: file.name, mime: file.type, url: URL.createObjectURL(file) });
  }
  refreshComposer(view);
}

function resetGenerateButton(view, label) {
  const btn = view.querySelector('#generateBtn');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `${icon('sparkle', 26)}<span>${label}</span><span class="kbd">Ctrl ↵</span>`;
}

function setBusy(view) {
  const btn = view.querySelector('#generateBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `${UI.wavyRing(24, 2, 7, 4)}<span>提交中…</span>`;
}

async function doGenerate(view) {
  const mode = S.compose.mode;
  const prompt = (view.querySelector('#prompt')?.value || S.compose.prompt || '').trim();
  if (!prompt) {
    UI.toast('先写一段提示词', 'warn');
    view.querySelector('#prompt')?.focus();
    return;
  }
  if (S.compose.prompt !== prompt) S.compose.prompt = prompt;
  const limit = refLimit();
  if (S.refs.length > limit) {
    UI.toast(`当前模型最多 ${limit} 个参考素材`, 'error');
    return;
  }

  try {
    const act = await api('/local/generations/activity');
    S.activity = act.activity || S.activity;
    if (S.activity && S.activity.activeCount >= S.activity.limit) {
      UI.toast(`并发已满（${S.activity.activeCount}/${S.activity.limit}），等当前任务完成后再提交`, 'error');
      return;
    }
  } catch {}

  setBusy(view);
  const fd = new FormData();
  const c = S.compose;
  fd.set('prompt', prompt);
  fd.set('negativePrompt', c.negative || '');
  if (mode === 'image') {
    fd.set('model', c.imageModel);
    fd.set('n', String(currentImageModel()?.supportsImageCount ? c.n || 1 : 1));
    if (c.ratio) fd.set('ratio', c.ratio);
    if (c.resolutionTier) fd.set('resolutionTier', c.resolutionTier);
    if (c.steps) fd.set('steps', String(c.steps));
    if (c.size) fd.set('size', c.size);
    fd.set('quality', c.quality || 'standard');
    if (c.visibility === 'private' && canPrivate()) fd.set('communityVisibility', 'private');
    applyExtras(fd);
    S.refs.forEach((r) => fd.append('ref_image', r.file, r.name));
  } else {
    const vm = currentVideoModel();
    const spec = videoSpec();
    fd.set('model', c.videoModel);
    if (videoVariants(vm).length && c.variant) fd.set('variant', c.variant);
    fd.set('workflowFormat', c.workflowFormat);
    if (c.duration) fd.set('duration', c.duration);
    if (c.fps) fd.set('fps', String(c.fps));
    if (c.ratio) fd.set('ratio', c.ratio);
    if (c.size) fd.set('size', c.size);
    if (c.quality) fd.set('quality', c.quality);
    if (c.seed) fd.set('seed', c.seed);
    applyExtras(fd);
    S.refs.forEach((r) => {
      const field = r.kind === 'firstFrame' ? 'ref_first' : r.kind === 'lastFrame' ? 'ref_last' : r.kind === 'video' ? 'ref_video' : r.kind === 'audio' ? 'ref_audio' : 'ref_image';
      fd.append(field, r.file, r.name);
    });
    if (spec?.size && !c.size) fd.set('size', spec.size);
  }

  try {
    const url = mode === 'image' ? '/local/images/generate' : '/local/videos/generate';
    const data = await api(url, { method: 'POST', form: fd });
    const gen = data?.generation;
    if (data?.user?.credits !== undefined) {
      S.user.credits = data.user.credits;
      R.paintCredits();
    }
    if (gen?.id && S.compose.source?.communityId) {
      api('/local/community/remix', { method: 'POST', body: { communityGenerationId: S.compose.source.communityId, generationId: gen.id } }).catch(() => {});
      S.compose.source = null;
    }
    if (gen?.id) {
      S.compose.watchIds = [...new Set([...(S.compose.watchIds || []), String(gen.id)])].slice(-8);
      S.compose.revealId = '';
      S.compose.revealSeen = false;
    }
    UI.toast(mode === 'image' ? '已提交图片生成' : '已提交视频生成', 'ok', {
      label: '查看',
      fn: () => gen?.id && R.navigate('library'),
    });
    await R.refreshTasks(true);
  } catch (err) {
    const info = UI.extractError(err);
    let msg = info.message || '提交失败';
    if (info.code === 'GENERATION_CONCURRENCY_LIMIT') msg = `并发已满（${info.activeCount || '?'}/${info.limit || '?'}）：${msg}`;
    if (info.code === 'PRIVATE_MODE_REQUIRES_SUBSCRIPTION') msg = '仅自己可见需要 Pro / Max 订阅';
    UI.toast(msg, 'error');
  } finally {
    resetGenerateButton(view, mode === 'image' ? '生成图片' : '生成视频');
  }
}

async function doOptimize(view) {
  const prompt = (view.querySelector('#prompt')?.value || '').trim();
  if (!prompt) {
    UI.toast('先写提示词再优化', 'warn');
    return;
  }
  const btn = view.querySelector('#optimizeBtn');
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${UI.wavyRing(16, 1.6, 6, 4)}<span>优化中…</span>`;
  try {
    const data = await api('/local/prompts/optimize', { method: 'POST', body: { prompt, model: S.compose.mode === 'image' ? S.compose.imageModel : S.compose.videoModel } });
    const next = typeof data === 'string' ? data : data?.prompt || data?.optimizedPrompt || data?.text || '';
    if (!next) {
      UI.toast('接口没有返回优化结果', 'error');
      console.warn('optimize response', data);
      return;
    }
    S.compose.prompt = next;
    const ta = view.querySelector('#prompt');
    if (ta) {
      ta.value = next;
      ta.dispatchEvent(new Event('input'));
    }
    UI.toast('提示词已优化', 'ok');
  } catch (e) {
    UI.toast(`优化失败：${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

async function doTranslate(view) {
  const ta = view.querySelector('#prompt');
  const btn = view.querySelector('#translateBtn');
  if (!ta || !btn) return;
  const text = (ta.value || '').trim();
  if (!text) {
    UI.toast('先写提示词再翻译', 'warn');
    return;
  }
  if (!/[\u4e00-\u9fff]/.test(text)) {
    UI.toast('提示词已经是英文', 'info');
    return;
  }
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${UI.wavyRing(16, 1.6, 6, 4)}<span>翻译中…</span>`;
  try {
    const data = await api('/local/translate', { method: 'POST', body: { text, target: 'en' }, timeout: 30000 });
    const next = String(data?.text || '').trim();
    if (!next) throw new Error('翻译服务没有返回结果');
    ta.value = next;
    S.compose.prompt = next;
    ta.dispatchEvent(new Event('input'));
    UI.toast(data?.provider === 'none' ? '提示词已经是英文' : '已译为英文', 'ok', data?.provider === 'none' ? null : {
      label: '撤销',
      fn: () => {
        if (S.compose.prompt !== next) return;
        S.compose.prompt = text;
        const el = document.getElementById('prompt');
        if (el) {
          el.value = text;
          el.dispatchEvent(new Event('input'));
        }
        UI.toast('已恢复原文', 'info');
      },
    });
  } catch (e) {
    UI.toast(`翻译失败：${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

function latestStageHTML(item) {
  const isVideo = item.mode === 'video';
  const asset = item.assets?.[0];
  const name = `imagifly-${item.model || 'gen'}-${String(item.id || '').slice(-6)}`;
  let media = '';
  if (isVideo) {
    const video = UI.proxyMediaURL(UI.assetURL(item));
    const poster = UI.mediaURL(asset?.thumbnailUrl || item.previewThumbnailUrl);
    media = video
      ? `<video src="${UI.esc(video)}" controls autoplay muted loop playsinline${poster ? ` poster="${UI.esc(poster)}"` : ''}></video>`
      : `<div class="latest-ph">${icon('movie', 44)}<span>暂无视频文件</span></div>`;
  } else {
    const img = UI.assetImageURL(asset, 1200) || UI.mediaURL(item.previewThumbnailUrl);
    const fallback = UI.proxyMediaURL(asset?.thumbnailUrl || item.previewThumbnailUrl || asset?.url);
    media = img
      ? `<img src="${UI.esc(img)}" alt="${UI.esc(UI.shortPrompt(item.prompt, 80))}" decoding="async" fetchpriority="high"${fallback ? ` data-fallback="${UI.esc(fallback)}"` : ''}>`
      : `<div class="latest-ph">${icon('image', 44)}<span>暂无图片文件</span></div>`;
  }
  return `${media}
    <div class="latest-tools">
      <span class="latest-tag">${icon(isVideo ? 'movie' : 'image', 13)}${isVideo ? '视频' : '图片'} · 已完成</span>
      <button class="btn filled sm" data-act="open-task" data-id="${UI.esc(item.id)}">${icon('external', 16)}查看大图</button>
    </div>
    <button class="icon-btn sm latest-save" data-act="quick-download" data-url="${UI.esc(UI.assetURL(item)) || UI.esc(item.previewThumbnailUrl)}" data-name="${UI.esc(name)}" data-tip="保存到本地">${icon('download', 18)}</button>`;
}

function paintLatest(item) {
  const sect = document.getElementById('latestSect');
  const stage = document.getElementById('latestStage');
  const meta = document.getElementById('latestMeta');
  if (!sect || !stage) return;
  if (meta) meta.textContent = `${modelLabel(item.model)} · ${UI.shortPrompt(item.prompt, 72)}`;
  stage.dataset.id = item.id;
  stage.innerHTML = latestStageHTML(item);
  sect.hidden = false;
}

function isRecentNew(task, now = Date.now()) {
  if (task.status !== 'success' || String(task.moderationStatus || '').includes('rejected')) return false;
  const ts = new Date(task.createdAt).getTime();
  if (!Number.isFinite(ts)) return false;
  const age = now - ts;
  return age >= 0 && age <= NEW_WINDOW_MS;
}

function recentNewIds(sorted) {
  const now = Date.now();
  return sorted.filter((t) => isRecentNew(t, now)).map((t) => String(t.id));
}

let newBadgeTimer = null;
function scheduleNewBadgeTick(sorted) {
  if (newBadgeTimer) clearTimeout(newBadgeTimer);
  newBadgeTimer = null;
  const now = Date.now();
  const expiries = sorted
    .filter((t) => t.status === 'success' && !String(t.moderationStatus || '').includes('rejected'))
    .map((t) => new Date(t.createdAt).getTime() + NEW_WINDOW_MS)
    .filter((ts) => Number.isFinite(ts) && ts > now);
  if (!expiries.length) return;
  const delay = Math.min(Math.min(...expiries) - now + 1000, NEW_WINDOW_MS);
  newBadgeTimer = setTimeout(() => {
    newBadgeTimer = null;
    if (document.getElementById('recentGrid')) updateCreateTasks();
  }, Math.max(1000, delay));
}

function visibleReveal(sorted) {
  const ids = new Set((S.compose.watchIds || []).map(String));
  return sorted.find((t) => ids.has(String(t.id))
    && t.status === 'success'
    && !String(t.moderationStatus || '').includes('rejected')
    && !S.removed.has(String(t.id))) || null;
}

export function updateCreateTasks() {
  const grid = document.getElementById('recentGrid');
  if (!grid) return;
  const sorted = [...S.tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const reveal = visibleReveal(sorted);
  const fresh = reveal && String(reveal.id) !== String(S.compose.revealId || '');
  if (fresh) {
    S.compose.revealId = String(reveal.id);
    S.compose.revealSeen = false;
  }
  const showNew = !!reveal && !S.compose.revealSeen && String(reveal.id) === String(S.compose.revealId || '');
  const newIds = recentNewIds(sorted);
  UI.paintTaskGrid(grid, sorted.slice(0, 12), newIds);
  scheduleNewBadgeTick(sorted);

  const latest = document.getElementById('latestSect');
  if (latest) {
    if (showNew) paintLatest(reveal);
    else latest.hidden = true;
  }
  if (showNew && fresh) {
    // The form is tall; bring the finished image into view instead of leaving
    // it below the fold next to the ordinary recent cards.
    requestAnimationFrame(() => {
      latest?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const running = sorted.filter((t) => t.status === 'generating');
  const sect = document.getElementById('activeSect');
  const strip = document.getElementById('activeStrip');
  if (sect) sect.hidden = running.length === 0;
  if (strip) strip.innerHTML = running.map(UI.activeCard).join('');
}

export async function renderCreate(view) {
  if (!S.models.image.length) {
    try {
      const [models, durations] = await Promise.all([api('/local/models'), api('/local/models/durations')]);
      S.modelsRaw = models;
      S.models = { image: models.imageModels || [], video: models.videoModels || [] };
      S.durations = durations.models || {};
    } catch (e) {
      view.innerHTML = `<div class="page narrow"><div class="banner error">${icon('alert', 20)}<div>模型目录加载失败：${UI.esc(e.message)}</div></div></div>`;
      return;
    }
  }
  view.innerHTML = template();
  bindOnce(view);
  updateCreateTasks();
  R.refreshTasks(true).then(() => updateCreateTasks()).catch(() => {});
  bindAdvanced(view.querySelector('#composer'));
  const ta = view.querySelector('#prompt');
  if (ta) ta.focus();
}

export const createActions = {
  'create-mode': (d) => {
    S.compose.mode = d.value;
    S.compose.extra = {};
    if (d.value === 'video') {
      const vm = currentVideoModel();
      const variants = videoVariants(vm);
      if (variants.length && !variants.find((v) => v.id === S.compose.variant)) S.compose.variant = variants[0].id;
      applyVideoSpec(videoSpec());
      const wfs = (vm?.workflowFormats || []).map((w) => w.id);
      if (wfs.length && !wfs.includes(S.compose.workflowFormat)) S.compose.workflowFormat = wfs[0];
    } else {
      if (!IMG_RATIOS.includes(S.compose.ratio)) S.compose.ratio = '1:1';
      S.compose.size = '';
    }
    S.refs = [];
    refreshComposer(document.getElementById('view'));
  },
  'create-ratio': (d) => { S.compose.ratio = d.value; refreshComposer(document.getElementById('view')); },
  'create-quality': (d) => { S.compose.quality = d.value; refreshComposer(document.getElementById('view')); },
  'create-tier': (d) => { S.compose.resolutionTier = d.value; refreshComposer(document.getElementById('view')); },
  'create-steps': (d) => { S.compose.steps = d.value; refreshComposer(document.getElementById('view')); },
  'create-wf': (d) => { S.compose.workflowFormat = d.value; S.refs = []; refreshComposer(document.getElementById('view')); },
  'create-duration': (d) => { S.compose.duration = d.value; refreshComposer(document.getElementById('view')); },
  'create-fps': (d) => { S.compose.fps = Number(d.value); refreshComposer(document.getElementById('view')); },
  'create-variant': (d) => {
    S.compose.variant = d.value;
    S.refs = [];
    S.compose.extra = {};
    applyVideoSpec(videoSpec());
    refreshComposer(document.getElementById('view'));
  },
  'create-resolution': (d) => {
    if (d.value) S.compose.size = d.value;
    refreshComposer(document.getElementById('view'));
  },
  'create-extra': (d) => {
    if (!S.compose.extra) S.compose.extra = {};
    if (d.value) S.compose.extra[d.key] = d.value;
    else delete S.compose.extra[d.key];
    refreshComposer(document.getElementById('view'));
  },
  'n-inc': () => { S.compose.n = Math.min(4, S.compose.n + 1); refreshComposer(document.getElementById('view')); },
  'n-dec': () => { S.compose.n = Math.max(1, S.compose.n - 1); refreshComposer(document.getElementById('view')); },
  'toggle-advanced': () => { S.compose.advanced = !S.compose.advanced; refreshComposer(document.getElementById('view')); },
  'toggle-visibility': () => {
    if (!canPrivate()) {
      UI.toast('仅自己可见需要 Pro / Max 订阅', 'warn');
      return;
    }
    S.compose.visibility = S.compose.visibility === 'private' ? 'public' : 'private';
    refreshComposer(document.getElementById('view'));
  },
  'model-open': () => {
    const menu = document.getElementById('modelMenu');
    if (menu) menu.hidden = !menu.hidden;
  },
  'model-pick': (d) => {
    if (S.compose.mode === 'image') S.compose.imageModel = d.id;
    else S.compose.videoModel = d.id;
    S.refs = [];
    S.compose.extra = {};
    const menu = document.getElementById('modelMenu');
    if (menu) menu.hidden = true;
    // reset per-model values
    const im = currentImageModel();
    if (S.compose.mode === 'image' && im) {
      S.compose.resolutionTier = im.defaultResolutionTier || im.resolutionOptions?.[0]?.id || '';
      S.compose.steps = String(im.defaultSteps || im.stepsOptions?.[0] || '');
      S.compose.size = '';
    }
    const vm = currentVideoModel();
    if (S.compose.mode === 'video' && vm) {
      const variants = videoVariants(vm);
      S.compose.variant = variants[0]?.id || '';
      applyVideoSpec(videoSpec());
      S.compose.workflowFormat = vm.workflowFormats?.[0]?.id || 't2v';
    }
    refreshComposer(document.getElementById('view'));
  },
  'add-ref': (d) => {
    pendingKind = d.kind || 'image';
    const pick = pendingKind === 'video' ? document.getElementById('refPickVideo') : pendingKind === 'audio' ? document.getElementById('refPickAudio') : document.getElementById('refPick');
    pendingAccept = pendingKind === 'video' ? 'video/*' : pendingKind === 'audio' ? 'audio/*' : 'image/*';
    if (pick) {
      pick.accept = pendingAccept;
      pick.click();
    }
  },
  'rm-ref': (d) => { S.refs.splice(Number(d.i), 1); refreshComposer(document.getElementById('view')); },
  optimize: () => doOptimize(document.getElementById('view')),
  'translate-prompt': () => doTranslate(document.getElementById('view')),
  'latest-dismiss': () => {
    S.compose.revealSeen = true;
    updateCreateTasks();
  },
  generate: () => doGenerate(document.getElementById('view')),
};
