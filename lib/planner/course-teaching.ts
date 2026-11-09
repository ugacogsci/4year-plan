/**
 * How well students rate the instructors who teach a course, for the
 * "Highly rated teaching" priority, read from the files
 * scripts/difficulty/course-teaching.mjs builds:
 * public/uga/course-teaching.json and
 * public/illinois/course-teaching-ratings.json.
 *
 * UGA publishes no list of excellent teachers, so before 2026-11-05 the
 * teaching priority chose nothing at UGA. Illinois's own Teachers Ranked as
 * Excellent list stays first there (quality.ts teachingOf); these readings
 * only fill the courses it is silent on, and never above
 * ILLINOIS_TEACHING_FILL_CAP, under the list's own 0.7 and 0.85.
 *
 * A reading is a bonus and never a penalty: a course rated at or under the
 * school's typical rating scores 0, the same as a course nobody rated, so a
 * student is never steered off a course because a few students chose to
 * complain. The plans read the readings only through the difficulty gate
 * (autoplan.ts floorContextOf strips them from the floor), so they can never
 * cost a required course, a later finish or a new warning.
 *
 * Nothing here names a professor or where the ratings come from: the
 * reason says "students rate the instructors".
 */
import type { SchoolKey } from './school-config';

export { UGA_TEACHING_IN_PLANS, ILLINOIS_TEACHING_RATINGS_IN_PLANS } from './plan-estimates';

/** One course's reading on one term's schedule (course-teaching.mjs). */
export interface RatedTeaching {
  /** The term whose schedule was read: "Spring 2027". */
  t: string;
  /** The bonus, 0 to 0.85, on the scale of Illinois's Excellent-list bonus. */
  v: number;
  /** The ratings-weighted average rating of the rated instructors, 1 to 5. */
  r: number;
  /** How many ratings that is. */
  n: number;
  /** The share of the term's sections a rated instructor teaches. */
  share: number;
}

export interface CourseTeachingFile {
  school: SchoolKey;
  typical: number;
  k: number;
  courses: Record<string, RatedTeaching>;
}

/** How many ratings' worth of the typical rating each professor is pulled toward (course-teaching.mjs). */
export const TEACHING_PRIOR_RATINGS = 10;
/** The pulled-in course rating that earns the whole bonus. */
const TEACHING_TOP = 4.5;

/**
 * One course's reading from one term's schedule: each row is a named
 * instructor and the sections they teach, with their average student rating
 * and its count where they are surely matched to a rated profile (none where
 * not). Each rating is pulled toward `typical` by TEACHING_PRIOR_RATINGS, so
 * a 5.0 from two ratings is near typical and a 4.6 from 210 keeps about 4.56;
 * the course's rating is weighted by sections, with the unrated sections at
 * typical; the bonus is 0.85 of the way from typical to TEACHING_TOP, and 0
 * at or under typical. Null when no instructor is rated. The build script
 * calls this, so the check tests the formula the files hold.
 */
export function teachingReading(
  rows: ReadonlyArray<{ sections: number; rating?: number; count?: number }>,
  typical: number,
): Omit<RatedTeaching, 't'> | null {
  const k = TEACHING_PRIOR_RATINGS;
  let all = 0;
  let rated = 0;
  let pulled = 0;
  let n = 0;
  let raw = 0;
  for (const row of rows) {
    all += row.sections;
    if (typeof row.rating !== 'number' || !(row.count && row.count > 0)) continue;
    rated += row.sections;
    n += row.count;
    raw += row.count * row.rating;
    pulled += row.sections * ((row.count * row.rating + k * typical) / (row.count + k));
  }
  if (rated === 0 || all === 0) return null;
  const course = (pulled + (all - rated) * typical) / all;
  const v = 0.85 * Math.max(0, Math.min(1, (course - typical) / (TEACHING_TOP - typical)));
  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  return { v: round(v, 2), r: round(raw / n, 1), n, share: round(rated / all, 2) };
}

/** The most a ratings reading scores at Illinois, under the Excellent list's 0.7 (recent terms) and 0.85 (teaching it now). */
export const ILLINOIS_TEACHING_FILL_CAP = 0.6;

/** Georgia Tech has no ratings file (school-config.ts ratings false): its teaching reads as unknown, never as another school's. */
const FILES: Partial<Record<SchoolKey, string>> = { uga: '/uga/course-teaching.json', illinois: '/illinois/course-teaching-ratings.json' };
const pending = new Map<string, Promise<Map<string, RatedTeaching> | null>>();

/** The readings by course code, once per page; null when the file is missing (teaching then reads as before). */
export function loadCourseTeaching(school: SchoolKey): Promise<Map<string, RatedTeaching> | null> {
  const url = FILES[school];
  if (!url) return Promise.resolve(null);
  let p = pending.get(school);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<CourseTeachingFile>) : null))
      .then((file) => (file ? courseTeachingMap(file) : null))
      .catch(() => null);
    pending.set(school, p);
  }
  return p;
}

/** The file's rows as the planner reads them (PlanningContext.teachingRatings). */
export function courseTeachingMap(file: Pick<CourseTeachingFile, 'courses'>): Map<string, RatedTeaching> {
  return new Map(Object.entries(file.courses));
}

/**
 * The sentence a card and the bots print, or null. Only for a clear,
 * well-founded reading: an average of 4.0 or more across 20 or more ratings
 * and a bonus of at least 0.2. A course under that still scores its bonus,
 * it just says nothing.
 */
export function ratedTeachingReason(x: RatedTeaching | undefined | null): string | null {
  if (!x || x.r < 4 || x.n < 20 || x.v < 0.2) return null;
  return `students rate the instructors on the ${x.t} schedule highly (${x.r.toFixed(1)} of 5 across ${x.n} ratings)`;
}

/**
 * The line course_details and search results carry for a course's reading,
 * for the bots: what students rate the instructors on its schedule, that it
 * is an estimate, and that the planner uses it only as a bonus. Never a
 * professor's name or where the ratings come from (professor_ratings gives
 * a named professor's numbers).
 */
export function describeRatedTeaching(x: RatedTeaching | undefined | null): string | null {
  if (!x) return null;
  const part = x.share < 1 ? `, and rated instructors teach ${Math.round(x.share * 100)}% of its sections` : '';
  return `Students rate the instructors on the ${x.t} schedule ${x.r.toFixed(1)} of 5 on average across ${x.n} ratings${part}. Self-selected student ratings, an estimate: the planner's teaching priority counts them only as a bonus for a course rated above typical, never against one.`;
}
