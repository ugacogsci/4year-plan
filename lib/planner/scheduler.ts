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

export interface RequirementGroup {
  label: string;
  choose: number | null;
  courses: Array<{ code: string; title: string; credits: number }>;
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
 * A course counts once, against the first area that wants it. Without that a
 * single course satisfying two areas inflates a student's progress twice and
 * the plan says they are finished when they are not.
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
): Array<{ area: RequirementArea; earned: number; percent: number; satisfied: boolean }> {
  const spent = new Set<string>();
  return program.areas.map((area) => {
    let earned = 0;
    for (const group of area.groups) {
      for (const c of group.courses) {
        if (!haveCodes.has(c.code) || spent.has(c.code)) continue;
        spent.add(c.code);
        earned += c.credits;
      }
    }
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
