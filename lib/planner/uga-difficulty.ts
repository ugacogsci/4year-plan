/**
 * UGA course difficulty, 0 to 100, for the planner's term loads, hard-course
 * spreading and lighter picks (the GradeRow.difficulty Illinois takes from
 * its grade history). UGA publishes no grade history; these come from the
 * student ratings of the professors who teach each course, by the formula in
 * scripts/difficulty/uga-difficulty.mjs (public/uga/course-difficulty.json).
 * The bands are UGA's own: the same percentiles of its scores that Illinois's
 * bands are of Illinois's.
 */
import type { PlanDifficultyBands } from './autoplan';
import type { GradeRow } from './scheduler';

export interface UgaDifficultyFile {
  school: 'uga';
  builtAt: string;
  method: string;
  bands: PlanDifficultyBands;
  /** Per course code: the score, the ratings behind it, and how many professors. */
  courses: Record<string, { d: number; n: number; profs: number }>;
}

/**
 * Whether the scores reach plans: since 2026-11-05 only through the engine's
 * difficulty gate (plan-estimates.ts, autoplan.ts difficultyGated), which
 * keeps a board built with them only where it costs nothing against the
 * board built without them.
 */
export { UGA_DIFFICULTY_IN_PLANS } from './plan-estimates';

let pending: Promise<UgaDifficultyFile | null> | null = null;

/** The file, once per page; null when it is missing (the planner runs as before, with no UGA difficulty). */
export function loadUgaDifficulty(): Promise<UgaDifficultyFile | null> {
  pending ??= fetch('/uga/course-difficulty.json')
    .then((r) => (r.ok ? (r.json() as Promise<UgaDifficultyFile>) : null))
    .catch(() => null);
  return pending;
}

/**
 * The scores as the planner's grade rows: difficulty only, no grade history.
 *
 * A course's online (E) or honors (H) twin with no score of its own takes the
 * base course's, when `codes` names it: the same course with the same
 * instructors more often than not. Without it, an unscored course is weighed
 * at the harder band, and MATH 1113E (no score) outranked MATH 1113 (57) as
 * the lighter pick on most science boards (2026-11-05).
 */
export function ugaGrades(file: UgaDifficultyFile, titleOf: (code: string) => string, codes: Iterable<string> = []): Map<string, GradeRow> {
  const out = new Map<string, GradeRow>();
  for (const [code, c] of Object.entries(file.courses)) {
    out.set(code, { code, title: titleOf(code), n: c.n, sections: c.profs, gpa: null, aPct: null, dfPct: null, withdrawPct: null, difficulty: c.d, instructors: [] });
  }
  for (const code of codes) {
    const base = /^(\S+ \d{4})[EH]$/.exec(code)?.[1];
    const c = base && !out.has(code) ? file.courses[base] : undefined;
    if (c) out.set(code, { code, title: titleOf(code), n: c.n, sections: c.profs, gpa: null, aPct: null, dfPct: null, withdrawPct: null, difficulty: c.d, instructors: [] });
  }
  return out;
}
