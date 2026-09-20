import type {
  Course,
  CourseSectionSnapshot,
  ProgramDefinition,
  ProgramRequirement,
  SectionStatus,
  SemesterSeason,
} from './types';
import type {
  GradeRow,
  ProgramRequirements,
  RequirementArea,
  RequirementGroup,
} from './scheduler';

/**
 * Real Illinois data, adapted into the planner's shapes.
 *
 * Source chain, four separate crawls because no single Illinois page carries
 * more than one of these:
 *
 *   catalog.illinois.edu/courses-of-instruction   titles, credits, prerequisite
 *                                                 sentences, gen-ed tags, cross-lists
 *   catalog.illinois.edu/undergraduate            degree requirement tables
 *   courses.illinois.edu/schedule                 buildings, days, times, parts of term
 *   Illinois DAIR grade distribution              per-course and per-instructor history
 *
 * Illinois is the school being finished end to end because it is the only one
 * where all four are obtainable. UGA publishes no grade distributions and no
 * public class schedule, so two of the four are impossible there.
 *
 * Everything in this file is a pure adapter. No fetch, no fs, no React, no
 * imports of runtime values from other modules. That is not tidiness: the build
 * step (scripts/illinois/build-index.mjs) and the check harness both import
 * these functions under plain node, and a single runtime import of a sibling
 * .ts file would break that, because node cannot resolve an extensionless
 * specifier and TypeScript will not let us write the extension without
 * allowImportingTsExtensions.
 *
 * The rule the whole file is written against: never state a fact about Illinois
 * that the data does not carry. Where the data is silent the product says so.
 * Several functions here exist only to make that silence explicit rather than
 * letting a zero or an empty string read as a measurement.
 */

// ---------------------------------------------------------------------------
// Types this module has to widen locally
// ---------------------------------------------------------------------------

/**
 * types.ts has not yet taken the three Illinois additions (a 'closed' section
 * status, Course.creditsMax, Course.offeringKnown), and another agent owns that
 * file. Declaring the widened shapes here keeps this module honest and type
 * safe today without a cast, and the moment types.ts lands those additions each
 * of these becomes structurally identical to the type it extends, so nothing
 * here has to change. Until then IllinoisCourse is deliberately NOT assignable
 * to Course, because a snapshot whose status is 'closed' genuinely is not a
 * valid Course today and silently casting it would hide that from the UI.
 */
export type IllinoisSectionStatus = SectionStatus | 'closed';

export interface IllinoisSectionSnapshot extends Omit<CourseSectionSnapshot, 'status'> {
  status: IllinoisSectionStatus;
}

export interface IllinoisCourse extends Omit<Course, 'section'> {
  /**
   * The high end of a variable credit course. Illinois has 1,829 undergraduate
   * courses whose catalog line is a range, and a planner that renders only the
   * low end quietly undercounts a term by up to four hours.
   */
  creditsMax?: number;
  /**
   * False when the catalog does not publish an offering term. Illinois never
   * does, and one crawled term is not evidence that a course skips spring, so
   * the offering warning has to stay quiet rather than invent a pattern.
   */
  offeringKnown?: boolean;
  section?: IllinoisSectionSnapshot;
}

export interface IllinoisProgramDefinition extends Omit<ProgramDefinition, 'dataStatus'> {
  dataStatus: ProgramDefinition['dataStatus'] | 'catalog';
}

// ---------------------------------------------------------------------------
// Raw shapes, matching what the three scrapers actually write today
// ---------------------------------------------------------------------------

export interface RawIllinoisCourse {
  code: string;
  subject: string;
  number: string;
  level: number;
  title: string;
  credits: number | null;
  creditsMax: number | null;
  description: string;
  prereqCodes: string[];
  prereqText: string;
  genEd: string[];
  sameAs: string[];
  noise: boolean;
  url: string;
}

export interface RawCatalogFile {
  school: string;
  source: string;
  fetchedAt: string;
  courses: RawIllinoisCourse[];
}

export interface RawProgramCourse {
  code: string;
  title: string;
  credits: number | null;
  or?: string[];
}

export interface RawProgramGroup {
  label: string;
  choose: number | null;
  /**
   * Where `choose` came from. 'prose' is a sentence the scraper read a
   * parenthesised digit out of, 'heading' is a "Select one of the following"
   * table heading. Null or absent means the count came from neither.
   */
  chooseFrom?: 'prose' | 'heading' | null;
  hours?: number | null;
  /** 'table' is the hours column, 'prose' is a sentence above the table. */
  hoursFrom?: 'table' | 'prose' | null;
  /** The scraper's own sum of this group's course rows, in credit hours. */
  summedCredits?: number;
  /**
   * The scraper's verdict on what the group means, from programs.mjs:
   *
   *   choose   the page states a count
   *   all      the rows fit inside the cap, so the page wants all of them
   *   menu     the rows carry MORE credit than the cap, so it is a list to
   *            pick from rather than a list to take
   *   unknown  there is no cap anywhere, so neither reading can be checked
   *
   * 'menu' is the one that matters here: the scraper has already measured that
   * taking every row would overshoot the hours the page publishes.
   */
  kind?: 'all' | 'choose' | 'menu' | 'unknown';
  courses: RawProgramCourse[];
  note: string;
}

export interface RawProgramArea {
  label: string;
  hours: number | null;
  /** 'table' is the table's own Total Hours row, 'prose' is a sentence. */
  hoursFrom?: 'table' | 'prose' | null;
  /**
   * How many COURSES the area's prose asks for, when it says so. The CS degree
   * writes "a minimum of (6) six additional technical electives" once for the
   * whole area, and that six belongs to the area, not to each of its lists.
   */
  chooseCourses?: number | null;
  groups: RawProgramGroup[];
}

export interface RawIllinoisProgram {
  id: string;
  college: string;
  name: string;
  degree: string;
  concentration: string | null;
  url: string;
  areas: RawProgramArea[];
  totalCredits: number | null;
  courseCount: number;
}

export interface RawProgramFile {
  school: string;
  source: string;
  fetchedAt: string;
  programs: RawIllinoisProgram[];
}

export interface RawSection {
  crn: string;
  type: string | null;
  section: string | null;
  start: string | null;
  end: string | null;
  days: string | null;
  room: string | null;
  building: string | null;
  instructors: string[];
  partOfTerm: string | null;
  dateRange: string | null;
  availability: string | null;
}

export interface RawSectionCourse {
  code: string;
  subject: string;
  number: string;
  sections: RawSection[];
}

export interface RawSectionFile {
  school: string;
  source: string;
  year: number;
  term: string;
  fetchedAt: string;
  courses: RawSectionCourse[];
}

export interface RawGradeFile {
  school: string;
  source: string;
  terms: string;
  count: number;
  courses: GradeRow[];
}

// ---------------------------------------------------------------------------
// Derived shapes this module owns
// ---------------------------------------------------------------------------

export interface CreditRange {
  /** What the planner counts by default: the low end, the only guaranteed number. */
  credits: number;
  min: number | null;
  max: number | null;
  variable: boolean;
  /** False for the 20 rows whose credit line the scraper could not read. */
  known: boolean;
}

export interface PrereqGroup {
  /** Course codes, satisfied by ANY one of them. */
  any: string[];
  /** "credit or concurrent registration in ...", so the same term is allowed. */
  concurrent: boolean;
  confidence: 'high' | 'low';
  shape: 'single' | 'or' | 'one-of' | 'bare-comma' | 'paren-sequence';
  /** The clause this group came from, verbatim, so an error can quote it. */
  source: string;
}

export interface PrereqSpec {
  /** ANDed together. */
  groups: PrereqGroup[];
  escape: 'consent' | 'standing' | 'either' | null;
  /** The catalog sentence, verbatim, for display. */
  text: string;
  parsed: boolean;
  confidence: 'high' | 'low' | 'none';
}

export interface CourseFacts {
  code: string;
  creditRange: CreditRange;
  prereq: PrereqSpec | null;
  genEd: string[];
  /** Full cross-listing class, excluding self. */
  equivalents: string[];
  /** "Credit is not given for both X and Y". */
  exclusions: string[];
  offeringKnown: false;
  catalogUrl: string;
  scheduleUrl: string;
  level: number;
  noise: boolean;
}

export interface DifficultyBands {
  typical: number;
  harder: number;
  hardest: number;
}

export type DifficultyLabel =
  | { kind: 'none' }
  | {
      kind: 'band';
      band: 'easier' | 'typical' | 'harder' | 'hardest';
      difficulty: number;
      gpa: number | null;
      aPct: number | null;
      withdrawPct: number | null;
      n: number;
      sections: number;
      thin: boolean;
    };

/**
 * A day pattern, and the time its sections meet at when they agree on one.
 *
 * The times live here rather than on the summary because sectionSnapshot has
 * only the summary to work from, and a meeting line without a time is useless.
 *
 * start and end are null unless a supermajority of this pattern's sections
 * share the same clock time. CS 225 runs ten Thursday lab sections at five
 * different times, and naming the most common of them would have been wrong for
 * eight of the ten.
 */
export interface DayPattern {
  pattern: string;
  count: number;
  start: string | null;
  end: string | null;
}

export interface SectionSummary {
  code: string;
  /** "fall-2026". */
  termId: string;
  /** "Fall 2026". */
  termLabel: string;
  total: number;
  located: number;
  buildings: Array<{ building: string; count: number }>;
  usual: { building: string; count: number; located: number } | null;
  partsOfTerm: Array<{ id: string; dateRange: string | null; count: number }>;
  dayPatterns: DayPattern[];
  earliest: string | null;
  latest: string | null;
  instructors: Array<{ name: string; sections: number }>;
  anyOpen: boolean;
  anyClosed: boolean;
  restrictions: string[];
  /** Sections whose location or day cell held several meetings concatenated. */
  multiMeeting: number;
  onlineOnly: boolean;
}

export interface CoverageReport {
  catalogCourses: number;
  undergraduateCourses: number;
  withParsedPrereq: number;
  withLowConfidencePrereq: number;
  withPrereqTextOnly: number;
  withGrades: number;
  withoutGrades: number;
  orphanGradeRows: number;
  withSections: number;
  sectionTerm: string | null;
  programs: number;
  programsWithCourses: number;
  variableCredit: number;
  unknownCredit: number;
  /** Footnote rows dropped from requirement groups; see normaliseProgramRows. */
  droppedProgramRows: number;
  /**
   * "Total Hours" rows dropped. They restate the table's own subtotal, and the
   * CS page's is "Total Hours of Curriculum to Graduate 128", which arrived
   * here as a 128-hour requirement nobody could name a course for.
   */
  droppedTotalRows: number;
  /** Requirement groups read as "take N hours or N courses from this list". */
  poolGroups: number;
  /** Degree totals too small to be a degree, so reported as unknown instead. */
  implausibleProgramTotals: number;
}

/**
 * One list inside an elective pool, kept separate from the pool itself.
 *
 * A pool is usually printed as several tables under one sentence, and the
 * sentence can single one of them out ("at least three from a single focus
 * area"). Flattening the tables into one array loses the only thing that makes
 * that sentence checkable.
 */
export interface PoolList {
  label: string;
  codes: string[];
}

/**
 * A rule inside a pool that the pool's own count does not express.
 *
 * Illinois writes these as their own sentences above their own tables: "At
 * least one (1) of the CS courses used for technical electives must be chosen
 * from the list below", "At least three (3) ... from a single focus area". They
 * are not extra requirements on top of the pool, they are conditions on how the
 * pool's own six courses may be chosen, which is why they live here and not as
 * sibling requirements.
 */
export interface PoolConstraint {
  /** The catalog's own sentence. Quoted verbatim wherever this is shown. */
  text: string;
  /** How many of the pool's courses the sentence asks for. */
  n: number;
  /** The lists it points at, in the order the page prints them. */
  lists: PoolList[];
  /** True when all n have to come from ONE of `lists` rather than spread across them. */
  single: boolean;
}

export type RequirementRule =
  | { kind: 'all'; choices: CourseChoice[] }
  | { kind: 'choose'; n: number; choices: CourseChoice[] }
  /**
   * "Take N hours, or N courses, from this list."
   *
   * The commonest shape in an American degree and the one this type used to
   * have no room for: 'hours' carried a number with no courses, 'choose'
   * carried courses with no hours, and an elective pool is both. Either number
   * may be null, because a page can state hours without a count or a count
   * without hours, and inventing the missing one is how a plan ends up claiming
   * six three-hour courses for a rule that never said three.
   */
  | {
      kind: 'pool';
      hours: number | null;
      n: number | null;
      choices: CourseChoice[];
      /** The tables the choices came from, so a constraint can name one. */
      lists: PoolList[];
      constraints: PoolConstraint[];
      /**
       * 'group' when the numbers are on this group's own row or in its own
       * sentence, 'area' when they were stated once for the whole area and this
       * pool is every list under that sentence merged into one.
       */
      from: 'group' | 'area';
      label: string;
    }
  | { kind: 'hours'; hours: number; genEd: string[] | null; label: string }
  | { kind: 'unparsed'; text: string };

export interface CourseChoice {
  codes: string[];
  title: string;
  credits: number | null;
  creditsMax: number | null;
}

export interface RequirementBlock {
  /** `${programId}::${areaIndex}::${groupIndex}` */
  id: string;
  /** `${programId}::${areaIndex}` */
  areaId: string;
  areaLabel: string;
  label: string;
  hours: number | null;
  hoursMax: number | null;
  rule: RequirementRule;
  /** The catalog's own comment, verbatim. */
  note: string;
  url: string;
}

export interface IllinoisData {
  courses: IllinoisCourse[];
  byId: Map<string, IllinoisCourse>;
  byCode: Map<string, IllinoisCourse>;
  facts: Map<string, CourseFacts>;
  equivalents: Map<string, string[]>;
  grades: Map<string, GradeRow>;
  gradeProvenance: { source: string; terms: string; count: number } | null;
  bands: DifficultyBands;
  sections: Map<string, SectionSummary>;
  sectionTerm: { id: string; label: string; year: number; term: string; fetchedAt: string } | null;
  programs: ProgramRequirements[];
  programDefs: IllinoisProgramDefinition[];
  /** program id -> blocks */
  requirementBlocks: Map<string, RequirementBlock[]>;
  catalogFetchedAt: string | null;
  coverage: CoverageReport;
}

// ---------------------------------------------------------------------------
// Constants and small shared helpers
// ---------------------------------------------------------------------------

export const ILLINOIS_GRAD_LEVEL = 500;

/**
 * The "terms offered" page for a course, which is the only schedule link we can
 * honestly hand a student. A term-specific link would claim the course runs in
 * that term, and one crawled term is not enough to claim that.
 */
export const ILLINOIS_SCHEDULE_BASE = 'https://courses.illinois.edu/schedule/terms';

/**
 * Identical to the slug in uga-data.ts on purpose. The two schools must produce
 * the same id for the same shape of code or a plan saved under one school reads
 * as corrupt under the other. This wants to move to lib/planner/ids.ts and be
 * imported by both, which needs an edit to uga-data.ts that this module does
 * not own.
 */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Codes are compared after collapsing internal whitespace, never raw. */
const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Scan text for course codes rather than trusting the scraper's link-derived
 * list. Unlinked mentions are real ("ECE313, IE300, or STAT400" in ECE 484,
 * "CS101" in IS 517) and the caller intersects the result with the catalog's
 * own code set, which is what makes scanning safe: a retired code the sentence
 * still names, like MATH 347 in CS 225's prerequisite, is dropped.
 */
const CODE_RE = /\b([A-Z]{2,4})\s?(\d{3})\b/g;

function codesIn(text: string, known: Set<string>, selfCode?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // matchAll clones the regex, so the module-level lastIndex is never mutated.
  for (const m of text.matchAll(CODE_RE)) {
    const code = `${m[1]} ${m[2]}`;
    if (!known.has(code)) continue;
    if (selfCode && code === selfCode) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Credits
// ---------------------------------------------------------------------------

export function creditRange(raw: Pick<RawIllinoisCourse, 'credits' | 'creditsMax'>): CreditRange {
  const min = raw.credits;
  const max = raw.creditsMax ?? raw.credits;
  if (min === null || max === null) {
    // Twenty courses land here, ME 340 among them because it is really 3.5 and
    // the producer's regex only reads whole numbers. Zero is the only value
    // that cannot overstate what a student has earned, and unknownCredit in the
    // coverage report is what stops the zero from reading as a measurement.
    return { credits: 0, min: null, max: null, variable: false, known: false };
  }
  return { credits: min, min, max, variable: max > min, known: true };
}

export function creditLabel(r: CreditRange): string {
  if (!r.known) return 'Credits not listed';
  if (r.variable) return `${r.min} to ${r.max} credits`;
  if (r.min === 0) return '0 credits';
  return `${r.min} credit${r.min === 1 ? '' : 's'}`;
}

/**
 * A term total, kept as a range whenever any course in it is variable.
 *
 * Collapsing a term that holds AAS 199 (1 to 5 hours) to a single number is
 * wrong in one direction or the other no matter which end you pick, and the
 * student is the one who finds out at registration. A pinned value, clamped to
 * the catalog's own range, is the only thing that legitimately narrows it.
 */
export function termCreditRange(
  courses: ReadonlyArray<Pick<Course, 'id' | 'code'>>,
  facts: Map<string, CourseFacts>,
  pinned?: Map<string, number>,
): { min: number; max: number; variable: boolean; unknown: number } {
  let min = 0;
  let max = 0;
  let unknown = 0;
  let variable = false;

  for (const course of courses) {
    const range = facts.get(normCode(course.code))?.creditRange;
    if (!range || !range.known || range.min === null || range.max === null) {
      unknown += 1;
      continue;
    }
    const pin = pinned?.get(course.id);
    if (pin !== undefined) {
      const clamped = Math.min(range.max, Math.max(range.min, pin));
      min += clamped;
      max += clamped;
      continue;
    }
    min += range.min;
    max += range.max;
    if (range.variable) variable = true;
  }

  return { min, max, variable, unknown };
}

// ---------------------------------------------------------------------------
// 2. Cross-listings and exclusions
// ---------------------------------------------------------------------------

/**
 * Cross-listing classes, by union-find over every (code, sameAs) pair.
 *
 * The pairs are one-way in 330 cases, so reading sameAs directly would make
 * AIS 295 equivalent to AAS 215 but not the reverse. Transitive closure is also
 * required: AIS 295 ~ AAS 215 and AAS 215 ~ AFRO 215 is one class of three.
 *
 * This is used for prerequisite satisfaction, requirement satisfaction, and a
 * "same course as" line on the card. It is deliberately NOT used to dedupe the
 * catalog: a student searching LLS has to find LLS 200, and the two rows carry
 * different descriptions in the file.
 */
export function buildEquivalents(rows: RawIllinoisCourse[]): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = a;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    // Path compression, so a long cross-listing chain does not turn lookups
    // into a walk on every prerequisite check.
    let cur = a;
    while (parent.get(cur) !== undefined && parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const known = new Set(rows.map((r) => normCode(r.code)));
  for (const r of rows) {
    const self = normCode(r.code);
    if (!parent.has(self)) parent.set(self, self);
    for (const other of r.sameAs ?? []) {
      const o = normCode(other);
      // A sameAs pointing at a code the catalog no longer carries is not an
      // equivalence anyone can act on, so it is dropped rather than stored.
      if (!known.has(o)) continue;
      union(self, o);
    }
  }

  const classes = new Map<string, string[]>();
  for (const code of parent.keys()) {
    const root = find(code);
    const members = classes.get(root);
    if (members) members.push(code);
    else classes.set(root, [code]);
  }

  const out = new Map<string, string[]>();
  for (const members of classes.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    for (const code of sorted) out.set(code, sorted.filter((m) => m !== code));
  }
  return out;
}

/**
 * "Credit is not given toward graduation for: CS 277 if credit for CS 225 has
 * been earned." 473 descriptions carry a clause like this and the scraper
 * leaves it in place, so the planner can warn for free that two courses in a
 * plan will not both count.
 */
export function exclusionsIn(description: string, selfCode: string, known: Set<string>): string[] {
  // Built fresh per call. A shared global regex carries lastIndex between
  // calls and would skip the clause on every other course.
  const EXCLUSION = /Credit is not given (?:toward graduation )?for(?: both)?:?\s*([^.]+)\./gi;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of description.matchAll(EXCLUSION)) {
    for (const code of codesIn(m[1] ?? '', known, selfCode)) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Prerequisites
// ---------------------------------------------------------------------------

/**
 * prereqCodes alone is not usable, which is why this parser exists.
 *
 * Measured against the real file: 24 courses list themselves, because the
 * sentence opens "Prior to enrollment in ACCY 201". 76 courses' only codes come
 * from a "strongly recommended" sentence, so ANTH 352 has no hard prerequisite
 * at all. 50 more mix real prerequisites with recommended ones. And a flat list
 * cannot tell "One of MATH 220, MATH 221, MATH 234", which is one requirement,
 * from "PHYS 213, MATH 285, and TAM 335", which is three.
 *
 * So the sentence is parsed and prereqCodes is used only as a cross-check.
 */

const ONE_OF_SPLIT =
  /(?:\band\s+)?\b(?:any one of the following|one of the following|at least one of|any one of|any of|one of|either)\b\s*:?\s*/i;
const ADVISORY =
  /\b(recommend\w*|encouraged|helpful|preferred|desirable|suggested|may be taken|should also enroll|is useful|not required)\b/i;
/**
 * "students should" is deliberately absent. IS 557's sentence opens "Students
 * should have demonstrated ability, and must have taken one of the following
 * courses, IS 577 ...", and treating it as a restriction loses a real
 * requirement.
 */
const RESTRICTION =
  /^(?:restricted to|open to|intended for|enrollment in|for [a-z ]*students only|must be|priority|approved for)/i;
const CONCURRENT =
  /\b(?:concurrent(?:ly)?\s+(?:registration|enrollment|enrolled)|credit or concurrent)\b/i;
const ESC_CONSENT = /\bconsent of\b|\bpermission of\b|\bapproval of\b/i;
const ESC_STANDING =
  /\b(?:freshman|sophomore|junior|senior|graduate|undergraduate)\s+(?:standing|status)\b/i;
const ABBREV = /(?:\be\.g|\bi\.e|\betc|\bvs|\bDr|\bMr|\bMs|\bJr|\bSr|\bPh\.D|\bU\.S|\bNo)$/i;

/**
 * Stripping the anchor tags left a space before every mark, so the raw text
 * reads "MATH 220 , MATH 221 ." and a naive comma split produces empty items.
 */
function cleanPrereqText(raw: string): string {
  return raw
    .replace(/\s+([,;.:])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    // 97 sentences end in this dangling fragment, left behind when the scraper
    // cut the gen-ed block off the end of the paragraph.
    .replace(/\s*\bThis course\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split on a period followed by whitespace, except after an abbreviation.
 *
 * Written as a scan rather than a lookbehind regex so the file does not depend
 * on a regex feature newer than the compile target, and so "e.g. CS 446" stays
 * one sentence instead of becoming two with the codes orphaned in the second.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '.') continue;
    let j = i + 1;
    while (j < text.length && text[j] === ' ') j += 1;
    if (j === i + 1) continue; // no whitespace after the period, so not an end
    const piece = text.slice(start, i + 1);
    if (ABBREV.test(piece.slice(0, -1))) continue;
    if (piece.trim()) out.push(piece.trim());
    start = j;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Every parenthetical in a segment, for the sequence-choice check in step 6. */
function parentheticals(seg: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < seg.length; i += 1) {
    if (seg[i] === '(') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (seg[i] === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) out.push(seg.slice(start, i));
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

export function parsePrerequisites(
  prereqText: string,
  selfCode: string,
  known: Set<string>,
): PrereqSpec {
  const text = cleanPrereqText(prereqText ?? '');
  const self = normCode(selfCode);
  const groups: PrereqGroup[] = [];
  let escape: PrereqSpec['escape'] = null;

  const noteEscape = (kind: 'consent' | 'standing') => {
    // The escape belongs to the spec, not to a group. ABE 426's "... or
    // graduate standing" lets a student past the whole list, and stamping every
    // group escapable individually was the bug in the first pass.
    if (escape === null || escape === kind) escape = kind;
    else escape = 'either';
  };

  for (const sentence of splitSentences(text)) {
    for (const rawSeg of sentence.split(/;\s*/)) {
      const seg = rawSeg.trim();
      if (!seg) continue;

      // A semicolon at Illinois is always a top-level AND, in all 510 sentences
      // that use one: "CEE 350 or NRES 401; CEE 380 or NRES 201."
      const segCodes = codesIn(seg, known, self);

      if (ESC_CONSENT.test(seg)) noteEscape('consent');
      else if (ESC_STANDING.test(seg) && /\bor\b/i.test(seg)) noteEscape('standing');

      if (segCodes.length === 0) continue;
      // This is what removes the 76 advisory-only courses and the recommended
      // half of the 50 mixed ones.
      if (ADVISORY.test(seg) || RESTRICTION.test(seg)) continue;

      const concurrent = CONCURRENT.test(seg);
      const before = groups.length;

      const cut = seg.search(ONE_OF_SPLIT);
      const head = cut >= 0 ? seg.slice(0, cut) : seg;
      const tail = cut >= 0 ? seg.slice(cut).replace(ONE_OF_SPLIT, '') : '';

      // The head is a plain list; commas and "and" separate requirements while
      // "or" separates alternatives inside one of them.
      for (const item of head.split(/,\s*(?:and\s+)?|\s+and\s+/i)) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        const itemCodes = codesIn(trimmed, known, self);
        if (itemCodes.length === 0) {
          if (/^or\b/i.test(trimmed)) {
            if (ESC_CONSENT.test(trimmed)) noteEscape('consent');
            else if (ESC_STANDING.test(trimmed)) noteEscape('standing');
          }
          continue;
        }
        const previous = groups[groups.length - 1];
        if (/^or\b/i.test(trimmed) && previous && groups.length > before) {
          // ", or MATH 415" continues the alternatives above it rather than
          // opening a second requirement.
          for (const c of itemCodes) if (!previous.any.includes(c)) previous.any.push(c);
          previous.shape = 'or';
          previous.source = `${previous.source}, ${trimmed}`;
          continue;
        }
        groups.push({
          any: itemCodes,
          concurrent,
          confidence: 'high',
          shape: itemCodes.length > 1 ? 'or' : 'single',
          source: trimmed,
        });
      }

      if (tail) {
        // Splitting at the marker is what makes AE 321 right: "MATH 285 and one
        // of TAM 210 or TAM 211" is [MATH 285] AND [TAM 210|TAM 211]. Testing
        // "one of" against the whole segment merged MATH 285 into the
        // alternatives.
        const tailCodes = codesIn(tail, known, self);
        if (tailCodes.length > 0) {
          groups.push({
            any: tailCodes,
            concurrent,
            confidence: 'high',
            shape: 'one-of',
            source: tail.trim(),
          });
        }
      }

      const produced = groups.slice(before);
      if (produced.length === 0) continue;

      // Step 6, the two shapes we can read but cannot be sure of.
      const bareComma =
        produced.length > 1 && !/\band\b/i.test(seg) && !/\bor\b/i.test(seg);
      const parenSequence = parentheticals(seg).some(
        (p) => codesIn(p, known).length >= 3 && /\bor\b/i.test(p),
      );
      // ABE 526's "control (e.g. SE 422)" names an example, not a requirement.
      const example = /\be\.g\b/i.test(seg);

      if (bareComma || parenSequence || example) {
        for (const g of produced) {
          g.confidence = 'low';
          if (bareComma) g.shape = 'bare-comma';
          else if (parenSequence) g.shape = 'paren-sequence';
        }
      }
    }
  }

  // Identical groups with the same concurrency flag are a repeat of the same
  // requirement, not two of them. ACCY 201's pair survives this because one is
  // concurrent and the other is not, which is exactly the distinction that
  // makes it two courses.
  const deduped: PrereqGroup[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    const key = `${g.any.join('|')}::${g.concurrent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(g);
  }

  const parsed = deduped.length > 0;
  return {
    groups: deduped,
    escape,
    text,
    parsed,
    confidence: !parsed ? 'none' : deduped.some((g) => g.confidence === 'low') ? 'low' : 'high',
  };
}

/**
 * Which prerequisite groups a plan does not satisfy.
 *
 * This is a maximum bipartite matching, not a per-group `.some()`. ACCY 201
 * parses to [ECON 102|ECON 103] AND [ECON 102|ECON 103] with the second
 * concurrent, meaning both courses with one of them possibly in the same term.
 * A per-group check calls that satisfied by ECON 102 alone and tells a student
 * they are ready for a course they are not. With at most 11 alternatives per
 * group and 8 groups, augmenting paths are instant.
 */
export function missingPrerequisiteGroups(
  spec: PrereqSpec | null,
  earlier: Set<string>,
  sameTerm: Set<string>,
  equivalents: Map<string, string[]>,
): { missing: PrereqGroup[]; uncertain: PrereqGroup[] } {
  if (!spec || spec.groups.length === 0) return { missing: [], uncertain: [] };

  const earlierN = new Set([...earlier].map(normCode));
  const sameTermN = new Set([...sameTerm].map(normCode));

  // Candidate courses per group, expanded through cross-listings so LLS 200
  // satisfies a requirement the catalog wrote as AAS 200.
  const candidates: string[][] = spec.groups.map((group) => {
    const pool = new Set<string>();
    for (const code of group.any) {
      const c = normCode(code);
      for (const alias of [c, ...(equivalents.get(c) ?? [])]) {
        if (earlierN.has(alias)) pool.add(alias);
        else if (group.concurrent && sameTermN.has(alias)) pool.add(alias);
      }
    }
    return [...pool];
  });

  const matchedBy = new Map<string, number>();
  const tryAssign = (groupIndex: number, visited: Set<string>): boolean => {
    for (const code of candidates[groupIndex]) {
      if (visited.has(code)) continue;
      visited.add(code);
      const holder = matchedBy.get(code);
      if (holder === undefined || tryAssign(holder, visited)) {
        matchedBy.set(code, groupIndex);
        return true;
      }
    }
    return false;
  };

  const satisfied = new Set<number>();
  for (let i = 0; i < spec.groups.length; i += 1) {
    if (tryAssign(i, new Set<string>())) satisfied.add(i);
  }

  const missing: PrereqGroup[] = [];
  const uncertain: PrereqGroup[] = [];
  spec.groups.forEach((group, i) => {
    if (satisfied.has(i)) return;
    // A low-confidence group is a reading we could not verify, so it warns
    // rather than blocks. Blocking on a guess is worse than not blocking.
    if (group.confidence === 'low') uncertain.push(group);
    else missing.push(group);
  });

  return { missing, uncertain };
}

// ---------------------------------------------------------------------------
// 2. Catalog course -> Course
// ---------------------------------------------------------------------------

export function adaptIllinoisCourse(
  raw: RawIllinoisCourse,
  ctx: { facts: CourseFacts; prereqIds: string[] },
): IllinoisCourse {
  const range = ctx.facts.creditRange;
  return {
    id: slug(raw.code),
    code: raw.code,
    title: raw.title,
    credits: range.credits,
    creditsMax: range.max ?? undefined,
    description: raw.description ?? '',
    // types.ts already blesses the department as the cluster, and Illinois has
    // roughly 200 subject prefixes, so inventing buckets would be fiction.
    cluster: raw.subject,
    requirementIds: [],
    prerequisites: ctx.prereqIds,
    /**
     * Illinois publishes no offering term anywhere in the catalog, and the only
     * section evidence is a single crawled term. Writing ['Fall'] would assert
     * that a course skips spring, which is a fact we do not have. The permissive
     * value paired with offeringKnown false is the honest combination, and
     * rules.ts is meant to read the flag and stay quiet.
     */
    offeredIn: ['Fall', 'Spring'] as SemesterSeason[],
    offeringKnown: false,
    // Patched to 'Online' in buildIllinoisData for courses whose every section
    // is online. Never 'Hybrid': a course with both online and in-person
    // sections is not a hybrid course and the data cannot tell the two apart.
    format: 'In person',
    // Catalog-published gen-ed strings, 15 distinct values over 935 courses.
    // Not labels this project invented.
    tags: raw.genEd ?? [],
  };
}

export function adaptIllinoisCatalog(
  file: RawCatalogFile,
  opts?: { includeGraduate?: boolean; includeNoise?: boolean },
): { courses: IllinoisCourse[]; facts: Map<string, CourseFacts>; equivalents: Map<string, string[]> } {
  const rows = file.courses ?? [];
  // The code set is the whole file, including graduate and independent-study
  // rows, because a prerequisite or a cross-listing can legitimately point at a
  // course the planner does not show.
  const known = new Set(rows.map((r) => normCode(r.code)));
  const equivalents = buildEquivalents(rows);

  const facts = new Map<string, CourseFacts>();
  const courses: IllinoisCourse[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    if (!raw?.code) continue;
    if (!opts?.includeGraduate && raw.level >= ILLINOIS_GRAD_LEVEL) continue;
    if (!opts?.includeNoise && raw.noise) continue;

    const code = normCode(raw.code);
    const id = slug(raw.code);
    if (seen.has(id)) continue;
    seen.add(id);

    const prereq = raw.prereqText ? parsePrerequisites(raw.prereqText, code, known) : null;
    const fact: CourseFacts = {
      code,
      creditRange: creditRange(raw),
      prereq,
      genEd: raw.genEd ?? [],
      equivalents: equivalents.get(code) ?? [],
      exclusions: exclusionsIn(raw.description ?? '', code, known),
      offeringKnown: false,
      catalogUrl: raw.url,
      scheduleUrl: `${ILLINOIS_SCHEDULE_BASE}/${raw.subject}/${raw.number}`,
      level: raw.level,
      noise: raw.noise,
    };
    facts.set(code, fact);

    /**
     * Only unambiguous groups become Course.prerequisites, because rules.ts
     * reads that list as a conjunction of hard requirements. A single course, no
     * concurrency, high confidence: 3,764 of the parsed groups qualify, so most
     * courses keep a real check here. The alternatives are checked by
     * missingPrerequisiteGroups instead, where the OR is preserved.
     */
    const prereqIds = (prereq?.groups ?? [])
      .filter((g) => g.any.length === 1 && !g.concurrent && g.confidence === 'high')
      .map((g) => slug(g.any[0]));

    courses.push(adaptIllinoisCourse(raw, { facts: fact, prereqIds }));
  }

  return { courses, facts, equivalents };
}

// ---------------------------------------------------------------------------
// 5. Grades
// ---------------------------------------------------------------------------

/**
 * Bands read off the data rather than hardcoded.
 *
 * Illinois difficulty is not distributed like the other tenants: min 0, median
 * 16, p75 26, max 80, and only 11 of 2,968 courses reach 65. The 65 threshold
 * that works for Mizzou labels nothing at all here. Recomputing on every load
 * means a future import cannot silently break the labels.
 */
export function computeDifficultyBands(rows: GradeRow[]): DifficultyBands {
  const d = rows
    .map((r) => r.difficulty)
    .filter((x): x is number => x !== null && x !== undefined)
    .sort((a, b) => a - b);
  if (d.length === 0) return { typical: 0, harder: 0, hardest: 0 };
  const q = (p: number) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
  return { typical: q(0.25), harder: q(0.75), hardest: q(0.9) };
}

/** A row's n below this is too small to compare against a full course history. */
export const THIN_SAMPLE = 50;

export function difficultyLabel(row: GradeRow | undefined, bands: DifficultyBands): DifficultyLabel {
  if (!row || row.difficulty === null || row.difficulty === undefined) return { kind: 'none' };
  const difficulty = row.difficulty;
  const thin = row.n < THIN_SAMPLE;

  let band: 'easier' | 'typical' | 'harder' | 'hardest';
  if (difficulty <= bands.typical) band = 'easier';
  else if (difficulty < bands.harder) band = 'typical';
  else if (difficulty < bands.hardest) band = 'harder';
  else band = 'hardest';

  // 836 rows are built on fewer than 50 students. Calling one of those the
  // hardest course in a major is a claim the sample cannot carry.
  if (thin && (band === 'harder' || band === 'hardest')) band = 'typical';

  return {
    kind: 'band',
    band,
    difficulty,
    gpa: row.gpa,
    aPct: row.aPct,
    withdrawPct: row.withdrawPct,
    n: row.n,
    sections: row.sections,
    thin,
  };
}

/**
 * Instructors, tagged rather than ranked.
 *
 * 4,146 of the 5,625 instructor rows cover fewer than three sections and 2,702
 * cover exactly one. The thin ones are still shown, because hiding them would
 * make the list look more complete than it is, but they carry their own count
 * so nobody reads one section as a pattern.
 */
export function visibleInstructors(
  row: GradeRow,
  minSections = 3,
): Array<GradeRow['instructors'][number] & { thin: boolean }> {
  const tagged = (row.instructors ?? []).map((i) => ({ ...i, thin: i.sections < minSections }));
  return tagged.sort((a, b) => {
    if (a.thin !== b.thin) return a.thin ? 1 : -1;
    return b.sections - a.sections;
  });
}

/**
 * One line under every grade chip. The word "history" is load-bearing: this
 * data says what happened, never what will happen.
 */
export function gradeFootnote(p: IllinoisData['gradeProvenance']): string {
  if (!p) return 'No grade data loaded.';
  return `${p.source}. ${p.terms}. History, not a prediction.`;
}

// ---------------------------------------------------------------------------
// 6. Sections
// ---------------------------------------------------------------------------

/** A location cell that names no building. Counting these as rooms invents one. */
const NOT_A_BUILDING = /^(?:location pending|arr|arranged|n\.?a\.?|tbd|online|to be announced)$/i;
/**
 * "Digital Computer Laboratory 106B8 Engineering Hall" is two meetings whose
 * cells were concatenated by the scraper. Printing that string would show a
 * student a building that does not exist.
 */
const MULTI_MEETING = /\s\d[\dA-Za-z-]*\s/;
/** A single clean run of meeting days. "TR R" and "F MW" are concatenations. */
const CLEAN_DAYS = /^[MTWRF]+$/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(part: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(part.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

/** "08/24/26-12/09/26" -> "Aug 24 to Dec 9", or null when it is not a range. */
export function prettyDateRange(range: string | null): string | null {
  if (!range) return null;
  const parts = range.split('-');
  if (parts.length !== 2) return null;
  const a = prettyDate(parts[0]);
  const b = prettyDate(parts[1]);
  return a && b ? `${a} to ${b}` : null;
}

/**
 * The date cell also carries the section's restrictions, which is where the
 * "Restricted to Accountancy majors" text lives. Left in place it would turn
 * every date range into a distinct string and the part-of-term grouping would
 * report one part per section.
 */
function splitDateCell(cell: string | null): { range: string | null; restriction: string | null } {
  if (!cell) return { range: null, restriction: null };
  const idx = cell.search(/\s*Restriction\(s\):/);
  if (idx < 0) return { range: cell.trim() || null, restriction: null };
  const range = cell.slice(0, idx).trim();
  const restriction = cell
    .slice(idx)
    .replace(/^\s*Restriction\(s\):\s*/, '')
    .replace(/\s*\|\s*$/, '')
    .trim();
  return { range: range || null, restriction: restriction || null };
}

function minutesOfDay(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null; // "ARRANGED" and anything else is not a time
  let hour = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) hour += 12;
  return hour * 60 + Number(m[2]);
}

/** The share of sections a claim has to cover before the module will make it. */
const SUPERMAJORITY = 0.8;

/**
 * The most common value, but only when it speaks for nearly all of them.
 *
 * Returning the plain mode was the bug this guard replaces: CS 225's ten
 * Thursday sections run at 9, 11, 1, 3 and 5, and the mode covered two of them.
 */
function dominantValue(values: Array<string | null>, total: number): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  if (best === null || total === 0) return null;
  return bestCount / total >= SUPERMAJORITY ? best : null;
}

export function summariseSections(
  course: RawSectionCourse,
  term: { id: string; label: string },
): SectionSummary {
  const sections = course.sections ?? [];
  const buildingCounts = new Map<string, number>();
  const partCounts = new Map<string, { id: string; dateRange: string | null; count: number }>();
  const patternRows = new Map<string, RawSection[]>();
  const instructorCounts = new Map<string, number>();
  const restrictions: string[] = [];
  const restrictionSeen = new Set<string>();

  let located = 0;
  let multiMeeting = 0;
  let anyOpen = false;
  let anyClosed = false;
  let onlineSections = 0;
  let earliestMin: number | null = null;
  let latestMin: number | null = null;
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const s of sections) {
    const building = (s.building ?? '').trim();
    const days = (s.days ?? '').trim();
    const mangledBuilding = building.length > 0 && MULTI_MEETING.test(building);
    const mangledDays = days.length > 0 && days !== 'n.a.' && !CLEAN_DAYS.test(days);
    if (mangledBuilding || mangledDays) multiMeeting += 1;

    if (building && !NOT_A_BUILDING.test(building) && !mangledBuilding) {
      located += 1;
      buildingCounts.set(building, (buildingCounts.get(building) ?? 0) + 1);
    }

    if (days && days !== 'n.a.' && !mangledDays) {
      const rows = patternRows.get(days);
      if (rows) rows.push(s);
      else patternRows.set(days, [s]);
    }

    const { range, restriction } = splitDateCell(s.dateRange);
    const partId = s.partOfTerm ?? 'nonstandard';
    const key = `${partId}::${range ?? ''}`;
    const part = partCounts.get(key);
    if (part) part.count += 1;
    else partCounts.set(key, { id: partId, dateRange: range, count: 1 });

    if (restriction && !restrictionSeen.has(restriction)) {
      restrictionSeen.add(restriction);
      restrictions.push(restriction);
    }

    for (const name of s.instructors ?? []) {
      const n = name.trim();
      if (!n) continue;
      instructorCounts.set(n, (instructorCounts.get(n) ?? 0) + 1);
    }

    const availability = s.availability ?? '';
    if (/^(?:CrossList)?Open\b/i.test(availability)) anyOpen = true;
    else if (/^Closed\b/i.test(availability)) anyClosed = true;

    if (/^Online/i.test(s.type ?? '')) onlineSections += 1;

    const startMin = minutesOfDay(s.start);
    if (startMin !== null && (earliestMin === null || startMin < earliestMin)) {
      earliestMin = startMin;
      earliest = (s.start ?? '').trim();
    }
    const endMin = minutesOfDay(s.end);
    if (endMin !== null && (latestMin === null || endMin > latestMin)) {
      latestMin = endMin;
      latest = (s.end ?? '').trim();
    }
  }

  const buildings = [...buildingCounts.entries()]
    .map(([building, count]) => ({ building, count }))
    .sort((a, b) => b.count - a.count || a.building.localeCompare(b.building));

  /**
   * "Usually in Siebel Center" is only true above a real threshold. At ACCY
   * 201's 0.59 share the sentence would send a student to the wrong building
   * for nearly half its sections, so it takes at least three located sections
   * and an 80 percent share before the claim is made at all.
   */
  const top = buildings[0];
  const usual =
    top && located >= 3 && top.count / located >= SUPERMAJORITY
      ? { building: top.building, count: top.count, located }
      : null;

  const dayPatterns: DayPattern[] = [...patternRows.entries()]
    .map(([pattern, rows]) => ({
      pattern,
      count: rows.length,
      start: dominantValue(rows.map((r) => r.start), rows.length),
      end: dominantValue(rows.map((r) => r.end), rows.length),
    }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));

  return {
    code: course.code,
    termId: term.id,
    termLabel: term.label,
    total: sections.length,
    located,
    buildings,
    usual,
    partsOfTerm: [...partCounts.values()].sort((a, b) => b.count - a.count),
    dayPatterns,
    earliest,
    latest,
    instructors: [...instructorCounts.entries()]
      .map(([name, count]) => ({ name, sections: count }))
      .sort((a, b) => b.sections - a.sections || a.name.localeCompare(b.name)),
    anyOpen,
    anyClosed,
    restrictions,
    multiMeeting,
    onlineOnly: sections.length > 0 && onlineSections === sections.length,
  };
}

export function buildingLine(summary: SectionSummary): string {
  if (summary.onlineOnly) return 'Taught online. No room listed.';
  if (summary.usual) {
    return `Usually in ${summary.usual.building} (${summary.usual.count} of ${summary.usual.located} sections).`;
  }
  if (summary.located === 0) return 'No room listed for this course.';
  const top = summary.buildings.slice(0, 3).map((b) => b.building);
  const rest = summary.buildings.length - top.length;
  return rest > 0
    ? `Spread across ${top.join(', ')} and ${rest} more.`
    : `Spread across ${top.join(', ')}.`;
}

/**
 * Parts of term, named individually and never collapsed.
 *
 * Illinois runs several parts of term inside one semester and the drop, refund,
 * credit/no-credit and grade-replacement deadlines differ for each. This
 * function prints the section's own date range and nothing else. It has no
 * deadline data, so it states none: asserting one date for a course that runs
 * in two parts is the documented failure this rule exists to prevent.
 */
export function partOfTermLine(summary: SectionSummary): string {
  const parts = summary.partsOfTerm;
  if (parts.length === 0) return 'No dates listed for this course.';

  if (parts.length === 1) {
    const only = parts[0];
    const range = prettyDateRange(only.dateRange);
    if (only.id === 'nonstandard') {
      return range
        ? `One section runs ${range}, outside the standard parts of term.`
        : 'This course runs outside the standard parts of term. No dates listed.';
    }
    return range ? `Part of term ${only.id}. Runs ${range}.` : `Part of term ${only.id}.`;
  }

  const listed = parts
    .map((p) => {
      const range = prettyDateRange(p.dateRange);
      const name = p.id === 'nonstandard' ? 'a nonstandard part' : p.id;
      return range ? `${name} (${range})` : name;
    })
    .join(', ');
  return `This course runs in more than one part of term: ${listed}. Drop, refund and credit/no-credit deadlines are different for each one.`;
}

export function sectionSnapshot(
  summary: SectionSummary,
  planTermId: string,
  capturedAt: string,
): IllinoisSectionSnapshot | undefined {
  /**
   * A fall 2026 room tells a student nothing about where a course meets in
   * spring 2029. Attaching the snapshot to every term would be a fabricated
   * fact on seven of the eight terms on the board.
   */
  if (planTermId !== summary.termId) return undefined;

  const status: IllinoisSectionStatus = summary.anyOpen
    ? 'open'
    : summary.anyClosed
      ? 'closed'
      : 'unknown';

  // Only claim a meeting time when one pattern dominates. Illinois publishes no
  // seat counts and no waitlist, so seatsRemaining is never set and the
  // 'almost-full' and 'waitlist' statuses are unreachable for this tenant.
  const patterned = summary.dayPatterns.reduce((sum, p) => sum + p.count, 0);
  const top = summary.dayPatterns[0];
  const meeting =
    top && patterned > 0 && top.count / patterned >= SUPERMAJORITY && top.start && top.end
      ? `${top.pattern} ${top.start}-${top.end}`
      : undefined;

  return {
    termId: planTermId,
    status,
    ...(meeting ? { meeting } : {}),
    ...(summary.usual ? { location: summary.usual.building } : {}),
    capturedAt,
  };
}

// ---------------------------------------------------------------------------
// 4. Programs -> checkable requirements
// ---------------------------------------------------------------------------

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const CHOOSE_PATTERNS = [
  /\bselect\s+(one|two|three|four|five|\d+)\b/i,
  /\b(one|two|three|four|five|\d+)\s+(?:of the following|course|courses|elective)/i,
  /\bat least\s+(one|two|three|\d+)\b/i,
  /\((\d+)\s+courses?\)/i,
];

/**
 * A number that is an amount of credit, not a number of courses.
 *
 * "Select 18 credit hours from List 1 and List 2" is the Chemical Engineering
 * technical elective rule, and reading its 18 as a course count asked a student
 * for eighteen electives worth 38 hours against a page that wanted 18 hours.
 */
const FOLLOWED_BY_HOURS = /^\s*(?:cumulative\s+|semester\s+|credit\s+)*(?:credit\s*)?hours?\b/i;

/**
 * How many courses a group wants, read from the catalog's own label.
 *
 * programs.mjs's `/\bone\b|\ba\b/i` heuristic is deliberately not carried over:
 * the bare "a" matches almost every English label, which would turn required
 * sequences into single choices and let a plan claim a major is finished.
 */
export function chooseCount(label: string): number | null {
  for (const re of CHOOSE_PATTERNS) {
    const m = re.exec(label);
    if (!m) continue;
    // What follows the number decides what the number counts. Everything after
    // the match is inspected rather than the matched text, because the patterns
    // stop at the digit and "18" and "18 credit hours" look identical there.
    const after = label.slice((m.index ?? 0) + m[0].length);
    if (FOLLOWED_BY_HOURS.test(after)) continue;
    const token = (m[1] ?? '').toLowerCase();
    const n = WORD_NUMBERS[token] ?? Number(token);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * The catalog's own gen-ed strings, mapped from the requirement-table label.
 *
 * A label that does not map gets genEd null, which means the hours can be
 * counted but no specific course can be checked. That fallback is reached by
 * design, and the block says so rather than guessing which courses qualify.
 */
const GENED_MAP: Record<string, string[]> = {
  'composition i': ['Composition I'],
  'advanced composition': ['Advanced Composition'],
  'humanities & the arts': ['Humanities - Hist & Phil', 'Humanities - Lit & Arts'],
  'natural sciences & technology': [
    'Nat Sci & Tech - Phys Sciences',
    'Nat Sci & Tech - Life Sciences',
  ],
  'social & behavioral sciences': ['Social & Beh Sci - Soc Sci', 'Social & Beh Sci - Beh Sci'],
  'cultural studies: non-western cultures': ['Cultural Studies - Non-West'],
  'cultural studies: us minority cultures': ['Cultural Studies - US Minority'],
  'cultural studies: western/comparative cultures': ['Cultural Studies - Western'],
  'quantitative reasoning': ['Quantitative Reasoning I', 'Quantitative Reasoning II'],
};

export function genEdForLabel(label: string): string[] | null {
  const key = label
    .toLowerCase()
    .replace(/\(\s*\d+\s*(?:hours?|courses?)\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:.]$/, '');
  return GENED_MAP[key] ?? null;
}

/**
 * A degree total smaller than this is a scraper artifact, not a degree.
 *
 * The CS BS page records totalCredits 3 today because programs.mjs's hours()
 * reads the first number it finds in the table. Printing 3 would tell a student
 * a bachelor's degree is three hours of work, so an implausible total is
 * reported as unknown and counted in the coverage report instead.
 */
const MIN_PLAUSIBLE_DEGREE_CREDITS = 30;

/**
 * A row the catalog marks as already satisfied elsewhere, or as optional.
 *
 * Both must match at the START of the title. ADVISORY, which reads prerequisite
 * sentences, is far too broad here: it matches "Select one of the following
 * (MATH 227 or MATH 257 is recommended)" and "Students are encouraged to take
 * these required survey courses", and both of those rows are real requirements
 * whose title picked up the group's comment. Dropping a real requirement makes
 * a plan look finished when it is not, which is the worse of the two errors.
 */
const SATISFIED_ELSEWHERE = /^fulfilled by\b/i;
const OPTIONAL_ROW = /^(?:highly recommended|recommended|optional|it is recommended|not required)\b/i;

/**
 * Drop the footnote rows the requirement scraper mixes in with real courses.
 *
 * Two shapes show up. A row titled "fulfilled by PHYS 211 and PHYS 212" is the
 * catalog saying a gen-ed is already covered by the major, not a course to add,
 * and keeping it makes scheduler.areaProgress charge PHYS 211 to the gen-ed
 * area and then refuse to count it where it belongs. A row titled "Highly
 * recommended, optional 1 credit hour course" is advice.
 *
 * The credits-based rule the design called for cannot fire today, because every
 * one of the 14,110 program course rows has credits null, so the title is the
 * only signal available. This is a patch. The fix belongs in programs.mjs.
 */
function normaliseProgramRows(group: RawProgramGroup): { rows: RawProgramCourse[]; dropped: number } {
  const rows: RawProgramCourse[] = [];
  let dropped = 0;
  for (const row of group.courses ?? []) {
    if (!row?.code) continue;
    const title = row.title ?? '';
    if (title !== row.code && (SATISFIED_ELSEWHERE.test(title) || OPTIONAL_ROW.test(title))) {
      dropped += 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, dropped };
}

/**
 * A "Total Hours" row, and the two different things one can be.
 *
 * Neither is a requirement, and both used to become one. "Total Hours of
 * Curriculum to Graduate 128" on the Computer Science page reached the planner
 * as a 128-hour requirement with no courses, and was shown to the student as a
 * hole in their degree the size of the whole degree.
 *
 * "Total Hours for Chemical Engineering Technical Electives 18" is the other
 * kind: the subtotal of the area it sits in. Also not a requirement, but the
 * number is the budget for the lists printed under it, which is the only place
 * that page states how much of List 1 and List 2 to take.
 */
const TOTAL_ROW = /^total hours?\b/i;
const DEGREE_TOTAL_ROW = /\b(?:to graduate|curriculum|for graduation|for the degree)\b/i;

/**
 * "...from a single focus area", "...from the same area".
 *
 * The difference between three courses from one list and three courses spread
 * over eight lists is the whole content of the CS focus-area rule, so it is read
 * from the catalog's own words rather than assumed either way.
 */
const SINGLE_LIST = /\b(?:a single|one single|the same)\b/i;

/**
 * A heading that states several counts is describing its sub-lists, not itself.
 *
 * The Computer Engineering technical electives are headed "From the
 * Departmentally Approved List of Technical Electives (below) to include: at
 * least 1 Electrical Engineering Foundations course, at least 3 Advanced
 * Computing Electives, at least 1 Design Elective." Reading the first number it
 * contains turned a 30-hour, 417-course pool into a request for one course.
 * Each of those three counts belongs to a table of its own further down the
 * page, and each of those tables already carries it.
 */
const COUNT_MENTIONS =
  /\b(?:select|choose|at least|a minimum of)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi;

function statesSeveralCounts(text: string): boolean {
  return (text.match(COUNT_MENTIONS) ?? []).length > 1;
}

/** A count from one piece of catalog prose, or null when the prose is ambiguous. */
function soleCount(text: string): number | null {
  if (!text || statesSeveralCounts(text)) return null;
  return chooseCount(text);
}

/** The narrowest view of the catalog the rule builder needs. */
export interface CatalogRowLookup {
  get(code: string): { title: string; credits: number; creditsMax?: number | null } | undefined;
}

export interface AreaRuleBlock {
  /** The group this came from. When several lists merged, the first of them. */
  groupIndex: number;
  label: string;
  hours: number | null;
  note: string;
  rule: RequirementRule;
  /** Catalog rows this block consumed. */
  rows: number;
}

export interface AreaRules {
  blocks: AreaRuleBlock[];
  droppedRows: number;
  droppedTotalRows: number;
  pools: number;
}

/** One catalog row, with its "or" siblings folded into a single slot. */
function choicesFrom(rows: RawProgramCourse[], byCode: CatalogRowLookup): CourseChoice[] {
  /**
   * One catalog row is one CourseChoice, with its orclass siblings folded in.
   * MATH 257 with orclass MATH 415 and orclass MATH 416 is a single linear
   * algebra slot with three options, and splitting it into three rows would
   * inflate the degree and make the plan unsatisfiable.
   */
  return rows.map((row) => {
    const codes = [row.code, ...(row.or ?? [])].map(normCode);
    const catalogCourse = byCode.get(codes[0]);
    return {
      codes,
      // The program file's title field is never a course title: it is either
      // the code echoed back or a footnote blob. The catalog is the only place
      // a real title exists.
      title: catalogCourse?.title ?? codes[0],
      credits: catalogCourse?.credits ?? row.credits,
      creditsMax: catalogCourse?.creditsMax ?? null,
    };
  });
}

/**
 * Every area of one degree, with each area's own share of the degree total.
 *
 * The share matters because it is the last cap available. A requirement group
 * cannot be worth more credit hours than the degree has room for, so a list of
 * 85 courses carrying 257 hours inside a 128-hour degree is a list to pick from
 * no matter what the page failed to say about it. That is the test that keeps
 * the Aerospace "Non-AE Technical Electives" table out of the plan as 85
 * required courses, and it is a measurement rather than a guess at the heading.
 */
export function requirementRulesForProgram(
  program: { areas?: RawProgramArea[]; totalCredits?: number | null },
  byCode: CatalogRowLookup,
): AreaRules[] {
  const areas = program.areas ?? [];
  const published = areas.map(publishedAreaHours);
  const total = program.totalCredits ?? null;
  const spent = published.reduce((sum, h) => sum + h, 0);

  return areas.map((area, index) => {
    // Hours the rest of the degree has already claimed. Null when the page
    // publishes no total, or when its own subtotals already add to more than
    // it, which happens and must not turn into a negative budget.
    const headroom = total === null ? null : total - (spent - published[index]);
    return requirementRulesForArea(area, byCode, headroom !== null && headroom > 0 ? headroom : null);
  });
}

/**
 * The hours an area publishes, from its own total or from its subtotal row.
 *
 * A "Total Hours of Curriculum to Graduate" row is the whole degree, not this
 * area, and counting it here would leave every other area with no room at all.
 */
function publishedAreaHours(area: RawProgramArea): number {
  if (area.hours !== null && area.hours !== undefined) return area.hours;
  for (const group of area.groups ?? []) {
    const label = (group.label ?? '').trim();
    if ((group.courses?.length ?? 0) > 0) continue;
    if (!TOTAL_ROW.test(label) || DEGREE_TOTAL_ROW.test(label)) continue;
    if (group.hours !== null && group.hours !== undefined) return group.hours;
  }
  return 0;
}

/**
 * One requirement area, read as rules the planner can plan.
 *
 * Exported because two callers have to agree exactly: adaptIllinoisPrograms
 * below, which is what the browser and the build step run, and the check
 * harness, which used to carry its own copy and drifted away from this one. Two
 * readings of the same catalog page is how a plan that passes the harness fails
 * in the product.
 *
 * The shape this exists for is the elective pool: the page names a list of
 * courses and says, somewhere, how many hours or how many courses to take from
 * it. Deciding a group IS a pool and deciding how big it is are two separate
 * questions, and the second one can fail while the first one succeeds.
 *
 * Is it a pool: the rows carry more credit than the cap. The scraper already
 * ran that test with the only cap it had, the group's own hours or the area's,
 * and wrote the answer in group.kind. This runs it again with the two caps the
 * scraper did not have, the area's subtotal row and the degree's headroom.
 *
 * How big: the group's own hours, then a count in its heading, then a count in
 * its note, then the area's numbers shared across every list under them. When
 * all of those are silent the pool is still a pool, with no size, and it is
 * reported that way instead of being taken whole or thrown away.
 */
export function requirementRulesForArea(
  area: RawProgramArea,
  byCode: CatalogRowLookup,
  /** Credit hours the rest of the degree leaves for this area, when known. */
  headroom: number | null = null,
): AreaRules {
  const groups = area.groups ?? [];
  let droppedRows = 0;
  let droppedTotalRows = 0;

  /**
   * Every group read once, before any of them becomes a rule.
   *
   * The area-level decision below cannot be made one group at a time: whether
   * the nine focus-area tables on the CS page are nine requirements or nine
   * lists inside one requirement depends on what the other eleven groups in the
   * area say.
   */
  const read: AreaGroupRead[] = groups.map((group, index) => {
    const label = group.label || '';
    const { rows, dropped } = normaliseProgramRows(group);
    droppedRows += dropped;
    const total = rows.length === 0 && TOTAL_ROW.test(label.trim());
    if (total) droppedTotalRows += 1;
    return {
      index,
      group,
      label,
      rows,
      isTotal: total,
      isDegreeTotal: total && DEGREE_TOTAL_ROW.test(label),
      ownChoose: positive(soleCount(label) ?? group.choose ?? null),
      ownHours: group.hours ?? null,
      // The degree page leaves most of its credit cells empty, so the catalog
      // is asked as well and the larger of the two answers is used. Reading a
      // 71-course list as zero credits would make it look like it fits
      // anywhere.
      credits: Math.max(group.summedCredits ?? 0, sumRowCredits(rows, byCode)),
      isList: false,
    };
  });

  // The area's own budget: its published total, or the subtotal row it prints
  // at the bottom of its own table.
  const subtotal = read.find((r) => r.isTotal && !r.isDegreeTotal && r.ownHours !== null);
  const areaBudget = area.hours ?? subtotal?.ownHours ?? null;

  for (const r of read) {
    if (r.rows.length === 0) continue;
    const cap = r.ownHours ?? areaBudget ?? headroom;
    r.isList = r.group.kind === 'menu' || (cap !== null && r.credits > cap + 0.5);
    /**
     * A count in the note is read only for a list that has no hours of its own.
     *
     * Two reasons for both halves of that. A note is every comment in the table
     * concatenated, so "Required courses: Select 1 course from list below"
     * would turn a seven-course requirement into a one-course one if it were
     * read for anything but a list, where the only alternative is taking every
     * row. And the Computer Engineering technical electives are a 417-course
     * list with a 30-hour cell and a note that names subject codes for a
     * paragraph; something in that paragraph reads as "one course" and the pool
     * came out asking for one. The hours cell is the better statement, so where
     * there is one the note is not consulted at all.
     */
    if (r.isList && r.ownChoose === null && r.ownHours === null) {
      r.ownChoose = positive(soleCount(r.group.note ?? ''));
    }
  }

  /** Lists with no number anywhere of their own. These draw on the area's. */
  const caplessPools = read.filter(
    (r) => r.isList && r.ownChoose === null && r.ownHours === null,
  );

  const consumed = new Set<number>();
  const blocks: AreaRuleBlock[] = [];
  let pools = 0;

  const merged =
    caplessPools.length > 0 ? mergeAreaPool(area, read, caplessPools, byCode, areaBudget) : null;
  if (merged) {
    for (const index of merged.consumed) consumed.add(index);
    blocks.push(merged.block);
    pools += 1;
  }

  for (const r of read) {
    if (consumed.has(r.index) || r.isTotal) continue;

    let rule: RequirementRule;
    if (r.rows.length > 0) {
      const choices = choicesFrom(r.rows, byCode);
      if (r.isList || (r.ownChoose !== null && r.ownHours !== null)) {
        pools += 1;
        rule = {
          kind: 'pool',
          hours: r.ownHours,
          n: r.ownChoose,
          choices,
          lists: [{ label: r.label || area.label, codes: choices.flatMap((c) => c.codes) }],
          constraints: [],
          from: 'group',
          label: r.label || area.label,
        };
      } else if (r.ownChoose !== null) {
        rule = { kind: 'choose', n: r.ownChoose, choices };
      } else {
        rule = { kind: 'all', choices };
      }
    } else if (r.ownHours !== null) {
      // A group with hours and no course rows is a real and common shape, not a
      // parse failure. The gen-ed tables are entirely rows like "Humanities &
      // the Arts (6 hours)" with no courses named.
      rule = { kind: 'hours', hours: r.ownHours, genEd: genEdForLabel(r.label), label: r.label };
    } else {
      /**
       * Rendered verbatim, never summarised.
       *
       * The label is read when the note is empty because on the Civil
       * Engineering page the whole "students choose a primary and a secondary
       * field" paragraph is the group's LABEL and its note is blank, and the
       * review row came out as "The catalog says:" with nothing after the
       * colon. A quote with nothing in it is worse than no row at all.
       */
      const text = r.group.note || r.label || '';
      // Nothing to quote, no courses, no hours. There is no requirement here to
      // report, and a row that says nothing buries the ones that do.
      if (!text) continue;
      rule = { kind: 'unparsed', text };
    }

    blocks.push({
      groupIndex: r.index,
      label: r.label,
      hours: r.group.hours ?? null,
      note: r.group.note ?? '',
      rule,
      rows: r.rows.length,
    });
  }

  blocks.sort((a, b) => a.groupIndex - b.groupIndex);
  return { blocks, droppedRows, droppedTotalRows, pools };
}

const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null);

/** One group of an area, after its rows and its own numbers have been read. */
interface AreaGroupRead {
  index: number;
  group: RawProgramGroup;
  label: string;
  rows: RawProgramCourse[];
  isTotal: boolean;
  isDegreeTotal: boolean;
  ownChoose: number | null;
  ownHours: number | null;
  credits: number;
  /** True when the rows carry more credit than any cap this area can produce. */
  isList: boolean;
}

/**
 * Several lists under one sentence, read as the one requirement the page means.
 *
 * The Computer Science page prints "Students must take a minimum of (6) six
 * additional technical electives with at least eighteen (18) cumulative credit
 * hours" once, and then nine tables of courses. Giving each table the area's
 * eighteen hours asks for 162 hours of technical electives; giving each table
 * nothing is what the product did before, and every technical elective a CS
 * student takes was invisible to the planner.
 *
 * Returns null, and each list is then reported on its own, whenever the area's
 * number is already spent by its other groups. That is the guard that keeps
 * this away from the Civil Engineering page, whose one area holds 94 groups and
 * two separate 31-hour and 6-hour field requirements: there is no single budget
 * to hand the lists there, and inventing one would be worse than saying so.
 */
function mergeAreaPool(
  area: RawProgramArea,
  read: AreaGroupRead[],
  caplessPools: AreaGroupRead[],
  byCode: CatalogRowLookup,
  areaBudget: number | null,
): { block: AreaRuleBlock; consumed: number[] } | null {
  const areaCount = area.chooseCourses ?? null;
  if (areaBudget === null && areaCount === null) return null;

  const poolIndexes = new Set(caplessPools.map((r) => r.index));

  /**
   * The group that is the area's own sentence rather than a separate spend.
   *
   * On the CS page that is the "six technical electives, eighteen hours" row:
   * no courses of its own, and the same eighteen hours the area publishes.
   * Counting it as a spend would leave the lists a budget of zero.
   */
  const governs = (r: AreaGroupRead): boolean =>
    !r.isTotal &&
    r.rows.length === 0 &&
    ((areaBudget !== null && r.ownHours === areaBudget) ||
      (areaCount !== null && r.ownChoose === areaCount && r.ownHours === null));

  let committed = 0;
  for (const r of read) {
    if (r.isTotal || poolIndexes.has(r.index) || governs(r)) continue;
    committed += r.ownHours ?? (r.rows.length > 0 ? r.credits : 0);
  }

  const budget = areaBudget === null ? null : areaBudget - committed;
  // A number the area's other groups have already spent is not a budget for
  // these lists, and pretending otherwise puts hours in the plan that the page
  // never asked for.
  if (areaBudget !== null && (budget === null || budget <= 0)) return null;
  if (budget === null && areaCount === null) return null;

  const listOf = (r: AreaGroupRead): PoolList => ({
    label: r.label || area.label,
    codes: r.rows.flatMap((row) => [row.code, ...(row.or ?? [])].map(normCode)),
  });

  /**
   * The sentences that constrain how the pool's own courses may be chosen.
   *
   * A row with no courses and a count of its own, sitting between the area's
   * sentence and the lists it points at. "At least one (1) ... from the list
   * below" and "At least three (3) ... from a single focus area" are both this
   * shape, and each binds to the lists printed after it, up to the next such
   * sentence, which is exactly how the page reads top to bottom.
   */
  const constraintRows = read.filter(
    (r) =>
      !r.isTotal &&
      r.rows.length === 0 &&
      r.ownChoose !== null &&
      !governs(r) &&
      r.ownChoose !== areaCount &&
      caplessPools.some((p) => p.index > r.index),
  );

  const constraints: PoolConstraint[] = [];
  for (const [i, r] of constraintRows.entries()) {
    const until = constraintRows[i + 1]?.index ?? Number.MAX_SAFE_INTEGER;
    const lists = caplessPools.filter((p) => p.index > r.index && p.index < until).map(listOf);
    if (lists.length === 0) continue;
    constraints.push({
      text: r.label || r.group.note || '',
      n: r.ownChoose as number,
      lists,
      single: SINGLE_LIST.test(`${r.label} ${r.group.note ?? ''}`),
    });
  }

  // One slot per catalog row, deduplicated: the CS team-project list repeats
  // courses that also appear in a focus area, and a course listed twice is one
  // course, not two towards the six.
  const seen = new Set<string>();
  const rows: RawProgramCourse[] = [];
  for (const p of caplessPools) {
    for (const row of p.rows) {
      const key = normCode(row.code);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  const governing = read.find(governs) ?? null;
  const consumed = [
    ...caplessPools.map((r) => r.index),
    ...constraintRows.map((r) => r.index),
    ...(governing ? [governing.index] : []),
  ];
  const firstPool = Math.min(...caplessPools.map((r) => r.index));
  // The sentence a reader would take this requirement from. The governing row
  // where there is one, otherwise the first thing the area says above its lists.
  const intro =
    governing ??
    read.find((r) => r.rows.length === 0 && !r.isTotal && r.index < firstPool && (r.label || r.group.note)) ??
    null;

  return {
    block: {
      groupIndex: Math.min(...consumed),
      label: area.label,
      hours: budget,
      // The catalog's own sentence, kept so the requirement can be quoted
      // rather than summarised anywhere it is shown.
      note: intro?.label || intro?.group.note || '',
      rows: rows.length,
      rule: {
        kind: 'pool',
        hours: budget,
        n: areaCount,
        choices: choicesFrom(rows, byCode),
        lists: caplessPools.map(listOf),
        constraints,
        from: 'area',
        label: area.label,
      },
    },
    consumed,
  };
}

/** Credit hours of a group's rows, from the catalog rather than the degree page. */
function sumRowCredits(rows: RawProgramCourse[], byCode: CatalogRowLookup): number {
  let sum = 0;
  for (const row of rows) sum += byCode.get(normCode(row.code))?.credits ?? row.credits ?? 0;
  return sum;
}

export function adaptIllinoisPrograms(
  file: RawProgramFile,
  byCode: Map<string, IllinoisCourse>,
): {
  programs: ProgramRequirements[];
  defs: IllinoisProgramDefinition[];
  blocks: Map<string, RequirementBlock[]>;
  dropped: number;
  droppedTotalRows: number;
  poolGroups: number;
  implausibleTotals: number;
} {
  const programs: ProgramRequirements[] = [];
  const defs: IllinoisProgramDefinition[] = [];
  const blocks = new Map<string, RequirementBlock[]>();
  let dropped = 0;
  let droppedTotalRows = 0;
  let poolGroups = 0;
  let implausibleTotals = 0;

  for (const raw of file.programs ?? []) {
    if (!raw?.id) continue;

    const programBlocks: RequirementBlock[] = [];
    const areas: RequirementArea[] = [];
    const requirements: ProgramRequirement[] = [];
    let enumeratedRows = 0;

    // One call for the whole degree, because an area's last cap is what the
    // rest of the degree leaves it, and that cannot be seen one area at a time.
    const byArea = requirementRulesForProgram(raw, byCode);

    raw.areas?.forEach((area, ai) => {
      const areaId = `${raw.id}::${ai}`;
      const schedulerGroups: RequirementGroup[] = [];

      const rules = byArea[ai] ?? { blocks: [], droppedRows: 0, droppedTotalRows: 0, pools: 0 };
      dropped += rules.droppedRows;
      droppedTotalRows += rules.droppedTotalRows;
      poolGroups += rules.pools;

      for (const block of rules.blocks) {
        enumeratedRows += block.rows;
        const label = block.label || area.label || '';
        const rule = block.rule;

        programBlocks.push({
          // Still the group's own index, so a plan saved before pools existed
          // still points at the block it was saved against wherever the reading
          // has not changed.
          id: `${raw.id}::${ai}::${block.groupIndex}`,
          areaId,
          areaLabel: area.label,
          label,
          hours: block.hours,
          // programs.mjs's hours() keeps only the first number it sees, so a
          // "3-4" in the catalog arrives here as 3 and the high end is gone.
          // Null is honest until that producer returns a range.
          hoursMax: null,
          rule,
          note: block.note,
          url: raw.url,
        });

        if (rule.kind === 'all' || rule.kind === 'choose' || rule.kind === 'pool') {
          schedulerGroups.push({
            label,
            // A pool's count, where it has one. areaProgress caps an area's
            // earned hours at the area's published total either way, so a pool
            // of 170 courses cannot inflate the bar.
            choose: rule.kind === 'choose' ? rule.n : rule.kind === 'pool' ? rule.n : null,
            courses: rule.choices.map((c) => ({
              code: c.codes[0],
              title: c.title,
              // Zero when the catalog has no credit line for the course. It
              // understates progress, which is the safe direction: the other
              // way tells a student they have graduated.
              credits: c.credits ?? 0,
            })),
          });
        }
      }

      areas.push({ label: area.label, hours: area.hours ?? 0, groups: schedulerGroups });
      requirements.push({
        id: areaId,
        label: area.label,
        targetCredits: area.hours ?? 0,
        description: area.groups?.find((g) => g.note)?.note ?? '',
      });
    });

    let totalCredits = raw.totalCredits;
    if (totalCredits !== null && totalCredits < MIN_PLAUSIBLE_DEGREE_CREDITS) {
      implausibleTotals += 1;
      totalCredits = null;
    }

    blocks.set(raw.id, programBlocks);
    programs.push({
      id: raw.id,
      college: raw.college,
      degree: raw.degree,
      name: raw.name,
      areas,
      totalCredits,
      areaHours: areas.reduce((sum, a) => sum + a.hours, 0),
    });
    defs.push({
      id: raw.id,
      name: raw.name,
      degree: raw.degree,
      totalCredits: totalCredits ?? 0,
      requirements,
      dataStatus: enumeratedRows > 0 ? 'catalog' : 'placeholder',
    });
  }

  return { programs, defs, blocks, dropped, droppedTotalRows, poolGroups, implausibleTotals };
}

/**
 * Illinois's own undergraduate degree codes, which are not UGA's.
 *
 * 89 of the 308 crawled programs carry an empty degree string, which is either a
 * minor, a concentration page or a row the scraper could not read. They are not
 * offered as a major to plan against.
 */
const ILLINOIS_UNDERGRAD = /^(BS|BA|BFA|BSN|BARCH|BLA|BSBA|BSLAS|BMUS|BSW|BSE)$/i;

export function illinoisUndergraduatePrograms(all: ProgramRequirements[]): ProgramRequirements[] {
  return all
    .filter((p) => p.areas.length > 0 && ILLINOIS_UNDERGRAD.test(p.degree))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Point every course at the requirement areas that want it.
 *
 * Nothing here tries to avoid double counting. scheduler.areaProgress already
 * charges a course to the first area that claims it, and doing it twice would
 * hide a course from the second area entirely.
 */
export function attachRequirementIds(
  courses: IllinoisCourse[],
  blocks: RequirementBlock[],
  facts: Map<string, CourseFacts>,
): void {
  // A requirement can name any member of a cross-listing class, so the lookup
  // has to resolve every alias back to the one course the planner carries.
  const byAlias = new Map<string, IllinoisCourse>();
  for (const course of courses) {
    const code = normCode(course.code);
    byAlias.set(code, course);
    for (const alias of facts.get(code)?.equivalents ?? []) {
      if (!byAlias.has(alias)) byAlias.set(alias, course);
    }
  }

  const add = (course: IllinoisCourse, areaId: string, role?: 'required' | 'choice') => {
    if (!course.requirementIds.includes(areaId)) course.requirementIds.push(areaId);
    // A course required by one area and optional in another is still required.
    if (role === 'required') course.pathwayRole = 'required';
    else if (role === 'choice' && course.pathwayRole !== 'required') course.pathwayRole = 'choice';
  };

  for (const block of blocks) {
    if (block.rule.kind === 'all' || block.rule.kind === 'choose' || block.rule.kind === 'pool') {
      // A pool is a list to pick from, so every course in it is a choice. The
      // CS focus areas hold about 170 courses between them and marking any of
      // them "required by this degree" on a card would be a false claim about
      // 164 of them.
      const role = block.rule.kind === 'all' ? 'required' : 'choice';
      for (const choice of block.rule.choices) {
        for (const code of choice.codes) {
          const course = byAlias.get(normCode(code));
          if (course) add(course, block.areaId, role);
        }
      }
      continue;
    }
    if (block.rule.kind === 'hours' && block.rule.genEd) {
      const wanted = new Set(block.rule.genEd);
      for (const course of courses) {
        const tags = facts.get(normCode(course.code))?.genEd ?? [];
        // No pathwayRole here. A gen-ed block wants some hours from a list of
        // hundreds of courses, so no single one of them is required or chosen.
        if (tags.some((t) => wanted.has(t))) add(course, block.areaId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The one entry point the UI calls
// ---------------------------------------------------------------------------

const TERM_LABELS: Record<string, string> = {
  fall: 'Fall',
  spring: 'Spring',
  summer: 'Summer',
  winter: 'Winter',
};

export function buildIllinoisData(input: {
  catalog?: RawCatalogFile | null;
  programs?: RawProgramFile | null;
  grades?: RawGradeFile | null;
  sections?: RawSectionFile | null;
  includeGraduate?: boolean;
}): IllinoisData {
  const catalogFile = input.catalog ?? null;
  const includeGraduate = input.includeGraduate ?? false;

  const adapted = catalogFile
    ? adaptIllinoisCatalog(catalogFile, { includeGraduate })
    : { courses: [] as IllinoisCourse[], facts: new Map<string, CourseFacts>(), equivalents: new Map<string, string[]>() };

  const courses = adapted.courses;
  const facts = adapted.facts;
  const equivalents = adapted.equivalents;

  const byId = new Map(courses.map((c) => [c.id, c]));
  const byCode = new Map(courses.map((c) => [normCode(c.code), c]));

  // ---- grades ----
  const gradeRows = input.grades?.courses ?? [];
  const grades = new Map<string, GradeRow>();
  for (const row of gradeRows) {
    if (!row?.code) continue;
    grades.set(normCode(row.code), row);
  }
  const bands = computeDifficultyBands(gradeRows);
  const gradeProvenance = input.grades
    ? { source: input.grades.source, terms: input.grades.terms, count: input.grades.count }
    : null;

  const catalogCodes = new Set((catalogFile?.courses ?? []).map((c) => normCode(c.code)));
  let orphanGradeRows = 0;
  for (const code of grades.keys()) if (!catalogCodes.has(code)) orphanGradeRows += 1;

  // ---- sections ----
  const sections = new Map<string, SectionSummary>();
  let sectionTerm: IllinoisData['sectionTerm'] = null;
  if (input.sections) {
    const term = (input.sections.term ?? '').toLowerCase();
    sectionTerm = {
      id: `${term}-${input.sections.year}`,
      label: `${TERM_LABELS[term] ?? input.sections.term} ${input.sections.year}`,
      year: input.sections.year,
      term: input.sections.term,
      fetchedAt: input.sections.fetchedAt,
    };
    for (const course of input.sections.courses ?? []) {
      if (!course?.code) continue;
      sections.set(normCode(course.code), summariseSections(course, sectionTerm));
    }
  }

  // Format and the section snapshot are patched on here rather than inside
  // adaptIllinoisCourse, because the catalog crawl and the schedule crawl are
  // separate files and the adapter for one must not depend on the other.
  if (sectionTerm) {
    for (const course of courses) {
      const summary = sections.get(normCode(course.code));
      if (!summary) continue;
      if (summary.onlineOnly) course.format = 'Online';
      const snapshot = sectionSnapshot(summary, sectionTerm.id, sectionTerm.fetchedAt);
      if (snapshot) course.section = snapshot;
    }
  }

  // ---- programs ----
  const adaptedPrograms = input.programs
    ? adaptIllinoisPrograms(input.programs, byCode)
    : {
        programs: [] as ProgramRequirements[],
        defs: [] as IllinoisProgramDefinition[],
        blocks: new Map<string, RequirementBlock[]>(),
        dropped: 0,
        droppedTotalRows: 0,
        poolGroups: 0,
        implausibleTotals: 0,
      };

  for (const programBlocks of adaptedPrograms.blocks.values()) {
    attachRequirementIds(courses, programBlocks, facts);
  }

  // ---- coverage ----
  let withParsedPrereq = 0;
  let withLowConfidencePrereq = 0;
  let withPrereqTextOnly = 0;
  let variableCredit = 0;
  let unknownCredit = 0;
  let withGrades = 0;
  let withSections = 0;

  for (const course of courses) {
    const fact = facts.get(normCode(course.code));
    if (!fact) continue;
    if (fact.prereq?.parsed) {
      withParsedPrereq += 1;
      if (fact.prereq.confidence === 'low') withLowConfidencePrereq += 1;
    } else if (fact.prereq && fact.prereq.text.length > 0) {
      withPrereqTextOnly += 1;
    }
    if (!fact.creditRange.known) unknownCredit += 1;
    else if (fact.creditRange.variable) variableCredit += 1;
    if (grades.has(normCode(course.code))) withGrades += 1;
    if (sections.has(normCode(course.code))) withSections += 1;
  }

  const coverage: CoverageReport = {
    catalogCourses: catalogFile?.courses?.length ?? 0,
    undergraduateCourses: courses.length,
    withParsedPrereq,
    withLowConfidencePrereq,
    withPrereqTextOnly,
    withGrades,
    withoutGrades: courses.length - withGrades,
    orphanGradeRows,
    withSections,
    sectionTerm: sectionTerm?.label ?? null,
    programs: adaptedPrograms.programs.length,
    programsWithCourses: adaptedPrograms.defs.filter((d) => d.dataStatus === 'catalog').length,
    variableCredit,
    unknownCredit,
    droppedProgramRows: adaptedPrograms.dropped,
    droppedTotalRows: adaptedPrograms.droppedTotalRows,
    poolGroups: adaptedPrograms.poolGroups,
    implausibleProgramTotals: adaptedPrograms.implausibleTotals,
  };

  return {
    courses,
    byId,
    byCode,
    facts,
    equivalents,
    grades,
    gradeProvenance,
    bands,
    sections,
    sectionTerm,
    programs: adaptedPrograms.programs,
    programDefs: adaptedPrograms.defs,
    requirementBlocks: adaptedPrograms.blocks,
    catalogFetchedAt: catalogFile?.fetchedAt ?? null,
    coverage,
  };
}
