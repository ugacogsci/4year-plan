import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { dailyCapUsd, LIMITS, parseJson, readBodyCapped, sharedGuard, tokensForChars, visitorKey, worstCaseUsd, WEB_SEARCH_USD } from '@/lib/planner/spend-guard';
import {
  cachedAnswer,
  LOOKUP_SCHOOLS,
  lookupModel,
  lookupSystem,
  lookupUniversity,
  MAX_SEARCHES,
  MAX_TOKENS,
  noLookupAnswer,
  WORST_INPUT_TOKENS,
} from '@/lib/planner/university-lookup';

/**
 * The answer endpoint for questions about the university itself.
 *
 * ALMA's university_answer tool posts here. Anything the planner can answer
 * from the files already in the browser was answered there first
 * (lib/planner/ask-router.ts decides that), so what arrives is a genuine
 * university question: a deadline, a policy, an office, a price.
 *
 * It is answered by the planner's own lookup (lib/planner/university-lookup.ts):
 * one Claude API call whose web search is restricted to the school's official
 * domains. The contract is deliberately narrow, and it is the contract that
 * matters more than the implementation: { text, sources[] }. An answer without
 * the official page it came from does not ship. A school with no lookup says
 * so rather than answering from a different university's pages.
 *
 * The call spends money on the planner's Anthropic key, so it passes the same
 * spend guard as ALMA (lib/planner/spend-guard.ts): a 16 KB body cap, a
 * per-visitor rate limit, and the day's dollar cap (PLANNER_DAILY_SPEND_USD),
 * reserved at its worst case before the call and settled to what it cost.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const empty = { text: '', sources: [], contacts: [], grounded: false, locked: false };

export async function POST(req: Request) {
  const raw = await readBodyCapped(req, LIMITS.ask.maxBodyBytes);
  if (raw === null) {
    return NextResponse.json({ error: 'That question is too long. Ask it in a few sentences.' }, { status: 413 });
  }
  const body = (parseJson(raw) ?? {}) as {
    question?: unknown;
    school?: unknown;
    prior?: unknown;
  };
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 1000) : '';
  /** The previous exchange, for a follow-up: the question and the answer it got. */
  const p = body.prior as { q?: unknown; a?: unknown } | null | undefined;
  const prior =
    p && typeof p === 'object' && typeof p.q === 'string' && typeof p.a === 'string'
      ? { q: p.q.slice(0, 400), a: p.a.slice(0, 1000) }
      : undefined;

  if (!question) {
    return NextResponse.json({ error: 'Ask something.' }, { status: 400 });
  }

  const school = typeof body.school === 'string' ? body.school : '';
  const lookup = LOOKUP_SCHOOLS[school];

  // This reaches a student, so it says what they can do, not what an operator can.
  if (!lookup || !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(noLookupAnswer(school));
  }

  // A repeat of a question already answered today costs nothing and is not counted.
  if (!prior) {
    const hit = cachedAnswer(lookup.id, question);
    if (hit) return NextResponse.json(hit);
  }

  const model = lookupModel();
  const admitted = sharedGuard().admit('ask', visitorKey(req.headers), {
    model,
    estimateUsd:
      worstCaseUsd(model, WORST_INPUT_TOKENS + tokensForChars(raw.length + lookupSystem(lookup).length), MAX_TOKENS) +
      MAX_SEARCHES * WEB_SEARCH_USD,
    capUsd: dailyCapUsd(),
    names: { who: 'The university lookup' },
  });
  if (!admitted.ok) {
    return NextResponse.json(
      { ...empty, error: admitted.error },
      { status: admitted.status, headers: { 'retry-after': String(admitted.retryAfter) } },
    );
  }

  try {
    const result = await lookupUniversity({ question, schoolId: lookup.id, prior, model });
    admitted.settle(result.usage);
    return NextResponse.json(result.answer);
  } catch (error) {
    // A 4xx from the API was refused before any tokens were made. Anything else
    // (an overload, a dropped connection) may have spent some: keep the worst case.
    const rejected = error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status < 500;
    admitted.settle(null, { keepReservation: !rejected });
    return NextResponse.json(
      {
        ...empty,
        text:
          error instanceof Anthropic.RateLimitError
            ? 'The university lookup is busy right now. Try again in a minute; the planner above still works.'
            : 'The university lookup did not respond. The planner above still works.',
      },
      { status: 200 },
    );
  }
}
