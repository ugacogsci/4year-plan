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

export { applyUgaProgramOverrides } from '@/lib/planner/uga-program-overrides';

const normCode = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toUpperCase();
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Requirement rows normally print one code. When a row contains a combined
 * lecture/lab or joint listing, this is the stable first code; catalog rows
 * are expanded separately below so both undergraduate and graduate numbers
 * remain searchable.
 */
function canonicalUgaCode(value: string): string {
  const code = normCode(value).replace(/\s*\*+\s*$/, '');
  const match = code.match(/^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)/);
  return match ? `${match[1]} ${match[2]}` : code;
}

/** Return the separately searchable codes printed on a joint UGA course row. */
function listedUgaCourseCodes(value: string): string[] {
  const code = normCode(value).replace(/\s*\*+\s*$/, '');
  const match = code.match(
    /^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)(?:\/(\d{4}[A-Z]?))?/,
  );
  if (!match) return [canonicalUgaCode(code)];
  return [...new Set([match[2], match[3]].filter(Boolean))].map(
    (number) => `${match[1]} ${number}`,
  );
}

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
  const clauses = cleaned.split(/\s+and\s+/i);
  const groups: PlanPrereqGroup[] = [];

  for (const clause of clauses) {
    const codes: string[] = [];
    let subject = '';
    const token = /\b(?:([A-Z]{2,5})\s+)?(\d{4}[A-Z]?)(?:-(\d{4}[A-Z]?))?\b/g;
    let match: RegExpExecArray | null;
    while ((match = token.exec(clause.toUpperCase())) !== null) {
      if (match[1]) subject = match[1];
      if (!subject) continue;
      for (const number of [match[2], match[3]].filter(Boolean) as string[]) {
        const code = `${subject} ${number}`;
        if (byCode.has(code) && !codes.includes(code)) codes.push(code);
      }
    }
    if (codes.length > 0) {
      groups.push({ any: codes, concurrent: false, confidence: 'high', source: clause.trim() });
    }
  }

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

function creditChoice(row: RawUgaRequirementCourse): CourseChoice {
  return {
    codes: [canonicalUgaCode(row.code)],
    title: row.title,
    credits: row.credits,
    creditsMax: row.credits,
    substitutes: [],
  };
}

function broadElectiveCourses(
  courses: Course[],
  minimumLevel: number,
  excludePrefixes: string[],
): Course[] {
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

  const subjects = [...bySubject.keys()].sort((a, b) => score(a) - score(b));
  for (const coursesForSubject of bySubject.values()) {
    coursesForSubject.sort((a, b) => score(a.code) - score(b.code));
  }
  const selected: Course[] = [];
  for (let index = 0; index < 4 && selected.length < 400; index += 1) {
    for (const subject of subjects) {
      const candidate = bySubject.get(subject)?.[index];
      if (candidate) selected.push(candidate);
      if (selected.length >= 400) break;
    }
  }
  return selected;
}

/** Expand a subject- or campus-level wildcard into real catalog choices. */
function choicesFor(
  group: RawUgaRequirementGroup,
  byCode: Map<string, Course>,
  excludePrefixes: string[] = [],
): CourseChoice[] {
  const choices: CourseChoice[] = [];
  const seen = new Set<string>();
  const byVariant = new Map<string, CourseChoice>();
  for (const row of group.courses) {
    const wildcard = canonicalUgaCode(row.code).match(
      /^([A-Z]{2,5})\s+([1-9])XXX$/,
    );
    const rows = wildcard
      ? (wildcard[1] === 'ANY'
          ? broadElectiveCourses(
              [...byCode.values()],
              Number(wildcard[2]),
              excludePrefixes,
            )
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
      byVariant.set(variantKey, choice);
      choices.push(choice);
    }
  }
  return choices;
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

function adaptProgram(
  program: UgaProgram,
  byCode: Map<string, Course>,
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
      let choices = choicesFor(group, byCode, area.excludePrefixes);
      if (group.choose !== null && area.hours >= group.choose * 3) {
        const ordinary = choices.filter((choice) => (choice.credits ?? 0) >= 3);
        if (ordinary.length >= group.choose) choices = ordinary;
      }
      const listedHours = group.courses.reduce(
        (sum, course) => sum + course.credits,
        0,
      );
      const poolWords = `${area.label} ${group.label}`;
      const isPool =
        (group.lists?.some((list) => list.codes.length > 0) ?? false) ||
        (/preferred courses?/i.test(group.label) && listedHours > area.hours) ||
        (group.choose === null &&
        area.hours > 0 &&
        (group.hours != null ||
          listedHours > area.hours + 4 ||
          /elective|restricted|choose|select|experiential/i.test(poolWords)));
      // A required course cannot also fill a later elective pool. UGA repeats
      // those codes inside broad campus and subject lists, so remove them before
      // the pool reaches the scheduler instead of relying on display-time math.
      if (isPool) {
        const excluded = new Set(
          (area.excludeCodes ?? []).map(canonicalUgaCode),
        );
        choices = choices.filter((choice) =>
          choice.codes.every(
            (code) => !fixedRequirementCodes.has(code) && !excluded.has(code),
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
       * area both. Kept as printed where too few picks would remain.
       */
      let trimmed = false;
      if (group.choose !== null && !isPool && fixedInArea.size > 0) {
        const open = choices.filter((choice) => choice.codes.every((code) => !fixedInArea.has(code)));
        if (open.length < choices.length && open.length >= group.choose) {
          choices = open;
          trimmed = true;
        }
      }
      const poolHours =
        group.hours ?? Math.max(1, area.hours - representedBefore);
      let rule: RequirementRule;

      if (group.choose !== null && !isPool) {
        // A trimmed row picks another area's required course first (autoplan.ts PlanSlot.sharedFirst).
        rule = { kind: 'choose', n: Math.min(group.choose, choices.length), choices, ...(trimmed ? { sharedFirst: true } : {}) };
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
        rule = {
          kind: 'pool',
          hours: group.hours ?? (group.choose === null ? poolHours : null),
          n: group.choose,
          choices,
          lists: poolLists,
          constraints,
          from: 'group',
          label: group.label || area.label,
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
    const [rawCourses, programFile, guidance] = await Promise.all([
      readJson<RawUgaCourse[]>('/uga-catalog.json'),
      readJson<RawUgaProgramFile>('/uga-programs.json'),
      loadUgaPlanningGuidance(),
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
    for (const course of courses) {
      const code = normCode(course.code);
      const prereq = parsePrerequisite(course.prerequisiteText ?? '', byCode);
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
  return adaptProgram(selectedProgram, data.byCode);
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
