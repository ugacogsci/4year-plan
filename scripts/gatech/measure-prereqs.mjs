/**
 * How much of Georgia Tech's prerequisite prose the Illinois parser reads, and
 * whether it reads it right.
 *
 * SOURCE: public/gatech-catalog.json (scripts/gatech/courses.mjs) and the
 *   parser in lib/planner/illinois-data.ts (parsePrerequisites), loaded twice:
 *     - as it is in the repo today, and
 *     - with the one change Georgia Tech needs (GT_PARSER_PATCH below) applied
 *       in memory by a module-load hook. The repo file is never edited here.
 *
 * WRITES: nothing. Prints the rates; --list prints every mismatch.
 *
 * HOW TO RUN (repo root):
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" \
 *     node --experimental-strip-types scripts/gatech/measure-prereqs.mjs [--list]
 *
 * WHAT IT MEASURES
 *   parsed:  a course whose Banner table names at least one catalog course
 *            gets at least one prerequisite group.
 *   exact:   the parser's groups are exactly the AND-clauses courses.mjs built
 *            from the table (prereqClauses), course for course, and a clause
 *            with a test-score alternative carries priorLearning.
 *   standing: a restriction sentence comes back as the same class standing.
 *
 * WHAT IT CANNOT KNOW: whether Banner's own table is complete. It checks the
 *   prose round trip, not Georgia Tech.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/**
 * The parser change Georgia Tech needs, and nothing else. Course numbers at
 * Georgia Tech are four digits with an optional letter suffix (CS 1331,
 * BIOS 1107L, CHEM 1211K); Illinois's CODE_RE reads exactly three digits, so
 * every Georgia Tech code is invisible to it. Widening to 3-4 digits plus up to
 * two suffix letters is safe for Illinois: codesIn keeps only codes in the
 * catalog's own set, and no Illinois code has four digits or a suffix, so the
 * Illinois parse is unchanged (measured below on public/illinois-catalog.json).
 */
export const GT_PARSER_PATCH = [
  ['const CODE_RE = /\\b([A-Z]{2,4})\\s?(\\d{3})\\b/g;', 'const CODE_RE = /\\b([A-Z]{2,4})\\s?(\\d{3,4}[A-Z]{0,2})\\b/g;'],
];

register(
  'data:text/javascript,' +
    encodeURIComponent(`
const PATCH = ${JSON.stringify(GT_PARSER_PATCH)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s(\\?.*)?$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  const out = await next(url, ctx);
  if (url.includes('illinois-data.ts?gt')) {
    let src = String(out.source);
    for (const [from, to] of PATCH) {
      if (!src.includes(from)) throw new Error('GT parser patch no longer applies: ' + from);
      src = src.replace(from, to);
    }
    return { ...out, source: src, shortCircuit: true };
  }
  return out;
}`),
);

const stock = await import('../../lib/planner/illinois-data.ts');
const patched = await import('../../lib/planner/illinois-data.ts?gt');

const LIST = process.argv.includes('--list');
const GT_GRAD_LEVEL = 5000;
const file = JSON.parse(readFileSync('public/gatech-catalog.json', 'utf8'));
const rows = file.courses;
const known = new Set(rows.map((r) => r.code));
const key = (codes) => [...codes].sort().join('|');

function measure(parser, subset) {
  const out = { courses: subset.length, read: 0, withTable: 0, withCourseClause: 0, parsed: 0, exact: 0, prior: 0, priorOk: 0, standing: 0, standingOk: 0, lowConfidence: 0, mismatches: [] };
  for (const r of subset) {
    if (!r.prereqRead) continue;
    out.read += 1;
    if (r.prereqGT) out.withTable += 1;
    const expected = (r.prereqClauses ?? []).filter((c) => c.any.length > 0);
    const spec = parser.parsePrerequisites(r.prereqText ?? '', r.code, known);
    const wantStanding = /Restricted to students with (\w+)/.exec(r.prereqText ?? '');
    if (wantStanding) {
      out.standing += 1;
      if (spec.standing === wantStanding[1]) out.standingOk += 1;
    }
    if (expected.length === 0) continue;
    out.withCourseClause += 1;
    if (spec.groups.length > 0) out.parsed += 1;
    if (spec.confidence === 'low') out.lowConfidence += 1;
    const got = spec.groups.map((g) => `${key(g.any)}${g.concurrent ? '~c' : ''}`).sort();
    const want = expected.map((c) => `${key(c.any)}${c.concurrent ? '~c' : ''}`).sort();
    // Identical clauses collapse in the parser's dedupe; compare as sets.
    const same = key(new Set(got)) === key(new Set(want));
    let priorOk = true;
    const withTest = expected.filter((c) => c.alt.length && r.prereqTests?.some((t) => c.alt.includes(t)));
    if (withTest.length) {
      out.prior += 1;
      priorOk = withTest.every((c) => spec.groups.some((g) => key(g.any) === key(c.any) && g.priorLearning));
      if (priorOk) out.priorOk += 1;
    }
    if (same && priorOk) out.exact += 1;
    else out.mismatches.push({ code: r.code, text: r.prereqText, want, got, priorOk });
  }
  return out;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
function report(label, m) {
  console.log(`\n== ${label}`);
  console.log(`  courses ${m.courses}; Banner prerequisite reply read for ${m.read}; a prerequisite table for ${m.withTable}; a clause naming a catalog course for ${m.withCourseClause}`);
  console.log(`  parsed into structured groups: ${m.parsed}/${m.withCourseClause} = ${pct(m.parsed, m.withCourseClause)}`);
  console.log(`  exactly the Banner requirement:  ${m.exact}/${m.withCourseClause} = ${pct(m.exact, m.withCourseClause)}   (low confidence: ${m.lowConfidence})`);
  console.log(`  test-score alternatives read as priorLearning: ${m.priorOk}/${m.prior}`);
  console.log(`  class standing read back: ${m.standingOk}/${m.standing}`);
  if (m.mismatches.length) {
    console.log(`  ${m.mismatches.length} mismatches${LIST ? ':' : ', first 8 (--list for all):'}`);
    for (const x of LIST ? m.mismatches : m.mismatches.slice(0, 8)) console.log(`    ${x.code}: "${x.text}"\n       want ${JSON.stringify(x.want)}\n       got  ${JSON.stringify(x.got)}${x.priorOk ? '' : ' (priorLearning missing)'}`);
  }
}

const ug = rows.filter((r) => r.level < GT_GRAD_LEVEL);
const ugPlannable = ug.filter((r) => !r.noise);
report('stock parser (repo today), undergraduate', measure(stock, ug));
report('patched parser (GT_PARSER_PATCH), undergraduate', measure(patched, ug));
report('patched parser, undergraduate, noise rows excluded (what the planner loads)', measure(patched, ugPlannable));
report('patched parser, graduate', measure(patched, rows.filter((r) => r.level >= GT_GRAD_LEVEL)));

// Per subject, undergraduate, patched.
console.log('\nper subject (undergraduate, patched): parsed / with a course clause');
const bySubj = new Map();
for (const r of ug) {
  if (!bySubj.has(r.subject)) bySubj.set(r.subject, []);
  bySubj.get(r.subject).push(r);
}
const line = [];
for (const [s, list] of [...bySubj].sort()) {
  const m = measure(patched, list);
  line.push(`${s} ${m.parsed}/${m.withCourseClause}${m.exact !== m.withCourseClause ? ` (exact ${m.exact})` : ''}`);
}
console.log(`  ${line.join(', ')}`);

// The patch must not change a single Illinois parse.
try {
  const ill = JSON.parse(readFileSync('public/illinois-catalog.json', 'utf8')).courses;
  const iknown = new Set(ill.map((r) => r.code.replace(/\s+/g, ' ').trim().toUpperCase()));
  let diff = 0;
  const examples = [];
  for (const r of ill) {
    if (!r.prereqText) continue;
    const a = JSON.stringify(stock.parsePrerequisites(r.prereqText, r.code, iknown));
    const b = JSON.stringify(patched.parsePrerequisites(r.prereqText, r.code, iknown));
    if (a !== b) { diff += 1; if (examples.length < 5) examples.push(r.code); }
  }
  console.log(`\nIllinois regression: ${diff} of ${ill.filter((r) => r.prereqText).length} Illinois prerequisite sentences parse differently with the patch${examples.length ? ` (e.g. ${examples.join(', ')})` : ''}`);
} catch (e) {
  console.log(`\nIllinois regression not run: ${e.message}`);
}
