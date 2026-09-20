'use client';

/**
 * The rail: who you are and how far along you are.
 *
 * Degree progress is always visible because it is the only thing here a student
 * reads rather than edits. Everything editable sits behind two closed
 * disclosures, which is what four open accordions of dropdowns used to cost:
 * 888px of panel on arrival for settings almost nobody changes.
 */

import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { RequirementArea } from '@/lib/planner/scheduler';

export interface AreaRow {
  area: RequirementArea;
  earned: number;
  percent: number;
  satisfied: boolean;
}

interface RailProps {
  schoolName: string;
  schoolShort: string;
  portal: string;
  programName: string | null;
  programUrl: string | null;
  digest: string;
  onStartOver: () => void;
  plannedCredits: string;
  degreeTotal: number | null;
  priorCount: number;
  areas: AreaRow[];
  programs: Array<{ id: string; name: string }>;
  programId: string | null;
  onProgramChange: (id: string) => void;
  minimumTermCredits: number;
  onMinimumChange: (value: number) => void;
  careerInterests: string;
  onCareerChange: (value: string) => void;
  /** Plain sentences from the build and the scheduler about what is not known. */
  caveats: string[];
  /**
   * The degree's "take N hours from this list" requirements, rendered by the
   * caller. The rail owns where they sit, not what they say: an elective pool
   * needs the board's term selector and the board's add handler, and threading
   * six more props through here to rebuild it would only move the coupling.
   */
  pools?: ReactNode;
}

export function StudentProfilePanel({
  schoolName,
  schoolShort,
  portal,
  programName,
  programUrl,
  digest,
  onStartOver,
  plannedCredits,
  degreeTotal,
  priorCount,
  areas,
  programs,
  programId,
  onProgramChange,
  minimumTermCredits,
  onMinimumChange,
  careerInterests,
  onCareerChange,
  caveats,
  pools,
}: RailProps) {
  return (
    <aside className="rail" aria-label="Your profile and progress">
      <div className="rail-school">
        <strong>{programName ?? 'No degree chosen'}</strong>
        <span>{schoolName}</span>
      </div>

      {digest && (
        <div className="profile-digest">
          <h3>Your setup</h3>
          <p>{digest}</p>
          <button type="button" className="again" onClick={onStartOver}>
            Start over
          </button>
        </div>
      )}

      <div className="rail-progress">
        <div className="rail-progress-head">
          <strong>{plannedCredits}</strong>
          <span>{degreeTotal ? `of ${degreeTotal} for the degree` : 'degree total not published'}</span>
        </div>
        <Bar percent={degreeTotal ? percentOf(plannedCredits, degreeTotal) : 0} />
        <div className="rail-progress-head">
          <span>Already taken</span>
          <span>{priorCount} course{priorCount === 1 ? '' : 's'}</span>
        </div>
      </div>

      {areas.length > 0 && (
        <div className="requirement-list">
          {areas.map((row) => (
            <div className="requirement-row" key={row.area.label}>
              <div>
                <span title={row.area.label}>{row.area.label}</span>
                {/* No bar without a target. An area whose hours the degree page
                    does not publish has nothing to be a fraction of, and a bar
                    stuck at zero next to 73 earned hours reads as no progress. */}
                <span>{row.area.hours ? `${row.earned}/${row.area.hours}` : `${row.earned} hr`}</span>
              </div>
              {row.area.hours > 0 && <Bar percent={row.percent} />}
            </div>
          ))}
        </div>
      )}

      {pools}

      <details className="rail-section">
        <summary>Degree</summary>
        <label className="rail-field">
          <span>Which degree are you planning?</span>
          <NativeSelect
            value={programId ?? ''}
            onChange={(event) => onProgramChange(event.target.value)}
          >
            <NativeSelectOption value="">Pick a degree</NativeSelectOption>
            {programs.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {programUrl && (
          <p className="rail-note" style={{ margin: 0, paddingTop: 0, border: 0 }}>
            <a href={programUrl} target="_blank" rel="noreferrer">
              The catalog page these requirements came from
            </a>
          </p>
        )}
      </details>

      <details className="rail-section">
        <summary>Preferences</summary>
        <label className="rail-field">
          <span>Credits you want each term, at least</span>
          <input
            type="number"
            min={3}
            max={21}
            value={minimumTermCredits}
            onChange={(event) => onMinimumChange(Number(event.target.value))}
          />
        </label>
        <label className="rail-field">
          <span>What you want to be doing after</span>
          <textarea
            rows={3}
            value={careerInterests}
            onChange={(event) => onCareerChange(event.target.value)}
          />
        </label>
        <p className="rail-field" style={{ fontSize: 'var(--fs-micro)', color: '#6f8098' }}>
          Written down, not yet used by the scheduler.
        </p>
      </details>

      <p className="rail-note">
        Some of this is estimated. Check the catalog before you register.
        <Popover>
          <PopoverTrigger render={<button type="button">What is estimated?</button>} />
          <PopoverContent align="start" className="w-80">
            <div className="health-popover">
              {caveats.map((line) => (
                <p key={line} style={{ margin: 0, fontSize: 'var(--fs-body)', lineHeight: 1.5 }}>
                  {line}
                </p>
              ))}
              <p style={{ margin: 0, fontSize: 'var(--fs-body)', lineHeight: 1.5 }}>
                {schoolShort} and {portal} remain the source of truth. Nothing you type
                here leaves this device.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </p>
    </aside>
  );
}

/** "121" or "118 to 126" against the degree total, for the bar only. */
function percentOf(planned: string, total: number): number {
  const first = Number(planned.split(' ')[0]);
  if (!Number.isFinite(first) || total <= 0) return 0;
  return Math.min(100, Math.round((first / total) * 100));
}

/** A two-element bar. The shadcn Progress renders a status node this rail has
 *  no room for, and a requirement row needs nothing but a filled width. */
function Bar({ percent }: { percent: number }) {
  return (
    <div className="rail-bar">
      <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}
