/**
 * The request ALMA's route sends for one step (advisor-request.ts), checked
 * without calling the API.
 *
 * What this pins:
 *   - the cache marks: one on the fixed instructions (tools and system come
 *     with it), one on the last block of the conversation, nowhere else, and
 *     never more than the API's four;
 *   - the board and the Illinois term dates ride on the newest user message,
 *     after the conversation's mark, and are no longer in the system prompt;
 *   - nothing is lost: every text the old request sent (instructions, term
 *     dates, board, every message block) is in the new one, unchanged, and
 *     the browser's own copy of the conversation is not modified;
 *   - the reuse actually lines up: two consecutive steps, with the board
 *     changed in between, send byte-identical tools, system and conversation
 *     up to the earlier step's mark;
 *   - UGA gets the same tools and instructions as before and no Illinois dates;
 *   - PLANNER_ADVISOR_MODEL, with claude-opus-5 as the default;
 *   - the spend guard's prices and its cache-write worst case.
 *
 *   node lib/planner/__advisor-request.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const R = await import(join(HERE, 'advisor-request.ts'));
const A = await import(join(HERE, 'advisor.ts'));
const D = await import(join(HERE, 'term-dates.ts'));
const G = await import(join(HERE, 'spend-guard.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? `: ${detail}` : ''}`));

// ---------------------------------------------------------------------------
// Fixtures: a conversation as the browser holds it after one question that
// used a tool, an undo note, and a second question.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-13T17:00:00Z');
const ILL = { bot: 'ALMA', schoolName: 'University of Illinois Urbana-Champaign', schoolShort: 'Illinois' };
const UGA = { bot: 'ARCH', schoolName: 'University of Georgia', schoolShort: 'UGA' };
const BOARD_1 = 'Today: Tuesday, October 13, 2026.\nDegree: Computer Science, BS.\nFall 2026 (15 cr): CS 124 [required] 3 cr Introduction to Computer Science I; MATH 221 [required] 4 cr Calculus I';
const BOARD_2 = BOARD_1.replace('MATH 221', 'MATH 220');

const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };
const history = () => [
  { role: 'user', content: 'Is my fall too heavy?' },
  {
    role: 'assistant',
    content: [thinking, { type: 'text', text: 'Let me look at the term.' }, { type: 'tool_use', id: 'toolu_1', name: 'term_summary', input: { term: 'Fall 2026' } }],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"term":"Fall 2026","credits":15}' }] },
  { role: 'assistant', content: [thinking, { type: 'text', text: 'Fall 2026 has 15 credits and reads moderate.' }] },
  A.undoNote(['Added MATH 221 to Fall 2026']),
  { role: 'user', content: 'Swap MATH 221 for something lighter.' },
];

const textsOf = (request) => {
  const out = [];
  for (const block of request.system) out.push(block.text);
  for (const m of request.messages) {
    if (typeof m.content === 'string') out.push(m.content);
    else for (const b of m.content) out.push(b.type === 'text' ? b.text : JSON.stringify({ ...b, cache_control: undefined }));
  }
  return out;
};
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'cache_control' ? undefined : x)));
const marksIn = (request) => {
  const marks = [];
  request.system.forEach((b, i) => b.cache_control && marks.push(`system.${i}`));
  (request.tools ?? []).forEach((t, i) => t.cache_control && marks.push(`tools.${i}`));
  request.messages.forEach((m, i) => typeof m.content !== 'string' && m.content.forEach((b, j) => b.cache_control && marks.push(`messages.${i}.${j}`)));
  return marks;
};

/** The request the route sent before this change, rebuilt from its code at 7ce5bd7. */
function legacyRequest({ bot, schoolName, schoolShort, board, messages, now }) {
  return {
    model: 'claude-opus-5',
    max_tokens: 4096,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high' },
    system: [
      { type: 'text', text: A.advisorSystem(bot, schoolName, schoolShort), cache_control: { type: 'ephemeral' } },
      ...(/illinois/i.test(schoolName) ? [{ type: 'text', text: D.termDatesBlock(now) }] : []),
      { type: 'text', text: `The board right now:\n\n${board}` },
    ],
    tools: /illinois/i.test(schoolName)
      ? A.ADVISOR_TOOLS
      : A.ADVISOR_TOOLS.filter((tool) => new Set(['search_courses', 'course_details', 'term_summary', 'add_course', 'remove_course', 'replace_course', 'move_course', 'planner_answer', 'university_answer']).has(tool.name)),
    messages,
  };
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. Where the cache marks are ===\n');
{
  const messages = history();
  const before = JSON.stringify(messages);
  const req = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_1, messages, now: NOW });
  const marks = marksIn(req);
  expect(req.system.length === 1 && req.system[0].cache_control?.type === 'ephemeral', 'the system prompt is the fixed instructions alone, marked for the cache');
  expect(req.system[0].text === A.advisorSystem('ALMA', ILL.schoolName, ILL.schoolShort), 'the fixed instructions are the same text as before');
  expect(marks.length === 2 && marks.length <= 4, 'two cache marks in all (the API allows four)', marks.join(', '));
  const last = req.messages[req.messages.length - 1];
  const context = R.stepContextBlocks({ ...ILL, board: BOARD_1, now: NOW });
  const markAt = last.content.length - context.length - 1;
  expect(marks[1] === `messages.${req.messages.length - 1}.${markAt}`, 'the second mark is on the last block of the conversation, just before the step context', marks[1]);
  expect(last.content.slice(markAt + 1).every((b) => !b.cache_control), 'nothing after the conversation mark is marked (the board changes every step)');
  expect(JSON.stringify(messages) === before, "the browser's copy of the conversation is not modified");
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. The board and the term dates ride on the newest user message ===\n');
{
  const req = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_1, messages: history(), now: NOW });
  const sys = req.system.map((b) => b.text).join('\n');
  expect(!sys.includes('The board right now') && !sys.includes(BOARD_1), 'the board is not in the system prompt');
  expect(!sys.includes('Illinois term dates (today is'), 'the term dates are not in the system prompt');
  const last = req.messages[req.messages.length - 1];
  const tail = last.content.slice(-2);
  expect(last.role === 'user' && last.content[0].text === 'Swap MATH 221 for something lighter.', "the newest message is still the student's, first");
  expect(tail[0].text === `${R.PLANNER_CONTEXT}\n\n${D.termDatesBlock(NOW)}`, "today's Illinois term dates come first, whole, under the planner's label");
  expect(tail[1].text === `The board right now:\n\n${BOARD_1}`, 'then the board, whole, with the same heading as before');
  const all = JSON.stringify(req.messages);
  expect(all.split(R.PLANNER_CONTEXT).length === 2 && all.split('The board right now').length === 2, 'the label and the board appear once in the whole conversation');

  // A tool step: the newest user message is tool results, which must stay first.
  const msgs = [...history(), { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'toolu_2', name: 'search_courses', input: { query: 'MATH' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: '[]' }] }];
  const step = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_2, messages: msgs, now: NOW });
  const end = step.messages[step.messages.length - 1].content;
  expect(end[0].type === 'tool_result' && end[0].cache_control?.type === 'ephemeral' && end.slice(1).every((b) => b.type === 'text'), 'on a tool step the results come first, marked, then the context');
  expect(end[end.length - 1].text.endsWith(BOARD_2), 'each step carries the board as it is at that step');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Nothing is lost against the old request ===\n');
for (const { label, school } of [{ label: 'Illinois', school: ILL }, { label: 'UGA', school: UGA }]) {
  const input = { ...school, board: BOARD_1, messages: history(), now: NOW };
  const oldReq = legacyRequest(input);
  const newReq = R.advisorRequest({ model: 'claude-opus-5', ...input });
  const newTexts = textsOf(newReq).join('\n\u0000\n');
  const missing = textsOf(oldReq).filter((t) => !newTexts.includes(t));
  expect(missing.length === 0, `${label}: every text the old request sent is in the new one`, missing.map((t) => t.slice(0, 60)).join(' | '));
  expect(JSON.stringify(strip(newReq.tools)) === JSON.stringify(strip(oldReq.tools)), `${label}: the same tools, in the same order`);
  for (const key of ['model', 'max_tokens', 'betas', 'fallbacks', 'output_config']) {
    expect(JSON.stringify(newReq[key]) === JSON.stringify(oldReq[key]), `${label}: ${key} unchanged`);
  }
  const added = textsOf(newReq).filter((t) => !textsOf(oldReq).some((o) => t.includes(o) || o.includes(t)));
  expect(added.length === 0, `${label}: nothing new is sent beyond the planner's one-line label`, added.map((t) => t.slice(0, 60)).join(' | '));
  const oldThinking = JSON.stringify(oldReq.messages).split('"type":"thinking"').length;
  expect(JSON.stringify(newReq.messages).split('"type":"thinking"').length === oldThinking, `${label}: Opus 5 keeps every earlier thinking block`);
}
{
  const uga = R.advisorRequest({ model: 'claude-opus-5', ...UGA, board: BOARD_1, messages: history(), now: NOW });
  const last = uga.messages[uga.messages.length - 1].content;
  expect(!JSON.stringify(uga).includes('Illinois term dates'), 'UGA: no Illinois dates anywhere');
  expect(last[last.length - 1].text === `${R.PLANNER_CONTEXT}\n\nThe board right now:\n\n${BOARD_1}`, 'UGA: one context block, the label then the board');
  expect(uga.tools.length === 9 && uga.system[0].text === A.advisorSystem('ARCH', UGA.schoolName, UGA.schoolShort), "UGA: ARCH's own nine tools and instructions, as before");
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Consecutive steps reuse each other (byte for byte) ===\n');
{
  // Step 1 of a question, then step 2 after a tool call that changed the board.
  const h1 = history();
  const r1 = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_1, messages: h1, now: NOW });
  const h2 = [...h1, { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'toolu_3', name: 'replace_course', input: { remove: 'MATH 221', add: 'MATH 220' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: '{"ok":true}' }] }];
  const r2 = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_2, messages: h2, now: NOW });
  expect(JSON.stringify(strip(r1.tools)) === JSON.stringify(strip(r2.tools)) && JSON.stringify(strip(r1.system)) === JSON.stringify(strip(r2.system)), 'tools and system are identical across steps even though the board changed');
  // The prefix step 1 marked: every message before its newest, plus the newest up to the mark.
  const m1 = marksIn(r1)[1].split('.').map(Number);
  const prefix1 = r1.messages.slice(0, m1[1]).concat([{ ...r1.messages[m1[1]], content: r1.messages[m1[1]].content.slice(0, m1[2] + 1) }]);
  const prefix2 = r2.messages.slice(0, m1[1]).concat([{ ...r2.messages[m1[1]], content: r2.messages[m1[1]].content.slice(0, m1[2] + 1) }]);
  expect(JSON.stringify(strip(prefix1)) === JSON.stringify(strip(prefix2)), "step 2 begins with step 1's marked conversation, byte for byte, so it is read from the cache");
  const m2 = marksIn(r2)[1].split('.').map(Number);
  expect(m2[1] > m1[1] && m2[1] - m1[1] <= 4, "step 2's mark is a few positions later, inside the API's 20-position look-back", `${m1[1]} -> ${m2[1]}`);
  // A third request, the next question, after the final answer.
  const h3 = [...h2, { role: 'assistant', content: [thinking, { type: 'text', text: 'Replaced MATH 221 with MATH 220.' }] }, { role: 'user', content: 'Thanks. What about spring?' }];
  const r3 = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_2, messages: h3, now: new Date('2026-10-14T17:00:00Z') });
  const prefix3 = r3.messages.slice(0, m2[1]).concat([{ ...r3.messages[m2[1]], content: r3.messages[m2[1]].content.slice(0, m2[2] + 1) }]);
  const prefix2b = r2.messages.slice(0, m2[1]).concat([{ ...r2.messages[m2[1]], content: r2.messages[m2[1]].content.slice(0, m2[2] + 1) }]);
  expect(JSON.stringify(strip(prefix2b)) === JSON.stringify(strip(prefix3)) && JSON.stringify(strip(r3.system)) === JSON.stringify(strip(r1.system)), 'the next question, even on the next day, reuses the whole conversation');
  // A question typed as plain text reads the same newest and later.
  expect(r1.messages[r1.messages.length - 1].content[0].type === 'text' && r2.messages[r1.messages.length - 1].content[0].type === 'text', 'a plain-text message is one text block both while newest and after');
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Odd inputs ===\n');
{
  const marked = history();
  marked[1].content[1] = { ...marked[1].content[1], cache_control: { type: 'ephemeral' } };
  marked[2].content[0] = { ...marked[2].content[0], cache_control: { type: 'ephemeral', ttl: '1h' } };
  const req = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_1, messages: marked, now: NOW });
  expect(marksIn(req).length === 2, "a mark a client put on its own messages is removed, so the route's two are the only ones");
  const endsAssistant = history().slice(0, 4);
  const odd = R.advisorRequest({ model: 'claude-opus-5', ...ILL, board: BOARD_1, messages: endsAssistant, now: NOW });
  const tail = odd.messages[odd.messages.length - 1];
  expect(odd.messages.length === 5 && tail.role === 'user' && tail.content.every((b) => b.type === 'text'), 'a conversation ending on an assistant message gets the context as its own user message (never a prefill)');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. The model setting ===\n');
{
  expect(A.ADVISOR_MODEL === 'claude-opus-5' && R.advisorModel({}) === 'claude-opus-5', 'the default is unchanged: claude-opus-5');
  expect(R.advisorModel({ PLANNER_ADVISOR_MODEL: ' claude-opus-5-5 ' }) === 'claude-opus-5-5', 'PLANNER_ADVISOR_MODEL picks another Claude model');
  expect(R.advisorModel({ PLANNER_ADVISOR_MODEL: 'gpt-5' }) === 'claude-opus-5' && R.advisorModel({ PLANNER_ADVISOR_MODEL: '' }) === 'claude-opus-5' && R.advisorModel({ PLANNER_ADVISOR_MODEL: 'claude-opus-5; drop' }) === 'claude-opus-5', 'a value that is not a Claude model name falls back to the default');
  expect(!R.bindsThinking('claude-opus-5') && R.bindsThinking('claude-opus-5-5') && R.bindsThinking('claude-sonnet-5-5'), 'Opus 5.5 and Sonnet 5.5 bind thinking to the conversation; Opus 5 does not');
  const h = history();
  const a = R.advisorRequest({ model: 'claude-opus-5-5', ...ILL, board: BOARD_1, messages: h, now: NOW });
  const b = R.advisorRequest({ model: 'claude-opus-5-5', ...ILL, board: BOARD_2, messages: [...h, { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'toolu_9', name: 'review_board', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: '{}' }] }], now: NOW });
  expect(!JSON.stringify(a.messages).includes('"thinking"') && !JSON.stringify(b.messages).includes('"thinking"'), 'on Opus 5.5 earlier thinking is left out of every step (the board edit would void it)');
  const ma = marksIn(a)[1].split('.').map(Number);
  const pa = a.messages.slice(0, ma[1]).concat([{ ...a.messages[ma[1]], content: a.messages[ma[1]].content.slice(0, ma[2] + 1) }]);
  const pb = b.messages.slice(0, ma[1]).concat([{ ...b.messages[ma[1]], content: b.messages[ma[1]].content.slice(0, ma[2] + 1) }]);
  expect(JSON.stringify(strip(pa)) === JSON.stringify(strip(pb)), 'and the steps still line up for the cache on Opus 5.5');
  expect(a.model === 'claude-opus-5-5' && a.output_config.effort === 'high', 'the chosen model is sent, with effort still set to high (Opus 5.5 would default to medium)');
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. The route and the spend guard ===\n');
{
  const src = readFileSync(join(HERE, '..', '..', 'app', 'api', 'advisor', 'route.ts'), 'utf8');
  expect(/advisorRequest\(\{ model, bot, schoolName, schoolShort, board, messages, now: new Date\(\) \}\)/.test(src) && /const model = advisorModel\(\);/.test(src), 'the route sends the request built here, on the configured model');
  expect(!/The board right now/.test(src) && !/termDatesBlock/.test(src) && !/(?<![A-Z_])ADVISOR_MODEL\b/.test(src), 'the route no longer builds its own system prompt or names a model');
  expect(/m\.role !== 'user' && m\.role !== 'assistant'/.test(src), 'the route still refuses any message that is not user or assistant (no system messages from a browser)');
  expect(G.priceOf('claude-opus-5').cacheRead === 0.5 && G.priceOf('claude-opus-5-5').cacheRead === 0.2 && G.priceOf('claude-sonnet-5-5').cacheRead === 0.1, 'cache-read prices match the official page: Opus 5 $0.50, Opus 5.5 $0.20, Sonnet 5.5 $0.10');
  expect(G.worstCaseUsd('claude-opus-5', 1_000_000, 0, { cacheWrites: true }) === 6.25 && G.worstCaseUsd('claude-opus-5', 1_000_000, 0) === 5, "ALMA's worst case prices its input at the cache-write rate; other routes are unchanged");
  // A late-chat step as the cache bills it: 60,000 tokens read, 2,000 written, the board at full price.
  const cached = G.costUsd('claude-opus-5', { input_tokens: 2_600, cache_read_input_tokens: 60_000 + 13_000, cache_creation_input_tokens: 2_000, output_tokens: 600 });
  const uncached = G.costUsd('claude-opus-5', { input_tokens: 2_600 + 62_000, cache_read_input_tokens: 13_000, output_tokens: 600 });
  expect(cached < uncached * 0.35, `a late-chat step costs about a third or less once the conversation is read from the cache ($${cached.toFixed(3)} vs $${uncached.toFixed(3)})`);
}

console.log(`\n${failures === 0 ? 'ALL ADVISOR REQUEST CHECKS PASSED' : `${failures} ADVISOR REQUEST CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
