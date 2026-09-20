import type { Course, PlanIssue, PlanState, PlanTerm, SemesterSeason } from './types';
import { termLoad, type GradeRow } from './scheduler';

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
  | { kind: 'hours'; hours: number; genEd: string[] | null; label: string }
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
  | { kind: 'unparsed'; text: string };

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
  bands?: PlanDifficultyBands | null;
  /**
   * Codes whose offering term the catalog actually publishes.
   *
   * Illinois publishes none, so this is empty there and no course is ever
   * refused a term for being "spring only". A school that does publish the
   * term fills this set and Course.offeredIn becomes a hard constraint.
   */
  offeringPublished?: Set<string>;
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
  /** Hours that count toward the degree but map to no course code, which is the normal transfer case. */
  unmatchedCredits: number;
  /**
   * False when the student has told us they transferred but not what they took.
   * The plan still generates, and it carries a note saying it was built without
   * a transcript rather than pretending the starting point is known.
   */
  known: boolean;
}

export interface Horizon {
  startSeason: SemesterSeason;
  startYear: number;
  gradSeason: SemesterSeason;
  gradYear: number;
}

export interface PlanPreferences {
  creditsPerTerm?: { min?: number; target?: number; max?: number };
  /** How many of the hardest-band courses may share a term before the engine defers one. */
  maxHardCourses?: number;
  /** Overrides the band cut. Null turns the difficulty guard off entirely. */
  hardDifficulty?: number | null;
  /**
   * How a "choose one of these forty" group gets filled.
   * 'lightest' orders by grade history, which is a statement about the past and
   * is labelled as one wherever it is shown.
   */
  electivePolicy?: 'lightest' | 'catalog-order';
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
    | 'constraint-unmet';
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
  /** Requirements already met by credit the student walked in with. */
  satisfiedByPriorCredit: Array<{ requirementId: string; label: string; codes: string[] }>;
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

const DEFAULT_CREDITS = { min: 12, target: 15, max: 18 };
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
          if (branch.depth !== Infinity) cheapest = Math.min(cheapest, branch.depth + 1);
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
): Map<string, number> {
  const dependents = new Map<string, string[]>();
  for (const code of selected) {
    for (const group of orderingGroups(prereqs?.get(code))) {
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
      tallest = Math.max(tallest, walk(child) + 1);
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
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
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
  /** Pools only: the named lists inside the pool, and the rules over them. */
  lists?: PlanPoolList[];
  constraints?: PlanPoolConstraint[];
  /** Pools only: the catalog sentence, so the report can quote it. */
  note?: string;
  url: string;
}

function slotsFor(requirement: PlanRequirement, ctx: PlanningContext): PlanSlot[] {
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
      .filter((course) => course.tags.some((tag) => wanted.has(tag)))
      .map((course) => normaliseCode(course.code))
      .sort();
    return [{
      ...base,
      key: `${requirement.id}#gened`,
      kind: 'gened' as const,
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
    const eligible = ctx.courses
      .filter((course) => course.tags.some((tag) => wanted.has(tag)))
      .map((course) => normaliseCode(course.code))
      .sort();
    return [{
      ...base,
      key: `${requirement.id}#hours`,
      kind: 'hours' as const,
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
  policy: 'lightest' | 'catalog-order',
): Ranker {
  return (code: string) => {
    const course = byCode.get(code);
    // A course that is not in the catalog snapshot has no credits and no
    // prerequisites, so putting it in a plan would be asserting something we
    // cannot back. It sorts last and is reported if it is all that is left.
    const inCatalog = course ? 0 : 1;
    // A shallow prerequisite chain comes before any preference, because chain
    // length decides whether the plan is possible and difficulty only decides
    // whether it is pleasant. Picking CS 211, which sits behind CS 225, over
    // CS 210, which sits behind nothing, buys a slightly easier course and
    // costs two terms of ordering.
    const chain = depth.get(code) ?? 0;
    if (policy === 'catalog-order') return [inCatalog, chain];

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
  /** "Credit is not given for both X and Y", by code. */
  excludes: (code: string) => string[];
}

interface PoolFill {
  picked: string[];
  free: string[];
  alternatives: string[];
  /** Rows the page lists, and how many of them this catalog snapshot has. */
  listed: number;
  available: number;
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

  const picked: string[] = [];
  const held = new Set<string>(free);
  const remaining = new Set(candidates);

  const blocked = (code: string): boolean =>
    pool.excludes(code).some((other) => held.has(other));

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
    alternatives: openBy(pool.order),
    listed: slot.options.length,
    available,
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

function buildHorizon(horizon: Horizon): Array<{ id: string; label: string; season: SemesterSeason; calendarYear: number; index: number }> {
  const out: Array<{ id: string; label: string; season: SemesterSeason; calendarYear: number; index: number }> = [];
  let season = horizon.startSeason;
  let year = horizon.startYear;
  // A guard rather than a limit anybody should hit: eight years of terms is far
  // past any real plan, and an unbounded loop on a bad graduation date would hang
  // the browser instead of showing an error.
  for (let index = 0; index < 32; index += 1) {
    out.push({ id: termIdFor(season, year), label: `${season} ${year}`, season, calendarYear: year, index });
    if (season === horizon.gradSeason && year === horizon.gradYear) return out;
    if (season === 'Fall') {
      season = 'Spring';
      year += 1;
    } else {
      season = 'Fall';
    }
  }
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

export function generatePlan(input: AutoplanInput): GeneratedPlan {
  const ctx = input.context;
  const prefs = input.preferences ?? {};
  const credits = { ...DEFAULT_CREDITS, ...prefs.creditsPerTerm };
  const maxHard = prefs.maxHardCourses ?? DEFAULT_MAX_HARD;
  const hardCut = prefs.hardDifficulty === undefined
    ? (ctx.bands?.hardest ?? FALLBACK_HARD_DIFFICULTY)
    : prefs.hardDifficulty;
  const policy = prefs.electivePolicy ?? 'lightest';

  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const grades = ctx.grades ?? new Map<string, GradeRow>();
  const match = ctx.prereqCheck ?? defaultPrereqMatcher;
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));

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
  if (exempt.size > 0) {
    notes.push(`${exempt.size} course${exempt.size === 1 ? '' : 's'} you are exempt from still ${exempt.size === 1 ? 'leaves its' : 'leave their'} requirement open. Exemption lets you skip ahead, it does not earn the hours.`);
  }
  if (!ctx.prereqs) {
    notes.push('Prerequisites have not loaded, so nothing in this plan is prerequisite checked.');
  }

  // --- pick the courses ----------------------------------------------------
  const allCodes = new Set<string>();
  for (const requirement of input.requirements) {
    for (const slot of slotsFor(requirement, ctx)) {
      for (const option of slot.options) for (const code of option) allCodes.add(code);
    }
  }
  for (const code of satisfiedForPrereq) allCodes.add(code);
  const { depth: rankDepth } = buildDepths(allCodes, ctx.prereqs, satisfiedForPrereq, equivalents);
  const rank = makeRanker(ctx, byCode, rankDepth, policy);

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
  const satisfiedByPriorCredit: GeneratedPlan['satisfiedByPriorCredit'] = [];
  let droppedRowsWithoutCatalog = 0;
  let sharedListings = 0;

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
  const priorCreditTotal =
    [...earned].reduce((sum, code) => sum + (byCode.get(code)?.credits ?? 0), 0) +
    input.prior.unmatchedCredits;

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
      const variable = ctx.creditRanges?.get(code)?.variable ? 1 : 0;
      return [base[0], unverifiable, extra, variable, ...base.slice(1)];
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
  const orderedRequirements = [
    ...input.requirements.filter((r) => r.rule.kind !== 'gened'),
    ...input.requirements.filter((r) => r.rule.kind === 'gened'),
  ];

  for (const requirement of orderedRequirements) {
    if (requirement.rule.kind === 'unparsed') {
      unsatisfied.push({
        requirementId: requirement.id,
        areaLabel: requirement.areaLabel,
        label: requirement.label || requirement.areaLabel,
        reason: 'not-parsed',
        // The catalog's own words, never a summary of them. A paraphrase of a
        // requirement is the kind of invented fact this project treats as a defect.
        message: `The catalog says: ${requirement.rule.text}`,
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
      unsatisfied.push({
        requirementId: requirement.id,
        areaLabel: requirement.areaLabel,
        label: requirement.label || requirement.areaLabel,
        reason: 'no-course-data',
        message: `${requirement.rule.hours} hours. We cannot tell which courses count.`,
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

    for (const slot of slotsFor(requirement, ctx)) {
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
          excludes: (code) => (ctx.exclusions?.get(code) ?? []).map(normaliseCode),
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
          const pick = best(known);
          if (pick) countIt(pick, 'picked');
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
          const genEdOrder = (a: string, b: string): number => {
            const half = (sequence.has(a) ? 1 : 0) - (sequence.has(b) ? 1 : 0);
            if (half !== 0) return half;
            const ranked = compareRank(rank(a), rank(b), '', '');
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
            if ((ctx.exclusions?.get(code) ?? []).some((other) => held.has(normaliseCode(other)))) {
              continue;
            }
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
        for (const code of ordered) {
          if (have >= slot.hoursTarget) break;
          const course = byCode.get(code);
          if (!course) continue;
          if (earned.has(code)) {
            free.push(code);
            have += course.credits;
            continue;
          }
          picked.push(code);
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

        let filled = 0;
        for (const entry of scored) {
          if (filled >= want) break;
          if (earned.has(entry.code)) {
            free.push(entry.code);
            filled += 1;
            continue;
          }
          if (!byCode.has(entry.code)) {
            droppedRowsWithoutCatalog += 1;
            continue;
          }
          if (entry.shared) {
            sharedListings += 1;
            filled += 1;
            continue;
          }
          picked.push(entry.code);
          filled += 1;
        }

        // options is string[][]: each entry is one requirement slot and the
        // codes inside it are alternatives, so a slot counts as available
        // when any one of its alternatives is in the catalog.
        const known = slot.options.filter((alts) => alts.some((code) => byCode.has(code))).length;
        if (filled < want) {
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
    }
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

        const pick = best(alternatives.filter((alt) => byCode.has(alt)));
        if (!pick) {
          unresolvedPrereqs.push({ code, needs: group.any.join(' or ') });
          continue;
        }
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

  // --- can the chains fit at all? -----------------------------------------
  const selected = [...chosen.keys()].sort();
  const { depth, cycles } = buildDepths(selected, ctx.prereqs, satisfiedForPrereq, equivalents);
  const height = buildHeights(selected, ctx.prereqs, equivalents);
  if (cycles.length > 0) {
    notes.push(`The catalog prerequisites loop on ${cycles.slice(0, 3).join(', ')}${cycles.length > 3 ? ` and ${cycles.length - 3} more` : ''}. The plan broke the loop to keep going, so check those by hand.`);
  }

  const remaining = new Set<string>();
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
    remaining.add(code);
  }

  // --- place them ----------------------------------------------------------
  const placed = new Map<string, string[]>();
  const termNotes = new Map<string, string[]>();
  const earlier = new Set<string>(satisfiedForPrereq);
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
  let hoursBefore = priorCreditTotal;

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
  const placementOrder = (a: string, b: string): number => {
    const heightDiff = (height.get(b) ?? 0) - (height.get(a) ?? 0);
    if (heightDiff !== 0) return heightDiff;
    const depthDiff = (depth.get(a) ?? 0) - (depth.get(b) ?? 0);
    if (depthDiff !== 0) return depthDiff;
    const levelDiff = courseLevel(a) - courseLevel(b);
    if (levelDiff !== 0) return levelDiff;
    return compareRank(rank(a), rank(b), a, b);
  };

  for (const term of terms) {
    const here: string[] = [];
    const sameTerm = new Set<string>();
    const noteList: string[] = [];
    const isLastTerm = term.index === terms.length - 1;
    let hardHere = 0;

    const admit = (code: string) => {
      here.push(code);
      for (const equiv of expandEquivalents(code, equivalents)) sameTerm.add(equiv);
      sameTerm.add(code);
      remaining.delete(code);
      if (isHard(code)) hardHere += 1;
    };

    const roomFor = (codes: string[]): boolean => {
      const running = planCreditRange(here, ctx).min;
      const adds = codes.reduce((sum, code) => sum + creditsOf(code), 0);
      return running + adds <= credits.max;
    };

    const allowedHere = (code: string): boolean => {
      const course = byCode.get(code);
      if (!course) return false;
      if ((depth.get(code) ?? 0) > term.index) return false;
      // Offering is a hard constraint only where the catalog actually
      // publishes a term. Illinois publishes none, and refusing a course a
      // spring slot on the strength of one crawled fall would be inventing
      // the very fact the data does not have.
      if (published.has(code) && course.offeredIn.length && !course.offeredIn.includes(term.season)) return false;
      /**
       * Class standing, unlike the hardest-band guard below, is never relaxed.
       *
       * It is a registration rule the university enforces, not a preference:
       * a student with 40 hours cannot register for a course that requires
       * senior standing, whatever the plan says. A course that never clears it
       * is reported in notPlaced with the catalog's own sentence rather than
       * being quietly squeezed into the last term.
       */
      if (!standingMet(code, hoursBefore)) return false;
      // The hardest-band guard is relaxed in the final term rather than
      // dropping the course, because a course that never gets placed costs
      // a student a semester and a heavy last term costs them a hard spring.
      if (!isLastTerm && isHard(code) && hardHere >= maxHard) return false;
      return true;
    };

    // Fixed point rather than one pass: a course whose prerequisite is allowed
    // concurrently only becomes eligible once that prerequisite is in this term,
    // and the prerequisite may be chosen after it in rank order.
    for (let round = 0; round < remaining.size + 1; round += 1) {
      if (planCreditRange(here, ctx).min >= credits.max) break;

      const eligible: string[] = [];
      for (const code of remaining) {
        if (!allowedHere(code)) continue;
        if (!roomFor([code])) continue;
        const { missing } = match(ctx.prereqs?.get(code), earlier, sameTerm, equivalents);
        if (missing.length > 0) continue;
        eligible.push(code);
      }

      if (eligible.length > 0) {
        eligible.sort(placementOrder);
        admit(eligible[0]);
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
    notPlaced.push({
      code,
      title: byCode.get(code)?.title ?? code,
      reason: missing.length > 0 && !concurrentOnly ? 'prereq-unmet' : 'no-room',
      message: concurrentOnly
        ? `${code} has to be taken alongside ${missing.map((g) => g.any.join(' or ')).join(' and ')}, and no term had room for them together.`
        : missing.length > 0
          ? `${code} still needs ${missing.map((g) => g.any.join(' or ')).join(', and ')}.${escape}`
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
    const held = [...fill.free, ...picked];
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
      unsatisfied.push({
        requirementId: pool.requirementId,
        areaLabel: pool.areaLabel,
        label: pool.label,
        reason: 'hours-short',
        message: `${wanted} from this list, ${got} in the plan. ${pool.available} of the ${pool.listed} listed courses are in the catalog snapshot.`,
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

  const plan: PlanState = {
    schemaVersion: 1,
    programId: input.programId ?? '',
    graduationLabel: `${input.horizon.gradSeason} ${input.horizon.gradYear}`,
    completedCourseIds: [...earned].sort().map(courseIdFor),
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
    satisfiedByPriorCredit,
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
  ctx: PlanningContext,
  options?: ValidateOptions,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const grades = ctx.grades ?? new Map<string, GradeRow>();
  const match = ctx.prereqCheck ?? defaultPrereqMatcher;
  const published = ctx.offeringPublished ?? new Set<string>();
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
  for (const courseId of plan.completedCourseIds) {
    const code = codeOf(courseId);
    if (!code) continue;
    for (const equiv of expandEquivalents(code, equivalents)) earlier.add(equiv);
  }

  const seenCodes = new Map<string, string>();
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
            message: spec.text,
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

      if (published.has(code) && course.offeredIn.length && !course.offeredIn.includes(term.season)) {
        issues.push({
          id: `ap-offering-${term.id}-${courseId}`,
          severity: 'warning',
          title: 'Not offered this term',
          message: `${code} is not listed for ${term.season}.`,
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
        if (!seenCodes.has(other) && !earlier.has(other) && !sameTerm.has(other)) continue;
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
