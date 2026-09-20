'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  applyExamCredit,
  type ExamCreditEntry,
  type PriorExam,
  type School,
} from '@/lib/planner/onboarding';

/**
 * "What do you already have?"
 *
 * The step the planner cannot work without. A second-year transfer with 45
 * credits, a student who passed four AP exams, and a true first-year all need
 * completely different plans, and nothing in three open questions distinguishes
 * them.
 *
 * Exam credit is resolved against the registrar's published equivalence tables
 * rather than guessed, so the student sees the actual courses UGA will grant
 * before they commit to anything.
 */
export function PriorCredit({
  school,
  exams,
  transferText,
  onChange,
}: {
  school: School | undefined;
  exams: PriorExam[];
  transferText: string;
  onChange: (next: { exams: PriorExam[]; transferText: string }) => void;
}) {
  const [table, setTable] = useState<ExamCreditEntry[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setTable([]);
    if (!school?.examCredit) return;   // only UGA is scraped so far
    void fetch(school.examCredit)
      .then((r) => (r.ok ? (r.json() as Promise<{ entries: ExamCreditEntry[] }>) : null))
      .then((d) => d && setTable(d.entries))
      .catch(() => { /* the step still works, it just cannot price the exams */ });
  }, [school]);

  /** One row per exam, not per score, for the picker. */
  const examList = useMemo(() => {
    const seen = new Map<string, { kind: string; exam: string }>();
    for (const e of table) {
      const key = `${e.kind}|${e.exam}`;
      if (!seen.has(key)) seen.set(key, { kind: e.kind, exam: e.exam });
    }
    return [...seen.values()];
  }, [table]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return examList.filter((e) => `${e.kind} ${e.exam}`.toLowerCase().includes(q)).slice(0, 6);
  }, [examList, query]);

  const scoresFor = (kind: string, exam: string) =>
    table
      .filter((e) => e.kind === kind && e.exam === exam)
      .map((e) => ({ level: e.level, score: e.score, courses: e.courses, credits: e.credits }));

  const result = useMemo(() => applyExamCredit(exams, table), [exams, table]);

  function addExam(kind: string, exam: string) {
    const first = scoresFor(kind, exam).at(-1);
    onChange({
      transferText,
      exams: [...exams, { kind, exam, level: first?.level ?? null, score: first?.score ?? 5 }],
    });
    setQuery('');
  }

  function setScore(i: number, value: string) {
    const [level, score] = value.includes('|') ? value.split('|') : [null, value];
    const next = exams.slice();
    next[i] = { ...next[i], level: level || null, score: /^\d+$/.test(score) ? Number(score) : score };
    onChange({ exams: next, transferText });
  }

  return (
    <div className="prior">
      <div className="prior-block">
        <span className="onb-q-label">Did you take any AP or IB exams?</span>
        <span className="onb-q-hint">
          {table.length
            ? `We check all ${table.length.toLocaleString()} published score equivalences, so you see the exact courses ${school?.short ?? 'your school'} grants.`
            : `${school?.short ?? 'This school'}'s exam tables are not loaded yet. Add what you took and we will confirm the credit once they are.`}
        </span>

        <input
          className="prior-search"
          value={query}
          placeholder="Search an exam, e.g. Calculus, Biology, Psychology"
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length > 0 && (
          <ul className="prior-matches">
            {matches.map((m) => (
              <li key={`${m.kind}|${m.exam}`}>
                <button onClick={() => addExam(m.kind, m.exam)}>
                  <span className="prior-kind">{m.kind}</span> {m.exam}
                </button>
              </li>
            ))}
          </ul>
        )}

        {exams.length > 0 && (
          <ul className="prior-chosen">
            {exams.map((e, i) => (
              <li key={`${e.kind}|${e.exam}|${i}`}>
                <span className="prior-name">
                  <span className="prior-kind">{e.kind}</span> {e.exam}
                </span>
                <select
                  value={`${e.level ?? ''}|${e.score}`}
                  onChange={(ev) => setScore(i, ev.target.value)}
                >
                  {scoresFor(e.kind, e.exam).map((s) => (
                    <option key={`${s.level ?? ''}|${s.score}`} value={`${s.level ?? ''}|${s.score}`}>
                      {s.level ? `${s.level} ${s.score}` : `Score ${s.score}`}
                      {s.courses.length ? ` → ${s.courses.join(', ')}` : ' → no credit'}
                    </option>
                  ))}
                </select>
                <button
                  className="prior-remove"
                  aria-label={`Remove ${e.exam}`}
                  onClick={() => onChange({ transferText, exams: exams.filter((_, j) => j !== i) })}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}

        {result.credits > 0 && (
          <p className="prior-total">
            <strong>{result.credits} credit hours</strong> toward your degree
            {result.creditCourses.length > 0 && <> &middot; {result.creditCourses.join(', ')}</>}
            {result.exemptCourses.length > 0 && (
              <>
                <br />
                <span className="prior-exempt">
                  Exempt but no credit: {result.exemptCourses.join(', ')}. You skip these, they do not count toward 120.
                </span>
              </>
            )}
          </p>
        )}
      </div>

      <label className="prior-block onb-q">
        <span className="onb-q-label">Transferred or dual enrollment credit?</span>
        <span className="onb-q-hint">
          Where it came from and roughly what transferred. Paste from your transcript or {school?.portal ?? 'your student portal'} if it is easier.
        </span>
        <textarea
          rows={3}
          value={transferText}
          placeholder={
            school
              ? `Two semesters of dual enrollment at ${school.feeders.split(',')[0]}: ENGL 1101, ENGL 1102, POLS 1101. Also a summer class at ${school.feeders.split(',')[1]?.trim() ?? 'a community college'}.`
              : 'Where the credit came from and roughly what transferred.'
          }
          onChange={(e) => onChange({ exams, transferText: e.target.value })}
        />
      </label>
    </div>
  );
}
