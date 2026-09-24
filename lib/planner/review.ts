/**
 * The board read the way an advisor reads it once the student has had their
 * hands on it.
 *
 * validatePlan (autoplan.ts) says what is wrong with a board: a prerequisite
 * out of order, a standing not reached, Composition I dragged to a junior
 * fall. This file says what an advisor adds on top, from the research the
 * audit of 2026-09-24 ranked:
 *
 *   - First-year momentum. In Kentucky's statewide data a full-time student
 *     at 12 to 14 hours a term finished in four years about half as often as
 *     one at 15 or more (18.4% against 35.4%), and 30 hours in year one was
 *     the strongest predictor; CCRC's early-momentum measures add the first
 *     college math course and three or more courses in the program in year
 *     one. A student who sets 12 hours or drags a course out of their first
 *     fall hears that once, and the choice stays theirs.
 *   - Credits that count toward nothing: hours past the degree total, a
 *     course the college gives no degree hours for, the second of two
 *     courses that do not both count, and the student's own additions that
 *     fill no requirement (free elective hours, which is fine, and said so).
 *   - What held credit fills: a Parkland student with ENG 101 alone brings 3
 *     hours and fills nothing, since Composition I takes ENG 101 and 102.
 *   - Summers. When a chain runs back to back into the last term, a first
 *     year is light by the student's choice, or the finish would slip, a
 *     summer with courses Illinois has actually run in summer buys the time
 *     back; the review names it and never adds it.
 *
 * Everything here is pure over the board and the planning context, so
 * __review.check.mjs replays it on real students; the workspace's
 * review_board, move_course and what_if only format the result.
 */
import {
  degreeSubjects,
  heldTowardDegree,
  normaliseCode,
  planCreditRange,
  validatePlan,
  type GenEdCredit,
  type PlanningContext,
  type PlanRequirement,
  type ValidateOptions,
} from './autoplan';
import { isBlockingIssue, type PlanMark } from './repick';
import { transcriptResidentHours, type TranscriptRecord } from './transcript';
import type { Course, PlanIssue, PlanState, PlanTerm, SemesterSeason } from './types';

// ---------------------------------------------------------------------------
// First-year momentum
// ---------------------------------------------------------------------------

/** The load that keeps a four-year pace, and year one's share of it. */
export const MOMENTUM_TERM_HOURS = 15;
export const MOMENTUM_YEAR_HOURS = 30;

/**
 * The fact a student hears once when their own setting or edits leave the
 * first year light. Kentucky's Council on Postsecondary Education, academic
 * momentum report: 35.4% of full-time students taking 15 or more hours
 * finished a bachelor's in four years, against 18.4% at 12 to 14.
 */
export const MOMENTUM_FACT =
  "In Kentucky's statewide data, full-time students taking 12 to 14 hours a term finished in four years about half as often as those taking 15 or more (18.4% against 35.4%; cpe.ky.gov/data/reports/academicmomentumreport.pdf). The choice is the student's; say this once and leave it with them.";

/**
 * Whether the plan's first year is the student's first year of college.
 *
 * Momentum is measured on first-time students: Jordan, transferring from
 * Parkland "as a junior", has no first year left to protect, and neither
 * does a student already holding Illinois hours. An incoming freshman with
 * 42 AP hours is still a first-year, which is why the credit alone is not
 * the test: dual credit from Joliet Junior College and a Parkland associate
 * degree look the same on a record, and only the student's words tell them
 * apart.
 */
export function enteringAsFirstYear(words: string, record: TranscriptRecord | null | undefined): boolean {
  if (transcriptResidentHours(record).total > 0) return false;
  if (record?.kind === 'transfer_report') return false;
  if (/\b(sophomore|junior|senior|second[- ]year|third[- ]year|fourth[- ]year|associate'?s( degree)?|transfer student|continuing student)\b/i.test(words)) return false;
  if (/\btransferr?\w* (to|into) (the )?(illinois|uiuc|u of i|university of illinois|urbana)\b/i.test(words)) return false;
  return true;
}

const yearOfLabel = (term: { id: string; label: string }): number | null => {
  const m = term.label.match(/\b(20\d\d)\b/) ?? term.id.match(/\b(20\d\d)\b/);
  return m ? Number(m[1]) : null;
};
const calendarOrd = (season: SemesterSeason, year: number): number => year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
const ordOf = (term: PlanTerm): number | null => {
  const year = yearOfLabel(term);
  return year === null ? null : calendarOrd(term.season, year);
};
const subjectOf = (code: string) => normaliseCode(code).split(' ')[0];
const levelOf = (code: string) => Number(normaliseCode(code).match(/(\d{3})/)?.[1] ?? 0);

/**
 * Year one on the board: the first two falls and springs and any summer
 * before the third. A term away is not on the board, so a student abroad in
 * their first spring has Fall 2026 and Fall 2027 as their year one, which is
 * what their pace is measured on.
 */
export function firstYearTerms(board: PlanState): PlanTerm[] {
  const out: PlanTerm[] = [];
  let regular = 0;
  for (const term of board.terms) {
    if (term.season !== 'Summer') {
      if (regular === 2) break;
      regular += 1;
    }
    out.push(term);
  }
  return out;
}

/**
 * A math or statistics course: MATH or STAT, or a lower-division course whose
 * title says so. Psychology's statistics course is PSYC 235 and Economics'
 * is ECON 202; counting only the MATH prefix told a psychology student they
 * had no statistics in year one while PSYC 235 sat in their first spring.
 */
export function isMathOrStatistics(course: Pick<Course, 'code' | 'title'>): boolean {
  const subject = subjectOf(course.code);
  if (subject === 'MATH' || subject === 'STAT') return true;
  return levelOf(course.code) < 300 && /\b(statistic|calculus|precalculus|algebra|trigonometr|mathemat)/i.test(course.title);
}

export interface MomentumInput {
  context: PlanningContext;
  board: PlanState;
  requirements: PlanRequirement[];
  programName?: string;
  /** False for a transfer or continuing student (enteringAsFirstYear): nothing is flagged. */
  firstYear: boolean;
  /** The hours a term the student asked for, or null for the balanced default. */
  targetTermCredits: number | null;
  /** Each term's codes as the plan was built, by term id; null for a board restored from this device. */
  built: Record<string, string[]> | null;
  /** Every course the student holds, by code. */
  heldCodes: string[];
  /** Held credit that fills gen-ed categories without a course (a Parkland statistics course). */
  genEdCredits?: Array<Pick<GenEdCredit, 'tags'>>;
}

export type FlagCause = 'setting' | 'edits' | 'plan';

export interface ReviewFlag {
  /** Stable across boards, so an edit's result can say which flags it caused. */
  id: string;
  message: string;
  termId: string | null;
  cause: FlagCause;
}

/**
 * The four first-year checks. The two about hours fire only when the
 * student's own hours setting or their edits caused the shortfall, never for
 * a term the plan had to leave short (a balanced share for a student with
 * 42 AP hours is not a light year). The math and major checks fire whatever
 * caused them and say which; the fact comes back once, with the first flag
 * the student caused.
 */
export function momentumReview(input: MomentumInput): { flags: ReviewFlag[]; fact: string | null } {
  if (!input.firstYear) return { flags: [], fact: null };
  const ctx = input.context;
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  const codesOf = (ids: string[]) => ids.map((id) => byId.get(id)?.code).filter((c): c is string => Boolean(c)).map(normaliseCode);
  const hours = (codes: string[]) => planCreditRange(codes, ctx).max;
  const year = firstYearTerms(input.board);
  const yearIds = new Set(year.map((t) => t.id));
  const built = input.built;
  const setting = input.targetTermCredits !== null && input.targetTermCredits < MOMENTUM_TERM_HOURS;
  const flags: ReviewFlag[] = [];
  const causeOf = (now: number, was: number | null): FlagCause | null =>
    was !== null && now < was ? 'edits' : setting ? 'setting' : null;
  const why = (cause: FlagCause, was: number | null) =>
    cause === 'edits' ? `it held ${was} as the plan was built, and an edit took it down` : `the ${input.targetTermCredits} a term the student set is the reason`;

  for (const term of year) {
    if (term.season === 'Summer') continue;
    const now = hours(codesOf(term.courseIds));
    if (now >= MOMENTUM_TERM_HOURS) continue;
    const was = built?.[term.id] ? hours(built[term.id]) : null;
    const cause = causeOf(now, was);
    if (!cause) continue;
    flags.push({ id: `momentum-term-${term.id}`, termId: term.id, cause, message: `${term.label} holds ${now} Illinois hours, under ${MOMENTUM_TERM_HOURS} in a first-year term; ${why(cause, was)}.` });
  }

  const yearCodes = year.flatMap((t) => codesOf(t.courseIds));
  const yearNow = hours(yearCodes);
  if (yearNow < MOMENTUM_YEAR_HOURS && year.length > 0) {
    const was = built ? hours(year.flatMap((t) => built[t.id] ?? [])) : null;
    const cause = causeOf(yearNow, was && was > 0 ? was : null);
    if (cause) {
      const span = `${year[0].label} to ${year[year.length - 1].label}`;
      flags.push({ id: 'momentum-year-one', termId: year[0].id, cause, message: `Year one (${span}) holds ${yearNow} Illinois hours, under ${MOMENTUM_YEAR_HOURS}; AP and transfer credit is not counted here; ${why(cause, was)}.` });
    }
  }

  /**
   * The first college math course. Held credit settles it: MATH 220 from AP
   * Calculus, STAT 100 from AP Statistics, or a Parkland statistics course
   * the transfer guide counts as Quantitative Reasoning I.
   */
  const heldMath =
    input.heldCodes.some((code) => {
      const course = byCode.get(normaliseCode(code));
      return course ? isMathOrStatistics(course) : ['MATH', 'STAT'].includes(subjectOf(code));
    }) || (input.genEdCredits ?? []).some((g) => g.tags.includes('Quantitative Reasoning I'));
  if (!heldMath) {
    const firstMath = (terms: Array<{ id: string; codes: string[] }>) => {
      for (const t of terms) {
        const code = t.codes.find((c) => {
          const course = byCode.get(c);
          return course ? isMathOrStatistics(course) : false;
        });
        if (code) return { termId: t.id, code };
      }
      return null;
    };
    const now = firstMath(input.board.terms.map((t) => ({ id: t.id, codes: codesOf(t.courseIds) })));
    if (now && !yearIds.has(now.termId)) {
      const wasInYear = built ? firstMath(input.board.terms.map((t) => ({ id: t.id, codes: built[t.id] ?? [] }))) : null;
      const cause: FlagCause = wasInYear && yearIds.has(wasInYear.termId) ? 'edits' : 'plan';
      const label = input.board.terms.find((t) => t.id === now.termId)?.label ?? '';
      flags.push({
        id: 'momentum-math',
        termId: now.termId,
        cause,
        message: `The first math or statistics course on the board, ${now.code}, is in ${label}, after year one${cause === 'edits' ? ' (an edit moved it there)' : ''}; finishing the first college math course in year one is one of CCRC's early-momentum measures.`,
      });
    }
  }

  /**
   * Courses in the major's own subjects, two credits or more: LAS 100 is a
   * one-credit seminar a Psychology page names three times, and counting it
   * made a year with one PSYC course read as three.
   */
  const { subjects, primary } = degreeSubjects(input.requirements, input.programName);
  const major = new Set(subjects);
  if (primary) major.add(primary);
  if (major.size > 0) {
    const inMajor = (codes: string[]) => codes.filter((code) => major.has(subjectOf(code)) && hours([code]) >= 2);
    const held = inMajor(input.heldCodes.map(normaliseCode));
    const now = inMajor(yearCodes);
    if (now.length + held.length < 3) {
      const was = built ? inMajor(year.flatMap((t) => built[t.id] ?? [])).length + held.length : null;
      const cause: FlagCause = was !== null && was >= 3 ? 'edits' : 'plan';
      const named = [...now, ...held.map((code) => `${code} held`)];
      flags.push({
        id: 'momentum-major',
        termId: year[0]?.id ?? null,
        cause,
        message: `Year one has ${named.length} course${named.length === 1 ? '' : 's'} in the major's own subjects (${[...major].sort().join(', ')})${named.length ? `: ${named.join(', ')}` : ''}, under 3${cause === 'edits' ? '; edits moved some out' : ''}. Three or more courses in the program in year one is one of CCRC's early-momentum measures, and it is how a student finds out early whether the major fits.`,
      });
    }
  }

  const caused = flags.some((f) => f.cause !== 'plan' && (f.id.startsWith('momentum-term-') || f.id === 'momentum-year-one'));
  return { flags, fact: caused ? MOMENTUM_FACT : null };
}

// ---------------------------------------------------------------------------
// Flags an edit causes
// ---------------------------------------------------------------------------

/**
 * The validator rows an edit can break without touching a prerequisite:
 * Composition I after the first year, and a fall or spring past 60 hours
 * with no language course while the requirement is open.
 */
export function isEditFlag(issue: Pick<PlanIssue, 'id'>): boolean {
  return /^ap-(comp1-late|language-gap)-/.test(issue.id);
}

/**
 * The review flags on one board, as id and sentence: the validator's edit
 * flags and the momentum flags. move_course and what_if compare the board
 * before and after and return only the ones the change caused.
 */
export function editFlags(issues: PlanIssue[], momentum: ReviewFlag[]): Array<{ id: string; message: string }> {
  return [
    ...issues.filter(isEditFlag).map((i) => ({ id: i.id, message: i.message })),
    ...momentum.map((f) => ({ id: f.id, message: f.message })),
  ];
}

/** Flags on the board after an edit that were not there before it. */
export function flagsCaused(before: Array<{ id: string }>, after: Array<{ id: string; message: string }>): string[] {
  const was = new Set(before.map((f) => f.id));
  return after.filter((f) => !was.has(f.id)).map((f) => f.message);
}

// ---------------------------------------------------------------------------
// Credits that count toward nothing
// ---------------------------------------------------------------------------

export interface CreditUseInput {
  context: PlanningContext;
  board: PlanState;
  requirements: PlanRequirement[];
  programCollege?: string;
  programName?: string;
  degreeTotal: number | null;
  /** Hours held before the plan, and hours a term away earns: the rest of the headline total. */
  priorCredits: number;
  awayCredits?: number;
  /** Every course the student holds, by code. */
  heldCodes: string[];
  /** What each card is (planMarks). */
  marks: Map<string, PlanMark>;
  /** Course ids the student or ALMA put on the board since the plan was built. */
  studentAdded: Set<string>;
}

export interface CreditUse {
  /** Hours planned past the degree's published total, or 0. */
  beyondTotal: number;
  /** Courses whose hours count toward nothing, each with the reason. */
  countsNothing: Array<{ code: string; term: string; why: string }>;
  /** The student's own additions that fill no requirement: free elective hours. */
  freeElectives: Array<{ code: string; term: string }>;
}

/** The codes a degree names in its lists and required rows, with their cross-listed twins. */
function namedByDegree(requirements: PlanRequirement[], ctx: PlanningContext): Set<string> {
  const named = new Set<string>();
  for (const r of requirements) {
    if (r.rule.kind !== 'all' && r.rule.kind !== 'choose' && r.rule.kind !== 'pool') continue;
    for (const choice of r.rule.choices) {
      for (const raw of [...choice.codes, ...(choice.substitutes ?? []), ...(choice.bundles ?? []).flat()]) {
        const code = normaliseCode(raw);
        named.add(code);
        for (const twin of ctx.equivalents?.get(code) ?? []) named.add(normaliseCode(twin));
      }
    }
  }
  return named;
}

/**
 * What a course fills on this degree, or null: a row or list the page names,
 * a general education category the degree asks for, the language
 * requirement, or the major's own hours (Psychology's 28 hours of
 * concentration coursework are PSYC courses the page does not list one by
 * one).
 */
function fills(course: Course, requirements: PlanRequirement[], named: Set<string>, ctx: PlanningContext, major: Set<string>): string | null {
  const code = normaliseCode(course.code);
  if (named.has(code)) return 'a course the degree names';
  const genEd = requirements.flatMap((r) => (r.rule.kind === 'gened' || (r.rule.kind === 'hours' && r.rule.genEd) ? r.rule.genEd ?? [] : []));
  const tag = course.tags.find((t) => genEd.includes(t));
  if (tag) return tag;
  if (requirements.some((r) => r.rule.kind === 'language') && (ctx.languages?.languages ?? []).some((l) => l.levels.flat(2).map(normaliseCode).includes(code))) return 'the language requirement';
  const majorHours = requirements.find((r) => r.rule.kind === 'hours' && !r.rule.genEd && !/\bfree\b|additional course ?work/i.test(`${r.label} ${r.rule.label}`) && levelOf(code) >= (r.rule.minLevel ?? 0));
  if (majorHours && major.has(course.cluster)) return majorHours.label || 'the major\'s hours';
  return null;
}

/**
 * Hours past the total, and the courses on the board that count toward
 * nothing or only toward free elective hours.
 *
 * "Nothing" is exact: Grainger gives no degree hours for MATH 112 or a
 * 100-level PHYS course, and of two courses the catalog says do not both
 * count, the second one's hours are lost. The planner's own elective slots
 * are the free-elective hours the degree total asks for and are not listed.
 */
export function creditUse(input: CreditUseInput): CreditUse {
  const ctx = input.context;
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const named = namedByDegree(input.requirements, ctx);
  const { subjects, primary } = degreeSubjects(input.requirements, input.programName);
  const major = new Set(subjects);
  if (primary) major.add(primary);
  const boardCodes: string[] = [];
  const countsNothing: CreditUse['countsNothing'] = [];
  const freeElectives: CreditUse['freeElectives'] = [];
  const seen = new Set(input.heldCodes.map(normaliseCode));
  const counted = new Set(heldTowardDegree(input.board.terms.flatMap((t) => t.courseIds.map((id) => normaliseCode(byId.get(id)?.code ?? ''))), input.programCollege, input.requirements).codes);
  for (const term of input.board.terms) {
    for (const id of term.courseIds) {
      const course = byId.get(id);
      if (!course) continue;
      const code = normaliseCode(course.code);
      boardCodes.push(code);
      const clash = (ctx.exclusions?.get(code) ?? []).map(normaliseCode).find((other) => seen.has(other) && !(ctx.equivalents?.get(code) ?? []).map(normaliseCode).includes(other));
      seen.add(code);
      if (!counted.has(code)) {
        countsNothing.push({ code, term: term.label, why: `the College of Engineering gives no degree hours for it (advising.grainger.illinois.edu/degree-requirements/coursesnotcount)${input.marks.get(id)?.kind === 'prerequisite' ? '; it is on the board as a prerequisite' : ''}` });
        continue;
      }
      if (clash) {
        countsNothing.push({ code, term: term.label, why: `the catalog does not give credit for both it and ${clash}, which comes first` });
        continue;
      }
      if (!input.studentAdded.has(id) || input.marks.has(id)) continue;
      if (fills(course, input.requirements, named, ctx, major) === null) freeElectives.push({ code, term: term.label });
    }
  }
  const total = planCreditRange(boardCodes, ctx).min + input.priorCredits + (input.awayCredits ?? 0);
  const beyondTotal = input.degreeTotal !== null ? Math.max(0, total - input.degreeTotal) : 0;
  return { beyondTotal, countsNothing, freeElectives };
}

export interface PriorUseInput {
  context: PlanningContext;
  requirements: PlanRequirement[];
  programName?: string;
  programCollege?: string;
  /** Every hour held, as the headline counts it (priorCreditHours). */
  hoursIn: number;
  /** Held courses, each class once, none forfeited to a required course. */
  heldCodes: string[];
  /** Gen-ed categories met by held credit with no course: Parkland lines, exams. */
  genEdCredits: Array<Pick<GenEdCredit, 'label' | 'credits' | 'tags'>>;
  /** Requirements the generation found already met by held credit. */
  satisfied?: Array<{ codes: string[] }>;
}

/**
 * Hours brought in, beside the hours that fill a requirement.
 *
 * Every transferable course counts at least as elective hours toward the
 * total, and that is where most transfer credit ends up: the GAO found
 * transfer students lose about 43% of their credits, most of it to hours
 * that count and fill nothing. ENG 101 alone from Parkland is 3 hours in
 * and 0 toward a requirement, because Composition I takes ENG 101 and 102.
 */
export function priorCreditUse(input: PriorUseInput): { hoursIn: number; hoursFilling: number; hoursNothing: number; filling: string[]; electiveOnly: string[]; nothing: string[] } {
  const ctx = input.context;
  const named = namedByDegree(input.requirements, ctx);
  for (const s of input.satisfied ?? []) for (const code of s.codes) named.add(normaliseCode(code));
  const { subjects, primary } = degreeSubjects(input.requirements, input.programName);
  const major = new Set(subjects);
  if (primary) major.add(primary);
  const byCode = new Map(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  // AP Statistics' STAT 100 is held, clears prerequisites, and earns no
  // hours toward an engineering degree.
  const toward = new Set(heldTowardDegree(input.heldCodes.map(normaliseCode), input.programCollege, input.requirements).codes);
  const filling: string[] = [];
  const electiveOnly: string[] = [];
  const nothing: string[] = [];
  let hoursFilling = 0;
  let hoursNothing = 0;
  for (const raw of input.heldCodes) {
    const code = normaliseCode(raw);
    if (!toward.has(code)) {
      nothing.push(code);
      hoursNothing += planCreditRange([code], ctx).min;
      continue;
    }
    const course = byCode.get(code);
    const what = course ? fills(course, input.requirements, named, ctx, major) : named.has(code) ? 'a course the degree names' : null;
    if (what) {
      filling.push(`${code} (${what})`);
      hoursFilling += planCreditRange([code], ctx).min;
    } else electiveOnly.push(code);
  }
  const genEd = new Set(input.requirements.flatMap((r) => (r.rule.kind === 'gened' || (r.rule.kind === 'hours' && r.rule.genEd) ? r.rule.genEd ?? [] : [])));
  for (const g of input.genEdCredits) {
    if (g.tags.some((t) => genEd.has(t))) {
      filling.push(`${g.label} (${g.tags.join(', ')})`);
      hoursFilling += g.credits;
    }
  }
  return { hoursIn: input.hoursIn, hoursFilling: Math.min(hoursFilling, input.hoursIn), hoursNothing, filling, electiveOnly, nothing };
}

// ---------------------------------------------------------------------------
// Summers
// ---------------------------------------------------------------------------

/** The engine's summer ceilings (SUMMER_MAX and SUMMER_MAX_HARD in autoplan.ts). */
const SUMMER_MAX = 9;
const SUMMER_MAX_HARD = 1;

/**
 * The board with Summer `year` in it, or null when that summer is not inside
 * the plan: a summer has to come after the first term and before the last,
 * the rule set_plan_shape applies. A summer already on the board is used as
 * it is.
 */
export function withSummer(board: PlanState, year: number): { board: PlanState; termId: string } | null {
  const existing = board.terms.find((t) => t.season === 'Summer' && yearOfLabel(t) === year);
  if (existing) return { board, termId: existing.id };
  const at = calendarOrd('Summer', year);
  const after = board.terms.findIndex((t) => (ordOf(t) ?? -1) > at);
  if (after <= 0) return null;
  const before = board.terms[after - 1];
  const term: PlanTerm = { id: `summer-${year}`, label: `Summer ${year}`, year: before.year, season: 'Summer', courseIds: [] };
  return { board: { ...board, terms: [...board.terms.slice(0, after), term, ...board.terms.slice(after)] }, termId: term.id };
}

/** The summers a course ran in at Illinois, newest first: ["Summer 2026", "Summer 2025"]. */
export function summerRuns(ctx: PlanningContext, code: string): string[] {
  return (ctx.offerings?.get(normaliseCode(code)) ?? []).filter((t) => t.startsWith('su')).map((t) => `Summer ${t.slice(2)}`);
}

/**
 * Chains of courses that each need the one before, back to back in
 * consecutive falls and springs and ending in the last one: CHEM 232 in Fall
 * 2027, CHEM 332 in Spring 2028, ... up to the final term. A course dropped
 * or failed anywhere on such a chain moves the finish. Longest first.
 */
export function tightChains(board: PlanState, ctx: PlanningContext, minLength = 3): Array<Array<{ code: string; termId: string; label: string }>> {
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const regular = board.terms.filter((t) => t.season !== 'Summer');
  if (regular.length < minLength) return [];
  const at = new Map<string, number>();
  const cards: Array<{ code: string; termId: string; label: string; k: number }> = [];
  regular.forEach((t, k) => {
    for (const id of t.courseIds) {
      const code = normaliseCode(byId.get(id)?.code ?? '');
      if (!code) continue;
      at.set(code, k);
      cards.push({ code, termId: t.id, label: t.label, k });
    }
  });
  const needs = (later: string, earlier: string) =>
    (ctx.prereqs?.get(later)?.groups ?? []).some((g) => !g.concurrent && g.any.some((raw) => {
      const code = normaliseCode(raw);
      return code === earlier || (ctx.equivalents?.get(code) ?? []).map(normaliseCode).includes(earlier);
    }));
  const best = new Map<string, Array<{ code: string; termId: string; label: string }>>();
  for (const card of [...cards].sort((a, b) => a.k - b.k)) {
    let chain = [{ code: card.code, termId: card.termId, label: card.label }];
    for (const prev of cards) {
      if (prev.k !== card.k - 1 || !needs(card.code, prev.code)) continue;
      const via = best.get(prev.code) ?? [];
      if (via.length + 1 > chain.length) chain = [...via, chain[chain.length - 1]];
    }
    best.set(card.code, chain);
  }
  const last = regular.length - 1;
  return [...best.values()]
    .filter((chain) => chain.length >= minLength && at.get(chain[chain.length - 1].code) === last)
    .sort((a, b) => b.length - a.length);
}

export interface SummerInput {
  context: PlanningContext;
  board: PlanState;
  /** The options every validatePlan call on this board uses. */
  options: ValidateOptions;
  marks: Map<string, PlanMark>;
  studentAdded?: Set<string>;
  /** The hours a term the student asked for, or null for the balanced default. */
  targetTermCredits: number | null;
  /** A first-year term or year one is light by the student's setting or edits (momentumReview). */
  lightFirstYear: boolean;
  /** The last term the student wants: a date they stated, or the default four years. */
  finish: { season: SemesterSeason; year: number } | null;
}

export interface SummerPick {
  label: string;
  year: number;
  hours: number;
  /** Each course moved there, the term it leaves, and the summers Illinois ran it. */
  courses: Array<{ code: string; from: string; ran: string[] }>;
}

export interface SummerSuggestion {
  reason: 'finish' | 'first-year' | 'chain';
  summers: SummerPick[];
  /** Falls and springs the summers save at the student's own pace, or 0. */
  saves: number;
  text: string;
}

/**
 * What a summer would do for this board, without adding it.
 *
 * Three things make a summer worth naming: a finish that would slip at the
 * pace the student asked for (Emma set 12 hours a term; her 120 hours need
 * ten falls and springs at that pace, two past Spring 2030, so the plan holds
 * 15), a first year the student made light, and a chain with no slack. Each
 * course named has run in a summer at Illinois in the offering history, and
 * the board with it moved there passes the checks a drag does: no
 * prerequisite, standing or edit flag broken, at most 9 hours and one
 * hardest-band course in the summer. The terms the courses leave get lighter,
 * and may go under the student's minimum until set_plan_shape summers
 * rebuilds the board around the summer; that rebuild is what evens the load.
 * For a finish, an elective slot also counts: its hours can be any course
 * that runs in summer, and Emma's Psychology board has too few summer-run
 * degree courses after year one to carry 24 hours without them.
 */
export function summerSuggestions(input: SummerInput): SummerSuggestion[] {
  const ctx = input.context;
  const byId = new Map(ctx.courses.map((c) => [c.id, c]));
  const hardCut = ctx.bands?.hardest ?? null;
  const isHard = (code: string) => {
    const d = ctx.grades?.get(normaliseCode(code))?.difficulty ?? null;
    return hardCut !== null && d !== null && d >= hardCut;
  };
  const credit = (code: string) => planCreditRange([code], ctx).min;
  const breaks = (i: PlanIssue) => isBlockingIssue(i) || isEditFlag(i) || /^ap-(prereq-check|prereq-order|priorlearning|offering|closed)-/.test(i.id);
  /** Degree courses before the planner's elective slots and the student's own additions. */
  const needed = (id: string) => {
    const kind = input.marks.get(id)?.kind;
    return kind !== 'elective' && !(kind === undefined && input.studentAdded?.has(id));
  };

  /**
   * Moves courses from later falls and springs into Summer `year` on `base`,
   * degree courses first and then in the order given, while the board keeps
   * passing. Null when the summer is outside the plan or nothing can go.
   */
  const fill = (
    base: PlanState,
    year: number,
    want: number,
    prefer: (a: { k: number; code: string }, b: { k: number; code: string }) => number,
    opts: { only?: (code: string) => boolean; slots?: boolean } = {},
  ): (SummerPick & { board: PlanState }) | null => {
    const placed = withSummer(base, year);
    if (!placed) return null;
    let board = placed.board;
    const at = board.terms.findIndex((t) => t.id === placed.termId);
    const baseline = new Set(validatePlan(board, ctx, input.options).filter(breaks).map((i) => i.id));
    const later = board.terms
      .flatMap((t, k) => (k > at && t.season !== 'Summer' ? t.courseIds.map((id) => ({ id, k, from: t.label, code: normaliseCode(byId.get(id)?.code ?? '') })) : []))
      .filter((c) => c.code && (!opts.only || opts.only(c.code)));
    const ranInSummer = (c: { id: string; code: string }) => Boolean(byId.get(c.id)?.offeredIn.includes('Summer')) && summerRuns(ctx, c.code).length > 0;
    const candidates = [
      ...later.filter(ranInSummer).sort((a, b) => Number(needed(b.id)) - Number(needed(a.id)) || prefer(a, b) || a.code.localeCompare(b.code)),
      // An elective slot's hours can be any course that runs in summer.
      ...(opts.slots ? later.filter((c) => !ranInSummer(c) && input.marks.get(c.id)?.kind === 'elective').sort((a, b) => prefer(a, b) || a.code.localeCompare(b.code)) : []),
    ];
    const courses: SummerPick['courses'] = [];
    const already = board.terms[at].courseIds.reduce((n, id) => n + credit(byId.get(id)?.code ?? ''), 0);
    let hours = already;
    for (const c of candidates) {
      if (hours - already >= want) break;
      if (hours + credit(c.code) > SUMMER_MAX) continue;
      const slot = !ranInSummer(c);
      if (!slot && isHard(c.code) && board.terms[at].courseIds.filter((id) => isHard(byId.get(id)?.code ?? '')).length >= SUMMER_MAX_HARD) continue;
      const trial: PlanState = {
        ...board,
        terms: board.terms.map((t, k) => (k === at ? (slot ? t : { ...t, courseIds: [...t.courseIds, c.id] }) : { ...t, courseIds: t.courseIds.filter((id) => id !== c.id) })),
      };
      if (validatePlan(trial, ctx, input.options).some((i) => breaks(i) && !baseline.has(i.id))) continue;
      board = trial;
      hours += credit(c.code);
      courses.push({ code: c.code, from: c.from, ran: slot ? [] : summerRuns(ctx, c.code) });
    }
    return courses.length > 0 ? { board, label: `Summer ${year}`, year, hours: hours - already, courses } : null;
  };
  const strip = (s: SummerPick & { board: PlanState }): SummerPick => ({ label: s.label, year: s.year, hours: s.hours, courses: s.courses });
  /** "Summer 2027 (9 hours): PHYS 101 from Spring 2030, IB 150 from Spring 2029", and elective slots by term. */
  const named = (s: SummerPick) => {
    const moved = s.courses.filter((p) => p.ran.length > 0);
    const slots = s.courses.filter((p) => p.ran.length === 0);
    const parts = [
      ...moved.map((p) => `${p.code} from ${p.from}`),
      slots.length ? `${slots.length} elective ${slots.length === 1 ? 'slot' : 'slots'} from ${[...new Set(slots.map((p) => p.from))].join(' and ')} as courses that run in summer` : null,
    ].filter(Boolean);
    return `${s.label} (${s.hours} hours): ${parts.join(', ')}`;
  };
  const ranNote = (picks: SummerPick[]) => {
    const runs = [...new Set(picks.flatMap((s) => s.courses.flatMap((p) => p.ran.slice(0, 1))))].sort().reverse();
    return runs.length ? ` Each course named has run in summer at Illinois (most recently ${runs.join(' or ')}).` : '';
  };

  const regular = input.board.terms.filter((t) => t.season !== 'Summer');
  const hoursOf = (t: PlanTerm) => planCreditRange(t.courseIds.map((id) => byId.get(id)?.code ?? '').filter(Boolean), ctx).min;
  const regularHours = regular.reduce((n, t) => n + hoursOf(t), 0);
  const finishOrd = input.finish ? calendarOrd(input.finish.season, input.finish.year) : null;
  const campus = finishOrd === null ? regular.length : regular.filter((t) => (ordOf(t) ?? 0) <= finishOrd).length;
  /**
   * The student's pace: the hours they asked for when the plan had to hold
   * more than that to keep the date (Emma asked for 12 and got 15), else
   * the board's own average, at which a board past the finish is exactly as
   * far past it as it looks. A 12-hour plan at 12.3 a term is at the pace
   * asked for; three hours of rounding are not a slipped term.
   */
  const average = regularHours / Math.max(1, regular.length);
  const raised = input.targetTermCredits !== null && average > input.targetTermCredits + 1;
  const pace = raised && input.targetTermCredits !== null ? input.targetTermCredits : average;
  const past = (hours: number) => Math.max(0, Math.ceil(hours / pace - 1e-9) - campus);
  const firstSpring = regular.find((t) => t.season === 'Spring');
  const firstSummer = firstSpring ? yearOfLabel(firstSpring) : null;
  const lastTerm = input.board.terms[input.board.terms.length - 1];
  const lastYear = lastTerm ? yearOfLabel(lastTerm) ?? 0 : 0;
  const finish = input.finish ? `${input.finish.season} ${input.finish.year}` : 'the finish';
  const out: SummerSuggestion[] = [];

  // A finish that would slip at the student's own pace, or already runs past the date.
  const slip = past(regularHours);
  if (slip > 0 && firstSummer !== null) {
    const summers: Array<SummerPick & { board: PlanState }> = [];
    let board = input.board;
    for (let y = firstSummer; summers.length < 3 && y < lastYear; y += 1) {
      const got = fill(board, y, SUMMER_MAX, (a, b) => b.k - a.k || levelOf(a.code) - levelOf(b.code), { slots: true });
      if (!got) continue;
      board = got.board;
      summers.push(got);
      if (past(regularHours - summers.reduce((n, s) => n + s.hours, 0)) === 0) break;
    }
    if (summers.length > 0) {
      const saves = slip - past(regularHours - summers.reduce((n, s) => n + s.hours, 0));
      const why = raised
        ? `At the ${input.targetTermCredits} a term the student asked for, the ${regularHours} hours on the falls and springs need ${campus + slip} of them, ${slip} past ${finish}${regular.length <= campus ? `; the plan holds about ${Math.round(average)} a term to keep the date` : ''}.`
        : `The board runs ${slip} ${slip === 1 ? 'term' : 'terms'} past ${finish}.`;
      const picks = summers.map(strip);
      out.push({
        reason: 'finish',
        summers: picks,
        saves,
        text: `${why} ${picks.map(named).join('; ')} would ${saves >= slip ? (raised ? `keep ${finish} at that pace` : `bring the finish back to ${finish}`) : saves > 0 ? `save ${saves} of those ${slip} terms` : 'lighten the falls and springs but save no whole term'}.${ranNote(picks)}`,
      });
    }
  }

  // A first year the student made light: the summer right after it.
  if (input.lightFirstYear && firstSummer !== null && !out.some((s) => s.summers.some((x) => x.year === firstSummer))) {
    const yearHours = firstYearTerms(input.board).reduce((n, t) => n + hoursOf(t), 0);
    const got = fill(input.board, firstSummer, Math.min(SUMMER_MAX, Math.max(3, MOMENTUM_YEAR_HOURS - yearHours)), (a, b) => a.k - b.k || levelOf(a.code) - levelOf(b.code));
    if (got) {
      const terms = (hours: number) => Math.ceil(hours / pace - 1e-9);
      const saves = Math.max(0, terms(regularHours) - terms(regularHours - got.hours));
      out.push({
        reason: 'first-year',
        summers: [strip(got)],
        saves,
        text: `${named(got)} would bring year one to ${yearHours + got.hours} Illinois hours. ${saves > 0 ? `At this pace that is ${saves} fall or spring fewer` : 'It saves no whole term at this pace; the terms those courses leave get lighter'}.${ranNote([got])}`,
      });
    }
  }

  // A chain with no slack: one link a summer earlier gives it a term to spare.
  const chain = tightChains(input.board, ctx)[0];
  if (chain) {
    for (const link of chain.slice(1)) {
      const term = input.board.terms.find((t) => t.id === link.termId);
      const year = term?.season === 'Fall' ? yearOfLabel(term) : null;
      if (year === null || out.some((s) => s.summers.some((x) => x.year === year))) continue;
      const got = fill(input.board, year, 1, () => 0, { only: (code) => code === link.code });
      if (!got) continue;
      out.push({
        reason: 'chain',
        summers: [strip(got)],
        saves: 0,
        text: `${chain.map((c) => c.code).join(', ')} run back to back into ${chain[chain.length - 1].label}, each needing the one before, so one dropped or failed course moves the finish. ${named(got)} gives the chain a term to spare.${ranNote([got])}`,
      });
      break;
    }
  }
  return out;
}
