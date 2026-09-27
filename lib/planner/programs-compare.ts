/**
 * Two programs side by side, and the second majors a board is closest to.
 *
 * Illinois's degree audit reads one program at a time. Gies tells its double
 * majors "your Degree Audit (DARS) will only display one major at a time"
 * (giesgroups.illinois.edu/advising/double-majors-dual-degrees/), so a
 * Finance student wondering about Accountancy runs a second audit and adds the
 * two up by hand, and nothing tells her whether the pair is a double major
 * (her own degree's hours) or a dual degree (30 more). This reads the second
 * program's page against the student's own board and credit, names what
 * already counts and what it adds, plans the two together to see what they
 * cost in hours and terms, and quotes the colleges' own rules for the pair.
 *
 * Minors and certificates are not here. The crawl read the 308 program pages
 * catalog.illinois.edu/undergraduate/ links, and no minor or certificate page
 * is among them; nothing below guesses at one.
 *
 * Pure: the caller loads and adapts the pages (adaptIllinoisPrograms), this
 * reads them. Counting follows the rail (components/planner/illinois-progress.ts):
 * a course counts once toward a program's major rows and once per gen-ed
 * exclusive group, rows nested in a "to include" pool share with it, and
 * hours the page names no courses for take whatever the named rows left.
 */
import {
  defaultPrereqMatcher,
  degreeSubjects,
  freeElectiveBar,
  generatePlan,
  normaliseCode,
  prereqNeedsApplication,
  validatePlan,
  type AutoplanInput,
  type GeneratedPlan,
  type Horizon,
  type PlanCourseChoice,
  type PlanningContext,
  type PlanRequirement,
  type PlanRule,
  type ValidateOptions,
} from './autoplan';
import { collegeRulesFor } from './college-rules';
import type { Course, PlanState } from './types';

/** When every page quoted below was read. */
export const PAIR_RULES_READ = '2026-09-27';

// ---------------------------------------------------------------------------
// The programs, as the caller hands them over
// ---------------------------------------------------------------------------

export interface ProgramSide {
  /** The catalog path, "bus/finance-bs"; a concentration is "las/psychology-bslas/social-psychology". */
  id: string;
  /** "Finance, BS". The degree is read from the name, because 89 LAS pages carry an empty degree field. */
  name: string;
  /** The college code programs.json uses: "las", "bus", "engineering". */
  college: string;
  url: string;
  /** The page's own total, or null when it states none. */
  totalCredits: number | null;
  requirements: PlanRequirement[];
  /**
   * Hours the page prints for an area, by area id ("bus/accountancy-bs::2" is
   * 21), only where the page's own table prints them (hoursFrom "table").
   */
  pageAreaHours?: Record<string, number>;
}

/**
 * The page's own area hours, from the crawled program file, keyed the way the
 * adapter keys areas (`${programId}::${areaIndex}`, the index into the page's
 * areas). A total the adapter summed is not the page's word and is left out.
 */
export function pageAreaHoursOf(programId: string, raw: { areas?: Array<{ hours?: number | null; hoursFrom?: string | null }> } | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  (raw?.areas ?? []).forEach((area, index) => {
    if (area.hoursFrom === 'table' && typeof area.hours === 'number' && area.hours > 0) out[`${programId}::${index}`] = area.hours;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Which pair this is, by the colleges' own pages
// ---------------------------------------------------------------------------

export type PairKind =
  /** The same page twice. */
  | 'same-program'
  /** Two concentrations of one major, or a major and one of its concentrations. */
  | 'concentration'
  /** A second major inside the student's degree: the degree's own hours. */
  | 'double-major'
  /** A second bachelor's degree: at least 30 more Illinois hours. */
  | 'dual-degree'
  /** A pair a college's page rules out. */
  | 'not-allowed'
  /** Two programs in a college whose page on second majors was not read. */
  | 'ask-college';

export interface PairRule {
  /** The rule, in the page's words where they are short enough to quote. */
  text: string;
  source: string;
}

export interface PairReading {
  kind: PairKind;
  /** One sentence for the student: what the pair is and why. */
  summary: string;
  /**
   * The hours the pair is planned to: the larger of the two totals for a
   * double major (a second major is inside one degree), 30 past it for a dual
   * degree (LAS and Grainger: "an additional 30 hours above those required
   * for the degree with the highest number of total required hours").
   */
  total: number;
  rules: PairRule[];
}

const SOURCES = {
  lasDouble: 'https://las.illinois.edu/academics/programs/double',
  lasDual: 'https://las.illinois.edu/academics/programs/dual',
  gies: 'https://giesgroups.illinois.edu/advising/double-majors-dual-degrees/',
  grainger: 'https://advising.grainger.illinois.edu/degree-programs/dual-degrees',
  studentCode: 'https://studentcode.illinois.edu/article3/part8/3-801',
  chemistry: 'https://chemistry.illinois.edu/admissions/undergraduate/undergraduate-degree-programs',
} as const;

/*
 * Each rule below was read on the page beside it on 2026-09-27.
 *
 * las.illinois.edu/academics/programs/double: "In the course of fulfilling the degree requirements, LAS students may
 * complete the minimum requirements for a second program of study in LAS"; "Multiple majors cannot be declared across
 * colleges"; the online LAS Multiple Major Declaration Form, "any time except the months of April and November"; "A
 * course cannot count toward requirements of more than two majors"; "Major combinations with significant course
 * overlap are not allowed"; "You must earn at least 12 hours of distinct, advanced level course work in the major
 * discipline"; "Multiple majors are not available to students in Specialized Curricula."
 */
const LAS_DOUBLE: PairRule[] = [
  { text: 'LAS students may complete the minimum requirements for a second program of study in LAS, declared on the online LAS Multiple Major Declaration Form any time except April and November; multiple majors cannot be declared across colleges.', source: SOURCES.lasDouble },
  { text: 'A course cannot count toward requirements of more than two majors, and major combinations with significant course overlap are not allowed.', source: SOURCES.lasDouble },
  { text: 'At least 12 hours of distinct, advanced level course work in the (second) major discipline.', source: SOURCES.lasDouble },
];

/*
 * las.illinois.edu/academics/programs/dual: for "Students in LAS Specialized Curricula for whom multiple majors are not
 * otherwise an option and undergraduates in other colleges ... who wish to add a LAS degree program"; "Students in LAS
 * pursuing an additional degree program in a University of Illinois college other than LAS must apply directly to that
 * college"; "An Illinois GPA of 3.00 will be required of all students at the time of application"; "all of the
 * requirements specified for both degree programs as well as an additional 30 hours above those required for the
 * degree with the highest number of total required hours"; "at least 12 hours of distinct, advanced level coursework
 * in the LAS major discipline"; "enrolled in LAS for a minimum of two semesters"; "a maximum of 10 semesters"; "must
 * graduate from both degree programs in the same semester"; application "no later than one month prior to the start of
 * the student's seventh term" (an 8-semester plan) or ninth (a 10-semester plan).
 */
const LAS_DUAL: PairRule[] = [
  { text: 'An LAS dual degree needs an Illinois GPA of 3.00 when applying, every requirement of both programs plus 30 hours above the degree with the higher total, at least 12 distinct advanced hours in the LAS major, two semesters enrolled in LAS, graduation from both in the same semester, and at most 10 semesters in all; apply no later than a month before the seventh term (an eight-semester plan).', source: SOURCES.lasDual },
  { text: 'A student in LAS adding a degree in another college applies to that college for dual-degree candidacy; a student in another college adding an LAS degree follows the LAS dual-degree procedure.', source: SOURCES.lasDual },
];

/*
 * giesgroups.illinois.edu/advising/double-majors-dual-degrees/: "If you elect to pursue two Gies Majors, you must fulfill
 * the course requirements for both majors" with "a minimum of 124 credit hours to earn one degree"; "It is not possible
 * to choose three majors for one degree"; a primary and a secondary major; go.business.illinois.edu/declaremajor; "your
 * Degree Audit (DARS) will only display one major at a time". Dual degrees: "fulfill the course requirements for all
 * majors and earn at least 30 additional hours of University of Illinois at Urbana Champaign credit (minimum of 154
 * hours)"; "complete both degrees within 9 semesters", a 10th Semester Petition beyond; "A dual degree between Gies
 * College of Business and Grainger College of Engineering is not possible."
 */
const GIES_DOUBLE: PairRule[] = [
  { text: 'Two Gies majors in one degree: the course requirements of both, a minimum of 124 hours, a primary and a secondary major (declared at go.business.illinois.edu/declaremajor), never three majors; the degree audit (DARS) shows one major at a time.', source: SOURCES.gies },
];
const GIES_DUAL: PairRule[] = [
  { text: 'A Gies dual degree with another college: the requirements of all majors and at least 30 more Illinois hours (a minimum of 154), both degrees within 9 semesters (a tenth needs a petition).', source: SOURCES.gies },
];
const GIES_GRAINGER: PairRule = { text: 'A dual degree between Gies College of Business and Grainger College of Engineering is not possible.', source: SOURCES.gies };

/*
 * advising.grainger.illinois.edu/degree-programs/dual-degrees: "Complete at least 30 additional credit hours beyond
 * those required for the degree with the highest number of total hours"; "Earn 12 credit hours of distinct,
 * advanced-level coursework"; "Be enrolled in the Grainger College of Engineering for a minimum of two semesters";
 * current Grainger students "Submit a dual degree request during the second to fifth semester"; others "submit a
 * petition at the end of their 4th or 5th semester (students may petition a maximum of two times)"; within Grainger,
 * "meet the eligibility requirements of that department"; "CS and CS+ENG majors are not eligible for dual degree
 * petitions."
 */
const GRAINGER_DUAL: PairRule[] = [
  { text: 'A Grainger dual degree: 30 hours beyond the degree with the higher total, 12 distinct advanced hours, two semesters enrolled in Grainger; a Grainger student requests it in the second to fifth semester, a student from another college petitions at the end of the fourth or fifth (at most twice), and a second Grainger major must meet that department\'s eligibility rules.', source: SOURCES.grainger },
  { text: '"CS and CS+ENG majors are not eligible for dual degree petitions."', source: SOURCES.grainger },
];

/*
 * studentcode.illinois.edu/article3/part8/3-801: an additional bachelor's degree, "earned either concurrently with or
 * subsequent to the first degree", needs "at least 30 semester hours of University of Illinois Urbana-Champaign credit
 * that is not counted for the other degree."
 */
const STUDENT_CODE: PairRule = {
  text: 'A second bachelor\'s degree, earned at the same time or after, needs at least 30 semester hours of Illinois credit not counted for the other degree (Student Code 3-801).',
  source: SOURCES.studentCode,
};

/** "Economics, BALAS" is BALAS; "Linguistics & ..., BALAS (TESL)" too. */
export function degreeOfName(name: string): string {
  const m = name.match(/,\s*([A-Z]{2,6})\b[^,]*$/);
  return m ? m[1] : '';
}

/**
 * An LAS degree titled BS rather than BALAS, BSLAS or BLS. The Chemistry
 * department calls its BS "the Specialized Curriculum in Chemistry" beside
 * the Sciences and Letters BSLAS, and LAS's own pages give Specialized
 * Curricula dual degrees, not multiple majors.
 */
export function lasSpecialized(side: Pick<ProgramSide, 'college' | 'name'>): boolean {
  return side.college === 'las' && degreeOfName(side.name) === 'BS';
}

/** "las/psychology-bslas/social-psychology" belongs to "las/psychology-bslas". */
function majorOf(id: string): string {
  return id.split('/').slice(0, 2).join('/');
}

/** The college's own name, from the table ALMA already names offices from. */
const collegeName = (code: string): string => {
  const rules = collegeRulesFor(code);
  return rules.name === 'your college' ? code : rules.name;
};

/**
 * Whether the pair is a double major or a dual degree, and the rules that
 * decide it, from the pages of the colleges involved. A college whose page
 * was not read gets the Student Code's rule for a second degree and its own
 * office, never a guessed rule.
 */
export function pairOf(primary: Pick<ProgramSide, 'id' | 'name' | 'college' | 'totalCredits'>, second: Pick<ProgramSide, 'id' | 'name' | 'college' | 'totalCredits'>): PairReading {
  const higher = Math.max(primary.totalCredits || 120, second.totalCredits || 120);
  if (primary.id === second.id) {
    return { kind: 'same-program', summary: `${second.name} is the program already on the board.`, total: higher, rules: [] };
  }
  if (majorOf(primary.id) === majorOf(second.id)) {
    return {
      kind: 'concentration',
      summary: `${primary.name} and ${second.name} are the same major with a different concentration: choosing the other concentration is the department's decision, not a second major.`,
      total: higher,
      rules: [],
    };
  }
  const colleges = new Set([primary.college, second.college]);
  if (colleges.has('bus') && colleges.has('engineering')) {
    return { kind: 'not-allowed', summary: `Gies and Grainger do not allow a dual degree between them, so ${second.name} cannot be added to ${primary.name}.`, total: higher + 30, rules: [GIES_GRAINGER, STUDENT_CODE] };
  }
  if (primary.college === second.college) {
    const college = primary.college;
    if (college === 'las') {
      const special = [primary, second].filter(lasSpecialized);
      if (special.length > 0) {
        return {
          kind: 'dual-degree',
          summary: `${special.map((s) => s.name).join(' and ')} ${special.length === 1 ? 'is an LAS Specialized Curriculum' : 'are LAS Specialized Curricula'}, where LAS offers no multiple majors, so the pair is a dual degree: 30 hours past ${higher}.`,
          total: higher + 30,
          rules: [...LAS_DUAL, { text: 'The Chemistry department names its BS the Specialized Curriculum in Chemistry, beside the Sciences and Letters BSLAS; the planner reads every LAS degree titled BS the same way.', source: SOURCES.chemistry }, STUDENT_CODE],
        };
      }
      return { kind: 'double-major', summary: `Both are LAS Sciences and Letters majors, so ${second.name} can be a second major inside the same degree: no hours past ${higher}.`, total: higher, rules: LAS_DOUBLE };
    }
    if (college === 'bus') {
      return { kind: 'double-major', summary: `Both are Gies majors, so ${second.name} can be a secondary major in the same degree: no hours past ${higher}.`, total: higher, rules: GIES_DOUBLE };
    }
    if (college === 'engineering') {
      return { kind: 'dual-degree', summary: `Grainger treats a second Grainger major as a dual degree: 30 hours past ${higher}, and the department's own eligibility rules.`, total: higher + 30, rules: [...GRAINGER_DUAL, STUDENT_CODE] };
    }
    return {
      kind: 'ask-college',
      summary: `Both are in the ${collegeName(college)}, whose page on second majors the planner has not read. Planned here as a second major in one degree; if the college treats it as a second degree, the Student Code adds 30 hours. Ask ${collegeRulesFor(college).office}.`,
      total: higher,
      rules: [STUDENT_CODE],
    };
  }
  const rules: PairRule[] = [];
  if (colleges.has('las')) rules.push(...LAS_DUAL);
  if (colleges.has('bus')) rules.push(...GIES_DUAL);
  if (colleges.has('engineering')) rules.push(...GRAINGER_DUAL);
  if (colleges.has('las')) rules.push(LAS_DOUBLE[0]);
  rules.push(STUDENT_CODE);
  return {
    kind: 'dual-degree',
    summary: `${primary.name} (${collegeName(primary.college)}) and ${second.name} (${collegeName(second.college)}) are in different colleges, so the pair is a dual degree, not a double major: at least 30 hours past ${higher}, and an application to the college of the added degree.`,
    total: higher + 30,
    rules,
  };
}

/**
 * The sentences a page prints about a second major counting for one of its
 * own requirements: Political Science's "Students will select a second major,
 * or a minor, or a set of courses of at least 12 hours ... outside political
 * science", Spanish's "Supporting course work, a minor, or a second major",
 * Mathematics's "or any double major or dual degree". Quoted, never applied:
 * the department approves it.
 */
export function secondMajorSentences(side: Pick<ProgramSide, 'requirements' | 'url' | 'name'>): PairRule[] {
  const out: PairRule[] = [];
  const seen = new Set<string>();
  for (const r of side.requirements) {
    const text = [r.note, r.rule.kind === 'unparsed' ? r.rule.text : ''].join(' ');
    for (const sentence of text.split(/(?<=[.;])\s+|\s+(?=Select\b|Students will\b)/)) {
      if (!/\b(second major|double major|dual degree)\b/i.test(sentence)) continue;
      const clean = sentence.replace(/\s+/g, ' ').trim();
      if (seen.has(clean)) continue;
      seen.add(clean);
      out.push({ text: `${side.name}: "${clean.length > 320 ? `${clean.slice(0, 317)}...` : clean}"`, source: side.url });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One program's requirements against what the student has
// ---------------------------------------------------------------------------

export type RowStatus =
  /** Met by what is held or on the board. */
  | 'met'
  /** Courses still to take, named in `take`. */
  | 'open'
  /** Hours the page sizes but names no courses for. */
  | 'unnamed'
  /** Hours whose own words are about reaching the degree total: free electives. */
  | 'total'
  /** A row the planner could not read. */
  | 'unread';

export interface RowReading {
  id: string;
  /** The page's words for the row. */
  label: string;
  kind: PlanRule['kind'];
  /** A campus general education row (a category, or hours drawn from one), which both programs share. */
  genEd: boolean;
  status: RowStatus;
  /** Held or planned codes the row counts. */
  counted: string[];
  /** What is still owed, in the unit the page sized it in. */
  owed: { amount: number; unit: 'hr' | 'course' | 'semester' } | null;
  /** The courses the planner would take for what is owed, best first. */
  take: string[];
  /** Other courses the row accepts, for the student to choose among. */
  options: string[];
  /** For an unnamed or unread row, what the page or the planner says about it. */
  note?: string;
}

export interface ProgramReading {
  rows: RowReading[];
  /** Codes the program's major rows count: its lists, choices and pools, and hours in its own subjects ("Concentration Coursework"). */
  majorCounted: Set<string>;
  /** Every code any row counts, gen-ed rows included. */
  counted: Set<string>;
  /** Courses to take across the rows, in page order, each once. */
  take: string[];
  /** Hours of `take`, at the catalog's credits. */
  takeHours: number;
  /** Hours the page sizes and names no courses for, still owed. */
  unnamedHours: number;
  /** Semesters of a language still owed beyond what the student's plan books. */
  languageOwed: number;
  /** Rows the planner could not read at all. */
  unread: number;
  /** Named courses the catalog will not credit beside one the student has, and which. */
  standIns: string[];
}

export interface ReadInput {
  context: PlanningContext;
  side: Pick<ProgramSide, 'requirements' | 'name' | 'college'>;
  /** Codes held, from the student's credit. They count before anything planned. */
  heldCodes: string[];
  /** Codes on the board, in term order. */
  boardCodes: string[];
  /**
   * The language sequence the student's plan counts: semesters behind them and
   * the courses it books. A program asking for a fourth semester when the plan
   * books to the third owes one.
   */
  language?: { completed: number; codes: string[] } | null;
  /** How well a course fits the student's priorities, 0 to 1 (the board's scorer), to order a list's picks. */
  fit?: (code: string) => number;
  /**
   * Take a list's courses in the page's order instead of ranking them. The
   * counts are the same; a scan over every program only needs the counts, and
   * ranking a 170-course list against the prerequisites costs the most.
   */
  pageOrder?: boolean;
}

const MAJOR_KINDS = new Set<PlanRule['kind']>(['all', 'choose', 'pool']);

/** The catalog by code, built once per catalog: a scan reads three hundred programs against the same one. */
const byCodeCache = new WeakMap<Course[], Map<string, Course>>();
function catalogByCode(ctx: Pick<PlanningContext, 'courses'>): Map<string, Course> {
  const known = byCodeCache.get(ctx.courses);
  if (known) return known;
  const made = new Map<string, Course>(ctx.courses.map((c) => [normaliseCode(c.code), c]));
  byCodeCache.set(ctx.courses, made);
  return made;
}
/** Hours rows whose own words make them the degree's free electives, met by reaching the total. */
const TOTAL_WORDS = /\bso that there (?:are|is) at least\b|\bfree electives?\b|\bminimum (?:required )?hours\b|\bhours required for graduation\b|\bdegree hours\b|\bminimum hours required\b/i;

function levelOf(code: string): number {
  const m = code.match(/\b(\d)\d\d[A-Z]?$/);
  return m ? Number(m[1]) * 100 : 0;
}

/** Rows inside a "to include" pool, as the engine and the rail read them. */
function nestedParents(requirements: PlanRequirement[]): Map<string, string> {
  const parentOf = new Map<string, string>();
  requirements.forEach((requirement, index) => {
    if (requirement.rule.kind !== 'pool' || !/\bto include\b/i.test(requirement.label)) return;
    for (const later of requirements.slice(index + 1)) {
      if (later.areaId !== requirement.areaId) break;
      if ((later.rule.kind === 'choose' || later.rule.kind === 'pool') && /^select\b/i.test(later.label)) parentOf.set(later.id, requirement.id);
    }
  });
  return parentOf;
}

/** The page's words for a row, or its first courses where it printed no heading. */
function rowLabel(r: PlanRequirement): string {
  const own = (r.label || (r.rule.kind === 'pool' || r.rule.kind === 'hours' || r.rule.kind === 'gened' ? r.rule.label : '') || '').replace(/\s+/g, ' ').trim();
  if (own) return own.length > 90 ? `${own.slice(0, 87)}...` : own;
  if (r.rule.kind === 'all' || r.rule.kind === 'choose' || r.rule.kind === 'pool') {
    const codes = r.rule.choices.map((c) => c.codes[0]).filter(Boolean);
    return codes.length <= 3 ? codes.join(', ') : `${codes.slice(0, 3).join(', ')} and ${codes.length - 3} more`;
  }
  return r.areaLabel || r.rule.kind;
}

/**
 * The order to take courses in for an open row: nothing behind an
 * application or written for other students (freeElectiveBar), no thesis,
 * research, topics or one-credit piece first (the engine's own rule for a
 * technical-elective list: ECE 499 "Senior Thesis" is on the list so a
 * student who wants it can count it), one that has run recently, fewest
 * prerequisites the student lacks, the better fit for their priorities, lower
 * level, then the page's own order. Economics's "11 hours of 300 or 400-level
 * MATH" offered MATH 490, 492 and 499 first, research and a graduate
 * seminar with nothing parsed in front of them. A list is a choice the
 * student makes; this is the planner's opening offer, and the rest go back as
 * options.
 */
function ranker(ctx: PlanningContext, have: Set<string>, byCode: Map<string, Course>, side: Pick<ProgramSide, 'requirements' | 'name' | 'college'>, fit?: (code: string) => number) {
  const matcher = ctx.prereqCheck ?? defaultPrereqMatcher;
  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const read = degreeSubjects(side.requirements, side.name);
  const bar = freeElectiveBar(ctx, byCode, { college: side.college, primary: read.primary, programName: side.name });
  const memo = new Map<string, number[]>();
  const key = (code: string): number[] => {
    const known = memo.get(code);
    if (known) return known;
    const title = byCode.get(code)?.title ?? '';
    const made = [
      prereqNeedsApplication(ctx.prereqs?.get(code)?.text) || bar(code) ? 1 : 0,
      /\b(thesis|independent study|research|special topics|topics in|internship|honors|seminar)\b/i.test(title) || (byCode.get(code)?.credits ?? 3) < 3 ? 1 : 0,
      ctx.offeringTerms?.length && (ctx.offerings?.get(code) ?? []).length === 0 ? 1 : 0,
      matcher(ctx.prereqs?.get(code) ?? null, have, new Set(), equivalents).missing.length,
      -Math.round((fit?.(code) ?? 0) * 10),
      levelOf(code),
    ];
    memo.set(code, made);
    return made;
  };
  return (codes: string[]): string[] => {
    const order = new Map(codes.map((c, i) => [c, i]));
    return [...codes].sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return (order.get(a) ?? 0) - (order.get(b) ?? 0);
    });
  };
}

/**
 * One program's page read against the student's held credit and board, row
 * by row: what counts, what is owed, and the courses the planner would take
 * for it. The primary program is read the same way, so the courses both
 * major lists count can be told from courses one program merely has room for.
 */
export function readProgram(input: ReadInput): ProgramReading {
  const { context: ctx, side } = input;
  const byCode = catalogByCode(ctx);
  const credits = (code: string): number => byCode.get(code)?.credits ?? 0;
  const equivalents = ctx.equivalents ?? new Map<string, string[]>();
  const held = input.heldCodes.map(normaliseCode);
  const have: string[] = [];
  for (const code of [...held, ...input.boardCodes.map(normaliseCode)]) if (!have.includes(code)) have.push(code);
  const haveSet = new Set(have);
  // A requirement written as AAS 200 is met by a held LLS 200.
  const hit = (raw: string): string | null => {
    const code = normaliseCode(raw);
    if (haveSet.has(code)) return code;
    for (const alias of equivalents.get(code) ?? []) if (haveSet.has(normaliseCode(alias))) return normaliseCode(alias);
    return null;
  };
  // "Credit is not given for both": a course the catalog would not credit beside one the student has is no pick.
  const blockedBy = (code: string): string | null => (ctx.exclusions?.get(code) ?? []).map(normaliseCode).find((other) => haveSet.has(other)) ?? null;
  const blocked = (code: string): boolean => blockedBy(code) !== null;
  const standIns: string[] = [];
  const rank = input.pageOrder ? (codes: string[]) => codes : ranker(ctx, haveSet, byCode, side, input.fit);

  const parentOf = nestedParents(side.requirements);
  const parents = new Set(parentOf.values());
  const spentMajor = new Set<string>();
  const spentBy = new Map<string, string>();
  const planned = new Set<string>();
  let current = '';
  const related = (a: string | undefined, b: string): boolean => Boolean(a) && (parentOf.get(a as string) === b || parentOf.get(b) === a);
  const takenElsewhere = (code: string): boolean => spentMajor.has(code) && !related(spentBy.get(code), current);
  const spendMajor = (code: string): void => {
    if (!spentBy.has(code)) spentBy.set(code, current);
    spentMajor.add(code);
    for (const alias of equivalents.get(code) ?? []) spentMajor.add(normaliseCode(alias));
  };
  const genEdLedgers = new Map<string, Set<string>>();
  const ledger = (group: string): Set<string> => {
    const found = genEdLedgers.get(group);
    if (found) return found;
    const made = new Set<string>();
    genEdLedgers.set(group, made);
    return made;
  };
  /** A pick the planner makes for an open row: in the catalog, not held, not taken by another row's pick. */
  const pickable = (code: string): boolean => byCode.has(code) && !haveSet.has(code) && !planned.has(code) && !blocked(code);
  const choiceHit = (choice: PlanCourseChoice): string | null => {
    for (const raw of [...choice.codes, ...(choice.substitutes ?? [])]) {
      const code = hit(raw);
      if (code && !takenElsewhere(code)) return code;
    }
    return null;
  };
  const choiceWorth = (choice: PlanCourseChoice, got: string | null): number =>
    (got ? credits(got) : 0) || choice.credits || choice.codes.map((c) => credits(normaliseCode(c))).find((n) => n > 0) || 0;

  const rows = new Map<string, RowReading>();
  const leftovers: PlanRequirement[] = [];
  const pageOrder = new Map(side.requirements.map((r, i) => [r.id, i]));
  // Specific rows claim before open lists, and a "to include" pool after the rows nested in it, as the rail does.
  const claimOrder = [...side.requirements].sort(
    (a, b) =>
      Number(a.rule.kind === 'pool') - Number(b.rule.kind === 'pool') ||
      Number(parents.has(a.id)) - Number(parents.has(b.id)) ||
      (pageOrder.get(a.id) ?? 0) - (pageOrder.get(b.id) ?? 0),
  );
  let languageOwed = 0;

  for (const r of claimOrder) {
    current = r.id;
    const rule = r.rule;
    const genEd = rule.kind === 'gened' || (rule.kind === 'hours' && (rule.genEd ?? []).length > 0);
    const base: RowReading = { id: r.id, label: rowLabel(r), kind: rule.kind, genEd, status: 'met', counted: [], owed: null, take: [], options: [] };

    if (rule.kind === 'unparsed') {
      rows.set(r.id, { ...base, status: 'unread', note: rule.text.replace(/\s+/g, ' ').slice(0, 240) });
      continue;
    }

    if (rule.kind === 'language') {
      const lang = input.language;
      const reached = lang ? lang.completed + lang.codes.map(normaliseCode).filter((c) => haveSet.has(c)).length : null;
      const owed = reached === null ? 0 : Math.max(0, rule.semesters - reached);
      languageOwed = Math.max(languageOwed, owed);
      rows.set(r.id, {
        ...base,
        status: owed > 0 ? 'open' : 'met',
        owed: owed > 0 ? { amount: owed, unit: 'semester' } : null,
        note: reached === null ? `${rule.semesters === 4 ? 'Fourth' : 'Third'}-semester language; the planner does not know how many semesters the student brings.` : `${rule.semesters === 4 ? 'Fourth' : 'Third'}-semester language; the plan reaches semester ${reached}.`,
      });
      continue;
    }

    if (genEd && (rule.kind === 'gened' || rule.kind === 'hours')) {
      const tags = new Set(rule.kind === 'gened' ? rule.genEd : (rule.genEd ?? []));
      const wantHours = rule.hours;
      const wantCourses = rule.kind === 'gened' ? rule.courses : null;
      const own = rule.kind === 'gened' ? ledger(rule.exclusiveGroup) : new Set([...genEdLedgers.values()].flatMap((s) => [...s]));
      let hours = 0;
      let courses = 0;
      const counted: string[] = [];
      const met = () => (wantHours === null || hours >= wantHours) && (wantCourses === null || courses >= wantCourses);
      const tagged = have
        .filter((code) => !own.has(code) && (byCode.get(code)?.tags ?? []).some((t) => tags.has(t)))
        .sort((a, b) => credits(a) - credits(b) || a.localeCompare(b));
      for (const code of tagged) {
        if (met()) break;
        own.add(code);
        counted.push(code);
        courses += 1;
        hours += credits(code);
      }
      const owed = wantHours !== null && hours < wantHours ? { amount: wantHours - hours, unit: 'hr' as const } : wantCourses !== null && courses < wantCourses ? { amount: wantCourses - courses, unit: 'course' as const } : null;
      rows.set(r.id, { ...base, status: owed ? 'open' : 'met', counted, owed });
      continue;
    }

    if (rule.kind === 'hours') {
      leftovers.push(r);
      continue;
    }

    if (rule.kind === 'all') {
      const counted: string[] = [];
      const take: string[] = [];
      let owedHours = 0;
      for (const choice of rule.choices) {
        if (choice.bundles && choice.bundles.length > 0) {
          // One of several sets taken whole: the set the student is furthest into, else the first.
          const scored = choice.bundles.map((bundle) => {
            const codes = bundle.map(normaliseCode);
            return { codes, hits: codes.filter((c) => hit(c) !== null && !takenElsewhere(hit(c) as string)) };
          });
          const best = scored.reduce((a, b) => (b.hits.length > a.hits.length ? b : a));
          for (const code of best.codes) {
            const got = hit(code);
            if (got && !takenElsewhere(got)) {
              spendMajor(got);
              counted.push(got);
            } else if (pickable(code)) {
              take.push(code);
              planned.add(code);
              owedHours += credits(code);
            }
          }
          continue;
        }
        const got = choiceHit(choice);
        if (got) {
          spendMajor(got);
          counted.push(got);
          continue;
        }
        // "CS 210 or CS 211": the planner's pick of the two, the other kept as an option.
        const codes = choice.codes.map(normaliseCode);
        const alternatives = rank(codes.filter(pickable));
        if (alternatives.length === 0) {
          // Economics lists ECON 202; a Psychology board holds PSYC 235, and
          // the catalog credits only one of the two. Booking ECON 202 earns
          // nothing, and whether PSYC 235 meets the row is the department's call.
          const beside = codes.map((code) => ({ code, by: blockedBy(code) })).find((x) => x.by !== null);
          if (beside) standIns.push(`${beside.code} (${rowLabel(r)}): the catalog gives no credit for it beside ${beside.by}, which the student has; the department decides whether ${beside.by} meets the row.`);
          continue;
        }
        take.push(alternatives[0]);
        planned.add(alternatives[0]);
        owedHours += choiceWorth(choice, alternatives[0]);
      }
      rows.set(r.id, { ...base, status: take.length > 0 ? 'open' : 'met', counted, take, owed: take.length > 0 ? { amount: owedHours, unit: 'hr' } : null });
      continue;
    }

    if (rule.kind === 'choose') {
      const want = Math.min(rule.n, rule.choices.length) || rule.n;
      const counted: string[] = [];
      const open: PlanCourseChoice[] = [];
      for (const choice of rule.choices) {
        const got = counted.length < want ? choiceHit(choice) : null;
        if (got) {
          spendMajor(got);
          counted.push(got);
        } else open.push(choice);
      }
      const need = Math.max(0, want - counted.length);
      const ranked = rank(open.map((c) => rank(c.codes.map(normaliseCode).filter(pickable))[0]).filter((c): c is string => Boolean(c)));
      const take = ranked.slice(0, need);
      for (const code of take) planned.add(code);
      rows.set(r.id, {
        ...base,
        status: need > 0 ? 'open' : 'met',
        counted,
        take,
        options: ranked.slice(need, need + 8),
        owed: need > 0 ? { amount: need, unit: 'course' } : null,
      });
      continue;
    }

    // A pool: "N hours, or N courses, from this list".
    const hoursTarget = rule.hours;
    const countTarget = rule.n;
    if (hoursTarget === null && countTarget === null) {
      rows.set(r.id, { ...base, status: 'unread', note: 'The page lists these courses without saying how many to take.' });
      continue;
    }
    const counted: string[] = [];
    let hours = 0;
    const full = (h: number, n: number) => (hoursTarget === null || h >= hoursTarget) && (countTarget === null || n >= countTarget);
    // What the rows nested in this one counted is part of its hours.
    const nestedHere = [...spentBy].filter(([, by]) => parentOf.get(by) === r.id).map(([code]) => code);
    for (const code of nestedHere) {
      if (full(hours, counted.length)) break;
      counted.push(code);
      hours += credits(code);
    }
    for (const choice of rule.choices) {
      if (full(hours, counted.length)) break;
      const got = choiceHit(choice);
      if (!got || counted.includes(got)) continue;
      spendMajor(got);
      counted.push(got);
      hours += choiceWorth(choice, got);
    }
    const ranked = rank([...new Set(rule.choices.flatMap((c) => c.codes.map(normaliseCode)))].filter(pickable));
    const take: string[] = [];
    let h = hours;
    let n = counted.length;
    for (const code of ranked) {
      if (full(h, n)) break;
      take.push(code);
      planned.add(code);
      h += credits(code) || 3;
      n += 1;
    }
    const owed =
      hoursTarget !== null && hours < hoursTarget
        ? { amount: hoursTarget - hours, unit: 'hr' as const }
        : countTarget !== null && counted.length < countTarget
          ? { amount: countTarget - counted.length, unit: 'course' as const }
          : null;
    rows.set(r.id, { ...base, status: owed ? 'open' : 'met', counted, take, options: ranked.filter((c) => !take.includes(c)).slice(0, 8), owed });
  }

  // Hours the page names no courses for, from whatever the named rows left.
  let unnamedHours = 0;
  /** Codes counted by the major's own unnamed hours ("Concentration Coursework"): major courses too. */
  const majorHours = new Set<string>();
  if (leftovers.length > 0) {
    const genEdSpent = new Set([...genEdLedgers.values()].flatMap((s) => [...s]));
    const languageCodes = new Set((input.language?.codes ?? []).map(normaliseCode));
    const free = have.filter((code) => !spentMajor.has(code) && !genEdSpent.has(code) && !languageCodes.has(code));
    const read = degreeSubjects(side.requirements, side.name);
    const ownSubjects = new Set([...read.subjects, ...(read.primary ? [read.primary] : [])]);
    const taken = new Set<string>();
    for (const r of leftovers) {
      if (r.rule.kind !== 'hours') continue;
      const rule = r.rule;
      const words = `${r.label} ${rule.label} ${r.note}`;
      if (TOTAL_WORDS.test(words)) {
        rows.set(r.id, { id: r.id, label: rowLabel(r), kind: 'hours', genEd: false, status: 'total', counted: [], owed: null, take: [], options: [], note: 'Hours toward the degree total, which the plan reaches with electives.' });
        continue;
      }
      // "Concentration Coursework, 28 hours" is courses in the major, not any spare course.
      const majorOnly = /\b(concentration|major)\b/i.test(`${r.label} ${r.areaLabel}`) && ownSubjects.size > 0;
      const floor = rule.minLevel ?? null;
      const excluded = new Set((rule.exclude ?? []).map(normaliseCode));
      const counted: string[] = [];
      let hours = 0;
      for (const code of free) {
        if (hours >= rule.hours) break;
        if (taken.has(code) || excluded.has(code)) continue;
        if (floor !== null && levelOf(code) < floor) continue;
        if (majorOnly && !ownSubjects.has(code.split(' ')[0])) continue;
        taken.add(code);
        counted.push(code);
        if (majorOnly) majorHours.add(code);
        hours += credits(code);
      }
      const owed = Math.max(0, rule.hours - hours);
      unnamedHours += owed;
      const which = [majorOnly ? `in ${[...ownSubjects].slice(0, 4).join(', ')}` : null, floor !== null ? `at the ${floor} level or above` : null].filter(Boolean).join(' ');
      rows.set(r.id, {
        id: r.id,
        label: rowLabel(r),
        kind: 'hours',
        genEd: false,
        status: owed > 0 ? 'unnamed' : 'met',
        counted,
        owed: owed > 0 ? { amount: owed, unit: 'hr' } : null,
        take: [],
        options: [],
        note: owed > 0 ? `${rule.hours} hours the page names no courses for${which ? `, ${which}` : ''}; the student and the department choose them.` : undefined,
      });
    }
  }

  const ordered = side.requirements.map((r) => rows.get(r.id)).filter((x): x is RowReading => Boolean(x));
  const take = [...new Set(ordered.flatMap((row) => row.take))];
  const counted = new Set(ordered.flatMap((row) => row.counted));
  return {
    rows: ordered,
    majorCounted: new Set([...spentMajor, ...majorHours].filter((c) => haveSet.has(c))),
    counted,
    take,
    takeHours: take.reduce((sum, code) => sum + credits(code), 0),
    unnamedHours,
    languageOwed,
    unread: ordered.filter((row) => row.status === 'unread').length,
    standIns,
  };
}

/** Hours a row asks for as the planner reads it, a course counted at 3 where the page gives none. */
function rowHours(r: PlanRequirement): number {
  const rule = r.rule;
  if (rule.kind === 'all') return rule.choices.reduce((sum, c) => sum + (c.bundles?.[0] ? c.bundles[0].length * 3 : (c.credits ?? 3)), 0);
  if (rule.kind === 'choose') return rule.n * 3;
  if (rule.kind === 'pool') return rule.hours ?? (rule.n ?? 0) * 3;
  if (rule.kind === 'hours') return rule.hours;
  if (rule.kind === 'gened') return rule.hours ?? (rule.courses ?? 0) * 3;
  return 0;
}

/**
 * Where the planner's reading of a page is thinner than the page. Two ways to
 * see it. The page prints an area's hours and the lists under it add up to
 * far fewer or far more: Accountancy's major is "21" hours, and the crawl
 * folded its "Select one of the following:" into the whole list, so the
 * planner reads one course of eight and a comparison built on that says the
 * second major costs one course. Or the program's own rows (not general
 * education, the language or free electives) come to under 18 hours: Religion,
 * BALAS reads as REL 231 and nothing else, which made it "one course away"
 * for every Psychology student. Said, not corrected: the student checks the
 * page, and a doubted program is never offered as the nearest.
 */
export function readingDoubts(side: ProgramSide): string[] {
  const out: string[] = [];
  const byArea = new Map<string, PlanRequirement[]>();
  for (const r of side.requirements) byArea.set(r.areaId, [...(byArea.get(r.areaId) ?? []), r]);
  for (const [areaId, printed] of Object.entries(side.pageAreaHours ?? {})) {
    const rows = byArea.get(areaId) ?? [];
    if (rows.length === 0 || rows.some((r) => r.rule.kind === 'unparsed')) continue;
    const read = rows.reduce((n, r) => n + rowHours(r), 0);
    if (read < printed * 0.6 || read > printed * 1.6) {
      const label = rows[0].areaLabel || rowLabel(rows[0]);
      out.push(`${side.name}: the page gives "${label}" ${printed} hours, and the planner reads about ${read} from its lists; check the page (${side.url}) before relying on this part of the comparison.`);
    }
  }
  const own = side.requirements.filter(
    (r) => MAJOR_KINDS.has(r.rule.kind) || (r.rule.kind === 'hours' && !(r.rule.genEd ?? []).length && !TOTAL_WORDS.test(`${r.label} ${r.rule.label} ${r.note}`)),
  );
  const ownHours = own.reduce((n, r) => n + rowHours(r), 0);
  if (ownHours < 18) {
    out.push(`${side.name}: the planner reads only ${ownHours} hours of the program's own courses from its page, which is likely less than the page asks; check the page (${side.url}) before relying on this comparison.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

export interface CompareInput {
  context: PlanningContext;
  primary: ProgramSide;
  second: ProgramSide;
  heldCodes: string[];
  /** Codes on the board, in term order. */
  boardCodes: string[];
  /** The language sequence the plan books (GeneratedPlan.language), or null. */
  language?: { completed: number; codes: string[] } | null;
  /** How well a course fits the student's priorities, 0 to 1, to order the picks from a list. */
  fit?: (code: string) => number;
  /**
   * The input the board was built from and what it built. With it, the pair is
   * planned together to measure hours and terms; without it (a board restored
   * from the device) only the reading is returned.
   */
  base?: { input: AutoplanInput; plan: GeneratedPlan } | null;
}

/** A plan's shape: fall, spring and summer terms that hold courses, the last one, its hours, and the hours of an average fall or spring. */
export interface PlanShapeRead {
  terms: number;
  last: string | null;
  hours: number;
  pace: number;
}

export interface BothPlanned {
  /** Fall and spring terms added past the board's finish to fit both. */
  termsAdded: number;
  base: PlanShapeRead;
  both: PlanShapeRead;
  /** Hours the pair's plan holds past the board's own plan. */
  extraHours: number;
  /** Terms (with courses) the pair's plan holds past the board's own plan. */
  extraTerms: number;
  /** Where the pair's plan puts each course the second program adds, and the prerequisites it brought. */
  placed: Array<{ code: string; term: string; why: 'second program' | 'prerequisite' }>;
  /** Courses the pair's plan could not place, with the engine's reason. */
  notPlaced: string[];
  /** Hours the pair's plan falls short of the pair's total even so. */
  shortOfTotal: number;
  /** Prerequisite and standing errors on the pair's board: none is the check that the courses fit. */
  problems: string[];
  /** The pair's board, for a caller that wants to show or try it. */
  plan: GeneratedPlan;
}

export interface ProgramComparison {
  pair: PairReading;
  /**
   * Courses held or on the board that the second program's own rows count (its
   * lists, choices and hours; not the campus general education it shares), and
   * whether the student's own major rows count them too.
   */
  alreadyCounts: Array<{ code: string; title: string; credits: number; row: string; held: boolean; alsoMajor: boolean }>;
  /** The second program's general education rows: met by the board, or still open. */
  genEd: { met: number; open: string[] };
  /** The second program's rows still open, with the planner's picks. */
  open: RowReading[];
  /** The courses the second adds, each once, and their hours. */
  adds: string[];
  addsHours: number;
  unnamedHours: number;
  languageOwed: number;
  unread: RowReading[];
  /** Courses the second program names that the catalog will not credit beside one the student has. */
  standIns: string[];
  /**
   * Hours at the 300 level or above that count for the second program and not
   * for the student's own major rows, and the 12 LAS and Grainger ask for
   * ("distinct, advanced level course work"), or null where no page read asks.
   */
  distinctAdvanced: { hours: number; asked: number | null };
  /** Share of the second program's major hours (counted and added) the student's own major rows also count. */
  overlapShare: number;
  /** The pages' own sentences about a second major meeting one of their requirements. */
  pageSentences: PairRule[];
  doubts: string[];
  /** Null when there was no build to plan from. */
  both: BothPlanned | null;
}

const regular = (label: string) => !/^Summer\b/.test(label);

function shapeOf(plan: GeneratedPlan): PlanShapeRead {
  const used = plan.terms.filter((t) => t.codes.length > 0);
  const fallSpring = used.filter((t) => regular(t.label));
  const regularHours = fallSpring.reduce((n, t) => n + t.credits.min, 0);
  return {
    terms: used.length,
    last: used.at(-1)?.label ?? null,
    hours: plan.credits.planned.min,
    pace: fallSpring.length > 0 ? Math.round((regularHours / fallSpring.length) * 10) / 10 : 0,
  };
}

/** The same horizon with its finish k falls and springs later. */
export function finishLater(h: Horizon, k: number): Horizon {
  let season = h.gradSeason;
  let year = h.gradYear;
  // A summer finish moves to the fall after it first, which is one step.
  for (let i = 0; i < k; i += 1) {
    if (season === 'Spring') season = 'Fall';
    else if (season === 'Fall') {
      season = 'Spring';
      year += 1;
    } else season = 'Fall';
  }
  return { ...h, gradSeason: season, gradYear: year, stated: true };
}

/**
 * The student's plan rebuilt with the second program's courses booked beside
 * their own, at the pair's total. The courses already counted that sit on the
 * board as electives are booked too, so the rebuilt plan cannot drop one the
 * second program relies on.
 *
 * The engine fills to the degree total inside the terms it is given and no
 * further: a Finance plan asked for 154 hours in eight terms planned 144 and
 * said nothing. So the finish moves later first by the terms the pair's hours
 * need at the board's own pace (124 hours in eight terms is 15.5 a term, and
 * 154 at 15.5 is ten), then a term at a time while the plan still falls short
 * or leaves a course out.
 */
export function planBoth(input: {
  base: { input: AutoplanInput; plan: GeneratedPlan };
  context: PlanningContext;
  second: ProgramSide;
  pair: PairReading;
  adds: string[];
  keep: string[];
  secondLanguage: 3 | 4 | null;
}): BothPlanned {
  const { base, context } = input;
  const byCode = catalogByCode(context);
  const codes = [...new Set([...input.adds, ...input.keep].map(normaliseCode))].filter((c) => byCode.has(c));
  const extra: PlanRequirement = {
    id: `${input.second.id}::second`,
    areaId: `${input.second.id}::second`,
    areaLabel: input.second.name,
    label: `${input.second.name}: courses for the second program`,
    hours: null,
    rule: { kind: 'all', choices: codes.map((code) => ({ codes: [code], credits: byCode.get(code)?.credits ?? null })) },
    note: '',
    url: input.second.url,
  };
  // The stricter language rule of the two: an LAS second major asks a Gies student for a fourth semester.
  const own: PlanRequirement[] = base.input.requirements.map((r) =>
    r.rule.kind === 'language' && input.secondLanguage !== null && input.secondLanguage > r.rule.semesters
      ? { ...r, rule: { ...r.rule, semesters: input.secondLanguage } }
      : r,
  );
  const hasLanguage = own.some((r) => r.rule.kind === 'language');
  const language = !hasLanguage && input.secondLanguage !== null ? input.second.requirements.filter((r) => r.rule.kind === 'language') : [];
  const requirements = [...own, ...language, extra];
  const baseShape = shapeOf(base.plan);
  const pace = Math.max(12, Math.min(18, baseShape.pace || 15));
  const total = input.pair.total;
  const fallSpring = base.plan.terms.filter((t) => regular(t.label) && t.codes.length > 0).length;
  const summerHours = base.plan.terms.filter((t) => !regular(t.label)).reduce((n, t) => n + t.credits.min, 0);
  const brought = base.plan.credits.prior + (base.plan.credits.away ?? 0) + summerHours;

  const build = (k: number) => generatePlan({ ...base.input, requirements, degreeTotal: total, horizon: k > 0 ? finishLater(base.input.horizon, k) : base.input.horizon });
  let added = Math.max(0, Math.ceil((total - brought) / pace - 0.05) - fallSpring);
  let plan = build(added);
  const baseMissing = new Set(base.plan.notPlaced.map((n) => n.code));
  const short = (g: GeneratedPlan) => Math.max(0, total - g.credits.total.min);
  const stuck = (g: GeneratedPlan) => g.notPlaced.some((n) => !baseMissing.has(n.code));
  for (let tries = 0; tries < 3 && (short(plan) > 0.5 || stuck(plan)); tries += 1) {
    added += Math.max(1, Math.ceil(short(plan) / pace));
    plan = build(added);
  }

  const onBase = new Set(base.plan.terms.flatMap((t) => t.codes.map(normaliseCode)));
  const wanted = new Set(codes);
  const prerequisites = new Set(plan.addedPrerequisites.map((p) => normaliseCode(p.code)));
  const placed: BothPlanned['placed'] = [];
  for (const t of plan.terms) {
    for (const raw of t.codes) {
      const code = normaliseCode(raw);
      if (onBase.has(code)) continue;
      if (wanted.has(code)) placed.push({ code, term: t.label, why: 'second program' });
      else if (prerequisites.has(code)) placed.push({ code, term: t.label, why: 'prerequisite' });
    }
  }
  const both = shapeOf(plan);
  const issues = validatePlan(plan.plan, context, {
    minimumTermCredits: base.input.preferences?.creditsPerTerm?.min ?? 12,
    maxTermCredits: 18,
    programName: base.input.programName,
    programCollege: base.input.programCollege,
    priorCredits: plan.credits.prior,
    away: plan.away,
    language: plan.language,
  });
  return {
    termsAdded: added,
    base: baseShape,
    both,
    extraHours: Math.max(0, Math.round((both.hours - baseShape.hours) * 10) / 10),
    extraTerms: Math.max(0, both.terms - baseShape.terms),
    placed,
    notPlaced: plan.notPlaced.filter((n) => !baseMissing.has(n.code)).map((n) => `${n.code}: ${n.message}`),
    shortOfTotal: Math.round(short(plan) * 10) / 10,
    problems: issues.filter((i) => i.severity === 'error' && /^ap-(prereq|standing)-/.test(i.id)).map((i) => i.message),
    plan,
  };
}

/**
 * The second program read against the student's board and credit, the pair's
 * rules, and, given the build behind the board, the two planned together.
 */
export function comparePrograms(input: CompareInput): ProgramComparison {
  const { context, primary, second } = input;
  const byCode = catalogByCode(context);
  const credits = (code: string) => byCode.get(code)?.credits ?? 0;
  const read = (side: ProgramSide) =>
    readProgram({ context, side, heldCodes: input.heldCodes, boardCodes: input.boardCodes, language: input.language ?? null, fit: input.fit });
  const own = read(primary);
  const other = read(second);
  const pair = pairOf(primary, second);
  const held = new Set(input.heldCodes.map(normaliseCode));

  // The second program's own rows. The campus general education categories are
  // the same for both programs and the board already fills them, so a course
  // counted there is not news about the second program.
  const ownRows = other.rows.filter((row) => !row.genEd && (MAJOR_KINDS.has(row.kind) || (row.kind === 'hours' && row.status !== 'total')));
  const genEdRows = other.rows.filter((row) => row.genEd);
  const alreadyCounts: ProgramComparison['alreadyCounts'] = [];
  for (const row of ownRows) {
    for (const code of row.counted) {
      if (alreadyCounts.some((a) => a.code === code)) continue;
      alreadyCounts.push({ code, title: byCode.get(code)?.title ?? '', credits: credits(code), row: row.label, held: held.has(code), alsoMajor: own.majorCounted.has(code) });
    }
  }
  const secondHours = alreadyCounts.reduce((n, a) => n + a.credits, 0) + other.takeHours;
  const overlapHours = alreadyCounts.filter((a) => a.alsoMajor).reduce((n, a) => n + a.credits, 0);
  const distinct = [...alreadyCounts.filter((a) => !a.alsoMajor).map((a) => a.code), ...other.take]
    .filter((c) => levelOf(c) >= 300)
    .reduce((n, c) => n + credits(c), 0);

  const secondLanguage = second.requirements.find((r) => r.rule.kind === 'language');
  let both: BothPlanned | null = null;
  if (input.base && pair.kind !== 'same-program' && pair.kind !== 'not-allowed') {
    // Courses the second program counts that the board holds only as electives or picks: kept, so the rebuild cannot drop them.
    const keep = alreadyCounts.filter((a) => !a.held && !a.alsoMajor).map((a) => a.code);
    both = planBoth({
      base: input.base,
      context,
      second,
      pair,
      adds: other.take,
      keep,
      secondLanguage: secondLanguage && secondLanguage.rule.kind === 'language' ? secondLanguage.rule.semesters : null,
    });
  }

  return {
    pair,
    alreadyCounts,
    genEd: { met: genEdRows.filter((row) => row.status === 'met').length, open: genEdRows.filter((row) => row.status === 'open').map((row) => row.label) },
    open: other.rows.filter((row) => row.status === 'open' && !row.genEd),
    adds: other.take,
    addsHours: other.takeHours,
    unnamedHours: other.unnamedHours,
    languageOwed: other.languageOwed,
    unread: other.rows.filter((row) => row.status === 'unread'),
    standIns: other.standIns,
    distinctAdvanced: { hours: distinct, asked: pair.rules.some((r) => /\b12 (distinct|hours of distinct)\b/i.test(r.text)) ? 12 : null },
    overlapShare: secondHours > 0 ? Math.round((overlapHours / secondHours) * 100) / 100 : 0,
    pageSentences: [...secondMajorSentences(primary), ...secondMajorSentences(second)],
    doubts: readingDoubts(second),
    both,
  };
}

/**
 * The pair's new courses put on the student's own board, for what_if: each in
 * the term the pair's plan chose, moved a term later while the board's own
 * checks (validatePlan, with its exclusion and exemption readings) find a
 * prerequisite or standing error on it there. The pair's plan is a rebuild,
 * and the student's board may hold a course a term later than the rebuild
 * does. A course the rebuild put past the board's last term stays out and is
 * marked so: piled into the last term, Finance with Economics had MATH 314
 * beside the MATH 241 it needs.
 */
export function placementsOnBoard(input: {
  context: PlanningContext;
  board: PlanState;
  placed: BothPlanned['placed'];
  options: ValidateOptions;
}): Array<{ code: string; term: string; pastFinish: boolean; prerequisitesMet: boolean }> {
  const { context: ctx, board } = input;
  const byCode = catalogByCode(ctx);
  const onBoard = new Set([...board.completedCourseIds, ...(board.exemptCourseIds ?? []), ...board.terms.flatMap((t) => t.courseIds)]);
  const labels = board.terms.map((t) => t.label);
  const moves: Array<{ code: string; id: string; index: number; stuck: boolean }> = [];
  const past: Array<{ code: string; term: string; pastFinish: boolean; prerequisitesMet: boolean }> = [];
  for (const p of input.placed) {
    const code = normaliseCode(p.code);
    const id = byCode.get(code)?.id;
    if (!id || onBoard.has(id) || moves.some((m) => m.id === id)) continue;
    const index = labels.indexOf(p.term);
    if (index < 0) past.push({ code, term: p.term, pastFinish: true, prerequisitesMet: true });
    else moves.push({ code, id, index, stuck: false });
  }
  const candidate = () => ({ ...board, terms: board.terms.map((t, i) => ({ ...t, courseIds: [...t.courseIds, ...moves.filter((m) => m.index === i).map((m) => m.id)] })) });
  const broken = (b: PlanState) =>
    new Set(validatePlan(b, ctx, input.options).filter((i) => i.severity === 'error' && /^ap-(prereq|standing)-/.test(i.id) && i.courseId).map((i) => i.courseId as string));
  // Each pass moves every added course still in error one term later; a course
  // already in the last term stays and is reported.
  for (let pass = 0; pass < labels.length; pass += 1) {
    const errors = broken(candidate());
    const late = moves.filter((m) => errors.has(m.id) && !m.stuck);
    for (const m of late) {
      if (m.index < labels.length - 1) m.index += 1;
      else m.stuck = true;
    }
    // Nothing moved: every course in error is already in the last term.
    if (late.every((m) => m.stuck)) break;
  }
  const errors = broken(candidate());
  return [...moves.map((m) => ({ code: m.code, term: labels[m.index], pastFinish: false, prerequisitesMet: !errors.has(m.id) })), ...past];
}

/*
 * siebelschool.illinois.edu/academics/undergraduate/degree-program-options/cs-undergraduate-degree-options-faq (read
 * 2026-09-27): "Students should begin the minor no later than the first semester of their Junior year since the
 * program takes a minimum of 4 semesters to complete"; "declaring a CS minor does not provide registration advantages
 * in CS courses"; "CS, CS + X, and CE majors are not eligible for the CS minor"; "We cannot guarantee that a student can
 * obtain all the courses needed to complete the minor (completing a minor is not a graduation requirement)."
 */
export const CS_MINOR: PairRule = {
  text: 'The CS minor takes at least four semesters, so the Siebel School says to begin it no later than the first semester of junior year; declaring it gives no registration advantage in CS courses, it is closed to CS, CS + X and Computer Engineering majors, and the School cannot guarantee a seat in every course it needs.',
  source: 'https://siebelschool.illinois.edu/academics/undergraduate/degree-program-options/cs-undergraduate-degree-options-faq',
};

// ---------------------------------------------------------------------------
// Second majors within reach
// ---------------------------------------------------------------------------

export interface WithinReach {
  id: string;
  name: string;
  kind: PairKind;
  /** Courses still to take: named courses, plus the unnamed hours and language semesters at a course each (3 hours). */
  coursesAway: number;
  adds: string[];
  addsHours: number;
  unnamedHours: number;
  /** Courses held or on the board that already count. */
  alreadyCounting: number;
  /** Rows the planner could not read, and doubts about its reading: the count is a floor, not a promise. */
  unread: number;
  doubts: string[];
}

/** Programs that are not a second program anyone declares. */
const NOT_A_SECOND = /\bundeclared\b|\bindividual plans? of study\b/i;

/**
 * The second programs the student's board is closest to, fewest courses away
 * first. Double majors lead, because a dual degree is 30 hours whatever the
 * board already covers; a pair a college rules out, the student's own major
 * and its concentrations, and pages with no course list of their own are
 * left out. A program whose reading the planner doubts goes after the ones it
 * reads cleanly, since "one course away" from a misread page is the claim a
 * student acts on.
 */
export function secondMajorsWithinReach(input: {
  context: PlanningContext;
  primary: ProgramSide;
  candidates: ProgramSide[];
  heldCodes: string[];
  boardCodes: string[];
  language?: { completed: number; codes: string[] } | null;
  limit?: number;
}): WithinReach[] {
  const out: Array<WithinReach & { dual: number }> = [];
  for (const side of input.candidates) {
    if (NOT_A_SECOND.test(side.name)) continue;
    if (!side.requirements.some((r) => MAJOR_KINDS.has(r.rule.kind))) continue;
    const pair = pairOf(input.primary, side);
    if (pair.kind === 'same-program' || pair.kind === 'concentration' || pair.kind === 'not-allowed') continue;
    const reading = readProgram({ context: input.context, side, heldCodes: input.heldCodes, boardCodes: input.boardCodes, language: input.language ?? null, pageOrder: true });
    const counting = reading.rows.filter((row) => MAJOR_KINDS.has(row.kind)).reduce((n, row) => n + row.counted.length, 0);
    out.push({
      id: side.id,
      name: side.name,
      kind: pair.kind,
      coursesAway: reading.take.length + Math.ceil(reading.unnamedHours / 3) + reading.languageOwed,
      adds: reading.take,
      addsHours: reading.takeHours,
      unnamedHours: reading.unnamedHours,
      alreadyCounting: counting,
      unread: reading.unread,
      doubts: readingDoubts(side),
      dual: pair.kind === 'dual-degree' ? 1 : 0,
    });
  }
  out.sort(
    (a, b) =>
      a.dual - b.dual ||
      Number(a.doubts.length > 0 || a.unread > 0) - Number(b.doubts.length > 0 || b.unread > 0) ||
      a.coursesAway - b.coursesAway ||
      b.alreadyCounting - a.alreadyCounting ||
      a.name.localeCompare(b.name),
  );
  return out.slice(0, input.limit ?? 5).map(({ dual: _dual, ...row }) => row);
}

// ---------------------------------------------------------------------------
// Which program the student means
// ---------------------------------------------------------------------------

export interface ProgramName {
  id: string;
  name: string;
}

/** Words that say which kind of program, not which program. */
const FILLER = new Set(['major', 'minor', 'degree', 'double', 'dual', 'second', 'certificate', 'program', 'bachelor', 'bslas', 'balas', 'with', 'and', 'the', 'in', 'of', 'a', 'an', 'bs', 'ba', 'plus']);

/**
 * The program a student named, by id, by name, or by the words of its name:
 * "accountancy" is Accountancy, BS and not Accountancy + Data Science, BS,
 * because every word of a name the student did not say counts against it.
 * Null with the closest names when two are too close to call.
 */
export function resolveProgram(query: string, programs: ProgramName[]): { match: ProgramName | null; candidates: ProgramName[]; minor: boolean } {
  const q = query.trim().toLowerCase();
  const minor = /\bminor|certificate\b/.test(q);
  const exact = programs.find((p) => p.id.toLowerCase() === q || p.name.toLowerCase() === q);
  if (exact) return { match: exact, candidates: [], minor };
  const words = q.split(/[^a-z0-9+]+/).filter((w) => w.length > 1 && !FILLER.has(w));
  if (words.length === 0) return { match: null, candidates: [], minor };
  const scored = programs
    .map((p) => {
      const nameWords = p.name.toLowerCase().replace(/,.*$/, '').split(/[^a-z0-9+]+/).filter((w) => w.length > 1 && !FILLER.has(w));
      const said = words.filter((w) => nameWords.some((n) => n.startsWith(w) || w.startsWith(n))).length;
      const unsaid = nameWords.filter((n) => !words.some((w) => n.startsWith(w) || w.startsWith(n))).length;
      // A concentration is a narrower claim than the student made.
      const concentration = p.id.split('/').length > 2 ? 1 : 0;
      return { p, said, score: said * 4 - unsaid * 2 - concentration };
    })
    .filter((s) => s.said > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  const best = scored[0];
  if (!best) return { match: null, candidates: [], minor };
  const clear = best.said === words.length && (scored[1]?.score ?? -Infinity) < best.score;
  return { match: clear ? best.p : null, candidates: scored.slice(0, 6).map((s) => s.p), minor };
}
