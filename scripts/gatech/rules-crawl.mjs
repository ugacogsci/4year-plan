/**
 * Georgia Tech university-wide rules and Core IMPACTS: polite page cache.
 *
 * SOURCES (all read as public HTML, no login):
 *   https://catalog.gatech.edu/academics/undergraduate/core-curriculum/  and its
 *     ten subpages (institution, mathematics, citizenship, constitution-history,
 *     humanities, ethics, writing, stem, social-sciences, wellness-requirement)
 *   https://catalog.gatech.edu/rules/  and rules/1 ... rules/22 (the Academic
 *     Rules and Regulations of the Institute, undergraduate and graduate)
 *   https://catalog.gatech.edu/policies/grading-gpa/  and its subpages
 *   https://catalog.gatech.edu/academics/undergraduate/  and the transfer-credit,
 *     advanced-standing and departmental-exams pages under credit-tests-scores/
 *   https://registrar.gatech.edu/ calendar pages (only when robots.txt allows;
 *     the dated calendar's JSON endpoint /calevents/proxy refuses outside
 *     callers with 403 and is deliberately not in the list)
 *
 * WRITES: one file per page under data/gatech-raw/rules/<slug>.html, plus
 *   data/gatech-raw/rules/fetch-log.json (url, status, bytes, when). Nothing in
 *   public/. scripts/gatech/rules-build.mjs reads this cache and never fetches,
 *   so re-parsing never needs a re-crawl.
 *
 * HOW TO RUN (from the worktree root):
 *   export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
 *   node scripts/gatech/rules-crawl.mjs            # fetch what is not cached
 *   node scripts/gatech/rules-crawl.mjs --refresh  # re-fetch everything
 *   node scripts/gatech/rules-crawl.mjs URL ...    # fetch extra pages too
 *
 * POLITENESS: the User-Agent is the project's own (scripts/illinois/polite-get.mjs),
 *   one request at a time, at least 1.5 s between requests to the same host,
 *   robots.txt read first per host and every Disallow for "User-agent: *"
 *   obeyed, and 202/429/5xx backed off 15 s doubling to 4 min (Retry-After
 *   honoured). A 401/403 is logged as blocked and never retried.
 *   A page that looks like a bot wall, CAPTCHA or login is never retried
 *   around: the crawl stops and says so.
 *
 * WHAT IT CANNOT KNOW: only the CURRENT catalog is public to a robot here
 *   (robots.txt disallows /archived-catalogs/), so an earlier year's rule text
 *   cannot be fetched to diff against; changes are known only where the
 *   current page itself states an effective term.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UA, WAITS, sleep } from '../illinois/polite-get.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE = path.join(ROOT, 'data/gatech-raw/rules');
const GAP_MS = 1500;

const CAT = 'https://catalog.gatech.edu';
const CORE = `${CAT}/academics/undergraduate/core-curriculum`;
export const PAGES = [
  `${CORE}/`,
  ...['institution', 'mathematics', 'citizenship', 'constitution-history', 'humanities', 'ethics', 'writing', 'stem', 'social-sciences', 'wellness-requirement'].map((s) => `${CORE}/${s}/`),
  `${CAT}/rules/`,
  ...Array.from({ length: 22 }, (_, i) => `${CAT}/rules/${i + 1}/`),
  `${CAT}/policies/grading-gpa/`,
  ...['auditing', 'examination-term-grades', 'grade-substitution', 'grading-system', 'pass-fail-system-rules', 'progress-reports', 'scholastic-average'].map((s) => `${CAT}/policies/grading-gpa/${s}/`),
  `${CAT}/academics/undergraduate/`,
  `${CAT}/academics/undergraduate/credit-tests-scores/`,
  `${CAT}/academics/undergraduate/credit-tests-scores/transfer-credit/`,
  `${CAT}/academics/undergraduate/credit-tests-scores/departmental-exams/`,
  `${CAT}/academics/undergraduate/undergraduate-students-taking-graduate-courses/`,
  `${CAT}/academics/undergraduate/credit-tests-scores/advanced-standing/`,
  // The term calendar: the catalog says only "the Office of the Registrar
  // publishes the official Academic Calendar for each term" (Rule II.A).
  'https://registrar.gatech.edu/current-students/calendars',
  'https://registrar.gatech.edu/info/current-academic-calendar',
  'https://registrar.gatech.edu/info/future-academic-calendars',
  'https://registrar.gatech.edu/tentative-five-term-school-calendar',
  // These two are empty tables (with the summer-session filter names in the
  // HTML) that the registrar's calendar-table.js fills from
  // /calevents/proxy?year=...&status=... That endpoint answered this crawler
  // 403 {"error":"Origin not allowed"} on 2026-11-09: it is closed to anything
  // but the registrar's own pages, so it is NOT fetched and not worked around.
  'https://registrar.gatech.edu/current-academic-calendar',
  'https://registrar.gatech.edu/future-academic-calendar',
];

/** A cache file name that round-trips to the URL by eye. */
export function slugOf(url) {
  const u = new URL(url);
  const p = `${u.hostname}${u.pathname}`.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '_');
  return `${p}${u.search ? `_${u.search.replace(/[^a-z0-9]+/gi, '_')}` : ''}.html`;
}

const robots = new Map();
async function disallowsFor(host) {
  if (robots.has(host)) return robots.get(host);
  const res = await fetch(`https://${host}/robots.txt`, { headers: { 'user-agent': UA } }).catch(() => null);
  const text = res && res.ok ? await res.text() : '';
  await writeFile(path.join(CACHE, `robots-${host}.txt`), text);
  const rules = [];
  let star = false;
  for (const line of text.split(/\r?\n/)) {
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k.trim())) star = v === '*' || /fouryearplanbot/i.test(v);
    else if (star && /^disallow$/i.test(k.trim()) && v) rules.push(v);
  }
  robots.set(host, rules);
  await sleep(GAP_MS);
  return rules;
}

/**
 * One GET. A 401/403 is an answer, not a busy signal: it comes back at once as
 * { blocked } and is never retried (politeGet in polite-get.mjs retries every
 * non-404 error, which against a 403 only knocks on a closed door for eight
 * minutes). 202, 429 and 5xx back off 15 s doubling to 4 min, or longer when
 * Retry-After says so.
 */
async function getOnce(url) {
  for (let a = 0; a <= WAITS.length; a += 1) {
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(40_000) });
    } catch (e) {
      if (a === WAITS.length) return { error: e.message };
      await sleep(WAITS[a]);
      continue;
    }
    const text = await res.text();
    if (res.status === 404) return { status: 404 };
    if (res.status === 401 || res.status === 403) return { blocked: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    if (res.status === 202 || res.status === 429 || res.status >= 500) {
      if (a === WAITS.length) return { error: `HTTP ${res.status} after every wait` };
      const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
      const wait = Math.max(WAITS[a], retryAfter);
      console.log(`  ${url}: HTTP ${res.status}; waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { text };
  }
  return { error: 'gave up' };
}

const WALL = /captcha|are you a robot|access denied|cf-chl|cloudflare ray id|sign in to continue|shibboleth|login\.gatech\.edu\/cas/i;

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const extra = args.filter((a) => /^https?:\/\//.test(a));
  await mkdir(CACHE, { recursive: true });
  const logPath = path.join(CACHE, 'fetch-log.json');
  const log = existsSync(logPath) ? JSON.parse(await readFile(logPath, 'utf8')) : {};
  const lastAt = new Map();
  for (const url of [...PAGES, ...extra]) {
    const file = path.join(CACHE, slugOf(url));
    if (!refresh && existsSync(file)) continue;
    const u = new URL(url);
    const dis = await disallowsFor(u.hostname);
    if (dis.some((d) => u.pathname.startsWith(d))) {
      console.log(`robots.txt disallows ${url}; skipped`);
      log[url] = { status: 'robots-disallowed', at: new Date().toISOString() };
      continue;
    }
    const wait = (lastAt.get(u.hostname) ?? 0) + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt.set(u.hostname, Date.now());
    const got = await getOnce(url);
    if (got.blocked) {
      console.log(`STOP: ${url} refused this crawler (${got.blocked}). Not retrying or working around it.`);
      log[url] = { status: 'blocked', detail: got.blocked, at: new Date().toISOString() };
      continue;
    }
    if (got.text === undefined) {
      console.log(`not read: ${url} (${got.error ?? got.status})`);
      log[url] = { status: 'not-read', detail: got.error ?? got.status, at: new Date().toISOString() };
      continue;
    }
    const html = got.text;
    if (WALL.test(html.slice(0, 20000)) && !/<div id="textcontainer"|<main/i.test(html)) {
      console.log(`STOP: ${url} looks like a bot wall or login page. Not retrying.`);
      log[url] = { status: 'blocked', at: new Date().toISOString() };
      break;
    }
    await writeFile(file, html);
    log[url] = { status: 'ok', bytes: html.length, file: path.relative(ROOT, file), at: new Date().toISOString() };
    console.log(`ok ${html.length.toString().padStart(7)}  ${url}`);
  }
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
