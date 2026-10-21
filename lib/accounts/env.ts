import { env } from 'cloudflare:workers';
import { json, type AccountEnv } from './server';
export function accountEnv(): AccountEnv {
  const bindings = env as AccountEnv;
  return { ...bindings, GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || bindings.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || bindings.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || bindings.NEXT_PUBLIC_SITE_URL };
}
export function accountHandler(handler: (req: Request, env: AccountEnv) => Promise<Response>) {
  return async (req: Request) => {
    try { return await handler(req, accountEnv()); }
    catch { return json({ error: 'Account storage is temporarily unavailable. Your local plan is unchanged.' }, 503); }
  };
}
