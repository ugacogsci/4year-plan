import type { PlanIssue } from './types';

/** One readable, plan-wide warning derived from the board as it exists now. */
export function degreeCompletionIssue(input: {
  currentCredits: number;
  requiredCredits: number | null;
  incompleteRequirementNames: string[];
  termId: string;
}): PlanIssue | null {
  const missingCredits = input.requiredCredits === null
    ? 0
    : Math.max(0, input.requiredCredits - input.currentCredits);
  const incompleteNames = [...new Set(input.incompleteRequirementNames.filter(Boolean))];
  if (missingCredits === 0 && incompleteNames.length === 0) return null;

  return {
    id: 'degree-incomplete',
    severity: 'error',
    title: 'This plan does not fulfill the degree yet',
    message: [
      missingCredits > 0
        ? `This draft has ${input.currentCredits} of the ${input.requiredCredits} credits required for the degree.`
        : null,
      incompleteNames.length > 0
        ? `Incomplete requirements include ${incompleteNames.slice(0, 3).join(', ')}${incompleteNames.length > 3 ? ` and ${incompleteNames.length - 3} more` : ''}.`
        : null,
      'Add or replace courses until every degree requirement is complete.',
    ].filter(Boolean).join(' '),
    termId: input.termId,
  };
}
