// Cross-school regressions: use the shipped UGA adapter, not a second parser.
// Run: node --experimental-strip-types lib/planner/__uga-integration.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
register('data:text/javascript,' + encodeURIComponent(`
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
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
    return next(url, ctx);
  }
`));
const O = await import('./onboarding.ts');
const S = await import('./saved-board.ts');
const T = await import('./transcript.ts');
const A = await import('./autoplan.ts');
const R = await import('./repick.ts');
const { DEFAULT_PRIORITIES } = await import('./priorities.ts');
const G = await import('./uga-planning-guidance.ts');
const publicJson = (name) => JSON.parse(readFileSync(join(ROOT, 'public', name), 'utf8'));
const table = publicJson('uga-exam-credit.json').entries;
const exam = (match, kind = 'AP', level = null, score = 5) => ({
  kind, level, score, exam: table.find((row) => row.kind === kind && match.test(row.exam)).exam,
});
const ab = exam(/Calculus AB/), bc = exam(/Calculus BC/);
assert.equal(O.applyExamCredit([ab, bc], table).credits, 8);
assert.equal(O.applyExamCredit([bc, ab], table).credits, 8);
assert.equal(O.applyExamCredit([exam(/English Language/), exam(/English Literature/)], table).credits, 6);
assert.equal(O.applyExamCredit([exam(/^Italian$/, 'IB', 'SL', 7)], table).credits, 10);
console.log('PASS overlapping UGA exam awards');

const storageMap = new Map();
const storage = {
  getItem: (key) => storageMap.get(key) ?? null,
  setItem: (key, value) => storageMap.set(key, value),
  removeItem: (key) => storageMap.delete(key),
};
const plan = { schemaVersion: 1, programId: 'uga-test', graduationLabel: 'Fall 2026', terms: [{ id: 'fall-2026', label: 'Fall 2026', season: 'Fall', year: 2026, courseIds: [] }], completedCourseIds: [] };
const groups = [{ id: 'group-1', name: 'Compare', color: '#3485ae' }];
const tabs = [
  { id: 'a', name: 'Original', groupId: 'group-1', plan },
  { id: 'b', name: 'Alternate', groupId: 'group-1', plan: { ...plan, completedCourseIds: ['engl-1101'] } },
];
const legacy = { schemaVersion: 3, schoolId: 'uga', programId: 'uga-test', programIds: ['uga-test', 'uga-other'], minorIds: ['minor'], certificateIds: ['cert'], emphasisSelections: { emphasis: ['cs', 'phil'] }, plan, plans: tabs, planGroups: groups, activePlanId: 'b' };
const migrated = S.migrateLegacyBoard(JSON.stringify(legacy), 'uga');
assert.ok(migrated, 'UGA v3 board can migrate');
assert.deepEqual(migrated.plans, tabs.map((tab) => ({ ...tab, issueSeverity: null, issueSummary: undefined })));
assert.deepEqual(migrated.emphasisSelections, legacy.emphasisSelections);
const report = { pools: [], electives: [{ code: 'PHIL 2010', why: 'Chosen for interests' }], language: null };
migrated.plans[1].board = { plan: tabs[1].plan, report, notes: ['Alternate note'], studentAdded: ['phil-2010'], repickedFor: 'test', edited: true };
S.writeSavedBoard(storage, S.serializeBoard(migrated));
const restored = S.readSavedBoard(storage, 'uga');
assert.equal(restored.activePlanId, 'b');
assert.deepEqual(restored.programIds, legacy.programIds);
assert.deepEqual(restored.planGroups, groups);
assert.equal(restored.plans[1].board.report.electives[0].code, 'PHIL 2010');
assert.deepEqual(restored.plans[1].board.studentAdded, ['phil-2010']);
console.log('PASS UGA tab, emphasis, minor and certificate persistence');

globalThis.window = { localStorage: storage };
storage.setItem('fourYear.onboarding.v2', JSON.stringify({ schoolId: 'illinois' }));
S.writeSavedBoard(storage, S.serializeBoard({ ...migrated, schoolId: 'illinois', programId: 'las/psychology-bslas' }));
assert.deepEqual(O.loadAnswers().programIds, ['las/psychology-bslas']);
storage.setItem('fourYear.onboarding.v2', JSON.stringify({ ...O.EMPTY_ANSWERS, schoolId: 'uga', programIds: ['96447'], doubleDawgsPathwayId: '17003' }));
assert.equal(O.loadAnswers().doubleDawgsPathwayId, '17003', 'Double Dawgs intent persists');
storage.setItem('fourYear.onboarding.v2', JSON.stringify({ ...O.EMPTY_ANSWERS, schoolId: 'illinois', doubleDawgsPathwayId: '17003' }));
assert.equal(O.loadAnswers().doubleDawgsPathwayId, null, 'A UGA pathway cannot leak into Illinois');
delete globalThis.window;
console.log('PASS exact-program migration for older Illinois setups');

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await import('../../components/planner/uga-source.tsx');
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
assert.ok(data);
const transcript = T.matchTranscript({
  institution: 'University of Georgia', kind: 'transcript', courses: [
    { code: 'ENGL 1101', title: 'English Composition I', credits: 3, grade: 'A', term: 'Fall 2025', status: 'completed' },
  ], exams: [], notes: [],
}, 'test.pdf', data.courses, undefined, null, 'uga');
assert.deepEqual(T.transcriptCodes(transcript), ['ENGL 1101']);
assert.equal(T.transcriptHours(transcript), 0, 'home courses must not be counted twice as transfer hours');
assert.equal(transcript.schoolId, 'uga');
assert.equal(T.isHomeTranscript('University of Illinois Urbana-Champaign', 'uga'), false);
console.log('PASS school-specific transcript matching');

for (const [name, degree] of [['Cognitive Science', 'AB'], ['Computer Science', 'BS'], ['Biology', 'BS'], ['Psychology', 'BS'], ['Artificial Intelligence', 'MS'], ['Artificial Intelligence', 'PhD']]) {
  const program = data.programs.find((p) => p.name.toLowerCase().includes(name.toLowerCase()) && p.degree.toLowerCase() === degree.toLowerCase());
  assert.ok(program, name + ' ' + degree + ' is available');
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((r) => [r.id, r.options.slice(0, r.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
  const graduate = U.isUgaGraduateDegree(program);
  const context = graduate ? data.context : { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [program.id])) };
  const input = {
    requirements: loaded.blocks, context, programName: loaded.program.name, programId: program.id,
    prior: { known: true, courseCodes: ['ENGL 1101'], exemptCodes: [], unmatchedCredits: 0 },
    horizon: { startSeason: 'Spring', startYear: 2027, gradSeason: 'Fall', gradYear: graduate ? 2029 : 2030, stated: true },
    degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
    preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: DEFAULT_PRIORITIES },
    ...(graduate ? { standingHours: { freshman: 0, sophomore: 0, junior: 0, senior: 0 }, electiveLevelRange: { min: 600, maxExclusive: 1000 }, autoPrerequisiteLevelRange: { min: 600, maxExclusive: 1000 } } : {}),
  };
  const generated = A.generatePlan(input);
  const codes = generated.plan.terms.flatMap((t) => t.courseIds).map((id) => data.courses.find((c) => c.id === id)?.code);
  assert.ok(codes.length, 'nonempty draft for ' + name);
  assert.ok(!codes.includes('ENGL 1101'), 'already-taken course excluded on rebuild');
  assert.equal(new Set(codes).size, codes.length, 'no duplicate courses');
  assert.ok(generated.plan.terms.every((t) => t.year <= input.horizon.gradYear));
  assert.ok(!generated.notes.some((n) => /Grainger|Gies|at Illinois/.test(n)), 'Illinois-only guidance never leaks into UGA plans');
  if (graduate) {
    const byCode = new Map(data.courses.map((course) => [course.code, course]));
    const marks = R.planMarks(generated, byCode);
    const repicked = R.repickBoard({
      context: data.context, requirements: loaded.blocks, board: generated.plan,
      marks, pools: generated.pools, prior: input.prior, interests: 'robotics and machine learning',
      career: 'medical school', programName: loaded.program.name, priorities: DEFAULT_PRIORITIES,
      minimumTermCredits: 12, priorCredits: 3, degreeTotal: program.totalCredits,
      standingHours: input.standingHours, electiveLevelRange: input.electiveLevelRange,
    });
    assert.ok(repicked.changes.every((change) => {
      const level = Number(change.to.match(/\d/)?.[0]) * 100;
      return level >= 600 && level < 1000;
    }), 'graduate re-picks never add undergraduate courses or Illinois career-track courses');
  }
  console.log('PASS UGA ' + name + ' ' + degree + ': ' + codes.length + ' courses');
}
