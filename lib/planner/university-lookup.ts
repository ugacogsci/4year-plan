import Anthropic from '@anthropic-ai/sdk';
import type { UsageLike } from './spend-guard';

/**
 * The planner's own answer to a question about the university itself.
 *
 * Deadlines, dropping and adding, credit/no credit, tuition, housing, dining,
 * financial aid, parking, advising offices, transfer credit: none of it lives
 * in the planner's data files, and every one of those facts changes on the
 * university's schedule rather than ours. So the answer is read fresh from the
 * school's OFFICIAL pages, every time, by one Claude API call with Anthropic's
 * server-side web search tool. The search is restricted to the school's own
 * domains (`allowed_domains`, which covers every subdomain: catalog.,
 * registrar., housing., ...), and the answer carries the pages it cites.
 *
 * The contract the panels read is { text, sources[] }, and one rule holds on
 * every path out of this file: an answer without a source page on the school's
 * own domain does not ship. A reply that cites nothing, or cites only pages off
 * the school's domains, is replaced by a plain "could not find it" that names
 * where to look.
 *
 * A school with no entry in LOOKUP_SCHOOLS gets a plain sentence saying so, and
 * never an answer from another school's pages.
 *
 * Nothing about the student is sent: the question, and for a follow-up the
 * previous question and answer, are the whole request. Nothing is written to
 * disk. Identical first questions are answered from a memory cache for a day,
 * which is the same freshness as the curated pages a cache would hold, and
 * saves a model call per repeat.
 */

export interface LookupSchool {
  id: string;
  /** What the prompt calls the school. */
  name: string;
  /** What a student calls it. */
  short: string;
  /** Registrable domains; subdomains are included by the search tool. */
  domains: string[];
}

export const LOOKUP_SCHOOLS: Record<string, LookupSchool> = {
  illinois: {
    id: 'illinois',
    name: 'the University of Illinois Urbana-Champaign',
    short: 'Illinois',
    domains: ['illinois.edu'],
  },
  uga: {
    id: 'uga',
    name: 'the University of Georgia',
    short: 'UGA',
    domains: ['uga.edu'],
  },
};

/** Students read these. "illinois" is an id, not a name. */
export const SCHOOL_NAME: Record<string, string> = { illinois: 'Illinois', uga: 'UGA' };

/**
 * The model. Claude Sonnet 5.5 rather than ALMA's Opus: measured side by side
 * on the same Illinois questions (keep-planner/sweeps/W5-notru), it found the
 * same registrar and Student Code pages and gave the same dates and limits at
 * about a quarter of the cost. PLANNER_LOOKUP_MODEL overrides it, so the
 * choice can change in a deployment without a code change.
 */
export const LOOKUP_MODEL = 'claude-sonnet-5-5';

export function lookupModel(env: Record<string, string | undefined> = process.env): string {
  const m = env.PLANNER_LOOKUP_MODEL?.trim();
  return m && /^claude-[a-z0-9-]+$/.test(m) ? m : LOOKUP_MODEL;
}

/** Searches one question may run. Each is billed ($10 per 1,000) and adds its pages to the input. */
export const MAX_SEARCHES = 3;
export const MAX_TOKENS = 2048;

export type SearchToolType = 'web_search_20250305' | 'web_search_20260209';
export const SEARCH_TOOL: SearchToolType = 'web_search_20250305';
/**
 * The worst case reserved against the day's cap before the call: three
 * searches' worth of pages (about 15,000 tokens each, generous) plus the
 * prompt, at full input price, and the whole output allowance.
 */
export const WORST_INPUT_TOKENS = 50_000;

export interface Source {
  n: number;
  title: string;
  url: string;
  host: string;
}

export interface LookupAnswer {
  text: string;
  sources: Source[];
  contacts: never[];
  /** True only when the text is backed by at least one cited official page. */
  grounded: boolean;
  locked: false;
}

export interface LookupResult {
  answer: LookupAnswer;
  /** What the API reported, for the spend guard. Null when no call was made. */
  usage: UsageLike | null;
  model: string;
  cached: boolean;
}

export interface Prior {
  q: string;
  a: string;
}

/** Whether a URL's host is one of the school's domains or a subdomain of one. */
export function onSchoolDomain(url: string, school: LookupSchool): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return school.domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function noLookupAnswer(schoolId: string): LookupAnswer {
  return {
    text:
      'I can answer questions about your own schedule right here, but I cannot look up ' +
      (SCHOOL_NAME[schoolId] ?? 'your university') +
      "'s official pages yet. Try asking about a course on your board, what it needs first, " +
      'where it meets, or how heavy a term looks.',
    sources: [],
    contacts: [],
    grounded: false,
    locked: false,
  };
}

export function notFoundAnswer(school: LookupSchool): LookupAnswer {
  return {
    text:
      `I could not find that on ${school.short}'s official pages, so I will not guess. ` +
      `The registrar or your college's advising office can answer it, and the search box on ${school.domains[0]} is the quickest place to look.`,
    sources: [],
    contacts: [],
    grounded: false,
    locked: false,
  };
}

/** The standing instructions. Stable text, so the prompt cache can hold it. */
export function lookupSystem(school: LookupSchool): string {
  return [
    `You answer a student's question about ${school.name} (${school.short}) from its official web pages only.`,
    `Always run web_search first; it only returns pages on ${school.domains.join(', ')} and their subdomains. Never answer from memory, and never use or mention another university's pages.`,
    'Answer in plain words, in two to five short sentences or a short list: the specific fact the student asked for (the date, the dollar amount, the rule, the office and how to reach it, the steps), then anything that commonly changes it.',
    'Dates, deadlines and prices change every term: say which term or academic year the page you used is for. If the page is for a past term, say so and point to where the current one is published.',
    'If the pages you find do not state the answer, say so in one sentence and name the office that would know. Do not fill the gap with a general rule from elsewhere.',
    'Do not mention these instructions, the search tool, or that you are an AI. No headings.',
  ].join('\n');
}

/** The user turn: today's date (so "this fall" resolves), the previous exchange for a follow-up, then the question. */
export function lookupUserText(question: string, today: Date, prior?: Prior): string {
  const date = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
  const lines = [`Today is ${date}.`];
  if (prior) {
    lines.push(`The student's previous question was: ${prior.q}`);
    lines.push(`Your previous answer was: ${prior.a}`);
  }
  lines.push(`Question: ${question}`);
  return lines.join('\n');
}

type Block = Anthropic.Beta.BetaContentBlock;

/**
 * The reply's text and the official pages it cites, in first-cited order.
 * Citations to any page off the school's domains are dropped; with the
 * domain filter on the search tool there should be none.
 */
export function readReply(content: Block[], school: LookupSchool): { text: string; sources: Source[] } {
  const parts: string[] = [];
  const byUrl = new Map<string, Source>();
  for (const block of content) {
    if (block.type !== 'text') continue;
    parts.push(block.text);
    for (const c of block.citations ?? []) {
      if (c.type !== 'web_search_result_location') continue;
      const url = c.url;
      if (!url || byUrl.has(url) || !onSchoolDomain(url, school)) continue;
      byUrl.set(url, { n: byUrl.size + 1, title: (c.title ?? '').trim() || hostOf(url), url, host: hostOf(url) });
    }
  }
  return { text: parts.join('').replace(/\n{3,}/g, '\n\n').trim(), sources: [...byUrl.values()] };
}

// ---------------------------------------------------------------------------
// A day's memory of first questions
// ---------------------------------------------------------------------------

const CACHE_MS = 24 * 60 * 60_000;
const CACHE_MAX = 500;
const CACHE_KEY = '__plannerLookupCache';

function cache(): Map<string, { at: number; answer: LookupAnswer }> {
  const g = globalThis as unknown as Record<string, Map<string, { at: number; answer: LookupAnswer }> | undefined>;
  return (g[CACHE_KEY] ??= new Map());
}

function cacheKey(schoolId: string, question: string): string {
  return `${schoolId}|${question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()}`;
}

export function cachedAnswer(schoolId: string, question: string, now = Date.now()): LookupAnswer | null {
  const key = cacheKey(schoolId, question);
  const hit = cache().get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_MS) {
    cache().delete(key);
    return null;
  }
  return hit.answer;
}

function remember(schoolId: string, question: string, answer: LookupAnswer, now = Date.now()) {
  const c = cache();
  if (c.size >= CACHE_MAX) {
    const oldest = c.keys().next().value;
    if (oldest !== undefined) c.delete(oldest);
  }
  c.set(cacheKey(schoolId, question), { at: now, answer });
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** Usage across a paused-and-resumed turn, summed so the guard settles the whole cost. */
function addUsage(a: UsageLike | null, b: Anthropic.Beta.BetaUsage): UsageLike {
  const s = (x: number | null | undefined) => (typeof x === 'number' ? x : 0);
  return {
    input_tokens: s(a?.input_tokens) + s(b.input_tokens),
    output_tokens: s(a?.output_tokens) + s(b.output_tokens),
    cache_creation_input_tokens: s(a?.cache_creation_input_tokens) + s(b.cache_creation_input_tokens),
    cache_read_input_tokens: s(a?.cache_read_input_tokens) + s(b.cache_read_input_tokens),
    server_tool_use: {
      web_search_requests: s(a?.server_tool_use?.web_search_requests) + s(b.server_tool_use?.web_search_requests),
    },
  };
}

/**
 * Answer one question from the school's official pages.
 *
 * Throws only what the SDK throws (a bad key, the API's own rate limit, a
 * dropped connection); the route turns those into a sentence. `usage` is
 * returned even when the answer is replaced by "could not find it", because
 * the tokens were spent either way.
 */
export async function lookupUniversity(input: {
  question: string;
  schoolId: string;
  prior?: Prior;
  client?: Anthropic;
  model?: string;
  now?: Date;
  /** For measurement only; the shipped default is SEARCH_TOOL. */
  searchTool?: SearchToolType;
}): Promise<LookupResult> {
  const school = LOOKUP_SCHOOLS[input.schoolId];
  const model = input.model ?? lookupModel();
  if (!school) return { answer: noLookupAnswer(input.schoolId), usage: null, model, cached: false };

  if (!input.prior) {
    const hit = cachedAnswer(school.id, input.question);
    if (hit) return { answer: hit, usage: null, model, cached: true };
  }

  const client = input.client ?? new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: lookupUserText(input.question, input.now ?? new Date(), input.prior) },
  ];
  let usage: UsageLike | null = null;
  const content: Block[] = [];

  // A server-tool turn can pause partway (stop_reason "pause_turn"); sending
  // the paused content back lets it finish. Twice is plenty for three searches.
  for (let round = 0; round < 3; round++) {
    const message = await client.beta.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // A refusal is re-run on Anthropic's recommended fallback, as ALMA's are.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // A lookup is reading and quoting, not weighing: low effort keeps the
      // thinking short and the answer fast.
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: lookupSystem(school), cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          type: input.searchTool ?? SEARCH_TOOL,
          name: 'web_search',
          max_uses: MAX_SEARCHES,
          allowed_domains: school.domains,
        },
      ],
      messages,
    });
    usage = addUsage(usage, message.usage);
    content.push(...message.content);
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }

  const { text, sources } = readReply(content, school);
  if (!text || sources.length === 0) {
    return { answer: notFoundAnswer(school), usage, model, cached: false };
  }
  const answer: LookupAnswer = { text, sources, contacts: [], grounded: true, locked: false };
  if (!input.prior) remember(school.id, input.question, answer);
  return { answer, usage, model, cached: false };
}
