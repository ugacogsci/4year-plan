import type { Course, MapPosition } from './types';

export const MAP_NODE_HIT_RADIUS = 15;
export const MAP_STICKY_HIT_RADIUS = 14;
const BUCKET_SIZE = 2;

export function bucketMapCourses(courses: Course[], positions: ReadonlyMap<string, MapPosition>) {
  const buckets = new Map<string, Course[]>();
  for (const course of courses) {
    const point = positions.get(course.id);
    if (!point) continue;
    const key = `${Math.floor(point.x / BUCKET_SIZE)}:${Math.floor(point.y / BUCKET_SIZE)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(course);
    else buckets.set(key, [course]);
  }
  return buckets;
}

/** Hit radii are CSS pixels, independent of zoom and the map's dimensions. */
export function hitTestMap({
  pointer, view, plane, origin, viewport, positions, buckets, hidden, priorityIds, sticky = true,
}: {
  pointer: MapPosition;
  view: { k: number; x: number; y: number };
  plane: { width: number; height: number };
  origin: MapPosition;
  viewport: { width: number; height: number };
  positions: ReadonlyMap<string, MapPosition>;
  buckets: ReadonlyMap<string, Course[]>;
  hidden: ReadonlySet<string>;
  priorityIds: ReadonlySet<string>;
  sticky?: boolean;
}) {
  if (plane.width <= 0 || plane.height <= 0 || view.k <= 0 ||
      pointer.x < 0 || pointer.y < 0 || pointer.x > viewport.width || pointer.y > viewport.height) return null;
  const radius = sticky ? Math.max(MAP_STICKY_HIT_RADIUS, MAP_NODE_HIT_RADIUS) : MAP_NODE_HIT_RADIUS;
  const mapX = ((pointer.x - origin.x - view.x) / view.k / plane.width) * 100;
  const mapY = ((pointer.y - origin.y - view.y) / view.k / plane.height) * 100;
  const reachX = (radius / view.k / plane.width) * 100;
  const reachY = (radius / view.k / plane.height) * 100;
  type Hit = { course: Course; x: number; y: number };
  let nearest: Hit | null = null;
  let nearestDistance = MAP_NODE_HIT_RADIUS;
  let priority: Hit | null = null;
  let priorityDistance = MAP_STICKY_HIT_RADIUS;
  for (let bx = Math.floor((mapX - reachX) / BUCKET_SIZE); bx <= Math.floor((mapX + reachX) / BUCKET_SIZE); bx += 1) {
    for (let by = Math.floor((mapY - reachY) / BUCKET_SIZE); by <= Math.floor((mapY + reachY) / BUCKET_SIZE); by += 1) {
      for (const course of buckets.get(`${bx}:${by}`) ?? []) {
        if (hidden.has(course.cluster)) continue;
        const point = positions.get(course.id);
        if (!point) continue;
        const x = origin.x + (point.x / 100) * plane.width * view.k + view.x;
        const y = origin.y + (point.y / 100) * plane.height * view.k + view.y;
        // Clipped nodes must not capture the pointer from outside the viewport.
        if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
        const distance = Math.hypot(x - pointer.x, y - pointer.y);
        if (sticky && priorityIds.has(course.id) && distance <= priorityDistance) {
          priority = { course, x, y };
          priorityDistance = distance;
        }
        if (distance <= nearestDistance) {
          nearest = { course, x, y };
          nearestDistance = distance;
        }
      }
    }
  }
  return priority ?? nearest;
}
