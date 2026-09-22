'use client';

import { useEffect, useState } from 'react';
import { Onboarding } from './onboarding';
import { clearSavedPlan, PlannerWorkspace } from './planner-workspace';
import { isReadySchool, loadAnswers, saveAnswers, type OnboardingAnswers } from '@/lib/planner/onboarding';

/**
 * The questions on every launch, the planner after them.
 *
 * Opening straight onto a saved board skipped the one moment the product asks
 * who the student is now. So the questions come first each time, filled with
 * what was said last time, and one link skips to the saved plan for anyone who
 * has nothing to change. New answers build a new plan.
 *
 * Answers live in localStorage. Nothing about a student leaves the device
 * until there is a backend and a FERPA review, which is the boundary the
 * project README draws. The one exception is a transcript the student chooses
 * to upload: it is sent once to /api/transcript to be read, and not kept.
 */
export function AppShell() {
  const [saved, setSaved] = useState<OnboardingAnswers | null>(null);
  const [answers, setAnswers] = useState<OnboardingAnswers | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    /**
     * Read once, on arrival, and never again. It cannot be derived during
     * render: localStorage does not exist on the server, so a first client
     * render that used it would not match the HTML the server sent.
     *
     * A setup for a school this build cannot plan is not offered back; the
     * questions then start empty, for a school with a catalog.
     */
    const stored = loadAnswers();
    // oxlint-disable-next-line react/react-compiler
    setSaved(stored && isReadySchool(stored.schoolId) ? stored : null);
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!answers) {
    return (
      <Onboarding
        initial={saved}
        onResume={saved ? () => setAnswers(saved) : undefined}
        onDone={(next) => {
          // A board saved under the previous answers would otherwise win over
          // the plan these answers are about to build.
          clearSavedPlan();
          setAnswers(next);
        }}
      />
    );
  }
  return (
    <PlannerWorkspace
      answers={answers}
      onAnswersChange={(next) => {
        saveAnswers(next);
        setAnswers(next);
      }}
    />
  );
}
