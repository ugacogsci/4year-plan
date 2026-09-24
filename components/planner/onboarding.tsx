'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProgramPicker, type ProgramOption } from './program-picker';
import { PriorCredit } from './prior-credit';
import { EmphasisPicker, emphasisSelectionsComplete } from './emphasis-picker';
import {
  ugaSelectionRequirements,
  type UgaProgram,
  type UgaSelectionRequirement,
} from './uga-source';
import {
  EMPTY_ANSWERS,
  questionsFor,
  readySchools,
  schoolById,
  saveAnswers,
  type OnboardingAnswers,
  type SchoolId,
} from '@/lib/planner/onboarding';
import { transcriptCodes } from '@/lib/planner/transcript';

/**
 * Four screens before the planner: pick a school, explicitly choose one or
 * more majors, describe the rest of the situation, then add prior credit.
 *
 * The middle screen is deliberately three open text boxes rather than a form.
 * Someone who has failed calculus once and is deciding between two majors
 * cannot express that in dropdowns, and that context is exactly what makes
 * the resulting plan worth anything.
 */
/** What the credit step has so far, for the line between Back and Build. */
function priorSummary(a: OnboardingAnswers): string {
  const parts: string[] = [];
  const fromTranscript = transcriptCodes(a.transcript).length;
  if (fromTranscript > 0) {
    parts.push(`${fromTranscript} course${fromTranscript === 1 ? '' : 's'} from your transcript`);
  }
  if (a.exams.length > 0) parts.push(`${a.exams.length} exam${a.exams.length === 1 ? '' : 's'} added`);
  if (a.alreadyTakenCourseCodes.length > 0) {
    parts.push(
      `${a.alreadyTakenCourseCodes.length} UGA course${a.alreadyTakenCourseCodes.length === 1 ? '' : 's'} added`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nothing added yet';
}

interface ProgramCatalog {
  majors: ProgramOption[];
  minors: ProgramOption[];
  certificates: ProgramOption[];
  requirements: UgaSelectionRequirement[];
}

export function Onboarding({
  onDone,
  initial = null,
  onResume,
}: {
  onDone: (a: OnboardingAnswers) => void;
  /** Last time's answers, so a returning student edits rather than retypes. */
  initial?: OnboardingAnswers | null;
  /** Skips the questions and opens the saved plan. Offered only when there is one. */
  onResume?: () => void;
}) {
  /**
   * The school question is only asked when there is a choice to make.
   *
   * With Illinois the only school this build can plan, the first screen used to
   * be five buttons, four of which led to a demo catalog wearing another
   * university's name. Now it starts on "About you" with Illinois chosen, and
   * the school step comes back on its own the day a second school is ready.
   */
  const ready = readySchools();
  const onlySchool = ready.length === 1 ? ready[0] : null;
  const [step, setStep] = useState(onlySchool ? 1 : 0);
  const [catalog, setCatalog] = useState<ProgramCatalog | null>(null);
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => {
    const base = initial ? { ...EMPTY_ANSWERS, ...initial } : EMPTY_ANSWERS;
    return onlySchool
      ? { ...base, schoolId: onlySchool.id, programIds: base.programIds ?? [] }
      : { ...base, programIds: base.programIds ?? [] };
  });

  const school = schoolById(answers.schoolId);
  const questions = questionsFor(school);
  const answered = questions.filter((q) => answers[q.key].trim().length > 0).length;
  const emphasisRequirements = useMemo(
    () =>
      (catalog?.requirements ?? []).filter((requirement) =>
        answers.programIds.includes(requirement.programId),
      ),
    [catalog, answers.programIds],
  );
  const emphasesComplete = emphasisSelectionsComplete(
    emphasisRequirements,
    answers.emphasisSelections,
  );
  const programChoicesReady = answers.schoolId !== 'uga' || catalog !== null;

  useEffect(() => {
    if (!answers.schoolId) return;
    let cancelled = false;
    const url = answers.schoolId === 'uga' ? '/uga-programs.json' : '/illinois/programs.json';
    void fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((raw: unknown) => {
        if (cancelled) return;
        if (answers.schoolId === 'uga') {
          const rows = ((raw as { programs?: UgaProgram[] } | null)?.programs ?? [])
            .filter((program) => program.areas.length > 0);
          const options = (programs: UgaProgram[]) =>
            programs
              .map((program) => ({ id: program.id, name: program.name }))
              .sort((a, b) => a.name.localeCompare(b.name));
          const majors = rows.filter(
            (program) => program.degree === 'AB' || /^B[A-Z]+$/.test(program.degree),
          );
          setCatalog({
            majors: options(majors),
            minors: options(rows.filter((program) => program.degree === 'MINOR' && program.areaHours > 0)),
            certificates: options(rows.filter((program) => program.degree === 'CERT-UG' && program.areaHours > 0)),
            requirements: majors.flatMap(ugaSelectionRequirements),
          });
          return;
        }
        const majors = (Array.isArray(raw) ? raw : [])
          .filter((program: { degree?: string; dataStatus?: string; courseCount?: number }) =>
            /^(AB|BA|BS|BFA|BLA|BMUS|BSLAS|BSW)$/i.test(program.degree ?? '') &&
            program.dataStatus === 'catalog' &&
            (program.courseCount ?? 0) > 0,
          )
          .map((program: { id: string; name: string }) => ({ id: program.id, name: program.name }))
          .sort((a: ProgramOption, b: ProgramOption) => a.name.localeCompare(b.name));
        setCatalog({ majors, minors: [], certificates: [], requirements: [] });
      })
      .catch(() => {
        if (!cancelled) setCatalog({ majors: [], minors: [], certificates: [], requirements: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [answers.schoolId]);

  function pick(id: SchoolId) {
    if (answers.schoolId !== id) setCatalog(null);
    setAnswers((a) => ({
      ...a,
      schoolId: id,
      programIds: a.schoolId === id ? a.programIds : [],
      minorIds: a.schoolId === id ? a.minorIds : [],
      certificateIds: a.schoolId === id ? a.certificateIds : [],
      emphasisSelections: a.schoolId === id ? a.emphasisSelections : {},
      alreadyTakenCourseCodes: a.schoolId === id ? a.alreadyTakenCourseCodes : [],
    }));
  }

  function finish() {
    setStep(4);
    saveAnswers(answers);
    window.setTimeout(() => onDone(answers), 1400);
  }

  return (
    <div className="onb" style={school ? ({ ['--school' as string]: school.accent }) : undefined}>
      <div className="onb-inner">
        <ol className="onb-steps" aria-label="Progress">
          {['School', 'Majors', 'About you', 'Credit', 'Profile'].map((label, i) => (
            <li key={label} className={i === step ? 'now' : i < step ? 'done' : ''}>
              <span className="onb-dot">{i < step ? '✓' : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {onResume && programChoicesReady && emphasesComplete && step < 4 && (
          <p className="onb-resume">
            Your answers from last time are filled in below.{' '}
            <button type="button" onClick={onResume}>
              Continue with my saved plan
            </button>{' '}
            or change anything and build it again.
          </p>
        )}

        {step === 0 && (
          <section className="onb-step">
            <h1>Choose your university</h1>
            <p className="onb-sub">We answer from your university&rsquo;s own published pages, so this decides everything else.</p>
            <div className="onb-university-picker">
              <label htmlFor="university">University</label>
              <select
                id="university"
                value={answers.schoolId ?? ''}
                onChange={(event) => pick(event.target.value as SchoolId)}
              >
                <option value="">Select a university</option>
                {ready.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              {school && (
                <p>
                  {school.short} data comes from its published course catalog, degree requirements,
                  prerequisites, and exam-credit policy.
                </p>
              )}
            </div>
            <div className="onb-actions onb-university-actions">
              <span />
              <button className="onb-next" onClick={() => setStep(1)} disabled={!answers.schoolId}>
                Choose majors
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="onb-step">
            <h1>Choose your programs.</h1>
            <p className="onb-sub">
              Select every declared or intended major, then add any minor, certificate, or required program path.
            </p>
            <div className="onb-program-groups">
              <section>
                <h2>Majors</h2>
                <ProgramPicker
                  options={catalog?.majors ?? []}
                  selectedIds={answers.programIds}
                  onChange={(programIds) => setAnswers((current) => ({ ...current, programIds }))}
                  loading={catalog === null}
                />
              </section>
              {answers.schoolId === 'uga' && (
                <>
                  <section>
                    <h2>Minors</h2>
                    <ProgramPicker
                      options={catalog?.minors ?? []}
                      selectedIds={answers.minorIds}
                      onChange={(minorIds) => setAnswers((current) => ({ ...current, minorIds }))}
                      loading={catalog === null}
                      kindLabel="minor"
                      emptyMessage="No parsed UGA minors are available."
                    />
                  </section>
                  <section>
                    <h2>Certificates</h2>
                    <ProgramPicker
                      options={catalog?.certificates ?? []}
                      selectedIds={answers.certificateIds}
                      onChange={(certificateIds) => setAnswers((current) => ({ ...current, certificateIds }))}
                      loading={catalog === null}
                      kindLabel="certificate"
                      emptyMessage="No parsed UGA certificates are available."
                    />
                  </section>
                </>
              )}
              <EmphasisPicker
                requirements={emphasisRequirements}
                selections={answers.emphasisSelections}
                onChange={(emphasisSelections) =>
                  setAnswers((current) => ({ ...current, emphasisSelections }))
                }
              />
            </div>
            <div className="onb-actions">
              {!onlySchool && <button className="onb-back" onClick={() => setStep(0)}>Back</button>}
              <span className="onb-count">
                {answers.programIds.length === 0
                  ? 'Choose at least one major'
                  : !emphasesComplete
                    ? 'Complete the required program choices'
                  : `${answers.programIds.length} major${answers.programIds.length === 1 ? '' : 's'} selected`}
              </span>
              <button
                className="onb-next"
                onClick={() => setStep(2)}
                disabled={answers.programIds.length === 0 || !programChoicesReady || !emphasesComplete}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onb-step">
            <h1>Tell us where you are{school ? ` at ${school.short}` : ''}.</h1>
            <p className="onb-sub">
              Write it however you would say it out loud. Rough is fine, and you can change any of it later.
            </p>
            <div className="onb-questions">
              {questions.map((q) => (
                <label key={q.key} className="onb-q">
                  <span className="onb-q-label">{q.label}</span>
                  <span className="onb-q-hint">{q.hint}</span>
                  <textarea
                    rows={3}
                    value={answers[q.key]}
                    placeholder={q.placeholder}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="onb-actions">
              {/* No school step to go back to when there was no school to choose. */}
              <button className="onb-back" onClick={() => setStep(1)}>Back</button>
              <span className="onb-count">{answered} of 3 answered</span>
              <button className="onb-next" onClick={() => setStep(3)} disabled={answered === 0}>
                Next
              </button>
            </div>
            <p className="onb-skip">
              <button onClick={() => setStep(3)}>Skip for now</button>
            </p>
          </section>
        )}

        {step === 3 && (
          <section className="onb-step">
            <h1>What do you already have?</h1>
            <p className="onb-sub">
              This is the part a plan cannot be built without. Skip it if you are starting from zero.
            </p>
            <PriorCredit
              school={school}
              exams={answers.exams}
              transferText={answers.transferText}
              onChange={(next) => setAnswers((a) => ({ ...a, ...next }))}
              transcript={answers.transcript ?? null}
              onTranscriptChange={(transcript) => setAnswers((a) => ({ ...a, transcript }))}
              alreadyTakenCourseCodes={answers.alreadyTakenCourseCodes}
              onAlreadyTakenChange={(alreadyTakenCourseCodes) =>
                setAnswers((a) => ({ ...a, alreadyTakenCourseCodes }))
              }
            />
            <div className="onb-actions">
              <button className="onb-back" onClick={() => setStep(2)}>Back</button>
              <span className="onb-count">{priorSummary(answers)}</span>
              <button className="onb-next" onClick={finish}>
                {initial ? 'Build my plan again' : 'Build my plan'}
              </button>
            </div>
            <p className="onb-skip">
              <button onClick={finish}>I am starting from zero</button>
            </p>
          </section>
        )}

        {step === 4 && (
          <section className="onb-step onb-building">
            <div className="onb-spinner" aria-hidden="true" />
            <h1>Building your profile</h1>
            <p className="onb-sub">
              Reading {school?.short ?? 'your university'}&rsquo;s catalog, requirements and prerequisites.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
