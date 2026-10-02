/**
 * The syllabus links on Grainger's course-website index,
 * https://courses.grainger.illinois.edu/: one table, a row per course or
 * section, with a Syllabus column.
 *
 * Of 319 Fall 2026 rows with a link, 161 point into the getsyllabus store
 * (its own source) and 71 into Canvas (refused by policy). The rest point to
 * course sites and department pages (cs357.cs.illinois.edu/pages/syllabus.html,
 * discovery.cs.illinois.edu/syllabus/), the Physics template, Google Docs and
 * a few instructor hosts. Those are fetched here, every hop checked by
 * lib/http.mjs; a Google Doc is read through its plain-text export, which
 * docs.google.com's robots.txt allows. Join links for PrairieLearn and
 * Campuswire lead to a login, and are recorded as such without being followed.
 *
 * The rows come from the research pass's parse of the Fall 2026 index
 * (data/syllabi/ids/grainger_index_fa2026_rows.json, 2026-09-27). The index
 * is one page; re-parsing it each term is the next step for this source.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';

export const id = 'grainger-index';
const ROWS = join(DIRS.ids ?? join(DIRS.state, '..', 'ids'), 'grainger_index_fa2026_rows.json');
const SKIP = /ws\.engr\.illinois\.edu\/custom\/getsyllabus|canvas\.illinois\.edu|campuswire\.com|prairielearn\.com|instructure\.com/;

/** A Google Doc's edit link -> its plain-text export. */
function exportUrl(url) {
  const m = url.match(/^https:\/\/docs\.google\.com\/document\/d\/([\w-]+)/);
  return m ? `https://docs.google.com/document/d/${m[1]}/export?format=txt` : url;
}

export async function run({ get, log }) {
  if (!existsSync(ROWS)) throw new Error(`no index rows at ${ROWS}`);
  const rows = JSON.parse(readFileSync(ROWS, 'utf8'));
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row.syllabus || SKIP.test(row.syllabus)) continue;
    const code = normalizeCode(String(row.code ?? '').split(/\s+/).slice(0, 2).join(' '));
    if (!code) continue;
    const url = exportUrl(row.syllabus);
    if (seen.has(`${code} ${url}`)) continue;
    seen.add(`${code} ${url}`);
    const g = await get(url, { source: id });
    out.push({
      source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
      contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: [code], hintTerm: 'fa2026',
      hintSection: String(row.code ?? '').split(/\s+/)[2] ?? null, kindHint: 'syllabus', foundVia: 'https://courses.grainger.illinois.edu/', fetchedAt: g.fetchedAt ?? null,
    });
  }
  log(`${id}: ${out.filter((r) => r.outcome === 'ok').length} of ${out.length} syllabus links fetched`);
  return { rows: out, complete: true, note: 'Fall 2026 index rows from the research pass' };
}
