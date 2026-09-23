'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronRight, Maximize2, Minus, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { clusterColor } from './cluster-color';
import { CourseDetail } from './course-detail';
import { subjectMatches } from '@/lib/planner/illinois-subjects';
import type { IllinoisCore } from '@/lib/planner/illinois-load';
import type { SchoolId } from '@/lib/planner/onboarding';
import type { Course, MapPosition, PlanTerm } from '@/lib/planner/types';

interface CourseExplorerProps {
  /** The bounded set the map paints, chosen by the workspace. */
  courses: Course[];
  /** Everything in the catalog, so the count can say what it is showing. */
  catalogSize: number;
  core: IllinoisCore | null;
  schoolId: SchoolId | null;
  terms: PlanTerm[];
  plannedCourseIds: Set<string>;
  completedCodes: Set<string>;
  selectedCourseId: string | null;
  targetTermId: string;
  searchQuery: string;
  /** How many courses in the WHOLE catalog match the query, not just the ones
   *  drawn. Null when there is no query. The map draws at most 240 dots, so
   *  "nothing matched" and "your match did not make the cut" look identical
   *  on screen and need to be said apart. */
  searchHits: number | null;
  /** The matches as a list, catalog-wide, best first. Empty without a query. */
  results: Course[];
  /**
   * An elective slot being chosen for. The list shows what could go in it,
   * and every add button puts the course in that slot instead of a term.
   */
  chooser?: {
    termLabel: string;
    replacing: string;
    options: Course[];
    onPick: (courseId: string) => void;
    onCancel: () => void;
    /** Why each option is offered, by course id, in the student's own priorities. */
    whys?: Map<string, string>;
  } | null;
  open: boolean;
  /** False below 1100px, where the finder overlays the board and a drag has nowhere to land. */
  dragUsable: boolean;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (query: string) => void;
  onTargetTermChange: (termId: string) => void;
  onSelectCourse: (courseId: string) => void;
  onAddCourse: (courseId: string, termId: string) => void;
}

/**
 * Where the map is looking: a scale and an offset in stage pixels, applied to
 * one layer that holds every dot. Scale 1 with no offset is the whole map.
 */
interface View {
  k: number;
  x: number;
  y: number;
}

const HOME: View = { k: 1, x: 0, y: 0 };
const MAX_ZOOM = 14;
/** Past this every dot shows its code, because there is room for it to. */
const LABEL_ZOOM = 3.5;

export function CourseExplorer({
  courses,
  catalogSize,
  core,
  schoolId,
  terms,
  plannedCourseIds,
  completedCodes,
  selectedCourseId,
  targetTermId,
  searchQuery,
  searchHits,
  results,
  chooser = null,
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
  const [view, setView] = useState<View>(HOME);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pan = useRef<{ pointerId: number; startX: number; startY: number; from: View } | null>(null);

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

  const visible = useMemo(() => courses.filter((course) => !hidden.has(course.cluster)), [courses, hidden]);
  const matching = useMemo(
    () =>
      new Set(
        normalizedQuery
          ? visible.filter((c) => courseMatches(c, normalizedQuery)).map((c) => c.id)
          : visible.map((c) => c.id),
      ),
    [visible, normalizedQuery],
  );

  /**
   * A search moves the map to its matches.
   *
   * Forty accountancy courses sit in one cluster the size of a thumbnail, and
   * lighting them up at full zoom-out showed a bright smudge with two labels
   * on top of each other. The stage now frames the matches so the dots have
   * room and every one carries its code. Clearing the search goes home.
   */
  useEffect(() => {
    if (!normalizedQuery) {
      // oxlint-disable-next-line react/react-compiler
      setView(HOME);
      return;
    }
    const stage = stageRef.current;
    if (!stage || matching.size === 0) return;
    const { width, height } = stage.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    /**
     * Frame the dense middle of the matches, not their full extent.
     *
     * Twenty accountancy courses sit mostly in one cluster with a few spread
     * across the map, and a frame around all twenty is the whole map at scale
     * 1, which is the smudge this exists to fix. With eight or more matches the
     * frame is the middle half of them on each axis, which is where the
     * cluster is; the rest stay lit and in the list, and a drag brings them in.
     */
    const xs: number[] = [];
    const ys: number[] = [];
    for (const id of matching) {
      const p = positions.get(id);
      if (!p) continue;
      xs.push(p.x);
      ys.push(p.y);
    }
    if (xs.length === 0) return;
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const trim = xs.length >= 8;
    const low = (arr: number[]) => (trim ? arr[Math.floor((arr.length - 1) * 0.25)] : arr[0]);
    const high = (arr: number[]) => (trim ? arr[Math.ceil((arr.length - 1) * 0.75)] : arr[arr.length - 1]);
    const minX = low(xs), maxX = high(xs), minY = low(ys), maxY = high(ys);
    // In stage pixels, with a margin so labels are not cut at the edge.
    const bw = Math.max(((maxX - minX) / 100) * width, 1);
    const bh = Math.max(((maxY - minY) / 100) * height, 1);
    // Room for the labels, scaled to the stage so a narrow finder still zooms.
    const pad = clamp(Math.min(width, height) * 0.14, 32, 80);
    const k = clamp(Math.min((width - pad) / bw, (height - pad) / bh), 1, MAX_ZOOM / 2);
    const cx = ((minX + maxX) / 200) * width;
    const cy = ((minY + maxY) / 200) * height;
    /**
     * Set from an effect on purpose. The frame depends on the stage's pixel
     * size, which only the DOM knows after the matches have rendered, so this
     * is a measurement being written back rather than derived state. It runs
     * once per change of matches, which is one extra render per keystroke.
     */
    // oxlint-disable-next-line react/react-compiler
    setView(clampView({ k, x: width / 2 - cx * k, y: height / 2 - cy * k }, width, height));
    // `matching` is memoised on the painted set and the query, so this runs
    // when the matches change and not on every render.
  }, [matching, normalizedQuery, positions]);

  /**
   * Wheel zoom, around the cursor. A native listener because React registers
   * wheel as passive, and a passive handler cannot stop the finder scrolling.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !open) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
      setView((v) => zoomAt(v, factor, px, py, rect.width, rect.height));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [open]);

  function zoomBy(factor: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const { width, height } = stage.getBoundingClientRect();
    setView((v) => zoomAt(v, factor, width / 2, height / 2, width, height));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // A dot is dragged into a semester; only the space between dots pans.
    if ((event.target as HTMLElement).closest('.map-course-node')) return;
    if (view.k === 1) return;
    pan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: view };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const p = pan.current;
    const stage = stageRef.current;
    if (!p || !stage || p.pointerId !== event.pointerId) return;
    const { width, height } = stage.getBoundingClientRect();
    setView(clampView({ k: p.from.k, x: p.from.x + event.clientX - p.startX, y: p.from.y + event.clientY - p.startY }, width, height));
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId === event.pointerId) pan.current = null;
  }

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

  const zoomed = view.k > 1.01;
  // In chooser mode the list is the slot's options until the student searches,
  // and adding anything puts it in the slot.
  const listRows = chooser && !normalizedQuery ? chooser.options : results;
  const showList = chooser ? listRows.length > 0 : Boolean(normalizedQuery) && results.length > 0;
  const add = (courseId: string) => (chooser ? chooser.onPick(courseId) : onAddCourse(courseId, targetTermId));
  const addLabel = chooser ? `into ${chooser.termLabel}` : `to ${targetLabel}`;

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

      {chooser && (
        <div className="finder-chooser">
          <p>
            Choosing an elective for <strong>{chooser.termLabel}</strong>, in place of{' '}
            <strong>{chooser.replacing}</strong>. Pick one below, or search for anything else.
          </p>
          <button type="button" onClick={chooser.onCancel}>
            Keep {chooser.replacing}
          </button>
        </div>
      )}

      <div className="finder-search">
        <input
          aria-label="Search courses"
          value={searchQuery}
          placeholder={chooser ? 'Search for something else' : 'Search a code or a title'}
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

      <div
        className={cn('map-stage', zoomed && 'is-zoomed')}
        aria-label="Semantic course map"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <fieldset className="map-field" aria-label="Course nodes">
          <div
            className="map-layer"
            style={
              {
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
                '--inv': 1 / view.k,
              } as CSSProperties
            }
          >
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
              const labelled = isSelected || (normalizedQuery ? isMatch : view.k >= LABEL_ZOOM);
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
                  {labelled && <span className="map-node-label">{course.code}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="map-zoom" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.6)}>
            <Plus aria-hidden="true" />
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.6)}>
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Show the whole map"
            title="Show the whole map"
            disabled={!zoomed}
            onClick={() => setView(HOME)}
          >
            <Maximize2 aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="map-hint">
        {searchHits === 0 ? (
          <>No course matches that. Try a code like CS 225, or part of a title.</>
        ) : (
          <>
            {visible.length.toLocaleString()} of {catalogSize.toLocaleString()} shown.{' '}
            {zoomed ? 'Scroll to zoom, drag the space between dots to move. ' : 'Scroll on the map to zoom. '}
            {dragUsable ? 'Drag a dot into a semester.' : 'Drag works on a wider screen. Use Add to here.'}
          </>
        )}
      </p>

      {showList && (
        <div className="finder-results" aria-label={chooser ? 'Courses for this slot' : 'Matching courses'}>
          <p className="finder-results-head">
            {chooser && !normalizedQuery
              ? `${listRows.length} courses you could take in ${chooser.termLabel}, best fit first`
              : searchHits === null || searchHits <= results.length
                ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
                : `First ${results.length} of ${searchHits.toLocaleString()} matches`}
          </p>
          <ul>
            {listRows.map((course) => {
              const inPlan = plannedCourseIds.has(course.id);
              const taken = completedCodes.has(course.code.toUpperCase());
              return (
                <li key={course.id} className={cn(course.id === selectedCourseId && 'is-selected')}>
                  <button type="button" className="finder-result" onClick={() => onSelectCourse(course.id)}>
                    <span className="dept-dot" style={{ backgroundColor: clusterColor(course.cluster) }} />
                    <span className="finder-result-code">{course.code}</span>
                    <span className="finder-result-title">{course.title}</span>
                    <span className="finder-result-meta">{creditLabel(course)}</span>
                    {chooser?.whys?.get(course.id) && (
                      <span className="finder-result-why">{chooser.whys.get(course.id)}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="finder-result-add"
                    disabled={inPlan || taken}
                    aria-label={inPlan ? `${course.code} is in the plan` : taken ? `${course.code} is already taken` : `Add ${course.code} ${addLabel}`}
                    title={inPlan ? 'In the plan' : taken ? 'Already taken' : `Add ${addLabel}`}
                    onClick={() => add(course.id)}
                  >
                    {inPlan || taken ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="map-inspector" aria-live="polite">
        {selected ? (
          <>
            <CourseDetail
              course={selected}
              core={core}
              schoolId={schoolId}
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
                onClick={() => add(selected.id)}
              >
                {plannedCourseIds.has(selected.id) ? (
                  <>
                    <Check /> In the plan
                  </>
                ) : (
                  <>
                    <Plus /> Add {addLabel}
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            <h3>Pick a course</h3>
            <p>
              {normalizedQuery
                ? 'Click a match in the list or on the map to read about it.'
                : dragUsable
                  ? 'Drag it into a semester, or use Add to.'
                  : 'Then use Add to.'}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

/** The same rule the workspace uses to count and list matches. */
function courseMatches(course: Course, q: string): boolean {
  return `${course.code} ${course.title}`.toLowerCase().includes(q) || subjectMatches(course.cluster, q);
}

function creditLabel(course: Course): string {
  const max = course.creditsMax ?? course.credits;
  return max > course.credits ? `${course.credits} to ${max} cr` : `${course.credits} cr`;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Keep the layer covering the stage: no blank space at any edge, ever. */
function clampView(v: View, width: number, height: number): View {
  const k = clamp(v.k, 1, MAX_ZOOM);
  return {
    k,
    x: clamp(v.x, width - width * k, 0),
    y: clamp(v.y, height - height * k, 0),
  };
}

/** Scale about a stage point, so what is under the cursor stays under it. */
function zoomAt(v: View, factor: number, px: number, py: number, width: number, height: number): View {
  const k = clamp(v.k * factor, 1, MAX_ZOOM);
  const ratio = k / v.k;
  return clampView({ k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }, width, height);
}

/** Only for a course with no crawled position. Illinois has none of these today. */
function fallbackPosition(id: string, index: number): MapPosition {
  const hash = Array.from(id).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 10_007,
    index + 17,
  );
  return { x: 6 + (hash % 88), y: 7 + ((hash * 47 + index * 13) % 84) };
}
