/**
 * Illinois term dates ALMA states, by term, and the prompt block built from
 * them for the day a student asks.
 *
 * ALMA's prompt used to carry one hard-coded line of Fall 2026 deadlines, so
 * on the first day of spring it would still have told a student that Oct 16
 * was the drop deadline. The dates now live here, one entry per term, each
 * read on the registrar page named beside it, and the block names the term in
 * progress (or the next one, between terms) and the one after it. A day past
 * every loaded term gets no dates at all, only the instruction to look them
 * up, because a stale date is worse than none.
 *
 * Adding a term: read the registrar's undergraduate registration deadlines
 * page and academic calendar for it, add an entry below with the page and the
 * day it was read, and extend __college-rules.check.mjs section 6.
 *
 * MERGE-UGA: Illinois only. These are Illinois registrar dates and must never
 * reach a UGA student. advisor-request.ts attaches the block to each step's
 * newest message only when the school's name says Illinois; once the route
 * reads a schoolId, key it on 'illinois' instead.
 */

export interface TermDates {
  /** "Fall 2026". */
  term: string;
  /** First and last day of instruction, and the last day of final exams (YYYY-MM-DD). */
  classesBegin: string;
  classesEnd: string;
  finalsEnd: string;
  /** Full-term (POT 1) deadlines. */
  lastDayToAdd: string;
  /** Last day to drop with no W; also the CR/NC and grade replacement deadline. */
  lastDayNoW: string;
  /** Last day to withdraw with at least a 40% refund. */
  lastDayRefund40: string;
  /** Registration for the following term, when the registrar has published it. */
  nextRegistration?: { term: string; timeTickets: string; priority: string; open: string };
  /** Where each date was read, and when. */
  sources: string;
}

export const ILLINOIS_TERM_DATES: TermDates[] = [
  {
    // registrar.illinois.edu/ug-reg-dlines-fa26/ (read 2026-09-24), full-term (POT 1) column: add Sep 4; drop with no
    // W, CR/NC request and grade replacement Oct 16; withdraw with a minimum 40% refund Oct 30; Spring 2027 time
    // tickets Oct 26, priority registration Nov 2, open registration Nov 19. registrar.illinois.edu/fall-2026-academic-calendar/
    // (read 2026-10-11): instruction Aug 24 to Dec 9, final examinations Dec 11-17.
    term: 'Fall 2026',
    classesBegin: '2026-08-24',
    classesEnd: '2026-12-09',
    finalsEnd: '2026-12-17',
    lastDayToAdd: '2026-09-04',
    lastDayNoW: '2026-10-16',
    lastDayRefund40: '2026-10-30',
    nextRegistration: { term: 'Spring 2027', timeTickets: '2026-10-26', priority: '2026-11-02', open: '2026-11-19' },
    sources: 'registrar.illinois.edu/ug-reg-dlines-fa26/, registrar.illinois.edu/fall-2026-academic-calendar/',
  },
  {
    // registrar.illinois.edu/ug-reg-dlines-sp27/ (read 2026-10-11), full-term (POT 1) column: instruction Jan 19 to
    // May 5, final exams May 7-13; add Feb 1; drop with no W, CR/NC request and grade replacement Mar 12; withdraw for
    // a minimum 40% refund Apr 2. The page lists no Summer or Fall 2027 registration dates yet.
    term: 'Spring 2027',
    classesBegin: '2027-01-19',
    classesEnd: '2027-05-05',
    finalsEnd: '2027-05-13',
    lastDayToAdd: '2027-02-01',
    lastDayNoW: '2027-03-12',
    lastDayRefund40: '2027-04-02',
    sources: 'registrar.illinois.edu/ug-reg-dlines-sp27/',
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** "2026-09-04" -> "Sept 4". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Today in Champaign as YYYY-MM-DD, whatever the server's own time zone. */
export function campusDay(now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * The terms whose dates matter today: the term in progress (or, between
 * terms, the next one) and the one after it. Empty past every loaded term.
 */
export function termsFor(today: string, table: TermDates[] = ILLINOIS_TERM_DATES): TermDates[] {
  const at = table.findIndex((t) => today <= t.finalsEnd);
  return at < 0 ? [] : table.slice(at, at + 2);
}

function termLine(t: TermDates): string {
  return (
    `- ${t.term} full-term courses (classes ${shortDate(t.classesBegin)} to ${shortDate(t.classesEnd)}, finals end ${shortDate(t.finalsEnd)}): ` +
    `add by ${shortDate(t.lastDayToAdd)}; ${shortDate(t.lastDayNoW)} is the last day to drop with no W, to request CR/NC and to file a grade replacement at the college office; ` +
    `${shortDate(t.lastDayRefund40)} is the last day to withdraw with at least a 40% refund.` +
    (t.nextRegistration
      ? ` ${t.nextRegistration.term} time tickets appear ${shortDate(t.nextRegistration.timeTickets)}, priority registration begins ${shortDate(t.nextRegistration.priority)} and open registration ${shortDate(t.nextRegistration.open)}.`
      : '')
  );
}

/**
 * The block of term dates for ALMA's prompt, for the day it is asked. Sent as
 * its own system block after the cached prompt, so the cache does not break
 * when the day changes.
 */
export function termDatesBlock(now: Date, table: TermDates[] = ILLINOIS_TERM_DATES): string {
  const today = campusDay(now);
  const terms = termsFor(today, table);
  const head = `Illinois term dates (today is ${today}; the registrar's published dates):`;
  if (terms.length === 0) {
    return `${head}\n- No term dates are loaded for this part of the year. For any add, drop, withdrawal or registration date, use university_answer and never state one from memory.`;
  }
  return [
    head,
    ...terms.map(termLine),
    '- Half-term courses and any term not listed here have their own dates: use university_answer.',
  ].join('\n');
}
