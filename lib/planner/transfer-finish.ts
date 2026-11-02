/**
 * The finish onboarding suggests to a transfer student (2026-11-02).
 *
 * suggestGraduationTarget counts from the year of study, which for a
 * transfer is a guess at what their hours make them: a 60-hour Georgia State
 * Perimeter transfer starting at UGA in Spring 2027 is a "third year", so
 * Spring 2028, three terms at 18 for 57-60 hours left, and the boards stopped
 * short of 120 with rows unmet (review-fresh-w3 T6). For a transfer student
 * the hours decide: the terms the degree's hours still left take at about 15
 * a term, from the term they start here (onboarding.ts transferFinish), and
 * never earlier than the year-of-study default.
 *
 * Who counts as one is the same reading the board uses for "not here yet"
 * (plan-start.ts arrivingLater): their record is another school's with
 * nothing taught here and shows them there this term, or their words say
 * they are transferring here in a later term. A UGA or Illinois student, a
 * transfer who is here already, and a freshman with dual credit keep the
 * year-of-study default exactly.
 *
 * The hours: what the record counts, in progress included (transcript.ts
 * transcriptCreditSummary), or before a record is added, the hours their
 * words state ("about 60 hours", warnings-triage.ts statedHours). The degree's
 * hours: its published total (the program picker's totalCredits); with none,
 * no suggestion from hours.
 */
import { calendarTerm } from '@/components/planner/illinois-source';
import { suggestGraduationTarget, type AcademicYear, type GraduationSeason, type OnboardingAnswers, type TransferFinishInput } from './onboarding';
import { arrivingLater, horizonFor } from './plan-start';
import { NO_SHAPE } from './saved-board';
import { transcriptCreditSummary } from './transcript';
import { statedHours } from './warnings-triage';

/** A transfer student's hours and start here, for suggestGraduationTarget, or null for anyone else. */
export function transferFinishInput(
  answers: OnboardingAnswers | null | undefined,
  degreeHours: number | null | undefined,
  now = new Date(),
): TransferFinishInput | null {
  if (!answers || !degreeHours || degreeHours <= 0) return null;
  const stamped = answers.timelineAt ? new Date(answers.timelineAt) : null;
  const written = stamped && !Number.isNaN(stamped.getTime()) ? stamped : now;
  if (!arrivingLater(answers, calendarTerm(now), written)) return null;
  const record = answers.transcript ?? null;
  const held = record ? transcriptCreditSummary(record).projected : statedHours([answers.studying ?? '', answers.timeline ?? ''].join(' '));
  if (!held || held <= 0) return null;
  // The plan's own first term, as the board will start it (the finish asked for does not move it).
  const h = horizonFor({ ...answers, graduationSeason: '', graduationYear: null }, now, NO_SHAPE);
  return { heldHours: held, degreeHours, arrival: { season: h.startSeason, year: h.startYear } };
}

/**
 * The finish onboarding suggests: suggestGraduationTarget, with a transfer
 * student's hours when they are one (transferFinishInput).
 */
export function suggestedGraduationFor(
  answers: OnboardingAnswers,
  academicYear: AcademicYear,
  programYears: number,
  now: Date,
  firstFall: number | null,
  degreeHours: number | null | undefined,
): { season: GraduationSeason; year: number | null } {
  return suggestGraduationTarget(academicYear, programYears, now, firstFall, transferFinishInput(answers, degreeHours, now));
}

/** The published total of the degrees picked (the largest), or null when none is published. */
export function pickedDegreeHours(options: ReadonlyArray<{ id: string; totalCredits?: number | null }>, programIds: readonly string[]): number | null {
  const totals = options.filter((p) => programIds.includes(p.id) && typeof p.totalCredits === 'number' && p.totalCredits > 0).map((p) => p.totalCredits as number);
  return totals.length > 0 ? Math.max(...totals) : null;
}
