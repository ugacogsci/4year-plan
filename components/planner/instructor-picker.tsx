'use client';

/**
 * "My instructor": which instructor the student has, or will take, for a
 * course in a term. The choice is saved on the plan (lib/planner/instructors.ts)
 * so ALMA and ARCH answer syllabus questions for that instructor.
 *
 * Two places offer it, both in Cameron's own pieces: a submenu on the course
 * card's menu (DropdownMenu), and a row in the course popup on the map
 * (NativeSelect, like the popup's term picker), which also takes a typed
 * name for an instructor the lists do not have.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import type { InstructorOption } from '@/lib/planner/instructors';

/** What the board hands a card, and the map popup, for the instructor choice. */
export interface InstructorControl {
  /** The student's instructor for a course in a term, or null for "not sure yet". */
  chosen: (courseId: string, termId: string) => string | null;
  /** Who can be picked: the term's published sections (UGA: its Schedule of Classes), then the course's syllabi. */
  options: (courseId: string, termId: string) => Promise<InstructorOption[]>;
  set: (courseId: string, termId: string, name: string | null) => void;
  /** "Someone else": open the course popup with the name field ready. */
  typeOwn: (courseId: string, termId: string) => void;
}

const NOT_SURE = '';
const SOMEONE_ELSE = '__someone-else__';

/** "Prof. Challen", the quiet line on a card. */
export function instructorShort(name: string): string {
  const words = name.trim().split(/\s+/);
  return `Prof. ${words[words.length - 1] ?? name}`;
}

/** Why an option is offered, in a few words. */
function optionNote(option: InstructorOption, termLabel: string | null): string {
  if (option.teaching && termLabel) return `teaches ${termLabel}`;
  if (option.scheduledTerms?.length) return `on the ${option.scheduledTerms[0]} schedule`;
  if (option.syllabusTerms.length > 0) return `syllabus ${option.syllabusTerms[0]}`;
  return '';
}

/** The options, with a typed name the lists do not have kept as its own entry. */
function withChosen(options: InstructorOption[], chosen: string | null): InstructorOption[] {
  if (!chosen || options.some((o) => o.name === chosen)) return options;
  return [{ name: chosen, teaching: false, syllabusTerms: [] }, ...options];
}

/**
 * The list for a course in a term, loaded when it is first wanted. Kept with
 * the key it was loaded for, so a different course or term reads as "still
 * loading" (null) until its own list arrives.
 */
function useOptions(control: InstructorControl, courseId: string, termId: string, active: boolean) {
  const key = `${termId}|${courseId}`;
  const [loaded, setLoaded] = useState<{ key: string; options: InstructorOption[] } | null>(null);
  // The board hands a new control each render; the course and term decide what loads.
  const load = useEffectEvent((course: string, term: string) => control.options(course, term));
  useEffect(() => {
    if (!active) return;
    let live = true;
    void load(courseId, termId)
      .catch(() => [])
      .then((options) => {
        if (live) setLoaded({ key: `${termId}|${courseId}`, options });
      });
    return () => {
      live = false;
    };
  }, [courseId, termId, active]);
  return loaded?.key === key ? loaded.options : null;
}

/** The submenu on a course card's menu. */
export function CardInstructorMenu({
  control,
  courseId,
  courseCode,
  termId,
  termLabel,
  open,
}: {
  control: InstructorControl;
  courseId: string;
  courseCode: string;
  termId: string;
  termLabel: string;
  /** Whether the card's menu is open; the list loads then. */
  open: boolean;
}) {
  const chosen = control.chosen(courseId, termId);
  const options = useOptions(control, courseId, termId, open);
  const shown = withChosen(options ?? [], chosen);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <UserRound /> My instructor
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="course-options-menu course-alternatives-menu course-instructor-menu" aria-label={`Your ${courseCode} instructor in ${termLabel}`}>
        <DropdownMenuRadioGroup
          value={chosen ?? NOT_SURE}
          onValueChange={(value) => control.set(courseId, termId, value === NOT_SURE ? null : String(value))}
        >
          <DropdownMenuRadioItem value={NOT_SURE} closeOnClick>Not sure yet</DropdownMenuRadioItem>
          {shown.map((option) => (
            <DropdownMenuRadioItem key={option.name} value={option.name} closeOnClick>
              <span>
                {option.name}
                {optionNote(option, termLabel) && <small>{optionNote(option, termLabel)}</small>}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {options === null && <p className="course-instructor-loading">Reading the instructors.</p>}
        {options !== null && options.length === 0 && (
          <p className="course-instructor-loading">No instructor is named for {termLabel} or on a syllabus.</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => control.typeOwn(courseId, termId)}>Someone else (type a name)</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The row in the map's course popup, for a course on the board. */
export function InstructorPicker({
  control,
  courseId,
  courseCode,
  termId,
  termLabel,
  startTyping = false,
}: {
  control: InstructorControl;
  courseId: string;
  courseCode: string;
  termId: string;
  termLabel: string;
  /** Opened from the card's "Someone else": start with the name field. The popup keys this component by course, term and this, so each starts fresh. */
  startTyping?: boolean;
}) {
  const chosen = control.chosen(courseId, termId);
  const options = useOptions(control, courseId, termId, true);
  const shown = withChosen(options ?? [], chosen);
  const [typing, setTyping] = useState(startTyping);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  function save() {
    const name = draft.replace(/\s+/g, ' ').trim();
    if (!name) return;
    control.set(courseId, termId, name);
    setTyping(false);
    setDraft('');
  }

  return (
    <div className="inspector-instructor">
      <span className="inspector-instructor-label">My instructor, {termLabel}</span>
      <NativeSelect
        aria-label={`Your ${courseCode} instructor in ${termLabel}`}
        value={typing ? SOMEONE_ELSE : (chosen ?? NOT_SURE)}
        onChange={(event) => {
          const value = event.target.value;
          if (value === SOMEONE_ELSE) {
            setTyping(true);
            return;
          }
          setTyping(false);
          control.set(courseId, termId, value === NOT_SURE ? null : value);
        }}
      >
        <NativeSelectOption value={NOT_SURE}>Not sure yet</NativeSelectOption>
        {shown.map((option) => {
          const note = optionNote(option, termLabel);
          return (
            <NativeSelectOption key={option.name} value={option.name}>
              {note ? `${option.name} (${note})` : option.name}
            </NativeSelectOption>
          );
        })}
        <NativeSelectOption value={SOMEONE_ELSE}>Someone else (type a name)</NativeSelectOption>
      </NativeSelect>
      {typing && (
        <form
          className="inspector-instructor-own"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            ref={inputRef}
            value={draft}
            maxLength={80}
            placeholder="Instructor's name"
            aria-label={`Type your ${courseCode} instructor's name`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" className="inspector-add-button" disabled={!draft.trim()}>
            Save
          </Button>
        </form>
      )}
      <p className="inspector-instructor-note">
        {options === null
          ? 'Reading the instructors.'
          : chosen
            ? 'Syllabus answers in the chat are for this instructor.'
            : 'Set it and syllabus answers in the chat are for your instructor.'}
      </p>
    </div>
  );
}
