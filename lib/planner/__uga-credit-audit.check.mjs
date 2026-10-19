import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
register(
  'data:text/javascript,' +
    encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
      try { return await next(spec + '.tsx', ctx); } catch {}
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
      }).outputText };
    return next(url, ctx);
  }
`),
);
const T = await import('./transcript.ts');
const A = await import('./autoplan.ts');
const D = await import('./double-dawgs.ts');
const U = await import('../../components/planner/uga-source.tsx');
const { auditUgaBoard, ugaProgressLoss } =
  await import('../../components/planner/uga-board-audit.ts');
const { areaProgress } = await import('./scheduler.ts');
const { livePools } = await import('../../components/planner/live-pools.ts');
const { scoreQuality } = await import('./quality.ts');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) =>
  new Response(
    readFileSync(
      join(
        ROOT,
        'public',
        (typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.pathname
            : url.url
        ).replace(/^\//, ''),
      ),
    ),
  );
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
assert.ok(data);
const load = (id) =>
  U.loadUgaProgram(
    data,
    data.programs.find((program) => program.id === id),
    { resetRequirements: false },
  );
const certificate = load('28375');
const minor = load('67412');
const cogsci = load('96447');
const graduate = D.withDoubleDawgsGraduateRules(load('19170'), data.context);

// Synthetic, non-identifying record: stale catalog credit, online/honors
// equivalents, a zero-hour exemption and pending coursework.
const rows = [
  ['MATH 1113', 0],
  ['PHIL 2500H', 3],
  ['CSCI 1302', 4],
  ['CSCI 2610E', 4],
  ['CSCI 3030', 3],
  ['CSCI 3360', 3],
  ['CSCI 4550', 3],
  ['ARTI 4340', 3],
  ['CSCI 4360', 4],
  ['FYOS 1001', 1],
  ['PEDB 1340', 1],
];
const transcript = {
  schoolId: 'uga',
  home: true,
  institution: 'University of Georgia',
  courses: rows.map(([code, credits]) => ({
    code,
    matched: code,
    credits,
    illinoisCredits: 3,
    use: true,
    counts: 'course',
    matchedBy: 'code',
    status: code === 'CSCI 4360' ? 'in_progress' : 'completed',
    grade: code === 'CSCI 4360' ? '' : credits === 0 ? 'EX' : 'A',
    ...(code === 'CSCI 3360'
      ? { from: 'Example Transfer College', status: 'transfer' }
      : {}),
  })),
};
const context = T.withTranscriptCredits(data.context, transcript);
const priorCodes = T.transcriptCodes(transcript);
assert.equal(T.transcriptCreditSummary(transcript).earned, 25);
assert.equal(T.transcriptCreditSummary(transcript).pending, 4);
assert.equal(
  A.planCreditRange(priorCodes, context).min,
  28,
  'zero-hour exemptions and PEDB do not inflate academic hours',
);
assert.deepEqual(T.transcriptExemptCodes(transcript), ['MATH 1113']);
assert.equal(
  T.transcriptCreditAdjustment(
    transcript,
    (code) =>
      context.courses.find((course) => course.code === code)?.credits ?? null,
  ),
  0,
);
assert.equal(
  T.transcriptResidentHours(transcript).upper,
  13,
  'UGA upper-division codes have four digits',
);
const creditsByCode = new Map(
  context.courses.map((course) => [course.code, course.credits]),
);
const certProgress = areaProgress(
  certificate.program,
  new Set(priorCodes),
  context.equivalents,
  { allowCrossAreaOverlap: true, creditsByCode },
);
assert.deepEqual(
  certProgress.map((row) => [row.earned, row.satisfied]),
  [
    [9, true],
    [7, true],
  ],
  'complete foundations and both elective groups are recognized',
);
assert.ok(
  areaProgress(minor.program, new Set(priorCodes), context.equivalents, {
    allowCrossAreaOverlap: true,
    creditsByCode,
  }).every((row) => row.satisfied),
  'CS minor includes online discrete math and its nine elective hours',
);
assert.ok(
  areaProgress(cogsci.program, new Set(['STAT 2000']), context.equivalents, {
    allowCrossAreaOverlap: true,
  }).find((row) => /Quantitative/.test(row.area.label))?.satisfied,
  'preferred PHIL 2500 does not exclude other approved quantitative core courses',
);

const undergraduate = {
  ...cogsci,
  blocks: [...cogsci.blocks, ...minor.blocks, ...certificate.blocks],
  program: {
    ...cogsci.program,
    id: '96447+67412+28375',
    name: 'Cognitive Science AB + Computer Science Minor + AI Computing Certificate',
    areas: [cogsci, minor, certificate].flatMap((source) =>
      source.program.areas.map((area) => ({
        ...area,
        label: `${source.program.name}: ${area.label}`,
      })),
    ),
  },
};
const board = {
  programId: undergraduate.program.id,
  completedCourseIds: priorCodes.map((code) => data.byCode.get(code).id),
  exemptCourseIds: T.transcriptExemptCodes(transcript).map(
    (code) => data.byCode.get(code).id,
  ),
  terms: [
    {
      id: 'spring-2027',
      label: 'Spring 2027',
      season: 'Spring',
      year: 1,
      courseIds: [],
    },
  ],
};
const auditInput = {
  board,
  context,
  undergraduate,
  priorCodes,
  extraCredits: 0,
  transcript,
  validation: { minimumTermCredits: 0 },
};
const audit = auditUgaBoard(auditInput);
assert.ok(
  !audit.issues.some((issue) => issue.id.startsWith('uga-pool-28375')),
  'the major does not consume the certificate elective credit',
);
assert.equal(
  audit.pools.find((pool) => pool.requirementId.startsWith('28375')).hours,
  7,
);
assert.ok(audit.issues.some((issue) => issue.id === 'uga-pending'));
assert.ok(!audit.issues.some((issue) => issue.id === 'uga-cs-minor-residency'));
const pendingRemoved = priorCodes.filter((code) => code !== 'CSCI 4360');
assert.ok(
  auditUgaBoard({ ...auditInput, priorCodes: pendingRemoved }).issues.some(
    (issue) => issue.id.startsWith('uga-pool-28375'),
  ),
  'removing the pending elective reopens the certificate',
);

for (const id of ['17003', '10080']) {
  const pathway = data.guidance.pathways.find((row) => row.id === id);
  const list = D.doubleDawgsCourseList(
    pathway,
    graduate,
    data.byCode,
    data.dualLevelCourses,
  );
  const ds = list.find((row) => row.code === 'CSCI 6360');
  assert.ok(ds?.title && /Data Science/.test(ds.title));
  assert.equal(
    Boolean(ds.option),
    id === '10080',
    'Data Science II sharing follows the chosen pathway, not just MS eligibility',
  );
  if (id === '17003')
    assert.ok(
      list.some((row) => row.code === 'LING 8021' && row.option),
      'published renamed course remains visible',
    );
  if (id === '10080')
    assert.ok(
      list.some((row) => row.code === 'CSCI 8950' && row.option),
      'graduate-only sharing is not dropped for lack of a dual number',
    );
}
const shared = {
  code: 'CSCI 6540',
  undergraduateCode: 'CSCI 4540',
  credits: 3,
};
const combined = {
  ...board,
  terms: [
    ...board.terms.map((term) => ({
      ...term,
      courseIds: [data.byCode.get(shared.code).id],
    })),
    {
      id: 'fall-2027',
      label: 'Fall 2027',
      season: 'Fall',
      year: 1,
      courseIds: [],
    },
  ],
  doubleDawgs: {
    pathwayId: '17003',
    pathwayName: 'Cognitive Science AB/Artificial Intelligence MS',
    undergraduateFinish: { season: 'Spring', year: 2027 },
    graduateFinish: { season: 'Spring', year: 2028 },
    sharedNotBefore: { season: 'Fall', year: 2026 },
    shared: [shared],
    maxSharedCredits: 12,
    undergraduateCredits: 120,
    graduateCredits: 31,
  },
};
const before = auditUgaBoard({ ...auditInput, board: combined, graduate });
const replaced = {
  ...combined,
  terms: combined.terms.map((term) =>
    term.id === 'spring-2027'
      ? { ...term, courseIds: [data.byCode.get('LING 4570').id] }
      : term,
  ),
};
const after = auditUgaBoard({ ...auditInput, board: replaced, graduate });
assert.ok(
  ugaProgressLoss(before, after),
  'a UG replacement cannot silently lose graduate/shared credit',
);
assert.equal(before.ledger.sharedCredits, 3);
assert.equal(after.ledger.sharedCredits, 0);
assert.ok(after.target > before.target);

// Illinois still has one allocation ledger unless its caller opts into sharing.
const block = {
  id: 'a',
  areaLabel: 'A',
  label: 'A',
  hours: 3,
  note: '',
  url: '',
  rule: {
    kind: 'pool',
    hours: 3,
    n: null,
    choices: [{ codes: ['CSCI 3360'] }],
    lists: [],
    constraints: [],
  },
};
const base = (id) => ({
  requirementId: id,
  areaLabel: id,
  label: id,
  picked: [],
  fromPriorCredit: [],
  alternatives: ['CSCI 3360'],
  hoursTarget: 3,
  countTarget: null,
  listed: 1,
  available: 1,
  constraints: [],
});
const separate = livePools({
  base: [base('a'), base('b')],
  blocks: [block, { ...block, id: 'b' }],
  priorCodes: ['CSCI 3360'],
  boardCodes: [],
  context,
});
assert.equal(
  separate.reduce((sum, pool) => sum + pool.hours, 0),
  3,
);
const relevanceInput = {
  priorities: {
    relevance: 1,
    coverage: 0,
    workload: 0,
    teaching: 0,
    schedule: 0,
  },
  interestWords: ['healthcare', 'patient', 'records', 'intelligence'],
  primarySubject: null,
  degreeSubjects: new Set(),
  wantedTags: new Set(),
};
const topicCourse = {
  code: 'TEST 4000',
  title: 'Artificial Intelligence',
  cluster: 'TEST',
  tags: [],
  credits: 3,
};
assert.ok(
  scoreQuality(
    {
      ...topicCourse,
      description: 'Intelligence models for healthcare and patient records.',
    },
    relevanceInput,
  ).score >
    scoreQuality(
      {
        ...topicCourse,
        description: 'Artificial intelligence in literature and agriculture.',
      },
      relevanceInput,
    ).score,
  'catalog topic coverage breaks broad AI title ties',
);

const selectedProgram = data.programs.find((program) => program.id === '96447');
const selections = Object.fromEntries(
  U.ugaSelectionRequirements(selectedProgram).map((row) => [
    row.id,
    row.options.slice(0, row.minimum).map((option) => option.id),
  ]),
);
const focused = U.loadUgaProgram(data, selectedProgram, {
  emphasisSelections: selections,
});
const combinedSource = {
  ...undergraduate,
  blocks: [...focused.blocks, ...minor.blocks, ...certificate.blocks],
  program: {
    ...undergraduate.program,
    areas: [focused, minor, certificate].flatMap((source) =>
      source.program.areas
        .filter((area) => !/^(?:general|free) electives/i.test(area.label))
        .map((area) => ({
          ...area,
          label: `${source.program.name}: ${area.label}`,
        })),
    ),
  },
};
const pathway = data.guidance.pathways.find((row) => row.id === '17003');
const generated = D.generateDoubleDawgs({
  undergraduate: {
    requirements: combinedSource.blocks,
    context,
    programName: combinedSource.program.name,
    programId: combinedSource.program.id,
    prior: {
      known: true,
      courseCodes: priorCodes,
      exemptCodes: T.transcriptExemptCodes(transcript),
      unmatchedCredits: 0,
    },
    horizon: {
      startSeason: 'Spring',
      startYear: 2027,
      gradSeason: 'Spring',
      gradYear: 2030,
      stated: true,
    },
    degreeTotal: 120,
    fillToDegreeTotal: true,
    interests: 'Healthcare and patient records using artificial intelligence.',
  },
  undergraduateProgram: combinedSource.program,
  graduate,
  pathway,
  shared: D.selectSharedCourses(
    pathway,
    D.doubleDawgsOptions(
      pathway,
      combinedSource,
      graduate,
      data.byCode,
      data.dualLevelCourses,
    ),
    ['CSCI 6540'],
    priorCodes,
  ),
  graduateFinish: { season: 'Spring', year: 2031 },
});
const generatedAudit = auditUgaBoard({
  ...auditInput,
  board: generated.plan,
  undergraduate: combinedSource,
  graduate,
});
assert.deepEqual(
  generatedAudit.areas
    .filter((row) => !row.satisfied)
    .map((row) => [row.area.label, row.earned]),
  [],
  'partial transcripts generate complete major, minor, certificate and graduate areas',
);
assert.deepEqual(
  generatedAudit.issues
    .filter((issue) => issue.id.startsWith('uga-pool-'))
    .map((issue) => issue.message),
  [],
  'required prior courses cannot also occupy elective slots within the same area',
);
console.log(
  'PASS UGA credit, certificate, minor, shared-course list and edited-board audit regressions',
);
