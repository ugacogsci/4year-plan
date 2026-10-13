/**
 * What one ALMA question costs, measured: the same short conversation sent in
 * the new request shape (lib/planner/advisor-request.ts: the conversation
 * reused from the cache) and in the old one (the board in the system prompt,
 * the conversation billed in full on every step), with the token counts
 * Anthropic reports for each call.
 *
 * How it stays fair and cheap:
 *   - the "after" conversation runs first, live, with canned tool results
 *     (the same every run), a step cap per question and a call cap overall;
 *   - "before" then replays exactly the requests "after" made (same history,
 *     same board, same day) in the old shape, so both sides price the same
 *     input; the outputs are fresh, so their answers can be compared;
 *   - a hard stop on calls (ADVISOR_COST_MAX_CALLS, default 12) and on money
 *     (ADVISOR_COST_BUDGET_USD, default 1.50, checked against each call's
 *     worst case before it is made).
 *
 *   node --experimental-strip-types scripts/dev/advisor-cost.mjs --dry   # shapes and sizes, no API call
 *   node --experimental-strip-types scripts/dev/advisor-cost.mjs <out.jsonl>
 *
 * Reads ANTHROPIC_API_KEY from the environment or .env.local; never prints it.
 * The board and the student are made up. No real student data is sent.
 */
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const R = await import(join(ROOT, 'lib', 'planner', 'advisor-request.ts'));
const A = await import(join(ROOT, 'lib', 'planner', 'advisor.ts'));
const D = await import(join(ROOT, 'lib', 'planner', 'term-dates.ts'));
const G = await import(join(ROOT, 'lib', 'planner', 'spend-guard.ts'));

const DRY = process.argv.includes('--dry');
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? null;
const MODEL = R.advisorModel();
const MAX_CALLS = Number(process.env.ADVISOR_COST_MAX_CALLS ?? 12);
const BUDGET = Number(process.env.ADVISOR_COST_BUDGET_USD ?? 1.5);
const STEP_CAP = 3;
const NOW = new Date('2026-10-13T17:00:00Z');
const SCHOOL = { bot: 'ALMA', schoolName: 'University of Illinois Urbana-Champaign', schoolShort: 'Illinois' };

// ---------------------------------------------------------------------------
// A made-up first-year Computer Science student, written the way the
// workspace's describeBoard writes a board (about the median board's size).
// ---------------------------------------------------------------------------

const MARKS =
  "Marks: [required] the degree page names it. [from a list: X] fills the list X. [elective slot] the planner picked it to reach the total; swap it freely. [career track: X] a course the student's career track X requires; keep it unless they drop the goal, and ask before removing or replacing it. [language] part of the language sequence for the language requirement; the language is the student's choice, the level is not. [gen ed pick] the planner chose it for a general education category; swap it for another course that carries the same categories. [prerequisite] the planner booked it because a later course needs it. [added] the student or you put it there.";
const BOARD = [
  'Today: Tuesday, October 13, 2026.',
  'Degree: Computer Science, BS, University of Illinois Urbana-Champaign. Published total: 128 credits. Plan: 128 through Spring 2030.',
  'College: The Grainger College of Engineering. Its office for loads, CR/NC, grade replacement, late drops and petitions: Engineering Student Services, 206 Engineering Hall.',
  MARKS,
  'Already taken, counted but not on the board: none.',
  'Credit coming in: Residency (45 hours at Illinois, 21 at the 300 level or above) is met: 128 Illinois hours, 52 upper-level.',
  'Credit load: at least 12 credits a term, aim an even share of what is left, never above 18. Class schedules are published for Fall 2026 and Spring 2027. A card\'s section times come from its own term\'s schedule when that is published, else the latest schedule of the same season (the card says which); the planner\'s own choices still weigh Fall 2026\'s sections.',
  'Interests and goals: software engineering, maybe data science. Career words stored: "software engineer". Active career tracks: none.',
  'Priorities, which decide the elective picks and the order of choices: lighter workload counts, highly rated teaching counts, relevance counts, covering more requirements counts, fitting the schedule ignored.',
  'Fall 2026 (16 cr; 2 hardest-band courses together): CS 100 [required] 1 cr Freshman Orientation; CS 124 [required] 3 cr Introduction to Computer Science I; MATH 221 [required] 4 cr Calculus I; RHET 105 [required] 4 cr Writing and Research; ECON 102 [gen ed pick] 3 cr Microeconomic Principles; ENG 100 [required] 1 cr Grainger Engineering Orientation',
  'Spring 2027 (16 cr): CS 128 [required] 3 cr Introduction to Computer Science II; CS 173 [required] 3 cr Discrete Structures; MATH 231 [required] 3 cr Calculus II; PHYS 211 [required] 4 cr University Physics: Mechanics; PSYC 100 [gen ed pick] 3 cr Introduction to Psychology',
  'Fall 2027 (16 cr; 2 hardest-band courses together): CS 222 [required] 1 cr Software Design Lab; CS 225 [required] 4 cr Data Structures; MATH 241 [required] 4 cr Calculus III; PHYS 212 [required] 4 cr University Physics: Elec & Mag; SOC 100 [gen ed pick] 3 cr Introduction to Sociology',
  'Spring 2028 (15 cr): CS 233 [required] 4 cr Computer Architecture; CS 341 [required] 4 cr System Programming; MATH 257 [required] 3 cr Linear Algebra with Computational Applications; CS 199 [elective slot] 1 cr Undergraduate Open Seminar; HIST 172 [gen ed pick] 3 cr US History since 1877',
  'Fall 2028 (16 cr): CS 361 [from a list: Probability and statistics] 3 cr Probability & Statistics for Computer Science; CS 374 [required] 4 cr Introduction to Algorithms & Models of Computation; CS 357 [from a list: Numerical methods] 3 cr Numerical Methods I; ANTH 101 [gen ed pick] 3 cr Introduction to Anthropology; MUS 132 [gen ed pick] 3 cr Popular Music in the USA',
  'Spring 2029 (16 cr): CS 421 [required] 3 cr Programming Languages & Compilers; CS 411 [from a list: Technical track] 3 cr Database Systems; CS 425 [from a list: Technical track] 3 cr Distributed Systems; ECE 120 [elective slot] 4 cr Introduction to Computing; ARTH 111 [gen ed pick] 3 cr Ancient to Medieval Art',
  'Fall 2029 (17 cr): CS 498 [from a list: Technical track] 3 cr Special Topics; CS 440 [from a list: Technical track] 3 cr Artificial Intelligence; CS 446 [from a list: Technical track] 3 cr Machine Learning; STAT 410 [elective slot] 3 cr Statistics and Probability II; ECON 103 [gen ed pick] 3 cr Macroeconomic Principles; CS 210 [required] 2 cr Ethical & Professional Issues',
  'Spring 2030 (16 cr): CS 427 [from a list: Technical track] 3 cr Software Engineering I; CS 461 [from a list: Technical track] 4 cr Computer Security I; PHIL 105 [gen ed pick] 3 cr Elementary Ethics; CS 199 [elective slot] 3 cr Undergraduate Open Seminar; GEOG 101 [gen ed pick] 3 cr Global Development and Environment',
  'Review list: 1 to review, 2 notes.',
  '- [warning] Two hardest-band courses in one term: Fall 2026 puts CS 124 and MATH 221 together; Fall 2027 puts CS 225 and MATH 241 together.',
  '- [info] Summer could save time: Summer 2027 could take PSYC 100 and lighten Spring 2027.',
  '- [info] CS 498 is a special-topics number; its title varies by term.',
].join('\n');

const QUESTIONS = [
  'How heavy is my first fall, and how many credits is it?',
  "What's the last day I can drop a fall class without getting a W?",
  "Could I take STAT 400 in Spring 2028 instead of my CS 199 slot? What does it need first? Don't change anything yet.",
];
/** What a correct answer must say, from the board, the term dates or the canned tool results. */
const EXPECT = [/16/, /Oct(ober)?\.? 16/, /MATH 241/];

// ---------------------------------------------------------------------------
// Canned tool results: the same every run, shaped like the workspace's.
// ---------------------------------------------------------------------------

const termLine = (term) => BOARD.split('\n').find((l) => l.startsWith(`${term} (`)) ?? null;
function cannedTool(name, input) {
  const term = typeof input.term === 'string' ? input.term : 'Fall 2026';
  const code = typeof input.code === 'string' ? input.code.toUpperCase().replace(/\s+/g, ' ') : '';
  switch (name) {
    case 'term_summary': {
      const line = termLine(term);
      if (!line) return { ok: false, error: `${term} is not on the board.` };
      return {
        term,
        credits: Number(line.match(/\((\d+) cr/)?.[1] ?? 0),
        load: term === 'Fall 2026' ? { reading: 'heavy', why: 'CS 124 and MATH 221 are both in the hardest band of Illinois grade history (average GPA under 2.9); RHET 105 is a writing-intensive 4 credits.' } : { reading: 'moderate' },
        courses: line.split(': ').slice(1).join(': ').split('; ').map((c) => ({ card: c, crnc_eligible: false, crnc_why: 'Gen ed and major courses cannot be taken CR/NC under the college rule.' })),
        weekly_schedule: { checked: term === 'Fall 2026' || term === 'Spring 2027', clash: null },
        review: term === 'Fall 2026' ? ['Two hardest-band courses in one term: CS 124 and MATH 221.'] : [],
      };
    }
    case 'course_details': {
      if (code === 'STAT 400') {
        return {
          code: 'STAT 400', title: 'Statistics and Probability I', credits: 4,
          description: 'Introduction to mathematical probability and statistics: probability, random variables, distributions, estimation and hypothesis testing.',
          prerequisite: 'Credit or concurrent registration in MATH 241.',
          gen_ed: [], on_board: false, taken: false,
          grade_history: { average_gpa: 3.02, band: 'middle', terms: 8 },
          teaching_list: 'On the list of Teachers Ranked as Excellent for 2 of the last 6 terms.',
          offered: ['Fall', 'Spring', 'Summer'],
          sections_term: 'Spring 2027', sections_note: 'Spring 2028 is not published; showing Spring 2027.',
          sections: [{ crn: '31207', days: 'MWF', time: '10:00-10:50', instructor: 'Hutchens' }, { crn: '31208', days: 'TR', time: '12:30-13:45', instructor: 'He' }],
          fit: { score: 0.71, reasons: ['counts toward the CS statistics list alternative', 'grade history lighter than CS 361'] },
          crnc_eligible: false, crnc_why: 'It would fill a degree requirement.',
        };
      }
      if (code === 'MATH 241') return { code: 'MATH 241', title: 'Calculus III', credits: 4, prerequisite: 'MATH 231.', on_board: 'Fall 2027 [required]' };
      return { ok: false, error: `No canned details for ${code || 'that course'} in this test.` };
    }
    case 'what_if':
      return { ok: true, changes: input.changes ?? input, checks: { prerequisites: 'met: MATH 241 is on the board in Fall 2027, before Spring 2028', standing: 'met', exclusions: 'none' }, credits_after: { 'Spring 2028': 18 }, review_flags_caused: [], fit: 'STAT 400 fits the student\'s interest in data science.' };
    case 'search_courses':
      return { results: [{ code: 'STAT 400', title: 'Statistics and Probability I', credits: 4, eligible_in: term, fit: 0.71 }] };
    case 'explain_choice':
      return { code: code || 'CS 199', why: 'Elective slot: picked to reach the 128-credit total; no requirement names it.', runners_up: [] };
    case 'university_answer':
      return { answer: 'For full-term fall 2026 courses, the last day to drop without a W on the transcript is Friday, October 16, 2026.', sources: [{ title: 'Registration deadlines, Office of the Registrar', url: 'https://registrar.illinois.edu/academic-calendars/' }] };
    case 'planner_answer':
      return { handled: false };
    case 'review_board':
      return { review: BOARD.split('\n').filter((l) => l.startsWith('- [')), first_year_momentum: { ok: true } };
    default:
      return { ok: false, error: `The ${name} tool has no canned result in this test; answer from what you have.` };
  }
}

// ---------------------------------------------------------------------------
// The old request, rebuilt from app/api/advisor/route.ts at 7ce5bd7.
// ---------------------------------------------------------------------------

function legacyRequest({ model, bot, schoolName, schoolShort, board, messages, now }) {
  return {
    model,
    max_tokens: 4096,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high' },
    system: [
      { type: 'text', text: A.advisorSystem(bot, schoolName, schoolShort), cache_control: { type: 'ephemeral' } },
      ...(/illinois/i.test(schoolName) ? [{ type: 'text', text: D.termDatesBlock(now) }] : []),
      { type: 'text', text: `The board right now:\n\n${board}` },
    ],
    tools: A.ADVISOR_TOOLS,
    messages,
  };
}

// ---------------------------------------------------------------------------

const chars = (req) => JSON.stringify(req).length;
const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('');

if (DRY) {
  const history = [{ role: 'user', content: QUESTIONS[0] }];
  const after = R.advisorRequest({ model: MODEL, ...SCHOOL, board: BOARD, messages: history, now: NOW });
  const before = legacyRequest({ model: MODEL, ...SCHOOL, board: BOARD, messages: history, now: NOW });
  console.log(JSON.stringify({ model: MODEL, board_chars: BOARD.length, after_chars: chars(after), before_chars: chars(before), after_marks: JSON.stringify(after).split('"cache_control"').length - 1, before_marks: JSON.stringify(before).split('"cache_control"').length - 1, after_last_message_blocks: after.messages.at(-1).content.map((b) => b.type) }, null, 1));
  process.exit(0);
}

function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const file = join(ROOT, '.env.local');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8').split('\n').find((l) => /^\s*ANTHROPIC_API_KEY\s*=/.test(l));
  return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : null;
}
const apiKey = loadKey();
if (!apiKey) {
  console.error('No ANTHROPIC_API_KEY in the environment or .env.local.');
  process.exit(2);
}
const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey });

let calls = 0;
let spent = 0;
const log = (row) => {
  if (OUT) appendFileSync(OUT, `${JSON.stringify(row)}\n`);
};
if (OUT) writeFileSync(OUT, '');

async function call(params, label) {
  const worst = G.worstCaseUsd(params.model, G.tokensForChars(chars(params)), params.max_tokens, { cacheWrites: true });
  if (calls >= MAX_CALLS) throw new Error(`call cap ${MAX_CALLS} reached before ${label}`);
  if (spent + worst > BUDGET) throw new Error(`budget: $${spent.toFixed(3)} spent, next call could cost $${worst.toFixed(3)}, cap $${BUDGET}`);
  calls += 1;
  const started = Date.now();
  const run = client.beta.messages.stream(params);
  const message = await run.finalMessage();
  const cost = G.costUsd(params.model, message.usage);
  spent += cost;
  const u = message.usage;
  const row = {
    label, call: calls, model: params.model, seconds: Math.round((Date.now() - started) / 100) / 10,
    usage: { input_tokens: u.input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens, output_tokens: u.output_tokens, cache_creation: u.cache_creation ?? null },
    cost_usd: Math.round(cost * 1e5) / 1e5, stop_reason: message.stop_reason,
    tools: message.content.filter((b) => b.type === 'tool_use').map((b) => `${b.name} ${JSON.stringify(b.input)}`),
    text: textOf(message.content),
  };
  log(row);
  console.log(`${label.padEnd(22)} in ${String(u.input_tokens).padStart(6)}  write ${String(u.cache_creation_input_tokens ?? 0).padStart(6)}  read ${String(u.cache_read_input_tokens ?? 0).padStart(6)}  out ${String(u.output_tokens).padStart(5)}  $${cost.toFixed(4)}  ${message.stop_reason}${row.tools.length ? `  -> ${row.tools.join(', ')}` : ''}`);
  return { message, row };
}

// AFTER: the conversation, live, in the new shape. Each request is kept for the replay.
const requests = [];
const history = [];
const afterRows = [];
console.log(`\nAFTER (new shape, ${MODEL}): the conversation runs live\n`);
try {
  for (let q = 0; q < QUESTIONS.length; q += 1) {
    history.push({ role: 'user', content: QUESTIONS[q] });
    for (let step = 0; step < STEP_CAP; step += 1) {
      // Leave room for the replay: the "before" side makes as many calls as "after".
      if (calls >= Math.floor(MAX_CALLS / 2)) throw new Error('half the call cap used by AFTER; stopping so BEFORE can replay');
      const snapshot = structuredClone(history);
      const { message, row } = await call(R.advisorRequest({ model: MODEL, ...SCHOOL, board: BOARD, messages: snapshot, now: NOW }), `after q${q + 1} step ${step + 1}`);
      requests.push({ q, step, messages: snapshot, final: message.stop_reason !== 'tool_use' });
      afterRows.push({ q, ...row });
      history.push({ role: 'assistant', content: message.content });
      if (message.stop_reason !== 'tool_use') break;
      const results = message.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(cannedTool(b.name, b.input ?? {})) }));
      history.push({ role: 'user', content: results });
    }
  }
} catch (error) {
  console.log(`AFTER stopped: ${error.message}`);
}

// BEFORE: the same requests, in the old shape.
const beforeRows = [];
console.log(`\nBEFORE (old shape): the same ${requests.length} requests replayed\n`);
try {
  for (const r of requests) {
    const { row } = await call(legacyRequest({ model: MODEL, ...SCHOOL, board: BOARD, messages: r.messages, now: NOW }), `before q${r.q + 1} step ${r.step + 1}`);
    beforeRows.push({ q: r.q, final: r.final, ...row });
  }
} catch (error) {
  console.log(`BEFORE stopped: ${error.message}`);
}

// Per question, and whether each final answer says what it must.
console.log('\nPER QUESTION');
const sum = (rows) => rows.reduce((n, r) => n + r.cost_usd, 0);
for (let q = 0; q < QUESTIONS.length; q += 1) {
  const a = afterRows.filter((r) => r.q === q);
  const b = beforeRows.filter((r) => r.q === q);
  const aFinal = a.find((r) => r.stop_reason !== 'tool_use')?.text ?? '';
  const bFinal = b.at(-1)?.text ?? '';
  const summary = {
    question: QUESTIONS[q], calls: a.length,
    after_usd: Math.round(sum(a) * 1e4) / 1e4, before_usd: Math.round(sum(b) * 1e4) / 1e4,
    after_answer_ok: EXPECT[q].test(aFinal), before_answer_ok: EXPECT[q].test(bFinal),
  };
  log({ label: 'question', ...summary });
  console.log(JSON.stringify(summary));
}
const total = { label: 'total', calls, spent_usd: Math.round(spent * 1e4) / 1e4, after_usd: Math.round(sum(afterRows) * 1e4) / 1e4, before_usd: Math.round(sum(beforeRows) * 1e4) / 1e4 };
log(total);
console.log(JSON.stringify(total));
