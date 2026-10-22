/**
 * A transcript, read by the model and matched against the catalog.
 *
 * Two shapes on purpose. The READING is what the model returns: every course
 * line as printed, with the grade and the term and nothing decided. The RECORD
 * is what the student keeps: the same lines with a catalog match, a way of
 * counting and a switch each, so the student, not the model, says what counts.
 *
 * Matching lives here rather than in the API route so that the only thing the
 * server does with a transcript is read it once and hand the list back. Nothing
 * about a student is stored server-side, which is the boundary the README draws,
 * and the record itself lives in the browser with the rest of the answers.
 *
 * Most students who upload something are not first-years with an empty record:
 * they hold credit from another college, an Illinois record with a transfer
 * block on it, a Transfer Evaluation Report, or a screenshot of a course list.
 * Each of those is read the same way and counted by the same three rules: a
 * line that is an Illinois course counts as that course; a line another
 * school taught counts as the Illinois course the document prints for it, or
 * the one the catalog's titles suggest and the student confirms, or else as
 * hours toward the total; a line the document says earns nothing counts as
 * nothing. Illinois's own words on the subject: Transferology is the estimate
 * and the university's Transfer Evaluation Report is the decision
 * (admissions.illinois.edu/transferring-credit/), so a proposal here is never
 * more than a proposal, and it says so on the line.
 */

import { genEdTagsFromText, guideSchool, iaiArea, proposeEquivalents, type CatalogLite, type EquivalentProposal, type TransferGenEdGuide } from './transfer-match';
import type { GenEdCredit, PlanningContext } from './autoplan';
import {
  ILLINOIS_GENED_TRANSFER,
  ILLINOIS_TRANSFER_POLICIES,
  ILLINOIS_TRANSFERRING_CREDIT,
  IAI_ASSOCIATE_DEGREES,
  IAI_GECC_EXCEPTIONS_GUIDE,
  UGA_TRANSFER_GUIDE,
  UGA_TRANSFER_PORTAL,
  isDGrade,
  isGeneralEducationSubject,
  isPhysicalActivity,
  isTechnicalCollege,
  isVocational,
  ugaCoreArea,
  ugaDesignation,
  ugaLookup,
  ugaSchoolEntry,
  UGA_RENUMBERED,
  type TransferBasis,
  type UgaDesignation,
  type UgaTransferTable,
} from './transfer-official';

export type { TransferBasis } from './transfer-official';

export type TranscriptStatus =
  | 'completed'
  | 'in_progress'
  | 'withdrawn'
  | 'failed'
  | 'transfer'
  | 'exam'
  /** The document itself says the line earns nothing: developmental, repeated, not transferable. */
  | 'no_credit';

/** What kind of document was read. Decides how its codes are treated. */
export type DocumentKind = 'transcript' | 'degree_audit' | 'transfer_report' | 'course_list' | 'other';

export interface TranscriptCourse {
  /** The subject and number as printed, e.g. "MATH 221", or another school's "MAT 128". */
  code: string;
  title: string | null;
  /** Hours attempted on that line, as printed. Null when the line prints none. */
  credits: number | null;
  grade: string | null;
  term: string | null;
  status: TranscriptStatus;
  /**
   * The school that taught the course, when the document says and it is not
   * the issuer: the transfer block on an Illinois record names Parkland, an
   * evaluation report names the sending school. Null when it is the issuer.
   */
  from?: string | null;
  /**
   * The Illinois course the document itself prints as this line's
   * equivalent: an evaluation report's right-hand column, a degree audit's
   * "(Harper College MTH 200)" note read the other way. Null when none.
   */
  equivalent?: string | null;
  /** The Illinois hours printed beside the equivalent, when they differ from the line's own. */
  equivalentCredits?: number | null;
  /** The Illinois Articulation Initiative code printed beside the line, e.g. "M1 900". */
  iai?: string | null;
  /** Gen-ed categories the document itself prints beside the line ("Gen Ed: SBS"), as printed. */
  genEdText?: string | null;
  /**
   * The unit of this line's hours when its own school's part of the upload
   * states it: a DePaul transcript in quarter hours read together with a
   * semester school's. Null when not stated; the document's unit applies.
   */
  hoursUnit?: 'semester' | 'quarter' | null;
}

export interface TranscriptExam {
  kind: string;
  exam: string;
  score: string | null;
  /** A subscore the document prints: the AB subscore of AP Calculus BC, the aural subscore of AP Music Theory. */
  subscore?: string | null;
}

/** What the model returns for one file, or for several read together. */
export interface TranscriptReading {
  institution: string | null;
  kind: DocumentKind;
  /**
   * 'quarter' when the document's hours are quarter hours. Illinois counts in
   * semester hours, and a quarter-hour transcript read as semester hours
   * overstates a transfer by half again.
   */
  hoursUnit?: 'semester' | 'quarter' | null;
  courses: TranscriptCourse[];
  exams: TranscriptExam[];
  /** Anything the model could not read, in plain sentences. */
  notes: string[];
  /**
   * Degrees, certificates and completions the document says were awarded,
   * as printed: "Associate in Arts", "IAI GECC Completed". Empty or absent
   * when it prints none.
   */
  credentials?: string[];
}

/**
 * A completed Illinois Articulation Initiative General Education Core
 * Curriculum on the record, or an Illinois associate degree that carries it.
 *
 * Illinois Admissions: completing the IAI GECC means a student's general
 * education requirements are met on transfer, while campus, college and major
 * graduation requirements beyond it still apply
 * (admissions.illinois.edu/transfer-admission-policies/). The categories it
 * is counted for are the campus ones the GECC itself covers, at the campus
 * minimum; Advanced Composition, Cultural Studies, Quantitative Reasoning II
 * and the language requirement stay in the plan, as the Illinois community
 * colleges' own UIUC transfer guides list them as outside the package.
 */
export interface GeccCompletion {
  /** What the document shows: the GECC marked complete, or an Illinois A.A. or A.S. */
  kind: 'gecc' | 'aa' | 'as';
  /** The document's own words. */
  evidence: string;
  school: string | null;
  /** Campus categories counted as met, and the hours each stands for. */
  meets: Array<{ category: string; tags: string[]; hours: number }>;
  /** Campus requirements still planned. */
  stillToDo: string[];
  /** One plain paragraph for the record's notes. */
  text: string;
  sources: string[];
}

/** How one line counts toward the degree. */
export type CountsAs = 'course' | 'hours' | 'none';

export interface TranscriptCourseRecord extends TranscriptCourse {
  /** The catalog code this line counts as, or null when it counts as hours or not at all. */
  matched: string | null;
  /** Where the match came from. 'official' is the university's own equivalency list (UGA's). */
  matchedBy: 'code' | 'printed' | 'official' | 'proposal' | 'student' | null;
  /** Whether the student wants it counted. Off for a W, an F, and a line that earns nothing. */
  use: boolean;
  /** As the matched course, as hours toward the total, or not at all. */
  counts: CountsAs;
  /** Illinois courses this line could be, best first, for the student to pick from. Only for another school's lines. */
  proposals?: EquivalentProposal[];
  /** A second course the line also counts as: the lab folded into a five-hour chemistry course. */
  also?: string[];
  /**
   * The catalog hours of the Illinois course(s) the line counts as, so the
   * hours the line actually earned can be told apart from them. A 5-hour
   * Parkland calculus that becomes MATH 221 (4) earns one more elective hour;
   * a 3-hour sociology that becomes SOC 100 (4) earns three, not four.
   */
  illinoisCredits?: number | null;
  /** The hours as printed, when they were converted from quarter hours. */
  printedCredits?: number | null;
  /**
   * Illinois gen-ed categories this line meets without an Illinois course:
   * from a published guide (Parkland's), or printed on the document. Counted
   * only while the line counts as hours.
   */
  genEdTags?: string[];
  /** Where genEdTags came from, for the line's note. */
  genEdSource?: string | null;  /** Why the line counts as the course it counts as, when that is not the line alone ("with ENG 102: Composition I"). */
  matchNote?: string | null;
  /**
   * Hours assumed for a line the document prints none for (a portal
   * screenshot of dual-credit courses). Three, the usual community-college
   * course, which can understate a four-hour lab science and cannot
   * overstate a three-hour course; the line says so until the student edits it.
   */
  assumedCredits?: number | null;
  /**
   * UGA's designation for the line, when it is credit but not one UGA
   * course: "MATH 1GXX" (core elective), "HIST 1GHX" (core elective that
   * also meets the U.S. history requirement), "ARTS 3TXX" (elective credit
   * only) or "NTFR" (does not transfer).
   */
  designation?: string | null;
  /** The UGA core area a core elective usually fills, for the line's note. */
  coreArea?: string | null;
  /** What the line became, why, and where that answer came from. */
  basis?: TransferBasis | null;
  /** A word about the grade: a D transfers, but a program may ask for a C. */
  gradeNote?: string | null;
  /**
   * True when the student said the line is not the course it "may be"
   * (proposals[0]): it stays hours, and the board books that course where
   * the degree needs it (transfer-maybe.ts).
   */
  maybeDeclined?: boolean;
}

/** What the student keeps, alongside the rest of their answers. */
export interface TranscriptRecord {
  schoolId?: 'uga' | 'illinois';
  fileName: string;
  readAt: string;
  institution: string | null;
  kind?: DocumentKind;
  /**
   * Whether the document is Illinois's own. Another school's codes are that
   * school's: Parkland's BUS 101 is not Illinois's BUS 101, and matching them
   * by code would hand a transfer student credit for courses they never took.
   * Absent on records saved before the check existed, which were all home.
   */
  home?: boolean;
  /** Every file read into this record, first first. */
  files?: string[];
  courses: TranscriptCourseRecord[];
  exams: TranscriptExam[];
  notes: string[];
  /** A completed IAI GECC (or an Illinois A.A./A.S. carrying it), when the document shows one. */
  gecc?: GeccCompletion | null;
  /**
   * The term ("Fall 2026") whose in-progress classes the student said are
   * theirs, on the board's current-semester column (current-term.ts). Absent
   * until they answer, and on every record from before the column; a new
   * upload is a new record, so its classes are asked about again.
   */
  currentConfirmed?: string;
}

/** One file of the upload body. */
export interface TranscriptUploadFile {
  fileName: string;
  kind: 'pdf' | 'image' | 'text';
  mediaType: string;
  /** Base64, for a PDF or an image. */
  data?: string;
  /** The file's own text, for a text file. */
  text?: string;
}

/**
 * The request body the upload component sends to /api/transcript. One file,
 * or several read together so a course list that spans two screenshots is
 * one list with one institution.
 */
export type TranscriptUploadBody = (TranscriptUploadFile | { files: TranscriptUploadFile[] }) & { schoolId?: 'uga' | 'illinois' };

export const TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024;
export const TRANSCRIPT_MAX_FILES = 8;

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Which of the three request shapes a file takes, or null when it is not a kind we read. */
export function uploadKindFor(file: { name: string; type: string }): TranscriptUploadFile['kind'] | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) return 'image';
  if (file.type.startsWith('text/') || /\.(txt|csv|md)$/.test(name)) return 'text';
  return null;
}

/**
 * "MATH221", "MATH-221" and "MATH 221 A" are all the catalog's MATH 221.
 *
 * Only the subject and the number are kept: three digits for an Illinois code,
 * and a four-digit or letter-suffixed number from another school is kept as
 * that school prints it, upper-cased, so it stays legible in the review list.
 * Illinois's indirect credit, "HIST 1--", is a code too and is kept whole.
 */
export function normalizeCourseCode(raw: string): string {
  const upper = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const indirect = upper.match(/\b([A-Z]{2,5})\s*-?\s*(\d)\s*(?:--|XX|\*\*)/);
  if (indirect) return `${indirect[1]} ${indirect[2]}--`;
  const m = upper.match(/\b([A-Z]{2,5})\s*-?\s*(\d{3,4}[A-Z]{0,2})\b/);
  return m ? `${m[1]} ${m[2]}` : upper;
}

/** "MATH 1--", "CS 1--": hours in a subject rather than a class. */
export function isIndirectCode(code: string): boolean {
  return /^[A-Z]{2,5} \d--$/.test(code);
}

/**
 * "FA24" and "FALL 2024" and "Fall Semester 2024" are one term. Written the
 * way the board writes its own labels, so a line can be placed against it.
 */
export function normalizeTerm(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const short = s.match(/^(FA|SP|SU|WI)\s*-?\s*(\d{2}|\d{4})$/i);
  if (short) {
    const season = { FA: 'Fall', SP: 'Spring', SU: 'Summer', WI: 'Winter' }[short[1].toUpperCase() as 'FA' | 'SP' | 'SU' | 'WI'];
    const year = short[2].length === 2 ? 2000 + Number(short[2]) : Number(short[2]);
    return `${season} ${year}`;
  }
  const long = s.match(/\b(fall|spring|summer|winter)\b[^\d]*(\d{4})/i);
  if (long) return `${long[1][0].toUpperCase()}${long[1].slice(1).toLowerCase()} ${long[2]}`;
  const yearFirst = s.match(/(\d{4})[^a-z]*\b(fall|spring|summer|winter)\b/i);
  if (yearFirst) return `${yearFirst[2][0].toUpperCase()}${yearFirst[2].slice(1).toLowerCase()} ${yearFirst[1]}`;
  return s;
}

/**
 * Whether a document, or the school named on a line, is Illinois itself.
 *
 * Urbana, Champaign or UIUC settles it. "University of Illinois" alone does
 * not, because Chicago and Springfield are different universities with their
 * own catalogs, and "Illinois State" and "Illinois Central College" are other
 * schools again. No institution at all is read as home: the student put it
 * into an Illinois planner, and the codes either match the catalog or they do
 * not.
 */
export function isHomeTranscript(institution: string | null | undefined, schoolId: 'uga' | 'illinois' = 'illinois'): boolean {
  if (!institution || !institution.trim()) return true;
  const name = institution.toLowerCase();
  if (schoolId === 'uga') return /university of georgia|\buga\b/.test(name);
  if (/\b(urbana|champaign|uiuc)\b/.test(name)) return true;
  if (/university of illinois/.test(name) && !/\b(chicago|springfield|uic|uis)\b/.test(name)) return true;
  return false;
}

/** Whether a line's hours will count toward the degree. */
export function earns(status: TranscriptStatus): boolean {
  return status === 'completed' || status === 'transfer' || status === 'exam' || status === 'in_progress';
}

/**
 * A course below college level. Community colleges number them 0xx or 0xxx
 * ("MATH 0482 Foundations for College Math"), and Illinois transfers none of
 * them. The number is the rule; the title is a second reading of the same
 * fact for a school that numbers differently.
 */
export function isDevelopmental(code: string, title: string | null): boolean {
  const number = code.match(/\b(\d{3,4})[A-Z]{0,2}$/)?.[1];
  if (number && Number(number[0]) === 0) return true;
  // "Developmental Psychology" and "Developmental Biology" are college
  // courses: the word marks a remedial course only before a basic subject.
  return /\b(developmental (reading|writing|english|math\w*|algebra|studies|composition|education)|remedial|foundations? for college|basic (math|writing|algebra)|pre-?college|college prep)\b/i.test(title ?? '');
}

/**
 * Several files read as one document, when the student uploads a course list
 * that spans two screenshots, or a transcript and its second page.
 *
 * Lines are kept in file order; a line printed on both files (the second
 * screenshot overlapping the first) appears once. The institution is the
 * first one any file names, and the kind the most specific.
 */
export function mergeReadings(readings: TranscriptReading[]): TranscriptReading {
  const rank: Record<DocumentKind, number> = { transfer_report: 4, degree_audit: 3, transcript: 2, course_list: 1, other: 0 };
  const seen = new Set<string>();
  const courses: TranscriptCourse[] = [];
  for (const reading of readings) {
    for (const course of reading.courses) {
      const key = `${normalizeCourseCode(course.code)}|${normalizeTerm(course.term) ?? ''}|${course.grade ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      courses.push(course);
    }
  }
  const exams = readings.flatMap((r) => r.exams).filter((e, i, all) => all.findIndex((o) => o.kind === e.kind && o.exam === e.exam) === i);
  return {
    institution: readings.map((r) => r.institution).find((i) => i && i.trim()) ?? null,
    kind: readings.map((r) => r.kind).sort((a, b) => rank[b] - rank[a])[0] ?? 'other',
    courses,
    exams,
    notes: readings.flatMap((r) => r.notes),
    credentials: [...new Set(readings.flatMap((r) => r.credentials ?? []))],
  };
}

/**
 * The reading, matched against the catalog and defaulted the way an advisor
 * would.
 *
 * An Illinois line counts as its course. Another school's line counts as the
 * Illinois course the document prints for it; failing that, as the course the
 * catalog's own titles make the likely equivalent, offered as a proposal the
 * student confirms; failing that, as hours toward the total, which is what
 * Illinois grants any transferable course at minimum. A passing grade counts,
 * a course in progress counts because it will be done before the first
 * planned term, and a W, an F or a line the document says earns nothing is
 * listed but off.
 */
export function matchTranscript(
  reading: TranscriptReading,
  fileName: string,
  catalog: CatalogLite[],
  files: string[] = [fileName],
  /** Published guides of which Illinois gen-ed categories another school's courses meet. */
  guide: TransferGenEdGuide | null = null,
  schoolId: 'uga' | 'illinois' = 'illinois',
  /** UGA's own equivalency list for the schools the reading names (transfer-official.ts). */
  ugaTable: UgaTransferTable | null = null,
): TranscriptRecord {
  const known = new Map(catalog.map((c) => [c.code, c]));
  const uga = schoolId === 'uga';
  /**
   * A line that carries a UGA designation, from the document or from UGA's
   * list: credit toward a core area, elective hours, or nothing.
   */
  const designated = (base: TranscriptCourseRecord, d: UgaDesignation, off: boolean, basisFrom: TransferBasis['from'], where: string, source: string, checked: string | null = null): TranscriptCourseRecord => {
    if (d.kind === 'none') {
      return {
        ...base,
        status: 'no_credit',
        counts: 'none',
        use: false,
        designation: 'NTFR',
        basis: { from: basisFrom, badge: 'none', text: `${where} marks it NTFR: it does not transfer to UGA.`, source, checked },
      };
    }
    const area = d.kind === 'elective' ? null : ugaCoreArea(d.subject);
    const text =
      d.kind === 'elective'
        ? `${where} gives it ${d.code}: elective hours toward your total, not a specific requirement. After you enroll, the department can be asked to assign a course.`
        : `${where} gives it ${d.code}: a core elective${area ? `, usually in ${area}` : ''}${d.kind === 'core-us-history' ? ', and it meets UGA\'s U.S. history requirement' : ''}. It counts as hours, not as one UGA course; confirm the core area with your advisor.`;
    return {
      ...base,
      counts: off ? 'none' : 'hours',
      use: !off,
      designation: d.code,
      coreArea: area,
      basis: { from: basisFrom, badge: d.kind === 'elective' ? 'elective' : 'core', text, source, checked },
    };
  };
  /**
   * Whose codes the document prints.
   *
   * An Illinois record prints Illinois codes everywhere on it, including the
   * transfer block: "MATH 221 TR" under a Parkland heading is Illinois's
   * MATH 221, already evaluated. A Transfer Evaluation Report is issued by
   * Illinois but its left-hand column is the sending school's codes, with the
   * Illinois course in the right-hand column. A course list with no school
   * named on it is judged by its codes: when most of them are not in the
   * catalog, they are another school's.
   */
  const issuerIsHome = isHomeTranscript(reading.institution, schoolId);
  const quarter = reading.hoursUnit === 'quarter';
  const creditsOfCode = (code: string | null | undefined): number | null => (code ? known.get(code)?.credits ?? null : null);
  const knownShare = reading.courses.length > 0
    ? reading.courses.filter((c) => known.has(normalizeCourseCode(c.code)) || isIndirectCode(normalizeCourseCode(c.code))).length / reading.courses.length
    : 1;
  const home = reading.institution ? issuerIsHome : knownShare >= 0.5;
  const codesAreIllinois = home && reading.kind !== 'transfer_report';
  const mixedQuarter = new Set<string>();
  const courses: TranscriptCourseRecord[] = reading.courses.map((raw) => {
    // Quarter hours are two-thirds of a semester hour, the usual conversion;
    // the Transfer Evaluation Report shows the figure your university settles on.
    const lineQuarter = raw.hoursUnit === 'quarter' || (quarter && raw.hoursUnit !== 'semester');
    if (lineQuarter && !quarter) mixedQuarter.add(raw.from ?? reading.institution ?? 'one school');
    const c = lineQuarter && raw.credits !== null ? { ...raw, credits: Math.round(raw.credits * (2 / 3) * 100) / 100 } : raw;
    const code = normalizeCourseCode(c.code);
    const term = normalizeTerm(c.term);
    const taughtElsewhere = codesAreIllinois ? false : c.from ? !isHomeTranscript(c.from, schoolId) : !home;
    const base: TranscriptCourseRecord = {
      ...c,
      code,
      term,
      // Every line says which school taught it, so a record merged from an
      // Illinois history and a Parkland transcript can still tell its lines
      // apart. The document's own school is the default for its lines.
      from: c.from ?? (taughtElsewhere ? reading.institution ?? 'another school' : null),
      equivalent: c.equivalent ? normalizeCourseCode(c.equivalent) : null,
      matched: null,
      matchedBy: null,
      use: false,
      counts: 'none',
      ...(lineQuarter && raw.credits !== null ? { printedCredits: raw.credits } : {}),
    };
    const off = !earns(c.status);

    // The document's own word: an evaluation report or an audit that prints
    // the Illinois equivalent beside the line. "HIST 1--" is hours.
    if (base.equivalent) {
      const printed = uga ? ugaDesignation(c.equivalent) : null;
      if (printed) return designated(base, printed, off, 'document', 'Your document', UGA_TRANSFER_GUIDE);
      if (isIndirectCode(base.equivalent)) {
        return { ...base, counts: off ? 'none' : 'hours', use: !off };
      }
      if (known.has(base.equivalent)) {
        return { ...base, matched: base.equivalent, matchedBy: 'printed', illinoisCredits: creditsOfCode(base.equivalent), counts: off ? 'none' : 'course', use: !off };
      }
    }
    if (isIndirectCode(code) && !taughtElsewhere) {
      return { ...base, counts: off ? 'none' : 'hours', use: !off };
    }
    if (!taughtElsewhere) {
      // UGA's own record prints its evaluation of a transfer course: a UGA
      // course, or a designation the catalog does not list.
      const own = uga ? ugaDesignation(c.code) : null;
      if (own) return designated(base, own, off, 'document', 'Your UGA record', UGA_TRANSFER_GUIDE);
      if (known.has(code)) {
        const fromElsewhere = c.from && !isHomeTranscript(c.from, schoolId);
        return {
          ...base,
          matched: code,
          matchedBy: 'code',
          illinoisCredits: creditsOfCode(code),
          counts: off ? 'none' : 'course',
          use: !off,
          ...(fromElsewhere ? { basis: { from: 'document' as const, badge: 'course' as const, text: `Your ${uga ? 'UGA' : 'Illinois'} record lists it as ${code}.`, source: null } } : {}),
        };
      }
      // An Illinois record with a code the catalog no longer lists: the hours
      // are real, the course is not something the plan can name.
      return { ...base, counts: off || c.credits === null ? 'none' : 'hours', use: !off && c.credits !== null };
    }
    if (isDevelopmental(code, c.title) || c.status === 'no_credit') {
      return {
        ...base,
        status: 'no_credit',
        counts: 'none',
        use: false,
        basis: c.status === 'no_credit'
          ? { from: 'document', badge: 'none', text: 'The document says this line earns no credit.', source: null }
          : { from: 'rule', badge: 'none', text: `A course below college level (learning support or remedial) does not transfer to ${uga ? 'UGA' : 'Illinois'}.`, source: uga ? UGA_TRANSFER_GUIDE : ILLINOIS_TRANSFER_POLICIES },
      };
    }
    const gradeNote = isDGrade(c.grade) && !off
      ? uga
        ? 'A D in a transferable course still transfers to UGA, but your major may require a C or better in it.'
        : 'Illinois\'s transfer pages do not say how a D counts; it is counted here, but your program may require a C or better.'
      : null;
    const withGrade = gradeNote ? { gradeNote } : {};
    if (uga) {
      const school = c.from ?? reading.institution;
      const hit = ugaLookup(ugaTable, school, code);
      if (hit) {
        const where = `UGA's equivalency list for ${hit.entry.name}`;
        const designations = hit.results.map((r) => ugaDesignation(r)).filter((d): d is UgaDesignation => d !== null);
        const courseResults = hit.results.filter((r) => !ugaDesignation(r));
        // A list that still names a UGA course by its older number (COMM
        // 1100 for Introduction to Public Speaking, now COMM 1110) means the
        // course the catalog lists today.
        const renumbered: string[] = [];
        const current = (r: string) => {
          const n = normalizeCourseCode(r);
          const now = UGA_RENUMBERED[n]?.now;
          if (known.has(n) || !now || !known.has(now)) return n;
          renumbered.push(`${n} is the older number of UGA's ${UGA_RENUMBERED[n].title}, now ${now}`);
          return now;
        };
        const held = courseResults.map(current).filter((r) => known.has(r));
        if (held.length > 0) {
          const [first, ...also] = held;
          const extra = designations.filter((d) => d.kind !== 'none').map((d) => d.code);
          return {
            ...base,
            ...withGrade,
            matched: first,
            matchedBy: 'official',
            illinoisCredits: held.reduce((sum, h) => sum + (creditsOfCode(h) ?? 0), 0),
            counts: off ? 'none' : 'course',
            use: !off,
            ...(also.length ? { also } : {}),
            basis: {
              from: 'official',
              badge: 'course',
              text: `${where} makes it UGA ${courseResults.join(' + ')}${extra.length ? `; the list also shows ${extra.join(', ')} for it` : ''}.${renumbered.length ? ` ${[...new Set(renumbered)].join('; ')}.` : ''}${missingNote(courseResults.map(current).filter((r) => !known.has(r)), held)}`,
              source: hit.file.source,
              checked: hit.file.readAt,
            },
          };
        }
        if (courseResults.length > 0) {
          return {
            ...base,
            ...withGrade,
            counts: off ? 'none' : 'hours',
            use: !off,
            basis: { from: 'official', badge: 'not-evaluated', text: `${where} makes it UGA ${courseResults.join(' + ')}, which this planner's catalog does not list, so it counts as hours.`, source: hit.file.source, checked: hit.file.readAt },
          };
        }
        const d = designations.find((x) => x.kind !== 'none') ?? designations[0];
        if (d) return { ...designated(base, d, off, 'official', where, hit.file.source, hit.file.readAt), ...withGrade };
      }
      const entry = ugaSchoolEntry(ugaTable?.index, school);
      const prefix = code.split(' ')[0] ?? '';
      if (isTechnicalCollege(school, entry) && !isGeneralEducationSubject(prefix)) {
        return {
          ...base,
          counts: 'none',
          use: false,
          basis: { from: 'rule', badge: 'none', text: 'UGA accepts only general-education courses from a technical college, and this one is not on UGA\'s list as one, so it does not count. Change it if UGA evaluates it otherwise.', source: UGA_TRANSFER_GUIDE },
        };
      }
      return {
        ...base,
        ...withGrade,
        counts: off ? 'none' : 'hours',
        use: !off,
        basis: entry
          ? { from: 'none', badge: 'not-evaluated', text: `UGA's equivalency list for ${entry.name} (checked ${entry.readAt}) does not include this course, so it counts as hours until UGA evaluates it.`, source: UGA_TRANSFER_PORTAL, checked: entry.readAt }
          : { from: 'none', badge: 'not-evaluated', text: `This planner does not hold UGA's equivalency list for ${school ?? 'this school'}; it counts as hours until UGA evaluates it. You can look it up in UGA's Transfer Equivalency Search.`, source: UGA_TRANSFER_PORTAL },
      };
    }
    if (isVocational(code, c.title)) {
      return {
        ...base,
        counts: 'none',
        use: false,
        basis: { from: 'rule', badge: 'none', text: 'This looks like a vocational (career-program) course, and Illinois says vocational courses do not transfer, so it probably does not count. Change it if Illinois evaluates it otherwise.', source: ILLINOIS_TRANSFER_POLICIES },
      };
    }
    // Guesses below "possible" are hidden: "Program Design II" offered an
    // architecture course. The student can still pick any course by hand.
    const proposals = proposeEquivalents({ code, title: c.title, credits: c.credits }, catalog).filter((p) => p.confidence !== 'low');
    const best = proposals[0];
    if (best && best.confidence === 'high') {
      const also = proposals.filter((p) => p.pairedWith === best.code).map((p) => p.code);
      const illinoisCredits = [best.code, ...also].reduce((sum, code) => sum + (creditsOfCode(code) ?? 0), 0);
      return {
        ...base,
        ...withGrade,
        matched: best.code,
        matchedBy: 'proposal',
        proposals,
        illinoisCredits,
        counts: off ? 'none' : 'course',
        use: !off,
        ...(also.length ? { also } : {}),
        basis: { from: 'none', badge: 'course', text: `Counted as ${[best.code, ...also].join(' + ')}, the planner's likely match for this course. Illinois's Transfer Course Evaluation Report (or Transferology) decides.`, source: ILLINOIS_TRANSFERRING_CREDIT },
      };
    }
    return {
      ...base,
      ...withGrade,
      proposals,
      counts: off ? 'none' : 'hours',
      use: !off,
      basis: {
        from: 'none',
        badge: 'not-evaluated',
        text: best
          ? `Not yet evaluated by Illinois: it may be ${best.code}. It counts as hours until you confirm the course below (from Transferology or your Transfer Course Evaluation Report).`
          : 'Not yet evaluated by Illinois: it counts as hours toward your total until Illinois evaluates it.',
        source: ILLINOIS_TRANSFERRING_CREDIT,
      },
    };
  });
  applyTransferCaps(courses, schoolId);

  // A document that prints no hours (a portal list of dual-credit courses)
  // still earns them: each such line from another school is counted at three
  // hours until the student says otherwise.
  let assumed = 0;
  for (const line of courses) {
    const foreign = line.from ? !isHomeTranscript(line.from, schoolId) : false;
    if (!foreign || line.credits !== null || line.equivalentCredits != null || !earns(line.status)) continue;
    if (schoolId !== 'illinois') continue;
    line.assumedCredits = 3;
    assumed += 1;
  }

  const notes = [...reading.notes];
  if (assumed > 0) {
    notes.push(`${assumed} ${assumed === 1 ? 'line prints' : 'lines print'} no credit hours, so each is counted as 3 hours, the usual community-college course. A 4-hour lab science counts one short until you correct it; your transcript from that college shows the real hours.`);
  }
  // Gen-ed categories for lines from another school: the published guide
  // first, then what the document prints beside the line.
  const tagsOf = (code: string) => catalog.find((c) => c.code === code)?.tags ?? [];
  for (const line of courses) {
    const foreign = line.from ? !isHomeTranscript(line.from, schoolId) : false;
    if (!foreign || schoolId !== 'illinois') continue;
    const school = guideSchool(guide, line.from);
    const entry = school?.courses[line.code];
    const printed = genEdTagsFromText(line.genEdText);
    // The IAI code printed beside the line, when nothing more specific says
    // which category it meets: iTransfer's GECC areas, read against the
    // catalog's categories (H3 literature is Literature & the Arts).
    const iai = !entry && printed.length === 0 ? iaiArea(guide, line.iai) : null;
    const iaiSource = guide?.iai?.source ?? null;
    if (iai && iai.tags.length === 0) {
      if (iai.why && line.counts === 'hours' && line.basis?.badge === 'not-evaluated') {
        line.basis = { from: 'rule', badge: 'elective', text: `Its IAI code ${iai.code} is ${iai.area}: ${iai.why}.`, source: iaiSource, checked: guide?.iai?.checked ?? null };
      }
      continue;
    }
    const tags = entry ? entry.tags : printed.length > 0 ? printed : iai?.tags ?? [];
    if (tags.length === 0) continue;
    line.genEdTags = tags;
    const expired = guideExpired(guide?.effective ?? null, reading);
    line.genEdSource = entry
      ? `${guide?.title ?? 'the published guide'} (${guide?.effective ?? 'current'}${expired ? ', expired; the newest edition this planner holds' : ''})`
      : iai ? `its IAI code ${iai.code} (${iai.area})` : 'printed on the document';
    // A likely Illinois course is kept only when it meets the same categories
    // the guide says the line meets; otherwise the line counts as hours with
    // the guide's categories, which is what Illinois has said about it.
    if (entry && line.matchedBy === 'proposal' && line.matched) {
      const courseTags = new Set([line.matched, ...(line.also ?? [])].flatMap(tagsOf));
      const same = courseTags.size === tags.length && tags.every((t) => courseTags.has(t));
      if (!same) Object.assign(line, { matched: null, matchedBy: null, counts: line.use ? 'hours' : 'none', also: undefined, illinoisCredits: null });
    }
    if (iai && line.counts === 'hours' && line.basis) {
      const maybe = line.proposals?.[0];
      line.basis = {
        from: 'rule',
        badge: 'core',
        checked: guide?.iai?.checked ?? null,
        text: `Its IAI code ${iai.code} (${iai.area}) usually counts for Illinois's ${tags.join(', ')}, so it counts as hours toward that category, not as one Illinois course. Illinois applies IAI courses to its gen eds one at a time; your Transfer Course Evaluation Report decides.${maybe ? ` It may also be ${maybe.code}; pick that below if your report says so.` : ''}`,
        source: iaiSource,
      };
    } else if (line.counts === 'hours' && line.basis) {
      line.basis = {
        ...line.basis,
        // A published guide (Illinois admissions with the college) is an
        // answer about the categories, not about a course.
        from: entry ? 'official' : 'document',
        badge: 'core',
        checked: null,
        text: entry
          ? `${school?.name ?? 'The college'}'s guide to Illinois gen eds (${guide?.effective ?? 'current'}${expired ? ', expired' : ''}) lists it for ${tags.join(', ')}; it counts as hours toward those categories, not as one Illinois course.`
          : `The document lists it for ${tags.join(', ')}; it counts as hours toward those categories.`,
        source: entry ? guide?.source ?? null : null,
      };
    }
  }
  // Composition I is the two-course sequence. With both courses from another
  // school, the first counts as RHET 105 and the second as hours; with one,
  // it is hours and Composition I is still to do.
  // The first and second composition courses, by title or by the number
  // nearly every Illinois community college gives them (ENG 101 and 102,
  // ENGLI 1101 and 1102): Joliet's "Rhetoric" and "Critical Writing and
  // Research" are the same two courses under other names.
  const foreignLine = (c: TranscriptCourseRecord) => c.use && c.matchedBy !== 'code' && c.matchedBy !== 'printed' && c.matchedBy !== 'official' && Boolean(c.from) && !isHomeTranscript(c.from, schoolId);
  const writingTitle = /\b(composition|rhetoric|writing|english)\b/i;
  const isCompOne = (c: TranscriptCourseRecord) =>
    (c.proposals ?? [])[0]?.code === 'RHET 105' || (/^(ENG|ENGL|ENGLI|WRT|WRIT|RHET|ENC)\s(101|1101|111|1110)$/.test(c.code) && writingTitle.test(c.title ?? ''));
  const isCompTwo = (c: TranscriptCourseRecord) =>
    /\b(composition|writing|rhetoric)\b.*\b(2|ii)\b|\bcomposition 2\b|\bcritical writing\b|\bwriting and research\b|\bresearch writing\b/i.test(c.title ?? '') ||
    (/^(ENG|ENGL|ENGLI|WRT|WRIT|RHET|ENC)\s(102|1102|112|1120)$/.test(c.code) && writingTitle.test(c.title ?? ''));
  const compFirst = courses.find((c) => foreignLine(c) && isCompOne(c));
  const compSecond = compFirst ? courses.find((c) => c !== compFirst && foreignLine(c) && isCompTwo(c)) : undefined;
  const iaiFirst = courses.find((c) => c.use && /C1\s*900/i.test(c.iai ?? ''));
  const iaiSecond = courses.find((c) => c.use && /C1\s*901/i.test(c.iai ?? ''));
  const pairFirst = compFirst && compSecond ? compFirst : iaiFirst && iaiSecond ? iaiFirst : null;
  if (pairFirst && known.has('RHET 105')) {
    Object.assign(pairFirst, {
      matched: 'RHET 105',
      matchedBy: 'proposal',
      counts: 'course',
      illinoisCredits: known.get('RHET 105')?.credits ?? null,
      genEdTags: undefined,
      matchNote: `with ${(compFirst && compSecond ? compSecond : iaiSecond)?.code ?? 'the second course'}: Composition I`,
      basis: { from: 'official', badge: 'course', text: `Together with ${(compFirst && compSecond ? compSecond : iaiSecond)?.code ?? 'the second composition course'}, it counts as Composition I (RHET 105): Illinois meets Composition I with the two-course transfer sequence.`, source: guide?.source ?? ILLINOIS_TRANSFERRING_CREDIT },
    });
    const second = compFirst && compSecond ? compSecond : iaiSecond;
    if (second && second.counts === 'hours') {
      second.basis = { from: 'official', badge: 'elective', text: `Completes Composition I with ${pairFirst.code}; its own hours count toward your total.`, source: guide?.source ?? ILLINOIS_TRANSFERRING_CREDIT };
    }
    notes.push('Your two composition courses together count as Composition I (RHET 105), the way Illinois treats the transfer composition sequence.');
  }

  // The same Illinois course twice. A repeat of the same course counts once
  // (Illinois never grants the hours twice), unless the catalog lets a
  // student repeat it for credit (MUSC 105, private voice, "may be repeated
  // in separate terms up to 16 undergraduate hours"): then each sitting's
  // hours count, up to the catalog's cap. Two different courses that both
  // look like one Illinois course keep the second as elective hours, which is
  // what an evaluator does with the second of two similar courses.
  const firstFor = new Map<string, TranscriptCourseRecord>();
  const sittings = new Map<string, number>();
  for (const line of courses) {
    if (!line.use || line.counts !== 'course' || !line.matched) continue;
    const earlier = firstFor.get(line.matched);
    if (!earlier) {
      firstFor.set(line.matched, line);
      sittings.set(line.matched, 1);
      continue;
    }
    const repeat = known.get(line.matched)?.repeat;
    const n = (sittings.get(line.matched) ?? 1) + 1;
    const perSitting = known.get(line.matched)?.credits ?? 0;
    if (earlier.code === line.code && repeat && (repeat.max === null || n * perSitting <= repeat.max + 0.01)) {
      sittings.set(line.matched, n);
      Object.assign(line, { counts: 'hours', matched: null, matchedBy: null, illinoisCredits: null, also: undefined, matchNote: `a repeat of ${line.code}, which the catalog lets a student take for credit again; its hours count` });
      if (line.basis) line.basis = { ...line.basis, badge: 'elective', text: `A repeat of ${line.code}, which the catalog lets a student take for credit again; its hours count.` };
    } else if (earlier.code === line.code) {
      // Retaken for a better grade: the D note no longer applies to the course.
      if (earlier.gradeNote && !line.gradeNote && !isDGrade(line.grade)) {
        earlier.gradeNote = null;
        if (earlier.basis) earlier.basis = { ...earlier.basis, text: `${earlier.basis.text} Retaken for ${line.grade ?? 'a passing grade'} (${line.term ?? 'later'}).` };
      }
      Object.assign(line, { counts: 'none', use: false, matchNote: `a repeat of ${line.code}; it counts once` });
      if (line.basis) line.basis = { ...line.basis, badge: 'none', text: `A repeat of ${line.code}; it counts once.` };
    } else {
      Object.assign(line, { counts: 'hours', matched: null, matchedBy: null, illinoisCredits: null, also: undefined, matchNote: `${earlier.code} already counts as ${earlier.matched}` });
      if (line.basis) line.basis = { ...line.basis, badge: 'elective', text: `${earlier.code} already counts as ${earlier.matched}, so this one counts as elective hours.` };
    }
  }
  // A completed GECC (or an Illinois A.A./A.S. carrying it) meets the campus
  // categories it covers. Composition I and Quantitative Reasoning I are left
  // to the lines when a line already meets them, so the package never stands
  // in for a second Quantitative Reasoning course.
  const gecc = schoolId === 'illinois' ? geccCompletion(reading) : null;
  if (gecc) {
    const heldTags = new Set(
      courses
        .filter((c) => c.use)
        .flatMap((c) => (c.counts === 'course' && c.matched ? [c.matched, ...(c.also ?? [])].flatMap(tagsOf) : c.counts === 'hours' ? c.genEdTags ?? [] : [])),
    );
    gecc.meets = gecc.meets.filter((m) => !(GECC_ONLY_IF_MISSING.has(m.category) && m.tags.some((t) => heldTags.has(t))));
    notes.unshift(gecc.text);
  }
  if (mixedQuarter.size > 0) notes.unshift(`${[...mixedQuarter].join(', ')} ${mixedQuarter.size === 1 ? 'states' : 'state'} quarter hours; those lines are converted to semester hours at two-thirds, the usual conversion. Your Transfer Evaluation Report shows the figure your university settles on.`);
  if (quarter) notes.unshift('This transcript is in quarter hours; each line\'s hours are converted to semester hours at two-thirds, the usual conversion. Your Transfer Evaluation Report shows the figure your university settles on.');
  const foreign = codesAreIllinois ? [] : courses.filter((c) => c.from ? !isHomeTranscript(c.from, schoolId) : !home);
  if (!reading.institution && !home) {
    notes.unshift('No school is named on this list and most of its codes are not in this university catalog, so they are read as another school\'s.');
  }
  if (foreign.length > 0) {
    const proposed = foreign.filter((c) => c.use && c.matchedBy === 'proposal').length;
    const asHours = foreign.filter((c) => c.counts === 'hours').length;
    const where = reading.institution && !home ? reading.institution : [...new Set(foreign.map((c) => c.from).filter(Boolean))].join(', ') || 'another school';
    notes.unshift(
      schoolId === 'uga' ? `${foreign.length} ${foreign.length === 1 ? 'line is' : 'lines are'} from ${where}. Each line says what it becomes at UGA and why: UGA's own equivalency list first (a UGA course, a core elective, elective hours only, or no credit), then UGA's published rules. A line the list does not cover counts as hours until UGA evaluates it. UGA's evaluation after admission is the decision.` : `${foreign.length} ${foreign.length === 1 ? 'line is' : 'lines are'} from ${where}. Illinois decides what transfers and as which course (Transferology is the estimate, the Transfer Evaluation Report the decision).${
        proposed > 0 ? ` ${proposed} ${proposed === 1 ? 'has' : 'have'} a likely Illinois equivalent filled in from the catalog's titles; check each.` : ''
      }${asHours > 0 ? ` ${asHours} ${asHours === 1 ? 'counts' : 'count'} as hours toward the total until you pick the Illinois course it became.` : ''}`,
    );
  }
  return {
    schoolId,
    fileName,
    readAt: new Date().toISOString(),
    institution: reading.institution,
    kind: reading.kind,
    home,
    files,
    courses,
    exams: reading.exams,
    notes,
    ...(gecc ? { gecc } : {}),
  };
}

/** Categories a completed package meets only when no line on the record already does. */
const GECC_ONLY_IF_MISSING = new Set(['Composition I', 'Quantitative Reasoning I']);

/**
 * The campus categories the IAI GECC covers, at the campus minimum
 * (GENED_CAMPUS_SIZE in illinois-data.ts: gened.illinois.edu/requirements).
 * A degree page that asks for more than the minimum still gets the rest
 * planned, and a degree's own hours blocks are never filled by the package.
 */
const GECC_MEETS: Array<{ category: string; tags: string[]; hours: number; asHours?: number }> = [
  { category: 'Composition I', tags: ['Composition I'], hours: 4 },
  { category: 'Humanities & the Arts', tags: ['Humanities - Hist & Phil', 'Humanities - Lit & Arts'], hours: 6, asHours: 3 },
  { category: 'Natural Sciences & Technology', tags: ['Nat Sci & Tech - Phys Sciences', 'Nat Sci & Tech - Life Sciences'], hours: 6 },
  { category: 'Social & Behavioral Sciences', tags: ['Social & Beh Sci - Soc Sci', 'Social & Beh Sci - Beh Sci'], hours: 6, asHours: 3 },
  { category: 'Quantitative Reasoning I', tags: ['Quantitative Reasoning I'], hours: 3 },
];
const GECC_STILL_TO_DO = ['Advanced Composition', 'the three Cultural Studies courses (Western/Comparative, Non-Western, US Minority)', 'Quantitative Reasoning II', 'the Language Other Than English requirement'];

/**
 * The Illinois community colleges, by the words that name each on a
 * transcript. An A.A. or A.S. carries the GECC only from an Illinois school.
 */
const ILLINOIS_COMMUNITY_COLLEGE = /\b(black hawk|carl sandburg|city colleges of chicago|daley college|harold washington|truman college|kennedy-king|malcolm x|olive-harvey|wright college|danville area|du ?page|elgin community|harper college|william rainey harper|heartland community|highland community|illinois central college|illinois eastern|frontier community|lincoln trail|olney central|wabash valley|illinois valley community|joliet junior|kankakee community|kaskaskia|kishwaukee|college of lake county|lake land college|lewis (and|&) clark community|lincoln land|john a\.? logan|mchenry county|moraine valley|morton college|oakton|parkland|prairie state|rend lake|richland community|rock valley|sauk valley|shawnee community|south suburban|southeastern illinois|southwestern illinois|spoon river|triton college|waubonsee|john wood community)\b/i;

/**
 * Whether the document shows a completed IAI GECC, or an Illinois A.A. or
 * A.S. that carries it, from the credentials it prints. An A.S. carries a
 * modified package that leaves one Humanities and Fine Arts course and one
 * Social and Behavioral Sciences course for after transfer (iTransfer), so
 * those two categories count at half. Anything marked in progress, partial or
 * expected is not a completion.
 */
export function geccCompletion(reading: Pick<TranscriptReading, 'institution' | 'courses' | 'credentials'>): GeccCompletion | null {
  const school = reading.institution && !isHomeTranscript(reading.institution) ? reading.institution : reading.courses.map((c) => c.from).find((f): f is string => Boolean(f && !isHomeTranscript(f))) ?? null;
  const unfinished = /\b(not|in progress|incomplete|partial(ly)?|pending|remaining|expected|anticipated|candidate|pursuing|working toward|needed)\b/i;
  let found: { kind: GeccCompletion['kind']; evidence: string } | null = null;
  for (const raw of reading.credentials ?? []) {
    const text = raw.trim();
    if (!text || unfinished.test(text)) continue;
    const illinois = ILLINOIS_COMMUNITY_COLLEGE.test(text) || ILLINOIS_COMMUNITY_COLLEGE.test(school ?? '');
    if (/\b(gecc|general education core curriculum|iai general education|iai gen(eral)? ed)\b/i.test(text) && /\b(complete[ds]?|completion|met|satisfied|fulfilled|certified)\b/i.test(text)) {
      found = { kind: 'gecc', evidence: text };
      break;
    }
    if (!illinois || /\b(applied|teaching|fine arts|general studies|engineering science)\b/i.test(text)) continue;
    if (/\bassociate (in|of) arts\b|^a\.? ?a\.?(\s|$)|\ba\.a\. degree\b/i.test(text)) found = { kind: 'aa', evidence: text };
    else if (!found && /\bassociate (in|of) science\b|^a\.? ?s\.?(\s|$)|\ba\.s\. degree\b/i.test(text)) found = { kind: 'as', evidence: text };
  }
  if (!found) return null;
  const hit = found;
  const from = school ?? 'your college';
  const meets = GECC_MEETS.map((m) => ({ category: m.category, tags: m.tags, hours: hit.kind === 'as' && m.asHours ? m.asHours : m.hours }));
  const what = hit.kind === 'gecc' ? `the IAI General Education Core Curriculum completed ("${hit.evidence}")` : hit.kind === 'aa' ? `an Associate in Arts ("${hit.evidence}"), which carries the full IAI General Education Core Curriculum` : `an Associate in Science ("${hit.evidence}"), which carries a modified IAI General Education Core Curriculum`;
  const text =
    `Your ${from} record shows ${what}. Illinois Admissions says a completed GECC meets Illinois's general education requirements, while campus, college and major requirements beyond it still apply. ` +
    `So the plan counts Composition I, Humanities & the Arts, Natural Sciences & Technology, Social & Behavioral Sciences and Quantitative Reasoning I as met at the campus minimum${hit.kind === 'as' ? ', except one Humanities and one Social & Behavioral Sciences course, which the A.S. leaves for after transfer' : ''}. ` +
    `The GECC does not cover ${GECC_STILL_TO_DO.slice(0, -1).join(', ')} or ${GECC_STILL_TO_DO[GECC_STILL_TO_DO.length - 1]} (Illinois community colleges' UIUC transfer guides list them as outside the package), so those stay in the plan unless other credit meets them, and so does every course your degree names. Your Transfer Course Evaluation Report decides.`;
  return {
    kind: hit.kind,
    evidence: hit.evidence,
    school,
    meets,
    stillToDo: GECC_STILL_TO_DO,
    text,
    sources: [ILLINOIS_TRANSFER_POLICIES, ILLINOIS_GENED_TRANSFER, IAI_ASSOCIATE_DEGREES, IAI_GECC_EXCEPTIONS_GUIDE],
  };
}

/**
 * UGA results the planner's catalog does not list beside the ones it does:
 * a lab the catalog folds into its lecture ("PHYS 1211-1211L"), or a course
 * it lacks, said plainly either way.
 */
function missingNote(missing: string[], held: string[]): string {
  if (missing.length === 0) return '';
  const labs = missing.every((m) => m.endsWith('L') && held.includes(m.slice(0, -1)));
  return labs
    ? ` This planner's catalog lists ${held.join(' + ')} with ${held.length === 1 ? 'its' : 'their'} lab.`
    : ` ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in this planner's catalog, so only ${held.join(' + ')} ${held.length === 1 ? 'is' : 'are'} marked as taken.`;
}

/** Whether a published guide's "08/01/2024 to 07/31/2025" ended before the reading. */
function guideExpired(effective: string | null, _reading: TranscriptReading): boolean {
  const end = effective?.match(/(\d{2})\/(\d{2})\/(\d{4})\s*$/);
  if (!end) return false;
  return new Date(`${end[3]}-${end[1]}-${end[2]}T23:59:59`).getTime() < Date.now();
}

/**
 * UGA counts at most one hour of physical education from another school
 * (its Transfer Planning Guide and transfer FAQ). Activity lines past the
 * first hour are capped or left out, first lines first, with the reason on
 * the line. Run again over a record that grows by another upload.
 */
export function applyTransferCaps(courses: TranscriptCourseRecord[], schoolId: 'uga' | 'illinois' = 'illinois'): TranscriptCourseRecord[] {
  if (schoolId !== 'uga') return courses;
  let left = 1;
  for (const line of courses) {
    if (!line.use || line.counts === 'none') continue;
    const elsewhere = Boolean(line.designation) || (line.from ? !isHomeTranscript(line.from, 'uga') : false);
    if (!elsewhere || !isPhysicalActivity(line.designation ?? line.code, line.title)) continue;
    const hours = line.equivalentCredits ?? line.credits ?? line.assumedCredits ?? 0;
    if (line.counts === 'course' || hours <= left) {
      left = Math.max(0, left - hours);
      continue;
    }
    const capText = 'UGA counts at most 1 hour of physical education (activity) credit from other schools';
    if (left > 0) {
      Object.assign(line, { equivalentCredits: left, basis: { from: 'rule', badge: 'elective', text: `${capText}, so ${left} of its ${hours} hours count.`, source: UGA_TRANSFER_GUIDE } });
      left = 0;
    } else {
      Object.assign(line, { counts: 'none', use: false, basis: { from: 'rule', badge: 'none', text: `${capText}, and another line already uses that hour, so this one does not count.`, source: UGA_TRANSFER_GUIDE } });
    }
  }
  return courses;
}

/**
 * One line over the review list, by what each transfer line became:
 * "4 count as UGA courses, 2 as core electives, 1 as elective hours only,
 * 3 do not count, 2 are not yet evaluated (counted as hours)."
 */
export function describeTransfer(record: TranscriptRecord, catalogName: string): string | null {
  const lines = record.courses.filter((c) => c.basis && c.status !== 'withdrawn' && c.status !== 'failed');
  if (lines.length === 0) return null;
  const n = (badge: TransferBasis['badge']) => lines.filter((c) => (c.use ? c.basis?.badge === badge : badge === 'none')).length;
  const parts: string[] = [];
  const course = n('course');
  if (course) parts.push(`${course} ${course === 1 ? 'counts' : 'count'} as ${catalogName} ${course === 1 ? 'course' : 'courses'}`);
  const core = n('core');
  // UGA calls credit toward a core area a core elective; Illinois has no such
  // term, and the line is hours toward a gen-ed category.
  if (core) parts.push(record.schoolId === 'uga' ? `${core} as ${core === 1 ? 'a core elective' : 'core electives'}` : `${core} as gen ed credit (hours toward a category)`);
  const elective = n('elective');
  if (elective) parts.push(`${elective} as elective hours only`);
  const none = n('none');
  if (none) parts.push(`${none} ${none === 1 ? 'does' : 'do'} not count`);
  const pending = n('not-evaluated');
  if (pending) parts.push(`${pending} ${pending === 1 ? 'is' : 'are'} not yet evaluated (counted as hours)`);
  return parts.length ? `Transfer lines: ${parts.join(', ')}.` : null;
}

/** The student's own choice for one line: an Illinois course, hours, or nothing. */
export function setLineCounts(
  record: TranscriptRecord,
  index: number,
  choice: { counts: 'course'; code: string } | { counts: 'hours' } | { counts: 'none' },
  /** Catalog hours by code, so the line keeps the hours of what it now counts as. */
  creditsOf: (code: string) => number | null = () => null,
): TranscriptRecord {
  return {
    ...record,
    courses: record.courses.map((c, i) => {
      if (i !== index) return c;
      if (choice.counts === 'course') {
        const by = c.matchedBy === 'code' && c.matched === choice.code ? 'code' : c.equivalent === choice.code ? 'printed' : 'student';
        const also = (c.proposals ?? []).filter((p) => p.pairedWith === choice.code).map((p) => p.code);
        const credits = [choice.code, ...also].map((code) => creditsOf(code));
        const illinoisCredits = credits.every((n) => n !== null) ? credits.reduce<number>((sum, n) => sum + (n ?? 0), 0) : null;
        return { ...c, matched: choice.code, matchedBy: by, counts: 'course', use: true, also: also.length ? also : undefined, illinoisCredits };
      }
      if (choice.counts === 'hours') return { ...c, matched: null, matchedBy: null, counts: 'hours', use: true, also: undefined, illinoisCredits: null };
      return { ...c, matched: null, matchedBy: null, counts: 'none', use: false, also: undefined, illinoisCredits: null };
    }),
  };
}

/** Courses to omit from future scheduling, including separately labelled in-progress work. */
export function transcriptCodes(record: TranscriptRecord | null | undefined): string[] {
  if (!record) return [];
  const out = new Set<string>();
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'course' || !c.matched) continue;
    if ((c.equivalentCredits ?? c.credits) === 0) continue;
    out.add(c.matched);
    for (const extra of c.also ?? []) out.add(extra);
  }
  return [...out];
}

/** Of transcriptCodes, the classes the student is taking now (in-progress lines). */
export function transcriptInProgressCodes(record: TranscriptRecord | null | undefined): string[] {
  if (!record) return [];
  const out = new Set<string>();
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'course' || !c.matched || c.status !== 'in_progress') continue;
    if ((c.equivalentCredits ?? c.credits) === 0) continue;
    out.add(c.matched);
    for (const extra of c.also ?? []) out.add(extra);
  }
  return [...out];
}

/** Placement/exemption clears a prerequisite, but earns no course or degree hours. */
export function transcriptExemptCodes(record: TranscriptRecord | null | undefined): string[] {
  return (record?.courses ?? []).flatMap((c) =>
    c.use && c.matched && c.counts === 'course' && (c.equivalentCredits ?? c.credits) === 0
      ? [c.matched, ...(c.also ?? [])] : [],
  );
}

/** The record, not today's catalog, prices a student's UGA credit. */
export function transcriptCourseCredits(record: TranscriptRecord | null | undefined): Map<string, number> {
  const credits = new Map<string, number>();
  if (record?.schoolId !== 'uga') return credits;
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'course' || !c.matched) continue;
    const hours = c.equivalentCredits ?? c.credits;
    // A bundled equivalency has only one source total; settle it with the
    // adjustment instead of assigning the full total to each of its courses.
    if (hours == null || c.also?.length) continue;
    credits.set(c.matched, /^PEDB\s/.test(c.matched) ? 0 : hours);
  }
  return credits;
}

export function withTranscriptCredits(context: PlanningContext, record: TranscriptRecord | null | undefined): PlanningContext {
  const held = transcriptCourseCredits(record);
  if (!held.size) return context;
  const creditRanges = new Map(context.creditRanges);
  const courses = context.courses.map((course) => {
    const credits = held.get(course.code);
    if (credits === undefined) return course;
    creditRanges.set(course.code, { credits, min: credits, max: credits, variable: false, known: true });
    return { ...course, credits };
  });
  return { ...context, courses, creditRanges };
}

export function transcriptCreditSummary(record: TranscriptRecord | null | undefined) {
  let earned = 0, pending = 0, physicalEducation = 0;
  for (const c of record?.courses ?? []) {
    if (!c.use || c.counts === 'none') continue;
    const hours = c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0;
    if (c.status === 'in_progress') pending += hours;
    else earned += hours;
    if (record?.schoolId === 'uga' && /^PEDB\s/.test(c.matched ?? c.code)) physicalEducation += hours;
  }
  return { earned, pending, physicalEducation, projected: earned + pending };
}

/** Hours the record earns toward the degree that no course code holds. */
export function transcriptHours(record: TranscriptRecord | null | undefined): number {
  if (!record) return 0;
  let hours = 0;
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'hours') continue;
    hours += c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0;
  }
  return hours;
}

/**
 * Reconcile actual transcript hours with the hours already counted by course.
 * UGA uses transcript-adjusted course credits; bundled equivalents can still
 * need an adjustment. Illinois retains its existing catalog-credit settlement.
 */
export function transcriptCreditAdjustment(
  record: TranscriptRecord | null | undefined,
  /**
   * The board's actual hours, after applying transcript credit overrides.
   * Do not reconcile UGA against the upload catalog's generic credit values.
   */
  creditsOf?: (code: string) => number | null,
): number {
  if (!record) return 0;
  let delta = 0;
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'course' || !c.matched) continue;
    const earned = record.schoolId === 'uga' && /^PEDB\s/.test(c.matched) ? 0 : c.equivalentCredits ?? c.credits;
    if ((c.equivalentCredits ?? c.credits) === 0) continue;
    const board = record.schoolId === 'uga' && creditsOf ? [c.matched, ...(c.also ?? [])].map((code) => creditsOf(code)) : null;
    const catalog = board && board.every((n) => n !== null) ? board.reduce<number>((sum, n) => sum + (n ?? 0), 0) : c.illinoisCredits ?? null;
    if (earned === null || earned === undefined || catalog === null) continue;
    delta += earned - catalog;
  }
  return Math.round(delta * 100) / 100;
}

/**
 * Subject-hours codes ("ECON 1--") the record already counts as hours, so the
 * exam picker does not count the same AP credit a second time when the
 * student's Illinois record lists it and they also picked the exam.
 */
export function transcriptIndirectCodes(record: TranscriptRecord | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!record) return out;
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'hours') continue;
    if (isIndirectCode(c.code)) out.add(c.code);
    if (c.equivalent && isIndirectCode(c.equivalent)) out.add(c.equivalent);
  }
  return out;
}

/** Whether a line was taught somewhere other than Illinois. */
export function lineIsForeign(record: TranscriptRecord, c: TranscriptCourseRecord): boolean {
  if (c.from) return !isHomeTranscript(c.from, record.schoolId);
  // Records saved before lines carried their school: the document decides.
  return record.home === false && c.matchedBy !== 'student';
}

/**
 * Hours the record shows as taught by Illinois itself, done or in progress,
 * for the residency rule (45 hours at Illinois, 21 of them at the 300 level
 * or above). Transfer and exam credit is not residence, whatever course it
 * became.
 */
export function transcriptResidentHours(record: TranscriptRecord | null | undefined): { total: number; upper: number } {
  if (!record) return { total: 0, upper: 0 };
  let total = 0;
  let upper = 0;
  for (const c of record.courses) {
    if (!c.use || (c.status !== 'completed' && c.status !== 'in_progress')) continue;
    if (lineIsForeign(record, c)) continue;
    // A course the student typed has no document saying where it was taken;
    // counting it as residence could overstate, so it is not counted.
    if (c.matchedBy === 'student') continue;
    const hours = c.credits ?? 0;
    total += hours;
    if ((record.schoolId === 'uga' ? /\b[345]\d{3}[A-Z]?$/ : /\b[34]\d\d[A-Z]?$/).test(c.matched ?? c.code)) upper += hours;
  }
  return { total, upper };
}

/** Lines the student has not settled: another school's course counted as hours with a proposal on offer. */
export function transcriptOpenLines(record: TranscriptRecord | null | undefined): TranscriptCourseRecord[] {
  if (!record) return [];
  return record.courses.filter((c) => c.use && c.counts === 'hours' && (c.proposals?.length ?? 0) > 0);
}

/** One sentence about what was read, for the summary line over the list. */
export function describeTranscript(record: TranscriptRecord, catalogName: string): string {
  const total = record.courses.length;
  const asCourse = record.courses.filter((c) => c.use && c.counts === 'course');
  const likely = asCourse.filter((c) => c.matchedBy === 'proposal').length;
  const asHours = record.courses.filter((c) => c.use && c.counts === 'hours');
  const hours = transcriptHours(record);
  const inProgress = record.courses.filter((c) => c.use && c.status === 'in_progress').length;
  const withdrawn = record.courses.filter((c) => c.status === 'withdrawn').length;
  const failed = record.courses.filter((c) => c.status === 'failed').length;
  const none = record.courses.filter((c) => c.status === 'no_credit').length;
  const line = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  parts.push(`${asCourse.length} count as ${catalogName} courses${likely ? ` (${likely} likely ${likely === 1 ? 'equivalent' : 'equivalents'} to confirm)` : ''}`);
  if (asHours.length) parts.push(`${asHours.length} as hours toward the total (${hours} hr)`);
  if (inProgress) parts.push(`${inProgress} in progress`);
  if (withdrawn) parts.push(`${withdrawn} withdrawn`);
  if (failed) parts.push(`${failed} failed`);
  if (none) parts.push(`${none} ${none === 1 ? 'earns' : 'earn'} no credit`);
  const source = record.files && record.files.length > 1 ? `${record.files.length} files` : record.fileName;
  return `${line(total, 'line')} read from ${source}. ${parts.join(', ')}.`;
}

/**
 * Gen-ed credit the record holds with no Illinois course: lines counted as
 * hours whose categories a published guide or the document names. Each line
 * is one credit, identified by its school and code so it fills a category once.
 */
export function transcriptGenEdCredits(record: TranscriptRecord | null | undefined): GenEdCredit[] {
  if (!record) return [];
  const out: GenEdCredit[] = [];
  record.courses.forEach((c, i) => {
    if (!c.use || c.counts !== 'hours' || !c.genEdTags || c.genEdTags.length === 0) return;
    const hours = c.equivalentCredits ?? c.credits ?? c.assumedCredits ?? 0;
    if (!(hours > 0)) return;
    out.push({ id: `${c.from ?? record.institution ?? 'transfer'} ${c.code} #${i}`, label: `${c.code}${c.title ? ` ${c.title}` : ''}${c.from ? ` (${c.from})` : ''}`, credits: hours, tags: c.genEdTags });
  });
  // After the lines, so a category the lines already meet keeps them.
  for (const m of record.gecc?.meets ?? []) {
    out.push({ id: `IAI GECC ${m.category}`, label: `IAI GECC completed${record.gecc?.school ? ` (${record.gecc.school})` : ''}: ${m.category}`, credits: m.hours, tags: m.tags, package: true });
  }
  return out;
}

/**
 * Whether a student's words ask for an intercollegiate transfer inside
 * Illinois ("switching from LAS into Gies", "ICT", "undeclared, want
 * engineering"), as opposed to arriving from another school.
 *
 * A student coming from College of DuPage who is already admitted to Gies
 * wrote "transfer student", and the plan front-loaded the ICT route meant for
 * current Illinois students, pushing ACCY 302 into her first term. Arriving
 * from elsewhere is read from the words ("transferring to Illinois", "from
 * Parkland", "admitted to Gies") and from the record (another school's
 * transcript or an evaluation report, with no Illinois courses on it).
 */
/**
 * "From Parkland", "from my community college": the words of a student who
 * is coming to Illinois from another school. Shared with admission-route.ts,
 * which reads the same words to tell a transfer from a first-year.
 */
export const FROM_ANOTHER_COLLEGE = /\bfrom (a |my )?(community college|parkland|college of dupage|harper|joliet|moraine valley|triton|oakton|waubonsee|elgin|mchenry|college of lake county|illinois central|lincoln land|heartland|richland|kishwaukee|rock valley|john a\.? logan|southwestern)\b/i;

export function internalTransferIntent(words: string, record: TranscriptRecord | null | undefined): boolean {
  const wants = /\b(transfer(ring)?|switch(ing)?|mov(e|ing) (in)?to|get(ting)? in(to)?|apply(ing)? (to|for)|ict|intercollegiate|undeclared|not (yet )?(in|admitted)|pre-?business|dgs|general studies)\b/i.test(words);
  if (!wants) return false;
  if (/\bict\b|\bintercollegiate\b|\bswitch(ing)? (from|out of|majors?)\b|\bundeclared\b|\bdgs\b|\bgeneral studies\b/i.test(words)) return true;
  const arriving =
    /\btransferr?\w* (to|into) (the )?(illinois|uiuc|u of i|university of illinois|urbana)\b/i.test(words) ||
    /\b(admitted|accepted) (to|into|at)\b/i.test(words) ||
    /\btransfer student\b/i.test(words) ||
    FROM_ANOTHER_COLLEGE.test(words);
  const recordFromElsewhere =
    Boolean(record) && (record?.kind === 'transfer_report' || record?.home === false) && transcriptResidentHours(record).total === 0;
  return !(arriving || recordFromElsewhere);
}
