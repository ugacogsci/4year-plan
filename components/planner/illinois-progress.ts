/**
 * One progress row per requirement the degree page prints, for Illinois.
 *
 * The rail used to draw one bar per page AREA, and an Illinois degree page has
 * three: a composition heading, the college core, the major. That put every
 * general education category under one bar and printed the categories' hours
 * as a bare "28 hr" with nothing to be a fraction of. Georgia's pages print an
 * hour total on each of their eleven areas, so Georgia got eleven bars and
 * Illinois got three, and the difference was in how the two catalogs are laid
 * out, not in what the planner knows.
 *
 * What the planner knows for Illinois is the block: "Composition I, 4 hours",
 * "Cultural Studies: Non-Western Cultures, 1 course", "4 additional 400-level
 * FIN courses", "third semester of a language other than English". Each of
 * those has a size the catalog published and a unit it published it in, so
 * each can be a bar. Nothing here converts between the units: a category the
 * page sizes in courses is shown in courses, because deciding what a course is
 * worth in hours would be inventing a number the page never wrote.
 *
 * Counted off the board and the held credit, every render, so that moving a
 * course moves the bar. Where a number can only be read one of two ways, the
 * lower one is shown: a bar that overstates how close a student is to
 * graduating is the one kind of wrong this rail must never be.
 */

import { courseleafOfContext, degreeSubjects, normaliseCode } from '@/lib/planner/autoplan';
import type { CourseleafSchool } from '@/lib/planner/school-config';
import type { GenEdCredit, LanguagePlan, LanguageTable, PlanRequirement, PoolReport } from '@/lib/planner/autoplan';
import type { CourseChoice, RequirementBlock } from '@/lib/planner/illinois-data';
import { withoutMinorPageHeading } from '@/lib/planner/illinois-minors';
import type { Course, PlanState } from '@/lib/planner/types';
import type { PlanningContext } from '@/lib/planner/autoplan';
import type { AreaRow } from './student-profile-panel';
import { livePools } from './live-pools';

export interface IllinoisProgressInput {
  blocks: RequirementBlock[];
  /** Every code on the board, in term order. */
  boardCodes: string[];
  /** Codes the student walked in with. */
  priorCodes: Iterable<string>;
  byCode: Map<string, Course>;
  /** The pools as counted off the live board, when the plan has been generated. */
  pools: PoolReport[];
  /** The language sequence the plan booked, or null. */
  language: LanguagePlan | null;
  /** Requirements the generation found already met by held credit, by id. */
  satisfiedByPriorCredit: Array<{ requirementId: string }>;
  /**
   * The registrar's language table, for a board restored from this device
   * with no generation behind it. Held language courses are counted from it
   * so the row does not read 0 next to two semesters of Spanish on the board.
   */
  languages?: LanguageTable | null;
  /** Cross-listings by code: spending one code spends the class. */
  equivalents?: Map<string, string[]>;
  /** The degree's published total, for a block whose own words are about reaching it. */
  degreeTotal?: number | null;
  /** Hours the student holds with no course code (exam credit by subject, transfer lines counted as hours). */
  priorHours?: number;
  /** Held credit that meets gen-ed categories without an Illinois course, as the engine counts it. */
  genEdCredits?: GenEdCredit[];
  /** The degree's name, which names its major subject ("Psychology, BSLAS" is PSYC). */
  programName?: string;
  /**
   * The semester in progress with no classes entered yet, and the credits the
   * plan counts for it until they are (plan-start.ts currentAssumedHours).
   * Georgia Tech's open hours rows say they wait on it (countOnce); nothing
   * counts it toward a row.
   */
  currentTerm?: { label: string; assumedHours: number } | null;
  /**
   * Held courses the plan counted for a take-every-course row in place of
   * the course it names (GeneratedPlan.standIns, Georgia Tech): the row
   * counts them the same way, so the rail agrees with the plan.
   */
  standIns?: Array<{ requirementId: string; held: string; for: string }>;
}

/** A recommendation must preserve the same requirement counts shown in the rail. */
export function illinoisProgressGuard(input: Omit<IllinoisProgressInput, 'boardCodes'> & { board: PlanState; context: PlanningContext }): (board: PlanState) => string | null {
  const byId = new Map([...input.byCode.values()].map((course) => [course.id, course.code]));
  const rows = (board: PlanState) => {
    const boardCodes = board.terms.flatMap((term) => term.courseIds).flatMap((id) => byId.get(id) ?? []);
    const pools = livePools({ base: input.pools, blocks: input.blocks, boardCodes, priorCodes: [...input.priorCodes], context: input.context });
    return illinoisProgress({ ...input, boardCodes, pools });
  };
  const before = rows(input.board);
  return (board) => {
    const after = rows(board);
    const lost = before.find((row, index) => (after[index]?.earned ?? 0) < row.earned);
    return lost ? `This change would reduce progress toward ${lost.area.label}.` : null;
  };
}

/** A row's size in the unit the catalog published, or null when it published none. */
interface Sized {
  needed: number | null;
  unit: 'hr' | 'course' | 'semester';
  earned: number;
  note: string;
  /** The codes the count is made of, so the whole rail can be added up. */
  codes: string[];
}

/**
 * The CourseLeaf school a catalog is, read the way the engine reads it
 * (autoplan.ts courseleafOfContext: the course numbers' shape), once per
 * catalog map, so a Georgia Tech switch in school-config.ts reaches the rail
 * and an Illinois board reads exactly as it did.
 */
const schoolOfCatalog = new WeakMap<Map<string, Course>, CourseleafSchool | null>();
function schoolOf(byCode: Map<string, Course>): CourseleafSchool | null {
  if (schoolOfCatalog.has(byCode)) return schoolOfCatalog.get(byCode) ?? null;
  const sample: Course[] = [];
  for (const course of byCode.values()) {
    sample.push(course);
    if (sample.length >= 200) break;
  }
  const school = courseleafOfContext({ courses: sample });
  schoolOfCatalog.set(byCode, school);
  return school;
}

export function illinoisProgress(input: IllinoisProgressInput): AreaRow[] {
  const { blocks, byCode, pools } = input;
  const school = schoolOf(byCode);
  const board = input.boardCodes.map(normaliseCode);
  /*
   * Where each course counts once (countOnce, Georgia Tech), a held course
   * under the name the degree's rows use. ME 1670 and CEE 1770 are one class
   * under two numbers (index twins): the plan holds both names and the
   * workspace keeps one of them (distinctHeld), CEE 1770, first in code
   * order. Mechanical Engineering's Field of Study names ME 1670, and it read
   * 15 of 18 with ME 1670 in the Fall 2026 column (2026-11-09 browser test).
   * Renamed only where no row names the name held and a row names its twin.
   */
  const named = new Set<string>();
  if (school?.countOnce) {
    for (const block of blocks) {
      const rule = block.rule;
      if (rule.kind !== 'all' && rule.kind !== 'choose' && rule.kind !== 'pool') continue;
      for (const choice of rule.choices) for (const code of [...choice.codes, ...(choice.substitutes ?? []), ...(choice.bundles ?? []).flat()]) named.add(normaliseCode(code));
    }
  }
  const heldName = (code: string): string => {
    if (!school?.countOnce || named.has(code)) return code;
    return (input.equivalents?.get(code) ?? []).map(normaliseCode).find((twin) => named.has(twin)) ?? code;
  };
  const heldAs = new Set([...input.priorCodes].map(normaliseCode));
  const prior = new Set([...heldAs].map(heldName));
  // Held first, then the board in term order: the count reads the way the
  // scheduler filled it, earned credit before planned credit.
  const have: string[] = [];
  const seen = new Set<string>();
  for (const code of [...prior, ...board]) {
    if (seen.has(code)) continue;
    seen.add(code);
    have.push(code);
  }
  const haveSet = new Set(have);
  /** Sittings of each course on the board and on the record: a course taken more than once counts each time (repeats.ts). */
  const sittingsOf = new Map<string, number>();
  for (const code of [...prior, ...board]) sittingsOf.set(code, (sittingsOf.get(code) ?? 0) + 1);
  const creditsOf = (code: string): number | null => byCode.get(code)?.credits ?? null;

  /**
   * One class counts for one major block and for one category in an exclusive
   * group. The campus rule lets a course count for a major requirement AND a
   * general education category at once, so those are separate ledgers; two
   * Cultural Studies categories may not share a course, so those share one.
   */
  const spentMajor = new Set<string>();
  /** Which major row claimed each code, so a row nested in another can share it. */
  const spentBy = new Map<string, string>();
  let currentBlock = '';
  /**
   * Rows that sit inside another: "Technical Electives, 30 hours, to include:
   * at least 3 Advanced Computing electives ... one Design elective" makes the
   * "Select three" and "Select one" rows parts of the 30 hours, so a course
   * counts for both. A pool whose label says "to include" is the parent of the
   * "Select ..." rows after it in the same area.
   */
  const parentOf = new Map<string, string>();
  blocks.forEach((block, index) => {
    if (block.rule.kind !== 'pool' || !/\bto include\b/i.test(block.label)) return;
    for (const later of blocks.slice(index + 1)) {
      if (later.areaId !== block.areaId) break;
      if ((later.rule.kind === 'choose' || later.rule.kind === 'pool') && /^select\b/i.test(later.label)) parentOf.set(later.id, block.id);
    }
  });
  const related = (a: string | undefined, b: string): boolean => Boolean(a) && (parentOf.get(a as string) === b || parentOf.get(b) === a);
  /**
   * A required course whose hours the page puts in a list (Georgia Tech's
   * CourseChoice.countsIn: Biology's PHYS 2211, printed with no hours, is Lab
   * Science's), by the list's block: that list counts it beside the row.
   */
  const countsInOf = new Map<string, string>();
  for (const block of blocks) {
    if (block.rule.kind !== 'all') continue;
    for (const choice of block.rule.choices) if (choice.countsIn) countsInOf.set(normaliseCode(choice.codes[0]), choice.countsIn);
  }
  /** Whether a code is already another major row's, unless that row and this one nest. */
  const takenElsewhere = (code: string): boolean => spentMajor.has(code) && !related(spentBy.get(code), currentBlock) && countsInOf.get(code) !== currentBlock;
  const spentGenEd = new Map<string, Set<string>>();
  const spend = (ledger: Set<string>, code: string): void => {
    if (ledger === spentMajor && !spentBy.has(code)) spentBy.set(code, currentBlock);
    ledger.add(code);
    for (const alias of input.equivalents?.get(code) ?? []) ledger.add(normaliseCode(alias));
  };
  const ledgerFor = (group: string): Set<string> => {
    const found = spentGenEd.get(group);
    if (found) return found;
    const made = new Set<string>();
    spentGenEd.set(group, made);
    return made;
  };

  /**
   * Where each course counts once (school-config countOnce, Georgia Tech), the
   * courses a take-every-course row names as its only course, by the rows
   * naming each: a row with alternatives counts one of the others first, as
   * the plan books it. Public Policy's "Political Science and U.S. History"
   * (HIST 2111 ... POL 1101 or PUBP 3000) counted POL 1101, first on the board,
   * and the Major Requirements row that names POL 1101 alone read 0 of 3 next
   * to the PUBP 3000 the plan booked for it.
   */
  const soleRowOf = new Map<string, Set<string>>();
  if (school?.countOnce) {
    for (const block of blocks) {
      if (block.rule.kind !== 'all') continue;
      for (const choice of block.rule.choices) {
        if (choice.codes.length !== 1 || (choice.bundles?.length ?? 0) > 1) continue;
        for (const code of [choice.codes[0], ...(input.equivalents?.get(normaliseCode(choice.codes[0])) ?? [])].map(normaliseCode)) soleRowOf.set(code, (soleRowOf.get(code) ?? new Set<string>()).add(block.id));
      }
    }
  }
  const soleElsewhere = (code: string): boolean => [...(soleRowOf.get(code) ?? [])].some((id) => id !== currentBlock);
  /**
   * And, there, a list's courses (a lecture-lab row's lab with it), which a
   * row with alternatives leaves to the list where another alternative is on
   * the board: Neuroscience's Field of Study "BIOS 1107 or BIOS 1207" counted
   * BIOS 1107 beside the BIOS 1207 the plan booked for it, and Any Lab
   * Science, which lists BIOS 1107, read 4 of 8.
   */
  const listMembers = new Set<string>();
  /** The courses each list holds on the live board (live-pools.ts), the plan's own booking for it first. */
  const listHeld = new Set<string>();
  if (school?.countOnce) {
    for (const block of blocks) {
      if (block.rule.kind !== 'pool') continue;
      for (const choice of block.rule.choices) for (const code of [...choice.codes, ...(school.pairHours ? (choice.bundles ?? []).flat() : [])]) listMembers.add(normaliseCode(code));
    }
    for (const pool of pools) for (const code of [...pool.picked, ...pool.fromPriorCredit]) listHeld.add(normaliseCode(code));
  }
  /**
   * How much a list wants a code, where each course counts once: one a list
   * holds and would fall short without (what the rows have spent counted
   * out), then one a list names or holds to spare, then none.
   */
  const listWants = (code: string): number => {
    if (!listHeld.has(code)) return listMembers.has(code) ? 1 : 0;
    const needs = pools.some((pool) => {
      const mine = [...pool.fromPriorCredit, ...pool.picked].map(normaliseCode);
      if (!mine.includes(code)) return false;
      const rest = mine.filter((c) => c !== code && !spentMajor.has(c));
      const hours = rest.reduce((sum, c) => sum + (creditsOf(c) ?? 0), 0);
      return (pool.hoursTarget !== null && hours < pool.hoursTarget) || (pool.countTarget !== null && rest.length < pool.countTarget);
    });
    return needs ? 2 : 1;
  };
  /** The held code that meets one row of a list, honouring "CS 210 or CS 211" and the page's substitutes. */
  const choiceHit = (choice: CourseChoice): string | null => {
    const candidates = [...choice.codes, ...choice.substitutes].map(normaliseCode).filter((code) => haveSet.has(code) && !takenElsewhere(code));
    if (!school?.countOnce) return candidates[0] ?? null;
    const open = candidates.filter((code) => !soleElsewhere(code));
    const best = [...open].sort((a, b) => listWants(a) - listWants(b))[0] ?? candidates[0] ?? null;
    if (best !== null) return best;
    // A held course the plan counted for this row in place of the one it names (GeneratedPlan.standIns): CHEM 1310 for CHEM 1211K.
    const named = new Set(choice.codes.map(normaliseCode));
    const standIn = (input.standIns ?? []).find((s) => s.requirementId === currentBlock && named.has(normaliseCode(s.for)) && prior.has(normaliseCode(s.held)) && !takenElsewhere(normaliseCode(s.held)));
    return standIn ? normaliseCode(standIn.held) : null;
  };
  /** What a list row is worth: the held course's own credits, else the page's number for the row. */
  const choiceCredits = (choice: CourseChoice, hit: string | null): number => {
    if (hit !== null) {
      const own = creditsOf(hit);
      if (own !== null) return own;
    }
    if (choice.credits !== null) return choice.credits;
    for (const raw of choice.codes) {
      const own = creditsOf(normaliseCode(raw));
      if (own !== null) return own;
    }
    return 0;
  };

  const sized: Array<{ block: RequirementBlock; row: Sized }> = [];
  const creditLedger = new Map<string, Set<string>>();
  const assignedCredits = new Set<string>();
  const usedByHours = new Set<string>();
  /** Unnamed hours blocks are filled last, from whatever no other block claimed. */
  const leftovers: Array<{ block: RequirementBlock; row: Sized }> = [];
  const poolById = new Map(pools.map((pool) => [pool.requirementId, pool]));
  const met = new Set(input.satisfiedByPriorCredit.map((s) => s.requirementId));

  // Specific requirements claim their courses before open lists do, the way
  // the engine fills them: a 30-hour technical-elective list that happens to
  // include ECE 496 must not take it from the design-elective row the plan
  // booked it for. Rows are returned in page order afterwards.
  const pageOrder = new Map(blocks.map((block, index) => [block, index]));
  // A "to include" pool claims after the rows nested in it, so it can count what they counted.
  const nestParents = new Set(parentOf.values());
  const claimOrder = [...blocks].sort((a, b) =>
    Number(a.rule.kind === 'pool') - Number(b.rule.kind === 'pool') ||
    Number(nestParents.has(a.id)) - Number(nestParents.has(b.id)) ||
    (pageOrder.get(a) ?? 0) - (pageOrder.get(b) ?? 0));
  for (const block of claimOrder) {
    currentBlock = block.id;
    const rule = block.rule;

    if (rule.kind === 'gened' || (rule.kind === 'hours' && rule.genEd && rule.genEd.length > 0)) {
      const wanted = new Set(rule.kind === 'gened' ? rule.genEd : (rule.genEd ?? []));
      const wantHours = rule.kind === 'gened' ? rule.hours : rule.hours;
      const wantCourses = rule.kind === 'gened' ? rule.courses : null;
      // An hours block over a category ("one science elective ... in addition
      // to those taken as part of the General Education requirements") takes
      // only courses no gen-ed category has counted.
      const ledger = rule.kind === 'gened' ? ledgerFor(rule.exclusiveGroup) : new Set([...spentGenEd.values()].flatMap((set) => [...set]));
      let hours = 0;
      let courses = 0;
      const counted: string[] = [];
      const isMet = (): boolean =>
        (wantHours === null || hours >= wantHours) && (wantCourses === null || courses >= wantCourses);
      const take = (code: string): void => {
        spend(ledger, code);
        counted.push(code);
        courses += 1;
        hours += creditsOf(code) ?? 0;
      };
      // Held credit with no Illinois course (a Parkland course the guide puts in
      // this category), assigned the way the engine assigns it: a credit fills
      // one category per exclusive group, and a transfer course used for a
      // Cultural Studies category is not also Advanced Composition.
      if (rule.kind === 'gened') {
        const group = transferGroup(rule.exclusiveGroup, rule.genEd);
        const used = creditLedger.get(group) ?? new Set<string>();
        creditLedger.set(group, used);
        for (const credit of input.genEdCredits ?? []) {
          if (isMet()) break;
          if (used.has(credit.id) || !credit.tags.some((tag) => wanted.has(tag))) continue;
          used.add(credit.id);
          assignedCredits.add(credit.id);
          counted.push(credit.label);
          courses += 1;
          hours += credit.credits;
        }
      } else {
        for (const credit of input.genEdCredits ?? []) {
          if (isMet()) break;
          if (credit.package || assignedCredits.has(credit.id) || usedByHours.has(credit.id) || !credit.tags.some((tag) => wanted.has(tag))) continue;
          usedByHours.add(credit.id);
          counted.push(credit.label);
          courses += 1;
          hours += credit.credits;
        }
      }
      // The page's own "fulfilled by" list first, as the scheduler counts it.
      if (rule.kind === 'gened') {
        for (const option of rule.fulfilledBy) {
          if (isMet()) break;
          const hit = option.map(normaliseCode).find((code) => haveSet.has(code) && !ledger.has(code));
          if (hit) take(hit);
        }
      }
      // Then anything held or planned that carries the category, cheapest
      // first: a category sized at one course counts the one claiming the
      // fewest hours, which can understate progress and cannot overstate it.
      const tagged = have
        .filter((code) => !ledger.has(code) && (byCode.get(code)?.tags ?? []).some((tag) => wanted.has(tag)))
        // Held credit first, so the row says the student's own HIST 171 covers
        // US Minority Cultures rather than a course planned for later.
        .sort((a, b) => Number(!prior.has(a)) - Number(!prior.has(b)) || (creditsOf(a) ?? 0) - (creditsOf(b) ?? 0) || a.localeCompare(b));
      for (const code of tagged) {
        if (isMet()) break;
        take(code);
      }
      const unit = wantHours !== null ? 'hr' : 'course';
      const needed = wantHours ?? wantCourses;
      const raw = unit === 'hr' ? hours : courses;
      sized.push({
        block,
        row: {
          needed,
          unit,
          earned: needed === null ? raw : Math.min(raw, needed),
          note: counted.length > 0 ? `Counting ${counted.join(', ')}.` : 'Nothing on the board or in your credit carries this category yet.',
          codes: counted,
        },
      });
      continue;
    }

    if (rule.kind === 'language') {
      const needed = rule.semesters;
      let earned = 0;
      let note = '';
      const codes: string[] = [];
      if (input.language) {
        const lang = input.language;
        const booked = lang.codes.map(normaliseCode).filter((code) => haveSet.has(code));
        codes.push(...booked);
        earned = Math.min(needed, lang.completed + booked.length);
        const brought =
          lang.completed === 0
            ? null
            : lang.from === 'assumed'
              ? `${lang.completed} assumed from high school`
              : lang.from === 'high school'
                ? `${lang.completed} from high school`
                : `${lang.completed} already held`;
        note = [brought, booked.length > 0 ? `${booked.join(', ')} planned` : null]
          .filter(Boolean)
          .join(', ');
        note = note ? `${lang.name}: ${note}.` : `${lang.name}.`;
      } else if (met.has(block.id)) {
        earned = needed;
        note = 'Met by the credit you walked in with.';
      } else if (input.languages) {
        // No generation behind this board. The highest level held in any one
        // language is what can be counted; high school years cannot be, so
        // this reads low rather than wrong.
        let top = 0;
        let of = '';
        for (const language of input.languages.languages) {
          language.levels.forEach((level, index) => {
            if (level.some((option) => option.every((code) => haveSet.has(normaliseCode(code))))) {
              if (index + 1 > top) {
                top = index + 1;
                of = language.name;
              }
            }
          });
        }
        earned = Math.min(needed, top);
        note = top > 0 ? `${top} semester${top === 1 ? '' : 's'} of ${of} held or planned.` : 'No language course on the board or in your credit.';
      } else {
        note = rule.text;
      }
      sized.push({ block, row: { needed, unit: 'semester', earned, note, codes } });
      continue;
    }

    if (rule.kind === 'all') {
      let needed = 0;
      let earned = 0;
      let listed = 0;
      const counted: string[] = [];
      for (const choice of rule.choices) {
        // "One of these sets of courses": the set the student is furthest
        // into, else the first, is the row, and every course in it counts.
        if (choice.bundles && choice.bundles.length > 0) {
          const scored = choice.bundles.map((bundle) => ({
            bundle: bundle.map(normaliseCode),
            hits: bundle.map(normaliseCode).filter((code) => haveSet.has(code) && !takenElsewhere(code)),
          }));
          // Where each course counts once (countOnce), a set the board holds whole before a longer one it holds part of:
          // Computer Science's Junior Design counted CS 2701 and LMC 3403 of "CS 2701, CS 4699, LMC 3403" beside the
          // whole "CS 4723, LMC 3403" the plan booked, and the CS 2701 a free elective had taken read as the row's.
          const whole = (s: { bundle: string[]; hits: string[] }) => (school?.countOnce && s.hits.length === s.bundle.length ? 1 : 0);
          const best = scored.reduce((a, b) => (whole(b) > whole(a) || (whole(b) === whole(a) && b.hits.length > a.hits.length) ? b : a));
          needed += best.bundle.reduce((sum, code) => sum + (creditsOf(code) ?? 0), 0);
          listed += best.bundle.length;
          for (const hit of best.hits) {
            spend(spentMajor, hit);
            counted.push(hit);
            earned += creditsOf(hit) ?? 0;
          }
          continue;
        }
        listed += 1;
        const hit = choiceHit(choice);
        const worth = choiceCredits(choice, hit);
        // A row asking for the course more than once (THEA 359 x 8 hours,
        // four sittings) is worth every sitting, and each one on the board counts.
        const times = choice.repeat?.sittings ?? 1;
        needed += worth * times;
        if (hit !== null) {
          spend(spentMajor, hit);
          counted.push(hit);
          earned += worth * Math.min(times, sittingsOf.get(hit) ?? 1);
        }
      }
      sized.push({
        block,
        row: {
          needed: needed > 0 ? needed : null,
          unit: 'hr',
          earned: needed > 0 ? Math.min(earned, needed) : earned,
          note: `${counted.length} of ${listed} courses on the board or held.`,
          codes: counted,
        },
      });
      continue;
    }

    if (rule.kind === 'choose') {
      const needed = Math.min(rule.n, rule.choices.length) || rule.n;
      let count = 0;
      const counted: string[] = [];
      /*
       * Where each course counts once (countOnce), the rows whose course no
       * list holds or names go first (listWants): Civil Engineering Geosystems' "Select three"
       * breadth row counted CEE 3051, 4100 and 4300 in page order beside a
       * CEE 4600 it had booked, and the concentration's "Select one" list,
       * which names CEE 3051 and 4300, read 0 of 3.
       */
      if (school?.countOnce) {
        // One at a time, each time the row a list wants least, since each one taken changes what the lists can spare.
        const left = [...rule.choices];
        while (count < needed) {
          let best: { at: number; hit: string; wants: number } | null = null;
          left.forEach((choice, at) => {
            const hit = choiceHit(choice);
            if (hit === null) return;
            const wants = listWants(hit);
            if (best === null || wants < best.wants) best = { at, hit, wants };
          });
          if (best === null) break;
          const { at, hit } = best as { at: number; hit: string; wants: number };
          left.splice(at, 1);
          spend(spentMajor, hit);
          counted.push(hit);
          count += 1;
        }
      }
      for (const choice of school?.countOnce ? [] : rule.choices) {
        if (count >= needed) break;
        const hit = choiceHit(choice);
        if (hit === null) continue;
        spend(spentMajor, hit);
        counted.push(hit);
        count += 1;
      }
      sized.push({
        block,
        row: {
          needed,
          unit: 'course',
          earned: count,
          note: counted.length > 0 ? `Counting ${counted.join(', ')}.` : `Choose ${needed} from this list.`,
          codes: counted,
        },
      });
      continue;
    }

    if (rule.kind === 'pool') {
      const live = poolById.get(block.id);
      let hours: number;
      let count: number;
      const counted: string[] = [];
      const hoursTarget = live ? live.hoursTarget : rule.hours;
      const countTarget = live ? live.countTarget : rule.n;
      hours = 0;
      count = 0;
      /**
       * Only as many courses as the list asks for are the list's. Finance's
       * page names four 400-level FIN courses and the plan reaches the degree
       * total with seven, and the three past the target are electives that
       * an unnamed hours block below may count. Claiming all seven here would
       * leave that block reading empty next to three courses that fill it.
       */
      const full = (): boolean =>
        (hoursTarget !== null || countTarget !== null) &&
        (hoursTarget === null || hours >= hoursTarget) &&
        (countTarget === null || count >= countTarget);
      const claim = (code: string, worth: number): void => {
        spend(spentMajor, code);
        counted.push(code);
        count += 1;
        hours += worth;
      };
      if (live) {
        // The pool panel's own order: held credit first, then what the rows
        // nested inside this one counted (they are part of its hours), then
        // the board left to right.
        const nestedHere = [...spentBy].filter(([, by]) => parentOf.get(by) === block.id).map(([code]) => code);
        // And a required course whose hours the page puts here (countsInOf), before a course the list chose: PHYS 2211 is Biology's Lab Science.
        const countedHere = have.filter((code) => countsInOf.get(code) === block.id);
        /*
         * Where a list's hours are held to one language (PoolConstraint
         * singleHours, school-config oneLanguageLists), only that language's
         * courses count: the first semesters of four languages are not twelve
         * hours of one, and International Affairs' Modern Languages read met
         * with CHIN, FREN, GRMN and JAPN 1001 on the board.
         */
        const oneList = school?.oneLanguageLists ? rule.constraints.find((c) => c.single && c.singleHours) : undefined;
        let inOne: Set<string> | null = null;
        if (oneList) {
          const listed = [...live.fromPriorCredit, ...live.picked].map(normaliseCode);
          let most: { codes: string[]; hours: number } = { codes: [], hours: -1 };
          for (const list of oneList.lists) {
            const members = new Set(list.codes.map(normaliseCode));
            const codes = listed.filter((code) => members.has(code));
            const hours = codes.reduce((sum, code) => sum + (creditsOf(code) ?? 0), 0);
            if (hours > most.hours) most = { codes, hours };
          }
          inOne = new Set(most.codes.map((code) => (heldAs.has(code) ? heldName(code) : code)));
        }
        const boardPicks = live.picked.filter((code) => !countedHere.includes(normaliseCode(code)));
        const fromBoard: string[] = [];
        for (const raw of [...live.fromPriorCredit, ...nestedHere, ...countedHere, ...boardPicks]) {
          if (full()) break;
          // A held course under the name the rows use (heldName), as `have` holds it; the live pool names it as the record does.
          const code = heldAs.has(normaliseCode(raw)) ? heldName(normaliseCode(raw)) : normaliseCode(raw);
          if (takenElsewhere(code)) continue;
          if (inOne && !inOne.has(code)) continue;
          // Where each course counts once (countOnce), only what the student holds toward the degree and the board: a held course the plan forfeited is not in priorCodes.
          if (school?.countOnce && !haveSet.has(code)) continue;
          claim(code, creditsOf(code) ?? 0);
          if (boardPicks.includes(raw)) fromBoard.push(code);
        }
        /*
         * Where a level row is met course by course (school-config
         * levelRowsExact), a list sized in hours alone gives back the
         * smallest board courses it does not need once it is full, for the
         * rows after it: Radiological Engineering's Engineering Elective (3
         * hours) took a one-hour ME 2205 and then MSE 3001, in board order,
         * and the hour its 2000-level free electives needed went with it.
         */
        if (school?.levelRowsExact === true && hoursTarget !== null && countTarget === null && hours > hoursTarget) {
          for (const code of fromBoard.slice().sort((a, b) => (creditsOf(a) ?? 0) - (creditsOf(b) ?? 0))) {
            const worth = creditsOf(code) ?? 0;
            // Only a course this list was the one to count (spentBy), so no other row's claim is undone.
            if (hours - worth < hoursTarget || spentBy.get(code) !== currentBlock) continue;
            counted.splice(counted.indexOf(code), 1);
            count -= 1;
            hours -= worth;
            spentBy.delete(code);
            spentMajor.delete(code);
            for (const alias of input.equivalents?.get(code) ?? []) spentMajor.delete(normaliseCode(alias));
          }
        }
      } else {
        for (const choice of rule.choices) {
          if (full()) break;
          const hit = choiceHit(choice);
          if (hit === null) continue;
          // A lecture-lab row counts whole where the school says so (school-config pairHours): its lab on the board is the row's too.
          const pair = school?.pairHours && choice.bundles?.length === 1 && choice.bundles[0].map(normaliseCode).includes(hit) ? choice.bundles[0].map(normaliseCode) : null;
          if (pair) {
            for (const code of pair) if (haveSet.has(code) && !takenElsewhere(code)) claim(code, creditsOf(code) ?? 0);
            continue;
          }
          claim(hit, choiceCredits(choice, hit));
        }
      }
      const unit = hoursTarget !== null ? 'hr' : 'course';
      const needed = hoursTarget ?? countTarget;
      const raw = unit === 'hr' ? hours : count;
      sized.push({
        block,
        row: {
          needed,
          unit,
          earned: needed === null ? raw : Math.min(raw, needed),
          note: counted.length > 0 ? `Counting ${counted.join(', ')}.` : 'Nothing from this list on the board yet.',
          codes: counted,
        },
      });
      continue;
    }

    if (rule.kind === 'hours') {
      // Hours the page names no courses for. Filled after every named block
      // has taken its own, from whatever is left.
      leftovers.push({ block, row: { needed: rule.hours, unit: 'hr', earned: 0, note: '', codes: [] } });
      sized.push(leftovers[leftovers.length - 1]);
      continue;
    }
    // 'unparsed': the review list quotes the page; there is nothing to measure.
  }

  if (leftovers.length > 0) {
    const genEdSpent = new Set<string>();
    for (const ledger of spentGenEd.values()) for (const code of ledger) genEdSpent.add(code);
    const languageCodes = new Set((input.language?.codes ?? []).map(normaliseCode));
    const free = have.filter((code) => !spentMajor.has(code) && !genEdSpent.has(code) && !languageCodes.has(code));

    /**
     * Hours past a row's own target are spare too. Seven technical electives
     * in an eighteen-hour list leave three hours that count toward the
     * degree total and toward nothing else, which is what a free-elective
     * block is. Counted with the major's rows first, so the physics the
     * major requires in full is the major's, and the science category the
     * page says those courses also fulfil has no hours of its own to spare.
     * A course counts once; a row sized in courses or semesters has no hour
     * target to be past.
     */
    const countedOnce = new Set<string>();
    let surplus = 0;
    const named = sized.filter((entry) => !leftovers.includes(entry));
    const majorFirst = [
      ...named.filter(({ block }) => block.rule.kind === 'all' || block.rule.kind === 'choose' || block.rule.kind === 'pool'),
      ...named.filter(({ block }) => block.rule.kind !== 'all' && block.rule.kind !== 'choose' && block.rule.kind !== 'pool'),
    ];
    /*
     * Where each course counts once (countOnce, Georgia Tech), a required
     * course whose hours the page puts in a list (countsInOf) is that list's
     * hours, not its own row's; where the list was filled without it, its
     * hours are spare, as the page says ("If they are not taken as Core
     * IMPACTS courses, they are still required ... and may count towards
     * Free Electives"): a ten-exam Neuroscience student's BIOS 1107 and PHYS
     * 2211 filled Any Lab Science, PHYS 2212's four hours counted nowhere,
     * and Breadth Electives read 13 of 15 on a board past the total
     * (2026-11-09).
     */
    const listCounted = new Map<string, Set<string>>();
    if (school?.countOnce) for (const { block, row } of named) listCounted.set(block.id, new Set(row.codes));
    for (const { block, row } of majorFirst) {
      let hours = 0;
      let spare = 0;
      let elsewhere = 0;
      if (school?.countOnce && block.rule.kind === 'all') {
        for (const choice of block.rule.choices) if (choice.countsIn) elsewhere += creditsOf(normaliseCode(choice.codes[0])) ?? 0;
      }
      for (const code of row.codes) {
        const list = elsewhere > 0 ? countsInOf.get(code) : undefined;
        if (list !== undefined && listCounted.get(list)?.has(code)) continue;
        if (countedOnce.has(code)) continue;
        countedOnce.add(code);
        if (list !== undefined) spare += creditsOf(code) ?? 0;
        else hours += creditsOf(code) ?? 0;
      }
      if (row.unit === 'hr' && row.needed !== null) surplus += spare + Math.max(0, hours - Math.max(0, row.needed - elsewhere));
    }
    const boardTotal = have.reduce((sum, code) => sum + (creditsOf(code) ?? 0), 0) + (input.priorHours ?? 0);

    const taken = new Set<string>();
    // The degree's own subjects, read the way the engine reads them: its
    // course lists, and the department its name names ("Psychology, BSLAS" is
    // PSYC even when the page lists only two PSYC courses).
    const read = degreeSubjects(blocks as unknown as PlanRequirement[], input.programName);
    const ownSubjects = new Set([...read.subjects, ...(read.primary ? [read.primary] : [])]);
    /*
     * Where a level row is met course by course (school-config
     * levelRowsExact), the highest level's row takes the spare courses first:
     * Nuclear Engineering's "Free Electives (1000-level or higher)" took a
     * held course its "(2000-level or higher)" row could have counted. The
     * rows keep the page's order on the rail.
     */
    const exact = school?.levelRowsExact === true;
    const floorOf = (entry: (typeof leftovers)[number]): number => (entry.block.rule.kind === 'hours' ? (entry.block.rule.minLevel ?? 0) : 0);
    const fillOrder = exact ? leftovers.slice().sort((a, b) => floorOf(b) - floorOf(a)) : leftovers;
    for (const entry of fillOrder) {
      const rule = entry.block.rule;
      const floor = rule.kind === 'hours' ? (rule.minLevel ?? null) : null;
      // The lower courses its footnote lets count toward some of its hours (levelAllowanceIn), where levelRowsExact reads them.
      const allowance = exact && rule.kind === 'hours' ? (rule.levelExcept ?? null) : null;
      let allowed = 0;
      // "Concentration Coursework, 28 hours" is courses in the major, not any
      // spare course: counting Spanish and chemistry toward a psychology
      // concentration showed a student progress they had not made.
      // A row the page heads "Free Electives" is any course, wherever it sits, where the school says so (school-config freeElectivesAnySubject).
      const freeRow = school?.freeElectivesAnySubject === true && /\bfree\s+electives?\b/i.test(entry.block.label);
      const majorOnly = !freeRow && /\b(concentration|major)\b/i.test(`${entry.block.label} ${entry.block.areaLabel}`) && ownSubjects.size > 0;
      // The subjects the row's own words name ("AE courses", illinois-data.ts subjectsNamedIn), where the school reads them: a MATH course is no AE Option.
      const named = school?.openRowSubjects && rule.kind === 'hours' && rule.subjects?.length ? new Set(rule.subjects) : null;
      const counted: string[] = [];
      let hours = 0;
      const want = entry.row.needed ?? 0;
      for (const code of free) {
        if (hours >= want) break;
        if (taken.has(code)) continue;
        const worth = creditsOf(code);
        if (worth === null) continue;
        // "Advanced Electives" and "300- or 400-level courses" are the page's
        // own words about what may fill the block, read once by the adapter
        // into the rule, and a 100-level course does not become advanced by
        // being spare.
        const below = floor !== null && levelOf(code) < floor;
        if (below && (!allowance || !allowance.codes.includes(code) || allowed + worth > allowance.hours)) continue;
        if (majorOnly && !ownSubjects.has(code.split(' ')[0])) continue;
        if (named && !named.has(code.split(' ')[0])) continue;
        if (below) allowed += worth;
        taken.add(code);
        counted.push(code);
        hours += worth;
      }
      // Spare hours have no level or subject, so only a block with neither takes them.
      let spareUsed = 0;
      if (floor === null && !majorOnly && !named && hours < want && surplus > 0) {
        spareUsed = Math.min(want - hours, surplus);
        surplus -= spareUsed;
        hours += spareUsed;
      }
      /**
       * "Additional course work ... so that there are at least 128 credit
       * hours earned toward the degree." is the page's own statement that
       * this block is whatever reaches the total, and a board past the total
       * has done what the block asks, however its hours are spread across
       * the other rows. Only a block whose words say so is read that way; a
       * block that says "Electives, 12 hours" is twelve hours of electives.
       */
      /*
       * Where the school says so (school-config freeElectivesAnySubject),
       * "Free Electives" with no level of its own is that block too: Georgia
       * Tech's pages print it as what the named areas leave of the total, so
       * a course past a row's hours, or a research elective a row counts in
       * courses, is one of its hours. Counted without the 0xxx support
       * courses (MATH 0999), which earn no degree credit.
       */
      const toTotal = freeRow && floor === null;
      const aboutTotal = toTotal || /\bso that there (?:are|is) at least\b|\bto (?:reach|bring the total to|total)\b|\btoward the degree\b/i.test(`${entry.block.label} ${entry.block.note}`);
      const total = input.degreeTotal ?? null;
      const degreeHours = toTotal ? have.filter((code) => levelOf(code) > 0).reduce((sum, code) => sum + (creditsOf(code) ?? 0), 0) + (input.priorHours ?? 0) : boardTotal;
      const reached = aboutTotal && total !== null && degreeHours >= total;
      entry.row.earned = reached ? want : Math.min(hours, want);
      entry.row.codes = counted;
      const parts = [
        counted.length > 0 ? `Counting ${counted.join(', ')}, which no other requirement claims` : null,
        spareUsed > 0 ? `${spareUsed} ${spareUsed === 1 ? 'hour' : 'hours'} past other rows' targets` : null,
      ].filter(Boolean);
      entry.row.note = reached
        ? `The board reaches the ${total} this degree takes, which is what this block asks for.${parts.length ? ` ${parts.join(', and ')}.` : ''}`
        : parts.length > 0
          ? `${parts.join(', and ')}.`
          : 'Filled by whatever no other requirement claims. Nothing spare is on the board yet.';
      /*
       * Where each course counts once (countOnce, Georgia Tech) and the
       * semester in progress has no classes entered yet (input.currentTerm),
       * hours the board leaves open wait on those classes: the plan counts
       * that semester as about 15 credits, which no row can count until its
       * courses are known. Still shown open, never met by the estimate.
       */
      const waiting = school?.countOnce && input.currentTerm && input.currentTerm.assumedHours > 0 && !reached && entry.row.earned < want;
      if (waiting && input.currentTerm) {
        entry.row.note = `${entry.row.note} Waiting for your ${input.currentTerm.label} classes: the plan counts about ${input.currentTerm.assumedHours} credits for ${input.currentTerm.label} until you add them, and they count here or leave room for electives.`;
      }
      /*
       * And there a row of hours the page names no course, level or subject
       * for, other than its free electives, is counted from spare courses
       * only as a stand-in: Public Policy's "Minor or Certificate
       * Requirement" counted PUBP courses where the page says a PUBP minor is
       * not allowed, and International Affairs' "History Requirement" an
       * INTA course. The note says an advisor decides what counts.
       */
      if (school?.countOnce && !freeRow && !aboutTotal && floor === null && !majorOnly && counted.length > 0) {
        entry.row.note = `${entry.row.note} The page names no courses for these hours, so these are stand-ins: ask your advisor which courses count here.`;
      }
    }
  }

  sized.sort((a, b) => (pageOrder.get(a.block) ?? 0) - (pageOrder.get(b.block) ?? 0));
  return sized.map(({ block, row }) => {
    const needed = row.needed;
    const percent = needed ? Math.min(100, Math.round((row.earned / needed) * 100)) : 0;
    return {
      area: { label: rowHeading(block), hours: row.unit === 'hr' ? (needed ?? 0) : 0, groups: [] },
      earned: row.earned,
      percent,
      satisfied: needed !== null && row.earned >= needed,
      needed,
      unit: row.unit,
      note: row.note,
      codes: row.codes,
    };
  });
}

/**
 * The page's own words for a row, cut to their first clause when the page
 * wrote a sentence. "Additional course work, subject to the Grainger College
 * of Engineering restrictions to Free Electives, so that there are at least
 * 128 credit hours earned toward the degree." is a heading the rail cannot
 * show, and "Additional course work" is the page's own start of it, not a name
 * this planner made up. A trailing colon or period is punctuation, not words.
 */
/**
 * A row's heading on the rail. A minor page's own heading ("for the
 * Undergraduate Minor in Geology"), which its tables carry as their label, is
 * taken off first, and a row it left with no words is headed by its courses.
 * Degree labels never carry it, so a degree's rows read as they did.
 */
function rowHeading(block: RequirementBlock): string {
  const label = block.label || block.areaLabel || ruleLabel(block) || '';
  const own = withoutMinorPageHeading(label);
  if (own === label.replace(/\s+/g, ' ').trim()) return headingOf(label);
  return headingOf(own) || headingOf(ruleLabel(block));
}

function headingOf(label: string): string {
  const trimmed = (label ?? '').replace(/\s+/g, ' ').replace(/[\s:;,.]+$/, '').trim();
  if (trimmed.length <= 48) return trimmed;
  const clause = trimmed.split(/[,;:]/)[0].trim();
  return clause.length >= 8 ? clause : trimmed;
}

/**
 * A course's level on the three-digit scale the rules carry (illinois-data
 * levelFloorIn): CS 225 is 200 and Georgia Tech's CS 2110 is 200 too. The
 * four-digit number used to read as no level at all, and NRE's "Free
 * Electives (2000-level or higher)" read 0 of 9 beside nine spare hours.
 */
function levelOf(code: string): number {
  const m = code.match(/\b(\d)\d{2,3}[A-Z]?$/);
  return m ? Number(m[1]) * 100 : 0;
}

/**
 * The label a rule carries of its own, where the page's block has none. A
 * list of courses with no heading is headed by its courses: "LAS 100" is the
 * page's own words for that row, and the only ones it printed.
 */
function ruleLabel(block: RequirementBlock): string {
  const rule = block.rule;
  if ((rule.kind === 'pool' || rule.kind === 'hours' || rule.kind === 'gened') && rule.label) return rule.label;
  if (rule.kind === 'all' || rule.kind === 'choose' || rule.kind === 'pool') {
    const codes = rule.choices.map((choice) => choice.codes[0]).filter(Boolean);
    return codes.length <= 3 ? codes.join(', ') : `${codes.slice(0, 3).join(', ')} and ${codes.length - 3} more`;
  }
  return '';
}

/**
 * The ledger a transfer credit is spent against for a category. The campus
 * groups Cultural Studies categories so one course fills one of them; the
 * Parkland guide adds that a course used for Cultural Studies does not also
 * meet Advanced Composition, so for transfer credit the two share a ledger.
 */
export function transferGroup(exclusiveGroup: string | undefined, genEd: string[]): string {
  if (genEd.includes('Advanced Composition')) return 'cultural-studies';
  return exclusiveGroup ?? 'core';
}
