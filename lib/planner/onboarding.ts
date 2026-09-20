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
export const SCHOOLS = [
  {
    id: 'uga',
    name: 'University of Georgia',
    short: 'UGA',
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
}

export const EMPTY_ANSWERS: OnboardingAnswers = {
  schoolId: null,
  studying: '',
  timeline: '',
  after: '',
  exams: [],
  transferText: '',
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

const KEY = 'fourYear.onboarding.v1';

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
 * Turn the exams a student reports into the credit UGA actually grants,
 * using the registrar's own published equivalence tables.
 *
 * Two outcomes matter and they are different: a course you get CREDIT for
 * counts toward the 120, and a course you are only EXEMPT from does not.
 * AP Calculus AB at a 4 grants MATH 2250 and exempts you from MATH 1101 and
 * MATH 1113 with zero hours. Treating those the same overstates a student's
 * progress by a semester.
 */
export function applyExamCredit(
  exams: PriorExam[],
  table: ExamCreditEntry[],
): { creditCourses: string[]; exemptCourses: string[]; credits: number; unmatched: PriorExam[] } {
  const creditCourses = new Set<string>();
  const exemptCourses = new Set<string>();
  const unmatched: PriorExam[] = [];
  let credits = 0;

  for (const taken of exams) {
    const row = table.find(
      (e) =>
        e.kind === taken.kind &&
        e.exam === taken.exam &&
        String(e.score) === String(taken.score) &&
        (e.level ?? null) === (taken.level ?? null),
    );
    if (!row) { unmatched.push(taken); continue; }
    row.courses.forEach((c) => creditCourses.add(c));
    row.exemptOnly.forEach((c) => exemptCourses.add(c));
    credits += row.credits;
  }

  return {
    creditCourses: [...creditCourses],
    exemptCourses: [...exemptCourses].filter((c) => !creditCourses.has(c)),
    credits,
    unmatched,
  };
}
