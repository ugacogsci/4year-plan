/**
 * Every UGA bachelor's program's board, one JSONL row a board, and a compare
 * of two such files. The UGA counterpart of sweep/sweep.mjs, at a smaller
 * scale: it was written for UGA's summer offerings (2026-10-22), to hold
 * "a UGA board with no summer chosen does not change" over every program
 * and to measure how the summers fill once they are chosen.
 *
 *   node scripts/dev/uga-boards.mjs <planner checkout> <out.jsonl>
 *   node scripts/dev/uga-boards.mjs --compare <before.jsonl> <after.jsonl>
 *   node scripts/dev/uga-boards.mjs --summers <file.jsonl>...
 *
 * Read-only with respect to the checkout: it imports the checkout's own
 * lib/planner code and components/planner/uga-source.tsx, reads its
 * public/uga-* files the way the browser does (scripts/uga-check.mjs and
 * lib/planner/__summer-terms.check.mjs read the same files), and writes only
 * the output file.
 *
 * Who is planned: a Fall 2026 freshman with no prior credit and a stated
 * Spring 2030 finish, with what planner-workspace.tsx hands generatePlan by
 * default (12 to 18 credits, an even share, the default priorities), for each
 * of UGA's bachelor's programs (isUgaUndergraduateDegree), the first options
 * of each emphasis choice picked; then every Double Dawgs pathway with one
 * graduate program, built as the workspace builds one (generateDoubleDawgs).
 * Each row records the terms and their courses, the notes, what was not
 * placed or not met, and the board's issues as auditUgaBoard reads them.
 *
 * Options, by environment:
 *   UGA_SUMMERS=2027,2028   summers the student chose (default: none)
 *   UGA_IDS=73962,96447     only these programs
 *   UGA_DD=0                skip the Double Dawgs boards
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);

if (args[0] === '--compare') {
  const read = (file) => new Map(readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => { const row = JSON.parse(line); return [row.key, row]; }));
  const before = read(args[1]);
  const after = read(args[2]);
  const json = (v) => JSON.stringify(v);
  const parts = ['terms', 'notes', 'unsatisfied', 'notPlaced', 'issues'];
  const changed = Object.fromEntries(parts.map((p) => [p, []]));
  let same = 0;
  const missing = [...before.keys()].filter((k) => !after.has(k));
  const added = [...after.keys()].filter((k) => !before.has(k));
  for (const [key, a] of before) {
    const b = after.get(key);
    if (!b) continue;
    const differ = parts.filter((p) => json(a[p]) !== json(b[p]));
    if (differ.length === 0) same += 1;
    for (const p of differ) changed[p].push(key);
  }
  console.log(`boards in both: ${[...before.keys()].filter((k) => after.has(k)).length}; byte for byte the same: ${same}`);
  for (const p of parts) console.log(`  ${p} changed on ${changed[p].length}${changed[p].length ? `: ${changed[p].slice(0, 12).join(', ')}${changed[p].length > 12 ? ', ...' : ''}` : ''}`);
  if (missing.length || added.length) console.log(`  only before: ${missing.length}; only after: ${added.length}`);
  process.exit(parts.some((p) => changed[p].length) || missing.length || added.length ? 1 : 0);
}

// The summers on one or more files: how many are filled, their credits, and any against the summer rules.
if (args[0] === '--summers') {
  for (const file of args.slice(1)) {
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const s = { boards: rows.length, failed: rows.filter((r) => r.error).length, summers: 0, filled: 0, courses: 0, maxCredits: 0, over9: 0, notListedForSummer: 0, wrongYear: 0, offeringFlagsInSummer: 0 };
    const byCredits = {};
    for (const r of rows.filter((x) => !x.error)) {
      for (const t of r.summer) {
        const credits = t.courses.reduce((n, c) => n + (c.credits ?? 0), 0);
        const year = Number(t.label.slice(-4));
        s.summers += 1;
        if (t.courses.length) s.filled += 1;
        s.courses += t.courses.length;
        s.maxCredits = Math.max(s.maxCredits, credits);
        if (credits > 9) s.over9 += 1;
        byCredits[credits] = (byCredits[credits] ?? 0) + 1;
        for (const c of t.courses) {
          if (!c.offeredIn?.includes('Summer')) s.notListedForSummer += 1;
          else if (c.summerYears && (year % 2 === 1) !== (c.summerYears === 'odd')) s.wrongYear += 1;
        }
      }
      s.offeringFlagsInSummer += r.issues.filter((i) => i.startsWith('ap-offering-summer-')).length;
    }
    console.log(`${file}: ${JSON.stringify(s)}; summers by credits: ${JSON.stringify(byCredits)}`);
  }
  process.exit(0);
}

const [checkoutArg, outArg] = args;
if (!checkoutArg || !outArg) {
  console.error('usage: node scripts/dev/uga-boards.mjs <planner checkout> <out.jsonl>\n       node scripts/dev/uga-boards.mjs --compare <before.jsonl> <after.jsonl>');
  process.exit(2);
}
const ROOT = resolve(checkoutArg);
const OUT = resolve(outArg);
const PUBLIC = join(ROOT, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// Extensionless and '@/' imports, and the .tsx sources transpiled, as __summer-terms.check.mjs loads them.
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

const at = (rel) => pathToFileURL(join(ROOT, rel)).href;
const { generatePlan } = await import(at('lib/planner/autoplan.ts'));
const { DEFAULT_PRIORITIES } = await import(at('lib/planner/priorities.ts'));
const G = await import(at('lib/planner/uga-planning-guidance.ts'));
const D = await import(at('lib/planner/double-dawgs.ts'));
const { auditUgaBoard } = await import(at('components/planner/uga-board-audit.ts'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(readFileSync(join(PUBLIC, (typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await import(at('components/planner/uga-source.tsx'));
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;

const SUMMERS = (process.env.UGA_SUMMERS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean);
const IDS = process.env.UGA_IDS ? new Set(process.env.UGA_IDS.split(',').map((s) => s.trim())) : null;
const byId = new Map(data.courses.map((c) => [c.id, c]));
const horizon = (finish = { season: 'Spring', year: 2030 }) => ({ startSeason: 'Fall', startYear: 2026, gradSeason: finish.season, gradYear: finish.year, stated: true, summers: SUMMERS });
const FRESH = { known: true, courseCodes: [], exemptCodes: [], unmatchedCredits: 0 };
const preferences = { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES };
const selectionsFor = (program) => Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
const inputFor = (program, loaded, selections) => ({
  requirements: loaded.blocks,
  context: {
    ...data.context,
    // As the workspace passes it: the program's sample plans, read for the emphases chosen.
    samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [program.id]), { [program.id]: U.ugaSelectionRequirements(program).flatMap((q) => q.options.filter((o) => selections[q.id]?.includes(o.id)).map((o) => o.label)) }),
  },
  prior: FRESH,
  horizon: horizon(),
  preferences,
  programId: program.id,
  electiveHoursLimit: loaded.electiveHours,
  fillToDegreeTotal: loaded.fillToDegreeTotal,
  degreeTotal: program.totalCredits || null,
  interests: '',
  career: '',
  programName: loaded.program.name,
  programCollege: loaded.program.college,
});
const row = (key, name, generated, audit) => ({
  key,
  name,
  terms: generated.plan.terms.map((t) => [t.label, t.courseIds.map((id) => byId.get(id)?.code ?? id)]),
  summer: generated.plan.terms.filter((t) => t.season === 'Summer').map((t) => ({
    label: t.label,
    courses: t.courseIds.map((id) => { const c = byId.get(id); return { code: c?.code ?? id, credits: c?.credits ?? null, offeredIn: c?.offeredIn ?? null, summerYears: c?.summerYears ?? null }; }),
  })),
  notes: generated.notes,
  unsatisfied: generated.unsatisfied.map((u) => u.requirementId),
  notPlaced: generated.notPlaced.map((n) => `${n.code}:${n.reason}`),
  issues: audit.issues.map((i) => `${i.id}|${i.title}|${i.message}`),
});

const lines = [];
const started = Date.now();
const programs = data.programs.filter((p) => U.isUgaUndergraduateDegree(p) && (!IDS || IDS.has(p.id)));
for (const program of programs) {
  try {
    const selections = selectionsFor(program);
    const loaded = U.loadUgaProgram(data, program, { emphasisSelections: selections });
    const input = inputFor(program, loaded, selections);
    const generated = generatePlan(input);
    const audit = auditUgaBoard({ board: generated.plan, context: input.context, undergraduate: loaded, graduate: undefined, priorCodes: [], extraCredits: 0, transcript: undefined, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, maxTermCredits: 18, programName: loaded.program.name, priorCredits: 0 } });
    lines.push(JSON.stringify(row(`bachelor:${program.id}`, program.name, generated, audit)));
  } catch (error) {
    lines.push(JSON.stringify({ key: `bachelor:${program.id}`, name: program.name, error: String(error?.stack ?? error) }));
  }
}
let dd = 0;
if (process.env.UGA_DD !== '0') {
  for (const pathway of data.guidance?.pathways ?? []) {
    if (pathway.graduateProgramIds.length !== 1 || pathway.undergraduateProgramIds.length === 0) continue;
    const program = data.programs.find((p) => p.id === pathway.undergraduateProgramIds[0]);
    const graduateProgram = data.programs.find((p) => p.id === pathway.graduateProgramIds[0] && U.isUgaGraduateDegree(p));
    if (!program || !graduateProgram || (IDS && !IDS.has(program.id))) continue;
    try {
      const selections = selectionsFor(program);
      const loaded = U.loadUgaProgram(data, program, { emphasisSelections: selections });
      const graduate = D.withDoubleDawgsGraduateRules(U.loadUgaProgram(data, graduateProgram, { resetRequirements: false, emphasisSelections: selections }), data.context);
      const input = inputFor(program, loaded, selections);
      const finish = { season: input.horizon.gradSeason, year: input.horizon.gradYear };
      const shared = D.selectSharedCourses(pathway, D.doubleDawgsOptions(pathway, loaded, graduate, data.byCode, data.dualLevelCourses), undefined, []);
      const generated = D.generateDoubleDawgs({ undergraduate: input, undergraduateProgram: loaded.program, graduate, pathway, shared, graduateFinish: D.defaultGraduateFinish(finish) });
      const audit = auditUgaBoard({ board: generated.plan, context: input.context, undergraduate: loaded, graduate, priorCodes: [], extraCredits: 0, transcript: undefined, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, maxTermCredits: 18, programName: loaded.program.name, priorCredits: 0 } });
      lines.push(JSON.stringify(row(`dd:${pathway.id}`, pathway.name, generated, audit)));
      dd += 1;
    } catch (error) {
      lines.push(JSON.stringify({ key: `dd:${pathway.id}`, name: pathway.name, error: String(error?.stack ?? error) }));
    }
  }
}
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`${programs.length} bachelor's boards and ${dd} Double Dawgs boards (summers: ${SUMMERS.join(', ') || 'none'}) in ${Math.round((Date.now() - started) / 1000)} s -> ${OUT}`);
