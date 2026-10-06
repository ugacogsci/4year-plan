/**
 * One polite GET against the Course Explorer, shared by schedule.mjs and
 * offerings.mjs so the two crawlers cannot drift apart again.
 *
 * The Course Explorer answers a burst of requests with HTTP 202 and an empty
 * body, which is a polite "busy, try later" rather than a page. Treated as a
 * page it reads as "no courses" or "no sections": offerings.mjs once emptied a
 * whole season that way, and schedule.mjs saved such replies as courses with
 * no sections and skipped them without a word. So a busy reply (a 202, or a
 * 200 too short to be a real page) backs off, doubling from fifteen seconds,
 * and only gives up after about eight minutes. A 404 is a real answer and
 * comes back as null at once.
 *
 * Returns the page text, or null when the page does not exist or the site
 * stayed busy through every wait. Callers must count a null as "not read",
 * never as "empty".
 *
 * POLITE_WAIT_SCALE shrinks the waits for a test against a local mock server;
 * it is never set for a real crawl.
 */

export const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';

/** Back-off after a busy or failed reply, in ms: 15 s, 30 s, 1 min, 2 min, 4 min. */
export const WAITS = [15_000, 30_000, 60_000, 120_000, 240_000];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCALE = Number(process.env.POLITE_WAIT_SCALE ?? 1) || 1;

/** A real Course Explorer page is tens of KB; a busy reply is empty or a few bytes. */
const MIN_PAGE_BYTES = 500;

export async function politeGet(url, { waits = WAITS, timeoutMs = 40_000, log = console.log } = {}) {
  for (let a = 0; a <= waits.length; a += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return null;
      const text = await res.text();
      if (res.status === 202 || (res.ok && text.length < MIN_PAGE_BYTES)) throw new Error(`busy (HTTP ${res.status}, ${text.length} bytes)`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return text;
    } catch (e) {
      if (a === waits.length) { log(`  ${url}: gave up: ${e.message}`); return null; }
      const wait = Math.round(waits[a] * SCALE);
      log(`  ${url}: ${e.message}; waiting ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  return null;
}
