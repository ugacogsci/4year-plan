/**
 * Prior credit, on the browser path: AP only, an Illinois transcript plus AP,
 * a sophomore transfer with sixty hours, a held cross-listed twin, another
 * school's codes, an unscored exam, the half-credit degree, and MATH 234 into
 * a degree that requires MATH 221.
 *
 * Built the way __credit-rules.check.mjs builds its context, from the shipped
 * artifacts, with prior credit read the way the workspace reads it. Each
 * scenario prints what the student would see and lists PROBLEMS: a held course
 * booked again, a course booked that a held course excludes (unless the plan
 * itself forfeited the held course), the same class under two codes, or a
 * course placed twice. Exits non-zero on any of them.
 *
 * Every one of these was found wrong at least once on 2026-09-20: MATH 220
 * from AP read as "does not count with MATH 221", a transfer's held
 * prerequisites pushed their dependents a term late, ACCY 301 landed in a
 * first term because its prerequisite sentence carried a recommendation.
 *
 *   node lib/planner/__prior-credit.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));
const { generatePlan, validatePlan, describeCreditTotal, describeCreditProgress } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow } = await import(join(HERE, 'illinois-load.ts'));
const { applyExamCredit } = await import(join(HERE, 'onboarding.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const prereqs = new Map(Object.entries(read('illinois/prereqs.json')));
const exclusions = new Map(Object.entries(read('illinois/exclusions.json')));
const grades = new Map(); for (const g of read('illinois/grades.json')) grades.set(norm(g.code), toGradeRow(g, byCode.get(norm(g.code))?.title ?? g.code, []));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const context = { courses: rows, prereqs, grades, sections: new Map(), equivalents: equivalents.size ? equivalents : undefined, exclusions, creditRanges, bands: meta.bands, offeringPublished: new Set(), snapshotTerm: null, prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q) };
const table = read('illinois-exam-credit.json').entries;
const COURSE_CODE = /^[A-Z]{2,5} \d{3}$/;
const CODE_IN_TEXT = /\b([A-Z]{2,4})\s?(\d{3})\b/g;
function examCourses(exams) { return applyExamCredit(exams, table).creditCourses.filter((c) => COURSE_CODE.test(c)); }
function examElectiveHours(exams) { let h = 0; for (const t of exams) { const row = table.find((e) => e.kind === t.kind && e.exam === t.exam && String(e.score) === String(t.score) && (e.level ?? null) === (t.level ?? null)); if (!row || row.noCredit || row.credits <= 0) continue; if (row.courses.some((c) => COURSE_CODE.test(c))) continue; h += row.credits; } return h; }
function readPriorCredit(transferText, examCount, also, saidMore = false, unmatchedCredits = 0) {
  const found = new Set(also.map(norm)); const said = transferText.trim().length > 0 || examCount > 0 || saidMore;
  for (const m of transferText.toUpperCase().matchAll(CODE_IN_TEXT)) { const code = `${m[1]} ${m[2]}`; if (byCode.has(code)) found.add(code); }
  return { courseCodes: [...found], exemptCodes: [], unmatchedCredits, known: !said || found.size > 0 || unmatchedCredits > 0 };
}
const summaries = read('illinois/programs.json');
function load(id) { const s = summaries.find((p) => p.id === id); const raw = read(`illinois/program/${id}.json`); const a = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [raw] }, new Map(byCode)); return { s, blocks: a.blocks.get(id) ?? [] }; }
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const AP = (exam, score) => ({ kind: 'AP', exam, level: null, score });
const twinsOf = (code) => equivalents.get(code) ?? [];
let totalProblems = 0;

function run(name, programId, { exams = [], transferText = '', transcript = [], saidMore = false } = {}) {
  const { s, blocks } = load(programId);
  const also = [...examCourses(exams), ...transcript];
  const prior = readPriorCredit(transferText, exams.length, also, saidMore || transcript.length > 0, examElectiveHours(exams));
  const r = generatePlan({ requirements: blocks, context, prior, horizon: HORIZON, preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } }, programId, degreeTotal: s.totalCredits ?? null, programName: s.name });
  const planned = r.terms.flatMap((t) => t.codes.map(norm));
  const held = new Set(prior.courseCodes);
  for (const f of r.forfeited ?? []) held.delete(f.held);
  const problems = [];
  for (const c of planned) if (held.has(c)) problems.push(`re-books held ${c}`);
  for (const c of planned) for (const h of held) { if ((exclusions.get(c) ?? []).includes(h) || (exclusions.get(h) ?? []).includes(c)) problems.push(`${c} does not count with held ${h}`); if (twinsOf(c).includes(h)) problems.push(`${c} is the same class as held ${h}`); }
  const seen = new Map(); for (const c of planned) seen.set(c, (seen.get(c) ?? 0) + 1); for (const [c, n] of seen) if (n > 1) problems.push(`${c} placed ${n} times`);
  const issues = validatePlan(r.plan, context, { minimumTermCredits: 12, maxTermCredits: 18 });
  const errors = issues.filter((i) => i.severity === 'error');
  console.log('='.repeat(78)); console.log(`${name}  [${s.name}]`);
  console.log(`  prior: ${prior.courseCodes.length} courses (${prior.courseCodes.join(', ') || 'none'}), ${prior.unmatchedCredits} elective hours, known=${prior.known}`);
  console.log(`  HEADLINE: ${describeCreditProgress(r.credits, s.totalCredits)}`);
  for (const t of r.terms) { console.log(`    ${t.label.padEnd(12)} ${describeCreditTotal(t.credits).padEnd(14)} ${t.codes.join(', ') || 'empty'}`); for (const n of t.notes) if (!/Weighed/.test(n)) console.log(`      ~ ${n}`); }
  for (const u of r.unsatisfied.slice(0, 6)) console.log(`  unsatisfied: ${u.label}: ${u.message.slice(0, 160)}`);
  for (const n of r.notPlaced.slice(0, 6)) console.log(`  not placed: ${n.code}: ${n.message.slice(0, 160)}`);
  for (const n of r.notes.filter((x) => /transcript|exempt|Terms|excluded|not count/i.test(x))) console.log(`  note: ${n}`);
  console.log(`  validator errors: ${errors.length}${errors.length ? ' :: ' + errors.slice(0, 3).map((e) => e.message).join(' | ') : ''}`);
  totalProblems += problems.length;
  console.log(problems.length ? `  *** ${problems.length} PROBLEMS: ${problems.join('; ')}` : '  problems: none');
  return r;
}

run('A. AP only, Grainger CS', 'engineering/computer-science-bs', { exams: [AP('CALCULUS BC - Entering Grainger', 5), AP('PHYSICS C: MECHANICS', 5), AP('PHYSICS C: ELEC & MAG', 5), AP('COMPUTER SCIENCE A', 5), AP('ENGLISH LANGUAGE & COMP', 4), AP('PSYCHOLOGY', 5), AP('ECON MICRO', 5), AP('ECON MACRO', 4), AP('STATISTICS', 4), AP('CHEMISTRY', 5)] });
run('B. Illinois transcript + AP, Accountancy', 'bus/accountancy-bs', { exams: [AP('CALCULUS AB - Entering Any College other than Grainger', 4), AP('ENGLISH LANGUAGE & COMP', 5), AP('PSYCHOLOGY', 5)], transcript: ['ECON 102', 'ECON 103', 'CS 105', 'BUS 101', 'MATH 234', 'CMN 101'] });
run('C. Sophomore transfer, 60 hours, CS', 'engineering/computer-science-bs', { transcript: ['MATH 221', 'MATH 231', 'MATH 241', 'MATH 257', 'PHYS 211', 'PHYS 212', 'CS 124', 'CS 128', 'CS 173', 'CS 225', 'CS 233', 'RHET 105', 'ENG 100', 'CS 101', 'PSYC 100', 'ECON 102', 'STAT 100', 'MUS 130'] });
run('D. Twin held: CS 107, Accountancy + Data Science', 'bus/accountancy-data-science-bs', { transcript: ['CS 107'] });
run('E. Foreign codes only, Psychology', 'las/psychology-bslas', { transferText: 'Two semesters at Georgia State: ENGL 1101, ENGL 1102, MATH 1113, POLS 1101, PSYC 1101' });
run('F. Unscored exam, CS', 'engineering/computer-science-bs', { exams: [{ kind: 'AP', exam: 'CALCULUS BC - Entering Grainger', level: null, score: '' }] });
run('G. Half credits, Mechanical Engineering', 'engineering/mechanical-engineering-bs', {});
run('H. Calc AB 3 (MATH 234) into CS', 'engineering/computer-science-bs', { exams: [AP('CALCULUS AB - Entering Grainger', 3)] });

if (totalProblems > 0) {
  console.log(`\n*** ${totalProblems} problems across the scenarios ***`);
  process.exitCode = 1;
} else {
  console.log('\nno scenario books credit the university will not award');
}
