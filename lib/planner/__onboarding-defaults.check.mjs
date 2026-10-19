// node --experimental-strip-types lib/planner/__onboarding-defaults.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));
const { EMPTY_ANSWERS, defaultProgramYears, suggestGraduationTarget, isGraduationTermPast, inferAcademicYear, inferGraduationTarget, timelineForPlanning, setupResponse, withSetupResponse } = await import('./onboarding.ts');
const { searchCourseCatalog } = await import('./course-search.ts');
const { graduateProgramOptions } = await import('./illinois-graduate.ts');

const fall = new Date(2026, 9, 16);
const spring = new Date(2027, 1, 1);
const summer = new Date(2027, 6, 1);
let checked = 0;
for (const [level, degrees, year, now, expected] of [
  ['undergraduate', ['BS'], 'first', fall, ['Spring', 2030]],
  ['undergraduate', ['AB', 'BS'], 'second', fall, ['Spring', 2029]],
  ['undergraduate', ['BS'], 'third', fall, ['Spring', 2028]],
  ['undergraduate', ['BS'], 'fourth', fall, ['Spring', 2027]],
  ['undergraduate', [], 'fifth-plus', fall, ['Spring', 2027]],
  ['undergraduate', [], 'first', spring, ['Spring', 2030]],
  ['undergraduate', [], 'fourth', summer, ['Summer', 2027]],
  ['graduate', ['MS'], 'first', fall, ['Spring', 2028]],
  ['graduate', ['MA'], 'second', fall, ['Spring', 2027]],
  ['graduate', ['Ph.D.'], 'first', fall, ['Spring', 2031]],
  ['graduate', ['PHD'], 'third', fall, ['Spring', 2029]],
  ['graduate', ['MS', 'PhD'], 'second', fall, ['Spring', 2030]],
  ['graduate', ['JD'], 'first', fall, ['Spring', 2029]],
  ['graduate', ['DVM'], 'first', fall, ['Spring', 2030]],
  ['graduate', ['PharmD'], 'first', fall, ['Spring', 2030]],
  ['graduate', ['EDS'], 'first', fall, ['Spring', 2027]],
  ['graduate', [], 'first', fall, ['Spring', 2028]],
]) {
  const target = suggestGraduationTarget(year, defaultProgramYears(level, degrees), now);
  assert.deepEqual([target.season, target.year], expected, JSON.stringify({ level, degrees, year }));
  assert.equal(isGraduationTermPast(target.season, target.year, now), false);
  checked += 1;
}
assert.deepEqual(suggestGraduationTarget('', 4, fall), { season: '', year: null });

const legacy = { ...EMPTY_ANSWERS, studying: 'Psychology and linguistics.', timeline: 'Second year; graduate Spring 2029.', after: 'Work in data science.' };
assert.equal(setupResponse(legacy), 'Psychology and linguistics.\n\nSecond year; graduate Spring 2029.\n\nWork in data science.');
assert.equal(setupResponse(EMPTY_ANSWERS), '');
const response = 'Second year, about 45 credits. I want to graduate Spring 2029, explore psychology, and work in data science.';
const unified = withSetupResponse(legacy, response, fall);
assert.equal(setupResponse(unified), response, 'The unified response is not displayed twice');
assert.equal(unified.after, response, 'Career and interest suggestions receive the response');
assert.equal(unified.studying, '', 'Interest scoring does not duplicate the response');
assert.equal(unified.timelineAt, fall.toISOString());
assert.equal(inferAcademicYear(unified.timeline), 'second');
assert.deepEqual(inferGraduationTarget(unified.timeline), { season: 'Spring', year: 2029 });
assert.equal(setupResponse(withSetupResponse(unified, 'I want to ')), 'I want to ', 'Typing spaces must not trim the controlled input');
assert.equal(setupResponse(withSetupResponse(unified, 'First paragraph.\n\n')), 'First paragraph.\n\n');
assert.equal(setupResponse(withSetupResponse(unified, '')), '');
assert.equal(setupResponse(withSetupResponse(legacy, setupResponse(legacy))), setupResponse(legacy), 'Editing a legacy setup keeps all three answers');
const confirmed = withSetupResponse({ ...legacy, graduationSeason: 'Fall', graduationYear: 2030, programIds: ['96447'], alreadyTakenCourseCodes: ['CSCI 1301'] }, response, fall);
assert.deepEqual(inferGraduationTarget(timelineForPlanning(confirmed)), { season: 'Fall', year: 2030 }, 'Confirmed graduation still wins over prose');
assert.deepEqual(confirmed.programIds, ['96447']);
assert.deepEqual(confirmed.alreadyTakenCourseCodes, ['CSCI 1301']);

const uga = JSON.parse(readFileSync(new URL('../../public/uga-catalog.json', import.meta.url)));
const results = searchCourseCatalog(uga, 'biology intro');
assert(results.some((course) => /introduction to deep learning in biology/i.test(course.title)));
assert.deepEqual(results, searchCourseCatalog(uga, 'INTRO biology'));
const biology = searchCourseCatalog(uga, 'biology');
assert(biology.length > 8, 'All matches are available, not just the first eight');
const held = biology[biology.length - 1];
assert(!searchCourseCatalog(uga, 'biology', new Set([held.code])).includes(held));
assert.deepEqual(searchCourseCatalog(uga, '   '), []);
assert.deepEqual(searchCourseCatalog(uga, 'biology nonexistentword'), []);
const course = { code: 'BIOL 1107', title: 'Principles of Biology I' };
assert.deepEqual(searchCourseCatalog([course], 'biol1107'), [course]);
assert.deepEqual(searchCourseCatalog([course], 'biology 1107'), [course]);
assert.deepEqual(searchCourseCatalog([course], 'biol-1107'), [course]);
assert.deepEqual(searchCourseCatalog([{ code: 'FREN 1', title: 'Etudes francaises' }], 'fran\u00e7aises \u00e9tudes').length, 1);

const graduates = JSON.parse(readFileSync(new URL('../../public/illinois/graduate/programs.json', import.meta.url)));
const options = graduateProgramOptions(Array.isArray(graduates) ? graduates : graduates.programs);
const phd = options.graduateDegrees.find((program) => program.degree?.toUpperCase() === 'PHD');
assert(phd, 'Illinois options retain the catalog degree code');
assert.equal(defaultProgramYears('graduate', [phd.degree]), 5);
console.log(`${checked} graduation scenarios passed; unified setup, legacy answers, catalog search, full results, and Illinois degree metadata passed.`);
