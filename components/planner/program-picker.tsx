'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';

export interface ProgramOption {
  id: string;
  name: string;
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
