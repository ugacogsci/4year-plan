/**
 * "My instructor" and syllabus answers by instructor, checked without a
 * browser or the API (2026-10-18).
 *
 * What this pins:
 *   1. names: every form the sources write ("Challen, G", "Dr. Amir
 *      Malvandi", "Clark, Malissa (17223) TR 2:55-4:15", "Rodríguez") reads
 *      as one clean person; placeholders ("TBA", "Determined, To") are no one;
 *   2. the picker's choices: a term's section instructors and the syllabi's
 *      names merged by last name (two initials stay two people), over every
 *      course in both schools' shipped shards;
 *   3. grouping: each instructor's syllabi, newest first, the chosen one
 *      first, co-taught syllabi under each instructor, unnamed ones last;
 *   4. the choice on the plan: set, cleared, carried over a rebuild, saved
 *      and read back with the board and its tabs; an old board without it
 *      loads exactly as it was written; a bad value is ignored;
 *   5. the tools on a made-up board, Illinois and UGA, with and without
 *      chosen instructors: course_syllabus's by_instructor and term_syllabi's
 *      course-by-course list, "senior year" and "this term" read right;
 *   6. the answer layout rule: shared by ALMA and ARCH, and ALMA's prompt
 *      otherwise unchanged (__advisor-request-uga.check.mjs pins the bytes);
 *   7. the chat draws the layout: bold course lines, list items with bold names;
 *   8. plans cannot change: the plan sweep's runtime imports reach none of
 *      the files this work changed (types.ts gains one optional type field
 *      and has no runtime code at all).
 *
 *   node lib/planner/__instructors.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const I = await import(join(HERE, 'instructors.ts'));
const S = await import(join(HERE, 'saved-board.ts'));
const A = await import(join(HERE, 'advisor.ts'));
const M = await import(join(HERE, 'chat-markdown.ts'));
const T = await import(join(HERE, 'section-terms.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const syllabiOf = (school, code) => {
  try {
    return json(`public/${school}/syllabi/${code.split(' ')[0]}.json`).courses[code] ?? [];
  } catch {
    return [];
  }
};
const meta = json('public/illinois/meta.json');
const shardCache = new Map();
const sectionsOf = (code, termId) => {
  const subject = code.split(' ')[0];
  if (!shardCache.has(subject)) shardCache.set(subject, json(`public/illinois/course/${subject}.json`));
  const shard = shardCache.get(subject);
  const rows = termId === meta.term.id ? shard.sections : (shard.sectionsByTerm?.[termId] ?? []);
  return rows.find((r) => r.code === code)?.sections ?? null;
};

// ---------------------------------------------------------------------------
console.log('\n=== 1. Names, as the sources write them ===\n');
{
  const cases = [
    ['Geoffrey Challen', 'Geoffrey Challen', 'challen'],
    ['Challen, G', 'G. Challen', 'challen'],
    ['Dr. Amir Malvandi', 'Amir Malvandi', 'malvandi'],
    ['Professor Andrew M. Smith', 'Andrew M. Smith', 'smith'],
    ['Callaway, Todd', 'Todd Callaway', 'callaway'],
    ['Clark, Malissa (17223) TR 2:55-4:15', 'Malissa Clark', 'clark'],
    ['Dolasinski, Lisa (15276, 38162, 46061, 54819)', 'Lisa Dolasinski', 'dolasinski'],
    ['Dixit, Heena (1st) PROD', 'Heena Dixit', 'dixit'],
    ['HANAWALT, CHRISTINA', 'Christina Hanawalt', 'hanawalt'],
    ['Sanders Bustle, Thelma', 'Thelma Sanders Bustle', 'bustle'],
    ['Joseph Watson, Jr.', 'Joseph Watson', 'watson'],
    ['Joe Allegra, Ph.D., MPH', 'Joe Allegra', 'allegra'],
    ['Jihee Kang-Holland, M.A.', 'Jihee Kang-Holland', 'kang-holland'],
    ['Wing Fung (Alfred) Chong', 'Wing Fung Chong', 'chong'],
    ['Rodríguez', 'Rodríguez', 'rodriguez'],
  ];
  const wrong = cases.filter(([raw, display, last]) => {
    const n = I.readInstructorName(raw);
    return !n || n.display !== display || n.last !== last;
  });
  expect(wrong.length === 0, `${cases.length} written forms read as one clean name each`, wrong.map(([raw]) => `${raw} -> ${JSON.stringify(I.readInstructorName(raw))}`).join('; '));
  const nobody = ['TBA, Instructor (33739) Tues/Thurs, 1:15 -', 'Determined, To (52083)', 'Staff', '', 'someone@illinois.edu'];
  expect(nobody.every((raw) => I.readInstructorName(raw) === null), 'placeholders are no one: TBA, "Determined, To", Staff, an address');
  expect(I.namesMatch('Challen', 'Geoffrey Challen') && I.namesMatch('Challen, G', 'Geoffrey Challen') && I.namesMatch('rodriguez', 'Luis F. Rodríguez'), 'a last name alone, a section\'s "Last, F" and a full name are the same person');
  expect(!I.namesMatch('Smith, A', 'Travis A. Smith'), 'two different first initials are two people');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. The picker: sections and syllabi, one entry per person ===\n');
{
  const cs460 = I.instructorOptions(I.teachingNames(sectionsOf('CS 460', 'fall-2026')), syllabiOf('illinois', 'CS 460'));
  const names = cs460.map((o) => o.name);
  expect(names.includes('Matthew E. Luallen') && names.includes("Casey W. O'Brien") && !names.some((n) => /^M\. Luallen|^C\. O'Brien/.test(n)), 'CS 460 Fall 2026: "Luallen, M" on the schedule and "Matthew E. Luallen" on the syllabi are one entry with the fuller name', names.join(', '));
  expect(cs460[0].teaching && cs460[1].teaching && cs460.slice(2).every((o) => !o.teaching), 'the two teaching Fall 2026 come first, then the syllabi\'s others', JSON.stringify(cs460));
  expect(cs460.find((o) => o.name === 'Matthew E. Luallen')?.syllabusTerms.join(',') === 'Fall 2026,Fall 2024,Fall 2023', "each option carries its syllabi's terms, newest first");
  const cs425spring = I.instructorOptions(I.teachingNames(sectionsOf('CS 425', 'spring-2027')), syllabiOf('illinois', 'CS 425'));
  expect(cs425spring[0].name === 'R. Mittal' && cs425spring[0].teaching && cs425spring.some((o) => o.name === 'Aishwarya Ganesan' && !o.teaching), "the card's own term decides who teaches: CS 425 in Spring 2027 is Mittal's, the Fall syllabi's names follow", cs425spring.map((o) => `${o.name}${o.teaching ? '*' : ''}`).join(', '));
  const acct = I.instructorOptions([], syllabiOf('uga', 'ACCT 2101'));
  expect(acct.map((o) => o.name).join(', ') === 'Grant Bischoff, Sarah Banghart' && acct.every((o) => !o.teaching), "UGA ACCT 2101: the syllabi's two instructors, no schedule (UGA has none loaded)", acct.map((o) => o.name).join(', '));

  // Every course both schools ship: one entry per person, every name clean.
  let courses = 0;
  let options = 0;
  const dupes = [];
  const dirty = [];
  for (const school of ['illinois', 'uga']) {
    const index = json(`public/${school}/syllabi/index.json`);
    const subjects = new Set(Object.keys(index.courses).map((c) => c.split(' ')[0]));
    for (const subject of subjects) {
      let shard;
      try { shard = json(`public/${school}/syllabi/${subject}.json`); } catch { continue; }
      for (const [code, list] of Object.entries(shard.courses)) {
        courses += 1;
        const opts = I.instructorOptions([], list);
        options += opts.length;
        const keys = opts.map((o) => I.readInstructorName(o.name)).map((n) => `${n.last}|${n.initial ?? ''}`);
        if (new Set(keys).size !== keys.length) dupes.push(`${code}: ${opts.map((o) => o.name).join(', ')}`);
        for (const o of opts) if (/\d|[()@]|^(dr|prof|professor)\b\.?/i.test(o.name) || /,/.test(o.name)) dirty.push(`${code}: ${o.name}`);
      }
    }
  }
  expect(courses > 6000 && options > 4000, `${courses} courses with syllabi in both schools offer ${options} instructors`);
  expect(dupes.length === 0, 'no course offers the same person twice', dupes.slice(0, 5).join(' | '));
  expect(dirty.length === 0, 'no offered name carries a title, a section number, a time or a comma', dirty.slice(0, 8).join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Syllabi grouped by instructor ===\n');
{
  const list = syllabiOf('illinois', 'CS 460');
  const groups = I.groupByInstructor(list, { teaching: I.teachingNames(sectionsOf('CS 460', 'fall-2026')) });
  const byName = new Map(groups.map((g) => [g.instructor, g]));
  expect(byName.get('Matthew E. Luallen')?.syllabi.length === 4 && byName.get("Casey W. O'Brien")?.syllabi.length === 4, "a co-taught syllabus sits under each of its instructors (CS 460's four under Luallen and O'Brien)");
  expect(groups.every((g) => g.syllabi.every((s, i, a) => i === 0 || I.syllabusTermRank(a[i - 1].term) >= I.syllabusTermRank(s.term))), "each instructor's syllabi run newest first");
  expect(byName.get('David M. Nicol')?.syllabi[0]?.termLabel === 'Fall 2024' && !byName.get('David M. Nicol')?.teaching, "Nicol's newest is Fall 2024, and he is not on the Fall 2026 schedule");
  const chosen = I.groupByInstructor(list, { teaching: ['Luallen, M', "O'Brien, C"], chosen: 'Nicol' });
  expect(chosen[0].instructor === 'David M. Nicol' && chosen[0].chosen && chosen.filter((g) => g.chosen).length === 1, 'the chosen instructor comes first, marked, and alone');
  const acct = I.groupByInstructor(syllabiOf('uga', 'ACCT 2101'), { chosen: 'Sarah Banghart' });
  expect(acct[0].instructor === 'Sarah Banghart' && acct[acct.length - 1].instructor === null && acct[acct.length - 1].syllabi.every((s) => s.kind === 'master-outline'), "UGA: the chosen instructor first, the Bulletin's undated outline (no instructor) last");
  const noSyllabus = I.groupByInstructor([], { teaching: ['Alawini, A'] });
  expect(noSyllabus.length === 1 && noSyllabus[0].instructor === 'A. Alawini' && noSyllabus[0].syllabi.length === 0 && noSyllabus[0].teaching, 'an instructor on the schedule with no syllabus is still listed, with none');
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. The choice on the plan, saved with the board ===\n');
// A made-up student's board: Illinois CS, Fall 2026 through Spring 2030.
const term = (id, label, year, season, courseIds) => ({ id, label, year, season, courseIds });
const ILL_BOARD = {
  schemaVersion: 1,
  programId: 'eng/cs-bs',
  graduationLabel: 'Spring 2030',
  completedCourseIds: [],
  terms: [
    term('fall-2026', 'Fall 2026', 1, 'Fall', ['c-cs425', 'c-cs460', 'c-cs411']),
    term('spring-2027', 'Spring 2027', 1, 'Spring', ['c-cs461']),
    term('fall-2029', 'Fall 2029', 4, 'Fall', ['c-cs460', 'c-cs411']),
    term('spring-2030', 'Spring 2030', 4, 'Spring', ['c-cs461', 'c-cs425']),
  ],
};
const CODE = { 'c-cs425': 'CS 425', 'c-cs460': 'CS 460', 'c-cs411': 'CS 411', 'c-cs461': 'CS 461' };
const TITLE = { 'CS 425': 'Distributed Systems', 'CS 460': 'Security Laboratory', 'CS 411': 'Database Systems', 'CS 461': 'Computer Security I' };
{
  expect(I.chosenInstructor(ILL_BOARD, 'fall-2026', 'CS 460') === null && !('instructors' in ILL_BOARD), 'a board with no choices: every course is "not sure yet"');
  let p = I.withInstructor(ILL_BOARD, 'fall-2026', 'cs 460', 'Matthew E. Luallen');
  p = I.withInstructor(p, 'spring-2030', 'CS 425', 'Someone Typed');
  expect(I.chosenInstructor(p, 'fall-2026', 'CS 460') === 'Matthew E. Luallen' && I.chosenInstructor(p, 'fall-2029', 'CS 460') === null, 'a choice belongs to its course in its term: CS 460 in Fall 2026, not in Fall 2029');
  expect(JSON.stringify(p.terms) === JSON.stringify(ILL_BOARD.terms) && p.programId === ILL_BOARD.programId, 'setting one changes nothing else on the plan');
  const cleared = I.withInstructor(I.withInstructor(p, 'fall-2026', 'CS 460', null), 'spring-2030', 'CS 425', null);
  expect(!('instructors' in cleared) && JSON.stringify(cleared) === JSON.stringify(ILL_BOARD), '"Not sure yet" clears it, and the last one cleared leaves the plan exactly as it was');
  const rebuilt = { ...ILL_BOARD, terms: [term('fall-2026', 'Fall 2026', 1, 'Fall', ['c-cs460']), term('spring-2030', 'Spring 2030', 4, 'Spring', ['c-cs461'])] };
  const carried = I.carryInstructors(p, rebuilt, (id) => CODE[id]);
  expect(I.chosenInstructor(carried, 'fall-2026', 'CS 460') === 'Matthew E. Luallen' && I.chosenInstructor(carried, 'spring-2030', 'CS 425') === null, 'a rebuild keeps the choice of a course still in its term and drops one whose course left');
  expect(I.chosenInstructor({ ...ILL_BOARD, instructors: 'oops' }, 'fall-2026', 'CS 460') === null && I.chosenInstructor({ ...ILL_BOARD, instructors: { 'fall-2026': ['x'] } }, 'fall-2026', 'CS 460') === null, 'a malformed saved value is ignored, never thrown on');

  // The saved board, as the device writes it and reads it back.
  const board = (plan) => ({ plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: false });
  const entry = (plan) => ({
    schemaVersion: 4, schoolId: 'illinois', programId: 'eng/cs-bs', savedAt: '2026-10-18T12:00:00.000Z',
    plans: [{ id: 'plan-1', name: 'Plan 1', groupId: 'group-1', plan, board: board(plan) }], activePlanId: 'plan-1',
    board: board(plan), settings: { minimumTermCredits: 12, targetTermCredits: null, careerInterests: '', careerCleared: false, priorities: {}, planShape: S.NO_SHAPE },
  });
  const old = S.parseSavedBoard(JSON.stringify(entry(ILL_BOARD)), 'illinois');
  expect(old && JSON.stringify(old.board.plan) === JSON.stringify(ILL_BOARD) && !('instructors' in old.board.plan) && JSON.stringify(old.plans[0].plan) === JSON.stringify(ILL_BOARD), 'an old board, saved before the field, loads exactly as it was written');
  const back = S.parseSavedBoard(S.serializeBoard(entry(p)), 'illinois');
  expect(I.chosenInstructor(back.board.plan, 'fall-2026', 'CS 460') === 'Matthew E. Luallen' && I.chosenInstructor(back.plans[0].plan, 'spring-2030', 'CS 425') === 'Someone Typed', 'the choices come back with the board and with its plan tab');
  // Export and share write `plan` as it is (planner-workspace exportPlan / sharePlan).
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  expect(/function exportPlan\(\) \{[\s\S]{0,400}\n\s+plan,\n/.test(ws) && /async function sharePlan\(\) \{[\s\S]{0,300}\n\s+plan,\n/.test(ws), 'export and share write the plan whole, so the choices go with them');
  const shared = JSON.parse(decodeURIComponent(atob(btoa(encodeURIComponent(JSON.stringify({ plan: p }))))));
  expect(I.chosenInstructor(shared.plan, 'fall-2026', 'CS 460') === 'Matthew E. Luallen', 'a shared link carries them');
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. The tools on a made-up board ===\n');
{
  const NOW = new Date('2026-10-18T16:00:00Z');
  const senior = I.resolveTerms(ILL_BOARD.terms, ['senior year'], NOW);
  expect(senior.terms.map((t) => t.label).join(', ') === 'Fall 2029, Spring 2030' && senior.unknown.length === 0, '"senior year" is the board\'s year 4: Fall 2029 and Spring 2030');
  expect(I.resolveTerms(ILL_BOARD.terms, ['this term'], NOW).terms.map((t) => t.label).join() === 'Fall 2026', '"this term" on October 18, 2026 is Fall 2026');
  expect(I.resolveTerms(ILL_BOARD.terms, ['next semester'], NOW).terms.map((t) => t.label).join() === 'Spring 2027', '"next semester" is Spring 2027');
  expect(I.resolveTerms(ILL_BOARD.terms, ['Spring 2030', 'Fall 2026'], NOW).terms.map((t) => t.label).join(', ') === 'Fall 2026, Spring 2030', 'named terms come back in board order');
  const three = { ...ILL_BOARD, terms: ILL_BOARD.terms.map((t) => ({ ...t, year: Math.min(t.year, 3) })) };
  expect(I.resolveTerms(three.terms, ['senior year'], NOW).terms.map((t) => t.label).join(', ') === 'Fall 2029, Spring 2030', 'a board with no year 4 answers "senior year" with its last year');
  expect(I.resolveTerms(ILL_BOARD.terms, ['Fall 2031'], NOW).unknown.join() === 'Fall 2031', 'a term not on the board is reported, not guessed');
  // A year of study is the student's own when the setup says which year they are in.
  expect(I.studyYearAtBoardStart('fourth', 'Fall 2026', NOW) === 4 && I.studyYearAtBoardStart('first', 'Fall 2026', NOW) === 1, 'the year the student gave is their year when a board starting this fall begins');
  expect(I.studyYearAtBoardStart('third', 'Fall 2027', new Date('2027-03-01T12:00:00Z')) === 4, 'a third-year in spring whose board starts next fall starts it in their fourth year');
  expect(I.studyYearAtBoardStart('', 'Fall 2026', NOW) === null && I.studyYearAtBoardStart(undefined, 'Fall 2026', NOW) === null, 'no year given: the board\'s own year numbers');
  const seniorBoard = { terms: [
    { id: 'fall-2026', label: 'Fall 2026', year: 1, season: 'Fall', courseIds: [] },
    { id: 'spring-2027', label: 'Spring 2027', year: 1, season: 'Spring', courseIds: [] },
  ] };
  const seniorNow = I.resolveTerms(seniorBoard.terms, ['senior year'], NOW, { studyYearAtStart: 4 });
  expect(seniorNow.terms.map((t) => t.label).join(', ') === 'Fall 2026, Spring 2027' && seniorNow.unknown.length === 0 && /fourth year/.test(seniorNow.notes.join()), 'a senior\'s "senior year" is the board\'s first year, and the note says why');
  const juniorPast = I.resolveTerms(seniorBoard.terms, ['junior year'], NOW, { studyYearAtStart: 4 });
  expect(juniorPast.terms.length === 0 && juniorPast.unknown.join() === 'junior year' && /behind them/.test(juniorPast.notes.join()), 'a year already behind the student is reported, not answered with another year');
  const threeYears = [1, 2, 3].flatMap((y) => [
    { id: `fall-${2025 + y}`, label: `Fall ${2025 + y}`, year: y, season: 'Fall', courseIds: [] },
    { id: `spring-${2026 + y}`, label: `Spring ${2026 + y}`, year: y, season: 'Spring', courseIds: [] },
  ]);
  const sophomore = I.resolveTerms(threeYears, ['senior year'], NOW, { studyYearAtStart: 2 });
  expect(sophomore.terms.map((t) => t.label).join(', ') === 'Fall 2028, Spring 2029', 'a sophomore\'s senior year is the board\'s third year');
  const fifth = I.resolveTerms(threeYears, ['fifth year'], NOW, { studyYearAtStart: 2 });
  expect(fifth.terms.length === 0 && /after the board's last term/.test(fifth.notes.join()), 'a year after the board ends is reported as after it');
  expect(I.resolveTerms(ILL_BOARD.terms, ['senior year'], NOW, { studyYearAtStart: 1 }).terms.map((t) => t.label).join(', ') === 'Fall 2029, Spring 2030', 'a first-year\'s senior year is the board\'s year 4, as before');
  expect(I.resolveTerms(seniorBoard.terms, ['senior year'], NOW, { studyYearAtStart: 5 }).terms.map((t) => t.label).join(', ') === 'Fall 2026, Spring 2027', 'a fifth-year student is still a senior: their senior year is now');
  expect(I.currentTermLabel(new Date('2027-02-01T12:00:00Z')) === 'Spring 2027' && I.currentTermLabel(new Date('2027-06-15T12:00:00Z')) === 'Summer 2027', 'the term in progress follows the date');

  // term_syllabi, the way the workspace handler builds its input.
  const inputsFor = (plan, terms) => terms.flatMap((t) => t.courseIds.map((id) => {
    const code = CODE[id];
    const pick = T.pickSectionTerm(meta.sectionTerms, { id: t.id, label: t.label });
    return {
      code, title: TITLE[code], termLabel: t.label, chosen: I.chosenInstructor(plan, t.id, code),
      teaching: I.teachingNames(sectionsOf(code, pick.term.id)), teachingTermLabel: pick.term.label !== t.label ? pick.term.label : null,
      syllabi: syllabiOf('illinois', code),
    };
  }));
  const open = I.termSyllabiResult(inputsFor(ILL_BOARD, senior.terms), ['attendance']);
  expect(open.map((c) => `${c.term} ${c.code}`).join(', ') === 'Fall 2029 CS 460, Fall 2029 CS 411, Spring 2030 CS 461, Spring 2030 CS 425', 'senior year, no instructor set: every course in those terms, in board order', open.map((c) => c.code).join(','));
  const c460 = open[0];
  expect(c460.chosen_instructor === null && c460.instructors.length >= 3 && c460.instructors.every((i) => 'attendance' in i && i.link && i.syllabus_term), 'each course lists every instructor, each with the attendance rule, its syllabus term and link', JSON.stringify(c460.instructors.map((i) => i.instructor)));
  expect(c460.instructors.every((i) => i.not_this_term === true) && c460.instructors.some((i) => i.teaches_in === 'Fall 2026'), 'a Fall 2029 course: every syllabus is marked not this term, and Fall 2026\'s teachers say so', JSON.stringify(c460.instructors.map((i) => [i.instructor, i.syllabus_term, i.teaches_in])));
  expect(!('grading' in c460.instructors[0]) && !('exams' in c460.instructors[0]), 'only the facts asked for (attendance), so a whole year stays small');
  expect(open[1].code === 'CS 411' && open[1].syllabus_found === false && open[1].teaching.length > 0, 'CS 411, with no syllabus found, is listed plainly (with who teaches it)');
  const size = JSON.stringify(open).length;
  expect(size < 12000, `the senior-year answer is ${size} characters`);

  let mine = I.withInstructor(ILL_BOARD, 'fall-2029', 'CS 460', 'Nicol');
  mine = I.withInstructor(mine, 'spring-2030', 'CS 425', 'Nobody Here');
  const set = I.termSyllabiResult(inputsFor(mine, senior.terms), ['attendance']);
  const s460 = set[0];
  expect(s460.chosen_instructor === 'Nicol' && s460.instructors.length === 1 && s460.instructors[0].instructor === 'David M. Nicol' && s460.instructors[0].chosen && s460.instructors[0].syllabus_term === 'Fall 2024' && /attendance required/i.test(s460.instructors[0].attendance ?? ''), 'with the instructor set, only that instructor: Nicol, his Fall 2024 syllabus, its attendance rule', JSON.stringify(s460));
  expect(s460.other_instructors.includes('Matthew E. Luallen'), 'the others are named, without their facts');
  const s425 = set[3];
  expect(s425.chosen_instructor === 'Nobody Here' && s425.chosen_has_syllabus === false && s425.instructors.length >= 2, 'an instructor set with no syllabus: said so, and every instructor found is given instead');
  const everything = I.termSyllabiResult(inputsFor(ILL_BOARD, [ILL_BOARD.terms[0]]), ['all']);
  expect(['grading', 'exams', 'final_exam', 'materials', 'late_work', 'makeups', 'other'].every((k) => k in everything[0].instructors[0]), '"all" gives every fact');

  // course_syllabus's new part.
  const cs = I.syllabiByInstructor(syllabiOf('illinois', 'CS 460'), { teaching: ['Luallen, M', "O'Brien, C"], chosen: 'Luallen', termLabel: 'Fall 2026' });
  expect(cs.chosen_instructor === 'Luallen' && cs.chosen_has_syllabus === true && cs.by_instructor[0].instructor === 'Matthew E. Luallen' && cs.by_instructor[0].chosen && cs.by_instructor[0].newest.term === 'Fall 2026' && cs.by_instructor[0].teaches_in === 'Fall 2026', 'course_syllabus: by_instructor, the chosen one first with its newest term and link');
  const csOpen = I.syllabiByInstructor(syllabiOf('illinois', 'CS 460'), { teaching: [], chosen: null, termLabel: null });
  expect(csOpen.chosen_instructor === null && csOpen.chosen_has_syllabus === null && csOpen.by_instructor.length === 4, 'with none set, every instructor, none marked');
  const shown = I.syllabiToShow(syllabiOf('illinois', 'CS 460'), { chosen: 'Nicol' });
  expect(shown.length === 4 && shown.some((s) => s.instructors.includes('David M. Nicol')), "the full syllabi it returns include the chosen instructor's");

  // UGA: the same tool, no schedule.
  const UGA_BOARD = { schemaVersion: 1, programId: 'uga-acct', graduationLabel: 'Spring 2030', completedCourseIds: [], terms: [term('fall-2026', 'Fall 2026', 1, 'Fall', ['u-acct', 'u-chem'])] };
  const ugaInputs = (plan) => [['u-acct', 'ACCT 2101', 'Principles of Financial Accounting'], ['u-chem', 'CHEM 2412', 'Organic Chemistry II']].map(([id, code, title]) => ({ code, title, termLabel: 'Fall 2026', chosen: I.chosenInstructor(plan, 'fall-2026', code), teaching: null, syllabi: syllabiOf('uga', code) }));
  const uOpen = I.termSyllabiResult(ugaInputs(UGA_BOARD), ['grading']);
  expect(uOpen[0].instructors.map((i) => i.instructor).slice(0, 2).join(', ') === 'Grant Bischoff, Sarah Banghart' && uOpen[0].instructors.every((i) => !i.teaches_in), 'UGA, none set: ACCT 2101 by each syllabus instructor, no one claimed to teach the term');
  const uSet = I.termSyllabiResult(ugaInputs(I.withInstructor(UGA_BOARD, 'fall-2026', 'ACCT 2101', 'Banghart')), ['grading']);
  expect(uSet[0].instructors.length === 1 && uSet[0].instructors[0].instructor === 'Sarah Banghart' && uSet[0].instructors[0].grading.components.length > 0 && !uSet[0].instructors[0].not_this_term, 'UGA, Banghart set: her Fall 2026 syllabus alone, with its grading');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. The answer layout, for both assistants ===\n');
{
  const rule = A.SHARED_ADVISOR_RULES.syllabusLayout;
  const ALMA = A.advisorSystem('ALMA', 'University of Illinois Urbana-Champaign', 'Illinois');
  const ARCH = A.advisorSystem('ARCH', 'University of Georgia', 'UGA');
  expect(ALMA.split(rule).length === 2 && ARCH.split(rule).length === 2, 'the layout rule is in ALMA\'s and ARCH\'s prompts once each');
  const placed = (p) => p.indexOf(rule) > p.indexOf('come only from course_syllabus') && p.indexOf(rule) < p.indexOf(A.SHARED_ADVISOR_RULES.boardToolFails);
  expect(placed(ALMA) && placed(ARCH), 'right after each one\'s syllabus rule');
  for (const [what, re] of [
    ['course by course, the course a bold line with code and title', /course by course[\s\S]*bold line with its code and title/],
    ['each instructor in bold with the answer for that instructor', /a dash, the instructor's name in bold, then the answer for that instructor/],
    ["the syllabus's term when it is not the course's own", /"Fall 2025 syllabus, likely similar"/],
    ['the set instructor alone', /answer for that instructor alone/],
    ['every instructor when none is set, and the one line on setting it', /give every instructor the tool returns and end the answer with one short line: they can set their instructor by clicking the course, then My instructor/],
    ['no syllabus: one line', /no syllabus found gets one line saying so/],
    ['a whole year: term_syllabi once, every course', /call term_syllabi once and cover every course it returns/],
    ['it overrides the no-lists rule for these answers', /replaces the rule against headers and lists/],
  ]) expect(re.test(rule), `it says: ${what}`);
  expect(!/Illinois|UGA|Canvas|eLC/.test(rule), 'it names neither school');
  const almaTools = A.ADVISOR_TOOLS.map((t) => t.name);
  const archTools = A.ugaAdvisorTools();
  const archTerm = archTools.find((t) => t.name === 'term_syllabi');
  expect(almaTools.includes('term_syllabi') && archTerm && /UGA's Bulletin/.test(archTerm.description) && !/Illinois|published sections/.test(archTerm.description), 'both get term_syllabi, ARCH in its own words');
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  expect(/case 'term_syllabi': \{/.test(ws) && /termSyllabiResult\(inputs, want\)/.test(ws) && /\(my instructor: \$\{who\}\)/.test(ws), 'the screen runs term_syllabi and puts "(my instructor: X)" in the board description');
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. The chat draws that layout ===\n');
{
  const reply = [
    '**Fall 2029**',
    '**CS 460, Security Laboratory**',
    '- **David M. Nicol** (Fall 2024 syllabus, likely similar): attendance is required at the Wednesday session. [syllabus](https://example.edu/cs460)',
    '- **Matthew E. Luallen**: no attendance rule in his Fall 2026 syllabus.',
    '  - nested note',
    '',
    'You can set your instructor by clicking the course, then My instructor.',
  ].join('\n');
  const lines = M.chatLines(reply);
  expect(lines.length === 7 && lines[0].kind === 'text' && lines[0].spans.every((s) => s.strong) && lines[1].spans[0].text === 'CS 460, Security Laboratory' && lines[1].spans[0].strong, 'term and course lines are bold text lines, marks gone');
  expect(lines[2].kind === 'item' && lines[2].marker === '•' && lines[2].depth === 0 && lines[2].spans[0].strong && lines[2].spans[0].text === 'David M. Nicol' && lines[2].spans.some((s) => s.href === 'https://example.edu/cs460'), 'an instructor line is a list item: bold name, then the answer and its link');
  expect(lines[4].kind === 'item' && lines[4].depth === 1 && lines[5].kind === 'blank' && lines[6].kind === 'text', 'nesting, the blank line and the closing line come through');
  expect(lines.flatMap((l) => l.spans).every((s) => !s.text.includes('**')), 'no "**" is printed anywhere');
  expect(M.chatSpans(reply).map((s) => s.text).join('').includes('- David M. Nicol'), 'chatSpans (copy, previews) is unchanged');
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  expect(/\.planner-app \.bot-msg\.assistant strong \{ color: inherit;/.test(css) && /\.bot-msg \.bot-li \{ display: flex;/.test(css), "bold takes the bubble's own colour in both themes (dark's light bubble hid white bold), and items hang under their text");
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. Plans cannot change: what the plan sweep loads ===\n');
{
  // The runtime import closure of the sweep (scripts/dev/sweep), type-only imports left out.
  const sweepDir = join(ROOT, 'scripts/dev/sweep');
  const seen = new Set();
  const resolveSpec = (from, spec) => {
    let base;
    if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
    else return null;
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts')]) if (existsSync(cand) && !cand.endsWith('/')) { try { readFileSync(cand); return cand; } catch { /* a directory */ } }
    return null;
  };
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    const specs = [];
    for (const m of src.matchAll(/^\s*import\s+(?!type\b)([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm)) specs.push(m[2]);
    for (const m of src.matchAll(/^\s*export\s+(?!type\b)[^'"]*?\s+from\s*['"]([^'"]+)['"]/gm)) specs.push(m[1]);
    for (const m of src.matchAll(/import\(\s*join\(\s*(HERE|ROOT)\s*,\s*['"]([^'"]+)['"]\s*\)\s*\)/g)) specs.push(m[1] === 'HERE' ? `@/lib/planner/${m[2]}` : `@/${m[2]}`);
    for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
    for (const spec of specs) {
      const next = resolveSpec(file, spec);
      if (next) walk(next);
    }
  };
  for (const f of ['sweep.mjs', 'blocks.mjs', 'gate.mjs', 'takeall.mjs', 'minor-pairs.mjs', 'compare.mjs', 'compare-sample.mjs']) if (existsSync(join(sweepDir, f))) walk(join(sweepDir, f));
  const loaded = [...seen].map((f) => relative(ROOT, f));
  const CHANGED = [
    'lib/planner/instructors.ts', 'lib/planner/advisor.ts', 'lib/planner/chat-markdown.ts',
    'components/planner/planner-workspace.tsx', 'components/planner/instructor-picker.tsx', 'components/planner/course-card.tsx',
    'components/planner/semester-column.tsx', 'components/planner/course-explorer.tsx', 'components/planner/advisor.tsx', 'app/globals.css',
  ];
  expect(loaded.includes('lib/planner/autoplan.ts') && loaded.includes('lib/planner/review.ts') && loaded.length > 10, `the sweep loads ${loaded.length} files, autoplan and review among them`);
  const reached = CHANGED.filter((f) => loaded.includes(f));
  expect(reached.length === 0, 'none of the files this work changed is among them', reached.join(', '));
  const types = await import(join(HERE, 'types.ts'));
  expect(Object.keys(types).length === 0, 'types.ts, the one shared file, has no runtime code: its new optional field cannot move a plan');
}

console.log(failures === 0 ? '\nALL INSTRUCTOR CHECKS PASSED' : `\n${failures} INSTRUCTOR CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
