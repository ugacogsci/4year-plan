'use client';

/**
 * "Clubs for your goals", a section of the rail (DESIGN 4.1).
 *
 * The workspace renders it and hands it to StudentProfilePanel through a
 * `clubs` slot right after "Pick from a list", the way `pools` and
 * `transcript` arrive: the rail owns where it sits, not what it says. Not
 * wired in yet; that waits for the other session's edits to land (DESIGN 6,
 * steps 14 and 15).
 *
 * It shows the same list ALMA's find_clubs returns with no query: one
 * recommendClubs over public/illinois/clubs.json, for the ClubStudent the
 * workspace builds from the student's own goal words (deferred, so typing in
 * the goal box does not re-rank on every letter), their degree and college.
 * It never touches the board, so nothing here needs Rebuild or Undo.
 *
 * What a row shows is a fact with its source: the club's name, linking to its
 * own page; one why line from a fixed template; the kind of club, the next
 * event when the calendar was read, and the first caution. Never logos,
 * officer names, emails, the club's own text, or Orange/Blue. The directory's
 * name, link and date come from the file, never from this code: the directory
 * has moved once already (Engage to OneIllinois).
 *
 * States: loading (three grey rows), file missing (the section hides itself,
 * so the UI can ship before the data), load failed (Try again), no goal
 * words, words that name no known goal, a thin goal, and the list.
 */

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { plural } from './words';
import {
  KIND_LABEL,
  RAIL_VISIBLE,
  freshness,
  recommendClubs,
  thinNote,
  type ClubPick,
  type ClubResult,
  type ClubStudent,
  type IllinoisClubsFile,
} from '@/lib/planner/clubs';
import { loadIllinoisClubs } from '@/lib/planner/clubs-load';
import './club-picks.css';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; data: IllinoisClubsFile }
  /** Not built yet (404), or not this host's to fetch: the section hides itself. */
  | { state: 'missing' }
  | { state: 'failed' };

/** Folded or not, remembered on this device. */
const OPEN_KEY = 'planner.clubs.open';
/** How many picks "Show more" reaches. */
const MOST = 10;
/** Goal words the planner hears, for the card that heard none. */
const EXAMPLE_GOALS = ['pre-law', 'consulting', 'data science', 'journalism'];

export interface ClubPicksProps {
  /**
   * clubStudentOf(...) for the board as it is now, over the deferred goal
   * words; null before the board has a student. The rail's own list.
   */
  student: ClubStudent | null;
  /** Opens Preferences in the rail (the overlay on a phone) and puts the cursor in the goals box. */
  onEditGoals: () => void;
  /** Closes the overlay and opens ALMA with a prompt. Optional: the card works without it. */
  onOpenAlma?: () => void;
  botName?: string;
  /** The day to judge freshness and event dates by. The rail leaves it out. */
  today?: Date | string;
}

export function ClubPicks({ student, onEditGoals, onOpenAlma, botName = 'ALMA', today }: ClubPicksProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(false);
  // The workspace defers the goal words already; this keeps a slow re-rank off the keystroke too.
  const who = useDeferredValue(student);

  useEffect(() => {
    let live = true;
    // oxlint-disable-next-line react/react-compiler
    setLoad({ state: 'loading' });
    void loadIllinoisClubs().then((r) => {
      if (!live) return;
      if (r.ok) setLoad({ state: 'ready', data: r.value });
      else setLoad(r.reason === 'error' ? { state: 'failed' } : { state: 'missing' });
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  // Open on a first visit; a student who folds it keeps it folded on this device. Read after
  // mount, not during render, so the server's HTML and the first client render agree.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      // oxlint-disable-next-line react/react-compiler
      setOpen(window.localStorage.getItem(OPEN_KEY) !== 'closed');
    } catch {
      /* storage blocked: it stays open */
    }
  }, []);

  const result: ClubResult | null = useMemo(
    () => (load.state === 'ready' ? recommendClubs(load.data, who, { limit: MOST, today: today ?? new Date() }) : null),
    [load, who, today],
  );

  if (load.state === 'missing') return null;

  const picks = result?.picks ?? [];
  return (
    <details
      className="rail-section rail-clubs"
      open={open}
      onToggle={(event) => {
        const now = (event.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        try {
          window.localStorage.setItem(OPEN_KEY, now ? 'open' : 'closed');
        } catch {
          /* private window: it opens again next time */
        }
      }}
    >
      <summary>
        <span>
          Clubs for your goals{result && picks.length > 0 ? <span className="rail-clubs-count"> ({picks.length})</span> : null}
        </span>
      </summary>

      {load.state === 'loading' && (
        <div className="club-loading" aria-busy="true">
          <span className="sr-only">Reading the club directory.</span>
          {[70, 85, 60].map((w) => (
            <div key={w} className="club-skeleton" aria-hidden="true">
              <i style={{ width: `${w}%` }} />
              <i style={{ width: '95%' }} />
            </div>
          ))}
        </div>
      )}

      {load.state === 'failed' && (
        // No directory link here: its name and address live in the file that did not load.
        <div className="club-empty" aria-live="polite">
          <p>The club list did not load.</p>
          <p className="club-actions">
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </p>
        </div>
      )}

      {load.state === 'ready' && result && (
        <>
          <Message result={result} data={load.data} careerText={who?.careerText ?? ''} onEditGoals={onEditGoals} onOpenAlma={onOpenAlma} botName={botName} />
          <Groups result={result} data={load.data} more={more} />
          {picks.length > RAIL_VISIBLE && (
            <button type="button" className="club-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? 'Show fewer' : `Show ${picks.length - RAIL_VISIBLE} more`}
            </button>
          )}
          {result.communities.length > 0 && (
            <details className="club-communities">
              <summary>Communities in these fields ({result.communities.length})</summary>
              <ul className="club-list">
                {result.communities.map((pick) => (
                  <Row key={pick.club.id} pick={pick} data={load.data} />
                ))}
              </ul>
            </details>
          )}
          <Footer data={load.data} today={today} onEditGoals={result.empty ? undefined : onEditGoals} />
        </>
      )}
    </details>
  );
}

/** The card's words above the list when there is no goal to show clubs for, or none was heard. */
function Message({
  result,
  data,
  careerText,
  onEditGoals,
  onOpenAlma,
  botName,
}: {
  result: ClubResult;
  data: IllinoisClubsFile;
  careerText: string;
  onEditGoals: () => void;
  onOpenAlma?: () => void;
  botName: string;
}) {
  if (result.empty === 'no-words') {
    return (
      <div className="club-empty">
        <p>Say what you want to do after you graduate, and clubs for it show up here.</p>
        <p className="club-actions">
          <button type="button" onClick={onEditGoals}>
            Add my goals
          </button>
          <BrowseAll data={data} />
        </p>
      </div>
    );
  }
  if (result.empty === 'unheard') {
    const words = careerText.length > 60 ? `${careerText.slice(0, 57).trimEnd()}...` : careerText;
    return (
      <div className="club-empty">
        <p>
          Nothing in &ldquo;{words}&rdquo; matched a goal the planner knows yet. Words like{' '}
          {`${EXAMPLE_GOALS.slice(0, -1).map((w) => `“${w}”`).join(', ')} or “${EXAMPLE_GOALS[EXAMPLE_GOALS.length - 1]}”`} work.
        </p>
        <p className="club-actions">
          <button type="button" onClick={onEditGoals}>
            Change my goals
          </button>
          {onOpenAlma && (
            <button type="button" onClick={onOpenAlma}>
              Ask {botName}
            </button>
          )}
          <BrowseAll data={data} />
        </p>
      </div>
    );
  }
  return null;
}

interface Group {
  key: string;
  heading: string;
  picks: ClubPick[];
  /** "Only 2 clubs in OneIllinois matched pre-optometry." under a thin goal. */
  thin?: { text: string; link: string; href: string };
}

/**
 * The picks the rail shows, under one heading per goal in the order the
 * student named them, then "For your major" and the starters. The first
 * RAIL_VISIBLE picks show (in the rotation's order, so every goal gets its
 * turn); "Show more" reaches the rest. A thin goal keeps its heading and says
 * how many matched, even when none of its clubs is in the visible rows.
 */
function groupsOf(result: ClubResult, data: IllinoisClubsFile, more: boolean): Group[] {
  const shown = result.picks.slice(0, more ? MOST : RAIL_VISIBLE);
  const out: Group[] = result.goals.map((g) => ({
    key: g.id,
    heading: `For ${g.label}`,
    picks: shown.filter((p) => p.goal === g.id),
    ...(result.thin.includes(g.id) ? { thin: thinNote(data, g.label, result.matched[g.id] ?? 0) } : {}),
  }));
  const tail: Array<[string, string]> = [
    ['major', 'For your major'],
    ['words', 'From what you wrote'],
    ['starter', 'Good first clubs'],
  ];
  for (const [key, heading] of tail) out.push({ key, heading, picks: shown.filter((p) => p.goal === key) });
  return out.filter((g) => g.picks.length > 0 || g.thin);
}

function Groups({ result, data, more }: { result: ClubResult; data: IllinoisClubsFile; more: boolean }) {
  const groups = groupsOf(result, data, more);
  if (groups.length === 0) return null;
  return (
    <div className="club-groups">
      {groups.map((group) => (
        <section key={group.key} className="club-group" aria-label={group.heading}>
          <h4 className="club-group-head">{group.heading}</h4>
          {group.picks.length > 0 && (
            <ul className="club-list">
              {group.picks.map((pick) => (
                <Row key={pick.club.id} pick={pick} data={data} />
              ))}
            </ul>
          )}
          {group.thin && (
            <p className="club-thin">
              {group.thin.text}{' '}
              <a href={group.thin.href} target="_blank" rel="noreferrer">
                {group.thin.link}
                <span className="sr-only"> (opens {data.source.name})</span>
              </a>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/** One club: its name and page, why, and the kind, event and first caution in one muted line. */
function Row({ pick, data }: { pick: ClubPick; data: IllinoisClubsFile }) {
  const { club } = pick;
  const own = club.url === club.profile ? `its ${data.source.name} page` : 'its website';
  const meta = [KIND_LABEL[club.kind], pick.event, pick.cautions[0]].filter(Boolean).join(' · ');
  return (
    <li className="club-row">
      <a className="club-name" href={club.url} target="_blank" rel="noreferrer">
        {club.name}
        <ExternalLink aria-hidden="true" />
        <span className="sr-only"> (opens {own})</span>
      </a>
      <span className="club-why">{pick.why}</span>
      {meta && <span className="club-meta">{meta}</span>}
    </li>
  );
}

function BrowseAll({ data }: { data: IllinoisClubsFile }) {
  return (
    <a href={data.source.url} target="_blank" rel="noreferrer">
      Browse every club <ExternalLink aria-hidden="true" />
    </a>
  );
}

/** Where the list came from and how old it is. Always under a loaded list; amber after 120 days. */
function Footer({ data, today, onEditGoals }: { data: IllinoisClubsFile; today?: Date | string; onEditGoals?: () => void }) {
  const fresh = freshness(data, today ?? new Date());
  const days = `${fresh.days} ${plural(fresh.days, 'day')}`;
  return (
    <div className={cn('club-source', fresh.stale && 'is-stale')}>
      <p>
        {fresh.stale
          ? `This list is from ${fresh.label} (${days} ago) and may be out of date. `
          : `From ${data.source.name}, the university's club directory, checked ${fresh.label}. `}
        Clubs change every year; each club&apos;s page has the latest.
      </p>
      <p className="club-actions">
        {onEditGoals && (
          <button type="button" onClick={onEditGoals}>
            Change my goals
          </button>
        )}
        <BrowseAll data={data} />
      </p>
    </div>
  );
}
