'use client';

import { useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CircleAlert, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Course, PlanIssue, PlanTerm } from '@/lib/planner/types';
import { CourseCard, type ElectiveOf } from './course-card';
import { isTermIssue } from './plan-health';

interface SemesterColumnProps {
  term: PlanTerm;
  allTerms: PlanTerm[];
  courseIndex: Map<string, Course>;
  issues: PlanIssue[];
  selectedCourseId: string | null;
  onSelectCourse: (courseId: string, termId: string) => void;
  onMoveCourse: (
    courseId: string,
    fromTermId: string,
    toTermId: string,
    targetCourseId?: string,
    placeAfter?: boolean,
  ) => void;
  onRemoveCourse: (courseId: string, termId: string) => void;
  onMarkCourseCompleted: (courseId: string, termId: string) => void;
  onAddCourse: (termId: string) => void;
  onDropCourse: (courseId: string, termId: string) => void;
  replacement: {
    courseId: string;
    termId: string;
    label: string;
    options: Course[];
  } | null;
  onPrepareReplacement: (courseId: string, termId: string) => void;
  onReplaceCourse: (termId: string, oldId: string, newId: string) => void;
  onShowReplacementCourse: (courseId: string) => void;
  onShowReplacements: () => void;
  /** Opens the chooser for an elective slot. */
  onChooseElective?: (courseId: string, termId: string) => void;
  /** Which elective pool a course is filling, by course id. Empty for most. */
  electiveOf: Map<string, ElectiveOf>;
  /** Low end of the term's credit range, already summed by the caller. */
  credits: string;
  heavy: boolean;
  width?: number;
  onWidthChange: (termId: string, width: number) => void;
}

export function SemesterColumn({
  term,
  allTerms,
  courseIndex,
  issues,
  selectedCourseId,
  onSelectCourse,
  onMoveCourse,
  onRemoveCourse,
  onMarkCourseCompleted,
  onAddCourse,
  onDropCourse,
  replacement,
  onPrepareReplacement,
  onReplaceCourse,
  onShowReplacementCourse,
  onShowReplacements,
  onChooseElective,
  electiveOf,
  credits,
  heavy,
  width,
  onWidthChange,
}: SemesterColumnProps) {
  const columnRef = useRef<HTMLElement | null>(null);
  const resizeStart = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [dropPosition, setDropPosition] = useState<{
    courseId: string;
    placeAfter: boolean;
  } | null>(null);
  const termIssues = issues.filter(
    (issue) => !issue.courseId && issue.termId === term.id && isTermIssue(issue),
  );

  function resizeTo(nextWidth: number) {
    onWidthChange(term.id, Math.max(220, Math.min(560, Math.round(nextWidth))));
  }

  function placementAt(target: EventTarget | null, pointerY: number) {
    const card = target instanceof Element
      ? target.closest<HTMLElement>('.course-card')
      : null;
    if (!card) return null;
    const courseId = card.dataset.courseId;
    if (!courseId) return null;
    const bounds = card.getBoundingClientRect();
    return { courseId, placeAfter: pointerY > bounds.top + bounds.height / 2 };
  }

  return (
    // Drag and drop is progressive enhancement; every move is also in the card menu.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={columnRef}
      id={`term-${term.id}`}
      className="semester-column"
      aria-label={term.label}
      data-drop-active={dropActive ? 'true' : undefined}
      style={width === undefined ? undefined : { width: `${width}px` }}
      onDragOver={(event) => {
        /**
         * getData is blocked during dragover for security, but types is not, so
         * the handler can still tell the two sources apart. A card dragged from
         * another term carries x-term-id and is a move; a node dragged out of the
         * map carries only x-course-id and is a copy.
         *
         * This is the second half of why map-to-board drops died silently: naming
         * an effect the source did not allow makes the user agent set the drag
         * operation to none, and an operation of none ends the drag with
         * dragleave and never fires drop at all.
         */
        if (!event.dataTransfer.types.includes('application/x-course-id')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
          'application/x-term-id',
        )
          ? 'move'
          : 'copy';
        setDropActive(true);
        if (event.dataTransfer.types.includes('application/x-term-id')) {
          const next = placementAt(event.target, event.clientY);
          setDropPosition((current) =>
            current?.courseId === next?.courseId && current?.placeAfter === next?.placeAfter
              ? current
              : next,
          );
        } else {
          setDropPosition(null);
        }
      }}
      onDragLeave={(event) => {
        // Moving onto a child fires dragleave on the parent. Without this check
        // the outline flickers off the moment the pointer crosses a card.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropActive(false);
        setDropPosition(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        const placement = placementAt(event.target, event.clientY);
        setDropPosition(null);
        const courseId = event.dataTransfer.getData('application/x-course-id');
        const fromTermId = event.dataTransfer.getData('application/x-term-id');
        if (courseId && !fromTermId) {
          onDropCourse(courseId, term.id);
        } else if (courseId && fromTermId) {
          onMoveCourse(
            courseId,
            fromTermId,
            term.id,
            placement?.courseId,
            placement?.placeAfter,
          );
        }
      }}
    >
      <header className="semester-heading">
        {/*
          No date here, ever. Illinois runs several parts of term inside one
          semester and the drop, refund, credit/no-credit and grade-replacement
          deadlines differ for each one, so a single date in a column header
          would be wrong for most of the sections in it. Deadlines belong in the
          course inspector, listed per part of term.
        */}
        <h3>{term.label}</h3>
        <p className={cn('semester-credit-count', heavy && 'text-warning')}>
          {credits}
          {heavy && <CircleAlert aria-label="Heavy term" />}
        </p>
      </header>

      {termIssues.length > 0 && (
        <div className="semester-issues" aria-label={`${term.label} notes`}>
          {termIssues.map((issue) => (
            <div
              key={issue.id}
              className={cn('semester-issue', `is-${issue.severity}`)}
            >
              {issue.severity === 'error' ? (
                <AlertCircle />
              ) : issue.severity === 'warning' ? (
                <AlertTriangle />
              ) : (
                <CircleAlert />
              )}
              <span>
                <strong>{issue.title}</strong>
                {issue.message}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="semester-courses">
        {term.courseIds.map((courseId) => {
          const course = courseIndex.get(courseId);
          if (!course) return null;
          return (
            <CourseCard
              key={courseId}
              course={course}
              term={term}
              allTerms={allTerms}
              selected={selectedCourseId === courseId}
              dropPosition={
                dropPosition?.courseId === courseId
                  ? dropPosition.placeAfter
                    ? 'after'
                    : 'before'
                  : undefined
              }
              issues={issues.filter(
                (issue) => issue.courseId === courseId && issue.termId === term.id,
              )}
              electiveOf={electiveOf.get(courseId)}
              onChoose={onChooseElective}
              onSelect={onSelectCourse}
              onMove={onMoveCourse}
              onRemove={onRemoveCourse}
              onMarkCompleted={onMarkCourseCompleted}
              replacement={{
                active:
                  replacement?.courseId === course.id && replacement.termId === term.id,
                label:
                  replacement?.courseId === course.id && replacement.termId === term.id
                    ? replacement.label
                    : 'Courses that satisfy the same part of your plan.',
                options:
                  replacement?.courseId === course.id && replacement.termId === term.id
                    ? replacement.options
                    : [],
                onLoad: () => onPrepareReplacement(course.id, term.id),
                onPick: (newId) => onReplaceCourse(term.id, course.id, newId),
                onShowCourse: onShowReplacementCourse,
                onShowAll: onShowReplacements,
              }}
            />
          );
        })}
        <Button
          type="button"
          variant="ghost"
          className="semester-add-button"
          onClick={() => onAddCourse(term.id)}
        >
          <Plus /> Add a course
        </Button>
      </div>
      <button
        type="button"
        className="semester-resize-handle"
        aria-label={`Resize ${term.label} horizontally`}
        title="Drag to resize semester width"
        onPointerDown={(event) => {
          event.preventDefault();
          const currentWidth = columnRef.current?.getBoundingClientRect().width;
          if (!currentWidth) return;
          resizeStart.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            width: currentWidth,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = resizeStart.current;
          if (!start || start.pointerId !== event.pointerId) return;
          resizeTo(start.width + event.clientX - start.x);
        }}
        onPointerUp={(event) => {
          if (resizeStart.current?.pointerId !== event.pointerId) return;
          resizeStart.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          resizeStart.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const currentWidth = width ?? columnRef.current?.getBoundingClientRect().width ?? 260;
          resizeTo(currentWidth + (event.key === 'ArrowRight' ? 20 : -20));
        }}
      >
        <span aria-hidden="true" />
      </button>
    </section>
  );
}
