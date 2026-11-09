/**
 * One polite, cached GET against catalog.gatech.edu, for the Georgia Tech
 * crawlers that read catalog pages (scripts/gatech/programs.mjs).
 *
 * SOURCE: any https://catalog.gatech.edu/ page that robots.txt allows
 *   (https://catalog.gatech.edu/robots.txt is read once per run, and every
 *   "User-agent: *" Disallow is obeyed: /search/, /archived-catalogs/, ...).
 *
 * WRITES: the raw page to <cacheDir>/<slug>.html and a line per request to
 *   <cacheDir>/fetch-log.json. A cached page is read back without a request,
 *   so a parser change never needs a re-crawl; --refresh in the caller asks
 *   for the network again.
 *
 * HOW TO USE:
 *   import { catalogGet } from './catalog-get.mjs';
 *   const html = await catalogGet('https://catalog.gatech.edu/programs/', { cacheDir, refresh });
 *
 * POLITENESS: the project's own User-Agent (scripts/illinois/polite-get.mjs),
 *   one request at a time, at least GAP_MS (2 s, above the 1.2 s floor because
 *   other Georgia Tech crawlers may share the host) between requests, and a
 *   202, 429 or 5xx backs off 15 s doubling to 4 min (Retry-After honoured
 *   when it is longer). A 403, a CAPTCHA, a challenge page or a login redirect
 *   throws BlockedError: the caller must stop and report, never retry around it.
 *
 * WHAT IT CANNOT KNOW: whether a cached page is still current. The cache is
 *   the catalog as of the fetch time in fetch-log.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UA, WAITS, sleep } from '../illinois/polite-get.mjs';

export const GAP_MS = 2000;

export class BlockedError extends Error {}

const WALL = /captcha|are you a robot|cf-chl|cloudflare ray id|just a moment\.\.\.|sign in to continue|shibboleth|login\.gatech\.edu\/cas/i;

/** A cache file name that reads back to its URL by eye: /programs/computer-science-bs/ -> programs__computer-science-bs.html */
export function slugOf(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '__').replace(/[^a-z0-9_-]+/gi, '_') || '_root';
  return `${p}.html`;
}

let disallow = null;
let lastAt = 0;
const fetchLog = new Map();

async function waitTurn() {
  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

async function robotsRules(cacheDir) {
  if (disallow) return disallow;
  await waitTurn();
  const res = await fetch('https://catalog.gatech.edu/robots.txt', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`robots.txt: HTTP ${res.status}; not crawling without it`);
  const text = await res.text();
  writeFileSync(join(cacheDir, 'robots.txt'), text);
  const rules = [];
  let star = false;
  for (const line of text.split(/\r?\n/)) {
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k.trim())) star = v === '*' || /fouryearplanbot/i.test(v);
    else if (star && /^disallow$/i.test(k.trim()) && v) rules.push(v);
  }
  disallow = rules;
  return rules;
}

function logLine(cacheDir, url, entry) {
  fetchLog.set(url, { ...entry, at: new Date().toISOString() });
  const path = join(cacheDir, 'fetch-log.json');
  const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  for (const [k, v] of fetchLog) prior[k] = v;
  writeFileSync(path, `${JSON.stringify(prior, null, 1)}\n`);
}

/**
 * The page's HTML, or null when it does not exist (404) or the host stayed
 * busy through every wait. A null is "not read", never "empty".
 */
export async function catalogGet(url, { cacheDir, refresh = false, log = console.log } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, slugOf(url));
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');

  const u = new URL(url);
  if (u.hostname !== 'catalog.gatech.edu') throw new Error(`catalogGet only reads catalog.gatech.edu, not ${u.hostname}`);
  const rules = await robotsRules(cacheDir);
  if (rules.some((d) => u.pathname.startsWith(d))) {
    log(`  robots.txt disallows ${u.pathname}; not fetched`);
    logLine(cacheDir, url, { status: 'robots-disallowed' });
    return null;
  }

  for (let a = 0; a <= WAITS.length; a += 1) {
    await waitTurn();
    let res;
    let body = '';
    try {
      res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(40_000), redirect: 'follow' });
      body = await res.text();
    } catch (e) {
      if (a === WAITS.length) { logLine(cacheDir, url, { status: `error ${e.message}` }); return null; }
      log(`  ${url}: ${e.message}; waiting ${WAITS[a] / 1000}s`);
      await sleep(WAITS[a]);
      continue;
    }
    if (res.status === 404) { logLine(cacheDir, url, { status: 404 }); return null; }
    // A redirect off the catalog host is a login or SSO hop, never a catalog page.
    if (res.status === 401 || res.status === 403 || new URL(res.url).hostname !== 'catalog.gatech.edu') {
      logLine(cacheDir, url, { status: res.status, finalUrl: res.url, blocked: true });
      throw new BlockedError(`${url}: HTTP ${res.status} at ${res.url}; looks like a block or login. Stopping.`);
    }
    if (res.status === 202 || res.status === 429 || res.status >= 500 || (res.ok && body.length < 500)) {
      if (a === WAITS.length) { logLine(cacheDir, url, { status: res.status, gaveUp: true }); return null; }
      const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
      const wait = Math.max(WAITS[a], retryAfter);
      log(`  ${url}: busy (HTTP ${res.status}, ${body.length} bytes); waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) { logLine(cacheDir, url, { status: res.status }); return null; }
    if (WALL.test(body.slice(0, 20000)) && !/id="textcontainer"|id="content"|<main/i.test(body)) {
      logLine(cacheDir, url, { status: res.status, blocked: true });
      throw new BlockedError(`${url} looks like a bot wall, CAPTCHA or login page. Stopping, not retrying.`);
    }
    writeFileSync(file, body);
    logLine(cacheDir, url, { status: res.status, bytes: body.length, file: slugOf(url), ...(res.url !== url ? { finalUrl: res.url } : {}) });
    return body;
  }
  return null;
}
