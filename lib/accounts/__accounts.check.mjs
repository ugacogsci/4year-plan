import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$/.test(spec)) return next(spec + '.ts', ctx); return next(spec, ctx); }`));
const { workspaceRoute, sessionRoute, googleStart, googleCallback, deleteAccount, hashToken, pruneAccounts } = await import('./server.ts');
const { workspaceSchema, localSnapshot } = await import('./snapshot.ts');
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
sql.exec(readFileSync(new URL('../../account-migrations/0001_accounts.sql', import.meta.url), 'utf8'));
const db = {
  prepare(query) {
    let params = [];
    const statement = {
      bind(...values) { params = values; return statement; },
      async run() { const result = sql.prepare(query).run(...params); return { meta: { changes: Number(result.changes) } }; },
      async first() { return sql.prepare(query).get(...params) ?? null; },
    };
    return statement;
  },
  async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
};
const env = { ACCOUNTS_DB: db, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', NEXT_PUBLIC_SITE_URL: 'https://orion.test' };
const a = 'a'.repeat(64), b = 'b'.repeat(64);
for (const [id, token] of [['a', a], ['b', b]]) {
  sql.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(id, `google-${id}`, `${id}@example.test`, Date.now());
  sql.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(await hashToken(token), id, Date.now() + 600000);
}
const req = (method = 'GET', token = a, body, origin = 'https://orion.test') => new Request('https://orion.test/api/account/workspace', {
  method, headers: { cookie: `__Host-orion_session=${token}`, origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const plan = { schemaVersion: 1, programId: '69115', graduationLabel: 'Spring 2029', completedCourseIds: [], terms: [{ id: 'fall-2026', label: 'Fall 2026', season: 'Fall', courseIds: [] }] };
const snapshot = { version: 1, answers: { schoolId: 'uga', programIds: ['69115'] }, board: { schemaVersion: 4, schoolId: 'uga', board: { plan }, plans: [{ id: 'one', plan }] }, chat: null };
assert.equal((await workspaceRoute(req('GET', ''), env)).status, 401);
assert.equal((await workspaceRoute(req('PUT', a, { snapshot, revision: 0 }, 'https://attacker.test'), env)).status, 403);
assert.equal((await workspaceRoute(req('PUT', a, { snapshot, revision: 0, accountId: 'b' }), env)).status, 200);
assert.equal((await (await workspaceRoute(req('GET', b), env)).json()).snapshot, null, 'B cannot load A');
assert.equal((await (await workspaceRoute(req(), env)).json()).revision, 1);
assert.equal((await workspaceRoute(req('PUT', a, { snapshot, revision: 0 }), env)).status, 409, 'Creation cannot overwrite');
assert.equal((await workspaceRoute(req('PUT', a, { snapshot, revision: 1 }), env)).status, 200);
assert.equal((await workspaceRoute(req('PUT', a, { snapshot, revision: 1 }), env)).status, 409, 'Stale save is rejected');
assert.equal((await workspaceRoute(req('DELETE', b), env)).status, 200);
assert.notEqual((await (await workspaceRoute(req(), env)).json()).snapshot, null, 'Deleting B never deletes A');
assert.equal(workspaceSchema.safeParse({ ...snapshot, accountId: 'b' }).success, false);
assert.equal(workspaceSchema.safeParse({ ...snapshot, answers: { schoolId: 'illinois' } }).success, false);
assert.equal(workspaceSchema.safeParse({ ...snapshot, board: { ...snapshot.board, board: { plan: {} } } }).success, false);
assert.equal(workspaceSchema.safeParse({ ...snapshot, board: { ...snapshot.board, plans: [{ plan: {} }] } }).success, false);
assert.equal(localSnapshot({ getItem: () => '{invalid' }), null);
assert.equal((await googleStart(req('POST', a, undefined, 'https://attacker.test'), env)).status, 403);
assert.equal((await googleStart(req('POST'), { ACCOUNTS_DB: db })).status, 503);
const started = await googleStart(req('POST'), env);
const authorization = new URL((await started.json()).url);
assert.equal(authorization.origin, 'https://accounts.google.com');
assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorization.searchParams.get('scope'), 'openid email');
assert.equal(authorization.searchParams.get('redirect_uri'), 'https://orion.test/api/auth/callback/google');
assert.ok(started.headers.get('set-cookie').includes('HttpOnly; SameSite=Lax'));
assert.ok(started.headers.get('set-cookie').includes('; Secure'));
assert.ok(!started.headers.get('set-cookie').includes('test-secret'));
const badCallback = await googleCallback(new Request('https://orion.test/api/auth/callback/google?state=wrong&code=fake', { headers: { cookie: started.headers.get('set-cookie').split(';')[0] } }), env);
assert.equal(badCallback.headers.get('location'), '/?account=error');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM oauth_attempts').get().n, 0, 'Callback attempt is one-use');
const signing = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(signing.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const originalFetch = globalThis.fetch;
let idToken;
globalThis.fetch = async (url, init) => {
  const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  if (address === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
  assert.equal(address, 'https://oauth2.googleapis.com/token');
  assert.equal(init.body.get('client_secret'), 'test-secret');
  assert.ok(init.body.get('code_verifier'));
  return Response.json({ access_token: 'test-access', token_type: 'Bearer', expires_in: 3600, id_token: idToken });
};
try {
  for (const valid of [false, true]) {
    const begin = await googleStart(req('POST'), env);
    const authUrl = new URL((await begin.json()).url);
    idToken = await new SignJWT({ email: 'new@example.test', email_verified: true, nonce: valid ? authUrl.searchParams.get('nonce') : 'wrong-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://accounts.google.com').setAudience('test-client')
      .setSubject('google-new').setIssuedAt().setExpirationTime('5m').sign(signing.privateKey);
    const callback = new Request(`https://orion.test/api/auth/callback/google?state=${authUrl.searchParams.get('state')}&code=test-code`, { headers: { cookie: begin.headers.get('set-cookie').split(';')[0] } });
    const result = await googleCallback(callback, env);
    assert.equal(result.headers.get('location'), valid ? '/?account=connected' : '/?account=error', 'Signed ID token must match login nonce');
    if (valid) {
      const cookie = result.headers.getSetCookie().find(value => value.startsWith('__Host-orion_session='));
      assert.ok(cookie.includes('Secure'));
      const sessionRequest = new Request('https://orion.test/api/auth/session', { headers: { cookie: cookie.split(';')[0] } });
      assert.equal((await (await sessionRoute(sessionRequest, env)).json()).user.email, 'new@example.test');
      assert.equal((await googleCallback(callback, env)).headers.get('location'), '/?account=error', 'Successful callback cannot replay');
      await deleteAccount(new Request(sessionRequest.url, { method: 'POST', headers: { cookie: cookie.split(';')[0], origin: 'https://orion.test' } }), env);
    }
  }
} finally { globalThis.fetch = originalFetch; }
sql.prepare('UPDATE sessions SET expires_at = 0 WHERE account_id = ?').run('b');
assert.equal((await workspaceRoute(req('GET', b), env)).status, 401);
await pruneAccounts(db);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM sessions WHERE account_id = ?').get('b').n, 0);
assert.equal((await deleteAccount(req('POST', a, undefined, 'https://attacker.test'), env)).status, 403);
assert.equal((await deleteAccount(req('POST'), env)).status, 200);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n, 0);
assert.equal((await (await sessionRoute(req(), env)).json()).user, null);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM accounts').get().n, 1, 'B is untouched');
sql.close();
console.log('Accounts: ownership, CSRF, expired sessions, conflict checks, signed Google callback, PKCE/state/nonce, replay rejection, deletion and payload boundaries passed.');
