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
 * accepts (alsoAccepts). Three more read the catalog's own words where
 * Banner's table falls short, each documented where it is built in main():
 * the earlier part of a sequence a description names (sequencePartsOf,
 * prereqFromDescription), a required course the catalog says is taken in
 * tandem (tandemCourses, prereqConcurrentFromDescription) and a required
 * course that has not run anywhere in nine terms while the course needing it
 * did (prereqDormant). Each row's prereqReading says how the result compares
 * with Banner's tree. measure-prereqs.mjs checks the round trip.
 * Titles that are description fragments take Banner's title
 * (sentenceTitleOf), and `audience` marks courses the catalog says are for
 * heritage learners or first-year students only (audienceOf).
 * Cross-listings the catalog's "Crosslisted with" links miss are added to
 * sameAs (crossListingsOf, sameAsFrom; it also reads Banner's section
 * cross-list groups, data/gatech-raw/banner/<term>/, cached by offerings.mjs),
 * and credit exclusions worded in ways the engine's reader does not take
 * ("Students cannot receive credit for ...", "No credit allowed for ...",
 * "CS 4001 and 4002") are read pair by pair (creditExclusionsOf,
 * exclusionsFromText; build-index.mjs adds them to exclusions.json).
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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
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

// ---------------------------------------------------------------------------
// Readings of the catalog's own words (titles, descriptions)
// ---------------------------------------------------------------------------

/** Lower-case words only, so "two-semester" and "Two semester" compare equal. */
const wordsOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .replace(/\btwo\b/g, '2').replace(/\bthree\b/g, '3').replace(/\bfour\b/g, '4');
const SMALL_WORDS = new Set('a an and as at but by for from in into of on or the to with vs via per'.split(' '));

/**
 * A catalog title that is really the opening of the course's description.
 * CS 3311's course block reads "CS 3311. Part 1 of a 2 semester project design
 * and implementation sequence conjoined with Tech Communications. 1 Credit
 * Hour." Its description begins with the same words, and Banner's catalog
 * listing titles the course "Project Design" (CS 3312 is "Project
 * Implementation" in both). A title is read as a description fragment when
 * (1) the description begins with the title's words, (2) the title is at least
 * eight words long, and (3) it is not in title case: three or more of its
 * words after the first start with a lower-case letter and are not small
 * words (of, and, the ...). Real titles in sentence case ("Three-dimensional
 * rigid body dynamics", ME 2205) fail (1) or (2); long title-case titles that
 * the description repeats ("Introduction to the History of Disease and
 * Medicine", HTS 2080) fail (3). The replacement is Banner's courseTitle,
 * the only other title field Georgia Tech publishes; with no Banner title the
 * catalog's is kept. Measured 2026-11-09: 1 course (CS 3311).
 */
export function sentenceTitleOf(row, bannerTitle) {
  const title = String(row.title ?? '');
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 8 || !bannerTitle) return null;
  const t = wordsOf(title);
  const lower = words.slice(1).filter((w) => /^[a-z]/.test(w) && !SMALL_WORDS.has(w.replace(/[^a-z]/g, ''))).length;
  if (lower < 3) return null;
  if (!wordsOf(row.description).startsWith(t.split(' ').slice(0, 8).join(' '))) return null;
  const fixed = String(bannerTitle).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return fixed && fixed !== title ? fixed : null;
}

/**
 * Who a course is for, when the catalog says it is meant for one group of
 * students only. index.json carries it as `audience`, so a plan does not fill
 * an open elective with a course its student cannot take.
 *   'heritage-learners'  the title or description says the course is for
 *       heritage learners, speakers or students: "Chinese for Heritage
 *       Learners I", "geared for heritage learners" (CHIN 1011), "For heritage
 *       students in the U.S." (HEBW 1501), "Russian for Heritage Speakers".
 *       The word must be followed by learners, speakers or students:
 *       "Heritage and Values of the Air Force" (AS 1110) and archaeology's
 *       "heritage management" (HTS 1090) are not.
 *   'first-year'  a seminar whose title names first-year students or freshmen
 *       ("First-Year Seminar" GT 1000, "First Year Business Seminar" MGT 1100,
 *       "Freshman Engineering Seminar" COE 1000), or a description that says
 *       the course is for first-year students or freshmen and does not also
 *       open it to sophomores: "Small group discussions with first year
 *       students" (CS 1100 Pathways in Computing), "a summer residential
 *       program for incoming freshman" (GT 0900), "multidisciplinary teams of
 *       freshmen" (GT 1201), "a technical role commensurate with freshman
 *       standing" (AE 1355). Internships and research "for freshmen and
 *       sophomores" are open to two years, so they are not first-year.
 * Measured 2026-11-09 on the undergraduate catalog: 10 heritage-learners
 * courses, 7 first-year courses.
 */
export function audienceOf(row) {
  const title = String(row.title ?? '');
  const desc = String(row.description ?? '');
  const both = `${title}. ${desc}`;
  if (/\bheritage\s+(?:learners?|speakers?|students?)\b/i.test(both) && !/\bnot (?:open|intended) (?:to|for) heritage|\bnon-heritage\b/i.test(both)) return 'heritage-learners';
  if (/\bsophomores?\b|\bsophmores?\b|\bsecond[- ]year\b|\btransfer students?\b/i.test(both)) return null;
  if (/\bseminar\b/i.test(title) && /\b(?:first[- ]year|freshman|freshmen)\b/i.test(title) && !/\b(?:phd|graduate|doctoral)\b/i.test(title)) return 'first-year';
  if (/\b(?:for|with|of)\s+(?:the\s+)?(?:incoming\s+|entering\s+)?(?:first[- ]years?\s+students?|first[- ]years\b|freshm[ae]n\b)/i.test(desc)) return 'first-year';
  if (/\bcommensurate with freshman standing\b/i.test(desc)) return 'first-year';
  return null;
}

/**
 * The earlier part of a sequence, read from the course's own description,
 * where Banner's prerequisite table does not name it. CS 3312 "Project
 * Implementation" says "The second part of a 2 semester project design and
 * implementation sequence ... Implement a project designed in CS 3311", but
 * its table is "CS 2340 and LMC 3432", so a plan put CS 3312 in Spring 2029
 * and CS 3311 in Fall 2029 (2026-11-09). Banner has no table at all for most
 * language courses ("Continuation of HEBW 1001", HEBW 1002).
 *
 * Five readings, each of the catalog's words and nothing else:
 *   names it    a backward phrase followed at once by a course code:
 *               "continuation of", "continues", "follow-up to", "sequel to",
 *               "designed in", "initiated in", "begun in", "started in"
 *               ("Implement a project designed in CS 3311"; "a team-oriented
 *               design experience initiated in BMED 4602"; "follow-up to
 *               ISyE 3103"). A code followed by "or" is an alternative, not
 *               a requirement ("The continuation of HEBW 1501 or for
 *               intermediate-level heritage students"), and is left out.
 *   by title    "continuation of" followed by the title of a lower-numbered
 *               course in the same subject ("Continuation of Abstract Algebra
 *               I" is MATH 4107; "continuation of Construction Technology I"
 *               is BC 2610). The longest matching title wins, so "Abstract
 *               Algebra I" never reads as "Abstract Algebra II".
 *   ordinal     "second/third/fourth part|half|course|semester of", "the
 *               second of", "Part 2 of": the earlier part is the one
 *               lower-numbered course of the same subject that is the
 *               previous step of the same sequence (its own "first ... of" or
 *               "Part 1 of" names the same first five words), or, when no
 *               course numbers itself, the one lower-numbered course whose
 *               description holds those five words. "The second part of an
 *               introduction to the German language and the culture of the
 *               German-speaking world" (GRMN 1002) is GRMN 1001 ("An
 *               introduction to the German language and the culture of the
 *               German-speaking world"); "Second half of advanced courses in
 *               Russian conversation and composition" (RUSS 3002) is RUSS
 *               3001 ("First half of ..."). More than one candidate: none.
 *   names next  the earlier course names the later one: "Project is completed
 *               in CS 3312" (CS 3311), "continued in", "concluded in",
 *               "followed by".
 *   same words  courses of one subject with the very same description, which
 *               calls itself "part of a ... sequence", numbered one apart:
 *               each needs the one numbered just below it. LMC 3431
 *               "Technical Communication Approaches" and LMC 3432 "Technical
 *               Communication Strategies" both read "Part of a multi-semester
 *               sequence that students take in tandem with major-specific
 *               classes", so LMC 3432 needs LMC 3431.
 *   title steps a language's own titled ladder, within one subject: "Elementary
 *               French I", "Elementary French II", "Intermediate French I",
 *               "Intermediate French II", then "Intermediate X III",
 *               "Advanced X I", "Advanced X II" where the subject has them;
 *               each step needs the step just below it that the subject
 *               has, with the same language words ("Elementary Chinese I"
 *               and "Accelerated Elementary Chinese I" are different
 *               ladders). Banner has no prerequisite table for any language
 *               course and the descriptions say only "Continued listening,
 *               speaking, reading, and writing in French", so with nothing
 *               to order them Applied Languages boards booked FREN 2001 in
 *               Spring 2027 and FREN 1001 and 1002 in Fall 2029, CHIN 1001
 *               after CHIN 2001 and 2002, and RUSS 1001 after RUSS 1002
 *               (2026-11-09). The title is the catalog's word for which
 *               step a course is; a student who places higher holds the
 *               lower steps by exam credit, which meets them. main() adds a
 *               step only where the step below has run in Atlanta in a fall
 *               or spring (SPAN 1001 and 1002 run only in summers).
 * "names it" also reads "continuation to" (HIN 1002: "A continuation to HIND
 * 1001"), and a subject the description spells with letters added to the
 * course's own subject (HIND for HIN) is read as the course's own subject
 * when that course exists.
 * The earlier part is a prerequisite of the ordinary kind (an earlier term),
 * never the same term: the catalog says "2 semester", "second half". Where a
 * description says a course is taken in tandem with others, that is the
 * tandem rule below (tandemCourses), which is about the course that names it.
 * Returns Map(code -> [{ code, words, how }]); main() drops a part the
 * table already names (CHEM 1212K's "CHEM 1211K or CHEM 1310") and a part
 * that would make a cycle.
 */
export function sequencePartsOf(rows, gradLevel = 5000) {
  const ug = rows.filter((r) => Number.parseInt(r.number, 10) < gradLevel);
  const byCode = new Map(ug.map((r) => [r.code, r]));
  const bySubject = new Map();
  for (const r of ug) {
    if (!bySubject.has(r.subject)) bySubject.set(r.subject, []);
    bySubject.get(r.subject).push(r);
  }
  const n = (r) => Number.parseInt(r.number, 10);
  const out = new Map();
  const skipped = [];
  const sentence = (desc, at) => {
    const start = Math.max(desc.lastIndexOf('. ', at) + 2, 0);
    const end = desc.indexOf('.', at);
    return desc.slice(start === 1 ? 0 : start, end < 0 ? undefined : end + 1).trim();
  };
  const add = (x, e, words, how) => {
    if (!byCode.has(e) || e === x) return;
    if (!out.has(x)) out.set(x, []);
    const list = out.get(x);
    const had = list.findIndex((p) => p.code === e);
    // The course's own words are the better evidence than the earlier course's "completed in".
    if (had < 0) list.push({ code: e, words, how });
    else if (list[had].how === 'names next' && how !== 'names next') list[had] = { code: e, words, how };
  };
  const BACK = /\b(continuation (?:of|to)|continues|follow-?up to|sequel to|designed in|initiated in|begun in|started in)\s+([A-Za-z]{2,4})\s?(\d{4}[A-Z]?)\b(\s+or\b)?/gi;
  // "HIND 1001" in HIN 1002's description: a subject spelled with letters added to the course's own.
  const codeNamed = (r, subj, num) => {
    const said = `${subj.toUpperCase()} ${num}`;
    if (byCode.has(said)) return said;
    const own = `${r.subject} ${num}`;
    return subj.toUpperCase().startsWith(r.subject) && subj.length > r.subject.length && byCode.has(own) ? own : said;
  };
  const NEXT = /\b(?:completed|continued|concluded) in\s+([A-Za-z]{2,4})\s?(\d{4}[A-Z]?)\b|\bfollowed by\s+([A-Za-z]{2,4})\s?(\d{4}[A-Z]?)\b/gi;
  const ORD_WORD = { first: 1, second: 2, third: 3, fourth: 4 };
  const ORD_PART = { 1: 1, 2: 2, 3: 3, 4: 4, i: 1, ii: 2, iii: 3, iv: 4, one: 1, two: 2, three: 3, four: 4 };
  const ordinalOf = (desc) => {
    const a = desc.match(/\b(first|second|third|fourth)\s+(?:(?:part|half|course|semester)\s+(?:of|in)|of)\s+(?:an?\s+|the\s+)?([^.;]{8,})/i);
    const b = desc.match(/\bpart\s+(1|2|3|4|iv|iii|ii|i|one|two|three|four)\s+of\s+(?:an?\s+|the\s+)?([^.;]{8,})/i);
    const m = a ?? b;
    if (!m) return null;
    const k = a ? ORD_WORD[m[1].toLowerCase()] : ORD_PART[m[1].toLowerCase()];
    return { k, key: wordsOf(m[2]).split(' ').slice(0, 5).join(' '), at: m.index };
  };
  for (const r of ug) {
    const desc = String(r.description ?? '');
    for (const m of desc.matchAll(BACK)) {
      const code = codeNamed(r, m[2], m[3]);
      if (!byCode.has(code)) continue;
      if (m[4]) { skipped.push({ code: r.code, part: code, why: `"${m[0].trim()}": the description gives another way in` }); continue; }
      add(r.code, code, sentence(desc, m.index), 'names it');
    }
    for (const m of desc.matchAll(/\bcontinuation of\s+(?:the\s+)?([^.;,]+)/gi)) {
      const said = ` ${wordsOf(m[1])} `;
      let best = null;
      for (const s of bySubject.get(r.subject) ?? []) {
        if (s.code === r.code || n(s) >= n(r)) continue;
        const t = wordsOf(s.title);
        if (t.split(' ').length < 2 || !said.startsWith(` ${t} `)) continue;
        if (!best || t.length > wordsOf(best.title).length) best = s;
      }
      if (best) add(r.code, best.code, sentence(desc, m.index), 'by title');
    }
    for (const m of desc.matchAll(NEXT)) {
      const later = `${(m[1] ?? m[3]).toUpperCase()} ${m[2] ?? m[4]}`;
      if (byCode.has(later) && later !== r.code) add(later, r.code, `${r.code}: ${sentence(desc, m.index)}`, 'names next');
    }
    const ord = ordinalOf(desc);
    if (ord && ord.k >= 2 && ord.key.split(' ').length >= 3) {
      const lower = (bySubject.get(r.subject) ?? []).filter((s) => s.code !== r.code && n(s) < n(r));
      const stepBefore = lower.filter((s) => { const o = ordinalOf(String(s.description ?? '')); return o && o.k === ord.k - 1 && o.key === ord.key; });
      const holding = lower.filter((s) => !ordinalOf(String(s.description ?? '')) && ` ${wordsOf(s.description)} `.includes(` ${ord.key} `));
      const pick = stepBefore.length === 1 ? stepBefore[0] : stepBefore.length === 0 && holding.length === 1 ? holding[0] : null;
      if (pick) add(r.code, pick.code, sentence(desc, ord.at), 'ordinal');
      else if (stepBefore.length + holding.length > 1) skipped.push({ code: r.code, part: [...stepBefore, ...holding].map((s) => s.code).join(' or '), why: 'more than one earlier course reads as the step before' });
    }
  }
  const SEQ = /\bpart of an? (?:[a-z0-9-]+ )?sequence\b/i;
  for (const list of bySubject.values()) {
    const same = new Map();
    for (const r of list) {
      if (!SEQ.test(String(r.description ?? ''))) continue;
      const k = wordsOf(r.description);
      if (!same.has(k)) same.set(k, []);
      same.get(k).push(r);
    }
    for (const group of same.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => n(a) - n(b));
      for (let i = 1; i < group.length; i += 1) {
        if (n(group[i]) - n(group[i - 1]) !== 1) continue;
        const d = String(group[i].description);
        add(group[i].code, group[i - 1].code, sentence(d, d.search(SEQ)), 'same words');
      }
    }
  }
  // Title steps: "Elementary French I" < "Elementary French II" < "Intermediate French I" < ...
  const STEP = /^(Elementary|Intermediate|Advanced)\s+(.+?)\s+(I|II|III)$/i;
  const LADDER = ['elementary i', 'elementary ii', 'intermediate i', 'intermediate ii', 'intermediate iii', 'advanced i', 'advanced ii'];
  for (const list of bySubject.values()) {
    const ladders = new Map();
    for (const r of list) {
      const m = String(r.title ?? '').trim().match(STEP);
      if (!m) continue;
      const at = LADDER.indexOf(`${m[1]} ${m[3]}`.toLowerCase());
      if (at < 0) continue;
      const k = m[2].toLowerCase();
      if (!ladders.has(k)) ladders.set(k, []);
      ladders.get(k).push({ r, at });
    }
    for (const steps of ladders.values()) {
      // One course per step, or the ladder is not one sequence.
      if (new Set(steps.map((s) => s.at)).size !== steps.length || steps.length < 2) continue;
      steps.sort((a, b) => a.at - b.at);
      for (let i = 1; i < steps.length; i += 1) {
        const [lo, hi] = [steps[i - 1].r, steps[i].r];
        if (n(lo) >= n(hi)) continue;
        add(hi.code, lo.code, `"${hi.title}" is the step after "${lo.title}" (${lo.code}) in ${hi.subject}'s titled sequence.`, 'title steps');
      }
    }
  }
  return { parts: out, skipped };
}

/**
 * Courses whose own description says students take them alongside the
 * courses that require them: LMC 3431 and LMC 3432 are "Part of a
 * multi-semester sequence that students take in tandem with major-specific
 * classes". A course whose Banner table names one of these as a required
 * course (CS 3312: "CS 2340 and LMC 3432"; its own description says it is
 * "conjoined with Technical Communications") gets it as "credit or concurrent
 * registration" instead of an earlier term: GT's junior design runs CS 3311
 * with LMC 3431 one term and CS 3312 with LMC 3432 the next. Banner's
 * prerequisite table has no concurrency column, so the catalog's words are
 * the only source. Measured 2026-11-09: 2 such courses, named by 1 table
 * (CS 3312 -> LMC 3432).
 */
export function tandemCourses(rows) {
  return new Set(rows.filter((r) => /\b(?:students\s+)?take\s+(?:it\s+)?in tandem with\b|\btaken (?:in tandem|concurrently) with\b/i.test(String(r.description ?? ''))).map((r) => r.code));
}

/**
 * Banner's section cross-list groups: every pair of course codes whose
 * sections share one `crossList` id in one term (the sections Georgia Tech
 * schedules as one class under several codes). Read from the class-search
 * pages scripts/gatech/offerings.mjs caches in data/gatech-raw/banner/<term>/;
 * none are fetched. Returns Map("A~B" sorted -> Set(term codes)).
 */
export function bannerCrossListPairs(root = 'data/gatech-raw/banner') {
  const pairs = new Map();
  if (!existsSync(root)) return pairs;
  for (const term of readdirSync(root).filter((d) => /^\d{6}$/.test(d)).sort()) {
    const groups = new Map();
    for (const f of readdirSync(join(root, term)).filter((x) => x.endsWith('.json.gz')).sort()) {
      const page = JSON.parse(gunzipSync(readFileSync(join(root, term, f))).toString());
      for (const s of page.data ?? []) {
        if (!s.crossList) continue;
        if (!groups.has(s.crossList)) groups.set(s.crossList, new Set());
        groups.get(s.crossList).add(`${s.subject} ${s.courseNumber}`);
      }
    }
    for (const g of groups.values()) {
      const codes = [...g].sort();
      for (let i = 0; i < codes.length; i += 1) for (let j = i + 1; j < codes.length; j += 1) {
        const k = `${codes[i]}~${codes[j]}`;
        if (!pairs.has(k)) pairs.set(k, new Set());
        pairs.get(k).add(term);
      }
    }
  }
  return pairs;
}

/** Titles that name a kind of course every department has, not one class: never read as a cross-listing. */
const GENERIC_TITLE = /\b(special topics|selected topics|topics in|special problems|assistantship|independent study|study abroad)\b/i;
/** A description without the sentences that name other codes ("Crosslisted with ...", "Credit not allowed for ..."). */
const coreWords = (desc) => wordsOf(String(desc ?? '').split(/(?<=\.)\s*/).filter((s) => !/cross-?\s*listed|\bcredit\b/i.test(s)).join(' '));
const wordSet = (s) => new Set(s.split(' ').filter((w) => w.length > 2));
const overlap = (a, b) => {
  const A = wordSet(a), B = wordSet(b);
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  return both / Math.max(1, A.size + B.size - both);
};

/**
 * Cross-listings the catalog's "Crosslisted with" links do not record, so a
 * plan can hold one class once and a requirement met by one code is met by
 * its twin. Student D's Computational Media board booked CS 4731 "Game AI"
 * in Spring 2029 and LMC 4731 "Game AI" in Spring 2030 (2026-11-09): one
 * class, which Banner scheduled as one cross-listed group in Spring 2025,
 * and neither course block links the other. Three readings, each of
 * Georgia Tech's own data:
 *   same number   two undergraduate courses of different subjects with the
 *                 same number and the same catalog title (Georgia Tech gives
 *                 a cross-listed class one number in every subject), not a
 *                 kind of course every department has (special topics,
 *                 research, internships: NOISE or GENERIC_TITLE), and one of:
 *                 Banner's sections put them in one cross-list group in a
 *                 crawled term; their descriptions are the same once the
 *                 sentences naming other codes are set aside ("Introduction
 *                 to Africa", ARBC/FREN/PORT/SWAH/WOLO 3420, "Taught in
 *                 English"); or both course blocks link the same third code
 *                 (AE, CHBE, CEE and ME 4791 all name PTFE 4791, which has
 *                 left the catalog, so no link reached a current course).
 *                 Same title and same number alone is not enough: CHIN 4500
 *                 and FREN 4500 "Advanced Intercultural Seminar" are taught
 *                 in Chinese and in French.
 *   successor     a course whose catalog link names a code that has left the
 *                 catalog, and the one course of that code's subject and
 *                 level that Banner titles the same and whose description
 *                 shares at least three quarters of its words: CEE 1770
 *                 "Crosslisted with AE and ME 1770"; ME 1770 is gone, and
 *                 Banner titles ME 1670 "Intro to Engr Graphics", as it does
 *                 CEE 1770, with the same description ("Introduction to
 *                 engineering graphics and visualization including
 *                 sketching, line drawing, and solid modeling ..."). ME
 *                 3180, ME 4315 and CEE 4600 need CEE 1770, which ran once
 *                 in nine terms, so ME boards booked it beside the ME 1670
 *                 they require. These pairs also go into alsoAccepts, so the
 *                 prerequisite reads "CEE 1770 or ME 1670".
 *   two numbers   two undergraduate courses of one subject that Banner titles
 *                 the same and whose descriptions are the same once the
 *                 sentences naming other codes are set aside: CS 3001 and CS
 *                 4001, "Computing, Society, and Professionalism" (Banner's
 *                 "Computing & Society" for both; CS 3001 has run every term
 *                 since 2021, CS 4001 once in Atlanta and on study abroad).
 *                 One course under two numbers counts once. Both must carry
 *                 the same hours, neither may be a seminar series, and the
 *                 description must say more than the title (cross-enrollment
 *                 and exchange placeholders do not).
 * Returns Map(code -> [{ code, how, why }]), both directions.
 */
export function crossListingsOf(rows, { bannerTitleOf = () => null, sectionPairs = new Map(), gradLevel = 5000 } = {}) {
  const ug = rows.filter((r) => Number.parseInt(r.number, 10) < gradLevel && !NOISE.test(r.title) && !GENERIC_TITLE.test(r.title));
  const known = new Set(rows.map((r) => r.code));
  const out = new Map();
  const link = (a, b, how, why) => {
    if (a.code === b.code || a.sameAs.includes(b.code) || b.sameAs.includes(a.code)) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!out.has(x.code)) out.set(x.code, []);
      if (!out.get(x.code).some((p) => p.code === y.code)) out.get(x.code).push({ code: y.code, how, why });
    }
  };
  const T = (r) => wordsOf(r.title);
  const byNumberTitle = new Map();
  for (const r of ug) {
    const k = `${r.number}|${T(r)}`;
    if (!byNumberTitle.has(k)) byNumberTitle.set(k, []);
    byNumberTitle.get(k).push(r);
  }
  for (const group of byNumberTitle.values()) {
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) {
      const [a, b] = [group[i], group[j]];
      if (a.subject === b.subject) continue;
      const terms = sectionPairs.get([a.code, b.code].sort().join('~'));
      const shared = a.sameAs.find((c) => b.sameAs.includes(c));
      const sameWords = coreWords(a.description) !== '' && coreWords(a.description) === coreWords(b.description);
      if (terms) link(a, b, 'same number', `Same number and title; Banner scheduled them as one cross-listed class in ${[...terms].sort().join(', ')}.`);
      else if (shared) link(a, b, 'same number', `Same number and title; both course blocks say they are cross-listed with ${shared}.`);
      else if (sameWords) link(a, b, 'same number', 'Same number, title and description.');
    }
  }
  for (const x of ug) {
    for (const gone of x.sameAs.filter((c) => !known.has(c))) {
      const [subj, num] = gone.split(' ');
      const tier = Math.floor(Number.parseInt(num, 10) / 1000);
      const title = wordsOf(bannerTitleOf(x.code));
      if (!title) continue;
      const hits = ug.filter((z) => z.subject === subj && z.code !== x.code && Math.floor(Number.parseInt(z.number, 10) / 1000) === tier
        && wordsOf(bannerTitleOf(z.code)) === title && overlap(coreWords(z.description), coreWords(x.description)) >= 0.75);
      if (hits.length === 1) link(x, hits[0], 'successor', `${x.code}'s catalog says it is cross-listed with ${gone}, which has left the catalog; Banner titles ${hits[0].code} "${bannerTitleOf(hits[0].code)}", as it does ${x.code}, and the descriptions match.`);
    }
  }
  const bySubjectTitle = new Map();
  for (const r of ug) {
    const t = wordsOf(bannerTitleOf(r.code));
    if (!t) continue;
    const k = `${r.subject}|${t}`;
    if (!bySubjectTitle.has(k)) bySubjectTitle.set(k, []);
    bySubjectTitle.get(k).push(r);
  }
  for (const group of bySubjectTitle.values()) {
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) {
      const [a, b] = [group[i], group[j]];
      if (a.number === b.number || coreWords(a.description) === '' || coreWords(a.description) !== coreWords(b.description)) continue;
      // Not a placeholder whose description is its title (UCGA "Cross Enroll-Savannah College of
      // Art"), a seminar series (ECE 2001 and 2002 "ECE Seminar"), or one exchange course in
      // several sizes (FS 4000, 4003, 4006 "Foreign Studies", 12, 3 and 6 hours).
      if (coreWords(a.description) === wordsOf(a.title) || /\bseminar\b|\bcross[- ]?enroll/i.test(a.title) || a.credits !== b.credits || a.creditsMax !== b.creditsMax) continue;
      link(a, b, 'two numbers', `Banner titles both "${bannerTitleOf(a.code)}" and the descriptions are the same: one course under two numbers.`);
    }
  }
  return out;
}

/**
 * Credit exclusions in the wordings the engine's reader (illinois-data.ts
 * exclusionsIn, which takes "Credit not allowed/awarded/given for ...") does
 * not take, read pair by pair:
 *   - "Students cannot receive credit for ECON 2100 and ECON 2101 or for ECON
 *     2100 and ECON 2105 /2106 or for ECON 2101 and ECON 2105 /2106" (ECON
 *     2100, 2101, 2105, 2106): exclusions.json had no ECON pair, and the
 *     Economics board with AP credit booked all four in Fall 2026
 *     (2026-11-09). Read as pairs, ECON 2105 and ECON 2106 stay together,
 *     as the sentence before it says ("or for ECON 2105/2106").
 *   - "No credit allowed for MGT 3000 and ACCT 2101" ("No credit allowed for
 *     MGT majors" names no course and adds nothing).
 *   - A number written without its subject after a code ("Credit not allowed
 *     for both CS 4001 and 4002", "ECON 2105 /2106"): the subject before it.
 * Each "or for" / "or" part is one pair: the courses before its "and"
 * against the courses after it; a part with no "and" adds courses to the
 * side after the last "and" ("both MATH 3670 and MATH 3770 or ISYE 3770 or
 * CEE 3770"). The adapter's own reading of the "Credit not ..." wordings
 * stays as it is; build-index.mjs adds these pairs, both ways, beside it.
 * What it cannot know: a pair the catalog never puts in words. BIOS 1107 and
 * BIOS 1207 (and 1107L and 1207L) are each other's "or" on every degree page
 * that names them, and their descriptions read alike, but no course
 * description, program page, AP or IB table or rules page says their credit
 * does not both count, and Banner's Mutual Exclusion tab is empty at Georgia
 * Tech (banner.mjs, kind 'mexc'). So no pair is written for them: by the
 * catalog's own words, BIOS 1207 booked beside a held BIOS 1107 still earns its
 * credit, though it repeats the same material (2026-11-09, Neuroscience
 * Business with ten exams).
 * Returns Map(code -> [{ code, words }]).
 */
export function creditExclusionsOf(rows) {
  const known = new Set(rows.map((r) => r.code));
  const SENT = /\b(?:(?:cannot|can not|may not|will not|do not)\s+receive\s+credit\s+for|no\s+credit\s+(?:is\s+)?(?:allowed|given|awarded|granted)\s+for|credit\s+(?:is\s+|will\s+)?not\s+(?:be\s+)?(?:given|allowed|awarded|awared|awareded|granted)(?:\s+toward\s+graduation)?\s+for)\s*(?:both\s*)?:?\s*([^.]+)\./gi;
  // Codes with their positions; a bare number takes the subject written before it, across parts.
  let subj = null;
  const codesOf = (s) => {
    const list = [];
    for (const m of s.matchAll(/\b([A-Z]{2,4})\s?(\d{4}[A-Z]?)\b|(?<=[\s/,])(\d{4}[A-Z]?)\b/g)) {
      if (m[1]) subj = m[1];
      const code = m[1] ? `${m[1]} ${m[2]}` : subj ? `${subj} ${m[3]}` : null;
      if (code && known.has(code) && !list.some((x) => x.code === code)) list.push({ code, at: m.index });
    }
    return list;
  };
  const out = new Map();
  const add = (a, b, words) => {
    if (a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!out.has(x)) out.set(x, []);
      if (!out.get(x).some((p) => p.code === y)) out.get(x).push({ code: y, words });
    }
  };
  for (const r of rows) {
    const desc = String(r.description ?? '');
    for (const m of desc.matchAll(SENT)) {
      const words = m[0].trim();
      let left = null;
      subj = null;
      for (const part of m[1].split(/\s+or\s+(?:for\s+)?/i)) {
        const at = part.search(/\band\b/i);
        const codes = codesOf(part);
        if (at >= 0) {
          left = codes.filter((x) => x.at < at).map((x) => x.code);
          const right = codes.filter((x) => x.at > at).map((x) => x.code);
          if (!left.length) left = [r.code];
          for (const a of left) for (const b of right) add(a, b, `${r.code}: ${words}`);
        } else if (left) {
          for (const a of left) for (const b of codes) add(a, b.code, `${r.code}: ${words}`);
        } else {
          for (const b of codes) add(r.code, b.code, `${r.code}: ${words}`);
        }
      }
    }
  }
  return out;
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
  // Cross-listings the catalog's links miss, and credit exclusions the engine's reader does not take (crossListingsOf, creditExclusionsOf).
  const bannerTitleOf = (code) => (bannerCodes.get(code)?.courseTitle ? ent(String(bannerCodes.get(code).courseTitle)) : null);
  const sectionPairs = bannerCrossListPairs();
  const crossListed = crossListingsOf(cat.rows, { bannerTitleOf, sectionPairs, gradLevel: GT_GRAD_LEVEL });
  const creditExclusions = creditExclusionsOf(cat.rows);
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

  const stats = { prereqRead: 0, prereqNone: 0, prereqTable: 0, prereqMissing: 0, complex: 0, mixedNoParens: 0, quarterDropped: 0, unknownSubject: new Map(), coreqs: 0, coreqInProse: 0, standing: 0, creditMismatch: [], reading: new Map(), group: {}, titles: [], audience: new Map() };

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
  // A cross-listed class under its partner's current number (crossListingsOf, "successor"): CEE 1770 is also met by ME 1670.
  for (const [code, list] of crossListed) {
    for (const p of list) {
      if (p.how !== 'successor') continue;
      if (!alsoAccepts.has(code)) alsoAccepts.set(code, new Set());
      alsoAccepts.get(code).add(p.code);
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

  /**
   * Three readings of the catalog's own words on top of Banner's tables,
   * applied to the tree before the group form is built, so the prose, the
   * clauses and the matcher agree. Banner's tree is kept (bannerLive) and
   * prereqReading compares the result with it, so each course these touch
   * reads 'stricter', 'looser' or 'mixed', never 'exact'. Banner's wording
   * stays in prereqGT. Counted in the report at the end.
   */
  const atomOf = (code) => ({ kind: 'course', code, label: code, number: code.split(' ')[1], level: 'Undergraduate Semester', grade: 'D', quarter: false, placeholder: false, fromDescription: true });
  const kidsOf = (node) => (node?.op === 'and' ? node.kids : node ? [node] : []);
  const andOf = (kids) => (kids.length === 1 ? kids[0] : { op: 'and', kids });
  const namedByTable = (code) => new Set((treeOf.get(code)?.tree.atoms ?? []).filter((a) => a.kind === 'course' && a.code).map((a) => a.code));

  // (1) Sequences the table misses (sequencePartsOf): the earlier part is ANDed on.
  const seq = sequencePartsOf(cat.rows, GT_GRAD_LEVEL);
  const fromDescription = new Map();
  const seqStats = { found: 0, alreadyNamed: 0, cycle: 0, retiredOnly: 0, added: 0, skipped: seq.skipped, notInYear: [] };
  /*
   * A title step is the order a student who starts at the bottom follows, so it is added only
   * where that student could follow it: the step below has run in Atlanta in a fall or a spring
   * of the crawled terms. SPAN 1001 and SPAN 1002 have run only in summers (Summer 2024, 2025,
   * 2026) and HIN 1001 and 1002 not at all, so Spanish and Hindi students reach Intermediate I by
   * placement; with "SPAN 2001 needs SPAN 1002" the Applied Languages Spanish board could place
   * none of SPAN 1001, 1002, 2001 or 2002 in eight falls and springs (2026-11-09).
   */
  const ranInYear = (c) => (offeringsRaw?.courses?.[c] ?? []).some((t) => /^(fa|sp)/.test(t));
  for (const [code, parts] of seq.parts) {
    for (const p of parts) {
      seqStats.found += 1;
      if (p.how === 'title steps' && offeringsRaw && !ranInYear(p.code)) { seqStats.notInYear.push(`${code} <- ${p.code}`); continue; }
      const tableNames = namedByTable(code);
      if (tableNames.has(p.code) || [...(alsoAccepts.get(p.code) ?? [])].some((x) => tableNames.has(x))) { seqStats.alreadyNamed += 1; continue; }
      if (namedByTable(p.code).has(code) || (seq.parts.get(p.code) ?? []).some((q) => q.code === code)) { seqStats.cycle += 1; continue; }
      if (!fromDescription.has(code)) fromDescription.set(code, []);
      fromDescription.get(code).push(p);
    }
  }
  for (const [code, parts] of fromDescription) {
    const atoms = parts.map((p) => atomOf(p.code));
    const t = treeOf.get(code);
    if (t && t.live.op === 'false') { seqStats.retiredOnly += parts.length; fromDescription.delete(code); continue; }
    seqStats.added += parts.length;
    const extra = atoms.map((atom) => ({ op: 'atom', atom }));
    if (t) {
      t.bannerLive ??= t.live;
      t.live = andOf([...kidsOf(t.live), ...extra]);
      t.tree.atoms.push(...atoms);
    } else {
      // No Banner table (most language courses): the description is the only prerequisite.
      treeOf.set(code, { table: { rows: [] }, tree: { node: andOf(extra), atoms, rowAtoms: [], unknownSubjects: [], mixedWithoutParens: false }, live: andOf(extra), added: [], bannerLive: null, synthetic: true });
    }
  }

  // (2) Taken in tandem (tandemCourses): a required course the table names becomes "credit or concurrent registration".
  const tandem = tandemCourses(cat.rows);
  const concurrentFromDescription = new Map();
  for (const [code, t] of treeOf) {
    if (t.synthetic || t.live.op === 'false') continue;
    const kids = kidsOf(t.live);
    const hit = kids.filter((k) => k.op === 'atom' && k.atom.kind === 'course' && tandem.has(k.atom.code) && !k.atom.fromDescription);
    if (!hit.length || hit.length === kids.length) continue;
    t.bannerLive ??= t.live;
    t.live = andOf(kids.filter((k) => !hit.includes(k)));
    const codes = hit.map((k) => k.atom.code);
    proseCoreqOf.set(code, [...new Set([...(proseCoreqOf.get(code) ?? []), ...codes])]);
    concurrentFromDescription.set(code, codes.map((c) => {
      const d = String(cat.rows.find((r) => r.code === c)?.description ?? '');
      return { code: c, words: `${c}: ${d.match(/[^.]*\bin tandem with\b[^.]*\./i)?.[0].trim() ?? ''}` };
    }));
  }

  /**
   * (3) A dormant prerequisite (prereqDormant). MUSI 4705 (Music Technology
   * Capstone I) needs "MUSI 3770 and MUSI 3771" in Banner. MUSI 3771 (Project
   * Studio: Analysis, in Banner's catalog since 2016) has had no section on
   * any campus, Atlanta or away, in any of the nine crawled terms (Summer 2024
   * to Spring 2027), while MUSI 4705 ran every fall of them (Fall 2024, 2025,
   * 2026) with students enrolled; the five Music Technology degree pages
   * that require MUSI 4705 list MUSI 3770 and never MUSI 3771. So a plan that
   * books MUSI 4705 booked a course that does not run (three Music
   * Technology boards), or could not place MUSI 4705 at all (Music
   * Technology ECE, 2026-11-09). A required single course P (not one choice
   * of several) is dropped from course X's prerequisite when all of these
   * hold, each read from Georgia Tech's own data:
   *   - P has no section in any crawled term on any campus (gatech-offerings
   *     courses and elsewhere);
   *   - P is not a new course: Banner's termStart for P is before the oldest
   *     crawled term, so it was in the catalog the whole time and never ran;
   *   - P has no renumbering or replacement (alsoAccepts);
   *   - no degree page names P in a list of twelve courses or fewer (a
   *     required row or a real choice; P inside a school-wide pool of
   *     hundreds says nothing);
   *   - X itself ran in at least three crawled terms, one of them one of the
   *     two newest, so students reach X without P;
   *   - X keeps at least one other requirement.
   * Banner's wording stays in prereqGT and the dropped course is named in
   * prereqDormant with the reason, so the product can say so. Measured
   * 2026-11-09: 2 courses. MUSI 4705 without MUSI 3771, and CHBE 4743
   * (Sustainable Chemical Enterprise) without CHBE 3130 (Chemical Engineering
   * Thermodynamics II), which has not run since ChBE's single CHBE 2140
   * "Chemical Engineering Thermodynamics" (every fall and spring) took the
   * place of CHBE 2130 and 3130; CHBE 3130 is left only inside ChBE's
   * 41-course elective list. Without the offerings file nothing is dropped.
   */
  const dormant = new Map();
  if (offeringsRaw) {
    const terms = [...(offeringsRaw.terms ?? [])].sort((a, b) => String(b.code).localeCompare(String(a.code)));
    const oldest = terms.at(-1)?.code ?? null;
    const newest = new Set(terms.slice(0, 2).map((t) => t.id));
    const span = terms.length ? `${terms.at(-1).term} ${terms.at(-1).year} to ${terms[0].term} ${terms[0].year}` : '';
    const ranAnywhere = (c) => (offeringsRaw.courses?.[c]?.length ?? 0) > 0 || Object.keys(offeringsRaw.elsewhere?.[c] ?? {}).length > 0;
    const isDormant = (p) => catalogCodes.has(p) && !ranAnywhere(p) && !alsoAccepts.has(p) && !degreesNaming.has(p)
      && oldest && bannerCodes.get(p)?.termStart && String(bannerCodes.get(p).termStart) < String(oldest);
    for (const [code, t] of treeOf) {
      if (t.synthetic || t.live.op === 'false') continue;
      const ran = offeringsRaw.courses?.[code] ?? [];
      if (ran.length < 3 || !ran.some((id) => newest.has(id))) continue;
      const kids = kidsOf(t.live);
      const hit = kids.filter((k) => k.op === 'atom' && k.atom.kind === 'course' && !k.atom.fromDescription && isDormant(k.atom.code));
      if (!hit.length || hit.length === kids.length) continue;
      t.bannerLive ??= t.live;
      t.live = andOf(kids.filter((k) => !hit.includes(k)));
      dormant.set(code, hit.map((k) => ({ code: k.atom.code, why: `${k.atom.code} has had no section on any campus from ${span}, while ${code} ran in ${ran.length} of those terms; no degree page lists ${k.atom.code} as a requirement or in a list of twelve courses or fewer.` })));
    }
  }

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
      if (!t || t.synthetic) stats.prereqNone += 1;
      if (t) {
        if (!t.synthetic) stats.prereqTable += 1;
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
          // Against Banner's own tree; a course the catalog's words changed (bannerLive, above) is compared with what Banner says.
          prereqReading = t.bannerLive === null ? 'stricter' : compareReading(t.bannerLive ?? live, groups, implied, 400, seededRandom(r.code));
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
    // A catalog title that is the opening of the description takes Banner's title (sentenceTitleOf).
    const bannerTitle = sentenceTitleOf(r, b?.courseTitle);
    if (bannerTitle) stats.titles.push(`${r.code}: "${r.title}" -> "${bannerTitle}"`);
    const audience = n < GT_GRAD_LEVEL ? audienceOf(r) : null;
    if (audience) stats.audience.set(audience, [...(stats.audience.get(audience) ?? []), r.code]);

    courses.push({
      code: r.code,
      subject,
      number,
      // Georgia Tech's own tier: 1000, 2000, 3000, 4000 undergraduate; 6000+
      // graduate. NOT the Illinois 100-500 scale: the engine's graduate cut
      // (ILLINOIS_GRAD_LEVEL = 500) must be GT_GRAD_LEVEL (5000) for this file.
      level: Math.floor(n / 1000) * 1000,
      title: bannerTitle ?? r.title,
      /** The catalog's own title line, kept when it was a description fragment and Banner's title is used (sentenceTitleOf). */
      ...(bannerTitle ? { catalogTitle: r.title, titleFrom: 'banner' } : {}),
      credits, creditsMax,
      description: r.description,
      prereqCodes,
      prereqText,
      // Georgia Tech has no prose prerequisite notes; the table is the answer,
      // and a course with no table row has no catalog prerequisite in Banner.
      prereqNote: '',
      genEd: attrs.filter((a) => GEN_ED_ATTRS.has(a)).map((a) => attrByCode.get(a) ?? a),
      // The catalog's own "Crosslisted with" links, plus the cross-listings crossListingsOf reads (sameAsFrom says why).
      sameAs: [...new Set([...r.sameAs, ...(crossListed.get(r.code) ?? []).map((p) => p.code)])],
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
      /** Earlier parts of a sequence the description names and Banner's table does not, added as prerequisites (sequencePartsOf): [{ code, words, how }]. */
      ...(fromDescription.has(r.code) ? { prereqFromDescription: fromDescription.get(r.code) } : {}),
      /** Required courses Banner names that the catalog says are taken in tandem, read as credit or concurrent registration (tandemCourses): [{ code, words }]. */
      ...(concurrentFromDescription.has(r.code) ? { prereqConcurrentFromDescription: concurrentFromDescription.get(r.code) } : {}),
      /** Required courses Banner names that have not run in any crawled term and no student needs to reach this course (see dormant): [{ code, why }]. */
      ...(dormant.has(r.code) ? { prereqDormant: dormant.get(r.code) } : {}),
      /** Who the course is meant for, when the catalog says one group only: 'heritage-learners' or 'first-year' (audienceOf). */
      ...(audience ? { audience } : {}),
      /** Cross-listings added to sameAs beyond the course block's own links (crossListingsOf): [{ code, how, why }]. */
      ...(crossListed.has(r.code) ? { sameAsFrom: crossListed.get(r.code) } : {}),
      /** Courses the catalog says do not both count, read pair by pair where the engine's reader misses them (creditExclusionsOf): [{ code, words }]. */
      ...(creditExclusions.has(r.code) ? { exclusionsFromText: creditExclusions.get(r.code) } : {}),
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
  console.log(`corequisites: ${stats.coreqs} courses have one; ${stats.coreqInProse} lab/recitation pairs (and courses taken in tandem, below) written into the prose`);
  console.log(`sequences the tables miss (sequencePartsOf): ${seqStats.found} earlier parts read from descriptions; ${seqStats.alreadyNamed} already in the table, ${seqStats.cycle} would make a cycle, ${seqStats.retiredOnly} on a retired-only table; ${seqStats.added} added (${[...fromDescription].map(([c, ps]) => `${c} <- ${ps.map((p) => `${p.code} [${p.how}]`).join(', ')}`).join('; ') || 'none'})`);
  if (seqStats.skipped.length) console.log(`  not added: ${seqStats.skipped.map((x) => `${x.code} (${x.part}: ${x.why})`).join('; ')}`);
  if (seqStats.notInYear.length) console.log(`  title steps not added because the step below has not run in a fall or spring in Atlanta: ${seqStats.notInYear.length} (${seqStats.notInYear.join(', ')})`);
  console.log(`taken in tandem (tandemCourses): ${tandem.size} courses say so (${[...tandem].join(', ')}); ${concurrentFromDescription.size} tables naming one now read credit or concurrent registration (${[...concurrentFromDescription].map(([c, ps]) => `${c} ~ ${ps.map((p) => p.code).join(', ')}`).join('; ') || 'none'})`);
  console.log(`dormant prerequisites dropped: ${dormant.size} (${[...dormant].map(([c, ps]) => `${c} without ${ps.map((p) => p.code).join(', ')}`).join('; ') || 'none'})`);
  console.log(`titles that were description fragments, now Banner's: ${stats.titles.length} (${stats.titles.join('; ') || 'none'})`);
  console.log(`audience: ${[...stats.audience].map(([a, list]) => `${a} ${list.length} (${list.join(', ')})`).join('; ') || 'none'}`);
  {
    const pairs = new Map();
    for (const [a, list] of crossListed) for (const p of list) if (a < p.code) pairs.set(`${a} = ${p.code}`, p.how);
    const byHow = new Map();
    for (const [k, how] of pairs) byHow.set(how, [...(byHow.get(how) ?? []), k]);
    console.log(`cross-listings added (crossListingsOf; ${sectionPairs.size} Banner section cross-list pairs read): ${pairs.size} pairs; ${[...byHow].map(([h, l]) => `${h} ${l.length} (${l.join(', ')})`).join('; ') || 'none'}`);
    const ex = new Set();
    for (const [a, list] of creditExclusions) for (const p of list) if (a < p.code) ex.add(`${a} / ${p.code}`);
    console.log(`credit exclusions read pair by pair (creditExclusionsOf): ${ex.size} pairs (${[...ex].join(', ') || 'none'})`);
  }
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
