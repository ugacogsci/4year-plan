/**
 * ARCH (UGA) next to ALMA (Illinois), checked without calling the API.
 *
 * What this pins:
 *   1. ALMA is untouched: its instructions and its tool list are byte for
 *      byte what they were at 7ac1b7a, before ARCH shared ALMA's rules
 *      (sha256 below, taken from that commit), and building ARCH's tools
 *      does not change ALMA's. Changed on purpose once since (2026-10-18,
 *      instructor choice): one shared line, the syllabus answer layout, and
 *      the term_syllabi tool with one sentence added to course_syllabus's
 *      description. Taking exactly those out gives the old bytes back, and
 *      the new bytes are pinned too. Again on 2026-10-20 (summers by hand):
 *      the add_summer and remove_summer tools and one line about them;
 *      taking those out gives the 2026-10-18 bytes back. Again on 2026-10-21
 *      (ranked warnings): review_board's description says the flags come
 *      ranked; putting the old words back gives the 2026-10-20 bytes.
 *      2026-10-22 changed ARCH alone, twice. The plan-shape work:
 *      set_priorities and set_plan_shape join its tools in UGA's words,
 *      add_summer says a Rebuild fills a summer from the UGA Bulletin, and
 *      its instructions gain the plan-shape block, UGA's credit-load line
 *      and the summer-sessions line. UGA clubs and pre-health tracks:
 *      find_clubs joins its tools in UGA's words, its clubs line says the
 *      UGA list is partial, its board rule names career-track cards, and
 *      set_priorities names UGA's pre-health lists. ALMA's bytes are
 *      unchanged; ARCH's are pinned in 3 and 4. Taking out the clubs and
 *      tracks changes gives the plan-shape bytes back, then taking out the
 *      plan-shape changes gives ARCH's cd59ed3 bytes back. 2026-10-26
 *      (student ratings) changed both: the professor_ratings tool, last in
 *      both lists, and the shared professor-ratings rule; ALMA's
 *      teaching-ratings line names the official list first and Rate My
 *      Professors second, and ARCH's "not loaded" line points to the rule.
 *      Taking those out gives each one's earlier bytes back;
 *   2. the shared rules: every school-neutral rule is in both prompts, word
 *      for word, so the two cannot drift;
 *   3. ARCH's own instructions: no Illinois anywhere; ask before changing,
 *      change only what was asked, report exactly what the tools changed;
 *      UGA's own wellbeing contacts; what to say for what the planner holds
 *      for Illinois only;
 *   4. ARCH's tools: ALMA's, less the Illinois-only ones, in ALMA's order,
 *      with the same schemas and no Illinois in any description
 *      (set_priorities and set_plan_shape since 2026-10-22, in UGA's words:
 *      UGA's own 18-hour rule, summers from the UGA Bulletin, and the knobs
 *      UGA has no data for named as such);
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
// 2026-10-26: student ratings from Rate My Professors (professor-ratings.ts).
const RATINGS_RULE = `\n${A.SHARED_ADVISOR_RULES.professorRatings}`;
const withoutRatingsTool = (tools) => tools.filter((t) => t.name !== 'professor_ratings');

// ---------------------------------------------------------------------------
console.log('\n=== 1. ALMA is untouched ===\n');
{
  // Taken at 7ac1b7a, before the shared rules existed.
  const ALMA_SYSTEM_SHA = 'ae44ba37aedb4a7b9fb235e783b1b8869cc1265c034ca23818ad08eaaa11ec42';
  const ALMA_TOOLS_SHA = '1b2a45604b8b9675274c7604b1ebb7ad731513d87ce167770e9fc9f58b10d8f6';
  // 2026-10-18: the one shared line ALMA gained, and the one tool and sentence.
  const LAYOUT = A.SHARED_ADVISOR_RULES.syllabusLayout;
  const BY_INSTRUCTOR = ' The result also groups the syllabi by instructor (by_instructor, each instructor\'s newest first, with its term and link) and marks the instructor the student set for the course on the board (chosen).';
  const ALMA_SYSTEM_SHA_1018 = '7104e34d8f8ffc6b99d526a40b823644622cecc6b1d6ef16292a3ed84ae08351';
  const ALMA_TOOLS_SHA_1018 = '2e57838618d8cb2abe613895100faa12b0107d1fed5c21d6a9d39d5c5602626f';
  // 2026-10-20: the summer tools (add_summer, remove_summer) and ALMA's one line about them.
  const SUMMER_LINE = '- add_summer puts an empty summer on the board without rebuilding or moving anything (fill it with add_course or move_course); set_plan_shape summers rebuilds the whole board around its summers. remove_summer takes a summer off; one that holds classes only after you name them and the student says yes.';
  const SUMMER_TOOLS = new Set(['add_summer', 'remove_summer']);
  const ALMA_SYSTEM_SHA_1020 = 'd3fc5469c8558ae601e897b47a6c1ff082adf5911c59629a5041058d993912fe';
  const ALMA_TOOLS_SHA_1020 = '56f86a7d118e359d7b055d661fbdd0565cd3e1b454921eb473ec64354f3c40b5';
  // 2026-10-21: review_board's flags come ranked, as the board ranks them.
  const RANK_OLD = 'the review flags';
  const RANK_NEW = 'every review flag ranked as the board ranks it (what matters now first, then what is good to know; the board itself shows at most three and folds the rest)';
  const ALMA_TOOLS_SHA_1021 = 'd1f5131ce42cacd3d02547ad18a80e5826aec8928293d73aa571ab0e1ad5b2d0';
  const unrank = (tools) => tools.map((t) => (t.name === 'review_board' ? { ...t, description: t.description.replace(RANK_NEW, RANK_OLD) } : t));
  // 2026-10-26: the teaching-ratings line and the shared professor-ratings rule after it.
  const TRE_OLD = "- Teaching ratings come only from the university's own Teachers Ranked as Excellent lists, which course_details and search results carry. Never cite RateMyProfessors or any outside site, and never call an instructor good or bad on your own; say whether they are on the list, and for which terms. A name missing from the list is not a rating against it.";
  const TRE_NEW = "- The official teaching signal is the university's own Teachers Ranked as Excellent lists, which course_details and search results carry: say whether an instructor is on the list, and for which terms; a name missing from the list is not a rating against it. Student ratings from Rate My Professors (professor_ratings) are unofficial and come second: give the list first when both bear on a question, and never cite any other outside site or call an instructor good or bad on your own.";
  const ALMA_SYSTEM_SHA_1026 = '931b2ef1701b1c80dc8eb21e01452b3d085f8f694ddbe2645c3d4a18fb7e1456';
  const ALMA_TOOLS_SHA_1026 = '29934abae3ed74f230daf4bdf64a5bca703f5866bce135aadb31898e4912a73d';
  const ALMA_1020 = ALMA.replace(`${TRE_NEW}${RATINGS_RULE}`, TRE_OLD);
  expect(ALMA.split(`${TRE_NEW}${RATINGS_RULE}\n`).length === 2 && !ALMA.includes(TRE_OLD) && !/Never cite RateMyProfessors/.test(ALMA) && sha(ALMA_1020) === ALMA_SYSTEM_SHA_1020, "ALMA's instructions are byte for byte the 2026-10-20 ones, apart from the teaching-ratings line and the professor-ratings rule after it (2026-10-26)", `${sha(ALMA_1020)} (${ALMA_1020.length})`);
  expect(sha(ALMA) === ALMA_SYSTEM_SHA_1026, "ALMA's instructions with the student-ratings rules are pinned", `${sha(ALMA)} (${ALMA.length})`);
  const ALMA_1018 = ALMA_1020.split(`\n${SUMMER_LINE}`);
  expect(ALMA_1018.length === 2 && sha(ALMA_1018.join('')) === ALMA_SYSTEM_SHA_1018 && ALMA_1018.join('').length === 26672, "ALMA's instructions are byte for byte the 2026-10-18 ones, apart from the one summer line", `${sha(ALMA_1018.join(''))} (${ALMA_1018.join('').length})`);
  const before = ALMA_1018.join('').split(`\n${LAYOUT}`);
  expect(before.length === 2 && sha(before.join('')) === ALMA_SYSTEM_SHA && before.join('').length === 25366, "ALMA's instructions are byte for byte the same as before, apart from the one shared syllabus-layout line", `${sha(before.join(''))} (${before.join('').length})`);
  expect(sha(ALMA_1020) === ALMA_SYSTEM_SHA_1020 && ALMA_1020.length === 26672 + 1 + SUMMER_LINE.length, "ALMA's 2026-10-20 instructions with both lines are pinned too", `${sha(ALMA_1020)} (${ALMA_1020.length})`);
  const tools1018 = (tools) => unrank(tools).filter((t) => !SUMMER_TOOLS.has(t.name));
  const toolsBefore = (tools) => tools1018(tools).filter((t) => t.name !== 'term_syllabi').map((t) => (t.name === 'course_syllabus' ? { ...t, description: t.description.replace(BY_INSTRUCTOR, '') } : t));
  const ill = request(ILL);
  const illTools = withoutRatingsTool(ill.tools);
  expect(ill.tools.length === 28 && ill.tools[27].name === 'professor_ratings' && illTools.length === 27, 'professor_ratings is the one tool added on 2026-10-26, last', ill.tools.map((t) => t.name).join(', '));
  expect(sha(JSON.stringify(ill.tools)) === ALMA_TOOLS_SHA_1026, "ALMA's 28 tools are pinned", sha(JSON.stringify(ill.tools)));
  expect(ill.tools.filter((t) => t.description.includes(RANK_NEW)).map((t) => t.name).join() === 'review_board', "review_board is the one tool whose words changed on 2026-10-21, to say the flags come ranked");
  expect(sha(JSON.stringify(toolsBefore(illTools))) === ALMA_TOOLS_SHA, "ALMA's 24 earlier tools are byte for byte the same as before, apart from course_syllabus's one added sentence");
  expect(tools1018(illTools).length === 25 && ill.tools[3].name === 'term_syllabi' && ill.tools[2].description.endsWith(BY_INSTRUCTOR), 'term_syllabi is the one tool added on 2026-10-18, after course_syllabus', ill.tools.map((t) => t.name).join(', '));
  expect(sha(JSON.stringify(tools1018(illTools))) === ALMA_TOOLS_SHA_1018, "ALMA's 25 tools of 2026-10-18 are byte for byte the same", sha(JSON.stringify(tools1018(illTools))));
  const moveAt = ill.tools.findIndex((t) => t.name === 'move_course');
  expect(illTools.length === 27 && ill.tools[moveAt + 1].name === 'add_summer' && ill.tools[moveAt + 2].name === 'remove_summer', 'add_summer and remove_summer are the two new tools, after move_course', ill.tools.map((t) => t.name).join(', '));
  expect(sha(JSON.stringify(unrank(illTools))) === ALMA_TOOLS_SHA_1020, "ALMA's 27 tools of 2026-10-20 are byte for byte the same, apart from review_board's ranked words", sha(JSON.stringify(unrank(illTools))));
  expect(sha(JSON.stringify(illTools)) === ALMA_TOOLS_SHA_1021, "ALMA's 27 tools of 2026-10-21 are byte for byte the same, apart from professor_ratings", sha(JSON.stringify(illTools)));
  A.ugaAdvisorTools();
  expect(sha(JSON.stringify(A.ADVISOR_TOOLS)) === ALMA_TOOLS_SHA_1026 && sha(JSON.stringify(request(ILL).tools)) === ALMA_TOOLS_SHA_1026, "building ARCH's tools leaves ALMA's list as it was");
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
    ['syllabi', /come only from course_syllabus/],
    ['class times', /Class times, sections and the weekly clash check: not loaded for UGA/],
    ['grade history and ratings', /Grade history and teaching ratings: none are loaded for UGA/],
    ['admission, second majors, minors', /second major, minors and certificates: the planner does not check these for UGA/],
    ['summer sessions or sections (it knows which classes the Bulletin lists for summer; 2026-10-22)', /Summer sessions and sections: the planner knows which classes the UGA Bulletin lists for summer, not which summer session or section runs one/],
  ]) expect(re.test(ARCH), `says plainly the planner has no UGA ${what}`);
  // 2026-10-22: ARCH reshapes the plan like ALMA, on UGA's own rule.
  expect(!/cannot change these from the chat/.test(ARCH) && /set_plan_shape changes credits per term, the finish, terms away and summers, and rebuilds the board; set_priorities changes what the planner's own picks optimise for/.test(ARCH), 'ARCH can change the load, the finish, terms away, summers and its priorities from the chat');
  expect(/Both change the board, so the rules above apply: use them for a change the student asked for or said yes to/.test(ARCH), 'and asks first for those, as for every other change');
  expect(/UGA's Registrar lets an undergraduate register for at most 18 hours in a fall, spring or summer term; more needs a higher credit limit, approved by the student's academic advisor/.test(ARCH) && /Full time is 12 hours in a fall or spring term/.test(ARCH), "it states UGA's own course-load rule: 18 a term, more with the advisor's approval, 12 full time");
  expect(/The planner keeps a summer to 9 credits by its own choice: never call 9 a UGA limit/.test(ARCH) && !/9 in summer/.test(ARCH), 'it never calls the 9-credit summer a UGA rule');
  expect(/The planner fills a summer only with classes the UGA Bulletin lists for summer/.test(ARCH) && /never say a class runs in a summer the Bulletin does not list it for/.test(ARCH), 'it fills summers from the Bulletin and never claims a summer the Bulletin does not list');
  expect(/a wish for easier classes, better professors or a time of day chooses nothing: say so/.test(ARCH), 'it says the priorities UGA has no data for choose nothing');
  expect(ARCH.length > 9000 && ARCH.length < ALMA.length, `ARCH's prompt is ${ARCH.length} characters (ALMA's ${ALMA.length})`);
  // 2026-10-22: UGA's clubs (find_clubs over public/uga/clubs.json) and pre-health tracks (uga-career-tracks.ts).
  const CLUBS_OLD = "  '- Clubs: the planner has no UGA student-organization list. Say so, and use university_answer for how to find organizations at UGA; never name a club from memory.',".slice(3, -2);
  const CLUBS_NEW = "- Clubs: find_clubs reads a partial UGA list, the clubs official UGA pages name; UGA's own directory, the Involvement Network, is not read. Call it for any question about which clubs to join, name at most 4 of the clubs it returns by their exact names, say once that the list is partial and give its source.url for the rest, and use university_answer for how to join or start an organization. Never name a club from memory, and never give officer names or emails.";
  const BOARD_OLD = '- Every card on the board is marked required, from a list, elective slot, language, gen ed pick, prerequisite, or added (the board description gives the legend). Prefer changing elective slots and gen ed picks (a gen ed pick is swapped for another course carrying the same categories). Never remove or replace a required or from-a-list course unless';
  const BOARD_NEW = "- Every card on the board is marked required, from a list, elective slot, career track, language, gen ed pick, prerequisite, or added (the board description gives the legend). Prefer changing elective slots and gen ed picks (a gen ed pick is swapped for another course carrying the same categories). A career-track card is a course the student's named goal asks for (CHEM 1211 for medical school, from UGA's Pre-Professional Advising Office); keep it unless they drop the goal. Never remove or replace a required, from-a-list or career-track course unless";
  expect(ARCH.includes(CLUBS_NEW) && !ARCH.includes(CLUBS_OLD), 'says the UGA club list is partial: find_clubs, at most 4 clubs it returns, source.url for the rest (2026-10-22)');
  expect(ARCH.includes(BOARD_NEW), "keeps a career-track card unless the student drops the goal, and removes one only on a yes (2026-10-22)");
  // 2026-10-22 too, from the plan-shape work: the "Plan shape, priorities and summers" block, UGA's
  // credit-load line, and the summer-sessions line in place of the two "cannot change / not loaded" lines.
  const SUMMER_NOW = '- Summer sessions and sections: the planner knows which classes the UGA Bulletin lists for summer, not which summer session or section runs one, or when. For summer sessions and their dates use university_answer.';
  const SHAPE_OLD = `- Credits per term, the finish date and terms away: you cannot change these from the chat for UGA yet. Credits per term are set in Preferences ("Credits you want each term, about") and then Rebuild, which replaces the student's own edits to the board; for the rest, say plainly that it cannot be set from here yet.\n- Summers: add_summer puts an empty summer column on the board when the student asks for one, and remove_summer takes one off (one that holds classes only after you name them and the student says yes). UGA's summer course list is not loaded, so you cannot tell which UGA classes run in summer: say so, never say a class runs in summer, and let the student choose; add or move only the classes they name. Nothing here rebuilds the board around summers.`;
  const ARCH_SHA_CD59 = '506a722ab3cd1a5e46788ce9c85a586e6638d794b9b27d2c0f471b6e289bc8d9';
  const ARCH_SHA_SHAPE = '8dc5cebc6a9a615ec72dfa42071a9d2f09a96ded6242d255ffe8b0834b504003';
  const ARCH_SHA_1022 = '5d1d5b55e1c693e3e1f81f9576bf887f49926c1f9c8259ac8508c25a30d8ba09';
  const ARCH_SHA_GRAD = '77ecec90b16b74f731f7a3d2ec0ca3802e23fb7a2ce07a3f3bc5f4bba706d31d';
  // 2026-10-22, later: a graduate student's load (the UGA Graduate School's), after the undergraduate line.
  const GRAD_LOAD = "\n- A graduate plan (the board description says Plan level: graduate) follows the UGA Graduate School instead: full time is 9 hours in a fall or spring term and 6 in summer, 18 hours is the most any student may take in a semester, and a student holding an assistantship registers for at least 12 hours of graduate credit in a fall or spring term. Never give a graduate student the undergraduate 12-hour rule; set_plan_shape returns the Graduate School's.";
  expect(ARCH.includes(GRAD_LOAD), "a graduate plan gets the UGA Graduate School's load: 9 full time, 18 at most, 12 with an assistantship (2026-10-22)");
  // 2026-10-26: the shared professor-ratings rule after the tool-fails rule, and the "not loaded" line's last sentence.
  const UGA_RATINGS_OLD = 'Never cite RateMyProfessors or any outside site, and never call an instructor good or bad.';
  const UGA_RATINGS_NEW = 'Student ratings of professors from Rate My Professors (professor_ratings) describe a professor across all their courses, not a course or a term: use them only as the professor-ratings rule says, never cite any other outside site, and never call an instructor good or bad on your own.';
  const ARCH_SHA_1026 = '68cb63fedc1dfcbba87121b0c41bcd08c9e3529383ae9373c3f6987308330de9';
  const ARCH_GRAD = ARCH.replace(`${A.SHARED_ADVISOR_RULES.boardToolFails}${RATINGS_RULE}`, A.SHARED_ADVISOR_RULES.boardToolFails).replace(UGA_RATINGS_NEW, UGA_RATINGS_OLD);
  expect(ARCH.split(RATINGS_RULE).length === 2 && ARCH.includes(UGA_RATINGS_NEW) && !/RateMyProfessors/.test(ARCH) && sha(ARCH_GRAD) === ARCH_SHA_GRAD, "taking out the professor-ratings rule and the ratings sentence gives the instructions before them back, byte for byte (2026-10-26)", `${sha(ARCH_GRAD)} (${ARCH_GRAD.length})`);
  expect(sha(ARCH) === ARCH_SHA_1026, "ARCH's instructions with the student-ratings rules are pinned", `${sha(ARCH)} (${ARCH.length})`);
  const ARCH_1022 = ARCH_GRAD.replace(GRAD_LOAD, '');
  expect(sha(ARCH_1022) === ARCH_SHA_1022 && ARCH_1022.length === 15993, "taking out the graduate load line gives the instructions before it back, byte for byte", `${sha(ARCH_1022)} (${ARCH_1022.length})`);
  const shapeEra = ARCH_1022.replace(CLUBS_NEW, CLUBS_OLD).replace(BOARD_NEW, BOARD_OLD);
  expect(sha(shapeEra) === ARCH_SHA_SHAPE && shapeEra.length === 15485, "taking out the clubs line and the career-track words gives the plan-shape instructions back, byte for byte", `${sha(shapeEra)} (${shapeEra.length})`);
  const shapeAt = shapeEra.indexOf('Plan shape, priorities and summers\n');
  const SHAPE_BLOCK = shapeAt < 0 ? '' : shapeEra.slice(shapeAt, shapeEra.indexOf('\n\n', shapeAt) + 2);
  const LOAD_LINE = (shapeEra.match(/\n- Credit load: UGA's Registrar[^\n]*/) ?? [''])[0];
  const unwrapped = shapeEra.replace(SHAPE_BLOCK, '').replace(LOAD_LINE, '').replace(SUMMER_NOW, SHAPE_OLD);
  expect(SHAPE_BLOCK.split('\n- ').length === 4 && LOAD_LINE !== '' && sha(unwrapped) === ARCH_SHA_CD59 && unwrapped.length === 14281, "and taking out the plan-shape block, the credit-load line and the summer-sessions line gives ARCH's cd59ed3 instructions back, byte for byte", `${sha(unwrapped)} (${unwrapped.length})`);
  expect(sha(ARCH_GRAD) === ARCH_SHA_GRAD && ARCH_GRAD.length === 15993 + GRAD_LOAD.length, "ARCH's instructions before the student ratings, with all of them, are pinned", `${sha(ARCH_GRAD)} (${ARCH_GRAD.length})`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. ARCH's tools ===\n");
{
  const uga = request(UGA);
  const names = uga.tools.map((t) => t.name);
  const WANT = ['search_courses', 'course_details', 'course_syllabus', 'term_syllabi', 'term_summary', 'add_course', 'remove_course', 'replace_course', 'move_course', 'add_summer', 'remove_summer', 'compare_courses', 'explain_choice', 'what_if', 'review_board', 'set_priorities', 'set_plan_shape', 'exam_credit', 'prior_credit', 'find_equivalent', 'record_prior_credit', 'drop_prior_credit', 'planner_answer', 'university_answer', 'find_clubs', 'professor_ratings'];
  expect(JSON.stringify(names) === JSON.stringify(WANT), `ARCH has ${names.length} tools, in ALMA's order (set_priorities, set_plan_shape and find_clubs since 2026-10-22, professor_ratings since 2026-10-26)`, names.join(', '));
  const fc = uga.tools.find((t) => t.name === 'find_clubs');
  expect(/partial UGA list/.test(fc.description) && /UGA's own directory is not read/.test(fc.description), "find_clubs is described as UGA's partial list, in UGA's words");
  // Unwrapped as they came: find_clubs and set_priorities' career-track words (the pre-health lists), then
  // set_priorities and set_plan_shape and add_summer's Bulletin words (the plan-shape work), gives cd59ed3's.
  const TRACK_WORDS = [
    ["(their interests and career words, read for interest topics; no career-track course lists are loaded for UGA) and covering more requirements at once.", "(their interests and career words, read for interest topics and, for a pre-health goal, UGA's own career-track course lists from the Pre-Professional Advising Office, the College of Pharmacy's for pre-pharmacy) and covering more requirements at once."],
    ['leaves required and student-added courses alone', 'leaves required, career-track and student-added courses alone'],
  ];
  const TRACK_INTERESTS = ['the interest topics it reads from them; the result says what it recognised and which topics are now active.', "the interest topics it reads from them, and books a pre-health goal's career-track courses; the result says what it recognised and which tracks and topics are now active."];
  const ADD_SUMMER_CD59 = "Put an empty summer column on the board between its first and last terms (\"Summer 2027\"), the same as the board's Add a summer button. Nothing is rebuilt, moved or removed, and the summer stays through Rebuild and reload. The planner never fills it: UGA's summer course list is not loaded, so it cannot tell which classes run in summer. Use it only when the student asks for a summer or says yes to one; then add or move only the classes the student names. The result lists the board's terms afterwards and a warning to pass on.";
  // 2026-10-22, later: set_plan_shape's min_credits names a graduate student's full time too.
  const MIN_WORDS = ["The fewest credits a fall or spring term may hold (12 is full time at UGA). Under 12 is part-time", 'The fewest credits a fall or spring term may hold (12 is full time for a UGA undergraduate, 9 for a graduate student). Under full time is part-time'];
  const ratingsTool = uga.tools.find((t) => t.name === 'professor_ratings');
  expect(JSON.stringify(ratingsTool) === JSON.stringify(A.ADVISOR_TOOLS.find((t) => t.name === 'professor_ratings')), "professor_ratings is ALMA's, byte for byte: its words name no school (2026-10-26)");
  expect(sha(JSON.stringify(uga.tools)) === 'ead5e074d7538b1ba87777ab4647f31a650e95f542fef605adecb31f21f946bb', "ARCH's 26 tools are pinned", sha(JSON.stringify(uga.tools)));
  const toolsBeforeGrad = withoutRatingsTool(uga.tools).map((t) => (t.name !== 'set_plan_shape' ? t : { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, min_credits: { ...t.input_schema.properties.min_credits, description: t.input_schema.properties.min_credits.description.replace(MIN_WORDS[1], MIN_WORDS[0]) } } } }));
  expect(sha(JSON.stringify(toolsBeforeGrad)) === '229a59cb4bed4502ddcf78615386a4ad243cd2587f283e28674584de72eabe6e', "without min_credits' graduate words, ARCH's tools are byte for byte the ones before them", sha(JSON.stringify(toolsBeforeGrad)));
  const shapeTools = toolsBeforeGrad.filter((t) => t.name !== 'find_clubs').map((t) => (t.name !== 'set_priorities' ? t : {
    ...t,
    description: TRACK_WORDS.reduce((d, [was, now]) => d.replace(now, was), t.description),
    input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, interests: { ...t.input_schema.properties.interests, description: t.input_schema.properties.interests.description.replace(TRACK_INTERESTS[1], TRACK_INTERESTS[0]) } } },
  }));
  expect(sha(JSON.stringify(shapeTools)) === 'c1f67877463e1db670a448a4e25082f04d2a42ad829d10a69964526ef62237b4', "without find_clubs and set_priorities' career-track words, ARCH's tools are byte for byte the plan-shape ones", sha(JSON.stringify(shapeTools)));
  const cd59Tools = shapeTools.filter((t) => t.name !== 'set_priorities' && t.name !== 'set_plan_shape').map((t) => (t.name === 'add_summer' ? { ...t, description: ADD_SUMMER_CD59 } : t));
  expect(sha(JSON.stringify(cd59Tools)) === '7dbf5f669537df21b5ce59c86c7f79c54dc0d09aa730b847eb8f66c47e76bf5e', "and without set_priorities, set_plan_shape and add_summer's Bulletin words, byte for byte cd59ed3's", sha(JSON.stringify(cd59Tools)));
  expect(sha(JSON.stringify(withoutRatingsTool(uga.tools))) === 'c605fff08f0b9898be812109d569916a50e45718fb2773d2107eadd9200bc2fa', "without professor_ratings, ARCH's 25 tools of 2026-10-22 are byte for byte the same", sha(JSON.stringify(withoutRatingsTool(uga.tools))));
  for (const off of ['program_admission', 'compare_programs']) {
    expect(!names.includes(off), `no ${off} (Illinois data)`);
  }
  const shape = uga.tools.find((t) => t.name === 'set_plan_shape');
  expect(/only classes the UGA Bulletin lists for summer, in the years it lists them, and at most 9 credits a summer, its own ceiling under UGA's 18-hour term limit/.test(shape.description) && /Above 18 is never planned: the result gives UGA's rule instead/.test(shape.description), "set_plan_shape (since 2026-10-22): summers from the UGA Bulletin, 9 credits as the planner's own ceiling, UGA's rule above 18");
  expect(/12 is full time for a UGA undergraduate, 9 for a graduate student/.test(shape.input_schema.properties.min_credits.description) && /at most 18\)/.test(shape.input_schema.properties.away.description) && /no UGA course is in the hardest band/.test(shape.input_schema.properties.spread_hard.description), "set_plan_shape's fields in UGA's words");
  const priorities = uga.tools.find((t) => t.name === 'set_priorities');
  expect(/Workload \(grade history\), teaching ratings and schedule fit \(class times, days, online or in person\) are not loaded for UGA, so setting them saves the preference and chooses nothing/.test(priorities.description) && /A Double Dawgs board is not re-picked/.test(priorities.description), 'set_priorities (since 2026-10-22) says which knobs UGA has no data for, and that a Double Dawgs board waits for Rebuild');
  expect(/for a pre-health goal, UGA's own career-track course lists from the Pre-Professional Advising Office/.test(priorities.description) && /leaves required, career-track and student-added courses alone/.test(priorities.description) && !/no career-track course lists/.test(priorities.description), "set_priorities names UGA's own pre-health lists and leaves their courses alone (2026-10-22)");
  expect(/use it only for a change the student asked for or said yes to/i.test(priorities.description) && /use it only for a change the student asked for or said yes to/i.test(shape.description), 'both say to use them only on a request or a yes');
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
    ["set_plan_shape answers above 18 and under 12 with UGA's own rule (2026-10-22), the Graduate School's on a graduate plan", /\$\{isUga \? \(ugaGraduate \? ugaGraduateOverloadAnswer\(overload\) : ugaOverloadAnswer\(overload\)\) : overloadAnswer\(college, overload\)\}/],
    ['set_plan_shape: the under-12 note is UGA\'s too, and under 9 the graduate one on a graduate plan', /underload: isUga \? \(ugaGraduate \? ugaGraduateUnderloadNote\(underload\) : ugaUnderloadNote\(underload\)\) : underloadNote\(college, underload\)/],
    ['set_plan_shape: a UGA graduate plan is under full time below 9, not 12', /const ugaGraduate = isUga && isGraduatePlan;\n\s+const fullTime = ugaGraduate \? UGA_GRADUATE_FULL_TIME_HOURS : 12;[\s\S]{0,400}if \(n < fullTime\) underload/],
    ['the board description says a UGA plan is a graduate one', /if \(isUga && isGraduatePlan\) lines\.push\('Plan level: graduate\./],
    ["set_priorities hands ARCH UGA's own career tracks, never Illinois's, and no application programs", /const own = isGraduatePlan \? \{ \.\.\.read, tracks: \[\] \} : forSchool\(read, 'uga'\);\n\s+return \{ \.\.\.own, apply: \[\], heard: /],
    ['set_priorities names the assistant, not ALMA, on the board', /notify\(\s*`\$\{botName\} re-picked/],
    ["course_details gives ARCH the Bulletin's offering line", /\.\.\.\(isUga \? \{ offered_per_uga_bulletin: ugaOfferingLine\(c\) \} : \{\}\)/],
  ];
  for (const [what, re] of UGA_BRANCHES) expect(re.test(src), what);
  const ugaJson = JSON.parse(readFileSync(join(HERE, '..', '..', 'public', 'uga-exam-credit.json'), 'utf8'));
  expect(ugaJson.source === 'reg.uga.edu/student-records/credit-from-testing', "the UGA source exam_credit cites is the one UGA's table was read from");
  const index = JSON.parse(readFileSync(join(HERE, '..', '..', 'public', 'uga-transfer', 'index.json'), 'utf8'));
  expect(index.schools.length === 91, `the planner holds UGA's lists for ${index.schools.length} schools, as ARCH's tools say`);
}

console.log(`\n${failures === 0 ? 'ALL ARCH (UGA) ADVISOR CHECKS PASSED' : `${failures} ARCH (UGA) ADVISOR CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
