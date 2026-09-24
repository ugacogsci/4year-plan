'use client';

import { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CircleAlert,
  GripVertical,
  ListChecks,
  LockKeyhole,
  MoreHorizontal,
  MoveRight,
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
import { ReplacementPicker } from './replacement-picker';
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
  /** A pool pick reads "from a list"; a filler the plan chose reads "elective". */
  kind?: 'pool' | 'elective';
}

interface CourseCardProps {
  course: Course;
  term: PlanTerm;
  allTerms: PlanTerm[];
  selected: boolean;
  dropPosition?: 'before' | 'after';
  issues: PlanIssue[];
  electiveOf?: ElectiveOf;
  /** Opens the chooser for an elective slot. The card body does this in place of selecting. */
  onChoose?: (courseId: string, termId: string) => void;
  onSelect: (courseId: string, termId: string) => void;
  onMove: (courseId: string, fromTermId: string, toTermId: string) => void;
  onRemove: (courseId: string, termId: string) => void;
  onMarkCompleted: (courseId: string, termId: string) => void;
  replacement: {
    active: boolean;
    label: string;
    options: Course[];
    onLoad: () => void;
    onPick: (courseId: string) => void;
    onShowCourse: (courseId: string) => void;
    onShowAll: () => void;
  };
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
  dropPosition,
  issues,
  electiveOf,
  onChoose,
  onSelect,
  onMove,
  onRemove,
  onMarkCompleted,
  replacement,
}: CourseCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const resizeStart = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  function resizeTo(height: number) {
    setCardHeight(Math.max(104, Math.min(440, Math.round(height))));
  }

  return (
    // Drag is progressive enhancement; every action also has a keyboard control.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      ref={cardRef}
      id={`planned-${term.id}-${course.id}`}
      className={cn('course-card group', selected && 'course-card-selected')}
      data-course-id={course.id}
      data-drop-position={dropPosition}
      data-resized={cardHeight !== null ? 'true' : undefined}
      style={cardHeight === null ? undefined : { height: `${cardHeight}px` }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-course-id', course.id);
        event.dataTransfer.setData('application/x-term-id', term.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
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
        onClick={() =>
          electiveOf?.kind === 'elective' && onChoose
            ? onChoose(course.id, term.id)
            : onSelect(course.id, term.id)
        }
      >
        <span className="course-card-code-row">
          <span className="course-card-code">{course.code}</span>
          <span className="course-card-credits">{creditLabel(course)}</span>
          {course.pathwayRole === 'required' && !electiveOf && (
            <span className="course-required" title="Required by this degree">
              <LockKeyhole /> required
            </span>
          )}
          {electiveOf && (
            <span
              className={cn('course-elective', electiveOf.kind === 'elective' && 'is-slot')}
              title={
                electiveOf.kind === 'elective'
                  ? `${electiveOf.detail} Tap the card to choose a different course for this slot.`
                  : `${electiveOf.label}. ${electiveOf.detail}`
              }
            >
              <ListChecks /> {electiveOf.kind === 'elective' ? 'elective' : 'from a list'}
            </span>
          )}
        </span>
        <span className="course-card-title">{course.title}</span>
        {issues.length > 0 && (
          <span className="course-card-issues">
            {issues.map((issue) => (
              <span
                key={issue.id}
                className={cn('course-card-issue', `is-${issue.severity}`)}
              >
                {issue.severity === 'error' ? <AlertCircle /> : <CircleAlert />}
                <span>
                  <strong>{issue.title}</strong>
                  {issue.message}
                </span>
              </span>
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        className="course-complete-button"
        onClick={() => onMarkCompleted(course.id, term.id)}
        title={`Mark ${course.code} as already taken`}
      >
        <Check aria-hidden="true" /> Already taken
      </button>
      <ReplacementPicker course={course} {...replacement} />
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onRemove(course.id, term.id)}
          >
            <Trash2 /> Remove from plan
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className="course-resize-handle"
        aria-label={`Resize ${course.code} card vertically`}
        title="Drag to resize course card"
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const height = cardRef.current?.getBoundingClientRect().height;
          if (!height) return;
          resizeStart.current = { pointerId: event.pointerId, y: event.clientY, height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = resizeStart.current;
          if (!start || start.pointerId !== event.pointerId) return;
          resizeTo(start.height + event.clientY - start.y);
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
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const height = cardHeight ?? cardRef.current?.getBoundingClientRect().height ?? 104;
          resizeTo(height + (event.key === 'ArrowDown' ? 16 : -16));
        }}
      >
        <span aria-hidden="true" />
      </button>
    </article>
  );
}
