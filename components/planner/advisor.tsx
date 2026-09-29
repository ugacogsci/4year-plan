'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, CircleAlert, Loader2, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  isBoardNote,
  lastAssistantText,
  runAdvisorTurn,
  undoNote,
  type AdvisorExecutor,
  type AdvisorMessage,
  type AdvisorToolName,
} from '@/lib/planner/advisor';
import type { Source } from '@/lib/planner/ask-router';
import { CHAT_KEY } from '@/lib/planner/saved-board';

/**
 * The bot's panel: a column beside the board that holds a conversation which
 * can change the board.
 *
 * It replaces the ask bar, which answered one question at a time and could
 * not touch anything. This one keeps the whole conversation, so "I really
 * like history" followed by "actually, more recent history" works, and every
 * change it makes is written into the transcript next to the reply that made
 * it, so a student can see what moved and why.
 *
 * It is a grid column, not an overlay: the board gets narrower while it is
 * open and nothing sits on top of a semester. It stays mounted while closed,
 * so a reply that is still being written when the student closes the panel
 * finishes, and the board edits it makes still land.
 *
 * The transcript is the model's own message list, kept verbatim: text,
 * tool calls and tool results in order, because that is what the next turn
 * is built on. What is drawn is derived from it. It is stored on this device
 * per degree, so a reload does not forget the conversation; nothing about it
 * leaves the device except the request each turn makes. It is forgotten with
 * the board it is about (Start over, a new setup, another degree), so it
 * never describes a board that is gone.
 *
 * Everything one message makes ALMA change on the board is one undo step.
 * While that step is the newest, the reply offers "Undo these changes", and
 * an undone turn is written into the conversation as a planner note, so
 * ALMA's "I added HIST 200 to Fall 2027" is not the last word on a board
 * that no longer has it.
 *
 * The bot has the school's name, ALMA at Illinois, the same one its TRU
 * tenant answers to, so a student meets one bot across both products.
 */
export interface BotPanelProps {
  /** ALMA, TRU, REV: the school's own bot name. */
  botName: string;
  schoolShort: string;
  /** The degree the board is for. A new degree is a new conversation. */
  programId: string | null;
  /** The board as it is right now, described for the model. Called before every step. */
  board: () => string;
  execute: AdvisorExecutor;
  /** Questions and requests offered when the conversation is empty. */
  openers: string[];
  /** False until a plan and the catalog are loaded. */
  ready: boolean;
  open: boolean;
  onClose: () => void;
  /** The board's undo for ALMA's turns. Absent where the board keeps no undo for them. */
  turns?: BotTurns;
}

/**
 * ALMA's turns on the board's undo stack. The workspace owns the stack; the
 * panel says when a turn starts and ends, offers the newest turn's undo on
 * the reply it belongs to, and writes the notes for turns undone.
 */
export interface BotTurns {
  /** A message is being sent: the board as it is now is what undoing the turn puts back. */
  begin: () => void;
  /** The turn is over, however it ended. */
  end: () => void;
  /** The newest undo step, when it is an ALMA turn: its id and the tool calls that changed the board. */
  latest: { id: string; toolIds: string[] } | null;
  /** Undo that turn, if it is still the newest step. */
  undo: (id: string) => void;
  /** ALMA turns undone this session, from the reply or from the header's Undo. */
  undone: Array<{ id: string; toolIds: string[]; summary: string[] }>;
}

interface Activity {
  name: AdvisorToolName;
  label: string;
  state: 'running' | 'ok' | 'failed';
  detail?: string;
}

/** Something drawn in the log, derived from the transcript. */
type Line =
  | { kind: 'user'; text: string }
  /** `turn` counts the student's messages; `last` marks the turn's final reply, where its undo is offered. */
  | { kind: 'assistant'; text: string; sources: Source[]; turn: number; last?: boolean }
  | { kind: 'tool'; label: string; state: 'ok' | 'failed'; detail?: string }
  | { kind: 'note'; text: string };

const KEEP = 60;

function toolLabel(name: AdvisorToolName, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'search_courses':
      return `Searching the catalog for “${s('query')}”${s('term') ? ` in ${s('term')}` : ''}`;
    case 'course_details':
      return `Reading ${s('code')}`;
    case 'term_summary':
      return `Looking at ${s('term')}`;
    case 'add_course':
      return `Adding ${s('code')}${s('term') ? ` to ${s('term')}` : ''}`;
    case 'remove_course':
      return `Removing ${s('code')}`;
    case 'replace_course':
      return `Replacing ${s('remove')} with ${s('add')}`;
    case 'move_course':
      return `Moving ${s('code')} to ${s('term')}`;
    case 'planner_answer':
      return 'Checking the board';
    case 'university_answer':
      return `Reading Illinois pages`;
    default:
      return name;
  }
}

/** What a finished tool did, in a few words, from what it returned. */
function toolOutcome(result: unknown): { state: 'ok' | 'failed'; detail?: string } {
  if (!result || typeof result !== 'object') return { state: 'ok' };
  const r = result as { ok?: boolean; error?: string; reason?: string; summary?: string; needs_confirmation?: boolean };
  if (r.ok === false) return { state: 'failed', detail: r.needs_confirmation ? 'needs your yes' : (r.reason ?? r.error) };
  return { state: 'ok', detail: r.summary };
}

/**
 * A transcript that was cut off between a tool call and its result cannot be
 * sent again as it is: every tool call needs a result. The results are
 * written as cancelled, which is the truth, and the model reads on from there.
 */
function settleDanglingTools(messages: AdvisorMessage[]): AdvisorMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || typeof last.content === 'string') return messages;
  const pending = last.content.filter((b) => b.type === 'tool_use');
  if (pending.length === 0) return messages;
  return [
    ...messages,
    {
      role: 'user',
      content: pending.map((b) => ({
        type: 'tool_result' as const,
        tool_use_id: (b as { id: string }).id,
        content: JSON.stringify({ ok: false, error: 'Cancelled by the student before it ran.' }),
      })),
    },
  ];
}

/** The sources one turn's tools brought back: from its question to the next. */
function sourcesIn(messages: AdvisorMessage[], fromIndex: number): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const m of messages.slice(fromIndex)) {
    if (m.role === 'user' && typeof m.content === 'string' && messages.indexOf(m) !== fromIndex) break;
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const block of m.content) {
      if (block.type !== 'tool_result' || typeof block.content !== 'string') continue;
      try {
        const parsed = JSON.parse(block.content) as { sources?: Source[] };
        for (const source of parsed.sources ?? []) {
          if (seen.has(source.url)) continue;
          seen.add(source.url);
          out.push(source);
        }
      } catch {
        /* a result that is not JSON has no sources */
      }
    }
  }
  return out;
}

/**
 * The log, drawn from the transcript: what was said and what was done, and
 * for each of the student's messages (a turn) the tool calls it made, by id.
 */
function linesOf(messages: AdvisorMessage[]): { lines: Line[]; turnTools: string[][] } {
  const lines: Line[] = [];
  const turnTools: string[][] = [[]];
  let turn = 0;
  let toolStart = 0;
  messages.forEach((m, index) => {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        lines.push({ kind: 'user', text: m.content });
        toolStart = index;
        turn += 1;
        turnTools[turn] = [];
      } else {
        for (const block of m.content) {
          if (block.type !== 'text') continue;
          if (isBoardNote(block.text)) lines.push({ kind: 'note', text: 'You undid these changes. The board is back to how it was before that message.' });
          else lines.push({ kind: 'user', text: block.text });
        }
      }
      return;
    }
    if (typeof m.content === 'string') {
      lines.push({ kind: 'assistant', text: m.content, sources: [], turn });
      return;
    }
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
    const tools = m.content.filter((b) => b.type === 'tool_use') as Array<{ name: AdvisorToolName; input: Record<string, unknown>; id: string }>;
    turnTools[turn].push(...tools.map((call) => call.id));
    // The result for each call sits in the next user message.
    const next = messages[index + 1];
    const results = new Map<string, unknown>();
    if (next && next.role === 'user' && typeof next.content !== 'string') {
      for (const block of next.content) {
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          try {
            results.set(block.tool_use_id, JSON.parse(block.content));
          } catch {
            results.set(block.tool_use_id, null);
          }
        }
      }
    }
    for (const call of tools) {
      const outcome = toolOutcome(results.get(call.id));
      lines.push({ kind: 'tool', label: toolLabel(call.name, call.input ?? {}), ...outcome });
    }
    if (text) lines.push({ kind: 'assistant', text, sources: tools.length === 0 ? sourcesIn(messages, toolStart) : [], turn });
  });
  // Sources belong under the reply that used them: the last assistant line
  // of a turn gets everything its tools brought back.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.kind === 'assistant') {
      line.sources = sourcesIn(messages, toolStart);
      break;
    }
  }
  const seen = new Set<number>();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.kind !== 'assistant' || seen.has(line.turn)) continue;
    seen.add(line.turn);
    line.last = true;
  }
  return { lines, turnTools };
}

/** Every tool call in a transcript, by id. */
function toolCallIds(messages: AdvisorMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    for (const block of m.content) if (block.type === 'tool_use') ids.add(block.id);
  }
  return ids;
}

/**
 * The bot's button, for the board's own toolbar. A diamond, the bot's name,
 * and a line saying what it is for, so nobody has to guess that it is a bot.
 * The line leads with Illinois, not the schedule: the bot answers anything on
 * the university's pages, and the plan is one more thing it can do.
 */
export function BotLauncher({ botName, open, onToggle }: { botName: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={cn('bot-launch', open && 'is-open')}
      aria-pressed={open}
      aria-label={open ? `Close ${botName}` : `Open ${botName}`}
      title={open ? `Close ${botName}` : `Ask ${botName} anything about Illinois, or about your plan.`}
      onClick={onToggle}
    >
      <span className="bot-diamond">
        <OrionMark />
      </span>
      <span className="bot-launch-text">Questions about Illinois? Changes to your plan?</span>
      <strong>Ask {botName}</strong>
    </button>
  );
}

/**
 * Orion's mark, kept.
 *
 * The planner grew out of Cameron's Semantic Course Map, whose assistant,
 * Orion, was a four-pointed star in a violet-to-sky circle at the bottom right
 * of the map. The star is that one, drawn rather than typed so it renders the
 * same on every platform; the circle is the CSS on .bot-diamond and
 * .bot-avatar. The bot's name changed with the school, the mark did not.
 */
function OrionMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 1.5c.7 6.2 4.3 9.8 10.5 10.5-6.2.7-9.8 4.3-10.5 10.5-.7-6.2-4.3-9.8-10.5-10.5 6.2-.7 9.8-4.3 10.5-10.5Z" />
    </svg>
  );
}

/** Orion's typing indicator: three dots, bouncing in turn. */
function Typing() {
  return (
    <div className="bot-typing" aria-label="Writing">
      <span />
      <span />
      <span />
    </div>
  );
}

export function BotPanel({ botName, schoolShort, programId, board, execute, openers, ready, open, onClose, turns }: BotPanelProps) {
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // One conversation per degree, remembered on this device.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHAT_KEY);
      const saved = raw ? (JSON.parse(raw) as { programId: string | null; messages: AdvisorMessage[] }) : null;
      // oxlint-disable-next-line react/react-compiler
      setMessages(saved && saved.programId === programId && Array.isArray(saved.messages) ? saved.messages : []);
    } catch {
      setMessages([]);
    }
  }, [programId]);

  const remember = useCallback(
    (next: AdvisorMessage[]) => {
      setMessages(next);
      try {
        window.localStorage.setItem(CHAT_KEY, JSON.stringify({ programId, messages: next.slice(-KEEP) }));
      } catch {
        /* private browsing; the conversation lives for the session */
      }
    },
    [programId],
  );

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, activity, open]);

  /**
   * A turn the student undid is written into the conversation, once, after
   * the reply that made it: from the reply's own button or the header's
   * Undo. Held while a reply is being written, because the turn in flight
   * writes the transcript at every step and would drop a note put in
   * beside it.
   */
  const undone = turns?.undone;
  const noted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (busy || !undone || undone.length === 0) return;
    const called = toolCallIds(messages);
    const due = undone.filter((t) => !noted.current.has(t.id) && t.toolIds.some((id) => called.has(id)));
    if (due.length === 0) return;
    for (const t of due) noted.current.add(t.id);
    // Written from an effect because the undo can come from the header,
    // outside this panel; the ref makes each note land once.
    // oxlint-disable-next-line react/react-compiler
    remember([...messages, ...due.map((t) => undoNote(t.summary))]);
  }, [busy, undone, messages, remember]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const userText = text.trim();
    if (!userText || busy || !ready) return;
    setDraft('');
    setError(null);
    setBusy(true);
    setStreaming('');
    setActivity(null);
    const controller = new AbortController();
    abort.current = controller;
    const start = settleDanglingTools(messages);
    // The student's line goes up at once, so the panel never looks like it
    // swallowed what they typed.
    remember([...start, { role: 'user', content: userText }]);
    // Everything this message changes on the board is one undo step.
    turns?.begin();
    try {
      const turn = await runAdvisorTurn({
        messages: start,
        userText,
        board,
        bot: botName,
        execute,
        signal: controller.signal,
        events: {
          onText: (delta) => setStreaming((current) => current + delta),
          onTool: (name, input) => {
            setStreaming('');
            setActivity({ name, label: toolLabel(name, input), state: 'running' });
          },
          onToolResult: (name, input, result) => {
            const outcome = toolOutcome(result);
            setActivity({ name, label: toolLabel(name, input), ...outcome });
          },
          onStep: (transcript) => {
            remember(transcript);
            setStreaming('');
          },
        },
      });
      remember(turn.messages);
      if (turn.refused) setError(turn.refused);
    } catch (caught) {
      if (controller.signal.aborted) {
        setError('Stopped.');
      } else {
        setError(caught instanceof Error ? caught.message : 'The advisor failed.');
      }
    } finally {
      turns?.end();
      setStreaming('');
      setActivity(null);
      setBusy(false);
      abort.current = null;
    }
  }

  function stop() {
    abort.current?.abort();
  }

  function reset() {
    stop();
    remember([]);
    setError(null);
  }

  const { lines, turnTools } = linesOf(messages);
  const lastText = lastAssistantText(messages);
  const latest = turns?.latest ?? null;
  /** The turn whose changes are the newest undo step: only its last reply offers to undo them. */
  const undoableTurn = latest && !busy ? turnTools.findIndex((ids) => ids.some((id) => latest.toolIds.includes(id))) : -1;

  return (
    <section className={cn('bot-panel', !open && 'is-closed')} aria-label={botName} aria-hidden={!open}>
      <header className="bot-head">
        <span className="bot-diamond">
          <OrionMark />
        </span>
        <div>
          <h2>
            {botName} <span className="bot-head-sub">course assistant · powered by Claude</span>
          </h2>
          <p>Anything about {schoolShort}: classes, deadlines, housing, offices, majors. It also reads your plan and can change it when you ask.</p>
        </div>
        <div className="bot-head-actions">
          {messages.length > 0 && (
            <button type="button" onClick={reset} title="Forget this conversation and start again">
              New chat
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={`Close ${botName}`}>
            <X aria-hidden="true" style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </header>

      <div className="bot-log" ref={logRef}>
        {lines.length === 0 && !busy && (
          <div className="bot-row">
            <span className="bot-avatar" aria-hidden="true">
              <OrionMark />
            </span>
            <div className="bot-msg assistant">
              {ready
                ? `Ask me anything about ${schoolShort}: a class, a deadline, where an office is, what a major needs, how to drop or add a course. I can also read your plan, so ask about a term, or tell me what you would rather be taking and I will change it for you.`
                : 'The board is still loading.'}
            </div>
          </div>
        )}
        {lines.map((line, i) => {
          if (line.kind === 'user') {
            return (
              <div key={i} className="bot-msg user">
                {line.text}
              </div>
            );
          }
          if (line.kind === 'note') {
            return (
              <div key={i} className="bot-tool bot-note">
                <Undo2 aria-hidden="true" />
                <span>{line.text}</span>
              </div>
            );
          }
          if (line.kind === 'tool') {
            return (
              <div key={i} className={`bot-tool ${line.state}`}>
                {line.state === 'ok' ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                <span>
                  {line.label}
                  {line.detail ? ` — ${line.detail}` : ''}
                </span>
              </div>
            );
          }
          return (
            <div key={i} className="bot-row">
              <span className="bot-avatar" aria-hidden="true">
                <OrionMark />
              </span>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'start', minWidth: 0 }}>
                <div className="bot-msg assistant">{line.text}</div>
                {line.last && line.turn === undoableTurn && latest && turns && (
                  <button
                    type="button"
                    className="bot-undo"
                    onClick={() => turns.undo(latest.id)}
                    title={`Put the board back the way it was before this message. Everything ${botName} changed for it goes; nothing else does.`}
                  >
                    <Undo2 aria-hidden="true" /> Undo these changes
                  </button>
                )}
                {line.sources.length > 0 && (
                  <ul className="bot-sources">
                    {line.sources.slice(0, 4).map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title || s.host}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
        {activity && (
          <div className={`bot-tool ${activity.state === 'running' ? '' : activity.state}`}>
            {activity.state === 'running' ? (
              <Loader2 aria-hidden="true" className="bot-spin" />
            ) : activity.state === 'ok' ? (
              <Check aria-hidden="true" />
            ) : (
              <CircleAlert aria-hidden="true" />
            )}
            <span>
              {activity.label}
              {activity.detail ? ` — ${activity.detail}` : ''}
            </span>
          </div>
        )}
        {streaming && (
          <div className="bot-row">
            <span className="bot-avatar" aria-hidden="true">
              <OrionMark />
            </span>
            <div className="bot-msg assistant">{streaming}</div>
          </div>
        )}
        {busy && !streaming && !activity && (
          <div className="bot-row">
            <span className="bot-avatar" aria-hidden="true">
              <OrionMark />
            </span>
            <Typing />
          </div>
        )}
      </div>

      {error && (
        <p className="bot-error" role="alert">
          {error}
        </p>
      )}

      {lines.length === 0 && !busy && ready && openers.length > 0 && (
        <div className="bot-chips">
          {openers.map((opener) => (
            <button key={opener} type="button" className="bot-chip" onClick={() => void send(opener)}>
              {opener}
            </button>
          ))}
        </div>
      )}

      <form
        className="bot-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder={lastText ? 'Reply, or ask something else' : `Ask ${botName} anything about ${schoolShort}, or what to change in your plan`}
          aria-label={`Message ${botName}`}
          disabled={!ready}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        {busy ? (
          <button type="button" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="bot-send" disabled={!ready || !draft.trim()} aria-label="Send" title="Send">
            <ArrowUp aria-hidden="true" />
          </button>
        )}
      </form>
    </section>
  );
}
