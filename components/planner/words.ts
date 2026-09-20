/**
 * Small pieces of English the whole planner has to get right.
 *
 * Here rather than repeated inline because it was repeated inline and the
 * copies disagreed. Three surfaces hardcoded the plural "courses" and so read
 * "1 courses from this list, 0 courses in the plan" on the 63 Illinois
 * requirement lists that ask for exactly one course, eleven times over in a
 * single Civil Engineering popover, and "21 students across 1 sections" on
 * 535 course pages.
 */

/** "1 course", "2 courses". Pass `many` for a word that is not just word + s. */
export function plural(n: number, word: string, many?: string): string {
  return n === 1 ? word : (many ?? `${word}s`);
}
