/** Completion must not erase a course's elective-pool credit or duplicate it. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
const root = new URL('../../', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, context, next) {
    if (spec.startsWith('@/')) spec = ${JSON.stringify(root)} + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$/.test(spec)) {
      try { return await next(spec + '.ts', context); } catch {}
    }
    return next(spec, context);
  }
`));
const { livePools, poolShortfalls } = await import('../../components/planner/live-pools.ts');
const { degreeCompletionIssue } = await import('./completion.ts');
const context = { schoolId: 'uga', courses: [
  { id: 'csci1301', code: 'CSCI 1301', credits: 4 },
  { id: 'csci1302', code: 'CSCI 1302', credits: 4 },
] };
const pool = (id, overrides = {}) => ({
  requirementId: id, areaLabel: 'Preferred Course(s)', label: 'Preferred Course(s)', note: '',
  hoursTarget: 3, countTarget: null, hours: 4, count: 1, picked: ['CSCI 1301'],
  fromPriorCredit: [], alternatives: ['CSCI 1302'], listed: 2, available: 2,
  constraints: [], url: 'https://bulletin.uga.edu/', ...overrides,
});
const block = (id) => ({ id, rule: { kind: 'pool', choices: [{ codes: ['CSCI 1301'] }, { codes: ['CSCI 1302'] }], constraints: [] } });
const base = [pool('preferred')];
const blocks = [block('preferred')];
const recount = (boardCodes, priorCodes, pools = base, requirements = blocks) => livePools({ base: pools, blocks: requirements, boardCodes, priorCodes, context });
const scheduled = recount(['CSCI 1301'], []);
const completed = recount([], ['CSCI 1301']);
assert.equal(scheduled[0].hours, 4);
assert.equal(completed[0].hours, 4, 'Marking CSCI 1301 already taken retains its preferred-course requirement credit');
assert.deepEqual(completed[0].picked, []);
assert.deepEqual(completed[0].fromPriorCredit, ['CSCI 1301']);
assert.deepEqual(poolShortfalls(completed), []);
assert.equal(degreeCompletionIssue({ currentCredits: 120, requiredCredits: 120, incompleteRequirementNames: completed.filter((row) => row.hours < row.hoursTarget).map((row) => row.label), termId: 'fall-2026' }), null, 'The completed 120-credit alternative must not acquire a degree-incomplete error');
assert.deepEqual(recount(['CSCI 1301'], []), scheduled, 'Undoing completion restores scheduled pool credit');

const removed = recount([], []);
assert.equal(removed[0].hours, 0);
assert.equal(poolShortfalls(removed)[0].reason, 'hours-short', 'Truly deleting a course still reports the missing requirement');
const duplicate = recount(['CSCI 1301', 'CSCI 1301'], ['csci 1301', 'CSCI 1301']);
assert.equal(duplicate[0].hours, 4);
assert.equal(duplicate[0].count, 1, 'Scheduled and completed copies must not double count');
assert.deepEqual(duplicate[0].picked, []);

const oldPrior = [pool('preferred', { picked: [], fromPriorCredit: ['CSCI 1301'] })];
assert.equal(recount([], ['CSCI 1301'], oldPrior)[0].hours, 4, 'Original exam/transcript credit still counts');
assert.equal(recount([], [], oldPrior)[0].hours, 0, 'Removing original earned credit removes its requirement credit');
assert.deepEqual(recount(['CSCI 1301'], [], oldPrior)[0].picked, ['CSCI 1301'], 'Moving old earned credit back into the schedule keeps its allocation');
const newlyEarned = recount([], ['CSCI 1302']);
assert.equal(newlyEarned[0].hours, 0, 'New earned credit without a recorded pool allocation must not be spent a second time');
const namedElsewhere = { id: 'required-core', rule: { kind: 'all', choices: [{ codes: ['CSCI 1302'] }] } };
assert.equal(recount([], ['CSCI 1302'], base, [...blocks, namedElsewhere])[0].hours, 0, 'Credit held for a named non-pool requirement must not be reassigned to an overlapping pool');
assert.equal(recount(['CSCI 1302'], ['CSCI 1302'], base, [...blocks, namedElsewhere])[0].hours, 0, 'A stale scheduled copy cannot reassign non-pool earned credit either');

const overlapping = [pool('earlier', { picked: [], hours: 0, count: 0 }), pool('owner')];
const overlapBlocks = [block('earlier'), block('owner')];
const owned = recount([], ['CSCI 1301'], overlapping, overlapBlocks);
assert.deepEqual(owned.map((row) => row.hours), [0, 4], 'Completion preserves the original owner instead of moving credit to an earlier overlapping pool');
const repeatedAllocation = recount(['CSCI 1301'], ['CSCI 1301'], [pool('earlier'), pool('owner', { fromPriorCredit: ['CSCI 1301'] })], overlapBlocks);
assert.equal(repeatedAllocation.reduce((sum, row) => sum + row.hours, 0), 4, 'A duplicated report cannot allocate the same course to two pools');
const freshAllocation = recount([], ['CSCI 1302'], overlapping, overlapBlocks);
assert.deepEqual(freshAllocation.map((row) => row.hours), [0, 0], 'Unallocated prior credit waits for a rebuild to resolve its requirement ownership');
assert.deepEqual(base[0].picked, ['CSCI 1301'], 'The generation report remains immutable');
console.log('Live pool checks passed: planned-to-earned completion, undo/removal, original earned credit, duplicate suppression, stable cross-pool ownership, non-pool credit protection, and degree-completion consistency.');
