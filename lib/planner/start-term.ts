/**
 * The terms a student has already spent here that the planner cannot see.
 *
 * A student who says "I'm a freshman" in October, or "started fall 2026" in
 * March, began before the plan's first term. The finish counts from when they
 * began, so with nothing on a record for those terms the plan had to fit the
 * whole degree into the terms left and booked them at 18. Each such term is
 * assumed to have earned about 15 credits until the student adds it.
 *
 * Only terms nothing covers: a term with Illinois classes on the record
 * (done or in progress) is already counted there, and adding 15 on top of it
 * told a sophomore with 44 real hours they held 89. A term away (a gap year)
 * earned nothing. Classes the student told ALMA about with no term are
 * counted against the assumed hours, since they belong to some of those terms.
 */
import { lineIsForeign, normalizeTerm, type TranscriptRecord } from './transcript';
import type { SemesterSeason } from './types';

export type TermRef = { season: SemesterSeason; year: number };

/** About what a full-time term earns. */
export const ASSUMED_TERM_HOURS = 15;

const regularIndex = (t: TermRef) => t.year * 2 + (t.season === 'Spring' ? 0 : 1);
const termKey = (t: TermRef) => `${t.season} ${t.year}`;

/**
 * What the record already holds for the terms before the plan: the terms with
 * an Illinois class on them, and the hours of classes with no term (typed in,
 * or told to ALMA).
 */
export function recordCoverage(record: TranscriptRecord | null | undefined): { terms: Set<string>; unplacedHours: number } {
  const terms = new Set<string>();
  let unplacedHours = 0;
  if (!record || record.kind === 'transfer_report') return { terms, unplacedHours };
  for (const c of record.courses ?? []) {
    if (!c.use || (c.status !== 'completed' && c.status !== 'in_progress')) continue;
    if (lineIsForeign(record, c)) continue;
    const m = (normalizeTerm(c.term) ?? '').match(/^(Fall|Spring|Summer) (\d{4})$/);
    if (m) {
      terms.add(`${m[1]} ${m[2]}`);
      continue;
    }
    unplacedHours += c.equivalentCredits ?? c.credits ?? c.illinoisCredits ?? c.assumedCredits ?? 0;
  }
  return { terms, unplacedHours };
}

/**
 * The falls and springs from `began` up to (not including) `start` that
 * nothing covers: not on the record, not away. Summers are never assumed.
 */
export function uncoveredTerms(began: TermRef, start: TermRef, covered: Set<string>, away: TermRef[] = []): TermRef[] {
  const out: TermRef[] = [];
  const awayKeys = new Set(away.map(termKey));
  const from = began.season === 'Summer' ? { season: 'Fall' as const, year: began.year } : began;
  for (let k = regularIndex(from); k < regularIndex(start); k++) {
    const t: TermRef = { season: k % 2 ? 'Fall' : 'Spring', year: Math.floor(k / 2) };
    if (covered.has(termKey(t)) || awayKeys.has(termKey(t))) continue;
    out.push(t);
  }
  return out;
}

/** Hours assumed for those terms, less what the record holds with no term; `perTerm` is the plan's load (current-term.ts termLoadFor: 9 for a UGA graduate student). */
export function assumedHours(terms: TermRef[], unplacedHours: number, perTerm = ASSUMED_TERM_HOURS): number {
  const left = terms.length * perTerm - Math.round(unplacedHours);
  // A few hours short of a full load is the classes they added, not a term missing.
  return left >= 3 ? left : 0;
}
