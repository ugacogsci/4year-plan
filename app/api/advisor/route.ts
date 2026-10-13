import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { ADVISOR_TOOLS, advisorSystem, type AdvisorMessage } from '@/lib/planner/advisor';
import { ADVISOR_MAX_TOKENS, advisorModel, advisorRequest } from '@/lib/planner/advisor-request';
import { dailyCapUsd, LIMITS, parseJson, readBodyCapped, sharedGuard, tokensForChars, visitorKey, worstCaseUsd } from '@/lib/planner/spend-guard';

/**
 * One step of the advisor's loop.
 *
 * The browser sends the whole transcript and a description of the board as it
 * is right now; this runs a single model call with the advisor's tools and
 * streams it back: text as it is written, then the complete message so the
 * browser can execute any tool calls and come back for the next step. Nothing
 * is stored here. The board never reaches the model except as the text the
 * browser wrote for it, and the API key never reaches the browser.
 *
 * Streamed rather than returned whole because a step can take a while, and a
 * panel that sits blank for fifteen seconds reads as broken.
 *
 * Every step passes the spend guard first (lib/planner/spend-guard.ts): a
 * size cap on the body, a per-visitor rate limit, and the day's spend cap
 * (PLANNER_DAILY_SPEND_USD). A refusal is a sentence the panel prints.
 *
 * The request itself is built by lib/planner/advisor-request.ts, which puts
 * the board and the term dates after the conversation so each step reuses
 * the conversation at the cache price. PLANNER_ADVISOR_MODEL picks the model.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MAX_MESSAGES = 120;
const MAX_BOARD_CHARS = 24_000;
/** The system prompt and the tool list, in characters, for the worst-case estimate. */
const FIXED_CHARS = advisorSystem('ALMA').length + JSON.stringify(ADVISOR_TOOLS).length;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'The advisor is not set up on this server. Add ANTHROPIC_API_KEY to .env.local and restart.' },
      { status: 503 },
    );
  }
  const raw = await readBodyCapped(req, LIMITS.advisor.maxBodyBytes);
  if (raw === null) {
    return NextResponse.json(
      { error: 'This conversation has grown too long to send in one go. Press New chat to start a fresh one; your plan stays as it is.' },
      { status: 413 },
    );
  }
  const body = (parseJson(raw) ?? {}) as {
    messages?: unknown;
    board?: unknown;
    bot?: unknown;
    schoolName?: unknown;
    schoolShort?: unknown;
  };
  const messages = Array.isArray(body.messages) ? (body.messages as AdvisorMessage[]) : [];
  const board = typeof body.board === 'string' ? body.board.slice(0, MAX_BOARD_CHARS) : '';
  // The bot's name is the school's, and a name is all it may be.
  const bot = typeof body.bot === 'string' && /^[A-Za-z][A-Za-z .'-]{0,23}$/.test(body.bot) ? body.bot : 'the assistant';
  const schoolName =
    typeof body.schoolName === 'string' && /^[A-Za-z][A-Za-z &.'-]{1,79}$/.test(body.schoolName)
      ? body.schoolName
      : 'selected university';
  const schoolShort =
    typeof body.schoolShort === 'string' && /^[A-Za-z][A-Za-z &.'-]{0,39}$/.test(body.schoolShort)
      ? body.schoolShort
      : schoolName;
  if (messages.length === 0 || messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: 'Send between 1 and 120 messages.' }, { status: 400 });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
      return NextResponse.json({ error: 'Each message needs a role of user or assistant.' }, { status: 400 });
    }
  }

  const model = advisorModel();
  const admitted = sharedGuard().admit('advisor', visitorKey(req.headers), {
    model,
    // A cold step writes the whole conversation to the cache, at the cache-write price.
    estimateUsd: worstCaseUsd(model, tokensForChars(raw.length + FIXED_CHARS), ADVISOR_MAX_TOKENS, { cacheWrites: true }),
    capUsd: dailyCapUsd(),
    names: { who: bot === 'the assistant' ? 'The assistant' : bot },
  });
  if (!admitted.ok) {
    return NextResponse.json({ error: admitted.error }, { status: admitted.status, headers: { 'retry-after': String(admitted.retryAfter) } });
  }
  const ticket = admitted;

  const client = new Anthropic();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const run = client.beta.messages.stream(
          advisorRequest({ model, bot, schoolName, schoolShort, board, messages, now: new Date() }),
        );
        for await (const event of run) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            send({ type: 'text', delta: event.delta.text });
          }
        }
        const message = await run.finalMessage();
        ticket.settle(message.usage);
        send({
          type: 'final',
          message: {
            content: message.content,
            stop_reason: message.stop_reason,
            stop_details: message.stop_reason === 'refusal' ? (message.stop_details ?? null) : null,
          },
        });
      } catch (error) {
        // A 4xx from the API (a bad key, its own rate limit) was refused before any tokens were made. Anything else
        // (an overload or a dropped connection mid-stream, thinking included) may have spent some: keep the worst case.
        const rejected = error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status < 500;
        ticket.settle(null, { keepReservation: !rejected });
        const text =
          error instanceof Anthropic.AuthenticationError
            ? 'The advisor cannot sign in to its model. Check ANTHROPIC_API_KEY.'
            : error instanceof Anthropic.RateLimitError
              ? 'The advisor is getting a lot of questions right now. Try again in a minute.'
              : error instanceof Anthropic.APIError
                ? `The advisor's model answered ${error.status}: ${error.message}`
                : error instanceof Error
                  ? error.message
                  : 'The advisor failed.';
        send({ type: 'error', error: text });
      } finally {
        // A no-op when the step already settled; otherwise the worst case stays counted.
        ticket.settle(null, { keepReservation: true });
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
}
