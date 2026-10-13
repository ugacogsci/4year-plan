/**
 * Summers and terms away, on real degrees: Psychology BSLAS, Kinesiology
 * (Applied Exercise Science), Computer Science and Finance, built from the
 * shipped artifacts the way the browser builds them.
 *
 * Every case here was wrong on 2026-09-24:
 *   - "Four years including summers" planned every fall and spring to Spring
 *     2029 at 18 and left Fall 2029 and Spring 2030 empty: the aim counted a
 *     six-credit summer as a full term. Summers now lighten the falls and
 *     springs and never end the plan early by themselves.
 *   - A Summer 2029 finish stopped at 114 of 120 with the summer at six and a
 *     note blaming eligibility; the summer had three more to give.
 *   - A summer could hold two hardest-band courses.
 *   - Year labels counted summer terms, and the "more than eight terms" note
 *     counted them too.
 *   - A summer at six credits was "under the 12 you set".
 *   - A semester abroad earned nothing, so every other term went to 18.
 *   - A term away left an unstated four-year end where it was, so a gap year
 *     turned into six terms of 18 and a shortfall against a date the student
 *     never gave.
 *   - A credit-shortened plan counted the term away as a campus term and told
 *     the student "6 terms" over a board of five.
 *   - "Summer classes in summer 2027" booked every summer.
 *
 *   node lib/planner/__horizon.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));
const { generatePlan, validatePlan, extendForAway } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));

/**
 * readHorizon lives in a .tsx file next to React, which Node cannot load.
 * Its section of the file needs nothing but its own regexes, so that section
 * is cut out and loaded on its own, the text exactly as the browser runs it.
 */
const source = readFileSync(join(ROOT, 'components/planner/illinois-source.tsx'), 'utf8');
const from = source.indexOf("/**\n * A term in a student's own words");
const to = source.indexOf('// ---------------------------------------------------------------------------\n// Course detail');
if (from < 0 || to < 0) throw new Error('readHorizon section markers moved in illinois-source.tsx');
const cut = join(mkdtempSync(join(tmpdir(), 'horizon-check-')), 'horizon.ts');
writeFileSync(cut, "type SemesterSeason = 'Fall' | 'Spring' | 'Summer';\ntype AwayKind = 'study_abroad' | 'co_op' | 'internship' | 'gap';\n" + source.slice(from, to));
const { readHorizon, firstOpenTerm, calendarTerm } = await import(pathToFileURL(cut).href);

const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = existsSync(join(PUBLIC, 'illinois', 'offerings.json')) ? read('illinois/offerings.json') : null;
if (offeringsFile) applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom) { const g = gradeRaw.get(norm(c.gradeFrom)); if (g) gradeRaw.set(norm(c.code), g); }
const grades = new Map(); for (const [code, g] of gradeRaw) grades.set(code, toGradeRow(g, byCode.get(code)?.title ?? code, []));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const languagesFile = existsSync(join(PUBLIC, 'illinois', 'languages.json')) ? read('illinois/languages.json') : null;
const context = {
  courses: rows, prereqs: new Map(Object.entries(read('illinois/prereqs.json'))), grades, sections: new Map(), equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))), creditRanges, bands: meta.bands,
  offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(),
  offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile?.terms,
  languages: languagesFile ?? undefined, snapshotTerm: null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const hardCut = meta.bands?.hardest ?? 65;
const isHard = (code) => (grades.get(norm(code))?.difficulty ?? -1) >= hardCut;
const summaries = read('illinois/programs.json');
const blockCache = new Map();
function load(id) {
  if (blockCache.has(id)) return blockCache.get(id);
  const s = summaries.find((p) => p.id === id);
  const raw = read(`illinois/program/${id}.json`);
  const out = { s, blocks: adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [raw] }, new Map(byCode)).blocks.get(id) ?? [] };
  blockCache.set(id, out);
  return out;
}

const PSYC = 'las/psychology-bslas';
const KIN = 'ahs/kinesiology-bs/applied-exercise-science';
const CS = 'engineering/computer-science-bs';
const FIN = 'bus/finance-bs';
const WORDS = { [PSYC]: 'Psychology.', [KIN]: 'Kinesiology.', [CS]: 'Computer science.', [FIN]: 'Finance.' };
const H = (extra = {}) => ({ startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, ...extra });
const FRESH = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish' };

/** A plan the way the workspace asks for one: balanced by default, the published total or 120. */
function plan(programId, horizon, { prior = FRESH, credits = { min: 12, target: null, max: 18 } } = {}) {
  const { s, blocks } = load(programId);
  const r = generatePlan({ requirements: blocks, context, prior, horizon, preferences: { creditsPerTerm: credits }, programId, degreeTotal: s.totalCredits || 120, interests: WORDS[programId] ?? '', programName: s.name, programCollege: s.college });
  r.program = s;
  return r;
}
const regular = (r) => r.terms.filter((t) => t.season !== 'Summer');
const summerTerms = (r) => r.terms.filter((t) => t.season === 'Summer');
const line = (r) => r.terms.map((t) => `${t.label.replace(/ 20/, "'")}:${t.credits.min}`).join(' ');
const yearOf = (r, label) => r.plan.terms.find((t) => t.label === label)?.year;

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

/** Rule errors a plan must never carry, whatever its shape. */
function noRuleErrors(name, r, away) {
  const issues = validatePlan(r.plan, context, { minimumTermCredits: 12, maxTermCredits: 18, priorCredits: r.credits.prior, away });
  const bad = issues.filter((i) => i.id.startsWith('ap-standing-') || (i.severity === 'error' && i.id.startsWith('ap-prereq-')));
  check(`${name}: no prerequisite or standing errors`, bad.length === 0, bad.slice(0, 3).map((i) => i.message).join(' | '));
  return issues;
}

// --- 1. summers lighten the falls and springs --------------------------------
section('1. Four years including summers keeps every fall and spring light and ends Spring 2030');
for (const id of [PSYC, KIN, CS, FIN]) {
  for (const { tag, horizon } of [
    { tag: 'stated, summers 2027-28', horizon: H({ stated: true, summers: [2027, 2028] }) },
    { tag: 'unstated, summers 2027-28 (set_plan_shape with no finish)', horizon: H({ stated: false, summers: [2027, 2028] }) },
    { tag: 'stated, summers 2027-29 ("so my semesters are lighter")', horizon: H({ stated: true, summers: [2027, 2028, 2029] }) },
  ]) {
    const r = plan(id, horizon);
    const name = `${r.program.name} ${tag}`;
    console.log(`  ${name}: ${line(r)}`);
    check(`${name}: ends Spring 2030`, r.terms[r.terms.length - 1]?.label === 'Spring 2030', line(r));
    check(`${name}: eight falls and springs`, regular(r).length === 8, line(r));
    const heaviest = Math.max(...regular(r).map((t) => t.credits.min));
    check(`${name}: no fall or spring above 15`, heaviest <= 15, line(r));
    check(`${name}: reaches the total`, r.credits.total.min >= (r.program.totalCredits || 120), `${r.credits.total.min}`);
    check(`${name}: never "before the ... you asked for"`, !r.notes.some((n) => /before the .* you asked for/.test(n)), r.notes.find((n) => /you asked for/.test(n)) ?? '');
    const aim = r.notes.find((n) => n.startsWith('Terms aim for about')) ?? '';
    check(`${name}: the aim note counts falls and springs`, /over 8 fall and spring terms and \d summers/.test(aim), aim);
    const said = Number(aim.match(/about (\d+) credits/)?.[1]);
    // Electives come in threes, not one-credit fillers, so under an aim of
    // 13 a term of electives at 12 can take a fifth to 15; then the note has
    // to say so.
    const named = heaviest === said + 2 && aim.includes(`so some terms land at ${heaviest}`);
    check(`${name}: the aim note matches the board`, said >= heaviest - 1 || named, `aim ${said}, heaviest ${heaviest}`);
    // 3. At most one hardest-band course a summer, and the ones that are there are named.
    for (const t of summerTerms(r)) {
      const hard = t.codes.filter(isHard);
      check(`${name}: ${t.label} holds at most one hardest-band course`, hard.length <= 1, hard.join(', '));
      for (const code of hard) {
        const elective = r.electives.some((e) => norm(e.code) === norm(code));
        if (!elective) check(`${name}: a note names ${code} in ${t.label}`, r.notes.some((n) => n.startsWith(`${code} (`) && n.includes(`is in the hardest band at this school and planned in ${t.label}`)));
      }
    }
    // 4. Year labels from the calendar; summers never make a fifth year.
    check(`${name}: Summer 2027 is year 1`, yearOf(r, 'Summer 2027') === 1);
    check(`${name}: Fall 2028 and Spring 2029 are year 3`, yearOf(r, 'Fall 2028') === 3 && yearOf(r, 'Spring 2029') === 3, `${yearOf(r, 'Fall 2028')}, ${yearOf(r, 'Spring 2029')}`);
    check(`${name}: Spring 2030 is year 4`, yearOf(r, 'Spring 2030') === 4);
    check(`${name}: no "past the fourth year" note`, !r.notes.some((n) => /labels everything past/.test(n)));
    // 5. A summer is never under the fall and spring minimum.
    const issues = noRuleErrors(name, r);
    check(`${name}: no summer flagged under the minimum`, !issues.some((i) => i.id.startsWith('ap-minimum-') && /Summer/.test(i.message)));
  }
}

// --- 2. capacity counts a summer at its own ceiling ------------------------------
section('2. A short plan with a fixed end lets its summers rise to 9 and blames capacity');
{
  const r = plan(KIN, H({ stated: true, gradSeason: 'Summer', gradYear: 2029, summers: [2029] }));
  console.log(`  Kinesiology to Summer 2029: ${line(r)}`);
  const last = r.terms[r.terms.length - 1];
  check('Kinesiology to Summer 2029: the summer rose to 9', last?.label === 'Summer 2029' && last.credits.min === 9, line(r));
  const note = r.notes.find((n) => n.startsWith('Finishing by Summer 2029')) ?? '';
  check('Kinesiology to Summer 2029: the note blames capacity, with the summer at 9', /1 summer at 9 hold at most 117/.test(note), note || r.notes.filter((n) => /reaches/.test(n)).join(' | '));
  check('Kinesiology to Summer 2029: no "Nothing else eligible" note', !r.notes.some((n) => /Nothing else eligible/.test(n)));
}
{
  const r = plan(CS, H({ stated: true, summers: [2027, 2028, 2029] }), { credits: { min: 12, target: 12, max: 12 } });
  console.log(`  Computer Science at 12 with three summers: ${line(r)}`);
  check('CS at 12 a term: every summer rose to 9', summerTerms(r).every((t) => t.credits.min === 9), line(r));
  const note = r.notes.find((n) => n.startsWith('Finishing by Spring 2030')) ?? '';
  check('CS at 12 a term: the note counts 8 terms at 12 and 3 summers at 9', /8 fall and spring terms at 12 and 3 summers at 9 hold at most 123/.test(note), note);
  for (const t of summerTerms(r)) check(`CS at 12 a term: ${t.label} holds at most one hardest-band course`, t.codes.filter(isHard).length <= 1, t.codes.filter(isHard).join(', '));
  noRuleErrors('CS at 12 a term', r);
}

// --- 3 and 5. the validator's own summer rules --------------------------------------
section('3, 5. The validator: a summer holds one hard course, a summer and a term away are never "under your target"');
{
  const r = plan(PSYC, H({ stated: true, summers: [2027] }));
  const summer = r.plan.terms.find((t) => t.season === 'Summer');
  const idOf = (code) => rows.find((c) => norm(c.code) === code)?.id;
  const stacked = { ...r.plan, terms: r.plan.terms.map((t) => (t === summer ? { ...t, courseIds: [idOf('MCB 250'), idOf('CHEM 232')] } : t)) };
  const issues = validatePlan(stacked, context, { minimumTermCredits: 12 });
  check('a summer with MCB 250 and CHEM 232 is flagged', issues.some((i) => i.id === `ap-hard-${summer.id}`), issues.filter((i) => i.termId === summer.id).map((i) => i.id).join(', '));
  const spring = r.plan.terms.find((t) => t.label === 'Spring 2029');
  const emptied = { ...r.plan, terms: r.plan.terms.map((t) => (t === spring ? { ...t, courseIds: [] } : t)) };
  check('an emptied Spring 2029 on campus is flagged', validatePlan(emptied, context, { minimumTermCredits: 12 }).some((i) => i.id === `ap-minimum-${spring.id}`));
  check('an emptied Spring 2029 that is away is not', !validatePlan(emptied, context, { minimumTermCredits: 12, away: [{ season: 'Spring', year: 2029, credits: 15 }] }).some((i) => i.id === `ap-minimum-${spring.id}`));
}

// --- 6. a semester abroad earns its hours --------------------------------------------
section('6. Study abroad counts approved hours; a plain term away earns none');
{
  const r = plan(PSYC, H({ stated: false, away: [{ season: 'Spring', year: 2029, kind: 'study_abroad' }] }));
  console.log(`  Psychology abroad Spring 2029: ${line(r)} total ${r.credits.total.min}`);
  check('abroad Spring 2029: still ends Spring 2030', r.terms[r.terms.length - 1]?.label === 'Spring 2030', line(r));
  check('abroad Spring 2029: seven falls and springs on campus', regular(r).length === 7, line(r));
  check('abroad Spring 2029: no term on the board for it', !r.terms.some((t) => t.label === 'Spring 2029'));
  check('abroad Spring 2029: its 15 hours are in the total', r.credits.away === 15 && r.credits.total.min >= 120 && r.credits.total.min <= 123, `away ${r.credits.away}, total ${r.credits.total.min}`);
  check('abroad Spring 2029: no fall or spring above 16', Math.max(...regular(r).map((t) => t.credits.min)) <= 16, line(r));
  check('abroad Spring 2029: GeneratedPlan.away names it', r.away?.length === 1 && r.away[0].label === 'Spring 2029' && r.away[0].credits === 15);
  const note = r.notes.find((n) => n.startsWith('Spring 2029: study abroad')) ?? '';
  check('abroad Spring 2029: a note names the term and what it earns', /about 15 hours count toward the 120/.test(note) && /never a required course/.test(note), note);
  check('abroad Spring 2029: no LAS residency flag for one spring abroad', !r.notes.some((n) => /30 of your last 60/.test(n)));
  noRuleErrors('abroad Spring 2029', r, r.away);
}
{
  const r = plan(PSYC, H({ stated: false, away: [{ season: 'Spring', year: 2029 }] }));
  console.log(`  Psychology, a plain term away Spring 2029: ${line(r)}`);
  check('plain away: earns nothing', !r.credits.away && r.away?.[0]?.credits === 0);
  check('plain away: the note says it earns nothing', r.notes.some((n) => n.startsWith('Spring 2029: time away. Nothing is booked that term and it earns no hours')));
}
{
  const r = plan(PSYC, H({ stated: true, away: [{ season: 'Fall', year: 2029, kind: 'study_abroad', credits: 18 }, { season: 'Spring', year: 2030, kind: 'study_abroad', credits: 18 }] }));
  console.log(`  Psychology, a senior year abroad at 18 a term: ${line(r)}`);
  const flag = r.notes.find((n) => /30 of your last 60/.test(n)) ?? '';
  check('senior year abroad: LAS 30-of-the-last-60 flag', /in this plan 24 of the last 60 are/.test(flag), flag || r.notes.join(' | ').slice(0, 300));
}
{
  const r = plan(PSYC, H({ stated: true, away: [{ season: 'Spring', year: 2029, kind: 'study_abroad', credits: 24 }] }));
  check('abroad hours are capped at the LAS 18', r.away?.[0]?.credits === 18 && r.notes.some((n) => /counted at 18, the most LAS allows/.test(n)));
}

// --- 7. time away moves an end nobody dated, and costs a dated one -------------------
section('7. A term away moves an unstated end one term later, and is named against a stated one');
for (const id of [FIN, KIN]) {
  const r = plan(id, H({ stated: false, away: [{ season: 'Spring', year: 2029, kind: 'co_op' }] }));
  const name = `${r.program.name} co-op Spring 2029, no end given`;
  console.log(`  ${name}: ${line(r)}`);
  check(`${name}: eight falls and springs on campus`, regular(r).length === 8, line(r));
  check(`${name}: ends Fall 2030`, r.terms[r.terms.length - 1]?.label === 'Fall 2030', line(r));
  check(`${name}: reaches the total`, r.credits.total.min >= (r.program.totalCredits || 120));
  check(`${name}: no "Finishing by" shortfall`, !r.notes.some((n) => n.startsWith('Finishing by')));
  const moved = r.notes.find((n) => n.startsWith('With Spring 2029 (a co-op) away, this plan ends Fall 2030 rather than Spring 2030')) ?? '';
  check(`${name}: the note says the end moved and why`, /8 fall and spring terms on campus/.test(moved), moved);
  check(`${name}: Spring 2030 is year 4 and Fall 2030 saturates at 4 with a note`, yearOf(r, 'Spring 2030') === 4 && yearOf(r, 'Fall 2030') === 4 && r.notes.some((n) => /reaches a fifth year/.test(n)));
  noRuleErrors(name, r, r.away);
}
{
  const r = plan(PSYC, H({ stated: false, away: [{ season: 'Fall', year: 2028, kind: 'gap' }, { season: 'Spring', year: 2029, kind: 'gap' }] }));
  console.log(`  Psychology, a gap year 2028-29: ${line(r)}`);
  check('gap year: ends Spring 2031 with eight falls and springs', r.terms[r.terms.length - 1]?.label === 'Spring 2031' && regular(r).length === 8, line(r));
  check('gap year: Spring 2030 is year 4 on the calendar', yearOf(r, 'Spring 2030') === 4);
}
{
  const r = plan(FIN, H({ stated: true, away: [{ season: 'Spring', year: 2029, kind: 'co_op' }] }));
  console.log(`  Finance co-op Spring 2029, Spring 2030 stated: ${line(r)}`);
  check('stated end kept', r.terms[r.terms.length - 1]?.label === 'Spring 2030', line(r));
  const cost = r.notes.find((n) => n.startsWith('Time away in Spring 2029 (a co-op) costs this plan a term')) ?? '';
  check('the note says the time away costs a term and suggests summers', /7 fall and spring terms on campus remain before the Spring 2030 you asked for/.test(cost) && /Summer classes/.test(cost), cost);
}

// --- 8. a credit-shortened plan counts campus terms -----------------------------------
section('8. A plan shortened by credit steps past the term away and reports campus terms');
{
  const prior = { ...FRESH, unmatchedCredits: 41 };
  const r = plan(CS, H({ stated: false, away: [{ season: 'Spring', year: 2029, kind: 'co_op' }] }), { prior });
  console.log(`  CS with 41 hours, co-op Spring 2029: ${line(r)}`);
  const note = r.notes.find((n) => n.startsWith('Your credit leaves')) ?? '';
  const said = Number(note.match(/runs (\d+) terms? on campus/)?.[1]);
  check('the note counts the campus terms on the board', said === regular(r).length, `${note} | board ${line(r)}`);
  check('the note ends where the board ends', note.includes(`ends ${r.terms[r.terms.length - 1]?.label} `), note);
  check('the co-op is not a campus term', !r.terms.some((t) => t.label === 'Spring 2029'));
}
{
  const prior = { ...FRESH, unmatchedCredits: 60 };
  const r = plan(PSYC, H({ stated: false, away: [{ season: 'Fall', year: 2028, kind: 'study_abroad' }] }), { prior });
  console.log(`  Psychology with 60 hours, abroad Fall 2028: ${line(r)}`);
  check('a credited term abroad after the work stays in the plan', r.away?.some((a) => a.label === 'Fall 2028' && a.credits === 15), JSON.stringify(r.away));
  check('no empty fall or spring before it', r.terms.map((t) => t.label).join(',') === 'Fall 2026,Spring 2027,Fall 2027,Spring 2028', line(r));
  const note = r.notes.find((n) => /leave about \d+ hours/.test(n)) ?? '';
  check('the note counts 4 campus terms and ends with the term abroad', /runs 4 terms on campus and ends Fall 2028/.test(note), note);
}
check('extendForAway leaves a dated end alone', extendForAway(H({ stated: true, away: [{ season: 'Spring', year: 2029 }] })).gradYear === 2030);
check('extendForAway moves an undated end past a term away', (() => { const h = extendForAway(H({ stated: false, away: [{ season: 'Spring', year: 2029 }] })); return h.gradSeason === 'Fall' && h.gradYear === 2030; })());
check('extendForAway ignores a term away past the end', extendForAway(H({ stated: false, away: [{ season: 'Spring', year: 2035 }] })).gradYear === 2030);

// --- 10. what the student wrote ---------------------------------------------------------
section('10. readHorizon: summers and terms away, in the student\'s words');
const now = { season: 'Fall', year: 2026 };
const cases = [
  { words: 'I want to take summer classes in summer 2027.', want: { summers: [2027] } },
  { words: 'Freshman. Internship in summer 2028. I want to take summer classes in summer 2027.', want: { summers: [2027] } },
  { words: 'Summer classes in 2027 only.', want: { summers: [2027] } },
  { words: 'I want to take classes in summer 2027 and summer 2028.', want: { summers: [2027, 2028] } },
  { words: 'Starting fall 2026. I\'ll take summer classes, probably summer 2028.', want: { summers: [2028] } },
  { words: 'Incoming freshman fall 2026, graduating May 2030. I want to take summer classes so my semesters are lighter.', want: { summers: [2027, 2028, 2029], stated: true } },
  { words: 'Starting fall 2026, four years including summers.', want: { summers: [2027, 2028, 2029], stated: true } },
  { words: "I'm a freshman and I'm studying abroad in spring 2029.", want: { away: [['Spring', 2029, 'study_abroad']], stated: false } },
  { words: 'Starting this fall. I plan to do a co-op in spring 2029.', want: { away: [['Spring', 2029, 'co_op']] } },
  { words: 'Starting fall 2026. Taking a gap year in fall 2028.', want: { away: [['Fall', 2028, 'gap'], ['Spring', 2029, 'gap']] } },
  { words: 'Freshman. A co-op in fall 2028 and spring 2029.', want: { away: [['Fall', 2028, 'co_op'], ['Spring', 2029, 'co_op']] } },
  { words: 'Freshman, internship spring 2028.', want: { away: [['Spring', 2028, 'internship']] } },
];
for (const { words, want } of cases) {
  const h = readHorizon(words, now);
  const got = { summers: h.summers, away: h.away.map((a) => [a.season, a.year, a.kind]), stated: h.stated };
  const ok = (want.summers === undefined || JSON.stringify(got.summers) === JSON.stringify(want.summers)) &&
    (want.away === undefined || JSON.stringify(got.away) === JSON.stringify(want.away)) &&
    (want.stated === undefined || got.stated === want.stated);
  check(`"${words}"`, ok, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

section('11. The first term a plan can start, from today\'s date');
// A plan never books a term whose add deadline has passed (Fall 2026: Sept 4).
const termOf = (t) => `${t.season} ${t.year}`;
for (const [day, want] of [
  ['2026-08-01', 'Fall 2026'], ['2026-09-04', 'Fall 2026'], ['2026-09-05', 'Spring 2027'], ['2026-10-04', 'Spring 2027'],
  ['2026-12-31', 'Spring 2027'], ['2027-01-29', 'Spring 2027'], ['2027-02-15', 'Fall 2027'], ['2027-06-01', 'Fall 2027'],
]) {
  const [y, m, d] = day.split('-').map(Number);
  // Noon in Champaign (17:00 UTC), so the device's time zone does not matter.
  const got = termOf(firstOpenTerm(new Date(Date.UTC(y, m - 1, d, 17))));
  check(`on ${day} the first open term is ${want}`, got === want, `got ${got}`);
}
// The deadline is Champaign's: 8 pm on Sept 4 in Champaign is still open, wherever the device is.
check('8 pm Sept 4 in Champaign (1 am Sept 5 UTC) is still Fall 2026', termOf(firstOpenTerm(new Date(Date.UTC(2026, 8, 5, 1)))) === 'Fall 2026');
for (const [day, want] of [['2026-10-04', 'Fall 2026'], ['2027-01-10', 'Spring 2027'], ['2027-07-01', 'Summer 2027'], ['2026-08-15', 'Fall 2026']]) {
  const [y, m, d] = day.split('-').map(Number);
  check(`on ${day} the calendar is in ${want}`, termOf(calendarTerm(new Date(Date.UTC(y, m - 1, d, 17)))) === want);
}

/** readHorizon as horizonFor calls it on `day`: the first open term, the calendar's term, the record's first term. */
const on = (day, words, record = null) => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 17));
  return readHorizon(words, firstOpenTerm(t), calendarTerm(t), { firstTermOnRecord: record });
};
for (const { day = '2026-10-04', words, record = null, start, grad, began } of [
  // October: Spring 2027 is the first open term, Fall 2026 is in session.
  { words: '', start: 'Spring 2027', grad: 'Fall 2030', began: null },
  { words: 'Incoming freshman starting fall 2026, finishing in four years.', start: 'Spring 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { words: 'Incoming freshman starting fall 2026.', start: 'Spring 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { words: 'I started this fall and want to graduate in four years.', start: 'Spring 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { words: 'Freshman, four years.', start: 'Spring 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { words: "I'm a freshman.", start: 'Spring 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { words: 'Sophomore, started fall 2025, four years total.', start: 'Spring 2027', grad: 'Spring 2029', began: 'Fall 2025' },
  { words: 'I started fall 2025, two more years.', start: 'Spring 2027', grad: 'Fall 2028', began: 'Fall 2025' },
  { words: '', record: { season: 'Fall', year: 2025 }, start: 'Spring 2027', grad: 'Spring 2029', began: 'Fall 2025' },
  { words: 'Incoming freshman.', start: 'Fall 2027', grad: 'Spring 2031', began: null },
  { words: "I'm a high school senior.", start: 'Fall 2027', grad: 'Spring 2031', began: null },
  { words: 'High school senior, starting fall 2027, four years.', start: 'Fall 2027', grad: 'Spring 2031', began: null },
  { words: 'Incoming freshman, class of 2030.', start: 'Spring 2027', grad: 'Spring 2030', began: null },
  { words: 'Incoming transfer from Parkland, starting in the spring.', start: 'Spring 2027', grad: 'Fall 2030', began: null },
  { words: 'Starting college in January 2027.', start: 'Spring 2027', grad: 'Fall 2030', began: null },
  { words: 'Starting next semester.', start: 'Spring 2027', grad: 'Fall 2030', began: null },
  { words: 'Sophomore, graduating spring 2029.', start: 'Spring 2027', grad: 'Spring 2029', began: null },
  { words: 'I transferred in fall 2025 and want to finish in spring 2028.', start: 'Spring 2027', grad: 'Spring 2028', began: 'Fall 2025' },
  // A senior in their last semester keeps the date: a one-term plan.
  { words: 'Senior, graduating May 2027.', start: 'Spring 2027', grad: 'Spring 2027', began: null },
  { words: 'Class of 2027.', start: 'Spring 2027', grad: 'Spring 2027', began: null },
  { words: 'Graduating next spring.', start: 'Spring 2027', grad: 'Spring 2027', began: null },
  // February: Fall 2027 is the first open term, Spring 2027 is in session.
  { day: '2027-02-15', words: 'Freshman fall 2026, four years.', start: 'Fall 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { day: '2027-02-15', words: 'Started fall 2026, want to graduate in four years.', start: 'Fall 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { day: '2027-02-15', words: "I'm in my second semester.", start: 'Fall 2027', grad: 'Spring 2030', began: 'Fall 2026' },
  { day: '2027-03-01', words: 'Graduating December 2027.', start: 'Fall 2027', grad: 'Fall 2027', began: null },
  // January: "this fall" is the fall coming, not the one just ended.
  { day: '2027-01-10', words: 'High school senior, starting this fall.', start: 'Fall 2027', grad: 'Spring 2031', began: null },
  // August, before the deadline: as before the change.
  { day: '2026-08-15', words: 'Starting this spring, four years.', start: 'Spring 2027', grad: 'Fall 2030', began: null },
  { day: '2026-08-15', words: 'Incoming freshman starting fall 2026, finishing in four years.', start: 'Fall 2026', grad: 'Spring 2030', began: null },
  { day: '2026-08-15', words: 'Freshman.', start: 'Fall 2026', grad: 'Spring 2030', began: null },
]) {
  const h = on(day, words, record);
  const got = { start: `${h.startSeason} ${h.startYear}`, grad: `${h.gradSeason} ${h.gradYear}`, began: h.began ? termOf(h.began) : null };
  check(`on ${day}, "${words}"${record ? ' with a record from ' + termOf(record) : ''} starts ${start}, ends ${grad}`, got.start === start && got.grad === grad && got.began === began, `got ${JSON.stringify(got)}`);
}

// --- 12. the start-term set ------------------------------------------------------------
// Real answers to "When do you want to finish, and where are you now?", read on the
// dates students write and rebuild them. Fixed first, then the reader was changed to
// pass all of it: patching one wording at a time traded one answer for another.
// Each row: [day, words, plan's first term, last term, term begun, extra]. `written` is
// when the words were saved (timelineAt), `passed` a graduation of this school that is
// under way or past, `incoming` that the plan moved to the next fall.
section('12. The start-term set: real answers on the days they are read');
const atNoon = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 17)); };
const readOn = (day, words, { record = null, written = day, enrolled = false } = {}) =>
  readHorizon(words, firstOpenTerm(atNoon(day)), calendarTerm(atNoon(written)), { firstTermOnRecord: record, enrolled, openWhenWritten: firstOpenTerm(atNoon(written)) });
const AUG = '2026-08-15', SEP = '2026-09-03', OCT = '2026-10-04', DEC = '2026-12-20', JAN = '2027-01-15', FEB = '2027-02-15', JUL = '2027-07-01';
const F25 = { season: 'Fall', year: 2025 }, F26 = { season: 'Fall', year: 2026 }, S27 = { season: 'Spring', year: 2027 };
const SET = [
  // Freshmen now, in the ways they say it.
  [OCT, "I'm a freshman.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'I’m a freshman.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Freshman year, want to graduate in 4 years.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm in my freshman year.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'I am a current freshman.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'As a freshman I want to finish in 4 years.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'I want to graduate in 4 years. Freshman right now.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm a freshman with AP credit from high school.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Freshman, admitted to Gies, want to finish in 4 years.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm a freshman and want to study abroad junior year.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm a freshman and I want to go to med school in the future.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Freshman. I have incoming AP credit for calc.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm a freshman with incoming AP credit.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm in my first semester.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Freshman, planning a gap year in fall 2028.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [DEC, 'First-year student, want to finish on time.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [JAN, "I'm a freshman.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [JAN, "I'm in my second semester.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [FEB, "I'm a second-semester freshman.", 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  [FEB, 'I’m a freshman.', 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  [FEB, 'Freshman year, want to graduate in 4 years.', 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  [FEB, 'Second semester freshman, want to finish in four years.', 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  [FEB, 'Started fall 2026.', 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  [AUG, "I'm a freshman.", 'Fall 2026', 'Spring 2030', null],
  [SEP, 'Freshman, four years.', 'Fall 2026', 'Spring 2030', null],
  // Not in college yet: the next fall, once this fall has closed.
  [OCT, 'Incoming freshman.', 'Fall 2027', 'Spring 2031', null, { incoming: true }],
  [OCT, "I'll be a freshman.", 'Fall 2027', 'Spring 2031', null, { incoming: true }],
  [OCT, "I'm going to be a freshman in the fall.", 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Rising freshman.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Future freshman, want to finish in 4 years.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'HS senior.', 'Fall 2027', 'Spring 2031', null],
  [OCT, "I'm a senior in HS, applying to UIUC.", 'Fall 2027', 'Spring 2031', null],
  [OCT, "I'm a high-school senior.", 'Fall 2027', 'Spring 2031', null],
  [OCT, "I'm in 12th grade.", 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Prospective freshman, want to graduate in four years.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Admitted freshman for fall 2027.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Incoming freshman with AP credit.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Incoming freshman, graduating in spring 2031.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Incoming freshman, hoping to complete in spring 2031.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Incoming freshman, want to compete in spring track.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Incoming freshman, want to do a co-op in spring 2029.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Incoming freshman, class of 2030.', 'Spring 2027', 'Spring 2030', null],
  [OCT, 'Taking a gap year, starting fall 2027.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Gap year after high school this year, starting college next fall.', 'Fall 2027', 'Spring 2031', null],
  [DEC, 'Incoming freshman, early action admit.', 'Fall 2027', 'Spring 2031', null],
  [JAN, 'High school senior.', 'Fall 2027', 'Spring 2031', null],
  [JAN, 'Incoming freshman.', 'Fall 2027', 'Spring 2031', null, { incoming: true }],
  [FEB, 'Prospective freshman, want to graduate in four years.', 'Fall 2027', 'Spring 2031', null, { incoming: false }],
  [FEB, "I'll be a freshman.", 'Fall 2027', 'Spring 2031', null],
  [AUG, 'Incoming freshman.', 'Fall 2026', 'Spring 2030', null, { incoming: false }],
  [SEP, 'Incoming freshman, starting this fall.', 'Fall 2026', 'Spring 2030', null],
  [AUG, "I'm a high school senior.", 'Fall 2027', 'Spring 2031', null],
  [JUL, 'Incoming freshman.', 'Fall 2027', 'Spring 2031', null, { incoming: false }],
  [JUL, "I'm a freshman.", 'Fall 2027', 'Spring 2031', null],
  [JUL, 'Starting this fall.', 'Fall 2027', 'Spring 2031', null],
  // Written earlier and read now: "incoming" meant the fall after the day it was written.
  [OCT, 'Incoming freshman.', 'Spring 2027', 'Spring 2030', 'Fall 2026', { written: '2026-07-15', incoming: false }],
  [OCT, 'Incoming freshman, four years.', 'Spring 2027', 'Spring 2030', 'Fall 2026', { written: '2026-07-15' }],
  [OCT, 'Incoming transfer from Parkland.', 'Spring 2027', 'Spring 2030', 'Fall 2026', { written: '2026-07-15' }],
  [JAN, "I'll be a freshman this fall.", 'Spring 2027', 'Spring 2030', 'Fall 2026', { written: '2026-07-15' }],
  [FEB, 'Incoming freshman, starting this fall, four years.', 'Fall 2027', 'Spring 2030', 'Fall 2026', { written: '2026-07-15' }],
  [FEB, 'Freshman.', 'Fall 2027', 'Spring 2030', 'Fall 2026', { written: '2026-08-20' }],
  [OCT, "I'm a high school senior.", 'Fall 2027', 'Spring 2031', null, { written: AUG }],
  // Transfers.
  [OCT, 'Incoming transfer from Parkland.', 'Fall 2027', 'Spring 2031', null, { incoming: true }],
  [OCT, 'Transferring in fall 2027 from COD.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Finishing at Parkland in May 2027, then transferring in fall 2027.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'I graduate from Parkland in spring 2027 and transfer to UIUC fall 2027.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Done at Harper College May 2027, starting at Illinois fall 2027.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Transferring fall 2027 after I finish at COD in May 2027.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Graduated from Parkland in May 2026, transferred here fall 2026.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Finished at Harper in spring 2026, junior now.', 'Spring 2027', 'Fall 2030', null],
  [OCT, "I'm a sophomore with incoming transfer credit from Parkland.", 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Junior. Still waiting on incoming transfer credits.', 'Spring 2027', 'Fall 2030', null],
  [OCT, "I'm a current student; incoming transfer coursework from Parkland still being evaluated.", 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Incoming transfer from Parkland, graduating May 2029.', 'Fall 2027', 'Spring 2029', null],
  [OCT, 'Transfer student, started here fall 2025, want to finish spring 2027.', 'Spring 2027', 'Spring 2027', 'Fall 2025'],
  [SEP, 'Incoming transfer.', 'Fall 2026', 'Spring 2030', null],
  [AUG, 'Transferring in this fall from Parkland.', 'Fall 2026', 'Spring 2030', null],
  // Spring and January starts.
  [OCT, 'Incoming transfer for the spring semester.', 'Spring 2027', 'Fall 2030', null, { incoming: false }],
  [OCT, 'Incoming transfer, admitted for spring.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Incoming transfer (spring admit).', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Incoming freshman in January.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Incoming freshman for spring.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Incoming first-year, January start.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Incoming freshman, spring semester start.', 'Spring 2027', 'Fall 2030', null],
  [DEC, 'Starting in January.', 'Spring 2027', 'Fall 2030', null],
  [DEC, 'Incoming freshman starting in January.', 'Spring 2027', 'Fall 2030', null],
  [JAN, 'Incoming freshman, starting this semester.', 'Spring 2027', 'Fall 2030', null],
  [JAN, 'Incoming spring admit.', 'Spring 2027', 'Fall 2030', null],
  [FEB, 'Starting spring 2028.', 'Spring 2028', 'Fall 2031', null],
  // Sophomores, juniors, seniors.
  [OCT, 'Sophomore.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Sophomore. I took my freshman seminar last year.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Sophomore, started fall 2025.', 'Spring 2027', 'Spring 2029', 'Fall 2025'],
  [OCT, 'Junior, two more years.', 'Spring 2027', 'Fall 2028', null],
  [OCT, 'Senior, graduating May 2027.', 'Spring 2027', 'Spring 2027', null],
  [OCT, 'Senior, graduating December 2026.', 'Spring 2027', 'Spring 2027', null, { passed: 'Fall 2026' }],
  [SEP, 'Senior, graduating December 2026.', 'Fall 2026', 'Fall 2026', null],
  [DEC, 'Senior, graduating next spring.', 'Spring 2027', 'Spring 2027', null],
  [FEB, 'Senior, graduating May 2027.', 'Fall 2027', 'Fall 2027', null, { passed: 'Spring 2027' }],
  [FEB, 'Senior, in my last semester.', 'Fall 2027', 'Fall 2027', null, { passed: 'Spring 2027' }],
  [FEB, 'Junior, graduating spring 2028.', 'Fall 2027', 'Spring 2028', null],
  [FEB, 'Sophomore, started fall 2025.', 'Fall 2027', 'Spring 2029', 'Fall 2025'],
  [AUG, 'Sophomore, graduating spring 2029.', 'Fall 2026', 'Spring 2029', null],
  [JUL, 'Rising sophomore.', 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  [JUL, 'Just finished my freshman year.', 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  // Only a graduation, or another school's.
  [OCT, 'Graduating May 2030.', 'Spring 2027', 'Spring 2030', null],
  [OCT, 'Class of 2029.', 'Spring 2027', 'Spring 2029', null],
  [OCT, 'Want to graduate in 4 years.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'Graduating in two years.', 'Spring 2027', 'Fall 2028', null],
  [OCT, 'Graduating December 2026.', 'Spring 2027', 'Spring 2027', null, { passed: 'Fall 2026' }],
  [OCT, 'Graduated HS in 2026. Freshman.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'HS class of 2026, freshman now.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Graduated in May 2026 from Naperville North, freshman now.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [JAN, 'Graduating May 2027.', 'Spring 2027', 'Spring 2027', null],
  [FEB, 'Graduating December 2027.', 'Fall 2027', 'Fall 2027', null],
  [FEB, 'I want to finish next spring.', 'Fall 2027', 'Spring 2028', null],
  // Gap years and terms away in the past.
  [OCT, 'I started fall 2024 but took a gap year in fall 2025 and spring 2026. Back now.', 'Spring 2027', 'Spring 2029', 'Fall 2024'],
  // Summers.
  [OCT, 'Starting summer 2027.', 'Fall 2027', 'Spring 2031', null],
  [AUG, "Starting fall 2026, I'll take summer classes.", 'Fall 2026', 'Spring 2030', null],
  // Relative words.
  [OCT, 'Starting next fall.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Starting this fall.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [DEC, 'Started this semester.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [JAN, 'Started last fall.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Started last spring.', 'Spring 2027', 'Fall 2029', 'Spring 2026'],
  [JAN, 'Starting next semester.', 'Fall 2027', 'Spring 2031', null],
  // With a record: its first Illinois term is when they began; a term in progress means enrolled.
  [OCT, '', 'Spring 2027', 'Spring 2029', 'Fall 2025', { record: F25 }],
  [OCT, "I'm a freshman.", 'Spring 2027', 'Spring 2030', 'Fall 2026', { record: F26 }],
  [OCT, 'Incoming freshman.', 'Spring 2027', 'Spring 2030', 'Fall 2026', { record: F26, incoming: false }],
  [DEC, 'Incoming freshman.', 'Spring 2027', 'Fall 2030', null, { record: S27, enrolled: true, incoming: false }],  // Written after the reader was changed, to check it was not fitted to the rows above.
  [OCT, 'Going to UIUC next year as a freshman.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Junior in high school, planning ahead.', 'Fall 2028', 'Spring 2032', null],
  [OCT, '1st year, 4 year plan.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm a first-year.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Applying to UIUC. My first year I want to live in the dorms.', 'Spring 2027', 'Fall 2030', null],
  [OCT, 'HS senior, class of 2027.', 'Fall 2027', 'Spring 2031', null],
  [FEB, 'High school class of 2027, starting at Illinois in the fall.', 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Graduated high school, Illinois class of 2030.', 'Spring 2027', 'Spring 2030', null],
  [FEB, 'I graduate in May 2027 and want to add a minor.', 'Fall 2027', 'Fall 2027', null, { passed: 'Spring 2027' }],
  [AUG, 'I am currently a high school senior and plan to attend UIUC in fall 2027.', 'Fall 2027', 'Spring 2031', null],
  [OCT, "Incoming freshman, I'll have junior standing from AP credit.", 'Fall 2027', 'Spring 2031', null],
  [OCT, 'Admitted student to Gies, currently a freshman.', 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, 'Junior standing, want to graduate in three semesters.', 'Spring 2027', 'Spring 2028', null],
  [OCT, "I'm a freshman at Illinois, started in August.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "Freshman (first semester), CS major.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "Current junior, want to graduate on time.", 'Spring 2027', 'Fall 2030', null],
  [OCT, "I'm a senior in high school and want to start in fall 2027.", 'Fall 2027', 'Spring 2031', null],
  [OCT, "Incoming freshman for fall 2027, admitted early action.", 'Fall 2027', 'Spring 2031', null],
  [OCT, "I'm a transfer student from Parkland, this is my first semester here.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [DEC, "I'm a freshman, finishing my first semester.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [JAN, "Freshman, second semester starts next week.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "Incoming freshman for next fall.", 'Fall 2027', 'Spring 2031', null],
  [OCT, "Admitted student, starting fall 2027.", 'Fall 2027', 'Spring 2031', null],
  [FEB, "Sophomore, graduating in 2029.", 'Fall 2027', 'Spring 2029', null],
  [OCT, "freshman, want to finish in 3.5 years", 'Spring 2027', 'Fall 2029', 'Fall 2026'],
  [OCT, "first year student. 4 years.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "Im a freshman", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "im a high school senior applying early", 'Fall 2027', 'Spring 2031', null],
  [OCT, "Senior. Graduating in December.", 'Spring 2027', 'Fall 2030', null],
  [FEB, "I'm a junior, I want to graduate May 2028.", 'Fall 2027', 'Spring 2028', null],
  [OCT, "I'm a junior transfer, started here fall 2026.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "Incoming junior transfer for fall 2027.", 'Fall 2027', 'Spring 2031', null],
  [OCT, "I will be an incoming freshman in fall 2027 and want to graduate in 4 years.", 'Fall 2027', 'Spring 2031', null],
  [OCT, "Currently a freshman, hoping to graduate a semester early.", 'Spring 2027', 'Fall 2029', 'Fall 2026'],
  [OCT, "Freshman! Want to do 4 years with a semester abroad junior year.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [FEB, "Freshman, started in the fall.", 'Fall 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "I'm a freshman but I came in with 30 credits from AP and dual enrollment.", 'Spring 2027', 'Spring 2030', 'Fall 2026'],
  [OCT, "Incoming freshman with 24 hours of dual credit from community college.", 'Fall 2027', 'Spring 2031', null],
];
let setPassed = 0;
for (const [day, words, start, grad, began, opts = {}] of SET) {
  const h = readOn(day, words, opts);
  const got = { start: `${h.startSeason} ${h.startYear}`, grad: `${h.gradSeason} ${h.gradYear}`, began: h.began ? termOf(h.began) : null, passed: h.gradPassed ? termOf(h.gradPassed) : null, incoming: h.incoming };
  const ok = got.start === start && got.grad === grad && got.began === began && got.passed === (opts.passed ?? null) && (opts.incoming === undefined || got.incoming === opts.incoming);
  if (ok) setPassed += 1;
  check(`on ${day}${opts.written ? ` (written ${opts.written})` : ''}, "${words}"${opts.record ? ` with a record from ${termOf(opts.record)}` : ''} runs ${start} to ${grad}, began ${began}`, ok, `got ${JSON.stringify(got)}`);
}
console.log(`  start-term set: ${setPassed} of ${SET.length} pass`);

section('13. Terms since the student began that nothing on the record holds');
const { recordCoverage, uncoveredTerms, assumedHours } = await import(join(HERE, 'start-term.ts'));
const recLine = (term, status = 'completed', extra = {}) => ({ code: 'PSYC 100', term, status, use: true, matchedBy: 'code', credits: 3, counts: 'course', ...extra });
const names = (ts) => ts.map(termOf).join(', ');
{
  // A sophomore whose record holds Fall 2025, Spring 2026 and Fall 2026 (in progress): nothing to assume.
  const record = { home: true, courses: [recLine('Fall 2025'), recLine('Spring 2026'), recLine('Fall 2026', 'in_progress')] };
  const c = recordCoverage(record);
  check('a record covering every term since they began leaves nothing assumed', uncoveredTerms(F25, S27, c.terms).length === 0, names(uncoveredTerms(F25, S27, c.terms)));
}
{
  // November: only the Spring 2027 registration is on the record; Fall 2026 is not.
  const record = { home: true, courses: [recLine('Spring 2027', 'in_progress'), recLine('Spring 2027', 'in_progress')] };
  const c = recordCoverage(record);
  const t = uncoveredTerms(F26, { season: 'Fall', year: 2027 }, c.terms);
  check('a spring registration alone leaves Fall 2026 assumed', names(t) === 'Fall 2026' && assumedHours(t, c.unplacedHours) === 15, names(t));
}
{
  // Four classes told to ALMA with no term (14 hours): they are this fall's, so little is assumed.
  const record = { home: true, courses: [1, 2, 3, 4].map((i) => recLine(null, 'completed', { matchedBy: 'student', credits: i === 4 ? 5 : 3 })) };
  const c = recordCoverage(record);
  const t = uncoveredTerms(F26, S27, c.terms);
  check('classes told to ALMA count against the assumed hours', c.unplacedHours === 14 && assumedHours(t, c.unplacedHours) === 0, `${c.unplacedHours} unplaced, ${assumedHours(t, c.unplacedHours)} assumed`);
}
{
  // A gap year named in the past earns nothing and is not assumed.
  const t = uncoveredTerms({ season: 'Fall', year: 2024 }, S27, new Set(), [{ season: 'Fall', year: 2025 }, { season: 'Spring', year: 2026 }]);
  check('terms away are not assumed', names(t) === 'Fall 2024, Spring 2025, Fall 2026' && assumedHours(t, 0) === 45, names(t));
}
{
  // Parkland's lines are not Illinois terms: a transfer who began here in Fall 2026 has that fall assumed.
  const record = { home: false, courses: [recLine('Fall 2025'), recLine('Spring 2026')] };
  const t = uncoveredTerms(F26, S27, recordCoverage(record).terms);
  check("another school's terms do not cover an Illinois term", names(t) === 'Fall 2026', names(t));
}
{
  const r = readHorizon('I started fall 2024 but took a gap year in fall 2025 and spring 2026. Back now.', firstOpenTerm(atNoon(OCT)), calendarTerm(atNoon(OCT)));
  check('readHorizon names the past terms away', r.pastAway.map(termOf).join(', ') === 'Fall 2025, Spring 2026', JSON.stringify(r.pastAway));
}
{
  // This school's own colleges are not another school: the date stands. College of DuPage is another school.
  const at = (words) => readHorizon(words, firstOpenTerm(atNoon(OCT)), calendarTerm(atNoon(OCT)));
  const end = (r) => `${r.gradSeason} ${r.gradYear}${r.stated ? ' stated' : ''}`;
  for (const [words, want] of [
    ['Sophomore, graduating from the College of Engineering in May 2029', 'Spring 2029 stated'],
    ['Sophomore, graduating May 2029 from the College of LAS', 'Spring 2029 stated'],
    ['Graduating Spring 2029 from Univ of Illinois', 'Spring 2029 stated'],
    ['Junior, graduating from the Department of Psychology in May 2028', 'Spring 2028 stated'],
    ['Graduating from the College of DuPage in May 2027, transferring after', 'Fall 2030'],
  ]) {
    const r = at(words);
    check(`"${words}" ends ${want}`, end(r) === want, end(r));
  }
  // A last semester named as a plan is not a graduation under way; said as who they are, it is.
  for (const [words, passed] of [
    ["Freshman. I'd like a light load in my last semester.", false],
    ['Sophomore, want to study abroad in my last semester.', false],
    ['Sophomore. Internship in my final term.', false],
    ['Freshman, no summers, easy classes in my final semester', false],
    ['Senior, in my last semester now.', true],
    ["I'm in my final semester.", true],
    ['This is my last term.', true],
  ]) {
    const r = at(words);
    check(`"${words}" ${passed ? 'is' : 'is not'} a graduation under way`, Boolean(r.gradPassed) === passed, JSON.stringify(r.gradPassed));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
