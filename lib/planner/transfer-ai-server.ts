/**
 * The one model call behind /api/transfer-match (transfer-ai.ts), shared with
 * the bench (scripts/dev/transfer-bench.mjs --ai) so both run the same words.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { DECISION_SYSTEM, decisionPrompt, TransferDecisions, type AiLine, type AiSchool, type TransferDecision } from './transfer-ai';

/** Classification over a short list: Sonnet 5.5 at medium effort, about 2 to 4 cents a transcript. */
export const TRANSFER_AI_MODEL = 'claude-sonnet-5-5';
export const TRANSFER_AI_MAX_TOKENS = 12000;

export async function decideTransfers(client: Anthropic, school: AiSchool, from: string | null, lines: AiLine[], signal?: AbortSignal): Promise<{ decisions: TransferDecision[]; usage: Anthropic.Usage; stop: string | null }> {
  const response = await client.messages.parse({
    model: TRANSFER_AI_MODEL,
    max_tokens: TRANSFER_AI_MAX_TOKENS,
    system: DECISION_SYSTEM,
    messages: [{ role: 'user', content: decisionPrompt(school, from, lines) }],
    output_config: { effort: 'medium', format: zodOutputFormat(TransferDecisions) },
  }, { signal, timeout: 120000 });
  return { decisions: response.parsed_output?.decisions ?? [], usage: response.usage, stop: response.stop_reason };
}
