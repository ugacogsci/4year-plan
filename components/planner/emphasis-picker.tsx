'use client';

import type { UgaSelectionRequirement } from './uga-source';

export function EmphasisPicker({
  requirements,
  selections,
  onChange,
  compact = false,
}: {
  requirements: UgaSelectionRequirement[];
  selections: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  compact?: boolean;
}) {
  if (requirements.length === 0) return null;

  return (
    <div className={`emphasis-picker${compact ? ' is-compact' : ''}`}>
      {requirements.map((requirement) => {
        const selected = selections[requirement.id] ?? [];
        const full = selected.length >= requirement.maximum;
        return (
          <fieldset key={requirement.id} className="emphasis-group">
            <legend>{requirement.programName}</legend>
            <div className="emphasis-heading">
              <strong>{requirement.label}</strong>
              <span>
                {requirement.required
                  ? `Required: choose ${requirement.minimum}`
                  : requirement.maximum > 1 ? 'Optional: choose any' : 'Optional: choose one'}
              </span>
            </div>
            <p>{requirement.note}</p>
            <div className="emphasis-options">
              {requirement.options.map((option) => {
                const checked = selected.includes(option.id);
                return (
                  <label key={option.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => {
                        const values = checked
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id];
                        onChange({ ...selections, [requirement.id]: values });
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            <small className={requirement.required && selected.length !== requirement.minimum ? 'needs-choice' : ''}>
              {selected.length} selected
              {requirement.required ? ` of ${requirement.minimum} required` : ''}
            </small>
          </fieldset>
        );
      })}
    </div>
  );
}

export function emphasisSelectionsComplete(
  requirements: UgaSelectionRequirement[],
  selections: Record<string, string[]>,
): boolean {
  return requirements.every((requirement) => {
    const count = selections[requirement.id]?.length ?? 0;
    return count >= requirement.minimum && count <= requirement.maximum;
  });
}
