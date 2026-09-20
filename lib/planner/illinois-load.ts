import type { GradeRow } from './scheduler';
import type {
  CoverageReport,
  DifficultyBands,
  IllinoisCourse,
  PrereqSpec,
  RawIllinoisCourse,
  RawIllinoisProgram,
  RawSectionCourse,
  SectionSummary,
} from './illinois-data';

/**
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
 * Browser only. These are relative URLs, which have no meaning in a Cloudflare
 * Worker fetch, and there is no fs at runtime there either. Call from an effect
 * or an event handler, never during a server render: on the server every loader
 * resolves to its not-loaded value instead of throwing.
 */

export const ILLINOIS_BASE = '/illinois';

// ---------------------------------------------------------------------------
// The shapes on disk
// ---------------------------------------------------------------------------

export interface IllinoisSourceStamp {
  source: string;
  fetchedAt: string;
}

export interface IllinoisMeta {
  school: 'illinois';
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
  bands: DifficultyBands;
  /** Already written in the house voice by gradeFootnote. Render it verbatim. */
  gradeFootnote: string;
  coverage: CoverageReport;
  counts: {
    indexed: number;
    positioned: number;
    withPrereqSpec: number;
    withGrades: number;
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
  mapPosition?: { x: number; y: number };
}

export interface IllinoisIndexCourse extends IllinoisCourse {
  /** 100, 200, 300, 400. The catalog's own number, not a guess from the code. */
  level: number;
  /** Registrar difficulty, 0 to 100. Absent means no grade history for this course. */
  difficulty?: number;
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
}

export interface IllinoisCourseDetail {
  code: string;
  /** The catalog row, with the description and the prerequisite sentence. */
  course: RawIllinoisCourse | null;
  /** Null when the section crawl has no row for this course, not when it has none. */
  sections: RawSectionCourse | null;
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
export interface IllinoisCore {
  meta: IllinoisMeta | null;
  index: IllinoisIndexCourse[];
  byId: Map<string, IllinoisIndexCourse>;
  byCode: Map<string, IllinoisIndexCourse>;
  prereqs: Map<string, PrereqSpec> | null;
  grades: Map<string, IllinoisGradeSummary> | null;
  sections: Map<string, SectionSummary> | null;
  programs: IllinoisProgramSummary[] | null;
  /** Artifact names that were not there, for the header to name out loud. */
  missing: string[];
}

// ---------------------------------------------------------------------------
// Fetching, once
// ---------------------------------------------------------------------------

type Fetched<T> = { ok: true; value: T } | { ok: false; reason: 'missing' | 'error' | 'server' };

/**
 * Keyed by URL rather than by artifact, so a rebuild's new ?v= is a new entry
 * and the stale one is simply never asked for again.
 */
const cache = new Map<string, Promise<Fetched<unknown>>>();

const isBrowser = () => typeof window !== 'undefined' && typeof fetch === 'function';

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

function fetchJson<T>(url: string, init?: RequestInit): Promise<Fetched<T>> {
  if (!isBrowser()) return Promise.resolve({ ok: false, reason: 'server' });

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

/** Drops every cached response. For a dev rebuild, and for tests. */
export function resetIllinoisCache(): void {
  cache.clear();
  shardCache.clear();
  programCache.clear();
  metaPromise = null;
  indexPromise = null;
  corePromise = null;
}

// ---------------------------------------------------------------------------
// meta.json, and the version every other fetch carries
// ---------------------------------------------------------------------------

let metaPromise: Promise<IllinoisMeta | null> | null = null;

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
  if (metaPromise) return metaPromise;
  const started = fetchJson<IllinoisMeta>(`${ILLINOIS_BASE}/meta.json`, { cache: 'no-cache' }).then(
    (r) => {
      if (transient(r)) metaPromise = null;
      return r.ok ? r.value : null;
    },
  );
  metaPromise = started;
  return started;
}

/**
 * public/ is served without content hashes, so a rebuilt index.json would sit
 * behind whatever the CDN and the browser already cached. Stamping the build's
 * own timestamp on every URL means one rebuild re-fetches everything exactly
 * once. Without meta there is no version to stamp, and the caller has already
 * been told the data is not loaded.
 */
async function versioned(path: string): Promise<string> {
  const meta = await loadIllinoisMeta();
  const url = `${ILLINOIS_BASE}/${path}`;
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
    ...(row.mapPosition ? { mapPosition: row.mapPosition } : {}),
    detailLoaded: false,
  };
}

/** One versioned artifact, fetched through the shared per-URL cache. */
const artifact = async <T>(path: string): Promise<Fetched<T>> => fetchJson<T>(await versioned(path));

let indexPromise: Promise<Fetched<IllinoisIndexCourse[]>> | null = null;

function indexResult(): Promise<Fetched<IllinoisIndexCourse[]>> {
  if (indexPromise) return indexPromise;
  const started = artifact<IllinoisIndexRow[]>('index.json').then(
    (r): Fetched<IllinoisIndexCourse[]> => {
      if (transient(r)) indexPromise = null;
      return r.ok ? { ok: true, value: r.value.map(hydrateIndexRow) } : r;
    },
  );
  indexPromise = started;
  return started;
}

/**
 * Null, not [], when index.json is not there. An empty course list would render
 * as a university that offers nothing.
 */
export async function loadIllinoisIndex(): Promise<IllinoisIndexCourse[] | null> {
  const r = await indexResult();
  return r.ok ? r.value : null;
}

// ---------------------------------------------------------------------------
// The second wave
// ---------------------------------------------------------------------------

let corePromise: Promise<IllinoisCore> | null = null;

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
  if (corePromise) return corePromise;
  const started = (async (): Promise<IllinoisCore> => {
    const meta = await loadIllinoisMeta();
    const [index, prereqs, grades, sections, programs] = await Promise.all([
      indexResult(),
      artifact<Record<string, PrereqSpec>>('prereqs.json'),
      artifact<IllinoisGradeSummary[]>('grades.json'),
      artifact<IllinoisSectionsFile>('sections.json'),
      artifact<IllinoisProgramSummary[]>('programs.json'),
    ]);

    const results = [index, prereqs, grades, sections, programs];
    if (!meta || results.some(transient)) corePromise = null;

    const rows = index.ok ? index.value : [];
    const missing: string[] = [];
    if (!meta) missing.push('meta.json');
    if (!index.ok) missing.push('index.json');
    if (!prereqs.ok) missing.push('prereqs.json');
    if (!grades.ok) missing.push('grades.json');
    if (!sections.ok) missing.push('sections.json');
    if (!programs.ok) missing.push('programs.json');

    return {
      meta,
      index: rows,
      byId: new Map(rows.map((c) => [c.id, c])),
      byCode: new Map(rows.map((c) => [normCode(c.code), c])),
      prereqs: prereqs.ok ? new Map(Object.entries(prereqs.value)) : null,
      grades: grades.ok ? new Map(grades.value.map((row) => [normCode(row.code), row])) : null,
      /**
       * The term is stamped back onto every row here rather than stored once
       * per course. A whole SectionSummary is what buildingLine, partOfTermLine
       * and sectionSnapshot take, and handing out a near-miss would make every
       * call site patch it.
       */
      sections: sections.ok
        ? new Map(
            sections.value.courses.map((row) => [
              normCode(row.code),
              { ...row, termId: sections.value.termId, termLabel: sections.value.termLabel },
            ]),
          )
        : null,
      programs: programs.ok ? programs.value : null,
      missing,
    };
  })();
  corePromise = started;
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

const shardCache = new Map<string, Promise<Fetched<IllinoisSubjectShard>>>();

/**
 * The full detail for one subject: descriptions, prerequisite sentences, every
 * individual section with its building, and the per-instructor grade history.
 * Median 28 KB, largest 269 KB. Cached, so the second course a student opens in
 * the same subject costs nothing.
 */
export async function loadIllinoisSubjectShard(subject: string): Promise<IllinoisSubjectShard | null> {
  const key = subject.trim().toUpperCase();
  if (!SAFE_SUBJECT.test(key)) return null;
  const r = await memo(shardCache, key, () => artifact<IllinoisSubjectShard>(`course/${key}.json`));
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
  const shard = await loadIllinoisSubjectShard(subject);
  if (!shard) return null;
  return {
    code: wanted,
    course: shard.courses.find((c) => normCode(c.code) === wanted) ?? null,
    sections: shard.sections.find((s) => normCode(s.code) === wanted) ?? null,
    instructors: shard.instructors.find((g) => normCode(g.code) === wanted)?.instructors ?? null,
  };
}

const programCache = new Map<string, Promise<Fetched<RawIllinoisProgram>>>();

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
  const r = await memo(programCache, key, () => artifact<RawIllinoisProgram>(`program/${key}.json`));
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
 * One sentence for the header, naming what is loaded and what is not.
 *
 * It says "not loaded" rather than reporting zero, because the section crawl is
 * still running and a count of zero would read as a term with no classes in it.
 */
export function coverageLine(core: IllinoisCore): string {
  if (!core.meta || core.index.length === 0) return 'Illinois data is not loaded.';
  const counts = core.meta.counts;
  const parts = [`${counts.indexed} courses`];
  parts.push(core.grades ? `${counts.withGrades} with grade history` : 'grades not loaded');
  if (core.sections && core.meta.term) {
    parts.push(`${counts.withSections} with ${core.meta.term.label} sections`);
  } else {
    parts.push('sections not loaded');
  }
  if (!core.prereqs) parts.push('prerequisites not checked');
  return `${parts.join(', ')}.`;
}
