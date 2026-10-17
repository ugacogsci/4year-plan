'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  loadUgaPlanningGuidance,
  pathwaysFor,
  type UgaPlanningGuidance,
} from '@/lib/planner/uga-planning-guidance';

export function DoubleDawgsPicker({
  programIds,
  selectedId,
  onChange,
}: {
  programIds: string[];
  selectedId?: string | null;
  onChange: (id: string | null) => void;
}) {
  const [guidance, setGuidance] = useState<UgaPlanningGuidance | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let cancelled = false;
    void loadUgaPlanningGuidance().then((data) => {
      if (!cancelled) {
        setGuidance(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const pathways = pathwaysFor(guidance, programIds);
  const selected = pathways.find((pathway) => pathway.id === selectedId);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = pathways.filter((pathway) =>
    words.every((word) => pathway.name.toLowerCase().includes(word)),
  );
  return (
    <details className="double-dawgs" open={Boolean(selectedId) || undefined}>
      <summary>
        {selected ? 'Double Dawgs pathway' : 'Considering Double Dawgs?'}
      </summary>
      {loading ? (
        <output>Reading UGA pathways...</output>
      ) : !guidance ? (
        <p>
          Pathways could not be loaded.{' '}
          <a
            href="https://doubledawgs.uga.edu/ProgramList"
            target="_blank"
            rel="noreferrer"
          >
            Browse UGA&apos;s directory
          </a>
          .
        </p>
      ) : pathways.length === 0 ? (
        <p>
          No published pathway is linked to your selected major in this
          snapshot.{' '}
          <a
            href="https://doubledawgs.uga.edu/ProgramList"
            target="_blank"
            rel="noreferrer"
          >
            Check UGA&apos;s directory
          </a>{' '}
          for other options.
        </p>
      ) : (
        <>
          <label className="guidance-search">
            <span>Graduate pathway</span>
            <input
              type="search"
              aria-label="Search Double Dawgs pathways"
              placeholder="Search pathways"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div
            className="double-dawgs-options"
            role="radiogroup"
            aria-label="Double Dawgs pathway"
          >
            <label>
              <input
                type="radio"
                name="double-dawgs"
                checked={!selected}
                onChange={() => onChange(null)}
              />
              <span>No pathway selected</span>
            </label>
            {matches.map((pathway) => (
              <label key={pathway.id}>
                <input
                  type="radio"
                  name="double-dawgs"
                  checked={selected?.id === pathway.id}
                  onChange={() => onChange(pathway.id)}
                />
                <span>{pathway.name}</span>
              </label>
            ))}
            {matches.length === 0 && <p>No matching pathways.</p>}
          </div>
          {selected && (
            <div className="double-dawgs-summary">
              <p>
                <strong>{selected.name}</strong>
              </p>
              <p>
                This schedule covers your bachelor&apos;s degree. The graduate
                stage is not yet generated or audited as a combined plan.
              </p>
              <p>
                Up to 12 approved graduate credits may count toward both
                degrees. Shared-credit substitutions need your pathway
                advisor&apos;s approval; ORION does not deduct them
                automatically. Graduate admission is a separate application.
              </p>
              <a href={selected.url} target="_blank" rel="noreferrer">
                Pathway requirements and advisor{' '}
                <ExternalLink aria-hidden="true" />
              </a>
              <a
                href="https://doubledawgs.uga.edu/faq.html"
                target="_blank"
                rel="noreferrer"
              >
                UGA&apos;s Double Dawgs guidance{' '}
                <ExternalLink aria-hidden="true" />
              </a>
            </div>
          )}
        </>
      )}
    </details>
  );
}
