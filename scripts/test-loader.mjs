/** Node test loader for the real browser adapters, without starting React or a bundler. */
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url).href;

export async function resolve(specifier, context, next) {
  const spec = specifier.startsWith('@/') ? root + specifier.slice(2) : specifier;
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\.[cm]?[jt]sx?(?:\?|$)|\.json(?:\?|$)/.test(spec)) {
    for (const extension of ['.ts', '.tsx', '.mjs']) {
      try { return await next(spec + extension, context); } catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      }
    }
  }
  return next(spec, context);
}

export async function load(url, context, next) {
  if (new URL(url).pathname.endsWith('.tsx')) {
    const source = await readFile(new URL(url), 'utf8');
    return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(source, {
        fileName: new URL(url).pathname,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  }
  return next(url, context);
}
