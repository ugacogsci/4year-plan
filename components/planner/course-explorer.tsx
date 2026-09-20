'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { clusterColor } from './cluster-color';
import { CourseDetail } from './course-detail';
import type { IllinoisCore } from '@/lib/planner/illinois-load';
import type { Course, MapPosition, PlanTerm } from '@/lib/planner/types';

interface CourseExplorerProps {
  /** The bounded set the map paints, chosen by the workspace. */
  courses: Course[];
  /** Everything in the catalog, so the count can say what it is showing. */
  catalogSize: number;
  core: IllinoisCore | null;
  terms: PlanTerm[];
  plannedCourseIds: Set<string>;
  completedCodes: Set<string>;
  selectedCourseId: string | null;
  targetTermId: string;
  searchQuery: string;
  open: boolean;
  /** False below 1100px, where the finder overlays the board and a drag has nowhere to land. */
  dragUsable: boolean;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (query: string) => void;
  onTargetTermChange: (termId: string) => void;
  onSelectCourse: (courseId: string) => void;
  onAddCourse: (courseId: string, termId: string) => void;
}

export function CourseExplorer({
  courses,
  catalogSize,
  core,
  terms,
  plannedCourseIds,
  completedCodes,
  selectedCourseId,
  targetTermId,
  searchQuery,
  open,
  dragUsable,
  onOpenChange,
  onSearchChange,
  onTargetTermChange,
  onSelectCourse,
  onAddCourse,
}: CourseExplorerProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [deptQuery, setDeptQuery] = useState('');

  /** Departments present in the painted set, most courses first. */
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of courses) counts.set(c.cluster, (counts.get(c.cluster) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [courses]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const positions = useMemo(
    () =>
      new Map(
        courses.map((course, index) => [
          course.id,
          course.mapPosition ?? fallbackPosition(course.id, index),
        ]),
      ),
    [courses],
  );

  const visible = courses.filter((course) => !hidden.has(course.cluster));
  const matching = new Set(
    normalizedQuery
      ? visible.filter((c) => searchText(c).includes(normalizedQuery)).map((c) => c.id)
      : visible.map((c) => c.id),
  );

  const selected = courses.find((c) => c.id === selectedCourseId) ?? null;
  const targetLabel =
    targetTermId === 'completed'
      ? 'Prior coursework'
      : (terms.find((t) => t.id === targetTermId)?.label ?? 'a term');

  const deptMatches = departments.filter(([name]) =>
    name.toLowerCase().includes(deptQuery.trim().toLowerCase()),
  );
  const activeFilters = departments.filter(([name]) => hidden.has(name)).map(([name]) => name);

  function toggleDepartment(name: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!open) {
    return (
      <aside className="course-finder" aria-label="Course finder">
        <button type="button" className="finder-rail" onClick={() => onOpenChange(true)}>
          <Search aria-hidden="true" />
          <span>Find a course</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="course-finder" aria-labelledby="finder-title">
      <header className="finder-head">
        <h2 id="finder-title">Find a course</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close the course finder"
          title="Close the course finder"
          onClick={() => onOpenChange(false)}
        >
          <ChevronRight />
        </Button>
      </header>

      <div className="finder-search">
        <input
          aria-label="Search courses"
          value={searchQuery}
          placeholder="Search a code or a title"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="finder-filters">
        {/* One trigger instead of one button per department. The old legend
            rendered 194 buttons in a 224px window with 5,400px of scroll. */}
        <Popover>
          <PopoverTrigger
            render={
              <button type="button" className="dept-chip">
                {/* "on the map", because the map paints 240 of 6,110 courses and
                    a bare "Departments (9)" reads as Illinois having nine. */}
                {departments.length} departments on the map
              </button>
            }
          />
          <PopoverContent align="start" className="w-64 gap-2">
            <input
              className="finder-dept-search"
              aria-label="Filter departments"
              placeholder="Filter departments"
              value={deptQuery}
              onChange={(event) => setDeptQuery(event.target.value)}
            />
            <div className="finder-dept-list">
              {deptMatches.length === 0 && <p className="quiet">No department matches that.</p>}
              {deptMatches.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={!hidden.has(name)}
                  className={cn(hidden.has(name) && 'is-muted')}
                  onClick={() => toggleDepartment(name)}
                >
                  <span className="dept-dot" style={{ backgroundColor: clusterColor(name) }} />
                  <span>{name}</span>
                  <span>{count}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {activeFilters.slice(0, 6).map((name) => (
          <button key={name} type="button" className="dept-chip" onClick={() => toggleDepartment(name)}>
            {name} hidden <X aria-hidden="true" style={{ width: 11, height: 11 }} />
          </button>
        ))}
        {activeFilters.length > 6 && (
          <span className="finder-count">+{activeFilters.length - 6} more hidden</span>
        )}
      </div>

      <div className="map-stage" aria-label="Semantic course map">
        <fieldset className="map-field" aria-label="Course nodes">
          <svg className="map-paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {courses.flatMap((course) =>
              course.prerequisites.map((prerequisiteId) => {
                const from = positions.get(prerequisiteId);
                const to = positions.get(course.id);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${prerequisiteId}-${course.id}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                  />
                );
              }),
            )}
          </svg>

          {visible.map((course) => {
            const position = positions.get(course.id)!;
            const isSelected = course.id === selectedCourseId;
            const isMatch = matching.has(course.id);
            return (
              <button
                key={course.id}
                type="button"
                draggable={dragUsable}
                title={`${course.code}: ${course.title}`}
                aria-label={`${course.code}, ${course.title}`}
                aria-pressed={isSelected}
                className={cn(
                  'map-course-node',
                  isSelected && 'is-selected',
                  plannedCourseIds.has(course.id) && 'is-planned',
                  course.pathwayRole === 'required' && 'is-required',
                  normalizedQuery && !isMatch && 'is-search-muted',
                )}
                style={
                  {
                    left: `${position.x}%`,
                    top: `${position.y}%`,
                    '--node-color': clusterColor(course.cluster),
                  } as CSSProperties
                }
                onClick={() => onSelectCourse(course.id)}
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-course-id', course.id);
                  /**
                   * copyMove, not copy. The column's dragover names 'copy' for a
                   * map node and 'move' for a board card, and naming an effect
                   * the source did not allow makes the browser cancel the drag
                   * and never fire drop. Tolerating either negotiation is what
                   * keeps this working if the column's rule ever changes.
                   */
                  event.dataTransfer.effectAllowed = 'copyMove';
                }}
              >
                <span className="map-node-core" />
                {(isSelected || (normalizedQuery && isMatch)) && (
                  <span className="map-node-label">{course.code}</span>
                )}
              </button>
            );
          })}
        </fieldset>
      </div>

      <p className="map-hint">
        {visible.length.toLocaleString()} of {catalogSize.toLocaleString()} shown.{' '}
        {dragUsable ? 'Drag a dot into a semester.' : 'Drag works on a wider screen. Use Add to here.'}
      </p>

      <div className="map-inspector" aria-live="polite">
        {selected ? (
          <>
            <CourseDetail
              course={selected}
              core={core}
              completed={completedCodes.has(selected.code.toUpperCase())}
            />
            <div className="inspector-add">
              <NativeSelect
                aria-label="Which term to add to"
                value={targetTermId}
                onChange={(event) => onTargetTermChange(event.target.value)}
              >
                <NativeSelectOption value="completed">Already taken</NativeSelectOption>
                {terms.map((term) => (
                  <NativeSelectOption key={term.id} value={term.id}>
                    {term.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                className="inspector-add-button"
                disabled={plannedCourseIds.has(selected.id)}
                onClick={() => onAddCourse(selected.id, targetTermId)}
              >
                {plannedCourseIds.has(selected.id) ? (
                  <>
                    <Check /> In the plan
                  </>
                ) : (
                  <>
                    <Plus /> Add to {targetLabel}
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            <h3>Pick a course</h3>
            <p>{dragUsable ? 'Drag it into a semester, or use Add to.' : 'Then use Add to.'}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function searchText(course: Course) {
  return `${course.code} ${course.title} ${course.cluster}`.toLowerCase();
}

/** Only for a course with no crawled position. Illinois has none of these today. */
function fallbackPosition(id: string, index: number): MapPosition {
  const hash = Array.from(id).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 10_007,
    index + 17,
  );
  return { x: 6 + (hash % 88), y: 7 + ((hash * 47 + index * 13) % 84) };
}
