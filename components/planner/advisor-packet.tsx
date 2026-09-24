'use client';

/**
 * The advisor packet, as a page: what "Print for my advisor" opens.
 *
 * Two parts. AdvisorPacketSheet lays out the packet lib/planner/advisor-packet.ts
 * builds, and nothing else: no state, no effects, so a check can render it to
 * a string and read what an advisor would read. AdvisorPacketDialog puts the
 * sheet over the planner with a Print button; it is portaled into <body> so
 * the print stylesheet can hide everything that is not the packet, because
 * the planner is a 100dvh grid with overflow hidden and printing it gives one
 * clipped screen of the board.
 *
 * On screen the sheet wears the app's tokens; on paper it is black on white
 * in the app's serif, with course codes in its monospace, and it runs to about
 * two letter pages for a four-year board. Nothing is sent anywhere: the browser
 * prints what is on the screen, or saves it as a PDF from the same dialog.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AdvisorPacket, CardRole, PacketPick } from '@/lib/planner/advisor-packet';

/**
 * A course next term has a row of its own when it is one of the planner's
 * picks: its backup, or the line saying nothing registrable takes its place.
 * The courses the plan needs as they are (required, career track, language,
 * prerequisite) share one row. A pre-med's first fall printed "None: the plan
 * needs this course" five times, a quarter of a page of the two.
 */
const hasOwnRow = (c: PacketPick) => c.chosen;

/** The chip each role wears, drawn like the board's: a dashed slot, a dotted language, a solid requirement. */
function RoleChip({ kind }: { kind: CardRole }) {
  return (
    <span
      className={cn(
        'packet-role',
        kind === 'required' && 'is-required',
        kind === 'elective slot' && 'is-slot',
        kind === 'language' && 'is-language',
      )}
    >
      {kind}
    </span>
  );
}

export function AdvisorPacketSheet({ packet }: { packet: AdvisorPacket }) {
  const errors = packet.flags.filter((f) => f.severity === 'error').length;
  return (
    <article className="packet-sheet" aria-labelledby="packet-title">
      <header className="packet-head">
        <p className="packet-kicker">
          {packet.school} · plan to review with my advisor · made {packet.madeOn}
        </p>
        <h1 id="packet-title">{packet.degree}</h1>
        <dl className="packet-facts">
          <div>
            <dt>Finish</dt>
            <dd>{packet.finish}</dd>
          </div>
          <div>
            <dt>Credits</dt>
            <dd>{packet.credits}</dd>
          </div>
          {packet.goal && (
            <div>
              <dt>After the degree</dt>
              <dd>{packet.goal}</dd>
            </div>
          )}
          {packet.held && (
            <div>
              <dt>Already counted</dt>
              <dd>{packet.held}</dd>
            </div>
          )}
        </dl>
        <p className="packet-fill" aria-hidden="true">
          <span>Name</span>
          <span>NetID</span>
          <span>Advisor</span>
          <span>Meeting date</span>
        </p>
        <p className="packet-unofficial">{packet.unofficial}</p>
      </header>

      <section className="packet-section" aria-labelledby="packet-board">
        <h2 id="packet-board">The plan, term by term</h2>
        <p className="packet-legend">
          Each course says why it is here: <RoleChip kind="required" /> the degree names it,{' '}
          <RoleChip kind="from a list" /> one of a list it names, <RoleChip kind="gen ed pick" /> the
          planner&apos;s pick for a category, <RoleChip kind="elective slot" /> toward the total,{' '}
          <RoleChip kind="career track" /> for the goal named, <RoleChip kind="prerequisite" /> a later
          course needs it, <RoleChip kind="language" /> the language requirement,{' '}
          <RoleChip kind="added" /> put there by the student.
        </p>
        <div className="packet-terms">
          {packet.terms.map((term) => (
            <section key={term.label} className={cn('packet-term', term.away && 'is-away')}>
              <h3>
                <span>{term.label}</span>
                <span className="packet-term-credits">{term.credits}</span>
              </h3>
              {term.away && <p className="packet-away">{term.away}</p>}
              {term.load && <p className="packet-load">{term.load}</p>}
              {term.courses.length > 0 && (
                <ul>
                  {term.courses.map((c) => (
                    <li key={c.code}>
                      <span className="packet-code">{c.code}</span>
                      <span className="packet-course-title">{c.title}</span>
                      <span className="packet-cr">{c.credits}</span>
                      <span className="packet-fills">
                        <RoleChip kind={c.role} /> {c.fills}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </section>

      {packet.next && (
        <section className="packet-section" aria-labelledby="packet-next">
          <h2 id="packet-next">
            Next term: {packet.next.label} <small>{packet.next.credits}</small>
          </h2>
          <table className="packet-next">
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Why it is on the plan</th>
                <th scope="col">Backup if it is full</th>
              </tr>
            </thead>
            <tbody>
              {packet.next.courses.filter(hasOwnRow).map((c) => (
                <tr key={c.code}>
                  <td>
                    <span className="packet-code">{c.code}</span> {c.title} <span className="packet-cr">{c.credits}</span>
                  </td>
                  <td>
                    <RoleChip kind={c.role} /> {c.fills}
                  </td>
                  <td>
                    {c.backup ? (
                      <>
                        <span className="packet-code">{c.backup.code}</span> {c.backup.title}{' '}
                        <span className="packet-cr">{c.backup.credits}</span>
                        <span className="packet-why">{c.backup.why}</span>
                      </>
                    ) : (
                      <span className="packet-why">
                        No other course you can register for takes its place this term. Take another section, or ask
                        what could.
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {packet.next.courses.some((c) => !hasOwnRow(c)) && (
                <tr>
                  <td colSpan={3}>
                    {packet.next.courses
                      .filter((c) => !hasOwnRow(c))
                      .map((c, i) => (
                        <span key={c.code}>
                          {i > 0 && '; '}
                          <span className="packet-code">{c.code}</span> {c.title} <span className="packet-cr">{c.credits}</span>{' '}
                          <RoleChip kind={c.role} />
                        </span>
                      ))}
                    <span className="packet-why">
                      No backup: the plan needs these as they are. If a section is full, take another section of the same
                      course.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <section className="packet-section" aria-labelledby="packet-assumes">
        <h2 id="packet-assumes">What this plan assumes</h2>
        {packet.assumptions.length === 0 && <p className="packet-none">Nothing beyond the catalog as published.</p>}
        {packet.assumptions.map((a) => (
          <div key={a.kind} className="packet-assumption">
            <h3>{a.heading}</h3>
            {a.items.length > 0 && (
              <ul>
                {a.items.map((item, i) => (
                  <li key={`${i}:${item}`}>{item}</li>
                ))}
              </ul>
            )}
            {a.source && <p className="packet-source">Source: {a.source}</p>}
          </div>
        ))}
      </section>

      <section className="packet-section" aria-labelledby="packet-flags">
        <h2 id="packet-flags">
          Open review flags{' '}
          <small>
            {packet.flags.length === 0
              ? 'none'
              : `${packet.flags.length} to review${errors > 0 ? `, ${errors} the plan could not settle` : ''}`}
          </small>
        </h2>
        {packet.flags.length > 0 && (
          <ul className="packet-flag-list">
            {packet.flags.map((f) => (
              <li key={`${f.severity}|${f.title}|${f.message}`} className={cn('packet-flag', `is-${f.severity}`)}>
                {/* The titles already say what kind of check it is ("Check this one"). */}
                <strong>
                  {f.severity === 'error' && 'Problem: '}
                  {f.title.replace(/:\s*$/, '')}
                  {f.count > 1 && ` (and ${f.count - 1} more like it)`}.
                </strong>{' '}
                {f.message}
              </li>
            ))}
          </ul>
        )}
        {packet.notes.length > 0 && (
          <>
            <h3 className="packet-subhead">Notes on the review list</h3>
            <ul className="packet-flag-list is-notes">
              {packet.notes.map((f) => (
                <li key={`${f.title}|${f.message}`}>
                  {/* "Major Requirements: Concentration Coursework:" ends in its own colon. */}
                  <strong>
                    {f.title.replace(/:\s*$/, '')}
                    {f.count > 1 && ` (and ${f.count - 1} more like it)`}:
                  </strong>{' '}
                  {f.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="packet-section" aria-labelledby="packet-questions">
        <h2 id="packet-questions">Questions to ask</h2>
        <ol className="packet-questions">
          {packet.questions.map((q) => (
            <li key={q.topic}>
              {q.text}
              {(q.who || q.source) && (
                <span className="packet-who">
                  {q.who && <>Who decides: {q.who}.</>}
                  {q.source && <> Source: {q.source}</>}
                </span>
              )}
            </li>
          ))}
          <li className="packet-own">My own questions:</li>
        </ol>
      </section>

      {packet.plannerNotes.length > 0 && (
        <section className="packet-section" aria-labelledby="packet-notes">
          <h2 id="packet-notes">Also from the planner</h2>
          <ul className="packet-small">
            {packet.plannerNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="packet-foot">
        {packet.unofficial}
        {packet.degreeUrl && <> Degree page: {packet.degreeUrl}</>}
      </footer>
    </article>
  );
}

/**
 * The sheet over the planner, with Print and Back. Escape closes it. The
 * html element carries packet-open while it is up, which is what the print
 * stylesheet keys on to print this and nothing behind it.
 */
export function AdvisorPacketDialog({ packet, onClose }: { packet: AdvisorPacket; onClose: () => void }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('packet-open');
    // The planner behind the sheet is covered, not gone: without this, Tab
    // walked from Print into the board's cards under the overlay.
    const behind = [...document.body.children].filter((el) => !el.classList.contains('packet-overlay') && !el.hasAttribute('inert'));
    for (const el of behind) el.setAttribute('inert', '');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      root.classList.remove('packet-open');
      for (const el of behind) el.removeAttribute('inert');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // An open <dialog> rather than showModal(): a modal dialog sits in the top
  // layer, and whether a browser prints the top layer, and where, is not
  // something this page should depend on. The overlay covers the planner and
  // Escape closes it all the same.
  return createPortal(
    <dialog open className="packet-overlay" aria-modal="true" aria-labelledby="packet-title">
      <div className="packet-toolbar">
        <p>
          Print this for your advisor, or choose Save as PDF in the print dialog. It is built from the board on
          this screen and is not sent or stored anywhere.
        </p>
        <div className="packet-toolbar-actions">
          <Button autoFocus onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X /> Back to the board
          </Button>
        </div>
      </div>
      <AdvisorPacketSheet packet={packet} />
    </dialog>,
    document.body,
  );
}
