/**
 * Illinois undergraduate minors, as structured data.
 *
 * Run it through the degree crawler, which owns the table parser:
 *
 *   node scripts/illinois/programs.mjs --minors
 *
 * A full degree crawl (programs.mjs with no --only) runs this too when it
 * finishes, so the minors are refreshed every time the degrees are. A source
 * kept outside the refresh step goes stale or gets dropped without anyone
 * noticing (memory: crawl traps).
 *
 * Why it is its own crawl and its own file. programs.mjs reads the links on
 * /undergraduate/, which names only one minor URL: the A to Z list at
 * /undergraduate/minors/. Each minor is a CourseLeaf page with the same
 * sc_courselist tables as a degree page, so the same parser reads it, but a
 * minor fed into illinois-programs.json would come out as program "minors"
 * with concentration "spanish" and no degree. Minors get their own ids and
 * their own file, public/illinois/minors/crawl.json, and nothing here writes
 * illinois-programs.json.
 *
 * Traps on the A to Z page, each found by reading it:
 *   - one link carries a leading space (href=" /undergraduate/las/minors/
 *     south-asian-studies-interdisciplinary/"), so a pattern that wants the
 *     slash first skips it without a word;
 *   - Social Work's minor is /undergraduate/minors/socw/, one path segment
 *     shorter than every other minor, so "the segment before minors" is not
 *     always a college;
 *   - Technology & Management sits under the college code eng_bus, with an
 *     underscore that [a-z0-9-] does not match;
 *   - one minor is listed twice under two names (Political & Civic
 *     Leadership); a list page (/undergraduate/minors/engineering/) or a PDF
 *     can sit beside the minors, so a page with no requirement table is
 *     reported and left out rather than kept as an empty minor.
 *
 * What is stored, and what is not. Each minor keeps its page link, its name
 * as the page titles it, the total hours the page states (12 to 30, the range
 * a campus minor can have), and its requirement tables as the parser reads
 * them: course codes, credit cells and the tables' own short row labels,
 * exactly as the degree crawl stores them, because the reader needs those
 * labels to know "choose one" from "take all". No paragraph of a page is
 * stored. Footnote markers (<sup>) are removed before parsing, so a course
 * title reads "Discrete Structures" and not "Discrete Structures 2".
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The A to Z list of every undergraduate minor. */
export const MINORS_INDEX_PATH = '/undergraduate/minors/';

/** A campus minor is 16 to 21 hours (LAS: 18 to 24); 12 to 30 leaves room for an odd page and nothing else. */
export const MINOR_TOTAL_MIN = 12;
export const MINOR_TOTAL_MAX = 30;

/**
 * Every minor link on the A to Z page, once each.
 *
 * Accepts /undergraduate/{college}/minors/{slug}/ and the one-segment-short
 * /undergraduate/minors/{slug}/ (Social Work), with the college code allowed
 * an underscore (eng_bus) and the href allowed leading or trailing spaces.
 */
export function minorLinks(indexHtml) {
  const byPath = new Map();
  for (const m of indexHtml.matchAll(/<a\s[^>]*href="\s*([^"]*?)\s*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const path = m[1];
    const hit = path.match(/^\/undergraduate\/(?:([a-z0-9_-]+)\/)?minors\/([a-z0-9_-]+)\/$/i);
    if (!hit) continue;
    const listedAs = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const seen = byPath.get(path);
    if (seen) {
      if (listedAs && !seen.listedAs.includes(listedAs)) seen.listedAs.push(listedAs);
      continue;
    }
    byPath.set(path, { path, college: (hit[1] ?? hit[2]).toLowerCase(), slug: hit[2].toLowerCase(), listedAs: listedAs ? [listedAs] : [] });
  }
  return [...byPath.values()];
}

/** The minor's id: its catalog path without /undergraduate/, "las/minors/spanish" or "minors/socw". */
export const minorIdOf = (path) => path.replace(/^\/undergraduate\//, '').replace(/\/$/, '');

/**
 * No email address or phone number is kept. The parser takes the last
 * paragraph before a table as its heading, and on Business for Non-Business
 * Majors that paragraph is a contact sentence with the office's address. A
 * heading that was only a contact line is left empty.
 */
const CONTACT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\(?\b\d{3}\)?[ .-]\d{3}-\d{4}\b/g;
const scrub = (s) => {
  if (typeof s !== 'string') return s;
  const t = s.replace(CONTACT, ' ');
  return t === s ? s : t.replace(/\s+/g, ' ').trim();
};
export function withoutContacts(areas) {
  return areas.map((area) => ({
    ...area,
    label: /@/.test(area.label ?? '') ? '' : scrub(area.label),
    groups: area.groups.map((group) => ({
      ...group,
      label: scrub(group.label),
      note: scrub(group.note),
      ...(group.comments ? { comments: group.comments.map((c) => ({ ...c, text: scrub(c.text) })) } : {}),
      courses: group.courses.map((c) => ({ ...c, title: scrub(c.title) })),
    })),
  }));
}

/** Footnote markers out of a page, so they never stick to a title or an hours cell. */
export const withoutFootnoteMarks = (html) => html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '');

/**
 * The total hours the page states for the minor, and where it was read.
 *
 * Pages say it several ways, and the first that gives a number from 12 to 30
 * wins, since anything else is a subtotal, a level rule or a degree figure:
 *
 *   'total-row'  a row or line that says it is the total. First a line that
 *                says it is the minimum for the whole minor ("Total Minimum
 *                Hours 19", "Minimum total hours 18", "Minimum hours
 *                required for completion: 21"), then a plain "Total Hours 18".
 *                A page can print several (Business Analytics: required 15,
 *                elective 3, total 18), so the largest counts; the subtotals
 *                are labelled "Total Required Hours" and the like and never
 *                match.
 *   'sentence'   "for a total of 18 credit hours", "The minor requires 18
 *                hours", "complete 18 hours of approved ... courses".
 *   'table-cells' no total anywhere, but every requirement row of every table
 *                carries its own hours (Business for Non-Business Majors:
 *                core 12, electives 6), so the minor is their sum.
 *
 * A range ("18-21") counts at its low end, the way programs.mjs reads a
 * "3-4" credit cell.
 */
export function minorTotal(html, text, areas = null) {
  const flat = text(withoutFootnoteMarks(html));
  const ok = (n) => Number.isFinite(n) && n >= MINOR_TOTAL_MIN && n <= MINOR_TOTAL_MAX;
  const all = (re) => [...flat.matchAll(re)].map((m) => parseInt(m[1], 10)).filter(ok);
  // Lines that say they are the minimum for the whole minor. Kinesiology prints
  // "Minimum hours required for completion: 21 hours" above two tables whose
  // own foot rows read "Total Hours 12" and "Total Hours 9", so these win over
  // a plain "Total Hours".
  const stated = all(
    /\b(?:Minimum (?:Total )?(?:Credit |Semester )?Hours(?: Required)?(?: (?:for|to complete) (?:the )?(?:minor|completion))?|Total (?:Minimum )?(?:Credit |Semester )?Hours(?: Required)? (?:for|in) (?:the )?minor|Total Minimum (?:Credit )?Hours(?: Required)?(?: for [A-Za-z ,&]{3,80}? to Complete the Minor)?|Total Hours (?:\(Minimum(?: Required)?\)|Minimum of))\s*:?\s*(\d{1,2})\b/gi,
  );
  if (stated.length) return { hours: Math.max(...stated), from: 'total-row' };
  const rows = all(/\bTotal (?:Credit |Semester )?Hours(?: Required)?\s*:?\s*(\d{1,2})\b/gi);
  // A table's own foot row labelled just "Total" (Theatre: "Total 16").
  for (const m of withoutFootnoteMarks(html).matchAll(/<tr[^>]*class="[^"]*listsum[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const t = text(m[1]).match(/^Total\s+(\d{1,2})\b/i);
    if (t && ok(parseInt(t[1], 10))) rows.push(parseInt(t[1], 10));
  }
  if (rows.length) return { hours: Math.max(...rows), from: 'total-row' };
  const sentences = [
    /\bfor a (?:minimum |grand )?total of (\d{2})(?:\s*-\s*\d{2})? (?:semester |credit )*hours\b/i,
    /\bminor (?:requires|consists of|comprises|is) (?:a (?:minimum|total) of |at least |a minimum of )?(\d{2})(?:\s*-\s*\d{2})? (?:total |semester |credit )*hours\b/i,
    /\brequires? (?:the successful completion of |students to complete )?(?:a (?:minimum|total) of |at least )?(\d{2})(?:\s*-\s*\d{2})? (?:total |semester |credit )*hours\b/i,
    /\b(?:must|to) complete (?:a (?:minimum|total) of |at least )?(\d{2}) (?:total |semester |credit )*hours\b/i,
    // Only "for the minor": "completed at least 30 credit hours prior to the
    // application" is a condition for applying, not the minor's size.
    /\b(?:at least|a minimum of|minimum of) (\d{2}) (?:total |semester |credit )*hours (?:for|in|toward) (?:the|this) minor\b/i,
    /\b(\d{2}) (?:total |semester |credit )*hours (?:are )?required\b/i,
  ];
  for (const re of sentences) {
    const n = parseInt(flat.match(re)?.[1] ?? '', 10);
    if (ok(n)) return { hours: n, from: 'sentence' };
  }
  // Every requirement row sized by its own hours cell, and nothing else.
  const groups = (areas ?? []).flatMap((a) => a.groups ?? []);
  if (groups.length >= 2 && groups.every((g) => g.hours != null && g.hours > 0 && !/^(?:minimum\s+)?total\b/i.test(g.label ?? ''))) {
    const sum = groups.reduce((n, g) => n + g.hours, 0);
    if (ok(sum)) return { hours: sum, from: 'table-cells' };
  }
  return { hours: null, from: null };
}

/** The page's own name for the minor, from <title>, without the catalog's ", UG" suffix. */
export function minorName(html, text, fallback) {
  const titleTag = text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').split('|')[0].trim();
  return (titleTag || fallback || '').replace(/,\s*UG$/i, '').trim();
}

/**
 * Crawl every minor. The parser and the fetcher come from programs.mjs, so a
 * minor page is read by exactly the code that reads a degree page.
 *
 *   out:      the folder to write crawl.json into
 *   saveHtml: also keep each page under this folder (for reading offline)
 *   fromHtml: read pages saved by saveHtml instead of fetching
 */
export async function crawlMinors({ get, sleep, parseTables, text, BASE, DELAY, out, saveHtml = null, fromHtml = null, log = console.log }) {
  const fileFor = (path) => `${minorIdOf(path).replace(/\//g, '__')}.html`;
  const fetchPage = async (path) => {
    if (fromHtml) {
      try { return readFileSync(join(fromHtml, path === MINORS_INDEX_PATH ? '_index.html' : fileFor(path)), 'utf8'); } catch { return null; }
    }
    const html = await get(BASE + path);
    await sleep(DELAY);
    if (html && saveHtml) {
      mkdirSync(saveHtml, { recursive: true });
      writeFileSync(join(saveHtml, path === MINORS_INDEX_PATH ? '_index.html' : fileFor(path)), html);
    }
    return html;
  };

  const index = await fetchPage(MINORS_INDEX_PATH);
  if (!index) throw new Error('the A to Z list of minors could not be read');
  const links = minorLinks(index);
  log(`${links.length} minor links on ${MINORS_INDEX_PATH}`);

  const minors = [];
  const skipped = [];
  for (const [i, link] of links.entries()) {
    const html = await fetchPage(link.path);
    if (!html) { skipped.push({ path: link.path, why: 'not read' }); log(`  ! ${link.path} not read`); continue; }
    if (!/<table class="sc_courselist"/.test(html)) { skipped.push({ path: link.path, why: 'no requirement table' }); log(`  - ${link.path}: no requirement table, left out`); continue; }
    const areas = withoutContacts(parseTables(withoutFootnoteMarks(html)));
    const total = minorTotal(html, text, areas);
    const courses = new Set(areas.flatMap((a) => a.groups.flatMap((g) => g.courses.map((c) => c.code))));
    minors.push({
      id: minorIdOf(link.path),
      college: link.college,
      name: minorName(html, text, link.listedAs[0]),
      listedAs: link.listedAs,
      url: BASE + link.path,
      totalCredits: total.hours,
      totalFrom: total.from,
      areas,
      courseCount: courses.size,
    });
    log(`${String(i + 1).padStart(3)}/${links.length} ${String(courses.size).padStart(3)} courses  total ${String(total.hours ?? '?').padStart(2)} (${total.from ?? 'none'})  ${minors[minors.length - 1].name.slice(0, 60)}`);
  }

  const noTotal = minors.filter((m) => m.totalCredits == null);
  log(`\n${minors.length} minors, ${minors.filter((m) => m.courseCount).length} with course lists, ${minors.length - noTotal.length} with a stated total`);
  if (noTotal.length) log(`  no total read: ${noTotal.map((m) => m.id).join(', ')}`);
  if (skipped.length) log(`  left out: ${skipped.map((s) => `${s.path} (${s.why})`).join(', ')}`);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'crawl.json'), JSON.stringify({
    school: 'illinois',
    source: BASE + MINORS_INDEX_PATH,
    // Pages read back from a folder carry the time they were fetched, not now.
    fetchedAt: (fromHtml ? statSync(join(fromHtml, '_index.html')).mtime : new Date()).toISOString(),
    minors,
    skipped,
  }));
  log(`wrote ${join(out, 'crawl.json')}`);
  return { minors, skipped };
}
