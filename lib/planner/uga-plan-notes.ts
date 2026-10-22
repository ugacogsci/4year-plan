/**
 * Which of a UGA plan's notes the "Plan assumptions and setup" dialog shows.
 *
 * Cameron's UGA board hid every note the build wrote, because its counts
 * ("Terms aim for about 15 credits", "5 slots are electives that fill the
 * 120 credits", "Weighed 0 of 40 courses against grade history") describe
 * the board as generated, not as the student has since edited it, and
 * UGA's own audit gives the live shortfalls instead. That also hid the notes
 * that are not counts: on 2026-10-22 a UGA pre-med student never saw the
 * track's note (UGA's Pre-Professional Advising Office as the source, the
 * courses booked, PMCY 3000 named but never booked, the courses that need a
 * summer or an extra term), and on the boards where the degree comes first
 * and nothing of the track is booked, nothing on screen said a track was
 * read at all. Nor the start note plan-start.ts writes for the term in
 * progress, which its header says the plan notes carry.
 *
 * Shown at UGA: the note restoring a board saved while its first term was
 * open; the start note as horizonFor writes it today; every UGA career
 * track's note (it starts with the track's name, "Pre-medicine (MD/DO): ");
 * and the note naming courses booked for the goal in place of the planner's
 * own picks. Everything else stays behind the audit, as before.
 */
import { UGA_CAREER_TRACKS } from './career-tracks';

const TRACK_HEADS = UGA_CAREER_TRACKS.map((track) => `${track.name}: `);

export function ugaShownNotes(notes: readonly string[], startNote: string | null | undefined): string[] {
  return notes.filter((n) =>
    n.startsWith('This plan was saved when ') ||
    (Boolean(startNote) && n === startNote) ||
    TRACK_HEADS.some((head) => n.startsWith(head)) ||
    / (?:is|are) required for the goal you named, placed where the planner's own lesser picks were\./.test(n),
  );
}
