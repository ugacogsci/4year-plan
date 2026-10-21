import { insightsEnv } from '@/lib/insights/env';
import { allowRequest, bodyJson, json, sameOrigin } from '@/lib/insights/server';
import { cleanFeedback, feedbackText, FEEDBACK_EMAIL } from '@/lib/insights/schema';
export const dynamic = 'force-dynamic';
export function GET() {
  const env = insightsEnv();
  return json({ delivery: env.RESEND_API_KEY && env.FEEDBACK_FROM ? 'server' : 'email' });
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origin not allowed' }, 403);
  if (!await allowRequest(req, 'feedback', 5)) return json({ error: 'Too many reports. Please try again later or email us directly.' }, 429);
  let raw: unknown;
  try { raw = await bodyJson(req, 16000); } catch { return json({ error: 'Please shorten your report.' }, 400); }
  const report = cleanFeedback(raw);
  if (!report) return json({ error: 'Check the message and reply email.' }, 400);
  const env = insightsEnv();
  if (!env.RESEND_API_KEY || !env.FEEDBACK_FROM) return json({ error: 'Automatic email is not configured. Open an email draft instead.', delivery: 'email' }, 503);
  try {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': `orion-feedback-${report.id}` },
      body: JSON.stringify({ from: env.FEEDBACK_FROM, to: [FEEDBACK_EMAIL], subject: `ORION: ${report.kind === 'bug' ? 'bug report' : 'feedback'}`,
        text: feedbackText(report), ...(report.replyTo ? { reply_to: report.replyTo } : {}) }), signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) return json({ error: 'The email service did not accept the report. Try again or open an email draft.' }, 502);
    const receipt = await result.json() as { id?: unknown };
    if (typeof receipt.id !== 'string') return json({ error: 'Could not confirm email delivery. Try again or open an email draft.' }, 502);
    return json({ sent: true });
  } catch { return json({ error: 'Could not confirm email delivery. Try again or open an email draft.' }, 502); }
}
