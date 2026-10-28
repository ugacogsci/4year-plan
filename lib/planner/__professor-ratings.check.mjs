/**
 * Student ratings from Rate My Professors (professor-ratings.ts), checked
 * without calling the API.
 *
 *   1. matching: accents, case, "Last, First", middle names and initials,
 *      nicknames, two-part last names; a first initial alone only when one
 *      profile at the school fits it, the course's department confirms it and
 *      the school's grade history and syllabi name no other person with that
 *      last name and initial;
 *      two profiles of one name settled by the course's department, or "not
 *      sure"; obvious duplicate profiles merged, others kept apart;
 *   2. the consensus words at each threshold, always with the count and
 *      one short caveat, never the site's name or a link (2026-10-27: the
 *      owner's rule, the numbers are given as student ratings);
 *   3. what the tools return: professor_ratings by name or by course, and
 *      student_ratings on syllabus instructor entries only where a profile
 *      surely matches;
 *   4. the tool for both bots and the rules in both prompts; nothing the
 *      model or a student sees names or links the site;
 *   5. the shipped files (public/<school>/professor-ratings.json) and real
 *      names from each school's syllabi; nothing the planner builds plans
 *      with reads them.
 *
 *   node lib/planner/__professor-ratings.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const P = await import(join(HERE, 'professor-ratings.ts'));
const A = await import(join(HERE, 'advisor.ts'));
const R = await import(join(HERE, 'advisor-request.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));
// 2026-10-27, the owner's rule: nothing the model or a student sees names or links the site the ratings come from.
const SITE = /Rate ?My ?Professors|ratemyprofessors\.com/i;

const raw = (id, firstName, lastName, department, averageRating, averageDifficulty, ratingCount, wouldTakeAgainPercent = null) => ({
  id, firstName, lastName, department, averageRating, averageDifficulty, ratingCount, wouldTakeAgainPercent, profileUrl: `https://www.ratemyprofessors.com/professor/${id}`,
});
const RAW = [
  raw(1, 'Geoffrey', 'Challen', 'Computer Science', 4.1, 3.2, 52, 80),
  raw(2, 'James', 'Anderson', 'Chemistry', 3.9, 4.2, 38, 70),
  raw(3, 'James', 'Anderson', 'Leadership', 4.6, 2.1, 24, 95),
  raw(4, 'Michael', 'Smith', 'Business', 3.0, 3.0, 12, 60),
  raw(5, 'Mike', 'Philpott', 'Engineering', 4.0, 3.0, 40, 90),
  raw(6, 'Mike', 'Philpott', 'Mechanical Engineering', 2.0, 4.0, 10, 40),
  raw(7, 'Samantha', 'Hagood', 'French', 4.4, 2.6, 22, 88),
  raw(8, 'Samantha', 'Hagood', 'Spanish', 4.2, 2.8, 55, 85),
  raw(9, 'Yang', 'Liu', 'Bioengineering', 3.5, 3.5, 9, null),
  raw(10, 'Yi', 'Liu', 'Chemistry', 3.7, 3.1, 14, 66),
  raw(11, 'Luis', 'Rodriguez', 'Agriculture', 4.0, 2.9, 10, 77),
  raw(12, 'Eric', 'Shaffer', 'Computer Science', 3.8, 2.7, 30, 81),
  raw(13, 'Michael J', 'Adang', 'Science', 4.3, 3.4, 7, 90),
  raw(14, 'Thelma', 'Sanders-Bustle', 'Education', 4.8, 2.0, 6, 100),
  raw(15, 'Dr. Cynthia', 'Rippé', 'Marketing', 4.5, 3.0, 20, 90),
  raw(16, 'Nobody', 'Unrated', 'History', null, null, 0, null),
  raw(17, 'Laurence', 'Mall', 'Foreign Languages', 3.0, 3.0, 6, null),
  raw(18, 'Laurence', 'Mall', 'French', 5.0, 2.0, 1, null),
];
const profiles = P.ratedProfiles(RAW);
const subjectDepartments = P.learnSubjectDepartments(profiles, [
  { subject: 'CS', name: 'Geoffrey Challen' }, { subject: 'CS', name: 'Eric Shaffer' }, { subject: 'CS', name: 'Shaffer, Eric G' },
  { subject: 'CS', name: 'G. Challen' },
], (subject, dept) => ({ CHEM: ['Chemistry'], LEAD: ['Leadership'], SPAN: ['Spanish'], FREN: ['French'], BIOE: ['Bioengineering'], ABE: ['Agriculture'] })[subject]?.includes(dept) ?? false, ['CHEM', 'LEAD', 'SPAN', 'FREN', 'BIOE', 'ABE', 'HIST']);
const FILE = { source: 'Rate My Professors', school: 'illinois', schoolName: 'Test', collectedAt: '2026-10-25', profiles, subjectDepartments };
const found = (raw, subject = null) => { const m = P.matchProfessor(FILE, raw, subject); return m.status === 'found' ? m.profile.id : m.status; };

// ---------------------------------------------------------------------------
console.log('\n=== 1. Matching ===\n');
{
  expect(profiles.length === RAW.length - 1 - 2 && !profiles.some((p) => p.last === 'Unrated'), 'unrated profiles are left out, and two obvious duplicates merged', `${profiles.length}`);
  const philpott = profiles.find((p) => p.last === 'Philpott');
  expect(philpott && philpott.count === 50 && philpott.merged?.length === 1 && philpott.dept === 'Engineering' && philpott.rating === 3.6 && philpott.difficulty === 3.2 && philpott.again === 80, '"Engineering" and "Mechanical Engineering" of one name are one person: counts added, numbers weighted by count', JSON.stringify(philpott));
  const mall = profiles.find((p) => p.last === 'Mall');
  expect(mall && mall.count === 7 && mall.merged?.length === 1, 'a language beside "Foreign Languages" of one name is one person');
  expect(profiles.filter((p) => p.last === 'Hagood').length === 2 && profiles.filter((p) => p.last === 'Anderson').length === 2, 'French and Spanish, or Chemistry and Leadership, of one name stay two profiles');
  expect(profiles.find((p) => p.last === 'Rippé')?.first === 'Cynthia', 'a title in the first name ("Dr. Cynthia") is taken off');
  expect(JSON.stringify(subjectDepartments.CS) === JSON.stringify(['Computer Science']), 'departments are learned from names that match exactly one profile', JSON.stringify(subjectDepartments.CS));
  expect(subjectDepartments.CHEM?.join() === 'Chemistry' && subjectDepartments.HIST === undefined, "and named from the catalog's subjects, for subjects no name was seen in");

  expect(found('Geoffrey Challen') === 1 && found('GEOFFREY CHALLEN') === 1 && found('Challen, Geoffrey') === 1 && found('Dr. Geoffrey Challen, Ph.D.') === 1, 'case, "Last, First", titles and credentials');
  expect(found('Luis F. Rodríguez') === 11 && found('Rodríguez, Luis') === 11, 'accents and a middle initial');
  expect(found('Eric G. Shaffer') === 12 && found('Shaffer, Eric G') === 12, 'a middle initial on either side');
  expect(found('Mike Adang') === 13 && found('Michael Adang') === 13, 'a nickname, and a middle initial in the profile\'s first name');
  expect(found('Thelma Sanders Bustle') === 14 && found('Thelma Bustle') === 14, 'a two-part last name, written with a space or a hyphen, or by its last part');
  expect(found('Cynthia Rippe') === 15, 'an accent in the profile\'s last name');
  expect(found('John Challen') === 'none' && found('Geoffrey Challenger') === 'none', 'a different first name, or a longer last name, is no one');
  expect(found('TBA') === 'none' && found('Staff') === 'none' && found('not named in the syllabus') === 'none', 'placeholders are no one');
  expect(found('Challen') === 'needs_first_name', 'a last name alone asks for a first name');
  expect(found('Challen, G', 'CS') === 1, 'a first initial with the course whose department confirms it');
  expect(found('Challen, G') === 'unsure' && found('Challen, G', 'CHEM') === 'unsure', 'a first initial alone, or with a course of another department, is not sure');
  expect(found('Liu, Y', 'BIOE') === 'unsure', 'a first initial two profiles share is not sure, even when the course fits one');
  expect(found('James Anderson') === 'unsure' && found('James Anderson', 'CHEM') === 2 && found('James Anderson', 'LEAD') === 3 && found('James Anderson', 'HIST') === 'unsure', 'one name, two profiles: the course department settles it, or not sure');
  expect(found('Samantha Hagood', 'SPAN') === 8 && found('Samantha Hagood', 'FREN') === 7 && found('Samantha Hagood') === 'unsure', 'the same for French and Spanish');
  expect(found('Michael Smith') === 4 && found('Michael Smith', 'CHEM') === 'unsure' && found('Michael Smith', 'PHIL') === 4, "one profile: taken, unless the course's known departments do not include its own");
  const unsure = P.matchProfessor(FILE, 'James Anderson');
  expect(unsure.status === 'unsure' && unsure.departments.join() === 'Chemistry,Leadership', 'not sure names the departments the profiles are listed under');
  const MARKED = { ...FILE, profiles: P.markSameInitial(profiles, ['Challen, Gary', 'Geoffrey Challen', 'Mike Adang', 'Shaffer, E', 'Eric Smith']) };
  const challen = MARKED.profiles.find((p) => p.last === 'Challen');
  expect(JSON.stringify(challen.sameInitial) === '["Gary Challen"]' && !MARKED.profiles.find((p) => p.last === 'Adang').sameInitial && MARKED.profiles.filter((p) => p.sameInitial).length === 1, 'the build marks a profile with the other people of its last name and initial the school names (not a nickname, an initial, the profile\'s own name or another initial)', JSON.stringify(MARKED.profiles.filter((p) => p.sameInitial)));
  const clash = P.matchProfessor(MARKED, 'Challen, G', 'CS');
  expect(clash.status === 'unsure' && /also name Gary Challen with that last name and initial/.test(clash.why) && P.matchProfessor(MARKED, 'Geoffrey Challen', 'CS').status === 'found' && P.matchProfessor(MARKED, 'Challen, Geoffrey').status === 'found', 'a first initial another person of the school shares is not sure, even when one profile fits it; the full name still is', clash.why);
  // 2026-10-28: a profile that gives only an initial ("L Reeves") is held to the same rule from the other side.
  const REEVES = (names) => ({ ...FILE, profiles: P.markSameInitial([{ id: 50, first: 'L', last: 'Reeves', dept: 'English', rating: 4, difficulty: 3, again: 80, count: 48, url: 'https://www.ratemyprofessors.com/professor/50' }], names), subjectDepartments: { ENGL: ['English'] } });
  const st = (file, name) => P.matchProfessor(file, name, 'ENGL').status;
  expect(st(REEVES(['Lisa Reeves']), 'Lisa Reeves') === 'found' && st(REEVES(['Lisa Reeves']), 'Reeves, L') === 'found' && st(REEVES(['Lisa Reeves', 'Laura Reeves']), 'Lisa Reeves') === 'unsure' && st(REEVES(['Lisa Reeves', 'Laura Reeves']), 'Reeves, L') === 'unsure' && st(REEVES(['Nancee Reeves']), 'Nancee Reeves') === 'none', 'a profile giving only an initial: the one person the school names with it, never one of two (Lisa or Laura Reeves), never another initial');
  expect(P.fullerName('Challen, G', ['Challen, Geoffrey', 'Smith, John']) === 'Challen, Geoffrey' && P.fullerName('Challen, G', ['Challen, Geoffrey', 'Challen, Gary']) === 'Challen, G' && P.fullerName('Geoffrey Challen', ['Challen, Gary']) === 'Geoffrey Challen', 'a fuller name the planner also holds is used when exactly one fits');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. The consensus, in words ===\n');
{
  const p = (count, rating, difficulty, again) => ({ id: 1, first: 'Ada', last: 'Lovelace', dept: 'Mathematics', rating, difficulty, again, count, url: 'https://www.ratemyprofessors.com/professor/1' });
  const c = (...a) => P.ratingConsensus(p(...a));
  // 2026-10-28: the numbers first, as the owner wrote them, and no caveat: a result gives it once (RATINGS_CAVEAT).
  const clean = (s) => !/self-selected/.test(s) && !SITE.test(s) && !/https?:|Profile/.test(s);
  const few = c(4, 5, 1, 100);
  expect(few === 'Only 4 student ratings of Ada Lovelace, too few to say much.', 'under 5 ratings: too few to say much, and nothing more', few);
  expect(c(1, 3, 3, null) === 'Only 1 student rating of Ada Lovelace, too few to say much.', 'one rating is "1 student rating"');
  expect(/^Based on only 5 student ratings, /.test(c(5, 3, 3, null)) && /^Based on only 9 student ratings, /.test(c(9, 3, 3, null)) && /^Based on 10 student ratings, /.test(c(10, 3, 3, null)) && /^Based on 196 student ratings, /.test(c(196, 3, 3, null)), '5-9 "only N", 10 or more "N"');
  expect(c(196, 4.4, 3.5, 90) === 'Based on 196 student ratings, students rate Ada Lovelace 4.4 of 5 overall (rated highly), difficulty 3.5 of 5 (moderately hard), and most (90%) would take the professor again.', "the owner's sentence: the count, then overall, difficulty and would take again as numbers, each with its word", c(196, 4.4, 3.5, 90));
  expect(/ 4\.0 of 5 overall \(rated highly\)/.test(c(20, 4.0, 3, null)) && / 3\.5 of 5 overall \(rated well\)/.test(c(20, 3.5, 3, null)) && / 2\.6 of 5 overall \(mixed\)/.test(c(20, 2.6, 3, null)) && / 2\.5 of 5 overall \(rated low\)/.test(c(20, 2.5, 3, null)), 'overall: 4.0+ highly, 3.5-3.9 well, 2.6-3.4 mixed, 2.5 or lower low');
  expect(/difficulty 4\.0 of 5 \(hard\)/.test(c(20, 3, 4.0, null)) && /difficulty 3\.0 of 5 \(moderately hard\)/.test(c(20, 3, 3.0, null)) && /difficulty 2\.5 of 5 \(about average\)/.test(c(20, 3, 2.5, null)) && /difficulty 2\.4 of 5 \(on the easier side\)/.test(c(20, 3, 2.4, null)), 'difficulty: 4.0+ hard, 3.0-3.9 moderately hard, 2.5-2.9 about average, under 2.5 easier');
  expect(/, and most \(80%\) would take the professor again\.$/.test(c(20, 3, 3, 80)) && /, and fewer than half \(49%\) would take/.test(c(20, 3, 3, 49)) && /, and 65% would take the professor again/.test(c(20, 3, 3, 65)) && !/again/.test(c(20, 3, 3, null)), 'would take again: 80%+ most, under 50% fewer than half, else the percent; left out when the site shows none');
  for (const s of [c(5, 4.5, 4.5, 90), c(40, 1.5, 1.5, 10), c(12, 3, 3, null)]) expect(clean(s) && /^Based on (only )?\d+ student ratings, /.test(s) && !/\b(good|bad|great|terrible|awful|best|worst)\b/i.test(s), 'every sentence has the count and no caveat (a result gives it once), names no site, links nothing, and calls no one good or bad', s);
  expect(P.RATINGS_CAVEAT === "Student ratings are self-selected and cover all of a professor's courses, not one course." && !SITE.test(P.RATINGS_CAVEAT), 'the one short caveat');
  expect(P.ratingWords(p(4, 5, 1, 100)) === 'too few ratings to say much' && P.ratingWords(p(20, 4.2, 4.1, 85)) === 'rated highly; classes rated hard; most (85%) would take again' && P.ratingWords(p(20, 3.0, 2.0, null)) === 'mixed ratings; classes rated on the easier side', 'the short words for syllabus entries');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. What the tools return ===\n');
{
  const byName = P.professorRatingsResult(FILE, { name: 'James Anderson', code: 'chem 102' });
  const hit = byName.professors?.[0];
  expect(byName.ok && byName.course === 'CHEM 102' && hit.status === 'found' && hit.professor === 'James Anderson' && hit.ratings === 38 && hit.listed_under === 'Chemistry' && /^Based on 38 student ratings, students rate James Anderson 3\.9 of 5 overall/.test(hit.consensus) && hit.profile === undefined, 'by name and course: the professor the course settles, with the consensus and no link', hit.consensus);
  expect(byName.sources === undefined && byName.source === undefined && byName.caveat === P.RATINGS_CAVEAT, 'no source and no link goes under the reply; the caveat comes once');
  expect(/self-selected/.test(byName.note) && /never add what students wrote/.test(byName.note) && /email, office hours/.test(byName.note), 'the note says what the numbers are and are not');
  const amb = P.professorRatingsResult(FILE, { name: 'James Anderson' });
  expect(amb.professors[0].status === 'not sure which professor' && amb.professors[0].could_be_listed_under.length === 2 && amb.sources === undefined, 'by name alone, two rated professors: not sure which professor, with no link');
  const none = P.professorRatingsResult(FILE, { name: 'Grace Hopper' });
  expect(none.professors[0].status === 'no student ratings found' && /No student ratings at Illinois were found for this name; that says nothing about the professor/.test(none.professors[0].why), 'no ratings: says so, and that it says nothing about the professor');
  const last = P.professorRatingsResult(FILE, { name: 'Challen', code: 'CS 124' }, ['Geoffrey Challen', 'Craig Zilles']);
  expect(last.professors[0].status === 'found' && last.professors[0].professor === 'Geoffrey Challen', "a last name with the course: the course's own instructor of that name");
  expect(P.professorRatingsResult(FILE, { name: 'Challen' }).professors[0].status === 'needs a first name or the course', 'a last name alone: asks for a first name or the course');
  const course = P.professorRatingsResult(FILE, { code: 'CS 124' }, ['Challen, G', 'Eric Shaffer', 'Grace Hopper'], ['Challen, Geoffrey']);
  expect(course.professors.map((p) => p.status).join() === 'found,found,no student ratings found' && course.professors[0].professor === 'Geoffrey Challen', "by course: every instructor, a section's initial read through the fuller name", course.professors.map((p) => p.status).join());
  expect(P.professorRatingsResult(FILE, {}).ok === false && P.professorRatingsResult(null, { name: 'x' }).ok === false, 'nothing asked, or no file: ok false with the reason');

  const syl = { ok: true, code: 'CS 124', by_instructor: [{ instructor: 'Geoffrey Challen' }, { instructor: 'Grace Hopper' }, { instructor: 'not named in the syllabus' }], syllabi: [{ instructors: ['Geoffrey Challen'] }] };
  const marked = P.withStudentRatings(syl, FILE, 'CS 124');
  expect(marked.by_instructor[0].student_ratings?.ratings === 52 && marked.by_instructor[0].student_ratings.words === 'rated highly; classes rated moderately hard; most (80%) would take again' && !marked.by_instructor[1].student_ratings && !marked.by_instructor[2].student_ratings && /student_ratings appears only where the ratings surely belong to the instructor/.test(marked.student_ratings_note), 'course_syllabus: student_ratings on the matched instructor only, with one note');
  expect(marked.syllabi === syl.syllabi && syl.by_instructor[0].student_ratings === undefined, 'the rest of the result is untouched, and the original is not changed');
  const term = { ok: true, courses: [{ code: 'CHEM 102', instructors: [{ instructor: 'James Anderson' }] }, { code: 'HIST 100', instructors: [{ instructor: 'James Anderson' }] }] };
  const t2 = P.withStudentRatings(term, FILE, undefined, (code) => (code === 'CHEM 102' ? [] : []));
  expect(t2.courses[0].instructors[0].student_ratings?.ratings === 38 && !t2.courses[1].instructors[0].student_ratings, "term_syllabi: each course's own department settles the profile, or none is attached");
  const seen = [byName, amb, none, last, course, marked, t2, P.professorRatingsResult(FILE, { code: 'CS 124' }, []), P.instructorRatings(FILE, 'Geoffrey Challen', 'CS 124')].map((r) => JSON.stringify(r));
  const named = seen.filter((t) => SITE.test(t) || /https?:|"profile"/.test(t));
  expect(named.length === 0 && seen.length === 9, 'no result names the site, links a profile or carries a profile field', named.join(' | ').slice(0, 300));
  const nothing = { ok: true, code: 'X 1', by_instructor: [{ instructor: 'Grace Hopper' }] };
  expect(P.withStudentRatings(nothing, FILE, 'X 1') === nothing && P.withStudentRatings(syl, null, 'CS 124') === syl, 'no match, or no file: the result exactly as it was');
  const fewHit = P.instructorRatings({ ...FILE }, 'Thelma Sanders Bustle', 'EDUC 100');
  expect(fewHit && fewHit.words === 'rated highly; classes rated on the easier side; most (100%) would take again' && fewHit.overall === 4.8, 'six ratings carry their numbers');
  const tooFew = P.instructorRatings({ ...FILE, profiles: [{ ...profiles.find((p) => p.last === 'Challen'), count: 3 }] }, 'Geoffrey Challen', 'CS 124');
  expect(tooFew && tooFew.words === 'too few ratings to say much' && tooFew.overall === undefined, 'under 5 ratings, a syllabus entry carries the count and "too few", not the numbers');
}

// ---------------------------------------------------------------------------
console.log("\n=== 3b. A course's rundown (2026-10-28) ===\n");
{
  // The owner's rule: for "who is the best rated HIST 2301 professor?" the bot gives the rundown itself, from the
  // class schedule's instructors: who teaches it next term, each one's numbers, and a clear pick.
  const SOURCE = "UGA's Schedule of Classes (Spring 2026 to Summer 2027)";
  const sched = (teaches, term = 'Spring 2027') => ({ source: SOURCE, term, teaches });
  const order = (r) => r.professors.map((p) => p.asked).join(', ');
  const cs = P.professorRatingsResult(FILE, { code: 'CS 124' }, ['Grace Hopper', 'Eric Shaffer', 'Geoffrey Challen', 'Craig Zilles'], [], { schedule: sched([{ name: 'Grace Hopper', terms: ['Spring 2027'] }, { name: 'Eric Shaffer', terms: ['Spring 2027', 'Fall 2026'] }, { name: 'Geoffrey Challen', terms: ['Fall 2026'] }]) });
  expect(order(cs) === 'Eric Shaffer, Grace Hopper, Geoffrey Challen, Craig Zilles' && cs.term === 'Spring 2027' && cs.teaching_that_term === 2 && cs.schedule === SOURCE, "most useful first: next term's instructors (the rated first), the schedule's other terms, then the syllabi's names", order(cs));
  expect(JSON.stringify(cs.professors[0].teaches) === '["Spring 2027","Fall 2026"]' && cs.professors[3].teaches === undefined, 'each scheduled instructor carries the terms they teach it in; a syllabus name carries none');
  expect(cs.highest_rated === 'Eric Shaffer' && cs.pick === 'Eric Shaffer is the one teaching CS 124 in Spring 2027 with 10 or more student ratings: 3.8 of 5 overall from 30 ratings.', 'the pick: the highest rated of those teaching it next term', cs.pick);
  expect(cs.caveat === P.RATINGS_CAVEAT && (JSON.stringify(cs).match(/self-selected/g) ?? []).length === 2, 'the caveat once (and the note), not once per professor');
  const mine = P.professorRatingsResult(FILE, { code: 'CS 124' }, ['Craig Zilles', 'Grace Hopper', 'Eric Shaffer'], [], { schedule: sched([{ name: 'Eric Shaffer', terms: ['Spring 2027'] }]), chosen: 'Craig Zilles' });
  expect(mine.professors[0].asked === 'Craig Zilles' && mine.highest_rated === 'Eric Shaffer', "the student's own instructor comes first; the pick is still the ratings'");
  const educ = P.professorRatingsResult(FILE, { code: 'EDUC 100' }, ['Thelma Sanders Bustle', 'Cynthia Rippe'], [], { schedule: sched([{ name: 'Thelma Sanders Bustle', terms: ['Spring 2027'] }, { name: 'Cynthia Rippe', terms: ['Spring 2027'] }]) });
  expect(order(educ) === 'Cynthia Rippe, Thelma Sanders Bustle' && educ.highest_rated === 'Cynthia Rippe' && educ.pick === 'Cynthia Rippe is the one teaching EDUC 100 in Spring 2027 with 10 or more student ratings: 4.5 of 5 overall from 20 ratings.', '4.8 from 6 ratings does not outrank 4.5 from 20: the pick rests on 10 ratings or more when anyone has them', educ.pick);
  const TIED = { ...FILE, profiles: [...FILE.profiles, { id: 99, first: 'Ada', last: 'Byron', dept: 'Computer Science', rating: 4.1, difficulty: 3, again: 70, count: 20, url: 'https://www.ratemyprofessors.com/professor/99' }] };
  const tie = P.professorRatingsResult(TIED, { code: 'CS 124' }, ['Ada Byron', 'Geoffrey Challen'], [], { schedule: sched([{ name: 'Ada Byron', terms: ['Spring 2027'] }, { name: 'Geoffrey Challen', terms: ['Spring 2027'] }]) });
  expect(tie.highest_rated === 'Geoffrey Challen' && /Geoffrey Challen is rated highest: 4\.1 of 5 overall from 52 ratings\. Ada Byron is level \(4\.1 of 5 overall from 20 ratings\)\.$/.test(tie.pick), 'a tie says so; more ratings goes first', tie.pick);
  const later = P.professorRatingsResult(FILE, { code: 'CS 124' }, ['Grace Hopper', 'Geoffrey Challen'], [], { schedule: sched([{ name: 'Grace Hopper', terms: ['Spring 2027'] }, { name: 'Geoffrey Challen', terms: ['Fall 2026'] }]) });
  expect(later.pick === 'No one teaching CS 124 in Spring 2027 has 5 or more student ratings; of its other instructors with 10 or more, Geoffrey Challen is rated highest: 4.1 of 5 overall from 52 ratings.', "no one rated next term: the pick says so, then gives the other terms' highest", later.pick);
  const notNext = P.professorRatingsResult(FILE, { code: 'CS 124' }, ['Geoffrey Challen'], [], { schedule: sched([{ name: 'Geoffrey Challen', terms: ['Fall 2026'] }]) });
  expect(notNext.teaching_that_term === 0 && /^No one on UGA's Schedule of Classes \(Spring 2026 to Summer 2027\) teaches CS 124 in Spring 2027; teaches gives the terms/.test(notNext.schedule_note), 'no one scheduled next term: schedule_note says so');
  const none = P.professorRatingsResult(FILE, { code: 'HIST 2301' }, [], [], { schedule: sched([]) });
  expect(none.ok && none.professors.length === 0 && /^No one on UGA's Schedule of Classes \(Spring 2026 to Summer 2027\) teaches HIST 2301, and no syllabus names an instructor for it\./.test(none.note) && /Never ask the student to look an instructor up/.test(none.note) && !/ask the student which/.test(none.note), 'a course no schedule term and no syllabus names anyone for: says no one is scheduled, never asks the student to find a name', none.note);
  expect(/ask the student which professor they mean/.test(P.professorRatingsResult(FILE, { code: 'HIST 2301' }, []).note), 'with no schedule at all, it still asks which professor');
  const sylOnly = P.professorRatingsResult(FILE, { code: 'CS 124' }, ['Geoffrey Challen'], [], { schedule: sched([]) });
  expect(/^No one on UGA's Schedule of Classes .* teaches CS 124: these names are from its syllabi/.test(sylOnly.schedule_note) && sylOnly.professors[0].status === 'found', "on no schedule term, a syllabus's names still get their ratings, said to be the syllabi's");
  const typed = P.professorRatingsResult(FILE, { name: 'Shaffer', code: 'CS 124' }, ['Eric Shaffer'], [], { schedule: sched([{ name: 'Eric Shaffer', terms: ['Spring 2027'] }]) });
  const yang = P.professorRatingsResult(FILE, { name: 'Yang Liu', code: 'CHEM 102' }, ['Yi Liu'], [], { schedule: sched([{ name: 'Yi Liu', terms: ['Spring 2027'] }]) });
  expect(JSON.stringify(typed.professors[0].teaches) === '["Spring 2027"]' && yang.professors[0].teaches === undefined, "by name: the course's own person carries their terms; \"Yang Liu\" typed never takes the course's Yi Liu's");
  const many = Array.from({ length: 15 }, (_, i) => `Person${String.fromCharCode(97 + i)} Example`);
  const big = P.professorRatingsResult(FILE, { code: 'MATH 221' }, many, [], { schedule: sched(many.map((n) => ({ name: n, terms: ['Spring 2027'] }))) });
  expect(big.professors.length === 12 && big.more_instructors === 3 && big.teaching_that_term === 15 && /ratings point to no one/.test(big.pick) && big.highest_rated === null, 'a big course: 12 listed, the rest counted, and no pick without ratings');
  const all = [cs, mine, educ, tie, later, notNext, none, sylOnly, typed, yang, big].map((r) => JSON.stringify(r));
  expect(all.every((t) => !SITE.test(t) && !/https?:/.test(t)), 'no rundown names the site or links anything');
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Both bots ===\n');
{
  const ILL = { bot: 'ALMA', schoolName: 'University of Illinois Urbana-Champaign', schoolShort: 'Illinois' };
  const UGA = { bot: 'ARCH', schoolName: 'University of Georgia', schoolShort: 'UGA' };
  const req = (school) => R.advisorRequest({ model: 'claude-opus-5', ...school, board: 'Today: Monday, October 26, 2026.', messages: [{ role: 'user', content: 'What do students think of my professor?' }], now: new Date('2026-10-26T15:00:00Z') });
  const ill = req(ILL);
  const uga = req(UGA);
  const tool = A.ADVISOR_TOOLS.find((t) => t.name === 'professor_ratings');
  expect(tool && ill.tools.some((t) => t.name === 'professor_ratings') && uga.tools.some((t) => t.name === 'professor_ratings') && A.UGA_TOOL_NAMES.has('professor_ratings'), 'professor_ratings is a tool of ALMA and of ARCH');
  expect(JSON.stringify(Object.keys(tool.input_schema.properties)) === '["name","code"]' && !tool.input_schema.required, 'it takes a name, a course code, or both');
  expect(/numbers only/.test(tool.description) && /self-selected/.test(tool.description) && /no comments/.test(tool.description) && /not sure which professor/.test(tool.description) && /no student ratings found/.test(tool.description) && !/Illinois|UGA|Georgia/.test(JSON.stringify(tool)), 'its description says what the ratings are and names no school');
  expect(/With only a course it is a rundown of every instructor the planner knows for it \(the class schedule's, each with the terms it names them for/.test(tool.description) && /those teaching it in the term it leads with \(term\) first, and the pick, the highest rated of them/.test(tool.description) && /who teaches a course and who is rated best/.test(tool.description), "with a course alone it is the rundown: the schedule's instructors with their terms, the lead term's first, and the pick (2026-10-28)");
  const ALMA = ill.system[0].text;
  const ARCH = uga.system[0].text;
  const RULE = A.SHARED_ADVISOR_RULES.professorRatings;
  expect(ALMA.includes(RULE) && ARCH.includes(RULE), 'the professor-ratings rule is in both prompts, word for word');
  for (const [what, re] of [
    ['call professor_ratings', /call professor_ratings/],
    ['speak as the consensus, with the count, in numbers', /consensus of those student ratings, never as fact: give the numbers with the count \("based on 46 student ratings, students rate the professor 4\.4 of 5 overall, difficulty 3\.5 of 5, and 90% would take them again"\)/],
    ['at most one short caveat: self-selected, all of a professor\'s courses', /at most one short caveat per answer: that student ratings are self-selected and cover all of a professor's courses rather than this one/],
    ['never name or link the site', /Never name, link or list as a source the website the ratings come from; call them student ratings/],
    ['a course: the rundown itself, never asking the student for a name', /For a course, give the rundown yourself and never ask the student to look an instructor up: who teaches it in the tool's term, each one's numbers in a line \(at most four, the rest counted\), and the tool's pick as the clear pick by student ratings; when the tool says no one is scheduled, say that plainly/],
    ['too few under 5', /Under 5 ratings, say there are too few to say much/],
    ['no comments: email and office hours are not covered; never invent', /numbers only, with no comments: for anything else \(answering email, office hours[^)]*\) say the ratings do not cover that, and never invent or paraphrase what students wrote/],
    ['never good or bad, never insult', /Never call a professor good or bad yourself, and never insult or mock anyone/],
    ['no profile / not sure: say so, never guess', /no student ratings found or not sure which professor, say exactly that and never guess/],
  ]) expect(re.test(RULE), `the rule: ${what}`);
  const shown = { ALMA, ARCH, 'ALMA tools': JSON.stringify(ill.tools), 'ARCH tools': JSON.stringify(uga.tools), rule: RULE, note: P.ratingsNote(FILE) };
  const naming = Object.entries(shown).filter(([, t]) => SITE.test(t)).map(([k]) => k);
  expect(naming.length === 0, 'neither prompt, no tool of either bot, the rule nor the note names Rate My Professors (2026-10-27)', naming.join(', '));
  // The owner's rule, as one assertion over everything the model is given: no "Rate My Professors", "RateMyProfessors" or "ratemyprofessors.com".
  const given = [ALMA, ARCH, JSON.stringify(ill.tools), JSON.stringify(uga.tools), JSON.stringify(A.ugaAdvisorTools()), P.ratingsNote(FILE), P.RATINGS_CAVEAT];
  expect(given.every((t) => !t.includes('Rate My Professors') && !t.includes('RateMyProfessors') && !t.toLowerCase().includes('ratemyprofessors.com')), 'no prompt or tool text contains "Rate My Professors", "RateMyProfessors" or "ratemyprofessors.com"');
  expect(/The official teaching signal is the university's own Teachers Ranked as Excellent lists/.test(ALMA) && /Student ratings \(professor_ratings\) are unofficial and come second: give the list first/.test(ALMA), "ALMA: Illinois's Teachers Ranked as Excellent lists stay the official signal");
  expect(/- Grade history: not loaded for UGA/.test(ARCH) && /Student ratings of professors are loaded \(professor_ratings\): they describe a professor across all their courses, not a course or a term/.test(ARCH) && !/teaching ratings: none are loaded/.test(ARCH) && !/Teachers Ranked as Excellent/.test(ARCH), 'ARCH: grade history is not loaded, student ratings are, and they describe a professor, not a course or a term; no Illinois list');
  const ws = readFileSync(join(HERE, '..', '..', 'components', 'planner', 'planner-workspace.tsx'), 'utf8');
  expect(/case 'professor_ratings': \{/.test(ws) && /professorRatingsResult\(file, \{ name: str\('name'\)/.test(ws), 'the planner screen answers professor_ratings');
  expect((ws.match(/withStudentRatings\(\{/g) ?? []).length === 3 && /await loadProfessorRatings\('uga'\), c\.code\)/.test(ws) && /await loadProfessorRatings\('illinois'\), c\.code, \(\) =>/.test(ws) && /ratingSchool \? await loadProfessorRatings\(ratingSchool\) : null, undefined, \(code\) => gradeNames\.get\(code\)/.test(ws), "course_syllabus (both schools) and term_syllabi carry student_ratings");
  const noDegree = ws.slice(ws.indexOf('if (!L.loaded) {'), ws.indexOf("return { ok: false, reason: 'No degree is selected."));
  expect(/if \(name === 'professor_ratings'\) \{/.test(noDegree) && /professorRatingsResult\(await loadProfessorRatings\(ratingSchool\)/.test(noDegree), 'it answers on a board with no degree too (an open plan)');
  // 2026-10-28: at UGA both read the course's Schedule of Classes instructors and lead with the term that matters.
  const input = ws.slice(ws.indexOf('async function ugaRatingsInput('), ws.indexOf('async function instructorChoices('));
  expect(/const options = instructorOptions\(\[\], syllabi, scheduled\.instructors\);/.test(input) && /term: own \?\? nextRegistrationTerm\(scheduled\.file\)/.test(input) && /source: `UGA's Schedule of Classes \(\$\{termSpan\(scheduled\.file\)\}\)`/.test(input), "the screen's UGA input: the schedule's instructors with their terms, then the syllabi's, led by the course's own term or the next one students register for");
  expect(/\(\{ names, schedule \} = await ugaRatingsInput\(c\.code, at\?\.label \?\? null\)\);/.test(ws) && /names, fuller, \{ schedule, chosen \}\);/.test(ws) && /await ugaRatingsInput\(c\.code, null\)/.test(noDegree) && /names, \[\], \{ schedule \}\);/.test(noDegree), 'professor_ratings hands that in, with or without a degree; Illinois hands in its published sections the same way');
  const ui = readFileSync(join(HERE, '..', '..', 'components', 'planner', 'advisor.tsx'), 'utf8');
  expect(/case 'professor_ratings':/.test(ui), 'the chat shows a line while it reads the ratings');
  const label = ui.slice(ui.indexOf("case 'professor_ratings':"), ui.indexOf("case 'find_clubs':"));
  expect(/Reading student ratings/.test(label) && !SITE.test(label), 'that line says student ratings and names no site');
  expect(/seen\.has\(source\.url\) \|\| \/\(\^\|\\\.\)ratemyprofessors\\\.com\$\/i\.test\(source\.host/.test(ui), "the chat's links skip the site, even from a chat saved before 2026-10-27");
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. The shipped files ===\n');
{
  const ROOT = join(HERE, '..', '..');
  for (const [school, rated, min] of [['uga', 5414, 0.5], ['illinois', 4373, 0.4]]) {
    const f = JSON.parse(readFileSync(join(ROOT, 'public', school, 'professor-ratings.json'), 'utf8'));
    const keys = new Set(f.profiles.flatMap((p) => Object.keys(p)));
    const bad = f.profiles.filter((p) => !(p.count > 0 && p.rating >= 1 && p.rating <= 5 && p.difficulty >= 1 && p.difficulty <= 5 && (p.again === null || (p.again >= 0 && p.again <= 100)) && p.url === `https://www.ratemyprofessors.com/professor/${p.id}` && p.first && p.last));
    const merged = f.profiles.reduce((s, p) => s + (p.merged?.length ?? 0), 0);
    expect(f.school === school && f.source === 'Rate My Professors' && f.collectedAt === '2026-10-25' && f.profiles.length + merged === rated && bad.length === 0, `${school}: ${f.profiles.length} rated profiles (${merged} duplicates merged into others), each with sane numbers and its link`, `${f.profiles.length}+${merged} vs ${rated}; bad ${bad.length}`);
    expect([...keys].every((k) => ['id', 'first', 'last', 'dept', 'rating', 'difficulty', 'again', 'count', 'url', 'merged', 'sameInitial'].includes(k)), `${school}: names, departments, numbers and links only (no review text)`, [...keys].join());
    const c = f.coverage;
    expect(c && c.found / c.instructors >= min, `${school}: ${c.found} of ${c.instructors} syllabus instructors matched (${Math.round((c.found / c.instructors) * 100)}%), ${c.not_sure} not sure, ${c.none} with no profile, ${c.needs_first_name} named by last name only`);
  }
  const ill = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'professor-ratings.json'), 'utf8'));
  const uga = JSON.parse(readFileSync(join(ROOT, 'public', 'uga', 'professor-ratings.json'), 'utf8'));
  const id = (file, name, subject) => { const m = P.matchProfessor(file, name, subject); return m.status === 'found' ? `${m.profile.first} ${m.profile.last}|${m.profile.dept}` : m.status; };
  expect(id(ill, 'Margaret M Fleck', 'ECE') === 'Margaret Fleck|Computer Science' && id(ill, 'Volodymyr Kindratenko', 'ECE') === 'Volodymyr Kindratenko|Engineering', 'Illinois: syllabus names find their profiles (ECE 448, ECE 408)');
  // ECE 478 (cross-listed with CS 477) has only its sections' "Singh, G"; CS 477's grade history names Gagandeep Singh.
  expect(id(ill, 'Singh, G', 'ECE') === 'unsure' && id(ill, 'Singh, Gagandeep', 'CS') === 'none' && id(ill, 'Singh, G', 'CS') === 'unsure', 'Illinois: "Singh, G" in ECE 478 is not the one rated Singh G (Guarav Singh), since the school also has a Gagandeep Singh');
  const ece478 = P.professorRatingsResult(ill, { code: 'ECE 478' }, ['Parthasarathy, M', 'Singh, G'], []);
  const term478 = P.withStudentRatings({ ok: true, courses: [{ code: 'ECE 478', instructors: [{ instructor: 'Parthasarathy, M' }, { instructor: 'Singh, G' }] }] }, ill);
  expect(ece478.professors[1].status === 'not sure which professor' && !/Guarav/.test(JSON.stringify(ece478)) && !term478.courses[0].instructors[1].student_ratings, 'Illinois: professor_ratings and term_syllabi give ECE 478 no rating for Singh, G');
  expect(id(ill, 'Kim, K', 'ES') === 'unsure' && id(ill, 'Kim, K', 'NPRE') === 'unsure' && id(ill, 'Kim, Kyekyoon', 'ECE') === 'Kyekyoon Kim|Engineering' && id(ill, 'Liu, X', 'ASTR') === 'unsure', 'Illinois: "Kim, K" (ES 470, NPRE 498) is not sure while Kyu Jung Kim taught NPRE 470; the full name still finds Kyekyoon Kim; "Liu, X" in ASTR beside Xin Liu likewise');
  const initialOnly = ill.profiles.filter((p) => p.sameInitial).length;
  expect(initialOnly > 100 && ill.profiles.every((p) => !p.sameInitial || (p.sameInitial.length > 0 && p.sameInitial.every((o) => typeof o === 'string' && o !== `${p.first} ${p.last}`))), `Illinois: ${initialOnly} profiles share their last name and initial with another person in the grade history or syllabi`);
  const philpott = ill.profiles.find((p) => p.last === 'Philpott');
  expect(philpott && philpott.merged?.length === 1 && philpott.count === 46, "Illinois: Mike Philpott's Engineering and Mechanical Engineering profiles are one", JSON.stringify(philpott?.merged));
  expect(id(uga, 'Dr. Ben Campbell', 'AAEC') === 'Benjamin Campbell|Agriculture' && id(uga, 'Rob Hawman', 'GEOL') === 'Robert Hawman|Geology', 'UGA: syllabus names find their profiles through nicknames (AAEC 3200, GEOL 4430)');
  expect(id(uga, 'James Anderson', null) === 'unsure' && id(uga, 'Samantha Hagood', null) === 'unsure' && id(uga, 'Samantha Hagood', 'SPAN') === 'Samantha Hagood|Spanish', 'UGA: one name with two profiles is not sure until a course settles it');
  // 2026-10-28: UGA's Schedule of Classes names each course's instructors (uga-offerings.ts), read the way
  // the planner screen reads them for professor_ratings (ugaRatingsInput): the schedule's, then the syllabi's.
  const I = await import(join(HERE, 'instructors.ts'));
  const O = await import(join(HERE, 'uga-offerings.ts'));
  const offerings = JSON.parse(readFileSync(join(ROOT, 'public', 'uga', 'course-offerings.json'), 'utf8'));
  const ugaSyllabi = (code) => {
    try { return JSON.parse(readFileSync(join(ROOT, 'public', 'uga', 'syllabi', `${code.split(' ')[0]}.json`), 'utf8')).courses[code] ?? []; } catch { return []; }
  };
  const rundown = (code) => {
    const options = I.instructorOptions([], ugaSyllabi(code), O.instructorsFor(offerings, code).map((i) => ({ name: i.name, terms: i.terms })));
    const schedule = { source: `UGA's Schedule of Classes (${O.termSpan(offerings)})`, term: O.nextRegistrationTerm(offerings), teaches: options.flatMap((o) => (o.scheduledTerms ? [{ name: o.name, terms: o.scheduledTerms }] : [])) };
    const names = options.map((o) => o.name);
    return { names, r: P.professorRatingsResult(uga, { code }, names, [], { schedule }) };
  };
  expect(O.nextRegistrationTerm(offerings) === 'Spring 2027' && O.termSpan(offerings) === 'Spring 2026 to Summer 2027', 'UGA: the schedule covers Spring 2026 to Summer 2027, and students register next for Spring 2027');
  const math = rundown('MATH 2250');
  const lead = math.r.professors.filter((p) => p.teaches?.includes('Spring 2027'));
  expect(math.names.length >= 40 && math.r.teaching_that_term >= 20 && math.r.professors.length === 12 && lead.length === 12 && math.r.more_instructors === math.names.length - 12 && math.r.highest_rated === 'Erik Miller' && /^Of those teaching MATH 2250 in Spring 2027 with 10 or more student ratings, Erik Miller is rated highest/.test(math.r.pick), `UGA MATH 2250: ${math.names.length} instructors go to the tool, ${math.r.teaching_that_term} teach it in Spring 2027 and lead the rundown; the pick is ${math.r.highest_rated}`, math.r.pick);
  const csci = rundown('CSCI 1302');
  expect(['Michael Cotterell', 'Bradley Barnes', 'Khoa Le', 'Jack Bass', 'Krzysztof Kochut'].every((n) => csci.names.includes(n)) && csci.r.teaching_that_term === 3 && csci.r.professors.slice(0, 3).map((p) => p.asked).join() === 'Michael Cotterell,Bradley Barnes,Khoa Le' && csci.r.highest_rated === 'Michael Cotterell' && /Bradley Barnes is level/.test(csci.r.pick), `UGA CSCI 1302: ${csci.names.length} instructors go to the tool, the three teaching Spring 2027 first; Cotterell and Barnes level at 4.4, Khoa Le's 5.0 from 5 ratings not the pick`, csci.r.pick);
  const hist = rundown('HIST 2301');
  expect(O.termsOffered(offerings, 'HIST 2301').length === 0 && hist.names.length === 0 && hist.r.professors.length === 0 && /^No one on UGA's Schedule of Classes \(Spring 2026 to Summer 2027\) teaches HIST 2301/.test(hist.r.note) && /Never ask the student to look an instructor up/.test(hist.r.note), 'UGA HIST 2301: on no term of the schedule and named on no syllabus, so ARCH is told to say no one is scheduled, never to ask the student for a name');
  const hist2111 = rundown('HIST 2111');
  expect(hist2111.names.length >= 8 && hist2111.r.teaching_that_term >= 3 && hist2111.r.professors.slice(0, hist2111.r.teaching_that_term).every((p) => p.teaches?.includes('Spring 2027')) && typeof hist2111.r.highest_rated === 'string', `UGA HIST 2111, the history course that does run: ${hist2111.names.length} instructors, ${hist2111.r.teaching_that_term} in Spring 2027; the pick is ${hist2111.r.highest_rated}`);
  expect([math, csci, hist, hist2111].every(({ r }) => !SITE.test(JSON.stringify(r)) && !/https?:/.test(JSON.stringify(r))), 'none of them names the site or links anything');
  // Schedule names against the ratings (2026-10-28): every name and subject the schedule pairs, precision first.
  const pairs = new Map();
  const roster = new Map();
  for (const [code, byTerm] of Object.entries(offerings.courses)) {
    for (const o of Object.values(byTerm)) {
      for (const [name] of o.instructors ?? []) {
        const subject = code.split(' ')[0];
        if (!pairs.has(`${name}|${subject}`)) pairs.set(`${name}|${subject}`, { name, subject });
        const n = I.readInstructorName(name);
        if (n) roster.set(`${n.last}|${n.initial}`, new Set([...(roster.get(`${n.last}|${n.initial}`) ?? []), n.display]));
      }
    }
  }
  const tally = { found: 0, unsure: 0, none: 0, needs_first_name: 0 };
  const loose = [];
  let onInitial = 0;
  for (const { name, subject } of pairs.values()) {
    const m = P.matchProfessor(uga, name, subject);
    tally[m.status] += 1;
    if (m.status !== 'found' || m.on !== 'initial') continue;
    onInitial += 1;
    const n = I.readInstructorName(name);
    if ([...(roster.get(`${n.last}|${n.initial}`) ?? [])].some((d) => d !== n.display)) loose.push(`${name} (${subject})`);
  }
  expect(tally.found / pairs.size > 0.4 && loose.length === 0, `UGA schedule: ${pairs.size} names by subject, ${tally.found} (${Math.round((tally.found / pairs.size) * 100)}%) rated surely, ${tally.unsure} not sure, ${tally.none} with no ratings; of the ${onInitial} matched on an initial, none has a namesake on the schedule`, loose.join(', '));
  // The 200-name sample the owner's report gives: one subject per distinct name, in a fixed hashed order.
  const hash = (t) => { let x = 2166136261; for (const ch of t) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; };
  const firstSeen = new Map();
  for (const pr of pairs.values()) if (!firstSeen.has(pr.name)) firstSeen.set(pr.name, pr);
  const sample = [...firstSeen.values()].sort((a, b) => hash(a.name) - hash(b.name)).slice(0, 200).map((pr) => P.matchProfessor(uga, pr.name, pr.subject).status);
  const hits = sample.filter((x) => x === 'found').length;
  expect(sample.length === 200 && hits >= 80, `UGA schedule, a 200-name sample: ${hits} rated surely (${Math.round(hits / 2)}%), ${sample.filter((x) => x === 'unsure').length} not sure, ${sample.filter((x) => x === 'none').length} with no student ratings`);
  // Plans must not change: nothing the planner builds a board with reads the ratings.
  const readers = readdirSync(HERE).filter((f) => f.endsWith('.ts') && f !== 'professor-ratings.ts' && /from '\.\/professor-ratings'/.test(readFileSync(join(HERE, f), 'utf8')));
  expect(readers.length === 0, 'no planner module reads the ratings; only the advisor tools in the planner screen do', readers.join(', '));
}

console.log(failures === 0 ? '\nALL PROFESSOR RATINGS CHECKS PASSED\n' : `\n${failures} PROFESSOR RATINGS CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
