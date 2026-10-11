/**
 * Grainger WebTools' documents store, the files linked from course profiles:
 *
 *   https://ws.engr.illinois.edu/courses/getfile.asp?id={N}
 *
 * Live ids ran 51-1,040 on 2026-09-27 and nothing answered above. Filenames
 * are free-form ("MSE 201 Syllabus Fall 2024.pdf", "IE300_course_policy.docx",
 * "TE 250 schedule.pdf"), so a file is downloaded only when its name carries
 * an undergraduate catalog code and reads like a syllabus or course policy,
 * not a schedule, slide deck or assignment. 267 files, 196 of them named as
 * syllabi, for about 86 courses (MSE 39, SE 19, IE 15, TE 13).
 *
 * Same host as getsyllabus, so run it after that walk, not beside it.
 */
import { normalizeCode } from '../lib/catalog.mjs';
import { termMentions } from '../lib/terms.mjs';

export const id = 'ws-engr-getfile';
const BASE = 'https://ws.engr.illinois.edu/courses/getfile.asp?id=';
const MAX = 1300;
const SUBJECTS = 'AE|ABE|BIOE|CEE|CHBE|CS|CSE|DTX|ECE|ENG|ES|IE|ME|MSE|NE|NPRE|PHYS|SE|TAM|TE';
const CODE = new RegExp(`(?<![A-Za-z])(${SUBJECTS})[\\s_.-]*(\\d{3})(?!\\d)`, 'gi');
const SYLLABUS = /syllab|polic|course[\s_-]*info|outline|information/i;
const NOT = /\b(schedule|slides?|lecture|hw|homework|exam|quiz|solution|lab\s*\d|project\s*\d)\b/i;

const filenameOf = (disposition) => String(disposition ?? '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? null;

export async function run({ get, head, log }) {
  const rows = [];
  let named = 0;
  for (let n = 1; n <= MAX; n += 1) {
    const url = BASE + n;
    const h = await head(url, { source: id, missingStatuses: [500] });
    if (n % 250 === 0) log(`${id}: ${n}/${MAX} ids, ${named} files, ${rows.length} course documents`);
    const name = filenameOf(h.disposition);
    if (!name) continue;
    named += 1;
    const codes = [...new Set([...name.matchAll(CODE)].map((m) => normalizeCode(`${m[1]} ${m[2]}`)).filter(Boolean))];
    if (codes.length === 0 || !SYLLABUS.test(name) || NOT.test(name)) continue;
    const g = await get(url, { source: id });
    rows.push({
      source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
      contentType: g.contentType ?? null, disposition: g.disposition ?? h.disposition, hintCodes: codes,
      hintTerm: termMentions(name)[0]?.term ?? null, hintSection: null, kindHint: 'syllabus', foundVia: 'id walk', fetchedAt: g.fetchedAt ?? null,
    });
  }
  log(`${id}: done, ${named} files named, ${rows.length} course documents`);
  return { rows, complete: true, note: `ids 1-${MAX}` };
}
