import type { Plugin } from 'vite';

const registryPath = '/vinext/dist/shims/internal/als-registry.js';
const scopeLoop = 'for (const als of _registry) {';
const guardedScopeLoop = `${scopeLoop}\n\t\tif (als.getStore() === undefined) continue;`;

export function guardInactiveScopes(code: string): string {
  if (code.includes(guardedScopeLoop)) return code;
  if (!code.includes(scopeLoop)) {
    throw new Error('Vinext scope registry changed; review the local HMR scope guard.');
  }
  return code.replace(scopeLoop, guardedScopeLoop);
}

// Vinext beta.9 retains module-local stores across HMR. Only active stores need
// exiting; nesting through thousands of stale, empty stores overflows the stack.
export function vinextScopeGuard(): Plugin {
  return {
    name: 'orion:vinext-dev-scope-guard',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith(registryPath)) return;
      return { code: guardInactiveScopes(code), map: null };
    },
  };
}
