/**
 * Georgia Tech degree requirements, shaped so the CourseLeaf engine can plan
 * every row.
 *
 * programs.mjs reads each degree page into the Illinois schema faithfully, and
 * that leaves rows the engine cannot plan. A degree page names a category and
 * its hours ("Any HUM" 6, "Lab Science" 8, "Free Electives" 9, "ECE 3000/4000-
 * level Elective" 3, "Junior Design Option" 6) and puts the courses somewhere
 * else, on a Core IMPACTS page or in a footnote; and it prints a block's
 * required rows and its "Select" lists as one table, which the adapter reads
 * as one list. Measured with the adapter itself (check-programs.mjs), the raw
 * parse had 738 rows it could not plan and 423 required rows read as optional
 * (CS 2110 in every CS thread page), in 110 of 210 degrees. This turns each
 * one into a shape adaptIllinoisPrograms (lib/planner/illinois-data.ts)
 * already reads, without changing the adapter:
 *
 *   Core IMPACTS placeholders  "Any HUM", "Any SS", "Any Social Science",
 *     "Lab Science", "Any Lab Science", "Lab Science Elective": a group of its
 *     own whose rows are the area's approved list from public/gatech-core.json
 *     and whose `hours` are the row's hours. The adapter reads it as a pool
 *     (more credit than its hours, so a list to pick from). The core pages'
 *     limits (at most 3 hours from one introductory language course, no
 *     credit for both POL 1101 and INTA 1200) are kept as words in
 *     `footnotes`, not enforced. A sized "Ethics Requirement" row gets the
 *     Ethics attribute list the same way.
 *   Free electives  "Free Electives" (and its variants, and a Free Electives
 *     heading that carries its hours): a group with no rows and `hours` set,
 *     which the adapter reads as an 'hours' block with no gen-ed, which the
 *     engine fills with editable elective cards.
 *   Category rows with a list  the row's own footnote (programs.mjs keeps
 *     each comment row's footnotes now) or its own words name the courses:
 *     "CEE 3770 or ISYE 3770 or MATH 3670 or ECE 3077", "All ECE courses at
 *     the 3000-level or higher ... Exclusions: ... ECE 3077", "Please select any
 *     academic course from the Schools of Biological Sciences, Chemistry, Earth
 *     and Atmospheric Sciences, or Physics", "3000-, 4000-level CHIN classes".
 *     Read into a pool group the same way, its rows from the course catalog
 *     (readCourseText says how). A course the degree requires by name
 *     elsewhere is left out of such a list, because it cannot count twice;
 *     research, internship and special-problems rows (the catalog's noise
 *     flag) are left out, because the engine does not plan them.
 *   "Select" lists  a block's required rows stay one group; each "Select
 *     two of the following:" list under them becomes a group of its own with
 *     the list's hours (selectLists). Rows printed with no hours above the
 *     lists (PHYS 2211 and PHYS 2212 on Biology, POL 1101 on Public Policy,
 *     counted elsewhere on the page) become a required group of their own, or
 *     drop out as a reminder where the degree requires the course by name
 *     elsewhere.
 *   Option footnotes  the footnote's real course choices, as a pick-one of
 *     whole sets the adapter reads (oneListOf: a label offering one option,
 *     a comment row heading each set): Computer Science's Junior Design
 *     Options 1, 4 and 5, ECE's Culminating Senior Design. Options that name
 *     no course (VIP, the Research Option) stay in `footnotes` as words.
 *   "&" pairs  the adapter knows a pair only by its title (bundleOf: "Principles
 *     of Biology I and Principles of Biology I Laboratory"), so a pair row
 *     printed under an older title gets the catalog's. "MATH 1711 or MATH 1551
 *     & MATH 1553" becomes a pick-one of the two sets.
 *   Mathematics with Computing  its three 27-hour concentrations
 *     (program.extraTables) become three option pages of the degree, as Georgia
 *     Tech's other concentrations already are, each with its concentration's
 *     table in place of the "Concentration Requirements" 27 row; the degree
 *     page becomes the menu, as the other 22 are (`menuOf` says why).
 *   Wellness  left as it reads: APPH 1040 or APPH 1050 or APPH 1060 is one
 *     row with two alternatives, a one-of-three choice already.
 *
 * What it leaves alone: a row whose words and footnotes name no course and no
 * subject ("Advisor approved courses", "AE courses from list supplied by
 * School", "Arts Practice Electives") stays an 'hours' block in the catalog's
 * words, marked `shaped.kind: 'open'` with the reason, and the planner fills
 * it with editable elective cards. Zero-hour reminders ("Economics
 * Requirement", "Ethics Requirement") stay notes.
 *
 *   "N credits" in a comment row left in place  said "N credit hours", the
 *     way the adapter reads hours (asHours), with the printed words kept in
 *     the comment's `textAsPrinted` (version 2).
 *   A row printed as several subjects with one number ("CHIN/FREN/GRMN/
 *     JAPN/KOR/RUSS/SPAN 4500")  every subject's course of that number as
 *     an alternative (slashSubjectRows, version 4; reads the cached page).
 *   Courses a footnote counts inside a Core IMPACTS area ("Economics
 *     Requirement", Engineering's one-of-four economics classes, the
 *     Business Option's ECON 2106)  a block in that area, carved out of its
 *     "Any ..." list (carveFootnotedReminders, versions 3 and 6).
 *
 * Every shaped group carries `shaped: { kind, from, basis }`: what the row
 * said, and where its courses came from. The file carries `shaped` with the
 * version and the counts. A file already shaped at this version is left as it
 * is: re-parse the cache to shape again.
 *
 * HOW TO RUN (from the worktree root):
 *   export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
 *   node scripts/gatech/programs.mjs --offline --minors-out /tmp/minors.json
 *       # re-parse the cache AND shape: writes public/gatech-programs.json
 *   node scripts/gatech/shape-programs.mjs --in <raw.json> --out <file>   # shape a raw parse (--raw)
 *   node scripts/gatech/check-programs.mjs       # how the adapter reads the result
 *
 * READS: public/gatech-core.json, public/gatech-catalog.json, and from the
 * crawl cache (data/gatech-raw/programs/, gitignored) the Courses tabs of the
 * college and school pages, which say which subjects each school and college
 * teaches ("Any CoS or CS course", "the Schools of ..."). Without the cache
 * those rows stay open hours, and file.shaped.notes says so.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SHAPE_VERSION = 6;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const numberOf = (code) => Number.parseInt(String(code).split(' ')[1] ?? '', 10);
const CODE_G = /\b([A-Z]{2,4})\s?(\d{4}[A-Z]?)\b/g;
const codesIn = (text) => [...String(text ?? '').matchAll(CODE_G)].map((m) => `${m[1]} ${m[2]}`);
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// ---------------------------------------------------------------------------
// Context: the core lists, the catalog, subject and school names
// ---------------------------------------------------------------------------

export function loadShapeContext(root = ROOT) {
  const core = JSON.parse(readFileSync(join(root, 'public/gatech-core.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(root, 'public/gatech-catalog.json'), 'utf8'));
  const cacheNotes = [];

  // Which subjects a school or college teaches: the subjects of the courses
  // listed on its own page's Courses tab (School of Biological Sciences lists
  // BIOS, BIOL and APPH courses; the College of Engineering's schools AE, BMED,
  // CEE, CHBE, ECE, ISYE, MSE, ME).
  const schools = []; // { title, college, subjects }
  const dir = join(root, 'data/gatech-raw/programs');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => /^colleges__[a-z-]+(?:__[a-z-]+)?\.html$/.test(n))) {
      const html = readFileSync(join(dir, name), 'utf8');
      const title = unescape(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s*\|\s*Georgia Tech Catalog\s*$/i, '').trim();
      const at = html.indexOf('id="coursestextcontainer"');
      if (at < 0) continue;
      const end = html.indexOf('</main>', at);
      const counts = new Map();
      // Each course block opens with its code in <strong>: "<strong>PHYS&#160;2211. Introductory Physics I".
      for (const m of html.slice(at, end < 0 ? undefined : end).matchAll(/<strong>\s*([A-Z]{2,4})(?:&#160;|\s)+\d{4}/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const subjects = [...counts].filter(([, n]) => n >= 5 || n / total >= 0.2).map(([s]) => s);
      if (subjects.length) schools.push({ title, college: name.split('__')[1].replace(/\.html$/, ''), subjects });
    }
  } else cacheNotes.push('data/gatech-raw/programs missing: school and college subjects not read');

  // A program page as cached (programs.mjs names it by catalog-get's slugOf: /programs/x/ -> programs__x.html).
  const pageOf = existsSync(dir)
    ? (url) => {
      try {
        const file = join(dir, `${new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '__').replace(/[^a-z0-9_-]+/gi, '_')}.html`);
        return existsSync(file) ? readFileSync(file, 'utf8') : null;
      } catch { return null; }
    }
    : null;
  return makeShapeContext({ core, catalog, schools, cacheNotes, pageOf });
}

export function makeShapeContext({ core, catalog, schools = [], cacheNotes = [], pageOf = null }) {
  const all = new Map();
  for (const c of catalog.courses ?? []) {
    const code = norm(c.code);
    if (!all.has(code)) all.set(code, { code, title: c.title ?? '', credits: c.credits ?? null, creditsMax: c.creditsMax ?? null, subject: c.subject ?? code.split(' ')[0], n: numberOf(code), noise: !!(c.noiseByTitle ?? c.noise) });
  }
  // The undergraduate catalog: what a pool may list. Graduate (6000 and up) and
  // 0-numbered rows are not planned.
  // Wellness courses (APPH 1040, 1050, 1060) have their own requirement; a subject list
  // ("any academic course from the School of Biological Sciences") does not offer them again.
  const wellness = new Set((core.otherRequirements?.wellness?.courses ?? []).flatMap((c) => c.codes ?? []).map(norm));
  const undergrad = [...all.values()].filter((c) => c.n >= 1000 && c.n < 6000 && !wellness.has(c.code));
  const subjects = new Set(undergrad.map((c) => c.subject));
  const colleges = new Map();
  for (const s of schools) {
    const set = colleges.get(s.college) ?? new Set();
    for (const sub of s.subjects) set.add(sub);
    colleges.set(s.college, set);
  }
  return { core, all, undergrad, subjects, schools, colleges, cacheNotes, pageOf: pageOf ?? null };
}

// ---------------------------------------------------------------------------
// Rows and groups in the Illinois shape
// ---------------------------------------------------------------------------

/**
 * A list row. Title left empty: the adapter takes every title from the
 * catalog (plainChoicesFrom), and 200 titles in each of 210 degrees would
 * add megabytes to the file for nothing it reads.
 */
const listRow = (ctx, code) => ({ code, title: '', credits: ctx.all.get(code)?.credits ?? null });

/** "BIOS 1107 & BIOS 1107L": one row whose title is the catalog titles joined by " and " (bundleOf reads it). */
function pairRow(ctx, codes) {
  const parts = codes.map((c) => ctx.all.get(c));
  if (parts.some((p) => !p) || new Set(codes.map((c) => c.split(' ')[0])).size !== 1) return null;
  const credits = parts.reduce((s, p) => s + (p.credits ?? 0), 0);
  return { code: codes[0], title: parts.map((p) => p.title).join(' and '), credits };
}

function poolGroup(ctx, { label, hours, rows, kind, from, basis, footnotes }) {
  const summed = rows.reduce((s, r) => s + (r.credits ?? ctx.all.get(r.code)?.credits ?? 0), 0);
  return {
    label,
    choose: null,
    chooseFrom: null,
    hours,
    courses: rows,
    note: label,
    summedCredits: summed,
    // Illinois's kind with the group's own hours as the cap (programs.mjs, courselist.mjs).
    kind: summed > hours + 0.5 ? 'menu' : 'all',
    ...(footnotes?.length ? { footnotes } : {}),
    shaped: { kind, from, basis },
  };
}

function hoursGroup({ label, hours, kind, from, basis, footnotes }) {
  return {
    label,
    choose: null,
    chooseFrom: null,
    hours,
    courses: [],
    note: label,
    summedCredits: 0,
    kind: 'all',
    ...(footnotes?.length ? { footnotes } : {}),
    shaped: { kind, from, basis },
  };
}

/**
 * A pick-one of whole sets, in the shape oneListOf reads: a label that offers
 * one option, a comment row with no hours heading each set, no "or" rows.
 * The engine takes one set whole (the one a student holds courses of, else the
 * first), so the catalog's standard option goes first.
 */
function setsGroup(ctx, { label, sets, kind, from, basis, footnotes, hours = null }) {
  const courses = [];
  const comments = [];
  for (const set of sets) {
    comments.push({ text: set.name, hours: null, hoursText: null, at: courses.length });
    for (const code of set.codes) courses.push({ code, title: ctx.all.get(code)?.title ?? '', credits: null });
  }
  return {
    label,
    choose: null,
    chooseFrom: null,
    hours,
    courses,
    note: comments.map((c) => c.text).join(' '),
    comments,
    summedCredits: 0,
    kind: 'all',
    ...(footnotes?.length ? { footnotes } : {}),
    shaped: { kind, from, basis },
  };
}

// ---------------------------------------------------------------------------
// Reading a category row: what courses its words and footnotes name
// ---------------------------------------------------------------------------

const NEGATIVE_SPLIT = /\b(?:with the exception of|except(?:ing)?(?: for)?|excluding|other than)\b|\bexclusions?\s*:/i;
/**
 * "must not": Mechanical Engineering's footnote "ME Electives must be 3000-level electives. ... ME
 * Elective must not duplicate any other material used for BSME degree." read its last sentence
 * as "ME Elective", any ME course 1000-4999, so the ME 3000-level Electives list offered ME 2205,
 * 2801, 2803, 2813 and 2853 (2026-11-09). That sentence limits the list; it names none. It is the
 * only "must not" sentence in gatech-programs.json (two occurrences, both this one). With the
 * band read from the footnote's own exclusions (readCourseText, `bands`) the list is ME 3000-4999
 * less the excluded and the required courses: 62 courses, none below 3000.
 */
const NEGATIVE_WHOLE = /\b(?:not allowed|are not|is not|may not|must not|cannot|can not|not be (?:used|included)|not permitted|exclude[sd]?)\b/i;
const CAP = /\b(?:maximum|max\.|at most|no more than|limit(?:ed)?(?: to)?|up to)\b/i;
const ADVICE = /\b(?:recommended|encouraged|strongly advised|consult|highly encouraged)\b/i;
/** "Any course numbered 3000 or above with significant engineering content": a judgement, not a list. */
const JUDGEMENT = /\bsignificant\b|\bcoherent theme\b|\bapproved by\b|\bsupplied by\b|\bif approved\b|\bwith permission\b/i;

/** The levels a phrase allows, as [low, high] thousands, or null when it names none. */
function levelsIn(text) {
  const t = text.replace(/\s+/g, ' ');
  let m = t.match(/\b([1-4])000\s*-?\s*(?:,|or|and|\/|to|-)\s*-?\s*([1-4])000\s*-?\s*level/i);
  if (m) return [Number(m[1]), Number(m[2])];
  m = t.match(/\b([1-4])000\s*-?\s*(?:level|lvl)?\s*(?:courses?\s+)?or\s+(?:higher|above)\b/i) ?? t.match(/\bnumbered\s+([1-4])000\s+or\s+(?:higher|above)\b/i) ?? t.match(/\bat\s+(?:the\s+)?([1-4])000[- ]level\s+or\s+(?:higher|above)/i);
  if (m) return [Number(m[1]), 4];
  // A level the words state outright wins over "upper division": Music Technology's "MUSI Upper
  // Division (4000-level) Elective" is a 4000-level MUSI course, and read as 3000-4999 it offered
  // MUSI 3771, a 3000-level studio that has not run in nine terms (four boards, 2026-11-09).
  m = t.match(/\b([1-4])000[- ]level\b/i);
  if (m) return [Number(m[1]), Number(m[1])];
  if (/\bupper[- ](?:level|division)\b/i.test(t)) return [3, 4];
  return null;
}

/** Subject prefixes a phrase names as subjects (not as the start of a course code). */
function subjectsIn(ctx, text) {
  const out = new Set();
  // A code ("CHEM 3411") or a number pattern ("CHEM 4XXX", "LMC 27XX, 37XX") names courses, not a whole
  // subject; a round level number ("ECE 3000/4000-level") does not.
  const bare = text.replace(/\b[A-Z]{2,4}\s?\d[\dX]{3}[A-Z]?\b(?:\s*,?\s*(?:and\s+|or\s+)?\d[\dX]{3}\b)*/g, (m) => (/X/.test(m) || !/^[A-Z]{2,4}\s?\d000\b/.test(m) ? ' ' : m));
  for (const m of bare.matchAll(/\b([A-Z]{2,4})\b/g)) if (ctx.subjects.has(m[1])) out.add(m[1]);
  return out;
}

/** "CHEM 4XXX", "LMC 27XX, 37XX, 47XX, 325X": subject and number patterns. */
function patternsIn(ctx, text) {
  const out = [];
  for (const m of text.matchAll(/\b([A-Z]{2,4})\s?((?:\d[\dX]{3}\s*,?\s*(?:and\s+|or\s+)?)+)/g)) {
    if (!ctx.subjects.has(m[1])) continue;
    for (const p of m[2].match(/\d[\dX]{3}/g) ?? []) {
      if (!p.includes('X')) continue;
      out.push({ subject: m[1], text: p, re: new RegExp(`^${p.replace(/X/g, '\\d')}`) });
    }
  }
  return out;
}

/** Subjects of the colleges and schools a phrase names. */
function collegeSubjectsIn(ctx, text) {
  const out = new Set();
  const add = (college) => { for (const s of ctx.colleges.get(college) ?? []) out.add(s); };
  if (/\bCoS\b|\bColleges?\s+of\s+(?:[A-Z][\w,]*\s+(?:or\s+|and\s+)?)*Sciences\b/.test(text) || /\bColleges? of Sciences\b/i.test(text)) add('cos');
  if (/\bCoC\b|\bColleges?\s+of\s+[^.]*\bComputing\b/i.test(text)) add('computing');
  if (/\bCoE\b|\bColleges?\s+of\s+[^.]*\bEngineering\b/i.test(text)) add('coe');
  if (/\bColleges?\s+of\s+[^.]*\bBusiness\b/i.test(text)) add('business');
  // "the Schools of Biological Sciences, Chemistry, Earth and Atmospheric Sciences, or Physics"
  const m = text.match(/\bSchools?\s+of\s+([^.;]+)/i);
  if (m) {
    const names = m[1].split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+/).map((n) => n.replace(/^(?:the|or|and)\s+/i, '').trim().toLowerCase()).filter(Boolean);
    for (const name of names) {
      const hit = ctx.schools.find((s) => s.title.toLowerCase().includes(name) && /\bschool\b|\bdepartment\b/i.test(s.title));
      if (hit) for (const s of hit.subjects) out.add(s);
    }
  }
  return out;
}

/** "Modern Languages": a row whose words are a school's own name ("School of Modern Languages"). */
function schoolNamed(ctx, text) {
  const t = text.replace(/[\s:]+$/, '').trim().toLowerCase().replace(/s$/, '');
  const hit = ctx.schools.find((s) => s.title.toLowerCase().replace(/^.*?\bschool of\s+/, '').replace(/s$/, '') === t);
  return hit ? new Set(hit.subjects) : new Set();
}

/** Words that name one subject: "Math or Science", "Biology Electives", "Chemistry Electives". */
const SUBJECT_WORDS = [
  [/\bmath(?:ematics)?\b/i, ['MATH']],
  [/\bbiology\b/i, ['BIOS']],
  [/\bchemistry\b/i, ['CHEM']],
  [/\bphysics\b/i, ['PHYS']],
  [/\becon(?:omics)?\b/i, ['ECON']],
];

/**
 * The courses a piece of catalog text names, or nothing.
 *
 * Read sentence by sentence. A sentence that denies ("are not allowed",
 * "excludes") is read for exclusions only, one that caps ("Maximum of nine
 * credit hours PHYS 2699 or PHYS 4699") or advises ("strongly advised") is not
 * read, and the part of a sentence after "except", "excluding" or "with the
 * exception of" is exclusions. What is left names courses three ways: codes
 * ("CEE 3770 or ISYE 3770"), number patterns ("CHEM 4XXX", "LMC 27XX"), and
 * subjects with a level ("All ECE courses at the 3000-level or higher", "Any
 * CoS or CS course", "the Schools of Biological Sciences, Chemistry, ...").
 * A subject list never takes research, special problems or recitation rows
 * (the catalog's noise flag); a course named by its code is kept as named.
 *
 * `words` also reads subject words ("Math or Science", "Biology Electives")
 * and a school's own name; `levels` forces the level band (a footnote that
 * only says "Must be 3000-level or higher" sizes the row's own subjects).
 */
function readCourseText(ctx, text, { words = false, levels: forced = null } = {}) {
  const include = new Set();
  const explicit = new Set();
  const exclude = new Set();
  const why = [];
  let judgement = false;
  let subjectRule = false;
  let firstLevels = null;
  const bands = [];
  const sentences = String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.;])\s+(?=[A-Z*])|\s+-\s+(?=Limit|Maximum)/);
  for (const raw of sentences) {
    let s = raw.trim();
    if (!s) continue;
    if (ADVICE.test(s) && !/\bmust\b/i.test(s)) continue;
    if (NEGATIVE_WHOLE.test(s) && !NEGATIVE_SPLIT.test(s)) {
      for (const c of codesIn(s)) exclude.add(c);
      continue;
    }
    if (CAP.test(s) && !/\b(?:any|all|must be chosen|choose from|following)\b/i.test(s)) continue;
    const neg = s.search(NEGATIVE_SPLIT);
    if (neg >= 0) {
      for (const c of codesIn(s.slice(neg))) exclude.add(c);
      s = s.slice(0, neg);
    }
    const lv = levelsIn(s);
    firstLevels ??= lv;
    // Explicit codes: "CEE 3770 or ISYE 3770 or MATH 3670 or ECE 3077", "Math Options: MATH 3215, ...".
    // A lone code in a sentence that offers nothing ("Credit for FREN 1002 will be used in Arts,
    // Humanities, and Ethics") is an aside, not a list.
    const named = codesIn(s).filter((c) => ctx.all.has(c));
    if (named.length >= 2 || /\b(?:following|options?|choose|select|list|include[sd]?|any)\b|:/i.test(s)) for (const c of named) explicit.add(c);
    for (const p of patternsIn(ctx, s)) {
      let n = 0;
      for (const c of ctx.undergrad) if (c.subject === p.subject && p.re.test(String(c.n)) && !c.noise) { include.add(c.code); n += 1; }
      if (n) why.push(`${p.subject} ${p.text}`);
    }
    // A choice the catalog leaves to someone ("with significant engineering content", "list supplied by
    // School", "if approved by advisor"): its named codes stand, a whole subject is not read from it.
    if (JUDGEMENT.test(s)) { judgement = true; continue; }
    const subjects = new Set([...subjectsIn(ctx, s), ...collegeSubjectsIn(ctx, s)]);
    const broad = /\b(?:any|all)\b/i.test(s) || lv !== null;
    if (words || broad) {
      for (const [re, subs] of SUBJECT_WORDS) if (re.test(s) && (words || broad)) for (const x of subs) subjects.add(x);
      if (/\bmath(?:ematics)?\s*(?:or|\/|and)\s*sciences?\b/i.test(s)) for (const x of ctx.colleges.get('cos') ?? []) subjects.add(x);
    }
    if (words) for (const x of schoolNamed(ctx, s)) subjects.add(x);
    if (subjects.size && (broad || words || /\bcourses?\b|\belectives?\b|\bclasses\b|\bprefix/i.test(s))) {
      const band = forced ?? lv ?? [1, 4];
      for (const c of ctx.undergrad) {
        if (!subjects.has(c.subject) || c.noise) continue;
        const b = Math.floor(c.n / 1000);
        if (b < band[0] || b > band[1]) continue;
        include.add(c.code);
      }
      subjectRule = true;
      why.push(`${[...subjects].sort().join(', ')} ${band[0]}000-${band[1]}999`);
      if (!forced && lv !== null) bands.push({ subjects, band });
    }
  }
  /*
   * A footnote does not rule out what its level already leaves out. "ME Electives must be
   * 3000-level electives. ME 3141, ME 3700, ..., ME 4699, ME 4741, ME 4742, ME 4753, and ME 4903
   * are not allowed" names 4000-level courses it does not allow, so its "3000-level" is 3000-level
   * and up: the band reaches the highest level its own exclusions name in those subjects.
   */
  for (const { subjects, band } of bands) {
    const top = Math.max(band[1], ...[...exclude].map((c) => ctx.all.get(c)).filter((k) => k && k.n < 5000 && subjects.has(k.subject)).map((k) => Math.floor(k.n / 1000)));
    if (top <= band[1]) continue;
    for (const c of ctx.undergrad) {
      const b = Math.floor(c.n / 1000);
      if (subjects.has(c.subject) && !c.noise && b > band[1] && b <= top) include.add(c.code);
    }
    why.push(`${[...subjects].sort().join(', ')} ${band[1] + 1}000-${top}999 (its exclusions name courses there)`);
  }
  for (const c of explicit) include.add(c);
  if (explicit.size) why.push(`${explicit.size} course${explicit.size === 1 ? '' : 's'} named`);
  for (const c of exclude) include.delete(c);
  const codes = [...include].filter((c) => { const k = ctx.all.get(c); return k && k.n >= 1000 && k.n < 6000; });
  return { codes, explicit: [...explicit], exclude: [...exclude], why, judgement, subjectRule, levels: firstLevels };
}

// ---------------------------------------------------------------------------
// The kinds of category row
// ---------------------------------------------------------------------------

const IMPACTS_ROW = [
  { re: /^any hum\b/i, area: 'arts-humanities-ethics' },
  { re: /^any (?:ss|social sciences?)\b/i, area: 'social-sciences' },
  { re: /^(?:any )?lab science(?: elective)?\s*$/i, area: 'technology-mathematics-sciences', part: 'lab-science' },
];
const FREE_ROW = /^free electives?\b/i;

/** The approved list of one Core IMPACTS area (or one part of it), as list rows. */
function coreList(ctx, areaId, partId = null) {
  const area = (ctx.core.areas ?? []).find((a) => a.id === areaId);
  const part = partId ? area?.parts?.find((p) => p.id === partId) : area;
  if (!part) return null;
  const rows = [];
  for (const entry of part.courses ?? []) {
    const codes = (entry.codes ?? []).map(norm);
    if (codes.length > 1) {
      const pair = pairRow(ctx, codes);
      if (pair) rows.push(pair);
      continue;
    }
    if (ctx.all.has(codes[0])) rows.push(listRow(ctx, codes[0]));
  }
  const limits = [...(part.limits ?? area.limits ?? []).map((l) => l.quote?.quote).filter(Boolean), ...(part.footnotes ?? [])];
  return { rows, url: area.url, label: part.label ?? area.label, limits };
}

/** Computer Science's Junior Design Options footnote, as the sets it names with courses. */
function juniorDesignSets(ctx, text) {
  if (!/Junior Design Options are as follows/i.test(text)) return null;
  const sets = [];
  for (const m of text.matchAll(/Option\s*(\d)\s*-\s*([\s\S]*?)(?=Option\s*\d\s*-|Six credits|$)/g)) {
    // The two Music Technology pages print the advisor note right after Option 5 ("Option 5 - CS
    // 4723 (3 hours), LMC 3403 (3 hours) = 6 hours *See advisor for requirements to substitute
    // Research Option OR VIP Option ..."), and its "Research Option" read as Option 5's own words,
    // so the option was left out and both boards kept only Options 1 and 4 (2026-11-09). The note
    // is about substitutions, not part of the option.
    const words = m[2].split(/\*\s*See advisor\b/i)[0];
    // Option 4 prints two ways; the first is the one with its own courses.
    const first = words.split(/\bOR\b/)[0];
    const codes = [...new Set(codesIn(first))].filter((c) => ctx.all.has(c));
    // Option 2 ("ECE VIP courses and LMC 3403") and Option 3 ("Satisfy Georgia Tech Research Option")
    // are part courses, part a program the catalog does not list as courses: left out, not cut short.
    if (codes.length === 0 || /\bVIP\b|\bResearch Option\b/i.test(first)) continue;
    sets.push({ name: `Option ${m[1]}: ${codes.join(', ')}`, codes, n: Number(m[1]) });
  }
  return sets.length >= 2 ? sets.sort((a, b) => a.n - b.n) : null;
}

/**
 * ECE's Culminating Senior Design footnote names the courses by title: "ECE
 * Culminating Design I + ECE Culminating Design II", or an "Approved
 * single-semester capstone". The catalog's ECE 4000-level courses with those
 * titles are the sets.
 */
function seniorDesignSets(ctx, text) {
  if (!/Culminating Design I\b[\s\S]*Culminating Design II\b/i.test(text)) return null;
  const ece = [...ctx.undergrad].filter((c) => c.subject === 'ECE' && c.n >= 4000 && !c.noise);
  const one = ece.find((c) => /^ECE Culminating Design I$/i.test(c.title));
  const two = ece.find((c) => /^ECE Culminating Design II$/i.test(c.title));
  if (!one || !two) return null;
  const sets = [{ name: `Two-semester: ${one.code} + ${two.code}`, codes: [one.code, two.code] }];
  if (/single-semester capstone/i.test(text)) {
    for (const c of ece.filter((x) => /capstone/i.test(x.title)).sort((a, b) => a.n - b.n)) sets.push({ name: `Single-semester capstone: ${c.code}`, codes: [c.code] });
  }
  return sets;
}

// ---------------------------------------------------------------------------
// Shaping one program
// ---------------------------------------------------------------------------

/** The codes a program requires by name: non-indented rows with no alternative. */
function requiredCodes(program) {
  const out = new Set();
  for (const a of program.areas ?? []) for (const g of a.groups ?? []) for (const r of g.courses ?? []) {
    if (r.indented || (r.or?.length ?? 0) > 0) continue;
    out.add(norm(r.code));
  }
  return out;
}

/** Remove the course row at `index`, keeping every comment row's position right. */
function removeRow(group, index) {
  group.courses.splice(index, 1);
  for (const c of group.comments ?? []) if (c.at > index) c.at -= 1;
}

/**
 * "Select 6 credits of the following:" said the way the adapter reads hours.
 * Its chooseCount takes the number before "credit hours" as hours and the one
 * before a bare "credits" as a count of courses, so Industrial Engineering's
 * six credits of engineering electives read as six courses. The label says
 * "credit hours"; the catalog's own words stay in `shaped.from`.
 */
const asHours = (text) => text
  .replace(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen)\s+credits\b/gi, '$1 credit hours')
  // "ECE 3000/4000 Elective" (one Electrical Engineering page; the others print "3000/4000-level"):
  // chooseCount reads a number before "elective" as a count, and asked for 4000 courses.
  .replace(/\b([1-4]000)\s+(electives?|courses?)\b/gi, '$1-level $2');

function rebuildNote(group) {
  group.note = (group.comments ?? []).map((c) => c.text).join(' ');
}

/**
 * A comment row that is a category of its own: hours, and no indented options
 * under it. Where a second comment row sits at the same place ("HTS Electives"
 * 3 over "Select two of the following:" 6), the options below are the second
 * one's, and the first is a category whose hours the block adds up on top.
 */
function isCategoryRow(group, c) {
  if (!(c.hours > 0)) return false;
  const comments = group.comments ?? [];
  const stacked = comments.some((o) => o !== c && o.at === c.at && comments.indexOf(o) > comments.indexOf(c) && o.hours > 0);
  // "Select nine hours of INTA electives:" (9) stacked over "Select one of the following:" (3): the
  // first selects from no rows of its own; it is a category.
  if (/\b(?:select|choose)\b[^.]*:\s*$/i.test(c.text) && !stacked) return false;
  const next = group.courses?.[c.at];
  if (next?.indented && !stacked) return false;
  return true;
}

/**
 * The "Select" lists of a block that also has required rows (or several lists),
 * where every list states its hours: Computer Science's thread Concentration
 * (CS 2110, CS 2200, ... then "Select nine credit hours of the following for
 * Society and Systems:" 9 and "Select two of the following for Computational
 * Science and Engineering:" 6), Mathematics with Computing's concentrations,
 * Civil Engineering's. Read as one block, the options' catalog hours run past
 * the block's own, the adapter takes the whole table for one list sized by the
 * block (mergeAreaPool), and the required rows become optional: a CS board
 * could skip CS 2110. Each list is its rows from its heading down to the next
 * row that is not indented (or the next comment row); a lead-in with no hours
 * stacked on the heading ("Circuit Technology Electives") goes with it.
 * Null where any comment row over indented rows has no hours (the HTS
 * specialization groups, "Group 1"/"Group 2": a structure of its own).
 */
function selectLists(group) {
  const comments = group.comments ?? [];
  const rows = group.courses ?? [];
  if (!comments.length || !rows.length) return null;
  const lists = [];
  for (const [k, c] of comments.entries()) {
    const next = comments[k + 1];
    if (next && next.at === c.at) continue; // a lead-in: the last comment at this row heads the list
    if (c.at >= rows.length) continue;
    const first = rows[c.at];
    if (!first.indented && first.credits != null) continue; // a heading over required rows, not a list
    const stop = comments.find((o) => o.at > c.at)?.at ?? rows.length;
    const run = [];
    for (let i = c.at; i < stop; i += 1) {
      if (rows[i].indented || (rows[i].credits == null && run.length === i - c.at)) run.push(i);
      else break;
    }
    if (!run.length) continue;
    // The comment rows stacked at this row, down to the one that heads it ("Select 6 credits of the
    // following:" 6 over "Group 1:"), less any that is sized and a category of its own.
    const stack = comments.filter((o) => o.at === c.at && comments.indexOf(o) <= k);
    const sized = stack.filter((o) => o.hours > 0);
    const prev = lists[lists.length - 1];
    if (sized.length === 0) {
      // A sub-heading inside the list above, its rows running on from that list's ("Electives:" 12, then
      // "Vertically Integrated Project courses" over ME 4699 and the VIP rows; "Group 2:").
      if (prev && prev.rows[prev.rows.length - 1] === c.at - 1) { prev.rows.push(...run); prev.parts.push(...stack); continue; }
      return null;
    }
    lists.push({ comments: stack.filter((o) => !(o.hours > 0) || o === sized[sized.length - 1]), head: sized[sized.length - 1], rows: run, parts: [] });
  }
  if (!lists.length) return null;
  const listed = new Set(lists.flatMap((l) => l.rows));
  const required = rows.filter((r, i) => !listed.has(i) && r.credits != null);
  if (required.length === 0 && lists.length < 2) return null;
  return lists;
}

/**
 * One Electrical Engineering page prints its Political Science and U.S.
 * History row (HIST 2111 or ...) under Mathematics and Quantitative Skills and
 * leaves its own heading empty. The row goes back under its heading, with its
 * hours, so neither area reads wrong.
 */
function misplacedCitizenshipRow(ctx, program, tally) {
  const areas = program.areas ?? [];
  const m = areas.find((a) => a.impacts === 'M');
  const p = areas.find((a) => a.impacts === 'P');
  if (!m || !p || (p.groups ?? []).some((g) => (g.courses?.length ?? 0) > 0)) return;
  const pList = new Set((ctx.core.areas.find((a) => a.id === 'political-science-us-history')?.courses ?? []).flatMap((c) => c.codes).map(norm));
  for (const g of m.groups ?? []) {
    const i = (g.courses ?? []).findIndex((r) => [r.code, ...(r.or ?? [])].map(norm).every((c) => pList.has(c)));
    if (i < 0) continue;
    const [row] = g.courses.splice(i, 1);
    for (const c of g.comments ?? []) if (c.at > i) c.at -= 1;
    const hours = row.credits ?? ctx.all.get(norm(row.code))?.credits ?? 0;
    m.hours -= hours;
    g.summedCredits = (g.summedCredits ?? 0) - hours;
    p.groups = [{ label: '', choose: null, chooseFrom: null, hours: null, courses: [row], note: '', summedCredits: hours, kind: 'all', shaped: { kind: 'moved', from: `${row.code} under ${m.label}`, basis: 'the page prints it one heading up; its own heading is empty' } }];
    p.hours = (p.hours ?? 0) + hours;
    tally.moved = (tally.moved ?? 0) + 1;
    return;
  }
}

/**
 * Courses a page counts inside a Core IMPACTS area, said in a footnote, made
 * a block of that area. Three shapes, all in Georgia Tech's words:
 *   - a zero-hour reminder footnoted "must complete one of the following:
 *     ECON 2100, ECON 2101, ECON 2105 or ECON 2106. These hours will also
 *     satisfy 3 hours of Core IMPACTS Social Sciences." (International
 *     Affairs and Modern Languages' "Economics Requirement");
 *   - the same sentence as a block's footnote with no row of its own
 *     ("Engineering students must complete one of the following economics
 *     classes: ... The course will also satisfy 3 hours of Core IMPACTS Social
 *     Science courses", 57 engineering pages), which no block enforced: a
 *     board met it only when its Social Sciences picks happened to include
 *     one of the four;
 *   - a row printed without hours whose footnote says the course counts there
 *     ("ECON 2106 is required for students pursuing the Business Option. This
 *     course will also satisfy 3 hours of Core IMPACTS Social Sciences", "ECON
 *     2106 will satisfy 3 credit hours of Social Sciences"), which was booked
 *     on top of nine Social Sciences hours, 3 hours past the total on all eight
 *     Business Option boards (2026-11-09).
 * Each becomes a pick-one (or the one required course) with those hours in
 * the named area, carved out of that area's "Any ..." list so the area keeps
 * its hours, and the reminder or row it came from goes. Once per program per
 * set of courses; skipped where a course of the set is already required by
 * name elsewhere on the page. A reminder that names no course (the same
 * page's "History Requirement": "one non-US History course") stays a note.
 */
function carveFootnotedReminders(ctx, program, tally) {
  const clean = (f) => String(f ?? '').replace(/[\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ');
  // "... will also satisfy 3 hours of Core IMPACTS Social Science courses" (some pages end there, no
  // period); Materials Science: "This course may also be applied to the Core IMPACTS Social Science area."
  const ONE_OF = /must complete one of the following(?: [A-Za-z ]+)?:\s*([^.]*?)\s*\.\s*(?:These hours|The course|This course) (?:will also satisfy (\d+) (?:credit )?hours of|may also be applied to(?: the)?) Core IMPACTS ([A-Za-z ,&]+?)(?: courses?| requirements?| area)?(?:\.|\s*$)/i;
  const ROW = /\b([A-Z]{2,4} \d{4}[A-Z]?)\b[^.]*?(?:\.\s*This course)? will (?:also )?satisfy (\d+) (?:credit )?hours of (?:Core IMPACTS )?([A-Za-z ,&]+?)(?: requirement| courses?| and\b|\.)/i;
  const areaFor = (name) => {
    const want = norm(name).replace(/\s+(?:REQUIREMENT|COURSES?)$/, '').replace(/S$/, '');
    return (program.areas ?? []).find((a) => a.impacts && norm(a.label).replace(/S$/, '').includes(want));
  };
  const requiredByName = new Set();
  for (const a of program.areas ?? []) for (const g of a.groups ?? []) if (g.kind === 'all' && !g.shaped) for (const r of g.courses ?? []) if (r.credits != null) requiredByName.add(norm(r.code));
  const done = new Set();
  const carve = ({ codes, hours, areaName, label, basis, footnotes, from }) => {
    const key = [...codes].sort().join('|');
    if (done.has(key) || !codes.length || codes.some((c) => requiredByName.has(c))) return false;
    const target = areaFor(areaName);
    const pool = target?.groups?.find((g) => g.shaped?.kind === 'core' && g.hours >= hours + 1);
    if (!pool) return false;
    pool.hours -= hours;
    pool.shaped = { ...pool.shaped, basis: `${pool.shaped.basis}; ${hours} of its hours are "${label}" (carved out beside it)` };
    target.groups.splice(target.groups.indexOf(pool), 0, poolGroup(ctx, {
      label, hours, rows: codes.map((x) => listRow(ctx, x)), kind: 'carved', from, basis, footnotes,
    }));
    done.add(key);
    tally.carved = (tally.carved ?? 0) + 1;
    return true;
  };
  const oneOf = (f) => {
    const m = clean(f).match(ONE_OF);
    if (!m) return null;
    const codes = [...new Set(codesIn(m[1]).map(norm))].filter((x) => ctx.all.has(x));
    // Where the sentence states no hours, the hours one of its courses carries (all four economics courses are 3).
    const hours = m[2] ? Number(m[2]) : Math.min(...codes.map((c) => ctx.all.get(c)?.credits ?? Infinity));
    return Number.isFinite(hours) ? { m, codes, hours, areaName: m[3] } : null;
  };
  for (const area of program.areas ?? []) {
    for (const group of [...(area.groups ?? [])]) {
      // A zero-hour reminder row.
      for (const c of [...(group.comments ?? [])]) {
        if (c.hours > 0) continue;
        const hit = (c.footnotes ?? []).map(oneOf).find(Boolean);
        if (!hit) continue;
        if (!carve({ ...hit, label: c.text, basis: `its footnote: ${hit.m[0].trim()}`, footnotes: c.footnotes, from: c.text })) continue;
        group.comments = group.comments.filter((o) => o !== c);
        if (!group.comments.length) delete group.comments;
        rebuildNote(group);
      }
      // A required row printed without hours, footnoted as counting in an area.
      if (group.shaped?.kind === 'required' && (group.courses ?? []).length === 1 && group.courses[0].credits == null) {
        const code = norm(group.courses[0].code);
        const foots = [...(group.footnotes ?? []), ...(group.courses[0].footnotes ?? []), ...(area.groups ?? []).flatMap((g) => g.footnotes ?? [])];
        const m = foots.map((f) => clean(f).match(ROW)).find((x) => x && norm(x[1]) === code);
        if (m && ctx.all.has(code) && carve({ codes: [code], hours: Number(m[2]), areaName: m[3], label: code, basis: `its footnote: ${m[0].trim()}`, footnotes: [m[0].trim()], from: code })) {
          area.groups = area.groups.filter((g) => g !== group);
          continue;
        }
      }
      // The sentence as a block's footnote, with no row of its own.
      for (const f of group.footnotes ?? []) {
        const hit = oneOf(f);
        if (!hit) continue;
        const label = `${hit.areaName.trim()}: one of ${hit.codes.join(', ')}`;
        carve({ ...hit, label, basis: `a footnote of ${area.label}: ${hit.m[0].trim()}`, footnotes: [hit.m[0].trim()], from: hit.m[0].trim() });
      }
    }
    area.groups = (area.groups ?? []).filter((g) => (g.courses?.length ?? 0) > 0 || (g.comments?.length ?? 0) > 0 || g.label || g.hours > 0 || g.shaped);
  }
}

/**
 * A row printed as several subjects with one number: "CHIN/FREN/GRMN/JAPN/
 * KOR/RUSS/SPAN 4500 Advanced Intercultural Seminar" (International Affairs
 * and Modern Languages, Global Economics and Modern Languages), "CX/MATH
 * 4640". The link goes to the first subject's course only, so the row read as
 * CHIN 4500 for every language concentration, French and Spanish included.
 * Each subject's course of that number in the catalog becomes an alternative
 * of the row (`or`). Read from the cached page (the link's title keeps the
 * printed words); without the cache, rows stay as they read.
 */
function slashSubjectRows(ctx, program, tally) {
  if (!ctx.pageOf) return;
  const html = ctx.pageOf(program.url);
  if (!html) return;
  const printed = new Map();
  for (const m of html.matchAll(/title="((?:[A-Z]{2,4}\/)+[A-Z]{2,4}) (\d{4}[A-Z]?)"/g)) {
    const subjects = m[1].split('/');
    const codes = subjects.map((sub) => `${sub} ${m[2]}`).filter((c) => ctx.all.has(c));
    if (codes.length > 1) printed.set(codes[0], codes);
  }
  if (!printed.size) return;
  for (const area of program.areas ?? []) for (const group of area.groups ?? []) for (const row of group.courses ?? []) {
    const codes = printed.get(norm(row.code));
    if (!codes) continue;
    const have = new Set([norm(row.code), ...(row.or ?? []).map(norm)]);
    const add = codes.filter((c) => !have.has(c));
    if (!add.length) continue;
    row.or = [...(row.or ?? []), ...add];
    row.orFrom = `printed "${codes.map((c) => c.split(' ')[0]).join('/')} ${codes[0].split(' ')[1]}"`;
    tally.slashRows = (tally.slashRows ?? 0) + 1;
  }
}

function shapeProgram(ctx, program, tally) {
  slashSubjectRows(ctx, program, tally);
  misplacedCitizenshipRow(ctx, program, tally);
  const required = requiredCodes(program);
  const programFoot = program.footnotes ?? {};

  for (const area of program.areas ?? []) {
    const out = [];
    for (const group of area.groups ?? []) {
      const extracted = [];
      const orphanRows = [];

      // "&" pairs on the row's own code: the title bundleOf reads. And a lecture row printed with its
      // lab under an older title ("BIOS 1107 Principles of Biology I and Biological Principles
      // Laboratory", 4): where the row's hours are the course's and its "L" lab's together, the
      // catalog titles, so the pair is not read as the 3-hour lecture alone.
      for (const row of group.courses ?? []) {
        const code = norm(row.code);
        let partners = (row.and?.[row.code] ?? []).map(norm);
        if (!partners.length && / and /.test(row.title ?? '')) {
          const lab = ctx.all.get(`${code}L`);
          // With hours: they are the pair's. Without (an option row): its title names a laboratory.
          const fits = row.credits != null ? (ctx.all.get(code)?.credits ?? 0) + (lab?.credits ?? 0) === row.credits : /\blab(?:orator(?:y|ies))?\b/i.test(row.title.split(' and ').slice(1).join(' and '));
          if (lab && fits) partners = [lab.code];
        }
        if (!partners.length) continue;
        const pair = pairRow(ctx, [code, ...partners]);
        if (!pair || row.title === pair.title) continue;
        if (row.credits != null && row.credits !== pair.credits) continue;
        row.title = pair.title;
        tally.pairs += 1;
      }

      // Rows printed indented with no hours at the top of a block, above every comment row: no
      // "Select" row heads them, so they are no options. Business Option opens with "ECON 2106"
      // (footnote: it "will satisfy 3 credit hours of Social Sciences and the ECON requirement"),
      // Biology's majors with PHYS 2211 and PHYS 2212, Public Policy's with POL 1101 ("still
      // required for the program"). In front of the block's own rows they make the adapter read the
      // whole block as one list. A course the degree requires by name elsewhere is a reminder here
      // and leaves the block (kept in `reminders`); any other is required, in a group of its own.
      const firstComment = Math.min(...(group.comments ?? []).map((c) => c.at), (group.courses ?? []).length);
      // Only a short run at the top, and only above rows printed with hours or a list (a block of
      // nothing but options is a list).
      let top = 0;
      while (top < firstComment && group.courses[top].indented && group.courses[top].credits == null) top += 1;
      const credited = (group.courses ?? []).slice(top, firstComment).some((r) => !r.indented && r.credits != null);
      if (top > 0 && (credited || firstComment < (group.courses ?? []).length)) {
        if (top <= 3) {
          for (let i = top - 1; i >= 0; i -= 1) {
            const row = group.courses[i];
            const code = norm(row.code);
            removeRow(group, i);
            if (required.has(code) && !(row.or?.length)) {
              (group.reminders ??= []).unshift(code);
              tally.reminders = (tally.reminders ?? 0) + 1;
            } else {
              const { indented, ...rest } = row;
              orphanRows.unshift(rest);
            }
          }
        }
      }

      // Required, in a group of their own: their hours are counted elsewhere (the page prints none
      // here), so beside the block's own rows they would push it past its hours and read as a list.
      if (orphanRows.length) {
        extracted.push({ label: '', choose: null, chooseFrom: null, hours: null, courses: orphanRows, note: '', summedCredits: 0, kind: 'all', shaped: { kind: 'required', from: orphanRows.map((r) => r.code).join(', '), basis: 'printed without hours above the block\'s lists; required, its hours counted elsewhere on the page' } });
        tally.required = (tally.required ?? 0) + orphanRows.length;
      }

      // "MATH 1711 or MATH 1551 & MATH 1553": a required row whose alternative is a pair, as a pick-one of sets.
      for (let i = (group.courses ?? []).length - 1; i >= 0; i -= 1) {
        const row = group.courses[i];
        if (row.indented || !row.and || !(row.or?.length)) continue;
        const alts = [row.code, ...row.or].map(norm);
        if (!alts.some((a) => row.and[a]?.length)) continue;
        const sets = alts.map((a) => ({ name: [a, ...(row.and[a] ?? []).map(norm)].join(' & '), codes: [a, ...(row.and[a] ?? []).map(norm)] }));
        if (sets.some((s) => s.codes.some((c) => !ctx.all.has(c)))) continue;
        removeRow(group, i);
        extracted.unshift(setsGroup(ctx, {
          label: 'Complete one option',
          sets,
          kind: 'sets',
          from: sets.map((s) => s.name).join(' or '),
          basis: 'the row and its "&" alternative',
        }));
        tally.orPairs += 1;
      }

      // A sized row over options the engine has no hours for: Chemistry's "Research Experience" (2)
      // over CHEM 4695 and CHEM 4699, research and internship courses the catalog flags as noise and
      // the engine's index leaves out. Read in place, the adapter cannot price the list against its
      // hours and takes every row of the block as required. Its own list group, sized by its hours.
      for (const c of [...(group.comments ?? [])]) {
        if (!(c.hours > 0) || /\b(?:select|choose)\b/i.test(c.text)) continue;
        const stop = Math.min(...(group.comments ?? []).filter((o) => o.at > c.at).map((o) => o.at), group.courses.length);
        let end = c.at;
        while (end < stop && group.courses[end]?.indented && group.courses[end].credits == null) end += 1;
        const run = group.courses.slice(c.at, end);
        if (run.length < 2 || !run.every((r) => { const k = ctx.all.get(norm(r.code)); return !k || k.noise || k.n >= 6000; })) continue;
        for (let i = end - 1; i >= c.at; i -= 1) removeRow(group, i);
        group.comments = group.comments.filter((o) => o !== c);
        if (!group.comments.length) delete group.comments;
        rebuildNote(group);
        extracted.push({ ...poolGroup(ctx, { label: c.text, hours: c.hours, rows: run.map((r) => ({ code: norm(r.code), title: r.title ?? '', credits: null })), kind: 'list', from: c.text, basis: 'the rows printed under it; research and internship courses, which the engine does not plan', footnotes: c.footnotes }), kind: 'menu' });
        tally.lists += 1;
      }

      // Category rows.
      const comments = group.comments ?? [];
      const keep = [];
      for (let k = 0; k < comments.length; k += 1) {
        const c = comments[k];
        if (!isCategoryRow(group, c)) { keep.push(c); continue; }
        const text = c.text.trim();
        const foot = (c.footnotes ?? []).filter((f) => !/^Minimum grade of [A-D] required\.?$/i.test(f.trim()));
        // A row of no hours right under it that only spells it out ("INTA electives | INTA 1000-,2000-,
        // 3000-,4000-level courses" under "Select nine hours of INTA electives:") is its words too.
        const detail = comments[k + 1];
        const spells = detail && detail.at === c.at && !(detail.hours > 0) && detail.detail && text.toLowerCase().includes(detail.text.trim().toLowerCase());
        const made = shapeCategory(ctx, { text: spells ? `${text} ${detail.detail}` : text, hours: c.hours, foot, area, program, required, programFoot, tally });
        if (made) {
          made.label = asHours(made.label);
          made.note = asHours(made.note);
        }
        if (made && spells) {
          k += 1;
          made.label = text.replace(/[\s:]+$/, '');
          made.note = `${made.label}: ${detail.detail}`;
        }
        if (!made) { keep.push(c); continue; }
        // Two category rows with the same words in one block ("Lab Science" 4, "Lab Science" 4): one list of both hours.
        const prev = extracted[extracted.length - 1];
        if (prev && prev.shaped?.from === text && prev.courses.length === made.courses.length && prev.shaped.kind === made.shaped.kind) {
          prev.hours += made.hours;
          prev.kind = prev.summedCredits > prev.hours + 0.5 ? 'menu' : 'all';
          continue;
        }
        // A zero-hour heading right above it, at the same row ("Circuit Technology Electives"), goes with it.
        const lead = keep[keep.length - 1];
        if (lead && lead.at === c.at && !(lead.hours > 0) && !/\brequirements?\b/i.test(lead.text)) {
          keep.pop();
          made.label = `${lead.text.replace(/[\s:]+$/, '')}: ${made.label}`;
          made.note = made.label;
        }
        extracted.push(made);
      }
      if (keep.length !== comments.length) {
        if (keep.length) group.comments = keep;
        else delete group.comments;
        rebuildNote(group);
      }

      // Required rows and "Select" lists in one block, as one group each.
      const lists = selectLists(group);
      if (lists) {
        const at = new Set(lists.flatMap((l) => l.rows));
        const coreRows = group.courses.filter((_, i) => !at.has(i));
        const before = (i) => group.courses.slice(0, i).filter((_, k) => !at.has(k)).length;
        const heads = new Set(lists.flatMap((l) => [...l.comments, ...l.parts]));
        const rest = (group.comments ?? []).filter((c) => !heads.has(c)).map((c) => ({ ...c, at: before(c.at) }));
        const made = lists.map((l) => {
          const rows = l.rows.map((i) => group.courses[i]);
          const head = l.head;
          const words = l.comments.map((c) => c.text.replace(/[\s:]+$/, '')).join(': ') + ':';
          const label = asHours(words);
          const credits = rows.reduce((sum, r) => sum + (ctx.all.get(norm(r.code))?.credits ?? 0), 0);
          return {
            label,
            choose: null,
            chooseFrom: null,
            hours: head.hours,
            courses: rows.map((r) => ({ ...r, indented: true })),
            note: label,
            summedCredits: 0,
            // A list to pick from: its heading offers a choice over options. One row is the row.
            kind: rows.length > 1 || credits > head.hours + 0.5 ? 'menu' : 'all',
            ...(head.footnotes?.length ? { footnotes: head.footnotes } : {}),
            ...(l.parts.length ? { parts: l.parts.map((p) => p.text) } : {}),
            shaped: { kind: 'select', from: words, basis: 'its own rows on the page, split from the required rows of its block' },
          };
        });
        group.courses = coreRows;
        if (rest.length) group.comments = rest;
        else delete group.comments;
        rebuildNote(group);
        tally.selects = (tally.selects ?? 0) + made.length;
        extracted.unshift(...made);
      }

      // A block whose heading carries its hours and whose table names nothing ("Breadth Electives" 15,
      // "Upper Division Electives" 7, "Minor or Certificate Requirement" 15 over "Students must select
      // a minor (15 hours) or certificate (12 hours)"): free electives under that name, else open hours.
      if ((group.courses?.length ?? 0) === 0 && group.hours > 0 && !group.shaped && extracted.length === 0) {
        const words = [area.label, group.note].filter(Boolean).join(': ');
        if (/\bfree electives?\b/i.test(area.label ?? '')) {
          group.shaped = { kind: 'free', from: words, basis: 'free electives' };
          tally.free += 1;
        } else {
          group.shaped = { kind: 'open', from: words, basis: group.note ? 'its words name no list of courses' : 'the catalog names no courses for it' };
          tally.open += 1;
        }
      }

      /**
       * The comment rows left in place said the way the adapter reads hours
       * (asHours), as the extracted lists already are. Biochemistry's Pre-Health
       * Option prints "Select 12 credits from the following:" (12) over 35
       * courses with no required row beside them, so no list was extracted,
       * the adapter took "12 credits" for twelve courses, and the board booked
       * twelve electives, 135 hours of a 122-hour degree (2026-11-09). The
       * printed words stay in `textAsPrinted`.
       */
      for (const c of group.comments ?? []) {
        const said = asHours(c.text);
        if (said === c.text) continue;
        c.textAsPrinted = c.text;
        c.text = said;
        tally.hoursWords = (tally.hoursWords ?? 0) + 1;
      }
      if (group.comments?.some((c) => c.textAsPrinted)) rebuildNote(group);

      const empty = (group.courses?.length ?? 0) === 0 && !(group.comments?.length) && !group.label && !(group.hours > 0);
      if (!empty) out.push(group);
      out.push(...extracted);
    }
    area.groups = out;
  }
  carveFootnotedReminders(ctx, program, tally);
}

/** One category row, shaped into a group, or null to leave it as it reads. */
function shapeCategory(ctx, { text, hours, foot, area, program, required, programFoot, tally }) {
  // Core IMPACTS placeholders.
  for (const p of IMPACTS_ROW) {
    if (!p.re.test(text)) continue;
    const list = coreList(ctx, p.area, p.part ?? null);
    if (!list || list.rows.length === 0) return null;
    tally.impacts += 1;
    return poolGroup(ctx, {
      label: text,
      hours,
      rows: list.rows,
      kind: 'core',
      from: text,
      basis: `Core IMPACTS ${list.label}: ${list.url}`,
      footnotes: [...list.limits, ...foot],
    });
  }

  // Free electives, by the row's words or its block's heading.
  if (FREE_ROW.test(text) || (/\bfree electives?\b/i.test(area.label ?? '') && /\belectives?\b/i.test(text))) {
    tally.free += 1;
    return hoursGroup({ label: text, hours, kind: 'free', from: text, basis: 'free electives', footnotes: foot });
  }

  // Option footnotes with real course choices. Where the row's own mark points at another footnote
  // (one Computer Science pair page marks "Junior Design Option" with the CS 4726 footnote), the
  // degree's footnote that lists the options is the one meant.
  const footText = foot.join(' ');
  const footOf = (re) => Object.values(programFoot).find((f) => re.test(f)) ?? '';
  const jd = /junior design/i.test(text) ? (juniorDesignSets(ctx, footText) ?? juniorDesignSets(ctx, footOf(/Junior Design Options are as follows/i))) : null;
  if (jd) {
    tally.options += 1;
    return setsGroup(ctx, { label: `${text} (select one option)`, sets: jd, kind: 'sets', from: text, basis: 'the Junior Design Options footnote (options naming no course left out)', footnotes: foot, hours });
  }
  const sd = /senior design/i.test(text) ? (seniorDesignSets(ctx, footText) ?? seniorDesignSets(ctx, footOf(/Culminating Design I\b/i))) : null;
  if (sd) {
    tally.options += 1;
    return setsGroup(ctx, { label: `${text} (select one option)`, sets: sd, kind: 'sets', from: text, basis: 'the Senior Design footnote, its courses found by title in the catalog', footnotes: foot, hours });
  }

  // The Ethics attribute list (gatech-core.json) for a sized "Ethics Requirement" row.
  if (/^ethics requirement\b/i.test(text) || /\bone\b[^.]*\bethics course\b/i.test(footText)) {
    const floor = levelsIn(footText)?.[0] ?? 1;
    const rows = (ctx.core.otherRequirements?.ethics?.courses ?? [])
      .flatMap((e) => e.codes ?? []).map(norm)
      .filter((c) => ctx.all.has(c) && Math.floor(numberOf(c) / 1000) >= floor && numberOf(c) < 6000)
      .map((c) => listRow(ctx, c));
    if (rows.length) {
      tally.lists += 1;
      return poolGroup(ctx, { label: text, hours, rows, kind: 'core', from: text, basis: `the Ethics attribute list (${ctx.core.otherRequirements.ethics.url})${floor > 1 ? `, ${floor}000-level or higher` : ''}`, footnotes: foot });
    }
  }

  // "Advisor approved courses": the catalog leaves the list to the advisor.
  if (/\badvisor[- ]approved\b|\bapproved by\b/i.test(text)) {
    tally.open += 1;
    return hoursGroup({ label: text, hours, kind: 'open', from: text, basis: 'the catalog leaves the courses to an advisor', footnotes: foot });
  }

  // A list in the row's footnotes and in its own words. The row's words count
  // when they name a subject with a level or "any" ("ECE 3000/4000-level
  // Elective", "any MUSI 4000-level courses"); words that only name a subject
  // ("ECON Electives", "Upper level Chemistry Electives") give way to a
  // footnote that lists the courses, and are read alone where there is none.
  const fromFoot = foot.length ? readCourseText(ctx, footText) : null;
  const footLevels = fromFoot && fromFoot.codes.length === 0 ? fromFoot.levels : null;
  const fromWords = readCourseText(ctx, text, { words: true, levels: footLevels });
  // Strong: the row's own words name a subject by its code, a college or a school, with "any"/"all" or a level.
  const named = subjectsIn(ctx, text).size > 0 || collegeSubjectsIn(ctx, text).size > 0;
  const specificWords = fromWords.codes.length > 0 && named && (/\b(?:any|all)\b|\bprefix|\bcourses from\b/i.test(text) || levelsIn(text) !== null || subjectsIn(ctx, text).size >= 2);
  let parts = [];
  if (fromFoot?.codes.length) parts.push(fromFoot);
  // The row's own specific words stand even beside a footnote that only leaves a choice to an advisor.
  if (fromWords.codes.length && (specificWords || (!fromFoot?.codes.length && !fromFoot?.judgement))) parts.push(fromWords);
  if (parts.length) {
    const excluded = new Set([...(fromFoot?.exclude ?? []), ...fromWords.exclude]);
    const explicit = new Set(parts.flatMap((p) => p.explicit));
    // A course this degree requires by name elsewhere cannot count here as well.
    // Research, internship and special-problems rows (the catalog's noise flag) are not planned: the
    // engine's catalog leaves them out, so a list naming them would offer what cannot be booked.
    const codes = [...new Set(parts.flatMap((p) => p.codes))].filter((c) => !excluded.has(c) && !ctx.all.get(c)?.noise && (!required.has(c) || explicit.has(c)));
    if (codes.length > 0) {
      const rows = codes.sort((a, b) => a.localeCompare(b)).map((c) => listRow(ctx, c));
      tally.lists += 1;
      const said = parts.map((p) => `${p === fromFoot ? 'its footnote' : 'its own words'}: ${p.why.join('; ')}`).join(' + ');
      return poolGroup(ctx, {
        label: text,
        hours,
        rows,
        kind: 'list',
        from: text,
        basis: `${said}${parts.some((p) => p.judgement) ? ' (some choices the catalog leaves to the school are not listed)' : ''}`,
        footnotes: foot,
      });
    }
  }

  // Nothing names a course: open hours in the catalog's words.
  tally.open += 1;
  return hoursGroup({ label: text, hours, kind: 'open', from: text, basis: foot.length ? 'its footnote names no list of courses' : 'the catalog names no courses for it', footnotes: foot });
}

// ---------------------------------------------------------------------------
// Mathematics with Computing: concentrations as option pages
// ---------------------------------------------------------------------------

const slugOf = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function splitExtraConcentrations(file, tally) {
  const out = [];
  for (const program of file.programs ?? []) {
    out.push(program);
    const extra = program.extraTables ?? [];
    const conc = extra.filter((t) => t.totalCredits && /concentration/i.test(t.firstArea ?? ''));
    // The degree's own row that the tables fill: "Concentration Requirements" with the tables' size.
    const host = (program.areas ?? []).flatMap((a, ai) => (a.groups ?? []).flatMap((g, gi) => (g.comments ?? []).map((c, ci) => ({ a, ai, g, gi, c, ci }))))
      .find((x) => /^concentration requirements?$/i.test(x.c.text.trim()) && conc.length > 1 && conc.every((t) => t.totalCredits === x.c.hours));
    if (!host || program.areas.length === 0) continue;
    program.options = [];
    for (const t of conc) {
      const name = (t.firstArea ?? '').replace(/\s+Concentration$/i, '').trim();
      const child = structuredClone(program);
      delete child.extraTables;
      delete child.options;
      child.id = `${program.id}/${slugOf(name)}`;
      child.name = `${program.name} - Concentration: ${name}`;
      child.concentration = name;
      child.parent = program.id;
      child.optionKind = 'concentration';
      child.url = program.url;
      // Its concentration table, as an area of its own after the block that names it.
      const a = child.areas[host.ai];
      const g = a.groups[host.gi];
      g.comments.splice(host.ci, 1);
      if (g.comments.length === 0) delete g.comments;
      rebuildNote(g);
      a.hours -= host.c.hours;
      const areas = structuredClone(t.areas);
      for (const ca of areas) ca.shaped = { kind: 'concentration', from: host.c.text, basis: `the degree page's ${t.firstArea} table` };
      child.areas.splice(host.ai + 1, 0, ...areas);
      child.blockSum = child.areas.reduce((n, x) => n + (x.hours ?? 0), 0);
      const codes = new Set(child.areas.flatMap((x) => x.groups.flatMap((gg) => gg.courses.map((c) => c.code))));
      child.courseCount = codes.size;
      out.push(child);
      program.options.push({ id: child.id, name, kind: 'concentration' });
      tally.concentrations += 1;
    }
    // The degree page is the menu now, as Georgia Tech's other option degrees are.
    program.menuOf = { areas: program.areas.length, reason: 'its concentrations are option pages (shape-programs.mjs)' };
    program.areas = [];
    program.courseCount = 0;
  }
  file.programs = out;
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

export function shapeProgramFile(file, ctx) {
  if (file.shaped?.version === SHAPE_VERSION) return { file, tally: file.shaped.counts, already: true };
  const tally = { impacts: 0, free: 0, lists: 0, options: 0, open: 0, pairs: 0, orPairs: 0, concentrations: 0 };
  splitExtraConcentrations(file, tally);
  for (const program of file.programs ?? []) {
    if (!(program.areas?.length)) continue;
    shapeProgram(ctx, program, tally);
  }
  file.shaped = {
    version: SHAPE_VERSION,
    by: 'scripts/gatech/shape-programs.mjs',
    counts: tally,
    ...(ctx.cacheNotes.length ? { notes: ctx.cacheNotes } : {}),
  };
  return { file, tally, already: false };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const inFile = resolve(ROOT, flag('--in') ?? 'public/gatech-programs.json');
  const outFile = resolve(ROOT, flag('--out') ?? inFile);
  const file = JSON.parse(readFileSync(inFile, 'utf8'));
  const { tally, already } = shapeProgramFile(file, loadShapeContext());
  if (already) {
    console.log(`${inFile} is already shaped (version ${SHAPE_VERSION}); nothing changed. Re-parse with programs.mjs --offline to shape again.`);
  } else {
    writeFileSync(outFile, JSON.stringify(file));
    console.log(`shaped ${inFile} -> ${outFile}`);
  }
  console.log(JSON.stringify(tally));
}
