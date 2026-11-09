/**
 * Illinois degree requirements, as structured data.
 *
 * catalog.illinois.edu/undergraduate/ lists every undergraduate program and
 * concentration as a link in one page, so the index costs one request rather
 * than a walk of the college tree.
 *
 * Each program page is CourseLeaf's sc_courselist table:
 *
 *   <p><strong>Foundational Mathematics and Science</strong></p>   <- area
 *   <table class="sc_courselist">
 *     <tr class="areaheader"><span class="courselistcomment areaheader">One
 *         Science elective course:</span><td class="hourscol">3</td></tr>   <- group
 *     <tr><td class="codecol"><a>PHYS 212</a></td><td>Title</td>
 *         <td class="hourscol">4</td></tr>                                  <- course
 *     <tr class="orclass"><td class="codecol orclass">or <a>CS 211</a></td>  <- alternative
 *     <tr class="listsum"><td>Total Hours</td><td class="hourscol">3-4</td>  <- area total
 *
 * The orclass row is the one that matters and the one a naive parser gets
 * wrong: "CS 210 or CS 211" is a choice of one, and reading it as two required
 * courses inflates the degree and makes the plan unsatisfiable.
 *
 * Output: public/illinois-programs.json, and after a full crawl the minors,
 * public/illinois/minors/crawl.json (scripts/illinois/minors.mjs; --minors
 * reads only those, --no-minors skips them).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { courselistParser } from './courselist.mjs';

const UA = 'FourYearPlanBot/1.0 (student planning project; respects robots.txt)';
const BASE = 'https://catalog.illinois.edu';
const DELAY = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(40_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      return await res.text();
    } catch (e) { if (a === 2) { console.error(`  ! ${url} ${e.message}`); return null; } await sleep(3000 * (a + 1)); }
  }
  return null;
}

const { text, parseTables } = courselistParser({ digits: 3 });

/**
 * Hours to graduate, as the catalog states it at the bottom of the page.
 *
 * Not the first "Total Hours" on the page: that is the first requirement
 * table's subtotal, and reading it gave "Computer Science, BS: 3 credits".
 * Illinois writes the real figure three different ways depending on the
 * college, so all three are tried and the result is sanity-checked, because a
 * wrong graduation total is the one number that makes every plan wrong.
 */
function programTotal(html) {
  const flat = text(html);
  const pats = [
    /Total Hours of Curriculum to Graduate\s*(\d{2,3})/i,
    /Minimum hours required for graduation:?\s*(\d{2,3})/i,
    /Total hours for all requirements:?\s*(\d{2,3})/i,
    /(\d{2,3})\s*(?:credit\s*)?hours?\s*(?:are\s*)?required (?:for graduation|to graduate)/i,
  ];
  for (const re of pats) {
    const n = parseInt(flat.match(re)?.[1] ?? '', 10);
    if (n >= 100 && n <= 200) return n;
  }
  return null;
}

// node scripts/illinois/programs.mjs --parse <saved.html>
// Parses one saved program page and prints the areas it found. A 308-page crawl
// is too long to be the way you discover the cell parser is reading the wrong
// column, which is exactly how every row shipped with credits: null once.
if (process.argv[2] === '--parse') {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(process.argv[3], 'utf8');
  const areas = parseTables(html);
  for (const a of areas) {
    console.log(`\n## ${a.label}   (${a.hours ?? '?'} hours)`);
    for (const g of a.groups) {
      if (g.label) console.log(`   [${g.label}]${g.hours ? ' ' + g.hours + 'h' : ''}${g.choose ? ' choose ' + g.choose : ''}`);
      for (const c of g.courses.slice(0, 6)) {
        const and = c.and ? '  ' + Object.entries(c.and).map(([k, v]) => [k, ...v].join(' & ')).join('; ') : '';
        console.log(`     ${c.code.padEnd(10)} ${String(c.credits ?? '?').padStart(3)}h  ${c.title.slice(0, 52)}${c.or ? '  (or ' + c.or.join(', ') + ')' : ''}${and}${c.unlinked ? '  [plain text: ' + c.unlinked.join(', ') + ']' : ''}`);
      }
      if (g.courses.length > 6) console.log(`     ... ${g.courses.length - 6} more`);
    }
  }
  // DEBUG_NOTES=1 prints where each requirement sentence landed. The elective
  // counts hid in an areaheader for an afternoon because nothing showed this.
  if (process.env.DEBUG_NOTES) {
    for (const a of areas) { console.log(`\n@@ ${a.label} hours=${a.hours} from=${a.hoursFrom} chooseCourses=${a.chooseCourses}`);
      a.groups.forEach((g,i)=>console.log(`   g${i} label=${JSON.stringify((g.label||'').slice(0,50))} note=${JSON.stringify((g.note||'').slice(0,160))}`)); }
  }
  const all = areas.flatMap((a) => a.groups.flatMap((g) => g.courses));
  console.log(`\n${all.length} course rows, ${all.filter((c) => c.credits != null).length} with credits, ${all.filter((c) => c.title).length} with a title`);
  process.exit(0);
}

// --out <file>: write somewhere other than public/illinois-programs.json (a
// crawl to compare against the shipped one before anything replaces it).
// --only <id,id>: only these program ids.
const flag = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT_FILE = flag('--out') ?? 'public/illinois-programs.json';
const ONLY = flag('--only')?.split(',') ?? null;

// --minors: the minor pages instead of the degree pages, into public/illinois/minors/
// (scripts/illinois/minors.mjs). --minors-out <dir> writes elsewhere; --save-html
// <dir> keeps each page and --from-html <dir> reads them back without a request.
const minorsWith = (out) => import('./minors.mjs').then(({ crawlMinors }) =>
  crawlMinors({ get, sleep, parseTables, text, BASE, DELAY, out, saveHtml: flag('--save-html'), fromHtml: flag('--from-html') }));
if (process.argv.includes('--minors')) {
  await minorsWith(flag('--minors-out') ?? 'public/illinois/minors');
  process.exit(0);
}

// --graduate: the graduate and professional pages instead, into public/illinois/graduate/
// (scripts/illinois/graduate.mjs). --graduate-out <dir> writes elsewhere; --graduate-cache
// <dir> reads saved pages and fetches (and saves) only the ones missing.
const graduateWith = (out) => import('./graduate.mjs').then(({ crawlGraduate }) =>
  crawlGraduate({ get, sleep, parseTables, text, BASE, DELAY, out, cache: flag('--graduate-cache') }));
if (process.argv.includes('--graduate')) {
  await graduateWith(flag('--graduate-out') ?? 'public/illinois/graduate');
  process.exit(0);
}

const index = await get(`${BASE}/undergraduate/`);
if (!index) { console.error('index unreachable'); process.exit(1); }

// /undergraduate/{college}/{program}/ and one level of concentration under it.
const paths = [...new Set([...index.matchAll(/href="(\/undergraduate\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\/)"/g)].map((m) => m[1]))]
  .filter((p) => !ONLY || ONLY.includes(p.split('/').filter(Boolean).slice(1).join('/')));
console.log(`${paths.length} program pages`);

// BALAS (Economics, English...), BLS, BME, BMA, BASA and BFASA were missing, so
// 76 majors read with no degree and the picker hid them.
const DEGREE = /\b(bs|ba|bfa|bsn|barch|bla|bsba|bslas|bmus|bsw|bse|balas|bls|bme|bma|basa|bfasa)\b/;
const out = [];
for (const [i, path] of paths.entries()) {
  const html = await get(BASE + path);
  await sleep(DELAY);
  if (!html) continue;
  // The first <h1> on every page is "2026-2027 Course Catalog", the site
  // banner. The program's own name is the first segment of <title>, and the
  // last <h1> is the fallback when a page has no title.
  const titleTag = text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').split('|')[0].trim();
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]));
  const name = titleTag || h1s[h1s.length - 1] || path;
  const areas = parseTables(html);
  const segs = path.split('/').filter(Boolean);
  const degM = segs[2]?.match(DEGREE) ?? segs[1]?.match(DEGREE);
  const courses = new Set(areas.flatMap((a) => a.groups.flatMap((g) => g.courses.map((c) => c.code))));
  out.push({
    id: segs.slice(1).join('/'),
    college: segs[1],
    name,
    degree: (degM?.[1] ?? '').toUpperCase(),
    concentration: segs.length === 4 ? segs[3].replace(/-/g, ' ') : null,
    url: BASE + path,
    areas,
    totalCredits: programTotal(html),
    courseCount: courses.size,
  });
  console.log(`${String(i + 1).padStart(3)}/${paths.length} ${String(courses.size).padStart(3)} courses  ${String(areas.length).padStart(2)} areas  ${name.slice(0, 62)}`);
}

const empty = out.filter((p) => !p.courseCount).length;
if (empty) console.log(`\n!! ${empty} program pages parsed to zero courses`);

mkdirSync('public', { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify({
  school: 'illinois', source: `${BASE}/undergraduate/`, fetchedAt: new Date().toISOString(), programs: out,
}));
console.log(`\n${out.length} programs, ${out.filter((p) => p.courseCount).length} with course lists`);

// The minors are refreshed with every full degree crawl, so they cannot fall a
// catalog year behind the degrees. A crawl written elsewhere with --out puts its
// minors beside it, never over the shipped ones. --no-minors skips them.
if (!ONLY && !process.argv.includes('--no-minors')) {
  console.log('\nMinors');
  await minorsWith(flag('--minors-out') ?? (flag('--out') ? OUT_FILE.replace(/\.json$/, '') + '-minors' : 'public/illinois/minors'));
}

// Graduate and professional programs ride the same refresh, for the same reason.
// Rebuild their planner files afterwards with scripts/illinois/graduate-build.mjs
// (npm run build:illinois runs it). --no-graduate skips them.
if (!ONLY && !process.argv.includes('--no-graduate')) {
  console.log('\nGraduate and professional programs');
  await graduateWith(flag('--graduate-out') ?? (flag('--out') ? OUT_FILE.replace(/\.json$/, '') + '-graduate' : 'public/illinois/graduate'));
}
