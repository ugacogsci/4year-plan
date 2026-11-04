/**
 * UGA course difficulty, 0 to 100, from the student ratings of the
 * professors who teach each course.
 *
 *   node scripts/difficulty/uga-difficulty.mjs
 *
 * UGA publishes no grade history, so a UGA plan had no difficulty at all: the
 * planner's hard-course spreading, lighter picks and term loads ran on
 * Illinois only. The owner (2026-11-04): "when the students write down their
 * preferences that they want a light course load for a specific semester, the
 * [ratings] data and how hard those classes are ranked on there, that needs to
 * be used ... There needs to be a formula."
 *
 * The formula, per course c:
 *   1. Who teaches it: every instructor UGA's Schedule of Classes names for c
 *      (public/uga/course-offerings.json, all terms it holds), with the number
 *      of sections each taught: s_i.
 *   2. Their rated profile, by the same precision-first matching the advisors
 *      use (lib/planner/professor-ratings.ts matchProfessor, with c's subject):
 *      difficulty d_i (1 to 5) and the number of ratings n_i. An instructor
 *      with no sure match is left out, never guessed.
 *   3. A weighted mean over them: w_i = s_i * n_i / (n_i + 5), so a professor
 *      who teaches more sections counts for more students, and one with few
 *      ratings counts for less. raw = sum(w_i d_i) / sum(w_i).
 *   4. Shrinkage toward the subject's mean (an empirical-Bayes average): with
 *      N = sum over i of min(n_i, 50) * s_i / sum(s), and k = 15,
 *        D = (N * raw + k * mean_subject) / (N + k)
 *      so a course known from three angry ratings stays near its subject, and
 *      one known from hundreds keeps its own number.
 *   5. score = round((D - 1) / 4 * 100).
 * Courses whose instructors match no profile get no score (the planner treats
 * them as unweighed, as Illinois does a course with no grade history).
 *
 * The bands (typical, harder, hardest) are the same percentiles of UGA's
 * scores that Illinois's published bands are of Illinois's own, so "hardest"
 * means the same share of courses at both schools.
 *
 * Output: public/uga/course-difficulty.json. Never names the ratings site in
 * anything a student reads.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }
`));
const PR = await import(join(ROOT, 'lib/planner/professor-ratings.ts'));

const K = 15;
const CAP = 50;
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const offerings = read('public/uga/course-offerings.json');
const ratings = read('public/uga/professor-ratings.json');
const illinois = read('public/illinois/index.json');

// 1-3: the professors who teach each course, matched, weighted.
const perCourse = new Map();
let named = 0;
let matched = 0;
for (const [code, terms] of Object.entries(offerings.courses)) {
  const subject = code.split(' ')[0];
  const sections = new Map();
  for (const t of Object.values(terms)) for (const [name, s] of t.instructors ?? []) sections.set(name, (sections.get(name) ?? 0) + s);
  const rows = [];
  for (const [name, s] of sections) {
    named += 1;
    const m = PR.matchProfessor(ratings, name, subject);
    if (m.status !== 'found' || typeof m.profile.difficulty !== 'number' || !(m.profile.count > 0)) continue;
    matched += 1;
    rows.push({ s, d: m.profile.difficulty, n: m.profile.count });
  }
  if (rows.length > 0) perCourse.set(code, { subject, rows });
}

// 4: subject means (ratings-weighted), and the overall mean for a subject with none.
const subj = new Map();
let gNum = 0;
let gDen = 0;
for (const { subject, rows } of perCourse.values()) {
  for (const r of rows) {
    const w = r.s * Math.min(r.n, CAP);
    const cur = subj.get(subject) ?? { num: 0, den: 0 };
    cur.num += w * r.d;
    cur.den += w;
    subj.set(subject, cur);
    gNum += w * r.d;
    gDen += w;
  }
}
const overall = gNum / gDen;
const courses = {};
for (const [code, { subject, rows }] of perCourse) {
  const sumW = rows.reduce((a, r) => a + r.s * r.n / (r.n + 5), 0);
  const raw = rows.reduce((a, r) => a + r.s * r.n / (r.n + 5) * r.d, 0) / sumW;
  const sumS = rows.reduce((a, r) => a + r.s, 0);
  const N = rows.reduce((a, r) => a + Math.min(r.n, CAP) * r.s / sumS, 0);
  const s = subj.get(subject);
  const mean = s && s.den > 0 ? s.num / s.den : overall;
  const D = (N * raw + K * mean) / (N + K);
  courses[code] = { d: Math.round(((D - 1) / 4) * 100), n: rows.reduce((a, r) => a + r.n, 0), profs: rows.length };
}

// Bands: Illinois's published cut as percentiles of Illinois's own scores, applied to UGA's.
const pct = (sorted, x) => sorted.filter((v) => v < x).length / sorted.length;
const at = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
const ill = (Array.isArray(illinois) ? illinois : illinois.courses).map((r) => r.difficulty).filter((d) => typeof d === 'number').sort((a, b) => a - b);
const illBands = read('public/illinois/meta.json').bands;
const uga = Object.values(courses).map((c) => c.d).sort((a, b) => a - b);
const percentiles = { typical: pct(ill, illBands.typical), harder: pct(ill, illBands.harder), hardest: pct(ill, illBands.hardest) };
const bands = { typical: at(uga, percentiles.typical), harder: at(uga, percentiles.harder), hardest: at(uga, percentiles.hardest) };

const out = {
  school: 'uga',
  builtAt: new Date().toISOString(),
  method: 'Per course: the professors UGA\'s Schedule of Classes names for it, matched to rated profiles; mean difficulty weighted by sections taught and rating reliability n/(n+5); shrunk toward the subject mean with k = 15 (an empirical-Bayes average); scaled 1-5 to 0-100.',
  k: K,
  instructorsNamed: named,
  instructorsMatched: matched,
  percentiles,
  bands,
  courses,
};
writeFileSync(join(ROOT, 'public/uga/course-difficulty.json'), JSON.stringify(out));
console.log(`courses with a score: ${Object.keys(courses).length} of ${Object.keys(offerings.courses).length}; instructors matched ${matched}/${named}`);
console.log(`Illinois bands ${JSON.stringify(illBands)} sit at percentiles ${JSON.stringify(Object.fromEntries(Object.entries(percentiles).map(([k, v]) => [k, Math.round(v * 100)])))}; UGA bands at the same: ${JSON.stringify(bands)}`);
console.log(`UGA scores: min ${uga[0]}, median ${at(uga, 0.5)}, p90 ${at(uga, 0.9)}, max ${uga[uga.length - 1]}`);
