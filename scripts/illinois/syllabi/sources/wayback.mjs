/**
 * Syllabi that are gone from the live web but kept by the Internet Archive,
 * read as the archived bytes ("id_" snapshots, no Wayback toolbar):
 *
 *   https://web.archive.org/web/{timestamp}id_/{original url}
 *
 * The research pass already listed the archive for every host it swept (the
 * CDX dumps under data/syllabi/ids/cdx/: one line per capture, url, timestamp,
 * status and type) and tied the syllabus-named captures to catalog courses.
 * These adapters read those lists, so no CDX query is sent; each document is
 * one snapshot request, which lib/http.mjs spaces 3 s apart on
 * web.archive.org and sends with the tool's own name, as the Internet
 * Archive's bot page asks.
 *
 *   up-wayback     Urban & Regional Planning's syllabus archive, removed from
 *                  urban.illinois.edu and web.faa.illinois.edu (ids/up-coverage.json,
 *                  383 files for 76 UP codes, Spring 2015 - Fall 2024)
 *   ler            the School of Labor and Employment Relations' undergraduate
 *                  syllabi, 2010 - Spring 2020 (the professional sweep's hits)
 *   wayback-hosts  the LAS humanities hosts (ids/wayback-hum-course-map.json,
 *                  211 courses) plus every other archived hit of the
 *                  professional and sciences sweeps
 *
 * A course keeps at most PER files: names that say syllabus first, then the
 * newest capture, one file per name, so ANTH 157's 90 lecture-note pages are
 * never fetched for its one syllabus. Notes, assignments, exam keys, grade
 * lists and study guides are left out. A capture of a PDF whose type was
 * text/html is the old host's error page and is never chosen.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';
import { termKey, termMentions } from '../lib/terms.mjs';

const PER = Number(process.env.WAYBACK_PER_COURSE ?? 2);
const IDS = DIRS.ids;
const RESEARCH = DIRS.research;

/** "http://www.anthro.uiuc.edu:80/x" -> "anthro.uiuc.edu/x": one key for every spelling of a URL. */
function keyOf(url) {
  const s = String(url).trim().replace(/^https?:\/\//i, '');
  const slash = s.indexOf('/');
  const host = (slash < 0 ? s : s.slice(0, slash)).toLowerCase().replace(/:(80|443)$/, '').replace(/^www\./, '');
  return host + (slash < 0 ? '/' : s.slice(slash));
}

/** Every 200 capture in the research CDX dumps: key -> { ts, original, mime } (the newest). */
let captures = null;
function loadCaptures() {
  if (captures) return captures;
  captures = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!f.endsWith('.txt')) continue;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4 || !/^\d{14}$/.test(parts[1])) continue;
        // Two column orders in the dumps: "url ts status mime" and "url ts mime status".
        const [original, ts] = parts;
        const [status, mime] = /^(\d{3}|-)$/.test(parts[2]) ? [parts[2], parts[3]] : [parts[3], parts[2]];
        if (status !== '200') continue;
        const key = keyOf(original);
        if (/\.(pdf|docx?|rtf)$/i.test(key) && /html/i.test(mime)) continue; // a saved error page
        const prev = captures.get(key);
        if (!prev || prev.ts < ts) captures.set(key, { ts, original, mime });
      }
    }
  };
  walk(join(IDS, 'cdx'));
  return captures;
}

const SYLLABUS = /syll?ab|sylabbus|syallbi|course[\s_-]*(info|outline|policies)|polic/i;
const NOT = /notes?\d*\b|notes\d|assign|exam\d|exam[\s_-]*key|key\.|grades|studyguide|study[\s_-]*guide|quiz|handout|reading[\s_-]*list|tableofcontents|\.(gif|jpe?g|png|css|js)$/i;

/** The archived snapshot URL for one original URL (or a Wayback URL the research already resolved). */
function snapshotFor(url) {
  const m = String(url).match(/^https?:\/\/web\.archive\.org\/web\/(\d{4,14})(?:id_)?\/(.+)$/);
  const original = m ? m[2] : url;
  const cap = loadCaptures().get(keyOf(original));
  if (cap) return { snapshot: `https://web.archive.org/web/${cap.ts}id_/${cap.original}`, original: cap.original, ts: cap.ts };
  if (m) return { snapshot: `https://web.archive.org/web/${m[1]}id_/${m[2]}`, original: m[2], ts: m[1] };
  return null; // never captured as a 200: nothing to read
}

/** Up to PER snapshots for one course, best first. */
function pick(urls) {
  const seen = new Set();
  const cands = [];
  for (const u of urls) {
    const s = snapshotFor(u);
    if (!s) continue;
    const name = decodeURIComponent(keyOf(s.original).split('/').filter(Boolean).pop() ?? '').toLowerCase();
    if (NOT.test(name) && !SYLLABUS.test(name)) continue;
    // One file per name: the same syllabus sits under anthro.uiuc.edu, anthro.illinois.edu and faculty.las.
    const dedupe = keyOf(s.original).replace(/^[^/]+/, '').replace(/(index\.html?)?([?#].*)?$/i, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const term = termMentions(decodeURIComponent(s.original))[0]?.term ?? null;
    cands.push({ ...s, term, score: SYLLABUS.test(name) ? 0 : 1 });
  }
  cands.sort((a, b) => a.score - b.score || termKey(b.term) - termKey(a.term) || b.ts.localeCompare(a.ts));
  return cands.slice(0, PER);
}

function waybackSource({ id, seeds, note }) {
  return {
    id,
    /** What a run would fetch, without fetching: [[code, [picked...]], ...]. */
    plan: () => [...seeds()].map(([code, urls]) => [code, pick(urls)]),
    async run({ get, log }) {
      const courses = seeds();
      const rows = [];
      let n = 0;
      for (const [code, urls] of courses) {
        for (const c of pick(urls)) {
          const g = await get(c.snapshot, { source: id });
          rows.push({
            source: id, url: c.snapshot, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
            contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: [code], hintTerm: c.term,
            hintSection: null, kindHint: 'syllabus', foundVia: c.original, archivedAt: c.ts, fetchedAt: g.fetchedAt ?? null,
          });
        }
        n += 1;
        if (n % 25 === 0) log(`${id}: ${n}/${courses.size} courses, ${rows.filter((r) => r.outcome === 'ok').length} snapshots read`);
      }
      log(`${id}: done, ${courses.size} courses, ${rows.filter((r) => r.outcome === 'ok').length} of ${rows.length} snapshots read`);
      return { rows, complete: true, note };
    },
  };
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const add = (map, code, urls) => {
  const c = normalizeCode(code);
  if (!c) return;
  map.set(c, [...(map.get(c) ?? []), ...urls]);
};

/** The professional and sciences sweeps' archived hits: [code, url] pairs. */
function sweepArchived() {
  const out = [];
  const prof = readJson(join(RESEARCH, 'sweep-professional-coverage.json')) ?? {};
  for (const [code, v] of Object.entries(prof)) for (const h of v.hits ?? []) if (h.status === 'archived') out.push([code, h.url]);
  const sci = readJson(join(RESEARCH, 'sweep-sciences-coverage.json')) ?? {};
  for (const [code, v] of Object.entries(sci)) for (const h of v.sources ?? []) if (/web\.archive\.org/.test(h.url)) out.push([code, h.url]);
  return out;
}
const isUp = (u) => /urban\.illinois\.edu|web\.faa\.illinois\.edu/i.test(u);
const isLer = (u) => /ler\.illinois\.edu/i.test(u);

export const upWayback = waybackSource({
  id: 'up-wayback',
  note: 'ids/up-coverage.json and the professional sweep; archived snapshots',
  seeds: () => {
    const m = new Map();
    for (const [code, urls] of Object.entries(readJson(join(IDS, 'up-coverage.json')) ?? {})) add(m, code, urls);
    for (const [code, url] of sweepArchived()) if (isUp(url)) add(m, code, [url]);
    return m;
  },
});

export const ler = waybackSource({
  id: 'ler',
  note: 'the professional sweep\'s archived LER syllabi',
  seeds: () => {
    const m = new Map();
    for (const [code, url] of sweepArchived()) if (isLer(url)) add(m, code, [url]);
    return m;
  },
});

export const waybackHosts = waybackSource({
  id: 'wayback-hosts',
  note: 'ids/wayback-hum-course-map.json and the sweeps\' other archived hits',
  seeds: () => {
    const m = new Map();
    for (const [code, urls] of Object.entries(readJson(join(IDS, 'wayback-hum-course-map.json')) ?? {})) add(m, code, urls);
    for (const [code, url] of sweepArchived()) if (!isUp(url) && !isLer(url)) add(m, code, [url]);
    return m;
  },
});

