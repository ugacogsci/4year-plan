import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanIssue } from '@/lib/planner/types';

interface PlanHealthProps {
  issues: PlanIssue[];
  onSelectIssue: (issue: PlanIssue) => void;
}

export function PlanHealth({ issues, onSelectIssue }: PlanHealthProps) {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter(
    (issue) => issue.severity === 'warning',
  ).length;

  return (
    <section className="plan-health" aria-labelledby="plan-health-title">
      <div className="plan-health-summary">
        <span className="plan-health-icon">
          <ShieldCheck />
        </span>
        <div>
          <p className="eyebrow">Live plan check</p>
          <h2 id="plan-health-title">
            {issues.length === 0
              ? 'Path looks clear'
              : `${issues.length} ${issues.length === 1 ? 'item' : 'items'} to review`}
          </h2>
        </div>
        <div className="plan-health-counts" aria-label="Issue counts">
          <span className={cn(errors > 0 && 'has-error')}>
            <AlertCircle /> {errors} conflicts
          </span>
          <span className={cn(warnings > 0 && 'has-warning')}>
            <AlertTriangle /> {warnings} warnings
          </span>
        </div>
      </div>

      <div className="plan-health-items">
        {issues.length > 0 ? (
          issues.slice(0, 5).map((issue) => (
            <button
              key={issue.id}
              type="button"
              className={cn('health-item', `health-${issue.severity}`)}
              title={issue.message}
              onClick={() => onSelectIssue(issue)}
            >
              {issue.severity === 'error' ? (
                <AlertCircle />
              ) : issue.severity === 'warning' ? (
                <AlertTriangle />
              ) : (
                <CircleAlert />
              )}
              <span>
                <strong>{issue.title}</strong>
                {issue.message}
              </span>
            </button>
          ))
        ) : (
          <div className="health-empty">
            <CheckCircle2 /> No prerequisite, load, or availability issues
            found.
          </div>
        )}
        {issues.length > 5 && (
          <span className="health-more">+{issues.length - 5} more in plan</span>
        )}
      </div>
    </section>
  );
}
