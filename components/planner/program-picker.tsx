'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import {
  buildProgramMenu,
  choiceLabel,
  locateProgram,
  menuParentIds,
  pairedThreads,
  resolveThreads,
  type MenuDegree,
  type ProgramMenu,
} from '@/lib/planner/gatech-programs';
import type { IllinoisProgramSummary } from '@/lib/planner/illinois-load';
import { courseleafOf } from '@/lib/planner/school-config';
import { openProgram } from './illinois-source';

export interface ProgramOption {
  id: string;
  name: string;
  /** Catalog degree code, used for editable program-length defaults. */
  degree?: string;
  /** Published degree total, when the catalog exposes one. */
  totalCredits?: number | null;
  /** Credits this program is likely to add beyond a primary degree's shared core. */
  additionalCredits?: number | null;
}

interface ProgramPickerProps {
  options: ProgramOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
  kindLabel?: string;
}

/** Searchable multi-select used both before planning and in the profile rail. */
export function ProgramPicker({
  options,
  selectedIds,
  onChange,
  loading = false,
  emptyMessage = 'No degree programs loaded for this university.',
  compact = false,
  kindLabel = 'major',
}: ProgramPickerProps) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const normalized = query.trim().toLowerCase();
  const showAvailable = normalized.length > 0 || selectedIds.length === 0;
  const available = useMemo(
    () =>
      options
        .filter((option) => !selected.has(option.id))
        .filter((option) => !normalized || option.name.toLowerCase().includes(normalized))
        .slice(0, compact ? 8 : 14),
    [compact, normalized, options, selected],
  );

  const add = (id: string) => {
    onChange([...selectedIds, id]);
    setQuery('');
  };
  const remove = (id: string) => onChange(selectedIds.filter((selectedId) => selectedId !== id));

  return (
    <div className={`program-picker${compact ? ' is-compact' : ''}`}>
      <div className="program-selected" aria-live="polite">
        {selectedIds.length === 0 ? (
          <p>No {kindLabel} selected yet.</p>
        ) : (
          selectedIds.map((id, index) => (
            <div className="program-selected-row" key={id}>
              <span>
                <small>
                  {kindLabel === 'major'
                    ? index === 0 ? 'Primary' : `Major ${index + 1}`
                    : `${kindLabel} ${index + 1}`}
                </small>
                <strong>{byId.get(id)?.name ?? id}</strong>
              </span>
              <button type="button" onClick={() => remove(id)} aria-label={`Remove ${byId.get(id)?.name ?? id}`}>
                <X aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>

      <label className="program-search">
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={selectedIds.length === 0 ? `Search for a ${kindLabel}` : `Add another ${kindLabel}`}
          aria-label={selectedIds.length === 0 ? `Search for a ${kindLabel}` : `Add another ${kindLabel}`}
        />
      </label>

      {showAvailable && <div className="program-results" aria-label="Degree programs">
        {loading ? (
          <p>Loading {kindLabel}s...</p>
        ) : options.length === 0 ? (
          <p>{emptyMessage}</p>
        ) : available.length === 0 ? (
          <p>{normalized ? `No ${kindLabel} matches that search.` : `All available ${kindLabel}s are selected.`}</p>
        ) : (
          available.map((option) => (
            <button type="button" key={option.id} onClick={() => add(option.id)}>
              <span>{option.name}</span>
              <Plus aria-hidden="true" />
            </button>
          ))
        )}
      </div>}
    </div>
  );
}

interface ProgramMenuPickerProps {
  /** The school's degree menu (lib/planner/gatech-programs.ts); null while it loads. */
  menu: ProgramMenu | null;
  /** Rows outside the menu, offered as they are ("Undecided / exploring programs"), and names for ids the menu lacks. */
  options: ProgramOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
  kindLabel?: string;
}

/**
 * The picker for a school whose degrees are menus (Georgia Tech): the
 * student searches the 42 degrees, then picks a concentration or option, or
 * two threads, and the picker stores the one program record that choice
 * resolves to (the id public/gatech/program/<id>.json is written under).
 * Same look as ProgramPicker; the choice step reuses the emphasis card.
 */
export function ProgramMenuPicker({
  menu,
  options,
  selectedIds,
  onChange,
  loading = false,
  emptyMessage = 'No degree programs loaded for this university.',
  compact = false,
  kindLabel = 'major',
}: ProgramMenuPickerProps) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [firstThread, setFirstThread] = useState<string | null>(null);
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const covered = useMemo(
    () => new Set((menu?.degrees ?? []).flatMap((degree) => degree.choices.map((choice) => choice.id))),
    [menu],
  );
  const normalized = query.trim().toLowerCase();
  const showAvailable = normalized.length > 0 || selectedIds.length === 0;

  // Degrees with a record already chosen are not offered again: one Computer Science, one pair of threads.
  const takenDegrees = useMemo(
    () => new Set(selectedIds.flatMap((id) => (menu ? [locateProgram(menu, id)?.degree.id ?? ''] : [])).filter(Boolean)),
    [menu, selectedIds],
  );
  const entries = useMemo(() => {
    const loose = options
      .filter((option) => !covered.has(option.id) && !selectedIds.includes(option.id))
      .map((option) => ({ key: option.id, name: option.name, option, degree: null as MenuDegree | null, text: option.name.toLowerCase() }));
    const degrees = (menu?.degrees ?? [])
      .filter((degree) => !takenDegrees.has(degree.id))
      .map((degree) => ({
        key: degree.id,
        name: degree.name,
        option: null as ProgramOption | null,
        degree,
        // A search for "robotics" finds every degree with a Robotics concentration or thread.
        text: [degree.name, ...degree.choices.map((choice) => choice.name), ...degree.threads.map((thread) => thread.name)]
          .join(' | ')
          .toLowerCase(),
      }));
    return [...loose, ...degrees]
      .filter((entry) => !normalized || entry.text.includes(normalized))
      .slice(0, compact ? 12 : 60);
  }, [compact, covered, menu, normalized, options, selectedIds, takenDegrees]);
  const open = menu?.degrees.find((degree) => degree.id === openId) ?? null;

  const close = () => {
    setOpenId(null);
    setFirstThread(null);
  };
  const add = (id: string) => {
    onChange([...selectedIds, id]);
    setQuery('');
    close();
  };
  const remove = (id: string) => onChange(selectedIds.filter((selectedId) => selectedId !== id));
  const labelOf = (id: string) => {
    const hit = menu ? locateProgram(menu, id) : null;
    return hit ? choiceLabel(hit.degree, hit.choice) : byId.get(id)?.name ?? id;
  };
  const choose = (degree: MenuDegree) => {
    if (degree.kind === 'single') {
      add(degree.choices[0].id);
      return;
    }
    setOpenId(degree.id);
    setFirstThread(null);
    setQuery('');
  };
  const paired = open && firstThread ? new Set(pairedThreads(open, firstThread)) : null;

  return (
    <div className={`program-picker program-menu-picker${compact ? ' is-compact' : ''}`}>
      <div className="program-selected" aria-live="polite">
        {selectedIds.length === 0 ? (
          <p>No {kindLabel} selected yet.</p>
        ) : (
          selectedIds.map((id, index) => (
            <div className="program-selected-row" key={id}>
              <span>
                <small>
                  {kindLabel === 'major'
                    ? index === 0 ? 'Primary' : `Major ${index + 1}`
                    : `${kindLabel} ${index + 1}`}
                </small>
                <strong>{labelOf(id)}</strong>
              </span>
              <button type="button" onClick={() => remove(id)} aria-label={`Remove ${labelOf(id)}`}>
                <X aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>

      <label className="program-search">
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            close();
          }}
          placeholder={selectedIds.length === 0 ? `Search for a ${kindLabel}` : `Add another ${kindLabel}`}
          aria-label={selectedIds.length === 0 ? `Search for a ${kindLabel}` : `Add another ${kindLabel}`}
        />
      </label>

      {open ? (
        <div className={`emphasis-picker program-choice${compact ? ' is-compact' : ''}`}>
          <fieldset className="emphasis-group">
            <legend>{open.name}</legend>
            <div className="emphasis-heading">
              <strong>{open.kind === 'two-threads' ? 'Pick two threads' : `Choose ${open.pickLabel}`}</strong>
              <span>
                {open.kind === 'two-threads' ? 'Required: choose 2' : open.optional ? 'Optional: choose one' : 'Required: choose 1'}
              </span>
            </div>
            {open.hint && <p>{open.hint}</p>}
            <div className="emphasis-options">
              {open.kind === 'two-threads'
                ? open.threads.map((thread) => {
                    const checked = firstThread === thread.name;
                    const disabled = paired !== null && !checked && !paired.has(thread.name);
                    return (
                      <label key={thread.name}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => {
                            if (checked) setFirstThread(null);
                            else if (!firstThread) setFirstThread(thread.name);
                            else {
                              const page = resolveThreads(open, firstThread, thread.name);
                              if (page) add(page.id);
                            }
                          }}
                        />
                        <span>{thread.name}</span>
                      </label>
                    );
                  })
                : open.choices.map((choice) => (
                    // A checkbox, as in EmphasisPicker: a radio group would add whichever choice an arrow key lands on.
                    <label key={choice.id}>
                      <input type="checkbox" checked={false} onChange={() => add(choice.id)} />
                      <span>{choice.name}</span>
                    </label>
                  ))}
            </div>
            {open.kind === 'two-threads' && (
              <small className="needs-choice">{firstThread ? `${firstThread} chosen. Pick its pair.` : '0 of 2 chosen'}</small>
            )}
            <button type="button" className="program-choice-cancel" onClick={close}>
              Back to the list
            </button>
          </fieldset>
        </div>
      ) : (
        showAvailable && (
          <div className="program-results" aria-label="Degree programs">
            {loading || menu === null ? (
              <p>Loading {kindLabel}s...</p>
            ) : entries.length === 0 && covered.size === 0 && options.length === 0 ? (
              <p>{emptyMessage}</p>
            ) : entries.length === 0 ? (
              <p>{normalized ? `No ${kindLabel} matches that search.` : `All available ${kindLabel}s are selected.`}</p>
            ) : (
              entries.map((entry) => (
                <button
                  type="button"
                  key={entry.key}
                  onClick={() => (entry.degree ? choose(entry.degree) : add(entry.key))}
                  aria-label={
                    entry.degree && entry.degree.kind !== 'single'
                      ? `${entry.name}: choose ${entry.degree.pickLabel}`
                      : undefined
                  }
                >
                  <span>{entry.name}</span>
                  {entry.degree && entry.degree.kind !== 'single' ? <ChevronRight aria-hidden="true" /> : <Plus aria-hidden="true" />}
                </button>
              ))
            )}
          </div>
        )
      )}
    </div>
  );
}

/** Whether a school's degrees are menus that ProgramMenuPicker resolves to one page (Georgia Tech). */
export function hasProgramMenu(schoolId: string | null | undefined): boolean {
  return schoolId === 'gatech';
}

/**
 * A menu school's degree menu from the build's own files: `summaries` is its
 * programs.json, and each menu parent's program/<id>.json supplies the option
 * names and the threads. A parent that does not load is still offered, as a
 * plain list of its pages.
 */
export async function loadProgramMenu(base: string, summaries: IllinoisProgramSummary[]): Promise<ProgramMenu> {
  const plannable = summaries.filter((program) => openProgram(program));
  const parents = await Promise.all(
    menuParentIds(plannable).map((id) =>
      fetch(`${base}/program/${id}.json`)
        .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
        .catch(() => null),
    ),
  );
  return buildProgramMenu({ summaries, plannable, parents });
}

/**
 * The menu for a picker outside onboarding (the profile rail, the planner's
 * "Choose your degree program" screen): null while it loads and for a school
 * without one. Pass it to ProgramMenuPicker with the same options list.
 */
export function useProgramMenu(schoolId: string | null | undefined): ProgramMenu | null {
  const [loaded, setLoaded] = useState<{ school: string; menu: ProgramMenu } | null>(null);
  useEffect(() => {
    const leaf = courseleafOf(schoolId);
    if (!leaf || !hasProgramMenu(leaf.id)) return;
    let cancelled = false;
    void fetch(`${leaf.base}/programs.json`)
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then((raw) => loadProgramMenu(leaf.base, Array.isArray(raw) ? (raw as IllinoisProgramSummary[]) : []))
      .then((menu) => {
        if (!cancelled) setLoaded({ school: leaf.id, menu });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ school: leaf.id, menu: { degrees: [] } });
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);
  return loaded && loaded.school === schoolId ? loaded.menu : null;
}
