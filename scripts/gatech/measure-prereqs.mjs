/**
 * How the planner reads Georgia Tech's prerequisite prose, and whether it
 * reads what Banner means.
 *
 * SOURCE: public/gatech-catalog.json (scripts/gatech/courses.mjs) and the
 *   CourseLeaf engine's own parser and matcher in lib/planner/illinois-data.ts
 *   (parsePrerequisites, missingPrerequisiteGroups), read with Georgia Tech's
 *   course numbers (setCourseNumberDigits(4, true), as the loader does).
 *
 * WRITES: nothing. Prints the rates; --list prints every mismatch.
 *
 * HOW TO RUN (worktree root):
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" \
 *     node --experimental-strip-types scripts/gatech/measure-prereqs.mjs [--list]
 *
 * WHAT IT MEASURES
 *   parsed      a course whose prerequisite names a catalog course gets at
 *               least one group.
 *   round trip  the parser's groups are exactly the groups courses.mjs wrote
 *               (prereqClauses), course for course, concurrency included, and
 *               a group with a test-score alternative carries priorLearning.
 *   matcher     the engine's matcher (missingPrerequisiteGroups, the
 *               bipartite matching every placement asks) accepts exactly the
 *               held sets the written groups mean, on every subset of the
 *               course's prerequisite courses (a random 400 past twelve).
 *   Banner      courses.mjs compares the group form with Banner's own tree
 *               (prereq-prose.mjs compareReading) and writes the verdict into
 *               each row's prereqReading: exact, looser (admits a few held
 *               sets Banner would not), stricter (the degree-informed reading
 *               of ISYE 3133 and ECE 4445, see courses.mjs), retired-only.
 *               Counted here.
 *
 * WHAT IT CANNOT KNOW: whether Banner's own table is complete. It checks the
 *   prose round trip and the matcher, not Georgia Tech.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s(\\?.*)?$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const parser = await import('../../lib/planner/illinois-data.ts');
parser.setCourseNumberDigits(4, true);

const LIST = process.argv.includes('--list');
const GT_GRAD_LEVEL = 5000;
const file = JSON.parse(readFileSync('public/gatech-catalog.json', 'utf8'));
const rows = file.courses;
const known = new Set(rows.map((r) => r.code));
const key = (codes) => [...codes].sort().join('|');

/** The written groups, read the way the matcher is meant to: each needs a course of its own; a test-score group never blocks. */
function writtenAccepts(clauses, held) {
  const cands = clauses.map((c) => c.any.filter((x) => held.has(x)));
  const by = new Map();
  const assign = (i, seen) => {
    for (const c of cands[i]) {
      if (seen.has(c)) continue;
      seen.add(c);
      const h = by.get(c);
      if (h === undefined || assign(h, seen)) { by.set(c, i); return true; }
    }
    return false;
  };
  return clauses.every((c, i) => assign(i, new Set()) || c.alt.length > 0);
}

function measure(subset) {
  const out = { courses: subset.length, withCourseClause: 0, parsed: 0, exact: 0, prior: 0, priorOk: 0, lowConfidence: 0, matcherChecked: 0, matcherOk: 0, mismatches: [], matcherBad: [] };
  for (const r of subset) {
    if (!r.prereqRead) continue;
    const expected = (r.prereqClauses ?? []).filter((c) => c.any.length > 0);
    if (expected.length === 0) continue;
    out.withCourseClause += 1;
    const spec = parser.parsePrerequisites(r.prereqText ?? '', r.code, known);
    if (spec.groups.length > 0) out.parsed += 1;
    if (spec.confidence === 'low') out.lowConfidence += 1;
    const got = spec.groups.map((g) => `${key(g.any)}${g.concurrent ? '~c' : ''}`).sort();
    const want = expected.map((c) => `${key(c.any)}${c.concurrent ? '~c' : ''}`).sort();
    // Identical groups collapse in the parser's dedupe; compare as sets.
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

    // The engine's matcher against the written meaning, nothing earlier in the same term.
    if (r.prereqReading === 'retired-only') continue;
    const codes = [...new Set(expected.flatMap((c) => c.any))];
    const exhaustive = codes.length <= 12;
    const n = exhaustive ? 2 ** codes.length : 400;
    let ok = true;
    for (let t = 0; t < n && ok; t += 1) {
      const held = new Set(exhaustive ? codes.filter((_, i) => (t >> i) & 1) : codes.filter(() => Math.random() < 0.5));
      const { missing } = parser.missingPrerequisiteGroups(spec, held, new Set(), new Map());
      const engine = missing.length === 0;
      if (engine !== writtenAccepts(expected, held)) ok = false;
    }
    out.matcherChecked += 1;
    if (ok) out.matcherOk += 1;
    else out.matcherBad.push(r.code);
  }
  return out;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
function report(label, m) {
  console.log(`\n== ${label}`);
  console.log(`  courses ${m.courses}; a prerequisite naming a catalog course for ${m.withCourseClause}`);
  console.log(`  parsed into structured groups:     ${m.parsed}/${m.withCourseClause} = ${pct(m.parsed, m.withCourseClause)}`);
  console.log(`  groups exactly as written:         ${m.exact}/${m.withCourseClause} = ${pct(m.exact, m.withCourseClause)}   (low confidence: ${m.lowConfidence})`);
  console.log(`  test-score alternatives read as priorLearning: ${m.priorOk}/${m.prior}`);
  console.log(`  engine matcher accepts what the groups mean:   ${m.matcherOk}/${m.matcherChecked}${m.matcherBad.length ? ` (not: ${m.matcherBad.slice(0, 10).join(', ')})` : ''}`);
  if (m.mismatches.length) {
    console.log(`  ${m.mismatches.length} mismatches${LIST ? ':' : ', first 8 (--list for all):'}`);
    for (const x of LIST ? m.mismatches : m.mismatches.slice(0, 8)) console.log(`    ${x.code}: "${x.text}"\n       want ${JSON.stringify(x.want)}\n       got  ${JSON.stringify(x.got)}${x.priorOk ? '' : ' (priorLearning missing)'}`);
  }
}

const ug = rows.filter((r) => r.level < GT_GRAD_LEVEL);
report('undergraduate', measure(ug));
report('undergraduate, noise rows excluded (what the planner loads)', measure(ug.filter((r) => !r.noise)));

const readings = new Map();
for (const r of ug) if (r.prereqReading) readings.set(r.prereqReading, (readings.get(r.prereqReading) ?? 0) + 1);
console.log(`\nthe group form against Banner's tree (prereqReading, undergraduate): ${[...readings].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
for (const kind of ['stricter', 'mixed']) {
  const list = ug.filter((r) => r.prereqReading === kind);
  if (list.length) console.log(`  ${kind}: ${list.map((r) => r.code).join(', ')}`);
}
if (LIST) for (const r of ug.filter((x) => x.prereqReading === 'looser')) console.log(`  looser ${r.code}: ${r.prereqText}`);
const widened = ug.filter((r) => r.prereqAlsoAccepts);
console.log(`prerequisites that also accept a renumbered or replacement course: ${widened.length}`);
