'use client';

import type { Course } from '@/lib/planner/types';
import type { PlanningContext } from '@/lib/planner/autoplan';
import type { RequirementBlock } from '@/lib/planner/illinois-data';
import type { ProgramRequirements } from '@/lib/planner/scheduler';
import { loadIllinoisCore, type IllinoisCore, type IllinoisProgramSummary } from '@/lib/planner/illinois-load';
import { isSupportedSchool, schoolById, SCHOOL_CAPABILITIES, type School, type SchoolCapabilities, type SupportedSchoolId } from '@/lib/planner/schools';
import { buildContext, loadProgram, plannableProgram } from './illinois-source';
import { loadUgaData, loadUgaProgram, type UgaData, type UgaProgram } from './uga-source';

export interface SchoolProgram {
  summary: { id: string; name: string; totalCredits: number | null };
  program: ProgramRequirements;
  blocks: RequirementBlock[];
  url: string;
  electiveHours?: number;
  fillToDegreeTotal?: boolean;
}

export interface SchoolProgramOptions {
  resetRequirements?: boolean;
  emphasisSelections?: Record<string, string[]>;
}

/** Existing staged loaders remain available; consumers share this contract. */
export interface SchoolAdapter<Data, Summary> {
  id: SupportedSchoolId;
  identity: School;
  capabilities: SchoolCapabilities;
  load(): Promise<Data | null>;
  courses(data: Data): Course[];
  programs(data: Data): Summary[];
  context(data: Data, blocks?: RequirementBlock[]): PlanningContext;
  loadProgram(data: Data, summary: Summary, options?: SchoolProgramOptions): Promise<SchoolProgram | null>;
}

export const illinoisAdapter: SchoolAdapter<IllinoisCore, IllinoisProgramSummary> = {
  id: 'illinois',
  identity: schoolById('illinois')!,
  capabilities: SCHOOL_CAPABILITIES.illinois,
  async load() {
    const core = await loadIllinoisCore();
    return core.index.length > 0 && core.prereqs && core.programs && core.exclusions ? core : null;
  },
  courses: (core) => core.index,
  programs: (core) => (core.programs ?? []).filter(plannableProgram),
  context: (core, blocks = []) => ({ ...buildContext(core, blocks, null).context, schoolId: 'illinois' }),
  loadProgram: (core, summary, options) => {
    if (options?.resetRequirements) {
      for (const course of core.index) {
        course.requirementIds = [];
        course.pathwayRole = undefined;
      }
    }
    return loadProgram(core, summary);
  },
};

export const ugaAdapter: SchoolAdapter<UgaData, UgaProgram> = {
  id: 'uga',
  identity: schoolById('uga')!,
  capabilities: SCHOOL_CAPABILITIES.uga,
  load: loadUgaData,
  courses: (data) => data.courses,
  programs: (data) => data.programs,
  context: (data) => ({ ...data.context, schoolId: 'uga' }),
  async loadProgram(data, summary, options) {
    return loadUgaProgram(data, summary, options);
  },
};

export const SCHOOL_ADAPTERS = { illinois: illinoisAdapter, uga: ugaAdapter };

/** Unsupported schools have no adapter and can never fall through to sample data. */
export function schoolAdapter(id: unknown) {
  return isSupportedSchool(id) ? SCHOOL_ADAPTERS[id] : null;
}

/** School-neutral catalog entry point for transcript and course selection. */
export async function loadSchoolCatalog(id: unknown): Promise<Course[] | null> {
  if (id === 'illinois') {
    const data = await illinoisAdapter.load();
    return data ? illinoisAdapter.courses(data) : null;
  }
  if (id === 'uga') {
    const data = await ugaAdapter.load();
    return data ? ugaAdapter.courses(data) : null;
  }
  return null;
}
