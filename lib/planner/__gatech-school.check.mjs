/**
 * Georgia Tech as a third school (school id 'gatech', assistant TOWER), checked
 * without the API, a browser or public/gatech/: the shared types, libraries,
 * AI routes and TOWER's prompt and tools (work package 1 of the Georgia Tech
 * plan, 2026-11-09).
 *
 * What this pins:
 *   1. which engine each school runs on (school-config.ts);
 *   2. the roster: Georgia Tech is in SCHOOLS with its own name, assistant,
 *      colors, audit and schedule names, and its own AP and IB table, but is
 *      not offered (READY_SCHOOL_IDS) until the main session flips it;
 *   3. transcripts: a Georgia Tech record is Georgia Tech's own, another
 *      school's (University of Georgia, South Georgia Technical College) is
 *      not; another school's lines get Georgia Tech's transfer rule (C or
 *      better) and no Illinois or UGA wording; upper-level hours count 3000
 *      and 4000;
 *   4. TOWER: the Georgia Tech name gets its own prompt, never ARCH's or
 *      ALMA's; it names no Illinois or UGA fact; it has the shared rules;
 *      its tools leave out what Georgia Tech has no data for; no dates block
 *      is attached, since the planner holds no Georgia Tech calendar;
 *   5. what is saved and counted: insights and account snapshots keep
 *      'gatech';
 *   6. the loaders that have no Georgia Tech file ask for none (ratings,
 *      teaching readings), and the university lookup searches gatech.edu.
 *
 * ALMA's and ARCH's bytes are pinned by __advisor-request-uga.check.mjs and
 * __advisor-request.check.mjs; this file only adds Georgia Tech.
 *
 *   node --experimental-strip-types lib/planner/__gatech-school.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }`));

// Any fetch here is a bug: a school with no file must not ask for one.
const fetched = [];
globalThis.fetch = async (url) => { fetched.push(String(url)); throw new Error(`unexpected fetch ${url}`); };

const C = await import(join(HERE, 'school-config.ts'));
const O = await import(join(HERE, 'onboarding.ts'));
const T = await import(join(HERE, 'transcript.ts'));
const A = await import(join(HERE, 'advisor.ts'));
const R = await import(join(HERE, 'advisor-request.ts'));
const L = await import(join(HERE, 'university-lookup.ts'));
const P = await import(join(HERE, 'professor-ratings.ts'));
const CT = await import(join(HERE, 'course-teaching.ts'));
const M = await import(join(HERE, 'transfer-match.ts'));
const I = await import(join(ROOT, 'lib', 'insights', 'schema.ts'));
const S = await import(join(ROOT, 'lib', 'accounts', 'snapshot.ts'));

let failed = 0;
const expect = (ok, name, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok   ' : '  FAIL '} ${name}${!ok && detail ? `\n         ${detail}` : ''}`);
};
/** Names TOWER must never carry: another school's, its colleges, offices and systems. */
const FOREIGN = /Illinois|\bUGA\b|University of Georgia|Grainger|Gies|Parkland|\bLAS\b|Athena|Transferology|Urbana|Champaign|uAchieve|Bulletin|Double Dawgs/;

console.log('\n=== 1. Engines ===\n');
{
  expect(C.engineOf('uga') === 'uga' && C.engineOf('illinois') === 'courseleaf' && C.engineOf('gatech') === 'courseleaf' && C.engineOf('elsewhere') === null && C.engineOf(null) === null, "UGA keeps its own engine; Illinois and Georgia Tech run on the CourseLeaf engine");
  const gt = C.courseleafOf('gatech');
  expect(gt?.id === 'gatech' && gt.base === '/gatech' && gt.numberDigits === 4 && gt.letterSuffix === true && gt.graduateFrom === 6000, "Georgia Tech's data lives under /gatech, with 4-digit numbers and letter suffixes");
  expect(['campusGenEd', 'languageRule', 'collegeRules', 'minors', 'graduate', 'clubs', 'syllabi', 'ratings', 'transferAi', 'transferGenEdGuide'].every((k) => gt[k] === false), 'none of the Illinois-only features is on for Georgia Tech');
  expect(C.courseleafOf('uga') === null && C.courseleafOf('illinois')?.base === '/illinois' && C.isCourseleaf('gatech') && !C.isCourseleaf('uga'), 'courseleafOf and isCourseleaf');
}

console.log('\n=== 2. The roster ===\n');
{
  const gt = O.schoolById('gatech');
  expect(gt?.name === 'Georgia Institute of Technology' && gt.short === 'Georgia Tech' && gt.bot === 'TOWER' && gt.people === 'Yellow Jackets' && gt.town === 'Atlanta', 'Georgia Tech is in SCHOOLS: Georgia Institute of Technology, Georgia Tech, TOWER, Yellow Jackets, Atlanta');
  expect(gt?.accent === '#857437' && gt.portal === 'OSCAR and DegreeWorks' && gt.auditName === 'DegreeWorks audit' && gt.scheduleFrom === 'OSCAR' && gt.catalog === null, "its accent (Tech Dark Gold), portal, audit and schedule names; no flat catalog file");
  expect(gt?.logo === null && gt.toggleLogo === null, 'no Georgia Tech logo is copied in: a text badge shows (the owner decides on the trademark)');
  expect(O.SCHOOLS.every((s) => 'logo' in s && 'toggleLogo' in s && typeof s.auditName === 'string' && typeof s.scheduleFrom === 'string'), 'every school carries logo, toggleLogo, auditName and scheduleFrom');
  const uga = O.schoolById('uga');
  const ill = O.schoolById('illinois');
  expect(uga?.logo === '/uga-school-logo.png' && uga.toggleLogo === '/uga-toggle-logo.png' && uga.auditName === 'DegreeWorks audit' && uga.scheduleFrom === 'Athena', "UGA's logos, audit and schedule names are the ones the screens used");
  expect(ill?.logo === '/illinois-school-logo.png' && ill.toggleLogo === '/illinois-toggle-logo.png' && ill.auditName === 'uAchieve degree audit' && ill.scheduleFrom === 'Student Self-Service' && ill.examCredit === '/illinois-exam-credit.json', "Illinois's logos, audit and schedule names, and the exam table exam-credit.ts used to name itself");
  expect(O.READY_SCHOOL_IDS.has('gatech') && O.READY_SCHOOL_IDS.has('uga') && O.READY_SCHOOL_IDS.has('illinois') && O.isReadySchool('gatech'), 'Georgia Tech is offered alongside UGA and Illinois');
  const file = join(ROOT, 'public', gt?.examCredit?.replace(/^\//, '') ?? 'missing');
  const table = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const shaped = table && Array.isArray(table.entries) && table.entries.length > 0 && table.entries.every((e) => typeof e.kind === 'string' && typeof e.exam === 'string' && Array.isArray(e.courses) && Array.isArray(e.exemptOnly) && typeof e.credits === 'number' && typeof e.noCredit === 'boolean')
    && typeof table.source === 'string' && /gatech\.edu/.test(table.source);
  expect(gt?.examCredit === '/gatech-exam-credit.json' && shaped, "Georgia Tech's AP and IB table is in the shape exam-credit.ts reads, from gatech.edu", file);
  const bc = table?.entries.find((e) => e.kind === 'AP' && /Calculus BC/.test(e.exam) && String(e.score) === '5');
  expect(Boolean(bc) && O.examRows({ kind: 'AP', exam: bc.exam, level: null, score: 5 }, table.entries).some((r) => r.courses.includes('MATH 1551')), 'a 5 on AP Calculus BC prices as MATH 1551 through the shared exam reader');
}

console.log('\n=== 3. Transcripts ===\n');
{
  expect(T.isHomeTranscript('Georgia Institute of Technology', 'gatech') && T.isHomeTranscript('Georgia Tech', 'gatech') && T.isHomeTranscript('GEORGIA INSTITUTE OF TECHNOLOGY - Atlanta', 'gatech'), 'a Georgia Tech record is Georgia Tech\'s own');
  expect(!T.isHomeTranscript('University of Georgia', 'gatech') && !T.isHomeTranscript('South Georgia Technical College', 'gatech') && !T.isHomeTranscript('Georgia State University', 'gatech'), "UGA's, South Georgia Technical College's and Georgia State's are not");
  expect(T.isHomeTranscript('University of Illinois Urbana-Champaign') && !T.isHomeTranscript('Georgia Institute of Technology') && T.isHomeTranscript('University of Georgia', 'uga') && !T.isHomeTranscript('Georgia Institute of Technology', 'uga'), 'Illinois and UGA read their own records as before, and Georgia Tech as another school');
  expect(T.recordIsForOtherSchool({ schoolId: 'illinois', courses: [] }, 'gatech') && T.recordIsForOtherSchool({ schoolId: 'gatech', courses: [] }, 'uga') && !T.recordIsForOtherSchool({ schoolId: 'gatech', courses: [] }, 'gatech'), 'a record matched for another school is matched again for Georgia Tech, and back');

  const catalog = [
    { code: 'CS 1331', title: 'Introduction to Object Oriented Programming', credits: 3, level: 100, cluster: 'CS', tags: [] },
    { code: 'MATH 1551', title: 'Differential Calculus', credits: 2, level: 100, cluster: 'MATH', tags: [] },
    { code: 'ENGL 1101', title: 'English Composition I', credits: 3, level: 100, cluster: 'ENGL', tags: [] },
    { code: 'PSYC 1101', title: 'General Psychology', credits: 3, level: 100, cluster: 'PSYC', tags: [] },
    { code: 'CS 3510', title: 'Design and Analysis of Algorithms', credits: 3, level: 300, cluster: 'CS', tags: [] },
  ];
  const line = (code, title, credits, extra = {}) => ({ code, title, credits, grade: 'A', term: 'Fall 2025', status: 'completed', ...extra });
  const doc = (institution, courses) => ({ institution, kind: 'transcript', courses, exams: [], notes: [] });
  const home = T.matchTranscript(doc('Georgia Institute of Technology', [line('CS 1331', 'Intro Object Oriented Prog', 3), line('CS 3510', 'Algorithms', 3)]), 'gt.pdf', catalog, ['gt.pdf'], null, 'gatech');
  expect(home.schoolId === 'gatech' && home.home === true && home.courses.every((c) => c.matched === c.code && c.matchedBy === 'code' && c.use), 'Georgia Tech\'s own record counts each line as its course');
  expect(JSON.stringify(T.transcriptResidentHours(home)) === JSON.stringify({ total: 6, upper: 3 }), 'residence hours: 6, of them 3 at the 3000 level or above (CS 3510)', JSON.stringify(T.transcriptResidentHours(home)));

  const gsu = T.matchTranscript(doc('Georgia State University', [
    line('ENGL 1101', 'English Composition I', 3),
    line('PSYC 1101', 'Introduction to General Psychology', 3, { grade: 'D' }),
    line('MATH 0997', 'Support for College Algebra', 2),
    line('HIST 2110', 'Survey of United States History', 3),
  ]), 'gsu.pdf', catalog, ['gsu.pdf'], null, 'gatech');
  const by = Object.fromEntries(gsu.courses.map((c) => [c.code, c]));
  expect(by['PSYC 1101'] && !by['PSYC 1101'].use && by['PSYC 1101'].counts === 'none' && /C or better/.test(by['PSYC 1101'].basis?.text ?? '') && /catalog\.gatech\.edu/.test(by['PSYC 1101'].basis?.source ?? ''), "a D from another school earns nothing at Georgia Tech, which grants transfer credit for a C or better (its transfer-credit page)", JSON.stringify(by['PSYC 1101']?.basis));
  expect(by['MATH 0997'] && !by['MATH 0997'].use && /does not transfer to Georgia Tech/.test(by['MATH 0997'].basis?.text ?? ''), 'a learning-support course does not transfer to Georgia Tech');
  expect(by['ENGL 1101']?.use && (by['ENGL 1101'].matched === 'ENGL 1101' || by['ENGL 1101'].proposals?.[0]?.code === 'ENGL 1101'), 'English Composition I is matched by its title to ENGL 1101', JSON.stringify(by['ENGL 1101']));
  const words = JSON.stringify([gsu.notes, gsu.courses.map((c) => c.basis?.text ?? '')]);
  expect(!/Illinois|Transferology|UGA/.test(words) && /Georgia Tech decides what transfers/.test(gsu.notes.join(' ')), "no line or note names Illinois, Transferology or UGA; the note says Georgia Tech decides", words.slice(0, 400));

  const m = M.proposeEquivalents({ code: 'ENGL 1101', title: 'English Composition I', credits: 3 }, catalog, 3, 'gatech');
  expect(m[0]?.code === 'ENGL 1101' && m[0].confidence === 'high', 'proposals for Georgia Tech come from its own titles, not the Illinois table', JSON.stringify(m));
}

console.log('\n=== 4. TOWER ===\n');
{
  const TOWER = A.advisorSystem('TOWER', 'Georgia Institute of Technology', 'Georgia Tech');
  const ARCH = A.advisorSystem('ARCH', 'University of Georgia', 'UGA');
  const ALMA = A.advisorSystem('ALMA', 'University of Illinois Urbana-Champaign', 'Illinois');
  expect(TOWER !== ARCH && TOWER !== ALMA && TOWER.startsWith(A.introLine('TOWER', 'Georgia Institute of Technology', 'Georgia Tech')), "the Georgia Tech name gets TOWER's own prompt, not ARCH's or ALMA's");
  expect(A.advisorSystem('TOWER', 'Georgia Tech', 'Georgia Tech') === A.advisorSystem('TOWER', 'Georgia Tech', 'Georgia Tech') && A.isGatechSchoolName('Georgia Tech') && A.isGatechSchoolName('Georgia Institute of Technology') && A.isGatechSchoolName('gatech'), 'Georgia Tech is read by its full name, its short name and its id');
  expect(!A.isGatechSchoolName('University of Georgia') && !A.isGatechSchoolName('South Georgia Technical College') && !A.isGatechSchoolName('University of Illinois Urbana-Champaign'), 'UGA, a technical college and Illinois are not Georgia Tech');
  const foreign = TOWER.match(FOREIGN);
  expect(!foreign, 'TOWER names no Illinois or UGA fact: Illinois, UGA, Grainger, Gies, Parkland, LAS, Athena, Transferology, uAchieve, the Bulletin', foreign ? TOWER.slice(Math.max(0, foreign.index - 120), foreign.index + 80) : '');
  const missing = Object.entries(A.SHARED_ADVISOR_RULES).filter(([k, v]) => !['syllabusLayout', 'professorRatings'].includes(k) && !TOWER.includes(v)).map(([k]) => k);
  expect(missing.length === 0, "TOWER has every shared rule but the syllabus and professor-ratings ones (it has neither tool)", missing.join(', '));
  expect(!TOWER.includes(A.SHARED_ADVISOR_RULES.syllabusLayout) && !TOWER.includes(A.SHARED_ADVISOR_RULES.professorRatings), 'and not those two');
  expect(TOWER.includes(A.answerAnyLine('Georgia Tech')) && /university_answer/.test(TOWER), "TOWER answers any question about Georgia Tech, from its pages, through university_answer");
  expect(/never state a limit from memory/.test(TOWER) && /never state a date from memory/.test(TOWER) && /The planner holds no Georgia Tech calendar/.test(TOWER), "Georgia Tech's load limits and dates come from university_answer, never memory");
  expect(/Wellbeing comes before the plan/.test(TOWER) && /make no board edits/.test(TOWER) && /\b911\b/.test(TOWER) && /\b988\b/.test(TOWER) && /give only contacts it returns/.test(TOWER), "a student in trouble: no edits, 911 and 988, and Georgia Tech's offices from university_answer, never invented");
  expect(/Change the board only for a change the student asked for, or one you proposed and they said yes to/.test(TOWER), 'TOWER proposes and acts on a yes, like ARCH');
  expect(/Grade history and student ratings: none are loaded/.test(TOWER) && /Syllabi: none are loaded/.test(TOWER) && /Clubs and student organizations: no list is loaded/.test(TOWER), 'it says what the planner does not hold for Georgia Tech: grades, ratings, syllabi, clubs');

  const NOW = new Date('2026-11-09T15:00:00Z');
  const req = (bot, schoolName, schoolShort) => R.advisorRequest({ model: 'claude-sonnet-5-5', bot, schoolName, schoolShort, board: 'Today: 2026-11-09\nBOARD', messages: [{ role: 'user', content: 'hi' }], now: NOW });
  const gt = req('TOWER', 'Georgia Institute of Technology', 'Georgia Tech');
  const names = gt.tools.map((t) => t.name);
  const LEFT_OUT = ['program_admission', 'compare_programs', 'find_clubs', 'professor_ratings', 'course_syllabus', 'term_syllabi'];
  expect(LEFT_OUT.every((n) => !names.includes(n)), `TOWER's tools leave out ${LEFT_OUT.join(', ')}`, names.join(', '));
  expect(names.includes('exam_credit') && names.includes('university_answer') && names.includes('set_plan_shape') && names.includes('update_setup') && names.length === 23, `TOWER keeps exam_credit (Georgia Tech's table is wired), university_answer and the board tools: ${names.length}`, names.join(', '));
  const almaOrder = A.ADVISOR_TOOLS.map((t) => t.name).filter((n) => names.includes(n));
  expect(JSON.stringify(almaOrder) === JSON.stringify(names), "in ALMA's order");
  const byName = new Map(A.ADVISOR_TOOLS.map((t) => [t.name, t]));
  const strip = (schema) => JSON.parse(JSON.stringify(schema, (k, v) => (k === 'description' ? undefined : v)));
  expect(gt.tools.every((t) => JSON.stringify(strip(t.input_schema)) === JSON.stringify(strip(byName.get(t.name).input_schema))), "with ALMA's schemas (only descriptions differ)");
  const toolText = JSON.stringify(gt.tools);
  const tf = toolText.match(FOREIGN);
  expect(!tf, 'no TOWER tool description names Illinois, UGA, their colleges or Transferology', tf ? toolText.slice(Math.max(0, tf.index - 160), tf.index + 60) : '');
  const sys = gt.system[0].text;
  expect(sys === TOWER && gt.system[0].cache_control?.type === 'ephemeral', 'the request sends TOWER\'s prompt, marked for the cache');
  const last = gt.messages[gt.messages.length - 1];
  const ctx = last.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  expect(!/term dates/i.test(ctx) && ctx.includes(R.PLANNER_CONTEXT) && ctx.includes('The board right now:\n\nToday: 2026-11-09\nBOARD'), 'no Illinois or UGA term dates are attached for Georgia Tech; the board is, marked as the planner\'s');
  expect(JSON.stringify(A.ADVISOR_TOOLS.map((t) => t.name)) === JSON.stringify(req('ALMA', 'University of Illinois Urbana-Champaign', 'Illinois').tools.map((t) => t.name)) && JSON.stringify(A.ugaAdvisorTools()) === JSON.stringify(req('ARCH', 'University of Georgia', 'UGA').tools), 'ALMA and ARCH still get their own tools');
}

console.log('\n=== 5. Saved and counted ===\n');
{
  const consent = { version: 2, usage: true, content: false, transcript: false };
  const e = I.cleanEvent({ id: crypto.randomUUID(), name: 'control_click', screen: 'planner', school: 'gatech', properties: { control: 'plan.rebuild' } }, consent);
  expect(e?.school === 'gatech' && I.cleanEvent({ id: crypto.randomUUID(), name: 'control_click', screen: 'planner', school: 'elsewhere', properties: {} }, consent)?.school === '', "an insight event keeps 'gatech', and drops an unknown school");
  const f = I.cleanFeedback({ id: crypto.randomUUID(), kind: 'bug', message: 'Something broke here.', school: 'gatech' });
  expect(f?.school === 'gatech', "feedback keeps 'gatech'");
  const plan = { schemaVersion: 1, programId: 'gt-cs-bs', graduationLabel: 'Spring 2030', completedCourseIds: [], terms: [{ id: 'fall-2026', label: 'Fall 2026', season: 'Fall', courseIds: [] }] };
  const snap = (answers, board) => ({ version: 1, answers, board: { schemaVersion: 4, board: { plan }, ...board }, chat: null });
  expect(S.workspaceSchema.safeParse(snap({ schoolId: 'gatech' }, { schoolId: 'gatech' })).success, "a Georgia Tech student's workspace can be saved to their account");
  expect(!S.workspaceSchema.safeParse(snap({ schoolId: 'gatech' }, { schoolId: 'illinois' })).success && !S.workspaceSchema.safeParse(snap({ schoolId: 'elsewhere' }, { schoolId: 'elsewhere' })).success, 'a plan and setup from different schools, or an unknown school, are still refused');
}

console.log('\n=== 6. Loaders and the lookup ===\n');
{
  expect((await P.loadProfessorRatings('gatech')) === null && (await CT.loadCourseTeaching('gatech')) === null && fetched.length === 0, 'Georgia Tech has no ratings or teaching file, and none is fetched', fetched.join(', '));
  const lk = L.LOOKUP_SCHOOLS.gatech;
  expect(lk?.id === 'gatech' && lk.short === 'Georgia Tech' && JSON.stringify(lk.domains) === '["gatech.edu"]' && L.SCHOOL_NAME.gatech === 'Georgia Tech', "the university lookup answers from gatech.edu (catalog., registrar. and the rest)");
  expect(L.onSchoolDomain('https://catalog.gatech.edu/rules/6/', lk) && !L.onSchoolDomain('https://www.uga.edu/', lk) && !L.lookupSystem(lk).match(/Illinois|UGA/), "a gatech.edu page is Georgia Tech's; uga.edu is not; the lookup's instructions name no other school");
  const G = await import(join(HERE, 'illinois-graduate.ts'));
  const gs = G.graduatePlanSettings('gatech');
  expect(gs.confirmed === false && gs.electiveLevelRange.min === 600 && !FOREIGN.test(gs.caveat) && G.graduatePlanSettings('illinois').electiveLevelRange.min === 500 && G.graduatePlanSettings('uga').confirmed === true, "a Georgia Tech graduate setting claims nothing (no graduate programs are planned for it) and leaves Illinois's and UGA's as they were");
}

console.log(failed === 0 ? '\nALL GEORGIA TECH SCHOOL CHECKS PASSED' : `\n${failed} GEORGIA TECH SCHOOL CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
