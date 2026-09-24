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
  RequirementRow,
} from './scheduler';
import { ILLINOIS_SUBJECT_NAMES } from './illinois-subjects.ts';

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
  /**
   * The catalog's own sentence for a course whose prerequisites are real but
   * stated only in prose, with no clause a parser can read: "See Class Schedule
   * or departmental course information for topics and prerequisites." 51
   * undergraduate rows have one, CS 498 among them, and every one of them used
   * to reach the surfaces as a course with no prerequisite sentence at all. A
   * planner that then says "The catalog lists no prerequisite for this course"
   * has made a false statement about the university.
   *
   * Optional because a catalog crawled before courses.mjs emitted it has no
   * such field, and an older file must still load rather than throw.
   */
  prereqNote?: string;
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

/**
 * A section Illinois marks restricted.
 *
 * The availability cell holds two facts and every surface used to read only
 * the first. 4,196 Fall 2026 rows read "Open (Restricted)" and 1,243 read
 * "CrossListOpen (Restricted)", so 5,439 of the 12,832 sections are open to
 * some group and not to everyone. Plain "Open" never carries the marker: of
 * the 3,811 rows that read "Open" or "CrossListOpen", not one has restriction
 * text anywhere on it.
 *
 * Illinois names the restriction in the date cell for 1,039 of those rows and
 * publishes nothing about the other 4,400, so no surface may say who is shut
 * out unless splitDateCell found it written down.
 */
export function sectionIsRestricted(availability: string | null): boolean {
  return /\(Restricted\)/i.test((availability ?? '').trim());
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
  shape: 'single' | 'or' | 'one-of' | 'bare-comma' | 'paren-sequence' | 'or-of-and';
  /** The clause this group came from, verbatim, so an error can quote it. */
  source: string;
  /**
   * A way to meet this group that is not a course, in the catalog's own words.
   *
   * CS 124's whole prerequisite is "Three years of high school mathematics or
   * MATH 112". Reading only the code books MATH 112, a three hour algebra
   * course, into the first term of every Computer Science plan, including plans
   * for students whose transcript already carries two semesters of calculus.
   * Nothing the crawl can see says what a student did in high school, so the
   * clause is carried to somebody who can answer it instead of being decided
   * here.
   *
   * 25 of the 9,440 catalog rows mention high school in their prerequisite
   * sentence and 13 offer it as an alternative to a course. Null everywhere
   * else.
   */
  priorLearning: string | null;
}

/** Illinois's own undergraduate classifications, lowest first. */
export type ClassStanding = 'freshman' | 'sophomore' | 'junior' | 'senior';

/**
 * Earned hours each classification starts at.
 *
 * Student Code § 3-302, Classification of Undergraduate Students:
 * freshman 0-29.9 hours, sophomore 30-59.9, junior 60-89.9, senior 90 or more.
 * https://studentcode.illinois.edu/article3/part3/3-302
 *
 * These are Illinois's numbers, not this project's. A capstone that says
 * "senior standing" is a capstone a student cannot register for below 90 hours,
 * and a plan that puts it in a first-year fall is a plan that cannot be
 * followed.
 */
export const STANDING_HOURS: Record<ClassStanding, number> = {
  freshman: 0,
  sophomore: 30,
  junior: 60,
  senior: 90,
};

export interface PrereqSpec {
  /** ANDed together. */
  groups: PrereqGroup[];
  escape: 'consent' | 'standing' | 'either' | null;
  /** The catalog sentence, verbatim, for display. */
  text: string;
  parsed: boolean;
  confidence: 'high' | 'low' | 'none';
  /**
   * A prose statement that this course has prerequisites which the catalog does
   * not list here. Empty when there is none.
   *
   * Separate from `text` because the two mean opposite things to a reader.
   * `text` is a requirement we tried to parse; `note` is the catalog telling us
   * the requirement lives somewhere we did not crawl. A surface that treats an
   * empty `text` as "no prerequisite" is the bug this field exists to stop.
   */
  note: string;
  /**
   * The lowest class standing the catalog requires, or null when it names none.
   *
   * Requirement, not escape. `escape: 'standing'` is the other shape, where
   * standing is offered INSTEAD of a course ("CS 101 or senior standing"), and
   * the two must not be confused: one blocks a first-year student, the other
   * lets a senior past a course.
   */
  standing: ClassStanding | null;
  /** The catalog's own words for the standing clause, so an error can quote it. */
  standingText: string;
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
      /**
       * False when the thin-sample guard moved this row out of the band its
       * number falls in, which it does for 127 undergraduate courses. Their
       * difficulty is above the 75th percentile and they come back labelled
       * 'typical', so anything that turns the band into a sentence about where
       * the course sits must check this first or it tells 128 students their
       * course is in the middle half when it is in the top quarter.
       */
      placed: boolean;
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
  /**
   * Every distinct weekly timetable a student could be handed, by section type.
   *
   * Keyed by the type as the crawl names it ("Lecture", "Discussion/Recitation",
   * "Lecture-Discussion", and combined types such as "Discussion/Recitation,
   * Laboratory" kept whole, because that is one section with two meetings, not
   * two things to register for). The one change to the name is that dates the
   * scraper glued on are taken off; see sectionTypeKey. Each value is the
   * distinct list of section signatures, sorted as plain strings so a rebuild
   * writes the same bytes, which puts "MW@1020-1095" before "MW@840-915": read
   * the numbers, not the order. See sectionSignature for the format. CHEM
   * 101's 42 discussion-and-lab rows are one type whose entries read like
   * "F@480-530;M@1080-1190": an 8 a.m. Friday discussion and a 6 p.m. Monday lab.
   *
   * earliest and latest cannot answer "no classes before 9". RHET 105 has three
   * 8 a.m. sections out of 94, so its earliest is 8:00AM, and a planner reading
   * that would drop a course 91 of whose sections start at 9 or later. This
   * keeps every option so the question can be asked of the options.
   *
   * Empty when the course has no sections, or when the crawl gave no way to
   * read a section's meetings; both mean unknown, and registrationFits returns
   * null for them.
   */
  meet: Record<string, string[]>;
  /**
   * True when "no classes before 9" can be honoured: every section type has at
   * least one section whose meetings all start at 9:00 or later, or are
   * arranged. False when some type has none, and also false when meet is empty,
   * because a course we cannot read is not a course we can promise anything
   * about. Exactly registrationFits(meet, { notBefore: 540 }) === true.
   */
  lateOption: boolean;
}

export interface CoverageReport {
  catalogCourses: number;
  undergraduateCourses: number;
  withParsedPrereq: number;
  withLowConfidencePrereq: number;
  withPrereqTextOnly: number;
  /**
   * Courses whose only prerequisite evidence is a prose note, normally "See
   * Class Schedule ... for topics and prerequisites". They have prerequisites
   * and no surface may say otherwise.
   */
  withPrereqNoteOnly: number;
  /** Courses whose catalog sentence names a class standing the student must have. */
  withStandingRequirement: number;
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
  /** Programs whose page carries a campus general education table. */
  programsWithGenEd: number;
  /** General education categories read across every program. */
  genEdCategories: number;
  /**
   * Categories sized from the campus table rather than from a degree page.
   * Only Composition I and Advanced Composition reach this, because no degree
   * page states hours for either. See GENED_CAMPUS_SIZE for the source.
   */
  genEdCategoriesFromCampus: number;
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
  | {
      kind: 'hours';
      hours: number;
      genEd: string[] | null;
      label: string;
      /**
       * The lowest course level the page's own words allow, or null when they
       * state none. "Advanced Electives ... the 400-level coursework offered
       * for letter grade in ANY area" is six hours that a 100-level course
       * cannot fill, and without this the plan filled them with one.
       */
      minLevel?: number | null;
      /** Codes the page rules out: "Exceptions to the list are: ASTR 100, PHYS 101 and PHYS 102, and CHEM 101." */
      exclude?: string[];
    }
  /**
   * One campus general education category, as the degree page states it.
   *
   * Its own kind rather than another 'hours' block for two reasons the planner
   * has to act on. A category can be sized in COURSES rather than hours
   * ("Cultural Studies: Non-Western Cultures (1 course)") and filling that with
   * hours means guessing what a course is worth. And a category can carry the
   * page's own "fulfilled by" list, which says the degree's own required
   * courses already cover it: without that, the planner books six more hours of
   * science on top of the physics a Computer Science student is already taking.
   */
  | {
      kind: 'gened';
      /** The catalog's published gen-ed strings a course must carry to count. */
      genEd: string[];
      hours: number | null;
      courses: number | null;
      /** Codes the page names as already covering this category, "or" folded in. */
      fulfilledBy: string[][];
      /**
       * Categories that may not share a course with each other.
       *
       * The campus General Education page says of Cultural Studies: "These
       * courses may fulfill other curricular requirements, but no single course
       * can fulfill multiple Cultural Studies categories." So one course can
       * count for both Cultural Studies and Humanities, and for a major
       * requirement as well, but never for two Cultural Studies categories.
       * https://gened.illinois.edu/requirements/
       */
      exclusiveGroup: string;
      /** True when the size came from the campus table rather than this page. */
      sizeFromCampus: boolean;
      /** The page's own words for this category, verbatim. */
      text: string;
      label: string;
    }
  | { kind: 'unparsed'; text: string }
  /**
   * "Completion of the third semester or equivalent of a language other than
   * English is required." Which language, and how many semesters are left,
   * depend on the student, so the adapter records the level and the engine
   * turns it into courses once it knows them.
   */
  | { kind: 'language'; semesters: 3 | 4; text: string };

/**
 * Split the language requirement out of a general education note.
 *
 * Returns the sentence about the language requirement, with the level it
 * asks for, and the note with that sentence removed. Null language when the
 * note has none.
 */
export function splitLanguageRequirement(text: string): { language: { semesters: 3 | 4; text: string } | null; rest: string } {
  const m = text.match(/(?:Language Requirement\s*\([^)]*\)|[^.;()]*language other than English[^.;)]*[.)]?)/i);
  if (!m || !/language other than english/i.test(m[0])) return { language: null, rest: text };
  const sentence = m[0].trim();
  const semesters: 3 | 4 = /fourth[- ]semester|fourth semester|4th semester/i.test(sentence) ? 4 : 3;
  const rest = text.replace(m[0], ' ').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
  return { language: { semesters, text: sentence }, rest };
}

export interface CourseChoice {
  codes: string[];
  title: string;
  credits: number | null;
  creditsMax: number | null;
  /**
   * Courses the degree page itself says may stand in for this row: "Calculus I
   * (MATH 220 may be substituted)". Never booked in the row's place, because
   * the page lists them as substitutes and not as the course, but a student
   * who holds one has met the row, and the bar counts it.
   */
  substitutes: string[];
  /**
   * Several courses taken together, and the page's choice between such sets.
   *
   * The catalog prints "CHEM 102 & CHEM 103 & CHEM 104 & CHEM 105" as one
   * row, and Molecular & Cellular Biology offers it or the accelerated
   * CHEM 202 set under "Select one group of courses", then PHYS 101 & 102 or
   * PHYS 211 & 212 & 213 & 214 the same way. The crawl keeps the first code of
   * each row and runs the titles together, so the degree read as CHEM 102 and
   * CHEM 202 and PHYS 101 and PHYS 211, both halves of two choices, with the
   * labs and second semesters gone. Each inner array is one set, in the
   * page's order. `codes` still holds the first course of each set, so a
   * reader that knows nothing of sets sees the alternatives.
   */
  bundles?: string[][];
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
 * A recommendation joined onto a requirement by a connective. ACCY 301 reads
 * "ACCY 202 or equivalent and recommend concurrent enrollment in ACCY 302", and
 * dropping the whole segment for the word "recommend" left the course with no
 * prerequisite at all, which put a 300-level accounting course in a freshman's
 * first term. The clause is cut where the recommendation starts when what
 * comes before it names a course. "ANTH 104 is strongly recommended" has no
 * connective and stays advisory in full.
 */
const ADVISORY_CLAUSE =
  /(?:,|;|\band)\s+(?:(?:we|it is|it's|students are)\s+)?(?:strongly\s+|highly\s+)?(?:recommend\w*|encourag\w*|suggest\w*)\b/i;
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

/** School work done before university, which no crawl of the catalog can see. */
const PRIOR_LEARNING = /\bhigh school\b/i;

/**
 * The clause offering school work instead of the course, or null.
 *
 * Read off the whole segment rather than off one item, because the catalog
 * writes the two halves either way round: CS 124 has "Three years of high
 * school mathematics or MATH 112" and CHEM 101 has "2.5 years of high school
 * mathematics, or credit or concurrent registration in MATH 112".
 *
 * Three conditions, each of which stops a wrong reading that the corpus
 * actually contains. The clause has to be one of the alternatives the "or"
 * joins, so "MATH 112 and three years of high school chemistry", where the
 * school work is an extra condition, is not read as a way out of the course.
 * It has to name no course itself, so that "a placement score showing high
 * school achievement equivalent to FR 102" is left alone: that is a rule about
 * one specific course rather than a general alternative. And something else in
 * the segment has to be a course, or there is nothing for it to be an
 * alternative to. CHEM 102's "Credit in or exemption from MATH 112; one year of
 * high school chemistry" fails the first test at the semicolon, which is right:
 * its MATH 112 is required outright.
 *
 * 13 of the catalog's 9,440 rows come out of this. Twelve are school work.
 * The thirteenth is FR 204, whose placement-score clause names FR 103, a course
 * Illinois no longer lists, so the clause reads as naming no course and passes
 * the second test. The reading is still right for that row: the catalog does
 * offer a placement score instead of FR 203, and this planner cannot check a
 * placement score either.
 */
function priorLearningClause(seg: string, known: Set<string>, self: string): string | null {
  const parts = seg
    .split(/\s*,?\s+or\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const clause = parts.find((p) => PRIOR_LEARNING.test(p) && codesIn(p, known, self).length === 0);
  if (!clause) return null;
  if (!parts.some((p) => p !== clause && codesIn(p, known, self).length > 0)) return null;
  return clause.replace(/[.;,]+$/, '');
}

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

const STANDING_RANK: ClassStanding[] = ['freshman', 'sophomore', 'junior', 'senior'];
const STANDING_WORD = /\b(freshman|sophomore|junior|senior)\b/gi;
/** "standing", "class standing", "academic standing", "standing or higher". */
const STANDING_HEAD = /\b(?:class\s+|academic\s+|year\s+)?standing\b/gi;
/** "Graduate or ", "Graduate Student or ": a list of standings, not an escape. */
const STANDING_LIST_LEAD =
  /\b(?:graduate|undergraduate|freshman|sophomore|junior|senior|students?)\s+or\s*$/i;

/**
 * The class standing a catalog sentence requires, or null.
 *
 * Illinois states these in prose with no course code in them, which is why the
 * clause parser above never sees them: CS 492 says "For Computer Science majors
 * with senior standing." and CS 497 says "For majors only; junior or senior
 * standing required." Neither produces a prerequisite group, so before this
 * existed a senior capstone could be placed in a freshman's first term and the
 * review list reported nothing wrong.
 *
 * The LOWEST standing named is the answer, because a list is a floor: "Restricted
 * to Sophomore, Junior or Senior standing" is satisfied at sophomore, and reading
 * it as senior would hold a course back two years the catalog never asked for.
 *
 * Three sentences are deliberately NOT read as a requirement:
 *   - "... or senior standing", where standing substitutes for the courses
 *     before it. That is an escape, which `escape` already carries, and
 *     treating it as a floor would bar a student who has the courses.
 *   - "graduate standing", which is not an undergraduate classification.
 *   - anything the advisory test matches, because "junior standing is
 *     recommended" is not a rule.
 */
export function parseStanding(text: string): { standing: ClassStanding | null; source: string } {
  let best: { rank: number; source: string } | null = null;

  /**
   * Sentence by sentence, because an advisory word in one sentence says nothing
   * about the next one.
   *
   * ACE 445 reads "ACE 349 or FIN 230 is recommended. Restricted to students
   * with junior standing." Testing a fixed window of characters before the word
   * "standing" reached back into the previous sentence, found "recommended",
   * and threw away a restriction the catalog states plainly.
   */
  for (const sentence of splitSentences(text)) {
    if (ADVISORY.test(sentence)) continue;
    STANDING_HEAD.lastIndex = 0;
    let head: RegExpExecArray | null;

    while ((head = STANDING_HEAD.exec(sentence)) !== null) {
      const before = sentence.slice(0, head.index);
      STANDING_WORD.lastIndex = 0;
      const words = [...before.matchAll(STANDING_WORD)];
      if (words.length === 0) continue;

      const runStart = words[0].index ?? 0;
      const lead = before.slice(0, runStart);
      /**
       * "or" in front of the run makes standing an alternative to whatever came
       * before it rather than a floor under it: "CS 101 or senior standing"
       * lets a student past CS 101, and enforcing senior there would bar
       * somebody who has the course.
       *
       * Unless the thing before the "or" is itself a classification. "Graduate
       * or senior standing" and "Graduate Student or Senior Standing Required"
       * are one list of acceptable standings, and for an undergraduate the
       * answer is senior.
       */
      if (/\bor\s*$/i.test(lead) && !STANDING_LIST_LEAD.test(lead)) continue;

      for (const word of words) {
        const rank = STANDING_RANK.indexOf(word[1].toLowerCase() as ClassStanding);
        if (rank < 0) continue;
        // The whole sentence, not the clause. A student who is told a course
        // needs senior standing should see the catalog's own words for it,
        // and a fragment like "senior standing" is not a quote of anything.
        if (!best || rank < best.rank) best = { rank, source: sentence.trim() };
      }
    }
  }

  // Freshman standing is everybody from their first day, so it is never a
  // condition a plan has to wait for.
  if (!best || best.rank <= 0) return { standing: null, source: '' };
  return { standing: STANDING_RANK[best.rank], source: best.source };
}

/**
 * A spec for a course whose prerequisites exist only as prose.
 *
 * 51 undergraduate rows say some version of "See Class Schedule or departmental
 * course information for topics and prerequisites" and list nothing. They are
 * not courses without prerequisites, and the difference matters: CS 498 reached
 * the surfaces with no spec at all and a card told students the catalog lists no
 * prerequisite for it. Absence of a parse is not evidence of absence of a
 * requirement.
 */
export function prereqNoteSpec(note: string): PrereqSpec {
  const text = note.trim();
  return {
    groups: [],
    escape: null,
    /**
     * The note goes in `text` as well, on purpose.
     *
     * `text` is "the catalog's own prerequisite sentence", and this IS that
     * sentence; it just has no clause in it. Every surface that already prints
     * `text` and falls back to "the catalog lists no prerequisite" therefore
     * starts telling the truth about these 51 courses without being touched.
     * `note` stays separate so a caller that wants to know WHY there is no
     * parse can tell this apart from a sentence the parser merely failed on.
     */
    text,
    parsed: false,
    confidence: 'none',
    note: text,
    standing: null,
    standingText: '',
  };
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
      let seg = rawSeg.trim();
      if (!seg) continue;

      // A semicolon at Illinois is always a top-level AND, in all 510 sentences
      // that use one: "CEE 350 or NRES 401; CEE 380 or NRES 201."
      const segCodes = codesIn(seg, known, self);

      if (ESC_CONSENT.test(seg)) noteEscape('consent');
      /**
       * An "or" inside a standing LIST is not an escape.
       *
       * CS 497's "For majors only; junior or senior standing required." was
       * read as offering standing instead of the courses, because the segment
       * has the word "or" in it. The or is between junior and senior. When the
       * segment states a standing requirement of its own, that is what it is.
       */
      else if (
        ESC_STANDING.test(seg) &&
        /\bor\b/i.test(seg) &&
        parseStanding(seg).standing === null
      ) {
        noteEscape('standing');
      }

      if (segCodes.length === 0) continue;
      const advisoryAt = seg.search(ADVISORY_CLAUSE);
      if (advisoryAt > 0 && codesIn(seg.slice(0, advisoryAt), known, self).length > 0) {
        seg = seg.slice(0, advisoryAt).trim();
      }
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
          priorLearning: null,
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
            priorLearning: null,
          });
        }
      }

      const produced = groups.slice(before);
      if (produced.length === 0) continue;

      /**
       * Only when the segment produced exactly one group.
       *
       * "Three years of high school mathematics or MATH 112" is one clause
       * about one course, and every row in the corpus written this way parses
       * to a single group. A segment that produced two groups would have to be
       * read to know which of them the school work replaces, and stamping both
       * would let a student past a course the catalog does require.
       */
      if (produced.length === 1) {
        produced[0].priorLearning = priorLearningClause(seg, known, self);
      }

      /**
       * Step 5b. A comma list whose final connective is "or" is a menu, even
       * when the thing after the "or" is not a course.
       *
       * "ATMS 301, ATMS 302, ATMS 303, or consent of instructor" means take ONE
       * of the three. The parser split it into three ANDed groups because the
       * final "or" attaches to "consent of instructor", so no course code ever
       * sat next to an "or" and the comma list read as conjunctive. 72 courses
       * were affected, and the worst of them, ACE 300's "MATH 220, MATH 221,
       * MATH 234, or equivalent", demanded all three calculus courses that the
       * catalog says cannot be taken together for credit.
       *
       * The discriminator is the final connective, not the final item.
       * "ATMS 201, MATH 241 and PHYS 211" ends in "and" and stays a list of
       * three, which is what it is.
       */
      const ESCAPE_TAIL = /,\s*or\s+(?!\s*[A-Z]{2,4}\s?\d{3}\b)[^,;]*$/i;
      const orMenu =
        produced.length > 1 &&
        ESCAPE_TAIL.test(seg) &&
        produced.every((g) => g.any.length === 1) &&
        !/\band\b/i.test(seg.replace(ESCAPE_TAIL, ''));

      if (orMenu) {
        const merged: PrereqGroup = {
          any: produced.flatMap((g) => g.any),
          concurrent: produced.every((g) => g.concurrent),
          confidence: 'high',
          shape: 'one-of',
          source: seg.trim(),
          priorLearning: produced.find((g) => g.priorLearning)?.priorLearning ?? null,
        };
        groups.length = before;
        groups.push(merged);
        continue;
      }

      /**
       * A segment mixing "and" with a comma list and an escape tail is a shape
       * this parser cannot settle. "ANSC 221, IB 100, or equivalent, and
       * CHEM 102" is one-of-two ANDed with a third; "MCB 354 and BIOC 455, or
       * consent of instructor" is two ANDed with an escape. They read the same
       * to a regex. Both stay parsed, because the courses named are right
       * either way, but the confidence drops so the product hedges rather than
       * telling a student to take three courses when the catalog wants two.
       */
      const ESCAPE_ANYWHERE = /\bor\s+(consent|permission|approval|equivalents?|instructor|departmental)\b/i;
      const mixedEscape =
        produced.length > 2 &&
        ESCAPE_ANYWHERE.test(seg) &&
        /\band\b/i.test(seg.replace(ESCAPE_ANYWHERE, ''));
      if (mixedEscape) for (const g of produced) g.confidence = 'low';

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

  /**
   * One pair of courses OR another: "Completion of CHEM 104 with a B- or
   * higher, or completion of CHEM 204, or completion of CHEM 222 and CHEM
   * 223"; "FSHN 220; or FSHN 120 and FSHN 414"; "CHEM 102 and CHEM 104, OR
   * CHEM 202 and CHEM 204". Groups of alternatives cannot say "this pair or
   * that one", and read as groups they demanded every course named: CHEM 223
   * of a student holding CHEM 104, CHEM 204 of one taking general chemistry.
   * The courses named are right, so the groups stay, at low confidence: the
   * plan orders around the ones it books and warns, and never demands the
   * rest. "GWS 100 or GWS 250 and GWS 350 or GWS 370" has no pair on either
   * side of an "or" and keeps its reading.
   */
  const PAIR = String.raw`[A-Z]{2,4}\s?\d{3}\s+and\s+(?:completion of\s+)?[A-Z]{2,4}\s?\d{3}`;
  const orOfAnd =
    new RegExp(`${PAIR}[^;.]*?\\bor\\b\\s+(?:completion of\\s+|credit in\\s+)?${PAIR}`, 'i').test(text) ||
    new RegExp(`[;,]\\s*or\\s+(?:completion of\\s+|credit in\\s+)?${PAIR}`, 'i').test(text);
  if (orOfAnd && groups.length > 1) {
    for (const g of groups) {
      g.confidence = 'low';
      g.shape = 'or-of-and';
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
  const standing = parseStanding(text);
  return {
    groups: deduped,
    escape,
    text,
    parsed,
    confidence: !parsed ? 'none' : deduped.some((g) => g.confidence === 'low') ? 'low' : 'high',
    note: '',
    standing: standing.standing,
    standingText: standing.source,
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
 *
 * Three buckets come back, not two. `missing` blocks a course. `uncertain` is a
 * reading we could not verify and only warns. `priorLearning` is a group the
 * catalog says school work can also satisfy, which nothing here can check, so
 * it neither blocks nor passes silently: it is handed to the caller to put in
 * front of the student. See PrereqGroup.priorLearning.
 */
export function missingPrerequisiteGroups(
  spec: PrereqSpec | null,
  earlier: Set<string>,
  sameTerm: Set<string>,
  equivalents: Map<string, string[]>,
): { missing: PrereqGroup[]; uncertain: PrereqGroup[]; priorLearning: PrereqGroup[] } {
  if (!spec || spec.groups.length === 0) return { missing: [], uncertain: [], priorLearning: [] };

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
  const priorLearning: PrereqGroup[] = [];
  spec.groups.forEach((group, i) => {
    if (satisfied.has(i)) return;
    // A low-confidence group is a reading we could not verify, so it warns
    // rather than blocks. Blocking on a guess is worse than not blocking.
    if (group.confidence === 'low') uncertain.push(group);
    // The catalog offers school work instead of this course. Blocking here
    // books a remedial course for every student on the degree, including one
    // who arrives with two semesters of calculus.
    else if (group.priorLearning) priorLearning.push(group);
    else missing.push(group);
  });

  return { missing, uncertain, priorLearning };
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

    /**
     * A course with a prose-only prerequisite note still gets a spec.
     *
     * The two fields never both appear in the crawl today, and the order here
     * says which wins if they ever do: a readable clause is better evidence
     * than a pointer to the Class Schedule. Null is reserved for a row that
     * says nothing at all about prerequisites, which is the only case where a
     * surface may say the catalog lists none.
     */
    const prereq = raw.prereqText
      ? parsePrerequisites(raw.prereqText, code, known)
      : raw.prereqNote
        ? prereqNoteSpec(raw.prereqNote)
        : null;
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
 * 16, max 80, and only a handful of courses reach 65. The 65 threshold that
 * works for Mizzou labels nothing at all here. Recomputing on every load means
 * a future import cannot silently break the labels.
 *
 * HOW THE NUMBERS ARE PRODUCED, because the copy beside them names them out
 * loud and a comment that misdescribes them is how this drifted once already.
 * The difficulties are sorted ascending and the band is the value sitting at
 * position floor(n x p) for p = 0.25, 0.75 and 0.90. No interpolation, so the
 * result is always a difficulty some course really has.
 *
 * WHAT MUST BE PASSED IN: exactly the rows the product will label, and nothing
 * else. This took every grade row Illinois publishes, 2,968 of them, while the
 * planner only ever labels the undergraduate courses it indexes. The bands came
 * out 9 / 26 / 37, and against the 2,296 undergraduate rows those sit at the
 * 18.8th, 70.1st and 88.2nd, so a course called "the easiest quarter" was in
 * the easiest fifth. On the undergraduate rows the same three positions are
 * 10 / 28 / 39. buildIllinoisData filters before it calls this.
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

  // 572 of the 2,293 indexed rows are built on fewer than 50 students. Calling
  // one of those the hardest course in a major is a claim the sample cannot
  // carry, so it is held back. Held back is not the same as measured, and
  // `placed` is how a caller tells the two apart.
  const placed = !(thin && (band === 'harder' || band === 'hardest'));
  if (!placed) band = 'typical';

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
    placed,
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

/**
 * One meeting of one section, as the crawl's meetings[] array holds it.
 *
 * RawSection does not declare meetings[] because the section cells it does
 * declare came first, and those cells hold at most one meeting: CHEM 101 ADA
 * meets Friday at 8 in Noyes and Monday at 6 in the Chemistry Annex, and the
 * top-level days/start/end name only the Friday. Every one of the 12,832 Fall
 * 2026 rows carries meetings[], so this narrow type reads it without claiming
 * an older crawl had it too.
 */
interface RawMeeting {
  days: string | null;
  start: string | null;
  end: string | null;
}

/** 9:00 a.m. in minutes since midnight, the line "no classes before 9" draws. */
export const LATE_START_MINUTES = 540;

/** The day letters the crawl uses. R is Thursday, S Saturday, U Sunday. */
const MEETING_DAY = /[MTWRFSU]/g;

/**
 * A date the scraper glued onto a type name, "Lecture-Discussion08/29/26" or
 * "Online08/24/26-12/09/26". Global, so only ever used with replace().
 */
const DATED_TYPE_SUFFIX = /\d{2}\/\d{2}\/\d{2}(?:-\d{2}\/\d{2}\/\d{2})?/g;

/**
 * The type a section is registered under, with scraper dates taken off.
 *
 * Combined types stay combined: "Discussion/Recitation, Laboratory" is one
 * CHEM 101 row a student signs up for once. What does not stay is a date the
 * scraper fused onto each part. 27 rows read like "Lecture-Discussion09/19/26,
 * Lecture-Discussion09/19/26-11/27/26", and kept verbatim each would become a
 * type of its own, so registrationFits would demand a fitting section of a
 * "type" that has exactly one member. That row is a Lecture-Discussion.
 */
function sectionTypeKey(type: string | null): string {
  const parts: string[] = [];
  for (const raw of (type ?? '').replace(DATED_TYPE_SUFFIX, '').split(',')) {
    const part = raw.trim();
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.join(', ') || 'Unlisted';
}

/**
 * The meetings of one section, or null when there is no trustworthy way to
 * know them.
 *
 * meetings[] is the source. An empty one (2,609 rows, mostly Independent
 * Study, Online and Internship) means the section has no time, and the
 * top-level cell is empty on every such row too, so it is read as that single
 * untimed cell. A crawl from before meetings[] existed falls back to the
 * top-level cell as well, but only when that cell is one clean meeting: "TR R"
 * is two meetings run together and splitting it would be a guess.
 */
function meetingsOf(section: RawSection): RawMeeting[] | null {
  const listed = (section as RawSection & { meetings?: RawMeeting[] }).meetings;
  if (Array.isArray(listed) && listed.length > 0) return listed;
  const days = (section.days ?? '').trim();
  if (days && days !== 'n.a.' && !/^[MTWRFSU]+$/.test(days)) return null;
  return [{ days: section.days, start: section.start, end: section.end }];
}

/**
 * One section's weekly timetable as a short string, the unit meet is built of.
 *
 * Each timed meeting is "DAYS@start-end" in minutes since midnight, meetings
 * joined by ";" in start order: CHEM 101 BDB is "F@660-710;M@960-1070", eleven
 * on Friday and four on Monday. A meeting with no clock time is "ARR". That
 * covers the 2,609 rows with no meeting at all and also the ones that list
 * days without a time: 59 Practice rows say "MTWRF" with no hour, and CHIN
 * 201's online half says "TR" with no hour. Neither is a room the student must
 * be in at a given time, so neither is a meeting a time window can exclude.
 * A section with nothing but untimed meetings is just "ARR".
 *
 * Days are kept only as the crawl's letters. The one row with a time and no
 * days (ME 297, 1:00PM) comes out as "@780-830": its hour still counts against
 * "no classes before 9", and it blocks no free day because it names none.
 */
function sectionSignature(section: RawSection): string | null {
  const meetings = meetingsOf(section);
  if (!meetings) return null;
  const timed: Array<{ days: string; start: number; end: number }> = [];
  let arranged = false;
  for (const m of meetings) {
    const start = minutesOfDay(m.start);
    const end = minutesOfDay(m.end);
    if (start === null || end === null) {
      arranged = true;
      continue;
    }
    timed.push({ days: ((m.days ?? '').match(MEETING_DAY) ?? []).join(''), start, end });
  }
  if (timed.length === 0) return 'ARR';
  timed.sort((a, b) => a.start - b.start || a.end - b.end || a.days.localeCompare(b.days));
  const tokens: string[] = [];
  for (const t of timed) {
    const token = `${t.days}@${t.start}-${t.end}`;
    if (!tokens.includes(token)) tokens.push(token);
  }
  if (arranged) tokens.push('ARR');
  return tokens.join(';');
}

/** A student's time wishes, in the units meet uses. Every part is optional. */
export interface MeetingWindow {
  /** Minutes since midnight no meeting may start before. 540 is 9:00 a.m. */
  notBefore?: number | null;
  /** Minutes since midnight every meeting must end by. 720 is noon. */
  notAfter?: number | null;
  /**
   * Days with no meeting, in the crawl's letters: ["F"] for Fridays off,
   * ["M", "W", "F", "S", "U"] for Tuesday/Thursday only. Leave out S and U and
   * a lab that meets Tuesday and Saturday passes as Tuesday/Thursday only.
   * "MWFSU" as one string also works.
   */
  freeDays?: string[];
}

const SIGNATURE_MEETING = /^([MTWRFSU]*)@(\d+)-(\d+)$/;

function signatureFits(
  signature: string,
  notBefore: number | null,
  notAfter: number | null,
  free: Set<string>,
): boolean {
  for (const token of signature.split(';')) {
    if (token === 'ARR') continue;
    const m = SIGNATURE_MEETING.exec(token);
    // A token this module did not write is not evidence that a section fits.
    if (!m) return false;
    if (notBefore !== null && Number(m[2]) < notBefore) return false;
    if (notAfter !== null && Number(m[3]) > notAfter) return false;
    for (const day of m[1]) if (free.has(day)) return false;
  }
  return true;
}

/**
 * Can a student register for this course inside a time window?
 *
 * true when every section type in meet has at least one section whose every
 * meeting fits: starts at or after notBefore, ends by notAfter, and falls on
 * no free day. Arranged meetings always fit. false when some type has no such
 * section. null when meet is missing or empty, which is "we do not know", and
 * must not be read as either answer.
 *
 * Per type because Illinois registers one section of each type. CHEM 101 with
 * notBefore 540 is true because lecture AL1 (TR 2 p.m.) and lab row ADB
 * (Friday 11, Monday 2) both clear 9 a.m., even though 10 of its 42 lab rows
 * have an 8 a.m. meeting. Ask it for Fridays off and it is false: every lab
 * row meets on a Friday.
 *
 * What per type cannot see. Some courses spread one choice over two types,
 * and then a type the student would never take can veto the answer: ACCY 201
 * "afternoons only" is false because its two Online Discussion rows are at 9
 * and 10, though an in-person discussion at noon would do, and CHEM 102 has
 * no 9 a.m. option only because one 8 a.m. row among 77 quizzes is typed
 * Discussion/Recitation. Nor does it know which lecture a discussion is
 * linked to, since the crawl does not say. Treat false as "not shown to fit"
 * and let a student override it.
 *
 * What ARR hides. A meeting that names days but no hour is signed ARR, so it
 * blocks no free day. Leaving the MTWRF placeholders aside, among the courses
 * sections.json ships that changes an answer only for hybrid rows whose
 * online half names days and no hour (10 courses): CMN 315 meets MW at
 * 2 p.m. in Lincoln Hall plus an online "F", and comes out true for Fridays
 * off on the reading that the online half keeps no set hour. If those halves
 * turn out to be live, this is where Fridays-off goes wrong.
 *
 * Pure and cheap: meet is a few short strings per type, so a planner can call
 * this for every course on every rebuild.
 */
export function registrationFits(
  meet: Record<string, string[]> | null | undefined,
  window: MeetingWindow,
): boolean | null {
  if (!meet) return null;
  const types = Object.keys(meet);
  if (types.length === 0) return null;
  const notBefore = typeof window.notBefore === 'number' ? window.notBefore : null;
  const notAfter = typeof window.notAfter === 'number' ? window.notAfter : null;
  const free = new Set<string>();
  for (const d of window.freeDays ?? []) for (const day of d.toUpperCase().match(MEETING_DAY) ?? []) free.add(day);
  for (const type of types) {
    const options = meet[type] ?? [];
    if (!options.some((sig) => signatureFits(sig, notBefore, notAfter, free))) return false;
  }
  return true;
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
  const signaturesByType = new Map<string, Set<string>>();
  let meetingsUnreadable = false;

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

    const signature = sectionSignature(s);
    if (signature === null) {
      meetingsUnreadable = true;
    } else {
      const typeKey = sectionTypeKey(s.type);
      const seen = signaturesByType.get(typeKey);
      if (seen) seen.add(signature);
      else signaturesByType.set(typeKey, new Set([signature]));
    }

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

  /**
   * One unreadable section empties the whole map rather than leaving a gap.
   * Dropping one option of several only hides a way to fit, but dropping the
   * only section of a type deletes that type's demand outright: were HK 340's
   * one lecture (TR 8:00) unreadable, meet would hold nothing but its labs and
   * lateOption would promise a morning-free schedule the course cannot give.
   * Sorted keys and sorted values so a rebuild over the same crawl writes the
   * same bytes.
   */
  const meet: Record<string, string[]> = {};
  if (!meetingsUnreadable) {
    for (const type of [...signaturesByType.keys()].sort()) {
      meet[type] = [...(signaturesByType.get(type) ?? [])].sort();
    }
  }

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
    meet,
    lateOption: registrationFits(meet, { notBefore: LATE_START_MINUTES }) === true,
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
  const key = genEdKey(label);
  return GENED_MAP[key] ?? null;
}

/**
 * The category a block's comment names when its label does not.
 *
 * Computer Science prints "One Science elective course" and says underneath
 * that it must come "from the Natural Science & Technology (NST) list";
 * Landscape Architecture prints "Physical Science" over "Any Natural Science &
 * Technology: Physical Sciences general education course". The label maps to
 * nothing and the comment says exactly which courses count. Read for the
 * three categories the catalog tags courses with and never for Cultural
 * Studies, which is also the name of a major's own area on two pages. A
 * comment naming two categories is left alone: it is describing a table, not
 * this row.
 */
export function genEdInNote(note: string): string[] | null {
  const text = note.replace(/\s+/g, ' ');
  const hits: string[][] = [];
  const nst = text.match(/natural sciences? (?:&|and) technology(?::\s*(physical|life) sciences?)?/i);
  if (nst) {
    hits.push(
      nst[1]
        ? [nst[1].toLowerCase() === 'physical' ? 'Nat Sci & Tech - Phys Sciences' : 'Nat Sci & Tech - Life Sciences']
        : GENED_MAP['natural sciences & technology'],
    );
  }
  if (/humanities (?:&|and) the arts/i.test(text)) hits.push(GENED_MAP['humanities & the arts']);
  if (/social (?:&|and) behavioral sciences?/i.test(text)) hits.push(GENED_MAP['social & behavioral sciences']);
  if (/quantitative reasoning/i.test(text)) hits.push(GENED_MAP['quantitative reasoning']);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The lowest level the page's words allow for a block that names no courses.
 *
 * The label first: "Additional 300-/400- upper division courses" is a floor of
 * 300, "6 courses at the 200-400 level" one of 200. A label that only says
 * "Advanced" is read with its comment, which is where Computer Science says
 * "the 400-level coursework offered for letter grade in ANY area"; "advanced"
 * with nothing more specific is 300, the level Illinois numbers its
 * upper-division courses from. A comment is read the way levelRuleIn reads
 * one: an aside in parentheses is stripped, and a sentence that caps what
 * counts ("will not receive credit for any other 100-level ASTR course") is
 * not a sentence about what is required.
 */
export function levelFloorIn(label: string, note: string): number | null {
  const fromLabel = lowestLevelIn(label);
  if (fromLabel !== null) return fromLabel;
  const fromNote = lowestLevelIn(note);
  if (/\badvanced\b|\bupper[- ]division\b/i.test(label)) return fromNote ?? 300;
  return fromNote;
}

function lowestLevelIn(text: string): number | null {
  const clean = (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\(([^()]{13,})\)/g, ' ')
    .trim();
  if (!clean) return null;
  for (const raw of clean.split(/(?<=\.)\s+/)) {
    if (CAP_SENTENCE.test(raw)) continue;
    const sentence = raw.replace(/\([^()]{13,}$/, ' ');
    if (sentence.search(LEVEL_SENTENCE) < 0) continue;
    const range = sentence.match(/\b([1-4])00\s*-?\s*(?:to|through|-)\s*-?\s*([1-4])00\b/i);
    if (range) return Number(range[1]) * 100;
    const levels = [...sentence.matchAll(/\b([1-4])00\b/g)].map((m) => Number(m[1]) * 100);
    if (levels.length > 0) return Math.min(...levels);
  }
  return null;
}

/**
 * Codes a comment rules out of a block: "Exceptions to the list are: ASTR
 * 100, PHYS 101 and PHYS 102, and CHEM 101." Read from the exception phrase
 * to the end of its sentence, so a code the comment names for another reason
 * two sentences on is not an exception.
 */
export function exceptionsIn(note: string): string[] {
  const text = (note ?? '').replace(/\s+/g, ' ');
  const at = text.search(/\b(?:exceptions? (?:to (?:the|this) list )?(?:are|is|:)|except(?:ing)?|excluding|other than|not including)\b/i);
  if (at < 0) return [];
  const sentence = text.slice(at).split(/(?<=\.)\s+/)[0];
  const out = new Set<string>();
  for (const m of sentence.matchAll(/\b([A-Z]{2,4})\s?(\d{3})\b/g)) out.add(`${m[1]} ${m[2]}`);
  return [...out];
}

/**
 * One spelling for a category that Illinois writes several ways.
 *
 * The same requirement is printed as "Humanities & the Arts" on one degree page
 * and "Humanities and the Arts" on another, with and without a trailing colon
 * and with its hours in brackets. Keying on the raw string means a category is
 * read on 222 pages and missed on 5.
 */
function genEdKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\(\s*\d+\s*(?:hours?|courses?)\s*\)/g, '')
    .replace(/\s+and\s+/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:.]$/, '');
}

/**
 * How many hours or courses each campus category takes when a degree page
 * states no number of its own.
 *
 * WHERE THESE COME FROM, because they are not this project's numbers and they
 * are not all in the crawled corpus:
 *
 *   The degree pages in public/illinois-programs.json state most of them
 *   themselves, and where they do the page always wins over this table: 222 of
 *   the 227 gen-ed areas print "Humanities & the Arts (6 hours)", 224 print
 *   "Cultural Studies: Non-Western Cultures (1 course)", 219 print
 *   "Quantitative Reasoning (2 courses, at least one course must be
 *   Quantitative Reasoning I)".
 *
 *   No degree page states a number for Composition I or Advanced Composition,
 *   and neither does catalog.illinois.edu/general-information/degree-general-
 *   education-requirements/, which lists the seven categories and no hours. The
 *   numbers below come from the campus General Education requirements table
 *   published by the Office of the Provost at https://gened.illinois.edu/
 *   requirements/ , read 20 September 2026, which gives Composition I as 4 to 6
 *   hours and Advanced Composition as 3 to 4 hours.
 *
 * The LOW end of each published range is used. It is the least the campus
 * requires, and booking the high end would put hours in a student's plan that
 * nobody asked them to take.
 */
const GENED_CAMPUS_SIZE: Record<string, { hours: number | null; courses: number | null }> = {
  'composition i': { hours: 4, courses: null },
  'advanced composition': { hours: 3, courses: null },
  'humanities & the arts': { hours: 6, courses: null },
  'natural sciences & technology': { hours: 6, courses: null },
  'social & behavioral sciences': { hours: 6, courses: null },
  'quantitative reasoning': { hours: null, courses: 2 },
  'cultural studies: non-western cultures': { hours: null, courses: 1 },
  'cultural studies: us minority cultures': { hours: null, courses: 1 },
  'cultural studies: western/comparative cultures': { hours: null, courses: 1 },
};

/** Where GENED_CAMPUS_SIZE's two unpublished numbers came from, for display. */
export const GENED_CAMPUS_SOURCE =
  'Composition I and Advanced Composition hours come from the campus General Education requirements at gened.illinois.edu/requirements. Every other number here is printed on this degree page.';

/**
 * One gen-ed category as a degree page states it.
 *
 * `hours` and `courses` are both nullable and both can be set. The page writes
 * "(6 hours)" for some categories and "(1 course)" for others, and filling in
 * the one it did not write, by assuming a course is three hours, is how a plan
 * ends up claiming a number the catalog never published.
 */
export interface GenEdCategoryRule {
  /** The page's own heading for the category, e.g. "Humanities & the Arts". */
  label: string;
  /** The catalog's published gen-ed strings this category accepts. */
  genEd: string[];
  hours: number | null;
  courses: number | null;
  /** True when hours or courses came from GENED_CAMPUS_SIZE rather than the page. */
  sizeFromCampus: boolean;
  /** Course codes the page names as already fulfilling this category. */
  fulfilledBy: string[][];
  /** True when the page says the named courses plus another approved course fulfil it. */
  partial: boolean;
  /** The page's own words for this category, verbatim, so nothing is paraphrased. */
  text: string;
}

/**
 * Every spelling of every campus category heading, longest first.
 *
 * Two reasons for both halves. Illinois prints the same category as "Humanities
 * & the Arts" on 222 degree pages and "Humanities and the Arts" on 5, so the
 * ampersand spellings alone would read the category on most pages and miss it
 * on the rest. And longest first matters because "Advanced Composition" ends in
 * a word that also opens "Composition I": scanning the short heading first would
 * cut the paragraph in the wrong place.
 */
/**
 * Spellings the ampersand rule below does not reach, counted off the corpus.
 *
 * 17 pages write "U.S. Minority", one writes "U.S. Minorities", ten (Applied
 * Health Sciences) write "US Minority Culture", and three write "Social &
 * Behavior Sciences". Each of those is a real degree whose gen-ed table would
 * otherwise be read one category short: a Kinesiology plan had no US Minority
 * Cultures course in it at all.
 */
const GENED_ALIASES: Record<string, string[]> = {
  'cultural studies: us minority cultures': [
    'cultural studies: u.s. minority cultures',
    'cultural studies: u.s. minorities cultures',
    'cultural studies: us minority culture',
  ],
  'social & behavioral sciences': ['social & behavior sciences'],
};

const GENED_HEADINGS: Array<{ phrase: string; key: string }> = Object.keys(GENED_MAP)
  .flatMap((key) => [key, ...(GENED_ALIASES[key] ?? [])])
  .flatMap((phrase) => {
    const key = Object.keys(GENED_MAP).find(
      (k) => k === phrase || (GENED_ALIASES[k] ?? []).includes(phrase),
    ) as string;
    const spelled = phrase.replace(/ & /g, ' and ');
    return spelled === phrase
      ? [{ phrase, key }]
      : [{ phrase, key }, { phrase: spelled, key }];
  })
  .sort((a, b) => b.phrase.length - a.phrase.length);

/**
 * Headings inside a gen-ed table that are not campus categories.
 *
 * They still end the category above them. The language requirement in
 * particular is a real sentence the page prints right after Quantitative
 * Reasoning, and letting it run on into that category's text would put its
 * course codes into the fulfilment set.
 */
const GENED_OTHER_HEADINGS = ['language requirement', 'total hours', 'foreign language'];

/**
 * "fulfilled by CHEM 102", "(CHLH 304 fulfills requirement)", and the two
 * misspellings the catalog actually contains, "fullfilled" and "Fulfilled".
 */
const FULFILLED = /\bfu(?:l|ll)fill?(?:ed|s|ing|ment)?\b/i;
/** "and any other course approved as ...", "and one more course approved as ...". */
const PARTIAL_FULFILMENT = /\b(?:any other|one more|another|one additional|other)\s+cours\w*/i;

/**
 * The gen-ed table of a degree page, read as one rule per campus category.
 *
 * WHY THIS EXISTS. Illinois gen ed is a campus requirement that every degree
 * page restates, and the crawler flattens the whole table into a single note
 * with no per-row label, so the group arrives here with no course rows, no
 * hours cell and a paragraph in `note`. Before this, that paragraph fell
 * through to the unparsed branch and the planner booked ZERO general education
 * credit for all 227 programs that have a gen-ed area, which is why Computer
 * Science came out at 88 of its 128 hours.
 *
 * WHAT IT WILL NOT DO. It never invents a size. A category the page states a
 * number for gets that number; a category it does not gets the campus number
 * from GENED_CAMPUS_SIZE, which is sourced in that table's comment; a heading
 * this file has never seen is not a category and is left in the unparsed text
 * for a human to read.
 *
 * FULFILLED BY. "Natural Sciences & Technology (6 hours) fulfilled by PHYS 211
 * and PHYS 212" is the page saying this degree's own required courses already
 * cover the category. Those codes are carried through so the planner can count
 * them once rather than booking six more hours of science on top of the physics
 * the student is already taking.
 */
export function genEdRulesFromText(text: string): GenEdCategoryRule[] {
  const source = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  const lower = source.toLowerCase();

  /**
   * The first place each category is named, and nowhere else.
   *
   * Only the first occurrence is a heading. Computer Science writes
   * "Quantitative Reasoning (2 courses, at least one course must be
   * Quantitative Reasoning I) fulfilled by MATH 220 or MATH 221 ..." and the
   * second mention is inside the first one's own sentence. Treating it as a
   * heading cuts the category's text off before "fulfilled by", and the plan
   * then books two more quantitative reasoning courses on top of the calculus
   * the page has just said covers them.
   */
  const found: Array<{ at: number; length: number; key: string }> = [];
  for (const { phrase, key } of GENED_HEADINGS) {
    if (found.some((f) => f.key === key)) continue;
    const at = lower.indexOf(phrase);
    if (at < 0) continue;
    // A heading that falls inside a longer heading already claimed is part of
    // that one, not a category of its own.
    if (found.some((f) => at >= f.at && at < f.at + f.length)) continue;
    found.push({ at, length: phrase.length, key });
  }
  if (found.length === 0) return [];

  const stops = found.map((f) => f.at);
  for (const other of GENED_OTHER_HEADINGS) {
    const at = lower.indexOf(other);
    if (at >= 0) stops.push(at);
  }
  stops.sort((a, b) => a - b);
  found.sort((a, b) => a.at - b.at);

  const rules: GenEdCategoryRule[] = [];
  for (const { at, length, key } of found) {
    const end = stops.find((s) => s > at) ?? source.length;
    const body = source.slice(at + length, end).trim();
    const label = source.slice(at, at + length);

    const hoursMatch = body.match(/^\(\s*(\d+)\s+hours?\b/i);
    const coursesMatch = body.match(/^\(\s*(\d+)\s+cours\w*/i);
    let hours = hoursMatch ? Number.parseInt(hoursMatch[1], 10) : null;
    let courses = coursesMatch ? Number.parseInt(coursesMatch[1], 10) : null;
    let sizeFromCampus = false;
    if (hours === null && courses === null) {
      const campus = GENED_CAMPUS_SIZE[key];
      // A heading with no size on the page and none in the campus table is not
      // something this can size. Left out, so it stays in the unparsed text a
      // human reads rather than becoming a number nobody published.
      if (!campus) continue;
      hours = campus.hours;
      courses = campus.courses;
      sizeFromCampus = true;
    }

    /**
     * Every course code in the category's own text, when that text says the
     * category is fulfilled.
     *
     * Taken from the whole body rather than from after the word, because the
     * page writes the fulfilment both ways round: "fulfilled by CHEM 102,
     * CHEM 104, and MCB 100" and "(CHLH 304 fulfills requirement)". A gen-ed
     * category's text names course codes for no other reason.
     */
    const fulfils = FULFILLED.test(body);
    rules.push({
      label,
      genEd: GENED_MAP[key] ?? [],
      hours,
      courses,
      sizeFromCampus,
      fulfilledBy: fulfils ? fulfilledByOptions(body) : [],
      partial: fulfils ? PARTIAL_FULFILMENT.test(body) : false,
      text: `${label}${body ? ` ${body}` : ''}`.trim(),
    });
  }

  return rules;
}

/**
 * What is left of a gen-ed table once every campus category has been cut out.
 *
 * Almost always the language requirement, which is a real graduation rule the
 * planner cannot check: whether a student owes it depends on their high school
 * transcript. Returning it means the plan quotes the sentence instead of
 * dropping it, and returning '' when nothing is left means no empty review row.
 */
function genEdLeftover(source: string, rules: GenEdCategoryRule[]): string {
  let rest = source.replace(/\s+/g, ' ').trim();
  for (const rule of rules) rest = rest.replace(rule.text, ' ');
  rest = rest.replace(/\s+/g, ' ').trim();
  // Punctuation and a stray bracket are not a requirement anybody can read.
  return /[a-z]{4}/i.test(rest) ? rest : '';
}

/**
 * The courses a "fulfilled by" clause names, grouped the way the page groups
 * them.
 *
 * A semicolon is the page's top-level separator. Inside one of its segments,
 * the presence of "or" anywhere makes the whole segment a menu: Animal Sciences
 * writes "fulfilled by MATH 220 , MATH 221 , or MATH 234" and those three are
 * one calculus slot, not three courses. A segment with no "or" is a list of
 * separate courses: "fulfilled by PHYS 211 and PHYS 212" is both of them.
 *
 * Reading the first shape as three separate courses is what would put two
 * alternative calculus courses in the same plan.
 */
function fulfilledByOptions(clause: string): string[][] {
  const options: string[][] = [];
  const codesOf = (part: string): string[] => {
    CODE_RE.lastIndex = 0;
    return [...part.matchAll(CODE_RE)].map((m) => `${m[1]} ${m[2]}`);
  };

  for (const segment of clause.split(/;/)) {
    if (/\bor\b/i.test(segment)) {
      const alternatives = codesOf(segment);
      if (alternatives.length > 0) options.push(alternatives);
      continue;
    }
    for (const piece of segment.split(/,|\band\b|&/i)) {
      const codes = codesOf(piece);
      if (codes.length > 0) options.push(codes);
    }
  }
  return options;
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
/**
 * A subtotal row: "Total Hours", "Total", "Minimum Total Hours", "Total
 * Concentration Hours", "Total Hours of Curriculum to Graduate". Only ever a
 * group with no course rows, which is what keeps this broad match safe. The
 * old pattern took "Total Hours" alone, so the eleven "Minimum Total Hours"
 * rows became requirements the plan could not fill and reported as such.
 */
const TOTAL_ROW = /^(?:minimum\s+)?total\b/i;
const DEGREE_TOTAL_ROW = /\b(?:to graduate|curriculum|for graduation|for (?:the )?degree|degree hours)\b/i;

/**
 * A rule that names a count and a level rather than courses.
 *
 * "Four additional full-semester, 3 hour 400 level-Finance courses except FIN
 * 494 or FIN 495" is a real requirement, twelve hours of a Finance degree, and
 * it names no course the page could list. Fifty-two degree pages carry a
 * sentence of this shape. Read literally the sentence was quoted back as
 * something the planner could not act on; read this way it is a pool over
 * every catalog course in that subject at that level, which is what the
 * sentence means.
 *
 * Nothing is built unless the sentence states all three of a size (a count
 * or hours), a level, and a subject. A sentence missing any of them is left
 * as the quotation it was.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const LEVEL_SENTENCE = /\b[1-4]00\s*-?\s*(?:or|to|and|\/|,)?\s*(?:[1-4]00\s*-?\s*)?level\b/i;
/** A sentence about what may not count, which is not a sentence about what is required. */
const CAP_SENTENCE = /\b(?:maximum of|no more than|not more than|at most|up to a maximum|may not exceed|not receive credit|cannot count|will not count)\b/i;

export interface LevelRule {
  n: number | null;
  hours: number | null;
  levels: number[];
  subjects: string[];
  excluded: string[];
  minCredits: number;
  sentence: string;
  additional: boolean;
}

export function levelRuleIn(text: string, fallbackHours: number | null = null): LevelRule | null {
  // An aside in parentheses is an aside: "(Though students must take a total
  // of 6 courses, some may count toward...)" is not a second count. Stripped
  // before the text is cut into sentences, because an aside can run across a
  // full stop and an unclosed one is cut at the sentence's end.
  const clean = (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\(([^()]{13,})\)/g, ' ')
    .trim();
  if (!clean) return null;
  for (const raw of clean.split(/(?<=\.)\s+/)) {
    // A cap is not a requirement: "maximum of 4 credit hours of ASTR 100-level
    // can count" limits what counts, and "will not receive credit" denies it.
    if (CAP_SENTENCE.test(raw)) continue;
    const sentence = raw.replace(/\([^()]{13,}$/, ' ');
    const levelAt = sentence.search(LEVEL_SENTENCE);
    if (levelAt < 0) continue;
    // "200-400 level" and "300- to 400-level" are ranges; "300 or 400 level" is two.
    const levels = new Set<number>();
    const range = sentence.match(/\b([1-4])00\s*-?\s*(?:to|through|-)\s*-?\s*([1-4])00\b/i);
    if (range) {
      for (let l = Number(range[1]); l <= Number(range[2]); l += 1) levels.add(l * 100);
    } else {
      for (const m of sentence.matchAll(/\b([1-4])00\b/g)) levels.add(Number(m[1]) * 100);
    }
    if (levels.size === 0) continue;

    /**
     * The size, taken from the phrase nearest the level. A sentence that
     * states two counts ("Select three of the following four courses. At
     * least 3 additional hours of 300-level...") or two hour totals is two
     * rules run together, and reading one number out of it is a coin toss,
     * so it is left as the quotation it was.
     */
    const hourMatches = [
      ...sentence.matchAll(
        /\b(?:(?:select|choose|take|at least|(?:a )?minimum of|additional)\s+(?:an?\s+)?(?:additional\s+)?)?(\d{1,2})(?:\s*-\s*\d{1,2})?\s+(?:additional\s+)?(?:credit\s+)?hours\b(?=\s*(?:of|from|in|at|minimum|total|[,.;)]|$))/gi,
      ),
    ];
    const countMatches = [
      ...sentence.matchAll(
        /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+(?:additional\s+)?(?:[\w,()-]+\s+){0,7}?(?:courses?|electives?|classes)\b/gi,
      ),
      // "3 hour 400 level" inside a count is the credit each course carries;
      // only a plural "hours" makes the phrase a total rather than a count.
    ].filter((m) => !/\bhours\b/i.test(m[0]));
    if (hourMatches.length > 1 || countMatches.length > 1) continue;
    let hours: number | null = hourMatches[0] ? Number(hourMatches[0][1]) : null;
    let n: number | null = countMatches[0] ? (NUMBER_WORDS[countMatches[0][1].toLowerCase()] ?? Number(countMatches[0][1])) : null;
    if (hours !== null && n !== null) {
      const hoursGap = Math.abs((hourMatches[0].index ?? 0) - levelAt);
      const countGap = Math.abs((countMatches[0].index ?? 0) - levelAt);
      if (hoursGap <= countGap) n = null;
      else hours = null;
    }
    if (n === null && hours === null) {
      if (fallbackHours === null) continue;
      hours = fallbackHours;
    }

    // "3 hour 400 level" is the credit each course carries, not a total.
    const each = sentence.match(/\b(\d)[- ]hour\b(?!s)/i);
    const minCredits = each ? Number(each[1]) : 1;

    const excluded = new Set<string>();
    const exceptAt = sentence.search(/\b(?:except|excluding|excluded courses?:?|other than|not including)\b/i);
    if (exceptAt >= 0) {
      for (const m of sentence.slice(exceptAt).matchAll(/\b([A-Z]{2,4})\s?(\d{3})\b/g)) excluded.add(`${m[1]} ${m[2]}`);
    }

    const subjects = new Set<string>();
    /**
     * The subject is read near the level, not anywhere in the sentence. A
     * Computer Science note mentions "100-level" in one clause and
     * "Engineering" three clauses later, and reading the whole sentence made
     * that a rule about 100-level engineering courses. The window runs from
     * just before the size phrase to well past the level, which is where every
     * real sentence of this shape names its subject.
     */
    const sizeAt = Math.min(hourMatches[0]?.index ?? levelAt, countMatches[0]?.index ?? levelAt, levelAt);
    const windowEnd = Math.min(exceptAt >= 0 ? exceptAt : sentence.length, levelAt + 170);
    const body = sentence.slice(Math.max(0, sizeAt - 24), windowEnd);
    // Prefixes written as such: "AGCM", "CPSC/HORT/PLPA", "ChBE". Two capitals
    // at least, so "Art" in "Art History" is a word and not the ART prefix. A
    // token that is a course code names an exclusion or an example.
    for (const m of body.matchAll(/\b([A-Za-z]{2,4})\b(?!\s?\d{3})/g)) {
      const token = m[1];
      if ((token.match(/[A-Z]/g) ?? []).length < 2) continue;
      const upper = token.toUpperCase();
      if (ILLINOIS_SUBJECT_NAMES[upper] !== undefined) subjects.add(upper);
    }
    // Subjects written out: "Finance", "Art History". The catalog spells some
    // with double dashes ("Art--History"), so both sides are read with dashes
    // as spaces. Longest name first, and a name inside a longer one that
    // already matched is that longer name's: "History" in "Art History" is
    // not HIST.
    // Only where the page uses the name as a department's: capitalised
    // ("Finance", "Art History") or right before "courses" ("economics
    // courses"). Lowercase "engineering, or biological aspects" is an adjective,
    // and reading it as ENG made a chemistry rule about engineering.
    const plain = (s: string) => s.replace(/-+/g, ' ').replace(/\s+/g, ' ');
    const body1 = plain(body);
    const lower = body1.toLowerCase();
    const named = Object.entries(ILLINOIS_SUBJECT_NAMES)
      .map(([prefix, name]) => [prefix, plain(name).toLowerCase()] as const)
      .filter(([, name]) => {
        if (name.length < 5) return false;
        const at = lower.indexOf(name);
        if (at < 0) return false;
        if (/[A-Z]/.test(body1.charAt(at))) return true;
        return /^\s+(?:courses?|electives?|coursework|classes)\b/.test(lower.slice(at + name.length));
      })
      .sort((a, b) => b[1].length - a[1].length);
    const accepted: string[] = [];
    for (const [prefix, name] of named) {
      if (accepted.some((longer) => longer.includes(name))) continue;
      accepted.push(name);
      subjects.add(prefix);
      if (accepted.length >= 3) break;
    }
    if (subjects.size === 0) continue;

    return {
      n,
      hours,
      levels: [...levels].sort((a, b) => a - b),
      subjects: [...subjects].sort(),
      excluded: [...excluded],
      minCredits,
      sentence: sentence.trim(),
      additional: /\b(?:additional|more|further|other)\b/i.test(sentence),
    };
  }
  return null;
}

/** The pool a level rule names, read out of the catalog. Null without a catalog to read. */
function levelPoolChoices(
  rule: LevelRule,
  byCode: CatalogRowLookup,
  alreadyNamed: Set<string>,
): CourseChoice[] | null {
  if (typeof byCode.values !== 'function') return null;
  const levels = new Set(rule.levels);
  const subjects = new Set(rule.subjects);
  const excluded = new Set(rule.excluded.map(normCode));
  const out: CourseChoice[] = [];
  for (const row of byCode.values()) {
    const code = normCode(row.code);
    const subject = row.cluster ?? code.split(' ')[0];
    if (!subjects.has(subject)) continue;
    const number = Number(code.split(' ')[1] ?? '');
    if (!levels.has(Math.floor(number / 100) * 100)) continue;
    if (excluded.has(code) || alreadyNamed.has(code)) continue;
    if ((row.credits ?? 0) < rule.minCredits) continue;
    out.push({ codes: [code], title: row.title, credits: row.credits, creditsMax: row.creditsMax ?? null, substitutes: [] });
  }
  out.sort((a, b) => a.codes[0].localeCompare(b.codes[0]));
  return out.length > 0 ? out : null;
}

function levelPoolLabel(rule: LevelRule): string {
  const size = rule.n !== null ? `${rule.n} additional` : `${rule.hours} hours of`;
  return `${size} ${rule.levels.join(' or ')}-level ${rule.subjects.join('/')} courses`;
}

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
  /**
   * Every catalog row, for a rule that names a subject and a level rather
   * than courses: "Four additional 400-level Finance courses" is a list the
   * page never prints, so it has to be read out of the catalog. A Map has
   * this; a lookup that does not cannot build such a rule and skips it.
   */
  values?(): Iterable<{ code: string; title: string; credits: number; creditsMax?: number | null; cluster?: string }>;
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
  /**
   * Set when one group yields more than one block, so the ids stay distinct.
   *
   * The gen-ed table is one group holding nine campus categories. Without this
   * all nine would be `${program}::${area}::0` and a saved plan pointing at one
   * of them would point at all of them.
   */
  idSuffix?: string;
}

export interface AreaRules {
  blocks: AreaRuleBlock[];
  droppedRows: number;
  droppedTotalRows: number;
  pools: number;
  /**
   * The hours the page states for the whole area, from its own heading or
   * from the subtotal row at the foot of its table. Business Core prints
   * "Minimum Total Hours 57" under rows that add to 48, and the rail read 48
   * of 48 with nine hours of the requirement invisible.
   */
  areaHours: number | null;
}

const SUBSTITUTE_WORDING =
  /substitut|may be taken (?:instead|in place)|in place of|in lieu of|instead of|accepted (?:in place|for|as)/i;

/** One catalog row, with its "or" siblings folded into a single slot. */
/** Catalog titles by subject, lower-cased, built once per lookup. */
const titleIndexCache = new WeakMap<object, Map<string, Map<string, string>>>();

function titleIndex(byCode: CatalogRowLookup): Map<string, Map<string, string>> | null {
  if (!byCode.values) return null;
  const cached = titleIndexCache.get(byCode);
  if (cached) return cached;
  const index = new Map<string, Map<string, string>>();
  for (const course of byCode.values()) {
    const code = normCode(course.code);
    const subject = code.split(' ')[0];
    const titles = index.get(subject) ?? new Map<string, string>();
    titles.set(course.title.trim().toLowerCase(), code);
    index.set(subject, titles);
  }
  titleIndexCache.set(byCode, index);
  return index;
}

/**
 * The courses of a row the crawl collapsed to its first code.
 *
 * Such a row has no hours of its own and a title that is several catalog
 * titles joined by "and": "General Chemistry I and General Chemistry Lab I and
 * General Chemistry II and General Chemistry Lab II". It is rebuilt only when
 * every piece is, word for word, the title of a course in the row's subject and
 * the first is the row's own code; a title that merely contains "and" ("Plant
 * Diversity and Evolution") matches one course and is left alone.
 *
 * A row that prints its hours is rebuilt too when those hours are exactly the
 * pieces' catalog hours added up. The Gies business core prints "ECON 102
 * Microeconomic Principles and Macroeconomic Principles (6)", and reading only
 * ECON 102 left ECON 103, ACCY 202 and BADM 211 off every business plan: a
 * Finance student's re-pick then swapped ECON 103, which looked like a free
 * gen-ed pick, for an education course. 134 rows in 92 degrees read this way,
 * most of them chemistry and anatomy labs; every one adds up.
 */
function bundleOf(row: RawProgramCourse, byCode: CatalogRowLookup): string[] | null {
  const title = (row.title ?? '').trim();
  if (!/ and /.test(title)) return null;
  const code = normCode(row.code);
  const titles = titleIndex(byCode)?.get(code.split(' ')[0]);
  if (!titles) return null;
  const parts = title.split(' and ');
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    let found: { next: number; code: string } | null = null;
    for (let j = parts.length; j > i; j -= 1) {
      const hit = titles.get(parts.slice(i, j).join(' and ').trim().toLowerCase());
      if (hit) {
        found = { next: j, code: hit };
        break;
      }
    }
    if (!found) return null;
    out.push(found.code);
    i = found.next;
  }
  if (out.length < 2 || out[0] !== code) return null;
  // The LAS first-year seminars are one course chosen by who the student is
  // (LAS 100 for international students, LAS 101, LAS 102 for transfers), so
  // "LAS 100 ... and LAS 101 ... (3)" is a choice, not a pair to take.
  if (out.some((c) => /^LAS 10\d$/.test(c))) return null;
  if (row.credits !== null && row.credits !== undefined) {
    const sum = out.reduce((n, c) => n + (byCode.get(c)?.credits ?? 0), 0);
    if (sum !== row.credits) return null;
  }
  return out;
}

function choicesFrom(rows: RawProgramCourse[], byCode: CatalogRowLookup, note = ''): CourseChoice[] {
  const plain = plainChoicesFrom(rows, byCode);
  /**
   * "Select one group of courses": the sets the page offers side by side are
   * one choice. A run of consecutive sets in one subject is merged; a set on
   * its own stays a row of several courses.
   */
  const either = /\bone group\b/i.test(note);
  const out: CourseChoice[] = [];
  for (const choice of plain) {
    const last = out[out.length - 1];
    const subject = (c: CourseChoice) => normCode(c.codes[0]).split(' ')[0];
    if (either && choice.bundles && last?.bundles && subject(last) === subject(choice)) {
      out[out.length - 1] = {
        ...last,
        codes: [...last.codes, ...choice.codes],
        bundles: [...last.bundles, ...choice.bundles],
      };
      continue;
    }
    out.push(choice);
  }
  return out;
}

function plainChoicesFrom(rows: RawProgramCourse[], byCode: CatalogRowLookup): CourseChoice[] {
  /**
   * One catalog row is one CourseChoice, with its orclass siblings folded in.
   * MATH 257 with orclass MATH 415 and orclass MATH 416 is a single linear
   * algebra slot with three options, and splitting it into three rows would
   * inflate the degree and make the plan unsatisfiable.
   */
  return rows.map((row) => {
    const codes = [row.code, ...(row.or ?? [])].map(normCode);
    const catalogCourse = byCode.get(codes[0]);
    // The footnote the page prints inside the title is where the substitution
    // lives: 31 rows say "may be substituted", 14 "may be taken instead".
    const footnote = row.title ?? '';
    const substitutes = SUBSTITUTE_WORDING.test(footnote)
      ? [...new Set((footnote.match(/\b[A-Z]{2,4}\s?\d{3}\b/g) ?? []).map(normCode))].filter(
          (code) => !codes.includes(code) && byCode.get(code) !== undefined,
        )
      : [];
    const bundle = bundleOf(row, byCode);
    if (bundle) {
      return {
        codes: [bundle[0]],
        title: bundle.map((code) => byCode.get(code)?.title ?? code).join(', '),
        credits: bundle.reduce((sum, code) => sum + (byCode.get(code)?.credits ?? 0), 0),
        creditsMax: null,
        substitutes: [],
        bundles: [bundle],
      };
    }
    return {
      codes,
      // The program file's title field is never a course title: it is either
      // the code echoed back or a footnote blob. The catalog is the only place
      // a real title exists.
      title: catalogCourse?.title ?? codes[0],
      credits: catalogCourse?.credits ?? row.credits,
      creditsMax: catalogCourse?.creditsMax ?? null,
      substitutes,
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
    // Kinesiology prints its "Total Hours" row with the words in the note and
    // no label, and read that way it became a requirement with no name.
    const total = rows.length === 0 && (TOTAL_ROW.test(label.trim()) || (!label.trim() && TOTAL_ROW.test((group.note ?? '').trim())));
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

  // Every course the area names anywhere, so an "additional" rule does not
  // hand back the courses printed above it.
  const namedInArea = new Set<string>();
  for (const r of read) for (const row of r.rows) namedInArea.add(normCode(row.code));
  const levelBlockFor = (r: AreaGroupRead, requireAdditional: boolean): AreaRuleBlock | null => {
    // A courseless row's own hours size a sentence that names none:
    // "Additional Advanced (300- or 400-level) PSYC or BCOG Courses", 9 hours.
    const rule = levelRuleIn([r.label, r.group.note ?? ''].filter(Boolean).join(' '), r.rows.length === 0 ? r.ownHours : null);
    if (!rule || (requireAdditional && !rule.additional)) return null;
    const choices = levelPoolChoices(rule, byCode, namedInArea);
    if (!choices) return null;
    const label = levelPoolLabel(rule);
    return {
      groupIndex: r.index,
      idSuffix: 'level',
      label,
      hours: rule.hours,
      note: rule.sentence,
      rule: {
        kind: 'pool',
        hours: rule.hours,
        n: rule.n,
        choices,
        lists: [{ label, codes: choices.flatMap((c) => c.codes) }],
        constraints: [],
        from: 'group',
        label,
      },
      rows: 0,
    };
  };

  const merged =
    caplessPools.length > 0 ? mergeAreaPool(area, read, caplessPools, byCode, areaBudget) : null;
  if (merged) {
    for (const index of merged.consumed) consumed.add(index);
    blocks.push(merged.block);
    pools += 1;
  }

  for (const r of read) {
    if (consumed.has(r.index) || r.isTotal) continue;

    /**
     * The campus gen-ed table, read only for a group that has no course rows.
     *
     * A group with rows has its own courses and is a normal requirement, even
     * when its comment happens to mention a gen-ed category. Reading the table
     * out of that comment would replace a list of real courses with a category
     * heading.
     */
    const genEdSource =
      r.rows.length === 0 ? [r.label, r.group.note ?? ''].filter(Boolean).join(' ') : '';
    const genEd = genEdSource ? genEdRulesFromText(genEdSource) : [];

    /**
     * A courseless group whose sentence names a count, a level and a subject
     * is a pool over the catalog, not an hours block nobody can fill. Checked
     * before the hours branch, which is where "Additional Advanced (300- or
     * 400-level) PSYC or BCOG Courses" used to land.
     */
    if (r.rows.length === 0) {
      const level = levelBlockFor(r, false);
      if (level) {
        blocks.push(level);
        pools += 1;
        continue;
      }
    }

    let rule: RequirementRule;
    if (r.rows.length > 0) {
      const choices = choicesFrom(r.rows, byCode, [r.label, r.group.note ?? ''].join(' '));
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
      const note = r.group.note ?? '';
      rule = {
        kind: 'hours',
        hours: r.ownHours,
        genEd: genEdForLabel(r.label) ?? genEdInNote(note),
        label: r.label,
        minLevel: levelFloorIn(r.label, note),
        exclude: exceptionsIn(note),
      };
    } else if (genEd.length > 0) {
      /**
       * The campus general education table, one block per category.
       *
       * This is checked before the unparsed branch because that is where the
       * whole table used to land: the crawler flattens it into one note with no
       * per-row label, the group arrives with no rows and no hours, and the
       * planner booked nothing at all for it across 227 degrees. The text of
       * each category is still carried verbatim on its own block, so nothing
       * that used to be quotable stopped being quotable.
       */
      for (const [ri, category] of genEd.entries()) {
        blocks.push({
          groupIndex: r.index,
          idSuffix: `ge${ri}`,
          label: category.label,
          // Only hours the PAGE states count toward the degree total measured
          // off these blocks, and only where the page has not just said the
          // category is already covered. Counting either would add hours the
          // degree does not have on top of courses it already counts.
          hours: category.sizeFromCampus || category.fulfilledBy.length > 0 ? null : category.hours,
          note: category.text,
          rule: {
            kind: 'gened',
            genEd: category.genEd,
            hours: category.hours,
            courses: category.courses,
            fulfilledBy: category.fulfilledBy,
            // Only the Cultural Studies categories exclude each other ("no single
            // course can fulfill multiple Cultural Studies categories",
            // gened.illinois.edu/requirements/). Every other category is its own
            // ledger: PHYS 211 counts for Natural Sciences and Quantitative
            // Reasoning II at once, and Grainger's advising page says Advanced
            // Composition courses can count for social sciences and humanities
            // too. One shared ledger made the plan book a second course for a
            // category the first already met.
            //
            // A category a degree restates in its own requirement ("Life &
            // Physical Science Requirement: a Life Science and a Physical
            // Science course"), rather than in the campus table, is the same
            // requirement said twice, and the campus table says so ("Natural
            // Sciences & Technology (6 hours) fulfilled by Life Science &
            // Physical Science Requirement"). It keeps a ledger of its own so
            // the same courses count for both: sharing one made Elementary
            // Education book PLPA 200 and CHEM 108 on top of held chemistry
            // and biology.
            exclusiveGroup: category.genEd.every((g) => g.startsWith('Cultural Studies'))
              ? 'cultural-studies'
              : genEd.length < 3
                ? `category:${category.label}#${r.index}`
                : `category:${category.label}`,
            sizeFromCampus: category.sizeFromCampus,
            text: category.text,
            label: category.label,
          },
          rows: 0,
        });
      }
      /**
       * Whatever the table says that is not a campus category, still quoted.
       *
       * The language requirement is the one that matters: "Completion of the
       * third semester or equivalent of a language other than English is
       * required" is a real graduation requirement, it depends on what the
       * student did in high school, and this planner has no way to check it.
       * Dropping it silently would be the plan pretending it is not there.
       */
      const leftoverAll = genEdLeftover(genEdSource, genEd);
      const split = leftoverAll ? splitLanguageRequirement(leftoverAll) : { language: null, rest: '' };
      if (split.language) {
        blocks.push({
          groupIndex: r.index,
          idSuffix: 'ge-language',
          label: 'Language other than English',
          hours: null,
          note: split.language.text,
          rule: { kind: 'language', semesters: split.language.semesters, text: split.language.text },
          rows: 0,
        });
      }
      const leftover = split.rest;
      if (leftover) {
        blocks.push({
          groupIndex: r.index,
          idSuffix: 'ge-rest',
          label: r.label,
          hours: null,
          note: r.group.note ?? '',
          rule: { kind: 'unparsed', text: leftover },
          rows: 0,
        });
      }
      continue;
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
      const split = splitLanguageRequirement(text);
      if (split.language) {
        blocks.push({
          groupIndex: r.index,
          idSuffix: 'language',
          label: 'Language other than English',
          hours: null,
          note: split.language.text,
          rule: { kind: 'language', semesters: split.language.semesters, text: split.language.text },
          rows: 0,
        });
        if (!split.rest) continue;
        rule = { kind: 'unparsed', text: split.rest };
      } else {
        rule = { kind: 'unparsed', text };
      }
    }

    blocks.push({
      groupIndex: r.index,
      label: r.label,
      hours: r.group.hours ?? null,
      note: r.group.note ?? '',
      rule,
      rows: r.rows.length,
    });

    /**
     * A group with rows whose comment asks for more: "Four additional ... 400
     * level-Finance courses" printed under three named FIN courses. The rows
     * are the requirement they always were, and the sentence is a second one.
     */
    if (r.rows.length > 0) {
      const level = levelBlockFor(r, true);
      if (level) {
        blocks.push(level);
        pools += 1;
      }
    }
  }

  blocks.sort((a, b) => a.groupIndex - b.groupIndex);
  return { blocks, droppedRows, droppedTotalRows, pools, areaHours: areaBudget };
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

/**
 * The campus General Education table, for a degree page that does not print it.
 *
 * Thirty-nine degree pages have no table: Computer and Electrical
 * Engineering, English, History, every Political Science track, Geology,
 * Information Sciences among them. Their students take the same campus
 * requirements as everyone else, and a plan read off the page alone booked no
 * Composition I, no Humanities, no Cultural Studies and no language, which is
 * twenty-odd hours short of a degree while the rail said everything was met.
 *
 * The words are the table as 227 other pages print it, in the same order, so
 * the one parser reads both. The language clause is the college's own: LAS
 * BALAS and BSLAS pages say the fourth semester, or the third in two
 * languages; every other college, and the LAS BS pages, say the third. Read
 * from the crawled pages on 24 September 2026. No "fulfilled by" is added:
 * that is a degree's own statement, and these pages make none.
 */
export const CAMPUS_GENED_AREA_LABEL = 'General Education Requirements (campus)';

function campusGenEdNote(raw: RawIllinoisProgram): string {
  const las4 = raw.college === 'las' && /\b(BALAS|BSLAS)\b/.test(`${raw.degree} ${raw.name}`);
  const language = las4
    ? 'Completion of the fourth semester or equivalent of a language other than English, or completion of the third semester in two different languages other than English is required'
    : 'Completion of the third semester or equivalent of a language other than English is required';
  return 'Composition I Advanced Composition Humanities & the Arts (6 hours) Natural Sciences & Technology (6 hours) '
    + 'Social & Behavioral Sciences (6 hours) Cultural Studies: Non-Western Cultures (1 course) '
    + 'Cultural Studies: US Minority Cultures (1 course) Cultural Studies: Western/Comparative Cultures (1 course) '
    + 'Quantitative Reasoning (2 courses, at least one course must be Quantitative Reasoning I) '
    + `Language Requirement (${language})`;
}

/**
 * The program with the campus table appended when its page has none.
 *
 * Appended after the page's own areas, so every block id the page already
 * produced is unchanged and a saved plan still points where it did.
 */
export function withCampusGenEd(raw: RawIllinoisProgram): RawIllinoisProgram {
  const areas = raw.areas ?? [];
  const hasTable = areas.some((area) =>
    area.groups.some((group) => (group.courses?.length ?? 0) === 0 && genEdRulesFromText([group.label, group.note ?? ''].filter(Boolean).join(' ')).length > 0),
  );
  if (hasTable) return raw;
  const area: RawProgramArea = {
    label: CAMPUS_GENED_AREA_LABEL,
    hours: null,
    hoursFrom: null,
    chooseCourses: null,
    groups: [{ label: '', choose: null, courses: [], note: campusGenEdNote(raw), summedCredits: 0, kind: 'unknown' }],
  };
  return { ...raw, areas: [...areas, area] };
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
  programsWithGenEd: number;
  genEdCategories: number;
  genEdCategoriesFromCampus: number;
} {
  const programs: ProgramRequirements[] = [];
  const defs: IllinoisProgramDefinition[] = [];
  const blocks = new Map<string, RequirementBlock[]>();
  let dropped = 0;
  let droppedTotalRows = 0;
  let poolGroups = 0;
  let implausibleTotals = 0;
  let programsWithGenEd = 0;
  let genEdCategories = 0;
  let genEdCategoriesFromCampus = 0;

  /**
   * The courses that carry one campus general education category, built once.
   *
   * A category is the same list of courses on every degree page that names it,
   * so the same array is handed to each of them. The crawled corpus holds 2,380
   * of these groups and only 9 distinct lists behind them. Rebuilding the list
   * per program would put 365,594 duplicate row objects in the browser for no
   * gain.
   */
  const genEdMembers = new Map<string, RequirementRow[]>();
  const genEdMembersFor = (genEd: string[]): RequirementRow[] => {
    const key = [...genEd].sort().join('|');
    const cached = genEdMembers.get(key);
    if (cached) return cached;
    const wanted = new Set(genEd);
    const rows: RequirementRow[] = [];
    for (const course of byCode.values()) {
      if (!course.tags.some((tag) => wanted.has(tag))) continue;
      rows.push({ code: normCode(course.code), title: course.title, credits: course.credits ?? 0 });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));
    genEdMembers.set(key, rows);
    return rows;
  };

  for (const crawled of file.programs ?? []) {
    if (!crawled?.id) continue;
    const raw = withCampusGenEd(crawled);

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

      const rules = byArea[ai] ?? { blocks: [], droppedRows: 0, droppedTotalRows: 0, pools: 0, areaHours: null };
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
          // has not changed. The suffix is only present where one group yields
          // several blocks, which today is the gen-ed table and nothing else.
          id: `${raw.id}::${ai}::${block.groupIndex}${block.idSuffix ? `::${block.idSuffix}` : ''}`,
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
              code: normCode(c.codes[0]),
              title: c.title,
              // Zero when the catalog has no credit line for the course. It
              // understates progress, which is the safe direction: the other
              // way tells a student they have graduated.
              credits: c.credits ?? 0,
              // "CS 210 or CS 211" is one row of the degree page and either
              // course satisfies it. Each alternative is priced from the
              // catalog, because CS 210 is two hours and CS 211 is three.
              alternatives: [...c.codes.slice(1), ...(c.substitutes ?? [])].map((code) => ({
                code: normCode(code),
                credits: byCode.get(normCode(code))?.credits ?? c.credits ?? 0,
              })),
            })),
          });
        }

        /**
         * A campus general education category, so the area can show progress.
         *
         * Without this the nine gen-ed blocks on a degree page never reached
         * areaProgress and the row read "0 hr" on every Illinois degree while
         * RHET 105, CWL 207, GER 261, SHS 222 and AAS 246 sat on the board
         * satisfying it. Membership is the catalog's own gen-ed tagging, and
         * the cap is the size the degree page or the campus table states, so
         * four humanities courses still count as the six hours the category
         * asks for and not as twelve.
         *
         * The area keeps whatever hour total the degree page prints for it,
         * which for 292 of the 295 areas holding a gen-ed table is none. Adding
         * the categories up would leave out the ones sized in courses and
         * produce a total no page states, and a student reading "12 of 12"
         * would think they were finished with three Cultural Studies categories
         * still open.
         */
        if (rule.kind === 'gened' && rule.genEd.length > 0) {
          schedulerGroups.push({
            label,
            choose: rule.courses,
            courses: genEdMembersFor(rule.genEd),
            cap: { hours: rule.hours, courses: rule.courses },
            broad: true,
          });
        }
      }

      // The area's own subtotal row counts as its size where the heading
      // prints none, so Business Core reads 48 of 57 rather than 48 of 48.
      areas.push({ label: area.label, hours: area.hours ?? rules.areaHours ?? 0, groups: schedulerGroups });
      requirements.push({
        id: areaId,
        label: area.label,
        targetCredits: area.hours ?? rules.areaHours ?? 0,
        description: area.groups?.find((g) => g.note)?.note ?? '',
      });
    });

    let totalCredits = raw.totalCredits;
    if (totalCredits !== null && totalCredits < MIN_PLAUSIBLE_DEGREE_CREDITS) {
      implausibleTotals += 1;
      totalCredits = null;
    }

    const genEdHere = programBlocks.filter((b) => b.rule.kind === 'gened');
    if (genEdHere.length > 0) programsWithGenEd += 1;
    genEdCategories += genEdHere.length;
    genEdCategoriesFromCampus += genEdHere.filter(
      (b) => b.rule.kind === 'gened' && b.rule.sizeFromCampus,
    ).length;

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

  return {
    programs,
    defs,
    blocks,
    dropped,
    droppedTotalRows,
    poolGroups,
    implausibleTotals,
    programsWithGenEd,
    genEdCategories,
    genEdCategoriesFromCampus,
  };
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
    if (block.rule.kind === 'gened') {
      // The courses the page itself names as covering the category ARE required
      // by this degree, and it says so. Everything else carrying the category
      // is one of hundreds of ways to satisfy it, so it gets the area and no
      // role, the same as the hours block below.
      for (const option of block.rule.fulfilledBy) {
        for (const code of option) {
          const course = byAlias.get(normCode(code));
          if (course) add(course, block.areaId, option.length === 1 ? 'required' : 'choice');
        }
      }
      const wantedGenEd = new Set(block.rule.genEd);
      for (const course of courses) {
        const tags = facts.get(normCode(course.code))?.genEd ?? [];
        if (tags.some((t) => wantedGenEd.has(t))) add(course, block.areaId);
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
  /**
   * The bands describe the courses this index holds, not the whole grade file.
   *
   * 675 of the 2,968 published grade rows belong to courses the planner never
   * shows: graduate courses, and 104 rows whose code is not in the catalog at
   * all. Leaving them in moved all three cut points down, and the panel's
   * "easiest quarter" then covered the easiest fifth of what a student can
   * actually take. Filtering to byCode keeps the bands and the course list
   * describing the same population, whichever population that is.
   */
  const bands = computeDifficultyBands(
    gradeRows.filter((row) => row?.code && byCode.has(normCode(row.code))),
  );
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
        programsWithGenEd: 0,
        genEdCategories: 0,
        genEdCategoriesFromCampus: 0,
      };

  for (const programBlocks of adaptedPrograms.blocks.values()) {
    attachRequirementIds(courses, programBlocks, facts);
  }

  // ---- coverage ----
  let withParsedPrereq = 0;
  let withLowConfidencePrereq = 0;
  let withPrereqTextOnly = 0;
  let withPrereqNoteOnly = 0;
  let withStandingRequirement = 0;
  let variableCredit = 0;
  let unknownCredit = 0;
  let withGrades = 0;
  let withSections = 0;

  for (const course of courses) {
    const fact = facts.get(normCode(course.code));
    if (!fact) continue;
    if (fact.prereq?.standing) withStandingRequirement += 1;
    if (fact.prereq?.parsed) {
      withParsedPrereq += 1;
      if (fact.prereq.confidence === 'low') withLowConfidencePrereq += 1;
    } else if (fact.prereq && fact.prereq.note.length > 0) {
      // Checked before the text branch because a note-only spec puts the note
      // in `text` as well, so that every surface printing `text` shows it.
      withPrereqNoteOnly += 1;
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
    withPrereqNoteOnly,
    withStandingRequirement,
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
    programsWithGenEd: adaptedPrograms.programsWithGenEd,
    genEdCategories: adaptedPrograms.genEdCategories,
    genEdCategoriesFromCampus: adaptedPrograms.genEdCategoriesFromCampus,
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
