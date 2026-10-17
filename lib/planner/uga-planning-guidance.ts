export interface UgaSamplePlan {
  programId: string;
  programName: string;
  url: string;
  courseCodes: string[];
  terms: Array<{ label: string; variant?: string; courseCodes: string[] }>;
}

export interface DoubleDawgsPathway {
  id: string;
  name: string;
  bachelors: string;
  graduate: string;
  undergraduateProgramIds: string[];
  graduateProgramIds: string[];
  url: string;
}

export interface UgaPlanningGuidance {
  fetchedAt: string;
  pathwaySource: string;
  pathways: DoubleDawgsPathway[];
  samplePlans: UgaSamplePlan[];
  withoutSamplePlan: string[];
}

let pending: Promise<UgaPlanningGuidance | null> | null = null;
export function loadUgaPlanningGuidance(): Promise<UgaPlanningGuidance | null> {
  if (!pending) {
    pending = fetch('/uga-planning-guidance.json')
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as UgaPlanningGuidance;
        return Array.isArray(data.pathways) && Array.isArray(data.samplePlans)
          ? data
          : null;
      })
      .catch(() => null)
      .then((data) => {
        if (!data) pending = null;
        return data;
      });
  }
  return pending;
}

export function samplePlansFor(
  guidance: UgaPlanningGuidance | null,
  programIds: readonly string[],
): UgaSamplePlan[] {
  return (
    guidance?.samplePlans.filter((plan) =>
      programIds.includes(plan.programId),
    ) ?? []
  );
}

/** Use the chosen emphasis's sample, or the general sample, never an unrelated track. */
export function sampleCoursesFor(
  plans: UgaSamplePlan[],
  emphases: Record<string, string[]> = {},
): Set<string> {
  const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const codes = new Set<string>();
  for (const plan of plans) {
    const groups = new Map<string, Set<string>>();
    for (const term of plan.terms) {
      const name = term.variant ?? plan.programName;
      const group = groups.get(name) ?? new Set<string>();
      term.courseCodes.forEach((code) => group.add(code));
      groups.set(name, group);
    }
    const chosen = [...groups].filter(([name]) =>
      (emphases[plan.programId] ?? []).some((emphasis) =>
        key(name).includes(key(emphasis)),
      ),
    );
    const general = [...groups].filter(
      ([name]) => key(name) === key(plan.programName),
    );
    const selected = chosen.length ? chosen : general;
    if (selected.length) {
      for (const [, group] of selected)
        group.forEach((code) => codes.add(code));
    } else {
      // With no confidently matched variant, only their common courses can break a tie.
      const variants = [...groups.values()];
      for (const code of variants[0] ?? []) {
        if (variants.every((variant) => variant.has(code))) codes.add(code);
      }
    }
  }
  return codes;
}

export function pathwaysFor(
  guidance: UgaPlanningGuidance | null,
  programIds: readonly string[],
  graduate = false,
): DoubleDawgsPathway[] {
  return (
    guidance?.pathways.filter((pathway) =>
      (graduate
        ? pathway.graduateProgramIds
        : pathway.undergraduateProgramIds
      ).some((id) => programIds.includes(id)),
    ) ?? []
  );
}

/** Only use after eligibility and student-fit scores tie. */
export function compareSampleCourses(
  a: string,
  b: string,
  preferred?: ReadonlySet<string>,
): number {
  return (
    Number(preferred?.has(b) ?? false) - Number(preferred?.has(a) ?? false)
  );
}
