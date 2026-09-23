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
import { cn } from '@/lib/utils';
import {
  PRIORITY_LABELS,
  PRIORITY_PRESETS,
  presetOf,
  type Priorities,
  type PriorityPreset,
} from '@/lib/planner/priorities';
import type { RequirementArea } from '@/lib/planner/scheduler';

const PRESET_ROWS: Array<[Exclude<PriorityPreset, 'custom'>, string]> = [
  ['balanced', 'Balanced'],
  ['lightest', 'Lightest'],
  ['relevant', 'My interests'],
  ['teaching', 'Best-rated teaching'],
];
const KNOBS = Object.keys(PRIORITY_LABELS) as Array<keyof typeof PRIORITY_LABELS>;
const LEVELS: Array<[0 | 1 | 2, string]> = [
  [0, 'skip'],
  [1, 'counts'],
  [2, 'most'],
];

export interface AreaRow {
  area: RequirementArea;
  earned: number;
  percent: number;
  satisfied: boolean;
  /**
   * Present on rows built per requirement rather than per page area: the size
   * the catalog published for the row, in the unit it published it in. A
   * category sized in courses stays in courses; nothing here converts.
   */
  needed?: number | null;
  unit?: 'hr' | 'course' | 'semester';
  /** What the count is made of, for the row's tooltip. */
  note?: string;
  /** The codes counted, so a caller can add the rail up. */
  codes?: string[];
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
  /**
   * The whole sentence about where the student is, shown only when they walked
   * in with credit. "88 to 90 cr of 128" on its own is the right number and
   * still leaves a transfer student guessing which half of it is theirs.
   */
  creditNote?: string | null;
  degreeTotal: number | null;
  priorCount: number;
  areas: AreaRow[];
  programs: Array<{ id: string; name: string }>;
  programId: string | null;
  onProgramChange: (id: string) => void;
  minimumTermCredits: number;
  onMinimumChange: (value: number) => void;
  /** What a term should hold, or null for an even spread. The scheduler goes past it only to fit the degree in time. */
  targetTermCredits: number | null;
  onTargetChange: (value: number | null) => void;
  careerInterests: string;
  onCareerChange: (value: string) => void;
  /** What makes a course a good pick for this student. Read by every choice the planner makes. */
  priorities: Priorities;
  onPrioritiesChange: (value: Priorities) => void;
  /** Swap the planner's own picks for the best under the priorities, leaving required and student-added courses alone. */
  onRepick: () => void;
  /** Plain sentences from the build and the scheduler about what is not known. */
  caveats: string[];
  /**
   * The degree's "take N hours from this list" requirements, rendered by the
   * caller. The rail owns where they sit, not what they say: an elective pool
   * needs the board's term selector and the board's add handler, and threading
   * six more props through here to rebuild it would only move the coupling.
   */
  pools?: ReactNode;
  /** The transcript upload, rendered by the caller for the same reason the pools are. */
  transcript?: ReactNode;
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
  creditNote,
  degreeTotal,
  priorCount,
  areas,
  programs,
  programId,
  onProgramChange,
  minimumTermCredits,
  onMinimumChange,
  targetTermCredits,
  onTargetChange,
  careerInterests,
  onCareerChange,
  priorities,
  onPrioritiesChange,
  onRepick,
  caveats,
  pools,
  transcript,
}: RailProps) {
  const rows = areas.map((row, index) => ({
    row,
    // The label is not a key. Two areas on one degree page can print the same
    // heading, and 358 of the 1,155 areas print none at all, so keying by it
    // gave several rows the key "undefined" and React rendered one of them.
    key: `${index}-${row.area.label ?? ''}`,
    heading: headingOf(row.area),
  }));
  const named = rows.filter((r) => r.heading !== null);
  const unnamedRows = rows.filter((r) => r.heading === null);
  // An unnamed area with an hour total, or with hours already earned in it, is
  // worth a row of its own. One with neither is a part of the page that says
  // nothing, and thirteen of those in a row say nothing thirteen times.
  const unnamed = unnamedRows.filter((r) => r.row.area.hours > 0 || r.row.earned > 0);
  const quiet = unnamedRows.length - unnamed.length;

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
        {transcript}
        {creditNote && <p className="rail-credit-note">{creditNote}</p>}
      </div>

      {areas.length > 0 && (
        <div className="requirement-list">
          {named.map(({ row, key, heading }) => (
            <div className={`requirement-row${row.satisfied ? ' is-met' : ''}`} key={key}>
              <div>
                <span title={row.note ? `${heading}. ${row.note}` : (heading ?? undefined)}>{heading}</span>
                {/* No bar without a target. An area whose hours the degree page
                    does not publish has nothing to be a fraction of, and a bar
                    stuck at zero next to 73 earned hours reads as no progress. */}
                <span>{figureOf(row)}</span>
              </div>
              {targetOf(row) > 0 && <Bar percent={row.percent} />}
            </div>
          ))}
          {/* The heading slot says the page has no heading here. It is not a
              name, and it must not look like one: the placeholder these rows
              used to carry, "Requirements 3", was a number this product made up
              and showed to students as the catalog's own words. */}
          {unnamed.map(({ row, key }) => (
            <div className="requirement-row" key={key}>
              <div>
                <span
                  className="requirement-unnamed"
                  title="The catalog page prints this block of requirements with no heading."
                >
                  No heading published
                </span>
                <span>{row.area.hours ? `${row.earned}/${row.area.hours}` : `${row.earned} hr`}</span>
              </div>
              {row.area.hours > 0 && <Bar percent={row.percent} />}
            </div>
          ))}
          {quiet > 0 && (
            <p className="requirement-unnamed">
              {quiet} more {quiet === 1 ? 'part' : 'parts'} of that page{' '}
              {quiet === 1 ? 'prints' : 'print'} no heading and no hours, so there is nothing to
              measure {quiet === 1 ? 'it' : 'them'} against.
            </p>
          )}
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
          <span>Credits you want each term, about</span>
          <input
            type="number"
            min={6}
            max={18}
            placeholder="balanced"
            value={targetTermCredits ?? ''}
            onChange={(event) => {
              const raw = event.target.value.trim();
              onTargetChange(raw === '' ? null : Number(raw));
            }}
          />
        </label>
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
        <p className="rail-field" style={{ fontSize: 'var(--fs-micro)', color: '#6f8098' }}>
          Blank means balanced: every term takes an even share of what is left. Press Rebuild
          after changing these. Your graduation date comes first, so a term goes past the number
          you set only when the degree would not fit in time otherwise, and never past 18.
        </p>
        <label className="rail-field">
          <span>What you want to be doing after</span>
          <textarea
            rows={3}
            value={careerInterests}
            onChange={(event) => onCareerChange(event.target.value)}
          />
        </label>
        <p className="rail-field" style={{ fontSize: 'var(--fs-micro)', color: '#6f8098' }}>
          The words here steer the electives toward what you wrote, and the bot reads them too.
        </p>

        <div className="rail-priorities">
          <span className="rail-priorities-head">What makes a class a good pick</span>
          <fieldset className="rail-presets">
            <legend className="sr-only">Priority presets</legend>
            {PRESET_ROWS.map(([name, label]) => (
              <button
                key={name}
                type="button"
                className={cn('rail-preset', presetOf(priorities) === name && 'is-on')}
                aria-pressed={presetOf(priorities) === name}
                onClick={() =>
                  onPrioritiesChange({
                    ...PRIORITY_PRESETS[name],
                    noEarly: priorities.noEarly,
                    format: priorities.format,
                  })
                }
              >
                {label}
              </button>
            ))}
          </fieldset>
          {KNOBS.map((knob) => (
            <div key={knob} className="rail-knob">
              <span>{PRIORITY_LABELS[knob]}</span>
              <fieldset className="rail-knob-seg">
                <legend className="sr-only">{PRIORITY_LABELS[knob]}</legend>
                {LEVELS.map(([level, word]) => (
                  <label key={level} className={cn(priorities[knob] === level && 'is-on')}>
                    <input
                      type="radio"
                      name={`priority-${knob}`}
                      value={level}
                      className="sr-only"
                      checked={priorities[knob] === level}
                      onChange={() => onPrioritiesChange({ ...priorities, [knob]: level })}
                    />
                    {word}
                  </label>
                ))}
              </fieldset>
            </div>
          ))}
          <label className="rail-check">
            <input
              type="checkbox"
              checked={priorities.noEarly}
              onChange={(event) => onPrioritiesChange({ ...priorities, noEarly: event.target.checked })}
            />
            <span>Nothing before 9 a.m.</span>
          </label>
          <div className="rail-field">
            <span>Format</span>
            <NativeSelect
              aria-label="Class format"
              value={priorities.format}
              onChange={(event) =>
                onPrioritiesChange({ ...priorities, format: event.target.value as Priorities['format'] })
              }
            >
              <NativeSelectOption value="any">Either</NativeSelectOption>
              <NativeSelectOption value="in-person">In person</NativeSelectOption>
              <NativeSelectOption value="online">Online</NativeSelectOption>
            </NativeSelect>
          </div>
          <button type="button" className="rail-action" onClick={onRepick}>
            Re-pick the planner&apos;s choices
          </button>
          <p className="rail-field" style={{ fontSize: 'var(--fs-micro)', color: '#6f8098' }}>
            Re-pick swaps the courses the planner chose, the elective slots and the from-a-list
            picks, for the best under these priorities. Required courses and anything you added
            stay where they are. Rebuild starts the whole board over. Workload comes
            from Illinois grade history and teaching from the university&apos;s own Teachers Ranked
            as Excellent lists; a course missing from either is not marked down for it.
          </p>
        </div>
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
                here leaves this device. A transcript you upload is sent once to be read
                and is not kept.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </p>
    </aside>
  );
}

/**
 * The area's own heading, or null when the catalog page prints none.
 *
 * programs.json reports labelKnown false with label null for 358 of the 1,155
 * requirement areas, because those parts of the page really are unheaded.
 * RequirementArea types label as a string, so the null arrives through a type
 * that says it cannot, and reading it as a string put an empty heading on the
 * row. Nothing here invents a name for one: an invented name is a fact about
 * the university that the university never published.
 */
function headingOf(area: RequirementArea): string | null {
  const label = String(area.label ?? '').trim();
  return label.length > 0 ? label : null;
}

/** The size a row is measured against: its own published number, else the page area's hours. */
function targetOf(row: AreaRow): number {
  if (row.needed !== undefined) return row.needed ?? 0;
  return row.area.hours;
}

/**
 * "4/4", "1/1 course", "2/3 semesters", or "12 hr" when the page gave no size.
 *
 * The unit is written out only where it is not hours, because hours are what
 * every other number on this rail is in and "6/6 hr" nine times down a column
 * is noise. A count of courses or semesters has to say so, or "1/1" under
 * "Cultural Studies" reads as one hour.
 */
function figureOf(row: AreaRow): string {
  const unit = row.unit ?? 'hr';
  const target = targetOf(row);
  if (!target) {
    if (unit === 'hr') return `${row.earned} hr`;
    return `${row.earned} ${unit}${row.earned === 1 ? '' : 's'}`;
  }
  if (unit === 'hr') return `${row.earned}/${target}`;
  return `${row.earned}/${target} ${unit}${target === 1 ? '' : 's'}`;
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
