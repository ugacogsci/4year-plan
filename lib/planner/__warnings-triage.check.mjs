/**
 * The board bar's warnings, ranked and folded (warnings-triage.ts), on made-up
 * rows and on real boards at both schools.
 *
 * Wrong on the live site on 2026-10-20: a student who typed "about 70
 * credits" and uploaded nothing saw "11 things need attention" over a row of
 * red and yellow dots, every requirement those credits fill reading as
 * missing; at UGA "In-progress credit is conditional" showed for nearly every
 * continuing student and each requirement the catalog snapshot could not
 * fully read added a warning, so UGA boards almost never said "Nothing needs
 * attention". Now at most three things that matter now show, in plain words;
 * the rest is one click away and nothing is dropped; one prompt asks for the
 * record when credit is missing; ALMA and ARCH get the full ranked list.
 *
 *   node --experimental-strip-types lib/planner/__warnings-triage.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

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
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, ctx);
  }`));

const W = await import(join(HERE, 'warnings-triage.ts'));
const { triageIssues, issueTier, statedHours, recordPrompt, rankedFlags, PROMINENT_LIMIT } = W;

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
}
const issue = (id, severity, title, message = `${title}.`, extra = {}) => ({ id, severity, title, message, termId: '', ...extra });
const count = (rows) => rows.reduce((n, r) => n + r.count, 0);
/** Every input row is somewhere: the prompt, a kind that matters now, folded, or good to know. */
const accounted = (t) => count(t.prompt?.rows ?? []) + count(t.now.flatMap((k) => k.rows)) + count(t.folded) + count(t.later);
const labels = (t) => t.prominent.map((k) => k.label);

// --- the two tiers ------------------------------------------------------------
console.log('Matters now, good to know:');
for (const [why, i] of [
  ['the degree short', issue('degree-incomplete', 'error', 'This plan does not fulfill the degree yet')],
  ['a requirement that did not fit', issue('unmet-x::1-did-not-fit', 'error', 'Core: Statistics')],
  ['a UGA area short', issue('uga-area-Methods', 'error', 'Methods')],
  ['a UGA list short', issue('uga-pool-62927::3-hours-short', 'error', 'Major: Electives')],
  ['UGA credits short', issue('uga-total', 'error', 'Degree credits are short')],
  ['courses left out', issue('notplaced-no-room', 'warning', '6 courses left out: no term had room before graduation')],
  ['a prerequisite missing', issue('ap-prereq-fall-2027-chem-483-CHEM 442', 'error', 'Prerequisite conflict')],
  ['a prerequisite out of order', issue('ap-prereq-order-fall-2027-chem-236-CHEM 223', 'warning', 'Prerequisite later in the plan')],
  ['class standing', issue('ap-standing-fall-2027-psyc-301', 'error', 'Class standing not reached')],
  ['over the credit limit', issue('ap-load-fall-2027', 'warning', 'Heavy course load')],
  ['a time clash', issue('weekly-clash-spring-2027', 'warning', 'Class times clash')],
  ['not offered that term', issue('ap-offering-fall-2027-chem-483', 'warning', 'Not offered this term')],
  ['a course twice', issue('ap-duplicate-fall-2027-x', 'warning', 'Course appears twice')],
  ['Composition I late', issue('ap-comp1-late-fall-2028-rhet-105', 'warning', 'Composition I after the first year')],
  ['a Double Dawgs course after the deadline', issue('double-dawgs-late-fall-2031-csci-6360', 'error', 'After the graduate deadline')],
  ['a closed major', issue('admission-route', 'warning', 'Computer Science is closed to students already at Illinois')],
  ['an unknown warning', issue('some-new-check', 'warning', 'Something new')],
]) check(`matters now: ${why}`, issueTier(i) === 'now');
for (const [why, i] of [
  ['a UGA requirement the snapshot cannot fully read', issue('uga-unverified-77024::7::unlisted', 'info', 'Requirement needs advisor review')],
  ['in-progress credit at UGA', issue('uga-pending', 'info', 'In-progress credit is conditional')],
  ['an Illinois requirement the planner could not read', issue('unmet-aces/aces-undeclared::1::1-not-parsed', 'info', 'ACES Undeclared Core')],
  ['hours the catalog names no courses for', issue('unmet-62927::2-no-course-data', 'warning', 'Required Courses')],
  ['a UGA list none of whose courses are in the snapshot', issue('uga-pool-62927::4-no-course-data', 'error', 'Major: Seminar')],
  ['a requirement filled by electives', issue('unmet-x::3-filled-by-electives', 'info', 'Free electives')],
  ['a prerequisite to confirm', issue('ap-prereq-check-fall-2027-mcb-250-MCB 150', 'warning', 'Check this one')],
  ['a prerequisite only the student knows', issue('ap-priorlearning-fall-2027-chem-102-x', 'warning', 'Only you can answer this one')],
  ['a course that has not run lately', issue('ap-dormant-fall-2028-anth-477', 'warning', 'Has not run recently')],
  ['registration restricted for now', issue('ap-closed-fall-2027-x', 'warning', 'Registration restricted to other students')],
  ['hard courses together', issue('ap-hard-fall-2029', 'warning', 'Several hard courses together')],
  ['under the credit target', issue('ap-minimum-fall-2028', 'warning', 'Below your credit target')],
  ['credit given up for a required course', issue('ap-forfeit-STAT 100', 'info', 'Credit that will not count')],
  ['an application with a route', issue('admission-route', 'warning', 'Getting into Gies College of Business')],
  ['an unknown note', issue('some-new-note', 'info', 'Something to know')],
]) check(`good to know: ${why}`, issueTier(i) === 'later');

// --- what the student said they hold ---------------------------------------------
console.log('Credit the student said they hold:');
for (const [text, want] of [
  ["I'm a third year with about 70 credits", 70],
  ['I have 60 hours', 60],
  ['30 credit hours from community college', 30],
  ['I want to take 15 credits a semester', null],
  ['12 hours per term, I have 45 credits', 45],
  ['no more than 15 credits/semester', null],
  ['Psychology, graduating Spring 2030', null],
]) check(`"${text}" reads as ${want}`, statedHours(text) === want, String(statedHours(text)));
check('said and not recorded asks for the record', recordPrompt({ said: 70, recorded: 0, assumed: 0 }) === 'You said about 70 credits; none are recorded. Add your classes or upload a transcript to get an accurate check.');
check('said and partly recorded says how much is recorded', /^You said about 70 credits; 30 are recorded\./.test(recordPrompt({ said: 70, recorded: 30, assumed: 0 }) ?? ''));
check('said and recorded, within a few hours, asks nothing', recordPrompt({ said: 70, recorded: 66, assumed: 0 }) === null);
check('terms the build assumed credit for ask for their classes', /^Your classes from Fall 2024, Spring 2025 and Fall 2025 are not recorded yet\./.test(recordPrompt({ said: null, recorded: 0, assumed: 45, assumedTerms: 'Fall 2024, Spring 2025 and Fall 2025' }) ?? ''));
check('a first-year who said nothing is asked nothing', recordPrompt({ said: null, recorded: 0, assumed: 0 }) === null);

// --- the bar on made-up boards ----------------------------------------------------
console.log('The bar:');
// The live-site wall: a UGA third-year who typed "about 70 credits" and uploaded nothing.
const wall = [
  issue('degree-incomplete', 'error', 'This plan does not fulfill the degree yet', 'This draft has 66 of the 120 credits required for the degree. Incomplete requirements include IV. World Languages and Global Culture, IV. Humanities and the Arts, V. Social Sciences and 4 more.'),
  ...['Advanced Laboratory course or Seminar course', 'Group B - Social, Developmental, and Applied Courses', 'IV. Humanities and the Arts', 'IV. World Languages and Global Culture', 'Methods', 'V. Social Sciences', 'VI. Courses Related to the Major'].map((a) => issue(`uga-area-${a}`, 'error', a, `${a}: 0 of 6 credits. More eligible coursework is needed.`)),
  issue('uga-pool-61::4-hours-short', 'error', 'IV. World Languages and Global Culture: World Languages and Global Culture Core Courses', '9 hours from this list, 0 hours in the plan.'),
  issue('uga-total', 'error', 'Degree credits are short', 'This draft has 66 of 120 required credits, including in-progress work that must be passed.'),
];
const said70 = { said: 70, recorded: 0, assumed: 0 };
{
  const t = triageIssues(wall, { credit: said70, bot: 'ARCH' });
  check('the wall becomes one prompt', t.prominent.length === 1 && t.prominent[0].key === 'record', JSON.stringify(labels(t)));
  check('the prompt is plain', t.prominent[0].label === 'You said about 70 credits; none are recorded. Add your classes or upload a transcript to get an accurate check.', t.prominent[0].label);
  check('the prompt names the advisor', /tell ARCH what you took/.test(t.prompt.issue.message), t.prompt.issue.message);
  check('every shortfall is folded under it, not dropped', t.folded.length === wall.length && accounted(t) === wall.length, `${t.folded.length} folded, ${accounted(t)} accounted`);
  check('"Show N more" opens all of them', t.more.length === wall.length, String(t.more.length));
  check('no all-clear while the record is missing', !t.allClear);
  check('the build line is the prompt', t.line.startsWith('You said about 70 credits; none are recorded.'), t.line);
  // The same board without the stated credit: the shortfalls are the problems.
  const plain = triageIssues(wall);
  check('without the stated credit the requirements are what matters', plain.prominent.length === 1 && plain.prominent[0].label === '8 requirements not met' && plain.prominent[0].issue.id === 'degree-incomplete', JSON.stringify(labels(plain)));
}
{
  // A real problem the missing credit does not explain stays prominent beside the prompt.
  const t = triageIssues([...wall, issue('ap-prereq-order-fall-2027-psyc-4210-PSYC 3980', 'warning', 'Prerequisite later in the plan'), issue('weekly-clash-spring-2027', 'warning', 'Class times clash')], { credit: said70 });
  check('a prerequisite out of order and a clash show beside the prompt', JSON.stringify(labels(t)) === JSON.stringify([t.prompt.label, 'Prerequisite later in the plan', 'Class times clash']), JSON.stringify(labels(t)));
  check('the line adds them', /Also: Prerequisite later in the plan; Class times clash\.$/.test(t.line), t.line);
}
{
  // UGA continuing student with a record: only the in-progress note and unread requirements.
  const t = triageIssues([
    issue('uga-pending', 'info', 'In-progress credit is conditional', 'Your record shows 18 earned credits and 12 in progress.'),
    issue('uga-unverified-77024::7::unlisted', 'info', 'Requirement needs advisor review', 'VI. Courses Related to the Major: the snapshot does not identify all required courses.'),
    issue('uga-unverified-77024::8::unlisted', 'info', 'Requirement needs advisor review', 'Required Courses: the snapshot does not identify all required courses.'),
  ], { credit: { said: null, recorded: 30, assumed: 0 } });
  check('in-progress credit and unread requirements leave the all-clear', t.allClear && t.prominent.length === 0 && t.line === 'Nothing needs attention.', t.line);
  check('they are good to know, behind "Show 3 more"', t.later.length === 3 && t.more.length === 3, `${t.later.length} ${t.more.length}`);
}
{
  // A plan with a real missing required class, a prerequisite problem, a clash and a heavy term.
  const board = [
    issue('degree-incomplete', 'error', 'This plan does not fulfill the degree yet', 'Incomplete requirements include Methods.'),
    issue('uga-area-Methods', 'error', 'Methods', 'Methods: 3 of 6 credits.'),
    issue('uga-total', 'error', 'Degree credits are short'),
    issue('ap-load-fall-2027', 'warning', 'Heavy course load', 'Fall 2027 is 21 credits.'),
    issue('ap-prereq-fall-2027-psyc-4210-PSYC 3980', 'error', 'Prerequisite conflict', 'PSYC 4210 needs PSYC 3980 in an earlier term.', { courseId: 'psyc-4210' }),
    issue('weekly-clash-spring-2027', 'warning', 'Class times clash'),
    issue('ap-hard-fall-2029', 'warning', 'Several hard courses together'),
    issue('uga-unverified-1', 'info', 'Requirement needs advisor review', 'A: the snapshot does not identify all required courses.'),
  ];
  const t = triageIssues(board, { credit: { said: null, recorded: 0, assumed: 0 } });
  check(`at most ${PROMINENT_LIMIT} show`, t.prominent.length === PROMINENT_LIMIT, JSON.stringify(labels(t)));
  check('the missing required class and the prerequisite come first', t.prominent[0].label === 'Requirement not met: Methods' && t.prominent[1].label === 'Prerequisite missing', JSON.stringify(labels(t)));
  check('the summary row and the credit total are one kind with the requirement', t.prominent[0].rows.length === 3, String(t.prominent[0].rows.length));
  check('a fourth thing that matters is folded and counted', t.now.length === 4 && t.more.some((r) => r.issue.id === 'ap-load-fall-2027'), JSON.stringify(t.now.map((k) => k.label)));
  check('the line counts four and names three', t.line === '4 things need attention: Requirement not met: Methods; Prerequisite missing; Class times clash; and 1 more.', t.line);
  check('nothing is dropped', accounted(t) === board.length && t.more.length + t.prominent.reduce((n, k) => n + k.rows.length, 0) === board.length - 0, `${accounted(t)} of ${board.length}`);
  const flags = rankedFlags(t);
  check('the advisor gets every row, ranked', flags.length === t.now.flatMap((k) => k.rows).length + t.folded.length + t.later.length, String(flags.length));
  check('rows the bar shows are marked so', flags[0].startsWith('now, on the board: error: This plan does not fulfill the degree yet'), flags[0]);
  check('a folded problem is marked as under Show more', flags.some((f) => f.startsWith('now, under Show more: warning: Heavy course load')), flags.join('\n'));
  check('information is marked good to know, last', flags[flags.length - 1].startsWith('good to know: '), flags[flags.length - 1]);
  check('the advisor list is capped with a count', rankedFlags(t, 3).length === 4 && /^and \d+ more rows/.test(rankedFlags(t, 3)[3]), rankedFlags(t, 3).join(' | '));
}
{
  // Identical rows are one row with a count; a kind counts its rows.
  const twice = [issue('ap-prereq-order-a', 'warning', 'Prerequisite later in the plan', 'A after B.'), issue('ap-prereq-order-b', 'warning', 'Prerequisite later in the plan', 'C after D.')];
  check('two of a kind read with a count', labels(triageIssues(twice))[0] === 'Prerequisite later in the plan (2)');
  const same = [issue('notplaced-x', 'warning', 'x', 'same'), issue('notplaced-y', 'warning', 'x', 'same')];
  check('identical rows fold into one', triageIssues(same).now[0].rows.length === 1 && triageIssues(same).now[0].rows[0].count === 2);
}
{
  // A held course given up for a required one: the exclusion beside it says the same thing.
  const forfeit = [
    issue('ap-forfeit-STAT 100', 'info', 'Credit that will not count', 'PSYC 235 is required, and the catalog says credit is not given for both PSYC 235 and STAT 100.'),
    issue('ap-exclusion-spring-2027-psyc-235-stat-100', 'info', 'These do not both count', 'PSYC 235 and STAT 100 do not both count toward graduation.'),
  ];
  check('an exclusion explained by a forfeit is good to know', triageIssues(forfeit).allClear && triageIssues(forfeit).later.length === 2);
  const added = [issue('ap-exclusion-fall-2027-math-220-math-221', 'info', 'These do not both count', 'MATH 220 and MATH 221 do not both count toward graduation.')];
  check('two planned courses that do not both count still matter', !triageIssues(added).allClear && labels(triageIssues(added))[0] === 'Two courses that do not both count');
}
{
  // A UGA area the snapshot cannot fully read is short on the planner's own board: an advisor checks it.
  const unreadArea = [
    issue('degree-incomplete', 'error', 'This plan does not fulfill the degree yet', 'Incomplete requirements include VI. Courses Related to the Major, Required Courses. Add or replace courses until every degree requirement is complete.'),
    issue('uga-area-VI. Courses Related to the Major', 'error', 'VI. Courses Related to the Major', 'VI. Courses Related to the Major: 13 of 18 credits. More eligible coursework is needed.'),
    issue('uga-area-Required Courses', 'error', 'Required Courses', 'Required Courses: 9 of 30 credits. More eligible coursework is needed.'),
    issue('uga-unverified-77024::7::unlisted', 'info', 'Requirement needs advisor review', 'VI. Courses Related to the Major: the snapshot does not identify all required courses. Credit totals alone cannot verify this requirement.'),
    issue('uga-unverified-77024::8::unlisted', 'info', 'Requirement needs advisor review', 'Required Courses: the snapshot does not identify all required courses. Credit totals alone cannot verify this requirement.'),
  ];
  const t = triageIssues(unreadArea);
  check('areas short only where the snapshot cannot name the courses leave the all-clear', t.allClear && t.later.length === 5, JSON.stringify(labels(t)));
  check('they read as requirements to check with an advisor', t.later.filter((r) => r.kind.text === 'Requirement to check with your advisor').length === 5);
  const short = triageIssues([...unreadArea, issue('uga-total', 'error', 'Degree credits are short', 'This draft has 110 of 120 required credits.')]);
  check('a plan under the credit total still matters', !short.allClear && short.prominent[0].rows.some((r) => r.issue.id === 'uga-area-Required Courses'), JSON.stringify(labels(short)));
  const other = triageIssues([...unreadArea, issue('uga-area-Methods', 'error', 'Methods', 'Methods: 3 of 6 credits.')]);
  check('an area with nothing unread in it still matters, with the summary row', JSON.stringify(labels(other)) === '["Requirement not met: Methods"]' && other.prominent[0].issue.id === 'degree-incomplete', JSON.stringify(labels(other)));
  const pool = triageIssues([...unreadArea, issue('uga-pool-77024::3-hours-short', 'error', 'Required Courses: ECON 4000-level', '6 hours from this list, 3 hours in the plan.')]);
  check('a named list short in the same area still matters', !pool.allClear && labels(pool)[0] === 'Requirement not met: Required Courses: ECON 4000-level', JSON.stringify(labels(pool)));
}
{
  const t = triageIssues([]);
  check('an empty board is all clear', t.allClear && t.more.length === 0 && t.line === 'Nothing needs attention.');
  const stray = triageIssues([issue('stated-hours', 'warning', 'You said about 70 credits; none are recorded', 'Upload your transcript.')]);
  check('a stated-hours row with no credit facts still matters', !stray.allClear && stray.prominent[0].label === 'You said about 70 credits; none are recorded', JSON.stringify(labels(stray)));
}

// --- real boards --------------------------------------------------------------------
const A = await import(join(HERE, 'autoplan.ts'));
const { degreeCompletionIssue } = await import(join(HERE, 'completion.ts'));
const T = await import(join(HERE, 'transcript.ts'));
const pub = (n) => JSON.parse(readFileSync(join(ROOT, 'public', n), 'utf8'));

console.log('Real UGA boards:');
{
  const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
  const G = await import(join(HERE, 'uga-planning-guidance.ts'));
  const { DEFAULT_PRIORITIES } = await import(join(HERE, 'priorities.ts'));
  const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(join(ROOT, 'public', (typeof url === 'string' ? url : url instanceof URL ? url.pathname : url.url).replace(/^\//, ''))));
  const data = await U.loadUgaData();
  globalThis.fetch = realFetch;
  const codeOf = (id) => data.courses.find((c) => c.id === id)?.code ?? '';
  function program(name, degree) {
    const p = data.programs.find((x) => x.name.startsWith(name) && x.degree === degree);
    const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(p).map((r) => [r.id, r.options.slice(0, r.minimum).map((o) => o.id)]));
    const loaded = U.loadUgaProgram(data, p, { emphasisSelections });
    const context = { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [p.id])) };
    return { p, loaded, context };
  }
  /** The board's issues as the workspace lists them: the completion row and Cameron's audit. */
  function board(prog, { priorCodes = [], horizon, transcript = null, edit = null }) {
    const g = A.generatePlan({ requirements: prog.loaded.blocks, context: prog.context, programName: prog.loaded.program.name, programId: prog.p.id,
      prior: { known: true, courseCodes: priorCodes, exemptCodes: [], unmatchedCredits: 0 }, horizon,
      degreeTotal: prog.p.totalCredits, electiveHoursLimit: prog.loaded.electiveHours, fillToDegreeTotal: prog.loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: DEFAULT_PRIORITIES } });
    const plan = edit ? edit(g.plan) : g.plan;
    const completed = plan.completedCourseIds.map(codeOf).filter(Boolean);
    const recorded = A.planCreditRange(completed, prog.context).min;
    const audit = auditUgaBoard({ board: plan, context: prog.context, undergraduate: prog.loaded, priorCodes: completed, extraCredits: 0, transcript, validation: { minimumTermCredits: 12, priorCredits: recorded } });
    const areas = audit.areas.filter((r) => r.area.hours > 0 && !r.satisfied);
    const pools = audit.pools.filter((p) => (p.hoursTarget !== null && p.hours < p.hoursTarget) || (p.countTarget !== null && p.count < p.countTarget));
    const done = degreeCompletionIssue({ currentCredits: audit.total, requiredCredits: audit.target, incompleteRequirementNames: [...areas.map((r) => r.area.label), ...pools.map((p) => p.label)], termId: plan.terms[0]?.id ?? '' });
    return { issues: [done, ...audit.issues].filter(Boolean), recorded, plan };
  }
  const fourYears = { startSeason: 'Fall', startYear: 2027, gradSeason: 'Spring', gradYear: 2031, stated: true };
  const psych = program('Psychology', 'BS');
  const econ = program('Economics', 'AB');

  // A class the Bulletin lists for summer only, in a fall or spring, is flagged since 2026-10-22
  // (uga-board-audit.ts, "Not offered this term"), and since the owner's decision the same day the
  // planner books none there (__uga-summer.check.mjs 4b): Economics AB's board held ARHI 2121 before.
  // These checks are about the other rows, so they are read without such flags either way.
  const summerOnlyFlag = (i) => i.id.startsWith('ap-offering-') && /for summer only/.test(i.message);
  // So are the board's flags for a class the Schedule of Classes ran in another season (uga-board-audit.ts, 2026-10-28).
  const seasonFlag = (i) => summerOnlyFlag(i) || (i.id.startsWith('ap-offering-') && /on UGA's Schedule of Classes/.test(i.message));
  const econBoard = board(econ, { horizon: fourYears });
  const econFresh = { ...econBoard, issues: econBoard.issues.filter((i) => !seasonFlag(i)) };
  check('Economics AB\'s board books no summer-only class in a fall or spring term, so none is flagged', !econBoard.issues.some(summerOnlyFlag), String(econBoard.issues.filter(summerOnlyFlag).length));
  const unread = econFresh.issues.filter((i) => i.id.startsWith('uga-unverified-'));
  check('Economics AB has requirements the snapshot cannot fully read', unread.length >= 1, String(unread.length));
  check('Cameron\'s audit marks them information', unread.every((i) => i.severity === 'info'));
  const econT = triageIssues(econFresh.issues, { credit: { said: null, recorded: 0, assumed: 0 } });
  check('they are good to know, not on the bar', unread.every((i) => econT.later.some((r) => r.issue.id === i.id)) && !econT.prominent.some((k) => k.rows.some((r) => r.issue.id.startsWith('uga-unverified-'))), JSON.stringify(labels(econT)));
  check('area hours the snapshot cannot name do not stand between Economics AB and the all-clear', econT.allClear, JSON.stringify(labels(econT)));
  console.log(`  Economics AB first-year: ${econFresh.issues.length} rows; bar: ${econT.allClear ? 'Nothing needs attention' : labels(econT).join(' | ')}; Show ${econT.more.length} more`);

  const saidBoard = board(psych, { horizon: { startSeason: 'Spring', startYear: 2027, gradSeason: 'Spring', gradYear: 2028, stated: true } });
  const said = { ...saidBoard, issues: saidBoard.issues.filter((i) => !seasonFlag(i)) };
  const saidT = triageIssues(said.issues, { credit: { said: statedHours("I'm a third year with about 70 credits, graduating Spring 2028."), recorded: said.recorded, assumed: 0 } });
  check('a UGA third-year who typed about 70 credits gets requirement shortfalls on the board', said.issues.filter((i) => /^uga-(?:area|pool|total)/.test(i.id)).length >= 3, String(said.issues.length));
  check('and sees one prompt instead of them', saidT.prominent.length === 1 && saidT.prominent[0].key === 'record' && saidT.folded.length === said.issues.length, `${JSON.stringify(labels(saidT))} folded ${saidT.folded.length} of ${said.issues.length}`);
  console.log(`  Psychology BS third-year, "about 70 credits": ${said.issues.length} rows; bar: ${labels(saidT).join(' | ')}; Show ${saidT.more.length} more`);

  const record = T.matchTranscript({ institution: 'University of Georgia', kind: 'transcript', courses: [
    ['ENGL 1101', 'Fall 2025', 'completed'], ['ENGL 1102', 'Spring 2026', 'completed'], ['PSYC 1101', 'Fall 2025', 'completed'], ['MATH 1113', 'Fall 2025', 'completed'],
    ['HIST 2111', 'Spring 2026', 'completed'], ['POLS 1101', 'Spring 2026', 'completed'], ['STAT 2000', 'Fall 2026', 'in_progress'], ['SPAN 1001', 'Fall 2026', 'in_progress'],
  ].map(([code, term, status]) => ({ code, title: code, credits: 3, grade: status === 'completed' ? 'A' : '', term, status })), exams: [], notes: [] }, 'record.pdf', data.courses, undefined, null, 'uga');
  const withRecord = board(psych, { priorCodes: T.transcriptCodes(record), transcript: record, horizon: { startSeason: 'Spring', startYear: 2027, gradSeason: 'Spring', gradYear: 2029, stated: true } });
  const pending = withRecord.issues.find((i) => i.id === 'uga-pending');
  check('in-progress credit is a note on a record with classes in progress', pending?.severity === 'info', JSON.stringify(pending));
  const recordT = triageIssues(withRecord.issues, { credit: { said: null, recorded: withRecord.recorded, assumed: 0 } });
  check('and it does not stand between the student and the all-clear', !recordT.prominent.some((k) => k.rows.some((r) => r.issue.id === 'uga-pending')) && recordT.later.some((r) => r.issue.id === 'uga-pending'));
  console.log(`  Psychology BS with a record: ${withRecord.issues.length} rows; bar: ${recordT.allClear ? 'Nothing needs attention' : labels(recordT).join(' | ')}; Show ${recordT.more.length} more`);

  // The first-year board with a required course taken off and a 4000-level course moved before its prerequisite.
  let removed = null;
  let moved = null;
  const broken = board(psych, { horizon: fourYears, edit: (plan) => {
    const all = plan.terms.flatMap((t) => t.courseIds.map((id) => ({ id, code: codeOf(id) })));
    removed = all.find((x) => /^PSYC 3/.test(x.code));
    moved = [...all].reverse().find((x) => /^PSYC 4/.test(x.code));
    const terms = plan.terms.map((t) => ({ ...t, courseIds: t.courseIds.filter((id) => id !== removed.id && id !== moved.id) }));
    terms[0].courseIds.push(moved.id);
    return { ...plan, terms };
  } });
  const brokenT = triageIssues(broken.issues, { credit: { said: null, recorded: 0, assumed: 0 } });
  const shownIds = brokenT.prominent.flatMap((k) => k.rows.map((r) => r.issue.id));
  check(`a missing required class (${removed?.code} off the board) shows`, shownIds.includes('degree-incomplete') && shownIds.some((id) => id.startsWith('uga-area-')), JSON.stringify(labels(brokenT)));
  check(`a prerequisite problem (${moved?.code} first) shows`, shownIds.some((id) => id.startsWith('ap-prereq-')), JSON.stringify(labels(brokenT)));
  check('nothing on the real board is dropped', accounted(brokenT) === broken.issues.length && accounted(saidT) === said.issues.length && accounted(econT) === econFresh.issues.length);
  console.log(`  Psychology BS broken (${removed?.code} off, ${moved?.code} first): bar: ${labels(brokenT).join(' | ')}; Show ${brokenT.more.length} more`);
}

console.log('Real Illinois boards:');
{
  const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
  const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
  const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
  const meta = pub('illinois/meta.json');
  const rows = pub('illinois/index.json').map(hydrateIndexRow);
  const offerings = pub('illinois/offerings.json');
  applyOfferings(rows, offerings);
  const byCode = new Map(rows.map((c) => [norm(c.code), c]));
  const byId = new Map(rows.map((c) => [c.id, c]));
  const equivalents = new Map();
  for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
  const creditRanges = new Map(rows.map((c) => [norm(c.code), { credits: c.credits, min: c.credits, max: c.creditsMax ?? c.credits, variable: (c.creditsMax ?? c.credits) > c.credits, known: true }]));
  const gradeRaw = new Map(pub('illinois/grades.json').map((g) => [norm(g.code), g]));
  const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
  const season = (meta.term?.term ?? 'fall').toLowerCase();
  const context = {
    courses: rows, prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))), grades, equivalents,
    exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))), creditRanges, bands: meta.bands,
    offeringPublished: new Set(rows.map((c) => norm(c.code))), offerings: new Map(Object.entries(offerings.courses)), offeringTerms: offerings.terms,
    offeringAliases: offerings.renumbered ? new Map(Object.entries(offerings.renumbered)) : undefined,
    languages: pub('illinois/languages.json'),
    snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
    prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
  };
  const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
  const summary = pub('illinois/programs.json').find((p) => p.id === 'las/psychology-bslas');
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${summary.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(summary.id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  const program = adapted.programs[0];
  const fresh = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };
  function generated(prior, horizon) {
    return A.generatePlan({ requirements: blocks, context, prior, horizon, preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: PRIORITY_PRESETS.balanced }, programId: summary.id, degreeTotal: summary.totalCredits || 120, interests: '', career: '', programName: program.name, programCollege: program.college, admissionRoute: null, residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' } });
  }
  /** The board's issues as the workspace lists them: the completion row, held credit given up, and the validator. */
  function issuesOf(g, plan = g.plan) {
    const held = plan.completedCourseIds.map((id) => norm(byId.get(id)?.code ?? '')).filter(Boolean);
    const onBoard = plan.terms.flatMap((t) => t.courseIds).map((id) => norm(byId.get(id)?.code ?? '')).filter(Boolean);
    const total = A.planCreditRange([...held, ...onBoard], context).min;
    const done = degreeCompletionIssue({ currentCredits: total, requiredCredits: summary.totalCredits || 120, incompleteRequirementNames: [], termId: plan.terms[0]?.id ?? '' });
    const forfeits = g.forfeited.map((f) => ({ id: `ap-forfeit-${f.held}`, severity: 'info', title: 'Credit that will not count', message: `${f.for} is required, and the catalog says credit is not given for both ${f.for} and ${f.held}.`, termId: '' }));
    const validation = A.validatePlan(plan, context, { minimumTermCredits: 12, maxTermCredits: 18, programName: program.name, programCollege: program.college, priorCredits: A.planCreditRange(held, context).min, language: g.language });
    return [done, ...forfeits, ...validation].filter(Boolean);
  }
  const freshG = generated(fresh, { startSeason: 'Fall', startYear: 2027, gradSeason: 'Spring', gradYear: 2031, stated: true });
  const freshB = { plan: freshG.plan, issues: issuesOf(freshG) };
  const freshT = triageIssues(freshB.issues, { credit: { said: null, recorded: 0, assumed: 0 } });
  check('an Illinois Psychology first-year is told nothing needs attention', freshT.allClear, JSON.stringify(labels(freshT)));
  console.log(`  Psychology first-year: ${freshB.issues.length} rows; bar: ${freshT.allClear ? 'Nothing needs attention' : labels(freshT).join(' | ')}; Show ${freshT.more.length} more`);
  const assumedT = triageIssues(freshB.issues, { credit: { said: 70, recorded: 0, assumed: 75, assumedTerms: 'Fall 2024 to Fall 2026' } });
  check('a third-year whose terms the build assumed is asked for the record', assumedT.prominent[0]?.key === 'record' && !assumedT.allClear);
  // PSYC 235 taken off, and the first later PSYC course whose prerequisite the move breaks put in the first term.
  const all = freshG.plan.terms.flatMap((t) => t.courseIds.map((id) => ({ id, code: norm(byId.get(id)?.code ?? '') })));
  const req = all.find((x) => x.code === 'PSYC 235');
  const without = { ...freshG.plan, terms: freshG.plan.terms.map((t) => ({ ...t, courseIds: t.courseIds.filter((id) => id !== req.id) })) };
  let brokenB = null;
  for (const later of [...all].reverse().filter((x) => /^PSYC [34]/.test(x.code))) {
    const terms = without.terms.map((t) => ({ ...t, courseIds: t.courseIds.filter((id) => id !== later.id) }));
    terms[0].courseIds.push(later.id);
    const plan = { ...without, terms };
    const issues = issuesOf(freshG, plan);
    if (issues.some((i) => /^ap-prereq-(?!check|text|order)/.test(i.id) || i.id.startsWith('ap-prereq-order-'))) { brokenB = { plan, issues, moved: later.code }; break; }
  }
  check('a PSYC course can be moved before its prerequisite', Boolean(brokenB));
  const brokenT = triageIssues(brokenB?.issues ?? [], { credit: { said: null, recorded: 0, assumed: 0 } });
  const shownIds = brokenT.prominent.flatMap((k) => k.rows.map((r) => r.issue.id));
  check('PSYC 235 taken off shows as the degree not finished', shownIds.includes('degree-incomplete'), JSON.stringify(labels(brokenT)));
  check(`${brokenB?.moved} moved before its prerequisite shows`, shownIds.some((id) => id.startsWith('ap-prereq-')), JSON.stringify(labels(brokenT)));
  console.log(`  Psychology broken (PSYC 235 off, ${brokenB?.moved} first): bar: ${labels(brokenT).join(' | ')}; Show ${brokenT.more.length} more`);
  const recordG = generated({ ...fresh, courseCodes: ['RHET 105', 'PSYC 100', 'MATH 115', 'STAT 100', 'SPAN 103', 'ECON 102', 'SOC 100'] }, { startSeason: 'Spring', startYear: 2027, gradSeason: 'Spring', gradYear: 2029, stated: true });
  const recordB = { plan: recordG.plan, issues: issuesOf(recordG) };
  const recordT = triageIssues(recordB.issues, { credit: { said: null, recorded: 25, assumed: 0 } });
  const exclusion = recordB.issues.find((i) => i.id.startsWith('ap-exclusion-'));
  check('a record with STAT 100 has it given up for the required PSYC 235', Boolean(exclusion) && recordB.issues.some((i) => i.id === 'ap-forfeit-STAT 100'), recordB.issues.map((i) => i.id).join(', '));
  check('and says so once, as good to know', recordT.later.some((r) => r.issue.id === exclusion?.id) && !recordT.prominent.some((k) => k.key === 'exclusion'), JSON.stringify(labels(recordT)));
  console.log(`  Psychology with a record: ${recordB.issues.length} rows; bar: ${recordT.allClear ? 'Nothing needs attention' : labels(recordT).join(' | ')}; Show ${recordT.more.length} more`);
}

// --- what reads the triage --------------------------------------------------------
console.log('Where it is read:');
const workspace = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
check('the board bar is the attention bar', /<AttentionBar triage=\{triage\}/.test(workspace));
check('review_board gives ALMA and ARCH every row, ranked', /review_flags: rankedFlags\(triaged\)/.test(workspace) && /triageIssues\(currentIssues, \{ credit: L\.creditGap/.test(workspace));
check('the build line follows the triage', /triage\.allClear \? 'Plan built\. Nothing needs attention\.' : `Draft built\. \$\{triage\.line\}`/.test(workspace));
const audit = readFileSync(join(ROOT, 'components/planner/uga-board-audit.ts'), 'utf8');
check('uga-board-audit.ts writes the two rows as information', /id: `uga-unverified-\$\{block\.id\}`,\s*severity: 'info'/.test(audit) && /id: 'uga-pending',\s*severity: 'info'/.test(audit));

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
