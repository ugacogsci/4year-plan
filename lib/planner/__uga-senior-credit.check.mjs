/**
 * A UGA senior's past classes count toward every requirement they satisfy,
 * as the Bulletin's rules read them (2026-10-28). Senior records built the
 * way the workspace builds a board (planner-workspace.tsx: combinePrograms,
 * withCoreCredit, readPriorCredit, generatePlan, auditUgaBoard), each with
 * the bug it reproduced before:
 *
 *   1. Terry's open elective blocks ("Upper Division General Electives: Any
 *      upper level course 3000-5999", "University Wide General Electives
 *      (Non-Business)") counted a held class only when the planner's 400-course
 *      sample of the rule held it: a Risk Management senior with 128 credits
 *      was booked five more electives (143 of 120). Now the held classes the
 *      rule takes count, each in one block (any-course.ts), and nothing is
 *      booked there.
 *   2. With a minor and a certificate beside the degree, a Georgia State
 *      ASTR 1000 ("ASTR 1GXX", a core elective) no longer filled Physical
 *      Sciences, whose label then names its program (transfer-core.ts), and
 *      ASTR 1010 was booked.
 *   3. A UGA line under a number the catalog does not list counted as hours
 *      only: Weather and Climate taken as ATSC 1112 (the catalog has GEOG
 *      1112), physics taken online as PHYS 1211E. Both booked a Physical
 *      Sciences course (transcript.ts ugaNamed, uga-offerings.ts crossListed).
 *   4. "POLS prefix course 3000-level or higher" was read as the 3000 level
 *      alone: a Political Science senior with ten 4000-level POLS classes was
 *      booked four more for American Studies (scripts/uga-programs.mjs
 *      levelRange, uga-source.tsx choicesFor).
 *   5. Minors and certificates came from an older reading that dropped every
 *      "FHCE 4000/6000" row: the Consumer Economics minor had no list for
 *      its last six hours ("Required Courses 9 of 15" for ever), the Legal
 *      Studies certificate no LEGL 4300.
 *   6. A required class counted again as a general elective through its
 *      online version or Terry's x001 section (RMIN 4000E, MGMT 3001).
 *
 *   node lib/planner/__uga-senior-credit.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
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
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, ctx);
  }
`));
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);
const publicJson = (name) => JSON.parse(readFileSync(join(ROOT, 'public', name), 'utf8'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await lib('components/planner/uga-source.tsx');
const data = await U.loadUgaData();
const TO = await lib('lib/planner/transfer-official.ts');
globalThis.fetch = originalFetch;
const { generatePlan, planCreditRange, distinctHeld } = await lib('lib/planner/autoplan.ts');
const { DEFAULT_PRIORITIES } = await lib('lib/planner/priorities.ts');
const T = await lib('lib/planner/transcript.ts');
const O = await lib('lib/planner/onboarding.ts');
const IS = await lib('components/planner/illinois-source.tsx');
const X = await lib('components/planner/exam-credit.ts');
const TC = await lib('lib/planner/transfer-core.ts');
const { auditUgaBoard } = await lib('components/planner/uga-board-audit.ts');
const { horizonFor } = await lib('lib/planner/plan-start.ts');
const S = await lib('lib/planner/saved-board.ts');

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const TODAY = new Date('2026-10-27T15:00:00Z');
const lite = publicJson('uga-catalog.json').filter((c) => typeof c?.code === 'string').map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: Number(c.code.match(/\d/)?.[0] ?? 0) * 100, cluster: c.cluster, tags: c.tags }));
const crossListed = publicJson('uga/course-offerings.json').crossListed ?? {};

/* planner-workspace.tsx combinePrograms (not exported), as a minor and a certificate sit beside a degree. */
function isSharedCoreArea(label) {
  return /general education|core curriculum/i.test(label) ||
    /^(?:i\. foundation courses|ii\. physical sciences|ii\. life sciences|iii\. quantitative reasoning|iv\. world languages|iv\. humanities|v\. social sciences)\b/i.test(label.trim());
}
function combinePrograms(sources) {
  const multiple = sources.length > 1;
  const totalCredits = sources.reduce((largest, s) => { const t = s.summary.totalCredits ?? s.program.totalCredits; return t === null ? largest : Math.max(largest ?? 0, t); }, null);
  const qualify = (s, label) => (multiple ? `${s.program.name}: ${label}` : label);
  const blocks = sources.flatMap((s, i) => s.blocks.filter((b) => !multiple || (!(i > 0 && (b.rule.kind === 'gened' || isSharedCoreArea(b.areaLabel))) && (b.rule.kind !== 'hours' || b.rule.source !== 'explicit-elective'))).map((b) => ({ ...b, areaLabel: qualify(s, b.areaLabel) })));
  const program = {
    id: sources.map((s) => s.program.id).join('+'), college: [...new Set(sources.map((s) => s.program.college))].join(' + '),
    degree: [...new Set(sources.map((s) => s.program.degree))].join(' + '), name: sources.map((s) => s.program.name).join(' + '),
    areas: sources.flatMap((s, i) => s.program.areas.filter((a) => !multiple || (!/^(?:general|free) electives?\b/i.test(a.label) && !(i > 0 && isSharedCoreArea(a.label)))).map((a) => ({ ...a, label: qualify(s, a.label) }))),
    totalCredits, areaHours: sources.reduce((sum, s) => sum + s.program.areaHours, 0),
  };
  const electiveHours = sources.reduce((sum, s) => sum + ('electiveHours' in s ? s.electiveHours : 0), 0);
  return { summary: { id: program.id, name: program.name, totalCredits }, program, blocks, sources, electiveHours: multiple ? undefined : electiveHours, fillToDegreeTotal: sources.some((s) => s.fillToDegreeTotal) };
}

// ---------------------------------------------------------------------------
// The records (made up; core areas filled with commonly taken courses)
// ---------------------------------------------------------------------------
const done = (term, list) => list.map(([code, title, credits]) => ({ code, title, credits, grade: 'A', term, status: 'completed', from: null, equivalent: null }));
const now = (list) => list.map(([code, title, credits]) => ({ code, title, credits, grade: null, term: 'Fall 2026', status: 'in_progress', from: null, equivalent: null }));
const ap = (list) => list.map(([code, title, credits]) => ({ code, title, credits, grade: 'CR', term: 'Fall 2023', status: 'exam', from: null, equivalent: null }));
const swap = (lines, from, to) => lines.map((l) => (l.code === from ? { ...l, code: to } : l));
const rmin = [
  ...ap([['PSYC 1101', 'Elementary Psychology', 3], ['HIST 2111', 'American History to 1865', 3], ['ENGL 1101', 'English Composition I', 3]]),
  ...done('Fall 2023', [['FYOS 1001', 'First-Year Odyssey Seminar', 1], ['ENGL 1102', 'English Composition II', 3], ['MATH 1113', 'Precalculus', 3], ['POLS 1101', 'American Government', 3], ['RELI 1001', 'Introduction to World Religions', 3], ['ECOL 1000', 'Ecological Basis of Environmental Issues', 3]]),
  ...done('Spring 2024', [['MATH 2200', 'Analytic Geometry and Calculus', 3], ['ECON 2105', 'Principles of Macroeconomics', 3], ['COMM 1110', 'Introduction to Public Speaking', 3], ['GEOG 1112', 'Introduction to Weather and Climate', 3], ['SPAN 2001', 'Intermediate Spanish', 3], ['STAT 2000', 'Introductory Statistics', 4]]),
  ...done('Fall 2024', [['ECON 2106', 'Principles of Microeconomics', 3], ['ACCT 2101', 'Principles of Accounting I', 3], ['MIST 2090', 'Introduction to Information Systems', 3], ['FHCE 2100', 'Personal and Family Finance', 3], ['GEOG 1101', 'Human Geography', 3], ['ANTH 1102', 'Introduction to Anthropology', 3]]),
  ...done('Spring 2025', [['ACCT 2102', 'Principles of Accounting II', 3], ['BUSN 3000', 'Business Strategy and Professional Development', 3], ['FINA 3000', 'Financial Management', 3], ['MARK 3000', 'Principles of Marketing', 3], ['FHCE 3200E', 'Consumer Economic Issues', 3]]),
  ...done('Fall 2025', [['MGMT 3000', 'Principles of Management', 3], ['RMIN 4000', 'Risk Management', 3], ['RMIN 5100', 'Insurance Company Operations', 3], ['FHCE 3100', 'Consumer Economics', 3], ['LEGL 4200', 'Employment Law', 3], ['ENTR 5500', 'Introduction to Entrepreneurship', 3]]),
  ...done('Spring 2026', [['RMIN 5110', 'Insurance Law', 3], ['RMIN 5540', 'Employee Benefit Plans', 3], ['FHCE 3150', 'Consumer Behavior', 3], ['MARK 4000', 'Marketing Research', 3], ['PHIL 2010', 'Introduction to Philosophy', 3], ['BUSN 3030E', 'Business Communication', 3]]),
  ...now([['LEGL 2700', 'Legal and Regulatory Environment of Business', 3], ['LEGL 4750', 'Corporations, Law, and Society', 3], ['LEGL 5250', 'Law of Entrepreneurship', 3], ['RMIN 5950', 'Risk Management Capstone', 3], ['BUSN 4000', 'Strategic Management', 3]]),
];
const pols = [
  ...ap([['ENGL 1101', 'English Composition I', 3], ['HIST 2112', 'American History Since 1865', 3], ['PSYC 1101', 'Elementary Psychology', 3]]),
  ...done('Fall 2023', [['FYOS 1001', 'First-Year Odyssey Seminar', 1], ['ENGL 1102', 'English Composition II', 3], ['POLS 1101', 'American Government', 3], ['STAT 2000', 'Introductory Statistics', 4], ['SPAN 2001', 'Intermediate Spanish', 3], ['GEOG 1112', 'Introduction to Weather and Climate', 3]]),
  ...done('Spring 2024', [['ECON 2106', 'Principles of Microeconomics', 3], ['SPAN 2002', 'Intermediate Spanish II', 3], ['HORT 2000E', 'Plants and Society', 3], ['PHIL 2010', 'Introduction to Philosophy', 3], ['INTL 1100', 'Introduction to Global Issues', 3]]),
  ...done('Fall 2024', [['POLS 2000', 'Introduction to Political Science', 3], ['HIST 2301', 'History of Western Society to 1500', 3], ['ECON 2105', 'Principles of Macroeconomics', 3], ['COMM 1110', 'Introduction to Public Speaking', 3], ['POLS 3000', 'Introduction to Political Analysis', 3]]),
  ...done('Spring 2025', [['POLS 4010', 'Political Theory', 3], ['POLS 4105', 'The American Presidency', 3], ['POLS 4110', 'Congress', 3], ['RELI 1001', 'Introduction to World Religions', 3], ['ANTH 1102', 'Introduction to Anthropology', 3]]),
  ...done('Fall 2025', [['POLS 4510', 'Judicial Process', 3], ['POLS 4520', 'Constitutional Law', 3], ['SOCI 1101', 'Introductory Sociology', 3], ['SOCI 3810', 'Criminology', 3], ['LEGL 2700', 'Legal and Regulatory Environment of Business', 3]]),
  ...done('Spring 2026', [['POLS 4700', 'Public Policy', 3], ['POLS 4780', 'Comparative Politics', 3], ['JOUR 3030', 'Media, News, and Consumers', 3], ['ECON 4750', 'Money and Banking', 3], ['GEOG 1101', 'Human Geography', 3]]),
  ...now([['POLS 4740', 'Policy Analysis', 3], ['POLS 4800', 'Senior Seminar', 3], ['POLS 4525', 'Civil Liberties', 3], ['LEGL 4750', 'Corporations, Law, and Society', 3], ['ENGL 2310', 'English Literature to 1700', 3]]),
];
const csci = [
  ...ap([['ENGL 1101', 'English Composition I', 3], ['MATH 2250', 'Calculus I for Science and Engineering', 4], ['PSYC 1101', 'Elementary Psychology', 3], ['HIST 2111', 'American History to 1865', 3]]),
  ...done('Fall 2023', [['FYOS 1001', 'First-Year Odyssey Seminar', 1], ['ENGL 1102', 'English Composition II', 3], ['CSCI 1301', 'Introduction to Computing and Programming', 4], ['MATH 2260', 'Calculus II', 4], ['POLS 1101', 'American Government', 3]]),
  ...done('Spring 2024', [['CSCI 1302', 'Software Development', 4], ['CSCI 2610', 'Discrete Mathematics', 4], ['PHYS 1211E', 'Principles of Physics I', 3], ['RELI 1001', 'Introduction to World Religions', 3], ['COMM 1500', 'Interpersonal Communication', 3]]),
  ...done('Fall 2024', [['CSCI 1730', 'Systems Programming', 4], ['CSCI 2670', 'Theory of Computation', 4], ['MATH 3300', 'Applied Linear Algebra', 3], ['BIOL 1107', 'Principles of Biology I', 3], ['ANTH 1102', 'Introduction to Anthropology', 3]]),
  ...done('Spring 2025', [['CSCI 2720', 'Data Structures', 4], ['CSCI 3030', 'Computing, Ethics, and Society', 3], ['STAT 2000', 'Introductory Statistics', 4], ['SPAN 1110', 'Accelerated Elementary Spanish', 3], ['GEOG 1130', 'Introduction to Globalization', 3]]),
  ...done('Fall 2025', [['CSCI 4470', 'Algorithms', 4], ['CSCI 4720', 'Computer Architecture', 4], ['CSCI 4050', 'Software Engineering', 4], ['MATH 2700', 'Elementary Differential Equations', 3]]),
  ...done('Spring 2026', [['CSCI 4730', 'Operating Systems', 4], ['CSCI 4380', 'Data Mining', 4], ['CSCI 4530', 'Computer Networks', 4], ['ECON 2106', 'Principles of Microeconomics', 3]]),
  ...now([['CSCI 4850', 'Machine Learning', 4], ['CSCI 4900', 'Software Engineering Capstone', 4], ['PHIL 2010', 'Introduction to Philosophy', 3], ['ENTR 5500', 'Introduction to Entrepreneurship', 3]]),
];
const astr = { institution: 'Georgia State University', lines: [{ code: 'ASTR 1000', title: 'Introduction to the Universe', credits: 3, grade: 'A', term: 'Spring 2023', status: 'completed', from: null, equivalent: null }] };

async function board({ programIds, lines, extra = [], after = 'entrepreneurship/startups' }) {
  const reading = { institution: 'University of Georgia', kind: 'transcript', hoursUnit: 'semester', courses: lines, exams: [], notes: [], credentials: [] };
  let record = T.matchTranscript(reading, 'transcript.pdf', lite, ['transcript.pdf'], null, 'uga', await TO.loadUgaTransfer([reading.institution]), crossListed);
  for (const more of extra) {
    const r = { institution: more.institution, kind: 'transcript', hoursUnit: 'semester', courses: more.lines, exams: [], notes: [], credentials: [] };
    globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
    const table = await TO.loadUgaTransfer([r.institution]);
    globalThis.fetch = originalFetch;
    const fresh = T.matchTranscript(r, 'second.pdf', lite, ['second.pdf'], null, 'uga', table, crossListed);
    record = { ...record, courses: T.applyTransferCaps([...record.courses, ...fresh.courses.map((c) => (!c.from && fresh.institution ? { ...c, from: fresh.institution } : c))], 'uga') };
  }
  const programs = programIds.map((id) => data.programs.find((p) => p.id === id));
  const emphasisSelections = Object.fromEntries(programs.flatMap((p) => U.ugaSelectionRequirements(p).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)])));
  const fetched = combinePrograms(programs.map((p, i) => U.loadUgaProgram(data, p, { resetRequirements: i === 0, emphasisSelections })));
  const coreCredit = TC.withCoreCredit(fetched.blocks, record);
  const loaded = coreCredit.blocks === fetched.blocks ? fetched : { ...fetched, blocks: coreCredit.blocks };
  const answers = {
    schoolId: 'uga', programLevel: 'undergraduate', programIds: [programIds[0]], minorIds: [], certificateIds: [], doubleDawgsPathwayId: null,
    emphasisSelections, collegeId: '', academicYear: O.inferAcademicYear("I'm a senior."), graduationSeason: '', graduationYear: null,
    alreadyTakenCourseCodes: [], studying: '', timeline: "I'm a senior.", timelineAt: TODAY.toISOString(), after, exams: [], transferText: '', transcript: record, languageYears: null, language: '',
  };
  const suggested = O.suggestGraduationTarget(answers.academicYear, 4, TODAY);
  answers.graduationSeason = suggested.season;
  answers.graduationYear = suggested.year;
  const context = T.withTranscriptCredits(data.context, record);
  const byCode = new Map(context.courses.map((c) => [norm(c.code), c]));
  const recorded = T.transcriptCourseCredits(record);
  const catalogCredits = (code) => recorded.get(norm(code)) ?? byCode.get(norm(code))?.credits ?? null;
  const priorHours = X.examElectiveHours([], [], T.transcriptIndirectCodes(record), catalogCredits) + T.transcriptHours(record) + T.transcriptCreditAdjustment(record, catalogCredits);
  const read = IS.readPriorCredit('', 0, byCode, [...T.transcriptCodes(record)], true, priorHours, null, '');
  const genEdCredits = T.transcriptGenEdCredits(record);
  const priorRead = { ...read, exemptCodes: [...new Set([...read.exemptCodes, ...T.transcriptExemptCodes(record)])], ...(genEdCredits.length ? { genEdCredits } : {}) };
  const takingNow = T.transcriptInProgressCodes(record);
  const prior = takingNow.length > 0 ? { ...priorRead, inProgressCodes: takingNow } : priorRead;
  const horizon = horizonFor(answers, TODAY, S.NO_SHAPE);
  const priorHere = horizon.assumedHours > 0 ? { ...prior, unmatchedCredits: prior.unmatchedCredits + horizon.assumedHours } : prior;
  const generated = generatePlan({
    requirements: loaded.blocks, context, prior: priorHere, horizon,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
    programId: loaded.summary.id, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
    degreeTotal: loaded.summary.totalCredits, interests: after, career: after,
    programName: loaded.program.name, programCollege: loaded.program.college, admissionRoute: null, residency: null, firstYear: false,
  });
  const plan = generated.plan;
  const completed = plan.completedCourseIds.map((id) => context.courses.find((c) => c.id === id)?.code).filter(Boolean).map(norm);
  const forfeited = new Set((generated.forfeited ?? []).map((f) => norm(f.held)));
  const priorCreditHours = planCreditRange(distinctHeld(completed.filter((c) => !forfeited.has(c)), context).codes, context).min + priorHours;
  const audit = auditUgaBoard({
    board: plan, context, undergraduate: loaded, priorCodes: completed,
    extraCredits: priorCreditHours - planCreditRange(completed, context).min + horizon.assumedHours,
    transcript: record, dualLevel: data.dualLevelCourses, coreCredit: coreCredit.used,
    validation: { minimumTermCredits: 12, priorCredits: priorCreditHours + horizon.assumedHours },
  });
  const booked = plan.terms.flatMap((t) => t.courseIds).map((id) => context.courses.find((c) => c.id === id)?.code).filter(Boolean).map(norm);
  const area = (label) => audit.areas.find((row) => row.area.label.endsWith(label));
  return { record, generated, audit, booked, area, bookedFor: (id) => Object.entries(generated.bookedFor ?? {}).filter(([, r]) => (typeof r === 'string' ? r : r?.requirementId) === id).map(([code]) => code) };
}

// ---------------------------------------------------------------------------
console.log('1. Terry\'s open elective blocks take the senior\'s own classes');
{
  const b = await board({ programIds: ['93328'], lines: rmin });
  const upper = b.area('Upper Division General Electives');
  const nonBusiness = b.area('University Wide General Electives (Non-Business)');
  expect(upper?.satisfied && nonBusiness?.satisfied, 'both blocks are met', `${upper?.earned}/${upper?.area.hours}, ${nonBusiness?.earned}/${nonBusiness?.area.hours}`);
  expect(b.bookedFor('93328::10::0').length === 0 && b.bookedFor('93328::11::0').length === 0, 'nothing is booked for either block', `${b.bookedFor('93328::10::0')} / ${b.bookedFor('93328::11::0')}`);
  // Since 2026-10-28 the board carries Terry's graduation requirements; this record holds no ECON course but ECON 2105 and 2106, so the economics one is the one class booked.
  expect(b.booked.length === 1 && b.booked[0] === 'ECON 2200', 'a senior with 128 credits and every row met is booked one class, the Terry economics course her record lacks', b.booked.join(', '));
  expect(b.audit.total <= 131, `the board totals what the record holds, and that course (${b.audit.total} of ${b.audit.target})`);
  const upperBlock = b.generated.pools.find((p) => p.requirementId === '93328::10::0');
  const nonBlock = b.generated.pools.find((p) => p.requirementId === '93328::11::0');
  const both = (upperBlock?.fromPriorCredit ?? []).filter((c) => (nonBlock?.fromPriorCredit ?? []).includes(c));
  expect(both.length === 0, 'no held class counts in both blocks ("Courses counted here cannot also count as Upper Division General Electives")', both.join(', '));
}

console.log('2. A transfer core elective fills its area with a minor and a certificate beside the degree');
{
  const b = await board({ programIds: ['93328', '28999', '70511'], lines: rmin.filter((l) => l.code !== 'GEOG 1112'), extra: [astr] });
  const line = b.record.courses.find((c) => c.code === 'ASTR 1000');
  expect(line?.designation === 'ASTR 1GXX', 'Georgia State ASTR 1000 reads as ASTR 1GXX', line?.designation);
  expect(b.area('II. Physical Sciences')?.satisfied, 'Physical Sciences is met');
  expect(!b.booked.some((c) => /^(ASTR|GEOG|PHYS|CHEM|GEOL) /.test(c)), 'no physical science is booked', b.booked.join(', '));
}

console.log('3. A UGA line under another number counts as its catalog course');
{
  const atsc = await board({ programIds: ['93328'], lines: swap(rmin, 'GEOG 1112', 'ATSC 1112') });
  const line = atsc.record.courses.find((c) => c.code === 'ATSC 1112');
  expect(line?.counts === 'course' && line?.matched === 'GEOG 1112', 'ATSC 1112 counts as GEOG 1112 (the schedule\'s cross-listing)', `${line?.counts} ${line?.matched}`);
  expect(!atsc.booked.some((c) => /^(ASTR|GEOG|PHYS|CHEM|GEOL|ATSC) /.test(c)), 'no physical science is booked', atsc.booked.join(', '));
  const cs = await board({ programIds: ['73962'], lines: csci, after: 'software engineer' });
  const phys = cs.record.courses.find((c) => c.code === 'PHYS 1211E');
  expect(phys?.counts === 'course' && phys?.matched === 'PHYS 1211', 'PHYS 1211E counts as PHYS 1211', `${phys?.counts} ${phys?.matched}`);
  expect(!cs.booked.some((c) => /^(ASTR|GEOG|PHYS|CHEM|GEOL) 1/.test(c)), 'no physical science is booked', cs.booked.join(', '));
  const old = T.matchTranscript({ institution: 'University of Georgia', kind: 'transcript', hoursUnit: 'semester', courses: [{ code: 'COMM 1100', title: 'Public Speaking', credits: 3, grade: 'A', term: 'Fall 2019', status: 'completed', from: null, equivalent: null }], exams: [], notes: [], credentials: [] }, 't.pdf', lite, ['t.pdf'], null, 'uga', null, crossListed).courses[0];
  expect(old.matched === 'COMM 1110', 'an older number on UGA\'s own record (COMM 1100) is the course now (COMM 1110)', old.matched);
}

console.log('4. "3000-level or higher" takes 4000-level classes');
{
  const raw = data.programs.find((p) => p.id === '46524');
  const row = raw.areas.flatMap((a) => a.groups.flatMap((g) => g.courses)).find((c) => c.code === 'POLS 3XXX');
  expect(row?.levelTo === 5, 'the Bulletin row "POLS prefix course 3000-level or higher" reads as 3000 to 5999', JSON.stringify(row));
  const b = await board({ programIds: ['46524'], lines: pols, after: 'law school' });
  expect(b.area('American Studies')?.satisfied, 'American Studies is met by the held 4000-level POLS classes', `${b.area('American Studies')?.earned}`);
  // Booked for a row, that is: a free elective for the law goal (POLS 3600 Criminal Justice Administration) is not the row's.
  expect(!b.booked.some((c) => /^POLS 3/.test(c) && (b.generated.bookedFor?.[c] ?? null) !== null), 'no 3000-level POLS class is booked for a requirement', b.booked.join(', '));
  expect(b.audit.total <= 125, `the board totals about what the record holds (${b.audit.total} of ${b.audit.target})`);
}

console.log('5. Minors and certificates list their 4000/6000 courses');
{
  const minor = data.programs.find((p) => p.id === '28999');
  const minorCodes = minor.areas.flatMap((a) => a.groups.flatMap((g) => g.courses.map((c) => c.code)));
  expect(minorCodes.includes('FHCE 4000') && minorCodes.includes('FHCE 5160'), 'the Consumer Economics minor lists its six-hour choice (FHCE 4000, FHCE 5160 ...)', minorCodes.join(' '));
  const cert = data.programs.find((p) => p.id === '70511');
  const certCodes = cert.areas.flatMap((a) => a.groups.flatMap((g) => g.courses.map((c) => c.code)));
  expect(['LEGL 4300', 'LEGL 4400', 'LEGL 4500', 'ECON 4450', 'FINA 4205'].every((c) => certCodes.includes(c)), 'the Legal Studies certificate lists LEGL 4300, 4400, 4500, ECON 4450 and FINA 4205', certCodes.join(' '));
  const b = await board({ programIds: ['93328', '28999', '70511'], lines: rmin });
  const certRow = b.area('Undergraduate Certificate in Legal Studies: Electives');
  expect(certRow?.satisfied, 'the certificate\'s electives are met by the held LEGL classes', `${certRow?.earned}/${certRow?.area.hours}`);
  expect(!b.generated.unsatisfied.some((u) => /Consumer Economics/.test(u.areaLabel) && u.reason === 'no-course-data'), 'the minor no longer has six unnamed hours');
  expect(b.booked.every((c) => /^FHCE [45]/.test(c) || c === 'ECON 2200') && b.booked.filter((c) => /^FHCE/.test(c)).length === 2, 'what is booked is the minor\'s own six hours, and the Terry economics course', b.booked.join(', '));
}

console.log('6. A required class is not also a general elective through another of its numbers');
{
  const loaded = U.loadUgaProgram(data, data.programs.find((p) => p.id === '93328'), {});
  const upper = loaded.blocks.find((b) => b.id === '93328::10::0');
  const codes = new Set(upper.rule.choices.flatMap((ch) => ch.codes));
  expect(!codes.has('RMIN 4000E') && !codes.has('MGMT 3001') && !codes.has('MARK 3001'), 'RMIN 4000E, MGMT 3001 and MARK 3001 are off the Upper Division list');
  const b = await board({ programIds: ['93328'], lines: rmin });
  const pool = b.generated.pools.find((p) => p.requirementId === '93328::10::0');
  expect(!(pool?.fromPriorCredit ?? []).some((c) => /^(RMIN 4000|MGMT 300|MARK 300|FINA 300)/.test(c)), 'held RMIN 4000 and MGMT 3000 do not count there', (pool?.fromPriorCredit ?? []).join(' '));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
