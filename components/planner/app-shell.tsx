'use client';

import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
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
 * Answers and boards live in localStorage. Using the adviser sends the
 * conversation and relevant planning context to the configured model service.
 * An uploaded transcript is sent once to /api/transcript to be read; this app
 * does not persist the uploaded document on the server.
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
      <TooltipProvider>
        <Onboarding
          initial={saved}
          onResume={(next) => {
            saveAnswers(next);
            setAnswers(next);
          }}
          onDone={(next) => {
            // A board saved under the previous answers would otherwise win over
            // the plan these answers are about to build, and its conversation
            // must be cleared with it.
            clearSavedPlan(next.schoolId ?? undefined);
            setAnswers(next);
          }}
        />
      </TooltipProvider>
    );
  }
  return (
    <TooltipProvider>
      <PlannerWorkspace
        key={answers.schoolId}
        answers={answers}
        onChangeUniversity={() => {
          setSaved(answers);
          setAnswers(null);
        }}
        onAnswersChange={(next) => {
          saveAnswers(next);
          setAnswers(next);
        }}
      />
    </TooltipProvider>
  );
}
