import type { Course, SemesterSeason } from './types';

/**
 * Real UGA catalog, adapted into the planner's Course shape.
 *
 * Source chain:
 *   1. semantic-course-map scraped 14,092 courses and projected them to x/y
 *   2. scripts/enrich-uga.mjs re-read each /Course/Details page for the three
 *      fields that scrape skipped: prerequisites, offering term, credits
 *
 * That second step is what makes a planner possible. The map data alone has
 * 34 courses out of 14,092 mentioning a prerequisite; a degree is an ordering
 * problem, and without the ordering there is nothing to plan.
 */

interface RawCourse {
  subject: string;
  number: string;
  title: string;
  description: string;
  url: string;
  x: number;
  y: number;
  credits?: number;
  prerequisites?: string[];
  prerequisiteText?: string;
  offeredIn?: SemesterSeason[];
  offeredText?: string;
  course_objectives?: string[];
  topical_outline?: string[];
}

/**
 * Cross-listed courses arrive as "AAEC(ENVM)(FHCE) 3911". The first token is
 * the owning department and the parentheses are the other departments the same
 * course counts for, which matters for requirements later but not for the map.
 */
export function primarySubject(subject: string): string {
  return (subject.split('(')[0] ?? subject).trim().toUpperCase();
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function adaptCourse(raw: RawCourse): Course {
  const subject = primarySubject(raw.subject);
  const code = `${subject} ${raw.number}`;
  return {
    id: slug(code),
    code,
    title: raw.title,
    credits: raw.credits ?? 3,
    description: raw.description ?? '',
    cluster: subject,
    requirementIds: [],
    prerequisites: (raw.prerequisites ?? []).map(slug),
    offeredIn: raw.offeredIn?.length ? raw.offeredIn : (['Fall', 'Spring'] as SemesterSeason[]),
    format: 'In person',
    tags: (raw.course_objectives ?? []).slice(0, 4),
    mapPosition: { x: raw.x, y: raw.y },
  };
}

export function adaptCatalog(rows: RawCourse[]): Course[] {
  const seen = new Set<string>();
  const out: Course[] = [];
  for (const r of rows) {
    if (!r.subject || !r.number) continue;
    const c = adaptCourse(r);
    if (seen.has(c.id)) continue;   // cross-listings repeat the same course
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** The departments with the most courses, for the map's filter rail. */
export function topSubjects(courses: Course[], n = 14): string[] {
  const counts = new Map<string, number>();
  for (const c of courses) counts.set(c.cluster, (counts.get(c.cluster) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([s]) => s);
}
