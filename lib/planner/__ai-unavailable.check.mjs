/**
 * When an AI call fails, students read a plain sentence, never the API's words
 * (2026-10-30: an out-of-credit account showed "The advisor's model answered
 * 400: Your credit balance is too low to access the Anthropic API...").
 *
 *   - the advisor client (lib/planner/advisor.ts) turns a dropped connection,
 *     a proxy's HTML page or a broken stream into "unavailable right now",
 *     and passes the route's own sentence through;
 *   - the routes (advisor, setup, transcript) never hand error.message to a student;
 *   - the setup assistant falls back to the form with what the student typed.
 *
 * No AI is called: fetch is replaced here.
 *
 *   node lib/planner/__ai-unavailable.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${String(detail).slice(0, 300)}`}`);
}

const U = await import(join(HERE, 'ai-unavailable.ts'));
const A = await import(join(HERE, 'advisor.ts'));

console.log('1. The sentences');
check('unavailable names who, says the plan still works', U.aiUnavailable('ALMA') === 'ALMA is unavailable right now - your plan still works; try again in a bit.');
check('an out-of-credit 400 is told apart from a bad file', U.isOutOfCredit({ message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}' }) && !U.isOutOfCredit({ message: 'messages.0.content.0: the PDF could not be read' }));
check('the log line keeps no key', !/sk-ant-abc123/.test(U.aiFailureForLog({ status: 401, name: 'AuthenticationError', message: 'invalid x-api-key sk-ant-abc123' })));

console.log('2. The advisor client');
const turn = (bot = 'ALMA') => A.runAdvisorTurn({ messages: [], userText: 'hi', board: () => '', bot, schoolName: 'University of Illinois Urbana-Champaign', schoolShort: 'Illinois', execute: async () => ({ ok: true }) });
async function failureWith(fetchImpl, bot) {
  globalThis.fetch = fetchImpl;
  try {
    await turn(bot);
    return null;
  } catch (error) {
    return error;
  }
}
const sse = (events) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const plain = 'ALMA is unavailable right now - your plan still works; try again in a bit.';

let e = await failureWith(async () => { throw new TypeError('Failed to fetch'); });
check('a dropped connection: the plain sentence, marked for the panel', e instanceof A.AdvisorUnavailableError && e.message === plain, e?.message);
e = await failureWith(async () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
check('a proxy\'s HTML error page: the plain sentence', e instanceof A.AdvisorUnavailableError && e.message === plain, e?.message);
e = await failureWith(async () => Response.json({ error: 'The advisor is unavailable right now - your plan still works; try again in a bit.' }, { status: 503 }));
check('the route\'s own sentence passes through', e instanceof A.AdvisorUnavailableError && e.message === 'The advisor is unavailable right now - your plan still works; try again in a bit.', e?.message);
e = await failureWith(async () => sse([{ type: 'text', delta: 'Hel' }, { type: 'error', error: 'The advisor is unavailable right now - your plan still works; try again in a bit.' }]));
check('a stream that fails mid-way: the route\'s sentence', e instanceof A.AdvisorUnavailableError && /unavailable right now/.test(e.message), e?.message);
e = await failureWith(async () => new Response('data: {not json\n\n', { status: 200 }));
check('a garbled stream: the plain sentence, not a parser\'s complaint', e instanceof A.AdvisorUnavailableError && e.message === plain, e?.message);
e = await failureWith(async () => sse([{ type: 'text', delta: 'Hel' }]));
check('a stream that stops without a reply: the plain sentence', e instanceof A.AdvisorUnavailableError && e.message === plain, e?.message);
e = await failureWith(async () => { throw new TypeError('Failed to fetch'); }, 'the assistant');
check('with no name, "The advisor"', e?.message === 'The advisor is unavailable right now - your plan still works; try again in a bit.', e?.message);

console.log('3. The routes and the panels');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const advisorRoute = read('app/api/advisor/route.ts');
check('the advisor route sends no error.message and names no key to a student', !/error\.message/.test(advisorRoute) && !/error: '[^']*ANTHROPIC_API_KEY/.test(advisorRoute) && /aiUnavailable\(\)/.test(advisorRoute));
const transcriptRoute = read('app/api/transcript/route.ts');
check('the transcript route: no status numbers, and out of credit is not blamed on the file', !/returned \$\{/.test(transcriptRoute) && /BadRequestError && !isOutOfCredit\(error\)/.test(transcriptRoute));
const setupRoute = read('app/api/setup/route.ts');
check('the setup route: one sentence for every failure, pointing at the form', /SETUP_UNAVAILABLE = 'The setup assistant is unavailable right now\. Your answers are kept: choose "Enter my details manually"/.test(setupRoute) && !/error\.message/.test(setupRoute));
const panel = read('components/planner/advisor.tsx');
check('the chat panel shows only a sentence written for students', /caught instanceof AdvisorUnavailableError \? caught\.message : aiUnavailable\(/.test(panel) && !/caught\.message : 'The advisor failed\.'/.test(panel));
const setup = read('components/planner/guided-setup.tsx');
check('the setup assistant: no parser or network words, and a way to the form beside the message', /error instanceof SetupUnavailable \? error\.message : SETUP_UNAVAILABLE/.test(setup) && /role="alert"[^\n]*onClick=\{manual\}>Enter my details manually</.test(setup));
check('the form starts from what the conversation learned, the unsent reply included', /onManual\(said\.length > 0 \? withSetupResponse\(answers,/.test(setup) && /draft\.trim\(\)\]/.test(setup) && /onManual=\{\(carried\) => \{ setAnswers\(carried\);/.test(read('components/planner/onboarding.tsx')));
check('a later-year student gets a way past prior credit, so Build my plan can come', /!creditReviewed && !newStudent && <button[^\n]*creditReviewed: true[^\n]*>I&apos;ll add my classes later<\/button>/.test(setup));
const upload = read('components/planner/transcript-upload.tsx');
check('the transcript upload shows no status number', !/reader answered \$\{res\.status\}/.test(upload));

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
