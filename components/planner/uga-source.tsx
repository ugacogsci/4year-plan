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

const normCode = (value: string) => value.replace(/\s+/g, ' ').trim().toUpperCase();

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
  courses: RawUgaRequirementCourse[];
}

interface RawUgaRequirementArea {
  label: string;
  hours: number;
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
  const offeredIn: SemesterSeason[] = raw.offeredIn?.length ? raw.offeredIn : ['Fall', 'Spring'];
  return {
    id: raw.id,
    code: normCode(raw.code),
    title: raw.title,
    credits: Number.isFinite(raw.credits) ? raw.credits : 3,
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
    codes: [normCode(row.code)],
    title: row.title,
    credits: row.credits,
    creditsMax: row.credits,
    substitutes: [],
  };
}

function minimumGroupHours(group: RawUgaRequirementGroup): number {
  if (group.choose === null || group.choose <= 0) return 0;
  return [...group.courses]
    .sort((a, b) => a.credits - b.credits)
    .slice(0, group.choose)
    .reduce((sum, course) => sum + course.credits, 0);
}

function adaptProgram(program: UgaProgram, byCode: Map<string, Course>): UgaLoadedProgram {
  const blocks: RequirementBlock[] = [];
  const areas: RequirementArea[] = [];

  program.areas.forEach((area, areaIndex) => {
    const areaId = `${program.id}::${areaIndex}`;
    const progressGroups: RequirementGroup[] = [];
    const reservedByExplicitChoices = area.groups.reduce(
      (sum, group) => sum + minimumGroupHours(group),
      0,
    );

    area.groups.forEach((group, groupIndex) => {
      if (group.courses.length === 0) return;
      const id = `${areaId}::${groupIndex}`;
      const choices = group.courses.map(creditChoice);
      const listedHours = group.courses.reduce((sum, course) => sum + course.credits, 0);
      const poolWords = `${area.label} ${group.label}`;
      const isPool =
        group.choose === null &&
        area.hours > 0 &&
        (listedHours > area.hours + 4 || /elective|restricted|choose|select|experiential/i.test(poolWords));
      const poolHours = Math.max(1, area.hours - reservedByExplicitChoices);
      let rule: RequirementRule;

      if (group.choose !== null) {
        rule = { kind: 'choose', n: Math.min(group.choose, choices.length), choices };
      } else if (isPool) {
        rule = {
          kind: 'pool',
          hours: poolHours,
          n: null,
          choices,
          lists: [{ label: group.label || area.label, codes: choices.flatMap((choice) => choice.codes) }],
          constraints: [],
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
        note: '',
        url: `https://bulletin.uga.edu/Program/Details/${program.id}?IDc=${program.college}`,
      });

      progressGroups.push({
        label: group.label,
        choose: group.choose,
        courses: group.courses.map((course) => ({
          code: normCode(course.code),
          title: course.title,
          credits: course.credits,
        })),
        cap: isPool
          ? { hours: poolHours, courses: null }
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
    });

    const representedHours = area.groups.reduce((sum, group) => {
      if (group.courses.length === 0) return sum;
      const listed = group.courses.reduce((hours, course) => hours + course.credits, 0);
      if (group.choose !== null) return sum + minimumGroupHours(group);
      if (listed > area.hours + 4 || /elective|restricted|choose|select|experiential/i.test(`${area.label} ${group.label}`)) {
        return area.hours;
      }
      return sum + listed;
    }, 0);
    if (representedHours < area.hours) {
      const missing = area.hours - representedHours;
      blocks.push({
        id: `${areaId}::unlisted`,
        areaId,
        areaLabel: area.label,
        label: `${area.label} courses not exposed by the parser`,
        hours: missing,
        hoursMax: missing,
        rule: {
          kind: 'hours',
          hours: missing,
          genEd: null,
          label: area.label,
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

export function loadUgaProgram(data: UgaData, program: UgaProgram): UgaLoadedProgram {
  // Requirement marks describe the active degree. Switching majors must not
  // leave a course labelled required because the previous degree required it.
  for (const course of data.courses) {
    course.requirementIds = [];
    course.pathwayRole = undefined;
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
