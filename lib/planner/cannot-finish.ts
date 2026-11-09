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

/**
 * A term away as the plan shape keeps it (saved-board.ts AwayTerm): what it
 * is and what it earns stay with it. `fromWords` marks one the student wrote
 * in About you: the plan shape cannot take it off (plan-start.ts horizonFor
 * merges the words back in), so it is never offered as a fix to drop.
 */
export type AwayName = TermName & { kind?: string; credits?: number; fromWords?: boolean };

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
  /** The most hours free in any one fall or spring. */
  maxFree?: number;
  /** The heaviest fall or spring, in hours. */
  heaviest?: number;
  /**
   * The whole reading (2026-11-03 check): every class the engine left off for
   * any reason, every requirement not met (folded or not, the planner's
   * unread ones aside) and the classes booked in a term they are not offered.
   * A fix "fits everything" only when all three are empty on the rebuilt
   * board (no new offering problem) and the total is reached.
   */
  leftOff?: LeftOutClass[];
  unmet?: string[];
  offering?: string[];
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
  /** The finish the plan has with no finish of its own set (the usual date), when it differs. */
  defaultFinish?: TermName | null;
}

/** Why the item stays off even when the board is short. */
export interface Quiet {
  /**
   * The record prompt that explains the shortfall: 'said' (hours the student
   * named are not on the record), 'earlier' (earlier terms not recorded),
   * 'current-empty' (the semester in progress counts nothing yet),
   * 'deferred' (prior credit the student said in setup they would add later). The
   * current-semester prompt that counts the term as a usual full load
   * ('current-assumed') does not explain a lack of room, so it does not
   * silence the item.
   */
  record?: 'none' | 'said' | 'earlier' | 'current-empty' | 'current-assumed' | 'deferred';
  /**
   * The student has a transcript on the board. With one, the semester in
   * progress counted as a usual load ('current-assumed') does explain the
   * shortfall: those assumed hours fill no requirement, and 13 of 24
   * sophomores finished once their Fall 2026 classes were in (2026-11-03
   * check). A freshman with nothing on record keeps the item.
   */
  transcript?: boolean;
  /** A Double Dawgs rebuild is pending: nothing on the board is final. */
  doubleDawgsPending?: boolean;
}

/** True when the record prompt explains the shortfall, so the item stays off (the harness and sweep use the same test). */
export function recordExplains(quiet: Quiet): boolean {
  if (quiet.record === 'said' || quiet.record === 'earlier' || quiet.record === 'current-empty' || quiet.record === 'deferred') return true;
  return quiet.record === 'current-assumed' && Boolean(quiet.transcript);
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
  /** The heaviest fall or spring on the board. */
  heaviest?: number;
  /**
   * True when only a requirement is short and the board has room left: a
   * setting may or may not be the cause, so the item says the plan doesn't
   * finish yet without blaming one, until the fixes are tried (settleItem).
   */
  maybe?: boolean;
  /** The finish named in the sentence. */
  finish?: string;
}

/** A board term's calendar name from its label ("Spring 2030"); PlanTerm.year is the year of the plan, not the calendar. */
export function termNameOf(term: { label: string }): TermName | null {
  const m = term.label.match(/\b(Fall|Spring|Summer)\s+(20\d\d)\b/);
  return m ? { season: m[1] as SemesterSeason, year: Number(m[2]) } : null;
}

/**
 * The settings a board shows: its last fall or spring is the finish, its
 * first term the start, its summers with classes (and the ones the plan shape
 * asks for), the terms away and the credits a semester.
 */
export function boardSettings(input: {
  school: 'uga' | 'illinois';
  terms: ReadonlyArray<{ label: string; season: SemesterSeason; courseIds: readonly string[] }>;
  shapeSummers: readonly number[];
  droppedSummers?: readonly number[];
  away: ReadonlyArray<AwayName>;
  target: number | null;
  cap?: number;
  /** The finish with no finish of its own set (horizonFor with shape.finish null). */
  defaultFinish?: TermName | null;
}): PlanSettingsFacts | null {
  const named = input.terms.map((t) => ({ t, n: termNameOf(t) })).filter((x): x is { t: (typeof input.terms)[number]; n: TermName } => x.n !== null);
  const regular = named.filter((x) => x.n.season !== 'Summer');
  const first = named[0];
  const last = regular[regular.length - 1];
  if (!first || !last) return null;
  const summers = [...new Set([...named.filter((x) => x.n.season === 'Summer' && x.t.courseIds.length > 0).map((x) => x.n.year), ...input.shapeSummers])].sort((a, b) => a - b);
  return {
    school: input.school,
    finish: last.n,
    start: first.n,
    cap: input.cap ?? 18,
    target: input.target,
    summers,
    droppedSummers: [...(input.droppedSummers ?? [])],
    away: input.away.map((a) => ({ season: a.season, year: a.year, ...(a.kind ? { kind: a.kind } : {}), ...(a.credits !== undefined ? { credits: a.credits } : {}), ...(a.fromWords ? { fromWords: true } : {}) })),
    ...(input.defaultFinish && ORD(input.defaultFinish) !== ORD(last.n) ? { defaultFinish: { season: input.defaultFinish.season, year: input.defaultFinish.year } } : {}),
  };
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
  notPlaced: ReadonlyArray<{ code: string; title?: string; reason: string; credits?: number | null }>;
  rows: string[];
  totalHours: number;
  degreeTotal: number | null;
  terms: ReadonlyArray<{ season: SemesterSeason; credits: number }>;
  cap: number;
  /** Every requirement not met (the whole reading; see FinishState.unmet). */
  unmet?: readonly string[];
  /** Keys of the classes booked in a term they are not offered (the board's ap-offering issues). */
  offering?: readonly string[];
}): FinishState {
  const regular = input.terms.filter((t) => t.season !== 'Summer');
  const roomLeft = regular.reduce((sum, t) => sum + (input.cap - t.credits >= 3 ? input.cap - t.credits : 0), 0);
  const maxFree = Math.max(0, ...regular.map((t) => input.cap - t.credits));
  const heaviest = Math.max(0, ...regular.map((t) => t.credits));
  const seen = new Set<string>();
  const stuck: LeftOutClass[] = [];
  for (const n of input.notPlaced) {
    if (!ROOM.has(n.reason) || seen.has(n.code)) continue;
    /*
     * "No room" counts even while a fall or spring still has hours free: on
     * 25 Illinois boards (Chemical Engineering + Data Science, Nuclear
     * Engineering, Secondary Education Mathematics) the free hours sat in a
     * term the class could not go in yet, and a summer or a later finish made
     * the plan finish. Where no setting helps (Agricultural and Consumer
     * Economics leaves ACCY 201 off with 6 hours free, summers or not), the
     * fixes say so once tried.
     */
    seen.add(n.code);
    stuck.push({ code: n.code, title: n.title ?? '', reason: n.reason });
  }
  const left: LeftOutClass[] = [];
  const leftSeen = new Set<string>();
  for (const n of input.notPlaced) {
    if (leftSeen.has(n.code)) continue;
    leftSeen.add(n.code);
    left.push({ code: n.code, title: n.title ?? '', reason: n.reason });
  }
  return {
    stuck,
    shortRows: plainRows(input.rows),
    shortHours: input.degreeTotal ? Math.max(0, input.degreeTotal - input.totalHours) : 0,
    roomLeft,
    maxFree,
    heaviest,
    ...(input.unmet ? { leftOff: left, unmet: plainRows(input.unmet), offering: [...new Set(input.offering ?? [])] } : {}),
  };
}

/** Requirement names once each: "VI. Courses Related to the Major: VI. Courses Related to the Major" is the same row as its first half. */
export function plainRows(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const m = r.match(/^(.+?):\s*(.+)$/);
    const name = m && m[1].trim() === m[2].trim() ? m[1].trim() : r.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Every UGA requirement not met on a board's audit (auditUgaBoard areas and pools), for the whole reading. */
export function ugaUnmet(audit: {
  areas: ReadonlyArray<{ area: { label: string }; satisfied: boolean }>;
  pools: ReadonlyArray<{ label: string; hours: number; hoursTarget: number | null; count: number; countTarget: number | null }>;
}): string[] {
  return [
    ...audit.areas.filter((row) => !row.satisfied).map((row) => row.area.label),
    ...audit.pools.filter((p) => (p.hoursTarget !== null && p.hours < p.hoursTarget) || (p.countTarget !== null && p.count < p.countTarget)).map((p) => p.label),
  ];
}

/** Every Illinois requirement the build did not meet for lack of courses or hours (no prerequisite exception), for the whole reading. */
export function illinoisUnmet(unsatisfied: ReadonlyArray<{ label: string; reason: string }>): string[] {
  return unsatisfied.filter((u) => u.reason === 'did-not-fit' || u.reason === 'hours-short').map((u) => u.label.replace(/:\s*(?:select|choose|take|complete)\b.*$/i, '').trim() || u.label);
}

/** The offering problems of an issue list (ap-offering-<term>-<course>), as keys. */
export function offeringKeys(issues: ReadonlyArray<{ id: string }>): string[] {
  return issues.filter((i) => i.id.startsWith('ap-offering-')).map((i) => i.id);
}

/**
 * The requirement rows a UGA board leaves short that matter now, by name: the
 * board's own issue list (the audit's rows and the completion row) read as
 * the bar reads it, a requirement the planner could not read set aside, the
 * record prompt not applied (it folds rows; it does not meet them).
 */
export function ugaRowsShort(issues: readonly PlanIssue[]): string[] {
  const t = triageIssues(issues);
  /*
   * Rows the triage folds under a record prompt count too (2026-11-03
   * check): on 69357 first-premed "VI. Courses Related to the Major" 17/18
   * was folded, so the item never showed, yet two summers finish the plan.
   * When the prompt explains the shortfall, recordExplains silences the item.
   */
  return [...t.now.flatMap((k) => k.rows), ...t.folded]
    .filter((r) => r.kind.key === 'degree')
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
    // "Theatre Electives: Select 6 hours from" reads as "Theatre Electives" to a student.
    .map((u) => u.label.replace(/:\s*(?:select|choose|take|complete)\b.*$/i, '').trim() || u.label);
}

/** A requirement short with no room for it is a room problem; with room left, it is something else (data, a rule). */
function roomBound(state: FinishState): boolean {
  if (state.shortRows.length === 0 && state.shortHours === 0) return false;
  return state.roomLeft < Math.max(3, state.shortHours);
}

/**
 * True when the board finishes. With the whole reading (leftOff, unmet): no
 * class left off for any reason, no requirement short, the total reached,
 * and no class booked in a term it is not offered that `base` did not have
 * (2026-11-03 check: 47 "everything fits" buttons left a requirement short or
 * SE 494 off, and 4 summers booked a class the Bulletin lists for no summer).
 * Without it, as far as room and time go.
 */
export function finishes(state: FinishState, base?: Pick<FinishState, 'offering'> | null): boolean {
  if (state.leftOff && state.unmet) {
    return state.leftOff.length === 0 && state.unmet.length === 0 && state.shortHours === 0 && newOffering(state, base).length === 0;
  }
  return state.stuck.length === 0 && state.shortRows.length === 0 && state.shortHours === 0;
}

/** Offering problems a rebuilt board has that the board on screen does not. */
export function newOffering(state: Pick<FinishState, 'offering'>, base?: Pick<FinishState, 'offering'> | null): string[] {
  const had = new Set(base?.offering ?? []);
  return (state.offering ?? []).filter((k) => !had.has(k));
}

/** How far a board is from finishing, for "gets closer": classes left off first, then requirements, then hours. */
export function gapOf(state: FinishState, base?: Pick<FinishState, 'offering'> | null): number {
  const classes = (state.leftOff ?? state.stuck).length;
  const rows = (state.unmet ?? state.shortRows).length;
  return classes * 1000 + rows * 10 + (state.shortHours > 0 ? 1 : 0) + newOffering(state, base).length;
}

/**
 * The student's own credits a semester are the limit only when the board
 * keeps to them: with 12 asked for, a degree that needs more is still planned
 * up to 18 a semester, and "about 12 credits a semester" would not be true to
 * that board. Without a board reading (no `state`), the number is taken as set.
 */
export function ownLoadBinds(s: PlanSettingsFacts, state?: Pick<FinishState, 'heaviest'> | null): boolean {
  if (s.target === null || s.target >= s.cap) return false;
  return state?.heaviest === undefined || state.heaviest <= s.target + 2;
}

/** The setting part of the sentence and which limits it names. */
export function settingsPhrase(s: PlanSettingsFacts, state?: Pick<FinishState, 'heaviest'> | null): { text: string; limits: CannotFinish['limits'] } {
  const limits: CannotFinish['limits'] = ['finish'];
  const parts: string[] = [];
  if (s.lateStart) {
    limits.push('start');
    parts.push(`a ${termLabel(s.start)} start`);
  }
  limits.push('load');
  parts.push(ownLoadBinds(s, state) ? `about ${s.target} credits a semester` : `up to ${s.cap} credits a semester`);
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
  if (recordExplains(quiet)) return null;
  const roomy = state.stuck.length === 0 && !roomBound(state);
  /*
   * A UGA requirement short with room left on the board may or may not be a
   * settings problem (2026-11-03 check: on 9 such boards a summer or a later
   * finish made the plan finish, on 150 others no setting helps, and nothing
   * on the board tells the two apart). It gets the item in its "doesn't
   * finish yet" form, which blames no setting, until the fixes are tried.
   */
  const maybe = roomy && settings.school === 'uga' && (state.shortRows.length > 0 || state.shortHours > 0);
  if (roomy && !maybe) return null;
  const { text: phrase, limits } = settingsPhrase(settings, state);
  const head = maybe ? `This plan doesn't finish by ${termLabel(settings.finish)} yet:` : `This plan can't finish ${phrase}.`;
  return {
    text: `${head} ${tailOf(state, maybe)}`,
    settings: phrase,
    limits,
    classes: state.stuck,
    rows: state.shortRows,
    shortHours: state.shortHours,
    ...(state.heaviest !== undefined ? { heaviest: state.heaviest } : {}),
    ...(maybe ? { maybe: true } : {}),
    finish: termLabel(settings.finish),
  };
}

/** The part of the sentence that says what does not fit. */
function tailOf(state: Pick<FinishState, 'stuck' | 'shortRows' | 'shortHours'>, lower = false): string {
  if (state.stuck.length > 0) {
    // A long list is often a list to choose from that the planner read as all required (Illinois Engineering Mechanics: 40).
    const many = state.stuck.length >= 8 && state.shortHours === 0 ? ' Some may be choices from a list.' : '';
    return `${classesPhrase(state.stuck)} ${state.stuck.length === 1 ? "doesn't" : "don't"} fit.${many}`;
  }
  if (state.shortRows.length > 0) {
    const rows = state.shortRows.slice(0, 2);
    const rest = state.shortRows.length - rows.length;
    const named = `${andList(rows)}${rest > 0 ? ` and ${rest} more` : ''}`;
    return `${named} ${state.shortRows.length === 1 ? 'is' : 'are'} still short.`;
  }
  return `${lower ? 'it' : 'It'} ends ${state.shortHours} credits short of the degree.`;
}

/**
 * The item once its fixes are tried. A "doesn't finish yet" item becomes the
 * settings sentence when a change makes the plan finish, and says that no
 * change to the settings does when none helps; any item whose fixes all fail
 * says so in its longer words (the 2026-11-03 check: "one change below makes
 * room" was said where no change did).
 */
export function settleItem(item: CannotFinish, ranked: { working: TriedFix[]; closest: TriedFix | null } | null): { text: string; settled: 'untested' | 'fixable' | 'closer' | 'none' } {
  if (!ranked) return { text: item.text, settled: 'untested' };
  const settled = ranked.working.length > 0 ? 'fixable' : ranked.closest ? 'closer' : 'none';
  if (!item.maybe) return { text: item.text, settled };
  const tail = tailOf({ stuck: item.classes, shortRows: item.rows, shortHours: item.shortHours });
  if (settled === 'fixable') return { text: `This plan can't finish ${item.settings}. ${tail}`, settled };
  return { text: `This plan doesn't finish by ${item.finish ?? 'your finish'}: ${tail.replace(/\.$/, '')}, and no single change to your settings fixes it.`, settled };
}

/** The item's longer words for the popover, true to what the fixes found. */
export function itemMessage(item: CannotFinish, settled: 'untested' | 'fixable' | 'closer' | 'none', bot: string): string {
  const text = item.text;
  if (settled === 'fixable') return `${text} The planner fits every class it can inside your settings; a change below makes it finish, or ask ${bot}.`;
  if (settled === 'closer') return `${text} No single change to your settings makes everything fit; the one below gets closest. Ask ${bot} what else could work.`;
  if (settled === 'none') return `${text} No single change to the finish, the summers or the credits a semester makes it fit. Ask ${bot} which classes you need and where they could go.`;
  return item.maybe
    ? `${text} There is still room on the board, so your settings may not be the cause. Find a fix tries a summer, a later finish and more credits for you, or ask ${bot}.`
    : `${text} The planner fits every class it can inside your settings. Find a fix tries a summer, a later finish and more credits for you, or ask ${bot}.`;
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
    /** The finish is the usual one: set_plan_shape finish 'default' (the plan shape keeps no finish of its own). */
    finishDefault?: boolean;
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
export function fixCandidates(s: PlanSettingsFacts, limit = 7, state?: Pick<FinishState, 'heaviest'> | null): FixCandidate[] {
  const out: FixCandidate[] = [];
  if (s.target !== null && ownLoadBinds(s, state)) {
    const step = s.target < 15 && s.cap > 15 ? 15 : s.cap;
    out.push({ id: `load-${step}`, label: `Take up to ${step} credits a semester`, size: 1, change: { target: step } });
    if (step < s.cap) out.push({ id: `load-${s.cap}`, label: `Take up to ${s.cap} credits a semester`, size: 2.5, change: { target: s.cap } });
  }
  // A term away the About-you words name cannot be dropped through the plan shape (horizonFor merges the words back in).
  for (const a of s.away.filter((b) => !b.fromWords)) {
    out.push({ id: `away-${termLabel(a)}`, label: `Drop the ${termLabel(a)} term away`, size: 1.5, change: { away: s.away.filter((b) => ORD(b) !== ORD(a)) } });
  }
  const dropped = new Set(s.droppedSummers ?? []);
  const open = summersInside(s).filter((y) => !s.summers.includes(y) && !dropped.has(y));
  open.slice(0, 2).forEach((y, i) => out.push({ id: `summer-${y}`, label: `Add Summer ${y}`, size: 2 + i * 0.1, change: { summers: [...s.summers, y].sort((a, b) => a - b) } }));
  const later = nextRegular(s.finish);
  const usual = s.defaultFinish && ORD(s.defaultFinish) > ORD(s.finish) ? s.defaultFinish : null;
  const laterIsUsual = usual !== null && ORD(usual) === ORD(later);
  out.push({ id: `finish-${termLabel(later)}`, label: `Finish in ${termLabel(later)} instead`, size: 3, change: { finish: later, ...(laterIsUsual ? { finishDefault: true } : {}) } });
  // A student who chose to finish early is offered the usual finish too (2026-11-03 check: 13 of 26 early boards fit everything by it).
  if (usual && !laterIsUsual) out.push({ id: `finish-${termLabel(usual)}`, label: `Finish in ${termLabel(usual)} instead`, size: 3.2, change: { finish: usual, finishDefault: true } });
  if (open.length >= 2) out.push({ id: `summers-${open[0]}-${open[1]}`, label: `Add Summer ${open[0]} and Summer ${open[1]}`, size: 3.5, change: { summers: [...s.summers, open[0], open[1]].sort((a, b) => a - b) } });
  return out.sort((a, b) => a.size - b.size).slice(0, limit);
}

/** A candidate once built: whether the plan then finishes, and what still does not. */
export interface TriedFix {
  candidate: FixCandidate;
  fully: boolean;
  /** Classes still left off (any reason with the whole reading, else for room or time). */
  left: number;
  /** Requirements still short. */
  rowsLeft?: number;
  /** Hours still short of the degree. */
  hoursLeft?: number;
  /** Classes the rebuilt board books in a term they are not offered, that the board on screen did not. */
  offeringAdded?: number;
  /** How far from finishing (gapOf), to rank "gets closer". */
  gap?: number;
  /** Milliseconds the build took. */
  ms?: number;
}

/** What one built candidate amounts to; `base` is the board on screen (for new offering problems). */
export function tried(candidate: FixCandidate, state: FinishState, ms?: number, base?: Pick<FinishState, 'offering'> | null): TriedFix {
  const whole = Boolean(state.leftOff && state.unmet);
  const left = whole ? state.leftOff!.length : state.stuck.length;
  const rowsLeft = whole ? state.unmet!.length : state.shortRows.length;
  const offeringAdded = newOffering(state, base).length;
  return {
    candidate,
    fully: finishes(state, base),
    left,
    rowsLeft,
    hoursLeft: state.shortHours,
    offeringAdded,
    gap: gapOf(state, base),
    ...(ms !== undefined ? { ms } : {}),
  };
}

/**
 * What the bar offers: every candidate that makes the plan finish (at most
 * `show`), smallest change first; with none, the one that leaves the fewest
 * classes off, if it leaves fewer than the board does now.
 */
/**
 * What the bar offers: every candidate that makes the plan finish (at most
 * `show`), smallest change first; with none, the one closest to finishing,
 * if it is closer than the board now (`now` is the board's gapOf).
 */
export function rankFixes(all: TriedFix[], now: number, show = 3): { working: TriedFix[]; closest: TriedFix | null } {
  const working = all.filter((t) => t.fully).sort((a, b) => a.candidate.size - b.candidate.size).slice(0, show);
  if (working.length > 0) return { working, closest: null };
  const g = (t: TriedFix) => t.gap ?? t.left;
  const better = all.filter((t) => g(t) < now).sort((a, b) => g(a) - g(b) || a.candidate.size - b.candidate.size);
  return { working: [], closest: better[0] ?? null };
}

/** What a tried fix still leaves, in plain words: "1 class still doesn't fit", "1 requirement is still short". */
export function stillLeft(t: TriedFix): string {
  if (t.left > 0) return `${t.left} ${t.left === 1 ? "class still doesn't" : "classes still don't"} fit`;
  const rows = t.rowsLeft ?? 0;
  if (rows > 0) return `${rows} ${rows === 1 ? 'requirement is' : 'requirements are'} still short`;
  if ((t.hoursLeft ?? 0) > 0) return `still ${t.hoursLeft} credits short`;
  if ((t.offeringAdded ?? 0) > 0) return `but ${t.offeringAdded === 1 ? 'a class lands' : `${t.offeringAdded} classes land`} in a term ${t.offeringAdded === 1 ? "it isn't" : "they aren't"} offered`;
  return 'not everything fits yet';
}

/** The button's words with what it does: "Add Summer 2027: everything fits", "Finish in Fall 2030 instead: gets closer, 1 class still doesn't fit". */
export function fixButtonText(t: TriedFix): string {
  if (t.fully) return `${t.candidate.label}: everything fits`;
  return `${t.candidate.label}: gets closer, ${stillLeft(t)}`;
}

/** The question the "Ask ARCH" / "Ask ALMA" button puts in the chat. */
export function askQuestion(item: CannotFinish): string {
  if (item.maybe) return `My plan doesn't finish by ${item.finish ?? 'my finish'}: ${andList(item.rows.slice(0, 2))} ${item.rows.length === 1 ? 'is' : 'are'} still short. What should I change so it finishes?`;
  return `My plan can't finish ${item.settings}. What should I change so it finishes?`;
}

/** The facts ARCH and ALMA get (review_board cannot_finish, the board description). */
export function forAdvisor(item: CannotFinish, fixes: { working: TriedFix[]; closest: TriedFix | null } | null, settings: PlanSettingsFacts) {
  const settled = settleItem(item, fixes);
  return {
    says: settled.text,
    ...(item.maybe && settled.settled === 'untested' ? { cause: 'not known yet: there is room left on the board, so a setting may not be the limit until the fixes are tried' } : {}),
    ...(settled.settled === 'none' || settled.settled === 'closer' ? { no_single_fix: 'No single change to the finish, the summers, the credits a semester or a term away makes the plan finish.' } : {}),
    classes_that_do_not_fit: item.classes.map((c) => `${c.code}${c.title ? ` ${c.title}` : ''} (${c.reason})`),
    requirements_short: item.rows,
    hours_short: item.shortHours,
    limiting_settings: {
      finish: termLabel(settings.finish),
      credits_a_semester: ownLoadBinds(settings, { heaviest: item.heaviest }) ? `the student's own ${settings.target}` : `the cap, ${settings.cap}${settings.target !== null && settings.target < settings.cap ? ` (the student asked for about ${settings.target}, and the plan already goes past it to fit the degree)` : ''}`,
      summers: settings.summers.length > 0 ? settings.summers.map((y) => `Summer ${y}`) : 'none',
      away: settings.away.map((a) => (a.fromWords ? `${termLabel(a)} (from the student's About you words: they change it there)` : termLabel(a))),
      ...(settings.lateStart ? { start: termLabel(settings.start) } : {}),
    },
    tested_fixes: fixes === null
      ? 'not tested yet'
      : [...fixes.working, ...(fixes.closest ? [fixes.closest] : [])].map((t) => ({
          fix: t.candidate.label,
          set_plan_shape: shapeInputOf(t.candidate),
          result: t.fully ? 'the plan finishes' : `gets closer: ${stillLeft(t)}`,
        })),
  };
}

/** The set_plan_shape input that applies a candidate (the button and the advisor use the same one). */
export function shapeInputOf(c: FixCandidate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.change.summers) out.summers = c.change.summers;
  if (c.change.finish) out.finish = c.change.finishDefault ? 'default' : termLabel(c.change.finish);
  if (c.change.target !== undefined) out.target_credits = c.change.target;
  if (c.change.away) out.away = c.change.away.map((a) => (a.kind || a.credits !== undefined ? { term: termLabel(a), ...(a.kind ? { kind: a.kind } : {}), ...(a.credits !== undefined ? { credits: a.credits } : {}) } : termLabel(a)));
  return out;
}
