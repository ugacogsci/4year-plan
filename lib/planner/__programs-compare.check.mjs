/**
 * compare_programs, replayed on real boards the way the workspace runs it.
 *
 * Run it with:  PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__programs-compare.check.mjs
 * It re-execs itself with the type-stripping flag. Exits non-zero on any failure.
 *
 * The planner planned one program and ALMA told a student wondering about a
 * second major to pick it under Program and look, which shows the second
 * program's plan and nothing about the pair. Illinois's own audit is no help
 * either ("your Degree Audit (DARS) will only display one major at a time",
 * Gies). lib/planner/programs-compare.ts reads the second page against the
 * student's board, names the pair by the colleges' rules and plans both. Held
 * here:
 *
 *   - The crawl has no minor or certificate page, and nothing pretends it does.
 *   - Psychology, BSLAS with Brain & Cognitive Science: an LAS double major; the
 *     PSYC courses on the board count for both; the cost is sane and the
 *     rebuilt plan breaks no prerequisite. With Economics: ECON and MATH added
 *     inside 120 hours.
 *   - A Finance student and Accountancy: a Gies double major, the business core
 *     shared, and the misread "one of eight" ACCY list said out loud, not
 *     reported as a one-course major.
 *   - Finance with Economics, BALAS is a dual degree: 154 hours, more terms at
 *     the plan's own pace, not 154 crammed into eight.
 *   - A what_if of the added courses on the student's own board, placed where
 *     placementsOnBoard puts them, adds no prerequisite error.
 *   - The second majors a board is closest to are real ones: Religion, BALAS,
 *     which reads as REL 231 alone, is never "one course away".
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const A = await import(join(HERE, 'autoplan.ts'));
const P = await import(join(HERE, 'programs-compare.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));

// --- the browser's load: loadIllinoisCore + buildContext ---------------------
const pub = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = pub('illinois/meta.json');
const rows = pub('illinois/index.json').map(hydrateIndexRow);
const offerings = pub('illinois/offerings.json');
applyOfferings(rows, offerings);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const byId = new Map(rows.map((c) => [c.id, c]));
const gradeRaw = new Map(pub('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom && gradeRaw.has(norm(c.gradeFrom))) gradeRaw.set(norm(c.code), gradeRaw.get(norm(c.gradeFrom)));
const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
const sectionFile = pub('illinois/sections.json');
const excellentFile = pub('illinois/excellent.json');
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const season = (meta.term?.term ?? 'fall').toLowerCase();
const context = {
  courses: rows,
  prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionFile.termId, termLabel: sectionFile.termLabel }])),
  equivalents,
  exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))),
  excellent: new Map(Object.entries(excellentFile.courses)),
  excellentTerms: excellentFile.terms,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offerings.courses)),
  offeringTerms: offerings.terms,
  offeringAliases: offerings.renumbered ? new Map(Object.entries(offerings.renumbered)) : undefined,
  languages: pub('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};

// --- the programs, as readPrograms (components/planner/illinois-source.tsx) reads them: one adapter call, no attach.
const summaries = pub('illinois/programs.json');
const catalogPrograms = summaries.filter((p) => p.dataStatus === 'catalog' && p.courseCount > 0);
const raws = new Map(summaries.map((s) => [s.id, pub(`illinois/program/${s.id}.json`)]));
const adapted = adaptIllinoisPrograms({ school: 'illinois', source: '', fetchedAt: '', programs: [...raws.values()] }, new Map(byCode));
const programById = new Map(adapted.programs.map((p) => [p.id, p]));
function side(id) {
  const summary = summaries.find((p) => p.id === id);
  if (!summary) throw new Error(`no program ${id}`);
  const raw = raws.get(id);
  return {
    id,
    name: summary.name,
    college: summary.college,
    url: raw.url || summary.url,
    totalCredits: summary.totalCredits || programById.get(id)?.totalCredits || null,
    requirements: adapted.blocks.get(id) ?? [],
    pageAreaHours: P.pageAreaHoursOf(id, raw),
  };
}

let failures = 0;
const check = (ok, msg) => {
  if (ok) console.log(`  ok    ${msg}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${msg}`);
  }
};
const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: false };
const FRESHMAN = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 2, languageName: 'Spanish', genEdCredits: [] };

/** A student's board as buildPlan makes it, and the input compare_programs rebuilds from. */
function build(programId, prior = FRESHMAN) {
  const p = side(programId);
  const input = {
    requirements: p.requirements,
    context,
    prior,
    horizon: FOUR_YEARS,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId,
    degreeTotal: p.totalCredits,
    interests: '',
    career: '',
    programName: p.name,
    programCollege: p.college,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  };
  const plan = A.generatePlan(input);
  const boardCodes = plan.terms.flatMap((t) => t.codes.map(norm));
  const held = plan.plan.completedCourseIds.map((id) => norm(byId.get(id)?.code ?? '')).filter(Boolean);
  return { side: p, input, plan, board: plan.plan, boardCodes, held };
}
function compare(base, secondId) {
  return P.comparePrograms({
    context,
    primary: base.side,
    second: side(secondId),
    heldCodes: base.held,
    boardCodes: base.boardCodes,
    language: base.plan.language,
    base: { input: base.input, plan: base.plan },
  });
}
const onBoard = (b, code) => b.boardCodes.includes(norm(code));
/** The rebuilt plan is sane: no new course left out, no prerequisite broken, the pair's total reached, every added course on it. */
function saneCost(label, c, maxExtraTerms) {
  const both = c.both;
  check(both !== null, `${label}: the pair is planned together`);
  if (!both) return;
  console.log(`    ${both.base.terms} terms / ${both.base.hours} h at ${both.base.pace} -> ${both.both.terms} terms / ${both.both.hours} h at ${both.both.pace}; +${both.extraHours} h, +${both.extraTerms} terms`);
  check(both.problems.length === 0, `${label}: no prerequisite or standing error on the rebuilt plan (${both.problems.slice(0, 2).join(' | ')})`);
  check(both.notPlaced.length === 0, `${label}: nothing new left unplaced (${both.notPlaced.slice(0, 2).join(' | ')})`);
  check(both.shortOfTotal === 0, `${label}: the rebuilt plan reaches the pair's ${c.pair.total} hours (short ${both.shortOfTotal})`);
  const placed = new Set(both.placed.map((p) => p.code));
  check(c.adds.every((code) => placed.has(code)), `${label}: every course the second program adds is on the rebuilt plan (${c.adds.filter((code) => !placed.has(code)).join(', ') || 'all'})`);
  check(both.extraTerms <= maxExtraTerms, `${label}: at most ${maxExtraTerms} more terms (${both.extraTerms})`);
  check(both.both.pace <= Math.max(both.base.pace + 1.5, 16), `${label}: the rebuilt plan keeps about the board's pace (${both.base.pace} -> ${both.both.pace})`);
}
/**
 * The added courses tried on the student's own board the way what_if tries
 * them: each added where placementsOnBoard puts it, then the board's checks
 * before and after. No new prerequisite or standing error is allowed.
 */
function whatIf(label, b, c) {
  // The options the workspace's validateOptions() passes for this board.
  const options = { minimumTermCredits: 12, maxTermCredits: 18, programName: b.side.name, programCollege: b.side.college, priorCredits: b.plan.credits.prior, away: b.plan.away, language: b.plan.language };
  const placements = P.placementsOnBoard({ context, board: b.board, placed: c.both?.placed ?? [], options });
  const here = placements.filter((p) => !p.pastFinish);
  let candidate = b.board;
  for (const p of here) {
    const id = byCode.get(p.code)?.id;
    candidate = { ...candidate, terms: candidate.terms.map((t) => (t.label === p.term ? { ...t, courseIds: [...t.courseIds, id] } : t)) };
  }
  const before = new Set(A.validatePlan(b.board, context, options).map((i) => i.id));
  const broke = A.validatePlan(candidate, context, options).filter((i) => !before.has(i.id) && i.severity === 'error' && /^ap-(prereq|standing)-/.test(i.id));
  const past = placements.filter((p) => p.pastFinish);
  console.log(`    what_if: ${here.map((p) => `${p.code} in ${p.term}`).join(', ')}${past.length ? `; past the board's last term: ${past.map((p) => `${p.code} (${p.term})`).join(', ')}` : ''}`);
  check(here.length > 0, `${label}: there are courses to try on the board`);
  check(past.every((p) => !b.board.terms.some((t) => t.label === p.term)), `${label}: only courses the rebuilt plan put past the board's last term are left off it`);
  check(here.every((p) => p.prerequisitesMet), `${label}: each added course sits where its prerequisites are met (${here.filter((p) => !p.prerequisitesMet).map((p) => p.code).join(', ') || 'all'})`);
  check(broke.length === 0, `${label}: what_if of the added courses breaks no prerequisite (${broke.map((i) => i.message).slice(0, 2).join(' | ')})`);
}

// --- minors are not in the crawl --------------------------------------------
{
  console.log('The crawl has no minor or certificate pages:');
  const minorish = summaries.filter((p) => /\bminor\b|\bcertificate\b/i.test(`${p.id} ${p.name}`));
  check(minorish.length === 0, `no program page is a minor or certificate (${minorish.map((p) => p.id).join(', ') || 'none'}); if the crawl adds them, compare_programs and this check should learn them`);
  const statsMinor = P.resolveProgram('statistics minor', catalogPrograms);
  check(statsMinor.minor && statsMinor.match === null, '"statistics minor" is read as a minor, and matches no page');
  check(P.resolveProgram('accountancy', catalogPrograms).match?.id === 'bus/accountancy-bs', '"accountancy" is Accountancy, BS, not Accountancy + Data Science');
  check(P.resolveProgram('econ', catalogPrograms).match?.id === 'las/economics-balas', '"econ" is Economics, BALAS');
  check(P.resolveProgram('Sociology, BALAS', catalogPrograms).match?.id === 'las/sociology-balas', 'a program named exactly is that program');
  check(/junior year/.test(P.CS_MINOR.text) && /registration advantage/.test(P.CS_MINOR.text) && /siebelschool/.test(P.CS_MINOR.source), 'the CS minor carries the Siebel School timing and priority rule with its page');
}

// --- how a pair is named -----------------------------------------------------
{
  console.log('\nWhich pair is which:');
  const kind = (a, b) => P.pairOf(side(a), side(b));
  const psychEcon = kind('las/psychology-bslas', 'las/economics-balas');
  check(psychEcon.kind === 'double-major' && psychEcon.total === 120 && psychEcon.rules.some((r) => r.source.includes('las.illinois.edu/academics/programs/double')), 'two LAS Sciences and Letters majors are a double major at 120 hours, citing LAS');
  const finAccy = kind('bus/finance-bs', 'bus/accountancy-bs');
  check(finAccy.kind === 'double-major' && finAccy.total === 124 && finAccy.rules.some((r) => /one major at a time/.test(r.text)), 'two Gies majors are a double major at 124, and the audit shows one at a time');
  const finEcon = kind('bus/finance-bs', 'las/economics-balas');
  check(finEcon.kind === 'dual-degree' && finEcon.total === 154 && finEcon.rules.some((r) => r.source.includes('studentcode')) && finEcon.rules.some((r) => /154/.test(r.text)), 'Finance with Economics, BALAS is a dual degree at 154, citing the Student Code and Gies');
  check(kind('bus/finance-bs', 'engineering/mechanical-engineering-bs').kind === 'not-allowed', 'Gies with Grainger is ruled out, as Gies says');
  check(kind('las/psychology-bslas', 'las/chemistry-bs').kind === 'dual-degree', 'Chemistry, BS (an LAS Specialized Curriculum) with Psychology is a dual degree');
  check(kind('las/psychology-bslas', 'las/chemistry-bslas').kind === 'double-major', 'Chemistry, BSLAS with Psychology is a double major');
  check(kind('las/psychology-bslas', 'las/psychology-bslas/social-psychology').kind === 'concentration', 'a concentration of the same major is not a second major');
  const lawPower = P.secondMajorSentences(side('las/political-science-balas/law-power'));
  check(lawPower.some((r) => /second major/.test(r.text)), `Political Science's own "second major, or a minor" sentence is quoted (${lawPower[0]?.text.slice(0, 90) ?? 'none'})`);
}

// --- Psychology, BSLAS -------------------------------------------------------
const psych = build('las/psychology-bslas');
{
  console.log('\nPsychology, BSLAS with Brain & Cognitive Science, BSLAS:');
  const c = compare(psych, 'las/brain-cognitive-science-bslas');
  console.log(`    already counts: ${c.alreadyCounts.map((a) => `${a.code}${a.alsoMajor ? '*' : ''}`).join(' ')}; adds ${c.adds.join(' ')} (${c.addsHours} h)`);
  check(c.pair.kind === 'double-major', 'an LAS double major');
  check(c.alreadyCounts.some((a) => a.code === 'PSYC 100' && a.alsoMajor), 'PSYC 100 on the board counts for both majors');
  check(c.adds.length > 0 && c.adds.every((code) => byCode.has(code) && !onBoard(psych, code)), 'what it adds is in the catalog and not already on the board');
  check(c.overlapShare > 0 && c.overlapShare < 1, `a share of Brain & Cognitive Science's hours is shared (${c.overlapShare})`);
  check(c.distinctAdvanced.asked === 12, 'the 12 distinct advanced hours LAS asks for are measured');
  saneCost('Psychology + BCOG', c, 1);
  whatIf('Psychology + BCOG', psych, c);
}
{
  console.log('\nPsychology, BSLAS with Economics, BALAS:');
  const c = compare(psych, 'las/economics-balas');
  console.log(`    adds ${c.adds.join(' ')} (${c.addsHours} h)`);
  check(['ECON 102', 'ECON 103', 'ECON 302', 'ECON 303'].every((code) => c.adds.includes(code)), 'the Economics core is what it adds');
  // The catalog credits one of ECON 202 and PSYC 235, and the board has PSYC 235.
  check(!c.adds.includes('ECON 202') && c.standIns.some((s) => /^ECON 202\b/.test(s) && /PSYC 235/.test(s)), `ECON 202 is not booked beside PSYC 235, and the department's call is named (${c.standIns[0] ?? 'nothing said'})`);
  const math = c.open.find((row) => /MATH/.test(row.label));
  check(math !== undefined && math.take.every((code) => !/^MATH 49\d$/.test(code)), `the 300/400-level MATH hours are not filled with research or graduate seminars (${math?.take.join(', ')})`);
  check(c.addsHours >= 30 && c.addsHours <= 45, `a sane number of hours (${c.addsHours})`);
  saneCost('Psychology + Economics', c, 1);
  whatIf('Psychology + Economics', psych, c);
}
{
  console.log('\nSecond majors within reach of a Psychology board:');
  const near = P.secondMajorsWithinReach({ context, primary: psych.side, candidates: catalogPrograms.filter((p) => p.id !== psych.side.id).map((p) => side(p.id)), heldCodes: psych.held, boardCodes: psych.boardCodes, language: psych.plan.language, limit: 5 });
  console.log(`    ${near.map((n) => `${n.name} (${n.coursesAway})`).join('; ')}`);
  check(near.length === 5, 'five are listed');
  check(!near.some((n) => n.name.startsWith('Religion') && n.coursesAway <= 2), 'Religion, BALAS, read as one course, is not offered as one course away');
  check(near.every((n) => n.doubts.length === 0 && n.unread === 0), 'the closest ones are pages the planner reads cleanly');
  check(near.every((n) => !n.id.startsWith('las/psychology-bslas')), 'Psychology\'s own concentrations are not second majors');
  check(near.every((n) => n.adds.every((code) => !onBoard(psych, code))), 'nothing listed to add is already on the board');
}

// --- Finance, BS -------------------------------------------------------------
const finance = build('bus/finance-bs');
{
  console.log('\nFinance, BS with Accountancy, BS as a second major:');
  const c = compare(finance, 'bus/accountancy-bs');
  console.log(`    adds ${c.adds.join(' ')}; doubts: ${c.doubts.join(' | ').slice(0, 160)}`);
  const core = ['ACCY 201', 'ACCY 202', 'BUS 101', 'BADM 210', 'ECON 102', 'FIN 221'];
  check(core.every((code) => c.alreadyCounts.some((a) => a.code === code && a.alsoMajor)), 'the business core on the board counts for both majors');
  check(c.adds.length > 0 && c.adds.every((code) => code.startsWith('ACCY ')), 'what it adds is Accountancy\'s own courses');
  // The crawl folded "Select one of the following:" into the whole list, so the
  // page's 21 hours read as one course of eight. Either the reading is fixed or
  // the comparison says it cannot be trusted.
  check(c.addsHours >= 18 || c.doubts.some((d) => /21 hours/.test(d)), 'a one-course reading of a 21-hour major is flagged, not reported as the cost');
  saneCost('Finance + Accountancy', c, 0);
  whatIf('Finance + Accountancy', finance, c);
}
{
  console.log('\nFinance, BS with Economics, BALAS (another college):');
  const c = compare(finance, 'las/economics-balas');
  check(c.pair.kind === 'dual-degree' && c.pair.total === 154, 'a dual degree at 154 hours');
  check(c.alreadyCounts.some((a) => a.code === 'ECON 102' && a.alsoMajor), 'ECON 102, Finance\'s own, counts toward Economics too');
  check(c.languageOwed === 1, `LAS's fourth semester of the language is one more than Gies's third (${c.languageOwed})`);
  saneCost('Finance + Economics', c, 3);
  check((c.both?.extraTerms ?? 0) >= 1 && (c.both?.extraHours ?? 0) >= 29, `30 more hours take more terms (${c.both?.extraTerms} terms, ${c.both?.extraHours} h)`);
  whatIf('Finance + Economics', finance, c);
}
{
  console.log('\nSecond majors within reach of a Finance board:');
  const near = P.secondMajorsWithinReach({ context, primary: finance.side, candidates: catalogPrograms.filter((p) => p.id !== finance.side.id).map((p) => side(p.id)), heldCodes: finance.held, boardCodes: finance.boardCodes, language: finance.plan.language, limit: 5 });
  console.log(`    ${near.map((n) => `${n.name} (${n.coursesAway})`).join('; ')}`);
  check(near.every((n) => n.kind === 'double-major' && n.id.startsWith('bus/')), 'the closest are Gies majors, which share the business core');
  check(near.every((n) => n.alreadyCounting >= 15), 'each already counts the business core on the board');
  check(!near.some((n) => n.id === 'bus/accountancy-bs' && n.coursesAway <= 2), 'Accountancy\'s misread list does not make it one course away');
}

// --- held credit -------------------------------------------------------------
{
  console.log('\nHeld credit counts, and the board is only read:');
  const transfer = build('las/psychology-bslas', { ...FRESHMAN, courseCodes: ['ECON 102', 'MATH 220'] });
  const before = JSON.stringify(transfer.board);
  const c = compare(transfer, 'las/economics-balas');
  check(c.alreadyCounts.some((a) => a.code === 'ECON 102' && a.held), 'a held ECON 102 counts, marked as taken');
  check(!c.adds.includes('ECON 102') && !c.adds.includes('MATH 221'), 'nothing held is added again, and MATH 220 meets "MATH 220 or MATH 221"');
  check(JSON.stringify(transfer.board) === before, 'the student\'s board is unchanged');
}

console.log(failures === 0 ? '\nAll programs-compare checks passed.' : `\n${failures} programs-compare check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
