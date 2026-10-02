/**
 * Grainger's public syllabus store, the largest single source: instructors
 * upload a syllabus per section per term, and every file opens anonymously.
 *
 *   https://ws.engr.illinois.edu/custom/getsyllabus.asp?id={N}
 *
 * The store has no index. Each id answers a HEAD with the file's
 * Content-Disposition name, "{SUBJ}{NUM}[_{SECTION}]_{YYYY}_{Fall|Spring|Summer}.ext"
 * (parseStoreName), or a 24-byte "File not found." with no name. On
 * 2026-09-27 the files sat at ids 725-823 and 1,823-4,036, so the walk covers
 * those ranges with headroom above the top; a missing id costs one HEAD.
 *
 * Only undergraduate catalog codes are downloaded: the planner's catalog is
 * 000-499, and a graduate syllabus (CS 598) answers nothing a student here
 * asks. Of 1,221 files, about 700 are undergraduate.
 *
 * robots.txt on ws.engr is a 404, so the host's only rule is the house pace.
 */
import { normalizeCode } from '../lib/catalog.mjs';
import { parseStoreName } from '../lib/keys.mjs';

export const id = 'ws-engr-getsyllabus';
const BASE = 'https://ws.engr.illinois.edu/custom/getsyllabus.asp?id=';
const RANGES = [[700, 900], [1800, Number(process.env.GETSYLLABUS_MAX ?? 4440)]];

const filenameOf = (disposition) => String(disposition ?? '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? null;

export async function run({ get, head, log }) {
  const rows = [];
  let probed = 0;
  let named = 0;
  for (const [from, to] of RANGES) {
    for (let n = from; n <= to; n += 1) {
      const url = BASE + n;
      // A missing id is a 24-byte "File not found." or IIS's 500 error page.
      const h = await head(url, { source: id, missingStatuses: [500] });
      probed += 1;
      if (probed % 250 === 0) log(`${id}: ${probed} ids probed, ${named} files named, ${rows.length} undergraduate fetched`);
      const name = filenameOf(h.disposition);
      if (!name) continue;
      named += 1;
      const key = parseStoreName(name);
      const code = key ? normalizeCode(key.codes[0]) : null;
      if (!code) continue;
      const g = await get(url, { source: id });
      rows.push({
        source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
        contentType: g.contentType ?? null, disposition: g.disposition ?? h.disposition, hintCodes: [code], hintTerm: key.term,
        hintSection: key.section, kindHint: 'syllabus', foundVia: 'id walk', fetchedAt: g.fetchedAt ?? null,
      });
    }
  }
  log(`${id}: done, ${probed} ids probed, ${named} files named, ${rows.length} undergraduate documents`);
  return { rows, complete: true, note: `ids ${RANGES.map(([a, b]) => `${a}-${b}`).join(', ')}` };
}
