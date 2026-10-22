'use client';

/**
 * The semester the student is taking now: the board's first column, marked
 * in progress, holding their real classes (lib/planner/current-term.ts).
 *
 * It is not a planned term. The planner never puts a class here; the
 * student's transcript does (its in-progress lines), or the student does,
 * by hand. So the column has no drag, no "Replace course" and no "Move to":
 * a class here is one they are sitting in. What it does have is what a
 * student asks about a class they are taking: who teaches it (My
 * instructor, the same picker as every card, so ALMA and ARCH answer
 * syllabus questions for that instructor), and a way to say the list is
 * right, add a class it is missing, or take off one they dropped.
 */

import { useMemo, useRef, useState } from 'react';
import { Check, MoreHorizontal, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { CurrentClass } from '@/lib/planner/current-term';
import type { Course, PlanTerm } from '@/lib/planner/types';
import { clusterColor } from './cluster-color';
import { CardInstructorMenu, instructorShort, type InstructorControl } from './instructor-picker';

export interface CurrentTermColumnProps {
  /** The term, as a PlanTerm the instructor picker and the advisor key by ("fall-2026"). */
  term: PlanTerm;
  classes: Array<CurrentClass & { course: Course | null }>;
  /** What the column asks once: transcript classes to confirm, or hand-added ones short of a full load. */
  question: 'confirm' | 'all' | null;
  /** Credits the plan counts for this term beyond the classes on it, until they are entered. */
  assumedHours: number;
  /** "ARCH", "ALMA". */
  botName: string;
  selectedCourseId: string | null;
  /** Catalog courses matching what the student types, best first. */
  search: (query: string) => Course[];
  onAdd: (courseId: string) => void;
  onRemove: (code: string) => void;
  /** Yes, these are my classes this term. */
  onConfirm: () => void;
  /** Open the course's popup: details, and My instructor. */
  onSelect: (courseId: string) => void;
  instructors?: InstructorControl;
  /** The plan cannot change right now (a degree is loading). */
  busy?: boolean;
  /**
   * Where the student's class schedule lives ("Athena", "Student
   * Self-Service"): a screenshot of it, uploaded through the side panel's
   * transcript upload, fills this column (the reader marks a current
   * schedule's classes in progress, app/api/transcript/route.ts).
   */
  scheduleFrom?: string;
  /** Open the side panel's upload, where a schedule screenshot or a transcript is read. */
  onUpload?: () => void;
}

export function CurrentTermColumn({
  term,
  classes,
  question,
  assumedHours,
  botName,
  selectedCourseId,
  search,
  onAdd,
  onRemove,
  onConfirm,
  onSelect,
  instructors,
  busy = false,
  scheduleFrom,
  onUpload,
}: CurrentTermColumnProps) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const credits = classes.reduce((n, c) => n + c.credits, 0);
  const held = useMemo(() => new Set(classes.map((c) => c.code)), [classes]);
  const hits = useMemo(
    () => (query.trim().length >= 2 ? search(query).filter((c) => !held.has(c.code.toUpperCase())).slice(0, 6) : []),
    [query, search, held],
  );

  function openAdd() {
    setAdding(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function add(course: Course) {
    onAdd(course.id);
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const empty = classes.length === 0;
  // An empty column says one plain line, the invite. What the plan counts for
  // the term until then is said by the board bar's prompt for this column
  // (warnings-triage.ts) and on hover over "no classes yet".
  const countLine = assumedHours > 0 && !empty ? `Until you add the rest, this plan counts about ${assumedHours} more credits for ${term.label}.` : null;
  const countTitle = assumedHours > 0 && empty ? `Until you add them, this plan counts ${term.label} as about ${assumedHours} credits, a usual full load.` : undefined;

  return (
    <section
      id={`term-${term.id}`}
      className="semester-column current-term-column"
      aria-label={`${term.label}, in progress`}
      data-current="true"
    >
      <header className="semester-heading">
        <div className="semester-heading-title">
          <h3>
            {term.label}
            <small className="current-term-badge">In progress</small>
          </h3>
        </div>
        <p className="semester-credit-count" title={countTitle}>{empty ? 'no classes yet' : `${credits} ${credits === 1 ? 'credit' : 'credits'}`}</p>
      </header>

      {question && !editing && (
        <div className="current-term-ask" role="group" aria-label={`Your ${term.label} classes`}>
          <p>{question === 'confirm' ? 'Are these your current classes?' : `Is that all your classes this semester?`}</p>
          <div className="current-term-ask-buttons">
            <Button type="button" size="sm" className="current-term-yes" disabled={busy} onClick={onConfirm}>
              <Check aria-hidden="true" /> Yes
            </Button>
            {question === 'confirm' ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            ) : (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={openAdd}>
                <Plus aria-hidden="true" /> Add more
              </Button>
            )}
          </div>
        </div>
      )}

      {empty && (
        <p className="semester-note current-term-invite" role="note">
          Add the classes you&apos;re taking now
          {onUpload ? (
            <>
              , or{' '}
              <button type="button" className="current-term-upload" onClick={onUpload}>
                upload a screenshot of your {scheduleFrom ?? 'class'} schedule
              </button>
              ,
            </>
          ) : null}{' '}
          so ORION and {botName} can help with this semester.
        </p>
      )}
      {!empty && countLine && <p className="semester-note" role="note">{countLine}</p>}

      <div className="semester-courses">
        {classes.map((c) => {
          const chosen = c.courseId && instructors ? instructors.chosen(c.courseId, term.id) : null;
          return (
            <article
              key={c.code}
              id={c.courseId ? `planned-${term.id}-${c.courseId}` : undefined}
              className={cn('course-card current-class-card', selectedCourseId !== null && selectedCourseId === c.courseId && 'course-card-selected')}
              data-course-id={c.courseId ?? undefined}
            >
              <span className="current-class-spacer" aria-hidden="true" />
              <span className="course-cluster-dot" style={{ backgroundColor: clusterColor(c.course?.cluster ?? c.code.split(' ')[0]) }} />
              <button
                type="button"
                className="course-card-body focus-visible:outline-none"
                disabled={!c.courseId}
                onClick={() => c.courseId && onSelect(c.courseId)}
                title={c.courseId ? `${c.code}: details and My instructor` : `${c.code} is not in the catalog the planner reads`}
              >
                <span className="course-card-code-row">
                  <span className="course-card-code">{c.code}</span>
                  <span className="course-card-credits">{c.credits} cr</span>
                </span>
                <span className="course-card-title">{c.title}</span>
                <span className="current-class-from">{c.from === 'transcript' ? 'from your upload' : 'added by you'}</span>
              </button>
              {editing ? (
                <button
                  type="button"
                  className="current-class-action current-class-remove"
                  onClick={() => onRemove(c.code)}
                  title={`Take ${c.code} off your ${term.label} classes`}
                >
                  <X aria-hidden="true" /> Not taking it
                </button>
              ) : (
                <button
                  type="button"
                  className="current-class-action current-class-instructor"
                  disabled={!c.courseId}
                  onClick={() => c.courseId && onSelect(c.courseId)}
                  title={chosen ? `Your instructor in ${term.label}: ${chosen}. Answers about this class are for them.` : `Who teaches your ${c.code} section: answers about this class follow it`}
                >
                  <UserRound aria-hidden="true" /> {chosen ? instructorShort(chosen) : 'Set my instructor'}
                </button>
              )}
              <DropdownMenu onOpenChange={(open) => setMenuFor(open ? c.code : null)}>
                <DropdownMenuTrigger
                  aria-label={`Options for ${c.code}`}
                  render={<Button variant="ghost" size="icon-sm" title={`Options for ${c.code}`} />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {/* A label outside a Group throws in Base UI (see course-card.tsx). */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{c.code}, {term.label}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  {instructors && c.courseId && (
                    <CardInstructorMenu
                      control={instructors}
                      courseId={c.courseId}
                      courseCode={c.code}
                      termId={term.id}
                      termLabel={term.label}
                      open={menuFor === c.code}
                    />
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onRemove(c.code)}>
                    <Trash2 /> I&apos;m not taking it
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </article>
          );
        })}

        {adding ? (
          <form
            className="current-term-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (hits[0]) add(hits[0]);
            }}
          >
            <div className="current-term-add-row">
              <Input
                ref={inputRef}
                value={query}
                placeholder="Course code or title"
                aria-label={`Add a class you're taking in ${term.label}`}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setAdding(false);
                    setQuery('');
                  }
                }}
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" title="Close" onClick={() => { setAdding(false); setQuery(''); }}>
                <X />
              </Button>
            </div>
            {hits.length > 0 && (
              <ul className="current-term-hits" aria-label="Matching courses">
                {hits.map((course) => (
                  <li key={course.id}>
                    <button type="button" onClick={() => add(course)} disabled={busy}>
                      <strong>{course.code}</strong> {course.title} <small>{course.credits} cr</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && hits.length === 0 && <p className="current-term-none">No course in the catalog matches that.</p>}
          </form>
        ) : (
          <Button type="button" variant="ghost" className="semester-add-button" disabled={busy} onClick={openAdd}>
            <Plus /> Add a class you&apos;re taking now
          </Button>
        )}
        {editing && (
          <Button type="button" size="sm" className="current-term-done" onClick={() => { setEditing(false); setAdding(false); onConfirm(); }}>
            <Check aria-hidden="true" /> Done, these are my classes
          </Button>
        )}
      </div>
    </section>
  );
}
