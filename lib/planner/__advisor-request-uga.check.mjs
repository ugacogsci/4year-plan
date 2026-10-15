/**
 * ARCH (UGA) next to ALMA (Illinois), checked without calling the API.
 *
 * What this pins:
 *   1. ALMA is untouched: its instructions and its tool list are byte for
 *      byte what they were at 7ac1b7a, before ARCH shared ALMA's rules
 *      (sha256 below, taken from that commit), and building ARCH's tools
 *      does not change ALMA's;
 *   2. the shared rules: every school-neutral rule is in both prompts, word
 *      for word, so the two cannot drift;
 *   3. ARCH's own instructions: no Illinois anywhere; ask before changing,
 *      change only what was asked, report exactly what the tools changed;
 *      UGA's own wellbeing contacts; what to say for what the planner holds
 *      for Illinois only;
 *   4. ARCH's tools: ALMA's, less the Illinois-only ones, in ALMA's order,
 *      with the same schemas and no Illinois in any description;
 *   5. UGA's term dates: read from the Registrar's calendar, each weekday as
 *      the page prints it, attached for UGA only and measured against the
 *      day asked; Illinois's dates never reach a UGA student, nor UGA's an
 *      Illinois one;
 *   6. the tool handlers (in the planner screen, which cannot run here):
 *      Illinois's text is still there unchanged, and each UGA branch exists.
 *
 *   node lib/planner/__advisor-request-uga.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const R = await import(join(HERE, 'advisor-request.ts'));
const A = await import(join(HERE, 'advisor.ts'));
const D = await import(join(HERE, 'term-dates.ts'));
const U = await import(join(HERE, 'uga-term-dates.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));
const sha = (s) => createHash('sha256').update(s).digest('hex');

const ILL = { bot: 'ALMA', schoolName: 'University of Illinois Urbana-Champaign', schoolShort: 'Illinois' };
const UGA = { bot: 'ARCH', schoolName: 'University of Georgia', schoolShort: 'UGA' };
const NOW = new Date('2026-10-14T17:00:00Z');
const BOARD = 'Today: Wednesday, October 14, 2026.\nDegree: Psychology, BS, University of Georgia.\nFall 2026 (15 cr): PSYC 1101 [required] 3 cr Elementary Psychology';
const request = (school, now = NOW) => R.advisorRequest({ model: 'claude-opus-5', ...school, board: BOARD, messages: [{ role: 'user', content: 'When is the withdrawal deadline?' }], now });
const contextOf = (req) => req.messages[req.messages.length - 1].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const ALMA = A.advisorSystem(ILL.bot, ILL.schoolName, ILL.schoolShort);
const ARCH = A.advisorSystem(UGA.bot, UGA.schoolName, UGA.schoolShort);

// ---------------------------------------------------------------------------
console.log('\n=== 1. ALMA is untouched ===\n');
{
  // Taken at 7ac1b7a, before the shared rules existed.
  const ALMA_SYSTEM_SHA = 'ae44ba37aedb4a7b9fb235e783b1b8869cc1265c034ca23818ad08eaaa11ec42';
  const ALMA_TOOLS_SHA = '1b2a45604b8b9675274c7604b1ebb7ad731513d87ce167770e9fc9f58b10d8f6';
  expect(sha(ALMA) === ALMA_SYSTEM_SHA && ALMA.length === 25366, "ALMA's instructions are byte for byte the same as before", `${sha(ALMA)} (${ALMA.length})`);
  const ill = request(ILL);
  expect(sha(JSON.stringify(ill.tools)) === ALMA_TOOLS_SHA, "ALMA's 24 tools are byte for byte the same as before");
  A.ugaAdvisorTools();
  expect(sha(JSON.stringify(A.ADVISOR_TOOLS)) === ALMA_TOOLS_SHA && sha(JSON.stringify(request(ILL).tools)) === ALMA_TOOLS_SHA, "building ARCH's tools leaves ALMA's list as it was");
  expect(ill.system[0].text === ALMA, 'the Illinois request still sends that text');
  const ctx = contextOf(ill);
  expect(ctx.includes(D.termDatesBlock(NOW)) && !ctx.includes('UGA term dates'), "ALMA gets Illinois's dates and never UGA's");
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. The shared rules are in both prompts, word for word ===\n');
{
  const keys = Object.keys(A.SHARED_ADVISOR_RULES);
  const missingAlma = keys.filter((k) => !ALMA.includes(A.SHARED_ADVISOR_RULES[k]));
  const missingArch = keys.filter((k) => !ARCH.includes(A.SHARED_ADVISOR_RULES[k]));
  expect(keys.length >= 15, `${keys.length} shared rules`);
  expect(missingAlma.length === 0, 'each is in ALMA\'s prompt', missingAlma.join(', '));
  expect(missingArch.length === 0, 'each is in ARCH\'s prompt', missingArch.join(', '));
  expect(ALMA.startsWith(A.introLine(ILL.bot, ILL.schoolName, ILL.schoolShort)) && ARCH.startsWith(A.introLine(UGA.bot, UGA.schoolName, UGA.schoolShort)), 'both open with the same line, each with its own school');
  expect(ALMA.includes(A.answerAnyLine('Illinois')) && ARCH.includes(A.answerAnyLine('UGA')), 'both are for answering any question about their school');
  expect(A.SHARED_ADVISOR_RULES.reasonBoardIsTruth.includes(A.BOARD_NOTE) && ARCH.includes(`A user message that starts with ${A.BOARD_NOTE} is written by the planner, not the student`), 'ARCH knows an undo note is the planner, not the student');
  expect(keys.every((k) => !/Illinois|Grainger|Gies|LAS\b|Parkland/.test(A.SHARED_ADVISOR_RULES[k])), 'no shared rule names Illinois or its colleges');
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. ARCH's own instructions ===\n");
{
  expect(!/Illinois|Grainger|Gies|\bLAS\b|Transferology|Parkland|217-\d{3}|Teachers Ranked as Excellent|Canvas/.test(ARCH), 'nothing of Illinois in ARCH\'s prompt', (ARCH.match(/.{30}(Illinois|Grainger|Gies|\bLAS\b|Transferology|Parkland|217-\d{3}|Teachers Ranked|Canvas).{30}/) ?? [''])[0]);
  expect(!/Do not stop to ask|act on it:/i.test(ARCH), 'the old "act on an interest without stopping to ask" is gone');
  expect(/Change the board only for a change the student asked for, or one you proposed and they said yes to/.test(ARCH), 'ARCH changes the board only when asked or on a yes');
  expect(/Change only what was asked/.test(ARCH) && /An interest .* is a reason to search and propose, not to edit/.test(ARCH), 'it changes only what was asked, and proposes on an interest');
  expect(/the summary of every edit tool that returned ok true in this turn, and nothing more/.test(ARCH) && /Never say you changed nothing after an edit succeeded/.test(ARCH) && /ok false changed nothing/.test(ARCH), 'it reports exactly what the tools changed, and never "nothing changed" after a change');
  expect(/what_if/.test(ARCH) && /review_board/.test(ARCH) && /explain_choice/.test(ARCH), 'it is told to try changes with what_if and judge with review_board');
  expect(/Wellbeing comes before the plan/.test(ARCH) && ARCH.includes('706-542-8479') && ARCH.includes('sco@uga.edu') && ARCH.includes('706-542-2273') && /\b988\b/.test(ARCH) && /\b911\b/.test(ARCH) && /make no board edits/.test(ARCH), "a student in trouble gets UGA's Student Care and Outreach, CAPS, 911 and 988, and no edits");
  expect(/"UGA term dates" block/.test(ARCH) && /Today's date is the first line of the board description/.test(ARCH), 'it uses the UGA dates block and measures deadlines against today');
  expect(/prior_credit/.test(ARCH) && /find_equivalent/.test(ARCH) && /record_prior_credit and a UGA course code/.test(ARCH) && /exam_credit/.test(ARCH) && /NTFR/.test(ARCH), 'transfer and AP credit, with UGA codes and UGA\'s own list');
  for (const [what, re] of [
    ['clubs', /no UGA student-organization list/],
    ['syllabi', /come only from course_syllabus/],
    ['class times', /Class times, sections and the weekly clash check: not loaded for UGA/],
    ['grade history and ratings', /Grade history and teaching ratings: none are loaded for UGA/],
    ['admission, second majors, minors', /second major, minors and certificates: the planner does not check these for UGA/],
    ['plan shape', /you cannot change these from the chat for UGA yet/],
  ]) expect(re.test(ARCH), `says plainly the planner has no UGA ${what}`);
  expect(ARCH.length > 9000 && ARCH.length < ALMA.length, `ARCH's prompt is ${ARCH.length} characters (ALMA's ${ALMA.length})`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. ARCH's tools ===\n");
{
  const uga = request(UGA);
  const names = uga.tools.map((t) => t.name);
  const WANT = ['search_courses', 'course_details', 'course_syllabus', 'term_summary', 'add_course', 'remove_course', 'replace_course', 'move_course', 'compare_courses', 'explain_choice', 'what_if', 'review_board', 'exam_credit', 'prior_credit', 'find_equivalent', 'record_prior_credit', 'drop_prior_credit', 'planner_answer', 'university_answer'];
  expect(JSON.stringify(names) === JSON.stringify(WANT), `ARCH has ${names.length} tools, in ALMA's order`, names.join(', '));
  for (const off of ['program_admission', 'compare_programs', 'find_clubs', 'set_priorities', 'set_plan_shape']) {
    expect(!names.includes(off), `no ${off} (Illinois data, or not yet checked on a UGA board)`);
  }
  const words = (t) => [t.description, ...Object.values(t.input_schema.properties ?? {}).map((p) => p.description ?? '')].join(' ');
  const illinoisy = uga.tools.filter((t) => /Illinois|Grainger|Gies|\bLAS\b|Transferology|Teachers Ranked as Excellent|Parkland/.test(words(t))).map((t) => t.name);
  expect(illinoisy.length === 0, 'no ARCH tool description or field names Illinois or its data', illinoisy.join(', '));
  const byName = new Map(A.ADVISOR_TOOLS.map((t) => [t.name, t]));
  const schemaOf = (t) => JSON.stringify(t.input_schema, (k, v) => (k === 'description' ? undefined : v));
  const drift = uga.tools.filter((t) => schemaOf(t) !== schemaOf(byName.get(t.name))).map((t) => t.name);
  expect(drift.length === 0, "every ARCH tool takes exactly ALMA's inputs (only wording differs)", drift.join(', '));
  const rec = uga.tools.find((t) => t.name === 'record_prior_credit');
  expect(/UGA course code/.test(rec.description) && /UGA course code/.test(rec.input_schema.properties.code.description), 'record_prior_credit asks for a UGA course code');
  const eq = uga.tools.find((t) => t.name === 'find_equivalent');
  expect(/Which UGA course/.test(eq.description) && /official/.test(eq.description) && /91/.test(eq.description), "find_equivalent reads UGA's own lists first");
  const rep = uga.tools.find((t) => t.name === 'replace_course');
  expect(!/usual way to act on an interest/.test(rep.description) && /asked for or said yes to/.test(rep.description), 'replace_course is for a swap the student asked for or agreed to');
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. UGA's term dates ===\n");
{
  // The weekday the Registrar's calendar prints beside each date (read 2026-10-14).
  const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const [fall, spring] = U.UGA_TERM_DATES;
  const printed = [
    [fall.classesBegin, '2026-08-17', 'Mon'], [fall.dropAddEnds, '2026-08-21', 'Fri'], [fall.withdrawalDeadline, '2026-11-11', 'Wed'], [fall.classesEnd, '2026-12-01', 'Tue'], [fall.finalsEnd, '2026-12-09', 'Wed'],
    [spring.classesBegin, '2027-01-11', 'Mon'], [spring.dropAddEnds, '2027-01-15', 'Fri'], [spring.withdrawalDeadline, '2027-04-07', 'Wed'], [spring.classesEnd, '2027-04-26', 'Mon'], [spring.finalsEnd, '2027-05-04', 'Tue'],
    [fall.nextRegistration.ticketedFrom, '2026-11-12', 'Thu'], [fall.nextRegistration.ticketedTo, '2026-11-20', 'Fri'], [fall.nextRegistration.openFrom, '2026-11-23', 'Mon'], [fall.nextRegistration.openTo, '2027-01-10', 'Sun'],
  ];
  const wrong = printed.filter(([got, want, wd]) => got !== want || day(got) !== wd).map(([got, want, wd]) => `${got} (want ${want}, ${wd})`);
  expect(fall.term === 'Fall 2026' && spring.term === 'Spring 2027' && wrong.length === 0, 'Fall 2026 and Spring 2027 dates as the calendar prints them, weekdays included', wrong.join('; '));
  expect(U.UGA_TERM_DATES.every((t) => t.sources.includes('https://reg.uga.edu/')), "every term names the Registrar's page");
  const uga = request(UGA);
  const ctx = contextOf(uga);
  expect(ctx.includes(U.ugaTermDatesBlock(NOW)) && !ctx.includes('Illinois term dates'), "ARCH gets UGA's dates and never Illinois's");
  expect(!uga.system[0].text.includes('Nov 11') && !uga.system[0].text.includes('UGA term dates ('), 'the dates ride with the step, not in the cached instructions');
  const oct = U.ugaTermDatesBlock(NOW);
  expect(oct.startsWith('UGA term dates (today is 2026-10-14;') && /Fall 2026 .*drop\/add ends Aug 21; Nov 11 is the withdrawal deadline/.test(oct) && /Spring 2027 ticketed registration runs Nov 12 to Nov 20/.test(oct) && /Spring 2027 full-term courses \(classes Jan 11 to Apr 26, finals end May 4\)/.test(oct), 'mid-October: Fall 2026 and Spring 2027, with the withdrawal deadline and registration');
  expect(/reg\.uga\.edu\/general-information\/calendars\/academic-calendars/.test(oct) && /reg\.uga\.edu\/calendars\/registration-dates/.test(oct), 'the block links the calendar and the registration-dates page');
  const dec = U.ugaTermDatesBlock(new Date('2026-12-10T17:00:00Z'));
  expect(dec.includes('Spring 2027 full-term') && !dec.includes('Fall 2026 full-term'), 'after Fall finals, Spring 2027 is the term');
  const late = U.ugaTermDatesBlock(new Date('2027-05-06T17:00:00Z'));
  expect(/No term dates are loaded/.test(late) && !/Apr 7/.test(late), 'past every loaded term: no stale dates, only "use university_answer"');
  expect(U.athensDay(new Date('2026-10-15T02:30:00Z')) === '2026-10-14', "today is Athens's day, not the server's");
  const marks = [];
  uga.system.forEach((b, i) => b.cache_control && marks.push(`system.${i}`));
  uga.messages.forEach((m, i) => typeof m.content !== 'string' && m.content.forEach((b, j) => b.cache_control && marks.push(`messages.${i}.${j}`)));
  const last = uga.messages[uga.messages.length - 1].content;
  expect(marks.length === 2 && !last[last.length - 1].cache_control && !last[last.length - 2].cache_control, 'the same two cache marks as ALMA; the dates and the board are after them');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. The tool handlers (planner screen source) ===\n');
{
  const src = readFileSync(join(HERE, '..', '..', 'components', 'planner', 'planner-workspace.tsx'), 'utf8');
  // Illinois's own text, as it was at 7ac1b7a: each still there, unchanged.
  const ILLINOIS_TEXT = [
    "`Illinois's ${t.label} class times are not published here, so whether these courses fit in one week is not checked.`",
    "'https://citl.illinois.edu/current-cutoff-scores (policies for students entering Summer 2026, Fall 2026 or Spring 2027)'",
    "'Illinois decides equivalency: Transferology is the estimate, the Transfer Evaluation Report the decision. Every transferable course counts at least as elective hours toward the total. Residency: 45 hours at Illinois, 21 at the 300 level or above (admissions.illinois.edu/transferring-credit/).'",
    "'These come from the catalog\\'s titles and a table of common equivalents, not from Illinois\\'s evaluation. Present the top one as likely, confirm with the student, then record it.'",
    "'Nothing in the catalog reads as the same course. It still transfers as elective hours if it is college-level; record it as hours.'",
    "(grainger ? 'students entering Grainger (this degree)' : 'students entering a college other than Grainger (this degree)')",
    "/^(illinois|uiuc|urbana)/i",
    "'Told to ALMA'",
  ];
  const gone = ILLINOIS_TEXT.filter((t) => !src.includes(t));
  expect(gone.length === 0, "Illinois's handler text is all still there, unchanged", gone.join(' | '));
  const UGA_BRANCHES = [
    ['term_summary names the right school', /if \(!isIllinois\) return \{ checked: false, line: null, why: `\$\{school\?\.short \?\? 'This university'\}'s class times are not loaded here/],
    ["compare_courses reads Illinois's course pages for Illinois only", /const detail = isIllinois \? await loadIllinoisCourseDetail\(c\.code\) : null;\n\s+const verdict = term && !holding/],
    ["exam_credit cites UGA's table for UGA", /: "https:\/\/reg\.uga\.edu\/student-records\/credit-from-testing/],
    ["exam_credit prices Grainger's calculus for Illinois only", /const grainger = isIllinois && \/engineering\/i/],
    ["prior_credit gives UGA's rule, not Illinois's residency rule", /: `UGA decides equivalency\. Its Transfer Equivalency Search/],
    ["find_equivalent reads UGA's own list for the school", /if \(!isIllinois && str\('school'\)\) \{\n\s+const table = await loadUgaTransfer\(\[str\('school'\)\]\)/],
    ["find_equivalent links UGA's list page under the reply", /officialSources = \[\{ n: 1, title: `UGA Transfer Equivalency: \$\{hit\.entry\.name\}`, url: hit\.file\.source/],
    ["record_prior_credit asks for the school's own course code", /Give \$\{isIllinois \? 'an Illinois' : `a \$\{school\?\.short/],
  ];
  for (const [what, re] of UGA_BRANCHES) expect(re.test(src), what);
  const ugaJson = JSON.parse(readFileSync(join(HERE, '..', '..', 'public', 'uga-exam-credit.json'), 'utf8'));
  expect(ugaJson.source === 'reg.uga.edu/student-records/credit-from-testing', "the UGA source exam_credit cites is the one UGA's table was read from");
  const index = JSON.parse(readFileSync(join(HERE, '..', '..', 'public', 'uga-transfer', 'index.json'), 'utf8'));
  expect(index.schools.length === 91, `the planner holds UGA's lists for ${index.schools.length} schools, as ARCH's tools say`);
}

console.log(`\n${failures === 0 ? 'ALL ARCH (UGA) ADVISOR CHECKS PASSED' : `${failures} ARCH (UGA) ADVISOR CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
