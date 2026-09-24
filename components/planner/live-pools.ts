/**
 * "Take 18 hours from this list", recounted against the board the student is
 * actually looking at.
 *
 * generatePlan reports every pool once, at the moment it builds the plan, and
 * that report is correct for exactly one board: the one it just generated. The
 * student then moves a course, deletes one, or clicks the pool panel's own
 * "Add CS 473 to Fall 2026" button, and the panel keeps printing the old
 * numbers. That was measured: the panel read "21 hours, 6 chosen", the verifier
 * used the panel's own Add button, the board took CS 473, which is on that
 * pool's list, and the panel still read "21 hours, 6 chosen". A count that does
 * not move when the thing it counts moves is worse than no count, because a
 * student reads it as the answer and stops looking.
 *
 * So the board is the source of truth here and the generated report is only the
 * shape: which pools exist, what each one asked for, and the catalog's own
 * sentences. Everything that depends on which courses are where is counted
 * again, every render, off the terms on screen.
 */

import { plural } from './words';
import { normaliseCode, planCreditRange } from '@/lib/planner/autoplan';
import type { PlanningContext, PoolReport, UnsatisfiedRequirement } from '@/lib/planner/autoplan';
import type { PoolConstraint, RequirementBlock } from '@/lib/planner/illinois-data';

/**
 * Which of a constraint's courses the board holds, and whether that is enough.
 *
 * A deliberate mirror of the same rule inside autoplan, which owns it and does
 * not export it. Both must agree, because the two numbers appear on the same
 * screen: autoplan's at generation, this one after the first edit. The rule is
 * the catalog's, not this planner's, and it has one subtlety worth keeping in
 * one place: when the sentence asks for n courses from a SINGLE list, the
 * answer is the fullest single list and never the union. Two courses from
 * Media and two from Machines satisfy nothing the Computer Science page asked
 * for, and adding them to four would show a plan as sound that an advisor will
 * send back.
 */
function constraintOnBoard(
  constraint: PoolConstraint,
  held: Set<string>,
  context: PlanningContext,
): {
  met: boolean;
  from: string | null;
  picked: string[];
  count: number;
  hoursTarget: number | null;
  hours: number;
} {
  const lists = constraint.lists.map((list) => ({
    label: list.label,
    codes: new Set(list.codes.map(normaliseCode)),
  }));
  if (lists.length === 0)
    return { met: true, from: null, picked: [], count: 0, hoursTarget: constraint.hours ?? null, hours: 0 };

  const hourCodes = new Set((constraint.hourCodes ?? []).map(normaliseCode));
  const hourCourses = [...held].filter((code) => hourCodes.has(code));
  const hours = planCreditRange(hourCourses, context).min;
  const hoursMet = constraint.hours === undefined || hours >= constraint.hours;

  if (constraint.distinctLists) {
    const matchedCourse = new Map<string, number>();
    const match = (listIndex: number, seen: Set<string>): boolean => {
      for (const code of [...held].sort()) {
        if (seen.has(code) || !lists[listIndex].codes.has(code)) continue;
        seen.add(code);
        const previous = matchedCourse.get(code);
        if (previous === undefined || match(previous, seen)) {
          matchedCourse.set(code, listIndex);
          return true;
        }
      }
      return false;
    };
    let count = 0;
    for (let index = 0; index < lists.length; index += 1) {
      if (match(index, new Set<string>())) count += 1;
    }
    return {
      met: count >= constraint.n && hoursMet,
      from: null,
      picked: [...matchedCourse.keys()].sort(),
      count,
      hoursTarget: constraint.hours ?? null,
      hours,
    };
  }

  if (constraint.single && lists.length > 1) {
    let best: { label: string; picked: string[] } = { label: lists[0].label, picked: [] };
    for (const list of lists) {
      const picked = [...held].filter((code) => list.codes.has(code)).sort();
      if (picked.length > best.picked.length) best = { label: list.label, picked };
    }
    return {
      met: best.picked.length >= constraint.n && hoursMet,
      from: best.picked.length > 0 ? best.label : null,
      picked: best.picked,
      count: best.picked.length,
      hoursTarget: constraint.hours ?? null,
      hours,
    };
  }

  const union = new Set(lists.flatMap((list) => [...list.codes]));
  const picked = [...held].filter((code) => union.has(code)).sort();
  return {
    met: picked.length >= constraint.n && hoursMet,
    from: lists.length === 1 ? lists[0].label : null,
    picked,
    count: picked.length,
    hoursTarget: constraint.hours ?? null,
    hours,
  };
}

function constraintProgress(constraint: {
  n: number;
  count: number;
  hoursTarget: number | null;
  hours: number;
}): string {
  const parts = [
    constraint.n > 0
      ? `${constraint.count} of ${constraint.n} required selections`
      : null,
    constraint.hoursTarget !== null
      ? `${constraint.hours} of ${constraint.hoursTarget} upper-division hours`
      : null,
  ].filter(Boolean);
  return `This plan has ${parts.join(' and ')}`;
}

/** Every code a pool's catalog list names, whether or not the snapshot has it. */
function membershipOf(pool: PoolReport, block: RequirementBlock | undefined): Set<string> {
  if (block && block.rule.kind === 'pool') {
    return new Set(block.rule.choices.flatMap((choice) => choice.codes.map(normaliseCode)));
  }
  /**
   * No block for this pool, which happens only if the degree is swapped while
   * a report is in flight. Falling back to the report's own three lists is
   * narrower than the catalog list, so a course could be missed, but nothing is
   * ever counted for a pool that does not list it. Wrong in the safe direction.
   */
  return new Set(
    [...pool.picked, ...pool.alternatives, ...pool.fromPriorCredit].map(normaliseCode),
  );
}

export interface LivePoolInput {
  /** The report generatePlan produced, for the pools' shape and their sentences. */
  base: PoolReport[];
  /** The degree's requirement blocks, for each pool's full catalog list. */
  blocks: RequirementBlock[];
  /** Course codes on the board right now, in term order. */
  boardCodes: string[];
  /** Course codes the student marked as already taken. */
  priorCodes: string[];
  context: PlanningContext;
}

/**
 * The pools again, counted off the board.
 *
 * A course is credited to at most one pool, the way generatePlan credits it to
 * at most one requirement. Two pools that both list CS 425 must not both count
 * it, or a degree with overlapping elective lists reports itself finished twice
 * over. The pool that already held the course keeps it; anything new goes to
 * the first pool that lists it, which is the order the degree page prints.
 */
export function livePools({
  base,
  blocks,
  boardCodes,
  priorCodes,
  context,
}: LivePoolInput): PoolReport[] {
  if (base.length === 0) return base;

  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const board = boardCodes.map(normaliseCode);
  const boardSet = new Set(board);
  const prior = new Set(priorCodes.map(normaliseCode));
  const members = base.map((pool) => membershipOf(pool, blockById.get(pool.requirementId)));

  const claimed = new Set<string>();
  const mine: string[][] = base.map(() => []);

  // Courses this pool already held keep their pool, so a student who has not
  // touched an elective does not see it jump to another heading.
  base.forEach((pool, index) => {
    for (const raw of pool.picked) {
      const code = normaliseCode(raw);
      if (!boardSet.has(code) || claimed.has(code)) continue;
      claimed.add(code);
      mine[index].push(code);
    }
  });

  // Then whatever the student added, in board order so the panel lists a pool's
  // courses the way the plan reads left to right.
  for (const code of board) {
    if (claimed.has(code)) continue;
    const index = members.findIndex((set) => set.has(code));
    if (index < 0) continue;
    claimed.add(code);
    mine[index].push(code);
  }

  return base.map((pool, index) => {
    const picked = mine[index];
    const free = pool.fromPriorCredit.filter((code) => prior.has(normaliseCode(code)));
    const held = [...free.map(normaliseCode), ...picked];
    const heldSet = new Set(held);
    const block = blockById.get(pool.requirementId);
    const constraints =
      block && block.rule.kind === 'pool'
        ? block.rule.constraints.map((c) => ({ text: c.text, n: c.n, ...constraintOnBoard(c, heldSet, context) }))
        : pool.constraints;

    /**
     * What is left to choose. Everything the pool lists that the catalog
     * snapshot has, minus what is already on the board or already earned.
     * Taken from the generated report rather than from the block, because the
     * report's order is the scheduler's own ranking, best first, and a list of
     * a hundred and seventy alternatives in catalog order is not a choice a
     * student can make.
     */
    const alternatives = [...pool.picked, ...pool.alternatives]
      .map(normaliseCode)
      .filter((code, at, all) => all.indexOf(code) === at)
      .filter((code) => !boardSet.has(code) && !prior.has(code));

    return {
      ...pool,
      hours: planCreditRange(held, context).min,
      count: held.length,
      picked,
      fromPriorCredit: free,
      alternatives,
      constraints,
    };
  });
}

/**
 * What the pools are still short of, in sentences a student can act on.
 *
 * Regenerated here rather than reused from the plan for the same reason the
 * counts are: a review list that still says "18 hours from this list, 15 hours
 * in the plan" after the student added the sixth course is telling them to fix
 * something they have already fixed.
 */
export function poolShortfalls(pools: PoolReport[]): UnsatisfiedRequirement[] {
  const out: UnsatisfiedRequirement[] = [];
  for (const pool of pools) {
    if (pool.available === 0) {
      out.push({
        requirementId: pool.requirementId,
        areaLabel: pool.areaLabel,
        label: pool.label,
        reason: 'no-course-data',
        message: `None of the ${pool.listed} ${plural(pool.listed, 'course')} the catalog lists here are in this snapshot.`,
        url: pool.url,
      });
    } else if (
      (pool.hoursTarget !== null && pool.hours < pool.hoursTarget) ||
      (pool.countTarget !== null && pool.count < pool.countTarget)
    ) {
      // Both halves are written with the number they carry. The generated
      // version hardcoded "courses", so every degree with a one-course list
      // printed "1 courses from this list, 0 courses in the plan", eleven times
      // over on the Civil Engineering page.
      const wanted = [
        pool.hoursTarget !== null ? `${pool.hoursTarget} ${plural(pool.hoursTarget, 'hour')}` : null,
        pool.countTarget !== null ? `${pool.countTarget} ${plural(pool.countTarget, 'course')}` : null,
      ].filter(Boolean).join(' and ');
      const got = [
        pool.hoursTarget !== null ? `${pool.hours} ${plural(pool.hours, 'hour')}` : null,
        pool.countTarget !== null ? `${pool.count} ${plural(pool.count, 'course')}` : null,
      ].filter(Boolean).join(' and ');
      out.push({
        requirementId: pool.requirementId,
        areaLabel: pool.areaLabel,
        label: pool.label,
        reason: 'hours-short',
        message: `${wanted} from this list, ${got} in the plan. ${pool.available} of the ${pool.listed} listed ${plural(pool.listed, 'course')} are in the catalog snapshot.`,
        url: pool.url,
      });
    }
    for (const constraint of pool.constraints) {
      if (constraint.met) continue;
      out.push({
        requirementId: pool.requirementId,
        areaLabel: pool.areaLabel,
        label: pool.label,
        // The sentence, then the count, and no attempt to explain it away.
        message: `${constraint.text} ${constraintProgress(constraint)}.`,
        reason: 'constraint-unmet',
        url: pool.url,
      });
    }
  }
  return out;
}
