/**
 * What an Illinois college decides and the planner cannot.
 *
 * Advising at Illinois is decentralised. The registrar sets the campus bounds
 * (12 to 18 hours in a fall or spring term), and each college decides who may
 * go outside them, which courses a student may take credit/no credit, and
 * who files a grade replacement. ALMA can explain the rule and name the office;
 * the office decides. Before this table, set_plan_shape built six 9-hour terms
 * for "I only want 9 credits" without a word, and ALMA told a Grainger
 * freshman asking for 20 hours to "check with advising" when Grainger's own
 * page says no overload is ever granted in a first semester.
 *
 * Every fact below was read on the page named beside it on the date given. A
 * college whose page was not read, or whose page does not say, gets "ask your
 * college office" and the office's name, never a guessed GPA or date: a wrong
 * gate sends a student into the wrong conversation.
 *
 * No imports, so the check harness can load it under plain node.
 */

/** When every page below was read. */
export const RULES_READ = '2026-09-24';

// registrar.illinois.edu/registration/registration-process/max-min-enrollment-levels/ (read 2026-09-24):
// "Full-time enrollment for students in a Fall or Spring term is 12 or more hours."
// "College approval is required for undergraduate students to carry a load of fewer than 12 hours in a fall or spring term."
export const FULL_TIME_HOURS = 12;
// Same page: maximum without approval "Fall & Spring: 18 hours"; "If you wish to enroll above the established maximum
// (except for Winter), consult your college office."
export const MAX_TERM_HOURS = 18;
export const REGISTRAR_LOAD_PAGE = 'https://registrar.illinois.edu/registration/registration-process/max-min-enrollment-levels/';

export interface CollegeRules {
  /** The college code programs.json uses: "engineering", "bus", "las". */
  code: string;
  name: string;
  /** Who to see about a load, a petition or a late drop, as the college's own page names it. */
  office: string;
  /** What the college requires for more than 18 hours, or null when no page read says. */
  overload: string | null;
  /** What the college says about fewer than 12, or null when no page read says. */
  underload: string | null;
  sources: string[];
}

const RULES: CollegeRules[] = [
  {
    code: 'engineering',
    name: 'The Grainger College of Engineering',
    // advising.grainger.illinois.edu/advising/college (read 2026-09-24): 4th Floor Grainger Library, East Wing;
    // (217) 333-2280; engineering@illinois.edu; walk-in Express Advising "Monday - Friday from 1-4pm during the fall
    // and spring semesters".
    office: 'Grainger college advising, 4th floor of Grainger Library (east wing), (217) 333-2280, engineering@illinois.edu; walk-in Express Advising weekdays 1-4 p.m. in fall and spring',
    // advising.grainger.illinois.edu/course-registration/overload-underload (read 2026-09-24): "typically Illinois
    // GPA >=3.5"; "no overload will be granted first semester"; "Overload petitions for more than 22 hours will be
    // automatically denied"; "Noon of the 10th day of the Fall Semester; Noon of the 10th day of the Spring
    // Semester"; "Students who have an underload for a given semester will not be granted an overload for the
    // following semester."
    overload:
      "Grainger typically grants an overload only for an Illinois GPA of 3.5 or higher, never in a student's first semester (it wants a semester of grades as an engineering student on campus), never for more than 22 hours, and never in the term after an underload; requests reach the college by noon on the 10th day of the fall or spring semester.",
    // Same page: "All students will need approval for Underloads."
    underload: 'Grainger requires approval for every underload, and the term after one cannot carry an overload.',
    sources: ['https://advising.grainger.illinois.edu/course-registration/overload-underload', 'https://advising.grainger.illinois.edu/advising/college'],
  },
  {
    code: 'bus',
    name: 'Gies College of Business',
    // giesgroups.illinois.edu/advising/contact-us/ (read 2026-09-24): Undergraduate Academic Advising, Office of
    // Undergraduate Affairs, 1055 Business Instructional Facility, 217-333-2740, undergrads@business.illinois.edu.
    office: 'Gies Undergraduate Academic Advising (Office of Undergraduate Affairs), 1055 Business Instructional Facility, 217-333-2740, undergrads@business.illinois.edu',
    // giesgroups.illinois.edu/advising/overload-underload/ (read 2026-09-24): "Requests of 19–20 hours will be
    // approved only if the student has at least a 3.00 cumulative GPA"; "over 20 hours will be considered only if the
    // student has at least a 3.50 cumulative GPA"; "has successfully completed 15–16 hours in each of the prior two
    // semesters"; "New, first-time freshmen may not overload in their first two semesters"; "Transfer students ...
    // may not overload in their first semester"; "may not exceed two approved overloads within the 9-semester limit".
    overload:
      'Gies approves 19-20 hours only with a cumulative GPA of at least 3.00 and considers more than 20 only at 3.50 or higher, in both cases after 15-16 hours completed in each of the two previous semesters; a new freshman may not overload in the first two semesters or a transfer student in the first, and no student may have more than two approved overloads within the 9-semester limit.',
    // Same page: "Gies approves course loads of less than 12 hours in special circumstances"; "students may underload
    // for only one semester at UIUC unless special circumstances, as outlined above, apply".
    underload: 'Gies approves fewer than 12 hours only in special circumstances, and a student may underload for only one semester at Illinois unless those circumstances apply.',
    sources: ['https://giesgroups.illinois.edu/advising/overload-underload/', 'https://giesgroups.illinois.edu/advising/contact-us/'],
  },
  {
    code: 'media',
    name: 'College of Media',
    // www.media.illinois.edu/registration-course-changes-and-withdrawals (read 2026-09-24): the Student Services
    // Center, 119 Gregory Hall, 217-333-2350, media-info@illinois.edu; overloads and underloads go through the
    // academic advisor.
    office: 'the College of Media Student Services Center, 119 Gregory Hall, 217-333-2350, media-info@illinois.edu, through the academic advisor',
    // Same page: "must have a minimum 3.0 GPA and have successfully completed a semester courseload of 17-18 credit
    // hours, while maintaining a GPA in that semester"; a student in the final semester who needs the hours "may be
    // eligible for an overload in consultation with their academic advisor"; the hours above 18 are NOT added "until
    // after the majority of students across campus have had the opportunity to register".
    overload:
      'Media requires a GPA of at least 3.0 and an earlier semester of 17-18 hours completed with the GPA kept; a student in the final semester who needs the hours to graduate may be eligible with the advisor; the hours above 18 are added only after most students on campus have registered.',
    // Same page: an underload "once during the student's undergraduate academic career"; "Most often, this would be in
    // a student's graduating semester"; "Students on academic warning status are generally NOT approved to pursue
    // underloads."
    underload: "Media allows one underload in a student's whole undergraduate career, most often the graduating semester, and generally not for a student on academic warning.",
    sources: ['https://www.media.illinois.edu/registration-course-changes-and-withdrawals'],
  },
  {
    code: 'las',
    name: 'College of Liberal Arts & Sciences',
    // las.illinois.edu/academics/advising/college (read 2026-09-24): drop-ins at 2002 Lincoln Hall "Monday-Friday,
    // 1-4:40 p.m."; (217) 333-1705; las@illinois.edu; it handles "Withdrawal, late, or retroactive Drops".
    office: 'LAS Student Academic Affairs (college advising), drop-ins at 2002 Lincoln Hall weekdays 1-4:40 p.m., (217) 333-1705, las@illinois.edu',
    // las.illinois.edu/academics/courses/loadcredit (read 2026-09-24): "Approval for programs of more than 18 hours
    // (overload) must be obtained from the college"; "Overload permissions are generally granted in the registration
    // system the day before classes begin."
    overload: 'LAS must approve more than 18 hours, and overload permission is generally entered in the registration system the day before classes begin.',
    // Same page: "LAS approves course loads of less than 12 hours in special circumstances, such as seniors in their
    // final semester who need fewer than 12 hours to graduate and students with a documented illness"; "the college
    // generally does not approve more than one such request."
    underload: 'LAS approves fewer than 12 hours only in special circumstances, such as a senior in the final semester who needs fewer than 12 to graduate or a documented illness, and generally not more than once.',
    sources: ['https://las.illinois.edu/academics/courses/loadcredit', 'https://las.illinois.edu/academics/advising/college'],
  },
  {
    code: 'aces',
    name: 'College of ACES',
    // aces.illinois.edu/academics/current-students/forms-petitions (read 2026-09-24): Office of Academic Programs,
    // 128 Mumford Hall, 217-333-3380, ACES-Academics@illinois.edu. Overload: "Student must be in good academic
    // standing (not on academic warning)"; "A University of Illinois GPA is required to be reviewed before a student may
    // request an overload"; requests are not processed "until after priority registration ends ... For spring
    // registration, this is typically around fall break and for fall, this is typically around July 15." Dropping
    // under 12 makes a student part-time, with effects on financial aid, insurance and scholarships, and part-time
    // enrollment has its own request form.
    office: 'the ACES Office of Academic Programs, 128 Mumford Hall, 217-333-3380, ACES-Academics@illinois.edu',
    overload:
      'ACES considers an overload only for a student in good academic standing (not on academic warning) who has an Illinois GPA to review, and processes requests after priority registration ends (around fall break for spring, around July 15 for fall).',
    underload: 'ACES asks for a part-time request on its own form; part-time status can affect financial aid, insurance and scholarships.',
    sources: ['https://aces.illinois.edu/academics/current-students/forms-petitions'],
  },
  {
    code: 'faa',
    name: 'College of Fine and Applied Arts',
    // faa.illinois.edu/student-resources/current-students/academic-affairs-office/course-registration/ (read
    // 2026-09-24): "An overload is available only to students who have a 3.0 or higher GPA"; the request lists the
    // courses, the hours and the reason; "Permission for more than 21 credit hours is only provided under special
    // circumstances"; approved overloads are processed "after Reading Day each term". Underload: an
    // underload/part-time status request; "Permission to pursue more than one underload is granted only under
    // special circumstances", on a student petition with supporting documentation.
    office: 'the FAA Office of Undergraduate Academic Affairs',
    overload:
      'FAA offers an overload only with a GPA of 3.0 or higher, on a request listing the courses, the hours and the reason; more than 21 hours only in special circumstances; approved overloads are entered after Reading Day each term.',
    underload: 'FAA needs an underload/part-time request, and grants more than one underload only in special circumstances, on a petition with documentation.',
    sources: ['https://faa.illinois.edu/student-resources/current-students/academic-affairs-office/course-registration/'],
  },
  {
    code: 'ahs',
    name: 'College of Applied Health Sciences',
    // www.ahs.illinois.edu/academics/academic-policies-and-procedures/enrollment-grading-and-withdrawals/ (read
    // 2026-09-24): AHS Undergraduate Academic Affairs, ahs-acaffrs@illinois.edu; overloads "contact your academic
    // advisor"; underloads on the "College of Applied Health Sciences Course Underload Request form".
    office: 'AHS Undergraduate Academic Affairs (ahs-acaffrs@illinois.edu), through the academic advisor',
    overload: 'AHS handles an overload through the academic advisor.',
    underload: 'AHS needs its Course Underload Request form.',
    sources: ['https://www.ahs.illinois.edu/academics/academic-policies-and-procedures/enrollment-grading-and-withdrawals/'],
  },
  // Not read: no page was fetched for these, so ALMA names the college and says to ask.
  { code: 'education', name: 'College of Education', office: 'the College of Education advising office', overload: null, underload: null, sources: [] },
  { code: 'ischool', name: 'School of Information Sciences', office: 'the iSchool advising office', overload: null, underload: null, sources: [] },
  { code: 'socw', name: 'School of Social Work', office: 'the School of Social Work advising office', overload: null, underload: null, sources: [] },
];

const BY_CODE = new Map(RULES.map((r) => [r.code, r]));

/**
 * The rules for a program's college, from the code programs.json carries.
 * Unknown or missing codes get a row that says to ask, never another
 * college's rule.
 */
export function collegeRulesFor(college: string | null | undefined): CollegeRules {
  const known = college ? BY_CODE.get(college.trim().toLowerCase()) : undefined;
  return known ?? { code: college ?? '', name: 'your college', office: 'your college office', overload: null, underload: null, sources: [] };
}

/**
 * What to tell a student who asks for more than 18 hours in a fall or spring
 * term. The planner never builds one; the answer is the college's gate and
 * where to take the request.
 */
export function overloadAnswer(college: string | null | undefined, hours: number): string {
  const rules = collegeRulesFor(college);
  const rule = rules.overload ?? `The planner does not have ${rules.name === 'your college' ? "your college's" : `the ${rules.name}'s`} overload rule; ask ${rules.office} what it requires.`;
  return `${hours} hours is more than the 18 a fall or spring term may hold without the college's approval (registrar), so the planner never builds it. ${rule} Bring the plan and the reason to ${rules.office}.`;
}

/**
 * The note set_plan_shape carries when a fall or spring term is allowed or
 * aimed under 12 hours. The registrar's warnings first, because Self-Service
 * says nothing when a student drops to 11, then the college's own rule.
 */
export function underloadNote(college: string | null | undefined, hours: number): string {
  const rules = collegeRulesFor(college);
  const own = rules.underload ?? `Ask ${rules.office} how it handles underloads.`;
  return [
    // registrar max-min page (read 2026-09-24): "Student Self-Service will not display a warning message if you are not
    // enrolled in a full course load for the term"; "Enrollment below the minimum level may jeopardize your financial
    // aid status, progress toward a degree, or visa status if you are an international student."
    `${hours} credits in a fall or spring term is under the 12 of full-time enrollment, so it needs the college's approval, and registration will not warn the student when a term drops under 12. Part-time enrollment can affect financial aid, progress toward the degree, and visa status for an international student.`,
    // Media: once, most often the graduating semester; Gies: one semester; LAS: generally not more than one, e.g. a
    // senior's final semester; FAA: more than one only in special circumstances (pages above, read 2026-09-24).
    'Colleges usually approve one underload, most often in the final term.',
    own,
    `Say this once, and have the student confirm it with ${rules.office} before counting on a light term.`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Credit/no credit, by what a card is on the board for
// ---------------------------------------------------------------------------

/** Why a card is on the board, as the workspace marks it. */
export type CardRole = 'required' | 'from a list' | 'elective slot' | 'career track' | 'language' | 'gen ed pick' | 'prerequisite' | 'added';

export interface CrncAnswer {
  /** True or false from the card's role; null when the course is not on the board. */
  eligible: boolean | null;
  why: string;
}

/**
 * Whether a card could be taken credit/no credit, from why it is on the board.
 *
 * LAS's rule (las.illinois.edu/academics/courses/loadcredit, read 2026-09-24): the option "may not be used ... with
 * courses that satisfy the college's general education requirements, courses specifically required by the college
 * for graduation, or courses specifically designated by the curriculum as satisfying the student's major." So a free
 * elective qualifies and a card the degree asks for does not. Other colleges were not read, so the answer names LAS
 * and sends the student to their own office. Composition I is a general education requirement whatever card
 * carries it: RHET 105 added by hand is still Composition I.
 */
export function crncEligibility(input: {
  role: CardRole | null;
  /** The course's general education categories, as the catalog tags it. */
  tags: string[];
  /** The requirement that names the course, when a student-added card is on one of the degree's lists. */
  namedBy?: string | null;
  college?: string | null;
  /** The student's goal, for a career-track card. */
  track?: string | null;
}): CrncAnswer {
  const rules = collegeRulesFor(input.college);
  const whose = rules.code === 'las' ? "LAS's rule" : `LAS's rule; ${rules.name === 'your college' ? 'your college' : `the ${rules.name}`} sets its own, so confirm with ${rules.office}`;
  if (input.role === null) return { eligible: null, why: 'Not on the board; whether it could be CR/NC depends on what it would count for.' };
  if (input.tags.includes('Composition I')) return { eligible: false, why: `Composition I is a general education requirement, which cannot be taken CR/NC (${whose}).` };
  // A course the student added that sits on one of the degree's lists (FIN 411
  // on the Finance electives) likely counts there; one the degree never names
  // is a free elective like any slot.
  if (input.role === 'added' && input.namedBy) {
    return { eligible: false, why: `The degree names it under "${input.namedBy}", so it likely counts toward that requirement, which cannot be met CR/NC (${whose}).` };
  }
  switch (input.role) {
    case 'required':
      return { eligible: false, why: `The degree requires it, and a required course cannot be taken CR/NC (${whose}).` };
    case 'from a list':
      return { eligible: false, why: `It fills one of the degree's requirement lists, which cannot be met CR/NC (${whose}).` };
    case 'gen ed pick':
      return { eligible: false, why: `It is the plan's pick for a general education requirement, which cannot be met CR/NC (${whose}).` };
    case 'language':
      return { eligible: false, why: `It is part of the language requirement, a college requirement that cannot be met CR/NC (${whose}).` };
    case 'prerequisite':
      return { eligible: false, why: 'It is booked because a later course needs it first; keep it graded, and ask the department before choosing CR/NC.' };
    case 'career track':
      // Same LAS page: "Students who accumulate 10 percent or more of their hours through the credit/no credit option
      // may be forced to rely on achieving high scores on the nationally administered objective admission tests like
      // the MCAT and LSAT."
      return {
        eligible: false,
        why: `It is booked for the student's goal${input.track ? ` (${input.track})` : ''}; keep it graded. LAS warns that 10 percent or more of hours taken CR/NC can leave a graduate or professional school applicant relying on test scores.`,
      };
    case 'added':
    case 'elective slot': {
      const also = input.tags.length > 0
        ? ` It also carries ${input.tags.join(', ')}: if the degree still counts on it for that general education category, CR/NC would leave the category open.`
        : '';
      return { eligible: true, why: `A free elective, so it can be taken CR/NC within the limits (${whose}).${also}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Programs a student applies to
// ---------------------------------------------------------------------------

export interface ApplicationProgram {
  code: string;
  name: string;
  /** Goal words that make the program worth naming. */
  goal: RegExp;
  /** Who applies and when, as the program's own page says. */
  who: string;
  source: string;
}

/*
 * The Gies finance academies. Each is a one-credit course (three for FIN 390 and
 * FIN 396) whose catalog prerequisite is an admission, so the planner never
 * books one; a student with the matching goal should hear that it exists and
 * that they apply. Course titles and prerequisite sentences: catalog.illinois.edu/courses-of-instruction/fin/
 * (read 2026-09-24).
 */
export const APPLICATION_PROGRAMS: ApplicationProgram[] = [
  {
    code: 'FIN 390',
    name: 'Finance Academy',
    goal: /\b(invest(ment)?\s+bank(ing|er|ers)?|i-?bank(ing|er|ers)?|private\s+equity|(asset|investment|portfolio|wealth)\s+manag(ement|er|ers)|cfa)\b/i,
    // giesbusiness.illinois.edu/finance-academy (read 2026-09-24): "a one-semester program open to all second semester
    // business students at Gies that serves as preparation for advancement in Golder Academies, though successful
    // completion does not ensure entrance into an Academy." Catalog: "Induction into the Finance Academy. Restricted
    // to Freshman students in their second semester."
    who: 'a one-semester program for second-semester Gies freshmen that prepares them to apply to the Investment Banking and Investment Management academies, without guaranteeing entry',
    source: 'https://giesbusiness.illinois.edu/finance-academy',
  },
  {
    code: 'FIN 391',
    name: 'Investment Banking Academy',
    goal: /\b(invest(ment)?\s+bank(ing|er|ers)?|i-?bank(ing|er|ers)?|private\s+equity|mergers|m\s?&\s?a)\b/i,
    // giesbusiness.illinois.edu/investment-banking-academy (read 2026-09-24): "Admission into the Investment Banking
    // Academy is highly selective and is open to current sophomores and juniors."
    who: 'highly selective; current sophomores and juniors apply',
    source: 'https://giesbusiness.illinois.edu/investment-banking-academy',
  },
  {
    code: 'FIN 392',
    name: 'Investment Management Academy',
    goal: /\b((asset|investment|portfolio|wealth|fund)\s+manag(ement|er|ers)|cfa|equity\s+research|hedge\s+funds?)\b/i,
    // giesbusiness.illinois.edu/investment-management-academy (read 2026-09-24): "highly selective and is open to current
    // sophomores and juniors". Catalog: "Primarily for Finance majors with sophomore standing or above who show interest
    // in pursuing their CFA credential."
    who: 'highly selective; current sophomores and juniors apply; the catalog says it is mainly for Finance majors working toward the CFA',
    source: 'https://giesbusiness.illinois.edu/investment-management-academy',
  },
  {
    code: 'FIN 393',
    name: 'Risk Management Academy',
    goal: /\brisk\s+manag(ement|er|ers)\b/i,
    // giesbusiness.illinois.edu/experience/academies-centers (read 2026-09-24): the AXIS Risk Management Academy "is open
    // to students from across the University of Illinois campus". Catalog: "Acceptance into the Risk Management Academy."
    who: 'open to students from across campus; the course requires acceptance into the academy',
    source: 'https://giesbusiness.illinois.edu/experience/academies-centers',
  },
  {
    code: 'FIN 395',
    name: 'Real Estate Finance Academy',
    goal: /\breal\s+estate\b/i,
    // students.giesbusiness.illinois.edu/experiential-learning/academies/reichard-real-estate-academy (read 2026-09-24):
    // "recruits sophomore students looking to pursue a career in commercial real estate and finance"; a five-semester
    // curriculum. Catalog: "Admission by application only."
    who: 'recruits sophomores for a five-semester curriculum; admission by application only',
    source: 'https://students.giesbusiness.illinois.edu/experiential-learning/academies/reichard-real-estate-academy',
  },
  {
    code: 'FIN 396',
    name: 'Orange & Blue Ventures Academy',
    goal: /\b(venture\s+capital|vc\s+fund|startup\s+invest(ing|ment|ments))\b/i,
    // Catalog: "Admission by application only. Restricted to students with Junior or Senior class standing."
    who: 'admission by application only, for juniors and seniors',
    source: 'https://catalog.illinois.edu/courses-of-instruction/fin/',
  },
];

/**
 * The application-only programs a student's goal points at, in table order.
 * Read from the career words alone, like the career tracks: "Finance at Gies"
 * is what they study, "investment banking" is what they want.
 */
export function applicationProgramsFor(career: string | null | undefined): ApplicationProgram[] {
  const text = (career ?? '').trim();
  if (!text) return [];
  return APPLICATION_PROGRAMS.filter((p) => p.goal.test(text));
}

/** One line for the board description, or null when the goal names none. */
export function describeApplicationPrograms(career: string | null | undefined): string | null {
  const hits = applicationProgramsFor(career);
  if (hits.length === 0) return null;
  return `Programs for this goal that the student applies to (tell them each exists and how admission works; never book one, and the planner does not): ${hits
    .map((p) => `${p.code} ${p.name} (${p.who})`)
    .join('; ')}.`;
}
