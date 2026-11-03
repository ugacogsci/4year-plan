/**
 * "This plan can't finish with your settings": one plain item for the top of
 * the board bar, the fixes worth trying, and how the tried ones are ranked.
 *
 * Why it exists (owner, 2026-11-03): "if a plan cant be fullfilled with the
 * settings/preferneces a students chosen it needs to say that. the stduent
 * should be able to adjust from there as well as the ai". UGA Accounting +
 * International Business (35784) for a freshman needs more classes than seven
 * terms hold at 18 credits, so MATH 2200 was left off, and the board said
 * only "Plan does not finish the degree yet" without naming the class or the
 * setting that kept it off. Illinois said "N courses left out" and never
 * which setting caused it or how to change it.
 *
 * One file for the workspace (both schools), the UGA harness and the Illinois
 * sweep, so the three say the same thing about the same board:
 *
 *   - finishStateOf reads a board's facts (the engine's classes not placed,
 *     the requirement rows still short, the hours short, the room left);
 *   - cannotFinish decides whether the settings are the limit and words it;
 *   - fixCandidates lists the setting changes worth building, smallest first;
 *   - rankFixes keeps the ones that make the plan finish, or the closest.
 *
 * Nothing here builds a board: the caller builds each candidate through its
 * own Rebuild path and hands back the rebuilt board's finish state.
 */
import type { PlanIssue, SemesterSeason } from './types';
import { triageIssues } from './warnings-triage';

/** The engine's reasons (autoplan.ts NotPlaced) that mean room or time: the settings are the limit. */
export const ROOM_REASONS = ['no-room', 'chain-too-long', 'offering-conflict', 'standing-unmet'] as const;
const ROOM = new Set<string>(ROOM_REASONS);

export interface TermName {
  season: SemesterSeason;
  year: number;
}

/** A term away as the plan shape keeps it (saved-board.ts AwayTerm): what it is and what it earns stay with it. */
export type AwayName = TermName & { kind?: string; credits?: number };

export interface LeftOutClass {
  code: string;
  title: string;
  reason: string;
}

/** What a board says about finishing, read the same way for the board on screen and for a candidate. */
export interface FinishState {
  /** Classes the engine could not place for lack of room or time (ROOM_REASONS). */
  stuck: LeftOutClass[];
  /** Requirements still short that matter now (not one the planner could not read), plain labels. */
  shortRows: string[];
  /** Hours short of the degree's total (0 when it reaches it). */
  shortHours: number;
  /** Hours still free in the plan's falls and springs up to the cap, counting only terms with room for a class. */
  roomLeft: number;
}

/** The student's settings that bound the plan. */
export interface PlanSettingsFacts {
  school: 'uga' | 'illinois';
  /** The last term the plan may use: the student's graduation date. */
  finish: TermName;
  /** The first term the plan books. */
  start: TermName;
  /** The most a fall or spring may hold: 18 at UGA, the college's cap at Illinois. */
  cap: number;
  /** The student's own credits a semester, when they set one (null is an even share up to the cap). */
  target: number | null;
  /** Summers on the board with classes, or asked for in the plan's shape. */
  summers: number[];
  /** Summers the student took off the board (never offered back as a fix). */
  droppedSummers?: number[];
  /** Fall or spring terms away. */
  away: AwayName[];
  /** True when the plan starts later than the first term the student could start. */
  lateStart?: boolean;
}

/** Why the item stays off even when the board is short. */
export interface Quiet {
  /**
   * The record prompt that explains the shortfall: 'said' (hours the student
   * named are not on the record), 'earlier' (earlier terms not recorded),
   * 'current-empty' (the semester in progress counts nothing yet). The
   * current-semester prompt that counts the term as a usual full load
   * ('current-assumed') does not explain a lack of room, so it does not
   * silence the item.
   */
  record?: 'none' | 'said' | 'earlier' | 'current-empty' | 'current-assumed';
  /** A Double Dawgs rebuild is pending: nothing on the board is final. */
  doubleDawgsPending?: boolean;
}

export interface CannotFinish {
  /** The one bar item, in plain words. */
  text: string;
  /** The setting part alone ("by Spring 2030 with up to 18 credits a semester and no summer classes"). */
  settings: string;
  /** Which settings are the limit, in the order the sentence names them. */
  limits: Array<'finish' | 'load' | 'summer' | 'away' | 'start'>;
  /** The classes that do not fit (all of them; the text names a few). */
  classes: LeftOutClass[];
  /** Requirements short with no class to name (the text names them when no class is). */
  rows: string[];
  shortHours: number;
}

const ORD = (t: TermName) => t.year * 3 + (t.season === 'Spring' ? 0 : t.season === 'Summer' ? 1 : 2);
export const termLabel = (t: TermName): string => `${t.season} ${t.year}`;

/** "Analytic Geometry and Calculus" stays; a long title is cut at a colon or a dash. */
function plainTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  const cut = t.split(/\s*[:–—]\s*|\s+-\s+/)[0] ?? t;
  return cut.length > 48 ? `${cut.slice(0, 45).trimEnd()}...` : cut;
}

/** "A, B and C". */
export function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "MATH 2200 (Analytic Geometry and Calculus)", a few of them, then "and 3 more". */
export function classesPhrase(classes: LeftOutClass[], show = 3): string {
  const named = classes.slice(0, show).map((c) => (c.title ? `${c.code} (${plainTitle(c.title)})` : c.code));
  const rest = classes.length - named.length;
  return rest > 0 ? `${named.join(', ')} and ${rest} more` : andList(named);
}

/**
 * The finish state of one board. `rows` are the requirement rows that matter
 * now (the caller reads them off its own issue list, after the planner's own
 * "could not read" folding); `terms` are the board's falls and springs that
 * the plan books (not the current semester, not a term away), with their hours.
 */
export function finishStateOf(input: {
  notPlaced: ReadonlyArray<{ code: string; title?: string; reason: string }>;
  rows: string[];
  totalHours: number;
  degreeTotal: number | null;
  terms: ReadonlyArray<{ season: SemesterSeason; credits: number }>;
  cap: number;
}): FinishState {
  const seen = new Set<string>();
  const stuck: LeftOutClass[] = [];
  for (const n of input.notPlaced) {
    if (!ROOM.has(n.reason) || seen.has(n.code)) continue;
    seen.add(n.code);
    stuck.push({ code: n.code, title: n.title ?? '', reason: n.reason });
  }
  const roomLeft = input.terms
    .filter((t) => t.season !== 'Summer')
    .reduce((sum, t) => sum + (input.cap - t.credits >= 3 ? input.cap - t.credits : 0), 0);
  return {
    stuck,
    shortRows: [...new Set(input.rows)],
    shortHours: input.degreeTotal ? Math.max(0, input.degreeTotal - input.totalHours) : 0,
    roomLeft,
  };
}

/**
 * The requirement rows a UGA board leaves short that matter now, by name: the
 * board's own issue list (the audit's rows and the completion row) read as
 * the bar reads it, a requirement the planner could not read set aside, the
 * record prompt not applied (it folds rows; it does not meet them).
 */
export function ugaRowsShort(issues: readonly PlanIssue[]): string[] {
  const t = triageIssues(issues);
  return t.now
    .filter((k) => k.key === 'degree')
    .flatMap((k) => k.rows)
    .filter((r) => !/^(?:degree-incomplete|uga-total)$/.test(r.issue.id))
    .map((r) => r.issue.title);
}

/**
 * The requirement rows an Illinois build leaves short for lack of room: the
 * engine's unsatisfied rows whose reason is that the courses did not fit or
 * the hours fell short. Rows the catalog could not be read for, rows the
 * elective slots fill, and rows a rule excludes are not about room.
 */
export function illinoisRowsShort(
  unsatisfied: ReadonlyArray<{ requirementId?: string; label: string; reason: string }>,
  notPlaced: ReadonlyArray<{ reason: string; requirementId?: string | null }> = [],
): string[] {
  // A row short only because its class waits on a prerequisite the catalog cannot settle is not about room.
  const prereq = new Set(notPlaced.filter((n) => n.reason === 'prereq-unmet' && n.requirementId).map((n) => n.requirementId as string));
  const roomy = new Set(notPlaced.filter((n) => ROOM.has(n.reason) && n.requirementId).map((n) => n.requirementId as string));
  return unsatisfied
    .filter((u) => (u.reason === 'did-not-fit' || u.reason === 'hours-short') && !(u.requirementId && prereq.has(u.requirementId) && !roomy.has(u.requirementId)))
    .map((u) => u.label);
}

/** A requirement short with no room for it is a room problem; with room left, it is something else (data, a rule). */
function roomBound(state: FinishState): boolean {
  if (state.shortRows.length === 0 && state.shortHours === 0) return false;
  return state.roomLeft < Math.max(3, state.shortHours);
}

/** True when the board finishes as far as room and time go: nothing left off for room, nothing short for room. */
export function finishes(state: FinishState): boolean {
  return state.stuck.length === 0 && state.shortRows.length === 0 && state.shortHours === 0;
}

/** The setting part of the sentence and which limits it names. */
export function settingsPhrase(s: PlanSettingsFacts): { text: string; limits: CannotFinish['limits'] } {
  const limits: CannotFinish['limits'] = ['finish'];
  const parts: string[] = [];
  if (s.lateStart) {
    limits.push('start');
    parts.push(`a ${termLabel(s.start)} start`);
  }
  limits.push('load');
  parts.push(s.target !== null && s.target < s.cap ? `about ${s.target} credits a semester` : `up to ${s.cap} credits a semester`);
  if (s.summers.length === 0) {
    limits.push('summer');
    parts.push('no summer classes');
  }
  if (s.away.length > 0) {
    limits.push('away');
    parts.push(`${andList(s.away.map(termLabel))} away`);
  }
  return { text: `by ${termLabel(s.finish)} with ${andList(parts)}`, limits };
}

/**
 * The item, or null when the settings are not the limit: nothing left off
 * for room or time and nothing short for lack of room, or the record prompt,
 * a pending Double Dawgs rebuild, or the planner's own unread requirement
 * explains it.
 */
export function cannotFinish(state: FinishState, settings: PlanSettingsFacts, quiet: Quiet = {}): CannotFinish | null {
  if (quiet.doubleDawgsPending) return null;
  if (quiet.record === 'said' || quiet.record === 'earlier' || quiet.record === 'current-empty') return null;
  if (state.stuck.length === 0 && !roomBound(state)) return null;
  const { text: phrase, limits } = settingsPhrase(settings);
  const head = `This plan can't finish ${phrase}.`;
  let tail: string;
  if (state.stuck.length > 0) {
    tail = `${classesPhrase(state.stuck)} ${state.stuck.length === 1 ? "doesn't" : "don't"} fit.`;
  } else if (state.shortRows.length > 0) {
    const rows = state.shortRows.slice(0, 2);
    const rest = state.shortRows.length - rows.length;
    tail = `${andList(rows)}${rest > 0 ? ` and ${rest} more` : ''} ${state.shortRows.length === 1 ? 'is' : 'are'} still short.`;
  } else {
    tail = `It ends ${state.shortHours} credits short of the degree.`;
  }
  return { text: `${head} ${tail}`, settings: phrase, limits, classes: state.stuck, rows: state.shortRows, shortHours: state.shortHours };
}

/** One change of settings worth building. */
export interface FixCandidate {
  id: string;
  /** The button's words: "Add Summer 2027", "Finish in Fall 2030 instead", "Take up to 15 credits a semester", "Drop the Spring 2029 term away". */
  label: string;
  /** Smaller is a smaller change for the student. */
  size: number;
  change: {
    /** The summers the plan should have (the ones it has plus the new ones). */
    summers?: number[];
    finish?: TermName;
    target?: number;
    /** The terms away the plan should keep. */
    away?: AwayName[];
  };
}

/** The next fall or spring after a term. */
export function nextRegular(t: TermName): TermName {
  return t.season === 'Fall' ? { season: 'Spring', year: t.year + 1 } : { season: 'Fall', year: t.year };
}

/** Summers inside the plan: after the first term, no later than the finish. */
export function summersInside(s: PlanSettingsFacts): number[] {
  const out: number[] = [];
  for (let y = s.start.year; y <= s.finish.year; y++) {
    const at = ORD({ season: 'Summer', year: y });
    if (at > ORD(s.start) && at < ORD(s.finish)) out.push(y);
  }
  return out;
}

/**
 * The changes worth trying, smallest first: a heavier load (only when the
 * student's own number is under the cap, and never over it), dropping a term
 * away, one summer (the first two the plan has room for, then both), and a
 * finish one term later. At most `limit`.
 */
export function fixCandidates(s: PlanSettingsFacts, limit = 6): FixCandidate[] {
  const out: FixCandidate[] = [];
  if (s.target !== null && s.target < s.cap) {
    const step = s.target < 15 && s.cap > 15 ? 15 : s.cap;
    out.push({ id: `load-${step}`, label: `Take up to ${step} credits a semester`, size: 1, change: { target: step } });
    if (step < s.cap) out.push({ id: `load-${s.cap}`, label: `Take up to ${s.cap} credits a semester`, size: 2.5, change: { target: s.cap } });
  }
  for (const a of s.away) {
    out.push({ id: `away-${termLabel(a)}`, label: `Drop the ${termLabel(a)} term away`, size: 1.5, change: { away: s.away.filter((b) => ORD(b) !== ORD(a)) } });
  }
  const dropped = new Set(s.droppedSummers ?? []);
  const open = summersInside(s).filter((y) => !s.summers.includes(y) && !dropped.has(y));
  open.slice(0, 2).forEach((y, i) => out.push({ id: `summer-${y}`, label: `Add Summer ${y}`, size: 2 + i * 0.1, change: { summers: [...s.summers, y].sort((a, b) => a - b) } }));
  const later = nextRegular(s.finish);
  out.push({ id: `finish-${termLabel(later)}`, label: `Finish in ${termLabel(later)} instead`, size: 3, change: { finish: later } });
  if (open.length >= 2) out.push({ id: `summers-${open[0]}-${open[1]}`, label: `Add Summer ${open[0]} and Summer ${open[1]}`, size: 3.5, change: { summers: [...s.summers, open[0], open[1]].sort((a, b) => a - b) } });
  return out.sort((a, b) => a.size - b.size).slice(0, limit);
}

/** A candidate once built: whether the plan then finishes, and how many classes still do not fit. */
export interface TriedFix {
  candidate: FixCandidate;
  fully: boolean;
  /** Classes still left off for room or time (or requirement rows still short when no class is named). */
  left: number;
  /** Milliseconds the build took. */
  ms?: number;
}

/** What one built candidate amounts to. */
export function tried(candidate: FixCandidate, state: FinishState, ms?: number): TriedFix {
  const left = state.stuck.length > 0 ? state.stuck.length : state.shortRows.length + (state.shortHours > 0 && state.shortRows.length === 0 ? 1 : 0);
  return { candidate, fully: finishes(state), left, ...(ms !== undefined ? { ms } : {}) };
}

/**
 * What the bar offers: every candidate that makes the plan finish (at most
 * `show`), smallest change first; with none, the one that leaves the fewest
 * classes off, if it leaves fewer than the board does now.
 */
export function rankFixes(all: TriedFix[], now: number, show = 3): { working: TriedFix[]; closest: TriedFix | null } {
  const working = all.filter((t) => t.fully).sort((a, b) => a.candidate.size - b.candidate.size).slice(0, show);
  if (working.length > 0) return { working, closest: null };
  const better = all.filter((t) => t.left < now).sort((a, b) => a.left - b.left || a.candidate.size - b.candidate.size);
  return { working: [], closest: better[0] ?? null };
}

/** The button's words with what it does: "Add Summer 2027: everything fits", "Finish in Fall 2030 instead: gets closer, 1 class still doesn't fit". */
export function fixButtonText(t: TriedFix): string {
  if (t.fully) return `${t.candidate.label}: everything fits`;
  return `${t.candidate.label}: gets closer, ${t.left} ${t.left === 1 ? "class still doesn't" : "classes still don't"} fit`;
}

/** The question the "Ask ARCH" / "Ask ALMA" button puts in the chat. */
export function askQuestion(item: CannotFinish): string {
  return `My plan can't finish ${item.settings}. What should I change so it finishes?`;
}

/** The facts ARCH and ALMA get (review_board cannot_finish, the board description). */
export function forAdvisor(item: CannotFinish, fixes: { working: TriedFix[]; closest: TriedFix | null } | null, settings: PlanSettingsFacts) {
  return {
    says: item.text,
    classes_that_do_not_fit: item.classes.map((c) => `${c.code}${c.title ? ` ${c.title}` : ''} (${c.reason})`),
    requirements_short: item.rows,
    hours_short: item.shortHours,
    limiting_settings: {
      finish: termLabel(settings.finish),
      credits_a_semester: settings.target !== null && settings.target < settings.cap ? `the student's own ${settings.target}` : `the cap, ${settings.cap}`,
      summers: settings.summers.length > 0 ? settings.summers.map((y) => `Summer ${y}`) : 'none',
      away: settings.away.map(termLabel),
      ...(settings.lateStart ? { start: termLabel(settings.start) } : {}),
    },
    tested_fixes: fixes === null
      ? 'not tested yet'
      : [...fixes.working, ...(fixes.closest ? [fixes.closest] : [])].map((t) => ({
          fix: t.candidate.label,
          set_plan_shape: shapeInputOf(t.candidate),
          result: t.fully ? 'the plan finishes' : `gets closer: ${t.left} still ${t.left === 1 ? "doesn't" : "don't"} fit`,
        })),
  };
}

/** The set_plan_shape input that applies a candidate (the button and the advisor use the same one). */
export function shapeInputOf(c: FixCandidate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.change.summers) out.summers = c.change.summers;
  if (c.change.finish) out.finish = termLabel(c.change.finish);
  if (c.change.target !== undefined) out.target_credits = c.change.target;
  if (c.change.away) out.away = c.change.away.map((a) => (a.kind || a.credits !== undefined ? { term: termLabel(a), ...(a.kind ? { kind: a.kind } : {}), ...(a.credits !== undefined ? { credits: a.credits } : {}) } : termLabel(a)));
  return out;
}
