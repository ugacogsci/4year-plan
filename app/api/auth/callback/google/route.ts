import { accountHandler } from '@/lib/accounts/env';
import { googleCallback } from '@/lib/accounts/server';
export const GET = accountHandler(googleCallback);
