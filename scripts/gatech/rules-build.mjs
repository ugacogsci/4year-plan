/**
 * Georgia Tech Core IMPACTS and university-wide rules, built from the cache.
 *
 * SOURCES (read from data/gatech-raw/rules/, cached by rules-crawl.mjs; this
 * script never touches the network):
 *   https://catalog.gatech.edu/academics/undergraduate/core-curriculum/ (+ the
 *     institution, mathematics, citizenship, humanities, writing, stem,
 *     social-sciences, constitution-history, wellness-requirement, ethics pages)
 *   https://catalog.gatech.edu/rules/2/  (II. Academic Calendar)
 *   https://catalog.gatech.edu/rules/5/  (V. Grades / Average)
 *   https://catalog.gatech.edu/rules/6/  (VI. Scholastic Regulations: standing, load)
 *   https://catalog.gatech.edu/rules/9/  (IX. Scheduling: repeats)
 *   https://catalog.gatech.edu/rules/10/ (X. Pass/Fail Grading)
 *   https://catalog.gatech.edu/rules/11/ (XI. Cross Enrollment / Concurrent Registration)
 *   https://catalog.gatech.edu/rules/12/ (XII. Examinations: advanced standing)
 *   https://catalog.gatech.edu/rules/13/ (XIII. Undergraduate Degrees: 120+2, residency)
 *   https://catalog.gatech.edu/academics/undergraduate/credit-tests-scores/transfer-credit/
 *   https://registrar.gatech.edu/current-students/calendars (tentative five-term table)
 *   https://registrar.gatech.edu/current-academic-calendar (summer session names)
 *
 * WRITES:
 *   public/gatech-core.json   Core IMPACTS areas -> hours, course lists, notes;
 *                             wellness, ethics and legislative lists; a
 *                             course -> tags index and the label -> tags map the
 *                             Illinois engine's gen-ed handling needs.
 *   public/gatech-rules.json  university rules, each with its source URL and
 *                             the catalog's own sentence.
 *
 * HOW TO RUN (from the worktree root, after rules-crawl.mjs):
 *   export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
 *   node scripts/gatech/rules-build.mjs
 *
 * HOW IT STAYS HONEST: every number in gatech-rules.json is written next to
 *   the sentence it came from, and every one of those sentences is checked
 *   against the cached page text. If a re-crawl brings a page whose wording
 *   changed, the build stops and names the quote that no longer matches,
 *   instead of shipping a number the catalog no longer says.
 *
 * WHAT IT CANNOT KNOW:
 *   - Earlier catalog editions (robots.txt disallows /archived-catalogs/), so
 *     "what changed for Fall 2026" is limited to what the current pages state.
 *   - The 2027-2028 catalog, which is not published yet (the live catalog is
 *     the 2026-2027 edition).
 *   - Exact term dates for 2026-2027: the registrar's dated calendar is served
 *     from /calevents/proxy, which refused this crawler (403 "Origin not
 *     allowed"). Only the static tentative five-term table is used.
 *   - Which "other CS class designated by the School" each major accepts for
 *     Institutional Priority; the degree pages say that, not the core page.
 *   - Whether a course carries HUM/SS/ETHS in a past catalog year (the notes
 *     say courses on a prior list still count if taken under that catalog).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'data/gatech-raw/rules');
const CAT = 'https://catalog.gatech.edu';
const CORE = `${CAT}/academics/undergraduate/core-curriculum`;

// ---------------------------------------------------------------------------
// Reading the cache
// ---------------------------------------------------------------------------

function slugOf(url) {
  const u = new URL(url);
  const p = `${u.hostname}${u.pathname}`.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '_');
  return `${p}${u.search ? `_${u.search.replace(/[^a-z0-9]+/gi, '_')}` : ''}.html`;
}

const log = JSON.parse(readFileSync(path.join(CACHE, 'fetch-log.json'), 'utf8'));

function page(url) {
  const file = path.join(CACHE, slugOf(url));
  if (!existsSync(file)) throw new Error(`not cached: ${url} (run scripts/gatech/rules-crawl.mjs)`);
  return readFileSync(file, 'utf8');
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...', copy: '(c)' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** One spelling for comparing a quote with a page: straight quotes, plain spaces and dashes. */
function norm(s) {
  return decode(s)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/[  -​]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Page text with block tags as spaces and inline tags (a, span, strong, sup)
 * removed outright, so "both <a>POL 1101</a>." reads "both POL 1101." and a
 * quote can be matched across a link.
 */
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/?(p|div|li|ul|ol|h\d|tr|td|th|dd|dt|dl|br|table|tbody|thead|caption|colgroup|col|main|section|article|nav)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
}

/** The page's own content: CourseLeaf's #textcontainer, or a Drupal <main>. */
function contentOf(html) {
  const tc = html.indexOf('id="textcontainer"');
  if (tc >= 0) {
    const end = html.indexOf('end #textcontainer', tc);
    return html.slice(html.lastIndexOf('<', tc), end > 0 ? end : undefined);
  }
  const m = html.match(/<main[\s\S]*?<\/main>/i);
  return m ? m[0] : html;
}

const textCache = new Map();
function textOf(url) {
  if (!textCache.has(url)) textCache.set(url, norm(stripTags(contentOf(page(url)))));
  return textCache.get(url);
}

const quoteFailures = [];
/** The catalog's own sentence, checked against the cached page. */
function cite(url, quote) {
  if (!textOf(url).includes(norm(quote))) quoteFailures.push({ url, quote });
  return { url, quote };
}

// ---------------------------------------------------------------------------
// CourseLeaf course lists
// ---------------------------------------------------------------------------

/**
 * Every sc_courselist table on a page, in order, with the prose that leads
 * into it (the audience line, "Select one of the following") and the
 * footnotes printed under it. Rows are course rows (one code, or a pair joined
 * by "&", taken together), "or" rows (an alternative to the row above), and
 * comment rows.
 */
function courseLists(html) {
  const body = contentOf(html);
  const out = [];
  const re = /<table class="sc_courselist"[\s\S]*?<\/table>(\s*<dl class="sc_footnotes"[\s\S]*?<\/dl>)?/g;
  let last = 0;
  let m;
  while ((m = re.exec(body))) {
    const lead = norm(stripTags(body.slice(last, m.index).replace(/<sup>[\s\S]*?<\/sup>/g, '')));
    last = m.index + m[0].length;
    const footnotes = {};
    if (m[1]) {
      for (const f of m[1].matchAll(/<dt>\s*<sup>\s*(\d+)\s*<\/sup>\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) footnotes[f[1]] = norm(stripTags(f[2]));
    }
    const rows = [];
    for (const tr of m[0].matchAll(/<tr class="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cls = tr[1];
      const cells = [...tr[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
      if (cls.includes('hidden')) continue;
      const comment = tr[2].match(/<span class="courselistcomment[^"]*">([\s\S]*?)<\/span>/);
      if (comment && !/bubblelink/.test(cells[0]?.[2] ?? '')) {
        rows.push({ kind: cls.includes('areaheader') ? 'heading' : 'comment', text: norm(stripTags(comment[1])) });
        continue;
      }
      const codeCell = cells.find((c) => /codecol/.test(c[1]))?.[2] ?? '';
      const codes = [...codeCell.matchAll(/title="([A-Z]{2,4})[\s\u00a0]+(\d{4}[A-Z]?)"/g)].map((x) => `${x[1]} ${x[2]}`);
      if (codes.length === 0) continue;
      const titleCell = cells[1]?.[2] ?? '';
      const sups = [...titleCell.matchAll(/<sup>\s*([\d,\s]+)\s*<\/sup>/g)].flatMap((x) => x[1].split(/[,\s]+/).filter(Boolean));
      const title = norm(stripTags(titleCell.replace(/<sup>[\s\S]*?<\/sup>/g, ''))).replace(/\s+and\s+/, ' and ');
      const hoursText = norm(stripTags(cells.find((c) => /hourscol/.test(c[1]))?.[2] ?? ''));
      rows.push({
        kind: cls.includes('orclass') ? 'or' : 'course',
        codes,
        title,
        hours: hoursText ? parseHours(hoursText) : null,
        footnotes: sups.map((n) => footnotes[n] ?? `(footnote ${n} not printed)`),
      });
    }
    out.push({ lead, rows, footnotes: Object.values(footnotes) });
  }
  return out;
}

function parseHours(t) {
  const r = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!r) return null;
  return r[2] ? { min: Number(r[1]), max: Number(r[2]) } : Number(r[1]);
}

const courseRows = (list) =>
  list.rows
    .filter((r) => r.kind === 'course' || r.kind === 'or')
    .map((r) => ({ codes: r.codes, title: r.title, hours: r.hours, ...(r.footnotes.length ? { footnotes: r.footnotes } : {}), ...(r.kind === 'or' ? { orWithPrevious: true } : {}) }));

/**
 * A page's notes, verbatim: every paragraph that starts "Note:", and each
 * top-level item of the list under a "Notes:" heading (a nested list is kept
 * inside its parent item, as the page prints it).
 */
function notesOf(url) {
  const html = contentOf(page(url));
  const notes = [];
  for (const p of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const t = norm(stripTags(p[1]));
    if (/^Note:/.test(t)) notes.push(t.replace(/^Note:\s*/, ''));
  }
  const head = html.search(/<p>\s*(?:<strong>)?\s*Notes:?\s*(?:<\/strong>)?\s*<\/p>\s*<(?:ol|ul)>/);
  if (head >= 0) {
    const start = html.indexOf('<', html.indexOf('</p>', head) + 4);
    let depth = 0;
    let itemStart = -1;
    for (const t of html.slice(start).matchAll(/<(\/?)(ol|ul|li)\b[^>]*>/g)) {
      const at = start + t.index;
      const closing = t[1] === '/';
      if (t[2] !== 'li') {
        depth += closing ? -1 : 1;
        if (depth === 0) break;
      } else if (depth === 1 && !closing) itemStart = at;
      else if (depth === 1 && closing && itemStart >= 0) {
        notes.push(norm(stripTags(html.slice(itemStart, at))));
        itemStart = -1;
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Core IMPACTS
// ---------------------------------------------------------------------------

const U = {
  core: `${CORE}/`,
  institution: `${CORE}/institution/`,
  mathematics: `${CORE}/mathematics/`,
  citizenship: `${CORE}/citizenship/`,
  humanities: `${CORE}/humanities/`,
  writing: `${CORE}/writing/`,
  stem: `${CORE}/stem/`,
  social: `${CORE}/social-sciences/`,
  history: `${CORE}/constitution-history/`,
  wellness: `${CORE}/wellness-requirement/`,
  ethics: `${CORE}/ethics/`,
  rule: (n) => `${CAT}/rules/${n}/`,
  transfer: `${CAT}/academics/undergraduate/credit-tests-scores/transfer-credit/`,
  passFail: `${CAT}/policies/grading-gpa/pass-fail-system-rules/`,
  gradeSub: `${CAT}/policies/grading-gpa/grade-substitution/`,
  calendars: 'https://registrar.gatech.edu/current-students/calendars',
  fiveTerm: 'https://registrar.gatech.edu/tentative-five-term-school-calendar',
  liveCalendar: 'https://registrar.gatech.edu/current-academic-calendar',
};

/** Tag strings a course carries for each list. HUM, SS and ETHS are the catalog's own attribute codes. */
const TAG = {
  institution: 'Core IMPACTS: Institutional Priority',
  mathematics: 'Core IMPACTS: Mathematics & Quantitative Skills',
  citizenship: 'Core IMPACTS: Political Science & U.S. History',
  humanities: 'HUM',
  writing: 'Core IMPACTS: Communicating in Writing',
  labScience: 'Core IMPACTS: Lab Science',
  stemMath: 'Core IMPACTS: Technology, Mathematics & Sciences (Mathematics)',
  social: 'SS',
  ethics: 'ETHS',
  wellness: 'Wellness',
  legUsHistory: 'Legislative: U.S. History',
  legGaHistory: 'Legislative: Georgia History',
  legUsConstitution: 'Legislative: U.S. Constitution',
  legGaConstitution: 'Legislative: Georgia Constitution',
};

function onlyList(url, expect = 1) {
  const lists = courseLists(page(url));
  if (lists.length !== expect) throw new Error(`${url}: expected ${expect} course list(s), found ${lists.length}`);
  return lists;
}

const [instList] = onlyList(U.institution);
const [mathList] = onlyList(U.mathematics);
const [citList] = onlyList(U.citizenship);
const [humList] = onlyList(U.humanities);
const [writList] = onlyList(U.writing);
const stemLists = onlyList(U.stem, 4);
const [ssList] = onlyList(U.social);
const [wellList] = onlyList(U.wellness);
const [ethList] = onlyList(U.ethics);

const stemAudience = (lead) => {
  const m = lead.match(/(All students with majors in[^|]*?|All other majors)\s*$/);
  return m ? m[1].trim() : lead.slice(-160);
};

/** One college's mathematics list: hours from its own rows ("select one" -> the options' range, else their sum). */
function mathPart(list) {
  const courses = courseRows(list);
  const one = list.rows.some((r) => r.kind === 'comment' && /select one/i.test(r.text));
  const h = courses.map((c) => (typeof c.hours === 'number' ? c.hours : c.hours?.min ?? 0));
  return {
    hours: one ? { min: Math.min(...h), max: Math.max(...h) } : { min: h.reduce((a, b) => a + b, 0), max: h.reduce((a, b) => a + b, 0) },
    choose: one ? { courses: 1 } : { all: true },
    courses,
  };
}

const areas = [
  {
    id: 'institutional-priority',
    usgArea: 'I',
    label: 'Institutional Priority',
    catalogShortName: 'Institution',
    programPageHeading: 'Institutional Priority',
    url: U.institution,
    hours: { min: 3, max: 3 },
    hoursStated: false,
    hoursBasis: 'One course; CS 1301 is 3 credit hours. The page states no area total.',
    rule: 'Complete CS 1301, or another CS class designated by the student\'s School.',
    ruleQuote: cite(U.institution, 'Students must complete the following to satisfy the Institutional Priority area:'),
    choose: { courses: 1 },
    tag: TAG.institution,
    courses: courseRows(instList),
    designatedAlternatives: {
      codes: ['CS 1315', 'CS 1371'],
      basis: 'Not on the core page (its footnote says only "Or another CS class designated by the School"). Seen as "or" rows under Institutional Priority on degree pages cached in data/gatech-raw/programs/ (e.g. Applied Languages and Intercultural Studies lists CS 1301 or CS 1315 or CS 1371; Aerospace Engineering requires CS 1371). Read the degree page for each major.',
    },
    notes: notesOf(U.institution),
  },
  {
    id: 'mathematics-quantitative',
    usgArea: 'M',
    label: 'Mathematics & Quantitative Skills',
    catalogShortName: 'Mathematics',
    programPageHeading: 'Mathematics and Quantitative Skills',
    url: U.mathematics,
    hours: { min: 4, max: 4 },
    hoursStated: false,
    hoursBasis: 'One course; both listed options are 4 credit hours. The page states no area total.',
    rule: 'Complete one course: MATH 1552 (required for Architecture, Computing, Engineering and Sciences majors) or MATH 1712 (an option for Business and Liberal Arts programs). The degree program decides.',
    ruleQuote: cite(U.mathematics, 'Students must complete one of the following courses to satisfy the Mathematics & Quantitative Skills area:'),
    choose: { courses: 1 },
    tag: TAG.mathematics,
    courses: courseRows(mathList),
    notes: notesOf(U.mathematics),
  },
  {
    id: 'political-science-us-history',
    usgArea: 'P',
    label: 'Political Science & U.S. History',
    catalogShortName: 'Citizenship',
    programPageHeading: 'Political Science and U.S. History',
    url: U.citizenship,
    hours: { min: 3, max: 3 },
    hoursStated: false,
    hoursBasis: 'One course ("select one"); every listed course is 3 credit hours.',
    rule: 'Select one course. A second course from this list may count toward Social Sciences, but one course may not satisfy two Core IMPACTS areas.',
    ruleQuote: cite(U.citizenship, 'Students must select one of the following courses to satisfy the Political Science & U.S. History area:'),
    choose: { courses: 1 },
    tag: TAG.citizenship,
    courses: courseRows(citList),
    notes: notesOf(U.citizenship),
  },
  {
    id: 'arts-humanities-ethics',
    usgArea: 'A',
    label: 'Arts, Humanities & Ethics',
    catalogShortName: 'Humanities',
    programPageHeading: 'Arts, Humanities, and Ethics',
    programPagePlaceholder: 'Any HUM',
    url: U.humanities,
    hours: { min: 6, max: 6 },
    hoursStated: true,
    hoursBasis: 'Stated on the page.',
    rule: '6 credit hours of courses carrying the HUM attribute. At most 3 of those hours may come from one introductory (1002-, 2001- or 2002-numbered) modern language course that carries HUM; credit from a second such course never counts here.',
    ruleQuote: cite(U.humanities, 'Students must complete 6 credit hours of courses that carry the Arts, Humanities & Ethics (HUM) attribute.'),
    choose: { hours: 6 },
    attribute: 'HUM',
    tag: TAG.humanities,
    limits: [
      {
        rule: 'introductory-modern-language-cap',
        maxHours: 3,
        appliesTo: 'one course numbered 1002, 2001 or 2002 in a modern language, carrying HUM',
        quote: cite(U.humanities, 'Students are permitted to apply a maximum of 3 credit hours from one introductory (1002-, 2001-, or 2002-numbered) Modern Language course that carries the HUM attribute toward their Core IMPACTS area humanities requirement.'),
      },
    ],
    courses: courseRows(humList),
    notes: notesOf(U.humanities),
  },
  {
    id: 'communicating-in-writing',
    usgArea: 'C',
    label: 'Communicating in Writing',
    catalogShortName: 'Writing',
    programPageHeading: 'Communicating in Writing',
    url: U.writing,
    hours: { min: 6, max: 6 },
    hoursStated: false,
    hoursBasis: 'Both listed courses are required, 3 credit hours each.',
    rule: 'Complete ENGL 1101 and ENGL 1102.',
    ruleQuote: cite(U.writing, 'Students must complete both of the following courses to satisfy the Communicating in Writing area:'),
    choose: { all: true },
    tag: TAG.writing,
    courses: courseRows(writList),
    notes: notesOf(U.writing),
  },
  {
    id: 'technology-mathematics-sciences',
    usgArea: 'T',
    label: 'Technology, Mathematics & Sciences',
    catalogShortName: 'STEM',
    programPageHeading: 'Technology, Mathematics, and Sciences',
    programPagePlaceholder: 'Lab Science',
    url: U.stem,
    hours: { min: 12, max: 14 },
    hoursStated: true,
    hoursBasis: 'Stated as 8 credit hours of lab sciences plus 4-6 credit hours of mathematics.',
    rule: '8 credit hours of lab science from the Sciences list, plus 4-6 credit hours of mathematics from the list for the student\'s college. College of Engineering and School of Physics students must take PHYS 2211 and PHYS 2212.',
    ruleQuote: cite(U.stem, 'Students will select 8 credit hours of lab sciences and 4-6 credit hours of Mathematics from the course lists below.'),
    parts: [
      {
        id: 'lab-science',
        label: 'Sciences',
        hours: { min: 8, max: 8 },
        choose: { hours: 8 },
        tag: TAG.labScience,
        courses: courseRows(stemLists[0]),
        footnotes: stemLists[0].footnotes,
      },
      ...stemLists.slice(1).map((list, i) => ({
        id: ['math-architecture-engineering-sciences', 'math-computing-cmpe-ee', 'math-all-other-majors'][i],
        label: 'Mathematics',
        audience: stemAudience(list.lead),
        ...mathPart(list),
        tag: TAG.stemMath,
        footnotes: list.footnotes,
      })),
    ],
    notes: notesOf(U.stem),
  },
  {
    id: 'social-sciences',
    usgArea: 'S',
    label: 'Social Sciences',
    catalogShortName: 'Social Sciences',
    programPageHeading: 'Social Sciences',
    programPagePlaceholder: 'Any SS',
    url: U.social,
    hours: { min: 9, max: 9 },
    hoursStated: true,
    hoursBasis: 'Stated on the page.',
    rule: '9 credit hours of courses carrying the SS attribute. Credit is not awarded for both POL 1101 and INTA 1200. ECON 2100, 2101, 2105 and 2106 earn 3 hours, or 6 when ECON 2105 is completed with ECON 2106.',
    ruleQuote: cite(U.social, 'Students will select 9 credit hours of courses that carry the Social Sciences (SS) attribute.'),
    choose: { hours: 9 },
    attribute: 'SS',
    tag: TAG.social,
    limits: [
      { rule: 'no-credit-for-both', codes: ['POL 1101', 'INTA 1200'], quote: cite(U.social, 'Credit is not awarded for both POL 1101 and INTA 1200.') },
      {
        rule: 'econ-principles-cap',
        codes: ['ECON 2100', 'ECON 2101', 'ECON 2105', 'ECON 2106'],
        maxHours: 3,
        maxHoursWhen: { codes: ['ECON 2105', 'ECON 2106'], maxHours: 6 },
        quote: cite(U.social, 'Students can receive 3 credit hours for any of the following: ECON 2100, ECON 2101, ECON 2105, ECON 2106. Students may receive 6 credit hours if ECON 2105 is completed with ECON 2106.'),
      },
    ],
    courses: courseRows(ssList),
    notes: notesOf(U.social),
  },
];

const fieldOfStudy = {
  id: 'field-of-study',
  label: 'Field of Study',
  programPageHeading: 'Field of Study',
  hours: { min: 18, max: 18 },
  hoursStated: true,
  rule: '18 credit hours specific to each undergraduate program; the courses are on the degree page, not here.',
  quote: cite(U.core, 'The Field of Study area is comprised of 18 credit hours specific to each undergraduate program.'),
  url: U.core,
};

const sum = (k) => areas.reduce((s, a) => s + a.hours[k], 0);

// ---------------------------------------------------------------------------
// Wellness, ethics, Georgia legislative requirements
// ---------------------------------------------------------------------------

const wellness = {
  id: 'wellness',
  label: 'Wellness Requirement',
  url: U.wellness,
  rule: 'One 2-hour wellness course. It sits on top of the 120-hour minimum (120 + 2 = 122).',
  quote: cite(U.wellness, 'All undergraduate students attending Georgia Tech must satisfactorily complete a wellness requirement.'),
  choose: { courses: 1 },
  hours: 2,
  tag: TAG.wellness,
  courses: courseRows(wellList),
  footnotes: wellList.footnotes,
  medicalExemption: cite(U.rule(13), 'Unless medically exempted, all students are required to satisfy the wellness requirement prior to graduation, as specified in the Core Curriculum section of the Catalog.'),
};

const ethics = {
  id: 'ethics-attribute',
  label: 'Ethics Attribute (ETHS)',
  url: U.ethics,
  universityWide: false,
  rule: 'Not a university-wide requirement: some majors require an ETHS course, and some name their own ethics course instead. A course may count for ETHS and for Humanities or Social Sciences at the same time.',
  quotes: [
    cite(U.humanities, 'Some Georgia Tech major degree programs require completion of a separate Ethics (ETHS) requirement.'),
    cite(U.ethics, 'While some courses (as designated) meet Humanities or Social Science requirements, not all of the courses listed below will meet Core IMPACTS (general education) requirements.'),
    cite(U.social, 'Some Social Sciences courses may also carry the Georgia Tech assigned Ethics (ETHS) attribute. These courses may be used to serve both purposes.'),
  ],
  attribute: 'ETHS',
  tag: TAG.ethics,
  courses: courseRows(ethList),
};

const legislative = {
  id: 'georgia-legislative',
  label: 'Georgia Legislative Requirements (U.S. and Georgia History and Constitution)',
  url: U.history,
  law: cite(U.rule(13), 'The Georgia law, as amended March 4, 1953, requires that before graduation all students pass examinations or pass comparable courses in United States and Georgia history and in the United States and Georgia Constitutions.'),
  effective: cite(U.history, 'All incoming undergraduate students who first matriculate at Georgia Tech on or after May 1, 2023 will be required to follow these implementation requirements.'),
  hours: 0,
  hoursNote: 'No hours of its own: met by a course the student takes anyway (usually the Political Science & U.S. History pick or a Social Sciences course) or by a non-credit exam.',
  overlapWithCore: cite(U.history, 'Courses taken to satisfy Core Area E requirements (Social Sciences) can also be used to satisfy the legislative requirements, as specified above. The courses(s) can serve both purposes.'),
  parts: [
    {
      id: 'us-history',
      label: 'United States History',
      tag: TAG.legUsHistory,
      courses: ['HIST 2111', 'HIST 2112'],
      courseCredit: 'Taken at GT, transferred, or awarded for an AP or IB score.',
      exam: true,
    },
    {
      id: 'georgia-history',
      label: 'Georgia History',
      tag: TAG.legGaHistory,
      courses: ['HIST 2111', 'HIST 2112'],
      courseCredit: 'Only when taken at Georgia Tech (or shown as satisfied on a USG/TCSG transcript). AP or IB credit for HIST 2111/2112 does not meet Georgia History.',
      quote: cite(U.history, 'when completed at Georgia Tech, these courses satisfy both the United States History and the Georgia History legislative requirements.'),
      exam: true,
    },
    {
      id: 'us-constitution',
      label: 'United States Constitution',
      tag: TAG.legUsConstitution,
      courses: ['INTA 1200', 'POL 1101', 'PUBP 3000'],
      courseCredit: 'Taken at GT or transferred; AP credit counts only for INTA 1200 or POL 1101.',
      exam: true,
    },
    {
      id: 'georgia-constitution',
      label: 'Constitution of Georgia',
      tag: TAG.legGaConstitution,
      courses: ['INTA 1200', 'POL 1101', 'PUBP 3000'],
      courseCredit: 'Only when taken at Georgia Tech (or shown as satisfied on a USG/TCSG transcript).',
      quote: cite(U.history, 'receiving credit for either of these courses when taken at Georgia Tech satisfies both the United States Constitution and the Constitution of Georgia legislative requirements.'),
      exam: true,
    },
  ],
  examOption: {
    rule: 'Each of the four can instead be met by a non-credit Canvas exam, passed at 60% or higher. No credit, not on the transcript, satisfies nothing else. Take it before reaching 90 credit hours.',
    passingScore: 0.6,
    takeBeforeHours: 90,
    info: 'https://oue.gatech.edu/glr-requirement',
    quotes: [
      cite(U.history, 'Earn a satisfactory score (60% or higher) on the United States History Non-Credit Canvas Course Examination.'),
      cite(U.history, 'Students who elect to satisfy this legislative requirement by examination should do so before completing 90 or more credit hours.'),
      cite(U.history, 'An examination taken to satisfy this legislative requirement does not carry any academic credit and does not satisfy any other requirement for graduation.'),
    ],
  },
  staleWording: 'The constitution-history page still calls the Social Sciences area "Core Area E" (pre-2024 naming) and says it needs one of HIST 2111, HIST 2112, POL 1101, INTA 1200, PUBP 3000; under Core IMPACTS that five-course list is the Political Science & U.S. History area.',
  planningNote: 'One HIST 2111/2112 course taken at GT meets both history parts, and one INTA 1200/POL 1101/PUBP 3000 taken at GT meets both constitution parts. The Political Science & U.S. History area needs only ONE of these, so a student who picks HIST still owes the two constitution parts (another listed course, which can count as Social Sciences, or the exams), and one who picks POL/INTA/PUBP still owes the two history parts.',
};

// ---------------------------------------------------------------------------
// Course -> tags, and the label -> tags map for the engine
// ---------------------------------------------------------------------------

const tagsByCourse = {};
const addTag = (code, tag) => {
  (tagsByCourse[code] ??= []).includes(tag) || tagsByCourse[code].push(tag);
};
const tagRows = (rows, tag) => rows.forEach((r) => r.codes.forEach((c) => addTag(c, tag)));
for (const a of areas) {
  if (a.courses) tagRows(a.courses, a.tag);
  for (const p of a.parts ?? []) tagRows(p.courses, p.tag);
}
for (const c of areas[0].designatedAlternatives.codes) addTag(c, TAG.institution);
tagRows(wellness.courses, TAG.wellness);
// "Previously offered as HPS 1040 (Health)": an older transcript's HPS 1040 still meets Wellness.
for (const c of wellness.courses) for (const f of c.footnotes ?? []) for (const m of f.matchAll(/previously offered as ([A-Z]{2,4} \d{4})/gi)) addTag(m[1], TAG.wellness);
tagRows(ethics.courses, TAG.ethics);
for (const p of legislative.parts) p.courses.forEach((c) => addTag(c, p.tag));
for (const k of Object.keys(tagsByCourse)) tagsByCourse[k].sort();
const sortedTags = Object.fromEntries(Object.keys(tagsByCourse).sort().map((k) => [k, tagsByCourse[k]]));

/**
 * What a degree page's row or heading means, in the same shape as GENED_MAP in
 * lib/planner/illinois-data.ts (lower-case label -> tag strings a course must
 * carry). The keys are the spellings seen on Georgia Tech degree pages.
 */
const labelToTags = {
  'any hum': [TAG.humanities],
  'arts, humanities, and ethics': [TAG.humanities],
  'arts, humanities & ethics': [TAG.humanities],
  'any ss': [TAG.social],
  'social sciences': [TAG.social],
  'lab science': [TAG.labScience],
  'institutional priority': [TAG.institution],
  'mathematics and quantitative skills': [TAG.mathematics],
  'mathematics & quantitative skills': [TAG.mathematics],
  'political science and u.s. history': [TAG.citizenship],
  'political science & u.s. history': [TAG.citizenship],
  'communicating in writing': [TAG.writing],
  'technology, mathematics, and sciences': [TAG.labScience, TAG.stemMath],
  'technology, mathematics & sciences': [TAG.labScience, TAG.stemMath],
  'wellness requirement': [TAG.wellness],
  ethics: [TAG.ethics],
};

const core = {
  school: 'gatech',
  catalogEdition: '2026-2027',
  builtAt: new Date().toISOString(),
  fetchedAt: log[U.core]?.at ?? null,
  source: U.core,
  usgInfo: 'https://www.usg.edu/curriculum/core-impacts',
  appliesTo: cite(U.core, 'Core IMPACTS Requirements (for incoming Summer 2024 students and any student updating their Catalog year to 2024-25):'),
  olderCatalogs: 'Students on a 2023-2024 or older catalog year follow the old Core Areas A-F, published only in the archived catalogs (robots.txt disallows /archived-catalogs/, so not read here).',
  oneCourseOneArea: {
    rule: 'One course may not satisfy two Core IMPACTS areas. It MAY also count for the ETHS attribute, the legislative requirements, and major requirements that list it.',
    quote: cite(U.citizenship, 'Students may also take an additional course from this list to satisfy the Social Sciences area, but may not use one course to satisfy two Core IMPACTS areas.'),
  },
  noPassFail: cite(U.passFail, 'Courses taken to satisfy Core IMPACTS requirements, courses required for major, minor and certificate programs, courses that satisfy institutional requirements may not be taken as Pass/Fail.'),
  thirtyHourRule: {
    rule: 'After 30 earned hours, a student who has not finished Mathematics & Quantitative Skills or Communicating in Writing must take the next course toward it every term they enroll.',
    quotes: [
      cite(U.mathematics, 'students who have earned 30 hours but have not completed Mathematics & Quantitative Skills must enroll in the next course necessary to make progress toward completing this Area in every semester in which they take classes.'),
      cite(U.writing, 'students who have earned 30 hours but have not completed Communicating in Writing must enroll in the next course necessary to make progress toward completing this Area in every semester in which they take classes.'),
    ],
  },
  hoursSummary: {
    sevenAreas: { min: sum('min'), max: sum('max') },
    fieldOfStudy: 18,
    basis: 'Sum of the area hours above; Georgia Tech prints no core total. Institutional Priority, Mathematics, Political Science & U.S. History and Writing are sized from their course lists, the other three are stated.',
  },
  areas,
  fieldOfStudy,
  otherRequirements: { wellness, ethics, legislative },
  tagsByCourse: sortedTags,
  engineMapping: {
    labelToTags,
    howToUse: [
      'Illinois reads gen-ed membership from each course\'s genEd tags (RawIllinoisCourse.genEd -> CourseFacts.genEd and IllinoisCourse.tags, lib/planner/illinois-data.ts) and maps a requirement label to the tags it accepts with GENED_MAP / genEdForLabel. For Georgia Tech, set each course\'s genEd to tagsByCourse[code] ?? [] when building the course file, and use labelToTags as the Georgia Tech GENED_MAP (school-keyed, not merged into the Illinois map).',
      'Georgia Tech degree pages print every core area as its own heading with real course rows (CS 1371; MATH 1552; HIST 2111 or ...; ENGL 1101 + 1102), so most of the core parses as ordinary required/choose blocks with no gen-ed handling at all.',
      'Only three placeholder rows need tags: "Any HUM" (6) -> HUM, "Any SS" (9) -> SS, "Lab Science" (4 each, usually twice) -> Core IMPACTS: Lab Science. They are hours rows with no course, the shape illinois-data.ts reads as { kind: \'hours\', hours, genEd: genEdForLabel(label) }.',
      'MUST GATE: adaptIllinoisPrograms runs withCampusGenEd on every program, and a program without an Illinois campus table gets an appended "General Education Requirements (campus)" area holding Illinois categories and the Illinois third-semester language requirement. No Georgia Tech page has that table, so every Georgia Tech degree would get it. Skip withCampusGenEd (and genEdRulesFromText / GENED_CAMPUS_SIZE) when the school is gatech.',
      'exclusiveGroup: all seven Core IMPACTS areas share ONE ledger at Georgia Tech (a course counts for one area only; see oneCourseOneArea). The Illinois rule (each category its own ledger, Cultural Studies exclusive) does not fit. ETHS and the legislative tags are separate ledgers that may reuse a core course.',
      'Wellness is a 2-hour required area on every degree page ("Wellness Requirement": APPH 1040 or 1050 or 1060) and counts on top of the 120-hour minimum.',
      'The legislative requirement has no hours. Check it as a rule over the plan (has the student a GT HIST 2111/2112, and a GT INTA 1200/POL 1101/PUBP 3000?) and otherwise tell the student about the non-credit exams; do not book hours for it.',
    ],
  },
};

// ---------------------------------------------------------------------------
// University rules
// ---------------------------------------------------------------------------

/** The tentative five-term table, as printed (static HTML, dates subject to change). */
function fiveTermCalendar() {
  const html = contentOf(page(U.fiveTerm));
  const table = html.match(/<table[\s\S]*?<\/table>/);
  if (!table) return null;
  const rows = [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => norm(stripTags(c[1]))));
  const [head, ...body] = rows;
  const terms = head.slice(1);
  return terms.map((term, i) => ({ term, ...Object.fromEntries(body.map((r) => [r[0], r[i + 1] ?? null])) }));
}

const summerSessions = [...page(U.liveCalendar).matchAll(/<option value="(Summer-[A-Za-z]+)">([^<]+)<\/option>/g)].map((m) => ({ id: m[1], label: norm(m[2]) }));

const rules = {
  school: 'gatech',
  catalogEdition: '2026-2027',
  catalogEditionEvidence: 'Every cached catalog page is headed "2026-2027 Edition".',
  builtAt: new Date().toISOString(),
  fetchedAt: log[U.rule(13)]?.at ?? null,
  rulesIndex: `${CAT}/rules/`,

  degree: {
    minTotalHours: 120,
    wellnessHours: 2,
    minTotalWithWellness: 122,
    quote: cite(U.rule(13), 'A bachelor\'s degree program must require at least 120 credit hours, plus the Wellness Requirement, for a total of 122 credit hours.'),
    programTotalsDiffer: 'Each degree page states its own total, and pages differ on whether the 2 wellness hours are inside it: Computer Science says "a total of 124 credit hours for graduation, plus a two-hour Wellness course"; Aerospace Engineering lists the wellness row inside its table and prints Total Credit Hours 131. Use the degree page total and check which way it counts wellness; 120 + 2 is the floor.',
    upperDivision: {
      inMajorMin: 21,
      overallMin: 39,
      quote: cite(U.rule(13), 'A bachelor\'s degree program must require at least 21 credit hours of upper division courses in the major field and at least 39 credit hours of upper division work overall.'),
      note: 'Upper division means 3000-level or higher. Rule XIII does not define it; degree pages do, e.g. Biomedical Engineering: "A minimum of 39 credit hours of upper-division coursework (3000-level or higher) is required to graduate."',
    },
    minGpa: 2.0,
    minGpaQuote: cite(U.rule(13), 'must have a grade-point average for their entire academic program of at least 2.00'),
    rotcMax: { basicHours: 4, advancedHours: 6, quote: cite(U.rule(13), 'A degree program may include a maximum of four hours of basic ROTC and a maximum of six hours of advanced ROTC.') },
    additionalDegree: { extraHoursMin: 36, quote: cite(U.rule(13), 'earn credit for a total of at least 36 credit hours in excess of the requirement for any previous degrees earned.') },
    catalogYearChoice: cite(U.rule(13), 'may satisfy the requirements for a bachelor\'s degree by meeting all of the requirements associated with any one curriculum year that has been in effect during their period of enrollment in the Institute'),
    curriculumYear: cite(U.rule(2), 'Requirements for degrees and minors shall be specified for each Curriculum Year, which is comprised of a Summer Session plus the immediately following Fall Semester and Spring Semester.'),
    tenYearRule: cite(U.rule(13), 'Coursework that was completed more than ten years prior to the conferral of the degree must be reviewed by the student\'s major school'),
    url: U.rule(13),
  },

  residency: {
    minHoursAtGT: 45,
    finalHoursWindow: 45,
    maxTransferHoursInFinalWindow: 7,
    minOfFinalWindowAtGT: 38,
    quotes: [
      cite(U.rule(13), 'All students must complete a minimum of 45 hours required for their degree in residence at Georgia Tech.'),
      cite(U.rule(13), 'This means that 38 of the final 45 credit hours required for an undergraduate degree must be completed in residence at Georgia Tech.'),
    ],
    crossEnrollment: {
      countsAsResidence: true,
      eligibility: 'Degree-seeking juniors and seniors; at most two courses per term; grade of C or better; must also carry 3+ hours at GT.',
      quote: cite(U.rule(11), 'Credits earned under cross enrollment will be treated as transfer credit but will count as in-residence credit toward a degree.'),
    },
    concurrentRegistration: {
      countsAsResidence: false,
      summerOnlyWithoutPetition: true,
      quote: cite(U.rule(11), 'Credits earned under concurrent registration will be treated as transfer credit and will not count as in-residence credit toward a degree.'),
      finalWindow: cite(U.rule(11), 'Courses completed through concurrent registration will not be degree applicable if enrolled in the student\'s last 45-hours of degree completion.'),
    },
    honorsMinHoursAtGT: { hours: 60, quote: cite(U.rule(13), 'A student must have earned at least 60 semester credit hours (excluding remedial coursework) at Georgia Tech to graduate with highest honor, with high honor, or with honor.') },
    url: U.rule(13),
  },

  classStanding: {
    basis: 'Earned credit hours (attempted hours for which credit was successfully earned), classified at the end of each term. Rule VI.A does not say whether AP/IB/transfer hours count here; the change-of-major rule in the same regulation counts them explicitly, and planners conventionally count them.',
    quote: cite(U.rule(6), 'shall be classified at the end of each academic term by the Office of the Registrar on the basis of the total number of attempted credit hours for which they have successfully earned credit'),
    levels: [
      { name: 'Freshman', minHours: 0, maxHours: 29 },
      { name: 'Sophomore', minHours: 30, maxHours: 59 },
      { name: 'Junior', minHours: 60, maxHours: 89 },
      { name: 'Senior', minHours: 90, maxHours: null },
    ],
    enrollmentStatus: {
      fullTimeMinHours: 12,
      partTime: { min: 6, max: 11 },
      quote: cite(U.rule(6), 'Students scheduled for at least twelve (12) credit hours in a semester are classified as full-time students'),
    },
    url: U.rule(6),
  },

  termLoad: {
    maxHours: {
      fall: { good: 21, warning: 16, probation: 14 },
      spring: { good: 21, warning: 16, probation: 14 },
      summer: { good: 16, warning: 14, probation: 12 },
    },
    quotes: [
      cite(U.rule(6), 'The maximum number of credit hours for which an undergraduate student may register in a Fall Semester or Spring Semester, based on their academic standing, is as follows:'),
      cite(U.rule(6), 'The maximum number of credit hours for which an undergraduate student may register in a regular Summer Session, based on their academic standing, is as follows:'),
    ],
    tableCheck: null, // filled below from the page's own tables
    phase1RegistrationCap: { hours: 18, terms: ['Fall', 'Spring'], quote: cite(U.rule(6), 'During Phase 1 Registration, the Institute reserves the right to limit undergraduate students to 18 credits maximum for the Fall Semester and Spring Semester') },
    overload: {
      rule: 'Above the maximum needs a recommendation from the major school and approval by the Institute Undergraduate Curriculum Committee, in advance.',
      quotes: [
        cite(U.rule(6), 'Requests for schedule overloads must be recommended by the student\'s major school and approved by the Institute Undergraduate Curriculum Committee or Institute Graduate Curriculum Committee, as appropriate.'),
        cite(U.rule(9), 'Any hours above these limits must obtain prior approval from the Undergraduate Institute Curriculum Committee or the Graduate Institute Curriculum Committee, as appropriate.'),
      ],
    },
    auditCountsTowardLoad: cite(U.rule(9), 'Such a course counts at full value in computing the student\'s course load for an academic term.'),
    minimumLoad: 'Rule IX.B states a 3-hour minimum for graduate students only; none is stated for undergraduates. 12 hours is full-time.',
    url: U.rule(6),
  },

  calendar: {
    system: 'semester',
    terms: [
      { term: 'Fall', instructionWeeks: 15, examWeeks: 1 },
      { term: 'Spring', instructionWeeks: 15, examWeeks: 1 },
      { term: 'Summer', instructionWeeks: 11, examWeeks: 1, accelerated: true },
    ],
    quote: cite(U.rule(2), 'Georgia Tech\'s standard Academic Calendar consists of a Fall Semester, a Spring Semester, and an accelerated Summer Session.'),
    weeksQuote: cite(U.rule(2), 'A normal Summer Session includes approximately eleven weeks of instruction plus one week of final examinations.'),
    academicYearStartsWith: 'Summer',
    academicYearQuote: cite(U.calendars, 'At Georgia Tech, the academic year begins at the start of the Summer semester, continues through the Fall semester, and concludes at the end of the Spring semester.'),
    summerSessions,
    summerSessionsSource: `${U.liveCalendar} (session filter of the registrar's calendar; the dates behind it are not public to a crawler)`,
    tentativeFiveTerm: fiveTermCalendar(),
    tentativeFiveTermSource: U.fiveTerm,
    datedCalendarNotRead: 'The registrar\'s dated 2026-2027 and 2027-2028 calendars load from https://registrar.gatech.edu/calevents/proxy, which answered 403 {"error":"Origin not allowed"} to this crawler on 2026-11-09. Not worked around.',
    url: U.rule(2),
  },

  grades: {
    scale: { A: 4, B: 3, C: 2, D: 1, F: 0 },
    plusMinus: false,
    passingGrade: 'D',
    notInGpa: ['S', 'U', 'V', 'I', 'W', 'NR', 'IJ'],
    gpaTruncated: cite(U.rule(5), 'Grade-point averages are truncated after two decimal places.'),
    majorMinimums: 'Many majors require C or better in named courses (degree pages say so, e.g. Computer Science: all required CS courses with C or better). Not a university rule.',
    repeats: {
      noRepeatAfterBOrHigher: true,
      creditCountsOnce: true,
      allAttemptsInGpa: true,
      failingRepeatForfeitsEarlierCredit: true,
      quotes: [
        cite(U.rule(9), 'Students may not repeat courses in which the grade of \'B\' or higher has been earned previously.'),
        cite(U.rule(9), 'All grades and hours will count in determining the student\'s grade-point average (GPA), but the course will be counted only once for credit toward a degree.'),
        cite(U.rule(5), 'forfeits the original credit in the event the student should fail the course on a subsequent attempt.'),
      ],
    },
    gradeSubstitution: {
      maxCourses: 2,
      eligibleGrades: ['D', 'F'],
      oncePerCourse: true,
      notInFinalTerm: true,
      gtCoursesOnly: true,
      quotes: [
        cite(U.gradeSub, 'Undergraduate students may repeat for grade substitution up to two GT courses with posted letter grades of D or F.'),
        cite(U.gradeSub, 'A course can be taken for grade substitution only once and must be repeated prior to the final term of enrollment in which the student graduates.'),
      ],
      url: U.gradeSub,
    },
    withdrawal: {
      lastDayWithoutPenalty: '60% of the term (exact date on the registrar calendar)',
      quote: cite(U.rule(5), 'Withdrawals from individual courses without penalty are not permitted after 60 percent of the academic term has passed'),
    },
    transferMinGrade: { grade: 'C', passCountsAsC: true, notInGpa: true, quote: cite(U.transfer, 'The basic policy regarding the acceptance of courses by transfer is to allow credit for courses completed with satisfactory grades ("C" or better)'), url: U.transfer },
    url: U.rule(5),
  },

  passFail: {
    maxHoursTowardDegree: 9,
    onlyArea: 'Free Electives',
    notAllowedFor: ['Core IMPACTS', 'major requirements', 'minor requirements', 'certificate requirements', 'institutional requirements (e.g. Wellness)'],
    secondDegreeDoesNotAddMore: true,
    programsMayAllowFewer: 'Degree pages may set a lower cap (Computer Science: up to six hours of free electives pass/fail).',
    beyondCap: 'Earns institutional credit that does not count toward graduation.',
    gradeModeDeadline: 'Same day as the last day to withdraw without penalty.',
    quotes: [
      cite(U.rule(10), 'Courses taken to satisfy Core IMPACTS requirements, courses required for major, minor and certificate programs, courses that satisfy institutional requirements may not be taken as Pass/Fail.'),
      cite(U.rule(10), 'No more than nine credit hours of Pass/Fail coursework may be counted towards an undergraduate degree in the Free Electives area.'),
      cite(U.rule(10), 'The totality of the allotted pass/fail credit hours remains at a maximum of nine, even with the addition of a second undergraduate degree.'),
    ],
    url: U.rule(10),
  },

  creditByExam: {
    advancedStandingMaxHours: 9,
    quote: cite(U.rule(12), 'Students may not use more than nine credits of advanced standing to meet degree requirements.'),
    apIbMustPrecedeEnrollment: cite(U.transfer, 'Once enrolled at Georgia Tech, students are not allowed to take College Board (Advanced Placement and SAT II), International Baccalaureate or A-Level Examinations for credit.'),
    noClep: cite(U.transfer, 'Georgia Tech does not grant credit for the College Level General Educational Development Tests, CLEP'),
    url: U.rule(12),
  },

  changeOfMajor: {
    unrestrictedUntilHours: 60,
    quote: cite(U.rule(6), 'will be permitted one unrestricted transfer between majors until they have accumulated credit for sixty hours'),
    restrictedPrograms: ['Industrial and Systems Engineering', 'Mechanical Engineering', 'Music Technology'],
    restrictedQuote: cite(U.rule(6), 'Some programs have existing change-of-major conditions due to grade, GPA, or other requirements such as presentation of a portfolio that may limit change of major.'),
    newCatalog: cite(U.rule(6), 'Students who change their majors must complete the degree requirements in the Catalog that was effective for the term in which the change of major became official, or any subsequent Catalog.'),
    url: U.rule(6),
  },

  academicStanding: {
    minGpa: 2.0,
    quote: cite(U.rule(6), 'The minimum satisfactory grade-point average (GPA) is 2.00 for all undergraduate students'),
    levels: ['good', 'warning', 'probation', 'dismissal'],
    loadDependsOnStanding: true,
    url: U.rule(6),
  },

  foreignLanguage: {
    universityWide: false,
    finding: 'No university-wide foreign-language requirement. Rules I-XXII, the Core IMPACTS pages and the undergraduate academics pages state none, and Core IMPACTS has no language area.',
    whereLanguageIsRequired: [
      'Applied Languages and Intercultural Studies (ALIS) majors, by design.',
      'The International Plan designation available inside many majors ("This program has specific language requirements", e.g. Aerospace, Chemical and Biomolecular Engineering, Architecture, Chemistry and Biochemistry IP pages).',
      'Any other major that states it on its own degree page; check each degree page (the programs build owns this).',
    ],
    howLanguageCountsInCore: 'Language courses on the HUM list count toward Arts, Humanities & Ethics, but at most 3 hours from one introductory 1002/2001/2002 course (see that area\'s limits).',
    advancedStandingForLanguage: cite(U.rule(12), 'The only courses for which Advanced Standing credit may be given are 1001, 1002, 2001, and/or 2002 in the languages currently offered in the School of Modern Languages at Georgia Tech.'),
    evidenceSource: 'data/gatech-raw/programs/ (degree pages cached by the programs crawler) for the International Plan and ALIS wording.',
  },

  changesForFall2026And2027: {
    summary: 'Nothing on the current (2026-2027) pages is marked as new for Fall 2026. Students entering Summer 2026, Fall 2026 or Spring 2027 follow the 2026-2027 catalog (a curriculum year is Summer + Fall + Spring). The 2027-2028 catalog is not published yet, so Fall 2027 rules cannot be known; the registrar\'s tentative calendar already lists Summer 2027 through Fall 2028 term dates.',
    datedChangesOnThePages: [
      { effective: 'Summer 2024', change: 'Core IMPACTS replaced the old Core Areas A-F for incoming students (older catalog years keep the old core).', quote: core.appliesTo },
      { effective: 'May 1, 2023', change: 'Current implementation of the Georgia legislative requirements (history/constitution, including the non-credit Canvas exams).', quote: legislative.effective },
      { effective: '2019', change: 'Grade substitution rewritten; substitutions under the pre-2019 policy count toward the two-course limit.', quote: cite(U.gradeSub, 'Grades excluded under previous Institute rules (such as the Grade Substitution policy that was in effect up until 2019) count toward the maximum two courses allowed for substitution.') },
    ],
    cannotKnow: 'Earlier catalog editions are under /archived-catalogs/, which robots.txt disallows, so the 2025-2026 text cannot be diffed against 2026-2027 here.',
  },
};

// The load table: the page prints standing / max rows; check the numbers really are there.
{
  const t = textOf(U.rule(6));
  const fs = t.match(/Fall Semester or Spring Semester, based on their academic standing[\s\S]*?Good \| (\d+) credit hours \| Warning \| (\d+) credit hours \| Probation \| (\d+) credit hours/);
  const su = t.match(/regular Summer Session, based on their academic standing[\s\S]*?Good \| (\d+) credit hours \| Warning \| (\d+) ?credit hours \| Probation \| (\d+) credit hours/);
  const want = [rules.termLoad.maxHours.fall, rules.termLoad.maxHours.summer];
  [fs, su].forEach((m, i) => {
    const got = m ? m.slice(1, 4).map(Number) : null;
    const exp = [want[i].good, want[i].warning, want[i].probation];
    if (!got || got.join() !== exp.join()) quoteFailures.push({ url: U.rule(6), quote: `load table ${i ? 'summer' : 'fall/spring'} expected ${exp.join('/')} got ${got?.join('/') ?? 'nothing'}` });
  });
  rules.termLoad.tableCheck = 'Read from the two Schedule Load tables in Rule VI.E and matched to the numbers above at build time.';
  const cs = t.match(/Freshman \| 0-29 credit hours \| Sophomore \| 30-59 credit hours \| Junior \| 60-89 credit hours \| Senior \| 90\+ credit hours/);
  if (!cs) quoteFailures.push({ url: U.rule(6), quote: 'class standing table 0-29 / 30-59 / 60-89 / 90+' });
}

rules.coreCurriculum = { file: 'public/gatech-core.json', areas: areas.map((a) => ({ id: a.id, label: a.label, hours: a.hours })), fieldOfStudyHours: 18 };
rules.wellness = { hours: 2, courses: wellness.courses.map((c) => c.codes.join(' + ')), countsOutside120: true, quote: wellness.quote, medicalExemption: wellness.medicalExemption, url: U.wellness };
rules.ethics = { universityWide: false, attribute: 'ETHS', courseCount: ethics.courses.length, rule: ethics.rule, quotes: ethics.quotes, url: U.ethics };
rules.legislative = { ...legislative };

// ---------------------------------------------------------------------------
// Sanity checks, then write
// ---------------------------------------------------------------------------

const problems = [...quoteFailures.map((f) => `quote not on page ${f.url}: "${f.quote}"`)];
for (const a of areas) {
  const n = (a.courses?.length ?? 0) + (a.parts ?? []).reduce((s, p) => s + p.courses.length, 0);
  if (n === 0) problems.push(`${a.id}: no courses parsed`);
}
const expectCounts = { 'arts-humanities-ethics': [150, 250], 'social-sciences': [150, 260] };
for (const [id, [lo, hi]] of Object.entries(expectCounts)) {
  const n = areas.find((a) => a.id === id).courses.length;
  if (n < lo || n > hi) problems.push(`${id}: ${n} courses, expected ${lo}-${hi}`);
}
if (summerSessions.length !== 4) problems.push(`summer sessions: found ${summerSessions.length}, expected 4`);
if (!rules.calendar.tentativeFiveTerm?.length) problems.push('tentative five-term calendar not parsed');

if (problems.length) {
  console.error(`rules-build: ${problems.length} problem(s); nothing written.`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

writeFileSync(path.join(ROOT, 'public/gatech-core.json'), `${JSON.stringify(core, null, 2)}\n`);
writeFileSync(path.join(ROOT, 'public/gatech-rules.json'), `${JSON.stringify(rules, null, 2)}\n`);

const count = (a) => (a.courses?.length ?? 0) + (a.parts ?? []).reduce((s, p) => s + p.courses.length, 0);
console.log('public/gatech-core.json');
for (const a of areas) console.log(`  ${a.label.padEnd(36)} ${String(a.hours.min === a.hours.max ? a.hours.min : `${a.hours.min}-${a.hours.max}`).padStart(5)} h  ${count(a)} course rows`);
console.log(`  Field of Study                          18 h`);
console.log(`  wellness ${wellness.courses.length}, ethics ${ethics.courses.length}, legislative parts ${legislative.parts.length}, tagged courses ${Object.keys(sortedTags).length}`);
console.log(`public/gatech-rules.json: ${Object.keys(rules).length} sections, ${textCache.size} pages quoted, 0 quote mismatches`);
