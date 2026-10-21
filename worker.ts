import handler from 'vinext/server/fetch-handler';
import { pruneInsights, type InsightsEnv } from './lib/insights/server';

const worker = {
  ...handler,
  async scheduled(_event: ScheduledController, env: InsightsEnv, context: ExecutionContext) {
    if (env.INSIGHTS_DB) context.waitUntil(pruneInsights(env.INSIGHTS_DB));
  },
};
export default worker;
