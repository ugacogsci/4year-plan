import { accountHandler } from '@/lib/accounts/env';
import { workspaceRoute } from '@/lib/accounts/server';
export const dynamic = 'force-dynamic';
export const GET = accountHandler(workspaceRoute);
export const PUT = accountHandler(workspaceRoute);
export const DELETE = accountHandler(workspaceRoute);
