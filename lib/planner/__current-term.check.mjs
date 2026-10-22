/**
 * The semester in progress, at both schools (current-term.ts, plan-start.ts).
 *
 * The owner, 2026-10-20: show the current semester, marked "in progress",
 * filled with the student's actual classes (from their transcript, added by
 * hand, or confirmed when ORION asks "Are these your current classes?");
 * start planning new classes from the next semester they can still register
 * for (Spring 2027 on Oct 20, 2026); keep the current semester in view for the
 * assistants, so "how's my attendance this semester?" and "who's my professor
 * for ECON 2105?" are about the real classes, with My instructor on them.
 *
 * Before: a UGA board started in "this year's fall" and filled Fall 2026,
 * half over, with the planner's own picks; an Illinois board built in October
 * started in Spring 2027 with no Fall 2026 at all, so "this semester" had
 * nothing real to look at and resolveTerms fell back to Spring 2027.
 *
 * This check builds boards the way the browser does (Illinois over
 * public/illinois/*, UGA through uga-source.tsx over public/uga-*), runs the
 * shared horizonFor, and fails when:
 *
 *   1. planning does not start at the next open term at both schools, or an
 *      Illinois horizon for a student with no transcript changes (start,
 *      finish, what is assumed) from what it was;
 *   2. the current column appears for a student who has not started, twice
 *      for a board that already holds the term, or not at all for one who is
 *      in it;
 *   3. a transcript's in-progress classes do not land in it (and only those),
 *      or the confirm question is not asked once and then dropped;
 *   4. classes added by hand do not land in it, are doubled, cannot be taken
 *      off, or a partly entered term is counted short;
 *   5. the planner puts anything in it, or a UGA plan that starts in Spring
 *      reads as degree credits short;
 *   6. an old saved board or record stops loading, or the instructor the
 *      student set for a current class is lost on Rebuild;
 *   7. ALMA and ARCH cannot see the term: "this term" does not resolve to it,
 *      or the screen's tools and board description leave it out;
 *   8. the board bar ranks it badly: an empty current column with nothing
 *      else assumed does not get one prompt naming that column, first, with
 *      the shortfalls its classes would settle folded under it, or a column
 *      the transcript filled is asked about there too;
 *   9. the classes in it, the "yes, these are mine" and My instructor for
 *      them are not in an account save, or a schedule screenshot read by the
 *      existing upload does not land in the column.
 *
 *   node lib/planner/__current-term.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// Extensionless and '@/' imports, and .tsx transpiled, as __summer-terms.check.mjs loads them.
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
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
    return next(url, ctx);
  }
`));

const P = await import(join(HERE, 'plan-start.ts'));
const C = await import(join(HERE, 'current-term.ts'));
const S = await import(join(HERE, 'saved-board.ts'));
const I = await import(join(HERE, 'instructors.ts'));
const T = await import(join(HERE, 'transcript.ts'));
const { generatePlan } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { DEFAULT_PRIORITIES } = await import(join(HERE, 'priorities.ts'));
const G = await import(join(HERE, 'uga-planning-guidance.ts'));

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; console.log(`  ok    ${name}`); return; }
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}
const section = (title) => console.log(`\n${title}`);
const json = (v) => JSON.stringify(v);
const labels = (board) => board.terms.map((t) => t.label);
const term = (h) => (h ? `${h.season} ${h.year}` : 'none');
const span = (h) => `${h.startSeason} ${h.startYear} to ${h.gradSeason} ${h.gradYear}`;

/** Oct 20, 2026, mid-morning in Champaign and Athens: Fall 2026 is under way, adding a Fall class has closed. */
const TODAY = new Date('2026-10-20T15:00:00Z');
const answers = (schoolId, timeline, extra = {}) => ({
  schoolId, programLevel: 'undergraduate', programIds: [], minorIds: [], certificateIds: [], emphasisSelections: {}, collegeId: '',
  academicYear: '', graduationSeason: '', graduationYear: null, alreadyTakenCourseCodes: [], studying: '', timeline, after: timeline,
  exams: [], transferText: '', transcript: null, timelineAt: '2026-10-20T14:00:00Z', ...extra,
});
const FRESHMAN = { academicYear: 'first', graduationSeason: 'Spring', graduationYear: 2030 };
const line = (code, credits, termLabel, status, extra = {}) => ({
  code, title: `${code} title`, credits, grade: status === 'completed' ? 'A' : null, term: termLabel, status,
  matched: code, matchedBy: 'code', use: true, counts: 'course', ...extra,
});
const record = (schoolId, courses, extra = {}) => ({
  schoolId, fileName: 'transcript.pdf', readAt: '2026-10-20T14:00:00Z', institution: schoolId === 'uga' ? 'University of Georgia' : 'University of Illinois Urbana-Champaign',
  kind: 'transcript', home: true, files: ['transcript.pdf'], courses, exams: [], notes: [], ...extra,
});
const FALL26 = { season: 'Fall', year: 2026 };

// ---------------------------------------------------------------------------
section('1. Planning starts at the next term a student can still register for, at both schools');
{
  for (const school of ['illinois', 'uga']) {
    const h = P.horizonFor(answers(school, "I'm a freshman.", FRESHMAN), TODAY, S.NO_SHAPE);
    check(`${school}: a freshman on Oct 20, 2026 is planned from Spring 2027 to Spring 2030`, span(h) === 'Spring 2027 to Spring 2030', span(h));
    const none = P.horizonFor(answers(school, ''), TODAY, S.NO_SHAPE);
    check(`${school}: a student who said nothing is planned from Spring 2027 too (eight falls and springs, to Fall 2030)`, span(none) === 'Spring 2027 to Fall 2030', span(none));
    const incoming = P.horizonFor(answers(school, "I'm an incoming freshman."), TODAY, S.NO_SHAPE);
    check(`${school}: an incoming freshman who gives no finish starts in Fall 2027`, span(incoming) === 'Fall 2027 to Spring 2031', span(incoming));
    const august = P.horizonFor(answers(school, "I'm a freshman.", FRESHMAN), new Date('2026-08-20T15:00:00Z'), S.NO_SHAPE);
    check(`${school}: on Aug 20, before the add deadline, the plan starts in Fall 2026 itself, with no separate column`, august.startSeason === 'Fall' && august.startYear === 2026 && august.current === null, `${span(august)}, current ${term(august.current)}`);
  }
  /**
   * Illinois boards for students with no transcript keep their planned terms:
   * these are the horizons 8232d34's workspace gave (read with its own
   * horizonFor on 2026-10-20), start, finish, stated and assumed hours.
   */
  const BEFORE = [
    ['', {}, 'Spring 2027 to Fall 2030', false, 0],
    ["I'm a freshman.", FRESHMAN, 'Spring 2027 to Spring 2030', true, 15],
    ["I'm an incoming freshman.", FRESHMAN, 'Spring 2027 to Spring 2030', true, 0],
    ["I'm an incoming freshman.", {}, 'Fall 2027 to Spring 2031', false, 0],
    ["I'm a sophomore.", { academicYear: 'second', graduationSeason: 'Spring', graduationYear: 2029 }, 'Spring 2027 to Spring 2029', true, 0],
    ['High school senior, starting fall 2027.', {}, 'Fall 2027 to Spring 2031', false, 0],
  ];
  for (const [words, extra, want, stated, assumed] of BEFORE) {
    const h = P.horizonFor(answers('illinois', words, extra), TODAY, S.NO_SHAPE);
    check(`Illinois, no transcript, ${json(words)}: the same horizon as before (${want}${stated ? ', stated' : ''}, ${assumed} assumed)`, span(h) === want && Boolean(h.stated) === stated && h.assumedHours === assumed, `${span(h)}, stated ${h.stated}, assumed ${h.assumedHours}`);
  }
  const ugaFresh = P.horizonFor(answers('uga', "I'm a freshman.", FRESHMAN), TODAY, S.NO_SHAPE);
  check('UGA: the freshman\'s Fall 2026 is counted as about 15 credits until their classes are added, as at Illinois', ugaFresh.assumedHours === 15 && json(ugaFresh.assumedTerms) === json([FALL26]) && ugaFresh.beganFrom === 'standing', `${ugaFresh.assumedHours} for ${json(ugaFresh.assumedTerms)}`);
  check('and the plan says so plainly, naming the column', /this plan counts Fall 2026 as about 15 credits, the usual full load/.test(ugaFresh.startNote ?? '') && /in the Fall 2026 column/.test(ugaFresh.startNote ?? '') && /ARCH|in the Fall 2026 column/.test(ugaFresh.startNote ?? ''), ugaFresh.startNote ?? 'no note');
  check('a UGA note never names Illinois\'s assistant', !/ALMA/.test(JSON.stringify([ugaFresh.startNote, P.horizonFor(answers('uga', 'Senior, graduating fall 2026.', { academicYear: 'fourth' }), TODAY, S.NO_SHAPE).startNote])));
}

// ---------------------------------------------------------------------------
section('2. Who gets a current-semester column');
{
  for (const school of ['illinois', 'uga']) {
    check(`${school}: a freshman in October gets Fall 2026`, term(P.horizonFor(answers(school, "I'm a freshman.", FRESHMAN), TODAY, S.NO_SHAPE).current) === 'Fall 2026');
    check(`${school}: a student who said nothing gets it too, with nothing assumed`, (() => { const h = P.horizonFor(answers(school, ''), TODAY, S.NO_SHAPE); return term(h.current) === 'Fall 2026' && h.currentAssumedHours === 0; })());
    for (const [words, extra] of [["I'm an incoming freshman.", {}], ["I'm an incoming freshman.", FRESHMAN], ['High school senior, starting fall 2027.', {}], ['I start at the university in fall 2027.', {}]]) {
      const h = P.horizonFor(answers(school, words, extra), TODAY, S.NO_SHAPE);
      check(`${school}: ${json(words)}${extra.graduationYear ? ' (finish Spring 2030)' : ''} has not started here, so no column`, h.current === null, term(h.current));
    }
    check(`${school}: a term away that is the term in progress gets no column`, C.currentTermFor({ underWay: FALL26, start: { season: 'Spring', year: 2027 }, notStarted: false, away: [{ ...FALL26, kind: 'study_abroad' }] }) === null);
    const saved = P.horizonFor(answers(school, "I'm a freshman.", FRESHMAN), TODAY, S.NO_SHAPE, [{ label: 'Fall 2026' }, { label: 'Spring 2027' }]);
    check(`${school}: a board saved while Fall 2026 was open already holds it, so there is no second Fall 2026`, saved.current === null);
  }
  const june = new Date('2027-06-20T15:00:00Z');
  check('in June with no summer classes there is no column', P.horizonFor(answers('illinois', "I'm a freshman.", FRESHMAN), june, S.NO_SHAPE).current === null);
  const summer = P.horizonFor(answers('illinois', "I'm a freshman.", { ...FRESHMAN, transcript: record('illinois', [line('MATH 221', 4, 'Summer 2027', 'in_progress')]) }), june, S.NO_SHAPE);
  check('in June with a summer class in progress the column is Summer 2027', term(summer.current) === 'Summer 2027', term(summer.current));
}

// ---------------------------------------------------------------------------
section('3. A transcript\'s in-progress classes land in the column, and only those');
const ILL_RECORD = record('illinois', [
  line('PSYC 100', 4, 'Fall 2025', 'completed'),
  line('RHET 105', 4, 'Fall 2025', 'completed'),
  line('MATH 115', 3, 'Spring 2026', 'completed'),
  line('ECON 102', 3, 'Fall 2026', 'in_progress'),
  line('PSYC 204', 3, 'Fall 2026', 'in_progress'),
  line('STAT 100', 3, 'Fall 2026', 'in_progress'),
  line('CHEM 102', 3, 'Fall 2026', 'withdrawn', { use: false, counts: 'none' }),
]);
{
  const idOf = (code) => code.toLowerCase().replace(' ', '-');
  const h = P.horizonFor(answers('illinois', "I'm a sophomore.", { academicYear: 'second', transcript: ILL_RECORD }), TODAY, S.NO_SHAPE);
  check('the record\'s Fall 2026 classes start the plan in Spring 2027', h.startSeason === 'Spring' && h.startYear === 2027, span(h));
  check('the column is Fall 2026', term(h.current) === 'Fall 2026');
  const classes = C.currentClasses(ILL_RECORD, h.current, idOf);
  check('it holds the three in-progress classes, from the transcript, and not the withdrawn one or the completed ones', json(classes.map((c) => [c.code, c.from])) === json([['ECON 102', 'transcript'], ['PSYC 204', 'transcript'], ['STAT 100', 'transcript']]), json(classes));
  check('nothing is assumed for it: a transcript lists what they are registered for', h.currentAssumedHours === 0 && h.assumedHours === 0);
  check('the column asks "Are these your current classes?" once', C.currentQuestion(ILL_RECORD, h.current) === 'confirm');
  const yes = C.withCurrentConfirmed(ILL_RECORD, h.current, true);
  check('after Yes it asks nothing, and the record keeps the answer', C.currentQuestion(yes, h.current) === null && yes.currentConfirmed === 'Fall 2026' && ILL_RECORD.currentConfirmed === undefined);
  check('the answer does not change what the plan counts or rebuilds for (same held codes)', json(T.transcriptCodes(yes)) === json(T.transcriptCodes(ILL_RECORD)));
  const untimed = record('illinois', [line('ECON 102', 3, null, 'in_progress', { matchedBy: 'student' })]);
  check('a class told to the assistant as in progress before lines carried a term shows in the column too', json(C.currentClasses(untimed, FALL26, idOf).map((c) => c.code)) === json(['ECON 102']));
  const stops = record('illinois', ILL_RECORD.courses.filter((c) => c.status === 'completed'));
  const hs = P.horizonFor(answers('illinois', "I'm a sophomore.", { academicYear: 'second', transcript: stops }), TODAY, S.NO_SHAPE);
  check('a transcript that stops at Spring 2026: Fall 2026 is them taking classes now, about 15 credits until they add them, said plainly', hs.currentAssumedHours === 15 && hs.assumedHours === 15 && /does not show Fall 2026 classes yet/.test(hs.startNote ?? '') && /about 15 credits/.test(hs.startNote ?? ''), `${hs.currentAssumedHours}: ${hs.startNote}`);
  const old = record('illinois', ILL_RECORD.courses.filter((c) => c.term === 'Fall 2025'));
  const ho = P.horizonFor(answers('illinois', "I'm a sophomore.", { academicYear: 'second', transcript: old }), TODAY, S.NO_SHAPE);
  check('one that stops at Fall 2025 (a term off since) assumes nothing for Fall 2026, as a record\'s gaps never were', ho.currentAssumedHours === 0 && ho.assumedHours === 0, `${ho.assumedHours}`);
  const parkland = { ...ILL_RECORD, courses: [...ILL_RECORD.courses, line('MATH 221', 4, 'Fall 2026', 'in_progress', { code: 'MAT 198', from: 'Parkland College', matchedBy: 'printed' })] };
  check('a class at another school this term is not one of this school\'s current classes', !C.currentClasses(parkland, FALL26, idOf).some((c) => c.code === 'MATH 221') && C.currentClasses(parkland, FALL26, idOf).length === 3);
  const uga = record('uga', [line('ENGL 1101', 3, 'Fall 2025', 'completed'), line('ECON 2105', 3, 'Fall 2026', 'in_progress'), line('MATH 2250', 4, 'Fall 2026', 'in_progress')]);
  const hu = P.horizonFor(answers('uga', "I'm a sophomore.", { academicYear: 'second', transcript: uga }), TODAY, S.NO_SHAPE);
  check('UGA: the same, ECON 2105 and MATH 2250 in Fall 2026, planning from Spring 2027', term(hu.current) === 'Fall 2026' && hu.startSeason === 'Spring' && hu.startYear === 2027 && json(C.currentClasses(uga, hu.current, idOf).map((c) => c.code)) === json(['ECON 2105', 'MATH 2250']));
}

// ---------------------------------------------------------------------------
section('4. Classes added by hand');
{
  const school = { id: 'uga', label: 'Added on the board' };
  const econ = { code: 'ECON 2105', title: 'Principles of Macroeconomics', credits: 3 };
  const one = C.withCurrentClass(null, econ, FALL26, school, TODAY);
  check('adding a class with no record makes one: home, a course list, UGA\'s', one.home === true && one.kind === 'course_list' && one.schoolId === 'uga' && one.courses.length === 1);
  const l = one.courses[0];
  check('the line is in progress, Fall 2026, typed by the student, counted as the course', l.status === 'in_progress' && l.term === 'Fall 2026' && l.matchedBy === 'student' && l.use && l.counts === 'course' && l.matched === 'ECON 2105');
  check('so the build holds it and never plans ECON 2105 again', T.transcriptCodes(one).includes('ECON 2105'));
  check('it shows in the column as added by you', json(C.currentClasses(one, FALL26, () => 'econ-2105')) === json([{ code: 'ECON 2105', title: 'Principles of Macroeconomics', credits: 3, from: 'hand', courseId: 'econ-2105' }]));
  check('adding it again gives the same record back, not a second line', C.withCurrentClass(one, econ, FALL26, school, TODAY) === one);
  const h1 = P.horizonFor(answers('uga', "I'm a freshman.", { ...FRESHMAN, transcript: one }), TODAY, S.NO_SHAPE);
  check('one 3-credit class entered: the rest of a 15-credit term (12) is still counted, so the plan is not 12 short', h1.currentAssumedHours === 12 && h1.assumedHours === 12, `${h1.currentAssumedHours} / ${h1.assumedHours}`);
  check('the plan says what it counts, plainly', /You have added 3 credits of Fall 2026 classes/.test(h1.startNote ?? '') && /about 12 more for Fall 2026/.test(h1.startNote ?? ''), h1.startNote ?? '');
  check('the column asks "Is that all your classes this semester?"', C.currentQuestion(one, FALL26) === 'all');
  let four = one;
  for (const [code, credits] of [['MATH 2250', 4], ['ENGL 1101', 3], ['HIST 2111', 3]]) four = C.withCurrentClass(four, { code, title: code, credits }, FALL26, school, TODAY);
  const h4 = P.horizonFor(answers('uga', "I'm a freshman.", { ...FRESHMAN, transcript: four }), TODAY, S.NO_SHAPE);
  check('four classes, 13 credits, a full-time load: nothing more is assumed and nothing is asked', h4.assumedHours === 0 && C.currentQuestion(four, FALL26) === null, `${h4.assumedHours}`);
  // UGA's plan dialog shows the start note since 2026-10-22: it no longer asks for classes already in the column.
  check('and the start note says the classes are in the column, not "Add the classes you are taking now"', /Your Fall 2026 classes are in its column, counted as in progress until you pass them\./.test(h4.startNote ?? '') && !/Add the classes you are taking now/.test(h4.startNote ?? ''), h4.startNote ?? 'no note');
  const said = C.withCurrentConfirmed(one, FALL26, true);
  const hs = P.horizonFor(answers('uga', "I'm a freshman.", { ...FRESHMAN, transcript: said }), TODAY, S.NO_SHAPE);
  check('"That is all": one class it is, nothing assumed', hs.assumedHours === 0 && C.currentQuestion(said, FALL26) === null);
  const off = C.withoutCurrentClass(four, 'MATH 2250', FALL26);
  check('a class added by hand comes off when the student takes it off', !off.courses.some((c) => c.code === 'MATH 2250') && off.courses.length === 3);
  const dropped = C.withoutCurrentClass(ILL_RECORD, 'PSYC 204', FALL26);
  const psyc = dropped.courses.find((c) => c.code === 'PSYC 204');
  check('a transcript\'s class is kept on the record but no longer counted (dropped)', psyc && psyc.use === false && !T.transcriptCodes(dropped).includes('PSYC 204') && json(C.currentClasses(dropped, FALL26, () => null).map((c) => c.code)) === json(['ECON 102', 'STAT 100']));
  const back = C.withCurrentClass(dropped, { code: 'PSYC 204', title: 'x', credits: 3 }, FALL26, { id: 'illinois', label: 'x' }, TODAY);
  check('adding it back switches that line on again rather than doubling it', back.courses.filter((c) => c.code === 'PSYC 204').length === 1 && back.courses.find((c) => c.code === 'PSYC 204').use === true);
  check('nothing is counted beyond a full load: a partly entered term counts at most 15 in all', C.partlyEnteredHours([{ ...l, credits: 11 }], false) === 4 && C.partlyEnteredHours([{ ...l, credits: 13 }], false) === 0 && C.partlyEnteredHours([{ ...l, credits: 3 }, { ...l, credits: 3, matchedBy: 'code' }], false) === 0);
}

// ---------------------------------------------------------------------------
section('5. The planner never fills the column, and a Spring start reads whole at UGA');
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
{
  // Illinois, loaded as __summer-terms.check.mjs loads it.
  const meta = read('illinois/meta.json');
  const rows = read('illinois/index.json').map(hydrateIndexRow);
  const offeringsFile = existsSync(join(PUBLIC, 'illinois', 'offerings.json')) ? read('illinois/offerings.json') : null;
  if (offeringsFile) applyOfferings(rows, offeringsFile);
  const byCode = new Map(rows.map((c) => [norm(c.code), c]));
  const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
  const grades = new Map(); for (const [code, g] of gradeRaw) grades.set(code, toGradeRow(g, byCode.get(code)?.title ?? code, []));
  const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
  const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
  const languagesFile = existsSync(join(PUBLIC, 'illinois', 'languages.json')) ? read('illinois/languages.json') : null;
  const context = {
    courses: rows, prereqs: new Map(Object.entries(read('illinois/prereqs.json'))), grades, sections: new Map(), equivalents,
    exclusions: new Map(Object.entries(read('illinois/exclusions.json'))), creditRanges, bands: meta.bands,
    offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(),
    offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile?.terms,
    languages: languagesFile ?? undefined, snapshotTerm: null,
    prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
  };
  const PSYC = 'las/psychology-bslas';
  const summary = read('illinois/programs.json').find((p) => p.id === PSYC);
  const blocks = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [read(`illinois/program/${PSYC}.json`)] }, new Map(byCode)).blocks.get(PSYC) ?? [];
  const build = (a) => {
    const h = P.horizonFor(a, TODAY, S.NO_SHAPE);
    const held = T.transcriptCodes(a.transcript);
    return { h, plan: generatePlan({
      requirements: blocks, context, horizon: h, programId: PSYC, degreeTotal: summary.totalCredits || 120, interests: 'Psychology.', programName: summary.name, programCollege: summary.college,
      prior: { courseCodes: held, exemptCodes: [], unmatchedCredits: h.assumedHours, known: true, languageSemesters: 4, languageName: 'Spanish' },
      preferences: { creditsPerTerm: { min: 12, target: null, max: 18 } },
    }) };
  };
  const fresh = build(answers('illinois', "I'm a freshman.", FRESHMAN));
  check('Illinois freshman: the planned board starts in Spring 2027 and has no Fall 2026', labels(fresh.plan.plan)[0] === 'Spring 2027' && !labels(fresh.plan.plan).includes('Fall 2026'), labels(fresh.plan.plan).join(', '));
  check('and its column is empty until the student adds their classes', C.currentClasses(null, fresh.h.current, () => null).length === 0);
  const withRecord = build(answers('illinois', "I'm a sophomore.", { academicYear: 'second', transcript: ILL_RECORD }));
  const planned = withRecord.plan.plan.terms.flatMap((t) => t.courseIds).map((id) => rows.find((r) => r.id === id)?.code);
  check('Illinois with a transcript: none of the classes in progress is planned again', !['ECON 102', 'PSYC 204', 'STAT 100'].some((c) => planned.includes(c)) && labels(withRecord.plan.plan)[0] === 'Spring 2027', labels(withRecord.plan.plan).join(', '));

  // UGA, through the shipped adapter.
  const publicJson = (name) => JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
  const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
  const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));
  const { planCreditRange } = await import(join(HERE, 'autoplan.ts'));
  const data = await U.loadUgaData();
  globalThis.fetch = originalFetch;
  const program = data.programs.find((p) => p.name.toLowerCase().includes('psychology') && p.degree.toLowerCase() === 'bs');
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
  const ugaContext = { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [program.id])) };
  const ugaBuild = (a) => {
    const h = P.horizonFor(a, TODAY, S.NO_SHAPE);
    const held = T.transcriptCodes(a.transcript);
    const generated = generatePlan({
      requirements: loaded.blocks, context: ugaContext, programName: loaded.program.name, programId: program.id,
      prior: { known: true, courseCodes: held, exemptCodes: [], unmatchedCredits: h.assumedHours }, horizon: h,
      degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: DEFAULT_PRIORITIES },
    });
    const priorCodes = generated.plan.completedCourseIds.map((id) => data.courses.find((c) => c.id === id)?.code).filter(Boolean);
    const audit = (assumed) => auditUgaBoard({ board: generated.plan, context: ugaContext, undergraduate: loaded, priorCodes, extraCredits: assumed, transcript: a.transcript, validation: { minimumTermCredits: 12, priorCredits: planCreditRange(priorCodes, ugaContext).min } });
    return { h, generated, audit };
  };
  const ugaFresh = ugaBuild(answers('uga', "I'm a freshman.", FRESHMAN));
  check(`UGA ${program.name} freshman: the board starts in Spring 2027 and has no Fall 2026 (it used to fill it with its own picks)`, labels(ugaFresh.generated.plan)[0] === 'Spring 2027' && !labels(ugaFresh.generated.plan).includes('Fall 2026'), labels(ugaFresh.generated.plan).join(', '));
  const counted = ugaFresh.audit(ugaFresh.h.assumedHours);
  const uncounted = ugaFresh.audit(0);
  check('with Fall 2026 counted as about 15, as the workspace now hands UGA\'s audit, the degree is not short', !counted.issues.some((i) => i.id === 'uga-total') && counted.total >= counted.target, `${counted.total} of ${counted.target}`);
  check('without it (the old UGA counting) the same board read "Degree credits are short", the reason UGA kept a fall start', uncounted.issues.some((i) => i.id === 'uga-total'), `${uncounted.total} of ${uncounted.target}`);
  const ugaRecord = record('uga', [line('ENGL 1101', 3, 'Fall 2025', 'completed'), line('PSYC 1101', 3, 'Fall 2025', 'completed'), line('ECON 2105', 3, 'Fall 2026', 'in_progress'), line('MATH 1113', 4, 'Fall 2026', 'in_progress')]);
  const ugaWith = ugaBuild(answers('uga', "I'm a sophomore.", { academicYear: 'second', transcript: ugaRecord }));
  const ugaPlanned = ugaWith.generated.plan.terms.flatMap((t) => t.courseIds).map((id) => data.courses.find((c) => c.id === id)?.code);
  check('UGA with a transcript: ECON 2105 and MATH 1113 in progress are not planned again, and the board starts in Spring 2027', !['ECON 2105', 'MATH 1113'].some((c) => ugaPlanned.includes(c)) && labels(ugaWith.generated.plan)[0] === 'Spring 2027', labels(ugaWith.generated.plan).join(', '));
  check('and Cameron\'s audit still counts them as conditional in-progress credit', ugaWith.audit(0).issues.some((i) => i.id === 'uga-pending'));
}

// ---------------------------------------------------------------------------
section('6. Old saves load; instructors set for a current class stay through Rebuild');
{
  const plan = { schemaVersion: 1, programId: 'x', graduationLabel: 'Spring 2030', completedCourseIds: [], terms: [{ id: 'spring-2027', label: 'Spring 2027', year: 1, season: 'Spring', courseIds: ['psyc-100'] }] };
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
  const settings = { minimumTermCredits: 12, targetTermCredits: null, careerInterests: '', careerCleared: false, priorities: DEFAULT_PRIORITIES, planShape: S.NO_SHAPE };
  S.writeSavedBoard(storage, S.serializeBoard({ schemaVersion: 4, schoolId: 'illinois', programId: 'x', savedAt: '', board: { plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: false }, settings }));
  const back = S.readSavedBoard(storage, 'illinois');
  check('a board saved before the column loads exactly as it was', back && json(back.board.plan) === json(plan));
  check('a record saved before the column has no answer yet: its in-progress classes are asked about once', C.currentQuestion(record('illinois', [line('ECON 102', 3, 'Fall 2026', 'in_progress')]), FALL26) === 'confirm');
  const withMine = I.withInstructor({ ...plan, instructors: { 'spring-2027': { 'PSYC 100': 'A. Planned' } } }, 'fall-2026', 'ECON 102', 'B. Current');
  check('My instructor on a current class is saved on the plan by its term id, fall-2026', I.chosenInstructor(withMine, 'fall-2026', 'ECON 102') === 'B. Current' && C.termIdOf(FALL26) === 'fall-2026');
  const rebuilt = { ...plan, terms: [...plan.terms] };
  const carried = I.carryInstructors(withMine, rebuilt, (id) => (id === 'psyc-100' ? 'PSYC 100' : null));
  check('carryInstructors alone keeps only planned terms\' choices', I.chosenInstructor(carried, 'fall-2026', 'ECON 102') === null && I.chosenInstructor(carried, 'spring-2027', 'PSYC 100') === 'A. Planned');
  const kept = C.withInstructorsOfTerm(withMine, carried, 'fall-2026');
  check('the build keeps the current semester\'s choices too', I.chosenInstructor(kept, 'fall-2026', 'ECON 102') === 'B. Current' && I.chosenInstructor(kept, 'spring-2027', 'PSYC 100') === 'A. Planned');
  check('and a plan with no choices comes back the same object', C.withInstructorsOfTerm(plan, plan, 'fall-2026') === plan);
}

// ---------------------------------------------------------------------------
section('7. ALMA and ARCH see the semester in progress');
{
  const nowTerm = C.currentPlanTerm(FALL26, ['econ-102', 'psyc-204']);
  const board = [{ id: 'spring-2027', label: 'Spring 2027', year: 1, season: 'Spring', courseIds: [] }, { id: 'fall-2027', label: 'Fall 2027', year: 2, season: 'Fall', courseIds: [] }];
  const view = [nowTerm, ...board];
  check('"this term" is Fall 2026, the real classes, once the column is a term', I.resolveTerms(view, ['this term'], TODAY).terms[0] === nowTerm);
  check('"Fall 2026" by name too', I.resolveTerms(view, ['Fall 2026'], TODAY).terms[0] === nowTerm);
  check('"next semester" is still Spring 2027', I.resolveTerms(view, ['next semester'], TODAY).terms.map((t) => t.label).join() === 'Spring 2027');
  check('without the column "this term" fell back to the first planned term, Spring 2027 (the old answer)', I.resolveTerms(board, ['this term'], TODAY).terms[0].label === 'Spring 2027');
  check('the current term is never one of the plan\'s own terms', nowTerm.id === 'fall-2026' && !board.some((t) => t.id === nowTerm.id));

  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  const handler = (name) => ws.slice(ws.indexOf(`case '${name}': {`), ws.indexOf("\n      case '", ws.indexOf(`case '${name}': {`) + 10));
  check('the board description names THIS SEMESTER and its classes, before the planned terms', /THIS SEMESTER, in progress \(the student's real classes/.test(ws) && ws.indexOf('THIS SEMESTER, in progress (the student') < ws.indexOf('for (const term of board.terms) {', ws.indexOf('function describeBoard')));
  check('and tells the assistant to ask for the classes when the column is empty', /THIS SEMESTER, in progress: no classes added yet/.test(ws) && /record_prior_credit and in_progress true/.test(ws));
  check('term_syllabi resolves terms over the current term and the board', /const picked = resolveTerms\(viewTerms, /.test(handler('term_syllabi')));
  check('term_summary answers for the current term with its real classes', /const term = readTermOf\(str\('term'\)\);/.test(handler('term_summary')) && /in_progress: true/.test(handler('term_summary')));
  check('course_syllabus finds a current class\'s term, so the instructor the student set is used', /const at = holding\(c\.id\) \?\? takingNow\(c\.id\);/.test(handler('course_syllabus')));
  check('class times for a current class are that term\'s', /const at = holding\(c\.id\) \?\? takingNow\(c\.id\);\n\s+const pick = pickSectionTerm/.test(ws));
  check('the edit tools never book into or move out of the current term', ['add_course', 'move_course', 'remove_course', 'replace_course'].every((n) => /takingNow\((?:c|oldC)\.id\)/.test(handler(n))) && /nowRefusal\(str\('term'\)\)/.test(handler('add_course')));
  check('record_prior_credit with in_progress dates the line to the current term, so it lands in the column', /term: inProgress && L\.currentView \? L\.currentView\.term\.label : null/.test(handler('record_prior_credit')));
  check('the column is drawn before the planned terms, and never from the board\'s own terms', ws.indexOf('<CurrentTermColumn') > 0 && ws.indexOf('<CurrentTermColumn') < ws.indexOf('{plan?.terms.map((term) => {', ws.indexOf('<CurrentTermColumn') - 4000) + 4000 && /classes=\{currentView\.classes\}/.test(ws));
  check('Rebuild keeps the instructors set for current classes', /withInstructorsOfTerm\(planRef\.current, carried, termIdOf\(horizon\.current\)\)/.test(ws));
  check('and its class-standing check counts them too, in both places', /priorCredits: priorCreditHours \+ assumedCredit\.hours,/.test(ws) && /priorCredits: L\.priorCreditHours \+ L\.assumedCredit\.hours \} \}\);/.test(ws));
  check('UGA\'s audit counts the assumed terms, in both places it is built', (ws.match(/extraCredits: (?:L\.)?priorCreditHours - planCreditRange\(\[\.\.\.(?:L\.)?completedCodes\], (?:L\.)?context\)\.min \+ (?:L\.)?assumedCredit\.hours,/g) ?? []).length === 2);
  check('the download carries the current semester and opening one puts its classes back', /currentTerm: \{\n\s+term: currentView\.term\.label,/.test(ws) && /restoreCurrentClasses\(parsed\.currentTerm\);/.test(ws));
  check('the printed packet shows it first, in progress', /current: currentView \? \{ label: currentView\.term\.label/.test(ws) && /label: `\$\{now\.label\}, in progress`/.test(readFileSync(join(HERE, 'advisor-packet.ts'), 'utf8')));
  const col = readFileSync(join(ROOT, 'components/planner/current-term-column.tsx'), 'utf8');
  check('the column says In progress, asks "Are these your current classes?", and invites the student when empty', /In progress<\/small>/.test(col) && /Are these your current classes\?/.test(col) && /Add the classes you&apos;re taking now/.test(col) && /so ORION and \{botName\} can help with this semester\./.test(col) && /Add a class you&apos;re taking now/.test(col));
  check('My instructor is on every current class', /<CardInstructorMenu/.test(col) && /Set my instructor/.test(col));
  const invite = col.slice(col.indexOf('{empty && ('), col.indexOf('{!empty && countLine'));
  check('an empty column shows one plain invite line: one paragraph, no count or second sentence in it', (invite.match(/<p /g) ?? []).length === 1 && !/countLine|do not fit/.test(invite) && (invite.replace(/<[^>]+>|\{[^}]*\}/g, ' ').match(/\./g) ?? []).length === 1, invite);
  check('its invite offers the existing upload for a schedule screenshot: Athena at UGA, Student Self-Service at Illinois', /upload a screenshot of your \{scheduleFrom \?\? 'class'\} schedule/.test(invite) && /scheduleFrom=\{isUga \? 'Athena' : 'Student Self-Service'\}/.test(ws) && /onUpload=\{openRecordUpload\}/.test(ws));
  check('which opens the side panel at that upload, adding to a record rather than replacing it', /function openRecordUpload\(\) \{[\s\S]{0,700}\.transcript-more input[\s\S]{0,200}\.transcript-pick input[\s\S]{0,120}const target = more \?\? pick;/.test(ws));
  check('the in-progress note stays a note, not a warning, for a student with classes in the column (warnings-triage)', /id: 'uga-pending',\n\s+severity: 'info',/.test(readFileSync(join(ROOT, 'components/planner/uga-board-audit.ts'), 'utf8')));
}

// ---------------------------------------------------------------------------
section('8. The board bar ranks the semester in progress sensibly');
{
  const W = await import(join(HERE, 'warnings-triage.ts'));
  const gap = (extra) => ({ said: null, recorded: 0, assumed: 15, assumedTerms: 'Fall 2026', currentTerm: 'Fall 2026', currentAssumed: 15, currentClasses: 0, ...extra });
  check('an empty Fall 2026 column, nothing else assumed: the prompt names the term and its column', W.recordPrompt(gap()) === 'Your Fall 2026 classes are not added yet. Add them in the Fall 2026 column to get an accurate check.', W.recordPrompt(gap()));
  check('some classes added, the rest still counted: it asks for the rest, or for "those are all"', /^Your Fall 2026 classes are not all added yet\. Add the rest in the Fall 2026 column, or say there that those are all/.test(W.recordPrompt(gap({ assumed: 12, currentAssumed: 12, currentClasses: 1 })) ?? ''));
  check('earlier terms assumed too (a junior with no record): the old prompt, naming every term', /^Your classes from Fall 2024, Spring 2025 and Fall 2026 are not recorded yet\./.test(W.recordPrompt(gap({ assumed: 45, assumedTerms: 'Fall 2024, Spring 2025 and Fall 2026' })) ?? ''));
  check('hours the student said still come first', /^You said about 70 credits; none are recorded\./.test(W.recordPrompt(gap({ said: 70 })) ?? ''));
  check('no column (a board without one): the prompt as it was', W.recordPrompt(gap({ currentTerm: null, currentAssumed: 0 })) === 'Your classes from Fall 2026 are not recorded yet. Add your classes or upload a transcript to get an accurate check.');
  check('a column the transcript filled assumes nothing, so the bar asks nothing (the column asks once)', W.recordPrompt(gap({ assumed: 0, currentAssumed: 0, currentClasses: 3 })) === null);
  const issues = [
    { id: 'notplaced-no-room', severity: 'warning', title: '2 courses left out: no room', message: 'PSYC 3980, PSYC 4100.', termId: '' },
    { id: 'uga-area-Required Courses', severity: 'warning', title: 'Required Courses', message: 'Required Courses: 9 of 12 credits.', termId: '' },
    { id: 'ap-load-spring-2028', severity: 'warning', title: 'Over the credit limit', message: 'Spring 2028: 21 credits.', termId: 'spring-2028' },
    { id: 'uga-pending', severity: 'info', title: 'In-progress credit is conditional', message: 'x', termId: '' },
  ];
  const t = W.triageIssues(issues, { credit: gap(), bot: 'ARCH' });
  check('it ranks first, as the one record prompt', t.prompt?.key === 'record' && t.prominent[0] === t.prompt && t.prompt.issue.id === W.CURRENT_CLASSES_ID && t.prompt.issue.title === 'Your Fall 2026 classes');
  check('the shortfalls its classes would settle wait for it, under Show more', t.folded.map((r) => r.issue.id).sort().join() === 'notplaced-no-room,uga-area-Required Courses');
  check('what its classes cannot explain still matters now (a term over the limit)', t.now.some((k) => k.key === 'load') && t.prominent.some((k) => k.key === 'load'));
  check('in-progress credit stays good to know', t.later.some((r) => r.issue.id === 'uga-pending'));
  check('its popover says what the plan counts and where the classes go, upload included', /Fall 2026 is under way\./.test(t.prompt.issue.message) && /counts Fall 2026 as about 15 credits, a usual full load,/.test(t.prompt.issue.message) && /in the Fall 2026 column/.test(t.prompt.issue.message) && /screenshot of your class schedule/.test(t.prompt.issue.message), t.prompt.issue.message);
  // "First year" picked in setup with no words: the column is shown, nothing is assumed for it.
  const unset = gap({ assumed: 0, currentAssumed: 0 });
  const e = W.triageIssues(issues, { credit: unset, bot: 'ARCH' });
  check('an empty column with nothing assumed asks for its classes when they would settle a shortfall', e.prompt?.issue.id === W.CURRENT_CLASSES_ID && e.prompt.label === 'Your Fall 2026 classes are not added yet. Add them in the Fall 2026 column to get an accurate check.' && /counts nothing for Fall 2026 yet/.test(e.prompt.issue.message) && e.folded.length === 2, e.prompt?.issue.message);
  const quiet = W.triageIssues(issues.filter((i) => i.id.startsWith('ap-load') || i.id === 'uga-pending'), { credit: unset, bot: 'ARCH' });
  check('and not when nothing on the board would be settled by them (the column already invites)', quiet.prompt === null && quiet.now.length === 1);
  check('nor when the plan is clear: "Nothing needs attention" stays', W.triageIssues([], { credit: unset }).allClear);
  const filled = W.triageIssues(issues, { credit: gap({ assumed: 0, currentAssumed: 0, currentClasses: 3 }), bot: 'ARCH' });
  check('with the classes in, nothing is folded: the shortfalls are the plan\'s own', filled.prompt === null && filled.folded.length === 0 && filled.now.some((k) => k.key === 'left-out'));
  const bar = readFileSync(join(ROOT, 'components/planner/attention-bar.tsx'), 'utf8');
  check('the bar titles that popover by the term, and its waiting rows point to the column', /kind\.issue\.id === CURRENT_CLASSES_ID \? kind\.issue\.title : 'Credit the plan cannot see'/.test(bar) && /The classes you are taking now may settle these\. Add them in the \$\{current\} column/.test(bar));
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  check('the workspace hands the triage the column: its term, what it assumes, how many classes', /currentTerm: currentView\?\.term\.label \?\? null,\n\s+currentAssumed: currentView\?\.assumedHours \?\? 0,\n\s+currentClasses: currentView\?\.classes\.length \?\? 0,/.test(ws));
}

// ---------------------------------------------------------------------------
section('9. Saved in account saves; a schedule screenshot fills the column');
{
  const A = await import(join(ROOT, 'lib/accounts/snapshot.ts'));
  const school = { id: 'uga', label: 'Added by you' };
  let mine = C.withCurrentClass(null, { code: 'ECON 2105', title: 'Principles of Macroeconomics', credits: 3 }, FALL26, school, TODAY);
  mine = C.withCurrentConfirmed(mine, FALL26, true);
  const plan = { schemaVersion: 1, programId: 'uga-econ', graduationLabel: 'Spring 2030', completedCourseIds: ['econ-2105'], terms: [{ id: 'spring-2027', label: 'Spring 2027', year: 1, season: 'Spring', courseIds: [] }], instructors: { 'fall-2026': { 'ECON 2105': 'A. Teacher' } } };
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
  const settings = { minimumTermCredits: 12, targetTermCredits: null, careerInterests: '', careerCleared: false, priorities: DEFAULT_PRIORITIES, planShape: S.NO_SHAPE };
  S.writeSavedBoard(storage, S.serializeBoard({ schemaVersion: 4, schoolId: 'uga', programId: 'uga-econ', savedAt: '', board: { plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: false }, settings }));
  storage.setItem('fourYear.onboarding.v2', JSON.stringify(answers('uga', "I'm a freshman.", { ...FRESHMAN, transcript: mine })));
  storage.setItem('fourYear.advisor.v1', JSON.stringify({ messages: [] }));
  check('the board is saved under a key the account save carries', A.WORKSPACE_KEYS.includes('fourYear.board.v4') && map.has('fourYear.board.v4'), [...map.keys()].join(', '));
  const snap = A.localSnapshot(storage);
  const lines = snap ? C.currentLines(snap.answers.transcript, FALL26) : [];
  check('the account copy holds the class added by hand, in progress, Fall 2026', lines.length === 1 && lines[0].code === 'ECON 2105' && lines[0].status === 'in_progress', snap ? '' : 'no snapshot');
  check('and the "yes, these are mine" answer', snap?.answers.transcript?.currentConfirmed === 'Fall 2026');
  check('and My instructor for it, on the saved plan', I.chosenInstructor(snap?.board.board.plan, 'fall-2026', 'ECON 2105') === 'A. Teacher');
  check('nothing new leaves the device: still the same three records', A.WORKSPACE_KEYS.length === 3);
  const insights = readFileSync(join(ROOT, 'lib/insights/client.ts'), 'utf8');
  const counted = [...insights.slice(insights.indexOf('const controls'), insights.indexOf('export function startInsights')).matchAll(/'\.([a-z-]+)/g)].map((m) => m[1]);
  const colSrc = readFileSync(join(ROOT, 'components/planner/current-term-column.tsx'), 'utf8');
  const classes = [...colSrc.matchAll(/className=(?:"([^"]+)"|\{cn\('([^']+)')/g)].flatMap((m) => (m[1] ?? m[2]).split(/\s+/));
  check('and no new usage count: no control in the column carries a class the opt-in insights count, nor a data-insight mark', counted.length > 10 && !classes.some((c) => counted.includes(c)) && !/data-insight/.test(colSrc), classes.filter((c) => counted.includes(c)).join(', '));
  // A screenshot of a student's Athena schedule, as the reader returns it
  // (app/api/transcript/route.ts: a current-enrollments list is in progress,
  // the term written as "Fall 2026"; a schedule names no issuer).
  const reading = {
    institution: null, kind: 'course_list', courses: [
      { code: 'ECON 2105', title: 'Principles of Macroeconomics', credits: 3, grade: null, term: 'Fall 2026', status: 'in_progress', from: null, equivalent: null },
      { code: 'MATH 2250', title: 'Calculus I for Science and Engineering', credits: 4, grade: null, term: 'Fall 2026', status: 'in_progress', from: null, equivalent: null },
    ], exams: [], notes: [],
  };
  const lite = [{ code: 'ECON 2105', title: 'Principles of Macroeconomics', credits: 3, level: 2000, cluster: 'ECON' }, { code: 'MATH 2250', title: 'Calculus I', credits: 4, level: 2000, cluster: 'MATH' }];
  const read = T.matchTranscript(reading, 'athena-schedule.png', lite, ['athena-schedule.png'], null, 'uga', null);
  const shown = C.currentClasses(read, FALL26, (code) => code.toLowerCase());
  check('a schedule screenshot\'s classes land in the column, from the upload, asked about once', json(shown.map((c) => [c.code, c.from])) === json([['ECON 2105', 'transcript'], ['MATH 2250', 'transcript']]) && C.currentQuestion(read, FALL26) === 'confirm', json(shown));
  const h = P.horizonFor(answers('uga', "I'm a freshman.", { ...FRESHMAN, transcript: read }), TODAY, S.NO_SHAPE);
  check('and the plan counts them, not an assumed 15, from Spring 2027', h.assumedHours === 0 && h.startSeason === 'Spring' && h.startYear === 2027 && term(h.current) === 'Fall 2026', `${h.assumedHours} ${span(h)}`);
}

// ---------------------------------------------------------------------------
section('10. A UGA graduate plan counts graduate terms, not undergraduate ones (2026-10-22)');
/*
 * A UGA graduate student's first fall was counted as 15 credits, the
 * undergraduate load, so a 30-hour master's planned 15 credits and left half
 * of it off the board; entering a full 9-hour graduate load still left 6
 * phantom credits and "Is that all your classes this semester?". UGA's
 * full-time graduate load is 9 (grad.uga.edu/handbook/; uga-load-rules.ts).
 */
{
  const LR = await import(join(HERE, 'uga-load-rules.ts'));
  const grad = (words, extra = {}) => answers('uga', words, { programLevel: 'graduate', ...extra });
  const load = C.termLoadFor('uga', 'graduate');
  check('termLoadFor: 9 and 9 for a UGA graduate plan, 15 and 12 for everyone else', json(load) === json({ usual: 9, fullTime: 9 }) && json(C.termLoadFor('uga', 'undergraduate')) === json({ usual: 15, fullTime: 12 }) && json(C.termLoadFor('illinois', 'graduate')) === json({ usual: 15, fullTime: 12 }));
  for (const words of ["I'm a first-year master's student.", "I started my master's this fall."]) {
    const h = P.horizonFor(grad(words), TODAY, S.NO_SHAPE);
    check(`UGA graduate, ${json(words)}: Fall 2026 counts as 9 credits, a full-time graduate load, not 15`, h.assumedHours === 9 && h.currentAssumedHours === 9 && json(h.assumedTerms) === json([FALL26]) && /about 9 credits, the usual full load/.test(h.startNote ?? ''), `${h.assumedHours} for ${json(h.assumedTerms)}: ${h.startNote}`);
  }
  const illGrad = P.horizonFor(answers('illinois', "I'm a first-year master's student.", { programLevel: 'graduate' }), TODAY, S.NO_SHAPE);
  const illUnder = P.horizonFor(answers('illinois', "I'm a first-year master's student."), TODAY, S.NO_SHAPE);
  check('an Illinois graduate plan is counted as before (its Graduate College rule is not read yet)', illGrad.assumedHours === illUnder.assumedHours, `${illGrad.assumedHours} vs ${illUnder.assumedHours}`);
  check('a UGA freshman as before: 15', P.horizonFor(answers('uga', "I'm a freshman.", FRESHMAN), TODAY, S.NO_SHAPE).assumedHours === 15);
  const school = { id: 'uga', label: 'Added by you' };
  let nine = null;
  for (const code of ['STAT 6210', 'STAT 6220', 'STAT 6810']) nine = C.withCurrentClass(nine, { code, title: code, credits: 3 }, FALL26, school, TODAY);
  const h9 = P.horizonFor(grad("I'm a first-year master's student.", { transcript: nine }), TODAY, S.NO_SHAPE);
  check('STAT 6210, 6220 and 6810 added (9 hours): nothing more is counted and the column asks nothing', h9.assumedHours === 0 && h9.currentAssumedHours === 0 && C.currentQuestion(nine, FALL26, load) === null, `${h9.assumedHours}, ${C.currentQuestion(nine, FALL26, load)}: ${h9.startNote}`);
  check('the same 9 hours on an undergraduate plan are still under 12, so it asks', C.currentQuestion(nine, FALL26) === 'all');
  const six = C.withoutCurrentClass(nine, 'STAT 6810', FALL26);
  const h6 = P.horizonFor(grad("I'm a first-year master's student.", { transcript: six }), TODAY, S.NO_SHAPE);
  check('two of them (6 hours): the rest of a 9-credit term (3) is counted, said in graduate numbers, and the column asks', h6.assumedHours === 3 && C.currentQuestion(six, FALL26, load) === 'all' && /about 3 more for Fall 2026, the rest of a usual 9-credit term/.test(h6.startNote ?? '') && !/15-credit/.test(h6.startNote ?? ''), `${h6.assumedHours}: ${h6.startNote}`);
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  check('the workspace asks the column\'s question at the plan\'s load, and takes a board\'s own terms off at it', /currentQuestion\(record, h\.current, termLoadFor\(answers\?\.schoolId, answers\?\.programLevel\)\)/.test(ws) && /\(h\.assumedTerms\.length - kept\.length\) \* termLoadFor\(answers\?\.schoolId, answers\?\.programLevel\)\.usual/.test(ws));
  // What set_plan_shape relays: a graduate student's rule, never the undergraduate one.
  const under = LR.ugaGraduateUnderloadNote(6);
  check('set_plan_shape under 9 on a UGA graduate plan: the Graduate School\'s 9-hour full time, the Registrar\'s graduate bands, aid\'s 9 and 5, the assistantship\'s 12', /6 credits in a fall or spring term is under the 9 hours that are a full-time graduate load at UGA/.test(under) && /7 to 8\.99 hours is three-quarter time and 5 to 6\.99 half time/.test(under) && /Financial aid counts 9 graduate hours as full time and 5 as half time/.test(under) && /at least 12 hours of graduate credit/.test(under) && !/undergraduate/.test(under), under);
  check('and above 18 the handbook\'s own sentence', /The maximum semester course load for any student is 18 hours per semester/.test(LR.ugaGraduateOverloadAnswer(20)) && /grad\.uga\.edu\/handbook/.test(LR.ugaGraduateOverloadAnswer(20)) && !/undergraduate/.test(LR.ugaGraduateOverloadAnswer(20)));
  check('the undergraduate note is unchanged', /9 credits in a fall or spring term is under the 12 hours UGA's Registrar counts as full time for an undergraduate/.test(LR.ugaUnderloadNote(9)));
  // Boards: the three master's programs of the report, built as the workspace builds a UGA graduate plan.
  const publicJson = (name) => JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
  const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
  const GR = await import(join(HERE, 'illinois-graduate.ts'));
  const { planCreditRange } = await import(join(HERE, 'autoplan.ts'));
  const data = await U.loadUgaData();
  globalThis.fetch = originalFetch;
  const set = GR.graduatePlanSettings('uga');
  const h = P.horizonFor(grad("I'm a first-year master's student."), TODAY, S.NO_SHAPE);
  for (const name of ['Animal and Dairy Science MS', 'Applied Mathematical Science MAMS', 'Agricultural and Applied Economics MS']) {
    const program = data.programs.find((p) => p.name === name && U.isUgaGraduateDegree(p));
    if (!program) { check(`${name} is a UGA graduate program`, false); continue; }
    const loaded = U.loadUgaProgram(data, program, {});
    const total = loaded.summary?.totalCredits || program.totalCredits;
    const g = generatePlan({
      requirements: loaded.blocks, context: data.context, programName: loaded.program.name, programId: program.id,
      prior: { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: h.assumedHours }, horizon: h, degreeTotal: total,
      electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: set.minimumTermCredits, target: set.targetTermCredits, max: 18 }, priorities: DEFAULT_PRIORITIES },
      standingHours: set.standingHours, electiveLevelRange: set.electiveLevelRange, autoPrerequisiteLevelRange: set.autoPrerequisiteLevelRange,
    });
    const planned = planCreditRange(g.plan.terms.flatMap((t) => t.courseIds).map((id) => data.courses.find((c) => c.id === id)?.code).filter(Boolean), data.context).min;
    check(`${name} (${total} hours), first-year master's student: the board plans ${planned}, and with a real 9-hour first fall the degree is whole (counting 15 for that fall, it planned 6 fewer)`, planned + 9 >= total && planned <= total, `${planned} planned + 9 of ${total}`);
  }
}

// ---------------------------------------------------------------------------
section('11. "Already taken" counts each class once, and not the ones in progress (2026-10-22)');
/*
 * A UGA Biology BS student with six classes added to the Fall 2026 column
 * read "Already taken 12 courses" above a list of six: the count was every
 * held course id, and each class came with its equivalent codes. The six were
 * listed as taken while still in progress, and the pre-med note said "you
 * already hold BIOL 1107, BIOL 1107L, CHEM 1211...".
 */
{
  const AT = await import(join(HERE, 'already-taken.ts'));
  const publicJson = (name) => JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
  const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
  const CT = await import(join(HERE, 'career-tracks.ts'));
  const data = await U.loadUgaData();
  globalThis.fetch = originalFetch;
  const program = data.programs.find((p) => p.name === 'Biology BS' && U.isUgaUndergraduateDegree(p));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections: Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)])) });
  const school = { id: 'uga', label: 'Added by you' };
  let rec = null;
  const six = [['BIOL 1107', 3], ['BIOL 1107L', 1], ['CHEM 1211', 3], ['CHEM 1211L', 1], ['ENGL 1101', 3], ['MATH 1113', 4]];
  for (const [code, credits] of six) rec = C.withCurrentClass(rec, { code, title: code, credits }, FALL26, school, TODAY);
  const career = 'I want to go to medical school';
  U.setUgaTrackHours(data, CT.ugaTrackCodes(CT.interestProfile(career)));
  const a = answers('uga', "I'm a freshman.", { ...FRESHMAN, transcript: rec, after: career });
  const h = P.horizonFor(a, TODAY, S.NO_SHAPE);
  const held = T.transcriptCodes(rec);
  const build = (prior) => generatePlan({
    requirements: loaded.blocks, context: data.context, programName: loaded.program.name, programId: program.id, prior, horizon: h,
    degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES }, interests: career, career,
  });
  const base = { known: true, courseCodes: held, exemptCodes: [], unmatchedCredits: h.assumedHours };
  const g = build({ ...base, inProgressCodes: T.transcriptInProgressCodes(rec) });
  const ids = g.plan.completedCourseIds;
  const codes = ids.map((id) => data.courses.find((c) => c.id === id)?.code).filter(Boolean);
  const view = AT.alreadyTaken(codes, data.context, data.byCode, rec);
  check(`Biology BS, six classes in the Fall 2026 column: the board holds ${ids.length} course ids for them (each with its equivalents)`, ids.length > 6, ids.join(', '));
  check('the rail lists none as taken and the six as in progress, each once', view.taken.length === 0 && json(view.takingNow.map((c) => c.code).sort((a, b) => a.localeCompare(b))) === json(six.map(([c]) => c).sort((a, b) => a.localeCompare(b))), json(view));
  check('transcriptInProgressCodes: the six', json(T.transcriptInProgressCodes(rec).sort((a, b) => a.localeCompare(b))) === json(six.map(([c]) => c).sort((a, b) => a.localeCompare(b))));
  const passed = { ...rec, courses: rec.courses.map((l) => (l.code === 'ENGL 1101' ? { ...l, status: 'completed', term: 'Spring 2026', grade: 'A' } : l)) };
  const mixed = AT.alreadyTaken(codes, data.context, data.byCode, passed);
  check('a passed class is taken, the rest in progress: 1 and 5', json(mixed.taken.map((c) => c.code)) === json(['ENGL 1101']) && mixed.takingNow.length === 5, json(mixed));
  const note = g.notes.find((n) => n.startsWith('Pre-medicine (MD/DO):')) ?? '';
  check('the pre-med note says the student is taking them now, and never that they already hold them', /you are taking [^;.]*BIOL 1107[^;.]* now, which count once you pass/.test(note) && !/you already hold[^;.]*BIOL 1107/.test(note), note.slice(0, 400));
  const old = build(base).notes.find((n) => n.startsWith('Pre-medicine (MD/DO):')) ?? '';
  check('without the in-progress codes (a caller that does not pass them) it reads as before: "you already hold"', /you already hold[^;.]*BIOL 1107/.test(old), old.slice(0, 300));
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  check('the workspace hands the build the classes in progress and the rail its two lists', /const takingNow = transcriptInProgressCodes\(answers\?\.transcript\);\n\s+const prior = takingNow\.length > 0 \? \{ \.\.\.priorRead, inProgressCodes: takingNow \} : priorRead;/.test(ws) && /priorCount=\{heldCourses\.taken\.length\}\n\s+priorCourses=\{heldCourses\.taken\}\n\s+inProgressCourses=\{heldCourses\.takingNow\}/.test(ws) && !/priorCount=\{plan\?\.completedCourseIds\.length/.test(ws));
  U.setUgaTrackHours(data, []);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
