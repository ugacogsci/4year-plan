/**
 * The weekly class-time clash check (weekly-fit.ts) on the class schedules
 * the app ships: Fall 2026 (sections.json) and Spring 2027
 * (sections/spring-2027.json).
 *
 * What it must get right, each from a real pair on a real board:
 *   - a real clash: PORT 150 and REL 260 each run one Spring 2027 section,
 *     both Monday and Wednesday 2:00 to 3:20 (67 swept boards put them in
 *     one term);
 *   - a real fit: a Computer Science freshman's Fall 2026;
 *   - a Lecture-Discussion section is a whole course on its own: ADV 150's
 *     MAJ section at 9:00 leaves ADV 250's only lecture (MW 11:00) free;
 *   - an online section's discussion is not an in-person student's: CHEM
 *     102's Spring Online Discussion (MW 10:00) does not clash with ESL 111;
 *   - half terms: ACE 221 (second half) and FSHN 483 (first half) at the
 *     same hour fit; FSHN 483 and THEA 110 (full term) do not;
 *   - three courses that fit two at a time and not together are named
 *     together;
 *   - a course with no published times is unknown, never a clash;
 *   - fast: a pre-med term of seven courses with dozens of sections each.
 *
 *   node lib/planner/__weekly-fit.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public', 'illinois');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const { weeklyFit } = await import(join(HERE, 'weekly-fit.ts'));

let passes = 0;
let failures = 0;
function check(name, ok, detail = '') {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
}

const scheduleOf = (file) => {
  const j = JSON.parse(readFileSync(join(PUBLIC, file), 'utf8'));
  return new Map(j.courses.map((c) => [c.code.trim().toUpperCase().replace(/\s+/g, ' '), c]));
};
const fall = scheduleOf('sections.json');
const spring = scheduleOf(join('sections', 'spring-2027.json'));

// A real clash.
{
  const fit = weeklyFit(['RHET 105', 'PORT 150', 'REL 260', 'ESL 112'], spring);
  check('PORT 150 and REL 260 (Spring 2027, both MW 2:00-3:20) cannot be registered together', fit.status === 'clash', JSON.stringify(fit));
  check('the clash names exactly the two courses', JSON.stringify(fit.clash) === JSON.stringify(['PORT 150', 'REL 260']), JSON.stringify(fit.clash));
  check('the line says so in words', fit.line === 'No section combination fits: PORT 150 and REL 260 meet at the same time', fit.line);
}
{
  const fit = weeklyFit(['ACE 100', 'ACE 262', 'ECON 103', 'ACE 123', 'ACE 203'], fall);
  check('ACE 203 and ACE 262 (Fall 2026, both TR 12:30-1:50, one section each) clash', fit.status === 'clash' && fit.clash.join() === 'ACE 203,ACE 262', JSON.stringify(fit));
}

// A real fit.
{
  const fit = weeklyFit(['MATH 221', 'SPAN 201', 'CS 124', 'ENG 100', 'RHET 105'], fall);
  check("a Computer Science freshman's Fall 2026 fits in a week", fit.status === 'fits' && fit.line === 'These fit in a weekly schedule', JSON.stringify(fit));
  check('every course on it was checked', fit.checked === 5 && fit.unknown.length === 0, JSON.stringify(fit));
}

// A Lecture-Discussion section stands alone.
{
  const fit = weeklyFit(['ADV 150', 'ADV 250'], fall);
  check("ADV 150 fits beside ADV 250 by its own MW 9:00 Lecture-Discussion, not AL1's 11:00 lecture", fit.status === 'fits', JSON.stringify(fit));
}
{
  const fit = weeklyFit(['THEA 110', 'PORT 150'], spring);
  check("THEA 110's Spring Lecture-Discussion (TR 3:00) does not take the Wednesday lab meant for its MF lecture", fit.status === 'fits', JSON.stringify(fit));
}

// An online section's discussion belongs to the online section.
{
  const fit = weeklyFit(['CHEM 102', 'ESL 111'], spring);
  check("CHEM 102's Spring Online Discussion (MW 10) is not an in-person student's, so ESL 111 (MWF 10) fits", fit.status === 'fits', JSON.stringify(fit));
}

// Half terms.
{
  const halves = weeklyFit(['ACE 221', 'FSHN 483'], fall);
  check('ACE 221 (second half, M 2:00) and FSHN 483 (first half, MW 2:00) are never in class the same week', halves.status === 'fits', JSON.stringify(halves));
  const full = weeklyFit(['FSHN 483', 'THEA 110'], fall);
  check('FSHN 483 (first half) and THEA 110 (full term, MF 2:00) clash in the first half', full.status === 'clash', JSON.stringify(full));
  const b = weeklyFit(['ACE 221', 'THEA 110'], fall);
  check('ACE 221 (second half) and THEA 110 (full term) clash in the second half', b.status === 'clash', JSON.stringify(b));
}

// Three that fit in pairs and not together.
{
  const trio = ['ECON 102', 'MATH 112', 'NRES 287'];
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => weeklyFit([trio[a], trio[b]], spring).status);
  check('ECON 102, MATH 112 and NRES 287 each fit two at a time in Spring 2027', pairs.every((s) => s === 'fits'), pairs.join());
  const fit = weeklyFit(['RHET 105', ...trio], spring);
  check('and together they clash, all three named', fit.status === 'clash' && fit.clash.join() === trio.join(), JSON.stringify(fit));
  check('in a line that does not say "meet at the same time" of three', fit.line === 'No section combination fits: ECON 102, MATH 112 and NRES 287 overlap in every combination of their sections', fit.line);
}

// Unknown is unknown.
{
  const fit = weeklyFit(['MATH 221', 'XYZ 999'], fall);
  check('a course with no published sections is left out and named, not a clash', fit.status === 'fits' && fit.unknown.join() === 'XYZ 999' && fit.line === 'These fit in a weekly schedule (no times to check for XYZ 999)', JSON.stringify(fit));
  const none = weeklyFit(['XYZ 999'], fall);
  check('nothing known at all says nothing', none.status === 'unknown' && none.line === null, JSON.stringify(none));
  const made = new Map([
    ['AAA 100', { meet: { Lecture: ['MW@600-650'] }, partsOfTerm: [{ id: '1' }] }],
    ['BBB 100', { meet: { Online: ['ARR'] }, partsOfTerm: [{ id: '1' }] }],
    ['CCC 100', { meet: { Lecture: ['MW@600-650'] }, partsOfTerm: [{ id: 'A' }, { id: 'B' }] }],
    ['DDD 100', { meet: { Lecture: ['MW@600-650'] }, partsOfTerm: [{ id: 'A' }] }],
    ['EEE 100', { meet: {}, partsOfTerm: [{ id: '1' }] }],
  ]);
  check('an arranged online course blocks nothing', weeklyFit(['AAA 100', 'BBB 100'], made).status === 'fits');
  check('a course with sections in both halves is still counted against a full-term course', weeklyFit(['AAA 100', 'CCC 100'], made).status === 'clash');
  check('but not against a half-term course, whose part it may not share', weeklyFit(['CCC 100', 'DDD 100'], made).status === 'fits');
  const empty = weeklyFit(['AAA 100', 'EEE 100'], made);
  check('a course whose meetings the build could not read is unknown', empty.status === 'fits' && empty.unknown.join() === 'EEE 100', JSON.stringify(empty));
}

// Fast, and cached.
{
  const premed = ['CHEM 102', 'CHEM 103', 'IB 150', 'IB 151', 'MCB 150', 'MCB 151', 'PSYC 100'];
  const t0 = performance.now();
  const fit = weeklyFit(premed, fall);
  const ms = performance.now() - t0;
  check(`a seven-course pre-med Fall 2026 is answered (${fit.status}) in ${ms.toFixed(1)} ms`, fit.status !== 'unknown' && ms < 500, JSON.stringify(fit));
  check('a second ask is the cached answer', weeklyFit([...premed].reverse(), fall) === fit);
  const springFit = weeklyFit(['RHET 105', 'SPAN 203', 'CHEM 102', 'CHEM 103', 'ANTH 240', 'ANTH 270'], spring);
  check('the pre-med Spring 2027 the first search gave up on is answered', springFit.status !== 'unknown', JSON.stringify(springFit));
  // PHYS 211 alone is about 2,200 ways (22 discussions, 20 labs, 5 lectures);
  // this term took 257 ms before the pair tables were cached.
  const eng = ['MATH 231', 'CHEM 104', 'CHEM 105', 'CS 101', 'PHYS 211', 'CHBE 121', 'PORT 150'];
  const t1 = performance.now();
  const engFit = weeklyFit(eng, spring);
  const engMs = performance.now() - t1;
  check(`a Chemical Engineering Spring 2027 with PHYS 211 is answered in ${engMs.toFixed(1)} ms, naming CS 101 and PORT 150`, engMs < 500 && engFit.clash.join() === 'CS 101,PORT 150', JSON.stringify(engFit));
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
