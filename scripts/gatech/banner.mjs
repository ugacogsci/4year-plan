/**
 * One polite, cached client for Georgia Tech's public Banner 9 course catalog
 * (the "Browse Course Catalog" screen of Student Registration, no login).
 *
 * SOURCE: https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/
 *   term/search?mode=courseSearch               POST, sets the term on the session cookie
 *   courseSearch/get_subject                    GET, subject code <-> description list
 *   courseSearch/get_attribute                  GET, attribute code <-> description list
 *   courseSearchResults/courseSearchResults     GET, catalog rows for a subject or attribute
 *   courseSearchResults/getPrerequisites        POST, the prerequisite table for one course
 *   courseSearchResults/getCorequisites         POST, the corequisite table for one course
 *   (robots.txt on registration.banner.gatech.edu is a 404, so nothing is disallowed;
 *   the detail endpoints answer without a session, the listing needs one.)
 *
 * WRITES: every response to data/gatech-raw/banner-catalog/<term>/<kind>/<key>.<ext> and
 *   nothing else. A cached response is read back with no request, so a parser
 *   change never needs a re-crawl. Delete a file (or pass refresh) to re-ask.
 *
 * HOW TO USE (from scripts/gatech/courses.mjs):
 *   const banner = new Banner({ term: '202608', root: 'data/gatech-raw/banner-catalog' });
 *   const rows = await banner.listing({ subject: 'CS' });
 *   const html = await banner.detail('prereq', 'CS', '1332');
 *
 * POLITENESS: the project's User-Agent (scripts/illinois/polite-get.mjs), one
 *   request at a time and at least GAP_MS (1.3 s) between requests to the host,
 *   a 202, 429 or 5xx (or a reply that is not the shape asked for) backs off
 *   15 s doubling to 4 min, Retry-After honoured. A 401, 403, a redirect off the
 *   Banner host (CAS / SSO login) or a page that reads like a CAPTCHA or
 *   challenge throws BlockedError: the caller stops and reports, never retries
 *   around it.
 *
 * WHAT IT CANNOT KNOW: Banner answers for one term. A prerequisite that changes
 *   in a later term is not seen; the term used is written into every file path.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UA, WAITS, sleep } from '../illinois/polite-get.mjs';

export const HOST = 'registration.banner.gatech.edu';
export const BASE = `https://${HOST}/StudentRegistrationSsb/ssb`;
export const GAP_MS = 1300;

export class BlockedError extends Error {}

const WALL = /captcha|are you a robot|cf-chl|cloudflare ray id|just a moment\.\.\.|access denied|login\.gatech\.edu|sso\.gatech\.edu|\/cas\/login/i;

let lastAt = 0;
async function waitTurn() {
  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

/** File-system-safe key: "CS 1301R" -> "CS_1301R". */
export const keyOf = (...parts) => parts.join('_').replace(/[^A-Za-z0-9_-]+/g, '_');

export class Banner {
  constructor({ term, root, log = console.log, refresh = false, offline = false }) {
    this.term = term;
    this.offline = offline;
    this.root = join(root, term);
    this.log = log;
    this.refresh = refresh;
    this.cookies = new Map();
    this.sessionTerm = null;
    this.requests = 0;
    this.cacheHits = 0;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  keepCookies(res) {
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of set) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      if (at > 0) this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }

  /**
   * One polite request. `accept(body)` says whether the reply is the shape the
   * caller asked for; a 200 that is not (an empty body, an error page) is
   * treated like a busy reply and retried after a wait, never cached.
   */
  async fetchText(path, { method = 'GET', body = null, accept = () => true, waits = WAITS } = {}) {
    const url = `${BASE}${path}`;
    if (this.offline) throw new Error(`offline: ${path} is not cached`);
    for (let a = 0; a <= waits.length; a += 1) {
      await waitTurn();
      this.requests += 1;
      let res;
      let text = '';
      try {
        res = await fetch(url, {
          method,
          headers: {
            'user-agent': UA,
            accept: 'application/json, text/html;q=0.9, */*;q=0.8',
            'x-requested-with': 'XMLHttpRequest',
            ...(body ? { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
            ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
          },
          body: body ?? undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(60_000),
        });
        this.keepCookies(res);
        text = await res.text();
      } catch (e) {
        if (a === waits.length) { this.log(`  ${path}: gave up: ${e.message}`); return null; }
        this.log(`  ${path}: ${e.message}; waiting ${waits[a] / 1000}s`);
        await sleep(waits[a]);
        continue;
      }
      const loc = res.headers.get('location') ?? '';
      if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400 && (/login|cas|sso|saml/i.test(loc) || (loc && !loc.includes(HOST) && /^https?:/i.test(loc))))) {
        throw new BlockedError(`${path}: HTTP ${res.status}${loc ? ` -> ${loc}` : ''}. Looks like a block or a login. Stopping.`);
      }
      if (WALL.test(text.slice(0, 20000)) && !/<section|^\s*[[{]/.test(text)) {
        throw new BlockedError(`${path}: reply reads like a bot wall, CAPTCHA or login page. Stopping.`);
      }
      if (res.status === 404) return null;
      const busy = res.status === 202 || res.status === 429 || res.status >= 500 || (res.status >= 300 && res.status < 400);
      if (busy || !res.ok || !accept(text)) {
        if (a === waits.length) { this.log(`  ${path}: gave up (HTTP ${res.status}, ${text.length} bytes)`); return null; }
        const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
        const wait = Math.max(waits[a], retryAfter);
        this.log(`  ${path}: unexpected reply (HTTP ${res.status}, ${text.length} bytes); waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      return text;
    }
    return null;
  }

  cachePath(kind, key, ext) {
    return join(this.root, kind, `${key}.${ext}`);
  }

  readCache(kind, key, ext) {
    const p = this.cachePath(kind, key, ext);
    if (!this.refresh && existsSync(p)) { this.cacheHits += 1; return readFileSync(p, 'utf8'); }
    return null;
  }

  writeCache(kind, key, ext, text) {
    const p = this.cachePath(kind, key, ext);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }

  /** Puts the term on the session, which the listing endpoints read. */
  async ensureSession() {
    if (this.sessionTerm === this.term) return;
    this.cookies.clear();
    const init = await this.fetchText('/term/termSelection?mode=courseSearch', { accept: (t) => t.length > 200 });
    if (init === null) throw new Error('Banner term page unreachable');
    const set = await this.fetchText('/term/search?mode=courseSearch', {
      method: 'POST',
      body: `term=${this.term}`,
      accept: (t) => /fwdURL|regAllowed|success/i.test(t),
    });
    if (set === null) throw new Error(`Banner would not set term ${this.term}`);
    this.sessionTerm = this.term;
  }

  /** Code/description lists: kind 'subject' or 'attribute'. */
  async lookup(kind) {
    const cached = this.readCache('lookup', kind, 'json');
    if (cached) return JSON.parse(cached);
    const text = await this.fetchText(`/courseSearch/get_${kind}?searchTerm=&term=${this.term}&offset=1&max=1000`, {
      accept: (t) => /^\s*\[/.test(t),
    });
    if (text === null) throw new Error(`Banner ${kind} list unreachable`);
    this.writeCache('lookup', kind, 'json', text);
    return JSON.parse(text);
  }

  /**
   * Every catalog row for one subject or one attribute, all pages. Cached as one
   * file per query once every page is in, so a half-read listing is never
   * mistaken for a whole one.
   */
  async listing({ subject = '', attribute = '' }) {
    const key = subject ? `subject_${keyOf(subject)}` : `attribute_${keyOf(attribute)}`;
    const cached = this.readCache('listing', key, 'json');
    if (cached) return JSON.parse(cached);
    await this.ensureSession();
    const rows = [];
    let total = null;
    let retried = false;
    const size = 500;
    for (let offset = 0; total === null || offset < total; offset += size) {
      // Banner keeps the last search's criteria on the session; resetting first
      // is what stops one subject's rows leaking into the next query.
      await this.fetchText('/courseSearch/resetDataForm', { method: 'POST', body: 'resetCourses=true', accept: () => true });
      const q = new URLSearchParams({
        txt_subject: subject,
        txt_attribute: attribute,
        txt_term: this.term,
        startDatepicker: '',
        endDatepicker: '',
        pageOffset: String(offset),
        pageMaxSize: String(size),
        sortColumn: 'subjectDescription',
        sortDirection: 'asc',
      });
      if (!attribute) q.delete('txt_attribute');
      if (!subject) q.delete('txt_subject');
      const text = await this.fetchText(`/courseSearchResults/courseSearchResults?${q}`, {
        accept: (t) => /^\s*\{/.test(t) && /"success"/.test(t),
      });
      if (text === null) throw new Error(`Banner listing ${key} unreachable at offset ${offset}`);
      const json = JSON.parse(text);
      if (!json.success) {
        // A lost session answers success:false; set the term again, once.
        if (retried) throw new Error(`Banner listing ${key}: success false twice`);
        retried = true;
        this.sessionTerm = null;
        await this.ensureSession();
        offset -= size;
        continue;
      }
      total = json.totalCount ?? 0;
      rows.push(...(json.data ?? []));
      if (!json.data?.length) break;
    }
    const out = { term: this.term, query: { subject, attribute }, totalCount: total, fetchedAt: new Date().toISOString(), rows };
    this.writeCache('listing', key, 'json', JSON.stringify(out));
    return out;
  }

  /**
   * The prerequisite ('prereq') or corequisite ('coreq') section for one course.
   * `waits` shortens the back-off for a caller that keeps its own circuit
   * breaker: getRestrictions answers one course with HTTP 500 every time, and
   * the full 8-minute back-off per such course would stall the crawl.
   */
  async detail(kind, subject, number, { waits } = {}) {
    const key = keyOf(subject, number);
    const cached = this.readCache(kind, key, 'html');
    if (cached !== null) return cached;
    const endpoint = { prereq: 'getPrerequisites', coreq: 'getCorequisites', attribute: 'getCourseAttributes', restriction: 'getRestrictions' }[kind];
    if (!endpoint) throw new Error(`unknown detail kind ${kind}`);
    const text = await this.fetchText(`/courseSearchResults/${endpoint}`, {
      method: 'POST',
      body: new URLSearchParams({ term: this.term, subjectCode: subject, courseNumber: number }).toString(),
      accept: (t) => /<section\b/i.test(t),
      ...(waits ? { waits } : {}),
    });
    if (text === null) return null;
    this.writeCache(kind, key, 'html', text);
    return text;
  }
}
