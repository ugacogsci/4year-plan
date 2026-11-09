/**
 * The Georgia Tech course catalog, as structured data in the Illinois schema.
 *
 * SOURCES
 *   https://catalog.gatech.edu/coursesaz/            subject index (CourseLeaf)
 *   https://catalog.gatech.edu/coursesaz/<subj>/     every course block: code,
 *     title, credit hours (ranges too), description, "Crosslisted with" links.
 *     The 2026-2027 catalog prints NO prerequisites in the course block, and its
 *     course bubbles live under /search/ and /ribbit/, which robots.txt disallows.
 *   https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/ (public
 *     "Browse Course Catalog", no login; see scripts/gatech/banner.mjs):
 *     the prerequisite table, the corequisite table, catalog attributes (Humanities,
 *     Social Science, Ethics ...) and Banner's own credit-hour fields, for term
 *     TERM below (Fall 2026, the first term of the 2026-2027 catalog).
 *
 * WRITES
 *   public/gatech-catalog.json  same top-level and per-course field names as
 *     public/illinois-catalog.json (school, source, fetchedAt, courses[] with
 *     code, subject, number, level, title, credits, creditsMax, description,
 *     prereqCodes, prereqText, prereqNote, genEd, sameAs, noise, url), plus a few
 *     Georgia Tech extras documented on the row builder below.
 *   data/gatech-raw/catalog/      raw catalog pages (via scripts/gatech/catalog-get.mjs)
 *   data/gatech-raw/banner-catalog/<term>/  raw Banner replies (lookup, listing,
 *     prereq, coreq, restriction)
 *   Re-parsing never needs a re-crawl: every reply is read back from the cache.
 *
 * HOW TO RUN (from the repo root)
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" node scripts/gatech/courses.mjs
 *       crawl whatever is not cached yet, in priority order, then build
 *   ... courses.mjs --offline
 *       build public/gatech-catalog.json from the cache only, no network
 *   ... courses.mjs --phases=catalog,listing,prereq-ug,coreq-pairs,sample,coreq-ug,restriction-ug,prereq-grad
 *       crawl only the named phases, then build (default: catalog, listing,
 *       prereq-ug, coreq-pairs, sample; see DEFAULT_PHASES for why)
 *   Then measure: node --experimental-strip-types scripts/gatech/measure-prereqs.mjs
 *
 * WHAT IT CANNOT KNOW
 *   - Concurrency. Banner's prerequisite table has no "may be taken concurrently"
 *     column, so no Georgia Tech prerequisite is marked concurrent. Banner
 *     corequisites are a separate list (coreqCodes); see coreqInProse below.
 *   - Prerequisites that are enforced outside the catalog table (Degree Works,
 *     department permission, major restrictions). Banner has NO table for many
 *     sequences a student would expect one for: every language course (FREN
 *     1002, SPAN 2002, CHIN 1002 ...; the section-level reply says the same),
 *     HIST, PHIL. Restrictions are read only for class standing, and a sample of
 *     104 undergraduate courses had no classification restriction at all (only
 *     campus and level), so restriction-ug is not in the default.
 *   - A prerequisite that names a retired course (AE 4040 -> AE 3021): the code
 *     is kept in the prose and in prereqClauses[].alt, and the Illinois parser
 *     drops it, so such a course reads as having no prerequisite (21 rows).
 *   - Corequisites outside lab/recitation pairs: the sample found 2 of 105
 *     (ARCH 3007, MATH 1111); coreq-ug (an hour) would find the rest.
 *   - Attributes of a course whose attribute was added after TERM.
 *   - Which subject a prerequisite means when Banner names a subject that is no
 *     longer offered: it is printed by its description and never matched to a code.
 *
 * Measured 2026-11-09 (Fall 2026): 5,133 courses (2,692 undergraduate); Banner
 * prerequisite replies for all 2,692 undergraduate courses, 1,187 with a table;
 * 1,204 with a clause naming a catalog course, every one of which parses into
 * structured groups with the one-line CODE_RE change in measure-prereqs.mjs and
 * none with the parser as it is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogGet, slugOf, BlockedError as CatalogBlocked } from './catalog-get.mjs';
import { Banner, BlockedError as BannerBlocked } from './banner.mjs';
import {
  parsePrereqTable, parseCoreqTable, parseRestrictions, prereqTreeOf, cnfOf, renderIllinoisProse, renderGTWording, standingSentence,
} from './prereq-prose.mjs';

export const TERM = '202608';
const CATALOG = 'https://catalog.gatech.edu';
const CATALOG_CACHE = 'data/gatech-raw/catalog';
const BANNER_CACHE = 'data/gatech-raw/banner-catalog';

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
/**
 * Crawl phases, most valuable first. coreq-pairs reads the corequisites of every
 * lab/recitation pair (BIOS 1107 + BIOS 1107L, CS 1301 + CS 1301R), and sample
 * reads corequisites and restrictions for a fixed sample of other undergraduate
 * courses, which is how coreq-ug and restriction-ug were judged worth (or not
 * worth) an hour each. All are cached, so any phase can be added later.
 */
const ALL_PHASES = ['catalog', 'listing', 'prereq-ug', 'coreq-pairs', 'sample', 'coreq-ug', 'restriction-ug', 'prereq-grad'];
/**
 * prereq-grad is not in the default: the planner never loads a 6000-level row
 * (adaptIllinoisCatalog drops level >= the graduate cut), and it is another
 * hour of requests. Run it with --phases=prereq-grad when graduate rows matter.
 */
const DEFAULT_PHASES = ['catalog', 'listing', 'prereq-ug', 'coreq-pairs', 'sample'];
const phasesArg = argv.find((a) => a.startsWith('--phases='));
const PHASES = OFFLINE ? [] : phasesArg ? phasesArg.slice(9).split(',') : DEFAULT_PHASES;
for (const p of PHASES) if (!ALL_PHASES.includes(p)) throw new Error(`unknown phase ${p}; known: ${ALL_PHASES.join(', ')}`);

/** Georgia Tech numbers: 1000-4999 undergraduate, 6000+ graduate (there is no 5000 tier in use). */
export const GT_GRAD_LEVEL = 5000;

// ---------------------------------------------------------------------------
// Catalog pages
// ---------------------------------------------------------------------------

const ent = (s) =>
  s.replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&#8194;|&ensp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

const text = (html) =>
  ent(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;.:])/g, '$1')
    .trim();

/** "CS 1301R" style: two to four capitals, four digits, an optional letter suffix. */
export const GT_CODE = /\b([A-Z]{2,4}) (\d{4}[A-Z]{0,2})\b/;

/**
 * "3 Credit Hours." / "1 Credit Hour." / "1-21 Credit Hours." / "3.5 Credit Hours."
 * The range form is real (variable credit) and reading "1-21" as 1 undercounts.
 */
function parseCredits(s) {
  const m = s.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|to|or)\s*(\d+(?:\.\d+)?))?\s+Credit Hours?\.?\s*$/i);
  if (!m) return { credits: null, creditsMax: null };
  return { credits: +m[1], creditsMax: m[2] ? +m[2] : +m[1] };
}

/** Courses that never carry a real prerequisite chain and clutter a plan (Illinois NOISE plus GT's own names). */
const NOISE = /\b(independent study|thesis research|special problems|individual|professional development for graduate|undergraduate research|doctoral thesis|master'?s thesis|dissertation|internship|co-?op\b|work experience|recitation)\b/i;

function parseSubjectPage(slug, html) {
  const out = [];
  for (const block of html.split(/<div class="courseblock[^"]*">/).slice(1)) {
    const titleM = block.match(/class="courseblocktitle"[^>]*>([\s\S]*?)<\/p>/);
    if (!titleM) continue;
    const titleLine = text(titleM[1]);
    // "CS 1331. Introduction to Object Oriented Programming. 3 Credit Hours."
    const head = titleLine.match(/^([A-Z]{2,4})\s+(\d{4}[A-Z]{0,2})\.\s+(.+?)\s+(\d+(?:\.\d+)?(?:\s*(?:-|to|or)\s*\d+(?:\.\d+)?)?\s+Credit Hours?\.?)\s*$/i);
    if (!head) { out.push({ unparsed: titleLine }); continue; }
    const descParts = [...block.matchAll(/class="courseblock(?:desc|extra)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/g)].map((m) => m[1]);
    const descHtml = descParts.join(' ');
    const description = text(descHtml);
    const { credits, creditsMax } = parseCredits(head[4]);
    // A doubled title ("Personal Health Informatics Personal Health Informatics", CS 6641) is a catalog typo.
    let title = head[3].replace(/\.+$/, '').trim();
    const twice = title.match(/^(.+?)\s+\1$/);
    if (twice) title = twice[1];
    // "Crosslisted with PSYC 3750." / "Cross-listed with ...": the linked codes in that sentence only.
    const sameAs = [];
    for (const m of descHtml.matchAll(/Cross-?\s*listed\s+with([\s\S]*?)(?:\.\s|\.<|\.$|<br)/gi)) {
      for (const c of m[1].matchAll(/P=([A-Z]{2,4})(?:%20|\+|\s)(\d{4}[A-Z]{0,2})/g)) sameAs.push(`${c[1]} ${c[2]}`);
      for (const c of text(m[1]).matchAll(new RegExp(GT_CODE.source, 'g'))) sameAs.push(`${c[1]} ${c[2]}`);
    }
    const code = `${head[1]} ${head[2]}`;
    out.push({
      code,
      subject: head[1],
      number: head[2],
      title,
      credits, creditsMax,
      description,
      sameAs: [...new Set(sameAs)].filter((c) => c !== code),
      url: `${CATALOG}/coursesaz/${slug}/`,
    });
  }
  return out;
}

async function crawlCatalog({ network }) {
  const get = (url) => {
    if (network) return catalogGet(url, { cacheDir: CATALOG_CACHE, refresh: false, log: (m) => console.log(`[catalog] ${m}`) });
    const file = join(CATALOG_CACHE, slugOf(url));
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
  const index = await get(`${CATALOG}/coursesaz/`);
  if (!index) throw new Error('catalog index unreadable');
  const slugs = [...new Set([...index.matchAll(/href="\/coursesaz\/([a-z0-9_-]+)\/"/g)].map((m) => m[1]))];
  const rows = [];
  const unparsed = [];
  const unreadable = [];
  for (const [i, slug] of slugs.entries()) {
    const html = await get(`${CATALOG}/coursesaz/${slug}/`);
    if (!html) { unreadable.push(slug); console.log(`[catalog] ${slug}: UNREADABLE`); continue; }
    const got = parseSubjectPage(slug, html);
    for (const r of got) (r.unparsed ? unparsed : rows).push(r.unparsed ? { slug, line: r.unparsed } : r);
    if (network) console.log(`[catalog] ${String(i + 1).padStart(3)}/${slugs.length} ${slug.toUpperCase().padEnd(5)} ${got.length} blocks`);
  }
  return { slugs, rows, unparsed, unreadable };
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

async function bannerListings(banner, catalogSubjects) {
  const subjects = await banner.lookup('subject');
  const attributes = await banner.lookup('attribute');
  // Catalog subjects only. Banner also lists 27 "PE: ..." professional-education
  // subjects (non-credit; DL answers HTTP 500 every time) that no degree uses.
  const codes = [...new Set(catalogSubjects)].sort();
  const bySubject = new Map();
  const failed = [];
  for (const [i, s] of codes.entries()) {
    try {
      const l = await banner.listing({ subject: s });
      bySubject.set(s, l.rows);
      if (!banner.offline) console.log(`[banner] listing ${String(i + 1).padStart(3)}/${codes.length} ${s.padEnd(5)} ${l.rows.length} courses`);
    } catch (e) {
      if (e instanceof BannerBlocked) throw e;
      failed.push(`subject ${s}: ${e.message}`);
    }
  }
  const byAttribute = new Map();
  for (const a of attributes) {
    try {
      const l = await banner.listing({ attribute: a.code });
      byAttribute.set(a.code, l.rows);
      if (!banner.offline) console.log(`[banner] attribute ${a.code.padEnd(5)} ${l.rows.length} courses`);
    } catch (e) {
      if (e instanceof BannerBlocked) throw e;
      failed.push(`attribute ${a.code}: ${e.message}`);
    }
  }
  if (failed.length) console.log(`[banner] !! listings not read: ${failed.join('; ')}`);
  return { subjects, attributes, bySubject, byAttribute, failed };
}

/** One detail kind for a list of [subject, number], cached, with progress and an ETA. */
async function crawlDetails(banner, kind, list, label) {
  let done = 0, fetched = 0, failedRun = 0;
  const failed = [];
  const t0 = Date.now();
  for (const [subject, number] of list) {
    const before = banner.requests;
    // One 15 s retry per course, and a breaker: three failures in a row is the
    // host in trouble rather than one broken course, so wait four minutes, and
    // six in a row ends the phase.
    const html = await banner.detail(kind, subject, number, { waits: [15_000] });
    done += 1;
    if (banner.requests > before) fetched += 1;
    if (html === null) {
      failed.push(`${subject} ${number}`);
      failedRun += 1;
      console.log(`[banner] ${kind} ${subject} ${number}: not read`);
      if (failedRun >= 6) { console.log(`[banner] ${label}: six failures in a row, stopping this phase`); break; }
      if (failedRun >= 3) await new Promise((r) => setTimeout(r, 240_000));
    } else failedRun = 0;
    if (fetched && fetched % 100 === 0 && banner.requests > before) {
      const per = (Date.now() - t0) / fetched;
      console.log(`[banner] ${label}: ${done}/${list.length} (${fetched} fetched), about ${Math.round(((list.length - done) * per) / 60000)} min left`);
    }
  }
  console.log(`[banner] ${label}: done, ${done} courses, ${fetched} fetched${failed.length ? `, ${failed.length} not read (${failed.slice(0, 10).join(', ')})` : ''}`);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * A corequisite goes into the prerequisite prose only when this course is the
 * lab or recitation of the course it names (BIOS 1107L -> BIOS 1107, CS 1301R ->
 * CS 1301). Banner lists the pair both ways round, and a concurrent group both
 * ways round is a cycle the planner may not be able to place. The suffixed
 * direction alone is acyclic and keeps a lab from landing before its lecture.
 * Every corequisite, either direction, stays in coreqCodes / coreqText.
 */
function coreqInProse(code, coreq) {
  const [s, n] = code.split(' ');
  const [cs, cn] = coreq.split(' ');
  return s === cs && n !== cn && n.startsWith(cn) && /^[A-Z]+$/.test(n.slice(cn.length));
}

async function main() {
  mkdirSync(BANNER_CACHE, { recursive: true });
  const banner = new Banner({ term: TERM, root: BANNER_CACHE, offline: OFFLINE, log: (m) => console.log(`[banner] ${m}`) });
  const want = (p) => PHASES.includes(p);

  // The two hosts are crawled side by side; each keeps its own pace.
  const catalogP = crawlCatalog({ network: !OFFLINE });
  let listingsP = null;
  if (want('listing')) listingsP = catalogP.then((c) => bannerListings(banner, [...new Set(c.rows.map((r) => r.subject))]));
  const cat = await catalogP;
  const listings = listingsP ? await listingsP : await bannerListings(banner, [...new Set(cat.rows.map((r) => r.subject))]);
  // Offline: bannerListings above reads only the cache; a missing listing would
  // throw from the network path, which is right, because a build without the
  // listings would silently lose credits and attributes.

  // The course universe: every catalog course, plus any course Banner lists for
  // the term that the catalog does not print (reported, not added to the file).
  const catalogCodes = new Set(cat.rows.map((r) => r.code));
  const bannerCodes = new Map();
  for (const rows of listings.bySubject.values()) for (const r of rows) bannerCodes.set(`${r.subjectCode} ${r.courseNumber}`, r);
  const universe = [...catalogCodes].map((c) => c.split(' '));
  const isUG = ([, n]) => parseInt(n, 10) < GT_GRAD_LEVEL;
  const ug = universe.filter(isUG);
  const grad = universe.filter((x) => !isUG(x));

  // Lab / recitation pairs: a code and the same code with a letter suffix.
  const baseOf = (c) => c.replace(/[A-Z]+$/, '');
  const byBase = new Map();
  for (const c of catalogCodes) {
    const b = baseOf(c);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(c);
  }
  const pairCodes = new Set([...byBase.values()].filter((v) => v.length > 1).flat());
  const pairs = ug.filter(([s, n]) => pairCodes.has(`${s} ${n}`));
  // A fixed, reproducible sample of the other undergraduate courses (every 25th by code).
  const others = ug.filter(([s, n]) => !pairCodes.has(`${s} ${n}`)).sort((a, b) => `${a}`.localeCompare(`${b}`));
  const sample = others.filter((_, i) => i % 25 === 0);

  try {
    if (want('prereq-ug')) await crawlDetails(banner, 'prereq', ug, 'undergraduate prerequisites');
    if (want('coreq-pairs')) await crawlDetails(banner, 'coreq', pairs, 'lab/recitation pair corequisites');
    if (want('sample')) {
      await crawlDetails(banner, 'coreq', sample, 'sample corequisites');
      await crawlDetails(banner, 'restriction', sample, 'sample restrictions');
    }
    if (want('coreq-ug')) await crawlDetails(banner, 'coreq', ug, 'undergraduate corequisites');
    if (want('restriction-ug')) await crawlDetails(banner, 'restriction', ug, 'undergraduate restrictions');
    if (want('prereq-grad')) await crawlDetails(banner, 'prereq', grad, 'graduate prerequisites');
  } catch (e) {
    if (e instanceof BannerBlocked || e instanceof CatalogBlocked) {
      console.log(`\n!! BLOCKED: ${e.message}\n!! Stopping the crawl; building from what is cached.`);
    } else throw e;
  }

  // Subject description -> code, for the prerequisite tables, which name subjects
  // by description ("Computer Science 1331").
  const subjByDesc = new Map();
  for (const s of listings.subjects) {
    const d = ent(s.description).trim().toLowerCase();
    if (!subjByDesc.has(d)) subjByDesc.set(d, []);
    subjByDesc.get(d).push(s.code);
  }
  const attrByCode = new Map(listings.attributes.map((a) => [a.code, ent(a.description)]));
  const attrsOf = new Map();
  for (const [a, rows] of listings.byAttribute) {
    for (const r of rows) {
      const c = `${r.subjectCode} ${r.courseNumber}`;
      if (!attrsOf.has(c)) attrsOf.set(c, []);
      attrsOf.get(c).push(a);
    }
  }
  /** Attributes that are degree requirements, i.e. Georgia Tech's gen-ed tags. */
  const GEN_ED_ATTRS = new Set(['HUM', 'SS', 'ETHS']);

  const stats = { prereqRead: 0, prereqNone: 0, prereqTable: 0, prereqMissing: 0, complex: 0, mixedNoParens: 0, quarterDropped: 0, unknownSubject: new Map(), coreqs: 0, coreqInProse: 0, standing: 0, creditMismatch: [] };
  const courses = [];
  for (const r of cat.rows) {
    const [subject, number] = [r.subject, r.number];
    const n = parseInt(number, 10);
    const b = bannerCodes.get(r.code);

    // Prerequisites from the Banner table.
    const preHtml = banner.readCache('prereq', `${subject}_${number}`, 'html');
    let prereqText = '', prereqGT = '', prereqCodes = [], prereqTests = [], prereqShape = null, prereqClauses = [], prereqAmbiguous = false;
    if (preHtml === null) stats.prereqMissing += 1;
    else {
      stats.prereqRead += 1;
      const table = parsePrereqTable(preHtml);
      if (!table.rows.length) stats.prereqNone += 1;
      else {
        stats.prereqTable += 1;
        const tree = prereqTreeOf(table.rows, { subjByDesc, known: catalogCodes });
        if (tree.mixedWithoutParens) { stats.mixedNoParens += 1; prereqAmbiguous = true; }
        for (const d of tree.unknownSubjects) stats.unknownSubject.set(d, (stats.unknownSubject.get(d) ?? 0) + 1);
        const cnf = cnfOf(tree.node);
        if (cnf.quarterDropped) stats.quarterDropped += 1;
        if (cnf.complex) stats.complex += 1;
        prereqText = renderIllinoisProse(cnf);
        prereqGT = renderGTWording(table.rows, tree);
        prereqCodes = [...new Set(tree.atoms.filter((a) => a.kind === 'course' && a.code && catalogCodes.has(a.code) && a.code !== r.code).map((a) => a.code))];
        prereqTests = [...new Set(tree.atoms.filter((a) => a.kind === 'test').map((a) => `${a.test} ${a.score}`.trim()))];
        prereqShape = cnf.complex ? 'complex' : cnf.clauses.length > 1 ? 'and' : 'or';
        // The same requirement as data: one entry per AND-ed clause, `any` the
        // catalog courses that satisfy it, `alt` everything else that would
        // (test scores, transfer placeholders, retired subjects).
        prereqClauses = cnf.complex ? [] : cnf.clauses.map((cl) => ({
          any: [...new Set(cl.filter((a) => a.kind === 'course' && a.code && catalogCodes.has(a.code) && a.code !== r.code).map((a) => a.code))],
          alt: cl.filter((a) => !(a.kind === 'course' && a.code && catalogCodes.has(a.code))).map((a) => (a.kind === 'test' ? `${a.test} ${a.score}`.trim() : a.label)),
        }));
      }
    }

    // Corequisites.
    const coHtml = banner.readCache('coreq', `${subject}_${number}`, 'html');
    let coreqCodes = [];
    if (coHtml !== null) {
      coreqCodes = parseCoreqTable(coHtml).map((c) => {
        const codes = subjByDesc.get(c.subject.toLowerCase()) ?? [];
        const code = codes.map((s) => `${s} ${c.number}`).find((x) => catalogCodes.has(x)) ?? (codes[0] ? `${codes[0]} ${c.number}` : `${c.subject} ${c.number}`);
        return code;
      }).filter((c) => c !== r.code);
      if (coreqCodes.length) stats.coreqs += 1;
    }
    const proseCoreqs = coreqCodes.filter((c) => catalogCodes.has(c) && coreqInProse(r.code, c));
    if (proseCoreqs.length) {
      stats.coreqInProse += 1;
      prereqClauses.push({ any: proseCoreqs, alt: [], concurrent: true });
      const clause = `Credit or concurrent registration in ${proseCoreqs.join(' or ')}.`;
      prereqText = prereqText ? `${prereqText} ${clause}` : clause;
      for (const c of proseCoreqs) if (!prereqCodes.includes(c)) prereqCodes.push(c);
    }

    // Class standing, from Banner restrictions ("Must be enrolled in one of the following Classifications").
    const reHtml = banner.readCache('restriction', `${subject}_${number}`, 'html');
    let restrictions = null;
    if (reHtml !== null) {
      restrictions = parseRestrictions(reHtml);
      const sentence = standingSentence(restrictions);
      if (sentence) {
        stats.standing += 1;
        prereqText = prereqText ? `${prereqText} ${sentence}` : sentence;
      }
    }

    const attrs = (attrsOf.get(r.code) ?? []).sort();
    if (b) {
      const lo = b.creditHourLow, hi = b.creditHourHigh ?? b.creditHourLow;
      // Banner's "0 OR 3" (an audit / zero-credit registration option beside the
      // real hours) is not a disagreement with the catalog's 3.
      const zeroOr = lo === 0 && b.creditHourIndicator === 'OR' && hi === r.creditsMax;
      if (lo != null && r.credits != null && !zeroOr && (lo !== r.credits || hi !== r.creditsMax)) stats.creditMismatch.push(`${r.code} catalog ${r.credits}-${r.creditsMax} banner ${lo}${b.creditHourIndicator ? ` ${b.creditHourIndicator} ` : '-'}${hi}`);
    }
    let { credits, creditsMax } = r;
    if (credits == null && b?.creditHourLow != null) { credits = b.creditHourLow; creditsMax = b.creditHourHigh ?? b.creditHourLow; }

    courses.push({
      code: r.code,
      subject,
      number,
      // Georgia Tech's own tier: 1000, 2000, 3000, 4000 undergraduate; 6000+
      // graduate. NOT the Illinois 100-500 scale: the engine's graduate cut
      // (ILLINOIS_GRAD_LEVEL = 500) must be GT_GRAD_LEVEL (5000) for this file.
      level: Math.floor(n / 1000) * 1000,
      title: r.title,
      credits, creditsMax,
      description: r.description,
      prereqCodes,
      prereqText,
      // Georgia Tech has no prose prerequisite notes; the table is the answer,
      // and a course with no table row has no catalog prerequisite in Banner.
      prereqNote: '',
      genEd: attrs.filter((a) => GEN_ED_ATTRS.has(a)).map((a) => attrByCode.get(a) ?? a),
      sameAs: r.sameAs,
      noise: NOISE.test(r.title),
      url: r.url,
      // ---- Georgia Tech extras (not in the Illinois file) ----
      /** Every Banner catalog attribute, code and description ("SS", "Social Science Requirement"). */
      attributes: attrs.map((a) => ({ code: a, description: attrByCode.get(a) ?? a })),
      /** The prerequisite in Georgia Tech's own wording, rebuilt from the Banner table. */
      prereqGT,
      /** Test-score alternatives named in the table ("ACT Math 28"). */
      prereqTests,
      /** The prerequisite as data (AND of these clauses; see above). Empty when complex. */
      prereqClauses,
      /**
       * Banner's table mixes And and Or with no parentheses; read with Or
       * binding tighter (scripts/gatech/prereq-prose.mjs explains why). The
       * product should hedge on these, as it does on Illinois low confidence.
       */
      prereqAmbiguous,
      /** 'or' (one clause), 'and' (several), 'complex' (CNF too large; prose is the original nesting). */
      prereqShape,
      /** null when the Banner prerequisite reply is not cached (not read != none). */
      prereqRead: preHtml !== null,
      coreqCodes,
      coreqRead: coHtml !== null,
      /** Classification (standing) and other Banner restrictions, when read. */
      ...(restrictions ? { restrictions } : {}),
      ...(b ? { college: b.college ?? null, department: b.department ?? null } : {}),
    });
  }

  // Transfer placeholders ("AE 1XXX", "MATH 1X52") are not courses anyone registers for.
  const inBannerOnly = [...bannerCodes.keys()].filter((c) => !catalogCodes.has(c) && !/X/.test(c.split(' ')[1]));
  mkdirSync('public', { recursive: true });
  writeFileSync('public/gatech-catalog.json', JSON.stringify({
    school: 'gatech',
    source: 'catalog.gatech.edu/coursesaz + registration.banner.gatech.edu course catalog (prerequisites, corequisites, attributes)',
    fetchedAt: new Date().toISOString(),
    term: TERM,
    courses,
  }));

  // ---- Report ----
  const bySubj = new Map();
  for (const c of courses) {
    const s = bySubj.get(c.subject) ?? { n: 0, ug: 0, pre: 0, read: 0 };
    s.n += 1; if (c.level < GT_GRAD_LEVEL) s.ug += 1; if (c.prereqText) s.pre += 1; if (c.prereqRead) s.read += 1;
    bySubj.set(c.subject, s);
  }
  console.log('\nsubject  courses  undergrad  prereq-read  with-prereq');
  for (const [s, v] of [...bySubj].sort()) console.log(`${s.padEnd(6)} ${String(v.n).padStart(8)} ${String(v.ug).padStart(10)} ${String(v.read).padStart(12)} ${String(v.pre).padStart(12)}`);
  console.log(`\n${courses.length} catalog courses in ${bySubj.size} subjects (${cat.slugs.length} subject pages; unreadable: ${cat.unreadable.join(' ') || 'none'})`);
  const placeholders = cat.unparsed.filter((u) => /^[A-Z]{2,4} [0-9X]{4}\b/.test(u.line) && /X/.test(u.line.split('.')[0]));
  const reallyUnparsed = cat.unparsed.filter((u) => !placeholders.includes(u));
  if (placeholders.length) console.log(`${placeholders.length} transfer/elective placeholder blocks skipped ("AE 1XXX. Aerospace Engineering Elective."), not courses`);
  if (reallyUnparsed.length) console.log(`!! ${reallyUnparsed.length} course blocks with an unparsable title line, e.g. ${reallyUnparsed.slice(0, 3).map((u) => JSON.stringify(u.line)).join(', ')}`);
  {
    const sampleRead = sample.filter(([s, n]) => banner.readCache('coreq', `${s}_${n}`, 'html') !== null);
    const withCo = sampleRead.filter(([s, n]) => parseCoreqTable(banner.readCache('coreq', `${s}_${n}`, 'html')).length > 0);
    const reRead = sample.filter(([s, n]) => banner.readCache('restriction', `${s}_${n}`, 'html') !== null);
    const withStanding = reRead.filter(([s, n]) => standingSentence(parseRestrictions(banner.readCache('restriction', `${s}_${n}`, 'html'))));
    const withClass = reRead.filter(([s, n]) => parseRestrictions(banner.readCache('restriction', `${s}_${n}`, 'html')).some((x) => /classification/i.test(x.heading)));
    console.log(`lab/recitation pair courses: ${pairs.length}; sample of other undergraduate courses: ${sample.length}`);
    console.log(`  sample: ${withCo.length}/${sampleRead.length} have a corequisite (${withCo.map((x) => x.join(' ')).join(', ') || 'none'}); ${withClass.length}/${reRead.length} have a classification restriction, ${withStanding.length} of them a standing floor (${withStanding.map((x) => x.join(' ')).join(', ') || 'none'})`);
  }
  console.log(`Banner prerequisite replies cached for ${stats.prereqRead} courses (${stats.prereqMissing} not read yet): ${stats.prereqTable} have a table, ${stats.prereqNone} say none`);
  console.log(`  mixed And/Or without parentheses (prereqAmbiguous, read Or-first): ${stats.mixedNoParens}; CNF too large (kept nested): ${stats.complex}; quarter-system alternatives removed in ${stats.quarterDropped}`);
  if (stats.unknownSubject.size) console.log(`  subjects named by description with no current code: ${[...stats.unknownSubject].map(([d, k]) => `${d} (${k})`).join(', ')}`);
  console.log(`corequisites: ${stats.coreqs} courses have one; ${stats.coreqInProse} lab/recitation pairs written into the prose`);
  console.log(`standing from restrictions: ${stats.standing} courses`);
  console.log(`attributes: ${courses.filter((c) => c.attributes.length).length} courses; gen ed (HUM/SS/ETHS): ${courses.filter((c) => c.genEd.length).length}`);
  console.log(`cross-listed: ${courses.filter((c) => c.sameAs.length).length}; noise: ${courses.filter((c) => c.noise).length}; no credit line: ${courses.filter((c) => c.credits == null).length}`);
  console.log(`credit lines that differ between catalog and Banner: ${stats.creditMismatch.length}${stats.creditMismatch.length ? `, e.g. ${stats.creditMismatch.slice(0, 5).join('; ')}` : ''}`);
  console.log(`Banner lists ${inBannerOnly.length} courses for ${TERM} that the catalog does not print (not added), e.g. ${inBannerOnly.slice(0, 8).join(', ')}`);
  console.log(`Banner requests this run: ${banner.requests}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
