import { ILLINOIS_BASE } from './illinois-load';
import type { IllinoisClubsFile } from './clubs';

/**
 * public/illinois/clubs.json, fetched once and remembered.
 *
 * Its own loader, not one more artifact in illinois-load.ts: the club file is
 * built by its own pipeline (scripts/illinois/clubs/), on its own dates, and is
 * loaded lazily, the first time the rail's "Clubs for your goals" section
 * mounts or ALMA calls find_clubs. It is never part of loadIllinoisCore.
 *
 * The same rules as illinois-load.ts:
 *
 * 1. One request. Concurrent callers share the in-flight promise, so React's
 *    strict-mode double effect does not fetch twice.
 * 2. Missing is not empty. A 404 (or a host that answers a missing file with
 *    the app's HTML page) settles as 'missing' and is remembered: the build has
 *    not shipped clubs, and the rail hides its section rather than say there
 *    are no clubs. Any other failure ('error') is forgotten, so the card's
 *    "Try again" and the next find_clubs call fetch again.
 * 3. Browser only. On the server it resolves to 'server' without fetching.
 *
 * Fetched with cache: 'no-cache': the URL never changes between builds, so the
 * browser revalidates (a 304 when nothing changed) instead of keeping last
 * semester's clubs.
 */

export type ClubsLoad =
  | { ok: true; value: IllinoisClubsFile }
  | { ok: false; reason: 'missing' | 'error' | 'server' };

export const CLUBS_URL = `${ILLINOIS_BASE}/clubs.json`;

let pending: Promise<ClubsLoad> | null = null;

const isBrowser = () => typeof window !== 'undefined' && typeof fetch === 'function';

/** A file this code can read: version 1, with a club list and a source. Anything else is not a club file. */
function readable(v: unknown): v is IllinoisClubsFile {
  const f = v as Partial<IllinoisClubsFile> | null;
  return Boolean(f && f.version === 1 && Array.isArray(f.clubs) && f.source && typeof f.source.url === 'string' && typeof f.checked === 'string');
}

async function fetchClubs(): Promise<ClubsLoad> {
  const res = await fetch(CLUBS_URL, { cache: 'no-cache' });
  if (res.status === 404) return { ok: false, reason: 'missing' };
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if ((res.headers.get('content-type') ?? '').includes('html')) return { ok: false, reason: 'missing' };
  const value: unknown = await res.json();
  // A file from a newer or broken build will not read better on a retry.
  return readable(value) ? { ok: true, value } : { ok: false, reason: 'missing' };
}

/** The club file, or why not. */
export function loadIllinoisClubs(): Promise<ClubsLoad> {
  if (!isBrowser()) return Promise.resolve({ ok: false, reason: 'server' });
  if (pending) return pending;
  const started = fetchClubs()
    .catch((): ClubsLoad => ({ ok: false, reason: 'error' }))
    .then((r) => {
      if (!r.ok && r.reason === 'error' && pending === started) pending = null;
      return r;
    });
  pending = started;
  return started;
}

/** Forget the file. For a dev rebuild, and for tests. */
export function resetClubsCache(): void {
  pending = null;
}
