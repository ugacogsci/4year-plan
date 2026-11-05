/**
 * "Highly rated teaching" from student ratings of the instructors
 * (course-teaching.ts, 2026-11-05).
 *
 * UGA publishes no list of excellent teachers, so the teaching priority
 * chose nothing at UGA; Illinois's Teachers Ranked as Excellent list is
 * silent on most courses. The owner asked that the preferences on the side
 * actually be used ("do you care about good instructors?"), and that the
 * ratings site is never named to a student. Fails when:
 *
 *   1. the formula (teachingReading) lets a 5.0 from two ratings count like
 *      a well-known instructor (it must stay under 0.25 and say nothing), a
 *      4.6 from 210 ratings scores under 0.7, a below-typical rating scores
 *      above 0, or one rated instructor among twenty sections makes the
 *      course a star;
 *   2. at UGA (no list) a course whose instructors students rate well does
 *      not score higher on teaching than one rated poorly, or a course with
 *      no rated instructor is scored as unknown or below 0 instead of a
 *      known 0;
 *   3. at Illinois a course on the Excellent list loses the list's reason
 *      or value to the ratings, or a ratings fill scores above 0.6;
 *   4. a reason from the ratings says anything but the fixed sentence
 *      (no professor's name, no site), or a shipped file holds a profile id,
 *      a link, the site's name or any field beyond t, v, r, n and share;
 *   5. any string a student or a bot can read in lib/, components/ or app/
 *      (string literals, templates and JSX text, not comments) names the
 *      ratings site.
 *
 *   node lib/planner/__teaching-ratings.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }
`));
const CT = await import(join(HERE, 'course-teaching.ts'));
const { scoreQuality } = await import(join(HERE, 'quality.ts'));
const read = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));

const ugaFile = read('uga/course-teaching.json');
const ilFile = read('illinois/course-teaching-ratings.json');

// ---------------------------------------------------------------------------
console.log('1. The formula');
{
  const m = ugaFile.typical;
  const few = CT.teachingReading([{ sections: 1, rating: 5, count: 2 }], m);
  expect(few && few.v < 0.25 && CT.ratedTeachingReason({ t: 'Spring 2027', ...few }) === null, 'a 5.0 from 2 ratings stays near typical and says nothing', JSON.stringify(few));
  const many = CT.teachingReading([{ sections: 1, rating: 4.6, count: 210 }], m);
  expect(many && many.v >= 0.7, 'a 4.6 from 210 ratings scores 0.7 or more', JSON.stringify(many));
  expect(/^students rate the instructors on the Spring 2027 schedule highly \(4\.6 of 5 across 210 ratings\)$/.test(CT.ratedTeachingReason({ t: 'Spring 2027', ...many }) ?? ''), 'and says so in the fixed sentence', CT.ratedTeachingReason({ t: 'Spring 2027', ...many }));
  const low = CT.teachingReading([{ sections: 3, rating: 2.4, count: 80 }], m);
  expect(low && low.v === 0, 'a below-typical rating scores 0, never a penalty', JSON.stringify(low));
  const one = CT.teachingReading([{ sections: 1, rating: 4.6, count: 210 }, { sections: 19 }], m);
  expect(one && one.v < 0.1 && one.share === 0.05, 'one well-rated instructor among 20 sections does not make the course a star', JSON.stringify(one));
  expect(CT.teachingReading([{ sections: 4 }], m) === null, 'no rated instructor: no reading');
}

// ---------------------------------------------------------------------------
const teachingOnly = { workload: 0, teaching: 2, relevance: 0, coverage: 0, schedule: 0, noEarly: false, format: 'any', notBefore: null, notAfter: null, freeDays: [] };
const base = { priorities: teachingOnly, interestWords: [], primarySubject: null, degreeSubjects: new Set(), wantedTags: new Set() };
const course = (code) => ({ code, title: code, cluster: code.split(' ')[0], tags: [], credits: 3 });

console.log('2. UGA: student ratings are the teaching measure');
{
  const rated = CT.courseTeachingMap(ugaFile);
  const rows = [...rated];
  const good = rows.filter(([, x]) => CT.ratedTeachingReason(x)).sort((a, b) => b[1].v - a[1].v)[0];
  const poor = rows.find(([, x]) => x.v === 0 && x.r <= 3.2 && x.n >= 20);
  expect(Boolean(good && poor), 'the file has a well-rated and a poorly rated course', `${good?.[0]} ${poor?.[0]}`);
  const q = { ...base, ratedTeaching: rated };
  const g = scoreQuality(course(good[0]), q);
  const p = scoreQuality(course(poor[0]), q);
  expect(g.score > p.score, `${good[0]} (students rate its instructors ${good[1].r}) scores higher on teaching than ${poor[0]} (${poor[1].r})`, `${g.score} vs ${p.score}`);
  expect(g.reasons.some((r) => r.startsWith('students rate the instructors')), `${good[0]} gives the ratings reason`, g.reasons.join(' | '));
  expect(p.score === 0 && !p.unknown.includes('teaching ratings') && p.known > 0, `${poor[0]} scores a known 0, not a penalty and not unknown`, JSON.stringify({ s: p.score, k: p.known, u: p.unknown }));
  const none = scoreQuality(course('ZZZZ 1000'), q);
  expect(none.score === 0 && !none.unknown.includes('teaching ratings'), 'a course with no rated instructor is a known 0');
  const off = scoreQuality(course(good[0]), base);
  expect(off.unknown.includes('teaching ratings'), 'without the readings (the floor), teaching is unknown at UGA, as before');
  const share = rows.filter(([, x]) => x.v > 0).length / rows.length;
  expect(rows.length > 2000 && share > 0.4 && share < 0.9, `${rows.length} UGA undergraduate courses read, ${Math.round(share * 100)}% with a bonus`);
}

console.log('3. Illinois: the Excellent list first, ratings fill the gaps under it');
{
  const ex = read('illinois/excellent.json');
  const excellent = new Map(Object.entries(ex.courses));
  const rated = CT.courseTeachingMap(ilFile);
  const recent = ex.terms.filter((t) => !t.startsWith('su')).slice(0, 4);
  const q = { ...base, excellent, excellentTerms: ex.terms, ratedTeaching: rated };
  const listedBoth = [...excellent].find(([code, s]) => rated.has(code) && s.terms.some((t) => recent.includes(t)));
  expect(Boolean(listedBoth), 'a course on the list and in the ratings exists', listedBoth?.[0]);
  const withList = scoreQuality(course(listedBoth[0]), q);
  const listOnly = scoreQuality(course(listedBoth[0]), { ...q, ratedTeaching: undefined });
  expect(withList.score === listOnly.score && withList.reasons.join('|') === listOnly.reasons.join('|') && withList.reasons.some((r) => r.includes('ranked')), `${listedBoth[0]} keeps the list's value and reason`, `${withList.score} vs ${listOnly.score}: ${withList.reasons.join(' | ')}`);
  const fill = [...rated].filter(([code]) => !excellent.has(code)).sort((a, b) => b[1].v - a[1].v)[0];
  const filled = scoreQuality(course(fill[0]), q);
  expect(fill[1].v > 0.6 && filled.score <= CT.ILLINOIS_TEACHING_FILL_CAP + 1e-9 && filled.score > 0, `${fill[0]}, off the list and rated ${fill[1].v} by the file, fills at most ${CT.ILLINOIS_TEACHING_FILL_CAP}`, `${filled.score}`);
  const notRated = scoreQuality(course('ZZZZ 100'), q);
  expect(notRated.score === 0 && !notRated.unknown.includes('teaching ratings'), 'a course on neither scores a known 0, as before');
}

// ---------------------------------------------------------------------------
console.log('4. Reasons and shipped files name nobody');
{
  const SITE = /rate ?my ?prof|ratemyprofessors|\bRMP\b/i;
  const sentence = /^students rate the instructors on the (Fall|Spring|Summer) \d{4} schedule highly \(\d\.\d of 5 across \d+ ratings\)$/;
  for (const [name, file] of [['UGA', ugaFile], ['Illinois', ilFile]]) {
    const rows = Object.values(file.courses);
    const said = rows.map((x) => CT.ratedTeachingReason(x)).filter(Boolean);
    expect(said.length > 20 && said.every((r) => sentence.test(r)), `${name}: all ${said.length} reasons are the fixed sentence`, said.find((r) => !sentence.test(r)));
    const keys = new Set(rows.flatMap((x) => Object.keys(x)));
    expect([...keys].sort().join(',') === 'n,r,share,t,v', `${name}: rows hold t, v, r, n and share only`, [...keys].join(','));
    const text = JSON.stringify(file);
    expect(!SITE.test(text) && !/https?:|"id"|legacyId|profile/i.test(text), `${name}: the file holds no site name, link or profile id`);
  }
}

// ---------------------------------------------------------------------------
console.log('5. No string a student or a bot reads names the ratings site');
{
  const require = createRequire(import.meta.url);
  const ts = require(join(ROOT, 'node_modules/typescript/lib/typescript.js'));
  const SITE = /rate ?my ?prof|ratemyprofessors|\bRMP\b/i;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === 'node_modules' || name.startsWith('.')) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(name) && !/^__.*\.check\.mjs$/.test(name)) files.push(p);
    }
  };
  for (const dir of ['lib', 'components', 'app']) {
    try { walk(join(ROOT, dir)); } catch {}
  }
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!SITE.test(text)) continue;
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && SITE.test(node.text)) {
        hits.push(`${relative(ROOT, file)}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  expect(files.length > 100 && hits.length === 0, `${files.length} files read; no string, template or JSX text names the site (comments and the advisor's source filter, a regular expression, may)`, hits.join(', '));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
