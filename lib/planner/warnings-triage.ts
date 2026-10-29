import type { IssueSeverity, PlanIssue } from './types';

/**
 * What the board bar says about a plan: the few things that matter now, and
 * everything else folded behind "Show N more".
 *
 * Wrong on the live site on 2026-10-20 (the owner's "fewer pointless
 * warnings"): a new student saw "11 things need attention", a row of red and
 * yellow badges and "This plan does not fulfill the degree yet; IV. World
 * Languages...; 4 more kinds", mostly because they had typed "about 70
 * credits" and uploaded nothing, so every requirement those credits fill read
 * as missing. At UGA "In-progress credit is conditional" showed for nearly
 * every continuing student, and every requirement the catalog snapshot could
 * not fully read added a warning of its own, so a UGA board almost never said
 * "Plan built. Nothing needs attention."
 *
 * Every issue is now one of two tiers:
 *
 *   matters now   the plan as drawn is wrong or cannot be registered: a
 *                 required class missing, a prerequisite missing or out of
 *                 order, class standing not reached, a term over the credit
 *                 limit, two classes at the same hour, a class in a term it
 *                 does not run, courses left out because they do not fit
 *                 before the finish the student asked for.
 *   good to know  information: a requirement the planner could not fully
 *                 read (an advisor checks it), credit that is conditional on
 *                 passing classes in progress, a prerequisite worded so only
 *                 the student can answer it, a course that has not run lately.
 *
 * The bar shows at most three "matters now" kinds in plain words and folds
 * the rest; nothing is dropped. When the student said they hold credit the
 * plan cannot see, one prompt to add it replaces the requirement shortfalls
 * that missing credit explains, and those shortfalls move under "more".
 * "Nothing needs attention" shows whenever nothing matters now. ALMA and ARCH
 * get every row, ranked the same way (rankedFlags).
 *
 * Plans are not touched here: this only decides how issues are presented.
 */

export type IssueTier = 'now' | 'later';

type IssueLike = Pick<PlanIssue, 'id' | 'severity' | 'title' | 'message'> & Partial<Pick<PlanIssue, 'termId' | 'courseId'>>;

/** How many "matters now" kinds the board bar shows before "Show N more". */
export const PROMINENT_LIMIT = 3;

interface KindRule {
  key: string;
  match: RegExp;
  tier: IssueTier | ((issue: IssueLike) => IssueTier);
  /** Plain words for the kind on the board bar; null keeps the issue's own title. */
  text: string | null;
  /** Lower comes first. */
  rank: number;
  /**
   * A shortfall that credit the plan cannot see explains: a requirement it
   * would fill, the degree total, a class standing, a prerequisite already
   * taken. Folded under the record prompt while that credit is missing.
   */
  record?: boolean;
}

/**
 * The issue ids the planner writes (autoplan.ts validatePlan, the workspace's
 * review rows, uga-board-audit.ts, double-dawgs.ts, transfer-maybe.ts), first
 * match wins. An id not listed here is "matters now" when it is an error or a
 * warning and "good to know" when it is information, so a new kind of problem
 * is never hidden by default.
 */
const KIND_RULES: KindRule[] = [
  // The student said they hold credit the plan does not see (the record prompt).
  { key: 'record', match: /^stated-hours$/, tier: 'now', text: null, rank: 0 },
  // The board was built for another Double Dawgs choice: nothing else on it is final.
  { key: 'double-dawgs-rebuild', match: /^double-dawgs-rebuild$/, tier: 'now', text: null, rank: 1 },
  // A transfer line that may be a required course: the plan holds that requirement open until the student says.
  { key: 'transfer-maybe', match: /^transfer-maybe-/, tier: 'now', text: 'Transfer course to confirm', rank: 2 },
  // Requirements the catalog snapshot or the reading could not fully read: an advisor checks these.
  { key: 'unread', match: /^unmet-.*-(?:not-parsed|no-course-data)$|^uga-unverified-|^uga-pool-.*-no-course-data$/, tier: 'later', text: 'Requirement to check with your advisor', rank: 100 },
  // Hours the page states without naming courses, filled by the elective slots.
  { key: 'electives', match: /^unmet-.*-filled-by-electives$/, tier: 'later', text: null, rank: 150 },
  // The degree is short: the plan's own summary row, UGA's credit total, and each requirement not met.
  { key: 'degree', match: /^(?:degree-incomplete|uga-total)$|^unmet-|^uga-area-|^uga-pool-/, tier: 'now', text: 'Plan does not finish the degree yet', rank: 10, record: true },
  { key: 'dd-credits', match: /^double-dawgs-.*-credits$/, tier: 'now', text: null, rank: 12, record: true },
  { key: 'left-out', match: /^notplaced-/, tier: 'now', text: 'Required courses left out', rank: 11, record: true },
  { key: 'prereq-order', match: /^ap-prereq-order-/, tier: 'now', text: 'Prerequisite later in the plan', rank: 20 },
  // The catalog's wording could not be settled ("all of those or one of them?"), or only the student knows (high school work).
  { key: 'prereq-check', match: /^ap-prereq-check-/, tier: 'later', text: 'Prerequisite to confirm', rank: 110 },
  { key: 'prior-learning', match: /^ap-priorlearning-/, tier: 'later', text: 'Prerequisite only you can confirm', rank: 111 },
  { key: 'prereq-text', match: /^ap-prereq-text-|^ap-prereqs-unloaded$/, tier: 'later', text: null, rank: 152 },
  { key: 'prereq', match: /^ap-prereq-/, tier: 'now', text: 'Prerequisite missing', rank: 21, record: true },
  { key: 'standing', match: /^ap-standing-/, tier: 'now', text: 'Class standing not reached', rank: 22, record: true },
  { key: 'clash', match: /^weekly-clash-/, tier: 'now', text: 'Class times clash', rank: 30 },
  { key: 'offering', match: /^ap-offering-/, tier: 'now', text: 'Course not offered that term', rank: 31 },
  { key: 'snapshot', match: /^ap-snapshot-/, tier: 'now', text: 'No sections that term', rank: 32 },
  { key: 'load', match: /^ap-load-/, tier: 'now', text: 'Term over the credit limit', rank: 33 },
  { key: 'duplicate', match: /^ap-duplicate-/, tier: 'now', text: 'Course appears twice', rank: 40 },
  { key: 'exclusion', match: /^ap-exclusion-/, tier: 'now', text: 'Two courses that do not both count', rank: 41 },
  // Placed late because the plan does not know the student already took them.
  { key: 'comp1', match: /^ap-comp1-late-/, tier: 'now', text: 'Composition I after the first year', rank: 42, record: true },
  { key: 'seminar', match: /^ap-seminar-late-/, tier: 'now', text: 'First-term course after the first year', rank: 43, record: true },
  { key: 'language', match: /^ap-language-gap-/, tier: 'now', text: 'No language course after 60 hours', rank: 44, record: true },
  // UGA's university-wide and college rules no requirement row holds (uga-university-rules.ts ugaUniversityIssues): classes the record lacks may meet them.
  { key: 'uga-upper-division', match: /^uga-rule-upper-division$/, tier: (i) => (i.severity === 'info' ? 'later' : 'now'), text: null, rank: 13, record: true },
  { key: 'uga-residence', match: /^uga-rule-residence$/, tier: 'now', text: null, rank: 14, record: true },
  { key: 'uga-pe', match: /^uga-rule-pe$/, tier: 'now', text: null, rank: 15, record: true },
  { key: 'uga-franklin', match: /^uga-rule-franklin-departments$/, tier: 'now', text: null, rank: 16, record: true },
  { key: 'residency', match: /^residency$/, tier: 'now', text: null, rank: 45 },
  // A route the student cannot take, or none, makes the degree itself unreachable; an application with a route is information.
  { key: 'admission', match: /^admission-route$/, tier: (i) => (/\bclosed\b|no published route/i.test(i.title) ? 'now' : 'later'), text: null, rank: 46 },
  { key: 'in-progress', match: /^uga-pending$/, tier: 'later', text: 'In-progress credit counts once passed', rank: 120 },
  { key: 'forfeit', match: /^ap-forfeit-/, tier: 'later', text: 'Credit that will not count', rank: 121 },
  { key: 'dormant', match: /^ap-dormant-/, tier: 'later', text: 'Course has not run recently', rank: 112 },
  { key: 'closed', match: /^ap-closed-/, tier: 'later', text: 'Registration restricted for now', rank: 113 },
  { key: 'hard', match: /^ap-hard-/, tier: 'later', text: 'Several hard courses together', rank: 114 },
  { key: 'minimum', match: /^ap-minimum-/, tier: 'later', text: 'Term under your credit target', rank: 115 },
];

export interface IssueKind {
  key: string;
  text: string;
  tier: IssueTier;
  rank: number;
  record: boolean;
}

/** The kind a requirement the planner could not fully read gets (KIND_RULES 'unread'). */
const UNREAD_KIND: IssueKind = { key: 'unread', text: 'Requirement to check with your advisor', tier: 'later', rank: 100, record: false };

/** The kind, tier and rank of one issue. */
export function issueKind(issue: IssueLike): IssueKind {
  const rule = KIND_RULES.find((r) => r.match.test(issue.id));
  if (!rule) {
    const tier: IssueTier = issue.severity === 'info' ? 'later' : 'now';
    return { key: `title:${issue.title}`, text: issue.title, tier, rank: tier === 'now' ? 60 : 160, record: false };
  }
  return {
    key: rule.key,
    text: rule.text ?? issue.title,
    tier: typeof rule.tier === 'function' ? rule.tier(issue) : rule.tier,
    rank: rule.rank,
    record: Boolean(rule.record),
  };
}

/** Whether one issue matters now (the plan is wrong or unworkable) rather than being good to know. */
export function issueTier(issue: IssueLike): IssueTier {
  return issueKind(issue).tier;
}

/**
 * "About 45 credits", "I have 60 hours", "30 credit hours": what the student
 * says they hold, or null. A load ("15 credits a semester", "12 hours per
 * term") is how much they want to take, not credit they hold.
 */
export function statedHours(text: string): number | null {
  const pattern = /\b(\d{1,3})\s*(?:\+\s*)?(?:credit hours|credits|hours|hrs|cr)\b(?!\s*(?:a|per|each|every|in a|in each)\s+(?:semester|term|quarter|year)\b|\s*\/\s*(?:semester|term))/gi;
  for (const m of text.matchAll(pattern)) {
    const n = Number(m[1]);
    if (n >= 6 && n <= 150) return n;
  }
  return null;
}

/** Credit the student holds against what the plan can see, for the record prompt. */
export interface CreditGap {
  /** What the student said they hold (statedHours), or null. */
  said: number | null;
  /** Hours the plan counts from the record: classes, exams, transfer hours. */
  recorded: number;
  /** Hours the build assumed for terms the student has been here with nothing on the record (Illinois, about 15 a term). */
  assumed: number;
  /** "Fall 2024, Spring 2025 and Fall 2025": the terms assumed. */
  assumedTerms?: string;
  /**
   * The semester in progress, when the board shows it as its own column
   * ("Fall 2026", current-term.ts), with the hours of `assumed` counted for
   * it until its classes are added and how many classes it holds now.
   */
  currentTerm?: string | null;
  currentAssumed?: number;
  currentClasses?: number;
}

/** A shortfall of more than this many hours between what was said and what is recorded asks for the record. */
const SAID_SLACK = 6;

const RECORD_ASK = 'Add your classes or upload a transcript to get an accurate check.';

/**
 * The semester in progress, when it is the only term the plan assumes credit
 * for: its classes are what the check is missing, and the board's own column
 * for it is where they go.
 */
function currentOnly(gap: CreditGap): string | null {
  const hours = gap.currentAssumed ?? 0;
  return gap.currentTerm && hours > 0 && gap.assumed - hours <= 0 ? gap.currentTerm : null;
}

/**
 * The one plain prompt for credit the plan cannot see, or null. Said hours
 * not on the record ask for it; with nothing said, terms the build assumed
 * credit for ask for their classes.
 *
 * The semester in progress (since 2026-10-22, current-term.ts). A freshman
 * in October, or a sophomore whose transcript was printed before this fall,
 * has a plan that counts the fall under way as about 15 credits until they
 * add the classes they are taking now, and plans every requirement in the
 * terms after it, so some read as missing or left out (more at UGA, whose
 * plans used to book their own classes into that fall). Those classes are the
 * one thing that settles it, so the prompt names that term and its column,
 * ranks first as the record prompt always has, and folds the shortfalls they
 * explain under "Waiting for your record", rather than a list of
 * requirements the student cannot act on yet. Classes from a transcript
 * assume nothing, so they ask nothing here: the column asks once whether
 * they are right.
 */
export function recordPrompt(gap: CreditGap | null | undefined): string | null {
  if (!gap) return null;
  if (gap.said !== null) {
    if (gap.recorded + SAID_SLACK >= gap.said) return null;
    return `You said about ${gap.said} credits; ${gap.recorded > 0 ? `${gap.recorded} are` : 'none are'} recorded. ${RECORD_ASK}`;
  }
  const now = currentOnly(gap);
  if (now) {
    return (gap.currentClasses ?? 0) > 0
      ? `Your ${now} classes are not all added yet. Add the rest in the ${now} column, or say there that those are all, to get an accurate check.`
      : `Your ${now} classes are not added yet. Add them in the ${now} column to get an accurate check.`;
  }
  if (gap.assumed > 0) return `Your classes from ${gap.assumedTerms || 'your earlier terms'} are not recorded yet. ${RECORD_ASK}`;
  return null;
}

/** The record prompt's issue when it stands for the semester in progress (the board bar titles its popover from it). */
export const CURRENT_CLASSES_ID = 'current-classes';

/**
 * The semester in progress shown empty with nothing assumed for it: a
 * student who picked "First year" in setup without saying it in words, or a
 * record that stops a term early. The plan counts nothing for that fall, so
 * what its classes would fill reads as missing. Asked for only when a
 * shortfall like that is on the board (the caller checks): an empty column
 * already invites the classes, and a plan with nothing to settle needs no
 * second ask.
 */
function emptyCurrent(gap: CreditGap | null | undefined): string | null {
  if (!gap || gap.said !== null || gap.assumed > 0 || !gap.currentTerm || (gap.currentClasses ?? 0) > 0) return null;
  return gap.currentTerm;
}

/** Identical rows the list folds into one, with how many. */
export interface TriageRow {
  issue: PlanIssue;
  count: number;
  kind: IssueKind;
  /** A "matters now" row moved under the record prompt, because credit the plan cannot see explains it. */
  folded: boolean;
}

/** One kind of thing that matters now, as the bar shows it. */
export interface AttentionKind {
  key: string;
  /** Plain words, with the count when there is more than one. */
  label: string;
  severity: IssueSeverity;
  /** The issue the bar opens (its title and message explain the kind). */
  issue: PlanIssue;
  rows: TriageRow[];
}

export interface Triage {
  /** The record prompt, when the student holds credit the plan cannot see. */
  prompt: AttentionKind | null;
  /** What the bar shows, at most PROMINENT_LIMIT: the prompt, then the kinds that matter most. */
  prominent: AttentionKind[];
  /** Every kind that matters now and is not folded, ranked (the prompt is not among them). */
  now: AttentionKind[];
  /** "Matters now" rows the record prompt explains. */
  folded: TriageRow[];
  /** Good to know. */
  later: TriageRow[];
  /** Every row not inside a prominent kind: what "Show N more" opens. */
  more: TriageRow[];
  /** Nothing matters now: the bar says "Nothing needs attention". */
  allClear: boolean;
  /** One sentence for the build message. */
  line: string;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

/** The worst severity among the rows. */
function worst(rows: TriageRow[]): IssueSeverity {
  return rows.reduce<IssueSeverity>((w, r) => (SEVERITY_RANK[r.issue.severity] < SEVERITY_RANK[w] ? r.issue.severity : w), 'info');
}

function labelOf(key: string, text: string, rows: TriageRow[]): string {
  const n = rows.reduce((sum, r) => sum + r.count, 0);
  if (key === 'degree') {
    // The summary row and UGA's credit total say the degree is short; the
    // rest each name one requirement, which says more.
    const named = rows.filter((r) => !/^(?:degree-incomplete|uga-total)$/.test(r.issue.id));
    const m = named.reduce((sum, r) => sum + r.count, 0);
    if (m === 1) return `Requirement not met: ${named[0].issue.title}`;
    if (m > 1) return `${m} requirements not met`;
    return text;
  }
  return n > 1 ? `${text} (${n})` : text;
}

/** Group rows into kinds, ranked: lower rank first, then the worse severity, then the order they came in. */
function kindsOf(rows: TriageRow[]): AttentionKind[] {
  const byKey = new Map<string, { rows: TriageRow[]; first: number }>();
  rows.forEach((row, index) => {
    const hit = byKey.get(row.kind.key);
    if (hit) hit.rows.push(row);
    else byKey.set(row.kind.key, { rows: [row], first: index });
  });
  return [...byKey.entries()]
    .map(([key, { rows: members, first }]) => {
      const head = members.find((r) => r.issue.id === 'degree-incomplete') ?? members.find((r) => r.issue.severity === worst(members)) ?? members[0];
      return {
        kind: { key, label: labelOf(key, members[0].kind.text, members), severity: worst(members), issue: head.issue, rows: members },
        rank: members[0].kind.rank,
        first,
      };
    })
    .sort((a, b) => a.rank - b.rank || SEVERITY_RANK[a.kind.severity] - SEVERITY_RANK[b.kind.severity] || a.first - b.first)
    .map((k) => k.kind);
}

/**
 * Every issue on the board, ranked and folded the way the board bar shows it.
 * `credit` says what the student holds against what is recorded; `bot` names
 * the advisor the prompt sends them to.
 */
export function triageIssues(
  issues: readonly PlanIssue[],
  options: { credit?: CreditGap | null; bot?: string } = {},
): Triage {
  // Identical rows are one row with a count (plan-health.tsx groupIssues does the same for the chip).
  const grouped = new Map<string, TriageRow>();
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.title}|${issue.message}`;
    const hit = grouped.get(key);
    if (hit) hit.count += 1;
    else grouped.set(key, { issue, count: 1, kind: issueKind(issue), folded: false });
  }
  const rows = [...grouped.values()];
  explainedByForfeit(rows);
  explainedByUnreadAreas(rows);
  const empty = emptyCurrent(options.credit);
  const settles = rows.some((r) => r.kind.tier === 'now' && r.kind.record);
  const promptText = recordPrompt(options.credit) ?? (empty && settles ? `Your ${empty} classes are not added yet. Add them in the ${empty} column to get an accurate check.` : null);
  const stated = rows.filter((r) => r.kind.key === 'record');
  let prompt: AttentionKind | null = null;
  if (promptText) {
    const now = options.credit && options.credit.said === null ? currentOnly(options.credit) ?? empty : null;
    const counts = (options.credit?.currentAssumed ?? 0) === 0
      ? `counts nothing for ${now} yet`
      : (options.credit?.currentClasses ?? 0) > 0
        ? `counts about ${options.credit?.currentAssumed} more credits for ${now}`
        : `counts ${now} as about ${options.credit?.currentAssumed} credits, a usual full load,`;
    const issue: PlanIssue = stated[0]?.issue ?? (now
      ? {
          id: CURRENT_CLASSES_ID,
          severity: 'warning',
          title: `Your ${now} classes`,
          message: `${now} is under way. Until you add the classes you are taking now, the plan ${counts} and plans every requirement in the terms after it, so some read as missing or left out. Add them in the ${now} column (a screenshot of your class schedule or your transcript works too, through the upload in the side panel), and the plan is rebuilt around them.`,
          termId: '',
        }
      : {
          id: 'stated-hours',
          severity: 'warning',
          title: promptText.replace(` ${RECORD_ASK}`, ''),
          message: `The plan counts only the classes it can see, so requirements those credits fill read as missing. Upload your transcript or academic history (a screenshot works), pick your AP or IB exams, or tell ${options.bot ?? 'the assistant'} what you took, and the plan is rebuilt around it.`,
          termId: '',
        });
    prompt = { key: 'record', label: promptText, severity: 'warning', issue, rows: stated };
    for (const row of rows) if (row.kind.tier === 'now' && row.kind.record) row.folded = true;
  }
  const nowRows = rows.filter((r) => r.kind.tier === 'now' && !r.folded && r.kind.key !== 'record');
  const now = kindsOf(nowRows);
  // A stated-hours row the prompt does not stand for (the prompt is off) is still a thing to act on.
  const stray = prompt ? [] : stated;
  const nowAll = stray.length > 0 ? [...kindsOf(stray), ...now] : now;
  const prominent = [...(prompt ? [prompt] : []), ...nowAll].slice(0, PROMINENT_LIMIT);
  const shown = new Set(prominent.flatMap((k) => k.rows));
  const byRank = (a: TriageRow, b: TriageRow) => a.kind.rank - b.kind.rank;
  const folded = rows.filter((r) => r.folded).sort(byRank);
  const later = rows.filter((r) => r.kind.tier === 'later').sort(byRank);
  const ranked = [...nowAll.flatMap((k) => k.rows), ...folded, ...later];
  const more = ranked.filter((r) => !shown.has(r));
  const allClear = prompt === null && nowAll.length === 0;
  return { prompt, prominent, now: nowAll, folded, later, more, allClear, line: lineOf(prompt, nowAll) };
}

/**
 * "PSYC 235 and STAT 100 do not both count" beside "Credit that will not
 * count: your STAT 100 will not count once PSYC 235 is taken" is one fact
 * said twice: the plan booked the required course and left the held one out
 * of the total on purpose (the workspace's ap-forfeit row). That exclusion is
 * good to know. Two courses that do not both count with no forfeit behind
 * them (a course added beside its twin) still matter now.
 */
function explainedByForfeit(rows: TriageRow[]): void {
  const forfeited = new Set(rows.filter((r) => r.kind.key === 'forfeit').map((r) => normal(r.issue.id.slice('ap-forfeit-'.length))));
  if (forfeited.size === 0) return;
  for (const row of rows) {
    if (row.kind.key !== 'exclusion') continue;
    const pair = row.issue.message.match(/^(.+?) and (.+?) do not both count\b/);
    if (pair && (forfeited.has(normal(pair[1])) || forfeited.has(normal(pair[2])))) {
      row.kind = { ...row.kind, tier: 'later', rank: 122 };
    }
  }
}

/**
 * A UGA area whose requirement the catalog snapshot cannot fully read ("VI.
 * Courses Related to the Major: the snapshot does not identify all required
 * courses") is short on a plan the planner built itself, because the planner
 * cannot name what fills it: Economics AB's first-year board read "13 of 18
 * credits" and "9 of 30 credits" there with nothing a student could fix.
 * While the plan still reaches the degree's credit total (no "Degree credits
 * are short" row), that area's shortfall is for an advisor to check, like the
 * unread requirement itself. So is the board's "does not fulfill the degree
 * yet" row when those areas are all it names and no credits are short. A
 * short area with nothing unread in it, a named list that is short, or a
 * plan under the credit total still matters now.
 */
function explainedByUnreadAreas(rows: TriageRow[]): void {
  if (rows.some((r) => r.issue.id === 'uga-total')) return;
  /*
   * The unread hours of each area, where the row says how many ("(20
   * credit hours unnamed)"): an area short by more than that is short for
   * another reason, and stays on the bar. Health Promotion's Required
   * Courses read 40 of 60 with no emphasis chosen and the bar said
   * "Nothing needs attention" (2026-10-28).
   */
  const unread = new Map<string, number>();
  for (const r of rows) {
    if (!r.issue.id.startsWith('uga-unverified-')) continue;
    const label = r.issue.message.match(/^(.+?): the snapshot does not identify\b/)?.[1]?.trim();
    if (!label) continue;
    const hours = Number(r.issue.message.match(/\((\d+(?:\.\d+)?) credit hours? unnamed\)/)?.[1] ?? Infinity);
    unread.set(label, (unread.get(label) ?? 0) + hours);
  }
  if (unread.size === 0) return;
  let moved = 0;
  for (const row of rows) {
    if (row.kind.key !== 'degree' || !row.issue.id.startsWith('uga-area-')) continue;
    const label = row.issue.id.slice('uga-area-'.length).trim();
    if (!unread.has(label)) continue;
    const count = row.issue.message.match(/:\s*(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) credits/);
    const short = count ? Number(count[2]) - Number(count[1]) : 0;
    if (short > (unread.get(label) ?? Infinity)) continue;
    row.kind = { ...UNREAD_KIND };
    moved += 1;
  }
  if (moved === 0) return;
  const stillShort = rows.some((r) => r.kind.key === 'degree' && r.issue.id !== 'degree-incomplete');
  const summary = rows.find((r) => r.issue.id === 'degree-incomplete');
  if (summary && !stillShort && !/\bThis draft has \d+ of the \d+ credits\b/.test(summary.issue.message)) summary.kind = { ...UNREAD_KIND };
}

function normal(code: string): string {
  return code.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** One plain sentence: the prompt, or how many things matter now and the first few. */
function lineOf(prompt: AttentionKind | null, now: AttentionKind[]): string {
  if (prompt) {
    const also = now.slice(0, PROMINENT_LIMIT - 1).map((k) => k.label);
    return also.length > 0 ? `${prompt.label} Also: ${also.join('; ')}.` : prompt.label;
  }
  if (now.length === 0) return 'Nothing needs attention.';
  const shown = now.slice(0, PROMINENT_LIMIT).map((k) => k.label);
  const rest = now.length - shown.length;
  return `${now.length} ${now.length === 1 ? 'thing needs' : 'things need'} attention: ${shown.join('; ')}${rest > 0 ? `; and ${rest} more` : ''}.`;
}

/**
 * The whole list for ALMA and ARCH (review_board), ranked as the bar ranks it,
 * each row marked with where the bar puts it, so they lead with what matters
 * and can name the rest when asked. At most `limit` rows, then a count.
 */
export function rankedFlags(triage: Triage, limit = 40, chars = 200): string[] {
  const prominent = new Set(triage.prominent.flatMap((k) => k.rows));
  const lines: string[] = [];
  if (triage.prompt) lines.push(`now, on the board: ${triage.prompt.label} ${triage.prompt.issue.message}`.slice(0, chars + 120));
  const rows = [...triage.now.flatMap((k) => k.rows), ...triage.folded, ...triage.later];
  for (const row of rows) {
    const where = row.folded
      ? 'once the record is in'
      : row.kind.tier === 'now'
        ? prominent.has(row) ? 'now, on the board' : 'now, under Show more'
        : 'good to know';
    // Information is read less often: a shorter message keeps the list affordable on every review.
    const width = row.kind.tier === 'now' ? chars : Math.min(chars, 120);
    lines.push(`${where}: ${row.issue.severity}: ${row.issue.title}${row.count > 1 ? ` (x${row.count})` : ''}: ${row.issue.message.slice(0, width)}`);
  }
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `and ${lines.length - limit} more rows of the same kinds`];
}
