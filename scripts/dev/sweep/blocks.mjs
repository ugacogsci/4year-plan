/**
 * Every requirement block of every degree, as one checkout reads the pages.
 *
 *   node blocks.mjs <planner checkout> [out.jsonl]     (stdout without out.jsonl)
 *
 * One JSONL row a block: { id (the degree), total, req, area, label, kind, n,
 * hours, choices, credits, codes (each choice's first code), blockHours,
 * note, rule }. sweep.mjs writes it beside every sweep as
 * <out>.blocks.jsonl, and compare.mjs scores both boards of a pair on the
 * after sweep's file: "the new reading". The format is the research's
 * blocks.mjs, so its files (fix-research/misreads/blocks/*.jsonl) read the
 * same.
 *
 * It also prints the take-all check (takeall.mjs): blocks that ask for every
 * course of a list holding two courses the catalog will not credit together
 * (MATH 220 beside MATH 221), the hallmark of an option list read as
 * take-all. 64 at illinois-2 715d894.
 *
 * SWEEP_IDS limits it to those degrees, as in sweep.mjs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { register } from 'node:module';
import { takeAllExclusionPairs } from './takeall.mjs';

const [checkoutArg, outArg] = process.argv.slice(2);
if (!checkoutArg) {
  console.error('usage: node blocks.mjs <planner checkout> [out.jsonl]');
  process.exit(2);
}
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const ROOT = resolve(checkoutArg);
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
const { adaptIllinoisPrograms } = await import(join(ROOT, 'lib/planner/illinois-data.ts'));
const { hydrateIndexRow } = await import(join(ROOT, 'lib/planner/illinois-load.ts'));
const pub = (n) => JSON.parse(readFileSync(join(ROOT, 'public', n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const rows = pub('illinois/index.json').map(hydrateIndexRow);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const only = process.env.SWEEP_IDS ? new Set(process.env.SWEEP_IDS.split(',').map((s) => s.trim())) : null;
const out = [];
for (const s of pub('illinois/programs.json')) {
  if (!s.id || (only && !only.has(s.id))) continue;
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [pub(`illinois/program/${s.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(s.id) ?? [];
  const credit = (codes) => codes.reduce((n, c) => n + (byCode.get(norm(c))?.credits ?? 0), 0);
  for (const b of blocks) {
    const r = b.rule;
    const codes = (r.choices ?? []).flatMap((c) => c.codes.slice(0, 1));
    out.push({ id: s.id, total: s.totalCredits, req: b.id, area: b.areaLabel, label: b.label, kind: r.kind, n: r.n ?? null, hours: r.hours ?? b.hours ?? null, choices: codes.length, credits: credit(codes), codes: codes.slice(0, 400), blockHours: b.hours ?? null, note: b.note ?? '', rule: r });
  }
}
const text = out.map((b) => JSON.stringify(b)).join('\n') + '\n';
if (outArg) writeFileSync(resolve(outArg), text);
else process.stdout.write(text);
const found = takeAllExclusionPairs(out, pub('illinois/exclusions.json'));
console.error(`${out.length} requirement blocks${outArg ? ` -> ${resolve(outArg)}` : ''}; take-all blocks holding two courses that do not both count: ${found.length} in ${new Set(found.map((f) => f.degree)).size} degrees`);
