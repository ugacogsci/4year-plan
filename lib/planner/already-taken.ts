/**
 * The rail's "Already taken": the classes a student holds, each once, the
 * finished ones apart from the ones in progress.
 *
 * It counted every held course id (planner-workspace.tsx priorCount was
 * plan.completedCourseIds.length). A UGA Biology BS student who added six
 * classes to the Fall 2026 column read "Already taken 12 courses" above a list
 * of six, because each class came with its equivalent codes (BIOL 1107 with
 * BIOL 1107E, ENGL 1101 with ENGL 1101E and 1101S), and classes not yet passed
 * were listed as taken. The list was already one per class; the count is now
 * the list, and a class in progress is listed under its own line.
 *
 * Plans are not touched here: held courses count toward the degree as before.
 */
import { distinctHeld, normaliseCode, type PlanningContext } from './autoplan';
import { transcriptInProgressCodes, type TranscriptRecord } from './transcript';

export interface HeldCourse {
  code: string;
  title: string;
}

export function alreadyTaken(
  heldCodes: readonly string[],
  context: Pick<PlanningContext, 'courses' | 'equivalents' | 'exclusions'> | null,
  catalog: ReadonlyMap<string, { code: string; title: string }>,
  record: TranscriptRecord | null | undefined,
): { taken: HeldCourse[]; takingNow: HeldCourse[] } {
  const unique = context ? distinctHeld([...heldCodes], context).codes : [...heldCodes];
  const twins = (code: string) => [normaliseCode(code), ...(context?.equivalents?.get(normaliseCode(code)) ?? []).map(normaliseCode)];
  const pending = new Set(transcriptInProgressCodes(record).flatMap(twins));
  const taken: HeldCourse[] = [];
  const takingNow: HeldCourse[] = [];
  for (const code of unique) {
    const course = catalog.get(normaliseCode(code));
    if (!course) continue;
    (twins(code).some((c) => pending.has(c)) ? takingNow : taken).push({ code: course.code, title: course.title });
  }
  return { taken, takingNow };
}
