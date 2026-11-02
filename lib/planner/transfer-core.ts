/**
 * UGA core electives the student already holds, taken off the core areas
 * they fill, so the board does not book a course the student does not need.
 *
 * UGA's equivalency list (and UGA's own record) gives many transfer courses
 * as a core elective, "SOCI 1GXX", rather than one UGA course. Within the
 * University System of Georgia a core course earns credit in the same core
 * area at the next school (Board of Regents policy 3.3.1, area to area), so
 * Georgia State's HIST 2110 still fills UGA's social-science core. A UGA
 * degree states its core areas as course lists with an hours total ("V.
 * Social Sciences, 3 hours from these"); the line's hours come off that
 * total, and an area they fill completely leaves the board.
 *
 * Only a list sized in hours with no further condition is reduced, only in
 * the area the subject usually fills (transcript.ts says "usually" and asks
 * the student to confirm), and each hour is used once. A record with no core
 * elective returns the same blocks, so no other plan changes.
 *
 * Added 2026-11-02, each from a page UGA or the System publishes:
 *  - A "HIST 1GHX" line is, in UGA's own list's words, a core elective "that
 *    also meets the U.S. history requirement" (UGA Transfer Equivalency
 *    Search legend, public/uga-transfer/index.json; the Bulletin's
 *    Undergraduate Graduation Requirements exempt the history examination by
 *    HIST 2111 or 2112, transfer-official.ts UGA_GRADUATION_REQUIREMENTS). It
 *    meets the University-Wide "United States and Georgia History" row as
 *    HIST 2111 does, beside its Area V hours (the row is one of the
 *    requirements courses counted elsewhere meet, uga-program-overrides.ts
 *    ugaOverlapArea), so the board stops booking HIST 2112 for it.
 *  - A math core elective ("MATH 1GXX", College Algebra or Quantitative
 *    Reasoning) from a University System school fills UGA's Area I math
 *    first: UGA's crosswalk of Core IMPACTS puts the System's Mathematics &
 *    Quantitative Skills domain in Area I: Foundation Courses
 *    (UGA_CORE_CROSSWALK), and credit goes domain to domain (USG_TRANSFER_HUB).
 *    Only where the degree's Area I list takes a course at that level (it
 *    names MATH 1101) and no held course already fills it; otherwise it
 *    fills III. Quantitative Reasoning as before. Not for a technical college
 *    or a school outside the System: no System-wide area rule reaches them.
 *  - A University System record that prints its core curriculum completed
 *    (record.usgCore 'complete') meets Areas I to V and the Area II
 *    laboratory rule; Area VI and every other row stay course by course
 *    (transfer-official.ts usgCoreCompletion).
 *  - A finished core the record does not print (a System associate degree
 *    with no core notation, or the student's own words, "I finished my
 *    core") is not assumed: the core rows still on the board say how to
 *    confirm it, and nothing else changes.
 *  - Franklin College's History Requirement is "one 3-hour HIST course"
 *    (uga-university-rule-lists.ts FRANKLIN_HISTORY, from Franklin's degree
 *    requirements page): a line UGA's list gives as HIST credit ("HIST 1GHX",
 *    "HIST 2TXX") is a HIST course of three hours or more, so it meets the
 *    row, beside the area its hours fill, as a HIST course on the record
 *    does.
 */

import type { RequirementBlock } from './illinois-data';
import type { TranscriptRecord } from './transcript';

export interface CoreCreditUse {
  /** The line as printed and its designation: "HIST 2110 (HIST 1GHX)". */
  line: string;
  area: string;
  hours: number;
  blockId: string;
  /** Whether the whole block is met and left off the board. */
  filled: boolean;
}

export interface TranscriptCoreCredit {
  line: string;
  areas: string[];
  hours: number;
  /** The designation's subject ("MATH" of "MATH 1GXX"). */
  subject: string | null;
  /** "HIST 1GHX": UGA's list says it also meets the U.S. history requirement. */
  usHistory: boolean;
  /** Taught at a University System of Georgia school (transcript.ts sendingSystem). */
  usg: boolean;
}

/** Core-elective hours on the record, in record order, with the areas each usually fills. */
export function transcriptCoreCredits(record: TranscriptRecord | null | undefined): TranscriptCoreCredit[] {
  if (!record || record.schoolId !== 'uga') return [];
  const out: TranscriptCoreCredit[] = [];
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'hours' || !c.coreArea || c.basis?.badge !== 'core') continue;
    const hours = c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0;
    if (!(hours > 0)) continue;
    const designation = (c.designation ?? '').toUpperCase();
    out.push({
      line: `${c.code}${c.designation && c.designation !== c.code ? ` (${c.designation})` : ''}`,
      areas: c.coreArea.split(' or ').map((a) => a.trim()),
      hours,
      subject: designation.match(/^([A-Z]{2,5}) /)?.[1] ?? null,
      usHistory: /^[A-Z]{2,5} \dGHX$/.test(designation),
      usg: c.sendingSystem === 'usg',
    });
  }
  return out;
}

/** An area named bare or for its program ("Finance BBA: I. Foundation Courses"), as the board audit reads it. */
const areaIs = (label: string | null | undefined, area: string): boolean => label === area || Boolean(label?.endsWith(`: ${area}`));
const AREA_I = 'I. Foundation Courses';
const AREA_III = 'III. Quantitative Reasoning';
/** UGA's general-education core areas, I to V, and the Area II laboratory rule (uga-program-overrides.ts). */
const CORE_AREAS = [AREA_I, 'II. Physical Sciences', 'II. Life Sciences', AREA_III, 'IV. World Languages and Global Culture', 'IV. Humanities and the Arts', 'V. Social Sciences', 'Core Area II Laboratory Science'];
const UNIVERSITY_WIDE = 'University-Wide Requirements';
const FRANKLIN_HISTORY = 'Franklin College History Requirement';
const US_HISTORY_ROW = 'United States and Georgia History';
const normCode = (code: string): string => code.replace(/\s+/g, ' ').trim().toUpperCase();
const choiceCodes = (b: RequirementBlock): string[] => (b.rule.kind === 'pool' || b.rule.kind === 'all' || b.rule.kind === 'choose' ? b.rule.choices.flatMap((c) => c.codes.map(normCode)) : []);
/**
 * Area I's math row: one course from a list of MATH and STAT courses
 * ("MATH 1101, MATH 1113, MATH 2200, ... or STAT 2000"). Only a list that
 * names MATH 1101 takes a 1000-level core elective; Biology's, which starts
 * at MATH 1113, does not.
 */
function isAreaIMath(b: RequirementBlock): boolean {
  if (!areaIs(b.areaLabel, AREA_I) || b.rule.kind !== 'choose' || b.rule.n !== 1) return false;
  const codes = choiceCodes(b);
  return codes.length > 0 && codes.every((c) => /^(MATH|STAT) /.test(c)) && codes.includes('MATH 1101');
}
/** Hours a core block stands for, for the audit's row: its own hours, or three a course. */
function blockHours(b: RequirementBlock): number {
  if (b.rule.kind === 'pool' && b.rule.hours) return b.rule.hours;
  if (b.rule.kind === 'pool' && b.rule.n) return b.rule.n * 3;
  if (b.rule.kind === 'all') return Math.max(1, b.rule.choices.length) * 3;
  if (b.rule.kind === 'choose') return Math.max(1, b.rule.n ?? 1) * (areaIs(b.areaLabel, 'Core Area II Laboratory Science') ? 1 : 3);
  return 3;
}

/** Terry College subjects: a "Non-Business" elective list takes none of them. */
const BUSINESS_SUBJECTS = new Set(['ACCT', 'BUSN', 'ECON', 'FINA', 'INTB', 'LEGL', 'MARK', 'MGMT', 'MIST', 'REAL', 'RMIN']);

/**
 * Elective hours UGA's list gives a transfer course ("UNIV 1TXX", "PEDB
 * 1TXX"): hours toward the degree that no named requirement takes. A degree's
 * general-electives list is where those hours go, so they come off it the way
 * a core elective comes off its core area. An "Upper Division" list takes
 * only 3TXX and 4TXX; a "Non-Business" list takes no Terry subject.
 */
export function transcriptElectiveCredits(record: TranscriptRecord | null | undefined): Array<{ line: string; subject: string; level: number; hours: number }> {
  if (!record || record.schoolId !== 'uga') return [];
  const out: Array<{ line: string; subject: string; level: number; hours: number }> = [];
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'hours' || c.basis?.badge !== 'elective') continue;
    const m = (c.designation ?? '').match(/^([A-Z]{2,4}) ([1-4])TXXL?$/);
    if (!m) continue;
    const hours = c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0;
    if (!(hours > 0)) continue;
    out.push({ line: `${c.code} (${c.designation})`, subject: m[1], level: Number(m[2]), hours });
  }
  return out;
}

/**
 * The blocks with held core-elective hours taken off the core areas they
 * fill, and held elective hours off the general-electives lists. Returns the
 * same array when nothing applies.
 */
/** "I finished my core", "core curriculum is complete": the student's own words, which the board asks them to confirm. */
/** "Part of my core", "almost done with my core", "not finished my core": not a finished core. */
const SAID_CORE_PART = /\b(?:part|some|most|half|portion|bit)\s+of\s+(?:my|the)\s+core\b|\b(?:almost|nearly|not|haven'?t|hasn'?t|still|yet)\b[^.]{0,30}\bcore\b|\bcore\b[^.]{0,30}\b(?:yet|almost|nearly|soon)\b/i;
const SAID_CORE_DONE = /\b(?:finish(?:ed)?|complet(?:ed|e)|done with)\b[^.]{0,40}\bcore\b|\bcore\b[^.]{0,30}\b(?:is |are )?(?:finished|complete[d]?|done)\b/i;

export function withCoreCredit(
  blocks: RequirementBlock[],
  record: TranscriptRecord | null | undefined,
  /** The student's own words about their studies (answers.studying and timeline), read only for a finished core to confirm. */
  said = '',
): { blocks: RequirementBlock[]; used: CoreCreditUse[] } {
  const credits = transcriptCoreCredits(record);
  const electives = transcriptElectiveCredits(record);
  const complete = record?.schoolId === 'uga' && record.usgCore?.status === 'complete' ? record.usgCore : null;
  /*
   * A finished core to confirm: a System associate degree printed without a
   * core notation (record.usgCore 'confirm'), or a System record and the
   * student saying they finished their core.
   */
  const systemSchool = record?.schoolId === 'uga' ? record.courses.find((c) => c.sendingSystem === 'usg' && c.from)?.from ?? null : null;
  const toConfirm = complete
    ? null
    : record?.schoolId === 'uga' && record.usgCore?.status === 'confirm'
      ? `Your ${record.usgCore.school} record shows "${record.usgCore.evidence}" but not your core curriculum completed.`
      : systemSchool && SAID_CORE_DONE.test(said) && !SAID_CORE_PART.test(said)
        ? `You said you finished your core at ${systemSchool}, and the record does not print it.`
        : null;
  if (credits.length === 0 && electives.length === 0 && !complete && !toConfirm) return { blocks, used: [] };
  const left = new Map<string, number>();
  const used: CoreCreditUse[] = [];
  // UGA courses the record holds outright (a line UGA's list makes "MATH 1113", or "BIOL 1103 + BIOL 1103L").
  const heldCodes = new Set((record?.courses ?? []).filter((c) => c.use && c.counts === 'course' && c.matched).flatMap((c) => [c.matched as string, ...(c.also ?? [])]).map(normCode));
  /*
   * A finished University System core (transfer-official.ts usgCoreCompletion):
   * every block of Areas I to V and the Area II laboratory rule is met and
   * leaves the board. Area VI and the degree's other rows are untouched.
   */
  if (complete) {
    for (const block of blocks) {
      const area = CORE_AREAS.find((a) => areaIs(block.areaLabel, a));
      if (!area || left.has(block.id)) continue;
      left.set(block.id, 0);
      used.push({ line: `Core curriculum completed at ${complete.school}`, area, hours: blockHours(block), blockId: block.id, filled: true });
    }
  }
  // A core-area list sized in hours ("3 hours from these"), or in courses
  // ("one of these") when it states no hours: a transfer line is one course.
  const sizeOf = (b: RequirementBlock): { by: 'hours' | 'courses'; size: number } | null => {
    if (b.rule.kind !== 'pool' || b.rule.constraints.length > 0) return null;
    if (b.rule.hours !== null && b.rule.hours > 0 && b.rule.n === null) return { by: 'hours', size: b.rule.hours };
    if (b.rule.hours === null && b.rule.n !== null && b.rule.n > 0) return { by: 'courses', size: b.rule.n };
    return null;
  };
  for (const credit of credits) {
    let hours = credit.hours;
    /*
     * "HIST 1GHX" meets UGA's U.S. and Georgia history row (see the head of
     * this file), beside the Area V hours it gives below. A record that
     * already holds HIST 2111 or HIST 2112 has the row met by that course.
     */
    if (credit.usHistory && !heldCodes.has('HIST 2111') && !heldCodes.has('HIST 2112')) {
      for (const block of blocks) {
        if (!areaIs(block.areaLabel, UNIVERSITY_WIDE) || block.label !== US_HISTORY_ROW || left.has(block.id)) continue;
        left.set(block.id, 0);
        used.push({ line: credit.line, area: UNIVERSITY_WIDE, hours: Math.min(3, credit.hours), blockId: block.id, filled: true });
      }
    }
    /*
     * A University System math core elective fills Area I's math first, when
     * the degree's Area I list takes it and nothing held fills it already
     * (see the head of this file); otherwise its areas below, as before.
     */
    if (credit.usg && (credit.subject === 'MATH' || credit.subject === 'STAT') && credit.areas.includes(AREA_III)) {
      const block = blocks.find((b) => isAreaIMath(b) && !left.has(b.id) && !choiceCodes(b).some((c) => heldCodes.has(c)));
      if (block) {
        left.set(block.id, 0);
        used.push({ line: credit.line, area: AREA_I, hours, blockId: block.id, filled: true });
        hours = 0;
      }
    }
    for (const area of credit.areas) {
      if (hours <= 0) break;
      for (const block of blocks) {
        if (hours <= 0) break;
        // With a minor or a second program beside the degree every area is
        // named for its program ("Risk Management and Insurance BBA: II.
        // Physical Sciences", planner-workspace.tsx combinePrograms), as the
        // board audit reads it (uga-board-audit.ts, endsWith): matched on the
        // bare name alone, a Georgia State ASTR 1000 (ASTR 1GXX) filled
        // Physical Sciences for the degree alone and booked ASTR 1010 once a
        // minor and a certificate were added.
        const size = block.areaLabel === area || block.areaLabel.endsWith(`: ${area}`) ? sizeOf(block) : null;
        if (!size) continue;
        const remaining = left.get(block.id) ?? size.size;
        if (remaining <= 0) continue;
        const take = size.by === 'hours' ? Math.min(hours, remaining) : 1;
        left.set(block.id, remaining - take);
        used.push({ line: credit.line, area, hours: size.by === 'hours' ? take : hours, blockId: block.id, filled: remaining - take <= 0 });
        hours = size.by === 'hours' ? hours - take : 0;
      }
    }
  }
  // Franklin's History Requirement from a line UGA gives as HIST credit (see the head of this file).
  const history = [...credits.filter((c) => c.subject === 'HIST'), ...electives.filter((c) => c.subject === 'HIST')].find((c) => c.hours >= 3);
  if (history && ![...heldCodes].some((c) => c.startsWith('HIST '))) {
    const block = blocks.find((b) => areaIs(b.areaLabel, FRANKLIN_HISTORY) && !left.has(b.id));
    if (block) {
      left.set(block.id, 0);
      used.push({ line: history.line, area: FRANKLIN_HISTORY, hours: 3, blockId: block.id, filled: true });
    }
  }
  for (const credit of electives) {
    let hours = credit.hours;
    // An upper-division list first for a 3TXX or 4TXX, so a lower list keeps
    // room for credit only it can take.
    const fits = blocks
      .filter((b) => /\bgeneral electives?\b/i.test(`${b.areaLabel ?? ''} ${b.label ?? ''}`))
      .filter((b) => {
        const name = `${b.areaLabel ?? ''} ${b.label ?? ''}`;
        if (/upper[- ]division/i.test(name) && credit.level < 3) return false;
        if (/non-?business/i.test(name) && BUSINESS_SUBJECTS.has(credit.subject)) return false;
        return true;
      })
      .sort((a, b) => Number(/upper[- ]division/i.test(`${b.areaLabel ?? ''} ${b.label ?? ''}`)) - Number(/upper[- ]division/i.test(`${a.areaLabel ?? ''} ${a.label ?? ''}`)));
    for (const block of fits) {
      if (hours <= 0) break;
      const size = sizeOf(block);
      if (!size || size.by !== 'hours') continue;
      const remaining = left.get(block.id) ?? size.size;
      if (remaining <= 0) continue;
      const take = Math.min(hours, remaining);
      left.set(block.id, remaining - take);
      used.push({ line: credit.line, area: block.areaLabel ?? block.label ?? '', hours: take, blockId: block.id, filled: remaining - take <= 0 });
      hours -= take;
    }
  }
  if (used.length === 0 && !toConfirm) return { blocks, used };
  const confirmNote = toConfirm
    ? `${toConfirm} If your transcript or UGA's evaluation shows your University System core curriculum completed, UGA counts this core area as met (full credit area to area); until then this plan books it.`
    : null;
  const withConfirm = (block: RequirementBlock): RequirementBlock =>
    confirmNote && CORE_AREAS.some((a) => areaIs(block.areaLabel, a)) ? { ...block, note: block.note ? `${block.note} ${confirmNote}` : confirmNote } : block;
  const out: RequirementBlock[] = [];
  for (const block of blocks) {
    const rest = left.get(block.id);
    // Met in full: off the board (a core area, Area I's math, the history row).
    if (rest !== undefined && rest <= 0) continue;
    if (rest === undefined || block.rule.kind !== 'pool') {
      out.push(withConfirm(block));
      continue;
    }
    const mine = used.filter((u) => u.blockId === block.id);
    const note = `${mine.map((u) => `${u.hours} hour${u.hours === 1 ? '' : 's'} met by ${u.line}`).join('; ')} from your transfer credit (the area UGA usually gives it; confirm with your advisor).`;
    const byCourses = block.rule.hours === null;
    out.push(withConfirm({
      ...block,
      ...(byCourses ? {} : { hours: rest, hoursMax: rest }),
      rule: byCourses ? { ...block.rule, n: rest } : { ...block.rule, hours: rest },
      note: block.note ? `${block.note} ${note}` : note,
    }));
  }
  return { blocks: out, used };
}
