/**
 * Where every Georgia Tech course sits on the constellation map (the dots on
 * the dark map panel), computed from what the catalog says about the course
 * and from nothing else.
 *
 * Same method as the Illinois map (scripts/illinois/map.mjs), with the same
 * parameters and seed: all-MiniLM-L6-v2 sentence vectors, exact cosine kNN
 * (k=15), a UMAP fuzzy-simplicial-set layout (min_dist 0.1, 300 epochs,
 * seed 42), linear min/max normalisation into 3..97, then a small rosette for
 * courses whose vectors are identical. The layout stages are copied from that
 * file rather than imported, because it runs on import and writes
 * public/illinois-map.json; keep the two in step by hand.
 *
 * The one difference: the vectors are not embedded again here. They are read
 * from public/gatech/course-vectors.json + .bin, which
 * `node scripts/career/embed-courses.mjs gatech` built with the same model and
 * the same text (the title twice, then the description, first 1,200
 * characters), stored as 384 signed bytes and one scale per course. They are
 * multiplied back out and re-normalised.
 *
 * Index rows with no stored vector are the 0xxx learning-support courses
 * (MATH 0999 Support for College Algebra and eight more), which carry no
 * degree credit and so are skipped by the career matcher. The board still
 * lists them, so they are embedded here with the same cached model (offline
 * only, never downloaded) and laid out with everyone else. If the model cannot
 * load, each goes next to its subject's centre the way
 * scripts/apply-uga-pacmap.mjs places UGA's newer courses, and a course whose
 * subject has no other course is left off; build-index then says how many
 * indexed courses have no position.
 *
 * Subject is NOT in the vector, so departments clustering together is
 * evidence the map is real, not something it was told. Block 4 of the
 * self-check prints that evidence, and block 7 puts the same numbers next to
 * the Illinois map's.
 *
 * Output: public/gatech-map.json, the same shape as public/illinois-map.json.
 * `node --experimental-strip-types scripts/gatech/build-index.mjs` reads it
 * and puts each position on its index.json row.
 *
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" node scripts/gatech/map.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
const VECTORS_META = join(PUBLIC, 'gatech', 'course-vectors.json');
const VECTORS_BIN = join(PUBLIC, 'gatech', 'course-vectors.bin');
const CATALOG = join(PUBLIC, 'gatech-catalog.json');
const INDEX = join(PUBLIC, 'gatech', 'index.json');
const ILLINOIS_MAP = join(PUBLIC, 'illinois-map.json');
const OUT = join(PUBLIC, 'gatech-map.json');

/** The Illinois map's parameters, unchanged (scripts/illinois/map.mjs). */
const PARAMS = {
  neighbors: 15,
  minDist: 0.1,
  spread: 1.0,
  epochs: 300,
  negativeSamples: 5,
  gamma: 1.0,
  seed: 42,
};
const MAP_LOW = 3;
const MAP_HIGH = 97;
const D = 384;
const MODEL = 'Xenova/all-MiniLM-L6-v2';
/** The text embed-courses.mjs feeds the model (its RECIPE). */
const textOf = (c) => `${c.title}. ${c.title}. ${c.description ?? ''}`.slice(0, 1200);
const MIN_TEXT = 25;

function lcg(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const norm = (code) => code.trim().replace(/\s+/g, ' ').toUpperCase();
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const subjectOf = (code) => code.split(' ', 1)[0];

/* ------------------------------------------------------------------ load -- */

for (const f of [VECTORS_META, VECTORS_BIN, CATALOG]) {
  if (!existsSync(f)) {
    console.error(`!! ${f} is missing. Build the catalog (scripts/gatech/courses.mjs) and the vectors`);
    console.error('!! (node scripts/career/embed-courses.mjs gatech) first. Nothing written.');
    process.exit(1);
  }
}
const meta = JSON.parse(readFileSync(VECTORS_META, 'utf8'));
const bin = readFileSync(VECTORS_BIN);
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
if (meta.model !== MODEL || meta.dims !== D) {
  console.error(`!! course-vectors.json says ${meta.model} at ${meta.dims} dims; this map needs ${MODEL} at ${D}. Nothing written.`);
  process.exit(1);
}
if (bin.length !== meta.codes.length * D || meta.scales.length !== meta.codes.length) {
  console.error(`!! course-vectors.bin holds ${bin.length} bytes for ${meta.codes.length} codes (expected ${meta.codes.length * D}). Nothing written.`);
  process.exit(1);
}
const bytes = new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength);
const catalogByCode = new Map(catalog.courses.map((c) => [norm(c.code), c]));

/** A stored vector, multiplied back out and put back on the unit sphere. */
const stored = new Map();
meta.codes.forEach((code, i) => {
  const v = new Float64Array(D);
  let n = 0;
  for (let k = 0; k < D; k++) { v[k] = bytes[i * D + k] * meta.scales[i]; n += v[k] * v[k]; }
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < D; k++) v[k] /= n;
  stored.set(norm(code), v);
});

/**
 * The index rows the board draws that have no stored vector. The index is
 * build-index's output, but the set of codes in it does not depend on the
 * map, so reading it here is not circular. Without one (a first build) only
 * the stored vectors are mapped.
 */
const indexCodes = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')).map((r) => norm(r.code)) : [];
const missing = indexCodes.filter((code) => !stored.has(code) && catalogByCode.has(code)).sort(byCode);

/**
 * Embed the missing ones with the same model, offline, and round them through
 * the same signed-byte storage the career vectors went through, so every
 * point on the map has the same precision.
 */
async function embedMissing(codes) {
  if (codes.length === 0) return { vectors: new Map(), error: null };
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    const fe = await pipeline('feature-extraction', MODEL, { dtype: 'fp32' });
    const out = await fe(codes.map((c) => textOf(catalogByCode.get(c))), { pooling: 'mean', normalize: true });
    const vectors = new Map();
    codes.forEach((code, j) => {
      const raw = out.data.slice(j * D, (j + 1) * D);
      let max = 0;
      for (const x of raw) max = Math.max(max, Math.abs(x));
      const scale = max / 127 || 1;
      const v = new Float64Array(D);
      let n = 0;
      for (let k = 0; k < D; k++) { v[k] = Math.round(raw[k] / scale) * scale; n += v[k] * v[k]; }
      n = Math.sqrt(n) || 1;
      for (let k = 0; k < D; k++) v[k] /= n;
      vectors.set(code, v);
    });
    return { vectors, error: null };
  } catch (err) {
    return { vectors: new Map(), error: err.message };
  }
}

const t00 = Date.now();
const embeddedHere = await embedMissing(missing);
if (embeddedHere.error) console.log(`  !! the model would not load offline (${embeddedHere.error}); ${missing.length} courses go next to their subject's centre instead`);

const laidOut = [...stored.keys(), ...embeddedHere.vectors.keys()].sort(byCode);
const N = laidOut.length;
const indexOf = new Map(laidOut.map((c, i) => [c, i]));
const X = new Float64Array(N * D);
laidOut.forEach((code, i) => X.set(stored.get(code) ?? embeddedHere.vectors.get(code), i * D));

const textSourceOf = (code) => {
  const c = catalogByCode.get(code);
  return String(c?.description ?? '').trim().length >= MIN_TEXT ? 'title+description' : 'title-only';
};

/* ------------------------------------------- the layout (from illinois) -- */

function knn(k) {
  const nbr = new Int32Array(N * k).fill(-1);
  const nbd = new Float64Array(N * k);
  const bi = new Int32Array(k), bv = new Float64Array(k);
  for (let i = 0; i < N; i++) {
    bv.fill(-3); bi.fill(-1);
    let worst = -3;
    const oi = i * D;
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      let a = 0;
      const oj = j * D;
      for (let d = 0; d < D; d++) a += X[oi + d] * X[oj + d];
      if (a <= worst) continue;
      let p = k - 1;
      while (p > 0 && bv[p - 1] < a) { bv[p] = bv[p - 1]; bi[p] = bi[p - 1]; p--; }
      bv[p] = a; bi[p] = j;
      worst = bv[k - 1];
    }
    for (let r = 0; r < k; r++) { nbr[i * k + r] = bi[r]; nbd[i * k + r] = 1 - bv[r]; }
  }
  return { nbr, nbd };
}

/** UMAP's a and b by grid search then coordinate descent; a Newton fit diverged on Illinois. */
function fitAB(spread, minDist) {
  const xs = [], ys = [];
  for (let i = 1; i <= 300; i++) {
    const x = (3 * spread * i) / 300;
    xs.push(x);
    ys.push(x <= minDist ? 1 : Math.exp(-(x - minDist) / spread));
  }
  const sse = (a, b) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) {
      const r = ys[i] - 1 / (1 + a * Math.pow(xs[i], 2 * b));
      s += r * r;
    }
    return s;
  };
  let bestA = 1, bestB = 1, bestE = sse(1, 1);
  for (let la = -4; la <= 2.0001; la += 0.05) {
    for (let lb = -1.5; lb <= 1.5001; lb += 0.05) {
      const a = Math.pow(10, la), b = Math.pow(10, lb), e = sse(a, b);
      if (e < bestE) { bestE = e; bestA = a; bestB = b; }
    }
  }
  for (let step = 0.02; step > 1e-4; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const a = bestA * Math.pow(10, da), b = bestB * Math.pow(10, db), e = sse(a, b);
        if (e < bestE - 1e-12) { bestE = e; bestA = a; bestB = b; improved = true; }
      }
    }
  }
  return [bestA, bestB];
}

function fuzzySimplicialSet(nbr, nbd, k) {
  const target = Math.log2(k);
  const P = new Float64Array(N * k);
  for (let i = 0; i < N; i++) {
    const rho = nbd[i * k];
    let lo = 0, hi = Infinity, sigma = 1;
    for (let it = 0; it < 64; it++) {
      let s = 0;
      for (let r = 0; r < k; r++) s += Math.exp(-Math.max(0, nbd[i * k + r] - rho) / sigma);
      if (Math.abs(s - target) < 1e-5) break;
      if (s > target) { hi = sigma; sigma = (lo + hi) / 2; }
      else { lo = sigma; sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2; }
    }
    for (let r = 0; r < k; r++) P[i * k + r] = Math.exp(-Math.max(0, nbd[i * k + r] - rho) / sigma);
  }
  const emap = new Map();
  for (let i = 0; i < N; i++) {
    for (let r = 0; r < k; r++) {
      const j = nbr[i * k + r];
      if (j < 0) continue;
      const key = i < j ? i * N + j : j * N + i;
      const cur = emap.get(key);
      if (cur === undefined) emap.set(key, [Math.min(i, j), Math.max(i, j), P[i * k + r], 0]);
      else cur[3] = P[i * k + r];
    }
  }
  return [...emap.values()].map(([i, j, a, b]) => [i, j, a + b - a * b]);
}

function layout(edges, A, B) {
  const { epochs, negativeSamples: NEG, gamma } = PARAMS;
  const rnd = lcg(PARAMS.seed);
  // Initialised from the first two vector components, exactly as Illinois is.
  const Y = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) { Y[i * 2] = X[i * D]; Y[i * 2 + 1] = X[i * D + 1]; }
  let mx = 0;
  for (let i = 0; i < N * 2; i++) mx = Math.max(mx, Math.abs(Y[i]));
  for (let i = 0; i < N * 2; i++) Y[i] = (Y[i] / mx) * 10 + (rnd() - 0.5) * 1e-3;

  let maxW = 0;
  for (const e of edges) if (e[2] > maxW) maxW = e[2];
  const perSample = edges.map((e) => (e[2] > 0 ? maxW / e[2] : Infinity));
  const nextEpoch = perSample.slice();

  for (let ep = 0; ep < epochs; ep++) {
    const alpha = 1.0 * (1 - ep / epochs);
    for (let e = 0; e < edges.length; e++) {
      if (nextEpoch[e] > ep) continue;
      const i = edges[e][0], j = edges[e][1];
      let dx = Y[i * 2] - Y[j * 2], dy = Y[i * 2 + 1] - Y[j * 2 + 1];
      let d2 = dx * dx + dy * dy;
      const g = d2 > 0 ? (-2 * A * B * Math.pow(d2, B - 1)) / (A * Math.pow(d2, B) + 1) : 0;
      const cx = Math.max(-4, Math.min(4, g * dx)) * alpha;
      const cy = Math.max(-4, Math.min(4, g * dy)) * alpha;
      Y[i * 2] += cx; Y[i * 2 + 1] += cy;
      Y[j * 2] -= cx; Y[j * 2 + 1] -= cy;
      for (let n = 0; n < NEG; n++) {
        const c = (rnd() * N) | 0;
        if (c === i) continue;
        dx = Y[i * 2] - Y[c * 2]; dy = Y[i * 2 + 1] - Y[c * 2 + 1];
        d2 = dx * dx + dy * dy;
        const gg = d2 > 0 ? (2 * gamma * B) / ((0.001 + d2) * (A * Math.pow(d2, B) + 1)) : 4;
        Y[i * 2] += Math.max(-4, Math.min(4, gg * dx)) * alpha;
        Y[i * 2 + 1] += Math.max(-4, Math.min(4, gg * dy)) * alpha;
      }
      nextEpoch[e] += perSample[e];
    }
  }
  return Y;
}

function linearNormalise(Y) {
  const out = new Float64Array(N * 2);
  for (const axis of [0, 1]) {
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < N; i++) {
      const value = Y[i * 2 + axis];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    const span = high - low;
    for (let i = 0; i < N; i++) {
      out[i * 2 + axis] = span === 0
        ? (MAP_LOW + MAP_HIGH) / 2
        : MAP_LOW + ((Y[i * 2 + axis] - low) / span) * (MAP_HIGH - MAP_LOW);
    }
  }
  return out;
}

/** Identical vectors (cross-listed twins, same-text seminars) fanned out so each is its own dot. */
function fanOutDuplicates(coords, nbr, nbd, k) {
  const parent = [...Array(N).keys()];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  for (let i = 0; i < N; i++) {
    for (let r = 0; r < k; r++) {
      const j = nbr[i * k + r];
      if (j >= 0 && nbd[i * k + r] <= 1e-4) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < N; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  const GOLDEN = (137.507 * Math.PI) / 180;
  const SEP = 0.35;
  let moved = 0, groupCount = 0;
  const largest = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    groupCount++;
    const m = members.length;
    let cx = 0, cy = 0;
    for (const i of members) { cx += coords[i * 2]; cy += coords[i * 2 + 1]; }
    cx /= m; cy /= m;
    members.sort((a, b) => a - b);
    const ring = m * SEP <= 2 * Math.PI * SEP;
    members.forEach((i, idx) => {
      const ang = idx * GOLDEN;
      const radius = ring ? SEP : SEP * Math.sqrt(idx);
      coords[i * 2] = Math.max(MAP_LOW, Math.min(MAP_HIGH, cx + radius * Math.cos(ang)));
      coords[i * 2 + 1] = Math.max(MAP_LOW, Math.min(MAP_HIGH, cy + radius * Math.sin(ang)));
      moved++;
    });
    largest.push([m, members.map((i) => laidOut[i])]);
  }
  largest.sort((a, b) => b[0] - a[0]);
  return { groupCount, moved, largest: largest.slice(0, 3) };
}

/* ------------------------------------------------------------- the run -- */

console.log(`georgia tech course map: ${N} courses (${stored.size} stored vectors, ${embeddedHere.vectors.size} embedded here) from a catalog fetched ${catalog.fetchedAt}`);
if (meta.catalogFetchedAt !== catalog.fetchedAt) {
  console.log(`  note: the vectors were built from the catalog of ${meta.catalogFetchedAt}; rerun embed-courses.mjs gatech to refresh them`);
}

const [A, B] = fitAB(PARAMS.spread, PARAMS.minDist);
if (!(A > 0.5 && A < 5) || !(B > 0.3 && B < 3)) {
  console.error(`\n!! UMAP curve fit diverged: a=${A} b=${B}. Every coordinate would be NaN. Nothing written.`);
  process.exit(1);
}

let t0 = Date.now();
const { nbr, nbd } = knn(PARAMS.neighbors);
console.log(`kNN k=${PARAMS.neighbors} in ${secs(t0)}`);
const edges = fuzzySimplicialSet(nbr, nbd, PARAMS.neighbors);
console.log(`fuzzy simplicial set: ${edges.length} edges`);
t0 = Date.now();
const raw = layout(edges, A, B);
console.log(`layout in ${secs(t0)}`);

const coords = linearNormalise(raw);
const preRosette = Float64Array.from(coords);
const rosette = fanOutDuplicates(coords, nbr, nbd, PARAMS.neighbors);
console.log(`duplicate rosettes: ${rosette.groupCount} groups, ${rosette.moved} courses nudged`);

/**
 * The fallback for missing courses when the model would not load: next to
 * the subject's centre, at a small hashed offset, as apply-uga-pacmap.mjs does.
 */
const placedBySubject = new Map();
const leftOut = [];
if (embeddedHere.error) {
  const centre = new Map();
  laidOut.forEach((code, i) => {
    const s = subjectOf(code);
    const b = centre.get(s) ?? { x: 0, y: 0, n: 0 };
    b.x += coords[i * 2]; b.y += coords[i * 2 + 1]; b.n += 1;
    centre.set(s, b);
  });
  const hash = (text) => Array.from(text).reduce((v, ch) => (v * 31 + ch.charCodeAt(0)) >>> 0, 17);
  for (const code of missing) {
    const b = centre.get(subjectOf(code));
    if (!b) { leftOut.push(code); continue; }
    const seed = hash(code);
    const angle = ((seed % 360) * Math.PI) / 180;
    const radius = 0.45 + ((seed >>> 9) % 160) / 100;
    placedBySubject.set(code, {
      x: Math.min(MAP_HIGH, Math.max(MAP_LOW, b.x / b.n + Math.cos(angle) * radius)),
      y: Math.min(MAP_HIGH, Math.max(MAP_LOW, b.y / b.n + Math.sin(angle) * radius)),
    });
  }
}

/* ---------------------------------------------------------- self-check -- */

const failures = [];
const line = (s = '') => console.log(s);
const hi2 = (i, j) => { let a = 0; for (let d = 0; d < D; d++) a += X[i * D + d] * X[j * D + d]; return 1 - a; };
const flat2 = (Y) => (i, j) => { const dx = Y[i * 2] - Y[j * 2], dy = Y[i * 2 + 1] - Y[j * 2 + 1]; return dx * dx + dy * dy; };
const lo2 = flat2(coords);
function nearest(i, metric, n) {
  const d = new Float64Array(N);
  for (let j = 0; j < N; j++) d[j] = metric(i, j);
  d[i] = Infinity;
  const out = [];
  for (let r = 0; r < n; r++) {
    let best = -1, bv = Infinity;
    for (let j = 0; j < N; j++) if (d[j] < bv) { bv = d[j]; best = j; }
    d[best] = Infinity;
    out.push(best);
  }
  return out;
}

line('\n================ self-check ================');

const sourceCounts = { 'title+description': 0, 'title-only': 0 };
for (const code of laidOut) sourceCounts[textSourceOf(code)]++;
const subjects = new Map();
laidOut.forEach((code, i) => { const s = subjectOf(code); if (!subjects.has(s)) subjects.set(s, []); subjects.get(s).push(i); });
line('\n[1] corpus');
line(`    courses ${N}   subjects ${subjects.size}   stored vectors ${stored.size}   embedded here ${embeddedHere.vectors.size}   placed by subject ${placedBySubject.size}   left off ${leftOut.length}`);
if (embeddedHere.vectors.size) line(`    embedded here: ${[...embeddedHere.vectors.keys()].join(', ')}`);
line(`    text source: title+description ${sourceCounts['title+description']}, title-only ${sourceCounts['title-only']}`);
const indexCovered = indexCodes.filter((c) => indexOf.has(c) || placedBySubject.has(c)).length;
line(`    index rows with a position: ${indexCovered} of ${indexCodes.length}`);
const titleOnlyShare = sourceCounts['title-only'] / N;
if (titleOnlyShare > 0.2) failures.push(`${(100 * titleOnlyShare).toFixed(1)}% of courses are title-only, over the 20% limit`);
if (N < 1000) failures.push(`only ${N} courses to map; the vectors file looks partial`);

line('\n[2] umap curve fit');
line(`    min_dist ${PARAMS.minDist} spread ${PARAMS.spread}  ->  a=${A.toFixed(4)} b=${B.toFixed(4)}   (expect a~1.577 b~0.895)`);

line('\n[3] named-course neighbours, 384-D and final 2-D');
line('    (a weak 2-D row for one course is normal, see the tear rate in block 5)');
const PROBES = [
  ['CS 1331', 'CS 1332, CS 1301, CS 1371, CS 1315: the intro programming sequence'],
  ['MATH 1552', 'MATH 1551, 1553, 1554, 2551, 2550: calculus and linear algebra'],
  ['CHEM 1211K', 'CHEM 1212K, CHEM 1310, CHEM 1315: general chemistry'],
  ['PSYC 1101', 'PSYC and NEUR courses'],
  ['HIST 2111', 'HIST 2112, HTS and INTA history courses'],
];
for (const [code, expect] of PROBES) {
  const i = indexOf.get(code);
  if (i === undefined) { line(`    ${code} NOT MAPPED`); continue; }
  line(`\n    ${code}  ${catalogByCode.get(code)?.title ?? ''}`);
  line(`      384-D: ${nearest(i, hi2, 8).map((j) => laidOut[j]).join('  ')}`);
  line(`        2-D: ${nearest(i, lo2, 8).map((j) => laidOut[j]).join('  ')}`);
  line(`     expect: ${expect}`);
}

const centroid = new Map();
for (const [s, idxs] of subjects) {
  let cx = 0, cy = 0;
  for (const i of idxs) { cx += coords[i * 2]; cy += coords[i * 2 + 1]; }
  centroid.set(s, [cx / idxs.length, cy / idxs.length]);
}
line('\n[4] subject centroid neighbours in 2-D (no subject token was used)');
for (const s of ['MATH', 'CS', 'ECE', 'CHEM', 'BIOS', 'PSYC', 'SPAN', 'CEE', 'HIST', 'MGT']) {
  if (!centroid.has(s)) { line(`    ${s.padEnd(6)} not mapped`); continue; }
  const [ax, ay] = centroid.get(s);
  const near = [...centroid].filter(([o]) => o !== s)
    .map(([o, [ox, oy]]) => [o, Math.hypot(ax - ox, ay - oy)])
    .sort((p, q) => p[1] - q[1]).slice(0, 5).map(([o]) => o);
  line(`    ${s.padEnd(6)} -> ${near.join(' ')}`);
}

const evalRnd = lcg(99);
const preLo2 = flat2(preRosette);
let hit = 0, total = 0, hitPre = 0;
const closestRanks = [];
for (let s = 0; s < 200; s++) {
  const i = (evalRnd() * N) | 0;
  const far = nearest(i, hi2, 30);
  const farSet = new Set(far);
  for (const j of nearest(i, lo2, 10)) { total++; if (farSet.has(j)) hit++; }
  for (const j of nearest(i, preLo2, 10)) if (farSet.has(j)) hitPre++;
  const d0 = lo2(i, far[0]);
  let rank = 1;
  for (let j = 0; j < N; j++) if (j !== i && lo2(i, j) < d0) rank++;
  closestRanks.push(rank);
}
const preservation = hit / total;
const preservationPreRosette = hitPre / total;
closestRanks.sort((a, b) => a - b);
const rankPct = (p) => closestRanks[Math.floor((closestRanks.length - 1) * p)];
const within = (r) => (100 * closestRanks.filter((x) => x <= r).length) / closestRanks.length;

/** Mean pairwise 2-D distance inside a subject over the global mean: under 1 means the subject clusters. */
function cohesionOf(pts, groups, minSize) {
  const meanPairwise = (idxs, cap) => {
    let s = 0, n = 0;
    const m = Math.min(idxs.length, cap);
    for (let a = 0; a < m; a++) {
      for (let b = a + 1; b < m; b++) {
        const i = idxs[a], j = idxs[b];
        s += Math.hypot(pts[i * 2] - pts[j * 2], pts[i * 2 + 1] - pts[j * 2 + 1]);
        n++;
      }
    }
    return n ? s / n : 0;
  };
  const all = [...Array(pts.length / 2).keys()];
  const globalMean = meanPairwise(all, 300);
  const rows = [...groups].filter(([, v]) => v.length >= minSize).map(([s, v]) => [s, v.length, meanPairwise(v, 150) / globalMean]);
  const sorted = rows.map(([, , r]) => r).sort((a, b) => a - b);
  return { rows, median: sorted.length ? sorted[sorted.length >> 1] : 0 };
}

/** Share of each course's ten nearest dots on the map that are the same subject. */
function subjectPurity(pts, subjectOfIndex, samples) {
  const n = pts.length / 2;
  const rnd = lcg(7);
  let same = 0, seen = 0;
  for (let s = 0; s < samples; s++) {
    const i = (rnd() * n) | 0;
    const best = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = (pts[i * 2] - pts[j * 2]) ** 2 + (pts[i * 2 + 1] - pts[j * 2 + 1]) ** 2;
      if (best.length < 10 || d < best[best.length - 1][0]) {
        best.push([d, j]);
        best.sort((a, b) => a[0] - b[0]);
        if (best.length > 10) best.pop();
      }
    }
    for (const [, j] of best) { seen++; if (subjectOfIndex[j] === subjectOfIndex[i]) same++; }
  }
  return same / seen;
}

const COHESION_MIN = 40;
const cohesion = cohesionOf(coords, subjects, COHESION_MIN);
const occupied = new Set();
for (let i = 0; i < N; i++) {
  const gx = Math.min(95, Math.floor(coords[i * 2])), gy = Math.min(95, Math.floor(coords[i * 2 + 1]));
  occupied.add(gx * 100 + gy);
}

line('\n[5] aggregates');
line(`    neighbourhood preservation (10 of 30, 200 samples): ${(100 * preservation).toFixed(1)}%  (Illinois expects 55-65%)`);
line(`      before the duplicate fan-out: ${(100 * preservationPreRosette).toFixed(1)}%   cost of the fan-out: ${(100 * (preservationPreRosette - preservation)).toFixed(1)} points`);
line(`    2-D rank of each course's single closest 384-D relative: median ${rankPct(0.5)} of ${N - 1}, p90 ${rankPct(0.9)}, worst ${closestRanks[closestRanks.length - 1]}`);
line(`      in the 2-D top 10: ${within(10).toFixed(0)}%   top 100: ${within(100).toFixed(0)}%   torn past 300: ${(100 - within(300)).toFixed(0)}%`);
line(`    occupied cells on a 1% grid: ${occupied.size} / 8464`);
line('    largest duplicate groups (identical vectors, fanned out):');
for (const [m, codes] of rosette.largest) {
  const shown = codes.slice(0, 6).join(' ') + (codes.length > 6 ? ` ... +${codes.length - 6} more` : '');
  line(`      ${String(m).padStart(3)} courses  "${catalogByCode.get(codes[0])?.title ?? ''}"  ${shown}`);
}
line(`    subject cohesion, 10 largest subjects (within-subject mean 2-D distance / global mean; under 1 clusters):`);
for (const [s, n, r] of [...cohesion.rows].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  line(`      ${s.padEnd(6)} n=${String(n).padStart(4)}  ratio ${r.toFixed(2)}`);
}
line(`    median ratio over the ${cohesion.rows.length} subjects with n>=${COHESION_MIN}: ${cohesion.median.toFixed(2)}`);
if (preservation < 0.45) failures.push(`neighbourhood preservation ${(100 * preservation).toFixed(1)}% is under 45%, the projection is not carrying the vectors`);
if (cohesion.median >= 0.9) failures.push(`subject cohesion median ${cohesion.median.toFixed(2)}: subjects are not clustering, the map would read as noise`);

let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, nonFinite = 0;
const allPoints = [...Array(N).keys()].map((i) => [coords[i * 2], coords[i * 2 + 1]]).concat([...placedBySubject.values()].map((p) => [p.x, p.y]));
for (const [x, y] of allPoints) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) { nonFinite++; continue; }
  if (x < xmin) xmin = x; if (x > xmax) xmax = x;
  if (y < ymin) ymin = y; if (y > ymax) ymax = y;
}
line('\n[6] coordinates');
line(`    x range [${xmin.toFixed(2)}, ${xmax.toFixed(2)}]   y range [${ymin.toFixed(2)}, ${ymax.toFixed(2)}]   non-finite ${nonFinite}`);
if (nonFinite > 0) failures.push(`${nonFinite} coordinates are not finite`);
if (!(xmin >= MAP_LOW && xmax <= MAP_HIGH && ymin >= MAP_LOW && ymax <= MAP_HIGH)) failures.push(`coordinates escaped the ${MAP_LOW}..${MAP_HIGH} box: x [${xmin}, ${xmax}] y [${ymin}, ${ymax}]`);

/**
 * Block 7: the same two clustering numbers on the Illinois map, read-only, so
 * "subjects cluster like Illinois's" is a measurement and not an impression.
 */
const purity = subjectPurity(coords, laidOut.map(subjectOf), 300);
line('\n[7] compared with the Illinois map');
if (existsSync(ILLINOIS_MAP)) {
  const il = JSON.parse(readFileSync(ILLINOIS_MAP, 'utf8')).courses.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
  const ilPts = new Float64Array(il.length * 2);
  il.forEach((c, i) => { ilPts[i * 2] = c.x; ilPts[i * 2 + 1] = c.y; });
  const ilSubjects = new Map();
  il.forEach((c, i) => { const s = subjectOf(norm(c.code)); if (!ilSubjects.has(s)) ilSubjects.set(s, []); ilSubjects.get(s).push(i); });
  const ilCohesion = cohesionOf(ilPts, ilSubjects, 60);
  const ilPurity = subjectPurity(ilPts, il.map((c) => subjectOf(norm(c.code))), 300);
  line(`    same-subject share of the 10 nearest dots:  Georgia Tech ${(100 * purity).toFixed(0)}%   Illinois ${(100 * ilPurity).toFixed(0)}%`);
  line(`    median subject cohesion ratio:              Georgia Tech ${cohesion.median.toFixed(2)}   Illinois ${ilCohesion.median.toFixed(2)}   (lower clusters tighter)`);
  line(`    subjects: Georgia Tech ${subjects.size} over ${N} courses, Illinois ${ilSubjects.size} over ${il.length}`);
} else {
  line(`    same-subject share of the 10 nearest dots: Georgia Tech ${(100 * purity).toFixed(0)}%   (public/illinois-map.json not found)`);
}

if (failures.length) {
  line('\n!! FAILED');
  for (const f of failures) line(`!! ${f}`);
  line('!! Nothing written. A map that parses and renders but means nothing is worse than no map.');
  process.exit(1);
}

/* ---------------------------------------------------------------- out -- */

const rows = laidOut.map((code, i) => ({
  code,
  x: +coords[i * 2].toFixed(2),
  y: +coords[i * 2 + 1].toFixed(2),
  rawX: +raw[i * 2].toFixed(6),
  rawY: +raw[i * 2 + 1].toFixed(6),
  textSource: textSourceOf(code),
  ...(embeddedHere.vectors.has(code) ? { vector: 'embedded-here' } : {}),
}));
for (const [code, p] of placedBySubject) {
  rows.push({ code, x: +p.x.toFixed(2), y: +p.y.toFixed(2), rawX: null, rawY: null, textSource: textSourceOf(code), vector: 'none, placed by subject' });
}
rows.sort((a, b) => byCode(a.code, b.code));

writeFileSync(OUT, JSON.stringify({
  school: 'gatech',
  method: `all-MiniLM-L6-v2 (${D}d, public/gatech/course-vectors) -> umap(k=${PARAMS.neighbors}, min_dist=${PARAMS.minDist}) -> linearly-normalised 3..97`,
  builtAt: new Date().toISOString(),
  catalogFetchedAt: catalog.fetchedAt,
  vectorsCatalogFetchedAt: meta.catalogFetchedAt,
  count: rows.length,
  vocabulary: 0,
  params: { ...PARAMS, a: +A.toFixed(4), b: +B.toFixed(4) },
  quality: {
    neighbourPreservation: +preservation.toFixed(3),
    subjectCohesionMedian: +cohesion.median.toFixed(2),
    subjectPurity10: +purity.toFixed(3),
    textSourceCounts: sourceCounts,
    vectors: { stored: stored.size, embeddedHere: embeddedHere.vectors.size, placedBySubject: placedBySubject.size, leftOff: leftOut },
  },
  courses: rows,
}));
line(`\nwrote ${OUT} (${rows.length} courses) in ${secs(t00)}`);
