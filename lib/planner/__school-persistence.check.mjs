/** School isolation, UGA v3 migration, and full alternative-board round trips. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = pathToFileURL(join(here, '..', '..') + '/').href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, context, next) {
  if (spec.startsWith('@/')) spec = ${JSON.stringify(root)} + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$/.test(spec)) {
    try { return await next(spec + '.ts', context); } catch {}
  }
  return next(spec, context);
}`));
const S = await import('./saved-board.ts');
const memory = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
const plan = (programId, course = 'c1') => ({ schemaVersion: 1, programId, graduationLabel: 'Spring 2030', completedCourseIds: [], terms: [{ id: 'fall-2026', label: 'Fall 2026', year: 1, season: 'Fall', courseIds: [course] }] });
const board = (programId, course) => ({ plan: plan(programId, course), report: null, notes: ['Student-edited alternative'], studentAdded: [course ?? 'c1'], repickedFor: 'balanced', edited: true });
const saved = (schoolId, programId) => ({
  schemaVersion: 4, schoolId, programId, savedAt: '2026-10-02T12:00:00Z', board: board(programId),
  settings: { minimumTermCredits: 12, targetTermCredits: null, careerInterests: '', careerCleared: false, priorities: {}, planShape: S.NO_SHAPE },
});

const storage = memory();
const illinois = saved('illinois', 'las/psychology-bslas');
const uga = { ...saved('uga', 'uga-major'), programIds: ['uga-major', 'uga-major-2'], minorIds: ['uga-minor'], certificateIds: ['uga-cert'], emphasisSelections: { 'uga-major::path': ['analytics'] }, programLevel: 'undergraduate' };
uga.planGroups = [{ id: 'g1', name: 'Options', color: '#345678' }];
uga.plans = [
  { id: 'p1', name: 'Original', groupId: 'g1', plan: uga.board.plan, board: uga.board },
  { id: 'p2', name: 'Summer alternative', groupId: 'g1', plan: plan('uga-major', 'c2'), board: board('uga-major', 'c2') },
];
uga.activePlanId = 'p1';
assert.equal(S.writeSavedBoard(storage, S.serializeBoard(illinois)), true);
assert.equal(S.writeSavedBoard(storage, S.serializeBoard(uga)), true);
assert.equal(S.readSavedBoard(storage, 'illinois').programId, illinois.programId);
const restored = S.readSavedBoard(storage, 'uga');
assert.deepEqual(restored.programIds, uga.programIds);
assert.deepEqual(restored.minorIds, uga.minorIds);
assert.deepEqual(restored.certificateIds, uga.certificateIds);
assert.deepEqual(restored.emphasisSelections, uga.emphasisSelections);
assert.deepEqual(restored.plans.map((tab) => tab.board), uga.plans.map((tab) => tab.board));
assert.equal(restored.activePlanId, 'p1');
assert.equal(S.readSavedBoard(storage, 'other'), null);
storage.setItem(`${S.CHAT_KEY}.illinois`, 'illinois chat');
storage.setItem(`${S.CHAT_KEY}.uga`, 'uga chat');
S.forgetBoard(storage, 'uga');
assert.equal(S.readSavedBoard(storage, 'uga'), null);
assert.equal(S.readSavedBoard(storage, 'illinois').programId, illinois.programId);
assert.equal(storage.getItem(`${S.CHAT_KEY}.uga`), null);
assert.equal(storage.getItem(`${S.CHAT_KEY}.illinois`), 'illinois chat');

const legacyStorage = memory();
const legacy = { ...uga, schemaVersion: 3, plan: uga.board.plan, minimumTermCredits: 9, targetTermCredits: 9, careerInterests: 'research', programLevel: 'graduate' };
delete legacy.board;
delete legacy.settings;
legacyStorage.setItem(S.LEGACY_BOARD_KEY, JSON.stringify(legacy));
assert.equal(S.writeSavedBoard(legacyStorage, S.serializeBoard(illinois)), true);
assert.notEqual(legacyStorage.getItem(S.LEGACY_BOARD_KEY), null, 'Illinois must not delete the still-unmigrated UGA v3 save');
const migrated = S.readSavedBoard(legacyStorage, 'uga');
assert.equal(migrated.settings.minimumTermCredits, 9);
assert.equal(migrated.settings.targetTermCredits, 9);
assert.equal(migrated.programLevel, 'graduate');
assert.deepEqual(migrated.programIds, uga.programIds);
assert.equal(migrated.plans.length, 2);
assert.deepEqual(migrated.planGroups, uga.planGroups);
assert.equal(S.writeSavedBoard(legacyStorage, S.serializeBoard(migrated)), true);
assert.equal(legacyStorage.getItem(S.LEGACY_BOARD_KEY), null);
assert.equal(S.readSavedBoard(legacyStorage, 'illinois').programId, illinois.programId);
assert.equal(S.readSavedBoard(legacyStorage, 'uga').plans[1].board.repickedFor, 'balanced');

const dirty = S.parseSavedBoard(JSON.stringify({ ...uga, plans: [uga.plans[0], uga.plans[0], { id: 'broken', name: 'Broken', plan: { terms: [] } }], planGroups: [uga.planGroups[0], uga.planGroups[0], { id: 'bad', name: 'Bad', color: 'red' }] }), 'uga');
assert.equal(dirty.plans.length, 1, 'Malformed and duplicate tabs must be discarded');
assert.equal(dirty.planGroups.length, 1, 'Malformed and duplicate groups must be discarded');
const alternate = {
  id: 'alternative', name: 'Later semester', groupId: 'g1',
  plan: { ...plan('uga-major'), terms: [{ ...plan('uga-major').terms[0], courseIds: ['c1', 'c2'] }] },
  board: { ...board('uga-major'), notes: ['Keep this alternative’s assumptions'], studentAdded: ['c1', 'c2'] },
  issueSeverity: 'warning', issueSummary: 'Old cached warning',
};
alternate.board.plan = alternate.plan;
const reconciled = S.reconcileCompletedTab(alternate, ['c1']);
assert.deepEqual(reconciled.plan.completedCourseIds, ['c1']);
assert.deepEqual(reconciled.plan.terms[0].courseIds, ['c2']);
assert.deepEqual(reconciled.board.notes, alternate.board.notes, 'Alternative provenance survives shared completion');
assert.deepEqual(reconciled.board.studentAdded, ['c2']);
assert.equal(reconciled.issueSeverity, null, 'A changed alternative must not show its stale cached status');
const credits = new Map([['c1', 3], ['c2', 4]]);
const total = (value) => [...value.completedCourseIds, ...value.terms.flatMap((term) => term.courseIds)].reduce((sum, id) => sum + credits.get(id), 0);
assert.equal(total(reconciled.plan), total(alternate.plan), 'Moving earned credit out of the schedule must neither lose nor double count hours');
assert.deepEqual(alternate.plan.terms[0].courseIds, ['c1', 'c2'], 'Synchronization must not mutate an inactive tab or undo snapshot');
assert.equal(S.reconcileCompletedTab(reconciled, ['c1']), reconciled, 'Repeated synchronization is a no-op');
const withAlreadyHeld = S.reconcileCompletedCourses({ ...alternate.board, plan: { ...alternate.plan, completedCourseIds: ['c1'] } }, []);
assert.deepEqual(withAlreadyHeld.plan.terms[0].courseIds, ['c2'], 'Legacy boards cannot schedule a course already marked earned');
assert.equal(S.writeSavedBoard(memory(), '{not json'), false);
assert.equal(S.writeSavedBoard(memory(), JSON.stringify({ schoolId: 'uga', schemaVersion: 5 })), false);
S.forgetBoard(legacyStorage);
assert.equal(S.readSavedBoard(legacyStorage, 'illinois'), null);
assert.equal(S.readSavedBoard(legacyStorage, 'uga'), null);
console.log('School persistence checks passed: isolated boards/chats, both legacy migrations, program selections, per-tab provenance, shared completion without double-counting, invalid entries, scoped reset.');
