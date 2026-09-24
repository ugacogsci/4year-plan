'use client';

import { useEffect, useState } from 'react';
import type {
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

const normCode = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toUpperCase();
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * UGA displays joint undergraduate/graduate and lecture/lab listings as one
 * code. Requirements and prerequisites refer to the undergraduate half, so
 * all three data sources need the same key.
 */
function canonicalUgaCode(value: string): string {
  const code = normCode(value).replace(/\s*\*+\s*$/, '');
  const match = code.match(/^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)/);
  return match ? `${match[1]} ${match[2]}` : code;
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
  courses: Course[];
  byCode: Map<string, Course>;
  programs: UgaProgram[];
  prereqs: Map<string, PlanPrereq>;
  context: PlanningContext;
  source: string;
  fetchedAt: string;
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

function adaptCourse(raw: RawUgaCourse): Course {
  const offeredIn: SemesterSeason[] = raw.offeredIn?.length
    ? raw.offeredIn
    : ['Fall', 'Spring'];
  const code = canonicalUgaCode(raw.code);
  return {
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
    // so it must not be presented as a verified offering pattern.
    offeringKnown: offeredIn.length !== 2 || !offeredIn.includes('Fall') || !offeredIn.includes('Spring'),
    format: raw.format ?? 'In person',
    tags: raw.tags ?? [],
    mapPosition: raw.mapPosition,
  };
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
      level > 5 ||
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

/** Expand "CSCI 4XXX" into the undergraduate courses that can fill the pool. */
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
  const blocks: RequirementBlock[] = [];
  const areas: RequirementArea[] = [];
  const fixedRequirementCodes = new Set<string>();

  program.areas.forEach((area, areaIndex) => {
    const areaId = `${program.id}::${areaIndex}`;
    const progressGroups: RequirementGroup[] = [];
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
      const poolHours =
        group.hours ?? Math.max(1, area.hours - representedBefore);
      let rule: RequirementRule;

      if (group.choose !== null && !isPool) {
        rule = { kind: 'choose', n: Math.min(group.choose, choices.length), choices };
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
        const constraints = group.completeOneList && lists.length
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
          hours: group.choose === null ? poolHours : null,
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
              hours: group.choose === null ? poolHours : null,
              courses: group.choose,
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
          for (const code of choice.codes) fixedRequirementCodes.add(code);
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
    areaHours: program.areaHours,
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
    fillToDegreeTotal: program.totalCredits !== null,
    url: `https://bulletin.uga.edu/Program/Details/${program.id}?IDc=${program.college}`,
  };
}

function loadUgaData(): Promise<UgaData | null> {
  if (ugaPromise) return ugaPromise;
  ugaPromise = (async () => {
    const [rawCourses, programFile] = await Promise.all([
      readJson<RawUgaCourse[]>('/uga-catalog.json'),
      readJson<RawUgaProgramFile>('/uga-programs.json'),
    ]);
    if (!rawCourses || !programFile) {
      ugaPromise = null;
      return null;
    }

    const courses = rawCourses.map(adaptCourse);
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
      if (course.offeringKnown) offeringPublished.add(code);
    }

    const programs = programFile.programs
      .filter(
        (program) =>
          program.areas.length > 0 &&
          (program.degree === 'AB' ||
            /^B[A-Z]+$/.test(program.degree) ||
            program.degree === 'MINOR' ||
            program.degree === 'CERT-UG'),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const context: PlanningContext = {
      courses,
      prereqs,
      equivalents,
      creditRanges,
      offeringPublished,
      snapshotTerm: null,
      gradeFootnote: null,
    };
    return {
      courses,
      byCode,
      programs,
      prereqs,
      context,
      source: programFile.source,
      fetchedAt: programFile.fetchedAt,
    };
  })();
  return ugaPromise;
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
      setState({
        status: 'ready',
        data,
        coverage: `${data.courses.length.toLocaleString()} UGA courses · ${data.programs.length} undergraduate majors, minors, and certificates`,
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
  if (options.resetRequirements !== false) {
    for (const course of data.courses) {
      course.requirementIds = [];
      course.pathwayRole = undefined;
    }
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
        course.credits = row.credits;
        course.creditsMax = row.credits;
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
