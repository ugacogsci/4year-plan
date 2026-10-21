import { z } from 'zod';

// Only these three planner records may leave the device for account storage.
// Consent, research identities, display settings and secrets never belong here.
export const WORKSPACE_KEYS = ['fourYear.onboarding.v2', 'fourYear.board.v4', 'fourYear.advisor.v1'] as const;
const strings = z.array(z.string());
const planSchema = z.looseObject({
  schemaVersion: z.literal(1), programId: z.string(), graduationLabel: z.string(), completedCourseIds: strings,
  terms: z.array(z.looseObject({ id: z.string(), label: z.string(), season: z.enum(['Fall', 'Spring', 'Summer']), courseIds: strings })),
});
export const workspaceSchema = z.object({
  version: z.literal(1),
  answers: z.record(z.string(), z.unknown()).refine((a) => a.schoolId === 'uga' || a.schoolId === 'illinois'),
  board: z.looseObject({ schemaVersion: z.literal(4), schoolId: z.enum(['uga', 'illinois']), board: z.looseObject({ plan: planSchema }),
    plans: z.array(z.looseObject({ plan: planSchema })).optional(),
  }),
  chat: z.record(z.string(), z.unknown()).nullable(),
}).strict().refine((v) => v.board.schoolId === v.answers.schoolId, 'The plan and setup must belong to the same university.');
export type WorkspaceSnapshot = z.infer<typeof workspaceSchema>;
export function localSnapshot(storage: Pick<Storage, 'getItem'>): WorkspaceSnapshot | null {
  try {
    const [answers, board, chat] = WORKSPACE_KEYS.map((key) => JSON.parse(storage.getItem(key) ?? 'null'));
    const parsed = workspaceSchema.safeParse({ version: 1, answers, board, chat });
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function snapshotFingerprint(snapshot: WorkspaceSnapshot): string {
  const { savedAt: _savedAt, ...board } = snapshot.board;
  return JSON.stringify({ ...snapshot, board });
}
