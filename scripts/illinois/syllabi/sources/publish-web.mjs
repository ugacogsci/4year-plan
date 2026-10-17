/**
 * Course and faculty sites on the campus web hosting services, read live:
 *
 *   https://publish.illinois.edu/{site}/...      (WordPress multisite; robots.txt is a 404)
 *   https://{site}.web.illinois.edu/...          (cPanel sites; WordPress defaults where WordPress)
 *
 * The hosts have no index, so the research pass listed them in the Wayback
 * Machine (CDX queries for "syllab" on publish.illinois.edu and the
 * web.illinois.edu domain, kept in data/syllabi/ids/cdx/). Here every listed
 * URL whose path names an undergraduate catalog code is asked for again on
 * the live host: finance300.web.illinois.edu's FIN 300 syllabus,
 * vanitha.web.illinois.edu's BADM 211, publish.illinois.edu/bellon's MSE 443.
 * A file the live host no longer has is a 404 and is left at that; the
 * archived copy is not fetched here.
 *
 * At most PER files a course, newest term in the name first, so a site that
 * kept every term's syllabus costs a few requests, not twenty.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';
import { termKey, termMentions } from '../lib/terms.mjs';

export const id = 'publish-web';
const PER = 3;
const DUMPS = ['cdx/cdx/publish.illinois.edu.txt', 'cdx/cdx/web.illinois.edu.txt', 'cdx/las-hum_cdx/publish.illinois.edu.txt', 'cdx/las-hum_cdx/web.illinois.edu.txt'];
const CODE = /(?<![A-Za-z])([A-Za-z]{2,5})(?:\s|_|-|%20)*(\d{3})(?!\d)/g;
const SKIP = /[?&](dm|action)=|\/wp-(admin|login|json)|\/feed\/?$|\/(tag|category|author)\/|\.(jpe?g|png|gif|css|js)$/i;

const keyOf = (u) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/:(80|443)(?=\/)/, '').replace(/\/$/, '').toLowerCase();

/** [{ code, url, term }] from the CDX dumps: syllabus-named, one catalog code in the path. */
export function candidates() {
  const byCourse = new Map();
  const seen = new Set();
  for (const rel of DUMPS) {
    const f = join(DIRS.ids, rel);
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const original = line.trim().split(/\s+/)[0];
      if (!/^https?:\/\//i.test(original ?? '') || !/syll?ab/i.test(original) || SKIP.test(original)) continue;
      const k = keyOf(original);
      if (seen.has(k)) continue;
      seen.add(k);
      let path;
      try { path = decodeURIComponent(new URL(original).pathname); } catch { continue; }
      const codes = [...new Set([...path.matchAll(CODE)].map((m) => normalizeCode(`${m[1]} ${m[2]}`)).filter(Boolean))];
      if (codes.length !== 1) continue;
      // The live hosts serve HTTPS; the archive often recorded the old http:// address.
      const url = original.replace(/^http:\/\//i, 'https://').replace(/:(80)(?=\/)/, '');
      const list = byCourse.get(codes[0]) ?? [];
      list.push({ code: codes[0], url, term: termMentions(path)[0]?.term ?? null });
      byCourse.set(codes[0], list);
    }
  }
  const out = [];
  for (const list of byCourse.values()) {
    list.sort((a, b) => termKey(b.term) - termKey(a.term));
    out.push(...list.slice(0, PER));
  }
  return out;
}

export async function run({ get, log }) {
  const list = candidates();
  const rows = [];
  for (const c of list) {
    const g = await get(c.url, { source: id });
    if (g.outcome === 'not-found') continue;
    rows.push({
      source: id, url: c.url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
      contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: [c.code], hintTerm: c.term,
      hintSection: null, kindHint: 'syllabus', foundVia: 'Wayback CDX listing, fetched live', fetchedAt: g.fetchedAt ?? null,
    });
  }
  log(`${id}: ${list.length} candidates, ${rows.filter((r) => r.outcome === 'ok').length} still live`);
  return { rows, complete: true, note: `${list.length} syllabus-named URLs from the CDX listings` };
}
