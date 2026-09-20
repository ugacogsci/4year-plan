'use client';

import { useState } from 'react';
import { CircleAlert, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Course, PlanIssue, PlanTerm } from '@/lib/planner/types';
import { CourseCard, type ElectiveOf } from './course-card';

interface SemesterColumnProps {
  term: PlanTerm;
  allTerms: PlanTerm[];
  courseIndex: Map<string, Course>;
  issues: PlanIssue[];
  selectedCourseId: string | null;
  onSelectCourse: (courseId: string, termId: string) => void;
  onMoveCourse: (courseId: string, fromTermId: string, toTermId: string) => void;
  onRemoveCourse: (courseId: string, termId: string) => void;
  onAddCourse: (termId: string) => void;
  onDropCourse: (courseId: string, termId: string) => void;
  onFindAlternatives: (courseId: string, termId: string) => void;
  /** Which elective pool a course is filling, by course id. Empty for most. */
  electiveOf: Map<string, ElectiveOf>;
  /** Low end of the term's credit range, already summed by the caller. */
  credits: string;
  heavy: boolean;
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
  onAddCourse,
  onDropCourse,
  onFindAlternatives,
  electiveOf,
  credits,
  heavy,
}: SemesterColumnProps) {
  const [dropActive, setDropActive] = useState(false);

  return (
    // Drag and drop is progressive enhancement; every move is also in the card menu.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      id={`term-${term.id}`}
      className="semester-column"
      aria-label={term.label}
      data-drop-active={dropActive ? 'true' : undefined}
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
      }}
      onDragLeave={(event) => {
        // Moving onto a child fires dragleave on the parent. Without this check
        // the outline flickers off the moment the pointer crosses a card.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        const courseId = event.dataTransfer.getData('application/x-course-id');
        const fromTermId = event.dataTransfer.getData('application/x-term-id');
        if (courseId && !fromTermId) {
          onDropCourse(courseId, term.id);
        } else if (courseId && fromTermId && fromTermId !== term.id) {
          onMoveCourse(courseId, fromTermId, term.id);
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
              issues={issues.filter(
                (issue) => issue.courseId === courseId && issue.termId === term.id,
              )}
              electiveOf={electiveOf.get(courseId)}
              onSelect={onSelectCourse}
              onMove={onMoveCourse}
              onRemove={onRemoveCourse}
              onFindAlternatives={onFindAlternatives}
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
    </section>
  );
}
