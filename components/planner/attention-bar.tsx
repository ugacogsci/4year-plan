'use client';

/**
 * The board bar's word on the plan: at most three things that matter now, in
 * plain words, and everything else behind "Show N more" (warnings-triage.ts).
 *
 * This replaced a row of one red or yellow dot per plan-wide note beside "11
 * things need attention: ...; 4 more kinds". Most of those dots were good to
 * know (a requirement for an advisor to check, credit conditional on classes
 * in progress) or were explained by credit the student had not added yet.
 * Nothing is dropped: every row is one click away, ranked the same way the
 * advisor reads it.
 */

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { splitCourseMentions } from '@/lib/planner/course-mentions';
import type { Course, PlanIssue } from '@/lib/planner/types';
import type { AttentionKind, Triage, TriageRow } from '@/lib/planner/warnings-triage';

interface LinkProps {
  coursesByCode?: ReadonlyMap<string, Course>;
  onShowCourse?: (courseId: string) => void;
}

/** Course codes in a message become links to the map, as on the course-card marks (issue-badge.tsx). */
function Linked({ text, coursesByCode, onShowCourse, onNavigate }: LinkProps & { text: string; onNavigate: () => void }) {
  if (!coursesByCode || !onShowCourse) return <>{text}</>;
  return (
    <>
      {splitCourseMentions(text, coursesByCode).map((part, index) =>
        part.course ? (
          <button
            key={index}
            type="button"
            className="issue-course-link"
            aria-label={`Show ${part.course.code} on course map`}
            onClick={(event) => {
              event.stopPropagation();
              onNavigate();
              onShowCourse(part.course!.id);
            }}
          >
            {part.text}
          </button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** One row: its title opens it on the board, its message reads in full. */
function Row({ row, tone, onSelect, close, ...links }: LinkProps & { row: TriageRow; tone: 'now' | 'later'; onSelect: (issue: PlanIssue) => void; close: () => void }) {
  return (
    <li className={cn('attention-row', `attention-row-${tone}`)}>
      <span className={cn('attention-dot', tone === 'now' ? `is-${row.issue.severity}` : 'is-info')} aria-hidden="true" />
      <span className="attention-row-text">
        <button
          type="button"
          className="attention-row-title"
          onClick={() => {
            close();
            onSelect(row.issue);
          }}
        >
          {row.issue.title}
          {row.count > 1 && ` (${row.count})`}
        </button>
        <span>
          <Linked text={row.issue.message} onNavigate={close} {...links} />
        </span>
      </span>
    </li>
  );
}

function Section({ title, note, rows, tone, ...rest }: LinkProps & { title: string; note?: string; rows: TriageRow[]; tone: 'now' | 'later'; onSelect: (issue: PlanIssue) => void; close: () => void }) {
  if (rows.length === 0) return null;
  return (
    <section className="attention-section" aria-label={title}>
      <h3>{title}</h3>
      {note && <p>{note}</p>}
      <ul>
        {rows.map((row) => (
          <Row key={`${row.issue.id}|${row.issue.message}`} row={row} tone={tone} {...rest} />
        ))}
      </ul>
    </section>
  );
}

/** One prominent kind: a dot and plain words; its rows open beneath it. */
function Chip({ kind, onSelect, ...links }: LinkProps & { kind: AttentionKind; onSelect: (issue: PlanIssue) => void }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const rows = kind.rows.length > 0 ? kind.rows : [{ issue: kind.issue, count: 1, folded: false, kind: { key: kind.key, text: kind.label, tier: 'now' as const, rank: 0, record: false } }];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<button type="button" className={cn('attention-chip', kind.key === 'record' && 'attention-chip-record')} title={kind.label} />}
      >
        <span className={cn('attention-dot', `is-${kind.severity}`)} aria-hidden="true" />
        <span className="attention-chip-text">{kind.label}</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="attention-popover" positionerClassName="attention-positioner" collisionPadding={12}>
        <PopoverTitle>{kind.key === 'record' ? 'Credit the plan cannot see' : kind.label}</PopoverTitle>
        <div className="attention-body">
          {kind.key === 'record' ? (
            <p>
              <Linked text={kind.issue.message} onNavigate={close} {...links} />
            </p>
          ) : (
            <ul>
              {rows.map((row) => (
                <Row key={`${row.issue.id}|${row.issue.message}`} row={row} tone="now" onSelect={onSelect} close={close} {...links} />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AttentionBar({
  triage,
  onSelectIssue,
  coursesByCode,
  onShowCourse,
}: LinkProps & {
  triage: Triage;
  onSelectIssue: (issue: PlanIssue) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const prominent = new Set(triage.prominent.flatMap((kind) => kind.rows));
  const nowMore = triage.now.flatMap((kind) => kind.rows).filter((row) => !prominent.has(row));
  const links = { coursesByCode, onShowCourse };
  return (
    <div className="attention-bar" aria-label="What needs attention">
      {triage.allClear ? (
        <span className="attention-clear">Nothing needs attention.</span>
      ) : (
        triage.prominent.map((kind) => <Chip key={kind.key} kind={kind} onSelect={onSelectIssue} {...links} />)
      )}
      {triage.more.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<button type="button" className="attention-more" />}>
            {/* A fourth thing that matters now is folded too, so the button says so. */}
            Show {triage.more.length} more{nowMore.length > 0 && <span className="attention-more-now">, {nowMore.length} {nowMore.length === 1 ? 'needs' : 'need'} attention</span>}
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="attention-popover" positionerClassName="attention-positioner" collisionPadding={12}>
            <PopoverTitle>Everything else on this plan</PopoverTitle>
            <div className="attention-body">
              <Section title="Also needs attention" rows={nowMore} tone="now" onSelect={onSelectIssue} close={close} {...links} />
              <Section
                title="Waiting for your record"
                note="Credit you already hold may settle these. Add your classes or upload a transcript, and the plan is checked again."
                rows={triage.folded}
                tone="now"
                onSelect={onSelectIssue}
                close={close}
                {...links}
              />
              <Section title="Good to know" rows={triage.later} tone="later" onSelect={onSelectIssue} close={close} {...links} />
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
