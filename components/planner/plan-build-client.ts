/**
 * The page's side of the plan build in a worker (plan-build.ts says why).
 *
 * The degree's data (PlanBuildData: the planning context, the catalog, the
 * degree) is copied to the worker once and kept there while the same objects
 * stand: copying UGA's is about 17 MB and a fifth of a second on the page,
 * and a build reads it unchanged. The career matcher crosses the same way, by
 * what it was made from. Only the job (the student's settings) crosses on
 * every build.
 *
 * Where a worker cannot be had, cannot take the data or fails, the build runs
 * on the page, as it did before 2026-11-07 (with the page held while it
 * builds): the same function, so the same board. A build that throws throws
 * the same here either way (PlanBuildError), for the page's "could not be
 * generated" line.
 */
import type { PlanningContext } from '@/lib/planner/autoplan';
import type { CareerFit } from '@/lib/planner/career-embedding';
import { illinoisPrereqCheck, runPlanBuild, type PlanBuildData, type PlanBuildJob, type PlanBuildResult } from './plan-build';

/** The build itself threw: the message generatePlan gave. */
export class PlanBuildError extends Error {}
/** A newer board build was asked for before this one finished; its result would be stale. */
export class PlanBuildSuperseded extends Error {}

/** Page to worker: a build, with the data and matcher the worker does not hold yet. */
export interface PlanBuildRequest {
  id: number;
  dataKey: string;
  /** The data, when this worker does not hold it under dataKey: the context without its prerequisite rule (`prereq` names it). */
  data?: PlanBuildData;
  prereq?: 'illinois' | null;
  careerKey: number | null;
  career?: CareerFit['source'];
  job: PlanBuildJob;
}
/** Worker to page. `during` 'setup' is the worker's own failure (the page builds instead); 'build' is the build's. */
export type PlanBuildReply =
  | { id: number; ok: true; result: PlanBuildResult }
  | { id: number; ok: false; during: 'setup' | 'build'; message: string };

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
function idOf(value: object): number {
  let id = objectIds.get(value);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(value, id);
  }
  return id;
}
/** The data's identity: the same context, catalog, degree and tables, the same key. */
function dataKeyOf(data: PlanBuildData): string {
  return [data.context, data.catalog, data.loaded, data.dualLevel, data.languages, data.equivalents]
    .map((part) => (part && typeof part === 'object' ? idOf(part) : 0))
    .join('.');
}

interface Pending {
  resolve: (result: PlanBuildResult) => void;
  reject: (error: Error) => void;
  /** Runs the build on the page instead, when the worker fails it. */
  onPage: () => void;
}

let worker: Worker | null = null;
/** No worker for the rest of this page's life: none could be made, or one failed. */
let broken = false;
/** What the current worker holds: one data and one matcher, the last sent (plan-build.worker.ts keeps the same). */
let holds: { data: string | null; career: number | null } = { data: null, career: null };
const pending = new Map<number, Pending>();
let nextRequestId = 1;

function newWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  try {
    const made = new Worker(new URL('./plan-build.worker.ts', import.meta.url), { type: 'module', name: 'plan-build' });
    made.onmessage = (event: MessageEvent<PlanBuildReply>) => {
      const reply = event.data;
      const waiting = pending.get(reply.id);
      if (!waiting) return;
      pending.delete(reply.id);
      if (reply.ok) waiting.resolve(reply.result);
      else if (reply.during === 'build') waiting.reject(new PlanBuildError(reply.message));
      else {
        console.warn('[plan build] the worker could not build; building on the page.', reply.message);
        giveUp(waiting);
      }
    };
    // A worker that cannot load, or a result that cannot be read: every build waiting goes to the page.
    const fail = (why: unknown) => {
      if (worker !== made) return;
      console.warn('[plan build] the worker failed; building on the page.', why);
      giveUp();
    };
    made.onerror = (event) => {
      event.preventDefault();
      fail(event.message || 'error');
    };
    made.onmessageerror = () => fail('a result could not be read');
    return made;
  } catch (error) {
    console.warn('[plan build] no worker; building on the page.', error);
    broken = true;
    return null;
  }
}

/** No worker from now on: the build that failed, then every build still waiting, goes to the page, so none is left unsettled. */
function giveUp(first?: Pending) {
  broken = true;
  worker?.terminate();
  worker = null;
  holds = { data: null, career: null };
  const waiting = [...pending.values()];
  pending.clear();
  for (const w of first ? [first, ...waiting] : waiting) w.onPage();
}

/** Stop the worker and what it is building: a newer board build makes them stale. A new worker takes the next build. */
function restart() {
  worker?.terminate();
  worker = null;
  holds = { data: null, career: null };
  const waiting = [...pending.values()];
  pending.clear();
  for (const w of waiting) w.reject(new PlanBuildSuperseded('a newer build was asked for'));
}

/** Stop every build under way or waiting, which reject with PlanBuildSuperseded: the student moved to another plan. */
export function cancelPlanBuilds(): void {
  if (pending.size > 0) restart();
}

/**
 * Build in the worker, or on the page where it cannot. A board build
 * (`board`) replaces any build under way, which rejects with
 * PlanBuildSuperseded; a trial waits its turn behind them.
 */
export function buildPlanApart(data: PlanBuildData, job: PlanBuildJob, careerFit: CareerFit | null, opts: { board: boolean }): Promise<PlanBuildResult> {
  const onPage = () => runPlanBuild(data, job, careerFit);
  const prereq = data.context.prereqCheck ? (data.context.prereqCheck === illinoisPrereqCheck ? 'illinois' : 'other') : null;
  // A matcher made without its source, or a prerequisite rule a worker does not know: the page builds.
  const canMove = !(careerFit && !careerFit.source) && prereq !== 'other';
  if (opts.board && pending.size > 0) restart();
  if (!canMove || broken) return pageBuild(onPage);
  worker ??= newWorker();
  const w = worker;
  if (!w) return pageBuild(onPage);
  const id = nextRequestId++;
  const dataKey = dataKeyOf(data);
  const careerKey = careerFit ? idOf(careerFit) : null;
  const request: PlanBuildRequest = { id, dataKey, careerKey, job };
  if (holds.data !== dataKey) {
    const { prereqCheck: _rule, ...context } = data.context;
    request.data = { ...data, context: context as PlanningContext };
    request.prereq = prereq === 'illinois' ? 'illinois' : null;
  }
  if (careerFit && careerKey !== null && holds.career !== careerKey) request.career = careerFit.source;
  return new Promise<PlanBuildResult>((resolve, reject) => {
    const runOnPage = () => {
      pageBuild(onPage).then(resolve, reject);
    };
    pending.set(id, { resolve, reject, onPage: runOnPage });
    try {
      w.postMessage(request);
    } catch (error) {
      // Data the worker cannot be handed (a function where data was expected): this build, those waiting and every later one on the page.
      console.warn('[plan build] the data could not be handed to the worker; building on the page.', error);
      giveUp();
      return;
    }
    holds.data = dataKey;
    if (careerKey !== null) holds.career = careerKey;
  });
}

function pageBuild(build: () => PlanBuildResult): Promise<PlanBuildResult> {
  return new Promise((resolve, reject) => {
    try {
      resolve(build());
    } catch (error) {
      reject(new PlanBuildError(error instanceof Error ? error.message : 'unknown error'));
    }
  });
}
