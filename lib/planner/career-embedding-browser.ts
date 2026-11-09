/**
 * The career matcher's loading, in the browser (career-embedding.ts says
 * what it is for).
 *
 * Four things load, once per visit, and only when the flag is on and the
 * student has a goal: the school's course vectors (public/<school>/
 * course-vectors.*, about 2.5 MB), the career pathways' vectors
 * (public/career-pathways.json, 64 KB), the sentence model (public/career-model/,
 * a 22 MB file the browser keeps in its cache afterwards) and the
 * WebAssembly runtime that runs it (14 MB). All three come from this site;
 * transformers.js is told not to fetch anything from anywhere else. The
 * goal is embedded on the student's own device; nothing they typed is sent
 * anywhere for this.
 *
 * Any failure (a missing file, an old browser, no WebAssembly) is caught,
 * logged once, and answered with null for the rest of the visit: the plan
 * is then built from the goal's words, as it is with the flag off. A school
 * whose course vectors are missing answers null on its own, so Georgia Tech
 * before its vectors are built leaves Illinois and UGA working.
 */
import { CAREER_MODEL, careerFitFor, courseVectorsFrom, goalQuery, pathwayVectorsFrom, type CareerFit, type CourseVectors, type CourseVectorsMeta, type PathwayVectors, type PathwayVectorsMeta } from './career-embedding';
import type { SchoolKey } from './school-config';

const BASE = '/career-model/';

type Embed = (text: string) => Promise<Float32Array>;
let embedder: Promise<Embed> | null = null;
let broken = false;
const vectors = new Map<string, Promise<CourseVectors>>();
/**
 * Schools whose course vectors are not on this site (a 404, or a file that
 * would not read): that school answers null for the rest of the visit, and
 * the model and the other schools keep working. Georgia Tech's are built
 * separately (public/gatech/course-vectors.*); until they exist its goals
 * are matched by their words, as with the flag off.
 */
const missingVectors = new Set<string>();
const goals = new Map<string, Promise<Float32Array>>();
let pathways: Promise<PathwayVectors | null> | null = null;

/** How long the last loads took, in milliseconds, for the docs' load-time note and the console. */
export const careerTiming: { model?: number; vectors?: number; goal?: number } = {};

function loadEmbedder(): Promise<Embed> {
  embedder ??= (async () => {
    const started = performance.now();
    // The WebAssembly-only ONNX runtime, handed to transformers.js through
    // the symbol it looks for, in place of the WebGPU build it carries (whose
    // runtime file is too large to serve). One thread: several need
    // cross-origin isolation, which this site does not set.
    const ort = await import(/* @vite-ignore */ `${BASE}runtime/ort.wasm.min.mjs`);
    ort.env.wasm.wasmPaths = `${BASE}runtime/`;
    ort.env.wasm.numThreads = 1;
    (globalThis as Record<symbol, unknown>)[Symbol.for('onnxruntime')] = ort;
    const tf = await import(/* @vite-ignore */ `${BASE}runtime/transformers.min.js`);
    tf.env.allowRemoteModels = false;
    tf.env.allowLocalModels = true;
    tf.env.localModelPath = `${BASE}models/`;
    // With the runtime handed in, transformers.js lists no devices of its own
    // and refuses its default ("Unsupported device: wasm"); 'auto' takes any,
    // and the session is told the one the runtime has.
    const extract = await tf.pipeline('feature-extraction', CAREER_MODEL, { dtype: 'fp32', model_file_name: 'model_int8w', device: 'auto', session_options: { executionProviders: ['wasm'] } });
    careerTiming.model = Math.round(performance.now() - started);
    return async (text: string) => {
      const out = await extract(text, { pooling: 'mean', normalize: true });
      return Float32Array.from(out.data as Float32Array);
    };
  })();
  return embedder;
}

function loadVectors(school: string): Promise<CourseVectors> {
  let hit = vectors.get(school);
  if (!hit) {
    hit = (async () => {
      const started = performance.now();
      const [meta, bin] = await Promise.all([
        fetch(`/${school}/course-vectors.json`).then((r) => {
          if (!r.ok) throw new Error(`course-vectors.json: ${r.status}`);
          return r.json();
        }),
        fetch(`/${school}/course-vectors.bin`).then((r) => {
          if (!r.ok) throw new Error(`course-vectors.bin: ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      const made = courseVectorsFrom(meta as CourseVectorsMeta, bin);
      careerTiming.vectors = Math.round(performance.now() - started);
      return made;
    })();
    vectors.set(school, hit);
  }
  return hit;
}

/** The career pathways by meaning; null when the file is missing, and the goal is then read alone. */
function loadPathways(): Promise<PathwayVectors | null> {
  pathways ??= fetch('/career-pathways.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((meta) => (meta ? pathwayVectorsFrom(meta as PathwayVectorsMeta) : null))
    .catch((error) => {
      console.warn('[career matcher] no career pathways; the goal is read alone.', error);
      return null;
    });
  return pathways;
}

/**
 * The goal by meaning for one school, or null (no goal, or the matcher could
 * not load). Repeated calls with the same goal reuse the model, the vectors
 * and the goal's vector.
 */
export async function loadCareerFit(school: SchoolKey, text: string): Promise<CareerFit | null> {
  const goal = text.trim();
  // What the model reads: the goal without "I want to be a" (goalQuery); none for "undecided".
  const query = goalQuery(goal);
  if (!query || broken || missingVectors.has(school)) return null;
  const vectorsLoad = loadVectors(school).catch((error: unknown) => {
    missingVectors.add(school);
    vectors.delete(school);
    console.warn(`[career matcher] no course vectors for ${school}; goal courses are matched by their words.`, error);
    return null;
  });
  // A school whose vectors may not be built yet (Georgia Tech) is checked before the model
  // downloads; Illinois and UGA load all three at once, as before.
  if (school !== 'uga' && school !== 'illinois' && !(await vectorsLoad)) return null;
  try {
    const [embed, courses, paths] = await Promise.all([loadEmbedder(), vectorsLoad, loadPathways()]);
    if (!courses) return null;
    let vector = goals.get(query);
    if (!vector) {
      const started = performance.now();
      vector = embed(query).then((v) => {
        careerTiming.goal = Math.round(performance.now() - started);
        return v;
      });
      goals.set(query, vector);
    }
    const input = { text: goal, vector: await vector, school: school === 'uga' ? 'UGA' : school === 'gatech' ? 'Georgia Tech' : 'Illinois', ...(paths ? { pathways: paths } : {}) };
    // With what it was made from, so a plan built in a worker reads the goal the same way (plan-build.ts).
    return { ...careerFitFor(input, courses), source: { input, vectors: courses } };
  } catch (error) {
    broken = true;
    console.warn('[career matcher] not available; goal courses are matched by their words.', error);
    return null;
  }
}
