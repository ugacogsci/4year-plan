/**
 * The Illinois Articulation Initiative at Illinois: IAI-coded lines and a
 * completed General Education Core Curriculum (GECC), with made-up College of
 * DuPage students (no real student's record).
 *
 * Sources for what is expected:
 *   Illinois Admissions, transfer admission policies
 *     (admissions.illinois.edu/transfer-admission-policies/): a completed IAI
 *     GECC means gen-ed requirements are met on transfer; campus, college and
 *     major requirements beyond it still apply.
 *   Illinois Gen Ed office (gened.illinois.edu/choosing/first-year-transfer-students/):
 *     IAI courses are applied to campus gen eds course by course.
 *   iTransfer (itransfer.org/about/): the Illinois A.A. carries the full GECC,
 *     the A.S. a modified one that leaves one Humanities/Fine Arts and one
 *     Social/Behavioral course for after transfer; GECC areas by code
 *     (itransfer.org/courses/gecc/).
 *   McHenry County College's UIUC transfer guide: Advanced Composition,
 *     Cultural Studies, language and Quantitative Reasoning II are outside
 *     the package (the conservative reading; Illinois's pages do not list them).
 *
 * It fails on:
 *   - an IAI-coded line with a known area still labelled "not yet evaluated"
 *   - a completed GECC (or an Illinois A.A./A.S.) not recognised, or an
 *     unfinished one taken for complete
 *   - with the GECC complete: a course booked for Composition I, Humanities,
 *     Natural Sciences or Social & Behavioral Sciences; Advanced Composition,
 *     a Cultural Studies category or the second Quantitative Reasoning course
 *     left unplanned; a degree requirement that is planned without the GECC
 *     and unplanned with it; a degree hours block given less with it
 *   - a validator error the same record without the GECC does not have
 *
 *   node lib/planner/__gecc.check.mjs            (this checkout)
 *   node lib/planner/__gecc.check.mjs --root DIR (another checkout's code, for before/after; scores only)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { register } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..');
const PUBLIC = join(DATA, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const ROOT = resolve(arg('--root') ?? DATA);
const SCORE_ONLY = process.argv.includes('--root');
register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }`));
const lib = (f) => join(ROOT, 'lib', 'planner', f);
const { generatePlan, validatePlan } = await import(lib('autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups } = await import(lib('illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(lib('illinois-load.ts'));
const T = await import(lib('transcript.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const opt = (n) => (existsSync(join(PUBLIC, n)) ? read(n) : null);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

const meta = read('illinois/meta.json');
const rows = read('illinois/index.json').map(hydrateIndexRow);
const offeringsFile = opt('illinois/offerings.json');
if (offeringsFile) applyOfferings(rows, offeringsFile);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const creditsOf = (code) => byCode.get(norm(code))?.credits ?? 0;
const tagsOf = (code) => byCode.get(norm(code))?.tags ?? [];
const prereqs = new Map(Object.entries(read('illinois/prereqs.json')));
const exclusions = new Map(Object.entries(read('illinois/exclusions.json')));
const languagesFile = opt('illinois/languages.json');
const grades = new Map(); for (const g of read('illinois/grades.json')) grades.set(norm(g.code), toGradeRow(g, byCode.get(norm(g.code))?.title ?? g.code, []));
const equivalents = new Map(); for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map(); for (const c of rows) { const max = c.creditsMax ?? c.credits; creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true }); }
const context = { courses: rows, prereqs, grades, sections: new Map(), equivalents, exclusions, creditRanges, bands: meta.bands, offeringPublished: offeringsFile ? new Set(rows.map((c) => norm(c.code))) : new Set(), offerings: offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : undefined, offeringTerms: offeringsFile?.terms, offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined, languages: languagesFile ?? undefined, snapshotTerm: null, prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q) };
const catalog = rows.map((r) => ({ code: norm(r.code), title: r.title, credits: r.credits, level: r.level, cluster: r.cluster, tags: r.tags }));
const guide = read('illinois-transfer-gened.json');
const summaries = read('illinois/programs.json');
// Room to spare, so no requirement is squeezed out of a tight plan and every difference is the GECC's
// (a three-year plan for Finance + Data Science drops BUS 301 with or without the package, depending on order).
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: false };

// ---- made-up College of DuPage students -----------------------------------
const L = (code, title, credits, iai, extra = {}) => ({ code, title, credits, grade: 'A', term: 'Fall 2025', status: 'completed', iai, ...extra });
const fullLines = [
  L('ENGLI 1101', 'English Composition I', 3, 'C1 900'),
  L('ENGLI 1102', 'English Composition II', 3, 'C1 901R'),
  L('SPEEC 1100', 'Fundamentals of Speech Communication', 3, 'C2 900'),
  L('MATH 1635', 'Elementary Statistics', 4, 'M1 902'),
  L('LITER 1105', 'Introduction to Fiction', 3, 'H3 901'),
  L('HUMNT 1101', 'Western Humanities and Arts', 3, 'HF 902'),
  L('ARTHI 1101', 'Art of the Ancient World', 3, 'F2 901'),
  L('HISTO 2215', 'Modern Asia since 1800', 3, 'S2 921N'),
  L('BIOLO 1100', 'Biology in Society', 4, 'L1 900L'),
  L('EARTH 1101', 'Physical Geology', 4, 'P1 907L'),
  L('ANTHR 1100', 'Cultural Anthropology', 3, 'S1 901N'),
  L('POLSC 1100', 'American Politics and Government', 3, 'S5 900'),
  L('PSYCH 1100', 'Introduction to Psychology', 3, 'S6 900'),
];
const reading = (courses, credentials) => ({ institution: 'College of DuPage', kind: 'transcript', courses, exams: [], notes: [], credentials });
const students = {
  complete: reading(fullLines, ['Associate in Arts, May 2026', 'IAI GECC Completed']),
  // Most transcripts print no IAI codes: the same courses, an A.A. awarded.
  associateArtsNoCodes: reading(fullLines.map(({ iai, ...rest }) => rest), ['Associate in Arts']),
  incomplete: reading(fullLines.filter((l) => !/^(HUMNT|ARTHI|EARTH|POLSC)/.test(l.code)), []),
  inProgress: reading(fullLines.slice(0, 6), ['IAI GECC in progress']),
  associateScience: reading(fullLines, ['Associate in Science']),
  otherStateAA: { ...reading(fullLines.slice(0, 4), ['Associate in Arts']), institution: 'Georgia Perimeter College' },
};

let failures = 0;
const fail = (msg) => { failures += 1; console.log('  FAIL ' + msg); };
const records = Object.fromEntries(Object.entries(students).map(([k, r]) => [k, T.matchTranscript(r, `${k}.pdf`, catalog, [`${k}.pdf`], guide)]));

// ---- lines ----------------------------------------------------------------
const iaiLines = (rec) => rec.courses.filter((c) => c.iai);
const notEvaluated = (rec) => iaiLines(rec).filter((c) => c.use && c.basis?.badge === 'not-evaluated');
const known = new Set(Object.keys(guide.iai?.areas ?? {}));
const knownArea = (c) => known.has(String(c.iai).toUpperCase().match(/^(HF|LP|[CFHLMPS]\d)/)?.[1] ?? '');
console.log('IAI-coded lines (complete-GECC student):');
for (const c of iaiLines(records.complete)) console.log(`  ${c.code} [${c.iai}] -> ${c.counts}${c.matched ? ' ' + c.matched : ''} | ${c.basis?.badge ?? '-'} | ${(c.genEdTags ?? []).join(', ') || 'no category'}`);
for (const [name, rec] of Object.entries(records)) {
  const left = notEvaluated(rec).filter(knownArea);
  console.log(`${name}: ${notEvaluated(rec).length} IAI-coded lines "not yet evaluated" (${left.length} with a known IAI area), GECC: ${rec.gecc ? rec.gecc.kind : 'none'}`);
  if (!SCORE_ONLY) for (const c of left) fail(`${name}: ${c.code} (${c.iai}) still "not yet evaluated"`);
}
const want = { complete: 'gecc', associateArtsNoCodes: 'aa', incomplete: null, inProgress: null, associateScience: 'as', otherStateAA: null };
for (const [name, kind] of Object.entries(want)) {
  const got = records[name].gecc?.kind ?? null;
  if (!SCORE_ONLY && got !== kind) fail(`${name}: GECC recognised as ${got}, expected ${kind}`);
}
if (!SCORE_ONLY) {
  const line = (rec, code) => rec.courses.find((c) => c.code === code);
  const expectTags = { 'LITER 1105': 'Humanities - Lit & Arts', 'ARTHI 1101': 'Humanities - Lit & Arts', 'HISTO 2215': 'Humanities - Hist & Phil', 'BIOLO 1100': 'Nat Sci & Tech - Life Sciences', 'EARTH 1101': 'Nat Sci & Tech - Phys Sciences', 'ANTHR 1100': 'Social & Beh Sci - Soc Sci', 'POLSC 1100': 'Social & Beh Sci - Soc Sci' };
  for (const [code, tag] of Object.entries(expectTags)) {
    const c = line(records.complete, code);
    if (c?.counts === 'hours' && !(c.genEdTags ?? []).includes(tag)) fail(`${code}: expected ${tag}, got ${(c.genEdTags ?? []).join(', ') || 'none'}`);
  }
  const speech = line(records.complete, 'SPEEC 1100');
  if (speech?.counts === 'hours' && speech.basis?.badge !== 'elective') fail('SPEEC 1100 (C2 900): as hours it is elective hours (Illinois has no oral-communication gen ed)');
  if (line(records.complete, 'ENGLI 1101')?.matched !== 'RHET 105') fail('ENGLI 1101 + 1102 (C1 900 + C1 901R): expected Composition I (RHET 105)');
  const as = records.associateScience.gecc;
  if (as && (as.meets.find((m) => m.category === 'Humanities & the Arts')?.hours !== 3 || as.meets.find((m) => m.category === 'Social & Behavioral Sciences')?.hours !== 3)) fail('A.S.: Humanities and Social & Behavioral Sciences should count at half (one course each left)');
  const pkg = T.transcriptGenEdCredits(records.complete).filter((g) => g.package);
  if (pkg.some((g) => g.tags.some((t) => /Advanced Composition|Cultural Studies|Quantitative Reasoning II/.test(t)))) fail('the package must not stand in for Advanced Composition, Cultural Studies or Quantitative Reasoning II');
  if (pkg.some((g) => g.tags.includes('Quantitative Reasoning I'))) fail('the statistics line already meets Quantitative Reasoning I; the package must not add a second QR course');
  if (!records.complete.notes.some((n) => /Illinois Admissions says a completed GECC/.test(n))) fail('the record should say what the GECC meets and what is still planned');
}

// ---- plans ----------------------------------------------------------------
const plannable = summaries.filter((s) => existsSync(join(PUBLIC, 'illinois', 'program', `${s.id}.json`)) && s.totalCredits);
const byCollege = new Map();
for (const s of plannable) { const k = s.id.split('/')[0]; if (!byCollege.has(k)) byCollege.set(k, []); byCollege.get(k).push(s); }
const sample = [...byCollege.values()].flatMap((list) => list.filter((_, i) => i % Math.max(1, Math.ceil(list.length / 3)) === 0)).slice(0, 24);
for (const id of ['las/psychology-bslas', 'bus/finance-bs', 'bus/accountancy-bs', 'engineering/computer-science-bs', 'las/history-ba']) if (!sample.some((s) => s.id === id)) { const s = plannable.find((p) => p.id === id); if (s) sample.push(s); }
const load = (s) => adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [read(`illinois/program/${s.id}.json`)] }, new Map(byCode)).blocks.get(s.id) ?? [];
const plan = (rec, s, blocks) => {
  const codes = T.transcriptCodes(rec);
  const prior = { courseCodes: codes, exemptCodes: [], unmatchedCredits: T.transcriptHours(rec) + T.transcriptCreditAdjustment(rec), known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: T.transcriptGenEdCredits(rec) };
  const r = generatePlan({ requirements: blocks, context, prior, horizon: HORIZON, preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } }, programId: s.id, degreeTotal: s.totalCredits, programName: s.name, programCollege: s.college, residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'x' } });
  const errors = validatePlan(r.plan, context, { minimumTermCredits: 12, programName: s.name, programCollege: s.college, priorCredits: r.credits.prior }).filter((i) => i.severity === 'error').map((e) => e.title);
  return { r, board: r.terms.flatMap((t) => t.codes.map(norm)), held: new Set(codes.map(norm)), errors };
};
const COVERED = ['Composition I', 'Humanities - Hist & Phil', 'Humanities - Lit & Arts', 'Nat Sci & Tech - Phys Sciences', 'Nat Sci & Tech - Life Sciences', 'Social & Beh Sci - Soc Sci', 'Social & Beh Sci - Beh Sci'];
const isCovered = (b) => b.rule.kind === 'gened' && b.rule.genEd.length > 0 && b.rule.genEd.every((t) => COVERED.includes(t));
const bookedFor = (p, b) => Object.entries(p.r.bookedFor ?? {}).filter(([code, req]) => req === b.id && p.board.includes(norm(code)) && !new Set(b.rule.fulfilledBy.flat().map(norm)).has(norm(code))).map(([code]) => norm(code));
let genEdBefore = 0, genEdAfter = 0, termsBefore = 0, termsAfter = 0, hoursBefore = 0, hoursAfter = 0, plans = 0;
const has = (p, tag) => [...p.board, ...p.held].some((c) => tagsOf(c).includes(tag));
for (const s of sample) {
  const blocks = load(s);
  if (!blocks.some((b) => b.rule.kind === 'gened')) continue;
  for (const name of ['complete', 'associateArtsNoCodes']) {
    const withG = plan(records[name], s, blocks);
    const noG = plan({ ...records[name], gecc: null }, s, blocks);
    plans += 1;
    const problems = [];
    for (const b of blocks.filter(isCovered)) {
      genEdBefore += bookedFor(noG, b).length;
      const booked = bookedFor(withG, b);
      genEdAfter += booked.length;
      if (booked.length) problems.push(`books ${booked.join(', ')} for ${b.label} though the GECC meets it`);
    }
    termsBefore += noG.r.terms.filter((t) => t.codes.length).length;
    termsAfter += withG.r.terms.filter((t) => t.codes.length).length;
    hoursBefore += noG.board.reduce((sum, c) => sum + creditsOf(c), 0);
    hoursAfter += withG.board.reduce((sum, c) => sum + creditsOf(c), 0);
    // What the GECC does not cover stays exactly as planned without it.
    for (const tag of ['Advanced Composition', 'Cultural Studies - Non-West', 'Cultural Studies - US Minority', 'Cultural Studies - Western']) {
      if (!blocks.some((b) => b.rule.kind === 'gened' && b.rule.genEd.includes(tag))) continue;
      if (has(noG, tag) && !has(withG, tag)) problems.push(`${tag} planned without the GECC, not with it`);
    }
    // The package is the GECC's one mathematics course: Quantitative Reasoning
    // (two courses) always keeps at least one real course, held or planned.
    const qr = blocks.find((b) => b.rule.kind === 'gened' && b.rule.genEd.includes('Quantitative Reasoning II'));
    const pkgQr = T.transcriptGenEdCredits(records[name]).filter((g) => g.package && g.tags.some((t) => /Quantitative Reasoning/.test(t))).length;
    if (qr && (pkgQr > 1 || ![...withG.board, ...withG.held].some((c) => tagsOf(c).some((t) => /Quantitative Reasoning/.test(t))))) problems.push('Quantitative Reasoning met by the package alone');
    // Degree requirements outside the campus gen-ed table: never lost to the package.
    const missed = (p) => new Set(p.r.unsatisfied.map((u) => u.requirementId));
    const before = missed(noG), after = missed(withG);
    for (const b of blocks) {
      if (b.rule.kind === 'gened') continue;
      if (after.has(b.id) && !before.has(b.id)) problems.push(`${b.label}: planned without the GECC, not with it`);
      if (b.rule.kind === 'hours') {
        const hrs = (p) => Object.entries(p.r.bookedFor ?? {}).filter(([code, req]) => req === b.id && p.board.includes(norm(code))).reduce((sum, [code]) => sum + creditsOf(code), 0);
        if (hrs(withG) < hrs(noG)) problems.push(`${b.label}: ${hrs(withG)} hours booked with the GECC, ${hrs(noG)} without (the package must not fill a degree hours block)`);
      }
    }
    for (const e of withG.errors) if (!noG.errors.includes(e)) problems.push(`validator: ${e}`);
    if (process.env.GECC_SHOW === s.id) {
      for (const [label, p] of [['without', noG], ['with', withG]]) {
        console.log(`--- ${name} ${label} GECC: ${s.id}`);
        for (const t of p.r.terms) console.log(`  ${t.label}: ${t.codes.map((c) => `${c}${tagsOf(c).length ? '[' + tagsOf(c).map((x) => x.replace(/[^A-Z]/g, '')).join('/') + ']' : ''}->${p.r.bookedFor?.[c] ?? '?'}`).join(', ')}`);
        console.log("  satisfied by prior credit:", p.r.satisfiedByPriorCredit.map((x) => `${x.label}: ${x.codes.join(", ")}`).join(" | "));
        console.log("  unsatisfied:", p.r.unsatisfied.map((u) => `${u.requirementId} ${u.label}: ${u.message}`).join(' | '));
      }
      for (const b of blocks.filter((x) => x.rule.kind === 'gened')) console.log('  gened block', b.id, b.label, JSON.stringify(b.rule.genEd), b.rule.hours, b.rule.courses, JSON.stringify(b.rule.fulfilledBy));
    }
    if (!SCORE_ONLY) for (const p of problems.slice(0, 4)) fail(`${name} / ${s.id}: ${p}`);
  }
}
console.log(`\n${plans} plans (${plans / 2} degrees x 2 made-up DuPage students with the GECC complete, IAI codes printed and not):`);
console.log(`  courses booked for Composition I / Humanities / Natural Sciences / Social & Behavioral Sciences: ${genEdBefore} without the GECC recognised -> ${genEdAfter} with it`);
console.log(`  hours booked: ${hoursBefore} -> ${hoursAfter}; terms with courses: ${termsBefore} -> ${termsAfter}`);
console.log(failures ? `\n${failures} FAIL(S)` : '\nall GECC checks pass');
process.exit(failures && !SCORE_ONLY ? 1 : 0);
