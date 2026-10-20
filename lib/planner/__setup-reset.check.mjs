import assert from 'node:assert/strict';
import { clearPlannerStorage, createSetupResetSequence } from './setup-reset.ts';

const sequence = createSetupResetSequence();
assert.equal(sequence('x', 0), false);
assert.equal(sequence('c', 100), false);
assert.equal(sequence('x', 200), true);
assert.equal(sequence('c', 300), false, 'A completed sequence resets');
assert.equal(sequence('x', 400), false);
assert.equal(sequence('c', 2500), false, 'Pausing more than two seconds resets the sequence');
assert.equal(sequence('x', 2600), false);
assert.equal(sequence('a', 2700), false);
assert.equal(sequence('c', 2800), false);
assert.equal(sequence('x', 2900), false, 'Other keys interrupt the sequence');
assert.equal(sequence('X', 3000), false, 'A repeated first key begins a new sequence');
assert.equal(sequence('C', 3100), false);
assert.equal(sequence('X', 3200), true, 'Caps Lock is supported');
assert.equal(sequence('x', 3300), false);
assert.equal(sequence('', 3400), false);
assert.equal(sequence('c', 3500), false);
assert.equal(sequence('x', 3600), false, 'Blur and editing can cancel a partial sequence');

const data = new Map([
  ['fourYear.onboarding.v2', 'saved answers and transcript'],
  ['fourYear.board.v4', 'saved plans and settings'],
  ['fourYear.advisor.v1', 'chat history'],
  ['fourYear.theme', 'dark'],
  ['fourYear.onboarding.v1', 'legacy setup'],
  ['four-year-planner-v3', 'legacy board'],
  ['planner.clubs.open', 'closed'],
  ['unrelated-app', 'keep'],
  ['four-year-planner-vendor', 'also keep'],
]);
const storage = {
  get length() { return data.size; },
  key(index) { return [...data.keys()][index] ?? null; },
  removeItem(key) { data.delete(key); },
};
clearPlannerStorage(storage);
assert.deepEqual([...data], [['unrelated-app', 'keep'], ['four-year-planner-vendor', 'also keep']]);
clearPlannerStorage(storage);
assert.equal(data.size, 2, 'Reset is safe to repeat');
assert.throws(() => clearPlannerStorage({ length: 1, key: () => 'fourYear.board.v4', removeItem: () => { throw new Error('Blocked'); } }), /Blocked/, 'Storage failures must be reported, not called a successful reset');
console.log('Setup reset: sequence, timing, cancellation, namespaced storage, legacy cleanup, and failures passed.');
