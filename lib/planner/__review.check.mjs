/**
 * The board review, replayed on real students the way the board runs it.
 *
 * Run it with:  PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__review.check.mjs
 * It re-execs itself with the type-stripping flag. Exits non-zero on any failure.
 *
 * review_board, move_course and what_if call lib/planner/review.ts and
 * validatePlan with the options the board uses, and so does this file, over
 * the files the browser loads (public/illinois/*). Before 2026-09-24 the
 * board review could not say any of these, each found on these students:
 *
 *   - Emma dragged RHET 105 to Fall 2028, and nothing said Composition I
 *     belongs to the first year; moving her last Spanish course to her
 *     senior fall left Spring 2029 past 60 hours with no language course,
 *     against LAS's rule, and nothing said that either.
 *   - Emma set 12 hours a term with a Spring 2031 finish: a 13-hour first
 *     fall, a 12-hour spring and 25 hours in year one, with no word about
 *     momentum; a balanced plan for a student with 42 AP hours must not be
 *     told the same thing.
 *   - Diego's Mechanical Engineering board spends 4 hours on MATH 112, which
 *     Grainger gives no degree hours for, and a hand-added ACCY 201 on a
 *     Psychology board fills nothing but free elective hours.
 *   - A Parkland student with ENG 101 alone brings 3 hours and fills nothing.
 *   - Emma's 12 hours a term cannot keep Spring 2030, Diego's Fall 2029 finish
 *     leaves MATH 221 to ME 461 back to back into the last term, and no
 *     summer was ever suggested.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
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
const V = await import(join(HERE, 'review.ts'));
const R = await import(join(HERE, 'repick.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { livePools } = await import(join(ROOT, 'components/planner/live-pools.ts'));

// --- the browser's load: loadIllinoisCore + buildContext ---------------------
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
const sectionFile = pub('illinois/sections.json');
const excellentFile = pub('illinois/excellent.json');
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
  prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionFile.termId, termLabel: sectionFile.termLabel }])),
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
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const summaries = pub('illinois/programs.json');

function load(programId) {
  const summary = summaries.find((p) => p.id === programId);
  if (!summary) throw new Error(`no program ${programId}`);
  for (const r of rows) {
    r.requirementIds = [];
    delete r.pathwayRole;
  }
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${summary.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(summary.id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  return { summary, program: adapted.programs[0], blocks };
}

let failures = 0;
const check = (ok, msg) => {
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${msg}`);
  }
};
const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
const FRESHMAN = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };
const codesOf = (ids) => ids.map((id) => norm(byId.get(id)?.code ?? '')).filter(Boolean);
const codesOn = (b) => b.terms.flatMap((t) => codesOf(t.courseIds));

/**
 * A student's generated board and everything the board's review reads, as
 * the workspace passes it: validatePlan's options with the language plan,
 * the marks, each term as built, and the held codes none forfeited.
 */
function build({ program, prior = FRESHMAN, horizon = FOUR_YEARS, target = null, words = '', career = '' }) {
  const L = load(program);
  const degreeTotal = L.summary.totalCredits || L.program.totalCredits || 120;
  const g = A.generatePlan({
    requirements: L.blocks,
    context,
    prior,
    horizon,
    preferences: { creditsPerTerm: { min: 12, target, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId: L.summary.id,
    degreeTotal,
    interests: words,
    career,
    programName: L.program.name,
    programCollege: L.program.college,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  });
  const forfeited = new Set(g.forfeited.map((f) => norm(f.held)));
  const held = codesOf(g.plan.completedCourseIds).filter((c) => !forfeited.has(c));
  const pools = livePools({ base: g.pools, blocks: L.blocks, boardCodes: codesOn(g.plan), priorCodes: held, context });
  const marks = R.planMarks({ pools, language: g.language, electives: g.electives, genEdPicks: g.genEdPicks ?? [], addedPrerequisites: g.addedPrerequisites }, byCode);
  const built = Object.fromEntries(g.terms.map((t) => [t.id, t.codes.map(norm)]));
  const options = { minimumTermCredits: 12, maxTermCredits: 18, programName: L.program.name, programCollege: L.program.college, priorCredits: g.credits.prior, away: g.away, language: g.language };
  const momentum = (board, firstYear = true) =>
    V.momentumReview({ context, board, requirements: L.blocks, programName: L.program.name, firstYear, targetTermCredits: target, built, heldCodes: held, genEdCredits: prior.genEdCredits ?? [] });
  const flags = (board) => V.editFlags(A.validatePlan(board, context, options), momentum(board).flags);
  return { L, g, board: g.plan, held, marks, built, options, degreeTotal, prior, target, horizon, momentum, flags };
}

/** The board with one course moved, as move_course builds it (a summer between terms is added). */
function moved(board, code, label) {
  const id = byCode.get(code)?.id;
  let b = board;
  let to = b.terms.find((t) => t.label === label);
  if (!to && /^Summer (\d{4})$/.test(label)) {
    const placed = V.withSummer(b, Number(label.slice(7)));
    b = placed.board;
    to = b.terms.find((t) => t.id === placed.termId);
  }
  if (!id || !to) throw new Error(`cannot move ${code} to ${label}`);
  return { ...b, terms: b.terms.map((t) => ({ ...t, courseIds: t.id === to.id ? [...t.courseIds.filter((x) => x !== id), id] : t.courseIds.filter((x) => x !== id) })) };
}
const termOfCode = (board, code) => board.terms.find((t) => t.courseIds.includes(byCode.get(code)?.id));
const summerFor = (b, extra = {}) =>
  V.summerSuggestions({
    context,
    board: b.board,
    options: b.options,
    marks: b.marks,
    targetTermCredits: b.target,
    lightFirstYear: b.momentum(b.board).flags.some((f) => f.cause !== 'plan' && /^momentum-(term|year)/.test(f.id)),
    finish: { season: b.horizon.gradSeason, year: b.horizon.gradYear },
    ...extra,
  });
/** A suggestion, made real on the board the way what_if would try it: no new blocking row, no new edit flag. */
function confirm(b, suggestion) {
  let board = b.board;
  for (const s of suggestion.summers) for (const c of s.courses) if (c.ran.length > 0) board = moved(board, c.code, s.label);
  const breaks = (i) => R.isBlockingIssue(i) || V.isEditFlag(i);
  const before = new Set(A.validatePlan(b.board, context, b.options).filter(breaks).map((i) => i.id));
  return A.validatePlan(board, context, b.options).filter((i) => breaks(i) && !before.has(i.id));
}

// --- who is a first-year ------------------------------------------------------
{
  console.log('Who counts as a first-year:');
  const cases = [
    ['Incoming freshman fall 2026, graduate in four years.', true],
    ['Starting at Illinois in fall 2026 as a freshman. Want to graduate in 4 years or less.', true],
    ['LAS undeclared, want to transfer into Gies.', true],
    ["I'm finishing my associate's at Parkland this year and transferring to Illinois in Fall 2027 as a junior.", false],
    ['Sophomore, want to finish spring 2029.', false],
  ];
  for (const [words, want] of cases) check(V.enteringAsFirstYear(words, null) === want, `"${words}" should read as ${want ? '' : 'not '}a first-year`);
  const illinoisRecord = { fileName: 'x', readAt: '', institution: 'University of Illinois Urbana-Champaign', home: true, courses: [{ code: 'PSYC 100', title: 'Intro Psych', credits: 4, grade: 'A', term: 'Fall 2025', status: 'completed', matched: 'PSYC 100', matchedBy: 'code', use: true, counts: 'course' }], exams: [], notes: [] };
  check(!V.enteringAsFirstYear('Psychology', illinoisRecord), 'a student already holding Illinois hours is not a first-year');
}

// --- Emma, Psychology: the default board, then her edits ----------------------
const emma = build({ program: 'las/psychology-bslas', words: 'Psychology, pre-med.', career: 'medical school' });
{
  console.log('\nEmma, Psychology, default board:');
  const m = emma.momentum(emma.board);
  console.log(`  momentum flags: ${m.flags.length}; edit flags: ${emma.flags(emma.board).length}`);
  check(m.flags.length === 0 && m.fact === null, `a default first-year board has no momentum flag (${m.flags.map((f) => f.id).join(', ')})`);
  check(emma.flags(emma.board).length === 0, 'the default board shows no edit flag');
  const s = summerFor(emma);
  check(s.length === 0, `no summer is suggested for a board on pace with slack (${s.map((x) => x.reason).join(', ')})`);

  // RHET 105 dragged to the junior fall: flagged, and the move result says so.
  const rhetAt = termOfCode(emma.board, 'RHET 105')?.label;
  const late = moved(emma.board, 'RHET 105', 'Fall 2028');
  const caused = V.flagsCaused(emma.flags(emma.board), emma.flags(late));
  console.log(`  RHET 105 from ${rhetAt} to Fall 2028: ${caused.join(' | ') || 'nothing'}`);
  check(caused.some((m) => /RHET 105 is in Fall 2028/.test(m) && /first year/.test(m)), 'Composition I moved to Fall 2028 is flagged and returned as caused');
  const issue = A.validatePlan(late, context, emma.options).find((i) => i.id.startsWith('ap-comp1-late-'));
  check(issue?.courseId === byCode.get('RHET 105').id && issue?.severity === 'warning', 'the Composition I row is a warning on the RHET 105 card, so move_course returns it');
  check(!A.validatePlan(moved(emma.board, 'RHET 105', 'Summer 2027'), context, emma.options).some((i) => i.id.startsWith('ap-comp1-late-')), 'the summer after the first spring is still year one');
  check(A.validatePlan(moved(emma.board, 'RHET 105', 'Fall 2027'), context, emma.options).some((i) => i.id.startsWith('ap-comp1-late-')), 'the third fall or spring is past the first year');

  // PSYC 100 dragged out of her first fall: a light first term by her edit.
  const light = moved(emma.board, 'PSYC 100', 'Fall 2027');
  const after = emma.momentum(light);
  console.log(`  PSYC 100 to Fall 2027: ${after.flags.map((f) => `[${f.cause}] ${f.message}`).join(' | ')}`);
  check(after.flags.some((f) => f.id === 'momentum-term-fall-2026' && f.cause === 'edits'), 'Fall 2026 under 15 by an edit is flagged');
  check(after.flags.some((f) => f.id === 'momentum-year-one' && f.cause === 'edits'), 'year one under 30 by an edit is flagged');
  check(after.fact !== null && after.fact.includes("Kentucky's statewide data"), 'the Kentucky fact comes with it');
  check(V.flagsCaused(emma.flags(emma.board), emma.flags(light)).length >= 2, 'the move result carries the momentum flags it caused');

  // PSYC 235, her statistics course, dragged to the junior fall.
  const stats = moved(emma.board, 'PSYC 235', 'Fall 2028');
  const math = emma.momentum(stats).flags.find((f) => f.id === 'momentum-math');
  console.log(`  PSYC 235 to Fall 2028: ${math?.message ?? 'no math flag'}`);
  check(math?.cause === 'edits' && /PSYC 235/.test(math.message), 'the first statistics course moved past year one is flagged as an edit');
}

// --- Emma sets 12 hours a term ---------------------------------------------------
{
  console.log('\nEmma sets 12 hours a term, keeping Spring 2030:');
  const b = build({ program: 'las/psychology-bslas', target: 12, words: 'Psychology, pre-med.', career: 'medical school' });
  const m = b.momentum(b.board);
  check(m.flags.every((f) => !/^momentum-(term|year)/.test(f.id)), 'the date kept her terms at 15, so there is no light-year flag');
  const s = summerFor(b).find((x) => x.reason === 'finish');
  console.log(`  ${s?.text ?? 'no finish suggestion'}`);
  check(Boolean(s), 'a finish that would slip at 12 a term gets a summer suggestion');
  check((s?.saves ?? 0) >= 1, `the summers save at least one term (${s?.saves})`);
  check((s?.summers ?? []).every((x) => x.hours <= 9 && x.courses.every((c) => c.ran.length > 0 || b.marks.get(byCode.get(c.code)?.id)?.kind === 'elective')), 'every summer holds 9 hours or fewer, of courses that ran in summer or elective slots');
  const broke = s ? confirm(b, s) : [];
  check(broke.length === 0, `trying the suggestion breaks nothing: ${broke.map((i) => i.message).join(' / ')}`);

  console.log('\nEmma sets 12 hours a term and a Spring 2031 finish:');
  const later = build({ program: 'las/psychology-bslas', target: 12, horizon: { ...FOUR_YEARS, gradYear: 2031 }, words: 'Psychology, pre-med.', career: 'medical school' });
  const lm = later.momentum(later.board);
  for (const f of lm.flags) console.log(`  [${f.cause}] ${f.message}`);
  check(lm.flags.filter((f) => f.id.startsWith('momentum-term-') && f.cause === 'setting').length === 2, 'both first-year terms are flagged, caused by her setting');
  check(lm.flags.some((f) => f.id === 'momentum-year-one' && f.cause === 'setting'), 'year one under 30 is flagged');
  check(lm.fact !== null && (lm.fact.match(/Kentucky/g) ?? []).length === 1, 'the fact comes once');
  const fy = summerFor(later, { finish: { season: 'Spring', year: 2031 } }).find((x) => x.reason === 'first-year');
  console.log(`  ${fy?.text ?? 'no first-year suggestion'}`);
  check(fy?.summers[0]?.label === 'Summer 2027', 'the summer after her first year is suggested');
  check(fy ? confirm(later, fy).length === 0 : false, 'trying it breaks nothing');

  console.log('\nA balanced board for a student with 42 AP hours is not light by choice:');
  // Sofia's AP score report as the exam table prices it: 42 hours.
  const ap = build({
    program: 'las/economics-balas',
    prior: { ...FRESHMAN, courseCodes: ['CS 101', 'CHEM 102', 'CHEM 104', 'MATH 220', 'MATH 231', 'PHYS 211', 'RHET 105', 'SPAN 203', 'SPAN 210', 'SPAN 214', 'STAT 100', 'PHYS 101'], unmatchedCredits: 7 },
    words: 'Economics',
    career: 'law school or policy work',
  });
  const apm = ap.momentum(ap.board);
  const year = V.firstYearTerms(ap.board).reduce((n, t) => n + A.planCreditRange(codesOf(t.courseIds), context).max, 0);
  console.log(`  year one ${year} Illinois hours over ${ap.board.terms.length} terms; flags: ${apm.flags.map((f) => f.id).join(', ') || 'none'}`);
  check(year < 30, `the case needs a year one under 30 to mean anything (${year})`);
  check(apm.flags.every((f) => !/^momentum-(term|year)/.test(f.id)) && apm.fact === null, 'no light-year flag and no fact for a plan-made balanced share');
  check(ap.momentum(ap.board, false).flags.length === 0, 'a student who is not a first-year gets no momentum flags');
}

// --- Ethan, Computer Science ------------------------------------------------------
{
  console.log('\nEthan, Computer Science, default board:');
  const b = build({ program: 'engineering/computer-science-bs', words: 'Computer science', career: 'software engineer' });
  const m = b.momentum(b.board);
  const math = termOfCode(b.board, 'MATH 221')?.label;
  console.log(`  MATH 221 in ${math}; momentum flags: ${m.flags.length}`);
  check(m.flags.length === 0, `a default CS board has no momentum flag (${m.flags.map((f) => f.message).join(' / ')})`);
  check(V.firstYearTerms(b.board).some((t) => t.label === math), 'MATH 221 is in year one');
  // MATH 220 added beside MATH 221: the catalog credits one of them.
  const withBoth = { ...b.board, terms: b.board.terms.map((t, i) => (i === 1 ? { ...t, courseIds: [...t.courseIds, byCode.get('MATH 220').id] } : t)) };
  const use = V.creditUse({ context, board: withBoth, requirements: b.L.blocks, programCollege: b.L.program.college, programName: b.L.program.name, degreeTotal: b.degreeTotal, priorCredits: 0, heldCodes: [], marks: b.marks, studentAdded: new Set([byCode.get('MATH 220').id]) });
  console.log(`  MATH 220 added: ${use.countsNothing.map((c) => `${c.code}: ${c.why}`).join(' | ')}`);
  check(use.countsNothing.some((c) => c.code === 'MATH 220' && /MATH 221/.test(c.why)), 'MATH 220 beside MATH 221 counts toward nothing');
  const prior = V.priorCreditUse({ context, requirements: b.L.blocks, programName: b.L.program.name, programCollege: b.L.program.college, hoursIn: 7, heldCodes: ['STAT 100', 'CS 100'], genEdCredits: [] });
  console.log(`  AP Statistics held: ${JSON.stringify(prior)}`);
  check(prior.nothing.includes('STAT 100') && prior.hoursNothing === 3, 'STAT 100 earns no hours toward an engineering degree');
}

// --- Diego, Mechanical Engineering ------------------------------------------------
{
  console.log('\nDiego, Mechanical Engineering:');
  const b = build({ program: 'engineering/mechanical-engineering-bs', words: 'Mechanical engineering', career: 'automotive design' });
  const use = V.creditUse({ context, board: b.board, requirements: b.L.blocks, programCollege: b.L.program.college, programName: b.L.program.name, degreeTotal: b.degreeTotal, priorCredits: 0, heldCodes: [], marks: b.marks, studentAdded: new Set() });
  console.log(`  counts toward nothing: ${use.countsNothing.map((c) => `${c.code} (${c.term})`).join(', ') || 'none'}; beyond the total: ${use.beyondTotal}`);
  if (codesOn(b.board).includes('MATH 112')) check(use.countsNothing.some((c) => c.code === 'MATH 112' && /Engineering/.test(c.why)), 'MATH 112 on a Grainger board counts toward nothing');
  check(use.freeElectives.length === 0, 'the planner\'s own cards are never listed as the student\'s additions');

  const early = build({ program: 'engineering/mechanical-engineering-bs', horizon: { ...FOUR_YEARS, gradSeason: 'Fall', gradYear: 2029 }, words: 'Mechanical engineering', career: 'automotive design' });
  const chain = V.tightChains(early.board, context)[0] ?? [];
  console.log(`  finishing Fall 2029: ${chain.map((c) => `${c.code} ${c.label}`).join(' > ') || 'no tight chain'}`);
  check(chain.length >= 3 && chain[chain.length - 1].label === early.board.terms[early.board.terms.length - 1].label, 'a chain runs back to back into the last term');
  const s = summerFor(early).find((x) => x.reason === 'chain');
  console.log(`  ${s?.text ?? 'no chain suggestion'}`);
  check(Boolean(s) && s.summers[0].courses.every((c) => chain.some((l) => l.code === c.code) && c.ran.length > 0), 'a summer is suggested for a link of that chain that has run in summer');
  check(s ? confirm(early, s).length === 0 : false, 'trying it breaks nothing');
}

// --- the language rule: LAS and the iSchool, not Kinesiology -----------------------
{
  console.log('\nThe language rule past 60 hours:');
  const noLanguage = { ...FRESHMAN, languageSemesters: 0 };
  for (const [program, rule] of [['las/psychology-bslas', true], ['ischool/information-sciences-bs', true], ['ahs/kinesiology-bs/applied-exercise-science', false]]) {
    const b = build({ program, prior: noLanguage, words: 'undecided' });
    const lang = b.g.language;
    if (!lang) { check(false, `${program}: no language planned for a student with none`); continue; }
    const base = A.validatePlan(b.board, context, b.options).filter((i) => i.id.startsWith('ap-language-gap-'));
    const lastCode = norm(lang.codes[lang.codes.length - 1]);
    const lastFall = [...b.board.terms].reverse().find((t) => t.season === 'Fall').label;
    const edited = moved(b.board, lastCode, lastFall);
    const gaps = A.validatePlan(edited, context, b.options).filter((i) => i.id.startsWith('ap-language-gap-'));
    console.log(`  ${program}: ${lang.codes.join(', ')}; ${lastCode} moved to ${lastFall}: ${gaps.map((i) => i.message.slice(0, 140)).join(' | ') || 'no gap flag'}`);
    check(base.length === 0, `${program}: the generated board has no language gap`);
    check(rule ? gaps.length > 0 : gaps.length === 0, `${program}: ${rule ? 'a term past 60 hours without a language course is flagged' : 'the rule is not this college\'s'}`);
    if (rule) check(V.flagsCaused(b.flags(b.board), b.flags(edited)).some((m) => /language course/.test(m)), `${program}: the move result carries the language flag`);
  }
}

// --- credits that count toward nothing, and what held credit fills ------------------
{
  console.log('\nCredits that count toward nothing:');
  const accy = byCode.get('ACCY 201');
  const anth = byCode.get('ANTH 101');
  const board = { ...emma.board, terms: emma.board.terms.map((t, i) => (i === 3 ? { ...t, courseIds: [...t.courseIds, accy.id, anth.id] } : t)) };
  const use = V.creditUse({ context, board, requirements: emma.L.blocks, programCollege: emma.L.program.college, programName: emma.L.program.name, degreeTotal: emma.degreeTotal, priorCredits: 0, heldCodes: emma.held, marks: emma.marks, studentAdded: new Set([accy.id, anth.id]) });
  console.log(`  Emma adds ACCY 201 and ANTH 101: beyond ${use.beyondTotal}; filling nothing: ${use.freeElectives.map((c) => c.code).join(', ')}`);
  check(use.freeElectives.some((c) => c.code === 'ACCY 201'), 'a hand-added course that fills nothing is listed as free elective hours');
  check(!use.freeElectives.some((c) => c.code === 'ANTH 101'), 'a hand-added course carrying a gen-ed category the degree asks for is not');
  check(use.beyondTotal === 6, `the six hours past 120 are counted (${use.beyondTotal})`);

  // A Parkland student with ENG 101 alone: a transcript line counted as hours, no category.
  const eng = V.priorCreditUse({ context, requirements: emma.L.blocks, programName: emma.L.program.name, programCollege: emma.L.program.college, hoursIn: 3, heldCodes: [], genEdCredits: [] });
  console.log(`  ENG 101 alone: ${eng.hoursIn} in, ${eng.hoursFilling} toward a requirement`);
  check(eng.hoursIn === 3 && eng.hoursFilling === 0, 'ENG 101 alone is 3 hours in and 0 toward a requirement');
  const jordan = V.priorCreditUse({
    context,
    requirements: emma.L.blocks,
    programName: emma.L.program.name,
    programCollege: emma.L.program.college,
    hoursIn: 50,
    heldCodes: ['RHET 105', 'PSYC 100', 'SPAN 101', 'SPAN 102', 'SOC 100', 'SPAN 201', 'PHIL 101', 'ENGL 101', 'PSYC 201'],
    genEdCredits: [{ label: 'MAT 160 Statistics (Parkland College)', credits: 4, tags: ['Quantitative Reasoning I'] }, { label: 'EGL 101 (Parkland College)', credits: 3, tags: [] }],
  });
  console.log(`  Jordan's Parkland record: ${jordan.hoursIn} in, ${jordan.hoursFilling} toward a requirement; elective only: ${jordan.electiveOnly.join(', ') || 'none'}`);
  check(jordan.filling.some((f) => f.startsWith('RHET 105')) && jordan.filling.some((f) => f.startsWith('PSYC 100')) && jordan.filling.some((f) => f.startsWith('MAT 160')), 'Composition I, PSYC 100 and the Parkland statistics course fill requirements');
  check(!jordan.filling.some((f) => f.startsWith('EGL 101')), 'a line with no category fills nothing');
  check(jordan.hoursFilling > 0 && jordan.hoursFilling <= jordan.hoursIn, 'hours filling a requirement never exceed hours in');
}

// --- generated boards: neither edit flag, across the degrees that have the rule ---------
{
  console.log('\nGenerated boards, every iSchool degree and every fourth LAS degree, no language brought:');
  const programs = summaries.filter((p) => p.college === 'ischool' || p.college === 'las').filter((p, i) => p.college === 'ischool' || i % 4 === 0);
  let boards = 0;
  const found = [];
  for (const p of programs) {
    let b;
    try {
      b = build({ program: p.id, prior: { ...FRESHMAN, languageSemesters: 0 }, words: p.name });
    } catch {
      continue;
    }
    boards += 1;
    for (const i of A.validatePlan(b.board, context, b.options).filter(V.isEditFlag)) found.push(`${p.id}: ${i.message.slice(0, 160)}`);
  }
  console.log(`  ${boards} boards, ${found.length} edit flags`);
  for (const f of found.slice(0, 8)) console.log(`    ${f}`);
  check(found.length === 0, 'no generated board shows Composition I late or a language gap');
}

console.log(failures === 0 ? '\nREVIEW CHECK: all clean' : `\nREVIEW CHECK: ${failures} ${failures === 1 ? 'failure' : 'failures'}`);
process.exit(failures === 0 ? 0 : 1);
