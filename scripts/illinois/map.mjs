/**
 * Where every Illinois course sits on the semantic map, computed from what the
 * catalog says about the course and from nothing else.
 *
 * The explorer positions each node at mapPosition.x/y as a CSS percentage
 * (components/planner/course-explorer.tsx). With no map file Illinois falls
 * back to fallbackPosition(), which hashes the course id: a random scatter
 * that looks meaningful and is not. That is the trap this file exists to close.
 *
 * Method, all of it in this file with no dependencies and deterministic from
 * seed 42: TF-IDF over title and cleaned description (unigrams and bigrams),
 * truncated SVD to 128 dimensions, exact cosine kNN, a UMAP
 * fuzzy-simplicial-set layout, then rank normalisation into 4..96.
 *
 * This is distributional semantics, not a transformer embedding, and the
 * difference matters when someone reads the map. Two courses land near each
 * other when their descriptions draw on the same vocabulary, or when both
 * vocabularies co-occur with a third somewhere in the corpus. It cannot read
 * paraphrase across disjoint vocabularies and it cannot see negation. Above
 * all it knows nothing about level or sequence: MATH 241's nearest neighbours
 * include graduate analysis courses. Position means topic. Prerequisite lines,
 * which the explorer already draws, mean order. UI copy must not blur the two.
 *
 * Subject is deliberately NOT in the vector. Feed it "CS" and CS courses
 * cluster by construction, and the map becomes a department chart wearing a
 * semantic map's clothes. They cluster anyway, and that they do is the only
 * evidence this map is real. Block 4 of the self-check prints that evidence on
 * every run, so that whoever later adds a subject token can see what broke.
 *
 * Output is public/illinois-map.json, keyed by course code and deliberately
 * kept out of public/illinois-catalog.json, because the weekly crawl rewrites
 * the catalog wholesale and would silently destroy an expensive derived file.
 *
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" node scripts/illinois/map.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CATALOG = join(ROOT, 'public', 'illinois-catalog.json');
const OUT = join(ROOT, 'public', 'illinois-map.json');

const PARAMS = {
  titleWeight: 3,
  minDf: 3,
  maxDfRatio: 0.25,
  svdDims: 128,
  neighbors: 15,
  minDist: 0.1,
  spread: 1.0,
  epochs: 300,
  negativeSamples: 5,
  gamma: 1.0,
  seed: 42,
};

/** One LCG shared by every random draw in the build, so reruns are identical. */
function lcg(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

/* ------------------------------------------------------------------ load -- */

/**
 * The catalog crawl takes about twenty minutes and this script is often
 * started while it is still running. Reading a partial file would produce a
 * map of two hundred courses that parses, renders, and is wrong, so wait for a
 * plausible catalog instead. JSON.parse is inside the try because a file
 * caught mid-write is truncated, not merely short.
 */
async function loadCatalog() {
  const MIN_COURSES = 1000;
  const deadline = Date.now() + 20 * 60 * 1000;
  for (;;) {
    let parsed = null;
    if (existsSync(CATALOG)) {
      try { parsed = JSON.parse(readFileSync(CATALOG, 'utf8')); } catch { parsed = null; }
    }
    const n = parsed?.courses?.length ?? 0;
    if (n >= MIN_COURSES) return parsed;
    if (Date.now() > deadline) {
      console.error(`\n!! ${CATALOG} still holds ${n} courses after 20 minutes of waiting.`);
      console.error('!! Run scripts/illinois/courses.mjs and let it finish before mapping.');
      process.exit(1);
    }
    console.log(`waiting for the catalog crawl: ${n} courses so far, need ${MIN_COURSES}. retrying in 30s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

const catalog = await loadCatalog();

// Every later stage addresses courses by array index, so a stable order is
// what makes two builds of the same catalog byte-identical. The crawl emits
// subjects in whatever order the index page lists them, which is not stable.
const courses = catalog.courses.slice().sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
const N = courses.length;
const indexOf = new Map(courses.map((c, i) => [c.code, i]));

/* -------------------------------------------------------- stage A: text -- */

/**
 * Administrative sentences the catalog repeats across thousands of courses.
 * They are shared vocabulary that says nothing about content: 2,454 courses
 * carry "graduate hours" and 2,042 carry "May be repeated", and left in they
 * pull unrelated departments together for purely clerical reasons.
 */
const BOILERPLATE = [
  /\[IAI Code:[^\]]*\]/gi,
  /\bSame as [^.]*\./gi,
  /\bSee [A-Z]{2,4}\s*\d{3}\s*\./g,
  /Credit is not given[^.]*\./gi,
  /Credit is not given toward graduation for:/gi,
  /May be repeated[^.]*\./gi,
  /Approved for (?:letter and S\/U|S\/U|both letter and S\/U)[^.]*\./gi,
  /\b\d+\s*(?:to\s*\d+\s*)?(?:undergraduate|graduate|professional)\s+hours?\.?/gi,
  /See Class Schedule[^.]*\./gi,
  /This course (?:is approved|satisfies)[^.]*\.?/gi,
  // courses.mjs cuts the description at the gen-ed sentence, which leaves this
  // two-word fragment dangling on the end of several hundred descriptions.
  /\bThis course\s*$/i,
  // Prerequisite prose is mostly course codes and "one of". Including it would
  // conflate "related topic" with "comes after" and blur what position means.
  /Prerequisite[s]?:[\s\S]*$/i,
];

function stripBoilerplate(description) {
  let s = description || '';
  for (const re of BOILERPLATE) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const MIN_TEXT = 25;
const cleaned = new Map(courses.map((c) => [c.code, stripBoilerplate(c.description)]));

// 1,264 courses have no description of their own, only "Same as X. See X."
// Two passes, because a pointer can point at another pointer.
for (let pass = 0; pass < 2; pass++) {
  for (const c of courses) {
    if (cleaned.get(c.code).length >= MIN_TEXT) continue;
    let best = '';
    for (const alias of c.sameAs || []) {
      const t = cleaned.get(alias) || '';
      if (t.length > best.length) best = t;
    }
    if (best.length >= MIN_TEXT) cleaned.set(c.code, best);
  }
}

const prepared = courses.map((c) => {
  const text = cleaned.get(c.code);
  const own = stripBoilerplate(c.description).length >= MIN_TEXT;
  return {
    code: c.code,
    title: c.title || '',
    text,
    // Recorded so the inspector can say "placed from the title only" rather
    // than presenting a guess with the same confidence as a real placement.
    textSource: text.length < MIN_TEXT ? 'title-only' : own ? 'title+description' : 'title+crosslist',
  };
});

/* ---------------------------------------------------- stage B: vectors -- */

const STOPWORDS = new Set((
  'a about above after again against all am an and any are as at be because been before being below ' +
  'between both but by can cannot could did do does doing down during each few for from further had has have having he her here ' +
  'hers herself him himself his how i if in into is it its itself me more most my myself no nor not of off on once only or other ' +
  'ought our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these ' +
  'they this those through to too under until up very was we were what when where which while who whom why will with would you ' +
  'your yours yourself yourselves also may must shall upon within without use used using include including includes various'
).split(/\s+/));

/**
 * Unigrams, then bigrams built from the surviving stream rather than the raw
 * one. On 44-word descriptions that is what captures "organic_chemistry" and
 * "machine_learning" instead of pairs glued together by a stopword.
 */
function tokenise(text) {
  const words = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/)
    .filter((t) => t.length >= 3 && t.length <= 24 && !STOPWORDS.has(t));
  const out = words.slice();
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]}_${words[i + 1]}`);
  return out;
}

/**
 * The only stage that knows how text becomes numbers. Takes [{ title, text }]
 * and returns N rows of D L2-normalised doubles in the same order, so stages C
 * and D never learn where the numbers came from. Swapping in a transformer
 * later (MiniLM, mean pooled, D=384) means replacing this function and nothing
 * else, which keeps the self-check numbers directly comparable between the two.
 */
/**
 * Stage B, the real one: sentence embeddings from all-MiniLM-L6-v2.
 *
 * This is the same model Orion embeds UGA courses with, run locally through
 * ONNX, so the Illinois half of the map is built the same way as the UGA half
 * rather than by a different method that happens to produce coordinates.
 *
 * It replaced TF-IDF because TF-IDF reads words, not meaning, and the flagship
 * failure was visible on the flagship course: "CS 225 Data Structures" came out
 * next to "ADV 200 Data Literacy" and "ATMS 315 Meteorological Instrumentation"
 * because all three say "data". Measured cosine to CS 225 under this model:
 * Algorithms and Models of Computation 0.504, Data Literacy 0.189,
 * Meteorological Instrumentation 0.064. The model knows what a data structure is.
 *
 * TF-IDF stays below as the fallback, because this needs a 90MB model download
 * the first time and the script must still run on a machine that cannot get it.
 */
async function buildVectorsEmbedded(docs, catalogFetchedAt) {
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const CACHE = 'data/illinois-embeddings.bin';
  const META = 'data/illinois-embeddings.json';
  const D = 384;

  // Keyed on the catalog snapshot AND the course count, so re-crawling the
  // catalog invalidates it and a partial catalog cannot masquerade as a full one.
  const key = { model: 'Xenova/all-MiniLM-L6-v2', dims: D, count: docs.length, catalogFetchedAt };
  if (existsSync(CACHE) && existsSync(META)) {
    const meta = JSON.parse(readFileSync(META, 'utf8'));
    if (JSON.stringify(meta) === JSON.stringify(key)) {
      const buf = readFileSync(CACHE);
      console.log(`  embeddings read from cache (${docs.length} x ${D})`);
      return { X: new Float64Array(buf.buffer, buf.byteOffset, docs.length * D), dims: D, vocabulary: 0, nnz: docs.length * D, singular: [], method: 'minilm' };
    }
    console.log('  embedding cache is stale, recomputing');
  }

  const { pipeline } = await import('@huggingface/transformers');
  const t0 = Date.now();
  const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
  process.stdout.write(`  model loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s, embedding ${docs.length} courses`);

  const X = new Float64Array(docs.length * D);
  const BATCH = 64;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    // The title is repeated so it carries roughly the weight the TF-IDF path
    // gave it, and so a title-only course still produces a sentence.
    const out = await fe(
      slice.map((d) => `${d.title}. ${d.title}. ${d.text}`.slice(0, 1200)),
      { pooling: 'mean', normalize: true },
    );
    for (let j = 0; j < slice.length; j++) {
      for (let k = 0; k < D; k++) X[(i + j) * D + k] = out.data[j * D + k];
    }
    if (i % (BATCH * 20) === 0) process.stdout.write('.');
  }
  process.stdout.write(`\n  embedded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  mkdirSync('data', { recursive: true });
  writeFileSync(CACHE, Buffer.from(X.buffer, X.byteOffset, X.length * 8));
  writeFileSync(META, JSON.stringify(key));
  console.log(`  embeddings cached to ${CACHE}`);
  return { X, dims: D, vocabulary: 0, nnz: docs.length * D, singular: [], method: 'minilm' };
}

function buildVectors(docs) {
  const { titleWeight, minDf, maxDfRatio, svdDims: K } = PARAMS;

  // Titles are pure signal with no boilerplate, descriptions here are short
  // (median 44 words), and for the title-only courses the title is all there
  // is. Hence the 3x, which is the weight the neighbour checks were tuned at.
  const bags = docs.map((d) => {
    const bag = new Map();
    for (const t of tokenise(d.title)) bag.set(t, (bag.get(t) || 0) + titleWeight);
    for (const t of tokenise(d.text)) bag.set(t, (bag.get(t) || 0) + 1);
    return bag;
  });

  const df = new Map();
  for (const bag of bags) for (const term of bag.keys()) df.set(term, (df.get(term) || 0) + 1);

  // min-df kills typos and one-off proper nouns. max-df removes whatever
  // boilerplate survived the regexes, from the data rather than from a
  // hand-maintained list that somebody has to keep in step with the catalog.
  const maxDf = Math.floor(N * maxDfRatio);
  const vocab = new Map();
  for (const [term, n] of df) if (n >= minDf && n <= maxDf) vocab.set(term, vocab.size);
  const V = vocab.size;

  const idf = new Float64Array(V);
  for (const [term, col] of vocab) idf[col] = Math.log((N + 1) / (df.get(term) + 1)) + 1;

  const rowPtr = new Int32Array(N + 1);
  let nnz = 0;
  for (let i = 0; i < N; i++) {
    for (const term of bags[i].keys()) if (vocab.has(term)) nnz++;
    rowPtr[i + 1] = nnz;
  }
  const colIdx = new Int32Array(nnz);
  const val = new Float64Array(nnz);
  let p = 0;
  for (let i = 0; i < N; i++) {
    const start = p;
    for (const [term, tf] of bags[i]) {
      const col = vocab.get(term);
      if (col === undefined) continue;
      colIdx[p] = col;
      val[p] = (1 + Math.log(tf)) * idf[col];   // sublinear tf: five uses is not five times the signal
      p++;
    }
    let norm = 0;
    for (let q = start; q < p; q++) norm += val[q] * val[q];
    norm = Math.sqrt(norm) || 1;
    for (let q = start; q < p; q++) val[q] /= norm;
  }

  // Randomised truncated SVD. Two components would give "science vs
  // humanities" and "intro vs graduate" with everything else piled at the
  // origin; the semantic content lives in the first hundred or so, and the
  // neighbour embedding in stage C is what turns those into a readable plane.
  const rnd = lcg(PARAMS.seed);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rnd();
    while (!v) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const matA = (Om) => {
    const Y = new Float64Array(N * K);
    for (let i = 0; i < N; i++) {
      for (let q = rowPtr[i]; q < rowPtr[i + 1]; q++) {
        const c = colIdx[q], v0 = val[q];
        for (let k = 0; k < K; k++) Y[i * K + k] += v0 * Om[c * K + k];
      }
    }
    return Y;
  };
  const matAT = (Y) => {
    const Z = new Float64Array(V * K);
    for (let i = 0; i < N; i++) {
      for (let q = rowPtr[i]; q < rowPtr[i + 1]; q++) {
        const c = colIdx[q], v0 = val[q];
        for (let k = 0; k < K; k++) Z[c * K + k] += v0 * Y[i * K + k];
      }
    }
    return Z;
  };
  const orth = (M, rows) => {
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < k; j++) {
        let d = 0;
        for (let i = 0; i < rows; i++) d += M[i * K + k] * M[i * K + j];
        for (let i = 0; i < rows; i++) M[i * K + k] -= d * M[i * K + j];
      }
      let n = 0;
      for (let i = 0; i < rows; i++) n += M[i * K + k] * M[i * K + k];
      n = Math.sqrt(n) || 1;
      for (let i = 0; i < rows; i++) M[i * K + k] /= n;
    }
    return M;
  };

  const Om = new Float64Array(V * K);
  for (let i = 0; i < V * K; i++) Om[i] = gauss();
  let Q = orth(matA(Om), N);
  // A course catalog has a slowly decaying spectrum, and power iterations are
  // what separate the leading subspace from the noise underneath it.
  for (let it = 0; it < 4; it++) Q = orth(matA(matAT(Q)), N);

  const B = matAT(Q);                       // V x K, the transpose of Q^T A
  const G = new Float64Array(K * K);
  for (let c = 0; c < V; c++) {
    for (let a = 0; a < K; a++) {
      const va = B[c * K + a];
      if (!va) continue;
      for (let b = a; b < K; b++) G[a * K + b] += va * B[c * K + b];
    }
  }
  for (let a = 0; a < K; a++) for (let b = 0; b < a; b++) G[a * K + b] = G[b * K + a];

  const Ev = new Float64Array(K * K);
  for (let i = 0; i < K; i++) Ev[i * K + i] = 1;
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) off += G[a * K + b] * G[a * K + b];
    if (off < 1e-12) break;
    for (let a = 0; a < K; a++) {
      for (let b = a + 1; b < K; b++) {
        if (Math.abs(G[a * K + b]) < 1e-14) continue;
        const theta = (G[b * K + b] - G[a * K + a]) / (2 * G[a * K + b]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c0 = 1 / Math.sqrt(t * t + 1), s0 = t * c0;
        for (let k = 0; k < K; k++) { const ga = G[a * K + k], gb = G[b * K + k]; G[a * K + k] = c0 * ga - s0 * gb; G[b * K + k] = s0 * ga + c0 * gb; }
        for (let k = 0; k < K; k++) { const ga = G[k * K + a], gb = G[k * K + b]; G[k * K + a] = c0 * ga - s0 * gb; G[k * K + b] = s0 * ga + c0 * gb; }
        for (let k = 0; k < K; k++) { const ea = Ev[k * K + a], eb = Ev[k * K + b]; Ev[k * K + a] = c0 * ea - s0 * eb; Ev[k * K + b] = s0 * ea + c0 * eb; }
      }
    }
  }

  const order = [...Array(K).keys()].sort((a, b) => G[b * K + b] - G[a * K + a]);
  const singular = order.map((c) => Math.sqrt(Math.max(G[c * K + c], 0)));
  const X = new Float64Array(N * K);
  for (let i = 0; i < N; i++) {
    for (let kk = 0; kk < K; kk++) {
      const col = order[kk];
      let acc = 0;
      for (let j = 0; j < K; j++) acc += Q[i * K + j] * Ev[j * K + col];
      X[i * K + kk] = acc * singular[kk];
    }
  }
  // L2-normalise so cosine similarity is a plain dot product everywhere below.
  for (let i = 0; i < N; i++) {
    let n = 0;
    for (let k = 0; k < K; k++) n += X[i * K + k] * X[i * K + k];
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < K; k++) X[i * K + k] /= n;
  }

  return { X, dims: K, vocabulary: V, nnz, singular };
}

/* ------------------------------------------------- stage C: projection -- */

function knn(X, D, k) {
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
      if (a <= worst) continue;                 // the early-out that makes brute force affordable
      let p = k - 1;
      while (p > 0 && bv[p - 1] < a) { bv[p] = bv[p - 1]; bi[p] = bi[p - 1]; p--; }
      bv[p] = a; bi[p] = j;
      worst = bv[k - 1];
    }
    for (let r = 0; r < k; r++) { nbr[i * k + r] = bi[r]; nbd[i * k + r] = 1 - bv[r]; }
    if ((i + 1) % 2000 === 0) console.log(`  kNN ${i + 1}/${N}`);
  }
  return { nbr, nbd };
}

/**
 * UMAP's a and b, fitted to 1/(1 + a x^(2b)) against the target curve.
 *
 * Grid search then bounded coordinate descent, and not Gauss-Newton: the
 * Newton fit ran away to b=443 on min_dist=0.1, Math.pow(d2, b-1) overflowed,
 * and every coordinate in the file came out NaN, which the renderer would have
 * swallowed silently as left: NaN%. A grid search cannot diverge.
 */
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

/** Local connectivity: each point gets its own scale, which is what stops a
 *  dense department from dominating the layout of a sparse one. */
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

function layout(X, D, edges, A, B) {
  const { epochs, negativeSamples: NEG, gamma } = PARAMS;
  const rnd = lcg(PARAMS.seed);

  // Initialising from the first two LSA components is deterministic and starts
  // far closer to the answer than a random cloud, so 300 epochs are enough.
  const Y = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) { Y[i * 2] = X[i * D]; Y[i * 2 + 1] = X[i * D + 1]; }
  let mx = 0;
  for (let i = 0; i < N * 2; i++) mx = Math.max(mx, Math.abs(Y[i]));
  for (let i = 0; i < N * 2; i++) Y[i] = (Y[i] / mx) * 10 + (rnd() - 0.5) * 1e-3;

  // Math.max(...array) on 100k edges overflows the call stack.
  let maxW = 0;
  for (const e of edges) if (e[2] > maxW) maxW = e[2];

  // Strong edges get pulled every epoch, weak ones rarely, which is UMAP's
  // sampling scheme and the reason the layout is not dominated by noise edges.
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
      // Without the clip the first epochs throw points to infinity.
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
    if ((ep + 1) % 100 === 0) console.log(`  layout epoch ${ep + 1}/${epochs}`);
  }
  return Y;
}

/* ------------------------------------------------ stage D: coordinates -- */

/**
 * Rank percentile per axis into 4..96.
 *
 * A linear fit preserves 1.5 more points of neighbourhood than this, and it
 * relies on percentile clipping working. When clipping does not catch an
 * outlier you get the -10..10 bug back, and coordinates outside the stage are
 * invisible rather than obviously wrong. Under rank normalisation min is
 * exactly 4 and max is exactly 96 by construction, for any input distribution
 * and any corpus size, which makes that whole failure impossible.
 *
 * The cost, which nobody should talk their way out of: each axis is now
 * exactly uniform, so the map shows which courses are near which, never how
 * far apart two topics are. It is monotone per axis, so nothing is reordered.
 */
function rankNormalise(Y) {
  const out = new Float64Array(N * 2);
  for (const axis of [0, 1]) {
    // The index tie-break is what guarantees every course a distinct rank, so
    // no two courses can come out at identical coordinates.
    const order = [...Array(N).keys()].sort((a, b) => (Y[a * 2 + axis] - Y[b * 2 + axis]) || (a - b));
    for (let r = 0; r < N; r++) out[order[r] * 2 + axis] = 4 + (92 * r) / (N - 1);
  }
  return out;
}

/**
 * Cross-listed twins resolve to the same description and so to the same
 * vector, and rank normalisation separates them by 0.01 units, which is under
 * a tenth of a pixel. "AAS 201 / AFRO 201 / LLS 201" reads as one dot that the
 * user cannot pick apart. Fan each group out on a golden-angle rosette
 * instead: deterministic, subject-blind, and 0.35 units out of 92.
 *
 * Up to six members that is a plain ring of radius 0.35, which is every
 * cross-listing the catalog actually has. Past six the ring cannot hold them:
 * 85 departments each publish "Undergraduate Open Seminar" and 38 publish
 * "Thesis Research", all with no description and therefore one identical
 * vector, and on a 0.35 ring those 85 sit 0.026 units apart, which is one dot
 * again. Those spill onto a golden-angle disc instead, which keeps members
 * about 0.35 apart and stays compact: 3.2 units across for 85 courses, where
 * a ring wide enough to space them would have been 9.5 and would have read as
 * a drawing bug. Both oversized groups are title-only administrative courses
 * with no text to distort, so the extra spread costs no meaning.
 *
 * Groups come from the kNN result rather than an N^2 rescan, because a course
 * at cosine 0.9999 is certainly inside its own 15 nearest. A group wider than
 * k still comes out whole: every member links to the same lowest-indexed
 * fifteen, so the union-find closes over the lot. The self-check prints the
 * largest groups, because a group that suddenly grows means the text stage
 * started emptying descriptions it used to keep.
 */
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
    members.sort((a, b) => a - b);   // by catalog order, so the rosette is reproducible
    // A ring of radius SEP holds six members at SEP of arc. Past that the
    // radius has to grow with the member's own position, which is the
    // sunflower spacing and keeps neighbours SEP apart at any group size.
    const ring = m * SEP <= 2 * Math.PI * SEP;
    members.forEach((i, idx) => {
      const ang = idx * GOLDEN;
      const radius = ring ? SEP : SEP * Math.sqrt(idx);
      coords[i * 2] = Math.max(4, Math.min(96, cx + radius * Math.cos(ang)));
      coords[i * 2 + 1] = Math.max(4, Math.min(96, cy + radius * Math.sin(ang)));
      moved++;
    });
    largest.push([m, members.map((i) => courses[i].code)]);
  }
  largest.sort((a, b) => b[0] - a[0]);
  return { groupCount, moved, largest: largest.slice(0, 3) };
}

/* ------------------------------------------------------------- the run -- */

console.log(`illinois course map: ${N} courses from a catalog fetched ${catalog.fetchedAt}`);

let t0 = Date.now();
// The embedding model is the default and TF-IDF is the fallback, but a silent
// fallback would mean nobody notices the map got worse, so the failure is
// printed and the method is recorded in the output file.
let vectors;
try {
  vectors = await buildVectorsEmbedded(prepared, catalog.fetchedAt);
} catch (err) {
  console.log(`  !! embeddings unavailable (${err.message}), falling back to TF-IDF`);
  vectors = { ...buildVectors(prepared), method: 'tfidf' };
}
const { X, dims: D, vocabulary, nnz, singular } = vectors;
const VECTOR_METHOD = vectors.method;
console.log(`vectors: ${vocabulary} terms, ${nnz} non-zeros, ${D} dims in ${secs(t0)}`);

const [A, B] = fitAB(PARAMS.spread, PARAMS.minDist);
// Checked here rather than in the report, because a diverged fit turns every
// coordinate into NaN and there is no reason to spend thirty seconds finding
// that out downstream.
if (!(A > 0.5 && A < 5) || !(B > 0.3 && B < 3)) {
  console.error(`\n!! UMAP curve fit diverged: a=${A} b=${B}, expected a in (0.5,5) and b in (0.3,3).`);
  console.error('!! Every coordinate would be NaN. Nothing written.');
  process.exit(1);
}

t0 = Date.now();
const { nbr, nbd } = knn(X, D, PARAMS.neighbors);
console.log(`kNN k=${PARAMS.neighbors} in ${secs(t0)}`);

const edges = fuzzySimplicialSet(nbr, nbd, PARAMS.neighbors);
console.log(`fuzzy simplicial set: ${edges.length} edges`);

t0 = Date.now();
const raw = layout(X, D, edges, A, B);
console.log(`layout in ${secs(t0)}`);

const coords = rankNormalise(raw);
// Kept so the self-check can price the rosette. If preservation drops sharply
// between the two, the fan-out is doing more damage than the overlap it fixes.
const preRosette = Float64Array.from(coords);
const rosette = fanOutDuplicates(coords, nbr, nbd, PARAMS.neighbors);
console.log(`duplicate rosettes: ${rosette.groupCount} groups, ${rosette.moved} courses nudged`);

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

// Block 1, corpus.
const sourceCounts = { 'title+description': 0, 'title+crosslist': 0, 'title-only': 0 };
for (const d of prepared) sourceCounts[d.textSource]++;
const subjects = new Map();
courses.forEach((c, i) => { if (!subjects.has(c.subject)) subjects.set(c.subject, []); subjects.get(c.subject).push(i); });
line('\n[1] corpus');
line(`    courses ${N}   subjects ${subjects.size}   vocabulary ${vocabulary}   terms/doc ${(nnz / N).toFixed(1)}`);
line(`    text source: title+description ${sourceCounts['title+description']}, title+crosslist ${sourceCounts['title+crosslist']}, title-only ${sourceCounts['title-only']}`);
if (singular.length >= D) {
  line(`    top singular values ${singular.slice(0, 6).map((v) => v.toFixed(2)).join(' ')} ... tail ${singular[D - 1].toFixed(2)}`);
} else {
  line(`    sentence embeddings, ${D} dims, no SVD stage`);
}
// A TF-IDF run with a tiny vocabulary means the text stage broke. The
// embedding path has no vocabulary at all, so the same check there rejects a
// perfectly good map: it refused to write one on its first run.
if (VECTOR_METHOD === 'tfidf' && vocabulary < 5000) failures.push(`vocabulary ${vocabulary} is under 5000, the text stage is broken`);
if (VECTOR_METHOD === 'minilm' && D !== 384) failures.push(`embedding dims ${D}, expected 384`);
const titleOnlyShare = sourceCounts['title-only'] / N;
if (titleOnlyShare > 0.2) failures.push(`${(100 * titleOnlyShare).toFixed(1)}% of courses are title-only, over the 20% limit`);

// Block 2, curve fit.
line('\n[2] umap curve fit');
line(`    min_dist ${PARAMS.minDist} spread ${PARAMS.spread}  ->  a=${A.toFixed(4)} b=${B.toFixed(4)}   (expect a~1.577 b~0.895)`);

// Block 3, named courses in both spaces. If the 128-D column is right and the
// 2-D column is junk the projection broke; if both are junk the text stage did.
line('\n[3] named-course neighbours, 128-D and final 2-D');
// Read the two columns together. A wrong 128-D column means the text stage
// broke and nothing downstream is worth looking at. A wrong 2-D column on its
// own means only that this course was one of the few the projection tore away,
// which is normal at three courses in a hundred; block 5 gives the rate, and
// that rate is what says whether the projection as a whole is sound.
line('    (a weak 2-D row for one course is normal, see the tear rate in block 5)');
const PROBES = [
  ['CS 173', 'intro CS sequence, plus PHIL 222 Philosophical Foundations of Computer Science'],
  ['PSYC 224', 'BCOG (Brain and Cognitive Science) and the cross-listed EPSY/IE trio'],
  ['MUS 133', 'ANTH 416 Anthropology of Music, a different college entirely'],
];
for (const [code, expect] of PROBES) {
  const i = indexOf.get(code);
  if (i === undefined) { line(`    ${code} NOT IN CATALOG`); continue; }
  line(`\n    ${code}  ${courses[i].title}`);
  line(`      128-D: ${nearest(i, hi2, 8).map((j) => courses[j].code).join('  ')}`);
  line(`        2-D: ${nearest(i, lo2, 8).map((j) => courses[j].code).join('  ')}`);
  line(`     expect: ${expect}`);
}

// Block 4, subject adjacency. No subject token exists anywhere in the
// pipeline, so this is the evidence that departments self-organise. It is also
// the first thing that dies if somebody ever puts a subject into the vector.
const centroid = new Map();
for (const [s, idxs] of subjects) {
  let cx = 0, cy = 0;
  for (const i of idxs) { cx += coords[i * 2]; cy += coords[i * 2 + 1]; }
  centroid.set(s, [cx / idxs.length, cy / idxs.length]);
}
line('\n[4] subject centroid neighbours in 2-D (no subject token was used)');
for (const s of ['MATH', 'CS', 'HIST', 'CHEM', 'PSYC', 'SPAN', 'CEE', 'MUS']) {
  if (!centroid.has(s)) { line(`    ${s.padEnd(6)} not in catalog`); continue; }
  const [ax, ay] = centroid.get(s);
  const near = [...centroid].filter(([o]) => o !== s)
    .map(([o, [ox, oy]]) => [o, Math.hypot(ax - ox, ay - oy)])
    .sort((p, q) => p[1] - q[1]).slice(0, 5).map(([o]) => o);
  line(`    ${s.padEnd(6)} -> ${near.join(' ')}`);
}

// Block 5, aggregates.
const evalRnd = lcg(99);
const preLo2 = flat2(preRosette);
let hit = 0, total = 0, hitPre = 0;
const closestRanks = [];
for (let s = 0; s < 200; s++) {
  const i = (evalRnd() * N) | 0;
  // The 128-D pass is the expensive half, so both coordinate sets are scored
  // against the same sample and the same high-dimensional neighbourhood.
  const far = nearest(i, hi2, 30);
  const farSet = new Set(far);
  for (const j of nearest(i, lo2, 10)) { total++; if (farSet.has(j)) hit++; }
  for (const j of nearest(i, preLo2, 10)) if (farSet.has(j)) hitPre++;
  // Where does this course's single closest relative end up on the finished
  // map? Block 3 shows that per course, and one course's 2-D column can look
  // like junk while the projection is fine, so the honest read needs the
  // distribution. Reuses the 128-D work above, so it costs one O(N) scan.
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

const meanPairwise = (idxs, cap) => {
  let s = 0, n = 0;
  const m = Math.min(idxs.length, cap);
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      const i = idxs[a], j = idxs[b];
      s += Math.hypot(coords[i * 2] - coords[j * 2], coords[i * 2 + 1] - coords[j * 2 + 1]);
      n++;
    }
  }
  return n ? s / n : 0;
};
const globalMean = meanPairwise([...Array(N).keys()], 300);
const cohesion = [...subjects].filter(([, v]) => v.length >= 60)
  .map(([s, v]) => [s, v.length, meanPairwise(v, 150) / globalMean]);
const cohesionSorted = cohesion.map(([, , r]) => r).sort((a, b) => a - b);
const cohesionMedian = cohesionSorted.length ? cohesionSorted[cohesionSorted.length >> 1] : 0;

const occupied = new Set();
for (let i = 0; i < N; i++) {
  const gx = Math.min(95, Math.floor(coords[i * 2])), gy = Math.min(95, Math.floor(coords[i * 2 + 1]));
  occupied.add(gx * 100 + gy);
}

line('\n[5] aggregates');
line(`    neighbourhood preservation (10 of 30, 200 samples): ${(100 * preservation).toFixed(1)}%  (expect 55-65%)`);
line(`      before the duplicate fan-out: ${(100 * preservationPreRosette).toFixed(1)}%   cost of the fan-out: ${(100 * (preservationPreRosette - preservation)).toFixed(1)} points`);
line(`    2-D rank of each course's single closest 128-D relative: median ${rankPct(0.5)} of ${N - 1}, p90 ${rankPct(0.9)}, worst ${closestRanks[closestRanks.length - 1]}`);
line(`      in the 2-D top 10: ${within(10).toFixed(0)}%   top 100: ${within(100).toFixed(0)}%   torn past 1000: ${(100 - within(1000)).toFixed(0)}%  (expect a median under 20 and under 10% torn)`);
line(`    occupied cells on a 1% grid: ${occupied.size} / 8464`);
line(`    largest duplicate groups (identical vectors, fanned out):`);
for (const [m, codes] of rosette.largest) {
  const shown = codes.slice(0, 6).join(' ') + (codes.length > 6 ? ` ... +${codes.length - 6} more` : '');
  line(`      ${String(m).padStart(3)} courses  "${courses[indexOf.get(codes[0])].title}"  ${shown}`);
}
line(`    subject cohesion, 10 largest subjects (within-subject mean 2-D distance / global mean, most should be 0.45-0.80):`);
for (const [s, n, r] of [...cohesion].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  line(`      ${s.padEnd(6)} n=${String(n).padStart(4)}  ratio ${r.toFixed(2)}`);
}
line(`    median ratio over the ${cohesion.length} subjects with n>=60: ${cohesionMedian.toFixed(2)}`);
if (preservation < 0.45) failures.push(`neighbourhood preservation ${(100 * preservation).toFixed(1)}% is under 45%, the projection is not carrying the vectors`);

// Block 6, coordinates. The direct guard against the original -10..10 bug.
let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, nonFinite = 0;
for (let i = 0; i < N; i++) {
  const x = coords[i * 2], y = coords[i * 2 + 1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) { nonFinite++; continue; }
  if (x < xmin) xmin = x; if (x > xmax) xmax = x;
  if (y < ymin) ymin = y; if (y > ymax) ymax = y;
}
line('\n[6] coordinates');
line(`    x range [${xmin.toFixed(2)}, ${xmax.toFixed(2)}]   y range [${ymin.toFixed(2)}, ${ymax.toFixed(2)}]   non-finite ${nonFinite}`);
if (nonFinite > 0) failures.push(`${nonFinite} coordinates are not finite`);
// Rank normalisation puts min at exactly 4 and max at exactly 96, but the
// duplicate fan-out afterwards can pull the extreme course inward, so what has
// to hold is the box, not the endpoint. The box is the part that matters: this
// is the assertion standing between the file and the -10..10 bug coming back.
if (!(xmin >= 4 && xmax <= 96 && ymin >= 4 && ymax <= 96)) failures.push(`coordinates escaped the 4..96 box: x [${xmin}, ${xmax}] y [${ymin}, ${ymax}]`);

if (failures.length) {
  line('\n!! FAILED');
  for (const f of failures) line(`!! ${f}`);
  line('!! Nothing written. A map that parses and renders but means nothing is worse than no map.');
  process.exit(1);
}

/* ---------------------------------------------------------------- out -- */

mkdirSync(join(ROOT, 'public'), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  school: 'illinois',
  // Records which stage B actually ran, so a fallback is visible in the
  // artifact rather than only in a console line nobody kept.
  method: VECTOR_METHOD === 'minilm'
    ? `all-MiniLM-L6-v2 (${D}d) -> umap(k=${PARAMS.neighbors}, min_dist=${PARAMS.minDist}) -> rank-normalised 4..96`
    : `tfidf-bigram -> lsa-${D} -> umap(k=${PARAMS.neighbors}, min_dist=${PARAMS.minDist}) -> rank-normalised 4..96`,
  builtAt: new Date().toISOString(),
  // Copied from the crawl so a stale map is detectable by comparison instead
  // of by guesswork about which file is older.
  catalogFetchedAt: catalog.fetchedAt,
  count: N,
  vocabulary,
  params: { ...PARAMS, a: +A.toFixed(4), b: +B.toFixed(4) },
  quality: {
    neighbourPreservation: +preservation.toFixed(3),
    subjectCohesionMedian: +cohesionMedian.toFixed(2),
    textSourceCounts: sourceCounts,
  },
  courses: courses.map((c, i) => ({
    code: c.code,
    x: +coords[i * 2].toFixed(2),
    y: +coords[i * 2 + 1].toFixed(2),
    // The unwarped projection, kept because rank normalisation destroys true
    // distance and anything that later needs real geometry would be stuck.
    rawX: +raw[i * 2].toFixed(6),
    rawY: +raw[i * 2 + 1].toFixed(6),
    textSource: prepared[i].textSource,
  })),
}));
line(`\nwrote ${OUT}`);
