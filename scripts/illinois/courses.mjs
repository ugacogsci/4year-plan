/**
 * The Illinois course catalog, as structured data.
 *
 * catalog.illinois.edu publishes every course under
 * /courses-of-instruction/{subject}/ as a run of <div class="courseblock">,
 * each holding a title line ("CS 173  Discrete Structures  credit: 3 Hours.")
 * and a description whose tail carries the prerequisite sentence with every
 * referenced course as a link. That link markup is the reason this parser can
 * be exact about prerequisites instead of guessing at prose: the catalog has
 * already told us which tokens are courses.
 *
 * robots.txt on catalog.illinois.edu disallows /search/, /cim/, /azindex/ and
 * a dozen admin paths. /courses-of-instruction/ is not among them.
 *
 * Output: public/illinois-catalog.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { decode } from 'node:querystring';

const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';
const BASE = 'https://catalog.illinois.edu';
const DELAY = 1200;            // robots.txt asks nothing, but the UGA crawl's pace is the house rule

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(40_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      return await res.text();
    } catch (err) {
      if (attempt === 2) { console.error(`  ! ${url} ${err.message}`); return null; }
      await sleep(3000 * (attempt + 1));
    }
  }
  return null;
}

const ent = (s) =>
  s.replace(/&#160;|&nbsp;/g, ' ')
   .replace(/&#8194;|&ensp;/g, ' ')
   .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
   .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

const text = (html) =>
  ent(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;.:])/g, '$1')   // "CS 124 , CS 125" -> "CS 124, CS 125"
    .trim();

/**
 * "credit: 3 Hours." / "credit: 1 to 4 Hours." / "credit: 0 Hours."
 * The range form is real (variable-credit courses), and a planner that reads
 * "1 to 4" as 1 undercounts a student's load by three hours a term.
 */
function parseCredits(s) {
  const range = s.match(/credit:\s*(\d+)\s*(?:to|-|or)\s*(\d+)\s*hour/i);
  if (range) return { credits: +range[1], creditsMax: +range[2] };
  const one = s.match(/credit:\s*(\d+)\s*hour/i);
  if (one) return { credits: +one[1], creditsMax: +one[1] };
  return { credits: null, creditsMax: null };
}

/**
 * Prerequisites, taken from the links the catalog itself marks as courses.
 *
 * The sentence is cut at "Prerequisite:" and every <a ... P=CS%20173> inside
 * it is a real course code. Anything before that sentence ("Credit is not
 * given for both CS 173 and MATH 213") is a different rule and must not be
 * read as a prerequisite, which is the trap in parsing the description whole.
 */
function parsePrereqs(descHtml) {
  const at = descHtml.search(/Prerequisite[s]?:/i);
  if (at < 0) return { prereqCodes: [], prereqText: '' };
  const tail = descHtml.slice(at);
  const codes = [];
  for (const m of tail.matchAll(/[?&]P=([A-Z]{2,4})(?:%20|\+|\s)(\d{3})\b/gi)) {
    const code = `${m[1].toUpperCase()} ${m[2]}`;
    if (!codes.includes(code)) codes.push(code);
  }
  const stop = tail.search(/This course satisfies the General Education/i);
  const only = stop >= 0 ? tail.slice(0, stop) : tail;
  return { prereqCodes: codes, prereqText: text(only).replace(/^Prerequisite[s]?:\s*/i, '').trim() };
}

/**
 * Gen-ed criteria, split on the <br/> the catalog uses as its only separator.
 *
 *   ...<br/>This course satisfies the General Education Criteria for:<br />
 *   Advanced Composition<br/>Humanities - Hist &amp; Phil</p>
 *
 * Stripping tags before splitting turns that into one run-on string with no
 * boundary between "Advanced Composition" and the next criterion, which is how
 * the first pass came back with zero gen-ed courses out of 9,440.
 */
function parseGenEd(descHtml) {
  const at = descHtml.search(/satisfies the General Education Criteria/i);
  if (at < 0) return [];
  const tail = descHtml.slice(at).replace(/^[^<]*(?:<br\s*\/?>)?/i, '');
  return tail
    .split(/<br\s*\/?>/i)
    .map((x) => text(x))
    .filter((x) => x && x.length < 60 && !/^This course/i.test(x));
}

/** Where the description proper ends: at the prerequisite or the gen-ed block. */
function cutAt(html) {
  const marks = [/Prerequisite[s]?:/i, /This course satisfies the General Education/i]
    .map((re) => html.search(re))
    .filter((i) => i >= 0);
  return marks.length ? html.slice(0, Math.min(...marks)) : html;
}

/**
 * Cross-listed entries carry no facts of their own, and reading them literally
 * makes the product lie.
 *
 * The catalog lists a cross-listed course once per department. One entry holds
 * the real text and the rest are pointers:
 *
 *   CS 407   "Same as ECE 407. See ECE 407."   prereqCodes: []
 *   ECE 407  "Cryptography is a powerful..."   prereqCodes: ["CS 225"]
 *
 * 1,262 of the 9,440 entries are pointers, 946 of them undergraduate. Taking
 * prereqCodes: [] at face value told students "the catalog lists no
 * prerequisite for this course" on a course that needs CS 225, and let the plan
 * generator put CS 407 three terms before the course it requires. Both were
 * found in review against this exact data.
 *
 * So each pointer inherits the canonical entry's facts and records where they
 * came from. The pointer keeps its own code, title and credit line, because
 * those are the department's and a student registers under them.
 */
function resolveCrossListings(all) {
  const byCode = new Map(all.map((c) => [c.code, c]));
  const POINTER = /\bSee\s+([A-Z]{2,4})\s?(\d{3})\b/;
  let resolved = 0, dangling = 0;

  for (const c of all) {
    const m = c.description.match(POINTER);
    if (!m) continue;
    const target = `${m[1]} ${m[2]}`;
    if (target === c.code) continue;

    // Follow at most a couple of hops and never a cycle: a pointer to a pointer
    // is rare but a loop would hang the crawl.
    let canon = byCode.get(target), hops = 0;
    const seen = new Set([c.code]);
    while (canon && POINTER.test(canon.description) && hops++ < 3) {
      const next = canon.description.match(POINTER);
      const nextCode = `${next[1]} ${next[2]}`;
      if (seen.has(nextCode)) break;
      seen.add(nextCode);
      canon = byCode.get(nextCode);
    }
    if (!canon || canon.code === c.code) { dangling++; c.crossListDangling = target; continue; }

    c.canonical = canon.code;
    // Only inherit what the pointer genuinely lacks. A department that wrote its
    // own description keeps it.
    if (!c.prereqCodes.length && canon.prereqCodes.length) c.prereqCodes = [...canon.prereqCodes];
    if (!c.prereqText && canon.prereqText) c.prereqText = canon.prereqText;
    if (!c.genEd.length && canon.genEd.length) c.genEd = [...canon.genEd];
    if (c.credits == null && canon.credits != null) { c.credits = canon.credits; c.creditsMax = canon.creditsMax; }
    if (POINTER.test(c.description)) {
      c.pointerText = c.description;              // keep what the catalog literally says
      c.description = canon.description;
      c.descriptionFrom = canon.code;             // so the UI can say where it came from
    }
    resolved++;
  }
  return { resolved, dangling };
}

/** Courses that never carry a real prerequisite chain and clutter a plan. */
const NOISE = /\b(independent study|thesis research|special problems|individual|professional development for graduate)\b/i;

function parseSubject(subject, html) {
  const out = [];
  for (const block of html.split('<div class="courseblock">').slice(1)) {
    const titleM = block.match(/class="courseblocktitle"[^>]*>([\s\S]*?)<\/p>/);
    if (!titleM) continue;
    const titleLine = text(titleM[1]);
    // "CS 173  Discrete Structures  credit: 3 Hours."
    const head = titleLine.match(/^([A-Z]{2,4})\s+(\d{3})\s+(.+?)\s+credit:/);
    if (!head) continue;
    const descM = block.match(/class="courseblockdesc"[^>]*>([\s\S]*?)<\/p>/);
    const descHtml = descM ? descM[1] : '';
    const description = text(descHtml);
    const descOnly = text(cutAt(descHtml));
    const { credits, creditsMax } = parseCredits(titleLine);
    const { prereqCodes, prereqText } = parsePrereqs(descHtml);

    const genEd = parseGenEd(descHtml);

    out.push({
      code: `${head[1]} ${head[2]}`,
      subject: head[1],
      number: head[2],
      level: Math.floor(+head[2] / 100) * 100,
      title: head[3].trim(),
      credits, creditsMax,
      description: descOnly,
      prereqCodes, prereqText,
      genEd,
      sameAs: [...new Set([...block.matchAll(/Same as\s*<a[^>]*P=([A-Z]{2,4})(?:%20|\+)(\d{3})/gi)].map((m) => `${m[1]} ${m[2]}`))],
      noise: NOISE.test(head[3]),
      url: `${BASE}/courses-of-instruction/${subject}/`,
    });
  }
  return out;
}

const index = await get(`${BASE}/courses-of-instruction/`);
if (!index) { console.error('index unreachable'); process.exit(1); }
const subjects = [...new Set([...index.matchAll(/href="\/courses-of-instruction\/([a-z]+)\/"/g)].map((m) => m[1]))];
console.log(`${subjects.length} subjects`);

const all = [];
for (const [i, s] of subjects.entries()) {
  const html = await get(`${BASE}/courses-of-instruction/${s}/`);
  if (!html) { console.log(`${String(i + 1).padStart(3)}/${subjects.length} ${s.toUpperCase().padEnd(6)} UNREACHABLE`); continue; }
  const rows = parseSubject(s, html);
  all.push(...rows);
  const withPre = rows.filter((r) => r.prereqCodes.length).length;
  console.log(`${String(i + 1).padStart(3)}/${subjects.length} ${s.toUpperCase().padEnd(6)} ${String(rows.length).padStart(4)} courses  ${String(withPre).padStart(4)} with prereqs`);
  await sleep(DELAY);
}

const xref = resolveCrossListings(all);
console.log(`\ncross-listings: ${xref.resolved} pointer entries resolved to their canonical course` + (xref.dangling ? `, ${xref.dangling} point at a course that is not in the catalog` : ''));

// A subject page that parses to zero courses is a parser failure, not an empty
// department, and it is silent unless something says so out loud.
const empty = subjects.filter((s) => !all.some((c) => c.subject === s.toUpperCase()));
if (empty.length) console.log(`\n!! ${empty.length} subject pages produced no courses: ${empty.join(' ')}`);

mkdirSync('public', { recursive: true });
writeFileSync('public/illinois-catalog.json', JSON.stringify({
  school: 'illinois',
  source: 'catalog.illinois.edu/courses-of-instruction',
  fetchedAt: new Date().toISOString(),
  courses: all,
}));
console.log(`\n${all.length} courses, ${all.filter((c) => c.prereqCodes.length).length} with prerequisites, ${all.filter((c) => c.genEd.length).length} with gen ed, ${all.filter((c) => c.canonical).length} cross-listed`);
