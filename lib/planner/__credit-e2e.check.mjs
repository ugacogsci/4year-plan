/**
 * Students who walk in with credit, end to end, with the mistakes a student
 * would call stupid checked automatically.
 *
 * Each profile goes through the same code the browser runs: a document
 * reading matched by lib/planner/transcript.ts (with the Parkland-to-UIUC
 * gen-ed guide), exams priced by components/planner/exam-credit.ts from the
 * registrar's table, then generatePlan. For every degree sampled it fails on:
 *   - a held course, or another name of it, booked again
 *   - a booked course the catalog says does not earn credit beside a held one
 *   - a validator error (prerequisite or standing)
 *   - a gen-ed category the held credit already meets getting a course booked for it
 *   - held hours that differ from what the documents and the registrar grant
 *   - a language course re-booked below the level the student holds
 *   - Composition I booked when the two-course sequence is held, or not planned when only one is
 *
 *   node lib/planner/__credit-e2e.check.mjs            # 30 degrees
 *   CREDIT_E2E_ALL=1 node lib/planner/__credit-e2e.check.mjs
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
const { generatePlan, validatePlan, distinctHeld } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const T = await import(join(HERE, 'transcript.ts'));
const X = await import(join(ROOT, 'components', 'planner', 'exam-credit.ts'));
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
const table = read('illinois-exam-credit.json').entries;
const guide = opt('illinois-transfer-gened.json');
const summaries = read('illinois/programs.json');
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: false };

// ---- profiles --------------------------------------------------------------
const line = (code, title, credits, extra = {}) => ({ code, title, credits, grade: 'A', term: 'Fall 2024', status: 'completed', ...extra });
const parklandLines = [
  line('ENG 101', 'English Composition I', 3), line('ENG 102', 'Composition II', 3), line('MAT 128', 'Calculus and Analytic Geometry I', 5), line('MAT 129', 'Calculus and Analytic Geometry II', 5),
  line('CHE 141', 'General Chemistry I', 5), line('PSY 101', 'Introduction to Psychology', 3), line('HIS 104', 'History of the U.S. to 1877', 3), line('HUM 101', 'Western Culture: Antiquity to Renaissance', 3),
  line('ECO 101', 'Principles of Macroeconomics', 3), line('ECO 102', 'Principles of Microeconomics', 3), line('SPA 101', 'Beginning Spanish I', 4), line('SPA 102', 'Beginning Spanish II', 4),
  line('SOC 101', 'Introduction to Sociology', 3), line('BIO 141', 'Principles of Biology I', 4), line('ANT 103', 'Intro to Cultural Anthropology', 3),
];
const profiles = [
  { name: 'Parkland transfer (15 courses, 54 hr)', reading: { institution: 'Parkland College', kind: 'transcript', courses: parklandLines, exams: [], notes: [] }, expectHours: 54, languageYears: 0, heldSpanish: 2, comp: 'held' },
  { name: 'Parkland, only ENG 101 of the composition pair', reading: { institution: 'Parkland College', kind: 'transcript', courses: [line('ENG 101', 'English Composition I', 3), line('PSY 101', 'Introduction to Psychology', 3), line('MAT 128', 'Calculus and Analytic Geometry I', 5)], exams: [], notes: [] }, expectHours: 11, languageYears: 2, comp: 'missing' },
  {
    name: 'AP-heavy first-year (12 exams)',
    documentExams: [
      { kind: 'AP', exam: 'Calculus BC', score: '5' }, { kind: 'AP', exam: 'English Language and Composition', score: '5' }, { kind: 'AP', exam: 'English Literature and Composition', score: '5' },
      { kind: 'AP', exam: 'Biology', score: '5' }, { kind: 'AP', exam: 'Chemistry', score: '4' }, { kind: 'AP', exam: 'Psychology', score: '4' }, { kind: 'AP', exam: 'United States History', score: '4' },
      { kind: 'AP', exam: 'Macroeconomics', score: '4' }, { kind: 'AP', exam: 'Microeconomics', score: '5' }, { kind: 'AP', exam: 'Physics C: Mechanics', score: '5' }, { kind: 'AP', exam: 'Computer Science A', score: '5' },
      { kind: 'AP', exam: 'Spanish Language and Culture', score: '4' },
    ],
    languageYears: 3, comp: 'held',
  },
  {
    name: 'College of DuPage evaluation report (printed equivalents and gen eds)',
    reading: { institution: 'University of Illinois Urbana-Champaign', kind: 'transfer_report', exams: [], notes: [], courses: [
      line('ENGLI 1101', 'English Composition I', 3, { status: 'transfer', from: 'College of DuPage', equivalent: 'RHET 105', equivalentCredits: 4 }),
      line('MATH 2231', 'Calculus and Analytic I', 5, { status: 'transfer', from: 'College of DuPage', equivalent: 'MATH 221', equivalentCredits: 4 }),
      line('HISTO 1110', 'US History to 1865', 3, { status: 'transfer', from: 'College of DuPage', equivalent: 'HIST 1--', equivalentCredits: 3, genEdText: 'Gen Ed: Hist & Phil; US Minority' }),
      line('SOCIO 1100', 'Introduction to Sociology', 3, { status: 'transfer', from: 'College of DuPage', equivalent: 'SOC 100', equivalentCredits: 3 }),
      line('MATH 0482', 'Foundations for College Math', 4, { status: 'no_credit', from: 'College of DuPage' }),
    ] },
    expectHours: 4 + 4 + 3 + 3, languageYears: 3,
  },
  {
    name: 'Continuing Illinois student with a transfer block and test credit',
    reading: { institution: 'University of Illinois Urbana-Champaign', kind: 'transcript', exams: [], notes: [], courses: [
      line('RHET 105', 'Writing and Research', 4, { status: 'transfer', from: 'Parkland College' }), line('MATH 221', 'Calculus I', 4, { status: 'transfer', from: 'Parkland College' }),
      line('MATH 1--', 'Elective Credit', 1, { status: 'transfer', from: 'Parkland College' }), line('ECON 1--', 'Elective (AP Macro 4)', 3, { status: 'exam' }),
      line('CS 124', 'Intro to Computer Science I', 3, { term: 'Fall 2025' }), line('ECON 102', 'Microeconomic Principles', 3, { term: 'Fall 2025' }),
      line('PSYC 100', 'Intro Psych', 4, { status: 'in_progress', term: 'Spring 2026', grade: null }),
    ] },
    alsoPickedExams: [{ kind: 'AP', exam: 'ECON MACRO', level: null, score: 4 }],
    expectHours: 4 + 4 + 1 + 3 + 3 + 3 + 4, languageYears: 3, residentHours: { total: 10, upper: 0 },
  },
];

// ---- degrees ---------------------------------------------------------------
const plannable = summaries.filter((s) => existsSync(join(PUBLIC, 'illinois', 'program', `${s.id}.json`)) && s.totalCredits);
const byCollege = new Map();
for (const s of plannable) { const k = s.id.split('/')[0]; if (!byCollege.has(k)) byCollege.set(k, []); byCollege.get(k).push(s); }
const sample = process.env.CREDIT_E2E_ALL ? plannable : [...byCollege.values()].flatMap((list) => list.filter((_, i) => i % Math.max(1, Math.ceil(list.length / 4)) === 0)).slice(0, 30);
const must = ['engineering/computer-science-bs', 'bus/finance-bs', 'las/psychology-bslas', 'las/chemistry-bs', 'engineering/mechanical-engineering-bs'];
for (const id of must) if (!sample.some((s) => s.id === id)) { const s = plannable.find((p) => p.id === id); if (s) sample.push(s); }

function load(s) {
  const raw = read(`illinois/program/${s.id}.json`);
  const a = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [raw] }, new Map(byCode));
  return a.blocks.get(s.id) ?? [];
}

let failures = 0;
const summary = [];
for (const profile of profiles) {
  const record = profile.reading ? T.matchTranscript(profile.reading, 'profile', catalog, ['profile'], guide) : null;
  const perProfile = { name: profile.name, plans: 0, problems: 0, examples: /** @type {string[]} */ ([]) };
  for (const s of sample) {
    const grainger = s.id.startsWith('engineering/');
    const exams = X.alignExamsToCollege([...(profile.documentExams ? X.matchDocumentExams(profile.documentExams, table, grainger) : []), ...(profile.alsoPickedExams ?? [])], table, grainger).exams;
    const codes = [...new Set([...X.examCourses(exams, table, (c) => byCode.has(c)), ...T.transcriptCodes(record)])];
    const hours = X.examElectiveHours(exams, table, T.transcriptIndirectCodes(record), creditsOf) + T.transcriptHours(record) + T.transcriptCreditAdjustment(record);
    const genEdCredits = [...T.transcriptGenEdCredits(record), ...X.examGenEdCredits(exams, table, creditsOf)];
    const prior = { courseCodes: codes, exemptCodes: [], unmatchedCredits: hours, known: true, languageSemesters: profile.languageYears ?? 0, languageName: 'Spanish', genEdCredits };
    const blocks = load(s);
    const resident = T.transcriptResidentHours(record);
    const r = generatePlan({ requirements: blocks, context, prior, horizon: HORIZON, preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } }, programId: s.id, degreeTotal: s.totalCredits, programName: s.name, programCollege: s.college, residency: { hours: 45, upperLevel: 21, heldHours: resident.total, heldUpper: resident.upper, source: 'x' } });
    perProfile.plans += 1;
    if (process.env.CREDIT_E2E_SHOW === s.id) {
      console.log(`\n--- ${profile.name} / ${s.id}`);
      console.log('  held codes:', codes.join(', '));
      console.log('  hours with no course:', hours, '| gen-ed credits:', genEdCredits.map((g) => `${g.label} -> ${g.tags.join('+')}`).join('; ') || 'none');
      console.log('  engine prior hours:', r.credits.prior, '| language:', r.language ? `${r.language.name} ${r.language.codes.join(',')}` : 'none', '| residency:', r.residency ? `${r.residency.heldHours}+${r.residency.plannedHours}` : '-');
      for (const term of r.terms) console.log(`  ${term.label}: ${term.codes.join(', ')}`);
    }
    const problems = [];
    const board = r.terms.flatMap((t) => t.codes.map(norm));
    const held = new Set(); for (const c of codes) { held.add(norm(c)); for (const e of equivalents.get(norm(c)) ?? []) held.add(e); }
    const forfeited = new Set((r.forfeited ?? []).map((f) => norm(f.held)));
    for (const c of board) if (held.has(c) && !forfeited.has(c)) problems.push(`re-books held ${c}`);
    for (const c of board) for (const x of exclusions.get(c) ?? []) if (held.has(norm(x)) && !forfeited.has(norm(x))) problems.push(`books ${c}, which does not earn credit beside held ${x}`);
    const errors = validatePlan(r.plan, context, { minimumTermCredits: 12, programName: s.name, programCollege: s.college, priorCredits: r.credits.prior }).filter((i) => i.severity === 'error');
    for (const e of errors.slice(0, 3)) problems.push(`validator: ${e.title}`);
    // gen-ed categories the held credit alone meets
    const heldRows = illinoisProgress({ blocks, boardCodes: [], priorCodes: codes, byCode, pools: [], language: null, satisfiedByPriorCredit: [], equivalents, degreeTotal: s.totalCredits, priorHours: hours, genEdCredits });
    blocks.forEach((b) => {
      if (b.rule.kind !== 'gened') return;
      const row = heldRows.find((x) => x.area.label && b.label && x.area.label.startsWith(b.label.replace(/[\s:;,.]+$/, '').slice(0, 20)));
      if (!row || !row.satisfied) return;
      const named = new Set(b.rule.fulfilledBy.flat().map(norm));
      const bookedHere = Object.entries(r.bookedFor ?? {}).filter(([code, req]) => req === b.id && board.includes(norm(code)) && !named.has(norm(code))).map(([code]) => code);
      if (bookedHere.length > 0) problems.push(`books ${bookedHere.join(', ')} for ${b.label}, which the held credit already meets`);
    });
    if (profile.expectHours !== undefined) {
      const lost = [...forfeited].reduce((sum, c) => sum + (creditsOf(c) ?? 0), 0);
      const pairs = distinctHeld(codes, context).dropped.reduce((sum, d) => sum + (creditsOf(d.dropped) ?? 0), 0);
      const want = profile.expectHours - lost - pairs;
      if (Math.abs(r.credits.prior - want) > 0.01) problems.push(`held hours ${r.credits.prior}, the documents grant ${want}`);
    }
    if (profile.heldSpanish && r.language) {
      const low = r.language.codes.filter((c) => /^SPAN 10[12]$/.test(norm(c)));
      if (low.length) problems.push(`books ${low.join(', ')} though SPAN 101-102 transferred`);
    }
    const compBlock = blocks.find((b) => b.rule.kind === 'gened' && b.rule.genEd.includes('Composition I'));
    if (compBlock && profile.comp === 'held' && board.includes('RHET 105')) problems.push('books RHET 105 though Composition I is held');
    if (compBlock && profile.comp === 'missing') {
      const compOnBoard = board.some((c) => (byCode.get(c)?.tags ?? []).includes('Composition I'));
      if (!compOnBoard) problems.push('Composition I is not met and nothing is booked for it');
    }
    if (profile.residentHours && (!r.residency || r.residency.heldHours !== profile.residentHours.total)) problems.push(`residency held hours ${String(r.residency?.heldHours)}, the record shows ${profile.residentHours.total}`);
    if (problems.length) {
      perProfile.problems += problems.length;
      failures += problems.length;
      if (perProfile.examples.length < 6) perProfile.examples.push(`${s.id}: ${problems.slice(0, 4).join('; ')}`);
    }
  }
  summary.push(perProfile);
  console.log(`\n${profile.name}: ${perProfile.plans} plans, ${perProfile.problems} problems`);
  for (const e of perProfile.examples) console.log('  ' + String(e));
}
console.log(failures ? `\n${failures} PROBLEM(S)` : '\nno avoidable mistakes found');
process.exit(failures ? 1 : 0);
