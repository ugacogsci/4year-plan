/**
 * POST /api/transfer-match: the transfer lines nothing else settled, decided
 * in one model call (lib/planner/transfer-ai.ts). The browser sends each
 * line with the target catalog's candidate courses and applies the answer
 * itself, so a code the model makes up is dropped there; this route only
 * checks the shape, the size and the budget.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { decideTransfers, TRANSFER_AI_MAX_TOKENS, TRANSFER_AI_MODEL } from '@/lib/planner/transfer-ai-server';
import { DECISION_SYSTEM } from '@/lib/planner/transfer-ai';
import { aiFailureForLog } from '@/lib/planner/ai-unavailable';
import { dailyCapUsd, LIMITS, readBodyCapped, sharedGuard, tokensForChars, visitorKey, worstCaseUsd } from '@/lib/planner/spend-guard';

const Candidate = z.object({ code: z.string().max(24), title: z.string().max(160), credits: z.number() });
const Input = z.object({
  school: z.enum(['uga', 'illinois']),
  from: z.string().max(160).nullable(),
  lines: z.array(z.object({
    line: z.number().int().min(0).max(500),
    code: z.string().max(40),
    title: z.string().max(200).nullable(),
    credits: z.number().nullable(),
    candidates: z.array(Candidate).max(20),
    subjects: z.array(z.string().max(12)).max(12),
  })).min(1).max(60),
});

export async function POST(req: Request) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (req.headers.get('origin') !== new URL(req.url).origin) return json({ error: 'Open ORION to use this.' }, 403);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'unavailable' }, 503);
  const raw = await readBodyCapped(req, LIMITS.transferMatch.maxBodyBytes);
  if (raw === null) return json({ error: 'Too many lines at once.' }, 413);
  let input: z.infer<typeof Input>;
  try { input = Input.parse(JSON.parse(raw)); } catch { return json({ error: 'Bad request.' }, 400); }
  const ticket = sharedGuard().admit('transferMatch', visitorKey(req.headers), {
    model: TRANSFER_AI_MODEL,
    estimateUsd: worstCaseUsd(TRANSFER_AI_MODEL, tokensForChars(raw.length + DECISION_SYSTEM.length), TRANSFER_AI_MAX_TOKENS),
    capUsd: dailyCapUsd(),
    names: { who: 'The transfer checker' },
  });
  if (!ticket.ok) return json({ error: ticket.error }, ticket.status);
  try {
    const out = await decideTransfers(new Anthropic(), input.school, input.from, input.lines, req.signal);
    ticket.settle(out.usage);
    if (out.stop === 'refusal') return json({ decisions: [] });
    return json({ decisions: out.decisions });
  } catch (error) {
    const rejected = error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status < 500;
    ticket.settle(null, { keepReservation: !rejected });
    console.warn(`[transfer-match] the model call failed: ${aiFailureForLog(error)}`);
    return json({ error: 'unavailable' }, 503);
  }
}
