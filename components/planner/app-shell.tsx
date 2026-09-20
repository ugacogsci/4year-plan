'use client';

import { useEffect, useState } from 'react';
import { Onboarding } from './onboarding';
import { PlannerWorkspace } from './planner-workspace';
import { loadAnswers, type OnboardingAnswers } from '@/lib/planner/onboarding';

/**
 * Onboarding on a first visit, the planner on every visit after.
 *
 * Answers live in localStorage. Nothing about a student leaves the device
 * until there is a backend and a FERPA review, which is the boundary the
 * project README draws.
 */
export function AppShell() {
  const [answers, setAnswers] = useState<OnboardingAnswers | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAnswers(loadAnswers());
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!answers) return <Onboarding onDone={setAnswers} />;
  return <PlannerWorkspace answers={answers} />;
}
