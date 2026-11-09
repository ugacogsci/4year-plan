import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));
const { EMPTY_ANSWERS } = await import('./onboarding.ts');
const { validatedSetupPatch, setupReplySchema, setupWireSchema, fromSetupWire, creditSettled, creditVerdict } = await import('./setup-agent.ts');
const catalog = { undergraduateDegrees: [{ id: '__undecided__', name: 'Undecided' }, { id: 'cogsci', name: 'Cognitive Science AB' }], graduateDegrees: [{ id: 'ai-ms', name: 'AI MS' }], minors: [{ id: 'cs', name: 'Computer Science' }], undergraduateCertificates: [{ id: 'ai', name: 'AI Computing' }], graduateCertificates: [], requirements: [{ id: 'emphases', programId: 'cogsci', label: 'Choose two', minimum: 2, maximum: 2, options: [{ id: 'psych', label: 'Psychology' }, { id: 'ai', label: 'AI' }] }] };
const current = { ...EMPTY_ANSWERS, schoolId: 'uga' };
const patch = { programIds: ['cogsci'], minorIds: ['cs'], certificateIds: ['ai'], academicYear: 'second', graduationSeason: 'Spring', graduationYear: 2029, emphasisSelections: { emphases: ['psych', 'ai'] } };
assert.deepEqual(validatedSetupPatch(current, patch, catalog, [], ['ARTS']), patch);
assert.throws(() => validatedSetupPatch(current, { programIds: ['made-up'] }, catalog, [], ['ARTS']));
assert.throws(() => validatedSetupPatch(current, { programIds: [] }, catalog, [], ['ARTS']));
assert.throws(() => validatedSetupPatch(current, { programIds: ['ai-ms'] }, catalog, [], ['ARTS']));
assert.doesNotThrow(() => validatedSetupPatch(current, { programLevel: 'graduate', programIds: ['ai-ms'] }, catalog, [], ['ARTS']));
assert.throws(() => validatedSetupPatch(current, { ...patch, emphasisSelections: { emphases: ['ai', 'ai'] } }, catalog, [], ['ARTS']));
assert.throws(() => validatedSetupPatch(current, { ...patch, doubleDawgsPathwayId: 'unrelated' }, catalog, [], ['ARTS']));
assert.throws(() => validatedSetupPatch(current, { collegeId: 'fake' }, catalog, [], ['ARTS']));
assert.throws(() => validatedSetupPatch(current, { googleAccount: 'not-allowed' }, catalog, [], ['ARTS']));
assert.equal(setupReplySchema.safeParse({ reply: 'Ready', patch, programConfirmed: true, creditReviewed: true }).success, true);
// Prior credit (2026-11-09): only a choice or courses actually recorded settle it, never a mention of credit.
assert.equal(creditSettled('none', undefined), true);
assert.equal(creditSettled('later', undefined), true);
assert.equal(creditSettled('listed', ['BIOL 1107']), true);
assert.equal(creditSettled('listed', []), false, 'courses named but none recorded');
assert.equal(creditSettled('mentioned', undefined), false, '"I have AP credit for calculus" leaves the reminder');
assert.equal(creditSettled('unknown', undefined), false);
const wirePatch = Object.fromEntries(Object.keys(setupWireSchema.shape.patch.shape).map((key) => [key, null]));
const replyFor = (credit, codes = null, saved = []) => setupReplySchema.safeParse(fromSetupWire({ reply: 'Ok', patch: { ...wirePatch, academicYear: 'first', alreadyTakenCourseCodes: codes }, programConfirmed: false, credit }, saved));
for (const [credit, codes, settled] of [['mentioned', null, false], ['none', null, true], ['listed', ['CHEM 1211'], true], ['listed', null, false], ['later', null, true], ['unknown', null, false]]) {
  assert.equal(setupWireSchema.safeParse({ reply: 'Ok', patch: { ...wirePatch, alreadyTakenCourseCodes: codes }, programConfirmed: false, credit }).success, true, `the model may answer credit "${credit}"`);
  const read = replyFor(credit, codes);
  assert.equal(read.success, true, `the browser reads a "${credit}" reply in its old shape`);
  assert.equal(read.data.creditReviewed, settled, `credit "${credit}"${codes ? ' with codes' : ''} -> creditReviewed ${settled}`);
  assert.equal('credit' in read.data, false, 'the reply carries creditReviewed, not credit');
  assert.equal(read.data.creditDeferred, credit === 'later' ? true : undefined, `creditDeferred only for "later" (${credit})`);
}
// Codes saved in an earlier turn count for "listed" (the model returns no new patch on "that's everything").
assert.equal(replyFor('listed', null, ['CSCI 1301']).data.creditReviewed, true, '"listed" with codes saved earlier settles');
assert.equal(replyFor('mentioned', null, ['CSCI 1301']).data.creditReviewed, false, '"mentioned" beside saved codes (an AP exam too) does not');
// A stray word is "unknown": it settles nothing and does not fail the turn.
assert.equal(creditVerdict(' None '), 'none');
assert.equal(creditVerdict('done'), 'unknown');
assert.equal(creditVerdict(undefined), 'unknown');
assert.equal(replyFor('reviewed').data.creditReviewed, false, 'an unknown word settles nothing');
assert.equal(setupWireSchema.safeParse({ reply: 'Ok', patch: wirePatch, programConfirmed: false, creditReviewed: true }).success, false, 'the model no longer sets creditReviewed itself');
console.log('Guided setup: explicit multi-program selection, graduate boundaries, required emphasis IDs, invalid catalog IDs, unknown fields and prior credit settled only by a choice or recorded courses passed.');
