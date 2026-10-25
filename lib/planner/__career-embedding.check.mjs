/**
 * The career matcher (career-embedding.ts): the course vectors, the goal by
 * meaning, and what it may and may not change on a board.
 *
 *   node --experimental-strip-types lib/planner/__career-embedding.check.mjs
 *
 * Runs without the model: the goals' vectors are in
 * __career-embedding.goals.json, made with the 8-bit model the browser runs
 * (scripts/career/benchmark.mjs embed). Pinned:
 *   - both schools' vector files: the model, 384 numbers, one row a code,
 *     undergraduate courses only, under 3 MiB;
 *   - a course's own vector finds that course first; "undecided" is no goal
 *     to match; "dentist" is placed nowhere (the model's limit, pinned);
 *   - the goal's name for the reason line, the variety and level points;
 *   - an Illinois Psychology freshman who wants to be a UX designer: goal picks
 *     by meaning, each saying so ("Closest to your goal (UX designer): ..."),
 *     no two near-identical, and the degree's requirements as met as with
 *     the matcher off; a Computer Science freshman who wants to be a
 *     software engineer gets no Materials Science goal pick;
 *   - with the matcher off the board is the board built without it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`));

let failed = 0;
const check = (ok, label, detail = '') => {
  if (ok) console.log(`ok   ${label}`);
  else { failed += 1; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};
const E = await import(join(HERE, 'career-embedding.ts'));
const { saysGoalMatch } = await import(join(HERE, 'quality.ts'));
const { goalReasonOf } = await import(join(HERE, 'goal-words.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const level = (code) => Number.parseInt(code.match(/(\d{3})/)?.[1] ?? '0', 10);
const goals = new Map(JSON.parse(readFileSync(join(HERE, '__career-embedding.goals.json'), 'utf8')).map((g) => [g.label, g]));

// ---- the vector files --------------------------------------------------------
const vectors = {};
for (const school of ['illinois', 'uga']) {
  const meta = read(`${school}/course-vectors.json`);
  const binPath = join(PUBLIC, school, 'course-vectors.bin');
  const bytes = statSync(binPath).size;
  check(meta.model === E.CAREER_MODEL && meta.dims === 384 && bytes === meta.codes.length * 384 && meta.scales.length === meta.codes.length,
    `${school}: ${meta.codes.length} course vectors, ${E.CAREER_MODEL} x 384, ${(bytes / 1048576).toFixed(2)} MiB`);
  check(bytes < 3 * 1048576, `${school}: the vector file is under 3 MiB`);
  check(meta.codes.every((c) => level(c) > 0 && level(c) < 500) && new Set(meta.codes).size === meta.codes.length, `${school}: undergraduate courses only, each once`);
  vectors[school] = E.courseVectorsFrom(meta, readFileSync(binPath));
}

// ---- the goal by meaning ----------------------------------------------------
{
  const v = vectors.illinois;
  const i = v.index.get('CS 225');
  const own = Array.from({ length: 384 }, (_, k) => v.bytes[i * 384 + k] * v.scales[i]);
  const fit = E.careerFitFor({ text: 'data structures', vector: own, school: 'Illinois' }, v);
  check(fit.strength('CS 225') === 1 && /^closest to your goal \(data structures\): 1st of [\d,]+ Illinois courses by meaning$/.test(fit.reasonFor('CS 225') ?? ''),
    `a course's own vector finds it first: "${fit.reasonFor('CS 225')}"`);
  check(fit.covers('CS 225') && !fit.covers('CS 598'), 'graduate courses have no vector (they keep word matching)');
  check(goals.get('undecided').query === '' && goals.get('undecided').vector === null && E.goalQuery("I'm not sure yet, maybe nursing") === 'maybe nursing',
    `"${goals.get('undecided').text}" is no goal to match; "I'm not sure yet, maybe nursing" reads "${E.goalQuery("I'm not sure yet, maybe nursing")}"`);
  check(E.goalQuery('I want to be a dentist.') === 'dentist' && E.goalQuery('I want to work in marketing') === 'marketing', 'the model reads the goal without "I want to be a"');
  // The model knows too little about dentistry to place it: its nearest
  // Illinois course is UKR 201 at 0.29, under the 0.30 floor, so nothing is
  // picked by meaning (the pre-dental track still books its courses).
  const dentist = E.careerFitFor(goals.get('dentist'), v);
  const dentistCount = v.codes.filter((c) => dentist.strength(c) > 0).length;
  check(dentistCount === 0, `dentist: no course close enough by meaning (${dentistCount})`);
  const ux = E.careerFitFor(goals.get('UX designer'), v);
  const top = [...v.codes].sort((a, b) => ux.similarity(b) - ux.similarity(a)).slice(0, 3);
  const uxCount = v.codes.filter((c) => ux.strength(c) > 0).length;
  check(top.includes('ARTD 317') && uxCount > 50 && uxCount <= Math.round(v.codes.length * 0.02), `UX designer: ${uxCount} goal courses, at most the closest 2%; closest three ${top.join(', ')}`);
  check(saysGoalMatch(`Chosen for: ${ux.reasonFor(top[0])}.`), 'saysGoalMatch reads the meaning reason as a goal match');
}
check(E.goalLabel('I want to be a dentist') === 'dentist' && E.goalLabel("I'd like to work in public policy, maybe law") === 'public policy' && E.goalLabel('I want to become an environmental scientist') === 'environmental scientist',
  `the goal's name: ${['I want to be a dentist', "I'd like to work in public policy, maybe law", 'I want to become an environmental scientist'].map(E.goalLabel).join(' / ')}`);
{
  const fit = E.careerFitFor(goals.get('UX designer'), vectors.illinois);
  const a = vectors.illinois.codes.find((c) => fit.strength(c) > 0);
  check(E.varietyPenalty(fit, a, [a]) === E.VARIETY_POINTS && E.varietyPenalty(fit, a, []) === 0, 'variety: the same course again loses the full four points, an empty board none');
  check(E.progressionPoints(100, 0) === 1.5 && E.progressionPoints(400, 1) === 1.5 && E.progressionPoints(400, 0) === -1.5, 'progression: 100-level first and 400-level last gain, the reverse loses');
}

// ---- boards -----------------------------------------------------------------
const { generatePlan } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const { planMarks } = await import(join(HERE, 'repick.ts'));
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = read('illinois/offerings.json');
applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom && gradeRaw.has(norm(c.gradeFrom))) gradeRaw.set(norm(c.code), gradeRaw.get(norm(c.gradeFrom)));
const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
const sectionsFile = read('illinois/sections.json');
const excellentFile = existsSync(join(PUBLIC, 'illinois', 'excellent.json')) ? read('illinois/excellent.json') : null;
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const season = (meta.term?.term ?? 'fall').toLowerCase();
const context = {
  courses: rows,
  prereqs: new Map(Object.entries(read('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionsFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionsFile.termId, termLabel: sectionsFile.termLabel }])),
  equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))),
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined,
  excellentTerms: excellentFile ? excellentFile.terms : undefined,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offeringsFile.courses)),
  offeringTerms: offeringsFile.terms,
  offeringAliases: offeringsFile.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  languages: read('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (spec, earlier, sameTerm, eq) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, eq),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const summaries = read('illinois/programs.json');
const H4 = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
const FRESH = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };
function board(programId, career, careerFit) {
  const s = summaries.find((p) => p.id === programId);
  for (const r of rows) { r.requirementIds = []; delete r.pathwayRole; }
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [read(`illinois/program/${s.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(s.id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  const program = adapted.programs[0];
  return generatePlan({
    requirements: blocks, context, prior: FRESH, horizon: H4,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId: s.id, degreeTotal: s.totalCredits || program.totalCredits || 120,
    interests: ['', career].join(' '), career, programName: program.name, programCollege: program.college, admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
    ...(careerFit ? { careerFit } : {}),
  });
}
const codesOf = (g) => g.terms.map((t) => t.codes.map(norm).join(',')).join(' | ');
{
  const uxGoal = goals.get('UX designer');
  const fit = E.careerFitFor({ ...uxGoal, school: 'Illinois' }, vectors.illinois);
  const off = board('las/psychology-bslas', uxGoal.text);
  const offAgain = board('las/psychology-bslas', uxGoal.text, undefined);
  check(codesOf(off) === codesOf(offAgain) && JSON.stringify(off.electives) === JSON.stringify(offAgain.electives), 'matcher off: the board is the board built without it');
  const on = board('las/psychology-bslas', uxGoal.text, fit);
  const picks = on.electives.filter((e) => e.forGoal && !e.track);
  const said = picks.filter((e) => e.why.includes('closest to your goal (UX designer)'));
  check(said.length >= 2, `Psychology + UX designer: ${said.length} goal electives by meaning: ${said.map((e) => `${e.code} ${byCode.get(norm(e.code))?.title}`).join('; ')}`);
  check(on.unsatisfied.length <= off.unsatisfied.length && on.notPlaced.length <= off.notPlaced.length, `the degree is as met with the matcher on (unmet ${off.unsatisfied.length} -> ${on.unsatisfied.length}, not placed ${off.notPlaced.length} -> ${on.notPlaced.length})`);
  let closest = 0;
  for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) closest = Math.max(closest, fit.between(norm(picks[i].code), norm(picks[j].code)) ?? 0);
  check(closest < 0.85, `variety: no two goal picks near-identical (closest pair ${closest.toFixed(2)})`);
  const marks = planMarks({ pools: on.pools, language: on.language, electives: on.electives, genEdPicks: on.genEdPicks ?? [], addedPrerequisites: on.addedPrerequisites }, new Map(rows.map((c) => [norm(c.code), c])));
  const course = rows.find((c) => norm(c.code) === norm(said[0]?.code ?? ''));
  const mark = course ? marks.get(course.id) : undefined;
  const line = course ? goalReasonOf(course, mark, { career: uxGoal.text, interests: uxGoal.text }, fit) : null;
  check(/^Closest to your goal \(UX designer\): \d+(st|nd|rd|th) of [\d,]+ Illinois courses by meaning$/.test(line ?? ''), `the card says why: "${line}"`);
}
{
  const g = goals.get('software engineer');
  const fit = E.careerFitFor({ ...g, school: 'Illinois' }, vectors.illinois);
  const on = board('engineering/computer-science-bs', g.text, fit);
  const mse = on.electives.filter((e) => e.forGoal && /^MSE /.test(norm(e.code)));
  check(mse.length === 0, `CS + software engineer: no Materials Science goal pick (${mse.map((e) => e.code).join(', ') || 'none'})`);
}

console.log(failed === 0 ? '\nAll career-embedding checks passed.' : `\n${failed} career-embedding check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
