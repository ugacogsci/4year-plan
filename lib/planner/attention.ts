import type { PlanIssue } from './types';
import { issueTier, triageIssues } from './warnings-triage';

/**
 * Whether the board may say "Nothing needs attention", and what it says when
 * it may not.
 *
 * The build used to decide the all-clear from two things only: courses it
 * could not place, and requirements left unmet for a reason other than
 * "filled by electives" or "not read". Everything else the board itself
 * flags was left out: a plan short of the degree total, a course before its
 * prerequisite, a term over the limit, credit that will not count, a course
 * that has not run in years, a requirement the planner could not read. An
 * Economics freshman built on a misread rule, and a UGA pre-med whose labs
 * came before their lectures, were both told "Nothing needs attention" over
 * boards with problems on them. Now the all-clear follows the same issues the
 * board's dots and ! marks show, so it appears only when every check passes.
 */

/**
 * Since 2026-10-20 the tiers come from lib/planner/warnings-triage.ts: an
 * issue needs attention when it matters now (the plan is wrong or cannot be
 * registered). A requirement the planner could not fully read and credit that
 * will not count, which this file used to lift into the count, are now good
 * to know: the board folds them behind "Show N more" and still lists them.
 */
export function needsAttention(issue: Pick<PlanIssue, 'id' | 'severity' | 'title'> & Partial<Pick<PlanIssue, 'message'>>): boolean {
  return issueTier({ message: '', ...issue }) === 'now';
}

export interface AttentionItem {
  text: string;
  count: number;
  severity: PlanIssue['severity'];
}

/**
 * What needs attention, one item per kind of problem in the triage's order
 * (warnings-triage.ts), each with how many times the board shows it. The
 * board bar itself reads triageIssues; this stays for the sentence below.
 */
export function attentionItems(issues: ReadonlyArray<Pick<PlanIssue, 'id' | 'severity' | 'title'> & Partial<Pick<PlanIssue, 'message' | 'termId' | 'courseId'>>>): AttentionItem[] {
  const full = issues.map((issue) => ({ message: '', termId: '', ...issue }));
  return triageIssues(full).now.map((kind) => ({
    text: kind.rows[0].kind.text,
    count: kind.rows.reduce((sum, row) => sum + row.count, 0),
    severity: kind.severity,
  }));
}

/**
 * One plain sentence for the board bar and the build message: how many
 * problems and the first few kinds.
 */
export function attentionLine(items: AttentionItem[], limit = 3): string {
  if (items.length === 0) return '';
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const shown = items.slice(0, limit).map((item) => (item.count > 1 ? `${item.text} (${item.count})` : item.text));
  const more = items.length - shown.length;
  return `${total} ${total === 1 ? 'thing needs' : 'things need'} attention: ${shown.join('; ')}${more > 0 ? `; ${more} more ${more === 1 ? 'kind' : 'kinds'}` : ''}.`;
}

/**
 * The note that says the plan ends before the finish the student named
 * (autoplan.ts, GeneratedPlan.earlyFinish), for the board bar. Read from the
 * notes so a board restored from this device shows it too.
 */
export function earlyFinishNote(notes: readonly string[]): string | null {
  return notes.find((note) => /^This plan(?:'s courses end in| finishes in) .*, \d+ terms? before the (?:Fall|Spring|Summer) \d{4} you asked for\b/.test(note)) ?? null;
}
