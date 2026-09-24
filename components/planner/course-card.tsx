'use client';

import {
  ChevronDown,
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
import { useState } from 'react';
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
  issues: PlanIssue[];
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
  onChoose,
  alternativesFor,
  onSwap,
  onSelect,
  onMove,
  onRemove,
  onFindAlternatives,
}: CourseCardProps) {
  const highestIssue = issues.find((issue) => issue.severity === 'error') ?? issues[0];
  const [alternatives, setAlternatives] = useState<Alternative[] | null>(null);
  // A track card is there for the student's goal (PHYS 101 for physical
  // therapy school), so it offers no "better" course to trade it for.
  const swappable = Boolean(electiveOf && electiveOf.kind !== 'prerequisite' && electiveOf.kind !== 'track' && alternativesFor && onSwap);

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
        onClick={() =>
          electiveOf?.kind === 'elective' && onChoose
            ? onChoose(course.id, term.id)
            : onSelect(course.id, term.id)
        }
      >
        {/* The credit hours are the last thing on this row rather than a
            sibling of this button.
            Outside it they were one more thing the card's single line had to
            fit, and in the 228px columns the 768px layout uses it could not:
            the card held its own min-content width, ran 112px past the column,
            and the credits on every card in the leftmost column were clipped
            off. On this row they keep their place at the right and wrap under
            the code when the column is too narrow for both. */}
        <span className="course-card-code-row">
          <span className="course-card-code">{course.code}</span>
          {course.pathwayRole === 'required' && !electiveOf && (
            <span className="course-required" title="Required by this degree">
              <LockKeyhole /> required
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
          <span className="course-card-credits">{creditLabel(course)}</span>
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
                  : onFindAlternatives(course.id, term.id)
              }
            >
              See all options
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
