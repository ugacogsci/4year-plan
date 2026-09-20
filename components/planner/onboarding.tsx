'use client';

import { useState } from 'react';
import { PriorCredit } from './prior-credit';
import {
  EMPTY_ANSWERS,
  questionsFor,
  schoolById,
  SCHOOLS,
  saveAnswers,
  type OnboardingAnswers,
  type SchoolId,
} from '@/lib/planner/onboarding';

/**
 * Three screens before the planner: pick a school, describe your situation,
 * then we build the profile.
 *
 * The middle screen is deliberately three open text boxes rather than a form.
 * Someone who has failed calculus once and is deciding between two majors
 * cannot express that in dropdowns, and that context is exactly what makes
 * the resulting plan worth anything.
 */
export function Onboarding({ onDone }: { onDone: (a: OnboardingAnswers) => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ANSWERS);

  const school = schoolById(answers.schoolId);
  const questions = questionsFor(school);
  const answered = questions.filter((q) => answers[q.key].trim().length > 0).length;

  function pick(id: SchoolId) {
    setAnswers((a) => ({ ...a, schoolId: id }));
    setStep(1);
  }

  function finish() {
    setStep(3);
    saveAnswers(answers);
    window.setTimeout(() => onDone(answers), 1400);
  }

  return (
    <div className="onb" style={school ? ({ ['--school' as string]: school.accent }) : undefined}>
      <div className="onb-inner">
        <ol className="onb-steps" aria-label="Progress">
          {['School', 'About you', 'Credit', 'Profile'].map((label, i) => (
            <li key={label} className={i === step ? 'now' : i < step ? 'done' : ''}>
              <span className="onb-dot">{i < step ? '✓' : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="onb-step">
            <h1>Where do you go?</h1>
            <p className="onb-sub">We answer from your university&rsquo;s own published pages, so this decides everything else.</p>
            <div className="onb-schools">
              {SCHOOLS.map((s) => (
                <button
                  key={s.id}
                  className="onb-school"
                  style={{ ['--school' as string]: s.accent }}
                  onClick={() => pick(s.id)}
                >
                  <span className="onb-school-mark" aria-hidden="true" />
                  <span className="onb-school-name">{s.short}</span>
                  <span className="onb-school-people">{s.people}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
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
              <button className="onb-back" onClick={() => setStep(0)}>Back</button>
              <span className="onb-count">{answered} of 3 answered</span>
              <button className="onb-next" onClick={() => setStep(2)} disabled={answered === 0}>
                Next
              </button>
            </div>
            <p className="onb-skip">
              <button onClick={() => setStep(2)}>Skip for now</button>
            </p>
          </section>
        )}

        {step === 2 && (
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
            />
            <div className="onb-actions">
              <button className="onb-back" onClick={() => setStep(1)}>Back</button>
              <span className="onb-count">
                {answers.exams.length > 0
                  ? `${answers.exams.length} exam${answers.exams.length === 1 ? '' : 's'} added`
                  : 'Nothing added yet'}
              </span>
              <button className="onb-next" onClick={finish}>Build my plan</button>
            </div>
            <p className="onb-skip">
              <button onClick={finish}>I am starting from zero</button>
            </p>
          </section>
        )}

        {step === 3 && (
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
