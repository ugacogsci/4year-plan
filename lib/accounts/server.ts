import * as oauth from 'oauth4webapi';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { workspaceSchema } from './snapshot';
import { readBodyCapped } from '../planner/spend-guard';
import { allowRequest } from '../insights/server';

export interface AccountEnv {
  ACCOUNTS_DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}
const google: oauth.AuthorizationServer = {
  issuer: 'https://accounts.google.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
};
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const maxAge = 30 * 86400;
export const accountReady = (env: AccountEnv) => Boolean(env.ACCOUNTS_DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.NEXT_PUBLIC_SITE_URL);
export const hashToken = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), (b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
export function sameOrigin(req: Request): boolean {
  return req.headers.get('origin') === new URL(req.url).origin && req.headers.get('sec-fetch-site') !== 'cross-site';
}
function cookieName(req: Request, kind: string) { return `${new URL(req.url).protocol === 'https:' ? '__Host-' : ''}orion_${kind}`; }
function cookie(req: Request, kind: string, value: string, age: number) {
  return `${cookieName(req, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function readCookie(req: Request, kind: string) {
  return (req.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName(req, kind)}=`))?.split('=')[1] ?? '';
}
export function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}
async function account(req: Request, env: AccountEnv): Promise<{ id: string; email: string } | null> {
  const token = readCookie(req, 'session');
  if (!env.ACCOUNTS_DB || !/^[a-f0-9]{64}$/.test(token)) return null;
  return env.ACCOUNTS_DB.prepare('SELECT a.id, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await hashToken(token), Date.now()).first();
}
export async function sessionRoute(req: Request, env: AccountEnv) {
  const user = await account(req, env);
  if (req.method === 'GET') return json({ enabled: accountReady(env), user });
  if (!sameOrigin(req)) return json({ error: 'Open ORION to manage your account.' }, 403);
  if (req.method === 'DELETE') {
    if (user) await env.ACCOUNTS_DB!.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(readCookie(req, 'session'))).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'session', '', 0) });
  }
  return json({ error: 'Method not allowed.' }, 405);
}
export async function googleStart(req: Request, env: AccountEnv) {
  if (!sameOrigin(req)) return json({ error: 'Start sign-in from ORION.' }, 403);
  if (!await allowRequest(req, 'google-start', 20)) return json({ error: 'Please wait a few minutes before signing in again.' }, 429);
  if (!accountReady(env)) return json({ error: 'Google sign-in is not configured yet. Your plan can still be saved on this device.' }, 503);
  if (new URL(req.url).origin !== new URL(env.NEXT_PUBLIC_SITE_URL!).origin) return json({ error: 'Sign in on the main ORION website.' }, 403);
  const token = randomToken(), state = oauth.generateRandomState(), nonce = oauth.generateRandomNonce(), verifier = oauth.generateRandomCodeVerifier();
  const db = env.ACCOUNTS_DB!;
  await db.batch([
    db.prepare('DELETE FROM oauth_attempts WHERE expires_at < ?').bind(Date.now()),
    db.prepare('INSERT INTO oauth_attempts VALUES (?, ?, ?, ?, ?)').bind(await hashToken(token), state, nonce, verifier, Date.now() + 600000),
  ]);
  const url = new URL(google.authorization_endpoint!);
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: `${new URL(env.NEXT_PUBLIC_SITE_URL!).origin}/api/auth/callback/google`,
    response_type: 'code', scope: 'openid email', state, nonce, code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return json({ url: url.href }, 200, { 'set-cookie': cookie(req, 'oauth', token, 600) });
}
export async function googleCallback(req: Request, env: AccountEnv) {
  const headers = new Headers({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', location: '/?account=error' });
  headers.append('set-cookie', cookie(req, 'oauth', '', 0));
  try {
    if (!accountReady(env)) throw new Error('Not configured');
    const token = readCookie(req, 'oauth');
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Missing login attempt');
    // DELETE RETURNING makes callbacks single-use even when two requests race.
    const attempt = await env.ACCOUNTS_DB!.prepare('DELETE FROM oauth_attempts WHERE token_hash = ? AND expires_at > ? RETURNING state, nonce, verifier')
      .bind(await hashToken(token), Date.now()).first<{ state: string; nonce: string; verifier: string }>();
    if (!attempt) throw new Error('Expired attempt');
    const client = { client_id: env.GOOGLE_CLIENT_ID! };
    const params = oauth.validateAuthResponse(google, client, new URL(req.url), attempt.state);
    const response = await oauth.authorizationCodeGrantRequest(google, client, oauth.ClientSecretPost(env.GOOGLE_CLIENT_SECRET!), params,
      `${new URL(env.NEXT_PUBLIC_SITE_URL!).origin}/api/auth/callback/google`, attempt.verifier, { signal: AbortSignal.timeout(15000) });
    const tokens = await oauth.processAuthorizationCodeResponse(google, client, response, { expectedNonce: attempt.nonce, requireIdToken: true });
    const { payload } = await jwtVerify(tokens.id_token!, keys, { issuer: google.issuer, audience: client.client_id, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'nonce', 'email'] });
    if (payload.nonce !== attempt.nonce || payload.email_verified !== true || typeof payload.email !== 'string' || !payload.sub) throw new Error('Invalid identity');
    const db = env.ACCOUNTS_DB!;
    await db.prepare('INSERT INTO accounts (id, google_subject, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(google_subject) DO UPDATE SET email = excluded.email')
      .bind(crypto.randomUUID(), payload.sub, payload.email, Date.now()).run();
    const user = await db.prepare('SELECT id FROM accounts WHERE google_subject = ?').bind(payload.sub).first<{ id: string }>();
    const session = randomToken();
    await db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').bind(await hashToken(session), user!.id, Date.now() + maxAge * 1000).run();
    headers.append('set-cookie', cookie(req, 'session', session, maxAge));
    headers.set('location', '/?account=connected');
  } catch { /* Do not log codes, tokens, identity claims or provider responses. */ }
  return new Response(null, { status: 303, headers });
}
export async function workspaceRoute(req: Request, env: AccountEnv) {
  const user = await account(req, env);
  if (!user) return json({ error: 'Sign in to access your saved plans.' }, 401);
  if (!await allowRequest(req, 'account-storage', 300)) return json({ error: 'Please wait a few minutes before saving again. Your local plan is safe.' }, 429);
  const db = env.ACCOUNTS_DB!;
  if (req.method === 'GET') {
    const row = await db.prepare('SELECT payload, revision, updated_at FROM workspaces WHERE account_id = ?').bind(user.id).first<{ payload: string; revision: number; updated_at: number }>();
    return json(row ? { snapshot: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at } : { snapshot: null, revision: 0 });
  }
  if (!sameOrigin(req)) return json({ error: 'Open ORION to save your plan.' }, 403);
  if (req.method === 'DELETE') {
    await db.prepare('DELETE FROM workspaces WHERE account_id = ?').bind(user.id).run();
    return json({ ok: true });
  }
  if (req.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
  const text = await readBodyCapped(req, 950000);
  if (text === null) return json({ error: 'This workspace is too large for account storage. Download a copy instead.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Invalid save.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid save.' }, 400);
  const parsed = workspaceSchema.safeParse(body.snapshot);
  if (!parsed.success || !Number.isSafeInteger(body.revision) || body.revision < 0) return json({ error: 'Invalid plan data.' }, 400);
  const payload = JSON.stringify(parsed.data), now = Date.now();
  const result = body.revision === 0
    ? await db.prepare('INSERT INTO workspaces VALUES (?, ?, 1, ?) ON CONFLICT(account_id) DO NOTHING').bind(user.id, payload, now).run()
    : await db.prepare('UPDATE workspaces SET payload = ?, revision = revision + 1, updated_at = ? WHERE account_id = ? AND revision = ?').bind(payload, now, user.id, body.revision).run();
  if (!result.meta.changes) return json({ error: 'A newer saved plan exists. Load it or download your local copy before replacing it.' }, 409);
  return json({ revision: body.revision + 1, updatedAt: now });
}
export async function deleteAccount(req: Request, env: AccountEnv) {
  if (!sameOrigin(req)) return json({ error: 'Open ORION to delete your account.' }, 403);
  const user = await account(req, env);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  await env.ACCOUNTS_DB!.prepare('DELETE FROM accounts WHERE id = ?').bind(user.id).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'session', '', 0) });
}
export async function pruneAccounts(db: D1Database) {
  await db.batch([db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()), db.prepare('DELETE FROM oauth_attempts WHERE expires_at < ?').bind(Date.now())]);
}
