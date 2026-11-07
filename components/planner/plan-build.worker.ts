/**
 * The plan build off the page (plan-build.ts says why; plan-build-client.ts
 * is the page's side). Holds the last data and career matcher it was sent, as
 * the page's side counts them, and builds each request in order.
 */
import type { CareerFit } from '@/lib/planner/career-embedding';
import { careerFitFromSource, illinoisPrereqCheck, runPlanBuild, type PlanBuildData } from './plan-build';
import type { PlanBuildReply, PlanBuildRequest } from './plan-build-client';

let held: { key: string; data: PlanBuildData } | null = null;
let career: { key: number; fit: CareerFit } | null = null;

function reply(message: PlanBuildReply) {
  (self as unknown as { postMessage(message: PlanBuildReply): void }).postMessage(message);
}

self.onmessage = (event: MessageEvent<PlanBuildRequest>) => {
  const request = event.data;
  let fit: CareerFit | null = null;
  try {
    if (request.data) {
      // The very rule the page's context holds, which could not cross (illinois-data.ts illinoisPrereqCheck).
      const context = request.prereq === 'illinois' ? { ...request.data.context, prereqCheck: illinoisPrereqCheck } : request.data.context;
      held = { key: request.dataKey, data: { ...request.data, context } };
    }
    if (request.career) career = { key: request.careerKey!, fit: careerFitFromSource(request.career) };
    if (!held || held.key !== request.dataKey) throw new Error('the data for this build was not sent');
    if (request.careerKey !== null) {
      if (!career || career.key !== request.careerKey) throw new Error('the career matcher for this build was not sent');
      fit = career.fit;
    }
  } catch (error) {
    reply({ id: request.id, ok: false, during: 'setup', message: error instanceof Error ? error.message : String(error) });
    return;
  }
  let result: ReturnType<typeof runPlanBuild>;
  try {
    result = runPlanBuild(held.data, request.job, fit);
  } catch (error) {
    reply({ id: request.id, ok: false, during: 'build', message: error instanceof Error ? error.message : 'unknown error' });
    return;
  }
  try {
    reply({ id: request.id, ok: true, result });
  } catch (error) {
    // A board that cannot be handed back is the worker's failure, not the build's: the page builds it.
    reply({ id: request.id, ok: false, during: 'setup', message: error instanceof Error ? error.message : String(error) });
  }
};
