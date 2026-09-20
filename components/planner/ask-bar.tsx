'use client';

/**
 * The ask bar, one 56px grid row along the bottom.
 *
 * Two answerers behind one input. Anything the planner already holds is
 * answered here, from the files in the browser, with the Illinois page each
 * fact came from: rooms, meeting times, CRNs, prerequisites, term load, degree
 * progress. Everything else goes upstream to TRU.
 *
 * The routing decision is ask-router's, not this component's. What this file
 * owns is that an answer never moves the board: the panel is absolutely
 * positioned inside a fixed-height row, so the board's height and both of its
 * scroll offsets are untouched while an answer is open and after it closes.
 */

import { useRef, useState } from 'react';
import { routeQuestion, type AskContext, type Source } from '@/lib/planner/ask-router';
import type { School } from '@/lib/planner/onboarding';

interface Answered {
  text: string;
  sources: Source[];
  grounded: boolean;
}

/** Four openers that are true for any school. The last uses the school's own word. */
function suggestionsFor(school: School | undefined): string[] {
  return [
    'Where does my first class meet?',
    'Which term is hardest?',
    'What do I need before CS 225?',
    school?.dropTerm === 'Q-drop' ? 'How many Q-drops do I get?' : 'How do I drop a class?',
  ];
}

export function AskBar({
  school,
  buildContext,
}: {
  school?: School;
  /** Null when the planner holds no data for this school, which sends everything upstream. */
  buildContext: () => Promise<AskContext | null>;
}) {
  const suggestions = suggestionsFor(school);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [answers, setAnswers] = useState<Answered[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [chips, setChips] = useState(false);
  /**
   * Only a grounded upstream answer becomes the next question's `prior`. TRU's
   * prompt treats prior as its own previous text, so handing it an answer this
   * file wrote locally would have it reason about words it never said.
   */
  const lastUpstream = useRef<string | null>(null);

  async function upstream(q: string): Promise<Answered> {
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, school: school?.id, prior: lastUpstream.current }),
      });
      const data = (await res.json()) as {
        text?: string;
        error?: string;
        sources?: Source[];
        grounded?: boolean;
      };
      // A 400, 413 or 429 carries its reason in `error`. Rendering an empty
      // bubble there tells the student nothing at all.
      const text = data.text || data.error || 'No answer came back.';
      const grounded = Boolean(data.grounded);
      if (grounded && data.text) lastUpstream.current = data.text;
      return { text, sources: Array.isArray(data.sources) ? data.sources : [], grounded };
    } catch {
      return {
        text: 'Could not reach the answer service. The planner above still works.',
        sources: [],
        grounded: false,
      };
    }
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setChips(false);
    // The question moves into the panel head, so leaving it in the field too
    // meant the next one was typed onto the end of the last one.
    setQuestion('');
    setAsked(text);
    setOpen(true);
    setAnswers([]);
    setBusy('Checking what the planner already knows.');

    const ctx = await buildContext();
    if (!ctx) {
      setBusy(`Reading ${school?.short ?? 'the university'}'s published pages.`);
      setAnswers([await upstream(text)]);
      setBusy(null);
      return;
    }

    const routed = routeQuestion(text, ctx);
    if (routed.kind === 'local') {
      const out: Answered[] = [
        { text: routed.answer.text, sources: routed.answer.sources, grounded: routed.answer.grounded },
      ];
      setAnswers(out);
      if (routed.alsoUpstream) {
        setBusy(`Reading ${school?.short ?? 'the university'}'s published pages.`);
        setAnswers([...out, await upstream(routed.alsoUpstream)]);
      }
      setBusy(null);
      return;
    }

    setBusy(`Reading ${school?.short ?? 'the university'}'s published pages.`);
    const remote = await upstream(routed.question);
    setAnswers(routed.alsoLocal
      ? [
          {
            text: routed.alsoLocal.text,
            sources: routed.alsoLocal.sources,
            grounded: routed.alsoLocal.grounded,
          },
          remote,
        ]
      : [remote]);
    setBusy(null);
  }

  return (
    <div className="askbar-dock">
      {open && (
        <section className="askbar-panel" aria-label="Answer">
          <div className="askbar-panel-head">
            <span className="askbar-q">{asked || 'Answer'}</span>
            <button className="askbar-close" onClick={() => setOpen(false)} aria-label="Close answer">
              Close
            </button>
          </div>
          <div className="askbar-body">
            {busy && <p className="askbar-thinking">{busy}</p>}
            {answers.map((a, i) => (
              <div key={i}>
                <p className="askbar-answer">{a.text}</p>
                {/* A source list under an answer that says we do not hold the
                    fact would cite a page that does not contain it. */}
                {a.grounded && a.sources.length > 0 && (
                  <ul className="askbar-sources">
                    {a.sources.map((s) => (
                      <li key={`${s.n}-${s.url}`}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          <span className="askbar-src-n">{s.n}</span>
                          <span className="askbar-src-t">{s.title}</span>
                          <span className="askbar-src-h">{s.host}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {chips && !question.trim() && (
        <div className="askbar-suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="askbar-chip"
              onMouseDown={(event) => {
                // mousedown, not click: the input's blur would close this first.
                event.preventDefault();
                setQuestion(s);
                void send(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="askbar"
        onSubmit={(event) => {
          event.preventDefault();
          void send(question);
        }}
      >
        <input
          className="askbar-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onFocus={() => setChips(true)}
          onBlur={() => window.setTimeout(() => setChips(false), 120)}
          placeholder={`Ask anything about ${school?.short ?? 'your school'}`}
          aria-label={`Ask a question about ${school?.short ?? 'your school'}`}
        />
        <button className="askbar-go" type="submit" disabled={Boolean(busy)} aria-label="Ask">
          {busy ? '...' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
