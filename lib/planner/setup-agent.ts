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
/**
 * What the model is asked to return (app/api/setup structured output):
 * setupReplySchema with the emphasis choices as a list. Structured output
 * takes no open-ended map, so a record turned into an object that can only be
 * empty and the assistant could never record an emphasis. fromSetupWire turns
 * the list back into the map setupReplySchema checks.
 */
export const setupWireSchema = z.object({
  reply: z.string(),
  // Every field is required and null when unchanged: optional fields made the
  // structured-output grammar "too complex" (2026-11-04, Sonnet 5.5).
  patch: z.object({
    programLevel: z.enum(['undergraduate', 'graduate']).nullable(),
    programIds: z.array(z.string()).nullable(),
    minorIds: z.array(z.string()).nullable(),
    certificateIds: z.array(z.string()).nullable(),
    academicYear: z.enum(['first', 'second', 'third', 'fourth', 'fifth-plus']).nullable(),
    graduationSeason: z.enum(['Spring', 'Summer', 'Fall']).nullable(),
    graduationYear: z.number().int().nullable(),
    collegeId: z.string().nullable(),
    emphasisSelections: z.array(z.object({ requirementId: z.string(), optionIds: z.array(z.string()) }).strict()).nullable(),
    alreadyTakenCourseCodes: z.array(z.string()).nullable(),
    doubleDawgsPathwayId: z.string().nullable(),
    doubleDawgsGraduateSeason: z.enum(['Spring', 'Summer', 'Fall']).nullable(),
    doubleDawgsGraduateYear: z.number().int().nullable(),
    languageYears: z.number().int().nullable(),
    language: z.string().nullable(),
  }).strict(),
  programConfirmed: z.boolean(),
  creditReviewed: z.boolean(),
}).strict();

/** The wire reply as setupReplySchema reads it: unchanged (null) fields left out, the emphasis list a map. doubleDawgsPathwayId keeps no null (a clear is not expressible on the wire). */
export function fromSetupWire(wire: unknown): unknown {
  if (!wire || typeof wire !== 'object') return wire;
  const w = wire as { patch?: Record<string, unknown> } & Record<string, unknown>;
  if (!w.patch || typeof w.patch !== 'object') return wire;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(w.patch)) {
    if (value === null || value === undefined) continue;
    if (key === 'emphasisSelections' && Array.isArray(value)) patch[key] = Object.fromEntries((value as Array<{ requirementId: string; optionIds: string[] }>).map((e) => [e.requirementId, e.optionIds]));
    else patch[key] = value;
  }
  return { ...w, patch };
}

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
