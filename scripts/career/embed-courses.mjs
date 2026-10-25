#!/usr/bin/env node
/**
 * One meaning-vector per undergraduate course, for the career matcher
 * (lib/planner/career-embedding.ts).
 *
 * The model is the one the Illinois course map is built with
 * (scripts/illinois/map.mjs): Xenova/all-MiniLM-L6-v2, 384 numbers, mean
 * pooled and normalised, fed the same text the map feeds it, the title twice
 * and then the description. UGA's map came from another project, so UGA's
 * courses are embedded here the same way, and the two schools' vectors are
 * comparable with the student's goal, which the browser embeds with the
 * same model (scripts/career/browser-assets.mjs).
 *
 * Undergraduate courses only (number below 500, or below 5000 at UGA), the
 * rows a free choice on an undergraduate board can take: about 2.4 MB at
 * Illinois and 2.8 MB at UGA. A graduate course has no vector, and the
 * matcher falls back to word matching for it.
 *
 * Each vector is stored as 384 signed bytes and one scale (its largest
 * component / 127): public/<school>/course-vectors.bin holds the bytes in
 * the order of `codes` in public/<school>/course-vectors.json.
 *
 * `hubs`: each course's mean similarity to fifty reference occupations,
 * none of them a benchmark goal (REFERENCE below). The matcher ranks a
 * course by how much closer it is to the student's goal than to careers in
 * general, so a course whose vector sits near every short goal (UKR 201,
 * Second-Year Ukrainian, came first for "dentist") does not lead them all.
 *
 *   node scripts/career/embed-courses.mjs [illinois|uga]...   (both by default; about 15 minutes)
 *   node scripts/career/embed-courses.mjs --hubs-only          recompute the hubs from the stored vectors (seconds)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const D = 384;
export const RECIPE = 'title. title. description, first 1200 characters';
const level = (code) => { const m = code.match(/(\d{3})/); return m ? Number.parseInt(m[1], 10) : 0; };
const norm = (code) => code.trim().replace(/\s+/g, ' ').toUpperCase();

function coursesOf(school) {
  const raw = JSON.parse(readFileSync(join(ROOT, `public/${school}-catalog.json`), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.courses;
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const code = norm(c.code);
    if (seen.has(code) || level(code) >= 500 || level(code) === 0) continue;
    seen.add(code);
    out.push({ code, text: `${c.title}. ${c.title}. ${c.description ?? ''}`.slice(0, 1200) });
  }
  return { courses: out, fetchedAt: Array.isArray(raw) ? null : raw.fetchedAt ?? null };
}

export const REFERENCE = [
  'pharmacist', 'architect', 'chef', 'airline pilot', 'electrician', 'librarian', 'police officer', 'firefighter', 'social worker', 'economist',
  'chemist', 'biologist', 'physicist', 'musician', 'actor', 'painter', 'photographer', 'translator', 'diplomat', 'entrepreneur',
  'management consultant', 'banker', 'real estate agent', 'urban planner', 'pastor', 'farmer', 'geologist', 'astronomer', 'statistician', 'surgeon',
  'psychologist', 'optometrist', 'athletic trainer', 'coach', 'writer', 'editor', 'film director', 'fashion designer', 'interior designer', 'civil engineer',
  'electrical engineer', 'chemical engineer', 'nutritionist', 'zoologist', 'historian', 'archaeologist', 'museum curator', 'political scientist', 'military officer', 'pilot',
];

const schools = process.argv.slice(2).filter((a) => a === 'illinois' || a === 'uga');
const { pipeline, env } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
const refs = await fe(REFERENCE, { pooling: 'mean', normalize: true });

/** Mean similarity of each stored course vector to the reference occupations. */
function hubsOf(bytes, scales) {
  const n = scales.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let r = 0; r < REFERENCE.length; r++) {
      let s = 0;
      for (let k = 0; k < D; k++) s += bytes[i * D + k] * refs.data[r * D + k];
      sum += s * scales[i];
    }
    out.push(Number((sum / REFERENCE.length).toFixed(4)));
  }
  return out;
}

if (process.argv.includes('--hubs-only')) {
  for (const school of ['illinois', 'uga']) {
    const metaPath = join(ROOT, `public/${school}/course-vectors.json`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const bin = readFileSync(join(ROOT, `public/${school}/course-vectors.bin`));
    const bytes = new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength);
    const { hubs: _old, ...rest } = meta;
    writeFileSync(metaPath, JSON.stringify({ ...rest, reference: REFERENCE.length, hubs: hubsOf(bytes, meta.scales) }));
    console.log(`${school}: hubs for ${meta.codes.length} courses`);
  }
  process.exit(0);
}

for (const school of schools.length > 0 ? schools : ['illinois', 'uga']) {
  const t0 = Date.now();
  const { courses, fetchedAt } = coursesOf(school);
  const bytes = new Int8Array(courses.length * D);
  const scales = [];
  const BATCH = 64;
  for (let i = 0; i < courses.length; i += BATCH) {
    const slice = courses.slice(i, i + BATCH);
    const out = await fe(slice.map((c) => c.text), { pooling: 'mean', normalize: true });
    for (let j = 0; j < slice.length; j++) {
      let max = 0;
      for (let k = 0; k < D; k++) max = Math.max(max, Math.abs(out.data[j * D + k]));
      const scale = max > 0 ? max / 127 : 1;
      scales.push(Number(scale.toPrecision(6)));
      for (let k = 0; k < D; k++) bytes[(i + j) * D + k] = Math.round(out.data[j * D + k] / scales[i + j]);
    }
    if (i % (BATCH * 20) === 0) process.stdout.write('.');
  }
  mkdirSync(join(ROOT, `public/${school}`), { recursive: true });
  writeFileSync(join(ROOT, `public/${school}/course-vectors.bin`), Buffer.from(bytes.buffer));
  writeFileSync(join(ROOT, `public/${school}/course-vectors.json`), JSON.stringify({
    model: 'Xenova/all-MiniLM-L6-v2', dims: D, pooling: 'mean', normalized: true, recipe: RECIPE,
    count: courses.length, catalogFetchedAt: fetchedAt, codes: courses.map((c) => c.code), scales,
    reference: REFERENCE.length, hubs: hubsOf(bytes, scales),
  }));
  console.log(`\n${school}: ${courses.length} courses in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${(bytes.length / 1048576).toFixed(2)} MiB of vectors`);
}
