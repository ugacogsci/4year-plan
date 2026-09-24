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

/** Online, honors, and writing-intensive rows are versions of one UGA course. */
function ugaVariantKey(value: string): string {
  return canonicalUgaCode(value).replace(/^(\S+\s+\d{4})[EHW]$/, '$1');
}

function ugaEquivalents(courses: Course[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const course of courses) {
    const code = normCode(course.code);
    const key = ugaVariantKey(code);
    const group = groups.get(key);
    if (group) group.push(code);
    else groups.set(key, [code]);
  }

  const equivalents = new Map<string, string[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const code of group) {
      equivalents.set(code, group.filter((candidate) => candidate !== code));
    }
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
  courses: RawUgaRequirementCourse[];
}

interface RawUgaRequirementArea {
  label: string;
  hours: number;
  excludeCodes?: string[];
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
  /** This reviewed degree has known overlap and college-wide credit outside its area table. */
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

/** Expand "CSCI 4XXX" into the undergraduate courses that can fill the pool. */
function choicesFor(
  group: RawUgaRequirementGroup,
  byCode: Map<string, Course>,
): CourseChoice[] {
  const choices: CourseChoice[] = [];
  const seen = new Set<string>();
  const byVariant = new Map<string, CourseChoice>();
  for (const row of group.courses) {
    const wildcard = canonicalUgaCode(row.code).match(
      /^([A-Z]{2,5})\s+([1-9])XXX$/,
    );
    const rows = wildcard
      ? [...byCode.values()]
          .filter((course) =>
            course.code.startsWith(`${wildcard[1]} ${wildcard[2]}`),
          )
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
  return [...group.courses]
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
      const representedBefore = area.groups
        .slice(0, groupIndex)
        .reduce((sum, earlier) => sum + statedGroupHours(earlier), 0);
      // Degree pages repeat the full campus Core Courses list after their own
      // preferred rows. Once those rows already fill the area, the campus list
      // is a reference list, not an additional requirement.
      if (/core courses?/i.test(group.label) && representedBefore >= area.hours)
        return;
      const id = `${areaId}::${groupIndex}`;
      let choices = choicesFor(group, byCode);
      const listedHours = group.courses.reduce(
        (sum, course) => sum + course.credits,
        0,
      );
      const poolWords = `${area.label} ${group.label}`;
      const isPool =
        (group.lists?.some((list) => list.codes.length > 0) ?? false) ||
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
        const constraints =
          group.minimumAreas || group.upperDivisionHours
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
      if (!isPool) {
        for (const choice of choices) {
          for (const code of choice.codes) fixedRequirementCodes.add(code);
        }
      }
    });

    const representedHours = area.groups.reduce((sum, group, groupIndex) => {
      if (group.courses.length === 0) return sum;
      const representedBefore = area.groups
        .slice(0, groupIndex)
        .reduce((hours, earlier) => hours + statedGroupHours(earlier), 0);
      if (/core courses?/i.test(group.label) && representedBefore >= area.hours)
        return sum;
      const listed = group.courses.reduce(
        (hours, course) => hours + course.credits,
        0,
      );
      if (group.choose !== null) return sum + minimumGroupHours(group);
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
    fillToDegreeTotal: program.id === '96447',
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
      .filter((program) => program.areas.length > 0 && (program.degree === 'AB' || /^B[A-Z]+$/.test(program.degree)))
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
        coverage: `${data.courses.length.toLocaleString()} UGA courses · ${data.programs.length} undergraduate programs`,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

export function loadUgaProgram(
  data: UgaData,
  program: UgaProgram,
  options: { resetRequirements?: boolean } = {},
): UgaLoadedProgram {
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
  for (const area of program.areas) {
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
  return adaptProgram(program, data.byCode);
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
