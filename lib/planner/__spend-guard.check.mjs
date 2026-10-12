/**
 * Spending protection (spend-guard.ts), with a fake clock and no API call.
 *
 * What this pins:
 *   - the per-visitor short-window and daily limits, counted per route, and
 *     a refusal that does not itself count as a request;
 *   - the daily spend cap: the worst case is reserved before a call, settled
 *     to the reported usage after, kept when a call failed mid-way, and the
 *     day (Champaign time) resets everything;
 *   - PLANNER_DAILY_SPEND_USD: a typo never switches the cap off, 0 stops all;
 *   - the request-size cap reads a body only up to its limit;
 *   - every refusal is a sentence a student can act on.
 *
 *   node lib/planner/__spend-guard.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const G = await import(join(HERE, 'spend-guard.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));

// Noon in Champaign on a Sunday in October (17:00 UTC, daylight time).
const NOON = Date.parse('2026-10-11T17:00:00Z');
const clock = (start = NOON) => {
  let t = start;
  return { now: () => t, add: (ms) => { t += ms; } };
};
const ALMA = { who: 'ALMA' };
const free = (guard, route = 'advisor', visitor = '1.1.1.1') => guard.admit(route, visitor, { model: 'claude-opus-5', estimateUsd: 0, capUsd: null, names: ALMA });

console.log('\n=== 1. Per-visitor limits ===\n');
{
  const c = clock();
  const g = new G.SpendGuard({ now: c.now });
  const L = G.LIMITS.advisor;
  let admitted = 0;
  for (let i = 0; i < L.perWindow; i += 1) if (free(g).ok) admitted += 1;
  expect(admitted === L.perWindow, `${L.perWindow} ALMA steps in the window are admitted`, String(admitted));
  const no = free(g);
  expect(!no.ok && no.status === 429 && no.reason === 'window', 'the next one waits', JSON.stringify(no));
  expect(!no.ok && /ALMA needs a short break/.test(no.error) && /Try again in about \d+ minutes?/.test(no.error) && no.retryAfter > 0, 'the wait is a sentence with a time', no.error);
  expect(free(g, 'advisor', '2.2.2.2').ok, 'another visitor is not held up');
  expect(free(g, 'transcript', '1.1.1.1').ok, 'another route keeps its own count');
  c.add(L.windowMs + 1);
  expect(free(g).ok, 'after the window passes, the visitor is admitted again');

  // The daily limit, with the window kept open by spacing requests out.
  const c2 = clock();
  const g2 = new G.SpendGuard({ now: c2.now });
  const T = G.LIMITS.transcript;
  let n = 0;
  for (let i = 0; i < T.perDay; i += 1) { if (free(g2, 'transcript').ok) n += 1; c2.add(Math.ceil(T.windowMs / T.perWindow) + 1); }
  expect(n === T.perDay, `${T.perDay} readings a day are admitted when spaced out`, String(n));
  const day = free(g2, 'transcript');
  expect(!day.ok && day.reason === 'day' && /today's limit/.test(day.error) && /midnight \(Central time\)/.test(day.error), 'the next reading waits for tomorrow', JSON.stringify(day));
  c2.add(24 * 3_600_000);
  expect(free(g2, 'transcript').ok, 'a new day forgets the count');

  // A refusal is not counted: a visitor told to wait is admitted as soon as the window allows.
  const c3 = clock();
  const g3 = new G.SpendGuard({ now: c3.now });
  for (let i = 0; i < L.perWindow; i += 1) free(g3);
  for (let i = 0; i < 50; i += 1) free(g3);
  c3.add(L.windowMs + 1);
  expect(free(g3).ok, 'refused requests do not extend the wait');
}

console.log('\n=== 2. The daily spend cap ===\n');
{
  const c = clock();
  const g = new G.SpendGuard({ now: c.now });
  const admit = (estimateUsd, visitor = 'v') => g.admit('advisor', visitor, { model: 'claude-opus-5', estimateUsd, capUsd: 1, names: ALMA });
  const a = admit(0.6, 'a');
  expect(a.ok, 'a call under the cap runs');
  const b = admit(0.6, 'b');
  expect(!b.ok && b.status === 503 && b.reason === 'spend', 'a second worst case that would pass the cap waits, while the first is in flight', JSON.stringify(b));
  expect(!b.ok && /ALMA has done all it can for today/.test(b.error) && /back tomorrow/.test(b.error), 'the cap is a friendly sentence', b.error);
  // The first call really cost 0.1: 10,000 input and 2,000 output tokens on claude-opus-5 (5 and 25 per million).
  a.settle({ input_tokens: 10_000, output_tokens: 2_000 });
  const spent = g.spentToday();
  expect(Math.abs(spent.spent - 0.1) < 1e-9 && spent.reserved === 0, 'settled to the reported usage', JSON.stringify(spent));
  const b2 = admit(0.6, 'b');
  expect(b2.ok, 'with the reservation released, the second call runs');
  b2.settle(null, { keepReservation: true });
  expect(Math.abs(g.spentToday().spent - 0.7) < 1e-9, 'a call that failed mid-way keeps its worst case', JSON.stringify(g.spentToday()));
  b2.settle({ input_tokens: 1 });
  expect(Math.abs(g.spentToday().spent - 0.7) < 1e-9, 'a ticket settles once');
  const d = admit(0.2, 'd');
  expect(d.ok, 'a call that fits what is left runs');
  d.settle(null);
  expect(Math.abs(g.spentToday().spent - 0.7) < 1e-9, 'a call refused before any tokens costs nothing');
  expect(!admit(0.31, 'e').ok, 'a call past what is left waits');
  c.add(24 * 3_600_000);
  expect(admit(0.9, 'e').ok && g.spentToday().spent === 0, 'a new day starts from zero');

  // The cache price counts: 100,000 cached reads and 10,000 cache writes on claude-opus-5.
  const cost = G.costUsd('claude-opus-5', { cache_read_input_tokens: 100_000, cache_creation_input_tokens: 10_000 });
  expect(Math.abs(cost - (0.05 + 0.0625)) < 1e-9, 'cache reads and writes are priced', String(cost));
  expect(G.priceOf('a-model-not-listed').output >= Math.max(...Object.values(G.MODEL_PRICES).map((p) => p.output)), 'an unknown model is priced as the dearest');
  expect(G.worstCaseUsd('claude-opus-5', 3_000, 4_096) === (3_000 * 5 + 4_096 * 25) / 1e6, 'the worst case is full input price plus the whole output allowance');
  expect(G.tokensForChars(10) === 4 && G.tokensForChars(0) === 0, 'about three characters a token, rounded up');
  // The day turns at midnight in Champaign, not UTC: 11 PM Central is already the next day in UTC.
  const c4 = clock(Date.parse('2026-10-12T03:30:00Z'));
  const g4 = new G.SpendGuard({ now: c4.now });
  g4.admit('advisor', 'v', { model: 'claude-opus-5', estimateUsd: 0.5, capUsd: 1, names: ALMA }).settle(null, { keepReservation: true });
  c4.add(60 * 60_000);
  expect(g4.spentToday().spent === 0.5, 'still the same day at 11:30 PM Central');
  c4.add(60 * 60_000);
  expect(g4.spentToday().spent === 0, 'the cap resets at midnight Central');
}

console.log('\n=== 3. PLANNER_DAILY_SPEND_USD ===\n');
{
  const cap = (v) => G.dailyCapUsd(v === undefined ? {} : { PLANNER_DAILY_SPEND_USD: v });
  expect(cap(undefined) === G.DEFAULT_DAILY_SPEND_USD && cap('') === G.DEFAULT_DAILY_SPEND_USD, 'unset: the default cap');
  expect(cap('40') === 40 && cap(' 7.5 ') === 7.5, 'a number is the cap');
  expect(cap('0') === 0, '0 stops every call');
  expect(cap('-3') === G.DEFAULT_DAILY_SPEND_USD && cap('ten') === G.DEFAULT_DAILY_SPEND_USD && cap('Infinity') === G.DEFAULT_DAILY_SPEND_USD, 'a typo never switches the cap off');
  const g = new G.SpendGuard({ now: clock().now });
  const zero = g.admit('advisor', 'v', { model: 'claude-opus-5', estimateUsd: 0.01, capUsd: 0, names: ALMA });
  expect(!zero.ok && zero.reason === 'spend', 'a cap of 0 refuses the first call');
}

console.log('\n=== 4. Who is asking ===\n');
{
  const h = (o) => ({ get: (k) => o[k] ?? null });
  expect(G.visitorKey(h({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' })) === '9.9.9.9', 'Cloudflare\'s address first');
  expect(G.visitorKey(h({ 'x-forwarded-for': '1.1.1.1, 10.0.0.1' })) === '1.1.1.1', 'the client end of x-forwarded-for');
  expect(G.visitorKey(h({})) === 'unknown', 'no address: one shared bucket');
}

console.log('\n=== 5. The request-size cap ===\n');
{
  const req = (body, headers = {}) => new Request('http://planner.test/api/advisor', { method: 'POST', body, headers });
  expect((await G.readBodyCapped(req('{"a":1}'), 100)) === '{"a":1}', 'a small body is read whole');
  expect((await G.readBodyCapped(req('x'.repeat(101)), 100)) === null, 'a body past the cap is refused');
  expect((await G.readBodyCapped(req('{}', { 'content-length': '5000' }), 100)) === null, 'a declared length past the cap is refused before reading');
  // A streamed body with no declared length stops being read at the cap.
  let pulled = 0;
  const stream = new ReadableStream({ pull(c) { pulled += 1; if (pulled > 1000) c.close(); else c.enqueue(new TextEncoder().encode('y'.repeat(64))); } });
  const streamed = new Request('http://planner.test/api/transcript', { method: 'POST', body: stream, duplex: 'half' });
  expect((await G.readBodyCapped(streamed, 640)) === null && pulled < 20, 'a streamed body is abandoned at the cap', String(pulled));
  expect((await G.readBodyCapped(req('é'.repeat(10)), 100)) === 'é'.repeat(10), 'multi-byte text survives the read');
  expect(G.parseJson('{"x":2}').x === 2 && G.parseJson('not json') === null, 'parseJson returns null for a bad body');
  expect(G.LIMITS.advisor.maxBodyBytes <= 2_000_000 && G.LIMITS.ask.maxBodyBytes <= 64_000 && G.LIMITS.transcript.maxBodyBytes >= 30_000_000, 'each route has its own size cap (the reader takes its 30 MB of files)');
}

console.log('\n=== 6. Every route that calls the model is guarded ===\n');
{
  const { readFileSync } = await import('node:fs');
  for (const route of ['advisor', 'transcript', 'ask']) {
    const src = readFileSync(join(HERE, '..', '..', 'app', 'api', route, 'route.ts'), 'utf8');
    expect(/readBodyCapped\(req, LIMITS\.\w+\.maxBodyBytes\)/.test(src) && /sharedGuard\(\)\.admit\(/.test(src) && !/req\.json\(/.test(src), `/api/${route}: size cap and guard before any work`);
    if (route !== 'ask') expect(/capUsd: dailyCapUsd\(\)/.test(src) && /ticket\.settle\(/.test(src), `/api/${route}: the spend cap reserves and settles`);
  }
}

console.log(`\n${failures === 0 ? 'ALL SPEND GUARD CHECKS PASSED' : `${failures} SPEND GUARD CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
