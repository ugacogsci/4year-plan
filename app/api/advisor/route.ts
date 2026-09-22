import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { ADVISOR_MODEL, ADVISOR_TOOLS, advisorSystem, type AdvisorMessage } from '@/lib/planner/advisor';

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
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MAX_MESSAGES = 120;
const MAX_BOARD_CHARS = 24_000;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'The advisor is not set up on this server. Add ANTHROPIC_API_KEY to .env.local and restart.' },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; board?: unknown; bot?: unknown };
  const messages = Array.isArray(body.messages) ? (body.messages as AdvisorMessage[]) : [];
  const board = typeof body.board === 'string' ? body.board.slice(0, MAX_BOARD_CHARS) : '';
  // The bot's name is the school's, and a name is all it may be.
  const bot = typeof body.bot === 'string' && /^[A-Za-z][A-Za-z .'-]{0,23}$/.test(body.bot) ? body.bot : 'the assistant';
  if (messages.length === 0 || messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: 'Send between 1 and 120 messages.' }, { status: 400 });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
      return NextResponse.json({ error: 'Each message needs a role of user or assistant.' }, { status: 400 });
    }
  }

  const client = new Anthropic();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const run = client.beta.messages.stream({
          model: ADVISOR_MODEL,
          max_tokens: 4096,
          // A refusal is re-run on Anthropic's recommended fallback for its
          // category rather than handed to the student as a dead end.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          // Adaptive thinking is on by default on this model. Medium effort:
          // the tools carry the correctness, and a reply that takes a minute
          // is not a conversation.
          output_config: { effort: 'medium' },
          system: [
            { type: 'text', text: advisorSystem(bot), cache_control: { type: 'ephemeral' } },
            { type: 'text', text: `The board right now:\n\n${board}` },
          ],
          tools: ADVISOR_TOOLS,
          messages,
        });
        for await (const event of run) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            send({ type: 'text', delta: event.delta.text });
          }
        }
        const message = await run.finalMessage();
        send({
          type: 'final',
          message: {
            content: message.content,
            stop_reason: message.stop_reason,
            stop_details: message.stop_reason === 'refusal' ? (message.stop_details ?? null) : null,
          },
        });
      } catch (error) {
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
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
}
