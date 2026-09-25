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
function build({ program, prior = FRESHMAN, horizon = FOUR_YEARS, target = null, words = '', career = '', extra = {} }) {
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
    ...extra,
  });
  const forfeited = new Set(g.forfeited.map((f) => norm(f.held)));
  const held = codesOf(g.plan.completedCourseIds).filter((c) => !forfeited.has(c));
  const pools = livePools({ base: g.pools, blocks: L.blocks, boardCodes: codesOn(g.plan), priorCodes: held, context });
  const marks = R.planMarks({ pools, language: g.language, electives: g.electives, genEdPicks: g.genEdPicks ?? [], addedPrerequisites: g.addedPrerequisites }, byCode);
  const built = Object.fromEntries(g.terms.map((t) => [t.id, t.codes.map(norm)]));
  const options = { minimumTermCredits: 12, maxTermCredits: 18, programName: L.program.name, programCollege: L.program.college, priorCredits: g.credits.prior, away: g.away, language: g.language };
  const momentum = (board, firstYear = true) =>
    V.momentumReview({ context, board, requirements: L.blocks, programName: L.program.name, firstYear, targetTermCredits: target, planAim: g.credits.aim ?? null, built, heldCodes: held, genEdCredits: prior.genEdCredits ?? [] });
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

// --- first-term seminars ------------------------------------------------------
{
  // LAS 101 is "Restricted to first-year students in LAS", LAS 102 is for
  // first-term transfers. HK 112 holds most seats "for freshman-sophomore
  // status" and is a three-credit course, not a seminar a first term takes on
  // top of its load; ALEC 123, "ALEC Orientation to Illinois", is restricted
  // to ALEC students and was read as a Parkland transfer's first-term course
  // by its title alone.
  console.log('\nFirst-term seminars:');
  const freshman = { transfer: false, international: false };
  const transfer = { transfer: true, international: false };
  const seminar = (code, arrival) => A.firstTermCourse(byCode.get(code), context, arrival);
  check(seminar('LAS 101', freshman), 'LAS 101 is a freshman\'s first-term seminar');
  check(seminar('LAS 102', transfer) && !seminar('LAS 102', freshman), 'LAS 102 is a transfer\'s, not a freshman\'s');
  check(!seminar('HK 112', freshman), 'HK 112 (three credits, seats for freshman-sophomore status) is not a first-term seminar');
  check(!seminar('ALEC 123', transfer), 'ALEC 123 is not a transfer\'s first-term seminar by its title');
}

// --- Emma, Psychology: the default board, then her edits ----------------------
const emma = build({ program: 'las/psychology-bslas', words: 'Psychology, pre-med.', career: 'medical school' });
{
  // At a930f09 her LAS 101 sat in Fall 2028, her third year.
  const las101 = termOfCode(emma.board, 'LAS 101')?.label;
  check(V.firstYearTerms(emma.board).some((t) => t.label === las101), `pre-med Emma's LAS 101 is in her first year (${las101})`);
}
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
  // Her MATH 112 (for CHEM 102) stays in her first fall, so the flag says
  // PSYC 235 is the degree's own course, not that it is her first math.
  const collegeMath = codesOf(V.firstYearTerms(stats).flatMap((t) => t.courseIds)).find((c) => c.startsWith('MATH '));
  check(!collegeMath || (/this degree's own/.test(math?.message ?? '') && math.message.includes(collegeMath)), `the flag names ${collegeMath ?? 'no other math'} as college math, not "the first college math on the board"`);
}

// --- first math, by CCRC's count ----------------------------------------------
{
  // A pre-PT Anthropology freshman's MATH 112, taken for CHEM 102, is college
  // math in her first fall: read as not counting, she was told "the first
  // college math or statistics course on the board, STAT 212, is in Spring
  // 2028" beside it. Held from dual credit it counts the same.
  console.log('\nFirst college math, as CCRC counts it:');
  const anth = build({ program: 'las/anthropology-balas', prior: { ...FRESHMAN, languageSemesters: 2 }, words: 'physical therapy school', career: 'physical therapy school' });
  const first = codesOf(V.firstYearTerms(anth.board).flatMap((t) => t.courseIds));
  const flag = anth.momentum(anth.board).flags.find((f) => f.id === 'momentum-math');
  console.log(`  pre-PT Anthropology year one: ${first.join(', ')}; ${flag?.message ?? 'no math flag'}`);
  check(first.includes('MATH 112') && !flag, 'MATH 112 in year one is her first college math: no momentum-math flag');
  const dual = build({ program: 'las/art-history-balas', prior: { ...FRESHMAN, languageSemesters: 2, courseCodes: ['MATH 112', 'RHET 105', 'PSYC 100'] }, words: 'physical therapy school', career: 'physical therapy school' });
  check(!dual.momentum(dual.board).flags.some((f) => f.id === 'momentum-math'), 'an Art History pre-PT freshman holding dual-credit MATH 112 is not told her first college math comes after year one');
}

// --- the order a generated board keeps -----------------------------------------
{
  // Each of these was broken by a move after the placer, or by a placement
  // trial, and none of the checks above saw it: the validator reads only the
  // prerequisites parsed with confidence, and nothing read a sequence's gap
  // or a lab beside its lecture.
  console.log('\nOrder on generated boards:');
  const at = (b, code) => b.board.terms.findIndex((t) => t.courseIds.includes(byCode.get(code)?.id));
  const regular = (b, i) => b.board.terms.slice(0, i + 1).filter((t) => t.season !== 'Summer').length;
  // CHEM 236 reads "CHEM 104 ... or CHEM 204", parsed with low confidence;
  // bundled with its lab, and moved into year one, it went into a Chemistry
  // freshman's first spring and first fall, a year before CHEM 202.
  for (const [goal, lang] of [['', 4], ['medical school', 2]]) {
    const chem = build({ program: 'las/chemistry-bs', prior: { ...FRESHMAN, languageSemesters: lang }, words: goal, career: goal });
    const [c202, c204, c236] = ['CHEM 202', 'CHEM 204', 'CHEM 236'].map((c) => at(chem, c));
    console.log(`  Chemistry, ${goal || 'no goal'}, language ${lang}: CHEM 202 term ${c202}, CHEM 204 term ${c204}, CHEM 236 term ${c236}`);
    check(c202 >= 0 && c202 < c204 && c204 < c236, `Chemistry (${goal || 'no goal'}): general chemistry before CHEM 236`);
    // CHEM 202 needs MATH 220 beside it, and MATH 220's placement sentence
    // read as two courses to take first held both a year back; and the pair
    // CHEM 202 and CHEM 203 went in only once nothing else could. Round 4
    // loosened this for the pre-med board with two semesters of Spanish to
    // take, whose first-fall board the gate refused for three credits of
    // padding (CHEM 108 and CHEM 494 topping up a light last spring); a light
    // term now takes a course a heavier one can spare first, and the check
    // is the round-3 one again.
    check(c202 === 0, `Chemistry (${goal || 'no goal'}): CHEM 202 in the first fall (term ${c202})`);
    check(at(chem, 'CHEM 236') === at(chem, 'CHEM 237'), `Chemistry (${goal || 'no goal'}): CHEM 237 beside its lecture CHEM 236`);
    check(at(chem, 'CHEM 101') < 0, `Chemistry (${goal || 'no goal'}): no CHEM 101, the preparation for the CHEM 102 that CHEM 202 stands in for`);
  }
  // Held back as a track course that could wait, a pre-PT Public Health
  // freshman's CHEM 104 went a year after CHEM 102.
  const ph = build({ program: 'ahs/public-health-bs', prior: { ...FRESHMAN, languageSemesters: 2 }, words: 'physical therapy school', career: 'physical therapy school' });
  check(regular(ph, at(ph, 'CHEM 104')) - regular(ph, at(ph, 'CHEM 102')) === 1, 'pre-PT Public Health: CHEM 104 the term after CHEM 102');
  // An Art Education freshman's CHEM 103 went a term after its lecture.
  const art = build({ program: 'faa/art-education-bfa', prior: { ...FRESHMAN, languageSemesters: 4 }, words: 'physical therapy school', career: 'physical therapy school' });
  check(at(art, 'CHEM 103') === at(art, 'CHEM 102') && at(art, 'CHEM 105') === at(art, 'CHEM 104'), 'pre-PT Art Education: each general chemistry lab beside its lecture');
  // MATH 220 moved into a Mathematics freshman's first spring and MATH 231
  // stayed in Spring 2028, with a fall of no math between them.
  const math = build({ program: 'las/mathematics-bslas', prior: { ...FRESHMAN, languageSemesters: 2 }, words: '', career: '' });
  check(regular(math, at(math, 'MATH 231')) - regular(math, at(math, 'MATH 220')) === 1, 'Mathematics: MATH 231 the term after MATH 220');
  check(at(math, 'MATH 220') === 0 && !math.momentum(math.board).flags.some((f) => f.id === 'momentum-math'), `Mathematics: MATH 220 in the first fall, no momentum-math flag (term ${at(math, 'MATH 220')})`);
  // Sections of ENG 100 are held for first-time freshmen; a Bioengineering
  // freshman's year one held 16 and 16 credits and it sat in Fall 2027.
  const bioe = build({ program: 'engineering/bioengineering-bs', prior: { ...FRESHMAN, languageSemesters: 2 }, words: '', career: '' });
  const eng100 = termOfCode(bioe.board, 'ENG 100')?.label;
  check(V.firstYearTerms(bioe.board).some((t) => t.label === eng100), `Bioengineering: ENG 100 in year one (${eng100})`);
  // Once the LAS orientation row was one pick, the placer took a Chemistry
  // freshman's first fall to 18 with PORT 150 and THEA 110; a pick that can
  // wait goes to a later term with room.
  const chem = build({ program: 'las/chemistry-bs', prior: { ...FRESHMAN, languageSemesters: 4 }, words: '', career: '' });
  const heavy = V.firstYearTerms(chem.board).filter((t) => t.season !== 'Summer' && A.planCreditRange(codesOf(t.courseIds), context).min >= 17);
  check(heavy.length === 0, `Chemistry, no goal: no first-year term at 17 or more (${heavy.map((t) => t.label).join(', ') || 'none'})`);
  // PSYC 100, due before the MCAT, did not fit a pre-med Mathematics
  // freshman's last three hours of booking room, and MCB 250, with no date,
  // took them; the dated row now keeps first claim.
  const premath = build({ program: 'las/mathematics-bslas', prior: { ...FRESHMAN, languageSemesters: 4 }, words: 'medical school', career: 'medical school' });
  const psyc = termOfCode(premath.board, 'PSYC 100')?.label;
  check(psyc !== undefined && premath.board.terms.findIndex((t) => t.label === psyc) <= premath.board.terms.findIndex((t) => t.label === 'Spring 2029'), `pre-med Mathematics: PSYC 100 by the MCAT spring (${psyc ?? 'off the board'})`);
}

// --- what the reviewers of 32a649b found ------------------------------------------
{
  console.log('\nBoards the reviewers of 32a649b read:');
  const at = (b, code) => b.board.terms.findIndex((t) => t.courseIds.includes(byCode.get(code)?.id));
  const hours = (b, t) => A.planCreditRange(codesOf(t.courseIds), context).min;
  const yearOne = (b) => V.firstYearTerms(b.board).filter((t) => t.season !== 'Summer').map((t) => hours(b, t));
  // The bundle rule for CHEM 236 left MATH 285 and NRES 490 off an
  // Environmental Chemistry board at 120 credits, with two 12-credit terms.
  const env = build({ program: 'las/chemistry-bs/environmental-chemistry', words: '', career: '' });
  const envOff = env.g.notPlaced.map((n) => n.code);
  console.log(`  Environmental Chemistry, language done: ${A.planCreditRange(codesOn(env.board), context).min} credits; not placed: ${envOff.join(', ') || 'none'}`);
  check(at(env, 'MATH 285') >= 0 && at(env, 'NRES 490') >= 0 && envOff.length === 0, 'Environmental Chemistry: MATH 285 and NRES 490 on the board, nothing left off');
  check(at(env, 'CHEM 236') === at(env, 'CHEM 237') && at(env, 'CHEM 202') === 0, 'Environmental Chemistry: CHEM 202 in the first fall, CHEM 237 beside CHEM 236');

  // A note that names a course's term is read against the finished board: the
  // year-one relief moved TE 100 after the list substitution said "TE 100 ...
  // takes its place in Fall 2026".
  const claims = (b) => {
    const where = new Map(b.board.terms.flatMap((t) => codesOf(t.courseIds).map((c) => [c, t.label])));
    const bad = [];
    for (const text of [...b.g.notes, ...b.g.electives.map((e) => `${e.code}: ${e.why}`)]) {
      for (const m of text.matchAll(/\b([A-Z]{2,5} \d{3})\b([^.;:]{0,80}?)\b(?:in|to|into) ((?:Fall|Spring|Summer) 20\d\d)\b/g)) {
        const [, code, between, term] = m;
        if (/\b[A-Z]{2,5} \d{3}\b|\bnot\b|\b(before|after|until|by)\s*$/.test(between)) continue;
        if (where.has(code) && where.get(code) !== term) bad.push(`${code} said ${term}, is ${where.get(code)}`);
      }
    }
    return bad;
  };
  for (const [goal, lang] of [['', 2], ['medical school', 4]]) {
    const phys = build({ program: 'engineering/physics-bs', prior: { ...FRESHMAN, languageSemesters: lang }, words: goal, career: goal });
    const bad = claims(phys);
    check(bad.length === 0, `Physics (${goal || 'no goal'}): every note that names a course's term is true (${bad.join('; ') || 'all true'})`);
  }

  // With 12 hours a term set, a first-year term the plan itself left at 14
  // was put down to her setting: LAS 101 moved into a Psychology freshman's
  // first fall, and LAST 210 out of an Economics freshman's first spring.
  for (const program of ['las/psychology-bslas', 'las/economics-balas', 'las/mathematics-bslas']) {
    const b = build({ program, prior: { ...FRESHMAN, languageSemesters: 2 }, target: 12, words: '', career: '' });
    const blamed = b.momentum(b.board).flags.filter((f) => f.cause === 'setting');
    console.log(`  ${program}, 12 a term: year one ${yearOne(b).join('/')}; ${blamed.map((f) => f.message).join(' | ') || 'no setting flag'}`);
    check(blamed.length === 0, `${program} with 12 a term: no light-term flag blames the setting when the plan balanced at ${b.g.credits.aim}`);
  }
  for (const program of ['las/economics-balas', 'las/psychology-bslas', 'aces/natural-resources-environmental-sciences-bs/fish-wildlife-conservation-biology']) {
    const b = build({ program, prior: { ...FRESHMAN, languageSemesters: 2 }, words: '', career: '' });
    const y = yearOne(b);
    check(y.every((h) => h >= 15) && y.reduce((n, h) => n + h, 0) >= 30, `${program}: year one on the fifteen-hour pace (${y.join('/')})`);
  }

  // The order a trial broke (PHYS 101 and PHYS 102 a year apart) outweighed
  // CHEM 332 meeting the application date.
  const ggis = build({ program: 'las/geography-geographic-information-science-bslas/geographic-information-science', prior: { ...FRESHMAN, languageSemesters: 4 }, words: 'medical school', career: 'medical school' });
  const spring2029 = ggis.board.terms.findIndex((t) => t.label === 'Spring 2029');
  check(at(ggis, 'CHEM 332') >= 0 && at(ggis, 'CHEM 332') <= spring2029, `pre-med Geographic Information Science: CHEM 332 by Spring 2029 (${termOfCode(ggis.board, 'CHEM 332')?.label ?? 'off the board'})`);

  // Held to fifteen, the year-one repair could bring no three-credit HK
  // course into a pre-PT Kinesiology freshman's 13-credit first spring.
  const kin = build({ program: 'ahs/kinesiology-bs', prior: { ...FRESHMAN, languageSemesters: 4 }, words: 'physical therapy school', career: 'physical therapy school' });
  const spring = kin.board.terms[1];
  const hk = codesOf(spring.courseIds).filter((c) => c.startsWith('HK ') && A.planCreditRange([c], context).min >= 2);
  check(hours(kin, spring) >= 15 && hk.length > 0, `pre-PT Kinesiology: a first spring of 15 or more with a Kinesiology course (${codesOf(spring.courseIds).join(', ')})`);

  // Emma with AP Psychology and AP Calculus: a first spring of 12 made a
  // year one of 27 hours. Her nine AP hours leave about 14 a term to plan,
  // and no first-year term goes under that share.
  const ap = build({ program: 'las/psychology-bslas', prior: { ...FRESHMAN, courseCodes: ['PSYC 100', 'MATH 220'] }, words: 'Psychology, pre-med.', career: 'medical school' });
  const apYear = yearOne(ap);
  check(apYear.every((h) => h >= Math.min(15, ap.g.credits.aim)), `pre-med Emma with AP credit: no first-year term under the ${ap.g.credits.aim} a term the plan balances at (${apYear.join('/')})`);

  // Past year one, a term with two hardest-band courses gives one to a term
  // with none: an Economics freshman's Spring 2028 and Spring 2029 each held
  // two while Fall 2028 held none.
  const econ = build({ program: 'las/economics-balas', prior: { ...FRESHMAN, languageSemesters: 2 }, words: '', career: '' });
  const hardest = context.bands?.hardest ?? 65;
  const firstYearIds = new Set(V.firstYearTerms(econ.board).map((t) => t.id));
  const pairs = econ.board.terms.filter((t) => !firstYearIds.has(t.id) && codesOf(t.courseIds).filter((c) => (context.grades.get(c)?.difficulty ?? -1) >= hardest).length >= 2);
  check(pairs.length <= 1, `Economics: at most one term past year one with two hardest-band courses (${pairs.map((t) => t.label).join(', ') || 'none'})`);

  // A first-term seminar after year one is one the student cannot register for.
  const las101 = moved(emma.board, 'LAS 101', 'Fall 2028');
  check(A.validatePlan(las101, context, emma.options).some((i) => i.id.startsWith('ap-seminar-late-') && V.isEditFlag(i)), 'LAS 101 dragged to Fall 2028 is flagged as past the first year');
  check(!A.validatePlan(emma.board, context, emma.options).some((i) => i.id.startsWith('ap-seminar-late-')), "Emma's own board has no seminar past the first year");
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
    const issues = A.validatePlan(b.board, context, b.options).filter(V.isEditFlag);
    for (const i of issues.filter((x) => !x.id.startsWith('ap-seminar-late-'))) found.push(`${p.id}: ${i.message.slice(0, 160)}`);
    // A seminar the planner could not bring into year one is flagged on the
    // generated board too; that is only right where year one had no room.
    const yearOneFull = V.firstYearTerms(b.board).filter((t) => t.season !== 'Summer').every((t) => A.planCreditRange(codesOf(t.courseIds), context).min >= 17);
    for (const i of issues.filter((x) => x.id.startsWith('ap-seminar-late-'))) if (!yearOneFull) found.push(`${p.id}: ${i.message.slice(0, 160)} (year one had room)`);
  }
  console.log(`  ${boards} boards, ${found.length} edit flags`);
  for (const f of found.slice(0, 8)) console.log(`    ${f}`);
  check(found.length === 0, 'no generated board shows Composition I late, a language gap, or a first-term seminar past a year one with room');
}

// --- the no-worse gate, and what round 4 fixed at its cause ---------------------
{
  // Three rounds of moves after the fill and newer placer rules each passed
  // their own checks and still made some whole boards worse than a930f09's
  // engine made them on the same data. generatePlan builds both and keeps the
  // improved board only where it is no worse on every hard measure; these are
  // the students the round-3 reviews found.
  console.log('\nThe gate and round 4:');
  const at = (b, code) => b.board.terms.findIndex((t) => t.courseIds.includes(byCode.get(code)?.id));
  const termCodes = (b) => b.board.terms.map((t) => codesOf(t.courseIds).join(','));
  const sample = [
    ['las/psychology-bslas', 'medical school', 2],
    ['las/chemistry-bs', '', 4],
    ['las/chemistry-bs/environmental-chemistry', '', 4],
    ['aces/dietetics-nutrition-bs', 'physical therapy school', 4],
    ['engineering/industrial-engineering-bs', '', 4],
    ['las/classics-balas/classical-languages', '', 2],
    ['bus/finance-bs', '', 2],
  ];
  for (const [program, goal, lang] of sample) {
    const b = build({ program, prior: { ...FRESHMAN, languageSemesters: lang }, words: goal, career: goal });
    const plain = build({ program, prior: { ...FRESHMAN, languageSemesters: lang }, words: goal, career: goal, extra: { plainEngine: true } });
    const gate = b.g.gate;
    const name = `${program} (${goal || 'no goal'}, language ${lang})`;
    console.log(`  ${name}: kept ${gate?.kept}${gate?.worse.length ? `, improved board worse on ${gate.worse.join(', ')}` : ''}`);
    check(gate !== undefined && (gate.kept === 'plain' || gate.worse.length === 0), `${name}: the gate kept a board and said why`);
    check(plain.g.gate === undefined, `${name}: the plain engine's board carries no gate record`);
    // The plain board kept is the plain engine's, but for College Algebra at
    // or after calculus, which comes off it (AutoplanInput.algebraRepair).
    const noAlgebra = (x) => termCodes(x).map((t) => t.split(',').filter((c) => c !== 'MATH 112').join(',')).join('|');
    if (gate?.kept === 'plain') check(noAlgebra(b) === noAlgebra(plain), `${name}: the board kept is the plain engine's`);
    // Never a word to the student about which board it is.
    check(!b.g.notes.some((n) => /\b(plain|improved) (board|engine)\b/i.test(n)), `${name}: no note names the gate`);
    // Nothing a requirement names outright that the plain board places is
    // left off, and no more of the list picks, prerequisites and track rows
    // (the gate's notPlaced measure since round 5: which of a short list's
    // courses fit is no loss when as many fit, and Classical Languages traded
    // two picks from a track it cannot fill for LAST 210 and GLBL 200, the
    // one course each of two gen-ed categories lacked).
    const kindOf = (n) => b.L.blocks.find((r) => r.id === n.requirementId)?.rule.kind ?? (n.requirementId ? 'all' : null);
    const required = (g) => new Set(g.notPlaced.filter((n) => kindOf(n) === 'all').map((n) => n.code));
    const picks = (g) => new Set(g.notPlaced.filter((n) => kindOf(n) !== 'all').map((n) => n.code)).size;
    const [reqB, reqP] = [required(b.g), required(plain.g)];
    const lost = [...reqB].filter((c) => !reqP.has(c));
    check(lost.length === 0 && picks(b.g) + reqB.size <= picks(plain.g) + reqP.size, `${name}: no required course left off that the plain board places, and no more courses off (${lost.join(', ') || 'none'}; ${picks(b.g) + reqB.size} off against ${picks(plain.g) + reqP.size})`);
  }

  // College Algebra at or after calculus: a Business freshman's CS 105 had
  // MATH 112 booked beside the MATH 220 she placed into, and a Speech and
  // Hearing Science freshman's CHEM 108 the spring after it.
  const calculus = ['MATH 220', 'MATH 221', 'MATH 231', 'MATH 234'];
  for (const [program, goal, lang] of [
    ['bus/business-undeclared', '', 2],
    ['las/econometrics-quantitative-economics-bslas', '', 2],
    ['las/earth-society-environmental-sustainability-bslas', '', 2],
    ['aces/computer-science-crop-sciences-bs', '', 4],
    ['ahs/speech-hearing-science-bs', '', 2],
    ['las/astronomy-bslas', 'physical therapy school', 2],
    ['education/middle-grades-education-bs/mathematics', '', 2],
  ]) {
    const b = build({ program, prior: { ...FRESHMAN, languageSemesters: lang }, words: goal, career: goal });
    const m112 = at(b, 'MATH 112');
    const calc = Math.min(...calculus.map((c) => at(b, c)).filter((i) => i >= 0));
    check(m112 < 0 || m112 < calc, `${program} (${goal || 'no goal'}): no MATH 112 at or after calculus (MATH 112 term ${m112}, calculus term ${calc})`);
  }
  const bus = build({ program: 'bus/business-undeclared', prior: { ...FRESHMAN, languageSemesters: 2 } });
  check(at(bus, 'MATH 112') < 0 && bus.g.notes.some((n) => n.startsWith('CS 105 asks for "MATH 112."') && /placement/.test(n)), 'Business Undeclared: CS 105 stands on the MATH 220 placement, and the plan says so');
  check(!A.validatePlan(bus.board, context, bus.options).some((i) => i.severity === 'error'), 'Business Undeclared: the review list agrees (no prerequisite error for CS 105)');

  // The MCAT-spring repair held to the uncertain prerequisites: CHEM 436 went
  // to a pre-med Chemistry freshman's second term, a year before CHEM 236.
  const chemMed = build({ program: 'las/chemistry-bs', prior: { ...FRESHMAN, languageSemesters: 2 }, words: 'medical school', career: 'medical school' });
  check(at(chemMed, 'CHEM 436') > at(chemMed, 'CHEM 236'), `pre-med Chemistry: CHEM 436 after CHEM 236 (terms ${at(chemMed, 'CHEM 436')} and ${at(chemMed, 'CHEM 236')})`);

  // MCB 101 held to MCB 100 as a lab cost a pre-PT Dietetics freshman ETMA
  // 311 and HK 250; without that pairing both are on her board.
  const diet = build({ program: 'aces/dietetics-nutrition-bs', prior: { ...FRESHMAN, languageSemesters: 4 }, words: 'physical therapy school', career: 'physical therapy school' });
  check(at(diet, 'ETMA 311') >= 0 && at(diet, 'HK 250') >= 0, 'pre-PT Dietetics: ETMA 311 and HK 250 on the board');

  // SE 311 and SE 312, both hardest-band and wanted by nothing on the board,
  // took an Industrial Engineering freshman's Spring 2029 and cost IE 371 and IE 431.
  const ie = build({ program: 'engineering/industrial-engineering-bs', prior: { ...FRESHMAN, languageSemesters: 4 } });
  check(at(ie, 'IE 371') >= 0 && at(ie, 'IE 431') >= 0, 'Industrial Engineering: IE 371 and IE 431 on the board');

  // spreadHard(2), the board's last move, took pre-med Emma's PSYC 235, her
  // degree's statistics, from Fall 2027 to Spring 2029.
  const emma2 = build({ program: 'las/psychology-bslas', prior: { ...FRESHMAN, languageSemesters: 2 }, words: 'medical school', career: 'medical school' });
  const emmaPlain = build({ program: 'las/psychology-bslas', prior: { ...FRESHMAN, languageSemesters: 2 }, words: 'medical school', career: 'medical school', extra: { plainEngine: true } });
  check(at(emma2, 'PSYC 235') <= at(emmaPlain, 'PSYC 235'), `pre-med Psychology, 2 semesters of Spanish: PSYC 235 no later than on the plain board (terms ${at(emma2, 'PSYC 235')} and ${at(emmaPlain, 'PSYC 235')})`);

  // A one-credit seminar goes on top of a 16-credit first-year term: a
  // Theatre freshman's year one of 16 and 16 left FAA 101 in Fall 2027.
  const theatre = build({ program: 'faa/theatre-bfa/scenic-design', prior: { ...FRESHMAN, languageSemesters: 2 } });
  check(V.firstYearTerms(theatre.board).some((t) => t.courseIds.includes(byCode.get('FAA 101')?.id)), `Theatre, Scenic Design: FAA 101 in year one (${termOfCode(theatre.board, 'FAA 101')?.label})`);

  // The first-term seminar warning is for a first-year: a 60-hour transfer
  // and a continuing sophomore were told ENG 100 belonged in "the first
  // year", and an international student's LAS 100 was never read as hers.
  const civil = build({ program: 'engineering/civil-engineering-bs', prior: { ...FRESHMAN, languageSemesters: 4 } });
  const late = moved(civil.board, 'ENG 100', 'Fall 2028');
  const seminarLate = (options) => A.validatePlan(late, context, { ...civil.options, ...options }).some((i) => i.id.startsWith('ap-seminar-late-'));
  check(seminarLate({}), 'Civil Engineering freshman: ENG 100 in Fall 2028 is flagged');
  check(!seminarLate({ firstYear: false }), 'Civil Engineering continuing student: ENG 100 in Fall 2028 is not called a first-year course');
  check(!seminarLate({ arrival: { transfer: true, international: false } }), 'Civil Engineering transfer: ENG 100, held for first-time freshmen, is not asked of her');
  const ess = build({ program: 'las/earth-society-environmental-sustainability-bslas', prior: { ...FRESHMAN, languageSemesters: 4 } });
  const essLate = ess.board.terms.find((t) => t.label === 'Fall 2028');
  const lasLate = { ...ess.board, terms: ess.board.terms.map((t) => (t.id === essLate.id ? { ...t, courseIds: [...t.courseIds, byCode.get('LAS 100').id] } : t)) };
  const intl = (international) => A.validatePlan(lasLate, context, { ...ess.options, arrival: { transfer: false, international } }).some((i) => i.id.includes('ap-seminar-late-') && i.courseId === byCode.get('LAS 100').id);
  check(intl(true) && !intl(false), 'LAS 100 after year one is flagged for an international student, and only for one');
}

// --- round 5: the plain engine a930f09's, the gate's measures, and their causes ---
{
  console.log('\nRound 5:');
  const at = (b, code) => b.board.terms.findIndex((t) => t.courseIds.includes(byCode.get(code)?.id));
  const plainOf = (program, goal, lang) => build({ program, prior: { ...FRESHMAN, languageSemesters: lang }, words: goal, career: goal, extra: { plainEngine: true } });
  const of = (program, goal, lang) => build({ program, prior: { ...FRESHMAN, languageSemesters: lang }, words: goal, career: goal });

  // The plain engine does not read MATH 112 as met by calculus a placement
  // enters: that reading is the improved engine's, and shared by both boards
  // it took AGCM 220 off a pre-med Construction Management freshman's plain
  // board, where a930f09 had it in Spring 2030, and the gate saw nothing.
  const cmPlain = plainOf('aces/engineering-technology-management-agricultural-systems-bs/construction-management', 'medical school', 2);
  check(at(cmPlain, 'AGCM 220') >= 0 && at(cmPlain, 'MATH 112') >= 0, 'plain engine, pre-med Construction Management: MATH 112 booked and AGCM 220 on the board, as a930f09 had them');

  // The gate kept the plain board for pre-med Environmental Chemistry, which
  // left off CEE 330, CHEM 420, CHEM 442, CHEM 444 and CHEM 445 and put
  // organic chemistry before general chemistry. The pre-PT boards still keep
  // the plain board: every improved board either drops PSYC 238, which the
  // plain board has before the application, or takes her first fall to 18.
  for (const [goal, lang] of [['medical school', 2], ['medical school', 4]]) {
    const ec = of('las/chemistry-bs/environmental-chemistry', goal, lang);
    const off = ['CEE 330', 'CHEM 420', 'CHEM 442', 'CHEM 444', 'CHEM 445'].filter((c) => at(ec, c) < 0);
    check(off.length === 0, `Environmental Chemistry (${goal}, language ${lang}): every required chemistry course on the board (${off.join(', ') || 'all there'})`);
    check(at(ec, 'CHEM 204') >= 0 && at(ec, 'CHEM 204') < at(ec, 'CHEM 236'), `Environmental Chemistry (${goal}, language ${lang}): CHEM 204 before CHEM 236 (terms ${at(ec, 'CHEM 204')} and ${at(ec, 'CHEM 236')})`);
  }

  // The same missing-MATH-112 fault in another term is the same fault: read
  // by term, the gate handed a pre-PT Fine and Applied Arts freshman the
  // board with CHEM 102 in her last term.
  const faa = of('faa/fine-applied-arts-ba', 'physical therapy school', 2);
  const last = faa.board.terms.reduce((n, t, i) => (t.courseIds.length > 0 ? i : n), -1);
  check(at(faa, 'CHEM 102') >= 0 && at(faa, 'CHEM 102') < last, `pre-PT Fine and Applied Arts: CHEM 102 before her last term (term ${at(faa, 'CHEM 102')} of ${last})`);

  // A prior-learning note the board contradicts goes: "This plan does not
  // book MATH 112" beside MATH 112 in a pre-med Information Sciences first fall.
  const is = of('ischool/information-sciences-bs', 'medical school', 2);
  check(!(at(is, 'MATH 112') >= 0 && is.g.notes.some((n) => /does not book MATH 112/.test(n) && n.startsWith('IS 203'))), 'pre-med Information Sciences: no note says MATH 112 is not booked while it is');

  // The exemption note names the calculus the placement enters.
  const bds = of('bus/business-data-science-bs', 'medical school', 2);
  const bdsNote = bds.g.notes.find((n) => n.startsWith('CHEM 102 asks for'));
  check(bdsNote === undefined || (!/MATH 227/.test(bdsNote) && /MATH 23[14]|MATH 22[01]/.test(bdsNote)), `pre-med Business Data Science: the CHEM 102 note names a placement calculus (${bdsNote?.slice(0, 90) ?? 'no note'})`);
  const mge = of('education/middle-grades-education-bs/mathematics', 'medical school', 2);
  const mgeNote = mge.g.notes.find((n) => n.startsWith('CHEM 102 asks for'));
  check(mgeNote === undefined || !/MATH 103/.test(mgeNote), `pre-med Middle Grades Mathematics: the CHEM 102 note does not call MATH 103 a placement (${mgeNote?.slice(0, 90) ?? 'no note'})`);

  // No move after the fill puts a course in the crawled term where its
  // schedule shows no sections: ANSC 101 went from Spring 2027 into Fall 2026.
  const ansc = of('aces/animal-sciences-bs', '', 2);
  check(!A.validatePlan(ansc.board, context, ansc.options).some((i) => i.id.startsWith('ap-snapshot-') && i.courseId === byCode.get('ANSC 101')?.id), `Animal Sciences: ANSC 101 not moved into a term with no sections (${termOfCode(ansc.board, 'ANSC 101')?.label})`);

  // Year one held to 17 where that board is no worse: a Fish and Wildlife
  // freshman's 18 and 18 with NRES 123 in Fall 2027; and a two-credit
  // fall-only seminar goes on top of a 15-credit first fall.
  const fw = of('aces/natural-resources-environmental-sciences-bs/fish-wildlife-conservation-biology', '', 2);
  const fwYear = new Set(V.firstYearTerms(fw.board).map((t) => t.id));
  check(fw.g.terms.filter((t) => fwYear.has(t.id)).every((t) => t.credits.min <= 17), `Fish and Wildlife: no first-year term over 17 (${fw.g.terms.filter((t) => fwYear.has(t.id)).map((t) => t.credits.min).join(', ')})`);
  check(V.firstYearTerms(fw.board).some((t) => t.courseIds.includes(byCode.get('NRES 123')?.id)), `Fish and Wildlife: NRES 123 in year one (${termOfCode(fw.board, 'NRES 123')?.label})`);
  const fp = of('aces/agricultural-consumer-economics-bs/financial-planning', '', 4);
  check(V.firstYearTerms(fp.board).some((t) => t.courseIds.includes(byCode.get('ACE 123')?.id)), `Financial Planning: ACE 123 in year one (${termOfCode(fp.board, 'ACE 123')?.label})`);

  // A light last term takes a course a heavier term can spare before the
  // planner books padding: CHEM 108, which the catalog says does not count
  // toward a Chemistry major, filled a pre-med's last spring.
  const chemMed2 = of('las/chemistry-bs', 'medical school', 2);
  check(at(chemMed2, 'CHEM 108') < 0, 'pre-med Chemistry: no CHEM 108 padding the last spring');

  // A list the board leaves short gives a seat to the one course a
  // requirement lacks: Classical Languages lost LAST 210, its Non-Western
  // Cultures course, once LAS 100 and LAS 102 left the board.
  const cl = of('las/classics-balas/classical-languages', '', 2);
  check(at(cl, 'LAST 210') >= 0 && !cl.g.unsatisfied.some((u) => /Non-Western/.test(u.label)), 'Classical Languages: LAST 210 on the board and Non-Western Cultures met');
}

console.log(failures === 0 ? '\nREVIEW CHECK: all clean' : `\nREVIEW CHECK: ${failures} ${failures === 1 ? 'failure' : 'failures'}`);
process.exit(failures === 0 ? 0 : 1);
