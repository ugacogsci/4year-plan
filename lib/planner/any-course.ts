/**
 * UGA's open elective blocks and the classes a student already holds.
 *
 * Every Terry BBA ends with two twelve-hour blocks the Bulletin writes as a
 * rule, not a list: "Upper Division General Electives: Any upper level course
 * 3000-5999" and "University Wide General Electives (Non-Business): Any
 * course* excluding ACCT, BUSN, ...", with "Courses counted here cannot also
 * count as Upper Division General Electives." uga-source.tsx turns each into
 * a sample of catalog courses to plan from (broadElectiveCourses) and keeps
 * the rule on the block (PlanRule pool anyCourse). A held class counts where
 * it is on the list, so a senior's own electives counted only when the
 * sample happened to hold them: of a Risk Management senior's 44 classes, 2
 * were on each list, and the board booked five more electives, 143 credits
 * of 120 (2026-10-28).
 *
 * withHeldAnyCourse puts the held classes the rule takes on the block's list,
 * each in one block only: a class one of the degree's own rows already
 * counts (a core area, a required course, its online or honors version) is
 * left where it is; one only one block's rule takes goes there; the rest go
 * to the block with the most hours still open. The generator and the board
 * audit read the same blocks (generatePlan, auditUgaBoard), so the board and
 * its progress say the same thing. A record with nothing for the blocks
 * returns the same array, so no other board changes.
 */
import type { PlanCourseChoice, PlanRequirement } from './autoplan';
import type { ProgramRequirements, RequirementGroup } from './scheduler';
import { ugaLanguageArea, ugaRuleArea } from './uga-university-rules';

/**
 * "Any upper level course 3000-5999": the first digit's range, and the
 * subjects the block rules out; for a subject-wide row ("POLS prefix course
 * 3000-level or higher") the one subject it takes.
 */
export interface AnyCourseRule {
  minLevel: number;
  maxLevel: number;
  excludeSubjects: string[];
  subjects?: string[];
}

/** Whether `code` is a course the block's rule takes. */
export function anyCourseTakes(rule: AnyCourseRule, code: string): boolean {
  const m = code.match(/^([A-Z]{2,5}) ([1-9])\d{3}[A-Z]?$/);
  if (!m) return false;
  const level = Number(m[2]);
  return level >= rule.minLevel && level <= rule.maxLevel && !rule.excludeSubjects.includes(m[1]) && (!rule.subjects || rule.subjects.includes(m[1]));
}

/**
 * The blocks with the held classes their subject-wide rows also take
 * (PlanRule heldRanges: "3000-level or higher" planned from the 3000 level)
 * on their lists, where they count as any listed class does. The same array
 * when nothing is added.
 */
export function withHeldInRange(
  requirements: PlanRequirement[],
  heldCodes: Iterable<string>,
  opts: { creditsOf: (code: string) => number; versionsOf?: (code: string) => string[] },
): PlanRequirement[] {
  const versionsOf = opts.versionsOf ?? ((code: string) => [code]);
  const held = oneOfEach(heldCodes, versionsOf);
  if (held.length === 0) return requirements;
  const listedIn = (choices: PlanCourseChoice[], code: string): boolean => {
    const versions = new Set(versionsOf(code));
    return choices.some((choice) => choice.codes.some((c) => c === code || versions.has(c)));
  };
  let changed = false;
  const out = requirements.map((r) => {
    if ((r.rule.kind !== 'pool' && r.rule.kind !== 'choose') || !r.rule.heldRanges?.length) return r;
    const listed = new Set(r.rule.choices.flatMap((choice) => choice.codes));
    // A held class the area's other rows count stays theirs: the audit spends a class once within an area.
    const elsewhere = spentBy(requirements.filter((other) => other !== r && other.areaId === r.areaId), held, { listed: listedIn, creditsOf: opts.creditsOf });
    const ranges = r.rule.heldRanges;
    const extra = held.filter((code) => !listed.has(code) && !elsewhere.has(code) && ranges.some((range) => anyCourseTakes(range, code)));
    if (extra.length === 0) return r;
    changed = true;
    return { ...r, rule: { ...r.rule, choices: [...r.rule.choices, ...extra.map((code) => ({ codes: [code], credits: opts.creditsOf(code) }))] } } as PlanRequirement;
  });
  return changed ? out : requirements;
}

const programOf = (r: PlanRequirement): string => r.id.split('::')[0];

/**
 * The held classes `rows` count, in their order, each class once: a
 * take-every-course row all it lists, a choose row as many as it asks for, a
 * list its hours. A class `last` says is wanted elsewhere is counted last.
 */
function spentBy(
  rows: PlanRequirement[],
  held: string[],
  opts: { listed: (choices: PlanCourseChoice[], code: string) => boolean; creditsOf: (code: string) => number; last?: (code: string) => boolean },
): Set<string> {
  const spent = new Set<string>();
  for (const r of rows) {
    if (r.rule.kind !== 'all' && r.rule.kind !== 'choose' && r.rule.kind !== 'pool') continue;
    const rule = r.rule;
    const mine = held
      .filter((code) => !spent.has(code) && opts.listed(rule.choices, code))
      .sort((a, b) => Number(opts.last?.(a) ?? false) - Number(opts.last?.(b) ?? false) || a.localeCompare(b));
    if (rule.kind === 'all') {
      for (const code of mine) spent.add(code);
      continue;
    }
    const byCount = rule.kind === 'choose' ? rule.n : rule.hours === null ? rule.n : null;
    const byHours = rule.kind === 'pool' ? rule.hours : null;
    let count = 0;
    let hours = 0;
    for (const code of mine) {
      if (byCount !== null && count >= byCount) break;
      if (byHours !== null && hours >= byHours) break;
      if (byCount === null && byHours === null) break;
      spent.add(code);
      count += 1;
      hours += opts.creditsOf(code);
    }
  }
  return spent;
}

/**
 * The held classes, one code a class: a board's held codes carry every
 * version of a class (ACCT 5001 beside the ACCT 5001E taken), where a
 * transcript names one, and counted apart they filled a block twice.
 */
function oneOfEach(heldCodes: Iterable<string>, versionsOf: (code: string) => string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of [...new Set([...heldCodes].map((c) => c.trim().replace(/\s+/g, ' ').toUpperCase()))].sort()) {
    if (seen.has(code)) continue;
    out.push(code);
    for (const version of [code, ...versionsOf(code)]) seen.add(version);
  }
  return out;
}

/**
 * The blocks with the held classes each open block takes added to its list
 * (and taken off the other open blocks' lists), and which block took which.
 */
export function withHeldAnyCourse(
  requirements: PlanRequirement[],
  heldCodes: Iterable<string>,
  opts: {
    creditsOf: (code: string) => number;
    versionsOf?: (code: string) => string[];
    titleOf?: (code: string) => string | undefined;
    /** Classes on the board one of the degree's own rows was booked for (auditUgaBoard's bookedFor): off the open blocks' lists, as a held class those rows count is. */
    counted?: Iterable<string>;
  },
): { requirements: PlanRequirement[]; added: Map<string, string[]> } {
  const open = requirements.filter((r) => r.rule.kind === 'pool' && r.rule.anyCourse);
  const added = new Map<string, string[]>();
  if (open.length === 0) return { requirements, added };
  const versionsOf = opts.versionsOf ?? ((code: string) => [code]);
  const held = oneOfEach(heldCodes, versionsOf);
  const booked = [...(opts.counted ?? [])];
  if (held.length === 0 && booked.length === 0) return { requirements, added };
  const listed = (choices: PlanCourseChoice[], code: string): boolean => {
    const versions = new Set(versionsOf(code));
    return choices.some((choice) => choice.codes.some((c) => c === code || versions.has(c)));
  };

  const rules = new Map(open.map((r) => [r.id, (r.rule as Extract<PlanRequirement['rule'], { kind: 'pool' }>).anyCourse as AnyCourseRule]));
  const openTo = (code: string): boolean => open.some((r) => anyCourseTakes(rules.get(r.id)!, code));
  // What the degree's own rows already count, in page order, each class once.
  // A list with more held classes than it needs counts the ones no open block
  // could take first (ECON 2105 before PSYC 1101 for Social Sciences), so the
  // rest are left for the electives whatever order the record lists them in.
  const programs = new Set(open.map(programOf));
  // Not UGA's university-wide and college rules or its language sequence, which courses counted elsewhere meet (uga-university-rules.ts): a held cultural diversity course is still an elective's.
  const spent = spentBy(
    requirements.filter((r) => programs.has(programOf(r)) && !(r.rule.kind === 'pool' && r.rule.anyCourse) && !ugaRuleArea(r.areaLabel) && !ugaLanguageArea(r.areaLabel)),
    held,
    { listed, creditsOf: opts.creditsOf, last: openTo },
  );
  /*
   * Terry's x001 sections share the course's title and the first three
   * digits of its number (MGMT 3001 beside MGMT 3000); the equivalents map
   * does not link them, so the title does.
   */
  const sameClassSpent = (code: string): boolean => {
    if (spent.has(code) || versionsOf(code).some((v) => spent.has(v))) return true;
    const title = opts.titleOf?.(code);
    if (!title) return false;
    const stem = code.replace(/^(\S+ \d{3})\d[A-Z]?$/, '$1');
    return [...spent].some((other) => other.replace(/^(\S+ \d{3})\d[A-Z]?$/, '$1') === stem && opts.titleOf?.(other) === title);
  };

  const room = new Map(open.map((r) => [r.id, r.rule.kind === 'pool' ? (r.rule.hours ?? (r.rule.n ?? 0) * 3) : 0]));
  const free = held.filter((code) => !sameClassSpent(code)).sort((a, b) => a.localeCompare(b));
  const fits = new Map(free.map((code) => [code, open.filter((r) => anyCourseTakes(rules.get(r.id)!, code)).map((r) => r.id)]));
  // One block's rule only first, so a class two blocks take never crowds out one only one can.
  const order = free.filter((code) => (fits.get(code)?.length ?? 0) > 0).sort((a, b) => (fits.get(a)!.length - fits.get(b)!.length));
  const taken = new Map<string, string>();
  for (const code of order) {
    const into = fits.get(code)!.filter((id) => (room.get(id) ?? 0) > 0).sort((a, b) => (room.get(b) ?? 0) - (room.get(a) ?? 0))[0];
    if (!into) continue;
    taken.set(code, into);
    room.set(into, (room.get(into) ?? 0) - opts.creditsOf(code));
    added.set(into, [...(added.get(into) ?? []), code]);
  }
  // A held class another block took, or that no block had room for, counts
  // in one block only: the first whose sample lists it.
  for (const code of order) {
    if (taken.has(code)) continue;
    const first = open.find((r) => r.rule.kind === 'pool' && listed(r.rule.choices, code));
    if (first) taken.set(code, first.id);
  }
  // A class the degree's own rows count is not also a general elective, even where a sample lists it.
  const counted = new Set([...held.filter((code) => sameClassSpent(code)), ...booked].flatMap((code) => versionsOf(code).concat(code)));
  if (taken.size === 0 && counted.size === 0) return { requirements, added };

  const out = requirements.map((r) => {
    if (r.rule.kind !== 'pool' || !r.rule.anyCourse) return r;
    const mineNow = added.get(r.id) ?? [];
    const elsewhere = new Set([...taken].filter(([, id]) => id !== r.id).flatMap(([code]) => versionsOf(code).concat(code)));
    const kept = r.rule.choices.filter((choice) => !choice.codes.some((c) => elsewhere.has(c) || counted.has(c)));
    const extra = mineNow.filter((code) => !listed(kept, code)).map((code) => ({ codes: [code], credits: opts.creditsOf(code) }));
    if (kept.length === r.rule.choices.length && extra.length === 0) return r;
    return { ...r, rule: { ...r.rule, choices: [...extra, ...kept] } };
  });
  return { requirements: out, added };
}

/**
 * The degree's progress rows read with the same classes as withHeldAnyCourse
 * and withHeldInRange gave each block: added to the block's own row, taken
 * off the other open blocks' rows. The audit's areaProgress reads these rows.
 */
export function programWithHeldAnyCourse(
  program: ProgramRequirements,
  before: PlanRequirement[],
  after: PlanRequirement[],
  titleOf: (code: string) => string | undefined,
): ProgramRequirements {
  if (before === after) return program;
  const changed = after.filter((r, i) => r !== before[i] && (r.rule.kind === 'pool' || r.rule.kind === 'choose'));
  if (changed.length === 0) return program;
  const rowsOf = (r: PlanRequirement) => new Set((r.rule.kind === 'pool' || r.rule.kind === 'choose' ? r.rule.choices : []).flatMap((choice) => choice.codes));
  const groupFor = new Map<RequirementGroup, PlanRequirement>();
  for (const r of changed) {
    const was = before.find((b) => b.id === r.id);
    if (!was || (was.rule.kind !== 'pool' && was.rule.kind !== 'choose')) continue;
    // Every area of the label, as a degree can repeat one ("Open Major Electives" three times in
    // Fisheries and Wildlife): the group the block's own list is, by the courses they share.
    const codes = rowsOf(was);
    const group = program.areas
      .filter((a) => a.label === r.areaLabel)
      .flatMap((a) => a.groups)
      .filter((g) => !groupFor.has(g))
      .map((g) => ({ g, shared: g.courses.filter((row) => codes.has(row.code)).length, apart: g.courses.filter((row) => !codes.has(row.code)).length }))
      .filter((x) => x.shared > 0)
      .sort((a, b) => b.shared - b.apart - (a.shared - a.apart))[0]?.g;
    if (group) groupFor.set(group, r);
  }
  if (groupFor.size === 0) return program;
  return {
    ...program,
    areas: program.areas.map((area) => ({
      ...area,
      groups: area.groups.map((group) => {
        const r = groupFor.get(group);
        if (!r || (r.rule.kind !== 'pool' && r.rule.kind !== 'choose')) return group;
        const now = r.rule.choices;
        const keep = new Set(now.flatMap((choice) => choice.codes));
        const rows = group.courses.filter((row) => keep.has(row.code));
        const have = new Set(rows.map((row) => row.code));
        const extra = now.filter((choice) => !choice.codes.some((c) => have.has(c))).map((choice) => ({ code: choice.codes[0], title: titleOf(choice.codes[0]) ?? choice.codes[0], credits: choice.credits ?? 3 }));
        return { ...group, courses: [...extra, ...rows] };
      }),
    })),
  };
}
