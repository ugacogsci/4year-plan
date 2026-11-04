/**
 * Illinois course difficulty from professor ratings, for the courses with no
 * grade history.
 *
 *   node scripts/difficulty/illinois-difficulty.mjs
 *
 * Illinois's own difficulty (0 to 100) comes from its published grade
 * history, which is the stronger evidence, so it stays wherever it exists.
 * About 3,300 undergraduate courses have none; for those whose instructors
 * the current sections name (public/illinois/sections.json and sections/*),
 * a score from the ratings of those professors, by the formula in
 * uga-difficulty.mjs (sections-weighted, reliability n/(n+5), shrunk toward
 * the subject's mean with k = 15), put on Illinois's grade-history scale by
 * a least-squares line fitted on the courses that have both:
 *   grade_difficulty = a + b * ratings_score
 * The fit (a, b, r, n) is written with the scores. Output:
 * public/illinois/course-difficulty-ratings.json.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const ratings = read('public/illinois/professor-ratings.json');
const indexRows = read('public/illinois/index.json');
const index = Array.isArray(indexRows) ? indexRows : indexRows.courses;
const graded = new Map(index.filter((r) => typeof r.difficulty === 'number').map((r) => [r.code, r.difficulty]));
const level = new Map(index.map((r) => [r.code, r.level ?? 0]));

// Who teaches each course, from every sections file.
const files = ['public/illinois/sections.json', ...readdirSync(join(ROOT, 'public/illinois/sections')).filter((f) => f.endsWith('.json')).map((f) => `public/illinois/sections/${f}`)];
const teaching = new Map();
for (const f of files) {
  for (const c of read(f).courses ?? []) {
    for (const i of c.instructors ?? []) {
      const name = typeof i === 'string' ? i : i?.name;
      if (!name) continue;
      const m = teaching.get(c.code) ?? new Map();
      m.set(name, (m.get(name) ?? 0) + (typeof i === 'object' && i.sections ? i.sections : 1));
      teaching.set(c.code, m);
    }
  }
}
const perCourse = new Map();
let named = 0;
let matched = 0;
for (const [code, people] of teaching) {
  const subject = code.split(' ')[0];
  const rows = [];
  for (const [name, s] of people) {
    named += 1;
    const m = PR.matchProfessor(ratings, name, subject);
    if (m.status !== 'found' || typeof m.profile.difficulty !== 'number' || !(m.profile.count > 0)) continue;
    matched += 1;
    rows.push({ s, d: m.profile.difficulty, n: m.profile.count });
  }
  if (rows.length) perCourse.set(code, { subject, rows });
}
const subj = new Map();
let gNum = 0;
let gDen = 0;
for (const { subject, rows } of perCourse.values()) for (const r of rows) {
  const w = r.s * Math.min(r.n, CAP);
  const cur = subj.get(subject) ?? { num: 0, den: 0 };
  cur.num += w * r.d; cur.den += w; subj.set(subject, cur);
  gNum += w * r.d; gDen += w;
}
const overall = gNum / gDen;
const score = new Map();
for (const [code, { subject, rows }] of perCourse) {
  const sumW = rows.reduce((a, r) => a + r.s * r.n / (r.n + 5), 0);
  const raw = rows.reduce((a, r) => a + r.s * r.n / (r.n + 5) * r.d, 0) / sumW;
  const sumS = rows.reduce((a, r) => a + r.s, 0);
  const N = rows.reduce((a, r) => a + Math.min(r.n, CAP) * r.s / sumS, 0);
  const s = subj.get(subject);
  const D = (N * raw + K * (s && s.den > 0 ? s.num / s.den : overall)) / (N + K);
  score.set(code, { x: ((D - 1) / 4) * 100, n: rows.reduce((a, r) => a + r.n, 0), profs: rows.length });
}

// The line from ratings scores to Illinois's grade-history scale, on courses with both.
const pairs = [...score].filter(([code]) => graded.has(code)).map(([code, v]) => [v.x, graded.get(code)]);
const n = pairs.length;
const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
const my = pairs.reduce((a, p) => a + p[1], 0) / n;
const sxy = pairs.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
const sxx = pairs.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
const syy = pairs.reduce((a, p) => a + (p[1] - my) ** 2, 0);
const b = sxy / sxx;
const a = my - b * mx;
const r = sxy / Math.sqrt(sxx * syy);

const courses = {};
for (const [code, v] of score) {
  if (graded.has(code) || (level.get(code) ?? 0) >= 500) continue;
  courses[code] = { d: Math.max(0, Math.min(100, Math.round(a + b * v.x))), n: v.n, profs: v.profs };
}
writeFileSync(join(ROOT, 'public/illinois/course-difficulty-ratings.json'), JSON.stringify({
  school: 'illinois',
  builtAt: new Date().toISOString(),
  method: 'Courses with no grade history: the professors the current sections name, matched to rated profiles; mean difficulty weighted by sections and reliability n/(n+5), shrunk toward the subject mean (k = 15), then put on the grade-history scale by a least-squares line fitted on courses with both.',
  fit: { a: Math.round(a * 100) / 100, b: Math.round(b * 1000) / 1000, r: Math.round(r * 1000) / 1000, n },
  instructorsNamed: named,
  instructorsMatched: matched,
  courses,
}));
console.log(`instructors matched ${matched}/${named}; courses scored ${score.size}; fit on ${n} courses with both: grade = ${a.toFixed(2)} + ${b.toFixed(3)} x ratings (r = ${r.toFixed(3)}); filled ${Object.keys(courses).length} courses with no grade history`);
