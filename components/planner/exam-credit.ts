'use client';

/**
 * The AP and IB credit a school grants, loaded once and shared.
 *
 * Two screens need the same table and they run minutes apart. Onboarding needs
 * it to price the exams a student reports, and the planner needs it again to
 * put those courses on the board before the first term is scheduled. Fetching
 * it twice would be two chances for one of them to quietly get nothing.
 */

import { useEffect, useState } from 'react';
import { applyExamCredit, type ExamCreditEntry, type PriorExam, type School } from '@/lib/planner/onboarding';

export interface ExamCreditTable {
  entries: ExamCreditEntry[];
  /** The registrar's own statement of which entering terms the table covers. */
  policy: string;
  /** The page a student can check it against. */
  source: string;
}

const EMPTY: ExamCreditTable = { entries: [], policy: '', source: '' };

/**
 * Where a school's exam table lives.
 *
 * SCHOOLS carries this for UGA and nothing else, and adding Illinois to it
 * means editing lib/planner/onboarding.ts, which another agent owns. The
 * Illinois file is named here instead so the control works today; the right
 * home for this line is the School record, and it should move there.
 */
export function examCreditUrl(school: School | undefined): string | null {
  if (!school) return null;
  if (school.examCredit) return school.examCredit;
  if (school.id === 'illinois') return '/illinois-exam-credit.json';
  return null;
}

let cache: { url: string; table: Promise<ExamCreditTable> } | null = null;

export function loadExamCredit(url: string | null): Promise<ExamCreditTable> {
  if (!url) return Promise.resolve(EMPTY);
  if (cache?.url === url) return cache.table;
  const table = fetch(url)
    .then((res) => (res.ok ? (res.json() as Promise<Partial<ExamCreditTable>>) : null))
    .then((data) => ({
      entries: data?.entries ?? [],
      policy: data?.policy ?? '',
      source: data?.source ?? '',
    }))
    .catch(() => {
      // A table that did not load must not be remembered as an empty one, or a
      // student who reloads gets "no credit" for the rest of the session.
      cache = null;
      return EMPTY;
    });
  cache = { url, table };
  return table;
}

export function useExamCredit(school: School | undefined): ExamCreditTable {
  const url = examCreditUrl(school);
  /**
   * The url is stored with the table so the old school's table is never handed
   * back for the new one. Clearing it in the effect instead would mean one
   * render where a student who just switched schools is shown another school's
   * credit, and it would be a synchronous setState inside an effect.
   */
  const [loaded, setLoaded] = useState<{ url: string | null; table: ExamCreditTable }>({
    url: null,
    table: EMPTY,
  });

  useEffect(() => {
    let cancelled = false;
    void loadExamCredit(url).then((table) => {
      if (!cancelled) setLoaded({ url, table });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return loaded.url === url ? loaded.table : EMPTY;
}

/**
 * The catalog courses a student's exams actually earn them.
 *
 * Illinois writes elective credit as "HIST 1--", which is real hours in a real
 * subject and is not a course anybody can be placed out of. Those are filtered
 * out here, because what comes back is fed to the planner as courses already
 * taken and a board cannot hold a course the catalog does not list. The hours
 * are not lost: applyExamCredit counts them separately and the onboarding step
 * shows the total.
 */
const COURSE_CODE = /^[A-Z]{2,5} \d{3}$/;

export function examCourses(exams: PriorExam[], table: ExamCreditEntry[]): string[] {
  if (exams.length === 0 || table.length === 0) return [];
  return applyExamCredit(exams, table).creditCourses.filter((code) => COURSE_CODE.test(code));
}

/**
 * Hours an exam grants in a subject rather than as a named course.
 *
 * "ECON 1--" is three real hours toward the degree that no board card can
 * hold. examCourses drops them, so the plan's prior credit came up short by
 * exactly those hours: a student with AP Macro at a 4 was shown three fewer
 * credits than the registrar's own table gives. Counted here and handed to the
 * plan as hours with no course. A row that names a real course alongside an
 * elective grant is priced by its courses and adds nothing here, which can
 * understate and never overstate.
 */
export function examElectiveHours(exams: PriorExam[], table: ExamCreditEntry[]): number {
  if (exams.length === 0 || table.length === 0) return 0;
  let hours = 0;
  for (const taken of exams) {
    const row = table.find(
      (e) =>
        e.kind === taken.kind &&
        e.exam === taken.exam &&
        String(e.score) === String(taken.score) &&
        (e.level ?? null) === (taken.level ?? null),
    );
    if (!row || row.noCredit || row.credits <= 0) continue;
    if (row.courses.some((code) => COURSE_CODE.test(code))) continue;
    hours += row.credits;
  }
  return hours;
}
