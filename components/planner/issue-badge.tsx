'use client';

import { useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { splitCourseMentions } from '@/lib/planner/course-mentions';
import type { Course, IssueSeverity } from '@/lib/planner/types';

interface IssueBadgeProps {
  title: string;
  message: string;
  severity: IssueSeverity;
  className?: string;
  variant?: 'icon' | 'dot';
  side?: 'top' | 'right' | 'bottom' | 'left';
  onClick?: () => void;
  coursesByCode?: ReadonlyMap<string, Course>;
  onShowCourse?: (courseId: string) => void;
}

/** A compact warning marker with an accessible, styled explanation. */
export function IssueBadge({
  title,
  message,
  severity,
  className,
  variant = 'icon',
  side = 'top',
  onClick,
  coursesByCode,
  onShowCourse,
}: IssueBadgeProps) {
  const [open, setOpen] = useState(false);
  const navigatingToMap = useRef(false);
  const description = `${title}: ${message}`;
  function linkedText(text: string) {
    if (!coursesByCode || !onShowCourse) return text;
    return splitCourseMentions(text, coursesByCode).map((part, index) => part.course ? (
      <button
        key={index}
        type="button"
        className="issue-course-link"
        aria-label={`Show ${part.course.code} on course map`}
        onClick={(event) => {
          event.stopPropagation();
          navigatingToMap.current = true;
          setOpen(false);
          onShowCourse?.(part.course!.id);
        }}
      >
        {part.text}
      </button>
    ) : part.text);
  }
  return (
    <Popover open={open} onOpenChange={(next) => {
      if (next) navigatingToMap.current = false;
      setOpen(next);
    }}>
      <PopoverTrigger
        openOnHover
        delay={100}
        closeDelay={200}
        render={
          <button
            type="button"
            className={cn('issue-badge', variant === 'dot' && 'issue-badge-dot', className)}
            aria-label={description}
            onClick={(event) => {
              event.stopPropagation();
              onClick?.();
            }}
          />
        }
      >
        <span className={cn(variant === 'dot' ? 'plan-tab-issue-dot' : 'issue-icon', `is-${severity}`)} aria-hidden="true">
          {variant === 'icon' ? '!' : null}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className="issue-tooltip"
        aria-label={title}
        initialFocus={(interaction) => interaction === 'keyboard'}
        finalFocus={() => !navigatingToMap.current}
      >
        <strong>{linkedText(title)}</strong>
        <span>{linkedText(message)}</span>
      </PopoverContent>
    </Popover>
  );
}
