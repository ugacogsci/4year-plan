import type { SemesterSeason } from './types';

/**
 * Whether a course runs in a given summer, and UGA's catalog seasons in the
 * planner's shape.
 *
 * A course runs in a summer when its seasons list Summer. Most do every
 * summer; the UGA Bulletin lists 54 courses as "Offered summer semester every
 * odd-numbered year" (33) or "every even-numbered year" (21), and those carry
 * summerYears. Illinois's seasons come from its offering history and never
 * carry summerYears, so nothing here changes an Illinois board.
 *
 * No imports beyond types, so the engine (autoplan.ts) and the UGA loader can
 * share it without a cycle.
 */

/** "Offered summer semester every odd-numbered year": the summers a course runs in when it is not every summer. */
export type SummerYears = 'odd' | 'even';

/** The calendar year in a term's label or id ("Summer 2027", "summer-2027"), or null. */
export function calendarYearOf(term: { label?: string; id?: string }): number | null {
  const m = (term.label ?? '').match(/\b(20\d\d)\b/) ?? (term.id ?? '').match(/\b(20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Whether the course runs in the summer of `year`. A course offered every
 * other summer runs only in its years; when the year is not known, it is not
 * counted on, so the planner never books one into the wrong summer.
 */
export function runsInSummer(course: { offeredIn: SemesterSeason[]; summerYears?: SummerYears }, year: number | null): boolean {
  if (!course.offeredIn.includes('Summer')) return false;
  if (!course.summerYears) return true;
  if (year === null || !Number.isFinite(year)) return false;
  return (Math.abs(year) % 2 === 1) === (course.summerYears === 'odd');
}

/**
 * The seasons a UGA catalog row gives the planner, and whether its fall and
 * spring are verified.
 *
 * public/uga-catalog.json lists the seasons the Bulletin's "Semester Course
 * Offered" line names, Summer included, and [] for a row naming none
 * (scripts/apply-uga-offered.mjs; before 2026-10-22 such a row read
 * ["Fall","Spring"]). Fall and spring read exactly as they did before
 * summers were listed: a row naming one of them is verified for it; a row
 * naming both, or neither (summer only, or no season at all), gets the
 * long-standing fall and spring default, unverified, so a fall or spring plan
 * cannot move. Summer is added only where the Bulletin names it, so a row
 * naming no season is never booked into a summer.
 */
export function ugaPlannerSeasons(listed: readonly SemesterSeason[] | undefined): { offeredIn: SemesterSeason[]; offeringKnown: boolean } {
  const named = (listed ?? []).filter((season) => season === 'Fall' || season === 'Spring');
  const regular: SemesterSeason[] = named.length > 0 ? [...new Set(named)] : ['Fall', 'Spring'];
  const summer = (listed ?? []).includes('Summer');
  return {
    offeredIn: summer ? [...regular, 'Summer'] : regular,
    offeringKnown: regular.length === 1,
  };
}

/** A course's fall and spring seasons alone, for counting how many regular terms it runs in. */
export function regularSeasons(offeredIn: readonly SemesterSeason[]): SemesterSeason[] {
  return offeredIn.filter((season) => season !== 'Summer');
}

/**
 * What the UGA Bulletin's offering line says about a course, in a sentence,
 * for the course panel and ARCH's course facts: "The UGA Bulletin lists it
 * for fall and summer." `offeringListed` is the line's own seasons
 * (Course.offeringListed), not the planner's default beside them.
 */
export function ugaOfferingLine(course: { offeringListed?: readonly SemesterSeason[]; summerYears?: SummerYears }): string {
  const listed = course.offeringListed ?? [];
  if (listed.length === 0) return 'The UGA Bulletin names no term for it: the planner books it in a fall or spring term, never in a summer.';
  const names = listed.map((season) => (season === 'Summer' && course.summerYears ? `summer in ${course.summerYears}-numbered years` : season.toLowerCase()));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `The UGA Bulletin lists it for ${list}${names.length === 1 && !course.summerYears ? ' only' : ''}.`;
}
