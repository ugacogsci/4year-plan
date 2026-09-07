'use client';

import {
  AlertCircle,
  CircleAlert,
  GripVertical,
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Course, PlanIssue, PlanTerm } from '@/lib/planner/types';

const clusterTone: Record<Course['cluster'], string> = {
  Foundations: 'bg-[#e6bd54]',
  Computation: 'bg-[#62b9ea]',
  'Mind & Brain': 'bg-[#ef7294]',
  Language: 'bg-[#a68af5]',
  Philosophy: 'bg-[#f28b57]',
  'University Core': 'bg-[#8b98a8]',
};

interface CourseCardProps {
  course: Course;
  term: PlanTerm;
  allTerms: PlanTerm[];
  selected: boolean;
  issues: PlanIssue[];
  onSelect: (courseId: string, termId: string) => void;
  onMove: (courseId: string, fromTermId: string, toTermId: string) => void;
  onRemove: (courseId: string, termId: string) => void;
  onFindAlternatives: (courseId: string, termId: string) => void;
}

export function CourseCard({
  course,
  term,
  allTerms,
  selected,
  issues,
  onSelect,
  onMove,
  onRemove,
  onFindAlternatives,
}: CourseCardProps) {
  const highestIssue =
    issues.find((issue) => issue.severity === 'error') ?? issues[0];

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
      <span className={cn('course-cluster-dot', clusterTone[course.cluster])} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left focus-visible:outline-none"
        onClick={() => onSelect(course.id, term.id)}
      >
        <span className="course-card-code-row">
          <span className="course-card-code">{course.code}</span>
          {course.pathwayRole === 'required' && (
            <span
              className="course-required"
              title="Required in this sample pathway"
            >
              <LockKeyhole /> fixed
            </span>
          )}
          {highestIssue && (
            <span
              className={cn(
                'course-check',
                highestIssue.severity === 'error'
                  ? 'text-destructive'
                  : 'text-warning',
              )}
            >
              {highestIssue.severity === 'error' ? (
                <AlertCircle className="size-3" />
              ) : (
                <CircleAlert className="size-3" />
              )}
              Check
            </span>
          )}
        </span>
        <span className="course-card-title">{course.title}</span>
      </button>
      <span className="course-card-credits">{course.credits} cr</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${course.code}`}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              title={`Options for ${course.code}`}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{course.code}</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <MoveRight /> Move to
            </DropdownMenuSubTrigger>
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
          <DropdownMenuItem
            onClick={() => onFindAlternatives(course.id, term.id)}
          >
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
