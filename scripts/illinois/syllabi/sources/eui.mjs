/**
 * The Ethnography of the University Initiative's course documents, the only
 * public source of RHET 105 syllabi (2004 - Spring 2011):
 *
 *   http://www.eui.illinois.edu/courses/{past|current}/        two index pages
 *   http://www.eui.illinois.edu/courses/{past|current}/documents/{file}
 *
 * File names carry the course and term in one of two shapes,
 * "{SUBJ}{NUM}[{SECTION}]{F|S}{YY}.ext" (RHET105WE1S09.pdf, AAS346F09.pdf) or
 * "{fa|sp}{YY}-{subj}{num}[-{section}]-{instructor}.pdf" (sp11-rhet105-b3-larsen.pdf).
 * Old rubrics are mapped to the catalog's (COMM -> CMN, KINE/KINES -> KIN,
 * ANT -> ANTH); a name whose code is not an undergraduate catalog code is skipped.
 *
 * The host answers on HTTP only. robots.txt disallows /_mm/, /_notes/,
 * /_baks/, /MMWIP/ and *.csi, none of which hold documents. The older
 * /docs/syllabi/ copies exist only in the Wayback Machine and come in through
 * wayback-hosts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';
import { decodeEntities } from '../lib/text.mjs';
import { makeTerm } from '../lib/terms.mjs';

export const id = 'eui';
const INDEXES = ['http://www.eui.illinois.edu/courses/past/', 'http://www.eui.illinois.edu/courses/current/'];
const RUBRIC = { COMM: 'CMN', KINE: 'KIN', KINES: 'KIN', ANT: 'ANTH' };
const SEASON = { f: 'fall', s: 'spring', fa: 'fall', sp: 'spring', su: 'summer' };

/** File name (and the research's subject hint) -> { code, term, section } or null. */
export function parseName(file, subjHint = null) {
  const f = decodeURIComponent(file);
  let m = f.match(/^(fa|sp|su)(\d{2})-([a-z]{2,5})(\d{3})(?:-([a-z0-9]{1,3}))?-[a-z-]+\.(pdf|docx?)$/i);
  let subj, num, term, section;
  if (m) {
    [, , , subj, num, section] = m;
    term = makeTerm(SEASON[m[1].toLowerCase()], m[2]);
  } else {
    m = f.match(/^([A-Za-z]{2,5}?)(\d{3})([A-Z]{0,2}\d?)?(F|S)(\d{2})\.(pdf|docx?)$/i);
    if (!m) return null;
    [, subj, num, section] = m;
    term = makeTerm(SEASON[m[4].toLowerCase()], m[5]);
  }
  subj = subj.toUpperCase();
  subj = RUBRIC[subj] ?? subj;
  let code = normalizeCode(`${subj} ${num}`);
  // "ENG199F08.pdf" listed under English is ENGL 199, not the engineering course.
  if (subj === 'ENG' && subjHint === 'ENGL') code = normalizeCode(`ENGL ${num}`);
  return code ? { code, term, section: section || null } : null;
}

export async function run({ get, log }) {
  const files = new Map(); // url -> subj hint
  for (const index of INDEXES) {
    const g = await get(index, { source: id, maxAgeDays: 7 });
    if (g.outcome !== 'ok' || !g.bodyPath) { log(`${id}: index ${index} ${g.outcome}`); continue; }
    for (const m of readFileSync(g.bodyPath, 'latin1').matchAll(/href\s*=\s*["']([^"']+\.(?:pdf|docx?))["']/gi)) {
      try { files.set(new URL(decodeEntities(m[1]).replace(/ /g, '%20'), g.finalUrl ?? index).href, null); } catch { /* a broken href */ }
    }
  }
  const live = files.size;
  const research = join(DIRS.ids, 'eui-docs.json');
  if (existsSync(research)) for (const d of JSON.parse(readFileSync(research, 'utf8'))) if (!files.get(d.url)) files.set(d.url, d.subj ?? null);
  const rows = [];
  for (const [url, hint] of files) {
    const k = parseName(url.split('/').pop(), hint);
    if (!k) continue;
    const g = await get(url, { source: id });
    rows.push({
      source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
      contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: [k.code], hintTerm: k.term,
      hintSection: k.section, kindHint: 'syllabus', foundVia: INDEXES[0], fetchedAt: g.fetchedAt ?? null,
    });
  }
  log(`${id}: ${live} files on the index pages, ${files.size} with the research list, ${rows.length} with a catalog code, ${rows.filter((r) => r.outcome === 'ok').length} read`);
  return { rows, complete: true, note: 'courses/past and courses/current' };
}
