/**
 * The mistakes a fast planner makes that no rule check catches.
 *
 * The other harnesses ask whether a plan breaks a rule. This one asks whether
 * an advisor would sign it. For every degree, a fresh student's plan is
 * generated the way the browser generates it, and each plan is measured for
 * the things that make a plan wrong without breaking anything: requirements
 * left unplanned and what kind they are; terms that stack the hardest-band
 * courses; electives whose every section is restricted to some other major;
 * required courses whose prerequisite sentence the parser could not read;
 * courses that ran in only one of the eight crawled terms; concurrent pairs
 * (a lab and its lecture) split across terms; terms outside the credit
 * bounds; plans short of the published total. Counts and examples, so the
 * biggest class of mistake is the next thing to fix.
 *
 *   node lib/planner/__schedule-quality.check.mjs            # every degree
 *   QUALITY_ONLY=las/psychology-bslas node lib/planner/__schedule-quality.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const { generatePlan, validatePlan, restrictionClosesTo, prereqNeedsAdmission, prereqNamesOtherCollege } = await import(join(HERE, 'autoplan.ts'));
const { buildIllinoisData, gradeFootnote, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { applyOfferings } = await import(join(HERE, 'illinois-load.ts'));

const read = (n) => (existsSync(join(PUBLIC, n)) ? JSON.parse(readFileSync(join(PUBLIC, n), 'utf8')) : null);
const data = buildIllinoisData({ catalog: read('illinois-catalog.json'), programs: read('illinois-programs.json'), grades: read('illinois-grades.json'), sections: read('illinois-sections.json') });
const prereqs = new Map();
const creditRanges = new Map();
for (const [code, fact] of data.facts) { if (fact.prereq) prereqs.set(code, fact.prereq); creditRanges.set(code, fact.creditRange); }
const exclusions = new Map(Object.entries(read('illinois/exclusions.json') ?? {}));
const excellentFile = read('illinois/excellent.json');
const offeringsFile = read('illinois/offerings.json');
const languagesFile = read('illinois/languages.json');
const normCode = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
if (offeringsFile) applyOfferings(data.courses, offeringsFile);
const season = (data.sectionTerm?.term ?? 'fall').toLowerCase();
const context = {
  courses: data.courses, prereqs, grades: data.grades, sections: data.sections, equivalents: data.equivalents, exclusions,
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined, excellentTerms: excellentFile ? excellentFile.terms : undefined,
  offeringPublished: offeringsFile ? new Set(data.courses.map((c) => normCode(c.code))) : new Set(),
  offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile ? offeringsFile.terms : undefined, offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined, languages: languagesFile ?? undefined,
  creditRanges, bands: data.bands,
  snapshotTerm: data.sectionTerm ? { id: data.sectionTerm.id, label: data.sectionTerm.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: gradeFootnote(data.gradeProvenance),
  prereqCheck: (spec, earlier, sameTerm, equivalents) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, equivalents),
};
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const NO_PRIOR = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true };
const byCode = new Map(data.courses.map((c) => [normCode(c.code), c]));
const sectionOf = (code) => data.sections?.get(code) ?? null;
const hardCut = data.bands?.hardest ?? null;

/** A tally with examples. */
const tally = new Map();
const note = (bucket, example) => {
  const t = tally.get(bucket) ?? { n: 0, programs: new Set(), examples: [] };
  t.n += 1; t.programs.add(example.program);
  if (t.examples.length < 6) t.examples.push(example.text);
  tally.set(bucket, t);
};

const only = process.env.QUALITY_ONLY ?? null;
const records = [];
const programs = data.programs.filter((p) => !only || p.id === only);
let plans = 0;
const started = Date.now();
for (const program of programs) {
  const blocks = data.requirementBlocks.get(program.id) ?? [];
  if (blocks.length === 0) { note('no requirement blocks (page unparsed)', { program: program.id, text: program.name }); continue; }
  let result;
  try {
    result = generatePlan({ requirements: blocks, context, prior: NO_PRIOR, horizon: HORIZON, programId: program.id, preferences: { creditsPerTerm: { min: 12, target: null, max: 18 } }, degreeTotal: program.totalCredits ?? null, programName: program.name, programCollege: program.college });
  } catch (e) { note('generatePlan threw', { program: program.id, text: `${program.name}: ${e.message}` }); continue; }
  plans += 1;
  const P = program.name;
  records.push({
    id: program.id,
    name: P,
    planned: result.credits.planned.min,
    total: program.totalCredits ?? null,
    notPlaced: result.notPlaced.map((np) => `${np.code}:${np.reason}`),
    unsatisfied: result.unsatisfied.map((u) => `${u.label}:${u.reason}`),
    terms: result.terms.map((tm) => ({ label: tm.label, credits: tm.credits.min, codes: tm.codes })),
    language: result.language ? `${result.language.name} ${result.language.completed + 1}-${result.language.semesters}` : null,
  });
  if (process.env.QUALITY_SHOW) {
    console.log(`\n${P}: ${result.credits.planned.min} credits planned of ${program.totalCredits ?? '?'}`);
    for (const term of result.terms) console.log(`  ${term.label.padEnd(12)} ${String(term.credits.min).padStart(4)} cr  ${term.codes.join(', ')}`);
    if (result.language) console.log(`  language: ${result.language.name}, semesters ${result.language.completed + 1}-${result.language.semesters}: ${result.language.codes.join(', ')} (${result.language.why})`);
    for (const n of result.notes) console.log(`  note: ${n}`);
    for (const s of result.satisfiedByPriorCredit) console.log(`  met by prior credit: ${s.label}`);
    for (const u of result.unsatisfied) console.log(`  unsatisfied: ${u.label}: ${(u.message ?? '').slice(0, 120)}`);
    for (const np of result.notPlaced) console.log(`  not placed: ${np.code}: ${np.reason}${np.detail ? ' ' + String(np.detail).slice(0, 100) : ''}`);
  }
  const electiveCodes = new Set(result.electives.map((e) => normCode(e.code)));
  const requiredCodes = new Set(blocks.flatMap((b) => (b.rule.kind === 'all' ? b.rule.choices.flatMap((c) => c.codes.map(normCode)) : [])));

  // 1. what was left unplanned, by kind
  for (const u of result.unsatisfied) {
    const label = `${u.label ?? ''} ${u.message ?? ''}`;
    const kind = /language other than english|language requirement/i.test(label) ? 'unplanned: language requirement'
      : /did not fit before the graduation term/i.test(label) ? 'unplanned: required course did not fit in 8 terms'
      : /page does not name courses for/i.test(label) ? 'unplanned: hours-only requirement (filled with elective slots)'
      : /the catalog says:/i.test(label) ? 'unplanned: text-only requirement the adapter could not read'
      : 'unplanned: other';
    note(kind, { program: program.id, text: `${P}: ${label.slice(0, 140)}` });
  }
  for (const np of result.notPlaced) note('not placed', { program: program.id, text: `${P}: ${np.code}: ${(np.reason ?? '').slice(0, 100)}` });

  // 2. total short of the published number
  const planned = result.credits.planned.min;
  if (program.totalCredits && planned < program.totalCredits - 0.5) note('plan short of the published total', { program: program.id, text: `${P}: ${planned} of ${program.totalCredits}` });

  // per term measures
  const termAvgs = [];
  result.plan.terms.forEach((term, ti) => {
    const codes = term.courseIds.map((id) => data.courses.find((c) => c.id === id)?.code).filter(Boolean).map(normCode);
    const diffs = codes.map((c) => data.grades.get(c)?.difficulty).filter((d) => d !== null && d !== undefined);
    if (diffs.length) termAvgs.push(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    const hard = hardCut === null ? [] : codes.filter((c) => (data.grades.get(c)?.difficulty ?? -1) >= hardCut);
    if (hard.length >= 3) note('term stacks 3+ hardest-band courses', { program: program.id, text: `${P} ${term.label}: ${hard.join(', ')}` });
    else if (hard.length === 2) note('term stacks 2 hardest-band courses', { program: program.id, text: `${P} ${term.label}: ${hard.join(', ')}` });
    if (ti === 0) {
      const upper = codes.filter((c) => Number(c.split(' ')[1]) >= 300);
      if (upper.length) note('first term holds a 300+ course', { program: program.id, text: `${P}: ${upper.join(', ')}` });
    }
    for (const code of codes) {
      const course = byCode.get(code);
      if (!course) continue;
      // 3. courses whose every section is closed to this college or major, wherever they sit
      {
        const sec = sectionOf(code);
        if (sec && sec.restrictions?.length && sec.restrictions.every((r) => restrictionClosesTo(r, program.name, program.college))) {
          note(electiveCodes.has(code) ? 'elective pick closed to this college/major (every crawled section)' : 'required or list course closed to this college/major (every crawled section)', { program: program.id, text: `${P} ${term.label}: ${code}: ${sec.restrictions[0].slice(0, 90)}` });
        }
        const other = prereqNamesOtherCollege(prereqs.get(code)?.text, program.college);
        if (other) note('prerequisite text names another college', { program: program.id, text: `${P} ${term.label}: ${code}: ${other.slice(0, 90)}` });
        const adm = prereqNeedsAdmission(prereqs.get(code)?.text);
        if (adm) note('prerequisite is admission to a program (milestone)', { program: program.id, text: `${P} ${term.label}: ${code}: ${adm.slice(0, 90)}` });
      }
      // 4. required courses the parser could not read the prerequisites of
      const spec = prereqs.get(code);
      if (requiredCodes.has(code) && spec && spec.text && !spec.parsed) {
        note('required course with an unreadable prerequisite sentence (placement unverifiable)', { program: program.id, text: `${P} ${term.label}: ${code}: "${spec.text.slice(0, 80)}"` });
      }
      // 5. ran in only one of the eight terms
      const ran = context.offerings?.get(code) ?? [];
      if (context.offeringTerms?.length && ran.length === 1) note('course ran in only 1 of 8 terms (possibly alternate years)', { program: program.id, text: `${P} ${term.label}: ${code} ran ${ran[0]}` });
      if (context.offeringTerms?.length && ran.length === 0) note('course that has not run in 8 terms is on the board', { program: program.id, text: `${P} ${term.label}: ${code}` });
      // 6. concurrent pairs split across terms
      for (const g of spec?.groups ?? []) {
        if (!g.concurrent) continue;
        const partner = g.any.map(normCode).find((p) => result.plan.terms.some((t) => t.courseIds.some((id) => normCode(data.courses.find((c) => c.id === id)?.code ?? '') === p)));
        if (!partner) continue;
        const partnerTerm = result.plan.terms.findIndex((t) => t.courseIds.some((id) => normCode(data.courses.find((c) => c.id === id)?.code ?? '') === partner));
        if (partnerTerm !== ti && partnerTerm > ti) note('concurrent pair split, partner later than the course', { program: program.id, text: `${P}: ${code} in ${term.label}, ${partner} later` });
      }
    }
    // 7. term credit bounds
    const credits = result.terms[ti]?.credits;
    if (credits && credits.min > 18) note('term over 18 credits', { program: program.id, text: `${P} ${term.label}: ${credits.min}` });
    if (credits && credits.max < 12 && ti < result.plan.terms.length - 1) note('term under 12 credits (not the last term)', { program: program.id, text: `${P} ${term.label}: ${credits.max}` });
  });
  // 8. lopsided difficulty across terms
  if (termAvgs.length >= 4) {
    const spread = Math.max(...termAvgs) - Math.min(...termAvgs);
    if (spread >= 25) note('difficulty spread between lightest and heaviest term >= 25 points', { program: program.id, text: `${P}: ${termAvgs.map((a) => Math.round(a)).join(', ')}` });
  }
  // 9. rule violations, for completeness
  const issues = validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18 });
  for (const i of issues) {
    if (i.severity === 'error') note(`validator error: ${i.title}`, { program: program.id, text: `${P}: ${i.message.slice(0, 120)}` });
    else if (i.severity === 'warning' && /offered|not run/i.test(i.title)) note(`validator warning: ${i.title}`, { program: program.id, text: `${P}: ${i.message.slice(0, 120)}` });
  }
  if (plans % 100 === 0) console.error(`  ${plans} plans, ${Math.round((Date.now() - started) / 1000)}s`);
}

console.log(`\n${plans} plans generated for ${programs.length} degrees in ${Math.round((Date.now() - started) / 1000)}s\n`);
if (process.env.QUALITY_JSON) { const { writeFileSync } = await import('node:fs'); writeFileSync(process.env.QUALITY_JSON, JSON.stringify(records)); console.log(`per-degree records written to ${process.env.QUALITY_JSON}`); }
const rows = [...tally.entries()].sort((a, b) => b[1].programs.size - a[1].programs.size);
console.log('bucket'.padEnd(88) + 'occurrences  degrees');
for (const [bucket, t] of rows) console.log(`${bucket.padEnd(88)} ${String(t.n).padStart(11)}  ${String(t.programs.size).padStart(7)}`);
console.log('\nexamples');
for (const [bucket, t] of rows) { console.log(`\n${bucket}`); for (const e of t.examples) console.log(`    ${e}`); }
