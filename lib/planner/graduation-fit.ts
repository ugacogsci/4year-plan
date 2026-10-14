/**
 * Will the chosen graduation date hold the degree? Asked twice during setup.
 *
 * On "Check the essentials" the student has not entered any credit yet, so
 * the question is answered with a generous estimate: what a student in their
 * stated year has usually earned, or the credits they wrote in their own
 * words, whichever is larger. A note appears only when even that estimate
 * cannot reach the degree, and it is worded as a heads-up, not an error.
 *
 * After the Credit step the same question is asked with the credit actually
 * added (transcript, exam credit, typed transfer work, courses marked as
 * taken). A firm warning appears only when that credit, plus every term left
 * at a full load, still falls short.
 *
 * Before this, the first screen compared a whole degree with the terms left
 * as if every student were starting from zero, so a fourth-year graduating
 * next spring was told the date "does not leave enough terms".
 */
import {
  UNDECIDED_PROGRAM_ID,
  availablePlanningTerms,
  currentAcademicSeason,
  isGraduationTermPast,
  type AcademicYear,
  type OnboardingAnswers,
} from './onboarding';
import type { TranscriptRecord } from './transcript';

/** Credits a term can hold at the most anyone is planned for. */
export const MAX_CREDITS_PER_TERM = 18;

/** One selectable program, as the onboarding menus hold it. */
export interface FitProgram {
  id: string;
  totalCredits?: number | null;
  additionalCredits?: number | null;
}

export interface FitCatalog {
  degrees: FitProgram[];
  /** Minors and certificates at the student's level. */
  additions: FitProgram[];
}

export interface FitNote {
  /** 'soft' is a heads-up; 'warn' means the date truly cannot hold the degree. */
  tone: 'soft' | 'warn';
  title: string;
  message: string;
}

const YEAR_INDEX: Record<Exclude<AcademicYear, ''>, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  'fifth-plus': 5,
};

const YEAR_LABEL: Record<Exclude<AcademicYear, ''>, string> = {
  first: 'first-year',
  second: 'second-year',
  third: 'third-year',
  fourth: 'fourth-year',
  'fifth-plus': 'fifth-year',
};

/**
 * Credits a student in this year of their program has usually finished when
 * on pace for this degree: a quarter of it a year for an undergraduate (at
 * least 30), half of it a year for a graduate student (at least 24), for every
 * year before this one, plus half a year once this year's fall is behind them.
 */
export function creditsExpectedForYear(
  year: AcademicYear,
  level: OnboardingAnswers['programLevel'],
  degreeCredits: number,
  now = new Date(),
): number {
  if (!year) return 0;
  const perYear = level === 'graduate'
    ? Math.max(24, degreeCredits / 2)
    : Math.max(30, degreeCredits / 4);
  const done = YEAR_INDEX[year] - 1;
  const fallDone = currentAcademicSeason(now) === 'Fall' ? 0 : perYear / 2;
  return Math.round(done * perYear + fallDone);
}

/**
 * The credits a student says they have, in their own words: "about 95
 * credits", "60 credit hours", "I have 45 hours". A load per term ("15
 * credits a semester") is not a total and is skipped. Null when no total is
 * written.
 */
export function creditsStatedInText(text: string): number | null {
  if (!text) return null;
  let best: number | null = null;
  const pattern = /(\d{1,3}(?:\.\d)?)\s*(?:\+\s*)?(?:total\s+)?(?:semester\s+)?(?:credit(?:s|\s+hours?)?|hours?|hrs?|ch)\b([^.\n]{0,24})/gi;
  for (const match of text.matchAll(pattern)) {
    const n = Number(match[1]);
    const after = match[2] ?? '';
    const before = text.slice(Math.max(0, (match.index ?? 0) - 14), match.index ?? 0);
    if (/^\s*(?:a|per|each|every)\s+(?:term|semester|quarter|year)\b/i.test(after)) continue;
    if (/\b(?:take|taking|need|needs|needed|left|remaining|requires?|require)\s+$/i.test(before)) continue;
    if (/^\s*(?:left|remaining|to go|short)\b/i.test(after)) continue;
    if (!(n > 0) || n > 200) continue;
    best = best === null ? n : Math.max(best, n);
  }
  return best;
}

/** Course codes written in free text ("ACCT 2101", "MATH 221"). */
function codesInText(text: string): number {
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{2,4})\s?(\d{3,4}[A-Z]?)\b/g)) seen.add(`${m[1]} ${m[2]}`);
  return seen.size;
}

/** Credits on an uploaded record that the student kept as counting. */
export function transcriptCreditTotal(record: TranscriptRecord | null | undefined): number {
  if (!record) return 0;
  let total = 0;
  for (const c of record.courses) {
    if (!c.use || c.counts === 'none') continue;
    total += c.equivalentCredits ?? c.credits ?? c.illinoisCredits ?? c.assumedCredits ?? 3;
  }
  return Math.round(total * 10) / 10;
}

/**
 * Every credit the student added on the Credit step, counted generously so a
 * warning never rests on an undercount: the uploaded record, exam credit, the
 * transfer work they typed (a stated total, or about three credits for each
 * course code written), and catalog courses marked as already taken.
 */
export function priorCreditAdded(answers: OnboardingAnswers, examCredits: number): number {
  const typed = answers.transferText ?? '';
  const typedTotal = creditsStatedInText(typed) ?? codesInText(typed) * 3;
  return (
    transcriptCreditTotal(answers.transcript) +
    Math.max(0, examCredits) +
    typedTotal +
    (answers.alreadyTakenCourseCodes?.length ?? 0) * 3
  );
}

/** The degree's own total and the rough total with every added program. */
export function programCreditNeeds(
  answers: OnboardingAnswers,
  catalog: FitCatalog,
): { primary: number; combined: number; degrees: number; additions: number } {
  const degrees = answers.programIds
    .map((id) => catalog.degrees.find((program) => program.id === id))
    .filter((program): program is FitProgram => Boolean(program));
  const additions = [...answers.minorIds, ...answers.certificateIds]
    .map((id) => catalog.additions.find((program) => program.id === id))
    .filter((program): program is FitProgram => Boolean(program));
  const primary = answers.programLevel === 'graduate'
    ? Math.max(0, ...degrees.map((program) => program.totalCredits ?? program.additionalCredits ?? 0))
    : Math.max(120, ...degrees.map((program) => program.totalCredits ?? 0));
  const combined =
    primary +
    degrees.slice(1).reduce((sum, program) => sum + (program.additionalCredits ?? 30), 0) +
    additions.reduce((sum, program) => sum + (program.additionalCredits ?? 12), 0);
  return { primary, combined, degrees: degrees.length, additions: additions.length };
}

/** "2 terms through Spring 2027 hold" / "1 term through Fall 2026 holds". */
function termsHold(terms: number, answers: OnboardingAnswers): string {
  return `${terms} ${terms === 1 ? 'term' : 'terms'} through ${answers.graduationSeason} ${answers.graduationYear} ${terms === 1 ? 'holds' : 'hold'}`;
}

/**
 * The shared inputs, or null when there is nothing to judge yet: no date, a
 * past date, an undecided program, or a degree with no published total.
 */
function setup(answers: OnboardingAnswers, catalog: FitCatalog | null, now: Date) {
  if (
    !catalog ||
    answers.programIds.includes(UNDECIDED_PROGRAM_ID) ||
    !answers.graduationSeason ||
    !answers.graduationYear ||
    isGraduationTermPast(answers.graduationSeason, answers.graduationYear, now)
  ) {
    return null;
  }
  const terms = availablePlanningTerms(answers.graduationSeason, answers.graduationYear, now);
  if (terms === 0) return null;
  const needs = programCreditNeeds(answers, catalog);
  if (needs.primary <= 0) return null;
  return { terms, room: terms * MAX_CREDITS_PER_TERM, needs };
}

/**
 * "Check the essentials": judged on the year the student gave and any total
 * they wrote, before any credit is entered. Never a firm error; the real check
 * comes after the Credit step.
 */
export function essentialsFitNote(
  answers: OnboardingAnswers,
  catalog: FitCatalog | null,
  now = new Date(),
): FitNote | null {
  // The year is asked on this same screen; judge once it is answered.
  if (!answers.academicYear) return null;
  const base = setup(answers, catalog, now);
  if (!base) return null;
  const { terms, room, needs } = base;
  const fromYear = creditsExpectedForYear(answers.academicYear, answers.programLevel, needs.primary, now);
  const stated = creditsStatedInText([answers.timeline, answers.studying].join(' '));
  const estimate = Math.max(fromYear, stated ?? 0);
  const who = stated !== null && stated >= fromYear
    ? `the ${stated} credits you mentioned`
    : estimate > 0
      ? `about ${estimate} credits, what a ${YEAR_LABEL[answers.academicYear]} student has usually earned`
      : `the little or no credit a ${YEAR_LABEL[answers.academicYear]} student usually has`;
  const later = 'We will check this again once you add the credit you already have on the next screen.';

  if (needs.primary - estimate > room) {
    return {
      tone: 'soft',
      title: `${answers.graduationSeason} ${answers.graduationYear} may be too soon for this degree`,
      message: `The ${termsHold(terms, answers)} at most ${room} credits at ${MAX_CREDITS_PER_TERM} per term. Starting from ${who}, this ${needs.primary}-credit degree would still need about ${needs.primary - estimate}. ${later} If the gap remains, a later date will fit.`,
    };
  }
  if (needs.combined - estimate > room) {
    return {
      tone: 'soft',
      title: 'Everything you picked may not fit by this date',
      message: `Your ${needs.degrees + needs.additions} programs come to roughly ${needs.combined} credits before shared courses are counted. Starting from ${who}, the ${termsHold(terms, answers)} at most ${room} more. ${later}`,
    };
  }
  return null;
}

/**
 * After the Credit step: judged on the credit actually added. A firm warning
 * only when that credit plus a full load every remaining term cannot reach
 * the degree; a gentle reminder when the student has likely not added all of
 * it yet.
 */
export function creditFitNote(
  answers: OnboardingAnswers,
  catalog: FitCatalog | null,
  examCredits: number,
  now = new Date(),
): FitNote | null {
  const base = setup(answers, catalog, now);
  if (!base) return null;
  const { terms, room, needs } = base;
  const added = priorCreditAdded(answers, examCredits);
  const expected = Math.max(
    creditsExpectedForYear(answers.academicYear, answers.programLevel, needs.primary, now),
    creditsStatedInText([answers.timeline, answers.studying].join(' ')) ?? 0,
  );
  const short = needs.primary - added;

  if (short > room) {
    const addedText = added > 0 ? `the ${added} credits you have added` : 'no credit added yet';
    // Likely more credit than was entered, and that credit would fit: a reminder, not an error.
    if (added < expected && needs.primary - expected <= room) {
      return {
        tone: 'soft',
        title: 'Add the rest of your credit',
        message: `With ${addedText}, this ${needs.primary}-credit degree would still need ${short}, more than the ${room} credits the ${terms} ${terms === 1 ? 'term' : 'terms'} through ${answers.graduationSeason} ${answers.graduationYear} can hold at ${MAX_CREDITS_PER_TERM} per term. Add what you have already earned above (uploading your transcript is quickest) so the plan starts from it.`,
      };
    }
    return {
      tone: 'warn',
      title: 'This graduation date cannot hold the rest of the degree',
      message: `With ${addedText}, this ${needs.primary}-credit degree still needs about ${short}. The ${termsHold(terms, answers)} at most ${room} credits at ${MAX_CREDITS_PER_TERM} per term. Choose a later date, or add any credit still missing above.`,
    };
  }
  if (needs.combined - added > room) {
    return {
      tone: 'soft',
      title: 'Everything you picked may not fit by this date',
      message: `Your ${needs.degrees + needs.additions} programs come to roughly ${needs.combined} credits before shared courses are counted. With ${added} credits added, the ${termsHold(terms, answers)} at most ${room} more. The planner will still build a draft and show what is left.`,
    };
  }
  return null;
}
