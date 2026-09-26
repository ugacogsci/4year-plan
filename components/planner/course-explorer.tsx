'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Maximize2, Minimize2, Minus, Move, Plus, RotateCcw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
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
  theme: 'light' | 'dark';
  /** False below 1100px, where the finder overlays the board and a drag has nowhere to land. */
  dragUsable: boolean;
  onHeightChange: (height: number) => void;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (query: string) => void;
  onTargetTermChange: (termId: string) => void;
  onSelectCourse: (courseId: string | null) => void;
  onAddCourse: (courseId: string, termId: string) => void;
  onRemoveCourse: (courseId: string, termId: string) => void;
}

/**
 * Where the map is looking: a scale and an offset in stage pixels. Canvas
 * points and interactive DOM nodes both resolve through this same view.
 */
interface View {
  k: number;
  x: number;
  y: number;
}

const HOME: View = { k: 1, x: 0, y: 0 };
const MAX_ZOOM = 24;
/** Empty stage space allowed beyond each map edge while panning. */
const MAP_OVERSCROLL = 0.18;
/** Preserve the semantic X layout while giving nearby clusters more vertical air. */
const MAP_VERTICAL_STRETCH = 2.5;
const LABEL_ZOOM = 7;
const MIN_MAP_HEIGHT = 180;
const COLLAPSED_MAP_HEIGHT = 58;

export function CourseExplorer({
  courses,
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
  theme,
  dragUsable,
  onHeightChange,
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
  const [planeSize, setPlaneSize] = useState({ width: 0, height: 0 });
  const [dropActive, setDropActive] = useState(false);
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const [finderWidth, setFinderWidth] = useState<number | null>(null);
  const [finderLeft, setFinderLeft] = useState(0);
  const [mapMode, setMapMode] = useState<'custom' | 'expanded' | 'collapsed'>('custom');
  const [filterOpen, setFilterOpen] = useState(false);
  const [arrangeMode, setArrangeMode] = useState(false);
  const [positionOverrides, setPositionOverrides] = useState<Map<string, MapPosition>>(new Map());
  const [arrangedSelection, setArrangedSelection] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const finderRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const edgeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maxFinderWidth = useRef(0);
  const resize = useRef<{
    axis: 'horizontal' | 'vertical';
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
    left: number;
    edge: 'left' | 'right';
  } | null>(null);
  const pan = useRef<{ pointerId: number; startX: number; startY: number; from: View } | null>(null);
  const press = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const nodeMove = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    ids: string[];
    from: Map<string, MapPosition>;
    toggleOffId: string | null;
  } | null>(null);
  const marquee = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    add: boolean;
  } | null>(null);

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
  const basePositions = useMemo(
    () =>
      new Map(
        courses.map((course, index) => {
          const position = course.mapPosition ?? fallbackPosition(course.id, index);
          return [course.id, { x: position.x, y: position.y }];
        }),
      ),
    [courses],
  );
  const positions = useMemo(() => {
    const next = new Map(basePositions);
    for (const [id, position] of positionOverrides) next.set(id, position);
    return next;
  }, [basePositions, positionOverrides]);
  const positionBuckets = useMemo(() => {
    const buckets = new Map<string, Course[]>();
    for (const course of courses) {
      const point = positions.get(course.id);
      if (!point) continue;
      const key = `${Math.floor(point.x / 2)}:${Math.floor(point.y / 2)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(course);
      else buckets.set(key, [course]);
    }
    return buckets;
  }, [courses, positions]);

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

  /** Nodes joined directly to the current selection by a visible map path. */
  const selectionConnectionIds = useMemo(() => {
    const connected = new Set<string>();
    if (!selectedCourseId) return connected;
    for (const course of visible) {
      if (course.id !== selectedCourseId && !plannedCourseIds.has(course.id)) continue;
      for (const prerequisiteId of course.prerequisites) {
        if (course.id === selectedCourseId) connected.add(prerequisiteId);
        if (prerequisiteId === selectedCourseId) connected.add(course.id);
      }
    }
    return connected;
  }, [plannedCourseIds, selectedCourseId, visible]);

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
    for (const id of arrangedSelection) take(courseById.get(id));
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
  }, [arrangedSelection, courseById, courses, highlightedCourseIds, matching, normalizedQuery, plannedCourseIds, selectedCourseId, visible]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setStageSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
      if (width > 0 && height >= MIN_MAP_HEIGHT) {
        setPlaneSize((current) =>
          current.width > 0 && current.height > 0 ? current : { width, height },
        );
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (finderWidth !== null) return;
    const width = finderRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) maxFinderWidth.current = width;
  }, [finderWidth, open, stageSize.width]);

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

    const plane = resolvedPlaneSize(planeSize, stageSize);
    const origin = planeOrigin(stageSize, plane);
    const point = (course: Course) => {
      const p = positions.get(course.id)!;
      return {
        x: origin.x + ((p.x / 100) * plane.width) * view.k + view.x,
        y: origin.y + ((p.y / 100) * plane.height) * view.k + view.y,
      };
    };
    const onScreen = ({ x, y }: { x: number; y: number }, pad = 8) =>
      x >= -pad && x <= width + pad && y >= -pad && y <= height + pad;

    for (const course of visible) {
      const p = point(course);
      if (!onScreen(p)) continue;
      const searchMuted = normalizedQuery && !matching.has(course.id);
      const choiceMuted = !normalizedQuery && highlightedCourseIds.size > 0 && !highlightedCourseIds.has(course.id);
      const highlighted = highlightedCourseIds.has(course.id) || matching.has(course.id) && Boolean(normalizedQuery);
      const planned = plannedCourseIds.has(course.id);
      const selected = course.id === selectedCourseId;
      // Planned and selected courses have an interactive DOM node. Painting
      // them here as well produced a second ring that drifted while zooming.
      if (planned || selected || arrangedSelection.has(course.id)) continue;
      ctx.globalAlpha = searchMuted || choiceMuted ? 0.12 : highlighted ? 0.98 : 0.74;
      ctx.fillStyle = clusterColor(course.cluster);
      ctx.beginPath();
      ctx.arc(p.x, p.y, highlighted ? 3.25 : 2.15, 0, Math.PI * 2);
      ctx.fill();
      if (view.k >= LABEL_ZOOM) {
        ctx.globalAlpha = searchMuted || choiceMuted ? 0.18 : 0.9;
        ctx.strokeStyle = theme === 'dark' ? '#000000' : '#ffffff';
        ctx.lineWidth = 0.45;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
  }, [arrangedSelection, courseById, highlightedCourseIds, matching, normalizedQuery, plannedCourseIds, planeSize, positions, selectedCourseId, stageSize, theme, view, visible]);

  useEffect(() => {
    const canvas = edgeCanvasRef.current;
    const { width, height } = stageSize;
    if (!canvas || width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = theme === 'dark' ? '#000000' : '#ffffff';
    ctx.globalAlpha = 0.68;
    ctx.lineWidth = 1.35;

    const plane = resolvedPlaneSize(planeSize, stageSize);
    const origin = planeOrigin(stageSize, plane);
    const point = (course: Course) => {
      const position = positions.get(course.id)!;
      return {
        x: origin.x + ((position.x / 100) * plane.width) * view.k + view.x,
        y: origin.y + ((position.y / 100) * plane.height) * view.k + view.y,
      };
    };

    // Keep the map legible by showing paths that belong to the current plan or
    // selection. This canvas sits above the node cloud, so the paths no longer
    // vanish beneath dense clusters.
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
    ctx.globalAlpha = 1;
  }, [courseById, plannedCourseIds, planeSize, positions, selectedCourseId, stageSize, theme, view, visible]);

  /**
   * A search moves the map to its matches.
   *
   * Forty accountancy courses sit in one cluster the size of a thumbnail, and
   * lighting them up at full zoom-out showed a bright smudge. The stage now
   * frames the matches; the adjacent results list carries every code without
   * stacking text on top of nearby dots. Clearing the search goes home.
   */
  useEffect(() => {
    if (arrangeMode) return;
    if (!framedIds) {
      // oxlint-disable-next-line react/react-compiler
      setView(HOME);
      return;
    }
    const stage = stageRef.current;
    if (!stage || framedIds.size === 0) return;
    const { width, height } = stage.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const plane = resolvedPlaneSize(planeSize, { width, height });
    const origin = planeOrigin({ width, height }, plane);
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
    const bw = Math.max(((maxX - minX) / 100) * plane.width, 1);
    const bh = Math.max(((maxY - minY) / 100) * plane.height, 1);
    // Room for the labels, scaled to the stage so a narrow finder still zooms.
    const pad = clamp(Math.min(width, height) * 0.14, 32, 80);
    const k = clamp(Math.min((width - pad) / bw, (height - pad) / bh), 1, MAX_ZOOM / 2);
    const cx = ((minX + maxX) / 200) * plane.width;
    const cy = ((minY + maxY) / 200) * plane.height;
    /**
     * Set from an effect on purpose. The frame depends on the stage's pixel
     * size, which only the DOM knows after the matches have rendered, so this
     * is a measurement being written back rather than derived state. It runs
     * once per change of matches, which is one extra render per keystroke.
     */
    // oxlint-disable-next-line react/react-compiler
    setView(
      clampView(
        { k, x: width / 2 - origin.x - cx * k, y: height / 2 - origin.y - cy * k },
        width,
        height,
        plane.width,
        plane.height,
      ),
    );
    // `matching` is memoised on the catalog and the query, so this runs
    // when the matches change and not on every render.
  }, [arrangeMode, framedIds, planeSize, positions]);

  /**
   * Wheel zoom, around the cursor. A native listener because React registers
   * wheel as passive, and a passive handler cannot stop the finder scrolling.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !open) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest('.map-inspector')) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
      const plane = resolvedPlaneSize(planeSize, rect);
      setView((v) => zoomAt(v, factor, px, py, rect.width, rect.height, plane.width, plane.height));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [open, planeSize]);

  function zoomBy(factor: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const { width, height } = stage.getBoundingClientRect();
    const plane = resolvedPlaneSize(planeSize, { width, height });
    setView((v) => zoomAt(v, factor, width / 2, height / 2, width, height, plane.width, plane.height));
  }

  function startResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    axis: 'horizontal' | 'vertical',
    edge: 'left' | 'right' = 'right',
  ) {
    const finder = finderRef.current;
    if (!finder) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = finder.getBoundingClientRect();
    // The grid cell, not the whole planner, is this panel's width ceiling.
    // Using the parent's right edge let a resized map grow beneath chat at
    // intermediate breakpoints because the parent also contains that column.
    maxFinderWidth.current = Math.max(bounds.width, maxFinderWidth.current || bounds.width);
    setMapMode('custom');
    resize.current = {
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
      left: finderLeft,
      edge,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = resize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.buttons !== 1) {
      resize.current = null;
      return;
    }
    if (active.axis === 'horizontal') {
      const maximum = maxFinderWidth.current || active.width;
      const delta = event.clientX - active.startX;
      const minimum = Math.min(320, maximum);
      if (active.edge === 'left') {
        const right = active.left + active.width;
        const width = clamp(active.width - delta, minimum, right);
        setFinderWidth(width);
        setFinderLeft(right - width);
      } else {
        setFinderWidth(clamp(active.width + delta, minimum, maximum - active.left));
      }
      return;
    }
    onHeightChange(clamp(active.height + event.clientY - active.startY, MIN_MAP_HEIGHT, maximumMapHeight()));
  }

  function finishResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resize.current?.pointerId !== event.pointerId) return;
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeWithKeyboard(
    axis: 'horizontal' | 'vertical',
    amount: number,
    edge: 'left' | 'right' = 'right',
  ) {
    const bounds = finderRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setMapMode('custom');
    if (axis === 'horizontal') {
      const maximum = maxFinderWidth.current || bounds.width;
      const minimum = Math.min(320, maximum);
      if (edge === 'left') {
        const right = finderLeft + bounds.width;
        const width = clamp(bounds.width - amount, minimum, right);
        setFinderWidth(width);
        setFinderLeft(right - width);
      } else {
        setFinderWidth(clamp(bounds.width + amount, minimum, maximum - finderLeft));
      }
      return;
    }
    onHeightChange(clamp(bounds.height + amount, MIN_MAP_HEIGHT, maximumMapHeight()));
  }

  function maximumMapHeight() {
    return Math.max(MIN_MAP_HEIGHT, Math.min(640, window.innerHeight - 170));
  }

  function toggleMapSize() {
    setFilterOpen(false);
    setHovered(null);
    setFinderWidth(null);
    setFinderLeft(0);
    if (mapMode === 'expanded') {
      onSelectCourse(null);
      setMapMode('collapsed');
      onHeightChange(COLLAPSED_MAP_HEIGHT);
      return;
    }
    setMapMode('expanded');
    onHeightChange(maximumMapHeight());
  }

  function resetMap() {
    setPositionOverrides(new Map());
    setArrangedSelection(new Set());
    setSelectionBox(null);
    setHovered(null);
    onSelectCourse(null);
    setView(HOME);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('.map-zoom, .map-inspector')) return;

    if (arrangeMode) {
      event.preventDefault();
      setHovered(null);
      const hit = hitTest(event.clientX, event.clientY);
      const add = event.shiftKey || event.metaKey || event.ctrlKey;
      if (hit) {
        let ids: string[];
        let toggleOffId: string | null = null;
        if (arrangedSelection.has(hit.course.id)) {
          ids = [...arrangedSelection];
          if (add) toggleOffId = hit.course.id;
        } else {
          ids = add ? [...arrangedSelection, hit.course.id] : [hit.course.id];
          setArrangedSelection(new Set(ids));
        }
        const from = new Map<string, MapPosition>();
        for (const id of ids) {
          const position = positions.get(id);
          if (position) from.set(id, position);
        }
        nodeMove.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          ids,
          from,
          toggleOffId,
        };
      } else {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!add) setArrangedSelection(new Set());
        marquee.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          add,
        };
        setSelectionBox({
          left: event.clientX - bounds.left,
          top: event.clientY - bounds.top,
          width: 0,
          height: 0,
        });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // A dot is dragged into a semester and the corner buttons control the
    // view; only the empty space between them starts a pan. Capturing a zoom
    // button's pointer here prevents its click from ever reaching the button.
    if (target.closest('.map-course-node')) return;
    setHovered(null);
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
    const moving = nodeMove.current;
    const stage = stageRef.current;
    if (moving?.pointerId === event.pointerId && stage) {
      const dx = event.clientX - moving.startX;
      const dy = event.clientY - moving.startY;
      if (Math.hypot(dx, dy) > 3) moving.moved = true;
      const bounds = stage.getBoundingClientRect();
      const plane = resolvedPlaneSize(planeSize, bounds);
      const mapDx = (dx / view.k / plane.width) * 100;
      const mapDy = (dy / view.k / plane.height) * 100;
      setPositionOverrides((current) => {
        const next = new Map(current);
        for (const id of moving.ids) {
          const start = moving.from.get(id);
          if (!start) continue;
          next.set(id, {
            x: clamp(start.x + mapDx, 0, 100),
            y: clamp(start.y + mapDy, 0, 100),
          });
        }
        return next;
      });
      return;
    }

    const selecting = marquee.current;
    if (selecting?.pointerId === event.pointerId && stage) {
      const bounds = stage.getBoundingClientRect();
      const startX = selecting.startX - bounds.left;
      const startY = selecting.startY - bounds.top;
      const endX = clamp(event.clientX - bounds.left, 0, bounds.width);
      const endY = clamp(event.clientY - bounds.top, 0, bounds.height);
      setSelectionBox({
        left: Math.min(startX, endX),
        top: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
      });
      return;
    }

    const down = press.current;
    if (down && down.pointerId === event.pointerId &&
        Math.hypot(event.clientX - down.startX, event.clientY - down.startY) > 4) {
      down.moved = true;
    }
    const p = pan.current;
    if (!stage) return;
    if (p && p.pointerId === event.pointerId) {
      setHovered(null);
      const { width, height } = stage.getBoundingClientRect();
      const plane = resolvedPlaneSize(planeSize, { width, height });
      setView(
        clampView(
          { k: p.from.k, x: p.from.x + event.clientX - p.startX, y: p.from.y + event.clientY - p.startY },
          width,
          height,
          plane.width,
          plane.height,
        ),
      );
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    setHovered((current) =>
      hit
        ? current?.id === hit.course.id && current.x === hit.x && current.y === hit.y
          ? current
          : { id: hit.course.id, x: hit.x, y: hit.y }
        : null,
    );
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const moving = nodeMove.current;
    if (moving?.pointerId === event.pointerId) {
      if (!moving.moved && moving.toggleOffId) {
        setArrangedSelection((current) => {
          const next = new Set(current);
          next.delete(moving.toggleOffId!);
          return next;
        });
      }
      nodeMove.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    const selecting = marquee.current;
    const stage = stageRef.current;
    if (selecting?.pointerId === event.pointerId && stage) {
      const bounds = stage.getBoundingClientRect();
      const startX = clamp(selecting.startX - bounds.left, 0, bounds.width);
      const startY = clamp(selecting.startY - bounds.top, 0, bounds.height);
      const endX = clamp(event.clientX - bounds.left, 0, bounds.width);
      const endY = clamp(event.clientY - bounds.top, 0, bounds.height);
      const box = {
        left: Math.min(startX, endX),
        top: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
      };
      const plane = resolvedPlaneSize(planeSize, bounds);
      const origin = planeOrigin(bounds, plane);
      const picked = new Set<string>();
      for (const course of visible) {
        const position = positions.get(course.id);
        if (!position) continue;
        const x = origin.x + ((position.x / 100) * plane.width) * view.k + view.x;
        const y = origin.y + ((position.y / 100) * plane.height) * view.k + view.y;
        if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) {
          picked.add(course.id);
        }
      }
      setArrangedSelection((current) => selecting.add ? new Set([...current, ...picked]) : picked);
      marquee.current = null;
      setSelectionBox(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    const down = press.current;
    if (down?.pointerId === event.pointerId && !down.moved && stage) {
      const hit = hitTest(event.clientX, event.clientY);
      onSelectCourse(hit?.course.id ?? null);
    }
    press.current = null;
    if (pan.current?.pointerId === event.pointerId) pan.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function hitTest(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const plane = resolvedPlaneSize(planeSize, rect);
    const origin = planeOrigin(rect, plane);
    const mapX = (((x - origin.x - view.x) / view.k) / plane.width) * 100;
    const mapY = (((y - origin.y - view.y) / view.k) / plane.height) * 100;
    const regularRadius = 15;
    const priorityRadius = 24;
    const reachX = (priorityRadius / view.k / plane.width) * 100;
    const reachY = (priorityRadius / view.k / plane.height) * 100;
    const minBX = Math.floor((mapX - reachX) / 2);
    const maxBX = Math.floor((mapX + reachX) / 2);
    const minBY = Math.floor((mapY - reachY) / 2);
    const maxBY = Math.floor((mapY + reachY) / 2);
    let nearest: Course | null = null;
    let distance = regularRadius;
    let priority: Course | null = null;
    let priorityDistance = priorityRadius;
    for (let bx = minBX; bx <= maxBX; bx += 1) {
      for (let by = minBY; by <= maxBY; by += 1) {
        for (const course of positionBuckets.get(`${bx}:${by}`) ?? []) {
          if (hidden.has(course.cluster)) continue;
          const position = positions.get(course.id)!;
          const px = origin.x + ((position.x / 100) * plane.width) * view.k + view.x;
          const py = origin.y + ((position.y / 100) * plane.height) * view.k + view.y;
          const next = Math.hypot(px - x, py - y);
          if (
            (course.id === selectedCourseId || selectionConnectionIds.has(course.id)) &&
            next < priorityDistance
          ) {
            priority = course;
            priorityDistance = next;
          }
          if (next < distance) {
            nearest = course;
            distance = next;
          }
        }
      }
    }
    const winner = priority ?? nearest;
    if (!winner) return null;
    const point = positions.get(winner.id)!;
    return {
      course: winner,
      x: origin.x + ((point.x / 100) * plane.width) * view.k + view.x,
      y: origin.y + ((point.y / 100) * plane.height) * view.k + view.y,
    };
  }

  const selected = selectedCourseId ? courseById.get(selectedCourseId) ?? null : null;
  const mapPlane = resolvedPlaneSize(planeSize, stageSize);
  const mapOrigin = planeOrigin(stageSize, mapPlane);
  const selectedPoint = selected && stageSize.width > 0 && stageSize.height > 0
    ? (() => {
        const point = positions.get(selected.id);
        if (!point) return null;
        return {
          x: mapOrigin.x + ((point.x / 100) * mapPlane.width) * view.k + view.x,
          y: mapOrigin.y + ((point.y / 100) * mapPlane.height) * view.k + view.y,
        };
      })()
    : null;
  const zoomLabels = useMemo(() => {
    if (view.k < LABEL_ZOOM || stageSize.width <= 0 || stageSize.height <= 0) return [];
    return visible.flatMap((course) => {
      const point = positions.get(course.id);
      if (!point) return [];
      const x = mapOrigin.x + ((point.x / 100) * mapPlane.width) * view.k + view.x;
      const y = mapOrigin.y + ((point.y / 100) * mapPlane.height) * view.k + view.y;
      if (x < 0 || x > stageSize.width || y < 0 || y > stageSize.height) return [];
      return [{ id: course.id, code: course.code, x, y }];
    });
  }, [mapOrigin.x, mapOrigin.y, mapPlane.height, mapPlane.width, positions, stageSize.height, stageSize.width, view.k, view.x, view.y, visible]);
  const targetLabel =
    targetTermId === 'completed'
      ? 'Prior coursework'
      : (terms.find((t) => t.id === targetTermId)?.label ?? 'a term');

  const deptMatches = departments.filter(([name]) =>
    name.toLowerCase().includes(deptQuery.trim().toLowerCase()),
  );
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
    <aside
      ref={finderRef}
      className="course-finder"
      aria-label="Course map"
      data-resized={finderWidth === null ? undefined : 'true'}
      data-map-mode={mapMode}
      style={finderWidth === null ? undefined : { width: finderWidth, marginLeft: finderLeft }}
    >

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
          placeholder={chooser ? 'Search replacements' : 'Search courses'}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="finder-filters">
        {/* One trigger instead of one button per department. The old legend
            rendered 194 buttons in a 224px window with 5,400px of scroll. */}
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn('map-filter-button', hidden.size > 0 && 'is-active')}
                aria-label="Filter map departments"
                title={hidden.size > 0 ? `${hidden.size} departments hidden` : 'Filter map departments'}
              >
                <SlidersHorizontal aria-hidden="true" />
              </button>
            }
          />
          <PopoverContent align="end" sideOffset={6} className="map-filter-popover">
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

      </div>

      <div
        className={cn(
          'map-stage',
          'is-pannable',
          arrangeMode && 'is-arranging',
          dropActive && 'is-remove-target',
        )}
        data-deep-zoom={view.k >= LABEL_ZOOM ? 'true' : undefined}
        aria-label="Semantic course map"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null;
          pan.current = null;
          nodeMove.current = null;
          marquee.current = null;
          setSelectionBox(null);
          setHovered(null);
        }}
        onPointerLeave={() => setHovered(null)}
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
        <span className="map-collapsed-title">Course map</span>
        <fieldset className="map-field" aria-label="Course nodes">
          <canvas ref={canvasRef} className="map-canvas" aria-hidden="true" />
          <div className="map-layer">
            {interactiveCourses.map((course) => {
              if (hidden.has(course.cluster)) return null;
              const position = positions.get(course.id)!;
              const screenX = Math.round(
                mapOrigin.x + ((position.x / 100) * mapPlane.width) * view.k + view.x,
              );
              const screenY = Math.round(
                mapOrigin.y + ((position.y / 100) * mapPlane.height) * view.k + view.y,
              );
              const isSelected = course.id === selectedCourseId;
              const isMatch = matching.has(course.id);
              const isChoice = highlightedCourseIds.has(course.id);
              return (
                <button
                  key={course.id}
                  type="button"
                  draggable={dragUsable && !arrangeMode}
                  title={`${course.code}: ${course.title}`}
                  aria-label={`${course.code}, ${course.title}`}
                  aria-pressed={isSelected}
                  className={cn(
                    'map-course-node',
                    isSelected && 'is-selected',
                    plannedCourseIds.has(course.id) && 'is-planned',
                    arrangedSelection.has(course.id) && 'is-arrange-selected',
                    course.pathwayRole === 'required' && 'is-required',
                    normalizedQuery && !isMatch && 'is-search-muted',
                    highlightedCourseIds.size > 0 && !isChoice && 'is-search-muted',
                  )}
                  style={
                    {
                      left: screenX,
                      top: screenY,
                      '--node-color': clusterColor(course.cluster),
                    } as CSSProperties
                  }
                  onClick={(event) => {
                    if (arrangeMode) {
                      event.preventDefault();
                      return;
                    }
                    onSelectCourse(hitTest(event.clientX, event.clientY)?.course.id ?? course.id);
                  }}
                  onDragStart={(event) => {
                    if (arrangeMode) {
                      event.preventDefault();
                      return;
                    }
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
                </button>
              );
            })}
          </div>
        </fieldset>

        <canvas ref={edgeCanvasRef} className="map-edge-canvas" aria-hidden="true" />

        {selectionBox && (
          <span className="map-selection-box" aria-hidden="true" style={selectionBox} />
        )}

        {zoomLabels.map((label) =>
          label.id === selectedCourseId || label.id === hovered?.id ? null : (
            <span
              className="map-zoom-label"
              key={label.id}
              style={{ left: label.x, top: label.y }}
            >
              {label.code}
            </span>
          ),
        )}

        {selected && selectedPoint && (
          <span className="map-selection-label" style={{ left: selectedPoint.x, top: selectedPoint.y }}>
            {selected.code}
          </span>
        )}

        {hovered && hovered.id !== selectedCourseId && (
          <span className="map-hover-label" style={{ left: hovered.x, top: hovered.y }}>
            {courseById.get(hovered.id)?.code}
          </span>
        )}

        {dropActive && (
          <div className="map-remove-target" aria-hidden="true">
            <Trash2 />
            <span>Drop here to remove from the plan</span>
          </div>
        )}

        <div className="map-zoom" aria-label="Zoom">
          <button
            type="button"
            className={cn(arrangeMode && 'is-active')}
            aria-label={arrangeMode ? 'Stop arranging course nodes' : 'Arrange course nodes'}
            aria-pressed={arrangeMode}
            title={arrangeMode
              ? 'Stop arranging nodes'
              : 'Arrange nodes. Drag a node to move it; Shift-click or drag a box to select several.'}
            onClick={() => {
              setArrangeMode((current) => !current);
              setSelectionBox(null);
              marquee.current = null;
              nodeMove.current = null;
            }}
          >
            <Move aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Reset course map"
            title="Reset zoom, pan, selection, and temporary node positions"
            onClick={resetMap}
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.6)}>
            <Plus aria-hidden="true" />
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.6)}>
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="map-size-toggle"
            aria-label={mapMode === 'expanded' ? 'Minimize course map' : 'Expand course map'}
            title={mapMode === 'expanded' ? 'Minimize course map' : 'Expand course map'}
            onClick={toggleMapSize}
          >
            {mapMode === 'expanded' ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
        </div>

        {selected && selectedPoint && (() => {
          const { x, y } = selectedPoint;
          const width = Math.min(292, Math.max(224, stageSize.width - 24));
          const left = clamp(
            x > stageSize.width * 0.58 ? x - width - 18 : x + 18,
            12,
            Math.max(12, stageSize.width - width - 12),
          );
          const top = clamp(y - 26, 48, Math.max(48, stageSize.height - 246));
          return (
            <div className="map-inspector" aria-live="polite" style={{ left, top, width }}>
              <div className="map-popup-heading">
                <span className="inspector-dot" style={{ backgroundColor: clusterColor(selected.cluster) }} />
                <strong>{selected.code}</strong>
                <span>{creditLabel(selected)}</span>
              </div>
              <h3>{selected.title}</h3>
              {selected.description && <p className="map-popup-description">{selected.description}</p>}
              <details className="map-popup-more">
                <summary>Course details</summary>
                <CourseDetail
                  course={selected}
                  core={core}
                  schoolId={schoolId}
                  completed={completedCodes.has(selected.code.toUpperCase())}
                />
              </details>
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
                  {plannedCourseIds.has(selected.id) ? <Check /> : <Plus />}
                  {plannedCourseIds.has(selected.id) ? 'In plan' : 'Add'}
                </Button>
              </div>
            </div>
          );
        })()}
      </div>

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

      <button
        type="button"
        className="map-resize-handle is-horizontal is-left"
        aria-label="Resize course map width from the left"
        title="Drag the left edge to resize map width"
        onPointerDown={(event) => startResize(event, 'horizontal', 'left')}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          resizeWithKeyboard('horizontal', event.key === 'ArrowRight' ? 24 : -24, 'left');
        }}
      />
      <button
        type="button"
        className="map-resize-handle is-horizontal is-right"
        aria-label="Resize course map width from the right"
        title="Drag the right edge to resize map width"
        onPointerDown={(event) => startResize(event, 'horizontal', 'right')}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          resizeWithKeyboard('horizontal', event.key === 'ArrowRight' ? 24 : -24, 'right');
        }}
      />
      <button
        type="button"
        className="map-resize-handle is-vertical"
        aria-label="Resize course map height"
        title="Drag to resize map height"
        onPointerDown={(event) => startResize(event, 'vertical')}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          resizeWithKeyboard('vertical', event.key === 'ArrowDown' ? 24 : -24);
        }}
      />

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
function clampView(
  v: View,
  width: number,
  height: number,
  planeWidth: number,
  planeHeight: number,
): View {
  const k = clamp(v.k, 1, MAX_ZOOM);
  const padX = width * MAP_OVERSCROLL;
  const padY = height * MAP_OVERSCROLL;
  const originX = (width - planeWidth) / 2;
  const originY = (height - planeHeight) / 2;
  const xA = width - originX - planeWidth * k - padX;
  const xB = padX - originX;
  const yA = height - originY - planeHeight * k - padY;
  const yB = padY - originY;
  return {
    k,
    x: clamp(v.x, Math.min(xA, xB), Math.max(xA, xB)),
    y: clamp(v.y, Math.min(yA, yB), Math.max(yA, yB)),
  };
}

/** Scale about a stage point, so what is under the cursor stays under it. */
function zoomAt(
  v: View,
  factor: number,
  px: number,
  py: number,
  width: number,
  height: number,
  planeWidth: number,
  planeHeight: number,
): View {
  const k = clamp(v.k * factor, 1, MAX_ZOOM);
  const ratio = k / v.k;
  const originX = (width - planeWidth) / 2;
  const originY = (height - planeHeight) / 2;
  return clampView(
    {
      k,
      x: px - originX - (px - originX - v.x) * ratio,
      y: py - originY - (py - originY - v.y) * ratio,
    },
    width,
    height,
    planeWidth,
    planeHeight,
  );
}

function resolvedPlaneSize(
  plane: { width: number; height: number },
  stage: { width: number; height: number },
) {
  return {
    width: plane.width || stage.width || 1,
    height: (plane.height || stage.height || 1) * MAP_VERTICAL_STRETCH,
  };
}

function planeOrigin(
  stage: { width: number; height: number },
  plane: { width: number; height: number },
) {
  return {
    x: (stage.width - plane.width) / 2,
    y: (stage.height - plane.height) / 2,
  };
}

/** Only for a course with no crawled position. Illinois has none of these today. */
function fallbackPosition(id: string, index: number): MapPosition {
  const hash = Array.from(id).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 10_007,
    index + 17,
  );
  return { x: 6 + (hash % 88), y: 7 + ((hash * 47 + index * 13) % 84) };
}
