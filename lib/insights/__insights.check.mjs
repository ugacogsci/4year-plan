import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export const env = {};', shortCircuit: true };
  if (spec.startsWith('@/')) spec = ${JSON.stringify(pathToFileURL(process.cwd() + '/').href)} + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$/.test(spec)) return next(spec + '.ts', ctx);
  return next(spec, ctx);
}`));
const { cleanEvent, cleanFeedback, feedbackText, FEEDBACK_EMAIL } = await import('./schema.ts');
const { ingest, erase, hash, pruneInsights, isAdmin } = await import('./server.ts');
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../../migrations/0001_insights.sql', import.meta.url), 'utf8'));
const db = {
  prepare(query) {
    let params = [];
    const statement = {
      bind(...values) { params = values; return statement; },
      async run() { return sql.prepare(query).run(...params); },
      async first() { return sql.prepare(query).get(...params) ?? null; },
      async all() { return { results: sql.prepare(query).all(...params) }; },
    };
    return statement;
  },
  async batch(statements) { const results = []; for (const statement of statements) results.push(await statement.run()); return results; },
};
const consent = { version: 1, usage: true, content: false };
const token = 'a'.repeat(64), session = crypto.randomUUID();
const event = (name = 'control_click', properties = { control: 'plan.rebuild' }) => ({ id: crypto.randomUUID(), name, screen: 'planner', school: 'uga', properties });
const request = (body, options = {}) => new Request('https://orion.test/api/insights', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://orion.test', ...options.headers },
  body: JSON.stringify(body), ...options,
});
const batch = (events, overrides = {}) => ({ token, session, consent, events, ...overrides });
const count = (table) => sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

assert.equal(cleanEvent(event('made_up'), consent), null);
assert.equal(cleanEvent(event('content', { kind: 'chat', text: 'private' }), consent), null);
const clean = cleanEvent(event('control_click', { control: 'plan.rebuild', transcript: 'secret', message: 'secret', url: 'https://private', name: 'student' }), consent);
assert.deepEqual(clean.properties, { control: 'plan.rebuild' });
assert.equal((await ingest(request(batch([event()], { consent: { ...consent, usage: false } })), db)).status, 200);
assert.equal(count('insight_events'), 0);
assert.equal((await ingest(request(batch([event()]), { headers: { origin: 'https://attacker.test', 'content-type': 'application/json' } }), db)).status, 403);
assert.equal((await ingest(request(batch([event()]), { headers: { origin: 'https://orion.test', 'content-type': 'application/json', 'sec-gpc': '1' } }), db)).status, 200);
assert.equal(count('insight_events'), 0);
assert.equal((await ingest(request(batch(Array.from({ length: 21 }, () => event()))), db)).status, 400);
assert.equal((await ingest(request({ x: 'x'.repeat(50000) }), db)).status, 400);

const click = event();
const geoRequest = request(batch([click]));
Object.defineProperty(geoRequest, 'cf', { value: { country: 'US', regionCode: 'GA', city: 'Athens', latitude: '33.95', longitude: '-83.38' } });
assert.equal((await ingest(geoRequest, db)).status, 200);
assert.equal(count('insight_events'), 1);
await ingest(request(batch([click])), db);
assert.equal(count('insight_events'), 1, 'Event IDs deduplicate retries');
const stored = sql.prepare('SELECT * FROM insight_events').get();
assert.equal(stored.country, 'US'); assert.equal(stored.region, 'GA');
assert.equal(stored.subject_id, await hash(token));
assert.ok(!JSON.stringify(stored).includes('Athens'));
assert.ok(!Object.hasOwn(stored, 'latitude'));

const text = event('content', { kind: 'chat', text: 'Contact me: example@school.edu, 706-555-1234 https://private.example/token', transcript: 'full transcript' });
await ingest(request(batch([text])), db);
assert.equal(count('insight_content'), 0);
await ingest(request(batch([text], { consent: { ...consent, content: true } })), db);
assert.equal(count('insight_content'), 1);
const research = sql.prepare('SELECT text FROM insight_content').get().text;
assert.ok(!research.includes('school.edu') && !research.includes('706') && !research.includes('private.example'));
assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM insight_events').all()).includes('Contact me'));
assert.equal(await isAdmin(new Request('https://orion.test/report'), { INSIGHTS_ADMIN_TOKEN: 'x'.repeat(40) }), false);
assert.equal(await isAdmin(new Request('https://orion.test/report', { headers: { authorization: `Bearer ${'x'.repeat(40)}` } }), { INSIGHTS_ADMIN_TOKEN: 'x'.repeat(40) }), true);
assert.equal((await erase(request({ token }), db)).status, 200);
assert.equal(count('insight_events'), 0); assert.equal(count('insight_content'), 0);
assert.equal((await ingest(request(batch([event()])), db)).status, 410, 'Deleted identifiers cannot replay late batches');
const otherToken = 'b'.repeat(64);
await ingest(request(batch([event(), event('content', { kind: 'setup', text: 'I like computing.' })], { token: otherToken, consent: { ...consent, content: true } })), db);
sql.exec(`UPDATE insight_events SET received_at = 1; UPDATE insight_content SET received_at = 1`);
await pruneInsights(db);
assert.equal(count('insight_events'), 0); assert.equal(count('insight_content'), 0);

const feedback = { id: crypto.randomUUID(), kind: 'bug', message: 'The course popup does not scroll.', replyTo: 'reply@example.com', usefulness: 'mixed', to: 'attacker@example.com', transcript: 'do not send', url: 'https://private.test' };
const report = cleanFeedback(feedback);
assert.equal(Object.hasOwn(report, 'transcript'), false);
assert.equal(Object.hasOwn(report, 'to'), false);
assert.ok(!feedbackText(report).includes('private.test'));
assert.equal(cleanFeedback({ ...feedback, replyTo: 'a@example.com\r\nBcc: bad@example.com' }), null);
assert.equal(cleanFeedback({ ...feedback, message: 'x'.repeat(3001) }), null);
const feedbackRoute = await import('../../app/api/feedback/route.ts');
delete process.env.RESEND_API_KEY; delete process.env.FEEDBACK_FROM;
assert.equal((await feedbackRoute.POST(request(feedback))).status, 503, 'Missing sender must not claim delivery');
process.env.RESEND_API_KEY = 'test-only-key'; process.env.FEEDBACK_FROM = 'ORION <hello@example.com>';
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const message = JSON.parse(options.body);
    assert.deepEqual(message.to, [FEEDBACK_EMAIL]);
    assert.equal(message.reply_to, 'reply@example.com');
    assert.ok(!message.text.includes('do not send'));
    assert.equal(options.headers['Idempotency-Key'], `orion-feedback-${feedback.id}`);
    return Response.json({ id: 'mock-mail' });
  };
  assert.equal((await feedbackRoute.POST(request(feedback))).status, 200);
  globalThis.fetch = async () => Response.json({ error: 'provider error' }, { status: 500 });
  assert.equal((await feedbackRoute.POST(request(feedback))).status, 502);
} finally {
  globalThis.fetch = originalFetch; delete process.env.RESEND_API_KEY; delete process.env.FEEDBACK_FROM; sql.close();
}
console.log('Insights: consent, schema allowlists, geo minimization, redaction, deduplication, auth, deletion/tombstones, retention and feedback delivery checks passed.');
