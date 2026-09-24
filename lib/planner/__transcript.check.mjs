/**
 * The incoming-credit arithmetic, checked against the shipped catalog.
 *
 * Every case here was wrong once on 2026-09-23: Parkland lines merged into an
 * Illinois record counted as Illinois residence; a 5-hour course matched to a
 * 4-hour Illinois course lost the extra hour; a held cross-listed course was
 * totalled once per name (CS 107 counted as twelve hours); AP credit the
 * student picked and their Illinois record also listed was counted twice;
 * quarter hours were read as semester hours; a score report matched nothing.
 *
 *   node lib/planner/__transcript.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }`));
const T = await import(join(HERE, 'transcript.ts'));
const A = await import(join(HERE, 'autoplan.ts'));
const E = await import(join(ROOT, 'components', 'planner', 'exam-credit.ts'));
const read = (p) => JSON.parse(readFileSync(join(ROOT, 'public', p), 'utf8'));
const rows = read('illinois/index.json');
const catalog = rows.map((r) => ({ code: r.code, title: r.title, credits: r.credits, level: r.level, cluster: r.cluster, tags: r.tags }));
const norm = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const ctx = { courses: rows, equivalents, exclusions: new Map(Object.entries(read('illinois/exclusions.json'))) };
const table = read('illinois-exam-credit.json').entries;

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};
const line = (code, title, credits, extra = {}) => ({ code, title, credits, grade: 'A', term: 'Fall 2024', status: 'completed', ...extra });
const doc = (institution, courses, extra = {}) => ({ institution, kind: 'transcript', courses, exams: [], notes: [], ...extra });

const home = T.matchTranscript(doc('University of Illinois Urbana-Champaign', [line('CS 124', 'Intro CS', 3)]), 'a', catalog);
const park = T.matchTranscript(doc('Parkland College', [line('MAT 128', 'Calculus I', 5), line('SOC 101', 'Introduction to Sociology', 3), line('CHE 101', 'General Chemistry I', 4)]), 'b', catalog);
check('each line keeps its school', park.courses.map((c) => c.from), ['Parkland College', 'Parkland College', 'Parkland College']);
check('merged record: only Illinois lines are residence', T.transcriptResidentHours({ ...home, courses: [...home.courses, ...park.courses] }), { total: 3, upper: 0 });
check('likely equivalents', T.transcriptCodes(park), ['MATH 221', 'SOC 100', 'CHEM 102', 'CHEM 103']);
check('earned hours vs catalog hours (5->4, 3->4, 4->3+1)', T.transcriptCreditAdjustment(park), 0);
const two = T.matchTranscript(doc('Parkland College', [line('MAT 128', 'Calculus I', 5), line('PHY 141', 'Physics I: Mechanics', 5)]), 'c', catalog);
check('two 5-hour courses keep their extra hours', T.transcriptCreditAdjustment(two), 2);
const quarter = T.matchTranscript(doc('Harper College', [line('PSY 101', 'Introduction to Psychology', 6), line('ART 105', 'Ceramics Studio', 4.5)], { hoursUnit: 'quarter' }), 'q', catalog);
check('quarter hours converted at two-thirds', quarter.courses.map((c) => c.credits), [4, 3]);
check('a converted line counted as hours', T.transcriptHours(quarter), 3);
const record = T.matchTranscript(doc('University of Illinois Urbana-Champaign', [line('ECON 1--', 'Elective (AP Macro 4)', 3, { status: 'exam' })]), 'd', catalog);
check('test credit on the record as subject hours', [...T.transcriptIndirectCodes(record)], ['ECON 1--']);
const macro = table.find((e) => e.kind === 'AP' && e.exam === 'ECON MACRO' && String(e.score) === '4');
check('AP credit on the record is not counted again', E.examElectiveHours([{ kind: 'AP', exam: macro.exam, level: null, score: 4 }], table, T.transcriptIndirectCodes(record)), 0);
check('a held cross-listed class counts once', A.distinctHeld(['CS 107', 'IS 107', 'STAT 107'], ctx).codes, ['CS 107']);
check('of two courses that do not both earn credit, the smaller counts', A.distinctHeld(['MATH 220', 'MATH 221'], ctx).codes, ['MATH 221']);
const found = [
  { kind: 'AP', exam: 'Calculus AB', score: '5' }, { kind: 'AP', exam: 'Macroeconomics', score: '4' }, { kind: 'IB', exam: 'Biology HL', score: '6' },
  { kind: 'AP', exam: 'United States History', score: '4' }, { kind: 'AP', exam: 'Chemistry', score: '2' },
];
check('score report exams priced by the table', E.matchDocumentExams(found, table, false).map((e) => `${e.kind} ${e.exam}${e.level ? ` ${e.level}` : ''} ${e.score}`), [
  'AP CALCULUS AB - Entering Any College other than Grainger 5', 'AP ECON MACRO 4', 'IB BIOLOGY HL 6', 'AP HISTORY, U.S. 4',
]);
check('Grainger students get the Grainger calculus table', E.matchDocumentExams(found.slice(0, 1), table, true).map((e) => e.exam), ['CALCULUS AB - Entering Grainger']);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nall transcript checks passed');
process.exit(failed ? 1 : 0);
