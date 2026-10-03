/** Saved setup migrations and independent school restoration. */
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, context, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$/.test(spec)) {
    try { return await next(spec + '.ts', context); } catch {}
  }
  return next(spec, context);
}`));

const O = await import('./onboarding.ts');
const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
};
const key = 'fourYear.onboarding.v2';
const legacy = { schoolId: 'illinois', studying: 'Psychology', timeline: 'Spring 2030', after: '', exams: [], transferText: '', languageYears: 4, language: 'French' };
values.set(key, JSON.stringify(legacy));
assert.equal(O.loadAnswers().studying, 'Psychology');
assert.deepEqual(O.loadAnswers('illinois').programIds, [], 'Legacy setups can resume without a newly required major picker');
assert.equal(O.loadAnswers('uga'), null, 'Another school cannot read the old global setup');

const uga = { ...O.EMPTY_ANSWERS, schoolId: 'uga', programIds: ['uga-cs'], alreadyTakenCourseCodes: ['CSCI 1301'], emphasisSelections: { 'uga-cs::track': ['ai'] } };
O.saveAnswers(uga);
assert.equal(O.loadAnswers().schoolId, 'uga');
assert.equal(O.loadAnswers('illinois').languageYears, 4, 'A first UGA save migrates the old Illinois setup before replacing last-used');
assert.deepEqual(O.loadAnswers('uga').alreadyTakenCourseCodes, ['CSCI 1301']);

const illinois = { ...O.loadAnswers('illinois'), programIds: ['las/psychology-bslas'], alreadyTakenCourseCodes: ['PSYC 100'] };
O.saveAnswers(illinois);
assert.equal(O.loadAnswers().schoolId, 'illinois');
assert.deepEqual(O.loadAnswers('uga').emphasisSelections, uga.emphasisSelections);
assert.deepEqual(O.loadAnswers('illinois').alreadyTakenCourseCodes, ['PSYC 100']);
O.saveAnswers(O.loadAnswers('uga'));
assert.equal(O.loadAnswers().schoolId, 'uga');
assert.deepEqual(O.loadAnswers('illinois').programIds, illinois.programIds);

O.clearAnswers('illinois');
assert.equal(O.loadAnswers('illinois'), null);
assert.equal(O.loadAnswers().schoolId, 'uga', 'Resetting Illinois must retain the last-used UGA setup');
O.clearAnswers();
assert.equal(O.loadAnswers(), null);
assert.equal(O.loadAnswers('uga'), null);

window.localStorage.getItem = () => { throw new Error('Storage unavailable'); };
assert.equal(O.loadAnswers('illinois'), null);
assert.doesNotThrow(() => O.saveAnswers(illinois));
assert.doesNotThrow(() => O.clearAnswers('illinois'));
delete globalThis.window;
console.log('Onboarding persistence checks passed: legacy migration, distinct credits/programs, round-trip restoration, scoped reset, blocked storage.');
