/**
 * A transcript, read by the model and matched against the catalog.
 *
 * Two shapes on purpose. The READING is what the model returns: every course
 * line as printed, with the grade and the term and nothing decided. The RECORD
 * is what the student keeps: the same lines with a catalog match and a checkbox
 * each, so the student, not the model, says what counts.
 *
 * Matching lives here rather than in the API route so that the only thing the
 * server does with a transcript is read it once and hand the list back. Nothing
 * about a student is stored server-side, which is the boundary the README draws,
 * and the record itself lives in the browser with the rest of the answers.
 */

export type TranscriptStatus =
  | 'completed'
  | 'in_progress'
  | 'withdrawn'
  | 'failed'
  | 'transfer'
  | 'exam';

export interface TranscriptCourse {
  /** The subject and number as printed, e.g. "MATH 221". */
  code: string;
  title: string | null;
  /** Hours attempted on that line, as printed. Null when the line prints none. */
  credits: number | null;
  grade: string | null;
  term: string | null;
  status: TranscriptStatus;
}

export interface TranscriptExam {
  kind: string;
  exam: string;
  score: string | null;
}

/** What the model returns for one file. */
export interface TranscriptReading {
  institution: string | null;
  courses: TranscriptCourse[];
  exams: TranscriptExam[];
  /** Anything the model could not read, in plain sentences. */
  notes: string[];
}

export interface TranscriptCourseRecord extends TranscriptCourse {
  /** The catalog code this line matched, or null when the catalog has no such course. */
  matched: string | null;
  /** Whether the student wants it counted. Off by default for a W or an F. */
  use: boolean;
}

/** What the student keeps, alongside the rest of their answers. */
export interface TranscriptRecord {
  fileName: string;
  readAt: string;
  institution: string | null;
  /**
   * Whether the transcript is Illinois's own. Another school's codes are that
   * school's: Parkland's BUS 101 is not Illinois's BUS 101, and matching them
   * by code would hand a transfer student credit for courses they never took.
   * Absent on records saved before the check existed, which were all home.
   */
  home?: boolean;
  courses: TranscriptCourseRecord[];
  exams: TranscriptExam[];
  notes: string[];
}

/** The request body the upload component sends to /api/transcript. */
export interface TranscriptUploadBody {
  fileName: string;
  kind: 'pdf' | 'image' | 'text';
  mediaType: string;
  /** Base64, for a PDF or an image. */
  data?: string;
  /** The file's own text, for a text file. */
  text?: string;
}

export const TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024;

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Which of the three request shapes a file takes, or null when it is not a kind we read. */
export function uploadKindFor(file: { name: string; type: string }): TranscriptUploadBody['kind'] | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) return 'image';
  if (file.type.startsWith('text/') || /\.(txt|csv|md)$/.test(name)) return 'text';
  return null;
}

/**
 * "MATH221", "MATH-221" and "MATH 221 A" are all the catalog's MATH 221.
 *
 * Only the subject and the three-digit number are kept, because that is the
 * whole of an Illinois code. Anything that does not fit that shape is returned
 * upper-cased and untouched, so a code from another school stays legible in the
 * review list and simply never matches.
 */
export function normalizeCourseCode(raw: string): string {
  const m = raw.toUpperCase().match(/\b([A-Z]{2,4})\s*-?\s*(\d{3})\b/);
  return m ? `${m[1]} ${m[2]}` : raw.toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Whether a transcript was issued by Illinois itself.
 *
 * Urbana, Champaign or UIUC settles it. "University of Illinois" alone does
 * not, because Chicago and Springfield are different universities with their
 * own catalogs, and "Illinois State" and "Illinois Central College" are other
 * schools again. No institution at all is read as home: the student put it
 * into an Illinois planner, and the codes either match the catalog or they do
 * not.
 */
export function isHomeTranscript(institution: string | null): boolean {
  if (!institution || !institution.trim()) return true;
  const name = institution.toLowerCase();
  if (/\b(urbana|champaign|uiuc)\b/.test(name)) return true;
  if (/university of illinois/.test(name) && !/\b(chicago|springfield|uic|uis)\b/.test(name)) return true;
  return false;
}

/** Whether a line's hours will count toward the degree. */
export function earns(status: TranscriptStatus): boolean {
  return status === 'completed' || status === 'transfer' || status === 'exam' || status === 'in_progress';
}

/**
 * The reading, matched against the catalog and defaulted the way an advisor
 * would: a passing grade counts, a course in progress counts because it will
 * be done before the first planned term, and a W or an F is listed but off.
 */
export function matchTranscript(
  reading: TranscriptReading,
  fileName: string,
  has: (code: string) => boolean,
): TranscriptRecord {
  const home = isHomeTranscript(reading.institution);
  const courses: TranscriptCourseRecord[] = reading.courses.map((c) => {
    const code = normalizeCourseCode(c.code);
    const matched = home && has(code) ? code : null;
    return { ...c, code, matched, use: matched !== null && earns(c.status) };
  });
  const notes = [...reading.notes];
  if (!home) {
    notes.unshift(
      `This transcript is from ${reading.institution}. Its course codes are that school's, so none were matched to Illinois courses: Illinois decides what transfers and as which course. Once your Illinois record or your advisor names the equivalents, type them as Illinois codes in the box below and they will count.`,
    );
  }
  return {
    fileName,
    readAt: new Date().toISOString(),
    institution: reading.institution,
    home,
    courses,
    exams: reading.exams,
    notes,
  };
}

/** The codes the planner should treat as already earned. */
export function transcriptCodes(record: TranscriptRecord | null | undefined): string[] {
  if (!record) return [];
  const out = new Set<string>();
  for (const c of record.courses) if (c.use && c.matched) out.add(c.matched);
  return [...out];
}

/** One sentence about what was read, for the summary line over the list. */
export function describeTranscript(record: TranscriptRecord, catalogName: string): string {
  const total = record.courses.length;
  const counted = record.courses.filter((c) => c.use && c.matched).length;
  const inProgress = record.courses.filter((c) => c.use && c.matched && c.status === 'in_progress').length;
  const withdrawn = record.courses.filter((c) => c.status === 'withdrawn').length;
  const failed = record.courses.filter((c) => c.status === 'failed').length;
  const unmatched = record.courses.filter((c) => !c.matched).length;
  const line = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [`${counted} count toward your plan${inProgress ? ` (${inProgress} in progress)` : ''}`];
  if (withdrawn) parts.push(`${withdrawn} withdrawn`);
  if (failed) parts.push(`${failed} failed`);
  if (unmatched) {
    parts.push(
      record.home === false
        ? `${unmatched} from ${record.institution ?? 'another school'}, not matched to Illinois courses`
        : `${unmatched} not in the ${catalogName} catalog`,
    );
  }
  return `${line(total, 'line')} read from ${record.fileName}. ${parts.join(', ')}.`;
}
