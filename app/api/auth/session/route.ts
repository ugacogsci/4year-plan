import { accountHandler } from '@/lib/accounts/env';
import { sessionRoute, deleteAccount } from '@/lib/accounts/server';
export const dynamic = 'force-dynamic';
export const GET = accountHandler(sessionRoute);
export const DELETE = accountHandler(sessionRoute);
export const POST = accountHandler(deleteAccount);
