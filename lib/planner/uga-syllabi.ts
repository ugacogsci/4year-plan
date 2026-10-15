import type { IllinoisSyllabus } from './illinois-load';

/**
 * What a UGA course's own published syllabi say, as scripts/illinois/syllabi
 * (--school uga) extracted it from the files instructors upload to UGA's
 * Syllabus System and the Bulletin publishes on each course's page. Same
 * record shape as Illinois's, plus the Bulletin's own course objectives and
 * topical outline as an undated "master-outline" entry where it publishes
 * them. Facts only; the documents stay with their authors.
 *
 * public/uga/syllabi/{SUBJ}.json  { subject, builtAt, courses: { "CHEM 1211": [syllabus, ...] } }
 */
export type SyllabusFacts = IllinoisSyllabus;

interface UgaSyllabusShard {
  subject: string;
  builtAt: string;
  courses: Record<string, SyllabusFacts[]>;
}

const shardCache = new Map<string, Promise<UgaSyllabusShard | null>>();
const SAFE_SUBJECT = /^[A-Z]{4}$/;

/** "chem 1211", "CHEM-1211L", "csci 4720/6720" -> the planner's UGA code form, "CHEM 1211L". */
export function normalizeUgaCourseCode(raw: string): string {
  const m = String(raw ?? '')
    .toUpperCase()
    .match(/^\s*([A-Z]{4})\s*[-_ ]?\s*(\d{4}\s*[A-Z]{0,2}(?:\s*[-/]\s*\d{4}\s*[A-Z]{0,2})*)\s*$/);
  if (!m) return String(raw ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  return `${m[1]} ${m[2].replace(/\s+/g, '')}`;
}

async function shardFor(subject: string): Promise<UgaSyllabusShard | null> {
  if (!shardCache.has(subject)) {
    shardCache.set(
      subject,
      fetch(`/uga/syllabi/${subject}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<UgaSyllabusShard>) : null))
        .catch(() => null),
    );
  }
  return shardCache.get(subject)!;
}

/**
 * A course's syllabi, newest term first, then the Bulletin outline. An empty
 * list means no instructor has uploaded a syllabus for the course and the
 * Bulletin publishes no outline for it, not that the course has none.
 */
export async function loadUgaSyllabi(code: string): Promise<SyllabusFacts[]> {
  const wanted = normalizeUgaCourseCode(code);
  const subject = wanted.split(' ')[0] ?? '';
  if (!SAFE_SUBJECT.test(subject)) return [];
  const shard = await shardFor(subject);
  if (!shard) return [];
  const direct = shard.courses[wanted];
  if (direct) return direct;
  // "CHEM 1211" asked, "CHEM 1211-1211L" shipped (or the lower half of a split-level pair).
  const paired = Object.keys(shard.courses).find((k) => k.startsWith(`${wanted}-`) || k.startsWith(`${wanted}/`));
  return paired ? shard.courses[paired] : [];
}
