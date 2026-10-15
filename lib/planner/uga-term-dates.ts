/**
 * UGA term dates ARCH states, by term, and the block built from them for the
 * day a student asks. The UGA counterpart of term-dates.ts, which is Illinois
 * only and must never reach a UGA student.
 *
 * UGA's calendar has its own shape: drop/add is one window (there is no
 * separate "drop without a W" day as at Illinois), then one withdrawal
 * deadline, and registration is by ticketed groups. So the fields are UGA's,
 * not the Illinois TermDates copied over.
 *
 * Every date was read on the Registrar's pages named beside it. Adding a term:
 * read the academic calendar and the registration-dates page for it, add an
 * entry with the page and the day it was read, and extend
 * __advisor-request-uga.check.mjs.
 */
import { shortDate } from './term-dates';

export const UGA_ACADEMIC_CALENDAR = 'https://reg.uga.edu/general-information/calendars/academic-calendars/';
export const UGA_REGISTRATION_DATES = 'https://reg.uga.edu/calendars/registration-dates/';

export interface UgaTermDates {
  /** "Fall 2026". */
  term: string;
  /** First and last day of classes, and the last day of final exams (YYYY-MM-DD). */
  classesBegin: string;
  classesEnd: string;
  finalsEnd: string;
  /** The last day of drop/add. */
  dropAddEnds: string;
  /** The withdrawal deadline. */
  withdrawalDeadline: string;
  /** Ticketed registration for the following term, when the registrar has published it. */
  nextRegistration?: { term: string; ticketedFrom: string; ticketedTo: string; openFrom: string; openTo: string };
  /** Where each date was read. */
  sources: string;
}

export const UGA_TERM_DATES: UgaTermDates[] = [
  {
    // reg.uga.edu/general-information/calendars/academic-calendars/ (read 2026-10-14), Fall 2026: classes begin
    // Mon Aug 17; drop/add ends Fri Aug 21; withdrawal deadline Wed Nov 11; last day of classes Tue Dec 1; reading
    // day Dec 2; final exams Dec 3-9. reg.uga.edu/calendars/registration-dates/ (read 2026-10-14): Spring/Summer 2027
    // ticketed registration Nov 12-20, 2026 (Honors and PharmD first, freshmen 0-29 hours last); open registration
    // for Spring 2027 Mon Nov 23, 2026 to Sun Jan 10, 2027.
    term: 'Fall 2026',
    classesBegin: '2026-08-17',
    classesEnd: '2026-12-01',
    finalsEnd: '2026-12-09',
    dropAddEnds: '2026-08-21',
    withdrawalDeadline: '2026-11-11',
    nextRegistration: { term: 'Spring 2027', ticketedFrom: '2026-11-12', ticketedTo: '2026-11-20', openFrom: '2026-11-23', openTo: '2027-01-10' },
    sources: `${UGA_ACADEMIC_CALENDAR}, ${UGA_REGISTRATION_DATES}`,
  },
  {
    // reg.uga.edu/general-information/calendars/academic-calendars/ (read 2026-10-14), Spring 2027: classes begin
    // Mon Jan 11; drop/add ends Fri Jan 15; withdrawal deadline Wed Apr 7; last day of classes Mon Apr 26; reading
    // day Apr 27; final exams Apr 28-May 4. The registration-dates page lists no Fall 2027 registration yet.
    term: 'Spring 2027',
    classesBegin: '2027-01-11',
    classesEnd: '2027-04-26',
    finalsEnd: '2027-05-04',
    dropAddEnds: '2027-01-15',
    withdrawalDeadline: '2027-04-07',
    sources: UGA_ACADEMIC_CALENDAR,
  },
];

/** Today in Athens, Georgia, as YYYY-MM-DD. */
export function athensDay(now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The term in progress (or, between terms, the next one) and the one after it; empty past every loaded term. */
export function ugaTermsFor(today: string, table: UgaTermDates[] = UGA_TERM_DATES): UgaTermDates[] {
  const at = table.findIndex((t) => today <= t.finalsEnd);
  return at < 0 ? [] : table.slice(at, at + 2);
}

function termLine(t: UgaTermDates): string {
  return (
    `- ${t.term} full-term courses (classes ${shortDate(t.classesBegin)} to ${shortDate(t.classesEnd)}, finals end ${shortDate(t.finalsEnd)}): ` +
    `drop/add ends ${shortDate(t.dropAddEnds)}; ${shortDate(t.withdrawalDeadline)} is the withdrawal deadline.` +
    (t.nextRegistration
      ? ` ${t.nextRegistration.term} ticketed registration runs ${shortDate(t.nextRegistration.ticketedFrom)} to ${shortDate(t.nextRegistration.ticketedTo)} by student group, and open registration ${shortDate(t.nextRegistration.openFrom)} to ${shortDate(t.nextRegistration.openTo)}.`
      : '') +
    ` Source: ${t.sources}`
  );
}

/** The block of UGA term dates for ARCH, for the day it is asked. Attached after the cached prompt, like Illinois's. */
export function ugaTermDatesBlock(now: Date, table: UgaTermDates[] = UGA_TERM_DATES): string {
  const today = athensDay(now);
  const terms = ugaTermsFor(today, table);
  const head = `UGA term dates (today is ${today}; the Registrar's published dates):`;
  if (terms.length === 0) {
    return `${head}\n- No term dates are loaded for this part of the year. For any drop/add, withdrawal or registration date, use university_answer and never state one from memory.`;
  }
  return [
    head,
    ...terms.map(termLine),
    '- Summer sessions, short sessions and any term not listed here have their own dates; withdrawal limits and hardship withdrawals have their own rules: use university_answer.',
  ].join('\n');
}
