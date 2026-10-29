/**
 * The planner's free choices are the ones a sensible advisor would suggest
 * (2026-10-28): when the goal and the degree's subjects leave a list, a core
 * area, a gen-ed category or an elective slot open, the pick is a course
 * commonly taken and on this year's schedule, never the alphabet's or a
 * hash's (autoplan.ts freeChoiceSignals). Fails when:
 *
 *   1. one word of the student's goal found in a catalog description makes a
 *      course a goal match: "I want to start my own business" and HIST 2301
 *      ("from the start of the written record"), "law school" and RUSS 3160
 *      ("judicial") (quality.ts);
 *   2. a UGA freshman's core picks are not on the 2026-27 Schedule of
 *      Classes, are taken by fewer than 100 students a year (but a Terry
 *      student's MATH 2200, the calculus Terry asks for), are an honors
 *      version, or are tied by the alphabet (Physical Sciences takes GEOG
 *      1112 Introduction to Weather and Climate, 1,269 a year, not ASTR 1010,
 *      68); a UGA elective runs in a season the schedule does not run it;
 *   3. an Illinois freshman's Composition I is ESL 111 and 112 (the sequence
 *      behind an English placement result) when CMN 111 is on the board, or
 *      Non-Western Cultures is REL 260 (56 students in two and a half years)
 *      rather than a commonly taken course;
 *   4. a list's or a category's card does not say how commonly its pick is
 *      taken and when it runs (commonlyTakenLine, repick.ts planMarks).
 *
 *   node lib/planner/__free-choices.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
      try { return await next(spec + '.tsx', ctx); } catch {}
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, ctx);
  }
`));
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);
const publicJson = (name) => JSON.parse(readFileSync(join(ROOT, 'public', name), 'utf8'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await lib('components/planner/uga-source.tsx');
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
const A = await lib('lib/planner/autoplan.ts');
const Q = await lib('lib/planner/quality.ts');
const CT = await lib('lib/planner/career-tracks.ts');
const R = await lib('lib/planner/repick.ts');
const G = await lib('lib/planner/uga-planning-guidance.ts');
const { DEFAULT_PRIORITIES } = await lib('lib/planner/priorities.ts');

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const byCode = new Map(data.courses.map((c) => [norm(c.code), c]));

// ---------------------------------------------------------------------------
console.log('1. One word in a catalog description is not a goal match');
for (const [goal, code] of [['I want to start my own business', 'HIST 2301'], ['law school', 'RUSS 3160'], ['sports marketing', 'GRMN 2500']]) {
  const c = byCode.get(code);
  const profile = CT.interestProfile(goal);
  const q = Q.scoreQuality({ code, title: c.title, description: c.description, cluster: c.cluster, tags: c.tags, credits: c.credits }, {
    priorities: DEFAULT_PRIORITIES, interestWords: Q.interestWordsFrom(goal), curatedWords: profile.words, interestSubjects: new Set(profile.subjects), interestCourses: new Set(profile.courses),
    primarySubject: 'RMIN', degreeSubjects: new Set(['RMIN']), wantedTags: new Set(), subjectNames: data.context.subjectNames,
  });
  expect(!(q.interest > 0) && !q.reasons.some((r) => r.startsWith(Q.RELEVANCE_REASONS.topics)), `"${goal}" does not make ${code} ${c.title} a goal match`, q.reasons.join('; '));
}
{
  const c = byCode.get('ENTR 5510') ?? byCode.get('ENTR 5500');
  const profile = CT.interestProfile('entrepreneurship/startups');
  const q = Q.scoreQuality({ code: c.code, title: c.title, description: c.description, cluster: c.cluster, tags: c.tags, credits: c.credits }, {
    priorities: DEFAULT_PRIORITIES, interestWords: Q.interestWordsFrom('entrepreneurship/startups'), curatedWords: profile.words, interestSubjects: new Set(profile.subjects), interestCourses: new Set(profile.courses),
    primarySubject: 'RMIN', degreeSubjects: new Set(['RMIN']), wantedTags: new Set(), subjectNames: data.context.subjectNames,
  });
  // By its subject, Entrepreneurship, as UGA's schedule names it (QualityInputs.subjectNames).
  expect(q.interest > 0, `"entrepreneurship/startups" still matches ${c.code} ${c.title}`, q.reasons.join('; '));
}

// ---------------------------------------------------------------------------
console.log('2. A UGA freshman\'s core picks are commonly taken and on this year\'s schedule');
const scheduled = data.context.scheduled;
const taken = data.context.taken;
expect(Boolean(scheduled && taken), 'the Schedule of Classes is loaded into the planning context');
const ugaBoard = (id, words = '') => {
  const program = data.programs.find((p) => p.id === id);
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
  const context = { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [id]), {}) };
  const generated = A.generatePlan({
    requirements: loaded.blocks, context, programName: loaded.program.name, programId: id,
    prior: { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 },
    horizon: { startSeason: 'Fall', startYear: 2027, gradSeason: 'Spring', gradYear: 2031, stated: true },
    degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES }, interests: words, career: words,
  });
  return { generated, context, codesIn: (t) => t.courseIds.map((id2) => context.courses.find((c) => c.id === id2)?.code).filter(Boolean) };
};
const CORE = /(?:^|:\s*)(?:ii\. physical sciences|ii\. life sciences|iii\. quantitative reasoning|iv\. world languages|iv\. humanities|v\. social sciences)\b/i;
for (const id of ['93328', '69115', '46524']) {
  const { generated, context, codesIn } = ugaBoard(id);
  const name = data.programs.find((p) => p.id === id)?.name ?? id;
  const corePicks = generated.pools.filter((p) => CORE.test(p.areaLabel)).flatMap((p) => p.picked.map((code) => ({ code, area: p.areaLabel })));
  const off = corePicks.filter((p) => !scheduled.seasons.has(p.code));
  expect(corePicks.length > 0 && off.length === 0, `${name}: every core pick is on the 2026-27 schedule`, off.map((p) => p.code).join(', '));
  // Not MATH 2200 for a Terry student: the calculus Terry's precalculus requirement and its admission read, which a
  // business board takes over MATH 2250 "for Science and Engineering" (autoplan.ts outsiderCost, 2026-10-29).
  const terryCalculus = (code) => code === 'MATH 2200' && /\bBBA$/.test(name);
  const rare = corePicks.filter((p) => (taken.get(p.code) ?? 0) < 100 && !terryCalculus(p.code));
  expect(rare.length === 0, `${name}: every core pick is taken by 100 or more students a year, Terry's calculus aside`, rare.map((p) => `${p.code} (${taken.get(p.code) ?? 0})`).join(', '));
  const board = generated.plan.terms.flatMap((t) => codesIn(t));
  const honors = board.filter((code) => /\(honors\)/i.test(byCode.get(code)?.title ?? ''));
  expect(honors.length === 0, `${name}: no honors version is booked`, honors.join(', '));
  const misplaced = generated.plan.terms.flatMap((t) => codesIn(t).filter((code) => generated.electives.some((e) => e.code === code && !e.track) && scheduled.seasons.has(code) && !scheduled.seasons.get(code).includes(t.season)).map((code) => `${code} in ${t.label}`));
  expect(misplaced.length === 0, `${name}: no elective sits in a season the schedule does not run it`, misplaced.join(', '));
  if (id === '93328') {
    const physical = generated.pools.find((p) => /physical sciences/i.test(p.areaLabel))?.picked ?? [];
    expect(physical.includes('GEOG 1112'), 'Risk Management: Physical Sciences takes GEOG 1112 (1,269 a year), not ASTR 1010 (68)', physical.join(', '));
  }
}

// ---------------------------------------------------------------------------
console.log('3. An Illinois freshman\'s gen-ed picks');
{
  const out = join(mkdtempSync(join(tmpdir(), 'free-choices-')), 'sweep.jsonl');
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/dev/sweep/sweep.mjs'), ROOT, out], {
    env: { ...process.env, SWEEP_IDS: 'aces/aces-undeclared,las/psychology-bslas', SWEEP_GOALS: 'none', SWEEP_LANGS: '2', SWEEP_JOBS: '1', SWEEP_BLOCKS: '0' }, encoding: 'utf8',
  });
  if (r.status !== 0) fail(`the sweep did not run: ${r.stderr?.slice(-400)}`);
  const rows = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const aces = rows.find((x) => x.id === 'aces/aces-undeclared');
  const acesBoard = aces.terms.flatMap((t) => t.codes);
  expect(acesBoard.includes('CMN 111') && acesBoard.includes('CMN 112') && !acesBoard.some((c) => /^ESL /.test(c)), 'ACES Undeclared: Composition I is CMN 111 and CMN 112, beside the CMN 111 its page asks for, not ESL 111 and 112', acesBoard.join(' '));
  const grades = new Map(publicJson('illinois/grades.json').map((g) => [norm(g.code), g.n]));
  for (const row of rows) {
    const board = row.terms.flatMap((t) => t.codes);
    expect(!board.includes('REL 260') && !board.includes('PORT 150'), `${row.name}: no REL 260 or PORT 150 (56 and 81 students in two and a half years)`, board.join(' '));
    // The category picks: a free elective slot of thirty-one (ACES Undeclared) takes what the subject caps leave.
    const electives = new Set((row.electiveWhy ?? []).map((w) => w.split(':')[0]));
    const small = board.filter((c) => !electives.has(c) && grades.has(c) && grades.get(c) < 60 && !/^(ACES|PSYC|SPAN) /.test(c));
    expect(small.length === 0, `${row.name}: no category pick outside the degree with under 60 students graded in two and a half years`, small.join(', '));
  }
}

// ---------------------------------------------------------------------------
console.log('4. A list\'s pick says how commonly it is taken and when it runs');
{
  const line = A.commonlyTakenLine(data.context, 'GEOG 1112');
  expect(/^About 1,300 students a year take it \(UGA's Schedule of Classes, Spring 2026 to Fall 2026\); it runs every fall and spring\.$/.test(line ?? ''), 'GEOG 1112: "About 1,300 students a year take it (UGA\'s Schedule of Classes, Spring 2026 to Fall 2026); it runs every fall and spring."', line);
  expect(/not on the Schedule of Classes/.test(A.commonlyTakenLine(data.context, 'HIST 2301') ?? ''), 'HIST 2301: not on the Schedule of Classes from Spring 2026 to Summer 2027', A.commonlyTakenLine(data.context, 'HIST 2301'));
  const { generated } = ugaBoard('93328');
  const marks = R.planMarks({ pools: generated.pools, language: generated.language, electives: generated.electives, genEdPicks: generated.genEdPicks ?? [], addedPrerequisites: generated.addedPrerequisites }, data.byCode, (code) => A.commonlyTakenLine(data.context, code));
  const geog = marks.get(byCode.get('GEOG 1112')?.id);
  expect(geog?.kind === 'pool' && /About 1,300 students a year take it/.test(geog.detail), 'the GEOG 1112 card says so', geog?.detail);
  const plain = R.planMarks({ pools: generated.pools, language: generated.language, electives: generated.electives, genEdPicks: generated.genEdPicks ?? [], addedPrerequisites: generated.addedPrerequisites }, data.byCode);
  expect(!/students a year/.test(plain.get(byCode.get('GEOG 1112')?.id)?.detail ?? ''), 'and without the facts the card reads as before');
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
