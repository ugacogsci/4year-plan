import { courseTeachingMap, type CourseTeachingFile, type RatedTeaching } from './course-teaching';
import type { GradeRow } from './scheduler';
import type { ExcellentSummary } from './quality';
import type { SemesterSeason } from './types';
import type { RepeatRule } from './repeats';
import type { AdmissionTable, LanguageTable } from './autoplan';
import type {
  CoverageReport,
  DifficultyBands,
  IllinoisCourse,
  PrereqSpec,
  RawIllinoisCourse,
  RawIllinoisProgram,
  RawSectionCourse,
  SectionSummary,
  SectionTermInfo,
} from './illinois-data';
import { setCourseNumberDigits } from './illinois-data';
import { courseleafOf, type CourseleafId } from './school-config';

/**
 * The browser side of the Illinois data, and of every school on the same
 * CourseLeaf engine (school-config.ts): Georgia Tech's build sits in
 * public/gatech in the same shapes. setCourseleafSchool picks which one this
 * module reads; nothing else here knows there is more than one.
 *
 * The browser side of the Illinois data.
 *
 * scripts/illinois/build-index.mjs turns about 12 MB of raw crawl into the files
 * this module fetches. Nothing here parses or interprets anything: the build
 * step and the browser run the same adapters from illinois-data.ts, so this
 * module only fetches, caches and puts back the handful of fields the build step
 * left out because they were the same on all 6,110 rows.
 *
 * Load order, and why it is staged rather than one request:
 *
 *   meta.json     1.5 KB gzip   the term, the coverage counts, the provenance
 *                               strings and the cache-busting version. Small
 *                               enough that the header can be honest about what
 *                               is loaded before any of it is.
 *   index.json  179.4 KB gzip   every undergraduate course, with its map
 *                               position and its difficulty. The board, the
 *                               search and the constellation are usable here.
 *   prereqs + grades + sections + programs, in parallel, 242 KB gzip more.
 *                               The board is usable without them, so they must
 *                               not be awaited in front of it.
 *
 * Against 1.19 MB gzip for the raw catalog alone, which carries no grades, no
 * sections and no map.
 *
 * Three rules this module exists to keep:
 *
 * 1. Never refetch. Every request is cached as a promise keyed by URL, so React
 *    19's strict-mode double effect gets the same in-flight promise rather than
 *    a second network request.
 *
 * 2. Never block first paint. Nothing here runs at import time. Callers decide
 *    when, and loadIllinoisCore is written so the index resolves without waiting
 *    on the four files behind it.
 *
 * 3. Missing is not empty. The section crawl may still be running and a file may
 *    genuinely not be there. Every "did not load" is null, never an empty map or
 *    an empty array, because a UI that cannot tell those apart will tell a
 *    student a course has no prerequisites when the truth is that nobody checked.
 *
 *    The same rule one level down, inside prereqs.json. A course with no entry
 *    there is a course the catalog says nothing about. A course WITH an entry
 *    whose `note` is set has prerequisites the catalog states in prose and does
 *    not list, normally "See Class Schedule ... for topics and prerequisites",
 *    and 51 undergraduate courses are in that state. Its `text` carries the
 *    same sentence, so anything already printing `text` tells the truth; what it
 *    must not do is read the empty `groups` as "nothing to take first".
 *
 * Browser only. These are relative URLs, which have no meaning in a Cloudflare
 * Worker fetch, and there is no fs at runtime there either. Call from an effect
 * or an event handler, never during a server render: on the server every loader
 * resolves to its not-loaded value instead of throwing.
 */

/** Illinois's build. Its clubs (clubs-load.ts) and minors live here whatever school is active. */
export const ILLINOIS_BASE = '/illinois';

// ---------------------------------------------------------------------------
// The shapes on disk
// ---------------------------------------------------------------------------

export interface IllinoisSourceStamp {
  source: string;
  fetchedAt: string;
}

export interface IllinoisMeta {
  /** Which CourseLeaf school's build this is (build-index --school). */
  school: CourseleafId;
  /** Cache-busting version. Every other fetch in this module carries it. */
  fetchedAt: string;
  sources: {
    catalog: (IllinoisSourceStamp & { courses: number }) | null;
    programs: (IllinoisSourceStamp & { programs: number }) | null;
    grades: { source: string; terms: string; count: number } | null;
    sections: (IllinoisSourceStamp & { courses: number }) | null;
    map: { method: string; builtAt: string; count: number } | null;
  };
  term: { id: string; label: string; year: number; term: string; fetchedAt: string } | null;
  /**
   * Every crawled term of class times, oldest first, `term` among them.
   * Absent from builds that crawled one term only; sectionTermsOf reads both.
   */
  sectionTerms?: IllinoisSectionTermEntry[];
  bands: DifficultyBands;
  /** Already written in the house voice by gradeFootnote. Render it verbatim. */
  gradeFootnote: string;
  coverage: CoverageReport;
  counts: {
    indexed: number;
    positioned: number;
    withPrereqSpec: number;
    /** Indexed courses that show grade history, their own row or a borrowed one (see gradeFrom). */
    withGrades: number;
    /** Rows in grades.json. Absent from builds before the two were told apart. */
    gradeRows?: number;
    withSections: number;
    programs: number;
    programsWithCourses: number;
    programCourseRows: number;
    programRowsWithCredits: number;
    programRowsWithTitle: number;
    orphanGradeRows: number;
    subjectShards: number;
    programFiles: number;
  };
  subjects: string[];
  artifacts: Record<string, { raw: number; gzip: number }>;
  /** What this build could not do, in plain sentences. Safe to show a student. */
  notes: string[];
}

/**
 * A stored index row. Several fields of Course are missing from it on purpose.
 * hydrateIndexRow puts back the ones that have one honest value; see its comment.
 */
export interface IllinoisIndexRow {
  id: string;
  code: string;
  title: string;
  credits: number;
  creditsMax?: number;
  /** The subject prefix, which is also the name of this course's detail shard. */
  cluster: string;
  level: number;
  tags?: string[];
  prerequisites?: string[];
  /** Absent means 'In person'. Set only when every section of the course is online. */
  online?: true;
  difficulty?: number;
  /**
   * The code the registrar filed this course's grades under: a cross-listed
   * twin (CS 468 under ADV 492), or this course's old number (ES 470 under
   * NPRE 470). RENUMBERED_GRADE_HISTORY in illinois-data.ts says which.
   */
  gradeFrom?: string;
  /** The other codes this same class is filed under. */
  twins?: string[];
  mapPosition?: { x: number; y: number };
  /** The catalog's repeat rule (repeats.ts); absent when the course may not be repeated. */
  repeat?: RepeatRule;
  /**
   * Who the course is written for, where its catalog title or description
   * says so (Georgia Tech's build): 'heritage-learners' for CHIN 1501
   * Chinese for Heritage Learners I, 'first-year' for CS 1100 Pathways in
   * Computing ("discussions with first year students"). Absent for anyone.
   * The planner reads it for its open picks and first-term courses
   * (school-config openPicks; autoplan.ts catalogAudienceOf).
   */
  audience?: CatalogAudience;
}

/** Who a course is written for, as index.json's `audience` says it. */
export type CatalogAudience = 'heritage-learners' | 'first-year';

export interface IllinoisIndexCourse extends IllinoisCourse {
  /** 100, 200, 300, 400. The catalog's own number, not a guess from the code. */
  level: number;
  /** Registrar difficulty, 0 to 100. Absent means no grade history for this course. */
  difficulty?: number;
  /**
   * The code the registrar actually filed these grades under, when it is not
   * this course's own. CS 468's history is on file as ADV 492, the same class
   * under two codes (503 rows); ES 470's is on file as NPRE 470, its number
   * until this year (9 rows, RENUMBERED_GRADE_HISTORY in illinois-data.ts).
   */
  gradeFrom?: string;
  /** The other codes this same class is filed under, when there are any. */
  twins?: string[];
  /** Who the course is written for, where the catalog says (IllinoisIndexRow.audience). */
  audience?: CatalogAudience;
  /**
   * False on every index row, because index.json carries no descriptions.
   * course.description is '' here and must not render as a course with nothing
   * to say about itself. loadIllinoisCourseDetail fills it in.
   */
  detailLoaded: boolean;
}

/**
 * The grade file minus the instructor rows, which are two thirds of its bytes
 * and are only read once a course is opened. instructorCount is kept so a card
 * can say how many there are without fetching them.
 */
export interface IllinoisGradeSummary {
  code: string;
  n: number;
  sections: number;
  gpa: number | null;
  aPct: number | null;
  dfPct: number | null;
  withdrawPct: number | null;
  difficulty: number | null;
  instructorCount: number;
}

/** One crawled term of class times as meta.json lists it. */
export interface IllinoisSectionTermEntry extends SectionTermInfo {
  source?: string | null;
  /** Undergraduate courses with at least one section that term. */
  courses?: number;
  /** The built summary, relative to /illinois: "sections.json", "sections/spring-2027.json". */
  file?: string;
  /** The crawl file in public/ that the ask router reads rows from: "illinois-sections-sp2027.json". */
  raw?: string;
}

/** sections.json, with the term hoisted out of one identical copy per course. */
export interface IllinoisSectionsFile {
  termId: string;
  termLabel: string;
  capturedAt: string;
  courses: Array<Omit<SectionSummary, 'termId' | 'termLabel'>>;
}

export interface IllinoisProgramSummary {
  id: string;
  name: string;
  degree: string;
  college: string;
  concentration: string | null;
  url: string;
  totalCredits: number | null;
  courseCount: number;
  areaCount: number;
  blockCount: number;
  /** 'catalog' when the crawl read real course rows. 'placeholder' when it did not. */
  dataStatus: 'catalog' | 'placeholder' | 'reviewed-demo';
}

export interface IllinoisSubjectShard {
  subject: string;
  /** Every catalog row for the subject, graduate rows included, so a cross-list can resolve. */
  courses: RawIllinoisCourse[];
  /** The individual Fall 2026 sections, with their buildings, days and instructors. */
  sections: RawSectionCourse[];
  /** Historical per-instructor grade rows, keyed by course code. */
  instructors: Array<{ code: string; instructors: GradeRow['instructors'] }>;
  /**
   * The other crawled terms' rows, by term id ("spring-2027"). A term with an
   * empty list was crawled and the subject had nothing that term; a term
   * missing here was not crawled. Absent from one-term builds.
   */
  sectionsByTerm?: Record<string, RawSectionCourse[]>;
}

export interface IllinoisCourseDetail {
  code: string;
  /** The catalog row, with the description and the prerequisite sentence. */
  course: RawIllinoisCourse | null;
  /** Null when the section crawl has no row for this course, not when it has none. */
  sections: RawSectionCourse | null;
  /**
   * The same, for every crawled term, by term id: the first term (the one
   * `sections` holds) and each term in the shard's sectionsByTerm. A term id
   * missing here was not crawled; null means crawled and no row for this course.
   */
  sectionsByTerm: Record<string, RawSectionCourse | null>;
  /** Null when there is no grade history for this course at all. */
  instructors: GradeRow['instructors'] | null;
}

/**
 * Everything the board needs, with a null for anything that did not load.
 *
 * The nulls are the point. prereqs null means "not checked yet", which is a
 * different sentence from "this course has no prerequisites", and the section
 * crawl not having finished must never read as a course with no sections.
 */
export interface IllinoisOfferingsFile {
  source: string;
  fetchedAt: string;
  /** Term ids the crawl read, newest first: "fa2026", "sp2026". */
  terms: string[];
  courses: Record<string, string[]>;
  /** New number -> old number, where the history is the old number's. */
  renumbered?: Record<string, string>;
}

const SEASON_OF: Record<string, SemesterSeason> = { fa: 'Fall', sp: 'Spring', su: 'Summer' };

/**
 * Replace the permissive "fall and spring" on every row with what the Course
 * Explorer showed. A course seen in no crawled term gets an empty list and
 * offeringKnown true, which the engine reads as dormant. Shared with the
 * check harnesses so a plan audited offline sees the same seasons the
 * browser does.
 */
export function applyOfferings(rows: Array<{ code: string; offeredIn: SemesterSeason[]; offeringKnown?: boolean }>, file: IllinoisOfferingsFile): void {
  if (!file.terms || file.terms.length === 0) return;
  for (const row of rows) {
    const ran = file.courses[row.code] ?? [];
    const seasons = new Set<SemesterSeason>();
    for (const t of ran) {
      const season = SEASON_OF[t.slice(0, 2)];
      if (season) seasons.add(season);
    }
    row.offeredIn = [...seasons];
    row.offeringKnown = true;
  }
}

export interface IllinoisExcellentFile {
  source: string;
  sourceNote: string;
  fetchedAt: string;
  /** Newest first, "sp2025". */
  terms: string[];
  courses: Record<string, ExcellentSummary>;
}

export interface IllinoisCore {
  /**
   * The school this core was loaded for (setCourseleafSchool). Its programs
   * are adapted under that school's course numbering, whatever school is
   * active by the time they are read. Absent only on a core built by hand.
   */
  school?: CourseleafId;
  meta: IllinoisMeta | null;
  index: IllinoisIndexCourse[];
  byId: Map<string, IllinoisIndexCourse>;
  byCode: Map<string, IllinoisIndexCourse>;
  prereqs: Map<string, PrereqSpec> | null;
  grades: Map<string, IllinoisGradeSummary> | null;
  sections: Map<string, SectionSummary> | null;
  /**
   * Every crawled term whose sections loaded, oldest first, the first term
   * (`sections`) among them: Fall 2026 and Spring 2027. The plan scores a
   * spring column's courses on the spring schedule (PlanningContext
   * termSections), so the other terms load with the core rather than when a
   * card first asks. Null when only the first term was crawled or loaded.
   */
  sectionTerms: Array<{ entry: IllinoisSectionTermEntry; sections: Map<string, SectionSummary> }> | null;
  programs: IllinoisProgramSummary[] | null;
  /**
   * "Credit is not given for both MATH 221 and either MATH 220 or MATH 234."
   * This lived only in the full catalog adapter, which resolves well after the
   * plan is generated, so no generated plan ever had it checked and a student
   * holding MATH 220 was handed MATH 221 with both counted toward the degree.
   * It is small enough to load with the core and be right from the first plan.
   */
  exclusions: Map<string, string[]> | null;
  /**
   * Teachers Ranked as Excellent, per course, with the terms the list covers.
   * Null when the build had no list, which the scorer reads as "teaching
   * ratings not known" rather than as a course nobody rated.
   */
  excellent: Map<string, ExcellentSummary> | null;
  excellentTerms: string[] | null;
  /**
   * Which recent terms each course has run in, "fa2026" newest first, and
   * the terms the crawl covered. Null when the build had none, in which case
   * every course keeps the permissive "fall and spring" and nothing is
   * called dormant.
   */
  offerings: Map<string, string[]> | null;
  offeringTerms: string[] | null;
  /**
   * Difficulty for courses with no grade history, from the ratings of the
   * professors the sections name, on the grade-history scale by a fitted
   * line (scripts/difficulty/illinois-difficulty.mjs). Null when absent.
   */
  ratingsDifficulty?: Map<string, number> | null;
  /** Student ratings of the instructors on each course's schedule (course-teaching.ts); null when the build has none. */
  teachingRatings?: Map<string, RatedTeaching> | null;
  /** New course number -> the old number whose history it carries. */
  offeringAliases: Map<string, string> | null;
  /** The registrar's language table; null when the build had none. */
  languages: LanguageTable | null;
  /** What each college publishes about transferring in from another college on campus. */
  admission: AdmissionTable | null;
  /**
   * Cross-listing classes by code: LLS 200 -> [AAS 200]. Built from the index
   * rows, so a requirement written as one code is met by the other from the
   * first plan rather than after a second load that the plan never waits for.
   * Null when the index predates the field.
   */
  equivalents: Map<string, string[]> | null;
  /** Artifact names that were not there, for the header to name out loud. */
  missing: string[];
}

// ---------------------------------------------------------------------------
// Fetching, once
// ---------------------------------------------------------------------------

type Fetched<T> = { ok: true; value: T } | { ok: false; reason: 'missing' | 'error' | 'server' };

/**
 * Everything this module remembers, for one school.
 *
 * Kept together so that switching school drops all of it at once: the index,
 * the prerequisites, the programs, the offerings, the course shards and the
 * per-URL responses. A load that was already under way when the student
 * switched keeps the state it started with, finishes against its own school's
 * files and writes nothing into the new school's caches, so a Georgia Tech
 * board can never be handed a half-Illinois core.
 */
interface LoaderState {
  id: CourseleafId;
  /** '/illinois' or '/gatech'. */
  base: string;
  /**
   * Keyed by URL rather than by artifact, so a rebuild's new ?v= is a new entry
   * and the stale one is simply never asked for again.
   */
  responses: Map<string, Promise<Fetched<unknown>>>;
  shards: Map<string, Promise<Fetched<IllinoisSubjectShard>>>;
  sectionTerms: Map<string, Promise<Fetched<IllinoisSectionsFile>>>;
  syllabi: Map<string, Promise<Fetched<IllinoisSyllabusShard>>>;
  programs: Map<string, Promise<Fetched<RawIllinoisProgram>>>;
  meta: Promise<IllinoisMeta | null> | null;
  index: Promise<Fetched<IllinoisIndexCourse[]>> | null;
  core: Promise<IllinoisCore> | null;
}

function freshState(id: CourseleafId): LoaderState {
  return {
    id,
    base: courseleafOf(id)?.base ?? ILLINOIS_BASE,
    responses: new Map(),
    shards: new Map(),
    sectionTerms: new Map(),
    syllabi: new Map(),
    programs: new Map(),
    meta: null,
    index: null,
    core: null,
  };
}

/** The active school's state. Illinois until something says otherwise, as before there was a second school. */
let state: LoaderState = freshState('illinois');

/**
 * Point this module at one CourseLeaf school's build.
 *
 * Sets the course-number shape illinois-data parses with (Illinois 'CS 225',
 * Georgia Tech 'CS 1331' and 'CHEM 1211K') every time, and, when the school
 * is a different one, forgets everything loaded for the last school. Calling
 * it again with the same school keeps the caches.
 */
export function setCourseleafSchool(id: CourseleafId): void {
  const leaf = courseleafOf(id);
  if (!leaf) return;
  setCourseNumberDigits(leaf.numberDigits, leaf.letterSuffix);
  if (state.id !== leaf.id) state = freshState(leaf.id);
}

/** The school this module is reading now. */
export function courseleafSchoolId(): CourseleafId {
  return state.id;
}

const isBrowser = () => typeof window !== 'undefined' && typeof fetch === 'function';

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

function fetchJson<T>(s: LoaderState, url: string, init?: RequestInit): Promise<Fetched<T>> {
  if (!isBrowser()) return Promise.resolve({ ok: false, reason: 'server' });

  const cache = s.responses;
  const hit = cache.get(url);
  if (hit) return hit as Promise<Fetched<T>>;

  const run = fetch(url, init)
    .then(async (res): Promise<Fetched<T>> => {
      // A 404 is a real answer here and it is cached: the file is not in this
      // build and retrying will not conjure it. Anything else is a transient
      // failure, so the entry is dropped below and the next caller may retry.
      if (res.status === 404) return { ok: false, reason: 'missing' };
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      /**
       * A host that falls back to the app shell answers a missing file with 200
       * and an HTML page. Without this that page would reach res.json(), throw,
       * and be filed as a transient network failure, and the loader would retry
       * a file that is never coming.
       */
      if ((res.headers.get('content-type') ?? '').includes('html')) {
        return { ok: false, reason: 'missing' };
      }
      return { ok: true, value: (await res.json()) as T };
    })
    .catch((): Fetched<T> => {
      cache.delete(url);
      return { ok: false, reason: 'error' };
    });

  cache.set(url, run as Promise<Fetched<unknown>>);
  return run;
}

/** A 404 is a settled answer. Anything else is worth trying again. */
const transient = (r: Fetched<unknown>): boolean => !r.ok && r.reason !== 'missing';

/**
 * Remember one artifact by key, and forget it again if the failure was the kind
 * that might not happen twice.
 *
 * Without the forgetting, one dropped connection during the second wave would
 * leave the board saying "prerequisites not checked" for the rest of the
 * session, with no way back short of a reload.
 */
function memo<T>(
  store: Map<string, Promise<Fetched<T>>>,
  key: string,
  run: () => Promise<Fetched<T>>,
): Promise<Fetched<T>> {
  const hit = store.get(key);
  if (hit) return hit;
  const started = run().then((r) => {
    if (transient(r)) store.delete(key);
    return r;
  });
  store.set(key, started);
  return started;
}

/** Drops every cached response for the active school. For a dev rebuild, and for tests. */
export function resetIllinoisCache(): void {
  state = freshState(state.id);
}

// ---------------------------------------------------------------------------
// meta.json, and the version every other fetch carries
// ---------------------------------------------------------------------------

/**
 * Null means the build step has not run, or its output is not deployed. The
 * caller's move then is to keep sample data and say Illinois data is not loaded,
 * rather than render an empty catalog as if Illinois had no courses.
 *
 * Fetched with cache: 'no-cache' because it is the only file whose URL never
 * changes. Everything else is versioned off its fetchedAt, so a revalidation of
 * this one 1.5 KB file is what makes a rebuild visible at all.
 */
export function loadIllinoisMeta(): Promise<IllinoisMeta | null> {
  return metaOf(state);
}

function metaOf(s: LoaderState): Promise<IllinoisMeta | null> {
  if (s.meta) return s.meta;
  const started = fetchJson<IllinoisMeta>(s, `${s.base}/meta.json`, { cache: 'no-cache' }).then(
    (r) => {
      if (transient(r)) s.meta = null;
      return r.ok ? r.value : null;
    },
  );
  s.meta = started;
  return started;
}

/**
 * public/ is served without content hashes, so a rebuilt index.json would sit
 * behind whatever the CDN and the browser already cached. Stamping the build's
 * own timestamp on every URL means one rebuild re-fetches everything exactly
 * once. Without meta there is no version to stamp, and the caller has already
 * been told the data is not loaded.
 */
async function versioned(s: LoaderState, path: string): Promise<string> {
  const meta = await metaOf(s);
  const url = `${s.base}/${path}`;
  return meta ? `${url}?v=${encodeURIComponent(meta.fetchedAt)}` : url;
}

// ---------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------

/**
 * Put back what the build step left out, with the same values
 * adaptIllinoisCourse gives a freshly parsed catalog row.
 *
 * offeredIn and offeringKnown: Illinois publishes no offering term anywhere, and
 * one crawled term is not evidence that a course skips spring. The permissive
 * pair is the honest one, and rules.ts reads offeringKnown and stays quiet.
 *
 * requirementIds and pathwayRole: empty until a degree is chosen. They belong to
 * one program, and attachRequirementIds fills them from that program's file.
 *
 * description: '' with detailLoaded false. There is no description in the index
 * at all, and the flag is what stops a card rendering the blank as an answer.
 */
export function hydrateIndexRow(row: IllinoisIndexRow): IllinoisIndexCourse {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    credits: row.credits,
    ...(row.creditsMax !== undefined ? { creditsMax: row.creditsMax } : {}),
    description: '',
    cluster: row.cluster,
    level: row.level,
    requirementIds: [],
    prerequisites: row.prerequisites ?? [],
    offeredIn: ['Fall', 'Spring'],
    offeringKnown: false,
    format: row.online ? 'Online' : 'In person',
    tags: row.tags ?? [],
    ...(row.difficulty !== undefined ? { difficulty: row.difficulty } : {}),
    // gradeFrom was written by the build and dropped here, so the twin keying
    // in loadIllinoisCore never ran and CS 468 showed no grade history beside
    // an ADV 492 card with a 3.78 average.
    ...(row.gradeFrom ? { gradeFrom: row.gradeFrom } : {}),
    ...(row.twins && row.twins.length > 0 ? { twins: row.twins } : {}),
    ...(row.mapPosition ? { mapPosition: row.mapPosition } : {}),
    ...(row.repeat ? { repeat: row.repeat } : {}),
    // Who the catalog writes it for (Georgia Tech's heritage-learner and first-year courses), read by the open picks.
    ...(row.audience ? { audience: row.audience } : {}),
    detailLoaded: false,
  };
}

/** One versioned artifact of one school's build, fetched through that school's per-URL cache. */
const artifactOf = async <T>(s: LoaderState, path: string): Promise<Fetched<T>> => fetchJson<T>(s, await versioned(s, path));

function indexResult(s: LoaderState): Promise<Fetched<IllinoisIndexCourse[]>> {
  if (s.index) return s.index;
  const started = artifactOf<IllinoisIndexRow[]>(s, 'index.json').then(
    (r): Fetched<IllinoisIndexCourse[]> => {
      if (transient(r)) s.index = null;
      return r.ok ? { ok: true, value: r.value.map(hydrateIndexRow) } : r;
    },
  );
  s.index = started;
  return started;
}

/**
 * Null, not [], when index.json is not there. An empty course list would render
 * as a university that offers nothing.
 */
export async function loadIllinoisIndex(): Promise<IllinoisIndexCourse[] | null> {
  const r = await indexResult(state);
  return r.ok ? r.value : null;
}

// ---------------------------------------------------------------------------
// The second wave
// ---------------------------------------------------------------------------

/**
 * Everything the board needs, in one call, cached once.
 *
 * This awaits all five files, so a caller that wants the board on screen before
 * validation is live should render off loadIllinoisIndex first and let this
 * resolve behind it. Both share the same per-URL cache, so doing that costs no
 * extra request.
 *
 * The result is only memoised when nothing failed in a way that might not fail
 * again. A 404 is settled and stays settled; a dropped connection is not, and
 * caching that would leave the board saying "prerequisites not checked" for the
 * rest of the session.
 */
export function loadIllinoisCore(): Promise<IllinoisCore> {
  return coreOf(state);
}

function coreOf(s: LoaderState): Promise<IllinoisCore> {
  if (s.core) return s.core;
  const artifact = <T,>(path: string) => artifactOf<T>(s, path);
  /*
   * A file the school's switches say it does not publish (school-config.ts)
   * is settled as missing without a request: Georgia Tech asked for six that
   * do not exist on every board load, six 404s in the console.
   */
  const leaf = courseleafOf(s.id);
  const optional = <T,>(path: string, published: boolean | undefined): Promise<Fetched<T>> =>
    published === false ? Promise.resolve({ ok: false, reason: 'missing' }) : artifact<T>(path);
  const started = (async (): Promise<IllinoisCore> => {
    const meta = await metaOf(s);
    const laterTerms = sectionTermsOf(meta).filter((t) => t.id !== meta?.term?.id && t.file);
    const [index, prereqs, grades, sections, programs, exclusions, excellent, offerings, languages, admission, laterSections, ratingsDifficulty, ratedTeaching] = await Promise.all([
      indexResult(s),
      artifact<Record<string, PrereqSpec>>('prereqs.json'),
      artifact<IllinoisGradeSummary[]>('grades.json'),
      optional<IllinoisSectionsFile>('sections.json', leaf?.sections),
      artifact<IllinoisProgramSummary[]>('programs.json'),
      artifact<Record<string, string[]>>('exclusions.json'),
      // Optional: a build without the list answers 404 here, and that is a
      // settled fact about the build, not a reason to retry the core.
      optional<IllinoisExcellentFile>('excellent.json', leaf?.ratings),
      artifact<IllinoisOfferingsFile>('offerings.json'),
      optional<LanguageTable>('languages.json', leaf?.languageRule),
      optional<AdmissionTable>('admission.json', leaf?.collegeRules),
      // The other crawled terms, through the same cache a card's question uses (loadIllinoisSectionTerm).
      Promise.all(laterTerms.map((t) => memo(s.sectionTerms, t.id, () => artifact<IllinoisSectionsFile>(t.file as string)))),
      optional<{ courses: Record<string, { d: number }> }>('course-difficulty-ratings.json', leaf?.ratings),
      // Optional, like the list: student ratings of the instructors, for the courses the list is silent on (course-teaching.ts).
      optional<CourseTeachingFile>('course-teaching-ratings.json', leaf?.ratings),
    ]);

    const results = [index, prereqs, grades, sections, programs, exclusions];
    if (!meta || results.some(transient)) s.core = null;

    const rows = index.ok ? index.value : [];
    if (offerings.ok) applyOfferings(rows, offerings.value);
    const missing: string[] = [];
    if (!meta) missing.push('meta.json');
    if (!index.ok) missing.push('index.json');
    if (!prereqs.ok) missing.push('prereqs.json');
    // A build that never had a source (Georgia Tech publishes no grade
    // history; its class times are not built yet) is not missing a file.
    if (!grades.ok && meta?.sources?.grades !== null) missing.push('grades.json');
    if (!sections.ok && meta?.sources?.sections !== null) missing.push('sections.json');
    if (!programs.ok) missing.push('programs.json');
    if (!exclusions.ok) missing.push('exclusions.json');
    /**
     * The term is stamped back onto every row here rather than stored once
     * per course. A whole SectionSummary is what buildingLine, partOfTermLine
     * and sectionSnapshot take, and handing out a near-miss would make every
     * call site patch it.
     */
    const firstSections = sections.ok
      ? new Map(
          sections.value.courses.map((row) => [
            normCode(row.code),
            { ...row, termId: sections.value.termId, termLabel: sections.value.termLabel },
          ]),
        )
      : null;

    return {
      school: s.id,
      meta,
      index: rows,
      byId: new Map(rows.map((c) => [c.id, c])),
      byCode: new Map(rows.map((c) => [normCode(c.code), c])),
      prereqs: prereqs.ok ? new Map(Object.entries(prereqs.value)) : null,
      exclusions: exclusions.ok ? new Map(Object.entries(exclusions.value)) : null,
      excellent: excellent.ok ? new Map(Object.entries(excellent.value.courses)) : null,
      ratingsDifficulty: ratingsDifficulty.ok ? new Map(Object.entries(ratingsDifficulty.value.courses).map(([code, v]) => [code, v.d])) : null,
      teachingRatings: ratedTeaching.ok ? courseTeachingMap(ratedTeaching.value) : null,
      excellentTerms: excellent.ok ? excellent.value.terms : null,
      offerings: offerings.ok ? new Map(Object.entries(offerings.value.courses)) : null,
      offeringTerms: offerings.ok ? offerings.value.terms : null,
      offeringAliases: offerings.ok && offerings.value.renumbered ? new Map(Object.entries(offerings.value.renumbered)) : null,
      languages: languages.ok ? languages.value : null,
      admission: admission.ok ? admission.value : null,
      equivalents: (() => {
        const map = new Map<string, string[]>();
        for (const course of rows) {
          if (course.twins && course.twins.length > 0) map.set(normCode(course.code), course.twins.map(normCode));
        }
        return map.size > 0 ? map : null;
      })(),
      /**
       * Keyed by every code the row answers for, not only the one the registrar
       * filed it under.
       *
       * 503 courses carry their grade history under a cross-listed twin, and
       * 9 under their old number, and index.json records that in gradeFrom.
       * Keying this map by the row's own code alone meant grades.get("CS 468")
       * was undefined while the card two
       * inches away showed ADV 492's real 3.78 average. The plan then counted
       * CS 468 as "no grade data" when weighing a term, so the product denied
       * history it was displaying and printed two different numbers for the
       * same semester.
       */
      grades: grades.ok
        ? (() => {
            const byCode = new Map(grades.value.map((row) => [normCode(row.code), row]));
            for (const course of rows) {
              if (!course.gradeFrom) continue;
              const source = byCode.get(normCode(course.gradeFrom));
              if (source) byCode.set(normCode(course.code), source);
            }
            return byCode;
          })()
        : null,
      sections: firstSections,
      programs: programs.ok ? programs.value : null,
      sectionTerms: (() => {
        if (!firstSections || !meta?.term) return null;
        const first = sectionTermsOf(meta).find((t) => t.id === meta.term?.id) ?? { ...meta.term, file: 'sections.json' };
        const out: Array<{ entry: IllinoisSectionTermEntry; sections: Map<string, SectionSummary> }> = [];
        laterTerms.forEach((entry, i) => {
          const r = laterSections[i];
          if (r.ok) out.push({ entry, sections: summariesOf(r.value) });
        });
        if (out.length === 0) return null;
        return [{ entry: first, sections: firstSections }, ...out];
      })(),
      missing,
    };
  })();
  s.core = started;
  return started;
}

// ---------------------------------------------------------------------------
// On demand: one subject, one course, one program
// ---------------------------------------------------------------------------

/**
 * A subject and a program id both become part of a URL, so both are checked
 * against what the build step is allowed to write. Anything else is a caller
 * bug or a crawl that produced something strange, and either way it must not
 * turn into a request for ../../something.
 */
const SAFE_SUBJECT = /^[A-Z][A-Z0-9]{0,9}$/;
const SAFE_PROGRAM_ID = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}$/;

/**
 * The full detail for one subject: descriptions, prerequisite sentences, every
 * individual section with its building, and the per-instructor grade history.
 * Median 28 KB, largest 269 KB. Cached, so the second course a student opens in
 * the same subject costs nothing.
 */
export async function loadIllinoisSubjectShard(subject: string): Promise<IllinoisSubjectShard | null> {
  return shardOf(state, subject);
}

async function shardOf(s: LoaderState, subject: string): Promise<IllinoisSubjectShard | null> {
  const key = subject.trim().toUpperCase();
  if (!SAFE_SUBJECT.test(key)) return null;
  const r = await memo(s.shards, key, () => artifactOf<IllinoisSubjectShard>(s, `course/${key}.json`));
  return r.ok ? r.value : null;
}

/** The catalog rows of one subject. Null means the shard is not there. */
export async function loadIllinoisSubject(subject: string): Promise<RawIllinoisCourse[] | null> {
  const shard = await loadIllinoisSubjectShard(subject);
  return shard ? shard.courses : null;
}

/**
 * One course's detail, from its subject's shard.
 *
 * Each of the three fields is null when that source has nothing for this course,
 * which is a different thing from having an empty answer: a course with no
 * section row has not been crawled yet, and one with no instructor row has no
 * grade history rather than an anonymous one.
 */
export async function loadIllinoisCourseDetail(code: string): Promise<IllinoisCourseDetail | null> {
  const wanted = normCode(code);
  const subject = wanted.split(' ')[0] ?? '';
  const loader = state;
  const [shard, meta] = await Promise.all([shardOf(loader, subject), metaOf(loader)]);
  if (!shard) return null;
  const sections = shard.sections.find((s) => normCode(s.code) === wanted) ?? null;
  const sectionsByTerm: Record<string, RawSectionCourse | null> = {};
  if (meta?.term) sectionsByTerm[meta.term.id] = sections;
  for (const [termId, rows] of Object.entries(shard.sectionsByTerm ?? {})) {
    sectionsByTerm[termId] = rows.find((s) => normCode(s.code) === wanted) ?? null;
  }
  return {
    code: wanted,
    course: shard.courses.find((c) => normCode(c.code) === wanted) ?? null,
    sections,
    sectionsByTerm,
    instructors: shard.instructors.find((g) => normCode(g.code) === wanted)?.instructors ?? null,
  };
}

// ---------------------------------------------------------------------------
// More than one term of class times, on demand
// ---------------------------------------------------------------------------

/**
 * Every crawled term of class times, oldest first.
 *
 * A build that crawled one term has no sectionTerms and reads as that term
 * alone, so a caller never has to tell the two kinds of build apart.
 */
export function sectionTermsOf(meta: IllinoisMeta | null | undefined): IllinoisSectionTermEntry[] {
  if (!meta) return [];
  if (meta.sectionTerms && meta.sectionTerms.length > 0) return meta.sectionTerms;
  return meta.term ? [{ ...meta.term, file: 'sections.json' }] : [];
}

/**
 * One crawled term's section summaries, by course code, with the term
 * stamped back on every row the way loadIllinoisCore stamps the first one.
 *
 * The first term is the one the core already holds, and is answered from it
 * rather than parsed twice. Any other term is fetched the first time a card,
 * ALMA or the advisor packet asks about a course in it (about 120 KB gzip for
 * Spring 2027), which is why it is not in the first load. Null when the term
 * was not crawled or its file did not load.
 */
export async function loadIllinoisSectionTerm(termId: string): Promise<Map<string, SectionSummary> | null> {
  return sectionTermOf(state, termId);
}

async function sectionTermOf(s: LoaderState, termId: string): Promise<Map<string, SectionSummary> | null> {
  const meta = await metaOf(s);
  if (!meta) return null;
  if (meta.term?.id === termId) return (await coreOf(s)).sections;
  const entry = sectionTermsOf(meta).find((t) => t.id === termId);
  if (!entry?.file) return null;
  const file = entry.file;
  const r = await memo(s.sectionTerms, termId, () => artifactOf<IllinoisSectionsFile>(s, file));
  if (!r.ok) return null;
  return summariesOf(r.value);
}

/** The parsed map per file, so two callers of the same term share one. */
const summaryMaps = new WeakMap<IllinoisSectionsFile, Map<string, SectionSummary>>();

function summariesOf(file: IllinoisSectionsFile): Map<string, SectionSummary> {
  const hit = summaryMaps.get(file);
  if (hit) return hit;
  const map = new Map(
    file.courses.map((row) => [normCode(row.code), { ...row, termId: file.termId, termLabel: file.termLabel }]),
  );
  summaryMaps.set(file, map);
  return map;
}

/** Every crawled term's summaries, by term id. A term that did not load is left out. */
export async function loadIllinoisSectionTerms(): Promise<Map<string, Map<string, SectionSummary>>> {
  const s = state;
  const meta = await metaOf(s);
  const out = new Map<string, Map<string, SectionSummary>>();
  const terms = sectionTermsOf(meta);
  const loaded = await Promise.all(terms.map((t) => sectionTermOf(s, t.id)));
  terms.forEach((t, i) => {
    const map = loaded[i];
    if (map) out.set(t.id, map);
  });
  return out;
}

/**
 * What a course's own published syllabi say, as scripts/illinois/syllabi
 * extracted it: the grade breakdown, exams, materials and course policies,
 * each syllabus with its term, instructors and a link to the instructor's
 * document. Facts only; the documents stay with their authors.
 */
export interface IllinoisSyllabus {
  term: string | null;
  termLabel: string | null;
  section: string | null;
  instructors: string[];
  kind: 'syllabus' | 'course-policy' | 'master-outline';
  source: string;
  url: string;
  grading: {
    basis: 'percent' | 'points' | 'letter-only' | 'pass-fail' | 'unknown';
    components: Array<{ item: string; weight: number | null; unit: 'percent' | 'points' | 'unknown'; note: string | null }>;
    pointsTotal: number | null;
    scale: string | null;
    curve: string | null;
    drop: string | null;
    extraCredit: string | null;
  };
  exams: Array<{ name: string; when: string | null; note: string | null }>;
  finalExam: string | null;
  materials: Array<{ item: string; required: boolean | null }>;
  attendance: string | null;
  lateWork: string | null;
  makeups: string | null;
  other: string[];
  confidence: 'high' | 'medium' | 'low';
  /** Set when the syllabus was published under a cross-listed twin of this course. */
  viaCrossList?: string;
  /** A master outline's stated learning objectives (UGA's Bulletin publishes them), when it has no grading. */
  objectives?: string[];
  /** A master outline's topical outline, in order. */
  topics?: string[];
}

interface IllinoisSyllabusShard {
  subject: string;
  builtAt: string;
  courses: Record<string, IllinoisSyllabus[]>;
}

/**
 * A course's syllabi, newest term first. An empty list means none was found
 * in the public sources the scraper reads (most syllabi live in Canvas,
 * behind a login), not that the course has none.
 */
export async function loadIllinoisSyllabi(code: string): Promise<IllinoisSyllabus[]> {
  const wanted = normCode(code);
  const subject = wanted.split(' ')[0] ?? '';
  if (!SAFE_SUBJECT.test(subject)) return [];
  const s = state;
  const r = await memo(s.syllabi, subject, () => artifactOf<IllinoisSyllabusShard>(s, `syllabi/${subject}.json`));
  return r.ok ? (r.value.courses[wanted] ?? []) : [];
}

/**
 * One degree, exactly as it was crawled. The caller runs adaptIllinoisPrograms
 * over it, which is the only way the requirement ids a saved plan holds can
 * match the ones the build step would have produced from the same bytes.
 *
 * Program ids carry slashes ("bus/accountancy-bs"), and the file is nested to
 * match, so the id needs no escaping beyond the shape check above.
 */
export async function loadIllinoisProgram(id: string): Promise<RawIllinoisProgram | null> {
  const key = id.trim();
  if (!SAFE_PROGRAM_ID.test(key)) return null;
  const s = state;
  const r = await memo(s.programs, key, () => artifactOf<RawIllinoisProgram>(s, `program/${key}.json`));
  return r.ok ? r.value : null;
}

// ---------------------------------------------------------------------------
// Small joins the callers would otherwise each write
// ---------------------------------------------------------------------------

/**
 * A GradeRow out of the slim summary, for the functions in illinois-data.ts that
 * take one.
 *
 * instructors is a parameter rather than a default because of what an empty list
 * would mean if this filled it in. difficultyLabel never reads it, so passing []
 * there is safe. visibleInstructors does read it, and [] would render as a
 * course nobody has taught: pass the list from loadIllinoisCourseDetail instead.
 */
export function toGradeRow(
  summary: IllinoisGradeSummary,
  title: string,
  instructors: GradeRow['instructors'],
): GradeRow {
  return {
    code: summary.code,
    title,
    n: summary.n,
    sections: summary.sections,
    gpa: summary.gpa,
    aPct: summary.aPct,
    dfPct: summary.dfPct,
    withdrawPct: summary.withdrawPct,
    difficulty: summary.difficulty,
    instructors,
  };
}

/**
 * Students a year in each course, from the grade reports: students graded
 * over the span the meta file names ("Spring 2024 through Summer 2026", two
 * and a half years of falls and springs), for the free choices' "commonly
 * taken" (autoplan.ts freeChoiceSignals). Undefined when the span cannot be
 * read. The all-degrees sweep reads it the same way (scripts/dev/sweep):
 * built without it, the sweep ranked SHS 222 (2,520 students) by its two
 * Fall 2026 sections and ECE 316 (171) the same.
 */
export function takenPerYear(grades: ReadonlyMap<string, { n: number }> | null | undefined, span: string): Map<string, number> | undefined {
  const m = span.match(/(Spring|Summer|Fall)\s+(\d{4})\s+through\s+(Spring|Summer|Fall)\s+(\d{4})/i);
  if (!grades || !m) return undefined;
  const at = (season: string, year: string) => Number(year) * 2 + (/fall/i.test(season) ? 1 : 0);
  // A span from a summer starts with the fall after it.
  const regular = at(m[3], m[4]) - (at(m[1], m[2]) + (/summer/i.test(m[1]) ? 1 : 0)) + 1;
  if (regular <= 0) return undefined;
  return new Map([...grades].map(([code, summary]) => [code, summary.n / (regular / 2)]));
}

/**
 * One sentence for the header, naming what is loaded and what is not.
 *
 * It says "not loaded" rather than reporting zero, because the section crawl is
 * still running and a count of zero would read as a term with no classes in it.
 */
export function coverageLine(core: IllinoisCore): string {
  if (!core.meta || core.index.length === 0) return (core.school ?? 'illinois') === 'illinois' ? 'Illinois data is not loaded.' : 'The course data is not loaded.';
  const counts = core.meta.counts;
  const parts = [`${counts.indexed} courses`];
  // A build with no such source says so, rather than "not loaded" (Georgia Tech has no grade history to load).
  parts.push(core.meta.sources?.grades === null ? 'no grade history' : core.grades ? `${counts.withGrades} with grade history` : 'grades not loaded');
  if (core.sections && core.meta.term) {
    // The other crawled terms load on demand, so their counts come from meta.
    const others = sectionTermsOf(core.meta).filter((t) => t.id !== core.meta?.term?.id && typeof t.courses === 'number');
    parts.push(
      [`${counts.withSections} with ${core.meta.term.label} sections`, ...others.map((t) => `${t.courses} with ${t.label} sections`)].join(', '),
    );
  } else {
    parts.push(core.meta.sources?.sections === null ? 'no class times yet' : 'sections not loaded');
  }
  if (!core.prereqs) parts.push('prerequisites not checked');
  return `${parts.join(', ')}.`;
}
