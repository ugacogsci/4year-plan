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

// ---- AP and IB: every row a score earns, as the registrar's table grants it
const O = await import(join(HERE, 'onboarding.ts'));
const priced = (exam, score, level = null, grainger = false) => {
  const taken = E.alignExamsToCollege([{ kind: level ? 'IB' : 'AP', exam, level, score }], table, grainger).exams;
  const courses = E.examCourses(taken, table, (c) => rows.some((r) => norm(r.code) === c));
  const creditsOf = (c) => rows.find((r) => norm(r.code) === c)?.credits ?? null;
  const hours = courses.reduce((sum, c) => sum + (creditsOf(c) ?? 0), 0) + E.examElectiveHours(taken, table, new Set(), creditsOf);
  return { courses: courses.sort(), hours };
};
check('AP Biology 5 earns IB 150 and MCB 150', priced('BIOLOGY', 5), { courses: ['IB 150', 'MCB 150'], hours: 8 });
check('AP Calculus BC 5 earns MATH 220 and MATH 231', priced('CALCULUS BC - Entering Any College other than Grainger', 5), { courses: ['MATH 220', 'MATH 231'], hours: 8 });
check('AP English Literature 5 (with Language 4-5) keeps its ENGL 1-- hours', priced('ENGLISH LITERATURE & COMP', '4 or 5 (if English Language Score is 4 or 5)'), { courses: ['RHET 105'], hours: 7 });
check('AP Latin 5 keeps its LAT 1-- hours', priced('LATIN', 5), { courses: ['LAT 201', 'LAT 202'], hours: 11 });
check('AP Precalculus 4 is in the table (a "3 to 5" cell)', priced('PRECALCULUS', 4), { courses: [], hours: 3 });
check('AP Japanese 5 ("JPAN" in the table) earns JAPN courses', priced('JAPANESE', 5).courses, ['JAPN 203', 'JAPN 204', 'JAPN 305', 'JAPN 306']);
check('AP 2-D Art: a course the catalog lacks still earns its hours', priced('ART STUDIO: 2-D DRAWING', 4), { courses: [], hours: 3 });
check('IB Arabic B SL 5 earns the 3 hours the registrar grants, not the catalog 4', priced('ARABIC B', 5, 'SL').hours, 3);
check('IB Chinese B (Mandarin) SL 6 earns CHIN 203 and 204', priced('CHINESE B - MADARIN', 6, 'SL').courses, ['CHIN 203', 'CHIN 204']);
check('a score below credit earns nothing', priced('CHEMISTRY', 2), { courses: [], hours: 0 });
check('AP English Language and Literature together hold RHET 105 once', O.applyExamCredit([{ kind: 'AP', exam: 'ENGLISH LANGUAGE & COMP', level: null, score: 5 }, { kind: 'AP', exam: 'ENGLISH LITERATURE & COMP', level: null, score: '4 or 5 (if English Language Score is 4 or 5)' }], table).credits, 7);
check('a Grainger degree prices calculus from the Grainger table', E.alignExamsToCollege([{ kind: 'AP', exam: 'CALCULUS AB - Entering Any College other than Grainger', level: null, score: 5 }], table, true).exams[0].exam, 'CALCULUS AB - Entering Grainger');
const official = E.matchDocumentExams([
  { kind: 'AP', exam: 'Physics 1: Algebra-Based', score: '5' }, { kind: 'AP', exam: 'World History: Modern', score: '4' }, { kind: 'AP', exam: 'Spanish Language and Culture', score: '5' },
  { kind: 'IB', exam: 'Mathematics: Analysis and Approaches HL', score: '6' }, { kind: 'IB', exam: 'Spanish ab initio SL', score: '6' }, { kind: 'IB', exam: 'Chinese B SL', score: '6' },
], table, false).map((e) => e.exam);
check('official College Board and IB names resolve (Chinese B with no dialect does not)', official, ['PHYSICS 1', 'HISTORY, WORLD', 'SPANISH LANGUAGE', 'MATH: ANALYSIS & APPROACHES', 'SPANISH B AB INITIO']);
check('an IB exam named with no level is read as SL', E.matchDocumentExams([{ kind: 'IB', exam: 'Biology', score: '6' }], table, false).map((e) => e.level), ['SL']);
check('a Calculus BC 3 with an AB subscore of 4 resolves to that row', E.matchDocumentExams([{ kind: 'AP', exam: 'Calculus BC', score: '3', subscore: '4' }], table, false).map((e) => e.score), ['3 with a subscore of 4 or 5']);
check('a Calculus BC 3 with no subscore takes the row granting least', E.matchDocumentExams([{ kind: 'AP', exam: 'Calculus BC', score: '3' }], table, false).map((e) => e.score), ['3 with a subscore of 0/no subscore or 1, 2, or 3']);

// ---- another school's courses: the published Parkland guide and composition
const guide = read('illinois-transfer-gened.json');
const pk = T.matchTranscript(doc('Parkland College', [line('ENG 101', 'English Composition I', 3), line('ENG 102', 'Composition II', 3), line('HUM 101', 'Western Culture: Antiquity to Renaissance', 3), line('ANT 103', 'Intro to Cultural Anthropology', 3)]), 'p', catalog, ['p'], guide);
check('ENG 101 with ENG 102 is Composition I (RHET 105)', T.transcriptCodes(pk).includes('RHET 105'), true);
check('HUM 101 fills the categories the Parkland guide names', T.transcriptGenEdCredits(pk).find((g) => g.label.startsWith('HUM 101'))?.tags, ['Cultural Studies - Western', 'Humanities - Lit & Arts']);
const one = T.matchTranscript(doc('Parkland College', [line('ENG 101', 'English Composition I', 3)]), 'q', catalog, ['q'], guide);
check('ENG 101 alone is not Composition I', T.transcriptCodes(one).includes('RHET 105'), false);
const report = T.matchTranscript(doc('University of Illinois Urbana-Champaign', [line('HISTO 1110', 'US History to 1865', 3, { status: 'transfer', from: 'College of DuPage', equivalent: 'HIST 1--', equivalentCredits: 3, genEdText: 'Gen Ed: Hist & Phil; US Minority' })], { kind: 'transfer_report' }), 'r', catalog, ['r'], guide);
check('gen eds an evaluation report prints count as categories', T.transcriptGenEdCredits(report)[0]?.tags, ['Humanities - Hist & Phil', 'Cultural Studies - US Minority']);
check('a developmental course never counts', T.matchTranscript(doc('Harper College', [line('MAT 080', 'Intermediate Algebra', 4)]), 'd', catalog).courses[0].counts, 'none');

// ---- cases from the five incoming-student scenarios, September 2026
const spa = T.matchTranscript(doc('Parkland College', [line('SPA 103', 'Intermediate Spanish I', 4), line('SPA 101', 'Beginning Spanish I', 4)]), 's', catalog, ['s'], guide);
check('intermediate Spanish is SPAN 201, not SPAN 101', T.transcriptCodes(spa), ['SPAN 201', 'SPAN 101']);
const portal = T.matchTranscript(doc('Joliet Junior College', [line('PSYC 101', 'General Psychology', null), line('ENG 101', 'Rhetoric I', null), line('ENG 102', 'Rhetoric II', null)]), 'j', catalog);
check('a portal list with no hours assumes 3 per course', portal.courses.map((c) => c.assumedCredits), [3, 3, 3]);
check('ENG 101 and ENG 102 at another college are Composition I, the second as hours', [T.transcriptCodes(portal), T.transcriptHours(portal)], [['PSYC 100', 'RHET 105'], 3]);
const repeat = T.matchTranscript(doc('Parkland College', [line('PSY 101', 'Introduction to Psychology', 3), line('PSY 101', 'Introduction to Psychology', 3, { term: 'Spring 2025' })]), 'r2', catalog, ['r2'], guide);
check('a course on the record twice counts once', repeat.courses.map((c) => c.counts), ['course', 'none']);
check('Grainger gives no hours for STAT 100 or PHYS 101 and 4 for MATH 220', A.heldTowardDegree(['STAT 100', 'MATH 220', 'CS 124', 'PHYS 101'], 'engineering', []), { codes: ['MATH 220', 'CS 124'], hoursOff: 1 });
check('other colleges count STAT 100', A.heldTowardDegree(['STAT 100'], 'las', []).codes, ['STAT 100']);
const setRow = [{ id: 'x::1::0', areaId: 'x::1', areaLabel: 'Major', label: '', hours: null, note: '', url: '', rule: { kind: 'all', choices: [{ codes: ['CHEM 102', 'CHEM 202'], credits: 8, bundles: [['CHEM 102', 'CHEM 103', 'CHEM 104', 'CHEM 105'], ['CHEM 202', 'CHEM 203', 'CHEM 204', 'CHEM 205']] }] } }];
const priorOf = (codes) => ({ courseCodes: codes, exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 0, languageName: null, genEdCredits: [] });
check('"select one group": the first set, labs and second semester included', A.resolveBundles(setRow, priorOf([]), ctx)[0].rule.choices.map((c) => c.codes[0]), ['CHEM 102', 'CHEM 103', 'CHEM 104', 'CHEM 105']);
check('"select one group": the set the student already holds part of', A.resolveBundles(setRow, priorOf(['CHEM 202']), ctx)[0].rule.choices.map((c) => c.codes[0]), ['CHEM 202', 'CHEM 203', 'CHEM 204', 'CHEM 205']);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nall transcript checks passed');
process.exit(failed ? 1 : 0);
