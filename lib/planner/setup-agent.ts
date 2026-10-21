import { z } from 'zod';
import type { OnboardingAnswers } from './onboarding';

const ids = z.array(z.string().max(160)).max(20).refine((values) => new Set(values).size === values.length, 'Choose each option only once.');
export const setupPatchSchema = z.object({
  programLevel: z.enum(['undergraduate', 'graduate']).optional(),
  programIds: ids.optional(), minorIds: ids.optional(), certificateIds: ids.optional(),
  academicYear: z.enum(['first', 'second', 'third', 'fourth', 'fifth-plus']).optional(),
  graduationSeason: z.enum(['Spring', 'Summer', 'Fall']).optional(),
  graduationYear: z.number().int().min(2026).max(2100).optional(),
  collegeId: z.string().max(80).optional(),
  emphasisSelections: z.record(z.string().max(160), ids).optional(),
  alreadyTakenCourseCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9() /-]{1,20}\s\d{3,5}[A-Z]?$/)).max(200).optional(),
  doubleDawgsPathwayId: z.string().max(160).nullable().optional(),
  doubleDawgsGraduateSeason: z.enum(['Spring', 'Summer', 'Fall']).optional(),
  doubleDawgsGraduateYear: z.number().int().min(2026).max(2100).optional(),
  languageYears: z.number().int().min(0).max(20).optional(),
  language: z.string().max(120).optional(),
}).strict();
export const setupReplySchema = z.object({
  reply: z.string().min(1).max(3000),
  patch: setupPatchSchema,
  programConfirmed: z.boolean(),
  creditReviewed: z.boolean(),
}).strict();
export type SetupMessage = { role: 'user' | 'assistant'; content: string };
export interface SetupCatalog {
  undergraduateDegrees: Array<{ id: string; name: string; degree?: string }>;
  graduateDegrees: Array<{ id: string; name: string; degree?: string }>;
  minors: Array<{ id: string; name: string }>;
  undergraduateCertificates: Array<{ id: string; name: string }>;
  graduateCertificates: Array<{ id: string; name: string }>;
  requirements: Array<{ id: string; programId: string; label: string; minimum: number; maximum: number; options: Array<{ id: string; label: string }> }>;
}

/** Reject invented catalog IDs rather than silently dropping a requested program. */
export function validatedSetupPatch(current: OnboardingAnswers, raw: unknown, catalog: SetupCatalog, pathwayIds: string[], collegeIds: string[]) {
  const patch = setupPatchSchema.parse(raw);
  const graduate = (patch.programLevel ?? current.programLevel) === 'graduate';
  const check = (values: string[] | undefined, options: Array<{ id: string }>) => {
    if (values?.some((id) => !options.some((option) => option.id === id))) throw new Error('The assistant could not match a program to this catalog. Try its full name, or choose it manually.');
  };
  check(patch.programIds, graduate ? catalog.graduateDegrees : catalog.undergraduateDegrees);
  check(patch.minorIds, catalog.minors);
  check(patch.certificateIds, graduate ? catalog.graduateCertificates : catalog.undergraduateCertificates);
  if (patch.programIds?.length === 0) throw new Error('Choose a degree or say you are undecided.');
  if (patch.programIds?.includes('__undecided__') && patch.programIds.length > 1) throw new Error('Choose your degree programs, or undecided on its own.');
  if (patch.programLevel && patch.programLevel !== current.programLevel && !patch.programIds) throw new Error('Which degree would you like at that level?');
  if (patch.collegeId && !collegeIds.includes(patch.collegeId)) throw new Error('Please choose your college manually.');
  if (patch.doubleDawgsPathwayId && !pathwayIds.includes(patch.doubleDawgsPathwayId)) throw new Error('That Double Dawgs pathway is not available for the chosen major. Choose it manually.');
  const programs = patch.programIds ?? current.programIds;
  if (patch.emphasisSelections) for (const [id, values] of Object.entries(patch.emphasisSelections)) {
    const req = catalog.requirements.find((row) => row.id === id && programs.includes(row.programId));
    if (!req || values.length > req.maximum || new Set(values).size !== values.length || values.some((value) => !req.options.some((option) => option.id === value))) throw new Error('Please confirm your emphasis choices manually.');
  }
  return patch;
}
