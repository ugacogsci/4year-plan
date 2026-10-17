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
const D = await import('./double-dawgs.ts');
const A = await import('./autoplan.ts');
const { DEFAULT_PRIORITIES } = await import('./priorities.ts');
const U = await import('../../components/planner/uga-source.tsx');
const { livePools, poolShortfalls } =
  await import('../../components/planner/live-pools.ts');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) =>
  new Response(
    readFileSync(join(ROOT, 'public', String(url).replace(/^\//, ''))),
  );
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
assert.ok(data);

for (const id of ['17003', '10080']) {
  const pathway = data.guidance.pathways.find((pathway) => pathway.id === id);
  const program = data.programs.find(
    (program) => program.id === pathway.undergraduateProgramIds[0],
  );
  const selections = Object.fromEntries(
    U.ugaSelectionRequirements(program).map((row) => [
      row.id,
      row.options.slice(0, row.minimum).map((option) => option.id),
    ]),
  );
  const undergraduate = U.loadUgaProgram(data, program, {
    emphasisSelections: selections,
  });
  const graduate = D.withDoubleDawgsGraduateRules(
    U.loadUgaProgram(
      data,
      data.programs.find(
        (program) => program.id === pathway.graduateProgramIds[0],
      ),
      { resetRequirements: false },
    ),
    data.context,
  );
  const options = D.doubleDawgsOptions(
    pathway,
    undergraduate,
    graduate,
    data.byCode,
    data.dualLevelCourses,
  );
  const shared = D.selectSharedCourses(pathway, options);
  assert.ok(
    shared.length >= 2,
    `${pathway.name}: source-backed shared courses`,
  );
  assert.ok(shared.reduce((sum, course) => sum + course.credits, 0) <= 12);
  assert.equal(D.selectSharedCourses(pathway, options, []).length, 0);
  assert.ok(
    !D.selectSharedCourses(pathway, options, undefined, [
      shared[0].undergraduateCode,
    ]).some((course) => course.code === shared[0].code),
  );
  const input = {
    undergraduate: {
      requirements: undergraduate.blocks,
      context: data.context,
      programName: program.name,
      programId: program.id,
      prior: {
        known: true,
        courseCodes: ['ENGL 1101'],
        exemptCodes: [],
        unmatchedCredits: 0,
      },
      horizon: {
        startSeason: 'Fall',
        startYear: 2027,
        gradSeason: 'Spring',
        gradYear: 2031,
        stated: true,
      },
      degreeTotal: program.totalCredits,
      electiveHoursLimit: undergraduate.electiveHours,
      fillToDegreeTotal: undergraduate.fillToDegreeTotal,
      preferences: {
        creditsPerTerm: { min: 12, target: 15, max: 18 },
        priorities: DEFAULT_PRIORITIES,
      },
    },
    undergraduateProgram: undergraduate.program,
    graduate,
    pathway,
    shared,
    graduateFinish: { season: 'Spring', year: 2032 },
  };
  const generated = D.generateDoubleDawgs(input);
  const progress = D.doubleDawgsProgress(
    generated.plan,
    data.context,
    undergraduate.program,
    graduate.program,
    ['ENGL 1101'],
  );
  assert.deepEqual(
    progress
      .filter((row) => !row.satisfied)
      .map((row) => [row.area.label, row.earned, row.area.hours]),
    [],
    'both degree requirement checklists are complete',
  );
  const validation = A.validatePlan(
    generated.plan,
    D.doubleDawgsContext(generated.plan, data.context),
    { minimumTermCredits: 0, priorCredits: 3 },
  );
  assert.deepEqual(
    validation
      .filter((row) => row.severity === 'error')
      .map((row) => row.message),
    [],
    'combined prerequisites remain valid',
  );
  const ledger = D.doubleDawgsLedger(generated.plan, data.context, [
    'ENGL 1101',
  ]);
  const graduateIds = new Set(graduate.blocks.map((block) => block.id));
  const pools = livePools({
    base: generated.pools.filter((pool) => graduateIds.has(pool.requirementId)),
    blocks: graduate.blocks,
    boardCodes: ledger.graduateCodes,
    priorCodes: [],
    context: data.context,
    reserveRequired: true,
    independentIds: new Set(['double-dawgs:ai-graduate-only']),
  });
  assert.deepEqual(
    poolShortfalls(pools),
    [],
    "live master's pools agree with degree progress after trimming",
  );
  const courses = generated.plan.terms.flatMap((term) => term.courseIds);
  assert.equal(
    new Set(courses).size,
    courses.length,
    'every scheduled class occurs once',
  );
  assert.ok(generated.plan.terms.some((term) => term.label.includes('2032')));
  assert.ok(
    generated.plan.doubleDawgs.shared.length,
    'at least one shared course fits',
  );
  assert.ok(ledger.undergraduateCredits >= 120, JSON.stringify(ledger));
  assert.ok(ledger.graduateCredits >= 31, JSON.stringify(ledger));
  assert.equal(ledger.requiredUniqueCredits, 151 - ledger.sharedCredits);
  assert.ok(
    generated.plan.terms.every(
      (term) =>
        D.degreeTermOrder(term) <= D.degreeTermOrder(input.graduateFinish),
    ),
  );
  assert.ok(
    generated.plan.terms.every(
      (term) =>
        A.planCreditRange(
          term.courseIds.map(
            (id) => data.courses.find((course) => course.id === id).code,
          ),
          data.context,
        ).min <= 18,
    ),
  );
  const chosen = generated.plan.doubleDawgs.shared[0];
  const chosenId = data.byCode.get(chosen.code).id;
  const undergraduateId = data.byCode.get(chosen.undergraduateCode).id;
  assert.ok(
    !courses.includes(undergraduateId),
    'never schedule both numbers of the shared class',
  );
  const removed = {
    ...generated.plan,
    terms: generated.plan.terms.map((term) => ({
      ...term,
      courseIds: term.courseIds.filter((id) => id !== chosenId),
    })),
  };
  const afterRemoval = D.doubleDawgsLedger(removed, data.context, [
    'ENGL 1101',
  ]);
  assert.equal(
    afterRemoval.sharedCredits,
    ledger.sharedCredits - chosen.credits,
  );
  assert.equal(
    afterRemoval.undergraduateCredits,
    ledger.undergraduateCredits - chosen.credits,
  );
  assert.equal(
    afterRemoval.graduateCredits,
    ledger.graduateCredits - chosen.credits,
  );
  const moved = structuredClone(removed);
  moved.terms.at(-1).courseIds.push(chosenId);
  const afterMove = D.doubleDawgsLedger(moved, data.context, ['ENGL 1101']);
  assert.equal(afterMove.graduateCredits, ledger.graduateCredits);
  assert.equal(
    afterMove.undergraduateCredits,
    ledger.undergraduateCredits - chosen.credits,
  );
  assert.ok(
    D.doubleDawgsIssues(moved, data.context, ['ENGL 1101']).some(
      (issue) => issue.courseId === chosenId && issue.severity === 'warning',
    ),
  );
  const earned = D.generateDoubleDawgs({
    ...input,
    undergraduate: {
      ...input.undergraduate,
      prior: {
        ...input.undergraduate.prior,
        courseCodes: ['ENGL 1101', chosen.code],
      },
    },
  });
  assert.ok(
    !earned.plan.terms.some((term) => term.courseIds.includes(chosenId)),
    'completed shared course is not rebooked',
  );
  assert.deepEqual(
    [...earned.plan.completedCourseIds].sort(),
    [data.byCode.get('ENGL 1101').id, chosenId].sort(),
    'a shared course never creates a second completed undergraduate alias',
  );
  assert.equal(earned.credits.prior, 3 + chosen.credits);
  const early = structuredClone(removed);
  early.terms[0].courseIds.push(chosenId);
  assert.equal(
    D.doubleDawgsLedger(early, data.context, ['ENGL 1101']).sharedCredits,
    afterRemoval.sharedCredits,
  );
  assert.ok(
    D.doubleDawgsIssues(early, data.context, ['ENGL 1101']).some((issue) =>
      issue.id.startsWith('double-dawgs-early-'),
    ),
  );
  assert.deepEqual(
    D.doubleDawgsLedger(
      JSON.parse(JSON.stringify(generated.plan)),
      data.context,
      ['ENGL 1101'],
    ),
    ledger,
    'saved JSON retains combined accounting',
  );
  const undergraduateHeld = D.doubleDawgsLedger(
    generated.plan,
    data.context,
    ['ENGL 1101', 'MATH 2250'],
    20,
  );
  assert.equal(
    undergraduateHeld.graduateCredits,
    ledger.graduateCredits,
    'undergraduate/AP/transfer hours never become graduate hours',
  );
  if (id === '17003') {
    const missingCurriculum = D.generateDoubleDawgs({
      ...input,
      shared: [],
      graduate: {
        ...graduate,
        blocks: [],
        program: { ...graduate.program, areas: [] },
      },
    });
    assert.ok(
      missingCurriculum.plan.terms.some(
        (term) =>
          D.degreeTermOrder(term) >
          D.degreeTermOrder({ season: 'Spring', year: 2031 }),
      ),
    );
    assert.equal(
      D.doubleDawgsLedger(missingCurriculum.plan, data.context, ['ENGL 1101'])
        .graduateCredits,
      0,
      'unknown curricula do not generate arbitrary graduate electives',
    );
    assert.ok(
      D.doubleDawgsIssues(missingCurriculum.plan, data.context, [
        'ENGL 1101',
      ]).some(
        (issue) =>
          issue.id === 'double-dawgs-curriculum' && issue.severity === 'error',
      ),
    );
    const noSharing = D.generateDoubleDawgs({
      ...input,
      shared: [],
      graduateFinish: { season: 'Spring', year: 2033 },
    });
    assert.equal(
      D.doubleDawgsLedger(noSharing.plan, data.context, ['ENGL 1101'])
        .sharedCredits,
      0,
    );
  }
  assert.throws(
    () =>
      D.generateDoubleDawgs({
        ...input,
        graduateFinish: { season: 'Spring', year: 2031 },
      }),
    /after the bachelor's/,
  );
  console.log(
    `PASS ${pathway.name}: ${ledger.undergraduateCredits} UG + ${ledger.graduateCredits} graduate, ${ledger.sharedCredits} shared; ${generated.plan.terms.length} terms`,
  );
  console.log(
    'Shared:',
    generated.plan.doubleDawgs.shared.map((row) => row.code).join(', '),
  );
  console.log(
    'Unplaced:',
    generated.notPlaced.map((row) => row.code),
  );
}

// A different discipline uses the same two-stage machinery, without AI overrides.
const fixtureCourses = [
  'TEST 1000',
  'TEST 2000',
  'TEST 4000',
  'TEST 6000',
  'TEST 7000',
].map((code) => ({
    id: code.toLowerCase().replace(' ', '-'),
  code,
  title: code,
  credits: 3,
  description: '',
  cluster: 'TEST',
  requirementIds: [],
  prerequisites: [],
  offeredIn: ['Fall', 'Spring'],
  offeringKnown: true,
  format: 'In person',
  tags: [],
}));
const fixtureBlock = (id, codes) => ({
  id,
  areaId: id,
  areaLabel: id,
  label: id,
  hours: codes.length * 3,
  note: '',
  url: '',
  rule: {
    kind: 'all',
    choices: codes.map((code) => ({ codes: [code], credits: 3 })),
  },
});
const fixtureSource = (id, codes) => ({
  program: {
    id,
    name: id,
    college: 'TEST',
    totalCredits: codes.length * 3,
    areas: [
      {
        label: id,
        hours: codes.length * 3,
        groups: [
          {
            label: id,
            choose: null,
            courses: codes.map((code) => ({ code, title: code, credits: 3 })),
          },
        ],
      },
    ],
  },
  blocks: [fixtureBlock(id, codes)],
});
const fixtureUndergraduate = fixtureSource('Test BS', [
  'TEST 1000',
  'TEST 2000',
  'TEST 4000',
]);
const fixtureGraduate = fixtureSource('Test MS', ['TEST 6000', 'TEST 7000']);
const fixtureContext = {
  schoolId: 'uga',
  courses: fixtureCourses,
  prereqs: new Map(),
  offeringPublished: new Set(fixtureCourses.map((course) => course.code)),
};
const fixture = D.generateDoubleDawgs({
  undergraduate: {
    requirements: fixtureUndergraduate.blocks,
    context: fixtureContext,
    programName: 'Test BS',
    programId: 'Test BS',
    degreeTotal: 9,
    prior: {
      known: true,
      courseCodes: [],
      exemptCodes: [],
      unmatchedCredits: 0,
    },
    horizon: {
      startSeason: 'Fall',
      startYear: 2026,
      gradSeason: 'Spring',
      gradYear: 2028,
      stated: true,
    },
    preferences: { creditsPerTerm: { min: 0, target: 3, max: 18 } },
  },
  undergraduateProgram: fixtureUndergraduate.program,
  graduate: fixtureGraduate,
  pathway: {
    id: 'other',
    name: 'Test BS/Test MS',
    bachelors: 'Test BS',
    graduate: 'Test MS',
    url: '',
    sharedCourseCodes: ['TEST 6000'],
    undergraduateProgramIds: ['Test BS'],
    graduateProgramIds: ['Test MS'],
  },
  shared: [{ code: 'TEST 6000', undergraduateCode: 'TEST 4000', credits: 3 }],
  graduateFinish: { season: 'Spring', year: 2029 },
});
const fixtureLedger = D.doubleDawgsLedger(fixture.plan, fixtureContext, []);
assert.equal(fixtureLedger.undergraduateCredits, 9, JSON.stringify({terms:fixture.terms,notPlaced:fixture.notPlaced,notes:fixture.notes}));
assert.equal(fixtureLedger.graduateCredits, 6);
assert.equal(fixtureLedger.sharedCredits, 3);
assert.equal(fixtureLedger.requiredUniqueCredits, 12);
assert.ok(
  D.doubleDawgsProgress(
    fixture.plan,
    fixtureContext,
    fixtureUndergraduate.program,
    fixtureGraduate.program,
    [],
  ).every((row) => row.satisfied),
);
console.log(
  'PASS generic pathway, credit isolation, shared-course removal/moves, completed-course rebuild, save/reload and missing-curriculum safeguards',
);
