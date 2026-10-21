import { isOneBoxSetup } from './goal-words';
import { readSavedBoard } from './saved-board';
import type { TranscriptRecord } from './transcript';
import { normalizeUgaCollegeId, UGA_COLLEGE_BY_ID } from './uga-colleges';

/**
 * What we learn before showing anyone a planner.
 *
 * One open response for the student's situation, interests and goals.
 * Structured details are confirmed afterwards and remain editable.
 */

/**
 * Everything that changes when a student picks a different school.
 *
 * The first build hardcoded UGA into the placeholders, the data file paths and
 * the assistant, so a second school would have shown its name above UGA's
 * catalog. Every school-specific string now lives here.
 *
 * The transfer feeders are the real ones: Parkland is the dominant pipeline
 * into Illinois, and Georgia State and the technical colleges into UGA. Naming
 * the actual college a student transferred from is the difference between a
 * placeholder that helps and one that reads as filler.
 */
/**
 * `bot` is the name of the school's assistant in the planner, taken from the
 * school's own tradition: ALMA after the Alma Mater at Illinois, ARCH after
 * the Arch at UGA.
 */
export const SCHOOLS = [
  {
    id: 'uga',
    name: 'University of Georgia',
    short: 'UGA',
    bot: 'ARCH',
    people: 'Bulldogs',
    accent: '#BA0C2F',
    portal: 'Athena and DegreeWorks',
    colleges: 'Franklin, Terry, Grady',
    town: 'Athens',
    feeders: 'Georgia State, Athens Tech, Gwinnett Tech',
    dropTerm: 'withdrawal',
    catalog: '/uga-catalog.json',
    examCredit: '/uga-exam-credit.json',
  },
  {
    id: 'illinois',
    name: 'University of Illinois',
    short: 'Illinois',
    bot: 'ALMA',
    people: 'Illini',
    accent: '#FF5F05',
    portal: 'Student Self-Service',
    colleges: 'LAS, Grainger, Gies',
    town: 'Urbana-Champaign',
    feeders: 'Parkland College, Harper, College of DuPage',
    dropTerm: 'withdrawal',
    catalog: null,
    examCredit: null,
  },
] as const;

export type School = (typeof SCHOOLS)[number];

export function schoolById(id: SchoolId | null): School | undefined {
  return SCHOOLS.find((s) => s.id === id);
}

export type SchoolId = (typeof SCHOOLS)[number]['id'];

/**
 * The schools this build can actually plan for.
 *
 * Both schools in SCHOOLS have a catalog and degree pages behind them today.
 * The set stays separate from the roster so a school can be added to SCHOOLS
 * before its data exists without being offered: a demo catalog under a real
 * university's name is exactly the kind of false statement a degree planner
 * cannot make.
 */
export const READY_SCHOOL_IDS: ReadonlySet<SchoolId> = new Set<SchoolId>(['illinois', 'uga']);

export function readySchools(): School[] {
  return SCHOOLS.filter((s) => READY_SCHOOL_IDS.has(s.id));
}

export function isReadySchool(id: SchoolId | null | undefined): id is SchoolId {
  return id != null && READY_SCHOOL_IDS.has(id);
}

export interface ExamCreditEntry {
  kind: string;
  exam: string;
  level: string | null;
  score: number | string;
  courses: string[];
  exemptOnly: string[];
  credits: number;
  noCredit: boolean;
  raw: string;
}

/** One exam a student says they took, and the score they got. */
export interface PriorExam {
  kind: string;
  exam: string;
  level: string | null;
  score: number | string;
}

export type AcademicYear = '' | 'first' | 'second' | 'third' | 'fourth' | 'fifth-plus';
export type GraduationSeason = '' | 'Spring' | 'Summer' | 'Fall';

/**
 * An explicit choice, not a catalog program. It lets a student start with an
 * empty horizon and explore without the app guessing a degree for them.
 */
export const UNDECIDED_PROGRAM_ID = '__undecided__';

const GRADUATION_SEASON_ORDER: Record<Exclude<GraduationSeason, ''>, number> = {
  Spring: 0,
  Summer: 1,
  Fall: 2,
};

/** Approximate the active academic term without inventing school-specific dates. */
export function currentAcademicSeason(now = new Date()): Exclude<GraduationSeason, ''> {
  const month = now.getMonth();
  if (month <= 4) return 'Spring';
  if (month <= 7) return 'Summer';
  return 'Fall';
}

/** Past terms are never valid schedule horizons, including earlier terms this year. */
export function isGraduationTermPast(
  season: GraduationSeason,
  year: number | null,
  now = new Date(),
): boolean {
  if (!season || !year) return false;
  const target = year * 3 + GRADUATION_SEASON_ORDER[season];
  const current = now.getFullYear() * 3 + GRADUATION_SEASON_ORDER[currentAcademicSeason(now)];
  return target < current;
}

/**
 * Terms the generator can place work into from now through graduation.
 * Regular plans use fall and spring; a requested summer graduation adds that
 * final summer as a real scheduling term.
 */
export function availablePlanningTerms(
  graduationSeason: GraduationSeason,
  graduationYear: number | null,
  now = new Date(),
): number {
  if (!graduationSeason || !graduationYear || isGraduationTermPast(graduationSeason, graduationYear, now)) {
    return 0;
  }
  const startSeason = currentAcademicSeason(now);
  let season: Exclude<GraduationSeason, ''> = startSeason;
  let year = now.getFullYear();
  let count = 0;
  for (let guard = 0; guard < 32; guard += 1) {
    count += 1;
    if (season === graduationSeason && year === graduationYear) return count;
    if (season === 'Fall') {
      season = 'Spring';
      year += 1;
    } else if (season === 'Spring') {
      if (graduationSeason === 'Summer' && year === graduationYear) season = 'Summer';
      else season = 'Fall';
    } else {
      season = 'Fall';
    }
  }
  return 0;
}

export type ProgramLevel = 'undergraduate' | 'graduate';

/** Planning assumptions, not catalog guarantees. Students can always change the date. */
export function defaultProgramYears(level: ProgramLevel, degrees: readonly string[]): number {
  if (level === 'undergraduate') return 4;
  const years: Record<string, number> = {
    PHD: 5,
    EDD: 3, DMA: 3, DRPH: 3, DSW: 3, JSD: 3, JD: 3,
    MD: 4, DVM: 4, PHARMD: 4,
    EDS: 1, LLM: 1, MSL: 1,
  };
  return degrees.length > 0
    ? Math.max(...degrees.map((degree) => years[degree.replace(/[^a-z]/gi, '').toUpperCase()] ?? 2))
    : 2;
}

export function suggestGraduationTarget(
  academicYear: AcademicYear,
  programYears: number,
  now = new Date(),
): { season: GraduationSeason; year: number | null } {
  if (!academicYear) return { season: '', year: null };
  const currentYear = { first: 1, second: 2, third: 3, fourth: 4, 'fifth-plus': 5 }[academicYear];
  // The current academic year ends next spring in fall, or this spring otherwise.
  const academicEnd = now.getFullYear() + (currentAcademicSeason(now) === 'Fall' ? 1 : 0);
  const year = academicEnd + Math.max(0, programYears - currentYear);
  return {
    season: isGraduationTermPast('Spring', year, now) ? currentAcademicSeason(now) : 'Spring',
    year,
  };
}

export interface OnboardingAnswers {
  setupConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  setupConfirmations?: { programConfirmed: boolean; creditReviewed: boolean; graduationConfirmed: boolean };
  schoolId: SchoolId | null;
  /** Undergraduate or graduate/professional catalog and planning defaults. */
  programLevel: ProgramLevel;
  /** Degree programs the student explicitly selected, primary first. */
  programIds: string[];
  /** Published minors the student wants included in the plan. */
  minorIds: string[];
  /** Published certificates at the selected program level. */
  certificateIds: string[];
  /** Published UGA combined-degree pathway. Admission still needs confirmation. */
  doubleDawgsPathwayId?: string | null;
  doubleDawgsGraduateSeason?: GraduationSeason;
  doubleDawgsGraduateYear?: number | null;
  /** undefined chooses source-backed defaults; [] explicitly shares no courses. */
  doubleDawgsSharedCodes?: string[];
  /**
   * Named focus/emphasis choices, keyed by the requirement id published with
   * the program. Keeping the requirement in the key supports degrees with
   * more than one independent set of required choices.
   */
  emphasisSelections: Record<string, string[]>;
  /** Primary degree-granting college, inferred from the selected major when unambiguous. */
  collegeId: string;
  /** Current year in the program, confirmed after the open-ended questions. */
  academicYear: AcademicYear;
  /** Explicit schedule horizon; the open-ended answer is used to prefill it. */
  graduationSeason: GraduationSeason;
  graduationYear: number | null;
  /** UGA courses the student explicitly marked as completed. */
  alreadyTakenCourseCodes: string[];
  /** Other subjects and interests the student wants the plan to consider. */
  studying: string;
  timeline: string;
  /**
   * When the timeline answer was last written, so "this fall" and "next
   * spring" are read against that day, not the day a plan is rebuilt.
   * Absent on answers saved before it existed.
   */
  timelineAt?: string;
  after: string;
  /**
   * What the student already has. Without this the planner is guessing at the
   * starting point, and a plan that assumes zero credits is wrong on day one
   * for a transfer, a dual-enrollment student, or anyone who took AP exams.
   */
  exams: PriorExam[];
  transferText: string;
  /**
   * The transcript the student uploaded, read by the model and reviewed by
   * them. Optional because answers saved before this field existed have none.
   */
  transcript?: TranscriptRecord | null;
  /**
   * Years of one language other than English in high school, and which one.
   * The university counts a year as a semester toward its language
   * requirement, so three years means no language courses are planned and
   * one year means two or three are. Optional: answers saved before the
   * question existed have neither.
   */
  languageYears?: number | null;
  language?: string;
}

export const EMPTY_ANSWERS: OnboardingAnswers = {
  schoolId: null,
  programLevel: 'undergraduate',
  programIds: [UNDECIDED_PROGRAM_ID],
  minorIds: [],
  certificateIds: [],
  doubleDawgsPathwayId: null,
  emphasisSelections: {},
  collegeId: '',
  academicYear: '',
  graduationSeason: '',
  graduationYear: null,
  alreadyTakenCourseCodes: [],
  studying: '',
  timeline: '',
  after: '',
  exams: [],
  transferText: '',
  transcript: null,
  languageYears: null,
  language: '',
};

/** Retain every earlier answer when reopening setups saved with three questions. */
export function setupResponse(answers: Pick<OnboardingAnswers, 'studying' | 'timeline' | 'after'>): string {
  if (isOneBoxSetup(answers)) return answers.after;
  return [...new Set([answers.studying, answers.timeline, answers.after].map((text) => text.trim()).filter(Boolean))].join('\n\n');
}

export function withSetupResponse(answers: OnboardingAnswers, response: string, at = new Date()): OnboardingAnswers {
  // Timing readers and goal readers share the response. Leave studying empty
  // so interest ranking does not count the same text twice. The goal readers
  // take only the goals from it (goal-words.ts setupWords): the year, the
  // credits and the finish date are timeline, not goals.
  return { ...answers, studying: '', timeline: response, timelineAt: at.toISOString(), after: response };
}

const ACADEMIC_YEAR_PATTERNS: Array<[Exclude<AcademicYear, ''>, RegExp]> = [
  ['fifth-plus', /\b(?:fifth|5th)(?:[- ]year)?\b/i],
  ['fourth', /\b(?:fourth|4th)(?:[- ]year)?\b|\bsenior\b/i],
  ['third', /\b(?:third|3rd)(?:[- ]year)?\b|\bjunior\b/i],
  ['second', /\b(?:second|2nd)(?:[- ]year)?\b|\bsophomore\b/i],
  ['first', /\b(?:first|1st)(?:[- ]year)?\b|\bfreshm[ae]n\b/i],
];

export function inferAcademicYear(text: string): AcademicYear {
  return ACADEMIC_YEAR_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? '';
}

export function inferGraduationTarget(text: string): {
  season: GraduationSeason;
  year: number | null;
} {
  const graduationClause = text.match(
    /(?:graduat\w*|finish\w*|complet\w*|done|degree)\b[^.\n]{0,55}/i,
  )?.[0] ?? '';
  const season = graduationClause.match(/\b(spring|summer|fall)\b/i)?.[1];
  const year = graduationClause.match(/\b(20\d{2})\b/)?.[1];
  return {
    season: season
      ? (`${season[0].toUpperCase()}${season.slice(1).toLowerCase()}` as GraduationSeason)
      : '',
    year: year ? Number(year) : null,
  };
}

/** Structured confirmation wins when free-form text and the selected date disagree. */
export function timelineForPlanning(answers: OnboardingAnswers): string {
  const target = answers.graduationSeason && answers.graduationYear
    ? `I plan to graduate ${answers.graduationSeason} ${answers.graduationYear}.`
    : '';
  return [target, answers.timeline].filter(Boolean).join(' ');
}

/**
 * v2, not v1. A v1 setup could name any of five schools, four of which this
 * build cannot plan, and one that did was quietly moved to Illinois and its
 * owner never asked the three questions. A saved setup from before the roster
 * was trimmed is therefore not read at all: the questions are asked again, once.
 */
const KEY = 'fourYear.onboarding.v2';

export function loadAnswers(): OnboardingAnswers | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingAnswers>;
    if (!parsed.schoolId) return null;
    const savedBoard = !Array.isArray(parsed.programIds) && parsed.schoolId === 'illinois'
      ? readSavedBoard(window.localStorage, parsed.schoolId)
      : null;
    return {
      ...EMPTY_ANSWERS,
      ...parsed,
      transcript: parsed.transcript
        ? { ...parsed.transcript, schoolId: parsed.schoolId === 'uga' ? 'uga' : 'illinois' }
        : null,
      programLevel: parsed.programLevel === 'graduate' ? 'graduate' : 'undergraduate',
      doubleDawgsPathwayId: parsed.schoolId === 'uga' && parsed.programLevel !== 'graduate' && typeof parsed.doubleDawgsPathwayId === 'string'
        ? parsed.doubleDawgsPathwayId : null,
      doubleDawgsGraduateSeason: ['Fall', 'Spring', 'Summer'].includes(parsed.doubleDawgsGraduateSeason ?? '') ? parsed.doubleDawgsGraduateSeason : '',
      doubleDawgsGraduateYear: Number.isInteger(parsed.doubleDawgsGraduateYear) && (parsed.doubleDawgsGraduateYear ?? 0) >= 2000 && (parsed.doubleDawgsGraduateYear ?? 0) <= 2100 ? parsed.doubleDawgsGraduateYear : null,
      doubleDawgsSharedCodes: Array.isArray(parsed.doubleDawgsSharedCodes) ? [...new Set(parsed.doubleDawgsSharedCodes.filter((code): code is string => typeof code === 'string' && /^[A-Z]{2,5} [6-9]\d{3}[A-Z]?$/.test(code)))] : undefined,
      programIds: Array.isArray(parsed.programIds)
        ? parsed.programIds.filter((id): id is string => typeof id === 'string')
        : savedBoard?.programId ? [savedBoard.programId] : [],
      minorIds: Array.isArray(parsed.minorIds)
        ? parsed.minorIds.filter((id): id is string => typeof id === 'string')
        : [],
      certificateIds: Array.isArray(parsed.certificateIds)
        ? parsed.certificateIds.filter((id): id is string => typeof id === 'string')
        : [],
      emphasisSelections:
        parsed.emphasisSelections && typeof parsed.emphasisSelections === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.emphasisSelections).map(([key, value]) => [
                key,
                Array.isArray(value)
                  ? value.filter((id): id is string => typeof id === 'string')
                  : [],
              ]),
            )
          : {},
      collegeId: (() => {
        const id =
          typeof parsed.collegeId === 'string'
            ? normalizeUgaCollegeId(parsed.collegeId)
            : '';
        return UGA_COLLEGE_BY_ID.has(id) ? id : '';
      })(),
      academicYear: ['first', 'second', 'third', 'fourth', 'fifth-plus'].includes(
        parsed.academicYear ?? '',
      )
        ? (parsed.academicYear as AcademicYear)
        : '',
      graduationSeason: ['Spring', 'Summer', 'Fall'].includes(parsed.graduationSeason ?? '')
        ? (parsed.graduationSeason as GraduationSeason)
        : '',
      graduationYear:
        typeof parsed.graduationYear === 'number' &&
        parsed.graduationYear >= 2000 &&
        parsed.graduationYear <= 2100
          ? parsed.graduationYear
          : null,
      alreadyTakenCourseCodes: Array.isArray(parsed.alreadyTakenCourseCodes)
        ? parsed.alreadyTakenCourseCodes.filter(
            (code): code is string => typeof code === 'string',
          )
        : [],
    };
  } catch {
    return null;
  }
}

export function saveAnswers(a: OnboardingAnswers) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* private browsing; the session still works, it just will not be remembered */
  }
}

export function clearAnswers() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** A short line for the planner header, so the answers stay visible. */
export function summarize(a: OnboardingAnswers): string {
  const school = SCHOOLS.find((s) => s.id === a.schoolId);
  const college = a.schoolId === 'uga' ? UGA_COLLEGE_BY_ID.get(a.collegeId)?.name : null;
  const graduation = a.graduationSeason && a.graduationYear
    ? `${a.graduationSeason} ${a.graduationYear}`
    : null;
  return [school?.short, college, graduation, a.studying.split(/[.\n]/)[0]?.trim()]
    .filter(Boolean)
    .join(' · ');
}


/**
 * Course codes the registrar's exam table spells differently from the catalog.
 * The 2026 table writes "JPAN 203" in one row and "JAPN 203" in the next; the
 * catalog has only JAPN, and credit for a code the catalog does not know
 * reached the plan as nothing.
 */
const GRANT_ALIASES: Record<string, string> = { JPAN: 'JAPN' };

/** A granted code in the catalog's spelling. */
export function grantCode(raw: string): string {
  const up = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const space = up.indexOf(' ');
  if (space < 0) return up;
  const subject = up.slice(0, space);
  return GRANT_ALIASES[subject] ? `${GRANT_ALIASES[subject]}${up.slice(space)}` : up;
}

/**
 * Whether a table score cell covers the score a student has.
 *
 * Cells are a number ("4"), a range the builder did not expand ("3 to 5",
 * AP Precalculus), or a phrase with a condition ("3 with a subscore of 4",
 * "4 or 5 (if English Language Score is 4 or 5)"). A phrase is matched only
 * when the student chose that phrase, because the condition is the credit.
 */
export function scoreCovers(cell: number | string, given: number | string): boolean {
  const c = String(cell).trim();
  const g = String(given).trim();
  if (!g) return false;
  if (c.toUpperCase() === g.toUpperCase()) return true;
  if (!/^\d+$/.test(g)) return false;
  const n = Number(g);
  if (/^\d+$/.test(c)) return Number(c) === n;
  const range = c.match(/^(\d+)\s*(?:to|-)\s*(\d+)$/i);
  if (range) return n >= Number(range[1]) && n <= Number(range[2]);
  const list = c.match(/^(\d+(?:\s*(?:,|or)\s*\d+)*)$/i);
  if (list) return list[1].split(/\s*(?:,|or)\s*/i).map(Number).includes(n);
  return false;
}

/**
 * Every row an exam earns. The table writes a grant of two courses as two
 * rows ("AP Biology 5: IB 150" and "AP Biology 5: MCB 150", and the Biology
 * department's page confirms a 5 earns both), so taking the first row lost
 * the second course. Rows repeated word for word in the source are one row.
 */
export function examRows(taken: PriorExam, table: ExamCreditEntry[]): ExamCreditEntry[] {
  const seen = new Set<string>();
  return table.filter((e) => {
    if (e.kind !== taken.kind || e.exam !== taken.exam || (e.level ?? null) !== (taken.level ?? null)) return false;
    if (!scoreCovers(e.score, taken.score)) return false;
    const key = `${e.courses.join(',')}|${e.exemptOnly.join(',')}|${e.credits}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const GRANT_COURSE = /^[A-Z]{2,5} \d{3,4}[A-Z]{0,2}$/;

/**
 * Turn the exams a student reports into the credit the school actually
 * grants, using the registrar's own published equivalence tables.
 *
 * Two outcomes matter and they are different: a course you get CREDIT for
 * counts toward the total, and a course you are only EXEMPT from does not.
 * AP Calculus AB at a 4 grants MATH 2250 and exempts you from MATH 1101 and
 * MATH 1113 with zero hours at UGA. Treating those the same overstates a
 * student's progress by a semester.
 *
 * Hours are counted once per course across exams: AP English Language and
 * AP English Literature both grant RHET 105, and a student with both holds
 * RHET 105 once. A course's hours come from a row that grants it alone; the
 * rest of a row's hours (the "ENGL 1--" in "RHET 105 & ENGL 1--, 7 hours")
 * are counted as that row's own.
 */
export function applyExamCredit(
  exams: PriorExam[],
  table: ExamCreditEntry[],
): { creditCourses: string[]; exemptCourses: string[]; credits: number; unmatched: PriorExam[] } {
  const creditCourses = new Set<string>();
  const exemptCourses = new Set<string>();
  const unmatched: PriorExam[] = [];
  // What a course is worth, read off the rows that grant it alone.
  const alone = new Map<string, number>();
  for (const e of table) {
    if (e.courses.length === 1 && GRANT_COURSE.test(grantCode(e.courses[0])) && e.credits > 0) alone.set(grantCode(e.courses[0]), e.credits);
  }
  // A cumulative award can establish a course that never appears alone:
  // Calculus BC's 8 hours minus Calculus AB's 4 establishes MATH 2260.
  for (let pass = 0; pass < table.length; pass += 1) {
    let added = false;
    for (const row of table) {
      const codes = row.courses.map(grantCode);
      if (!codes.length || codes.some((code) => !GRANT_COURSE.test(code))) continue;
      const unknown = codes.filter((code) => !alone.has(code));
      const remainder = row.credits - codes.reduce((sum, code) => sum + (alone.get(code) ?? 0), 0);
      if (unknown.length === 1 && remainder > 0) {
        alone.set(unknown[0], remainder);
        added = true;
      }
    }
    if (!added) break;
  }
  let credits = 0;

  for (const taken of exams) {
    const rows = examRows(taken, table);
    if (rows.length === 0) { unmatched.push(taken); continue; }
    for (const row of rows) {
      const codes = row.courses.map(grantCode);
      const real = codes.filter((c) => GRANT_COURSE.test(c));
      const known = real.every((c) => alone.has(c));
      if (known) {
        const courseHours = real.reduce((sum, c) => sum + (alone.get(c) ?? 0), 0);
        for (const c of real) if (!creditCourses.has(c)) credits += alone.get(c) ?? 0;
        credits += row.credits - courseHours;
      } else if (!real.some((c) => creditCourses.has(c))) {
        credits += row.credits;
      }
      codes.forEach((c) => creditCourses.add(c));
      row.exemptOnly.forEach((c) => exemptCourses.add(grantCode(c)));
    }
  }

  return {
    creditCourses: [...creditCourses],
    exemptCourses: [...exemptCourses].filter((c) => !creditCourses.has(c)),
    credits: Math.round(credits * 100) / 100,
    unmatched,
  };
}
