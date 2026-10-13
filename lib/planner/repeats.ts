/**
 * Courses a student takes more than once: the catalog's repeat rule, read
 * from the course's own description, and what a degree row asking for more
 * hours than one sitting gives turns into.
 *
 * 1,201 of the 6,225 undergraduate courses say "May be repeated". The rule
 * matters where a degree page asks for more hours of one course than a single
 * sitting gives: Stage Management asks for THEA 359 x 8 hours at 2 hours a
 * sitting, Voice asks for MUSC 105 x 12 hours at 3. Until this module the
 * plan booked such a course once and the progress bar stayed short.
 *
 * Kept free of the data layer and the engine so that the index build, the
 * adapter (illinois-data.ts), the engine (autoplan.ts) and the board can all
 * read the same rule.
 */

/** A course's repeat rule as the catalog states it. Present only on courses that may be repeated. */
export interface RepeatRule {
  /**
   * The most undergraduate hours the course may count for, every sitting
   * together ("to a maximum of 12 hours"); null when the catalog sets no cap.
   */
  max: number | null;
  /** The most hours in one term, where the catalog sets one ("no more than 2 hours in any one term"). */
  termMax?: number;
  /** Present only where the catalog allows a repeat in the same term ("in the same or separate terms"). */
  sameTerm?: true;
  /** "If topics vary": each sitting has to be a different topic. */
  topicsVary?: true;
}

/** The sentence the rule comes from, or null when the course may not be repeated. */
export function repeatSentence(description: string | null | undefined): string | null {
  const m = /may be repeated[^.]*(?:\.|$)/i.exec(description ?? '');
  return m ? m[0] : null;
}

const SAME_TERM_ALLOWED = /\bsame\s+(?:or\s+(?:in\s+)?(?:separate|subsequent|multiple)\s+)?(?:term|semester)s?\b/i;
const PER_TERM = /\b(?:any one|one|per|each)\s+(?:term|semester)\b/i;
const TOPICS = /\btopics?\s+(?:vary|varies)\b/i;
/** Clauses inside one repeat sentence: "in the same term up to 2 hours | or in separate terms up to 8 hours". */
const CLAUSE = /;|\bbut\b|\band\s+(?=to\s|in\s)|\bor\s+(?=in\s)|,\s+(?=in\s)/i;
/** An hours figure, with the word after it so a graduate cap can be told apart. */
const HOURS = /(\d+(?:\.\d+)?)\s*(undergraduate|ug|credit|graduate|g)?\s*(?:or\s+graduate\s+)?(hours?|hrs?)?/gi;

/**
 * The catalog's repeat rule for one course, or null when its description does
 * not say it may be repeated. `perSitting` is the most hours one sitting gives
 * (the catalog's upper credit figure), used only for "May be repeated once".
 */
export function repeatRuleOf(description: string | null | undefined, perSitting: number | null | undefined): RepeatRule | null {
  const sentence = repeatSentence(description);
  if (!sentence) return null;
  const rule: RepeatRule = { max: null };
  if (SAME_TERM_ALLOWED.test(sentence)) rule.sameTerm = true;
  if (TOPICS.test(sentence)) rule.topicsVary = true;
  const totals: number[] = [];
  const perTerm: number[] = [];
  for (const clause of sentence.split(CLAUSE)) {
    // "in the same term up to 2 hours" caps one term; "in the same or separate
    // terms to a maximum of 16" allows the same term and caps the whole.
    const termCap = PER_TERM.test(clause) || (/\bsame\s+(?:term|semester)\b/i.test(clause) && !/\bor\s+(?:in\s+)?(?:separate|subsequent|multiple)\b/i.test(clause));
    for (const m of clause.matchAll(HOURS)) {
      const word = (m[2] ?? '').toLowerCase();
      if (!m[3] && !word) continue;
      if (word === 'graduate' || word === 'g') continue;
      const n = Number(m[1]);
      if (!(n > 0)) continue;
      (termCap ? perTerm : totals).push(n);
    }
  }
  // "for an unlimited number of hours in separate terms" (TE 497): no cap on the whole.
  const unlimited = /\bunlimited\b/i.test(sentence);
  if (totals.length > 0) rule.max = Math.max(...totals);
  else if (perTerm.length > 0 && !unlimited) rule.max = Math.max(...perTerm);
  if (perTerm.length > 0 && (totals.length > 0 || unlimited)) rule.termMax = Math.min(...perTerm);
  if (rule.max === null && /\brepeated\s+once\b/i.test(sentence) && perSitting && perSitting > 0) rule.max = 2 * perSitting;
  return rule;
}

/**
 * What a degree row asks of a repeatable course: how many sittings, at how
 * many hours each. Present on a row only where the page asks for more hours
 * than one sitting gives.
 */
export interface RepeatAsk {
  /** Sittings the plan books: the page's hours over one sitting's, never past the catalog's cap. */
  sittings: number;
  /** The most hours one sitting gives (the catalog's upper figure). */
  perSitting: number;
  /** The hours the degree page prints on the row. */
  pageHours: number;
  /** The catalog's cap on all sittings together, or null. */
  cap: number | null;
  /** True when the page asks for more hours than the catalog's cap allows; both are quoted. */
  pastCap?: true;
  sameTerm?: true;
  topicsVary?: true;
}

/**
 * The repeat a row asks for, or null: a page row of `pageHours` for a course
 * whose one sitting gives at most `perSitting` hours, under the catalog's
 * `rule` (null when the course may not be repeated).
 */
export function repeatAskFor(pageHours: number | null | undefined, perSitting: number | null | undefined, rule: RepeatRule | null | undefined): RepeatAsk | null {
  if (!rule || pageHours == null || perSitting == null || !(perSitting > 0)) return null;
  if (!(pageHours > perSitting + 0.01)) return null;
  const allowed = rule.max !== null ? Math.min(pageHours, rule.max) : pageHours;
  const sittings = Math.max(1, Math.ceil(allowed / perSitting - 0.001));
  if (sittings < 2) return null;
  return {
    sittings,
    perSitting,
    pageHours,
    cap: rule.max,
    ...(rule.max !== null && rule.max < pageHours - 0.01 ? { pastCap: true as const } : {}),
    ...(rule.sameTerm ? { sameTerm: true as const } : {}),
    ...(rule.topicsVary ? { topicsVary: true as const } : {}),
  };
}

/** "2nd", "3rd", "4th": a sitting's place among a course's sittings. */
export function ordinalWord(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/** The student-facing line for a row that asks for repeats. */
export function repeatLine(code: string, ask: RepeatAsk): string {
  const each = `${ask.perSitting} hour${ask.perSitting === 1 ? '' : 's'}`;
  let line = `The degree asks for ${ask.pageHours} hours of ${code}, so the plan books it ${ask.sittings} times (up to ${each} each).`;
  if (ask.pastCap) line += ` The catalog lets ${code} count for at most ${ask.cap} hours, so check the remaining ${ask.pageHours - (ask.cap ?? 0)} with an advisor.`;
  if (ask.topicsVary) line += ` It counts again only with a different topic each time, so pick a new topic for each sitting.`;
  return line;
}

/**
 * May the student put this course on the board once more? Only a course the
 * catalog lets a student repeat: in a term that does not hold it yet, or in
 * one that does where the catalog allows the same term, and never past the
 * catalog's cap counting every sitting on the board and on the record.
 */
export function mayBookAgain(
  course: { credits: number; repeat?: RepeatRule },
  board: { completedCourseIds: string[]; terms: Array<{ id: string; courseIds: string[] }> },
  courseId: string,
  termId: string,
): boolean {
  const rule = course.repeat;
  if (!rule) return false;
  const sittings = board.completedCourseIds.filter((id) => id === courseId).length + board.terms.reduce((n, t) => n + t.courseIds.filter((id) => id === courseId).length, 0);
  if (rule.max !== null && (sittings + 1) * course.credits > rule.max + 0.01) return false;
  const here = board.terms.find((t) => t.id === termId)?.courseIds.filter((id) => id === courseId).length ?? 0;
  if (here > 0 && !rule.sameTerm) return false;
  if (here > 0 && rule.termMax !== undefined && (here + 1) * course.credits > rule.termMax + 0.01) return false;
  return true;
}
