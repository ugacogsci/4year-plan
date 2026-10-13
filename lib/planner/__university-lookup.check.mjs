/**
 * Plain-node check for lib/planner/university-lookup.ts. No network and no
 * API key: the Claude client is a stand-in that returns canned replies.
 *
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__university-lookup.check.mjs
 *
 * What it pins, because each one is a promise the privacy notice or the
 * product makes:
 *   - an answer ships only with at least one cited page on the school's own
 *     domain; a citation to any other site is dropped, and an answer left with
 *     none is replaced by "could not find it"
 *   - the search tool is restricted to the school's domains, every call
 *   - a school with no lookup says so and makes no call
 *   - a repeated first question is answered from the day's cache, with no call;
 *     a follow-up (with a prior exchange) is never cached
 *   - the cost a call reports includes its web searches
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const { lookupUniversity, onSchoolDomain, LOOKUP_SCHOOLS, lookupModel, LOOKUP_MODEL } = await import('./university-lookup.ts');
const { costUsd } = await import('./spend-guard.ts');

let failures = 0;
function expect(ok, label, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `\n          ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** A stand-in client: records each request and returns the next canned reply. */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const next = replies.shift();
          if (!next) throw new Error('no canned reply left');
          return next;
        },
      },
    },
  };
}

const usage = { input_tokens: 100, output_tokens: 400, cache_creation_input_tokens: 9000, cache_read_input_tokens: 3000, server_tool_use: { web_search_requests: 1 } };
const cite = (url, title) => ({ type: 'web_search_result_location', url, title, cited_text: '...', encrypted_index: 'x' });
const reply = (blocks, stop = 'end_turn') => ({ content: blocks, stop_reason: stop, usage });

console.log('=== university lookup ===\n');

// 1. The domain test itself.
const il = LOOKUP_SCHOOLS.illinois;
expect(onSchoolDomain('https://registrar.illinois.edu/ug-reg-dlines-fa26/', il), 'a registrar subdomain is official');
expect(onSchoolDomain('https://illinois.edu/', il), 'the bare domain is official');
expect(!onSchoolDomain('https://illinois.edu.example.com/', il), 'a look-alike host is not');
expect(!onSchoolDomain('https://www.uga.edu/', il), "another school's site is not Illinois's");
expect(!onSchoolDomain('not a url', il), 'garbage is not a page');

// 2. A cited answer ships with its official pages, and only those.
{
  const client = fakeClient([
    reply([
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'drop deadline' } },
      { type: 'text', text: 'The deadline is Oct 16.', citations: [cite('https://registrar.illinois.edu/ug-reg-dlines-fa26/', 'Fall 2026 deadlines')] },
      { type: 'text', text: ' Another site agrees.', citations: [cite('https://www.reddit.com/r/UIUC/x', 'reddit')] },
    ]),
  ]);
  const r = await lookupUniversity({ question: 'When is the drop deadline (check 2)?', schoolId: 'illinois', client, now: new Date('2026-10-11T12:00:00Z') });
  expect(r.answer.grounded && r.answer.sources.length === 1, 'a cited official answer ships, grounded, with one source', JSON.stringify(r.answer.sources));
  expect(r.answer.sources[0]?.host === 'registrar.illinois.edu' && r.answer.sources[0]?.n === 1, 'the source is the registrar page, numbered 1');
  expect(!r.answer.sources.some((s) => /reddit/.test(s.url)), 'a citation off the school domain is dropped');
  const tool = client.calls[0]?.tools?.[0];
  expect(tool?.name === 'web_search' && JSON.stringify(tool.allowed_domains) === '["illinois.edu"]', 'the search is restricted to illinois.edu', JSON.stringify(tool));
  expect(client.calls[0]?.model === LOOKUP_MODEL, `the model is ${LOOKUP_MODEL}`);
  expect(/Today is October 11, 2026\./.test(client.calls[0]?.messages?.[0]?.content ?? ''), "the request carries today's date");
  const c = costUsd(r.model, r.usage);
  expect(Math.abs(c - (100 * 2 + 400 * 10 + 9000 * 2.5 + 3000 * 0.2) / 1e6 - 0.01) < 1e-9, 'the cost counts tokens and the one web search', String(c));
}

// 3. No official citation means no answer.
{
  const client = fakeClient([reply([{ type: 'text', text: 'Probably mid-October.' }])]);
  const r = await lookupUniversity({ question: 'An uncited question (check 3)?', schoolId: 'illinois', client });
  expect(!r.answer.grounded && r.answer.sources.length === 0 && /could not find that on Illinois's official pages/.test(r.answer.text), 'an uncited answer is replaced by "could not find it"', r.answer.text);
  const client2 = fakeClient([reply([{ type: 'text', text: 'UGA says Nov 11.', citations: [cite('https://reg.uga.edu/calendars/', 'UGA')] }])]);
  const r2 = await lookupUniversity({ question: 'A question answered from the wrong school (check 3)?', schoolId: 'illinois', client: client2 });
  expect(!r2.answer.grounded && r2.answer.sources.length === 0, "an answer citing only another school's page does not ship");
}

// 4. UGA searches uga.edu only.
{
  const client = fakeClient([reply([{ type: 'text', text: 'Nov 11.', citations: [cite('https://reg.uga.edu/calendars/academic-calendars/', 'Academic calendars')] }])]);
  const r = await lookupUniversity({ question: 'UGA withdrawal deadline (check 4)?', schoolId: 'uga', client });
  expect(JSON.stringify(client.calls[0]?.tools?.[0]?.allowed_domains) === '["uga.edu"]' && r.answer.grounded, 'UGA is searched on uga.edu and cites it');
}

// 5. A school with no lookup: a plain sentence, no call.
{
  const client = fakeClient([]);
  const r = await lookupUniversity({ question: 'When is tuition due?', schoolId: 'elsewhere', client });
  expect(client.calls.length === 0 && !r.answer.grounded && /cannot look up/.test(r.answer.text) && r.usage === null, 'a school with no lookup says so and makes no call', r.answer.text);
}

// 6. The day's cache: a repeat first question makes no call; a follow-up is never cached.
{
  const client = fakeClient([
    reply([{ type: 'text', text: 'At 1401 W. Green Street.', citations: [cite('https://union.illinois.edu/', 'Illini Union')] }]),
    reply([{ type: 'text', text: 'It opens at 7.', citations: [cite('https://union.illinois.edu/hours', 'Hours')] }]),
  ]);
  await lookupUniversity({ question: 'Where is the Illini Union (check 6)?', schoolId: 'illinois', client });
  const again = await lookupUniversity({ question: 'where is the illini union  (check 6)', schoolId: 'illinois', client });
  expect(client.calls.length === 1 && again.cached && again.usage === null, 'the same question again is answered from the cache, no call');
  await lookupUniversity({ question: 'Where is the Illini Union (check 6)?', schoolId: 'illinois', client, prior: { q: 'x', a: 'y' } });
  expect(client.calls.length === 2, 'a follow-up with a prior exchange always makes a call');
  expect(/previous question was: x/.test(client.calls[1]?.messages?.[0]?.content ?? ''), 'the prior exchange goes with a follow-up');
}

// 7. A paused server-tool turn is resumed and its usage summed.
{
  const client = fakeClient([
    reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } }], 'pause_turn'),
    reply([{ type: 'text', text: 'Done.', citations: [cite('https://www.osfa.illinois.edu/', 'OSFA')] }]),
  ]);
  const r = await lookupUniversity({ question: 'A long search (check 7)?', schoolId: 'illinois', client });
  expect(client.calls.length === 2 && r.answer.grounded && r.usage?.server_tool_use?.web_search_requests === 2, 'pause_turn is resumed once and both rounds are counted');
}

// 8. The model can be changed by setting, and only to a model id.
expect(lookupModel({ PLANNER_LOOKUP_MODEL: 'claude-opus-5' }) === 'claude-opus-5', 'PLANNER_LOOKUP_MODEL overrides the model');
expect(lookupModel({ PLANNER_LOOKUP_MODEL: 'rm -rf /' }) === LOOKUP_MODEL, 'a setting that is not a model id is ignored');

console.log(`\n${failures === 0 ? 'all lookup checks hold' : `${failures} failures`}`);
process.exit(failures === 0 ? 0 : 1);
