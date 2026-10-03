'use client';

import { useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
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
import { IssueBadge } from './issue-badge';
import type { Course, PlanIssue, PlanTerm } from '@/lib/planner/types';
import type { PlanMark } from '@/lib/planner/repick';

/**
 * A course that is in the plan because a pool needed filling, a slot needed a
 * course, or the student's career track asks for it.
 *
 * Shown on the card because "required" and "one of a hundred and two" are very
 * different facts about a course sitting in a semester, and the old card had
 * one badge for the first and nothing at all for the second. `detail` is the
 * pool's own line, counted off the board, so hovering says what the catalog
 * asked for and how much of it the plan holds. The kinds are described on
 * PlanMark (lib/planner/repick.ts), which builds these marks for the board,
 * ALMA and the re-pick alike; a 'track' card carries the track's name.
 */
export type ElectiveOf = PlanMark;

/** Another course that could sit where a card sits, and why it is offered. */
export interface Alternative {
  course: Course;
  why: string;
}

interface CourseCardProps {
  course: Course;
  term: PlanTerm;
  allTerms: PlanTerm[];
  selected: boolean;
  dropPosition?: 'before' | 'after';
  issues: PlanIssue[];
  coursesByCode: ReadonlyMap<string, Course>;
  onShowCourse: (courseId: string) => void;
  electiveOf?: ElectiveOf;
  /** Opens the chooser for an elective slot. The card body does this in place of selecting. */
  onChoose?: (courseId: string, termId: string) => void;
  /**
   * What else could fill this slot or list, best first. Called when the
   * dropdown opens rather than on render, because it ranks the catalog.
   */
  alternativesFor?: (courseId: string, termId: string) => Alternative[];
  onSwap?: (courseId: string, termId: string, replacementId: string) => void;
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
  coursesByCode,
  onShowCourse,
  electiveOf,
  onChoose,
  alternativesFor,
  onSwap,
  onSelect,
  onMove,
  onRemove,
  onMarkCompleted,
  replacement,
}: CourseCardProps) {
  const [alternatives, setAlternatives] = useState<Alternative[] | null>(null);
  // A track card is there for the student's goal (PHYS 101 for physical
  // therapy school), so it offers no "better" course to trade it for.
  const swappable = Boolean(electiveOf && electiveOf.kind !== 'prerequisite' && electiveOf.kind !== 'track' && alternativesFor && onSwap);
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
      {issues.length > 0 && (
        <span
          className="course-card-issues"
          aria-label={`${issues.length} course ${issues.length === 1 ? 'note' : 'notes'}`}
        >
          {issues.map((issue) => (
            <IssueBadge
              key={issue.id}
              title={issue.title}
              message={issue.message}
              severity={issue.severity}
              side="left"
              coursesByCode={coursesByCode}
              onShowCourse={onShowCourse}
            />
          ))}
        </span>
      )}
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
            <span className="course-required" title="Required by this degree" aria-label="Required by this degree">
              <LockKeyhole />
            </span>
          )}
          {electiveOf && (
            <span
              className={cn('course-elective', electiveOf.kind === 'elective' && 'is-slot', electiveOf.kind === 'language' && 'is-language')}
              title={
                electiveOf.kind === 'elective'
                  ? `${electiveOf.detail} Tap the card to choose a different course for this slot.`
                  : electiveOf.kind === 'language'
                    ? `${electiveOf.detail} Open the chevron to switch languages.`
                    : electiveOf.kind === 'track'
                      ? `${electiveOf.detail} Booked for your goal; it stays unless you drop that goal.`
                      : electiveOf.kind === 'gened' || electiveOf.kind === 'prerequisite'
                        ? electiveOf.detail
                        : `${electiveOf.label}. ${electiveOf.detail}`
              }
            >
              <ListChecks /> {electiveOf.kind === 'elective' ? 'elective · tap to choose' : electiveOf.kind === 'track' ? `for ${electiveOf.track ?? electiveOf.label}` : electiveOf.kind === 'language' ? 'language · switch ▾' : electiveOf.kind === 'gened' ? 'gen ed · swap ▾' : electiveOf.kind === 'prerequisite' ? 'prerequisite' : 'from a list'}
            </span>
          )}
        </span>
        <span className="course-card-title">{course.title}</span>
      </button>
      {/* The recommendation with its alternatives behind it: this card is the
          planner's pick for the slot or the list, and the chevron shows what
          else would fit, best first, each with the reason it is offered. */}
      {swappable && electiveOf && (
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) setAlternatives(alternativesFor!(course.id, term.id));
          }}
        >
          <DropdownMenuTrigger
            aria-label={`Other options for ${course.code}`}
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="course-alt-trigger"
                title={
                  electiveOf.kind === 'elective'
                    ? 'Other courses that could fill this elective slot'
                    : `Other courses on the list ${electiveOf.label}`
                }
              />
            }
          >
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 course-alternatives">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {electiveOf.kind === 'elective'
                  ? `Instead of ${course.code}`
                  : electiveOf.kind === 'language'
                    ? 'Switch the language to'
                    : electiveOf.kind === 'gened'
                      ? `Also counts for ${electiveOf.label}`
                      : `Also on the list: ${electiveOf.label}`}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {alternatives === null && <DropdownMenuItem disabled>Looking.</DropdownMenuItem>}
            {alternatives !== null && alternatives.length === 0 && (
              <DropdownMenuItem disabled>Nothing else fits this term.</DropdownMenuItem>
            )}
            {(alternatives ?? []).map((alt) => (
              <DropdownMenuItem key={alt.course.id} onClick={() => onSwap!(course.id, term.id, alt.course.id)}>
                <span className="alt-item">
                  <span className="alt-item-code">
                    {alt.course.code} · {alt.course.title}
                  </span>
                  <span className="alt-item-why">{alt.why}</span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                electiveOf.kind === 'elective' && onChoose
                  ? onChoose(course.id, term.id)
                  : onSelect(course.id, term.id)
              }
            >
              See all options
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        className="course-complete-button"
        onClick={() => onMarkCompleted(course.id, term.id)}
        title={`Mark ${course.code} as already taken`}
      >
        <Check aria-hidden="true" /> Already taken
      </button>
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
          <DropdownMenuItem
            onClick={() => {
              replacement.onLoad();
              replacement.onShowAll();
            }}
          >
            <Shuffle /> Replace course
          </DropdownMenuItem>
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
