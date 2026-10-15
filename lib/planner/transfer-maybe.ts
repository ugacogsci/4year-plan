/**
 * Transfer lines the planner only thinks "may be" a course.
 *
 * A Parkland line counted as hours with an unconfirmed suggestion ("it may be
 * BUS 101") used to leave the board free to book BUS 101, so a student could
 * be scheduled for a course they may already hold. Now, while the line is
 * unconfirmed:
 *   - the board does not book the suggested course (where it would have,
 *     the build treats it as held, with the line's hours unchanged: the
 *     course's catalog hours come off the hours-with-no-course, so the total
 *     held is what it was; holdMaybe);
 *   - its requirement stays open on the rail (the course is not among the
 *     held courses on the board), with a review note saying to confirm it;
 *   - it still clears prerequisites, as an exemption does, so nothing booked
 *     after it is flagged for it;
 *   - one click in the transfer list confirms it (the line counts as that
 *     course, which builds the same board) or rejects it (the line stays
 *     hours, and the course is booked if the degree needs it).
 * A record with no such line changes nothing: every function here returns
 * its input untouched.
 */
import { lineIsForeign, normalizeCourseCode, transcriptCodes, type TranscriptRecord } from './transcript';
import type { PlanIssue, PlanState } from './types';

/** One unconfirmed suggestion: the line, where it was taken, and the course it may be. */
export interface MaybeLine {
  /** The line's index in record.courses. */
  index: number;
  lineCode: string;
  lineTitle: string | null;
  from: string | null;
  /** The catalog course the line may be. */
  code: string;
  /** The hours the line counts as today. */
  hours: number;
}

/**
 * Lines counted as hours whose best suggestion is a course ("it may be
 * BUS 101"), taught somewhere else and not yet evaluated, that the student
 * has neither confirmed nor rejected. A suggestion another line already counts as is not one, nor
 * is a second line suggesting the same course.
 */
export function maybeLines(record: TranscriptRecord | null | undefined): MaybeLine[] {
  if (!record) return [];
  const held = new Set(transcriptCodes(record).map(normalizeCourseCode));
  const seen = new Set<string>();
  const out: MaybeLine[] = [];
  record.courses.forEach((c, index) => {
    if (!c.use || c.counts !== 'hours' || c.maybeDeclined) return;
    // A line a published guide places in gen-ed categories counts as hours
    // toward them, "not as one Illinois course": that is an answer, not a
    // suggestion. Only a line still waiting on Illinois is a "may be".
    if (c.genEdTags?.length) return;
    if (c.basis && c.basis.badge !== 'not-evaluated') return;
    const best = c.proposals?.[0];
    if (!best || best.confidence === 'low') return;
    if (!lineIsForeign(record, c)) return;
    const code = normalizeCourseCode(best.code);
    if (held.has(code) || seen.has(code)) return;
    seen.add(code);
    out.push({
      index,
      lineCode: c.code,
      lineTitle: c.title ?? null,
      from: c.from ?? record.institution ?? null,
      code,
      hours: c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0,
    });
  });
  return out;
}

/** The suggested courses, for the build and for what decides whether the credit changed. */
export function maybeCodes(record: TranscriptRecord | null | undefined): string[] {
  return maybeLines(record).map((m) => m.code);
}

/**
 * The build's prior credit with each unconfirmed suggestion held, so the
 * board does not book it, and its catalog hours taken off the hours with no
 * course, so the hours held are exactly what they were. This is the prior a
 * confirmed line gives (transcriptCreditAdjustment settles the line's hours
 * against the course's), so confirming builds the same board.
 */
export function withMaybeHeld<P extends { courseCodes: string[]; unmatchedCredits: number }>(
  prior: P,
  record: TranscriptRecord | null | undefined,
  creditsOf: (code: string) => number | null,
  /** Which suggestions to hold; all of them when absent. */
  only: (code: string) => boolean = () => true,
): { prior: P; codes: string[] } {
  const have = new Set(prior.courseCodes.map(normalizeCourseCode));
  const codes = maybeCodes(record).filter((code) => !have.has(code) && creditsOf(code) !== null && only(code));
  if (codes.length === 0) return { prior, codes };
  const off = codes.reduce((sum, code) => sum + (creditsOf(code) ?? 0), 0);
  return {
    prior: { ...prior, courseCodes: [...prior.courseCodes, ...codes], unmatchedCredits: Math.round((prior.unmatchedCredits - off) * 100) / 100 },
    codes,
  };
}

/**
 * The build, holding only the suggestions the board would otherwise book.
 * A suggestion the board leaves alone changes nothing, so it is not held:
 * holding it could cost hours where the catalog does not give credit for
 * both it and a course the student holds (MATH 234 beside a held MATH 221),
 * and a board that never booked it has nothing to take back. The first
 * board is kept unless holding the booked ones leaves the hours held exactly
 * as they were. `generate` builds a board from a prior; it is called once
 * when no line is a "may be" or the board books none of them.
 */
export function holdMaybe<
  P extends { courseCodes: string[]; unmatchedCredits: number },
  G extends { terms: Array<{ codes: string[] }>; credits: { prior: number } },
>(
  prior: P,
  record: TranscriptRecord | null | undefined,
  creditsOf: (code: string) => number | null,
  generate: (prior: P) => G,
): { prior: P; codes: string[]; generated: G } {
  const first = generate(prior);
  const all = new Set(maybeCodes(record));
  if (all.size === 0) return { prior, codes: [], generated: first };
  const onBoard = (g: G) => g.terms.flatMap((term) => term.codes.map(normalizeCourseCode));
  let codes: string[] = [];
  let current = prior;
  let board = first;
  // A board built with one suggestion held can pick another for an elective;
  // that one is held too, a few rounds at most.
  for (let round = 0; round < 3; round += 1) {
    const fresh = onBoard(board).filter((code) => all.has(code) && !codes.includes(code));
    if (fresh.length === 0) break;
    const step = withMaybeHeld(prior, record, creditsOf, (code) => codes.includes(code) || fresh.includes(code));
    if (step.codes.length === codes.length) break;
    codes = step.codes;
    current = step.prior;
    board = generate(current);
    if (Math.abs(board.credits.prior - first.credits.prior) > 0.01) return { prior, codes: [], generated: first };
  }
  if (codes.length === 0) return { prior, codes: [], generated: first };
  if (onBoard(board).some((code) => codes.includes(code))) return { prior, codes: [], generated: first };
  return { prior: current, codes, generated: board };
}

/**
 * The built board with the unconfirmed suggestions taken out of the held
 * courses (so the rail leaves their requirements open and the headline does
 * not count their hours twice) and kept as maybeCourseIds, which clear
 * prerequisites and count for nothing else. `keep` is every course the
 * student really holds; a cross-listed name of a suggestion they hold stays.
 */
export function openMaybeOnBoard(
  plan: PlanState,
  codes: string[],
  idOf: (code: string) => string | null | undefined,
  twinsOf: (code: string) => string[] = () => [],
  keep: Set<string> = new Set(),
): PlanState {
  if (codes.length === 0) return plan;
  const ids = new Set<string>();
  for (const code of codes) {
    for (const name of [code, ...twinsOf(code)].map(normalizeCourseCode)) {
      if (keep.has(name)) continue;
      const id = idOf(name);
      if (id) ids.add(id);
    }
  }
  const maybe = plan.completedCourseIds.filter((id) => ids.has(id));
  if (maybe.length === 0) return plan;
  return {
    ...plan,
    completedCourseIds: plan.completedCourseIds.filter((id) => !ids.has(id)),
    maybeCourseIds: [...new Set([...(plan.maybeCourseIds ?? []), ...maybe])],
  };
}

/** The engine's "met by prior credit" rows without the unconfirmed suggestions in them. */
export function withoutMaybe<R extends { codes: string[] }>(rows: R[], codes: string[]): R[] {
  if (codes.length === 0) return rows;
  const out = new Set(codes.map(normalizeCourseCode));
  // A row met by nothing but a suggestion is open again; a row met with no
  // codes at all (a language from high school) is not the suggestion's.
  return rows
    .filter((row) => row.codes.length === 0 || row.codes.some((c) => !out.has(normalizeCourseCode(c))))
    .map((row) => ({ ...row, codes: row.codes.filter((c) => !out.has(normalizeCourseCode(c))) }));
}

/** The review list's note for each unconfirmed suggestion. */
export function maybeIssues(record: TranscriptRecord | null | undefined, termId: string, codes?: string[]): PlanIssue[] {
  const only = codes ? new Set(codes.map(normalizeCourseCode)) : null;
  return maybeLines(record)
    .filter((m) => !only || only.has(m.code))
    .map((m) => ({
      id: `transfer-maybe-${m.code}`,
      severity: 'warning' as const,
      title: `Transfer course to confirm: ${m.code}`,
      message: `Your ${m.from ? `${m.from} ` : ''}${m.lineCode}${m.lineTitle ? ` (${m.lineTitle})` : ''} may count as ${m.code}: confirm it in the transfer list. Until you do, the plan does not book ${m.code} and leaves its requirement open; the line's ${m.hours} ${m.hours === 1 ? 'hour' : 'hours'} still count toward your total. If it is not ${m.code}, say so there and the plan books ${m.code} where the degree needs it.`,
      termId,
    }));
}

/** The student says the line is not the suggested course: it stays hours, and the suggestion stops holding the course. */
export function declineMaybe(record: TranscriptRecord, index: number): TranscriptRecord {
  return {
    ...record,
    courses: record.courses.map((c, i) => (i === index ? { ...c, maybeDeclined: true } : c)),
  };
}
