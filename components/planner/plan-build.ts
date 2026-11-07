/**
 * The plan build behind Rebuild and the "can't finish" fixes, apart from the
 * page (planner-workspace.tsx composePlan reads the student's answers and
 * settings into a PlanBuildJob; this runs the engine on it).
 *
 * It runs in a worker (plan-build.worker.ts, through plan-build-client.ts), so
 * the page answers while a board builds: since 2026-11-05 a student who asks
 * for a lighter workload, highly rated teaching or a challenge gets two to
 * four builds where there was one, up to about 22 seconds on UGA's densest
 * degrees, and that held the whole page. Only data crosses to the worker, so
 * what the page passed generatePlan as functions is made here from data: the
 * UGA board audit the build weighs a board by (auditUgaBoard), the career
 * matcher (careerFitFor, from the vectors it was made with) and Illinois's
 * prerequisite rule (illinoisPrereqCheck). The page runs the same function
 * itself when a worker cannot (plan-build-client.ts), so the two never read a
 * student differently.
 */
import {
  difficultyEstimatesApply,
  distinctHeld,
  generatePlan,
  planCreditRange,
  spreadHardOutcome,
  type AutoplanInput,
  type GeneratedPlan,
  type PlanningContext,
  type PriorCredit,
  type ValidateOptions,
} from '@/lib/planner/autoplan';
import { needsAttention } from '@/lib/planner/attention';
import { careerFitFor, type CareerFit, type CareerFitSource } from '@/lib/planner/career-embedding';
import { defaultGraduateFinish, doubleDawgsOptions, generateDoubleDawgs, selectSharedCourses, type CombinedDegreeSource } from '@/lib/planner/double-dawgs';
import type { RequirementBlock } from '@/lib/planner/illinois-data';
import { majorCodesOf, minorPlanNotes, planBesideDegree, upperApartNote, upperLevelApart, MINOR_UPPER_APART_HOURS } from '@/lib/planner/illinois-minor-plan';
import { MINOR_ID_PREFIX } from '@/lib/planner/illinois-minors';
import { holdMaybe } from '@/lib/planner/transfer-maybe';
import type { TranscriptRecord } from '@/lib/planner/transcript';
import type { DoubleDawgsPathway } from '@/lib/planner/uga-planning-guidance';
import type { Course, PlanState, SemesterSeason } from '@/lib/planner/types';
import { illinoisProgress } from './illinois-progress';
import type { LoadedMinor } from './illinois-source';
import { livePools } from './live-pools';
import { auditUgaBoard, ugaProgressLoss } from './uga-board-audit';

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** The degree on the board, as the build reads it (planner-workspace.tsx LoadedBundle). */
export interface PlanBuildProgram extends CombinedDegreeSource {
  summary: { id: string };
  blocks: RequirementBlock[];
  doubleDawgsGraduate?: CombinedDegreeSource & { blocks: RequirementBlock[] };
  minors?: LoadedMinor[];
}

/**
 * What a build reads that changes only with the degree, the catalog or the
 * record: sent to a worker once and kept there (plan-build-client.ts).
 */
export interface PlanBuildData {
  context: PlanningContext;
  /** The catalog the page's byCode is made from (planner-workspace.tsx catalog), which a record's hours can differ from the context's courses by. */
  catalog: Course[];
  loaded: PlanBuildProgram;
  /** UGA's dual-level pairs (UgaData.dualLevelCourses), for the audit and Double Dawgs. */
  dualLevel?: Map<string, string>;
  /** Illinois's language table and cross-listings (IllinoisCore), for a minor's degree check. */
  languages?: Parameters<typeof illinoisProgress>[0]['languages'];
  equivalents?: Parameters<typeof illinoisProgress>[0]['equivalents'];
}

/** generatePlan's input apart from the context, the degree's rows (PlanBuildData) and the functions made where the build runs. */
export type PlanBuildInput = Omit<AutoplanInput, 'context' | 'requirements' | 'careerFit' | 'careerAudit' | 'boardAudit' | 'boardAttention' | 'boardProgressLost'>;

/** One build: the board for these settings, or a "can't finish" fix tried (difficultyGate false). */
export interface PlanBuildJob {
  input: PlanBuildInput;
  /**
   * UGA: what the board audit reads besides the board (composePlan's
   * auditOfBoard): the hours no course holds, the hours assumed for terms not
   * on a record, and the validator's settings as they stood when the build
   * began. Null at Illinois, whose build weighs no audit.
   */
  ugaAudit: {
    priorHours: number;
    assumedHours: number;
    coreCredit?: Array<{ area: string; hours: number }>;
    languagePlaced: number | null;
    validation: ValidateOptions;
  } | null;
  /** The record, whose "may be" lines are held for the build (transfer-maybe.ts holdMaybe) and which the audit reads. */
  transcript?: TranscriptRecord | null;
  /** A Double Dawgs board: the pathway, the shared courses the student chose and the graduate finish. */
  doubleDawgs: {
    pathway: DoubleDawgsPathway;
    sharedCodes?: string[];
    graduateFinish: { season: SemesterSeason; year: number } | null;
  } | null;
  /** "Spread my hard classes out" on a board that is not Double Dawgs. */
  spreadHard: boolean;
  /** Illinois: the held codes and published total a minor's degree check reads (null at UGA, which has no minors beside the degree). */
  minors: { heldCodes: string[]; publishedTotal: number | null } | null;
}

export interface PlanBuildResult {
  generated: GeneratedPlan;
  /** The prior the build ended on, when "may be" lines were held: the input compare_programs rebuilds from (lastBuild). */
  heldPrior: PriorCredit | null;
  /** The "may be" lines held off the board (openMaybeOnBoard reopens them). */
  maybeCodes: string[];
  /** The spread's board was kept, so it was built with one hardest course a term. */
  spreadKept: boolean;
  /** The degree's own board before its minors, where minors were planned: compare_programs' base. */
  degreeOnly: GeneratedPlan | null;
}

/**
 * Illinois's prerequisite rule, from illinois-data (illinois-source.tsx sets
 * it on the context). Named here so a worker can set the very same one on its
 * copy of the context, which a function cannot cross to.
 */
export { illinoisPrereqCheck } from '@/lib/planner/illinois-data';

/** The career matcher remade from what it was made with (CareerFit.source), as a worker needs it. */
export function careerFitFromSource(source: CareerFitSource): CareerFit {
  return careerFitFor(source.input, source.vectors);
}

/** The page's byCode (planner-workspace.tsx): the catalog by code, the last of a code standing. */
function byCodeOf(catalog: Course[]): Map<string, Course> {
  const byCode = new Map<string, Course>();
  for (const course of catalog) byCode.set(normCode(course.code), course);
  return byCode;
}

/**
 * generatePlan's input for the job, with its functions made here: at UGA the
 * board audit the build weighs a board by, and the career matcher. Also what
 * compare_programs rebuilds from on the page (builtFromOf).
 */
export function planBuildInput(data: PlanBuildData, job: PlanBuildJob, careerFit: CareerFit | null): AutoplanInput {
  const { context, loaded } = data;
  const ugaAudit = job.ugaAudit;
  /*
   * The audit of a board the build weighs (AutoplanInput.boardAudit and
   * careerAudit): its own held classes, this build's degree, catalog and
   * hours, as the UGA harness audits a candidate. One audit a board: the
   * unmet rows (builtAudit) and the issues (builtAuditIssues) both read it.
   */
  let courseById: Map<string, Course> | null = null;
  const audits = new WeakMap<PlanState, ReturnType<typeof auditUgaBoard>>();
  const auditOfBoard = (board: PlanState, bookedFor?: Record<string, string | null>): ReturnType<typeof auditUgaBoard> => {
    const known = audits.get(board);
    if (known) return known;
    const setup = ugaAudit!;
    courseById ??= new Map(context.courses.map((course) => [course.id, course]));
    const held = board.completedCourseIds.flatMap((id) => courseById?.get(id)?.code ?? []).map(normCode);
    const hours = planCreditRange(distinctHeld(held, context).codes, context).min + setup.priorHours;
    const audit = auditUgaBoard({ board, context, undergraduate: loaded, graduate: loaded.doubleDawgsGraduate, priorCodes: held, bookedFor,
      extraCredits: hours - planCreditRange(held, context).min + setup.assumedHours,
      transcript: job.transcript, dualLevel: data.dualLevel, coreCredit: setup.coreCredit, languagePlaced: setup.languagePlaced,
      validation: { ...setup.validation, programName: loaded.program.name, priorCredits: hours + setup.assumedHours } });
    audits.set(board, audit);
    return audit;
  };
  // Requirement rows the audit leaves unmet, as the board bar counts them (planner-workspace.tsx ugaUnmetRows).
  const builtAudit = (board: PlanState, bookedFor?: Record<string, string | null>): number => {
    const audit = auditOfBoard(board, bookedFor);
    return audit.areas.filter((row) => !row.satisfied).length + audit.issues.filter((issue) => issue.id.startsWith('uga-pool-')).length;
  };
  const builtAuditIssues = (board: PlanState, bookedFor?: Record<string, string | null>) => auditOfBoard(board, bookedFor).issues;
  const isUga = ugaAudit !== null;
  return {
    ...job.input,
    requirements: loaded.blocks,
    context,
    // The degree check holds the matcher's board to the board audit too (AutoplanInput.careerAudit).
    ...(careerFit ? { careerFit, ...(isUga ? { careerAudit: (g: GeneratedPlan) => builtAudit(g.plan, g.bookedFor) } : {}) } : {}),
    // And the free choices' check (AutoplanInput.boardAudit), at UGA by the audit the board bar reads.
    ...(isUga ? { boardAudit: (g: GeneratedPlan) => builtAudit(g.plan, g.bookedFor) } : {}),
    /*
     * The difficulty gate (autoplan.ts difficultyGated) keeps no board with
     * more issues needing attention than the board built without the
     * difficulty estimates; at UGA the audit's own issues, read as the board
     * bar reads them. A "can't finish" fix builds that board alone
     * (difficultyGate: false): the gate's board never finishes later.
     */
    ...(isUga ? { boardAttention: (g: GeneratedPlan) => builtAuditIssues(g.plan, g.bookedFor).filter(needsAttention).length } : {}),
    // And row by row, as a swap is checked (ugaProgressLoss): fewer unmet rows never buy less of another row.
    ...(isUga ? { boardProgressLost: (g: GeneratedPlan, floor: GeneratedPlan) => ugaProgressLoss(auditOfBoard(floor.plan, floor.bookedFor), auditOfBoard(g.plan, g.bookedFor)) } : {}),
  };
}

/** The input the kept board was built from: the "may be" lines held and the spread's limit (composePlan's builtFrom, which compare_programs rebuilds from). */
export function builtFromOf(input: AutoplanInput, result: Pick<PlanBuildResult, 'heldPrior' | 'spreadKept'>): AutoplanInput {
  const held = result.heldPrior ? { ...input, prior: result.heldPrior } : input;
  return result.spreadKept ? { ...held, preferences: { ...held.preferences, maxHardCourses: 1 } } : held;
}

/**
 * The build: the board for the job's settings, the "may be" lines held, the
 * spread tried where the student asked for it, and an Illinois degree's
 * checked minors beside it. Throws what generatePlan throws.
 */
export function runPlanBuild(data: PlanBuildData, job: PlanBuildJob, careerFit: CareerFit | null): PlanBuildResult {
  const { context, loaded } = data;
  const byCode = byCodeOf(data.catalog);
  let planInput = planBuildInput(data, job, careerFit);
  /**
   * A transfer line the planner only thinks "may be" a course (Parkland's
   * BUS 101 "may be BUS 101"): where the board would book that course, it
   * is held for the build instead, with the hours held unchanged, so the
   * board does not schedule what the student may already have; the board
   * then leaves its requirement open until the student confirms or rejects
   * the line (transfer-maybe.ts). No such line, the same one build.
   */
  const dd = job.doubleDawgs;
  const held = holdMaybe(planInput.prior, job.transcript, (code) => byCode.get(normCode(code))?.credits ?? null, (p) => {
    if (dd && loaded.doubleDawgsGraduate && data.dualLevel) {
      const options = doubleDawgsOptions(dd.pathway, loaded, loaded.doubleDawgsGraduate, byCode, data.dualLevel);
      return generateDoubleDawgs({ undergraduate: { ...planInput, prior: p }, undergraduateProgram: loaded.program, graduate: loaded.doubleDawgsGraduate, pathway: dd.pathway,
        shared: selectSharedCourses(dd.pathway, options, dd.sharedCodes, p.courseCodes),
        graduateFinish: dd.graduateFinish ?? defaultGraduateFinish({ season: job.input.horizon.gradSeason, year: job.input.horizon.gradYear }),
      });
    }
    return generatePlan({ ...planInput, prior: p });
  });
  const heldPrior = held.codes.length > 0 ? held.prior : null;
  if (heldPrior) planInput = { ...planInput, prior: heldPrior };
  let generated = held.generated;
  let builtFrom = planInput;
  let spreadKept = false;
  /**
   * "Spread my hard classes out": one hardest-band course a term, kept only
   * when it costs nothing. At one a term a Computer Engineering plan with
   * six required hardest-band courses and six terms had nowhere for a
   * seventh, grew two terms and nineteen credits, and said nothing about
   * why. spreadHardOutcome decides, and its note names the check that
   * failed or says what the kept plan really does.
   */
  if (job.spreadHard && !difficultyEstimatesApply(context, job.input.preferences?.priorities)) {
    // At UGA on Balanced (or another preference) the board has no bands to spread: say how to get it rather than "changed nothing".
    generated.notes.push('At UGA, which courses are hardest is an estimate from student ratings, and the planner uses it only when Preferences is set to Lightest, Best-rated teaching or Challenge me. Choose Lightest in Preferences to spread the hardest courses out, one a term where the degree allows.');
  } else if (job.spreadHard) {
    const spreadInput = { ...planInput, preferences: { ...planInput.preferences, maxHardCourses: 1 } };
    const spread = generatePlan(spreadInput);
    const outcome = spreadHardOutcome(generated, spread, {
      difficulty: (code) => context.grades?.get(code)?.difficulty ?? null,
      bands: context.bands ?? null,
    });
    if (outcome.adopt) {
      generated = spread;
      builtFrom = spreadInput;
      spreadKept = true;
    }
    generated.notes.push(outcome.note);
  }

  /**
   * Illinois minors (beta), degree first: the plan above is the degree's
   * own, and planBesideDegree adds what fits of each checked minor without
   * costing the degree a row the rail shows met, a term over 18 or a term
   * past the finish. compare_programs keeps the degree's own plan above.
   */
  const minorsToPlan = job.minors ? (loaded.minors ?? []).filter((minor) => minor.checked) : [];
  let degreeOnly: GeneratedPlan | null = null;
  if (job.minors && minorsToPlan.length > 0) {
    const { heldCodes, publishedTotal } = job.minors;
    degreeOnly = generated;
    const codesOf = (g: GeneratedPlan) => g.terms.flatMap((term) => term.codes.map(normCode));
    const degreeRows = (g: GeneratedPlan) => illinoisProgress({
      blocks: loaded.blocks,
      boardCodes: codesOf(g),
      priorCodes: heldCodes,
      byCode,
      pools: livePools({ base: g.pools.filter((pool) => !pool.requirementId.startsWith(MINOR_ID_PREFIX)), blocks: loaded.blocks, boardCodes: codesOf(g), priorCodes: heldCodes, context }),
      language: g.language,
      satisfiedByPriorCredit: g.satisfiedByPriorCredit,
      languages: data.languages ?? null,
      equivalents: data.equivalents ?? undefined,
      degreeTotal: publishedTotal,
      programName: loaded.program.name,
    });
    const before = degreeRows(generated);
    const spreadNote = job.spreadHard ? (generated.notes[generated.notes.length - 1] ?? null) : null;
    const outcome = planBesideDegree(generatePlan, builtFrom, generated, minorsToPlan, {
      heldCodes,
      creditsOf: (code) => byCode.get(normCode(code))?.credits ?? null,
      degreeCheck: (g) => {
        const now = degreeRows(g);
        const lost = before.filter((row, index) => row.satisfied && !now[index]?.satisfied);
        return lost.length > 0 ? `it would leave ${lost.map((row) => row.area.label).join('; ')} short` : null;
      },
    });
    const chosen = outcome.generated;
    const notes = chosen === generated ? [...generated.notes] : [...chosen.notes, ...(spreadNote ? [spreadNote] : [])];
    // The minor's own rows are the rail's to show, with its name on them,
    // and what did not fit is in the notes: its pools, unmet rows and
    // unplaced courses would otherwise reach the review list as the degree's.
    generated = {
      ...chosen,
      pools: chosen.pools.filter((pool) => !pool.requirementId.startsWith(MINOR_ID_PREFIX)),
      unsatisfied: chosen.unsatisfied.filter((row) => !row.requirementId.startsWith(MINOR_ID_PREFIX)),
      notPlaced: chosen.notPlaced.filter((row) => !(row.requirementId ?? '').startsWith(MINOR_ID_PREFIX)),
      notes: [...notes, ...minorPlanNotes(outcome, minorsToPlan)],
    };
    const major = majorCodesOf(generated.bookedFor ?? {}, loaded.blocks);
    for (const minor of minorsToPlan) {
      const counted = illinoisProgress({
        blocks: minor.blocks, boardCodes: codesOf(generated), priorCodes: heldCodes, byCode, pools: [],
        language: null, satisfiedByPriorCredit: [], equivalents: data.equivalents ?? undefined, degreeTotal: null, programName: minor.name,
      }).flatMap((row) => row.codes ?? []);
      const apart = upperLevelApart(counted, major, (code) => byCode.get(normCode(code))?.credits ?? null);
      if (apart.hours < MINOR_UPPER_APART_HOURS) generated.notes.push(upperApartNote(minor.name, apart));
    }
  }
  return { generated, heldPrior, maybeCodes: held.codes, spreadKept, degreeOnly };
}
