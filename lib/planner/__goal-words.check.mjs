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
 * Checked here: the paragraph read clause by clause (part A) and the career
 * words the workspace passes (part B).
 *
 *   node lib/planner/__goal-words.check.mjs      (a second)
 *
 * Exits non-zero on any failed check.
 */
import { spawnSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));

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

const { goalWordsOf, setupWords, careerWordsFor, restoredCareerWords, isOneBoxSetup } = await import(join(HERE, 'goal-words.ts'));
const { EMPTY_ANSWERS, withSetupResponse, setupResponse, inferAcademicYear, inferGraduationTarget } = await import(join(HERE, 'onboarding.ts'));
const { interestProfile } = await import(join(HERE, 'career-tracks.ts'));
const { interestWordsFrom } = await import(join(HERE, 'quality.ts'));

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

console.log(failed === 0 ? '\nAll goal-word checks passed.' : `\n${failed} goal-word check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
