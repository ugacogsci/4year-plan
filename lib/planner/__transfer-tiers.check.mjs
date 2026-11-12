/**
 * Transfer tiers and wording (lane A1, 2026-11-10).
 *
 * Every transfer line matchTranscript returns carries basis.tier (confirmed,
 * rule, likely, review, unknown) and basis.sourceKind (transfer-sources.ts),
 * and reads through one helper (transfer-wording.ts). This check holds:
 *
 *   1. what lines count as did not move: MADE-UP transcripts from the
 *      transfer measure lane (six senders, three destinations) give the same
 *      counts, courses, hours and AI-step lines as the code before tiers
 *      (a212309), frozen below in EXPECT;
 *   2. every transfer line has a tier and a source that belong together and
 *      to its destination (TRANSFER_LAYERS);
 *   3. 'confirmed' only with a row that exists in a public/ file this
 *      planner loads (UGA's lists, Parkland's gen-ed guide, Georgia Tech's
 *      table), or the student's own document printing the university's
 *      evaluation;
 *   4. the wording: every line has a sentence, a likely line says "Probably"
 *      and "Not confirmed", an unknown line says there is no published answer
 *      and that its hours count for now, and no sentence says a line counts
 *      "until it is evaluated" (the owner's complaint);
 *   5. a record saved before tiers reads the same tier from its old fields
 *      (transfer-sources.ts legacyTier), and Georgia Tech's table hooks are
 *      empty stubs that change nothing.
 *
 *   node lib/planner/__transfer-tiers.check.mjs
 *   node lib/planner/__transfer-tiers.check.mjs --root <dir> --snapshot   (print EXPECT from another checkout's code)
 *   node lib/planner/__transfer-tiers.check.mjs --show                    (each fixture line's tier and sentence)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { register } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const CODE_ROOT = resolve(arg('--root') ?? DATA);
const SNAPSHOT = process.argv.includes('--snapshot');
const SHOW = process.argv.includes('--show');
register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(pathToFileURL(CODE_ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }`));
const T = await import(join(CODE_ROOT, 'lib/planner/transcript.ts'));
const AI = await import(join(CODE_ROOT, 'lib/planner/transfer-ai.ts'));
const read = (p) => JSON.parse(readFileSync(join(DATA, 'public', p), 'utf8'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`FAIL ${msg}`); };
const expect = (ok, msg, got) => { if (!ok) fail(`${msg}${got !== undefined ? ` (got ${typeof got === 'string' ? got : JSON.stringify(got)})` : ''}`); };

// ---- Data, as the browser loads it ----------------------------------------------
const lite = (rows, level) => rows.filter((c) => typeof c?.code === 'string').map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: level(c), cluster: c.cluster, tags: c.tags, ...(c.repeat ? { repeat: c.repeat } : {}) }));
const catalogs = {
  uga: lite(read('uga-catalog.json'), (c) => Number(c.code.match(/\d/)?.[0] ?? 0) * 100),
  illinois: lite(read('illinois/index.json'), (c) => c.level),
  gatech: lite(read('gatech/index.json'), (c) => c.level),
};
const guide = read('illinois-transfer-gened.json');
const ugaTable = { index: read('uga-transfer/index.json'), schools: {} };
for (const f of readdirSync(join(DATA, 'public', 'uga-transfer'))) if (f !== 'index.json') ugaTable.schools[f.replace('.json', '')] = read(`uga-transfer/${f}`);
try {
  const sisterIndex = read('uga-transfer-sisters/index.json');
  ugaTable.sisters = { index: sisterIndex, groups: Object.fromEntries(Object.entries(sisterIndex.groups).filter(([, g]) => g.file).map(([gid, g]) => [gid, read(`uga-transfer-sisters/${g.file}`)])) };
} catch {
  // A checkout from before the sister files has none.
}
let crossListed = null;
try { crossListed = read('uga/course-offerings.json')?.crossListed ?? null; } catch {}

const reading = (institution, lines, extra = {}) => ({
  institution, kind: 'transcript', hoursUnit: 'semester', exams: [], notes: [], credentials: [],
  courses: lines.map(([code, title, credits, grade, term, more]) => ({ code, title, credits, grade, term, status: term === 'Fall 2026' ? 'in_progress' : 'completed', from: null, equivalent: null, equivalentCredits: null, iai: null, genEdText: null, ...(more ?? {}) })),
  ...extra,
});
const match = (here, r, gatechTable = null) => T.matchTranscript(r, 'made-up.pdf', catalogs[here], ['made-up.pdf'], here === 'illinois' ? guide : null, here, here === 'uga' ? ugaTable : null, here === 'uga' ? crossListed : null, gatechTable);

// ---- Fixtures: MADE-UP transcripts from the measure lane (titles as it wrote them) ---
const F = {
  gsu: ['Georgia State University', [
    ['ENGL 1101', 'English Composition I', 3, 'A', 'Fall 2024'], ['MATH 1113', 'Precalculus', 3, 'B', 'Fall 2024'], ['PSYC 1101', 'Introduction to General Psychology', 3, 'A', 'Fall 2024'],
    ['PERS 2001', 'Perspectives on Comparative Culture', 1, 'A', 'Fall 2024'], ['ENGL 0999', 'Support for English Composition', 1, 'S', 'Fall 2024'], ['KH 1065', 'Weight Training', 1, 'A', 'Fall 2024'],
    ['ENGL 1102', 'English Composition II', 3, 'A-', 'Spring 2025'], ['MATH 2211', 'Calculus of One Variable I', 4, 'B', 'Spring 2025'], ['CSC 1301', 'Principles of Computer Science I', 4, 'A', 'Spring 2025'],
    ['POLS 1101', 'American Government', 3, 'A', 'Spring 2025'], ['CHEM 1211K', 'Principles of Chemistry I', 4, 'B', 'Spring 2025'], ['MATH 2212', 'Calculus of One Variable II', 4, 'B-', 'Fall 2025'],
    ['CSC 1302', 'Principles of Computer Science II', 4, 'A-', 'Fall 2025'], ['HIST 2110', 'Survey of United States History', 3, 'A', 'Fall 2025'], ['BIOL 2107K', 'Principles of Biology I', 4, 'B+', 'Fall 2025'],
    ['MATH 1401', 'Elementary Statistics', 3, 'A', 'Fall 2025'], ['ECON 2105', 'Principles of Macroeconomics', 3, 'B', 'Spring 2026'], ['ECON 2106', 'Principles of Microeconomics', 3, 'B+', 'Spring 2026'],
    ['ACCT 2101', 'Principles of Accounting I', 3, 'A-', 'Spring 2026'], ['CSC 2720', 'Data Structures', 3, 'B', 'Spring 2026'], ['FI 3300', 'Corporate Finance', 3, null, 'Fall 2026'],
    ['MK 3010', 'Basic Marketing', 3, null, 'Fall 2026'], ['LGLS 3020', 'Legal Environment of Business', 3, null, 'Fall 2026'],
  ]],
  gwinnettTech: ['Gwinnett Technical College', [
    ['ENGL 1101', 'Composition and Rhetoric', 3, 'A', 'Fall 2024'], ['MATH 1111', 'College Algebra', 3, 'B+', 'Fall 2024'], ['PSYC 1101', 'Introductory Psychology', 3, 'A', 'Fall 2024'],
    ['MATH 0098', 'Elementary Algebra', 3, 'S', 'Fall 2024'], ['PHED 1060', 'Lifetime Fitness', 1, 'A', 'Fall 2024'], ['ENGL 1102', 'Literature and Composition', 3, 'A-', 'Spring 2025'],
    ['MATH 1113', 'Precalculus', 3, 'B', 'Spring 2025'], ['HIST 2111', 'U.S. History I', 3, 'A', 'Spring 2025'], ['SPCH 1101', 'Public Speaking', 3, 'A', 'Spring 2025'],
    ['CIST 1001', 'Computer Concepts', 4, 'A', 'Spring 2025'], ['POLS 1101', 'American Government', 3, 'A', 'Summer 2025'], ['MATH 1127', 'Introduction to Statistics', 3, 'B+', 'Fall 2025'],
    ['BIOL 1111', 'Biology I', 3, 'B', 'Fall 2025'], ['BIOL 1111L', 'Biology Lab I', 1, 'A', 'Fall 2025'], ['ECON 2106', 'Principles of Microeconomics', 3, 'B+', 'Fall 2025'],
    ['ARTS 1101', 'Art Appreciation', 3, 'A', 'Fall 2025'], ['CIST 1305', 'Program Design and Development', 3, 'A-', 'Fall 2025'], ['CHEM 1211', 'Chemistry I', 3, 'B', 'Spring 2026'],
    ['CHEM 1211L', 'Chemistry Lab I', 1, 'A', 'Spring 2026'], ['HIST 2112', 'U.S. History II', 3, 'A', 'Spring 2026'], ['ENGL 2130', 'American Literature', 3, 'A', 'Spring 2026'],
    ['ECON 2105', 'Principles of Macroeconomics', 3, null, 'Fall 2026'], ['MUSC 1101', 'Music Appreciation', 3, null, 'Fall 2026'],
  ]],
  highlands: ['Georgia Highlands College', [
    ['ENGL 1101', 'English Composition I', 3, 'A', 'Fall 2024'], ['MATH 1111', 'College Algebra', 3, 'B', 'Fall 2024'], ['MATH 0997', 'Support for Quantitative Reasoning', 2, 'S', 'Fall 2024'],
    ['PSYC 1101', 'Introduction to General Psychology', 3, 'A', 'Fall 2024'], ['PHED 1010', 'Lifetime Fitness', 1, 'A', 'Fall 2024'], ['ENGL 1102', 'English Composition II', 3, 'A-', 'Spring 2025'],
    ['MATH 1113', 'Precalculus', 4, 'B', 'Spring 2025'], ['HIST 2111', 'United States History I', 3, 'A', 'Spring 2025'], ['COMM 1100', 'Human Communication', 3, 'A', 'Spring 2025'],
    ['SOCI 1101', 'Introduction to Sociology', 3, 'A', 'Spring 2025'], ['BIOL 1107', 'Principles of Biology I', 3, 'B', 'Fall 2025'], ['BIOL 1107L', 'Principles of Biology I Lab', 1, 'A', 'Fall 2025'],
    ['MATH 1401', 'Elementary Statistics', 3, 'A', 'Fall 2025'], ['POLS 1101', 'American Government', 3, 'A', 'Fall 2025'], ['ENGL 2111', 'World Literature I', 3, 'A', 'Fall 2025'],
    ['ECON 2105', 'Principles of Macroeconomics', 3, 'B', 'Spring 2026'], ['ACCT 2101', 'Principles of Accounting I', 3, 'B+', 'Spring 2026'], ['CHEM 1211', 'Principles of Chemistry I', 3, 'B', 'Spring 2026'],
    ['CHEM 1211L', 'Principles of Chemistry I Lab', 1, 'A', 'Spring 2026'], ['ARTS 1100', 'Art Appreciation', 3, 'A', 'Spring 2026'], ['MATH 2253', 'Calculus I', 4, null, 'Fall 2026'],
    ['BUSA 2106', 'The Environment of Business', 3, null, 'Fall 2026'], ['CRJU 1100', 'Introduction to Criminal Justice', 3, null, 'Fall 2026'],
  ]],
  parkland: ['Parkland College', [
    ['ENG 101', 'English Composition I', 3, 'A', 'Fall 2024'], ['MAT 128', 'Calculus and Analytic Geometry I', 5, 'B', 'Fall 2024'], ['PSY 101', 'Introduction to Psychology', 3, 'A', 'Fall 2024'],
    ['MAT 071', 'Introductory Algebra', 4, 'S', 'Fall 2024'], ['KIN 150', 'Fitness and Conditioning', 1, 'A', 'Fall 2024'], ['ENG 102', 'Composition II', 3, 'A-', 'Spring 2025'],
    ['MAT 129', 'Calculus and Analytic Geometry II', 5, 'B', 'Spring 2025'], ['CSC 140', 'Computer Science I (Java)', 4, 'A', 'Spring 2025'], ['SOC 101', 'Introduction to Sociology', 3, 'A', 'Spring 2025'],
    ['CHE 141', 'General Chemistry I', 5, 'B', 'Fall 2025'], ['ECO 101', 'Principles of Macroeconomics', 3, 'B', 'Fall 2025'], ['HIS 104', 'History of the U.S. to 1877', 3, 'A', 'Fall 2025'],
    ['PHI 103', 'Intro to Philosophy', 3, 'A', 'Fall 2025'], ['CSC 220', 'Data Structures', 4, 'B+', 'Fall 2025'], ['PHY 141', 'Mechanics', 4, 'B', 'Spring 2026'],
    ['ECO 102', 'Principles of Microeconomics', 3, 'B+', 'Spring 2026'], ['MAT 160', 'Statistics', 4, 'A', 'Spring 2026'], ['ACC 101', 'Financial Accounting', 4, 'B', 'Spring 2026'],
    ['POS 122', 'American National Government', 3, null, 'Fall 2026'], ['SPE 101', 'Fundamentals of Public Speaking', 3, null, 'Fall 2026'], ['BUS 101', 'Introduction to Business', 3, null, 'Fall 2026'],
    ['MAT 228', 'Calculus and Analytic Geom III', 4, null, 'Fall 2026'],
  ]],
  cod: ['College of DuPage', [
    ['ENGLI 1101', 'English Composition I', 3, 'A', 'Fall 2024'], ['MATH 1431', 'Precalculus', 5, 'B', 'Fall 2024'], ['PSYCH 1100', 'General Psychology', 3, 'A', 'Fall 2024'],
    ['MATH 0482', 'Foundations for College Math', 4, 'P', 'Fall 2024'], ['KINES 1501', 'Weight Training', 1, 'A', 'Fall 2024'], ['ENGLI 1102', 'English Composition II', 3, 'A-', 'Spring 2025'],
    ['MATH 2231', 'Calculus & Analytic Geometry I', 5, 'B', 'Spring 2025'], ['SPEEC 1100', 'Fundamentals of Speech Communication', 3, 'A', 'Spring 2025'], ['SOCIO 1100', 'Introduction to Sociology', 3, 'A', 'Spring 2025'],
    ['CIS 1400', 'Programming Logic and Technique', 4, 'A', 'Spring 2025'], ['MATH 2232', 'Calculus & Analytic Geometry II', 5, 'C', 'Fall 2025'], ['CHEMI 1551', 'General Chemistry I', 5, 'B', 'Fall 2025'],
    ['ECONO 2201', 'Principles of Macroeconomics', 3, 'B', 'Fall 2025'], ['HISTO 1140', 'History of the United States I', 3, 'A', 'Fall 2025'], ['ECONO 2202', 'Principles of Microeconomics', 3, 'B+', 'Spring 2026'],
    ['ACCOU 1140', 'Financial Accounting', 4, 'B', 'Spring 2026'], ['PHILO 1100', 'Introduction to Philosophy', 3, 'A', 'Spring 2026'], ['MATH 1635', 'Introduction to Statistics', 4, 'A', 'Spring 2026'],
    ['PHYSI 2111', 'General Physics I: Mechanics', 5, null, 'Fall 2026'], ['POLS 1100', 'American Politics', 3, null, 'Fall 2026'], ['BUSIN 1100', 'Introduction to Business', 3, null, 'Fall 2026'],
  ]],
  uga: ['University of Georgia', [
    ['ENGL 1101', 'English Composition I', 3, 'A', 'Fall 2024'], ['MATH 1113', 'Precalculus', 3, 'B+', 'Fall 2024'], ['HIST 2111', 'American History to 1865', 3, 'A-', 'Fall 2024'],
    ['PSYC 1101', 'Elementary Psychology', 3, 'A', 'Fall 2024'], ['FYOS 1001', 'First-Year Odyssey Seminar', 1, 'S', 'Fall 2024'], ['PEDB 1950', 'Fitness for Life Walking', 1, 'A', 'Fall 2024'],
    ['ENGL 1102', 'English Composition II', 3, 'A-', 'Spring 2025'], ['MATH 2250', 'Calculus I for Science and Engineering', 4, 'B', 'Spring 2025'], ['CHEM 1211', 'General Chemistry I', 3, 'B', 'Spring 2025'],
    ['CHEM 1211L', 'General Chemistry Laboratory I', 1, 'A', 'Spring 2025'], ['POLS 1101', 'American Government', 3, 'A', 'Spring 2025'], ['ECON 2106', 'Principles of Microeconomics', 3, 'B+', 'Fall 2025'],
    ['STAT 2000', 'Introductory Statistics', 4, 'A-', 'Fall 2025'], ['BIOL 1107', 'Principles of Biology I', 3, 'B', 'Fall 2025'], ['BIOL 1107L', 'Principles of Biology I Laboratory', 1, 'A', 'Fall 2025'],
    ['SPAN 1001', 'Elementary Spanish I', 3, 'A', 'Fall 2025'], ['ECON 2105', 'Principles of Macroeconomics', 3, 'B', 'Spring 2026'], ['ACCT 2101', 'Principles of Accounting I', 3, 'B+', 'Spring 2026'],
    ['CSCI 1301', 'Introduction to Computing and Programming', 4, 'A-', 'Spring 2026'], ['MIST 2090', 'Introduction to Information Systems in Business', 3, 'A', 'Spring 2026'],
    ['FINA 3000', 'Financial Management', 3, null, 'Fall 2026'], ['MARK 3000', 'Principles of Marketing', 3, null, 'Fall 2026'],
  ]],
  ugaOwner: ['University of Georgia', [
    ['LEGL 2700', 'Legal and Regulatory Environment of Business', 3, null, 'Fall 2026'], ['LEGL 4750', 'Corporations, Law, and Society', 3, null, 'Fall 2026'],
    ['LEGL 5250', 'Legal Risk: Management, Strategy, and Communication', 3, null, 'Fall 2026'], ['MARK 4650S', 'Digital Marketing Analytics', 3, null, 'Fall 2026'],
    ['PEDB 1340', 'Pickleball', 1, null, 'Fall 2026'], ['SPTM 3800', 'Sports, Media, and Society', 3, null, 'Fall 2026'],
  ]],
};
const RUNS = [['uga', 'gsu'], ['uga', 'gwinnettTech'], ['uga', 'highlands'], ['illinois', 'parkland'], ['illinois', 'cod'], ['gatech', 'uga'], ['gatech', 'gsu'], ['gatech', 'ugaOwner']];

/** What the plan reads from a line: counts, courses, hours, designation, gen-ed tags. */
const outcome = (c) => `${c.use ? c.counts : 'off'}|${[c.matched, ...(c.also ?? [])].filter(Boolean).join('+')}|${c.matchedBy ?? ''}|${c.equivalentCredits ?? ''}|${c.illinoisCredits ?? ''}|${c.designation ?? ''}|${(c.genEdTags ?? []).join(',')}|${c.status}`;
const aiCount = (here, rec) => (here === 'uga' || here === 'illinois' ? AI.unsettledLines(rec, catalogs[here], here).length : 0);

if (SNAPSHOT) {
  const out = {};
  for (const [here, key] of RUNS) {
    const rec = match(here, reading(F[key][0], F[key][1]));
    out[`${here}:${key}`] = { ai: aiCount(here, rec), lines: rec.courses.map(outcome) };
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}

const S = await import(join(CODE_ROOT, 'lib/planner/transfer-sources.ts'));
const W = await import(join(CODE_ROOT, 'lib/planner/transfer-wording.ts'));
const G = await import(join(CODE_ROOT, 'lib/planner/transfer-gatech.ts'));

// ---- 1. Outcomes unchanged from a212309 (labels only) ------------------------------
// From: node lib/planner/__transfer-tiers.check.mjs --root <a212309 checkout> --snapshot
const EXPECT = JSON.parse(readFileSync(join(HERE, '__transfer-tiers.expect.json'), 'utf8'));
const records = [];
for (const [here, key] of RUNS) {
  const rec = match(here, reading(F[key][0], F[key][1]));
  records.push([here, key, rec]);
  const want = EXPECT[`${here}:${key}`];
  if (!want) { fail(`${here}:${key}: no frozen outcome`); continue; }
  rec.courses.forEach((c, i) => expect(outcome(c) === want.lines[i], `${here} <- ${key} ${c.code}: what it counts as changed`, `${want.lines[i]} -> ${outcome(c)}`));
  expect(aiCount(here, rec) === want.ai, `${here} <- ${key}: lines sent to the AI step changed`, `${want.ai} -> ${aiCount(here, rec)}`);
}

// ---- Edge cases: every kind of answer -------------------------------------------------
const L = (code, title, credits, grade, more = {}) => [code, title, credits, grade, 'Fall 2024', more];
/** A real UGA row naming only courses the catalog lacks (a lab it books with its lecture, or a course it does not list). */
function missingRow(lab) {
  const known = new Set(catalogs.uga.map((c) => c.code));
  for (const entry of ugaTable.index.schools) {
    const file = ugaTable.schools[entry.key];
    if (!file) continue;
    for (const [k, results] of Object.entries(file.courses)) {
      if (results.length !== 1 || /^NTFR|\dGHX|\dG.X|\dTXX/.test(results[0]) || known.has(T.normalizeCourseCode(results[0]))) continue;
      if (lab !== /L$/.test(results[0])) continue;
      const code = k.replace(/^([A-Z]+)(\d.*)$/, '$1 $2');
      return { school: entry.name, code, result: results[0] };
    }
  }
  return null;
}
const labRow = missingRow(true);
const plainRow = missingRow(false);
expect(labRow && plainRow, 'UGA lists hold rows naming a lab and a course the catalog lacks (to test their wording)');
const edge = {
  labOnly: labRow && match('uga', reading(labRow.school, [L(labRow.code, 'Lab', 1, 'A')])),
  missing: plainRow && match('uga', reading(plainRow.school, [L(plainRow.code, 'A course', 3, 'A')])),
  sister: match('uga', reading('Athens Technical College', [L('COLL 1000', 'Orientation to College', 3, 'A'), L('WELD 1000', 'Introduction to Welding Technology', 3, 'A')])),
  peCap: match('uga', reading('Georgia State University', [L('KH 1010', 'Physical Activity: Weight Training', 2, 'A'), L('KH 1065', 'Weight Training', 1, 'A')])),
  ugaRecord: match('uga', reading('University of Georgia', [L('HIST 1GHX', 'Comprehensive US History', 3, 'TB', { from: 'Georgia State University' }), L('NTFR 0TXX', 'Not Transferable', 4, 'TA', { from: 'Athens Technical College' }), L('ENGL 1101', 'English Composition I', 3, 'TA', { from: 'Georgia State University' })])),
  printed: match('illinois', { ...reading('Parkland College', [L('PSY 101', 'Introduction to Psychology', 3, 'A', { equivalent: 'PSYC 100' }), L('HIS 199', 'Topics in History', 3, 'A', { equivalent: 'HIST 1--' })]), kind: 'transfer_report' }),
  illinoisRecord: match('illinois', reading('University of Illinois Urbana-Champaign', [L('ECON 1--', 'Transfer Economics', 3, 'TA', { from: 'Parkland College' }), L('PSYC 100', 'Intro Psych', 4, 'A')])),
  iai: match('illinois', reading('Illinois Central College', [L('PSY 115', 'Human Behavior and Society', 3, 'A', { iai: 'S6 900' }), L('ENG 109', 'Writing Studio', 3, 'A', { iai: 'C2 900' })])),
  repeat: match('illinois', reading('Parkland College', [L('PSY 101', 'Introduction to Psychology', 3, 'D'), ['PSY 101', 'Introduction to Psychology', 3, 'B', 'Spring 2025']])),
  vocational: match('illinois', reading('College of DuPage', [L('AUT 101', 'Automotive Fundamentals', 4, 'A')])),
  dGrade: match('gatech', reading('Georgia State University', [L('PSYC 1101', 'Introduction to General Psychology', 3, 'D')])),
  docNoCredit: match('uga', reading('Georgia State University', [['ENGL 0999', 'Support', 1, 'S', 'Fall 2024', { status: 'no_credit' }]])),
};
// The AI step's answers, applied the way the browser applies them (no model is called).
const isu = match('illinois', reading('Illinois State University', [L('ENG 101', 'Composition as Critical Inquiry', 3, 'A'), L('ECO 105', 'Principles of Economics', 4, 'A'), L('KNR 150', 'Physical Activity: Tennis', 1, 'A'), L('PSY 111', 'Introduction to Psychology', 3, 'A')]));
const asked = AI.unsettledLines(isu, catalogs.illinois, 'illinois');
const verdicts = ['equivalent-high', 'equivalent-medium', 'elective', 'no_credit'];
const decisions = asked.map((l, i) => {
  const v = verdicts[i % 4];
  const code = v.startsWith('equivalent') ? l.candidates[0]?.code ?? '' : '';
  return { line: l.line, verdict: v.startsWith('equivalent') ? 'equivalent' : v, code, subject: 'KIN', level: 100, confidence: v === 'equivalent-medium' ? 'medium' : 'high', reason: 'made-up decision for the check' };
});
const aiRec = AI.applyDecisions(isu, asked, decisions, catalogs.illinois, 'illinois');
expect(asked.length >= 3, 'the AI fixture sends lines to the AI step', asked.length);

// ---- 2-4. Tiers, sources, rows, wording on every transfer line --------------------------
const rowExists = (row) => {
  const [file, key] = String(row ?? '').split('#');
  if (!file || !key || !existsSync(join(DATA, 'public', file))) return false;
  const data = read(file);
  if (file.startsWith('uga-transfer/')) return Array.isArray(data.courses?.[key]) && data.courses[key].length > 0;
  if (file === 'illinois-transfer-gened.json') { const [school, code] = key.split('|'); return Boolean(data.schools?.find((s) => s.name === school)?.courses?.[code]); }
  if (file.startsWith('gatech-transfer/')) return key.split('+').every((id) => data.rows?.some((r) => r.id === id));
  return false;
};
const tally = {};
const all = [...records, ...Object.entries(edge).filter(([, r]) => r).map(([k, r]) => [r.schoolId, `edge:${k}`, r]), ['illinois', 'edge:ai', aiRec]];
for (const [here, key, rec] of all) {
  for (const c of rec.courses) {
    const foreign = T.lineIsForeign(rec, c);
    if (!c.basis) {
      expect(!foreign, `${here} <- ${key} ${c.code}: a transfer line with no basis (so no tier)`);
      continue;
    }
    const b = c.basis;
    const at = `${here} <- ${key} ${c.code}`;
    expect(['confirmed', 'rule', 'likely', 'review', 'unknown'].includes(b.tier), `${at}: tier set`, b.tier);
    expect(S.SOURCE_KINDS[b.sourceKind], `${at}: a known source kind`, b.sourceKind);
    const own = S.SOURCE_KINDS[b.sourceKind]?.tier;
    const repeatKeeps = /already counts as /.test(b.text);
    expect(own === b.tier || (b.sourceKind === 'ai' && b.tier === 'unknown') || (repeatKeeps && b.tier === 'likely'), `${at}: tier ${b.tier} goes with source ${b.sourceKind}`);
    expect(S.TRANSFER_LAYERS[here]?.includes(b.sourceKind), `${at}: source ${b.sourceKind} is one ${here} asks`);
    if (b.tier === 'confirmed' && b.sourceKind !== 'document') {
      expect(rowExists(b.row), `${at}: confirmed without a row that exists in a loaded public/ file`, b.row);
      expect(Boolean(b.readAt), `${at}: a confirmed list row says when it was read`);
    }
    if (b.tier === 'confirmed' && b.sourceKind === 'document') expect(/record|document/i.test(`${b.sourceLabel ?? ''} ${b.text}`), `${at}: a document's answer names the document`, b);
    const legacy = S.legacyTier({ ...c, basis: { ...b, tier: undefined, sourceKind: undefined } });
    expect(legacy?.tier === b.tier, `${at}: a record saved before tiers reads the same tier`, `${legacy?.tier}/${legacy?.sourceKind} vs ${b.tier}/${b.sourceKind}`);
    const w = W.transferWording(c, { schoolId: here, catalog: new Map(catalogs[here].map((k) => [k.code, k])) });
    expect(w && w.sentence.length > 10 && w.short.length > 3 && w.chip, `${at}: a sentence, a short form and a chip`);
    if (!w) continue;
    const words = [w.sentence, w.detail ?? '', w.short].join(' | ');
    expect(!W.RETIRED_WORDING.test(words), `${at}: never "until it is evaluated"`, words);
    if (b.tier === 'likely') expect(/^Probably\b/.test(w.sentence) && /Not confirmed/.test(w.sentence), `${at}: a likely line says "Probably" and "Not confirmed"`, w.sentence);
    // A Georgia Tech line whose table credit comes with a lab or lecture this record does not credit is answered by the table: section 5 holds its own wording.
    if (b.tier === 'unknown' && !S.labWaiting(c)) expect(/^No published answer for this class yet\. .+ decides when it reviews your transcript\. (Counted as .+|Not counted) for now\.$/.test(w.sentence), `${at}: an unknown line's sentence`, w.sentence);
    if (b.tier === 'review') expect(/hasn't reviewed this class\. Its department decides after you're admitted\./.test(w.sentence), `${at}: a review line's sentence`, w.sentence);
    if (b.tier === 'confirmed' && b.badge !== 'none') expect(/^Counts /.test(w.sentence), `${at}: a confirmed line starts "Counts"`, w.sentence);
    if (b.tier !== 'likely' && b.tier !== 'review' && b.tier !== 'unknown') expect(!/\bprobably\b/i.test(w.sentence) || b.sourceKind === 'vocational-rule', `${at}: only likely lines say "probably"`, w.sentence);
    tally[b.tier] = (tally[b.tier] ?? 0) + 1;
    if (SHOW) console.log(`${at.padEnd(52)} ${b.tier}/${b.sourceKind}${b.row ? ` ${b.row}` : ''}\n    ${w.chip}: ${w.sentence}${w.detail ? `\n    (${w.detail})` : ''}`);
  }
}

// ---- Specific answers -----------------------------------------------------------------
const one = (rec, code) => rec?.courses.find((c) => c.code === code);
if (labRow) {
  const c = edge.labOnly.courses[0];
  const w = W.transferWording(c, { schoolId: 'uga', catalog: new Map(catalogs.uga.map((k) => [k.code, k])) });
  expect(c.counts === 'hours' && c.basis.tier === 'confirmed' && c.basis.sourceKind === 'uga-list' && c.basis.named?.includes(T.normalizeCourseCode(labRow.result)), `a UGA answer naming ${labRow.result} (catalog books it with its lecture) is confirmed, counted as hours`, c.basis);
  expect(/: the lab for /.test(w?.sentence ?? '') && /ORION books that lab together with its lecture/.test(w?.sentence ?? ''), `${labRow.result}'s sentence names the lab and its lecture`, w?.sentence);
}
if (plainRow) {
  const c = edge.missing.courses[0];
  const w = W.transferWording(c, { schoolId: 'uga', catalog: new Map(catalogs.uga.map((k) => [k.code, k])) });
  expect(c.basis.tier === 'confirmed' && new RegExp(`^Counts as ${T.normalizeCourseCode(plainRow.result)} at UGA`).test(w?.sentence ?? '') && /course list doesn't include/.test(w?.sentence ?? ''), `a UGA answer naming ${plainRow.result} (not in the catalog) reads as UGA's answer, counted as hours`, w?.sentence);
}
expect(one(edge.sister, 'COLL 1000')?.basis?.tier === 'likely' && one(edge.sister, 'COLL 1000')?.basis?.sourceKind === 'sister', "UGA's answer at sister schools is likely, not confirmed", one(edge.sister, 'COLL 1000')?.basis);
expect(['rule', 'likely'].includes(one(edge.sister, 'WELD 1000')?.basis?.tier), 'a technical-college welding course: a rule or the sister schools settle it', one(edge.sister, 'WELD 1000')?.basis?.tier);
expect(edge.peCap.courses.some((c) => c.basis?.sourceKind === 'pe-cap-rule' && c.basis.tier === 'rule'), "UGA's one-hour PE cap is a rule", edge.peCap.courses.map((c) => c.basis?.sourceKind));
expect(one(edge.ugaRecord, 'HIST 1GHX')?.basis?.tier === 'confirmed' && one(edge.ugaRecord, 'HIST 1GHX')?.basis?.sourceKind === 'document', "UGA's own record's HIST 1GHX is confirmed by the document", one(edge.ugaRecord, 'HIST 1GHX')?.basis);
expect(/U\.S\. history requirement/.test(W.transferWording(one(edge.ugaRecord, 'HIST 1GHX'), { schoolId: 'uga' })?.sentence ?? ''), 'GHX says it meets the U.S. history requirement');
const printedCourse = one(edge.printed, 'PSY 101');
const printedHours = one(edge.printed, 'HIS 199');
expect(printedCourse?.matchedBy === 'printed' && printedCourse.basis?.tier === 'confirmed' && printedCourse.basis.sourceKind === 'document', 'a printed equivalent is confirmed by the document', printedCourse?.basis);
expect(printedHours?.counts === 'hours' && printedHours.basis?.tier === 'confirmed' && /HIST 1--/.test(W.transferWording(printedHours, { schoolId: 'illinois' })?.sentence ?? ''), 'a printed "HIST 1--" is confirmed subject hours', printedHours?.basis);
expect(!AI.unsettledLines(edge.printed, catalogs.illinois, 'illinois').some((l) => edge.printed.courses[l.line] === printedHours), "the document's own HIST 1-- is never sent to the AI step (transfer-ai.ts: a printed equivalent is never overridden)");
expect(one(edge.illinoisRecord, 'ECON 1--')?.basis?.tier === 'confirmed', "an Illinois record's transfer line in subject hours is confirmed by the record", one(edge.illinoisRecord, 'ECON 1--')?.basis);
expect(!one(edge.illinoisRecord, 'PSYC 100')?.basis, 'a home course gets no transfer basis');
expect(one(edge.iai, 'PSY 115')?.basis?.sourceKind === 'iai-rule' && one(edge.iai, 'PSY 115').basis.tier === 'rule', "an IAI code's category is a rule", one(edge.iai, 'PSY 115')?.basis);
expect(edge.repeat.courses[1]?.basis?.sourceKind === 'repeat-rule' && edge.repeat.courses[1].basis.tier === 'rule' && edge.repeat.courses[1].counts === 'none', 'a repeat counts once, by rule', edge.repeat.courses[1]?.basis);
expect(edge.vocational.courses[0]?.basis?.sourceKind === 'vocational-rule', 'a vocational course is the vocational rule', edge.vocational.courses[0]?.basis);
expect(edge.dGrade.courses[0]?.basis?.sourceKind === 'grade-rule' && /C or better/.test(W.transferWording(edge.dGrade.courses[0], { schoolId: 'gatech' })?.sentence ?? ''), "Georgia Tech's C-or-better rule", edge.dGrade.courses[0]?.basis);
expect(edge.docNoCredit.courses[0]?.basis?.sourceKind === 'document' && edge.docNoCredit.courses[0].basis.tier === 'confirmed', 'a line the document says earns nothing is confirmed by the document');
const aiKinds = aiRec.courses.filter((c) => c.basis?.sourceKind === 'ai').map((c) => `${c.basis.badge}:${c.basis.tier}`);
expect(aiKinds.includes('course:likely') && aiKinds.includes('not-evaluated:unknown') && aiKinds.includes('elective:likely'), "the AI step's answers: a high equivalent and an elective are likely, a \"may be\" or a no-credit flag is unknown", aiKinds);

// ---- Summary line and the board's column --------------------------------------------------
for (const [here, key, rec] of records) {
  const d = T.describeTransfer(rec, here);
  expect(d && !W.RETIRED_WORDING.test(d) && /^Transfer lines: /.test(d), `${here} <- ${key}: the summary line names tiers, not "not yet evaluated"`, d);
  expect(!rec.notes.some((n) => W.RETIRED_WORDING.test(n) || /until (UGA|Illinois|Georgia Tech) evaluates it/.test(n)), `${here} <- ${key}: no note says a line counts until it is evaluated`, rec.notes);
}
const workspace = readFileSync(join(DATA, 'components/planner/planner-workspace.tsx'), 'utf8');
const upload = readFileSync(join(DATA, 'components/planner/transcript-upload.tsx'), 'utf8');
expect(!/until it is evaluated/.test(workspace), 'the board no longer says "Counts as elective hours here until it is evaluated"');
expect(/countsAs: transferWording\(/.test(workspace), "the board's column of classes at another school reads transferWording");
// The school a sentence names is the record's own (a record still matched for UGA never says "at Illinois"), then the board's.
expect(/transferWording\(c, \{ schoolId: record\.schoolId \?\? school\?\.id/.test(upload) && !/basisBadge\(/.test(upload), "the transcript review rows read transferWording for the record's own school, not the old badge");
expect(/transferWording\(c, \{ schoolId: record\.schoolId \?\? answers\?\.schoolId/.test(workspace) && /transferWording\(c, \{ schoolId: record\?\.schoolId \?\? L\.answers\?\.schoolId/.test(workspace), "the board's column and the assistant's prior_credit name the record's own school");

// ---- 5. Georgia Tech's table: school lookup, row lookup, the owner's classes ------------------
const fakeIndex = { readAt: '2026-11-10', sourceUrl: 'https://oscar.gatech.edu/pls/bprod/wwsktrna.P_find_location', schools: [
  { code: '005813', name: 'University of Georgia', state: 'GA', rows: 1, file: '005813.json' },
  { code: '001603', name: 'University of West Georgia', state: 'GA', rows: 0, file: null },
] };
const fakeTable = { index: fakeIndex, schools: { '005813': { code: '005813', name: 'University of Georgia', state: 'GA', readAt: '2026-11-10', rows: [{ id: 'LEGL 2700@201105', subj: 'LEGL', num: '2700', title: 'Legal & Reg Envirn of Business', minGrade: 'C-', from: '201105', to: null, gt: [{ code: 'MGT 2106', title: 'Legal Aspects-Business', hours: 3 }], conn: null, flags: [] }] } } };
expect(G.gatechSchoolEntry(fakeIndex, 'University of Georgia')?.code === '005813' && G.gatechSchoolEntry(fakeIndex, 'University of West Georgia')?.code === '001603' && G.gatechSchoolEntry(fakeIndex, 'Georgia State University') === null, "Georgia Tech's index finds a school by its name, never a lookalike");
expect(G.gatechLookup(fakeTable, 'University of Georgia', 'LEGL 2700')?.rows[0]?.id === 'LEGL 2700@201105' && G.gatechLookup(fakeTable, 'University of Georgia', 'LEGL 4750') === null && G.gatechLookup(fakeTable, 'University of West Georgia', 'LEGL 2700') === null, "gatechLookup finds the row for the school and code, and nothing for a class or school the table lacks");
// OSCAR prints short names ("Abraham Baldwin Agriclt Coll"): a transcript's full name is recognised through UGA's index, keyed by the same code.
if (existsSync(join(DATA, 'public', 'gatech-transfer', 'index.json'))) {
  const real = read('gatech-transfer/index.json');
  const abac = real.schools.find((x) => x.code === '005001');
  if (abac) expect(G.gatechSchoolEntry(real, 'Abraham Baldwin Agricultural College', ugaTable.index)?.code === '005001', "Georgia Tech's table finds Abraham Baldwin from its full name, through UGA's index", abac.name);
  // Names are abbreviated differently ("Univ of North Georgia"), so the first four letters are compared, and most must agree.
  const shared = real.schools.filter((x) => ugaTable.index.schools.some((u) => u.key === x.code));
  const agree = shared.filter((x) => ugaTable.index.schools.find((u) => u.key === x.code).name.toLowerCase().slice(0, 4) === x.name.toLowerCase().slice(0, 4));
  expect(shared.length === 0 || agree.length >= 0.8 * shared.length, "the school codes Georgia Tech's table shares with UGA's index name the same schools", `${agree.length} of ${shared.length}`);
}
const withTable = match('gatech', reading(F.ugaOwner[0], F.ugaOwner[1]), fakeTable);
const without = match('gatech', reading(F.ugaOwner[0], F.ugaOwner[1]));
{
  // The owner's own six classes (Nov 10): LEGL 2700 is MGT 2106 on Georgia Tech's table; the five it lacks match as before.
  const legl = withTable.courses.find((c) => c.code === 'LEGL 2700');
  expect(legl?.matched === 'MGT 2106' && legl.counts === 'course' && legl.basis?.sourceKind === 'gatech-table' && legl.basis?.tier === 'confirmed' && legl.basis?.row === 'gatech-transfer/005813.json#LEGL 2700@201105', "Georgia Tech's table makes LEGL 2700 MGT 2106, confirmed, with its row", legl?.basis);
  const rest = (rec) => JSON.stringify(rec.courses.filter((c) => c.code !== 'LEGL 2700'));
  expect(rest(withTable) === rest(without), "a class Georgia Tech's table lacks matches exactly as without the table");
}
// A made-up Kennesaw State page with CHEM 1211 and no lab line: Georgia Tech's table gives its credit with CHEM 1211L, so the line says that, never "no published answer".
if (existsSync(join(DATA, 'public', 'gatech-transfer', 'index.json'))) {
  const real = read('gatech-transfer/index.json');
  const ksu = G.gatechSchoolEntry(real, 'Kennesaw State University', ugaTable.index);
  if (ksu && ksu.rows > 0 && ksu.file !== null && existsSync(join(DATA, 'public', 'gatech-transfer', ksu.file ?? `${ksu.code}.json`))) {
    const table = { index: real, schools: { [ksu.code]: read(`gatech-transfer/${ksu.file ?? `${ksu.code}.json`}`) } };
    const rec = match('gatech', reading('Kennesaw State University', [['CHEM 1211', 'Principles of Chemistry I', 3, 'B', 'Fall 2025'], ['ENGL 1102', 'English Composition II', 3, 'A', 'Fall 2025']]), table);
    const chem = rec.courses.find((c) => c.code === 'CHEM 1211');
    const w = chem ? W.transferWording(chem, { schoolId: 'gatech' }) : null;
    const off = chem ? W.transferWording({ ...chem, use: false, counts: 'none' }, { schoolId: 'gatech' }) : null;
    const summary = T.describeTransfer(rec, 'gatech') ?? '';
    expect(chem && S.labWaiting(chem)?.pair === 'lab' && w?.chip === 'Needs its lab' && /together with its lab, CHEM 1211L, and no lab line on this record earns it\. Counted as 3 hours for now\./.test(w.sentence) && !/No published answer|No answer yet/i.test(`${w.sentence} ${w.short} ${w.chip}`), 'KSU CHEM 1211 without its lab: the table credits it with CHEM 1211L, counted as its own 3 hours for now', w);
    expect(/^Not counted \(your choice\)\. .*together with its lab/.test(off?.sentence ?? '') && !/Counted as|No published answer/.test(off?.sentence ?? ''), 'turned off, it says so first, then what the table says', off?.sentence);
    expect(/1 whose credit Georgia Tech gives with a lab that earns none on this record \(its hours count for now\)/.test(summary) && !/no published answer/.test(summary), 'the summary lists it apart from lines with no published answer', summary);
  }
}
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  const loaded = await G.loadGatechTransfer(['University of Georgia']).catch(() => 'threw');
  globalThis.fetch = realFetch;
  expect(loaded !== 'threw' && loaded.index === null && Object.keys(loaded.schools).length === 0, 'no Georgia Tech table files yet: the loader returns an empty table, not an error', loaded);
}
expect(S.ruleAnswer({ schoolId: 'illinois', code: 'KIN 150', title: 'Fitness', credits: 1, grade: 'A', term: null, school: 'Parkland College' }) === null && S.ruleAnswer({ schoolId: 'uga', code: 'X 1', title: null, credits: 3, grade: null, term: null, school: null }) === null, 'the Illinois SUBJ 1-- and UGA FAQ rule modules are empty stubs');

console.log(`tiers on fixture and edge lines: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`);
if (failures > 0) {
  console.log(`transfer tiers: ${failures} failed`);
  process.exit(1);
}
console.log('transfer tiers: ok');
