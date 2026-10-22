/**
 * Where a plan starts and ends, and the semester in progress before it.
 *
 * Moved here from planner-workspace.tsx (2026-10-20) unchanged in what it
 * decides for Illinois, so the checks can run it the way the browser does
 * (__current-term.check.mjs). What changed:
 *
 *   - UGA starts where Illinois does, at the first term a student can still
 *     sign up for on today's date (Spring 2027 on Oct 20, 2026), not "this
 *     year's fall". A UGA board used to book a full planner-chosen load into
 *     a fall that was half over; that fall is now the current-semester
 *     column, holding the student's real classes (current-term.ts).
 *   - Which meant UGA had to count the terms before the plan the way
 *     Illinois does. The old comment here said why it could not: "UGA's
 *     credit and requirement counts do not add those assumed credits, so a
 *     UGA plan that started in Spring read as 15 credits short of its
 *     degree." The workspace now hands the same assumed hours to UGA's audit
 *     and its headline as to Illinois's, and says them plainly in the
 *     current column and the plan notes, so a Spring start reads whole.
 *   - The term in progress is returned (`current`), with what it counts as
 *     until its classes are entered (`currentAssumedHours`).
 *
 * The rule for the term in progress, the same at both schools:
 *   1. Classes on the record for it (a transcript's in-progress lines, or
 *      classes added by hand) count as in progress: held, conditional on
 *      passing, never booked again, as in-progress credit always was.
 *   2. No class entered yet, for a student who began here before it (their
 *      words, or "I'm a freshman" in October): about 15 credits, the usual
 *      full load, are counted for it until they add their classes. Not for a
 *      student whose start comes from their own record (a term a full record
 *      leaves out is a term off, as before), and never silently: the column
 *      and the notes say so.
 *   3. Classes added by hand that come to under 12 (full time), before the
 *      student says that is all: the rest of a 15-credit term is counted too
 *      (current-term.ts partlyEnteredHours), so typing in a first class does
 *      not take 12 credits off the plan at once.
 *
 * A UGA graduate plan counts 9 where these say 15, and 9 as full time where
 * they say 12: UGA's full-time graduate load (current-term.ts termLoadFor,
 * since 2026-10-22). With 15, a first-year master's student's Fall 2026 left
 * 243 of 259 UGA graduate programs planning fewer credits, half of a 30-hour
 * master's off the board.
 */
import { calendarTerm, firstOpenTerm, readHorizon } from '@/components/planner/illinois-source';
import type { Horizon } from './autoplan';
import { currentConfirmed, currentLines, currentTermFor, partlyEnteredHours, termLoadFor, termUnderWay } from './current-term';
import { schoolById, timelineForPlanning, type OnboardingAnswers } from './onboarding';
import type { PlanShape } from './saved-board';
import { assumedHours as assumedHoursOf, recordCoverage, uncoveredTerms } from './start-term';
import { summersFor } from './summer-terms';
import { lineIsForeign, normalizeTerm, type TranscriptRecord } from './transcript';
import type { PlanTerm, SemesterSeason } from './types';

export function termOrd(season: SemesterSeason, year: number): number {
  return year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
}

/**
 * The horizon a build plans over: the student's own words, what they asked
 * ALMA for on top, and a start moved past a term they are taking now. One
 * function, so set_plan_shape checks a term against the range the build will
 * use rather than a copy of it.
 */
export type StartHorizon = Horizon & {
  startNote: string | null;
  began: { season: SemesterSeason; year: number } | null;
  beganFrom: 'words' | 'record' | 'standing' | null;
  /** Falls and springs since `began` that nothing on the record holds, each assumed to have earned about 15 credits. */
  assumedTerms: Array<{ season: SemesterSeason; year: number }>;
  /** The hours assumed for them, less classes on the record with no term, plus the rest of a partly entered current term. */
  assumedHours: number;
  /** A graduation here that is under way, past, or already on the record: the board is one term in case plans change. */
  gradPassed: { season: SemesterSeason; year: number } | null;
  /** The semester in progress the board shows before its first planned term, or null (current-term.ts). */
  current: { season: SemesterSeason; year: number } | null;
  /** Of assumedHours, the part counted for the current semester until its classes are entered. */
  currentAssumedHours: number;
};

export function horizonFor(
  answers: OnboardingAnswers | null | undefined,
  today: Date,
  shape: PlanShape,
  /** The board's own terms, when one is on screen: a board that already holds the term in progress shows no second column for it. */
  boardTerms?: readonly Pick<PlanTerm, 'label'>[],
): StartHorizon {
  // The plan starts at the first term a student can still add classes to on
  // today's date, not the crawled term: in October that is Spring. "This
  // fall" and "incoming" in the student's words are read as of the day they
  // wrote them. Both schools (see the header).
  const bot = schoolById(answers?.schoolId ?? null)?.bot ?? 'the assistant';
  // What a term counts as before its classes are entered: about 15 (12 full
  // time), or 9 for a UGA graduate student, UGA's full-time graduate load
  // (current-term.ts termLoadFor).
  const load = termLoadFor(answers?.schoolId, answers?.programLevel);
  const open = firstOpenTerm(today);
  const stamped = answers?.timelineAt ? new Date(answers.timelineAt) : null;
  const written = stamped && !Number.isNaN(stamped.getTime()) ? stamped : today;
  const now = calendarTerm(today);
  /**
   * A record with courses in progress in the plan's first term means the
   * student is taking that term now: those courses are counted as done, so
   * planning another full load in the same term books the term twice. The
   * plan starts the term after the last one in progress. A term in progress
   * now or later also means they are enrolled, not incoming.
   */
  const busy = latestInProgressTerm(answers?.transcript);
  const readNow = readHorizon(
    answers ? timelineForPlanning(answers) : '',
    open,
    calendarTerm(written),
    {
      firstTermOnRecord: firstIllinoisTerm(answers?.transcript),
      enrolled: Boolean(busy && termOrd(busy.season, busy.year) >= termOrd(now.season, now.year)),
      openWhenWritten: firstOpenTerm(written),
    },
  );
  const { began, beganFrom, datedStart, incoming, gradPassed: passedInWords, pastAway, notStarted, ...read } = readNow;
  const startOrd = termOrd(read.startSeason, read.startYear);
  const horizon: StartHorizon = { ...read, startNote: null, began, beganFrom, assumedTerms: [], assumedHours: 0, gradPassed: passedInWords, current: null, currentAssumedHours: 0 };
  // A graduation term picked in onboarding stands, when it is not before the plan's start.
  if (answers?.graduationSeason && answers.graduationYear &&
      termOrd(answers.graduationSeason, answers.graduationYear) >= startOrd) {
    horizon.gradSeason = answers.graduationSeason;
    horizon.gradYear = answers.graduationYear;
    horizon.stated = true;
  }
  // What the student asked ALMA for wins over what the About-you words said,
  // unless that term is before the plan's first (set_plan_shape refuses one
  // now; a board saved earlier may still carry it).
  const busyNext = busy && termOrd(busy.season, busy.year) >= startOrd
    ? (busy.season === 'Fall' ? { season: 'Spring' as const, year: busy.year + 1 } : { season: 'Fall' as const, year: busy.year })
    : null;
  const firstOrd = busyNext ? termOrd(busyNext.season, busyNext.year) : startOrd;
  const finishPassed = Boolean(shape.finish && termOrd(shape.finish.season, shape.finish.year) < firstOrd);
  if (shape.finish && !finishPassed) {
    horizon.gradSeason = shape.finish.season;
    horizon.gradYear = shape.finish.year;
    horizon.stated = true;
    horizon.gradPassed = null;
  }
  // A term ALMA was told about replaces what About you said of the same term
  // ("it's a co-op, not abroad" changes what the term earns), and a plain
  // "Spring 2029" from ALMA keeps what About you said it was.
  const sameTerm = (a: { season: SemesterSeason; year: number }, b: { season: SemesterSeason; year: number }) => a.season === b.season && a.year === b.year;
  const said = horizon.away ?? [];
  horizon.away = [
    ...said.filter((a) => !shape.away.some((b) => sameTerm(a, b))),
    ...shape.away.map((a) => {
      const before = said.find((b) => sameTerm(a, b));
      return before && a.kind === undefined && a.credits === undefined ? { ...before, ...a } : a;
    }),
  ];
  // A summer the student took off the board stays off, even one About you asked for.
  horizon.summers = summersFor(horizon.summers ?? [], shape);
  if (busyNext) {
    const next = busyNext;
    horizon.startSeason = next.season;
    horizon.startYear = next.year;
    const nextOrd = termOrd(next.season, next.year);
    const gradOrd = termOrd(horizon.gradSeason, horizon.gradYear);
    if (gradOrd < nextOrd && horizon.stated) {
      // A finish they gave whose term is already on the record ("Senior,
      // graduating May 2027" with Spring 2027 registered): nothing is left to
      // plan, not a fresh four years.
      horizon.gradPassed ??= { season: horizon.gradSeason, year: horizon.gradYear };
      horizon.gradSeason = next.season;
      horizon.gradYear = next.year;
    } else if (gradOrd < nextOrd || (gradOrd === nextOrd && !horizon.stated)) {
      // A stated last term equal to the new first one stands (a senior's last semester).
      const from = began ?? next;
      let end = stepRegular(from, 7 + pastAway.length);
      if (termOrd(end.season, end.year) < nextOrd) end = stepRegular(next, 7);
      horizon.gradSeason = end.season;
      horizon.gradYear = end.year;
      horizon.stated = false;
    }
  }
  const label = (t: { season: SemesterSeason; year: number }) => `${t.season} ${t.year}`;
  const start = { season: horizon.startSeason, year: horizon.startYear };
  // The semester in progress, shown before the plan's first term (current-term.ts).
  // Not for a student who has not started here yet: one whose words say so,
  // or who named a start later than the next open term ("I start in Fall 2027").
  const laterStart = datedStart && !busyNext && startOrd > termOrd(open.season, open.year);
  horizon.current = currentTermFor({
    underWay: termUnderWay(now, answers?.transcript),
    start,
    notStarted: Boolean(notStarted || incoming || laterStart),
    away: horizon.away ?? [],
    boardTerms,
  });
  // Terms since they began that nothing on the record holds: about 15 credits
  // each, so the terms left are not loaded to 18. Not for a record's own
  // start (a term missing from a full record is a term off), and not for the
  // terms away they named.
  if (began && beganFrom !== 'record' && !horizon.gradPassed) {
    const coverage = recordCoverage(answers?.transcript);
    horizon.assumedTerms = uncoveredTerms(began, start, coverage.terms, pastAway);
    horizon.assumedHours = assumedHoursOf(horizon.assumedTerms, coverage.unplacedHours, load.usual);
    const cur = horizon.current;
    if (cur && horizon.assumedTerms.some((t) => sameTerm(t, cur))) horizon.currentAssumedHours = Math.min(load.usual, horizon.assumedHours);
  }
  // The term in progress for a student whose record starts them here and
  // shows them here the term before it (Spring 2026 done, Fall 2026 not on
  // it): a record printed before this term's classes showed. A term missing
  // from the middle of a record is a term off, as above; the one under way,
  // right after the record's last term, is them taking classes now, so it
  // counts as about 15 until they add those classes, said in the column.
  // Without it a sophomore whose transcript stops at Spring 2026 had five
  // terms to hold 90 credits and a UGA board read "Degree credits are short".
  const nowTerm = horizon.current;
  if (nowTerm && began && beganFrom === 'record' && !horizon.gradPassed && nowTerm.season !== 'Summer' &&
      currentLines(answers?.transcript, nowTerm).length === 0) {
    const last = lastHomeTerm(answers?.transcript);
    const before = stepRegular(nowTerm, -1);
    if (last && termOrd(last.season, last.year) >= termOrd(before.season, before.year) && termOrd(last.season, last.year) < termOrd(nowTerm.season, nowTerm.year)) {
      horizon.assumedTerms = [...horizon.assumedTerms, nowTerm];
      horizon.assumedHours += load.usual;
      horizon.currentAssumedHours = load.usual;
    }
  }
  // The rest of a current term whose classes the student is still typing in.
  // Not when the term is already assumed above: its classes with no term on
  // them were taken off that assumption there (assumedHours), once.
  const cur = horizon.current;
  let partly: { entered: number; more: number } | null = null;
  if (cur && !horizon.gradPassed && !horizon.assumedTerms.some((t) => sameTerm(t, cur))) {
    const more = partlyEnteredHours(currentLines(answers?.transcript, cur), currentConfirmed(answers?.transcript, cur), load);
    if (more > 0) {
      horizon.assumedHours += more;
      horizon.currentAssumedHours = more;
      horizon.assumedTerms = [...horizon.assumedTerms, cur];
      partly = { entered: load.usual - more, more };
    }
  }
  const assumedNames = horizon.assumedTerms.length === 1 ? label(horizon.assumedTerms[0]) : `${horizon.assumedTerms.slice(0, -1).map(label).join(', ')} and ${label(horizon.assumedTerms[horizon.assumedTerms.length - 1] ?? start)}`;
  const assumed = horizon.assumedHours <= 0 ? ''
    : horizon.assumedHours < horizon.assumedTerms.length * load.usual
      ? ` Until you do, this plan counts about ${horizon.assumedHours} more credits for ${assumedNames}, beyond the classes you have added.`
      : ` Until you do, this plan counts ${assumedNames} as about ${horizon.assumedHours} credits${horizon.assumedTerms.length > 1 ? ' in all' : ''}, the usual full load.`;
  // Where the student adds the classes they are taking now: the column, when the board shows one.
  const addNow = horizon.current ? `in the ${label(horizon.current)} column (or upload a screenshot of your schedule)` : `(upload your schedule or tell ${bot})`;
  // Classes already in that column: the note says so rather than asking for them again (UGA's plan dialog shows it since 2026-10-22).
  const entered = horizon.current && currentLines(answers?.transcript, horizon.current).length > 0
    ? `Your ${label(horizon.current)} classes are in its column, counted as in progress until you pass them.`
    : null;
  // What the student is told about the first term, from the term the board starts in.
  const nowUnderWay = now.season !== 'Summer' && termOrd(now.season, now.year) < termOrd(start.season, start.year);
  if (horizon.gradPassed) {
    const p = horizon.gradPassed;
    const when = busy && termOrd(p.season, p.year) <= termOrd(busy.season, busy.year) && termOrd(p.season, p.year) > termOrd(now.season, now.year)
      ? 'and those classes are already on your record'
      : termOrd(p.season, p.year) >= termOrd(now.season, now.year) ? 'which is under way' : 'which has passed';
    horizon.startNote = `You said you finish in ${label(p)}, ${when}, so there is nothing left to plan before it. This board shows ${label(start)} only in case your plans change; tell ${bot} a later finish if you need one.`;
  } else if (finishPassed && shape.finish) {
    horizon.startNote = `The finish set earlier, ${label(shape.finish)}, has passed, so this plan uses the finish from About you instead.`;
  } else if (beganFrom === 'record') {
    horizon.startNote = horizon.current && horizon.currentAssumedHours > 0
      ? `Your record does not show ${label(horizon.current)} classes yet. Until you add them in the ${label(horizon.current)} column (or upload a newer transcript), this plan counts ${label(horizon.current)} as about ${horizon.currentAssumedHours} credits, the usual full load.`
      : null;
  } else if (busyNext) {
    horizon.startNote = assumed ? `Your record does not show your classes from ${assumedNames} yet. Add them (upload your transcript or tell ${bot}) so they count.${assumed}` : null;
  } else if (began) {
    horizon.startNote = nowUnderWay && termOrd(now.season, now.year) >= termOrd(began.season, began.year)
      ? `${label(now)} is under way and adding classes has closed, so this plan starts in ${label(start)}${sameTerm(now, began) ? '' : ` and counts your finish from ${label(began)}, when you started`}. ${entered && !assumed ? entered : `Add the classes you are taking now ${addNow} so they count.`}${assumed}`
      : `You started in ${label(began)}, so this plan starts in ${label(start)}, the next term you can sign up for, and counts your finish from ${label(began)}. Add the classes you have taken (upload a transcript or tell ${bot}) so they count.${assumed}`;
  } else if (incoming) {
    horizon.startNote = `Students who have not started college yet begin in the fall, so this plan starts in ${label(start)}. If you start in ${label(open)} instead, say so in About you.`;
  } else if (!datedStart && nowUnderWay && sameTerm(start, open)) {
    horizon.startNote = `Adding ${label(now)} classes has closed, so this plan starts in ${label(start)}, the next term you can sign up for. If that is not right for you, change About you.`;
  }
  if (partly && cur && !horizon.gradPassed && !(finishPassed && shape.finish)) {
    const others = horizon.assumedTerms.filter((t) => !sameTerm(t, cur));
    horizon.startNote = `You have added ${partly.entered} credits of ${label(cur)} classes. Until you add the rest, or say in the ${label(cur)} column that those are all, this plan counts about ${partly.more} more for ${label(cur)}, the rest of a usual ${load.usual}-credit term.${others.length > 0 ? ` It also counts ${others.map(label).join(', ')} as about ${horizon.assumedHours - partly.more} credits until you add those classes.` : ''}`;
  }
  return horizon;
}

/** Eight falls and springs from a term is `n = 7` steps; summers are skipped. */
export function stepRegular(t: { season: SemesterSeason; year: number }, n: number): { season: SemesterSeason; year: number } {
  const k = t.year * 2 + (t.season === 'Spring' ? 0 : 1) + n;
  return { season: k % 2 ? 'Fall' : 'Spring', year: Math.floor(k / 2) };
}

/** The first term at this school on the student's record (a home record only), or null. */
function firstIllinoisTerm(record: TranscriptRecord | null | undefined): { season: SemesterSeason; year: number } | null {
  if (!record || record.home === false || record.kind === 'transfer_report') return null;
  let best: { season: SemesterSeason; year: number } | null = null;
  for (const c of record.courses ?? []) {
    // Taught here: not a transfer block, dual credit or exam line, nor a line the student typed.
    if (!c.use || (c.status !== 'completed' && c.status !== 'in_progress')) continue;
    if (lineIsForeign(record, c) || c.matchedBy === 'student') continue;
    const m = (normalizeTerm(c.term) ?? '').match(/^(Fall|Spring|Summer) (\d{4})$/);
    if (!m) continue;
    const t = { season: m[1] as SemesterSeason, year: Number(m[2]) };
    if (!best || termOrd(t.season, t.year) < termOrd(best.season, best.year)) best = t;
  }
  return best;
}

/** The latest term this school taught the student, done or in progress (a home record only), or null. */
function lastHomeTerm(record: TranscriptRecord | null | undefined): { season: SemesterSeason; year: number } | null {
  if (!record || record.home === false || record.kind === 'transfer_report') return null;
  let best: { season: SemesterSeason; year: number } | null = null;
  for (const c of record.courses ?? []) {
    if (!c.use || (c.status !== 'completed' && c.status !== 'in_progress')) continue;
    if (lineIsForeign(record, c) || c.matchedBy === 'student') continue;
    const m = (normalizeTerm(c.term) ?? '').match(/^(Fall|Spring|Summer) (\d{4})$/);
    if (!m) continue;
    const t = { season: m[1] as SemesterSeason, year: Number(m[2]) };
    if (!best || termOrd(t.season, t.year) > termOrd(best.season, best.year)) best = t;
  }
  return best;
}

/** The latest term with a course the student is taking now, from their record. */
function latestInProgressTerm(record: TranscriptRecord | null | undefined): { season: SemesterSeason; year: number } | null {
  let best: { season: SemesterSeason; year: number } | null = null;
  for (const c of record?.courses ?? []) {
    if (!c.use || c.status !== 'in_progress') continue;
    const m = (normalizeTerm(c.term) ?? '').match(/^(Fall|Spring|Summer) (\d{4})$/);
    if (!m) continue;
    const t = { season: m[1] as SemesterSeason, year: Number(m[2]) };
    if (!best || termOrd(t.season, t.year) > termOrd(best.season, best.year)) best = t;
  }
  return best;
}
