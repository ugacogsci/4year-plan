#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UGA_COLLEGES } from '../lib/planner/uga-colleges.ts';
import { applyUgaProgramOverrides } from '../lib/planner/uga-program-overrides.ts';

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
const listedCodes = (value) => {
  const match = value
    .toUpperCase()
    .match(/^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)(?:\/(\d{4}[A-Z]?))?/);
  return match
    ? [...new Set([match[2], match[3]].filter(Boolean))].map(
        (number) => `${match[1]} ${number}`,
      )
    : [value.toUpperCase()];
};
const catalogCodes = new Set(
  catalog.flatMap((course) => listedCodes(course.code)),
);
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

const undergraduateDegrees = (degree) =>
  degree === 'AB' || /^B[A-Z]+$/.test(degree);
const collegeCourseChecks = {
  ARTS: 'AFAM 3880',
  BUS: 'ACCT 2101',
  CAES: 'AAEC 2580',
  ECOL: 'ECOL 2550',
  EDCN: 'EDSE 2000',
  ENV: 'LAND 2010',
  FCS: 'FHCE 1110',
  FENGR: 'AENG 2100',
  FRS: 'FANR 3950',
  JOUR: 'ADPR 3110',
  PBHL: 'EPID 4070',
  PHAR: 'BCMB 3100',
  SPIA: 'INTL 1100',
  SSW: 'SOWK 2154',
  VET: 'VPHY 3107L',
};
for (const [college, code] of Object.entries(collegeCourseChecks)) {
  assert(catalogCodes.has(code), `${college} representative ${code} is missing from the course catalog`);
  const programUsesCourse = file.programs
    .filter((candidate) => candidate.college === college && undergraduateDegrees(candidate.degree))
    .some((candidate) =>
      candidate.areas.some((candidateArea) =>
        candidateArea.groups.some((group) =>
          group.courses.some((course) => canonical(course.code) === code),
        ),
      ),
    );
  assert(programUsesCourse, `${college} undergraduate requirements no longer reference ${code}`);
}
assert.deepEqual(
  [...new Set(
    file.programs
      .filter((candidate) => undergraduateDegrees(candidate.degree) && candidate.areas.length > 0)
      .map((candidate) => candidate.college),
  )].sort((left, right) => left.localeCompare(right)),
  Object.keys(collegeCourseChecks).sort((left, right) => left.localeCompare(right)),
  'Every UGA college with a parsed undergraduate major must have a representative course check',
);
assert.equal(UGA_COLLEGES.length, 20, 'The current official UGA roster must contain 20 schools and colleges');
assert.deepEqual(
  UGA_COLLEGES.filter((college) => college.hasBaccalaureateProgram)
    .map((college) => college.id)
    .sort((left, right) => left.localeCompare(right)),
  Object.keys(collegeCourseChecks).sort((left, right) => left.localeCompare(right)),
  'The 15 parsed bachelor-degree colleges must be distinguished from UGA\'s full 20-unit roster',
);

const parsedMinors = file.programs.filter(
  (candidate) => candidate.degree === 'MINOR' && candidate.areaHours > 0,
);
const parsedCertificates = file.programs.filter(
  (candidate) => candidate.degree === 'CERT-UG' && candidate.areaHours > 0,
);
assert(parsedMinors.length > 100, 'The UGA minor catalog is unexpectedly sparse');
assert(parsedCertificates.length > 50, 'The UGA undergraduate certificate catalog is unexpectedly sparse');

const graduateDegrees = applyUgaProgramOverrides(file.programs).filter(
  (candidate) =>
    !undergraduateDegrees(candidate.degree) &&
    !['MINOR', 'CERT-UG', 'CERT-GM'].includes(candidate.degree) &&
    ((candidate.areas.length > 0 && candidate.areaHours > 0) ||
      candidate.totalCredits > 0),
);
const graduateCertificates = file.programs.filter(
  (candidate) => candidate.degree === 'CERT-GM' && candidate.areaHours > 0,
);
assert(
  graduateDegrees.length > 350,
  'The searchable UGA graduate and professional degree catalog is unexpectedly sparse',
);
assert(
  graduateCertificates.length > 30,
  'The parsed UGA graduate certificate catalog is unexpectedly sparse',
);

const accountingMacc = file.programs.find((candidate) => candidate.id === '35960');
assert(accountingMacc, 'Accounting MACC (35960) is missing');
assert.equal(accountingMacc.degree, 'MACC');
assert.equal(accountingMacc.areaHours, 30);
assert.deepEqual(
  accountingMacc.areas.map((candidate) => [candidate.label, candidate.hours]),
  [
    ['Required Courses', 18],
    ['Elective Courses', 12],
  ],
  'Accounting MACC must retain its 30-hour graduate curriculum',
);
const missingAccountingCourses = accountingMacc.areas
  .flatMap((candidate) => candidate.groups)
  .flatMap((group) => group.courses)
  .map((course) => canonical(course.code))
  .filter((code) => !catalogCodes.has(code));
assert.deepEqual(
  [...new Set(missingAccountingCourses)],
  [],
  'Every Accounting MACC requirement must resolve to a graduate course listing',
);
assert(
  catalogCodes.has('ACCT 7410'),
  'Joint undergraduate/graduate listings must expose their graduate course number',
);

const artificialIntelligenceMs = graduateDegrees.find(
  (candidate) => candidate.id === '19170',
);
assert(artificialIntelligenceMs, 'Artificial Intelligence MS (19170) is missing');
assert.equal(artificialIntelligenceMs.totalCredits, 30);
assert.equal(artificialIntelligenceMs.areaHours, 30);
assert.deepEqual(
  artificialIntelligenceMs.areas.map((candidate) => [candidate.label, candidate.hours]),
  [
    ['Required Courses', 11],
    ['Group A Select Courses', 8],
    ['Group B Select Courses', 6],
    ['Thesis and Research', 5],
  ],
  'Artificial Intelligence MS must retain its published 30-hour curriculum',
);
const missingArtificialIntelligenceCourses = artificialIntelligenceMs.areas
  .flatMap((candidate) => candidate.groups)
  .flatMap((group) => group.courses)
  .map((course) => canonical(course.code))
  .filter((code) => !catalogCodes.has(code));
assert.deepEqual(
  [...new Set(missingArtificialIntelligenceCourses)],
  [],
  'Every Artificial Intelligence MS requirement must resolve to the UGA catalog',
);

const artificialIntelligencePhd = graduateDegrees.find(
  (candidate) => candidate.id === '56418',
);
assert(artificialIntelligencePhd, 'Artificial Intelligence PhD (56418) is missing');
assert.equal(artificialIntelligencePhd.totalCredits, 46);
assert.equal(artificialIntelligencePhd.areaHours, 46);
assert.deepEqual(
  artificialIntelligencePhd.areas.map((candidate) => [candidate.label, candidate.hours]),
  [
    ['Required Courses', 15],
    ['Elective Courses', 18],
    ['Doctoral Dissertation', 6],
  ],
  'Artificial Intelligence PhD must retain its published 46-hour curriculum',
);
const missingArtificialIntelligencePhdCourses = artificialIntelligencePhd.areas
  .flatMap((candidate) => candidate.groups)
  .flatMap((group) => group.courses)
  .map((course) => canonical(course.code))
  .filter((code) => !catalogCodes.has(code));
assert.deepEqual(
  [...new Set(missingArtificialIntelligencePhdCourses)],
  [],
  'Every Artificial Intelligence PhD requirement must resolve to the UGA catalog',
);

const requiredEmphasisPrograms = file.programs.filter((candidate) =>
  candidate.emphasisGroups?.some((group) => group.minimum > 0),
);
assert(
  requiredEmphasisPrograms.some((candidate) => candidate.id === '47637'),
  'Applied Biotechnology must require an emphasis selection',
);
assert(
  requiredEmphasisPrograms.some((candidate) => candidate.id === '28389'),
  'Pharmaceutical and Biomedical Sciences must require an emphasis selection',
);
const classics = file.programs.find((candidate) => candidate.id === '82769');
assert(
  classics?.emphasisGroups?.[0]?.options.every((option) => option.courses.length > 0),
  'Every required Classics emphasis must expose a usable course pool',
);
const animalBiosciences = file.programs.find((candidate) => candidate.id === '27361');
assert.deepEqual(
  animalBiosciences?.emphasisGroups?.[0]?.options.map((option) => option.label),
  [
    'General Animal Biosciences Track',
    'Companion Animal Biosciences',
    'Food Animal Biosciences',
  ],
  'Animal Biosciences must ask for its general track or one of its two emphases',
);
assert.equal(animalBiosciences?.emphasisGroups?.[0]?.minimum, 1);
const sociology = file.programs.find((candidate) => candidate.id === '77932');
assert.deepEqual(
  sociology?.emphasisGroups?.[0]?.options.map((option) => option.label),
  ['General Sociology Track', 'Sociological Methodology'],
  'Sociology must ask for its general track or methodology emphasis',
);
assert.equal(sociology?.emphasisGroups?.[0]?.minimum, 1);
const hdfs = file.programs.find((candidate) => candidate.id === '67554');
const hdfsLabels = hdfs?.areas.flatMap((candidateArea) =>
  candidateArea.groups.map((group) => group.label),
) ?? [];
assert.equal(
  hdfsLabels.filter((label) => /^Focus Area\s+\d+:/i.test(label ?? '')).length,
  2,
  'HDFS must retain both required focus-area choices',
);
assert.equal(
  new Set(
    hdfsLabels
      .map((label) => label?.match(/^Option\s+(\d+|One|Two|Three)/i)?.[1]?.toLowerCase())
      .filter(Boolean),
  ).size,
  3,
  'HDFS must retain all three experiential-learning options',
);

console.log(
  `UGA catalog coverage: one requirement course verified for each of ${Object.keys(collegeCourseChecks).length} schools and colleges with parsed bachelor's majors, within UGA's full ${UGA_COLLEGES.length}-unit roster; ${parsedMinors.length} minors, ${parsedCertificates.length} undergraduate certificates, ${graduateDegrees.length} graduate or professional degrees, ${graduateCertificates.length} graduate certificates, and required degree paths are plannable.`,
);
