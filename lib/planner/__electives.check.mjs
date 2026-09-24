/**
 * The planner's own picks, and the knob that asks for them to be light.
 *
 * Four things went wrong together, and each is checked here on the audit
 * students (the ten the "easier", "career" and "schedule" reviews planned by
 * hand, plus an international freshman):
 *
 *   1. Free electives were filled with courses written for somebody else:
 *      FSHN 123 "FSHN Orientation to Illinois" and BIOE 100, the
 *      Bioengineering first-year seminar, in an Economics plan; MCB 297 "MCB
 *      Honors Discussion" with no MCB course on the board; HK 125 and MDIA 100
 *      in plans outside Kinesiology and Media; MATH 499, the first-year
 *      graduate seminar. freeElectiveBar reads who a course is for from what
 *      a plan loads (title, prerequisite sentence, section restrictions); the
 *      first block below reads every catalog description, which a plan does
 *      not load, and fails when one says a course is for a group the bar lets
 *      through. And one-credit fillers stacked up to reach each term's aim:
 *      eleven in Emma's Psychology plan. Small courses now only land a plan
 *      on its total.
 *   2. Every Finance plan booked FIN 391 to 395 and BADM 390, which take an
 *      application, an invitation or the instructor's approval.
 *      admissionGate reads the gate; no plan books a gated course on its own,
 *      and a course the degree requires by name (ME 470, the teacher
 *      education CI 4xx courses) stays.
 *   3. Jordan, a Parkland transfer, was given LAS 100 "Success in LAS for
 *      International Students" for Psychology's orientation row. The row now
 *      follows who the student is (arrivalFromWords): LAS 102 for a transfer,
 *      LAS 101 for a first-year, LAS 100 only for a student who said they are
 *      international.
 *   4. "Lightest" made some students' picks harder than balanced, and
 *      workload 2 on its own changed nothing for Finance, Kinesiology,
 *      Mechanical Engineering and Computer Science. Both must now be at most
 *      balanced's average difficulty for free electives, list picks and
 *      gen-ed picks, and must lower the average over all of them. Courses a
 *      career track books are the goal's, not a pick by difficulty, and are
 *      left out of the averages.
 *
 * Everything is loaded the way the browser loads it (public/illinois), as in
 * __credit-e2e.check.mjs. The students' held credit is written out below as
 * the transcript and exam readers produced it, so the check needs no reading
 * files.
 *
 *   node lib/planner/__electives.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const { generatePlan, freeElectiveBar, degreeSubjects, admissionGate, arrivalFromWords } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const opt = (n) => (existsSync(join(PUBLIC, n)) ? read(n) : null);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

// ---- the context, as loadIllinoisCore and buildContext assemble it ----------
const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = opt('illinois/offerings.json');
if (offeringsFile) applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const gradeRaw = new Map(read('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) { if (!c.gradeFrom) continue; const twin = gradeRaw.get(norm(c.gradeFrom)); if (twin) gradeRaw.set(norm(c.code), twin); }
const grades = new Map(); for (const [code, g] of gradeRaw) grades.set(code, toGradeRow(g, byCode.get(code)?.title ?? code, []));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const sectionsFile = opt('illinois/sections.json');
const sections = new Map((sectionsFile?.courses ?? []).map((row) => [norm(row.code), { ...row, termId: sectionsFile.termId, termLabel: sectionsFile.termLabel }]));
const excellentFile = opt('illinois/excellent.json');
const season = (meta.term?.term ?? 'fall').toLowerCase();
const context = {
  courses: rows, prereqs: new Map(Object.entries(read('illinois/prereqs.json'))), grades, sections, equivalents,
  exclusions: new Map(Object.entries(read('illinois/exclusions.json'))), creditRanges, bands: meta.bands,
  excellent: excellentFile ? new Map(Object.entries(excellentFile.courses)) : undefined, excellentTerms: excellentFile?.terms,
  offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(), offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined,
  offeringTerms: offeringsFile?.terms, offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  languages: opt('illinois/languages.json') ?? undefined,
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const summaries = read('illinois/programs.json');

let failures = 0;
const fail = (message) => { failures += 1; console.log(`  FAIL ${message}`); };

// ---- 1. every catalog description against the bar --------------------------
/**
 * What a description says about who a course is for. A course flagged here
 * must be barred for a student outside its own subject, or carry the
 * concurrent-enrollment group in its parsed prerequisites, which the fill
 * already enforces (ECE 314 with ECE 313).
 */
const SAYS = [
  ['concurrent', /concurrent (enrollment|registration) in [^.]*\brequired|must be (taken|enrolled) concurrently|designed to be taken concurrently/i],
  ['orientation', /\borientation (course|seminar) for|introductory course for students in the (department|college)|enrollment required for [^.]*\b(freshmen|transfer)/i],
  ['first-year', /designed for first[- ]year|for (incoming |new )?first[- ]year (?!graduate)[a-z ]*students|first[- ]year [a-z ]*honors students|students new to/i],
  ['transfer', /\bfor (first[- ]term )?(off-campus )?transfer students\b|first[- ]term transfer students/i],
  ['international', /\binternational students\b/i],
  ['graduate', /required of all (first[- ]year )?graduate students/i],
  ['majors only', /\b(limited|restricted) to [^.]*\bmajors only\b|capstone course required of all majors/i],
  ['abroad', /\b(going|studying) abroad\b/i],
  ['by invitation', /\bnormally invited\b|\badmission by application\b/i],
  ['general studies', /division of general studies/i],
];
/** What a description says that gates a course behind an application or approval, which admissionGate must read too. */
const GATED = /\binstructor approval (is )?required\b|\bmust apply with\b|\bapply with an essay\b|\bnormally invited\b|\brequires prior admission\b|\badmission by application\b/i;
const description = new Map();
for (const f of readdirSync(join(PUBLIC, 'illinois', 'course'))) {
  for (const c of JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'course', f), 'utf8')).courses) description.set(norm(c.code), c.description ?? '');
}
{
  console.log('1. catalog descriptions that name who a course is for, or gate it');
  const psychology = freeElectiveBar(context, byCode, { college: 'las', primary: 'PSYC', programName: 'Psychology, BSLAS' });
  const finance = freeElectiveBar(context, byCode, { college: 'bus', primary: 'FIN', programName: 'Finance, BS' });
  let flagged = 0;
  let gatedByWords = 0;
  for (const code of [...byCode.keys()].sort((a, b) => a.localeCompare(b))) {
    const said = description.get(code) ?? '';
    if (GATED.test(said)) {
      gatedByWords += 1;
      if (!admissionGate(code, context)) fail(`${code} "${byCode.get(code).title}": the description gates it ("${said.match(GATED)[0]}"), and admissionGate does not. Add it to GATED_BY_DESCRIPTION in autoplan.ts.`);
    }
    const hit = SAYS.find(([, rx]) => rx.test(said));
    if (!hit) continue;
    flagged += 1;
    const bar = byCode.get(code).cluster === 'PSYC' ? finance : psychology;
    const concurrent = hit[0] === 'concurrent' && (context.prereqs.get(code)?.groups ?? []).some((g) => g.concurrent);
    if (!bar(code) && !concurrent) fail(`${code} "${byCode.get(code).title}": the description says ${hit[0]} ("${(said.match(hit[1]) ?? [''])[0]}"), and nothing the planner loads bars it. Add it to DESCRIPTION_ONLY_GROUP or DESCRIPTION_ONLY_MAJORS in autoplan.ts.`);
    // A group of students is a group in the course's own department too: CS
    // 100 is "for incoming first year and external transfer students", and a
    // Computer Science plan took it as a senior-year elective.
    if (['first-year', 'transfer', 'international', 'abroad'].includes(hit[0])) {
      const own = freeElectiveBar(context, byCode, { college: null, primary: byCode.get(code).cluster })(code);
      if (!own) fail(`${code} "${byCode.get(code).title}": the description says ${hit[0]} ("${(said.match(hit[1]) ?? [''])[0]}"), and a ${byCode.get(code).cluster} major could be given it as an elective. Add it to DESCRIPTION_ONLY_GROUP in autoplan.ts.`);
    }
  }
  console.log(`  ${flagged} courses flagged by their description, ${gatedByWords} gated by it`);
  // The named cases, for the students they reached.
  const named = [
    ['FSHN 123', 'las', 'ECON', 'Economics, BALAS'], ['BIOE 100', 'las', 'ECON', 'Economics, BALAS'], ['BIOE 120', 'media', 'ADV', 'Advertising, BS'],
    ['MCB 297', 'las', 'ECON', 'Economics, BALAS'], ['MCB 298', 'las', 'MCB', 'Molecular and Cellular Biology, BSLAS'], ['HK 125', 'media', 'ADV', 'Advertising, BS'],
    ['MDIA 100', 'bus', 'FIN', 'Finance, BS'], ['SOCW 101', 'las', 'PSYC', 'Psychology, BSLAS'], ['LAS 100', 'las', 'PSYC', 'Psychology, BSLAS'],
    ['LAS 102', 'las', 'PSYC', 'Psychology, BSLAS'], ['LAS 279', 'las', 'PSYC', 'Psychology, BSLAS'], ['LAS 122', 'las', 'PSYC', 'Psychology, BSLAS'],
    ['LAS 291', 'las', 'PSYC', 'Psychology, BSLAS'], ['ENG 100', 'las', 'PSYC', 'Psychology, BSLAS'], ['ENG 101', 'bus', 'FIN', 'Finance, BS'],
    ['MATH 499', 'las', 'ECON', 'Economics, BALAS'], ['FIN 391', 'bus', 'FIN', 'Finance, BS'], ['GLBL 296', 'las', 'ECON', 'Economics, BALAS'],
    ['BADM 390', 'bus', 'FIN', 'Finance, BS'], ['CS 196', 'las', 'PSYC', 'Psychology, BSLAS'], ['MUS 120', 'las', 'PSYC', 'Psychology, BSLAS'],
    // A group, whatever the degree's own subject: a Liberal Studies plan took LAS 102 and LAS 112 as electives, an Education plan EDUC 102.
    ['LAS 102', 'las', 'LAS', 'Liberal Studies, BLS'], ['LAS 112', 'las', 'LAS', 'Liberal Studies, BLS'], ['EDUC 102', 'education', 'EDUC', 'Secondary Education, BS'],
    ['BUS 315', 'bus', 'BADM', 'Business Data Science, BS'], ['FAA 241', 'las', 'PSYC', 'Psychology, BSLAS'],
  ];
  for (const [code, college, primary, programName] of named) {
    if (!freeElectiveBar(context, byCode, { college, primary, programName })(code)) fail(`${code} is not barred for a ${programName} student`);
  }
  // And what the bar must leave alone: a department's own orientation, a course written for non-majors.
  const open = [
    ['HK 125', 'ahs', 'HK', 'Kinesiology, BS'], ['MUS 130', 'las', 'PSYC', 'Psychology, BSLAS'], ['FSHN 249', 'las', 'PSYC', 'Psychology, BSLAS'], ['ECON 420', 'bus', 'FIN', 'Finance, BS'],
    ['RUSS 101', 'las', 'PSYC', 'Psychology, BSLAS'], ['CHEM 103', 'las', 'MCB', 'Molecular and Cellular Biology, BSLAS'],
  ];
  for (const [code, college, primary, programName] of open) {
    const why = freeElectiveBar(context, byCode, { college, primary, programName })(code);
    if (why) fail(`${code} is barred for a ${programName} student (${why}), and it is open to them`);
  }
}

// ---- 2. the gate -------------------------------------------------------------
{
  console.log('\n2. courses behind an application, an admission or an approval');
  const all = [...byCode.keys()].filter((code) => admissionGate(code, context));
  console.log(`  ${all.length} courses read as gated`);
  const gated = ['FIN 391', 'FIN 392', 'FIN 393', 'FIN 394', 'FIN 395', 'BADM 390', 'CI 405', 'ME 470', 'LCTL 101', 'CMN 204', 'GC 295', 'ENG 377', 'CI 476', 'PS 393', 'TE 360', 'HIST 492'];
  for (const code of gated) if (!admissionGate(code, context)) fail(`${code} should read as gated: "${context.prereqs.get(code)?.text ?? description.get(code)}"`);
  // "X or consent of instructor" is a way in, not a gate; "required for repeating" gates nobody the first time;
  // "required for non-theatre majors" gates everyone but theatre majors.
  const open = ['ARTD 487', 'SOCW 470', 'MATH 241', 'CPSC 442', 'FIN 300', 'PSYC 100', 'ECON 102'];
  for (const code of open) if (admissionGate(code, context)) fail(`${code} is not gated, and reads as "${admissionGate(code, context)}"`);
  if (!admissionGate('THEA 100', context, 'FIN')) fail('THEA 100 gates a Finance student ("Consent of instructor required for non-theatre majors")');
  if (admissionGate('THEA 100', context, 'THEA')) fail('THEA 100 is open to a theatre major');
}

// ---- 3. who the student is ------------------------------------------------------
{
  console.log('\n3. who the student is, from their onboarding words');
  const cases = [
    { words: "I'm finishing my associate's at Parkland this year and transferring to Illinois in Fall 2027 as a junior.", elsewhere: false, want: { transfer: true, international: false } },
    { words: 'Starting at Illinois in fall 2026 as a freshman. Want to graduate in 4 years or less.', elsewhere: true, want: { transfer: false, international: false } },
    { words: 'Freshman starting fall 2026, four years.', elsewhere: false, want: { transfer: false, international: false } },
    { words: "I'm an international student from Seoul, starting as a freshman in fall 2026.", elsewhere: false, want: { transfer: false, international: true } },
    { words: 'I want to transfer into Gies from LAS next year.', elsewhere: false, want: { transfer: false, international: false } },
    { words: 'Coming from College of DuPage in the fall.', elsewhere: false, want: { transfer: true, international: false } },
    { words: 'Starting fall 2027.', elsewhere: true, want: { transfer: true, international: false } },
  ];
  for (const { words, elsewhere, want } of cases) {
    const got = arrivalFromWords(words, elsewhere);
    if (got.transfer !== want.transfer || got.international !== want.international) fail(`"${words}" (record from elsewhere: ${String(elsewhere)}) read as ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  }
}

// ---- the audit students ------------------------------------------------------
const FOUR = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true, away: [], summers: [] };
const held = (courseCodes, unmatchedCredits, languageSemesters = 4, languageName = 'Spanish', genEdCredits = []) => ({ courseCodes, exemptCodes: [], unmatchedCredits, known: true, languageSemesters, languageName, genEdCredits });
const FRESHMAN = 'Freshman starting fall 2026, four years.';
const STUDENTS = [
  { key: 'Emma, Psychology', program: 'las/psychology-bslas', prior: held([], 0), studying: 'Psychology, pre-med.', after: 'I want to go to medical school so I need to keep my GPA up.', timeline: FRESHMAN, orientation: 'LAS 101' },
  { key: 'Luca, MCB with IB', program: 'las/molecular-cellular-biology-bslas', prior: held(['IB 150', 'IB 151', 'MCB 150', 'MCB 151', 'CHEM 102', 'CHEM 104', 'RHET 105', 'MATH 115', 'STAT 100', 'SPAN 201'], 6, 4, 'Italian'), studying: 'Molecular and cellular biology, pre-med.', after: 'Medical school. Keep my GPA as high as possible.', timeline: FRESHMAN },
  { key: 'Marcus, Finance', program: 'bus/finance-bs', prior: held([], 0), studying: 'Finance at Gies.', after: 'Investment banking or corporate finance.', timeline: FRESHMAN },
  { key: 'Sofia, Economics with AP', program: 'las/economics-balas', prior: held(['CS 101', 'CHEM 102', 'CHEM 104', 'MATH 220', 'MATH 231', 'PHYS 211', 'RHET 105', 'SPAN 203', 'SPAN 210', 'SPAN 214', 'STAT 100', 'PHYS 101'], 7), studying: 'Economics.', after: 'Law school or policy work.', timeline: FRESHMAN },
  { key: 'Maya, CS with AP', program: 'engineering/computer-science-bs', prior: held(['CS 101', 'CHEM 102', 'CHEM 104', 'MATH 220', 'MATH 231', 'PHYS 211', 'RHET 105', 'SPAN 203', 'SPAN 210', 'SPAN 214'], 7), studying: 'Computer science in Grainger.', after: 'Software engineering, maybe machine learning.', timeline: FRESHMAN },
  { key: 'Aaliyah, Kinesiology', program: 'ahs/kinesiology-bs/applied-exercise-science', prior: held(['PSYC 100', 'STAT 100', 'RHET 105', 'MATH 112', 'CMN 101', 'SOC 100', 'PS 101'], 6, 2), studying: 'Kinesiology.', after: 'Physical therapy school after.', timeline: 'Starting at Illinois in fall 2026 as a freshman. Want to graduate in 4 years or less.', elsewhere: true },
  { key: 'Diego, Mechanical Engineering', program: 'engineering/mechanical-engineering-bs', prior: held([], 0), studying: 'Mechanical engineering.', after: 'Automotive or aerospace design.', timeline: FRESHMAN, required: ['ME 470'] },
  { key: 'Chloe, Advertising', program: 'media/advertising-bs', prior: held([], 0), studying: 'Advertising in the College of Media.', after: 'Brand strategy and social media marketing.', timeline: FRESHMAN },
  { key: 'Nate, Political Science', program: 'las/political-science-balas/law-power', prior: held([], 0), studying: 'Political science, law and power.', after: 'Law school, so my GPA matters a lot.', timeline: FRESHMAN },
  {
    key: 'Jordan, Parkland transfer', program: 'las/psychology-bslas', studying: 'Psychology in LAS, interested in clinical and counseling.', after: '',
    timeline: "I'm finishing my associate's at Parkland this year and transferring to Illinois in Fall 2027 as a junior. I want to finish in two years.", elsewhere: true, orientation: 'LAS 102',
    horizon: { startSeason: 'Fall', startYear: 2027, gradSeason: 'Spring', gradYear: 2029, stated: true, away: [], summers: [] },
    prior: held(['RHET 105', 'PSYC 100', 'SPAN 101', 'SPAN 102', 'SOC 100', 'SPAN 201', 'PHIL 101', 'ENGL 101', 'PSYC 201'], 17, 2, 'Spanish', [
      { id: 'Parkland College MAT 160 #6', label: 'MAT 160 Statistics (Parkland College)', credits: 4, tags: ['Quantitative Reasoning I'] },
      { id: 'Parkland College PSY 209 #9', label: 'PSY 209 Human Growth and Development (Parkland College)', credits: 3, tags: ['Social & Beh Sci - Beh Sci'] },
      { id: 'Parkland College HUM 101 #11', label: 'HUM 101 Western Culture: Antiquity to Renaissance (Parkland College)', credits: 3, tags: ['Cultural Studies - Western', 'Humanities - Lit & Arts'] },
      { id: 'Parkland College AST 101 #12', label: 'AST 101 The Solar System (repeat) (Parkland College)', credits: 4, tags: ['Nat Sci & Tech - Phys Sciences', 'Quantitative Reasoning II'] },
      { id: 'Parkland College ANT 103 #15', label: 'ANT 103 Intro to Cultural Anthropology (Parkland College)', credits: 3, tags: ['Cultural Studies - Non-West', 'Social & Beh Sci - Soc Sci'] },
    ]),
  },
  { key: 'Mei, Psychology, international', program: 'las/psychology-bslas', prior: held([], 0), studying: 'Psychology.', after: 'Graduate school in counseling.', timeline: "I'm an international student from Seoul, starting as a freshman in fall 2026.", orientation: 'LAS 100', only: ['balanced'] },
];
const P = PRIORITY_PRESETS;
const VARIANTS = { balanced: P.balanced, 'workload 2': { ...P.balanced, workload: 2 }, lightest: P.lightest };
// The schedule wishes that pulled in MCB 297 and 298, MDIA 100 and BIOE 100 (review #32).
const WISHES = {
  'Sofia, Economics with AP': { 'nothing before 9': { ...P.balanced, noEarly: true, notBefore: 540 }, 'in person, nothing before 9, schedule 2': { ...P.balanced, schedule: 2, noEarly: true, notBefore: 540, format: 'in-person' } },
  'Marcus, Finance': { 'evenings only': { ...P.balanced, notBefore: 1020 } },
};

function plan(st, priorities) {
  const s = summaries.find((p) => p.id === st.program);
  st.blocks ??= adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [read(`illinois/program/${s.id}.json`)] }, new Map(byCode)).blocks.get(s.id) ?? [];
  // As the workspace asks: the studying and career answers for interests, the career answer alone for goals.
  const r = generatePlan({
    requirements: st.blocks, context, prior: st.prior, horizon: st.horizon ?? FOUR,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities },
    programId: s.id, degreeTotal: s.totalCredits, interests: `${st.studying} ${st.after}`, career: st.after, programName: s.name, programCollege: s.college, admissionRoute: null,
    arrival: arrivalFromWords(`${st.studying} ${st.timeline} ${st.after}`, st.elsewhere ?? false),
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  });
  return { r, s };
}

/** Difficulty by grade history, and each planned course sorted into the kind of pick it is. */
const difficulty = (code) => grades.get(code)?.difficulty ?? null;
function picks(r, blocks) {
  const kindOf = new Map(blocks.map((b) => [b.id, b.rule.kind === 'hours' && b.rule.genEd?.length ? 'gened' : b.rule.kind]));
  const added = new Set(r.addedPrerequisites.map((p) => p.code));
  const track = new Set(r.electives.filter((e) => e.track).map((e) => e.code));
  /** @type {{ elective: string[], track: string[], list: string[], gened: string[], required: string[] }} */
  const out = { elective: [], track: [], list: [], gened: [], required: [] };
  for (const t of r.terms) for (const code of t.codes) {
    const req = r.bookedFor?.[code];
    if (req === null || req === undefined) {
      if (track.has(code)) out.track.push(code);
      else if (!added.has(code)) out.elective.push(code);
      continue;
    }
    const kind = kindOf.get(req);
    if (kind === 'choose' || kind === 'pool') out.list.push(code);
    else if (kind === 'gened' || kind === 'hours') out.gened.push(code);
    else out.required.push(code);
  }
  return out;
}
const average = (codes) => {
  const known = codes.map(difficulty).filter((d) => d !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};
const f1 = (x) => (x === null ? '  -  ' : x.toFixed(1).padStart(5));

// ---- 4. the plans -------------------------------------------------------------
console.log('\n4. the plans: nobody else\'s courses, nothing gated, small ones only to land on the total,');
console.log('   the orientation row by who the student is, and workload 2 and lightest never harder than balanced\n');
console.log('   student                        variant       free el.  list  gen-ed   all   track  not placed  unsatisfied  credits');
for (const st of STUDENTS) {
  const runs = {};
  const variants = Object.fromEntries(Object.entries({ ...VARIANTS, ...WISHES[st.key] }).filter(([name]) => !st.only || st.only.includes(name)));
  for (const [name, priorities] of Object.entries(variants)) {
    const { r, s } = plan(st, priorities);
    const bar = freeElectiveBar(context, byCode, { college: s.college, primary: degreeSubjects(st.blocks, s.name).primary, programName: s.name });
    const p = picks(r, st.blocks);
    for (const code of p.elective) {
      const why = bar(code);
      if (why) fail(`${st.key}, ${name}: free elective ${code} "${byCode.get(code)?.title}" is ${why}`);
    }
    const primary = degreeSubjects(st.blocks, s.name).primary;
    for (const kind of ['elective', 'track', 'list', 'gened']) {
      for (const code of p[kind]) {
        const gate = admissionGate(code, context, primary);
        if (gate) fail(`${st.key}, ${name}: ${code} is a ${kind} pick and is gated: "${gate}"`);
      }
    }
    for (const code of st.required ?? []) if (!p.required.includes(code) && !p.list.includes(code)) fail(`${st.key}, ${name}: ${code}, which the degree requires by name, is not booked for it`);
    const onBoard = r.terms.flatMap((t) => t.codes);
    if (st.orientation) {
      const las = onBoard.filter((c) => /^LAS 10[012]$/.test(c));
      if (las.length !== 1 || las[0] !== st.orientation) fail(`${st.key}, ${name}: the orientation row booked ${las.join(', ') || 'nothing'}, not ${st.orientation}`);
    }
    const small = p.elective.filter((code) => (byCode.get(code)?.credits ?? 3) < 3);
    if (small.length > 2) fail(`${st.key}, ${name}: ${small.length} one- or two-credit free electives (${small.join(', ')}); they only land a plan on its total`);
    const total = r.credits.total.min;
    if (s.totalCredits && total < s.totalCredits) fail(`${st.key}, ${name}: ${total} of the ${s.totalCredits} credits the degree takes`);
    runs[name] = { p, notPlaced: r.notPlaced.length, unsatisfied: r.unsatisfied.length };
    const all = average([...p.elective, ...p.list, ...p.gened]);
    console.log(`   ${st.key.padEnd(30)} ${name.slice(0, 12).padEnd(12)}  ${f1(average(p.elective))}   ${f1(average(p.list))}  ${f1(average(p.gened))}  ${f1(all)}  ${f1(average(p.track))}  ${String(r.notPlaced.length).padStart(6)}  ${String(r.unsatisfied.length).padStart(10)}     ${total}`);
  }
  const base = runs.balanced;
  for (const name of ['workload 2', 'lightest']) {
    const run = runs[name];
    if (!run) continue;
    for (const kind of ['elective', 'list', 'gened']) {
      const a = average(run.p[kind]);
      const b = average(base.p[kind]);
      if (a !== null && b !== null && a > b + 1e-9) fail(`${st.key}: ${name} ${kind} picks average difficulty ${a.toFixed(1)}, harder than balanced's ${b.toFixed(1)}`);
    }
    const a = average([...run.p.elective, ...run.p.list, ...run.p.gened]);
    const b = average([...base.p.elective, ...base.p.list, ...base.p.gened]);
    if (!(a < b)) fail(`${st.key}: ${name} picks average ${a?.toFixed(1)}, not lighter than balanced's ${b?.toFixed(1)}`);
    if (run.notPlaced > base.notPlaced || run.unsatisfied > base.unsatisfied) fail(`${st.key}: ${name} leaves more unplaced (${run.notPlaced}) or unsatisfied (${run.unsatisfied}) than balanced (${base.notPlaced}, ${base.unsatisfied})`);
  }
}

console.log(failures ? `\n*** ${failures} failures ***` : '\nall elective, gate, orientation and priority checks passed');
if (failures) process.exitCode = 1;
