import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { guardInactiveScopes, vinextScopeGuard } from './vinext-scope-guard.ts';

const path = new URL('../../node_modules/vinext/dist/shims/internal/als-registry.js', import.meta.url);
const source = await readFile(path, 'utf8');
const load = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const original = await load(source);
for (let i = 0; i < 30_000; i++) original.registerAlsForScopeExit(new AsyncLocalStorage());
assert.throws(() => original.runOutsideRequestScopes(() => true), RangeError,
  'Reproduce the overflow after repeated hot reloads register inactive stores');

const patched = guardInactiveScopes(source);
assert.equal(guardInactiveScopes(patched), patched, 'Guard is idempotent');
assert.throws(() => guardInactiveScopes('upstream implementation changed'), /registry changed/);
const guarded = await load(patched);
assert.equal(guarded.runOutsideRequestScopes(() => 42), 42);

const request = new AsyncLocalStorage();
const execution = new AsyncLocalStorage();
guarded.registerAlsForScopeExit(request);
guarded.registerAlsForScopeExit(execution);
await Promise.all(['one', 'two'].map((value) => request.run(value, async () => {
  await execution.run(false, async () => {
    await guarded.runOutsideRequestScopes(async () => {
      assert.equal(request.getStore(), undefined);
      assert.equal(execution.getStore(), undefined, 'Falsy active values are exited too');
      await Promise.resolve();
      assert.equal(request.getStore(), undefined, 'Async work does not inherit the request');
      assert.equal(execution.getStore(), undefined);
    });
    assert.equal(request.getStore(), value, 'Concurrent request scopes are restored');
    assert.equal(execution.getStore(), false);
    const failure = new Error('test');
    assert.throws(() => guarded.runOutsideRequestScopes(() => { throw failure; }), (e) => e === failure);
    assert.equal(request.getStore(), value, 'Exceptions restore the request scope');
    assert.equal(execution.getStore(), false);
  });
})));

const plugin = vinextScopeGuard();
assert.equal(plugin.apply, 'serve', 'Production bundles are unchanged');
assert.equal(plugin.transform(source, '/other/module.js'), undefined);
assert.equal(plugin.transform(source, `${path.pathname}?v=test`).code, patched);
console.log('Vinext scope guard: overflow reproduced; inactive-store guard, request isolation, async work, exceptions and dev-only targeting passed.');
