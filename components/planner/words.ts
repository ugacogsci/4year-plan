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

/** "CMN 336", "CMN 336 and ACE 240", "CMN 336, ACE 240 and PSYC 100". */
export function andList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
