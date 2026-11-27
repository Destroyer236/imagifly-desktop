// Local delete-tombstone behaviour: removing a card must be instant and stay
// removed even if a refresh returns stale data, and a failed DELETE must put
// the card back.
import assert from 'node:assert/strict';
import { S, hideGeneration, unhideGeneration, visibleTasks, resetSession } from '../web/js/store.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass += 1;
  console.log('ok -', name);
};

S.tasks = [
  { id: 'gen_a', prompt: 'a' },
  { id: 'gen_b', prompt: 'b' },
];
S.library = { tab: 'recent', gallery: { items: [{ id: 'gen_a' }, { id: 'gen_c' }], recentCount: 2 }, offset: 0, loaded: false };

t('hide removes from tasks immediately', () => {
  hideGeneration('gen_a');
  assert.deepEqual(S.tasks.map((x) => x.id), ['gen_b']);
});

t('hide removes from gallery snapshot', () => {
  assert.deepEqual(S.library.gallery.items.map((x) => x.id), ['gen_c']);
});

t('hidden id survives a stale refresh', () => {
  S.tasks = [{ id: 'gen_a' }, { id: 'gen_b' }];
  assert.deepEqual(visibleTasks(S.tasks).map((x) => x.id), ['gen_b']);
});

t('unhide only clears the tombstone', () => {
  S.tasks = [{ id: 'gen_a' }, { id: 'gen_b' }];
  unhideGeneration('gen_a');
  assert.deepEqual(visibleTasks(S.tasks).map((x) => x.id), ['gen_a', 'gen_b']);
});

t('resetSession clears tombstones', () => {
  hideGeneration('gen_a');
  resetSession();
  assert.equal(S.removed.size, 0);
  assert.equal(visibleTasks([{ id: 'gen_a' }]).length, 1);
});

console.log(`\n${pass} delete-local checks passed`);
