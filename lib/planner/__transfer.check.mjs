/**
 * Transfer credit, both universities: a fixed list of made-up transcript
 * lines and what the university's own sources say each one becomes.
 *
 * Expected outcomes come from official sources only, named on each case:
 *   Portal [key]  UGA Admissions' Transfer Equivalency Search, read 2026-10-14
 *                 (https://apply.uga.edu/portal/transfer-equivalency?cmd=search&ceeb=<key>),
 *                 the same rows public/uga-transfer/<key>.json holds
 *   Guide         UGA Transfer Planning Guide (transfer.uga.edu)
 *   FAQ           UGA transfer FAQ (admissions.uga.edu)
 *   IL policies   Illinois transfer admission policies (admissions.illinois.edu)
 *   Parkland      Parkland-to-UIUC gen-ed guide (public/illinois-transfer-gened.json)
 *   curated       the planner's own table of common courses (transfer-match.ts),
 *                 which Illinois's Transferology would settle; kept as is
 * A line no official source settles is expected to count as hours, labelled
 * "not yet evaluated", never as an invented course.
 *
 *   node lib/planner/__transfer.check.mjs                 (this checkout; fails on any miss)
 *   node lib/planner/__transfer.check.mjs --root <dir>    (score another checkout's code, e.g. eb34efd)
 *   node lib/planner/__transfer.check.mjs --fingerprint   (records with no transfer lines, for a before/after diff)
 *   node lib/planner/__transfer.check.mjs --show          (each line's badge and reason, to read the wording)
 *
 * "Outcome" is what the plan uses (the course codes held, hours or nothing).
 * "Labelled" adds the line's badge and reason (what the student is shown).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
const SCORE_ONLY = process.argv.includes('--root');
register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(DATA, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(CODE_ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} try { return await next(spec + '.tsx', ctx); } catch {} }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, ctx);
  }`));
const T = await import(join(CODE_ROOT, 'lib/planner/transcript.ts'));
const read = (p) => JSON.parse(readFileSync(join(DATA, 'public', p), 'utf8'));

const ilCat = read('illinois/index.json').map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: c.level, cluster: c.cluster, tags: c.tags, ...(c.repeat ? { repeat: c.repeat } : {}) }));
const ugaCat = read('uga-catalog.json').filter((c) => typeof c?.code === 'string').map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: Number(c.code.match(/\d/)?.[0] ?? 0) * 100, cluster: c.cluster, tags: c.tags }));
const guide = read('illinois-transfer-gened.json');
const ugaTable = { index: read('uga-transfer/index.json'), schools: {} };
for (const f of readdirSync(join(DATA, 'public', 'uga-transfer'))) if (f !== 'index.json') ugaTable.schools[f.replace('.json', '')] = read(`uga-transfer/${f}`);

const L = (code, title, credits, grade, extra = {}) => ({ code, title, credits, grade, term: 'Fall 2024', status: grade === 'F' ? 'failed' : grade === 'W' ? 'withdrawn' : String(grade ?? '').startsWith('T') ? 'transfer' : 'completed', ...extra });
const GSU = 'Georgia State University', KSU = 'Kennesaw State University', GT = 'Georgia Institute of Technology', ATC = 'Athens Technical College', CU = 'Clemson University', EMORY = 'Emory University', UGA = 'University of Georgia';
const P = (k) => `Portal [${k}]`;

/**
 * [id, school, issuer, lines, expect, source]
 * expect: counts ('course' | 'hours' | 'none'), codes (held course codes), maxHours,
 * badge, designation, gradeNote, noProposals, proposal (offered, not counted), at (line index).
 */
const CASES = [
  // UGA: another school's own transcript.
  ['U1', 'uga', GSU, [L('ENGL 1101', 'English Composition I', 3, 'A')], { counts: 'course', codes: ['ENGL 1101'], badge: 'course' }, P('005251')],
  ['U2', 'uga', GSU, [L('ENGL 1102', 'English Composition II', 3, 'B')], { counts: 'course', codes: ['ENGL 1102'], badge: 'course' }, P('005251')],
  ['U3', 'uga', GSU, [L('MATH 1113', 'Precalculus', 3, 'B')], { counts: 'course', codes: ['MATH 1113'], badge: 'course' }, P('005251')],
  ['U4', 'uga', GSU, [L('HIST 2110', 'Survey of United States History', 3, 'A')], { counts: 'hours', badge: 'core', designation: 'HIST 1GHX' }, `${P('005251')}; Guide (GHX = core + U.S. history)`],
  ['U5', 'uga', GSU, [L('POLS 1101', 'American Government', 3, 'A')], { counts: 'course', codes: ['POLS 1101'], badge: 'course' }, P('005251')],
  ['U6', 'uga', GSU, [L('PSYC 1101', 'Introduction to General Psychology', 3, 'C')], { counts: 'course', codes: ['PSYC 1101'], badge: 'course' }, P('005251')],
  ['U7', 'uga', GSU, [L('MATH 0998', 'Support for Quantitative Reasoning', 2, 'S')], { counts: 'none', badge: 'none' }, 'Guide (learning support is not college level)'],
  ['U8', 'uga', GSU, [L('ENGL 0999', 'Support for English Composition', 2, 'S')], { counts: 'none', badge: 'none' }, `${P('005251')} (Not Transferrable)`],
  ['U9', 'uga', GSU, [L('KH 1010', 'Physical Activity: Weight Training', 1, 'A')], { counts: 'hours', maxHours: 1, badge: 'not-evaluated' }, 'Guide; FAQ (1 PE hour at most); not on the portal list'],
  ['U10', 'uga', GSU, [L('ECON 2105', 'Principles of Macroeconomics', 3, 'D')], { counts: 'course', codes: ['ECON 2105'], badge: 'course', gradeNote: true }, `${P('005251')}; FAQ (a D transfers)`],
  ['U11', 'uga', GSU, [L('BIOL 2107K', 'Principles of Biology I', 4, 'B')], { counts: 'course', codes: ['BIOL 1107', 'BIOL 1107L'], badge: 'course' }, `${P('005251')} (two rows)`],
  ['U12', 'uga', GSU, [L('CHEM 1211K', 'Principles of Chemistry I', 4, 'A')], { counts: 'course', codes: ['CHEM 1211', 'CHEM 1211L'], badge: 'course' }, P('005251')],
  ['U13', 'uga', GSU, [L('CSC 1301', 'Principles of Computer Science I', 4, 'A')], { counts: 'course', codes: ['CSCI 1301'], badge: 'course' }, P('005251')],
  ['U14', 'uga', GSU, [L('FILM 2700', 'History of Motion Pictures', 3, 'B')], { counts: 'hours', badge: 'core', designation: 'FILM 2GXX' }, P('005251')],
  ['U15', 'uga', GSU, [L('MATH 1111', 'College Algebra', 3, 'F')], { counts: 'none' }, 'an F earns nothing'],
  ['U15b', 'uga', GSU, [L('MATH 1111', 'College Algebra', 3, 'B')], { counts: 'hours', badge: 'core', designation: 'MATH 1GXX' }, `${P('005251')} (not a UGA course)`],
  ['U15c', 'uga', GSU, [L('GSU 1010', 'New Student Orientation', 1, 'A')], { counts: 'hours', badge: 'elective', designation: 'UNIV 1TXX' }, P('005251')],
  ['U15d', 'uga', GSU, [L('PHYS 2211K', 'Principles of Physics I', 4, 'B')], { counts: 'course', codes: ['PHYS 1211'], badge: 'course' }, `${P('005251')} (PHYS 1211 + PHYS 1211L; the UGA catalog lists PHYS 1211 with its lab)`],
  ['U16', 'uga', KSU, [L('COMM 1100', 'Human Communication', 3, 'A')], { counts: 'course', codes: ['COMM 1500'], badge: 'course' }, P('005359')],
  ['U16b', 'uga', KSU, [L('MATH 1190', 'Calculus I', 4, 'B')], { counts: 'course', codes: ['MATH 2250'], badge: 'course' }, P('005359')],
  ['U16c', 'uga', KSU, [L('CSE 1321', 'Programming and Problem Solving I', 4, 'A')], { counts: 'hours', badge: 'elective', designation: 'CSCI 1TXX' }, P('005359')],
  ['U17', 'uga', GT, [L('MATH 1551', 'Differential Calculus', 2, 'A')], { counts: 'hours', badge: 'elective', designation: 'MATH 2TXX' }, `${P('005248')} (not MATH 2250)`],
  ['U18', 'uga', GT, [L('CS 1301', 'Introduction to Computing', 3, 'A')], { counts: 'course', codes: ['CSCI 1300'], badge: 'course' }, `${P('005248')} (not CSCI 1301)`],
  ['U19', 'uga', GT, [L('ENGL 1101', 'English Composition I', 3, 'B')], { counts: 'course', codes: ['ENGL 1101'], badge: 'course' }, P('005248')],
  ['U19b', 'uga', GT, [L('CHEM 1310', 'Principles of General Chemistry for Engineers', 4, 'B')], { counts: 'course', codes: ['CHEM 1211', 'CHEM 1211L'], badge: 'course' }, P('005248')],
  ['U19c', 'uga', GT, [L('MATH 1554', 'Linear Algebra', 4, 'A')], { counts: 'course', codes: ['MATH 3300'], badge: 'course' }, `${P('005248')} (MATH 3300 + MATH 3TXX)`],
  ['U19d', 'uga', GT, [L('ECON 2100', 'Economic Analysis and Policy Problems', 3, 'A')], { counts: 'hours', badge: 'core', designation: 'ECON 2GXX' }, P('005248')],
  ['U21', 'uga', ATC, [L('ENGL 1101', 'Composition and Rhetoric', 3, 'A')], { counts: 'course', codes: ['ENGL 1101'], badge: 'course' }, P('000462')],
  ['U22', 'uga', ATC, [L('ACCT 1100', 'Financial Accounting I', 4, 'A')], { counts: 'none', badge: 'none' }, `${P('000462')} (Not Transferrable)`],
  ['U23', 'uga', ATC, [L('COLL 1000', 'Orientation to College', 3, 'A')], { counts: 'none', badge: 'none' }, 'Guide (technical colleges: general education only); not on the portal list'],
  ['U24', 'uga', ATC, [L('WELD 1000', 'Introduction to Welding Technology', 3, 'A')], { counts: 'none', badge: 'none' }, 'Guide (technical colleges: general education only)'],
  ['U24b', 'uga', ATC, [L('SPCH 1101', 'Public Speaking', 3, 'A')], { counts: 'course', codes: ['COMM 1110'], badge: 'course' }, P('000462')],
  ['U24c', 'uga', ATC, [L('CHEM 1211', 'Chemistry I', 3, 'B')], { counts: 'hours', badge: 'core', designation: 'CHEM 1GXX' }, `${P('000462')} (not CHEM 1211)`],
  ['U24d', 'uga', ATC, [L('CIST 1001', 'Computer Concepts', 4, 'A')], { counts: 'none', badge: 'none' }, `${P('000462')} (Not Transferrable)`],
  ['U25', 'uga', CU, [L('ENGL 1030', 'Composition and Rhetoric', 3, 'A')], { counts: 'course', codes: ['ENGL 1102'], badge: 'course' }, `${P('005111')} (not ENGL 1101)`],
  ['U26', 'uga', CU, [L('MATH 1060', 'Calculus of One Variable I', 4, 'B')], { counts: 'course', codes: ['MATH 2250'], badge: 'course' }, P('005111')],
  ['U26b', 'uga', CU, [L('ECON 2110', 'Principles of Microeconomics', 3, 'A')], { counts: 'course', codes: ['ECON 2106'], badge: 'course' }, P('005111')],
  ['U26c', 'uga', CU, [L('ECON 2120', 'Principles of Macroeconomics', 3, 'A')], { counts: 'course', codes: ['ECON 2105'], badge: 'course' }, P('005111')],
  ['U26d', 'uga', CU, [L('CH 1010', 'Introduction to Chemistry', 4, 'B')], { counts: 'hours', badge: 'core', designation: 'CHEM 1GXX' }, P('005111')],
  ['U27', 'uga', EMORY, [L('ENG 101', 'Expository Writing', 3, 'A')], { counts: 'course', codes: ['ENGL 1101'], badge: 'course' }, `${P('005187')} (research had Emory unchecked)`],
  ['U29', 'uga', EMORY, [L('UNIV 1001', 'First-Year Seminar', 1, 'A')], { counts: 'hours', badge: 'not-evaluated' }, 'Guide (unlisted courses follow the general rules); not on the portal list'],
  ['U30', 'uga', EMORY, [L('MATH 0098', 'Intermediate Algebra', 3, 'B')], { counts: 'none', badge: 'none' }, 'Guide (not college level)'],
  ['U30b', 'uga', 'Valencia College', [L('ENC 1101', 'Freshman Composition Skills I', 3, 'A')], { counts: 'hours', badge: 'not-evaluated' }, 'no list held for this school: hours until UGA evaluates it'],
  // UGA: UGA's own record, whose transfer block prints UGA's evaluation.
  ['U31', 'uga', UGA, [L('ENGL 1101', 'English Composition I', 3, 'TA', { from: GSU })], { counts: 'course', codes: ['ENGL 1101'] }, 'home record'],
  ['U32', 'uga', UGA, [L('HIST 1GHX', 'Comprehensive US History', 3, 'TB', { from: GSU })], { counts: 'hours', badge: 'core', designation: 'HIST 1GHX' }, 'Guide (GHX)'],
  ['U33', 'uga', UGA, [L('MATH 2TXX', 'Transfer Elective', 3, 'TA', { from: CU })], { counts: 'hours', badge: 'elective', designation: 'MATH 2TXX' }, 'Guide; portal legend (TXX)'],
  ['U34', 'uga', UGA, [L('SOCI 1GXX', 'Gen Ed Core Elective', 3, 'TB', { from: KSU })], { counts: 'hours', badge: 'core', designation: 'SOCI 1GXX' }, 'Guide; portal legend (GXX)'],
  ['U35', 'uga', UGA, [L('NTFR 0TXX', 'Not Transferable', 4, 'TA', { from: ATC })], { counts: 'none', badge: 'none' }, 'Guide; portal legend (NTFR)'],
  ['U35b', 'uga', ATC, [L('ACCT 1100', 'Financial Accounting I', 4, 'A', { equivalent: 'NTFR' })], { counts: 'none', badge: 'none' }, 'the document prints NTFR'],
  ['U35c', 'uga', GSU, [L('MATH 1111', 'College Algebra', 3, 'A', { equivalent: 'MATH 1GXX' })], { counts: 'hours', badge: 'core', designation: 'MATH 1GXX' }, 'the document prints MATH 1GXX'],
  // U36 is built below: one PE hour across three uploads.

  // Illinois: another school's own transcript.
  ['I1', 'illinois', 'Parkland College', [L('ENG 101', 'Composition I', 3, 'A'), L('ENG 102', 'Composition II', 3, 'A')], { counts: 'course', codes: ['RHET 105'] }, 'Parkland (the two courses together)'],
  ['I2', 'illinois', 'Parkland College', [L('ENG 101', 'Composition I', 3, 'A'), L('ENG 102', 'Composition II', 3, 'A')], { at: 1, counts: 'hours' }, 'Parkland (completes the pair)'],
  ['I3', 'illinois', 'Parkland College', [L('MAT 128', 'Calculus and Analytic Geometry I', 5, 'B')], { counts: 'course', codes: ['MATH 221'], badge: 'course' }, 'curated; Parkland (QR I)'],
  ['I4', 'illinois', 'Parkland College', [L('PSY 101', 'Introduction to Psychology', 3, 'A')], { counts: 'course', codes: ['PSYC 100'], badge: 'course' }, 'curated'],
  ['I5', 'illinois', 'Parkland College', [L('HIS 101', 'Western Civilization I', 3, 'B')], { counts: 'hours', badge: 'core', genEd: 'Cultural Studies - Western' }, 'Parkland (categories, not a course)'],
  ['I6', 'illinois', 'Parkland College', [L('MAT 086', 'Intermediate Algebra', 4, 'A')], { counts: 'none', badge: 'none' }, 'IL policies (remedial)'],
  ['I7', 'illinois', 'Parkland College', [L('AUT 101', 'Automotive Fundamentals', 4, 'A')], { counts: 'none', badge: 'none' }, 'IL policies (vocational)'],
  ['I8', 'illinois', 'Parkland College', [L('PED 160', 'Weight Training', 1, 'A')], { counts: 'hours', badge: 'not-evaluated' }, 'nothing published: honest fallback'],
  ['I9', 'illinois', 'Parkland College', [L('CHE 101', 'General Chemistry I', 5, 'D')], { counts: 'course', codes: ['CHEM 102', 'CHEM 103'], badge: 'course', gradeNote: true }, 'curated; D not stated on Illinois pages'],
  ['I10', 'illinois', 'Harper College', [L('MTH 200', 'Calculus with Analytic Geometry I', 5, 'A')], { counts: 'course', codes: ['MATH 221'] }, 'curated'],
  ['I11', 'illinois', 'Harper College', [L('ECO 211', 'Microeconomics', 3, 'A')], { counts: 'course', codes: ['ECON 102'] }, 'curated'],
  ['I12', 'illinois', 'Harper College', [L('SPE 101', 'Fundamentals of Speech Communication', 3, 'A')], { counts: 'course', codes: ['CMN 101'] }, 'curated'],
  ['I13', 'illinois', 'Harper College', [L('ENG 099', 'Basic Writing', 3, 'A')], { counts: 'none', badge: 'none' }, 'IL policies (remedial)'],
  ['I14', 'illinois', 'Harper College', [L('CIS 101', 'Introduction to Computer Information Systems', 3, 'A')], { counts: 'hours', badge: 'not-evaluated', noProposals: ['CS 340'] }, 'fallback; no nonsense guess'],
  ['I15', 'illinois', 'College of DuPage', [L('MATH 2232', 'Calculus and Analytic Geometry II', 5, 'B')], { counts: 'course', codes: ['MATH 231'] }, 'curated'],
  ['I16', 'illinois', 'College of DuPage', [L('BIOLO 1151', 'Principles of Biology I', 5, 'A')], { counts: 'hours', badge: 'not-evaluated', proposal: 'IB 150' }, 'Transferology only: labelled estimate'],
  ['I17', 'illinois', 'College of DuPage', [L('ENGLI 1101', 'English Composition I', 3, 'A')], { counts: 'hours', badge: 'not-evaluated' }, 'comp pair rule (one course alone)'],
  ['I18', 'illinois', 'College of DuPage', [L('MATH 0482', 'Foundations for College Mathematics', 4, 'A')], { counts: 'none', badge: 'none' }, 'IL policies (remedial)'],
  ['I19', 'illinois', 'College of DuPage', [L('HLTHS 1110', 'Medical Terminology', 1, 'A')], { counts: 'none', badge: 'none' }, 'IL policies (vocational): probably none, with a note'],
  ['I20', 'illinois', 'University of Illinois Chicago', [L('MATH 180', 'Calculus I', 4, 'A')], { counts: 'course', codes: ['MATH 221'] }, 'curated'],
  ['I21', 'illinois', 'University of Illinois Chicago', [L('CS 141', 'Program Design II', 3, 'A')], { counts: 'hours', badge: 'not-evaluated', noProposals: ['ARTF 105', 'ARCH 172'] }, 'fallback; no nonsense guess'],
  ['I22', 'illinois', 'University of Illinois Chicago', [L('PSCH 100', 'Introduction to Psychology', 4, 'A')], { counts: 'course', codes: ['PSYC 100'] }, 'curated'],
  ['I23', 'illinois', 'Illinois State University', [L('ENG 101', 'Composition as Critical Inquiry', 3, 'A')], { counts: 'hours', badge: 'not-evaluated', proposal: 'RHET 105' }, 'Transferology only: labelled estimate'],
  ['I24', 'illinois', 'Illinois State University', [L('ECO 105', 'Principles of Economics', 4, 'A')], { counts: 'hours', badge: 'not-evaluated' }, 'Transferology only: labelled estimate'],
  ['I25', 'illinois', 'Illinois State University', [L('KNR 150', 'Physical Activity: Tennis', 1, 'A')], { counts: 'hours', badge: 'not-evaluated', noProposals: ['HK 161', 'HK 154'] }, 'nothing published: honest fallback'],
  ['I26', 'illinois', 'Purdue University', [L('MA 16100', 'Plane Analytic Geometry and Calculus I', 5, 'A')], { counts: 'course', codes: ['MATH 221'] }, 'curated'],
  ['I27', 'illinois', 'Purdue University', [L('CS 18000', 'Problem Solving and Object-Oriented Programming', 4, 'A')], { counts: 'hours', badge: 'not-evaluated' }, 'Transferology only'],
  ['I28', 'illinois', 'Purdue University', [L('ENGL 10600', 'First-Year Composition', 4, 'B')], { counts: 'hours', badge: 'not-evaluated', proposal: 'RHET 105' }, 'Transferology only: labelled estimate'],
  ['I29', 'illinois', 'Purdue University', [L('HIST 15100', 'American History to 1877', 3, 'W')], { counts: 'none' }, 'a W earns nothing'],
  ['I30', 'illinois', 'Wheaton College', [L('PHIL 101', 'Introduction to Philosophy', 3, 'B')], { counts: 'course', codes: ['PHIL 101'] }, 'curated'],
  // Illinois: Illinois's own record and a Transfer Course Evaluation Report.
  ['I31', 'illinois', 'University of Illinois Urbana-Champaign', [L('MATH 221', 'Calculus I', 4, 'TR', { from: 'Parkland College' })], { counts: 'course', codes: ['MATH 221'] }, 'home record'],
  ['I32', 'illinois', 'University of Illinois Urbana-Champaign', [L('HIST 1--', 'History elective', 3, 'TR', { from: 'Parkland College' })], { counts: 'hours' }, 'home record (1-- is elective credit)'],
  ['I33', 'illinois', 'Harper College', [L('ECO 212', 'Macroeconomics', 3, 'A', { equivalent: 'ECON 103' })], { counts: 'course', codes: ['ECON 103'] }, 'the evaluation report prints ECON 103'],
  // Found by the made-up transcript rounds (keep-planner/transfer/sharpen).
  ['U52', 'uga', 'Ogeechee Technical College', [L('SPCH 1101', 'Public Speaking', 3, 'A')], { counts: 'course', codes: ['COMM 1110'], badge: 'course' }, 'UGA list says COMM 1100, the older number of COMM 1110'],
  ['U53', 'uga', 'Belmont University', [L('PSY 2210', 'Developmental Psychology', 3, 'B+')], { counts: 'hours', badge: 'not-evaluated' }, 'a college course, not a remedial one'],
  ['I34', 'illinois', 'DePaul University', [L('ECO 305', 'Intermediate Microeconomics', 4, 'B')], { counts: 'course', codes: ['ECON 302'] }, 'intermediate microeconomics, not principles (ECON 102)'],
  ['I35', 'illinois', 'Indiana University Bloomington', [L('SPAN-S 200', 'Second-Year Spanish I', 3, 'B')], { counts: 'course', codes: ['SPAN 201'] }, 'third-semester Spanish, not SPAN 101'],
];

function run(school, issuer, lines) {
  const catalog = school === 'uga' ? ugaCat : ilCat;
  const kind = lines.some((l) => l.equivalent) ? 'transfer_report' : 'transcript';
  return T.matchTranscript({ institution: issuer, kind, courses: lines, exams: [], notes: [] }, 'made-up.pdf', catalog, ['made-up.pdf'], school === 'illinois' ? guide : null, school, ugaTable);
}

function judge(line, record, expect) {
  const misses = [];
  const counted = line.use && line.counts !== 'none';
  const solo = { ...record, courses: [line] };
  if (expect.counts === 'none' && counted) misses.push(`counts ${line.counts}, want none`);
  if (expect.counts === 'hours' && !(line.use && line.counts === 'hours')) misses.push(`counts ${line.use ? line.counts : 'off'}, want hours`);
  if (expect.counts === 'course') {
    const got = [...T.transcriptCodes(solo)].sort((a, b) => a.localeCompare(b)).join('+');
    const want = [...expect.codes].sort((a, b) => a.localeCompare(b)).join('+');
    if (got !== want) misses.push(`codes ${got || '(none)'}, want ${want}`);
  }
  if (expect.maxHours != null && T.transcriptHours(solo) > expect.maxHours) misses.push(`hours ${T.transcriptHours(solo)} > ${expect.maxHours}`);
  if (expect.proposal && !(line.proposals ?? []).some((p) => p.code === expect.proposal)) misses.push(`no ${expect.proposal} suggestion`);
  if (expect.proposal && T.transcriptCodes(solo).includes(expect.proposal)) misses.push(`${expect.proposal} counted before the student confirmed it`);
  const outcome = misses.length === 0;
  const labels = [];
  if (expect.badge && line.basis?.badge !== expect.badge) labels.push(`badge ${line.basis?.badge ?? '(none)'}, want ${expect.badge}`);
  if (expect.badge && !line.basis?.text) labels.push('no reason shown');
  if (expect.designation && line.designation !== expect.designation) labels.push(`designation ${line.designation ?? '(none)'}, want ${expect.designation}`);
  if (expect.gradeNote && !line.gradeNote) labels.push('no grade note');
  if (expect.genEd && !(line.genEdTags ?? []).includes(expect.genEd)) labels.push(`no ${expect.genEd}`);
  for (const code of expect.noProposals ?? []) if ((line.proposals ?? []).some((p) => p.code === code)) labels.push(`still suggests ${code}`);
  return { outcome, labelled: outcome && labels.length === 0, why: [...misses, ...labels] };
}

const results = [];
for (const [id, school, issuer, lines, expect, source] of CASES) {
  const record = run(school, issuer, lines.map((l) => ({ ...l })));
  const line = record.courses[expect.at ?? 0];
  if (process.argv.includes('--show')) console.log(`${id.padEnd(5)} ${lines[expect.at ?? 0].code.padEnd(10)} ${line.basis ? `[${line.basis.badge}] ${line.basis.text}${line.gradeNote ? ` ${line.gradeNote}` : ''}` : '(no reason)'}`);
  results.push({ id, school, source, ...judge(line, record, expect), got: `${line.use ? line.counts : 'off'}${line.matched ? ` ${[line.matched, ...(line.also ?? [])].join('+')}` : ''}${line.designation ? ` ${line.designation}` : ''}${line.basis ? ` [${line.basis.badge}]` : ''}` });
}

// U36: GSU KH 1010 + Emory PE 110 + the UGA record's PEDB 1TXX, three uploads
// merged the way the upload step merges them: one PE hour in all.
{
  const a = run('uga', GSU, [L('KH 1010', 'Physical Activity: Weight Training', 1, 'A')]);
  const b = run('uga', EMORY, [L('PE 110', 'Tennis', 1, 'S')]);
  const c = run('uga', UGA, [L('PEDB 1TXX', 'Physical Education Elective', 1, 'TS', { from: EMORY })]);
  const all = [...a.courses, ...b.courses, ...c.courses].map((x) => ({ ...x }));
  const merged = { ...a, courses: typeof T.applyTransferCaps === 'function' ? T.applyTransferCaps(all, 'uga') : all };
  const hours = T.transcriptHours(merged);
  const ok = hours === 1;
  results.push({ id: 'U36', school: 'uga', source: 'Guide; FAQ (1 PE hour at most)', outcome: ok, labelled: ok && merged.courses.filter((x) => !x.use).every((x) => x.basis?.badge === 'none'), why: ok ? [] : [`${hours} PE hours counted, want 1`], got: `${hours} h` });
}

if (process.argv.includes('--fingerprint')) {
  // Records with no transfer line: what the plan receives must not change.
  const home = [
    ['uga', UGA, [L('ENGL 1101', 'English Composition I', 3, 'A'), L('MATH 2250', 'Calculus I', 4, 'B'), L('POLS 1101', 'American Government', 3, 'W'), L('RMIN 4000', 'Risk Management', 3, 'A', { status: 'in_progress' })]],
    ['illinois', 'University of Illinois Urbana-Champaign', [L('MATH 221', 'Calculus I', 4, 'A'), L('RHET 105', 'Writing and Research', 4, 'B'), L('CS 124', 'Introduction to Computer Science I', 3, 'F'), L('ECON 102', 'Microeconomic Principles', 3, 'A')]],
    ['illinois', null, [L('MATH 221', 'Calculus I', 4, 'A'), L('PSYC 100', 'Intro Psych', 4, 'A')]],
  ];
  const fp = home.map(([school, issuer, lines]) => {
    const r = run(school, issuer, lines);
    // adjBoard: the workspace passes the board's hours; a record with no transfer line must not move.
    return { codes: T.transcriptCodes(r), hours: T.transcriptHours(r), adj: T.transcriptCreditAdjustment(r), adjBoard: T.transcriptCreditAdjustment(r, () => 4), genEd: T.transcriptGenEdCredits(r), resident: T.transcriptResidentHours(r), open: T.transcriptOpenLines(r).length, lines: r.courses.map((c) => [c.code, c.matched, c.counts, c.use, c.status]) };
  });
  fp.push({ none: [T.transcriptCodes(null), T.transcriptHours(null), T.transcriptCreditAdjustment(null), T.transcriptGenEdCredits(null)] });
  console.log(JSON.stringify(fp));
  process.exit(0);
}

let failed = 0;
if (!SCORE_ONLY) {
  // Which UGA list a school's name on a transcript opens: every school opens
  // its own, and look-alike names open the right one or none.
  const O = await import(join(CODE_ROOT, 'lib/planner/transfer-official.ts'));
  const index = ugaTable.index;
  const names = [
    ...index.schools.map((s) => [s.name, s.key]),
    ['Georgia Tech', '005248'], ['Wiregrass Georgia Technical College', '004557'], ['Central Georgia Technical College', '001709'],
    ['South Georgia Technical College', '006555'], ['South Georgia State College', '005619'], ['Middle Georgia State University', '005439'],
    ['East Georgia State College', '005200'], ['Georgia State University - Perimeter College', '005251'], ['West Georgia Technical College', '006342'],
    ['University of West Georgia', '005900'], ['Oxford College of Emory University', '005186'], ['University of Alabama at Birmingham', null],
    ['The University of Alabama', '001830'], ['University of Tennessee, Knoxville', '001843'], ['University of Tennessee at Chattanooga', null],
    ['University of South Carolina Aiken', null], ['Georgia Military College', null], ['Valencia College', null], ['University of Georgia', null],
  ];
  let wrong = 0;
  for (const [name, key] of names) {
    const got = O.ugaSchoolEntry(index, name)?.key ?? null;
    if (got !== key) {
      wrong += 1;
      console.log(`  SCHOOL "${name}" opens ${got ?? 'no list'}, want ${key ?? 'no list'}`);
    }
  }
  console.log(`School names: ${names.length - wrong}/${names.length} open the right UGA list (${index.schools.length} schools held).`);
  failed += wrong;
  // Every UGA result in the lists is a designation the matcher reads or a code.
  let odd = 0;
  for (const file of Object.values(ugaTable.schools)) {
    for (const results of Object.values(file.courses)) for (const r of results) if (!O.ugaDesignation(r) && !/^[A-Z]{2,5} \d{4}[A-Z]{0,2}$/.test(r)) odd += 1;
  }
  if (odd > 1) {
    console.log(`  ${odd} results in the UGA lists are neither a course nor a designation`);
    failed += 1;
  }
}
if (!SCORE_ONLY) {
  // The board itself: a UGA Risk Management and Insurance BBA (the owner's
  // degree) with a made-up Georgia State transcript. A course UGA's list makes
  // a UGA course is never booked again, the core electives come off the core
  // areas they fill, and the record with no transfer line changes nothing.
  const A = await import(join(CODE_ROOT, 'lib/planner/autoplan.ts'));
  const C = await import(join(CODE_ROOT, 'lib/planner/transfer-core.ts'));
  const { DEFAULT_PRIORITIES } = await import(join(CODE_ROOT, 'lib/planner/priorities.ts'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(read((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
  const U = await import(join(CODE_ROOT, 'components/planner/uga-source.tsx'));
  const data = await U.loadUgaData();
  globalThis.fetch = realFetch;
  const lite = data.courses.map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: Number(c.code.match(/\d/)?.[0] ?? 0) * 100, cluster: c.cluster, tags: c.tags }));
  const gsu = [L('ENGL 1101', 'English Composition I', 3, 'A'), L('MATH 1111', 'College Algebra', 3, 'B'), L('HIST 2110', 'Survey of United States History', 3, 'A'), L('PSYC 1101', 'Introduction to General Psychology', 3, 'C'), L('KH 1010', 'Physical Activity: Weight Training', 1, 'A'), L('ENGL 1102', 'English Composition II', 3, 'B'), L('POLS 1101', 'American Government', 3, 'A'), L('ECON 2105', 'Principles of Macroeconomics', 3, 'D'), L('ECON 2106', 'Principles of Microeconomics', 3, 'B'), L('BIOL 2107K', 'Principles of Biology I', 4, 'B'), L('FILM 2700', 'History of Motion Pictures', 3, 'B'), L('ENGL 0999', 'Support for English Composition', 2, 'S')];
  const rec = T.matchTranscript({ institution: GSU, kind: 'transcript', courses: gsu, exams: [], notes: [] }, 'gsu.txt', lite, ['gsu.txt'], null, 'uga', ugaTable);
  const program = data.programs.find((p) => p.id === '93328');
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections: {} });
  const board = (requirements, prior) => {
    const g = A.generatePlan({ requirements, context: data.context, programName: loaded.program.name, programId: program.id, prior,
      horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true },
      degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: DEFAULT_PRIORITIES } });
    const codes = g.plan.terms.flatMap((t) => t.courseIds).map((id) => data.courses.find((c) => c.id === id)?.code ?? id).map((c) => T.normalizeCourseCode(c));
    const credits = g.plan.terms.flatMap((t) => t.courseIds).reduce((sum, id) => sum + (data.courses.find((c) => c.id === id)?.credits ?? 0), 0);
    return { codes, credits };
  };
  const held = T.transcriptCodes(rec);
  // The board's own hours per course (BIOL 1107L is 1, MATH 2250 is 4), as the workspace passes them.
  const creditsOf = (code) => data.context.creditRanges.get(code)?.min ?? null;
  const hours = T.transcriptHours(rec) + T.transcriptCreditAdjustment(rec, creditsOf);
  const { blocks, used } = C.withCoreCredit(loaded.blocks, rec);
  const after = board(blocks, { known: true, courseCodes: held, exemptCodes: [], unmatchedCredits: hours });
  const again = ['ENGL 1101', 'ENGL 1102', 'POLS 1101', 'PSYC 1101', 'ECON 2105', 'ECON 2106', 'BIOL 1107', 'BIOL 1107L', 'MATH 1113'].filter((c) => after.codes.includes(c));
  const boardFails = [];
  // 32 hours transfer: every line but the learning-support one (BIOL 2107K's 4 hours, not the catalog's 3 + 3).
  const earned = hours + held.reduce((sum, code) => sum + (creditsOf(code) ?? 0), 0);
  if (earned !== 32) boardFails.push(`the record earns ${earned} hours, want 32`);
  if (again.length) boardFails.push(`books again: ${again.join(', ')}`);
  if (used.length !== 3) boardFails.push(`core credit used ${used.length} times, want 3 (MATH 1GXX, HIST 1GHX, FILM 2GXX)`);
  const total = after.credits + earned;
  if (total > program.totalCredits + 3) boardFails.push(`board + transfer = ${total} credits for a ${program.totalCredits}-credit degree`);
  if (C.withCoreCredit(loaded.blocks, null).blocks !== loaded.blocks) boardFails.push('no record changed the degree requirements');
  if (C.withCoreCredit(loaded.blocks, { ...rec, courses: rec.courses.filter((c) => !c.designation) }).blocks !== loaded.blocks) boardFails.push('a record with no core elective changed the degree requirements');
  console.log(`UGA board (RMI BBA, made-up Georgia State transcript): ${after.codes.length} courses, ${after.credits} credits planned + ${total - after.credits} held; booked again: ${again.length ? again.join(', ') : 'none'}; core credit: ${used.map((u) => `${u.line} -> ${u.area}`).join('; ')}.`);
  for (const f of boardFails) console.log(`  BOARD ${f}`);
  failed += boardFails.length;
}
for (const school of ['uga', 'illinois']) {
  const mine = results.filter((r) => r.school === school);
  const outcome = mine.filter((r) => r.outcome).length;
  const labelled = mine.filter((r) => r.labelled).length;
  console.log(`${school === 'uga' ? 'UGA' : 'Illinois'}: ${mine.length} cases. Outcome right ${outcome}/${mine.length}; outcome and label right ${labelled}/${mine.length}.`);
  for (const r of mine) {
    if (r.labelled) continue;
    console.log(`  ${r.outcome ? 'LABEL' : 'WRONG'} ${r.id.padEnd(5)} got ${r.got}: ${r.why.join('; ')}  (${typeof r.source === 'string' ? r.source : ''})`);
    failed += 1;
  }
  if (mine.length < 30) {
    console.log(`  fewer than 30 cases for ${school}`);
    failed += 1;
  }
}
if (SCORE_ONLY) process.exit(0);
if (failed > 0) {
  console.error(`transfer check: ${failed} case(s) not right`);
  process.exit(1);
}
console.log('transfer check: all cases right');
