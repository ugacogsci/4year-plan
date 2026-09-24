/**
 * The advisor packet, built and rendered for real students.
 *
 * Run it with:  PATH="/opt/homebrew/bin:$PATH" node lib/planner/__advisor-packet.check.mjs
 * It re-execs itself with the type-stripping flag. Exits non-zero on any failure.
 *
 * The plan menu's only export was "Download as JSON", which no advisor opens,
 * so a student arrived at a fifteen-minute meeting with a laptop and read the
 * board aloud. "Print for my advisor" now opens a packet built by
 * buildAdvisorPacket (lib/planner/advisor-packet.ts) and laid out by
 * AdvisorPacketSheet (components/planner/advisor-packet.tsx). This check
 * builds the packet the way the workspace does, over the files the browser
 * loads (public/illinois/*), for:
 *
 *   - Emma, a Psychology freshman going to medical school, with AP Psychology
 *     and AP Calculus AB, who has not said how much language she took;
 *   - Jordan, a Parkland transfer into Psychology, whose record the catalog's
 *     titles match to nine Illinois courses it has not confirmed, with five
 *     more lines counted as hours and a course still to settle;
 *   - Priya, a Chemistry freshman, whose board carries nine review flags of
 *     its own;
 *   - Sam, a continuing Psychology student whose own record has PSYC 100 in
 *     progress and CMN 101 recorded on his word alone;
 *   - Emma's board edited to 19 credits in one term and 9 in another, with a
 *     semester abroad and SPAN 203 moved ahead of SPAN 201;
 *
 * and fails when any likely equivalent, open transcript line, review flag or
 * review note is missing from the rendered page; when one of next term's
 * planner picks has no backup though one exists, two picks share one, or a
 * backup is on the board already, for other students (Emma's LAS 100 was
 * backed by LAS 102, "for first-term LAS transfer students only") or behind
 * a placement result (her RHET 105 by ESL 115); when a card's role differs
 * from the board's; when the language placement is said twice, not at all,
 * or asked about when the level rests on a course rather than on high school
 * years; when a review title reads "null: Core Chemistry"; or when the
 * overload, the underload, the abroad approval and the prerequisite error
 * are not among the questions. The page's length is estimated from the
 * print stylesheet's sizes and has to stay near two letter pages.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

// PACKET_DUMP=<dir> writes each rendered page there as HTML, to read by eye.
const DUMP = process.env.PACKET_DUMP ?? null;
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

// Extensionless and '@/' imports as the app writes them, and .tsx through the
// repo's own TypeScript, so the page itself can be rendered to a string.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
let ts = null;
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
    for (const ext of ['.ts', '.tsx']) {
      try { return await next(spec + ext, ctx); } catch {}
    }
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.endsWith('.tsx')) return next(url, ctx);
  ts ??= (await import(ROOT + 'node_modules/typescript/lib/typescript.js')).default;
  const out = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  return { format: 'module', source: out.outputText, shortCircuit: true };
}`),
);

const A = await import(join(HERE, 'autoplan.ts'));
const R = await import(join(HERE, 'repick.ts'));
const P = await import(join(HERE, 'advisor-packet.ts'));
const T = await import(join(HERE, 'transcript.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { livePools, poolShortfalls } = await import(join(ROOT, 'components/planner/live-pools.ts'));
const X = await import(join(ROOT, 'components/planner/exam-credit.ts'));
const { groupIssues, reviewTitle } = await import(join(ROOT, "components/planner/plan-health.tsx"));
const { AdvisorPacketSheet } = await import(join(ROOT, 'components/planner/advisor-packet.tsx'));
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

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
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const summaries = pub('illinois/programs.json');
const catalogLite = rows.map((r) => ({ code: norm(r.code), title: r.title, credits: r.credits, level: r.level, cluster: r.cluster, tags: r.tags }));
const guide = pub('illinois-transfer-gened.json');
const examTable = pub('illinois-exam-credit.json').entries;
const creditsOf = (code) => byCode.get(norm(code))?.credits ?? null;

function load(programId) {
  const summary = summaries.find((p) => p.id === programId);
  if (!summary) throw new Error(`no program ${programId}`);
  for (const r of rows) {
    r.requirementIds = [];
    delete r.pathwayRole;
  }
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${summary.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(summary.id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  return { summary, program: adapted.programs[0], blocks };
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL ${msg}`);
};
const ok = (msg) => console.log(`  ok   ${msg}`);

// --- the students ------------------------------------------------------------
// Jordan's Parkland transcript, as the reader returned it (trimmed to the
// lines that matter): nine lines the catalog's titles match with high
// confidence, which count as those courses until the evaluation report says
// otherwise, and five the Parkland guide places in gen-ed categories, which
// count as hours with a likely course to settle.
const line = (code, title, credits, term, status = 'completed', grade = 'A') => ({ code, title, credits, grade, term, status, from: null, equivalent: null, equivalentCredits: null, iai: null, genEdText: null });
const JORDAN_READING = {
  institution: 'Parkland College',
  kind: 'transcript',
  hoursUnit: null,
  exams: [],
  notes: [],
  courses: [
    line('MAT 086', 'Intermediate Algebra (developmental)', 4, 'Fall 2025', 'no_credit'),
    line('ENG 101', 'Composition I', 3, 'Fall 2025'),
    line('PSY 101', 'Introduction to Psychology', 3, 'Fall 2025'),
    line('SPA 101', 'Beginning Spanish I', 4, 'Fall 2025'),
    line('ENG 102', 'Composition II', 3, 'Spring 2026'),
    line('MAT 160', 'Statistics', 4, 'Spring 2026'),
    line('SPA 102', 'Beginning Spanish II', 4, 'Spring 2026'),
    line('SOC 101', 'Introduction to Sociology', 3, 'Spring 2026'),
    line('PSY 209', 'Human Growth and Development', 3, 'Spring 2026'),
    line('ECO 102', 'Principles of Microeconomics', 3, 'Spring 2026', 'withdrawn', 'W'),
    line('HUM 101', 'Western Culture: Antiquity to Renaissance', 3, 'Summer 2026'),
    line('AST 101', 'The Solar System (repeat)', 4, 'Summer 2026'),
    line('SPA 103', 'Intermediate Spanish I', 4, 'Fall 2026', 'in_progress', null),
    line('PHI 103', 'Intro to Philosophy', 3, 'Fall 2026', 'in_progress', null),
    line('ANT 103', 'Intro to Cultural Anthropology', 3, 'Fall 2026', 'in_progress', null),
    line('LIT 121', 'Intro to Poetry', 3, 'Fall 2026', 'in_progress', null),
    line('PSY 205', 'Intro to Social Psychology', 3, 'Fall 2026', 'in_progress', null),
  ],
};

const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: false };
const STUDENTS = [
  {
    name: 'Emma, Psychology freshman, pre-med, AP Psychology and Calculus AB',
    program: 'las/psychology-bslas',
    studying: 'Psychology, pre-med.',
    career: 'I want to go to medical school so I need to keep my GPA up.',
    exams: [{ kind: 'AP', exam: 'Psychology', score: '5' }, { kind: 'AP', exam: 'Calculus AB', score: '4' }],
    languageYears: null,
    language: null,
    horizon: FOUR_YEARS,
  },
  {
    name: 'Jordan, Parkland transfer into Psychology',
    program: 'las/psychology-bslas',
    studying: 'Psychology in LAS, interested in clinical and counseling.',
    career: 'clinical and counseling',
    reading: JORDAN_READING,
    languageYears: 2,
    language: 'Spanish',
    // The Fall 2026 lines are in progress, so the plan starts the spring after.
    horizon: { startSeason: 'Spring', startYear: 2027, gradSeason: 'Spring', gradYear: 2029, stated: true },
  },
];

const SEVERITY_BY_REASON = { 'not-parsed': 'info', 'filled-by-electives': 'info', 'no-course-data': 'warning', excluded: 'warning', 'constraint-unmet': 'warning', 'no-candidates': 'error', 'hours-short': 'error', 'did-not-fit': 'error' };

/** A student's board and everything the workspace hands buildAdvisorPacket. */
function build(st, shape = {}) {
  const L = load(st.program);
  const matched = st.reading ? T.matchTranscript(st.reading, 'record.pdf', catalogLite, ['record.pdf'], guide) : null;
  // Lines recorded later, the way ALMA's record_prior_credit adds them.
  const record = matched && st.added ? { ...matched, courses: [...matched.courses, ...st.added] } : matched;
  const exams = X.alignExamsToCollege(X.matchDocumentExams(st.exams ?? [], examTable, false), examTable, false).exams;
  const known = (c) => byCode.has(norm(c));
  const examCodes = X.examCourses(exams, examTable, known);
  const hours = X.examElectiveHours(exams, examTable, T.transcriptIndirectCodes(record), creditsOf) + T.transcriptHours(record) + T.transcriptCreditAdjustment(record);
  const prior = {
    courseCodes: [...new Set([...examCodes, ...T.transcriptCodes(record)])],
    exemptCodes: [],
    unmatchedCredits: hours,
    known: true,
    languageSemesters: st.languageYears,
    languageName: st.language,
    genEdCredits: [...T.transcriptGenEdCredits(record), ...X.examGenEdCredits(exams, examTable, creditsOf)],
  };
  const interests = [st.studying, st.career].join(' ');
  const degreeTotal = L.summary.totalCredits || L.program.totalCredits || 120;
  const g = A.generatePlan({
    requirements: L.blocks,
    context,
    prior,
    horizon: { ...st.horizon, ...(shape.away ? { away: shape.away } : {}) },
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId: L.summary.id,
    degreeTotal,
    interests,
    career: st.career,
    programName: L.program.name,
    programCollege: L.program.college,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: T.transcriptResidentHours(record).total, heldUpper: T.transcriptResidentHours(record).upper, source: 'https://admissions.illinois.edu/transferring-credit/' },
  });
  const board = shape.edit ? shape.edit(g.plan) : g.plan;
  const codesOn = (b) => b.terms.flatMap((t) => t.courseIds).map((id) => norm(byId.get(id)?.code ?? ''));
  const heldCodes = board.completedCourseIds.map((id) => norm(byId.get(id)?.code ?? ''));
  const priorCredits = A.planCreditRange(heldCodes, context).min + hours;
  const pools = livePools({ base: g.pools, blocks: L.blocks, boardCodes: codesOn(board), priorCodes: heldCodes, context });
  const marks = R.planMarks({ pools, language: g.language, electives: g.electives, genEdPicks: g.genEdPicks ?? [], addedPrerequisites: g.addedPrerequisites }, byCode);
  const scorer = A.qualityScorer({ context, requirements: L.blocks, interests, career: st.career, programName: L.program.name, priorities: PRIORITY_PRESETS.balanced, carriedCodes: [...codesOn(board), ...heldCodes] });
  const validateOptions = { minimumTermCredits: 12, maxTermCredits: 18, programName: L.program.name, programCollege: L.program.college, priorCredits, away: g.away };

  /**
   * The card dropdown's runners-up, as the workspace's alternativesFor ranks
   * them: the elective chooser for a slot, the same-category candidates that
   * pass the whole-board check for a gen ed pick, and the rest of the list,
   * best first, that passes the placement check for a list card.
   */
  const alternatives = (courseId, termId) => {
    const mark = marks.get(courseId);
    if (!mark) return [];
    if (mark.kind === 'gened') {
      const check = R.boardChecker({ context, board, requirements: L.blocks, minimumTermCredits: 12, priorCredits, degreeTotal, programName: L.program.name, programCollege: L.program.college });
      const me = byId.get(courseId);
      const out = [];
      let tries = 0;
      for (const { course, q, categories } of R.genEdCandidates({ context, requirements: L.blocks, board, courseId, scorer })) {
        if (out.length >= 7 || tries >= 28) break;
        tries += 1;
        const candidate = { ...board, terms: board.terms.map((t) => (t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === courseId ? course.id : id)) } : t)) };
        if (check(candidate, board, termId, course, me) !== null) continue;
        out.push({ course, why: R.genEdWhy(q, categories) });
      }
      return out;
    }
    if (mark.kind === 'elective') {
      const electiveCodes = board.terms.flatMap((t) => t.courseIds).filter((id) => ['elective', 'track'].includes(marks.get(id)?.kind ?? '')).map((id) => byId.get(id)?.code ?? '');
      return A.electiveOptions({ context, requirements: L.blocks, plan: board, termId, prior, interests, career: st.career, programName: L.program.name, programCollege: L.program.college, priorities: PRIORITY_PRESETS.balanced, electiveCodes, limit: 7 })
        .map((o) => ({ course: byCode.get(norm(o.code)), why: o.reasons.length > 0 ? o.reasons.slice(0, 2).join('; ') : o.why }))
        .filter((a) => a.course);
    }
    if (mark.kind !== 'pool') return [];
    const pool = pools.find((p) => p.picked.some((code) => byCode.get(norm(code))?.id === courseId));
    if (!pool) return [];
    const onBoard = new Set(board.terms.flatMap((t) => t.courseIds));
    const out = [];
    for (const c of pool.alternatives.map((code) => byCode.get(norm(code))).filter((c) => c && !onBoard.has(c.id) && !board.completedCourseIds.includes(c.id)).sort((a, b) => scorer(norm(b.code)).score - scorer(norm(a.code)).score)) {
      if (out.length >= 7) break;
      const candidate = { ...board, terms: board.terms.map((t) => (t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === courseId ? c.id : id)) } : t)) };
      const mine = A.validatePlan(candidate, context, validateOptions).filter((i) => i.courseId === c.id && i.termId === termId);
      const blocked = mine.some((i) => (/^ap-(prereq-(?!check)|standing-|exclusion-|duplicate-)/.test(i.id) && i.severity !== 'info') || i.id.startsWith('ap-exclusion-'));
      const term = candidate.terms.find((t) => t.id === termId);
      if (blocked || A.planCreditRange(term.courseIds.map((id) => byId.get(id)?.code), context).min > 18) continue;
      const q = scorer(norm(c.code));
      out.push({ course: c, why: q.reasons.length > 0 ? q.reasons.slice(0, 2).join('; ') : `On the list ${pool.label}.` });
    }
    return out;
  };

  // The review list the chip shows: the generation's shortfalls and the validator's rows.
  const poolIds = new Set(g.pools.map((p) => p.requirementId));
  const firstTerm = board.terms[0]?.id ?? '';
  const issues = [
    ...(g.residency && !g.residency.ok ? [{ id: 'residency', severity: 'warning', title: 'Residency: hours that must be taken at Illinois', message: g.residency.shortfall ?? '', termId: firstTerm }] : []),
    ...[...g.unsatisfied.filter((u) => !poolIds.has(u.requirementId)), ...poolShortfalls(pools)].map((u) => ({
      id: `unmet-${u.requirementId}-${u.reason}`,
      severity: SEVERITY_BY_REASON[u.reason] ?? 'error',
      title: reviewTitle(u.areaLabel, u.label),
      message: u.message,
      termId: firstTerm,
    })),
    ...g.notPlaced.map((n) => ({ id: `notplaced-${n.code}`, severity: 'warning', title: `${n.code} left out`, message: n.message, termId: firstTerm })),
    ...A.validatePlan(board, context, { minimumTermCredits: 12, programName: L.program.name, programCollege: L.program.college, priorCredits, away: g.away }),
  ];
  const grouped = groupIssues(issues);
  const credits = (() => {
    const planned = A.planCreditRange(codesOn(board), context);
    const away = (g.away ?? []).reduce((n, a) => n + a.credits, 0);
    return { planned, prior: priorCredits, ...(away ? { away } : {}), total: { ...planned, min: planned.min + priorCredits + away, max: planned.max + priorCredits + away }, degreeTotal, unaccounted: null };
  })();
  const shown = new Set([...T.transcriptCodes(record), ...examCodes].map(norm));
  const input = {
    school: { id: 'illinois', name: 'University of Illinois', short: 'Illinois', audit: 'uAchieve degree audit' },
    program: { name: L.program.name, college: L.program.college, url: L.summary.url, total: degreeTotal, totalPublished: Boolean(L.summary.totalCredits || L.program.totalCredits) },
    board,
    courseById: (id) => byId.get(id),
    context,
    marks,
    blocks: L.blocks,
    bookedFor: g.bookedFor ?? {},
    studentAdded: new Set(),
    creditsLine: A.describeCreditProgress(credits, degreeTotal),
    hoursWithoutCourse: hours,
    goal: st.career,
    language: g.language,
    languageYears: st.languageYears,
    transcript: record,
    exams: exams.map((e) => {
      const codes = X.examCourses([e], examTable, known);
      const h = X.examElectiveHours([e], examTable, T.transcriptIndirectCodes(record), creditsOf);
      return { name: `${e.kind} ${e.exam.replace(/\s+-\s+Entering.*$/, '')}, score ${e.score}`, grants: [codes.join(', '), h > 0 ? `${h} elective hours` : ''].filter(Boolean).join(' and ') };
    }),
    enteredCodes: heldCodes.filter((c) => !shown.has(c)),
    away: g.away ?? [],
    residency: g.residency ?? null,
    admission: null,
    flags: grouped.map((x) => ({ severity: x.severity, title: x.title, message: x.message, count: x.count })),
    caveats: [...g.notes, 'Prerequisites are parsed from catalog sentences. Anything about placement or consent is not checked here.'],
    alternatives,
    madeOn: 'September 24, 2026',
  };
  return { st, L, g, board, record, exams, grouped, marks, input };
}

/**
 * About how tall the printed page runs, in letter pages, from the print
 * stylesheet's sizes (app/globals.css): 8.5pt serif at 1.25 leading over a
 * 7.5 by 10 inch area, the board in two columns, small type at 7 to 7.5pt.
 * An estimate for a check, not a browser's layout.
 */
function printedPages(packet) {
  const lines = (text, perLine) => Math.max(1, Math.ceil(String(text).length / perLine));
  const BODY = 10.6; // 8.5pt at 1.25
  const SMALL = 9.4; // 7.5pt at 1.25
  let pt = 0;
  // Header: kicker, title, facts, the blanks, the unofficial line.
  pt += 10 + 19 + [packet.finish, packet.credits, packet.goal, packet.held].filter(Boolean).reduce((n, f) => n + lines(f, 105) * BODY, 0) + 22 + lines(packet.unofficial, 110) * BODY + 6;
  // The board: two terms a row, each course a line and its role line.
  pt += 16 + 2 * SMALL;
  const termHeight = (t) => 16 + (t.away ? SMALL * 2 : 0) + (t.load ? SMALL : 0) + t.courses.reduce((n, c) => n + lines(`${c.code} ${c.title} ${c.credits}`, 60) * BODY + lines(`${c.role} ${c.fills}`, 72) * 8.75 + 1.5, 0);
  for (let i = 0; i < packet.terms.length; i += 2) pt += Math.max(termHeight(packet.terms[i]), packet.terms[i + 1] ? termHeight(packet.terms[i + 1]) : 0) + 6;
  // Next term: a table row per planner pick, as tall as its tallest cell, and
  // one full-width row naming the courses the plan needs as they are.
  if (packet.next) {
    pt += 16 + 12;
    for (const c of packet.next.courses.filter((x) => x.chosen)) {
      const cells = [lines(`${c.code} ${c.title} ${c.credits}`, 42), lines(`${c.role} ${c.fills}`, 40), c.backup ? lines(`${c.backup.code} ${c.backup.title} ${c.backup.credits}`, 40) + lines(c.backup.why, 40) : 3];
      pt += Math.max(...cells) * 10 + 6;
    }
    const needed = packet.next.courses.filter((x) => !x.chosen);
    if (needed.length > 0) pt += (lines(needed.map((c) => `${c.code} ${c.title} ${c.credits} ${c.role}`).join('; '), 115) + 2) * 10 + 6;
  }
  pt += 16;
  for (const a of packet.assumptions) pt += lines(a.heading, 115) * BODY + a.items.reduce((n, it) => n + lines(it, 128) * SMALL, 0) + (a.source ? SMALL : 0) + 5;
  pt += 16 + [...packet.flags, ...packet.notes].reduce((n, f) => n + lines(`${f.title} ${f.message}`, 125) * SMALL + 4, 0) + (packet.notes.length ? 18 : 0);
  pt += 16 + packet.questions.reduce((n, q) => n + lines(q.text, 110) * BODY + (q.who || q.source ? lines(`${q.who ?? ''} ${q.source ?? ''}`, 125) * SMALL : 0) + 4, 0) + 40;
  if (packet.plannerNotes.length) pt += 16 + packet.plannerNotes.reduce((n, x) => n + lines(x, 128) * SMALL, 0);
  pt += 10 + 2 * SMALL;
  return pt / 720;
}

const ROLES = new Set(['required', 'from a list', 'elective slot', 'career track', 'language', 'gen ed pick', 'prerequisite', 'added']);
/** A prerequisite that is only a test result or permission, as the ranker reads one. */
const gatedSpec = (code) => {
  const spec = context.prereqs.get(norm(code));
  return Boolean(spec && !spec.parsed && /placement|proficiency (test|exam)|by permission|consent of/i.test(spec.text));
};
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// --- the plan menu offers the packet and keeps the JSON ------------------------
{
  console.log('The plan menu:');
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  const menu = src.slice(src.indexOf('<DropdownMenuContent align="end"'), src.indexOf('</DropdownMenuContent>', src.indexOf('<DropdownMenuContent align="end"')));
  if (/Print for my advisor/.test(menu)) ok('offers "Print for my advisor"');
  else fail('the plan menu does not offer "Print for my advisor"; its only export is still JSON');
  if (/Download as JSON/.test(menu)) ok('keeps "Download as JSON"');
  else fail('the JSON download is gone from the plan menu');
}


// --- what every packet has to say ------------------------------------------------
/**
 * Build the packet for one board and hold it to everything above. `expect`
 * says what the case exists to exercise, so a data change that quietly stops
 * exercising it (no likely equivalents left, no picks next term, no flags)
 * fails instead of passing on nothing.
 */
function audit(label, b, expect = {}) {
  const { g, board, record, marks, input } = b;
  const before = JSON.stringify(board);
  const t0 = Date.now();
  const packet = P.buildAdvisorPacket(input);
  const ms = Date.now() - t0;
  const html = renderToStaticMarkup(createElement(AdvisorPacketSheet, { packet }));
  if (DUMP) writeFileSync(join(DUMP, `${label.split(/[,:]/)[0].replace(/\W+/g, '-').toLowerCase()}.html`), html);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const has = (s) => html.includes(escapeHtml(s));
  console.log(`\n${label}: ${board.terms.length} terms, ${packet.flags.length} review flags, ${packet.notes.length} notes, ${packet.assumptions.length} assumption groups, ${packet.questions.length} questions; built in ${ms} ms, ~${printedPages(packet).toFixed(2)} printed pages`);

  if (JSON.stringify(board) !== before) fail('building the packet changed the board');

  // Every course on the board is on the page once, wearing the board's role.
  const onPage = packet.terms.flatMap((t) => t.courses);
  const onBoard = board.terms.flatMap((t) => t.courseIds.map((id) => byId.get(id)));
  if (onPage.length !== onBoard.length) fail(`the page lists ${onPage.length} courses and the board holds ${onBoard.length}`);
  for (const c of onBoard) {
    const row = onPage.find((x) => x.code === c.code);
    const role = P.cardRole(c, { marks, bookedFor: g.bookedFor, blocks: b.L.blocks, studentAdded: new Set() });
    if (!row) fail(`${c.code} is on the board and not on the page`);
    else if (row.role !== role) fail(`${c.code} reads "${row.role}" on the page and "${role}" on the board`);
    else if (!ROLES.has(row.role)) fail(`${c.code} wears a role the board never uses: ${row.role}`);
    else if (!row.fills) fail(`${c.code} says nothing about what it counts for`);
    else if (!has(c.code)) fail(`${c.code} is not on the rendered page`);
  }
  const roles = [...new Set(onPage.map((c) => c.role))];
  for (const role of roles) if (!has(role)) fail(`the rendered page never prints the role "${role}"`);
  console.log(`  roles on the page: ${roles.map((r) => `${r} ${onPage.filter((c) => c.role === r).length}`).join(', ')}`);

  // Every likely equivalent, every open line.
  const likely = (record?.courses ?? []).filter((c) => c.use && c.counts === 'course' && c.matchedBy === 'proposal');
  const likelyItems = packet.assumptions.find((a) => a.kind === 'likely-equivalent')?.items ?? [];
  for (const c of likely) {
    const item = likelyItems.find((it) => it.startsWith(`${c.code} `) && it.includes(` as ${c.matched}`));
    if (!item) fail(`likely equivalent ${c.code} as ${c.matched} is not among the assumptions`);
    else if (!has(item)) fail(`likely equivalent "${item}" is not on the rendered page`);
  }
  if (likely.length > 0) {
    const transferQ = packet.questions.find((q) => q.topic === 'transfer');
    const missing = likely.filter((c) => !transferQ?.text.includes(`${c.code} as ${c.matched}`));
    if (missing.length) fail(`the transfer question leaves out ${missing.map((c) => c.code).join(', ')}`);
    else ok(`all ${likely.length} likely equivalents are assumptions and in the transfer question`);
  }
  if (expect.likely && likely.length < expect.likely) fail(`the record matched ${likely.length} likely equivalents, expected at least ${expect.likely}; the case no longer exercises them`);
  const open = T.transcriptOpenLines(record);
  const openItems = packet.assumptions.find((a) => a.kind === 'open-line')?.items ?? [];
  for (const c of open) {
    const item = openItems.find((it) => it.startsWith(`${c.code} `));
    if (!item) fail(`open line ${c.code} is not among the assumptions`);
    else if (c.proposals?.[0] && !item.includes(`likely ${c.proposals[0].code}`)) fail(`open line ${c.code} does not name its likely course ${c.proposals[0].code}`);
    else if (!has(item)) fail(`open line "${item}" is not on the rendered page`);
  }
  if (open.length > 0 && openItems.length === open.length) ok(`all ${open.length} open lines are assumptions, each with its likely course`);
  if (expect.open && open.length < expect.open) fail(`the record has ${open.length} open lines, expected at least ${expect.open}`);

  // Every review flag, and every note on the review list.
  const flags = b.grouped.filter((x) => x.severity !== 'info');
  for (const f of flags) {
    if (!packet.flags.some((p) => p.title === f.title && p.message === f.message && p.count === f.count)) fail(`review flag "${f.title}" is not in the packet`);
    else if (!has(f.title.replace(/:\s*$/, "")) || !has(f.message)) fail(`review flag "${f.title}" is not on the rendered page`);
  }
  for (const f of b.grouped.filter((x) => x.severity === 'info')) {
    const printed = packet.notes.some((p) => p.title === f.title && p.message === f.message) && has(f.message);
    if (P.SCREEN_ONLY_NOTES.has(f.title)) {
      if (printed) fail(`screen-only note "${f.title}" is on the page`);
    } else if (!printed) fail(`review note "${f.title}" is missing from the page`);
  }
  if (/::/.test(text)) fail('a title ending in a colon prints "::"');
  for (const f of [...packet.flags, ...packet.notes]) if (/\b(null|undefined)\b/.test(f.title)) fail(`a review title reads "${f.title}"`);
  // Priya's Chemistry rows printed "null: Core Chemistry" 22 times: an area
  // the degree page gives no heading has a null label.
  const broken = text.match(/.{0,40}\b(null|undefined|NaN)\b.{0,40}/);
  if (broken) fail(`the page prints "${broken[0].trim()}"`);
  if (packet.flags.length !== flags.length) fail(`the packet holds ${packet.flags.length} review flags and the review list ${flags.length}`);
  if (expect.flags && flags.length < expect.flags) fail(`the review list has ${flags.length} flags, expected at least ${expect.flags}; the case no longer exercises them`);
  ok(`${flags.length} review flags (${flags.filter((f) => f.severity === "error").length} errors) and ${packet.notes.length} notes on the page; ${b.grouped.length - flags.length - packet.notes.length} screen-only notes left off`);
  if (flags.some((f) => f.severity === 'error') && !packet.questions.some((q) => q.topic === 'errors')) fail('the plan has errors and no question asks what to do about them');

  // Next term: one backup for each of the planner's picks, none shared, none
  // already on the board or held, none the student cannot simply register for.
  const next = packet.next;
  if (!next) fail('the packet has no next term');
  else {
    const picks = next.courses.filter((c) => c.chosen);
    const backups = picks.map((c) => c.backup?.code).filter(Boolean);
    const everywhereIds = new Set([...board.terms.flatMap((t) => t.courseIds), ...board.completedCourseIds]);
    const everywhere = new Set([...everywhereIds].map((id) => byId.get(id)?.code));
    const firstTerm = board.terms.find((t) => t.label === next.label);
    for (const c of picks) {
      if (c.backup) {
        if (!has(c.backup.code) || !has(c.backup.why)) fail(`${c.code}'s backup ${c.backup.code} is not on the rendered page`);
        continue;
      }
      // An elective slot can be filled from the whole catalog; it always has one.
      if (c.role === 'elective slot') {
        fail(`elective slot ${c.code} in ${next.label} has no backup`);
        continue;
      }
      // No backup is right only when the dropdown offers nothing a student
      // can register for: RHET 105's other routes to Composition I are half
      // of a two-course sequence or need a placement result.
      const offered = input.alternatives(byCode.get(norm(c.code)).id, firstTerm.id).filter((a) => !everywhereIds.has(a.course.id) && !R.restrictedToOthers(a.course, context, { programName: b.L.program.name, programCollege: b.L.program.college }) && !gatedSpec(a.course.code));
      if (offered.length > 0) fail(`${c.code} (${c.role}) in ${next.label} has no backup, though ${offered.map((a) => a.course.code).join(', ')} could be one`);
      else if (!/No other course you can register for takes its place/.test(text)) fail(`${c.code} has no backup and the page does not say so`);
      else ok(`${c.code} (${c.role}): nothing registrable can take its place, and the page says to take another section`);
    }
    if (new Set(backups).size !== backups.length) fail(`two picks share a backup: ${backups.join(', ')}`);
    for (const code of backups) {
      const course = byCode.get(norm(code));
      if (everywhere.has(code)) fail(`backup ${code} is already on the board or held`);
      const closed = R.restrictedToOthers(course, context, { programName: b.L.program.name, programCollege: b.L.program.college });
      if (closed) fail(`backup ${code} is for other students: ${closed}`);
      if (gatedSpec(code)) fail(`backup ${code} needs a test result or permission: "${context.prereqs.get(norm(code)).text}"`);
    }
    for (const c of next.courses.filter((x) => !x.chosen)) if (c.backup) fail(`${c.code} (${c.role}) got a backup; only the planner's picks should`);
    for (const [pick, not] of Object.entries(expect.notBackup ?? {})) {
      const row = next.courses.find((c) => c.code === pick);
      if (row?.backup?.code === not) fail(`${pick}'s backup is ${not} again`);
    }
    const elective = picks.filter((c) => c.role === 'elective slot').length;
    console.log(`  ${next.label}: ${next.courses.map((c) => `${c.code} [${c.role}]${c.backup ? ` -> ${c.backup.code}` : ''}`).join('; ')}`);
    if (expect.picks && picks.length < expect.picks) fail(`${next.label} holds ${picks.length} of the planner's picks, expected at least ${expect.picks}; the case no longer exercises backups`);
    if (picks.length > 0) ok(`${backups.length} of ${picks.length} planner picks in ${next.label} (${elective} elective slots) have their own backup, each one a student can register for`);
  }

  // Language: said once, as an assumption, and not again in the planner's notes.
  if (g.language) {
    const lang = packet.assumptions.filter((a) => a.kind === 'language');
    const said = lang.flatMap((a) => a.items).filter((it) => it.includes(`of ${g.language.name}`) && /semester/.test(it));
    if (lang.length !== 1 || said.length !== 1) fail(`the language placement is said ${said.length} times in ${lang.length} groups`);
    if (packet.plannerNotes.some((n) => /^Language: |language other than English you took in high school/.test(n))) fail('the language note is repeated under "Also from the planner"');
    // The placement test is the question only when the starting semester
    // rests on high school years. Jordan starts at SPAN 203 because Parkland's
    // SPA 103 reads as SPAN 201; his question is whether that counts.
    const years = b.st.languageYears ?? (g.language.from === 'assumed' ? 2 : 0);
    const fromSchool = g.language.completed > 0 && g.language.from !== 'college' && g.language.completed <= years;
    const asked = packet.questions.some((q) => q.topic === 'language');
    if (fromSchool !== asked) fail(`the placement test is ${asked ? '' : 'not '}asked about, and the plan's level ${fromSchool ? 'rests' : 'does not rest'} on high school years`);
    if (fromSchool !== /placement test decides/.test(said[0] ?? '')) fail(`the language line gets the placement test wrong: ${said[0]}`);
    if (b.st.languageYears === null && g.language.from === 'assumed' && !said[0]?.includes('you have not said')) fail(`an assumed language background is not said to be assumed: ${said[0]}`);
    if (said.length === 1) ok(`language: ${said[0].slice(0, 120)}...`);
  }

  // Every assumption on the page; exams listed one by one; the offering estimate said.
  for (const a of packet.assumptions) {
    if (!has(a.heading)) fail(`assumption heading "${a.heading.slice(0, 60)}" is not on the rendered page`);
    for (const it of a.items) if (!has(it)) fail(`assumption "${it.slice(0, 60)}" is not on the rendered page`);
  }
  if (b.exams.length > 0) {
    const exam = packet.assumptions.find((a) => a.kind === 'exam');
    if (!exam || exam.items.length !== b.exams.length) fail(`the packet lists ${exam?.items.length ?? 0} of ${b.exams.length} exams`);
    else ok(`exams: ${exam.items.join('; ')}`);
  }
  if (!packet.assumptions.some((a) => a.kind === 'offering')) fail('nothing says the later terms are estimated from past offerings');

  // The unofficial line, top and bottom, and every question.
  if (!/unofficial/i.test(packet.unofficial) || !/uAchieve/.test(packet.unofficial)) fail(`the unofficial line does not name the uAchieve audit: ${packet.unofficial}`);
  if ((text.match(/This plan is unofficial/g) ?? []).length < 2) fail('the unofficial line is not printed at the top and the bottom');
  for (const q of packet.questions) if (!has(q.text)) fail(`question "${q.topic}" is not on the rendered page`);
  for (const n of packet.plannerNotes) if (!has(n)) fail(`planner note "${n.slice(0, 60)}" is not on the rendered page`);
  console.log(`  questions: ${packet.questions.map((q) => q.topic).join(', ') || 'none'}`);

  const pages = printedPages(packet);
  if (pages > (expect.pages ?? 2.5)) fail(`the packet runs about ${pages.toFixed(2)} printed pages; it should be about two`);
  return packet;
}

// --- the students -----------------------------------------------------------------
const [EMMA, JORDAN] = STUDENTS;
// Emma's Fall 2026 backups were ESL 115 (placement on the English Placement
// Test) for RHET 105 and LAS 102 (first-term LAS transfer students only) for
// LAS 100, straight off the card dropdown. Pre-med, her first fall is now the
// track's chemistry and physics, which the plan needs as they are and no
// backup stands in for, beside LAS 101 alone of the planner's picks. The
// backups are held to her board before she names the goal: the same
// freshman, the same AP credit, the planner's picks in her first fall.
const EMMA_BEFORE_GOAL = { ...EMMA, name: 'Emma, Psychology freshman, AP Psychology and Calculus AB, no goal named yet', studying: 'Psychology.', career: '' };
audit(EMMA_BEFORE_GOAL.name, build(EMMA_BEFORE_GOAL), { picks: 2, notBackup: { 'RHET 105': 'ESL 115', 'LAS 100': 'LAS 102', 'LAS 101': 'LAS 102' } });
audit(EMMA.name, build(EMMA));
audit(JORDAN.name, build(JORDAN), { likely: 8, open: 4, picks: 1 });
// Chemistry's board carries the parser's "Check this one" warnings on its own.
audit('Priya, Chemistry freshman', build({ name: 'Priya', program: 'las/chemistry-bs', studying: 'Chemistry', career: 'pharmacy school', languageYears: 3, language: 'Spanish', horizon: FOUR_YEARS }), { flags: 3 });

// --- a continuing student's own record ---------------------------------------------
{
  // Sam's Illinois record: two courses done, PSYC 100 still in progress, and
  // CMN 101 he told ALMA about with no document behind it. The plan counts
  // PSYC 100 as passed and CMN 101 on his word; the packet says both.
  const SAM = {
    name: 'Sam, continuing Psychology student',
    program: 'las/psychology-bslas',
    studying: 'Psychology',
    career: 'UX research',
    reading: { institution: 'University of Illinois Urbana-Champaign', kind: 'transcript', hoursUnit: null, exams: [], notes: [], courses: [line('RHET 105', 'Writing and Research', 4, 'Fall 2025'), line('MATH 115', 'Preparation for Calculus', 3, 'Spring 2026'), line('PSYC 100', 'Intro Psych', 4, 'Fall 2026', 'in_progress', null)] },
    added: [{ code: 'CMN 101', title: 'Public Speaking', credits: 3, grade: null, term: null, status: 'completed', from: null, equivalent: null, matched: 'CMN 101', matchedBy: 'student', use: true, counts: 'course', illinoisCredits: 3 }],
    languageYears: 4,
    language: 'French',
    horizon: { startSeason: 'Spring', startYear: 2027, gradSeason: 'Spring', gradYear: 2030, stated: true },
  };
  const packet = audit(SAM.name, build(SAM));
  const inProgress = packet.assumptions.find((a) => a.kind === 'in-progress')?.items ?? [];
  const entered = packet.assumptions.find((a) => a.kind === 'entered')?.items ?? [];
  if (!inProgress.some((it) => it.startsWith('PSYC 100 ') && /in progress Fall 2026/.test(it))) fail(`PSYC 100, in progress, is not an assumption: ${JSON.stringify(inProgress)}`);
  else ok(`in progress: ${inProgress.join('; ')}`);
  if (inProgress.some((it) => /^(RHET 105|MATH 115) /.test(it))) fail('a finished course is listed as in progress');
  if (!entered.some((it) => it.startsWith('CMN 101'))) fail(`CMN 101, entered without a document, is not an assumption: ${JSON.stringify(entered)}`);
  else ok(`entered: ${entered.join('; ')}`);
  if (packet.assumptions.some((a) => a.kind === 'likely-equivalent' || a.kind === 'open-line')) fail('an Illinois record grew likely equivalents or open lines');
}

// --- a board edited past the limits, with a semester abroad ---------------------
{
  // Fall 2028 filled past 18 from Spring 2030, Fall 2029 taken down to 9,
  // a study-abroad spring between them, and a course moved into Fall 2026
  // ahead of its prerequisite: the overload and the underload an advisor has
  // to approve, the abroad approval, and a prerequisite error.
  const edited = { moved: /** @type {string | null} */ (null) };
  const b = build(EMMA, {
    away: [{ season: 'Spring', year: 2029, kind: 'study_abroad', credits: 15 }],
    edit: (plan) => {
      const next = structuredClone(plan);
      const fall28 = next.terms.find((t) => t.label === 'Fall 2028');
      const fall29 = next.terms.find((t) => t.label === 'Fall 2029');
      const cr = (t) => A.planCreditRange(t.courseIds.map((id) => byId.get(id)?.code), context).min;
      const donor = next.terms.find((t) => t.label === 'Spring 2030');
      while (fall28 && donor && cr(fall28) <= 18 && donor.courseIds.length > 0) fall28.courseIds.push(donor.courseIds.shift());
      while (fall29 && cr(fall29) > 9 && fall29.courseIds.length > 1) fall29.courseIds.pop();
      // The first course in Spring 2027 whose prerequisite is a Fall 2026 course, moved beside it.
      const [first, second] = next.terms;
      const earlier = new Set(first.courseIds.map((id) => norm(byId.get(id)?.code ?? '')));
      const id = second.courseIds.find((cid) => (context.prereqs.get(norm(byId.get(cid)?.code ?? ''))?.groups ?? []).some((gr) => !gr.concurrent && gr.any.length === 1 && earlier.has(norm(gr.any[0]))));
      if (id) {
        second.courseIds = second.courseIds.filter((x) => x !== id);
        first.courseIds.push(id);
        edited.moved = byId.get(id)?.code ?? null;
      }
      return next;
    },
  });
  const packet = audit(`Emma's board edited: ${edited.moved ?? 'nothing'} moved before its prerequisite, Fall 2028 past 18, Fall 2029 at 9, Spring 2029 abroad`, b, { flags: 3 });
  console.log(`  terms: ${packet.terms.map((t) => `${t.label} ${t.credits}${t.load ? ' (!)' : ''}`).join(', ')}`);
  const moved = edited.moved ?? '';
  if (!moved) fail('no Spring 2027 course had a Fall 2026 prerequisite to move ahead of');
  if (!packet.flags.some((f) => f.severity === 'error' && moved && f.message.startsWith(`${moved} needs`))) fail(`${moved} ahead of its prerequisite is not an error flag in the packet`);
  const over = packet.terms.find((t) => t.label === 'Fall 2028');
  const under = packet.terms.find((t) => t.label === 'Fall 2029');
  const away = packet.terms.findIndex((t) => t.label === 'Spring 2029');
  if (!over?.load?.startsWith('Over 18')) fail(`Fall 2028 at ${over?.credits} is not marked an overload`);
  if (!under?.load?.startsWith('Under 12')) fail(`Fall 2029 at ${under?.credits} is not marked part-time`);
  if (away < 0 || !packet.terms[away].away) fail('the semester abroad is not on the page');
  else if (packet.terms[away - 1]?.label !== 'Fall 2028' || packet.terms[away + 1]?.label !== 'Fall 2029') fail(`the semester abroad is out of calendar order: ${packet.terms.map((t) => t.label).join(', ')}`);
  const q = (topic) => packet.questions.find((x) => x.topic === topic);
  if (!q('overload')?.text.includes('Fall 2028') || !/LAS/.test(q('overload')?.text ?? '')) fail(`the overload question does not name Fall 2028 and LAS: ${q('overload')?.text}`);
  if (!q('underload')?.text.includes('Fall 2029') || !/aid/.test(q('underload')?.text ?? '')) fail(`the underload question does not name Fall 2029 and aid: ${q('underload')?.text}`);
  if (!q('away')?.text.includes('Spring 2029')) fail(`no question about which courses abroad will count: ${q('away')?.text}`);
  if (moved && !q('errors')?.text.includes(`${moved} needs`)) fail(`the errors question does not say which course is ahead of its prerequisite: ${q('errors')?.text}`);
  if (q('overload') && q('underload') && q('away') && q('errors')) ok(`questions: ${[q('overload'), q('underload'), q('away'), q('errors')].map((x) => x.text.slice(0, 64)).join(' | ')}`);
}

console.log(failures === 0 ? '\nADVISOR PACKET CHECK: all clean' : `\nADVISOR PACKET CHECK: ${failures} ${failures === 1 ? 'failure' : 'failures'}`);
process.exit(failures === 0 ? 0 : 1);
