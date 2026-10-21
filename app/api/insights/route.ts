import { insightsEnv } from '@/lib/insights/env';
import { erase, ingest, json } from '@/lib/insights/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  const db = insightsEnv().INSIGHTS_DB;
  try {
    if (!db) return json({ enabled: false });
    await db.prepare('SELECT id FROM insight_subjects LIMIT 1').first();
    return json({ enabled: true });
  } catch { return json({ enabled: false }); }
}
export async function POST(req: Request) {
  const db = insightsEnv().INSIGHTS_DB;
  if (!db) return json({ error: 'Analytics is not configured' }, 503);
  try { return await ingest(req, db); } catch { return json({ error: 'Analytics unavailable' }, 503); }
}
export async function DELETE(req: Request) {
  const db = insightsEnv().INSIGHTS_DB;
  if (!db) return json({ error: 'Analytics unavailable' }, 503);
  try { return await erase(req, db); } catch { return json({ error: 'Could not delete data' }, 503); }
}
