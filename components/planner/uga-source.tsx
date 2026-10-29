'use client';

import { useEffect, useState } from 'react';
import type {
  PlanCreditRange,
  PlanPrereq,
  PlanPrereqGroup,
  PlanningContext,
} from '@/lib/planner/autoplan';
import type {
  CourseChoice,
  RequirementBlock,
  RequirementRule,
} from '@/lib/planner/illinois-data';
import type {
  ProgramRequirements,
  RequirementArea,
  RequirementGroup,
} from '@/lib/planner/scheduler';
import type { Course, SemesterSeason } from '@/lib/planner/types';
import { applyUgaProgramOverrides } from '@/lib/planner/uga-program-overrides';
import { loadUgaPlanningGuidance, type UgaPlanningGuidance } from '@/lib/planner/uga-planning-guidance';
import { summerOnlyListed, ugaPlannerSeasons } from '@/lib/planner/summer-offering';
import type { AnyCourseRule } from '@/lib/planner/any-course';
import { canonicalUgaCode, listedUgaCourseCodes } from '@/lib/planner/uga-course-codes';
import { arrangedOnly, loadUgaOfferings, seasonsRun, takenPerYear, type UgaOfferingsFile } from '@/lib/planner/uga-offerings';

export { applyUgaProgramOverrides } from '@/lib/planner/uga-program-overrides';

const normCode = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toUpperCase();
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Online, honors, service-learning, and writing-intensive rows are versions of one UGA course. */
function ugaVariantKey(value: string): string {
  return canonicalUgaCode(value).replace(/^(\S+\s+\d{4})[EHWS]$/, '$1');
}

function ugaEquivalents(courses: Course[]): Map<string, string[]> {
  const linked = new Map<string, Set<string>>();
  const link = (codes: string[]): void => {
    for (const code of codes) {
      const neighbors = linked.get(code) ?? new Set<string>();
      for (const other of codes) if (other !== code) neighbors.add(other);
      linked.set(code, neighbors);
    }
  };

  const variants = new Map<string, string[]>();
  for (const course of courses) {
    const code = normCode(course.code);
    const key = ugaVariantKey(code);
    const group = variants.get(key);
    if (group) group.push(code);
    else variants.set(key, [code]);
  }
  for (const group of variants.values()) if (group.length > 1) link(group);

  // A few UGA honors courses use a different number instead of an H suffix,
  // for example BIOL 2107L beside BIOL 1107L. The shared department and title
  // are the catalog evidence that these are delivery variants, not two labs a
  // student should take. Keep this deliberately narrow: a title only creates
  // an equivalence when at least one row explicitly says Honors.
  const byTitle = new Map<string, Course[]>();
  for (const course of courses) {
    const title = course.title
      .replace(/\([^)]*honors?[^)]*\)/gi, '')
      .replace(/\bhonors?\b/gi, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
    const key = `${course.cluster.toUpperCase()}::${title}`;
    const group = byTitle.get(key);
    if (group) group.push(course);
    else byTitle.set(key, [course]);
  }
  for (const group of byTitle.values()) {
    if (
      group.length > 1 &&
      group.some((course) => /\bhonors?\b/i.test(course.title))
    ) {
      link(group.map((course) => normCode(course.code)));
    }
  }

  /*
   * A cross-listed class, as the catalog's own prerequisite lines write it:
   * "BCMB(BIOL)(CHEM) 3100" is one class under three subjects. The catalog
   * has a row for each, with titles of its own (CHEM 3100 "Introductory
   * Biological Chemistry"), so neither the number nor the title linked them,
   * and a Genetics sophomore's board booked CHEM 3100 two years after BCMB
   * 3100 (2026-10-28). Only codes the catalog has.
   */
  const known = new Set(courses.map((course) => normCode(course.code)));
  for (const course of courses) {
    for (const listing of (course.prerequisiteText ?? '').matchAll(/\b([A-Z]{2,5})((?:\([A-Z]{2,5}\))+)\s*(\d{4}[A-Z]?)\b/g)) {
      const subjects = [listing[1], ...[...listing[2].matchAll(/[A-Z]{2,5}/g)].map((m) => m[0])];
      const codes = [...new Set(subjects.map((subject) => `${subject} ${listing[3]}`))].filter((code) => known.has(code));
      if (codes.length > 1) link(codes);
    }
  }

  const equivalents = new Map<string, string[]>();
  const visited = new Set<string>();
  for (const start of linked.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    while (queue.length > 0) {
      const code = queue.shift() as string;
      if (visited.has(code)) continue;
      visited.add(code);
      component.push(code);
      for (const neighbor of linked.get(code) ?? []) queue.push(neighbor);
    }
    for (const code of component)
      equivalents.set(code, component.filter((candidate) => candidate !== code));
  }
  return equivalents;
}

interface RawUgaCourse extends Partial<Course> {
  id: string;
  code: string;
  title: string;
  credits: number;
  description: string;
  cluster: string;
  prerequisites?: string[];
  prerequisiteText?: string;
  offeredIn?: SemesterSeason[];
}

interface RawUgaRequirementCourse {
  code: string;
  title: string;
  credits: number;
  /**
   * A subject-wide row's levels where the page gives more than its first
   * ("POLS 3XXX", "3000-level or higher": levelTo 5; "2000-level or below":
   * levelFrom 1), as first digits (scripts/uga-programs.mjs levelRange).
   */
  levelFrom?: number;
  levelTo?: number;
}

interface RawUgaRequirementGroup {
  label: string;
  choose: number | null;
  hours?: number | null;
  note?: string;
  minimumAreas?: number | null;
  upperDivisionHours?: number | null;
  lists?: Array<{ label: string; codes: string[] }>;
  completeOneList?: boolean;
  bundleSize?: number;
  constraints?: Array<{
    text: string;
    n: number;
    lists: Array<{ label: string; codes: string[] }>;
    single: boolean;
    distinctLists?: boolean;
  }>;
  courses: RawUgaRequirementCourse[];
}

interface RawUgaRequirementArea {
  label: string;
  hours: number;
  excludeCodes?: string[];
  excludePrefixes?: string[];
  groups: RawUgaRequirementGroup[];
}

export interface UgaProgram {
  id: string;
  college: string;
  degree: string;
  name: string;
  areas: RawUgaRequirementArea[];
  totalCredits: number | null;
  areaHours: number;
  emphasisGroups?: UgaEmphasisGroup[];
}

export type UgaProgramLevel = 'undergraduate' | 'graduate';

export function isUgaUndergraduateDegree(program: Pick<UgaProgram, 'degree'>): boolean {
  return program.degree === 'AB' || /^B[A-Z]+$/.test(program.degree);
}

export function isUgaGraduateDegree(program: Pick<UgaProgram, 'degree'>): boolean {
  return (
    program.degree.length > 0 &&
    !isUgaUndergraduateDegree(program) &&
    !['MINOR', 'CERT-UG', 'CERT-GM'].includes(program.degree)
  );
}

export interface UgaEmphasisOption {
  id: string;
  label: string;
  hours: number | null;
  areaLabel: string | null;
  courses: RawUgaRequirementCourse[];
  parts?: Array<{
    areaLabel: string | null;
    hours: number | null;
    replaceArea: boolean;
    courses: RawUgaRequirementCourse[];
  }>;
}

export interface UgaEmphasisGroup {
  id: string;
  label: string;
  minimum: number;
  maximum: number;
  note: string;
  replacesArea: string | null;
  options: UgaEmphasisOption[];
}

export interface UgaSelectionRequirement {
  id: string;
  programId: string;
  programName: string;
  label: string;
  minimum: number;
  maximum: number;
  note: string;
  required: boolean;
  options: Array<{ id: string; label: string }>;
}

interface UgaNamedChoice {
  id: string;
  areaIndex: number;
  family: 'focus-area' | 'required-option';
  label: string;
  note: string;
  options: Array<{ id: string; label: string }>;
}

function numberFromWord(value: string): string {
  return ({ one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' })[
    value.toLowerCase()
  ] ?? value;
}

function namedChoiceFromLabel(
  label: string,
): { family: UgaNamedChoice['family']; id: string; label: string } | null {
  const focus = label.match(/^Focus Area\s+(\d+)\s*:\s*(.+)$/i);
  if (focus) {
    return {
      family: 'focus-area',
      id: `focus-${focus[1]}`,
      label: focus[2].trim(),
    };
  }
  const option = label.match(
    /^Option\s+(\d+|One|Two|Three|Four|Five|Six)(?:\s+(?:One|Two|Three|Four|Five|Six))?\s*[-:]\s*(.+)$/i,
  );
  if (option) {
    return {
      family: 'required-option',
      id: `option-${numberFromWord(option[1])}`,
      label: option[2].trim(),
    };
  }
  return null;
}

/**
 * Some Bulletin pages encode required paths as ordinary requirement-group
 * headings instead of explicit emphasis metadata. Group those repeated
 * headings generically so degrees such as HDFS can ask for both a focus area
 * and an experiential-learning option before scheduling.
 */
function namedProgramChoices(program: UgaProgram): UgaNamedChoice[] {
  const choices = new Map<string, UgaNamedChoice>();
  program.areas.forEach((area, areaIndex) => {
    for (const group of area.groups) {
      const parsed = namedChoiceFromLabel(group.label ?? '');
      if (!parsed) continue;
      const key = `${areaIndex}:${parsed.family}`;
      const current = choices.get(key) ?? {
        id: `named-${areaIndex}-${parsed.family}`,
        areaIndex,
        family: parsed.family,
        label: parsed.family === 'focus-area' ? 'Focus area' : 'Experiential learning option',
        note:
          parsed.family === 'focus-area'
            ? 'Choose one published focus area for this degree.'
            : 'Choose one published option for the degree requirement.',
        options: [],
      };
      if (!current.options.some((option) => option.id === parsed.id)) {
        current.options.push({ id: parsed.id, label: parsed.label });
      }
      choices.set(key, current);
    }
  });
  return [...choices.values()].filter((choice) => choice.options.length > 1);
}

/** Every named program choice setup must ask about, from any UGA degree. */
export function ugaSelectionRequirements(program: UgaProgram): UgaSelectionRequirement[] {
  const explicit = (program.emphasisGroups ?? []).map((group) => ({
    id: `${program.id}::${group.id}`,
    programId: program.id,
    programName: program.name,
    label: group.label,
    minimum: group.minimum,
    maximum: group.maximum,
    note: group.note,
    required: group.minimum > 0,
    options: group.options.map((option) => ({ id: option.id, label: option.label })),
  }));
  const structured = program.areas.flatMap((area, areaIndex) =>
    area.groups.flatMap((group, groupIndex) => {
      if (!(group.minimumAreas && group.minimumAreas > 0) || !group.lists?.length) return [];
      return [{
        id: `${program.id}::area-${areaIndex}-group-${groupIndex}`,
        programId: program.id,
        programName: program.name,
        label: group.label || `${area.label} focus areas`,
        minimum: group.minimumAreas,
        // These requirements publish a minimum. Asking for that exact number
        // gives the generator a determinate path while the remaining courses
        // can still come from either selected area.
        maximum: group.minimumAreas,
        note: group.note || `Choose ${group.minimumAreas} named areas.`,
        required: true,
        options: group.lists.map((list) => ({ id: slug(list.label), label: list.label })),
      }];
    }),
  );
  const named = namedProgramChoices(program).map((choice) => ({
    id: `${program.id}::${choice.id}`,
    programId: program.id,
    programName: program.name,
    label: choice.label,
    minimum: 1,
    maximum: 1,
    note: choice.note,
    required: true,
    options: choice.options,
  }));
  return [...structured, ...named, ...explicit];
}

interface RawUgaProgramFile {
  source: string;
  fetchedAt: string;
  programs: UgaProgram[];
}

export interface UgaData {
  guidance: UgaPlanningGuidance | null;
  courses: Course[];
  byCode: Map<string, Course>;
  programs: UgaProgram[];
  prereqs: Map<string, PlanPrereq>;
  context: PlanningContext;
  source: string;
  fetchedAt: string;
  /** Graduate -> undergraduate number only where the catalog prints a dual-level listing. */
  dualLevelCourses: Map<string, string>;
  /** UGA's Schedule of Classes (uga-offerings.ts), or null when it could not be read. */
  offerings?: UgaOfferingsFile | null;
}

export interface UgaLoadedProgram {
  summary: UgaProgram;
  program: ProgramRequirements;
  blocks: RequirementBlock[];
  /** General/free elective hours the Bulletin explicitly publishes. */
  electiveHours: number;
  /** Fill unnamed and overlapping credit up to the Bulletin's published degree total. */
  fillToDegreeTotal: boolean;
  url: string;
}

export type UgaStatus = 'loading' | 'ready' | 'unavailable';

export interface UgaState {
  status: UgaStatus;
  data: UgaData | null;
  coverage: string;
}

let ugaPromise: Promise<UgaData | null> | null = null;

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok || (response.headers.get('content-type') ?? '').includes('html')) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function adaptCourses(raw: RawUgaCourse): Course[] {
  // Fall and spring exactly as before the catalog listed summers; Summer
  // only where the Bulletin names it (lib/planner/summer-offering.ts).
  const { offeredIn, offeringKnown } = ugaPlannerSeasons(raw.offeredIn);
  const summerYears = offeredIn.includes('Summer') && (raw.summerYears === 'odd' || raw.summerYears === 'even') ? raw.summerYears : undefined;
  const offeringListed: SemesterSeason[] = (raw.offeredIn ?? []).filter((season) => season === 'Fall' || season === 'Spring' || season === 'Summer');
  return listedUgaCourseCodes(raw.code).map((code, index) => ({
      id: slug(code),
      code,
      title: raw.title,
      credits: Number.isFinite(raw.credits) ? raw.credits : 3,
      creditsMax: Number.isFinite(raw.creditsMax) ? raw.creditsMax : raw.credits,
      description: raw.description ?? '',
      cluster: raw.cluster,
      requirementIds: [],
      prerequisites: raw.prerequisites ?? [],
      prerequisiteText: raw.prerequisiteText ?? '',
      offeredIn,
      // A one-season row is useful catalog evidence. Fall + Spring is also the
      // fallback written by the enrichment script when a page could not be read,
      // so it must not be presented as a verified offering pattern. Summer
      // does not count here: it is read on its own (runsInSummer).
      offeringKnown,
      ...(summerYears ? { summerYears } : {}),
      offeringListed,
      format: raw.format ?? 'In person',
      tags: raw.tags ?? [],
      mapPosition:
        raw.mapPosition && index > 0
          ? {
              x: Math.min(100, raw.mapPosition.x + 0.18),
              y: Math.min(100, raw.mapPosition.y + 0.18),
            }
          : raw.mapPosition,
    }));
}

/**
 * A prerequisite line as the groups a course needs one course of each from.
 *
 * UGA's lines bind OR tighter than AND ("PSYC 1101 or PSYC 1101E and BIOL
 * 1107" is either PSYC course, and BIOL 1107) and bracket alternatives that
 * are pairs: ENGR 3140's "[(CHEM 1211 and CHEM 1211L) or (CHEM 1311H and
 * CHEM 1311L)]". Split on every AND regardless of the brackets, that line
 * read as CHEM 1211, then "CHEM 1211L or CHEM 1311H", then CHEM 1311L, and
 * the planner booked the honors lab CHEM 1311L for engineers who held CHEM
 * 1211L (2026-10-28). Read with its brackets, a choice between pairs becomes
 * one group for each way of taking one course from every pair (CHEM 1211 or
 * CHEM 1311H; CHEM 1211 or CHEM 1311L; ...), which either pair meets. A
 * bracket the line never closes ends with the line, and one it never opened
 * is passed over (PSYC 3980's "[(BIOL 1103 or BIOL 1103E) and BIOL 1103L)
 * or (BIOL 1104 and BIOL 1104L) ...]"). A number with no subject takes the
 * last subject read ("(BIOL 1103 or BIOL 1103E) and 1103L"). Words that are
 * not course numbers ("permission of department") are not courses, as
 * before.
 */
function prerequisiteGroups(text: string, byCode: Map<string, Course>): Array<{ any: string[]; source: string }> {
  type Token = { kind: 'open' | 'close' | 'and' | 'or'; at: number } | { kind: 'code'; codes: string[]; at: number };
  const tokens: Token[] = [];
  let subject = '';
  const lexeme = /([([])|([)\]])|\b([Aa]nd|AND|[Oo]r|OR)\b|\b(?:([A-Z]{2,5})\s+)?(\d{4}[A-Z]?)(?:-(\d{4}[A-Z]?))?\b/g;
  let match: RegExpExecArray | null;
  while ((match = lexeme.exec(text)) !== null) {
    const at = match.index;
    if (match[1]) tokens.push({ kind: 'open', at });
    else if (match[2]) tokens.push({ kind: 'close', at });
    else if (match[3]) tokens.push({ kind: match[3].toLowerCase() === 'and' ? 'and' : 'or', at });
    else {
      if (match[4]) subject = match[4].toUpperCase();
      if (!subject) continue;
      const codes = [match[5], match[6]].filter(Boolean).map((number) => `${subject} ${(number as string).toUpperCase()}`).filter((code) => byCode.has(code));
      if (codes.length > 0) tokens.push({ kind: 'code', codes, at });
    }
  }
  /*
   * A choice between pairs, group by group: the first courses of each pair
   * are one group, the second courses another ("CHEM 1211 or CHEM 1311H",
   * then "CHEM 1211L or CHEM 1311L"). The planner meets each group with a
   * course of its own (autoplan.ts defaultPrereqMatcher), so one group for
   * every way of taking one course of each pair would ask CHEM 1211 and its
   * lab to meet four. Where the choices are not all the same length, the
   * shortest sets how many groups there are: "(A and B) or C" asks for A or
   * C, never two courses of a student who took C.
   */
  type Clauses = string[][];
  const anyOf = (parts: Clauses[]): Clauses => {
    const kept = parts.filter((part) => part.length > 0);
    if (kept.length === 0) return [];
    const size = Math.min(...kept.map((part) => part.length));
    return Array.from({ length: size }, (_, i) => [...new Set(kept.flatMap((part) => part[i]))]);
  };
  let index = 0;
  const parseAnd = (depth: number): Clauses => {
    const parts: Clauses[] = [parseOr(depth)];
    while (index < tokens.length && tokens[index].kind === 'and') {
      index += 1;
      parts.push(parseOr(depth));
    }
    return parts.flat();
  };
  const parseOr = (depth: number): Clauses => {
    const parts: Clauses[] = [];
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.kind === 'and') break;
      if (token.kind === 'close') {
        if (depth > 0) break;
        index += 1;
        continue;
      }
      index += 1;
      if (token.kind === 'or') continue;
      if (token.kind === 'code') parts.push([token.codes]);
      else {
        parts.push(parseAnd(depth + 1));
        if (index < tokens.length && tokens[index].kind === 'close') index += 1;
      }
    }
    return anyOf(parts);
  };
  // The line's top-level parts, each quoted as the clause its groups came from.
  const out: Array<{ any: string[]; source: string }> = [];
  const starts: number[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === 'open') depth += 1;
    else if (token.kind === 'close') depth = Math.max(0, depth - 1);
    else if (token.kind === 'and' && depth === 0) starts.push(i);
  }
  const sourceOf = (at: number): string => {
    const cuts = [0, ...starts.map((i) => tokens[i].at), text.length];
    for (let i = 0; i < cuts.length - 1; i += 1) if (at >= cuts[i] && at < cuts[i + 1]) return text.slice(cuts[i], cuts[i + 1]).replace(/^\s*and\s+/i, '').trim();
    return text.trim();
  };
  while (index < tokens.length) {
    if (tokens[index].kind === 'and') {
      index += 1;
      continue;
    }
    const at = tokens[index].at;
    for (const any of parseOr(0)) {
      if (any.length === 0) continue;
      if (out.some((group) => group.any.length === any.length && group.any.every((code) => any.includes(code)))) continue;
      out.push({ any, source: sourceOf(at) });
    }
  }
  // A group naming every course of another is met whenever that one is.
  return out.filter((group) => !out.some((other) => other !== group && other.any.length < group.any.length && other.any.every((code) => group.any.includes(code))));
}

/**
 * UGA writes prerequisites as ordinary prose, usually with parenthesized OR
 * lists joined by AND. This parser preserves that distinction. A clause it
 * cannot read stays visible in prerequisiteText, but does not become a made-up
 * hard prerequisite.
 */
function parsePrerequisite(text: string, byCode: Map<string, Course>): PlanPrereq | null {
  const source = text.trim();
  if (!source) return null;
  const firstRule = source.split('|')[0]?.trim() ?? source;
  const cleaned = firstRule
    .replace(/([A-Z]{2,5})(?:\([A-Z]{2,5}\))+\s*(\d{4}[A-Z]?)/g, '$1 $2')
    .replace(/\s+/g, ' ');
  const groups: PlanPrereqGroup[] = prerequisiteGroups(cleaned, byCode).map((group) => ({ ...group, concurrent: false, confidence: 'high' as const }));

  const standing = /fourth[- ]year|senior/i.test(source)
    ? 'senior'
    : /third[- ]year|junior/i.test(source)
      ? 'junior'
      : /second[- ]year|sophomore/i.test(source)
        ? 'sophomore'
        : null;
  const hasConsent = /permission|consent/i.test(source);
  const hasStandingAlternative = /standing\s+(?:or|in lieu)|or\s+.*standing/i.test(source);

  return {
    groups,
    escape: hasConsent && hasStandingAlternative ? 'either' : hasConsent ? 'consent' : hasStandingAlternative ? 'standing' : null,
    text: source,
    parsed: groups.length > 0,
    confidence: groups.length > 0 ? 'high' : 'none',
    standing,
    standingText: standing ? source : undefined,
  };
}

/**
 * The course each undergraduate course's description says it continues, by
 * that course's title in the same subject: ACCT 5010 is "A continuation of
 * Intermediate Accounting I" (ACCT 5000). Its prerequisite line names only
 * ACCT 2101, and ACCT 5020's "ACCT 2101 or ... or ACCT 5010/7010", so the
 * planner booked Intermediate Accounting I, II and III in one semester on
 * every Accounting board (2026-10-28). Only where exactly one course of the
 * subject has the title.
 */
function continuedCourses(courses: Course[]): Map<string, string> {
  const undergraduate = (code: string) => /^[A-Z]{2,5} [1-5]\d{3}[A-Z]?$/.test(code);
  const byTitle = new Map<string, string[]>();
  for (const course of courses) {
    const code = normCode(course.code);
    if (!undergraduate(code) || /[EHS]$/.test(code)) continue;
    const key = `${course.cluster}|${course.title.trim().toLowerCase()}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), code]);
  }
  const out = new Map<string, string>();
  for (const course of courses) {
    const code = normCode(course.code);
    if (!undergraduate(code)) continue;
    const named = course.description.match(/^\s*(?:A |The )?continuation of (?:the )?([^.;,]+?)\s*(?:[.;,]|$)/i)?.[1];
    if (!named) continue;
    const found = (byTitle.get(`${course.cluster}|${named.trim().toLowerCase()}`) ?? []).filter((other) => other !== code && ugaVariantKey(other) !== ugaVariantKey(code));
    if (found.length === 1) out.set(code, found[0]);
  }
  return out;
}

/** `prereq` with the course `code` continues (continuedCourses) as a course to take first, where no group already asks for it alone. */
function withContinuation(prereq: PlanPrereq | null, before: string | undefined, equivalents: Map<string, string[]>): PlanPrereq | null {
  if (!before) return prereq;
  const versions = [before, ...(equivalents.get(before) ?? []).filter((code) => ugaVariantKey(code) === ugaVariantKey(before))];
  if (prereq?.groups.some((group) => group.any.every((code) => versions.includes(code)))) return prereq;
  const group: PlanPrereqGroup = { any: versions, concurrent: false, confidence: 'high', source: `the catalog describes it as a continuation of ${before}` };
  if (!prereq) return { groups: [group], escape: null, text: '', parsed: true, confidence: 'high', standing: null };
  // A group that already offers it among others ("ACCT 2101 or ... or ACCT 5010") is met whenever it is.
  const others = prereq.groups.filter((existing) => !versions.every((code) => existing.any.includes(code)));
  return { ...prereq, groups: [...others, group], parsed: true, confidence: 'high' };
}

function creditChoice(row: RawUgaRequirementCourse): CourseChoice {
  return {
    codes: [canonicalUgaCode(row.code)],
    title: row.title,
    credits: row.credits,
    creditsMax: row.credits,
    substitutes: [],
  };
}

/**
 * A campus-wide wildcard ("Any upper level course 3000-5999") as courses to
 * plan from: up to four a subject, 400 in all. The rule itself stays on the
 * block (PlanRule pool anyCourse), so a held course counts whether or not it
 * is among these (any-course.ts).
 *
 * A hash of the code chooses the sample and its order, and the fill's pick
 * out of it followed the hash (HORT 3030 Floral Design and Management for a
 * Risk Management senior). Where the Schedule of Classes is loaded (`taken`),
 * each subject's most taken courses the hash left out follow (`common`), most
 * taken first, up to 200, so the free choices can read how commonly a course
 * is taken (autoplan.ts freeChoiceSignals); a board built without that
 * reading plans from the sample alone (autoplan.ts withoutCommonSample).
 * Ordered by it outright, the sample changed what fit on full boards with it
 * off too: an incoming Accounting freshman's six terms left Upper-Division
 * General Electives 3 of 9 hours short.
 */
function broadElectiveCourses(
  courses: Course[],
  minimumLevel: number,
  excludePrefixes: string[],
  taken?: ReadonlyMap<string, number>,
): { sample: Course[]; common: Course[] } {
  const bySubject = new Map<string, Course[]>();
  const maximumLevel = minimumLevel >= 6 ? 9 : 5;
  const score = (code: string) => {
    let hash = 2166136261;
    for (const char of code) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  for (const course of courses) {
    const [subject, number = ''] = course.code.split(' ');
    const level = Number(number[0] ?? 0);
    if (
      excludePrefixes.includes(subject) ||
      level < minimumLevel ||
      level > maximumLevel ||
      course.credits < 3 ||
      course.credits > 4 ||
      /laboratory|internship|practicum|independent study|research|thesis|dissertation/i.test(
        course.title,
      )
    ) {
      continue;
    }
    const subjectCourses = bySubject.get(subject);
    if (subjectCourses) subjectCourses.push(course);
    else bySubject.set(subject, [course]);
  }

  for (const coursesForSubject of bySubject.values()) {
    coursesForSubject.sort((a, b) => score(a.code) - score(b.code));
  }
  const subjects = [...bySubject.keys()].sort((a, b) => score(a) - score(b));
  const selected: Course[] = [];
  for (let index = 0; index < 4 && selected.length < 400; index += 1) {
    for (const subject of subjects) {
      const candidate = bySubject.get(subject)?.[index];
      if (candidate) selected.push(candidate);
      if (selected.length >= 400) break;
    }
  }
  if (!taken) return { sample: selected, common: [] };
  const students = (code: string) => taken.get(code) ?? 0;
  const chosen = new Set(selected.map((course) => course.code));
  const commonOnes = [...bySubject.values()]
    .flatMap((coursesForSubject) => [...coursesForSubject].sort((a, b) => students(b.code) - students(a.code) || score(a.code) - score(b.code)).slice(0, 4))
    .filter((course) => !chosen.has(course.code) && students(course.code) > 0)
    .sort((a, b) => students(b.code) - students(a.code) || score(a.code) - score(b.code));
  return { sample: selected, common: commonOnes.slice(0, 200) };
}

/** Expand a subject- or campus-level wildcard into real catalog choices. */
function choicesFor(
  group: RawUgaRequirementGroup,
  byCode: Map<string, Course>,
  excludePrefixes: string[] = [],
  taken?: ReadonlyMap<string, number>,
): CourseChoice[] {
  const choices: CourseChoice[] = [];
  const seen = new Set<string>();
  const byVariant = new Map<string, CourseChoice>();
  for (const row of group.courses) {
    const wildcard = canonicalUgaCode(row.code).match(
      /^([A-Z]{2,5})\s+([1-9])XXX$/,
    );
    const broad = wildcard?.[1] === 'ANY'
      ? broadElectiveCourses([...byCode.values()], Number(wildcard[2]), excludePrefixes, taken)
      : null;
    // The most taken courses the sample adds for the free choices' reading (CourseChoice.common).
    const common = new Set(broad?.common.map((course) => course.code) ?? []);
    const rows = wildcard
      ? (broad
          ? [...broad.sample, ...broad.common]
          : [...byCode.values()].filter((course) =>
              course.code.startsWith(`${wildcard[1]} ${wildcard[2]}`),
            ))
          .map((course) => ({
            code: course.code,
            title: course.title,
            credits: course.credits,
          }))
      : [row];
    for (const candidate of rows) {
      const choice = creditChoice(candidate);
      const code = choice.codes[0];
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const variantKey = ugaVariantKey(code);
      const existing = byVariant.get(variantKey);
      if (existing) {
        existing.codes.push(code);
        continue;
      }
      const kept = common.has(code) ? { ...choice, common: true } : choice;
      byVariant.set(variantKey, kept);
      choices.push(kept);
    }
  }
  return choices;
}

/**
 * The levels a group's subject-wide rows take beyond the one the planner
 * plans from: "POLS prefix course 3000-level or higher" plans from the 3000
 * level, and a held 4000-level POLS class counts (any-course.ts
 * withHeldInRange). Read as the 3000 level alone, a Political Science
 * senior's ten 4000-level POLS classes counted for none of the major's 18
 * hours and the board booked four more; planned from the whole range, the
 * pools filled with 4000- and 5000-level courses that crowded the required
 * ones out of their last terms (Fisheries and Wildlife's ECOL 4000).
 */
function heldRangesFor(group: RawUgaRequirementGroup): AnyCourseRule[] {
  return group.courses.flatMap((row) => {
    const wildcard = canonicalUgaCode(row.code).match(/^([A-Z]{2,5})\s+([1-9])XXX$/);
    if (!wildcard || wildcard[1] === 'ANY' || (row.levelFrom === undefined && row.levelTo === undefined)) return [];
    const level = Number(wildcard[2]);
    return [{ minLevel: row.levelFrom ?? level, maxLevel: row.levelTo ?? level, excludeSubjects: [], subjects: [wildcard[1]] }];
  });
}

function minimumGroupHours(group: RawUgaRequirementGroup): number {
  if (group.choose === null || group.choose <= 0) return 0;
  const ordinary = group.courses.filter((course) => course.credits >= 3);
  const candidates = ordinary.length >= group.choose ? ordinary : group.courses;
  return [...candidates]
    .sort((a, b) => a.credits - b.credits)
    .slice(0, group.choose)
    .reduce((sum, course) => sum + course.credits, 0);
}

function statedGroupHours(group: RawUgaRequirementGroup): number {
  if (group.hours != null) return group.hours;
  if (group.choose !== null) return minimumGroupHours(group);
  return group.courses.reduce((sum, course) => sum + course.credits, 0);
}

/** Whether a group of an area is read as a pool to draw hours from, not a row of courses (adaptProgram). */
function poolLikeGroup(area: RawUgaRequirementArea, group: RawUgaRequirementGroup): boolean {
  const listedHours = group.courses.reduce((sum, course) => sum + course.credits, 0);
  const poolWords = `${area.label} ${group.label}`;
  return (
    (group.lists?.some((list) => list.codes.length > 0) ?? false) ||
    (/preferred courses?/i.test(group.label) && listedHours > area.hours) ||
    (group.choose === null &&
      area.hours > 0 &&
      (group.hours != null ||
        listedHours > area.hours + 4 ||
        /elective|restricted|choose|select|experiential/i.test(poolWords)))
  );
}

/**
 * The hours an area's rows come to read as courses apart, with `group`'s
 * picks at `pickHours`: every row of courses (not a pool to draw hours from)
 * at its stated hours. Where this is more than the area states, the page
 * counts some of its courses in two of its rows (adaptProgram keeps such a
 * choose row as printed).
 */
export function ugaAreaHoursApart(area: UgaProgram['areas'][number], group: UgaProgram['areas'][number]['groups'][number], pickHours: number): number {
  return area.groups
    .filter((other) => other !== group && other.courses.length > 0 && !poolLikeGroup(area, other))
    .reduce((sum, other) => sum + statedGroupHours(other), pickHours);
}

function adaptProgram(
  program: UgaProgram,
  byCode: Map<string, Course>,
  taken?: ReadonlyMap<string, number>,
): UgaLoadedProgram {
  // Preferred core courses are recommendations inside the approved list,
  // not extra mandatory courses. Preserve the complete list as one pool.
  program = { ...program, areas: program.areas.map((area) => {
    const preferred = area.groups.filter((group) => /preferred courses?/i.test(group.label));
    const core = area.groups.filter((group) => /core courses?/i.test(group.label));
    if (!preferred.length || !core.length) return area;
    const rows = [...preferred, ...core].flatMap((group) => group.courses);
    return { ...area, groups: [
      ...area.groups.filter((group) => !preferred.includes(group) && !core.includes(group)),
      { label: 'Approved core courses', choose: null, hours: area.hours,
        courses: [...new Map(rows.map((row) => [row.code, row])).values()] },
    ] };
  }) };
  const blocks: RequirementBlock[] = [];
  const areas: RequirementArea[] = [];
  const fixedRequirementCodes = new Set<string>();
  /*
   * The same class under another of its numbers: its online or honors
   * version (RMIN 4000E beside RMIN 4000), or Terry's x001 section of a
   * course with the same title (MGMT 3001 Principles of Management beside
   * MGMT 3000). The Bulletin says a general elective "cannot also be used to
   * satisfy major-specific requirements"; compared by code alone, a senior's
   * held RMIN 4000 and MGMT 3000 also counted as Upper Division General
   * Electives through RMIN 4000E and MGMT 3001.
   */
  const versionOf = (code: string): string => {
    const key = ugaVariantKey(code);
    const title = byCode.get(code)?.title;
    return title ? `${key.slice(0, -1)}|${title.toLowerCase()}` : key;
  };
  const fixedVersions = new Set<string>();
  const fallbackProgramHours =
    program.areas.length === 0 && isUgaGraduateDegree(program)
      ? program.totalCredits
      : null;

  if (fallbackProgramHours && fallbackProgramHours > 0) {
    const areaId = `${program.id}::program-of-study`;
    const areaLabel = 'Program of study';
    blocks.push({
      id: `${areaId}::unlisted`,
      areaId,
      areaLabel,
      label: areaLabel,
      hours: fallbackProgramHours,
      hoursMax: fallbackProgramHours,
      rule: {
        kind: 'hours',
        hours: fallbackProgramHours,
        genEd: null,
        label: areaLabel,
        source: 'parser-gap',
      },
      note: '',
      url: `https://bulletin.uga.edu/Program/Details/${program.id}?IDc=${program.college}`,
    });
    areas.push({ label: areaLabel, hours: fallbackProgramHours, groups: [] });
  }

  program.areas.forEach((area, areaIndex) => {
    const areaId = `${program.id}::${areaIndex}`;
    const progressGroups: RequirementGroup[] = [];
    /** Codes an earlier take-every-course row of this area names (for its choose rows, below). */
    const fixedInArea = new Set<string>();
    area.groups.forEach((group, groupIndex) => {
      if (group.courses.length === 0) return;
      const wildcardAlreadyFillsArea = area.groups
        .slice(0, groupIndex)
        .some(
          (earlier) =>
            (earlier.hours ?? 0) >= area.hours &&
            earlier.courses.some((course) => /^ANY\s+[1-9]XXX$/i.test(course.code)),
        );
      if (wildcardAlreadyFillsArea) return;
      const representedBefore = area.groups
        .slice(0, groupIndex)
        .reduce((sum, earlier) => sum + statedGroupHours(earlier), 0);
      // Degree pages repeat the full campus Core Courses list after their own
      // preferred rows. Once those rows already fill the area, the campus list
      // is a reference list, not an additional requirement.
      if (/core courses?/i.test(group.label) && representedBefore >= area.hours)
        return;
      const id = `${areaId}::${groupIndex}`;
      let choices = choicesFor(group, byCode, area.excludePrefixes, taken);
      if (group.choose !== null && area.hours >= group.choose * 3) {
        const ordinary = choices.filter((choice) => (choice.credits ?? 0) >= 3);
        if (ordinary.length >= group.choose) choices = ordinary;
      }
      const isPool = poolLikeGroup(area, group);
      // A required course cannot also fill a later elective pool. UGA repeats
      // those codes inside broad campus and subject lists, so remove them before
      // the pool reaches the scheduler instead of relying on display-time math.
      if (isPool) {
        const excluded = new Set(
          (area.excludeCodes ?? []).map(canonicalUgaCode),
        );
        choices = choices.filter((choice) =>
          choice.codes.every(
            (code) => !fixedRequirementCodes.has(code) && !excluded.has(code) && !fixedVersions.has(versionOf(code)),
          ),
        );
      }
      /*
       * The same for a choose row: a course an earlier row of this area
       * requires cannot also be one of its picks. The audit counts a course
       * once within an area (areaProgress spends it on the first row, in
       * printed order), so the planner counting it twice left a board it
       * called complete short by one course: Marketing and International
       * Business lists MARK 4700 among its required Marketing courses and
       * again among "choose 2", and the pre-med freshman's board took it as
       * one of the two (Field of Study Curriculum 18 of 21, 2026-10-22). Only
       * within the area: UGA lets a course count in a Core area and a major
       * area both. Kept as printed where too few picks would remain, and
       * where the area's own hours say its rows overlap: read as courses
       * apart, Marketing's rows come to the 21 hours the area states, but
       * TESOL's German Education rows (GRMN 3010, 3020 and 4001, then five
       * GRMN 3XXX) come to 24 of the area's 15, so the page counts its
       * required courses among the five, and asking for five more left
       * other rows' courses off its boards.
       */
      let trimmed = false;
      if (group.choose !== null && !isPool && fixedInArea.size > 0) {
        const open = choices.filter((choice) => choice.codes.every((code) => !fixedInArea.has(code)));
        const pickHours = open.map((choice) => choice.credits ?? 3).sort((a, b) => a - b).slice(0, group.choose).reduce((sum, hours) => sum + hours, 0);
        if (open.length < choices.length && open.length >= group.choose && (area.hours <= 0 || ugaAreaHoursApart(area, group, pickHours) <= area.hours)) {
          choices = open;
          trimmed = true;
        }
      }
      const poolHours =
        group.hours ?? Math.max(1, area.hours - representedBefore);
      let rule: RequirementRule;

      const heldRanges = heldRangesFor(group);
      if (group.choose !== null && !isPool) {
        // A trimmed row picks another area's required course first (autoplan.ts PlanSlot.sharedFirst).
        rule = { kind: 'choose', n: Math.min(group.choose, choices.length), choices, ...(trimmed ? { sharedFirst: true } : {}), ...(heldRanges.length ? { heldRanges } : {}) };
      } else if (isPool) {
        const allowed = new Set(choices.flatMap((choice) => choice.codes));
        const lists = (group.lists ?? [])
          .map((list) => ({
            label: list.label,
            codes: list.codes.map(canonicalUgaCode).filter((code) => allowed.has(code)),
          }))
          .filter((list) => list.codes.length > 0);
        const poolLists = lists.length
          ? lists
          : [{ label: group.label || area.label, codes: [...allowed] }];
        const explicitConstraints = (group.constraints ?? [])
          .map((constraint) => ({
            ...constraint,
            lists: constraint.lists
              .map((list) => ({
                label: list.label,
                codes: list.codes
                  .map(canonicalUgaCode)
                  .filter((code) => allowed.has(code)),
              }))
              .filter((list) => list.codes.length > 0),
          }))
          .filter((constraint) => constraint.lists.length > 0);
        const constraints = explicitConstraints.length
          ? explicitConstraints
          : group.completeOneList && lists.length
          ? [
              {
                text: group.note || 'Choose one complete course group.',
                n: group.bundleSize ?? 1,
                lists: poolLists,
                single: true,
              },
            ]
          : group.minimumAreas || group.upperDivisionHours
            ? [
                {
                  text:
                    group.note ||
                    `Choose from at least ${group.minimumAreas ?? 0} named areas.`,
                  n: group.minimumAreas ?? 0,
                  lists: poolLists,
                  single: false,
                  distinctLists: Boolean(group.minimumAreas),
                  hours: group.upperDivisionHours ?? undefined,
                  hourCodes: choices
                    .flatMap((choice) => choice.codes)
                    .filter((code) => Number(code.match(/\b(\d)/)?.[1] ?? 0) >= 3),
                },
              ]
            : [];
        // "Any upper level course 3000-5999": the rule, beside the sample in `choices`.
        const any = group.courses.map((row) => canonicalUgaCode(row.code).match(/^ANY\s+([1-9])XXX$/)).find(Boolean);
        rule = {
          kind: 'pool',
          hours: group.hours ?? (group.choose === null ? poolHours : null),
          n: group.choose,
          choices,
          lists: poolLists,
          constraints,
          from: 'group',
          label: group.label || area.label,
          ...(any ? { anyCourse: { minLevel: Number(any[1]), maxLevel: Number(any[1]) >= 6 ? 9 : 5, excludeSubjects: area.excludePrefixes ?? [] } } : {}),
          ...(heldRanges.length ? { heldRanges } : {}),
        };
      } else {
        rule = { kind: 'all', choices };
      }

      blocks.push({
        id,
        areaId,
        areaLabel: area.label,
        label: group.label || area.label,
        hours: isPool ? poolHours : null,
        hoursMax: isPool ? poolHours : null,
        rule,
        note: group.note ?? '',
        url: `https://bulletin.uga.edu/Program/Details/${program.id}?IDc=${program.college}`,
      });

      progressGroups.push({
        label: group.label,
        choose: group.choose,
        required: rule.kind === 'all',
        minimumCourses: group.choose ?? undefined,
        minimumHours: isPool ? (group.hours ?? (group.choose === null ? poolHours : undefined)) : undefined,
        courses: choices.map((choice) => ({
          code: choice.codes[0] ?? '',
          title: choice.title,
          credits:
            choice.credits ?? byCode.get(choice.codes[0] ?? '')?.credits ?? 3,
          alternatives: choice.codes.slice(1).map((code) => ({
            code,
            title: byCode.get(code)?.title ?? choice.title,
            credits: byCode.get(code)?.credits ?? choice.credits ?? 3,
          })),
        })),
        cap: isPool
          ? {
              hours: group.hours ?? (group.choose === null ? poolHours : null),
              courses: group.hours != null ? null : group.choose,
            }
          : group.choose !== null
            ? { hours: null, courses: group.choose }
            : null,
      });

      for (const choice of choices) {
        for (const code of choice.codes) {
          const course = byCode.get(code);
          if (course && !course.requirementIds.includes(areaId)) course.requirementIds.push(areaId);
          if (course && group.choose !== null) course.pathwayRole = 'choice';
          else if (course && !isPool) course.pathwayRole = 'required';
        }
      }
      // Only a take-every-course row is fixed. A choose-one row lists possible
      // selections, and reserving every possibility here emptied later valid
      // menus (STAT 2000 appeared in Foundation choices, so Psychology's
      // Quantitative Reasoning pool incorrectly had zero courses).
      if (!isPool && group.choose === null) {
        for (const choice of choices) {
          for (const code of choice.codes) {
            fixedRequirementCodes.add(code);
            fixedVersions.add(versionOf(code));
            fixedInArea.add(code);
          }
        }
      }
    });

    const representedHours = area.groups.reduce((sum, group, groupIndex) => {
      if (group.courses.length === 0) return sum;
      const wildcardAlreadyFillsArea = area.groups
        .slice(0, groupIndex)
        .some(
          (earlier) =>
            (earlier.hours ?? 0) >= area.hours &&
            earlier.courses.some((course) => /^ANY\s+[1-9]XXX$/i.test(course.code)),
        );
      if (wildcardAlreadyFillsArea) return sum;
      const representedBefore = area.groups
        .slice(0, groupIndex)
        .reduce((hours, earlier) => hours + statedGroupHours(earlier), 0);
      if (/core courses?/i.test(group.label) && representedBefore >= area.hours)
        return sum;
      const listed = group.courses.reduce(
        (hours, course) => hours + course.credits,
        0,
      );
      if (group.choose !== null) {
        const minimum = minimumGroupHours(group);
        // "PSYC prefix 3000-level or higher" expands into real courses later,
        // but the scraper's wildcard row itself has zero hours. Its enclosing
        // area supplies the authoritative total.
        const hasWildcard = group.courses.some((course) => /\b[1-9]XXX\b/.test(course.code));
        return sum + (minimum > 0 || !hasWildcard ? minimum : area.hours);
      }
      if (group.hours != null) return sum + group.hours;
      if (
        listed > area.hours + 4 ||
        /elective|restricted|choose|select|experiential/i.test(
          `${area.label} ${group.label}`,
        )
      ) {
        return area.hours;
      }
      return sum + listed;
    }, 0);
    if (representedHours < area.hours) {
      const missing = area.hours - representedHours;
      const explicitElective = /^(?:general|free) electives?\b/i.test(
        area.label,
      );
      blocks.push({
        id: `${areaId}::unlisted`,
        areaId,
        areaLabel: area.label,
        label: area.label,
        hours: missing,
        hoursMax: missing,
        rule: {
          kind: 'hours',
          hours: missing,
          genEd: null,
          label: area.label,
          source: explicitElective ? 'explicit-elective' : 'parser-gap',
        },
        note: '',
        url: `https://bulletin.uga.edu/Program/Details/${program.id}?IDc=${program.college}`,
      });
    }

    areas.push({ label: area.label, hours: area.hours, groups: progressGroups });
  });

  const adapted: ProgramRequirements = {
    id: program.id,
    college: program.college,
    degree: program.degree,
    name: program.name,
    areas,
    totalCredits: program.totalCredits,
    areaHours: fallbackProgramHours ?? program.areaHours,
  };

  return {
    summary: program,
    program: adapted,
    blocks,
    electiveHours: program.areas
      .filter((area) => /^(?:general|free) electives?\b/i.test(area.label))
      .reduce((sum, area) => sum + area.hours, 0),
    // UGA's program pages regularly omit college-wide requirements from the
    // degree table even though they publish an authoritative total. Stopping
    // at the named rows produces a 97-credit Psychology "four-year plan".
    // Editable electives fill that difference; unresolved parser gaps remain
    // visible as review items and are never presented as confirmed courses.
    fillToDegreeTotal:
      program.totalCredits !== null &&
      (isUgaUndergraduateDegree(program) ||
        (isUgaGraduateDegree(program) &&
          (program.areas.length === 0 || program.id === '56418'))),
    url: `https://bulletin.uga.edu/Program/Details/${program.id}?IDc=${program.college}`,
  };
}

export function loadUgaData(): Promise<UgaData | null> {
  if (ugaPromise) return ugaPromise;
  ugaPromise = (async () => {
    const [rawCourses, programFile, guidance, offerings] = await Promise.all([
      readJson<RawUgaCourse[]>('/uga-catalog.json'),
      readJson<RawUgaProgramFile>('/uga-programs.json'),
      loadUgaPlanningGuidance(),
      loadUgaOfferings(),
    ]);
    if (!rawCourses || !programFile) {
      ugaPromise = null;
      return null;
    }

    const courses = rawCourses.flatMap(adaptCourses);
    /*
     * Every row of public/uga-catalog.json says 3 credits: a placeholder
     * (CHEM 1211L is 1 hour, PHYS 1111 4). A loaded degree's table repairs the
     * courses it names (loadUgaProgram), and until 2026-10-22 it never put them
     * back, so a gen-ed pick or an elective another degree named carried that
     * degree's real hours into the next board, and a board depended on which
     * degrees were built before it. Each course now starts at the hours most of
     * UGA's own program tables print for it (rowHoursOf, the reading
     * setUgaTrackHours already gave a pre-health course), whatever was loaded
     * before; a course no table names keeps the 3. The degree's own table still
     * wins for the courses it names.
     */
    const tableHours = rowHoursOf(programFile.programs);
    for (const course of courses) {
      const hours = tableHours.get(normCode(course.code));
      if (hours === undefined) continue;
      course.credits = hours;
      course.creditsMax = hours;
    }
    // GradFIRST is one credit, additional to the graduate program of study.
    // https://ai.uga.edu/ms-artificial-intelligence#degree-requirements
    for (const course of courses) if (/^GRSC 7001E?$/.test(course.code)) { course.credits = 1; course.creditsMax = 1; }
    const dualLevelCourses = new Map<string, string>();
    for (const raw of rawCourses) {
      const codes = listedUgaCourseCodes(raw.code);
      const undergraduate = codes.find((code) => / [1-5]\d{3}/.test(code));
      const graduate = codes.find((code) => / [6-9]\d{3}/.test(code));
      if (undergraduate && graduate) dualLevelCourses.set(graduate, undergraduate);
    }
    const byCode = new Map(courses.map((course) => [normCode(course.code), course]));
    const equivalents = ugaEquivalents(courses);
    const prereqs = new Map<string, PlanPrereq>();
    const creditRanges = new Map<string, { credits: number; min: number; max: number; variable: boolean; known: boolean }>();
    const offeringPublished = new Set<string>();
    const continues = continuedCourses(courses);
    for (const course of courses) {
      const code = normCode(course.code);
      const prereq = withContinuation(parsePrerequisite(course.prerequisiteText ?? '', byCode), continues.get(code), equivalents);
      if (prereq) prereqs.set(code, prereq);
      creditRanges.set(code, {
        credits: course.credits,
        min: course.credits,
        max: course.creditsMax ?? course.credits,
        variable: (course.creditsMax ?? course.credits) > course.credits,
        known: true,
      });
      // The Bulletin names a summer-only row's season too: published, so the
      // planner's own picks leave it out of falls and springs (summerOnlyListed).
      if (course.offeringKnown || summerOnlyListed(course)) offeringPublished.add(code);
    }

    const programs = applyUgaProgramOverrides(programFile.programs)
      .filter(
        (program) =>
          (isUgaGraduateDegree(program) &&
            ((program.areas.length > 0 && program.areaHours > 0) ||
              (program.totalCredits ?? 0) > 0)) ||
          ((program.areas.length > 0 && program.areaHours > 0) &&
            (isUgaUndergraduateDegree(program) ||
              program.degree === 'MINOR' ||
              program.degree === 'CERT-UG' ||
              program.degree === 'CERT-GM')),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const context: PlanningContext = {
      schoolId: 'uga',
      undergraduateCounterparts: dualLevelCourses,
      courses,
      prereqs,
      equivalents,
      creditRanges,
      offeringPublished,
      snapshotTerm: null,
      gradeFootnote: null,
      // What is commonly taken and what is on this year's schedule, for the
      // free choices (autoplan.ts freeChoiceSignals); without the file, as before.
      ...(offerings ? {
        taken: takenPerYear(offerings),
        takenSource: ((counted) => `UGA's Schedule of Classes, ${counted[0]?.label} to ${counted.at(-1)?.label}`)(offerings.terms.filter((t) => t.enrolled > 0).sort((a, b) => a.period.localeCompare(b.period))),
        scheduled: { terms: offerings.terms.map((t) => t.label), seasons: seasonsRun(offerings), arranged: arrangedOnly(offerings) },
        ...(offerings.subjects ? { subjectNames: new Map(Object.entries(offerings.subjects)) } : {}),
      } : {}),
    };
    const data: UgaData = {
      courses,
      byCode,
      programs,
      guidance,
      prereqs,
      context,
      source: programFile.source,
      fetchedAt: programFile.fetchedAt,
      dualLevelCourses,
      offerings,
    };
    rawProgramsOf.set(data, programFile.programs);
    return data;
  })();
  return ugaPromise;
}

/*
 * Real hours for a pre-health student's track courses.
 *
 * The catalog file has 3 credits on every UGA row (CHEM 1211L and PHYS
 * 1111-1111L included); a degree's own table repairs the hours of the courses
 * it names (loadUgaProgram). Since 2026-10-22 every course already starts at
 * the hours its program-table rows print (loadUgaData), so this changes a
 * course only where that starting point was changed since; it is kept so a
 * goal's courses can never fall back to the placeholder. setUgaTrackHours
 * gives a track course the hours UGA's program tables print for it (public/uga-programs.json, the value most of its rows give:
 * CHEM 1211L 1 hour in 221 rows, PHYS 1111 4 hours in 307 rows and 3 in an
 * older 50). Only while the student's goal names the track: a UGA student
 * with no pre-health goal is planned on the catalog's hours as before, and
 * a goal taken back puts them back. A course the degree's own table named
 * keeps the degree's hours.
 */
const rawProgramsOf = new WeakMap<UgaData, UgaProgram[]>();
const rowHoursCache = new WeakMap<UgaData, Map<string, number>>();
/** Codes whose hours a loaded degree's table set (loadUgaProgram): they keep them. */
const degreeHours = new WeakMap<UgaData, Set<string>>();
/** What setUgaTrackHours changed, to put back when the goal no longer asks for it. */
const trackHoursBefore = new WeakMap<UgaData, Map<string, { credits: number; creditsMax?: number; range?: PlanCreditRange }>>();
/** The codes the student's goal last asked hours for (setUgaTrackHours), to give them again after a new degree loads. */
const trackWanted = new WeakMap<UgaData, Set<string>>();
type HoursWere = { credits: number; creditsMax?: number; range?: PlanCreditRange };
/**
 * Each course's hours as the data loaded them (its program-table hours,
 * loadUgaData) for every course a degree table or a goal has changed since,
 * taken the first time either changes it.
 *
 * Without it a board depended on which degrees were built before it in the
 * same session: loadUgaProgram wrote each degree's table hours into the one
 * shared catalog and never put them back, so a course the next degree does
 * not name kept the last degree's hours (1 credit up or down on 8 of 10
 * pre-health boards and 9 of 20 no-goal boards of five programs built alone
 * against the same programs built after every other, and Music Performance
 * BMus left 2 to 4 more required courses unplaced), and degreeHours kept
 * every degree's codes, so a goal's hours skipped courses only an earlier
 * degree named. A new degree now starts from the hours the data loaded with (restoreCatalogHours).
 */
const catalogHoursOf = new WeakMap<UgaData, Map<string, HoursWere>>();

function rememberCatalogHours(data: UgaData, code: string, course: Course): void {
  const kept = catalogHoursOf.get(data) ?? new Map<string, HoursWere>();
  catalogHoursOf.set(data, kept);
  if (!kept.has(code)) kept.set(code, { credits: course.credits, creditsMax: course.creditsMax, range: data.context.creditRanges?.get(code) });
}

function putHoursBack(data: UgaData, code: string, was: HoursWere): void {
  const course = data.byCode.get(code);
  if (course) {
    course.credits = was.credits;
    if (was.creditsMax === undefined) delete course.creditsMax;
    else course.creditsMax = was.creditsMax;
  }
  if (was.range) data.context.creditRanges?.set(code, was.range);
  else data.context.creditRanges?.delete(code);
}

/** Every course a degree or a goal changed, back at the catalog's hours, with nothing remembered as a degree's or a goal's. */
function restoreCatalogHours(data: UgaData): void {
  for (const [code, was] of catalogHoursOf.get(data) ?? []) putHoursBack(data, code, was);
  catalogHoursOf.get(data)?.clear();
  degreeHours.delete(data);
  trackHoursBefore.delete(data);
}

/** The hours most rows of UGA's program tables print for each course. */
export function ugaRowHours(data: UgaData): Map<string, number> {
  const known = rowHoursCache.get(data);
  if (known) return known;
  const out = rowHoursOf(rawProgramsOf.get(data) ?? data.programs);
  rowHoursCache.set(data, out);
  return out;
}

/** The hours most rows of these program tables print for each course (ties to the larger). */
function rowHoursOf(programs: readonly UgaProgram[]): Map<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const program of programs) {
    for (const area of program.areas) {
      for (const group of area.groups) {
        for (const row of group.courses) {
          if (!Number.isFinite(row.credits) || /\b[1-9]XXX\b/.test(row.code)) continue;
          const code = canonicalUgaCode(row.code);
          const byHours = counts.get(code) ?? new Map<number, number>();
          byHours.set(row.credits, (byHours.get(row.credits) ?? 0) + 1);
          counts.set(code, byHours);
        }
      }
    }
  }
  const out = new Map<string, number>();
  for (const [code, byHours] of counts) {
    const [hours] = [...byHours].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    out.set(code, hours);
  }
  return out;
}

/**
 * Give `codes` (career-tracks.ts ugaTrackCodes for the student's goal) the
 * hours UGA's program tables print, and put back the catalog's hours for any
 * course an earlier goal changed and this one does not name. Returns the
 * codes it found no hours for (they keep the catalog's 3).
 */
export function setUgaTrackHours(data: UgaData, codes: Iterable<string>): string[] {
  const want = new Set([...codes].map(normCode));
  const before = trackHoursBefore.get(data) ?? new Map<string, { credits: number; creditsMax?: number; range?: PlanCreditRange }>();
  trackHoursBefore.set(data, before);
  trackWanted.set(data, want);
  for (const [code, was] of [...before]) {
    if (want.has(code)) continue;
    putHoursBack(data, code, was);
    before.delete(code);
  }
  if (want.size === 0) return [];
  const hours = ugaRowHours(data);
  const fromDegree = degreeHours.get(data);
  const none: string[] = [];
  for (const code of want) {
    const course = data.byCode.get(code);
    if (!course || before.has(code) || fromDegree?.has(code)) continue;
    const real = hours.get(code);
    if (real === undefined) {
      none.push(code);
      continue;
    }
    rememberCatalogHours(data, code, course);
    before.set(code, { credits: course.credits, creditsMax: course.creditsMax, range: data.context.creditRanges?.get(code) });
    course.credits = real;
    course.creditsMax = real;
    data.context.creditRanges?.set(code, { credits: real, min: real, max: real, variable: false, known: true });
  }
  return none.sort();
}

export function useUgaData(enabled: boolean): UgaState {
  const [state, setState] = useState<UgaState>({
    status: enabled ? 'loading' : 'unavailable',
    data: null,
    coverage: '',
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadUgaData().then((data) => {
      if (cancelled) return;
      if (!data) {
        setState({ status: 'unavailable', data: null, coverage: 'UGA data did not load' });
        return;
      }
      const undergraduateDegrees = data.programs.filter(isUgaUndergraduateDegree).length;
      const graduateDegrees = data.programs.filter(isUgaGraduateDegree).length;
      const minors = data.programs.filter(
        (program) => program.degree === 'MINOR',
      ).length;
      const certificates = data.programs.filter((program) =>
        program.degree.startsWith('CERT-'),
      ).length;
      setState({
        status: 'ready',
        data,
        coverage: `${data.courses.length.toLocaleString()} UGA course listings · ${undergraduateDegrees} undergraduate and ${graduateDegrees} graduate or professional degrees · ${minors} minors · ${certificates} certificates`,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

function selectedUgaProgram(
  program: UgaProgram,
  selections: Record<string, string[]>,
): UgaProgram {
  const namedChoices = namedProgramChoices(program);
  const areas: RawUgaRequirementArea[] = program.areas.map((area, areaIndex) => ({
    ...area,
    groups: area.groups
      .map((group, groupIndex) => ({ group, groupIndex }))
      .filter(({ group }) => {
        const parsed = namedChoiceFromLabel(group.label ?? '');
        if (!parsed) return true;
        const choice = namedChoices.find(
          (candidate) => candidate.areaIndex === areaIndex && candidate.family === parsed.family,
        );
        if (!choice) return true;
        const selected = selections[`${program.id}::${choice.id}`] ?? [];
        return selected.length === 0 || selected.includes(parsed.id);
      })
      .map(({ group, groupIndex }) => {
      const requirementId = `${program.id}::area-${areaIndex}-group-${groupIndex}`;
      const selected = new Set(selections[requirementId] ?? []);
      if (selected.size === 0 || !group.minimumAreas || !group.lists?.length) {
        return { ...group, courses: [...group.courses], lists: group.lists?.map((list) => ({ ...list, codes: [...list.codes] })) };
      }
      const lists = group.lists.filter((list) => selected.has(slug(list.label)));
      const allowed = new Set(lists.flatMap((list) => list.codes.map(canonicalUgaCode)));
      return {
        ...group,
        minimumAreas: Math.min(group.minimumAreas, lists.length),
        lists: lists.map((list) => ({ ...list, codes: [...list.codes] })),
        courses: group.courses.filter((course) => allowed.has(canonicalUgaCode(course.code))),
      };
      }),
  }));

  for (const emphasis of program.emphasisGroups ?? []) {
    const selectedIds = new Set(selections[`${program.id}::${emphasis.id}`] ?? []);
    const chosen = emphasis.options.filter((option) => selectedIds.has(option.id));
    if (chosen.length === 0) continue;
    const label = chosen.map((option) => option.label).join(' + ');
    const parts = chosen.flatMap((option) => option.parts ?? [{
      areaLabel: option.areaLabel,
      hours: option.hours,
      replaceArea: emphasis.replacesArea === option.areaLabel,
      courses: option.courses,
    }]);
    const areaLabels = [...new Set(parts.map((part) => part.areaLabel ?? `${emphasis.id}::extra`))];
    for (const areaLabel of areaLabels) {
      const selectedParts = parts.filter(
        (part) => (part.areaLabel ?? `${emphasis.id}::extra`) === areaLabel,
      );
      const courses = selectedParts.flatMap((part) => part.courses).filter(
        (course, index, all) =>
          all.findIndex(
            (candidate) => canonicalUgaCode(candidate.code) === canonicalUgaCode(course.code),
          ) === index,
      );
      if (courses.length === 0) continue;
      const target = areas.find((area) => area.label === areaLabel);
      const areaStartsWithAnEmphasis = emphasis.options.some((option) =>
        option.parts?.some(
          (part) => part.areaLabel === areaLabel && part.replaceArea,
        ),
      );
      const replacesTarget =
        emphasis.replacesArea === areaLabel ||
        areaStartsWithAnEmphasis ||
        selectedParts.every((part) => part.replaceArea);
      const statedHours = Math.max(...selectedParts.map((part) => part.hours ?? 0), 0);
      const representedHours = target
        ? target.groups.reduce((sum, existing) => sum + statedGroupHours(existing), 0)
        : 0;
      const hours =
        statedHours ||
        (target
          ? replacesTarget
            ? target.hours
            : Math.max(1, target.hours - representedHours)
          : 0);
      const group: RawUgaRequirementGroup = {
        label: `${emphasis.label}: ${label}`,
        choose: null,
        hours: hours || null,
        note: `Selected ${emphasis.label.toLowerCase()}: ${label}.`,
        courses,
      };
      if (target) {
        if (replacesTarget) target.groups = [group];
        else target.groups.push(group);
      } else {
        const areaHours = hours || courses.reduce((sum, course) => sum + course.credits, 0);
        if (areaHours > 0) {
          areas.push({
            label: `${emphasis.label}: ${label}`,
            hours: areaHours,
            groups: [group],
          });
        }
      }
    }
  }

  return {
    ...program,
    areas,
    areaHours: areas.reduce((sum, area) => sum + area.hours, 0),
  };
}

export function loadUgaProgram(
  data: UgaData,
  program: UgaProgram,
  options: {
    resetRequirements?: boolean;
    emphasisSelections?: Record<string, string[]>;
  } = {},
): UgaLoadedProgram {
  const selectedProgram = selectedUgaProgram(program, options.emphasisSelections ?? {});
  // Requirement marks describe the active degree. Switching majors must not
  // leave a course labelled required because the previous degree required it.
  // A double-major load resets once before the first program, then accumulates
  // the second program's marks on the same catalog.
  const reset = options.resetRequirements !== false;
  if (reset) {
    for (const course of data.courses) {
      course.requirementIds = [];
      course.pathwayRole = undefined;
    }
    // Hours too: the degree before this one leaves none of its own behind (catalogHoursOf).
    restoreCatalogHours(data);
  }
  // The degree table publishes authoritative hours for every course it names.
  // Apply those rows to the map catalog before planning. This also repairs old
  // snapshots produced while the course scraper incorrectly defaulted every
  // UGA course to three credits.
  for (const area of selectedProgram.areas) {
    for (const group of area.groups) {
      for (const row of group.courses) {
        if (/\b[1-9]XXX\b/.test(row.code)) continue;
        const code = canonicalUgaCode(row.code);
        const course = data.byCode.get(code);
        if (!course || !Number.isFinite(row.credits)) continue;
        rememberCatalogHours(data, code, course);
        course.credits = row.credits;
        course.creditsMax = row.credits;
        // The degree's own hours stand, and are not put back when a track's goal is dropped (setUgaTrackHours).
        const set = degreeHours.get(data) ?? new Set<string>();
        set.add(code);
        degreeHours.set(data, set);
        trackHoursBefore.get(data)?.delete(code);
        data.context.creditRanges?.set(code, {
          credits: row.credits,
          min: row.credits,
          max: row.credits,
          variable: false,
          known: true,
        });
      }
    }
  }
  // The goal's hours again, for its courses this degree does not name: the
  // reset above put them back to the catalog's, and a build may run before
  // the workspace next calls setUgaTrackHours.
  const wanted = trackWanted.get(data);
  if (reset && wanted && wanted.size > 0) setUgaTrackHours(data, wanted);
  return adaptProgram(selectedProgram, data.byCode, data.context.taken);
}

export function guessUgaProgram(studying: string, programs: UgaProgram[]): UgaProgram | null {
  const words = significant(studying);
  if (words.length === 0) return null;
  const scored = programs
    .map((program) => {
      const name = program.name.toLowerCase();
      const nameWords = significant(program.name.replace(program.degree, ''));
      const matched = words.reduce((score, word) => score + (name.includes(word) ? word.length : 0), 0);
      const extra = nameWords.filter((word) => !words.some((input) => word.includes(input))).length;
      return { program, score: matched - 2 * extra };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1]?.score ?? 0;
  if (!best || best.score < 6 || best.score - runnerUp < 2) return null;
  return best.program;
}

function significant(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3 && !STOP.has(word));
}

const STOP = new Set([
  'about',
  'classes',
  'degree',
  'major',
  'studying',
  'thinking',
  'with',
]);
