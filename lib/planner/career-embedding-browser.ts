/**
 * The career matcher's loading, in the browser (career-embedding.ts says
 * what it is for).
 *
 * Three things load, once per visit, and only when the flag is on and the
 * student has a goal: the school's course vectors (public/<school>/
 * course-vectors.*, about 2.5 MB), the sentence model (public/career-model/,
 * a 22 MB file the browser keeps in its cache afterwards) and the
 * WebAssembly runtime that runs it (14 MB). All three come from this site;
 * transformers.js is told not to fetch anything from anywhere else. The
 * goal is embedded on the student's own device; nothing they typed is sent
 * anywhere for this.
 *
 * Any failure (a missing file, an old browser, no WebAssembly) is caught,
 * logged once, and answered with null for the rest of the visit: the plan
 * is then built from the goal's words, as it is with the flag off.
 */
import { CAREER_MODEL, careerFitFor, courseVectorsFrom, goalQuery, type CareerFit, type CourseVectors, type CourseVectorsMeta } from './career-embedding';

const BASE = '/career-model/';

type Embed = (text: string) => Promise<Float32Array>;
let embedder: Promise<Embed> | null = null;
let broken = false;
const vectors = new Map<string, Promise<CourseVectors>>();
const goals = new Map<string, Promise<Float32Array>>();

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

/**
 * The goal by meaning for one school, or null (no goal, or the matcher could
 * not load). Repeated calls with the same goal reuse the model, the vectors
 * and the goal's vector.
 */
export async function loadCareerFit(school: 'illinois' | 'uga', text: string): Promise<CareerFit | null> {
  const goal = text.trim();
  // What the model reads: the goal without "I want to be a" (goalQuery); none for "undecided".
  const query = goalQuery(goal);
  if (!query || broken) return null;
  try {
    const [embed, courses] = await Promise.all([loadEmbedder(), loadVectors(school)]);
    let vector = goals.get(query);
    if (!vector) {
      const started = performance.now();
      vector = embed(query).then((v) => {
        careerTiming.goal = Math.round(performance.now() - started);
        return v;
      });
      goals.set(query, vector);
    }
    return careerFitFor({ text: goal, vector: await vector, school: school === 'uga' ? 'UGA' : 'Illinois' }, courses);
  } catch (error) {
    broken = true;
    console.warn('[career matcher] not available; goal courses are matched by their words.', error);
    return null;
  }
}
