/**
 * Career goals from the one About-you box, and the line that says a card was
 * picked for them (lib/planner/goal-words.ts).
 *
 * Since 344bb4c the setup is one box, and the whole paragraph went into the
 * goal slot: where the student is and when they want to finish read as
 * goals. A review of that change found, on the planner's own boards:
 *
 *   1. "second year" made "second" a word the student wants, and courses
 *      titled "... in the Secondary School" electives for it;
 *   2. "I'm a sophomore in computer science" gave a software engineering goal;
 *   3. "I was pre-med until last spring ... UX research" switched the pre-med
 *      track on;
 *   4. the same student's words, moved from the three old boxes into the one,
 *      changed the electives on 177 of 308 boards;
 *   5. the rail's "What you want to be doing after" box and the advisor
 *      summary showed the whole paragraph.
 *
 * Checked here: the paragraph read clause by clause (part A), the career
 * words the workspace passes (part B), the goal line on a card (part C), and
 * real Illinois boards built from one-box words the way the workspace builds
 * them (part D): the same board as three boxes holding the same words, the
 * goal-driven picks still made, and labelled.
 *
 *   node lib/planner/__goal-words.check.mjs      (about half a minute)
 *
 * Exits non-zero on any failed check.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`));

const { goalWordsOf, setupWords, careerWordsFor, restoredCareerWords, goalReasonOf, isOneBoxSetup } = await import(join(HERE, 'goal-words.ts'));
const { EMPTY_ANSWERS, withSetupResponse, setupResponse, inferAcademicYear, inferGraduationTarget } = await import(join(HERE, 'onboarding.ts'));
const { interestProfile } = await import(join(HERE, 'career-tracks.ts'));
const { interestWordsFrom } = await import(join(HERE, 'quality.ts'));
const { planMarks } = await import(join(HERE, 'repick.ts'));

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `\n          ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const heard = (text) => interestProfile(text).heard;
const AT = new Date('2026-10-20T12:00:00');
const oneBox = (text) => withSetupResponse({ ...EMPTY_ANSWERS, schoolId: 'illinois' }, text, AT);

// ---- A. the paragraph, clause by clause ----------------------------------------
console.log('\nA. What goes on as goals, and what is left out');
// The box's own placeholder (onboarding.tsx), as a student who copies it would write it.
const PLACEHOLDER = "I'm in my second year at Illinois with about 45 credits. I'd like to finish in two years, explore psychology and linguistics, and work in data science. I also need time for a part-time job.";
{
  const r = goalWordsOf(PLACEHOLDER);
  check(r.goals === 'Explore psychology and linguistics, and work in data science.', 'the placeholder keeps its interests and its goal', JSON.stringify(r));
  check(!interestWordsFrom(r.goals).includes('second'), '1. "second year" is not a word the student wants (it matched "Secondary School" titles)', JSON.stringify(interestWordsFrom(r.goals)));
  check(!/45|credits|two years|part-time/.test(r.goals), 'credits, how long, and the job as a time limit are left out', r.goals);
  check(r.left.length === 3, 'three parts left out: the year and credits, the finish, the job', JSON.stringify(r.left));
  check(JSON.stringify(heard(r.goals)) === JSON.stringify(['data science/analytics']), 'the goal heard is data science', JSON.stringify(heard(r.goals)));
}
{
  const r = goalWordsOf("I'm a sophomore in computer science. I want to work in finance.");
  check(!heard(r.goals).includes('software engineering'), '2. "a sophomore in computer science" is where the student is, not a software engineering goal', JSON.stringify(heard(r.goals)));
  check(heard(r.goals).includes('finance'), '   ... and the goal they named is kept: finance', r.goals);
  const alone = goalWordsOf("I'm a sophomore in computer science.");
  check(alone.goals === '', '   a paragraph that only says where the student is has no goal words', JSON.stringify(alone));
}
{
  const r = goalWordsOf('I was pre-med until last spring, now I want UX research.');
  check(!interestProfile(r.goals).tracks.some((t) => t.id === 'pre-medicine'), '3. "was pre-med until last spring" does not switch the pre-med track on', r.goals);
  check(heard(r.goals).includes('UX/HCI design'), '   ... and UX research is the goal', r.goals);
  const switched = goalWordsOf('I switched from pre-med to UX research last year.');
  check(switched.goals === 'UX research.' && !interestProfile(switched.goals).tracks.length, '   "switched from pre-med to UX research": the new goal alone', JSON.stringify(switched));
  const used = goalWordsOf('I used to want to be a doctor, now I want physical therapy school.');
  check(JSON.stringify(heard(used.goals)) === JSON.stringify(['pre-physical-therapy']), '   "used to want to be a doctor, now PT school": PT alone', JSON.stringify(heard(used.goals)));
}
{
  // A refusal in the present stays, so the planner reads the retraction itself.
  const r = goalWordsOf("I want to go to med school. Actually I don't want med school anymore, I want physical therapy.");
  check(JSON.stringify(heard(r.goals)) === JSON.stringify(['pre-physical-therapy']), 'a goal taken back in the same paragraph stays taken back', JSON.stringify(heard(r.goals)));
}
{
  const r = goalWordsOf('Sophomore, about 45 credits, graduate spring 2029. I\'d like to begin a master\'s program in fall 2029.');
  check(r.goals === "I'd like to begin a master's program.", 'a goal with a date keeps the goal and drops the date', JSON.stringify(r));
  const after = goalWordsOf('Sophomore, graduate spring 2029. After graduating I\'d like to work at Deloitte.');
  check(after.goals === "After graduating I'd like to work at Deloitte." && heard(after.goals).includes('consulting'), '"After graduating I\'d like to work at Deloitte" is a goal, not a finish date', JSON.stringify(after));
  const law = goalWordsOf('I hope to graduate early and go to law school.');
  check(law.goals === 'Go to law school.' && heard(law.goals).includes('pre-law'), 'graduating early is left out, law school is kept', JSON.stringify(law));
  const then = goalWordsOf("I'd like to finish my degree in 3 years and then go to law school, maybe environmental law.");
  check(then.goals === 'Go to law school, maybe environmental law.', '"finish in 3 years and then law school": the law school part', JSON.stringify(then));
}
{
  const tail = goalWordsOf("I'm a sophomore in computer science who wants to do machine learning research.");
  check(tail.goals === 'I want to do machine learning research.' && JSON.stringify(heard(tail.goals)) === JSON.stringify(['AI/machine learning']), 'the goal after where the student is: machine learning, no software engineering', JSON.stringify({ ...tail, heard: heard(tail.goals) }));
  const junior = goalWordsOf("I'm a junior, pre-med, and I work 20 hours a week.");
  check(junior.goals === 'Pre-med.' && interestProfile(junior.goals).tracks.some((t) => t.id === 'pre-medicine'), 'a career track named beside the year is kept; the job hours are not', JSON.stringify(junior));
  const senior = goalWordsOf("Senior data analyst at a tech company someday. I'm a junior.");
  check(senior.goals === 'Senior data analyst at a tech company someday.', '"senior data analyst" is a job, not a year', JSON.stringify(senior));
  const nurse = goalWordsOf('I am a transfer student from Parkland with 60 credits and I want to be a nurse.');
  check(nurse.goals === 'I want to be a nurse.', 'transfer credit is left out, the goal kept', JSON.stringify(nurse));
  const away = goalWordsOf("I'm undeclared in LAS but want to major in economics. I'd like to study abroad in spring 2028 and take summer classes.");
  check(away.goals === '' && /economics/.test(away.studying), 'a major to declare ranks electives (studying) and is no goal; abroad and summers are timeline', JSON.stringify(away));
}
{
  // The old three boxes' second example, as one paragraph.
  const r = goalWordsOf('I am considering a computer science minor. I would also like room for psychology and linguistics.\n\nSecond year, about 45 credits. I want to graduate spring 2029. I failed calc once so I am a semester behind on the math sequence.\n\nSomething with data. I like problem solving more than writing. Maybe analytics at a company, maybe a masters if that is what it takes.');
  check(r.studying === 'I am considering a computer science minor.', 'a minor the student is weighing ranks electives and names no goal', JSON.stringify(r.studying));
  check(!heard(r.goals).includes('software engineering') && heard(r.goals).includes('data science/analytics'), 'the goals: data science, not software engineering', JSON.stringify(heard(r.goals)));
  check(!/calc|semester behind|2029/.test(r.goals), 'a failed class and the finish date are left out', r.goals);
  const psych = goalWordsOf("I'm a psychology major considering a minor in business because I want to start a company.");
  check(psych.studying === 'Considering a minor in business.' && psych.goals === 'I want to start a company.', 'major left out, minor weighed, the company is the goal', JSON.stringify(psych));
}

// ---- B. the words the workspace passes -------------------------------------------
console.log('\nB. Career words: the setup, the rail box, saved boards');
{
  const legacy = { ...EMPTY_ANSWERS, studying: 'Psychology and linguistics.', timeline: "I'm in my second year with about 45 credits.", after: 'Work in data science.' };
  check(!isOneBoxSetup(legacy), 'a setup saved with three boxes is not read as one box');
  check(JSON.stringify(setupWords(legacy)) === JSON.stringify({ studying: 'Psychology and linguistics.', goals: 'Work in data science.' }), 'three boxes: each box as the student filled it, unchanged', JSON.stringify(setupWords(legacy)));
  const one = oneBox(PLACEHOLDER);
  check(isOneBoxSetup(one), 'the one box is read as one box');
  check(setupWords(one).goals === 'Explore psychology and linguistics, and work in data science.', 'one box: the goals alone go to the goal slot');
  check(setupResponse(one) === PLACEHOLDER, 'the setup box still shows the whole paragraph to edit');
  check(inferAcademicYear(one.timeline) === 'second', 'the year is still read from the whole paragraph (timeline)');
  check(JSON.stringify(inferGraduationTarget('Second year, about 45 credits. I want to graduate spring 2029.')) === JSON.stringify({ season: 'Spring', year: 2029 }), 'the finish date is still read from the timeline');
  const setup = setupWords(one);
  check(careerWordsFor(setup, '', false) === setup.goals, 'nothing typed in the rail: the setup\'s goals');
  check(careerWordsFor(setup, 'I want to be a pharmacist.', false) === 'I want to be a pharmacist.', 'a goal typed in the rail box wins over the setup');
  check(careerWordsFor(setup, '', true) === '', 'the rail box emptied on purpose: no goal, not the setup\'s again');
  check(restoredCareerWords(PLACEHOLDER, one) === setup.goals, 'a board saved with the whole paragraph in the rail box shows the goals');
  check(restoredCareerWords('Pharmacy school.', one) === 'Pharmacy school.', 'a goal the student typed is restored as typed');
  check(restoredCareerWords('Work in data science.', legacy) === 'Work in data science.', 'a three-box board is restored as saved');
  check(JSON.stringify(setupWords(null)) === JSON.stringify({ studying: '', goals: '' }), 'no setup: no words');
}

// ---- C. the line on a card -------------------------------------------------------
console.log('\nC. "Picked for your goal" on the planner\'s own picks');
{
  const course = (code, title) => ({ id: code.replace(' ', '_'), code, title, cluster: code.split(' ')[0], credits: 3, tags: [] });
  const courses = [course('STAT 107', 'Data Science Discovery'), course('PSYC 100', 'Intro Psych'), course('LING 250', 'Linguistics of English'), course('PSYC 201', 'Foundations of Psychology'), course('MCB 150', 'Molec & Cellular Basis of Life'), course('STAT 200', 'Statistical Analysis'), course('ENGL 101', 'Intro to Fiction')];
  const byCode = new Map(courses.map((c) => [c.code, c]));
  const marks = planMarks({
    pools: [],
    language: null,
    electives: [
      { code: 'STAT 107', why: 'An elective toward the degree total. Chosen for: light by grade history (difficulty 20 of 100); named for the goal you gave.' },
      { code: 'LING 250', why: 'An elective that also carries Humanities. Chosen for: its title matches what you said you want.' },
      { code: 'PSYC 201', why: 'An elective in PSYC, one of this degree\'s own subjects. Chosen for: in your major.' },
      { code: 'MCB 150', why: 'For Pre-medicine (MD/DO): general biology', track: 'Pre-medicine (MD/DO)' },
      { code: 'ENGL 101', why: 'Picked for your priorities: its title matches what you said you want' },
    ],
    genEdPicks: [{ code: 'STAT 200', label: 'Quantitative Reasoning I', forGoal: true }, { code: 'PSYC 100', label: 'Social Sciences' }],
    addedPrerequisites: [],
  }, byCode);
  const words = { career: 'Work in data science.', interests: 'Explore psychology and linguistics. Work in data science.' };
  const line = (code) => goalReasonOf(byCode.get(code), marks.get(byCode.get(code).id), words);
  check(line('STAT 107') === 'Picked for your goal: data science/analytics', 'an elective named for the goal names the goal', line('STAT 107'));
  check(line('MCB 150') === 'Picked for your goal: Pre-medicine (MD/DO)', 'a career track course names the track', line('MCB 150'));
  check(line('STAT 200') === 'Picked for your goal: data science/analytics', 'a gen ed pick the goal ordered names the goal', line('STAT 200'));
  check(line('PSYC 100') === null, 'a gen ed pick the goal did not order has no line');
  check(line('PSYC 201') === null, 'an elective picked for the major has no line (a major is not a goal)');
  check(line('LING 250') === 'Picked for your interest in linguistics', 'an interest that is no goal topic is named in the student\'s word', line('LING 250'));
  check(line('ENGL 101') === 'Picked for what you said you want', 'a re-picked elective whose words no longer name it still says why', line('ENGL 101'));
  check(goalReasonOf(byCode.get('PSYC 201'), undefined, words) === null, 'a required course (no mark) keeps its own label and no goal line');
}

// ---- D. real Illinois boards ------------------------------------------------------
console.log('\nD. Real boards from one-box words, built the way the workspace builds them');
const { generatePlan } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = read('illinois/offerings.json');
applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom && gradeRaw.has(norm(c.gradeFrom))) gradeRaw.set(norm(c.code), gradeRaw.get(norm(c.gradeFrom)));
const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
const sectionsFile = read('illinois/sections.json');
const excellentFile = existsSync(join(PUBLIC, 'illinois', 'excellent.json')) ? read('illinois/excellent.json') : null;
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
  prereqs: new Map(Object.entries(read('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionsFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionsFile.termId, termLabel: sectionsFile.termLabel }])),
  equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))),
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined,
  excellentTerms: excellentFile ? excellentFile.terms : undefined,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offeringsFile.courses)),
  offeringTerms: offeringsFile.terms,
  offeringAliases: offeringsFile.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  languages: read('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (spec, earlier, sameTerm, eq) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, eq),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const summaries = read('illinois/programs.json');
const H4 = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
const FRESH = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };

/** A board for these setup answers, with the words planner-workspace.tsx passes: [studying, careerText] and careerText. */
function board(programId, answers) {
  const s = summaries.find((p) => p.id === programId);
  for (const r of rows) { r.requirementIds = []; delete r.pathwayRole; }
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [read(`illinois/program/${s.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(s.id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  const program = adapted.programs[0];
  const setup = setupWords(answers);
  const career = careerWordsFor(setup, '', false);
  const words = { interests: [setup.studying, career].join(' '), career };
  const g = generatePlan({
    requirements: blocks, context, prior: FRESH, horizon: H4,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId: s.id, degreeTotal: s.totalCredits || program.totalCredits || 120,
    interests: words.interests, career: words.career, programName: program.name, programCollege: program.college, admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  });
  const marks = planMarks({ pools: g.pools, language: g.language, electives: g.electives, genEdPicks: g.genEdPicks ?? [], addedPrerequisites: g.addedPrerequisites }, new Map(rows.map((c) => [norm(c.code), c])));
  const lines = new Map();
  for (const [id, mark] of marks) {
    const c = rows.find((r) => r.id === id);
    const l = c ? goalReasonOf(c, mark, words) : null;
    if (l) lines.set(norm(c.code), l);
  }
  const codes = g.terms.flatMap((t) => t.codes.map(norm)).sort();
  return { g, codes, lines, words };
}
const sameBoard = (a, b) => JSON.stringify(a.codes) === JSON.stringify(b.codes);
{
  const three = { ...EMPTY_ANSWERS, schoolId: 'illinois', studying: 'Explore psychology and linguistics.', timeline: "I'm in my second year at Illinois with about 45 credits. I'd like to finish in two years. I also need time for a part-time job.", after: 'Work in data science.' };
  const a = board('las/psychology-bslas', three);
  const b = board('las/psychology-bslas', withSetupResponse(three, PLACEHOLDER, AT));
  check(sameBoard(a, b), 'Psychology: the placeholder in one box builds the board three boxes with the same words build', `${a.codes.filter((c) => !b.codes.includes(c))} -> ${b.codes.filter((c) => !a.codes.includes(c))}`);
  const goalLines = [...b.lines].filter(([, l]) => /data science/.test(l));
  check(goalLines.length > 0, `goal-driven picks still happen, and say so: ${goalLines.slice(0, 3).map(([c, l]) => `${c} "${l}"`).join('; ')}`, JSON.stringify([...b.lines]));
  check(!b.codes.some((code) => /secondary school/i.test(byCode.get(code)?.title ?? '')), 'no "... in the Secondary School" course on the board');
}
{
  const premed = board('las/integrative-biology-bslas', oneBox("I'm a sophomore in biology with 30 credits. I want to go to medical school after I graduate."));
  const track = [...premed.lines].filter(([, l]) => l === 'Picked for your goal: Pre-medicine (MD/DO)');
  check(track.length > 0 && premed.g.electives.some((e) => e.track === 'Pre-medicine (MD/DO)'), `a one-box pre-med gets the track, and its cards say so (${track.map(([c]) => c).slice(0, 4).join(', ')})`);
  const ex = board('las/integrative-biology-bslas', oneBox("I'm a sophomore in biology. I was pre-med until last spring, now I want to do UX research."));
  check(!ex.g.electives.some((e) => e.track) && !/pre-med/i.test(ex.words.career), 'a student who left pre-med gets no pre-med track', ex.words.career);
  const cs = board('engineering/computer-science-bs', oneBox("I'm a sophomore in computer science with 40 credits. I'd like to graduate in spring 2029."));
  check(cs.words.career === '' && cs.lines.size === 0, 'a CS sophomore who named no goal gets no software engineering goal and no goal lines', `${JSON.stringify(cs.words)} ${JSON.stringify([...cs.lines].slice(0, 3))}`);
}

console.log(failed === 0 ? '\nAll goal-word checks passed.' : `\n${failed} goal-word check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
