'use client';

/**
 * Everything the plan could not do, behind one chip in the board bar.
 *
 * This used to be an 83px band of 168px cards at 7px type, permanently above
 * the board. The counts now live on the chip and the rows live here, at 13px in
 * a 320px column, which is the first size any of this has been readable at.
 *
 * Nothing is ever dropped. A plan that hides what it could not satisfy looks
 * finished and is not. What is folded is repetition: the Computer Science
 * degree page repeats one technical-elective sentence fifty times across its
 * focus-area tables, and fifty identical rows is not fifty facts. Identical
 * messages collapse into one row that says how many, which is the same
 * information in a form a person can read.
 */

import { AlertCircle, AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanIssue } from '@/lib/planner/types';

export interface HealthGroup {
  key: string;
  severity: PlanIssue['severity'];
  title: string;
  message: string;
  count: number;
  issue: PlanIssue;
}

/**
 * "Area: requirement", the title of a requirement's row. An area-wide
 * requirement carries the area's name as its label, so the pair would read
 * "Technical Electives: Technical Electives"; an area the degree page prints
 * no heading for has a null label whatever its type says, and Chemistry's
 * rows read "null: Core Chemistry" here and on the printed advisor packet.
 */
export function reviewTitle(area: string | null | undefined, label: string | null | undefined): string {
  const a = area?.trim() ?? '';
  const l = label?.trim() ?? '';
  if (!l || l === a) return a || 'A requirement on the degree page';
  return a ? `${a}: ${l}` : l;
}

/** Identical messages become one row. Distinct ones never merge. */
export function groupIssues(issues: PlanIssue[]): HealthGroup[] {
  const groups = new Map<string, HealthGroup>();
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.title}|${issue.message}`;
    const hit = groups.get(key);
    if (hit) {
      hit.count += 1;
      continue;
    }
    groups.set(key, {
      key,
      severity: issue.severity,
      title: issue.title,
      message: issue.message,
      count: 1,
      issue,
    });
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return [...groups.values()].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function PlanHealthList({
  groups,
  onSelectIssue,
}: {
  groups: HealthGroup[];
  onSelectIssue: (issue: PlanIssue) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="health-empty">
        <CheckCircle2 /> Nothing to review. Every course clears its prerequisites.
      </div>
    );
  }

  return (
    <div className="health-popover">
      {groups.map((group) => (
        <button
          key={group.key}
          type="button"
          className={cn('health-item', `health-${group.severity}`)}
          onClick={() => onSelectIssue(group.issue)}
        >
          {group.severity === 'error' ? (
            <AlertCircle />
          ) : group.severity === 'warning' ? (
            <AlertTriangle />
          ) : (
            <CircleAlert />
          )}
          <span>
            <strong>
              {group.title}
              {group.count > 1 && ` and ${group.count - 1} more like it`}
            </strong>
            {group.message}
          </span>
        </button>
      ))}
    </div>
  );
}
