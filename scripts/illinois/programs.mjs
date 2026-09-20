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
 * Output: public/illinois-programs.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';
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

const ent = (s) => s
  .replace(/&#160;|&nbsp;/g, ' ').replace(/&#8194;|&ensp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
const text = (h) => ent(String(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "4" / "3-4" / "2 or 3" / "" — a planner needs one number, and the low end is the honest one. */
function hours(s) {
  const t = text(s);
  const m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

const CODE = /[?&]P=([A-Z]{2,4})(?:%20|\+|\s)(\d{3})\b/i;
function codeIn(html) {
  const m = html.match(CODE);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}

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

/**
 * How many, when the catalog says it in a sentence instead of a column.
 *
 * Illinois writes elective rules as prose above the course table:
 *
 *   "Students must take a minimum of (6) six additional technical electives
 *    with at least eighteen (18) cumulative credit hours..."
 *
 * There is no hours cell and no count cell, so the group arrived with
 * choose:null and hours:null, was marked 'unknown', and the planner could do
 * nothing with it. Eight of the CS degree's technical-elective groups were
 * unplannable for want of a number that is written right there. Illinois helps
 * by putting the digit in parentheses next to the word, which is what makes
 * this safe to read rather than a guess at English.
 */
function countsFromProse(...parts) {
  const t = parts.filter(Boolean).join(' ');
  const hoursM =
    t.match(/at least\s+\w+\s*\((\d{1,2})\)\s*(?:cumulative\s+)?credit\s*hours?/i) ??
    t.match(/\(\s*(\d{1,2})\s*\)\s*(?:cumulative\s+)?credit\s*hours?/i) ??
    t.match(/\b(?:minimum|at least|total)\s+of\s+(\d{1,2})\s*(?:credit\s*)?hours?/i);
  const chooseM =
    t.match(/\b(?:minimum|at least)\s+of\s*\((\d{1,2})\)/i) ??
    t.match(/\btake\s+(?:a\s+)?(?:minimum\s+of\s+)?\((\d{1,2})\)/i) ??
    t.match(/\b(?:choose|select|complete|take)\s+(?:any\s+)?\((\d{1,2})\)/i) ??
    t.match(/\bat least\s+(\w+)\s*\((\d{1,2})\)\s+(?:of|courses?)\b/i);

  const hours = hoursM ? parseInt(hoursM[1], 10) : null;
  const choose = chooseM ? parseInt(chooseM[chooseM.length - 1], 10) : null;
  // A count of 0, or one large enough to be a credit total misread as a course
  // count, is a parse error rather than a requirement.
  return {
    hours: hours && hours >= 1 && hours <= 90 ? hours : null,
    choose: choose && choose >= 1 && choose <= 20 ? choose : null,
  };
}

function parseTables(html) {
  const areas = [];
  // Every table is preceded by the heading that names it. Walking the document
  // in order is what keeps a table attached to its own heading.
  const parts = html.split(/<table class="sc_courselist"/);
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1];
    const body = parts[i].split('</table>')[0];

    // The old pattern required the heading to be plain text end to end, so any
    // heading carrying a link, an <em> or a <span> did not match and the table
    // fell back to "Requirements 3". 398 areas across 179 programs were showing
    // that machine label to students in the progress rail. Nested markup is
    // allowed now and stripped afterwards.
    const heads = [...before.matchAll(/<(h2|h3|h4|p)[^>]*>([\s\S]{3,300}?)<\/(?:h2|h3|h4|p)>/gi)]
      .map((m) => text(m[2]))
      .filter((t) => t.length >= 3 && t.length <= 90 && /[a-z]/i.test(t));
    const label = heads.length ? heads[heads.length - 1] : '';
    // An area whose heading genuinely cannot be read has no name. Saying so
    // lets the UI leave the row unlabelled instead of inventing one.
    const labelKnown = label !== '';

    const groups = [];
    let current = { label: '', choose: null, courses: [], note: '' };
    let total = null;

    for (const rowM of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
      const cls = rowM[1];
      const row = rowM[2];

      if (/listsum/.test(cls)) { total = hours(row.match(/class="[^"]*hourscol[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? ''); continue; }

      if (/areaheader/.test(cls)) {
        if (current.courses.length || current.note || current.label) groups.push(current);
        const h = hours(row.match(/class="[^"]*hourscol[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '');
        const lab = text(row.match(/courselistcomment[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? row);
        const stated = countsFromProse(lab);
        const opensWithOne = /^(take |select |choose |complete )?(one|a single|any one)\b/i.test(lab.trim());
        current = {
          label: lab,
          choose: stated.choose ?? (opensWithOne && !/\ball\b/i.test(lab) ? 1 : null),
          chooseFrom: stated.choose != null ? 'prose' : opensWithOne ? 'heading' : null,
          hours: h ?? stated.hours,
          courses: [], note: '',
        };
        continue;
      }

      const isCourseRow = /<td[^>]*class="[^"]*codecol/.test(row);
      const code = isCourseRow ? codeIn(row) : null;
      if (/orclass/.test(cls)) {
        // An alternative belongs to the course above it, not to itself.
        const prev = current.courses[current.courses.length - 1];
        if (prev && code) (prev.or ??= []).push(code);
        continue;
      }

      if (code) {
        // Keep the whole <td ...>...</td> so the class attribute survives.
        const cells = [...row.matchAll(/<td[^>]*>[\s\S]*?<\/td>/g)].map((m) => m[0]);
        const inner = (td) => text(td.replace(/^<td[^>]*>/, '').replace(/<\/td>$/, ''));
        const hourCell = cells.find((c) => /class="[^"]*hourscol/.test(c));
        // The title is the one cell that is neither the code nor the hours. A
        // CourseLeaf row is always [codecol, title, hourscol], but concentration
        // pages sometimes drop the hours cell, so this is found rather than indexed.
        const titleCell = cells.find(
          (c) => !/class="[^"]*(codecol|hourscol)/.test(c) && inner(c).length > 2 && !/^or\b/i.test(inner(c)),
        );
        current.courses.push({
          code,
          title: titleCell ? inner(titleCell) : '',
          credits: hourCell ? hours(hourCell) : null,
          or: undefined,
        });
        continue;
      }

      const comment = text(row.match(/courselistcomment[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
      if (comment) current.note = current.note ? `${current.note} ${comment}` : comment;
    }
    if (current.courses.length || current.note || current.label) groups.push(current);
    // "Students must take a minimum of (6) six additional technical electives
    // with at least eighteen (18) cumulative credit hours" is written once for
    // the whole area, above the tables, so it lands in a note on a group that
    // has no courses. The number belongs to the AREA. Attaching it to each
    // group instead would claim every focus area needs six courses.
    const areaProse = countsFromProse(label, ...groups.flatMap((g) => [g.label, g.note]));
    let areaHours = total;
    let hoursFrom = total != null ? 'table' : null;
    if (areaHours == null && areaProse.hours != null) { areaHours = areaProse.hours; hoursFrom = 'prose'; }

    for (const g of groups) {
      g.summedCredits = g.courses.reduce((n, c) => n + (c.credits ?? 0), 0);
      const own = countsFromProse(g.label, g.note);
      if (g.choose == null && own.choose != null) { g.choose = own.choose; g.chooseFrom = 'prose'; }
      if (g.hours == null && own.hours != null) { g.hours = own.hours; g.hoursFrom = 'prose'; }
      const cap = g.hours ?? areaHours;
      g.kind = g.choose ? 'choose'
        : !cap ? 'unknown'
        : g.summedCredits > cap + 0.5 ? 'menu'
        : 'all';
    }
    if (groups.length) areas.push({ label: label || null, labelKnown, hours: areaHours, hoursFrom, chooseCourses: areaProse.choose, groups });
  }
  return areas;
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
        console.log(`     ${c.code.padEnd(10)} ${String(c.credits ?? '?').padStart(3)}h  ${c.title.slice(0, 52)}${c.or ? '  (or ' + c.or.join(', ') + ')' : ''}`);
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

const index = await get(`${BASE}/undergraduate/`);
if (!index) { console.error('index unreachable'); process.exit(1); }

// /undergraduate/{college}/{program}/ and one level of concentration under it.
const paths = [...new Set([...index.matchAll(/href="(\/undergraduate\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\/)"/g)].map((m) => m[1]))];
console.log(`${paths.length} program pages`);

const DEGREE = /\b(bs|ba|bfa|bsn|barch|bla|bsba|bslas|bmus|bsw|bse)\b/;
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
writeFileSync('public/illinois-programs.json', JSON.stringify({
  school: 'illinois', source: `${BASE}/undergraduate/`, fetchedAt: new Date().toISOString(), programs: out,
}));
console.log(`\n${out.length} programs, ${out.filter((p) => p.courseCount).length} with course lists`);
