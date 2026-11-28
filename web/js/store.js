export const S = {
  cfg: null,
  user: null,
  billing: null,
  modelsRaw: null,
  models: { image: [], video: [] },
  durations: {},
  tasks: [],
  activity: null,
  // IDs the user just deleted. Lists are filtered through this set so a slow
  // refresh (or an upstream list that lags behind the DELETE) cannot make a
  // removed card reappear. A failed DELETE removes the id again.
  removed: new Set(),
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
    // Tasks created in this session: when one finishes, the create page shows
    // it in the large "NEW" preview instead of only a small recent card.
    watchIds: [],
    revealId: '',
    revealSeen: false,
  },
  refs: [],
  library: { tab: 'recent', gallery: null, offset: 0, loaded: false },
  community: { mode: 'image', kind: 'community', q: '', offset: 0, items: [], hasMore: false, loaded: false, hero: [], follows: new Set() },
  account: { summary: null, history: null, notifications: null, inbox: null, sessionLikes: null, referral: null, share: null, packages: null, devices: null, accounts: null, follows: null, gallery: null, mineImages: null, mineVideos: null, relationKind: 'following', relationItems: [], receivedWorks: [], likedWorks: [], publicWorks: [], loaded: false },
  dev: { keys: null, coverage: null, log: null, selftest: null },
};

export function setSession(user, billing) {
  S.user = user;
  S.billing = billing;
}

export function hideGeneration(id) {
  const key = String(id);
  S.removed.add(key);
  S.tasks = (S.tasks || []).filter((t) => String(t.id) !== key);
  if (S.library.gallery) {
    const items = (S.library.gallery.items || []).filter((t) => String(t.id) !== key);
    S.library.gallery = { ...S.library.gallery, items };
  }
}

export function unhideGeneration(id) {
  S.removed.delete(String(id));
}

export function isGenerationHidden(id) {
  return S.removed.has(String(id));
}

export function visibleTasks(list) {
  return (list || []).filter((t) => t && !S.removed.has(String(t.id)));
}

export function resetSession() {
  S.user = null;
  S.billing = null;
  S.tasks = [];
  S.removed = new Set();
  S.library = { tab: 'recent', gallery: null, offset: 0, loaded: false };
  S.account = { summary: null, history: null, notifications: null, inbox: null, sessionLikes: null, referral: null, share: null, packages: null, devices: null, accounts: null, follows: null, gallery: null, mineImages: null, mineVideos: null, relationKind: 'following', relationItems: [], receivedWorks: [], likedWorks: [], publicWorks: [], loaded: false };
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
