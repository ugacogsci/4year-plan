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
 * A short goal is too little for the small model to place ("dentist"
 * found no course at all; "nurse" sat nearest lactation biology), so the
 * goal is first matched by meaning to the closest of 54 researched career
 * pathways (public/career-pathways.json, expandGoal) and read together with
 * that pathway's skill areas. A goal no pathway is close to is read alone.
 *
 * Pure and synchronous: the vectors and the goal's vector come in from
 * career-embedding-browser.ts (the page) or the Node scripts, so a plan
 * build never waits on a model.
 */
import { listedUgaCourseCodes } from './uga-course-codes';

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
  /** Row -> the language of a beginner language course ("Elementary Turkish I" -> "Turkish"), from CourseVectorsMeta.beginnerLanguage. */
  beginnerLanguage?: Map<number, string>;
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
  /**
   * The beginner courses of a world language, code -> language: an
   * "Elementary", "Beginning", "First-Year" or "Basic" course in a language
   * the catalog also teaches at an intermediate level
   * (scripts/career/embed-courses.mjs beginnerLanguagesOf). They are not
   * goal courses unless the goal is about languages (careerFitFor): every
   * one sits near "teacher", and a Psychology board got five of them.
   */
  beginnerLanguage?: Record<string, string>;
}

/**
 * The codes a planner books a vector's course under. Illinois codes are as
 * listed. A UGA row's code can print a lab or a graduate number with the
 * course ("POUL 3000-3000L", "JURI 4600/6600"); the UGA planner books it as
 * "POUL 3000" and "JURI 4600" (uga-course-codes.ts listedUgaCourseCodes,
 * the expansion uga-source.tsx builds its courses with), so the vector is
 * found under those too, and under the lab's own code ("POUL 3000L").
 * Graduate numbers are left out: graduate courses keep word matching.
 */
export function plannerCodesOf(code: string): string[] {
  if (!/^[A-Z]{2,5}(?:\([A-Z]{2,5}\))*\s+\d{4}/.test(code)) return [code];
  const undergraduate = listedUgaCourseCodes(code).filter((c) => /\s[1-4]\d{3}/.test(c));
  const lab = code.match(/^([A-Z]{2,5})\s+\d{4}[A-Z]?-(\d{4}L)$/);
  return [...new Set([code, ...undergraduate, ...(lab ? [`${lab[1]} ${lab[2]}`] : [])])];
}

export function courseVectorsFrom(meta: CourseVectorsMeta, bin: ArrayBuffer | Uint8Array): CourseVectors {
  if (meta.model !== CAREER_MODEL || meta.dims !== CAREER_DIMS) throw new Error(`course vectors are ${meta.model} x ${meta.dims}`);
  const view = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  if (view.byteLength !== meta.codes.length * meta.dims) throw new Error('course vectors do not match their index');
  const bytes = new Int8Array(view.buffer, view.byteOffset, view.byteLength);
  // A row's own code first; then the planner's codes for it, where no row has that code itself.
  const index = new Map(meta.codes.map((code, i) => [code, i]));
  meta.codes.forEach((code, i) => {
    for (const alias of plannerCodesOf(code)) if (!index.has(alias)) index.set(alias, i);
  });
  const beginner = meta.beginnerLanguage ? new Map(Object.entries(meta.beginnerLanguage).flatMap(([code, language]) => (index.has(code) ? [[index.get(code)!, language] as [number, string]] : []))) : undefined;
  return {
    codes: meta.codes, index, bytes, scales: Float32Array.from(meta.scales), dims: meta.dims,
    ...(meta.hubs?.length === meta.codes.length ? { hubs: Float32Array.from(meta.hubs) } : {}),
    ...(beginner?.size ? { beginnerLanguage: beginner } : {}),
  };
}

/** The career pathways by meaning (public/career-pathways.json, scripts/career/embed-pathways.mjs). */
export interface PathwayVectorsMeta {
  model: string;
  dims: number;
  pathways: Array<{
    id: string;
    name: string;
    /** A world language is one of the pathway's core skills (international affairs). */
    languages: boolean;
    /** The pathway's name and goal words, read by the model: what a goal is matched against. Base64 of signed bytes, and their scale. */
    match: string;
    matchScale: number;
    /** Its summary and core skill areas: what the goal is read with. */
    areas: string;
    areasScale: number;
  }>;
}

export interface PathwayVectors {
  pathways: Array<{ id: string; name: string; languages: boolean; match: Float32Array; areas: Float32Array }>;
}

function unitFrom(b64: string, scale: number, dims: number): Float32Array {
  const raw = atob(b64);
  if (raw.length !== dims) throw new Error('a pathway vector has the wrong length');
  const out = new Float32Array(dims);
  let n = 0;
  for (let k = 0; k < dims; k++) {
    const byte = raw.charCodeAt(k);
    out[k] = (byte > 127 ? byte - 256 : byte) * scale;
    n += out[k] ** 2;
  }
  n = Math.sqrt(n);
  if (n > 0) for (let k = 0; k < dims; k++) out[k] /= n;
  return out;
}

export function pathwayVectorsFrom(meta: PathwayVectorsMeta): PathwayVectors {
  if (meta.model !== CAREER_MODEL || meta.dims !== CAREER_DIMS) throw new Error(`pathway vectors are ${meta.model} x ${meta.dims}`);
  return { pathways: meta.pathways.map((p) => ({ id: p.id, name: p.name, languages: p.languages, match: unitFrom(p.match, p.matchScale, meta.dims), areas: unitFrom(p.areas, p.areasScale, meta.dims) })) };
}

/**
 * How a goal is read with its pathway (expandGoal). A goal as close as
 * PATHWAY_FULL to a pathway's name and goal words is read 30% as itself and
 * 70% as the pathway's summary and core skill areas; from PATHWAY_FLOOR up
 * the pathway's share grows from nothing, and a goal below it is read alone
 * (low confidence: "translator" is 0.22 from its nearest pathway). Pathways
 * within PATHWAY_NEAR of the closest are read too, two at most ("marketing":
 * marketing and sales 0.50, advertising and public relations 0.45). Measured
 * on the benchmark's goals (docs/career-system.md).
 */
export const PATHWAY_FLOOR = 0.35;
export const PATHWAY_FULL = 0.45;
export const PATHWAY_NEAR = 0.05;
export const PATHWAY_SHARE = 0.7;

export interface ExpandedGoal {
  vector: Float32Array;
  /** The pathways the goal was read with, closest first; empty when it was read alone. */
  pathways: Array<{ id: string; name: string; match: number; languages: boolean }>;
  /** The pathways' share of the vector, 0 to PATHWAY_SHARE. */
  share: number;
}

/** The goal read with its closest career pathway(s): the vector the courses are measured against. */
export function expandGoal(goal: Float32Array, pv: PathwayVectors): ExpandedGoal {
  const dims = goal.length;
  const dotf = (a: Float32Array, b: Float32Array) => {
    let s = 0;
    for (let k = 0; k < dims; k++) s += a[k] * b[k];
    return s;
  };
  const scored = pv.pathways.map((p) => ({ p, match: dotf(goal, p.match) })).sort((a, b) => b.match - a.match || (a.p.id < b.p.id ? -1 : 1));
  const best = scored[0]?.match ?? 0;
  if (best < PATHWAY_FLOOR) return { vector: goal, pathways: [], share: 0 };
  const taken = scored.filter((s) => s.match >= best - PATHWAY_NEAR).slice(0, 2);
  const areas = new Float32Array(dims);
  for (const s of taken) for (let k = 0; k < dims; k++) areas[k] += s.match * s.p.areas[k];
  const an = Math.sqrt(dotf(areas, areas));
  const share = PATHWAY_SHARE * Math.min(1, (best - PATHWAY_FLOOR) / (PATHWAY_FULL - PATHWAY_FLOOR));
  const vector = new Float32Array(dims);
  for (let k = 0; k < dims; k++) vector[k] = (1 - share) * goal[k] + share * (an > 0 ? areas[k] / an : 0);
  const vn = Math.sqrt(dotf(vector, vector));
  if (vn > 0) for (let k = 0; k < dims; k++) vector[k] /= vn;
  return { vector, pathways: taken.map((s) => ({ id: s.p.id, name: s.p.name, match: Number(s.match.toFixed(3)), languages: s.p.languages })), share: Number(share.toFixed(3)) };
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
  /** The career pathways the goal was read with (expandGoal), closest first; empty when it was read alone. */
  pathways: string[];
  /** The goal is about languages (careerFitFor): beginner language courses can be goal courses. */
  aboutLanguages: boolean;
  /** What a board's goal picks are capped by (GOAL_GROUP_CAP): the course's subject, or "world languages" for a beginner language course. */
  capGroup(code: string): string;
}

/**
 * At most this many of a board's goal picks (electives and general
 * education picks the goal ordered) from one subject, or from the beginner
 * language courses together: the variety points only compare two courses,
 * so before this a board could pile up six courses of one subject.
 */
export const GOAL_GROUP_CAP = 3;

/**
 * A goal about languages: it says so ("translator", "bilingual", "ESL"),
 * names a language the catalog teaches ("Spanish teacher"), or is read with
 * a pathway with a world language among its core skills (expandGoal).
 */
const LANGUAGE_GOAL = /\b(?:languages?|linguists?|linguistics|translat\w*|interpret(?:er|ers|ing)|bilingual|multilingual|polyglot|esl|tesol|tefl)\b/i;

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
export function careerFitFor(input: { text: string; vector: Float32Array | number[]; label?: string; school?: string; pathways?: PathwayVectors }, v: CourseVectors): CareerFit {
  // The goal read with its closest career pathway(s), when they are given and one is close enough.
  const expanded = input.pathways ? expandGoal(Float32Array.from(input.vector), input.pathways) : null;
  const goal = expanded ? expanded.vector : Float32Array.from(input.vector);
  const n = v.codes.length;
  const sims = new Float32Array(n);
  for (let i = 0; i < n; i++) sims[i] = dot(v, i, goal);
  const words = input.text.toLowerCase();
  const aboutLanguages = LANGUAGE_GOAL.test(input.text) || (expanded?.pathways.some((p) => p.languages) ?? false) ||
    // A language the catalog teaches, or one part of a joint name ("Hindi-Urdu": "Hindi" too).
    [...new Set([...(v.beginnerLanguage?.values() ?? [])].flatMap((language) => [language, ...language.split('-')]))]
      .some((language) => new RegExp(`\\b${language.toLowerCase().replace(/[^a-z]+/g, '\\W+')}\\b`).test(words));
  const excluded = (i: number) => !aboutLanguages && (v.beginnerLanguage?.has(i) ?? false);
  // Ranked by closeness to this goal beyond closeness to careers in general (CourseVectorsMeta.hubs);
  // a beginner language course is no goal course unless the goal is about languages.
  const score = sims.map((s, i) => (excluded(i) ? Number.NEGATIVE_INFINITY : v.hubs ? s - v.hubs[i] : s));
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
    if (rank[i] > take || sims[i] < MIN_SIMILARITY || excluded(i)) return 0;
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
    pathways: expanded?.pathways.map((p) => p.name) ?? [],
    aboutLanguages,
    capGroup: (code) => {
      const i = v.index.get(code);
      return i !== undefined && v.beginnerLanguage?.has(i) ? 'world languages' : code.split(' ')[0];
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
