/**
 * Every Illinois degree's generated board, measured, one JSONL row a board.
 *
 *   node sweep.mjs <planner checkout> <out.jsonl>
 *
 * Read-only with respect to the checkout: it imports the checkout's own
 * lib/planner code and reads its public/illinois files, and writes only the
 * output file. Run it on two commits and hand both files to compare.mjs.
 *
 * Why it exists: the checks each look at a handful of students (Emma, Priya,
 * Diego), and the engine changes after a930f09 passed all of them while
 * adding an eighth semester to six pre-med Psychology concentrations and
 * dropping STAT 212 from a pre-med Integrative Biology freshman who still had
 * two semesters of Spanish to take. Only a sweep over every degree and every
 * goal saw either.
 *
 * Who is planned: a Fall 2026 freshman with no prior credit, a Spring 2030
 * finish, the balanced preset and 12 to 18 hours, for each of the 308 degrees
 * in public/illinois/programs.json, under three goals (none, 'medical
 * school', 'physical therapy school') and two language starts: 2 semesters
 * (what the planner assumes when a student has not said, which is most of
 * them) and 4 (language done). 1848 boards a checkout.
 *
 * How a board is built: exactly as __review.check.mjs builds one, which is
 * the browser's loadIllinoisCore + buildContext over public/illinois/*, each
 * degree adapted from its own program/<id>.json with attachRequirementIds, and
 * generatePlan given what planner-workspace.tsx gives it (residency, a null
 * admission route, the goal words as both interests and career, as
 * __career-tracks.check.mjs passes them). The loader below is copied from
 * __review.check.mjs, not rewritten; a930f09 and 0407e7f carry the same one.
 * validatePlan gets the board's own options (prior credit, language plan),
 * and momentumReview the built terms and held codes, as review_board does.
 *
 * sweep4 (round 4): SWEEP_PLAIN=1 builds every board with the plain engine
 * (AutoplanInput.plainEngine), and each row records which board the gate kept
 * (kept, gateWorse).
 *
 * Options, by environment:
 *   SWEEP_JOBS=7                      worker processes (default: CPUs - 1)
 *   SWEEP_IDS=las/psychology-bslas,…  only these degrees
 *   SWEEP_GOALS='none,medical school' only these goals ('none' is no goal)
 *   SWEEP_LANGS=2                     only these language starts
 *   SWEEP_STUDYING='pre-med.'         the student's "what are you studying" words,
 *                                     joined before the goal into interests as
 *                                     planner-workspace.tsx joins them. The
 *                                     0407e7f review passed interests 'pre-med.'
 *                                     alone and saw momentum-math on three
 *                                     Geography boards (GGIS 280 in Spring 2030);
 *                                     'medical school' alone, or the workspace's
 *                                     'pre-med. medical school', does not.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { register } from 'node:module';

const [checkoutArg, outArg] = process.argv.slice(2);
if (!checkoutArg || !outArg) {
  console.error('usage: node sweep.mjs <planner checkout> <out.jsonl>');
  process.exit(2);
}
const ROOT = resolve(checkoutArg);
const OUT = resolve(outArg);
const HERE = join(ROOT, 'lib', 'planner');
const PUBLIC = join(ROOT, 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const GOALS = (process.env.SWEEP_GOALS ?? 'none,medical school,physical therapy school').split(',').map((g) => g.trim());
const LANGS = (process.env.SWEEP_LANGS ?? '2,4').split(',').map(Number);
const STUDYING = process.env.SWEEP_STUDYING ?? '';
const summariesFile = JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'programs.json'), 'utf8'));
const IDS = process.env.SWEEP_IDS ? process.env.SWEEP_IDS.split(',').map((s) => s.trim()) : summariesFile.map((p) => p.id).filter(Boolean);
/** One job a board, degree-major so a worker's boards for one degree share a load. */
const JOBS = IDS.flatMap((id) => GOALS.flatMap((goal) => LANGS.map((lang) => ({ id, goal: goal === 'none' ? '' : goal, lang }))));

// ---- the parent: split the jobs, gather the rows, write them in job order ----
if (process.env.SWEEP_WORKER === undefined) {
  const n = Math.max(1, Math.min(Number(process.env.SWEEP_JOBS ?? Math.max(1, cpus().length - 1)), JOBS.length));
  const started = Date.now();
  let done = 0;
  const lines = [];
  await Promise.all(
    Array.from({ length: n }, (_, k) =>
      new Promise((ok, fail) => {
        const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ROOT, OUT], {
          env: { ...process.env, SWEEP_WORKER: `${k}/${n}` },
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        let buf = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          buf += chunk;
          let at;
          while ((at = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, at);
            buf = buf.slice(at + 1);
            if (!line.trim()) continue;
            lines.push(line);
            done += 1;
            if (done % 100 === 0) console.error(`  ${done}/${JOBS.length} boards, ${Math.round((Date.now() - started) / 1000)}s`);
          }
        });
        child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`worker ${k} exited ${code}`))));
      }),
    ),
  );
  const order = new Map(JOBS.map((j, i) => [`${j.id}|${j.goal}|${j.lang}`, i]));
  const rows = lines.map((l) => JSON.parse(l)).sort((a, b) => order.get(`${a.id}|${a.goal}|${a.lang}`) - order.get(`${b.id}|${b.goal}|${b.lang}`));
  writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const threw = rows.filter((r) => r.error).length;
  console.error(`${rows.length} boards (${threw} threw) from ${ROOT} in ${Math.round((Date.now() - started) / 1000)}s with ${n} workers -> ${OUT}`);
  process.exit(rows.length === JOBS.length ? 0 : 1);
}

// ---- a worker: the loader from __review.check.mjs, verbatim ----------------
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
const V = await import(join(HERE, 'review.ts'));
const R = await import(join(HERE, 'repick.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { livePools } = await import(join(ROOT, 'components/planner/live-pools.ts'));

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

const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
const FRESHMAN = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };
const codesOf = (ids) => ids.map((id) => norm(byId.get(id)?.code ?? '')).filter(Boolean);
const codesOn = (b) => b.terms.flatMap((t) => codesOf(t.courseIds));

/** __review.check.mjs's build(), with the goal words passed the way __career-tracks.check.mjs passes them. */
function build({ program, prior = FRESHMAN, horizon = FOUR_YEARS, target = null, words = '', career = '' }) {
  const L = load(program);
  const degreeTotal = L.summary.totalCredits || L.program.totalCredits || 120;
  const g = A.generatePlan({
    requirements: L.blocks,
    context,
    prior,
    horizon,
    preferences: { creditsPerTerm: { min: 12, target, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId: L.summary.id,
    degreeTotal,
    interests: words,
    career,
    programName: L.program.name,
    programCollege: L.program.college,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
    ...(process.env.SWEEP_PLAIN ? { plainEngine: true } : {}),
  });
  const forfeited = new Set(g.forfeited.map((f) => norm(f.held)));
  const held = codesOf(g.plan.completedCourseIds).filter((c) => !forfeited.has(c));
  const pools = livePools({ base: g.pools, blocks: L.blocks, boardCodes: codesOn(g.plan), priorCodes: held, context });
  const marks = R.planMarks({ pools, language: g.language, electives: g.electives, genEdPicks: g.genEdPicks ?? [], addedPrerequisites: g.addedPrerequisites }, byCode);
  const built = Object.fromEntries(g.terms.map((t) => [t.id, t.codes.map(norm)]));
  const options = { minimumTermCredits: 12, maxTermCredits: 18, programName: L.program.name, programCollege: L.program.college, priorCredits: g.credits.prior, away: g.away, language: g.language };
  const momentum = (board, firstYear = true) =>
    V.momentumReview({ context, board, requirements: L.blocks, programName: L.program.name, firstYear, targetTermCredits: target, planAim: g.credits.aim ?? null, built, heldCodes: held, genEdCredits: prior.genEdCredits ?? [] });
  const flags = (board) => V.editFlags(A.validatePlan(board, context, options), momentum(board).flags);
  return { L, g, board: g.plan, held, marks, built, options, degreeTotal, prior, target, horizon, momentum, flags };
}

// ---- the measures ------------------------------------------------------------

const HARDEST = context.bands?.hardest ?? 65;
const isHard = (code) => (grades.get(norm(code))?.difficulty ?? -1) >= HARDEST;
const subjectOf = (code) => norm(code).split(' ')[0];
const levelOf = (code) => Number(norm(code).split(' ')[1]?.match(/\d+/)?.[0] ?? 0);

/**
 * The degree's first college math, by one rule for every checkout: 0407e7f's
 * degreeMath, copied here because a930f09 has no such export. a930f09's review
 * counted a pre-med's MATH 112 (on the way to CHEM 102 only) as her first
 * math and 0407e7f's does not, so each checkout's own rule would report a
 * moved course where only the rule moved. The momentum flags below still use
 * each checkout's own review, since that is what the student is told.
 */
function isMathOrStatistics(course) {
  const code = norm(course.code);
  if (['MATH', 'STAT'].includes(subjectOf(code))) return true;
  return levelOf(code) < 300 && /\b(statistic|calculus|precalculus|algebra|trigonometr|mathemat)/i.test(course.title);
}
function degreeMath(requirements, codes) {
  const named = new Set();
  for (const r of requirements) if (['all', 'choose', 'pool'].includes(r.rule.kind)) for (const ch of r.rule.choices) for (const c of ch.codes) named.add(norm(c));
  const counts = (code) => {
    const course = byCode.get(code);
    return course !== undefined && isMathOrStatistics(course) && ((course.tags ?? []).some((t) => t.startsWith('Quantitative Reasoning')) || named.has(code));
  };
  const onTheWay = new Set();
  const queue = codes.map(norm).filter(counts);
  while (queue.length > 0) {
    for (const group of context.prereqs.get(queue.shift())?.groups ?? []) {
      for (const raw of group.any) {
        const code = norm(raw);
        if (onTheWay.has(code)) continue;
        onTheWay.add(code);
        queue.push(code);
      }
    }
  }
  return (raw) => {
    const code = norm(raw);
    const course = byCode.get(code);
    return counts(code) || (course !== undefined && isMathOrStatistics(course) && onTheWay.has(code));
  };
}

/**
 * First-term seminars, as the reviewer of 0407e7f counted them: Priya's
 * Chemistry board books LAS 101, LAS 100 and LAS 102 in one fall because the
 * page prints "LAS 101 OR LAS 100 OR LAS 102" and the adapter reads three
 * required courses.
 */
const SEMINAR = /^LAS 10[0-2]$|^BUS 101$|^ENG 100$|^FAA 101$|^HK 125$/;
const isSeminar = (code) => SEMINAR.test(code) || /\borientation\b/i.test(byCode.get(code)?.title ?? '');

function measure(job) {
  const b = build({
    program: job.id,
    prior: { ...FRESHMAN, languageSemesters: job.lang },
    words: STUDYING ? [STUDYING, job.goal].join(' ') : job.goal,
    career: job.goal,
    target: process.env.SWEEP_TARGET ? Number(process.env.SWEEP_TARGET) : null,
  });
  const { g, board } = b;
  if (process.env.SWEEP_NOTES) {
    console.error('NOTES:\n  ' + g.notes.join('\n  '));
    console.error('ELECTIVES:\n  ' + g.electives.map((e) => `${e.code}: ${e.why}`).join('\n  '));
  }
  const terms = g.terms.map((t) => {
    const codes = t.codes.map(norm);
    return { label: t.label, season: t.season, cr: t.credits.min, codes, hard: codes.filter(isHard) };
  });
  const lastUsed = terms.reduce((last, t, i) => (t.codes.length > 0 ? i : last), -1);
  const termOf = (code) => terms.findIndex((t) => t.codes.includes(norm(code)));
  const at = (i) => (i >= 0 ? { term: i, label: terms[i].label } : null);
  const firstWhere = (pred) => {
    for (let i = 0; i < terms.length; i++) {
      const code = terms[i].codes.find(pred);
      if (code) return { code, term: i, label: terms[i].label };
    }
    return null;
  };

  // The first two falls and springs: year one, as review.ts firstYearTerms reads it.
  const yearOne = terms.map((t, i) => ({ ...t, i })).filter((t) => t.season !== 'Summer').slice(0, 2);

  const issues = A.validatePlan(board, context, b.options);
  // Prerequisites out of order, the uncertain groups included, by course and group, not term.
  const orderFaults = issues.filter((i) => i.id.startsWith('ap-prereq-') && !/^ap-prereq-(check|text)-/.test(i.id)).map((i) => i.id.replace(`-${i.termId}-`, '-'));
  const momentum = b.momentum(board).flags;
  const editFlags = b.flags(board).map((f) => f.id);

  /**
   * Track rows with a date: the ones the guide dates, and every required row,
   * which the planner holds to the same date. Due at the end of the third
   * spring (Spring 2029 for this freshman), when AMCAS and PTCAS open.
   */
  const profile = job.goal ? A.interestProfileOf(job.goal) : null;
  const dated = profile ? profile.tracks.flatMap((track) => track.courses.filter((r) => r.due || r.need === 'required').map((r) => ({ track: track.id, row: r }))) : [];
  const dueLabel = `Spring ${FOUR_YEARS.startYear + 3}`;
  const dueIndex = terms.findIndex((t) => t.label === dueLabel);
  const heldSet = new Set(b.held);
  const trackLate = [];
  const trackMissing = [];
  for (const { track, row } of dated) {
    if (row.codes.some((c) => heldSet.has(norm(c)))) continue;
    const placed = row.codes.map(termOf).filter((i) => i >= 0);
    const key = `${track}:${row.codes.join('/')}`;
    if (placed.length === 0) trackMissing.push(key);
    else if (Math.min(...placed) > dueIndex) trackLate.push({ row: key, label: terms[Math.min(...placed)].label });
  }

  const onBoard = [...codesOn(board), ...b.held];
  const math = degreeMath(b.L.blocks, onBoard);
  return {
    id: job.id,
    goal: job.goal,
    lang: job.lang,
    ...(STUDYING ? { studying: STUDYING } : {}),
    name: b.L.program.name,
    degreeTotal: b.degreeTotal,
    termsUsed: lastUsed + 1,
    finish: lastUsed >= 0 ? terms[lastUsed].label : null,
    planned: g.credits.planned.min,
    total: g.credits.total.min,
    beyond: Math.max(0, g.credits.total.min - b.degreeTotal),
    filledToMax: g.notes.some((n) => /^Terms were filled to \d+ credits/.test(n)),
    notPlaced: g.notPlaced.map((n) => ({ code: norm(n.code), reason: n.reason, requirementId: n.requirementId ?? null })),
    unsatisfied: g.unsatisfied.map((u) => ({ id: u.requirementId, label: u.label, reason: u.reason })),
    errors: issues.filter((i) => i.severity === 'error').map((i) => ({ id: i.id, message: i.message.slice(0, 200) })),
    yearOne: yearOne.map((t) => ({ label: t.label, cr: t.cr })),
    hardPerTerm: terms.map((t) => t.hard.length),
    stack2: terms.filter((t) => t.hard.length === 2).length,
    stack3: terms.filter((t) => t.hard.length >= 3).length,
    momentumPlan: momentum.filter((f) => f.cause === 'plan').map((f) => ({ id: f.id, message: f.message })),
    momentumEdit: momentum.filter((f) => f.cause !== 'plan').map((f) => ({ id: f.id, cause: f.cause, message: f.message })),
    editFlags,
    trackLate,
    trackMissing,
    las101: at(termOf('LAS 101')),
    las102: at(termOf('LAS 102')),
    las100: at(termOf('LAS 100')),
    firstTermSeminars: terms[0]?.codes.filter(isSeminar) ?? [],
    comp1: firstWhere((code) => (byCode.get(code)?.tags ?? []).includes('Composition I')),
    firstMath: firstWhere(math),
    terms: terms.map((t) => ({ label: t.label, cr: t.cr, codes: t.codes, hard: t.hard })),
    notes: g.notes,
    electiveWhy: (g.electives ?? []).map((e) => `${e.code}: ${e.why}`),
    momentumAll: momentum.map((f) => ({ id: f.id, cause: f.cause, message: f.message })),
    orderFaults,
    kept: g.gate?.kept ?? null,
    gateWorse: g.gate?.worse ?? [],
  };
}

const [k, n] = process.env.SWEEP_WORKER.split('/').map(Number);
for (let i = k; i < JOBS.length; i += n) {
  const job = JOBS[i];
  const t0 = Date.now();
  let row;
  try {
    row = { ...measure(job), ms: Date.now() - t0 };
  } catch (e) {
    row = { id: job.id, goal: job.goal, lang: job.lang, error: String(e?.stack ?? e).slice(0, 600), ms: Date.now() - t0 };
  }
  process.stdout.write(JSON.stringify(row) + '\n');
  // A pipe write is asynchronous on macOS: without a turn of the event loop
  // every row waits in memory until the last board, and progress reads 0.
  await new Promise((done) => setImmediate(done));
}
