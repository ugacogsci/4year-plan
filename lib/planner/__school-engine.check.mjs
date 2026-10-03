/** School policies and cross-campus merge regressions, independent of snapshot updates. */
import assert from 'node:assert/strict';
import { register } from 'node:module';

const root = new URL('../../', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
  const root = ${JSON.stringify(root)};
  export async function resolve(spec, context, next) {
    if (spec.startsWith('@/')) spec = root + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$/.test(spec)) {
      try { return await next(spec + '.ts', context); } catch {}
    }
    return next(spec, context);
  }
`));

const { generatePlan, electiveOptions, courseIdFor, degreeSubjects } = await import('./autoplan.ts');
const { livePools, poolShortfalls } = await import('../../components/planner/live-pools.ts');
const { areaProgress } = await import('./scheduler.ts');

const course = (code, credits = 3) => ({
  id: courseIdFor(code), code, title: `Course ${code}`, credits, description: '',
  cluster: code.split(' ')[0], requirementIds: [], prerequisites: [],
  offeredIn: ['Fall', 'Spring'], format: 'In person', tags: [],
});
const req = (id, rule) => ({ id, areaId: id, areaLabel: id, label: id, hours: null, hoursMax: null, url: 'https://example.edu/catalog', rule });
const choices = (codes) => codes.map((code) => ({ codes: [code], credits: 3 }));
const horizon = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2027, stated: true };
const prior = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0 };
const build = (input) => generatePlan({ prior, horizon, preferences: { credits: { min: 0, target: 6, max: 18 } }, ...input });
const codes = (plan) => plan.terms.flatMap((term) => term.codes);

// A single course occurring in two area lists cannot satisfy two distinct-area selections.
const context = { schoolId: 'uga', courses: ['ARTI 2000', 'LING 2000', 'PHIL 2000'].map((code) => course(code)) };
const constraint = {
  text: 'Two different areas, including six hours from the approved list.', n: 2,
  lists: [{ label: 'A', codes: ['ARTI 2000', 'LING 2000'] }, { label: 'B', codes: ['ARTI 2000', 'PHIL 2000'] }],
  single: false, distinctLists: true, hours: 6, hourCodes: ['ARTI 2000', 'LING 2000', 'PHIL 2000'],
};
const block = req('Major electives', { kind: 'pool', hours: 6, n: 2, choices: choices(context.courses.map((c) => c.code)), lists: constraint.lists, constraints: [constraint], label: 'Major electives' });
const generated = build({ context, requirements: [block], degreeTotal: 6 });
assert.equal(generated.pools[0].constraints[0].met, true);
assert.equal(generated.pools[0].constraints[0].count, 2);
assert.equal(generated.pools[0].constraints[0].hours, 6);
const live = livePools({ base: generated.pools, blocks: [block], boardCodes: ['ARTI 2000'], priorCodes: [], context });
assert.equal(live[0].constraints[0].met, false);
assert.equal(live[0].constraints[0].count, 1);
assert.equal(live[0].constraints[0].hours, 3);
assert(poolShortfalls(live).some((shortfall) => /1 of 2 required selections.*3 of 6/.test(shortfall.message)));

// Generated and replacement choices must collapse UGA delivery variants while respecting a published list.
const electives = { schoolId: 'uga', courses: ['CSCI 1000', 'CSCI 1000E', 'CSCI 1100', 'ARTI 1000'].map((code) => course(code)) };
const plan = { schemaVersion: 1, programId: 'test', graduationLabel: 'Spring 2027', completedCourseIds: [], terms: [{ id: 'fall-2026', label: 'Fall 2026', year: 1, season: 'Fall', courseIds: [courseIdFor('CSCI 1000')] }] };
const options = electiveOptions({ context: electives, requirements: [], prior, plan, termId: 'fall-2026', candidateCodes: new Set(['CSCI 1000E', 'CSCI 1100']) });
assert.deepEqual(options.map((option) => option.code), ['CSCI 1100']);
const keep = electiveOptions({ context: electives, requirements: [], prior, plan, termId: 'fall-2026', including: 'CSCI 1000' });
assert(keep.some((option) => option.code === 'CSCI 1000'), 'a replacement review still ranks its current course');

// UGA's tighter subject caps and breadth menus must not alter Illinois' policy.
const ownCodes = Array.from({ length: 6 }, (_, index) => `PSYC ${1000 + index}`);
const ownContext = { courses: ownCodes.map((code) => course(code)) };
const ownRequirements = [req('Major', { kind: 'all', choices: choices(ownCodes.slice(0, 3)) })];
const occupied = ownCodes.slice(0, 5);
const ownPlan = { ...plan, terms: [{ ...plan.terms[0], courseIds: occupied.map(courseIdFor) }] };
const eligibility = { requirements: ownRequirements, prior, plan: ownPlan, termId: 'fall-2026', electiveCodes: occupied };
assert(electiveOptions({ ...eligibility, context: { ...ownContext, schoolId: 'illinois' } }).some((option) => option.code === ownCodes[5]));
assert(!electiveOptions({ ...eligibility, context: { ...ownContext, schoolId: 'uga' } }).some((option) => option.code === ownCodes[5]));
const breadth = req('Breadth menu', { kind: 'choose', n: 1, choices: choices(Array.from({ length: 31 }, (_, index) => `HIST ${1000 + index}`)) });
assert.equal(degreeSubjects([...ownRequirements, breadth], undefined, 'uga').primary, 'PSYC');
assert.equal(degreeSubjects([...ownRequirements, breadth], undefined, 'illinois').primary, 'HIST');

// A parser gap must remain visible; only explicitly permitted elective hours may be filled.
const gap = build({ context: electives, requirements: [req('Unread requirement', { kind: 'hours', hours: 6, genEd: null, label: 'Unread requirement', source: 'parser-gap' })], degreeTotal: 9, electiveHoursLimit: 3 });
assert.equal(gap.credits.planned.min, 3);
assert(gap.unsatisfied.some((row) => row.reason === 'no-course-data' && /incomplete/.test(row.message)));
assert(gap.notes.some((note) => /stops here/.test(note)));

// Graduate admission does not add undergraduate prerequisites to the graduate program of study.
const gradContext = {
  schoolId: 'uga', courses: ['CSCI 1301', 'CSCI 6000'].map((code) => course(code)),
  prereqs: new Map([['CSCI 6000', { text: 'CSCI 1301', parsed: true, groups: [{ any: ['CSCI 1301'], concurrent: false, confidence: 'high' }] }]]),
};
const grad = build({ context: gradContext, requirements: [req('Graduate core', { kind: 'all', choices: choices(['CSCI 6000']) })], electiveLevelRange: { min: 600, maxExclusive: 1000 }, autoPrerequisiteLevelRange: { min: 600, maxExclusive: 1000 }, degreeTotal: 3 });
assert(codes(grad).includes('CSCI 6000'));
assert(!codes(grad).includes('CSCI 1301'));
assert.equal(grad.addedPrerequisites.length, 0);

// UGA allows cross-area overlap, while Illinois' default still spends each course once.
const area = (id) => ({ id, label: id, hours: 3, groups: [{ label: id, choose: null, courses: [{ code: 'MATH 1113', credits: 3 }] }] });
const program = { areas: [area('Core'), area('Major')] };
assert.deepEqual(areaProgress(program, new Set(['MATH 1113'])).map((row) => row.earned), [3, 0]);
assert.deepEqual(areaProgress(program, new Set(['MATH 1113']), undefined, { allowCrossAreaOverlap: true }).map((row) => row.earned), [3, 3]);

console.log('School engine checks passed: distinct areas + hours, live recount, variant/list filtering, school caps and breadth, parser-gap limits, graduate prerequisites, and school overlap.');
