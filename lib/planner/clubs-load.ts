import { ILLINOIS_BASE } from './illinois-load';
import type { IllinoisClubsFile } from './clubs';

/**
 * A school's club file, fetched once and remembered: public/illinois/clubs.json
 * (OneIllinois) or public/uga/clubs.json (official UGA pages).
 *
 * Its own loader, not one more artifact in illinois-load.ts: the club file is
 * built by its own pipeline (scripts/illinois/clubs/), on its own dates, and is
 * loaded lazily, the first time the rail's "Clubs for your goals" section
 * mounts or the assistant calls find_clubs. It is never part of loadIllinoisCore.
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
 *
 * UGA's file is partial: UGA's own directory (the Involvement Network) loads
 * its list from an address its robots.txt disallows, so the file holds the
 * clubs official UGA pages list (advising offices, colleges, Recreational
 * Sports, Fraternity & Sorority Life), and Terry College's and some
 * departments' pages could not be read. The loader marks it `partial`, with
 * the one line the rail and find_clubs say about it.
 */

export type ClubsLoad =
  | { ok: true; value: IllinoisClubsFile }
  | { ok: false; reason: 'missing' | 'error' | 'server' };

export type ClubSchool = 'illinois' | 'uga';

export const CLUBS_URL = `${ILLINOIS_BASE}/clubs.json`;
export const UGA_CLUBS_URL = '/uga/clubs.json';
const URLS: Record<ClubSchool, string> = { illinois: CLUBS_URL, uga: UGA_CLUBS_URL };

/**
 * PPAO's "UGA Pre-Health Clubs" tab (ppao.uga.edu/resources/involvement/,
 * read 2026-10-20) is a list for every health track, so the staged build
 * left its `goal` empty and the clubs on it carried no goal of their own
 * (Alpha Epsilon Delta, the American Medical Student Association). The
 * loader names the family it is for: every health track but pre-law and
 * pre-vet, and nursing, the same family a general pre-health club carries
 * at Illinois (clubs.ts HEALTH_GOAL); a pre-vet student is not sent to a
 * medical students' association. Weighted under the clubs named for the goal.
 */
const UGA_PRE_HEALTH_LIST = 'https://ppao.uga.edu/resources/involvement/';
export const UGA_PRE_HEALTH_GOALS = ['pre-medicine', 'pre-dental', 'pre-physician-assistant', 'pre-physical-therapy', 'pre-occupational-therapy', 'pre-optometry', 'pre-pharmacy', 'nursing'];

/** UGA's file as the matcher reads it: partial, and its pre-health list for the health tracks. */
function ugaFile(value: IllinoisClubsFile): IllinoisClubsFile {
  return {
    ...value,
    lists: value.lists.map((l) => (l.url === UGA_PRE_HEALTH_LIST && !l.goal && !l.college && !l.subject ? { ...l, goals: UGA_PRE_HEALTH_GOALS, weight: 0.85 } : l)),
    partial: { line: ugaCoverageLine(value) },
  };
}

/** What the rail and find_clubs say about UGA's list, from its own counts and date. */
export function ugaCoverageLine(data: Pick<IllinoisClubsFile, 'counts'>): string {
  return `The UGA list covers ${data.counts.shipped} clubs from official UGA pages, and more are coming; for the rest, browse UGA's Involvement Network, its student-organization directory.`;
}

const pending = new Map<ClubSchool, Promise<ClubsLoad>>();

const isBrowser = () => typeof window !== 'undefined' && typeof fetch === 'function';

/** A file this code can read: version 1, with a club list and a source. Anything else is not a club file. */
function readable(v: unknown): v is IllinoisClubsFile {
  const f = v as Partial<IllinoisClubsFile> | null;
  return Boolean(f && f.version === 1 && Array.isArray(f.clubs) && f.source && typeof f.source.url === 'string' && typeof f.checked === 'string');
}

async function fetchClubs(school: ClubSchool): Promise<ClubsLoad> {
  const res = await fetch(URLS[school], { cache: 'no-cache' });
  if (res.status === 404) return { ok: false, reason: 'missing' };
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if ((res.headers.get('content-type') ?? '').includes('html')) return { ok: false, reason: 'missing' };
  const value: unknown = await res.json();
  // A file from a newer or broken build will not read better on a retry.
  if (!readable(value)) return { ok: false, reason: 'missing' };
  return { ok: true, value: school === 'uga' ? ugaFile(value) : value };
}

export { ugaFile as readUgaClubs };

/** A school's club file, or why not. */
export function loadClubs(school: ClubSchool): Promise<ClubsLoad> {
  if (!isBrowser()) return Promise.resolve({ ok: false, reason: 'server' });
  const known = pending.get(school);
  if (known) return known;
  const started = fetchClubs(school)
    .catch((): ClubsLoad => ({ ok: false, reason: 'error' }))
    .then((r) => {
      if (!r.ok && r.reason === 'error' && pending.get(school) === started) pending.delete(school);
      return r;
    });
  pending.set(school, started);
  return started;
}

/** Illinois's club file, or why not. */
export function loadIllinoisClubs(): Promise<ClubsLoad> {
  return loadClubs('illinois');
}

/** Forget the files. For a dev rebuild, and for tests. */
export function resetClubsCache(): void {
  pending.clear();
}
