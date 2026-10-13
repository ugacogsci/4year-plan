import type Anthropic from '@anthropic-ai/sdk';
import { ADVISOR_MODEL, ADVISOR_TOOLS, advisorSystem, type AdvisorMessage } from './advisor';
import { termDatesBlock } from './term-dates';

/**
 * The request /api/advisor sends to the model for one step of ALMA's loop,
 * built here so lib/planner/__advisor-request.check.mjs can pin its shape
 * without calling the API.
 *
 * Why this order (cost). The API keeps the opening of a request for five
 * minutes and bills a later request that starts with the same bytes at a
 * tenth of the input price (prompt caching; a twentieth on Opus 5.5). A mark
 * (cache_control) says where a reusable opening ends, and a mark only pays
 * off when every byte before it is the same as last time. The browser re-sends
 * the whole conversation on every step, up to 12 steps a question, so:
 *
 *   1. the tools and the fixed instructions come first, with a mark: the same
 *      for every student and every step;
 *   2. then the conversation so far, with a mark on its last block: the next
 *      step and the next question only add to it, so they reuse all of it;
 *   3. last, after both marks, what changes from step to step: today's
 *      Illinois term dates and the board as it is now, attached to the newest
 *      user message.
 *
 * The dates and the board used to sit in the system prompt, ahead of the
 * conversation, so the conversation could never be reused and was billed in
 * full on every step. The model reads the same text as before; only its place
 * changed. Nothing is stored: the browser never sees the attached block, so
 * the next step attaches a fresh one to the new newest message.
 *
 * MERGE-UGA: ARCH (UGA) gets the same order, without the Illinois dates
 * (needs owner decision: Cameron's call; the commit before this one kept
 * ARCH on its old request).
 */

/** The tools a non-Illinois (UGA) student's assistant gets. */
const UGA_TOOLS = new Set([
  'search_courses',
  'course_details',
  'term_summary',
  'add_course',
  'remove_course',
  'replace_course',
  'move_course',
  'planner_answer',
  'university_answer',
]);

export const ADVISOR_MAX_TOKENS = 4096;

/**
 * Opens the block attached to the newest user message, so the model never
 * takes the planner's text for the student's words.
 */
export const PLANNER_CONTEXT = '[Planner context] Written by the planner for this step, not by the student.';

/**
 * The model ALMA runs on: PLANNER_ADVISOR_MODEL when it names a Claude model,
 * otherwise ADVISOR_MODEL. A typo falls back to the default rather than
 * sending a name the API would refuse.
 */
export function advisorModel(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): string {
  const raw = (env.PLANNER_ADVISOR_MODEL ?? '').trim();
  return /^claude-[a-z0-9-]{1,60}$/.test(raw) ? raw : ADVISOR_MODEL;
}

/**
 * Models that bind each thinking block to the exact conversation before it
 * (Anthropic's "preserved thinking"): on newer accounts they refuse a request
 * whose earlier messages changed. Attaching the board to the newest message
 * and dropping it next step is such a change, so for these models the
 * earlier steps' thinking blocks are left out, the same way on every step
 * (which keeps the cache valid). Claude Opus 5, the default, does not bind
 * them and keeps its earlier thinking.
 */
const BINDS_THINKING = /^claude-(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)/;

export function bindsThinking(model: string): boolean {
  return BINDS_THINKING.test(model);
}

export interface AdvisorRequestInput {
  model: string;
  bot: string;
  schoolName: string;
  schoolShort: string;
  /** The board description the browser wrote for this step. */
  board: string;
  /** The conversation as the browser holds it; never modified here. */
  messages: AdvisorMessage[];
  /** For the Illinois term dates. */
  now: Date;
}

const isIllinois = (schoolName: string) => /illinois/i.test(schoolName);

/** The step's changing text: Illinois term dates (Illinois only), then the board. */
export function stepContextBlocks(input: Pick<AdvisorRequestInput, 'board' | 'schoolName' | 'now'>): Anthropic.Beta.BetaTextBlockParam[] {
  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [];
  // Illinois registrar dates, for an Illinois student only.
  if (isIllinois(input.schoolName)) blocks.push({ type: 'text', text: `${PLANNER_CONTEXT}\n\n${termDatesBlock(input.now)}` });
  blocks.push({ type: 'text', text: `${blocks.length === 0 ? `${PLANNER_CONTEXT}\n\n` : ''}The board right now:\n\n${input.board}` });
  return blocks;
}

/**
 * The conversation as sent: every message copied (the caller's are left as
 * they are), any cache mark a client put on a block removed, text-only
 * messages written as one text block so they read the same whether or not
 * they are the newest, earlier thinking dropped for models that bind it, a
 * mark on the last block of the conversation, and the step's context
 * attached after it.
 */
export function messagesForStep(
  messages: AdvisorMessage[],
  context: Anthropic.Beta.BetaContentBlockParam[],
  model: string,
): AdvisorMessage[] {
  const dropThinking = bindsThinking(model);
  const out: AdvisorMessage[] = messages.map((m) => {
    const blocks: Anthropic.Beta.BetaContentBlockParam[] =
      typeof m.content === 'string'
        ? [{ type: 'text', text: m.content }]
        : m.content
            .filter((b) => !(dropThinking && (b.type === 'thinking' || b.type === 'redacted_thinking')))
            .map((b) => {
              if (!('cache_control' in b)) return b;
              const { cache_control: _mark, ...rest } = b as typeof b & { cache_control?: unknown };
              return rest as Anthropic.Beta.BetaContentBlockParam;
            });
    return { ...m, content: blocks };
  });
  // An assistant turn left with nothing (thinking only) is dropped rather than sent empty.
  const sent = out.filter((m) => typeof m.content === 'string' || m.content.length > 0);
  const last = sent[sent.length - 1];
  if (last && typeof last.content !== 'string' && last.content.length > 0) {
    const blocks = last.content;
    const end = blocks[blocks.length - 1];
    if (end.type !== 'thinking' && end.type !== 'redacted_thinking') {
      blocks[blocks.length - 1] = { ...end, cache_control: { type: 'ephemeral' } } as Anthropic.Beta.BetaContentBlockParam;
    }
  }
  if (last && last.role === 'user' && typeof last.content !== 'string') {
    last.content = [...last.content, ...context];
  } else {
    // The loop always ends on a user message; if not, the context is a user message of its own.
    sent.push({ role: 'user', content: context });
  }
  return sent;
}

/** Everything one step sends; the route passes it to the SDK's stream(), which adds the streaming flag. */
export function advisorRequest(input: AdvisorRequestInput): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const illinois = isIllinois(input.schoolName);
  return {
    ...commonParams(input.model),
    system: [{ type: 'text', text: advisorSystem(input.bot, input.schoolName, input.schoolShort), cache_control: { type: 'ephemeral' } }],
    tools: illinois ? ADVISOR_TOOLS : ADVISOR_TOOLS.filter((tool) => UGA_TOOLS.has(tool.name)),
    messages: messagesForStep(input.messages, stepContextBlocks(input), input.model),
  };
}

/** What every step sends whichever the school: the model and how it should answer. */
function commonParams(
  model: string,
): Pick<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, 'model' | 'max_tokens' | 'betas' | 'fallbacks' | 'output_config'> {
  return {
    model,
    max_tokens: ADVISOR_MAX_TOKENS,
    // A refusal is re-run on Anthropic's recommended fallback for its
    // category rather than handed to the student as a dead end.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // Adaptive thinking is on by default on this model. High effort,
    // because the student asks this bot to weigh a schedule: which of
    // two courses, whether a move breaks a chain, what a term costs
    // them. The tools carry the facts; the reasoning over them is the
    // job. Streaming keeps the wait honest.
    output_config: { effort: 'high' },
  };
}
