/**
 * The only way the syllabus pipeline touches the network.
 *
 * Every request goes through five gates, in this order:
 *   1. the cache: a URL cached with 200 (or a definitive 404/410, or a login
 *      redirect) is answered from disk and never fetched again, unless the
 *      caller passes { revalidate: true }, which sends a conditional GET;
 *   2. policy: hosts and paths this project has decided never to touch
 *      (canvas.illinois.edu until the student decides; Box downloads and the
 *      public.boxcloud.com preview-token route; login hosts; paywalls and bot
 *      walls). These are refused before robots.txt is even read;
 *   3. robots.txt for that exact origin, fetched once and kept for 24 hours;
 *   4. the host's queue: one request in flight per host, at least 1.1 s apart
 *      (more when robots.txt sets Crawl-delay; 5 s between Wayback CDX calls,
 *      3 s between Wayback snapshots), with courses.grainger, courses.engr and
 *      courses.physics sharing one queue because they are one server;
 *   5. a global limit of 4 hosts in flight at once.
 *
 * Redirects are never followed blindly (redirect: 'manual'). A Location into
 * a login (Shibboleth, SAML, Canvas /login, Box account, Microsoft) ends the
 * chain with outcome "login"; any other hop is checked against gates 2-4
 * again. No cookies are ever sent: Node's fetch keeps no cookie jar and this
 * file never sets a Cookie header.
 *
 * 429 and 5xx back off (Retry-After when the server gives one) and three in a
 * row pause the host for ten minutes. A Cloudflare challenge or three 403s in
 * a row stop the host for the rest of the run: the truthful agent was turned
 * away and nothing here tries another way in.
 *
 * Every decision, cached or not, is appended to data/syllabi/state/fetchlog.jsonl:
 *   {"at":"...","url":"https://math.illinois.edu/document/468","method":"HEAD",
 *    "robots":"allow","rule":"no matching rule","status":302,"outcome":"redirect","cached":false,"ms":212,"source":"math-docs"}
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup, store } from './cache.mjs';
import { DIRS, userAgentFor } from './paths.mjs';
import { ALLOW_ALL, DENY_ALL, decide, groupFor, parseRobots } from './robots.mjs';

const MIN_GAP_MS = 1100;
const MAX_HOSTS_IN_FLIGHT = 4;
const ROBOTS_TTL_MS = 24 * 3600 * 1000;
const MAX_BYTES = 60 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One queue for hosts that are one machine (130.126.151.14 serves all three). */
const ALIAS = {
  'courses.engr.illinois.edu': 'courses.grainger.illinois.edu',
  'courses.physics.illinois.edu': 'courses.grainger.illinois.edu',
};

/**
 * Hosts and paths refused before robots.txt, each with the reason it is logged under.
 * Canvas is not a robots question: robots.txt allows /courses/ but the student
 * has not decided whether Canvas pages may be used at all.
 */
const POLICY = [
  [(u) => u.host === 'canvas.illinois.edu', 'policy:canvas-undecided'],
  [(u) => /(^|\.)boxcloud\.com$/.test(u.host), 'policy:box-preview-route'],
  // Box: only the shared-link pages robots.txt allows (/s/{id}, /s/{id}/folder/{n},
  // /s/{id}/file/{n}, /v/{name}), which list names and links. /shared/static/{hash}.pdf
  // is allowed by robots.txt but is the file itself, and "?dl=1" or "download" in
  // the query asks for the file; the student has not agreed to download Box files.
  [(u) => /(^|\.)box\.com$/.test(u.host) && (!/^\/(s|v)\//.test(u.pathname) || /download|[?&]dl=/i.test(u.search) || /\/download\b/.test(u.pathname)), 'policy:box-download'],
  [(u) => /(^|\.)(coursehero\.com|studocu\.com|opensyllabus\.org|quizlet\.com|chegg\.com)$/.test(u.host), 'policy:paywall-or-aggregator'],
  [(u) => /(^|\.)(bookstore\.illinois\.edu|illinibookstore\.com|online\.uillinois\.edu)$/.test(u.host), 'policy:bot-wall'],
  [(u) => isLogin(u), 'login'],
];

const LOGIN_HOSTS = /(^|\.)(login\.microsoftonline\.com|shibboleth\.illinois\.edu|idp\.illinois\.edu|account\.box\.com|login\.illinois\.edu|discovery\.illinois\.edu|sso\.illinois\.edu)$/i;
const LOGIN_PATHS = /(^\/login\b|\/saml_login|\/Shibboleth\.sso|\/auth\/saml2sso|\/idp\/profile|\/cas\/login|\/saml2?\/|\/wp-login\.php|\/user\/login|\/oauth2?\/authorize)/i;
function isLogin(u) {
  return LOGIN_HOSTS.test(u.host) || u.host.endsWith('.account.box.com') || LOGIN_PATHS.test(u.pathname) || (u.host === 'canvas.illinois.edu' && u.pathname.startsWith('/login'));
}

/** The minimum spacing for the next request to this URL's host. */
function gapFor(u, crawlDelay) {
  let gap = MIN_GAP_MS;
  if (u.host === 'web.archive.org') gap = u.pathname.startsWith('/cdx/') ? 5000 : 3000;
  if (crawlDelay != null) gap = Math.max(gap, crawlDelay * 1000);
  return gap;
}

// ---------------------------------------------------------------------------

const state = new Map(); // bucket -> { chain, lastAt, pausedUntil, streak429, streak403, stopped }
function hostState(bucket) {
  if (!state.has(bucket)) state.set(bucket, { chain: Promise.resolve(), lastAt: 0, pausedUntil: 0, streak5xx: 0, streak403: 0, stopped: null });
  return state.get(bucket);
}

let permits = MAX_HOSTS_IN_FLIGHT;
const waiters = [];
async function acquire() {
  if (permits > 0) { permits -= 1; return; }
  await new Promise((r) => waiters.push(r));
}
function release() {
  const next = waiters.shift();
  if (next) next(); else permits += 1;
}

/** Run fn in the host's queue, after its spacing and any pause, holding one global permit. */
function enqueue(u, crawlDelay, fn) {
  const bucket = ALIAS[u.host] ?? u.host;
  const hs = hostState(bucket);
  const run = hs.chain.then(async () => {
    const wait = Math.max(hs.lastAt + gapFor(u, crawlDelay) - Date.now(), hs.pausedUntil - Date.now(), 0);
    if (wait) await sleep(wait);
    await acquire();
    try { return await fn(hs); } finally { hs.lastAt = Date.now(); release(); }
  });
  hs.chain = run.catch(() => {});
  return run;
}

function log(row) {
  mkdirSync(DIRS.state, { recursive: true });
  appendFileSync(join(DIRS.state, 'fetchlog.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
}

// ---------------------------------------------------------------------------
// robots.txt

const robotsMem = new Map();

/**
 * The parsed robots.txt for an origin. 404/410 -> no rules. Any other 4xx,
 * any 5xx, a network failure or a redirect into a login -> disallow all.
 * Up to five redirects are followed, as RFC 9309 asks.
 */
function robotsFor(origin) {
  // The promise is cached, not the result, so four tasks asking at once for
  // the same host cause one robots.txt request, not four.
  if (!robotsMem.has(origin)) robotsMem.set(origin, loadRobots(origin));
  return robotsMem.get(origin);
}

async function loadRobots(origin) {
  const file = join(DIRS.state, 'robots', `${origin.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]/gi, '_')}.json`);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - Date.parse(saved.fetchedAt) < ROBOTS_TTL_MS) {
      const parsed = saved.verdict === 'rules' ? parseRobots(saved.text) : saved.verdict === 'allow-all' ? ALLOW_ALL : DENY_ALL;
      return { parsed, verdict: saved.verdict, status: saved.status };
    }
  }
  let url = `${origin}/robots.txt`;
  let verdict = 'deny-all';
  let status = null;
  let text = '';
  for (let hop = 0; hop <= 5; hop += 1) {
    const u = new URL(url);
    const res = await enqueue(u, null, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const r = await fetch(url, { headers: { 'user-agent': userAgentFor(u.host) }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
          return { status: r.status, location: r.headers.get('location'), text: r.status === 200 ? await r.text() : '' };
        } catch (e) {
          if (attempt === 2) return { status: 0, error: e.message };
          await sleep(3000 * (attempt + 1));
        }
      }
      return { status: 0 };
    });
    status = res.status;
    log({ url, method: 'GET', robots: 'n/a', status, outcome: 'robots.txt', cached: false });
    if (status >= 300 && status < 400 && res.location) {
      const next = new URL(res.location, url);
      if (isLogin(next)) { verdict = 'deny-all'; break; }
      url = next.href;
      continue;
    }
    if (status === 200) { verdict = 'rules'; text = res.text; } else if (status === 404 || status === 410) verdict = 'allow-all';
    else verdict = 'deny-all';
    break;
  }
  // A network failure denies the host for this run only; persisting it would
  // lock the host out for a day over one dropped connection.
  if (status) {
    mkdirSync(join(DIRS.state, 'robots'), { recursive: true });
    writeFileSync(file, JSON.stringify({ origin, fetchedAt: new Date().toISOString(), status, verdict, text }, null, 1));
  }
  const parsed = verdict === 'rules' ? parseRobots(text) : verdict === 'allow-all' ? ALLOW_ALL : DENY_ALL;
  return { parsed, verdict, status };
}

/** { allowed, rule, crawlDelay, reason } for one URL: policy first, then robots.txt. */
export async function permission(url) {
  const u = new URL(url);
  for (const [test, reason] of POLICY) if (test(u)) return { allowed: false, rule: reason, reason };
  const hs = hostState(ALIAS[u.host] ?? u.host);
  if (hs.stopped) return { allowed: false, rule: hs.stopped, reason: `stopped:${hs.stopped}` };
  const robots = await robotsFor(u.origin);
  const d = decide(robots.parsed, url);
  const reason = robots.verdict === 'deny-all' ? `robots:${robots.status || 'unreachable'}-means-deny` : d.allowed ? null : 'robots';
  return { allowed: d.allowed, rule: d.rule, crawlDelay: groupFor(robots.parsed).crawlDelay, reason };
}

// ---------------------------------------------------------------------------

function retryAfterMs(h) {
  const v = h.get('retry-after');
  if (!v) return null;
  if (/^\d+$/.test(v)) return Math.min(Number(v) * 1000, 15 * 60_000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.min(Math.max(t - Date.now(), 0), 15 * 60_000) : null;
}

/**
 * Answer from the cache when the cache is definitive for this URL: a 200, a
 * 404/410, a login redirect, or a redirect whose target is itself cached.
 * With follow false a cached 3xx is the answer (an ID walk wants the Location).
 */
function fromCache(url, method, follow, depth = 0) {
  const hit = lookup(url, method);
  if (!hit || depth > 5) return null;
  if (hit.status === 200) return { ...hit, outcome: 'ok' };
  if (hit.status === 404 || hit.status === 410) return { ...hit, outcome: 'not-found' };
  if (hit.note === 'login') return { ...hit, outcome: 'login' };
  if (hit.status >= 300 && hit.status < 400 && hit.location) {
    if (!follow) return { ...hit, outcome: 'redirect' };
    const next = fromCache(new URL(hit.location, url).href, method, follow, depth + 1);
    return next ? { ...next, redirectedFrom: url } : null;
  }
  return null;
}

/**
 * Offline mode answers from the cache only: a miss comes back as outcome
 * "offline" and nothing, not even robots.txt, touches the network. Stage 1
 * tuning and every rebuild run this way (--offline or SYLLABI_OFFLINE=1).
 */
let OFFLINE = process.env.SYLLABI_OFFLINE === '1';
export const setOffline = (on) => { OFFLINE = !!on; };
export const isOffline = () => OFFLINE;

/**
 * GET (or HEAD) one URL politely. Never throws for HTTP outcomes.
 *
 * opts: { method: 'GET'|'HEAD', follow: true, revalidate: false, maxAgeDays, source, accept }
 *   follow: false returns the 3xx itself (the Drupal /document/{id} walks
 *   read the Location header and never download the file).
 *   maxAgeDays: an index page changes every term, a syllabus PDF never does,
 *   so adapters pass maxAgeDays for their index pages (app.sib's /courses/all
 *   at 7) and nothing for documents; an older cached 200 is then revalidated
 *   with If-None-Match / If-Modified-Since instead of trusted forever.
 *
 * Returns { url, finalUrl, status, outcome, contentType, disposition, bodyPath, cached, rule }
 *   outcome: ok | not-found | redirect | login | robots | policy | forbidden | error | throttled | too-large | offline
 */
export async function get(url, opts = {}) {
  const method = opts.method ?? 'GET';
  const follow = opts.follow ?? true;
  const source = opts.source ?? null;

  let revalidate = !!opts.revalidate;
  if (!revalidate || OFFLINE) {
    const hit = fromCache(url, method, follow);
    const stale = hit && opts.maxAgeDays != null && Date.now() - Date.parse(hit.fetchedAt) > opts.maxAgeDays * 86_400_000;
    if (hit && !(stale && !OFFLINE)) {
      log({ url, method, robots: 'cached', status: hit.status, outcome: hit.outcome, cached: true, source });
      return { ...hit, url, finalUrl: hit.url, cached: true };
    }
    if (stale) revalidate = true;
  }
  if (OFFLINE) {
    log({ url, method, robots: 'n/a', status: null, outcome: 'offline', cached: false, source });
    return { url, finalUrl: url, status: null, outcome: 'offline', cached: false };
  }
  opts = { ...opts, revalidate };

  let current = url;
  for (let hop = 0; hop <= 5; hop += 1) {
    const perm = await permission(current);
    if (!perm.allowed) {
      const outcome = perm.reason === 'login' ? 'login' : perm.reason?.startsWith('policy:') ? 'policy' : perm.reason?.startsWith('stopped:') ? 'forbidden' : 'robots';
      log({ url: current, method, robots: 'disallow', rule: perm.rule, status: null, outcome, cached: false, source });
      if (outcome === 'login' && current !== url) store(url, null, { status: 302, location: current, note: 'login' }, method);
      return { url, finalUrl: current, status: null, outcome, rule: perm.rule, cached: false };
    }
    const u = new URL(current);
    const prior = opts.revalidate ? lookup(current, method) : null;
    const res = await enqueue(u, perm.crawlDelay, (hs) => fetchOnce(current, method, prior, hs, opts));
    log({ url: current, method, robots: 'allow', rule: perm.rule, status: res.status, outcome: res.outcome, cached: false, ms: res.ms, source });

    if (res.outcome === 'redirect' && res.location) {
      const next = new URL(res.location, current);
      if (isLogin(next)) {
        store(current, null, { status: res.status, location: next.href, note: 'login' }, method);
        return { url, finalUrl: next.href, status: res.status, outcome: 'login', cached: false };
      }
      store(current, null, { status: res.status, location: next.href }, method);
      if (!follow) return { url, finalUrl: next.href, status: res.status, outcome: 'redirect', location: next.href, cached: false };
      current = next.href;
      continue;
    }
    if (res.status === 304 && prior) {
      // Unchanged: keep the body, move fetchedAt forward so maxAgeDays counts from now.
      const body = prior.bodyPath && existsSync(prior.bodyPath) ? readFileSync(prior.bodyPath) : null;
      const rec = store(current, body, { ...prior, fetchedAt: undefined, via: 'revalidated-304' }, method);
      return { ...rec, url, finalUrl: current, cached: true, outcome: 'ok' };
    }
    if (res.outcome === 'ok' || res.outcome === 'not-found') {
      const rec = store(current, res.body, { status: res.status, contentType: res.contentType, finalUrl: current, disposition: res.disposition, lastModified: res.lastModified, etag: res.etag, bytes: res.bytes }, method);
      if (current !== url) store(url, null, { status: 301, location: current, note: 'redirect-chain' }, method);
      return { ...rec, url, finalUrl: current, outcome: res.outcome, cached: false };
    }
    return { url, finalUrl: current, status: res.status, outcome: res.outcome, error: res.error, cached: false };
  }
  return { url, finalUrl: current, status: null, outcome: 'error', error: 'too many redirects', cached: false };
}

export const head = (url, opts = {}) => get(url, { ...opts, method: 'HEAD', follow: opts.follow ?? false });

/** One network attempt sequence inside the host queue: retries, backoff, pauses. */
async function fetchOnce(url, method, prior, hs, opts) {
  const u = new URL(url);
  const wayback = u.host === 'web.archive.org';
  const maxTries = wayback ? 6 : 3;
  const headers = { 'user-agent': userAgentFor(u.host), accept: opts.accept ?? '*/*' };
  if (prior?.etag) headers['if-none-match'] = prior.etag;
  if (prior?.lastModified) headers['if-modified-since'] = prior.lastModified;
  let lastErr = null;
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      const ms = Date.now() - t0;
      const meta = {
        status: r.status,
        ms,
        contentType: r.headers.get('content-type'),
        disposition: r.headers.get('content-disposition'),
        lastModified: r.headers.get('last-modified'),
        etag: r.headers.get('etag'),
        location: r.headers.get('location'),
      };
      if (r.status >= 300 && r.status < 400 && r.status !== 304) { hs.streak5xx = 0; hs.streak403 = 0; return { ...meta, outcome: 'redirect' }; }
      if (r.status === 304) return { ...meta, outcome: 'ok' };
      if (r.status === 404 || r.status === 410) { hs.streak5xx = 0; hs.streak403 = 0; await r.arrayBuffer().catch(() => null); return { ...meta, outcome: 'not-found', body: null, bytes: 0 }; }
      if (r.status === 403) {
        const challenge = r.headers.get('cf-mitigated') || (/cloudflare/i.test(r.headers.get('server') ?? '') && /challenge|captcha/i.test(await r.text().catch(() => '')));
        hs.streak403 += 1;
        if (challenge) hs.stopped = 'bot-wall';
        else if (hs.streak403 >= 3) hs.stopped = 'forbidden-to-truthful-agent';
        return { ...meta, outcome: 'forbidden' };
      }
      const len = Number(r.headers.get('content-length') ?? -1);
      // Course Explorer's "not now" is a 202 with an empty body: a throttle,
      // not a page. Read as a page it once emptied a whole term of offerings.
      let early = null;
      if (r.status === 202 && method === 'GET') {
        early = Buffer.from(await r.arrayBuffer());
        if (early.length >= 500) meta.status = 200;
      }
      const throttled = r.status === 429 || r.status >= 500 || (r.status === 202 && (method === 'HEAD' || early.length < 500));
      if (throttled) {
        hs.streak5xx += 1;
        if (hs.streak5xx >= 3) hs.pausedUntil = Date.now() + 10 * 60_000;
        const wait = retryAfterMs(r.headers) ?? (wayback && r.status === 503 ? 60_000 : 3000 * 2 ** attempt);
        lastErr = `HTTP ${r.status}`;
        if (attempt < maxTries - 1) { await sleep(Math.max(wait, hs.pausedUntil - Date.now(), 0)); continue; }
        return { ...meta, outcome: 'throttled', error: lastErr };
      }
      if (!r.ok) return { ...meta, outcome: 'error', error: `HTTP ${r.status}` };
      hs.streak5xx = 0;
      hs.streak403 = 0;
      if (method === 'HEAD') return { ...meta, outcome: 'ok', body: null, bytes: len > 0 ? len : 0 };
      // A Box shared-link page is HTML that lists files. If Box ever answers a
      // listing URL with the file itself (application/pdf), drop it unread:
      // listing is what the student agreed to, downloading is not.
      if (/(^|\.)box\.com$/.test(u.host) && !/html|json/i.test(meta.contentType ?? '')) {
        await r.body?.cancel();
        return { ...meta, outcome: 'policy', error: 'box answered with a file, not a listing' };
      }
      if (len > MAX_BYTES) { await r.body?.cancel(); return { ...meta, outcome: 'too-large' }; }
      const body = early ?? Buffer.from(await r.arrayBuffer());
      return { ...meta, outcome: 'ok', body, bytes: body.length };
    } catch (e) {
      lastErr = e.message;
      if (attempt < 2) await sleep(3000 * (attempt + 1));
      else return { status: 0, outcome: 'error', error: lastErr, ms: Date.now() - t0 };
    }
  }
  return { status: 0, outcome: 'error', error: lastErr };
}

/** Hosts stopped or paused during this run, for the run report. */
export function hostReport() {
  return [...state.entries()].filter(([, s]) => s.stopped || s.pausedUntil > Date.now()).map(([h, s]) => ({ host: h, stopped: s.stopped, pausedUntil: s.pausedUntil ? new Date(s.pausedUntil).toISOString() : null }));
}
