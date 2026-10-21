import { insightsEnv } from '@/lib/insights/env';
import { isAdmin, json } from '@/lib/insights/server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const env = insightsEnv();
  if (!await isAdmin(req, env)) return json({ error: 'Unauthorized' }, 401);
  const db = env.INSIGHTS_DB;
  if (!db) return json({ error: 'Analytics is not configured' }, 503);
  const since = Date.now() - 30 * 86400000;
  try {
    const totals = await db.prepare(`SELECT COUNT(DISTINCT subject_id) AS browsers, COUNT(DISTINCT session_id) AS sessions,
      SUM(CASE WHEN name = 'active_time' THEN json_extract(properties, '$.durationMs') ELSE 0 END) AS active_ms
      FROM insight_events WHERE received_at >= ?`).bind(since).first();
    const screens = await db.prepare(`SELECT screen, COUNT(DISTINCT session_id) AS sessions,
      SUM(CASE WHEN name = 'active_time' THEN json_extract(properties, '$.durationMs') ELSE 0 END) AS active_ms
      FROM insight_events WHERE received_at >= ? GROUP BY screen`).bind(since).all();
    const controls = await db.prepare(`SELECT json_extract(properties, '$.control') AS control, COUNT(*) AS clicks,
      COUNT(DISTINCT session_id) AS sessions FROM insight_events WHERE name = 'control_click' AND received_at >= ? GROUP BY control`).bind(since).all();
    const features = await db.prepare(`SELECT json_extract(properties, '$.feature') AS feature,
      COUNT(DISTINCT CASE WHEN name = 'feature_view' THEN session_id END) AS viewed_sessions,
      SUM(CASE WHEN name = 'active_time' THEN json_extract(properties, '$.durationMs') ELSE 0 END) AS active_ms
      FROM insight_events WHERE received_at >= ? AND name IN ('active_time','feature_view') GROUP BY feature`).bind(since).all();
    const geography = await db.prepare('SELECT country, region, COUNT(DISTINCT subject_id) AS browsers FROM insight_events WHERE received_at >= ? GROUP BY country, region').bind(since).all();
    const outcomes = await db.prepare(`SELECT name, json_extract(properties, '$.outcome') AS outcome, COUNT(*) AS count FROM insight_events
      WHERE received_at >= ? AND name IN ('chat_completed','plan_generated','client_error','setup_submitted','plan_change') GROUP BY name, outcome`).bind(since).all();
    const content = new URL(req.url).searchParams.get('content') === '1'
      ? (await db.prepare('SELECT received_at, kind, text FROM insight_content WHERE received_at >= ? ORDER BY received_at DESC LIMIT 100').bind(since).all()).results : undefined;
    return json({ windowDays: 30, note: 'Opted-in browsers only, not all visitors. Active time excludes hidden tabs and 30-second idle periods. Views do not establish usefulness. IDs rotate every 30 days.', totals, screens: screens.results, controls: controls.results, features: features.results, geography: geography.results, outcomes: outcomes.results, content });
  } catch { return json({ error: 'Report unavailable' }, 503); }
}
