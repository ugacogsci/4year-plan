#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = JSON.parse(
  readFileSync(join(ROOT, 'public', 'uga-programs.json'), 'utf8'),
);
const catalog = JSON.parse(
  readFileSync(join(ROOT, 'public', 'uga-catalog.json'), 'utf8'),
);
const program = file.programs.find((candidate) => candidate.id === '73962');

assert(program, 'Computer Science BS (73962) is missing');
assert.equal(
  program.totalCredits,
  120,
  'Computer Science must retain its published 120-credit total',
);

const area = (label) =>
  program.areas.find((candidate) => candidate.label === label);
const required = area('Required Courses');
assert(required, 'Required Courses is missing');
assert.equal(required.hours, 19);
assert.deepEqual(
  required.groups.map((group) => ({
    label: group.label,
    choose: group.choose,
    codes: group.courses.map((course) => course.code),
  })),
  [
    {
      label: 'Required Courses',
      choose: null,
      codes: ['CSCI 3030', 'CSCI 4470', 'CSCI 4720'],
    },
    {
      label: 'Application Design Group',
      choose: 1,
      codes: ['CSCI 4050', 'CSCI 4370'],
    },
    {
      label: 'Systems Design Group',
      choose: 1,
      codes: ['CSCI 4570', 'CSCI 4730', 'CSCI 4760'],
    },
  ],
  'The 19-credit required block no longer matches the UGA Bulletin',
);

const fixedHours = required.groups[0].courses.reduce(
  (sum, course) => sum + course.credits,
  0,
);
const choiceHours = required.groups
  .slice(1)
  .reduce(
    (sum, group) =>
      sum + Math.min(...group.courses.map((course) => course.credits)),
    0,
  );
assert.equal(
  fixedHours + choiceHours,
  19,
  'Required-course choices must total 19 credits',
);

const major = area('Major Electives');
assert.equal(major?.hours, 12);
assert(
  major.groups.some(
    (group) =>
      group.hours === 12 &&
      group.courses.some((course) => course.code === 'CSCI 4XXX'),
  ),
);
assert(
  major.excludeCodes.includes('CSCI 4150'),
  'CSCI 4150 may not count as a major elective',
);

assert.equal(area('Major Related Electives')?.hours, 11);
assert.equal(area('General Electives')?.hours, 18);

console.log(
  'UGA Computer Science requirements: 19 required, 12 major elective, 11 major-related, 18 general elective credits.',
);

const cognitive = file.programs.find((candidate) => candidate.id === '96447');
assert(cognitive, 'Cognitive Science AB (96447) is missing');
assert.equal(cognitive.totalCredits, 120);
assert.equal(cognitive.areaHours, 114);

const cognitiveArea = (label) =>
  cognitive.areas.find((candidate) => candidate.label === label);
const related = cognitiveArea('VI. Courses Related to the Major');
assert(related, 'Cognitive Science courses related to the major are missing');
assert.equal(related.hours, 18);
assert.deepEqual(
  related.groups.map((group) => ({
    choose: group.choose,
    codes: group.courses.map((course) => course.code),
  })),
  [
    {
      choose: null,
      codes: ['LING 2100', 'PHIL 2500', 'PSYC 1101', 'STAT 2000'],
    },
    {
      choose: 1,
      codes: ['CSCI 1300', 'CSCI 1301', 'LING 2200'],
    },
    { choose: 1, codes: ['ARTI 2130', 'PHIL 2010'] },
  ],
);

const cognitiveRequired = cognitiveArea('Required Courses');
assert(cognitiveRequired, 'Cognitive Science Required Courses are missing');
assert.equal(cognitiveRequired.hours, 24);
assert.deepEqual(
  cognitiveRequired.groups.slice(0, 2).map((group) => ({
    choose: group.choose,
    codes: group.courses.map((course) => course.code),
  })),
  [
    { choose: null, codes: ['ARTI 3550', 'PSYC 4100'] },
    { choose: 1, codes: ['CSCI 4550', 'LING 3150W'] },
  ],
);

const foundations = cognitiveRequired.groups[2];
assert.equal(foundations.label, 'Foundations Areas');
assert.equal(foundations.choose, 5);
assert.equal(foundations.upperDivisionHours, 12);
assert.equal(foundations.minimumAreas, 2);
assert.equal(foundations.courses.length, 45);
assert.deepEqual(
  foundations.lists.map((list) => list.label),
  [
    'Artificial Intelligence Foundations Area',
    'Philosophical Foundations Area',
    'Psychological Foundations Area',
    'Language and Cultural Foundations Area',
  ],
);
assert(foundations.lists.every((list) => list.codes.length > 0));
assert.equal(cognitiveArea('General Electives')?.hours, 33);
assert(
  cognitive.areas.every((area) =>
    area.groups.every(
      (group) => group.choose === null || group.courses.length >= group.choose,
    ),
  ),
  'Cognitive Science may not contain an empty or undersized choice group',
);

const canonical = (value) => {
  const match = value
    .toUpperCase()
    .match(/^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)/);
  return match ? `${match[1]} ${match[2]}` : value.toUpperCase();
};
const catalogCodes = new Set(catalog.map((course) => canonical(course.code)));
// The broad campus-core menus include a handful of Bulletin rows that the
// course snapshot no longer carries. The degree-specific rows must all resolve:
// without one of these, the generated major is incomplete rather than merely
// offering one fewer gen-ed alternative.
const missingCognitiveCourses = [related, cognitiveRequired]
  .flatMap((area) => area.groups)
  .flatMap((group) => group.courses)
  .map((course) => course.code)
  .filter((code) => !catalogCodes.has(canonical(code)));
assert.deepEqual(
  [...new Set(missingCognitiveCourses)],
  [],
  'Every Cognitive Science requirement must resolve to a course in the UGA catalog',
);

console.log(
  'UGA Cognitive Science requirements: 18 related, 24 required, 5 foundations courses across 2 areas, 12 upper-division foundation hours, and 33 general elective credits.',
);

const psychology = file.programs.find((candidate) => candidate.id === '69115');
assert(psychology, 'Psychology BS (69115) is missing');
assert.equal(psychology.totalCredits, 120);
assert.equal(
  psychology.areas.filter((area) => area.label === 'Methods').length,
  1,
  'The optional neuroscience emphasis must not duplicate Psychology requirements',
);
assert.equal(
  psychology.areas.find((area) => area.label === 'Major Elective')?.hours,
  6,
);
assert.equal(
  psychology.areas.find((area) => area.label === 'General Electives')?.hours,
  28,
);
const psychologyRelated = psychology.areas.find(
  (area) => area.label === 'VI. Courses Related to the Major',
);
const psychologyScienceGroups = psychologyRelated?.groups.filter(
  (group) => group.completeOneList,
);
assert.deepEqual(
  psychologyScienceGroups?.map((group) => group.lists.map((list) => list.codes)),
  [
    [
      ['BIOL 1103', 'BIOL 1103L'],
      ['BIOL 1107', 'BIOL 1107L'],
    ],
    [
      ['BIOL 1104', 'BIOL 1104L'],
      ['BIOL 1108', 'BIOL 1108L'],
    ],
  ],
  'Psychology science choices must keep each lecture with its lab',
);

const representativeAreas = [
  ['28543', 'Finance BBA', 'Required Courses', 27],
  ['45780', 'Biology BS', 'Required Courses', 25],
  ['86328', 'English AB', 'Major Electives', 15],
];
for (const [id, name, label, hours] of representativeAreas) {
  const candidate = file.programs.find((item) => item.id === id);
  assert(candidate, `${name} (${id}) is missing`);
  assert.equal(candidate.totalCredits, 120, `${name} must retain its 120-credit total`);
  assert.equal(
    candidate.areas.find((area) => area.label === label)?.hours,
    hours,
    `${name} ${label} changed unexpectedly`,
  );
}

const finance = file.programs.find((candidate) => candidate.id === '28543');
assert(finance, 'Finance BBA (28543) is missing');
assert.equal(
  finance.areas.some((candidate) => candidate.label === 'General Electives'),
  false,
  'Finance parent General Electives row should not duplicate its two child buckets',
);
assert.equal(
  finance.areas.find((candidate) => candidate.label === 'Upper Division General Electives')
    ?.groups[0]?.courses[0]?.code,
  'ANY 3XXX',
  'Finance upper-division electives should expose a campus-wide wildcard',
);
assert.deepEqual(
  finance.areas.find(
    (candidate) => candidate.label === 'University Wide General Electives (Non-Business)',
  )?.excludePrefixes,
  ['ACCT', 'BUSN', 'ENTR', 'FINA', 'ILAD', 'INTB', 'LEGL', 'MARK', 'MBUS', 'MGMT', 'MIST', 'REAL', 'RMIN'],
  'Finance non-business electives should retain the published prefix exclusions',
);
assert.equal(
  finance.areas
    .find((candidate) => candidate.label === 'Major Electives')
    ?.groups.some((group) => group.label === 'Business Analytics'),
  false,
  'optional Finance emphases should not become degree requirements',
);

const english = file.programs.find((candidate) => candidate.id === '86328');
assert(english, 'English AB (86328) is missing');
const englishElectives = english.areas.find(
  (candidate) => candidate.label === 'Major Electives',
);
const englishRequired = english.areas.find(
  (candidate) => candidate.label === 'Required Courses',
);
const englishHistoricalAreas = englishRequired?.groups[0];
assert.equal(englishHistoricalAreas?.choose, 2);
assert.equal(englishHistoricalAreas?.minimumAreas, 2);
assert.equal(
  englishHistoricalAreas?.lists.length,
  4,
  'English pre-1800 choices should remain four constrained historical areas',
);
assert.equal(
  englishRequired?.groups.length,
  4,
  'English Required Courses should contain one historical-area pool and three additional choices',
);
assert.equal(
  englishElectives?.groups.length,
  1,
  'English optional areas of emphasis should not become extra elective groups',
);
assert.deepEqual(
  englishElectives?.groups[0]?.courses.map((course) => course.code).slice(0, 2),
  ['ENGL 3XXX', 'ENGL 4XXX'],
  'English major electives should preserve the published 3000/4000-level pool',
);
assert.equal(englishElectives?.groups[0]?.hours, 15);

console.log(
  'UGA representative plans checked: Psychology, Finance, Biology, and English retain their published totals and key requirement blocks.',
);
