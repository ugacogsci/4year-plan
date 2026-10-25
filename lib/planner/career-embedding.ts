/**
 * The career matcher: which courses are closest in meaning to what the
 * student wants to do, for the free choices of a plan.
 *
 * Today's matcher reads words (goal-words.ts, quality.ts relevance): a
 * course is a goal course when its title or description shares a word with
 * the goal, so "software engineer" once picked a Materials Science course
 * (it says "engineering") and "dentist" finds nothing, because no course
 * title says "dentist". This one, Cameron's idea, compares meanings: the
 * goal and every course are turned into 384 numbers by the same sentence
 * model (Xenova/all-MiniLM-L6-v2, the one the Illinois course map is built
 * with), and courses whose numbers point the same way as the goal's are
 * about the same thing, shared words or not ("dentist" sits near oral
 * biology and anatomy).
 *
 * Only free choices read it (electives, general education picks, choose-N
 * lists, the re-pick, the chooser): it enters as the relevance measure in
 * quality.ts and the elective score in autoplan.ts. Required courses and the
 * degree's rules never see it. Off unless the flag is on
 * (careerMatcherOn) and the model has loaded; without it every plan is
 * built exactly as before.
 *
 * Pure and synchronous: the vectors and the goal's vector come in from
 * career-embedding-browser.ts (the page) or the Node scripts, so a plan
 * build never waits on a model.
 */

export const CAREER_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const CAREER_DIMS = 384;

/** The flag's key in the browser's storage, and the address-bar switch that sets it (?career-matcher=on / off). */
export const CAREER_FLAG_KEY = 'orion.careerMatcher';

/**
 * Whether the career matcher is on in this browser. Off by default; turned
 * on by visiting the planner once with ?career-matcher=on (remembered on this
 * device) and off again with ?career-matcher=off.
 */
export function careerMatcherOn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const asked = new URLSearchParams(window.location.search).get('career-matcher');
    if (asked === 'on' || asked === 'off') window.localStorage.setItem(CAREER_FLAG_KEY, asked);
    return window.localStorage.getItem(CAREER_FLAG_KEY) === 'on';
  } catch {
    return false;
  }
}

/** One school's course vectors, as public/<school>/course-vectors.{json,bin} store them. */
export interface CourseVectors {
  codes: string[];
  index: Map<string, number>;
  /** count x dims signed bytes; component k of course i is bytes[i * dims + k] * scales[i]. */
  bytes: Int8Array;
  scales: Float32Array;
  dims: number;
  /** Each course's mean similarity to the reference occupations (CourseVectorsMeta.hubs), when the file has them. */
  hubs?: Float32Array;
}

export interface CourseVectorsMeta {
  model: string;
  dims: number;
  codes: string[];
  scales: number[];
  /**
   * How close each course is to any career at all: its mean similarity to
   * fifty reference occupations (scripts/career/embed-courses.mjs). A few
   * courses sit near every short goal (UKR 201, Second-Year Ukrainian, was
   * the nearest Illinois course to "dentist", ITAL 101 the 25th nearest to
   * "accountant"); a course is ranked by how much closer it is to this goal
   * than to careers in general.
   */
  hubs?: number[];
}

export function courseVectorsFrom(meta: CourseVectorsMeta, bin: ArrayBuffer | Uint8Array): CourseVectors {
  if (meta.model !== CAREER_MODEL || meta.dims !== CAREER_DIMS) throw new Error(`course vectors are ${meta.model} x ${meta.dims}`);
  const view = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  if (view.byteLength !== meta.codes.length * meta.dims) throw new Error('course vectors do not match their index');
  const bytes = new Int8Array(view.buffer, view.byteOffset, view.byteLength);
  return { codes: meta.codes, index: new Map(meta.codes.map((code, i) => [code, i])), bytes, scales: Float32Array.from(meta.scales), dims: meta.dims, ...(meta.hubs?.length === meta.codes.length ? { hubs: Float32Array.from(meta.hubs) } : {}) };
}

/**
 * The goal as the plan reads it: how close each course is, and between two
 * courses for variety. Built once per goal (careerFitFor).
 */
export interface CareerFit {
  /** Identity for memo keys: the goal text. */
  key: string;
  /** Short name for the reason line: "dentist". */
  label: string;
  /** Whether the course has a vector (undergraduate courses only); one without falls back to word matching. */
  covers(code: string): boolean;
  /** 0 to 1: 0 is not a goal course, 1 is the closest course in the catalog. */
  strength(code: string): number;
  /** Cosine between the goal and the course, or null without a vector. */
  similarity(code: string): number | null;
  /** Cosine between two courses, or null when either has no vector. */
  between(a: string, b: string): number | null;
  /** "closest to your goal (dentist): 3rd of 6,225 courses by meaning", or null for a course that is not a goal course. */
  reasonFor(code: string): string | null;
}

/**
 * How many of the catalog's courses count as goal courses: the closest 2%
 * (about 125 at Illinois, 145 at UGA), and never one less similar than
 * MIN_SIMILARITY, so a goal the model cannot place ("dentist": nothing at
 * Illinois comes nearer than 0.29) picks nothing rather than the least-bad
 * 2%.
 */
const GOAL_SHARE = 0.02;
const MIN_SIMILARITY = 0.3;

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const s = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n.toLocaleString('en-US')}${s}`;
};

/**
 * The text the model reads for a goal: the student's words without the
 * framing around them. "I want to be a dentist" is embedded as "dentist":
 * read whole, "I want to be a ..." is about wanting a career, and its
 * nearest courses were career-planning seminars ("Translating Your IB
 * Degree", "Preparing for a Career") for every goal (measured on the 20
 * benchmark goals, docs/career-system.md). A clause that only says the
 * student has not decided is left out, and a goal that is nothing else
 * gives '' (no goal to match): "I'm undecided about what I want to do"
 * picks no courses, "I'm not sure yet, maybe nursing" reads "maybe nursing".
 */
const UNDECIDED = /\b(?:undecided|not\s+sure|unsure|don'?t\s+know|do\s+not\s+know|no\s+idea|haven'?t\s+decided|have\s+not\s+decided|still\s+deciding|still\s+figuring)\b/i;
const FRAMING = /\b(?:i\s*(?:'d|would|really)?\s*(?:want|like|love|hope|plan|intend|wish|aim)\s+to\s+(?:be(?:come)?|work(?:\s+(?:as|in|on|with|for))?|go\s+into|get\s+into|pursue|do|study|have\s+a\s+career\s+(?:as|in))|i\s*'?m\s+(?:interested|thinking|planning)\s+(?:in|about|on)(?:\s+(?:becoming|being|working\s+(?:as|in)))?|my\s+(?:dream|goal|plan)(?:\s+job)?\s+is(?:\s+to\s+(?:be(?:come)?|work\s+(?:as|in)))?|(?:a\s+)?career\s+(?:as|in))\s+(?:(?:an?|the)\s+)?/gi;
export function goalQuery(text: string): string {
  return text
    .split(/[.;!?\n]+|,\s*/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !UNDECIDED.test(clause))
    .map((clause) => clause.replace(FRAMING, '').replace(/^[\s,:-]+|[\s,:-]+$/g, ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * A short name for a goal, for the reason line: "I want to be a dentist" ->
 * "dentist", "I'd like to work in public policy, maybe law" -> "public
 * policy". The student's own words, the first part of goalQuery's.
 */
export function goalLabel(text: string): string {
  const first = goalQuery(text).split(/,\s*|\s(?:and|or|but|maybe|because|so)\s/i)[0]?.trim() ?? '';
  const t = first || text.trim();
  return t.length > 40 ? `${t.slice(0, 40).replace(/\s+\S*$/, '')}…` : t;
}

function dot(v: CourseVectors, i: number, goal: Float32Array): number {
  const { bytes, dims } = v;
  let s = 0;
  const o = i * dims;
  for (let k = 0; k < dims; k++) s += bytes[o + k] * goal[k];
  return s * v.scales[i];
}

/** The goal against every course once; the answers are then lookups. `goal` is the model's normalised vector for the goal text. */
export function careerFitFor(input: { text: string; vector: Float32Array | number[]; label?: string; school?: string }, v: CourseVectors): CareerFit {
  const goal = Float32Array.from(input.vector);
  const n = v.codes.length;
  const sims = new Float32Array(n);
  for (let i = 0; i < n; i++) sims[i] = dot(v, i, goal);
  // Ranked by closeness to this goal beyond closeness to careers in general (CourseVectorsMeta.hubs).
  const score = v.hubs ? sims.map((s, i) => s - v.hubs![i]) : sims;
  const order = [...score.keys()].sort((a, b) => score[b] - score[a] || (v.codes[a] < v.codes[b] ? -1 : 1));
  const rank = new Int32Array(n);
  order.forEach((i, r) => { rank[i] = r + 1; });
  const take = Math.max(1, Math.round(n * GOAL_SHARE));
  const top = score[order[0]] ?? 0;
  const floor = score[order[Math.min(take, n) - 1]] ?? 0;
  const label = input.label ?? goalLabel(input.text);
  const norms = new Map<number, number>();
  const normOf = (i: number): number => {
    let hit = norms.get(i);
    if (hit === undefined) {
      let s = 0;
      for (let k = 0; k < v.dims; k++) s += v.bytes[i * v.dims + k] ** 2;
      hit = Math.sqrt(s);
      norms.set(i, hit);
    }
    return hit;
  };
  const strengthAt = (i: number): number => {
    // By rank, so courses tied at the cut (UGA's copies of one description) do not widen the band.
    if (rank[i] > take || sims[i] < MIN_SIMILARITY) return 0;
    return top > floor ? Math.min(1, Math.max(0.05, (score[i] - floor) / (top - floor))) : 1;
  };
  return {
    key: input.text,
    label,
    covers: (code) => v.index.has(code),
    strength: (code) => {
      const i = v.index.get(code);
      return i === undefined ? 0 : strengthAt(i);
    },
    similarity: (code) => {
      const i = v.index.get(code);
      return i === undefined ? null : sims[i];
    },
    between: (a, b) => {
      const i = v.index.get(a);
      const j = v.index.get(b);
      if (i === undefined || j === undefined) return null;
      let s = 0;
      for (let k = 0; k < v.dims; k++) s += v.bytes[i * v.dims + k] * v.bytes[j * v.dims + k];
      const d = normOf(i) * normOf(j);
      return d > 0 ? s / d : 0;
    },
    reasonFor: (code) => {
      const i = v.index.get(code);
      if (i === undefined || strengthAt(i) <= 0) return null;
      return `closest to your goal (${label}): ${ordinal(rank[i])} of ${n.toLocaleString('en-US')} ${input.school ? `${input.school} ` : ''}courses by meaning`;
    },
  };
}

/**
 * Points for spreading a board's goal picks (autoplan.ts elective fill): a
 * candidate whose meaning is almost the same as a goal pick already on the
 * board (cosine 0.85 or more: "Dental Anatomy I" beside "Dental Anatomy
 * II") loses VARIETY_POINTS; from 0.6 the loss grows from nothing. Two
 * courses in one field sit around 0.4 to 0.6, so a board can still go deep.
 */
export const VARIETY_POINTS = 4;
export function varietyPenalty(fit: CareerFit, code: string, picks: readonly string[]): number {
  let most = 0;
  for (const p of picks) most = Math.max(most, fit.between(code, p) ?? 0);
  return VARIETY_POINTS * Math.min(1, Math.max(0, (most - 0.6) / 0.25));
}

/**
 * Up to a point and a half for a goal course whose level suits where in the
 * plan it lands: a 100-level course in the first term, a 400-level one in
 * the last; the same off by a whole plan loses as much. `position` is 0 for
 * the first term and 1 for the last; `level` is the course number's
 * hundreds (100 to 400).
 */
export const PROGRESSION_POINTS = 1.5;
export function progressionPoints(level: number, position: number): number {
  const at = Math.min(1, Math.max(0, (level - 100) / 300));
  return PROGRESSION_POINTS * (1 - 2 * Math.abs(at - Math.min(1, Math.max(0, position))));
}
