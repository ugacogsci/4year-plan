import type { TranscriptRecord } from './transcript';

/**
 * What we learn before showing anyone a planner.
 *
 * Three open questions instead of a dozen dropdowns. A student describing
 * their own situation in their own words gives the model far more to work
 * with than a <select> ever does, and it is a much lower wall to climb on
 * first visit. The structured fields get inferred from the answers and stay
 * editable afterwards.
 */

/**
 * Everything that changes when a student picks a different school.
 *
 * The first build hardcoded UGA into the placeholders, the data file paths and
 * the ask bar, so choosing Texas A&M produced a Texas A&M header above UGA's
 * catalog. Every school-specific string now lives here.
 *
 * The transfer feeders are the real ones: Blinn is the dominant pipeline into
 * A&M, Parkland into Illinois, the VCCS colleges into Virginia Tech. Naming
 * the actual college a student transferred from is the difference between a
 * placeholder that helps and one that reads as filler.
 */
/**
 * `bot` is the name each school's TRU tenant already answers to: TRU after
 * Truman the Tiger, REV after Reveille, PROSIM after Ut Prosim, ALMA after
 * the Alma Mater, ARCH after the Arch. The planner's own assistant uses the
 * same name, so a student sees one bot across both products.
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
    id: 'tamu',
    name: 'Texas A&M University',
    short: 'Texas A&M',
    bot: 'REV',
    people: 'Aggies',
    accent: '#500000',
    portal: 'Howdy',
    colleges: 'Mays, Engineering, Liberal Arts',
    town: 'College Station',
    feeders: 'Blinn College, Lone Star, Austin Community College',
    dropTerm: 'Q-drop',
    catalog: null,
    examCredit: null,
  },
  {
    id: 'mizzou',
    name: 'University of Missouri',
    short: 'Mizzou',
    bot: 'TRU',
    people: 'Tigers',
    accent: '#F1B82D',
    portal: 'myZou',
    colleges: 'Arts & Science, Trulaske, Journalism',
    town: 'Columbia',
    feeders: 'Moberly Area, State Fair, Columbia College',
    dropTerm: 'withdrawal',
    catalog: null,
    examCredit: null,
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
  {
    id: 'vt',
    name: 'Virginia Tech',
    short: 'Virginia Tech',
    bot: 'PROSIM',
    people: 'Hokies',
    accent: '#861F41',
    portal: 'Hokie SPA',
    colleges: 'Engineering, Pamplin, Science',
    town: 'Blacksburg',
    feeders: 'Virginia Western, NOVA, New River',
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
 * SCHOOLS is the roster the product is written towards. This is the part of it
 * with a catalog and degree pages behind it today: Illinois and UGA. Offering
 * the other roster schools before their data exists would render a demo catalog
 * under a real university's name, which is exactly the kind of false statement
 * a degree planner cannot make.
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

export interface OnboardingAnswers {
  schoolId: SchoolId | null;
  studying: string;
  timeline: string;
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
  studying: '',
  timeline: '',
  after: '',
  exams: [],
  transferText: '',
  transcript: null,
  languageYears: null,
  language: '',
};

export function questionsFor(school: School | undefined): Array<{
  key: 'studying' | 'timeline' | 'after';
  label: string;
  hint: string;
  placeholder: string;
}> {
  const s = school;
  const college = s?.colleges.split(',')[0]?.trim() ?? 'your college';
  return [
    {
      key: 'studying',
      label: 'What are you studying, or thinking about studying?',
      hint: 'A declared major, two you are torn between, or just the subjects you like.',
      placeholder: s
        ? `I am in ${college} doing psychology but I have taken two CS classes and liked them more. Thinking about switching or adding a CS minor.`
        : 'Psychology, but I like my CS classes more.',
    },
    {
      key: 'timeline',
      label: 'When do you want to finish, and where are you now?',
      hint: 'Your year, roughly how many credits you have, anything that has slowed you down.',
      placeholder:
        'Second year, about 45 credits. I want to graduate spring 2029. I failed calc once so I am a semester behind on the math sequence.',
    },
    {
      key: 'after',
      label: 'What do you want to be doing after you graduate?',
      hint: 'A job, a field, grad school, or just what kind of work sounds good.',
      placeholder:
        'Something with data. I like problem solving more than writing. Maybe analytics at a company, maybe a masters if that is what it takes.',
    },
  ];
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
    const parsed = JSON.parse(raw) as OnboardingAnswers;
    return parsed.schoolId ? parsed : null;
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
  return [school?.short, a.studying.split(/[.\n]/)[0]?.trim()].filter(Boolean).join(' · ');
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

const GRANT_COURSE = /^[A-Z]{2,5} \d{3}[A-Z]?$/;

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
