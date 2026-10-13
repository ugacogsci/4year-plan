import type {
  CatalogRowLookup,
  CourseChoice,
  RawProgramArea,
  RawProgramGroup,
  RequirementBlock,
  RequirementRule,
} from './illinois-data.ts';
import { requirementRulesForProgram } from './illinois-data.ts';
import { ILLINOIS_SUBJECT_NAMES } from './illinois-subjects.ts';
import type { ProgramRequirements, RequirementArea, RequirementGroup } from './scheduler.ts';
import type { PrereqSpec, SectionSummary } from './illinois-data.ts';
import type { IllinoisCore, IllinoisIndexRow, IllinoisOfferingsFile, IllinoisSectionsFile } from './illinois-load.ts';
import { applyOfferings, hydrateIndexRow } from './illinois-load.ts';

/**
 * Illinois graduate and professional programs, read for a plan (not switched on yet).
 *
 * scripts/illinois/graduate.mjs crawls the catalog's graduate index pages into
 * public/illinois/graduate/crawl.json with the degree crawler's own table
 * parser, and scripts/illinois/graduate-build.mjs writes the menu
 * (graduate/programs.json), one file per page (graduate/program/<id>.json) and
 * the 500-level-and-up course list the readings need (graduate/courses.json,
 * graduate/prereqs.json, graduate/sections*.json).
 *
 * This module turns one page into requirement blocks the engine can plan, the
 * way illinois-minors.ts does for a minor, and the result has the shapes the
 * planner already uses for Cameron's UGA graduate programs: a ProgramOption
 * for the onboarding menus (graduateProgramOptions) and, for the board, the
 * same { summary, program, blocks, url } a loaded Illinois degree has. So
 * switching Illinois graduate plans on is a set of small edits in onboarding
 * and the workspace (keep-planner/ill-graduate/connect.md), not new engine work.
 *
 * Differences from a degree, each because a graduate page is not a bachelor's:
 *
 *   - No campus general education and no language requirement. The degree
 *     adapter appends the campus gen-ed table (withCampusGenEd) to every page;
 *     nothing here does, and any gen-ed or language block the shared reader
 *     makes from a graduate label is dropped.
 *   - The page's own total (32, 64, 96...), never the 100-to-200 clamp.
 *   - Options. A page that prints thesis and non-thesis, or entering with a
 *     bachelor's and with a master's, as separate tables gives one reading per
 *     option, each with its own total. They are alternatives, never summed.
 *   - Hour buckets. "12 hours chosen from CS 500 - CS 590", "Additional
 *     500-level course work 4", "Elective courses 0-8" are read here: a range
 *     or a subject and level becomes a pool of catalog courses; a level alone
 *     an hours block with that level as the floor; electives an elective
 *     block; anything else hours the student fills with an advisor. A range
 *     ("0-8", "12-16") is sized to what the page's total leaves.
 *   - Every id starts with "grad:", so a graduate block can never collide with
 *     or be mistaken for an undergraduate one.
 *
 * Whether a reading "reads right" is measured, not assumed: the fewest hours
 * that meet every block (readingHours) must be the page's stated total, within
 * one. A page with no stated total, with a block the reader could only quote,
 * or with nothing read is "not yet checked", and says why in plain words.
 */

export const GRAD_ID_PREFIX = 'grad:';
/** Between a page id and an option number: "grad:las/history-ma~2". */
export const GRAD_OPTION_SEPARATOR = '~';

export type GraduateKind = 'masters' | 'doctoral' | 'other' | 'certificate' | 'minor' | 'professional' | 'concentration';

/** A bucket group as graduate.mjs writes it: a row with hours and no course code. */
export interface RawGraduateGroup extends RawProgramGroup {
  bucket?: boolean;
  hoursMax?: number | null;
  hoursText?: string | null;
  /** Set by joinListsToHours on a group whose rows another group took over (its place is kept, empty). */
  joined?: boolean;
  /** Set by joinListsToHours on a list tab nothing points at: a menu with no size. */
  listOnly?: boolean;
}

export interface RawGraduateArea extends Omit<RawProgramArea, 'groups'> {
  groups: RawGraduateGroup[];
  labelKnown?: boolean;
  /** A table printed after the last option's total, which every option draws on: a list, not requirements. */
  trailing?: boolean;
}

export interface RawGraduateOption {
  /** The option's own heading ("Thesis Option"), or null when the page offers no choice. */
  label: string | null;
  totalCredits: number | null;
  /** The top of a stated range ("44-56"), when there is one. */
  totalMax: number | null;
  areas: RawGraduateArea[];
}

export interface RawGraduateRules {
  min500Hours: number | null;
  min500Text: string | null;
  minGpa: number | null;
  totalCredits: number | null;
  campusHours: number | null;
  maxTermHours: number | null;
  concentrationRequired: boolean | null;
  nonThesisOnly: boolean;
  thesisOnly: boolean;
  length: GraduateLength | null;
  maxTransferHours: number | null;
}

export interface GraduateLength {
  value: number;
  unit: string;
  /** 'typical' the page's usual length, 'within' a time limit, 'residence' semesters on campus, 'minimum' a floor. */
  kind: 'typical' | 'within' | 'residence' | 'minimum';
}

export interface GraduateFact {
  /** Our own words. Never the page's sentences. */
  text: string;
  url: string;
}

export interface RawGraduateProgram {
  /** The catalog path without /graduate/: "las/history-ma"; professional pages keep "professional/law-jd". */
  id: string;
  kind: GraduateKind;
  college: string;
  name: string;
  /** As the page's name prints it: "MS", "PhD", "MCS", "GCRT" for a certificate, "MINOR" for a graduate minor. */
  degree: string | null;
  url: string;
  shape: 'tables' | 'rules-only' | 'prose-only' | 'none';
  options: RawGraduateOption[];
  rules: RawGraduateRules;
  thesis: 'both' | 'thesis' | 'non-thesis' | null;
  typicalLength: GraduateLength | null;
  concentrations: Array<{ id: string; name: string }>;
  /** For a concentration page: the degrees it was read for. */
  parents?: string[];
  /** Set by menuPages on a concentration page offered as its degree: the degree's page id. */
  concentrationOf?: string;
  courseCount: number;
  facts: GraduateFact[];
}

export interface RawGraduateFile {
  school: string;
  source: string;
  fetchedAt: string;
  programs: RawGraduateProgram[];
  skipped?: Array<{ path: string; why: string }>;
}

export type GraduateStatus = 'reads right' | 'not yet checked';

export interface GraduateReading {
  /** "grad:" and the page id, and "~n" for the nth option of a page that offers several. */
  id: string;
  pageId: string;
  optionIndex: number | null;
  optionLabel: string | null;
  /** "History, MA" or "History, MA: Thesis Option". */
  name: string;
  kind: GraduateKind;
  degree: string | null;
  college: string;
  url: string;
  totalCredits: number | null;
  blocks: RequirementBlock[];
  /** The fewest hours that meet every block (readingHours). */
  readHours: number;
  /** Of those, hours of courses the page names. */
  namedHours: number;
  /** Of those, hours the page sizes without naming courses (buckets, electives). */
  openHours: number;
  status: GraduateStatus;
  /** Plain words: why it reads right, or what is not checked yet. */
  why: string;
  /** Gen-ed or language blocks the shared reader made and this reader dropped. */
  droppedGenEd: number;
}

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const numberOf = (code: string) => Number(normCode(code).split(' ')[1] ?? NaN);
const subjectOf = (code: string) => normCode(code).split(' ')[0] ?? '';

/** Catalog rows with the flag graduate-build.mjs adds to thesis, independent-study and similar rows. */
type GradRow = { code: string; title: string; credits: number; creditsMax?: number | null; noise?: boolean };

function rowsOf(byCode: CatalogRowLookup): GradRow[] {
  if (typeof byCode.values !== 'function') return [];
  return [...byCode.values()] as GradRow[];
}

const SUBJECT_NAME_TO_PREFIX = new Map(
  Object.entries(ILLINOIS_SUBJECT_NAMES).map(([prefix, name]) => [name.toLowerCase().replace(/-+/g, ' '), prefix] as const),
);

/** Subject prefixes a bucket's words name: capitals that are real subjects ("CS", "ECE"), or a department written out ("history"). */
export function subjectsNamed(textValue: string): string[] {
  const out = new Set<string>();
  for (const m of textValue.matchAll(/\b([A-Z]{2,4})\b(?!\s?\d{3})/g)) {
    if (ILLINOIS_SUBJECT_NAMES[m[1]] !== undefined) out.add(m[1]);
  }
  if (out.size === 0) {
    const lower = ` ${textValue.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ')} `;
    for (const [name, prefix] of SUBJECT_NAME_TO_PREFIX) {
      if (name.length >= 5 && lower.includes(` ${name} `)) out.add(prefix);
    }
  }
  return [...out];
}

/** Codes a note rules out: "Does not include CS 597 nor CS 591", "excluding STAT 590". */
function excludedIn(note: string): Set<string> {
  const out = new Set<string>();
  const at = note.search(/\b(?:not include|does not include|excluding|except|other than|not count)\b/i);
  if (at < 0) return out;
  for (const m of note.slice(at).matchAll(/\b([A-Z]{2,4})\s?(\d{3})\b/g)) out.add(`${m[1]} ${m[2]}`);
  return out;
}

export interface BucketReading {
  kind: 'range' | 'subject-level' | 'course' | 'level' | 'elective' | 'open';
  rule: RequirementRule;
}

const ELECTIVE = /\belectives?\b/i;

/**
 * One hour bucket, read.
 *
 *   range          "chosen from CS 500 - CS 590 and CS 598": the subject's
 *                  courses in the range, and the single codes named beside it
 *   subject-level  "500-level CS course work", "Two additional 500-level
 *                  courses in history": the subject's courses at that level
 *   course         a row naming exactly one catalog course and no level
 *                  ("Professional Development: ECE 596 Master's Project")
 *   level          "Additional 500-level course work": hours at that level
 *                  or above, any subject
 *   elective       "Elective courses": hours of graduate-level electives
 *   open           anything else ("Breadth Requirement"): hours the page
 *                  sizes and names no courses for, filled with an advisor
 *
 * Exported for the check.
 */
export function readBucket(label: string, note: string, hours: number, byCode: CatalogRowLookup): BucketReading {
  const words = `${label}`.replace(/\s+/g, ' ');
  const excluded = excludedIn(`${label} ${note}`);
  const all = rowsOf(byCode);
  const choicesOf = (rows: GradRow[]): CourseChoice[] =>
    rows
      .filter((r) => !excluded.has(normCode(r.code)) && (r.creditsMax ?? r.credits ?? 0) > 0)
      .sort((a, b) => normCode(a.code).localeCompare(normCode(b.code)))
      .map((r) => ({ codes: [normCode(r.code)], title: r.title, credits: r.credits, creditsMax: r.creditsMax ?? null, substitutes: [] }));
  const pool = (choices: CourseChoice[], listLabel: string): RequirementRule => ({
    kind: 'pool',
    hours,
    n: null,
    choices,
    lists: [{ label: listLabel, codes: choices.flatMap((c) => c.codes) }],
    constraints: [],
    from: 'group',
    label,
  });

  // A range of numbers in one subject, and the single codes beside it.
  const ranges = [...words.matchAll(/\b([A-Z]{2,4})\s?(\d{3})\s*(?:-|–|to|through)\s*(?:([A-Z]{2,4})\s?)?(\d{3})\b/g)].filter((m) => !m[3] || m[3] === m[1]);
  if (ranges.length > 0) {
    const covered = new Set<string>();
    const rows: GradRow[] = [];
    for (const m of ranges) {
      const lo = Number(m[2]);
      const hi = Number(m[4]);
      for (const r of all) {
        const code = normCode(r.code);
        if (subjectOf(code) === m[1] && numberOf(code) >= lo && numberOf(code) <= hi && !r.noise) { rows.push(r); covered.add(code); }
      }
    }
    const rangeText = ranges.map((m) => m[0]).join(' ');
    for (const m of words.replace(rangeText, ' ').matchAll(/\b([A-Z]{2,4})\s?(\d{3})\b/g)) {
      const code = `${m[1]} ${m[2]}`;
      const row = byCode.get(code);
      if (row && !covered.has(code)) { rows.push({ code, ...row }); covered.add(code); }
    }
    const choices = choicesOf(rows);
    if (choices.length > 0) return { kind: 'range', rule: pool(choices, ranges.map((m) => m[0].replace(/\s+/g, ' ')).join(', ')) };
  }

  const level = words.match(/\b([4-7])00\s*-?\s*(?:or\s*[4-7]00\s*-?\s*)?level\b|\b([4-7])00[- ]level\b/i);
  const levelMin = level ? Number(level[1] ?? level[2]) * 100 : null;
  const twoLevels = /\b400\s*-?\s*or\s*500\s*-?\s*level\b/i.test(words);
  const floor = twoLevels ? 400 : levelMin;
  const subjects = subjectsNamed(words);
  if (floor !== null && subjects.length > 0) {
    // "500-level" is 500 to 599, "400- or 500-level" 400 to 599, "600-level" (law, veterinary medicine) 600 to 699.
    const top = floor >= 500 ? floor + 100 : 600;
    const rows = all.filter((r) => subjects.includes(subjectOf(r.code)) && numberOf(r.code) >= floor && numberOf(r.code) < top && !r.noise);
    const choices = choicesOf(rows);
    if (choices.length > 0) return { kind: 'subject-level', rule: pool(choices, `${subjects.join('/')} ${floor}-level courses`) };
  }

  const codes = [...words.matchAll(/\b([A-Z]{2,4})\s?(\d{3})\b/g)].map((m) => `${m[1]} ${m[2]}`).filter((c) => byCode.get(c) !== undefined);
  if (floor === null && new Set(codes).size === 1) {
    const code = codes[0];
    const row = byCode.get(code)!;
    return {
      kind: 'course',
      rule: { kind: 'all', choices: [{ codes: [code], title: row.title, credits: hours, creditsMax: row.creditsMax ?? null, substitutes: [] }] },
    };
  }

  if (floor !== null) return { kind: 'level', rule: { kind: 'hours', source: 'catalog', hours, genEd: null, label, minLevel: floor } };
  if (ELECTIVE.test(words)) return { kind: 'elective', rule: { kind: 'hours', source: 'explicit-elective', hours, genEd: null, label, minLevel: 400 } };
  return { kind: 'open', rule: { kind: 'hours', source: 'catalog', hours, genEd: null, label, minLevel: 400 } };
}

/** The fewest credit hours one row can be met with, by the page's cell or the catalog. */
function choiceHours(choice: CourseChoice, byCode: CatalogRowLookup): number {
  const catalog = (code: string) => byCode.get(normCode(code))?.credits ?? null;
  const options: number[] = [];
  if (choice.bundles && choice.bundles.length > 0) {
    for (const set of choice.bundles) options.push(set.reduce((n, code) => n + (catalog(code) ?? 0), 0));
  } else {
    choice.codes.forEach((code, i) => {
      const h = i === 0 ? (choice.credits ?? catalog(code)) : catalog(code);
      if (h !== null) options.push(h);
    });
  }
  return options.length > 0 ? Math.min(...options) : 0;
}

/**
 * The fewest hours that meet every block of a reading.
 *
 * As for a minor (illinois-minors.ts), except that an hours block counts: on
 * a graduate page "12 hours of 500-level course work" or "Electives 0-8" is
 * part of the degree's own total, where on a minor unnamed hours are not.
 */
export function readingHours(blocks: RequirementBlock[], byCode: CatalogRowLookup): { total: number; named: number; open: number } {
  let named = 0;
  let open = 0;
  for (const block of blocks) {
    const rule = block.rule;
    if (rule.kind === 'hours') {
      // A parser gap is hours the reading did not find, not a reading of them.
      if (rule.source !== 'parser-gap') open += rule.hours;
      continue;
    }
    if (rule.kind !== 'all' && rule.kind !== 'choose' && rule.kind !== 'pool') continue;
    const each = rule.choices.map((c) => choiceHours(c, byCode)).sort((a, b) => a - b);
    const sum = each.reduce((n, h) => n + h, 0);
    // A row group's own hours cell is the page's size for it ("Medicine - Project
    // Course: choose one, 12"), which a course's catalog low end can understate.
    const stated = block.hours ?? 0;
    if (rule.kind === 'all') named += Math.max(sum, stated);
    else if (rule.kind === 'choose') named += Math.max(each.slice(0, rule.n).reduce((n, h) => n + h, 0), stated);
    else {
      const counted = rule.n !== null ? each.slice(0, rule.n).reduce((n, h) => n + h, 0) : 0;
      const size = Math.min(sum, Math.max(rule.hours ?? 0, counted));
      // A pool read from a bucket's subject or range names no course; its hours are open.
      if (block.id.includes('::b')) open += size;
      else named += size;
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return { total: round(named + open), named: round(named), open: round(open) };
}

/** The page's name, with the option's heading when the page offers several. */
function readingName(raw: RawGraduateProgram, option: RawGraduateOption): string {
  const base = raw.name.replace(/\s+/g, ' ').trim();
  if (!option.label || raw.options.length < 2) return base;
  const label = option.label.replace(/\s+/g, ' ').replace(/:$/, '').trim();
  return `${base}: ${label.length > 70 ? `${label.slice(0, 67)}...` : label}`;
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** A row that explains the bucket row above it rather than adding hours. */
const EXPLAINS = /^(?:selected|students (?:must|may|will)|chosen|choose|select|taken|courses (?:must|may)|must be|with approval|in consultation)/i;

const rowHours = (row: { code: string; credits: number | null }, byCode: CatalogRowLookup) =>
  row.credits ?? byCode.get(normCode(row.code))?.credits ?? 0;

/** A group that states nothing: courses, and no hours, count or heading words of its own. */
const silentList = (g: RawGraduateGroup) => (g.courses?.length ?? 0) > 0 && g.hours == null && g.choose == null;

/**
 * Two ways graduate pages print "N hours from these lists", put back together
 * before anything is read:
 *
 *   (h) a heading row with hours over lists that state nothing ("Fundamental
 *       Courses 12", then "Statistics and Data Science", "Engineering Math"
 *       and "Life Sciences" lists on Bioengineering MS): the lists are what
 *       the 12 hours come from, so they become one list of that size. Only
 *       when the lists carry more than the hours (taking every row would
 *       overshoot them).
 *   (t) an hours row whose courses are on a list tab further down ("Foundations
 *       Hours 8" and the "Foundations Course List" table on the Education EdM
 *       pages): the list becomes that row's courses, matched by the row's
 *       first word in the list's heading. A list tab nothing points at is a
 *       menu with no size, never a list of courses to take.
 *
 * Exported for the check.
 */
export function joinListsToHours(areas: RawGraduateArea[], byCode: CatalogRowLookup): { areas: RawGraduateArea[]; read: string[] } {
  const read: string[] = [];
  // (c) "Two courses chosen from the following: 8" heading every row of its
  // group, which carry more than 8 hours: a list of that size, not rows to take.
  for (const area of areas) {
    for (const g of area.groups) {
      const comments = g.comments ?? [];
      const head = comments.length === 1 ? comments[0] : null;
      const size = head?.hours ?? null;
      if (!head || head.at !== 0 || size === null || size <= 0) continue;
      if ((g.courses?.length ?? 0) < 2 || g.choose != null || g.hours != null) continue;
      const carried = g.courses.reduce((n, c) => n + rowHours(c, byCode), 0);
      if (carried <= size + 0.5) continue;
      const count = head.text.match(/^\s*(?:choose |select |take |complete )?(one|two|three|four|five|six|\d)\b/i)?.[1];
      const n = count ? (WORD_NUMBERS[count.toLowerCase()] ?? Number(count)) : null;
      Object.assign(g, { hours: size, choose: n, kind: n ? 'choose' : 'menu', label: g.label || head.text, comments: [], note: '' });
      read.push(`(c) ${head.text}`);
    }
  }
  const out: RawGraduateArea[] = areas.map((area) => {
    const groups: RawGraduateGroup[] = [];
    // A bucket row explained by the next row with the same hours ("Technical
    // Elective Courses 12", then "Selected in consultation with advisor 12"):
    // one requirement, not two. The second row's place stays, empty.
    const src = area.groups.map((g, i, all) => {
      const prev = all[i - 1];
      // A heading row sized like the one bucket under it ("Additional Coursework 3",
      // then "Elective 400-level CS course 3"): the bucket says what the heading's hours are.
      const next = all[i + 1];
      if (!g.bucket && (g.courses?.length ?? 0) === 0 && (g.hours ?? 0) > 0 && next?.bucket && next.hours === g.hours && !all[i + 2]?.bucket && !(all[i + 2] && silentList(all[i + 2]))) {
        read.push(`(e) ${g.label}: ${next.label}`);
        return { ...g, courses: [], label: '', note: '', comments: [], kind: 'unknown' as const, hours: null, joined: true } as RawGraduateGroup;
      }
      if (g.bucket && prev && (prev.courses?.length ?? 0) === 0 && (prev.hours ?? 0) > 0 && prev.hours === g.hours && EXPLAINS.test((g.label ?? '').trim())) {
        prev.note = [prev.note, g.label].filter(Boolean).join(' ');
        read.push(`(e) ${prev.label}: ${g.label}`);
        const empty: RawGraduateGroup = { ...g, courses: [], label: '', note: '', comments: [], kind: 'unknown', hours: null, joined: true };
        return empty;
      }
      return g;
    });
    for (let i = 0; i < src.length; i += 1) {
      const g = src[i];
      const headed = (g.courses?.length ?? 0) === 0 && (g.hours ?? 0) > 0 && !g.joined && !/^(?:minimum\s+)?total\b/i.test((g.label ?? '').trim());
      if (headed) {
        let j = i + 1;
        const lists: RawGraduateGroup[] = [];
        const skipped: RawGraduateGroup[] = [];
        while (j < src.length && (src[j].joined || silentList(src[j]))) {
          if (src[j].joined) skipped.push(src[j]);
          else lists.push(src[j]);
          j += 1;
        }
        const carried = lists.flatMap((l) => l.courses).reduce((n, c) => n + rowHours(c, byCode), 0);
        if (lists.length > 0 && carried > (g.hours ?? 0) + 0.5) {
          groups.push({ ...g, bucket: false, courses: lists.flatMap((l) => l.courses), kind: 'menu', summedCredits: carried, comments: [] });
          for (const k of skipped) groups.push(k);
          // The lists' places stay, empty, so every other group keeps its index.
          for (const l of lists) groups.push({ ...l, courses: [], label: '', note: '', comments: [], kind: 'unknown', hours: null, joined: true } as RawGraduateGroup);
          read.push(`(h) ${g.label}: ${lists.length} lists`);
          i = j - 1;
          continue;
        }
      }
      groups.push(g);
    }
    return { ...area, groups };
  });

  // Names printed under "Students must choose a concentration 20" (MPH) are
  // the choices' names, not requirements: their courses are on their own pages.
  for (const area of out) {
    if (!area.groups.some((g) => (g.courses?.length ?? 0) === 0 && (g.hours ?? 0) > 0 && /\b(?:concentrations?|tracks?|specializations?)\b/i.test(g.label ?? ''))) continue;
    for (const g of area.groups) {
      const nameOnly = (g.courses?.length ?? 0) === 0 && g.hours == null && !(g.note ?? '').trim() && (g.comments ?? []).length === 0 && (g.label ?? '').trim().split(/\s+/).length <= 8 && !/\d/.test(g.label ?? '');
      if (nameOnly && (g.label ?? '').trim()) { read.push(`(n) ${g.label}`); g.joined = true; }
    }
  }

  for (const [ai, area] of out.entries()) {
    const listTab = /\blists?\b/i.test(area.label ?? '') || area.trailing === true;
    if (!listTab || area.hours != null || !area.groups.every((g) => g.hours == null && g.choose == null)) continue;
    const courses = area.groups.flatMap((g) => g.courses ?? []);
    if (courses.length === 0) continue;
    const words = (area.label ?? '').toLowerCase();
    let host: RawGraduateGroup | null = null;
    for (const other of out.slice(0, ai)) {
      for (const g of other.groups) {
        const first = (g.label ?? '').toLowerCase().match(/[a-z]{4,}/)?.[0];
        const sized = (g.courses?.length ?? 0) === 0 && (g.hours ?? 0) > 0;
        // Matched by the row's first word in the list's heading, or a row that
        // says its hours come from a menu or list ("Six credit hours taken from
        // the department's Course Menu") for a trailing list.
        if (sized && ((first && words.includes(first)) || (area.trailing && /\b(?:menu|list)\b/i.test(g.label ?? '')))) { host = g; break; }
      }
      if (host) break;
    }
    if (host && (host.courses?.length ?? 0) > 0) {
      // A second list for the same row adds to its courses.
      const extra = courses.filter((c) => !host!.courses.some((h) => h.code === c.code));
      host.courses = [...host.courses, ...extra];
      read.push(`(t) ${host.label}: ${area.label}`);
      out[ai] = { ...area, groups: area.groups.map((g) => ({ ...g, courses: [], kind: 'unknown', joined: true } as RawGraduateGroup)) };
      continue;
    }
    if (host) {
      Object.assign(host, { courses, kind: 'menu', bucket: false, summedCredits: courses.reduce((n, c) => n + rowHours(c, byCode), 0) });
      read.push(`(t) ${host.label}: ${area.label}`);
    } else {
      read.push(`(t) ${area.label}: a list nothing points at, read as a menu`);
    }
    out[ai] = { ...area, groups: area.groups.map((g) => ({ ...g, courses: host ? [] : g.courses, kind: host ? 'unknown' : 'menu', listOnly: !host, joined: Boolean(host) } as RawGraduateGroup)) };
  }
  return { areas: out, read };
}

/** One option of one page, read. */
export function adaptIllinoisGraduateOption(raw: RawGraduateProgram, optionIndex: number, byCode: CatalogRowLookup): GraduateReading {
  const option = raw.options[optionIndex];
  const several = raw.options.length > 1;
  const id = `${GRAD_ID_PREFIX}${raw.id}${several ? `${GRAD_OPTION_SEPARATOR}${optionIndex + 1}` : ''}`;
  const total = option?.totalCredits ?? null;
  const joined = joinListsToHours(structuredClone(option?.areas ?? []), byCode);
  const areas = joined.areas;

  // Buckets come out of the areas before the shared reader sees them, so it
  // never sizes a pool by an area cap the buckets already spend.
  type Bucket = { ai: number; gi: number; group: RawGraduateGroup; hours: number; max: number };
  const buckets: Bucket[] = [];
  const indexMap: number[][] = [];
  const forReader: RawProgramArea[] = areas.map((area, ai) => {
    const kept: RawProgramGroup[] = [];
    const map: number[] = [];
    area.groups.forEach((group, gi) => {
      if (group.joined) return;
      const isBucket = group.bucket || ((group.courses?.length ?? 0) === 0 && (group.hours ?? 0) > 0 && !/^(?:minimum\s+)?total\b/i.test((group.label ?? '').trim()));
      if (isBucket) {
        const hours = group.hours ?? 0;
        buckets.push({ ai, gi, group, hours, max: group.hoursMax ?? hours });
        return;
      }
      kept.push(group);
      map.push(gi);
    });
    indexMap.push(map);
    // An area that has buckets keeps no cap for the reader: a cap we computed
    // (the table's total less the buckets) would turn required rows into a
    // list to pick from whenever the page's own rows add up to more than it,
    // and the reading would then match the total by construction.
    const bucketMin = buckets.filter((b) => b.ai === ai).reduce((n, b) => n + b.hours, 0);
    const hours = bucketMin > 0 ? null : area.hours;
    return { ...area, hours, groups: kept } as RawProgramArea;
  });

  const bucketSum = buckets.reduce((n, b) => n + b.hours, 0);
  const readerTotal = bucketSum > 0 ? null : total;
  const byArea = requirementRulesForProgram({ areas: forReader, totalCredits: readerTotal }, byCode);

  // The page's own hours for a course win over the catalog's low end: CHEM 599
  // is 0 to 16 hours in the catalog and 12 on the Chemistry MS page, and a
  // 400-level course is often 3 hours for undergraduates and 4 for graduates.
  const pageCredits = new Map<string, number>();
  for (const area of areas) for (const group of area.groups) for (const row of group.courses ?? []) {
    if (typeof row.credits === 'number' && row.credits > 0) pageCredits.set(normCode(row.code), row.credits);
  }
  const withPageCredits = (rule: RequirementRule): RequirementRule => {
    if (rule.kind !== 'all' && rule.kind !== 'choose' && rule.kind !== 'pool') return rule;
    const choices = rule.choices.map((c) => {
      const own = pageCredits.get(normCode(c.codes[0]));
      if (own === undefined || own === c.credits) return c;
      // The page is the program's own statement of what the row is worth
      // (thesis hours, a seminar taken several terms); a cell over the whole total is a misread.
      if (own > (total ?? 96)) return c;
      return { ...c, credits: own };
    });
    return { ...rule, choices } as RequirementRule;
  };

  const blocks: RequirementBlock[] = [];
  let droppedGenEd = 0;
  forReader.forEach((area, ai) => {
    for (const block of byArea[ai]?.blocks ?? []) {
      if (block.rule.kind === 'gened' || block.rule.kind === 'language') { droppedGenEd += 1; continue; }
      block.rule = withPageCredits(block.rule);
      const gi = indexMap[ai][block.groupIndex] ?? block.groupIndex;
      blocks.push({
        id: `${id}::${ai}::${gi}${block.idSuffix ? `::${block.idSuffix}` : ''}`,
        areaId: `${id}::${ai}`,
        areaLabel: area.label ?? '',
        label: block.label || area.label || '',
        hours: block.hours,
        hoursMax: null,
        rule: block.rule,
        note: block.note,
        url: raw.url,
      });
    }
  });

  // Ranges are sized to what the total leaves: "Elective courses 0-8" is the
  // rest of a 32-hour degree, electives first, then the other ranges in order,
  // then a required course row printed with a range ("ANTH 599 0-32").
  const fixed = readingHours(blocks, byCode).total + bucketSum;
  let slack = total !== null ? total - fixed : 0;
  const rangedRows = new Map<string, number>();
  for (const area of areas) for (const group of area.groups) for (const row of group.courses ?? []) {
    const max = (row as { creditsMax?: number | null }).creditsMax;
    if (typeof max === 'number' && max > (row.credits ?? 0)) rangedRows.set(normCode(row.code), max);
  }
  const sized = buckets.map((b) => ({ ...b, size: b.hours }));
  const order = [...sized].sort((a, b) => Number(ELECTIVE.test(b.group.label ?? '')) - Number(ELECTIVE.test(a.group.label ?? '')));
  for (const b of order) {
    if (slack <= 0) break;
    const room = b.max - b.size;
    if (room <= 0) continue;
    const add = Math.min(room, slack);
    b.size += add;
    slack -= add;
  }
  // Then the ranged course rows of required ('all') blocks.
  if (slack > 0 && rangedRows.size > 0) {
    for (const block of blocks) {
      if (slack <= 0) break;
      if (block.rule.kind !== 'all') continue;
      const choices = block.rule.choices.map((c) => {
        const max = rangedRows.get(normCode(c.codes[0]));
        const now = c.credits ?? 0;
        if (slack <= 0 || max === undefined || max <= now) return c;
        const add = Math.min(max - now, slack);
        slack -= add;
        return { ...c, credits: now + add };
      });
      block.rule = { ...block.rule, choices };
    }
  }
  const kinds: string[] = [];
  for (const b of sized) {
    if (b.size <= 0) continue;
    const area = areas[b.ai];
    const read = readBucket(b.group.label ?? '', b.group.note ?? '', b.size, byCode);
    kinds.push(read.kind);
    blocks.push({
      id: `${id}::${b.ai}::b${b.gi}`,
      areaId: `${id}::${b.ai}`,
      areaLabel: area?.label ?? '',
      label: (b.group.label ?? '').trim() || area?.label || 'Graduate coursework',
      hours: b.size,
      hoursMax: b.max > b.size ? b.max : null,
      rule: read.rule,
      note: b.group.note ?? '',
      url: raw.url,
    });
  }
  // Sentences about milestones and conditions, not courses or hours (exams, a
  // thesis deposit, a language proficiency, what does not count): the shared
  // reader quotes them, but they cannot change the hours a plan books. They
  // stay on the page's facts and link, not in the plan.
  const MILESTONE = /\b(?:exam|exams|deposit|defen[cs]e|proficiency|language requirements?|continuous enrollment|length of stay|presentation|may not be available|do not count|does not count|cannot be counted|not required|gpa|grade of)\b/i;
  for (let k = blocks.length - 1; k >= 0; k -= 1) {
    const rule = blocks[k].rule;
    if (rule.kind !== 'unparsed') continue;
    const words = `${blocks[k].label} ${rule.text}`;
    if (MILESTONE.test(words) && !/\b\d{1,2}\s*(?:credit\s+)?hours?\b/i.test(words)) blocks.splice(k, 1);
  }
  blocks.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  const hours = readingHours(blocks, byCode);
  /*
   * Hours the page counts in its total and names nothing for: Anthropology MA
   * prints ANTH 599 (4 hours) and a 32-hour total, and nothing else. As in
   * Cameron's UGA reader, the rest is one parser-gap block, which the engine
   * leaves unfilled and the review reports ("could not read N required credit
   * hours"); readingHours does not count it, so the reading is still short.
   */
  if (total !== null && blocks.length > 0 && hours.total < total - 1) {
    blocks.push({
      id: `${id}::gap`,
      areaId: `${id}::gap`,
      areaLabel: 'Not named on the catalog page',
      label: 'Graduate coursework the catalog page does not name',
      hours: Math.round((total - hours.total) * 10) / 10,
      hoursMax: null,
      rule: { kind: 'hours', source: 'parser-gap', hours: Math.round((total - hours.total) * 10) / 10, genEd: null, label: 'Graduate coursework the catalog page does not name', minLevel: 400 },
      note: '',
      url: raw.url,
    });
  }
  const quoted = blocks.filter((b) => b.rule.kind === 'unparsed').length;
  let status: GraduateStatus = 'not yet checked';
  let why: string;
  if (raw.shape === 'none') why = 'the page lists no requirements';
  else if (raw.shape !== 'tables' || blocks.length === 0) why = 'the page states its requirements only in sentences, which are not read yet';
  else if (total === null) why = 'the page states no total, so the reading cannot be checked against it';
  else if (quoted > 0) why = `${quoted} requirement${quoted === 1 ? '' : 's'} could only be quoted, not read`;
  else if (Math.abs(hours.total - total) <= 1) {
    status = 'reads right';
    why = hours.open === 0 ? `the named courses add up to the stated ${total} hours` : `named courses and sized hour rows add up to the stated ${total} hours`;
  } else why = hours.total < total ? `the reading finds ${hours.total} of the stated ${total} hours` : `the reading asks for ${hours.total} hours, more than the stated ${total}`;

  return {
    id,
    pageId: raw.id,
    optionIndex: several ? optionIndex : null,
    optionLabel: several ? option?.label ?? null : null,
    name: option ? readingName(raw, option) : raw.name,
    kind: raw.kind,
    degree: raw.degree,
    college: raw.college,
    url: raw.url,
    totalCredits: total,
    blocks,
    readHours: hours.total,
    namedHours: hours.named,
    openHours: hours.open,
    status,
    why,
    droppedGenEd,
  };
}

/** Every reading of one page: one per option, or one saying why there is nothing to read. */
export function adaptIllinoisGraduateProgram(raw: RawGraduateProgram, byCode: CatalogRowLookup): GraduateReading[] {
  if (raw.options.length === 0) {
    return [{
      id: `${GRAD_ID_PREFIX}${raw.id}`, pageId: raw.id, optionIndex: null, optionLabel: null, name: raw.name, kind: raw.kind,
      degree: raw.degree, college: raw.college, url: raw.url, totalCredits: raw.rules.totalCredits, blocks: [], readHours: 0,
      namedHours: 0, openHours: 0, status: 'not yet checked',
      why: raw.shape === 'none' ? 'the page lists no requirements' : 'the page states its requirements only in sentences or rules, which are not read yet',
      droppedGenEd: 0,
    }];
  }
  return raw.options.map((_, i) => adaptIllinoisGraduateOption(raw, i, byCode));
}

/**
 * The pages the menu offers: every degree, certificate, minor and professional
 * page, and each concentration page that prints the whole degree.
 *
 * A degree that requires a concentration (MPH, MSW, Theatre MFA, the Music
 * DMA, the Engineering MEng) prints its courses on the concentration pages,
 * and almost every one of those pages is the whole degree again: its own
 * table with the degree's own total ("Public Health: Health Behavior and
 * Promotion, MPH", 48 hours). Those are offered as degrees of their own, with
 * the degree's kind and code. A concentration that is an add-on (Medieval
 * Studies, 24 hours inside a 32-hour MA) is not.
 */
export function menuPages(file: RawGraduateFile): RawGraduateProgram[] {
  const byId = new Map((file.programs ?? []).map((p) => [p.id, p]));
  const out: RawGraduateProgram[] = [];
  for (const page of file.programs ?? []) {
    if (!page?.id) continue;
    if (page.kind !== 'concentration') { out.push(page); continue; }
    const parent = (page.parents ?? []).map((id) => byId.get(id)).find(Boolean);
    if (!parent || page.options.length === 0) continue;
    const parentTotals = new Set(parent.options.map((o) => o.totalCredits));
    const whole = page.options.every((o) => o.totalCredits !== null && (parentTotals.size === 0 || parentTotals.has(o.totalCredits) || parent.options.every((po) => po.totalCredits === null)));
    if (!whole) continue;
    out.push({ ...page, kind: parent.kind, degree: parent.degree, concentrationOf: parent.id } as RawGraduateProgram);
  }
  return out;
}

/** Every page the menu offers, read. */
export function adaptIllinoisGraduatePrograms(file: RawGraduateFile, byCode: CatalogRowLookup): GraduateReading[] {
  return menuPages(file).flatMap((p) => adaptIllinoisGraduateProgram(p, byCode));
}

export function isIllinoisGraduateId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(GRAD_ID_PREFIX);
}

/** The page id and option number in a reading id: "grad:las/history-ma~2" is ("las/history-ma", 1). */
export function parseGraduateId(id: string): { pageId: string; optionIndex: number | null } | null {
  if (!isIllinoisGraduateId(id)) return null;
  const rest = id.slice(GRAD_ID_PREFIX.length);
  const at = rest.lastIndexOf(GRAD_OPTION_SEPARATOR);
  if (at < 0) return { pageId: rest, optionIndex: null };
  const n = Number(rest.slice(at + 1));
  return Number.isInteger(n) && n >= 1 ? { pageId: rest.slice(0, at), optionIndex: n - 1 } : { pageId: rest, optionIndex: null };
}

// ---------------------------------------------------------------------------
// The menu: public/illinois/graduate/programs.json
// ---------------------------------------------------------------------------

/**
 * One menu row, in the shape of an undergraduate IllinoisProgramSummary
 * (lib/planner/illinois-load.ts) plus what a graduate row adds, so
 * plannableProgram/openProgram-style code can read it.
 */
export interface IllinoisGraduateSummary {
  id: string;
  name: string;
  degree: string;
  college: string;
  concentration: string | null;
  url: string;
  totalCredits: number | null;
  courseCount: number;
  areaCount: number;
  blockCount: number;
  dataStatus: 'catalog' | 'placeholder';
  level: 'graduate';
  kind: GraduateKind;
  pageId: string;
  optionIndex: number | null;
  optionLabel: string | null;
  status: GraduateStatus;
  why: string;
  readHours: number;
  namedHours: number;
  openHours: number;
  min500Hours: number | null;
  minGpa: number | null;
  thesis: 'both' | 'thesis' | 'non-thesis' | null;
  typicalLength: GraduateLength | null;
  concentrationRequired: boolean;
  /** False when there is nothing a plan could place (no requirements read), or when the degree is picked through its concentrations. */
  plannable: boolean;
  /** Set by the build on a degree that requires a concentration whose pages are in the menu: pick one of those instead. */
  pickConcentration?: boolean;
  /** Why a page that was read is never offered (GRADUATE_HELD). */
  held?: string;
  facts: GraduateFact[];
}

/**
 * Pages read but never offered, with the reason in plain words. The MD is a
 * fixed lock-step curriculum (every course in a set order, by phase), so
 * there is nothing for a student to plan; the MD-PhD and DVM pages print no
 * requirements a plan could hold.
 */
export const GRADUATE_HELD: Readonly<Record<string, string>> = {
  'professional/medicine-md': 'a fixed curriculum taken in a set order, with nothing for a student to choose',
  'professional/medical-scholars-program': 'the page describes the program in sentences and lists no requirements',
  'professional/dvm-doctor-veterinary-medicine': 'the page lists no requirements',
  'veterinary/joint-degree/dvm-veterinary-medical-scholars': 'a joint degree whose page lists no requirements',
};

export function graduateSummaryOf(reading: GraduateReading, raw: RawGraduateProgram): IllinoisGraduateSummary {
  const codes = new Set(reading.blocks.flatMap((b) => ('choices' in b.rule ? b.rule.choices.flatMap((c) => c.codes) : [])));
  return {
    id: reading.id,
    name: reading.name,
    degree: reading.degree ?? '',
    college: reading.college,
    concentration: raw.concentrationOf ? raw.id.split('/').pop() ?? null : null,
    url: reading.url,
    totalCredits: reading.totalCredits,
    courseCount: codes.size,
    areaCount: new Set(reading.blocks.map((b) => b.areaId)).size,
    blockCount: reading.blocks.length,
    dataStatus: reading.blocks.length > 0 ? 'catalog' : 'placeholder',
    level: 'graduate',
    kind: reading.kind,
    pageId: reading.pageId,
    optionIndex: reading.optionIndex,
    optionLabel: reading.optionLabel,
    status: reading.status,
    why: reading.why,
    readHours: reading.readHours,
    namedHours: reading.namedHours,
    openHours: reading.openHours,
    min500Hours: raw.rules.min500Hours,
    minGpa: raw.rules.minGpa,
    thesis: raw.thesis,
    typicalLength: raw.typicalLength,
    concentrationRequired: raw.rules.concentrationRequired === true,
    plannable: reading.blocks.length > 0 && reading.totalCredits !== null && GRADUATE_HELD[raw.id] === undefined,
    ...(GRADUATE_HELD[raw.id] ? { held: GRADUATE_HELD[raw.id] } : {}),
    facts: raw.facts,
  };
}

/** The onboarding option shape (components/planner/program-picker.tsx ProgramOption). */
export interface GraduateProgramOption {
  id: string;
  name: string;
  totalCredits?: number | null;
  additionalCredits?: number | null;
}

const DEGREE_KINDS: ReadonlySet<GraduateKind> = new Set(['masters', 'doctoral', 'other', 'professional']);

/**
 * The menus onboarding fills for a graduate student, exactly as it fills
 * UGA's: degrees and certificates, each { id, name, totalCredits,
 * additionalCredits } with additionalCredits the program's own total (what
 * UGA's total-only graduate degrees carry). Graduate minors come back too,
 * but the graduate screen has no minors slot (UGA hides minors for graduate
 * plans), so they are data for later.
 *
 * `onlyReadRight` keeps the rows whose reading was checked against the page's
 * total, which is what a first release should offer.
 */
export function graduateProgramOptions(
  rows: IllinoisGraduateSummary[],
  opts: { onlyReadRight?: boolean } = {},
): { graduateDegrees: GraduateProgramOption[]; graduateCertificates: GraduateProgramOption[]; graduateMinors: GraduateProgramOption[] } {
  const offered = rows.filter((r) => r.plannable && (!opts.onlyReadRight || r.status === 'reads right'));
  const option = (r: IllinoisGraduateSummary): GraduateProgramOption => ({ id: r.id, name: r.name, totalCredits: r.totalCredits, additionalCredits: r.totalCredits });
  const byName = (a: GraduateProgramOption, b: GraduateProgramOption) => a.name.localeCompare(b.name);
  return {
    graduateDegrees: offered.filter((r) => DEGREE_KINDS.has(r.kind)).map(option).sort(byName),
    graduateCertificates: offered.filter((r) => r.kind === 'certificate').map(option).sort(byName),
    graduateMinors: offered.filter((r) => r.kind === 'minor').map(option).sort(byName),
  };
}

// ---------------------------------------------------------------------------
// The board: the same { summary, program, blocks, url } a loaded degree has
// ---------------------------------------------------------------------------

/**
 * The scheduler's view of a reading (ProgramRequirements), for the progress
 * rail: one area per catalog area, one group per block with courses, and the
 * hours blocks as groups with no courses and an hours cap.
 */
export function programRequirementsOf(reading: GraduateReading, byCode: CatalogRowLookup): ProgramRequirements {
  const areas = new Map<string, RequirementArea>();
  for (const block of reading.blocks) {
    const area = areas.get(block.areaId) ?? { label: block.areaLabel || reading.name, hours: 0, groups: [] as RequirementGroup[] };
    const rule = block.rule;
    const courses = 'choices' in rule
      ? rule.choices.map((c) => ({
          code: normCode(c.codes[0]),
          title: c.title,
          credits: c.credits ?? byCode.get(normCode(c.codes[0]))?.credits ?? 0,
          alternatives: c.codes.slice(1).map((code) => ({ code: normCode(code), credits: byCode.get(normCode(code))?.credits ?? c.credits ?? 0 })),
        }))
      : [];
    const choose = rule.kind === 'choose' ? rule.n : rule.kind === 'pool' ? rule.n : null;
    const hours = rule.kind === 'hours' ? rule.hours : rule.kind === 'pool' ? rule.hours : null;
    area.groups.push({ label: block.label, choose, courses, cap: hours !== null || choose !== null ? { hours, courses: choose } : null });
    area.hours += block.hours ?? (rule.kind === 'all' ? courses.reduce((n, c) => n + c.credits, 0) : 0);
    areas.set(block.areaId, area);
  }
  const list = [...areas.values()];
  return {
    id: reading.id,
    college: reading.college,
    degree: reading.degree ?? '',
    name: reading.name,
    areas: list,
    totalCredits: reading.totalCredits,
    areaHours: list.reduce((n, a) => n + a.hours, 0),
  };
}

export interface LoadedGraduateProgram {
  summary: IllinoisGraduateSummary;
  program: ProgramRequirements;
  blocks: RequirementBlock[];
  url: string;
}

/** Where the build step puts the menu and the pages, under public/. */
export const GRADUATE_PROGRAMS_URL = '/illinois/graduate/programs.json';
export const graduatePageUrl = (pageId: string) => `/illinois/graduate/program/${pageId}.json`;
export const GRADUATE_COURSES_URL = '/illinois/graduate/courses.json';
export const GRADUATE_PREREQS_URL = '/illinois/graduate/prereqs.json';

export interface GraduateProgramsFile {
  school: 'illinois';
  source: string;
  fetchedAt: string;
  programs: IllinoisGraduateSummary[];
}

/** The graduate menu, fetched once. */
let menuPromise: Promise<IllinoisGraduateSummary[]> | null = null;
export function loadIllinoisGraduatePrograms(fetchImpl: typeof fetch = fetch): Promise<IllinoisGraduateSummary[]> {
  menuPromise ??= fetchImpl(GRADUATE_PROGRAMS_URL)
    .then((r) => (r.ok ? (r.json() as Promise<GraduateProgramsFile>) : null))
    .then((file) => file?.programs ?? [])
    .catch(() => {
      menuPromise = null;
      return [];
    });
  return menuPromise;
}

/**
 * One graduate program, read in the browser from its page file, the way
 * loadProgram reads an undergraduate degree, so requirement ids match the
 * ones the build computed. `byCode` must hold the graduate courses
 * (graduate/courses.json) beside the undergraduate index.
 */
export async function loadIllinoisGraduateProgram(
  summary: IllinoisGraduateSummary,
  byCode: CatalogRowLookup,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedGraduateProgram | null> {
  const res = await fetchImpl(graduatePageUrl(summary.pageId)).catch(() => null);
  if (!res || !res.ok) return null;
  const raw = (await res.json()) as RawGraduateProgram;
  const index = summary.optionIndex ?? 0;
  if (!raw.options[index]) return null;
  const reading = adaptIllinoisGraduateOption(raw, index, byCode);
  return { summary, program: programRequirementsOf(reading, byCode), blocks: reading.blocks, url: raw.url || summary.url };
}

// ---------------------------------------------------------------------------
// Graduate courses beside the undergraduate core
// ---------------------------------------------------------------------------

/** The graduate course files graduate-build.mjs writes, as fetched. */
export interface GraduateCatalogFiles {
  courses: IllinoisIndexRow[];
  prereqs: Record<string, PrereqSpec>;
  offerings: IllinoisOfferingsFile | null;
  /** Each crawled term's sections, the first term first ("sections.json", then "sections/spring-2027.json"). */
  sections: IllinoisSectionsFile[];
}

/** The graduate course files, fetched once. Null when the course list itself is missing. */
let catalogPromise: Promise<GraduateCatalogFiles | null> | null = null;
export function loadIllinoisGraduateCatalog(fetchImpl: typeof fetch = fetch, extraTerms: string[] = ['sections/spring-2027.json']): Promise<GraduateCatalogFiles | null> {
  const get = <T,>(path: string): Promise<T | null> =>
    fetchImpl(`/illinois/graduate/${path}`).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
  catalogPromise ??= Promise.all([
    get<IllinoisIndexRow[]>('courses.json'),
    get<Record<string, PrereqSpec>>('prereqs.json'),
    get<IllinoisOfferingsFile>('offerings.json'),
    get<IllinoisSectionsFile>('sections.json'),
    ...extraTerms.map((t) => get<IllinoisSectionsFile>(t)),
  ]).then(([courses, prereqs, offerings, first, ...rest]) => {
    if (!courses) { catalogPromise = null; return null; }
    return {
      courses: courses as IllinoisIndexRow[],
      prereqs: (prereqs as Record<string, PrereqSpec> | null) ?? {},
      offerings: offerings as IllinoisOfferingsFile | null,
      sections: [first, ...rest].filter((f): f is IllinoisSectionsFile => Boolean(f)),
    };
  });
  return catalogPromise;
}

/**
 * The undergraduate core with the graduate courses added: index, lookups,
 * prerequisites, offerings and each loaded term's sections. A new object; the
 * core itself is not changed, so an undergraduate plan never sees a graduate
 * row. Feed the result to buildContext (illinois-source.tsx) for a graduate
 * plan, and its byCode to adaptIllinoisGraduateOption.
 */
export function withGraduateCourses(core: IllinoisCore, files: GraduateCatalogFiles): IllinoisCore {
  const rows = files.courses.map(hydrateIndexRow);
  if (files.offerings) applyOfferings(rows, files.offerings);
  const index = [...core.index, ...rows.filter((r) => !core.byCode.has(normCode(r.code)))];
  const prereqs = new Map(core.prereqs ?? []);
  for (const [code, spec] of Object.entries(files.prereqs)) prereqs.set(code, spec);
  const offerings = new Map(core.offerings ?? []);
  if (files.offerings) for (const [code, terms] of Object.entries(files.offerings.courses)) offerings.set(code, terms);
  const summaries = (file: IllinoisSectionsFile) =>
    new Map<string, SectionSummary>(file.courses.map((row) => [normCode(row.code), { ...row, termId: file.termId, termLabel: file.termLabel } as SectionSummary]));
  const sections = new Map(core.sections ?? []);
  const first = files.sections[0];
  if (first) for (const [code, summary] of summaries(first)) if (!sections.has(code)) sections.set(code, summary);
  const sectionTerms = core.sectionTerms?.map((term) => {
    const file = files.sections.find((f) => f.termId === term.entry.id);
    if (!file) return term;
    const merged = new Map(term.sections);
    for (const [code, summary] of summaries(file)) if (!merged.has(code)) merged.set(code, summary);
    return { ...term, sections: merged };
  }) ?? null;
  return {
    ...core,
    index,
    byId: new Map(index.map((c) => [c.id, c])),
    byCode: new Map(index.map((c) => [normCode(c.code), c])),
    prereqs,
    offerings,
    sections,
    sectionTerms,
  };
}

// ---------------------------------------------------------------------------
// Engine settings for a graduate plan, per school
// ---------------------------------------------------------------------------

export interface GraduatePlanSettings {
  minimumTermCredits: number;
  targetTermCredits: number | null;
  standingHours: { freshman: number; sophomore: number; junior: number; senior: number };
  electiveLevelRange: { min: number; maxExclusive: number };
  autoPrerequisiteLevelRange: { min: number; maxExclusive: number };
  /** The board's line about the school's graduate load. */
  caveat: string;
  /** False while a number here is a placeholder rather than the school's own rule. */
  confirmed: boolean;
}

/**
 * What a graduate plan changes in the engine's input, per school.
 *
 * UGA's branch is exactly what planner-workspace.tsx uses today (9 and 9,
 * zero standing, 600 to 999 for electives and automatic prerequisites, the
 * 9-credit sentence), so routing UGA through this cannot move a UGA plan; the
 * check holds it to those literals.
 *
 * Illinois. courseLevel reads the first three digits, so Illinois numbers need
 * no scaling. Electives draw from 400 to 799 (400-level courses carry graduate
 * credit at Illinois, and LAW, VM and medicine use 6xx and 7xx), and only a
 * 500-level-or-higher prerequisite is booked automatically: an undergraduate
 * prerequisite is preparation the bachelor's already gave, as at UGA. The
 * term load is NOT the Graduate College's rule: the catalog's program pages
 * do not print it (only Law prints a semester maximum of 18), so the minimum
 * stays the planner's current Illinois 12 and `confirmed` is false until the
 * Graduate College handbook's full-time rule is read and put here.
 */
export function graduatePlanSettings(school: 'uga' | 'illinois'): GraduatePlanSettings {
  const standingHours = { freshman: 0, sophomore: 0, junior: 0, senior: 0 };
  if (school === 'uga') {
    return {
      minimumTermCredits: 9,
      targetTermCredits: 9,
      standingHours,
      electiveLevelRange: { min: 600, maxExclusive: 1000 },
      autoPrerequisiteLevelRange: { min: 600, maxExclusive: 1000 },
      caveat: 'UGA considers 9 graduate credits a normal full-time fall or spring load. Some assistantships require 12; change Preferences if that applies to you.',
      confirmed: true,
    };
  }
  return {
    minimumTermCredits: 12,
    targetTermCredits: null,
    standingHours,
    electiveLevelRange: { min: 400, maxExclusive: 800 },
    autoPrerequisiteLevelRange: { min: 500, maxExclusive: 800 },
    caveat: 'This graduate draft reads requirements from the Illinois Graduate Catalog. Your department and the Graduate College confirm your program of study, full-time load and any thesis or exam rules.',
    confirmed: false,
  };
}
