/**
 * Student ratings from Rate My Professors (professor-ratings.ts), checked
 * without calling the API.
 *
 *   1. matching: accents, case, "Last, First", middle names and initials,
 *      nicknames, two-part last names; a first initial alone only when one
 *      profile at the school fits it and the course's department confirms it;
 *      two profiles of one name settled by the course's department, or "not
 *      sure"; obvious duplicate profiles merged, others kept apart;
 *   2. the consensus words at each threshold, always with the count, the
 *      caveats and the link;
 *   3. what the tools return: professor_ratings by name or by course, and
 *      student_ratings on syllabus instructor entries only where a profile
 *      surely matches;
 *   4. the tool for both bots and the rules in both prompts;
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
  expect(P.fullerName('Challen, G', ['Challen, Geoffrey', 'Smith, John']) === 'Challen, Geoffrey' && P.fullerName('Challen, G', ['Challen, Geoffrey', 'Challen, Gary']) === 'Challen, G' && P.fullerName('Geoffrey Challen', ['Challen, Gary']) === 'Geoffrey Challen', 'a fuller name the planner also holds is used when exactly one fits');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. The consensus, in words ===\n');
{
  const p = (count, rating, difficulty, again) => ({ id: 1, first: 'Ada', last: 'Lovelace', dept: 'Mathematics', rating, difficulty, again, count, url: 'https://www.ratemyprofessors.com/professor/1' });
  const c = (...a) => P.ratingConsensus(p(...a));
  const always = (s) => s.includes('Rate My Professors') && s.includes('self-selected') && s.includes("all of Ada Lovelace's courses") && s.includes('no written comments') && s.includes('https://www.ratemyprofessors.com/professor/1');
  const few = c(4, 5, 1, 100);
  expect(/^Only 4 student ratings on Rate My Professors, too few to say much\./.test(few) && !/highly|hard|easier|again/.test(few) && always(few), 'under 5 ratings: too few to say much, and nothing more', few);
  expect(/^Only 1 student rating on/.test(c(1, 3, 3, null)), 'one rating is "1 student rating"');
  expect(/^Based on only 5 student ratings/.test(c(5, 3, 3, null)) && /^Based on 10 student ratings/.test(c(10, 3, 3, null)) && /^Based on many student ratings \(30\) on Rate My Professors: /.test(c(30, 3, 3, null)), '5-9 "only N", 10-29 "N", 30+ "many (N)"');
  expect(/rate Ada Lovelace highly overall \(4\.0 of 5\)/.test(c(20, 4.0, 3, null)) && /rate Ada Lovelace well overall \(3\.5 of 5\)/.test(c(20, 3.5, 3, null)) && /: overall ratings of Ada Lovelace are mixed \(2\.6 of 5\)/.test(c(20, 2.6, 3, null)) && /rate Ada Lovelace low overall \(2\.5 of 5\)/.test(c(20, 2.5, 3, null)), 'overall: 4.0+ highly, 3.5-3.9 well, 2.6-3.4 mixed, 2.5 or lower low');
  expect(/; the classes are rated hard \(difficulty 4\.0 of 5\)/.test(c(20, 3, 4.0, null)) && /are rated moderately hard \(difficulty 3\.0/.test(c(20, 3, 3.0, null)) && /are rated about average in difficulty \(difficulty 2\.5/.test(c(20, 3, 2.5, null)) && /are rated on the easier side \(difficulty 2\.4/.test(c(20, 3, 2.4, null)), 'difficulty: 4.0+ hard, 3.0-3.9 moderately hard, 2.5-2.9 about average, under 2.5 easier');
  expect(/most \(80%\) say they would take the professor again/.test(c(20, 3, 3, 80)) && /fewer than half \(49%\) say/.test(c(20, 3, 3, 49)) && /, and 65% say they would take/.test(c(20, 3, 3, 65)) && !/take the professor again/.test(c(20, 3, 3, null)), 'would take again: 80%+ most, under 50% fewer than half, else the percent; left out when the site shows none');
  for (const s of [c(5, 4.5, 4.5, 90), c(40, 1.5, 1.5, 10), c(12, 3, 3, null)]) expect(always(s) && !/\b(good|bad|great|terrible|awful|best|worst)\b/i.test(s), 'every sentence has the count, the caveats and the link, and calls no one good or bad', s);
  expect(P.ratingWords(p(4, 5, 1, 100)) === 'too few ratings to say much' && P.ratingWords(p(20, 4.2, 4.1, 85)) === 'rated highly; classes rated hard; most (85%) would take again' && P.ratingWords(p(20, 3.0, 2.0, null)) === 'mixed ratings; classes rated on the easier side', 'the short words for syllabus entries');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. What the tools return ===\n');
{
  const byName = P.professorRatingsResult(FILE, { name: 'James Anderson', code: 'chem 102' });
  const hit = byName.professors?.[0];
  expect(byName.ok && byName.course === 'CHEM 102' && hit.status === 'found' && hit.professor === 'James Anderson' && hit.ratings === 38 && hit.listed_under === 'Chemistry' && /Based on many student ratings \(38\)/.test(hit.consensus) && hit.profile.endsWith('/2'), 'by name and course: the profile the course settles, with the consensus and link');
  expect(byName.sources?.length === 1 && byName.sources[0].url === hit.profile && /on Rate My Professors$/.test(byName.sources[0].title), 'the profile link goes under the reply as a source');
  expect(/self-selected/.test(byName.note) && /never add what students wrote/.test(byName.note) && /email, office hours/.test(byName.note), 'the note says what the numbers are and are not');
  const amb = P.professorRatingsResult(FILE, { name: 'James Anderson' });
  expect(amb.professors[0].status === 'not sure which profile' && amb.professors[0].profiles_listed_under.length === 2 && amb.sources.length === 0, 'by name alone, two profiles: not sure which profile, with no link');
  const none = P.professorRatingsResult(FILE, { name: 'Grace Hopper' });
  expect(none.professors[0].status === 'no profile found' && /says nothing about the professor/.test(none.professors[0].why), 'no profile: says so, and that it says nothing about the professor');
  const last = P.professorRatingsResult(FILE, { name: 'Challen', code: 'CS 124' }, ['Geoffrey Challen', 'Craig Zilles']);
  expect(last.professors[0].status === 'found' && last.professors[0].professor === 'Geoffrey Challen', "a last name with the course: the course's own instructor of that name");
  expect(P.professorRatingsResult(FILE, { name: 'Challen' }).professors[0].status === 'needs a first name or the course', 'a last name alone: asks for a first name or the course');
  const course = P.professorRatingsResult(FILE, { code: 'CS 124' }, ['Challen, G', 'Eric Shaffer', 'Grace Hopper'], ['Challen, Geoffrey']);
  expect(course.professors.map((p) => p.status).join() === 'found,found,no profile found' && course.professors[0].professor === 'Geoffrey Challen', "by course: every instructor, a section's initial read through the fuller name", course.professors.map((p) => p.status).join());
  expect(P.professorRatingsResult(FILE, {}).ok === false && P.professorRatingsResult(null, { name: 'x' }).ok === false, 'nothing asked, or no file: ok false with the reason');

  const syl = { ok: true, code: 'CS 124', by_instructor: [{ instructor: 'Geoffrey Challen' }, { instructor: 'Grace Hopper' }, { instructor: 'not named in the syllabus' }], syllabi: [{ instructors: ['Geoffrey Challen'] }] };
  const marked = P.withStudentRatings(syl, FILE, 'CS 124');
  expect(marked.by_instructor[0].student_ratings?.ratings === 52 && marked.by_instructor[0].student_ratings.words === 'rated highly; classes rated moderately hard; most (80%) would take again' && !marked.by_instructor[1].student_ratings && !marked.by_instructor[2].student_ratings && /student_ratings appears only where one profile surely matches/.test(marked.student_ratings_note), 'course_syllabus: student_ratings on the matched instructor only, with one note');
  expect(marked.syllabi === syl.syllabi && syl.by_instructor[0].student_ratings === undefined, 'the rest of the result is untouched, and the original is not changed');
  const term = { ok: true, courses: [{ code: 'CHEM 102', instructors: [{ instructor: 'James Anderson' }] }, { code: 'HIST 100', instructors: [{ instructor: 'James Anderson' }] }] };
  const t2 = P.withStudentRatings(term, FILE, undefined, (code) => (code === 'CHEM 102' ? [] : []));
  expect(t2.courses[0].instructors[0].student_ratings?.ratings === 38 && !t2.courses[1].instructors[0].student_ratings, "term_syllabi: each course's own department settles the profile, or none is attached");
  const nothing = { ok: true, code: 'X 1', by_instructor: [{ instructor: 'Grace Hopper' }] };
  expect(P.withStudentRatings(nothing, FILE, 'X 1') === nothing && P.withStudentRatings(syl, null, 'CS 124') === syl, 'no match, or no file: the result exactly as it was');
  const fewHit = P.instructorRatings({ ...FILE }, 'Thelma Sanders Bustle', 'EDUC 100');
  expect(fewHit && fewHit.words === 'rated highly; classes rated on the easier side; most (100%) would take again' && fewHit.overall === 4.8, 'six ratings carry their numbers');
  const tooFew = P.instructorRatings({ ...FILE, profiles: [{ ...profiles.find((p) => p.last === 'Challen'), count: 3 }] }, 'Geoffrey Challen', 'CS 124');
  expect(tooFew && tooFew.words === 'too few ratings to say much' && tooFew.overall === undefined, 'under 5 ratings, a syllabus entry carries the count and "too few", not the numbers');
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
  expect(/numbers only/.test(tool.description) && /self-selected/.test(tool.description) && /no comments/.test(tool.description) && /not sure which profile/.test(tool.description) && !/Illinois|UGA|Georgia/.test(JSON.stringify(tool)), 'its description says what the ratings are and names no school');
  const ALMA = ill.system[0].text;
  const ARCH = uga.system[0].text;
  const RULE = A.SHARED_ADVISOR_RULES.professorRatings;
  expect(ALMA.includes(RULE) && ARCH.includes(RULE), 'the professor-ratings rule is in both prompts, word for word');
  for (const [what, re] of [
    ['call professor_ratings', /call professor_ratings/],
    ['speak as the consensus, with the count', /consensus of those student ratings, never as fact: give the consensus words with the count/],
    ['self-selected, all of the professor\'s courses, the link', /self-selected and cover all of the professor's courses rather than this one, and link the profile/],
    ['too few under 5', /Under 5 ratings, say there are too few to say much/],
    ['no comments: email and office hours are not covered; never invent', /numbers only, with no comments: for anything else \(answering email, office hours[^)]*\) say the ratings do not cover that, and never invent or paraphrase what students wrote/],
    ['never good or bad, never insult', /Never call a professor good or bad yourself, and never insult or mock anyone/],
    ['no profile / not sure: say so, never guess', /no profile found or not sure which profile, say exactly that and never guess/],
  ]) expect(re.test(RULE), `the rule: ${what}`);
  expect(!/Never cite RateMyProfessors/.test(ALMA) && !/Never cite RateMyProfessors/.test(ARCH), 'neither prompt forbids Rate My Professors any more');
  expect(/The official teaching signal is the university's own Teachers Ranked as Excellent lists/.test(ALMA) && /Student ratings from Rate My Professors \(professor_ratings\) are unofficial and come second: give the list first/.test(ALMA), "ALMA: Illinois's Teachers Ranked as Excellent lists stay the official signal");
  expect(/Student ratings of professors from Rate My Professors \(professor_ratings\) describe a professor across all their courses, not a course or a term/.test(ARCH) && !/Teachers Ranked as Excellent/.test(ARCH), 'ARCH: the ratings describe a professor, not a course or a term; no Illinois list');
  const ws = readFileSync(join(HERE, '..', '..', 'components', 'planner', 'planner-workspace.tsx'), 'utf8');
  expect(/case 'professor_ratings': \{/.test(ws) && /professorRatingsResult\(file, \{ name: str\('name'\)/.test(ws), 'the planner screen answers professor_ratings');
  expect((ws.match(/withStudentRatings\(\{/g) ?? []).length === 3 && /await loadProfessorRatings\('uga'\), c\.code\)/.test(ws) && /await loadProfessorRatings\('illinois'\), c\.code, \(\) =>/.test(ws) && /ratingSchool \? await loadProfessorRatings\(ratingSchool\) : null, undefined, \(code\) => gradeNames\.get\(code\)/.test(ws), "course_syllabus (both schools) and term_syllabi carry student_ratings");
  const noDegree = ws.slice(ws.indexOf('if (!L.loaded) {'), ws.indexOf("return { ok: false, reason: 'No degree is selected."));
  expect(/if \(name === 'professor_ratings'\) \{/.test(noDegree) && /professorRatingsResult\(await loadProfessorRatings\(ratingSchool\)/.test(noDegree), 'it answers on a board with no degree too (an open plan)');
  const ui = readFileSync(join(HERE, '..', '..', 'components', 'planner', 'advisor.tsx'), 'utf8');
  expect(/case 'professor_ratings':/.test(ui), 'the chat shows a line while it reads the ratings');
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
    expect([...keys].every((k) => ['id', 'first', 'last', 'dept', 'rating', 'difficulty', 'again', 'count', 'url', 'merged'].includes(k)), `${school}: names, departments, numbers and links only (no review text)`, [...keys].join());
    const c = f.coverage;
    expect(c && c.found / c.instructors >= min, `${school}: ${c.found} of ${c.instructors} syllabus instructors matched (${Math.round((c.found / c.instructors) * 100)}%), ${c.not_sure} not sure, ${c.none} with no profile, ${c.needs_first_name} named by last name only`);
  }
  const ill = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'professor-ratings.json'), 'utf8'));
  const uga = JSON.parse(readFileSync(join(ROOT, 'public', 'uga', 'professor-ratings.json'), 'utf8'));
  const id = (file, name, subject) => { const m = P.matchProfessor(file, name, subject); return m.status === 'found' ? `${m.profile.first} ${m.profile.last}|${m.profile.dept}` : m.status; };
  expect(id(ill, 'Margaret M Fleck', 'ECE') === 'Margaret Fleck|Computer Science' && id(ill, 'Volodymyr Kindratenko', 'ECE') === 'Volodymyr Kindratenko|Engineering', 'Illinois: syllabus names find their profiles (ECE 448, ECE 408)');
  const philpott = ill.profiles.find((p) => p.last === 'Philpott');
  expect(philpott && philpott.merged?.length === 1 && philpott.count === 46, "Illinois: Mike Philpott's Engineering and Mechanical Engineering profiles are one", JSON.stringify(philpott?.merged));
  expect(id(uga, 'Dr. Ben Campbell', 'AAEC') === 'Benjamin Campbell|Agriculture' && id(uga, 'Rob Hawman', 'GEOL') === 'Robert Hawman|Geology', 'UGA: syllabus names find their profiles through nicknames (AAEC 3200, GEOL 4430)');
  expect(id(uga, 'James Anderson', null) === 'unsure' && id(uga, 'Samantha Hagood', null) === 'unsure' && id(uga, 'Samantha Hagood', 'SPAN') === 'Samantha Hagood|Spanish', 'UGA: one name with two profiles is not sure until a course settles it');
  // Plans must not change: nothing the planner builds a board with reads the ratings.
  const readers = readdirSync(HERE).filter((f) => f.endsWith('.ts') && f !== 'professor-ratings.ts' && /from '\.\/professor-ratings'/.test(readFileSync(join(HERE, f), 'utf8')));
  expect(readers.length === 0, 'no planner module reads the ratings; only the advisor tools in the planner screen do', readers.join(', '));
}

console.log(failures === 0 ? '\nALL PROFESSOR RATINGS CHECKS PASSED\n' : `\n${failures} PROFESSOR RATINGS CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
