import {
  generatePlan,
  planCreditRange,
  qualityScorer,
  validatePlan,
  type AutoplanInput,
  type GeneratedPlan,
  type PlanRequirement,
  type PlanningContext,
} from './autoplan';
import { areaProgress, termLoad, type ProgramRequirements } from './scheduler';
import type { Course, PlanIssue, PlanState, SemesterSeason } from './types';
import type { DoubleDawgsPathway } from './uga-planning-guidance';

export type DegreeStageTerm = { season: SemesterSeason; year: number };
// PlanTerm.year is the year of study; its label carries the calendar year.
export const degreeTermOrder = (
  term: DegreeStageTerm & { label?: string },
): number =>
  Number(term.label?.match(/\b(20\d{2})\b/)?.[1] ?? term.year) * 3 +
  ['Spring', 'Summer', 'Fall'].indexOf(term.season);
export const defaultGraduateFinish = (
  finish: DegreeStageTerm,
): DegreeStageTerm => ({ ...finish, year: finish.year + 1 });
const nextRegular = (term: DegreeStageTerm): DegreeStageTerm =>
  term.season === 'Fall'
    ? { season: 'Spring', year: term.year + 1 }
    : { season: 'Fall', year: term.year };
const normalize = (code: string): string =>
  code.trim().toUpperCase().replace(/\s+/g, ' ');
const graduateCode = (code: string): boolean => / [6-9]\d{3}[A-Z]?$/.test(code);

export interface CombinedDegreeSource {
  program: ProgramRequirements;
  blocks: PlanRequirement[];
  electiveHours?: number;
  url?: string;
}
export interface SharedCourse {
  code: string;
  undergraduateCode: string;
  credits: number;
}

export interface SharedCourseListing {
  code: string;
  title: string;
  credits: number;
  option: SharedCourse | null;
  reason: string | null;
}

/** Keep unavailable and advisor-review choices visible instead of silently dropping them. */
export function doubleDawgsCourseList(
  pathway: DoubleDawgsPathway,
  graduate: CombinedDegreeSource,
  courses: Map<string, Course>,
  dualLevel: Map<string, string>,
): SharedCourseListing[] {
  // The AI handbook explicitly identifies LING 8021 as the former LING 6021.
  // No number arithmetic or title-only equivalencies are inferred here.
  const currentCode = (code: string) =>
    pathway.graduateProgramIds.includes('19170') && code === 'LING 6021'
      ? 'LING 8021'
      : code;
  const named = new Set((pathway.sharedCourseCodes ?? []).map(currentCode));
  const gr = namedCodes(graduate.blocks);
  const broad = pathway.id === '10080'; // Its page permits any named MS required/elective course at 6000+.
  return [...new Set([...named, ...gr])].filter(graduateCode).map((code) => {
    const course = courses.get(code);
    const permitted =
      named.has(code) ||
      (broad && !['GRSC 7001', 'ARTI 7000', 'ARTI 7300'].includes(code));
    const reason = !permitted
      ? 'Graduate curriculum course, not listed for sharing by this pathway. Ask the pathway advisor about an exception; no shared credit is counted.'
      : !gr.has(code)
        ? 'The pathway lists this course, but its place in the current graduate curriculum needs advisor confirmation.'
        : !course
          ? 'Course details are missing from this catalog snapshot.'
          : null;
    return {
      code,
      title: course?.title ?? 'Title not available in the snapshot',
      credits: course?.credits ?? 0,
      option:
        !reason && course && course.credits > 0
          ? {
              code,
              undergraduateCode: dualLevel.get(code) ?? code,
              credits: course.credits,
            }
          : null,
      reason,
    };
  });
}

/** Department rules omitted by the Bulletin table, verified against the cited source. */
export function withDoubleDawgsGraduateRules<T extends CombinedDegreeSource>(
  source: T,
  context: PlanningContext,
): T {
  if (
    source.program.id !== '19170' ||
    source.blocks.some((block) => block.id === 'double-dawgs:ai-graduate-only')
  )
    return source;
  const url = 'https://ai.uga.edu/ms-artificial-intelligence';
  const names = namedCodes(source.blocks);
  const choices = context.courses
    .filter(
      (course) =>
        names.has(course.code) &&
        / [78]\d{3}/.test(course.code) &&
        !['ARTI 7000', 'ARTI 7300'].includes(course.code),
    )
    .map((course) => ({ codes: [course.code], credits: course.credits }));
  const blocks: PlanRequirement[] = [
    {
      id: 'double-dawgs:ai-graduate-only',
      areaId: 'double-dawgs:ai-graduate-only',
      areaLabel: 'Graduate-only coursework',
      label: '12 graduate-only credits (not thesis or research)',
      hours: 12,
      note: 'At least 12 graduate-only coursework hours, excluding ARTI 7000 and ARTI 7300. These overlap other program requirements.',
      url,
      rule: {
        kind: 'pool',
        hours: 12,
        n: null,
        label: 'Graduate-only coursework',
        choices,
        lists: [],
        constraints: [],
      },
    },
    {
      id: 'double-dawgs:gradfirst',
      areaId: 'double-dawgs:gradfirst',
      areaLabel: 'GradFIRST (additional to the 30-hour program)',
      label: 'GradFIRST',
      hours: 1,
      note: 'UGA requires the one-credit GradFIRST seminar in addition to the 30-hour AI program of study.',
      url,
      rule: { kind: 'all', choices: [{ codes: ['GRSC 7001'], credits: 1 }] },
    },
  ];
  // The final two hours are the balance to 30, not another independently
  // reusable Group A/B requirement. The total checks that balance directly.
  const curriculum = source.blocks.filter(
    (block) => block.label !== 'Additional Research or Select Course',
  );
  const areas = source.program.areas.map((area) =>
    area.label === 'Thesis and Research'
      ? {
          ...area,
          hours: 3,
          groups: area.groups.filter(
            (group) => group.label !== 'Additional Research or Select Course',
          ),
        }
      : area,
  );
  return {
    ...source,
    blocks: [...curriculum, ...blocks],
    program: {
      ...source.program,
      totalCredits: 31,
      areas: [
        ...areas,
        {
          label: 'Graduate-only coursework (overlaps other areas)',
          hours: 12,
          groups: [
            {
              label: 'Graduate-only coursework',
              choose: null,
              cap: { hours: 12, courses: null },
              courses: choices.map((choice) => ({
                code: choice.codes[0],
                title:
                  context.courses.find(
                    (course) => course.code === choice.codes[0],
                  )?.title ?? choice.codes[0],
                credits: choice.credits,
              })),
            },
          ],
        },
        {
          label: 'GradFIRST (additional to the 30-hour program)',
          hours: 1,
          groups: [
            {
              label: 'GradFIRST',
              choose: null,
              courses: [{ code: 'GRSC 7001', title: 'GradFIRST', credits: 1 }],
            },
          ],
        },
      ],
    },
  };
}

function graduateProgress(
  program: ProgramRequirements,
  have: Set<string>,
  context: PlanningContext,
) {
  const independent = (label: string) =>
    label === 'Graduate-only coursework (overlaps other areas)';
  const creditsByCode = new Map(
    context.courses.map((course) => [course.code, course.credits]),
  );
  return [
    ...areaProgress(
      {
        ...program,
        areas: program.areas.filter((area) => !independent(area.label)),
      },
      have,
      context.equivalents,
      { creditsByCode },
    ),
    ...areaProgress(
      {
        ...program,
        areas: program.areas.filter((area) => independent(area.label)),
      },
      have,
      context.equivalents,
      { creditsByCode },
    ),
  ];
}

function namedCodes(blocks: PlanRequirement[]): Set<string> {
  return new Set(
    blocks.flatMap(({ rule }) =>
      'choices' in rule ? rule.choices.flatMap((choice) => choice.codes) : [],
    ),
  );
}

/** Prerequisite preparation belongs before the bachelor's finish, not in graduate credit. */
function graduatePreparation(
  input: AutoplanInput,
  graduate: CombinedDegreeSource,
): PlanRequirement[] {
  const available = new Set([
    ...input.requirements.flatMap((block) =>
      block.rule.kind === 'all'
        ? block.rule.choices.flatMap((choice) =>
            choice.codes.length === 1 ? choice.codes : [],
          )
        : [],
    ),
    ...input.prior.courseCodes,
    ...input.prior.exemptCodes,
  ]);
  // Snapshot the actual preparation; do not transitively expand newly added aliases.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const code of [...available])
    for (const alias of input.context.equivalents?.get(code) ?? [])
      available.add(alias);
  const byCode = new Map(
    input.context.courses.map((course) => [course.code, course]),
  );
  const needed = new Set<string>();
  const visited = new Set<string>();
  const visit = (code: string) => {
    if (visited.has(code)) return;
    visited.add(code);
    for (const group of input.context.prereqs?.get(code)?.groups ?? []) {
      if (
        group.any.some(
          (candidate) => available.has(candidate) || needed.has(candidate),
        )
      )
        continue;
      const candidate = group.any.find(
        (candidate) => !graduateCode(candidate) && byCode.has(candidate),
      );
      if (!candidate) continue;
      needed.add(candidate);
      visit(candidate);
    }
  };
  for (const block of graduate.blocks)
    if (block.rule.kind === 'all') {
      for (const choice of block.rule.choices)
        if (choice.codes.length === 1) visit(choice.codes[0]);
    }
  return [...needed].map((code) => ({
    id: `double-dawgs:preparation:${code}`,
    areaId: 'double-dawgs:preparation',
    areaLabel: 'Graduate preparation',
    label: code,
    hours: byCode.get(code)!.credits,
    note: 'Undergraduate prerequisite for the graduate stage; not graduate degree credit.',
    url: graduate.url ?? '',
    rule: {
      kind: 'all',
      choices: [{ codes: [code], credits: byCode.get(code)!.credits }],
    },
  }));
}

/** A dual number alone does not authorize shared credit: the pathway must name it too. */
export function doubleDawgsOptions(
  pathway: DoubleDawgsPathway,
  undergraduate: CombinedDegreeSource,
  graduate: CombinedDegreeSource,
  courses: Map<string, Course>,
  dualLevel: Map<string, string>,
): SharedCourse[] {
  return doubleDawgsCourseList(pathway, graduate, courses, dualLevel).flatMap(
    (row) => row.option ?? [],
  );
}

export function sharedCreditLimit(pathway: DoubleDawgsPathway): number {
  const cap = pathway.curriculum?.match(
    /(?:up to|maximum of|no more than)\s+(\d+)\s+(?:credit\s+)?hours/i,
  );
  return Math.min(12, cap ? Number(cap[1]) : 12);
}

export function selectSharedCourses(
  pathway: DoubleDawgsPathway,
  options: SharedCourse[],
  requested?: string[],
  completed: string[] = [],
): SharedCourse[] {
  const held = new Set(completed.map(normalize));
  const choices =
    requested === undefined
      ? options
      : requested.flatMap(
          (code) => options.find((option) => option.code === code) ?? [],
        );
  let hours = 0;
  let optional = 0;
  const seen = new Set<string>();
  return choices.filter((course) => {
    // Undergraduate credit never becomes graduate credit retrospectively.
    if (
      seen.has(course.code) ||
      (course.undergraduateCode !== course.code &&
        held.has(course.undergraduateCode)) ||
      hours + course.credits > sharedCreditLimit(pathway)
    )
      return false;
    const isOptional =
      pathway.id === '17003' &&
      !['PHIL 6510', 'CSCI 6550'].includes(course.code);
    if (isOptional && optional + course.credits > 6) return false;
    seen.add(course.code);
    hours += course.credits;
    if (isOptional) optional += course.credits;
    return true;
  });
}

/** Change only exact course-code values in structured requirement data. Never rewrite prose. */
export function sharedUndergraduateRequirements<T>(
  value: T,
  shared: SharedCourse[],
): T {
  const replacements = new Map(
    shared.map((course) => [course.undergraduateCode, course.code]),
  );
  const visit = (part: unknown): unknown => {
    if (typeof part === 'string') return replacements.get(part) ?? part;
    if (Array.isArray(part)) return part.map(visit);
    if (part && typeof part === 'object')
      return Object.fromEntries(
        Object.entries(part).map(([key, child]) => [key, visit(child)]),
      );
    return part;
  };
  return visit(value) as T;
}

export interface DoubleDawgsBuild {
  undergraduate: AutoplanInput;
  undergraduateProgram: ProgramRequirements;
  graduate: CombinedDegreeSource;
  pathway: DoubleDawgsPathway;
  shared: SharedCourse[];
  graduateFinish: DegreeStageTerm;
}

/** Reconcile overlapping requirements, then remove genuinely surplus picks. */
function trimGraduateOverlap(
  generated: GeneratedPlan,
  input: AutoplanInput,
  program: ProgramRequirements,
  undergraduate = false,
): GeneratedPlan {
  const byId = new Map(
    input.context.courses.map((course) => [course.id, course]),
  );
  const held = new Set(input.prior.courseCodes);
  let plan = generated.plan;
  const progress = (board: PlanState) => {
    const have = new Set([
      ...held,
      ...board.terms.flatMap((term) =>
        term.courseIds.flatMap((id) => byId.get(id)?.code ?? []),
      ),
    ]);
    return undergraduate
      ? areaProgress(program, have, input.context.equivalents, {
          allowCrossAreaOverlap: true,
          creditsByCode: new Map(
            input.context.courses.map((course) => [
              course.code,
              course.credits,
            ]),
          ),
        })
      : graduateProgress(program, have, input.context);
  };
  const bookedFor = { ...generated.bookedFor };
  const byCode = new Map(
    input.context.courses.map((course) => [course.code, course]),
  );
  const score = qualityScorer({
    ...input,
    priorities: input.preferences?.priorities,
  });
  const blocking = (board: PlanState) =>
    validatePlan(board, input.context, {
      minimumTermCredits: 0,
      standingHours: input.standingHours,
      priorCredits: generated.credits.prior,
    }).filter(
      (issue) =>
        issue.severity === 'error' ||
        issue.id.startsWith('ap-offering-') ||
        /^ap-prereq-(?!check|text)/.test(issue.id),
    );
  // A course credited to an earlier row cannot fill a later row again. Repair
  // those real shortfalls with an eligible, named course, never generic hours.
  const repairMissing = (board: PlanState): PlanState => {
    let plan = board;
    for (let pass = 0; pass < 24; pass++) {
      const before = progress(plan);
      const missing = before.filter(
        (row) =>
          !row.satisfied &&
          !/(?:^|: )(?:general|free) electives?\b/i.test(row.area.label),
      );
      if (!missing.length) break;
      const have = new Set([
        ...held,
        ...plan.terms.flatMap((term) =>
          term.courseIds.flatMap((id) => byId.get(id)?.code ?? []),
        ),
      ]);
      const allowed = new Set(blocking(plan).map((issue) => issue.id));
      const choices = [
        ...new Set(
          missing.flatMap((row) =>
            row.area.groups.flatMap((group) =>
              group.courses.flatMap((course) => [
                course.code,
                ...(course.alternatives ?? []).map((alt) => alt.code),
              ]),
            ),
          ),
        ),
      ]
        .flatMap((code) =>
          !have.has(code) && byCode.has(code) ? [byCode.get(code)!] : [],
        )
        .sort(
          (a, b) =>
            score(b.code).score - score(a.code).score ||
            a.credits - b.credits ||
            a.code.localeCompare(b.code),
        );
      let repaired = false;
      for (const course of choices) {
        for (const term of plan.terms) {
          const codes = [
            ...term.courseIds.flatMap((id) => byId.get(id)?.code ?? []),
            course.code,
          ];
          if (
            planCreditRange(codes, input.context).min >
            (term.season === 'Summer' ? 9 : 18)
          )
            continue;
          const candidate = {
            ...plan,
            terms: plan.terms.map((row) =>
              row.id === term.id
                ? { ...row, courseIds: [...row.courseIds, course.id] }
                : row,
            ),
          };
          const after = progress(candidate);
          if (
            !after.some(
              (row, index) =>
                !before[index].satisfied &&
                (row.satisfied || row.earned > before[index].earned),
            ) ||
            after.some(
              (row, index) =>
                (before[index].satisfied && !row.satisfied) ||
                row.earned < before[index].earned,
            ) ||
            blocking(candidate).some((issue) => !allowed.has(issue.id))
          )
            continue;
          plan = candidate;
          const requirement = input.requirements.find(
            (block) =>
              'choices' in block.rule &&
              block.rule.choices.some((choice) =>
                choice.codes.includes(course.code),
              ),
          );
          if (requirement) bookedFor[course.code] = requirement.id;
          repaired = true;
          break;
        }
        if (repaired) break;
      }
      if (!repaired) break;
    }
    return plan;
  };
  const original = progress(plan);
  const required = input.requirements.flatMap((block) =>
    block.rule.kind === 'all' ? block.rule.choices : [],
  );
  const allCodes = (board: PlanState) =>
    new Set([
      ...held,
      ...board.terms.flatMap((term) =>
        term.courseIds.flatMap((id) => byId.get(id)?.code ?? []),
      ),
    ]);
  const initiallyPresent = allCodes(plan);
  const mandatory = required.filter((choice) =>
    choice.codes.some((code) => initiallyPresent.has(code)),
  );
  const removable = undergraduate
    ? new Set(generated.electives.map((row) => row.code))
    : null;
  const existingErrors = new Set(
    validatePlan(plan, input.context, {
      minimumTermCredits: 0,
      standingHours: input.standingHours,
    })
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.id),
  );
  for (const term of [...plan.terms].reverse())
    for (const id of [...term.courseIds].reverse()) {
      if (removable && !removable.has(byId.get(id)?.code ?? '')) continue;
      const candidate = {
        ...plan,
        terms: plan.terms.map((row) => ({
          ...row,
          courseIds: row.courseIds.filter((courseId) => courseId !== id),
        })),
      };
      const codes = [
        ...held,
        ...candidate.terms.flatMap((row) =>
          row.courseIds.flatMap((courseId) => byId.get(courseId)?.code ?? []),
        ),
      ];
      if (
        planCreditRange(codes, input.context).min +
          input.prior.unmatchedCredits <
        (program.totalCredits ?? Infinity)
      )
        continue;
      const rows = progress(candidate);
      if (
        rows.some(
          (row, index) =>
            (!undergraduate ||
              !/^(?:general|free) electives?\b/i.test(row.area.label)) &&
            (row.earned < original[index].earned ||
              (original[index].satisfied && !row.satisfied)),
        )
      )
        continue;
      const have = allCodes(candidate);
      if (
        mandatory.some((choice) => !choice.codes.some((code) => have.has(code)))
      )
        continue;
      if (
        validatePlan(candidate, input.context, {
          minimumTermCredits: 0,
          standingHours: input.standingHours,
        }).some(
          (issue) =>
            issue.severity === 'error' && !existingErrors.has(issue.id),
        )
      )
        continue;
      plan = candidate;
    }
  // Removing surplus picks creates room for previously unplaceable requirements.
  plan = repairMissing(plan);
  const invalid = (board: PlanState) =>
    validatePlan(board, input.context, {
      minimumTermCredits: 0,
      standingHours: input.standingHours,
    }).filter(
      (issue) =>
        issue.severity === 'error' ||
        issue.id.startsWith('ap-offering-') ||
        /^ap-prereq-(?!check|text)/.test(issue.id),
    );
  const safe = new Set(invalid(plan).map((issue) => issue.id));
  const hours = (ids: string[]) =>
    planCreditRange(
      ids.flatMap((id) => byId.get(id)?.code ?? []),
      input.context,
    ).min;
  if (!undergraduate && plan.terms.length > 1) {
    const last = plan.terms.at(-1)!;
    for (const from of plan.terms.slice(0, -1))
      for (const id of from.courseIds) {
        if (!/Master's (?:Thesis|Project)$/i.test(byId.get(id)?.title ?? ''))
          continue;
        if (
          hours(last.courseIds) + hours([id]) >
          (last.season === 'Summer' ? 9 : 18)
        )
          continue;
        const candidate = {
          ...plan,
          terms: plan.terms.map((term) => ({
            ...term,
            courseIds:
              term.id === from.id
                ? term.courseIds.filter((value) => value !== id)
                : term.id === last.id
                  ? [...term.courseIds, id]
                  : term.courseIds,
          })),
        };
        if (!invalid(candidate).some((issue) => !safe.has(issue.id)))
          plan = candidate;
      }
  }
  // Balance after removing overlapping picks; do not leave an 18-credit fall
  // beside a one-course spring simply because the excess was removed there.
  for (let pass = 0; !undergraduate && pass < 30; pass++) {
    let best: PlanState | null = null;
    let bestGain = 0;
    for (const from of plan.terms)
      for (const to of plan.terms) {
        if (from.id === to.id || hours(from.courseIds) <= hours(to.courseIds))
          continue;
        for (const id of from.courseIds) {
          const course = byId.get(id);
          if (
            !course ||
            /^(?:Master's )?(?:thesis|project|research)$/i.test(course.title)
          )
            continue;
          const h = hours([id]),
            a = hours(from.courseIds),
            b = hours(to.courseIds);
          const gain = a * a + b * b - (a - h) ** 2 - (b + h) ** 2;
          if (gain <= bestGain || b + h > (to.season === 'Summer' ? 9 : 18))
            continue;
          if (
            input.context.offeringPublished?.has(course.code) &&
            !course.offeredIn.includes(to.season)
          )
            continue;
          const candidate = {
            ...plan,
            terms: plan.terms.map((term) => ({
              ...term,
              courseIds:
                term.id === from.id
                  ? term.courseIds.filter((value) => value !== id)
                  : term.id === to.id
                    ? [...term.courseIds, id]
                    : term.courseIds,
            })),
          };
          if (invalid(candidate).some((issue) => !safe.has(issue.id))) continue;
          best = candidate;
          bestGain = gain;
        }
      }
    if (!best) break;
    plan = best;
  }
  const kept = new Set(
    plan.terms.flatMap((term) =>
      term.courseIds.flatMap((id) => byId.get(id)?.code ?? []),
    ),
  );
  const planned = planCreditRange([...kept], input.context);
  return {
    ...generated,
    plan,
    bookedFor,
    terms: generated.terms.map((term) => {
      const codes = plan.terms
        .find((row) => row.id === term.id)!
        .courseIds.flatMap((id) => byId.get(id)?.code ?? []);
      const load = termLoad(codes, input.context.grades ?? new Map());
      return {
        ...term,
        codes,
        credits: planCreditRange(codes, input.context),
        load: {
          ...load,
          bandVerdict: load.verdict,
          unweighed: codes.length - load.weighed,
        },
        notes: [],
      };
    }),
    electives: generated.electives.filter((row) => kept.has(row.code)),
    credits: {
      ...generated.credits,
      planned,
      total: planCreditRange([...kept, ...held], input.context),
    },
  };
}

/** Two independent credit ledgers, joined only by graduate courses taken before the bachelor's finish. */
export function generateDoubleDawgs(input: DoubleDawgsBuild): GeneratedPlan {
  const { undergraduate: original, graduate, pathway, graduateFinish } = input;
  const finish = {
    season: original.horizon.gradSeason,
    year: original.horizon.gradYear,
  };
  if (degreeTermOrder(graduateFinish) <= degreeTermOrder(finish))
    throw new Error(
      "The master's completion term must be after the bachelor's completion term.",
    );
  if (graduateFinish.year > finish.year + 10)
    throw new Error(
      "Choose a graduate completion date within ten years of the bachelor's degree.",
    );
  const firstGraduate = nextRegular(finish);
  if (degreeTermOrder(firstGraduate) > degreeTermOrder(graduateFinish))
    throw new Error(
      "Allow at least one fall or spring graduate term after your bachelor's degree.",
    );
  const byCode = new Map(
    original.context.courses.map((course) => [normalize(course.code), course]),
  );
  const reviewNotes = [
    'Shared credits are a proposed program of study, subject to pathway approval. Graduate admission is separate; GPA, residency, examinations and non-course milestones still need advisor review.',
  ];
  let shared = selectSharedCourses(
    pathway,
    input.shared,
    undefined,
    original.prior.courseCodes,
  );
  const sharedNotBefore: DegreeStageTerm = {
    season: finish.season === 'Fall' ? 'Spring' : 'Fall',
    year: finish.season === 'Fall' ? finish.year : finish.year - 1,
  };
  const preparation = graduatePreparation(original, graduate);
  let ug: GeneratedPlan;
  // Later repair passes can move a course: reject any invalid shared placement
  // and rebuild the bachelor\'s requirements instead of granting fictitious savings.
  for (;;) {
    const windows = new Map(
      shared.map((course) => [course.code, sharedNotBefore]),
    );
    const equivalents = new Map(original.context.equivalents);
    for (const course of shared) {
      equivalents.set(course.code, [
        ...(equivalents.get(course.code) ?? []),
        course.undergraduateCode,
      ]);
      equivalents.set(course.undergraduateCode, [
        ...(equivalents.get(course.undergraduateCode) ?? []),
        course.code,
      ]);
    }
    const requirements = [
      ...sharedUndergraduateRequirements(original.requirements, shared),
      ...preparation,
    ];
    // Pin selected shared courses even when their undergraduate row is optional.
    requirements.push(
      ...shared.map(
        (course): PlanRequirement => ({
          id: `double-dawgs:${pathway.id}:${course.code}`,
          areaLabel: 'Double Dawgs shared courses',
          label: course.code,
          url: pathway.url,
          areaId: `double-dawgs:${pathway.id}`,
          hours: course.credits,
          note: 'Proposed shared graduate credit; pathway approval required.',
          rule: {
            kind: 'all',
            choices: [{ codes: [course.code], credits: course.credits }],
          },
        }),
      ),
    );
    const ugContext = {
      ...original.context,
      equivalents,
      courseNotBefore: windows,
    };
    const graduateHeld = original.prior.courseCodes.filter(
      (code) =>
        graduateCode(code) && !shared.some((course) => course.code === code),
    );
    const ugInput = {
      ...original,
      requirements,
      context: ugContext,
      prior: {
        ...original.prior,
        courseCodes: original.prior.courseCodes.filter(
          (code) => !graduateHeld.includes(code),
        ),
        exemptCodes: [...original.prior.exemptCodes, ...graduateHeld],
      },
    };
    ug = trimGraduateOverlap(
      generatePlan(ugInput),
      ugInput,
      sharedUndergraduateRequirements(input.undergraduateProgram, shared),
      true,
    );
    const invalid = new Set<string>();
    for (const course of shared) {
      if (original.prior.courseCodes.includes(course.code)) continue;
      const term = ug.plan.terms.find((term) =>
        term.courseIds.includes(byCode.get(course.code)?.id ?? ''),
      );
      if (
        !term ||
        degreeTermOrder(term) < degreeTermOrder(windows.get(course.code)!) ||
        degreeTermOrder(term) > degreeTermOrder(finish)
      )
        invalid.add(course.code);
    }
    for (const issue of validatePlan(ug.plan, ugContext, {
      minimumTermCredits: 0,
      priorCredits: ug.credits.prior,
    })) {
      if (issue.severity !== 'error' || !issue.courseId) continue;
      for (const course of shared)
        if (byCode.get(course.code)?.id === issue.courseId)
          invalid.add(course.code);
    }
    if (!invalid.size) break;
    reviewNotes.push(
      `${[...invalid].join(', ')} could not fit as shared courses before the bachelor's finish with their prerequisites. They remain graduate requirements; no shared-credit discount was applied for them.`,
    );
    shared = shared.filter((course) => !invalid.has(course.code));
  }
  const ugCodes = ug.terms.flatMap((term) => term.codes);
  const graduateNames = namedCodes(graduate.blocks);
  const graduatePrior = [
    ...new Set([
      ...shared.map((course) => course.code),
      ...original.prior.courseCodes.filter(
        (code) => graduateCode(code) && graduateNames.has(code),
      ),
    ]),
  ];
  const curriculumReadable =
    graduateNames.size > 0 &&
    !graduate.blocks.some(
      ({ rule }) =>
        rule.kind === 'unparsed' ||
        (rule.kind === 'hours' && rule.source === 'parser-gap'),
    );
  const requiredGraduate = new Set(
    graduate.blocks.flatMap((block) =>
      block.rule.kind === 'all'
        ? block.rule.choices.flatMap((choice) => choice.codes)
        : [],
    ),
  );
  const priorMaterial = new Set(
    [...original.prior.courseCodes, ...ugCodes].flatMap((code) => [
      code,
      ...(original.context.equivalents?.get(code) ?? []),
    ]),
  );
  const avoidRetaking = new Set(
    [...graduateNames].filter((code) => {
      const under = original.context.undergraduateCounterparts?.get(code);
      return (
        !requiredGraduate.has(code) &&
        !graduatePrior.includes(code) &&
        under &&
        priorMaterial.has(under)
      );
    }),
  );
  // Do not give the master's any bachelor's/AP/transfer/estimated hours. Those
  // courses may clear prerequisites, but never earn graduate degree credit.
  const graduateInput: AutoplanInput = {
    ...original,
    requirements: graduate.blocks.map((block) =>
      block.rule.kind === 'pool'
        ? {
            ...block,
            rule: {
              ...block.rule,
              choices: block.rule.choices.filter((choice) =>
                choice.codes.some((code) => !avoidRetaking.has(code)),
              ),
            },
          }
        : block,
    ),
    programId: graduate.program.id,
    programName: graduate.program.name,
    programCollege: graduate.program.college,
    context: {
      ...original.context,
      courses: original.context.courses.filter(
        (course) =>
          !graduateCode(course.code) ||
          (graduateNames.has(course.code) && !avoidRetaking.has(course.code)),
      ),
    },
    horizon: {
      ...original.horizon,
      startSeason: firstGraduate.season,
      startYear: firstGraduate.year,
      gradSeason: graduateFinish.season,
      gradYear: graduateFinish.year,
      stated: true,
    },
    prior: {
      known: original.prior.known,
      courseCodes: graduatePrior,
      exemptCodes: [
        ...new Set([
          ...ugCodes,
          ...original.prior.courseCodes,
          ...original.prior.exemptCodes,
        ]),
      ].filter((code) => !graduatePrior.includes(code)),
      unmatchedCredits: 0,
    },
    degreeTotal: graduate.program.totalCredits,
    electiveHoursLimit: graduate.electiveHours ?? 0,
    // Only courses in the graduate curriculum can fill its remaining hours.
    // A parser gap never turns into an unrestricted graduate elective.
    fillToDegreeTotal: curriculumReadable,
    standingHours: { freshman: 0, sophomore: 0, junior: 0, senior: 0 },
    electiveLevelRange: { min: 600, maxExclusive: 1000 },
    autoPrerequisiteLevelRange: { min: 600, maxExclusive: 1000 },
    preferences: {
      ...original.preferences,
      creditsPerTerm: { min: 9, target: 9, max: 18 },
    },
  };
  const gr = trimGraduateOverlap(
    generatePlan(graduateInput),
    graduateInput,
    graduate.program,
  );
  if (!curriculumReadable)
    reviewNotes.push(
      'The graduate catalog snapshot does not name a complete curriculum. Graduate terms are included, but missing requirements need advisor-entered courses; this is not a complete degree plan.',
    );
  if (/\([^)]*\)/.test(pathway.graduate))
    reviewNotes.push(
      `Confirm the ${pathway.graduate} option against the graduate requirements. A pathway's concentration or thesis option may add rules not represented by the general degree page.`,
    );
  if (
    pathway.additionalRequirements &&
    !/^(?:n\/?a|none)\.?$/i.test(pathway.additionalRequirements.trim())
  )
    reviewNotes.push(
      `Pathway-specific requirements to review: ${pathway.additionalRequirements}`,
    );
  const sharedHours = shared.reduce((sum, course) => sum + course.credits, 0);
  const degreeTotal =
    original.degreeTotal && graduate.program.totalCredits
      ? original.degreeTotal + graduate.program.totalCredits - sharedHours
      : null;
  const terms = [
    ...ug.plan.terms,
    ...gr.plan.terms.map((term) => ({
      ...term,
      year: Math.max(...ug.plan.terms.map((term) => term.year)) + term.year,
    })),
  ];
  // The scheduler expands equivalents for prerequisite checks. Those
  // aliases are not additional classes the student actually completed.
  const completedCourseIds = [
    ...new Set(
      original.prior.courseCodes.flatMap((code) => byCode.get(code)?.id ?? []),
    ),
  ];
  const planned = planCreditRange(
    terms
      .flatMap((term) => term.courseIds)
      .flatMap(
        (id) =>
          original.context.courses.find((course) => course.id === id)?.code ??
          [],
      ),
    original.context,
  );
  const priorCredits =
    planCreditRange(original.prior.courseCodes, original.context).min +
    original.prior.unmatchedCredits;
  const notes = [
    `Double Dawgs: ${pathway.name}. Bachelor's target: ${finish.season} ${finish.year}; master's target: ${graduateFinish.season} ${graduateFinish.year}.`,
    `${original.degreeTotal ?? 'Unconfirmed'} bachelor's credits + ${graduate.program.totalCredits ?? 'unconfirmed'} master's credits - ${sharedHours} shared credits = ${degreeTotal ?? 'an unconfirmed number of'} unique credits. Shared courses appear once on the schedule, at the graduate level.`,
    ...reviewNotes,
    ...ug.notes.map((note) => `Bachelor's: ${note}`),
    `Master's: ${gr.credits.total.min} credits, including ${sharedHours} shared credits. ${graduate.program.id === '19170' ? 'This includes the 30-hour AI program of study and the additional 1-credit GradFIRST seminar; at least 12 coursework credits must be graduate-only, excluding thesis and research.' : 'The graduate degree has its own requirement and credit checks.'}`,
    ...gr.unsatisfied
      .filter((row) => row.reason !== 'filled-by-electives')
      .map((row) => `Master's: ${row.message}`),
  ];
  return {
    ...ug,
    plan: {
      ...ug.plan,
      graduationLabel: `${graduateFinish.season} ${graduateFinish.year}`,
      terms,
      completedCourseIds,
      doubleDawgs: {
        pathwayId: pathway.id,
        pathwayName: pathway.name,
        source: pathway.url,
        graduateProgramId: graduate.program.id,
        undergraduateFinish: finish,
        graduateFinish,
        undergraduateCredits: original.degreeTotal ?? 0,
        graduateCredits: graduate.program.totalCredits ?? 0,
        shared,
        sharedNotBefore,
        maxSharedCredits: sharedCreditLimit(pathway),
        reviewNotes,
        graduateEligibleCodes: [...graduateNames],
        curriculumIncomplete: !curriculumReadable,
      },
    },
    terms: [
      ...ug.terms,
      ...gr.terms.map((term, i) => ({ ...term, index: ug.terms.length + i })),
    ],
    pools: [...ug.pools, ...gr.pools],
    unsatisfied: [...ug.unsatisfied, ...gr.unsatisfied],
    notPlaced: [...ug.notPlaced, ...gr.notPlaced],
    electives: [...ug.electives, ...gr.electives],
    bookedFor: { ...ug.bookedFor, ...gr.bookedFor },
    addedPrerequisites: [...ug.addedPrerequisites, ...gr.addedPrerequisites],
    satisfiedByPriorCredit: [
      ...ug.satisfiedByPriorCredit,
      ...gr.satisfiedByPriorCredit.filter(
        (row) =>
          !row.codes.some((code) =>
            shared.some((course) => course.code === code),
          ),
      ),
    ],
    credits: {
      ...ug.credits,
      prior: priorCredits,
      planned,
      total: {
        ...planned,
        min: planned.min + priorCredits,
        max: planned.max + priorCredits,
      },
      degreeTotal,
      unaccounted: null,
    },
    notes,
    earlyFinish: undefined,
  };
}

/** Recompute from the edited board. Moving a shared course past graduation revokes its bachelor's credit. */
export function doubleDawgsLedger(
  plan: PlanState,
  context: PlanningContext,
  priorCodes: string[],
  undergraduateExtraCredits = 0,
) {
  const config = plan.doubleDawgs;
  if (!config) return null;
  const byId = new Map(context.courses.map((course) => [course.id, course]));
  const codeOf = (id: string) => byId.get(id)?.code;
  const held = new Set(priorCodes.map(normalize));
  const ug = new Set([...held].filter((code) => !graduateCode(code)));
  const eligible = (code: string) =>
    graduateCode(code) &&
    (!config.graduateEligibleCodes ||
      config.graduateEligibleCodes.includes(code));
  const gr = new Set([...held].filter(eligible));
  const before = plan.terms.filter(
    (term) =>
      degreeTermOrder(term) <= degreeTermOrder(config.undergraduateFinish),
  );
  const after = plan.terms.filter(
    (term) =>
      degreeTermOrder(term) > degreeTermOrder(config.undergraduateFinish),
  );
  for (const term of before)
    for (const id of term.courseIds) {
      const code = codeOf(id);
      if (code && !graduateCode(code)) ug.add(code);
    }
  for (const term of after)
    for (const id of term.courseIds) {
      const code = codeOf(id);
      if (code && eligible(code)) gr.add(code);
    }
  const validShared = config.shared.filter(
    (course) =>
      held.has(course.code) ||
      before.some(
        (term) =>
          (!config.sharedNotBefore ||
            degreeTermOrder(term) >= degreeTermOrder(config.sharedNotBefore)) &&
          term.courseIds.includes(
            context.courses.find((candidate) => candidate.code === course.code)
              ?.id ?? '',
          ),
      ),
  );
  for (const course of validShared) {
    ug.add(course.code);
    gr.add(course.code);
  }
  const sharedCredits = validShared.reduce(
    (sum, course) => sum + course.credits,
    0,
  );
  return {
    undergraduateCodes: [...ug],
    graduateCodes: [...gr],
    sharedCredits,
    shared: validShared,
    undergraduateCredits:
      planCreditRange([...ug], context).min + undergraduateExtraCredits,
    graduateCredits: planCreditRange([...gr], context).min,
    requiredUniqueCredits:
      config.undergraduateCredits + config.graduateCredits - sharedCredits,
  };
}

/** These equivalences apply only to approved graduate-number substitutions in this draft. */
export function doubleDawgsContext(
  plan: PlanState | null,
  context: PlanningContext | null,
): PlanningContext | null {
  if (!plan?.doubleDawgs || !context) return context;
  const equivalents = new Map(context.equivalents);
  for (const course of plan.doubleDawgs.shared) {
    if (!course.undergraduateCode) continue;
    // A graduate course clears its undergraduate prerequisite counterpart,
    // but an undergraduate course never satisfies a graduate requirement.
    equivalents.set(course.code, [
      ...new Set([
        ...(equivalents.get(course.code) ?? []),
        course.undergraduateCode,
      ]),
    ]);
  }
  return { ...context, equivalents };
}

export function doubleDawgsProgress(
  plan: PlanState,
  context: PlanningContext,
  undergraduate: ProgramRequirements,
  graduate: ProgramRequirements,
  priorCodes: string[],
  extra = 0,
) {
  const ledger = doubleDawgsLedger(plan, context, priorCodes, extra);
  if (!ledger || !plan.doubleDawgs) return [];
  const ug = sharedUndergraduateRequirements(
    undergraduate,
    plan.doubleDawgs.shared.filter((course): course is SharedCourse =>
      Boolean(course.undergraduateCode),
    ),
  );
  const totalRow = (label: string, earned: number, target: number) => ({
    area: { label, hours: target, groups: [] },
    earned,
    percent: target ? Math.min(100, Math.round((earned / target) * 100)) : 0,
    satisfied: target > 0 && earned >= target,
  });
  return [
    totalRow(
      "Bachelor's credits",
      ledger.undergraduateCredits,
      plan.doubleDawgs.undergraduateCredits,
    ),
    ...areaProgress(
      ug,
      new Set(ledger.undergraduateCodes),
      context.equivalents,
      {
        allowCrossAreaOverlap: true,
        creditsByCode: new Map(
          context.courses.map((course) => [course.code, course.credits]),
        ),
      },
    )
      .filter((row) => !/^(?:general|free) electives?\b/i.test(row.area.label))
      .map((row) => ({
        ...row,
        area: { ...row.area, label: `Bachelor's: ${row.area.label}` },
      })),
    totalRow(
      "Master's credits",
      ledger.graduateCredits,
      plan.doubleDawgs.graduateCredits,
    ),
    ...graduateProgress(graduate, new Set(ledger.graduateCodes), context).map(
      (row) => ({
        ...row,
        area: { ...row.area, label: `Master's: ${row.area.label}` },
      }),
    ),
  ];
}

export function doubleDawgsIssues(
  plan: PlanState,
  context: PlanningContext,
  priorCodes: string[],
  extra = 0,
): PlanIssue[] {
  const config = plan.doubleDawgs;
  const ledger = doubleDawgsLedger(plan, context, priorCodes, extra);
  if (!config || !ledger) return [];
  const issues: PlanIssue[] = [];
  if (config.curriculumIncomplete)
    issues.push({
      id: 'double-dawgs-curriculum',
      severity: 'error',
      title: 'Graduate requirements need review',
      message:
        'Some graduate requirements are missing from the catalog snapshot. This combined draft is incomplete even if its credit totals are met. Consult the linked pathway and degree pages with your advisor.',
      termId: '',
    });
  for (const [name, have, need] of [
    ["bachelor's", ledger.undergraduateCredits, config.undergraduateCredits],
    ["master's", ledger.graduateCredits, config.graduateCredits],
  ] as const) {
    if (!need || have < need)
      issues.push({
        id: `double-dawgs-${name}-credits`,
        severity: 'error',
        title: `Incomplete ${name} stage`,
        message: need
          ? `The ${name} stage has ${have} of ${need} required credits. Credits from the other degree cannot fill this gap.`
          : `The ${name} credit requirement is not yet confirmed. Review the published degree page.`,
        termId: '',
      });
  }
  for (const term of plan.terms)
    for (const id of term.courseIds) {
      const course = context.courses.find((course) => course.id === id);
      if (!course) continue;
      const before =
        degreeTermOrder(term) <= degreeTermOrder(config.undergraduateFinish);
      const shared = config.shared.find((row) => row.code === course.code);
      const tooEarly = Boolean(
        shared &&
        config.sharedNotBefore &&
        degreeTermOrder(term) < degreeTermOrder(config.sharedNotBefore),
      );
      const wrongStage = before
        ? graduateCode(course.code) && !shared
        : !graduateCode(course.code);
      if (wrongStage || (shared && !before))
        issues.push({
          id: `double-dawgs-stage-${term.id}-${id}`,
          severity: 'warning',
          title: 'Check degree stage',
          message: shared
            ? `${course.code} is after the bachelor's finish, so it counts only toward the master's. Move it before that milestone to share its credit.`
            : `${course.code} does not count toward the ${before ? "bachelor's" : "master's"} stage here. Review its placement or approved shared-credit status.`,
          termId: term.id,
          courseId: id,
        });
      if (tooEarly)
        issues.push({
          id: `double-dawgs-early-${term.id}-${id}`,
          severity: 'warning',
          title: 'Shared course scheduled early',
          message: `${course.code} is before the final undergraduate year used for shared coursework in this draft. It is not counted as shared credit here. Move it later or confirm an earlier approved program of study with your advisor.`,
          termId: term.id,
          courseId: id,
        });
      if (shared && before && !tooEarly)
        issues.push({
          id: `double-dawgs-shared-${term.id}-${id}`,
          severity: 'info',
          title: 'Shared graduate credit',
          message: `${course.code}: ${shared.credits} credits count toward both degrees, once in the schedule. It replaces ${shared.undergraduateCode ?? 'undergraduate elective credit'}. Pathway admission and advisor approval are still required.`,
          termId: term.id,
          courseId: id,
        });
      if (degreeTermOrder(term) > degreeTermOrder(config.graduateFinish))
        issues.push({
          id: `double-dawgs-late-${term.id}-${id}`,
          severity: 'error',
          title: 'After the graduate deadline',
          message: `${course.code} is after your master's completion date.`,
          termId: term.id,
          courseId: id,
        });
      if (
        !before &&
        graduateCode(course.code) &&
        config.graduateEligibleCodes &&
        !config.graduateEligibleCodes.includes(course.code)
      )
        issues.push({
          id: `double-dawgs-ineligible-${term.id}-${id}`,
          severity: 'warning',
          title: 'Graduate credit not confirmed',
          message: `${course.code} is not in the graduate curriculum this draft uses. It does not count toward the master's total without an approved substitution.`,
          termId: term.id,
          courseId: id,
        });
    }
  for (const term of plan.terms.filter(
    (term) =>
      degreeTermOrder(term) > degreeTermOrder(config.undergraduateFinish),
  )) {
    const codes = term.courseIds.flatMap(
      (id) => context.courses.find((course) => course.id === id)?.code ?? [],
    );
    const hours = planCreditRange(codes, context).min;
    if (hours < 9 && term.season !== 'Summer')
      issues.push({
        id: `ap-minimum-${term.id}`,
        severity: 'warning',
        title: 'Below graduate full-time load',
        message: `${term.label} has ${hours} credits, below the usual 9-credit graduate full-time load. Confirm final-term and assistantship enrollment rules with your advisor.`,
        termId: term.id,
      });
  }
  if (ledger.sharedCredits > config.maxSharedCredits)
    issues.push({
      id: 'double-dawgs-share-cap',
      severity: 'error',
      title: 'Too many shared credits',
      message: `Only ${config.maxSharedCredits} shared credits are allowed; this plan counts ${ledger.sharedCredits}.`,
      termId: '',
    });
  return issues;
}
