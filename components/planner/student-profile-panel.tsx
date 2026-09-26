'use client';

/**
 * The rail: who you are and how far along you are.
 *
 * Degree progress is always visible because it is the only thing here a student
 * reads rather than edits. Everything editable sits behind two closed
 * disclosures, which is what four open accordions of dropdowns used to cost:
 * 888px of panel on arrival for settings almost nobody changes.
 */

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Info, RotateCcw, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { RequirementArea } from '@/lib/planner/scheduler';
import { ProgramPicker, type ProgramOption } from './program-picker';
import { EmphasisPicker } from './emphasis-picker';
import type { UgaSelectionRequirement } from './uga-source';
import type { ProgramLevel } from '@/lib/planner/onboarding';

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
  programUrls: Array<{ name: string; url: string }>;
  digest: string;
  onStartOver: () => void;
  onClose: () => void;
  plannedCredits: string;
  /**
   * The whole sentence about where the student is, shown only when they walked
   * in with credit. "88 to 90 cr of 128" on its own is the right number and
   * still leaves a transfer student guessing which half of it is theirs.
   */
  creditNote?: string | null;
  degreeTotal: number | null;
  priorCount: number;
  priorCourses: Array<{ code: string; title: string }>;
  areas: AreaRow[];
  programLevel: ProgramLevel;
  supportsGraduatePrograms: boolean;
  onProgramLevelChange: (level: ProgramLevel) => void;
  programs: ProgramOption[];
  programIds: string[];
  onProgramsChange: (ids: string[]) => void;
  minors: ProgramOption[];
  minorIds: string[];
  onMinorsChange: (ids: string[]) => void;
  certificates: ProgramOption[];
  certificateIds: string[];
  onCertificatesChange: (ids: string[]) => void;
  emphasisRequirements: UgaSelectionRequirement[];
  emphasisSelections: Record<string, string[]>;
  onEmphasisChange: (next: Record<string, string[]>) => void;
  minimumTermCredits: number;
  onMinimumChange: (value: number) => void;
  /** What a term should hold, or null for an even spread. The scheduler goes past it only to fit the degree in time. */
  targetTermCredits: number | null;
  onTargetChange: (value: number | null) => void;
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
  /** The transcript upload, rendered by the caller for the same reason the pools are. */
  transcript?: ReactNode;
}

/**
 * Keep free-form typing local until the student leaves the field.
 *
 * The committed value changes elective ranking. Sending every keystroke to the
 * workspace made an open replacement picker rescore the full catalog while the
 * textarea was still handling its own change event, which was both slow and
 * could drive React into a nested-update loop.
 */
function CareerInterestsField({
  initialValue,
  onCommit,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initialValue);

  return (
    <label className="rail-field">
      <span>What you want to be doing after</span>
      <textarea
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== initialValue) onCommit(draft);
        }}
      />
    </label>
  );
}

export function StudentProfilePanel({
  schoolName,
  schoolShort,
  portal,
  programName,
  programUrls,
  onStartOver,
  onClose,
  plannedCredits,
  creditNote,
  degreeTotal,
  priorCount,
  priorCourses,
  areas,
  programLevel,
  supportsGraduatePrograms,
  onProgramLevelChange,
  programs,
  programIds,
  onProgramsChange,
  minors,
  minorIds,
  onMinorsChange,
  certificates,
  certificateIds,
  onCertificatesChange,
  emphasisRequirements,
  emphasisSelections,
  onEmphasisChange,
  minimumTermCredits,
  onMinimumChange,
  targetTermCredits,
  onTargetChange,
  careerInterests,
  onCareerChange,
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
    <aside
      id="planner-progress"
      className="rail"
      aria-label="Your profile and progress"
      data-school={schoolShort}
    >
      <button
        type="button"
        className="rail-close"
        onClick={onClose}
        aria-label="Close progress"
      >
        <X aria-hidden="true" />
      </button>
      <div className="rail-school">
        <span className="rail-school-mark" aria-hidden="true">
          <Image
            src={schoolShort === 'UGA' ? '/uga-school-logo.png' : '/illinois-school-logo.png'}
            alt=""
            className={schoolShort === 'UGA' ? undefined : 'is-illinois-original'}
            width={schoolShort === 'UGA' ? 628 : 1408}
            height={schoolShort === 'UGA' ? 628 : 1408}
          />
        </span>
        <span className="rail-school-name">{schoolName}</span>
      </div>

      <h2 className="rail-program-name">{programName ?? 'No degree chosen'}</h2>

      <div className="rail-progress">
        <div className="rail-progress-head">
          <strong>{plannedCredits}</strong>
          <span>{degreeTotal ? `of ${degreeTotal} for the degree` : 'degree total not published'}</span>
        </div>
        <Bar percent={degreeTotal ? percentOf(plannedCredits, degreeTotal) : 0} />
        <details className="rail-completed">
          <summary>
            <span>Already taken</span>
            <span>{priorCount} course{priorCount === 1 ? '' : 's'}</span>
          </summary>
          {priorCourses.length > 0 && (
            <div className="completed-course-list" aria-label="Classes already taken">
              {priorCourses.map((course) => (
                <span key={course.code} title={course.title}>
                  {course.code}
                </span>
              ))}
            </div>
          )}
          {transcript}
        </details>
        {creditNote && <p className="rail-credit-note">{creditNote}</p>}
      </div>

      {areas.length > 0 && (
        <details className="rail-requirements">
          <summary>
            <span>Degree requirements</span>
            <strong>{areas.filter((row) => row.satisfied).length}/{areas.length}</strong>
          </summary>
          <div className="requirement-list">
            {named.map(({ row, key, heading }, index) => (
              <div className="requirement-row" key={key}>
                <span className="requirement-index" aria-hidden="true">{index + 1}.</span>
                <div>
                  <span title={heading ?? undefined}>{heading}</span>
                  <span>{row.area.hours ? `${row.earned}/${row.area.hours} cr` : `${row.earned} cr`}</span>
                </div>
                {row.area.hours > 0 && <Bar percent={row.percent} />}
              </div>
            ))}
            {unnamed.map(({ row, key }, index) => (
              <div className="requirement-row" key={key}>
                <span className="requirement-index" aria-hidden="true">{named.length + index + 1}.</span>
                <div>
                  <span className="requirement-unnamed" title="The catalog page prints this block with no heading.">
                    No heading published
                  </span>
                  <span>{row.area.hours ? `${row.earned}/${row.area.hours} cr` : `${row.earned} cr`}</span>
                </div>
                {row.area.hours > 0 && <Bar percent={row.percent} />}
              </div>
            ))}
            {quiet > 0 && <p className="requirement-unnamed">{quiet} unmeasured catalog {quiet === 1 ? 'section' : 'sections'} hidden.</p>}
          </div>
          {pools}
        </details>
      )}

      <details className="rail-section" id="rail-programs">
        <summary>Programs</summary>
        {supportsGraduatePrograms && (
          <label className="rail-field rail-program-level">
            <span>Program level</span>
            <select
              value={programLevel}
              onChange={(event) =>
                onProgramLevelChange(event.target.value as ProgramLevel)
              }
            >
              <option value="undergraduate">Undergraduate</option>
              <option value="graduate">Graduate &amp; professional</option>
            </select>
          </label>
        )}
        <span className="rail-program-label">
          {programLevel === 'graduate' ? 'Degree programs' : 'Majors'}
        </span>
        <ProgramPicker
          compact
          kindLabel={programLevel === 'graduate' ? 'degree' : 'major'}
          options={programs}
          selectedIds={programIds}
          onChange={onProgramsChange}
        />
        {minors.length > 0 && (
          <>
            <span className="rail-program-label">Minors</span>
            <ProgramPicker
              compact
              kindLabel="minor"
              options={minors}
              selectedIds={minorIds}
              onChange={onMinorsChange}
            />
          </>
        )}
        {certificates.length > 0 && (
          <>
            <span className="rail-program-label">
              {programLevel === 'graduate' ? 'Graduate certificates' : 'Certificates'}
            </span>
            <ProgramPicker
              compact
              kindLabel="certificate"
              options={certificates}
              selectedIds={certificateIds}
              onChange={onCertificatesChange}
            />
          </>
        )}
        <EmphasisPicker
          compact
          requirements={emphasisRequirements}
          selections={emphasisSelections}
          onChange={onEmphasisChange}
        />
        {programUrls.length > 0 && (
          <p className="rail-note program-catalog-links" style={{ margin: 0, paddingTop: 0, border: 0 }}>
            {programUrls.map((program) => (
              <a key={program.url} href={program.url} target="_blank" rel="noreferrer">
                {program.name} catalog page
              </a>
            ))}
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
        <p className="rail-field rail-helper">
          Blank means balanced: every term takes an even share of what is left. Press Rebuild
          after changing these. Your graduation date comes first, so a term goes past the number
          you set only when the degree would not fit in time otherwise, and never past 18.
        </p>
        <CareerInterestsField
          key={careerInterests}
          initialValue={careerInterests}
          onCommit={onCareerChange}
        />
        <p className="rail-field rail-helper">
          Used to rank elective suggestions after you press Rebuild.
        </p>
      </details>

      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="rail-info-trigger"
              aria-label="Plan assumptions and setup"
              title="Plan assumptions and setup"
            />
          }
        >
          <Info aria-hidden="true" />
        </PopoverTrigger>
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
            <button type="button" className="rail-restart-button" onClick={onStartOver}>
              <RotateCcw aria-hidden="true" /> Change university or restart setup
            </button>
          </div>
        </PopoverContent>
      </Popover>
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
