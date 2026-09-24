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

import { genEdTagsFromText, guideSchool, proposeEquivalents, type CatalogLite, type EquivalentProposal, type TransferGenEdGuide } from './transfer-match';
import type { GenEdCredit } from './autoplan';

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
}

/** How one line counts toward the degree. */
export type CountsAs = 'course' | 'hours' | 'none';

export interface TranscriptCourseRecord extends TranscriptCourse {
  /** The catalog code this line counts as, or null when it counts as hours or not at all. */
  matched: string | null;
  /** Where the match came from. */
  matchedBy: 'code' | 'printed' | 'proposal' | 'student' | null;
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
}

/** What the student keeps, alongside the rest of their answers. */
export interface TranscriptRecord {
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
export type TranscriptUploadBody = TranscriptUploadFile | { files: TranscriptUploadFile[] };

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
export function isHomeTranscript(institution: string | null | undefined): boolean {
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
 * A course below college level. Community colleges number them 0xx or 0xxx
 * ("MATH 0482 Foundations for College Math"), and Illinois transfers none of
 * them. The number is the rule; the title is a second reading of the same
 * fact for a school that numbers differently.
 */
export function isDevelopmental(code: string, title: string | null): boolean {
  const number = code.match(/\b(\d{3,4})[A-Z]{0,2}$/)?.[1];
  if (number && Number(number[0]) === 0) return true;
  return /\b(developmental|remedial|foundations? for college|basic (math|writing|algebra)|pre-?college|college prep)\b/i.test(title ?? '');
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
): TranscriptRecord {
  const known = new Map(catalog.map((c) => [c.code, c]));
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
  const issuerIsHome = isHomeTranscript(reading.institution);
  const quarter = reading.hoursUnit === 'quarter';
  const creditsOfCode = (code: string | null | undefined): number | null => (code ? known.get(code)?.credits ?? null : null);
  const knownShare = reading.courses.length > 0
    ? reading.courses.filter((c) => known.has(normalizeCourseCode(c.code)) || isIndirectCode(normalizeCourseCode(c.code))).length / reading.courses.length
    : 1;
  const home = reading.institution ? issuerIsHome : knownShare >= 0.5;
  const codesAreIllinois = home && reading.kind !== 'transfer_report';
  const courses: TranscriptCourseRecord[] = reading.courses.map((raw) => {
    // Quarter hours are two-thirds of a semester hour, the usual conversion;
    // the Transfer Evaluation Report shows the figure Illinois settles on.
    const c = quarter && raw.credits !== null ? { ...raw, credits: Math.round(raw.credits * (2 / 3) * 100) / 100 } : raw;
    const code = normalizeCourseCode(c.code);
    const term = normalizeTerm(c.term);
    const taughtElsewhere = codesAreIllinois ? false : c.from ? !isHomeTranscript(c.from) : !home;
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
      ...(quarter && raw.credits !== null ? { printedCredits: raw.credits } : {}),
    };
    const off = !earns(c.status);

    // The document's own word: an evaluation report or an audit that prints
    // the Illinois equivalent beside the line. "HIST 1--" is hours.
    if (base.equivalent) {
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
      if (known.has(code)) return { ...base, matched: code, matchedBy: 'code', illinoisCredits: creditsOfCode(code), counts: off ? 'none' : 'course', use: !off };
      // An Illinois record with a code the catalog no longer lists: the hours
      // are real, the course is not something the plan can name.
      return { ...base, counts: off || c.credits === null ? 'none' : 'hours', use: !off && c.credits !== null };
    }
    if (isDevelopmental(code, c.title) || c.status === 'no_credit') {
      return { ...base, status: 'no_credit', counts: 'none', use: false };
    }
    const proposals = proposeEquivalents({ code, title: c.title, credits: c.credits }, catalog);
    const best = proposals[0];
    if (best && best.confidence === 'high') {
      const also = proposals.filter((p) => p.pairedWith === best.code).map((p) => p.code);
      const illinoisCredits = [best.code, ...also].reduce((sum, code) => sum + (creditsOfCode(code) ?? 0), 0);
      return { ...base, matched: best.code, matchedBy: 'proposal', proposals, illinoisCredits, counts: off ? 'none' : 'course', use: !off, ...(also.length ? { also } : {}) };
    }
    return { ...base, proposals, counts: off ? 'none' : 'hours', use: !off };
  });

  // A document that prints no hours (a portal list of dual-credit courses)
  // still earns them: each such line from another school is counted at three
  // hours until the student says otherwise.
  let assumed = 0;
  for (const line of courses) {
    const foreign = line.from ? !isHomeTranscript(line.from) : false;
    if (!foreign || line.credits !== null || line.equivalentCredits != null || !earns(line.status)) continue;
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
    const foreign = line.from ? !isHomeTranscript(line.from) : false;
    if (!foreign) continue;
    const school = guideSchool(guide, line.from);
    const entry = school?.courses[line.code];
    const printed = genEdTagsFromText(line.genEdText);
    const tags = entry ? entry.tags : printed;
    if (tags.length === 0) continue;
    line.genEdTags = tags;
    line.genEdSource = entry ? `${guide?.title ?? 'the published guide'} (${guide?.effective ?? 'current'})` : 'printed on the document';
    // A likely Illinois course is kept only when it meets the same categories
    // the guide says the line meets; otherwise the line counts as hours with
    // the guide's categories, which is what Illinois has said about it.
    if (entry && line.matchedBy === 'proposal' && line.matched) {
      const courseTags = new Set([line.matched, ...(line.also ?? [])].flatMap(tagsOf));
      const same = courseTags.size === tags.length && tags.every((t) => courseTags.has(t));
      if (!same) Object.assign(line, { matched: null, matchedBy: null, counts: line.use ? 'hours' : 'none', also: undefined, illinoisCredits: null });
    }
  }
  // Composition I is the two-course sequence. With both courses from another
  // school, the first counts as RHET 105 and the second as hours; with one,
  // it is hours and Composition I is still to do.
  // The first and second composition courses, by title or by the number
  // nearly every Illinois community college gives them (ENG 101 and 102,
  // ENGLI 1101 and 1102): Joliet's "Rhetoric" and "Critical Writing and
  // Research" are the same two courses under other names.
  const foreignLine = (c: TranscriptCourseRecord) => c.use && c.matchedBy !== 'code' && c.matchedBy !== 'printed' && Boolean(c.from) && !isHomeTranscript(c.from);
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
    });
    notes.push('Your two composition courses together count as Composition I (RHET 105), the way Illinois treats the transfer composition sequence.');
  }

  // The same Illinois course twice. A repeat of the same course counts once
  // (Illinois never grants the hours twice); two different courses that both
  // look like one Illinois course keep the second as elective hours, which is
  // what an evaluator does with the second of two similar courses.
  const firstFor = new Map<string, TranscriptCourseRecord>();
  for (const line of courses) {
    if (!line.use || line.counts !== 'course' || !line.matched) continue;
    const earlier = firstFor.get(line.matched);
    if (!earlier) {
      firstFor.set(line.matched, line);
      continue;
    }
    if (earlier.code === line.code) {
      Object.assign(line, { counts: 'none', use: false, matchNote: `a repeat of ${line.code}; it counts once` });
    } else {
      Object.assign(line, { counts: 'hours', matched: null, matchedBy: null, illinoisCredits: null, also: undefined, matchNote: `${earlier.code} already counts as ${earlier.matched}` });
    }
  }
  if (quarter) notes.unshift('This transcript is in quarter hours; each line\'s hours are converted to semester hours at two-thirds, the usual conversion. Your Transfer Evaluation Report shows the figure Illinois settles on.');
  const foreign = codesAreIllinois ? [] : courses.filter((c) => c.from ? !isHomeTranscript(c.from) : !home);
  if (!reading.institution && !home) {
    notes.unshift('No school is named on this list and most of its codes are not Illinois courses, so they are read as another school\'s.');
  }
  if (foreign.length > 0) {
    const proposed = foreign.filter((c) => c.use && c.matchedBy === 'proposal').length;
    const asHours = foreign.filter((c) => c.counts === 'hours').length;
    const where = reading.institution && !home ? reading.institution : [...new Set(foreign.map((c) => c.from).filter(Boolean))].join(', ') || 'another school';
    notes.unshift(
      `${foreign.length} ${foreign.length === 1 ? 'line is' : 'lines are'} from ${where}. Illinois decides what transfers and as which course (Transferology is the estimate, the Transfer Evaluation Report the decision).${
        proposed > 0 ? ` ${proposed} ${proposed === 1 ? 'has' : 'have'} a likely Illinois equivalent filled in from the catalog's titles; check each.` : ''
      }${asHours > 0 ? ` ${asHours} ${asHours === 1 ? 'counts' : 'count'} as hours toward the total until you pick the Illinois course it became.` : ''}`,
    );
  }
  return {
    fileName,
    readAt: new Date().toISOString(),
    institution: reading.institution,
    kind: reading.kind,
    home,
    files,
    courses,
    exams: reading.exams,
    notes,
  };
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

/** The codes the planner should treat as already earned. */
export function transcriptCodes(record: TranscriptRecord | null | undefined): string[] {
  if (!record) return [];
  const out = new Set<string>();
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'course' || !c.matched) continue;
    out.add(c.matched);
    for (const extra of c.also ?? []) out.add(extra);
  }
  return [...out];
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
 * The difference between the hours a counted line earned and the catalog
 * hours of the Illinois course it counts as, summed over the record.
 *
 * The plan totals held courses at their catalog hours. That is right for an
 * Illinois course and wrong for a course from elsewhere: Parkland's 5-hour
 * calculus becomes MATH 221 (4) plus an hour of elective credit, and a 3-hour
 * sociology becomes SOC 100 but earns 3. The line's own hours are what
 * transferred (or the Illinois hours the document prints beside it), so the
 * difference is added to the hours with no course, up or down.
 */
export function transcriptCreditAdjustment(record: TranscriptRecord | null | undefined): number {
  if (!record) return 0;
  let delta = 0;
  for (const c of record.courses) {
    if (!c.use || c.counts !== 'course' || !c.matched) continue;
    const earned = c.equivalentCredits ?? c.credits;
    const catalog = c.illinoisCredits ?? null;
    if (earned === null || earned === undefined || catalog === null || !(earned > 0)) continue;
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
  if (c.from) return !isHomeTranscript(c.from);
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
    if (/\b[34]\d\d[A-Z]?$/.test(c.matched ?? c.code)) upper += hours;
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
