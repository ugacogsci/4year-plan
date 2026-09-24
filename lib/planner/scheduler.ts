import type { Course, PlanState } from './types';

/**
 * The data the scheduler actually plans against.
 *
 * Four inputs, each from a different source, which is why this file exists
 * rather than the logic living in a component:
 *
 *   requirements  bulletin.uga.edu/Program/Details      what the degree needs
 *   prerequisites bulletin.uga.edu/Course/Details       what order it goes in
 *   difficulty    each registrar, via TRU               how heavy a term is
 *   prior credit  reg.uga.edu credit-from-testing       where the student starts
 *
 * Everything here is deterministic. An LLM can explain a plan or read a
 * student's description of their situation, but it does not decide whether
 * somebody graduates, which is the boundary the project README draws.
 */

/** One row of a requirement group, with the alternatives the catalog prints for it. */
export interface RequirementRow {
  code: string;
  title: string;
  credits: number;
  /**
   * The rest of "CS 210 or CS 211", each with its own catalog credit hours.
   *
   * The row used to carry only the first code. Computer Science's Orientation
   * and Professional Development area then read 1 of 3 hours for a student with
   * CS 211 on the board, because the area only knew about CS 210, and the
   * degree page says either one. A student reading that adds a second course
   * they do not need. The hours are per alternative because CS 210 is two
   * credits and CS 211 is three.
   */
  alternatives?: Array<{ code: string; credits: number }>;
}

export interface RequirementGroup {
  label: string;
  choose: number | null;
  courses: RequirementRow[];
  /**
   * The most this group can contribute, in whichever unit the catalog published.
   *
   * Illinois sizes "Humanities & the Arts" in hours and "Cultural Studies:
   * Non-Western Cultures" in courses, and neither number can be converted into
   * the other without inventing what a course is worth. Null on either half
   * means the catalog published no number of that kind, and an uncapped group
   * is still bounded by the area total the way it always was.
   */
  cap?: { hours: number | null; courses: number | null } | null;
  /**
   * True when membership comes from a campus-wide category rather than a list
   * the degree page prints.
   *
   * A general education category accepts hundreds of courses, and Illinois
   * prints general education first on every degree page. Without this flag the
   * gen-ed area claims PHYS 211 before the science area that actually requires
   * it, and the science bar loses a course it was counting. areaProgress runs
   * every printed list first and these second because of it.
   */
  broad?: boolean;
}

export interface RequirementArea {
  label: string;
  hours: number;
  groups: RequirementGroup[];
}

export interface ProgramRequirements {
  id: string;
  college: string;
  degree: string;
  name: string;
  areas: RequirementArea[];
  totalCredits: number | null;
  areaHours: number;
}

export interface GradeRow {
  code: string;
  title: string;
  n: number;
  sections: number;
  gpa: number | null;
  aPct: number | null;
  dfPct: number | null;
  withdrawPct: number | null;
  difficulty: number | null;
  instructors: Array<{ name: string; sections: number; gpa: number; aPct: number; withdrawPct: number }>;
}

/** Undergraduate degrees only; a four-year planner has no use for an MPACC. */
// UGA's codes plus the ones Illinois actually uses. BSLAS is the College of
// Liberal Arts and Sciences degree and covers a large share of Illinois
// undergraduates, so leaving it out hid most of the catalog.
const UNDERGRAD = /^(AB|BA|BS|BBA|BSED|BFA|BSA|BSES|BSFCS|BSW|BMUS|BSCHE|BSBE|BSAE|BLA|BSLAS|BSN|BARCH|BSBA|BSE)$/i;

export function undergraduatePrograms(all: ProgramRequirements[]): ProgramRequirements[] {
  return all
    .filter((p) => p.areas.length > 0 && UNDERGRAD.test(p.degree))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Hours a student has actually banked, from completed courses plus exam credit. */
export function earnedCredits(
  plan: PlanState,
  catalog: Map<string, Course>,
  examCredits: number,
): number {
  const fromCourses = plan.completedCourseIds.reduce(
    (sum, id) => sum + (catalog.get(id)?.credits ?? 0),
    0,
  );
  return fromCourses + examCredits;
}

/**
 * Progress per requirement area.
 *
 * A course counts once. Without that a single course satisfying two areas
 * inflates a student's progress twice and the plan says they are finished when
 * they are not.
 *
 * Which area gets it goes in two passes. Every list a degree page prints is
 * matched first, in page order, and only then the campus general education
 * categories, which accept hundreds of courses each. The other way round the
 * gen-ed area, printed first on every Illinois degree, takes PHYS 211 off the
 * science area that names it.
 *
 * The general education categories in autoplan follow the same rule for hours
 * and a looser one for categories, because Illinois publishes the exception:
 * one course may satisfy a Cultural Studies category and another category at
 * the same time, but never two Cultural Studies categories. Its credits are
 * still counted once, which is the part this function is about.
 */
export function areaProgress(
  program: ProgramRequirements,
  haveCodes: Set<string>,
  /**
   * Cross-listing classes by code, where the caller has them.
   *
   * GER 261 and JS 261 are one class under two codes. A caller that expands
   * aliases into `haveCodes`, which the ask bar does so that a requirement
   * written as one code is met by the other, then has the same class in the set
   * twice, and counting it twice put nine hours on a Computer Science student's
   * general education row that they were not taking. Spending one code spends
   * the whole class. Optional because a caller with no alias map has no
   * duplicates to collapse.
   */
  equivalents?: Map<string, string[]>,
  options?: {
    /** UGA permits a course to satisfy a Core area and a major-related area. */
    allowCrossAreaOverlap?: boolean;
  },
): Array<{ area: RequirementArea; earned: number; percent: number; satisfied: boolean }> {
  const spend = (code: string, spent: Set<string>): void => {
    spent.add(code);
    for (const alias of equivalents?.get(code) ?? []) spent.add(alias);
  };
  const earnedBy = program.areas.map(() => 0);

  /** The held course that fills one row, honouring "CS 210 or CS 211". */
  const rowMatch = (
    row: RequirementRow,
    spent: Set<string>,
  ): { code: string; credits: number } | null => {
    if (haveCodes.has(row.code) && !spent.has(row.code)) {
      return { code: row.code, credits: row.credits };
    }
    for (const alt of row.alternatives ?? []) {
      if (haveCodes.has(alt.code) && !spent.has(alt.code)) return alt;
    }
    return null;
  };

  /**
   * What one group earns, never more than the size the catalog published for it.
   *
   * Cheapest match first, so a category the catalog sizes at one course counts
   * the one claiming the fewest hours. That can understate a student's progress
   * and can never overstate it, which is the only safe direction when the
   * number is read as how close somebody is to graduating.
   */
  const earnOf = (group: RequirementGroup, spent: Set<string>): number => {
    const hits: Array<{ code: string; credits: number }> = [];
    for (const row of group.courses) {
      const hit = rowMatch(row, spent);
      if (hit) hits.push(hit);
    }
    hits.sort((a, b) => a.credits - b.credits || a.code.localeCompare(b.code));

    const hoursCap = group.cap?.hours ?? null;
    const countCap = group.cap?.courses ?? null;
    let earned = 0;
    let taken = 0;
    for (const hit of hits) {
      if (countCap !== null && taken >= countCap) break;
      if (hoursCap !== null && earned >= hoursCap) break;
      // A later row in this same group can hold the other half of a
      // cross-listing, so the check has to run again here.
      if (spent.has(hit.code)) continue;
      spend(hit.code, spent);
      earned += hit.credits;
      taken += 1;
    }
    return hoursCap === null ? earned : Math.min(earned, hoursCap);
  };

  // Printed lists first, campus categories second. See RequirementGroup.broad
  // for the course this ordering stops the gen-ed area from taking.
  if (options?.allowCrossAreaOverlap) {
    program.areas.forEach((area, index) => {
      const spent = new Set<string>();
      for (const broadPass of [false, true]) {
        for (const group of area.groups) {
          if ((group.broad ?? false) !== broadPass) continue;
          earnedBy[index] += earnOf(group, spent);
        }
      }
    });
  } else {
    const spent = new Set<string>();
    for (const broadPass of [false, true]) {
      program.areas.forEach((area, index) => {
      for (const group of area.groups) {
        if ((group.broad ?? false) !== broadPass) continue;
        earnedBy[index] += earnOf(group, spent);
      }
      });
    }
  }

  return program.areas.map((area, index) => {
    const earned = earnedBy[index];
    const capped = Math.min(earned, area.hours || earned);
    return {
      area,
      earned: capped,
      percent: area.hours ? Math.round((capped / area.hours) * 100) : 0,
      satisfied: area.hours > 0 && capped >= area.hours,
    };
  });
}

/**
 * How heavy a term is, using real grade history rather than credit count.
 *
 * Fifteen credits of a 3.6-average load and fifteen credits of MATH 2250 plus
 * organic chemistry are the same number and nothing like the same semester.
 * This is the single most useful thing the grade data buys a planner.
 */
export function termLoad(
  courseCodes: string[],
  grades: Map<string, GradeRow>,
  opts?: {
    /** Per-school difficulty cutoffs. UGA's absolute 65/72/58/32 labelled every
     *  Illinois term 'light', because the two registrars grade on different
     *  curves and a raw difficulty number does not transfer between them. */
    bands?: { typical: number; harder: number; hardest: number };
    /** Real credit hours by course code. Without it a term is counted at three
     *  hours a course, which is wrong for every lab, seminar and 4-hour core. */
    creditsByCode?: Map<string, number>;
  },
): {
  credits: number;
  avgDifficulty: number | null;
  hard: string[];
  /** How many of the term's courses had a grade row at all. A verdict drawn
   *  from one course out of five is not a verdict, and the caller needs to see that. */
  weighed: number;
  verdict: 'light' | 'normal' | 'heavy' | 'brutal';
} {
  const rows = courseCodes.map((c) => grades.get(c)).filter(Boolean) as GradeRow[];
  const scored = rows.filter((r) => r.difficulty !== null);
  const credits = opts?.creditsByCode
    ? courseCodes.reduce((sum, c) => sum + (opts.creditsByCode?.get(c) ?? 3), 0)
    : courseCodes.length * 3;

  if (!scored.length) return { credits, avgDifficulty: null, hard: [], weighed: 0, verdict: 'normal' };

  const b = opts?.bands ?? { typical: 32, harder: 58, hardest: 65 };
  const avg = Math.round(scored.reduce((s, r) => s + (r.difficulty ?? 0), 0) / scored.length);
  const hard = scored.filter((r) => (r.difficulty ?? 0) >= b.hardest).map((r) => r.code);

  // Three genuinely hard courses in one term is the shape that breaks people,
  // and it is invisible if you only count credit hours.
  const verdict = hard.length >= 3 || avg >= b.hardest + 7 ? 'brutal'
    : hard.length === 2 || avg >= b.harder ? 'heavy'
    : avg <= b.typical ? 'light'
    : 'normal';

  return { credits, avgDifficulty: avg, hard, weighed: scored.length, verdict };
}

/** Prerequisites not yet satisfied by the time a term starts. */
export function missingPrerequisites(
  course: Course,
  satisfied: Set<string>,
): string[] {
  if (!course.prerequisites?.length) return [];
  // Bulletin prerequisites are alternatives far more often than conjunctions
  // ("CSCI 1301 or CSCI 1301E"), so one match clears the requirement.
  return course.prerequisites.some((p) => satisfied.has(p)) ? [] : course.prerequisites;
}

/** A course offered only in spring, placed in a fall term, is a silent error. */
export function offeringConflicts(
  courses: Course[],
  season: 'Fall' | 'Spring',
): string[] {
  return courses.filter((c) => c.offeredIn?.length && !c.offeredIn.includes(season)).map((c) => c.code);
}
