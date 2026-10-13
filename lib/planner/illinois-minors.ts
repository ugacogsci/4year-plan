import type {
  CatalogRowLookup,
  CourseChoice,
  RawProgramArea,
  RawProgramCourse,
  RawProgramGroup,
  RequirementBlock,
  RequirementRule,
} from './illinois-data.ts';
import { requirementRulesForProgram } from './illinois-data.ts';
import { ILLINOIS_SUBJECT_NAMES } from './illinois-subjects.ts';

/**
 * Illinois minors, read for a plan (beta).
 *
 * scripts/illinois/minors.mjs crawls the catalog's 130 minor pages into
 * public/illinois/minors/crawl.json with the degree crawler's own table
 * parser. This module turns one into requirement blocks the engine can plan,
 * the way adaptIllinoisPrograms does for a degree, with three differences that
 * exist because a minor is not a degree:
 *
 *   - No campus general education table. adaptIllinoisPrograms appends it
 *     (withCampusGenEd) to every page that lacks one, which is right for a
 *     degree and wrong for a minor: read that way, every minor asked for a
 *     third semester of a language and nine gen-ed categories.
 *   - The minor's own total, 12 to 30 hours, which the crawler reads from the
 *     page. A degree's total has to be 100 to 200 and a minor's never is, so
 *     the degree reader left every minor without one.
 *   - Every id starts with "minor:", so a minor's blocks can sit beside a
 *     degree's in one plan and never collide with or be mistaken for them.
 *
 * Two shapes of table that minor pages use and degree pages rarely do are read
 * here, in code only minors reach, so no degree reading can move:
 *
 *   (a) a required course printed as a table heading rather than a row:
 *       Data Science heads its core "STAT/CS/IS 107 Data Science Discovery 4",
 *       which the degree reader takes for an unnamed 4 hours.
 *   (c) "N hours of SUBJ", hours of any course in a subject, with no level:
 *       "Select a minimum of 9 hours from any HORT courses", "6 hours of AAS
 *       coursework", "Any MUS or MUSC course may satisfy elective credits".
 *       The degree reader keeps these as hours with no subject, which the
 *       plan fills with whatever fits.
 *
 * Everything else is the degree reader's (requirementRulesForProgram), called
 * on the minor's tables as they are. minors-research/DESIGN.md has the shapes
 * not read yet: (b) a subject-and-level sentence inside a table, (d) choose
 * one track and (e) one table per kind of major.
 */

export const MINOR_ID_PREFIX = 'minor:';

/** A campus minor is 16 to 21 hours (LAS: 18 to 24); anything outside 12 to 30 is not a minor's total. */
export const MINOR_TOTAL_MIN = 12;
export const MINOR_TOTAL_MAX = 30;

export interface RawIllinoisMinor {
  /** The catalog path without /undergraduate/: "las/minors/spanish", "minors/socw". */
  id: string;
  college: string;
  name: string;
  /** The names the A to Z list gives it (one minor is listed twice). */
  listedAs?: string[];
  url: string;
  /** The total the page states, 12 to 30, or null where it states none. */
  totalCredits: number | null;
  totalFrom?: 'total-row' | 'sentence' | 'table-cells' | null;
  areas: RawProgramArea[];
  courseCount: number;
}

export interface RawMinorFile {
  school: string;
  source: string;
  fetchedAt: string;
  minors: RawIllinoisMinor[];
  skipped?: Array<{ path: string; why: string }>;
}

export interface MinorReading {
  /** "minor:" and the catalog path, "minor:las/minors/spanish". */
  id: string;
  catalogId: string;
  name: string;
  college: string;
  url: string;
  totalCredits: number | null;
  blocks: RequirementBlock[];
  /** Which minor-only readings changed this minor's tables, by shape letter, with the course or subject. */
  readings: string[];
  /**
   * A teacher-education minor, which comes with licensure rules (admission,
   * student teaching, state tests) that a course plan cannot show. Not
   * offered in the beta.
   */
  teacherEducation: boolean;
  /**
   * The whole minor read as one list: a pool sized at the minor's own total,
   * out of a table the page splits with its own comment rows ("Select one of
   * the following", "Select two of the following", "Pick one"). The degree
   * reader merges such a table into one list when it cannot tell the parts
   * apart, and the hours then match the page by construction while the plan
   * may skip a required course. Never offered.
   */
  readAsOneList: boolean;
}

/**
 * Minors whose hours read right but whose reading is wrong in a way the
 * numbers cannot show, found by reading each page beside its reading
 * (2026-10-09). Not offered until the shape is read; the reason is in
 * plain words.
 */
export const MINORS_HELD_FROM_BETA: Readonly<Record<string, string>> = {
  'las/minors/creative-writing': 'the 9 hours are one of two 3-course workshop sequences, and the reading lets a plan mix them',
  'aces/minors/military-leadership': 'the electives are one branch of four (Air Force, Army, Navy, Marines), and the reading mixes branches',
  'las/minors/global-markets-society': 'the three specialization courses come from one track, and the reading mixes tracks',
  'ahs/minors/interdisciplinary-health-technology': 'three required courses and a choice of one computing course are read as one list of six',
  'aces/minors/child-health-well-being': 'two required development courses and a choice of one more are read as one list of four',
};

/**
 * The minors a beta can offer, by catalog id: the reading's hours are the
 * page's total, within one; the engine's own plan of the minor meets every
 * row and books what the page states (up to four more where a list's course
 * carries four hours); not read as one list; not a teacher-education minor;
 * not held above. __minors.check.mjs recomputes this list from the crawl and
 * fails when it differs, so a catalog refresh that changes a minor is seen.
 */
export const MINOR_BETA: readonly string[] = [
  'aces/minors/adult-development',
  'aces/minors/horticulture',
  'aces/minors/leadership-studies',
  'aces/minors/natural-resource-conservation',
  'aces/minors/nutrition',
  'ahs/minors/aging-health',
  'ahs/minors/disability-studies',
  'ahs/minors/health-administration',
  'ahs/minors/public-health',
  'ahs/minors/recreation-sport-tourism',
  'ahs/minors/speech-hearing-science',
  'bus/minors/business-analytics',
  'engineering/minors/physics',
  'engineering/minors/semiconductor-engineering',
  'faa/minors/architectural-studies',
  'faa/minors/dance',
  'faa/minors/landscape',
  'faa/minors/music',
  'las/minors/asian-american-studies',
  'las/minors/data-science',
  'las/minors/ecology-conservation-biology',
  'las/minors/english-second-language',
  'las/minors/geology',
  'las/minors/german-business-commercial-studies',
  'las/minors/integrative-biology',
  'las/minors/italian',
  'las/minors/mathematics',
  'las/minors/statistics',
  'las/minors/turkish',
  'law/minors/legal-studies',
  'media/minors/advertising',
  'media/minors/critical-film-production',
  'media/minors/journalism',
  'media/minors/public-relations',
  'minors/socw',
];

export interface MinorReadOptions {
  /** False reads the tables with the degree reader alone, for the scoreboard's "before". */
  shapes?: boolean;
}

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * (a) A required course printed as a table heading.
 *
 * "STAT/CS/IS 107 Data Science Discovery 4" is one course listed under three
 * subjects, worth four hours. Only a heading with no rows of its own, and
 * only when the catalog has the course: a heading that merely starts with
 * capitals ("ACES Core Requirements") is not a course.
 */
const HEADER_CODE = /^((?:[A-Z]{2,4}\s?\/\s?)*[A-Z]{2,4})\s?(\d{3})\b\s*(.*)$/;

function headerCourse(group: RawProgramGroup, byCode: CatalogRowLookup): RawProgramCourse | null {
  if ((group.courses?.length ?? 0) > 0) return null;
  const m = (group.label ?? '').trim().match(HEADER_CODE);
  if (!m) return null;
  const codes = m[1]
    .split('/')
    .map((subject) => `${subject.trim()} ${m[2]}`)
    .filter((code) => byCode.get(code) !== undefined);
  if (codes.length === 0) return null;
  const title = m[3].replace(/\s+\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*$/, '').trim();
  return {
    code: codes[0],
    title: title || (byCode.get(codes[0])?.title ?? ''),
    credits: group.hours ?? byCode.get(codes[0])?.credits ?? null,
    ...(codes.length > 1 ? { or: codes.slice(1) } : {}),
  };
}

/** The minor's tables with each heading course made a row (shape a), and which courses those were. */
function withHeaderCourses(areas: RawProgramArea[], byCode: CatalogRowLookup): { areas: RawProgramArea[]; read: string[] } {
  const read: string[] = [];
  const out = areas.map((area) => ({
    ...area,
    groups: area.groups.map((group) => {
      const course = headerCourse(group, byCode);
      if (!course) return group;
      read.push(`(a) ${course.code}`);
      // The heading's words become the course's title; the group keeps no
      // label, so nothing reads the course number as a count or a level.
      return {
        ...group,
        label: course.title,
        choose: null,
        chooseFrom: null,
        hours: course.credits,
        summedCredits: course.credits ?? 0,
        kind: 'all' as const,
        courses: [course],
      };
    }),
  }));
  return { areas: out, read };
}

/** A level phrase, the shape the degree reader's level rule handles ("300- or 400-level"). */
const LEVEL_PHRASE = /\b[1-4]00\s*-?\s*(?:or|to|and|\/|,)?\s*(?:[1-4]00\s*-?\s*)?level\b/i;
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, eighteen: 18,
};
const SUBJECT_NAME_TO_PREFIX = new Map(
  Object.entries(ILLINOIS_SUBJECT_NAMES).map(([prefix, name]) => [name.toLowerCase().replace(/-+/g, ' '), prefix] as const),
);

/**
 * The subjects a phrase names, written as prefixes ("CPSC, HORT, or PLPA",
 * "MUS or MUSC") or as one department's name ("Spanish"). Prefixes must be
 * capitals and real subjects; a name must match a department's name whole.
 */
function subjectsIn(phrase: string): string[] {
  const out = new Set<string>();
  for (const m of phrase.matchAll(/\b([A-Z]{2,4})\b(?!\s?\d{3})/g)) {
    if (ILLINOIS_SUBJECT_NAMES[m[1]] !== undefined) out.add(m[1]);
  }
  if (out.size === 0) {
    const name = phrase.replace(/\s+/g, ' ').trim().toLowerCase();
    const prefix = SUBJECT_NAME_TO_PREFIX.get(name);
    if (prefix) out.add(prefix);
  }
  return [...out];
}

export interface SubjectHours {
  hours: number | null;
  subjects: string[];
  excluded: string[];
  sentence: string;
}

/**
 * (c) "N hours of SUBJ": hours of any course in one or more subjects.
 *
 *   "Select a minimum of 9 hours from any HORT courses (excluding HORT 393 and HORT 395)."
 *   "Students complete 6 hours of AAS coursework (a minimum of 3 hours must be at the 300- or 400-level)"
 *   "Select 3 hours from any CPSC, HORT, or PLPA course (excluding ...)"
 *   "Any MUS or MUSC course may satisfy elective credits, however, ..."
 *
 * An aside in parentheses is an aside, except for its exclusions. A sentence
 * that still names a level once the asides are gone ("Six hours of 300- or
 * 400-level courses in Anthropology") is the level shape, not this one, and
 * is left to the degree reader. Exported for the check.
 */
export function subjectHoursIn(text: string): SubjectHours | null {
  for (const raw of (text ?? '').replace(/\s+/g, ' ').split(/(?<=\.)\s+/)) {
    const main = raw.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!main || LEVEL_PHRASE.test(main) || /\b[1-4]XX\b/i.test(main)) continue;
    // "N hours of/from/in [any] [additional] SUBJECTS course(s)/coursework/electives"
    const sized = main.match(
      /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen)\s+(?:additional\s+)?(?:credit\s+|semester\s+)?hours?\s+(?:of|from|in)\s+(?:any\s+)?(?:additional\s+)?((?:[A-Z]{2,4}(?:,\s*|\s+or\s+|\s+and\s+|,\s*or\s+|\s*\/\s*))*[A-Z]{2,4}|[A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\s+(?:[Cc]ourses?|[Cc]oursework|[Cc]ourse work|[Ee]lectives?)\b/,
    );
    const any = sized ? null : main.match(/^Any\s+((?:[A-Z]{2,4}(?:,\s*|\s+or\s+|\s*\/\s*))*[A-Z]{2,4})\s+course\b/);
    const phrase = sized?.[2] ?? any?.[1];
    if (!phrase) continue;
    const subjects = subjectsIn(phrase);
    if (subjects.length === 0) continue;
    const n = sized ? (NUMBER_WORDS[sized[1].toLowerCase()] ?? Number(sized[1])) : null;
    const excluded = new Set<string>();
    const exceptAt = raw.search(/\b(?:excluding|except|not including|other than)\b/i);
    if (exceptAt >= 0) {
      for (const m of raw.slice(exceptAt).matchAll(/\b([A-Z]{2,4})\s?(\d{3})\b/g)) excluded.add(`${m[1]} ${m[2]}`);
    }
    return { hours: n, subjects, excluded: [...excluded], sentence: raw.trim() };
  }
  return null;
}

/** Every undergraduate catalog course in the subjects, less the ones the minor already names or rules out. */
function subjectPool(rule: SubjectHours, byCode: CatalogRowLookup, named: Set<string>): CourseChoice[] {
  if (typeof byCode.values !== 'function') return [];
  const subjects = new Set(rule.subjects);
  const excluded = new Set(rule.excluded.map(normCode));
  const out: CourseChoice[] = [];
  for (const row of byCode.values()) {
    const code = normCode(row.code);
    const [subject, number] = code.split(' ');
    if (!subjects.has(subject) || !(Number(number) < 500)) continue;
    if (excluded.has(code) || named.has(code) || (row.credits ?? 0) < 1) continue;
    out.push({ codes: [code], title: row.title, credits: row.credits, creditsMax: row.creditsMax ?? null, substitutes: [] });
  }
  out.sort((a, b) => a.codes[0].localeCompare(b.codes[0]));
  return out;
}

/** The fewest credit hours one row of a requirement can be met with, by the page's cell or the catalog. */
function choiceHours(choice: CourseChoice, byCode: CatalogRowLookup): number {
  const catalog = (code: string) => byCode.get(normCode(code))?.credits ?? null;
  const options: number[] = [];
  if (choice.bundles && choice.bundles.length > 0) {
    for (const set of choice.bundles) options.push(set.reduce((n, code) => n + (catalog(code) ?? 0), 0));
  } else {
    choice.codes.forEach((code, i) => {
      const hours = i === 0 ? (choice.credits ?? catalog(code)) : catalog(code);
      if (hours !== null) options.push(hours);
    });
  }
  return options.length > 0 ? Math.min(...options) : 0;
}

/**
 * The fewest hours that meet every requirement of a minor as it was read.
 *
 * This is how a catalog counts a minor's total: the page's "Total Hours 17"
 * for Statistics is 3 + 3 + 2 + 3 + 6, each list at its smallest course,
 * even though a student who takes the 4-hour STAT 107 ends up with more. So a
 * reading is right when this number is the page's total; a reading that
 * takes three tracks instead of one, or drops a sentence's 6 hours, is not.
 * A quoted sentence the reader could not act on adds nothing, and neither
 * do hours that name no course or subject, which is why a minor with either
 * is short.
 */
export function readingHours(blocks: RequirementBlock[], byCode: CatalogRowLookup): number {
  let total = 0;
  for (const block of blocks) {
    const rule = block.rule;
    // Hours with no course, subject or gen-ed category named are hours the
    // plan fills with whatever fits. A minor has no free hours, so they are
    // not a reading of the page and count for nothing here.
    if (rule.kind === 'hours' && (rule.genEd?.length ?? 0) > 0) total += rule.hours;
    if (rule.kind !== 'all' && rule.kind !== 'choose' && rule.kind !== 'pool') continue;
    const each = rule.choices.map((c) => choiceHours(c, byCode)).sort((a, b) => a - b);
    const all = each.reduce((n, h) => n + h, 0);
    if (rule.kind === 'all') total += all;
    else if (rule.kind === 'choose') total += each.slice(0, rule.n).reduce((n, h) => n + h, 0);
    else {
      const counted = rule.n !== null ? each.slice(0, rule.n).reduce((n, h) => n + h, 0) : 0;
      // A pool cannot ask for more than its courses add up to.
      total += Math.min(all, Math.max(rule.hours ?? 0, counted));
    }
  }
  return Math.round(total * 10) / 10;
}

/** A teacher-education minor: licensure rules a course plan cannot show. */
const TEACHER_EDUCATION = /\bteacher[- ]education\b|\bcommunity[- ]based[- ]art[- ]education\b/i;

export function adaptIllinoisMinor(raw: RawIllinoisMinor, byCode: CatalogRowLookup, options: MinorReadOptions = {}): MinorReading {
  const shapes = options.shapes !== false;
  const readings: string[] = [];
  let areas = raw.areas ?? [];
  if (shapes) {
    const headed = withHeaderCourses(areas, byCode);
    areas = headed.areas;
    readings.push(...headed.read);
  }
  const total =
    raw.totalCredits !== null && raw.totalCredits >= MINOR_TOTAL_MIN && raw.totalCredits <= MINOR_TOTAL_MAX ? raw.totalCredits : null;
  // The degree reader, given the minor's own total: an area's cap is what the
  // rest of the minor leaves it, exactly as it is for a degree.
  const byArea = requirementRulesForProgram({ areas, totalCredits: total }, byCode);

  const named = new Set<string>();
  for (const area of areas) for (const group of area.groups ?? []) for (const row of group.courses ?? []) {
    named.add(normCode(row.code));
    for (const alt of row.or ?? []) named.add(normCode(alt));
  }

  const id = `${MINOR_ID_PREFIX}${raw.id}`;
  const blocks: RequirementBlock[] = [];
  areas.forEach((area, ai) => {
    for (const block of byArea[ai]?.blocks ?? []) {
      let rule: RequirementRule = block.rule;
      let hours = block.hours;
      let note = block.note;
      const group = area.groups[block.groupIndex];
      // (c) only for a group with no course rows, whose hours the reader kept with no subject.
      if (shapes && (rule.kind === 'hours' || rule.kind === 'unparsed') && group && (group.courses?.length ?? 0) === 0) {
        const said = subjectHoursIn([group.label, group.note ?? ''].filter(Boolean).join('. '));
        const size = rule.kind === 'hours' ? rule.hours : said?.hours ?? null;
        if (said && size) {
          const choices = subjectPool(said, byCode, named);
          if (choices.length > 0) {
            const label = block.label || area.label || '';
            rule = {
              kind: 'pool',
              hours: size,
              n: null,
              choices,
              lists: [{ label: `${said.subjects.join('/')} courses`, codes: choices.flatMap((c) => c.codes) }],
              constraints: [],
              from: 'group',
              label,
            };
            hours = size;
            note = said.sentence;
            readings.push(`(c) ${size} hours of ${said.subjects.join('/')}`);
          }
        }
      }
      blocks.push({
        id: `${id}::${ai}::${block.groupIndex}${block.idSuffix ? `::${block.idSuffix}` : ''}`,
        areaId: `${id}::${ai}`,
        areaLabel: area.label,
        label: block.label || area.label || '',
        hours,
        hoursMax: null,
        rule,
        note,
        url: raw.url,
      });
    }
  });

  return {
    id,
    catalogId: raw.id,
    name: raw.name,
    college: raw.college,
    url: raw.url,
    totalCredits: total,
    blocks,
    readings,
    teacherEducation: TEACHER_EDUCATION.test(`${raw.id} ${raw.name}`),
    readAsOneList:
      total !== null &&
      blocks.some((b) => {
        if (b.rule.kind !== 'pool' || (b.rule.hours ?? 0) < total - 1) return false;
        const [ai, gi] = b.id.slice(id.length + 2).split('::').map(Number);
        return (areas[ai]?.groups[gi]?.comments?.length ?? 0) > 0;
      }),
  };
}

/** Every minor in the crawl, read. */
export function adaptIllinoisMinors(file: RawMinorFile, byCode: CatalogRowLookup, options: MinorReadOptions = {}): MinorReading[] {
  return (file.minors ?? []).filter((m) => m?.id).map((m) => adaptIllinoisMinor(m, byCode, options));
}

// ---------------------------------------------------------------------------
// What the planner offers (2026-10-13)
// ---------------------------------------------------------------------------

/** A teacher-education minor (licensure rules a plan cannot show), by its catalog id and name. Never offered. */
export function isTeacherEducationMinor(raw: { id: string; name: string }): boolean {
  return TEACHER_EDUCATION.test(`${raw.id} ${raw.name}`);
}

/** Whether the planner plans this minor beside a degree: it is on the beta list. */
export function minorIsChecked(catalogId: string): boolean {
  return MINOR_BETA.includes(catalogId);
}

/** What a picker shows for an unchecked minor, after its name. */
export const NOT_CHECKED_TAG = '(not checked yet)';

export interface IllinoisMinorOption {
  /** "minor:las/minors/statistics". */
  id: string;
  name: string;
  totalCredits: number | null;
  /** Hours the minor adds at most, for onboarding's estimate: its stated total, or 18. */
  additionalCredits: number;
  /** Planned beside the degree (the beta list); otherwise shown with its page and not planned. */
  checked: boolean;
}

/**
 * Every Illinois minor a student can pick: all of the catalog's but the
 * teacher-education ones. The ones the planner has checked are planned
 * beside the degree; the rest are named as not checked yet, here and on the
 * board, and nothing of theirs is planned.
 */
export function illinoisMinorOptions(file: RawMinorFile | null | undefined): IllinoisMinorOption[] {
  return (file?.minors ?? [])
    .filter((m) => m?.id && !isTeacherEducationMinor(m))
    .map((m) => {
      const checked = minorIsChecked(m.id);
      const total = m.totalCredits !== null && m.totalCredits >= MINOR_TOTAL_MIN && m.totalCredits <= MINOR_TOTAL_MAX ? m.totalCredits : null;
      return {
        id: `${MINOR_ID_PREFIX}${m.id}`,
        name: checked ? m.name : `${m.name} ${NOT_CHECKED_TAG}`,
        totalCredits: total,
        additionalCredits: total ?? 18,
        checked,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The minor's name with the picker's tag taken off. */
export function minorDisplayName(name: string): string {
  return name.replace(` ${NOT_CHECKED_TAG}`, '');
}

const listCodes = (codes: string[], max = 6) =>
  codes.length <= max ? codes.join(', ') : `${codes.slice(0, max).join(', ')} and ${codes.length - max} more`;

/**
 * What a minor asks for, in the planner's own words: the page's total, the
 * courses it names and how the rows group them. Built from the reading, not
 * the page's prose, and said as a summary to check against the page, never
 * as the rule itself. Used for a minor the planner has not checked, where it
 * is all the board says about it.
 */
export function minorInOwnWords(reading: MinorReading): string {
  const parts: string[] = [];
  parts.push(reading.totalCredits !== null ? `${reading.totalCredits} hours in all, by its page` : 'its page states no total');
  const required: string[] = [];
  let sentences = 0;
  for (const block of reading.blocks) {
    const rule = block.rule;
    if (rule.kind === 'all') required.push(...rule.choices.map((c) => c.codes.join(' or ')));
    else if (rule.kind === 'choose') parts.push(`${rule.n} of ${listCodes(rule.choices.map((c) => c.codes[0]))}`);
    else if (rule.kind === 'pool') {
      const size = rule.hours !== null ? `${rule.hours} hours` : rule.n !== null ? `${rule.n} courses` : 'some courses';
      parts.push(`${size} from a list of ${rule.choices.length} (${listCodes(rule.choices.map((c) => c.codes[0]), 4)})`);
    } else if (rule.kind === 'hours') parts.push(`${rule.hours} more hours described in words on the page`);
    else sentences += 1;
  }
  if (required.length > 0) parts.splice(1, 0, `required: ${listCodes(required, 8)}`);
  if (sentences > 0) parts.push(`${sentences} requirement${sentences === 1 ? '' : 's'} written as sentences`);
  return `${parts.join('; ')}.`;
}

/**
 * Why the planner has not checked a minor yet, in a short phrase, from the
 * same tests the beta list is built with (__minors.check.mjs). A minor read
 * right whose trial plan did not match the page gets the last phrase.
 */
export function whyNotChecked(reading: MinorReading, byCode: CatalogRowLookup): string {
  if (isTeacherEducationMinor({ id: reading.catalogId, name: reading.name })) return 'it is a teacher-education minor with licensure rules a course plan cannot show';
  const held = MINORS_HELD_FROM_BETA[reading.catalogId];
  if (held) return held;
  if (reading.totalCredits === null) return 'its page states no total to check a reading against';
  if (reading.readAsOneList) return 'its page splits one table into separate choices, which the planner reads as one list';
  const read = readingHours(reading.blocks, byCode);
  if (read < reading.totalCredits - 1) return 'part of it is written in sentences the planner cannot read yet';
  if (read > reading.totalCredits + 1) return 'it has tracks or one table per kind of major, which the planner reads as all required';
  return "the planner's trial plan of it did not match its page";
}
