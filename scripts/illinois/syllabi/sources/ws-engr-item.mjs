/**
 * Grainger WebTools course profiles, the page every engineering department
 * site embeds for a course:
 *
 *   https://ws.engr.illinois.edu/courses/item.asp?course={SUBJ}{NUM}
 *
 * The answer is a run of document.write('...') calls carrying HTML: the
 * term's sections, then the profile, one <h2> heading per field. Most
 * profiles stop at the official description and the course director; about
 * 220 also carry the department's master syllabus (Topics or Topic List,
 * Texts, Instructional Objectives, Course or Learning Goals, Detailed
 * Description and Outline). Those are the documents kept here. They give the
 * topics, the texts and the objectives a department sets for every section,
 * not one instructor's grading.
 *
 * Every catalog code in the Grainger subjects (plus ABE, TE and CHBE, which
 * WebTools also serves) is asked once; a code with no profile answers with an
 * empty write. Same host as getsyllabus and getfile, so run it apart from them.
 * robots.txt on ws.engr is a 404, so the host's only rule is the house pace.
 */
import { readFileSync } from 'node:fs';
import { loadCatalog } from '../lib/catalog.mjs';

export const id = 'ws-engr-item';
const BASE = 'https://ws.engr.illinois.edu/courses/item.asp?course=';
const SUBJECTS = new Set('AE ABE BIOE CEE CHBE CS CSE DTX ECE ENG ES IE ME MSE NE NPRE PHYS SE TAM TE'.split(' '));
/** Profile headings that are a master syllabus, not the catalog entry. */
const MASTER = /topic|text|objective|goal|outline|detailed|outcome|syllab|grading|assessment|lab(oratory)? (projects|experiments)/i;

export async function run({ get, log }) {
  const codes = [...loadCatalog().codes].filter((c) => SUBJECTS.has(c.split(' ')[0])).sort();
  const rows = [];
  let profiles = 0;
  for (const [i, code] of codes.entries()) {
    const url = BASE + code.replace(' ', '');
    // A profile changes when the department edits it; a month-old copy is asked again (conditional GET).
    const g = await get(url, { source: id, maxAgeDays: 30 });
    if ((i + 1) % 100 === 0) log(`${id}: ${i + 1}/${codes.length} codes, ${profiles} profiles, ${rows.length} with a master syllabus`);
    if (g.outcome !== 'ok' || !g.bodyPath) continue;
    const body = readFileSync(g.bodyPath, 'utf8');
    if (!/extCoursesProfile/.test(body)) continue;
    profiles += 1;
    const headings = [...body.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1].trim());
    if (!headings.some((h) => MASTER.test(h))) continue;
    rows.push({
      source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
      contentType: g.contentType ?? null, disposition: null, hintCodes: [code], hintTerm: null,
      hintSection: null, kindHint: 'master-syllabus', foundVia: 'catalog code', fetchedAt: g.fetchedAt ?? null,
    });
  }
  log(`${id}: done, ${codes.length} codes asked, ${profiles} profiles, ${rows.length} with a master syllabus`);
  return { rows, complete: true, note: `${codes.length} catalog codes in the WebTools subjects` };
}
