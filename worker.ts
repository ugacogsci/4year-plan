import handler from 'vinext/server/fetch-handler';
import { pruneInsights, type InsightsEnv } from './lib/insights/server';
import { pruneAccounts, type AccountEnv } from './lib/accounts/server';

const worker = {
  ...handler,
  async scheduled(_event: ScheduledController, env: InsightsEnv & AccountEnv, context: ExecutionContext) {
    if (env.INSIGHTS_DB) context.waitUntil(pruneInsights(env.INSIGHTS_DB));
    if (env.ACCOUNTS_DB) context.waitUntil(pruneAccounts(env.ACCOUNTS_DB));
  },
};
export default worker;
