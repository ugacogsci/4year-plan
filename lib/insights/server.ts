import { cleanEvent, consentOf, isId, isToken, type InsightEvent } from './schema';

export interface InsightsEnv { INSIGHTS_DB?: D1Database; INSIGHTS_ADMIN_TOKEN?: string; RESEND_API_KEY?: string; FEEDBACK_FROM?: string }
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return origin === new URL(req.url).origin && req.headers.get('sec-fetch-site') !== 'cross-site';
}
export async function bodyJson(req: Request, max = 48000): Promise<unknown> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new Error('Expected JSON');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Missing body');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > max) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(value);
    }
    const data = new Uint8Array(bytes);
    let at = 0;
    for (const part of chunks) { data.set(part, at); at += part.length; }
    return JSON.parse(new TextDecoder().decode(data));
  } finally { reader.releaseLock(); }
}
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
}
export async function isAdmin(req: Request, env: InsightsEnv): Promise<boolean> {
  const wanted = env.INSIGHTS_ADMIN_TOKEN;
  const provided = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!wanted || wanted.length < 32 || !provided || provided.length > 512) return false;
  const a = await hash(wanted), b = await hash(provided);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Isolate-local burst protection plus the durable per-subject cap below. No raw IP is stored.
const requests = new Map<string, { at: number; count: number }>();
export async function allowRequest(req: Request, bucket: string, max: number): Promise<boolean> {
  const now = Date.now();
  for (const [key, entry] of requests) if (now - entry.at >= 600000) requests.delete(key);
  if (requests.size > 5000) return false;
  const key = `${bucket}:${await hash(req.headers.get('cf-connecting-ip') ?? 'local')}`;
  const entry = requests.get(key) ?? { at: now, count: 0 };
  entry.count += 1;
  requests.set(key, entry);
  return entry.count <= max;
}
export async function pruneInsights(db: D1Database, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM insight_events WHERE received_at < ?').bind(now - 90 * 86400000),
    db.prepare('DELETE FROM insight_content WHERE received_at < ?').bind(now - 30 * 86400000),
    db.prepare('DELETE FROM insight_subjects WHERE created_at < ?').bind(now - 180 * 86400000),
  ]);
}
export async function ingest(req: Request, db: D1Database): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed' }, 403);
  if (req.headers.get('sec-gpc') === '1' || req.headers.get('dnt') === '1') return json({ accepted: 0 });
  if (!await allowRequest(req, 'analytics', 120)) return json({ error: 'Please slow down' }, 429);
  let body: Record<string, unknown>;
  try { body = await bodyJson(req) as Record<string, unknown>; } catch { return json({ error: 'Invalid event batch' }, 400); }
  if (!body || !isToken(body.token) || !isId(body.session) || !Array.isArray(body.events) || body.events.length > 20) return json({ error: 'Invalid event batch' }, 400);
  const consent = consentOf(body.consent);
  if (!consent?.usage) return json({ accepted: 0 });
  const events = body.events.map((e) => cleanEvent(e, consent)).filter((e): e is InsightEvent => Boolean(e));
  if (!events.length) return json({ accepted: 0 });
  const subject = await hash(body.token);
  const now = Date.now();
  await db.prepare('INSERT OR IGNORE INTO insight_subjects (id, created_at) VALUES (?, ?)').bind(subject, now).run();
  const row = await db.prepare('SELECT revoked_at FROM insight_subjects WHERE id = ?').bind(subject).first<{ revoked_at: number | null }>();
  if (!row || row.revoked_at !== null) return json({ error: 'Collection withdrawn' }, 410);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM insight_events WHERE subject_id = ? AND received_at >= ?').bind(subject, now - 86400000).first<{ n: number }>();
  if ((count?.n ?? 0) >= 3000) return json({ error: 'Daily event limit reached' }, 429);
  const cf = (req as Request & { cf?: { country?: string; regionCode?: string } }).cf;
  const country = typeof cf?.country === 'string' && /^[A-Z]{2}$/.test(cf.country) ? cf.country : null;
  const region = typeof cf?.regionCode === 'string' && /^[A-Za-z0-9-]{1,8}$/.test(cf.regionCode) ? cf.regionCode : null;
  const statements: D1PreparedStatement[] = [];
  for (const event of events) {
    const { text, ...properties } = event.properties;
    // Conditional inserts also protect against a deletion racing an in-flight batch.
    statements.push(db.prepare(`INSERT OR IGNORE INTO insight_events
      (id, subject_id, session_id, received_at, name, screen, school, properties, country, region, consent_version)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM insight_subjects WHERE id = ? AND revoked_at IS NULL)`)
      .bind(event.id, subject, body.session, now, event.name, event.screen, event.school, JSON.stringify(properties), country, region, consent.version, subject));
    if (event.name === 'content' && typeof text === 'string') statements.push(db.prepare(`INSERT OR IGNORE INTO insight_content
      (id, subject_id, received_at, kind, text) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM insight_subjects WHERE id = ? AND revoked_at IS NULL)`)
      .bind(event.id, subject, now, event.properties.kind, text, subject));
  }
  await db.batch(statements);
  return json({ accepted: events.length });
}
export async function erase(req: Request, db: D1Database) {
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed' }, 403);
  if (!await allowRequest(req, 'delete', 12)) return json({ error: 'Please try again later' }, 429);
  let body: { token?: unknown };
  try { body = await bodyJson(req, 1000) as typeof body; } catch { return json({ error: 'Invalid request' }, 400); }
  if (!body || !isToken(body.token)) return json({ error: 'Invalid request' }, 400);
  const subject = await hash(body.token), now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO insight_subjects (id, created_at, revoked_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revoked_at = excluded.revoked_at').bind(subject, now, now),
    db.prepare('DELETE FROM insight_content WHERE subject_id = ?').bind(subject),
    db.prepare('DELETE FROM insight_events WHERE subject_id = ?').bind(subject),
  ]);
  return json({ deleted: true });
}
