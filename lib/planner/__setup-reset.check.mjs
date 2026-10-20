import assert from 'node:assert/strict';
import { clearPlannerStorage, createSetupResetSequence } from './setup-reset.ts';

const sequence = createSetupResetSequence();
assert.equal(sequence('x', 0), false);
assert.equal(sequence('c', 100), false);
assert.equal(sequence('x', 200), false, 'The old three-key sequence no longer resets data');
assert.equal(sequence('s', 300), false);
assert.equal(sequence('x', 400), true, 'All five keys are required');
assert.equal(sequence('c', 500), false, 'A completed sequence resets');
assert.equal(sequence('x', 600), false);
assert.equal(sequence('c', 2700), false, 'Pausing more than two seconds resets the sequence');
assert.equal(sequence('x', 2800), false);
assert.equal(sequence('s', 2900), false);
assert.equal(sequence('x', 3000), false, 'A timed-out sequence cannot complete');
assert.equal(sequence('a', 3100), false);
assert.equal(sequence('c', 3200), false);
assert.equal(sequence('x', 3300), false);
assert.equal(sequence('s', 3400), false);
assert.equal(sequence('x', 3500), false, 'Other keys interrupt the sequence');
assert.equal(sequence('X', 3600), false, 'A repeated first key begins a new sequence');
assert.equal(sequence('C', 3700), false);
assert.equal(sequence('X', 3800), false);
assert.equal(sequence('S', 3900), false);
assert.equal(sequence('X', 4000), true, 'Caps Lock is supported');
assert.equal(sequence('x', 4100), false);
assert.equal(sequence('', 4200), false);
assert.equal(sequence('c', 4300), false);
assert.equal(sequence('x', 4400), false);
assert.equal(sequence('s', 4500), false);
assert.equal(sequence('x', 4600), false, 'Blur and editing can cancel a partial sequence');

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
