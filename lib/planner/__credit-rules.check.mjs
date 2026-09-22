/**
 * Credit rules, audited on the PRODUCT path.
 *
 * Three catalog rules decide whether the hours on a board will count: "May be
 * repeated" (1,095 shipped undergraduate rows), "to a maximum of N hours" (the
 * repeat cap, 638 rows), and a variable credit line (1,829 rows). None of the
 * three is parsed anywhere in this repo, so this file measures what the product
 * does in their absence, the way a student would meet it.
 *
 * Everything is assembled the way components/planner/illinois-source.tsx
 * buildContext assembles it in the browser at the moment the first plan is
 * built: index.json rows through hydrateIndexRow, creditRanges from those rows
 * with known:true, prereqs.json, exclusions.json, NO equivalents (the second
 * load has not landed yet), and each degree adapted from its own
 * program/<id>.json with adaptIllinoisPrograms over the index rows. Not the
 * buildIllinoisData adapter: that path carries a `known:false` flag for courses
 * whose credit line the crawler could not read, and the browser does not, which
 * is exactly the kind of gap __plan-audit.check.mjs exists to catch. The final
 * block runs Mechanical Engineering through the adapter path too, so the
 * disagreement is printed rather than remembered.
 *
 * What it checks, per plannable degree:
 *   DUPLICATE   the same code placed twice by the generator
 *   TWINS       both halves of a cross-listing ("Same as") in one plan; the
 *               registrar awards that credit once
 *   TWIN-PRIOR  the student already holds the twin, and the plan books the
 *               course anyway and counts it
 *   HALFCREDIT  a course whose catalog line is 3.5, 1.5 or 0.5 hours shipped
 *               with any other credit value (it shipped as 0 until the crawler
 *               learned decimals)
 *   REPEAT-REQ  a degree row asking for more hours of a repeatable course than
 *               one placement gives; the board refuses a second placement
 *   UNDERCOUNT  hours the degree page prices on a variable-credit row that the
 *               plan counts at the catalog minimum
 *
 * Ground truth that is not in the shipped data: HALF lists the 12 undergraduate
 * courses whose live catalog line is fractional (read from catalog.illinois.edu
 * on 2026-09-20; scripts/illinois/courses.mjs parseCredits reads whole numbers
 * only). Cross-listings come from the raw catalog's sameAs field, used here as
 * a check and never fed to the product.
 *
 * Exits non-zero on DUPLICATE, TWINS, TWIN-PRIOR or HALFCREDIT, each of which is
 * a board counting hours the university will not award.
 *
 *   node lib/planner/__credit-rules.check.mjs      (about nine minutes)
 *   CREDIT_CHECK_ONLY=engineering/mechanical-engineering-bs node lib/planner/__credit-rules.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

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

const { generatePlan, validatePlan, describeCreditTotal, describeCreditProgress } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, buildIllinoisData, gradeFootnote } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow } = await import(join(HERE, 'illinois-load.ts'));
const { areaProgress } = await import(join(HERE, 'scheduler.ts'));

const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

// ---- the browser's core, as buildContext sees it ----------------------------
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const prereqs = new Map(Object.entries(read('illinois/prereqs.json')));
const exclusions = new Map(Object.entries(read('illinois/exclusions.json')));
const grades = new Map();
for (const g of read('illinois/grades.json')) grades.set(norm(g.code), toGradeRow(g, byCode.get(norm(g.code))?.title ?? g.code, []));
const sectionsFile = read('illinois/sections.json');
const sections = new Map(sectionsFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionsFile.termId, termLabel: sectionsFile.termLabel }]));

const creditRanges = new Map();
for (const course of rows) {
  const max = course.creditsMax ?? course.credits;
  // known:true on every row is what illinois-source.tsx does. Keep it that way
  // here, or this file stops measuring the product.
  creditRanges.set(norm(course.code), { credits: course.credits, min: course.credits, max, variable: max > course.credits, known: true });
}
const season = (meta.term?.term ?? 'fall').toLowerCase();
// Cross-listings ride on the index rows now, and loadIllinoisCore builds the
// same map from them, so the first plan does see them.
const equivalents = new Map();
for (const c of rows) if (c.twins && c.twins.length > 0) equivalents.set(norm(c.code), c.twins.map(norm));
const context = {
  courses: rows,
  prereqs,
  grades,
  sections,
  equivalents: equivalents.size > 0 ? equivalents : undefined,
  exclusions,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote,
  prereqCheck: (spec, earlier, sameTerm, equivalents) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, equivalents),
};

// ---- ground truth for the checks, never handed to the product --------------
const catalog = read('illinois-catalog.json').courses;
const catByCode = new Map(catalog.map((c) => [c.code, c]));
const twinsOf = (code) => (catByCode.get(code)?.sameAs ?? []).filter((t) => byCode.has(norm(t)));
const HALF = new Map([['ME 340', 3.5], ['ME 360', 3.5], ['MSE 404', 1.5], ['MUS 144', 0.5], ['MUS 146', 0.5], ['MUS 147', 0.5], ['MUS 148', 0.5], ['MUS 149', 0.5], ['MUS 151', 0.5], ['MUS 153', 0.5], ['MUS 154', 0.5], ['MUS 155', 0.5]]);
const repeatable = (code) => /may be repeated/i.test(catByCode.get(code)?.description ?? '');

// ---- the degrees the browser offers, filtered the way plannableProgram does --
const UNDERGRAD = /^(AB|BA|BS|BFA|BLA|BMUS|BSLAS|BSW)$/i;
// CREDIT_CHECK_ONLY=engineering/mechanical-engineering-bs limits the run to one degree, for a smoke test.
const only = process.env.CREDIT_CHECK_ONLY ?? null;
const summaries = read('illinois/programs.json').filter((p) => UNDERGRAD.test(p.degree) && p.dataStatus === 'catalog' && p.courseCount > 0 && (!only || p.id === only));
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const NO_PRIOR = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true };
const PREFS = { creditsPerTerm: { min: 12, target: 15, max: 18 } };

function loadProgram(summary) {
  const raw = read(`illinois/program/${summary.id}.json`);
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [raw] }, new Map(byCode));
  return { raw, program: adapted.programs[0], blocks: adapted.blocks.get(summary.id) ?? [] };
}

const totals = { programs: 0, dupInPlan: 0, twinPairsInPlan: 0, halfCreditPlaced: 0, halfCreditPlans: 0, variablePlaced: 0, plansWithRange: 0, pickValueMessages: 0, twinPriorRebooked: 0, twinPriorTested: 0, repeatRowsUnmet: 0, repeatPrograms: 0, uncountedHours: 0, underCountPrograms: 0 };
const lines = [];
const t0 = Date.now();

for (const summary of summaries) {
  let loaded;
  try { loaded = loadProgram(summary); } catch (e) { lines.push(`LOAD FAIL  ${summary.id}: ${e.message}`); continue; }
  const { raw, program, blocks } = loaded;
  if (!program) continue;
  totals.programs += 1;
  const result = generatePlan({ requirements: blocks, context, prior: NO_PRIOR, horizon: HORIZON, preferences: PREFS, programId: summary.id, degreeTotal: summary.totalCredits ?? null, programName: summary.name });
  const placed = [];
  for (const term of result.terms) for (const c of term.codes) placed.push({ code: norm(c), term: term.label, termCredits: term.credits });
  const codes = placed.map((p) => p.code);
  const set = new Set(codes);

  const counts = new Map();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const dups = [...counts].filter(([, n]) => n > 1);
  if (dups.length) { totals.dupInPlan += dups.length; lines.push(`DUPLICATE  ${summary.id}: ${dups.map(([c, n]) => `${c} x${n}`).join(', ')}`); }

  const twinHits = [];
  for (const c of codes) for (const t of twinsOf(c)) if (set.has(norm(t)) && c < norm(t)) twinHits.push(`${c}+${norm(t)}`);
  if (twinHits.length) { totals.twinPairsInPlan += twinHits.length; lines.push(`TWINS      ${summary.id}: ${twinHits.join(', ')}`); }

  const half = placed.filter((p) => HALF.has(p.code) && (creditRanges.get(p.code)?.credits ?? 0) !== HALF.get(p.code));
  if (half.length) {
    totals.halfCreditPlaced += half.length; totals.halfCreditPlans += 1;
    for (const h of half) {
      lines.push(`HALFCREDIT ${summary.id}: ${h.code} in ${h.term} counted as ${creditRanges.get(h.code)?.credits}, catalog says ${HALF.get(h.code)}; term shown as "${describeCreditTotal(h.termCredits)}"`);
    }
    lines.push(`           headline: "${describeCreditProgress(result.credits, summary.totalCredits)}"`);
  }

  totals.variablePlaced += placed.filter((p) => creditRanges.get(p.code)?.variable).length;
  if (result.credits.planned.variable) totals.plansWithRange += 1;
  const issues = validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18 });
  totals.pickValueMessages += issues.filter((i) => i.id.startsWith('ap-variable-')).length;

  const withTwin = placed.find((p) => twinsOf(p.code).length > 0);
  if (withTwin) {
    totals.twinPriorTested += 1;
    const twin = norm(twinsOf(withTwin.code)[0]);
    const again = generatePlan({ requirements: blocks, context, prior: { courseCodes: [twin], exemptCodes: [], unmatchedCredits: 0, known: true }, horizon: HORIZON, preferences: PREFS, programId: summary.id, degreeTotal: summary.totalCredits ?? null, programName: summary.name });
    const againCodes = new Set(again.terms.flatMap((t) => t.codes.map(norm)));
    if (againCodes.has(withTwin.code)) {
      totals.twinPriorRebooked += 1;
      lines.push(`TWIN-PRIOR ${summary.id}: student holds ${twin}, plan still books ${withTwin.code} (same class) and counts it: "${describeCreditProgress(again.credits, summary.totalCredits)}"`);
    }
  }

  const needRepeat = [];
  for (const a of raw.areas ?? []) for (const g of a.groups ?? []) for (const row of g.courses ?? []) {
    const c = catByCode.get(row.code); if (!c || c.credits == null || row.credits == null) continue;
    const cmax = c.creditsMax ?? c.credits;
    if (row.credits > cmax + 0.01 && repeatable(row.code)) needRepeat.push({ code: row.code, page: row.credits, max: cmax });
  }
  if (needRepeat.length) {
    totals.repeatPrograms += 1; totals.repeatRowsUnmet += needRepeat.length;
    const progress = areaProgress(program, set);
    const short = progress.filter((p) => p.area.hours && p.earned < p.area.hours).map((p) => `${p.area.label ?? '(unnamed)'} ${p.earned}/${p.area.hours}`);
    lines.push(`REPEAT-REQ ${summary.id}: ${needRepeat.map((r) => `${r.code} needs ${r.page}h, one placement gives ${r.max}h`).join('; ')} | areas short after plan: ${short.length ? short.join('; ') : 'none'} | unsatisfied: ${result.unsatisfied.length}`);
  }

  let under = 0; const underRows = [];
  for (const a of raw.areas ?? []) for (const g of a.groups ?? []) for (const row of g.courses ?? []) {
    const c = catByCode.get(row.code); if (!c || c.credits == null || row.credits == null) continue;
    const cmax = c.creditsMax ?? c.credits;
    if (cmax > c.credits && row.credits > c.credits && row.credits <= cmax + 0.01 && set.has(norm(row.code))) { under += row.credits - c.credits; underRows.push(`${row.code} page ${row.credits} counted ${c.credits}`); }
  }
  if (under > 0) { totals.uncountedHours += under; totals.underCountPrograms += 1; lines.push(`UNDERCOUNT ${summary.id}: ${under}h the degree page prices that the plan counts at the minimum: ${underRows.join(', ')}`); }
}

console.log(lines.join('\n'));
console.log('='.repeat(78));
console.log(`${totals.programs} degrees planned in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(JSON.stringify(totals, null, 1));

// ---- the adapter path for the same Mechanical Engineering plan ----------------
// Printed so the disagreement between the two paths stays visible: this path
// says "plus 2 courses have no credit hours listed", the browser says nothing.
const me = summaries.find((p) => p.id === 'engineering/mechanical-engineering-bs');
if (me) {
  const data = buildIllinoisData({ catalog: read('illinois-catalog.json'), programs: read('illinois-programs.json'), grades: read('illinois-grades.json'), sections: read('illinois-sections.json') });
  const pre = new Map(); const cr = new Map();
  for (const [code, fact] of data.facts) { if (fact.prereq) pre.set(code, fact.prereq); cr.set(code, fact.creditRange); }
  const ctx2 = { ...context, courses: data.courses, prereqs: pre, creditRanges: cr, grades: data.grades, sections: data.sections, equivalents: data.equivalents, bands: data.bands, gradeFootnote: gradeFootnote(data.gradeProvenance) };
  const r2 = generatePlan({ requirements: data.requirementBlocks.get(me.id) ?? [], context: ctx2, prior: NO_PRIOR, horizon: HORIZON, preferences: PREFS, programId: me.id, degreeTotal: me.totalCredits ?? null, programName: me.name });
  console.log('\nMechanical Engineering on the adapter path: ' + describeCreditProgress(r2.credits, me.totalCredits));
  for (const t of r2.terms) if (t.codes.some((c) => HALF.has(norm(c)))) console.log(`  ${t.label}: ${describeCreditTotal(t.credits)}  ${t.codes.join(', ')}`);
}

const failing = totals.dupInPlan + totals.twinPairsInPlan + totals.twinPriorRebooked + totals.halfCreditPlaced;
console.log(failing ? `\n*** ${failing} boards count hours the university will not award ***` : '\nno plan counts hours the university will not award');
if (failing) process.exitCode = 1;
