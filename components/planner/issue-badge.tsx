'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { IssueSeverity } from '@/lib/planner/types';

interface IssueBadgeProps {
  title: string;
  message: string;
  severity: IssueSeverity;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  onClick?: () => void;
}

/** A compact warning marker with an accessible, styled explanation. */
export function IssueBadge({
  title,
  message,
  severity,
  className,
  side = 'top',
  onClick,
}: IssueBadgeProps) {
  const description = `${title}: ${message}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn('issue-badge', className)}
            aria-label={description}
            onClick={(event) => {
              event.stopPropagation();
              onClick?.();
            }}
          />
        }
      >
        <span className={cn('issue-icon', `is-${severity}`)} aria-hidden="true">
          !
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="issue-tooltip">
        <strong>{title}</strong>
        <span>{message}</span>
      </TooltipContent>
    </Tooltip>
  );
}
