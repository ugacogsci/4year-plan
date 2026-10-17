/**
 * One-off public pages the research sweeps found course by course: instructor
 * sites (stat432.org, chriskinson.com/stat440fa26, sipapu.astro.illinois.edu
 * /~ricker/teaching/astr100.html), department pages (astro.illinois.edu's
 * proficiency-exam syllabi, ansc.illinois.edu's I-CAN syllabi), faculty lab
 * sites (wardropperlab.nres), the School of Music's syllabus page, Gies
 * faculty sites (josephmahoney.web.illinois.edu's BA 449 syllabi), the ATLAS
 * course server and publish.illinois.edu course pages.
 *
 * Seeds, each with its catalog code:
 *   - the sciences sweep's live sources (data/syllabi/research/sweep-sciences-coverage.json),
 *     minus the libraries that have their own adapter (app.sib, app.mcb, the
 *     math and chemistry archives);
 *   - the professional sweep's live hits (sweep-professional-coverage.json),
 *     minus Canvas, Box and the iSchool pages already imported;
 *   - the Gies URL check (ids/gies-live.tsv): files that answered 200 and
 *     whose names carry an undergraduate code ("BA449" is BADM 449).
 * A Google Doc is read through its plain-text export, which docs.google.com's
 * robots.txt allows. Every hop is checked by lib/http.mjs; a seed that now
 * redirects to a login is recorded as such and not followed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';
import { termMentions } from '../lib/terms.mjs';

export const id = 'small-seeds';
const OWN_ADAPTER = /app\.sib\.illinois\.edu|app\.mcb\.illinois\.edu|math\.illinois\.edu\/(document|resources|system)|chemistry\.illinois\.edu\/document|web\.archive\.org/i;
/** Sweep labels for the archives crawled by their own adapters (math-docs, math-topics, chem-docs, app-sib, app-mcb). */
const OWN_SOURCE = /^(math-document-archive|math-course-topics|chemistry-document-archive|app\.sib|app\.mcb)$/;
const NEVER = /canvas\.illinois\.edu|box\.com|ischool\.illinois\.edu\/academics\/courses/i;
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

const exportUrl = (url) => {
  const m = url.match(/^https:\/\/docs\.google\.com\/document\/d\/([\w-]+)/);
  return m ? `https://docs.google.com/document/d/${m[1]}/export?format=txt` : url;
};

/** [{ code, url, term, via }] */
export function seeds() {
  const out = [];
  const sci = readJson(join(DIRS.research, 'sweep-sciences-coverage.json')) ?? {};
  for (const [code, v] of Object.entries(sci)) {
    for (const s of v.sources ?? []) if (s.url && !OWN_ADAPTER.test(s.url) && !OWN_SOURCE.test(s.source ?? '')) out.push({ code, url: s.url, term: s.term || null, via: `sciences sweep: ${s.source}` });
  }
  const prof = readJson(join(DIRS.research, 'sweep-professional-coverage.json')) ?? {};
  for (const [code, v] of Object.entries(prof)) {
    for (const h of v.hits ?? []) if (h.status === 'live' && h.url) out.push({ code, url: h.url, term: h.term || null, via: `professional sweep: ${h.source}` });
  }
  const gies = join(DIRS.ids, 'gies-live.tsv');
  if (existsSync(gies)) {
    for (const line of readFileSync(gies, 'utf8').split('\n')) {
      const [status, , , url] = line.split('\t');
      if (status !== '200' || !url || !/syllab/i.test(url)) continue;
      const m = decodeURIComponent(url).match(/(?<![A-Za-z])(BADM|BA|FIN|ACCY|BUS)[\s_]?(\d{3})(?!\d)/i);
      if (!m) continue;
      out.push({ code: `${m[1].toUpperCase() === 'BA' ? 'BADM' : m[1]} ${m[2]}`, url, term: null, via: 'Gies URL check' });
    }
  }
  const seen = new Set();
  return out
    .map((s) => ({ ...s, code: normalizeCode(s.code), url: exportUrl(s.url) }))
    .filter((s) => s.code && !NEVER.test(s.url) && !seen.has(`${s.code} ${s.url}`) && seen.add(`${s.code} ${s.url}`));
}

const termOf = (s) => termMentions(`${s.term ?? ''} ${decodeURIComponent(s.url)}`)[0]?.term ?? null;

export async function run({ get, log }) {
  const list = seeds();
  const rows = [];
  for (const s of list) {
    const g = await get(s.url, { source: id });
    rows.push({
      source: id, url: s.url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
      contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: [s.code], hintTerm: termOf(s),
      hintSection: null, kindHint: 'syllabus', foundVia: s.via, fetchedAt: g.fetchedAt ?? null,
    });
  }
  log(`${id}: ${rows.filter((r) => r.outcome === 'ok').length} of ${list.length} seeds read`);
  return { rows, complete: true, note: `${list.length} seeds from the research sweeps` };
}
