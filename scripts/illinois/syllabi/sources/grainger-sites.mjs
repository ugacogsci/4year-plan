/**
 * Grainger course websites, the Physics template, and the instructor sites
 * the course index points to.
 *
 * Start pages: the research pass's walk of every Fall 2026 course website
 * (data/syllabi/ids/grainger-sites_fa2026.jsonl, 750 courses), keeping the
 * 188 that are a real site on courses.grainger.illinois.edu or an outside
 * host; the generated fallback profile, a Canvas redirect or a 404 is no
 * site at all. Each start page is read and up to MAX_LINKS of its own links
 * whose address or label says syllabus, grading, policies, course info or
 * logistics are fetched, one level deep (cs225's pages/course_info.html,
 * cs421's policy.html, cs424's syllabus.html).
 *
 * Physics sites share one template, so the template's pages are asked by
 * name for every undergraduate PHYS course in the Fall 2026 index:
 *   https://courses.physics.illinois.edu/phys{NNN}/fa2026/{course-grading|syllabus|exam-information|required-materials}.html
 * A page the course does not have is a 404, cached as definitive.
 *
 * Never followed: Canvas, Box, Campuswire, PrairieLearn, Piazza, Gradescope,
 * Ed, Notion and Coursera links (logins or JavaScript shells), the college's
 * own navigation (grainger.illinois.edu), and /secure/ or /private/ paths,
 * which robots.txt on the course hosts disallows (lib/http.mjs checks that
 * on every hop anyway).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';
import { decodeEntities } from '../lib/text.mjs';

export const id = 'grainger-sites';
const SITES = join(DIRS.ids, 'grainger-sites_fa2026.jsonl');
const INDEX = join(DIRS.ids, 'grainger_index_fa2026_rows.json');
const MAX_LINKS = 4;
const WANT = /syll?ab|grading|grades?\b|polic|course[\s_-]*(info|information|logistics|overview)|logistics|requirements/i;
const NEVER = /canvas\.illinois\.edu|instructure\.com|box\.com|campuswire|prairielearn|piazza|gradescope|edstem|notion\.(so|site)|coursera\.org|youtube\.com|forms\.gle|docs\.google\.com\/forms|mailto:|\/secure\/|\/private\/|(^|\/\/)(www\.)?grainger\.illinois\.edu\//i;
const PHYS_PAGES = ['course-grading.html', 'syllabus.html', 'exam-information.html', 'required-materials.html'];

/** A page's own links that read like a syllabus or policy page, absolute, deduplicated. */
function syllabusLinks(html, base) {
  const out = [];
  const seen = new Set([base.replace(/#.*$/, '')]);
  for (const m of String(html).matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    let href;
    try { href = new URL(decodeEntities(m[1]), base); } catch { continue; }
    if (!/^https?:$/.test(href.protocol)) continue;
    href.hash = '';
    const url = href.href;
    if (seen.has(url) || NEVER.test(url)) continue;
    if (!WANT.test(`${href.pathname} ${label}`)) continue;
    // Stay on the course's own host: an outside link from a course page is a university policy page or a vendor.
    if (href.host !== new URL(base).host) continue;
    seen.add(url);
    out.push({ url, label });
  }
  return out.slice(0, MAX_LINKS);
}

function startPages() {
  if (!existsSync(SITES)) throw new Error(`no site list at ${SITES}`);
  const rows = readFileSync(SITES, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return rows
    .filter((r) => (r.kind === 'site' || r.kind === 'external') && r.final && !NEVER.test(r.final))
    .map((r) => ({ code: normalizeCode(r.code), term: r.term ?? null, url: r.final }))
    .filter((r) => r.code);
}

function physicsCourses() {
  if (!existsSync(INDEX)) return [];
  const rows = JSON.parse(readFileSync(INDEX, 'utf8'));
  const codes = new Set();
  for (const r of rows) {
    const code = normalizeCode(String(r.code ?? '').split(/\s+/).slice(0, 2).join(' '));
    if (code?.startsWith('PHYS ')) codes.add(code);
  }
  return [...codes].sort();
}

export async function run({ get, log }) {
  const rows = [];
  const push = (code, term, url, g, kindHint, foundVia) => rows.push({
    source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
    contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: [code], hintTerm: term,
    hintSection: null, kindHint, foundVia, fetchedAt: g.fetchedAt ?? null,
  });
  const sites = startPages();
  const done = new Set();
  for (const [i, s] of sites.entries()) {
    if (done.has(`${s.code} ${s.url}`)) continue;
    done.add(`${s.code} ${s.url}`);
    const g = await get(s.url, { source: id, maxAgeDays: 14 });
    push(s.code, s.term, s.url, g, 'site', 'https://courses.grainger.illinois.edu/');
    if ((i + 1) % 25 === 0) log(`${id}: ${i + 1}/${sites.length} sites, ${rows.filter((r) => r.outcome === 'ok').length} pages read`);
    if (g.outcome !== 'ok' || !g.bodyPath || !/html/i.test(g.contentType ?? 'html')) continue;
    for (const link of syllabusLinks(readFileSync(g.bodyPath, 'utf8'), g.finalUrl ?? s.url)) {
      if (done.has(`${s.code} ${link.url}`)) continue;
      done.add(`${s.code} ${link.url}`);
      const p = await get(link.url, { source: id, maxAgeDays: 14 });
      push(s.code, s.term, link.url, p, 'syllabus', s.url);
    }
  }
  const phys = physicsCourses();
  for (const code of phys) {
    const base = `https://courses.physics.illinois.edu/${code.replace(' ', '').toLowerCase()}/fa2026/`;
    for (const page of PHYS_PAGES) {
      const g = await get(base + page, { source: id, maxAgeDays: 14 });
      if (g.outcome === 'not-found') continue;
      push(code, 'fa2026', base + page, g, 'syllabus', 'Physics course template');
    }
  }
  const ok = rows.filter((r) => r.outcome === 'ok').length;
  log(`${id}: done, ${sites.length} sites and ${phys.length} Physics courses, ${ok} of ${rows.length} pages read`);
  return { rows, complete: true, note: `${sites.length} Fall 2026 course sites, ${phys.length} Physics template courses` };
}
