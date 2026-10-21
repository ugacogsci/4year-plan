import { env } from 'cloudflare:workers';
import type { InsightsEnv } from './server';
export function insightsEnv(): InsightsEnv {
  return { ...(env as InsightsEnv),
    INSIGHTS_ADMIN_TOKEN: process.env.INSIGHTS_ADMIN_TOKEN || (env as InsightsEnv).INSIGHTS_ADMIN_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY || (env as InsightsEnv).RESEND_API_KEY,
    FEEDBACK_FROM: process.env.FEEDBACK_FROM || (env as InsightsEnv).FEEDBACK_FROM };
}
