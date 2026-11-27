export const S = {
  cfg: null,
  user: null,
  billing: null,
  modelsRaw: null,
  models: { image: [], video: [] },
  durations: {},
  tasks: [],
  activity: null,
  route: 'create',
  compose: {
    mode: 'image',
    prompt: '',
    negative: '',
    imageModel: 'gpt-image-2',
    videoModel: 'MiniMax-H3',
    ratio: '1:1',
    quality: 'standard',
    n: 1,
    resolutionTier: '',
    steps: '',
    size: '',
    variant: '',
    workflowFormat: 't2v',
    duration: '',
    fps: 0,
    seed: '',
    extra: {},
    visibility: 'public',
    advanced: false,
    source: null,
  },
  refs: [],
  library: { tab: 'recent', gallery: null, offset: 0, loaded: false },
  community: { mode: 'image', kind: 'community', q: '', offset: 0, items: [], hasMore: false, loaded: false, hero: [], follows: new Set() },
  account: { summary: null, history: null, notifications: null, referral: null, share: null, packages: null, devices: null, accounts: null, follows: null, gallery: null, mineImages: null, mineVideos: null, relationKind: 'following', relationItems: [], receivedWorks: [], likedWorks: [], publicWorks: [], loaded: false },
  dev: { keys: null, coverage: null, log: null, selftest: null },
};

export function setSession(user, billing) {
  S.user = user;
  S.billing = billing;
}

export function resetSession() {
  S.user = null;
  S.billing = null;
  S.tasks = [];
  S.library = { tab: 'recent', gallery: null, offset: 0, loaded: false };
  S.account = { summary: null, history: null, notifications: null, referral: null, share: null, packages: null, devices: null, accounts: null, follows: null, gallery: null, mineImages: null, mineVideos: null, relationKind: 'following', relationItems: [], receivedWorks: [], likedWorks: [], publicWorks: [], loaded: false };
  S.community = { mode: 'image', kind: 'community', q: '', offset: 0, items: [], hasMore: false, loaded: false, hero: [], follows: new Set() };
  S.dev = { keys: null, coverage: null, log: null, selftest: null };
}

export function imgModels() {
  return S.models.image || [];
}

export function videoModels() {
  return S.models.video || [];
}

export function modelInfo(mode, id) {
  const list = mode === 'video' ? videoModels() : imgModels();
  return list.find((m) => m.id === id) || list[0] || null;
}

export function modelLabel(id) {
  const all = [...imgModels(), ...videoModels()];
  const hit = all.find((m) => m.id === id);
  return hit ? hit.label || hit.id : id || '未知模型';
}

export function extractError(err) {
  if (!err) return { status: 0, message: '未知错误' };
  return { status: err.status || 0, code: err.code || '', message: err.message || String(err), limit: err.limit, activeCount: err.activeCount };
}
