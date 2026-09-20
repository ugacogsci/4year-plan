'use client';

/**
 * "Take 18 hours from this list", on screen.
 *
 * The planner can now fill an elective pool, and a filled pool that only shows
 * its six courses is the worst of both worlds: the student sees six courses
 * sitting in their plan with no sign that the catalog offered a hundred and two
 * others, and no way to tell which of the six are interchangeable. So every
 * pool shows four things, in this order:
 *
 *   what the catalog asked for, and what the board actually holds
 *   the catalog's own sentence, verbatim
 *   the sentences that say HOW the courses may be chosen, met or not
 *   the rest of the list, to drag or add
 *
 * Nothing here is a judgement. The numbers are counted off the board and the
 * sentences are quoted, so a pool that is short says so with the same words the
 * catalog used.
 */

import { Check, GripVertical, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { plural } from './words';
import type { PoolReport } from '@/lib/planner/autoplan';
import type { Course } from '@/lib/planner/types';

interface ElectivePoolsProps {
  pools: PoolReport[];
  /** Catalog courses by upper-case code, for titles and credits. */
  byCode: Map<string, Course>;
  plannedCourseIds: Set<string>;
  /** Where the Add button puts a course. The board's own term selector owns this. */
  targetTermId: string;
  targetLabel: string;
  dragUsable: boolean;
  onAddCourse: (courseId: string, termId: string) => void;
  onSelectCourse: (courseId: string) => void;
}

/** "18 hours and 6 courses", or just the half the catalog stated. */
function askedFor(pool: PoolReport): string {
  const parts: string[] = [];
  if (pool.hoursTarget !== null) parts.push(`${pool.hoursTarget} ${plural(pool.hoursTarget, 'hour')}`);
  if (pool.countTarget !== null) parts.push(`${pool.countTarget} ${plural(pool.countTarget, 'course')}`);
  // Both numbers absent is a real case: the page names a list and never says
  // how much of it to take. Saying so beats printing a zero.
  return parts.length ? `${parts.join(' and ')} from this list` : 'Some of this list. The catalog does not say how much.';
}

function have(pool: PoolReport): string {
  const parts: string[] = [];
  if (pool.hoursTarget !== null) parts.push(`${pool.hours} ${plural(pool.hours, 'hour')}`);
  parts.push(`${pool.count} chosen`);
  return parts.join(', ');
}

function short(pool: PoolReport): boolean {
  if (pool.hoursTarget !== null && pool.hours < pool.hoursTarget) return true;
  if (pool.countTarget !== null && pool.count < pool.countTarget) return true;
  return pool.constraints.some((c) => !c.met);
}

export function ElectivePools({
  pools,
  byCode,
  plannedCourseIds,
  targetTermId,
  targetLabel,
  dragUsable,
  onAddCourse,
  onSelectCourse,
}: ElectivePoolsProps) {
  if (pools.length === 0) return null;

  return (
    <div className="pool-list">
      <h3 className="pool-list-head">Pick from a list</h3>
      {pools.map((pool) => (
        <details className="pool" key={pool.requirementId} open={short(pool)}>
          <summary>
            <span className="pool-label" title={pool.label}>
              {pool.label}
            </span>
            <span className={cn('pool-count', short(pool) && 'is-short')}>{have(pool)}</span>
          </summary>

          <p className="pool-asked">{askedFor(pool)}</p>

          {/* The catalog's words. Never a summary of them. */}
          {pool.note && <p className="pool-quote">{pool.note}</p>}

          {pool.constraints.map((c) => (
            <p className={cn('pool-rule', !c.met && 'is-short')} key={c.text}>
              <span>{c.met ? 'Met' : 'Not met'}</span>
              {c.text}
              {c.from && c.met ? ` Taken from ${c.from.replace(/:$/, '')}.` : ''}
            </p>
          ))}

          {pool.picked.length > 0 && (
            <ul className="pool-courses">
              {pool.picked.map((code) => (
                <li key={code}>
                  <Check aria-hidden="true" /> {code}
                  <span>{byCode.get(code)?.title ?? ''}</span>
                </li>
              ))}
            </ul>
          )}

          {pool.fromPriorCredit.length > 0 && (
            <p className="pool-asked">
              Already taken and counted here: {pool.fromPriorCredit.join(', ')}.
            </p>
          )}

          <p className="pool-asked">
            {pool.available} of the {pool.listed} {plural(pool.listed, 'course')} the catalog lists
            here are in this snapshot.
            {pool.alternatives.length > 0
              ? ` ${dragUsable ? 'Drag one into a semester, or use Add.' : 'Use Add to swap one in.'}`
              : ''}
          </p>

          <ul className="pool-options">
            {pool.alternatives.map((code) => {
              const course = byCode.get(code);
              if (!course) return null;
              const already = plannedCourseIds.has(course.id);
              return (
                <li key={code}>
                  <button
                    type="button"
                    draggable={dragUsable}
                    className="pool-option"
                    title={`${course.code}: ${course.title}`}
                    onClick={() => onSelectCourse(course.id)}
                    onDragStart={(event) => {
                      // The same two keys the map node and the board card use.
                      // A course id with no term id is a copy into a semester,
                      // which is exactly what picking out of a pool is.
                      event.dataTransfer.setData('application/x-course-id', course.id);
                      event.dataTransfer.effectAllowed = 'copyMove';
                    }}
                  >
                    {dragUsable && <GripVertical aria-hidden="true" />}
                    <span className="pool-option-code">{course.code}</span>
                    <span className="pool-option-title">{course.title}</span>
                  </button>
                  <button
                    type="button"
                    className="pool-add"
                    disabled={already || !targetTermId}
                    aria-label={`Add ${course.code} to ${targetLabel}`}
                    title={already ? `${course.code} is already in the plan` : `Add ${course.code} to ${targetLabel}`}
                    onClick={() => onAddCourse(course.id, targetTermId)}
                  >
                    {already ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </div>
  );
}
