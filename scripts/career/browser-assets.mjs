#!/usr/bin/env node
/**
 * The files the browser needs to read a student's goal with the same model
 * the course vectors were made with, all served from this site (no request
 * to any other host):
 *
 *   public/career-model/models/Xenova/all-MiniLM-L6-v2/   tokenizer, config, onnx/model_int8w.onnx
 *   public/career-model/runtime/                          transformers.min.js, the WebAssembly ONNX runtime
 *
 * Made from the model the course vectors were built with, in transformers.js's
 * own cache (node_modules/@huggingface/transformers/.cache, where
 * scripts/illinois/map.mjs and scripts/career/embed-courses.mjs keep it), and
 * the two packages in node_modules. On a machine without that cache (a fresh
 * clone), the model's four official files are downloaded once from its
 * page, https://huggingface.co/Xenova/all-MiniLM-L6-v2 (about 87 MB), into
 * that cache, one request a second, and each is checked against the
 * SHA-256 of the copy the course vectors were made with: a different file
 * would read goals on another scale than the courses, so it is refused.
 * Neither the cache nor public/career-model/ is saved in git (about 38 MB
 * of copies there); run this once before turning the career matcher on, and
 * again after a package update.
 *
 *   node scripts/career/browser-assets.mjs                write the files (downloading the model if it is missing)
 *   node scripts/career/browser-assets.mjs --no-download  only from files already on this machine
 *   node scripts/career/browser-assets.mjs --verify       also compare the 8-bit model with the float one
 */
import { copyFileSync, mkdirSync, statSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quantizeModel } from './onnx-int8.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NM = join(ROOT, 'node_modules');
const CACHE = process.env.CAREER_MODEL_CACHE ?? join(NM, '@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2');
const OUT = join(ROOT, 'public/career-model');
const MODEL = join(OUT, 'models/Xenova/all-MiniLM-L6-v2');
const RUNTIME = join(OUT, 'runtime');
const mb = (p) => `${(statSync(p).size / 1048576).toFixed(1)} MiB`;

/**
 * The model's files as the course vectors were made with them (read
 * 2026-10-25 from the copy in this machine's cache), and where its page
 * serves them.
 */
// CAREER_MODEL_SOURCE: another address serving the same files (a mirror, or a local copy for testing this script).
const SOURCE = process.env.CAREER_MODEL_SOURCE ?? 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/';
const FILES = {
  'config.json': '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7',
  'tokenizer.json': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
  'onnx/model.onnx': '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e',
};
const AGENT = 'FourYearPlanBot/1.0 (student planning project; respects robots.txt)';
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const missing = Object.keys(FILES).filter((f) => !existsSync(join(CACHE, f)));
if (missing.length > 0) {
  console.log(`The career matcher's model is not on this machine yet (missing in ${CACHE}: ${missing.join(', ')}).`);
  if (process.argv.includes('--no-download')) {
    console.error(`Run this script without --no-download to fetch the official files from ${SOURCE.replace('/resolve/main/', '')} (about 87 MB, once).`);
    process.exit(1);
  }
  console.log(`Downloading the official files from ${SOURCE.replace('/resolve/main/', '')} (about 87 MB, once)...`);
  for (const [i, f] of missing.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    const to = join(CACHE, f);
    mkdirSync(dirname(to), { recursive: true });
    let response;
    try {
      response = await fetch(SOURCE + f, { headers: { 'User-Agent': AGENT }, redirect: 'follow' });
    } catch (error) {
      console.error(`Could not download ${f} (${error.message}). Check the connection and run this again, or copy the four files into ${CACHE} by hand.`);
      process.exit(1);
    }
    if (!response.ok) {
      console.error(`Could not download ${f}: ${response.status} ${response.statusText} from ${SOURCE + f}.`);
      process.exit(1);
    }
    writeFileSync(`${to}.part`, Buffer.from(await response.arrayBuffer()));
    renameSync(`${to}.part`, to);
    console.log(`  ${f}: ${mb(to)}`);
  }
}
const changed = Object.entries(FILES).filter(([f, hash]) => sha256(join(CACHE, f)) !== hash).map(([f]) => f);
if (changed.length > 0) {
  console.error(`These model files are not the ones the course vectors were made with: ${changed.join(', ')} (in ${CACHE}). A different model would read goals on another scale than the courses; delete them and run this again, or rebuild the course vectors (scripts/career/embed-courses.mjs) with this model.`);
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
