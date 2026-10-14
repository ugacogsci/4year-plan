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

/** Core-elective hours on the record, in record order, with the areas each usually fills. */
export function transcriptCoreCredits(record: TranscriptRecord | null | undefined): Array<{ line: string; areas: string[]; hours: number }> {
  if (!record || record.schoolId !== 'uga') return [];
  const out: Array<{ line: string; areas: string[]; hours: number }> = [];
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'hours' || !c.coreArea || c.basis?.badge !== 'core') continue;
    const hours = c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0;
    if (!(hours > 0)) continue;
    out.push({ line: `${c.code}${c.designation && c.designation !== c.code ? ` (${c.designation})` : ''}`, areas: c.coreArea.split(' or ').map((a) => a.trim()), hours });
  }
  return out;
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
export function withCoreCredit(blocks: RequirementBlock[], record: TranscriptRecord | null | undefined): { blocks: RequirementBlock[]; used: CoreCreditUse[] } {
  const credits = transcriptCoreCredits(record);
  const electives = transcriptElectiveCredits(record);
  if (credits.length === 0 && electives.length === 0) return { blocks, used: [] };
  const left = new Map<string, number>();
  const used: CoreCreditUse[] = [];
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
    for (const area of credit.areas) {
      if (hours <= 0) break;
      for (const block of blocks) {
        if (hours <= 0) break;
        const size = block.areaLabel === area ? sizeOf(block) : null;
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
  if (used.length === 0) return { blocks, used };
  const out: RequirementBlock[] = [];
  for (const block of blocks) {
    const rest = left.get(block.id);
    if (rest === undefined || block.rule.kind !== 'pool') {
      out.push(block);
      continue;
    }
    if (rest <= 0) continue;
    const mine = used.filter((u) => u.blockId === block.id);
    const note = `${mine.map((u) => `${u.hours} hour${u.hours === 1 ? '' : 's'} met by ${u.line}`).join('; ')} from your transfer credit (the area UGA usually gives it; confirm with your advisor).`;
    const byCourses = block.rule.hours === null;
    out.push({
      ...block,
      ...(byCourses ? {} : { hours: rest, hoursMax: rest }),
      rule: byCourses ? { ...block.rule, n: rest } : { ...block.rule, hours: rest },
      note: block.note ? `${block.note} ${note}` : note,
    });
  }
  return { blocks: out, used };
}
