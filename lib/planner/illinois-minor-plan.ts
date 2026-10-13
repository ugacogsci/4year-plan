import type { AutoplanInput, GeneratedPlan } from './autoplan.ts';
import type { CourseChoice, RequirementBlock, RequirementRule } from './illinois-data.ts';
import { MINOR_ID_PREFIX, withoutMinorPageHeading } from './illinois-minors.ts';

/**
 * An Illinois minor planned beside the degree (beta).
 *
 * The engine knows nothing of minors: a minor's requirement rows are rows
 * like any other, and the workspace hands them to generatePlan after the
 * degree's. Three campus rules decide how, and this module holds them so the
 * workspace and the minor sweep (scripts/dev/sweep/minor-pairs.mjs) plan a
 * minor the same way:
 *
 *   1. The degree comes first. A minor never costs the degree a requirement,
 *      never pushes a term past 18 hours (or past the student's own ceiling)
 *      and never moves the finish past the terms the student has. When the
 *      whole minor does not fit, the plan keeps the part that does and says
 *      which rows need a summer or an extra term (planBesideDegree).
 *   2. A course may count for the degree and the minor at once (the Provost's
 *      minor rules; LAS: a course counts for at most two programs). The
 *      engine never reuses a course one list row booked for another list row,
 *      so the courses the degree's own plan already books for a degree
 *      requirement are credited to the minor's rows before the minor is
 *      planned (residualMinor): Statistics' MATH 241 row is met by the
 *      Computer Science plan's MATH 241, and only what is left is planned.
 *   3. At least 6 hours of the minor's 300- and 400-level courses must not
 *      also count for the major (upperLevelApart). The plan cannot always
 *      arrange that, so it is shown as a row, and as a warning when short.
 *
 * Minor courses land in the degree's free-elective room first, because the
 * degree total does not move: the engine fills to the degree's total, and a
 * minor course placed there is one free elective fewer.
 */

const norm = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/** A minor as the plan sees it: its id ("minor:las/minors/statistics"), name and requirement rows. */
export interface MinorToPlan {
  id: string;
  name: string;
  blocks: RequirementBlock[];
}

/** One of the minor's rows met by a course the degree's plan already books (or the student holds). */
export interface SharedRow {
  minorId: string;
  blockId: string;
  label: string;
  codes: string[];
}

export interface ResidualMinor {
  /** What is left of each row once the degree's courses are credited, in page order. Rows fully met are gone. */
  blocks: RequirementBlock[];
  shared: SharedRow[];
}

function hitOf(choice: CourseChoice, have: Set<string>, used: Set<string>): string | null {
  for (const raw of [...choice.codes, ...(choice.substitutes ?? [])]) {
    const code = norm(raw);
    if (have.has(code) && !used.has(code)) return code;
  }
  return null;
}

function hoursOf(choice: CourseChoice, hit: string, creditsOf: (code: string) => number | null): number {
  return creditsOf(hit) ?? choice.credits ?? 0;
}

/**
 * The minor's rows less what the degree's courses already meet.
 *
 * `have` is what may count for both: courses the degree's plan books for a
 * degree requirement, and courses the student holds. Free electives the
 * degree's plan happened to pick are not in it: the plan with the minor
 * re-picks those, so crediting one would credit a course that may not stay.
 * `used` collects the codes credited, so a second minor cannot credit the same
 * course a third time.
 *
 * A pool with sentences about how it may be filled ("at least 3 hours at the
 * 300 level") is left whole: what is left of it after a shared course cannot
 * be stated without reading those sentences again.
 */
export function residualMinor(
  minor: MinorToPlan,
  have: Set<string>,
  creditsOf: (code: string) => number | null,
  used: Set<string> = new Set(),
): ResidualMinor {
  const blocks: RequirementBlock[] = [];
  const shared: SharedRow[] = [];
  for (const block of minor.blocks) {
    const rule = block.rule;
    if (rule.kind !== 'all' && rule.kind !== 'choose' && rule.kind !== 'pool') {
      blocks.push(block);
      continue;
    }
    if (rule.kind === 'pool' && (rule.constraints?.length ?? 0) > 0) {
      blocks.push(block);
      continue;
    }
    const hits: string[] = [];
    const left: CourseChoice[] = [];
    let hitHours = 0;
    for (const choice of rule.choices) {
      const hit = hitOf(choice, have, used);
      if (hit === null) {
        left.push(choice);
        continue;
      }
      // A choose or pool row takes only what it needs from the degree.
      if (rule.kind === 'choose' && hits.length >= rule.n) { left.push(choice); continue; }
      if (rule.kind === 'pool') {
        const fullByHours = rule.hours !== null && hitHours >= rule.hours;
        const fullByCount = rule.n !== null && hits.length >= rule.n;
        if ((rule.hours !== null || rule.n !== null) && (rule.hours === null || fullByHours) && (rule.n === null || fullByCount)) {
          left.push(choice);
          continue;
        }
      }
      hits.push(hit);
      hitHours += hoursOf(choice, hit, creditsOf);
    }
    if (hits.length === 0) {
      blocks.push(block);
      continue;
    }
    for (const code of hits) used.add(code);
    shared.push({ minorId: minor.id, blockId: block.id, label: block.label || block.areaLabel, codes: hits });
    let next: RequirementRule | null = null;
    if (rule.kind === 'all') {
      next = left.length > 0 ? { ...rule, choices: left } : null;
    } else if (rule.kind === 'choose') {
      const n = rule.n - hits.length;
      next = n > 0 && left.length > 0 ? { ...rule, n, choices: left } : null;
    } else {
      const hours = rule.hours !== null ? Math.max(0, rule.hours - hitHours) : null;
      const n = rule.n !== null ? Math.max(0, rule.n - hits.length) : null;
      const done = (hours === null || hours <= 0) && (n === null || n <= 0);
      const leftCodes = new Set(left.flatMap((c) => c.codes.map(norm)));
      next = done || left.length === 0
        ? null
        : {
            ...rule,
            hours: hours !== null && hours > 0 ? hours : rule.hours === null ? null : 0,
            n: n !== null && n > 0 ? n : rule.n === null ? null : 0,
            choices: left,
            lists: (rule.lists ?? []).map((list) => ({ ...list, codes: list.codes.filter((code) => leftCodes.has(norm(code))) })),
          };
    }
    if (next) blocks.push({ ...block, rule: next, hours: next.kind === 'pool' ? (next.hours ?? block.hours) : block.hours });
  }
  return { blocks, shared };
}

/**
 * A row's name for a sentence: the page's label without its trailing colon,
 * else its area's, else its first courses. Exported for the workspace and the
 * sweep, so both name a row the same way.
 */
export function rowLabel(block: RequirementBlock): string {
  const clean = (s: string | null | undefined) => withoutMinorPageHeading(String(s ?? '')).replace(/[\s:;,.]+$/, '').trim();
  const own = clean(block.label) || clean(block.areaLabel);
  if (own && own !== 'null') return own;
  const rule = block.rule;
  if (rule.kind === 'all' || rule.kind === 'choose' || rule.kind === 'pool') {
    const codes = rule.choices.map((c) => c.codes[0]).filter(Boolean);
    return codes.length <= 3 ? codes.join(', ') : `${codes.slice(0, 3).join(', ')} and ${codes.length - 3} more`;
  }
  return 'a requirement';
}

/** Codes the degree's plan books for a degree requirement, and the codes the student holds: what may count twice. */
export function sharableCodes(degreePlan: GeneratedPlan, heldCodes: Iterable<string>): Set<string> {
  const out = new Set<string>([...heldCodes].map(norm));
  for (const [code, req] of Object.entries(degreePlan.bookedFor ?? {})) {
    if (req && !String(req).startsWith(MINOR_ID_PREFIX)) out.add(norm(code));
  }
  return out;
}

const NOT_A_GAP = new Set(['filled-by-electives', 'not-parsed']);

/** The degree's rows a plan leaves unmet, and the degree courses it could not place. */
export function degreeGaps(plan: GeneratedPlan): Set<string> {
  const out = new Set<string>();
  for (const u of plan.unsatisfied) {
    if (u.requirementId.startsWith(MINOR_ID_PREFIX) || NOT_A_GAP.has(u.reason)) continue;
    out.add(u.requirementId);
  }
  for (const n of plan.notPlaced) {
    if (n.requirementId && n.requirementId.startsWith(MINOR_ID_PREFIX)) continue;
    // A course placed for nothing named (a prerequisite) counts against the
    // minor too: a plan that cannot place one is not a plan to trade for.
    out.add(`not-placed:${norm(n.code)}`);
  }
  return out;
}

const termCredits = (plan: GeneratedPlan) => plan.terms.map((t) => t.credits.min);
const lastUsed = (plan: GeneratedPlan) => plan.terms.reduce((last, t, i) => (t.codes.length > 0 ? i : last), -1);

/** Why a plan with the minor may not replace the degree's own plan, or null when it may. */
export function minorCost(degreePlan: GeneratedPlan, withMinor: GeneratedPlan, maxTerm: number): string | null {
  const before = degreeGaps(degreePlan);
  const lost = [...degreeGaps(withMinor)].filter((id) => !before.has(id));
  if (lost.length > 0) return `it would leave ${lost.length} degree requirement${lost.length === 1 ? '' : 's'} unmet`;
  const a = termCredits(degreePlan);
  const b = termCredits(withMinor);
  for (let i = 0; i < b.length; i++) {
    const cap = Math.max(maxTerm, a[i] ?? 0);
    if (b[i] > cap) return `it would put ${withMinor.terms[i].label} at ${b[i]} hours`;
  }
  if (lastUsed(withMinor) > Math.max(lastUsed(degreePlan), degreePlan.terms.length - 1)) return 'it would need a term past your finish';
  return null;
}

export interface MinorRowOut {
  minorId: string;
  minorName: string;
  blockId: string;
  label: string;
  hours: number | null;
  why: 'did-not-fit' | 'left-out';
}

export interface MinorPlanOutcome {
  /** The plan to show: the degree's own plan with the minor's rows that fit. */
  generated: GeneratedPlan;
  /** How many of the minor rows left to plan went to the engine (all of them when the whole minor fits). */
  kept: number;
  offered: number;
  shared: SharedRow[];
  /** Rows that need a summer or an extra term: left out to protect the degree, or placed nowhere by the engine. */
  needRoom: MinorRowOut[];
  /** Why the whole minor did not go in, in words, or null. */
  cost: string | null;
  /** Hours past the degree-only plan's total. */
  extraHours: number;
  /** The courses the kept plan books for each minor's own rows, by minor id (shared courses are the degree's). */
  booked: Record<string, string[]>;
  runs: number;
}

/**
 * The degree's plan with the minor beside it, degree first.
 *
 * `degreePlan` is the plan the student gets without the minor, built from
 * `degreeInput`. The minor's rows, less what the degree already meets, go to
 * the engine after the degree's. A result that costs the degree anything
 * (minorCost) is not kept: fewer of the minor's rows are tried, in page order,
 * until one fits, at most `maxRuns` builds in all, and the rest are named as
 * needing a summer or an extra term. With none fitting, the degree's own plan
 * stands unchanged.
 */
export function planBesideDegree(
  generate: (input: AutoplanInput) => GeneratedPlan,
  degreeInput: AutoplanInput,
  degreePlan: GeneratedPlan,
  minors: MinorToPlan[],
  options: {
    heldCodes: Iterable<string>;
    creditsOf: (code: string) => number | null;
    maxRuns?: number;
    /**
     * The board's own measure of the degree, for what minorCost cannot see:
     * the rail's progress rows (illinoisProgress) of the degree on a plan, so
     * a row the student sees met on the degree's own plan is never unmet
     * with the minor. Returns why the plan costs the degree, or null.
     */
    degreeCheck?: (plan: GeneratedPlan) => string | null;
  },
): MinorPlanOutcome {
  const have = sharableCodes(degreePlan, options.heldCodes);
  const used = new Set<string>();
  const shared: SharedRow[] = [];
  const rows: Array<{ minor: MinorToPlan; block: RequirementBlock }> = [];
  for (const minor of minors) {
    const r = residualMinor(minor, have, options.creditsOf, used);
    shared.push(...r.shared);
    for (const block of r.blocks) rows.push({ minor, block });
  }
  const maxTerm = degreeInput.preferences?.creditsPerTerm?.max ?? 18;
  const maxRuns = options.maxRuns ?? 4;
  const build = (k: number) =>
    k === 0 ? degreePlan : generate({ ...degreeInput, requirements: [...degreeInput.requirements, ...rows.slice(0, k).map((r) => r.block)] });

  let runs = 0;
  let best = { k: 0, plan: degreePlan };
  let cost: string | null = null;
  if (rows.length > 0) {
    const all = build(rows.length);
    runs += 1;
    cost = minorCost(degreePlan, all, maxTerm) ?? options.degreeCheck?.(all) ?? null;
    if (cost === null) best = { k: rows.length, plan: all };
    else {
      // Fewer rows, by halves: the largest prefix of the minor's rows that costs the degree nothing.
      let lo = 0;
      let hi = rows.length;
      while (hi - lo > 1 && runs < maxRuns) {
        const mid = Math.floor((lo + hi) / 2);
        const plan = build(mid);
        runs += 1;
        if ((minorCost(degreePlan, plan, maxTerm) ?? options.degreeCheck?.(plan) ?? null) === null) {
          lo = mid;
          best = { k: mid, plan };
        } else hi = mid;
      }
    }
  }
  const nameOf = new Map(minors.map((m) => [m.id, m.name]));
  const minorOf = (blockId: string) => minors.find((m) => blockId.startsWith(`${m.id}::`)) ?? null;
  const needRoom: MinorRowOut[] = [];
  for (const { minor, block } of rows.slice(best.k)) {
    needRoom.push({ minorId: minor.id, minorName: minor.name, blockId: block.id, label: rowLabel(block), hours: block.hours ?? null, why: 'left-out' });
  }
  for (const u of best.plan.unsatisfied) {
    if (!u.requirementId.startsWith(MINOR_ID_PREFIX) || NOT_A_GAP.has(u.reason)) continue;
    if (needRoom.some((r) => r.blockId === u.requirementId)) continue;
    const minor = minorOf(u.requirementId);
    const block = rows.find((r) => r.block.id === u.requirementId)?.block;
    needRoom.push({ minorId: minor?.id ?? '', minorName: minor ? (nameOf.get(minor.id) ?? minor.name) : 'Minor', blockId: u.requirementId, label: block ? rowLabel(block) : (u.label || u.areaLabel || 'a requirement'), hours: block?.hours ?? null, why: 'did-not-fit' });
  }
  const booked: Record<string, string[]> = {};
  for (const [code, req] of Object.entries(best.plan.bookedFor ?? {})) {
    const minor = req ? minorOf(String(req)) : null;
    if (minor) (booked[minor.id] ??= []).push(norm(code));
  }
  return {
    generated: best.plan,
    booked,
    kept: best.k,
    offered: rows.length,
    shared,
    needRoom,
    cost,
    extraHours: Math.max(0, best.plan.credits.total.min - degreePlan.credits.total.min),
    runs,
  };
}

/**
 * The Provost's rule that at least 6 hours of a minor's 300- and 400-level
 * courses count for the minor alone, not also for the major. `minorCodes`
 * are the courses counted for the minor's rows, `majorCodes` those counted
 * for the degree's own course rows (not its gen-ed categories or free
 * electives, which are not the major).
 */
export function upperLevelApart(minorCodes: Iterable<string>, majorCodes: Iterable<string>, creditsOf: (code: string) => number | null): { hours: number; codes: string[] } {
  const major = new Set([...majorCodes].map(norm));
  const codes: string[] = [];
  let hours = 0;
  for (const raw of new Set([...minorCodes].map(norm))) {
    const level = Number(raw.split(' ')[1]?.match(/^\d/)?.[0] ?? 0);
    if (level < 3 || major.has(raw)) continue;
    codes.push(raw);
    hours += creditsOf(raw) ?? 0;
  }
  return { hours, codes };
}

/** Campus minimum: 6 hours of 300/400-level minor courses not used for the major. */
export const MINOR_UPPER_APART_HOURS = 6;

/** The courses a plan books for the degree's own course rows (take-all, choose and list rows): the major, for upperLevelApart. */
export function majorCodesOf(bookedFor: Record<string, string | null>, degreeBlocks: RequirementBlock[]): string[] {
  const kind = new Map(degreeBlocks.map((b) => [b.id, b.rule.kind]));
  return Object.entries(bookedFor)
    .filter(([, id]) => id !== null && !String(id).startsWith(MINOR_ID_PREFIX) && ['all', 'choose', 'pool'].includes(kind.get(String(id)) ?? ''))
    .map(([code]) => norm(code));
}

const hoursText = (h: number | null | undefined) => (h ? ` (${h} hours)` : '');

/**
 * The plan's notes for the minors it planned, in plain words: what was
 * planned, what counts twice, what needs a summer or an extra term, and the
 * two rules the planner cannot check (declaring the minor, letter grades).
 */
export function minorPlanNotes(outcome: MinorPlanOutcome, minors: Array<{ id: string; name: string; url: string }>): string[] {
  const notes: string[] = [];
  for (const minor of minors) {
    const shared = outcome.shared.filter((row) => row.minorId === minor.id).flatMap((row) => row.codes);
    const room = outcome.needRoom.filter((row) => row.minorId === minor.id);
    const placed = outcome.booked[minor.id] ?? [];
    const parts: string[] = [];
    if (placed.length === 0 && room.length > 0) {
      parts.push(`${minor.name} (beta): the planner checked this minor against its catalog page, but none of what it still needs fits beside your degree in the terms you have without taking a degree requirement's place or putting a term over 18 hours${outcome.cost ? ` (${outcome.cost})` : ''}.`);
    } else {
      parts.push(`${minor.name} (beta): planned beside your degree from its catalog page, which the planner has checked. Your degree comes first; the minor's courses take free-elective room${minors.length === 1 && outcome.extraHours > 0 ? ` and add ${outcome.extraHours} hours to the plan` : ''}.`);
    }
    if (shared.length > 0) parts.push(`Counting for both your degree and the minor, as campus rules allow: ${shared.join(', ')}.`);
    if (room.length > 0) {
      parts.push(`Not placed for lack of room, so they need a summer term or an extra term: ${room.map((row) => `${row.label}${hoursText(row.hours)}`).join('; ')}.`);
    }
    parts.push(`Declare the minor with the department that offers it and take its courses for a letter grade. Page: ${minor.url}`);
    notes.push(parts.join(' '));
  }
  return notes;
}

/** The note for a minor the student picked that the planner has not checked: nothing of it is planned. */
export function uncheckedMinorNote(minor: { name: string; url: string; inOwnWords: string; whyNotChecked: string | null }): string {
  return `${minor.name}: requirements not yet checked by the planner${minor.whyNotChecked ? ` (${minor.whyNotChecked})` : ''}, so none of its courses were added to this plan. In short, by the planner's own reading: ${minor.inOwnWords} Check the catalog page and the department before planning around it: ${minor.url}`;
}

/** The note when a planned minor is short of the campus rule's 6 upper-level hours apart from the major. */
export function upperApartNote(name: string, apart: { hours: number; codes: string[] }): string {
  return `${name}: campus rules ask for at least ${MINOR_UPPER_APART_HOURS} hours of the minor's 300- and 400-level courses that do not also count for your major. This plan has ${apart.hours}${apart.codes.length ? ` (${apart.codes.join(', ')})` : ''}. Choose upper-level minor courses your major does not use, or ask the department.`;
}
