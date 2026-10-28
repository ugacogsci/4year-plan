/**
 * Class times on the built board: in a term whose class schedule Illinois
 * has published (Fall 2026, Spring 2027), the planner does not leave two of
 * its own picks whose sections all meet at the same hour (autoplan.ts
 * clashSwap, weekly-fit.ts).
 *
 * From real boards:
 *   - an ACES Undeclared freshman with her language done booked PORT 150 and
 *     REL 260 for two general education categories in Spring 2027; each has
 *     one section, both Monday and Wednesday 2:00 to 3:20. The board now
 *     keeps one and trades the other for a course the same categories
 *     allow, and says so in a note;
 *   - with the trade turned off (weeklyFit: false) the board is the one it
 *     was, so the trade is the only thing that moved;
 *   - a term whose courses fit is left alone;
 *   - a Spring 2027 start is checked in its first term.
 *
 * The boards are built with the free choices as they were read when these
 * were found (AutoplanInput.freeChoices 'off'): read for how commonly a course
 * is taken, the planner no longer picks PORT 150 or REL 260 for her.
 *
 *   node lib/planner/__clash-swap.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const A = await import(join(HERE, 'autoplan.ts'));
const { weeklyFit } = await import(join(HERE, 'weekly-fit.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));

// --- the browser's load: loadIllinoisCore + buildContext, every crawled term ---
const pub = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = pub('illinois/meta.json');
const rows = pub('illinois/index.json').map(hydrateIndexRow);
const offerings = pub('illinois/offerings.json');
applyOfferings(rows, offerings);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const byId = new Map(rows.map((c) => [c.id, c]));
const gradeRaw = new Map(pub('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom && gradeRaw.has(norm(c.gradeFrom))) gradeRaw.set(norm(c.code), gradeRaw.get(norm(c.gradeFrom)));
const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
const excellentFile = pub('illinois/excellent.json');
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const seasonWord = (t) => (String(t).toLowerCase() === 'spring' ? 'Spring' : String(t).toLowerCase() === 'summer' ? 'Summer' : 'Fall');
const termSections = meta.sectionTerms.map((t) => {
  const file = pub(`illinois/${t.file}`);
  return { id: t.id, label: t.label, season: seasonWord(t.term), year: t.year, sections: new Map(file.courses.map((r) => [norm(r.code), { ...r, termId: file.termId, termLabel: file.termLabel }])) };
});
const first = termSections.find((t) => t.id === meta.term.id);
const context = {
  courses: rows,
  prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))),
  grades,
  sections: first.sections,
  termSections,
  equivalents,
  exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))),
  excellent: new Map(Object.entries(excellentFile.courses)),
  excellentTerms: excellentFile.terms,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offerings.courses)),
  offeringTerms: offerings.terms,
  offeringAliases: offerings.renumbered ? new Map(Object.entries(offerings.renumbered)) : undefined,
  languages: pub('illinois/languages.json'),
  snapshotTerm: { id: meta.term.id, label: meta.term.label, season: seasonWord(meta.term.term) },
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const summaries = pub('illinois/programs.json');

function load(programId) {
  const summary = summaries.find((p) => p.id === programId);
  for (const r of rows) {
    r.requirementIds = [];
    delete r.pathwayRole;
  }
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${summary.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(summary.id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  return { summary, program: adapted.programs[0], blocks };
}

const FALL = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
const SPRING = { startSeason: 'Spring', startYear: 2027, gradSeason: 'Fall', gradYear: 2030, stated: true };
/** A freshman with no credit, as the sweep plans one (scripts/dev/sweep/sweep.mjs). */
function build(program, { lang = 4, horizon = FALL, ctx = context, priorities = PRIORITY_PRESETS.balanced, extra = {} } = {}) {
  const L = load(program);
  const g = A.generatePlan({
    requirements: L.blocks,
    context: ctx,
    prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: lang, languageName: 'Spanish', genEdCredits: [] },
    horizon,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities },
    programId: L.summary.id,
    degreeTotal: L.summary.totalCredits || L.program.totalCredits || 120,
    interests: '',
    career: '',
    programName: L.program.name,
    programCollege: L.program.college,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
    // The picks these boards were found with, before the free choices read how commonly a
    // course is taken (autoplan.ts freeChoicesGated): PORT 150 and REL 260 are no longer the
    // planner's own picks for this student, and the trade is what is checked.
    freeChoices: 'off',
    ...extra,
  });
  return g;
}
const termOf = (g, label) => g.terms.find((t) => t.label === label)?.codes.map(norm) ?? [];

let passes = 0;
let failures = 0;
function check(name, ok, detail = '') {
  if (ok) passes += 1;
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

// --- the ACES Undeclared freshman, language done ---------------------------
{
  const on = build('aces/aces-undeclared', { lang: 4 });
  const off = build('aces/aces-undeclared', { lang: 4, extra: { weeklyFit: false } });
  const spring = termOf(on, 'Spring 2027');
  const before = termOf(off, 'Spring 2027');
  check('without the trade, PORT 150 and REL 260 share Spring 2027 (the board the trade starts from)', before.includes('PORT 150') && before.includes('REL 260'), before.join(', '));
  check('with it, they do not', !(spring.includes('PORT 150') && spring.includes('REL 260')), spring.join(', '));
  const schedule = A.weeklyScheduleFor(context, 'spring-2027');
  check('Spring 2027 has a published schedule to read', schedule !== null);
  check('the traded Spring 2027 fits a weekly schedule', weeklyFit(spring, schedule).status !== 'clash', weeklyFit(spring, schedule).line ?? '');
  check('the term keeps its hours', on.terms.find((t) => t.label === 'Spring 2027')?.credits.min === off.terms.find((t) => t.label === 'Spring 2027')?.credits.min);
  check('every other term is as it was', on.terms.every((t) => t.label === 'Spring 2027' || termOf(on, t.label).join() === termOf(off, t.label).join()));
  check('the board still meets what it met', on.unsatisfied.length === off.unsatisfied.length, `${on.unsatisfied.length} vs ${off.unsatisfied.length}`);
  check('a note names the trade and the clash', on.notes.some((n) => /^Class times: .* takes (PORT 150|REL 260)'s place in Spring 2027\. .*meet at the same time as (REL 260|PORT 150)\./.test(n)), on.notes.filter((n) => n.startsWith('Class')).join(' | '));
  check('no later column is read: a fall four years out has no timetable', A.weeklyScheduleFor(context, 'fall-2029') === null && A.weeklyScheduleFor(context, 'fall-2026') !== null);
}

// --- a board whose published terms already fit is left alone ----------------
{
  const on = build('engineering/computer-science-bs', { lang: 4 });
  const off = build('engineering/computer-science-bs', { lang: 4, extra: { weeklyFit: false } });
  check('a Computer Science board with no clash is unchanged', on.terms.every((t) => termOf(on, t.label).join() === termOf(off, t.label).join()));
  check('and has no class-times note', !on.notes.some((n) => n.startsWith('Class times')));
}

console.log(`__clash-swap: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
