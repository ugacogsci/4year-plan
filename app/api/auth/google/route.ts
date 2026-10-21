import { accountHandler } from '@/lib/accounts/env';
import { googleStart } from '@/lib/accounts/server';
export const POST = accountHandler(googleStart);
