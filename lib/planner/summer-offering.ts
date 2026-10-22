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
 * long-standing fall and spring default, unverified. Summer is added only
 * where the Bulletin names it, so a row naming no season is never booked into
 * a summer. A row naming summer alone keeps the default here (a class a
 * student placed in a fall stays there, with its warning), but the planner's
 * own picks leave it out of falls and springs (summerOnlyListed).
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

/**
 * Whether the catalog's own offering line lists the course for summer alone
 * (Course.offeringListed is ["Summer"]): 572 UGA courses, ARHI 2121
 * Introduction to Italian Art among them. ugaPlannerSeasons still gives them
 * an unverified fall and spring, so a board a student made keeps them where
 * they put them, but since 2026-10-22 the planner's own picks treat them as
 * out of season in a fall or spring (autoplan.ts outOfSeason, repick.ts), as
 * the owner decided: ARHI 2121 was the Humanities pick on 105 of 161 UGA
 * freshman boards, and each one was then flagged "Not offered this term".
 * Illinois rows carry no offering line, so nothing here touches Illinois.
 */
export function summerOnlyListed(course: { offeringListed?: readonly SemesterSeason[] } | undefined): boolean {
  const listed = course?.offeringListed ?? [];
  return listed.length > 0 && listed.every((season) => season === 'Summer');
}

/** The card's words for a course the UGA Bulletin lists for summer only, in a fall or spring term. */
export function ugaSummerOnlyMessage(course: { code: string; summerYears?: SummerYears }, termLabel: string): string {
  return `The UGA Bulletin lists ${course.code} for summer only${course.summerYears ? `, in ${course.summerYears}-numbered years` : ''}, so it may not run in ${termLabel}. Check UGA's schedule before keeping it here, or take it in a summer.`;
}

/**
 * The first summer a course could run once the courses it needs are done, as
 * a board holds them: the summer after the last of its prerequisite groups is
 * met (a held course meets one at once; a summer course meets one for the
 * next summer, not its own), in a year it runs. Null where a group names no
 * course the board holds or books, so the board cannot tell. The year it
 * names may lie past the board's last term: Art BFA - Interior Design's ARID
 * 4010 needs ARID 3125, which needs ARID 3110 and ARID 2110, each a fall
 * course, so a freshman starting in Spring 2027 has it ready for Summer 2030,
 * after a Spring 2030 finish (2026-10-22).
 */
export function firstSummerFor(
  course: { offeredIn: SemesterSeason[]; summerYears?: SummerYears },
  groups: ReadonlyArray<{ any: readonly string[]; concurrent?: boolean; priorLearning?: unknown }>,
  terms: ReadonlyArray<{ season: SemesterSeason; label?: string; id?: string; codes: readonly string[] }>,
  held: ReadonlySet<string>,
): { year: number; after: { code: string; label: string } | null } | null {
  const ord = (season: SemesterSeason, year: number) => year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
  const dated = terms.flatMap((t) => {
    const year = calendarYearOf(t);
    return year === null ? [] : [{ ...t, year, at: ord(t.season, year) }];
  });
  if (dated.length === 0) return null;
  // Not before the board's first term.
  let ready = Math.min(...dated.map((t) => t.at)) - 1;
  let after: { code: string; label: string } | null = null;
  for (const group of groups) {
    if (group.concurrent || group.priorLearning) continue;
    const names = group.any.map((c) => c.replace(/\s+/g, ' ').trim().toUpperCase());
    if (names.some((c) => held.has(c))) continue;
    const at = dated.filter((t) => t.codes.some((c) => names.includes(c.replace(/\s+/g, ' ').trim().toUpperCase()))).sort((a, b) => a.at - b.at)[0];
    if (!at) return null;
    if (at.at > ready) {
      ready = at.at;
      after = { code: at.codes.find((c) => names.includes(c.replace(/\s+/g, ' ').trim().toUpperCase())) ?? names[0], label: at.label ?? `${at.season} ${at.year}` };
    }
  }
  for (let year = Math.floor(ready / 3); year <= Math.floor(ready / 3) + 3; year += 1) {
    if (ord('Summer', year) > ready && runsInSummer(course, year)) return { year, after };
  }
  return null;
}

/**
 * Where the first summer a required summer-only course can run lies against
 * the board (firstSummerFor): inside the plan and on the board, inside it but
 * not yet added, or past its last term, where Add a summer cannot reach.
 */
export interface RequiredSummer {
  year: number;
  /** The prerequisite on the board that comes last, and its term. */
  after: { code: string; label: string } | null;
  onBoard: boolean;
  /** Past the board's last term: Add a summer offers only summers inside the plan. */
  pastLast: boolean;
  lastLabel: string;
}

/**
 * The card's words when the degree itself requires such a course and offers
 * no other choice for it. The planner keeps it on the board, in a fall or
 * spring, so the degree stays whole (the degree beats everything), and says
 * plainly what to do: plan the summer it can run in, naming it where the
 * board shows which, or, where that summer lies past the plan's last term
 * and Add a summer cannot reach it, ask the advisor.
 */
export function ugaRequiredSummerOnlyMessage(course: { code: string; summerYears?: SummerYears }, termLabel: string, boardHasSummer: boolean, first: RequiredSummer | null = null): string {
  const years = course.summerYears ? ` in ${course.summerYears}-numbered years` : '';
  const head = `Your degree requires ${course.code}, and the UGA Bulletin lists it for summer only${years}.`;
  const sits = `it sits in ${termLabel} for now to keep the degree complete`;
  const since = first?.after ? ` (the first summer after ${first.after.code}, in ${first.after.label})` : '';
  if (first?.pastLast) {
    return `${head} ${first.after ? `Its prerequisites on this plan end with ${first.after.code} in ${first.after.label}, so the first summer it can run is Summer ${first.year}` : `The first summer it can run is Summer ${first.year}`}, after this plan's last term (${first.lastLabel}), where Add a summer cannot place it. It sits in ${termLabel} for now to keep the degree complete. Ask your advisor how to fit it in, and check UGA's summer schedule.`;
  }
  if (first?.onBoard) {
    return `${head} Summer ${first.year}${since} is on this plan but had no room for it, so ${sits}. Move it to Summer ${first.year} if you can make room there, and check UGA's summer schedule.`;
  }
  const plan = first ? `Summer ${first.year} for it${since}` : `${boardHasSummer ? 'a later summer' : 'a summer'} for it`;
  return boardHasSummer
    ? `${head} None of this plan's summers can take it yet, so ${sits}. Use Add a summer to plan ${plan}, and check UGA's summer schedule.`
    : `${head} This plan has no summer, so ${sits}. Use Add a summer to plan ${plan}, and check UGA's summer schedule.`;
}

/**
 * Where the first summer a course can run lies against a board's terms
 * (RequiredSummer), or null where the board cannot tell.
 */
export function requiredSummerOn(
  course: { offeredIn: SemesterSeason[]; summerYears?: SummerYears },
  groups: ReadonlyArray<{ any: readonly string[]; concurrent?: boolean; priorLearning?: unknown }>,
  terms: ReadonlyArray<{ season: SemesterSeason; label?: string; id?: string; codes: readonly string[] }>,
  held: ReadonlySet<string>,
): RequiredSummer | null {
  const first = firstSummerFor(course, groups, terms, held);
  if (!first) return null;
  const ord = (season: SemesterSeason, year: number) => year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
  const dated = terms.flatMap((t) => {
    const year = calendarYearOf(t);
    return year === null ? [] : [{ label: t.label ?? `${t.season} ${year}`, season: t.season, year, at: ord(t.season, year) }];
  });
  const last = dated.sort((a, b) => b.at - a.at)[0];
  return {
    year: first.year,
    after: first.after,
    onBoard: dated.some((t) => t.season === 'Summer' && t.year === first.year),
    pastLast: !last || ord('Summer', first.year) > last.at,
    lastLabel: last?.label ?? '',
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
