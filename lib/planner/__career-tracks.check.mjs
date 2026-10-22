/**
 * Career tracks and the prerequisites around them, on the PRODUCT path.
 *
 * A student who writes "physical therapy school" or "medical school" gets the
 * Career Center's course list booked into the plan (lib/planner/career-tracks.ts).
 * Four ways that went wrong, each reported against a real plan, and each kept
 * fixed here:
 *
 *   1. CHEM 102 reads "Credit in or exemption from MATH 112". The plan booked
 *      MATH 112 beside MATH 221 for a Mechanical Engineering freshman, and for
 *      a pre-health student with no calculus the track never placed general
 *      chemistry at all. A course above MATH 112 in its own sequence, booked
 *      or held, now meets the exemption and the plan says so in a note.
 *   2. MCB 244's "CHEM 101, CHEM 102, or equivalent" was resolved to CHEM 101
 *      before the track booked CHEM 102 through 105: five chemistry courses
 *      where four do. A choice now resolves toward the track's own course.
 *   3. Track courses were booked by the elective fill, lightest term first,
 *      after every required course: MCB 151, IB 150 and PSYC 238 in a pre-PT
 *      student's graduating spring. They are now placed with the degree's own
 *      courses, earliest first, the core sciences by the spring before
 *      applications go out (term 6 of 8 for a freshman), a lab in its
 *      lecture's term, and a row that cannot meet its date is named in the
 *      track's note with the reason.
 *   4. The spring a pre-med prepares for the MCAT holds at most one
 *      hardest-band course where the degree allows it, and the plan says so
 *      where it does not.
 *   5. The second half of a sequence follows the first in the next term it
 *      runs: a Finance freshman had ACCY 201 in Spring 2027 and ACCY 202 in
 *      Fall 2029, because ACCY 202 has nothing after it to pull it forward.
 *
 * Loaded the way the browser loads a first plan (index.json rows, prereqs.json,
 * exclusions.json, offerings, grades keyed by code and by gradeFrom twin, and
 * each degree adapted from its own program/<id>.json), not through the full
 * catalog adapter the first paint never sees.
 *
 *   node lib/planner/__career-tracks.check.mjs      (about a minute)
 *
 * Exits non-zero on any failed check.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`));

const { generatePlan, validatePlan, courseIdFor, resolveBundles } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { labPartners, CAREER_TRACKS } = await import(join(HERE, 'career-tracks.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));

const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

// ---- the browser's core, as buildContext sees it ----------------------------
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = read('illinois/offerings.json');
applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom && gradeRaw.has(norm(c.gradeFrom))) gradeRaw.set(norm(c.code), gradeRaw.get(norm(c.gradeFrom)));
const grades = new Map();
for (const [code, g] of gradeRaw) grades.set(code, toGradeRow(g, byCode.get(code)?.title ?? code, []));
const sectionsFile = read('illinois/sections.json');
const excellentFile = existsSync(join(PUBLIC, 'illinois', 'excellent.json')) ? read('illinois/excellent.json') : null;
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
  prereqs: new Map(Object.entries(read('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionsFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionsFile.termId, termLabel: sectionsFile.termLabel }])),
  equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))),
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined,
  excellentTerms: excellentFile ? excellentFile.terms : undefined,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offeringsFile.courses)),
  offeringTerms: offeringsFile.terms,
  offeringAliases: offeringsFile.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  languages: read('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (spec, earlier, sameTerm, eq) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, eq),
};
const summaries = read('illinois/programs.json');
const hard = meta.bands?.hardest ?? 65;
const isHard = (code) => (grades.get(norm(code))?.difficulty ?? -1) >= hard;

const H4 = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const FRESH = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };
/** Spring 2029, the sixth of eight terms: the last spring before AMCAS, PTCAS and CASPA open. */
const DUE = 5;
const CALCULUS = ['MATH 220', 'MATH 221', 'MATH 231', 'MATH 234', 'MATH 241'];
const LABS = labPartners();

function plan(programId, after, { prior = FRESH, horizon = H4, priorities = PRIORITY_PRESETS.balanced, extraBlocks = [] } = {}) {
  const s = summaries.find((p) => p.id === programId);
  if (!s) throw new Error(`no program ${programId}`);
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [read(`illinois/program/${s.id}.json`)] }, new Map(byCode));
  const program = adapted.programs[0];
  const g = generatePlan({
    requirements: [...(adapted.blocks.get(s.id) ?? []), ...extraBlocks],
    context,
    prior,
    horizon,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities },
    programId: s.id,
    degreeTotal: s.totalCredits || program.totalCredits || 120,
    // As the workspace passes them: the free words, and the career words
    // alone, which is where tracks are read from.
    interests: after,
    career: after,
    programName: program.name,
    programCollege: program.college,
  });
  const at = (code) => g.terms.findIndex((t) => t.codes.includes(norm(code)));
  const issues = validatePlan(g.plan, context, { minimumTermCredits: 12, maxTermCredits: 18, programName: program.name, programCollege: program.college });
  return { g, at, issues, program };
}

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `\n          ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const board = (g) => g.terms.map((t, i) => `${i} ${t.label}: ${t.codes.join(', ')}`).join('\n          ');
const errors = (issues, prefix) => issues.filter((i) => i.severity === 'error' && i.id.startsWith(prefix));
/** The first term after `after` that runs `code`, by the offerings the plan reads. */
const nextRun = (g, code, after) => g.terms.findIndex((t, i) => i > after && (byCode.get(norm(code))?.offeredIn ?? []).includes(t.season));

// ---- 1. "Credit in or exemption from MATH 112" -------------------------------
console.log('\n1. CHEM 102 and the MATH 112 exemption');
{
  const { g, at, issues } = plan('engineering/mechanical-engineering-bs', '');
  check(at('MATH 112') < 0 && at('MATH 221') >= 0, 'Mechanical Engineering: MATH 221 booked, MATH 112 not', board(g));
  check(g.notes.some((n) => n.includes('CHEM 102 asks for "Credit in or exemption from MATH 112"') && n.includes('MATH 221')), 'the plan says why MATH 112 is not booked');
  check(at('CHEM 102') >= 0 && at('CHEM 102') === at('CHEM 103'), `CHEM 102 and its lab CHEM 103 in one term (${at('CHEM 102')}, ${at('CHEM 103')})`);
  check(errors(issues, 'ap-prereq-').length === 0 && errors(issues, 'ap-standing-').length === 0, 'no prerequisite or standing errors', errors(issues, 'ap-').map((i) => i.message).join(' | '));
}
{
  const { g, at, issues } = plan('las/molecular-cellular-biology-bslas', '');
  check(at('MATH 112') < 0 && at('MATH 220') >= 0, 'Molecular & Cellular Biology: MATH 220 booked, MATH 112 not', board(g));
  check(errors(issues, 'ap-prereq-').length === 0, 'no prerequisite errors', errors(issues, 'ap-').map((i) => i.message).join(' | '));
}
{
  // Held calculus meets it too, and the note says the student has it.
  const prior = { ...FRESH, courseCodes: ['MATH 221'] };
  const { g, at } = plan('las/psychology-bslas', 'medical school', { prior });
  check(at('MATH 112') < 0 && at('CHEM 102') >= 0, 'pre-med Psychology holding MATH 221: CHEM 102 booked, MATH 112 not', board(g));
  check(g.notes.some((n) => /CHEM 102 asks for .*You have MATH 221/.test(n)), 'the note names the MATH 221 the student holds');
}
{
  // With no calculus anywhere the rule still binds: MATH 112 comes first.
  const { g, at } = plan('las/psychology-bslas', 'medical school');
  check(at('MATH 112') >= 0 && at('MATH 112') < at('CHEM 102'), `pre-med Psychology with no calculus: MATH 112 (${at('MATH 112')}) before CHEM 102 (${at('CHEM 102')})`, board(g));
}
{
  // The review list agrees with the engine, and only while the calculus is on the board.
  const id = (code) => courseIdFor(code);
  const term = (tid, label, codes) => ({ id: tid, label, year: 1, season: label.split(' ')[0], courseIds: codes.map(id) });
  const withCalculus = { schemaVersion: 1, programId: '', graduationLabel: '', completedCourseIds: [], exemptCourseIds: [], terms: [term('fa26', 'Fall 2026', ['CHEM 102', 'CHEM 103']), term('sp27', 'Spring 2027', ['MATH 221'])] };
  const without = { ...withCalculus, terms: [withCalculus.terms[0]] };
  const flagged = (p) => validatePlan(p, context).some((i) => i.severity === 'error' && i.id.startsWith('ap-prereq-') && i.message.startsWith('CHEM 102') && i.message.includes('MATH 112'));
  check(!flagged(withCalculus), 'validatePlan: CHEM 102 in Fall 2026 stands on MATH 221 in Spring 2027');
  check(flagged(without), 'validatePlan: CHEM 102 with no calculus and no MATH 112 is still a prerequisite conflict');
}
{
  // CHEM 101's own math clause is prior learning, as before: a note, never a booking.
  const { g, at } = plan('ahs/kinesiology-bs/applied-exercise-science', '');
  check(at('CHEM 101') >= 0 && at('MATH 112') < 0 && g.priorLearning.some((c) => c.code === 'CHEM 101' && /MATH 112/.test(c.message)), 'Kinesiology with no track: CHEM 101 for MCB 244, its MATH 112 left to the prior-learning note', board(g));
}

// ---- 2. a choice resolves toward the track's own course ----------------------
console.log('\n2. Stand-ins resolve toward the track');
{
  // MCB 244 takes "CHEM 101, CHEM 102, or equivalent": CHEM 102 for pre-PT.
  const { g, at } = plan('ahs/kinesiology-bs/applied-exercise-science', 'physical therapy school');
  check(at('CHEM 101') < 0 && at('CHEM 102') >= 0 && g.addedPrerequisites.some((a) => a.code === 'CHEM 102' && a.requiredBy === 'MCB 244'), 'pre-PT Kinesiology: MCB 244 takes CHEM 102, and no CHEM 101', board(g));
}
{
  // A degree row read as "CHEM 101 or CHEM 102" picks CHEM 101 on depth (CHEM
  // 102 sits behind MATH 112), and gives it up once the track books CHEM 102.
  const row = { id: 'check::chemistry', areaId: 'check', areaLabel: 'Chemistry', label: 'Chemistry', hours: 4, rule: { kind: 'all', choices: [{ codes: ['CHEM 101', 'CHEM 102'], credits: 4, substitutes: [] }] }, note: '', url: '' };
  const without = plan('ahs/kinesiology-bs/applied-exercise-science', '', { extraBlocks: [row] });
  check(without.at('CHEM 101') >= 0 && without.g.bookedFor['CHEM 101'] === row.id, 'with no track the row takes CHEM 101', board(without.g));
  const { g, at } = plan('ahs/kinesiology-bs/applied-exercise-science', 'physical therapy school', { extraBlocks: [row] });
  check(at('CHEM 101') < 0 && g.bookedFor['CHEM 102'] === row.id, 'pre-PT: the row takes CHEM 102, which counts for both', board(g));
  check(g.notes.some((n) => n.startsWith('CHEM 102 takes the place of CHEM 101 for Chemistry')), 'the plan says so');
  check(!g.priorLearning.some((c) => c.code === 'CHEM 101'), "CHEM 101's prior-learning question goes with it");
}

// ---- 3-4. the tracks --------------------------------------------------------
const STUDENTS = [
  { name: 'Kinesiology pre-PT', program: 'ahs/kinesiology-bs/applied-exercise-science', after: 'physical therapy school', track: 'pre-physical-therapy' },
  { name: 'Kinesiology pre-PT, lightest', program: 'ahs/kinesiology-bs/applied-exercise-science', after: 'physical therapy school', track: 'pre-physical-therapy', priorities: PRIORITY_PRESETS.lightest },
  { name: 'Psychology pre-med', program: 'las/psychology-bslas', after: 'medical school', track: 'pre-medicine' },
  { name: 'Computer Science pre-med', program: 'engineering/computer-science-bs', after: 'med school', track: 'pre-medicine' },
  { name: 'MCB pre-med', program: 'las/molecular-cellular-biology-bslas', after: 'pre-med', track: 'pre-medicine' },
];
for (const st of STUDENTS) {
  console.log(`\n${st.name} ("${st.after}")`);
  const { g, at, issues } = plan(st.program, st.after, { priorities: st.priorities });
  const track = CAREER_TRACKS.find((t) => t.id === st.track);
  const onBoard = new Set(g.terms.flatMap((t) => t.codes));
  const note = g.notes.find((n) => n.startsWith(`${track.name}:`)) ?? '';
  check(note.length > 0, 'the plan carries the track note');

  // Every required row, by the spring before applications go out, unless the
  // credit rule shut it (MCB 151 beside an MCB major's MCB 251) and the note says so.
  const late = [];
  for (const row of track.courses.filter((r) => r.need === 'required')) {
    const codes = row.codes.map(norm);
    const placed = codes.filter((c) => onBoard.has(c));
    if (placed.length === 0) {
      if (codes.some((c) => note.includes(`so ${c} is left out`))) continue;
      late.push(`${codes.join('/')} not on the board`);
      continue;
    }
    const when = Math.min(...placed.map(at));
    if (when > DUE) late.push(`${placed.join('/')} in term ${when}`);
  }
  check(late.length === 0, 'every required track row by Spring 2029, term 6 of 8', `${late.join('; ')}\n          ${board(g)}`);

  check(!(onBoard.has('CHEM 101') && onBoard.has('CHEM 102')), 'no CHEM 101 beside CHEM 102');
  check(!(onBoard.has('MATH 112') && CALCULUS.some((c) => onBoard.has(c))), 'no MATH 112 beside calculus', board(g));
  // Only pairs the parsed catalog lets share a term: MCB 251 reads "Concurrent
  // or prior enrollment in MCB 250", and the parser read it as prior only.
  const together = ([lab, lecture]) => (context.prereqs.get(lab)?.groups ?? []).every((grp) => !grp.any.map(norm).includes(lecture) || grp.concurrent);
  const split = [...LABS].filter(together).filter(([lab, lecture]) => onBoard.has(lab) && onBoard.has(lecture) && at(lab) !== at(lecture)).map(([lab, lecture]) => `${lecture}@${at(lecture)} ${lab}@${at(lab)}`);
  check(split.length === 0, 'every lecture and its lab in one term', split.join(', '));
  check(errors(issues, 'ap-prereq-').length === 0 && errors(issues, 'ap-standing-').length === 0, 'no prerequisite or standing errors', errors(issues, 'ap-').map((i) => i.message).join(' | '));
  for (const [first, second] of [['CHEM 102', 'CHEM 104'], ['MCB 244', 'MCB 246']]) {
    if (!onBoard.has(first) || !onBoard.has(second)) continue;
    const next = nextRun(g, second, at(first));
    check(at(second) === next, `${second} (${at(second)}) in the next term it runs after ${first} (${at(first)})`, board(g));
  }

  if (track.exam) {
    const spring = g.terms[DUE];
    const hardThere = spring.codes.filter(isHard);
    const said = g.notes.some((n) => n.startsWith(`${spring.label} is the spring the MCAT is prepared for`));
    check(hardThere.length <= 1 || said, `${spring.label}, the MCAT spring: ${hardThere.length} hardest-band (${hardThere.join(', ') || 'none'})${hardThere.length > 1 ? ', and the plan says why' : ''}`);
    for (const code of ['PSYC 100', 'SOC 100']) {
      if (onBoard.has(code)) check(at(code) <= DUE, `${code} before the MCAT (term ${at(code)})`);
      else check(note.includes(code), `${code} not booked, and the note names it`);
    }
  }
}

{
  // A semester abroad in Spring 2028 leaves one spring fewer before the
  // application. A row the track only recommends still keeps its date: SOC
  // 100 (before the MCAT) and CHEM 332 waited behind every required course
  // and landed in Fall 2029 while Spring 2029 held two category fillers.
  console.log('\nPsychology pre-med, abroad in Spring 2028');
  const horizon = { ...H4, away: [{ season: 'Spring', year: 2028, kind: 'study_abroad' }] };
  const { g, at, issues } = plan('las/psychology-bslas', 'medical school', { horizon });
  const due = g.terms.findIndex((t) => t.label === 'Spring 2029');
  const dated = ['SOC 100', 'CHEM 332', 'MCB 450', 'PSYC 100', 'PHYS 102', 'CHEM 232', 'IB 150', 'MCB 150'].filter((c) => at(c) > due);
  check(due >= 0 && dated.length === 0, 'every dated row by Spring 2029, the recommended ones included', `${dated.join(', ')}\n          ${board(g)}`);
  check(errors(issues, 'ap-prereq-').length === 0 && errors(issues, 'ap-standing-').length === 0, 'no prerequisite or standing errors', errors(issues, 'ap-').map((i) => i.message).join(' | '));
}

{
  // The MCAT spring spread (autoplan spreadExamTerm): an Integrative Biology
  // pre-med had Organic II, biochemistry and PSYC 100 in that one spring. Where
  // three or more of the courses the MCAT leans on share it, one that can go
  // earlier trades places with a free course of about the same hours, and the
  // plan says which.
  console.log('\nThe MCAT spring holds at most two of the courses the MCAT leans on, where a course can go earlier');
  const content = (CAREER_TRACKS.find((t) => t.id === 'pre-medicine')?.exam?.content ?? []).map(norm);
  check(content.includes('PSYC 100') && content.includes('CHEM 332'), 'the pre-medicine track names the MCAT courses', content.join(', '));
  for (const id of ['bus/accountancy-bs', 'las/astronomy-bslas']) {
    const { g, issues } = plan(id, 'medical school');
    const spring = g.terms[DUE];
    const there = spring.codes.filter((c) => content.includes(norm(c)));
    const said = g.notes.find((n) => n.includes('the spring the plan leaves for MCAT preparation')) ?? '';
    check(there.length <= 2, `${id}: ${spring.label} holds ${there.length} (${there.join(', ') || 'none'})`, board(g));
    if (said) check(/moved earlier, to (Fall|Spring) \d{4}/.test(said) && /instead of \d\.$/.test(said), `${id}: the plan names the course it moved and the count it leaves`, said);
    check(errors(issues, 'ap-prereq-').length === 0, `${id}: no prerequisite errors`, errors(issues, 'ap-').map((i) => i.message).join(' | '));
  }
}

// ---- 5. the second half of a sequence follows the first ------------------------
console.log('\n5. Sequences in consecutive terms');
{
  // The Gies core prints "ECON 102 Microeconomic Principles and
  // Macroeconomic Principles (6)" as one row: resolved, each course carries
  // the set it came from.
  const row = { id: 'check::econ', areaId: 'check', areaLabel: 'Core', label: 'Core', hours: 6, rule: { kind: 'all', choices: [{ codes: ['ECON 102'], credits: 6, substitutes: [], bundles: [['ECON 102', 'ECON 103']] }] }, note: '', url: '' };
  const resolved = resolveBundles([row], FRESH, context)[0].rule.choices;
  check(JSON.stringify(resolved.map((c) => [c.codes[0], c.set])) === JSON.stringify([['ECON 102', ['ECON 102', 'ECON 103']], ['ECON 103', ['ECON 102', 'ECON 103']]]), 'a resolved set keeps its members on each course', JSON.stringify(resolved));
}
{
  const { g, at, issues } = plan('bus/finance-bs', 'Investment banking or corporate finance.');
  check(at('ACCY 201') >= 0 && at('ACCY 202') === nextRun(g, 'ACCY 202', at('ACCY 201')), `Finance: ACCY 202 (${at('ACCY 202')}) the term after ACCY 201 (${at('ACCY 201')})`, board(g));
  // BADM 211 also asks for CS 105, taken before it.
  const ready = Math.max(at('BADM 210'), at('CS 105'));
  check(at('BADM 210') >= 0 && at('BADM 211') === nextRun(g, 'BADM 211', ready), `Finance: BADM 211 (${at('BADM 211')}) the first term after BADM 210 (${at('BADM 210')}) and CS 105 (${at('CS 105')})`, board(g));
  check(Math.abs(at('ECON 102') - at('ECON 103')) <= 1, `Finance: ECON 102 (${at('ECON 102')}) and ECON 103 (${at('ECON 103')}) in one year`);
  const used = g.terms.filter((t) => t.codes.length > 0).length;
  check(used <= 8 && g.notPlaced.length === 0, `Finance: every course placed in ${used} terms of 8`, g.notPlaced.map((n) => n.code).join(', '));
  const stacked = g.terms.slice(0, -1).filter((t) => t.codes.filter(isHard).length > 2).map((t) => t.label);
  check(stacked.length === 0, 'Finance: no term before the last past two hardest-band courses', stacked.join(', '));
  check(errors(issues, 'ap-prereq-').length === 0 && errors(issues, 'ap-standing-').length === 0, 'Finance: no prerequisite or standing errors', errors(issues, 'ap-').map((i) => i.message).join(' | '));
}
{
  const { g, at } = plan('engineering/mechanical-engineering-bs', '');
  check(at('CHEM 104') === nextRun(g, 'CHEM 104', at('CHEM 102')), `Mechanical Engineering: CHEM 104 (${at('CHEM 104')}) the term after CHEM 102 (${at('CHEM 102')})`, board(g));
}

// ---- a date that cannot be met is said, with the reason ----------------------
console.log('\nA date the plan cannot meet');
{
  // Graduating in two years leaves one spring before the application: the
  // chemistry chain alone takes three.
  const { g } = plan('las/psychology-bslas', 'medical school', { horizon: { ...H4, gradYear: 2028 } });
  const note = g.notes.find((n) => n.startsWith('Pre-medicine (MD/DO):')) ?? '';
  check(/lands in (Fall|Spring) \d{4}, after Spring 2027, the last term before applications go out: /.test(note) || /did not fit/.test(note), 'the track note names the late rows and why', note.slice(0, 400));
}

// ---- 6. UGA's own tracks ------------------------------------------------------
/*
 * UGA's pre-health tracks (uga-career-tracks.ts), on UGA boards built with the
 * shipped adapter (components/planner/uga-source.tsx), the way
 * __uga-integration.check.mjs builds them: a UGA student who says "medical
 * school" gets the Pre-Professional Advising Office's list, and one who names
 * no pre-health goal gets the board she got before.
 */
console.log("\n6. UGA's pre-health tracks");
{
  const ROOT = join(HERE, '..', '..');
  const { pathToFileURL } = await import('node:url');
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
  const T = await import(join(HERE, 'career-tracks.ts'));
  const { planCreditRange } = await import(join(HERE, 'autoplan.ts'));
  const G = await import(join(HERE, 'uga-planning-guidance.ts'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(join(PUBLIC, String(typeof url === 'string' ? url : url.url).replace(/^\//, '')), 'utf8'));
  const U = await import(join(ROOT, 'components', 'planner', 'uga-source.tsx'));
  const uga = await U.loadUgaData();
  globalThis.fetch = realFetch;

  // -- the data
  const ill = new Map(T.CAREER_TRACKS.map((t) => [t.id, t]));
  const ids = T.UGA_CAREER_TRACKS.map((t) => t.id);
  check(ids.length === 8 && ids.every((id) => ill.has(id)) && !ids.includes('pre-law'), `8 UGA tracks, each an Illinois track's id, no pre-law (${ids.join(', ')})`);
  check(T.UGA_CAREER_TRACKS.every((t) => t.name === ill.get(t.id).name && JSON.stringify(t.detect) === JSON.stringify(ill.get(t.id).detect) && JSON.stringify(t.unless ?? null) === JSON.stringify(ill.get(t.id).unless ?? null)), 'each is named and heard exactly as its Illinois track');
  const rowsAll = T.UGA_CAREER_TRACKS.flatMap((t) => t.courses.map((r) => ({ t, r })));
  check(rowsAll.length === 161, `${rowsAll.length} rows, the staged list's 161 (keep-planner/uga-staging/premed/track.json)`);
  const named = [...new Set(T.UGA_CAREER_TRACKS.flatMap((t) => [...t.courses.flatMap((r) => [...r.codes, ...(r.variants ?? [])]), ...(t.exam?.content ?? [])]))];
  const missing = named.filter((c) => !uga.byCode.has(c));
  check(missing.length === 0, `every one of the ${named.length} codes is in public/uga-catalog.json`, missing.join(', '));
  check(!named.includes('PMCY 3000') && !uga.byCode.has('PMCY 3000'), 'PMCY 3000 is in no row and not in the UGA catalog');
  for (const id of ['pre-medicine', 'pre-veterinary']) {
    const t = T.UGA_CAREER_TRACKS.find((x) => x.id === id);
    check(/PMCY 3000 Human Physiology, which is not in the planner's UGA course list, so the plan names it here and never books it/.test(t.note), `${id}: its note names PMCY 3000 and says it is never booked`);
  }
  check(T.UGA_CAREER_TRACKS.every((t) => t.source.url.startsWith('https://ppao.uga.edu/') || t.source.url.startsWith('https://rx.uga.edu/')), 'every source is UGA\'s own (ppao.uga.edu, or rx.uga.edu for pre-pharmacy)');

  // -- lab pairs: four digits and an L
  const ugaLabs = T.labPartners(T.UGA_CAREER_TRACKS);
  const wantLabs = { 'BIOL 1107L': 'BIOL 1107', 'BIOL 1108L': 'BIOL 1108', 'CHEM 1211L': 'CHEM 1211', 'CHEM 1212L': 'CHEM 1212', 'CHEM 2211L': 'CHEM 2211', 'CHEM 2212L': 'CHEM 2212' };
  check(JSON.stringify(Object.fromEntries([...ugaLabs].sort())) === JSON.stringify(Object.fromEntries(Object.entries(wantLabs).sort())), 'labPartners reads UGA\'s labs (BIOL 1107L with BIOL 1107 ...)', JSON.stringify([...ugaLabs]));
  const illLabs = T.labPartners();
  check(illLabs.size === 8 && [...illLabs.keys()].every((k) => /^[A-Z]+ \d{3}$/.test(k)), `the default is still Illinois's ${illLabs.size} pairs alone`);

  // -- the reading
  const med = T.interestProfile('I want to go to medical school');
  check(T.forSchool(med, 'illinois') === med && T.forSchool(med, undefined) === med, 'Illinois (or no school): the profile untouched');
  const ugaMed = T.forSchool(med, 'uga');
  check(ugaMed.tracks.length === 1 && ugaMed.tracks[0] === T.UGA_CAREER_TRACKS.find((t) => t.id === 'pre-medicine') && ugaMed.courses.includes('CHEM 1211') && !ugaMed.courses.includes('CHEM 102'), 'UGA: "medical school" is UGA\'s pre-med list, with UGA codes');
  for (const words of ['', 'software engineer', 'law school', 'investment banking and data science']) {
    const p = T.interestProfile(words);
    const u = T.forSchool(p, 'uga');
    check(u.tracks.length === 0 && JSON.stringify(u.words) === JSON.stringify(p.words) && JSON.stringify(u.courses) === JSON.stringify(p.courses) && JSON.stringify(u.topics) === JSON.stringify(p.topics), `UGA "${words}": no track, and the topics, words and courses exactly as before`);
  }
  check(T.ugaTrackCodes(T.interestProfile('law school')).length === 0 && T.ugaTrackCodes(med).includes('CHEM 1211L'), 'ugaTrackCodes: none for pre-law, CHEM 1211L for pre-med');

  // -- hours: the catalog's 3 is a placeholder; a track course gets the program tables' hours while the goal is named
  const hours = U.ugaRowHours(uga);
  const noHours = named.filter((c) => !hours.has(c));
  check(JSON.stringify(noHours) === JSON.stringify(['CHEM 1312H', 'PMCY 4050']), 'every track code has hours in UGA\'s program tables but CHEM 1312H (an honors variant, never booked) and PMCY 4050', noHours.join(', '));
  check(/UGA's program pages print no hours for PMCY 4050, so the board counts the catalog's 3 for it/.test(T.UGA_CAREER_TRACKS.find((t) => t.id === 'pre-pharmacy').note), 'the pre-pharmacy note says PMCY 4050 counts the catalog\'s 3');
  const cr = (code) => uga.byCode.get(code).credits;
  const before = ['CHEM 1211L', 'PHYS 1111', 'CBIO 2200', 'GENE 3200'].map(cr);
  const unknown = U.setUgaTrackHours(uga, T.ugaTrackCodes(med));
  check(cr('CHEM 1211L') === 1 && cr('PHYS 1111') === 4 && cr('CBIO 2200') === 4 && cr('GENE 3200') === 4 && uga.context.creditRanges.get('CHEM 1211L').min === 1 && unknown.length === 0, `pre-med: CHEM 1211L ${cr('CHEM 1211L')}, PHYS 1111 ${cr('PHYS 1111')}, CBIO 2200 ${cr('CBIO 2200')}, GENE 3200 ${cr('GENE 3200')} hours (catalog: ${before.join(', ')})`);
  U.setUgaTrackHours(uga, []);
  check(JSON.stringify(['CHEM 1211L', 'PHYS 1111', 'CBIO 2200', 'GENE 3200'].map(cr)) === JSON.stringify(before) && uga.context.creditRanges.get('CHEM 1211L').min === before[0], 'no goal: the catalog\'s hours are back');

  // -- boards
  const programOf = (name) => uga.programs.find((p) => p.name === name);
  const H = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
  const NONE = { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 };
  const ugaBoard = (name, career, extra = {}) => {
    const program = programOf(name);
    const loaded = U.loadUgaProgram(uga, program, { emphasisSelections: Object.fromEntries(U.ugaSelectionRequirements(program).map((r) => [r.id, r.options.slice(0, r.minimum).map((o) => o.id)])) });
    U.setUgaTrackHours(uga, T.ugaTrackCodes(T.interestProfile(career)));
    const ctx = { ...uga.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(uga.guidance, [program.id])) };
    const g = generatePlan({
      requirements: loaded.blocks, context: ctx, programName: loaded.program.name, programId: program.id, programCollege: program.college,
      prior: NONE, horizon: H, degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: PRIORITY_PRESETS.balanced }, interests: career, career, ...extra,
    });
    const codesOf = (t) => t.courseIds.map((id) => uga.courses.find((c) => c.id === id)?.code);
    const terms = g.plan.terms.map(codesOf);
    const at = (code) => terms.findIndex((t) => t.includes(code));
    return { g, terms, at, ctx, shape: JSON.stringify([terms, g.notes, g.notPlaced.map((x) => x.code)]) };
  };
  const plain1 = ugaBoard('Psychology BS', '');
  const premed = ugaBoard('Psychology BS', 'I want to go to medical school');
  const plain2 = ugaBoard('Psychology BS', '');
  check(plain1.shape === plain2.shape, 'Psychology BS with no goal: the same board before and after a pre-med board (the hours go back)');
  check(!plain1.g.electives.some((e) => e.track) && !plain1.g.notes.some((n) => n.startsWith('Pre-medicine')), 'no goal: no track course and no track note');
  const note = premed.g.notes.find((n) => n.startsWith('Pre-medicine (MD/DO):')) ?? '';
  const booked = premed.g.electives.filter((e) => e.track === 'Pre-medicine (MD/DO)').map((e) => e.code);
  check(booked.length >= 8 && note.includes('https://ppao.uga.edu/programs/pre-medical/building-credentials-for-medical-school/'), `Psychology BS, pre-med: ${booked.length} track courses booked, the note cites PPAO`, `${booked.join(', ')}\n          ${note.slice(0, 300)}`);
  const placedOrSaid = (codes) => codes.some((c) => premed.at(c) >= 0) || codes.some((c) => note.includes(c));
  const requiredRows = T.UGA_CAREER_TRACKS.find((t) => t.id === 'pre-medicine').courses.filter((r) => r.need === 'required');
  const unsaid = requiredRows.filter((r) => !placedOrSaid(r.codes)).map((r) => r.codes.join('/'));
  check(unsaid.length === 0, `every required row (${requiredRows.length}) is on the board or named in the note`, unsaid.join(', '));
  const apart = Object.entries(wantLabs).filter(([labCode, lecture]) => premed.at(labCode) >= 0 && premed.at(lecture) >= 0 && premed.at(labCode) !== premed.at(lecture));
  const placedPairs = Object.entries(wantLabs).filter(([labCode, lecture]) => premed.at(labCode) >= 0 && premed.at(lecture) >= 0).length;
  check(apart.length === 0 && placedPairs >= 3, `each of the ${placedPairs} lab pairs on the board is in its lecture's term`, apart.map(([a, b]) => `${a} ${premed.at(a)} / ${b} ${premed.at(b)}`).join('; '));
  check(premed.at('PMCY 3000') < 0 && note.includes('PMCY 3000'), 'PMCY 3000: named in the note, not on the board');
  const labTerm = premed.at('CHEM 1211L');
  check(labTerm >= 0 && planCreditRange(['CHEM 1211L'], premed.ctx).min === 1, `CHEM 1211L counts its 1 hour on the pre-med board (term ${labTerm})`);
  // The degree beats pre-med: a board whose track picks would cost the degree a requirement is the degree's board,
  // and the note sends every course of the list to a summer or an extra term (autoplan.ts ugaDegreeFirst).
  {
    const SPRING = { startSeason: 'Spring', startYear: 2027, gradSeason: 'Fall', gradYear: 2030, stated: true };
    const art = ugaBoard('Art: Interdisciplinary Art AB', 'I want to go to medical school', { horizon: SPRING });
    const artPlain = ugaBoard('Art: Interdisciplinary Art AB', '', { horizon: SPRING });
    const unmet = (b) => b.g.unsatisfied.map((u) => u.requirementId).sort().join();
    const n = art.g.notes.find((x) => x.startsWith('Pre-medicine (MD/DO):')) ?? '';
    check(unmet(art) === unmet(artPlain) && art.g.notPlaced.length === artPlain.g.notPlaced.length && !art.g.electives.some((e) => e.track), `Interdisciplinary Art AB, Spring 2027, pre-med: the degree's requirements as with no goal (${art.g.unsatisfied.length} open), no track course booked`);
    check(/the degree's own courses come first\. Booking the courses from .* beside them would have left one of this degree's requirements or courses off the board/.test(n) && /CHEM 1211, CHEM 1211L, .* need a summer session or an extra term/.test(n), 'its note says why, and names the courses that need a summer or an extra term', n.slice(0, 400));
  }
  U.setUgaTrackHours(uga, []);
  const grad = uga.programs.find((p) => U.isUgaGraduateDegree(p) && /Artificial Intelligence/.test(p.name) && p.degree === 'MS');
  if (grad) {
    const loaded = U.loadUgaProgram(uga, grad, {});
    const g = generatePlan({
      requirements: loaded.blocks, context: uga.context, programName: loaded.program.name, programId: grad.id, prior: NONE,
      horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2028, stated: true }, degreeTotal: grad.totalCredits,
      electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 9, target: 9, max: 18 }, priorities: PRIORITY_PRESETS.balanced }, interests: 'medical school', career: 'medical school',
      standingHours: { freshman: 0, sophomore: 0, junior: 0, senior: 0 }, electiveLevelRange: { min: 600, maxExclusive: 1000 }, autoPrerequisiteLevelRange: { min: 600, maxExclusive: 1000 },
    });
    check(!g.electives.some((e) => e.track) && !g.notes.some((n) => n.startsWith('Pre-medicine')), 'a graduate UGA plan books no track for "medical school"');
  }
  // An honors version the student holds meets its row: CHEM 1311H and CHEM 1311L for CHEM 1211 and its lab.
  {
    const program = programOf('Psychology BS');
    const loaded = U.loadUgaProgram(uga, program, {});
    U.setUgaTrackHours(uga, T.ugaTrackCodes(med));
    const g = generatePlan({
      requirements: loaded.blocks, context: uga.context, programName: loaded.program.name, programId: program.id, programCollege: program.college,
      prior: { ...NONE, courseCodes: ['CHEM 1311H', 'CHEM 1311L'] }, horizon: H, degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
      preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 }, priorities: PRIORITY_PRESETS.balanced }, interests: 'medical school', career: 'medical school',
    });
    const codes = g.plan.terms.flatMap((t) => t.courseIds).map((id) => uga.courses.find((c) => c.id === id)?.code);
    const forTrack = g.electives.filter((e) => e.track).map((e) => e.code);
    const n = g.notes.find((x) => x.startsWith('Pre-medicine (MD/DO):')) ?? '';
    // (Psychology BS's own science row may still pick CHEM 1211: the degree's reading, not the track's.)
    check(!forTrack.includes('CHEM 1211') && !codes.includes('CHEM 1211L') && /you already hold CHEM 1311H, CHEM 1311L/.test(n), 'held honors chemistry (CHEM 1311H, 1311L) meets the CHEM 1211 rows: the track books neither again', `${forTrack.join(', ')}\n          ${n.slice(0, 300)}`);
    U.setUgaTrackHours(uga, []);
  }
}

console.log(failed ? `\n*** ${failed} check(s) failed ***` : '\nall career-track checks passed');
if (failed) process.exitCode = 1;
