/**
 * The semester the student is taking now, as the board shows it.
 *
 * A plan built in October starts in Spring, the first term a student can
 * still sign up for, so the fall they are sitting in had no column: a UGA
 * board filled it with the planner's own picks, an Illinois board left it
 * off, and "how's my attendance this semester?" or "who's my professor for
 * ECON 2105?" had nothing real to look at. The current semester is now the
 * board's first column, marked in progress, and it holds only the student's
 * real classes: the in-progress lines of their uploaded transcript, the
 * classes they add by hand, and nothing the planner chose.
 *
 * One source of truth. Those classes are lines of the student's record
 * (answers.transcript), as in-progress lines always were, so every count
 * that already treats in-progress credit as held (the headline, the
 * requirement rows, UGA's conditional-credit audit, the rebuild that keeps
 * them off later terms) sees them without a second list. A class added by
 * hand is an in-progress line the student typed (matchedBy 'student'), the
 * same kind ALMA's record_prior_credit writes. The column is a view of the
 * record for one term, so it is saved with the answers, survives reload and
 * Rebuild, and is the same on every plan tab.
 *
 * Nothing here touches the planned terms: the plan's own columns are built
 * exactly as before (plan-start.ts decides where they start).
 */
import { normalizeCourseCode, normalizeTerm, type TranscriptCourseRecord, type TranscriptRecord } from './transcript';
import type { PlanState, PlanTerm, SemesterSeason } from './types';

export type TermRef = { season: SemesterSeason; year: number };

/**
 * A full-time undergraduate load at both schools: 12 credit hours a fall or
 * spring. Illinois: "Full-time enrollment for students in a Fall or Spring
 * term is 12 or more hours" (registrar.illinois.edu/registration/
 * registration-process/max-min-enrollment-levels/, as college-rules.ts
 * cites it). UGA: "Undergraduate/Professional Students: 12 or more hours
 * (full-time)" for fall and spring (reg.uga.edu/student-records/
 * enrollment-verifications/, read 2026-10-20). A current term the student
 * has entered fewer hand-added hours than this for is read as not finished
 * being entered, not as a part-time term, until they say so.
 */
export const FULL_TIME_HOURS = 12;

const ord = (t: TermRef) => t.year * 3 + (t.season === 'Spring' ? 0 : t.season === 'Summer' ? 1 : 2);
export const termOrdOf = ord;
export const sameTerm = (a: TermRef | null | undefined, b: TermRef | null | undefined) => Boolean(a && b && a.season === b.season && a.year === b.year);
export const termLabel = (t: TermRef) => `${t.season} ${t.year}`;
/** The id the engine gives a term ("fall-2026"), so instructor choices and section lookups key the same way. */
export const termIdOf = (t: TermRef) => `${t.season.toLowerCase()}-${t.year}`;

/** "Fall 2026", "FA26", "Fall Semester 2026": the term a line names, or null. */
export function termOfLine(line: Pick<TranscriptCourseRecord, 'term'>): TermRef | null {
  const m = (normalizeTerm(line.term) ?? '').match(/^(Fall|Spring|Summer) (\d{4})$/);
  return m ? { season: m[1] as SemesterSeason, year: Number(m[2]) } : null;
}

/**
 * The lines of the record the student is taking in `term`: in progress,
 * counted, and either dated that term or dated no term at all (a class told
 * to ALMA "in progress" before lines carried the term, which can only be
 * this one). A line from another school counts too: a class taken at
 * Parkland this fall is still a class this semester.
 */
export function currentLines(record: TranscriptRecord | null | undefined, term: TermRef): TranscriptCourseRecord[] {
  return (record?.courses ?? []).filter((c) => {
    if (!c.use || c.status !== 'in_progress' || c.counts === 'none') return false;
    const at = termOfLine(c);
    return at === null || sameTerm(at, term);
  });
}

/** Hours a line earns, the way the record's own summary counts them. */
export const lineHours = (c: TranscriptCourseRecord) => c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0;

/** Whether every current line was typed by the student (by hand on the board, or told to ALMA). */
export function enteredByHand(lines: readonly TranscriptCourseRecord[]): boolean {
  return lines.length > 0 && lines.every((c) => c.matchedBy === 'student');
}

/** Whether the student said these are their classes this term ("Yes" on the column's question). */
export function currentConfirmed(record: TranscriptRecord | null | undefined, term: TermRef): boolean {
  return record?.currentConfirmed === termLabel(term);
}

/**
 * What the term in progress still counts as beyond the classes entered for
 * it, and why. The rule, the same at both schools:
 *
 *   - no class entered: the caller's assumed-terms rule decides (start-term.ts:
 *     about 15 credits for a term since the student began, never for a record's
 *     own start), so nothing is added here;
 *   - classes from a transcript: the record lists what they are registered
 *     for, so those classes are the term, nothing assumed;
 *   - classes added by hand, fewer than a full-time load (12), and the student
 *     has not said that is all: the rest of a usual 15-credit term is counted
 *     until they add the rest or say that is all. Without it, adding one
 *     3-credit class took 12 credits off the plan's count at once: a UGA board
 *     then read "Degree credits are short" until Rebuild, and each class added
 *     after it rebuilt a heavier plan around a term only partly typed in.
 *
 * The board says so in the column, plainly, whenever it counts any.
 */
export function partlyEnteredHours(lines: readonly TranscriptCourseRecord[], confirmed: boolean, fullLoad = 15): number {
  if (confirmed || !enteredByHand(lines)) return 0;
  const entered = Math.round(lines.reduce((n, c) => n + lineHours(c), 0));
  if (entered >= FULL_TIME_HOURS) return 0;
  const left = fullLoad - entered;
  return left >= 3 ? left : 0;
}

/**
 * The term under way on `today`, as the calendar has it ("in progress"):
 * a fall or a spring, or a summer only when the record has summer classes in
 * progress. Null in a summer with none.
 */
export function termUnderWay(calendar: TermRef, record: TranscriptRecord | null | undefined): TermRef | null {
  if (calendar.season !== 'Summer') return calendar;
  return (record?.courses ?? []).some((c) => c.use && c.status === 'in_progress' && sameTerm(termOfLine(c), calendar)) ? calendar : null;
}

/**
 * Whether the board shows a current-semester column, and for which term.
 * Shown when the term under way comes before the plan's first term (the
 * plan starts at the next term the student can still register for) and the
 * student may be in it: not one who has not started college yet, nor one
 * away that term. A board that already holds the term (one saved while it
 * was still open) shows it as its own column instead, never twice.
 */
export function currentTermFor(input: {
  underWay: TermRef | null;
  start: TermRef;
  notStarted: boolean;
  away: readonly TermRef[];
  boardTerms?: readonly Pick<PlanTerm, 'label'>[];
}): TermRef | null {
  const t = input.underWay;
  if (!t || ord(t) >= ord(input.start) || input.notStarted) return null;
  if (input.away.some((a) => sameTerm(a, t))) return null;
  if (input.boardTerms?.some((b) => b.label === termLabel(t))) return null;
  return t;
}

/** The column as a term, for the advisor's tools and the instructor picker: never part of the plan's own terms. */
export function currentPlanTerm(term: TermRef, courseIds: string[]): PlanTerm {
  return { id: termIdOf(term), label: termLabel(term), year: 0, season: term.season, courseIds };
}

/**
 * The record with a class the student is taking now added by hand. A record
 * is made when there is none yet. A line they took off earlier for the same
 * course this term is switched back on instead of doubled, and a class
 * already in the term gives the same record back.
 */
export function withCurrentClass(
  record: TranscriptRecord | null | undefined,
  course: { code: string; title: string; credits: number },
  term: TermRef,
  school: { id: 'uga' | 'illinois'; label: string },
  now = new Date(),
): TranscriptRecord {
  const code = normalizeCourseCode(course.code);
  const base: TranscriptRecord = record ?? {
    schoolId: school.id,
    fileName: school.label,
    readAt: now.toISOString(),
    institution: null,
    kind: 'course_list',
    home: true,
    files: [],
    courses: [],
    exams: [],
    notes: [],
  };
  const label = termLabel(term);
  // Already one of this term's classes: nothing to add.
  if (record && currentLines(record, term).some((c) => (c.matched ?? normalizeCourseCode(c.code)) === code)) return record;
  const off = base.courses.findIndex((c) => !c.use && c.status === 'in_progress' && (c.matched === code || normalizeCourseCode(c.code) === code) && sameTerm(termOfLine(c), term));
  if (off >= 0) {
    const was = base.courses[off];
    return { ...base, courses: base.courses.map((c, i) => (i === off ? { ...was, use: true, counts: 'course', matched: code, matchedBy: was.matchedBy ?? 'student' } : c)) };
  }
  const line: TranscriptCourseRecord = {
    code,
    title: course.title,
    credits: course.credits,
    grade: null,
    term: label,
    status: 'in_progress',
    from: null,
    equivalent: null,
    matched: code,
    matchedBy: 'student',
    use: true,
    counts: 'course',
    illinoisCredits: course.credits,
  };
  return { ...base, courses: [...base.courses, line] };
}

/**
 * The record without a current class: a line the student typed is taken
 * off, and a transcript's line is kept but no longer counted (they dropped
 * the class, or the reading was wrong), as the credit panel's own switch does.
 */
export function withoutCurrentClass(record: TranscriptRecord, code: string, term: TermRef): TranscriptRecord {
  const want = normalizeCourseCode(code);
  const hit = (c: TranscriptCourseRecord) =>
    c.use && c.status === 'in_progress' && (c.matched === want || normalizeCourseCode(c.code) === want) && (termOfLine(c) === null || sameTerm(termOfLine(c), term));
  return {
    ...record,
    courses: record.courses.flatMap((c) => (!hit(c) ? [c] : c.matchedBy === 'student' ? [] : [{ ...c, use: false }])),
  };
}

/** The record with the student's "yes, these are my classes" for the term, or that answer taken back. */
export function withCurrentConfirmed(record: TranscriptRecord, term: TermRef, yes: boolean): TranscriptRecord {
  const next: TranscriptRecord = { ...record };
  if (yes) next.currentConfirmed = termLabel(term);
  else delete next.currentConfirmed;
  return next;
}

/** One class in the current column, as the board and the advisor read it. */
export interface CurrentClass {
  code: string;
  title: string;
  credits: number;
  /** Where it came from: the uploaded transcript, or typed by the student (on the board or to the assistant). */
  from: 'transcript' | 'hand';
  /** The catalog course id, when the code is in the catalog. */
  courseId: string | null;
}

/** The current column's classes, in the record's order, each once. */
export function currentClasses(
  record: TranscriptRecord | null | undefined,
  term: TermRef,
  idOf: (code: string) => string | null,
): CurrentClass[] {
  const out: CurrentClass[] = [];
  for (const c of currentLines(record, term)) {
    const code = c.matched ?? normalizeCourseCode(c.code);
    if (out.some((o) => o.code === code)) continue;
    out.push({
      code,
      title: c.title ?? code,
      credits: lineHours(c),
      from: c.matchedBy === 'student' ? 'hand' : 'transcript',
      courseId: c.matched ? idOf(c.matched) : null,
    });
  }
  return out;
}

/**
 * What the column asks, if anything: "Are these your current classes?" once
 * for classes that came from a transcript, until the student answers; "Is
 * that all your classes this semester?" for hand-added classes under a
 * full-time load, while the rest of the term is still being counted.
 */
export function currentQuestion(record: TranscriptRecord | null | undefined, term: TermRef): 'confirm' | 'all' | null {
  if (currentConfirmed(record, term)) return null;
  const lines = currentLines(record, term);
  if (lines.length === 0) return null;
  if (!enteredByHand(lines)) return 'confirm';
  return partlyEnteredHours(lines, false) > 0 ? 'all' : null;
}

/**
 * A rebuilt plan with the instructors the student set for one term kept from
 * the plan before it. carryInstructors (instructors.ts) keeps a choice for a
 * course still in the same planned term; the current semester is not a
 * planned term, so its choices are kept here, whole.
 */
export function withInstructorsOfTerm(previous: PlanState | null | undefined, next: PlanState, termId: string): PlanState {
  const kept = previous?.instructors?.[termId];
  if (!kept || Object.keys(kept).length === 0 || next.instructors?.[termId]) return next;
  return { ...next, instructors: { ...next.instructors, [termId]: { ...kept } } };
}
