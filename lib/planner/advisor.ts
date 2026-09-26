/**
 * The advisor: a model that can read the board and change it.
 *
 * The board, the catalog and every rule about them live in the browser, and
 * the model lives behind /api/advisor. So the loop is split down the middle:
 * the server runs one model step and streams it back; the browser executes
 * every tool the model asked for against the real board, appends the results,
 * and asks for the next step. The server keeps nothing between requests, which
 * is what keeps the API key on the server and a student's plan off it.
 *
 * Every tool that changes the board goes through the same checks the board
 * itself runs (prerequisites, standing, credit rules, twins, the term maximum),
 * so the model cannot put a course where the finder would refuse it. The one
 * thing the checks cannot decide is whether a student wants a required course
 * gone, and that is why removal and replacement of anything the degree names
 * ask for a confirmation the model has to obtain in the conversation first.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type AdvisorMessage = Anthropic.Beta.BetaMessageParam;
export type AdvisorBlock = Anthropic.Beta.BetaContentBlock;

/** The model the advisor runs on. One place, because the route and the UI both name it. */
export const ADVISOR_MODEL = 'claude-opus-5';

// ---------------------------------------------------------------------------
// The tools, as the model sees them
// ---------------------------------------------------------------------------

export const ADVISOR_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_courses',
    description:
      'Find courses in the active university catalog by code, title or department, e.g. "history", "HIST 2", "data science". When term is given, only courses the student could actually take in that term are returned: prerequisites met by what is earlier on the board, class standing met, nothing the catalog says does not count beside a course already held, nothing already on the board. Use this before adding or replacing anything.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A code, part of a title, or a department name or topic.' },
        term: { type: 'string', description: 'A term on the board, like "Fall 2027". Restricts results to courses eligible in that term.' },
        limit: { type: 'integer', minimum: 1, maximum: 40, description: 'How many to return. Default 12.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'course_details',
    description:
      'Everything the planner holds about one course: the catalog description, its prerequisite sentence, general education categories, grade history, how many sections ran in the crawled term, and whether it is on the board or already taken.',
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'A course code like "HIST 200".' } },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'term_summary',
    description:
      'One term of the board: its courses with why each is there (required, from a list, elective slot, or added by the student), its credit hours, any available workload evidence, and any review issues on it.',
    input_schema: {
      type: 'object',
      properties: { term: { type: 'string', description: 'A term label like "Spring 2028".' } },
      required: ['term'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_course',
    description:
      'Put a course on the board. With a term, it goes there if the checks allow it; without one, the earliest term where it is eligible and under the credit maximum is chosen. Fails, with the reason, when a prerequisite is not met, standing is too low, the term would pass 18 credits, or the catalog says the course does not count beside something the student has.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        term: { type: 'string', description: 'A term label like "Fall 2028". Optional.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_course',
    description:
      'Take a course off the board. A course the degree requires, or one filling a "from a list" requirement, is only removed when confirmed is true, which you may set only after the student has said yes in this conversation to removing that specific course. Elective slots and courses the student added can be removed freely.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        confirmed: { type: 'boolean', description: 'True only after the student explicitly agreed to remove this required course.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'replace_course',
    description:
      'Swap one course on the board for another in the same term, keeping the term the same size. The usual way to act on an interest: replace an elective slot with a course the student would rather take. Replacing a required or from-a-list course needs confirmed true, obtained the same way as for remove_course. The replacement must pass the same checks as add_course.',
    input_schema: {
      type: 'object',
      properties: {
        remove: { type: 'string', description: 'The code coming off the board.' },
        add: { type: 'string', description: 'The code going on in its place.' },
        confirmed: { type: 'boolean' },
      },
      required: ['remove', 'add'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_course',
    description: 'Move a course on the board to another term, if the checks allow it there.',
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string' }, term: { type: 'string' } },
      required: ['code', 'term'],
      additionalProperties: false,
    },
  },
  {
    name: 'planner_answer',
    description:
      'Ask the planner itself a question about the board or the catalog: where and when a course meets, what a course needs first, how heavy a term is, which term is hardest, degree progress, whether the plan is in the right order. Returns an exact, sourced answer written from the data in the browser, or handled false when the question is not about the board.',
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'university_answer',
    description:
      "Ask about the student's selected university: registration, deadlines, drop rules, parking, housing, offices, policies, or anything on its published pages. Returns an answer with the pages it came from. Use it for anything the board cannot answer, and pass on its sources.",
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
];

export type AdvisorToolName =
  | 'search_courses'
  | 'course_details'
  | 'term_summary'
  | 'add_course'
  | 'remove_course'
  | 'replace_course'
  | 'move_course'
  | 'planner_answer'
  | 'university_answer';

/** Runs one tool against the real board. Implemented by the workspace. */
export type AdvisorExecutor = (name: AdvisorToolName, input: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// What the model is told, once
// ---------------------------------------------------------------------------

export function advisorSystem(bot: string, schoolName: string, schoolShort: string): string {
  return `You are ${bot}, the ${schoolName} assistant. Students ask you anything about ${schoolShort}: registration, deadlines, dropping and adding, tuition, housing, dining, parking, offices and who to contact, majors and what they need, campus life, policies. You answer those from the university's own published pages through the university_answer tool. You also sit inside a four-year course planner: the student is looking at their board, one column per term, a card per course, and you can read it and change it with tools.

What you are for
- Answer any question about ${schoolShort}, from its pages, with the page named. That is most of what students ask; treat it as the main job, not a sideline.
- Answer questions about the student's own plan, and change the plan when the student wants it changed.
- When the student expresses an interest ("I really like history", "I want more data science"), act on it: search for courses in that area that are eligible in a term, replace elective slots with the best fits, and tell them what you did. Do not stop to ask which term unless it genuinely matters; act, then offer alternatives and ask if they want more.
- When a request is ambiguous in a way that changes what you would do (which of two required courses to drop, whether to keep a course they said they liked), ask one short question and wait.
- Keep the conversation: remember what they told you earlier in this chat and build on it.

Rules about the board
- Every card on the board is marked required, from a list, elective slot, or added by the student. Prefer changing elective slots. Never remove or replace a required or from-a-list course unless the student has clearly said yes to removing that specific course in this conversation; then, and only then, call the tool with confirmed true. If they ask you to drop one, say what it is required for and ask for a yes.
- Use the tools for every fact. Do not state a course's prerequisites, credits, difficulty or description from memory; call course_details or planner_answer. Do not claim a course is eligible in a term without search_courses or a successful add.
- A tool that fails says why. Relay the reason plainly and try the next best option (another term, another course).
- Keep terms between the student's minimum and 18 credits. Replacing keeps the size; adding raises it, so prefer replacing an elective slot when a term is already full.

How to talk
- Plain, short, specific. Name courses by code and title, and name the term. Say exactly what changed: "Replaced FIN 435 with HIST 200, Introduction to Historical Interpretation, in Spring 2029."
- No headers, no bullet lists longer than four items, no markdown tables. A short paragraph or a few lines.
- When university_answer returns sources, mention where the answer came from in a few words. Never invent a page, office, deadline or policy.
- You are not a licensed academic advisor and you do not register anyone. Where a decision has consequences (dropping a required course, overloading), say so once and let the student decide.`;
}

// ---------------------------------------------------------------------------
// The loop, run in the browser
// ---------------------------------------------------------------------------

export interface AdvisorStep {
  content: AdvisorBlock[];
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
}

export interface AdvisorTurnEvents {
  /** Text the model is writing, as it writes it. */
  onText?: (delta: string) => void;
  /** A tool is about to run. */
  onTool?: (name: AdvisorToolName, input: Record<string, unknown>) => void;
  /** A tool finished, with what it returned. */
  onToolResult?: (name: AdvisorToolName, input: Record<string, unknown>, result: unknown) => void;
  /** One model step finished; the transcript so far. */
  onStep?: (messages: AdvisorMessage[]) => void;
}

const MAX_STEPS = 8;

/**
 * One model step: the whole transcript up, one assistant message back, its
 * text streamed as it is written.
 */
async function advisorStep(
  messages: AdvisorMessage[],
  board: string,
  bot: string,
  schoolName: string,
  schoolShort: string,
  onText: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<AdvisorStep> {
  const res = await fetch('/api/advisor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, board, bot, schoolName, schoolShort }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `The advisor answered ${res.status}.`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: AdvisorStep | null = null;
  let failure: string | null = null;
  const handle = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const event = JSON.parse(line.slice(6)) as
      | { type: 'text'; delta: string }
      | { type: 'final'; message: AdvisorStep }
      | { type: 'error'; error: string };
    if (event.type === 'text') onText?.(event.delta);
    else if (event.type === 'final') final = event.message;
    else failure = event.error;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at = buffer.indexOf('\n\n');
    while (at >= 0) {
      handle(buffer.slice(0, at).trim());
      buffer = buffer.slice(at + 2);
      at = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) handle(buffer.trim());
  if (failure) throw new Error(failure);
  if (!final) throw new Error('The advisor stopped without answering.');
  return final;
}

/**
 * One turn of the conversation: the student's message in, the model's tool
 * calls executed against the board as they come, the final reply out.
 *
 * `board` is rebuilt for every step, because each step may have changed it.
 * The returned transcript includes every assistant message and every tool
 * result, which is what the next turn needs to keep the context.
 */
export async function runAdvisorTurn(input: {
  messages: AdvisorMessage[];
  userText: string;
  board: () => string;
  /** The name the bot answers to: ALMA at Illinois. */
  bot: string;
  schoolName: string;
  schoolShort: string;
  execute: AdvisorExecutor;
  events?: AdvisorTurnEvents;
  signal?: AbortSignal;
}): Promise<{ messages: AdvisorMessage[]; refused: string | null }> {
  const messages: AdvisorMessage[] = [...input.messages, { role: 'user', content: input.userText }];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const reply = await advisorStep(
      messages,
      input.board(),
      input.bot,
      input.schoolName,
      input.schoolShort,
      input.events?.onText,
      input.signal,
    );
    messages.push({ role: 'assistant', content: reply.content as Anthropic.Beta.BetaContentBlockParam[] });
    input.events?.onStep?.(messages);
    if (reply.stop_reason === 'refusal') {
      return { messages, refused: reply.stop_details?.explanation ?? 'The advisor declined to answer that.' };
    }
    if (reply.stop_reason !== 'tool_use') break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of reply.content) {
      if (block.type !== 'tool_use') continue;
      const name = block.name as AdvisorToolName;
      const args = (block.input ?? {}) as Record<string, unknown>;
      input.events?.onTool?.(name, args);
      let result: unknown;
      try {
        result = await input.execute(name, args);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : 'The tool failed.' };
      }
      input.events?.onToolResult?.(name, args, result);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    // All results in one user message, in order. Splitting them trains the
    // model to stop asking for tools in parallel.
    messages.push({ role: 'user', content: results });
    input.events?.onStep?.(messages);
  }
  return { messages, refused: null };
}

/** The text of the last assistant message, for the transcript and for storage. */
export function lastAssistantText(messages: AdvisorMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    const text = m.content
      .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (text.trim()) return text;
  }
  return '';
}
