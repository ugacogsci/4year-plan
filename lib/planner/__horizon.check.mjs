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
const { readHorizon } = await import(pathToFileURL(cut).href);

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
    check(`${name}: the aim note matches the board`, said >= heaviest - 1, `aim ${said}, heaviest ${heaviest}`);
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

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
