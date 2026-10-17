import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import {
  parsePathways,
  parseSamplePlan,
  parsePathwayDetails,
} from '../../scripts/uga-planning-guidance.mjs';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`,
    ),
);
const { electiveOptions, generatePlan } = await import('./autoplan.ts');
const { pathwaysFor, sampleCoursesFor, samplePlansFor } =
  await import('./uga-planning-guidance.ts');

const sample = parseSamplePlan(
  `
  <a id="FourYear">Navigation</a>
  <div><a href="/Course/Details/1">FAKE 1111</a></div>
  <div class="degree-card" id="FourYear"><h6>Fall Year 1</h6>
    <table><tr><td><a href="/Course/Details/2">BIOL 1107-1107L</a></td><td>Biology</td></tr></table>
    <table><tr><td>General elective</td><td>Any course</td></tr></table>
    <h6>Spring Year 1</h6><table><tr><td><a href="/Course/Details/3">CSCI 4550/6550</a></td></tr></table>
  </div>`,
  { id: 'test', name: 'Test BS' },
);
assert.deepEqual(sample.courseCodes, [
  'BIOL 1107',
  'BIOL 1107L',
  'CSCI 4550',
  'CSCI 6550',
]);
assert.equal(sample.terms.length, 2);
assert.equal(
  parseSamplePlan('<a id="FourYear">Navigation only</a>', { id: 'test' }),
  null,
);

const pathways = parsePathways(
  '<table><tr><td class="showDetails"><a href="ProgramPopup/123">Test BS(Research)/Example MS(non-thesis)</a></td></tr></table>',
  [
    { id: 'bs', name: 'Test BS' },
    { id: 'ms', name: 'Example MS' },
    { id: 'wrong', name: 'Test AB' },
  ],
);
assert.deepEqual(pathways[0].undergraduateProgramIds, ['bs']);
assert.deepEqual(pathways[0].graduateProgramIds, ['ms']);
assert(pathways[0].name.includes('(Research)'));
assert.deepEqual(parsePathways('<table><td class="showDetails"><a href="ProgramPopup/1">Test BS/Example MS(Finance)(non-thesis)</a></td></table>', [
  { id: 'generic', name: 'Example MS' }, { id: 'finance', name: 'Example MS - Finance' },
])[0].graduateProgramIds, ['finance'], 'a named graduate concentration wins over the base degree');
assert.deepEqual(parsePathwayDetails('<span id="lblCurrCourseReqs">Take PHIL 6510<br>and CSCI 6550.</span><span id="lblCurrAddlReqs">Pass the defense.</span><span id="lblAdmPathway">Advisor approval</span>'), {
  curriculum: 'Take PHIL 6510\nand CSCI 6550.', sharedCourseCodes: ['PHIL 6510', 'CSCI 6550'], additionalRequirements: 'Pass the defense.', admission: 'Advisor approval',
});

const guidance = JSON.parse(
  readFileSync(
    new URL('../../public/uga-planning-guidance.json', import.meta.url),
  ),
);
for (const id of ['96447', '73962', '45780'])
  assert(
    samplePlansFor(guidance, [id]).length === 1,
    `Missing sample plan: ${id}`,
  );
assert(
  pathwaysFor(guidance, ['96447']).some(
    (p) => p.name === 'Cognitive Science AB/Artificial Intelligence MS',
  ),
);
assert.equal(pathwaysFor(guidance, ['__undecided__']).length, 0);
assert.equal(samplePlansFor(guidance, ['__undecided__']).length, 0);
const variants = [
  {
    programId: 'test',
    programName: 'Test BS',
    terms: [
      { variant: 'Test BS', courseCodes: ['BASE 1000'] },
      { variant: 'Area of Emphasis in Biology', courseCodes: ['BIOL 1000'] },
      { variant: 'Area of Emphasis in Chemistry', courseCodes: ['CHEM 1000'] },
    ],
  },
];
assert.deepEqual([...sampleCoursesFor(variants)], ['BASE 1000']);
assert.deepEqual(
  [...sampleCoursesFor(variants, { test: ['Biology'] })],
  ['BIOL 1000'],
);
assert.equal(
  new Set(guidance.pathways.map((p) => p.id)).size,
  guidance.pathways.length,
);

const course = (code) => ({
  id: code,
  code,
  title: 'Topics',
  credits: 3,
  description: '',
  cluster: 'TEST',
  requirementIds: [],
  prerequisites: [],
  offeredIn: ['Fall', 'Spring'],
  offeringKnown: true,
  format: 'In person',
  tags: [],
});
const courses = ['TEST 1101', 'TEST 1102', 'TEST 1103', 'TEST 6100'].map(
  course,
);
const prior = {
  courseCodes: [],
  exemptCodes: [],
  unmatchedCredits: 0,
  known: true,
};
const term = {
  id: 'fall',
  label: 'Fall 2026',
  season: 'Fall',
  year: 2026,
  courseIds: [],
};
const plan = {
  schemaVersion: 1,
  programId: 'test',
  graduationLabel: 'Spring 2027',
  completedCourseIds: [],
  terms: [term],
};
const base = {
  schoolId: 'uga',
  courses,
  prereqs: new Map(),
  offeringPublished: new Set(courses.map((c) => c.code)),
};
const quality = (score) => ({
  score,
  known: 1,
  reasons: [],
  unknown: [],
  conflicts: [],
  cautions: [],
});
const options = (context, extra = {}) =>
  electiveOptions({
    context,
    requirements: [],
    plan,
    termId: 'fall',
    prior,
    programName: 'Test BS',
    quality: () => quality(0.5),
    ...extra,
  });
const original = options(base);
assert(original.length >= 3);
const preferred = original[1].code;
const context = {
  ...base,
  samplePlanCourses: new Set([preferred, 'TEST 6100']),
};
assert.equal(
  options(context)[0].code,
  preferred,
  'Official sample wins an otherwise tied elective',
);
assert(
  !options(context).some((o) => o.code === 'TEST 6100'),
  'A sample cannot admit a graduate elective to undergraduate suggestions',
);
assert.equal(
  options(context, {
    quality: (code) => quality(code === original[0].code ? 1 : 0),
  })[0].code,
  original[0].code,
  'Student fit wins over the sample',
);
assert(
  !options(context, { prior: { ...prior, courseCodes: [preferred] } }).some(
    (o) => o.code === preferred,
  ),
  'Completed courses stay excluded',
);
const gated = {
  ...context,
  prereqs: new Map([
    [
      preferred,
      {
        groups: [
          {
            any: ['TEST 9999'],
            concurrent: false,
            confidence: 'high',
            source: 'TEST 9999',
          },
        ],
        text: 'TEST 9999',
        parsed: true,
        confidence: 'high',
        escape: null,
      },
    ],
  ]),
};
assert(
  !options(gated).some((o) => o.code === preferred),
  'Sample preference cannot override missing prerequisites',
);

const requirement = {
  id: 'choice',
  areaId: 'major',
  areaLabel: 'Major',
  label: 'Choose a course',
  hours: 3,
  note: '',
  url: '',
  rule: {
    kind: 'choose',
    n: 1,
    choices: ['TEST 1101', 'TEST 1102'].map((code) => ({
      codes: [code],
      credits: 3,
    })),
  },
};
const build = (ctx) =>
  generatePlan({
    requirements: [requirement],
    context: ctx,
    prior,
    programId: 'sample-test',
    programName: 'Test BS',
    horizon: {
      startSeason: 'Fall',
      startYear: 2026,
      gradSeason: 'Spring',
      gradYear: 2027,
    },
    degreeTotal: 3,
    preferences: {
      creditsPerTerm: { min: 0, target: 3, max: 18 },
      policy: 'catalog-order',
    },
  });
const generated = build({ ...base, samplePlanCourses: new Set(['TEST 1102']) });
assert(
  generated.terms.flatMap((t) => t.codes).includes('TEST 1102'),
  'Named optional requirement uses the sample tie-break',
);
assert(
  !generated.terms.flatMap((t) => t.codes).includes('TEST 1101'),
  'Only the chosen optional course is scheduled',
);
console.log(
  `UGA guidance passed: ${guidance.samplePlans.length} samples, ${guidance.pathways.length} pathways; parsing, matching, elective/requirement ties, preferences, completed credit and prerequisite guards.`,
);
