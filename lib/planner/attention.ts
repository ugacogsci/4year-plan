import type { PlanIssue } from './types';

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
 * Info on the board that is still a problem: credit the student holds that
 * will not count toward the degree, and a requirement the planner could not
 * read (a person has to check it against the degree page).
 */
const ALSO_A_PROBLEM = /^(?:ap-forfeit-|ap-exclusion-)|^unmet-.*-not-parsed$/;

/** Whether one issue on the board stands between the plan and the all-clear. */
export function needsAttention(issue: Pick<PlanIssue, 'id' | 'severity'>): boolean {
  return issue.severity === 'error' || issue.severity === 'warning' || ALSO_A_PROBLEM.test(issue.id);
}

/** Course-card titles that only make sense beside their course, said on their own. */
const ON_ITS_OWN: Record<string, string> = {
  'Check this one': 'Prerequisite to confirm',
  'Only you can answer this one': 'Prerequisite only you can confirm',
};

export interface AttentionItem {
  text: string;
  count: number;
  severity: PlanIssue['severity'];
}

/**
 * What needs attention, one item per kind of problem, errors first, each with
 * how many times the board shows it. A requirement row is titled with the
 * requirement's own name, so those are counted together as one kind.
 */
export function attentionItems(issues: ReadonlyArray<Pick<PlanIssue, 'id' | 'severity' | 'title'>>): AttentionItem[] {
  const items = new Map<string, AttentionItem>();
  for (const issue of issues) {
    if (!needsAttention(issue)) continue;
    const text = issue.id.startsWith('unmet-')
      ? issue.id.endsWith('-not-parsed')
        ? 'Requirement the planner could not read'
        : 'Requirement not met'
      : ON_ITS_OWN[issue.title] ?? issue.title;
    const hit = items.get(text);
    if (hit) {
      hit.count += 1;
      if (rank(issue.severity) < rank(hit.severity)) hit.severity = issue.severity;
    } else {
      items.set(text, { text, count: 1, severity: issue.severity });
    }
  }
  return [...items.values()].sort((a, b) => rank(a.severity) - rank(b.severity));
}

function rank(severity: PlanIssue['severity']): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
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
