/**
 * Which crawled class schedule answers for a course.
 *
 * Illinois publishes one term's class times at a time, a few months ahead:
 * Fall 2026 and Spring 2027 are crawled now, Fall 2027 appears around March.
 * A board runs four years past that, so most of its columns have no schedule
 * of their own, and the one that matters most to a student registering today,
 * Spring 2027, is not the term the planner first crawled.
 *
 * The rule every surface uses (the course card, ALMA's course details and its
 * question router, the advisor packet):
 *
 *   - a course in a column whose term was crawled reads that term's sections;
 *   - a course in a later column reads the latest crawl of the same season,
 *     and says so ("Fall 2027's schedule is not published yet, so these are
 *     Fall 2026's"), because a fall course is taught on a fall timetable;
 *   - a summer column, with no summer crawl, reads the newest crawl and says so;
 *   - a course not on the board reads the newest crawl, the term students
 *     register for next, whose label every answer already prints.
 *
 * This decides what is shown, never what is planned: the plan's scoring and
 * checks still read the first crawled term (PlanningContext.sections).
 *
 * Pure and free of React and fetch, so the build, the browser and the checks
 * run the same rule.
 */
import type { SectionTermInfo } from './illinois-data';

export type { SectionTermInfo };

const SEASON_RANK: Record<string, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };

/** Chronological order of crawled terms: Fall 2026 before Spring 2027. */
export function termRank(term: { year: number; term: string }): number {
  return term.year * 4 + (SEASON_RANK[String(term.term).toLowerCase()] ?? 0);
}

/** A term a question is about: a board column ("spring-2027", "Spring 2027"). */
export interface PlanTermRef {
  id: string;
  label: string;
}

export interface SectionTermPick {
  /** The crawled term whose sections are shown. */
  term: SectionTermInfo;
  /**
   * exact: the schedule of the very term asked about.
   * same-season: that term's schedule is not published; the latest crawl of its season.
   * other-season: no crawl of that season at all (a summer); the newest crawl.
   * newest: no term was asked about, the course is not on the board; the newest crawl.
   */
  how: 'exact' | 'same-season' | 'other-season' | 'newest';
  /** The term asked about, when there was one. */
  asked: PlanTermRef | null;
}

/** "spring-2027" -> "spring". Plan term ids are `${season}-${year}`. */
function seasonOfId(id: string): string {
  return id.split('-')[0]?.toLowerCase() ?? '';
}

export function pickSectionTerm(
  terms: readonly SectionTermInfo[] | null | undefined,
  asked: PlanTermRef | null,
): SectionTermPick | null {
  if (!terms || terms.length === 0) return null;
  const newestFirst = [...terms].sort((a, b) => termRank(b) - termRank(a));
  const newest = newestFirst[0];
  if (!asked) return { term: newest, how: 'newest', asked: null };
  const exact = terms.find((t) => t.id === asked.id);
  if (exact) return { term: exact, how: 'exact', asked };
  const season = seasonOfId(asked.id);
  const same = newestFirst.find((t) => String(t.term).toLowerCase() === season);
  if (same) return { term: same, how: 'same-season', asked };
  return { term: newest, how: 'other-season', asked };
}

/**
 * The sentence printed beside sections that are not the asked term's own.
 * Null when they are, or when no term was asked about (the answer already
 * names the term it shows).
 */
export function sectionTermCaveat(pick: SectionTermPick | null): string | null {
  if (!pick || !pick.asked) return null;
  const season = seasonOfId(pick.asked.id);
  if (pick.how === 'same-season') {
    return `${pick.asked.label}'s class schedule is not published yet, so these are ${pick.term.label}'s sections, the latest ${season} schedule. Times, rooms and instructors can change.`;
  }
  if (pick.how === 'other-season') {
    return `No ${season} class schedule has been read, so these are ${pick.term.label}'s sections. A ${season} session can run at other times.`;
  }
  return null;
}

/** "Fall 2026 and Spring 2027", oldest first. */
export function termsInWords(terms: ReadonlyArray<{ label: string; year: number; term: string }>): string {
  const labels = [...terms].sort((a, b) => termRank(a) - termRank(b)).map((t) => t.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
