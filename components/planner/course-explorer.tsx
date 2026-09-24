'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronRight, Maximize2, Minus, Plus, Search, Trash2, X } from 'lucide-react';
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
  /** The whole catalog. The canvas paints every course; only active nodes use DOM controls. */
  courses: Course[];
  /** Everything in the catalog, so the count can say what it is showing. */
  catalogSize: number;
  core: IllinoisCore | null;
  schoolId: SchoolId | null;
  terms: PlanTerm[];
  plannedCourseIds: Set<string>;
  completedCodes: Set<string>;
  selectedCourseId: string | null;
  /** Requirement-valid replacements to light together on the map. */
  highlightedCourseIds: Set<string>;
  targetTermId: string;
  searchQuery: string;
  /** How many courses in the whole catalog match the query. Null without one. */
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
  } | null;
  open: boolean;
  /** False below 1100px, where the finder overlays the board and a drag has nowhere to land. */
  dragUsable: boolean;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (query: string) => void;
  onTargetTermChange: (termId: string) => void;
  onSelectCourse: (courseId: string) => void;
  onAddCourse: (courseId: string, termId: string) => void;
  onRemoveCourse: (courseId: string, termId: string) => void;
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
/** Empty stage space allowed beyond each map edge while panning. */
const MAP_OVERSCROLL = 0.18;
/** Planned courses gain labels only once there is genuinely room around them. */
const LABEL_ZOOM = 7;

export function CourseExplorer({
  courses,
  catalogSize,
  core,
  schoolId,
  terms,
  plannedCourseIds,
  completedCodes,
  selectedCourseId,
  highlightedCourseIds,
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
  onRemoveCourse,
}: CourseExplorerProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [deptQuery, setDeptQuery] = useState('');
  const [view, setView] = useState<View>(HOME);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [dropActive, setDropActive] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pan = useRef<{ pointerId: number; startX: number; startY: number; from: View } | null>(null);
  const press = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);

  /** Departments in the catalog, most courses first. */
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of courses) counts.set(c.cluster, (counts.get(c.cluster) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [courses]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const courseById = useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses],
  );
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

  const framedIds = useMemo(() => {
    if (normalizedQuery) return matching;
    if (highlightedCourseIds.size === 0) return null;
    return new Set(visible.filter((course) => highlightedCourseIds.has(course.id)).map((course) => course.id));
  }, [highlightedCourseIds, matching, normalizedQuery, visible]);

  /**
   * Canvas carries the complete constellation. DOM nodes are reserved for the
   * courses a student is actively working with so 14,000 accessible buttons do
   * not freeze the finder. Clicking any canvas dot promotes it to a draggable
   * DOM node.
   */
  const interactiveCourses = useMemo(() => {
    const picked = new Map<string, Course>();
    const take = (course: Course | undefined) => {
      if (course) picked.set(course.id, course);
    };
    take(selectedCourseId ? courseById.get(selectedCourseId) : undefined);
    for (const course of courses) if (plannedCourseIds.has(course.id)) take(course);
    if (normalizedQuery) {
      for (const course of visible) {
        if (matching.has(course.id)) take(course);
        if (picked.size >= 180) break;
      }
    }
    if (highlightedCourseIds.size > 0) {
      for (const course of visible) {
        if (highlightedCourseIds.has(course.id)) take(course);
        if (picked.size >= 240) break;
      }
    }
    return [...picked.values()];
  }, [courseById, courses, highlightedCourseIds, matching, normalizedQuery, plannedCourseIds, selectedCourseId, visible]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setStageSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const { width, height } = stageSize;
    if (!canvas || width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const point = (course: Course) => {
      const p = positions.get(course.id)!;
      return {
        x: ((p.x / 100) * width) * view.k + view.x,
        y: ((p.y / 100) * height) * view.k + view.y,
      };
    };
    const onScreen = ({ x, y }: { x: number; y: number }, pad = 8) =>
      x >= -pad && x <= width + pad && y >= -pad && y <= height + pad;

    // Draw the prerequisite constellation only around courses already in the
    // plan or selected. Drawing every catalog edge makes the semantic shape
    // unreadable, while these are the paths the student can act on.
    ctx.strokeStyle = 'rgba(121, 161, 204, 0.19)';
    ctx.lineWidth = 1;
    for (const course of visible) {
      if (course.id !== selectedCourseId && !plannedCourseIds.has(course.id)) continue;
      const to = point(course);
      for (const prerequisiteId of course.prerequisites) {
        const prerequisite = courseById.get(prerequisiteId);
        if (!prerequisite || !positions.has(prerequisite.id)) continue;
        const from = point(prerequisite);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }

    for (const course of visible) {
      const p = point(course);
      if (!onScreen(p)) continue;
      const searchMuted = normalizedQuery && !matching.has(course.id);
      const choiceMuted = !normalizedQuery && highlightedCourseIds.size > 0 && !highlightedCourseIds.has(course.id);
      const highlighted = highlightedCourseIds.has(course.id) || matching.has(course.id) && Boolean(normalizedQuery);
      const planned = plannedCourseIds.has(course.id);
      const selected = course.id === selectedCourseId;
      ctx.globalAlpha = searchMuted || choiceMuted ? 0.08 : highlighted ? 0.95 : 0.56;
      ctx.fillStyle = clusterColor(course.cluster);
      ctx.beginPath();
      ctx.arc(p.x, p.y, selected ? 5 : planned ? 4 : highlighted ? 2.8 : 1.7, 0, Math.PI * 2);
      ctx.fill();
      if (selected || planned) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = selected ? '#68c3ef' : '#67d7a1';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
  }, [courseById, highlightedCourseIds, matching, normalizedQuery, plannedCourseIds, positions, selectedCourseId, stageSize, view, visible]);

  /**
   * A search moves the map to its matches.
   *
   * Forty accountancy courses sit in one cluster the size of a thumbnail, and
   * lighting them up at full zoom-out showed a bright smudge. The stage now
   * frames the matches; the adjacent results list carries every code without
   * stacking text on top of nearby dots. Clearing the search goes home.
   */
  useEffect(() => {
    if (!framedIds) {
      // oxlint-disable-next-line react/react-compiler
      setView(HOME);
      return;
    }
    const stage = stageRef.current;
    if (!stage || framedIds.size === 0) return;
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
    for (const id of framedIds) {
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
    // `matching` is memoised on the catalog and the query, so this runs
    // when the matches change and not on every render.
  }, [framedIds, positions]);

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
    // A dot is dragged into a semester and the corner buttons control the
    // view; only the empty space between them starts a pan. Capturing a zoom
    // button's pointer here prevents its click from ever reaching the button.
    if ((event.target as HTMLElement).closest('.map-course-node, .map-zoom')) return;
    press.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    pan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: view };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const down = press.current;
    if (down && down.pointerId === event.pointerId &&
        Math.hypot(event.clientX - down.startX, event.clientY - down.startY) > 4) {
      down.moved = true;
    }
    const p = pan.current;
    const stage = stageRef.current;
    if (!p || !stage || p.pointerId !== event.pointerId) return;
    const { width, height } = stage.getBoundingClientRect();
    setView(clampView({ k: p.from.k, x: p.from.x + event.clientX - p.startX, y: p.from.y + event.clientY - p.startY }, width, height));
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const down = press.current;
    const stage = stageRef.current;
    if (down?.pointerId === event.pointerId && !down.moved && stage) {
      const rect = stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let nearest: Course | null = null;
      let distance = 14;
      for (const course of visible) {
        const position = positions.get(course.id);
        if (!position) continue;
        const px = ((position.x / 100) * rect.width) * view.k + view.x;
        const py = ((position.y / 100) * rect.height) * view.k + view.y;
        const next = Math.hypot(px - x, py - y);
        if (next < distance) {
          nearest = course;
          distance = next;
        }
      }
      if (nearest) onSelectCourse(nearest.id);
    }
    press.current = null;
    if (pan.current?.pointerId === event.pointerId) pan.current = null;
  }

  const selected = selectedCourseId ? courseById.get(selectedCourseId) ?? null : null;
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
  const awayFromHome = zoomed || Math.abs(view.x) > 0.5 || Math.abs(view.y) > 0.5;
  // In chooser mode search stays inside the requirement-valid replacement
  // list. A global search here used to let a student replace a required course
  // with something that merely fit in the same semester.
  const chooserMatches = chooser
    ? chooser.options.filter((course) => !normalizedQuery || courseMatches(course, normalizedQuery))
    : [];
  const listRows = chooser ? chooserMatches.slice(0, 100) : results;
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
            Replacing <strong>{chooser.replacing}</strong> in <strong>{chooser.termLabel}</strong>.
            Every choice below fits the same requirement and the selected term.
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
          placeholder={chooser ? 'Search these replacements' : 'Search a code or a title'}
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
                {/* "on the map" distinguishes this spatial filter from the
                    department choices elsewhere in the planner. */}
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
        className={cn('map-stage', 'is-pannable', dropActive && 'is-remove-target')}
        aria-label="Semantic course map"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null;
          pan.current = null;
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('application/x-term-id')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropActive(false);
          const courseId = event.dataTransfer.getData('application/x-course-id');
          const termId = event.dataTransfer.getData('application/x-term-id');
          if (courseId && termId) onRemoveCourse(courseId, termId);
        }}
      >
        <fieldset className="map-field" aria-label="Course nodes">
          <canvas ref={canvasRef} className="map-canvas" aria-hidden="true" />
          <div
            className="map-layer"
            style={
              {
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
                '--inv': 1 / view.k,
              } as CSSProperties
            }
          >
            {interactiveCourses.map((course) => {
              if (hidden.has(course.cluster)) return null;
              const position = positions.get(course.id)!;
              const isSelected = course.id === selectedCourseId;
              const isMatch = matching.has(course.id);
              const isChoice = highlightedCourseIds.has(course.id);
              const labelled =
                isSelected ||
                (!normalizedQuery &&
                  highlightedCourseIds.size === 0 &&
                  plannedCourseIds.has(course.id) &&
                  view.k >= LABEL_ZOOM) ||
                (Boolean(normalizedQuery) && isMatch && matching.size <= 30) ||
                (isChoice && highlightedCourseIds.size <= 30 && view.k >= LABEL_ZOOM);
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
                    highlightedCourseIds.size > 0 && !isChoice && 'is-search-muted',
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

        {dropActive && (
          <div className="map-remove-target" aria-hidden="true">
            <Trash2 />
            <span>Drop here to remove from the plan</span>
          </div>
        )}

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
            disabled={!awayFromHome}
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
            {visible.length.toLocaleString()} of {catalogSize.toLocaleString()} courses on the map.{' '}
            Scroll to zoom, or drag the space between dots to move.{' '}
            {dragUsable
              ? 'Click any dot to select it, then drag the highlighted dot into a semester. Drag a plan card back here to remove it.'
              : 'Click any dot to select it, then use Add to here.'}
          </>
        )}
      </p>

      {showList && (
        <div className="finder-results" aria-label={chooser ? 'Courses for this slot' : 'Matching courses'}>
          <p className="finder-results-head">
            {chooser && !normalizedQuery
              ? `${chooserMatches.length.toLocaleString()} eligible replacements, best fit first`
              : chooser
                ? `${chooserMatches.length.toLocaleString()} matching replacements`
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

/** Keep some map visible while allowing room beyond every edge. */
function clampView(v: View, width: number, height: number): View {
  const k = clamp(v.k, 1, MAX_ZOOM);
  const padX = width * MAP_OVERSCROLL;
  const padY = height * MAP_OVERSCROLL;
  return {
    k,
    x: clamp(v.x, width - width * k - padX, padX),
    y: clamp(v.y, height - height * k - padY, padY),
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
