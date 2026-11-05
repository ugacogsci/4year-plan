/**
 * How well students rate the instructors who teach each undergraduate
 * course, for the planner's "Highly rated teaching" priority.
 *
 *   node scripts/difficulty/course-teaching.mjs
 *
 * UGA publishes no list of excellent teachers, so at UGA the teaching
 * priority had nothing to choose by; Illinois's Teachers Ranked as Excellent
 * list names about 2,400 courses and is silent on the rest. Matching the
 * schedule's names to rated profiles takes about two minutes, far too long
 * for a student's browser, so it is done here once and the planner reads the
 * result (lib/planner/course-teaching.ts).
 *
 * The formula, per course c, on one term's schedule:
 *   1. The term: the next registration term that names c's instructors
 *      (Spring 2027, then Fall 2026, then the newest other term).
 *   2. Every instructor that term's schedule names for c, with the sections
 *      each teaches: s_i. Only a sure match to a rated profile counts
 *      (lib/planner/professor-ratings.ts matchProfessor, with c's subject);
 *      an unsure or missing match is left out, never guessed.
 *   3. Each professor's average rating r_i from n_i ratings, pulled toward
 *      the school's typical rating m (the ratings-weighted mean of every
 *      profile) by k = 10: r'_i = (n_i r_i + k m) / (n_i + k). A 5.0 from 2
 *      ratings is about typical; a 4.6 from 210 keeps 4.56.
 *   4. The course's reading R, weighted by sections, with the sections
 *      nobody rated counted at m: one well-rated instructor among twenty
 *      sections does not make the course a star.
 *   5. The bonus v = 0.85 * clamp((R - m) / (4.5 - m), 0, 1), on the scale of
 *      Illinois's Excellent-list bonus (0.85 for a listed instructor teaching
 *      it this term). A course rated at or under typical scores 0: the
 *      planner never calls teaching poor from ratings students chose to give.
 *
 * Each course row: t (the term read), v, r (the ratings-weighted raw average
 * of the matched instructors, for the reason a card prints), n (their
 * ratings), share (of the term's named sections, the part a rated instructor
 * teaches). Never a professor's name, profile id, link or the site's name:
 * nothing a student reads names where the ratings come from.
 *
 * Output: public/uga/course-teaching.json and
 * public/illinois/course-teaching-ratings.json.
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
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const CT = await import(join(ROOT, 'lib/planner/course-teaching.ts'));
const K = CT.TEACHING_PRIOR_RATINGS;
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/** The course's reading on one term's [name, sections] rows (course-teaching.ts teachingReading), or null where no instructor is surely rated. */
function reading(rows, file, subject, m, memo) {
  const matched = rows.map(([name, s]) => {
    const key = `${subject}|${name}`;
    if (!memo.has(key)) {
      const hit = PR.matchProfessor(file, name, subject);
      memo.set(key, hit.status === 'found' && typeof hit.profile.rating === 'number' && hit.profile.count > 0 ? { rating: hit.profile.rating, count: hit.profile.count } : null);
    }
    return { sections: s, ...(memo.get(key) ?? {}) };
  });
  return CT.teachingReading(matched, m);
}

const typicalOf = (file) => file.profiles.reduce((a, p) => a + p.count * p.rating, 0) / file.profiles.reduce((a, p) => a + p.count, 0);
const METHOD = 'Per course, on the next registration term that names its instructors: each surely matched instructor\'s average student rating, pulled toward the school\'s typical rating by k = 10 ratings; weighted by sections, with unrated sections at typical; bonus = 0.85 x clamp((R - typical) / (4.5 - typical), 0, 1).';

// UGA: the Schedule of Classes, full first names.
{
  const offerings = read('public/uga/course-offerings.json');
  const file = read('public/uga/professor-ratings.json');
  const m = typicalOf(file);
  const LEAD = ['Spring 2027', 'Fall 2026', 'Spring 2026', 'Summer 2027', 'Summer 2026'];
  const memo = new Map();
  const courses = {};
  for (const [code, terms] of Object.entries(offerings.courses)) {
    if (!/ [1-4]\d{3}/.test(code)) continue;
    const term = LEAD.find((t) => (terms[t]?.instructors ?? []).length > 0) ?? Object.keys(terms).reverse().find((t) => (terms[t]?.instructors ?? []).length > 0);
    if (!term) continue;
    const r = reading(terms[term].instructors, file, code.split(' ')[0], m, memo);
    if (r) courses[code] = { t: term, ...r };
  }
  writeFileSync(join(ROOT, 'public/uga/course-teaching.json'), JSON.stringify({ school: 'uga', builtAt: new Date().toISOString(), method: METHOD, typical: round(m, 2), k: K, courses }));
  const vals = Object.values(courses);
  console.log(`UGA: typical ${m.toFixed(2)}; ${vals.length} courses read, ${vals.filter((x) => x.v > 0).length} with a bonus, ${vals.filter((x) => x.v >= 0.6).length} at 0.6 or more`);
}

// Illinois: the crawled sections ("Last, F" names), for the courses the Excellent list is silent on.
{
  const file = read('public/illinois/professor-ratings.json');
  const m = typicalOf(file);
  const terms = [read('public/illinois/sections/spring-2027.json'), read('public/illinois/sections.json')];
  const byCode = new Map();
  for (const t of terms) {
    for (const c of t.courses ?? []) {
      const level = Number(/\d+/.exec(c.code.split(' ')[1] ?? '')?.[0] ?? 0);
      if (level >= 500) continue;
      const rows = (c.instructors ?? []).map((i) => (typeof i === 'string' ? [i, 1] : [i?.name, i?.sections ?? 1])).filter(([name]) => name);
      if (rows.length === 0 || byCode.has(c.code)) continue;
      byCode.set(c.code, { term: t.termLabel, rows });
    }
  }
  const memo = new Map();
  const courses = {};
  for (const [code, { term, rows }] of byCode) {
    const r = reading(rows, file, code.split(' ')[0], m, memo);
    if (r) courses[code] = { t: term, ...r };
  }
  writeFileSync(join(ROOT, 'public/illinois/course-teaching-ratings.json'), JSON.stringify({ school: 'illinois', builtAt: new Date().toISOString(), method: METHOD, typical: round(m, 2), k: K, courses }));
  const vals = Object.values(courses);
  console.log(`Illinois: typical ${m.toFixed(2)}; ${vals.length} courses read, ${vals.filter((x) => x.v > 0).length} with a bonus, ${vals.filter((x) => x.v >= 0.6).length} at 0.6 or more`);
}
