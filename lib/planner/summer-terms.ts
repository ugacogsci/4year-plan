/**
 * Summers on the board, added and taken off by hand.
 *
 * A summer column used to come only from the setup words ("I'll take summer
 * classes") or a summer finish. A student who decided later had no button
 * for one, ARCH could not add one at all, and ALMA could add one only by
 * moving a course into it, which the next Rebuild forgot. These functions
 * are the one implementation behind the board's "Add a summer" menu, the
 * column's remove button and the assistants' add_summer and remove_summer
 * tools, at both schools:
 *
 *   - adding puts an empty column in calendar order and moves nothing else;
 *   - the year goes into the plan shape as well, so reload, saving and
 *     Rebuild keep the summer (Rebuild at Illinois may fill it from the
 *     summer offering history; UGA's catalog lists no summer offerings yet,
 *     so there it stays empty);
 *   - removing takes the column and whatever is in it off the board, and
 *     records the year as dropped, so a summer the setup words asked for does
 *     not come back on Rebuild.
 *
 * Nothing here asks the student anything. The callers do: the column asks
 * before removing a summer that holds classes, and remove_summer needs
 * confirmed after ALMA or ARCH has named them.
 */
import { withSummer } from './review';
import type { PlanShape } from './saved-board';
import type { PlanState, PlanTerm, SemesterSeason } from './types';

const calendarOrd = (season: SemesterSeason, year: number): number => year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
const yearOf = (term: PlanTerm): number | null => {
  const m = term.label.match(/\b(20\d\d)\b/) ?? term.id.match(/\b(20\d\d)\b/);
  return m ? Number(m[1]) : null;
};

export const summerLabel = (year: number): string => `Summer ${year}`;

/** A summer as the student or an assistant names it: "Summer 2027", "summer of 2027", "2027" or 2027. Null for anything else. */
export function summerYearOf(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  const m = text.match(/^(?:summer\s+(?:of\s+)?)?(20\d\d)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * The summers a build plans: the ones the About-you words asked for, and the
 * ones added since (set_plan_shape, the Add a summer menu, add_summer), less
 * the ones the student took off the board. horizonFor in the workspace reads
 * them through this, so a summer removed by hand stays off on Rebuild.
 */
export function summersFor(said: number[], shape: PlanShape): number[] {
  const dropped = shape.droppedSummers ?? [];
  return [...new Set([...said, ...shape.summers])].filter((y) => !dropped.includes(y));
}

/** The board's summer column for a year, or null. */
export function summerOn(board: PlanState, year: number): PlanTerm | null {
  return board.terms.find((t) => t.season === 'Summer' && yearOf(t) === year) ?? null;
}

/**
 * The summers a student can add, earliest first: each one after the board's
 * first term and before its last that is not on the board yet. A summer
 * before the plan starts or after it ends would be a term outside the plan.
 */
export function summersToAdd(board: PlanState): number[] {
  const ords = board.terms.flatMap((t) => {
    const y = yearOf(t);
    return y === null ? [] : [calendarOrd(t.season, y)];
  });
  if (ords.length < 2) return [];
  const first = Math.min(...ords);
  const last = Math.max(...ords);
  const out: number[] = [];
  for (let y = Math.floor(first / 3); y <= Math.floor(last / 3); y += 1) {
    const at = calendarOrd('Summer', y);
    if (at > first && at < last && !summerOn(board, y)) out.push(y);
  }
  return out;
}

/**
 * The board a build made, with every summer the student added (the plan
 * shape's summers, less the dropped) that it has no column for put back,
 * empty, in calendar order. A build plans each summer inside its horizon, but
 * a Double Dawgs board is two builds: the bachelor's, which ends at its last
 * term with a class, and the master's from the fall or spring after its
 * finish. Summer 2031 between a Spring 2031 finish and a Fall 2031 master's
 * start was in neither (nor an empty Summer 2031 finish), so Rebuild dropped
 * the summer the menu had offered and added while the shape still listed it.
 * Only a summer the menu would offer goes back; the same board when none is
 * missing, which is every board but those.
 */
export function withAddedSummers(board: PlanState, shape: PlanShape): PlanState {
  let out = board;
  for (const year of [...summersFor([], shape)].sort((a, b) => a - b)) {
    if (!summersToAdd(out).includes(year)) continue;
    const placed = withSummer(out, year);
    if (placed) out = placed.board;
  }
  return out;
}

/** A summer column a student can take off: not the plan's first or last term, which the start and the finish decide. */
export function summerRemovable(board: PlanState, termId: string): boolean {
  const at = board.terms.findIndex((t) => t.id === termId);
  return at > 0 && at < board.terms.length - 1 && board.terms[at].season === 'Summer';
}

export type SummerChange =
  | {
      ok: true;
      board: PlanState;
      shape: PlanShape;
      /** The summer added, or the one taken off. */
      term: PlanTerm;
      /** Courses that came off the board with a removed summer, in its order. */
      removedCourseIds: string[];
    }
  | { ok: false; reason: string };

/** An empty Summer `year` on the board, in calendar order, and in the plan shape. Nothing else moves. */
export function addSummer(board: PlanState, shape: PlanShape, year: number): SummerChange {
  const label = summerLabel(year);
  if (summerOn(board, year)) return { ok: false, reason: `${label} is already on the board.` };
  const placed = summersToAdd(board).includes(year) ? withSummer(board, year) : null;
  const term = placed?.board.terms.find((t) => t.id === placed.termId);
  if (!placed || !term) {
    const first = board.terms[0]?.label ?? 'its first term';
    const last = board.terms[board.terms.length - 1]?.label ?? 'its last term';
    return { ok: false, reason: `${label} is outside this plan, which runs ${first} to ${last}; a summer can go only between its first and last terms.` };
  }
  return {
    ok: true,
    board: placed.board,
    term,
    removedCourseIds: [],
    shape: {
      ...shape,
      summers: shape.summers.includes(year) ? shape.summers : [...shape.summers, year],
      droppedSummers: (shape.droppedSummers ?? []).filter((y) => y !== year),
    },
  };
}

/**
 * Summer `year` off the board with everything in it, and off the plan shape,
 * remembered as dropped so the setup words cannot bring it back on Rebuild.
 * The instructor choices for that column go with it.
 */
export function removeSummer(board: PlanState, shape: PlanShape, year: number): SummerChange {
  const label = summerLabel(year);
  const term = summerOn(board, year);
  if (!term) {
    const on = board.terms.filter((t) => t.season === 'Summer').map((t) => t.label);
    return { ok: false, reason: `No ${label} is on the board${on.length > 0 ? `; the summers on it are ${on.join(', ')}` : '; it has no summers'}.` };
  }
  if (!summerRemovable(board, term.id)) {
    const finish = board.terms[board.terms.length - 1]?.id === term.id;
    return {
      ok: false,
      reason: finish
        ? `${label} is the plan's last term, its finish, so it cannot be taken off on its own; the finish has to change first.`
        : `${label} is the plan's first term, where it starts, so it cannot be taken off on its own.`,
    };
  }
  const instructors = board.instructors ? Object.fromEntries(Object.entries(board.instructors).filter(([id]) => id !== term.id)) : undefined;
  return {
    ok: true,
    board: { ...board, terms: board.terms.filter((t) => t.id !== term.id), ...(instructors ? { instructors } : {}) },
    term,
    removedCourseIds: [...term.courseIds],
    shape: {
      ...shape,
      summers: shape.summers.filter((y) => y !== year),
      droppedSummers: [...new Set([...(shape.droppedSummers ?? []), year])],
    },
  };
}
