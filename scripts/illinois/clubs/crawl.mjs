/**
 * Read the OneIllinois club directory and its public events feed, politely,
 * and parse both into data/clubs/ (parse.mjs).
 *
 *   node scripts/illinois/clubs/crawl.mjs                two requests, plus robots.txt at most once a day per host
 *   node scripts/illinois/clubs/crawl.mjs --offline      no network at all: re-parse what data/clubs/raw/ holds
 *   node scripts/illinois/clubs/crawl.mjs --accept-drop  the group count may move more than 15% from the last parse
 *
 * The two requests (DESIGN 2.1):
 *   1. GET https://one.illinois.edu/club_signup?view=all&
 *      Every group on one page, about 6.7 MB, with the page's own count.
 *   2. GET https://one.illinois.edu/ical/urbanachampaign/ical_urbanachampaign.ics
 *      It answers 302 to the same path on static-prod-us-east-1.campusgroups.com,
 *      and that hop carries If-None-Match / If-Modified-Since from the last
 *      read, so an unchanged feed is a 304 and costs the host nothing.
 *
 * How it asks (DESIGN 2.2):
 *   - the house agent, UA in scripts/illinois/syllabi/lib/paths.mjs, never another;
 *   - robots.txt first, for every host it will touch, read with parseRobots and
 *     decide from scripts/illinois/syllabi/lib/robots.mjs, unchanged. As in the
 *     syllabus fetcher: 404/410 means no rules; any other answer that is not a
 *     200 means "disallow everything". A robots.txt is reused for a day
 *     (data/clubs/raw/robots/);
 *   - one request at a time, at least 1.1 s apart (or the host's Crawl-delay,
 *     when its robots.txt sets a longer one); redirect: 'manual'; no
 *     cookies (Node's fetch keeps no jar and nothing here sets one);
 *   - the only redirect followed is the feed's, to /ical/ on the CampusGroups
 *     host. A redirect to Shibboleth or any login ends the run, and so does
 *     any other redirect;
 *   - one backoff and retry on 429, 5xx or a dropped connection, honoring
 *     Retry-After; a 403 to the house agent ends the run;
 *   - never fetched: /events (needs a login), /<slug>/home/ (one request per
 *     group, and they show officer names), /upload/ (logos), /send_message_boot,
 *     /mobile_ws/;
 *   - every request, and every answer read from the cache, is one line of
 *     data/clubs/fetchlog.jsonl:
 *       {"at":"...","url":"https://one.illinois.edu/club_signup?view=all&","robots":"allow",
 *        "rule":"no matching rule","status":200,"outcome":"ok","ms":5012,"bytes":6812345,
 *        "cached":false,"conditional":false,"source":"directory"}
 *
 * Privacy (DESIGN 2.3): the page carries student contact names. It is
 * scrubbed in memory (parse.mjs scrubDirectory) before anything is written,
 * and the raw page never reaches the disk. data/clubs/raw/ holds only the
 * scrubbed page and the scrubbed feed, which --offline re-parses, and the
 * whole of data/clubs/ is git-ignored by its own .gitignore ("*").
 *
 * If the count guard fails, nothing is overwritten: the last good cache and
 * outputs stay, and the scrubbed page is set aside as *.rejected.html.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UA } from '../syllabi/lib/paths.mjs';
import { ALLOW_ALL, DENY_ALL, decide, groupFor, parseRobots } from '../syllabi/lib/robots.mjs';
import { FEED_REDIRECT, HOST, SOURCE, parseAll, readPrevious, scrubDirectory, scrubFeed, writeOutputs } from './parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// CLUBS_DATA points a test run somewhere else; the pipeline itself never sets it.
const DATA = process.env.CLUBS_DATA ? resolve(process.env.CLUBS_DATA) : join(ROOT, 'data', 'clubs');
const RAW = join(DATA, 'raw');
const FILES = {
  page: join(RAW, 'club_signup.view-all.scrubbed.html'),
  pageMeta: join(RAW, 'club_signup.view-all.json'),
  rejected: join(RAW, 'club_signup.view-all.rejected.html'),
  feed: join(RAW, 'ical_urbanachampaign.scrubbed.ics'),
  feedMeta: join(RAW, 'ical_urbanachampaign.json'),
  robots: join(RAW, 'robots'),
  log: join(DATA, 'fetchlog.jsonl'),
};

const DIRECTORY_URL = SOURCE.page;
const FEED_URL = `https://${HOST}/ical/urbanachampaign/ical_urbanachampaign.ics`;
const MIN_GAP_MS = 1100;
const ROBOTS_TTL_MS = 24 * 3600 * 1000;
const MAX_BYTES = 40 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const offline = process.argv.includes('--offline');
const acceptDrop = process.argv.includes('--accept-drop');

/** Ends the run: a 403, a login, a refused path, a second failure. */
class Stop extends Error {}

const LOGIN_HOSTS = /(^|\.)(shibboleth\.illinois\.edu|login\.illinois\.edu|idp\.illinois\.edu|sso\.illinois\.edu|discovery\.illinois\.edu|login\.microsoftonline\.com)$/i;
const LOGIN_PATHS = /(^\/login\b|\/saml|\/Shibboleth\.sso|\/idp\/|\/cas\/login|\/sso\b|\/oauth2?\/authorize|\/signin)/i;
const isLogin = (u) => LOGIN_HOSTS.test(u.host) || LOGIN_PATHS.test(u.pathname);

/** Paths this pipeline never fetches, whatever robots.txt says. */
function never(u) {
  if (u.host !== HOST) return null;
  if (/^\/events\b/i.test(u.pathname)) return '/events needs a login';
  if (/^\/[^/]+\/home\b/i.test(u.pathname)) return 'group home pages show officer names and cost one request per group';
  if (/^\/upload\//i.test(u.pathname)) return 'logos (/upload/ is disallowed by robots.txt)';
  if (/send_message/i.test(u.pathname)) return 'message links';
  if (/^\/mobile_ws\//i.test(u.pathname)) return 'the mobile API';
  return null;
}

// ---------------------------------------------------------------------------
// the fetch log and the one queue

function log(row) {
  mkdirSync(DATA, { recursive: true });
  appendFileSync(FILES.log, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
}

let lastAt = 0;
let sent = 0;

function retryAfterMs(h) {
  const v = h.get('retry-after');
  if (!v) return null;
  if (/^\d+$/.test(v)) return Math.min(Number(v) * 1000, 5 * 60_000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.min(Math.max(t - Date.now(), 0), 5 * 60_000) : null;
}

/**
 * One GET, in the one queue, at least 1.1 s after the last (longer when the
 * host's robots.txt sets a Crawl-delay, as the syllabus fetcher does). One
 * retry on 429, 5xx or a dropped connection; a 403 ends the run. Never
 * follows a redirect.
 * Returns { status, location, etag, lastModified, contentType, body (Buffer, 200 only), ms }.
 */
async function politeGet(url, { headers = {}, source, robots, timeoutMs = 180_000 }) {
  const u = new URL(url);
  const refused = never(u);
  if (refused) throw new Stop(`refused ${url}: ${refused}`);
  const gap = Math.max(MIN_GAP_MS, (robots?.crawlDelay ?? 0) * 1000);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const wait = lastAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    const t0 = Date.now();
    const conditional = Boolean(headers['if-none-match'] || headers['if-modified-since']);
    let r;
    try {
      sent += 1;
      r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      lastAt = Date.now();
      log({ url, robots: robots?.verdict ?? 'n/a', rule: robots?.rule ?? null, status: 0, outcome: 'error', error: e.message, ms: lastAt - t0, cached: false, conditional, source, attempt });
      if (attempt === 0) { await sleep(5000); continue; }
      throw new Stop(`${url}: ${e.message}, twice`);
    }
    const meta = {
      status: r.status,
      location: r.headers.get('location'),
      etag: r.headers.get('etag'),
      lastModified: r.headers.get('last-modified'),
      contentType: r.headers.get('content-type'),
    };
    let body = null;
    let outcome = r.status === 200 ? 'ok' : r.status === 304 ? 'not-modified' : r.status >= 300 && r.status < 400 ? 'redirect' : 'http-error';
    if (r.status === 200) {
      const len = Number(r.headers.get('content-length') ?? -1);
      if (len > MAX_BYTES) { await r.body?.cancel(); outcome = 'too-large'; } else body = Buffer.from(await r.arrayBuffer());
    } else await r.body?.cancel().catch(() => {});
    lastAt = Date.now();
    log({ url, robots: robots?.verdict ?? 'n/a', rule: robots?.rule ?? null, status: r.status, outcome, ms: lastAt - t0, bytes: body?.length ?? 0, cached: false, conditional, source, attempt });
    if (outcome === 'too-large' || (body && body.length > MAX_BYTES)) throw new Stop(`${url}: larger than ${MAX_BYTES} bytes`);
    if (r.status === 403) throw new Stop(`${url}: 403 to the house agent; the host does not want us, stopping`);
    if (r.status === 429 || r.status >= 500) {
      if (attempt === 0) { await sleep(retryAfterMs(r.headers) ?? 10_000); continue; }
      throw new Stop(`${url}: HTTP ${r.status}, twice`);
    }
    return { ...meta, body, ms: lastAt - t0 };
  }
  throw new Stop(`${url}: no answer`);
}

// ---------------------------------------------------------------------------
// robots.txt

/**
 * The parsed robots.txt for an origin, read at most once a day. 200 -> its
 * rules; 404/410 -> no rules; anything else (another 4xx, a 5xx, a redirect
 * into a login, no answer) -> disallow everything.
 */
async function robotsFor(origin) {
  const host = new URL(origin).host;
  const file = join(FILES.robots, `${host}.json`);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - Date.parse(saved.fetchedAt) < ROBOTS_TTL_MS) {
      log({ url: `${origin}/robots.txt`, robots: 'n/a', status: saved.status, outcome: `robots.txt ${saved.verdict}`, cached: true, source: 'robots' });
      return { ...saved, parsed: saved.verdict === 'rules' ? parseRobots(saved.text) : saved.verdict === 'allow-all' ? ALLOW_ALL : DENY_ALL };
    }
  }
  let url = `${origin}/robots.txt`;
  let status = 0;
  let verdict = 'deny-all';
  let text = '';
  for (let hop = 0; hop <= 5; hop += 1) {
    let res;
    try {
      res = await politeGet(url, { source: 'robots', timeoutMs: 30_000 });
    } catch (e) {
      // A 403 or a second 5xx on robots.txt: no rules we can read, so disallow everything.
      if (!(e instanceof Stop) || !/\b(403|HTTP 5\d\d)\b/.test(e.message)) throw e;
      res = { status: Number(e.message.match(/\b(403|5\d\d)\b/)[1]) };
    }
    status = res.status;
    if (status >= 300 && status < 400 && res.location) {
      const next = new URL(res.location, url);
      if (isLogin(next)) break;
      url = next.href;
      continue;
    }
    if (status === 200) { verdict = 'rules'; text = res.body.toString('utf8'); } else if (status === 404 || status === 410) verdict = 'allow-all';
    break;
  }
  const saved = { origin, fetchedAt: new Date().toISOString(), status, verdict, text };
  mkdirSync(FILES.robots, { recursive: true });
  writeFileSync(file, JSON.stringify(saved, null, 1));
  return { ...saved, parsed: verdict === 'rules' ? parseRobots(text) : verdict === 'allow-all' ? ALLOW_ALL : DENY_ALL };
}

/** { verdict: 'allow'|'disallow', rule, crawlDelay (seconds, or null) } for one URL. */
async function permission(url) {
  const robots = await robotsFor(new URL(url).origin);
  const d = decide(robots.parsed, url);
  const rule = robots.verdict === 'deny-all' ? `robots.txt answered ${robots.status || 'nothing'}; read as disallow-all` : d.rule;
  return { verdict: d.allowed ? 'allow' : 'disallow', rule, crawlDelay: groupFor(robots.parsed).crawlDelay };
}

// ---------------------------------------------------------------------------
// the two requests

const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const writeAtomic = (file, data) => {
  writeFileSync(`${file}.tmp`, data);
  renameSync(`${file}.tmp`, file);
};

/** Request 1. Returns { html (scrubbed), meta }; the raw page lives only in this function. */
async function fetchDirectory() {
  const perm = await permission(DIRECTORY_URL);
  if (perm.verdict !== 'allow') {
    log({ url: DIRECTORY_URL, robots: 'disallow', rule: perm.rule, status: null, outcome: 'robots', cached: false, source: 'directory' });
    throw new Stop(`robots.txt disallows ${DIRECTORY_URL} (${perm.rule})`);
  }
  const res = await politeGet(DIRECTORY_URL, { headers: { accept: 'text/html' }, source: 'directory', robots: perm });
  if (res.status >= 300 && res.status < 400) {
    const to = res.location ? new URL(res.location, DIRECTORY_URL) : null;
    throw new Stop(`the directory page redirected${to && isLogin(to) ? ' to a login' : ''} (${to?.host ?? '?'}${to?.pathname ?? ''}); ending the run`);
  }
  if (res.status !== 200) throw new Stop(`the directory page answered ${res.status}`);
  if (!/text\/html/i.test(res.contentType ?? '')) throw new Stop(`the directory page came back as ${res.contentType}, not HTML`);
  const { html, report } = scrubDirectory(res.body.toString('utf8'));
  const meta = { url: DIRECTORY_URL, status: res.status, fetchedAt: new Date().toISOString(), contentType: res.contentType, bytes: res.body.length, sha16: sha16(res.body), ms: res.ms, scrub: report };
  return { html, meta };
}

/**
 * Request 2. Returns { ics (scrubbed), meta, fresh } or null when the feed
 * could not be read this time (the caller then uses the last cached copy).
 */
async function fetchFeed() {
  const prior = existsSync(FILES.feedMeta) && existsSync(FILES.feed) ? JSON.parse(readFileSync(FILES.feedMeta, 'utf8')) : null;
  const perm = await permission(FEED_URL);
  if (perm.verdict !== 'allow') {
    log({ url: FEED_URL, robots: 'disallow', rule: perm.rule, status: null, outcome: 'robots', cached: false, source: 'feed' });
    console.warn(`  feed: robots.txt disallows ${FEED_URL} (${perm.rule}); not read`);
    return null;
  }
  let res = await politeGet(FEED_URL, { headers: { accept: 'text/calendar' }, source: 'feed', robots: perm });
  let finalUrl = FEED_URL;
  if (res.status >= 300 && res.status < 400) {
    const to = res.location ? new URL(res.location, FEED_URL) : null;
    if (!to) throw new Stop('the feed redirected without a Location');
    if (isLogin(to)) throw new Stop(`the feed redirected to a login (${to.host}); ending the run`);
    if (to.protocol !== 'https:' || to.host !== FEED_REDIRECT.host || !to.pathname.startsWith(FEED_REDIRECT.pathPrefix)) {
      throw new Stop(`the feed redirected to ${to.host}${to.pathname}, not the expected ${FEED_REDIRECT.host}${FEED_REDIRECT.pathPrefix}; ending the run`);
    }
    finalUrl = to.href;
    const hop = await permission(finalUrl);
    if (hop.verdict !== 'allow') {
      log({ url: finalUrl, robots: 'disallow', rule: hop.rule, status: null, outcome: 'robots', cached: false, source: 'feed' });
      console.warn(`  feed: robots.txt on ${to.host} disallows ${to.pathname} (${hop.rule}); not read`);
      return null;
    }
    const headers = { accept: 'text/calendar' };
    if (prior?.finalUrl === finalUrl && prior.etag) headers['if-none-match'] = prior.etag;
    if (prior?.finalUrl === finalUrl && prior.lastModified) headers['if-modified-since'] = prior.lastModified;
    res = await politeGet(finalUrl, { headers, source: 'feed', robots: hop });
    if (res.status >= 300 && res.status < 400 && res.status !== 304) throw new Stop(`the feed redirected a second time (${res.status}); ending the run`);
  }
  if (res.status === 304 && prior) {
    const meta = { ...prior, checkedAt: new Date().toISOString(), lastStatus: 304 };
    return { ics: readFileSync(FILES.feed, 'utf8'), meta, fresh: false };
  }
  if (res.status !== 200) {
    console.warn(`  feed: answered ${res.status}; not read`);
    return null;
  }
  const { ics, report } = scrubFeed(res.body.toString('utf8'));
  const now = new Date().toISOString();
  const meta = { url: FEED_URL, finalUrl, status: 200, fetchedAt: now, checkedAt: now, lastStatus: 200, etag: res.etag, lastModified: res.lastModified, contentType: res.contentType, bytes: res.body.length, sha16: sha16(res.body), ms: res.ms, scrub: report };
  return { ics, meta, fresh: true };
}

// ---------------------------------------------------------------------------

function ensureDataDir() {
  mkdirSync(RAW, { recursive: true });
  const ignore = join(DATA, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
}

const say = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function main() {
  ensureDataDir();
  const previous = readPrevious(DATA);
  let page;
  let feed;

  if (offline) {
    if (!existsSync(FILES.page) || !existsSync(FILES.pageMeta)) {
      console.error('nothing cached under data/clubs/raw/; run once without --offline');
      process.exit(1);
    }
    page = { html: readFileSync(FILES.page, 'utf8'), meta: JSON.parse(readFileSync(FILES.pageMeta, 'utf8')) };
    log({ url: DIRECTORY_URL, robots: 'n/a', status: page.meta.status, outcome: 'offline-cache', cached: true, source: 'directory' });
    if (existsSync(FILES.feed) && existsSync(FILES.feedMeta)) {
      feed = { ics: readFileSync(FILES.feed, 'utf8'), meta: JSON.parse(readFileSync(FILES.feedMeta, 'utf8')), fresh: false };
      log({ url: FEED_URL, robots: 'n/a', status: feed.meta.lastStatus ?? feed.meta.status, outcome: 'offline-cache', cached: true, source: 'feed' });
    }
    say('offline: re-parsing data/clubs/raw/, no network');
  } else {
    say(`reading ${DIRECTORY_URL}`);
    page = await fetchDirectory();
    say(`  ${page.meta.bytes} bytes in ${page.meta.ms} ms; scrubbed to ${page.meta.scrub.bytesOut} bytes: ${page.meta.scrub.contactBlocks} contact blocks, ${page.meta.scrub.names} contact names (never stored), ${page.meta.scrub.namesBlanked} repeats blanked, ${page.meta.scrub.uids} uids, ${page.meta.scrub.images} images, ${page.meta.scrub.emails} emails, ${page.meta.scrub.phones} phone numbers dropped`);
    say(`reading ${FEED_URL}`);
    // A stop here ends the requests, not the parse: the page already read is still parsed and kept.
    feed = await fetchFeed().catch((e) => {
      if (!(e instanceof Stop)) throw e;
      console.warn(`  feed STOPPED: ${e.message}`);
      return null;
    });
    if (feed) say(`  ${feed.fresh ? `${feed.meta.bytes} bytes, ${feed.meta.scrub.events} events, scrubbed to ${feed.meta.scrub.bytesOut} bytes` : 'not modified (304), reusing the cached copy'}; Last-Modified ${feed.meta.lastModified ?? '?'}`);
    else if (existsSync(FILES.feed) && existsSync(FILES.feedMeta)) {
      feed = { ics: readFileSync(FILES.feed, 'utf8'), meta: JSON.parse(readFileSync(FILES.feedMeta, 'utf8')), fresh: false };
      console.warn(`  WARNING: the feed was not read this run; using the copy read ${feed.meta.fetchedAt}`);
    } else console.warn('  WARNING: no events feed this run and none cached; events.json is not written');
  }

  const result = parseAll({ html: page.html, htmlMeta: page.meta, ics: feed?.ics ?? null, icsMeta: feed ? { ...feed.meta, fetchedAt: feed.meta.checkedAt ?? feed.meta.fetchedAt } : null, previous, acceptDrop });
  for (const w of result.guard.warnings) console.warn(`  guard warning: ${w}`);
  if (!result.guard.ok) {
    if (!offline) writeAtomic(FILES.rejected, page.html);
    for (const f of result.guard.failures) console.error(`  GUARD FAILED: ${f}`);
    console.error(`nothing overwritten${offline ? '' : `; the scrubbed page is set aside as ${FILES.rejected}`}`);
    process.exit(1);
  }

  if (!offline) {
    writeAtomic(FILES.page, page.html);
    writeAtomic(FILES.pageMeta, `${JSON.stringify(page.meta, null, 1)}\n`);
    if (feed?.meta) {
      if (feed.fresh) writeAtomic(FILES.feed, feed.ics);
      writeAtomic(FILES.feedMeta, `${JSON.stringify(feed.meta, null, 1)}\n`);
    }
  }
  const sizes = writeOutputs(DATA, result);
  report(result, sizes);
}

function report({ directory: d, events }, sizes) {
  const c = d.counts;
  say(`wrote data/clubs/directory.json (${sizes.directory} bytes), texts.jsonl (${sizes.texts}), events.json (${sizes.events || 'not written'})`);
  console.log(`  page says ${c.onPage} groups (${c.onPageFrom.join('; ')}); parsed ${c.parsed}`);
  console.log(`  by type: ${Object.entries(c.byType).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  offices ${c.offices}; groups after excluding offices ${c.clubs}`);
  console.log(`  links, all groups: profile from the page ${c.links.profileFromPage}, profile from the feed ${c.links.profileFromFeed}, own website only ${c.links.websiteOnly} (http ${c.links.websiteHttp}), none ${c.links.none}`);
  console.log(`  links, clubs only: profile ${c.clubLinks.profile}, own website only ${c.clubLinks.websiteOnly}, none ${c.clubLinks.none}`);
  console.log(`  membership closed ${c.membershipClosed}; restricted ${c.restricted}; no categories ${c.noCategories}; no mission ${c.noMission}; median mission ${c.missionWordsMedian} words`);
  console.log(`  tags: ${d.vocabulary.topical.length} topical + ${d.vocabulary.affiliations.length} affiliations; new ${JSON.stringify(d.vocabulary.added)}; gone ${JSON.stringify(d.vocabulary.gone)}`);
  if (events) {
    console.log(`  feed: ${events.calendar.events} events, ${events.calendar.firstDate} to ${events.calendar.lastDate}; joined by slug ${events.counts.bySlug}, by name ${events.counts.byName}, unjoined ${events.counts.unjoined} (${events.counts.unjoinedOrganizers} organizers)`);
    console.log(`  events, relative to ${d.checked}: groups with any ${c.events.groupsWithAny}; clubs with one in the last 120 days ${c.events.clubsN120}; clubs with one coming up ${c.events.clubsUpcoming}; clubs with either ${c.events.clubsActive}`);
  }
  if (d.problems.length) console.log(`  parse problems ${d.problems.length}: ${JSON.stringify(d.problems.slice(0, 5))}`);
  if (d.missing.length) console.log(`  missing since the last parse ${d.missing.length} (kept 120 days)`);
  if (!offline) console.log(`  requests sent this run: ${sent}`);
}

main().catch((e) => {
  console.error(e instanceof Stop ? `STOPPED: ${e.message}` : e?.stack ?? e);
  process.exit(1);
});
