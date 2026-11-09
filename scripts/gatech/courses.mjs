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
 * PREREQUISITE PROSE is written in prereq-prose.mjs's group form (one ";"
 * segment per group, every group needing a course of its own, which is how
 * the engine's matcher reads it), with three data readings on top, each
 * documented where it is built: a lab's lecture and a course's single
 * prerequisites as what it guarantees (impliedIndex), the degree-informed
 * count for an Or whose alternatives need different numbers of courses
 * (chooseGroups), and the renumbered or replacement course a prerequisite also
 * accepts (alsoAccepts). Each row's prereqReading says how the result compares
 * with Banner's tree. measure-prereqs.mjs checks the round trip.
 * Run order when everything is rebuilt: courses.mjs, programs.mjs --offline,
 * offerings.mjs --parse-only, courses.mjs --offline again (it reads the
 * programs and offerings files), then build-index.mjs.
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
  liveTreeOf, deadAtomsOf, groupsOf, unevenOrsOf, impliedIndex, singleCodesOf, renderGroupsProse, compareReading, groupsAccept, treeAccepts, seededRandom,
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

  const stats = { prereqRead: 0, prereqNone: 0, prereqTable: 0, prereqMissing: 0, complex: 0, mixedNoParens: 0, quarterDropped: 0, unknownSubject: new Map(), coreqs: 0, coreqInProse: 0, standing: 0, creditMismatch: [], reading: new Map(), group: {} };

  /**
   * Corequisite tables, and the lab -> lecture pairs that go into the prose
   * (coreqInProse), read first: a lab's lecture is one of the courses the
   * group form (prereq-prose.mjs) knows the lab guarantees.
   */
  const coreqOf = new Map();
  const proseCoreqOf = new Map();
  for (const r of cat.rows) {
    const coHtml = banner.readCache('coreq', `${r.subject}_${r.number}`, 'html');
    if (coHtml === null) continue;
    const list = parseCoreqTable(coHtml).map((c) => {
      const codes = subjByDesc.get(c.subject.toLowerCase()) ?? [];
      return codes.map((s) => `${s} ${c.number}`).find((x) => catalogCodes.has(x)) ?? (codes[0] ? `${codes[0]} ${c.number}` : `${c.subject} ${c.number}`);
    }).filter((c) => c !== r.code);
    coreqOf.set(r.code, list);
    proseCoreqOf.set(r.code, list.filter((c) => catalogCodes.has(c) && coreqInProse(r.code, c)));
  }

  /**
   * Prerequisites in the matcher's group form (prereq-prose.mjs explains why
   * not the CNF). Two passes and a fixpoint: what a course guarantees (its
   * single-course groups and its lecture) is read off the groups, and the
   * groups are built knowing what each course guarantees.
   */
  /**
   * A prerequisite that names a course which has not run in nine terms, where
   * the catalog has its replacement, also accepts the replacement. ID 3032,
   * 3042 and 3052 need "ID 2022" in Banner, the Industrial Design Studio 2 the
   * degree page no longer lists (it lists ID 2024, "Industrial Design Studio
   * 2", which runs every spring), so every Industrial Design board booked the
   * old studio in its first fall to unlock its own junior studios. CEE 4406
   * needs CEE 4405, which is CEE 3400 under another number; CHEM 4512 needs
   * CHEM 4511, whose same-titled course CHEM 3521 is the one that runs.
   *   - The renumbered pairs of public/gatech-offerings.json (same title and
   *     description, scripts/gatech/offerings.mjs) accept each other.
   *   - A course with no section in nine terms and exactly one other course of
   *     the same title that has run (neither of them research, internship or
   *     special topics, and not two steps of one subject's sequence: same
   *     subject, under ten apart, same description) is also met by that one.
   * Banner's own wording stays in prereqGT; prereqAlsoAccepts lists each
   * addition. Without the offerings file there are none.
   */
  const offeringsRaw = existsSync('public/gatech-offerings.json') ? JSON.parse(readFileSync('public/gatech-offerings.json', 'utf8')) : null;
  const alsoAccepts = new Map();
  if (offeringsRaw) {
    const add = (a, b) => { if (!alsoAccepts.has(a)) alsoAccepts.set(a, new Set()); alsoAccepts.get(a).add(b); };
    for (const [now, before] of Object.entries(offeringsRaw.renumbered ?? {})) { add(now, before); add(before, now); }
    const ranOwn = (code) => (offeringsRaw.courses?.[code]?.length ?? 0) > 0 && !(code in (offeringsRaw.renumbered ?? {}));
    const NOISE_TITLE = /\b(assistantship|special topics)\b/i;
    const T = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const ug = cat.rows.filter((r) => Number.parseInt(r.number, 10) < GT_GRAD_LEVEL && !NOISE.test(r.title) && !NOISE_TITLE.test(r.title));
    const byTitle = new Map();
    for (const r of ug) {
      if (!byTitle.has(T(r.title))) byTitle.set(T(r.title), []);
      byTitle.get(T(r.title)).push(r);
    }
    for (const r of ug) {
      if (ranOwn(r.code) || alsoAccepts.has(r.code)) continue;
      const seq = (x) => x.subject === r.subject && Math.abs(Number.parseInt(x.number, 10) - Number.parseInt(r.number, 10)) < 10 && T(x.description) === T(r.description);
      const next = (byTitle.get(T(r.title)) ?? []).filter((x) => x.code !== r.code && ranOwn(x.code) && !seq(x));
      if (next.length === 1) add(r.code, next[0].code);
    }
  }
  /**
   * A course for non-majors, met by the majors' own course. MGT 3000
   * (Financial and Managerial Accounting) says "No credit allowed for MGT
   * majors. No credit allowed for MGT 3000 and ACCT 2101. Credit not allowed
   * for MGT 3000 and ACCT 2102." Banner's tables for MGT 4010, 4015, 4026,
   * 4030, 4041 and 4045 name MGT 3000 alone, so the Accounting concentration,
   * which requires ACCT 2101 and 2102 and those courses, could never meet them
   * (MGT 4026 and MGT 4010 sat on its board unmet, 2026-11-09); MGT 3659 and
   * MGT 4029 already read "ACCT 2101 or MGT 3000". Such a prerequisite also
   * accepts the courses the non-majors course names as no credit with it.
   */
  for (const r of cat.rows) {
    if (!/\bno credit (?:is )?(?:allowed|given|awarded) for [A-Za-z ]*majors\b/i.test(r.description ?? '')) continue;
    const esc = r.code.replace(' ', '\\s+');
    for (const m of (r.description ?? '').matchAll(new RegExp(String.raw`credit (?:is )?(?:not )?(?:allowed|given|awarded) for (?:both )?${esc} and ([A-Z]{2,4} \d{4}[A-Z]?)`, 'gi'))) {
      if (catalogCodes.has(m[1])) {
        if (!alsoAccepts.has(r.code)) alsoAccepts.set(r.code, new Set());
        alsoAccepts.get(r.code).add(m[1]);
      }
    }
  }
  const withAlternatives = (node) => {
    if (!node || node.op === 'false') return node;
    if (node.op === 'atom') {
      const alts = node.atom.kind === 'course' && node.atom.code ? [...(alsoAccepts.get(node.atom.code) ?? [])] : [];
      if (!alts.length) return node;
      return { op: 'or', kids: [node, ...alts.map((code) => ({ op: 'atom', atom: { ...node.atom, code, label: code, number: code.split(' ')[1], quarter: false, placeholder: false, added: true } }))] };
    }
    return { ...node, kids: node.kids.map(withAlternatives) };
  };

  const treeOf = new Map();
  for (const r of cat.rows) {
    const preHtml = banner.readCache('prereq', `${r.subject}_${r.number}`, 'html');
    if (preHtml === null) continue;
    const table = parsePrereqTable(preHtml);
    if (!table.rows.length) continue;
    const tree = prereqTreeOf(table.rows, { subjByDesc, known: catalogCodes });
    const named = new Set(tree.atoms.filter((a) => a.kind === 'course' && a.code).map((a) => a.code));
    const added = [...named].flatMap((c) => [...(alsoAccepts.get(c) ?? [])].filter((x) => !named.has(x) && x !== r.code).map((x) => [c, x]));
    const node = added.length ? withAlternatives(tree.node) : tree.node;
    treeOf.set(r.code, { table, tree, live: liveTreeOf(node, catalogCodes, r.code), added });
  }
  // How many prerequisite tables name each course: a rarely named course is the telling one (groupsOf).
  const named = new Map();
  for (const [, t] of treeOf) for (const c of new Set(t.tree.atoms.filter((a) => a.kind === 'course' && a.code).map((a) => a.code))) named.set(c, (named.get(c) ?? 0) + 1);
  const common = (code) => named.get(code) ?? 0;
  /**
   * Which way through an uneven Or the degrees take (prereq-prose.mjs groupsOf,
   * `pick`). ISYE 3133's "ISYE 2027 and MATH 2603 and CS 2316, or MATH 3215"
   * read at one course let Industrial Engineering boards take it the term
   * after MATH 2603, a term before ISYE 2027 (7 boards, 2026-11-09). Read at
   * three it is exact for them. So each count is tried on what the degrees
   * that name the course hold: for every program row list naming it, every
   * subset of the course's prerequisite courses that list holds (with what
   * each guarantees), and the reading that disagrees with Banner's tree least
   * often wins. On a tie, or with no degree naming the course, the smallest
   * count, which is never stricter than Banner. A degree counts for a course
   * only where it names it in a row list of at most 12 courses (a required
   * row or a real choice): Chemistry and Economics name ISYE 3133 inside
   * school-wide pools of hundreds, which says nothing about the way their
   * students would come to it.
   * public/gatech-programs.json is read when present (it is built after this
   * file, from the same catalog; only its course codes are used here).
   */
  const degreesNaming = new Map();
  /**
   * Research, internship and thesis courses a degree requires by name. NOISE
   * keeps them out of the planner's catalog (adaptIllinoisCatalog skips a
   * noise row) so they never fill a "pick any course" list, but where the page
   * prints one as a required row with its hours (Construction's BC 4680
   * Professional Internship, Public Policy's PUBP 2651 or 4651 internship) or
   * as one of a list of at most three (Chemistry's "Research Experience",
   * CHEM 4695 or CHEM 4699), leaving it out left the row unplannable: "None of
   * the 2 courses the catalog lists here are in this snapshot" on five
   * degrees, and BC 4630, which needs BC 4680, unplaced (2026-11-09). Those
   * courses are not noise; `noiseByTitle` keeps the title's reading for the
   * pools shape-programs.mjs builds.
   */
  const requiredByDegree = new Map();
  if (existsSync('public/gatech-programs.json')) {
    for (const p of JSON.parse(readFileSync('public/gatech-programs.json', 'utf8')).programs ?? []) {
      const codes = new Set();
      const named = new Set();
      for (const a of p.areas ?? []) for (const g of a.groups ?? []) {
        const list = g.courses ?? [];
        for (const c of list) {
          if (c.code) codes.add(c.code);
          for (const extra of Object.values(c.and ?? {}).flat()) codes.add(extra);
          if (c.code && list.length <= 12) named.add(c.code);
          if (c.code && ((c.credits != null && !c.indented) || list.length <= 3)) {
            for (const code of [c.code, ...(c.or ?? []), ...Object.values(c.and ?? {}).flat()]) {
              if (!requiredByDegree.has(code)) requiredByDegree.set(code, p.id);
            }
          }
        }
      }
      for (const c of named) {
        if (!degreesNaming.has(c)) degreesNaming.set(c, []);
        degreesNaming.get(c).push(codes);
      }
    }
  }
  const pickStats = { courses: 0, larger: 0 };
  const chooseGroups = (code, live, implied, groupStats) => {
    const base = { implied, common, stats: groupStats };
    const uneven = unevenOrsOf(live, { implied, common });
    if (uneven.length === 0) return groupsOf(live, base);
    const combos = [[]];
    for (const ks of uneven) {
      const next = [];
      for (const c of combos) for (const k of ks) next.push([...c, k]);
      combos.splice(0, combos.length, ...next);
      if (combos.length > 64) break;
    }
    const tries = combos.length > 64 ? [uneven.map((ks) => ks[0]), uneven.map((ks) => ks[ks.length - 1])] : combos;
    const random = seededRandom(code);
    const atoms = new Set();
    const walk = (n) => { if (!n || n.op === 'false') return; if (n.op === 'atom') { if (n.atom.kind === 'course') atoms.add(n.atom.code); return; } n.kids.forEach(walk); };
    walk(live);
    const closed = (list) => { const h = new Set(list); for (const c of list) for (const y of implied(c)) h.add(y); return h; };
    const scenes = [];
    for (const codes of degreesNaming.get(code) ?? []) {
      const S = [...atoms].filter((a) => codes.has(a) || [...codes].some((c) => implied(c).has(a)));
      if (!S.length) continue;
      const n = S.length <= 10 ? 2 ** S.length : 256;
      for (let t = 0; t < n; t += 1) scenes.push(closed(S.length <= 10 ? S.filter((_, i) => (t >> i) & 1) : S.filter(() => random() < 0.5)));
    }
    let best = null;
    for (const combo of tries) {
      const groups = groupsOf(live, { implied, common, pick: (i) => combo[i] });
      let errors = 0;
      for (const held of scenes) if (treeAccepts(live, (a) => held.has(a.code)) !== groupsAccept(groups, (a) => held.has(a.code))) errors += 1;
      if (!best || errors < best.errors) best = { combo, errors };
    }
    pickStats.courses += 1;
    if (best.combo.some((k, i) => k !== uneven[i][0])) pickStats.larger += 1;
    return groupsOf(live, { ...base, pick: (i) => best.combo[i] });
  };
  const groupsByCode = new Map();
  let implied = () => new Set();
  let lastSig = '';
  for (let pass = 0; pass < 6; pass += 1) {
    const groupStats = {};
    pickStats.courses = 0;
    pickStats.larger = 0;
    for (const [code, t] of treeOf) groupsByCode.set(code, chooseGroups(code, t.live, implied, groupStats));
    const direct = new Map();
    for (const r of cat.rows) {
      const own = singleCodesOf(groupsByCode.get(r.code));
      direct.set(r.code, new Set([...own, ...(proseCoreqOf.get(r.code) ?? [])]));
    }
    const next = impliedIndex(direct);
    const sig = cat.rows.map((r) => `${r.code}:${[...next(r.code)].sort().join(',')}`).join('|');
    implied = next;
    stats.group = { ...groupStats, ...pickStats, passes: pass + 1 };
    if (sig === lastSig) break;
    lastSig = sig;
  }

  const courses = [];
  for (const r of cat.rows) {
    const [subject, number] = [r.subject, r.number];
    const n = parseInt(number, 10);
    const b = bannerCodes.get(r.code);

    // Prerequisites from the Banner table.
    const preHtml = banner.readCache('prereq', `${subject}_${number}`, 'html');
    let prereqText = '', prereqGT = '', prereqCodes = [], prereqTests = [], prereqShape = null, prereqClauses = [], prereqAmbiguous = false;
    let prereqRetired = [], prereqReading = null, prereqAlsoAccepts = {};
    if (preHtml === null) stats.prereqMissing += 1;
    else {
      stats.prereqRead += 1;
      const t = treeOf.get(r.code);
      if (!t) stats.prereqNone += 1;
      else {
        stats.prereqTable += 1;
        const { table, tree, live } = t;
        if (tree.mixedWithoutParens) { stats.mixedNoParens += 1; prereqAmbiguous = true; }
        for (const d of tree.unknownSubjects) stats.unknownSubject.set(d, (stats.unknownSubject.get(d) ?? 0) + 1);
        const cnf = cnfOf(tree.node);
        if (cnf.quarterDropped) stats.quarterDropped += 1;
        const groups = groupsByCode.get(r.code);
        prereqGT = renderGTWording(table.rows, tree);
        prereqCodes = [...new Set(tree.atoms.filter((a) => a.kind === 'course' && a.code && catalogCodes.has(a.code) && a.code !== r.code).map((a) => a.code))];
        prereqTests = [...new Set(tree.atoms.filter((a) => a.kind === 'test').map((a) => `${a.test} ${a.score}`.trim()))];
        /** Alternatives no plan can hold (retired or renamed courses, transfer placeholders), by Banner's label. */
        prereqRetired = deadAtomsOf(tree.node, catalogCodes, r.code);
        for (const [was, now] of t.added) (prereqAlsoAccepts[was] ??= []).push(now);
        if (groups) {
          prereqText = renderGroupsProse(groups);
          prereqShape = groups.length > 1 ? 'and' : 'or';
          /** How the group form compares with Banner's tree, on held sets a plan can produce (prereq-prose.mjs). */
          prereqReading = compareReading(live, groups, implied, 400, seededRandom(r.code));
          // The same requirement as data: one entry per group, `any` the
          // catalog courses that satisfy it, `alt` the test scores that would.
          prereqClauses = groups.map((g) => ({
            any: [...new Set(g.filter((a) => a.kind === 'course').map((a) => a.code))],
            alt: g.filter((a) => a.kind === 'test').map((a) => `${a.test} ${a.score}`.trim()),
          }));
        } else {
          /**
           * Every way through the table names a course no plan can hold (AE
           * 4040, retired for AE 3021). The CNF is kept, as before: the
           * parser drops the codes it does not know, which leaves only the
           * current courses each way named, often none.
           */
          prereqReading = 'retired-only';
          prereqText = renderIllinoisProse(cnf);
          prereqShape = cnf.complex ? 'complex' : cnf.clauses.length > 1 ? 'and' : 'or';
          prereqClauses = cnf.complex ? [] : cnf.clauses.map((cl) => ({
            any: [...new Set(cl.filter((a) => a.kind === 'course' && a.code && catalogCodes.has(a.code) && a.code !== r.code).map((a) => a.code))],
            alt: cl.filter((a) => !(a.kind === 'course' && a.code && catalogCodes.has(a.code))).map((a) => (a.kind === 'test' ? `${a.test} ${a.score}`.trim() : a.label)),
          }));
        }
        stats.reading.set(prereqReading, (stats.reading.get(prereqReading) ?? 0) + 1);
      }
    }

    // Corequisites (read above).
    const coHtml = banner.readCache('coreq', `${subject}_${number}`, 'html');
    const coreqCodes = coreqOf.get(r.code) ?? [];
    if (coreqCodes.length) stats.coreqs += 1;
    const proseCoreqs = proseCoreqOf.get(r.code) ?? [];
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
      noise: NOISE.test(r.title) && !requiredByDegree.has(r.code),
      url: r.url,
      // ---- Georgia Tech extras (not in the Illinois file) ----
      /** What the title alone says (NOISE); `noise` is false where a degree requires the course by name (see requiredByDegree). */
      noiseByTitle: NOISE.test(r.title),
      ...(NOISE.test(r.title) && requiredByDegree.has(r.code) ? { requiredBy: requiredByDegree.get(r.code) } : {}),
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
      /**
       * How prereqText, read by the planner's matcher, compares with Banner's
       * tree (scripts/gatech/prereq-prose.mjs): 'exact', 'looser' (admits a
       * few held sets Banner would not, never blocks one it admits),
       * 'retired-only' (every way through names a course no plan can hold),
       * or null with no table.
       */
      prereqReading,
      /** Alternatives Banner names that no plan can hold: retired or renamed courses, transfer placeholders. */
      prereqRetired,
      /** Courses the prose also accepts beside one Banner names: its renumbering or replacement ({ "ID 2022": ["ID 2024"] }; see alsoAccepts). */
      ...(Object.keys(prereqAlsoAccepts).length ? { prereqAlsoAccepts } : {}),
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
  console.log(`  mixed And/Or without parentheses (prereqAmbiguous, read Or-first): ${stats.mixedNoParens}; quarter-system alternatives removed in ${stats.quarterDropped}`);
  console.log(`  group form against Banner's tree: ${[...stats.reading].sort().map(([k, v]) => `${k} ${v}`).join(', ')} (${stats.group.passes} passes; ${stats.group.courses} courses with an Or whose alternatives need different numbers of courses, ${stats.group.larger} of them read at a larger count because the degrees naming them take that way; ${stats.group.sharedMerged ?? 0} groups merged for a shared course)`);
  if (stats.unknownSubject.size) console.log(`  subjects named by description with no current code: ${[...stats.unknownSubject].map(([d, k]) => `${d} (${k})`).join(', ')}`);
  {
    const used = new Map();
    for (const c of courses) for (const [a, list] of Object.entries(c.prereqAlsoAccepts ?? {})) for (const b of list) used.set(`${a} -> ${b}`, (used.get(`${a} -> ${b}`) ?? 0) + 1);
    console.log(`prerequisites that also accept a renumbered or replacement course: ${courses.filter((c) => c.prereqAlsoAccepts).length} (${[...used].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`);
  }
  console.log(`corequisites: ${stats.coreqs} courses have one; ${stats.coreqInProse} lab/recitation pairs written into the prose`);
  console.log(`standing from restrictions: ${stats.standing} courses`);
  console.log(`attributes: ${courses.filter((c) => c.attributes.length).length} courses; gen ed (HUM/SS/ETHS): ${courses.filter((c) => c.genEd.length).length}`);
  console.log(`cross-listed: ${courses.filter((c) => c.sameAs.length).length}; noise: ${courses.filter((c) => c.noise).length} (research, internship and thesis courses a degree requires by name are not: ${courses.filter((c) => c.requiredBy).map((c) => c.code).join(', ') || 'none'}); no credit line: ${courses.filter((c) => c.credits == null).length}`);
  console.log(`credit lines that differ between catalog and Banner: ${stats.creditMismatch.length}${stats.creditMismatch.length ? `, e.g. ${stats.creditMismatch.slice(0, 5).join('; ')}` : ''}`);
  console.log(`Banner lists ${inBannerOnly.length} courses for ${TERM} that the catalog does not print (not added), e.g. ${inBannerOnly.slice(0, 8).join(', ')}`);
  console.log(`Banner requests this run: ${banner.requests}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
