/**
 * Learn@Illinois (Moodle) public course summaries:
 *
 *   https://learn.illinois.edu/course/info.php?id={id}
 *
 * The summary page is public; the course itself redirects to the campus
 * login and is never followed. The research pass ran the site's course
 * search for every term code from FA05 to FA26 (8,138 courses) and kept the
 * few summaries long enough to read like a syllabus (grading, required text,
 * exams): data/syllabi/ids/moodle_syllabus_like.json, rows of
 * [id, title, chars, cue words, catalog code or null]. The course and term
 * come from the title, "ANTH 259 1 FA20: Latina/o Anthropology (Rosas, G)".
 * robots.txt on learn.illinois.edu is a 404.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';
import { termMentions } from '../lib/terms.mjs';

export const id = 'moodle';
const LIST = join(DIRS.ids, 'moodle_syllabus_like.json');

export async function run({ get, log }) {
  const list = existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : [];
  const rows = [];
  for (const [courseId, title, , , code] of list) {
    const c = normalizeCode(code ?? String(title).split(/\s+/).slice(0, 2).join(' '));
    if (!c) continue;
    const url = `https://learn.illinois.edu/course/info.php?id=${courseId}`;
    const g = await get(url, { source: id });
    rows.push({
      source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
      contentType: g.contentType ?? null, disposition: null, hintCodes: [c], hintTerm: termMentions(title)[0]?.term ?? null,
      hintSection: String(title).split(/\s+/)[2] ?? null, kindHint: 'course-summary', foundVia: 'course search (research pass)', fetchedAt: g.fetchedAt ?? null,
    });
  }
  log(`${id}: ${rows.filter((r) => r.outcome === 'ok').length} of ${rows.length} summaries read`);
  return { rows, complete: true, note: 'the research pass\'s syllabus-like summaries' };
}
