import type { Course, PlanIssue, PlanState, PlanTerm, SemesterSeason } from './types';
import { termLoad, type GradeRow } from './scheduler';
import { ILLINOIS_SUBJECT_NAMES } from './illinois-subjects';
import { interestProfile, type InterestProfile } from './career-tracks';
import type { Priorities } from './priorities';
import { interestWordsFrom, scoreQuality, type ExcellentSummary, type QualityInputs, type QualityResult } from './quality';
import { DEFAULT_PRIORITIES } from './priorities';

/**
 * The deterministic half of the planner: build a four-year plan, and check one.
 *
 * Nothing in this file asks a model anything. An LLM can explain a plan that
 * came out of here, or read a student's description of their situation and
 * fill in the inputs, but it never decides whether somebody graduates. That is
 * the boundary the project draws and this file is the side of it that has to
 * be auditable line by line.
 *
 * Two entry points:
 *   generatePlan   requirements + prior credit + a graduation term -> terms
 *   validatePlan   a plan the student edited by hand -> PlanIssue[]
 *
 * The rule that shapes every function below: a plan that hides what it could
 * not do is worse than no plan. Every requirement with no course against it,
 * every prerequisite chain that will not fit, every course we could not weigh
 * and every course whose offering term is unknown comes back in the report
 * rather than being quietly dropped or quietly guessed.
 */

// ---------------------------------------------------------------------------
// Inputs this engine reads from the data layer.
//
// These interfaces are deliberately a SUBSET of the shapes lib/planner/
// illinois-data.ts exports (RequirementBlock, RequirementRule, CourseChoice,
// PrereqSpec, PrereqGroup, SectionSummary, CreditRange). A richer object is
// assignable to a narrower interface in TypeScript, so illinois-data's arrays
// and maps drop straight in with no cast and no adapter.
//
// The engine does not import that module on purpose. It has to compile and be
// testable before the data layer lands, it has to run under plain node in the
// check harness, and the same placement logic is what a second school will
// need. Coupling the scheduler to one school's adapter would give up all
// three for nothing.
// ---------------------------------------------------------------------------

export interface PlanCourseChoice {
  /** Codes that are interchangeable for this one slot, as "CS 210 or CS 211". */
  codes: string[];
  credits: number | null;
  /**
   * Courses the degree page says may stand in for this slot but does not list
   * as the course: "MATH 221 (MATH 220 may be substituted)". A held one meets
   * the slot; none is booked in the slot's place.
   */
  substitutes?: string[];
  /**
   * Sets of courses taken together, one of which the row asks for: "CHEM 102 &
   * 103 & 104 & 105" or the accelerated CHEM 202 set. `codes` holds the first
   * course of each. The plan takes one set whole; see `resolveBundles`.
   */
  bundles?: string[][];
}

/** One named list inside a pool, so a constraint can point at it. */
export interface PlanPoolList {
  label: string;
  codes: string[];
}

/**
 * A condition on how a pool's own courses may be chosen.
 *
 * Not a requirement of its own: three of the six technical electives a CS
 * student takes have to come from one focus area, which is a rule about the six
 * rather than three more courses on top of them. `single` is what makes the
 * difference between "three from one list" and "three across eight lists", and
 * it is read from the catalog's sentence, which `text` carries verbatim.
 */
export interface PlanPoolConstraint {
  text: string;
  n: number;
  lists: PlanPoolList[];
  single: boolean;
}

export type PlanRule =
  | { kind: 'all'; choices: PlanCourseChoice[] }
  | { kind: 'choose'; n: number; choices: PlanCourseChoice[] }
  /**
   * "Take N hours, or N courses, from this list." Both numbers are optional
   * because a catalog page can state one without the other, and filling in the
   * missing one would be inventing a rule the page never wrote.
   */
  | {
      kind: 'pool';
      hours: number | null;
      n: number | null;
      choices: PlanCourseChoice[];
      lists: PlanPoolList[];
      constraints: PlanPoolConstraint[];
      label: string;
    }
  | {
      kind: 'hours';
      hours: number;
      genEd: string[] | null;
      label: string;
      /** The lowest course level the page's words allow for these hours, or null. Read by the fill. */
      minLevel?: number | null;
      /** Codes the page rules out of this block. */
      exclude?: string[];
    }
  /**
   * One general education category, sized in hours or in courses or both.
   *
   * Separate from 'hours' because a category the catalog sizes in COURSES
   * cannot be filled by hours without deciding what a course is worth, and
   * because `fulfilledBy` carries the degree page's own statement that its
   * required courses already cover this category. Filling such a category from
   * scratch is how a plan books six hours of science a student is already
   * taking under another heading.
   */
  | {
      kind: 'gened';
      genEd: string[];
      hours: number | null;
      courses: number | null;
      fulfilledBy: string[][];
      /**
       * A name shared by categories that may not use the same course.
       *
       * Illinois lets one course count for a Cultural Studies category and a
       * Humanities category and a major requirement all at once, but never for
       * two Cultural Studies categories. The school states that rule, so the
       * school's adapter names the groups and this engine only honours them.
       */
      exclusiveGroup: string;
      sizeFromCampus: boolean;
      text: string;
      label: string;
    }
  | { kind: 'unparsed'; text: string }
  | { kind: 'language'; semesters: 3 | 4; text: string };

/** What a college publishes about getting in from another college on campus: courses to have done, and by when. */
export interface AdmissionRoute {
  name: string;
  path: string;
  source: string;
  who: string;
  eligibility: string[];
  requiredBy: string;
  required: Array<{ label: string; options?: string[]; with?: string[]; genEd?: string }>;
  /** The index of the last term (0 = the first) by which the required courses must be done. */
  dueTermIndex?: number;
  dataScienceExtra?: Array<{ label: string; options?: string[] }>;
  recommended: string[];
  notes: string[];
  contact: string | null;
}

export interface AdmissionTable {
  fetchedAt: string;
  colleges: Record<string, AdmissionRoute>;
}

/** The registrar's table: for each language, the courses that are its first to fourth semester. */
export interface LanguageTable {
  languages: Array<{
    name: string;
    /** levels[i] is a list of options for semester i+1; an option is one or more codes taken together. */
    levels: string[][][];
    note: string | null;
  }>;
}

export interface PlanRequirement {
  id: string;
  areaId: string;
  areaLabel: string;
  label: string;
  hours: number | null;
  rule: PlanRule;
  note: string;
  url: string;
}

export interface PlanPrereqGroup {
  /** Satisfied by any ONE of these codes. */
  any: string[];
  /** "Credit or concurrent registration in ..." means the same term is allowed. */
  concurrent: boolean;
  confidence: 'high' | 'low';
  /** The clause this group was parsed from, so an error can quote the catalog. */
  source: string;
  /**
   * The catalog's own words for school work that satisfies this group instead
   * of the course, or null.
   *
   * CS 124 reads "Three years of high school mathematics or MATH 112". Nothing
   * this engine can see records what a student did before university, so a
   * group carrying this never forces its course into a plan and never blocks
   * one either. It is reported in GeneratedPlan.priorLearning for the student
   * to answer.
   */
  priorLearning?: string | null;
}

/** A university's own classification of an undergraduate by hours earned. */
export type PlanStanding = 'freshman' | 'sophomore' | 'junior' | 'senior';

export interface PlanPrereq {
  groups: PlanPrereqGroup[];
  escape: 'consent' | 'standing' | 'either' | null;
  text: string;
  parsed: boolean;
  confidence: 'high' | 'low' | 'none';
  /**
   * The catalog saying this course has prerequisites that it does not list
   * here, normally a pointer to the class schedule. Empty when there is none.
   *
   * A surface reading an empty `text` as "no prerequisite" is the reason this
   * exists: 51 Illinois undergraduate rows, CS 498 among them, carry a note and
   * no clause, and telling a student they have nothing to take first is a false
   * statement about the university.
   */
  note?: string;
  /**
   * The lowest class standing the catalog requires, or null.
   *
   * Not the same as `escape: 'standing'`, which offers standing INSTEAD of the
   * courses. This one is a floor: below it the course cannot be taken at all.
   */
  standing?: PlanStanding | null;
  /** The catalog's own words for the standing clause, so an error can quote it. */
  standingText?: string;
}

/**
 * Earned hours each class standing starts at.
 *
 * Injected rather than assumed so a school with different thresholds can supply
 * its own. The default is Illinois's, from the Student Code § 3-302
 * (https://studentcode.illinois.edu/article3/part3/3-302): freshman 0-29.9
 * hours, sophomore 30-59.9, junior 60-89.9, senior 90 or more.
 */
export type StandingThresholds = Record<PlanStanding, number>;

export const DEFAULT_STANDING_HOURS: StandingThresholds = {
  freshman: 0,
  sophomore: 30,
  junior: 60,
  senior: 90,
};

export interface PlanCreditRange {
  credits: number;
  min: number | null;
  max: number | null;
  variable: boolean;
  known: boolean;
}

export interface PlanSectionSummary {
  code: string;
  /** The term the sections were crawled in, as "fall-2026". */
  termId: string;
  termLabel: string;
  total: number;
  partsOfTerm: Array<{ id: string; dateRange: string | null; count: number }>;
  /** The earliest start among the sections, "8:00AM", when the crawl has meeting times. */
  earliest?: string | null;
  /** Every section is online. */
  onlineOnly?: boolean;
  /** Who is listed as teaching, as the section crawl spells the names, with how many sections each. */
  instructors?: Array<{ name: string; sections?: number }>;
  /** Distinct meeting signatures per section type, when the build carries them. See quality.ts registrationFits. */
  meet?: Record<string, string[]>;
  /** Every section type has a section at 9 a.m. or later, or with no set time. */
  lateOption?: boolean;
  /** Registration restrictions the sections carry: "Restricted to Finance major(s)." */
  restrictions?: string[];
}

export interface PlanDifficultyBands {
  typical: number;
  harder: number;
  hardest: number;
}

/**
 * The matcher that decides whether a prerequisite is met.
 *
 * illinois-data.ts owns the canonical implementation (missingPrerequisiteGroups).
 * It is injected rather than imported so this engine stays standalone, and so a
 * school whose catalog parses differently can supply its own. When nothing is
 * passed, defaultPrereqMatcher below runs, which is the same maximum-matching
 * rule written against the same PrereqSpec shape.
 */
export type PrereqMatcher = (
  spec: PlanPrereq | null | undefined,
  earlier: Set<string>,
  sameTerm: Set<string>,
  equivalents: Map<string, string[]>,
) => {
  missing: PlanPrereqGroup[];
  uncertain: PlanPrereqGroup[];
  /**
   * Unmet groups the catalog says school work also satisfies. Absent from
   * older matchers, which is why it is optional and always read with `?? []`.
   */
  priorLearning?: PlanPrereqGroup[];
};

export interface PlanningContext {
  /** Catalog courses in the planner's own shape. Credits and titles come from here, never from a program row. */
  courses: Course[];
  /**
   * Parsed prerequisites by course code.
   *
   * Absent map and empty map mean different things and the report says which.
   * An absent map is "prerequisites have not loaded", and the plan is labelled
   * unchecked rather than passing. A present map with no entry for a course is
   * "the catalog lists no prerequisite for it", which is a real fact.
   */
  prereqs?: Map<string, PlanPrereq>;
  grades?: Map<string, GradeRow>;
  sections?: Map<string, PlanSectionSummary>;
  /** Cross-listing classes by code, so LLS 200 satisfies a requirement written as AAS 200. */
  equivalents?: Map<string, string[]>;
  /** "Credit is not given for both X and Y", by code. */
  exclusions?: Map<string, string[]>;
  /** Credit ranges by code. Becomes redundant once Course carries creditsMax. */
  creditRanges?: Map<string, PlanCreditRange>;
  /** Teachers Ranked as Excellent, per course, and the terms the list covers. Absent means not known. */
  excellent?: Map<string, ExcellentSummary>;
  excellentTerms?: string[];
  bands?: PlanDifficultyBands | null;
  /**
   * Codes whose offering term the catalog actually publishes.
   *
   * Illinois publishes none, so this is empty there and no course is ever
   * refused a term for being "spring only". A school that does publish the
   * term fills this set and Course.offeredIn becomes a hard constraint.
   */
  offeringPublished?: Set<string>;
  /**
   * The recent terms each course has actually run in, "fa2026" newest first,
   * read off the Course Explorer. A course in `offeringTerms`' window with no
   * entry has not run in any of them; the ranker puts it last, the fill
   * marks it down, and the validator says so on the card.
   */
  offerings?: Map<string, string[]>;
  offeringTerms?: string[];
  /** New course number -> the old number whose offering history it carries. */
  offeringAliases?: Map<string, string>;
  /** The registrar's language table, so the language requirement can be planned rather than quoted. */
  languages?: LanguageTable;
  /** The one term the section crawl covers. A room in fall 2026 says nothing about spring 2029. */
  snapshotTerm?: { id: string; label: string; season: SemesterSeason } | null;
  /** The provenance line the grade panel prints, carried through so the report can repeat it. */
  gradeFootnote?: string | null;
  prereqCheck?: PrereqMatcher;
}

/**
 * What the student already has.
 *
 * A planner that assumes zero credits is wrong on day one for a transfer, a
 * dual-enrollment student, or anyone who took AP exams, and those are a large
 * share of the people who need a plan most. Credit and exemption are tracked
 * separately because they are not the same thing: a course you have credit for
 * counts toward the degree, a course you are only exempt from lets you skip
 * ahead in the sequence and still leaves the requirement open.
 */
export interface PriorCredit {
  courseCodes: string[];
  exemptCodes: string[];
  /**
   * Semesters of a language other than English already behind the student:
   * the university counts one year of high school study as one semester. The
   * name is what they wrote, matched against the registrar's table. Null or
   * absent when they have not said, in which case the plan assumes the two
   * years Illinois requires for admission and says so.
   */
  languageSemesters?: number | null;
  languageName?: string | null;
  /** Hours that count toward the degree but map to no course code, which is the normal transfer case. */
  unmatchedCredits: number;
  /**
   * General education categories met by credit that holds no Illinois course:
   * a Parkland course the Parkland-to-UIUC guide lists under Humanities, an
   * evaluation report's "HIST 1-- (Gen Ed: SBS)", an IB exam granting "NRES
   * 1--" with a Physical Sciences gen ed. Their hours are already in
   * unmatchedCredits; these entries only fill categories, each once.
   */
  genEdCredits?: GenEdCredit[];
  /**
   * False when the student has told us they transferred but not what they took.
   * The plan still generates, and it carries a note saying it was built without
   * a transcript rather than pretending the starting point is known.
   */
  known: boolean;
}

/** One piece of held credit that fills general education categories without an Illinois course. */
export interface GenEdCredit {
  /** Unique within the student's credit, for the ledger: "Parkland College HUM 101". */
  id: string;
  label: string;
  credits: number;
  /** The catalog's own gen-ed strings it counts for. */
  tags: string[];
}

export interface Horizon {
  startSeason: SemesterSeason;
  startYear: number;
  gradSeason: SemesterSeason;
  gradYear: number;
  /**
   * True when the student named the end themselves ("graduate spring 2028",
   * "in three years"). Absent or false means the end is a default, which a
   * student who walks in with two years of credit should not be held to.
   */
  stated?: boolean;
  /**
   * Terms the student is away from campus: study abroad, a co-op, a gap
   * semester. The plan keeps the term in the calendar and books nothing in it.
   * "I'm studying abroad spring 2029" is a term away, never a graduation date.
   */
  away?: Array<{ season: SemesterSeason; year: number }>;
  /**
   * Summer terms the student will take classes in. Fall and spring are always
   * planned; a summer only when the student asks for it, and at a summer load.
   */
  summers?: number[];
}

export interface PlanPreferences {
  /**
   * `target` null means balanced: every term aims for the same share of what
   * is left, spread over the terms there are. A number is the student's own
   * preference. Either way a term is raised only as far as the graduation date
   * requires, and never past `max`.
   */
  creditsPerTerm?: { min?: number; target?: number | null; max?: number };
  /** How many of the hardest-band courses may share a term before the engine defers one. */
  maxHardCourses?: number;
  /** Overrides the band cut. Null turns the difficulty guard off entirely. */
  hardDifficulty?: number | null;
  /**
   * What "best" means to this student. Read by every choice the engine makes
   * among interchangeable courses: elective slots, pool picks, gen-ed picks,
   * and the order alternatives are offered in. Absent means balanced.
   */
  priorities?: Priorities;
  /**
   * How a "choose one of these forty" group gets filled.
   * 'lightest' orders by grade history, which is a statement about the past and
   * is labelled as one wherever it is shown.
   */
  electivePolicy?: 'lightest' | 'catalog-order' | 'priorities';
}

/** The residency rule and what the student already holds toward it. */
export interface ResidencyRule {
  /** Hours that must be taken at the university. */
  hours: number;
  /** Of those, hours at the 300 level or above. */
  upperLevel: number;
  /** Hours already taken at the university, done or in progress: not transfer, not exam credit. */
  heldHours: number;
  heldUpper: number;
  source: string;
}

export interface ResidencyReport extends ResidencyRule {
  plannedHours: number;
  plannedUpper: number;
  ok: boolean;
  /** The plain sentence, when short. */
  shortfall: string | null;
}

export interface AutoplanInput {
  requirements: PlanRequirement[];
  context: PlanningContext;
  prior: PriorCredit;
  horizon: Horizon;
  preferences?: PlanPreferences;
  programId?: string;
  /**
   * Earned hours each class standing starts at. Defaults to Illinois's, from
   * the Student Code § 3-302. A school with different thresholds passes its own
   * rather than having this engine assume anybody's.
   */
  standingHours?: StandingThresholds;
  /**
   * The degree's published total, from the catalog page. The requirement
   * blocks add up to less than this whenever a page leaves credit cells empty
   * or says "24 hours of free electives" without naming them, and a plan that
   * stops at what the blocks name leaves a first-year student with a
   * three-credit last term. Null when the page publishes none.
   */
  degreeTotal?: number | null;
  /** The student's own words about what they study and want, for ranking elective picks. */
  interests?: string;
  /** The degree's name, "Psychology, BSLAS", which names the major better than a thin page does. */
  programName?: string;
  /** The college the degree sits in, as the catalog codes it: "bus", "engineering", "las", "aces", "faa", "media", "education", "ahs", "socw", "ischool". */
  programCollege?: string;
  /**
   * Courses this degree's college earns no hours for. Set by generatePlan from
   * the college; the elective fill never suggests one.
   */
  notTowardDegree?: (code: string) => boolean;
  /**
   * Courses that go as early and as consecutively as their chain allows,
   * ahead of every other choice in a term: a language sequence, which loses
   * its value with a year's gap between semesters. Set by generatePlan.
   */
  sequenceFirst?: string[];
  /** Codes exempted by the language placement the plan assumed, not by anything the student declared. */
  languageExempt?: string[];
  /**
   * General education categories that go first for the same reason: an
   * admission route that wants Composition I done by the end of the first
   * spring. Whatever course the fill chooses for the category is placed as
   * early as its chain allows. Set by generatePlan.
   */
  earlyTags?: string[];
  /**
   * Courses that must be done by a term (index, 0 = the first): an admission
   * route's courses by the end of the first spring. Their prerequisites
   * inherit the deadline. Set by generatePlan.
   */
  dueByTerm?: Record<string, number>;
  /**
   * The college the student is trying to get into, when they are not in it
   * yet: its published route becomes requirements placed first, because the
   * application has a deadline the degree page knows nothing about.
   */
  admissionRoute?: AdmissionRoute | null;
  /**
   * The campus residency rule, when the school has one. Read after placement
   * and reported, never enforced by adding courses: the degree total is what
   * the fill reaches, and a shortfall here is a fact the student and their
   * advisor act on.
   */
  residency?: ResidencyRule | null;
}

// ---------------------------------------------------------------------------
// Outputs.
// ---------------------------------------------------------------------------

export interface CreditTotal {
  min: number;
  max: number;
  variable: boolean;
  /** Courses whose credit hours the catalog does not list. They add 0 to both ends. */
  unknown: number;
}

export type LoadVerdict = 'light' | 'normal' | 'heavy' | 'brutal';

export interface TermLoadReport {
  avgDifficulty: number | null;
  /**
   * scheduler.termLoad's verdict, which is still on UGA's absolute cuts.
   * Kept so nothing that already reads it changes, but do not show it for a
   * school with computed bands: Illinois difficulty tops out around 80 with a
   * 90th percentile near 37, so every real term reads "light" on those cuts.
   */
  verdict: LoadVerdict;
  /** The same judgement against this school's own distribution. Show this one. */
  bandVerdict: LoadVerdict;
  /** Courses in the hardest band for this school, not an absolute score. */
  hard: string[];
  weighed: number;
  unweighed: number;
}

export interface PlannedTerm {
  id: string;
  label: string;
  season: SemesterSeason;
  year: number;
  index: number;
  codes: string[];
  credits: CreditTotal;
  load: TermLoadReport;
  notes: string[];
}

export interface UnsatisfiedRequirement {
  requirementId: string;
  areaLabel: string;
  label: string;
  reason:
    | 'not-parsed'
    | 'no-course-data'
    | 'no-candidates'
    | 'hours-short'
    | 'did-not-fit'
    /** A pool filled, but a sentence about HOW it may be filled did not hold. */
    | 'constraint-unmet'
    /**
     * The course that would fill this is one the catalog says will not count
     * alongside something the student already has or the plan already books.
     *
     * Its own reason rather than 'did-not-fit', because the two send a student
     * to different places. "Did not fit" is about room in a schedule and the
     * answer is another term. This one is about credit, and the answer is an
     * advisor.
     */
    | 'excluded'
    /**
     * Hours the page states without naming courses, "Free Electives: 24
     * hours", which the elective slots now fill. Not a shortfall: a note about
     * where those hours went, so the review list stops calling a filled
     * requirement something it cannot tell.
     */
    | 'filled-by-electives';
  message: string;
  url: string;
}

/** What a pool asked for, and what the board actually holds against it. */
export interface PoolReport {
  requirementId: string;
  areaLabel: string;
  label: string;
  /** The catalog's own sentence, where the page has one. Quoted, never summarised. */
  note: string;
  hoursTarget: number | null;
  countTarget: number | null;
  /** Hours and courses on the board, counted after placement rather than at selection. */
  hours: number;
  count: number;
  /** In the plan for this pool, in term order. */
  picked: string[];
  /** In the pool and already earned, so they count without being planned. */
  fromPriorCredit: string[];
  /** Courses this pool lists that are in the catalog and not in the plan, best first. */
  alternatives: string[];
  /** How many courses the page lists here, and how many of those the snapshot has. */
  listed: number;
  available: number;
  constraints: Array<{
    text: string;
    n: number;
    met: boolean;
    /** The list the courses came from, when the sentence asks for a single one. */
    from: string | null;
    picked: string[];
  }>;
  url: string;
}

export interface NotPlaced {
  code: string;
  title: string;
  reason:
    | 'chain-too-long'
    | 'no-room'
    | 'prereq-unmet'
    | 'offering-conflict'
    /** The catalog requires a class standing the plan never reaches in time. */
    | 'standing-unmet';
  message: string;
  requirementId: string | null;
}

/**
 * A prerequisite the catalog says school work can satisfy, and what was done
 * about it.
 *
 * CS 124 reads "Three years of high school mathematics or MATH 112". Booking
 * MATH 112 put a three hour algebra course in the first term of every Computer
 * Science plan, including plans for students holding AP Calculus credit, and it
 * is why a first semester of Computer Science held no Computer Science. The
 * plan no longer books it. This says so, in the catalog's own words, and says
 * whether the answer came from the student's own credit or is still a question
 * for them.
 */
export interface PriorLearningCheck {
  /** The course whose prerequisite this is. */
  code: string;
  /** The courses the catalog offers as the other way to meet it. */
  alternatives: string[];
  /** The catalog's own words for the school work it also accepts. */
  alsoAccepts: string;
  /** The whole prerequisite sentence, verbatim. */
  text: string;
  /** 'held' when prior credit settles it, 'ask' when only the student can. */
  settled: 'held' | 'ask';
  /** The sentence shown to the student. Already in `notes` as well. */
  message: string;
}

export interface GeneratedPlan {
  plan: PlanState;
  terms: PlannedTerm[];
  /** Requirements with no course assigned, each with the catalog link so a human can check. */
  unsatisfied: UnsatisfiedRequirement[];
  /**
   * Every "take N hours from this list" requirement, filled or not.
   *
   * Here rather than only in `unsatisfied` because a pool that is met is still
   * something the student has to be able to see and change: the six technical
   * electives this engine picked are six of about a hundred and seventy, and
   * the plan would be lying by omission if it showed them as settled.
   */
  pools: PoolReport[];
  notPlaced: NotPlaced[];
  /** Courses the degree page never mentions that the catalog requires anyway. */
  addedPrerequisites: Array<{ code: string; requiredBy: string }>;
  /** Prerequisites the catalog also accepts school work for. Nothing here was booked. */
  priorLearning: PriorLearningCheck[];
  /**
   * Held credit a required course displaces. MATH 234 in hand and MATH 221
   * required: the plan books MATH 221, and MATH 234 no longer counts toward
   * this degree. Out of the totals here, and named so the board can say it.
   */
  forfeited: Array<{ held: string; for: string }>;
  /**
   * Courses placed to reach the degree total that no requirement names, each
   * with the reason it was chosen. Marked on the board as electives to swap.
   */
  electives: Array<{ code: string; why: string; reasons: string[] }>;
  /**
   * The language sequence this plan books for the language requirement, or
   * null when the degree has none or the student already meets it.
   */
  language: LanguagePlan | null;
  /** The college admission route this plan front-loads, or null. */
  admission: { name: string; path: string; source: string; requiredBy: string; codes: string[]; eligibility: string[]; notes: string[] } | null;
  /** Requirements already met by credit the student walked in with. */
  satisfiedByPriorCredit: Array<{ requirementId: string; label: string; codes: string[] }>;
  /** Which requirement each booked course was chosen for, by code; null for a prerequisite or an elective. */
  bookedFor?: Record<string, string | null>;
  /**
   * The courses the planner chose for a general education category, with the
   * category. They are its own picks, like elective slots, and a student can
   * swap one for another course that carries the same categories; the board
   * used to label them "added", as if the student had put them there.
   */
  genEdPicks?: Array<{ code: string; requirementId: string; label: string; tags: string[] }>;
  /**
   * The campus residency rule against this plan, or null when the school has
   * none. A transfer student can hold ninety hours and still owe Illinois
   * forty-five of its own, twenty-one of them at the 300 level or above, and
   * a plan that reaches the degree total with fewer is not a plan they can
   * graduate on.
   */
  residency?: ResidencyReport | null;
  credits: {
    planned: CreditTotal;
    prior: number;
    /**
     * Everything that counts toward the degree: what the student already has
     * plus what this plan schedules.
     *
     * This is the headline number and `planned` is not. A transfer student with
     * RHET 105, MATH 221, MATH 231, CS 124 and PHYS 211 in hand was shown "68
     * to 71 cr of 128" while the same screen said "Already taken 5 courses" and
     * counted those five in the requirement bars. Eighteen hours the app had in
     * its own data were missing from the one number the student reads.
     */
    total: CreditTotal;
    degreeTotal: number | null;
    /** Hours the catalog counts that this plan does not name, normally free electives. */
    unaccounted: number | null;
  };
  offering: { unknown: string[]; seenOnlyInSnapshot: string[]; message: string | null };
  /** Everything a reader has to know before trusting the plan. Short sentences, shown as-is. */
  notes: string[];
  partsOfTerm: string[];
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/**
 * Illinois runs several parts of term inside one semester and the drop, refund,
 * credit/no-credit and grade-replacement deadlines differ for each one. This
 * module has none of those dates and never prints one. It names the parts a
 * course runs in and sends the reader to the registrar for the dates.
 */
export const DEADLINE_DISCLAIMER =
  'Drop, refund and credit/no-credit deadlines depend on the part of term a section runs in. Check the registrar calendar for the dates.';

/** Matches scheduler.termLoad's current cut, used when the school has no computed bands. */
const FALLBACK_HARD_DIFFICULTY = 65;

/** The bands scheduler.termLoad hardcodes, used when a school has none computed. */
const FALLBACK_BANDS: PlanDifficultyBands = { typical: 32, harder: 58, hardest: 72 };

/**
 * How heavy a term is against this school's own distribution.
 *
 * Three genuinely hard courses in one term is the shape that breaks people and
 * it is invisible if you only count credit hours. "Hard" has to be relative to
 * the school though: an absolute 65 labels eleven courses out of 2,968 at
 * Illinois, so a term of the three hardest courses in the major would read as
 * light. The structure is scheduler.termLoad's, with percentiles in place of
 * the fixed numbers.
 */
function bandVerdictFor(
  hardCount: number,
  avgDifficulty: number | null,
  bands: PlanDifficultyBands,
): LoadVerdict {
  if (avgDifficulty === null) return 'normal';
  if (hardCount >= 3 || avgDifficulty >= bands.hardest) return 'brutal';
  if (hardCount === 2 || avgDifficulty >= bands.harder) return 'heavy';
  if (avgDifficulty <= bands.typical) return 'light';
  return 'normal';
}

const DEFAULT_CREDITS: { min: number; target: number | null; max: number } = { min: 12, target: null, max: 18 };
/**
 * A normal full-time load, used only to decide how many terms a student with
 * credit in hand still needs. Someone holding 48 hours toward 128 needs about
 * 80 more, which is six terms at this pace, not eight thin ones: the graduation
 * date is a deadline, not a floor.
 */
const NORMAL_LOAD = 15;
const DEFAULT_MAX_HARD = 2;

// ---------------------------------------------------------------------------
// Small shared helpers.
// ---------------------------------------------------------------------------

/**
 * Must stay byte-identical to the slug in uga-data.ts. Two schools producing
 * different ids for the same shape of code would break every saved plan that
 * crosses them, which is why the design note asks for a shared lib/planner/ids.ts.
 * Until that file exists this copy is the contract.
 */
export function courseIdFor(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Collapses the internal whitespace the catalog and the grade file disagree about. */
export function normaliseCode(code: string): string {
  return code.trim().replace(/\s+/g, ' ').toUpperCase();
}

function expandEquivalents(code: string, equivalents: Map<string, string[]>): string[] {
  const others = equivalents.get(code);
  return others && others.length ? [code, ...others] : [code];
}

/**
 * The catalog number, used only to break ties between courses that are equally
 * placeable. CEE 498 lists no prerequisite, so nothing stops the engine putting
 * it in a student's first fall next to MATH 221. That is not false, but no
 * advisor would sign it, and preferring the lower number when two courses are
 * otherwise interchangeable costs nothing. It is an ordering preference and
 * nothing in the report presents it as a rule the university has.
 */
function courseLevel(code: string): number {
  const match = code.match(/(\d{3})/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function termIdFor(season: SemesterSeason, year: number): string {
  return `${season.toLowerCase()}-${year}`;
}

/**
 * The distinct parts of term a course runs in, as "1 (08/24/26-12/09/26)".
 *
 * Deduplicated by part id on purpose. A scraper that splits one part into two
 * rows because the date cell picked up trailing restriction text would
 * otherwise make a full-term course look like it spans two parts, and the
 * sentence that follows tells a student their drop deadlines differ. A wrong
 * deadline claim is the exact failure the parts-of-term rule exists to stop,
 * so the bar for making it is two genuinely different part ids.
 */
function distinctParts(summary: PlanSectionSummary): string[] {
  const seen = new Map<string, string | null>();
  for (const part of summary.partsOfTerm) {
    const id = part.id || 'nonstandard';
    if (!seen.has(id)) seen.set(id, part.dateRange);
  }
  return [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, range]) => (range ? `${id} (${range})` : id));
}

// ---------------------------------------------------------------------------
// "Credit is not given for both X and Y".
// ---------------------------------------------------------------------------

/**
 * The catalog's exclusion sentences, mirrored so every lookup works both ways.
 *
 * The shipped file states each sentence once, on the course whose own catalog
 * description carries it. So ACE 300 names ECON 302 and ECON 302 has no row at
 * all, and MATH 115 names MATH 220 while MATH 220 names only MATH 221 and MATH
 * 234. Reading one direction is how both halves of a pair kept reaching the
 * same plan. Mirroring every pair once, here, makes every check downstream the
 * same check.
 *
 * Cross-listings are deliberately not folded in. 34 of these pairs ARE a
 * cross-listing, the catalog's way of saying the two listings are one course,
 * and expanding through equivalents would make each of those courses exclude
 * itself and drop out of every plan.
 */
function buildConflicts(exclusions: Map<string, string[]> | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!exclusions) return out;
  const link = (a: string, b: string): void => {
    const set = out.get(a);
    if (set) set.add(b);
    else out.set(a, new Set([b]));
  };
  for (const [rawA, list] of exclusions) {
    const a = normaliseCode(rawA);
    for (const rawB of list) {
      const b = normaliseCode(rawB);
      if (a === b) continue;
      link(a, b);
      link(b, a);
    }
  }
  return out;
}

/**
 * The course already counted that stops this one counting, or null.
 *
 * Deterministic on ties, so the same student gets the same plan twice.
 * Exemptions are not held credit and never appear in the sets passed here:
 * exclusion is a rule about credit, and an exemption earns none.
 */
function conflictWith(
  code: string,
  conflicts: Map<string, Set<string>>,
  held: Array<Set<string> | Map<string, unknown>>,
): string | null {
  const others = conflicts.get(code);
  if (!others || others.size === 0) return null;
  let first: string | null = null;
  for (const other of others) {
    if (!held.some((set) => set.has(other))) continue;
    if (first === null || other < first) first = other;
  }
  return first;
}

/**
 * A prerequisite group nothing in this plan can ever satisfy, because every way
 * of satisfying it is a course the catalog says will not count alongside one
 * already in hand.
 *
 * ECON 302 parses to four ANDed groups, [ECON 102], [MATH 220], [MATH 221] and
 * [MATH 234], out of the sentence "ECON 102 or equivalent. MATH 220, MATH 221,
 * MATH 234 or equivalent." Those three calculus courses exclude one another, so
 * no student who ever lived has held all three. Booking all three is how the
 * old plan "satisfied" it. Refusing to book the twins and then reporting ECON
 * 302 as short of MATH 221 would be just as wrong, and would send a student
 * after a course whose credit they cannot have.
 *
 * So a group in this state is left out of `missing` and the plan says, in
 * `notes`, which course closed it and that an advisor has to confirm it. That
 * sentence is the whole point: nothing here claims Illinois accepts one course
 * for the other, only that this plan could not book both and stopped.
 */
function groupClosedByExclusion(
  group: PlanPrereqGroup,
  conflicts: Map<string, Set<string>>,
  held: Array<Set<string> | Map<string, unknown>>,
  equivalents: Map<string, string[]>,
): string | null {
  if (group.any.length === 0) return null;
  let blocker: string | null = null;
  for (const raw of group.any) {
    let here: string | null = null;
    for (const alt of expandEquivalents(normaliseCode(raw), equivalents)) {
      // An alternative the plan books, or the student holds, is one the
      // ordinary matcher can place in order. It is not closed, whatever else
      // it conflicts with: MATH 221 booked over a held MATH 234 still has to
      // come before MATH 231, and reading it as closed let MATH 231 go first.
      if (held.some((set) => set.has(alt))) return null;
      const hit = conflictWith(alt, conflicts, held);
      if (hit !== null && (here === null || hit < here)) here = hit;
    }
    // One alternative the exclusion rule leaves open is a group the student can
    // still satisfy the ordinary way.
    if (here === null) return null;
    if (blocker === null || here < blocker) blocker = here;
  }
  return blocker;
}

/** The plain fact, in the same words the review list uses for it. */
function notBoth(a: string, b: string): string {
  return `${a} and ${b} do not both count toward graduation.`;
}

/**
 * The school's prerequisite matcher, with groups the exclusion rule has closed
 * taken out of `missing`.
 *
 * Shared by generatePlan and validatePlan so the board the engine builds and
 * the review list a student reads cannot disagree about the same course.
 *
 * The course being checked counts as held against its own prerequisites, and
 * that is not a trick: MATH 220's parsed prerequisite names MATH 115, and MATH
 * 115's catalog line says credit is not given for both. Booking the prep course
 * and then not counting it is not something this plan can express, so it books
 * nothing and says so in a note. Without that the plan refuses to place MATH
 * 220 at all, and an Agricultural and Consumer Economics degree loses half its
 * major behind one unreadable ALEKS sentence.
 */
function exclusionAwareMatcher(
  base: PrereqMatcher,
  conflicts: Map<string, Set<string>>,
  prereqs: Map<string, PlanPrereq> | undefined,
  equivalents: Map<string, string[]>,
  alsoHeld: Array<Set<string> | Map<string, unknown>>,
): PrereqMatcher {
  if (conflicts.size === 0) return base;
  // Specs arrive as objects out of the same map every caller reads, so identity
  // is enough to name the course a sentence belongs to.
  const codeOfSpec = new Map<PlanPrereq, string>();
  for (const [code, spec] of prereqs ?? []) codeOfSpec.set(spec, code);

  return (spec, earlier, sameTerm, equiv) => {
    const result = base(spec, earlier, sameTerm, equiv);
    if (result.missing.length === 0) return result;
    const self = spec ? codeOfSpec.get(spec) : undefined;
    const held = [...alsoHeld, earlier, sameTerm, new Set(self === undefined ? [] : [self])];
    const missing = result.missing.filter(
      (group) => groupClosedByExclusion(group, conflicts, held, equivalents) === null,
    );
    return missing.length === result.missing.length ? result : { ...result, missing };
  };
}

// ---------------------------------------------------------------------------
// Prerequisite satisfaction.
// ---------------------------------------------------------------------------

/**
 * Which prerequisite groups are still unmet.
 *
 * Groups are ANDed and each group is satisfied by any one of its codes, so this
 * is a maximum bipartite matching rather than a per-group `.some()`. ACCY 201
 * parses to [ECON 102|ECON 103] AND [ECON 102|ECON 103 concurrent], which means
 * both courses with one of them allowed in the same term. A per-group check
 * calls that satisfied by ECON 102 alone and lets a student register for a
 * course they cannot take.
 *
 * High-confidence groups are matched first. A low-confidence group sharing a
 * course with a real one must not be the group that claims it, because the
 * low-confidence group only produces a warning and the real one blocks.
 */
export function defaultPrereqMatcher(
  spec: PlanPrereq | null | undefined,
  earlier: Set<string>,
  sameTerm: Set<string>,
  equivalents: Map<string, string[]>,
): { missing: PlanPrereqGroup[]; uncertain: PlanPrereqGroup[]; priorLearning: PlanPrereqGroup[] } {
  if (!spec || !spec.parsed || spec.groups.length === 0) {
    return { missing: [], uncertain: [], priorLearning: [] };
  }

  const groups = spec.groups;
  const available = groups.map((group) => {
    const pool = new Set<string>();
    for (const raw of group.any) {
      const code = normaliseCode(raw);
      for (const alt of expandEquivalents(code, equivalents)) {
        if (earlier.has(alt)) pool.add(alt);
        else if (group.concurrent && sameTerm.has(alt)) pool.add(alt);
      }
    }
    return [...pool].sort();
  });

  // Kuhn's algorithm. Group counts top out around eight and alternatives around
  // eleven, so the naive augmenting-path version is instant and easy to read.
  const takenBy = new Map<string, number>();
  const visited = new Set<string>();
  const augment = (groupIndex: number): boolean => {
    for (const code of available[groupIndex]) {
      if (visited.has(code)) continue;
      visited.add(code);
      const holder = takenBy.get(code);
      if (holder === undefined || augment(holder)) {
        takenBy.set(code, groupIndex);
        return true;
      }
    }
    return false;
  };

  const order = groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => (a.group.confidence === b.group.confidence ? a.index - b.index : a.group.confidence === 'high' ? -1 : 1));

  for (const { index } of order) {
    visited.clear();
    augment(index);
  }

  // Kuhn never unmatches a group once matched, so inverting the map at the end
  // is the complete list of satisfied groups.
  const matched = new Set<number>(takenBy.values());
  const missing: PlanPrereqGroup[] = [];
  const uncertain: PlanPrereqGroup[] = [];
  const priorLearning: PlanPrereqGroup[] = [];
  groups.forEach((group, index) => {
    if (matched.has(index)) return;
    if (group.confidence === 'low') uncertain.push(group);
    // The catalog offers school work instead of the course. See
    // PlanPrereqGroup.priorLearning for why that neither blocks nor passes.
    else if (group.priorLearning) priorLearning.push(group);
    else missing.push(group);
  });
  return { missing, uncertain, priorLearning };
}

/**
 * Groups that actually constrain ordering: high confidence, not allowed in the
 * same term, and not one the catalog says school work also satisfies.
 *
 * The last of those is the difference between CS 124 in a first fall and CS 124
 * in a second spring. Its only prerequisite is "Three years of high school
 * mathematics or MATH 112", which the matcher stopped treating as a blocker,
 * and leaving it in the depth walk kept the course one term deep anyway. The
 * two have to agree or the plan holds a course back for a reason it has already
 * decided is not a reason.
 */
function orderingGroups(spec: PlanPrereq | undefined): PlanPrereqGroup[] {
  if (!spec || !spec.parsed) return [];
  return spec.groups.filter((g) => g.confidence === 'high' && !g.concurrent && !g.priorLearning);
}

// ---------------------------------------------------------------------------
// Chain depth.
// ---------------------------------------------------------------------------

/**
 * The earliest term index a course can sit in, counting from zero.
 *
 * Depth is measured against what the student already has: a prerequisite they
 * walked in with costs no terms, which is the whole reason a transfer student's
 * plan is shorter than a freshman's. Alternatives take the cheapest branch,
 * because only one of them is needed.
 *
 * Catalogs contain co-requisite loops. CS 225 lists CS 413 as one alternative
 * and CS 413 lists CS 225 back, so a naive walk never returns. A branch that
 * closes a loop is treated as unresolvable rather than as depth zero, which
 * lets the cheapest branch that does resolve win and keeps the loop out of the
 * report. Only a group whose every alternative loops is reported, because that
 * is the case where the plan really did have to guess.
 */
function buildDepths(
  codes: Iterable<string>,
  prereqs: Map<string, PlanPrereq> | undefined,
  satisfied: Set<string>,
  equivalents: Map<string, string[]>,
): { depth: Map<string, number>; cycles: string[] } {
  const depth = new Map<string, number>();
  const cycles: string[] = [];
  const stack = new Set<string>();

  // A value worked out while a loop was being cut is only valid for that one
  // walk, so it is returned but never memoised. Caching it would leak the cut
  // into every later lookup of the same course.
  const walk = (code: string): { depth: number; cut: boolean } => {
    const cached = depth.get(code);
    if (cached !== undefined) return { depth: cached, cut: false };
    if (satisfied.has(code)) {
      depth.set(code, 0);
      return { depth: 0, cut: false };
    }
    if (stack.has(code)) return { depth: Infinity, cut: true };
    stack.add(code);

    let deepest = 0;
    let cut = false;
    for (const group of orderingGroups(prereqs?.get(code))) {
      let cheapest = Infinity;
      for (const raw of group.any) {
        const alt = normaliseCode(raw);
        for (const equiv of expandEquivalents(alt, equivalents)) {
          const branch = walk(equiv);
          if (branch.cut) cut = true;
          /**
           * A prerequisite the student already holds was finished before the
           * plan starts, so it costs no term. Counting it as one put every
           * course that follows a held course one term late: a transfer with
           * sixty hours and CS 225 in hand opened with a nine-credit fall of
           * gen-eds while CS 341 waited for a spring it did not need.
           */
          const step = satisfied.has(equiv) ? 0 : 1;
          if (branch.depth !== Infinity) cheapest = Math.min(cheapest, branch.depth + step);
        }
      }
      if (cheapest === Infinity) {
        if (!cycles.includes(code)) cycles.push(code);
      } else {
        deepest = Math.max(deepest, cheapest);
      }
    }

    stack.delete(code);
    if (!cut) depth.set(code, deepest);
    return { depth: deepest, cut };
  };

  for (const code of codes) {
    const result = walk(code);
    if (!depth.has(code)) depth.set(code, result.depth === Infinity ? 0 : result.depth);
  }
  return { depth, cycles };
}

/**
 * How much of the plan is waiting on a course, used only to decide what goes
 * first when several courses are eligible in the same term.
 *
 * This counts a course as blocking anything that lists it as an alternative,
 * which over-counts when the student could satisfy that group another way. It
 * is a tie-break, not a claim, and nothing in the report repeats it.
 */
function buildHeights(
  selected: string[],
  prereqs: Map<string, PlanPrereq> | undefined,
  equivalents: Map<string, string[]>,
  /** Extra terms a dependent costs to reach: one for a course that runs in a single season. */
  latency?: (code: string) => number,
): Map<string, number> {
  const dependents = new Map<string, string[]>();
  for (const code of selected) {
    const spec = prereqs?.get(code);
    // Concurrent prerequisites count here too: PHYS 211 may be taken with
    // MATH 231, but it cannot be taken without it, and a MATH 231 with no
    // dependents on record sat behind depth-zero fillers for four terms
    // while PHYS 211 waited for it. Depth, which decides how early a course
    // may go, still ignores them; height only decides who goes first.
    const groups = [
      ...orderingGroups(spec),
      ...(spec && spec.parsed ? spec.groups.filter((g) => g.concurrent && g.confidence === 'high' && !g.priorLearning) : []),
    ];
    for (const group of groups) {
      for (const raw of group.any) {
        for (const equiv of expandEquivalents(normaliseCode(raw), equivalents)) {
          const list = dependents.get(equiv);
          if (list) list.push(code);
          else dependents.set(equiv, [code]);
        }
      }
    }
  }

  const height = new Map<string, number>();
  const stack = new Set<string>();
  const walk = (code: string): number => {
    const cached = height.get(code);
    if (cached !== undefined) return cached;
    if (stack.has(code)) return 0;
    stack.add(code);
    let tallest = 0;
    for (const child of dependents.get(code) ?? []) {
      // A dependent that runs in only one season may cost a year, not a term,
      // to reach: ACCY 302 in spring means ACCY 303 in the next spring, and a
      // height blind to that booked ACCY 201 a term late and lost ACCY 405.
      tallest = Math.max(tallest, walk(child) + 1 + (latency ? latency(child) : 0));
    }
    stack.delete(code);
    height.set(code, tallest);
    return tallest;
  };
  for (const code of selected) walk(code);
  return height;
}

// ---------------------------------------------------------------------------
// Credits.
// ---------------------------------------------------------------------------

/**
 * The catalog by code, built once per catalog array. planCreditRange used to
 * build this 6,110-entry map on every call, and it is called inside the
 * placer's and the fill's inner loops: that was most of a plan's build time.
 */
const catalogIndexCache = new WeakMap<object, Map<string, Course>>();

function catalogByCode(courses: Course[]): Map<string, Course> {
  const cached = catalogIndexCache.get(courses);
  if (cached) return cached;
  const made = new Map(courses.map((c) => [normaliseCode(c.code), c]));
  catalogIndexCache.set(courses, made);
  return made;
}

/**
 * Credits for a set of courses, as a range.
 *
 * A term holding a 1-to-5-credit course is 1 to 5 credits of uncertainty and
 * collapsing that to either end is wrong in one direction or the other. The
 * total is only ever rendered as a single number when nothing in it is
 * variable. Courses whose credit hours the catalog does not list contribute
 * zero to both ends and are counted separately, so a missing number never
 * silently becomes a three.
 */
export function planCreditRange(
  codes: string[],
  ctx: PlanningContext,
  pinned?: Map<string, number>,
): CreditTotal {
  const ranges = ctx.creditRanges;
  const byCode = catalogByCode(ctx.courses);
  let min = 0;
  let max = 0;
  let unknown = 0;
  let variable = false;

  for (const raw of codes) {
    const code = normaliseCode(raw);
    const pin = pinned?.get(code);
    if (pin !== undefined) {
      min += pin;
      max += pin;
      continue;
    }
    const range = ranges?.get(code);
    if (range) {
      if (!range.known) {
        unknown += 1;
        continue;
      }
      min += range.min ?? range.credits;
      max += range.max ?? range.credits;
      if (range.variable) variable = true;
      continue;
    }
    const course = byCode.get(code);
    if (!course) {
      unknown += 1;
      continue;
    }
    min += course.credits;
    max += course.credits;
  }

  return { min, max, variable: variable || max > min, unknown };
}

export function describeCreditTotal(total: CreditTotal): string {
  const core = total.variable && total.max > total.min
    ? `${total.min} to ${total.max} credits`
    : `${total.min} credit${total.min === 1 ? '' : 's'}`;
  if (!total.unknown) return core;
  const noun = total.unknown === 1 ? 'course has' : 'courses have';
  return `${core}, plus ${total.unknown} ${noun} no credit hours listed in the catalog`;
}

/**
 * The one sentence a student should read about where they are in the degree.
 *
 * It names both halves on purpose. A screen that says "68 to 71 cr of 128"
 * while also saying "Already taken 5 courses" is telling somebody they are
 * further behind than the app's own data says, and the five courses they
 * mentioned are what makes the difference. Written for a student: no jargon,
 * no field names, and the hours they already hold said out loud.
 */
export function describeCreditProgress(
  credits: GeneratedPlan['credits'],
  /**
   * The degree's published total, from the catalog page. Not credits.degreeTotal,
   * which is only what these requirement blocks add up to and is smaller than the
   * degree whenever a page leaves a credit cell empty.
   */
  degreeTotal: number | null,
): string {
  const total = describeCreditTotal(credits.total);
  const head = degreeTotal === null ? total : `${total} of the ${degreeTotal} this degree takes`;
  if (credits.prior <= 0) return head;
  return `${head}. ${credits.prior} of those you already have, ${describeCreditTotal(credits.planned)} are in the plan.`;
}

/**
 * Why a plan runs past the degree's total, in one sentence, or null when it
 * does not.
 *
 * The hours past the total have three sources, and the note names the ones
 * that are there. The top-up that keeps every term at the student's minimum
 * is the only one the minimum explains: a Mechanical Engineering last term of
 * ten credits took a 4-credit elective to reach twelve. Maya's Computer
 * Engineering courses and her AP credit came to 130 of 128 before any
 * elective, with terms of 15 to 17, and "keep every term at the 12 you set as
 * a minimum" sent her to lower a setting that changes nothing. A part-time
 * Economics plan at 9 a term reached 122 because the elective that crossed
 * 120 carried 4 credits where 2 were left. Hours a named career track needs
 * have their own note and are only counted here.
 */
export function describeBeyondTotal(input: {
  degreeTotal: number;
  /** Everything the plan holds, prior credit included. */
  total: number;
  /** What the plan held before any elective: prior credit, requirements, list and gen-ed picks, prerequisites. */
  booked: number;
  prior: number;
  /** Hours past the total that the top-up to the per-term minimum added. */
  padded: number;
  /** Hours past the total that required courses of a named career track added. */
  track: number;
  minimum: number;
}): string | null {
  const beyond = Math.max(0, input.total - input.degreeTotal);
  if (Math.round(beyond) <= 0) return null;
  const padded = Math.min(beyond, Math.max(0, input.padded));
  const track = Math.min(beyond - padded, Math.max(0, input.track));
  const rest = beyond - padded - track;
  const required = Math.min(rest, Math.max(0, input.booked - input.degreeTotal));
  const sizes = rest - required;
  const n = (x: number) => Math.round(x);
  const credits = (x: number) => `${n(x)} ${n(x) === 1 ? 'credit' : 'credits'}`;
  const head = `${credits(beyond)} beyond the ${input.degreeTotal} this degree takes`;
  const lower = 'Lower that minimum in Preferences to finish with lighter terms instead.';
  if (n(padded) >= n(beyond)) return `${head} keep every term at the ${input.minimum} you set as a minimum. ${lower}`;
  const parts = [
    n(padded) > 0 ? `${n(padded)} keep every term at the ${input.minimum} you set as a minimum` : null,
    n(track) > 0 ? `${n(track)} are the courses your goal needs, named above` : null,
    n(required) > 0
      ? `${n(required)} ${n(required) === 1 ? 'comes' : 'come'} from the required courses, which${input.prior > 0 ? ` with the ${n(input.prior)} hours you bring` : ''} already come to ${n(input.booked)} before any elective`
      : null,
    n(sizes) > 0 ? `${n(sizes)} ${n(sizes) === 1 ? 'comes' : 'come'} from course sizes, since the elective that reached ${input.degreeTotal} carried more hours than were left` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  // One cause reads as a sentence of its own; several are listed with their shares.
  if (parts.length === 1 && n(padded) === 0) {
    if (n(required) > 0) {
      return `The required courses round this plan up to ${head}: what the requirements book${input.prior > 0 ? `, with the ${n(input.prior)} hours you bring,` : ''} already comes to ${n(input.booked)} before any elective.`;
    }
    if (n(sizes) > 0) return `Course sizes round this plan up to ${head}: the elective that reached ${input.degreeTotal} carried more hours than were left.`;
    return `The courses your goal needs, named above, take this plan to ${head}.`;
  }
  return `${head}: ${parts.join('; ')}.${n(padded) > 0 ? ` ${lower}` : ''}`;
}

/**
 * "Spread my hard classes out": whether the plan built at one hardest-band
 * course a term replaces the ordinary one, and the sentence that says what
 * happened.
 *
 * It is kept only when it costs nothing: no more courses left unplaced, no
 * more requirements open, no term added and no term harder than the
 * ordinary plan's hardest. When it is turned down the note names the check
 * that failed, with its numbers. A Mechanical Engineering freshman was told
 * one a term "would cost this plan courses it could not place" when nothing
 * was left unplaced and the real cost was a Fall 2027 with three
 * hardest-band courses; a Computer Engineering student with AP credit was
 * told "another term" when it was two terms and 19 credits.
 *
 * When it is kept the note says what the kept plan does, not what was
 * asked. An Economics plan was told hard courses "are spread one to a term
 * wherever the degree allows it" with MATH 441 and MATH 446 together in its
 * last term, and a Molecular and Cellular Biology plan that nothing moved
 * in was told the same. And since only the hardest band is counted, a term
 * that stays heavy on the band below is named: MATH 220 beside MCB 354 and
 * PHYS 102 is one hardest-band course and still a hard term.
 */
export function spreadHardOutcome(
  base: GeneratedPlan,
  spread: GeneratedPlan,
  options?: { difficulty?: (code: string) => number | null; bands?: PlanDifficultyBands | null },
): { adopt: boolean; note: string } {
  const used = (g: GeneratedPlan) => g.terms.filter((t) => t.codes.length > 0);
  const hardest = (g: GeneratedPlan) => Math.max(0, ...g.terms.map((t) => t.load.hard.length));
  const stacked = (g: GeneratedPlan) => g.terms.filter((t) => t.load.hard.length >= 2).map((t) => `${t.label} (${t.load.hard.join(', ')})`);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
  const last = (g: GeneratedPlan) => used(g).at(-1)?.label ?? null;

  const failed: string[] = [];
  const lostCourses = spread.notPlaced.filter((n) => !base.notPlaced.some((b) => b.code === n.code)).map((n) => n.code);
  if (spread.notPlaced.length > base.notPlaced.length) {
    const k = spread.notPlaced.length - base.notPlaced.length;
    failed.push(`leave ${count(k, 'more course', 'more courses')} unplaced${lostCourses.length > 0 ? ` (${lostCourses.slice(0, 4).join(', ')})` : ''}`);
  }
  if (spread.unsatisfied.length > base.unsatisfied.length) {
    failed.push(`leave ${count(spread.unsatisfied.length - base.unsatisfied.length, 'more requirement', 'more requirements')} open`);
  }
  const addedTerms = Math.max(spread.terms.length - base.terms.length, used(spread).length - used(base).length);
  if (addedTerms > 0) {
    const credits = Math.round(spread.credits.planned.min - base.credits.planned.min);
    failed.push(
      `add ${count(addedTerms, 'term', 'terms')}${credits > 0 ? ` and ${credits} credits` : ''}${last(spread) && last(base) ? `, finishing in ${last(spread)} instead of ${last(base)}` : ''}`,
    );
  }
  if (hardest(spread) > hardest(base)) {
    const worst = spread.terms.find((t) => t.load.hard.length === hardest(spread))!;
    failed.push(`put ${worst.load.hard.length} hardest-band courses in ${worst.label} (${worst.load.hard.join(', ')}), where no term now holds more than ${hardest(base)}`);
  }
  if (failed.length > 0) {
    const kept = stacked(base);
    return {
      adopt: false,
      note: `One hardest-band course a term was tried and not kept: it would ${list(failed)}.${kept.length > 0 ? ` So the plan keeps two where the degree needs them: ${kept.join('; ')}.` : ''}`,
    };
  }

  const changed = JSON.stringify(base.terms.map((t) => t.codes)) !== JSON.stringify(spread.terms.map((t) => t.codes));
  const still = stacked(spread);
  let note: string;
  if (still.length === 0) {
    note = changed
      ? 'Hard courses are spread one to a term: no term holds more than one hardest-band course.'
      : 'No term holds more than one hardest-band course already, so spreading them changed nothing.';
  } else {
    const where = `${still.join('; ')} ${still.length === 1 ? 'keeps' : 'keep'} two, because no other term before the finish takes either one without stacking there instead or coming after a course it prepares for`;
    note = changed ? `Hard courses are spread one to a term except where they cannot be: ${where}.` : `Spreading hard courses changed nothing here: ${where}.`;
  }
  // The band below the hardest is not counted above, so a term heavy on it is said out loud.
  const bands = options?.bands ?? null;
  const difficulty = options?.difficulty;
  if (bands && difficulty) {
    const heavy = used(spread)
      .filter((t) => t.load.hard.length <= 1 && (t.load.bandVerdict === 'heavy' || t.load.bandVerdict === 'brutal'))
      .sort((a, b) => (b.load.avgDifficulty ?? 0) - (a.load.avgDifficulty ?? 0));
    const worst = heavy[0];
    if (worst) {
      const harder = worst.codes.filter((c) => {
        const d = difficulty(c);
        return d !== null && d >= bands.harder && d < bands.hardest;
      });
      const avg = Math.round(worst.load.avgDifficulty ?? 0);
      const why =
        harder.length === 0
          ? `at an average difficulty of ${avg}`
          : worst.load.hard.length > 0
            ? `${worst.load.hard[0]} sits with ${list(harder)}, one band below, for an average difficulty of ${avg}`
            : `${list(harder)}, one band below the hardest, average ${avg}`;
      const others = heavy.length > 1 ? `; ${count(heavy.length - 1, 'other term reads', 'other terms read')} heavy too` : '';
      note += ` That counts only the hardest band, so ${worst.label} still reads heavy${harder.length === 0 ? ' ' : ': '}${why}${others}.`;
    }
  }
  return { adopt: true, note };
}

// ---------------------------------------------------------------------------
// Requirement slots.
// ---------------------------------------------------------------------------

interface PlanSlot {
  key: string;
  requirementId: string;
  areaLabel: string;
  label: string;
  kind: 'all' | 'choose' | 'hours' | 'pool' | 'gened';
  /** One entry per interchangeable set. "CS 210 or CS 211" is one entry with two codes. */
  options: string[][];
  picks: number | null;
  hoursTarget: number | null;
  /**
   * Gen-ed only: the courses the degree page says already cover this category,
   * in the page's own order, each entry one slot with its alternatives folded in.
   */
  fulfilledBy?: string[][];
  /** Gen-ed only: categories sharing this name may not share a course. */
  exclusiveGroup?: string;
  /** Gen-ed and gen-ed hours slots: the catalog tags that count. */
  tags?: string[];
  /** Pools only: the named lists inside the pool, and the rules over them. */
  lists?: PlanPoolList[];
  constraints?: PlanPoolConstraint[];
  /** Pools only: the catalog sentence, so the report can quote it. */
  note?: string;
  /** Required rows only: the page's own substitutes, by the row's first code. */
  standIns?: Map<string, string[]>;
  url: string;
}

function slotsFor(requirement: PlanRequirement, ctx: PlanningContext, who: Audience = NOBODY): PlanSlot[] {
  const rule = requirement.rule;
  const base = {
    requirementId: requirement.id,
    areaLabel: requirement.areaLabel,
    label: requirement.label || requirement.areaLabel,
    url: requirement.url,
  };

  if (rule.kind === 'all') {
    return rule.choices.map((choice, index) => ({
      ...base,
      key: `${requirement.id}#${index}`,
      kind: 'all' as const,
      options: [choice.codes.map(normaliseCode)],
      picks: 1,
      hoursTarget: null,
      standIns: new Map([[normaliseCode(choice.codes[0]), (choice.substitutes ?? []).map(normaliseCode)]]),
    }));
  }

  if (rule.kind === 'choose') {
    return [{
      ...base,
      key: `${requirement.id}#choose`,
      kind: 'choose' as const,
      options: rule.choices.map((choice) => choice.codes.map(normaliseCode)),
      picks: rule.n,
      hoursTarget: null,
    }];
  }

  if (rule.kind === 'pool') {
    // A pool with neither an hours target nor a count is not plannable: the
    // page named a list and never said how much of it to take. It is reported
    // rather than filled, because taking a guess at the number is the same
    // failure as taking every course on the list.
    if (rule.hours === null && rule.n === null) return [];
    return [{
      ...base,
      key: `${requirement.id}#pool`,
      kind: 'pool' as const,
      options: rule.choices.map((choice) => choice.codes.map(normaliseCode)),
      picks: rule.n,
      hoursTarget: rule.hours,
      lists: rule.lists,
      constraints: rule.constraints,
      note: requirement.note,
    }];
  }

  if (rule.kind === 'gened') {
    /**
     * A category is filled from the catalog's own gen-ed tagging.
     *
     * 935 Illinois courses carry at least one published category string, and a
     * course carrying this category's string is a course that counts for it.
     * That is the catalog's statement, not this planner's guess, which is why
     * a category whose strings we do not have is reported instead of filled.
     */
    if (rule.genEd.length === 0) return [];
    const wanted = new Set(rule.genEd);
    const eligible = ctx.courses
      .filter((course) => course.tags.some((tag) => wanted.has(tag)) && !titleClosesTo(course, who))
      .map((course) => normaliseCode(course.code))
      .sort();
    return [{
      ...base,
      key: `${requirement.id}#gened`,
      kind: 'gened' as const,
      tags: rule.genEd,
      options: eligible.map((code) => [code]),
      picks: rule.courses,
      hoursTarget: rule.hours,
      fulfilledBy: rule.fulfilledBy.map((option) => option.map(normaliseCode)),
      exclusiveGroup: rule.exclusiveGroup,
      note: rule.text,
    }];
  }

  if (rule.kind === 'hours') {
    // A gen-ed block names hours and a category, never courses. The category
    // maps to the catalog's own published gen-ed strings, which is why any
    // course carrying one of those tags is a legitimate fill. A block with no
    // category cannot be filled and is reported, not guessed at.
    if (!rule.genEd || rule.genEd.length === 0) return [];
    const wanted = new Set(rule.genEd);
    // "Exceptions to the list are: ASTR 100, PHYS 101 and PHYS 102, and CHEM
    // 101": the page's own words about which tagged courses do not count.
    const banned = new Set((rule.exclude ?? []).map(normaliseCode));
    const eligible = ctx.courses
      .filter((course) => course.tags.some((tag) => wanted.has(tag)) && !titleClosesTo(course, who))
      .map((course) => normaliseCode(course.code))
      .filter((code) => !banned.has(code))
      .sort();
    return [{
      ...base,
      key: `${requirement.id}#hours`,
      kind: 'hours' as const,
      tags: rule.genEd ?? [],
      options: eligible.map((code) => [code]),
      picks: null,
      hoursTarget: rule.hours,
    }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Ranking candidates inside a slot.
// ---------------------------------------------------------------------------

interface Ranker {
  (code: string): number[];
}

function makeRanker(
  ctx: PlanningContext,
  byCode: Map<string, Course>,
  depth: Map<string, number>,
  policy: 'lightest' | 'catalog-order' | 'priorities',
  quality?: (code: string) => QualityResult,
  programName?: string,
  programCollege?: string,
): Ranker {
  const dormant = dormantCheck(ctx);
  const closed = closedToMajorCheck(ctx, programName, programCollege);
  /**
   * "ESL 115 placement result on the English Placement Test." is a gate the
   * plan cannot assume a student clears, and the course behind it is meant
   * for a particular group. It was winning Composition I over RHET 105 on
   * grade history alone. Anything gated on a placement or proficiency test
   * sorts behind its peers; it is still there to pick by hand.
   */
  const gated = (code: string): boolean => {
    const spec = ctx.prereqs?.get(code);
    return Boolean(spec && !spec.parsed && /placement|proficiency (test|exam)|by permission|consent of/i.test(spec.text));
  };
  return (code: string) => {
    const course = byCode.get(code);
    // A course that is not in the catalog snapshot has no credits and no
    // prerequisites, so putting it in a plan would be asserting something we
    // cannot back. It sorts last and is reported if it is all that is left.
    // A course that has not run in any recent term sorts just before it: it
    // is in the catalog, and nobody has been able to take it, and a course
    // gated on a test just before that.
    const inCatalog = course ? (dormant(code) ? 0.5 : closed(code) ? 0.4 : gated(code) ? 0.25 : 0) : 1;
    // A shallow prerequisite chain comes before any preference, because chain
    // length decides whether the plan is possible and difficulty only decides
    // whether it is pleasant. Picking CS 211, which sits behind CS 225, over
    // CS 210, which sits behind nothing, buys a slightly easier course and
    // costs two terms of ordering.
    const chain = depth.get(code) ?? 0;
    if (policy === 'catalog-order') return [inCatalog, chain];

    /**
     * The student's priorities, when the engine has them.
     *
     * The score is over the measures the data can speak to, so two courses
     * with the same score and different amounts of evidence are not the same
     * choice: the one more is known about goes first. A course nothing is
     * known about sorts last, as it did under the plain policy, and for the
     * same reason.
     */
    if (policy === 'priorities' && quality) {
      const q = quality(code);
      return [inCatalog, chain, q.known === 0 ? 1 : 0, -Math.round(q.score * 1000), -q.known];
    }

    const difficulty = ctx.grades?.get(code)?.difficulty ?? null;
    // No grade history sorts after graded courses, not because it is harder but
    // because there is nothing to weigh. The plan says how many it could not weigh.
    const graded = difficulty === null ? 1 : 0;
    return [inCatalog, chain, graded, difficulty ?? 0];
  };
}

function compareRank(a: number[], b: number[], codeA: string, codeB: string): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return codeA.localeCompare(codeB);
}

// ---------------------------------------------------------------------------
// Pools: "take N hours from this list".
// ---------------------------------------------------------------------------

/**
 * How many courses a candidate drags into the plan behind it.
 *
 * "Prefer courses the student can actually reach" is not the same as "prefer
 * easy courses". Two technical electives can look identical on grade history
 * and one of them sits behind three courses nobody has taken. Picking that one
 * spends a year of terms on prerequisites for an elective the student could
 * have swapped for its neighbour, and the plan then reports the neighbour as
 * not fitting.
 *
 * Only groups the parser is confident about are followed, for the same reason
 * the prerequisite closure skips the rest: a low-confidence group may be an OR
 * the parser read as an AND, and charging a course for prerequisites the
 * catalog may not have would push a perfectly reachable course down the list.
 *
 * Counted, never simulated. Placement still runs the real ordering check; this
 * only decides which door to try first.
 */
function prerequisiteCost(
  code: string,
  have: Set<string>,
  prereqs: Map<string, PlanPrereq> | undefined,
  equivalents: Map<string, string[]>,
  byCode: Map<string, Course>,
  memo: Map<string, number>,
  visiting: Set<string>,
  depth = 0,
): number {
  const hit = memo.get(code);
  if (hit !== undefined) return hit;
  // A prerequisite loop is a real thing in this catalog (CS 374 and ECE 374
  // name each other). Returning zero for a course already on the stack ends the
  // walk without pretending the loop is free for the course that opened it.
  if (visiting.has(code) || depth >= 5) return 0;

  visiting.add(code);
  let cost = 0;
  const spec = prereqs?.get(code);
  if (spec?.parsed) {
    for (const group of spec.groups) {
      if (group.confidence === 'low') continue;
      const alternatives = group.any.flatMap((raw) =>
        expandEquivalents(normaliseCode(raw), equivalents),
      );
      if (alternatives.some((alt) => have.has(alt))) continue;
      const usable = alternatives.filter((alt) => byCode.has(alt));
      // Not in this snapshot at all. The prerequisite closure reports that as
      // its own note; charging the candidate for it here would rank a course
      // down for a gap in our data rather than for anything the student faces.
      if (usable.length === 0) continue;
      let best = Number.POSITIVE_INFINITY;
      for (const alt of usable) {
        best = Math.min(
          best,
          1 + prerequisiteCost(alt, have, prereqs, equivalents, byCode, memo, visiting, depth + 1),
        );
      }
      cost += best;
    }
  }
  visiting.delete(code);
  memo.set(code, cost);
  return cost;
}

interface PoolContext {
  byCode: Map<string, Course>;
  /** Courses the student already has. They fill the pool without being planned. */
  earned: Set<string>;
  /** Courses already committed to another requirement. */
  taken: Set<string>;
  creditsOf: (code: string) => number;
  /** A total order over candidates, cheapest first. */
  order: (a: string, b: string) => number;
  /** False when a course's prerequisite chain cannot fit before graduation. */
  reachable: (code: string) => boolean;
  /**
   * "Credit is not given for both X and Y": the course that stops this one, or
   * null. It looks at what the student walked in with and at what the rest of
   * the plan has already booked, not only at this pool. A pool that checked
   * itself alone is how MATH 225 reached a plan that already required MATH 257.
   */
  conflict: (code: string, insidePool: Set<string>) => string | null;
  /**
   * Courses the rows nested inside this one have already counted. "Technical
   * Electives, 30 hours, to include: at least 3 Advanced Computing Electives"
   * makes those three part of the thirty, not three more on top of it.
   */
  nested?: Set<string>;
}

interface PoolFill {
  picked: string[];
  free: string[];
  /** Courses a nested row counted, which count here too. */
  nested: string[];
  alternatives: string[];
  /** Rows the page lists, and how many of them this catalog snapshot has. */
  listed: number;
  available: number;
  /**
   * Courses on this list the plan left alone because their credit would not
   * count. They are kept out of `alternatives` as well: offering a student a
   * swap they cannot take is the same wrong answer in a friendlier place.
   */
  excluded: Array<{ code: string; by: string }>;
  constraints: Array<{ text: string; n: number; met: boolean; from: string | null; picked: string[] }>;
}

/**
 * Choose courses out of a pool until its hours and its count are met.
 *
 * Constraints are satisfied before the free top-up, and the tightest one goes
 * first. A sentence that pins its courses to a SINGLE list has the fewest ways
 * to be satisfied, and doing it first lets the looser sentences count the same
 * courses, which is exactly what the CS page means when it says the team
 * project course may also be one of the three from a focus area.
 *
 * A constraint that cannot be met is left unmet and reported. Quietly filling
 * the pool with six courses that break the focus-area rule would hand a student
 * a plan their advisor rejects, which is worse than a plan that says out loud
 * which sentence it could not honour.
 */
function fillPool(slot: PlanSlot, pool: PoolContext): PoolFill {
  const free: string[] = [];
  const candidates: string[] = [];
  let available = 0;

  for (const option of slot.options) {
    // One option is one catalog row: "CS 210 or CS 211" is a single slot in the
    // list with two ways to fill it, not two courses towards the count.
    const already = option.find((code) => pool.earned.has(code));
    if (already) {
      free.push(already);
      available += 1;
      continue;
    }
    const known = option.filter((code) => pool.byCode.has(code));
    // The page lists it and this snapshot does not have it. Counted out of
    // `available` so the report can say how many of the listed courses are
    // really here, rather than blaming the data for a placement shortfall.
    if (known.length === 0) continue;
    available += 1;
    const usable = known.filter((code) => !pool.taken.has(code) && pool.reachable(code));
    if (usable.length === 0) continue;
    candidates.push(usable.slice().sort(pool.order)[0]);
  }
  candidates.sort(pool.order);
  const traced = typeof process !== 'undefined' && process.env ? process.env.PLAN_DEBUG : undefined;
  if (traced && slot.options.some((o) => o.map(normaliseCode).includes(normaliseCode(traced)))) {
    const t = normaliseCode(traced);
    console.error(`  [PLAN_DEBUG] ${t} in list "${slot.label.slice(0, 50)}": taken ${pool.taken.has(t)}, reachable ${pool.reachable(t)}, candidate rank ${candidates.indexOf(t)} of ${candidates.length}; first five ${candidates.slice(0, 5).join(', ')}`);
  }

  const picked: string[] = [];
  const held = new Set<string>(free);
  const listed = new Set(slot.options.flat().map(normaliseCode));
  const nested = [...(pool.nested ?? [])].filter((code) => listed.has(code) && !held.has(code));
  for (const code of nested) held.add(code);
  const remaining = new Set(candidates.filter((code) => !held.has(code)));
  const excluded = new Map<string, string>();

  const blocked = (code: string): boolean => {
    const by = pool.conflict(code, held);
    if (by === null) return false;
    if (!excluded.has(code)) excluded.set(code, by);
    return true;
  };

  const take = (code: string): void => {
    remaining.delete(code);
    picked.push(code);
    held.add(code);
  };

  const openBy = (order: (a: string, b: string) => number, within?: Set<string>): string[] =>
    [...remaining]
      .filter((code) => !blocked(code) && (!within || within.has(code)))
      .sort(order);

  /**
   * Satisfy the constraints before the free top-up, tightest first.
   *
   * A sentence that pins its courses to a SINGLE list has the fewest ways to be
   * satisfied, and doing it first lets the looser sentences count the same
   * courses, which is exactly what the CS page means when it says the team
   * project course may also be one of the three from a focus area.
   *
   * This loop only CHOOSES. Whether each sentence came out satisfied is read
   * off the result by constraintStatus below, so a constraint this loop could
   * not fill and one the free top-up happened to fill are each reported for
   * what they are rather than for what was attempted.
   */
  const ordered = (slot.constraints ?? [])
    .slice()
    .sort((a, b) => Number(b.single) - Number(a.single) || b.n - a.n);

  for (const c of ordered) {
    const lists = c.lists.map((l) => ({ label: l.label, codes: new Set(l.codes.map(normaliseCode)) }));
    if (lists.length === 0) continue;

    if (c.single && lists.length > 1) {
      let best: { fill: string[] } | null = null;
      for (const list of lists) {
        const already = [...held].filter((code) => list.codes.has(code)).length;
        const need = c.n - already;
        const fill = need <= 0 ? [] : openBy(pool.order, list.codes).slice(0, need);
        // A list that cannot supply the shortfall cannot satisfy the sentence.
        // Half-filling it would spend the pool's budget and satisfy nothing.
        if (fill.length < Math.max(0, need)) continue;
        if (!best || cheaperFill({ fill }, best, pool.order)) best = { fill };
      }
      // No list can carry it. Left unmet on purpose: the report says which
      // sentence failed, and a plan that silently breaks a rule the catalog
      // states is one an advisor sends back.
      if (!best) continue;
      for (const code of best.fill) take(code);
      continue;
    }

    const union = new Set(lists.flatMap((l) => [...l.codes]));
    const already = [...held].filter((code) => union.has(code)).length;
    const need = c.n - already;
    if (need <= 0) continue;
    for (const code of openBy(pool.order, union).slice(0, need)) take(code);
  }

  const hoursHeld = (): number => [...held].reduce((sum, code) => sum + pool.creditsOf(code), 0);
  const short = (): boolean =>
    (slot.hoursTarget !== null && hoursHeld() < slot.hoursTarget) ||
    (slot.picks !== null && held.size < slot.picks);

  while (short()) {
    const next = openBy(pool.order)[0];
    if (!next) break;
    take(next);
  }

  return {
    picked,
    free,
    nested,
    alternatives: openBy(pool.order),
    listed: slot.options.length,
    available,
    excluded: [...excluded.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, by]) => ({ code, by })),
    // Reported from what the pool ended up holding, not from what the loop
    // above reached for. The free top-up can land inside a list a constraint
    // cares about, and calling that constraint unmet would send a student to
    // fix something that is already right.
    constraints: (slot.constraints ?? []).map((c) => ({
      text: c.text,
      n: c.n,
      ...constraintStatus(c, held),
    })),
  };
}

/**
 * What one constraint holds, given the courses actually in hand.
 *
 * Used twice and deliberately so: once when the pool is filled, and again after
 * placement, because a course the pool chose and no term had room for is not in
 * the plan and must not count towards "three from a single focus area".
 *
 * For a single-list sentence the answer is the fullest list, not the union.
 * Two courses from Media and two from Machines satisfy nothing the CS page
 * asked for, and summing them to four would report a plan as sound when an
 * advisor will reject it.
 */
function constraintStatus(
  c: PlanPoolConstraint,
  held: Set<string>,
): { met: boolean; from: string | null; picked: string[] } {
  const lists = c.lists.map((l) => ({ label: l.label, codes: new Set(l.codes.map(normaliseCode)) }));
  if (lists.length === 0) return { met: true, from: null, picked: [] };

  if (c.single && lists.length > 1) {
    let best: { label: string; picked: string[] } = { label: lists[0].label, picked: [] };
    for (const list of lists) {
      const picked = [...held].filter((code) => list.codes.has(code)).sort();
      if (picked.length > best.picked.length) best = { label: list.label, picked };
    }
    return {
      met: best.picked.length >= c.n,
      from: best.picked.length > 0 ? best.label : null,
      picked: best.picked,
    };
  }

  const union = new Set(lists.flatMap((l) => [...l.codes]));
  const picked = [...held].filter((code) => union.has(code)).sort();
  return { met: picked.length >= c.n, from: lists.length === 1 ? lists[0].label : null, picked };
}

/** Fewest new courses wins, then the cheaper set of them. Total, so it is stable. */
function cheaperFill(
  a: { fill: string[] },
  b: { fill: string[] },
  order: (x: string, y: string) => number,
): boolean {
  if (a.fill.length !== b.fill.length) return a.fill.length < b.fill.length;
  for (let i = 0; i < a.fill.length; i += 1) {
    const diff = order(a.fill[i], b.fill[i]);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Terms.
// ---------------------------------------------------------------------------

/**
 * Whether a course is out of its season in a term. Fall and spring follow the
 * published offering history. A summer term is planned only when the student
 * asks for one, and only a course the university has run in a summer goes in
 * it: nothing else on record says it will be there.
 */
function outOfSeason(course: { offeredIn: SemesterSeason[] } | undefined, season: SemesterSeason, published: boolean): boolean {
  if (!course) return false;
  if (season === 'Summer') return !course.offeredIn.includes('Summer');
  return published && course.offeredIn.length > 0 && !course.offeredIn.includes(season);
}

/** A summer term's load: an aim and a ceiling well under a fall or spring. */
const SUMMER_AIM = 6;
const SUMMER_MAX = 9;

/**
 * The terms a plan is built over, in calendar order.
 *
 * Fall and spring always; a summer only when the student asked for it or
 * graduates in it; a term away (study abroad, a co-op, a gap semester) left
 * out, so nothing is booked while the student is not here and the rest of the
 * plan fits around it. A summer graduation used to have no exit at all: the
 * loop stepped fall to spring to fall, never reached "Summer 2029", and built
 * the 32-term guard instead, a plan a year longer than asked.
 */
function buildHorizon(horizon: Horizon): Array<{ id: string; label: string; season: SemesterSeason; calendarYear: number; index: number }> {
  const out: Array<{ id: string; label: string; season: SemesterSeason; calendarYear: number; index: number }> = [];
  const summers = new Set(horizon.summers ?? []);
  if (horizon.gradSeason === 'Summer') summers.add(horizon.gradYear);
  const away = new Set((horizon.away ?? []).map((a) => `${a.season} ${a.year}`));
  let season: SemesterSeason = horizon.startSeason === 'Summer' ? 'Summer' : horizon.startSeason;
  let year = horizon.startYear;
  const ord = (s: SemesterSeason, y: number) => y * 3 + (s === 'Spring' ? 0 : s === 'Summer' ? 1 : 2);
  const end = ord(horizon.gradSeason, horizon.gradYear);
  // A guard rather than a limit anybody should hit: eight years of terms is far
  // past any real plan, and an unbounded loop on a bad graduation date would hang
  // the browser instead of showing an error.
  for (let step = 0; step < 40 && out.length < 32; step += 1) {
    if (ord(season, year) > end) break;
    if (!away.has(`${season} ${year}`)) {
      out.push({ id: termIdFor(season, year), label: `${season} ${year}`, season, calendarYear: year, index: out.length });
    }
    if (season === horizon.gradSeason && year === horizon.gradYear) return out;
    if (season === 'Fall') {
      season = 'Spring';
      year += 1;
    } else if (season === 'Spring') {
      season = summers.has(year) ? 'Summer' : 'Fall';
    } else {
      season = 'Fall';
    }
  }
  // A graduation before the start is a misread the caller reports; the plan
  // still needs a column to put a course in.
  if (out.length === 0) out.push({ id: termIdFor(horizon.startSeason, horizon.startYear), label: `${horizon.startSeason} ${horizon.startYear}`, season: horizon.startSeason, calendarYear: horizon.startYear, index: 0 });
  return out;
}

/**
 * The smallest set of courses that unblock each other in one term, or null.
 *
 * Grown one course at a time from each stalled candidate: take what it is
 * missing, and if every missing group is concurrent, pull in one alternative
 * per group and ask again. The set is accepted only when every member passes
 * with the whole set present, so a bundle never papers over a real ordering
 * prerequisite. Capped at six, past which this is not a co-requisite sequence
 * and the honest answer is the "could not place" report.
 */
function findCoRequisiteBundle(
  remaining: Set<string>,
  earlier: Set<string>,
  sameTerm: Set<string>,
  ctx: PlanningContext,
  equivalents: Map<string, string[]>,
  match: PrereqMatcher,
  allowedHere: (code: string) => boolean,
): string[] | null {
  const MAX_BUNDLE = 6;

  const grow = (seed: string): string[] | null => {
    const bundle = new Set<string>([seed]);

    for (let round = 0; round <= MAX_BUNDLE; round += 1) {
      const withBundle = new Set(sameTerm);
      for (const code of bundle) for (const equiv of expandEquivalents(code, equivalents)) withBundle.add(equiv);

      let complete = true;
      let added = false;
      // A snapshot, because the loop adds to the bundle. Iterating the live Set
      // would check a course against a set it is still growing into and settle
      // on a bundle that was never verified as a whole.
      const thisRound = Array.from(bundle);
      for (const code of thisRound) {
        const { missing } = match(ctx.prereqs?.get(code), earlier, withBundle, equivalents);
        if (missing.length === 0) continue;
        complete = false;
        for (const group of missing) {
          // A group that is not marked concurrent belongs in an earlier term.
          // No amount of bundling makes it legal, so this seed is simply not
          // ready yet.
          if (!group.concurrent) return null;
          const candidate = group.any
            .flatMap((raw) => expandEquivalents(normaliseCode(raw), equivalents))
            .filter((alt) => remaining.has(alt) && !bundle.has(alt) && allowedHere(alt))
            .sort()[0];
          if (!candidate) return null;
          bundle.add(candidate);
          added = true;
        }
      }
      if (complete) return bundle.size > 1 ? [...bundle].sort() : null;
      if (!added || bundle.size > MAX_BUNDLE) return null;
    }
    return null;
  };

  for (const seed of [...remaining].sort()) {
    if (!allowedHere(seed)) continue;
    const bundle = grow(seed);
    if (bundle) return bundle;
  }
  return null;
}

// ---------------------------------------------------------------------------
// generatePlan
// ---------------------------------------------------------------------------

/**
 * Electives: the shared rules for what fills a slot, used by generatePlan when
 * it fills a plan and by electiveOptions when a student opens a slot to choose.
 * Two copies of these rules would drift, and the chooser would then offer a
 * course the plan had refused, or refuse one it had placed.
 */
interface ElectiveScoring {
  byCode: Map<string, Course>;
  /** The subject the degree names most: FIN for Finance, CS for Computer Science. */
  primarySubject: string | null;
  degreeSubjects: Set<string>;
  interestWords: string[];
  sectionCount: (code: string) => number;
  isHard: (code: string) => boolean;
  prereqs?: Map<string, PlanPrereq>;
  creditRanges?: Map<string, PlanCreditRange>;
  creditsOf: (code: string) => number;
  /** The student's priorities, applied to every measure the data has. */
  quality: (code: string) => QualityResult;
  /** Has not run in any recent term. */
  dormant?: (code: string) => boolean;
  /** Every crawled section is restricted to some other major, or to graduate students. */
  closedToMajor?: (code: string) => boolean;
  /** Ran in only one of the crawled terms, so it may not run every year. */
  rare?: (code: string) => boolean;
}

/**
 * Whether a restriction sentence shuts this program out.
 *
 * "Restricted to Mechanical Engineering major(s)." shuts out a Finance
 * student and not a Mechanical Engineering one; "Restricted to students with
 * Junior class standing" shuts out nobody in particular. The program's own
 * name, word by word, is the test, and "Undeclared" and "any major" pass.
 */
/** How the catalog names each college, lower-cased, so a restriction naming the college matches its own students. */
export const COLLEGE_WORDS: Record<string, string[]> = {
  bus: ['gies', 'college of business', 'business'],
  engineering: ['grainger', 'college of engineering', 'engineering'],
  las: ['liberal arts', 'las '],
  aces: ['aces', 'agricultural, consumer'],
  faa: ['fine and applied', 'faa', 'art & design', 'art and design', 'architecture', 'music', 'theatre', 'dance'],
  media: ['college of media', 'media', 'journalism', 'advertising'],
  education: ['college of education', 'education'],
  ahs: ['applied health', 'ahs', 'kinesiology', 'community health', 'speech and hearing', 'recreation'],
  socw: ['social work'],
  ischool: ['information sciences', 'ischool'],
};

/**
 * Whether a registration restriction shuts this program out.
 *
 * "Restricted to Mechanical Engineering major(s)." shuts out a Finance
 * student and not a Mechanical Engineering one; "Restricted to Gies College
 * of Business" shuts out an ACES student and not a Finance one; "Restricted
 * to Undergrad - Urbana-Champaign" shuts out nobody here; "Restricted to
 * Graduate - Urbana-Champaign" shuts out everyone here; a standing-only
 * restriction is a different rule and is left to the standing check. "Not
 * intended for" is advice, not a restriction. Sections at Illinois often
 * carry these only through the early registration window, so a hit is a
 * warning to check, never a refusal.
 */
export function restrictionClosesTo(text: string, programName: string | undefined, college?: string): boolean {
  const t = text.toLowerCase();
  if (!/restricted to/.test(t)) return false;
  if (/undergrad - urbana|undergraduate - urbana/.test(t)) return false;
  if (/graduate - urbana|\bgraduate students?\b/.test(t) && !/undergrad/.test(t)) return true;
  if (/class standing|freshman|sophomore|junior|senior/.test(t) && !/major|college|school of|program|department|concentration|curriculum/.test(t)) return false;
  if (/undeclared|any major|all majors|first time freshman/.test(t)) return false;
  if (college && (COLLEGE_WORDS[college] ?? []).some((w) => t.includes(w))) return false;
  const words = (programName ?? '')
    .replace(/,.*$/, '')
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length > 3 && !/^(and|with|the|studies|science|sciences|engineering|arts|general|program)$/i.test(w));
  if (words.some((w) => t.includes(w.toLowerCase()))) return false;
  return /major|college|school of|program|department|concentration|curriculum|students in/.test(t);
}

/**
 * A prerequisite sentence that names another college, "Restricted to Gies
 * College of Business students", when this degree is not in that college.
 * Colleges only: a sentence naming a major is too often the student's own
 * department under another name to act on.
 */
export function prereqNamesOtherCollege(text: string | undefined, college: string | undefined): string | null {
  if (!text || !college) return null;
  const m = text.match(/restricted to ([^.;]*?)(?:students|majors?)\b/i);
  if (!m) return null;
  const phrase = m[0].toLowerCase();
  for (const [code, words] of Object.entries(COLLEGE_WORDS)) {
    if (code === college) continue;
    if (words.some((w) => w.length > 4 && phrase.includes(w)) && !(COLLEGE_WORDS[college] ?? []).some((w) => phrase.includes(w))) return m[0].trim();
  }
  return null;
}

/** "Admission to a teacher education program" and its kin: a milestone with its own application, not a course. */
export function prereqNeedsAdmission(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(admission to|admitted to|accepted into)\s+(the |a |an )?[^.;]*(program|school|college|major|curriculum)/i);
  return m ? m[0].trim() : null;
}

/** Closed to this program in every crawled section it has. */
export function closedToMajorCheck(ctx: PlanningContext, programName: string | undefined, college?: string): (code: string) => boolean {
  return (code) => {
    const s = ctx.sections?.get(code);
    if (!s || !s.restrictions || s.restrictions.length === 0) return false;
    return s.restrictions.every((r) => restrictionClosesTo(r, programName, college));
  };
}

/** Ran in exactly one of the crawled terms, when there are enough terms for that to mean something. */
function rareCheck(ctx: PlanningContext): (code: string) => boolean {
  const terms = ctx.offeringTerms ?? [];
  if (!ctx.offerings || terms.length < 4) return () => false;
  return (code) => (ctx.offerings?.get(code) ?? []).length === 1;
}

/**
 * The scorer every choice reads, built once per plan.
 *
 * `wantedTags` is what the general education blocks still ask for at the
 * moment the choice is made, so a free elective that also clears one of them
 * scores as the two-for-one it is.
 */
/**
 * The excellent-teacher list, looked up through cross-listings. The list is
 * filed under whichever code the department printed, so AAS 201 had no entry
 * while its twin PS 201 did, and scored no teaching at all. Grades already get
 * this treatment through gradeFrom.
 */
const excellentTwinCache = new WeakMap<object, Map<string, ExcellentSummary>>();

function excellentWithTwins(ctx: PlanningContext): Map<string, ExcellentSummary> | undefined {
  const list = ctx.excellent;
  if (!list) return undefined;
  const cached = excellentTwinCache.get(list);
  if (cached) return cached;
  const out = new Map(list);
  for (const [code, twins] of ctx.equivalents ?? new Map<string, string[]>()) {
    if (out.has(code)) continue;
    const found = twins.map(normaliseCode).map((t) => list.get(t)).find(Boolean);
    if (found) out.set(code, found);
  }
  excellentTwinCache.set(list, out);
  return out;
}

function qualityFor(
  ctx: PlanningContext,
  byCode: Map<string, Course>,
  opts: {
    priorities?: Priorities;
    interestWords: string[];
    /** The student's words as career-tracks.ts reads them. */
    profile?: InterestProfile;
    primarySubject: string | null;
    degreeSubjects: Set<string>;
    wantedTags: Set<string>;
  },
): (code: string) => QualityResult {
  const inputs: QualityInputs = {
    priorities: opts.priorities ?? DEFAULT_PRIORITIES,
    interestWords: opts.interestWords,
    curatedWords: opts.profile?.words,
    interestSubjects: opts.profile ? new Set(opts.profile.subjects) : undefined,
    interestCourses: opts.profile ? new Set(opts.profile.courses.map(normaliseCode)) : undefined,
    primarySubject: opts.primarySubject,
    degreeSubjects: opts.degreeSubjects,
    wantedTags: opts.wantedTags,
    grades: ctx.grades,
    bands: ctx.bands ?? null,
    sections: ctx.sections
      ? new Map(
          [...ctx.sections].map(([code, s]) => [
            code,
            { total: s.total, earliest: s.earliest ?? null, onlineOnly: s.onlineOnly ?? false, instructors: s.instructors ?? [], meet: s.meet, lateOption: s.lateOption },
          ]),
        )
      : undefined,
    excellent: excellentWithTwins(ctx),
    excellentTerms: ctx.excellentTerms,
    nowLabel: ctx.snapshotTerm?.label ?? null,
  };
  const memo = new Map<string, QualityResult>();
  return (code: string) => {
    const hit = memo.get(code);
    if (hit) return hit;
    const course = byCode.get(code);
    const result = course
      ? scoreQuality({ code, title: course.title, cluster: course.cluster, tags: course.tags, credits: course.credits }, inputs)
      : { score: 0, known: 0, reasons: [], unknown: [] };
    memo.set(code, result);
    return result;
  };
}

/**
 * The scorer, for surfaces outside a plan build: the chooser's reasons, the
 * bot's search results and course details, the card dropdown. The same
 * function the fill uses, so the reasons on a card are the reasons it was
 * picked. `carriedCodes` are what is on the board or already held, so a
 * category they cover stops counting as wanted.
 */
export function qualityScorer(input: {
  context: PlanningContext;
  requirements: PlanRequirement[];
  interests?: string;
  programName?: string;
  priorities?: Priorities;
  carriedCodes?: Iterable<string>;
}): (code: string) => QualityResult {
  const ctx = input.context;
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  const majors = degreeSubjectsOf(input.requirements, input.programName);
  const carried = new Set<string>();
  for (const raw of input.carriedCodes ?? []) for (const t of byCode.get(normaliseCode(raw))?.tags ?? []) carried.add(t);
  const wantedTags = new Set([...genEdTagsOf(input.requirements)].filter((t) => !carried.has(t)));
  return qualityFor(ctx, byCode, {
    priorities: input.priorities,
    interestWords: interestWordsOf(input.interests),
    profile: interestProfileOf(input.interests),
    primarySubject: majors.primary,
    degreeSubjects: majors.subjects,
    wantedTags,
  });
}

/**
 * Whether a course has run in none of the recent terms the crawl covers.
 * Always false when no offering history is loaded, because absence of data
 * is not absence of the course.
 */
function dormantCheck(ctx: PlanningContext): (code: string) => boolean {
  const terms = ctx.offeringTerms ?? [];
  const map = ctx.offerings;
  if (!map || terms.length === 0) return () => false;
  return (code) => (map.get(code) ?? []).length === 0;
}

/** "Fall 2026, Spring 2026 and Fall 2025", or null when no history is loaded. */
export function offeredLine(ctx: PlanningContext, code: string): string | null {
  const terms = ctx.offeringTerms ?? [];
  if (!ctx.offerings || terms.length === 0) return null;
  const ran = ctx.offerings.get(code) ?? [];
  const word = (t: string) => {
    const m = t.match(/^(sp|su|fa|wi)(\d{4})$/);
    return m ? `${{ sp: 'Spring', su: 'Summer', fa: 'Fall', wi: 'Winter' }[m[1]]} ${m[2]}` : t;
  };
  const span = `${word(terms[terms.length - 1])} to ${word(terms[0])}`;
  if (ran.length === 0) return `Has not run in any term from ${span}.`;
  const was = ctx.offeringAliases?.get(code);
  return `Ran${was ? ` (as ${was}, its number until this year)` : ''} in ${ran.slice(0, 5).map(word).join(', ')}${ran.length > 5 ? ` and ${ran.length - 5} more` : ''} (of ${terms.length} terms, ${span}).`;
}

/** Every general education tag a degree's blocks name. */
function genEdTagsOf(requirements: PlanRequirement[]): Set<string> {
  const out = new Set<string>();
  for (const r of requirements) {
    if (r.rule.kind === 'gened') for (const t of r.rule.genEd) out.add(t);
    else if (r.rule.kind === 'hours') for (const t of r.rule.genEd ?? []) out.add(t);
  }
  return out;
}

/**
 * Rows that sit inside another row of the same area.
 *
 * Computer Engineering's technical electives are "From the Departmentally
 * Approved List of Technical Electives (below) to include: at least 1
 * Electrical Engineering Foundations course, at least 3 Advanced Computing
 * Electives, at least 1 Design Elective", thirty hours, followed by a "Select
 * ..." table for each of the three. Those five courses are part of the thirty.
 * Read as separate rows they were booked on top of it, and a student with
 * forty-two hours of AP credit was given a seven-term plan twenty-eight hours
 * past the degree. The progress rail reads the page the same way.
 */
function nestedParents(requirements: PlanRequirement[]): Map<string, string> {
  const areaOf = (id: string) => id.split('::').slice(0, 2).join('::');
  const parentOf = new Map<string, string>();
  requirements.forEach((requirement, index) => {
    if (requirement.rule.kind !== 'pool' || !/\bto include\b/i.test(requirement.label)) return;
    for (const later of requirements.slice(index + 1)) {
      if (areaOf(later.id) !== areaOf(requirement.id)) break;
      if ((later.rule.kind === 'choose' || later.rule.kind === 'pool') && /^select\b/i.test(later.label)) parentOf.set(later.id, requirement.id);
    }
  });
  return parentOf;
}

/** The requirements with each "to include" pool moved after the rows nested in it. */
function nestedLast(requirements: PlanRequirement[], parentOf: Map<string, string>): PlanRequirement[] {
  if (parentOf.size === 0) return requirements;
  const parents = new Set(parentOf.values());
  const out: PlanRequirement[] = [];
  const waiting = new Map<string, PlanRequirement>();
  const childrenLeft = new Map<string, number>();
  for (const parent of parents) childrenLeft.set(parent, [...parentOf.values()].filter((p) => p === parent).length);
  for (const requirement of requirements) {
    if (parents.has(requirement.id)) {
      waiting.set(requirement.id, requirement);
      continue;
    }
    out.push(requirement);
    const parent = parentOf.get(requirement.id);
    if (!parent) continue;
    const left = (childrenLeft.get(parent) ?? 1) - 1;
    childrenLeft.set(parent, left);
    const held = waiting.get(parent);
    if (left === 0 && held) {
      out.push(held);
      waiting.delete(parent);
    }
  }
  out.push(...waiting.values());
  return out;
}

/**
 * Words in a department's or a degree's name that say little about which one
 * it is. "Hip Hop Culture and the Arts" is not East Asian Languages and
 * Cultures, and "Management, BS" is not Technology and Management.
 */
const GENERIC_NAME_WORDS = new Set([
  'engineering', 'eng', 'science', 'sciences', 'sci', 'studies', 'study', 'education', 'art', 'arts', 'systems',
  'honors', 'data', 'culture', 'cultures', 'language', 'languages', 'literature', 'literatures', 'management',
  'courses', 'center', 'advanced', 'applied', 'general',
]);
const NAME_FILLER = new Set(['and', 'of', 'the', 'for', 'in', 'a', 'an', 'as', 'with']);

function nameWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1 && !NAME_FILLER.has(w));
}

/**
 * How well two name words match: 1 for the same word, 0.67 when one is the
 * start of the other, 0 otherwise. The catalog's department names are
 * abbreviated ("Civil and Environ Engineering", "Molecular and Cell
 * Biology"), so "cell" has to reach "cellular". A shared start is weaker
 * evidence than the same word, because "second" also starts "secondary"
 * and English as a Second Language is not Secondary Education.
 */
function nameWordMatch(a: string, b: string): number {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short) ? 0.67 : 0;
}

/**
 * The department a degree's name names.
 *
 * Only the major part of the name counts: "Psychology: Behavioral
 * Neuroscience, BSLAS" is Psychology, "Chemical Engineering + Data Science"
 * is Chemical Engineering. Each word of it that a department's name shares
 * scores three, or one for a word like "Engineering" that half the
 * departments have, and each department word the degree does not use costs a
 * quarter. Substring matching read "Computer Engineering" as ENG, the
 * college's orientation subject, and "Molecular & Cellular Biology" as BIOL,
 * a prefix its page never lists, because the catalog calls those departments
 * "Electrical and Computer Engineering" and "Molecular and Cell Biology".
 *
 * A department the page lists wins over one it does not, and one it does not
 * list is taken only when the page lists next to nothing or the names match
 * word for word: "Public Policy and Law" is taught in ACE, whose courses fill
 * its page, and is not the law school's LAW.
 */
function subjectNamed(programName: string, onPage: Map<string, number>): string | null {
  const name = programName.replace(/,\s*B[A-Z]+\b.*$/, '').replace(/\([^)]*\)/g, ' ');
  const [majorPart, concentration] = name.split(':');
  const pageSize = [...onPage.values()].reduce((sum, n) => sum + n, 0);
  const mostNamed = Math.max(0, ...onPage.values());
  let contained: { prefix: string; length: number } | null = null;

  const bestFor = (text: string): string | null => {
    const words = nameWords(text.split(/\s\+\s/)[0]);
    if (words.length === 0) return null;
    let best: { prefix: string; score: number; page: number } | null = null;
    for (const [prefix, subjectName] of Object.entries(ILLINOIS_SUBJECT_NAMES)) {
      const theirs = nameWords(subjectName);
      if (theirs.length === 0) continue;
      let score = 0;
      let allOurs = true;
      for (const w of words) {
        const m = Math.max(0, ...theirs.map((t) => nameWordMatch(w, t)));
        if (m === 0) allOurs = false;
        score += m * (GENERIC_NAME_WORDS.has(w) ? 1 : 3);
      }
      const unmatched = theirs.filter((t) => !words.some((w) => nameWordMatch(w, t) > 0)).length;
      score -= 0.25 * unmatched;
      const page = onPage.get(prefix) ?? 0;
      const exact = allOurs && unmatched === 0;
      // "Engineering Undeclared" names ENG and nothing more particular; kept
      // aside in case no department matches better. A college-wide name like
      // ENG's stands however few courses it has on the page; "Law" in "Public
      // Policy and Law" does not, against a page of thirty-eight ACE courses.
      if (unmatched === 0 && page > 0 && (page * 2 >= mostNamed || theirs.every((t) => GENERIC_NAME_WORDS.has(t))) && (!contained || theirs.length > contained.length)) {
        contained = { prefix, length: theirs.length };
      }
      if (score < 2.5 && !exact) continue;
      if (page === 0 && pageSize >= 10 && !exact) continue;
      // One shared word is weak evidence against a page that lists another
      // department's courses by the dozen: "Plant Biotechnology" shares
      // "plant" with Plant Pathology and its page is fifty Crop Sciences
      // courses. It stands when the department is among the page's largest.
      if (score < 3.5 && !exact && page * 2 < mostNamed) continue;
      const rank = (x: { score: number; page: number }) => (x.page > 0 ? 100 : 0) + x.score + Math.min(x.page, 9) / 100;
      const candidate = { prefix, score, page };
      if (!best || rank(candidate) > rank(best)) best = candidate;
    }
    return best?.prefix ?? null;
  };
  // The major's name first; a concentration's when the major's names nothing
  // particular ("Secondary Education: Mathematics" is MATH, "Interdisciplinary
  // Studies: Jewish Studies" is JS).
  return bestFor(majorPart) ?? (concentration ? bestFor(concentration) : null) ?? (contained as { prefix: string } | null)?.prefix ?? null;
}

/**
 * The subjects a degree is made of, and which one is the major.
 *
 * The major comes from the degree's name where a department's name matches it
 * (see `subjectNamed`): "Psychology, BSLAS" is PSYC even though its page names
 * five LAS courses and three PSYC ones, which once made LAS the major and the
 * electives thirty introductions to other departments. The most-named row
 * prefix is the fallback.
 *
 * A subject belongs to the degree when the page names it three times. A long
 * list counts only its large shares: Computer Engineering's technical-elective
 * list has 417 courses from 24 departments, and counting each department with
 * three courses on it made Chemical, Nuclear, Industrial and Civil
 * Engineering "the degree's own subjects", so a student who wrote "hardware
 * and embedded systems" got CHBE 221 and NPRE 247 as technical electives.
 * ECE and CS, a fifth and a tenth of that list, are what it is made of.
 */
function degreeSubjectsOf(
  requirements: PlanRequirement[],
  programName?: string,
): { subjects: Set<string>; primary: string | null } {
  const count = new Map<string, number>();
  const onPage = new Map<string, number>();
  for (const requirement of requirements) {
    const rule = requirement.rule;
    if (rule.kind !== 'all' && rule.kind !== 'choose' && rule.kind !== 'pool') continue;
    // The language sequence is the student's choice of language, not a
    // subject of the degree: counting it made Spanish one of a Psychology
    // degree's own subjects, and the elective fill then booked four more
    // Spanish courses as though the major asked for them.
    if (requirement.label.startsWith('Language other than English')) continue;
    const here = new Map<string, number>();
    let total = 0;
    for (const choice of rule.choices) {
      for (const code of choice.codes) {
        const subject = normaliseCode(code).split(' ')[0];
        here.set(subject, (here.get(subject) ?? 0) + 1);
        total++;
      }
    }
    const long = rule.kind !== 'all' && total >= 20;
    for (const [subject, n] of here) {
      onPage.set(subject, (onPage.get(subject) ?? 0) + n);
      if (long && n / total < 0.1) continue;
      count.set(subject, (count.get(subject) ?? 0) + n);
    }
  }
  const ranked = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const subjects = new Set(ranked.filter(([, n]) => n >= 3).map(([subject]) => subject));

  let primary: string | null = ranked[0]?.[0] ?? null;
  const named = programName ? subjectNamed(programName, onPage) : null;
  if (named) {
    primary = named;
    subjects.add(named);
  }
  return { subjects, primary };
}

/** Words a student wrote that could name a department or a topic. */
function interestWordsOf(text: string | undefined): string[] {
  return interestWordsFrom(text);
}

/** The career goals and topics in a student's words, read once per text. */
const profileCache = new Map<string, InterestProfile>();
export function interestProfileOf(text: string | undefined): InterestProfile {
  const key = (text ?? '').trim();
  const hit = profileCache.get(key);
  if (hit) return hit;
  const made = interestProfile(key);
  if (profileCache.size > 50) profileCache.clear();
  profileCache.set(key, made);
  return made;
}

/**
 * Whether a course's level fits the hours a student will have: 300-level from
 * sophomore standing, 400-level from junior. Illinois prints this as a rule for
 * only some courses, but a first-year student in FIN 442 is a plan no advisor
 * signs, and the fill was writing exactly that.
 */
/** The student a plan is for, as far as a course title can address them. */
interface Audience {
  college: string | null;
  /** The major's subject prefix, when known. */
  primary: string | null;
}
const NOBODY: Audience = { college: null, primary: null };

/**
 * Whether a course's own title says it is not for this student.
 *
 * "Exploring Digital Information Technologies for Non-Engineers" is a fine
 * course and the wrong one for a Grainger student, and it kept filling the
 * science elective of Computer Science plans because it carries the category
 * tag. A title that says "for non-majors" or "non-technical" closes the course
 * to a student majoring in that subject. Read from the catalog's own words and
 * applied only where they name this student; everyone else is unaffected.
 */
function titleClosesTo(course: Course | undefined, who: Audience): boolean {
  if (!course) return false;
  const title = course.title;
  if (/\bnon-?\s?engineers?\b/i.test(title)) return /engineering/i.test(who.college ?? '');
  if (/\bnon-?\s?(majors?|specialists?|scientists?|science majors?|tech(nical)?)\b/i.test(title)) {
    return who.primary !== null && course.cluster === who.primary;
  }
  return false;
}

/**
 * Lower courses the catalog lists as alternatives to a higher one in the same
 * subject, keyed by the lower: "CHEM 101, CHEM 102, or equivalent" in MCB
 * 244's prerequisites makes CHEM 101 the stand-in for CHEM 102. Built once per
 * prerequisite table.
 */
const standInCache = new WeakMap<object, Map<string, Set<string>>>();

function lowerStandIns(prereqs: Map<string, PlanPrereq> | undefined): Map<string, Set<string>> {
  if (!prereqs) return new Map();
  const cached = standInCache.get(prereqs);
  if (cached) return cached;
  const out = new Map<string, Set<string>>();
  const number = (code: string) => Number.parseInt(code.split(' ')[1] ?? '', 10);
  for (const spec of prereqs.values()) {
    for (const group of spec.groups ?? []) {
      const codes = [...new Set(group.any.map(normaliseCode))];
      for (const low of codes) {
        if (!(number(low) < 200)) continue;
        for (const high of codes) {
          if (high === low || high.split(' ')[0] !== low.split(' ')[0] || !(number(high) > number(low))) continue;
          const set = out.get(low) ?? new Set<string>();
          set.add(high);
          out.set(low, set);
        }
      }
    }
  }
  standInCache.set(prereqs, out);
  return out;
}

/**
 * Whether an elective would only prepare the student for a course they already
 * hold or have planned. CHEM 101 is "preparatory chemistry for students who
 * require additional background before enrolling in CHEM 102"; it was
 * suggested as a free elective, in the hardest grade band, beside CHEM 102 for
 * a first-year and after CHEM 102 and 104 for a student with IB chemistry.
 */
function preparesForHeld(code: string, prereqs: Map<string, PlanPrereq> | undefined, have: (code: string) => boolean): boolean {
  const highers = lowerStandIns(prereqs).get(code);
  return highers ? [...highers].some(have) : false;
}

/**
 * Whether a suggested elective's prerequisites are all in place.
 *
 * Stricter than a required course's check on purpose. A group the parser read
 * with low confidence only warns for a course the degree requires, because the
 * student has to take it either way. An elective is a suggestion among
 * hundreds, and suggesting MCB 301 in a term before MCB 300, which its
 * catalog sentence names, is a mistake the student would have to find.
 */
function electivePrereqsMet(result: { missing: PlanPrereqGroup[]; uncertain: PlanPrereqGroup[] }): boolean {
  return result.missing.length === 0 && result.uncertain.every((group) => group.priorLearning);
}

/**
 * A credit range that leaves the pool's count in doubt. Illinois bills most
 * 400-level courses "3 or 4 hours", the fourth hour for graduate students, and
 * the undergraduate is guaranteed the 3 a pool counts. Treating those as
 * variable sorted CS 410, 411, 416 and 470, HK 438, 449 and 453 behind every
 * fixed-credit course before any of the student's priorities were read.
 */
function reallyVariable(range: PlanCreditRange | undefined): boolean {
  if (!range?.variable) return false;
  return (range.min ?? range.credits) < 3;
}

function levelFits(code: string, hoursBefore: number, standing: StandingThresholds): boolean {
  const level = courseLevel(code);
  if (level >= 400) return hoursBefore >= standing.junior;
  if (level >= 300) return hoursBefore >= standing.sophomore;
  return true;
}

/**
 * How good an elective a course is, before any question of eligibility.
 *
 * Two layers. The structural prior says what kind of course belongs in an
 * elective slot at all: the major's own subject first, an upper-level course in
 * it once the hours allow, three credits or more, a prerequisite sentence the
 * parser could read, a fixed credit line. The quality score on top is the
 * student's priorities applied to the data: grade history, the excellent
 * list, their own words, requirement coverage, this term's sections. The
 * prior keeps a two-credit seminar from winning on a good instructor; the
 * score decides among the courses that pass it.
 */
function scoreElective(code: string, s: ElectiveScoring): number {
  const course = s.byCode.get(code);
  if (!course) return Number.NEGATIVE_INFINITY;
  let score = 0;
  // Three points for the major's own subject: enough that a course in it
  // holds a free elective slot against a course elsewhere whose only edge is
  // one measure the student weighted double, and not enough to hold it
  // against a course that wins on two.
  if (course.cluster === s.primarySubject) score += 3;
  else if (s.degreeSubjects.has(course.cluster)) score += 1.5;
  if (s.degreeSubjects.has(course.cluster) && courseLevel(code) >= 300) score += 1;
  if (!s.degreeSubjects.has(course.cluster) && courseLevel(code) < 200) score -= 1;
  // A 400-level course in another department is usually that major's own
  // advanced or capstone course (PHYS 496, writing for physics majors, was a
  // Kinesiology student's free elective). Suggested only when nothing else fits.
  if (!s.degreeSubjects.has(course.cluster) && course.cluster !== s.primarySubject && courseLevel(code) >= 400) score -= 4;
  // "Exploring Digital Information Technologies for Non-Engineers" is a fine
  // course and the wrong elective for an engineer; the title says who it is for.
  if (/\bnon-?\s?(majors?|engineers?|scientists?|specialists?|science majors?)\b/i.test(course.title)) score -= 4;
  // The three things that make a course a poor fit for a slot whatever the
  // student wants, scaled past the eight points the priorities can add: a
  // one-credit orientation seminar with an easy grade history was winning
  // the first elective slot of every computer science plan on light
  // workload alone.
  const spec = s.prereqs?.get(code);
  if (spec && spec.text.length > 0 && !spec.parsed) score -= 4;
  if (reallyVariable(s.creditRanges?.get(code))) score -= 4;
  if (s.creditsOf(code) < 3) score -= 9;
  // Not run in any recent term: only when nothing that has run is left.
  if (s.dormant?.(code)) score -= 9;
  // Every section closed to this major: the student could not register.
  if (s.closedToMajor?.(code)) score -= 7;
  // Seen once in eight terms: it may run every other year, so a course that
  // runs every term is the safer suggestion when the rest is equal.
  if (s.rare?.(code)) score -= 1;
  const q = s.quality(code);
  // Eight points across the measures, so a course the student's priorities
  // favour outranks one they do not by more than the subject and level nudges.
  score += 8 * q.score + Math.min(q.known, 3) * 0.1;
  // Something the student said outright and this course cannot meet: online
  // only for a student who asked for in person, no section inside the hours
  // they gave. Decisive against the subject nudges, short of the dormant rule.
  score -= 3 * (q.conflicts?.length ?? 0);
  // What the student said they want, when they said it matters: 1.5 points
  // at relevance 1 and 3 at relevance 2. As one of five averaged measures a
  // title hit was worth about 0.4 points, less than a well-liked instructor,
  // and a machine-learning student got every Computer Science course but
  // the machine-learning ones.
  score += 1.5 * (q.interest ?? 0);
  return score;
}

/**
 * Whether one more elective from this subject is reasonable. Five MATH courses
 * for a Finance major is not a plan, it is a sort order showing through, so
 * subjects outside the degree get two. The major itself gets ten, because a
 * page that names only 34 of Psychology's 120 credits leaves the rest of the
 * major unnamed, and a Psychology plan made of thirty introductions to other
 * departments is not a Psychology plan. The degree's other subjects get four.
 */
function subjectRoomLeft(subject: string, taken: Map<string, number>, primary: string | null, degreeSubjects: Set<string>): boolean {
  const n = taken.get(subject) ?? 0;
  const cap = subject === primary ? 10 : degreeSubjects.has(subject) ? 4 : 2;
  return n < cap;
}

/** The catalog, best elective first, minus what the caller rules out. */
function rankedElectivePool(ctx: PlanningContext, s: ElectiveScoring, exclude: (code: string) => boolean): string[] {
  return ctx.courses
    .map((c) => normaliseCode(c.code))
    .filter((code) => !exclude(code))
    .map((code) => ({ code, score: scoreElective(code, s) }))
    .filter((c) => Number.isFinite(c.score))
    .sort((a, b) => b.score - a.score || courseLevel(a.code) - courseLevel(b.code) || a.code.localeCompare(b.code))
    .map((c) => c.code);
}

function electiveWhy(course: Course | undefined, degreeSubjects: Set<string>, q?: QualityResult): string {
  const head = course && degreeSubjects.has(course.cluster)
    ? `An elective in ${course.cluster}, one of this degree's own subjects.`
    : course && course.tags.length > 0
      ? `An elective that also carries ${course.tags[0]}.`
      : 'An elective toward the degree total.';
  if (!q) return head;
  const chosen = q.reasons.length > 0 ? ` Chosen for: ${q.reasons.slice(0, 3).join('; ')}.` : '';
  const against = [...(q.conflicts ?? []), ...(q.cautions ?? [])];
  return `${head}${chosen}${against.length > 0 ? ` Keep in mind: ${against.slice(0, 2).join('; ')}.` : ''}`;
}

export interface ElectiveOption {
  code: string;
  why: string;
  /** 0 to 1 over the student's priorities; ties broken by how much is known. */
  score: number;
  /** The rank the list is in: the structural prior plus the weighted score. */
  fit: number;
  reasons: string[];
  unknown: string[];
}

/**
 * Everything a student could put in one elective slot of one term, best first.
 *
 * The same rules the fill uses, read off the board as it is now rather than as
 * it was generated: prerequisites met by what is in earlier terms and in hand,
 * standing and level fit for the hours banked by then, nothing that does not
 * count beside a course on the board, nothing already on it. The slot's own
 * current course is on the board and so is not offered back.
 */
export function electiveOptions(input: {
  context: PlanningContext;
  requirements: PlanRequirement[];
  plan: PlanState;
  termId: string;
  prior: PriorCredit;
  interests?: string;
  programName?: string;
  priorities?: Priorities;
  programCollege?: string;
  /**
   * A code to rank even though it is on the board: the course a slot holds
   * now, so a re-pick can tell whether anything beats it.
   */
  including?: string;
  limit?: number;
  standingHours?: StandingThresholds;
  /**
   * The board's elective slots, by code, so the per-subject cap the generator
   * applies holds here too. Without it a re-pick for "easy classes" turned a
   * Psychology board's 12 PSYC courses into 32, every one the top option for
   * its own slot and none of them checked against the others.
   */
  electiveCodes?: string[];
}): ElectiveOption[] {
  const ctx = input.context;
  const term = input.plan.terms.find((t) => t.id === input.termId);
  if (!term) return [];
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const conflicts = buildConflicts(ctx.exclusions);
  const match = exclusionAwareMatcher(ctx.prereqCheck ?? defaultPrereqMatcher, conflicts, ctx.prereqs, equivalents, []);
  const standing = input.standingHours ?? DEFAULT_STANDING_HOURS;
  const hardCut = ctx.bands?.hardest ?? FALLBACK_HARD_DIFFICULTY;
  const grades = ctx.grades ?? new Map<string, GradeRow>();
  const isHard = (code: string): boolean => {
    const d = grades.get(code)?.difficulty;
    return d !== null && d !== undefined && d >= hardCut;
  };
  const creditsOf = (code: string): number => {
    const range = ctx.creditRanges?.get(code);
    if (range) return range.known ? (range.min ?? range.credits) : 0;
    return byCode.get(code)?.credits ?? 0;
  };
  const sectionCount = (code: string): number => ctx.sections?.get(code)?.total ?? 0;
  const published = ctx.offeringPublished ?? new Set<string>();

  const held = new Set<string>();
  for (const raw of input.prior.courseCodes) for (const e of expandEquivalents(normaliseCode(raw), equivalents)) held.add(e);
  let hoursBefore = [...held].reduce((sum, code) => sum + creditsOf(code), 0) + input.prior.unmatchedCredits;
  const codeOf = (id: string): string | null => {
    const c = byId.get(id);
    return c ? normaliseCode(c.code) : null;
  };
  for (const id of input.plan.completedCourseIds) {
    const c = codeOf(id);
    if (c) for (const e of expandEquivalents(c, equivalents)) held.add(e);
  }
  const onBoard = new Set<string>();
  const earlier = new Set<string>(held);
  const sameTerm = new Set<string>();
  let reached = false;
  for (const t of input.plan.terms) {
    const codes = t.courseIds.map(codeOf).filter((c): c is string => c !== null);
    for (const c of codes) onBoard.add(c);
    if (t.id === term.id) {
      reached = true;
      for (const c of codes) for (const e of expandEquivalents(c, equivalents)) sameTerm.add(e);
      continue;
    }
    if (!reached) {
      for (const c of codes) for (const e of expandEquivalents(c, equivalents)) earlier.add(e);
      hoursBefore += codes.reduce((sum, c) => sum + creditsOf(c), 0);
    }
  }

  const majors = degreeSubjectsOf(input.requirements, input.programName);
  // Categories the board does not yet carry a course for.
  const carried = new Set<string>();
  for (const code of [...onBoard, ...held]) for (const t of byCode.get(code)?.tags ?? []) carried.add(t);
  const wantedTags = new Set([...genEdTagsOf(input.requirements)].filter((t) => !carried.has(t)));
  const scoring: ElectiveScoring = {
    byCode,
    primarySubject: majors.primary,
    degreeSubjects: majors.subjects,
    interestWords: interestWordsOf(input.interests),
    sectionCount,
    isHard,
    prereqs: ctx.prereqs,
    creditRanges: ctx.creditRanges,
    creditsOf,
    dormant: dormantCheck(ctx),
    closedToMajor: closedToMajorCheck(ctx, input.programName, input.programCollege),
    rare: rareCheck(ctx),
    quality: qualityFor(ctx, byCode, {
      priorities: input.priorities,
      interestWords: interestWordsOf(input.interests),
    profile: interestProfileOf(input.interests),
      primarySubject: majors.primary,
      degreeSubjects: majors.subjects,
      wantedTags,
    }),
  };
  const keep = input.including ? normaliseCode(input.including) : null;
  const perSubject = new Map<string, number>();
  for (const raw of input.electiveCodes ?? []) {
    const code = normaliseCode(raw);
    if (code === keep) continue;
    const subject = byCode.get(code)?.cluster ?? code.split(' ')[0];
    perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
  }
  const pool = rankedElectivePool(
    ctx,
    scoring,
    (code) => (onBoard.has(code) && code !== keep) || held.has(code) || creditsOf(code) <= 0,
  );
  const out: ElectiveOption[] = [];
  const optionFor = (code: string, course: Course): ElectiveOption => {
    const q = scoring.quality(code);
    return { code, why: electiveWhy(course, scoring.degreeSubjects, q), score: q.score, fit: scoreElective(code, scoring), reasons: q.reasons, unknown: q.unknown };
  };
  for (const code of pool) {
    const course = byCode.get(code);
    if (!course) continue;
    if (code !== keep && input.electiveCodes && !subjectRoomLeft(course.cluster, perSubject, majors.primary, majors.subjects)) continue;
    if (code !== keep && preparesForHeld(code, ctx.prereqs, (c) => onBoard.has(c) || held.has(c))) continue;
    if (outOfSeason(course, term.season, published.has(code))) continue;
    const needs = ctx.prereqs?.get(code)?.standing;
    if (needs && hoursBefore < (standing[needs] ?? 0)) continue;
    if (!levelFits(code, hoursBefore, standing)) continue;
    if (conflictWith(code, conflicts, [held, onBoard]) !== null) continue;
    if (expandEquivalents(code, equivalents).some((twin) => twin !== code && (onBoard.has(twin) || held.has(twin)))) continue;
    if (match(ctx.prereqs?.get(code), earlier, sameTerm, equivalents).missing.length > 0) continue;
    out.push(optionFor(code, course));
    if (out.length >= (input.limit ?? 60)) break;
  }
  // The slot's own course is always ranked, eligible here or not, so a re-pick
  // compares a candidate with what the student already has instead of
  // swapping whenever the current course falls outside the top few.
  if (keep && !out.some((o) => o.code === keep)) {
    const course = byCode.get(keep);
    if (course) out.push(optionFor(keep, course));
  }
  return out;
}

export interface LanguagePlan {
  name: string;
  semesters: 3 | 4;
  /** Semesters already behind the student, from high school years or held courses. */
  completed: number;
  /** 'assumed' when the student has not said and the plan took the admission minimum of two years. */
  from: 'high school' | 'college' | 'none' | 'assumed';
  /** The courses booked, first semester first. */
  codes: string[];
  why: string;
}

const LANGUAGE_WORDS: Array<[RegExp, string]> = [
  [/\bspanish\b/i, 'Spanish'], [/\bfrench\b/i, 'French'], [/\bgerman\b/i, 'German'], [/\bitalian\b/i, 'Italian'],
  [/\b(mandarin|chinese)\b/i, 'Chinese (Mandarin)'], [/\bjapanese\b/i, 'Japanese'], [/\bkorean\b/i, 'Korean'],
  [/\blatin\b(?! america)/i, 'Latin'], [/\brussian\b/i, 'Russian'], [/\barabic\b/i, 'Arabic'], [/\bhebrew\b/i, 'Hebrew (Modern)'],
  [/\b(asl|sign language)\b/i, 'American Sign Language'], [/\b(hindi|urdu)\b/i, 'Hindi/Urdu'], [/\bportuguese\b/i, 'Portuguese'],
  [/\bpolish\b/i, 'Polish'], [/\bgreek\b/i, 'Greek (Classical and Koine)'], [/\bswahili\b/i, 'Swahili'], [/\bturkish\b/i, 'Turkish'],
  [/\bpersian|farsi\b/i, 'Persian'], [/\bczech\b/i, 'Czech'], [/\byiddish\b/i, 'Yiddish'], [/\bukrainian\b/i, 'Ukrainian'],
];

/**
 * Turn the language requirement into courses, before anything is placed.
 *
 * The university's rule, from its general education page: the requirement
 * is met by the third (or, for some curricula, fourth) semester course of a
 * language other than English, by that many years of one language in high
 * school, or by a placement exam; one high school year counts as one
 * semester. So the semesters still owed are the level asked for minus what
 * the student brings, and the courses are the registrar's table entries for
 * the semesters left, in one language.
 *
 * Which language: the one the student named; else one they already hold a
 * course in, continued; else one their own words mention; else Spanish,
 * the most-taught language on campus, marked so the student can tap any of
 * its cards and choose another.
 */
function expandLanguageRequirement(input: AutoplanInput): { requirements: PlanRequirement[]; language: LanguagePlan | null; satisfied: { requirementId: string; label: string; codes: string[] } | null; notes: string[]; exempt: string[] } {
  const rule = input.requirements.find((r) => r.rule.kind === 'language');
  if (!rule || rule.rule.kind !== 'language') return { requirements: input.requirements, language: null, satisfied: null, notes: [], exempt: [] };
  const rest = input.requirements.filter((r) => r !== rule);
  const table = input.context.languages;
  const semesters = rule.rule.semesters;
  const notes: string[] = [];
  if (!table || table.languages.length === 0) {
    // Without the table the sentence is all there is; leave it to be quoted.
    return { requirements: input.requirements, language: null, satisfied: null, notes, exempt: [] };
  }
  const held = new Set(input.prior.courseCodes.map(normaliseCode));
  /**
   * What the student brings. Illinois requires two years of one language
   * other than English for freshman admission (four recommended), and counts
   * a year as a semester, so a student who has not answered is assumed to
   * bring two; a student who answered "none" brings none.
   */
  const said = input.prior.languageSemesters;
  const assumed = said === undefined || said === null;
  const broughtSemesters = assumed ? 2 : said;
  /** Options for a level that are not shared with another level: SPAN 122 counts as two semesters and would be booked twice. */
  const cleanLevels = (levels: string[][][]) =>
    levels.map((level, i) => {
      const shared = (option: string[]) => option.some((code) => levels.some((other, j) => j !== i && other.some((o) => o.includes(code))));
      const own = level.filter((option) => !shared(option));
      return own.length > 0 ? own : level;
    });
  const levelHeld = (levels: string[][][]) => {
    let top = 0;
    levels.forEach((level, i) => {
      if (level.some((option) => option.every((code) => held.has(normaliseCode(code))))) top = Math.max(top, i + 1);
    });
    return top;
  };
  let chosen = null as null | (typeof table.languages)[number];
  /**
   * Where the semesters the student brings come from, whichever language is
   * chosen. This used to be set only when the student named a language, so a
   * plan that fell back to Spanish said its two assumed semesters were
   * "already held", which is a claim about the student's record that nobody
   * made.
   */
  const brought: LanguagePlan['from'] = assumed ? 'assumed' : broughtSemesters > 0 ? 'high school' : 'none';
  let from: LanguagePlan['from'] = brought;
  let why = '';
  const named = (input.prior.languageName ?? '').trim();
  if (named) {
    const byName = table.languages.find((l) => l.name.toLowerCase() === named.toLowerCase())
      ?? table.languages.find((l) => LANGUAGE_WORDS.some(([re, name]) => re.test(named) && name === l.name));
    if (byName) { chosen = byName; from = brought; why = `You said ${byName.name}.`; }
  }
  if (!chosen) {
    const continuing = table.languages.map((l) => ({ l, top: levelHeld(l.levels) })).filter((x) => x.top > 0).sort((a, b) => b.top - a.top)[0];
    if (continuing) { chosen = continuing.l; from = 'college'; why = `You already hold ${continuing.top} semester${continuing.top === 1 ? '' : 's'} of ${continuing.l.name}.`; }
  }
  if (!chosen) {
    const words = input.interests ?? '';
    const hit = LANGUAGE_WORDS.find(([re]) => re.test(words));
    const byWords = hit ? table.languages.find((l) => l.name === hit[1]) : null;
    if (byWords) { chosen = byWords; from = brought; why = `You mentioned ${byWords.name}.`; }
  }
  if (!chosen) {
    chosen = table.languages.find((l) => l.name === 'Spanish') ?? table.languages[0];
    from = brought;
    why = 'No language was given, so Spanish is planned, the most-taught language on campus. Tap any language card to choose another.';
  }
  const levels = cleanLevels(chosen.levels);
  const completed = Math.max(broughtSemesters, levelHeld(chosen.levels));
  if (assumed && completed === broughtSemesters) {
    notes.push(`You have not said how much of a language other than English you took in high school, so the plan assumes the two years Illinois requires for admission (one year counts as one college semester) and books the rest. Set your years under Credit if that is not right.`);
  }
  if (completed >= semesters) {
    const codes = chosen.levels.flat().flat().filter((code) => held.has(normaliseCode(code)));
    return {
      requirements: rest,
      language: null,
      satisfied: { requirementId: rule.id, label: `Language other than English: met (${completed} semester${completed === 1 ? '' : 's'} of ${chosen.name})`, codes },
      notes: [...notes, broughtSemesters >= semesters
        ? `The language requirement is met by ${broughtSemesters} year${broughtSemesters === 1 ? '' : 's'} of ${chosen.name} in high school; the university counts one year as one semester. No language courses are planned.`
        : `The language requirement is met by the ${chosen.name} you already hold. No language courses are planned.`],
      exempt: [],
    };
  }
  const chain: string[] = [];
  const choices: PlanCourseChoice[] = [];
  for (let level = completed; level < semesters; level += 1) {
    const options = levels[level] ?? [];
    const codes = options.flatMap((option) => option.filter((code) => !chain.includes(code)));
    if (codes.length === 0) continue;
    choices.push({ codes, credits: null });
    chain.push(codes[0]);
  }
  if (completed > 0 && broughtSemesters > 0) {
    notes.push(`Language: ${semesters - completed} more semester${semesters - completed === 1 ? '' : 's'} of ${chosen.name} ${semesters - completed === 1 ? 'is' : 'are'} planned after ${assumed ? 'the two years assumed from' : `your ${broughtSemesters} year${broughtSemesters === 1 ? '' : 's'} in`} high school. The university requires a placement test when you continue a high school language; the plan assumes you place into semester ${completed + 1}.`);
  }
  const expanded: PlanRequirement = {
    ...rule,
    label: `Language other than English, through the ${semesters === 4 ? 'fourth' : 'third'} semester`,
    rule: { kind: 'all', choices },
  };
  /**
   * The semesters behind the student clear the chain without earning hours:
   * two years of high school Spanish means SPAN 201 without SPAN 101 and
   * SPAN 102 first. Exemption is exactly that, and it is why the plan does
   * not book the lower courses as prerequisites of the one it does book.
   */
  const exempt = chosen.levels.slice(0, completed).flat().flat();
  return {
    requirements: [...rest, expanded],
    language: { name: chosen.name, semesters, completed, from, codes: chain, why },
    satisfied: null,
    notes,
    exempt,
  };
}

/**
 * A college's published route in, as requirements the placer can seat.
 *
 * Only what the degree page does not already require is added: a Finance
 * page names ECON 102 and ECON 103 itself, so for a student aiming at Gies
 * only Composition I and the math option are new, and those are placed
 * first because the application reads them by the end of the first spring.
 * Courses that must be taken together ("CHEM 102 and CHEM 103") both go in.
 */
function admissionRequirements(route: AdmissionRoute, requirements: PlanRequirement[], input: AutoplanInput): { added: PlanRequirement[]; codes: string[] } {
  const named = new Set<string>();
  for (const r of requirements) {
    if (r.rule.kind === 'all' || r.rule.kind === 'choose' || r.rule.kind === 'pool') for (const c of r.rule.choices) for (const code of c.codes) named.add(normaliseCode(code));
  }
  /**
   * How many terms deep each option sits for this student. A route that
   * wants "a math course by the end of the first spring" is met by MATH 220
   * only if MATH 220 can be reached by then; a student who starts in MATH
   * 112 cannot, and the degree's own calculus is no use to the application.
   * Then the route's other options (STAT 100, MATH 115) are what an advisor
   * would say to take, and that is what gets added.
   */
  const ctx = input.context;
  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const satisfied = new Set([...input.prior.courseCodes, ...input.prior.exemptCodes].map(normaliseCode));
  const allOptions = route.required.flatMap((item) => [...(item.options ?? []), ...(item.with ?? [])]).map(normaliseCode);
  const { depth } = buildDepths(allOptions, ctx.prereqs, satisfied, equivalents);
  const reachableByDeadline = (code: string) => (depth.get(code) ?? 0) <= 1;
  const label = `Getting into ${route.name} (${route.path}), by ${route.requiredBy}`;
  const added: PlanRequirement[] = [];
  const codes: string[] = [];
  route.required.forEach((item, i) => {
    if (item.genEd) return; // a category the general education blocks already carry
    let options = (item.options ?? []).map(normaliseCode);
    if (options.length === 0) return;
    const namedHere = options.filter((o) => named.has(o));
    const namedInTime = namedHere.filter(reachableByDeadline);
    const othersInTime = options.filter((o) => !named.has(o) && reachableByDeadline(o));
    /**
     * One option, chosen here rather than left to the ranker: the degree's
     * own option when one can arrive in time, so the same course serves
     * both; otherwise one of the route's other options that can. Among
     * those, the shallowest chain that does not lean on a placement score
     * the student has not shown: MATH 231 reads as reachable only because
     * MATH 221's prerequisite is an ALEKS score, and a student the plan is
     * starting in MATH 112 has not got one, so MATH 234 after MATH 112 is
     * the honest pick.
     */
    const placementOnly = (code: string) => {
      const spec = ctx.prereqs?.get(code);
      return Boolean(spec && spec.groups.length === 0 && /placement|aleks/i.test(spec.text));
    };
    const leansOnPlacement = (code: string) => {
      if (placementOnly(code)) return true;
      const d = depth.get(code) ?? 0;
      if (d === 0) return false;
      for (const group of orderingGroups(ctx.prereqs?.get(code))) {
        const alts = group.any.map(normaliseCode);
        const cheapest = Math.min(...alts.map((a) => depth.get(a) ?? 0));
        if (alts.some((a) => (depth.get(a) ?? 0) === cheapest && placementOnly(a))) return true;
      }
      return false;
    };
    const pickFrom = (pool: string[]) =>
      pool
        .slice()
        .sort((x, y) => (leansOnPlacement(x) ? 1 : 0) - (leansOnPlacement(y) ? 1 : 0) || (depth.get(x) ?? 0) - (depth.get(y) ?? 0) || x.localeCompare(y))[0];
    if (namedInTime.length > 0) options = [pickFrom(namedInTime)];
    else if (othersInTime.length > 0) options = [pickFrom(othersInTime)];
    else if (namedHere.length > 0) { codes.push(...namedHere); return; }
    const choices: PlanCourseChoice[] = [{ codes: options, credits: null }];
    for (const w of item.with ?? []) choices.push({ codes: [normaliseCode(w)], credits: null });
    added.push({
      id: `admission-${i}`,
      areaId: 'admission',
      areaLabel: label,
      label: item.label,
      hours: null,
      rule: options.length === 1 ? { kind: 'all', choices } : { kind: 'choose', n: 1, choices },
      note: `${route.name} lists this among the courses to have done by ${route.requiredBy}. Source: ${route.source}`,
      url: route.source,
    });
    codes.push(...options, ...(item.with ?? []).map(normaliseCode));
  });
  return { added, codes };
}

/**
 * A course the catalog titles for seniors is taken as a senior, whatever its
 * prerequisite line says.
 *
 * ECE 496 "Senior Research Project" lists RHET 105 and consent of instructor
 * and nothing else, so it read as open to anyone who had written a paper, and
 * the technical-elective pool put it in a third semester because nothing
 * stood in front of it. Forty-odd courses are like it: CS 499 Senior Thesis,
 * BIOE 400 Bioengineering Senior Design, ACE 447 Capstone in Applied
 * Economics. Where the catalog states a standing it stands; ECON 397 "Senior
 * Research I" says junior. Where it states none, the title's word is the
 * best evidence there is, and the error quotes the title so a student can see
 * where the rule came from.
 */
/**
 * Each "one of these sets" row, settled for this student.
 *
 * The set the student already holds the most of, and otherwise the first the
 * page lists: a student with AP Physics C credit for PHYS 211 continues in the
 * PHYS 211 sequence, and anyone else gets PHYS 101 and 102, which is the set
 * Molecular & Cellular Biology prints first. The chosen set becomes one row
 * per course, so every other part of the planner sees ordinary courses and
 * books the labs and second semesters the collapsed rows had lost. Take-all
 * rows only; a pool or a count over sets would need a rule of its own, and
 * none of the crawled pages has one.
 */
export function resolveBundles(requirements: PlanRequirement[], prior: PriorCredit, ctx: Pick<PlanningContext, 'courses' | 'equivalents'>): PlanRequirement[] {
  if (!requirements.some((r) => r.rule.kind === 'all' && r.rule.choices.some((c) => c.bundles && c.bundles.length > 0))) return requirements;
  const held = new Set<string>();
  for (const code of prior.courseCodes) {
    for (const alt of expandEquivalents(normaliseCode(code), ctx.equivalents ?? new Map())) held.add(alt);
  }
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  return requirements.map((requirement) => {
    const rule = requirement.rule;
    if (rule.kind !== 'all' || !rule.choices.some((c) => c.bundles && c.bundles.length > 0)) return requirement;
    const choices: PlanCourseChoice[] = [];
    for (const choice of rule.choices) {
      if (!choice.bundles || choice.bundles.length === 0) {
        choices.push(choice);
        continue;
      }
      // With nothing held, the set a student can simply enrol in: Chemical
      // Engineering + Data Science lists the accelerated CHEM 202 set first,
      // which is for students placed into it, and its lecture and lab each
      // require the other in the same fall. The general set is the default.
      const special = (bundle: string[]) => /\b(accelerated|honors)\b/i.test(byCode.get(normaliseCode(bundle[0]))?.title ?? '');
      let best = choice.bundles.find((bundle) => !special(bundle)) ?? choice.bundles[0];
      let bestHeld = best.filter((code) => held.has(normaliseCode(code))).length;
      for (const bundle of choice.bundles) {
        const n = bundle.filter((code) => held.has(normaliseCode(code))).length;
        if (n > bestHeld) {
          best = bundle;
          bestHeld = n;
        }
      }
      for (const code of best) {
        const course = byCode.get(normaliseCode(code));
        choices.push({ codes: [normaliseCode(code)], credits: course?.credits ?? null, substitutes: [] });
      }
    }
    return { ...requirement, rule: { ...rule, choices } };
  });
}

/**
 * Courses a college gives no degree hours for, whatever the university grants.
 *
 * Grainger's list, from advising.grainger.illinois.edu/degree-requirements/
 * coursesnotcount (read 24 September 2026): "Any math course below MATH 220
 * (MATH 112, 114, 116, 117, STAT 100, etc.)", "Only 4 credit hours of MATH 220
 * will count towards the Grainger Engineering degree", "CHEM 101 and CHEM
 * 108", "Any 100 level PHYS course", "ASTR 100", and basic military science.
 * A student with AP Statistics holds STAT 100, and counting its three hours
 * toward an engineering degree shows them closer to graduating than they are.
 * A course the degree's own page names still counts: the page is the more
 * particular rule.
 */
interface CollegeCreditRule {
  source: string;
  excluded: (code: string) => boolean;
  /** Hours of a course that count, where fewer than its credit. */
  capped: Map<string, number>;
}

function collegeCreditRule(college: string | undefined, requirements: PlanRequirement[]): CollegeCreditRule | null {
  if (college !== 'engineering') return null;
  const named = new Set<string>();
  for (const r of requirements) {
    if (r.rule.kind === 'all' || r.rule.kind === 'choose' || r.rule.kind === 'pool') {
      for (const c of r.rule.choices) for (const code of c.codes) named.add(normaliseCode(code));
    }
  }
  const excluded = (raw: string): boolean => {
    const code = normaliseCode(raw);
    if (named.has(code)) return false;
    const [subject, digits] = code.split(' ');
    const n = Number.parseInt(digits ?? '', 10);
    if (!Number.isFinite(n)) return false;
    if (subject === 'MATH' && n < 220) return true;
    if (subject === 'STAT' && n === 100) return true;
    if (subject === 'CHEM' && (n === 101 || n === 108)) return true;
    if (subject === 'PHYS' && n >= 100 && n < 200) return true;
    if (subject === 'ASTR' && n === 100) return true;
    return false;
  };
  return { source: 'advising.grainger.illinois.edu/degree-requirements/coursesnotcount', excluded, capped: new Map([['MATH 220', 4]]) };
}

/**
 * The held courses a degree counts toward its total, and the hours a cap takes
 * off, by the same rule the plan uses. For the progress rail, so its total and
 * the plan's headline agree.
 */
export function heldTowardDegree(codes: string[], college: string | undefined, requirements: PlanRequirement[]): { codes: string[]; hoursOff: number } {
  const rule = collegeCreditRule(college, requirements);
  if (!rule) return { codes, hoursOff: 0 };
  return {
    codes: codes.filter((code) => !rule.excluded(code)),
    hoursOff: codes.map(normaliseCode).filter((code) => rule.capped.has(code)).length,
  };
}

/**
 * Held credit with the college's rule applied: a course it gives no hours for
 * still clears prerequisites, the way an exemption does, and adds nothing to
 * the total; a capped course adds only its capped hours.
 */
function countTowardDegree(prior: PriorCredit, rule: CollegeCreditRule): { prior: PriorCredit; note: string | null } {
  const dropped = prior.courseCodes.filter((code) => rule.excluded(code));
  const capped = prior.courseCodes.map(normaliseCode).filter((code) => rule.capped.has(code));
  if (dropped.length === 0 && capped.length === 0) return { prior, note: null };
  const keep = prior.courseCodes.filter((code) => !rule.excluded(code));
  // The capped hour comes off the hours with no course behind them, which is
  // where the total is adjusted; it is one hour for MATH 220, the only cap.
  const trimmed = capped.length;
  const parts: string[] = [];
  if (dropped.length > 0) parts.push(`${dropped.join(', ')} ${dropped.length === 1 ? 'earns' : 'earn'} no hours toward an engineering degree, so ${dropped.length === 1 ? 'it is' : 'they are'} left out of the total; ${dropped.length === 1 ? 'it still counts' : 'they still count'} as a prerequisite.`);
  if (capped.length > 0) parts.push('Only 4 of MATH 220\'s 5 hours count toward an engineering degree.');
  return {
    prior: {
      ...prior,
      courseCodes: keep,
      exemptCodes: [...new Set([...prior.exemptCodes, ...dropped])],
      unmatchedCredits: prior.unmatchedCredits - trimmed,
    },
    note: `Grainger's rule: ${parts.join(' ')} Source: ${rule.source}`,
  };
}

const titleStandingCache = new WeakMap<object, PlanningContext>();
const SENIOR_TITLE = /\b(senior|capstone)\b/i;

export function withTitleStanding(ctx: PlanningContext): PlanningContext {
  const cached = titleStandingCache.get(ctx);
  if (cached) return cached;
  const prereqs = new Map(ctx.prereqs ?? []);
  let changed = false;
  for (const course of ctx.courses) {
    if (!SENIOR_TITLE.test(course.title)) continue;
    const code = normaliseCode(course.code);
    const spec = prereqs.get(code);
    if (spec?.standing) continue;
    const standingText = `The course title, "${course.title}", marks it for seniors; the catalog states no standing.`;
    prereqs.set(code, spec
      ? { ...spec, standing: 'senior', standingText }
      : { groups: [], escape: null, text: '', parsed: false, confidence: 'none', standing: 'senior', standingText });
    changed = true;
  }
  const out = changed ? { ...ctx, prereqs } : ctx;
  titleStandingCache.set(ctx, out);
  titleStandingCache.set(out, out);
  return out;
}

export function generatePlan(given: AutoplanInput): GeneratedPlan {
  const context = withTitleStanding(given.context);
  const requirements = resolveBundles(given.requirements, given.prior, context);
  const college = collegeCreditRule(given.programCollege, requirements);
  const counted = college ? countTowardDegree(given.prior, college) : null;
  // A degree total of 0 is a page with no readable total, not a degree of no credits.
  const raw: AutoplanInput = { ...given, context, requirements, prior: counted?.prior ?? given.prior, notTowardDegree: college?.excluded, degreeTotal: given.degreeTotal || null };
  const expansion = expandLanguageRequirement(raw);
  const prior = expansion.exempt.length > 0
    ? { ...raw.prior, exemptCodes: [...new Set([...raw.prior.exemptCodes, ...expansion.exempt])] }
    : raw.prior;
  const route = raw.admissionRoute ?? null;
  const admission = route ? admissionRequirements(route, expansion.requirements, raw) : { added: [], codes: [] };
  const inner = (horizon: Horizon) => generatePlanInner({
    ...raw,
    horizon,
    prior,
    requirements: [...admission.added, ...expansion.requirements],
    sequenceFirst: [...admission.codes, ...(expansion.language?.codes ?? [])],
    languageExempt: expansion.exempt,
    earlyTags: route ? route.required.map((item) => item.genEd).filter((t): t is string => Boolean(t)) : [],
    dueByTerm: route && route.dueTermIndex !== undefined ? Object.fromEntries(admission.codes.map((c) => [c, route.dueTermIndex as number])) : undefined,
  });
  /**
   * A horizon fitted to the hours can still be a term too short for a chain:
   * a transfer with twenty-five hours left and a four-semester language
   * requirement cannot finish in two terms whatever the hours say. When the
   * fitted plan leaves something unplaced for want of a term, it gets one more
   * and is built again, up to the default the student would have had anyway.
   */
  let fitted = fitHorizonToCredit(raw, prior);
  let result = inner(fitted.horizon);
  for (let extra = 1; fitted.shortened && extra <= 4 && leftForWantOfATerm(result); extra += 1) {
    const longer = fitHorizonToCredit(raw, prior, extra);
    if (!longer.shortened) {
      fitted = longer;
      result = inner(longer.horizon);
      break;
    }
    fitted = longer;
    result = inner(longer.horizon);
  }
  result.language = expansion.language;
  if (expansion.satisfied) result.satisfiedByPriorCredit.push(expansion.satisfied);
  result.notes.push(...expansion.notes);
  if (route) {
    result.admission = { name: route.name, path: route.path, source: route.source, requiredBy: route.requiredBy, codes: admission.codes, eligibility: route.eligibility, notes: route.notes };
    result.notes.push(
      `Getting into ${route.name}: ${route.path} is an application with its own rules, not part of the degree page. ${route.eligibility.join(' ')} The courses it asks for by ${route.requiredBy} are placed first in this plan. Source: ${route.source}`,
    );
  }
  if (fitted.note) result.notes.push(fitted.note);
  if (counted?.note) result.notes.push(counted.note);
  result.residency = raw.residency ? residencyReport(raw.residency, result, raw.context) : null;
  if (result.residency?.shortfall) result.notes.push(result.residency.shortfall);
  return result;
}

function generatePlanInner(input: AutoplanInput): GeneratedPlan {
  const ctx = input.context;
  const prefs = input.preferences ?? {};
  const credits = { ...DEFAULT_CREDITS, ...prefs.creditsPerTerm };
  const maxHard = prefs.maxHardCourses ?? DEFAULT_MAX_HARD;
  const hardCut = prefs.hardDifficulty === undefined
    ? (ctx.bands?.hardest ?? FALLBACK_HARD_DIFFICULTY)
    : prefs.hardDifficulty;
  const policy = prefs.electivePolicy ?? 'priorities';

  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const grades = ctx.grades ?? new Map<string, GradeRow>();
  const baseMatch = ctx.prereqCheck ?? defaultPrereqMatcher;
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  /** Who the plan is for, so a course "for Non-Engineers" never fills an engineer's category. */
  const degreeRead = degreeSubjectsOf(input.requirements, input.programName);
  const nestedParent = nestedParents(input.requirements);
  const who: Audience = { college: input.programCollege ?? null, primary: degreeRead.primary };
  const conflicts = buildConflicts(ctx.exclusions);

  const notes: string[] = [];
  const unsatisfied: UnsatisfiedRequirement[] = [];
  const notPlaced: NotPlaced[] = [];

  // --- what the student walks in with -------------------------------------
  const earned = new Set<string>();
  for (const raw of input.prior.courseCodes) {
    for (const equiv of expandEquivalents(normaliseCode(raw), equivalents)) earned.add(equiv);
  }
  const exempt = new Set<string>();
  for (const raw of input.prior.exemptCodes) {
    for (const equiv of expandEquivalents(normaliseCode(raw), equivalents)) {
      if (!earned.has(equiv)) exempt.add(equiv);
    }
  }
  // Exemption clears the prerequisite chain without earning the hours, so it
  // counts here and nowhere else. Treating the two the same overstates a
  // student's progress by about a semester.
  const satisfiedForPrereq = new Set<string>([...earned, ...exempt]);

  if (!input.prior.known) {
    notes.push('This plan was built without a transcript. Anything you have already taken is missing from it.');
  }
  // Exemptions from the language placement the plan assumed are explained by
  // the language note; this one is for exemptions the student declared.
  // Courses the college gives no hours for are explained by their own note.
  const declaredExempt = [...exempt].filter((code) => !(input.languageExempt ?? []).map(normaliseCode).includes(code) && !input.notTowardDegree?.(code));
  if (declaredExempt.length > 0) {
    const n = declaredExempt.length;
    notes.push(`${n} course${n === 1 ? '' : 's'} you are exempt from still ${n === 1 ? 'leaves its' : 'leave their'} requirement open. Exemption lets you skip ahead, it does not earn the hours.`);
  }
  if (!ctx.prereqs) {
    notes.push('Prerequisites have not loaded, so nothing in this plan is prerequisite checked.');
  }

  // --- pick the courses ----------------------------------------------------
  const allCodes = new Set<string>();
  for (const requirement of input.requirements) {
    for (const slot of slotsFor(requirement, ctx, who)) {
      for (const option of slot.options) for (const code of option) allCodes.add(code);
    }
  }
  for (const code of satisfiedForPrereq) allCodes.add(code);
  const { depth: rankDepth } = buildDepths(allCodes, ctx.prereqs, satisfiedForPrereq, equivalents);
  /**
   * The scorer the ranker reads during placement. Every general education tag
   * the degree names counts as wanted here, because placement is where the
   * categories get filled; the elective fill below rebuilds it with only the
   * ones still open.
   */
  const majorsForRank = degreeSubjectsOf(input.requirements, input.programName);
  const qualityAtPlacement = qualityFor(ctx, byCode, {
    priorities: prefs.priorities,
    interestWords: interestWordsOf(input.interests),
    profile: interestProfileOf(input.interests),
    primarySubject: majorsForRank.primary,
    degreeSubjects: majorsForRank.subjects,
    wantedTags: genEdTagsOf(input.requirements),
  });
  const rank = makeRanker(ctx, byCode, rankDepth, policy, qualityAtPlacement, input.programName, input.programCollege);
  /**
   * The ranker for a general education category's own candidates. Coverage
   * is left out of it: every candidate carries the category being filled, so
   * the measure was a constant that only diluted the student's other
   * priorities. What a candidate covers beyond the category is weighed by
   * `alsoCounts` in the category's order, and only when the student has
   * coverage on.
   */
  const genEdPriorities = prefs.priorities ?? DEFAULT_PRIORITIES;
  const rankGenEd = makeRanker(ctx, byCode, rankDepth, policy, qualityFor(ctx, byCode, {
    priorities: { ...genEdPriorities, coverage: 0 },
    interestWords: interestWordsOf(input.interests),
    profile: interestProfileOf(input.interests),
    primarySubject: majorsForRank.primary,
    degreeSubjects: majorsForRank.subjects,
    wantedTags: new Set(),
  }), input.programName, input.programCollege);

  const chosen = new Map<string, { requirementId: string | null; label: string }>();
  /**
   * Courses already spent inside one exclusive gen-ed group.
   *
   * Illinois allows one course to count for a Cultural Studies category and a
   * Humanities category at the same time, and for a major requirement as well,
   * but not for two Cultural Studies categories. Keyed by group so the rule is
   * the school's, not this engine's.
   */
  const genEdSpent = new Map<string, Set<string>>();
  /**
   * Held gen-ed credit (no Illinois course behind it), assigned to categories
   * before any slot runs. Hours blocks are filled before the categories, so
   * letting the first block to ask take a credit counted a transfer science
   * course for both the science elective and Natural Sciences. Categories get
   * first claim, a credit fills one category per exclusive group (the campus
   * rule), and what is left may fill an hours block once.
   */
  const genEdCreditFor = new Map<string, GenEdCredit[]>();
  const genEdCreditAssigned = new Set<string>();
  {
    const ledgers = new Map<string, Set<string>>();
    for (const requirement of input.requirements) {
      const rule = requirement.rule;
      if (rule.kind !== 'gened') continue;
      const wanted = new Set(rule.genEd);
      // A transfer course used for a Cultural Studies category does not also
      // meet Advanced Composition (the Parkland-to-UIUC guide), so for held
      // transfer credit the two share a ledger.
      const group = rule.genEd.includes('Advanced Composition') ? 'cultural-studies' : (rule.exclusiveGroup ?? 'core');
      const ledger = ledgers.get(group) ?? new Set<string>();
      ledgers.set(group, ledger);
      let hours = 0;
      let courses = 0;
      const mine: GenEdCredit[] = [];
      const done = () => (rule.hours === null || hours >= rule.hours) && (rule.courses === null || courses >= rule.courses);
      for (const credit of input.prior.genEdCredits ?? []) {
        if (done()) break;
        if (ledger.has(credit.id) || !credit.tags.some((tag) => wanted.has(tag))) continue;
        ledger.add(credit.id);
        genEdCreditAssigned.add(credit.id);
        mine.push(credit);
        hours += credit.credits;
        courses += 1;
      }
      genEdCreditFor.set(requirement.id, mine);
    }
  }
  const genEdCreditUsedByHours = new Set<string>();
  const satisfiedByPriorCredit: GeneratedPlan['satisfiedByPriorCredit'] = [];
  let droppedRowsWithoutCatalog = 0;
  let sharedListings = 0;

  /**
   * Twins the degree's own rows settled before any row was filled. See the
   * block that fills it, further down, for why the order rows come off a
   * catalog page is the wrong way to decide which of two courses a plan books.
   */
  const suppressedBy = new Map<string, string>();

  /**
   * The one exclusion test every path that books a course goes through.
   *
   * There were three of these before, on three of the seven paths, each looking
   * at a different slice of the plan. The pool looked only inside itself, the
   * gen-ed filler only at its own category, the requirement chooser and the
   * prerequisite closure not at all, and the review list said "these do not
   * both count" about a pair the engine had just chosen on purpose. This is the
   * whole board: prior credit, everything already booked, whatever the slot
   * running right now is holding, and the twins settled up front.
   *
   * `earned` and not `satisfiedForPrereq`, because exemption earns no hours and
   * an exclusion is a rule about hours.
   */
  const conflictFor = (code: string, insideSlot?: Set<string>): string | null =>
    conflictWith(code, conflicts, insideSlot ? [earned, chosen, insideSlot] : [earned, chosen]) ??
    suppressedBy.get(code) ??
    null;

  /**
   * Prior credit and the board so far, never the whole plan. A course whose
   * only excuse for skipping a prerequisite is a twin two years further down
   * the board is a course in the wrong term, and passing `chosen` here let CHEM
   * 105 sit in a first-year fall on the strength of a CHEM 204 in year four.
   */
  const match = exclusionAwareMatcher(baseMatch, conflicts, ctx.prereqs, equivalents, [earned]);

  /**
   * The term list, built before the courses are chosen rather than after.
   *
   * A pool has to know how many terms there are: a technical elective sitting
   * five terms deep in its prerequisite chain is not a candidate for a student
   * with four terms left, and choosing it anyway fills the pool on paper and
   * reports the course as unplaceable in the same breath.
   */
  const terms = buildHorizon(input.horizon);

  const creditsOf = (code: string): number => {
    const range = ctx.creditRanges?.get(code);
    if (range) return range.known ? (range.min ?? range.credits) : 0;
    return byCode.get(code)?.credits ?? 0;
  };

  /**
   * Hours the student walks in with, counted once and used twice.
   *
   * Once for class standing, which is measured in earned hours and so has to
   * know about transfer credit before the first term is placed, and once for
   * the headline total at the end. They were two separate sums before and the
   * standing check would have missed a transfer student's 18 hours entirely.
   */
  const heldOnce = distinctHeld(input.prior.courseCodes, ctx);
  const heldCredit = new Map(heldOnce.codes.map((code) => [code, byCode.get(code)?.credits ?? 0]));
  let priorCreditTotal = [...heldCredit.values()].reduce((sum, n) => sum + n, 0) + input.prior.unmatchedCredits;
  for (const d of heldOnce.dropped) {
    notes.push(`The catalog says credit is not given for both ${d.kept} and ${d.dropped}, and you hold both. Only ${d.kept} is counted toward the total; your Transfer Evaluation Report or advisor says which one Illinois keeps.`);
  }

  /**
   * Held credit that stands in for a required course, or gives way to it.
   *
   * A student with AP credit for MATH 220 meets a row written "MATH 221": the
   * page says so in its own footnote (MATH 220 may be substituted), and every
   * course the degree requires next lists the two as alternatives. That
   * student used to be told "MATH 221 and MATH 220 do not both count, ask your
   * advisor", which is a problem where there is none.
   *
   * A student holding MATH 234 does not meet it: no required course accepts
   * MATH 234 where it accepts MATH 221, and the registrar's own table says the
   * credit is void in a program that requires MATH 220 or 221. That student
   * used to get no calculus at all, and MATH 231 placed on top of the gap. Now
   * MATH 221 is booked, the MATH 234 hours come out of the total, and both
   * halves are said in the notes.
   */
  const standsInByPrereq = (held: string, wanted: string): boolean => {
    for (const code of allCodes) {
      const spec = ctx.prereqs?.get(code);
      if (!spec) continue;
      for (const group of spec.groups) {
        const any = group.any.map(normaliseCode);
        if (any.includes(held) && any.includes(wanted)) return true;
      }
    }
    return false;
  };
  const standInFor = (code: string, standIns?: Map<string, string[]>): string | null => {
    for (const sub of standIns?.get(code) ?? []) if (earned.has(sub)) return sub;
    const by = conflictWith(code, conflicts, [earned]);
    if (by !== null && standsInByPrereq(by, code)) return by;
    return null;
  };
  const forfeits: Array<{ held: string; for: string }> = [];

  /** Every pool, kept so the report can be written against the placed board. */
  const poolFills: Array<{ slot: PlanSlot; fill: PoolFill }> = [];

  /**
   * The order a pool tries its candidates in.
   *
   * The plain ranker leads with prerequisite DEPTH, which answers "how early
   * can this go" and is the right question for a course the degree requires. A
   * pool is a choice, so the question is "what does this one cost me", and the
   * answer is how many courses it drags in that the plan does not already hold.
   * `have` is a snapshot of what is chosen when the pool runs, which is why the
   * memo is built per pool rather than once.
   */
  const poolOrderFor = (have: Set<string>) => {
    const memo = new Map<string, number>();
    const score = (code: string): number[] => {
      const base = rank(code);
      /**
       * A condition the parser could not read is a condition nobody checked.
       *
       * CS 492's catalog prerequisite is "For Computer Science majors with
       * senior standing." There is no course code in it, so the parser produces
       * no groups, the placer sees nothing to satisfy, and Senior Project I
       * landed in a first-year fall. That is not a reason to refuse the course,
       * which would be inventing a rule out of a sentence we admit we cannot
       * read, but it is a reason to reach for it last: a pool is a choice
       * between a hundred courses, and the ones whose conditions the plan can
       * actually verify are the better choice.
       */
      const spec = ctx.prereqs?.get(code);
      const unverifiable = spec && spec.text.length > 0 && !spec.parsed ? 1 : 0;
      const extra = prerequisiteCost(code, have, ctx.prereqs, equivalents, byCode, memo, new Set());
      // A course billed as "1 to 4 hours" counts for one hour here, because one
      // is the only number the catalog guarantees. Filling an eighteen-hour
      // pool out of those makes the eighteen meaningless, so among equally
      // reachable courses the one with a fixed credit line goes first.
      const variable = reallyVariable(ctx.creditRanges?.get(code)) ? 1 : 0;
      /**
       * The degree's own subjects first, when they cost no more than one extra
       * course. Computer Engineering's 30-hour technical-elective list spans a
       * dozen departments, and ordering it by prerequisite cost alone filled a
       * student who wrote "hardware and embedded systems" with Chemical,
       * Nuclear, Materials, Industrial and Civil Engineering courses while ECE
       * and CS courses on the same list were open to her.
       */
      const subject = code.split(' ')[0];
      const own = (degreeRead.subjects.has(subject) || subject === degreeRead.primary) && extra <= 1 ? 0 : 1;
      /**
       * A thesis, a research project, an independent study or a one- or
       * two-credit piece is on a technical-elective list so a student who wants
       * one can count it, not as the list's first suggestion. ECE 499 "Senior
       * Thesis", two credits with nothing in front of it, was the cheapest
       * course on Computer Engineering's list and was booked as a technical
       * elective for a student who had asked for nothing of the kind.
       */
      const title = byCode.get(code)?.title ?? '';
      const aside = /\b(thesis|independent study|research|special topics|internship|honors)\b/i.test(title) || creditsOf(code) < 3 ? 1 : 0;
      // A course that cannot meet something the student said outright (in
      // person only, no class before noon) goes behind every one that can.
      const clash = qualityAtPlacement(code).conflicts?.length ? 1 : 0;
      // What the student said they want, among candidates that drag in at
      // most one more course: a student headed for machine learning takes CS
      // 441 and 446 from the technical-elective list, not the cheapest six.
      const wanted = (qualityAtPlacement(code).interest ?? 0) > 0 && extra <= 1 ? 0 : 1;
      /**
       * The student's priorities before prerequisite depth. `extra` already
       * charges a candidate for the courses it drags in, and depth differs
       * between nearly every pair of 400-level courses, so with depth first
       * the priority score was never reached: the same six Computer Science
       * technical electives came out under "easiest", "best teaching" and
       * "most relevant" alike.
       */
      const [inCatalog, chain, ...byPriority] = base;
      const key = [inCatalog, unverifiable, clash, aside, wanted, own, extra, variable, ...byPriority, chain];
      const traced = typeof process !== 'undefined' && process.env ? process.env.PLAN_DEBUG : undefined;
      if (traced && normaliseCode(traced) === code) console.error(`  [PLAN_DEBUG] ${code} list-pick key [inCatalog, unverifiable, clash, aside, wanted, own, extra, variable, unknown, -score, -known, chain] = ${JSON.stringify(key)}`);
      return key;
    };
    return (a: string, b: string): number => compareRank(score(a), score(b), a, b);
  };

  /**
   * How a general education category chooses among its approved courses.
   *
   * Two things the plain ranker does not know about, both of which produced a
   * wrong plan for Composition I.
   *
   * A course that is only half of a sequence cannot satisfy a category on its
   * own. The catalog says so in prose this parser does not read, but it also
   * says so in the prerequisite data: CMN 112 requires CMN 111, RHET 102
   * requires RHET 101, ESL 112 requires ESL 111, and each of those pairs is one
   * requirement taken over two terms. So a candidate that is a prerequisite of
   * another candidate in the same category, or has one as a prerequisite, goes
   * last. The two Composition I courses that stand alone, RHET 105 and ESL 115,
   * are what is left.
   *
   * After that the plain ranker decides, and the last tiebreak is how many
   * sections the university actually ran in the crawled term. It is a fact this
   * app already has and it separates RHET 105, with 94 sections, from a course
   * with nine that ties it on everything else.
   */
  const genEdSequenceMembers = (codes: string[]): Set<string> => {
    const inCategory = new Set(codes);
    const sequence = new Set<string>();
    for (const code of codes) {
      const spec = ctx.prereqs?.get(code);
      if (!spec?.parsed) continue;
      for (const group of spec.groups) {
        for (const raw of group.any) {
          const need = normaliseCode(raw);
          if (!inCategory.has(need) || need === code) continue;
          sequence.add(code);
          sequence.add(need);
        }
      }
    }
    return sequence;
  };

  const sectionCount = (code: string): number => ctx.sections?.get(code)?.total ?? 0;

  const best = (codes: string[]): string | null =>
    codes.length === 0 ? null : codes.slice().sort((a, b) => compareRank(rank(a), rank(b), a, b))[0];

  /**
   * The course that fills one slot, and whether it is already filling another.
   *
   * A degree page often lists the same course under two groups. That is one
   * course, not two, and scheduler.areaProgress already counts it once. Marking
   * the second slot shared keeps it out of the unsatisfied list, where it would
   * read as a hole in the degree that is not there.
   */
  const pickFromOption = (option: string[]): { code: string; shared: boolean } | null => {
    for (const code of option) if (earned.has(code)) return { code, shared: false };
    const open = best(option.filter((code) => !chosen.has(code)));
    if (open) return { code: open, shared: false };
    const taken = best(option.filter((code) => chosen.has(code)));
    return taken ? { code: taken, shared: true } : null;
  };

  /**
   * How many courses in this catalog name a course as a prerequisite.
   *
   * Only ever read where an exclusion forces a choice between two courses, as
   * the tiebreak that keeps the most doors open.
   */
  const dependents = new Map<string, number>();
  if (conflicts.size > 0) {
    for (const spec of ctx.prereqs?.values() ?? []) {
      if (!spec.parsed) continue;
      const counted = new Set<string>();
      for (const group of spec.groups) {
        if (group.confidence === 'low') continue;
        for (const raw of group.any) {
          const alt = normaliseCode(raw);
          if (counted.has(alt)) continue;
          counted.add(alt);
          dependents.set(alt, (dependents.get(alt) ?? 0) + 1);
        }
      }
    }
  }

  /**
   * The order to try courses in when two of them exclude each other.
   *
   * Credit in hand first, then the course more of the catalog is built on, then
   * the plain ranker. A total order, so the same student gets the same plan
   * twice, and only ever consulted where an exclusion forces a choice.
   */
  const twinPreference = (a: string, b: string): number => {
    const held = (earned.has(b) ? 1 : 0) - (earned.has(a) ? 1 : 0);
    if (held !== 0) return held;
    const depended = (dependents.get(b) ?? 0) - (dependents.get(a) ?? 0);
    if (depended !== 0) return depended;
    return compareRank(rank(a), rank(b), a, b);
  };

  /** True when two of these courses cannot both count, so the choice matters. */
  const holdsTwins = (codes: string[]): boolean =>
    codes.some((a, i) => codes.slice(i + 1).some((b) => conflicts.get(a)?.has(b) === true));

  /**
   * Which of two rows the degree cannot have both of, decided before either is
   * booked.
   *
   * A page that reads "CHEM 202 or CHEM 102" parses into two rows of a take-all
   * block, and the catalog then says credit is not given for both. Booking both
   * was the bug. Refusing the second one is right, but WHICH one came second
   * was decided by the order the rows came off the page, and that put a
   * Chemical Engineering student in Accelerated Chemistry and stranded every
   * course on the same page that names General Chemistry: the plan fell from
   * 133 credits to 79 and lost most of its own major.
   *
   * So the choice is made here, over the whole degree at once. Credit already
   * in hand wins, which is the rule about never booking the twin of a course
   * the student has. After that the course more of this catalog is built on
   * wins: 31 courses name CHEM 102 and 7 name CHEM 202, and the one that keeps
   * more doors open is the better half of a coin toss. It is an ordering
   * preference, like the catalog-number tiebreak above, and nothing in the
   * report presents it as a rule Illinois has.
   *
   * Greedy rather than pair by pair, because these sets are not always cliques:
   * MATH 115 excludes MATH 220 and MATH 221 and says nothing about MATH 234.
   *
   * Take-all rows only. A pool is already a choice and can simply pick its next
   * candidate; a take-all row is the page saying this course, and that is where
   * a misread "or" turns into two demands that cannot both be met.
   */
  if (conflicts.size > 0) {
    const demanded: string[] = [];
    const seen = new Set<string>();
    for (const requirement of input.requirements) {
      if (requirement.rule.kind !== 'all') continue;
      for (const slot of slotsFor(requirement, ctx, who)) {
        for (const option of slot.options) {
          const pick = option.find((code) => earned.has(code))
            ?? best(option.filter((code) => byCode.has(code)));
          if (!pick || seen.has(pick)) continue;
          seen.add(pick);
          demanded.push(pick);
        }
      }
    }

    const kept: string[] = [];
    for (const code of demanded.slice().sort(twinPreference)) {
      const beaten = kept.find((other) => conflicts.get(code)?.has(other));
      if (beaten === undefined) kept.push(code);
      else suppressedBy.set(code, beaten);
    }
  }

  /**
   * The degree's own requirements first, then general education.
   *
   * Order is not cosmetic here. Illinois says "Some Gen Ed requirements may be
   * met by courses required and/or electives in a major", and a category can
   * only notice that if the major has already chosen its courses. Run the other
   * way round, the gen-ed block picks two fresh humanities courses, the major
   * then picks its own, and the plan books six hours the student did not owe.
   *
   * It also settles the one case where a page's "fulfilled by" clause offers a
   * choice: Computer Science says quantitative reasoning is fulfilled by "MATH
   * 220 or MATH 221", and with the major already placed the answer is whichever
   * of the two the degree actually requires, rather than a coin toss that puts
   * both calculus courses in one plan.
   */
  /**
   * Among the categories, the one-course Cultural Studies ones first.
   *
   * Nearly every Cultural Studies course also carries Humanities or Social &
   * Behavioral Sciences, and campus rules let it count for both. Filled in page
   * order, Humanities booked two courses of its own and Western/Comparative
   * Cultures then booked a third that was also Humanities: ETMA 311 sat in a
   * Computer Engineering plan counting for nothing. Picked first, and picked
   * for what else they carry, the three courses cover most of the hours
   * categories before those categories book anything.
   */
  const genEdRequirements = input.requirements.filter((r) => r.rule.kind === 'gened');
  const culturalFirst = [
    ...genEdRequirements.filter((r) => r.rule.kind === 'gened' && r.rule.exclusiveGroup === 'cultural-studies'),
    ...genEdRequirements.filter((r) => !(r.rule.kind === 'gened' && r.rule.exclusiveGroup === 'cultural-studies')),
  ];
  const orderedRequirements = nestedLast([
    ...input.requirements.filter((r) => r.rule.kind !== 'gened'),
    ...culturalFirst,
  ], nestedParent);
  /** Gen-ed requirements already filled, so a category knows which others are still waiting. */
  const genEdDone = new Set<string>();
  /** Courses each "to include" pool's nested rows have counted, by the pool's id. */
  const nestedCounted = new Map<string, Set<string>>();

  for (const requirement of orderedRequirements) {
    if (requirement.rule.kind === 'unparsed' || requirement.rule.kind === 'language') {
      // "Additional course work ... so that there are at least 128 hours earned
      // toward the degree" is the page saying this block is whatever reaches the
      // total, and the plan reaches the total. Said as that, not as a sentence
      // the planner could not read.
      const toTotal = requirement.rule.kind === 'unparsed' && (input.degreeTotal ?? null) !== null && /\bso that there (?:are|is) at least \d+/i.test(requirement.rule.text);
      unsatisfied.push({
        requirementId: requirement.id,
        areaLabel: requirement.areaLabel,
        label: requirement.label || requirement.areaLabel,
        reason: toTotal ? 'filled-by-electives' : 'not-parsed',
        // The catalog's own words, never a summary of them. A paraphrase of a
        // requirement is the kind of invented fact this project treats as a defect.
        message: toTotal
          ? `The catalog says: ${requirement.rule.text} The plan counts every course toward the ${input.degreeTotal} and fills what is left with elective slots.`
          : `The catalog says: ${requirement.rule.text}`,
        url: requirement.url,
      });
      continue;
    }

    if (requirement.rule.kind === 'gened' && requirement.rule.genEd.length === 0) {
      unsatisfied.push({
        requirementId: requirement.id,
        areaLabel: requirement.areaLabel,
        label: requirement.label || requirement.areaLabel,
        reason: 'no-course-data',
        // The catalog's own words for the category, then the plain fact that
        // nothing in the course data is marked as counting for it.
        message: `${requirement.rule.text} No course in the catalog is marked as counting for this.`,
        url: requirement.url,
      });
      continue;
    }

    if (requirement.rule.kind === 'hours' && (!requirement.rule.genEd || requirement.rule.genEd.length === 0)) {
      const filled = (input.degreeTotal ?? null) !== null;
      unsatisfied.push({
        requirementId: requirement.id,
        areaLabel: requirement.areaLabel,
        label: requirement.label || requirement.areaLabel,
        reason: filled ? 'filled-by-electives' : 'no-course-data',
        message: filled
          ? `${requirement.rule.hours} hours the page does not name courses for. The plan fills them with elective slots; tap any slot to choose what goes there.`
          : `${requirement.rule.hours} hours. The page does not say which courses count.`,
        url: requirement.url,
      });
      continue;
    }

    if (requirement.rule.kind === 'pool' && requirement.rule.hours === null && requirement.rule.n === null) {
      unsatisfied.push({
        requirementId: requirement.id,
        areaLabel: requirement.areaLabel,
        label: requirement.label || requirement.areaLabel,
        reason: 'no-course-data',
        // The list is real, the number is not there. Saying how long the list
        // is, and nothing about how much of it to take, is the whole truth.
        message: `The catalog lists ${requirement.rule.choices.length} courses here and does not say how many of them to take.`,
        url: requirement.url,
      });
      continue;
    }

    for (const slot of slotsFor(requirement, ctx, who)) {
      const free: string[] = [];
      const picked: string[] = [];

      if (slot.kind === 'pool') {
        /**
         * The pool is filled here and REPORTED after placement, further down.
         * What a pool asked for and what the board ends up holding are two
         * different numbers whenever a chosen course does not fit, and the row
         * a student reads has to be the second one.
         */
        const fill = fillPool(slot, {
          byCode,
          earned,
          taken: new Set(chosen.keys()),
          creditsOf,
          order: poolOrderFor(new Set([...satisfiedForPrereq, ...chosen.keys()])),
          reachable: (code) => (rankDepth.get(code) ?? 0) < terms.length,
          conflict: (code, insidePool) => conflictFor(code, insidePool),
          nested: nestedCounted.get(requirement.id),
        });
        poolFills.push({ slot, fill });
        free.push(...fill.free);
        picked.push(...fill.picked);
      } else if (slot.kind === 'gened') {
        /**
         * One general education category, filled in the order the catalog puts
         * its own evidence in.
         *
         * 1. The courses this degree page itself names as fulfilling the
         *    category. They are somewhere else in the same degree, so counting
         *    them is what stops the plan booking six more hours of science on
         *    top of the physics the student already has to take.
         * 2. Courses already in the plan that carry the category. Illinois says
         *    "Some Gen Ed requirements may be met by courses required and/or
         *    electives in a major", and a course counted here is counted once:
         *    it is already in the plan and adds no second set of hours.
         * 3. Anything else in the catalog that carries the category.
         *
         * It stops the moment both of the catalog's numbers are met, and a
         * number the catalog did not give is met by definition rather than
         * filled in with a guess.
         */
        const wantHours = slot.hoursTarget;
        const wantCourses = slot.picks;
        const spent = genEdSpent.get(slot.exclusiveGroup ?? 'core') ?? new Set<string>();
        genEdSpent.set(slot.exclusiveGroup ?? 'core', spent);

        let haveHours = 0;
        let haveCourses = 0;
        const held = new Set<string>();
        const met = (): boolean =>
          (wantHours === null || haveHours >= wantHours) &&
          (wantCourses === null || haveCourses >= wantCourses);

        const countIt = (code: string, as: 'free' | 'picked' | 'shared'): void => {
          if (held.has(code)) return;
          held.add(code);
          spent.add(code);
          haveCourses += 1;
          haveHours += creditsOf(code);
          if (as === 'free') free.push(code);
          else if (as === 'picked') picked.push(code);
          else sharedListings += 1;
        };

        for (const option of slot.fulfilledBy ?? []) {
          if (met()) break;
          const known = option.filter((code) => byCode.has(code) && !spent.has(code));
          if (known.length === 0) continue;
          const already = known.find((code) => earned.has(code));
          if (already) {
            countIt(already, 'free');
            continue;
          }
          const shared = known.find((code) => chosen.has(code));
          if (shared) {
            countIt(shared, 'shared');
            continue;
          }
          // The page's own "fulfilled by MATH 220 or MATH 221" is a choice, and
          // one of the two can be a course the student's credit already rules
          // out. Book an open one rather than the best one, and say nothing
          // when another alternative covered it: a swap that worked is not news.
          const standIn = known.map((code) => standInFor(code)).find((code): code is string => code !== null);
          if (standIn) {
            countIt(standIn, 'free');
            continue;
          }
          const open = known.filter((code) => conflictFor(code, held) === null);
          const pick = best(open);
          if (pick) countIt(pick, 'picked');
        }

        // Held credit that fills this category with no Illinois course behind it.
        for (const credit of genEdCreditFor.get(slot.requirementId) ?? []) {
          if (met()) break;
          if (spent.has(credit.id)) continue;
          spent.add(credit.id);
          held.add(credit.id);
          haveCourses += 1;
          haveHours += credit.credits;
        }

        for (const option of slot.options) {
          if (met()) break;
          const code = option[0];
          if (spent.has(code)) continue;
          if (earned.has(code)) countIt(code, 'free');
          else if (chosen.has(code)) countIt(code, 'shared');
        }

        if (!met()) {
          const all = slot.options.map((option) => option[0]);
          const sequence = genEdSequenceMembers(all);
          /**
           * A general education course is one any student can take. A 400-level
           * course in another major, or one the catalog holds for juniors or
           * seniors, is usually that major's capstone: Kinesiology plans filled
           * Advanced Composition with PHYS 496 (writing for physics majors) and
           * an MCB plan with ABE 469 (an engineering capstone it could not
           * place). Those go last; the degree's own subjects are exempt.
           */
          const oneSeason = (code: string): number => {
            const course = byCode.get(code);
            return ctx.offeringPublished?.has(code) && course && course.offeredIn.length === 1 ? 1 : 0;
          };
          const reserved = (code: string): number => {
            const subject = code.split(' ')[0];
            if (degreeRead.subjects.has(subject) || subject === degreeRead.primary) return 0;
            if (courseLevel(code) >= 400) return 1;
            return ctx.prereqs?.get(code)?.standing ? 1 : 0;
          };
          // The tags of the categories still to be filled, other than ones this
          // category may not share a course with, and other than ones the
          // courses already chosen or held meet. Quantitative Reasoning counted
          // as waiting for an engineering student whose calculus already met
          // it, and PHIL 103 in the hardest band won Humanities on a second
          // category nobody needed.
          const alreadyMet = (r: PlanRequirement): boolean => {
            if (r.rule.kind !== 'gened') return true;
            const tags = new Set(r.rule.genEd);
            const have = [...new Set([...chosen.keys(), ...earned])].filter((c) => byCode.get(c)?.tags.some((t) => tags.has(t)));
            const hours = have.reduce((sum, c) => sum + creditsOf(c), 0);
            return (r.rule.hours === null || hours >= r.rule.hours) && (r.rule.courses === null || have.length >= r.rule.courses) && (r.rule.hours !== null || r.rule.courses !== null);
          };
          const waitingTags = new Set(
            genEdRequirements
              .filter((r) => r.id !== requirement.id && !genEdDone.has(r.id))
              .filter((r) => !(r.rule.kind === 'gened' && slot.exclusiveGroup && r.rule.exclusiveGroup === slot.exclusiveGroup))
              .filter((r) => !alreadyMet(r))
              .flatMap((r) => (r.rule.kind === 'gened' ? r.rule.genEd : [])),
          );
          const alsoCounts = (code: string): number =>
            genEdPriorities.coverage > 0 && byCode.get(code)?.tags.some((tag) => waitingTags.has(tag)) ? 1 : 0;
          const genEdOrder = (a: string, b: string): number => {
            const half = (sequence.has(a) ? 1 : 0) - (sequence.has(b) ? 1 : 0);
            if (half !== 0) return half;
            const kept = reserved(a) - reserved(b);
            if (kept !== 0) return kept;
            const both = alsoCounts(b) - alsoCounts(a);
            if (both !== 0) return both;
            // A category course that runs every term goes anywhere the plan has
            // room; one that runs only in the fall waits for a fall with room.
            // AFST 254 was a Computer Engineering student's social science pick,
            // every fall was full of ECE, and it pushed the plan a term long.
            const seasonal = oneSeason(a) - oneSeason(b);
            if (seasonal !== 0) return seasonal;
            const ranked = compareRank(rankGenEd(a), rankGenEd(b), '', '');
            if (ranked !== 0) return ranked;
            const offered = sectionCount(b) - sectionCount(a);
            if (offered !== 0) return offered;
            return a.localeCompare(b);
          };
          const open = all
            .filter(
              (code) =>
                !spent.has(code) &&
                !chosen.has(code) &&
                byCode.has(code) &&
                (rankDepth.get(code) ?? 0) < terms.length,
            )
            .sort(genEdOrder);
          for (const code of open) {
            if (met()) break;
            // "Credit is not given for both X and Y" applies here like anywhere
            // else: two courses that exclude each other are one course of credit.
            // This used to read only this category's own held set, so a gen-ed
            // filler could hand a student the twin of a course the major had
            // already booked, or of one they walked in with.
            if (conflictFor(code, held) !== null) continue;
            countIt(code, 'picked');
          }
        }

        if (!met()) {
          const wanted = [
            wantHours !== null ? `${wantHours} hours` : null,
            wantCourses !== null ? `${wantCourses} course${wantCourses === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(' and ');
          const got = [
            wantHours !== null ? `${haveHours} hours` : null,
            wantCourses !== null ? `${haveCourses}` : null,
          ].filter(Boolean).join(' and ');
          unsatisfied.push({
            requirementId: slot.requirementId,
            areaLabel: slot.areaLabel,
            label: slot.label,
            reason: slot.options.length === 0 ? 'no-candidates' : 'hours-short',
            message: slot.options.length === 0
              ? `${wanted}. No course in the catalog carries this category.`
              : `${wanted} needed, ${got} in the plan. ${slot.options.length} courses in the catalog carry this category.`,
            url: slot.url,
          });
        }
      } else if (slot.kind === 'hours' && slot.hoursTarget !== null) {
        const ordered = slot.options
          .map((option) => option[0])
          .filter((code) => !chosen.has(code) || earned.has(code))
          .sort((a, b) => compareRank(rank(a), rank(b), a, b));
        let have = 0;
        const heldHere = new Set<string>();
        // Held credit for this category that no gen-ed category has used.
        const hoursTags = new Set(slot.tags ?? []);
        for (const credit of input.prior.genEdCredits ?? []) {
          if (have >= slot.hoursTarget) break;
          if (genEdCreditAssigned.has(credit.id) || genEdCreditUsedByHours.has(credit.id)) continue;
          if (!credit.tags.some((tag) => hoursTags.has(tag))) continue;
          genEdCreditUsedByHours.add(credit.id);
          have += credit.credits;
        }
        for (const code of ordered) {
          if (have >= slot.hoursTarget) break;
          const course = byCode.get(code);
          if (!course) continue;
          if (earned.has(code)) {
            free.push(code);
            heldHere.add(code);
            have += course.credits;
            continue;
          }
          // An hours block draws on a whole gen-ed category, so a course whose
          // credit the catalog rules out is simply skipped for the next one.
          if (conflictFor(code, heldHere) !== null) continue;
          picked.push(code);
          heldHere.add(code);
          have += course.credits;
        }
        if (have < slot.hoursTarget) {
          unsatisfied.push({
            requirementId: slot.requirementId,
            areaLabel: slot.areaLabel,
            label: slot.label,
            reason: slot.options.length === 0 ? 'no-candidates' : 'hours-short',
            message: slot.options.length === 0
              ? `${slot.hoursTarget} hours. No course in the catalog carries this category.`
              : `${slot.hoursTarget} hours needed, ${have} found in the catalog.`,
            url: slot.url,
          });
        }
      } else {
        const want = slot.picks ?? slot.options.length;
        const scored = slot.options
          .map((option) => pickFromOption(option))
          .filter((entry): entry is { code: string; shared: boolean } => entry !== null)
          .sort((a, b) => compareRank(rank(a.code), rank(b.code), a.code, b.code));

        /**
         * Credit in hand is spent before anything is booked.
         *
         * Rank order alone put MATH 220 ahead of a MATH 234 the student already
         * had, booked the one and then counted the other free, and the plan held
         * both halves of a pair the catalog says do not both count. Taking the
         * held courses first means the twin is never the one that gets booked.
         */
        const heldHere = new Set<string>();
        const excludedHere: Array<{ code: string; by: string }> = [];
        let filled = 0;
        for (const entry of scored) {
          if (!earned.has(entry.code)) continue;
          if (filled >= want) break;
          free.push(entry.code);
          heldHere.add(entry.code);
          filled += 1;
        }

        for (const entry of scored) {
          if (filled >= want) break;
          if (earned.has(entry.code)) continue;
          if (!byCode.has(entry.code)) {
            droppedRowsWithoutCatalog += 1;
            continue;
          }
          if (entry.shared) {
            sharedListings += 1;
            heldHere.add(entry.code);
            filled += 1;
            continue;
          }
          const standIn = standInFor(entry.code, slot.standIns);
          if (standIn) {
            free.push(standIn);
            heldHere.add(standIn);
            filled += 1;
            continue;
          }
          // The course the degree page lists here is one the catalog says will
          // not count alongside something already counted. Left out and
          // reported: booking it would put hours in the headline that the
          // registrar will not award.
          const by = conflictFor(entry.code, heldHere);
          if (by !== null) {
            // Unless the only thing in the way is credit the student walked in
            // with and a required row: then the requirement wins, the course is
            // booked, and the held credit is forfeited out loud.
            //
            // Never on a cross-listed twin: the same class under another code is
            // credit already in hand, not credit in the way. With a twin map the
            // twin is in `earned` and never reaches this line; without one the
            // engine cannot tell a twin from an exclusion, so it does not forfeit.
            const onlyHeld =
              slot.kind === 'all' &&
              ctx.equivalents !== undefined &&
              earned.has(by) &&
              !expandEquivalents(entry.code, equivalents).includes(by) &&
              conflictWith(entry.code, conflicts, [chosen, heldHere]) === null;
            if (onlyHeld) {
              forfeits.push({ held: by, for: entry.code });
              picked.push(entry.code);
              heldHere.add(entry.code);
              filled += 1;
              continue;
            }
            excludedHere.push({ code: entry.code, by });
            continue;
          }
          picked.push(entry.code);
          heldHere.add(entry.code);
          filled += 1;
        }

        // options is string[][]: each entry is one requirement slot and the
        // codes inside it are alternatives, so a slot counts as available
        // when any one of its alternatives is in the catalog.
        const known = slot.options.filter((alts) => alts.some((code) => byCode.has(code))).length;
        if (filled < want && excludedHere.length > 0) {
          /**
           * The shortfall the student can do something about, said plainly.
           *
           * "Did not fit before your last term" would be a lie here and a
           * costly one: it points at the schedule, and the schedule is fine.
           * What happened is that the catalog will not pay twice for the same
           * material, so the course is named, the course that blocks it is
           * named, and the student is sent to the one person who can settle it.
           */
          const lines = excludedHere
            .slice()
            .sort((a, b) => a.code.localeCompare(b.code))
            .map(({ code, by }) => `${notBoth(code, by)} ${earned.has(by) ? `You already have ${by}.` : `This plan books ${by}.`}`);
          unsatisfied.push({
            requirementId: slot.requirementId,
            areaLabel: slot.areaLabel,
            label: slot.label,
            reason: 'excluded',
            message: `${lines.join(' ')} Ask your advisor what to put here instead.`,
            url: slot.url,
          });
        } else if (filled < want) {
          unsatisfied.push({
            requirementId: slot.requirementId,
            areaLabel: slot.areaLabel,
            label: slot.label,
            // `filled` is how many this planner managed to PLACE, which is not
            // the same as how many exist. Reporting it as a catalog count told
            // students "only 0 of the listed courses are in the catalog
            // snapshot" for eight CS focus areas that each have 9 to 20 of
            // their courses loaded. Blaming the data for a placement shortfall
            // is the kind of wrong that sends someone to their advisor angry.
            reason: slot.options.length === 0
              ? 'no-candidates'
              : known === 0 ? 'no-course-data' : 'did-not-fit',
            message: slot.options.length === 0
              ? 'The catalog page lists no courses for this requirement.'
              : known === 0
                ? `Needs ${want}. None of the ${slot.options.length} courses the catalog lists here are in this snapshot.`
                : `Needs ${want}, placed ${filled}. ${known} of the ${slot.options.length} listed courses are available; the rest did not fit before your last term or their prerequisites do not resolve.`,
            url: slot.url,
          });
        }
      }

      if (free.length > 0) {
        satisfiedByPriorCredit.push({ requirementId: slot.requirementId, label: slot.label, codes: free });
      }
      for (const code of picked) {
        if (!chosen.has(code)) chosen.set(code, { requirementId: slot.requirementId, label: slot.label });
      }
      if (requirement.rule.kind === 'gened') genEdDone.add(requirement.id);
      const parent = nestedParent.get(requirement.id);
      if (parent) {
        const counted = nestedCounted.get(parent) ?? new Set<string>();
        for (const code of [...free, ...picked]) counted.add(code);
        nestedCounted.set(parent, counted);
      }
    }
  }

  const forfeited = new Set<string>();
  for (const f of forfeits) {
    if (forfeited.has(f.held)) continue;
    forfeited.add(f.held);
    // Only what was counted comes out: the held code itself, or the name the
    // student holds it under when the forfeited code is its cross-listing.
    const counted = [f.held, ...(equivalents.get(f.held) ?? []).map(normaliseCode)].find((code) => heldCredit.has(code));
    if (counted) {
      priorCreditTotal -= heldCredit.get(counted) ?? 0;
      heldCredit.delete(counted);
    }
    notes.push(
      `${f.for} is required here, and the catalog says credit is not given for both ${f.for} and ${f.held}. Your ${f.held} will not count toward this degree once ${f.for} is taken, so it is left out of the total.`,
    );
  }

  if (droppedRowsWithoutCatalog > 0) {
    notes.push(`${droppedRowsWithoutCatalog} course${droppedRowsWithoutCatalog === 1 ? '' : 's'} listed on the degree page ${droppedRowsWithoutCatalog === 1 ? 'is' : 'are'} not in the catalog snapshot, so the plan skipped ${droppedRowsWithoutCatalog === 1 ? 'it' : 'them'}.`);
  }
  if (sharedListings > 0) {
    notes.push(`${sharedListings} course${sharedListings === 1 ? '' : 's'} on the degree page ${sharedListings === 1 ? 'counts' : 'count'} under more than one heading. ${sharedListings === 1 ? 'It is' : 'They are'} in the plan once.`);
  }

  // --- pull in the prerequisites the degree page does not list -------------
  //
  // A degree page lists what the major requires, not what those courses
  // require. CS 124 is on the CS page and MATH 112 is not, and a plan that
  // schedules CS 124 without it is a plan the student cannot register for.
  // The closure walks every high-confidence group of every chosen course and
  // adds the cheapest alternative that nothing already covers.
  //
  // Low-confidence groups are skipped: the parser could not tell an AND from
  // an OR there, and adding a course on a reading we do not trust would put a
  // requirement in the plan that the catalog may not have.
  //
  // So are groups the catalog says school work also satisfies. See
  // priorLearningChecks below for the one that put MATH 112 in every plan.
  const addedPrerequisites: Array<{ code: string; requiredBy: string }> = [];
  const unresolvedPrereqs: Array<{ code: string; needs: string }> = [];
  /** Prerequisite groups no course can fill any more, because of an exclusion. */
  const closedPrereqs: Array<{ code: string; needs: string; alternatives: string[]; by: string }> = [];
  const priorLearningChecks: PriorLearningCheck[] = [];

  /**
   * A course the student already holds that names this one as its prerequisite.
   *
   * MATH 234 lists MATH 112, so a student holding MATH 234 has already been
   * through MATH 112 by the catalog's own statement, and that statement can be
   * quoted back at them. One step only. Following the chain two steps reaches
   * MATH 112 from MATH 220 as well, through a sentence that reads "an adequate
   * ALEKS placement score ... demonstrating knowledge of topics of MATH 115",
   * and telling a student "the catalog says MATH 220 needs MATH 112" off the
   * back of that is a sentence the catalog does not contain.
   *
   * Course numbers are never used. A higher number in the same subject is not
   * a claim Illinois makes about what comes first.
   */
  const heldNaming = (alternatives: string[]): string | null => {
    for (const held of [...satisfiedForPrereq].sort()) {
      const spec = ctx.prereqs?.get(held);
      if (!spec || !spec.parsed) continue;
      for (const group of spec.groups) {
        for (const raw of group.any) {
          if (alternatives.includes(normaliseCode(raw))) return held;
        }
      }
    }
    return null;
  };

  /** Prior credit in the same subject as the course this plan is not booking. */
  const heldInSubjectOf = (alternatives: string[]): string[] => {
    const subjects = new Set(alternatives.map((code) => code.split(' ')[0]));
    return [...satisfiedForPrereq]
      .filter((code) => subjects.has(code.split(' ')[0]) && !alternatives.includes(code))
      .sort();
  };

  {
    const queue = [...chosen.keys()].sort();
    // The catalog is finite and each course enters the queue once, but a
    // malformed file should not be able to spin the browser.
    let guard = 0;
    while (queue.length > 0 && guard < 2000) {
      const code = queue.shift() as string;
      guard += 1;
      const spec = ctx.prereqs?.get(code);
      if (!spec || !spec.parsed) continue;
      for (const group of spec.groups) {
        if (group.confidence === 'low') continue;
        const alternatives: string[] = [];
        for (const raw of group.any) {
          for (const equiv of expandEquivalents(normaliseCode(raw), equivalents)) alternatives.push(equiv);
        }
        if (alternatives.some((alt) => satisfiedForPrereq.has(alt) || chosen.has(alt))) continue;

        /**
         * The catalog offers school work instead. Nothing is booked.
         *
         * This is where MATH 112 came from. CS 124 says "Three years of high
         * school mathematics or MATH 112", the closure could only see the
         * course, and a three hour algebra course went into the first term of
         * every Computer Science plan, a student holding AP Calculus credit
         * included. Booking it also crowded CS 124 out of that term, so the
         * first semester of a Computer Science plan held no Computer Science.
         */
        if (group.priorLearning) {
          if (priorLearningChecks.some((c) => c.code === code && c.alsoAccepts === group.priorLearning)) {
            continue;
          }
          const already = heldNaming(group.any.map(normaliseCode));
          const nearby = already ? [] : heldInSubjectOf(group.any.map(normaliseCode));
          const named = group.any.join(' or ');
          // Named credit the catalog is silent about is still worth saying. It
          // tells a student the plan read their transcript, and it stops short
          // of claiming the catalog lets that credit stand in for the course.
          const heldLine = nearby.length === 0
            ? ''
            : ` You have ${nearby.join(' and ')}. The catalog does not say ${nearby.length === 1 ? 'that replaces' : 'those replace'} ${named}.`;
          priorLearningChecks.push({
            code,
            alternatives: [...group.any],
            alsoAccepts: group.priorLearning,
            text: spec.text,
            settled: already ? 'held' : 'ask',
            message: already
              ? `${code} takes ${group.priorLearning} or ${named}. You already have ${already}, and the catalog lists ${named} as its prerequisite, so this plan does not book it.`
              : `${code} takes ${group.priorLearning} or ${named}. This plan does not book ${named}.${heldLine} Add it if you did not do that at school.`,
          });
          continue;
        }

        const inCatalog = alternatives.filter((alt) => byCode.has(alt));
        if (inCatalog.length === 0) {
          unresolvedPrereqs.push({ code, needs: group.any.join(' or ') });
          continue;
        }

        /**
         * A prerequisite the catalog will not pay for is not one to book.
         *
         * MATH 220's parsed prerequisite names MATH 115, and MATH 115's own
         * catalog line says credit is not given for both. ECON 302 parses to
         * three ANDed calculus groups that exclude one another. Booking them is
         * how a plan came to hold MATH 115, MATH 220, MATH 221 and MATH 234 at
         * once, four courses of which at most one ever counts.
         *
         * Reported only where the whole group is shut, which is the same test
         * the placement matcher makes. A group with a way left that this
         * snapshot happens not to carry is left to the not-placed list, so the
         * two never say different things about one course.
         */
        const open = inCatalog.filter((alt) => conflictFor(alt) === null);
        if (open.length === 0) {
          const blocker = groupClosedByExclusion(group, conflicts, [earned, chosen], equivalents);
          if (blocker !== null) {
            closedPrereqs.push({ code, needs: group.any.join(' or '), alternatives: [...group.any], by: blocker });
          }
          continue;
        }

        /**
         * "CHEM 104 or CHEM 204" is a choice between two courses the catalog
         * will not pay for twice, and the one this adds decides which half of
         * the chemistry sequence the rest of the plan can reach. The plain
         * ranker took CHEM 204 and stranded the ten courses on the Chemical
         * Engineering page that name CHEM 104. Only consulted when the group
         * really does hold a pair like that.
         */
        const pick = holdsTwins(open) ? open.slice().sort(twinPreference)[0] : (best(open) ?? open[0]);
        chosen.set(pick, { requirementId: null, label: `Prerequisite for ${code}` });
        addedPrerequisites.push({ code: pick, requiredBy: code });
        queue.push(pick);
      }
    }
    if (guard >= 2000) {
      notes.push('The prerequisite chain was deeper than this plan follows. Some prerequisites may be missing from it.');
    }
  }
  if (addedPrerequisites.length > 0) {
    notes.push(`Added ${addedPrerequisites.length} course${addedPrerequisites.length === 1 ? '' : 's'} that the degree page does not list but the catalog requires as prerequisites.`);
  }
  // Every one of these, not a sample. Each is a course the student may have to
  // add, and the one left out is the one they needed.
  for (const check of priorLearningChecks) notes.push(check.message);
  for (const item of unresolvedPrereqs.slice(0, 3)) {
    notes.push(`${item.code} lists ${item.needs} as a prerequisite, and ${unresolvedPrereqs.length === 1 ? 'that is' : 'those are'} not in the catalog snapshot.`);
  }
  /**
   * Every one of these, because each is a step in the plan nobody has checked.
   *
   * The sentence stops where the data stops. It says what the catalog says, it
   * says what this plan did, and it does not say that Illinois takes the one
   * course for the other, which is the part only an advisor knows.
   */
  {
    const seen = new Set<string>();
    for (const item of closedPrereqs) {
      const key = `${item.code}|${item.needs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const single = item.alternatives.length === 1;
      const source = earned.has(item.by) ? `You have ${item.by}` : `This plan books ${item.by}`;
      notes.push(
        single
          ? `${item.code} lists ${item.needs} as a prerequisite. ${notBoth(item.needs, item.by)} ${source}, so nothing was booked for it. Ask your advisor whether that clears.`
          : `${item.code} lists ${item.needs} as a prerequisite. ${source}, and none of those count alongside it. Nothing was booked for it. Ask your advisor whether that clears.`,
      );
    }
  }

  // --- can the chains fit at all? -----------------------------------------
  const selected = [...chosen.keys()].sort();
  const { depth, cycles } = buildDepths(selected, ctx.prereqs, satisfiedForPrereq, equivalents);
  const seasonKnown = ctx.offeringPublished ?? new Set<string>();
  const height = buildHeights(selected, ctx.prereqs, equivalents, (code) => {
    const course = byCode.get(code);
    return seasonKnown.has(code) && course && course.offeredIn.length === 1 ? 1 : 0;
  });
  if (cycles.length > 0) {
    notes.push(`The catalog prerequisites loop on ${cycles.slice(0, 3).join(', ')}${cycles.length > 3 ? ` and ${cycles.length - 3} more` : ''}. The plan broke the loop to keep going, so check those by hand.`);
  }

  const toPlace = new Set<string>();
  for (const code of selected) {
    const needs = depth.get(code) ?? 0;
    if (needs >= terms.length) {
      notPlaced.push({
        code,
        title: byCode.get(code)?.title ?? code,
        reason: 'chain-too-long',
        message: `${code} sits ${needs + 1} terms deep in its prerequisite chain, and there are ${terms.length} terms before ${input.horizon.gradSeason} ${input.horizon.gradYear}.`,
        requirementId: chosen.get(code)?.requirementId ?? null,
      });
      continue;
    }
    toPlace.add(code);
  }

  // --- place them ----------------------------------------------------------
  const published = ctx.offeringPublished ?? new Set<string>();

  const isHard = (code: string): boolean => {
    if (hardCut === null) return false;
    const d = grades.get(code)?.difficulty;
    return d !== null && d !== undefined && d >= hardCut;
  };

  /**
   * Hours the student has when a term begins: everything they walked in with
   * plus everything the plan has already placed before it.
   *
   * This is what class standing is measured in. Running it as a term-by-term
   * total rather than recomputing from the whole plan matters because a course
   * that needs senior standing has to be after 90 hours of THIS plan, not after
   * 90 hours that arrive two terms later.
   */
  const standingHours = input.standingHours ?? DEFAULT_STANDING_HOURS;

  /**
   * Whether a term is late enough for a course's class standing requirement.
   *
   * Illinois states these in prose with no course code in them, so the
   * prerequisite matcher never sees them: CS 492 Senior Project I says "For
   * Computer Science majors with senior standing." Before this the course was
   * placed in a first-year fall and the review list reported no problem at all.
   *
   * The thresholds are the university's, not this planner's. Illinois's are in
   * the Student Code § 3-302: sophomore at 30 earned hours, junior at 60,
   * senior at 90.
   */
  const standingMet = (code: string, earnedSoFar: number): boolean => {
    const needs = ctx.prereqs?.get(code)?.standing;
    if (!needs) return true;
    return earnedSoFar >= (standingHours[needs] ?? 0);
  };

  // Unblock the longest chains first, then the shallowest courses, then the
  // lowest catalog number, then the slot ranking. Every step is a total order
  // ending in the course code, so the same inputs always give the same plan.
  const sequenceCodes = new Set((input.sequenceFirst ?? []).map(normaliseCode));
  const earlyTags = input.earlyTags ?? [];
  /** Placed first in every term it is eligible for: a named sequence course, or a course carrying a category due early. */
  const sequenceFirst = {
    has: (code: string): boolean =>
      sequenceCodes.has(code) || (earlyTags.length > 0 && (byCode.get(code)?.tags ?? []).some((t) => earlyTags.includes(t))),
  };
  /**
   * PLAN_DEBUG=<code> on the command line prints why that course was refused
   * in each term. Off in the browser, where process is not defined.
   */
  const debugCode = typeof process !== 'undefined' && process.env ? (process.env.PLAN_DEBUG ?? null) : null;
  const debug = (code: string, term: string, why: string) => {
    if (debugCode && normaliseCode(debugCode) === code) console.error(`  [PLAN_DEBUG] ${code} ${term}: ${why}`);
  };
  /**
   * The last term a course can still start in and leave room for the chain
   * above it: the latest index whose season it runs in with `height` terms
   * to spare. A fall-only course with a chain of one is urgent in the
   * second-to-last fall, not the last term, where it cannot run at all.
   */
  const latestStart = new Map<string, number>();
  for (const code of selected) {
    const course = byCode.get(code);
    const seasonOk = (t: (typeof terms)[number]) =>
      !outOfSeason(course, t.season, seasonKnown.has(code));
    let latest = -1;
    for (let i = terms.length - 1; i >= 0; i -= 1) {
      if (i + (height.get(code) ?? 0) > terms.length - 1) continue;
      if (!seasonOk(terms[i])) continue;
      latest = i;
      break;
    }
    latestStart.set(code, latest);
  }
  /**
   * A due date moves the latest start earlier, and its prerequisites' with
   * it: a math course due by the first spring makes MATH 112 due by the
   * first fall. Alternatives in a group all inherit it; only the chosen one
   * is on the list, and it is the one that matters.
   */
  /**
   * Composition I in the first year.
   *
   * The campus says so in as many words: "you will take the appropriate
   * course or courses in your first year at Illinois"
   * (citl.illinois.edu/placement-testing/information-about-composition-i).
   * As a category filler it had no chain and no date, and Computer Science and
   * Aerospace plans put RHET 105 in a third-year spring, behind every major
   * course. It is due by the second term of the plan, which is the first year
   * for a freshman and the first year here for a transfer who still owes it.
   */
  const dueByTerm: Record<string, number> = { ...input.dueByTerm };
  if (terms.length >= 2) {
    for (const code of selected) {
      if (byCode.get(code)?.tags.includes('Composition I')) dueByTerm[code] = Math.min(dueByTerm[code] ?? 1, 1);
    }
  }
  for (const [raw, due] of Object.entries(dueByTerm)) {
    const code = normaliseCode(raw);
    if (latestStart.has(code)) latestStart.set(code, Math.min(latestStart.get(code) ?? due, due));
  }
  if (Object.keys(dueByTerm).length > 0) {
    let moved = true;
    for (let guard = 0; moved && guard < 20; guard += 1) {
      moved = false;
      for (const code of selected) {
        const mine = latestStart.get(code);
        if (mine === undefined) continue;
        for (const group of orderingGroups(ctx.prereqs?.get(code))) {
          for (const alt of group.any) {
            const p = normaliseCode(alt);
            const theirs = latestStart.get(p);
            if (theirs !== undefined && theirs > mine - 1) { latestStart.set(p, mine - 1); moved = true; }
          }
        }
      }
    }
  }
  /** No slack left: this is the last term the course can start in and still finish its chain. */
  const urgentAt = (code: string, termIndex: number): boolean => termIndex >= (latestStart.get(code) ?? terms.length);
  /**
   * The courses beneath a course's prerequisites, through any alternative
   * and at any depth. MATH 231 asks for MATH 220 or MATH 221, MATH 220 for
   * MATH 115, MATH 115 for MATH 112, so College Algebra sits below Calculus
   * II even for a student who takes MATH 221 and never needs MATH 220.
   *
   * The prerequisites themselves are left out: they are what the course
   * asks for, and one it can do without is an alternative, not a lower rung.
   * NRES 419 takes CHEM 104 or NRES 201, and NRES 201 after NRES 419 is a
   * course the student did not need, not a sequence run backwards. And only
   * within one subject, where the catalog's numbers are one sequence: CHEM
   * 104 takes CHEM 102 or CHEM 202, and CHEM 202 wants calculus, which does
   * not put MATH 220 below General Chemistry II for a student taking CHEM 102.
   */
  const subjectOfCode = (code: string) => code.split(' ')[0];
  const sitsBelow = (code: string, other: string): boolean =>
    subjectOfCode(code) === subjectOfCode(other) && coursesBelow(other).has(code);
  const belowCache = new Map<string, Set<string>>();
  const namedBy = (code: string): string[] =>
    (ctx.prereqs?.get(code)?.groups ?? []).filter((g) => !g.priorLearning).flatMap((g) => g.any.map(normaliseCode));
  const coursesBelow = (code: string): Set<string> => {
    const cached = belowCache.get(code);
    if (cached) return cached;
    const below = new Set<string>();
    const queue = namedBy(code).flatMap(namedBy).filter((c) => c !== code);
    for (const c of queue) below.add(c);
    while (queue.length > 0 && below.size < 400) {
      for (const c of namedBy(queue.shift()!)) {
        if (c === code || below.has(c)) continue;
        below.add(c);
        queue.push(c);
      }
    }
    belowCache.set(code, below);
    return below;
  };
  let orderingTerm = 0;
  /**
   * Courses chosen for a general education category. They have no chains,
   * so "shallowest first" put them ahead of every second-year major course
   * and a Psychology plan opened with three terms of one PSYC course each.
   * Two per term go in their usual order; past that, the major's own courses
   * come first and the categories take what room is left.
   */
  const requirementById = new Map(input.requirements.map((r) => [r.id, r]));
  const genEdPick = new Set<string>();
  for (const [code, pick] of chosen) {
    const req = pick.requirementId ? requirementById.get(pick.requirementId) : null;
    if (req && (req.rule.kind === 'gened' || (req.rule.kind === 'hours' && (req.rule.genEd?.length ?? 0) > 0))) { genEdPick.add(code); continue; }
    // Degree pages also list categories as course pools ("Social Sciences:
    // choose from ..."): a list that spans five or more subjects is a
    // category, not a major requirement, whatever heading it sits under.
    if (req && (req.rule.kind === 'pool' || req.rule.kind === 'choose')) {
      const subjects = new Set(req.rule.choices.flatMap((c) => c.codes.map((x) => normaliseCode(x).split(' ')[0])));
      if (subjects.size >= 5) { genEdPick.add(code); continue; }
    }
    // And a tagged course outside the degree's own subjects is the same kind
    // of pick whatever block it came from.
    const course = byCode.get(code);
    if (course && course.tags.length > 0 && !majorsForRank.subjects.has(course.cluster) && course.cluster !== majorsForRank.primary) genEdPick.add(code);
  }
  if (debugCode) console.error(`  [PLAN_DEBUG] degree subjects: ${[...majorsForRank.subjects].join(', ')} (primary ${majorsForRank.primary}); fillers: ${[...genEdPick].join(', ')}`);
  let genEdHere = 0;
  const placementOrder = (a: string, b: string): number => {
    // A course out of slack goes before everything, or it never goes; among
    // courses out of slack, a requirement before a category filler, because
    // the filler has a hundred stand-ins and the requirement has none. In
    // the last term everything is out of slack, and PHYS 496 lost its seat
    // to a theatre course on catalog number alone.
    const urgency = (code: string) => (urgentAt(code, orderingTerm) ? (genEdPick.has(code) ? 1 : 2) : 0);
    const urgDiff = urgency(b) - urgency(a);
    if (urgDiff !== 0) return urgDiff;
    // Then a language sequence, so its semesters run back to back.
    const seqDiff = (sequenceFirst.has(b) ? 1 : 0) - (sequenceFirst.has(a) ? 1 : 0);
    if (seqDiff !== 0) return seqDiff;
    if (genEdHere >= 2) {
      const geDiff = (genEdPick.has(a) ? 1 : 0) - (genEdPick.has(b) ? 1 : 0);
      if (geDiff !== 0) return geDiff;
    }
    const heightDiff = (height.get(b) ?? 0) - (height.get(a) ?? 0);
    if (heightDiff !== 0) return heightDiff;
    // Equal chains: the major's own course before a course from elsewhere,
    // so a Psychology plan's second year has Psychology in it.
    const majorDiff = (byCode.get(b)?.cluster === majorsForRank.primary ? 1 : 0) - (byCode.get(a)?.cluster === majorsForRank.primary ? 1 : 0);
    if (majorDiff !== 0) return majorDiff;
    const depthDiff = (depth.get(a) ?? 0) - (depth.get(b) ?? 0);
    if (depthDiff !== 0) return depthDiff;
    const levelDiff = courseLevel(a) - courseLevel(b);
    if (levelDiff !== 0) return levelDiff;
    return compareRank(rank(a), rank(b), a, b);
  };

  /**
   * One placement of everything, with every term aiming at `cap` credits.
   *
   * Kept as a function because it is run at most twice: once at the aim the
   * student and the load agree on, and again at the maximum only if that first
   * pass left something out. All the state a pass mutates lives inside it, so a
   * second pass starts clean.
   */
  const place = (cap: number) => {
    const remaining = new Set(toPlace);
    const placed = new Map<string, string[]>();
    const termNotes = new Map<string, string[]>();
    const earlier = new Set<string>(satisfiedForPrereq);
    let hoursBefore = priorCreditTotal;

    for (const term of terms) {
      const here: string[] = [];
      const sameTerm = new Set<string>();
      const noteList: string[] = [];
      const isLastTerm = term.index === terms.length - 1;
      let hardHere = 0;

      genEdHere = 0;
      /**
       * The level guard is a preference, and a term with nothing in it is
       * not. A licensure program made of 300-level courses left its second
       * term empty; when the rounds below leave a term under the minimum,
       * they run once more with the guard down.
       */
      let relaxLevel = false;
      const admit = (code: string) => {
        here.push(code);
        for (const equiv of expandEquivalents(code, equivalents)) sameTerm.add(equiv);
        sameTerm.add(code);
        remaining.delete(code);
        if (isHard(code)) hardHere += 1;
        if (genEdPick.has(code)) genEdHere += 1;
      };
      /**
       * Take a course back out of this term so a course with no slack can
       * have its room. Only a general education pick is ever evicted: it has
       * no chain, so a later term costs it nothing, while the course it makes
       * room for would otherwise never be placed.
       */
      const evict = (code: string) => {
        const at = here.indexOf(code);
        if (at < 0) return;
        here.splice(at, 1);
        sameTerm.delete(code);
        for (const equiv of expandEquivalents(code, equivalents)) sameTerm.delete(equiv);
        remaining.add(code);
        if (isHard(code)) hardHere -= 1;
        if (genEdPick.has(code)) genEdHere -= 1;
      };

      const roomFor = (codes: string[]): boolean => {
        const running = planCreditRange(here, ctx).min;
        const adds = codes.reduce((sum, code) => sum + creditsOf(code), 0);
        // Room is measured against the term's aim, never past the hard maximum:
        // a term under its aim may take one more course even when that course
        // carries it over, and no term goes past the maximum.
        // With a target the student set, a term under it may go one credit
        // past it, not to the maximum: "15 every semester" made a 17 and an
        // 18 early and left a 12 at the end. Without a target this is the
        // old rule, since default plans lean on the slack.
        const ceiling = credits.target !== null ? Math.min(credits.max, Math.max(cap + 1, credits.min + 3)) : credits.max;
        // A summer term the student asked for carries a summer load.
        if (term.season === 'Summer') return running < Math.min(cap, SUMMER_AIM) && running + adds <= Math.min(ceiling, SUMMER_MAX);
        return running < cap && running + adds <= ceiling;
      };

      /**
       * No slack left: the chain above this course, season gaps included,
       * needs every remaining term. An urgent course goes in over the term's
       * aim (never over the maximum) and ahead of the level guard below.
       */
      const urgent = (code: string): boolean => urgentAt(code, term.index);
      orderingTerm = term.index;

      /**
       * Why deferring a hard course for the cap would put it somewhere worse,
       * or null when a later term can take it.
       *
       * Two ways it can. It can land after a course it sits below: at one
       * hardest-band course a term, a Mechanical Engineering freshman's MATH
       * 112 left Fall 2026, where it sat beside MATH 221, for Fall 2027, a
       * term after MATH 231. And a deferred course runs out of slack and goes
       * in over the cap wherever it has got to: that MATH 112 became the third
       * hardest-band course of Fall 2027, beside MATH 241 and PHYS 212, which
       * had no slack either. So a hard course is deferred only when nothing it
       * sits below could come next term ahead of it, and, if it would
       * run out of slack there, the hard courses that must start next term
       * leave it room under the cap. When they do not, it goes to whichever
       * of the two terms ends up with fewer hardest-band courses, and stays
       * here, where the plan without the cap had it, on a tie.
       */
      const deferralMisplaces = (code: string): string | null => {
        // Order is only kept while it is still there to keep. Once a course
        // above this one is on the board, room put it there, not the cap, and
        // holding this one over the cap would not undo that: an Electrical
        // Engineering MATH 112 with no room before MATH 231 was kept beside
        // MATH 241 and ECE 220 as a third hardest-band course.
        const onBoard = [...[...placed.values()].flat(), ...here];
        const orderLost = onBoard.some((other) => other !== code && sitsBelow(code, other));
        if (!orderLost) {
          const through = new Set<string>(earlier);
          for (const c of here) for (const e of expandEquivalents(c, equivalents)) through.add(e);
          // Could start next term: nothing missing, and not waiting, as MCB
          // 354 waits for MCB 250 and MCB 252, on a course its uncertain
          // prerequisites name that is still to be placed.
          const readyNext = (other: string): boolean => {
            const { missing, uncertain } = match(ctx.prereqs?.get(other), through, new Set(), equivalents);
            if (missing.length > 0) return false;
            return !uncertain.some((g) => !g.priorLearning && g.any.some((a) => normaliseCode(a) !== other && remaining.has(normaliseCode(a))));
          };
          const next = [...remaining].find((other) => other !== code && sitsBelow(code, other) && readyNext(other));
          if (next) return `${next} could come next term and sits above it`;
        }
        // A course with slack past the next term is asked again there.
        const nextIndex = term.index + 1;
        if (!urgentAt(code, nextIndex)) return null;
        // Hard courses that must start next term; the ones out of slack now go here.
        const dueNext = [...remaining].filter((other) => other !== code && isHard(other) && urgentAt(other, nextIndex) && !urgent(other)).length;
        if (dueNext < maxHard) return null;
        // Both terms end up over the cap: the course goes where fewer share it,
        // and stays here on a tie. CHEM 102 still leaves a Fall 2027 that MATH
        // 241 and PHYS 212 fill for a Spring 2028 that holds only TAM 212.
        const dueHere = [...remaining].filter((other) => other !== code && isHard(other) && urgent(other)).length;
        if (hardHere + dueHere > dueNext) return null;
        return `${dueNext} other hardest-band ${dueNext === 1 ? 'course has' : 'courses have'} no slack past ${terms[nextIndex]?.label ?? 'the next term'} either`;
      };

      const allowedHere = (code: string): boolean => {
        const course = byCode.get(code);
        if (!course) return false;
        if ((depth.get(code) ?? 0) > term.index) { debug(code, term.label, `prerequisite depth ${depth.get(code)} past term index ${term.index}`); return false; }
        /**
         * A 300-level course waits for sophomore hours and a 400-level course
         * for junior hours, unless the chain above it leaves no slack. The
         * catalog prints standing for only some courses, and a first-semester
         * student in ASTR 404 or a senior seminar is a plan no advisor signs;
         * the fill has refused it for electives all along, and required
         * courses were still landing there.
         */
        /**
         * The hours a student will have by this term, not only the hours the
         * required courses placed so far add up to: the elective fill has not
         * run yet, so `hoursBefore` sits at fifty from the third year on and
         * a 400-level course waited for junior hours that were already there.
         * The estimate is the smaller of the aim and the maximum per term
         * before this one, on top of what the student walked in with.
         */
        const hoursByNow = Math.max(hoursBefore, priorCreditTotal + term.index * Math.min(cap, credits.max));
        if (!relaxLevel && !levelFits(code, hoursByNow, standingHours) && !isLastTerm && !urgent(code)) { debug(code, term.label, `level ${courseLevel(code)} waits for hours (${Math.round(hoursByNow)} by now), slack left`); return false; }
        // Offering is a hard constraint only where the catalog actually
        // publishes a term. Illinois publishes none, and refusing a course a
        // spring slot on the strength of one crawled fall would be inventing
        // the very fact the data does not have.
        if (outOfSeason(course, term.season, published.has(code))) { debug(code, term.label, `runs only in ${course.offeredIn.join('/')}`); return false; }
        /**
         * Class standing, unlike the hardest-band guard below, is never relaxed.
         *
         * It is a registration rule the university enforces, not a preference:
         * a student with 40 hours cannot register for a course that requires
         * senior standing, whatever the plan says. A course that never clears it
         * is reported in notPlaced with the catalog's own sentence rather than
         * being quietly squeezed into the last term.
         */
        // Measured at the plan's own pace, like the level guard above: the
        // hours placed so far leave out the electives the fill adds after, so
        // "Senior Capstone Seminar" in a Sociology plan whose page names 34 of
        // its 120 hours never saw senior standing on paper and fell out of the
        // plan. The validator checks the finished board against real hours.
        if (!standingMet(code, hoursByNow)) { debug(code, term.label, `standing not met at ${Math.round(hoursByNow)} hours by this term`); return false; }
        // The hardest-band guard is relaxed in the final term rather than
        // dropping the course, because a course that never gets placed costs
        // a student a semester and a heavy last term costs them a hard spring.
        if (!isLastTerm && isHard(code) && hardHere >= maxHard && !urgent(code)) {
          const stays = deferralMisplaces(code);
          if (!stays) { debug(code, term.label, `already ${hardHere} hardest-band courses here`); return false; }
          debug(code, term.label, `stays over the hardest-band cap: ${stays}`);
        }
        return true;
      };

      /**
       * A prerequisite the parser read with low confidence still names real
       * courses. It adds nothing to the plan, because "CHEM 232 or CHEM 236,
       * and MCB 250 and MCB 252, or consent of instructor" may be two
       * requirements or three, but a course it names that the plan is about to
       * place still has to come first: MCB 354 went into a first fall ahead
       * of CHEM 232, MCB 250 and MCB 252, all three on the same board.
       */
      const waitsOnPlanned = (code: string): string | null => {
        const { uncertain } = match(ctx.prereqs?.get(code), earlier, sameTerm, equivalents);
        for (const group of uncertain) {
          if (group.priorLearning) continue;
          for (const raw of group.any) {
            const need = normaliseCode(raw);
            if (need === code) continue;
            if (remaining.has(need)) return need;
            if (!group.concurrent && here.includes(need)) return need;
          }
        }
        return null;
      };

      // Fixed point rather than one pass: a course whose prerequisite is allowed
      // concurrently only becomes eligible once that prerequisite is in this term,
      // and the prerequisite may be chosen after it in rank order.
      for (let pass = 0; pass < 2; pass += 1) {
      if (pass === 1) {
        if (planCreditRange(here, ctx).min >= credits.min) break;
        relaxLevel = true;
      }
      for (let round = 0; round < remaining.size + 1; round += 1) {
        const running = planCreditRange(here, ctx).min;

        /**
         * A course with no slack that only lacks room gets first claim, even
         * once the term reads full: a filler or a course with slack already
         * here gives way to it. ME 200 sat two terms late behind a full term
         * of category fillers, and AE 312, AE 433 and AE 460 fell out of the
         * plan behind it.
         */
        const squeezed = [...remaining]
          .filter((code) => urgent(code) && allowedHere(code) && !roomFor([code]))
          .filter((code) => match(ctx.prereqs?.get(code), earlier, sameTerm, equivalents).missing.length === 0 && waitsOnPlanned(code) === null)
          .sort(placementOrder);
        if (squeezed.length > 0) {
          const need = squeezed[0];
          const slackOf = (code: string) => terms.length - 1 - term.index - (height.get(code) ?? 0);
          // Nothing in this term may depend on the victim being here, and the
          // course being made room for may not depend on it at all: evicting
          // the concurrent prerequisite of the very course that needed the
          // seat put that course in the term alone, and the validator called
          // it a prerequisite conflict.
          // Every group, the concurrent ones above all: CHEM 105 sat in a term
          // on "credit or concurrent registration in CHEM 104", CHEM 104 was
          // evicted from under it, and the validator called the pair a conflict.
          const groupsOf = (code: string) => ctx.prereqs?.get(code)?.groups ?? [];
          const dependsOn = (dependent: string, code: string) =>
            groupsOf(dependent).some((g) => g.any.map(normaliseCode).includes(code));
          const neededHere = (code: string) =>
            dependsOn(need, code) || here.some((other) => other !== code && dependsOn(other, code));
          // A filler may give way even with no slack of its own when a
          // requirement needs the seat: the fill will find it another term or
          // another course for its category, and nothing will find the
          // requirement another course.
          const candidates = here.filter(
            (code) =>
              !sequenceFirst.has(code) &&
              !neededHere(code) &&
              ((!urgent(code) && slackOf(code) >= 1) || (genEdPick.has(code) && !genEdPick.has(need))),
          );
          const victim = candidates.sort((x, y) => {
            const ge = (genEdPick.has(y) ? 1 : 0) - (genEdPick.has(x) ? 1 : 0);
            if (ge !== 0) return ge;
            const slack = slackOf(y) - slackOf(x);
            if (slack !== 0) return slack;
            return creditsOf(y) - creditsOf(x);
          })[0];
          if (victim) {
            evict(victim);
            if (roomFor([need])) {
              debug(need, term.label, `made room by moving ${victim} (slack ${slackOf(victim)}) to a later term`);
              admit(need);
              continue;
            }
            admit(victim);
          }
        }

        const eligible: string[] = [];
        for (const code of remaining) {
          if (!allowedHere(code)) continue;
          if (!roomFor([code])) { debug(code, term.label, `no room: ${planCreditRange(here, ctx).min} + ${creditsOf(code)} against aim ${cap}, max ${credits.max}`); continue; }
          const { missing } = match(ctx.prereqs?.get(code), earlier, sameTerm, equivalents);
          if (missing.length > 0) { debug(code, term.label, `prerequisite missing: ${missing.map((g) => g.any.join(' or ')).join('; ')}`); continue; }
          const waiting = waitsOnPlanned(code);
          if (waiting) { debug(code, term.label, `waits for ${waiting}, named in its prerequisites and still to be placed`); continue; }
          eligible.push(code);
        }
        // A term at its aim still takes a course with no slack that has room
        // under the maximum: AE 442 became eligible only once AE 323 was in
        // the term, the term had reached its aim, and AE 443 fell out of the
        // plan a term later for want of it.
        if (running >= cap && !eligible.some((code) => urgent(code))) break;

        if (eligible.length > 0) {
          // Whatever keeps the term at or under its aim goes first. Only when
          // nothing does may a course carry it over, and the placement order
          // still decides which.
          const within = eligible.filter((code) => running + creditsOf(code) <= cap || urgent(code));
          const pool = within.length > 0 ? within : eligible;
          pool.sort(placementOrder);
          if (debugCode && pool.includes(normaliseCode(debugCode)) && pool[0] !== normaliseCode(debugCode)) {
            debug(normaliseCode(debugCode), term.label, `eligible, but ${pool[0]} went first (height ${height.get(pool[0]) ?? 0} vs ${height.get(normaliseCode(debugCode)) ?? 0}, depth ${depth.get(pool[0]) ?? 0} vs ${depth.get(normaliseCode(debugCode)) ?? 0}, genEdHere ${genEdHere}, within ${within.length > 0})`);
          }
          admit(pool[0]);
          continue;
        }

        /**
         * Nothing is placeable on its own. Look for a co-requisite bundle.
         *
         * CHEM 202 says it needs concurrent registration in CHEM 203 and CHEM 203
         * says the same about CHEM 202, so neither can ever go first and the
         * whole general chemistry sequence falls out of the plan. That is not a
         * catalog error, it is a year-long sequence you register for as a unit,
         * and the only way to place it is to place the unit. Only groups the
         * catalog marks concurrent are bundled: a normal prerequisite still has
         * to be in an earlier term.
         */
        const bundle = findCoRequisiteBundle(remaining, earlier, sameTerm, ctx, equivalents, match, allowedHere);
        if (!bundle || !roomFor(bundle)) break;
        for (const code of bundle) admit(code);
        noteList.push(`${bundle.join(' and ')} have to be taken together. The catalog lists each as the other's concurrent prerequisite.`);
      }
      }

      const termCredits = planCreditRange(here, ctx);
      if (here.length > 0 && termCredits.min < credits.min) {
        /**
         * Why a light term is light, where the reason is a rule and not a gap.
         *
         * "Nothing else was eligible this term" is true of a Computer Science
         * Fall 2029 holding CS 464 alone, and it sends a student looking for a
         * course to add. The real answer is that CS 464 needs senior standing,
         * this plan reaches 90 hours only here, and nothing left to take is
         * something they could have taken sooner.
         */
        const gated = here
          .filter((code) => ctx.prereqs?.get(code)?.standing)
          .map((code) => `${code} (${ctx.prereqs?.get(code)?.standing} standing)`)
          .sort();
        noteList.push(
          gated.length > 0 && gated.length === here.length
            ? `${describeCreditTotal(termCredits)}, below the ${credits.min} you asked for. ${gated.join(' and ')} could not come earlier, and nothing else was left.`
            : `${describeCreditTotal(termCredits)}, below the ${credits.min} you asked for. Nothing else was eligible this term.`,
        );
      }
      if (isLastTerm && hardHere > maxHard) {
        noteList.push(`${hardHere} of these are in the hardest band at this school. They landed together because this is the last term in the plan.`);
      }

      placed.set(term.id, here);
      termNotes.set(term.id, noteList);
      for (const code of here) for (const equiv of expandEquivalents(code, equivalents)) earlier.add(equiv);
      // The next term starts with this term's hours banked, which is what moves
      // a student from junior to senior standing part way through a plan.
      hoursBefore += termCredits.min;
    }

    return { placed, termNotes, remaining, earlier, hoursBefore };
  };

  /**
   * How full a term is.
   *
   * Balanced by default: what is left to place, spread evenly over the terms
   * the student has, and never under the full-time minimum. The rounds used to
   * fill every term to the maximum, so a degree that needs fifteen credits a
   * term was planned at eighteen, eighteen, sixteen and a final year of nearly
   * nothing; then they aimed at fifteen, which still front-loaded a degree that
   * spreads to thirteen.
   *
   * The graduation date outranks the number a student asks for. Someone who
   * wants twelve a term and four years, with little credit coming in, cannot
   * have both, so the aim is raised only as far as the load requires and the
   * plan says by how much. Everything is placed once at that aim. Only if
   * something still did not fit is a second pass run at the maximum, and the
   * plan says so when that happens.
   */
  const load = [...toPlace].reduce((sum, code) => sum + creditsOf(code), 0);
  const wanted = credits.target ?? credits.min;
  /**
   * How many of the horizon's terms this student needs.
   *
   * Every term for a first-year student. Fewer for someone who walks in with
   * credit: the remaining hours at a normal load, or at the number they asked
   * for. Spreading 80 credits over eight terms at the minimum planned a whole
   * extra year of tuition for a student who could finish in three, and left a
   * senior year of twelve-credit terms. Prerequisite chains can still push a
   * course past this count; the fill then works with the terms actually used.
   */
  const remainingDegree = input.degreeTotal != null ? Math.max(0, input.degreeTotal - priorCreditTotal) : null;
  const termsNeeded =
    remainingDegree === null || terms.length === 0
      ? terms.length
      : Math.max(1, Math.min(terms.length, Math.ceil(remainingDegree / Math.max(credits.target ?? NORMAL_LOAD, credits.min))));
  const spread = termsNeeded > 0 ? Math.ceil(load / termsNeeded) : credits.min;
  const aim = Math.min(credits.max, Math.max(wanted, spread, credits.min));
  let placement = place(aim);
  if (placement.remaining.size > 0 && aim < credits.max) {
    const packed = place(credits.max);
    if (packed.remaining.size < placement.remaining.size) {
      placement = packed;
      notes.push(`Terms were filled to ${credits.max} credits because not everything fit at about ${aim}.`);
    }
  }
  // With a degree total to reach, the fill below writes the sizing note about
  // the whole plan; this one is for the blocks alone.
  if (placement.placed.size > 0 && (input.degreeTotal ?? null) === null) {
    // "Are left for", not "fit in": a page that asks for more than eighteen a
    // term (Civil Engineering's does) leaves courses over, and those are
    // reported on their own rows rather than claimed here.
    if (credits.target !== null && aim > credits.target) {
      notes.push(`Terms aim for about ${aim} credits rather than the ${credits.target} you asked for, because ${load} credits of coursework are left for the ${terms.length} terms before ${input.horizon.gradSeason} ${input.horizon.gradYear}.`);
    } else if (credits.target === null) {
      notes.push(`Terms aim for about ${aim} credits, an even share of the ${load} credits of coursework left for ${terms.length} terms. Set a number in Preferences to aim higher or lower.`);
    }
  }
  const { placed, termNotes, remaining, earlier, hoursBefore } = placement;

  /**
   * A list pick that did not fit is swapped for the next course on the same
   * list that does. The list was a choice to begin with: CS 416 was the best
   * technical elective for a student's priorities, it runs in one season, no
   * term of that season had room, and the plan reported a technical elective
   * "not placed" while CS 410, 411 and a dozen others on the same list would
   * have gone in. The replacement takes the earliest term where every check
   * the placer makes passes, and the plan says what happened.
   */
  {
    const placedAll = () => new Set([...placed.values()].flat());
    const hoursAt = (index: number) => {
      let h = priorCreditTotal;
      for (const t of terms) if (t.index < index) h += planCreditRange(placed.get(t.id) ?? [], ctx).min;
      return h;
    };
    const beforeSet = (index: number) => {
      const set = new Set<string>(satisfiedForPrereq);
      for (const t of terms) if (t.index < index) for (const c of placed.get(t.id) ?? []) for (const e of expandEquivalents(c, equivalents)) set.add(e);
      return set;
    };
    for (const code of [...remaining].sort()) {
      const entry = poolFills.find(({ fill }) => fill.picked.includes(code));
      if (!entry) continue;
      const { fill, slot } = entry;
      let done = false;
      for (const alt of fill.alternatives) {
        if (done) break;
        if (placedAll().has(alt) || earned.has(alt) || chosen.has(alt)) continue;
        if (conflictFor(alt) !== null) continue;
        const course = byCode.get(alt);
        if (!course) continue;
        // Only terms the plan already uses: a substitute that opens a new
        // term costs the student a semester, which no list choice is worth.
        const lastUsed = Math.max(-1, ...terms.filter((t) => (placed.get(t.id) ?? []).length > 0).map((t) => t.index));
        for (const term of terms) {
          if (term.index > lastUsed) break;
          const here = placed.get(term.id) ?? [];
          if (outOfSeason(course, term.season, published.has(alt))) continue;
          if (planCreditRange(here, ctx).min + creditsOf(alt) > credits.max) continue;
          if (isHard(alt) && here.filter(isHard).length >= maxHard && term.index < terms.length - 1) continue;
          const hours = hoursAt(term.index);
          if (!standingMet(alt, hours) || !levelFits(alt, hours, standingHours)) continue;
          const same = new Set<string>();
          for (const c of here) for (const e of expandEquivalents(c, equivalents)) same.add(e);
          const { missing, uncertain } = match(ctx.prereqs?.get(alt), beforeSet(term.index), same, equivalents);
          if (missing.length > 0 || uncertain.some((g) => !g.priorLearning)) continue;
          placed.set(term.id, [...here, alt]);
          if (debugCode && [code, alt].includes(normaliseCode(debugCode))) console.error(`  [PLAN_DEBUG] list substitution: ${alt} for ${code} in ${term.label}`);
          remaining.delete(code);
          fill.picked = fill.picked.map((c) => (c === code ? alt : c));
          fill.alternatives = [code, ...fill.alternatives.filter((c) => c !== alt)];
          const why = chosen.get(code);
          chosen.delete(code);
          chosen.set(alt, why ?? { requirementId: slot.requirementId, label: slot.label });
          notes.push(`${code} was the first pick for ${slot.label || slot.areaLabel} but did not fit before ${terms[terms.length - 1]?.label ?? 'the last term'}; ${alt}, from the same list, takes its place in ${term.label}.`);
          done = true;
          break;
        }
      }
    }
  }

  for (const code of [...remaining].sort()) {
    const spec = ctx.prereqs?.get(code);
    const { missing } = match(spec, earlier, new Set(), equivalents);

    /**
     * Standing is reported before anything else, because it is the reason.
     *
     * A senior capstone in a plan that never reaches 90 hours would otherwise
     * be filed as "did not fit in 8 terms at up to 18 credits", which sends a
     * student looking for room in a schedule when the real answer is that they
     * are not a senior yet. The catalog's own sentence is quoted so they can
     * check it.
     */
    if (spec?.standing && !standingMet(code, hoursBefore)) {
      notPlaced.push({
        code,
        title: byCode.get(code)?.title ?? code,
        reason: 'standing-unmet',
        message: `${code} needs ${spec.standing} standing, which is ${standingHours[spec.standing]} earned hours. This plan reaches ${Math.round(hoursBefore)}. The catalog says: ${spec.standingText || spec.text}`,
        requirementId: chosen.get(code)?.requirementId ?? null,
      });
      continue;
    }
    // The escape is named, never used. The planner does not get to decide that
    // a student has consent of the instructor, so a course that only clears on
    // consent stays out of the plan and the student is told why.
    const escape = missing.length > 0 && spec?.escape
      ? ` The catalog also allows ${spec.escape === 'consent' ? 'consent of the instructor' : spec.escape === 'standing' ? 'class standing instead' : 'consent of the instructor or class standing'}, which this plan cannot check for you.`
      : '';
    // A group the catalog marks concurrent is not "missing" in any term the
    // course could have gone in, it just never had a term with room for the
    // whole co-requisite set. Calling that a prerequisite problem sends the
    // student looking for a course they do not need to take first.
    const concurrentOnly = missing.length > 0 && missing.every((group) => group.concurrent);
    /**
     * Where a prerequisite the plan cannot supply is one the credit rule shut.
     *
     * ACCY 201 needs ECON 102 and ECON 103, one of them alongside it. An
     * Agricultural and Consumer Economics plan books ACE 100, ECON 102 does not
     * count next to it, and the row read "no term had room for them together".
     * The schedule was never the problem, and pointing at it is the kind of
     * wrong answer that costs a student a semester.
     */
    const shut = new Map<string, string>();
    for (const group of missing) {
      for (const raw of group.any) {
        const alt = normaliseCode(raw);
        if (shut.has(alt)) continue;
        const by = conflictFor(alt);
        if (by !== null) shut.set(alt, by);
      }
    }
    const credit = shut.size === 0
      ? ''
      : ` ${[...shut.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([alt, by]) => notBoth(alt, by)).join(' ')}`;
    /**
     * A course that runs in no season this board has: GEOL 417 and SOCW 436
     * have run only in summer for two years, and the board is falls and
     * springs. "Did not fit" would send the student looking for room that
     * was never the problem.
     */
    const seasonsOnBoard = new Set(terms.map((t) => t.season));
    const offCourse = byCode.get(code);
    const seasonShut =
      missing.length === 0 &&
      published.has(code) &&
      offCourse !== undefined &&
      offCourse.offeredIn.length > 0 &&
      !offCourse.offeredIn.some((season) => seasonsOnBoard.has(season));
    notPlaced.push({
      code,
      title: byCode.get(code)?.title ?? code,
      reason: seasonShut ? 'offering-conflict' : missing.length > 0 && !concurrentOnly ? 'prereq-unmet' : 'no-room',
      message: seasonShut
        ? `${code} has run only in ${offCourse.offeredIn.join(' and ')} terms over the last ${ctx.offeringTerms?.length ?? 8} terms, and this plan has no ${offCourse.offeredIn.join(' or ')} term. Plan it for a ${offCourse.offeredIn[0].toLowerCase()} session, or ask the department when it next runs in fall or spring.`
        : concurrentOnly
          ? `${code} has to be taken alongside ${missing.map((g) => g.any.join(' or ')).join(' and ')}, and no term had room for them together.${credit}`
          : missing.length > 0
            ? `${code} still needs ${missing.map((g) => g.any.join(' or ')).join(', and ')}.${escape}${credit}`
            : `${code} did not fit in ${terms.length} terms at up to ${credits.max} credits.`,
      requirementId: chosen.get(code)?.requirementId ?? null,
    });
  }

  /**
   * What each pool holds now that the board is built.
   *
   * Written here and not at selection time because those are two different
   * numbers. A pool can choose six courses and have one of them fall out for
   * want of a term, and the row a student reads has to be the six minus one.
   * Constraints are rechecked against the board for the same reason.
   */
  const onBoard = new Set<string>();
  for (const codes of placed.values()) for (const code of codes) onBoard.add(code);

  const pools: PoolReport[] = poolFills.map(({ slot, fill }) => {
    const picked = fill.picked.filter((code) => onBoard.has(code));
    const nestedHeld = fill.nested.filter((code) => onBoard.has(code) || earned.has(code));
    const held = [...fill.free, ...nestedHeld, ...picked];
    const heldSet = new Set(held);
    const hours = held.reduce((sum, code) => sum + creditsOf(code), 0);
    const constraints = (slot.constraints ?? []).map((c) => ({
      text: c.text,
      n: c.n,
      ...constraintStatus(c, heldSet),
    }));
    return {
      requirementId: slot.requirementId,
      areaLabel: slot.areaLabel,
      label: slot.label,
      note: slot.note ?? '',
      hoursTarget: slot.hoursTarget,
      countTarget: slot.picks,
      hours,
      count: held.length,
      picked,
      fromPriorCredit: fill.free,
      // Courses that were chosen and did not fit are back on the table: they
      // are the first thing a student would swap in, and hiding them would be
      // the plan quietly deciding they are gone.
      alternatives: [...fill.picked.filter((code) => !onBoard.has(code)), ...fill.alternatives],
      listed: fill.listed,
      available: fill.available,
      constraints,
      url: slot.url,
    };
  });

  const poolRequirements = new Set(pools.map((p) => p.requirementId));
  /** Courses each pool could not use, because their credit would not count. */
  const poolExcluded = new Map<string, Array<{ code: string; by: string }>>();
  for (const { slot, fill } of poolFills) {
    if (fill.excluded.length > 0) poolExcluded.set(slot.requirementId, fill.excluded);
  }

  for (const pool of pools) {
    const shortHours = pool.hoursTarget !== null && pool.hours < pool.hoursTarget;
    const shortCount = pool.countTarget !== null && pool.count < pool.countTarget;
    if (pool.available === 0) {
      unsatisfied.push({
        requirementId: pool.requirementId,
        areaLabel: pool.areaLabel,
        label: pool.label,
        reason: 'no-course-data',
        message: `None of the ${pool.listed} courses the catalog lists here are in this snapshot.`,
        url: pool.url,
      });
    } else if (shortHours || shortCount) {
      const wanted = [
        pool.hoursTarget !== null ? `${pool.hoursTarget} hours` : null,
        pool.countTarget !== null ? `${pool.countTarget} courses` : null,
      ].filter(Boolean).join(' and ');
      const got = [
        pool.hoursTarget !== null ? `${pool.hours} hours` : null,
        pool.countTarget !== null ? `${pool.count} courses` : null,
      ].filter(Boolean).join(' and ');
      /**
       * Why the list came up short, when part of the answer is the credit rule.
       *
       * A pool of a hundred electives is normally short because of terms, and
       * the sentence about the snapshot is the right one. When a course on the
       * list was passed over because its credit would not count, that is a
       * different answer and the student cannot work it out from the numbers.
       */
      const blockedHere = poolExcluded.get(pool.requirementId) ?? [];
      const said = blockedHere.map((row) => notBoth(row.code, row.by)).join(' ');
      const credit = blockedHere.length === 0
        ? ''
        : blockedHere.length === 1
          ? ` One course on this list is not in the plan because its credit would not count. ${said}`
          : ` ${blockedHere.length} courses on this list are not in the plan because their credit would not count. ${said}`;
      unsatisfied.push({
        requirementId: pool.requirementId,
        areaLabel: pool.areaLabel,
        label: pool.label,
        reason: blockedHere.length > 0 ? 'excluded' : 'hours-short',
        message: `${wanted} from this list, ${got} in the plan. ${pool.available} of the ${pool.listed} listed courses are in the catalog snapshot.${credit}`,
        url: pool.url,
      });
    }
    for (const c of pool.constraints) {
      if (c.met) continue;
      unsatisfied.push({
        requirementId: pool.requirementId,
        areaLabel: pool.areaLabel,
        label: pool.label,
        reason: 'constraint-unmet',
        // The sentence, then the count, and no attempt to explain it away.
        message: `${c.text} This plan has ${c.picked.length} of ${c.n}.`,
        url: pool.url,
      });
    }
  }

  const unplacedByRequirement = new Set(notPlaced.map((n) => n.requirementId).filter(Boolean) as string[]);
  for (const requirementId of unplacedByRequirement) {
    const requirement = input.requirements.find((r) => r.id === requirementId);
    if (!requirement) continue;
    // A pool speaks for itself above, against the board rather than against the
    // selection. One of its alternatives not fitting is not a hole in the
    // degree, and reporting it as one sends a student looking for a course they
    // never had to take.
    if (poolRequirements.has(requirementId)) continue;
    if (unsatisfied.some((u) => u.requirementId === requirementId && u.reason === 'did-not-fit')) continue;
    unsatisfied.push({
      requirementId,
      areaLabel: requirement.areaLabel,
      label: requirement.label || requirement.areaLabel,
      reason: 'did-not-fit',
      message: 'At least one course for this requirement did not fit before the graduation term.',
      url: requirement.url,
    });
  }

  // --- fill the hours the degree needs but does not name -------------------
  /**
   * A degree page names its required courses and its lists and then says "24
   * hours of free electives", or nothing at all, about the rest. What the
   * blocks name adds up to 82 of Finance's 124 credits, and a plan that stopped
   * there handed a first-year student a twelve-credit spring, a six-credit fall
   * and a three-credit last term, which is not a four-year plan of anything.
   *
   * So the terms are filled with elective slots until the plan reaches the
   * degree total. Each slot holds a real course the student could register for
   * in that term (prerequisites met, standing and level fit, nothing the catalog
   * says does not count beside it, nothing already on the board or in hand), so
   * the credits and the checks stay exact, and the board shows the slot as an
   * elective with a chooser rather than as a requirement.
   *
   * Balanced by construction: one course per term per round, lightest term
   * first, up to the same even aim the required courses were placed at. Only if
   * the total is still short does a second set of rounds go up to the maximum.
   */
  const electives: Array<{ code: string; why: string; reasons: string[] }> = [];
  const degreeTotalPublished = input.degreeTotal ?? null;
  if (degreeTotalPublished !== null && remainingDegree !== null && terms.length > 0) {
    // The terms in play: the ones this student needs, or one more where a
    // prerequisite chain has pinned a required course later than that.
    let lastRequired = -1;
    terms.forEach((term, index) => {
      if ((placed.get(term.id) ?? []).length > 0) lastRequired = index;
    });
    // Never more terms than the minimum can fill: at 12 a term and 128 hours
    // left, eleven terms is 132 hours before anything is added, and the
    // top-up then padded every one of them to 12. The aim above stays as it
    // was; only the terms the fill spreads over are capped.
    const fillable = remainingDegree !== null ? Math.max(1, Math.floor(remainingDegree / Math.max(1, credits.min))) : termsNeeded;
    const fillTerms = terms.slice(0, Math.max(Math.min(termsNeeded, fillable), lastRequired + 1));
    const overallAim = Math.min(
      credits.max,
      Math.max(credits.target ?? credits.min, Math.ceil(remainingDegree / Math.max(1, fillTerms.length)), credits.min),
    );
    const majors = degreeSubjectsOf(input.requirements, input.programName);
    const stillWanted = new Set<string>();
    for (const u of unsatisfied) {
      const req = input.requirements.find((r) => r.id === u.requirementId);
      if (req && req.rule.kind === 'gened') for (const t of req.rule.genEd) stillWanted.add(t);
    }
    const scoring: ElectiveScoring = {
      byCode,
      primarySubject: majors.primary,
      degreeSubjects: majors.subjects,
      interestWords: interestWordsOf(input.interests),
      sectionCount,
      isHard,
      prereqs: ctx.prereqs,
      creditRanges: ctx.creditRanges,
      creditsOf,
      dormant: dormantCheck(ctx),
      closedToMajor: closedToMajorCheck(ctx, input.programName, input.programCollege),
      rare: rareCheck(ctx),
      quality: qualityFor(ctx, byCode, {
        priorities: prefs.priorities,
        interestWords: interestWordsOf(input.interests),
    profile: interestProfileOf(input.interests),
        primarySubject: majors.primary,
        degreeSubjects: majors.subjects,
        wantedTags: stillWanted,
      }),
    };
    const plannedAll = new Set<string>([...placed.values()].flat());
    const perSubject = new Map<string, number>();
    const candidates = rankedElectivePool(ctx, scoring, (code) => plannedAll.has(code) || earned.has(code) || exempt.has(code) || creditsOf(code) <= 0 || titleClosesTo(byCode.get(code), who));
    let total = priorCreditTotal + [...placed.values()].flat().reduce((sum, code) => sum + creditsOf(code), 0);
    /**
     * Where the hours past the degree total come from, so the note names the
     * real cause. Maya's AP credit and the Computer Engineering courses come
     * to 130 of 128 before a single elective, and her terms run 15 to 17, yet
     * the note said the 2 extra "keep every term at the 12 you set as a
     * minimum". Only the top-up to the minimum is that; what the required
     * courses bring and what a 4-credit last pick rounds up is not.
     */
    const bookedTotal = total;
    let paddedPast = 0;
    let trackPast = 0;
    const overTotal = (): number => Math.max(0, total - degreeTotalPublished);
    /**
     * Hours the page wants at a level it names, by floor.
     *
     * "Advanced Electives: a minimum of two advanced elective courses ... from
     * the 400-level coursework offered for letter grade in ANY area" is six
     * hours of a Computer Science degree that name no course, and the fill
     * treated them as any other hours: CS 101 and CS 102 went in. The fill
     * still books the same number of hours; while a floor is unmet it takes
     * the best course at or above it, and only when no such course fits the
     * term does it fall back to the best course of any level. The level
     * guard keeps a 400-level course out of a first term either way, so the
     * floor is met in the terms where a student could actually register.
     */
    const levelLeft = new Map<number, number>();
    for (const requirement of input.requirements) {
      const rule = requirement.rule;
      if (rule.kind !== 'hours' || (rule.genEd && rule.genEd.length > 0) || !rule.minLevel) continue;
      levelLeft.set(rule.minLevel, (levelLeft.get(rule.minLevel) ?? 0) + rule.hours);
    }
    const floorWanted = (): number | null => {
      let best: number | null = null;
      for (const [floor, left] of levelLeft) if (left > 0 && (best === null || floor > best)) best = floor;
      return best;
    };
    const spendLevel = (code: string): string | null => {
      const floor = floorWanted();
      if (floor === null || courseLevel(code) < floor) return null;
      levelLeft.set(floor, (levelLeft.get(floor) ?? 0) - creditsOf(code));
      return `Toward the ${floor}-level hours the degree page asks for.`;
    };
    /**
     * A pre-professional track the student named, from the Illinois Career
     * Center's guides (lib/planner/career-tracks.ts): the courses it marks
     * required or strongly recommended that the student does not hold, first
     * claim on free electives. A pre-PT Kinesiology student with room for
     * thirty hours of electives got two meteorology courses and no physics;
     * physical therapy schools ask for PHYS 101 and 102.
     */
    const tracks = interestProfileOf(input.interests).tracks;
    const trackWanted = new Map<string, { track: string; why: string }>();
    const trackHeld: string[] = [];
    // Required before strongly recommended, whatever order the guide lists
    // them in: medical terminology was booked while physics, which every
    // physical therapy program requires, did not fit.
    const wantedInOrder: Array<{ code: string; track: string; why: string; rank: number }> = [];
    for (const track of tracks) {
      for (const need of track.courses) {
        if (need.need === 'suggested') continue;
        const codes = need.codes.map(normaliseCode);
        const have = codes.find((c) => earned.has(c) || exempt.has(c) || plannedAll.has(c));
        if (have) { if (earned.has(have)) trackHeld.push(have); continue; }
        const first = codes.find((c) => byCode.has(c) && !wantedInOrder.some((w) => w.code === c) && creditsOf(c) > 0);
        if (first) wantedInOrder.push({ code: first, track: track.name, why: need.why, rank: need.need === 'required' ? 0 : 1 });
      }
    }
    for (const w of wantedInOrder.sort((a, b) => a.rank - b.rank)) trackWanted.set(w.code, { track: w.track, why: w.why });
    const pickFrom = (fits: (code: string) => boolean): string | undefined => {
      const track = [...trackWanted.keys()].find((code) => !plannedAll.has(code) && fits(code));
      if (track) return track;
      const floor = floorWanted();
      const atLevel = floor !== null ? candidates.find((code) => courseLevel(code) >= floor && fits(code)) : undefined;
      return atLevel ?? candidates.find(fits);
    };

    for (const ceiling of [overallAim, credits.max]) {
      let progress = true;
      while (total < degreeTotalPublished && progress) {
        progress = false;
        // The lightest term by credits first, and between terms of equal
        // credits the easier one by grade history, so a free pick lands where
        // it evens the plan out rather than beside the hardest courses.
        const termDifficulty = (term: (typeof terms)[number]) => termLoad(placed.get(term.id) ?? [], grades).avgDifficulty ?? 0;
        const order = fillTerms
          .slice()
          .sort((a, b) => planCreditRange(placed.get(a.id) ?? [], ctx).min - planCreditRange(placed.get(b.id) ?? [], ctx).min || termDifficulty(a) - termDifficulty(b) || a.index - b.index);
        for (const term of order) {
          if (total >= degreeTotalPublished) break;
          const here = placed.get(term.id) ?? [];
          placed.set(term.id, here);
          const running = planCreditRange(here, ctx).min;
          const termCeiling = term.season === 'Summer' ? Math.min(ceiling, SUMMER_AIM) : ceiling;
          if (running >= termCeiling) continue;
          // What is earlier depends on what the last round added, so it is
          // rebuilt for every attempt rather than carried.
          const earlierSet = new Set<string>(satisfiedForPrereq);
          let hoursSoFar = priorCreditTotal;
          for (const other of terms) {
            if (other.index >= term.index) break;
            const codes = placed.get(other.id) ?? [];
            for (const code of codes) for (const equiv of expandEquivalents(code, equivalents)) earlierSet.add(equiv);
            hoursSoFar += planCreditRange(codes, ctx).min;
          }
          const sameTerm = new Set<string>();
          for (const code of here) for (const equiv of expandEquivalents(code, equivalents)) sameTerm.add(equiv);
          const hardHere = here.filter(isHard).length;
          const fitsHere = (code: string): boolean => {
            if (plannedAll.has(code)) return false;
            if (input.notTowardDegree?.(code)) return false;
            if (preparesForHeld(code, ctx.prereqs, (c) => plannedAll.has(c) || earned.has(c))) return false;
            const course = byCode.get(code);
            if (!course) return false;
            if (!trackWanted.has(code) && !subjectRoomLeft(course.cluster, perSubject, majors.primary, majors.subjects)) return false;
            if (running + creditsOf(code) > (term.season === 'Summer' ? Math.min(ceiling, SUMMER_MAX) : ceiling)) return false;
            if (outOfSeason(course, term.season, published.has(code))) return false;
            if (!standingMet(code, hoursSoFar) || !levelFits(code, hoursSoFar, standingHours)) return false;
            // No last-term exemption here: an elective is never forced into a term.
            if (isHard(code) && hardHere >= maxHard) return false;
            if (conflictWith(code, conflicts, [earned, chosen, plannedAll]) !== null) return false;
            if (expandEquivalents(code, equivalents).some((twin) => twin !== code && (plannedAll.has(twin) || earned.has(twin)))) return false;
            return electivePrereqsMet(match(ctx.prereqs?.get(code), earlierSet, sameTerm, equivalents));
          };
          // A term already heavy by grade history takes a light elective when
          // one fits, so the planner's own picks do not stack on the hardest
          // courses the degree requires.
          const heavyHere = ['heavy', 'brutal'].includes(bandVerdictFor(hardHere, termLoad(here, grades).avgDifficulty, (ctx.bands ?? FALLBACK_BANDS)));
          const lighter = (code: string) => (grades.get(code)?.difficulty ?? 0) < (ctx.bands ?? FALLBACK_BANDS).harder;
          const pick = (heavyHere ? pickFrom((code) => lighter(code) && fitsHere(code)) : undefined) ?? pickFrom(fitsHere);
          if (!pick) continue;
          here.push(pick);
          plannedAll.add(pick);
          chosen.set(pick, { requirementId: null, label: 'Elective' });
          total += creditsOf(pick);
          const subject = byCode.get(pick)?.cluster ?? '';
          perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
          const levelWhy = spendLevel(pick);
          electives.push({ code: pick, why: trackWanted.has(pick) ? `For ${trackWanted.get(pick)!.track}: ${trackWanted.get(pick)!.why}` : `${electiveWhy(byCode.get(pick), scoring.degreeSubjects, scoring.quality(pick))}${levelWhy ? ` ${levelWhy}` : ''}`, reasons: scoring.quality(pick).reasons });
          progress = true;
        }
      }
    }
    /**
     * The terms the degree pins stay full-time.
     *
     * A student with forty-eight hours in hand needs seventy-six more, and the
     * fill stops the moment it has them. But the last required courses sit in
     * the last terms whatever the total says (FIN 411 waits on FIN 321 waits on
     * standing), so stopping there left 9, 6 and 3 credit terms at the end of a
     * plan that had reached its total. The student set a minimum per term and
     * that minimum holds in every term the plan uses, even past the total: the
     * hours beyond it are named in a note, with the setting that would change it.
     */
    const usedTerms = terms.filter((term) => (placed.get(term.id) ?? []).length > 0);
    let topped = true;
    while (topped) {
      topped = false;
      for (const term of usedTerms) {
        const here = placed.get(term.id) ?? [];
        const running = planCreditRange(here, ctx).min;
        // A summer term is never topped up to the fall and spring minimum.
        if (term.season === 'Summer' || running >= credits.min) continue;
        const earlierSet = new Set<string>(satisfiedForPrereq);
        let hoursSoFar = priorCreditTotal;
        for (const other of terms) {
          if (other.index >= term.index) break;
          const codes = placed.get(other.id) ?? [];
          for (const code of codes) for (const equiv of expandEquivalents(code, equivalents)) earlierSet.add(equiv);
          hoursSoFar += planCreditRange(codes, ctx).min;
        }
        const sameTerm = new Set<string>();
        for (const code of here) for (const equiv of expandEquivalents(code, equivalents)) sameTerm.add(equiv);
        const hardHere = here.filter(isHard).length;
        const fitsHere = (code: string): boolean => {
          if (plannedAll.has(code)) return false;
          if (input.notTowardDegree?.(code)) return false;
          if (preparesForHeld(code, ctx.prereqs, (c) => plannedAll.has(c) || earned.has(c))) return false;
          const course = byCode.get(code);
          if (!course) return false;
          if (!trackWanted.has(code) && !subjectRoomLeft(course.cluster, perSubject, majors.primary, majors.subjects)) return false;
          if (running + creditsOf(code) > credits.max) return false;
          if (outOfSeason(course, term.season, published.has(code))) return false;
          if (!standingMet(code, hoursSoFar) || !levelFits(code, hoursSoFar, standingHours)) return false;
          if (isHard(code) && hardHere >= maxHard) return false;
          if (conflictWith(code, conflicts, [earned, chosen, plannedAll]) !== null) return false;
          if (expandEquivalents(code, equivalents).some((twin) => twin !== code && (plannedAll.has(twin) || earned.has(twin)))) return false;
          return electivePrereqsMet(match(ctx.prereqs?.get(code), earlierSet, sameTerm, equivalents));
        };
        const heavyHere = ['heavy', 'brutal'].includes(bandVerdictFor(hardHere, termLoad(here, grades).avgDifficulty, (ctx.bands ?? FALLBACK_BANDS)));
        const lighter = (code: string) => (grades.get(code)?.difficulty ?? 0) < (ctx.bands ?? FALLBACK_BANDS).harder;
        const pick = (heavyHere ? pickFrom((code) => lighter(code) && fitsHere(code)) : undefined) ?? pickFrom(fitsHere);
        if (!pick) continue;
        here.push(pick);
        plannedAll.add(pick);
        chosen.set(pick, { requirementId: null, label: 'Elective' });
        const overBefore = overTotal();
        total += creditsOf(pick);
        paddedPast += overTotal() - overBefore;
        const subject = byCode.get(pick)?.cluster ?? '';
        perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
        const levelWhy = spendLevel(pick);
        electives.push({ code: pick, why: trackWanted.has(pick) ? `For ${trackWanted.get(pick)!.track}: ${trackWanted.get(pick)!.why}` : `${electiveWhy(byCode.get(pick), scoring.degreeSubjects, scoring.quality(pick))}${levelWhy ? ` ${levelWhy}` : ''}`, reasons: scoring.quality(pick).reasons });
        topped = true;
      }
    }
    /**
     * Required track courses the degree total left no room for. The total is
     * a minimum: a pre-PT student who asked for four years and has a year of
     * them unused still needs physics, and a plan that stops at 120 credits a
     * year early with "PHYS 101 and 102 did not fit" is not the plan an
     * advisor writes. They go in the student's own terms, up to the end they
     * gave, at most 18 credits a term, and the plan says what they add.
     */
    const pastTotal: string[] = [];
    const lastUsedTerm = Math.max(-1, ...terms.filter((t) => (placed.get(t.id) ?? []).length > 0).map((t) => t.index));
    const trackRequired = new Set(
      [...trackWanted].filter(([code, want]) => tracks.find((t) => t.name === want.track)?.courses.find((c) => c.codes.map(normaliseCode).includes(code))?.need === 'required').map(([code]) => code),
    );
    const neededOnBoard = (code: string) => {
      const names = new Set(expandEquivalents(code, equivalents));
      return [...placed.values()].flat().some((other) => other !== code && (ctx.prereqs?.get(other)?.groups ?? []).some((g) => g.any.some((a) => names.has(normaliseCode(a)))));
    };
    for (const code of trackRequired) {
      if (plannedAll.has(code)) continue;
      const want = trackWanted.get(code)!;
      const course = byCode.get(code);
      if (!course || conflictWith(code, conflicts, [earned, chosen, plannedAll]) !== null) continue;
      // Only terms the plan already uses: a pre-PT plan grew two 5-credit
      // terms at the end for PHYS 101 and 102, which no advisor would write.
      for (const term of terms) {
        if (term.index > lastUsedTerm) break;
        const here = placed.get(term.id) ?? [];
        if (outOfSeason(course, term.season, published.has(code))) continue;
        let hours = priorCreditTotal;
        const before = new Set<string>(satisfiedForPrereq);
        for (const other of terms) {
          if (other.index >= term.index) break;
          const codes = placed.get(other.id) ?? [];
          for (const c of codes) for (const e of expandEquivalents(c, equivalents)) before.add(e);
          hours += planCreditRange(codes, ctx).min;
        }
        if (!standingMet(code, hours) || !levelFits(code, hours, standingHours)) continue;
        const same = new Set<string>();
        for (const c of here) for (const e of expandEquivalents(c, equivalents)) same.add(e);
        if (!electivePrereqsMet(match(ctx.prereqs?.get(code), before, same, equivalents))) continue;
        // Room, made if need be by taking out the planner's own lesser picks
        // in this term: a generic elective first, then a course the guide
        // only recommends. Never a requirement, never a course another on the
        // board needs first.
        const max = term.season === 'Summer' ? SUMMER_MAX : credits.max;
        let running = planCreditRange(here, ctx).min;
        const removable = here
          .filter((c) => (chosen.get(c)?.requirementId ?? null) === null && !trackRequired.has(c) && !neededOnBoard(c))
          .sort((a, b) => Number(trackWanted.has(a)) - Number(trackWanted.has(b)) || creditsOf(a) - creditsOf(b));
        const out: string[] = [];
        for (const c of removable) {
          if (running + creditsOf(code) <= max) break;
          out.push(c);
          running -= creditsOf(c);
        }
        if (running + creditsOf(code) > max) continue;
        const hardAfter = here.filter((c) => !out.includes(c)).filter(isHard).length;
        if (isHard(code) && hardAfter >= maxHard) continue;
        const overBefore = overTotal();
        for (const c of out) {
          plannedAll.delete(c);
          chosen.delete(c);
          total -= creditsOf(c);
          const at = electives.findIndex((e) => e.code === c);
          if (at >= 0) electives.splice(at, 1);
        }
        placed.set(term.id, [...here.filter((c) => !out.includes(c)), code]);
        plannedAll.add(code);
        chosen.set(code, { requirementId: null, label: 'Elective' });
        total += creditsOf(code);
        trackPast += overTotal() - overBefore;
        electives.push({ code, why: `For ${want.track}: ${want.why}`, reasons: [] });
        pastTotal.push(code);
        break;
      }
    }
    if (pastTotal.length > 0) {
      notes.push(`${pastTotal.join(', ')} ${pastTotal.length === 1 ? 'is' : 'are'} required for the goal you named, placed where the planner's own lesser picks were. Drop ${pastTotal.length === 1 ? 'it' : 'them'} if the goal changes.`);
    }
    for (const track of tracks) {
      const mine = [...trackWanted].filter(([, t]) => t.track === track.name).map(([code]) => code);
      const booked = mine.filter((code) => plannedAll.has(code));
      const missed = mine.filter((code) => !plannedAll.has(code));
      notes.push(
        `${track.name}: ${booked.length > 0 ? `the plan books ${booked.join(', ')} as electives` : 'no elective room was left for the courses'} from ${track.source.title} (${track.source.url})${trackHeld.length > 0 ? `; you already hold ${[...new Set(trackHeld)].join(', ')}` : ''}${missed.length > 0 ? `; ${missed.join(', ')} did not fit, so plan them with your advisor` : ''}. ${track.note}`,
      );
    }
    const beyondNote = describeBeyondTotal({
      degreeTotal: degreeTotalPublished,
      total,
      booked: bookedTotal,
      prior: priorCreditTotal,
      padded: paddedPast,
      track: trackPast,
      minimum: credits.min,
    });
    if (beyondNote) notes.push(beyondNote);
    // A term that was light before the fill is not light now.
    for (const term of terms) {
      if (planCreditRange(placed.get(term.id) ?? [], ctx).min >= credits.min) {
        termNotes.set(term.id, (termNotes.get(term.id) ?? []).filter((n) => !/below the \d+ you asked for/.test(n)));
      }
    }
    if (credits.target !== null && overallAim > credits.target) {
      notes.push(`Terms aim for about ${overallAim} credits rather than the ${credits.target} you asked for, because ${remainingDegree} credits are left toward the ${degreeTotalPublished} this degree takes, over ${fillTerms.length} terms before ${input.horizon.gradSeason} ${input.horizon.gradYear}.`);
    } else if (credits.target === null) {
      notes.push(`Terms aim for about ${overallAim} credits, an even share of the ${remainingDegree} credits left toward the ${degreeTotalPublished} this degree takes, over ${fillTerms.length} terms. Set a number in Preferences to aim higher or lower.`);
    }
    if (electives.length > 0) {
      notes.push(
        `${electives.length} ${electives.length === 1 ? 'slot is an elective' : 'slots are electives'} that fill the ${degreeTotalPublished} credits this degree takes beyond what its page names. Each holds a suggested course; tap it to choose from everything you could take that term.`,
      );
    }
    if (total < degreeTotalPublished) {
      // When the terms simply cannot hold the credits, say so and say what
      // changes it: a finish date two years out with 76 hours left is four
      // terms of 18, 72 hours, and "nothing else fit" left the student
      // guessing why.
      const capacity = fillTerms.length * credits.max;
      const needed = degreeTotalPublished - priorCreditTotal;
      notes.push(
        needed > capacity
          ? `Finishing by ${input.horizon.gradSeason} ${input.horizon.gradYear} needs ${Math.round(needed)} more credits, and ${fillTerms.length} ${fillTerms.length === 1 ? 'term holds' : 'terms hold'} at most ${capacity} at ${credits.max} each. This plan reaches ${Math.round(total)} of ${degreeTotalPublished}; a summer session, one more term, or a later finish date closes the gap.`
          : `This plan reaches ${Math.round(total)} of the ${degreeTotalPublished} credits the degree takes. Nothing else eligible fit before ${input.horizon.gradSeason} ${input.horizon.gradYear}.`,
      );
    }
  }

  /**
   * Class standing on the finished board.
   *
   * Placement measures standing at the plan's pace, because the electives that
   * make up that pace are only added afterwards. The finished board can still
   * come in an hour or two short: ECE 496 "Senior Research Project" sat in a
   * term that began at 89 hours of the 90 senior standing takes, and the
   * validator was right to call it an error. Two repairs, neither of which adds
   * a credit. First, bring a course forward from a later term into an earlier
   * one with room, so more hours come before; any course whose prerequisites,
   * season, level, standing and the hard-course cap all allow it, the planner's
   * own picks tried first. Failing that, move the course itself to the first
   * later term where the standing is there and nothing on the board needs it
   * sooner.
   */
  {
    const needFor = (code: string): number | null => {
      const s = ctx.prereqs?.get(code)?.standing;
      return s ? (standingHours[s] ?? null) : null;
    };
    const creditsIn = (index: number) => planCreditRange(placed.get(terms[index].id) ?? [], ctx).min;
    const hoursBeforeIndex = (index: number) => {
      let h = priorCreditTotal;
      for (let i = 0; i < index; i += 1) h += creditsIn(i);
      return h;
    };
    const setBefore = (index: number) => {
      const set = new Set<string>(satisfiedForPrereq);
      for (let i = 0; i < index; i += 1) for (const c of placed.get(terms[i].id) ?? []) for (const e of expandEquivalents(c, equivalents)) set.add(e);
      return set;
    };
    const setIn = (index: number, without?: string) => {
      const set = new Set<string>();
      for (const c of placed.get(terms[index].id) ?? []) if (c !== without) for (const e of expandEquivalents(c, equivalents)) set.add(e);
      return set;
    };
    const seasonFits = (code: string, index: number) => {
      const course = byCode.get(code);
      return !outOfSeason(course, terms[index].season, published.has(code));
    };
    const hardIn = (index: number) => (placed.get(terms[index].id) ?? []).filter(isHard).length;
    const fitsAt = (code: string, index: number) => {
      const worth = creditsOf(code);
      if (creditsIn(index) + worth > credits.max) return false;
      if (!seasonFits(code, index)) return false;
      if (isHard(code) && hardIn(index) >= maxHard) return false;
      const hours = hoursBeforeIndex(index);
      if (!standingMet(code, hours) || !levelFits(code, hours, standingHours)) return false;
      return match(ctx.prereqs?.get(code), setBefore(index), setIn(index), equivalents).missing.length === 0;
    };
    const neededBy = (code: string, uptoIndex: number) => {
      const names = new Set(expandEquivalents(code, equivalents));
      for (let i = 0; i <= uptoIndex; i += 1) {
        for (const other of placed.get(terms[i].id) ?? []) {
          if (other === code) continue;
          if ((ctx.prereqs?.get(other)?.groups ?? []).some((g) => g.any.some((a) => names.has(normaliseCode(a))))) return true;
        }
      }
      return false;
    };
    const move = (code: string, from: number, to: number) => {
      placed.set(terms[from].id, (placed.get(terms[from].id) ?? []).filter((c) => c !== code));
      placed.set(terms[to].id, [...(placed.get(terms[to].id) ?? []), code]);
      if (debugCode && normaliseCode(debugCode) === code) console.error(`  [PLAN_DEBUG] ${code} standing repair moved it ${terms[from].label} -> ${terms[to].label}`);
    };
    for (let pass = 0; pass < 8; pass += 1) {
      let changed = false;
      for (let i = 0; i < terms.length && !changed; i += 1) {
        for (const code of placed.get(terms[i].id) ?? []) {
          const need = needFor(code);
          if (need === null || hoursBeforeIndex(i) >= need) continue;
          // 1. Bring a course forward, the planner's own picks first.
          const later: Array<{ code: string; from: number; own: number }> = [];
          for (let j = i + 1; j < terms.length; j += 1) {
            for (const c of placed.get(terms[j].id) ?? []) {
              if (needFor(c) !== null) continue;
              const own = genEdPick.has(c) || (chosen.get(c)?.requirementId ?? null) === null ? 0 : 1;
              later.push({ code: c, from: j, own });
            }
          }
          later.sort((a, b) => a.own - b.own || creditsOf(b.code) - creditsOf(a.code));
          let done = false;
          for (const cand of later) {
            for (let k = i - 1; k >= 0 && !done; k -= 1) {
              if (fitsAt(cand.code, k)) {
                move(cand.code, cand.from, k);
                done = true;
              }
            }
            if (done) break;
          }
          if (!done) {
            // 2. Move the course itself to the first later term that has the standing.
            for (let j = i + 1; j < terms.length && !done; j += 1) {
              if (neededBy(code, j)) break;
              const hours = hoursBeforeIndex(j) - creditsOf(code);
              if (hours < need) continue;
              const worth = creditsOf(code);
              if (creditsIn(j) + worth > credits.max || !seasonFits(code, j)) continue;
              if (isHard(code) && hardIn(j) >= maxHard && j < terms.length - 1) continue;
              move(code, i, j);
              done = true;
            }
          }
          if (!done) {
            // 3. Swap it with a course from a later term that needs no
            // standing: both terms keep their size, the course goes where
            // the student is a senior, and the other comes back to where its
            // own prerequisites are already met. Chemical Engineering had
            // CHBE 440 at 85 hours with every later term at 18 credits.
            for (let j = i + 1; j < terms.length && !done; j += 1) {
              if (neededBy(code, j)) break;
              for (const other of placed.get(terms[j].id) ?? []) {
                if (needFor(other) !== null) continue;
                const room = (index: number, out: string, add: string) => creditsIn(index) - creditsOf(out) + creditsOf(add) <= credits.max;
                if (!room(i, code, other) || !room(j, other, code)) continue;
                if (!seasonFits(other, i) || !seasonFits(code, j)) continue;
                move(code, i, j);
                move(other, j, i);
                const ok =
                  hoursBeforeIndex(j) >= need &&
                  match(ctx.prereqs?.get(other), setBefore(i), setIn(i), equivalents).missing.length === 0 &&
                  levelFits(other, hoursBeforeIndex(i), standingHours) &&
                  !(isHard(code) && hardIn(j) > maxHard && j < terms.length - 1) &&
                  !(isHard(other) && hardIn(i) > maxHard);
                if (ok) {
                  done = true;
                  break;
                }
                move(other, i, j);
                move(code, j, i);
              }
            }
          }
          if (!done) {
            // 4. One small course in an earlier term with room, sized to the
            // shortfall. A transfer student at 88 of the 90 hours ANTH 430
            // asks for, with every earlier term full to the brim and nothing
            // able to move, is two credits short; an advisor would add a
            // one- or two-credit course a term before, and so does the plan,
            // chosen by the student's own priorities and never a hard course.
            const short = need - hoursBeforeIndex(i);
            const onBoard = new Set([...placed.values()].flat());
            for (let k = i - 1; k >= 0 && !done; k -= 1) {
              const room = credits.max - creditsIn(k);
              if (room < short) continue;
              const pick = ctx.courses
                .map((c) => normaliseCode(c.code))
                .filter((c) => {
                  const worth = creditsOf(c);
                  return worth >= short && worth <= room && worth <= 3 && !onBoard.has(c) && !earned.has(c) && !exempt.has(c) && !isHard(c) &&
                    needFor(c) === null && courseLevel(c) < 300 && !reallyVariable(ctx.creditRanges?.get(c)) &&
                    !(input.notTowardDegree?.(c)) && conflictWith(c, conflicts, [earned, onBoard]) === null && fitsAt(c, k);
                })
                .sort((a, b) => creditsOf(a) - creditsOf(b) || qualityAtPlacement(b).score - qualityAtPlacement(a).score || a.localeCompare(b))[0];
              if (!pick) continue;
              placed.set(terms[k].id, [...(placed.get(terms[k].id) ?? []), pick]);
              chosen.set(pick, { requirementId: null, label: 'Elective' });
              electives.push({ code: pick, why: `Added so ${code} in ${terms[i].label} has the ${need} hours its standing asks for.`, reasons: [] });
              notes.push(`${pick} is added to ${terms[k].label} so that ${code} in ${terms[i].label} starts at ${need} hours, the standing it asks for; without it the plan would be ${short} ${short === 1 ? 'hour' : 'hours'} short.`);
              done = true;
            }
          }
          if (done) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) break;
    }
  }

  // --- report --------------------------------------------------------------
  const everyTerm: PlannedTerm[] = terms.map((term) => {
    const codes = placed.get(term.id) ?? [];
    const load = termLoad(codes, grades);
    const weighed = codes.filter((code) => grades.get(code)?.difficulty != null).length;
    const hard = hardCut === null ? [] : codes.filter(isHard).sort();
    const notesHere = [...(termNotes.get(term.id) ?? [])];
    if (codes.length > 0 && weighed < codes.length) {
      notesHere.push(`Weighed ${weighed} of ${codes.length} courses. The rest have no grade data.`);
    }
    return {
      id: term.id,
      label: term.label,
      season: term.season,
      // PlanTerm.year is typed 1 to 4. A plan longer than eight terms is still
      // generated and still correct; only the year label saturates, and the
      // note below says so rather than the plan quietly pretending it is shorter.
      year: Math.min(4, Math.floor(term.index / 2) + 1),
      index: term.index,
      codes,
      credits: planCreditRange(codes, ctx),
      load: {
        avgDifficulty: load.avgDifficulty,
        verdict: load.verdict,
        bandVerdict: bandVerdictFor(hard.length, load.avgDifficulty, ctx.bands ?? FALLBACK_BANDS),
        hard,
        weighed,
        unweighed: codes.length - weighed,
      },
      notes: notesHere,
    };
  });

  /**
   * The plan stops at the last term that holds a course.
   *
   * The board names its own last column, so a horizon term the plan never
   * filled was printed as the end of the plan: a Computer Science freshman read
   * "104 to 106 cr through Spring 2030" over a Spring 2030 holding nothing.
   * That is eight semesters of enrolment and eight semesters of tuition on the
   * screen for seven semesters of work.
   *
   * Spreading the work into that term instead was the other option and it does
   * not help here. What is left at the end is held back by class standing and
   * by prerequisite depth, not by room: moving courses later would only make
   * two thin terms out of one thin term and one full one. An empty term is kept
   * only when the whole plan is empty, so the board still has a column to drop
   * a course into.
   */
  let lastUsed = -1;
  everyTerm.forEach((term, index) => {
    if (term.codes.length > 0) lastUsed = index;
  });
  const plannedTerms = lastUsed < 0 ? everyTerm.slice(0, 1) : everyTerm.slice(0, lastUsed + 1);
  if (lastUsed >= 0 && lastUsed < everyTerm.length - 1) {
    const spare = everyTerm.length - 1 - lastUsed;
    notes.push(
      `This plan finishes in ${everyTerm[lastUsed].label}, ${spare} term${spare === 1 ? '' : 's'} before the ${input.horizon.gradSeason} ${input.horizon.gradYear} you asked for.`,
    );
  }

  if (plannedTerms.length > 8) {
    notes.push(`This plan runs ${plannedTerms.length} terms. The board labels everything past the eighth as year four.`);
  }

  const placedCodes = plannedTerms.flatMap((t) => t.codes);
  const plannedCredits = planCreditRange(placedCodes, ctx);
  const priorCredits = priorCreditTotal;
  /**
   * Prior credit is a settled number, so it widens neither end of the range.
   * Only the plan's own variable-credit courses do that, and `unknown` stays
   * the plan's because a course already taken has a grade and therefore hours.
   */
  const totalCredits: CreditTotal = {
    min: plannedCredits.min + priorCredits,
    max: plannedCredits.max + priorCredits,
    variable: plannedCredits.variable,
    unknown: plannedCredits.unknown,
  };

  const degreeTotal = input.requirements.reduce<number | null>((total, requirement) => {
    if (requirement.hours === null) return total;
    return (total ?? 0) + requirement.hours;
  }, null);

  const unaccounted = degreeTotal === null
    ? null
    : Math.max(0, degreeTotal - (plannedCredits.min + priorCredits));

  const snapshot = ctx.snapshotTerm ?? null;
  const offeringUnknown: string[] = [];
  const seenOnlyInSnapshot: string[] = [];
  for (const code of placedCodes) {
    if (published.has(code)) continue;
    const summary = ctx.sections?.get(code);
    if (summary && summary.total > 0) seenOnlyInSnapshot.push(code);
    else offeringUnknown.push(code);
  }
  const offeringMessage = published.size > 0 || placedCodes.length === 0
    ? null
    : snapshot
      ? `This catalog does not publish which terms a course runs in. ${seenOnlyInSnapshot.length} of these courses are confirmed for ${snapshot.label} because they had sections in that crawl. For the other ${offeringUnknown.length} the term is unknown, here and in every other term.`
      : `This catalog does not publish which terms a course runs in, and no schedule has been loaded. The term is unknown for all ${offeringUnknown.length} of these courses.`;

  // Parts of term, named but never dated beyond what the section itself says.
  const partsOfTerm: string[] = [];
  if (snapshot) {
    for (const code of placedCodes) {
      const summary = ctx.sections?.get(code);
      if (!summary) continue;
      const named = distinctParts(summary);
      if (named.length < 2) continue;
      partsOfTerm.push(`${code} runs in more than one part of term in the ${summary.termLabel} snapshot: ${named.join(', ')}.`);
    }
    if (partsOfTerm.length > 0) partsOfTerm.push(DEADLINE_DISCLAIMER);
  }

  const totalWeighed = plannedTerms.reduce((sum, t) => sum + t.load.weighed, 0);
  if (placedCodes.length > 0) {
    notes.push(
      totalWeighed === placedCodes.length
        ? `Weighed all ${placedCodes.length} courses against grade history.`
        : `Weighed ${totalWeighed} of ${placedCodes.length} courses against grade history. The other ${placedCodes.length - totalWeighed} have no grade data and count neither way.`,
    );
    if (ctx.gradeFootnote) notes.push(ctx.gradeFootnote);
  }

  /**
   * The fill can seat a course the placement could not: ACCY 405 fell out of
   * the Accountancy chain at the aim and came back as the best elective for
   * the last term. It is on the board, so it is not "not placed", and its
   * requirement is not short of it. Reconciled here, once, against the final
   * board, so the review list and the board never disagree.
   */
  const onBoardNow = new Set(placedCodes);
  for (let i = notPlaced.length - 1; i >= 0; i -= 1) {
    if (onBoardNow.has(normaliseCode(notPlaced[i].code))) notPlaced.splice(i, 1);
  }
  const stillMissing = new Set(notPlaced.map((np) => np.requirementId).filter((id): id is string => Boolean(id)));
  for (let i = unsatisfied.length - 1; i >= 0; i -= 1) {
    const u = unsatisfied[i];
    if (u.reason === 'did-not-fit' && !stillMissing.has(u.requirementId)) unsatisfied.splice(i, 1);
  }

  const plan: PlanState = {
    schemaVersion: 1,
    programId: input.programId ?? '',
    graduationLabel: `${input.horizon.gradSeason} ${input.horizon.gradYear}`,
    completedCourseIds: [...earned].sort().map(courseIdFor),
    exemptCourseIds: [...exempt].sort().map(courseIdFor),
    terms: plannedTerms.map<PlanTerm>((term) => ({
      id: term.id,
      label: term.label,
      year: term.year as PlanTerm['year'],
      season: term.season,
      courseIds: term.codes.map(courseIdFor),
    })),
  };

  return {
    plan,
    terms: plannedTerms,
    unsatisfied,
    pools,
    notPlaced,
    addedPrerequisites,
    priorLearning: priorLearningChecks,
    forfeited: [...forfeited].map((held) => ({ held, for: forfeits.find((f) => f.held === held)?.for ?? held })),
    satisfiedByPriorCredit,
    bookedFor: Object.fromEntries([...chosen].map(([code, why]) => [code, why.requirementId])),
    genEdPicks: [...chosen].flatMap(([code, why]) => {
      const req = why.requirementId ? input.requirements.find((r) => r.id === why.requirementId) : undefined;
      return req && req.rule.kind === 'gened' ? [{ code, requirementId: req.id, label: req.label || req.areaLabel, tags: req.rule.genEd }] : [];
    }),
    electives,
    language: null,
    admission: null,
    credits: { planned: plannedCredits, prior: priorCredits, total: totalCredits, degreeTotal, unaccounted },
    offering: { unknown: offeringUnknown, seenOnlyInSnapshot, message: offeringMessage },
    notes,
    partsOfTerm,
  };
}

// ---------------------------------------------------------------------------
// validatePlan
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** The degree and its college, so a registration restriction naming them reads as open. */
  programName?: string;
  programCollege?: string;
  minimumTermCredits?: number;
  maxTermCredits?: number;
  maxHardCourses?: number;
  hardDifficulty?: number | null;
  /** Earned hours each class standing starts at. Defaults to Illinois's. */
  standingHours?: StandingThresholds;
  /**
   * Hours the student walked in with, for the class standing check.
   *
   * Without it a transfer student's own plan reports their senior capstone as
   * out of reach, because the check would count only the terms on the board and
   * none of the 30 hours they arrived with.
   */
  priorCredits?: number;
}

/**
 * The same checks run against a plan the student moved around by hand.
 *
 * This is a superset of rules.getPlanIssues for a school that has parsed
 * prerequisites, so a caller runs one or the other and not both. Issue ids are
 * prefixed so that running both only duplicates rows rather than colliding.
 *
 * Three prerequisite outcomes and they are deliberately different severities.
 * A high-confidence group that is unmet blocks. A low-confidence group prints
 * the catalog sentence and asks the student to check, because the parser could
 * not tell an AND from an OR and pretending otherwise would block a legal plan.
 * A sentence that produced no group at all is shown verbatim and not checked,
 * because "Restricted to Atmospheric Sciences majors" is a real condition that
 * this module has no data to evaluate.
 */
export function validatePlan(
  plan: PlanState,
  given: PlanningContext,
  options?: ValidateOptions,
): PlanIssue[] {
  const ctx = withTitleStanding(given);
  const issues: PlanIssue[] = [];
  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const grades = ctx.grades ?? new Map<string, GradeRow>();
  const baseMatch = ctx.prereqCheck ?? defaultPrereqMatcher;
  const conflicts = buildConflicts(ctx.exclusions);
  /**
   * The same relaxation generatePlan makes, out of the same function.
   *
   * A group whose every course the catalog excludes has no course left that
   * could satisfy it. Printing "ECON 302 needs MATH 221 in an earlier term"
   * over a board holding MATH 220 sends a student after four credits the
   * registrar will not award them.
   */
  const match = exclusionAwareMatcher(baseMatch, conflicts, ctx.prereqs, equivalents, []);
  const published = ctx.offeringPublished ?? new Set<string>();
  const dormant = dormantCheck(ctx);
  const rare = rareCheck(ctx);
  const closedHere = closedToMajorCheck(ctx, options?.programName, options?.programCollege);
  const maxCredits = options?.maxTermCredits ?? 18;
  const maxHard = options?.maxHardCourses ?? DEFAULT_MAX_HARD;
  const hardCut = options?.hardDifficulty === undefined
    ? (ctx.bands?.hardest ?? FALLBACK_HARD_DIFFICULTY)
    : options.hardDifficulty;

  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const codeOf = (courseId: string): string | null => {
    const course = byId.get(courseId);
    return course ? normaliseCode(course.code) : null;
  };

  if (!ctx.prereqs) {
    issues.push({
      id: 'ap-prereqs-unloaded',
      severity: 'info',
      title: 'Prerequisites not checked yet',
      // Silence here would read as "everything passes", which is the one thing
      // it must not read as.
      message: 'Prerequisite data has not loaded, so no course in this plan has been prerequisite checked.',
      termId: plan.terms[0]?.id ?? '',
    });
  }

  const earlier = new Set<string>();
  /**
   * The codes actually on the board, unexpanded. `earlier` and `sameTerm` are
   * widened through cross-listings so a prerequisite written as ECE 374 is met
   * by CS 374, and that widening must not reach the exclusion check: CS 374 is
   * ECE 374's twin and its exclusion, and reading the widened set made every
   * cross-listed course on the board "not count" next to its own other name.
   */
  const present = new Set<string>();
  for (const courseId of plan.completedCourseIds) {
    const code = codeOf(courseId);
    if (!code) continue;
    present.add(code);
    for (const equiv of expandEquivalents(code, equivalents)) earlier.add(equiv);
  }
  // Exempt courses clear a prerequisite without earning hours or counting
  // toward anything: SPAN 201 after two years of high school Spanish stands
  // on an exemption from SPAN 102, and the board must not flag it.
  for (const courseId of plan.exemptCourseIds ?? []) {
    const code = codeOf(courseId);
    if (!code) continue;
    for (const equiv of expandEquivalents(code, equivalents)) earlier.add(equiv);
    earlier.add(code);
  }

  const seenCodes = new Map<string, string>();
  // Where each course on the board sits, so a prerequisite read with low
  // confidence can still be caught standing after the course that names it.
  const termOf = new Map<string, number>();
  plan.terms.forEach((term, index) => {
    for (const courseId of term.courseIds) {
      const code = codeOf(courseId);
      if (!code) continue;
      for (const equiv of expandEquivalents(code, equivalents)) if (!termOf.has(equiv)) termOf.set(equiv, index);
      if (!termOf.has(code)) termOf.set(code, index);
    }
  });
  const standingHours = options?.standingHours ?? DEFAULT_STANDING_HOURS;
  /**
   * Hours banked before the term being checked.
   *
   * Seeded from what the student walked in with, then grown term by term, so
   * the answer to "is this person a senior yet" is the same one the registrar
   * would give at the moment they try to register.
   */
  let hoursBefore = options?.priorCredits ?? 0;
  for (const courseId of plan.completedCourseIds) {
    const code = codeOf(courseId);
    if (code && options?.priorCredits === undefined) {
      hoursBefore += ctx.creditRanges?.get(code)?.min ?? byId.get(courseId)?.credits ?? 0;
    }
  }

  for (const term of plan.terms) {
    const codes: string[] = [];
    const sameTerm = new Set<string>();
    for (const courseId of term.courseIds) {
      const code = codeOf(courseId);
      if (!code) continue;
      codes.push(code);
      present.add(code);
      for (const equiv of expandEquivalents(code, equivalents)) sameTerm.add(equiv);
    }

    const termCredits = planCreditRange(codes, ctx);
    if (termCredits.min > maxCredits) {
      issues.push({
        id: `ap-load-${term.id}`,
        severity: 'warning',
        title: 'Heavy course load',
        message: `${term.label} is ${describeCreditTotal(termCredits)}.`,
        termId: term.id,
      });
    }
    if (options?.minimumTermCredits && termCredits.max < options.minimumTermCredits) {
      issues.push({
        id: `ap-minimum-${term.id}`,
        severity: 'warning',
        title: 'Below your credit target',
        message: `${term.label} is ${describeCreditTotal(termCredits)}, under the ${options.minimumTermCredits} you set.`,
        termId: term.id,
      });
    }
    if (termCredits.variable) {
      issues.push({
        id: `ap-variable-${term.id}`,
        severity: 'info',
        title: 'Credit range in this term',
        message: `${term.label} is ${describeCreditTotal(termCredits)}. Pick a value on each course with a range to see one total.`,
        termId: term.id,
      });
    }
    if (termCredits.unknown > 0) {
      issues.push({
        id: `ap-unknown-credits-${term.id}`,
        severity: 'info',
        title: 'Credit hours not listed',
        message: `${termCredits.unknown} course${termCredits.unknown === 1 ? '' : 's'} in ${term.label} ${termCredits.unknown === 1 ? 'has' : 'have'} no credit hours in the catalog, so ${termCredits.unknown === 1 ? 'it is' : 'they are'} not in the total.`,
        termId: term.id,
      });
    }

    const load = termLoad(codes, grades);
    const weighed = codes.filter((code) => grades.get(code)?.difficulty != null).length;
    const hard = hardCut === null
      ? []
      : codes.filter((code) => {
          const d = grades.get(code)?.difficulty;
          return d !== null && d !== undefined && d >= hardCut;
        });
    if (hard.length > maxHard) {
      issues.push({
        id: `ap-hard-${term.id}`,
        severity: 'warning',
        title: 'Several hard courses together',
        message: `${term.label} has ${hard.length} courses in the hardest band at this school: ${hard.join(', ')}. That is past grades, not a prediction.`,
        termId: term.id,
      });
    }
    if (codes.length > 0 && weighed < codes.length) {
      issues.push({
        id: `ap-weighed-${term.id}`,
        severity: 'info',
        title: 'Some courses could not be weighed',
        message: `Weighed ${weighed} of ${codes.length} courses in ${term.label}${load.avgDifficulty === null ? '' : `, average difficulty ${load.avgDifficulty}`}. The rest have no grade data.`,
        termId: term.id,
      });
    }

    for (const courseId of term.courseIds) {
      const course = byId.get(courseId);
      if (!course) {
        issues.push({
          id: `ap-missing-${term.id}-${courseId}`,
          severity: 'error',
          title: 'Course data missing',
          message: `${courseId} is in the plan but not in the current catalog snapshot.`,
          termId: term.id,
          courseId,
        });
        continue;
      }
      const code = normaliseCode(course.code);

      const previous = seenCodes.get(code);
      if (previous) {
        issues.push({
          id: `ap-duplicate-${term.id}-${courseId}`,
          severity: 'warning',
          title: 'Course appears twice',
          message: `${code} is already in ${previous}.`,
          termId: term.id,
          courseId,
        });
      } else {
        seenCodes.set(code, term.label);
      }

      const spec = ctx.prereqs?.get(code);
      if (spec) {
        const { missing, uncertain, priorLearning } = match(spec, earlier, sameTerm, equivalents);
        for (const group of missing) {
          const escapes = spec.escape !== null;
          issues.push({
            id: `ap-prereq-${term.id}-${courseId}-${group.any.join('-')}`,
            severity: escapes ? 'warning' : 'error',
            title: escapes ? 'Prerequisite short, with a catalog exception' : 'Prerequisite conflict',
            message: escapes
              ? `${code} needs ${group.any.join(' or ')} in an earlier term. The catalog also allows ${spec.escape === 'consent' ? 'consent of the instructor' : spec.escape === 'standing' ? 'class standing instead' : 'consent of the instructor or class standing'}.`
              : `${code} needs ${group.any.join(' or ')} in an earlier term.`,
            termId: term.id,
            courseId,
          });
        }
        for (const group of uncertain) {
          const here = plan.terms.indexOf(term);
          const after = group.priorLearning
            ? undefined
            : group.any.map(normaliseCode).find((need) => need !== code && (termOf.get(need) ?? -1) >= here && !(group.concurrent && termOf.get(need) === here));
          if (after) {
            const at = plan.terms[termOf.get(after) ?? here];
            issues.push({
              id: `ap-prereq-order-${term.id}-${courseId}-${after}`,
              severity: 'warning',
              title: 'Prerequisite later in the plan',
              message: `${code} is in ${term.label}, but ${after}, which its prerequisites name ("${group.source}"), is ${at === term ? 'in the same term' : `in ${at.label}`}. Take ${code} after it.`,
              termId: term.id,
              courseId,
            });
            continue;
          }
          issues.push({
            id: `ap-prereq-check-${term.id}-${courseId}-${group.any.join('-')}`,
            severity: 'warning',
            title: 'Check this one',
            message: `The catalog says: ${group.source} We could not tell whether you need all of those or one of them.`,
            termId: term.id,
            courseId,
          });
        }
        /**
         * The half of a prerequisite that is about the student, not the board.
         *
         * A warning and not an error, the same way a catalog escape is, because
         * the board is not wrong: CS 124 in a first term is legal for anybody
         * who did three years of mathematics at school. Calling it an error
         * sends every student to fix an order that is already fine.
         */
        for (const group of priorLearning ?? []) {
          issues.push({
            id: `ap-priorlearning-${term.id}-${courseId}-${group.any.join('-')}`,
            severity: 'warning',
            title: 'Only you can answer this one',
            message: `${code} takes ${group.priorLearning} or ${group.any.join(' or ')}. Nothing earlier on the board has the course, and no record here says what you did at school.`,
            termId: term.id,
            courseId,
          });
        }
        if (!spec.parsed && spec.text) {
          issues.push({
            id: `ap-prereq-text-${term.id}-${courseId}`,
            severity: 'info',
            title: spec.note
              // The catalog is saying the requirement exists somewhere it did
              // not print. "In the catalog's words" would read as the whole
              // story, and it is not: nobody has checked this course.
              ? 'Prerequisites the catalog does not list here'
              : "Prerequisite, in the catalog's words",
            /**
             * The code, then the sentence. The row used to be the sentence
             * alone: a Computer Science review list carried "An adequate ALEKS
             * placement score ... and either one year of high school calculus
             * or a minimum score of 2 on the AB Calculus AP exam" with nothing
             * saying it belonged to MATH 221. The sentence was right and
             * unreadable, because a student cannot act on a rule without
             * knowing which course it gates.
             */
            message: `${code}: ${spec.text}`,
            termId: term.id,
            courseId,
          });
        }
        /**
         * Class standing, checked against the hours banked before this term.
         *
         * An error rather than a warning because it is a registration rule, not
         * a preference: a student with 40 hours cannot enrol in a course the
         * catalog restricts to seniors, however the plan is arranged.
         */
        if (spec.standing) {
          const needed = standingHours[spec.standing] ?? 0;
          if (hoursBefore < needed) {
            issues.push({
              id: `ap-standing-${term.id}-${courseId}`,
              severity: 'error',
              title: 'Class standing not reached',
              message: `${code} needs ${spec.standing} standing, which is ${needed} earned hours, and this plan has ${Math.round(hoursBefore)} before ${term.label}. The catalog says: ${spec.standingText || spec.text}`,
              termId: term.id,
              courseId,
            });
          }
        }
      }

      if (outOfSeason(course, term.season, published.has(code))) {
        issues.push({
          id: `ap-offering-${term.id}-${courseId}`,
          severity: 'warning',
          title: 'Not offered this term',
          message: `${code} has run only in ${course.offeredIn.join(' and ')} terms over the last ${ctx.offeringTerms?.length ?? 'few'} terms, and this is a ${term.season} term.`,
          termId: term.id,
          courseId,
        });
      }
      /**
       * Every crawled section closed to this student's college or major.
       * A warning, not an error: Illinois lifts many of these restrictions
       * after the early registration window, and the crawl cannot see that.
       */
      if (closedHere(code)) {
        const first = ctx.sections?.get(code)?.restrictions?.[0] ?? '';
        issues.push({
          id: `ap-closed-${term.id}-${courseId}`,
          severity: 'warning',
          title: 'Registration restricted to other students',
          message: `Every ${ctx.sections?.get(code)?.termLabel ?? 'crawled'} section of ${code} is restricted: "${first}" Restrictions like this often lift later in registration, and a required course usually has a way in. Ask the department before counting on it.`,
          termId: term.id,
          courseId,
        });
      }
      const otherCollege = prereqNamesOtherCollege(spec?.text, options?.programCollege);
      if (otherCollege) {
        issues.push({
          id: `ap-college-${term.id}-${courseId}`,
          severity: 'info',
          title: 'Prerequisite names another college',
          message: `${code}'s prerequisite says "${otherCollege}". Check with the department that a student in your college can enrol.`,
          termId: term.id,
          courseId,
        });
      }
      const admission = prereqNeedsAdmission(spec?.text);
      if (admission) {
        issues.push({
          id: `ap-admission-${term.id}-${courseId}`,
          severity: 'info',
          title: 'Needs admission to a program first',
          message: `${code} requires "${admission}". That is a milestone with its own application and deadlines, not a course; make sure it is done before ${term.label}.`,
          termId: term.id,
          courseId,
        });
      }
      if (rare(code)) {
        const when = (ctx.offerings?.get(code) ?? [])[0] ?? '';
        const m = when.match(/^(sp|su|fa|wi)(\d{4})$/);
        const word = m ? `${{ sp: 'Spring', su: 'Summer', fa: 'Fall', wi: 'Winter' }[m[1]]} ${m[2]}` : when;
        issues.push({
          id: `ap-rare-${term.id}-${courseId}`,
          severity: 'info',
          title: 'Ran once in the last eight terms',
          message: `${code} ran only in ${word} across the last ${ctx.offeringTerms?.length ?? 8} terms, so it may not run every year. Check the department's schedule before counting on it in ${term.label}.`,
          termId: term.id,
          courseId,
        });
      }
      if (dormant(code)) {
        issues.push({
          id: `ap-dormant-${term.id}-${courseId}`,
          severity: 'warning',
          title: 'Has not run recently',
          message: `${code} ${offeredLine(ctx, code)?.replace(/\.$/, '') ?? 'has not run in any recent term'}. Check with the department before counting on it.`,
          termId: term.id,
          courseId,
        });
      }

      // The one honest thing a single crawled term can say: this course was not
      // in that term's schedule. It says nothing at all about any other term,
      // so the check only fires when the plan term IS the crawled term.
      const snapshot = ctx.snapshotTerm;
      if (snapshot && snapshot.id === term.id && ctx.sections) {
        const summary = ctx.sections.get(code);
        if (!summary || summary.total === 0) {
          issues.push({
            id: `ap-snapshot-${term.id}-${courseId}`,
            severity: 'warning',
            title: 'Not in the schedule snapshot',
            message: `${code} had no sections in the ${snapshot.label} schedule.`,
            termId: term.id,
            courseId,
          });
        } else {
          const named = distinctParts(summary);
          if (named.length > 1) {
            issues.push({
              id: `ap-parts-${term.id}-${courseId}`,
              severity: 'info',
              title: 'More than one part of term',
              message: `${code} runs in ${named.join(', ')}. ${DEADLINE_DISCLAIMER}`,
              termId: term.id,
              courseId,
            });
          }
        }
      }

      for (const raw of ctx.exclusions?.get(code) ?? []) {
        const other = normaliseCode(raw);
        if (!present.has(other)) continue;
        issues.push({
          id: `ap-exclusion-${term.id}-${courseId}-${courseIdFor(other)}`,
          severity: 'info',
          title: 'These do not both count',
          message: `${code} and ${other} do not both count toward graduation.`,
          termId: term.id,
          courseId,
        });
      }
    }

    for (const code of codes) for (const equiv of expandEquivalents(code, equivalents)) earlier.add(equiv);
    hoursBefore += termCredits.min;
  }

  return issues;
}


/**
 * The residency rule against a finished plan.
 *
 * Every hour on the board is an Illinois hour, so the plan's own total is what
 * counts toward the forty-five, and its 300- and 400-level hours toward the
 * twenty-one. What the student already took at Illinois is added; transfer
 * and exam credit is not, whatever course it became. Illinois states the rule
 * on its transfer-credit page and the sentence names it.
 */
function residencyReport(rule: ResidencyRule, plan: GeneratedPlan, ctx: PlanningContext): ResidencyReport {
  const codes = plan.terms.flatMap((term) => term.codes.map(normaliseCode));
  const plannedHours = planCreditRange(codes, ctx).min;
  const plannedUpper = planCreditRange(codes.filter((code) => courseLevel(code) >= 300), ctx).min;
  const totalOk = rule.heldHours + plannedHours >= rule.hours;
  const upperOk = rule.heldUpper + plannedUpper >= rule.upperLevel;
  const ok = totalOk && upperOk;
  const parts: string[] = [];
  if (!totalOk) parts.push(`${rule.heldHours + plannedHours} of the ${rule.hours} hours that must be taken at Illinois`);
  if (!upperOk) parts.push(`${rule.heldUpper + plannedUpper} of the ${rule.upperLevel} that must be at the 300 level or above`);
  const shortfall = ok
    ? null
    : `Residency: this plan reaches ${parts.join(' and ')}. Transfer and exam credit does not count toward residency, so the degree total is not the whole story; plan the difference in Illinois courses or ask your college office. Source: ${rule.source}`;
  return { ...rule, plannedHours, plannedUpper, ok, shortfall };
}


/**
 * The end of a plan the student did not name, fitted to what they still owe.
 *
 * The default horizon is four years from the start, which is right for a
 * first-year and wrong for a transfer with sixty hours: eight terms padded to
 * the minimum load is a plan of a hundred and twenty hours for a degree that
 * needs sixty more. So when the student has not said when they want to finish
 * and their credit leaves fewer terms of work than the default holds, the plan
 * ends when the work does, at the aim they set per term (fifteen unless they
 * said otherwise), never fewer than two terms. A date the student stated is
 * kept: the date outranks the hours, and the note names the setting.
 */
function fitHorizonToCredit(raw: AutoplanInput, prior: PriorCredit, extraTerms = 0): { horizon: Horizon; note: string | null; shortened: boolean } {
  const horizon = raw.horizon;
  const total = raw.degreeTotal ?? null;
  if (horizon.stated === true || total === null) return { horizon, note: null, shortened: false };
  const byCode = new Map(raw.context.courses.map((c) => [normaliseCode(c.code), c]));
  const held = prior.courseCodes.reduce((sum, code) => sum + (byCode.get(normaliseCode(code))?.credits ?? 0), 0) + prior.unmatchedCredits;
  const remaining = total - held;
  if (remaining <= 0) return { horizon, note: null, shortened: false };
  // Balanced terms by default: the student's own aim when they set one, else fifteen, never the maximum.
  const aim = raw.preferences?.creditsPerTerm?.target ?? 15;
  const needed = Math.max(2, Math.ceil(remaining / Math.max(12, aim))) + extraTerms;
  const seasons: SemesterSeason[] = ['Spring', 'Fall'];
  const ord = (season: SemesterSeason, year: number) => year * 2 + (season === 'Fall' ? 1 : 0);
  const startOrd = ord(horizon.startSeason === 'Summer' ? 'Fall' : horizon.startSeason, horizon.startYear);
  const endOrd = ord(horizon.gradSeason === 'Summer' ? 'Spring' : horizon.gradSeason, horizon.gradYear);
  const defaultTerms = endOrd - startOrd + 1;
  if (needed >= defaultTerms) return { horizon, note: null, shortened: false };
  const lastOrd = startOrd + needed - 1;
  const gradSeason = seasons[lastOrd % 2];
  const gradYear = Math.floor(lastOrd / 2);
  return {
    horizon: { ...horizon, gradSeason, gradYear },
    note: `Your credit leaves about ${remaining} hours of the ${total}, so this plan runs ${needed} terms and ends ${gradSeason} ${gradYear} instead of the usual four years. Say when you want to finish under About you to plan to a date instead.`,
    shortened: true,
  };
}

/** Whether a plan left a requirement or course out because the terms ran out, not because of data. */
function leftForWantOfATerm(plan: GeneratedPlan): boolean {
  return plan.unsatisfied.some((u) => u.reason === 'did-not-fit') || plan.notPlaced.some((n) => n.reason === 'no-room' || n.reason === 'chain-too-long');
}


/**
 * The courses a student holds, one per class.
 *
 * A cross-listed class has several codes (CS 107, IS 107, STAT 107 are one
 * class), and the held set is widened to all of them so a prerequisite
 * written under any name is met. Summing hours over the widened set counted
 * that class three times: a student holding CS 107 was credited twelve hours
 * for four. And two courses the catalog says do not both earn credit are one
 * course's credit, the smaller, since the planner cannot know which one the
 * registrar keeps and must not overstate progress.
 */
export function distinctHeld(
  codes: string[],
  ctx: Pick<PlanningContext, 'courses' | 'equivalents' | 'exclusions'>,
): { codes: string[]; dropped: Array<{ kept: string; dropped: string }> } {
  const credits = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c.credits]));
  const kept: string[] = [];
  const seen = new Set<string>();
  const dropped: Array<{ kept: string; dropped: string }> = [];
  for (const raw of codes) {
    const code = normaliseCode(raw);
    if (seen.has(code)) continue;
    const twins = [code, ...(ctx.equivalents?.get(code) ?? []).map(normaliseCode)];
    for (const twin of twins) seen.add(twin);
    const excluded = (ctx.exclusions?.get(code) ?? []).map(normaliseCode).filter((other) => !twins.includes(other));
    const clash = kept.find((other) => excluded.includes(other));
    if (clash) {
      const keepNew = (credits.get(code) ?? 0) < (credits.get(clash) ?? 0);
      if (keepNew) {
        kept[kept.indexOf(clash)] = code;
        dropped.push({ kept: code, dropped: clash });
      } else {
        dropped.push({ kept: clash, dropped: code });
      }
      continue;
    }
    kept.push(code);
  }
  return { codes: kept, dropped };
}

/** The degree's own subjects and its major subject, as the planner reads them. For the rail. */
export function degreeSubjects(requirements: PlanRequirement[], programName?: string): { subjects: Set<string>; primary: string | null } {
  return degreeSubjectsOf(requirements, programName);
}
