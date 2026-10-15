/**
 * Transfer lines the planner only thinks "may be" a course (transfer-maybe.ts).
 *
 * The Parkland example, a made-up record: BUS 101 "Introduction to Business"
 * and BUS 203 "Business Law I" count as hours, and the catalog only suggests
 * they may be BUS 101 and BADM 300. Before, a Gies board booked BUS 101 (and
 * BADM 300) anyway, so the student was scheduled for what they may hold.
 * Checked here, through matchTranscript and generatePlan as the browser runs
 * them:
 *   - both lines are "may be" lines, and the review note says to confirm
 *   - the board books neither suggested course, its held hours are what they
 *     were, and the requirement is left open (not held, not on the board)
 *   - nothing on the board is flagged for a prerequisite the suggestion clears
 *   - confirming the line builds the same board; rejecting it books the course
 *   - a record with no such line, and no record at all, change nothing
 *
 *   node lib/planner/__transfer-maybe.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
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
const { generatePlan, validatePlan } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const T = await import(join(HERE, 'transcript.ts'));
const M = await import(join(HERE, 'transfer-maybe.ts'));
const { illinoisProgress } = await import(join(ROOT, 'components', 'planner', 'illinois-progress.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const opt = (n) => (existsSync(join(PUBLIC, n)) ? read(n) : null);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = opt('illinois/offerings.json');
if (offeringsFile) applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const creditsOf = (code) => byCode.get(norm(code))?.credits ?? null;
const prereqs = new Map(Object.entries(read('illinois/prereqs.json')));
const exclusions = new Map(Object.entries(read('illinois/exclusions.json')));
const languagesFile = opt('illinois/languages.json');
const grades = new Map(); for (const g of read('illinois/grades.json')) grades.set(norm(g.code), toGradeRow(g, byCode.get(norm(g.code))?.title ?? g.code, []));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const context = { courses: rows, prereqs, grades, sections: new Map(), equivalents, exclusions, creditRanges, bands: meta.bands, offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(), offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile?.terms, offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined, languages: languagesFile ?? undefined, snapshotTerm: null, prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q) };
const catalog = rows.map((r) => ({ code: norm(r.code), title: r.title, credits: r.credits, level: r.level, cluster: r.cluster, tags: r.tags }));
const guide = opt('illinois-transfer-gened.json');
const summaries = read('illinois/programs.json');
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2028, stated: true };

let failures = 0;
const ok = (cond, what) => { if (cond) console.log(`  ok   ${what}`); else { failures += 1; console.log(`  FAIL ${what}`); } };

// ---- the Parkland example (made-up record, as a reading returns it) --------
const L = (code, title, credits, grade, term, iai = null) => ({ code, title, credits, grade, term, status: 'completed', from: null, equivalent: null, equivalentCredits: null, iai, genEdText: null });
const parkland = {
  institution: 'Parkland College', kind: 'transcript', hoursUnit: null, notes: [],
  exams: [{ kind: 'AP', exam: 'Calculus AB', score: '4', subscore: null }],
  courses: [
    L('ENG 101', 'Composition I', 3, 'A', 'Fall 2024', 'C1 900'), L('MAT 128', 'Calculus and Analytic Geometry I', 5, 'B', 'Fall 2024', 'M1 900-1'),
    L('ECO 101', 'Principles of Macroeconomics', 3, 'A', 'Fall 2024', 'S3 901'), L('ACC 101', 'Financial Accounting', 4, 'A', 'Fall 2024'),
    L('PSY 101', 'Introduction to Psychology', 3, 'B', 'Fall 2024', 'S6 900'), L('ENG 102', 'Composition II', 3, 'B', 'Spring 2025', 'C1 901R'),
    L('ECO 102', 'Principles of Microeconomics', 3, 'A', 'Spring 2025', 'S3 902'), L('ACC 102', 'Managerial Accounting', 4, 'D', 'Spring 2025'),
    L('BUS 101', 'Introduction to Business', 3, 'A', 'Spring 2025'), L('COM 103', 'Introduction to Public Speaking', 3, 'A', 'Spring 2025', 'C2 900'),
    L('MAT 141', 'Finite Mathematics', 3, 'B', 'Fall 2025', 'M1 906'), L('HIS 105', 'History of the U.S. 1877 to Present', 3, 'A', 'Fall 2025', 'S2 901'),
    L('CHE 141', 'General Chemistry I', 4, 'D', 'Fall 2025'), L('BUS 203', 'Business Law I', 3, 'B', 'Fall 2025'),
    L('PHI 105', 'Intro to Ethics', 3, 'A', 'Fall 2025', 'H4 904'), L('MAT 160', 'Statistics', 4, 'B', 'Spring 2026', 'M1 902'),
    L('ART 165', 'Art Appreciation', 3, 'A', 'Spring 2026', 'F2 900'), L('SOC 101', 'Introduction to Sociology', 3, 'B', 'Spring 2026', 'S7 900'),
    L('CSC 105', 'Application of Computers in Business', 3, 'A', 'Spring 2026'), L('PED 160', 'Weight Training', 1, 'A', 'Spring 2026'),
  ],
};
const record = T.matchTranscript(parkland, 't4-parkland.txt', catalog, ['t4-parkland.txt'], guide, 'illinois', null);

/** The build's prior, as buildPlan makes it, with or without the maybe step. */
function priorOf(rec, withMaybe) {
  const base = {
    courseCodes: T.transcriptCodes(rec), exemptCodes: [], known: true, languageSemesters: 4, languageName: 'Spanish',
    unmatchedCredits: T.transcriptHours(rec) + T.transcriptCreditAdjustment(rec), genEdCredits: T.transcriptGenEdCredits(rec),
  };
  return withMaybe ? M.withMaybeHeld(base, rec, creditsOf) : { prior: base, codes: [] };
}
function build(program, rec, withMaybe) {
  const blocks = adaptIllinoisPrograms({ school: 'illinois', source: program.url, fetchedAt: '', programs: [read(`illinois/program/${program.id}.json`)] }, new Map(byCode)).blocks.get(program.id) ?? [];
  const gen = (prior) => generatePlan({ requirements: blocks, context, prior, horizon: HORIZON, preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } }, programId: program.id, degreeTotal: program.totalCredits, programName: program.name, programCollege: program.college, arrival: { transfer: true, international: false } });
  const base = priorOf(rec, false).prior;
  // As buildPlan does it: hold only the suggestions the board would book.
  const held = withMaybe ? M.holdMaybe(base, rec, creditsOf, gen) : { prior: base, codes: [], generated: gen(base) };
  const { prior, codes } = held;
  const r = held.generated;
  const plan = M.openMaybeOnBoard(r.plan, codes, (code) => byCode.get(norm(code))?.id, (code) => equivalents.get(code) ?? [], new Set(T.transcriptCodes(rec).map(norm)));
  const board = r.terms.flatMap((t) => t.codes.map(norm));
  const heldCodes = plan.completedCourseIds.map((id) => rows.find((c) => c.id === id)?.code).filter(Boolean).map(norm);
  return { r, plan, board, held: heldCodes, blocks, codes, prior };
}

console.log('Parkland record: which lines only "may be" a course');
const maybe = M.maybeLines(record);
const maybeSet = maybe.map((m) => m.code);
console.log(`  maybe lines: ${maybe.map((m) => `${m.lineCode} -> ${m.code}`).join(', ') || 'none'}`);
ok(maybeSet.includes('BUS 101'), 'Parkland BUS 101 may be BUS 101');
ok(maybeSet.includes('BADM 300'), 'Parkland BUS 203 may be BADM 300');
ok(maybe.every((m) => record.courses[m.index].counts === 'hours'), 'every maybe line still counts as hours');
ok(!maybe.some((m) => ['HIS 105', 'PHI 105', 'MAT 160'].includes(m.lineCode)), 'a line the Parkland guide places in gen-ed categories is not a maybe');
const issues = M.maybeIssues(record, 'fa26');
ok(issues.some((i) => /Parkland College BUS 101 \(Introduction to Business\) may count as BUS 101: confirm it in the transfer list/.test(i.message)), 'review note: "your Parkland BUS 101 may count as BUS 101: confirm it in the transfer list"');
ok(issues.every((i) => /still count toward your total/.test(i.message)), 'review note says the hours still count');

const programs = ['bus/finance-bs', ...summaries.filter((s) => s.id.startsWith('bus/') && s.id !== 'bus/finance-bs' && existsSync(join(PUBLIC, 'illinois', 'program', `${s.id}.json`)) && readFileSync(join(PUBLIC, 'illinois', 'program', `${s.id}.json`), 'utf8').includes('"BADM 300"')).map((s) => s.id).slice(0, 1)]
  .map((id) => summaries.find((s) => s.id === id)).filter(Boolean);

for (const program of programs) {
  console.log(`\n${program.id}`);
  const before = build(program, record, false);
  const after = build(program, record, true);
  const bookedBefore = maybeSet.filter((c) => before.board.includes(c));
  const bookedAfter = maybeSet.filter((c) => after.board.includes(c));
  console.log(`  before: books ${bookedBefore.join(', ') || 'none'} of the maybe courses; ${before.r.credits.prior} held hr; ${before.board.length} courses on the board`);
  console.log(`  after:  books ${bookedAfter.join(', ') || 'none'}; ${after.r.credits.prior} held hr; ${after.board.length} courses; open until confirmed: ${(after.plan.maybeCourseIds ?? []).join(', ') || 'none'}`);
  ok(bookedBefore.length > 0, 'before the change the board booked a course the student may hold (the bug this fixes)');
  ok(bookedAfter.length === 0, 'the board books no course a Parkland line may already be');
  ok(Math.abs(after.r.credits.prior - before.r.credits.prior) < 0.01, `held hours unchanged (${before.r.credits.prior})`);
  ok(maybeSet.every((c) => !after.held.includes(c)), 'the maybe courses are not among the held courses (the rail leaves their requirement open)');
  ok(bookedBefore.every((c) => (after.plan.maybeCourseIds ?? []).includes(byCode.get(c)?.id)), 'the maybe courses ride on the board as maybeCourseIds');
  const rowsAfter = illinoisProgress({ blocks: after.blocks, boardCodes: after.board, priorCodes: after.held, byCode, pools: [], language: null, satisfiedByPriorCredit: M.withoutMaybe(after.r.satisfiedByPriorCredit, after.codes), equivalents, degreeTotal: program.totalCredits });
  const rowsBefore = illinoisProgress({ blocks: before.blocks, boardCodes: before.board, priorCodes: before.held, byCode, pools: [], language: null, satisfiedByPriorCredit: before.r.satisfiedByPriorCredit, equivalents, degreeTotal: program.totalCredits });
  const lost = rowsBefore.filter((row, i) => row.satisfied && !rowsAfter[i]?.satisfied).map((row) => row.area.label);
  console.log(`  rail rows left open by the maybe courses: ${lost.join('; ') || 'none'}`);
  ok(lost.every((label) => after.blocks.some((b) => b.label === label && /"(BUS 101|BADM 300)"/.test(JSON.stringify(b.rule)))), 'no other rail row changes');
  const coreAfter = rowsAfter.find((row) => after.blocks.some((b) => b.label === row.area.label && /"(BUS 101|BADM 300)"/.test(JSON.stringify(b.rule))));
  console.log(`  board before only: ${before.board.filter((c) => !after.board.includes(c)).join(', ')} | after only: ${after.board.filter((c) => !before.board.includes(c)).join(', ')}`);
  ok(Boolean(coreAfter) && !coreAfter.satisfied && !bookedBefore.some((c) => (coreAfter.codes ?? []).includes(c)), `the requirement the suggestion would fill (${coreAfter?.area.label ?? '?'}) is open on the rail, without ${bookedBefore.join(', ')}`);
  const errs = (plan) => validatePlan(plan, context, { minimumTermCredits: 12, programName: program.name, programCollege: program.college, priorCredits: after.r.credits.prior }).filter((i) => i.severity === 'error').map((i) => `${i.title}: ${i.message}`);
  const flagged = errs(after.plan).filter((e) => maybeSet.some((c) => e.includes(c)));
  ok(flagged.length === 0, `no prerequisite flag for a maybe course${flagged.length ? ` (${flagged[0].slice(0, 120)})` : ''}`);

  // Confirm: the line counts as the course; the board is the pending board.
  const idx = maybe.find((m) => m.code === bookedBefore[0])?.index ?? -1;
  const confirmed = T.setLineCounts(record, idx, { counts: 'course', code: bookedBefore[0] }, creditsOf);
  const yes = build(program, confirmed, true);
  ok(JSON.stringify(yes.r.terms.map((t) => t.codes)) === JSON.stringify(after.r.terms.map((t) => t.codes)), `confirming ${bookedBefore[0]} builds the same board`);
  ok(yes.held.includes(bookedBefore[0]), `after confirming, ${bookedBefore[0]} is held`);
  ok(Math.abs(yes.r.credits.prior - before.r.credits.prior) < 0.01, 'after confirming, held hours unchanged');
  // Reject: the line stays hours and the course is booked where the degree needs it.
  const rejected = M.declineMaybe(record, idx);
  const no = build(program, rejected, true);
  ok(!M.maybeCodes(rejected).includes(bookedBefore[0]), `after rejecting, ${bookedBefore[0]} is no longer a maybe`);
  ok(no.board.includes(bookedBefore[0]), `after rejecting, ${bookedBefore[0]} is booked`);
  ok(Math.abs(no.r.credits.prior - before.r.credits.prior) < 0.01, 'after rejecting, held hours unchanged');
}

console.log('\nA suggestion the board would not book changes nothing (made-up IU + DePaul record, Economics)');
{
  const I = (code, title, credits, from, term = 'Fall 2024', grade = 'A') => ({ code, title, credits, grade, term, status: 'completed', from, equivalent: null, equivalentCredits: null, iai: null, genEdText: null });
  const rec6 = T.matchTranscript({ institution: null, kind: 'transcript', hoursUnit: null, notes: [], exams: [], courses: [
    I('ENG-W 131', 'Reading, Writing, and Inquiry I', 3, 'Indiana University Bloomington'), I('MATH-M 211', 'Calculus I', 4, 'Indiana University Bloomington'),
    I('ECON-E 201', 'Introduction to Microeconomics', 3, 'Indiana University Bloomington'), I('CSCI-C 200', 'Introduction to Computers and Programming', 4, 'Indiana University Bloomington'),
    I('ECON-E 202', 'Introduction to Macroeconomics', 3, 'Indiana University Bloomington', 'Spring 2025'), I('MATH-M 212', 'Calculus II', 4, 'Indiana University Bloomington', 'Spring 2025'),
    I('MAT 150', 'Calculus for Business', 4, 'DePaul University', 'Fall 2025'), I('ECO 305', 'Intermediate Microeconomics', 4, 'DePaul University', 'Fall 2025'),
  ] }, 't6.txt', catalog, ['t6.txt'], guide, 'illinois', null);
  const econ = summaries.find((s) => s.id === 'las/economics-balas');
  const m6 = M.maybeCodes(rec6);
  console.log(`  maybe lines: ${m6.join(', ') || 'none'}`);
  if (econ && m6.length) {
    const b6 = build(econ, rec6, false);
    const a6 = build(econ, rec6, true);
    const notBooked = m6.filter((c) => !b6.board.includes(c));
    console.log(`  booked before: ${m6.filter((c) => b6.board.includes(c)).join(', ') || 'none'}; held after: ${a6.codes.join(', ') || 'none'}`);
    ok(notBooked.includes('MATH 234'), 'the board does not book MATH 234 (MATH 221 is held) to begin with');
    ok(notBooked.every((c) => !a6.codes.includes(c)), `a suggestion the board would not book is not held (${notBooked.join(', ')})`);
    ok(m6.every((c) => !a6.board.includes(c)), 'the board books none of the suggestions after');
    ok(Math.abs(a6.r.credits.prior - b6.r.credits.prior) < 0.01, `held hours unchanged (${b6.r.credits.prior})`);
  } else ok(false, 'the IU + DePaul record has a maybe line and Economics BALAS loads');
}

console.log('\nNo maybe line, no change');
const none = M.withMaybeHeld({ courseCodes: ['ECON 102'], exemptCodes: [], unmatchedCredits: 7, known: true }, null, creditsOf);
ok(none.codes.length === 0 && none.prior.unmatchedCredits === 7 && none.prior.courseCodes.length === 1, 'no record: prior untouched');
const home = T.matchTranscript({ institution: 'University of Illinois Urbana-Champaign', kind: 'transcript', exams: [], notes: [], courses: [L('ECON 102', 'Microeconomic Principles', 3, 'A', 'Fall 2025'), L('PSYC 100', 'Intro Psych', 4, 'B', 'Fall 2025')] }, 'home', catalog, ['home'], guide);
const homePrior = { courseCodes: T.transcriptCodes(home), exemptCodes: [], unmatchedCredits: 0, known: true };
const homeOut = M.withMaybeHeld(homePrior, home, creditsOf);
ok(homeOut.prior === homePrior && homeOut.codes.length === 0, 'an Illinois record with no maybe line: prior untouched (same object)');
const plan0 = { schemaVersion: 1, programId: 'x', graduationLabel: '', completedCourseIds: ['econ-102'], terms: [] };
ok(M.openMaybeOnBoard(plan0, [], (c) => c) === plan0, 'no maybe codes: board untouched (same object)');
ok(M.maybeIssues(home, 'fa26').length === 0, 'no maybe line: no review note');

console.log(failures ? `\n${failures} FAILED` : '\nall transfer-maybe checks pass');
process.exit(failures ? 1 : 0);
