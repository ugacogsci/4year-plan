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
import { currentConfirmed, currentLines, currentTermFor, partlyEnteredHours, termLoadFor, termOfLine, termUnderWay } from './current-term';
import { schoolById, timelineForPlanning, type OnboardingAnswers } from './onboarding';
import type { PlanShape } from './saved-board';
import { assumedHours as assumedHoursOf, recordCoverage, uncoveredTerms } from './start-term';
import { summersFor } from './summer-terms';
import { lineIsForeign, normalizeTerm, transcriptResidentHours, type TranscriptRecord } from './transcript';
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
  /**
   * A first term the student set (PlanShape.start: the board's start-term
   * control, or ARCH/ALMA on their word) wins over what was worked out above,
   * when it is a fall or spring they can still sign up for. The owner's test
   * (2026-11-04) came out with one Spring 2028 column and ALMA could only say
   * "change that under Edit details"; now either of them sets it here.
   */
  const setStart = shape.start && shape.start.season !== 'Summer' && termOrd(shape.start.season, shape.start.year) >= termOrd(open.season, open.year)
    ? shape.start
    : null;
  if (setStart) {
    horizon.startSeason = setStart.season;
    horizon.startYear = setStart.year;
    horizon.gradPassed = null;
    if (termOrd(horizon.gradSeason, horizon.gradYear) < termOrd(setStart.season, setStart.year)) {
      const end = stepRegular(setStart, 7);
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
  const laterStart = (datedStart && !busyNext && startOrd > termOrd(open.season, open.year)) ||
    Boolean(setStart && termOrd(setStart.season, setStart.year) > termOrd(open.season, open.year));
  // Nor for a transfer student who is still at another school that term (arrivingLater).
  const underWay = termUnderWay(now, answers?.transcript);
  const elsewhere = underWay && termOrd(underWay.season, underWay.year) < termOrd(start.season, start.year)
    ? arrivingLater(answers, underWay, written)
    : null;
  horizon.current = currentTermFor({
    underWay,
    start,
    notStarted: Boolean(notStarted || incoming || laterStart || elsewhere),
    away: horizon.away ?? [],
    boardTerms,
  });
  // Terms since they began that nothing on the record holds: about 15 credits
  // each, so the terms left are not loaded to 18. Not for a record's own
  // start (a term missing from a full record is a term off), and not for the
  // terms away they named.
  if (began && beganFrom !== 'record' && !horizon.gradPassed) {
    const coverage = recordCoverage(answers?.transcript);
    // A transfer student still at the other school: the terms that school's
    // record shows are terms they were there, not terms missing from this one.
    // "I started at Perimeter in Fall 2025" with Fall 2025 to Fall 2026 on the
    // Perimeter record counted 45 more hours on top of the record's own.
    if (elsewhere) for (const t of datedTermsOf(answers?.transcript)) coverage.terms.add(t);
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
  } else if (elsewhere && underWay && nowUnderWay) {
    // A transfer student still at another school: nothing to add here this term.
    const here = schoolById(answers?.schoolId ?? null)?.short ?? 'this school';
    const when = elsewhere.arrival && sameTerm(elsewhere.arrival, start)
      ? `You start at ${here} in ${label(start)}, so this plan starts then.`
      : `This plan starts in ${label(start)}, the next term you can sign up for at ${here}. If you start there later, say so in About you.`;
    const there = elsewhere.classesNow
      ? ` Your ${label(underWay)} classes${elsewhere.school ? ` at ${elsewhere.school}` : ''} are on your record as in progress, so this plan does not book them again.`
      : '';
    const earlier = assumed ? ` Add the classes you have taken (upload your transcript or tell ${bot}) so they count.${assumed}` : '';
    horizon.startNote = `${when}${there}${earlier}`;
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
  if (setStart) {
    const elsewhereNow = elsewhere && underWay && nowUnderWay && elsewhere.classesNow
      ? ` Your ${label(underWay)} classes${elsewhere.school ? ` at ${elsewhere.school}` : ''} are on your record as in progress, so this plan does not book them again.`
      : '';
    horizon.startNote = `This plan starts in ${label(start)}, the first term you set. Change it with the start-term button on the board, or tell ${bot}.${elsewhereNow}`;
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

/**
 * Words that say the student is coming to this school from another one and
 * has not yet: "I'm transferring to UGA in Spring 2027", "I will transfer to
 * Illinois from Parkland", "transferring for spring". Not one who already has
 * ("I transferred to UGA this fall"), nor a move inside the school
 * ("transferring into Terry", "transferring to Gies next fall"), nor a
 * different school with a name like this one ("transferring to Georgia
 * State", "to Illinois State").
 */
const TRANSFER_VERB = String.raw`(?:transferring|(?:will|['’]ll|going to|gonna|plan(?:ning)? to|hop(?:e|ing) to|about to|set to)\s+transfer)`;
const THIS_SCHOOL = String.raw`(?:the\s+)?(?:uga|university of georgia|georgia(?!\s+(?:state|tech|southern|gwinnett|highlands|gateway|military|college|perimeter|piedmont))|illinois(?!\s+(?:state|central|wesleyan|college|institute|tech))|uiuc|u of i|university of illinois(?!\s+(?:at\s+)?(?:chicago|springfield)))\b`;
const FROM_CLAUSE = String.raw`(?:\s+from\s+(?:(?!\b(?:to|into)\b)[^.;!?])*?)?`;
const TERM_AHEAD = String.raw`(?:in|for|this|next|starting)\s+(?:the\s+)?(?:spring|fall|autumn|summer|january|jan|august|aug|semester|term)\b`;
const TRANSFER_AHEAD = new RegExp(String.raw`\b${TRANSFER_VERB}${FROM_CLAUSE}\s+(?:(?:to|into)\s+${THIS_SCHOOL}|${TERM_AHEAD})`, 'i');
/** Words that put the student at this school now: "I transferred to UGA", "I'm at Illinois", "started at UGA this fall". */
const HERE_NOW = new RegExp(String.raw`\b(?:transferred|started|began|enrolled|am|i['’]?m|i am)\s+(?:(?:to|into|at|in)\s+)${THIS_SCHOOL}`, 'i');
const ARRIVAL_TERM = /\b(spring|fall|autumn|summer|january|jan|august|aug)\s*(?:semester\s*|term\s*)?(?:of\s*)?('\d{2}|20\d\d)\b/i;
const ARRIVAL_SEASON: Record<string, SemesterSeason> = { spring: 'Spring', january: 'Spring', jan: 'Spring', fall: 'Fall', autumn: 'Fall', august: 'Fall', aug: 'Fall', summer: 'Summer' };

/**
 * A transfer student who is still at another school in the term under way
 * and starts here later, or null.
 *
 * Four made-up Georgia State Perimeter transfers starting at UGA in Spring
 * 2027 (2026-11-02 review) got a UGA "Fall 2026" current-semester column, and
 * the three with Fall 2026 classes in progress at Perimeter were told "Your
 * Fall 2026 classes are not added yet. Add them in the Fall 2026 column":
 * those classes were on the record already, as another school's (currentLines
 * leaves those out of the column), so the column read empty. A student who
 * is not here this term has no classes here to add. The term's column is for
 * a student here; this one's in-progress classes count as transfer credit
 * from their own record, as they always did.
 *
 * Who: nothing on the record was taught here (no record, or another school's
 * document with no line of this school's: the test internalTransferIntent
 * uses), no class typed into this term by hand, and either
 *   - the record shows classes in progress this term at the other school,
 *     and their words do not put them here now; or
 *   - their words say they are transferring here (TRANSFER_AHEAD) in a term
 *     after this one: the term named in that sentence, or with none named the
 *     first term open when they wrote it ("transferring to UGA" written in
 *     July is this fall: they are here now).
 * UGA's and Illinois's own students, and a freshman whose record is another
 * school's dual credit, keep the column as before.
 */
export function arrivingLater(
  answers: OnboardingAnswers | null | undefined,
  underWay: { season: SemesterSeason; year: number },
  written: Date,
): { arrival: { season: SemesterSeason; year: number } | null; classesNow: boolean; school: string | null } | null {
  const record = answers?.transcript ?? null;
  if (record) {
    const elsewhereRecord = record.kind === 'transfer_report' || record.home === false;
    if (!elsewhereRecord || transcriptResidentHours(record).total > 0) return null;
    if (currentLines(record, underWay).length > 0) return null;
  }
  const words = [answers?.studying ?? '', answers?.timeline ?? ''].join(' ');
  const classesNow = Boolean(record?.courses.some((c) =>
    c.status === 'in_progress' && lineIsForeign(record, c) && sameTermRef(termOfLine(c), underWay)));
  const school = record?.institution?.trim() || null;
  const ahead = TRANSFER_AHEAD.exec(words);
  if (ahead) {
    // The sentence the transfer is in, from the verb on, names when.
    const rest = words.slice(ahead.index);
    const sentence = rest.slice(0, Math.max(0, rest.search(/[.;!?](\s|$)/)) || rest.length);
    const arrival = arrivalOf(sentence, written);
    if (termOrd(arrival.season, arrival.year) > termOrd(underWay.season, underWay.year)) {
      return { arrival: ARRIVAL_TERM.test(sentence) || /\b(this|next)\s+(spring|fall|autumn|summer|semester|term)\b/i.test(sentence) ? arrival : null, classesNow, school };
    }
    return null;
  }
  if (record && classesNow && !HERE_NOW.test(words)) return { arrival: null, classesNow, school };
  return null;
}

/** The term a transfer sentence names ("in Spring 2027", "this fall", "next semester"), read as of the day it was written; with none, the first term open that day. */
function arrivalOf(sentence: string, written: Date): { season: SemesterSeason; year: number } {
  const m = sentence.match(ARRIVAL_TERM);
  if (m) {
    const year = m[2].startsWith("'") ? 2000 + Number(m[2].slice(1)) : Number(m[2]);
    const season = ARRIVAL_SEASON[m[1].toLowerCase()];
    return season === 'Summer' ? { season: 'Fall', year } : { season, year };
  }
  const cal = calendarTerm(written);
  const open = firstOpenTerm(written);
  const rel = sentence.match(/\b(this|next)\s+(spring|fall|autumn|summer|semester|term)\b/i);
  if (rel) {
    const word = rel[2].toLowerCase();
    if (word === 'semester' || word === 'term') return rel[1].toLowerCase() === 'this' ? (cal.season === 'Summer' ? { season: 'Fall', year: cal.year } : cal) : open;
    const season: SemesterSeason = word === 'spring' ? 'Spring' : 'Fall';
    // "This fall" in October is the fall under way; "next spring" in October is the coming one.
    const thisOne = { season, year: season === 'Spring' && cal.season === 'Fall' ? cal.year + 1 : cal.year };
    if (rel[1].toLowerCase() === 'this') return thisOne;
    return termOrd(thisOne.season, thisOne.year) > termOrd(cal.season, cal.year) ? thisOne : { season, year: thisOne.year + 1 };
  }
  return open;
}

const sameTermRef = (a: { season: SemesterSeason; year: number } | null, b: { season: SemesterSeason; year: number }) => Boolean(a && a.season === b.season && a.year === b.year);

/** "Fall 2025", "Spring 2026": every term a line of the record is dated, whichever school taught it. */
function datedTermsOf(record: TranscriptRecord | null | undefined): string[] {
  const out = new Set<string>();
  for (const c of record?.courses ?? []) {
    if (!c.use || (c.status !== 'completed' && c.status !== 'in_progress')) continue;
    const t = termOfLine(c);
    if (t) out.add(`${t.season} ${t.year}`);
  }
  return [...out];
}
