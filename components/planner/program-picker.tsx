'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';

export interface ProgramOption {
  id: string;
  name: string;
}

interface ProgramPickerProps {
  options: ProgramOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
}

/** Searchable multi-select used both before planning and in the profile rail. */
export function ProgramPicker({
  options,
  selectedIds,
  onChange,
  loading = false,
  emptyMessage = 'No degree programs loaded for this university.',
  compact = false,
}: ProgramPickerProps) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const normalized = query.trim().toLowerCase();
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
          <p>No major selected yet.</p>
        ) : (
          selectedIds.map((id, index) => (
            <div className="program-selected-row" key={id}>
              <span>
                <small>{index === 0 ? 'Primary' : `Major ${index + 1}`}</small>
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
          placeholder={selectedIds.length === 0 ? 'Search for your major' : 'Add another major'}
          aria-label={selectedIds.length === 0 ? 'Search for your major' : 'Add another major'}
        />
      </label>

      <div className="program-results" aria-label="Degree programs">
        {loading ? (
          <p>Loading degree programs...</p>
        ) : options.length === 0 ? (
          <p>{emptyMessage}</p>
        ) : available.length === 0 ? (
          <p>{normalized ? 'No major matches that search.' : 'All available majors are selected.'}</p>
        ) : (
          available.map((option) => (
            <button type="button" key={option.id} onClick={() => add(option.id)}>
              <span>{option.name}</span>
              <Plus aria-hidden="true" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
