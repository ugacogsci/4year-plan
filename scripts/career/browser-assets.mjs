#!/usr/bin/env node
/**
 * The files the browser needs to read a student's goal with the same model
 * the course vectors were made with, all served from this site (no request
 * to any other host):
 *
 *   public/career-model/models/Xenova/all-MiniLM-L6-v2/   tokenizer, config, onnx/model_int8w.onnx
 *   public/career-model/runtime/                          transformers.min.js, the WebAssembly ONNX runtime
 *
 * Made from what is already on this machine: the model the course map was
 * built with (node_modules/@huggingface/transformers/.cache, put there by
 * scripts/illinois/map.mjs) and the two packages in node_modules. Nothing is
 * downloaded. The folder is ignored by git (about 38 MB of copies); run this
 * once before turning the career matcher on, and again after a package
 * update.
 *
 *   node scripts/career/browser-assets.mjs            write the files
 *   node scripts/career/browser-assets.mjs --verify   also compare the 8-bit model with the float one
 */
import { copyFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quantizeModel } from './onnx-int8.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NM = join(ROOT, 'node_modules');
const CACHE = join(NM, '@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2');
const OUT = join(ROOT, 'public/career-model');
const MODEL = join(OUT, 'models/Xenova/all-MiniLM-L6-v2');
const RUNTIME = join(OUT, 'runtime');
const mb = (p) => `${(statSync(p).size / 1048576).toFixed(1)} MiB`;

if (!existsSync(join(CACHE, 'onnx/model.onnx'))) {
  console.error(`No model at ${CACHE}. scripts/illinois/map.mjs puts it there the first time it runs.`);
  process.exit(1);
}
mkdirSync(join(MODEL, 'onnx'), { recursive: true });
mkdirSync(RUNTIME, { recursive: true });
for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) copyFileSync(join(CACHE, f), join(MODEL, f));
const q = quantizeModel(join(CACHE, 'onnx/model.onnx'), join(MODEL, 'onnx/model_int8w.onnx'));
console.log(`model: ${q.matrices.length} matrices to 8 bits, ${(q.inBytes / 1048576).toFixed(1)} -> ${(q.outBytes / 1048576).toFixed(1)} MiB`);

// The WebAssembly-only build of ONNX Runtime: transformers.min.js carries the
// WebGPU one, whose 26 MiB .wasm is over the per-file limit. The page hands
// this one to transformers.js (globalThis[Symbol.for('onnxruntime')]).
const runtime = [
  [join(NM, '@huggingface/transformers/dist/transformers.min.js'), 'transformers.min.js'],
  [join(NM, 'onnxruntime-web/dist/ort.wasm.min.mjs'), 'ort.wasm.min.mjs'],
  [join(NM, 'onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'), 'ort-wasm-simd-threaded.mjs'],
  [join(NM, 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'],
];
for (const [from, to] of runtime) copyFileSync(from, join(RUNTIME, to));
for (const [, to] of runtime) console.log(`runtime/${to}: ${mb(join(RUNTIME, to))}`);
console.log(`model/onnx/model_int8w.onnx: ${mb(join(MODEL, 'onnx/model_int8w.onnx'))}`);

if (process.argv.includes('--verify')) {
  const { pipeline, env } = await import('@huggingface/transformers');
  const { readFileSync } = await import('node:fs');
  env.allowRemoteModels = false;
  const fp32 = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
  env.localModelPath = join(OUT, 'models/');
  const int8 = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32', model_file_name: 'model_int8w' });
  const catalog = JSON.parse(readFileSync(join(ROOT, 'public/illinois-catalog.json'), 'utf8')).courses;
  const texts = [
    'I want to be a dentist', 'software engineer', 'I want to work as a nurse', 'undecided',
    ...catalog.filter((_, i) => i % 47 === 0).map((c) => `${c.title}. ${c.title}. ${c.description ?? ''}`.slice(0, 1200)),
  ];
  const a = await fp32(texts, { pooling: 'mean', normalize: true });
  const b = await int8(texts, { pooling: 'mean', normalize: true });
  const D = 384;
  const cos = [];
  for (let i = 0; i < texts.length; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += a.data[i * D + k] * b.data[i * D + k];
    cos.push(s);
  }
  cos.sort((x, y) => x - y);
  console.log(`8-bit vs float, ${texts.length} texts: cosine min ${cos[0].toFixed(4)}, median ${cos[cos.length >> 1].toFixed(4)}`);
}
