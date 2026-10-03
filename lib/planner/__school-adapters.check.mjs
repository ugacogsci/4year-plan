/** Real school loaders -> real requirement adapters -> shared deterministic engine. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

register(new URL('../../scripts/test-loader.mjs', import.meta.url));
const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const failures = new Set();
const requests = [];
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = {};
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'https://planner.test');
  assert.equal(url.origin, 'https://planner.test', 'adapter tests must not access the network');
  requests.push(url.pathname);
  if (failures.has(url.pathname)) return new Response('Unavailable', { status: 404 });
  const path = resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
  assert(path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep), 'asset path stays inside public');
  try {
    return new Response(await readFile(path), { headers: { 'content-type': 'application/json' } });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return new Response('Unavailable', { status: 404 });
  }
};

try {
  const { illinoisAdapter, ugaAdapter, schoolAdapter } = await import('../../components/planner/school-source.ts');
  const { resetIllinoisCache } = await import('./illinois-load.ts');
  const { generatePlan, validatePlan, interestProfileOf } = await import('./autoplan.ts');
  const { planMarks, repickBoard } = await import('./repick.ts');
  const { PRIORITY_PRESETS } = await import('./priorities.ts');

  assert.equal(schoolAdapter('tamu'), null);
  assert.equal(schoolAdapter('unknown-school'), null);
  assert.equal(schoolAdapter('illinois'), illinoisAdapter);
  assert.equal(schoolAdapter('uga'), ugaAdapter);

  // Exercise failure before success so both production memoizers must recover.
  failures.add('/illinois/index.json');
  assert.equal(await illinoisAdapter.load(), null, 'missing Illinois catalog cannot create a demo plan');
  failures.clear();
  resetIllinoisCache();
  failures.add('/illinois/prereqs.json');
  assert.equal(await illinoisAdapter.load(), null, 'missing Illinois prerequisite artifact cannot silently pass');
  failures.clear();
  resetIllinoisCache();
  failures.add('/uga-catalog.json');
  assert.equal(await ugaAdapter.load(), null, 'missing UGA catalog cannot create a demo plan');
  failures.clear();
  failures.add('/uga-programs.json');
  assert.equal(await ugaAdapter.load(), null, 'missing UGA requirements cannot create a demo plan');
  failures.clear();

  const illinois = await illinoisAdapter.load();
  const uga = await ugaAdapter.load();
  assert(illinois && uga, 'both real school catalogs load after a failed request');
  const illinoisCodes = new Set(illinoisAdapter.courses(illinois).map((course) => course.code));
  const ugaCodes = new Set(ugaAdapter.courses(uga).map((course) => course.code));
  assert(illinoisCodes.has('CS 225') && !illinoisCodes.has('CSCI 1301'));
  assert(ugaCodes.has('CSCI 1301') && !ugaCodes.has('CS 225'));
  assert.equal(illinoisAdapter.capabilities.graduatePrograms, false);
  assert.equal(ugaAdapter.capabilities.graduatePrograms, true);
  assert(illinoisAdapter.programs(illinois).every((program) => !/^(MS|PHD)$/.test(program.degree)));
  assert(ugaAdapter.programs(uga).some((program) => program.degree === 'MS'));
  assert(illinoisAdapter.context(illinois).prereqs.get('CS 225').groups.some((group) => group.any.includes('CS 128')), 'Illinois prerequisite alternatives survive loading');
  assert(ugaAdapter.context(uga).prereqs.get('CSCI 1302').groups.some((group) => group.any.includes('CSCI 1301')), 'UGA prerequisite alternatives survive loading');
  assert.equal(await illinoisAdapter.loadProgram(illinois, { ...illinoisAdapter.programs(illinois)[0], id: 'missing-program' }), null, 'a missing degree page cannot reuse another degree');

  const cases = [
    [illinoisAdapter, illinois, 'engineering/computer-science-bs', 128, false],
    [illinoisAdapter, illinois, 'las/psychology-bslas', 120, false],
    [illinoisAdapter, illinois, 'bus/finance-bs', 124, false],
    [ugaAdapter, uga, '73962', 120, false],
    [ugaAdapter, uga, '96447', 120, false],
    [ugaAdapter, uga, '69115', 120, false],
    [ugaAdapter, uga, '84091', 32, true],
  ];
  for (const [adapter, data, id, expectedTotal, graduate] of cases) {
    const summary = adapter.programs(data).find((program) => program.id === id);
    assert(summary, `${adapter.id}: missing representative degree ${id}`);
    const loaded = await adapter.loadProgram(data, summary, { resetRequirements: true });
    assert(loaded, `${adapter.id}: program ${id} loads its real requirement data`);
    assert.equal(loaded.summary.totalCredits, expectedTotal);
    assert(loaded.blocks.length > 0, `${summary.name}: requirement blocks exist`);
    const context = adapter.context(data, loaded.blocks);
    assert.equal(context.schoolId, adapter.id);
    assert.equal(context.courses, adapter.courses(data));
    assert(context.prereqs.size > 0, `${summary.name}: prerequisites reach the engine`);
    const byId = new Map(context.courses.map((course) => [course.id, course]));
    const catalogCodes = adapter.id === 'illinois' ? illinoisCodes : ugaCodes;
    const prior = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish' };
    const input = {
      context, requirements: loaded.blocks, prior,
      horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: graduate ? 2028 : 2030, stated: true },
      preferences: { creditsPerTerm: { min: graduate ? 6 : 12, target: graduate ? 9 : 15, max: 18 } },
      programId: id, programName: loaded.program.name, programCollege: loaded.program.college,
      degreeTotal: expectedTotal, career: '', firstYear: !graduate,
      electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      ...(graduate ? {
        standingHours: { freshman: 0, sophomore: 0, junior: 0, senior: 0 },
        electiveLevelRange: { min: 600, maxExclusive: 1000 },
        autoPrerequisiteLevelRange: { min: 600, maxExclusive: 1000 },
      } : {}),
    };
    const generated = generatePlan(input);
    const repeated = generatePlan(input);
    assert.deepEqual(repeated.plan, generated.plan, `${summary.name}: identical inputs yield identical plans`);
    if (adapter.id === 'uga' && id === '69115') {
      const premed = generatePlan({ ...input, career: 'medical school', interests: 'Psychology medical school' });
      assert(!premed.notes.some((note) => /illinois\.edu|Pre-Medicine Guide|pre-health@|Career Center/.test(note)), 'UGA goals never recommend Illinois guides or offices');
      assert(!premed.electives.some((row) => row.track), 'UGA cannot label courses as satisfying an Illinois career track');
      const profile = interestProfileOf('medical school and machine learning', 'uga');
      assert.equal(profile.tracks.length, 0);
      assert.equal(profile.courses.length, 0);
      assert.equal(profile.apply.length, 0);
      assert(profile.words.length > 0, 'UGA still receives topic words for relevance ranking');
      assert(interestProfileOf('medical school', 'illinois').tracks.length > 0, 'school profile caches stay separate');
      const repickInput = {
        context, requirements: loaded.blocks, board: premed.plan,
        marks: planMarks(premed, new Map(context.courses.map((course) => [course.code, course]))),
        pools: premed.pools, prior, interests: 'Psychology medical school', career: 'medical school',
        programName: loaded.program.name, programCollege: loaded.program.college,
        priorities: PRIORITY_PRESETS.lightest, minimumTermCredits: 12, priorCredits: 0,
        degreeTotal: expectedTotal,
      };
      const repicked = repickBoard(repickInput);
      assert.equal(repicked.unchanged, false, 'UGA re-pick runs rather than taking the signature shortcut');
      assert.deepEqual(repickBoard(repickInput), repicked, 'UGA medical-school re-pick is deterministic');
      assert(!repicked.changes.some((change) => change.kind === 'track' || change.track), 'UGA re-pick never applies Illinois career-track policies');
      assert(!/illinois\.edu|Pre-Medicine Guide|pre-health@|Career Center/.test(JSON.stringify(repicked)), 'UGA re-pick never recommends Illinois contacts or guides');
      for (const courseId of repicked.board.terms.flatMap((term) => term.courseIds)) {
        assert(ugaCodes.has(byId.get(courseId)?.code), `UGA medical-school re-pick keeps ${courseId} in its own catalog`);
      }
      assert.equal(validatePlan(repicked.board, context, {
        minimumTermCredits: 12, maxTermCredits: 18, priorCredits: 0,
        programName: loaded.program.name, programCollege: loaded.program.college,
        language: premed.language,
      }).filter((issue) => issue.severity === 'error').length, 0, 'UGA medical-school re-pick preserves hard validation');
    }
    assert(generated.credits.total.min >= expectedTotal, `${summary.name}: reaches the published degree credit target`);
    const plannedIds = generated.plan.terms.flatMap((term) => term.courseIds);
    assert(plannedIds.length > 0, `${summary.name}: produces a populated plan`);
    assert.equal(new Set(plannedIds).size, plannedIds.length, `${summary.name}: no duplicate course booking`);
    for (const courseId of plannedIds) {
      const course = byId.get(courseId);
      assert(course && catalogCodes.has(course.code), `${summary.name}: ${courseId} belongs to this school's catalog`);
      assert.equal(context.creditRanges.get(course.code).min, course.credits, `${course.code}: program-adjusted hours reach engine credit ranges`);
      if (graduate) assert(Number.parseInt(course.code.split(' ')[1], 10) >= 6000, `${summary.name}: no undergraduate prerequisites added`);
    }
    const issues = validatePlan(generated.plan, context, {
      minimumTermCredits: graduate ? 6 : 12, maxTermCredits: 18,
      programName: loaded.program.name, programCollege: loaded.program.college,
      standingHours: input.standingHours, priorCredits: 0, language: generated.language,
    });
    const errors = issues.filter((issue) => issue.severity === 'error');
    console.log(`${adapter.id}: ${summary.name}: ${generated.credits.total.min}/${expectedTotal} credits, ${plannedIds.length} courses, ${errors.length} validation errors, ${generated.unsatisfied.length} unresolved requirements`);
    if (graduate) {
      // The shipped MS page publishes a total but no degree rows. The UGA branch
      // already generated provisional electives and kept undergraduate preparation
      // visible in validation. Preserve that honesty; this is not a verified MS audit.
      assert(loaded.blocks.some((block) => block.rule.kind === 'hours' && block.rule.source === 'parser-gap'));
      assert(generated.unsatisfied.some((row) => row.reason === 'no-course-data'));
      assert.equal(errors.length, 5, 'UGA MS retains the five preparation errors present on origin/uga');
      assert.deepEqual([...new Set(errors.map((issue) => issue.courseId))].sort((a, b) => a.localeCompare(b)), ['envm-6150', 'math-6000', 'span-6092']);
      for (const error of errors) assert(error.id.startsWith('ap-prereq-'), 'graduate exception covers only visible prerequisite preparation, never other validation faults');
    } else {
      assert.equal(errors.length, 0, `${summary.name}: generated plan passes hard validation`);
    }
  }
  assert(requests.includes('/uga-catalog.json') && requests.includes('/illinois/index.json'));
  console.log('Real school adapter checks passed: failures/recovery, catalog isolation, prerequisite alternatives, seven programs, credit ranges, deterministic plans, undergraduate hard validation and explicitly unresolved graduate preparation.');
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
