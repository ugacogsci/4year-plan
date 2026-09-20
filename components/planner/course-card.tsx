'use client';

import {
  AlertCircle,
  CircleAlert,
  GripVertical,
  ListChecks,
  LockKeyhole,
  MoreHorizontal,
  MoveRight,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { clusterColor } from './cluster-color';
import type { Course, PlanIssue, PlanTerm } from '@/lib/planner/types';

/**
 * A course that is in the plan because a pool needed filling.
 *
 * Shown on the card because "required" and "one of a hundred and two" are very
 * different facts about a course sitting in a semester, and the old card had
 * one badge for the first and nothing at all for the second. `detail` is the
 * pool's own line, counted off the board, so hovering says what the catalog
 * asked for and how much of it the plan holds.
 */
export interface ElectiveOf {
  label: string;
  detail: string;
}

interface CourseCardProps {
  course: Course;
  term: PlanTerm;
  allTerms: PlanTerm[];
  selected: boolean;
  issues: PlanIssue[];
  electiveOf?: ElectiveOf;
  onSelect: (courseId: string, termId: string) => void;
  onMove: (courseId: string, fromTermId: string, toTermId: string) => void;
  onRemove: (courseId: string, termId: string) => void;
  onFindAlternatives: (courseId: string, termId: string) => void;
}

/** "3 cr", or "1 to 4 cr" for the 1,829 Illinois courses with a range. */
function creditLabel(course: Course): string {
  const max = course.creditsMax ?? course.credits;
  return max > course.credits ? `${course.credits} to ${max} cr` : `${course.credits} cr`;
}

export function CourseCard({
  course,
  term,
  allTerms,
  selected,
  issues,
  electiveOf,
  onSelect,
  onMove,
  onRemove,
  onFindAlternatives,
}: CourseCardProps) {
  const highestIssue = issues.find((issue) => issue.severity === 'error') ?? issues[0];

  return (
    <article
      id={`planned-${term.id}-${course.id}`}
      className={cn('course-card group', selected && 'course-card-selected')}
    >
      <button
        type="button"
        draggable
        aria-label={`Drag ${course.code} to another term`}
        title={`Drag ${course.code} to another term`}
        className="course-drag-handle"
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-course-id', course.id);
          event.dataTransfer.setData('application/x-term-id', term.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <span
        className="course-cluster-dot"
        style={{ backgroundColor: clusterColor(course.cluster) }}
      />
      <button
        type="button"
        className="course-card-body focus-visible:outline-none"
        onClick={() => onSelect(course.id, term.id)}
      >
        <span className="course-card-code-row">
          <span className="course-card-code">{course.code}</span>
          {course.pathwayRole === 'required' && !electiveOf && (
            <span className="course-required" title="Required by this degree">
              <LockKeyhole /> required
            </span>
          )}
          {electiveOf && (
            <span className="course-elective" title={`${electiveOf.label}. ${electiveOf.detail}`}>
              <ListChecks /> from a list
            </span>
          )}
          {highestIssue && (
            <span
              className={cn(
                'course-check',
                highestIssue.severity === 'error' ? 'text-destructive' : 'text-warning',
              )}
              title={highestIssue.message}
            >
              {highestIssue.severity === 'error' ? <AlertCircle /> : <CircleAlert />}
              check
            </span>
          )}
        </span>
        <span className="course-card-title">{course.title}</span>
      </button>
      <span className="course-card-credits">{creditLabel(course)}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${course.code}`}
          render={<Button variant="ghost" size="icon-sm" title={`Options for ${course.code}`} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {/* The label has to sit inside a Group. DropdownMenuLabel is Base
              UI's Menu.GroupLabel, which throws "MenuGroupContext is missing"
              with no Group ancestor, and a throw in a menu unmounts the whole
              app. Clicking this button on any card took the page down. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{course.code}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <MoveRight /> Move to
            </DropdownMenuSubTrigger>
            {/* The path for a long move. Dragging Year 1 to Year 4 means
                scrolling the board mid-drag, so the menu stays primary for those. */}
            <DropdownMenuSubContent className="w-40">
              {allTerms
                .filter((candidate) => candidate.id !== term.id)
                .map((candidate) => (
                  <DropdownMenuItem
                    key={candidate.id}
                    onClick={() => onMove(course.id, term.id, candidate.id)}
                  >
                    {candidate.label}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => onFindAlternatives(course.id, term.id)}>
            <Shuffle /> Find a replacement
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onRemove(course.id, term.id)}
          >
            <Trash2 /> Remove from plan
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
