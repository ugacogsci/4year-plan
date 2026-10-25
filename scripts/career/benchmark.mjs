#!/usr/bin/env node
/**
 * The career matcher against today's word matching: twenty goals, two
 * majors at each school, the same freshman, built both ways.
 *
 *   node scripts/career/benchmark.mjs embed <goals.json> [label...]
 *       the goals' vectors, with the 8-bit model the browser runs
 *       (public/career-model, scripts/career/browser-assets.mjs); with
 *       labels, only those goals (of GOALS and CHECK_GOALS), as
 *       lib/planner/__career-embedding.goals.json holds them
 *   node scripts/career/benchmark.mjs illinois <goals.json> <out.jsonl>
 *       Illinois boards, words and meaning (the UGA boards come from
 *       scripts/dev/uga-harness.mjs with HARNESS_GOALS, HARNESS_MEANING)
 *   node scripts/career/benchmark.mjs report <illinois.jsonl> <uga-words.jsonl> <uga-meaning.jsonl> <out.md>
 *       the goal picks side by side, and every board whose degree got worse
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const LIB = join(ROOT, 'lib/planner');
const [mode, ...args] = process.argv.slice(2);

export const GOALS = [
  ['dentist', 'I want to be a dentist'],
  ['software engineer', 'I want to be a software engineer'],
  ['data scientist', 'I want to be a data scientist'],
  ['nurse', 'I want to be a nurse'],
  ['lawyer', 'I want to be a lawyer'],
  ['financial analyst', 'I want to be a financial analyst'],
  ['marketing', 'I want to work in marketing'],
  ['teacher', 'I want to be a teacher'],
  ['therapist', 'I want to be a therapist'],
  ['environmental scientist', 'I want to be an environmental scientist'],
  ['mechanical engineer', 'I want to be a mechanical engineer'],
  ['physical therapist', 'I want to be a physical therapist'],
  ['journalist', 'I want to be a journalist'],
  ['UX designer', 'I want to be a UX designer'],
  ['accountant', 'I want to be an accountant'],
  ['veterinarian', 'I want to be a veterinarian'],
  ['sports management', 'I want to work in sports management'],
  ['public policy', 'I want to work in public policy'],
  ['game developer', 'I want to be a game developer'],
  ['undecided', "I'm undecided about what I want to do"],
];
/** More goals for lib/planner/__career-embedding.check.mjs, not in the benchmark. */
const CHECK_GOALS = [
  ['Spanish teacher', 'I want to be a Spanish teacher'],
  ['translator', 'I want to be a translator'],
];
const ILLINOIS = ['las/psychology-bslas', 'engineering/computer-science-bs'];

if (mode !== 'report' && !process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), mode, ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`));
if (mode === 'embed') {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = join(PUBLIC, 'career-model/models/');
  const t0 = Date.now();
  const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32', model_file_name: 'model_int8w' });
  const loaded = Date.now() - t0;
  const { goalQuery } = await import(join(LIB, 'career-embedding.ts'));
  const out = [];
  const t1 = Date.now();
  const wanted = args.slice(1);
  for (const [label, text] of wanted.length ? [...GOALS, ...CHECK_GOALS].filter(([label]) => wanted.includes(label)) : GOALS) {
    // As the browser does (career-embedding-browser.ts): the goal without its framing, none for "undecided".
    const query = goalQuery(text);
    const v = query ? await fe(query, { pooling: 'mean', normalize: true }) : null;
    out.push({ label, text, query, vector: v ? Array.from(v.data, (x) => Number(x.toFixed(6))) : null });
  }
  writeFileSync(args[0], JSON.stringify(out));
  console.log(`model loaded in ${loaded} ms; ${out.length} goals embedded in ${Date.now() - t1} ms (${((Date.now() - t1) / out.length).toFixed(0)} ms each)`);
  process.exit(0);
}

if (mode === 'report') {
  const [illFile, ugaWords, ugaMeaning, outFile] = args;
  const rows = [];
  for (const line of readFileSync(illFile, 'utf8').split('\n').filter(Boolean)) rows.push(JSON.parse(line));
  const uga = (file, how) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind?.startsWith('goal:')).map((r) => ({
    school: 'uga', program: r.name, goal: r.kind.slice(5), mode: how, scope: r.careerScope ?? null, picks: r.goalPicks ?? [], unsatisfied: (r.unsatisfied ?? 0) + (r.unmetRows ?? 0), notPlaced: typeof r.notPlaced === 'number' ? r.notPlaced : (r.notPlaced ?? []).length, error: r.ok === false ? r.error : null,
  }));
  rows.push(...uga(ugaWords, 'words'), ...uga(ugaMeaning, 'meaning'));
  const key = (r) => `${r.school}|${r.program}|${r.goal}`;
  const pairs = new Map();
  for (const r of rows) {
    const p = pairs.get(key(r)) ?? {};
    p[r.mode] = r;
    pairs.set(key(r), p);
  }
  const short = (p) => `${p.code}${p.kind === 'gened' ? '*' : p.kind === 'track' ? '+' : ''} ${p.title}`.slice(0, 48);
  const lines = ['# Career matcher benchmark', '', 'Made by `scripts/career/benchmark.mjs` (see docs/career-system.md). An incoming freshman, the same board built with today\'s word matching and with the career matcher; the goal picks only (electives, and `*` a general education pick the goal ordered). Career-track courses are left out: they are booked the same way both times. "unmet" is the requirements the engine leaves unmet, plus at UGA the audit rows the board bar shows; "not placed" the required courses with no room. "The matcher ranked" says which free choices it ranked after the degree check (all, electives only, or none).', ''];
  const worse = [];
  for (const [k, p] of pairs) {
    const [school, program, goal] = k.split('|');
    if (!p.words || !p.meaning) { lines.push(`- ${k}: missing a side`); continue; }
    const w = p.words.picks.filter((x) => x.kind !== 'track');
    const m = p.meaning.picks.filter((x) => x.kind !== 'track');
    if (p.meaning.unsatisfied > p.words.unsatisfied || p.meaning.notPlaced > p.words.notPlaced) worse.push(`${k}: unmet ${p.words.unsatisfied} -> ${p.meaning.unsatisfied}, not placed ${p.words.notPlaced} -> ${p.meaning.notPlaced}`);
    lines.push(`## ${school === 'uga' ? 'UGA' : 'Illinois'} · ${program} · ${goal}`, '', `degree: unmet ${p.words.unsatisfied} -> ${p.meaning.unsatisfied}, not placed ${p.words.notPlaced} -> ${p.meaning.notPlaced}; the matcher ranked: ${p.meaning.scope ?? 'nothing (no goal)'}`, '', '| words (today) | meaning (career matcher) |', '|---|---|');
    for (let i = 0; i < Math.max(w.length, m.length, 1); i++) lines.push(`| ${w[i] ? short(w[i]) : ''} | ${m[i] ? short(m[i]) : ''} |`);
    const reason = p.meaning.picks.find((x) => /closest to your goal/i.test(x.why))?.why.match(/closest to your goal[^.;]*/i)?.[0];
    if (reason) lines.push('', `reason line: "${reason}"`);
    lines.push('');
  }
  lines.splice(4, 0, `Boards: ${pairs.size}. Degree worse with the matcher on: ${worse.length}.`, ...worse.map((x) => `- ${x}`), '');
  writeFileSync(outFile, lines.join('\n'));
  console.log(`${pairs.size} boards; worse: ${worse.length}`);
  process.exit(0);
}

if (mode !== 'illinois') {
  console.error('usage: benchmark.mjs embed <goals.json> | illinois <goals.json> <out.jsonl> | report <ill.jsonl> <uga-words.jsonl> <uga-meaning.jsonl> <out.md>');
  process.exit(2);
}
const { generatePlan } = await import(join(LIB, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(LIB, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(LIB, 'illinois-load.ts'));
const { PRIORITY_PRESETS } = await import(join(LIB, 'priorities.ts'));
const E = await import(join(LIB, 'career-embedding.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
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
const vectors = E.courseVectorsFrom(read('illinois/course-vectors.json'), readFileSync(join(PUBLIC, 'illinois/course-vectors.bin')));
const goals = JSON.parse(readFileSync(args[0], 'utf8'));
// The career pathways the goal is read with (as the browser loads them); BENCH_PATHWAYS=0 reads the goal alone.
const pathways = process.env.BENCH_PATHWAYS !== '0' && existsSync(join(PUBLIC, 'career-pathways.json')) ? E.pathwayVectorsFrom(read('career-pathways.json')) : undefined;

/** One freshman board, as the workspace builds it: interests [studying, career], career the goal. */
export function illinoisBoard(programId, career, careerFit) {
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
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'benchmark' },
    ...(careerFit ? { careerFit } : {}),
  });
}

const out = [];
const started = Date.now();
let built = 0;
for (const programId of ILLINOIS) {
  const programName = summaries.find((p) => p.id === programId)?.name ?? programId;
  for (const g of goals) {
    for (const how of ['words', 'meaning']) {
      const fit = how === 'meaning' && g.vector ? E.careerFitFor({ text: g.text, vector: g.vector, label: g.label, school: 'Illinois', ...(pathways ? { pathways } : {}) }, vectors) : undefined;
      const t0 = Date.now();
      const plan = illinoisBoard(programId, g.text, fit);
      built += 1;
      const picks = [
        ...plan.electives.filter((e) => e.forGoal || e.track).map((e) => ({ code: e.code, title: byCode.get(norm(e.code))?.title ?? '', why: e.why, kind: e.track ? 'track' : 'elective' })),
        ...(plan.genEdPicks ?? []).filter((x) => x.forGoal).map((x) => ({ code: x.code, title: byCode.get(norm(x.code))?.title ?? '', why: x.label, kind: 'gened' })),
      ];
      out.push(JSON.stringify({ school: 'illinois', program: programName, goal: g.label, mode: how, ms: Date.now() - t0, scope: plan.careerScope ?? null, picks, unsatisfied: plan.unsatisfied.length, notPlaced: plan.notPlaced.length, codes: plan.terms.flatMap((t) => t.codes).length }));
    }
  }
}
writeFileSync(args[1], out.join('\n') + '\n');
console.log(`${built} Illinois boards in ${Math.round((Date.now() - started) / 1000)}s`);
