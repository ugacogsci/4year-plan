'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowUp, Check, CircleAlert, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  lastAssistantText,
  runAdvisorTurn,
  type AdvisorExecutor,
  type AdvisorMessage,
  type AdvisorToolName,
} from '@/lib/planner/advisor';
import type { Source } from '@/lib/planner/ask-router';
import type { SchoolId } from '@/lib/planner/onboarding';

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
 * leaves the device except the request each turn makes.
 *
 * The bot has the school's name, ALMA at Illinois, the same one its TRU
 * tenant answers to, so a student meets one bot across both products.
 */
export interface BotPanelProps {
  /** ALMA, TRU, REV: the school's own bot name. */
  botName: string;
  schoolId: SchoolId | null;
  schoolName: string;
  schoolShort: string;
  /** The degree the board is for. A new degree is a new conversation. */
  programId: string | null;
  /** The board as it is right now, described for the model. Called before every step. */
  board: () => string;
  execute: AdvisorExecutor;
  /** Questions and requests offered when the conversation is empty. */
  openers: string[];
  /** False until the catalog is loaded. An empty board is still ready for questions. */
  ready: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
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
  | { kind: 'assistant'; text: string; sources: Source[] }
  | { kind: 'tool'; label: string; state: 'ok' | 'failed'; detail?: string };

const STORAGE = 'fourYear.advisor.v1';
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
      return 'Reading university pages';
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

/** The log, drawn from the transcript: what was said and what was done. */
function linesOf(messages: AdvisorMessage[]): Line[] {
  const lines: Line[] = [];
  let toolStart = 0;
  messages.forEach((m, index) => {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        lines.push({ kind: 'user', text: m.content });
        toolStart = index;
      } else {
        for (const block of m.content) {
          if (block.type === 'text') lines.push({ kind: 'user', text: block.text });
        }
      }
      return;
    }
    if (typeof m.content === 'string') {
      lines.push({ kind: 'assistant', text: m.content, sources: [] });
      return;
    }
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
    const tools = m.content.filter((b) => b.type === 'tool_use') as Array<{ name: AdvisorToolName; input: Record<string, unknown>; id: string }>;
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
    if (text) lines.push({ kind: 'assistant', text, sources: tools.length === 0 ? sourcesIn(messages, toolStart) : [] });
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
  return lines;
}

/** The compact-screen control for the transcript drawer. */
export function BotLauncher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={cn('bot-launch', open && 'is-open')}
      aria-expanded={open}
      aria-controls="planner-chat-history"
      aria-label={open ? 'Close planning assistant' : 'Open planning assistant'}
      title={open ? 'Close planning assistant' : 'Open planning assistant'}
      onClick={onToggle}
    >
      <span className="bot-launch-mark" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

/** The supplied assistant artwork, switching poses while a response is being prepared. */
function AssistantAvatar({
  schoolId,
  thinking = false,
}: {
  schoolId: SchoolId | null;
  thinking?: boolean;
}) {
  const hasSchoolHat = schoolId === 'uga' || schoolId === 'illinois';
  return (
    <span className={cn('assistant-avatar', thinking && 'is-thinking')} aria-hidden="true">
      <span className="assistant-pose assistant-pose-idle">
        <Image src="/assistant-poses.png" alt="" width={2160} height={1620} />
      </span>
      <span className="assistant-pose assistant-pose-thinking">
        <Image src="/assistant-poses.png" alt="" width={2160} height={1620} />
      </span>
      {hasSchoolHat && (
        <span className={cn('assistant-hat', `is-${schoolId}`)}>
          <Image
            src="/assistant-hats.png"
            alt=""
            width={2160}
            height={1620}
          />
        </span>
      )}
    </span>
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

export function BotPanel({
  botName,
  schoolId,
  schoolName,
  schoolShort,
  programId,
  board,
  execute,
  openers,
  ready,
  open,
  onOpen,
  onClose,
}: BotPanelProps) {
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
      const raw = window.localStorage.getItem(STORAGE);
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
        window.localStorage.setItem(STORAGE, JSON.stringify({ programId, messages: next.slice(-KEEP) }));
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

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const userText = text.trim();
    if (!userText || busy || !ready) return;
    onOpen();
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
    try {
      const turn = await runAdvisorTurn({
        messages: start,
        userText,
        board,
        bot: botName,
        schoolName,
        schoolShort,
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

  const lines = linesOf(messages);
  const lastText = lastAssistantText(messages);
  const suggestedQuestion = lastText
    ? 'What should I double-check before registration?'
    : openers[0] ?? `What should I know about my ${schoolShort} plan?`;
  const fillPrompt = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const hasConversation = lines.length > 0 || busy || Boolean(streaming) || Boolean(activity) || Boolean(error);

  return (
    <section
      className="bot-panel"
      data-conversation={hasConversation ? 'true' : 'false'}
      data-history={open ? 'open' : 'closed'}
      aria-label={botName}
    >
      <div
        id="planner-chat-history"
        className="bot-history"
        data-open={open ? 'true' : 'false'}
      >
        <header className="bot-head">
          <h2>{botName}</h2>
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
          {!hasConversation && (
            <p className="bot-empty">Ask a question whenever the plan needs a second look.</p>
          )}
          {lines.map((line, i) => {
            if (line.kind === 'user') {
              return (
                <div key={i} className="bot-msg user">
                  {line.text}
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
                <div style={{ display: 'grid', gap: 6, justifyItems: 'start', minWidth: 0 }}>
                  <div className="bot-msg assistant">{line.text}</div>
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
              <div className="bot-msg assistant">{streaming}</div>
            </div>
          )}
          {busy && !streaming && !activity && (
            <div className="bot-row">
              <Typing />
            </div>
          )}
        </div>

        {error && (
          <p className="bot-error" role="alert">
            {error}
          </p>
        )}
        <div className="bot-history-avatar">
          <AssistantAvatar schoolId={schoolId} thinking={busy} />
        </div>
      </div>

      <div className="bot-prompt">
        <form
          className="bot-compose"
          data-suggestion={!draft && ready && !busy ? 'true' : undefined}
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
        {!draft && ready && !busy && (
          <button
            type="button"
            className="bot-suggestion"
            title="Put this suggested follow-up in the message box"
            onClick={() => fillPrompt(suggestedQuestion)}
          >
            {suggestedQuestion}
          </button>
        )}
        </form>

        {ready && openers.length > 0 && (
          <div className="bot-faqs" aria-label="Frequently asked questions">
            <span>FAQ</span>
            {openers.slice(0, 4).map((opener) => (
              <button
                key={opener}
                type="button"
                title="Put this question in the message box"
                onClick={() => fillPrompt(opener)}
              >
                {opener}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
