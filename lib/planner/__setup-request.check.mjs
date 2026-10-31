/**
 * The setup assistant's route (app/api/setup/route.ts) run for real, with the
 * network replaced: the Anthropic SDK's fetch is answered here, so nothing
 * leaves the machine and no model is called. What this pins is the request as
 * it goes over the wire (2026-10-31, the cost cut):
 *
 *   - the model is claude-opus-5: setup forces its record_setup tool, which
 *     Claude Opus 5.5 refuses, so it does not follow the advisor to Opus 5.5;
 *   - the school's catalog, colleges and pathways (nearly all of the context,
 *     the same for every student) come first in the system prompt with the one
 *     cache mark, and the student's own facts come after it, unmarked;
 *   - two students of one school send byte-identical bytes up to the mark, so
 *     the second reads the first's cache;
 *   - the model still gets every key of the browser's context, with the same
 *     values;
 *   - a context that is not a JSON object is sent as it came, unmarked.
 *
 * Run: node lib/planner/__setup-request.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// '@/x' is the project root (tsconfig paths), as in __advisor-route.check.mjs.
const ROOT_URL = pathToFileURL(ROOT + '/').href;
register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT_URL = ${JSON.stringify(ROOT_URL)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = new URL(spec.slice(2), ROOT_URL).href;
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

let failures = 0;
const expect = (cond, msg, detail = '') => {
  if (cond) console.log(`  ok    ${msg}`);
  else { failures += 1; console.log(`  FAIL  ${msg}${detail ? `: ${detail}` : ''}`); }
};

// The SDK's network, answered here: every request is kept; the answer is a plain reply the route turns away.
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
  const message = { id: `msg_${sent.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 47000, output_tokens: 40 } };
  return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json', 'request-id': `req_${sent.length}` } });
};

// A made-up key: the fake network above is the only thing that ever sees it.
process.env.ANTHROPIC_API_KEY = 'sk-ant-offline-check';
const route = await import(join(ROOT, 'app', 'api', 'setup', 'route.ts'));

// The context as guided-setup.tsx writes it: the student's facts first, then the school's shared lists.
const CATALOG = { programs: Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, name: `Program ${i}`, kind: 'major' })) };
const contextFor = (answers, date) => JSON.stringify({
  date, answers, confirmations: { programConfirmed: false, creditReviewed: false, graduationConfirmed: false }, missing: ['program'], transcriptCourseCount: 0,
  catalog: CATALOG, colleges: [{ id: 'terry', name: 'Terry College of Business' }], pathways: [{ id: 'dd-1', name: 'Double Dawgs', undergraduateProgramIds: ['p1'], graduateProgramIds: ['p2'] }],
});
let visitor = 0;
async function call(context, text = "I'm a sophomore majoring in economics.") {
  visitor += 1;
  const req = new Request('http://localhost/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forwarded-for': `10.1.0.${visitor}` },
    body: JSON.stringify({ school: 'uga', messages: [{ role: 'user', content: text }], context }),
  });
  await route.POST(req);
  return sent[sent.length - 1];
}

console.log('\n=== 1. One setup turn, as it goes over the wire ===\n');
const ctxA = contextFor({ schoolId: 'uga', programIds: [] }, '2026-10-31');
const a = await call(ctxA);
expect(a?.model === 'claude-opus-5', 'the model is claude-opus-5 (setup forces its tool, which Opus 5.5 refuses)', a?.model);
expect(a?.tool_choice?.type === 'tool' && a?.tool_choice?.name === 'record_setup' && a?.tools?.[0]?.name === 'record_setup', 'record_setup is still the forced tool');
expect(Array.isArray(a?.system) && a.system.length === 2, 'the system prompt is two blocks', JSON.stringify(a?.system)?.slice(0, 120));
expect(a?.system?.[0]?.cache_control?.type === 'ephemeral' && !a?.system?.[1]?.cache_control, 'one cache mark, on the first block');
expect(/^You are ORION's setup guide/.test(a?.system?.[0]?.text ?? '') && /University: uga/.test(a?.system?.[0]?.text ?? ''), 'the instructions and the school open the first block');
const sharedJson = (a?.system?.[0]?.text ?? '').split('(the same for every student):\n')[1] ?? '';
const studentJson = (a?.system?.[1]?.text ?? '').split('Context, this student:\n')[1] ?? '';
const shared = JSON.parse(sharedJson || 'null');
const student = JSON.parse(studentJson || 'null');
expect(shared && Object.keys(shared).join() === 'catalog,colleges,pathways', 'the first block holds the catalog, colleges and pathways', Object.keys(shared ?? {}).join());
expect(student && Object.keys(student).join() === 'date,answers,confirmations,missing,transcriptCourseCount', "the second block holds the student's own facts", Object.keys(student ?? {}).join());
const original = JSON.parse(ctxA);
const merged = { ...student, ...shared };
expect(Object.keys(merged).length === Object.keys(original).length && Object.keys(original).every((k) => JSON.stringify(merged[k]) === JSON.stringify(original[k])), 'together the two blocks carry every key of the context with the same values');

console.log('\n=== 2. Another student of the same school reuses the cache ===\n');
const b = await call(contextFor({ schoolId: 'uga', programIds: ['p7'], year: 'third' }, '2026-11-02'), 'Finance, junior.');
expect(b?.system?.[0]?.text === a?.system?.[0]?.text, 'everything up to the mark is byte-identical for a different student, day and answers');
expect(b?.system?.[1]?.text !== a?.system?.[1]?.text && /"year":"third"/.test(b?.system?.[1]?.text ?? ''), "only the student's block differs");
expect(JSON.stringify(b?.tools) === JSON.stringify(a?.tools), 'the tool list, ahead of the system prompt, is identical too');

console.log('\n=== 3. A context that is not a JSON object ===\n');
const c = await call('not json at all');
expect(c?.system?.length === 1 && !c.system[0].cache_control && c.system[0].text.endsWith('Context:\nnot json at all'), 'it is sent as it came, unmarked');

console.log(failures ? `\n${failures} SETUP REQUEST CHECK(S) FAILED` : '\nALL SETUP REQUEST CHECKS PASSED');
process.exit(failures ? 1 : 0);
