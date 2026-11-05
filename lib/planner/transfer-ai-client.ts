/**
 * The browser's half of the transfer checker's last step (transfer-ai.ts):
 * the lines nothing else settled go to /api/transfer-match, in batches, and
 * the answers are applied here against the catalog. Any failure leaves the
 * record as it was (those lines stay "not yet evaluated").
 */
import { applyDecisions, unsettledLines, type AiSchool, type TransferDecision } from './transfer-ai';
import type { CatalogLite } from './transfer-match';
import type { TranscriptRecord } from './transcript';

const BATCH = 40;

export async function refineTransfers(record: TranscriptRecord, catalog: CatalogLite[], school: AiSchool): Promise<TranscriptRecord> {
  const lines = unsettledLines(record, catalog, school);
  if (lines.length === 0 || catalog.length === 0) return record;
  const batches: (typeof lines)[] = [];
  for (let i = 0; i < lines.length; i += BATCH) batches.push(lines.slice(i, i + BATCH));
  const answers = await Promise.all(batches.map(async (batch) => {
    try {
      const res = await fetch('/api/transfer-match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, from: record.institution, lines: batch }),
      });
      if (!res.ok) return [] as TransferDecision[];
      const json = (await res.json()) as { decisions?: TransferDecision[] };
      return Array.isArray(json.decisions) ? json.decisions : [];
    } catch {
      return [] as TransferDecision[];
    }
  }));
  return applyDecisions(record, lines, answers.flat(), catalog, school);
}
