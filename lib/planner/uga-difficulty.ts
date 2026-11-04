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

let pending: Promise<UgaDifficultyFile | null> | null = null;

/** The file, once per page; null when it is missing (the planner runs as before, with no UGA difficulty). */
export function loadUgaDifficulty(): Promise<UgaDifficultyFile | null> {
  pending ??= fetch('/uga/course-difficulty.json')
    .then((r) => (r.ok ? (r.json() as Promise<UgaDifficultyFile>) : null))
    .catch(() => null);
  return pending;
}

/** The scores as the planner's grade rows: difficulty only, no grade history. */
export function ugaGrades(file: UgaDifficultyFile, titleOf: (code: string) => string): Map<string, GradeRow> {
  const out = new Map<string, GradeRow>();
  for (const [code, c] of Object.entries(file.courses)) {
    out.set(code, { code, title: titleOf(code), n: c.n, sections: c.profs, gpa: null, aPct: null, dfPct: null, withdrawPct: null, difficulty: c.d, instructors: [] });
  }
  return out;
}
