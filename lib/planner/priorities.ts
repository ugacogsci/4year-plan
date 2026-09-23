/**
 * What "the best schedule" means to one student.
 *
 * A planner that only ever picks the easiest class has decided for the student
 * that easy is what they want. Most do not: some want the professor everyone
 * talks about, some want every elective to point at the job they are after,
 * some want no 8 a.m. sections and nothing else matters. These five knobs are
 * that decision, made by the student, and every choice the planner makes for
 * them (an elective slot, the order of a list, what the bot suggests) reads
 * them through one scoring function in quality.ts.
 *
 * Each knob is 0, 1 or 2: ignore it, count it, count it double. There is no
 * finer scale because nobody can say what 0.35 means for their own life. The
 * two schedule preferences are yes/no facts about the student.
 */
export interface Priorities {
  /** Lighter grade history: lower difficulty, fewer withdrawals. */
  workload: 0 | 1 | 2;
  /** Instructors students ranked excellent, in the university's own list. */
  teaching: 0 | 1 | 2;
  /** Toward what the student said they are studying and want to do after. */
  relevance: 0 | 1 | 2;
  /** A course that also covers an unmet general education category. */
  coverage: 0 | 1 | 2;
  /** Runs this term, at hours and in a format the student can live with. */
  schedule: 0 | 1 | 2;
  /** No sections that start before 9 a.m. */
  noEarly: boolean;
  format: 'any' | 'in-person' | 'online';
}

export type PriorityPreset = 'balanced' | 'lightest' | 'relevant' | 'teaching' | 'custom';

export const PRIORITY_PRESETS: Record<Exclude<PriorityPreset, 'custom'>, Priorities> = {
  balanced: { workload: 1, teaching: 1, relevance: 1, coverage: 1, schedule: 1, noEarly: false, format: 'any' },
  lightest: { workload: 2, teaching: 1, relevance: 0, coverage: 1, schedule: 1, noEarly: false, format: 'any' },
  relevant: { workload: 0, teaching: 1, relevance: 2, coverage: 1, schedule: 1, noEarly: false, format: 'any' },
  teaching: { workload: 1, teaching: 2, relevance: 1, coverage: 0, schedule: 1, noEarly: false, format: 'any' },
};

export const DEFAULT_PRIORITIES: Priorities = PRIORITY_PRESETS.balanced;

export const PRIORITY_LABELS: Record<keyof Omit<Priorities, 'noEarly' | 'format'>, string> = {
  workload: 'Lighter workload',
  teaching: 'Highly rated teaching',
  relevance: 'Toward my interests and career',
  coverage: 'Covers more requirements at once',
  schedule: 'Fits my schedule',
};

/** Which preset these are, or custom when the student has moved a knob. */
export function presetOf(p: Priorities): PriorityPreset {
  for (const [name, preset] of Object.entries(PRIORITY_PRESETS) as Array<[Exclude<PriorityPreset, 'custom'>, Priorities]>) {
    if (
      preset.workload === p.workload &&
      preset.teaching === p.teaching &&
      preset.relevance === p.relevance &&
      preset.coverage === p.coverage &&
      preset.schedule === p.schedule
    ) {
      return name;
    }
  }
  return 'custom';
}

/** One sentence, for the rail and for the bot's instructions. */
export function describePriorities(p: Priorities): string {
  const level = (n: 0 | 1 | 2) => (n === 2 ? 'matters most' : n === 1 ? 'counts' : 'ignored');
  const parts = (Object.keys(PRIORITY_LABELS) as Array<keyof typeof PRIORITY_LABELS>).map(
    (k) => `${PRIORITY_LABELS[k].toLowerCase()} ${level(p[k])}`,
  );
  const extras: string[] = [];
  if (p.noEarly) extras.push('no classes before 9 a.m.');
  if (p.format === 'online') extras.push('online preferred');
  if (p.format === 'in-person') extras.push('in person preferred');
  return `${parts.join(', ')}${extras.length ? `; ${extras.join(', ')}` : ''}.`;
}

/** Anything a saved board or the bot hands in, made safe. Unknown fields fall to the default. */
export function normalizePriorities(raw: unknown): Priorities {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const knob = (v: unknown, fallback: 0 | 1 | 2): 0 | 1 | 2 => (v === 0 || v === 1 || v === 2 ? v : fallback);
  return {
    workload: knob(r.workload, DEFAULT_PRIORITIES.workload),
    teaching: knob(r.teaching, DEFAULT_PRIORITIES.teaching),
    relevance: knob(r.relevance, DEFAULT_PRIORITIES.relevance),
    coverage: knob(r.coverage, DEFAULT_PRIORITIES.coverage),
    schedule: knob(r.schedule, DEFAULT_PRIORITIES.schedule),
    noEarly: r.noEarly === true,
    format: r.format === 'online' || r.format === 'in-person' ? r.format : 'any',
  };
}
