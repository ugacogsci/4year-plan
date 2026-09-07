'use client';

import { CircleAlert, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getTermCredits } from '@/lib/planner/rules';
import type { Course, PlanIssue, PlanTerm } from '@/lib/planner/types';
import { CourseCard } from './course-card';

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
  ) => void;
  onRemoveCourse: (courseId: string, termId: string) => void;
  onAddCourse: (termId: string) => void;
  onDropCourse: (courseId: string, termId: string) => void;
  onFindAlternatives: (courseId: string, termId: string) => void;
  minimumCredits: number;
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
  minimumCredits,
}: SemesterColumnProps) {
  const credits = getTermCredits(term.courseIds, courseIndex);

  return (
    // Drag and drop is progressive enhancement; every move is also available in the course menu.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className="semester-column"
      aria-label={term.label}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
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
        <div>
          <h3>{term.label}</h3>
          <p
            className={cn(
              'semester-credit-count',
              credits > 16 && 'font-semibold text-warning',
              credits < minimumCredits && 'font-semibold text-warning',
            )}
          >
            {credits} credits
            {credits < minimumCredits && (
              <CircleAlert aria-label="Below selected minimum" />
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Add a course to ${term.label}`}
          title={`Add a course to ${term.label}`}
          onClick={() => onAddCourse(term.id)}
        >
          <Plus />
        </Button>
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
                (issue) =>
                  issue.courseId === courseId && issue.termId === term.id,
              )}
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
