/**
 * The raw cache: one body per URL, found by the URL's sha256.
 *
 *   data/syllabi/raw/{host}/{sha[0,2]}/{sha}.body   the bytes exactly as served
 *   data/syllabi/raw/{host}/{sha[0,2]}/{sha}.json   url, finalUrl, status, content-type, ...
 *   data/syllabi/raw/manifest.jsonl                 url -> file, status, content-type, fetchedAt
 *
 * The manifest is append-only; the last line for a URL wins, so a crash
 * mid-run loses at most the line being written and a rerun picks up where it
 * stopped. "Never refetch a cached 200" is enforced by the caller (http.mjs)
 * reading lookup() before it touches the network.
 *
 * HEAD results (ID walks) are cached under the key "HEAD {url}" with no body,
 * so a walk over getsyllabus ids 1-4,400 resumes at the first id it has not
 * seen instead of starting again.
 *
 * Example line:
 *   {"url":"https://app.sib.illinois.edu/course/syllabi/IB%20150.pdf","file":"raw/app.sib.illinois.edu/3f/3f9c....body",
 *    "status":200,"contentType":"application/pdf","fetchedAt":"2026-09-27T14:18:02.000Z","bytes":412233}
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DATA, DIRS } from './paths.mjs';

export const sha = (s) => createHash('sha256').update(s).digest('hex');
const MANIFEST = join(DIRS.raw, 'manifest.jsonl');

let index = null;
function load() {
  if (index) return index;
  index = new Map();
  if (existsSync(MANIFEST)) {
    for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const row = JSON.parse(line);
        index.set(row.key ?? row.url, row);
      } catch {
        /* a torn last line from a killed run; the next write supersedes it */
      }
    }
  }
  return index;
}

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return '_'; }
}

export function pathsFor(url, method = 'GET') {
  const key = method === 'HEAD' ? `HEAD ${url}` : url;
  const h = sha(key);
  const dir = join(DIRS.raw, hostOf(url).replace(/[^a-z0-9.-]/g, '_'), h.slice(0, 2));
  return { key, sha: h, dir, body: join(dir, `${h}.body`), meta: join(dir, `${h}.json`) };
}

/** The cached record for a URL, or null. Includes .bodyPath when a body is on disk. */
export function lookup(url, method = 'GET') {
  const p = pathsFor(url, method);
  const row = load().get(p.key);
  if (!row) return null;
  return { ...row, sha: p.sha, bodyPath: row.file ? join(DATA, row.file) : null };
}

export function readBody(url) {
  const hit = lookup(url);
  if (!hit?.bodyPath || !existsSync(hit.bodyPath)) return null;
  return readFileSync(hit.bodyPath);
}

/**
 * Store one response. `body` is a Buffer or null (HEAD, errors, redirects).
 * meta: { status, contentType, finalUrl, disposition, lastModified, etag, location, via, note }
 */
export function store(url, body, meta, method = 'GET') {
  const p = pathsFor(url, method);
  mkdirSync(p.dir, { recursive: true });
  const fetchedAt = meta.fetchedAt ?? new Date().toISOString();
  let file = null;
  if (body && body.length) {
    writeFileSync(p.body, body);
    file = relative(DATA, p.body);
  }
  const record = {
    key: p.key === url ? undefined : p.key,
    url,
    method,
    file,
    status: meta.status,
    contentType: meta.contentType ?? null,
    bytes: body ? body.length : (meta.bytes ?? 0),
    fetchedAt,
    finalUrl: meta.finalUrl ?? null,
    disposition: meta.disposition ?? null,
    lastModified: meta.lastModified ?? null,
    etag: meta.etag ?? null,
    location: meta.location ?? null,
    via: meta.via ?? 'fetch',
    note: meta.note ?? null,
  };
  writeFileSync(p.meta, JSON.stringify(record, null, 1));
  appendFileSync(MANIFEST, `${JSON.stringify(record)}\n`);
  load().set(p.key, record);
  return { ...record, sha: p.sha, bodyPath: file ? join(DATA, file) : null };
}

/** Every cached record (last one per key). */
export function allRecords() {
  return [...load().values()];
}
