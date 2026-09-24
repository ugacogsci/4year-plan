/**
 * Plain-node check harness for lib/planner/illinois-data.ts.
 *
 * Run it from the repo root:
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" \
 *     node --experimental-strip-types lib/planner/__illinois-data.check.mjs
 *
 * The prerequisite parser is the highest-risk piece in the module: it decides
 * whether the planner blocks a student from a course. So this does two things
 * rather than one. It asserts twelve golden cases that must never regress, and
 * it runs the parser over every prerequisite sentence in the real catalog and
 * prints what it could not read, so a human can see the shape of the failures
 * instead of trusting a pass count.
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  adaptIllinoisCatalog,
  adaptIllinoisPrograms,
  buildIllinoisData,
  buildingLine,
  computeDifficultyBands,
  creditLabel,
  creditRange,
  difficultyLabel,
  gradeFootnote,
  missingPrerequisiteGroups,
  parsePrerequisites,
  registrationFits,
  sectionSnapshot,
  partOfTermLine,
  summariseSections,
  termCreditRange,
  visibleInstructors,
} from './illinois-data.ts';
import { sectionTimes } from './meeting-fit.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const read = (name) => {
  try {
    return JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
  } catch {
    return null;
  }
};

const catalog = read('illinois-catalog.json');
const programs = read('illinois-programs.json');
const grades = read('illinois-grades.json');
const sections = read('illinois-sections.json');

if (!catalog) {
  console.error('public/illinois-catalog.json is missing. Nothing to check.');
  process.exit(1);
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const ok = (msg) => console.log(`  ok    ${msg}`);

const rows = catalog.courses;
const known = new Set(rows.map((r) => r.code.replace(/\s+/g, ' ').trim().toUpperCase()));
const byCode = new Map(rows.map((r) => [r.code, r]));

const specFor = (code) => {
  const raw = byCode.get(code);
  if (!raw) return null;
  return parsePrerequisites(raw.prereqText ?? '', code, known);
};

/** "MATH 285 | TAM 210,TAM 211" with a trailing ~ marking a concurrent group. */
const render = (spec) =>
  spec.groups.map((g) => `${g.any.join(',')}${g.concurrent ? '~' : ''}`).join(' | ');

// ---------------------------------------------------------------------------
console.log('\n=== 1. Golden prerequisite cases ===\n');

const GOLDEN = [
  ['AE 321', 'MATH 285 | TAM 210,TAM 211'],
  ['CS 225', 'CS 126,CS 128,ECE 220 | CS 173,CS 413,MATH 213,MATH 314,MATH 412,MATH 413'],
  [
    'CS 357',
    'CS 101,CS 105,CS 124,CS 125,ECE 220 | MATH 241 | MATH 225,MATH 227,MATH 257,MATH 415,MATH 416,ASRM 406,BIOE 210',
  ],
  ['ME 340', 'MATH 285,MATH 441 | TAM 212 | MATH 257,MATH 415,MATH 416~ | ECE 205~'],
  ['ABE 455', 'CEE 350,NRES 401 | CEE 380,NRES 201'],
  ['ACCY 201', 'ECON 102,ECON 103 | ECON 102,ECON 103~'],
  ['ACCY 532', ''],
  ['ANTH 352', ''],
  ['CEE 202', 'CS 101,CS 124 | MATH 241~'],
];

for (const [code, expected] of GOLDEN) {
  const spec = specFor(code);
  if (!spec) {
    fail(`${code} is not in the catalog file`);
    continue;
  }
  const actual = render(spec);
  if (actual === expected) ok(`${code}  ${actual || '(no hard prerequisite)'}`);
  else fail(`${code}\n          expected: ${expected || '(none)'}\n          actual:   ${actual || '(none)'}`);
}

// Shape assertions that a rendered string cannot express.
const abe426 = specFor('ABE 426');
if (abe426.groups.length === 5) ok(`ABE 426  five groups`);
else fail(`ABE 426 produced ${abe426.groups.length} groups, expected 5: ${render(abe426)}`);
if (abe426.escape === 'standing') ok(`ABE 426  escape 'standing' on the spec`);
else fail(`ABE 426 escape is ${abe426.escape}, expected 'standing'`);

const accy201 = specFor('ACCY 201');
if (!accy201.groups.some((g) => g.any.includes('ACCY 201'))) ok('ACCY 201  self-reference dropped');
else fail('ACCY 201 kept its own code as a prerequisite');

const chem360 = specFor('CHEM 360');
if (chem360.confidence === 'low') ok(`CHEM 360  confidence 'low' (paren-sequence)`);
else fail(`CHEM 360 confidence is '${chem360.confidence}', expected 'low'`);

// ---------------------------------------------------------------------------
console.log('\n=== 2. Matching, concurrency and cross-listings ===\n');

const equivalents = adaptIllinoisCatalog(catalog, { includeGraduate: true }).equivalents;

// The bipartite case. ACCY 201 needs BOTH econ courses, one of them possibly in
// the same term, so ECON 102 alone must not clear it.
{
  const one = missingPrerequisiteGroups(accy201, new Set(['ECON 102']), new Set(), equivalents);
  if (one.missing.length === 1) ok('ACCY 201  ECON 102 alone leaves one group unmet');
  else fail(`ACCY 201 with ECON 102 only reported ${one.missing.length} missing, expected 1`);

  const both = missingPrerequisiteGroups(
    accy201,
    new Set(['ECON 102']),
    new Set(['ECON 103']),
    equivalents,
  );
  if (both.missing.length === 0) ok('ACCY 201  ECON 102 earlier plus ECON 103 same term clears it');
  else fail(`ACCY 201 with both reported ${both.missing.length} missing, expected 0`);

  const wrongTerm = missingPrerequisiteGroups(
    accy201,
    new Set(),
    new Set(['ECON 102', 'ECON 103']),
    equivalents,
  );
  if (wrongTerm.missing.length === 1) ok('ACCY 201  the non-concurrent group rejects a same-term course');
  else fail(`ACCY 201 same-term-only reported ${wrongTerm.missing.length} missing, expected 1`);
}

// A low-confidence group warns instead of blocking.
{
  const res = missingPrerequisiteGroups(chem360, new Set(), new Set(), equivalents);
  if (res.missing.length === 0 && res.uncertain.length > 0) {
    ok(`CHEM 360  ${res.uncertain.length} uncertain groups, 0 blocking`);
  } else {
    fail(`CHEM 360 reported ${res.missing.length} blocking and ${res.uncertain.length} uncertain`);
  }
}

// Cross-listings, transitively.
{
  const cls = equivalents.get('AAS 215') ?? [];
  if (cls.length >= 2) ok(`AAS 215  cross-listed with ${cls.join(', ')}`);
  else fail(`AAS 215 equivalence class is ${JSON.stringify(cls)}, expected at least two others`);
  let asym = 0;
  for (const [code, others] of equivalents) {
    for (const other of others) if (!(equivalents.get(other) ?? []).includes(code)) asym += 1;
  }
  if (asym === 0) ok('every equivalence class is symmetric');
  else fail(`${asym} one-way equivalences survived the union-find`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Parser coverage over every sentence in the catalog ===\n');

let withText = 0;
let parsed = 0;
let highConf = 0;
let lowConf = 0;
let noGroups = 0;
let concurrentCourses = 0;
let escaped = 0;
let totalGroups = 0;
const sizes = new Map();
const fellBack = [];
let selfRefs = 0;

for (const raw of rows) {
  if (!raw.prereqText) continue;
  withText += 1;
  const spec = parsePrerequisites(raw.prereqText, raw.code, known);
  if (spec.groups.some((g) => g.any.includes(raw.code))) selfRefs += 1;
  if (spec.parsed) {
    parsed += 1;
    if (spec.confidence === 'low') lowConf += 1;
    else highConf += 1;
    totalGroups += spec.groups.length;
    for (const g of spec.groups) sizes.set(g.any.length, (sizes.get(g.any.length) ?? 0) + 1);
    if (spec.groups.some((g) => g.concurrent)) concurrentCourses += 1;
  } else {
    noGroups += 1;
    fellBack.push(raw);
  }
  if (spec.escape) escaped += 1;
}

console.log(`  courses with a prerequisite sentence : ${withText}`);
console.log(`  parsed into at least one group       : ${parsed}`);
console.log(`    all groups high confidence         : ${highConf}`);
console.log(`    at least one low-confidence group  : ${lowConf}`);
console.log(`  fell back to text only (no groups)   : ${noGroups}`);
console.log(`  with a concurrency-allowed group     : ${concurrentCourses}`);
console.log(`  with a consent or standing escape    : ${escaped}`);
console.log(`  groups produced                      : ${totalGroups}`);
console.log(
  `  groups per parsed course             : ${(totalGroups / Math.max(1, parsed)).toFixed(2)}`,
);
console.log(
  `  group sizes                          : ${[...sizes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, c]) => `${n}:${c}`)
    .join('  ')}`,
);
if (selfRefs === 0) ok('no course lists itself as its own prerequisite');
else fail(`${selfRefs} courses kept a self-reference`);

console.log('\n  The 15 longest sentences that produced no groups:\n');
fellBack.sort((a, b) => b.prereqText.length - a.prereqText.length);
for (const raw of fellBack.slice(0, 15)) {
  const flat = raw.prereqText.replace(/\s+/g, ' ').trim();
  console.log(`  ${raw.code} (${flat.length} chars)`);
  console.log(`    ${flat.slice(0, 300)}${flat.length > 300 ? ' ...' : ''}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Credits ===\n');

{
  const variable = rows.filter((r) => r.credits !== null && r.creditsMax > r.credits);
  const unknown = rows.filter((r) => r.credits === null);
  console.log(`  variable-credit rows : ${variable.length}`);
  console.log(`  unknown-credit rows  : ${unknown.length}  (${unknown.slice(0, 6).map((r) => r.code).join(', ')})`);

  const me340 = creditRange(byCode.get('ME 340'));
  if (!me340.known && me340.credits === 0) ok(`ME 340  "${creditLabel(me340)}" and contributes 0`);
  else fail(`ME 340 credit range is ${JSON.stringify(me340)}`);

  const sample = variable[0];
  if (sample) {
    const r = creditRange(sample);
    if (r.variable && r.credits === r.min) ok(`${sample.code}  "${creditLabel(r)}", counts the low end`);
    else fail(`${sample.code} range ${JSON.stringify(r)} did not keep the low end`);
  }

  const { facts } = adaptIllinoisCatalog(catalog, {});
  const pick = (code) => ({ id: code.toLowerCase().replace(/[^a-z0-9]+/g, '-'), code });
  const varCourse = variable.find((r) => r.level < 500 && !r.noise);
  const term = termCreditRange([pick('CS 225'), pick(varCourse.code), pick('ME 340')], facts);
  console.log(
    `  term of CS 225 + ${varCourse.code} + ME 340 : ${term.min} to ${term.max} credits, variable=${term.variable}, unknown=${term.unknown}`,
  );
  if (term.variable && term.unknown === 1) ok('a variable course widens the term and ME 340 is reported unknown');
  else fail(`term range came back ${JSON.stringify(term)}`);

  const pinned = new Map([[pick(varCourse.code).id, 2]]);
  const pinnedTerm = termCreditRange([pick('CS 225'), pick(varCourse.code)], facts, pinned);
  if (!pinnedTerm.variable) ok(`pinning ${varCourse.code} collapses the range to ${pinnedTerm.min}`);
  else fail(`pinning left the term variable: ${JSON.stringify(pinnedTerm)}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Grades ===\n');

if (!grades) {
  console.log('  public/illinois-grades.json is missing, skipping.');
} else {
  /**
   * The bands the product uses, not a second set computed here.
   *
   * Calling computeDifficultyBands on the whole grade file was what this line
   * used to do, and it printed 9 / 26 / 37 while the panel was about to print
   * something else. A harness that reports its own numbers as the product's has
   * misled this project twice. buildIllinoisData is the product path.
   */
  const built = buildIllinoisData({ catalog, grades });
  const bands = built.bands;
  console.log(`  bands: typical<=${bands.typical}  harder>=${bands.harder}  hardest>=${bands.hardest}`);
  const banded = grades.courses.filter(
    (r) => r?.code && built.byCode.has(r.code.replace(/\s+/g, ' ').trim().toUpperCase()),
  );
  console.log(`  computed over ${banded.length} of the ${grades.courses.length} published grade rows`);
  const whole = computeDifficultyBands(grades.courses);
  if (bands.typical === whole.typical && bands.harder === whole.harder && bands.hardest === whole.hardest) {
    console.log('  the whole grade file gives the same three cuts in this import');
  } else {
    console.log(
      `  the whole grade file would give ${whole.typical} / ${whole.harder} / ${whole.hardest}, which is not what the product shows`,
    );
  }
  /**
   * How big each bucket really is, which is what the panel claims out loud.
   *
   * course-detail.tsx says "the easiest quarter", "the middle half", "the
   * harder quarter" and "the hardest tenth". Difficulty is a whole number with
   * heavy ties, so an exact quarter is not reachable; three points of slack and
   * no more. This is measured on the shares, not on the cut points, because the
   * share is the sentence a student reads.
   */
  const scale = banded.map((r) => r.difficulty).filter((x) => typeof x === 'number');
  const share = (f) => (scale.filter(f).length / scale.length) * 100;
  const buckets = [
    ['the easiest quarter', share((x) => x <= bands.typical), 25],
    ['the middle half', share((x) => x > bands.typical && x < bands.harder), 50],
    ['the harder quarter', share((x) => x >= bands.harder), 25],
    ['the hardest tenth', share((x) => x >= bands.hardest), 10],
  ];
  for (const [name, got, want] of buckets) {
    console.log(`  ${name}: ${got.toFixed(1)}% of the ${scale.length} rows, claimed ${want}%`);
  }
  const offBy = buckets.filter(([, got, want]) => Math.abs(got - want) > 3);
  if (offBy.length === 0) ok('every band holds the share the copy beside it claims');
  else fail(`bands do not hold their stated share: ${JSON.stringify(offBy)}`);
  const gm = new Map(grades.courses.map((r) => [r.code, r]));

  const cs225 = difficultyLabel(gm.get('CS 225'), bands);
  console.log(`  CS 225 : ${JSON.stringify(cs225)}`);
  if (cs225.kind === 'band') ok('CS 225 is banded');
  else fail('CS 225 produced no band despite having a grade row');

  const none = difficultyLabel(undefined, bands);
  if (none.kind === 'none') ok('a course with no grade row produces kind "none", never a number');
  else fail(`missing row produced ${JSON.stringify(none)}`);

  const thinRow = grades.courses.find((r) => r.n < 50 && r.difficulty >= bands.hardest);
  if (thinRow) {
    const label = difficultyLabel(thinRow, bands);
    if (label.thin && label.band !== 'hardest' && label.band !== 'harder') {
      ok(`${thinRow.code} (n=${thinRow.n}, difficulty ${thinRow.difficulty}) is held at '${label.band}'`);
    } else {
      fail(`${thinRow.code} thin row banded '${label.band}'`);
    }
  } else {
    console.log('  no thin row above the hardest cut in this import, clamp not exercised');
  }

  const withInstructors = gm.get('CS 225');
  const vis = visibleInstructors(withInstructors);
  console.log(`  CS 225 instructors: ${vis.map((i) => `${i.name} (${i.sections}${i.thin ? ', thin' : ''})`).join('; ')}`);
  const firstThin = vis.findIndex((i) => i.thin);
  if (firstThin === -1 || vis.slice(firstThin).every((i) => i.thin)) ok('thin instructors sort last');
  else fail('a thick instructor sorted after a thin one');

  console.log(`  footnote: ${gradeFootnote({ source: grades.source, terms: grades.terms, count: grades.count })}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. Sections ===\n');

if (!sections) {
  console.log('  public/illinois-sections.json is missing, skipping.');
} else {
  const term = { id: `${sections.term}-${sections.year}`, label: `Fall ${sections.year}` };
  let usual = 0;
  let spread = 0;
  let noRoom = 0;
  let multiPart = 0;
  let onlineOnly = 0;
  let mangled = 0;
  for (const course of sections.courses) {
    const s = summariseSections(course, term);
    if (s.usual) usual += 1;
    else if (s.located > 0) spread += 1;
    else noRoom += 1;
    if (s.partsOfTerm.length > 1) multiPart += 1;
    if (s.onlineOnly) onlineOnly += 1;
    mangled += s.multiMeeting;
    for (const b of s.buildings) {
      if (/\s\d[\dA-Za-z-]*\s/.test(b.building)) fail(`${course.code} kept a concatenated building: ${b.building}`);
    }
  }
  console.log(`  courses: ${sections.courses.length}`);
  console.log(`  usually one building: ${usual}   spread: ${spread}   no room listed: ${noRoom}`);
  console.log(`  more than one part of term: ${multiPart}   online only: ${onlineOnly}   multi-meeting cells: ${mangled}`);

  for (const code of ['CS 225', 'ACCY 201', 'MATH 241']) {
    const course = sections.courses.find((c) => c.code === code);
    if (!course) continue;
    const s = summariseSections(course, term);
    console.log(`\n  ${code}  (${s.total} sections, ${s.located} located)`);
    console.log(`    ${buildingLine(s)}`);
    console.log(`    ${partOfTermLine(s)}`);
    console.log(`    earliest ${s.earliest ?? 'n/a'}, latest ${s.latest ?? 'n/a'}`);
    console.log(`    teaching this term: ${s.instructors.slice(0, 3).map((i) => i.name).join('; ') || 'not listed'}`);
    if (s.restrictions.length) console.log(`    restrictions: ${s.restrictions[0]}`);
  }

  // A meeting time is only claimed when the sections actually agree on one.
  // CS 225 runs ten Thursday labs at 9, 11, 1, 3 and 5, so it must not get one.
  let withMeeting = 0;
  for (const course of sections.courses) {
    const s = summariseSections(course, term);
    if (sectionSnapshot(s, term.id, 'x')?.meeting) withMeeting += 1;
  }
  console.log(`\n  courses given a single meeting time: ${withMeeting} of ${sections.courses.length}`);
  {
    const cs225 = sections.courses.find((c) => c.code === 'CS 225');
    const snap = sectionSnapshot(summariseSections(cs225, term), term.id, 'x');
    if (!snap.meeting) ok('CS 225 claims no single meeting time, because its labs run at five');
    else fail(`CS 225 claimed meeting "${snap.meeting}" but its sections meet at five different times`);
    const other = sectionSnapshot(summariseSections(cs225, term), 'spring-2029', 'x');
    if (other === undefined) ok('a snapshot is withheld from any term other than the crawled one');
    else fail('a fall 2026 room was attached to a spring 2029 term');
  }

  const multi = sections.courses
    .map((c) => summariseSections(c, term))
    .find((s) => s.partsOfTerm.length > 1);
  if (multi) {
    console.log(`\n  a multi-part course, ${multi.code}:`);
    console.log(`    ${partOfTermLine(multi)}`);
    if (/deadlines are different for each one/.test(partOfTermLine(multi))) {
      ok('the multi-part line warns that deadlines differ');
    } else {
      fail('the multi-part line dropped the deadline warning');
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 6b. Whether a registration fits a time window ===\n');

/**
 * One rule for the scorer, ALMA and lateOption (meeting-fit.ts). The shapes
 * are the real courses' section types; the expected answers are what a
 * student could actually register for.
 */
{
  const NINE = { notBefore: 540 };
  const NOON = { notBefore: 720 };
  /** One case: what it shows, the course's meet, the window, the answer a student can rely on. */
  const expect = (what, meet, window, want) => {
    const got = registrationFits(meet, window);
    if (got === want) ok(what);
    else fail(`${what}: got ${String(got)}, want ${String(want)}`);
  };
  // ECON 490: in-person Lecture-Discussion or one Online section, either will do.
  expect('an online section is an alternative to the in-person one', { 'Lecture-Discussion': ['MW@480-555'], Online: ['ARR'] }, NINE, true);
  // CHEM 102: "Online" alone is not a registration; its online path is Online,
  // Online Discussion at 10 and a quiz together.
  expect('CHEM 102 fits nothing before 9 through its online path', { 'Discussion/Recitation': ['TR@480-530'], Lecture: ['TR@600-650'], Online: ['ARR'], 'Online Discussion': ['TR@600-650'], Quiz: ['TR@540-590', 'WF@780-830'] }, NINE, true);
  expect('CHEM 102 does not fit afternoons only: its Online Discussion is at 10', { 'Discussion/Recitation': ['TR@480-530'], Lecture: ['TR@600-650'], Online: ['ARR'], 'Online Discussion': ['TR@600-650'], Quiz: ['TR@540-590', 'WF@780-830'] }, NOON, false);
  expect('the quiz stays on CHEM 102\'s online path', { 'Discussion/Recitation': ['TR@480-530'], Lecture: ['TR@600-650'], Online: ['ARR'], 'Online Discussion': ['TR@600-650'], Quiz: ['TR@480-530'] }, NINE, false);
  // ACCY 201: online discussions at 9 and 10 do not veto a noon in-person discussion.
  expect('an online discussion does not veto the in-person path', { 'Discussion/Recitation': ['F@540-590', 'F@720-770'], Lecture: ['TR@750-830'], 'Online Discussion': ['F@540-590'] }, NOON, true);
  // ASTR 121: the online discussion's students still attend the MW lecture.
  expect('an online discussion keeps the in-person lecture on its path', { 'Discussion/Recitation': ['F@540-590'], Lecture: ['MW@720-770'], 'Online Discussion': ['F@720-770'] }, { freeDays: ['M', 'W'] }, false);
  // ABE 466: every student takes the synchronous online lecture at 9.
  expect('a synchronous online lecture every student takes counts', { Laboratory: ['R@840-1010'], 'Online Lecture': ['TR@540-590'] }, { notBefore: 600 }, false);
  // EDPR 250: the online section does not excuse the 8 a.m. practicum conference.
  expect('an online section does not stand in for a practicum', { 'Conference, Practice': ['F@480-530;MT@480-900'], Online: ['ARR'], Practice: ['W@960-990'] }, NINE, false);
  // IS 407: Lecture-Discussion at 1 p.m. or online at 8:30.
  expect('IS 407 fits nothing before 9 in person', { 'Lecture-Discussion': ['M@780-890'], Online: ['WF@510-590'] }, NINE, true);
  // CEE 458: a lab-and-lecture row whose second meeting is at 8.
  expect('every meeting of a row counts, not the first', { 'Laboratory, Lecture': ['R@780-1010;W@480-590'] }, NINE, false);
  expect('every online-labelled type must fit together', { Online: ['ARR'], 'Online Lab': ['T@480-590'] }, NINE, false);
  expect('a course with no meeting data is unknown', {}, NINE, null);
  if (registrationFits(undefined, NINE) === null) ok('no meet at all is unknown, not a yes or a no');
  else fail('registrationFits(undefined) was not null');
}

// The eleven courses the scorer and ALMA used to disagree on, from the real
// crawl: ALMA's can_avoid_before_9 is now the scorer's answer on the same meet.
if (sections) {
  const term = { id: `${sections.term}-${sections.year}`, label: `Fall ${sections.year}` };
  const expected = {
    'CHEM 102': true, 'CEE 421': true, 'CEE 433': true, 'CEE 442': true, 'CEE 461': true, 'EDPR 250': false,
    'IS 407': true, 'LING 221': true, 'SHS 221': true, 'CEE 458': false, 'NRES 302': false,
  };
  for (const [code, want] of Object.entries(expected)) {
    const course = sections.courses.find((c) => c.code === code);
    if (!course) continue;
    const s = summariseSections(course, term);
    const fits = registrationFits(s.meet, { notBefore: 540 });
    const alma = sectionTimes(course.sections ?? [], s.meet, term.label).can_avoid_before_9;
    if (fits === want && alma === fits && s.lateOption === (fits === true)) ok(`${code}: scorer, ALMA and lateOption all say ${want} for nothing before 9`);
    else fail(`${code}: scorer ${fits}, ALMA ${alma}, lateOption ${s.lateOption}, want ${want}`);
  }
  const chem = sections.courses.find((c) => c.code === 'CHEM 102');
  if (chem) {
    const s = summariseSections(chem, term);
    if (registrationFits(s.meet, { notBefore: 720 }) === false) ok('CHEM 102 does not fit afternoons only on the real crawl');
    else fail('CHEM 102 fits afternoons only on the real crawl, through its Online section alone');
  }
  const cee = sections.courses.find((c) => c.code === 'CEE 458');
  if (cee) {
    const lines = sectionTimes(cee.sections ?? [], summariseSections(cee, term).meet, term.label).sections?.by_type ?? [];
    if (lines.some((l) => /8:00AM/.test(l))) ok('ALMA sees CEE 458\'s 8 a.m. second meeting');
    else fail(`ALMA's CEE 458 lines hide its 8 a.m. meeting: ${lines.join(' | ')}`);
  }
  let disagree = 0;
  for (const course of sections.courses) {
    const s = summariseSections(course, term);
    const window = { notBefore: 600, freeDays: ['F'] };
    const alma = sectionTimes(course.sections ?? [], s.meet, term.label, window);
    if (alma.can_avoid_before_9 !== registrationFits(s.meet, { notBefore: 540 })) disagree += 1;
    else if ((alma.fits_your_hours?.fits ?? null) !== registrationFits(s.meet, window)) disagree += 1;
  }
  if (disagree === 0) ok(`ALMA's course details and the scorer agree on all ${sections.courses.length} courses`);
  else fail(`ALMA's course details and the scorer disagree on ${disagree} courses`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. buildIllinoisData end to end ===\n');

/** The built data, kept for section 8's plan rather than built a second time. */
let built = null;
{
  const t0 = Date.now();
  const data = buildIllinoisData({ catalog, programs, grades, sections });
  built = data;
  const ms = Date.now() - t0;
  console.log(`  built in ${ms} ms`);
  console.log(`  coverage: ${JSON.stringify(data.coverage, null, 2).split('\n').join('\n  ')}`);
  console.log(`  section term: ${data.sectionTerm ? `${data.sectionTerm.id} / ${data.sectionTerm.label}` : 'none'}`);
  console.log(`  bands: ${JSON.stringify(data.bands)}`);

  const cs225 = data.byCode.get('CS 225');
  if (cs225) {
    console.log(`\n  CS 225 as the planner sees it:`);
    console.log(`    credits ${cs225.credits}, format ${cs225.format}, offeringKnown ${cs225.offeringKnown}`);
    console.log(`    prerequisites (hard, AND): ${JSON.stringify(cs225.prerequisites)}`);
    console.log(`    tags: ${JSON.stringify(cs225.tags)}`);
    console.log(`    requirement areas: ${cs225.requirementIds.length}, pathwayRole ${cs225.pathwayRole ?? 'none'}`);
    console.log(`    section: ${JSON.stringify(cs225.section)}`);
    const facts = data.facts.get('CS 225');
    console.log(`    exclusions: ${JSON.stringify(facts.exclusions)}`);
    console.log(`    schedule: ${facts.scheduleUrl}`);
  }

  if (data.courses.every((c) => c.offeringKnown === false)) {
    ok('every course carries offeringKnown false, so the offering warning stays quiet');
  } else {
    fail('some course claims a known offering term');
  }
  if (data.courses.every((c) => c.format !== 'Hybrid')) ok(`no course was labelled 'Hybrid'`);
  else fail(`a course was labelled 'Hybrid', which this data cannot support`);
  if (data.courses.every((c) => c.section === undefined || c.section.seatsRemaining === undefined)) {
    ok('no section snapshot invented a seat count');
  } else {
    fail('a snapshot carries seatsRemaining, which Illinois does not publish');
  }
  if (data.courses.every((c) => c.mapPosition === undefined)) {
    ok('no course was given a placeholder map position');
  } else {
    fail('a course has a map position but the Orion projection has not landed');
  }

  const undergradWithGrades = data.coverage.withGrades;
  console.log(
    `\n  copy check: "Grade data covers ${undergradWithGrades} of ${data.coverage.undergraduateCourses} undergraduate courses."`,
  );

  if (programs) {
    const cs = data.programs.find((p) => p.id === 'engineering/computer-science-bs');
    if (cs) {
      console.log(`\n  ${cs.name} (${cs.degree}) total ${cs.totalCredits ?? 'not listed'}, area hours ${cs.areaHours}`);
      const blocks = data.requirementBlocks.get(cs.id) ?? [];
      for (const b of blocks) {
        const rule =
          b.rule.kind === 'all'
            ? `all of ${b.rule.choices.length}`
            : b.rule.kind === 'choose'
              ? `choose ${b.rule.n} of ${b.rule.choices.length}`
              : b.rule.kind === 'pool'
                ? `pool: ${b.rule.hours ?? '?'} hours / ${b.rule.n ?? '?'} courses from ${b.rule.choices.length} in ${b.rule.lists.length} list(s), ${b.rule.constraints.length} constraint(s), from ${b.rule.from}`
                : b.rule.kind === 'hours'
                  ? `${b.rule.hours} hours, genEd ${b.rule.genEd ? b.rule.genEd.join('/') : 'unmapped'}`
                  : b.rule.kind === 'gened'
                    ? `gen ed: ${[b.rule.hours !== null ? `${b.rule.hours} hours` : null, b.rule.courses !== null ? `${b.rule.courses} courses` : null].filter(Boolean).join(' and ')}` +
                      ` from ${b.rule.genEd.join('/') || 'no category'}, size from ${b.rule.sizeFromCampus ? 'the campus table' : 'this page'}` +
                      `, page says fulfilled by ${b.rule.fulfilledBy.map((o) => o.join(' or ')).join(', ') || 'nothing'}`
                    : `unparsed`;
        console.log(`    [${b.areaLabel}] ${b.label || '(no label)'} -> ${rule}`);
      }
      const linear = blocks
        .flatMap((b) => (b.rule.kind === 'all' || b.rule.kind === 'choose' || b.rule.kind === 'pool' ? b.rule.choices : []))
        .find((c) => c.codes[0] === 'MATH 257');
      if (linear && linear.codes.length === 3) ok(`MATH 257 is one slot with ${linear.codes.join(' or ')}`);
      else fail(`the linear algebra slot came back as ${JSON.stringify(linear)}`);

      /**
       * The technical electives are the whole reason the pool rule exists, so
       * this asserts the shape rather than printing it. Six courses, eighteen
       * hours, and the two sentences that say how they may be chosen.
       */
      const tech = blocks.find((b) => b.areaLabel === 'Technical Electives');
      if (!tech || tech.rule.kind !== 'pool') {
        fail(`Technical Electives came back as ${tech ? tech.rule.kind : 'nothing'}, not a pool`);
      } else if (tech.rule.hours !== 18 || tech.rule.n !== 6) {
        fail(`the technical elective pool wants ${tech.rule.hours} hours and ${tech.rule.n} courses, not 18 and 6`);
      } else if (tech.rule.constraints.length !== 2) {
        fail(`the technical elective pool carries ${tech.rule.constraints.length} constraints, not 2`);
      } else {
        const single = tech.rule.constraints.find((c) => c.single);
        if (!single || single.n !== 3 || single.lists.length !== 8) {
          fail(`the focus-area constraint came back as ${JSON.stringify(single)}`);
        } else {
          ok(`Technical Electives is one pool: 18 hours, 6 courses, ${tech.rule.choices.length} courses across ${tech.rule.lists.length} lists`);
          ok(`three of them must come from a single one of ${single.lists.length} focus areas`);
        }
      }

      // Every course a pool names has to come from a list the page printed
      // under that pool, or the pool is offering a course the catalog did not.
      for (const b of blocks) {
        if (b.rule.kind !== 'pool') continue;
        const inLists = new Set(b.rule.lists.flatMap((l) => l.codes));
        const stray = b.rule.choices.filter((c) => !c.codes.some((code) => inLists.has(code)));
        if (stray.length) fail(`${b.label} offers ${stray.length} courses that are on none of its lists`);
      }
      ok('every pool course comes from one of that pool\'s own catalog lists');
    }
    if (data.coverage.implausibleProgramTotals > 0) {
      ok(`${data.coverage.implausibleProgramTotals} implausible degree totals reported as unknown instead of printed`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. Lists a degree page prints without saying what to take ===\n');

/**
 * The Community Health concentrations print their Correlates List tab as seven
 * tables with no label, no hours and no count, 152 courses in 41 subjects from
 * ACCY 200 to UP 260, after a summary table whose "Correlate Areas (see
 * Correlates List Tab)" row asks for 18 hours and whose "Total Hours" row says
 * 128. Read as seven take-all rules, the Rehabilitation Studies plan asked for
 * 467 hours, ran 17 and 18 credits a term to 142 and left 124 courses
 * unplaced. These are the shapes that must hold for that page and for every
 * page printed like it.
 */
if (programs) {
  const { courses: adapted } = adaptIllinoisCatalog(catalog);
  const lookup = new Map(adapted.map((c) => [c.code.replace(/\s+/g, ' ').trim().toUpperCase(), c]));
  const out = adaptIllinoisPrograms(programs, lookup);
  const creditsOf = (choice) => choice.credits ?? lookup.get(choice.codes[0])?.credits ?? 0;
  const takeAllCredits = (blocks) =>
    blocks.filter((b) => b.rule.kind === 'all').reduce((sum, b) => sum + b.rule.choices.reduce((s, c) => s + creditsOf(c), 0), 0);

  const CORRELATES = ['ACCY 201', 'ACE 161', 'RST 200', 'SHS 473', 'MCB 244'];
  for (const id of [
    'ahs/community-health-bs/rehabilitation-studies',
    'ahs/community-health-bs/health-education-promotion',
    'ahs/community-health-bs/health-planning-administration',
  ]) {
    const program = out.programs.find((p) => p.id === id);
    const blocks = out.blocks.get(id) ?? [];
    if (!program) {
      fail(`${id} is not in the programs file`);
      continue;
    }
    const short = id.split('/').pop();
    if (program.totalCredits === 128) ok(`${short}  degree total 128, read from its own "Total Hours" row`);
    else fail(`${short} degree total is ${program.totalCredits}, not the 128 its table prints`);

    const takeAll = blocks.filter((b) => b.rule.kind === 'all');
    const stray = CORRELATES.filter((code) => takeAll.some((b) => b.rule.choices.some((c) => c.codes.includes(code))));
    if (stray.length === 0) ok(`${short}  no correlate course is read as required`);
    else fail(`${short} still requires ${stray.join(', ')} from the correlate lists`);

    const asked = takeAllCredits(blocks);
    if (asked <= program.totalCredits) ok(`${short}  take-all rules ask for ${Math.round(asked)} of its ${program.totalCredits} hours`);
    else fail(`${short} take-all rules ask for ${Math.round(asked)} hours in a ${program.totalCredits}-hour degree`);

    const pool = blocks.find((b) => b.rule.kind === 'pool' && b.label.startsWith('Correlate Areas'));
    if (!pool) {
      fail(`${short} has no Correlate Areas pool: ${blocks.map((b) => `${b.label || '(no label)'}=${b.rule.kind}`).join(', ')}`);
    } else if (pool.rule.hours !== 18 || pool.rule.lists.length !== 7 || !CORRELATES.every((code) => pool.rule.choices.some((c) => c.codes.includes(code)))) {
      fail(`${short} Correlate Areas pool is ${pool.rule.hours} hours over ${pool.rule.lists.length} lists and ${pool.rule.choices.length} courses`);
    } else if (pool.id !== `${id}::1::2`) {
      fail(`${short} Correlate Areas moved from ${id}::1::2 to ${pool.id}, so a saved plan loses it`);
    } else {
      ok(`${short}  Correlate Areas is one 18-hour pool over ${pool.rule.choices.length} courses in ${pool.rule.lists.length} lists, still ${pool.id.slice(id.length)}`);
    }
  }

  // A table under a heading the summary names as its own requirement is that
  // requirement, not a correlate list: FSHN 120 is Health Education's.
  const hep = out.blocks.get('ahs/community-health-bs/health-education-promotion') ?? [];
  if (hep.some((b) => b.rule.kind === 'all' && b.rule.choices.some((c) => c.codes.includes('FSHN 120')))) {
    ok('health-education-promotion  FSHN 120 is still required under Concentration Requirements');
  } else {
    fail('health-education-promotion lost FSHN 120 from its Concentration Requirements');
  }

  // Kinesiology's unlabelled "Major Requirements" table states no rule either,
  // and fits inside the degree many times over, so it stays required.
  const kin = out.blocks.get('ahs/kinesiology-bs/applied-exercise-science') ?? [];
  if (kin.some((b) => b.rule.kind === 'all' && b.areaLabel === 'Major Requirements')) {
    ok('kinesiology applied-exercise-science  its unlabelled Major Requirements table is still required');
  } else {
    fail('kinesiology applied-exercise-science Major Requirements is no longer a take-all rule');
  }

  // A "Total Hours 126" row is the degree, never one area's size. Read as an
  // area's subtotal it left every other area of 114 degrees with no room, and
  // the ask bar reported an unheaded part of the page at 0 of 126 hours.
  const degreeSizedAreas = out.programs.flatMap((p) => p.areas.filter((a) => a.hours >= 100).map((a) => `${p.id} [${a.label}] ${a.hours}`));
  if (degreeSizedAreas.length === 0) ok('no requirement area claims a degree-sized total as its own hours');
  else fail(`${degreeSizedAreas.length} areas claim a degree total as their hours: ${degreeSizedAreas.slice(0, 3).join('; ')}`);

  // With that row read as the degree, the room test reaches the Animal
  // Sciences concentration cores: 65 ANSC courses and 153 hours under "Choose
  // one group ... Select two ... Select two", which were booked whole and left
  // 30 courses unplaced. The page's own counts are for sub-lists the crawl
  // flattened, so the list is reported unsized rather than taken whole.
  for (const id of [
    'aces/animal-sciences-bs/companion-equine-science',
    'aces/animal-sciences-bs/food-animal-production-management',
    'aces/animal-sciences-bs/science-pre-veterinary--medical',
  ]) {
    const program = out.programs.find((p) => p.id === id);
    const blocks = out.blocks.get(id) ?? [];
    const core = blocks.find((b) => b.id === `${id}::2::0`);
    const asked = takeAllCredits(blocks);
    const short = id.split('/').pop();
    if (!program || !core) fail(`${short} is missing, or has no concentration core at ::2::0`);
    else if (core.rule.kind !== 'pool') fail(`${short} concentration core is still a ${core.rule.kind} rule over ${core.rule.choices?.length} courses`);
    else if (asked > program.totalCredits) fail(`${short} take-all rules ask for ${Math.round(asked)} hours in a ${program.totalCredits}-hour degree`);
    else ok(`${short}  concentration core is a list of ${core.rule.choices.length}, take-all rules ask for ${Math.round(asked)} of ${program.totalCredits}`);
  }

  // "List A: Choose 2 credits from the list below:" sizes its own list. The
  // Technology concentration asks for 8 hours across Lists A, B and C, not
  // for all 35 of their courses.
  const tech = out.blocks.get('faa/music-education-bme/technology') ?? [];
  const sized = ['List A', 'List B', 'List C'].map((name) => tech.find((b) => b.label.startsWith(name)));
  const sizes = sized.map((b) => (b ? `${b.rule.kind}${b.rule.kind === 'pool' ? ` ${b.rule.hours}h` : ''}` : 'missing'));
  if (sizes.join(', ') === 'pool 2h, pool 3h, pool 3h') ok('music-education technology  Lists A, B and C are pools of 2, 3 and 3 hours, from their own headings');
  else fail(`music-education technology Lists A, B and C came back as ${sizes.join(', ')}`);

  // Printed, not asserted: degrees whose take-all rules still ask for more
  // hours than the degree holds. Each is a page shape the adapter misreads.
  const over = out.programs
    .filter((p) => p.totalCredits && takeAllCredits(out.blocks.get(p.id) ?? []) > p.totalCredits)
    .map((p) => `${p.id} ${Math.round(takeAllCredits(out.blocks.get(p.id) ?? []))}/${p.totalCredits}`);
  console.log(`\n  ${over.length} degrees still ask for more take-all hours than they hold:`);
  for (const line of over) console.log(`    ${line}`);
}

/**
 * The plan the student saw, planned the way the browser plans it. A fresh
 * Rehabilitation Studies student with no career words got 18/18/17/17/18/18/
 * 18/18 = 142 hours, 20 unmet rules and 124 courses that did not fit. The
 * reading above is only worth anything if the plan now reaches the 128 the page
 * prints, places everything it books, and fills the 18 correlate hours from the
 * list rather than taking the list whole.
 */
if (programs && built) {
  register(
    'data:text/javascript,' +
      encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
  );
  const { generatePlan } = await import('./autoplan.ts');
  const prereqs = new Map();
  const creditRanges = new Map();
  for (const [code, fact] of built.facts) {
    if (fact.prereq) prereqs.set(code, fact.prereq);
    creditRanges.set(code, fact.creditRange);
  }
  const context = {
    courses: built.courses,
    prereqs,
    grades: built.grades,
    sections: built.sections,
    equivalents: built.equivalents,
    creditRanges,
    bands: built.bands,
    prereqCheck: (spec, earlier, sameTerm, equivalents) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, equivalents),
  };
  const id = 'ahs/community-health-bs/rehabilitation-studies';
  const program = built.programs.find((p) => p.id === id);
  const blocks = built.requirementBlocks.get(id) ?? [];
  if (!program) {
    fail(`${id} is not in the built data`);
  } else {
    const result = generatePlan({
      requirements: blocks,
      context,
      prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true },
      horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 },
      programId: id,
      preferences: { creditsPerTerm: { min: 12, target: null, max: 18 } },
      degreeTotal: program.totalCredits,
      programName: program.name,
      programCollege: program.college,
    });
    const planned = result.credits.planned.min;
    const perTerm = result.terms.map((t) => t.credits.min).join('/');
    const correlates = result.pools.find((p) => p.requirementId === `${id}::1::2`);
    const unfit = result.unsatisfied.filter((u) => u.reason === 'did-not-fit');
    if (planned !== 128) fail(`rehabilitation-studies plan is ${planned} hours (${perTerm}), not the 128 its page prints`);
    else ok(`rehabilitation-studies plan reaches 128 hours: ${perTerm}`);
    if (result.notPlaced.length > 0 || unfit.length > 0) {
      fail(`rehabilitation-studies plan leaves ${result.notPlaced.length} courses unplaced and ${unfit.length} rules that did not fit: ${result.notPlaced.slice(0, 6).map((n) => n.code).join(', ')}`);
    } else {
      ok('rehabilitation-studies plan places every course it books');
    }
    if (!correlates || correlates.hours < 18 || correlates.picked.length > 8) {
      fail(`rehabilitation-studies correlates came back as ${correlates ? `${correlates.hours} hours in ${correlates.picked.length} courses` : 'no pool'}`);
    } else {
      ok(`rehabilitation-studies correlates: ${correlates.hours} hours in ${correlates.picked.length} courses from the list of 152`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
