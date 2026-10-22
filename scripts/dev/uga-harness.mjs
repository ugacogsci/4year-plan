/**
 * UGA before/after: every UGA bachelor's program, built for several kinds of
 * student the way the workspace builds a UGA board, at two checkouts.
 *
 *   node scripts/dev/uga-harness.mjs fixtures <checkout> <fixtures.json>
 *   node scripts/dev/uga-harness.mjs build <checkout> <fixtures.json> <out.jsonl>
 *   node scripts/dev/uga-harness.mjs compare <before.jsonl> <after.jsonl> [--md <out.md>]
 *
 * Why it exists: on 2026-10-20 a UGA board stopped starting in "this year's
 * fall" and started, as Illinois's does, at the next term a student can
 * still register for (Spring 2027 in October), with the fall under way shown
 * as the current semester, holding the student's real classes
 * (lib/planner/current-term.ts, lib/planner/plan-start.ts). Every UGA plan
 * moves, so this measures each board before and after: its terms, its total
 * credits, the required classes the build could not place, the requirement
 * rows left unmet, and how many things the board says need attention.
 *
 * Who is planned, on Oct 20, 2026, with the onboarding's own defaults (the
 * year of study read from the words, the finish onboarding suggests for it):
 *   incoming   "I'm an incoming freshman, starting college next fall." No record.
 *   first      "I'm a freshman." In their first fall. No record.
 *   first-setup The same freshman as the guided setup or the Details step
 *              leaves them: "First year" picked, no words about it, the
 *              suggested finish. No record.
 *   first-added The same freshman, with their Fall 2026 classes added by hand
 *              (the program's own first fall, as the column's "Add a class
 *              you're taking now" writes them).
 *   second     "I'm a sophomore." A UGA transcript: Fall 2025 and Spring 2026
 *              done (about 30 credits), Fall 2026 in progress.
 *   second-nf  The same sophomore, the transcript printed without Fall 2026.
 *   third      "I'm a junior." Fall 2024 to Spring 2026 done (about 60), Fall
 *              2026 in progress (about 75 by December).
 * The transcripts are the program's own courses: the first terms of the
 * board this checkout's engine builds for a student who started in Fall 2025
 * (or 2024), written once by `fixtures` so both checkouts read the same ones.
 *
 * How a board is built: as planner-workspace.tsx's buildPlan builds a UGA
 * board (uga-source.tsx over public/uga-*, readPriorCredit, priorHoursOf,
 * withGenEdCredit, the horizon's assumed hours added to the prior credit,
 * generatePlan with UGA's elective limit and fill), then audited as the
 * workspace audits it (auditUgaBoard, with the assumed hours in its extra
 * credits, and degreeCompletionIssue); "attention" counts the issues that
 * matter now (attention.ts needsAttention), and "bar" is what the board bar
 * itself shows (warnings-triage.ts triageIssues with the workspace's credit
 * gap: the record prompt, then the kinds that matter now; 0 is "Nothing
 * needs attention"). horizonFor comes from the checkout's
 * lib/planner/plan-start.ts, or for a checkout before it existed, from its
 * planner-workspace.tsx, cut out and loaded as it was.
 *
 * Read-only for the checkout. Environment: HARNESS_JOBS (workers, default 3),
 * HARNESS_IDS (only these program ids), HARNESS_KINDS (only these kinds).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [mode, ...args] = process.argv.slice(2);
if (!['fixtures', 'build', 'compare'].includes(mode)) {
  console.error('usage: uga-harness.mjs fixtures <checkout> <fixtures.json> | build <checkout> <fixtures.json> <out.jsonl> | compare <before.jsonl> <after.jsonl> [--md out.md]');
  process.exit(2);
}
if (mode !== 'compare' && !process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), mode, ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const TODAY = new Date('2026-10-20T15:00:00Z');
const KINDS = {
  incoming: { words: "I'm an incoming freshman, starting college next fall.", record: null },
  first: { words: "I'm a freshman.", record: null },
  'first-setup': { words: '', academicYear: 'first', record: null },
  'first-added': { words: "I'm a freshman.", record: 'first-added' },
  second: { words: "I'm a sophomore.", record: 'second' },
  'second-nf': { words: "I'm a sophomore.", record: 'second-nf' },
  third: { words: "I'm a junior.", record: 'third' },
};
const KIND_NAMES = (process.env.HARNESS_KINDS ?? Object.keys(KINDS).join(',')).split(',').map((s) => s.trim()).filter((k) => KINDS[k]);

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------
if (mode === 'compare') {
  const [beforeFile, afterFile] = args;
  const mdAt = args.indexOf('--md');
  const md = mdAt >= 0 ? args[mdAt + 1] : null;
  const rows = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const key = (r) => `${r.id}|${r.kind}`;
  const before = new Map(rows(beforeFile).map((r) => [key(r), r]));
  const after = new Map(rows(afterFile).map((r) => [key(r), r]));
  const out = [];
  const say = (s = '') => out.push(s);
  const sum = (list, f) => list.reduce((n, r) => n + (f(r) ?? 0), 0);
  const avg = (list, f) => (list.length ? (sum(list, f) / list.length).toFixed(1) : '-');
  say(`# UGA before/after: ${before.size} boards before, ${after.size} after`);
  say();
  say('| kind | boards | start (before -> after) | terms planned, avg | total credits, avg | required classes not placed | unmet requirement rows | issues that matter now, avg | board bar items, avg | boards saying "Nothing needs attention" | boards short of the degree total | terms over 18 |');
  say('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const kind of KIND_NAMES) {
    const b = [...before.values()].filter((r) => r.kind === kind && r.ok);
    const a = [...after.values()].filter((r) => r.kind === kind && r.ok);
    const starts = (list) => [...new Set(list.map((r) => r.start))].join('/');
    say(`| ${kind} | ${b.length} -> ${a.length} | ${starts(b)} -> ${starts(a)} | ${avg(b, (r) => r.terms)} -> ${avg(a, (r) => r.terms)} | ${avg(b, (r) => r.total)} -> ${avg(a, (r) => r.total)} | ${sum(b, (r) => r.notPlaced)} -> ${sum(a, (r) => r.notPlaced)} | ${sum(b, (r) => r.unmetRows)} -> ${sum(a, (r) => r.unmetRows)} | ${avg(b, (r) => r.attention)} -> ${avg(a, (r) => r.attention)} | ${avg(b, (r) => r.bar)} -> ${avg(a, (r) => r.bar)} | ${b.filter((r) => r.bar === 0).length} -> ${a.filter((r) => r.bar === 0).length} | ${b.filter((r) => r.short).length} -> ${a.filter((r) => r.short).length} | ${sum(b, (r) => r.over18)} -> ${sum(a, (r) => r.over18)} |`);
  }
  say();
  // What the attention items are, before and after.
  const kinds = (map) => {
    const n = new Map();
    for (const r of map.values()) for (const k of r.attentionKinds ?? []) n.set(k, (n.get(k) ?? 0) + 1);
    return n;
  };
  const kb = kinds(before);
  const ka = kinds(after);
  const barKinds = (map) => {
    const n = new Map();
    for (const r of map.values()) for (const k of r.barKinds ?? []) n.set(k, (n.get(k) ?? 0) + 1);
    return n;
  };
  const bb = barKinds(before);
  const ba = barKinds(after);
  say('## What the board bar shows (boards showing each, before -> after)');
  say();
  for (const k of [...new Set([...bb.keys(), ...ba.keys()])].sort((x, y) => (ba.get(y) ?? 0) + (bb.get(y) ?? 0) - (ba.get(x) ?? 0) - (bb.get(x) ?? 0))) say(`- ${k}: ${bb.get(k) ?? 0} -> ${ba.get(k) ?? 0}`);
  say();
  say('## Issues that matter now, by kind (boards showing each, before -> after)');
  say();
  for (const k of [...new Set([...kb.keys(), ...ka.keys()])].sort((x, y) => (ka.get(y) ?? 0) + (kb.get(y) ?? 0) - (ka.get(x) ?? 0) - (kb.get(x) ?? 0))) say(`- ${k}: ${kb.get(k) ?? 0} -> ${ka.get(k) ?? 0}`);
  say();
  // Boards that got worse on the counts that matter.
  const worse = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b || !b.ok || !a.ok) continue;
    const why = [];
    if (a.notPlaced > b.notPlaced) why.push(`required classes not placed ${b.notPlaced} -> ${a.notPlaced}`);
    if (a.unmetRows > b.unmetRows) why.push(`unmet requirement rows ${b.unmetRows} -> ${a.unmetRows}`);
    if (a.short && !b.short) why.push(`now short of the degree total (${a.total} of ${a.target})`);
    if ((a.bar ?? a.attention) > (b.bar ?? b.attention)) why.push(`board bar ${b.bar ?? b.attention} -> ${a.bar ?? a.attention}: ${(a.barKinds ?? a.attentionKinds ?? []).filter((x) => !(b.barKinds ?? b.attentionKinds ?? []).includes(x)).join('; ')}`);
    if (a.over18 > b.over18) why.push(`terms over 18 credits ${b.over18} -> ${a.over18}`);
    if (why.length) worse.push(`- ${a.name} (${a.id}), ${a.kind}: ${why.join('; ')}`);
  }
  const better = [...after].filter(([k, a]) => { const b = before.get(k); return b?.ok && a.ok && ((a.bar ?? a.attention) < (b.bar ?? b.attention) || a.notPlaced < b.notPlaced || a.unmetRows < b.unmetRows); }).length;
  say(`## Boards worse on any count: ${worse.length}; better on at least one: ${better}`);
  say();
  for (const line of worse.slice(0, 200)) say(line);
  if (worse.length > 200) say(`- ... and ${worse.length - 200} more`);
  const failedBefore = [...before.values()].filter((r) => !r.ok).length;
  const failedAfter = [...after.values()].filter((r) => !r.ok).length;
  say();
  say(`Boards the build could not make: ${failedBefore} before, ${failedAfter} after.`);
  const text = out.join('\n');
  console.log(text);
  if (md) writeFileSync(md, text + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// fixtures and build: load the checkout the way the browser does
// ---------------------------------------------------------------------------
const ROOT = resolve(args[0]);
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
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
    return next(url, ctx);
  }
`));
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);
const publicJson = (name) => JSON.parse(readFileSync(join(ROOT, 'public', name), 'utf8'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await lib('components/planner/uga-source.tsx');
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
const { generatePlan, planCreditRange, distinctHeld } = await lib('lib/planner/autoplan.ts');
const { DEFAULT_PRIORITIES } = await lib('lib/planner/priorities.ts');
const G = await lib('lib/planner/uga-planning-guidance.ts');
const T = await lib('lib/planner/transcript.ts');
const O = await lib('lib/planner/onboarding.ts');

const programs = data.programs.filter((p) => U.isUgaUndergraduateDegree(p) && (!process.env.HARNESS_IDS || process.env.HARNESS_IDS.split(',').includes(p.id)));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const byCode = new Map(data.courses.map((c) => [norm(c.code), c]));
const byId = new Map(data.courses.map((c) => [c.id, c]));

function loadProgram(program) {
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
  const labels = U.ugaSelectionRequirements(program).flatMap((q) => q.options.filter((o) => emphasisSelections[q.id]?.includes(o.id)).map((o) => o.label));
  const samples = G.samplePlansFor(data.guidance, [program.id]);
  return { loaded, samplePlanCourses: G.sampleCoursesFor(samples, { [program.id]: labels }) };
}

// ---------------------------------------------------------------------------
// fixtures: each program's first terms, as a transcript
// ---------------------------------------------------------------------------
if (mode === 'fixtures') {
  const out = {};
  const started = Date.now();
  let n = 0;
  for (const program of programs) {
    n += 1;
    try {
      const { loaded, samplePlanCourses } = loadProgram(program);
      const context = { ...data.context, samplePlanCourses };
      const reference = (startYear) => generatePlan({
        requirements: loaded.blocks, context, programName: loaded.program.name, programId: program.id,
        prior: { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 },
        horizon: { startSeason: 'Fall', startYear, gradSeason: 'Spring', gradYear: startYear + 4, stated: true },
        degreeTotal: program.totalCredits, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
        preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
      }).plan;
      const lines = (plan, done, now) => plan.terms.flatMap((t, i) => {
        const status = i < done ? 'completed' : i === done && now ? 'in_progress' : null;
        if (!status) return [];
        const label = i === done ? 'Fall 2026' : t.label;
        return t.courseIds.map((id) => byId.get(id)).filter(Boolean).map((c) => ({
          code: c.code, title: c.title, credits: c.credits, grade: status === 'completed' ? 'A' : null, term: label, status,
          matched: norm(c.code), matchedBy: 'code', use: true, counts: 'course',
        }));
      });
      const record = (courses) => ({ schoolId: 'uga', fileName: 'harness-transcript.pdf', readAt: '2026-10-20T14:00:00Z', institution: 'University of Georgia', kind: 'transcript', home: true, files: ['harness-transcript.pdf'], courses, exams: [], notes: [] });
      // Sophomore: the board of a student who began Fall 2025, its first two terms done, its third (labelled Fall 2026) in progress.
      const fresh = reference(2026);
      const soph = reference(2025);
      const junior = reference(2024);
      const added = fresh.terms[0].courseIds.map((id) => byId.get(id)).filter(Boolean).map((c) => ({
        code: c.code, title: c.title, credits: c.credits, grade: null, term: 'Fall 2026', status: 'in_progress',
        from: null, equivalent: null, matched: norm(c.code), matchedBy: 'student', use: true, counts: 'course', illinoisCredits: c.credits,
      }));
      out[program.id] = {
        'first-added': { schoolId: 'uga', fileName: 'Added by you', readAt: '2026-10-20T14:00:00Z', institution: null, kind: 'course_list', home: true, files: [], courses: added, exams: [], notes: [] },
        second: record(lines(soph, 2, true)),
        'second-nf': record(lines(soph, 2, false)),
        third: record(lines(junior, 4, true)),
      };
    } catch (error) {
      out[program.id] = { error: String(error?.message ?? error) };
    }
    if (n % 20 === 0) console.error(`[fixtures] ${n}/${programs.length} (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  writeFileSync(resolve(args[1]), JSON.stringify(out));
  console.error(`[fixtures] wrote ${Object.keys(out).length} programs to ${args[1]}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
const FIXTURES = JSON.parse(readFileSync(resolve(args[1]), 'utf8'));
const OUT = resolve(args[2]);
const JOBS = programs.flatMap((p) => KIND_NAMES.map((kind) => ({ id: p.id, kind })));

if (process.env.HARNESS_WORKER === undefined) {
  const n = Math.max(1, Math.min(Number(process.env.HARNESS_JOBS ?? 3), JOBS.length));
  const started = Date.now();
  const lines = [];
  let done = 0;
  await Promise.all(Array.from({ length: n }, (_, k) => new Promise((ok, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), mode, ...args], { env: { ...process.env, HARNESS_WORKER: `${k}/${n}` }, stdio: ['ignore', 'pipe', 'inherit'] });
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
        if (done % 50 === 0) console.error(`[harness] ${done}/${JOBS.length} boards (${Math.round((Date.now() - started) / 1000)}s)`);
      }
    });
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`worker ${k} exited ${code}`))));
  })));
  const order = new Map(JOBS.map((j, i) => [`${j.id}|${j.kind}`, i]));
  lines.sort((a, b) => { const x = JSON.parse(a); const y = JSON.parse(b); return (order.get(`${x.id}|${x.kind}`) ?? 0) - (order.get(`${y.id}|${y.kind}`) ?? 0); });
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.error(`[harness] wrote ${lines.length} boards to ${OUT} in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

// ---- a worker ---------------------------------------------------------------
const [k, n] = process.env.HARNESS_WORKER.split('/').map(Number);
const IS = await lib('components/planner/illinois-source.tsx');
const X = await lib('components/planner/exam-credit.ts');
const { auditUgaBoard } = await lib('components/planner/uga-board-audit.ts');
const { degreeCompletionIssue } = await lib('lib/planner/completion.ts');
const { needsAttention, attentionItems } = await lib('lib/planner/attention.ts');
const S = await lib('lib/planner/saved-board.ts');
// The board bar's own reading of the issues (2026-10-20 on), when this checkout has it.
const W = existsSync(join(ROOT, 'lib/planner/warnings-triage.ts')) ? await lib('lib/planner/warnings-triage.ts') : null;
const hasPlanStart = existsSync(join(ROOT, 'lib/planner/plan-start.ts'));

/** The checkout's horizonFor: lib/planner/plan-start.ts, or cut from the workspace of a checkout before it. */
async function horizonOf() {
  if (existsSync(join(ROOT, 'lib/planner/plan-start.ts'))) return (await lib('lib/planner/plan-start.ts')).horizonFor;
  const src = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  const a = src.indexOf('function termOrd(season: SemesterSeason, year: number): number {');
  // Its end: statedHours followed it until 2026-10-21, when that moved to warnings-triage.ts.
  const stated = src.indexOf('/** "About 45 credits", "I have 60 hours"');
  const b = stated >= 0 ? stated : src.indexOf('/** Gen-ed categories met by held credit that holds no Illinois course');
  if (a < 0 || b < 0) throw new Error('horizonFor markers not found in planner-workspace.tsx');
  const at = (p) => pathToFileURL(join(ROOT, p)).href;
  const head = [
    `import { readHorizon, firstOpenTerm, calendarTerm } from '${at('components/planner/illinois-source.tsx')}';`,
    `import { timelineForPlanning } from '${at('lib/planner/onboarding.ts')}';`,
    `import { summersFor } from '${at('lib/planner/summer-terms.ts')}';`,
    `import { assumedHours as assumedHoursOf, recordCoverage, uncoveredTerms } from '${at('lib/planner/start-term.ts')}';`,
    `import { lineIsForeign, normalizeTerm } from '${at('lib/planner/transcript.ts')}';`,
    "type SemesterSeason = 'Fall' | 'Spring' | 'Summer';",
  ].join('\n');
  const file = join(mkdtempSync(join(tmpdir(), 'uga-harness-')), 'horizon.ts');
  writeFileSync(file, `${head}\n${src.slice(a, b)}\nexport { horizonFor };\n`);
  return (await import(pathToFileURL(file).href)).horizonFor;
}
const horizonFor = await horizonOf();

function answersFor(kind, record) {
  const { words } = KINDS[kind];
  const academicYear = KINDS[kind].academicYear ?? O.inferAcademicYear(words);
  const said = O.inferGraduationTarget(words);
  const suggested = O.suggestGraduationTarget(academicYear, 4, TODAY);
  return {
    schoolId: 'uga', programLevel: 'undergraduate', programIds: [], minorIds: [], certificateIds: [], doubleDawgsPathwayId: null,
    emphasisSelections: {}, collegeId: '', academicYear,
    graduationSeason: said.season || suggested.season, graduationYear: said.year ?? suggested.year,
    alreadyTakenCourseCodes: [], studying: '', timeline: words, timelineAt: TODAY.toISOString(), after: words,
    exams: [], transferText: '', transcript: record, languageYears: null, language: '',
  };
}

function build(program, kind) {
  const fixture = FIXTURES[program.id];
  const recordName = KINDS[kind].record;
  if (recordName && (!fixture || fixture.error)) return { ok: false, error: `no transcript fixture: ${fixture?.error ?? 'missing'}` };
  const record = recordName ? fixture[recordName] : null;
  const answers = answersFor(kind, record);
  const { loaded, samplePlanCourses } = loadProgram(program);
  const context = { ...T.withTranscriptCredits(data.context, record), samplePlanCourses };
  const ctxByCode = new Map(context.courses.map((c) => [norm(c.code), c]));
  const recordedCredits = T.transcriptCourseCredits(record);
  const catalogCredits = (code) => recordedCredits.get(norm(code)) ?? ctxByCode.get(norm(code))?.credits ?? null;
  // priorHoursOf, as the workspace has it.
  const priorHours = X.examElectiveHours([], [], T.transcriptIndirectCodes(record), catalogCredits) + T.transcriptHours(record) + T.transcriptCreditAdjustment(record, catalogCredits);
  const read = IS.readPriorCredit('', 0, ctxByCode, [...T.transcriptCodes(record)], Boolean(record), priorHours, null, '');
  const genEdCredits = [...T.transcriptGenEdCredits(record), ...X.examGenEdCredits([], [], catalogCredits)];
  const prior = { ...read, exemptCodes: [...new Set([...read.exemptCodes, ...T.transcriptExemptCodes(record)])], ...(genEdCredits.length ? { genEdCredits } : {}) };
  const horizon = horizonFor(answers, TODAY, S.NO_SHAPE);
  const priorHere = horizon.assumedHours > 0 ? { ...prior, unmatchedCredits: prior.unmatchedCredits + horizon.assumedHours } : prior;
  const publishedTotal = loaded.summary?.totalCredits || loaded.program.totalCredits || null;
  const careerText = answers.after;
  const generated = generatePlan({
    requirements: loaded.blocks, context, prior: priorHere, horizon,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
    programId: loaded.summary?.id ?? program.id, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
    degreeTotal: publishedTotal, interests: ['', careerText].join(' '), career: careerText,
    programName: loaded.program.name, programCollege: loaded.program.college, admissionRoute: null, residency: null, firstYear: false,
  });
  const board = generated.plan;
  // What the workspace counts against the board (completedCodes, priorCreditHours).
  const completed = board.completedCourseIds.map((id) => context.courses.find((c) => c.id === id)?.code).filter(Boolean).map(norm);
  const forfeited = new Set((generated.forfeited ?? []).map((f) => norm(f.held)));
  const once = distinctHeld(completed.filter((c) => !forfeited.has(c)), context).codes;
  const priorCreditHours = planCreditRange(once, context).min + priorHours;
  const current = horizon.current ?? null;
  const audit = auditUgaBoard({
    board, context, undergraduate: loaded, priorCodes: completed,
    extraCredits: priorCreditHours - planCreditRange(completed, context).min + horizon.assumedHours,
    transcript: record, dualLevel: data.dualLevelCourses,
    // As the workspace's audit has it since 2026-10-20: standing counts the assumed terms (0 at UGA before).
    validation: { minimumTermCredits: 12, priorCredits: priorCreditHours + horizon.assumedHours },
  });
  const boardCodes = board.terms.flatMap((t) => t.courseIds).map((id) => context.courses.find((c) => c.id === id)?.code).filter(Boolean);
  const planned = planCreditRange(boardCodes, context).min;
  const target = audit.target ?? publishedTotal;
  const incomplete = [
    ...audit.areas.filter((row) => row.area.hours > 0 && !row.satisfied).map((row) => row.area.label),
    ...audit.pools.filter((p) => (p.hoursTarget !== null && p.hours < p.hoursTarget) || (p.countTarget !== null && p.count < p.countTarget)).map((p) => p.label),
  ];
  const completion = degreeCompletionIssue({ currentCredits: planned + priorCreditHours + horizon.assumedHours, requiredCredits: target, incompleteRequirementNames: incomplete, termId: board.terms[0]?.id ?? '' });
  const issues = [completion, ...audit.issues].filter(Boolean);
  const attention = issues.filter(needsAttention);
  const loads = board.terms.map((t) => planCreditRange(t.courseIds.map((id) => context.courses.find((c) => c.id === id)?.code).filter(Boolean), context).min);
  // What the board bar shows: the workspace's creditGap and triageIssues. The
  // terms assumed until their classes are added count at UGA since the
  // current-semester column (plan-start.ts); before it the workspace gave UGA none.
  let bar = attention.length;
  let barKinds = attentionItems(issues).map((a) => a.text);
  if (W) {
    const names = horizon.assumedTerms.map((t) => `${t.season} ${t.year}`);
    const credit = {
      said: W.statedHours(answers.timeline ?? ''),
      recorded: planCreditRange(distinctHeld(completed, context).codes, context).min + priorHours,
      assumed: hasPlanStart ? horizon.assumedHours : 0,
      assumedTerms: names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? ''),
      // The current-semester column, as the workspace passes it (ignored by a checkout before it).
      currentTerm: current ? `${current.season} ${current.year}` : null,
      currentAssumed: horizon.currentAssumedHours ?? 0,
      currentClasses: current ? (record?.courses ?? []).filter((c) => c.use && c.status === 'in_progress' && !T.lineIsForeign(record, c) && (!c.term || c.term === `${current.season} ${current.year}`)).length : 0,
    };
    const full = issues.map((i) => ({ termId: '', message: '', ...i }));
    const t = W.triageIssues(full, { credit, bot: 'ARCH' });
    bar = (t.prompt ? 1 : 0) + t.now.length;
    barKinds = t.prominent.map((k) => (k.key === 'record' ? `prompt: ${k.label}` : k.label.replace(/\(\d+\)$/, '(n)').replace(/^\d+ requirements not met$/, 'n requirements not met')));
  }
  return {
    ok: true,
    start: board.terms[0]?.label ?? null,
    finish: board.terms.at(-1)?.label ?? null,
    terms: board.terms.length,
    current: current ? `${current.season} ${current.year}` : null,
    assumed: horizon.assumedHours,
    held: priorCreditHours,
    planned,
    total: audit.total,
    target,
    short: Boolean(target && audit.total < target),
    notPlaced: generated.notPlaced.length,
    notPlacedCodes: generated.notPlaced.map((r) => r.code),
    unmetRows: audit.areas.filter((row) => !row.satisfied).length + audit.issues.filter((i) => i.id.startsWith('uga-pool-')).length,
    attention: attention.length,
    attentionKinds: attentionItems(issues).map((a) => a.text),
    bar,
    barKinds,
    over18: loads.filter((l) => l > 18).length,
    maxLoad: Math.max(0, ...loads),
  };
}

for (let i = k; i < JOBS.length; i += n) {
  const job = JOBS[i];
  const program = programs.find((p) => p.id === job.id);
  let row;
  try {
    row = build(program, job.kind);
  } catch (error) {
    row = { ok: false, error: String(error?.message ?? error).slice(0, 300) };
  }
  process.stdout.write(JSON.stringify({ id: program.id, name: program.name, degree: program.degree, kind: job.kind, ...row }) + '\n');
}
process.exit(0);
