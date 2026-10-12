/**
 * Spending protection for the routes that call the Claude API.
 *
 * ALMA (/api/advisor) and the transcript reader (/api/transcript) spend money
 * on the planner's Anthropic key every time they run, and before this file
 * nothing stopped one visitor, or a script, from running up the bill. Three
 * guards, checked before a model call is made:
 *
 *   1. A per-visitor rate limit: so many requests in a short window, and so
 *      many in a day, counted by the visitor's IP address.
 *   2. A request-size cap: the body is read up to a byte limit and refused
 *      past it, before it is parsed or sent anywhere.
 *   3. A daily spend cap in US dollars, from PLANNER_DAILY_SPEND_USD (default
 *      25). Every call reserves its worst case before it runs and settles to
 *      what the API reports it used afterwards, so calls in flight at the same
 *      time cannot jointly overshoot the cap by more than their estimates.
 *
 * Every refusal carries a sentence a student can act on; the panels already
 * print the route's `error` text as is.
 *
 * Where the counts live: in this server process's memory, and nowhere else.
 * Nothing is written to disk and an IP address is held for at most a day. On
 * a single server the cap is exact. On a host that runs several copies of the
 * server at once (Cloudflare Workers can run many isolates), each copy counts
 * on its own, so the real ceiling is the cap times the number of copies: keep
 * a monthly spend limit on the Anthropic key itself (console.anthropic.com,
 * Limits) as the hard backstop.
 *
 * Pure, with no Next.js imports, so lib/planner/__spend-guard.check.mjs can
 * drive it with a fake clock and never calls the API.
 */

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Writing the prompt cache (5-minute cache: 1.25x input). */
  cacheWrite: number;
  /** Reading the prompt cache (0.1x input). */
  cacheRead: number;
}

/**
 * Anthropic's list prices for the models these routes use. A model missing
 * here is priced as the most expensive row, so a model change never makes the
 * cap more generous by accident.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.4 },
};

const DEAREST: ModelPrice = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };

export function priceOf(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? DEAREST;
}

/** The usage block the Messages API returns (all fields optional here). */
export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** What one response cost, in US dollars, from the usage the API reported. */
export function costUsd(model: string, usage: UsageLike | null | undefined): number {
  if (!usage) return 0;
  const p = priceOf(model);
  return (
    (n(usage.input_tokens) * p.input +
      n(usage.output_tokens) * p.output +
      n(usage.cache_creation_input_tokens) * p.cacheWrite +
      n(usage.cache_read_input_tokens) * p.cacheRead) /
    1_000_000
  );
}

/**
 * The most a call could cost before it runs: every input token at the full
 * input price (no cache discount) and the whole output allowance.
 */
export function worstCaseUsd(model: string, inputTokens: number, maxOutputTokens: number): number {
  const p = priceOf(model);
  return (n(inputTokens) * p.input + n(maxOutputTokens) * p.output) / 1_000_000;
}

/** A rough token count for text: about 3 characters a token, rounded up (generous on purpose). */
export function tokensForChars(chars: number): number {
  return Math.ceil(n(chars) / 3);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_DAILY_SPEND_USD = 25;

/**
 * The daily cap, from PLANNER_DAILY_SPEND_USD. A missing, empty, negative or
 * unreadable value falls back to the default rather than switching the cap
 * off: a typo in a dashboard should never mean "no limit". 0 stops every call.
 */
export function dailyCapUsd(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): number {
  const raw = env.PLANNER_DAILY_SPEND_USD;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_SPEND_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_SPEND_USD;
}

export interface RouteLimits {
  /** Requests one visitor may make in `windowMs`. */
  perWindow: number;
  windowMs: number;
  /** Requests one visitor may make in a day. */
  perDay: number;
  /** Largest request body, in bytes. */
  maxBodyBytes: number;
}

/**
 * One ALMA message is several requests: the browser runs the tool loop and
 * calls /api/advisor once per model step, up to 12 for one message. The
 * window allows a student a brisk conversation (roughly ten messages in ten
 * minutes) and stops a script.
 */
export const LIMITS = {
  advisor: { perWindow: 40, windowMs: 10 * 60_000, perDay: 250, maxBodyBytes: 1_000_000 },
  // The reader takes up to 30 MB of files as base64 (route.ts checks each file).
  transcript: { perWindow: 6, windowMs: 10 * 60_000, perDay: 20, maxBodyBytes: 32_000_000 },
  // The ask bar's proxy to the TRU tenant. TRU's key and caps are its own;
  // this keeps one visitor from hammering it through the planner.
  ask: { perWindow: 30, windowMs: 10 * 60_000, perDay: 300, maxBodyBytes: 16_000 },
} satisfies Record<string, RouteLimits>;

export type RouteName = keyof typeof LIMITS;

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

interface HeaderLike {
  get(name: string): string | null;
}

/**
 * The visitor's address, as the host reports it. Cloudflare sets
 * cf-connecting-ip; other proxies set x-real-ip or x-forwarded-for, whose
 * first entry is the client. Without any of them (a local dev server) every
 * request shares one bucket, which is the safe direction to be wrong in.
 */
export function visitorKey(headers: HeaderLike): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'unknown';
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export interface Refusal {
  ok: false;
  status: 413 | 429 | 503;
  /** The sentence the student sees. */
  error: string;
  /** Seconds until trying again makes sense. */
  retryAfter: number;
  /** For tests and logs: which guard said no. */
  reason: 'window' | 'day' | 'spend' | 'size';
}

export interface Ticket {
  ok: true;
  /**
   * Replace the reservation with what the call really cost. Pass the API's
   * usage; pass null when the call failed before the API reported any, and
   * `keepReservation` when it may have spent tokens without saying how many.
   */
  settle(usage: UsageLike | null, options?: { keepReservation?: boolean }): void;
}

interface Names {
  /** "ALMA", "The transcript reader". */
  who: string;
}

/** The calendar day in Champaign, so the cap resets at midnight for students, not at midnight UTC. */
function dayOf(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

export class SpendGuard {
  private readonly now: () => number;
  private day = '';
  private spent = 0;
  private reserved = 0;
  /** route|visitor -> request times inside the short window. */
  private recent = new Map<string, number[]>();
  /** route|visitor -> requests today. */
  private today = new Map<string, number>();

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** A new day forgets every count and every address. */
  private roll(at: number) {
    const day = dayOf(at);
    if (day === this.day) return;
    this.day = day;
    this.spent = 0;
    this.reserved = 0;
    this.today.clear();
    this.recent.clear();
  }

  /** Dollars settled and reserved today, for tests and the operator. */
  spentToday(): { spent: number; reserved: number } {
    this.roll(this.now());
    return { spent: this.spent, reserved: this.reserved };
  }

  /**
   * Count a request and, when it will call the model, reserve its worst case
   * against the day's cap. Nothing is counted when the answer is no, so a
   * student who is told to wait is not charged a request for being told.
   */
  admit(
    route: RouteName,
    visitor: string,
    input: { model: string; estimateUsd: number; capUsd: number | null; names: Names },
  ): Ticket | Refusal {
    const at = this.now();
    this.roll(at);
    const limits: RouteLimits = LIMITS[route];
    const key = `${route}|${visitor}`;
    const { who } = input.names;

    const windowStart = at - limits.windowMs;
    const times = (this.recent.get(key) ?? []).filter((t) => t > windowStart);
    if (times.length >= limits.perWindow) {
      const wait = Math.ceil((times[0] + limits.windowMs - at) / 1000);
      this.recent.set(key, times);
      return {
        ok: false,
        status: 429,
        retryAfter: wait,
        reason: 'window',
        error: `${who} needs a short break: that is a lot of requests in a few minutes. Try again in about ${minutes(wait)} minute${minutes(wait) === 1 ? '' : 's'}. The rest of the planner keeps working.`,
      };
    }
    const count = this.today.get(key) ?? 0;
    if (count >= limits.perDay) {
      return {
        ok: false,
        status: 429,
        retryAfter: this.secondsToMidnight(at),
        reason: 'day',
        error: `You have reached today's limit for ${who}. It resets at midnight (Central time); your plan and the rest of the planner still work.`,
      };
    }
    const estimate = n(input.estimateUsd);
    if (input.capUsd !== null && this.spent + this.reserved + estimate > input.capUsd) {
      return {
        ok: false,
        status: 503,
        retryAfter: this.secondsToMidnight(at),
        reason: 'spend',
        error: `${who} has done all it can for today across everyone using the planner, and will be back tomorrow. Your plan and the rest of the planner still work.`,
      };
    }

    times.push(at);
    this.recent.set(key, times);
    this.today.set(key, count + 1);
    this.reserved += estimate;
    this.prune(windowStart, limits.windowMs);

    const day = this.day;
    let settled = false;
    const ticket: Ticket = {
      ok: true,
      settle: (usage, options) => {
        if (settled) return;
        settled = true;
        // A reservation from yesterday was cleared at midnight with the rest.
        if (this.day !== day) return;
        this.reserved = Math.max(0, this.reserved - estimate);
        const actual = usage ? costUsd(input.model, usage) : 0;
        this.spent += options?.keepReservation && !usage ? estimate : actual;
      },
    };
    return ticket;
  }

  /** The short-window lists only ever need the last window; drop idle visitors so memory stays small. */
  private prune(windowStart: number, windowMs: number) {
    if (this.recent.size < 5_000) return;
    for (const [key, times] of this.recent) {
      if (times.length === 0 || times[times.length - 1] <= windowStart - windowMs) this.recent.delete(key);
    }
  }

  private secondsToMidnight(at: number): number {
    // Close enough for a Retry-After header: the next day boundary in Chicago is at most 25 hours away.
    let lo = at;
    let hi = at + 25 * 3_600_000;
    const day = dayOf(at);
    while (hi - lo > 60_000) {
      const mid = Math.floor((lo + hi) / 2);
      if (dayOf(mid) === day) lo = mid;
      else hi = mid;
    }
    return Math.max(60, Math.ceil((hi - at) / 1000));
  }
}

/** One guard per server process, shared by every route. */
const GLOBAL_KEY = '__plannerSpendGuard';
export function sharedGuard(): SpendGuard {
  const g = globalThis as unknown as Record<string, SpendGuard | undefined>;
  return (g[GLOBAL_KEY] ??= new SpendGuard());
}

// ---------------------------------------------------------------------------
// Reading a body with a ceiling
// ---------------------------------------------------------------------------

/**
 * The request body as text, or null when it is larger than `maxBytes`. The
 * declared length is checked first; the stream is then read and abandoned the
 * moment it passes the limit, so an oversized body is never held whole.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The body as JSON, or null when it is missing or not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
