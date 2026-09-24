/**
 * The re-pick, replayed on real students the way the board runs it.
 *
 * Run it with:  PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__repick.check.mjs
 * It re-execs itself with the type-stripping flag, so no build step is needed.
 * Exits non-zero on any failure.
 *
 * The Re-pick button and ALMA's set_priorities both call repickBoard in
 * lib/planner/repick.ts with the marks planMarks builds, and so does this
 * file, over the same files the browser loads (public/illinois/*). The audit
 * of 2026-09-24 found, on these students, that a re-pick:
 *
 *   - took every career-track course off Aaliyah's pre-PT board (MCB 150,
 *     PHYS 101, IB 150, ...) and SOC 100 off Emma's pre-med one;
 *   - left MATH 231 and ACCY 201 on Marcus's Finance board without MATH 220
 *     and ECON 103, and PSYC 350 on Sofia's without PSYC 250;
 *   - put Emma's Spring 2028 at 20 credits and Jordan's Fall 2028 at 21;
 *   - put CS 470 (fall only) in Ethan's spring, and LAS 102 ("for first-term
 *     LAS transfer students only") and FIN 390 ("Induction into the Finance
 *     Academy") on boards they are closed to;
 *   - swapped RHET 105 for CMN 111, half of a two-course sequence;
 *   - moved 10 to 20 courses when nothing had changed, and more again on a
 *     second press, reporting chains of swaps as separate changes.
 *
 * Each of those is a check below, on every student and every set of
 * priorities the audit used.
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

// The repo imports without extensions and through the '@/' alias (live-pools.ts
// reads '@/lib/planner/autoplan'), neither of which node resolves on its own.
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

// --- the students the audit used ---------------------------------------------
const FRESHMAN = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };
const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: false };
// Jordan's Parkland record, as the transcript reader matched it (scenario reading jordan-parkland).
const JORDAN = {
  courseCodes: ['RHET 105', 'PSYC 100', 'SPAN 101', 'SPAN 102', 'SOC 100', 'SPAN 201', 'PHIL 101', 'ENGL 101', 'PSYC 201'],
  exemptCodes: [],
  unmatchedCredits: 17,
  known: true,
  languageSemesters: 2,
  languageName: 'Spanish',
  genEdCredits: [
    { id: 'Parkland College MAT 160 #6', label: 'MAT 160 Statistics (Parkland College)', credits: 4, tags: ['Quantitative Reasoning I'] },
    { id: 'Parkland College PSY 209 #9', label: 'PSY 209 Human Growth and Development (Parkland College)', credits: 3, tags: ['Social & Beh Sci - Beh Sci'] },
    { id: 'Parkland College HUM 101 #11', label: 'HUM 101 Western Culture: Antiquity to Renaissance (Parkland College)', credits: 3, tags: ['Cultural Studies - Western', 'Humanities - Lit & Arts'] },
    { id: 'Parkland College AST 101 #12', label: 'AST 101 The Solar System (repeat) (Parkland College)', credits: 4, tags: ['Nat Sci & Tech - Phys Sciences', 'Quantitative Reasoning II'] },
    { id: 'Parkland College ANT 103 #15', label: 'ANT 103 Intro to Cultural Anthropology (Parkland College)', credits: 3, tags: ['Cultural Studies - Non-West', 'Social & Beh Sci - Soc Sci'] },
  ],
};
const STUDENTS = [
  { name: 'Aaliyah, Kinesiology, pre-PT', program: 'ahs/kinesiology-bs/applied-exercise-science', studying: 'Kinesiology', after: 'physical therapy school', track: true },
  { name: 'Emma, Psychology, pre-med', program: 'las/psychology-bslas', studying: 'Psychology, pre-med.', after: 'I want to go to medical school so I need to keep my GPA up.', track: true },
  { name: 'Sofia, Psychology', program: 'las/psychology-bslas', studying: 'Psychology', after: 'UX research or data analytics' },
  { name: 'Marcus, Finance', program: 'bus/finance-bs', studying: 'Finance', after: 'Investment banking in Chicago' },
  { name: 'Ethan, Computer Science', program: 'engineering/computer-science-bs', studying: 'Computer science', after: 'software engineer' },
  {
    name: 'Jordan, Parkland transfer, Psychology', program: 'las/psychology-bslas', studying: 'Psychology', after: 'clinical and counseling', prior: JORDAN, horizon: { startSeason: 'Fall', startYear: 2027, gradSeason: 'Spring', gradYear: 2029, stated: true },
    // His orientation row is LAS 102, and no re-pick trades it for LAS 101 or LAS 100.
    arrival: A.arrivalFromWords("I'm finishing my associate's at Parkland this year and transferring to Illinois in Fall 2027 as a junior."), orientation: 'LAS 102',
  },
  { name: 'Dev, Advertising', program: 'media/advertising-bs', studying: 'Advertising', after: 'creative and brand strategy' },
  { name: 'Noah, Economics', program: 'las/economics-balas', studying: 'Economics', after: 'consulting' },
];
const BALANCED = PRIORITY_PRESETS.balanced;
const SCENARIOS = [
  ['lightest', PRIORITY_PRESETS.lightest],
  ['teaching', PRIORITY_PRESETS.teaching],
  ['workload 2', { ...BALANCED, workload: 2 }],
  ['workload 2 alone', { ...BALANCED, workload: 2, teaching: 0, relevance: 0, coverage: 0, schedule: 0 }],
  ['workload 2 + relevance 2', { ...BALANCED, workload: 2, relevance: 2 }],
];

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL ${msg}`);
};
const credits = (code) => A.planCreditRange([code], context).min;
const termCredits = (t) => A.planCreditRange(t.courseIds.map((id) => byId.get(id)?.code).filter(Boolean), context);
const codesOn = (b) => b.terms.flatMap((t) => t.courseIds).map((id) => norm(byId.get(id)?.code ?? ''));

// --- the pieces on their own ---------------------------------------------------
{
  console.log('Restricted to other students:');
  const psych = { programName: 'Psychology, BSLAS', programCollege: 'las' };
  const finance = { programName: 'Finance, BS', programCollege: 'bus' };
  const computing = { programName: 'Computer Science, BS', programCollege: 'engineering' };
  const closed = [
    { code: 'LAS 102', who: psych },
    { code: 'FIN 390', who: finance },
    { code: 'LAS 100', who: psych },
    { code: 'MCB 297', who: psych },
    { code: 'FSHN 123', who: psych },
    // "Restricted to first-year students in LAS": closed to a Gies student.
    { code: 'LAS 101', who: finance },
    // ...and to an LAS transfer student, whose orientation row is LAS 102.
    { code: 'LAS 101', who: { ...psych, arrival: { transfer: true, international: false } } },
    // Behind an application or someone's approval (admissionGate): the five
    // Finance academies every Finance plan used to book, BADM 390 ("normally
    // invited by the faculty"), and a teacher education course.
    { code: 'FIN 391', who: finance },
    { code: 'FIN 392', who: finance },
    { code: 'FIN 393', who: finance },
    { code: 'FIN 394', who: finance },
    { code: 'FIN 395', who: finance },
    { code: 'BADM 390', who: finance },
    { code: 'CI 405', who: psych },
    // "Consent of instructor required for non-theatre majors."
    { code: 'THEA 100', who: finance },
  ];
  for (const { code, who } of closed) {
    const why = R.restrictedToOthers(byCode.get(code), context, who);
    console.log(`  ${code}: ${why ?? 'open'}`);
    if (!why) fail(`${code} should read as restricted to other students`);
  }
  const open = [
    { code: 'PSYC 100', who: psych },
    { code: 'FIN 221', who: finance },
    { code: 'CMN 101', who: psych },
    { code: 'STAT 200', who: psych },
    // ...but open to an LAS one, whatever the full stop after "LAS" does.
    { code: 'LAS 101', who: psych },
    // "Restricted to Junior, Senior or Graduate students" is a standing rule.
    { code: 'GGIS 425', who: psych },
    // "Restricted to non-dance majors" shuts out dance majors only.
    { code: 'DANC 216', who: computing },
    // "Senior, Graduate standing or consent of instructor required": consent is a way in, not a gate.
    { code: 'ARTD 487', who: psych },
    // "Consent of instructor required for non-theatre majors" is open to a theatre major.
    { code: 'THEA 100', who: { programName: 'Theatre, BFA', programCollege: 'faa', primary: 'THEA' } },
  ];
  for (const { code, who } of open) {
    const why = R.restrictedToOthers(byCode.get(code), context, who);
    if (why) fail(`${code} is open to a ${who.programName} student, but read as "${why}"`);
  }
}
{
  console.log('Gen-ed candidates for RHET 105 (Composition I):');
  const L = load('las/psychology-bslas');
  const rhet = byCode.get('RHET 105');
  const board = { schemaVersion: 1, programId: 'x', graduationLabel: '', completedCourseIds: [], terms: [{ id: 't1', label: 'Fall 2026', year: 1, season: 'Fall', courseIds: [rhet.id] }] };
  const scorer = A.qualityScorer({ context, requirements: L.blocks, interests: 'Psychology', programName: L.program.name, priorities: BALANCED, carriedCodes: [] });
  const offered = R.genEdCandidates({ context, requirements: L.blocks, board, courseId: rhet.id, scorer }).map((c) => norm(c.course.code));
  console.log(`  offered: ${offered.join(', ') || 'none'}`);
  for (const half of ['CMN 111', 'CMN 112', 'RHET 101', 'RHET 102', 'ESL 111', 'ESL 112']) {
    if (offered.includes(half)) fail(`${half} is half of a two-course sequence and must not stand in for RHET 105`);
  }
  // A Social Science pick keeps its intro alternatives: the sequence rule is narrow on purpose.
  const soc = byCode.get('SOC 100');
  const socBoard = { ...board, terms: [{ ...board.terms[0], courseIds: [soc.id] }] };
  const socOffered = R.genEdCandidates({ context, requirements: L.blocks, board: socBoard, courseId: soc.id, scorer }).map((c) => norm(c.course.code));
  if (!socOffered.includes('PSYC 100') && !socOffered.includes('ECON 102') && !socOffered.includes('ANTH 101')) fail('an intro course (PSYC 100, ECON 102, ANTH 101) should still stand in for SOC 100');
}

// --- the re-pick on every student ----------------------------------------------
/** A student's generated board and everything a re-pick of it reads. */
function build(st) {
  const L = load(st.program);
  const prior = st.prior ?? FRESHMAN;
  const interests = [st.studying, st.after].join(' ');
  const degreeTotal = L.summary.totalCredits || L.program.totalCredits || 120;
  const g = A.generatePlan({
    requirements: L.blocks,
    context,
    prior,
    horizon: st.horizon ?? FOUR_YEARS,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: BALANCED },
    programId: L.summary.id,
    degreeTotal,
    interests,
    programName: L.program.name,
    programCollege: L.program.college,
    arrival: st.arrival,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  });
  const board = g.plan;
  const priorCredits = A.planCreditRange(board.completedCourseIds.map((id) => byId.get(id)?.code).filter(Boolean), context).min + prior.unmatchedCredits;
  const pools = livePools({ base: g.pools, blocks: L.blocks, boardCodes: codesOn(board), priorCodes: board.completedCourseIds.map((id) => norm(byId.get(id)?.code ?? '')), context });
  const marks = R.planMarks({ pools, language: g.language, electives: g.electives, genEdPicks: g.genEdPicks ?? [], addedPrerequisites: g.addedPrerequisites }, byCode);
  const tracked = g.electives.filter((e) => e.track).map((e) => norm(e.code));
  const input = { context, requirements: L.blocks, board, marks, pools, prior, interests, programName: L.program.name, programCollege: L.program.college, minimumTermCredits: 12, priorCredits, degreeTotal, trackPicks: tracked, arrival: st.arrival };
  return { L, g, board, input, tracked, built: R.repickSignature(BALANCED, interests), st };
}

/** Every rule a re-pick has to keep, on one result. Returns what broke. */
function audit(b, run) {
  const { L, board, input, tracked } = b;
  const options = { minimumTermCredits: 12, maxTermCredits: 18, programName: L.program.name, programCollege: L.program.college, priorCredits: input.priorCredits };
  const breaks = (i) => R.isBlockingIssue(i) || i.id.startsWith('ap-prereq-check-');
  const brokeBefore = new Set(A.validatePlan(board, context, options).filter(breaks).map((i) => i.id));
  const after = A.validatePlan(run.board, context, options);
  const start = new Set(codesOn(board));
  const final = new Set(codesOn(run.board));
  const total0 = A.planCreditRange([...start], context).min + input.priorCredits;
  const total1 = A.planCreditRange([...final], context).min + input.priorCredits;
  const problems = [];
  const lostTrack = tracked.filter((c) => !final.has(c));
  if (lostTrack.length) problems.push(`career-track courses removed: ${lostTrack.join(' ')}`);
  run.board.terms.forEach((t, i) => {
    const cap = t.season === 'Summer' ? 9 : 18;
    const now = termCredits(t).min;
    if (now > cap && now > termCredits(board.terms[i]).min) problems.push(`${t.label} at ${now} credits`);
    if (t.season !== 'Summer' && termCredits(t).max < 12 && !(termCredits(board.terms[i]).max < 12)) problems.push(`${t.label} under the minimum`);
  });
  const broke = after.filter((i) => breaks(i) && !brokeBefore.has(i.id));
  if (broke.length) problems.push(`new prerequisite or standing issues: ${broke.map((i) => i.message).join(' / ')}`);
  if (total1 < input.degreeTotal && total1 < total0) problems.push(`plan fell to ${total1} of ${input.degreeTotal}`);
  const froms = run.changes.map((c) => norm(c.from)).filter(Boolean);
  for (const c of run.changes) {
    const to = norm(c.to);
    const course = byCode.get(to);
    if (start.has(to)) problems.push(`${to} was already on the board`);
    if (froms.includes(to)) problems.push(`${to} swapped in and out again`);
    if (c.kind === 'track' && !c.track) problems.push(`${to} was booked for a track without its name`);
    if (c.from && (byCode.get(norm(c.from))?.tags ?? []).includes('Composition I')) problems.push(`Composition I pick ${c.from} re-picked to ${to}`);
    if (c.from && credits(c.from) < 3 && credits(to) !== credits(c.from)) problems.push(`${c.from} (${credits(c.from)} cr) became ${to} (${credits(to)} cr)`);
    if (c.from && tracked.includes(norm(c.from))) problems.push(`track course ${c.from} swapped out`);
    const closed = R.restrictedToOthers(course, context, { programName: L.program.name, programCollege: L.program.college, arrival: b.st.arrival });
    if (closed) problems.push(`swapped in a course for other students: ${closed}`);
    if (['LAS 102', 'FIN 390', 'LAS 100', 'MCB 297', 'MCB 298'].includes(to)) problems.push(`swapped in ${to}`);
    const off = after.find((i) => i.courseId === course?.id && i.termId === c.termId && /^ap-(offering|snapshot|dormant|closed)-/.test(i.id));
    if (off) problems.push(off.message);
  }
  if (new Set(froms).size !== froms.length) problems.push('a course was reported swapped out twice');
  if (b.st.orientation && !final.has(b.st.orientation)) problems.push(`${b.st.orientation}, the orientation course for this student, is gone`);
  // The subject cap counts what this call swapped in: no subject grows past
  // the fill's own ceiling (ten for the major, fewer for the rest).
  const { marks } = input;
  const countBy = (ids) => ids.reduce((m, id) => m.set(byId.get(id)?.cluster, (m.get(byId.get(id)?.cluster) ?? 0) + 1), new Map());
  const capped0 = countBy(board.terms.flatMap((t) => t.courseIds).filter((id) => ['elective', 'track'].includes(marks.get(id)?.kind)));
  const inIds = new Set(run.changes.filter((c) => c.kind !== 'gened' && c.kind !== 'pool').map((c) => byCode.get(norm(c.to))?.id));
  const outIds = new Set(run.changes.map((c) => byCode.get(norm(c.from))?.id).filter(Boolean));
  const capped1 = countBy(run.board.terms.flatMap((t) => t.courseIds).filter((id) => inIds.has(id) || (!outIds.has(id) && ['elective', 'track'].includes(marks.get(id)?.kind))));
  for (const [subject, n] of capped1) if (n > Math.max(capped0.get(subject) ?? 0, 10)) problems.push(`${subject} fills ${n} elective slots`);
  return { problems, total1 };
}

const describe = (run) => ['track', 'elective', 'pool', 'gened'].map((k) => `${k} ${run.changes.filter((c) => c.kind === k).length}`).join(', ');

for (const st of STUDENTS) {
  const b = build(st);
  const { g, board, input, tracked, built } = b;
  const total0 = A.planCreditRange(codesOn(board), context).min + input.priorCredits;
  console.log(`\n${st.name}: ${g.terms.length} terms, ${total0} of ${input.degreeTotal} credits, ${tracked.length} career-track ${tracked.length === 1 ? 'course' : 'courses'}${tracked.length ? ` (${tracked.join(' ')})` : ''}`);

  // Track picks carry their track, and the board marks them as track cards.
  for (const e of g.electives) if (e.why.startsWith('For ') && !e.track) fail(`${e.code} was booked "${e.why.slice(0, 60)}" without its track`);
  if (st.track && tracked.length === 0) fail('a career track was named and nothing was booked for it');
  if (st.orientation && !codesOn(board).includes(st.orientation)) fail(`${st.orientation} is the orientation row's course for this student and the build did not book it`);
  for (const code of tracked) {
    const mark = input.marks.get(byCode.get(code)?.id);
    if (mark && mark.kind !== 'track' && mark.kind !== 'pool') fail(`${code} is booked for a track but marked ${mark.kind}`);
  }

  // Unchanged priorities: nothing moves.
  const same = R.repickBoard({ ...input, priorities: BALANCED, lastSignature: built });
  if (!same.unchanged || same.changes.length > 0) fail(`a re-pick with the priorities the board was built for moved ${same.changes.length} courses`);

  for (const [label, priorities] of SCENARIOS) {
    const t0 = Date.now();
    const run = R.repickBoard({ ...input, priorities, lastSignature: built });
    const ms = Date.now() - t0;
    const { problems, total1 } = audit(b, run);
    // A second press with the same priorities moves nothing.
    const again = R.repickBoard({ ...input, board: run.board, priorities, lastSignature: run.signature });
    if (!again.unchanged || again.changes.length > 0) problems.push(`a second identical re-pick moved ${again.changes.length}`);
    console.log(`  ${label.padEnd(25)} ${String(run.changes.length).padStart(2)} changes (${describe(run)}), ${total1} credits, ${ms} ms${problems.length ? '' : ', clean'}`);
    for (const p of problems) fail(`${st.name}, ${label}: ${p}`);
  }
}

// --- a goal named after the build: the track claims slots first --------------
{
  // Sofia's board was built for UX research; then she tells ALMA "physical
  // therapy school, and easier electives". The track's courses take elective
  // slots before any lighter pick, under the same checks, and carry the
  // track so the next re-pick leaves them alone.
  const b = build(STUDENTS.find((s) => s.name.startsWith('Sofia')));
  const interests = `${b.input.interests} Actually I want to go to physical therapy school.`;
  const run = R.repickBoard({ ...b.input, interests, priorities: PRIORITY_PRESETS.lightest, lastSignature: b.built });
  const booked = run.changes.filter((c) => c.kind === 'track');
  const { problems, total1 } = audit(b, run);
  console.log(`\nSofia names physical therapy school after the build: ${run.changes.length} changes (${describe(run)}), ${total1} credits${problems.length ? '' : ', clean'}`);
  console.log(`  booked for the track: ${booked.map((c) => `${c.to} in ${c.term}${c.from ? ` for ${c.from}` : ' beside its lecture'}`).join('; ') || 'nothing'}`);
  for (const p of problems) fail(`Sofia, physical therapy named later: ${p}`);
  if (booked.length < 3) fail(`the pre-PT track claimed ${booked.length} elective slots; expected its biology and physics`);
  // The next re-pick sees them as track cards and never moves them.
  const electives = [...b.g.electives];
  for (const c of run.changes) {
    const at = electives.findIndex((e) => norm(e.code) === norm(c.from));
    if (c.kind === 'track' && at >= 0) electives[at] = { code: c.to, why: c.why, reasons: [], track: c.track };
    else if (c.kind === 'track' && !c.from) electives.push({ code: c.to, why: c.why, reasons: [], track: c.track });
  }
  const pools = livePools({ base: b.g.pools, blocks: b.L.blocks, boardCodes: codesOn(run.board), priorCodes: [], context });
  const marks = R.planMarks({ pools, language: b.g.language, electives, genEdPicks: b.g.genEdPicks ?? [], addedPrerequisites: b.g.addedPrerequisites }, byCode);
  const unmarked = booked.filter((c) => marks.get(byCode.get(norm(c.to))?.id)?.kind !== 'track');
  if (unmarked.length) fail(`${unmarked.map((c) => c.to).join(', ')} booked for the track but not marked as track cards`);
  const next = R.repickBoard({ ...b.input, board: run.board, marks, pools, interests, trackPicks: electives.filter((e) => e.track).map((e) => e.code), priorities: PRIORITY_PRESETS.teaching, lastSignature: run.signature });
  const moved = booked.filter((c) => !codesOn(next.board).includes(norm(c.to)));
  if (moved.length) fail(`a later "best teaching" re-pick took off ${moved.map((c) => c.to).join(', ')}`);
}

console.log(failures === 0 ? '\nRE-PICK CHECK: all clean' : `\nRE-PICK CHECK: ${failures} ${failures === 1 ? 'failure' : 'failures'}`);
process.exit(failures === 0 ? 0 : 1);
