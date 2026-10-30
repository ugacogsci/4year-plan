/**
 * Admission to a Terry College major (UGA BBA degrees).
 *
 * Every Terry BBA page has an Entrance Requirement (verified 2026-10-29,
 * e.g. bulletin.uga.edu/Program/Details/31532): MATH 1113 or higher and ACCT
 * 2101 posted by the application deadline, BUSN 3000 completed or in
 * progress in the application term, Area VI with 58 hours (or Areas I to
 * VI), ACT/SAT scores and a statement of purpose; its Four-Year Program of
 * Study marks Spring of year 2 "APPLY TO TERRY MAJOR DURING THIS TERM".
 * Boards said none of it, and a sophomore without MATH 1113 was booked
 * Accounting's ACCT 5000-level courses the term she could first apply.
 *
 * The plan's application term is the first fall or spring by which the
 * record and a full load reach that: MATH 1113 and ACCT 2101 a term before
 * it when the record lacks them, 58 hours by its end. The major's own
 * courses (its prefix, 3000 and above, but the Terry core open before
 * admission) start the term after.
 *
 * And the Legal Studies Certificate (bulletin.uga.edu, Legal Studies
 * Certificate): LEGL 2700 and a 3.0 GPA, applications September 1 to
 * October 1 and February 1 to March 1; "Admitted students are eligible to
 * enroll in the 4000-level LEGL prefix courses and BUSN 4650".
 */
import type { Course, SemesterSeason } from './types';

const TERRY_MAJOR_PREFIX: Array<[RegExp, string, string]> = [
  [/^accounting\b/i, 'ACCT', 'Accounting'],
  [/^economics\b/i, 'ECON', 'Economics'],
  [/^finance\b/i, 'FINA', 'Finance'],
  [/^management information systems\b/i, 'MIST', 'Management Information Systems'],
  [/^management\b/i, 'MGMT', 'Management'],
  [/^marketing\b/i, 'MARK', 'Marketing'],
  [/^real estate\b/i, 'REAL', 'Real Estate'],
  [/^risk management\b/i, 'RMIN', 'Risk Management and Insurance'],
];
// The Terry core every BBA takes, open before admission.
const OPEN_BEFORE_ADMISSION = new Set(['FINA 3000', 'MARK 3000', 'MGMT 3000', 'BUSN 3000', 'LEGL 2700', 'MIST 2090']);
const PRECALCULUS_OR_HIGHER = /^MATH (?:1113|2200|2250|2260|2300|2400|2410|2500)/;
const HOURS_TO_APPLY = 58;
const LOAD = 15;

export interface TerryAdmission {
  /** The application term, "Spring 2029" (no admission at all where the record reads admitted already). */
  apply: { season: SemesterSeason; year: number; label: string } | null;
  admitted: { season: SemesterSeason; year: number; label: string } | null;
  /** Courses the plan keeps to the admission term or later. */
  notBefore: Map<string, { season: SemesterSeason; year: number }>;
  note: string;
  /** For the application term's card. */
  termNote: string | null;
}

const nextRegular = (season: SemesterSeason, year: number): { season: SemesterSeason; year: number } => (season === 'Fall' ? { season: 'Spring', year: year + 1 } : { season: 'Fall', year });

export function ugaTerryAdmission(args: {
  programName?: string;
  programCollege?: string;
  degree?: string;
  startSeason: SemesterSeason;
  startYear: number;
  /** The plan's last term and the degree's total, for the pace the plan keeps (a three-year plan reaches 58 hours a term sooner). */
  gradSeason?: SemesterSeason;
  gradYear?: number;
  degreeTotal?: number | null;
  held: readonly string[];
  heldHours: number;
  courses: readonly Course[];
}): TerryAdmission | null {
  if (args.programCollege !== 'BUS' || !/\bBBA\b/.test(args.programName ?? '')) return null;
  const hit = TERRY_MAJOR_PREFIX.find(([re]) => re.test(args.programName ?? ''));
  const prefix = hit?.[1] ?? null;
  const major = hit?.[2] ?? 'major';
  const held = new Set(args.held.map((code) => code.trim().toUpperCase()));
  const level = (code: string) => Number(code.split(' ')[1]?.[0] ?? 0);
  const gated = (code: string) => prefix !== null && code.startsWith(`${prefix} `) && level(code) >= 3 && !OPEN_BEFORE_ADMISSION.has(code);
  // A record holding the major's own courses reads admitted: nothing to say.
  if ([...held].some(gated)) return null;
  const math = [...held].some((code) => PRECALCULUS_OR_HIGHER.test(code));
  const acct = held.has('ACCT 2101') || held.has('ACCT 2101H');
  let at = args.startSeason === 'Summer' ? { season: 'Fall' as SemesterSeason, year: args.startYear } : { season: args.startSeason, year: args.startYear };
  // Terms after the first that the application waits for: a missing MATH 1113 or ACCT 2101 is taken first; 58 hours by the end of the application term.
  const forCourses = math && acct ? 0 : 1;
  let terms = 0;
  if (args.gradSeason && args.gradYear) for (let t = { ...at }; terms < 16 && (t.year < args.gradYear || (t.year === args.gradYear && (t.season === 'Spring' || args.gradSeason !== 'Spring'))); t = nextRegular(t.season, t.year)) terms += 1;
  const pace = terms > 0 && args.degreeTotal ? Math.max(LOAD, Math.ceil((args.degreeTotal - args.heldHours) / terms)) : LOAD;
  const forHours = Math.max(0, Math.ceil((HOURS_TO_APPLY - args.heldHours) / pace) - 1);
  for (let i = 0; i < Math.max(forCourses, forHours); i += 1) at = nextRegular(at.season, at.year);
  const apply = { ...at, label: `${at.season} ${at.year}` };
  const next = nextRegular(at.season, at.year);
  const admitted = { ...next, label: `${next.season} ${next.year}` };
  const notBefore = new Map<string, { season: SemesterSeason; year: number }>();
  if (prefix) for (const course of args.courses) if (gated(course.code) && !held.has(course.code)) notBefore.set(course.code, next);
  const lacking = [!math ? 'MATH 1113' : null, !acct ? 'ACCT 2101' : null].filter(Boolean).join(' and ');
  const what = 'MATH 1113 (or higher) and ACCT 2101 on your record by the application deadline, BUSN 3000 done or in progress that term, and Area VI with 58 hours (or Areas I to VI); ACT/SAT scores and a statement of purpose go with it';
  const termNote = `Apply to the Terry ${major} major this term: ${what}.`;
  const note = `Terry admission: apply to the ${major} major in ${apply.label}${lacking && held.size > 0 ? `, once ${lacking} (which your record does not show yet) is done` : ''}: ${what}. This plan starts ${prefix ? `${prefix} major courses` : 'major courses'} in ${admitted.label}, the term after. Admission is competitive; see the Entrance Requirements on your degree's Bulletin page.`;
  return { apply, admitted, notBefore, note, termNote };
}

/** The Legal Studies Certificate's limit on its courses, for a board that books one (null when it books none or holds the certificate's courses). */
export function ugaLegalStudiesNote(codes: readonly string[], held: readonly string[]): string | null {
  const limited = codes.filter((code) => /^LEGL 4\d{3}/.test(code) || code === 'BUSN 4650');
  if (limited.length === 0 || held.some((code) => /^LEGL 4\d{3}/.test(code))) return null;
  return `${limited.join(', ')} ${limited.length === 1 ? 'is' : 'are'} for students admitted to the Legal Studies Certificate: LEGL 2700 and a 3.0 GPA, applications September 1 to October 1 and February 1 to March 1. Apply the term before ${limited.length === 1 ? 'it' : 'them'}.`;
}
