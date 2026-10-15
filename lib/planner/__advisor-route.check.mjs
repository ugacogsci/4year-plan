/**
 * ALMA's route (app/api/advisor/route.ts) run for real, with the network
 * replaced: the Anthropic SDK's fetch is answered here, so nothing leaves the
 * machine and no model is called. What this pins is the request as it goes
 * over the wire, after the route and the SDK have had their say:
 *
 *   - one mark on the instructions, one on the conversation's last block, no
 *     other marks, and the board and term dates after both, on the newest
 *     user message;
 *   - two steps of one question send the same bytes up to the first step's
 *     mark (so the second step is read from the cache);
 *   - the model is claude-opus-5 unless PLANNER_ADVISOR_MODEL names another;
 *   - UGA (ARCH) gets the same order, with UGA's own dates and never Illinois's;
 *   - the answer still streams back to the browser, and the browser's
 *     messages come back to it untouched (nothing stored, nothing echoed).
 *
 *   node lib/planner/__advisor-route.check.mjs
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
// '@/x' is the project root (tsconfig paths); 'next/server' is vinext's at run time, so a two-line stand-in here.
const NEXT_SERVER = 'data:text/javascript,' + encodeURIComponent('export const NextResponse = { json: (body, init) => Response.json(body, init) };');
const ROOT_URL = pathToFileURL(ROOT + '/').href;
register(
  'data:text/javascript,' +
    encodeURIComponent(`
const NEXT_SERVER = ${JSON.stringify(NEXT_SERVER)};
const ROOT_URL = ${JSON.stringify(ROOT_URL)};
export async function resolve(spec, ctx, next) {
  if (spec === 'next/server') return { url: NEXT_SERVER, shortCircuit: true };
  if (spec.startsWith('@/')) spec = new URL(spec.slice(2), ROOT_URL).href;
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));

// The SDK's network, answered here: every request is kept, every answer is a short streamed reply.
const sent = [];
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
globalThis.fetch = async (url, init) => {
  const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  const raw = typeof init?.body === 'string' ? init.body : 'null';
  sent.push({ url: href, headers: new Headers(init?.headers), body: JSON.parse(raw) });
  const model = sent[sent.length - 1].body?.model ?? 'claude-opus-5';
  const body = sse([
    { type: 'message_start', message: { id: `msg_${sent.length}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2300, cache_creation_input_tokens: 400, cache_read_input_tokens: 17000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fall 2026 has 15 credits.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } },
    { type: 'message_stop' },
  ]);
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': `req_${sent.length}` } });
};

// A made-up key: the fake network above is the only thing that ever sees it.
process.env.ANTHROPIC_API_KEY = 'sk-ant-offline-check';
delete process.env.PLANNER_ADVISOR_MODEL;
const route = await import(join(ROOT, 'app', 'api', 'advisor', 'route.ts'));
const { PLANNER_CONTEXT: R_LABEL } = await import(join(ROOT, 'lib', 'planner', 'advisor-request.ts'));

const ILL = { bot: 'ALMA', schoolName: 'University of Illinois Urbana-Champaign', schoolShort: 'Illinois' };
const BOARD_1 = 'Today: Tuesday, October 13, 2026.\nDegree: Computer Science, BS.\nFall 2026 (15 cr): CS 124 [required] 3 cr; MATH 221 [required] 4 cr';
const BOARD_2 = BOARD_1.replace('MATH 221', 'MATH 220');
const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };
const STEP_1 = [
  { role: 'user', content: 'Is my fall too heavy?' },
  { role: 'assistant', content: [thinking, { type: 'text', text: 'Fall 2026 reads moderate.' }] },
  { role: 'user', content: 'Swap MATH 221 for something lighter.' },
];
const STEP_2 = [
  ...STEP_1,
  { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'toolu_1', name: 'replace_course', input: { remove: 'MATH 221', add: 'MATH 220' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] },
];

let visitor = 0;
async function step(messages, board) {
  visitor += 1;
  const req = new Request('http://localhost/api/advisor', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${visitor}` },
    body: JSON.stringify({ ...ILL, messages, board }),
  });
  const res = await route.POST(req);
  const text = await res.text();
  const events = text.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  return { status: res.status, events, wire: sent[sent.length - 1] };
}

const marksIn = (body) => {
  const marks = [];
  (body.system ?? []).forEach((b, i) => b.cache_control && marks.push(`system.${i}`));
  (body.tools ?? []).forEach((t, i) => t.cache_control && marks.push(`tools.${i}`));
  body.messages.forEach((m, i) => typeof m.content !== 'string' && m.content.forEach((b, j) => b.cache_control && marks.push(`messages.${i}.${j}`)));
  return marks;
};
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'cache_control' ? undefined : x)));
const upTo = (body, [, i, j]) => body.messages.slice(0, i).concat([{ ...body.messages[i], content: body.messages[i].content.slice(0, j + 1) }]);

// ---------------------------------------------------------------------------
console.log('\n=== 1. One step, as it goes over the wire ===\n');
const before1 = JSON.stringify(STEP_1);
const s1 = await step(STEP_1, BOARD_1);
const w1 = s1.wire.body;
expect(s1.status === 200 && sent.length === 1, 'the route answers 200 and makes exactly one model call', `${s1.status}, ${sent.length} calls`);
expect(/\/v1\/messages/.test(s1.wire.url) && w1.stream === true, 'the call is a streamed Messages request', s1.wire.url);
expect(w1.model === 'claude-opus-5', 'the model is claude-opus-5 by default', w1.model);
expect(w1.max_tokens === 4096 && w1.output_config?.effort === 'high' && w1.fallbacks === 'default', 'max tokens, high effort and the refusal fallback are sent as before');
expect(/server-side-fallback-2026-07-01/.test(s1.wire.headers.get('anthropic-beta') ?? ''), 'the fallback beta is named in the beta header', s1.wire.headers.get('anthropic-beta') ?? '(none)');
const marks1 = marksIn(w1);
const last1 = w1.messages[w1.messages.length - 1];
expect(marks1.length === 2 && marks1[0] === 'system.0' && marks1[1].startsWith(`messages.${w1.messages.length - 1}.`), 'two marks: the instructions, then the end of the conversation', marks1.join(', '));
expect(w1.system.length === 1 && !JSON.stringify(w1.system).includes('The board right now'), 'the system prompt is the instructions alone; the board is not in it');
expect(last1.role === 'user' && last1.content[0].text === 'Swap MATH 221 for something lighter.', "the newest message starts with the student's words");
expect(last1.content[last1.content.length - 1].text.endsWith(BOARD_1) && /Illinois term dates/.test(JSON.stringify(last1.content)), 'the term dates and the board ride after them, on the same message');
expect(last1.content.slice(Number(marks1[1].split('.')[2]) + 1).every((b) => !b.cache_control), 'nothing after the conversation mark is marked');
expect(JSON.stringify(STEP_1) === before1, "the browser's messages are left as they were");
const final1 = s1.events.find((e) => e.type === 'final');
expect(s1.events.some((e) => e.type === 'text' && e.delta === 'Fall 2026 has 15 credits.') && final1?.message?.stop_reason === 'end_turn', 'the answer streams back to the browser, then the final message');
expect(!JSON.stringify(s1.events).includes('The board right now') && !JSON.stringify(s1.events).includes('Planner context'), 'the board block is never sent back to the browser (it is not stored in the chat)');

// ---------------------------------------------------------------------------
console.log('\n=== 2. The next step reuses this one ===\n');
const s2 = await step(STEP_2, BOARD_2);
const w2 = s2.wire.body;
const m1 = marks1[1].split('.').map(Number);
const m2 = marksIn(w2)[1]?.split('.').map(Number) ?? [];
expect(s2.status === 200 && sent.length === 2, 'the second step makes one more call');
expect(JSON.stringify(strip(w1.tools)) === JSON.stringify(strip(w2.tools)) && JSON.stringify(strip(w1.system)) === JSON.stringify(strip(w2.system)), 'tools and instructions are byte-identical across the two steps');
expect(JSON.stringify(strip(upTo(w1, m1))) === JSON.stringify(strip(upTo(w2, m1))), "step 2 begins with step 1's marked conversation, byte for byte");
expect(m2[1] === w2.messages.length - 1 && w2.messages[m2[1]].content[m2[2]].type === 'tool_result', 'step 2 moves the mark to its own last block, the tool result', marksIn(w2).join(', '));
expect(w2.messages[w2.messages.length - 1].content.at(-1).text.endsWith(BOARD_2) && !JSON.stringify(w2.messages.slice(0, -1)).includes('The board right now'), 'only the newest message carries a board, and it is the board as it is now');

// ---------------------------------------------------------------------------
console.log('\n=== 3. PLANNER_ADVISOR_MODEL ===\n');
process.env.PLANNER_ADVISOR_MODEL = 'claude-opus-5-5';
const s3 = await step(STEP_2, BOARD_2);
expect(s3.status === 200 && s3.wire.body.model === 'claude-opus-5-5', 'set to claude-opus-5-5, the call goes to claude-opus-5-5', s3.wire.body.model);
expect(!JSON.stringify(s3.wire.body.messages).includes('"type":"thinking"') && s3.wire.body.output_config?.effort === 'high', 'on Opus 5.5 earlier thinking is left out, and effort stays high');
process.env.PLANNER_ADVISOR_MODEL = 'not-a-model';
const s4 = await step(STEP_1, BOARD_1);
expect(s4.wire.body.model === 'claude-opus-5', 'a value that is not a Claude model falls back to claude-opus-5', s4.wire.body.model);
delete process.env.PLANNER_ADVISOR_MODEL;

// ---------------------------------------------------------------------------
console.log("\n=== 4. UGA (ARCH) gets the same order, with UGA's dates, without Illinois's ===\n");
{
  visitor += 1;
  const uga = { bot: 'ARCH', schoolName: 'University of Georgia', schoolShort: 'UGA' };
  const res = await route.POST(new Request('http://localhost/api/advisor', { method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${visitor}` }, body: JSON.stringify({ ...uga, messages: STEP_2, board: BOARD_2 }) }));
  await res.text();
  const w = sent[sent.length - 1].body;
  const lastU = w.messages[w.messages.length - 1].content;
  expect(res.status === 200 && w.system.length === 1 && lastU[lastU.length - 1].text === `The board right now:\n\n${BOARD_2}` && lastU[lastU.length - 2].text.startsWith(`${R_LABEL}\n\nUGA term dates (today is`), "UGA's dates, then the board, ride on the newest message, after the conversation", `${res.status}`);
  expect(!JSON.stringify(w).includes('Illinois term dates'), 'no Illinois dates anywhere');
  expect(marksIn(w).length === 2 && w.tools.length === 18 && !w.tools.some((t) => t.name === 'find_clubs' || t.name === 'course_syllabus') && w.model === 'claude-opus-5', "two marks, ARCH's 18 tools (no Illinois-only ones), claude-opus-5");
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Refusals still happen before any call ===\n');
const callsBefore = sent.length;
const bad = await route.POST(new Request('http://localhost/api/advisor', { method: 'POST', body: JSON.stringify({ ...ILL, messages: [{ role: 'system', content: 'x' }], board: '' }) }));
expect(bad.status === 400 && sent.length === callsBefore, 'a message that is not user or assistant is refused with no model call', String(bad.status));

console.log(`\n${failures === 0 ? 'ALL ADVISOR ROUTE CHECKS PASSED' : `${failures} ADVISOR ROUTE CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
