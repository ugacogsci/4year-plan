/**
 * Courses taken more than once (repeats.ts), on the product path.
 *
 * 73 degree rows on 26 pages ask for more hours of one course than a single
 * sitting gives (minors-research/repeat-rows.json, 2026-10-08): Stage
 * Management asks for THEA 359 x 8 hours at 2 a sitting, Voice for MUSC 105
 * x 12 hours at 3. The board booked each once, so the bar read 2 of 8 and a
 * student who added THEA 359 again was told it was already in the plan.
 *
 * What this pins (the data and the reading; nothing books the sittings yet):
 *   - the catalog's repeat sentence read into the index (cap, same term,
 *     topics vary, a cap a term), on the wordings the 40 courses use;
 *   - what a row asks for: THEA 359 x 8 hours is four 2-hour sittings, a
 *     page past the catalog's cap keeps both figures;
 *   - the adapter's reading: which rows ask for repeats, and the two rows of
 *     the 73 that do not (ECE 496 "and Senior Thesis" is a pair, IB 490 is
 *     not in the course index).
 *
 *   node lib/planner/__repeats.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
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

const R = await import(join(HERE, 'repeats.ts'));
const { adaptIllinoisPrograms, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};

// ---- 1. the catalog's sentence --------------------------------------------
console.log('The repeat rule, read from each course\'s catalog description (public/illinois-catalog.json)');
const described = new Map(JSON.parse(readFileSync(join(ROOT, 'public', 'illinois-catalog.json'), 'utf8')).courses.map((c) => [c.code, c]));
const ruleOf = (code) => { const c = described.get(code); return R.repeatRuleOf(c.description, c.creditsMax ?? c.credits); };
check('THEA 359: 12 hours, separate semesters', ruleOf('THEA 359'), { max: 12 });
check('MUSC 105: 16 undergraduate hours (the graduate figure is not ours)', ruleOf('MUSC 105'), { max: 16 });
check('THEA 119: 2 hours in one term, 8 in all', ruleOf('THEA 119'), { max: 8, sameTerm: true, termMax: 2 });
check('MUSC 454: no more than 2 hours a term', ruleOf('MUSC 454'), { max: 16, sameTerm: true, termMax: 2 });
check('THEA 419: 4 in one semester, 8 in all', ruleOf('THEA 419'), { max: 8, sameTerm: true, termMax: 4 });
check('ARTH 495: topics vary, no cap', ruleOf('ARTH 495'), { max: null, topicsVary: true });
check('ARTS 461: graduate hours are not ours', ruleOf('ARTS 461'), { max: 6 });
check('a course that may not be repeated', ruleOf('THEA 451'), null);
check('"once" is two sittings', R.repeatRuleOf('May be repeated once.', 3), { max: 6 });

const index = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'index.json'), 'utf8'));
const indexed = new Map(index.map((r) => [r.code, r]));
check('the index carries THEA 359\'s rule', indexed.get('THEA 359')?.repeat, { max: 12 });
check('the index carries MUSC 450\'s same-term rule', indexed.get('MUSC 450')?.repeat, { max: 16, sameTerm: true, termMax: 2 });
check('a course that may not be repeated carries none', indexed.get('THEA 451')?.repeat, undefined);

console.log('\nWhat a row asks for');
check('THEA 359 x 8 hours: four 2-hour sittings', R.repeatAskFor(8, 2, { max: 12 }), { sittings: 4, perSitting: 2, pageHours: 8, cap: 12 });
check('MUSC 405 x 12 hours at 4: three sittings', R.repeatAskFor(12, 4, { max: 12 })?.sittings, 3);
check('a page past the cap is quoted, sittings stop at the cap', R.repeatAskFor(8, 1, { max: 2 }), { sittings: 2, perSitting: 1, pageHours: 8, cap: 2, pastCap: true });
check('one sitting is not a repeat', R.repeatAskFor(2, 2, { max: 12 }), null);
check('a course that may not be repeated asks nothing', R.repeatAskFor(8, 2, null), null);
check('2nd, 3rd, 11th', [R.ordinalWord(2), R.ordinalWord(3), R.ordinalWord(11), R.ordinalWord(21)], ['2nd', '3rd', '11th', '21st']);

// ---- 2. the adapter, loading a degree as sweep.mjs does --------------------
const pub = (n) => JSON.parse(readFileSync(join(ROOT, 'public', n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const rows = index.map(hydrateIndexRow);
applyOfferings(rows, pub('illinois/offerings.json'));
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const summaries = pub('illinois/programs.json');
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const load = (id) => {
  const summary = summaries.find((p) => p.id === id);
  for (const r of rows) r.requirementIds = [];
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  return { summary, program: adapted.programs[0], blocks };
};

console.log('\nThe adapter\'s reading of the 73 rows');
const asked = JSON.parse(readFileSync(join(HERE, '__repeats.rows.json'), 'utf8'));
let marked = 0;
const unmarked = [];
for (const id of new Set(asked.map((r) => r.program))) {
  const { blocks } = load(id);
  const read = new Set(blocks.flatMap((b) => (b.rule.choices ?? []).filter((c) => c.repeat).map((c) => c.codes[0])));
  for (const r of asked.filter((x) => x.program === id)) {
    if (read.has(r.code)) marked += 1;
    else unmarked.push(`${r.program} ${r.code}`);
  }
}
check('rows read as repeats', marked, 71);
check('rows not read as repeats (a pair, a course not in the index)', unmarked, ['engineering/computer-engineering-bs ECE 496', 'las/integrative-biology-bslas/honors IB 490']);

console.log(failed ? `\n${failed} FAILED` : '\nall repeat checks pass');
if (failed) process.exitCode = 1;
