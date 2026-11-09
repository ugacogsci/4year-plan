/**
 * Georgia Tech undergraduate degree requirements (and minors), as structured
 * data in the same schema as public/illinois-programs.json.
 *
 * SOURCES (public HTML, catalog.gatech.edu is CourseLeaf like catalog.illinois.edu):
 *   https://catalog.gatech.edu/programs/             every program, one link each
 *     (link text "BS" = a bachelor's degree page, "Minor" = a minor page)
 *   https://catalog.gatech.edu/colleges/<college>/   which college lists which program,
 *     and /colleges/<college>/<school>/ for the ones a college page leaves out
 *   https://catalog.gatech.edu/programs/<slug>/      each degree, thread, option,
 *     concentration and minor page (options are found on the degree page's
 *     Threads / Concentrations tab, never in its co-op or designator tab)
 *   https://catalog.gatech.edu/sitemap.xml           the school pages' addresses, and
 *     program pages the walk never reached (reported as `unreached`, not read)
 *
 * WRITES:
 *   public/gatech-programs.json         degrees, Illinois schema (+ a few extra fields, below)
 *   public/gatech/minors/crawl.json     minors, the schema of public/illinois/minors/crawl.json
 *   data/gatech-raw/programs/*.html     every page as fetched (cache; never re-fetched
 *                                       unless --refresh), plus fetch-log.json
 *
 * HOW TO RUN (from the worktree root):
 *   export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
 *   node scripts/gatech/programs.mjs              # crawl what is not cached, then parse
 *   node scripts/gatech/programs.mjs --offline    # parse the cache only, no request at all
 *   node scripts/gatech/programs.mjs --refresh    # re-fetch every page
 *   ... --out <file> --minors-out <file>          # write somewhere else (to compare before replacing)
 *   node scripts/gatech/programs.mjs --parse data/gatech-raw/programs/programs__theory-media-computer-science-bs.html
 *
 * HOW A PAGE IS READ. The requirement table is CourseLeaf's sc_courselist and
 *   is read by the Illinois parser itself (scripts/illinois/courselist.mjs,
 *   with 4-digit course numbers): or-rows, "&" pairs, plain-text codes,
 *   comment rows with their hours ("Select one of the following:" 3,
 *   "Any HUM" 6, "Free Electives" 17). Georgia Tech prints a whole degree as
 *   ONE table whose areaheader rows are its sections (Wellness Requirement,
 *   Core IMPACTS, Institutional Priority, ..., Field of Study, Major
 *   Requirements, Free Electives) and one "Total Credit Hours" row at the
 *   foot. Each section becomes one area here, its hours the sum of the hours
 *   the catalog prints on its rows (a "Select" row's hours, never its
 *   options' as well), so every area carries the catalog's own block size and
 *   the areas can be checked against the stated total.
 *
 * EXTRA FIELDS beyond the Illinois schema (ignored by the Illinois adapter):
 *   program.parent        id of the degree page this option/thread page belongs to
 *   program.options       on a degree page: its option/thread/concentration pages
 *   program.optionKind    'thread' | 'concentration' | 'option' ... (the page's own tab name)
 *   program.optionRule    on a degree page with options: the catalog's sentences on how they are chosen
 *   program.threads       on a thread-pair page: the two thread names
 *   program.threadList    on a threads degree page (CS, CM, CmpE, EE, LMC): each thread and its pair pages
 *   program.statedHours   the prose figure ("a total of 124 credit hours for graduation, plus a two-hour Wellness course")
 *   program.blockSum      the sum of the areas' hours, to compare with totalCredits
 *   program.blockSumMax   the same with each range at its high end, where a block prints a range
 *   area.hoursMax         the high end of a block printed as a range ("11-12")
 *   program.footnotes     the table's footnotes, by mark
 *   program.extraTables   other requirement tables on a degree page, kept apart from its areas
 *                         (Mathematics with Computing's three concentrations; a list "obtained
 *                         within the regular required curriculum"), each { heading, firstArea, totalCredits, areas }
 *   area.section          'Core IMPACTS' for its seven areas (Field of Study is not one of them)
 *   area.impacts          the IMPACTS letter (I, M, P, A, C, T, S)
 *   area.hoursFrom        'rows' (summed from the block's rows) or 'header' (printed on the header row)
 *   course.indented       an option row printed under a "Select ..." comment row
 *   comment.href          the link a comment row carries ("Any HUM" -> the Humanities list)
 *   comment.detail        the comment row's full words where it has more than one cell
 *   program.problems      rows this reader could not place, said in words (empty headings, count mismatches)
 *   file.aliases          a page linked under a second address with identical requirements,
 *                         dropped from programs: { id, url, sameAs }
 *   file.unreached        undergraduate program pages in the sitemap no degree page links
 *   minor.track, minorOf  a minor page printing one program of study per student group
 *                         ("Track for Aerospace Engineering Students", "Program of Study for
 *                         Business Majors") gives one record per track; minorOf is the page's id
 *   college 'unlisted'    no college or school page lists the program (some EAS degrees and
 *                         interdisciplinary minors); the catalog names no single owner
 *
 * WHAT IT CANNOT KNOW:
 *   - Which courses a "Lab Science", "Any HUM", "Any SS" or "Free Electives"
 *     row accepts: the degree page names the category and its hours only.
 *     The Core IMPACTS lists live on /academics/undergraduate/core-curriculum/
 *     (read by scripts/gatech/rules-crawl.mjs, not here).
 *   - Option text in footnotes ("Junior Design Options are as follows ...")
 *     is kept as text in program.footnotes; it is not turned into choices.
 *   - Older catalog years: robots.txt disallows /archived-catalogs/.
 *   - ROTC, co-op, International Plan and Research Option tabs are not read.
 *   - Undergraduate certificates (47 on /programs/) are not read.
 *   - A minor whose page prints its size only in a sentence this reader does
 *     not know keeps totalCredits null (scripts/illinois/minors.mjs minorTotal
 *     is tried first).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { courselistParser } from '../illinois/courselist.mjs';
import { withoutFootnoteMarks, minorTotal } from '../illinois/minors.mjs';
import { catalogGet, BlockedError, slugOf } from './catalog-get.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'https://catalog.gatech.edu';
const CACHE = join(ROOT, 'data/gatech-raw/programs');

// Four-digit numbers, and CHEM 1211K-style letter suffixes (AOS Technical Electives lists both K courses).
const { text, parseTables, hours: firstHours } = courselistParser({ digits: 4, letterSuffix: true });

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const OFFLINE = args.includes('--offline');
const REFRESH = args.includes('--refresh');

/** A page, from the cache or the catalog. Offline, an uncached page is null. */
async function page(path) {
  const url = BASE + path;
  if (OFFLINE) {
    const file = join(CACHE, slugOf(url));
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }
  return catalogGet(url, { cacheDir: CACHE, refresh: REFRESH });
}

/**
 * /programs/foo -> /programs/foo/ (the index links both ways). Spaces go too:
 * one index link is "/programs/minor-economics-policy-environmental-sustainability /",
 * and an Electrical Engineering thread is linked as ".../index.html".
 */
const normPath = (p) => p.replace(/\s+/g, '').replace(/[#?].*$/, '').replace(/\/index\.html?$/i, '/').replace(/\/?$/, '/');
const slugOfPath = (p) => normPath(p).split('/').filter(Boolean).pop();

/** The HTML of one tab (<div id="...textcontainer">) of a CourseLeaf page. */
function tabs(html) {
  // A tab ends where the next begins; the last ends at </main>, before the
  // footer, so no site-wide link is read as part of a tab.
  const main = html.indexOf('</main>');
  const stop = main > 0 ? main : html.length;
  const starts = [...html.matchAll(/<div id="([a-z]*textcontainer)"/g)].map((m) => ({ id: m[1], at: m.index }));
  return starts.map((s, i) => ({ id: s.id, html: html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : stop) }));
}

const pageTitle = (html) => text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s*\|\s*Georgia Tech Catalog\s*$/i, '').trim();

/** Tabs whose links are a degree's own options, never co-op, IP, research or BS/MS links. */
const NOT_OPTIONS_TAB = /^(designatorsandoptions|accreditation|courses|faculty|programs|overview)textcontainer$/;
const GRADUATE_SLUG = /(?:^|-)(?:ms|phd|mba|march|mcrp|mid|mspp|msp|pmase|pmml|pmosh|mred|msud)$|^mba-|graduate|^master|^masters|certificate|^minor-|-minor$/;

/** The option pages one degree page links from its own tabs, with the tab and the heading above each link. */
function optionLinks(html, selfSlug) {
  const out = [];
  for (const tab of tabs(html)) {
    if (NOT_OPTIONS_TAB.test(tab.id)) continue;
    let heading = null;
    for (const m of tab.html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>|<a\s[^>]*href="\s*(?:https?:\/\/catalog\.gatech\.edu)?(\/programs\/[^"#?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (m[1] != null) { heading = text(m[1]); continue; }
      const slug = slugOfPath(m[2]);
      if (!slug || slug === selfSlug || GRADUATE_SLUG.test(slug)) continue;
      // The intro tab is "textcontainer"; it is called 'text' here.
      out.push({ slug, path: normPath(m[2]), name: text(m[3]), tab: tab.id.replace(/textcontainer$/, '') || 'text', heading });
    }
  }
  return out;
}

/**
 * An option's own name: the link or page title without the degree's name in
 * front ("Bachelor of Science in Business Administration - Accounting" ->
 * "Accounting", "Bachelor of Science in Computer Science - Thread: Theory &
 * Media" -> "Theory & Media"). A link that is already short stays as it is.
 */
function optionNameOf(name, parentName) {
  let n = (name ?? '').replace(/\s*[\u2013\u2014]\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  const p = (parentName ?? '').trim();
  if (p && n.toLowerCase().startsWith(`${p.toLowerCase()} - `)) n = n.slice(p.length + 3);
  else if (/^Bachelor of\b/i.test(n)) n = n.replace(/^Bachelor of [^-]+?\s+-\s+/i, '');
  // "Analytics and Data Science," in an inline list loses its comma.
  return n.replace(/^Thread:\s*/i, '').replace(/[\s,;:]+$/, '').trim();
}

/**
 * The two thread names in a pair's name, learnt from all the pairs of one
 * degree. The joiner differs by degree and thread names contain the joiners:
 *   CS    "Modeling and Simulation & Cybersecurity and Privacy"
 *   CmpE  "Cybersecurity and Distributed System & Software Design"
 *   EE    "Signal & Information Processing - Telecommunications"
 *   LMC   "Literature & Science, Technology, and Culture"
 * Every way of cutting a name at " & ", " and " or " - " is a candidate, and
 * the cut whose two halves recur most across the degree's other pairs wins:
 * a real thread name appears in several pairs, a fragment in one.
 */
function threadSplitter(names) {
  // "Electrical Energy Systems" (2 EE pairs) and "Electric Energy Systems" (4) are one thread; every slug says electric-energy-systems.
  const norm = (t) => t.toLowerCase().replace(/[,]/g, '').replace(/\belectrical\b/g, 'electric').replace(/\s+/g, ' ').trim();
  const cuts = (name) => {
    const out = [];
    for (const m of name.matchAll(/\s+(?:&|and|-)\s+/g)) out.push([name.slice(0, m.index).trim(), name.slice(m.index + m[0].length).trim()]);
    return out.filter(([a, b]) => a && b);
  };
  const freq = new Map();
  const spellings = new Map();
  for (const n of names) {
    for (const half of new Set(cuts(n).flat().map(norm))) freq.set(half, (freq.get(half) ?? 0) + 1);
    for (const half of cuts(n).flat()) {
      const k = norm(half);
      const m = spellings.get(k) ?? spellings.set(k, new Map()).get(k);
      m.set(half, (m.get(half) ?? 0) + 1);
    }
  }
  // One spelling per thread: "Science, Technology and Culture" once and
  // "Science, Technology, and Culture" four times are the same thread.
  const display = (half) => [...(spellings.get(norm(half)) ?? new Map([[half, 1]]))].sort((x, y) => y[1] - x[1])[0][0];
  return (name) => {
    let best = null;
    let bestScore = 1;
    for (const [a, b] of cuts(name)) {
      const score = Math.min(freq.get(norm(a)) ?? 0, freq.get(norm(b)) ?? 0);
      if (score > bestScore) { best = [display(a), display(b)]; bestScore = score; }
    }
    return best;
  };
}

/** "threads" -> 'thread', "concentrations" -> 'concentration', "requirements" stays. */
const kindOfTab = (tab) => /thread/.test(tab) ? 'thread' : /concentration/.test(tab) ? 'concentration' : /track/.test(tab) ? 'track' : /option/.test(tab) ? 'option' : tab === 'text' ? 'option' : tab.replace(/s$/, '');

// ---------------------------------------------------------------------------
// Reading one requirement table
// ---------------------------------------------------------------------------

/** The table that holds the degree: the sc_courselist with a "Total Credit Hours" foot, else the largest one, outside designator/co-op tabs. */
function requirementTable(html, { plainOk = false } = {}) {
  const candidates = [];
  for (const tab of tabs(html)) {
    if (NOT_OPTIONS_TAB.test(tab.id)) continue;
    for (const m of tab.html.matchAll(/<table class="sc_courselist"[\s\S]*?<\/table>/g)) candidates.push({ tab: tab.id, html: m[0], at: m.index, tabHtml: tab.html });
  }
  if (!candidates.length) return null;
  // A requirement table ends in a total or is cut into sections. A plain list
  // with neither is something else: Civil Engineering's intro prints the
  // courses that need a C or better as a table, and read as the degree it
  // made the parent page a 22-hour program. A minor may have neither, so
  // `plainOk` lets a minor's plain table through when it is all there is.
  const total = (c) => /class="listsum"[\s\S]*?Total\b/i.test(c.html) || /courselistcomment areaheader[^>]*>\s*Total (?:Credit )?Hours/i.test(c.html);
  const sections = (c) => /class="[^"]*areaheader/.test(c.html);
  const withTotal = candidates.filter(total);
  const pick = withTotal.length ? withTotal : candidates.filter(sections).length ? candidates.filter(sections) : plainOk ? candidates : [];
  return pick.length ? { tables: pick, count: candidates.length } : null;
}

/** The last heading printed above a table in its tab ("Concentration Requirements"), or null. */
function headingBefore(tabHtml, at) {
  const before = tabHtml.slice(Math.max(0, at - 3000), at).replace(/<table[\s\S]*?<\/table>/g, '');
  const heads = [...before.matchAll(/<(h[1-6]|strong|p)[^>]*>([\s\S]{3,300}?)<\/\1>/gi)].map((m) => text(m[2])).filter((t) => t.length >= 3 && t.length <= 120);
  return heads.length ? heads[heads.length - 1] : null;
}

/** The footnotes printed under a requirement table: { '1': 'Minimum grade of C required.' }. */
function footnotesAfter(tabHtml, tableAt) {
  const rest = tabHtml.slice(tableAt);
  const dl = rest.match(/<\/table>\s*(?:<[^>]+>\s*)*?<dl class="sc_footnotes"[\s\S]*?<\/dl>/)?.[0] ?? '';
  const out = {};
  for (const m of dl.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) out[text(m[1])] = text(m[2]);
  return out;
}

/**
 * Every row of a table as the catalog prints it, in order: what kind of row,
 * its hours cell, whether it is indented under a "Select" row, its footnote
 * marks and the link a comment row carries. parseTables reads the same rows;
 * this is only the part of each row it does not keep.
 */
function rowFacts(tableHtml) {
  const rows = [];
  for (const m of tableHtml.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const cls = m[1];
    const row = m[2];
    if (/hidden noscript/.test(cls)) continue;
    const hoursCell = row.match(/<td[^>]*class="[^"]*hourscol[^>]*>([\s\S]*?)<\/td>/)?.[1];
    const marks = [...row.matchAll(/<sup>([\s\S]*?)<\/sup>/g)].flatMap((s) => text(s[1]).split(/\s*,\s*/)).filter(Boolean);
    const codeCell = row.match(/<td[^>]*class="[^"]*codecol[^>]*>([\s\S]*?)<\/td>/)?.[1];
    // A code cell holding only a comment ("INTA electives" | "INTA 1000-,
    // 2000-,3000-,4000-level courses" on International Affairs) is a comment
    // row; parseTables reads it as one too.
    const codeless = codeCell != null && !/[?&]P=/.test(codeCell) && !/\b[A-Z]{2,4} \d{4}[A-Z]?\b/.test(text(codeCell)) && /courselistcomment/.test(row);
    const kind = /listsum/.test(cls) ? 'total'
      : /areaheader/.test(cls) ? 'header'
      : /orclass/.test(cls) ? 'or'
      : codeCell != null && !codeless ? 'course'
      : /courselistcomment/.test(row) ? 'comment'
      : 'other';
    rows.push({
      kind,
      label: kind === 'header' ? text(row.match(/courselistcomment[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? row)
        : kind === 'comment' ? text(withoutFootnoteMarks(row.match(/courselistcomment[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ''))
        : kind === 'total' ? text(withoutFootnoteMarks(row.replace(/<td[^>]*class="[^"]*hourscol[\s\S]*$/, '')))
        : '',
      hoursText: hoursCell === undefined ? null : text(hoursCell) || null,
      hours: hoursCell === undefined ? null : firstHours(hoursCell),
      // The high end of a range ("Free Electives 11-12"); hours keeps the low end, as Illinois does.
      hoursMax: hoursCell === undefined ? null : (() => { const m = text(hoursCell).match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/); return m ? parseFloat(m[2]) : firstHours(hoursCell); })(),
      // Indented means the row's first cell OPENS with the indent. A "&" partner
      // is printed in an indented span inside an ordinary row ("EAS 4655 & EAS
      // 4656", "MATH 1551 & MATH 1553"), and reading that as an indented option
      // dropped the row from its block's hours.
      indented: /^\s*<(?:div|span)[^>]*class="[^"]*\b(?:blockindent|commentindent)\b/.test(row.match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '')
        || /courselistcomment[^"]*\bcommentindent\b/.test(row),
      marks,
      href: kind === 'comment' ? (row.match(/courselistcomment[^>]*>\s*<a\s[^>]*href="([^"]+)"/)?.[1] ?? null) : null,
      // The whole row's words, where a comment row says more than its first
      // span ("INTA electives" + "INTA 1000-,2000-,3000-,4000-level courses").
      detail: kind === 'comment' ? text(withoutFootnoteMarks(row.replace(/<td[^>]*class="[^"]*hourscol[\s\S]*$/, ''))) : null,
    });
  }
  return rows;
}

/** Core IMPACTS areas by the names every degree page prints for them. */
const IMPACTS = [
  // Lenient where the catalog misspells: "Institutional Priortiy", "Art, Humanities, and Ethics".
  ['I', /^Institutional Prior/i],
  ['M', /^Mathematics and Quantitative Skills\b/i],
  ['P', /^Political Science and U\.?\s?S\.? History\b/i],
  ['A', /^Arts?,? Humanities,? and Ethics\b/i],
  ['C', /^Communicating in Writing\b/i],
  ['T', /^Technology,? Mathematics,? and Scien/i], // "Scienecs" on Solid Earth and Planetary Sciences
  ['S', /^Social Sciences\b/i],
];
const impactsLetter = (label) => IMPACTS.find(([, re]) => re.test(label ?? ''))?.[0] ?? null;

/**
 * One degree table as Illinois-schema areas, one per section.
 *
 * parseTables reads the table as one area whose groups start at each
 * areaheader row, which on a Georgia Tech page is each section. Each group
 * becomes its own area, labelled with the section's heading and sized by the
 * hours its rows print. A heading with no rows under it ("Core IMPACTS") is
 * not an area; it names the section the areas after it belong to.
 */
function readTable(tableHtml, footnotes) {
  const clean = withoutFootnoteMarks(tableHtml);
  // A bare table with no heading in front, so parseTables names nothing from the page around it.
  const [area] = parseTables(clean);
  const facts = rowFacts(tableHtml);
  if (!area) return { areas: [], total: null, totalLabel: null, problems: ['no rows read'] };

  // The facts of each section, in order, split where parseTables splits.
  const sections = [];
  let cur = { header: null, rows: [] };
  for (const f of facts) {
    if (f.kind === 'header') { if (cur.header !== null || cur.rows.length) sections.push(cur); cur = { header: f, rows: [] }; continue; }
    if (f.kind === 'total') continue;
    cur.rows.push(f);
  }
  if (cur.header !== null || cur.rows.length) sections.push(cur);
  const totalRow = facts.filter((f) => f.kind === 'total').pop() ?? null;

  const problems = [];
  // parseTables makes a group for each areaheader and one for rows before the first.
  const groups = area.groups;
  if (groups.length !== sections.length) problems.push(`sections: parser ${groups.length}, rows ${sections.length}`);

  const areas = [];
  let headerTotal = null;
  const sectionHours = new Map();
  let section = null;
  groups.forEach((g, i) => {
    const s = sections[i] ?? { header: null, rows: [] };
    const label = (s.header?.label ?? g.label ?? '').trim();
    // "Total Credit Hours 122" printed as a section heading (Chemistry,
    // Polymers and Materials Option) is the table's total, not a block.
    if (/^total\b[^]*\bhours?\b/i.test(label) && !g.courses.length && !(g.comments ?? []).length) {
      if (s.header?.hours != null) headerTotal = { hours: s.header.hours, label };
      return;
    }
    const courseRows = s.rows.filter((r) => r.kind === 'course');
    const commentRows = s.rows.filter((r) => r.kind === 'comment');
    const empty = !courseRows.length && !commentRows.length && !g.courses.length;
    if (empty && /\bcore\b/i.test(label)) {
      // A heading over other headings: Core IMPACTS.
      section = label || null;
      if (s.header?.hours != null) sectionHours.set(label, s.header.hours);
      return;
    }
    // Any other heading with no rows is still a block: "Free Electives 21"
    // (Atmospheric and Oceanic Sciences) carries its hours on the heading, and
    // one Electrical Engineering page prints "Political Science and U.S.
    // History" with nothing under it (its HIST 2111 row sits one heading up).
    if (empty && s.header?.hours == null) problems.push(`${label}: heading with no rows and no hours`);
    if (section && !impactsLetter(label) && /impacts/i.test(section)) section = null;

    // The course rows parseTables kept are the non-"or" course rows, in order.
    if (courseRows.length === g.courses.length) {
      g.courses.forEach((c, k) => { if (courseRows[k].indented) c.indented = true; });
    } else {
      problems.push(`${label}: ${g.courses.length} courses read, ${courseRows.length} course rows`);
    }
    for (const c of g.comments ?? []) {
      const row = commentRows.find((r) => r.label === c.text);
      if (row?.href) c.href = row.href;
      if (row?.detail && row.detail !== c.text) c.detail = row.detail;
    }

    // The block's hours: each row's printed hours, except a "Select" row's
    // options, which its own hours already count.
    let sum = 0;
    let sumMax = 0;
    let underSelect = false;
    for (const r of s.rows) {
      if (r.kind === 'comment') {
        // An indented comment is one more option of the list above it ("Research Option").
        if (r.indented && underSelect) continue;
        underSelect = r.hours != null;
        sum += r.hours ?? 0;
        sumMax += r.hoursMax ?? 0;
        continue;
      }
      if (r.kind !== 'course') continue;
      if (!r.indented) underSelect = false;
      if (r.indented && underSelect) continue;
      sum += r.hours ?? 0;
      sumMax += r.hoursMax ?? 0;
    }
    const headerHours = s.header?.hours ?? null;
    const hours = headerHours ?? sum;
    const hoursMax = headerHours != null ? (s.header.hoursMax ?? headerHours) : sumMax;
    if (headerHours != null && sum && headerHours !== sum) problems.push(`${label}: header says ${headerHours}, rows add to ${sum}`);

    const marks = [...new Set([s.header, ...s.rows].flatMap((r) => r?.marks ?? []))];
    const notes = marks.map((m) => footnotes[m]).filter(Boolean);
    const letter = impactsLetter(label);
    const out = {
      label: label || null,
      labelKnown: label !== '',
      hours,
      ...(hoursMax > hours ? { hoursMax } : {}),
      hoursFrom: headerHours != null ? 'header' : 'rows',
      chooseCourses: null,
      groups: [{
        ...g,
        // The heading is the area's label now, as an Illinois heading above a table is.
        label: '',
        ...(notes.length ? { footnotes: notes } : {}),
      }],
      ...(letter ? { section: section ?? 'Core IMPACTS', impacts: letter } : section && !/impacts/i.test(section) ? { section } : {}),
    };
    // Illinois's kind, with the block's own size as the cap (parseTables had only the degree total).
    for (const grp of out.groups) {
      const cap = grp.hours ?? out.hours;
      grp.kind = grp.choose ? 'choose' : !cap ? 'unknown' : grp.summedCredits > cap + 0.5 ? 'menu' : 'all';
    }
    areas.push(out);
  });

  return {
    areas,
    total: totalRow?.hours ?? headerTotal?.hours ?? null,
    totalLabel: totalRow?.label ?? headerTotal?.label ?? null,
    problems,
    sectionHours: Object.fromEntries(sectionHours),
  };
}

/**
 * The sentence a degree page uses to say how its options are chosen: "Each
 * student selects two Threads to fulfill the requirements ...", "Choose any
 * two threads ...", "Concentrations are optional for the students ...".
 * Kept as the catalog's words; the planner decides what to do with them.
 */
function optionRuleOf(html) {
  const sentences = tabs(html)
    .filter((t) => !NOT_OPTIONS_TAB.test(t.id))
    .flatMap((t) => text(t.html).split(/(?<=[.!?])\s+/));
  const hits = sentences.filter((x) => /\b(?:select\w*|choos\w*|pick\w*|weav\w*|optional|required to (?:select|choose|complete))\b[^.]{0,80}\b(?:threads?|concentrations?|options?|tracks?)\b|\b(?:threads?|concentrations?|options?|tracks?)\b[^.]{0,60}\b(?:are optional|is optional|are required|is required)\b/i.test(x));
  return hits.length ? [...new Set(hits)].slice(0, 3).map((x) => x.trim().slice(0, 400)) : null;
}

/** "a total of 124 credit hours for graduation, plus a two-hour Wellness course" and the like. */
function statedHours(html) {
  // The intro prose only, never a table in it ("Select 7 credit hours").
  const intro = text((tabs(html).find((t) => t.id === 'textcontainer')?.html ?? '').replace(/<table[\s\S]*?<\/table>/g, ' '));
  const m = [...intro.matchAll(/(?:a total of|minimum of|requires?|consists of)\s+(\d{2,3})\s+(?:semester\s+|credit\s+)*hours?[^.]{0,120}/gi)]
    .find((x) => +x[1] >= 100 && +x[1] <= 200);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return { hours: n, plusWellness: /plus\s+(?:a\s+)?(?:two|2)[- ]hour wellness|(?:exclusive of|excluding|not including|plus)\s+(?:the\s+)?wellness/i.test(m[0]), text: m[0].trim() };
}

// ---------------------------------------------------------------------------
// --parse <file>: one saved page, printed
// ---------------------------------------------------------------------------

if (args[0] === '--parse') {
  const html = readFileSync(args[1], 'utf8');
  const found = requirementTable(html);
  if (!found) { console.log('no requirement table'); process.exit(0); }
  for (const t of found.tables) {
    const r = readTable(t.html, footnotesAfter(t.tabHtml, t.at));
    for (const a of r.areas) {
      console.log(`\n## ${a.label}  ${a.hours}h${a.impacts ? `  [IMPACTS ${a.impacts}]` : ''}`);
      for (const g of a.groups) {
        for (const c of g.courses) console.log(`   ${c.indented ? '  ' : ''}${c.code.padEnd(10)} ${String(c.credits ?? '').padStart(3)}  ${c.title.slice(0, 50)}${c.or ? `  (or ${c.or.join(', ')})` : ''}${c.and ? `  & ${JSON.stringify(c.and)}` : ''}`);
        for (const c of g.comments ?? []) console.log(`   # ${c.text} ${c.hoursText ?? ''} (at ${c.at})${c.href ? ` -> ${c.href}` : ''}`);
      }
    }
    const sum = r.areas.reduce((n, a) => n + a.hours, 0);
    console.log(`\n${r.totalLabel}: ${r.total}; blocks add to ${sum}${r.problems.length ? `\nproblems: ${r.problems.join('; ')}` : ''}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The crawl
// ---------------------------------------------------------------------------

const log = console.log;

/** The college of a program no college or school page lists (interdisciplinary minors, mostly). */
const UNLISTED = 'unlisted';

/** The blocks add up to the stated total: exactly, or within a range a block prints ("Free Electives 11-12"). */
const adds = (p) => p.totalCredits != null && p.totalCredits >= p.blockSum && p.totalCredits <= (p.blockSumMax ?? p.blockSum);
try {
  const index = await page('/programs/');
  if (!index) throw new Error('the /programs/ index could not be read');

  // Every program link and the word it is printed as.
  const linked = new Map();
  for (const m of index.matchAll(/<a\s[^>]*href="\s*(?:https?:\/\/catalog\.gatech\.edu)?(\/programs\/[^"#?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const word = text(m[2]).replace(/,$/, '');
    const path = normPath(m[1]);
    if (path === '/programs/') continue;
    (linked.get(path) ?? linked.set(path, new Set()).get(path)).add(word);
  }
  const BACHELOR = /^B[A-Z][A-Za-z.]{0,6}$/; // BS, BA, BArch, BSBA ...
  const degreePaths = [...linked].filter(([, w]) => [...w].some((x) => BACHELOR.test(x))).map(([p]) => p).sort();
  const minorPaths = [...linked].filter(([, w]) => w.has('Minor')).map(([p]) => p).sort();
  const certificates = [...linked].filter(([, w]) => w.has('Undergraduate Certificate')).length;
  log(`${degreePaths.length} bachelor's degree pages, ${minorPaths.length} minors (${certificates} undergraduate certificates not read)`);

  // College of each program, from the colleges' own pages.
  const collegeOf = new Map();
  const collegePaths = [...new Set([...index.matchAll(/href="(\/colleges\/[a-z-]+\/)"/g)].map((m) => m[1]))].filter((p) => !/lifetime-learning/.test(p));
  for (const cp of collegePaths) {
    const html = await page(cp);
    if (!html) { log(`  ! ${cp} not read`); continue; }
    const college = cp.split('/')[2];
    // Only the page's own tabs: the side navigation is the same on every page.
    const body = tabs(html).map((t) => t.html).join('\n');
    for (const m of body.matchAll(/href="\s*(?:https?:\/\/catalog\.gatech\.edu)?(\/programs\/[^"#?]+)/g)) {
      const slug = slugOfPath(m[1]);
      if (!collegeOf.has(slug)) collegeOf.set(slug, college);
    }
  }

  // A program its college's page does not list (Astrophysics, Atmospheric and
  // Oceanic Sciences, Chemical and Biomolecular Engineering) is listed on its
  // school's page under the college, so those are read until none is left.
  const sitemap = await page('/sitemap.xml');
  const unresolved = () => [...degreePaths, ...minorPaths].map(slugOfPath).filter((s) => !collegeOf.has(s));
  if (unresolved().length && sitemap) {
    const schoolPaths = [...new Set([...sitemap.matchAll(/<loc>https:\/\/catalog\.gatech\.edu(\/colleges\/[a-z-]+\/[a-z-]+\/)<\/loc>/g)].map((m) => m[1]))]
      .filter((p) => !/lifetime-learning|\/grad\/$/.test(p));
    const schoolNames = new Map();
    for (const sp of schoolPaths) {
      const html = await page(sp);
      if (!html) continue;
      const college = sp.split('/')[2];
      const title = pageTitle(html);
      if (/^School of\b/i.test(title)) schoolNames.set(title, college);
      const body = tabs(html).map((t) => t.html).join('\n');
      for (const m of body.matchAll(/href="\s*(?:https?:\/\/catalog\.gatech\.edu)?(\/programs\/[^"#?]+)/g)) {
        const slug = slugOfPath(m[1]);
        if (!collegeOf.has(slug)) collegeOf.set(slug, college);
      }
    }
    // Still unlisted: the school the page's own intro names ("The School of
    // Earth and Atmospheric Sciences offers ..."), if it names exactly one.
    for (const slug of unresolved()) {
      const html = await page(`/programs/${slug}/`);
      const intro = text(tabs(html ?? '').find((t) => t.id === 'textcontainer')?.html ?? '');
      const named = new Set([...schoolNames].filter(([title]) => intro.includes(title)).map(([, c]) => c));
      if (named.size === 1) collegeOf.set(slug, [...named][0]);
    }
    if (unresolved().length) log(`  no college or school lists these; their id starts "${UNLISTED}/": ${unresolved().join(', ')}`);
  }

  // Degree pages, then the option pages each links (and theirs, one level more).
  const programs = [];
  const reached = new Set();
  const reachedAs = new Map();
  const failed = [];
  const tableless = [];

  async function readProgram(path, { parent = null, college, optionKind = null, optionName = null, depth = 0, degreeWord = null }) {
    const slug = slugOfPath(path);
    if (reached.has(slug)) return null;
    reached.add(slug);
    const html = await page(path);
    if (!html) { failed.push({ path, why: 'not read' }); log(`  ! ${path} not read`); return null; }
    const name = pageTitle(html) || optionName || slug;
    // Links in the page's intro are followed only from a degree page that has
    // no options tab and no requirement table of its own (a menu page); an
    // intro elsewhere links other degrees in prose ("see also the BS in ...").
    const allLinks = depth < 2 ? optionLinks(html, slug) : [];
    const tabLinks = allLinks.filter((l) => l.tab !== 'text');
    const links = tabLinks.length ? tabLinks : depth === 0 && !requirementTable(html) ? allLinks : [];
    const found = requirementTable(html);
    const footnotes = {};
    let areas = [];
    let total = null;
    let totalLabel = null;
    const problems = [];
    // One table is the degree (its total is degree-sized). Any other table on
    // the page is a list the degree points into: Mathematics with Computing
    // prints its three 27-hour concentrations as their own tables after the
    // degree, and International Affairs and Modern Language a 15-hour list
    // that "can be obtained within the regular required curriculum". Adding
    // those to the degree's areas counted them twice (sums of 203 and 137
    // against 122), so they are kept beside it as extraTables.
    const read = (found?.tables ?? []).map((t) => {
      const fn = footnotesAfter(t.tabHtml, t.at);
      Object.assign(footnotes, fn);
      return { ...readTable(t.html, fn), heading: headingBefore(t.tabHtml, t.at) };
    });
    const degreeSized = read.filter((r) => r.total != null && r.total >= 100);
    const main = degreeSized.length === 1 ? degreeSized : read;
    const extraTables = degreeSized.length === 1 ? read.filter((r) => r !== degreeSized[0]) : [];
    for (const r of main) {
      areas = areas.concat(r.areas);
      if (r.total != null) { total = r.total; totalLabel = r.totalLabel; }
      problems.push(...r.problems);
    }
    if (main.length > 1) problems.push(`${main.length} requirement tables read as one degree`);
    if (!found) tableless.push(slug);
    const blockSum = areas.reduce((n, a) => n + (a.hours ?? 0), 0);
    const blockSumMax = areas.reduce((n, a) => n + (a.hoursMax ?? a.hours ?? 0), 0);
    const courses = new Set(areas.flatMap((a) => a.groups.flatMap((g) => g.courses.map((c) => c.code))));
    const id = parent ? `${parent.id}/${slug}` : `${college}/${slug}`;
    const rec = {
      id,
      college,
      name,
      // Every Georgia Tech bachelor's is a Bachelor of Science; the index link word is the fallback.
      degree: /^Bachelor of Science\b/i.test(name) ? 'BS' : /^Bachelor of Arts\b/i.test(name) ? 'BA' : degreeWord ?? 'BS',
      concentration: parent ? (optionName || optionNameOf(name, parent.name)) : null,
      url: BASE + path,
      areas,
      totalCredits: total != null && total >= 100 && total <= 200 ? total : null,
      courseCount: courses.size,
      // Extra fields (see the header).
      parent: parent?.id ?? null,
      ...(optionKind ? { optionKind } : {}),
      // An option page has no intro of its own; it is the same degree as its parent.
      statedHours: statedHours(html) ?? (parent?.statedHours ? { ...parent.statedHours, fromParent: true } : null),
      totalLabel,
      blockSum,
      ...(blockSumMax > blockSum ? { blockSumMax } : {}),
      ...(Object.keys(footnotes).length ? { footnotes } : {}),
      ...(extraTables.length ? { extraTables: extraTables.map((r) => ({ heading: r.heading, firstArea: r.areas[0]?.label ?? null, totalCredits: r.total, areas: r.areas })) } : {}),
      ...(problems.length ? { problems } : {}),
    };
    programs.push(rec);
    reachedAs.set(slug, id);
    log(`${String(programs.length).padStart(3)} ${String(courses.size).padStart(3)} courses ${String(areas.length).padStart(2)} areas  total ${String(rec.totalCredits ?? '-').padStart(3)} sum ${String(blockSum).padStart(3)}${rec.totalCredits != null && !adds(rec) ? ' !!' : '   '} ${'  '.repeat(depth)}${name.slice(0, 80)}`);

    // Option pages, read once each. A thread-pair page is linked twice, once
    // under each of its two threads, so every heading a page sits under is kept.
    const bySlug = new Map();
    for (const l of links) {
      const seen = bySlug.get(l.slug);
      if (seen) { if (l.heading && !seen.headings.includes(l.heading)) seen.headings.push(l.heading); continue; }
      bySlug.set(l.slug, { ...l, headings: l.heading ? [l.heading] : [] });
    }
    if (bySlug.size) {
      rec.options = [];
      for (const l of bySlug.values()) {
        const child = await readProgram(l.path, { parent: rec, college, optionKind: kindOfTab(l.tab), optionName: optionNameOf(l.name, rec.name), depth: depth + 1, degreeWord: rec.degree });
        if (child) rec.options.push({ id: child.id, name: child.concentration, kind: child.optionKind, ...(l.headings.length ? { headings: l.headings } : {}) });
        else if (reachedAs.has(l.slug)) rec.options.push({ id: reachedAs.get(l.slug), name: optionNameOf(l.name, rec.name), kind: kindOfTab(l.tab), ...(l.headings.length ? { headings: l.headings } : {}), alsoListedUnder: reachedAs.get(l.slug).split('/').slice(0, -1).join('/') });
      }
      if (!rec.options.length) delete rec.options;
      else { const rule = optionRuleOf(html); if (rule) rec.optionRule = rule; }
    }
    return rec;
  }

  for (const path of degreePaths) {
    const slug = slugOfPath(path);
    await readProgram(path, { college: collegeOf.get(slug) ?? UNLISTED, degreeWord: [...linked.get(path)].find((w) => BACHELOR.test(w)) });
  }

  // Thread pairs. The degree page lists each thread under its own heading
  // with the pair pages that include it, so a pair page sits under exactly two
  // headings, and those two are its threads. Where a page sits under one
  // heading only, its link text ("Theory & Media") names the pair.
  for (const p of programs) {
    const pairs = (p.options ?? []).filter((o) => o.kind === 'thread');
    if (!pairs.length) continue;
    const byThread = new Map();
    for (const o of pairs) for (const h of o.headings ?? []) (byThread.get(h) ?? byThread.set(h, []).get(h)).push(o.id);
    p.threadList = [...byThread].map(([name, ids]) => ({ name, pages: ids }));
    const split = threadSplitter(pairs.map((o) => o.name ?? ''));
    for (const o of pairs) {
      const child = programs.find((c) => c.id === o.id);
      if (!child) continue;
      child.threads = o.headings?.length === 2 ? o.headings : split(o.name ?? '');
      if (!child.threads) delete child.threads;
    }
    // A degree page that lists its pairs without a heading per thread
    // (Computer Engineering, Electrical Engineering, LMC): the threads are
    // the names the pairs are made of.
    if (!p.threadList.length) {
      const byName = new Map();
      for (const o of pairs) for (const t of programs.find((c) => c.id === o.id)?.threads ?? []) (byName.get(t) ?? byName.set(t, []).get(t)).push(o.id);
      p.threadList = [...byName].map(([name, ids]) => ({ name, pages: ids }));
    }
  }

  // A page linked under two addresses with the same name and the same
  // requirements is one program. Computer Science's Modeling and Simulation &
  // Embedded Devices is linked as .../modeling-simulation-embedded-devices-...
  // and .../modeling-simulation-devices-... (not in the sitemap); both pages
  // are identical, and listing both would offer the same degree twice.
  const aliases = [];
  const firstBy = new Map();
  for (const p of [...programs]) {
    if (!p.areas.length) continue;
    const key = `${p.name}\n${JSON.stringify(p.areas)}`;
    const first = firstBy.get(key);
    if (!first) { firstBy.set(key, p); continue; }
    aliases.push({ id: p.id, url: p.url, sameAs: first.id });
    programs.splice(programs.indexOf(p), 1);
    // Whatever pointed at the second address points at the first.
    for (const q of programs) {
      if (q.options) q.options = q.options.filter((o) => o.id !== p.id || !q.options.some((x) => x.id === first.id));
      for (const o of q.options ?? []) if (o.id === p.id) o.id = first.id;
      for (const t of q.threadList ?? []) t.pages = [...new Set(t.pages.map((id) => (id === p.id ? first.id : id)))];
    }
  }
  const unreached = sitemap
    ? [...new Set([...sitemap.matchAll(/<loc>https:\/\/catalog\.gatech\.edu(\/programs\/[^<]+)<\/loc>/g)].map((m) => normPath(m[1])))]
      .map(slugOfPath).filter((s) => s && !reached.has(s) && !GRADUATE_SLUG.test(s) && !minorPaths.some((p) => slugOfPath(p) === s))
    : null;

  // Minors. A minor page is usually one table. Some print one program of
  // study per student group ("Program of Study - Track for Aerospace
  // Engineering Students", Energy Systems; "Track for College of Engineering
  // Students", Engineering and Business): each track is its own minor record
  // here, as a degree's option is its own program, because adding the tracks
  // up gave Energy Systems 207 hours against its stated 15.
  // A heading's own text, between tags: ">Program of Study - Track for Aerospace
  // Engineering Students<", ">Program of Study - Business Track (for Business
  // Administration majors)<" (Leadership Studies), or a bare ">Track for ...<".
  const TRACK = />\s*(?:Program of Study\s*(?:-|\u2013|&#8211;|&ndash;)\s*([^<]{3,120}?)|(Track for [^<]{3,90}?))\s*</gi;
  const minors = [];
  const skippedMinors = [];
  for (const path of minorPaths) {
    const html = await page(path);
    if (!html) { skippedMinors.push({ path, why: 'not read' }); continue; }
    const found = requirementTable(html, { plainOk: true });
    if (!found) { skippedMinors.push({ path, why: 'no requirement table' }); continue; }
    const slug = slugOfPath(path);
    const college = collegeOf.get(slug) ?? UNLISTED;
    const baseId = `${college}/minors/${slug.replace(/^minor-|-minor$/g, '')}`;
    const name = pageTitle(html).replace(/^Minor in\s+/i, '');

    // Tables in order, each with the track heading above it (if any).
    const footnotes = {};
    const tracks = [];
    for (const t of found.tables) {
      const fn = footnotesAfter(t.tabHtml, t.at);
      Object.assign(footnotes, fn);
      const hit = [...t.tabHtml.slice(0, t.at).replace(/<table[\s\S]*?<\/table>/g, ' ').matchAll(TRACK)].pop();
      const track = hit ? text(hit[1] ?? hit[2]) : null;
      const last = tracks[tracks.length - 1];
      const r = { ...readTable(t.html, fn), heading: headingBefore(t.tabHtml, t.at) };
      if (last && last.track === track) last.tables.push(r);
      else tracks.push({ track, tables: [r] });
    }
    let split = tracks.length > 1 && tracks.every((t) => t.track);
    let groups = split ? tracks : [{ track: null, tables: tracks.flatMap((x) => x.tables) }];
    // Several tables that each end in their own total, with no track heading,
    // are alternatives too: International Business, Language, and Culture
    // prints "Business Majors Requirements" 15 and "Non-Business Majors
    // Requirements" 15, and FinTech and AI/ML do the same. Their totals are
    // not added (that read as 30 and 60 hours); each is its own record, named
    // by the heading above its table.
    if (!split && groups[0].tables.length > 1 && groups[0].tables.every((r) => r.total != null)) {
      const named = groups[0].tables.map((r, i) => ({ track: r.heading && !/^(?:course list|requirements?)$/i.test(r.heading) ? r.heading : `Option ${i + 1}`, tables: [r] }));
      // Two tables under one heading are one alternative printed in two parts.
      const merged = [];
      for (const g of named) { const prev = merged[merged.length - 1]; if (prev && prev.track === g.track) prev.tables.push(...g.tables); else merged.push(g); }
      if (merged.length > 1) { groups = merged; split = true; }
    }

    for (const t of groups) {
      const areas = t.tables.flatMap((r) => r.areas);
      // The minor's size: the one total printed, or (several tables, each
      // with its own) their sum, which is what the tables then mean.
      const totals = t.tables.map((r) => r.total).filter((n) => n != null);
      let total = totals.length === 1 ? totals[0] : totals.length > 1 ? totals.reduce((a, b) => a + b, 0) : null;
      let totalFrom = total == null ? null : totals.length > 1 ? 'table-totals' : 'total-row';
      // No total row: the Illinois reader of a minor's stated size ("The
      // minor requires 15 hours", a "Total Hours" line, or every row sized).
      // Only for a page that is one minor; on a page of tracks it would read
      // another track's figure.
      if (total == null && !split) {
        const stated = minorTotal(html, text, areas);
        if (stated.hours != null) { total = stated.hours; totalFrom = stated.from; }
      }
      const courses = new Set(areas.flatMap((a) => a.groups.flatMap((g) => g.courses.map((c) => c.code))));
      const blockSum = areas.reduce((n, a) => n + (a.hours ?? 0), 0);
      const blockSumMax = areas.reduce((n, a) => n + (a.hoursMax ?? a.hours ?? 0), 0);
      const problems = t.tables.flatMap((r) => r.problems);
      const trackSlug = t.track ? t.track.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null;
      minors.push({
        id: trackSlug ? `${baseId}/${trackSlug}` : baseId,
        college,
        name: t.track ? `${name} (${t.track})` : name,
        listedAs: [pageTitle(html)],
        url: BASE + path,
        totalCredits: total,
        totalFrom,
        areas,
        courseCount: courses.size,
        // Extra fields, as on the degrees.
        ...(t.track ? { track: t.track, minorOf: baseId } : {}),
        blockSum,
        ...(blockSumMax > blockSum ? { blockSumMax } : {}),
        ...(Object.keys(footnotes).length ? { footnotes } : {}),
        ...(problems.length ? { problems } : {}),
      });
      const m = minors[minors.length - 1];
      log(`minor ${String(minors.length).padStart(3)} ${String(courses.size).padStart(3)} courses total ${String(total ?? '-').padStart(2)} sum ${String(blockSum).padStart(2)}${total != null && !adds(m) ? ' !!' : '   '} ${m.name.slice(0, 90)}`);
    }
  }

  // When the catalog was read: the cached index's time, so a re-parse of the
  // cache does not claim the pages were fetched just now.
  const indexFile = join(CACHE, slugOf(`${BASE}/programs/`));
  const fetchedAt = (existsSync(indexFile) ? statSync(indexFile).mtime : new Date()).toISOString();
  const outFile = resolve(ROOT, flag('--out') ?? 'public/gatech-programs.json');
  const minorsFile = resolve(ROOT, flag('--minors-out') ?? 'public/gatech/minors/crawl.json');
  mkdirSync(dirname(outFile), { recursive: true });
  mkdirSync(dirname(minorsFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({
    school: 'gatech', source: `${BASE}/programs/`, fetchedAt, programs,
    ...(unreached?.length ? { unreached } : {}),
    ...(aliases.length ? { aliases } : {}),
    ...(failed.length ? { failed } : {}),
  }));
  writeFileSync(minorsFile, JSON.stringify({
    school: 'gatech', source: `${BASE}/programs/`, fetchedAt, minors, skipped: skippedMinors,
  }));

  // The report.
  const withTable = programs.filter((p) => p.areas.length);
  const balanced = withTable.filter(adds);
  log(`\n${programs.length} degree pages read (${degreePaths.length} degrees, ${programs.length - degreePaths.length} option/thread pages)`);
  log(`  ${withTable.length} with a requirement table, ${tableless.length} without (option menus): ${tableless.join(', ')}`);
  log(`  ${balanced.length} whose blocks add up to the stated total; ${withTable.length - balanced.length} do not`);
  log(`  ${programs.filter((p) => p.problems).length} with row-reading problems`);
  if (unreached?.length) log(`  ${unreached.length} sitemap program pages no degree page links: ${unreached.join(', ')}`);
  if (failed.length) log(`  ${failed.length} not read: ${failed.map((f) => f.path).join(', ')}`);
  log(`${minors.length} minors (${skippedMinors.length} left out: ${skippedMinors.map((s) => `${s.path} ${s.why}`).join(', ')})`);
} catch (e) {
  if (e instanceof BlockedError) { console.error(`BLOCKED: ${e.message}`); process.exit(2); }
  throw e;
}
