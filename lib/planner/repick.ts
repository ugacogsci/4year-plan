/**
 * Re-choosing the planner's own picks under new priorities, without breaking
 * the board.
 *
 * The workspace's Re-pick button and ALMA's set_priorities both land here. It
 * used to live inside the React component and was checked one card at a
 * time, and the audit of 2026-09-24 measured what that cost:
 *
 *   - Aaliyah, a Kinesiology student going to physical therapy school, lost
 *     every course her career track had booked (MCB 150, PHYS 101, IB 150 and
 *     nine more) to HK electives, because the board read them as ordinary
 *     elective slots.
 *   - Marcus's Finance board lost MATH 220 to BADM 351 and ECON 103 to CI 210,
 *     leaving MATH 231 and ACCY 201 without their prerequisites, because only
 *     the swapped-in course was checked, never the courses after it.
 *   - Emma's Psychology plan went from 15 credits a term to a 20-credit spring
 *     and 140 credits in all: one-credit fillers and labs were swapped for
 *     three- and four-credit courses with no look at the term's total.
 *   - LAS 102, "for first-term LAS transfer students only", was swapped in for
 *     a freshman, and CS 470, which runs only in the fall, into a spring.
 *   - A second press of the button with nothing changed moved a dozen courses
 *     again, and one press reported 25 swaps where 15 courses had changed.
 *
 * So every swap here is judged against the whole board as it stood before the
 * re-pick, a course booked for a career track is never swapped out, each
 * slot moves at most once, and nothing that was on the board when the call
 * started is ever a candidate. The component only commits the result.
 */
import {
  admissionGate,
  audienceOf,
  closedToMajorCheck,
  degreeSubjects,
  electiveOptions,
  interestProfileOf,
  normaliseCode,
  planCreditRange,
  prereqNamesOtherCollege,
  prereqNeedsAdmission,
  prereqNeedsApplication,
  qualityScorer,
  restrictionClosesTo,
  validatePlan,
  type Arrival,
  type LanguagePlan,
  type PlanningContext,
  type PlanRequirement,
  type PoolReport,
  type PriorCredit,
} from './autoplan';
import { normalizePriorities, type Priorities } from './priorities';
import type { QualityResult } from './quality';
import type { Course, PlanIssue, PlanState, PlanTerm } from './types';

// ---------------------------------------------------------------------------
// What each card on the board is
// ---------------------------------------------------------------------------

/**
 * Why a card is on the board, when the planner put it there.
 *
 * A pool pick reads "from a list"; a filler the plan chose reads "elective";
 * a language sequence card reads "language"; the planner's pick for a general
 * education category reads "gen ed"; a course booked only because a later
 * course needs it reads "prerequisite"; a course the student's career track
 * asks for reads "track" and carries the track's name.
 */
export type PlanMarkKind = 'pool' | 'elective' | 'language' | 'gened' | 'prerequisite' | 'track';

export interface PlanMark {
  label: string;
  detail: string;
  kind?: PlanMarkKind;
  /** The career track a 'track' card is booked for: "Pre-physical therapy (DPT)". */
  track?: string;
}

/** The parts of a generated report that say which cards are the planner's own. */
export interface PlanPicks {
  /** The pools as counted off the board now, not as generated. */
  pools: PoolReport[];
  language: LanguagePlan | null;
  electives: Array<{ code: string; why: string; track?: string }>;
  genEdPicks: Array<{ code: string; label: string }>;
  addedPrerequisites: Array<{ code: string; requiredBy: string }>;
}

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

/**
 * Which pool, slot, sequence, category or track each planned course is
 * there for, keyed by course id. The board's chips, ALMA's roles and the
 * re-pick all read this one map.
 */
export function planMarks(picks: PlanPicks, byCode: Map<string, Course>): Map<string, PlanMark> {
  const map = new Map<string, PlanMark>();
  const find = (code: string) => byCode.get(normaliseCode(code));
  for (const pool of picks.pools) {
    // Written with the number each half carries. Hardcoding "courses" made
    // every one-course list read "1 courses from this list", and 63 pools
    // across 36 Illinois degrees ask for exactly one.
    const wanted = [
      pool.hoursTarget !== null ? `${pool.hoursTarget} ${plural(pool.hoursTarget, 'hour')}` : null,
      pool.countTarget !== null ? `${pool.countTarget} ${plural(pool.countTarget, 'course')}` : null,
    ].filter(Boolean).join(' and ');
    const detail = wanted
      ? `${wanted} from this list, ${pool.count} chosen.`
      : `${pool.count} chosen from this list. The catalog does not say how many to take.`;
    /**
     * Only as many cards as the list asks for wear its name. Finance's page
     * names 82 of its 124 credits, so the fill reaches the total with more
     * 400-level FIN courses, and every one of them sat in the same list;
     * the board then read as seven courses "from a list" that needs four,
     * and the bot called three of them padding. The first ones in term
     * order fill the list. The rest are what they are: the planner's
     * electives toward the total, free to swap.
     */
    const want = pool.countTarget ?? (pool.hoursTarget !== null ? Math.ceil(pool.hoursTarget / 3) : null);
    let counted = 0;
    for (const code of pool.picked) {
      const course = find(code);
      if (!course) continue;
      if (want !== null && counted >= want) {
        map.set(course.id, {
          label: 'Elective',
          detail: `Counts toward the degree total. The list ${pool.label} already has its ${want} from earlier terms.`,
          kind: 'elective',
        });
        continue;
      }
      map.set(course.id, { label: pool.label, detail, kind: 'pool' });
      counted += 1;
    }
  }
  // The language sequence: required, but the language is the student's to pick.
  if (picks.language) {
    const lang = picks.language;
    lang.codes.forEach((code, i) => {
      const course = find(code);
      if (!course) return;
      map.set(course.id, {
        label: 'Language',
        detail: `Semester ${lang.completed + i + 1} of ${lang.semesters} of ${lang.name}, for the language requirement. ${lang.why}`,
        kind: 'language',
      });
    });
  }
  /**
   * The plan's own fillers, so a student can tell a suggestion from a rule.
   * A filler booked for a career track is a track card, not a free slot:
   * Aaliyah's MCB 150 read "elective slot", and a re-pick for easier classes
   * replaced it with HK 264. A track course a list also counts keeps the
   * list's mark; the re-pick leaves it alone either way.
   */
  for (const pick of picks.electives) {
    const course = find(pick.code);
    if (!course) continue;
    const mark = map.get(course.id);
    const own: PlanMark = pick.track
      ? { label: pick.track, detail: pick.why, kind: 'track', track: pick.track }
      : { label: 'Elective', detail: pick.why, kind: 'elective' };
    if (!mark) map.set(course.id, own);
    else if (mark.kind === 'elective' && mark.label === 'Elective') map.set(course.id, pick.track ? own : { ...mark, detail: pick.why });
  }
  /**
   * The planner's gen-ed picks and the prerequisites it booked. Both are its
   * own choices, and unmarked they read on the board, and to ALMA, as
   * courses "the student put there": RHET 105 on every first-year board, and
   * MATH 112 booked for a Finance student's calculus.
   */
  for (const pick of picks.genEdPicks) {
    const course = find(pick.code);
    if (!course || map.has(course.id)) continue;
    map.set(course.id, {
      label: pick.label,
      detail: `The planner's pick for ${pick.label}. Any course that carries the same categories can take its place.`,
      kind: 'gened',
    });
  }
  for (const added of picks.addedPrerequisites) {
    const course = find(added.code);
    if (!course || map.has(course.id)) continue;
    map.set(course.id, {
      label: 'Prerequisite',
      detail: `The degree page does not list it; the catalog requires it before ${added.requiredBy}.`,
      kind: 'prerequisite',
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Courses that are for somebody else
// ---------------------------------------------------------------------------

/**
 * Words in a prerequisite sentence that name a group a student belongs to or
 * does not: "first-term LAS transfer students", "the Finance Academy", "James
 * Scholars", "Living Learning Communities". The board cannot show a student
 * is in any of them, so a re-pick never books such a course on its own; the
 * student can still choose it by hand.
 */
const GROUP_WORDS = /\b(transfer|international|first[- ]term|james scholars?|honors|academy|scholars|cohort|living[- ]learning|learning communit(?:y|ies)|members?|participants?|athletes?|veterans?|minors?)\b/i;
const RESTRICTION_CUE = /\b(only|restricted to|limited to|open to|reserved for|must be (?:enrolled|admitted|accepted|a member))\b/i;

/**
 * Why a course is for somebody other than this student, from its own words,
 * or null.
 *
 * The elective fill keeps these out of its picks by rank (an unreadable
 * prerequisite costs a course four points, every section closed to the major
 * seven) and by the title check for "non-majors"; a re-pick ranks by the
 * student's priorities alone, and "best teaching" put LAS 102 ("For
 * first-term LAS transfer students only") in a freshman's first spring and
 * FIN 390 ("Induction into the Finance Academy") on a Finance board. So here
 * the same signals refuse outright: the catalog's registration restrictions
 * for this program, a prerequisite sentence naming another college, an
 * admission, an application ("Admission by application only", FIN 391
 * Investment Banking Academy) or someone's approval (admissionGate, the rule
 * the fill books by), or a group the student has to belong to, a first-year
 * course for a transfer student, and titles that say the course is an
 * honors section, an orientation, or for other majors.
 */
export function restrictedToOthers(
  course: Course,
  ctx: PlanningContext,
  who: { programName?: string; programCollege?: string; primary?: string | null; arrival?: Arrival },
): string | null {
  const code = normaliseCode(course.code);
  const title = course.title;
  if (/\bhonors\b/i.test(title)) return `${code} is an honors course`;
  if (/\borientation\b/i.test(title)) return `${code} is an orientation course for its own college or program`;
  if (/\bfor\b[^,]*\b(international|transfer)\s+students\b/i.test(title)) return `${code} is for ${/international/i.test(title) ? 'international' : 'transfer'} students`;
  // "Sports Media for Majors" is for Media majors; a Music major keeps "First-year Seminar for Music Majors".
  if (/\bfor\s+(?!non-)[\w\s&+]*\bmajors\b/i.test(title) && restrictionClosesTo(`restricted to ${title}`, who.programName, who.programCollege)) {
    return `${code} is for majors in its own department`;
  }
  if (closedToMajorCheck(ctx, who.programName, who.programCollege)(code)) return `every section of ${code} is restricted to other students`;
  // FIN 391 to 395 ("Admission by application only.", "Instructor approval
  // required.") went onto every Finance board as electives; the fill no longer
  // books them, and a re-pick does not either.
  const gate = admissionGate(code, ctx, who.primary);
  if (gate) return `${code} is taken by application or with approval: "${gate}"`;
  // "Restricted to first-year students in LAS." (LAS 101) is not for a
  // transfer student, whose row takes LAS 102.
  if (who.arrival?.transfer && audienceOf(course, ctx) === 'first-year') return `${code} is for first-year students`;
  const text = ctx.prereqs?.get(code)?.text ?? '';
  if (!text) return null;
  const college = prereqNamesOtherCollege(text, who.programCollege);
  // "Restricted to non-dance majors" names a college word and shuts out only
  // its own majors; the sentence loop below reads it.
  if (college && !/\bnon-/i.test(college)) return `${code}: "${college}"`;
  const admission = prereqNeedsAdmission(text);
  if (admission) return `${code} needs ${admission}`;
  const application = prereqNeedsApplication(text);
  if (application) return `${code}: "${application}"`;
  for (const sentence of text.split(/(?<=[.;])\s+/)) {
    const why = `${code}: "${sentence.trim()}"`;
    if (/\binduction into\b/i.test(sentence)) return why;
    if (!RESTRICTION_CUE.test(sentence)) continue;
    if (GROUP_WORDS.test(sentence)) return why;
    // Punctuation off, so "first-year students in LAS." still finds the
    // student's own college ("las ").
    const plain = `${sentence.replace(/[.,;:()]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    // "Restricted to Junior, Senior or Graduate students" is a standing rule,
    // which the validator checks against the board's own hours.
    if (/\b(freshm[ae]n|sophomores?|juniors?|seniors?|first-year|standing)\b/i.test(plain) && !/\b(majors?|college|school of|program|department|concentration|curriculum|students in|enrolled)\b/i.test(plain)) continue;
    // "Restricted to non-dance majors" shuts out dance majors, nobody else.
    const non = plain.match(/\bnon-?\s?([a-z]+)\s+majors?\b/i);
    if (non) {
      if ((who.programName ?? '').toLowerCase().includes(non[1].toLowerCase())) return why;
      continue;
    }
    if (restrictionClosesTo(/restricted to/i.test(plain) ? plain : `restricted to ${plain}`, who.programName, who.programCollege)) return why;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Judging a swap against the whole board
// ---------------------------------------------------------------------------

/**
 * A validator row that makes a board wrong rather than worth a look: a
 * prerequisite the board does not meet (not the "check this one" rows the
 * parser could not read), a class standing not reached, two courses that do
 * not both count, a course twice.
 */
export function isBlockingIssue(issue: PlanIssue): boolean {
  if (issue.id.startsWith('ap-exclusion-')) return true;
  return /^ap-(prereq-(?!check)|standing-|duplicate-)/.test(issue.id) && issue.severity !== 'info';
}

/**
 * What a re-pick may not add anywhere: the blocking rows, and a "check this
 * one" row that was not there before. The second is a prerequisite the parser
 * read with low confidence that the board used to meet: MCB 354 ("CHEM 232 or
 * CHEM 236, and MCB 250 and MCB 252") went into a pre-med sophomore's fall
 * with none of them before it, and taking out the elective that met MCB
 * 301's left it asking the student to check. The fill refuses both for its
 * own electives (electivePrereqsMet); a swap the student did not ask for
 * should not do either.
 */
function breaksTheBoard(issue: PlanIssue): boolean {
  return isBlockingIssue(issue) || issue.id.startsWith('ap-prereq-check-');
}

const TERM_MAX = 18;
/** The engine's summer ceiling (SUMMER_MAX in autoplan.ts). */
const SUMMER_MAX = 9;

type GenEdRule = Extract<PlanRequirement['rule'], { kind: 'gened' }>;

const genEdRules = (requirements: PlanRequirement[]): GenEdRule[] => requirements.flatMap((r) => (r.rule.kind === 'gened' ? [r.rule] : []));

/** Which gen-ed categories a board meets on tags alone: hours and course counts carrying one of its tags. */
function genEdCategoriesMet(b: PlanState, rules: GenEdRule[], ctx: PlanningContext, byId: Map<string, Course>): boolean[] {
  const courses = [...b.terms.flatMap((t) => t.courseIds), ...b.completedCourseIds].map((id) => byId.get(id)).filter((c): c is Course => Boolean(c));
  return rules.map((rule) => {
    const carrying = courses.filter((c) => c.tags.some((t) => rule.genEd.includes(t)));
    const hours = planCreditRange(carrying.map((c) => c.code), ctx).min;
    return (rule.hours === null || hours >= rule.hours) && (rule.courses === null || carrying.length >= rule.courses) && carrying.length > 0;
  });
}

export interface BoardCheckInput {
  context: PlanningContext;
  /** The board as it stood before any swap: what counts as "already wrong". */
  board: PlanState;
  requirements: PlanRequirement[];
  minimumTermCredits: number;
  /** Hours held before the plan starts, as the validator counts standing. */
  priorCredits: number;
  /** The published total. The plan never falls below it through a swap. */
  degreeTotal: number | null;
  programName?: string;
  programCollege?: string;
  /** Who the student is (arrivalFromWords): a transfer student is never re-picked into a first-year course. */
  arrival?: Arrival;
}

/**
 * One swap's verdict: null when it may go on the board, or the reason it may
 * not. `from` is the board just before this swap, `next` the board with it.
 */
export type SwapCheck = (next: PlanState, from: PlanState, termId: string, add: Course, removed: Course | null) => string | null;

export function boardChecker(input: BoardCheckInput): SwapCheck {
  const ctx = input.context;
  const options = {
    minimumTermCredits: input.minimumTermCredits,
    maxTermCredits: TERM_MAX,
    programName: input.programName,
    programCollege: input.programCollege,
    priorCredits: input.priorCredits,
  };
  const baseline = new Set(validatePlan(input.board, ctx, options).filter(breaksTheBoard).map((i) => i.id));
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const codesOf = (ids: string[]) => ids.map((id) => byId.get(id)?.code).filter((c): c is string => Boolean(c));
  const termRange = (t: PlanTerm) => planCreditRange(codesOf(t.courseIds), ctx);
  const planned = (b: PlanState) => planCreditRange(codesOf(b.terms.flatMap((t) => t.courseIds)), ctx).min;
  const cr = (c: Course) => planCreditRange([c.code], ctx).min;
  const genEdBlocks = genEdRules(input.requirements);
  const categoriesMet = (b: PlanState): boolean[] => genEdCategoriesMet(b, genEdBlocks, ctx, byId);
  const metBefore = categoriesMet(input.board);
  const who = { ...input, primary: degreeSubjects(input.requirements, input.programName).primary };
  return (next, from, termId, add, removed) => {
    const term = next.terms.find((t) => t.id === termId);
    const was = from.terms.find((t) => t.id === termId);
    if (!term || !was) return 'That term is not on the board.';
    const now = termRange(term);
    const then = termRange(was);
    const cap = term.season === 'Summer' ? SUMMER_MAX : TERM_MAX;
    // Emma's Spring 2028 went to 20 credits when one-credit fillers and labs
    // gave way to three- and four-credit courses; a term already over the
    // cap may stay where it is but never grows.
    if (now.min > cap && now.min > then.min) return `${term.label} would hold ${now.min} credits, over the ${cap} a ${term.season.toLowerCase()} term allows.`;
    if (term.season !== 'Summer' && now.max < input.minimumTermCredits && !(then.max < input.minimumTermCredits)) {
      return `${term.label} would drop to ${now.max} credits, under the ${input.minimumTermCredits} the student set as a minimum.`;
    }
    if (removed) {
      const out = cr(removed);
      const into = cr(add);
      // The fill tops terms off with one- and two-credit courses. Swapping
      // those for three-credit ones is how 120 credits became 140.
      if (out < 3 && into !== out) return `${removed.code} is a ${out}-credit slot, and only a ${out}-credit course takes its place.`;
      if (input.degreeTotal !== null) {
        const after = planned(next) + input.priorCredits;
        if (after < input.degreeTotal && after < planned(from) + input.priorCredits) return `The plan would fall to ${after} credits, under the ${input.degreeTotal} the degree takes.`;
      }
    }
    const closed = restrictedToOthers(add, ctx, who);
    if (closed) return closed;
    for (const issue of validatePlan(next, ctx, options)) {
      if (breaksTheBoard(issue) && !baseline.has(issue.id)) return issue.message;
      // The course coming in has to run in that term, have run recently, and
      // be open to this student.
      if (issue.courseId === add.id && issue.termId === termId && /^ap-(offering|snapshot|dormant|closed)-/.test(issue.id)) return issue.message;
    }
    // An elective can be part of what meets a category: a re-pick for lighter
    // courses took the Quantitative Reasoning courses on Sofia's Psychology
    // board from eight to two, and Aaliyah's Natural Sciences from seven to
    // three. A swap may thin a category out; it may not open one the board
    // had met, since nothing tells the student it has.
    if (removed && genEdBlocks.length > 0) {
      const metNow = categoriesMet(next);
      const lost = genEdBlocks.find((rule, i) => metBefore[i] && !metNow[i]);
      if (lost) return `Taking out ${removed.code} would leave ${lost.label} unmet.`;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Gen-ed alternatives
// ---------------------------------------------------------------------------

export interface GenEdCandidateInput {
  context: PlanningContext;
  requirements: PlanRequirement[];
  board: PlanState;
  courseId: string;
  scorer: (code: string) => QualityResult;
  /** Course ids never offered: everything on the board when a re-pick began. */
  exclude?: Set<string>;
}

/**
 * Courses that could take a gen-ed pick's place, best first, before any
 * placement check.
 *
 * A replacement has to carry every category of this degree the current pick
 * carries, not only the one it was booked for: PHIL 103 booked for
 * Humanities that also meets Quantitative Reasoning II cannot be swapped for
 * a Humanities course that does not, or the second category opens up
 * silently. A category sized in hours needs at least the pick's hours from
 * it. And neither half of a two-course sequence stands in for a whole
 * course: CMN 111 took RHET 105's place and left Composition I at 3 of 4
 * hours, because CMN 111 and 112 both carry the tag. A second half is a
 * course whose own prerequisite carries the category (CMN 112, RHET 102); a
 * first half is one the next course in its subject, carrying the category,
 * names first (CMN 111 before CMN 112, RHET 101 before RHET 102). Read that
 * narrowly on purpose: "any same-category course names it" would take PSYC
 * 100, SOC 100 and ECON 102 out of every Social Science list.
 */
export function genEdCandidates(input: GenEdCandidateInput): Array<{ course: Course; q: QualityResult; categories: string[][] }> {
  const ctx = input.context;
  const me = ctx.courses.find((c) => c.id === input.courseId);
  if (!me) return [];
  const blocks = input.requirements.flatMap((b) => (b.rule.kind === 'gened' && b.rule.genEd.some((t) => me.tags.includes(t)) ? [b.rule] : []));
  if (blocks.length === 0) return [];
  const mine = blocks.map((rule) => rule.genEd);
  const inCategory = (c: Course | undefined) => Boolean(c && mine.some((tags) => tags.some((t) => c.tags.includes(t))));
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  const names = (later: string, earlier: string) =>
    (ctx.prereqs?.get(later)?.groups ?? []).some((g) => g.any.some((a) => normaliseCode(a) === earlier));
  const secondHalf = (code: string) =>
    (ctx.prereqs?.get(code)?.groups ?? []).some((g) => g.any.some((a) => inCategory(byCode.get(normaliseCode(a)))));
  const firstHalf = (code: string) => {
    const [subject, number] = code.split(' ');
    const n = Number.parseInt(number ?? '', 10);
    if (!Number.isFinite(n)) return false;
    const next = `${subject} ${n + 1}`;
    return inCategory(byCode.get(next)) && names(next, code);
  };
  const credits = (c: Course) => planCreditRange([c.code], ctx).min;
  const hoursFloor = blocks.some((rule) => rule.hours !== null) ? credits(me) : 0;
  // The same class under another code is not an alternative: PHIL 316 was
  // offered in place of its own cross-listing, ECE 316.
  const twins = new Set((ctx.equivalents?.get(normaliseCode(me.code)) ?? []).map(normaliseCode));
  const onBoard = new Set([...input.board.terms.flatMap((t) => t.courseIds), ...input.board.completedCourseIds]);
  return ctx.courses
    .filter((c) => c.id !== me.id && !onBoard.has(c.id) && !input.exclude?.has(c.id) && !twins.has(normaliseCode(c.code)))
    .filter((c) => mine.every((tags) => tags.some((t) => c.tags.includes(t))))
    .filter((c) => credits(c) >= hoursFloor)
    .filter((c) => !secondHalf(normaliseCode(c.code)) && !firstHalf(normaliseCode(c.code)))
    .map((c) => ({ course: c, q: input.scorer(normaliseCode(c.code)), categories: mine }))
    .sort((a, b) => b.q.score - a.q.score || b.q.known - a.q.known || a.course.code.localeCompare(b.course.code));
}

/** Why a gen-ed alternative is offered, in the card's words. */
export function genEdWhy(q: QualityResult, categories: string[][]): string {
  return q.reasons.length > 0 ? q.reasons.slice(0, 2).join('; ') : `Also carries ${categories.map((tags) => tags[0]).join(' and ')}.`;
}

/** Whether a gen-ed pick is the one for Composition I, which a re-pick never touches. */
function compositionOne(course: Course, mark: PlanMark): boolean {
  return course.tags.some((t) => /^composition i$/i.test(t)) || /\bcomposition i\b/i.test(mark.label);
}

// ---------------------------------------------------------------------------
// When a gen-ed swap is worth making
// ---------------------------------------------------------------------------

type Measure = 'workload' | 'teaching' | 'relevance' | 'coverage' | 'schedule';
const MEASURES: Measure[] = ['workload', 'teaching', 'relevance', 'coverage', 'schedule'];

/** The measures the student weighted most, which is what they asked for; none when every one is off. */
function ledMeasures(p: Priorities): Measure[] {
  const top = Math.max(...MEASURES.map((m) => p[m]));
  return top > 0 ? MEASURES.filter((m) => p[m] === top) : [];
}

/**
 * How far workload and teaching have to move, each on the scorer's own 0-to-1
 * scale, before a gen-ed swap is worth making. The workload scale ends at 1.2
 * times the hardest band (39 on Illinois's grade history), so 0.1 is about
 * five points of difficulty; teaching's 0.2 is about one more recent term on
 * the excellent list.
 */
const WORKLOAD_MARGIN = 0.1;
const TEACHING_MARGIN = 0.2;

export interface GenEdSide {
  course: Course;
  /** The re-pick's blended score, for the topic hit and the schedule clash. */
  q: QualityResult;
}

/**
 * Whether a gen-ed alternative is clearly better than the pick on what the
 * student asked for, and no worse on anything else they asked for.
 *
 * A gen-ed pick is not the student's to judge from a list the way an
 * elective is, and the blended score moves on things they did not ask about.
 * A Finance student who asked for the lightest, most relevant courses had
 * FSHN 120 Contemporary Nutrition (difficulty 10) swapped for FSHN 101 (13):
 * heavier, no closer to investment banking, and ahead only because the
 * scorer counted Physical Sciences as still wanted in a category Life
 * Sciences had already met. So, for each measure the student weighted most:
 *
 *   workload   lighter by WORKLOAD_MARGIN on the grade-history scale
 *   teaching   better by TEACHING_MARGIN on the excellent-list scale
 *   relevance  a hit on the student's goal (course, title or subject) the
 *              pick lacks
 *   coverage   a tag of a gen-ed category the board has not met, which the
 *              pick does not carry
 *   schedule   fits the hours or format the student gave where the pick
 *              does not
 *
 * One of them has to be a gain and none a loss by the same test.
 */
export function genEdSwapEarned(
  priorities: Priorities,
  from: GenEdSide,
  to: GenEdSide,
  measure: (m: 'workload' | 'teaching', code: string) => QualityResult,
  unmetTags: Set<string>,
): boolean {
  let gained = false;
  for (const m of ledMeasures(priorities)) {
    let gain = 0;
    if (m === 'workload' || m === 'teaching') {
      const margin = m === 'workload' ? WORKLOAD_MARGIN : TEACHING_MARGIN;
      const was = measure(m, normaliseCode(from.course.code)).score;
      const now = measure(m, normaliseCode(to.course.code)).score;
      gain = now >= was + margin ? 1 : now <= was - margin ? -1 : 0;
    } else {
      const has = (side: GenEdSide): boolean =>
        m === 'relevance'
          ? (side.q.interest ?? 0) > 0
          : m === 'coverage'
            ? side.course.tags.some((t) => unmetTags.has(t))
            : (side.q.conflicts?.length ?? 0) === 0;
      gain = has(to) && !has(from) ? 1 : has(from) && !has(to) ? -1 : 0;
    }
    if (gain < 0) return false;
    if (gain > 0) gained = true;
  }
  return gained;
}

// ---------------------------------------------------------------------------
// The re-pick
// ---------------------------------------------------------------------------

/**
 * What a board was last built or re-picked for. A re-pick with the same
 * priorities and the same words is a no-op: pressing Re-pick on a fresh
 * balanced board moved 21 of Emma's courses, because the fill and the re-pick
 * rank a little differently, and a second press moved more.
 */
export function repickSignature(priorities: Priorities, interests: string): string {
  return `${JSON.stringify(normalizePriorities(priorities))}|${interests.replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

export interface RepickInput {
  context: PlanningContext;
  requirements: PlanRequirement[];
  board: PlanState;
  marks: Map<string, PlanMark>;
  /** The pools as counted off the board now. */
  pools: PoolReport[];
  prior: PriorCredit;
  interests: string;
  /**
   * What the student said they want to do, alone. Goals and career tracks are
   * read from it, never from the major's name in the studying answer.
   */
  career?: string;
  programName?: string;
  programCollege?: string;
  priorities: Priorities;
  minimumTermCredits: number;
  priorCredits: number;
  degreeTotal: number | null;
  /** Codes the report books for a career track, whatever mark the card wears. */
  trackPicks?: string[];
  /** repickSignature of the last build or re-pick, when there was one. */
  lastSignature?: string | null;
  /** Who the student is (arrivalFromWords), for courses written for one group. */
  arrival?: Arrival;
}

export interface RepickChange {
  term: string;
  termId: string;
  /** Empty when a course was added beside another (a lab beside its lecture). */
  from: string;
  to: string;
  why: string;
  kind: 'track' | 'elective' | 'pool' | 'gened';
  /** The career track a 'track' change books for. */
  track?: string;
}

export interface RepickResult {
  board: PlanState;
  /** Net changes: each course out was on the board before, each course in was not. */
  changes: RepickChange[];
  signature: string;
  /** True when the board already reflects these priorities and words, so nothing was tried. */
  unchanged: boolean;
}

/** Candidates of the slot's own credit count first, each group in rank order. */
function sameCreditsFirst<T extends { course: Course }>(ranked: T[], slot: Course, credits: (c: Course) => number): T[] {
  const want = credits(slot);
  return [...ranked.filter((r) => credits(r.course) === want), ...ranked.filter((r) => credits(r.course) !== want)];
}

/** At most this many boards validated per card, so a re-pick stays a click, not a wait. */
const TRIES_PER_CARD = 24;

/**
 * Re-choose the planner's own picks under a set of priorities, in one pass.
 *
 * First, a pre-professional goal the student named claims elective slots
 * before any priority does, the way generatePlan gives it first claim: a
 * Psychology transfer student who said "PT school, and easier electives" got
 * twelve lighter psychology and social work picks and no anatomy, chemistry
 * or physics. A lab (two credits or less) goes in beside its lecture when the
 * term has room. Then every elective slot, every gen-ed pick but Composition
 * I, and every from-a-list course the page's sub-rules do not pin takes the
 * best option that clearly beats it and passes the whole-board check,
 * same-credit options first; a gen-ed pick moves only for a course that is
 * better on the measure the student weighted most (genEdSwapEarned). Track
 * cards, the language sequence and booked prerequisites are never touched.
 */
export function repickBoard(input: RepickInput): RepickResult {
  const signature = repickSignature(input.priorities, input.interests);
  if (input.lastSignature === signature) return { board: input.board, changes: [], signature, unchanged: true };
  const ctx = input.context;
  const board = input.board;
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  const codeOf = (id: string) => normaliseCode(byId.get(id)?.code ?? '');
  const credits = (c: Course) => planCreditRange([c.code], ctx).min;
  /** Everything on the board or in hand when the call began: never a candidate. */
  const atStart = new Set([...board.terms.flatMap((t) => t.courseIds), ...board.completedCourseIds]);
  const held = new Set([...board.completedCourseIds.map(codeOf), ...input.prior.courseCodes.map(normaliseCode)]);
  const check = boardChecker({
    context: ctx,
    board,
    requirements: input.requirements,
    minimumTermCredits: input.minimumTermCredits,
    priorCredits: input.priorCredits,
    degreeTotal: input.degreeTotal,
    programName: input.programName,
    programCollege: input.programCollege,
    arrival: input.arrival,
  });
  // One scorer for the whole call, over the board as it was. A scorer rebuilt
  // after each swap moved the gen-ed "still wanted" categories under it, and
  // THEA 110 went to HIST 241 and back again on the next press.
  const scorer = qualityScorer({
    context: ctx,
    requirements: input.requirements,
    interests: input.interests,
    career: input.career,
    programName: input.programName,
    priorities: input.priorities,
    carriedCodes: [...board.terms.flatMap((t) => t.courseIds).map(codeOf), ...held],
  });
  // Workload and teaching alone, for the gen-ed test: the blended score says
  // a course is better, not on which measure.
  const measureScorers = new Map<'workload' | 'teaching', (code: string) => QualityResult>();
  const measure = (m: 'workload' | 'teaching', code: string): QualityResult => {
    let only = measureScorers.get(m);
    if (!only) {
      only = qualityScorer({
        context: ctx,
        requirements: input.requirements,
        interests: input.interests,
        career: input.career,
        programName: input.programName,
        priorities: { ...input.priorities, workload: m === 'workload' ? 1 : 0, teaching: m === 'teaching' ? 1 : 0, relevance: 0, coverage: 0, schedule: 0 },
        carriedCodes: [],
      });
      measureScorers.set(m, only);
    }
    return only(code);
  };
  const genEdBlocks = genEdRules(input.requirements);
  const metAtStart = genEdCategoriesMet(board, genEdBlocks, ctx, byId);
  const unmetTags = new Set(genEdBlocks.filter((_, i) => !metAtStart[i]).flatMap((rule) => rule.genEd));
  let working = board;
  const changes: RepickChange[] = [];
  /** Course ids that do not move again this call: swapped in, or a slot a track course claimed. */
  const settled = new Set<string>();
  const trackIds = new Set<string>();
  for (const code of input.trackPicks ?? []) {
    const course = byCode.get(normaliseCode(code));
    if (course) trackIds.add(course.id);
  }
  for (const [id, mark] of input.marks) if (mark.kind === 'track') trackIds.add(id);
  /**
   * The cards the per-subject cap counts, kept current as swaps land. It
   * used to be read off the marks, which a course swapped in does not have,
   * so a Psychology board's re-pick never counted the PSYC courses it had
   * just put in and could fill every slot with them.
   */
  const counted = new Set<string>();
  for (const id of atStart) if (input.marks.get(id)?.kind === 'elective' || trackIds.has(id)) counted.add(id);
  const cappedCodes = () => working.terms.flatMap((t) => t.courseIds).filter((id) => counted.has(id)).map(codeOf);
  const swapIn = (termId: string, oldId: string, newId: string): PlanState => ({
    ...working,
    terms: working.terms.map((t) => (t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === oldId ? newId : id)) } : t)),
  });
  const holds = (termId: string, id: string) => working.terms.find((t) => t.id === termId)?.courseIds.includes(id) ?? false;
  /** The first candidate, in the order given, whose board passes; null when none does. */
  const firstThatFits = <T extends { course: Course }>(term: PlanTerm, slot: Course, ranked: T[]): { next: PlanState; pick: T } | null => {
    let tries = 0;
    for (const pick of ranked) {
      if (tries >= TRIES_PER_CARD) break;
      tries += 1;
      const next = swapIn(term.id, slot.id, pick.course.id);
      if (check(next, working, term.id, pick.course, slot) === null) return { next, pick };
    }
    return null;
  };

  // --- a named career track first ------------------------------------------
  const trackCodes = new Set<string>();
  for (const track of interestProfileOf(input.career ?? input.interests).tracks) {
    for (const need of track.courses) {
      if (need.need !== 'required') continue;
      const codes = need.codes.map(normaliseCode);
      codes.forEach((code) => trackCodes.add(code));
      const have = new Set([...held, ...working.terms.flatMap((t) => t.courseIds).map(codeOf)]);
      if (codes.some((code) => have.has(code))) continue;
      const course = codes.map((code) => byCode.get(code)).find((c): c is Course => c !== undefined && c.credits > 0);
      if (!course) continue;
      const why = `For ${track.name}: ${need.why}`;
      // The earliest term the course runs in and passes the checks, so a
      // sequence's first half lands before its second.
      for (const term of working.terms) {
        if (term.season === 'Summer' ? !course.offeredIn.includes('Summer') : course.offeringKnown && course.offeredIn.length > 0 && !course.offeredIn.includes(term.season)) continue;
        // A lab goes in beside its lecture when the term has room, so the
        // plan does not lose the hours of the elective it would replace.
        if (course.credits <= 2) {
          const withIt: PlanState = { ...working, terms: working.terms.map((t) => (t.id === term.id ? { ...t, courseIds: [...t.courseIds, course.id] } : t)) };
          if (check(withIt, working, term.id, course, null) === null) {
            working = withIt;
            settled.add(course.id);
            counted.add(course.id);
            changes.push({ term: term.label, termId: term.id, from: '', to: course.code, why, kind: 'track', track: track.name });
            break;
          }
        }
        const slots = term.courseIds
          .filter((id) => input.marks.get(id)?.kind === 'elective' && !settled.has(id) && !trackIds.has(id))
          .map((id) => byId.get(id))
          .filter((c): c is Course => c !== undefined && !trackCodes.has(normaliseCode(c.code)))
          .sort((a, b) => Math.abs(credits(a) - credits(course)) - Math.abs(credits(b) - credits(course)));
        const slot = slots.find((s) => check(swapIn(term.id, s.id, course.id), working, term.id, course, s) === null);
        if (!slot) continue;
        working = swapIn(term.id, slot.id, course.id);
        settled.add(slot.id);
        settled.add(course.id);
        counted.delete(slot.id);
        counted.add(course.id);
        changes.push({ term: term.label, termId: term.id, from: slot.code, to: course.code, why, kind: 'track', track: track.name });
        break;
      }
    }
  }

  // --- one pass over the planner's own picks --------------------------------
  // Over the board as it was when the call began, so a course swapped in is
  // never looked at again: Sofia's Spring 2029 chain of five swaps (PSYC 339
  // to PSYC 420, HDFS 330 to PSYC 339, ...) was one course out and one in.
  for (const term of board.terms) {
    for (const courseId of term.courseIds) {
      if (settled.has(courseId) || trackIds.has(courseId)) continue;
      const mark = input.marks.get(courseId);
      // The language course meets the language requirement, a booked
      // prerequisite is there for a later course, and a track course is
      // there for the student's goal; none is the re-pick's to change.
      if (!mark || mark.kind === 'language' || mark.kind === 'prerequisite' || mark.kind === 'track') continue;
      const current = byId.get(courseId);
      if (!current || !holds(term.id, courseId)) continue;
      const code = normaliseCode(current.code);
      if (trackCodes.has(code)) continue;
      let found: { next: PlanState; pick: { course: Course; why: string } } | null = null;
      if (mark.kind === 'gened') {
        if (compositionOne(current, mark)) continue;
        const own = scorer(code);
        const ranked = genEdCandidates({ context: ctx, requirements: input.requirements, board: working, courseId, scorer, exclude: atStart })
          .filter((c) => c.q.score > own.score + 0.05)
          .filter((c) => genEdSwapEarned(input.priorities, { course: current, q: own }, { course: c.course, q: c.q }, measure, unmetTags))
          .map((c) => ({ course: c.course, why: genEdWhy(c.q, c.categories) }));
        found = firstThatFits(term, current, sameCreditsFirst(ranked, current, credits));
      } else if (mark.kind === 'pool') {
        const pool = input.pools.find((p) => p.picked.some((c) => normaliseCode(c) === code));
        if (!pool) continue;
        // A course a sub-rule counts ("at least two from FIN 4xx") stays,
        // because the rest of the list may not satisfy that rule.
        if (pool.constraints.some((k) => k.picked.some((c) => normaliseCode(c) === code))) continue;
        const own = scorer(code);
        const onBoard = new Set(working.terms.flatMap((t) => t.courseIds));
        const ranked = pool.alternatives
          .map((c) => byCode.get(normaliseCode(c)))
          .filter((c): c is Course => c !== undefined && !atStart.has(c.id) && !onBoard.has(c.id))
          .map((c) => ({ course: c, q: scorer(normaliseCode(c.code)) }))
          .filter((c) => c.q.score > own.score + 0.05)
          .sort((a, b) => b.q.score - a.q.score || b.q.known - a.q.known || a.course.code.localeCompare(b.course.code))
          .map((c) => ({ course: c.course, why: c.q.reasons.length > 0 ? c.q.reasons.slice(0, 2).join('; ') : `on the list ${pool.label}` }));
        found = firstThatFits(term, current, sameCreditsFirst(ranked, current, credits));
      } else {
        const options = electiveOptions({
          context: ctx,
          requirements: input.requirements,
          plan: working,
          termId: term.id,
          prior: input.prior,
          interests: input.interests,
          career: input.career,
          programName: input.programName,
          programCollege: input.programCollege,
          priorities: input.priorities,
          including: current.code,
          electiveCodes: cappedCodes(),
          quality: scorer,
          limit: 30,
        });
        const own = options.find((o) => normaliseCode(o.code) === code);
        // Under a tie, or a hair, the student keeps what they have already
        // seen. A quarter point is a thirtieth of the score's range, under
        // any structural step, so a swap always has a reason the words can show.
        const ranked = options
          .filter((o) => normaliseCode(o.code) !== code && (!own || o.fit > own.fit + 0.25))
          .map((o) => ({ course: byCode.get(normaliseCode(o.code)), why: o.reasons.length > 0 ? o.reasons.slice(0, 2).join('; ') : o.why }))
          .filter((o): o is { course: Course; why: string } => o.course !== undefined && !atStart.has(o.course.id));
        found = firstThatFits(term, current, sameCreditsFirst(ranked, current, credits));
      }
      if (!found) continue;
      working = found.next;
      settled.add(found.pick.course.id);
      if (counted.delete(courseId)) counted.add(found.pick.course.id);
      changes.push({ term: term.label, termId: term.id, from: current.code, to: found.pick.course.code, why: found.pick.why, kind: mark.kind === 'gened' ? 'gened' : mark.kind === 'pool' ? 'pool' : 'elective' });
    }
  }
  // Net changes only. One pass and fresh candidates make every swap net
  // already; this keeps the report honest if that ever stops being true.
  const final = new Set(working.terms.flatMap((t) => t.courseIds).map(codeOf));
  const net = changes.filter((c) => final.has(normaliseCode(c.to)) && (!c.from || !final.has(normaliseCode(c.from))));
  return { board: working, changes: net, signature, unchanged: false };
}
