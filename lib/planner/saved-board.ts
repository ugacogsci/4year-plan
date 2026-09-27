/**
 * The board this device remembers, and how it comes back.
 *
 * A board is more than its terms. Which card is an elective slot, which one
 * fills a list, which gen-ed pick can be swapped, which course is booked for
 * the student's career track, and which terms the review compares the board
 * with all live in the generation report, and the report used to be thrown
 * away on reload. Emma's pre-med board came back with MCB 150 reading
 * "added" instead of "for Pre-medicine", her gen-ed swap chips gone and the
 * elective chooser unreachable, while ALMA's history went on describing the
 * board she had before. So the whole board is saved, report and all, after
 * every change, and restored exactly: the same cards with the same roles and
 * chips, the same priorities, plan shape and career words, and the re-pick
 * signature that makes a second Re-pick for the same priorities a no-op.
 *
 * Nothing here leaves the device. The functions take the storage they write
 * to, so __saved-board.check.mjs can run them against a map in Node and the
 * browser hands them window.localStorage.
 */
import type { OnboardingAnswers } from './onboarding';
import type { AwayTerm, GeneratedPlan, LanguagePlan, NotPlaced, PoolReport, UnsatisfiedRequirement } from './autoplan';
import { normalizePriorities, type Priorities } from './priorities';
import { isPlanState } from './rules';
import type { PlanState, SemesterSeason } from './types';

/**
 * v4, beside the old key rather than over it. A v3 entry held the terms and
 * the settings but no report, and it was written only when the student
 * pressed "Save on this device"; it is still read, once, and moved here.
 */
export const BOARD_KEY = 'fourYear.board.v4';
export const LEGACY_BOARD_KEY = 'four-year-planner-v3';
/**
 * ALMA's conversation, per degree (components/planner/advisor.tsx). Named
 * here because it is forgotten with the board: a chat that says "I added
 * HIST 200 to your Fall 2027" beside a board without it is the bug this
 * module exists to prevent.
 */
export const CHAT_KEY = 'fourYear.advisor.v1';

/**
 * What the last generation said, kept so every panel can be recounted.
 *
 * The pool panel and the review list used to be written once, when the plan was
 * built, and never again. The student then moved a course and both went on
 * printing numbers about a board that no longer existed. This holds only the
 * parts a board edit cannot change: which pools the degree has, what each one
 * asked for, and which requirements the scheduler could not fill at all.
 * Everything countable is counted again from the terms on screen.
 */
export interface PlanReport {
  pools: PoolReport[];
  unsatisfied: UnsatisfiedRequirement[];
  notPlaced: NotPlaced[];
  /** Held credit a required course displaced. Out of the headline, and in the review list. */
  forfeited: Array<{ held: string; for: string }>;
  /**
   * Courses the plan chose to reach the degree total, each with its reason,
   * and the career track it was booked for when there is one.
   */
  electives: Array<{ code: string; why: string; track?: string }>;
  firstTermId: string;
  /** The language sequence the plan booked, or null. */
  language: LanguagePlan | null;
  /** The college admission route the plan front-loads, or null. */
  admission: GeneratedPlan['admission'];
  /** Requirements the generation found already met by held credit. */
  satisfiedByPriorCredit: GeneratedPlan['satisfiedByPriorCredit'];
  /** The residency rule against the plan, or null. */
  residency: GeneratedPlan['residency'] | null;
  /** Which requirement each booked course was chosen for; null for a prerequisite or an elective. */
  bookedFor: Record<string, string | null>;
  /** Courses the catalog requires first that the degree page does not list, and what needs them. */
  addedPrerequisites: Array<{ code: string; requiredBy: string }>;
  /** The planner's picks for general education categories, each with its category. */
  genEdPicks: NonNullable<GeneratedPlan['genEdPicks']>;
  /** Terms away and what each earns. They have no column, so the headline and the validator read them here. */
  away?: NonNullable<GeneratedPlan['away']>;
  /**
   * Each term's codes as the plan was built, by term id. The review compares
   * the board with it: Fall 2026 at 12 hours after the student dragged PSYC
   * 100 out is their edit, while a balanced 13 for a student with 42 AP
   * hours is the plan's, and only the first is a momentum flag.
   */
  builtTerms?: Record<string, string[]>;
  /** The hours a fall or spring the plan was balanced at (GeneratedPlan credits.aim), for the review's light-term cause. */
  aim?: number;
}

/**
 * What the student asked of the plan's shape beyond their credit load: a
 * finish term, terms away (study abroad, a co-op), summers they will take
 * classes in, and whether hard courses should be spread one per term. Set by
 * ALMA's set_plan_shape and applied on every build, so a rebuild keeps it.
 */
export interface PlanShape {
  finish: { season: SemesterSeason; year: number } | null;
  /** Each may say what it is and what it earns; a plain term (older saves) earns nothing. */
  away: AwayTerm[];
  summers: number[];
  spreadHard: boolean;
}

export const NO_SHAPE: PlanShape = { finish: null, away: [], summers: [], spreadHard: false };

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * The report a generation leaves for the board. Only the parts a board edit
 * cannot change are kept. The pool counts and the pool shortfalls are
 * derived from the board, so that moving a course moves the numbers about it.
 */
export function reportOf(generated: GeneratedPlan): PlanReport {
  return {
    pools: generated.pools,
    unsatisfied: generated.unsatisfied,
    notPlaced: generated.notPlaced,
    forfeited: generated.forfeited,
    electives: generated.electives,
    language: generated.language,
    admission: generated.admission,
    satisfiedByPriorCredit: generated.satisfiedByPriorCredit,
    residency: generated.residency ?? null,
    bookedFor: generated.bookedFor ?? {},
    addedPrerequisites: generated.addedPrerequisites,
    genEdPicks: generated.genEdPicks ?? [],
    away: generated.away ?? [],
    firstTermId: generated.plan.terms[0]?.id ?? '',
    builtTerms: Object.fromEntries(generated.terms.map((t) => [t.id, t.codes.map(normCode)])),
    aim: generated.credits.aim,
  };
}

/**
 * The board and everything its cards are read through. It is also what one
 * undo puts back: undoing an elective swap used to restore the terms and keep
 * the swapped report, so HIST 100 came back to its slot reading "added".
 */
export interface BoardState {
  plan: PlanState;
  /** Null for a board with no generation behind it (a v3 save, a file): its cards read as today, unmarked. */
  report: PlanReport | null;
  /** The plan's own notes from its build, for "What is estimated?". */
  notes: string[];
  /** Course ids the student or ALMA put on the board since it was built; cardRole reads them as "added". */
  studentAdded: string[];
  /** repickSignature of the priorities and words the board was last built or re-picked for, or null. */
  repickedFor: string | null;
  /**
   * Whether anyone changed the board by hand since it was built. A change in
   * credit rebuilds an untouched board on its own and only asks about an
   * edited one, so a restored board has to remember which it is.
   */
  edited: boolean;
}

/** The student's settings the build and the re-pick read. */
export interface PlanSettings {
  minimumTermCredits: number;
  /** Null means balanced: an even share of what is left. */
  targetTermCredits: number | null;
  careerInterests: string;
  /** True when the student dropped their goal through ALMA. */
  careerCleared: boolean;
  priorities: Priorities;
  planShape: PlanShape;
}

export interface SavedBoard {
  schemaVersion: 4;
  schoolId: string;
  programId: string | null;
  /** ISO time of the write, for a reader of the raw entry. Nothing depends on it. */
  savedAt: string;
  board: BoardState;
  settings: PlanSettings;
}

/** window.localStorage, or a stand-in for it. */
export interface BoardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Reading an entry back
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * A report as it was written, or null when it is not one. Only the fields
 * the board reads through are required; a field a later build adds that an
 * older entry lacks keeps its default rather than costing the student the
 * whole report.
 */
export function readReport(value: unknown): PlanReport | null {
  if (!isObject(value)) return null;
  const v = value;
  const arrays = ['pools', 'unsatisfied', 'notPlaced', 'forfeited', 'electives', 'satisfiedByPriorCredit', 'addedPrerequisites', 'genEdPicks'] as const;
  for (const key of arrays) if (v[key] !== undefined && !Array.isArray(v[key])) return null;
  if (!Array.isArray(v.pools) || !Array.isArray(v.electives)) return null;
  if (v.bookedFor !== undefined && !isObject(v.bookedFor)) return null;
  if (v.builtTerms !== undefined && !isObject(v.builtTerms)) return null;
  return {
    ...(v as unknown as PlanReport),
    unsatisfied: (v.unsatisfied as PlanReport['unsatisfied']) ?? [],
    notPlaced: (v.notPlaced as PlanReport['notPlaced']) ?? [],
    forfeited: (v.forfeited as PlanReport['forfeited']) ?? [],
    firstTermId: typeof v.firstTermId === 'string' ? v.firstTermId : '',
    language: isObject(v.language) ? (v.language as unknown as LanguagePlan) : null,
    admission: isObject(v.admission) ? (v.admission as unknown as PlanReport['admission']) : null,
    satisfiedByPriorCredit: (v.satisfiedByPriorCredit as PlanReport['satisfiedByPriorCredit']) ?? [],
    residency: isObject(v.residency) ? (v.residency as unknown as PlanReport['residency']) : null,
    bookedFor: (v.bookedFor as PlanReport['bookedFor']) ?? {},
    addedPrerequisites: (v.addedPrerequisites as PlanReport['addedPrerequisites']) ?? [],
    genEdPicks: (v.genEdPicks as PlanReport['genEdPicks']) ?? [],
  };
}

const SEASONS: SemesterSeason[] = ['Spring', 'Summer', 'Fall'];
const isTerm = (v: unknown): v is { season: SemesterSeason; year: number } =>
  isObject(v) && SEASONS.includes(v.season as SemesterSeason) && Number.isInteger(v.year);

/** A plan shape as written, with anything unreadable left at its default. */
export function readShape(value: unknown): PlanShape {
  if (!isObject(value)) return NO_SHAPE;
  return {
    finish: isTerm(value.finish) ? { season: value.finish.season, year: value.finish.year } : null,
    away: Array.isArray(value.away) ? (value.away.filter(isTerm) as AwayTerm[]) : [],
    summers: Array.isArray(value.summers) ? value.summers.filter((y): y is number => Number.isInteger(y)) : [],
    spreadHard: value.spreadHard === true,
  };
}

/**
 * The settings as written. The numbers come back as the student left them
 * (the rail takes a minimum from 3 to 21); only a value that is not a number
 * at all, a field typed half-way, falls back to the default.
 */
function readSettings(v: Record<string, unknown>): PlanSettings {
  const min = v.minimumTermCredits;
  const target = v.targetTermCredits;
  return {
    minimumTermCredits: typeof min === 'number' && Number.isFinite(min) && min >= 0 ? min : 12,
    targetTermCredits: typeof target === 'number' && Number.isFinite(target) && target > 0 ? target : null,
    careerInterests: typeof v.careerInterests === 'string' ? v.careerInterests : '',
    careerCleared: v.careerCleared === true,
    priorities: normalizePriorities(v.priorities),
    planShape: readShape(v.planShape),
  };
}

/** A v4 entry for this school, or null. */
export function parseSavedBoard(raw: string | null, schoolId: string): SavedBoard | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.schemaVersion !== 4 || parsed.schoolId !== schoolId) return null;
  const board = parsed.board;
  if (!isObject(board) || !isPlanState(board.plan)) return null;
  return {
    schemaVersion: 4,
    schoolId,
    programId: typeof parsed.programId === 'string' ? parsed.programId : null,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    board: {
      plan: board.plan,
      report: readReport(board.report),
      notes: isStrings(board.notes) ? board.notes : [],
      studentAdded: isStrings(board.studentAdded) ? board.studentAdded : [],
      repickedFor: typeof board.repickedFor === 'string' ? board.repickedFor : null,
      edited: board.edited === true,
    },
    settings: readSettings(isObject(parsed.settings) ? parsed.settings : {}),
  };
}

/**
 * A v3 entry, moved to v4. It has no report, so its cards read the way they
 * did before this change: required courses marked, everything else plain.
 * It counts as edited, because a student pressed Save on it and nothing says
 * whether they had changed it first; a credit change then asks before it
 * replaces the board instead of doing so on its own.
 */
export function migrateLegacyBoard(raw: string | null, schoolId: string): SavedBoard | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.schemaVersion !== 3 || !isPlanState(parsed.plan)) return null;
  if ((parsed.schoolId ?? '') !== schoolId) return null;
  return {
    schemaVersion: 4,
    schoolId,
    programId: typeof parsed.programId === 'string' ? parsed.programId : null,
    savedAt: '',
    board: { plan: parsed.plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: true },
    settings: readSettings(parsed),
  };
}

/** The entry as written: plain JSON, every field the board reads. */
export function serializeBoard(saved: SavedBoard): string {
  return JSON.stringify(saved);
}

/** The board saved on this device for this school, from v4 or else from v3. Never throws. */
export function readSavedBoard(storage: BoardStorage | null, schoolId: string): SavedBoard | null {
  if (!storage) return null;
  try {
    return parseSavedBoard(storage.getItem(BOARD_KEY), schoolId) ?? migrateLegacyBoard(storage.getItem(LEGACY_BOARD_KEY), schoolId);
  } catch {
    return null;
  }
}

/**
 * Write the board. False when the browser would not keep it (private
 * browsing, a full quota); the session goes on, the board just is not
 * remembered, and the header says so. A v3 entry is removed on the first
 * write, so an old board cannot come back over a newer one.
 */
export function writeSavedBoard(storage: BoardStorage | null, serialized: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(BOARD_KEY, serialized);
    storage.removeItem(LEGACY_BOARD_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget the board and ALMA's conversation about it, together. Start over,
 * a new setup and a different degree all end the board; the chat goes with
 * it, so it can never describe a board that is gone.
 */
export function forgetBoard(storage: BoardStorage | null): void {
  if (!storage) return;
  for (const key of [BOARD_KEY, LEGACY_BOARD_KEY, CHAT_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing to forget */
    }
  }
}

/**
 * Forget ALMA's conversation alone, for a board built fresh because none was
 * saved: "Continue with my saved plan" on a device that never saved one used
 * to rebuild the board from the About-you answers and reopen a chat about
 * the board before it.
 */
export function forgetChat(storage: BoardStorage | null): void {
  try {
    storage?.removeItem(CHAT_KEY);
  } catch {
    /* nothing to forget */
  }
}

// ---------------------------------------------------------------------------
// Edits to the report that follow a card
// ---------------------------------------------------------------------------

/**
 * An elective slot keeps being a slot after its course is swapped, and a gen-ed
 * pick keeps its category. A course put in for a career track keeps the
 * track: MCB 150 swapped into a slot for a pre-PT student is still "for
 * Pre-physical therapy (DPT)", so the next re-pick for easier classes leaves
 * it where it is.
 */
export function swapInReport(report: PlanReport, oldCode: string, newCode: string, why: string, track?: string): PlanReport {
  const same = (a: string, b: string) => normCode(a) === normCode(b);
  return {
    ...report,
    electives: report.electives.map((e) => (same(e.code, oldCode) ? { code: newCode, why, reasons: [], ...(track ? { track } : {}) } : e)),
    genEdPicks: report.genEdPicks.map((g) => (same(g.code, oldCode) ? { ...g, code: newCode } : g)),
  };
}

/**
 * A re-pick's changes, written into the report the way the board shows
 * them: each swap keeps its slot (and its track), and a course added beside
 * another (a lab beside its lecture) becomes a pick of its own.
 */
export function repickInReport(
  report: PlanReport,
  changes: Array<{ from: string; to: string; why: string; kind: string; track?: string }>,
): PlanReport {
  let next = report;
  for (const c of changes) {
    if (c.from) next = swapInReport(next, c.from, c.to, c.kind === 'track' ? c.why : `Picked for your priorities: ${c.why}`, c.track);
  }
  const added = changes.filter((c) => !c.from);
  if (added.length === 0) return next;
  return { ...next, electives: [...next.electives, ...added.map((c) => ({ code: c.to, why: c.why, reasons: [], ...(c.track ? { track: c.track } : {}) }))] };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** How many steps back Undo reaches. */
export const UNDO_LIMIT = 20;

/**
 * One step back. A student's own edit restores the board alone: undoing a
 * drag must not also undo the priority knob they turned after it. One ALMA
 * turn is one step, however many cards it moved, and it also puts back the
 * settings and the credit that turn changed: "I took CHEM 102 at Parkland"
 * rebuilt the board around the new credit, and undoing the board with the
 * credit still recorded would leave a board built for credit the student has.
 */
export interface UndoEntry {
  before: BoardState;
  /** Set when the step is one ALMA turn. */
  turn?: {
    id: string;
    /** The tool calls that changed the board, which tie the step to the reply they belong to. */
    toolIds: string[];
    /** What they did, a few words each, for the note ALMA reads when the student undoes them. */
    summary: string[];
    /** The settings the turn changed, as they were before it. */
    settings?: Partial<PlanSettings>;
    /** The student's record before the turn, when the turn recorded or dropped credit. */
    transcript?: { value: NonNullable<OnboardingAnswers['transcript']> | null };
  };
}

export function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...stack.slice(-(UNDO_LIMIT - 1)), entry];
}
