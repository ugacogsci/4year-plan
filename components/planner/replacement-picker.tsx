'use client';

import { useMemo, useState } from 'react';
import { LocateFixed, Search, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { clusterColor } from './cluster-color';
import type { Course } from '@/lib/planner/types';

interface ReplacementPickerProps {
  course: Course;
  active: boolean;
  label: string;
  options: Course[];
  onLoad: () => void;
  onPick: (courseId: string) => void;
  onShowCourse: (courseId: string) => void;
  onShowAll: () => void;
}

/**
 * The short path for changing a plan: a requirement-aware list on the card.
 * The full finder remains useful for inspecting choices on the map, but a
 * routine swap should not make the student leave the semester they are editing.
 */
export function ReplacementPicker({
  course,
  active,
  label,
  options,
  onLoad,
  onPick,
  onShowCourse,
  onShowAll,
}: ReplacementPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter((option) =>
          `${option.code} ${option.title} ${option.cluster}`.toLowerCase().includes(q),
        )
      : options;
    return matches.slice(0, 60);
  }, [options, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery('');
          onLoad();
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="course-replace-trigger"
            aria-label={`Replace ${course.code}`}
            title={`Replace ${course.code}`}
          />
        }
      >
        <Shuffle />
      </PopoverTrigger>
      <PopoverContent align="end" className="replacement-popover">
        <PopoverHeader>
          <PopoverTitle>Replace {course.code}</PopoverTitle>
          <PopoverDescription>
            {active ? label : 'Finding courses that fit this slot...'}
          </PopoverDescription>
        </PopoverHeader>

        <label className="replacement-search">
          <Search aria-hidden="true" />
          <input
            aria-label={`Search replacements for ${course.code}`}
            value={query}
            placeholder="Search code or title"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="replacement-list" aria-live="polite">
          {!active ? (
            <p className="replacement-empty">Checking this term and requirement...</p>
          ) : options.length === 0 ? (
            <p className="replacement-empty">
              No valid substitute is available without changing another requirement or prerequisite.
              You can still move or remove this course.
            </p>
          ) : rows.length === 0 ? (
            <p className="replacement-empty">No replacement matches that search.</p>
          ) : (
            rows.map((option) => (
              <div key={option.id} className="replacement-row">
                <button
                  type="button"
                  className="replacement-pick"
                  onClick={() => {
                    onPick(option.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className="dept-dot"
                    style={{ backgroundColor: clusterColor(option.cluster) }}
                  />
                  <span>
                    <strong>{option.code}</strong>
                    <small>{option.title}</small>
                  </span>
                  <span>{option.credits} cr</span>
                </button>
                <button
                  type="button"
                  className="replacement-locate"
                  aria-label={`Show ${option.code} on the course map`}
                  title={`Show ${option.code} on the course map`}
                  onClick={() => {
                    onShowCourse(option.id);
                    setOpen(false);
                  }}
                >
                  <LocateFixed aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </div>

        {active && options.length > 0 && (
          <button
            type="button"
            className="replacement-show-all"
            onClick={() => {
              onShowAll();
              setOpen(false);
            }}
          >
            <LocateFixed aria-hidden="true" />
            Show all {options.length.toLocaleString()} choices on the map
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
