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

import { normaliseCode } from '@/lib/planner/autoplan';
import type { LanguagePlan, LanguageTable, PoolReport } from '@/lib/planner/autoplan';
import type { CourseChoice, RequirementBlock } from '@/lib/planner/illinois-data';
import type { Course } from '@/lib/planner/types';
import type { AreaRow } from './student-profile-panel';

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

export function illinoisProgress(input: IllinoisProgressInput): AreaRow[] {
  const { blocks, byCode, pools } = input;
  const board = input.boardCodes.map(normaliseCode);
  const prior = new Set([...input.priorCodes].map(normaliseCode));
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
  const creditsOf = (code: string): number | null => byCode.get(code)?.credits ?? null;

  /**
   * One class counts for one major block and for one category in an exclusive
   * group. The campus rule lets a course count for a major requirement AND a
   * general education category at once, so those are separate ledgers; two
   * Cultural Studies categories may not share a course, so those share one.
   */
  const spentMajor = new Set<string>();
  const spentGenEd = new Map<string, Set<string>>();
  const spend = (ledger: Set<string>, code: string): void => {
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

  /** The held code that meets one row of a list, honouring "CS 210 or CS 211" and the page's substitutes. */
  const choiceHit = (choice: CourseChoice): string | null => {
    for (const raw of [...choice.codes, ...choice.substitutes]) {
      const code = normaliseCode(raw);
      if (haveSet.has(code) && !spentMajor.has(code)) return code;
    }
    return null;
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
  /** Unnamed hours blocks are filled last, from whatever no other block claimed. */
  const leftovers: Array<{ block: RequirementBlock; row: Sized }> = [];
  const poolById = new Map(pools.map((pool) => [pool.requirementId, pool]));
  const met = new Set(input.satisfiedByPriorCredit.map((s) => s.requirementId));

  for (const block of blocks) {
    const rule = block.rule;

    if (rule.kind === 'gened' || (rule.kind === 'hours' && rule.genEd && rule.genEd.length > 0)) {
      const wanted = new Set(rule.kind === 'gened' ? rule.genEd : (rule.genEd ?? []));
      const wantHours = rule.kind === 'gened' ? rule.hours : rule.hours;
      const wantCourses = rule.kind === 'gened' ? rule.courses : null;
      const ledger = ledgerFor(rule.kind === 'gened' ? rule.exclusiveGroup : 'core');
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
        .sort((a, b) => (creditsOf(a) ?? 0) - (creditsOf(b) ?? 0) || a.localeCompare(b));
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
      const counted: string[] = [];
      for (const choice of rule.choices) {
        const hit = choiceHit(choice);
        const worth = choiceCredits(choice, hit);
        needed += worth;
        if (hit !== null) {
          spend(spentMajor, hit);
          counted.push(hit);
          earned += worth;
        }
      }
      sized.push({
        block,
        row: {
          needed: needed > 0 ? needed : null,
          unit: 'hr',
          earned: needed > 0 ? Math.min(earned, needed) : earned,
          note: `${counted.length} of ${rule.choices.length} courses on the board or held.`,
          codes: counted,
        },
      });
      continue;
    }

    if (rule.kind === 'choose') {
      const needed = Math.min(rule.n, rule.choices.length) || rule.n;
      let count = 0;
      const counted: string[] = [];
      for (const choice of rule.choices) {
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
        // The pool panel's own order: held credit first, then the board left to right.
        for (const raw of [...live.fromPriorCredit, ...live.picked]) {
          if (full()) break;
          const code = normaliseCode(raw);
          if (spentMajor.has(code)) continue;
          claim(code, creditsOf(code) ?? 0);
        }
      } else {
        for (const choice of rule.choices) {
          if (full()) break;
          const hit = choiceHit(choice);
          if (hit === null) continue;
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
    for (const { row } of majorFirst) {
      let hours = 0;
      for (const code of row.codes) {
        if (countedOnce.has(code)) continue;
        countedOnce.add(code);
        hours += creditsOf(code) ?? 0;
      }
      if (row.unit === 'hr' && row.needed !== null) surplus += Math.max(0, hours - row.needed);
    }
    const boardTotal = have.reduce((sum, code) => sum + (creditsOf(code) ?? 0), 0) + (input.priorHours ?? 0);

    const taken = new Set<string>();
    for (const entry of leftovers) {
      const rule = entry.block.rule;
      const floor = rule.kind === 'hours' ? (rule.minLevel ?? null) : null;
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
        if (floor !== null && levelOf(code) < floor) continue;
        taken.add(code);
        counted.push(code);
        hours += worth;
      }
      // Spare hours have no level, so only a block with no floor takes them.
      let spareUsed = 0;
      if (floor === null && hours < want && surplus > 0) {
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
      const aboutTotal = /\bso that there (?:are|is) at least\b|\bto (?:reach|bring the total to|total)\b|\btoward the degree\b/i.test(`${entry.block.label} ${entry.block.note}`);
      const total = input.degreeTotal ?? null;
      const reached = aboutTotal && total !== null && boardTotal >= total;
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
    }
  }

  return sized.map(({ block, row }) => {
    const needed = row.needed;
    const percent = needed ? Math.min(100, Math.round((row.earned / needed) * 100)) : 0;
    return {
      area: { label: headingOf(block.label || block.areaLabel || ruleLabel(block) || ''), hours: row.unit === 'hr' ? (needed ?? 0) : 0, groups: [] },
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
function headingOf(label: string): string {
  const trimmed = (label ?? '').replace(/\s+/g, ' ').replace(/[\s:;,.]+$/, '').trim();
  if (trimmed.length <= 48) return trimmed;
  const clause = trimmed.split(/[,;:]/)[0].trim();
  return clause.length >= 8 ? clause : trimmed;
}

function levelOf(code: string): number {
  const m = code.match(/\b(\d)\d\d[A-Z]?$/);
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
