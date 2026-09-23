'use client';

import { useMemo, useState, useEffect } from 'react';
import { examCreditUrl, useExamCredit } from './exam-credit';
import { TranscriptUpload } from './transcript-upload';
import type { TranscriptRecord } from '@/lib/planner/transcript';
import {
  applyExamCredit,
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
 * rather than guessed, so the student sees the actual courses their own school
 * will grant before they commit to anything. A school with no published table
 * gets no search box rather than one that can never find anything.
 */
export function PriorCredit({
  school,
  exams,
  transferText,
  languageYears = null,
  language = '',
  onChange,
  transcript,
  onTranscriptChange,
}: {
  school: School | undefined;
  exams: PriorExam[];
  transferText: string;
  /** Years of one language other than English in high school, and which one. */
  languageYears?: number | null;
  language?: string;
  onChange: (next: { exams: PriorExam[]; transferText: string; languageYears?: number | null; language?: string }) => void;
  /** The uploaded transcript, kept apart from the typed answers so neither overwrites the other. */
  transcript?: TranscriptRecord | null;
  onTranscriptChange?: (next: TranscriptRecord | null) => void;
}) {
  const loaded = useExamCredit(school);
  const table = loaded.entries;
  const [query, setQuery] = useState('');
  /** The registrar's language names, for the picker. Empty until the small file arrives. */
  const [languageNames, setLanguageNames] = useState<string[]>([]);
  useEffect(() => {
    if (school?.id !== 'illinois') return;
    let live = true;
    fetch('/illinois/languages.json')
      .then((r) => (r.ok ? (r.json() as Promise<{ languages?: Array<{ name: string }> }>) : null))
      .then((d) => {
        if (live && d?.languages) setLanguageNames(d.languages.map((l) => l.name));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [school?.id]);
  /**
   * Whether this school has a table at all, which is not the same as whether it
   * has loaded. A school with no table gets no search box: an input that
   * accepts typing and can never return a match is a control that lies about
   * what it does, and Illinois shipped exactly that for months.
   */
  const hasTable = examCreditUrl(school) !== null;

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

  /** Grants that name a subject and a level rather than a class. */
  const electiveOnly = useMemo(
    () => result.creditCourses.filter((code) => !/^[A-Z]{2,5} \d{3}$/.test(code)),
    [result],
  );

  /**
   * An exam the student has named but not yet scored.
   *
   * applyExamCredit matches on the score, so an exam with no score matches no
   * row and earns nothing anywhere in the product. That is the point: the
   * credit has to wait for the student to say what they got.
   */
  const unscored = (e: PriorExam) => String(e.score).trim() === '';
  const waiting = exams.filter(unscored).length;

  /**
   * Adding an exam records the exam and nothing else.
   *
   * This used to preselect a score, and the row it picked was the last one in
   * the table, which is the top of the scale. Naming an exam and touching
   * nothing granted a student the credit for a 5. The plan was then built on
   * courses they may never have earned, and the student had no reason to
   * doubt it, because the screen showed a total and named the classes.
   * Nobody but the student knows their score, so the student states it.
   */
  function addExam(kind: string, exam: string) {
    onChange({
      transferText,
      exams: [...exams, { kind, exam, level: null, score: '' }],
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
      {school?.id === 'illinois' && (
        <div className="onb-q">
          <span className="onb-q-label">Language other than English in high school</span>
          <p className="onb-q-help">
            Illinois counts each year of one language in high school as one college semester toward its
            language requirement, and requires two years for admission. Three years usually means no
            language courses to plan; fewer means the plan books the rest. A placement test decides
            where you start if you continue.
          </p>
          <div className="onb-lang-row">
            <select
              id="onb-language-years"
              aria-label="Years of one language in high school"
              title="Years of one language in high school"
              value={languageYears === null ? '' : String(languageYears)}
              onChange={(event) => {
                const raw = event.target.value;
                onChange({ exams, transferText, languageYears: raw === '' ? null : Number(raw), language });
              }}
            >
              <option value="">Not sure (the plan assumes 2, the admission minimum)</option>
              <option value="0">None</option>
              <option value="1">1 year</option>
              <option value="2">2 years</option>
              <option value="3">3 years</option>
              <option value="4">4 or more years</option>
            </select>
            <input
              id="onb-language-name"
              list="onb-language-names"
              aria-label="Which language"
              title="Which language"
              placeholder="Which language (Spanish, French, ...)"
              value={language}
              onChange={(event) => onChange({ exams, transferText, languageYears, language: event.target.value })}
            />
            <datalist id="onb-language-names">
              {languageNames.map((name) => (
                <option key={name} value={name} label={name}>
                  {name}
                </option>
              ))}
            </datalist>
          </div>
        </div>
      )}

      {onTranscriptChange && (
        <div className="prior-block">
          <span className="onb-q-label">Have a transcript?</span>
          <span className="onb-q-hint">
            Upload it and every course on it is read for you. You check the list before anything counts.
          </span>
          <TranscriptUpload school={school} record={transcript ?? null} onChange={onTranscriptChange} />
        </div>
      )}

      <div className="prior-block">
        <span className="onb-q-label">Did you take any AP or IB exams?</span>
        <span className="onb-q-hint">
          {!hasTable
            ? `${school?.short ?? 'This school'} has not published an exam table we can read, so there is nothing to search yet. Write what you took in the box below instead.`
            : table.length
              ? `We check all ${table.length.toLocaleString()} published score equivalences, so you see the exact courses ${school?.short ?? 'your school'} grants.`
              : `Reading ${school?.short ?? 'your school'}'s exam tables.`}
        </span>
        {/* The registrar publishes one table per entering year and says which.
            A student holding a 5 on an exam whose credit changed last spring
            has to know which year they are being shown. */}
        {loaded.policy && <span className="onb-q-hint">{loaded.policy}</span>}

        {hasTable && (
          <input
            className="prior-search"
            value={query}
            placeholder="Search an exam, e.g. Calculus, Biology, Psychology"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
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
              <li key={`${e.kind}|${e.exam}|${i}`} className={unscored(e) ? 'prior-unscored' : undefined}>
                <span className="prior-name">
                  <span className="prior-kind">{e.kind}</span> {e.exam}
                </span>
                <select
                  aria-label={`Your score on ${e.kind} ${e.exam}`}
                  value={`${e.level ?? ''}|${e.score}`}
                  onChange={(ev) => setScore(i, ev.target.value)}
                >
                  {/* Selected until the student chooses, and they can come back
                      to it. No score means no credit, here and on the board. */}
                  <option value="|">What did you score?</option>
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

        {waiting > 0 && (
          <p className="prior-waiting">
            {waiting === 1
              ? 'Pick your score above. Until you do, that exam counts for nothing here and nothing on your plan.'
              : `Pick your ${waiting} scores above. Until you do, those exams count for nothing here and nothing on your plan.`}
          </p>
        )}

        {result.credits > 0 && (
          <p className="prior-total">
            <strong>
              {result.credits} credit {result.credits === 1 ? 'hour' : 'hours'}
            </strong>{' '}
            toward your degree
            {result.creditCourses.length > 0 && <> &middot; {result.creditCourses.join(', ')}</>}
            {/* Illinois writes elective credit as "HIST 1--", which is hours in
                a subject rather than a named class. Printed as the registrar
                wrote it, then explained, because a student who reads it as a
                course code will go looking for a class that is not taught. */}
            {electiveOnly.length > 0 && (
              <>
                <br />
                <span className="prior-exempt">
                  {electiveOnly.join(', ')} {electiveOnly.length === 1 ? 'is' : 'are'} elective
                  credit in that subject rather than a particular class. The hours count, and your
                  advisor decides where they land.
                </span>
              </>
            )}
            {result.exemptCourses.length > 0 && (
              <>
                <br />
                <span className="prior-exempt">
                  Exempt but no credit: {result.exemptCourses.join(', ')}. You skip these and they
                  add no hours.
                </span>
              </>
            )}
          </p>
        )}
      </div>

      <label className="prior-block onb-q">
        <span className="onb-q-label">Transferred or dual enrollment credit?</span>
        <span className="onb-q-hint">
          Where it came from and roughly what transferred. Only {school?.short ?? 'this school'}&rsquo;s own course codes count here; another school&rsquo;s course counts once {school?.short ?? 'this school'} has named its equivalent, so type that code.
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
