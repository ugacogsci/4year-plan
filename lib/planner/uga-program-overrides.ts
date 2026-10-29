import { fixedUgaDegree } from './uga-degree-fixes.ts';

type UgaRequirementCourse = {
  code: string;
  title: string;
  credits: number;
  levelFrom?: number;
  levelTo?: number;
};

type UgaRequirementGroup = {
  label: string;
  choose: number | null;
  hours?: number | null;
  note?: string;
  minimumAreas?: number | null;
  lists?: Array<{ label: string; codes: string[] }>;
  completeOneList?: boolean;
  bundleSize?: number;
  constraints?: Array<{
    text: string;
    n: number;
    lists: Array<{ label: string; codes: string[] }>;
    single: boolean;
    distinctLists?: boolean;
  }>;
  courses: UgaRequirementCourse[];
};

type UgaRequirementArea = {
  label: string;
  hours: number;
  groups: UgaRequirementGroup[];
};

type UgaProgramRecord = {
  id: string;
  areas: unknown[];
  totalCredits: number | null;
  areaHours: number;
  college?: string;
  degree?: string;
};

const courses = (
  rows: Array<[code: string, title: string, credits: number]>,
): UgaRequirementCourse[] =>
  rows.map(([code, title, credits]) => ({ code, title, credits }));

// Verified 2026-10-19: ai.uga.edu/certificate-ai-computing and
// bulletin.uga.edu/Program/Details/67412. The older scrape lost whole groups.
const AI_CERTIFICATE_AREAS: UgaRequirementArea[] = [
  {
    label: 'Foundational AI Courses', hours: 9,
    groups: [
      { label: 'Artificial Intelligence', choose: null, courses: courses([
        ['CSCI 4550', 'Artificial Intelligence', 3],
      ]) },
      { label: 'Computing or logic foundation', choose: 1, courses: courses([
        ['CSCI 1360', 'Foundations for Informatics and Data Analytics', 4],
        ['CSCI 2610', 'Discrete Mathematics for Computer Science', 4],
        ['CSCI 2611', 'Discrete Mathematics for Engineers', 3],
        ['PHIL 2500', 'Symbolic Logic', 3],
      ]) },
      { label: 'AI and society', choose: 1, courses: courses([
        ['ARTI 2130', 'AI for Humans: Learning to Live with AI', 3],
        ['ARTI 4340', 'Ethics and Artificial Intelligence', 3],
      ]) },
    ],
  },
  {
    label: 'AI and Computer Science Electives', hours: 7,
    groups: [{
      label: 'At least two AI electives', choose: 2, hours: 7,
      note: 'At least two courses and 7 hours. C- or better in all certificate courses. Data Science BS students also need at least one Group I elective.',
      lists: [
        { label: 'Group I', codes: ['CSCI 4530', 'CSCI 4560', 'CSCI 4800', 'CSCI 4600'] },
        { label: 'Group II', codes: ['CSCI 3360', 'CSCI 4360', 'CSCI 4380', 'CSCI 4850'] },
      ],
      courses: courses([
        ['CSCI 4530', 'Introduction to Robotics', 4],
        ['CSCI 4560', 'Evolutionary Computation and Its Applications', 4],
        ['CSCI 4800', 'Human-Computer Interaction', 4],
        ['CSCI 4600', 'Reinforcement Learning', 3],
        ['CSCI 3360', 'Data Science I', 4],
        ['CSCI 4360', 'Data Science II', 4],
        ['CSCI 4380', 'Data Mining', 4],
        ['CSCI 4850', 'Biomedical Image Analysis', 4],
      ]),
    }],
  },
];

const CS_MINOR_AREAS: UgaRequirementArea[] = [
  { label: 'Required Courses', hours: 8, groups: [{
    label: 'Required Courses', choose: null, courses: courses([
      ['CSCI 1302', 'Software Development', 4],
      ['CSCI 2610', 'Discrete Mathematics for Computer Science', 4],
    ]),
  }] },
  { label: 'Upper-division Computer Science Electives', hours: 9, groups: [{
    label: 'CSCI 3000/4000-level electives', choose: null, hours: 9,
    note: 'C or better in each course; 15 minor hours must be taken at UGA. Courses used in Core Areas I-V cannot also count toward the minor.',
    courses: courses([
      ['CSCI 3XXX', '3000-level Computer Science', 3],
      ['CSCI 4XXX', '4000-level Computer Science', 3],
    ]),
  }] },
];

// The Bulletin page for this program uses headings without the hour pattern
// recognized by the general scraper. Keep its published curriculum explicit
// until that parser can represent this page shape without risking other plans.
const AI_MS_GROUP_A = courses([
  ['CSCI 6360', 'Data Science and Applied Machine Learning II', 4],
  ['CSCI 6530', 'Introduction to Robotics', 4],
  ['CSCI 6540', 'Symbolic Programming', 3],
  ['CSCI 6560', 'Evolutionary Computation and Its Applications', 4],
  ['CSCI 6600', 'Reinforcement Learning', 3],
  ['CSCI 6800', 'Human-Computer Interaction', 4],
  ['CSCI 8050', 'Knowledge-Based Systems', 4],
  ['CSCI 8265', 'Trustworthy Machine Learning', 4],
  ['CSCI 8360', 'Data Science Practicum', 4],
  ['CSCI 8535', 'Multi-Robot Systems', 4],
  ['CSCI 8650', 'Logic and Logic Programming', 4],
  ['CSCI 8820', 'Computer Vision and Pattern Recognition', 4],
  ['CSCI 8920', 'Decision Making Under Uncertainty', 4],
  ['CSCI 8945', 'Advanced Representation Learning', 4],
  ['CSCI 8950', 'Machine Learning', 4],
  [
    'CSCI 8955',
    'Advanced Data Analytics: Statistical Learning and Optimization',
    4,
  ],
  ['CSCI 8960', 'Privacy-Preserving Data Analysis', 4],
  ['LING 6570', 'Natural Language Processing', 3],
  ['CSCI 8380', 'Advanced Topics in Information Systems', 4],
  ['CSCI 8860', 'Biomedical Informatics', 4],
  ['FORS 8450', 'Advanced Forest Planning', 3],
  ['GEOG 6591', 'Introduction to Geospatial Artificial Intelligence', 3],
  ['GEOG 6592', 'Advanced Geospatial Artificial Intelligence', 3],
  ['GEOG 6593', 'Geospatial Semantics and Geo-Text Mining', 3],
  ['GEOG 8350', 'Machine Learning with Geospatial Big Data', 3],
  ['MIST 7770', 'Business Intelligence and Analytics', 3],
  [
    'POUL 8270',
    'Applied Deep Learning-Based Computer Visions in Agricultural Systems',
    3,
  ],
  ['STAT 8470', 'Advanced Network Data Analysis and Graphical Models', 3],
]);

const AI_MS_GROUP_B = courses([
  ['ARTI 6340', 'Ethics and Artificial Intelligence', 3],
  ['ENGL 6885', 'Introduction to Humanities Computing', 3],
  ['ENGL 6886', 'Text and Corpus Analysis', 3],
  ['EPSY 8620', 'The Creative Brain', 3],
  ['LING 6022', 'Advanced Phonetics and Phonology', 3],
  ['LING 6160', 'Compositional Semantics', 3],
  ['LING 8021', 'Phonetics and Phonology', 3],
  ['LING 8120', 'Morphology', 3],
  ['LING 8150', 'Generative Syntax', 3],
  ['LING 8160', 'Advanced Generative Syntax', 3],
  ['LING 8180', 'Seminar in Phonetics/Phonology', 3],
  ['MIST 7440', 'AI in Business and Society', 3],
  ['PHIL 6250', 'Philosophy of Technology', 3],
  ['PHIL 6300', 'Philosophy of Language', 3],
  ['PHIL 6310', 'Philosophy of Mind', 3],
  ['PHIL 6530', 'Philosophy of Mathematics', 3],
  ['PHIL 8300', 'Seminar in the Philosophy of Language', 3],
  ['PHIL 8310', 'Seminar in the Philosophy of Mind', 3],
  ['PHIL 8600', 'Seminar in Metaphysics', 3],
  ['PHIL 8610', 'Seminar in Epistemology', 3],
  ['PSYC 6100', 'Cognitive Psychology', 3],
  ['PSYC 8240', 'Judgment and Decision-Making', 3],
]);

const AI_MS_AREAS: UgaRequirementArea[] = [
  {
    label: 'Required Courses',
    hours: 11,
    groups: [
      {
        label: 'Required Courses',
        choose: null,
        note: 'The degree also requires an oral comprehensive examination.',
        courses: courses([
          ['ARTI 6950', 'Faculty Research Seminar', 1],
          ['CSCI 6550', 'Artificial Intelligence', 3],
          ['PHIL 6510', 'Deductive Systems', 3],
        ]),
      },
      {
        label: 'Data Mining or Machine Learning',
        choose: 1,
        courses: courses([
          ['CSCI 6380', 'Data Mining', 4],
          ['CSCI 8950', 'Machine Learning', 4],
        ]),
      },
    ],
  },
  {
    label: 'Group A Select Courses',
    hours: 8,
    groups: [
      {
        label: 'Group A',
        choose: null,
        hours: 8,
        note: 'Complete at least 8 credit hours from Group A.',
        courses: AI_MS_GROUP_A,
      },
    ],
  },
  {
    label: 'Group B Select Courses',
    hours: 6,
    groups: [
      {
        label: 'Group B',
        choose: null,
        hours: 6,
        note: 'Complete at least 6 credit hours from Group B.',
        courses: AI_MS_GROUP_B,
      },
    ],
  },
  {
    label: 'Thesis and Research',
    hours: 5,
    groups: [
      {
        label: "Master's Thesis",
        choose: null,
        courses: courses([['ARTI 7300', "Master's Thesis", 3]]),
      },
      {
        label: 'Additional Research or Select Course',
        choose: null,
        hours: 2,
        note: 'Use up to 2 hours of ARTI 7000 or additional approved select-course hours to reach 30 hours.',
        courses: [
          ...courses([['ARTI 7000', "Master's Research", 2]]),
          ...AI_MS_GROUP_A,
          ...AI_MS_GROUP_B,
        ],
      },
    ],
  },
];

type AiPhdArea = {
  label: string;
  courses: UgaRequirementCourse[];
};

const AI_PHD_GROUP_I: AiPhdArea[] = [
  {
    label: 'Artificial Intelligence Methodologies',
    courses: courses([
      ['CSCI 6560', 'Evolutionary Computing', 4],
      ['CSCI 6600', 'Reinforcement Learning', 3],
      ['CSCI 8050', 'Knowledge Based Systems', 4],
      ['CSCI 8650', 'Logic and Logic Programming', 4],
      ['CSCI 8920', 'Decision Making Under Uncertainty', 4],
      ['CSCI 8950', 'Machine Learning', 4],
    ]),
  },
  {
    label: 'Machine Learning and Data Science',
    courses: courses([
      ['CSCI 6360', 'Data Science II', 4],
      ['CSCI 6600', 'Reinforcement Learning', 3],
      ['CSCI 8945', 'Advanced Representation Learning', 4],
      ['CSCI 8360', 'Data Science Practicum', 4],
      ['CSCI 8950', 'Machine Learning', 4],
      ['CSCI 8955', 'Advanced Data Analytics', 4],
      ['CSCI 8960', 'Privacy-Preserving Data Analysis', 4],
    ]),
  },
  {
    label: 'Machine Vision and Robotics',
    courses: courses([
      ['CSCI 6530', 'Introduction to Robotics', 4],
      ['CSCI 6800', 'Human Computer Interaction', 4],
      ['CSCI 6850', 'Biomedical Image Analysis', 4],
      ['CSCI 8820', 'Computer Vision and Pattern Recognition', 4],
      ['CSCI 8530', 'Advanced Topics in Robotics', 4],
      ['CSCI 8850', 'Advanced Biomedical Image Analysis', 4],
      ['CSCI 8535', 'Multi Robot Systems', 4],
    ]),
  },
];

const AI_PHD_GROUP_II: AiPhdArea[] = [
  {
    label: 'Cognitive Modeling and Logic',
    courses: courses([
      ['CSCI 6860', 'Computational Neuroscience', 4],
      ['PHIL 6300', 'Philosophy of Language', 3],
      ['PHIL 6310', 'Philosophy of Mind', 3],
      ['PHIL 8310', 'Seminar in Philosophy of Mind', 3],
      ['PHIL 8600', 'Seminar in Metaphysics', 3],
      ['PHIL 8610', 'Epistemology', 3],
      ['PSYC 6100', 'Cognitive Psychology', 3],
      ['PSYC 8240', 'Judgment and Decision Making', 3],
    ]),
  },
  {
    label: 'Language and Computation',
    courses: courses([
      ['ENGL 6885', 'Introduction to Humanities Computing', 3],
      ['LING 6080', 'Language and Complex Systems', 3],
      ['LING 6570', 'Natural Language Processing', 3],
      ['LING 8021', 'Phonetics and Phonology', 3],
      ['LING 8150', 'Generative Syntax', 3],
      ['LING 8580', 'Seminar in Computational Linguistics', 3],
      ['PHIL 6300', 'Philosophy of Language', 3],
    ]),
  },
  {
    label: 'Artificial Intelligence Applications',
    courses: courses([
      ['ELEE 6280', 'Introduction to Robotics Engineering', 3],
      ['ENGL 6885', 'Introduction to Humanities Computing', 3],
      ['FORS 8450', 'Advanced Forest Planning and Harvest Scheduling', 3],
      ['INFO 8000', 'Foundations of Informatics for Research and Practice', 3],
      ['MIST 7440', 'AI in Business and Society', 3],
      ['MIST 7770', 'Business Intelligence', 3],
      ['POUL 8270', 'Applied Deep Learning-Based Computer Visions in Agricultural Systems', 3],
    ]),
  },
];

const uniqueCourses = (areas: AiPhdArea[]): UgaRequirementCourse[] => {
  const found = new Map<string, UgaRequirementCourse>();
  for (const area of areas) {
    for (const course of area.courses) found.set(course.code, course);
  }
  return [...found.values()];
};

const listsFor = (areas: AiPhdArea[]) =>
  areas.map((area) => ({
    label: area.label,
    codes: area.courses.map((course) => course.code),
  }));

const AI_PHD_ALL_AREAS = [...AI_PHD_GROUP_I, ...AI_PHD_GROUP_II];

// The Bulletin exposes only the 46-hour total for this program. The Institute
// for Artificial Intelligence publishes the course-level rules, so retain
// those here until the general Bulletin scraper can read the Institute page.
const AI_PHD_AREAS: UgaRequirementArea[] = [
  {
    label: 'Required Courses',
    hours: 15,
    groups: [
      {
        label: 'Required Courses',
        choose: null,
        note: 'Core courses may be waived only with program approval; waived hours must be replaced.',
        courses: courses([
          ['ARTI 6340', 'Ethics and Artificial Intelligence', 3],
          ['ARTI 6950', 'Faculty Research Seminar', 1],
          ['CSCI 6550', 'Artificial Intelligence', 3],
          ['PHIL 6510', 'Deductive Systems', 3],
          ['GRSC 7001', 'GradFIRST', 1],
        ]),
      },
      {
        label: 'Data Mining or Machine Learning',
        choose: 1,
        courses: courses([
          ['CSCI 6380', 'Data Mining', 4],
          ['CSCI 8950', 'Machine Learning', 4],
        ]),
      },
    ],
  },
  {
    label: 'Elective Courses',
    hours: 18,
    groups: [
      {
        label: 'Six AI electives',
        choose: 6,
        lists: listsFor(AI_PHD_ALL_AREAS),
        constraints: [
          {
            text: 'Choose at least two Group I courses from at least two emphasis areas.',
            n: 2,
            lists: listsFor(AI_PHD_GROUP_I),
            single: false,
            distinctLists: true,
          },
          {
            text: 'Choose at least two Group II courses from at least two emphasis areas.',
            n: 2,
            lists: listsFor(AI_PHD_GROUP_II),
            single: false,
            distinctLists: true,
          },
          {
            text: 'Choose at least three electives from one area of emphasis.',
            n: 3,
            lists: listsFor(AI_PHD_ALL_AREAS),
            single: true,
          },
        ],
        note: 'Choose at least six courses while meeting the Group I, Group II, and area-of-emphasis rules. Additional graduate coursework may be needed to reach 40 coursework hours.',
        courses: uniqueCourses(AI_PHD_ALL_AREAS),
      },
    ],
  },
  {
    label: 'Doctoral Dissertation',
    hours: 6,
    groups: [
      {
        label: 'Doctoral Dissertation',
        choose: null,
        note: 'Complete at least 6 hours of ARTI 9300 across at least two semesters.',
        courses: courses([['ARTI 9300', 'Doctoral Dissertation', 6]]),
      },
    ],
  },
];

/**
 * A subject's 4000- and 5000-level courses as rows ("ACCT course(s) at the
 * 4000-5000 level"): the 4000 row reads a held 5000-level course too
 * (levelTo, any-course.ts withHeldInRange), and the 5000 row plans from them.
 */
const upperLevelRows = (subjects: string[]): UgaRequirementCourse[] =>
  subjects.flatMap((subject) => [
    { code: `${subject} 4XXX`, title: `${subject} 4000-5000-level courses`, credits: 0, levelTo: 5 },
    { code: `${subject} 5XXX`, title: `${subject} 5000-level courses`, credits: 0 },
  ]);

const TERRY_PREFIXES = ['ACCT', 'BUSN', 'ECON', 'ENTR', 'FINA', 'ILAD', 'INTB', 'LEGL', 'MARK', 'MBUS', 'MGMT', 'MIST', 'REAL', 'RMIN'];

/*
 * Verified 2026-10-28 on bulletin.uga.edu/Program/Details/93328 and 46304:
 * "Major Electives (6 hours)", two courses from the major's own list or any
 * Terry prefix at the 4000-5000 level. The page prints it after the
 * optional Business Analytics area of emphasis, and the scraper's
 * optional-section guard ran on to "General Electives", so neither degree's
 * boards had the requirement and its hours went to electives "that fill the
 * 120 credits this degree takes beyond what its page names".
 */
const RMIN_MAJOR_ELECTIVES: UgaRequirementArea = {
  label: 'Major Electives',
  hours: 6,
  groups: [{
    label: 'Risk Management and Insurance Major Related Courses',
    choose: null,
    hours: 6,
    note: 'Choose 2 courses (not counted elsewhere): the RMIN courses listed, or any ACCT, BUSN, ECON, ENTR, FINA, ILAD, INTB, LEGL, MARK, MBUS, MGMT, MIST or REAL course at the 4000-5000 level. A grade of C or higher.',
    courses: [
      ...courses([
        ['RMIN 4100', 'Actuarial Financial Mathematics', 3],
        ['RMIN 4200', 'Actuarial Probability Concepts', 3],
        ['RMIN 4800', 'Internship in Risk Management and Insurance', 3],
        ['RMIN 5510', 'Life Insurance', 3],
        ['RMIN 5520', 'Alternative and International Risk', 3],
        ['RMIN 5530', 'Advanced Property Insurance', 3],
        ['RMIN 5540', 'Advanced Liability Insurance', 3],
        ['RMIN 5560', 'Risk Management and Fundamentals of Early Career Success', 3],
        ['RMIN 5570', 'Insurer Operations and Policy', 3],
      ]),
      ...upperLevelRows(TERRY_PREFIXES.filter((subject) => subject !== 'RMIN')),
    ],
  }],
};

const REAL_MAJOR_ELECTIVES: UgaRequirementArea = {
  label: 'Major Electives',
  hours: 6,
  groups: [{
    label: 'Major Electives',
    choose: null,
    hours: 6,
    note: 'Choose 2 courses: REAL courses at the 4000/5000 level not counted elsewhere (REAL 4800, the internship, included), or any ACCT, BUSN, ECON, ENTR, FINA, ILAD, INTB, LEGL, MARK, MBUS, MGMT, MIST or RMIN course at the 4000/5000 level.',
    courses: upperLevelRows(TERRY_PREFIXES),
  }],
};

/*
 * The Additional Terry College Graduation Requirements every BBA page
 * prints under Non-Course Requirements (verified 2026-10-28 on 93328, 62927
 * and 46304): a speech course, a 3-hour ECON course other than ECON 2105 and
 * 2106, and precalculus or calculus (MATH 1113 is also required to apply to
 * a Terry major). Some pages' scrape put the speech and precalculus lists
 * inside "University Wide General Electives (Non-Business)", where the
 * "any course" row already fills the area and they were never read; the
 * Risk Management page's scrape has none of them, and none has the
 * economics course. A course counted elsewhere on the board meets them
 * (COMM 1110 for Humanities, MATH 1113 for Foundation, ECON 2200 for Social
 * Sciences): they ask for no hours of their own.
 */
/** The Terry economics requirement's group label (uga-source.tsx plans it from the economics courses the degree names). */
export const TERRY_ECONOMICS_LABEL = 'Terry Economics Requirement';

const TERRY_GRADUATION_LABEL = 'Terry College Graduation Requirements';
const TERRY_GRADUATION: UgaRequirementArea = {
  label: TERRY_GRADUATION_LABEL,
  hours: 9,
  groups: [
    { label: 'Terry Speech Requirement', choose: 1, courses: courses([
      ['BUSN 4900', 'Communicating for Business Effectiveness', 3],
      ['BUSN 4940', 'Generative AI in Business Communications', 3],
      ['COMM 1000', 'Introduction to Human Communication', 3],
      ['COMM 1110', 'Introduction to Public Speaking', 3],
      ['COMM 1500', 'Introduction to Interpersonal Communication', 3],
      ['COMM 3200', 'Business and Professional Communication', 3],
    ]) },
    { label: TERRY_ECONOMICS_LABEL, choose: 1,
      note: 'Any 3-hour course with the ECON prefix, including non-equivalent transfer courses (excluding ECON 2105 and ECON 2106).',
      courses: [
        ...courses([
          ['ECON 2100', 'Economics of Environmental Quality', 3],
          ['ECON 2200', 'Economic Development of the United States', 3],
        ]),
        { code: 'ECON 3XXX', title: 'ECON 3000-5000-level courses', credits: 0, levelTo: 5 },
        { code: 'ECON 4XXX', title: 'ECON 4000-level courses', credits: 0 },
        { code: 'ECON 5XXX', title: 'ECON 5000-level courses', credits: 0 },
      ] },
    { label: 'Precalculus Requirement', choose: 1, courses: courses([
      ['MATH 1113', 'Precalculus', 3],
      ['MATH 2110', 'Calculus for Economics', 3],
      ['MATH 2200', 'Analytic Geometry and Calculus', 4],
      ['MATH 2250', 'Calculus I for Science and Engineering', 4],
      ['MATH 2260', 'Calculus II for Science and Engineering', 4],
    ]) },
  ],
};

/*
 * Georgia's legislative requirements, which UGA asks of every bachelor's
 * degree (Bulletin, University-Wide Requirements): United States and Georgia
 * history (HIST 2111 or HIST 2112, or the exam) and United States and
 * Georgia constitution (POLS 1101, or the exam). The program pages do not
 * list them, and nothing planned them: an Area V pick happened to be one or
 * it was missing (7 of 22 arts and social science review boards, 33 of 136
 * business boards, 2026-10-28). The Social Sciences list counts them too.
 */
const UNIVERSITY_WIDE_LABEL = 'University-Wide Requirements';
const UNIVERSITY_WIDE: UgaRequirementArea = {
  label: UNIVERSITY_WIDE_LABEL,
  hours: 6,
  groups: [
    { label: 'United States and Georgia History', choose: 1, note: 'HIST 2111 or HIST 2112, or the United States and Georgia history exam.', courses: courses([
      ['HIST 2111', 'American History to 1865', 3],
      ['HIST 2112', 'American History Since 1865', 3],
    ]) },
    { label: 'United States and Georgia Constitution', choose: 1, note: 'POLS 1101, or the United States and Georgia constitution exam.', courses: courses([
      ['POLS 1101', 'American Government', 3],
    ]) },
  ],
};

/** The languages UGA's "Any foreign language course" rows list, and the third semester course of each the catalog has. */
const LANGUAGE_SUBJECTS = ['AMHA', 'ARAB', 'BENG', 'CHNS', 'FREN', 'GRMN', 'GREK', 'HAUS', 'HEBR', 'HNDI', 'INDO', 'ITAL', 'JPNS', 'KREN', 'LATN', 'PASH', 'PERS', 'PORT', 'QUEC', 'RUSS', 'SCAN', 'SLAV', 'SPAN', 'SWAH', 'TURK', 'URDU', 'VIET', 'YORB', 'ZULU'];
// The languages most students bring from high school first: with every language's, the row took KREN 2001, whose line names no KREN 1002, for a freshman with no Korean.
const THIRD_SEMESTER_LANGUAGE = ['SPAN 2001', 'FREN 2001', 'GRMN 2001', 'ITAL 2001', 'LATN 2001', 'CHNS 2001', 'JPNS 2001', 'PORT 2001', 'RUSS 2001', 'ARAB 2003'].map((code) => ({ code, title: `${code.split(' ')[0]} third semester`, credits: 3 }));

/** Whether an area is one of a degree's graduation requirements that courses counted elsewhere meet (TERRY_GRADUATION, UNIVERSITY_WIDE). */
export function ugaOverlapArea(label: string): boolean {
  return [TERRY_GRADUATION_LABEL, UNIVERSITY_WIDE_LABEL].some((own) => label === own || label.endsWith(`: ${own}`));
}

const UGA_CORE_AREA = /^(?:i\. foundation courses|ii\. physical sciences|ii\. life sciences|iii\. quantitative reasoning|iv\. world languages|iv\. humanities|v\. social sciences|vi\. courses related to the major)\b/i;

/**
 * Which of a UGA degree's areas may count one course between them: the
 * same family may not. The core curriculum's Areas I to VI are one family
 * (a course counts in one core area: held ECON 2105 and 2106, Area VI's,
 * made V. Social Sciences read 9 of 9 on business sophomores' boards with 3
 * of its hours taken, 2026-10-28), a program's major areas another (a
 * Psychology Major Elective counted PSYC 3980 and 3990 already spent on
 * Methods and Group B), and a core area and a major area may share one, as
 * UGA allows. A graduation requirement met by courses counted elsewhere
 * (ugaOverlapArea), an area of emphasis and an optional area are each a
 * family of their own. `label` as the board audits it, a second program's
 * areas prefixed "Program name: ".
 */
export function ugaAreaFamily(label: string): string {
  const cut = label.lastIndexOf(': ');
  const own = cut >= 0 ? label.slice(cut + 2) : label;
  const program = cut >= 0 ? label.slice(0, cut) : '';
  if (UGA_CORE_AREA.test(own.trim())) return `${program}|core`;
  // A co-major's International Business Curriculum shares its required courses with the field of study (MARK 4700, FINA 4810).
  if (ugaOverlapArea(label) || /\b(?:emphasis|optional|concentration)\b|international business curriculum/i.test(label)) return `${label}|own`;
  return `${program}|major`;
}

type AreaShape = { label: string; hours: number };

/** `program` with `area` after the area labelled `after` (at the end where none is); `adds` false for one whose hours other areas' courses meet. */
function withAreaAfter<T extends UgaProgramRecord>(program: T, after: string, area: UgaRequirementArea, adds = true): T {
  const areas = program.areas as AreaShape[];
  if (areas.some((existing) => existing.label === area.label)) return program;
  const at = areas.findIndex((existing) => existing.label === after);
  const next = at < 0 ? [...areas, area] : [...areas.slice(0, at + 1), area, ...areas.slice(at + 1)];
  return { ...program, areas: next, areaHours: program.areaHours + (adds ? area.hours : 0) } as T;
}

/** Apply narrow, source-backed repairs for UGA program pages the generic parser misses. */
export function applyUgaProgramOverrides<T extends UgaProgramRecord>(
  programs: T[],
): T[] {
  return programs.map((program) => {
    if (program.id === '28375') return { ...program, areas: AI_CERTIFICATE_AREAS, totalCredits: 16, areaHours: 16 } as T;
    if (program.id === '67412') return { ...program, areas: CS_MINOR_AREAS, totalCredits: 17, areaHours: 17 } as T;
    if (program.id === '19170') {
      return ({
          ...program,
          areas: AI_MS_AREAS,
          totalCredits: 30,
          areaHours: 30,
        } as T);
    }
    if (program.id === '56418') {
      return ({
        ...program,
        areas: AI_PHD_AREAS,
        totalCredits: 46,
        areaHours: 46,
      } as T);
    }
    // The degrees written out from their Bulletin page, and smaller repairs (uga-degree-fixes.ts).
    let repaired = fixedUgaDegree(program, ugaOverlapArea);
    // Only where the scrape still lacks them (scripts/uga-programs.mjs reads both pages since 2026-10-28).
    const hasMajorElectives = (repaired.areas as AreaShape[]).some((area) => /\bmajor (?:electives|related courses)\b/i.test(area.label));
    // At the end, so the page's own areas keep their block ids (93328::10::0 is Upper Division General Electives on saved boards).
    if (program.id === '93328' && !hasMajorElectives) repaired = withAreaAfter(repaired, '', RMIN_MAJOR_ELECTIVES);
    if (program.id === '46304' && !hasMajorElectives) repaired = withAreaAfter(repaired, '', REAL_MAJOR_ELECTIVES);
    /*
     * Economics BBA: "Required Courses (36 hours)" is the Terry core (15),
     * the Economics required courses (9) and the four ECON electives (12),
     * and the scrape kept the electives as an area of their own beside the
     * 36: every board read "Required Courses 24 of 36" (verified 2026-10-28,
     * bulletin.uga.edu/Program/Details/62927).
     */
    if (program.id === '62927') {
      const areas = (repaired.areas as AreaShape[]).map((area) => (area.label === 'Required Courses' && area.hours === 36 ? { ...area, hours: 24 } : area));
      repaired = { ...repaired, areas, areaHours: repaired.areaHours - 12 } as T;
    }
    /*
     * Communication Studies AB: Required Courses (27 hours) is COMM 3300,
     * COMM 3700, at most two COMM 2000-level courses and five to seven COMM
     * courses numbered 3000-5999 (verified 2026-10-28,
     * bulletin.uga.edu/Program/Details/52209). The scrape kept the first
     * three rows as courses to take and lost the 3000-5999 choice, so every
     * board read 9 of 27 and a senior's thirteen COMM 3000+ courses counted
     * for nothing.
     */
    if (program.id === '52209') {
      const areas = (repaired.areas as Array<AreaShape & { groups: unknown[] }>).map((area) => (area.label === 'Required Courses' && area.hours === 27 ? { ...area, groups: [
        { label: 'Required Courses', choose: null, courses: courses([['COMM 3300', 'Introduction to Rhetorical Criticism', 3], ['COMM 3700', 'Empirical Research Methods in Communication', 3]]) },
        { label: 'COMM courses', choose: null, hours: 21, note: 'Choose 5 to 7 COMM courses numbered 3000-5999 and at most 2 numbered 2000-2999 (at most 6 hours of 2000-level credit).', courses: [
          { code: 'COMM 3XXX', title: 'COMM courses numbered 3000-5999', credits: 0, levelTo: 5 },
          { code: 'COMM 4XXX', title: 'COMM 4000-level courses', credits: 0 },
          { code: 'COMM 2XXX', title: 'COMM courses numbered 2000-2999 (at most two)', credits: 0 },
        ] },
      ] } : area));
      repaired = { ...repaired, areas } as T;
    }
    /*
     * Sociology AB's General Sociology Track (verified 2026-10-28,
     * bulletin.uga.edu/Program/Details/77932): SOCI 3220, SOCI 3580, one SOCI
     * course at any level and at least six numbered 3000 and above, not POLS
     * (SOCI) 4905, 5500, 5510 or 5520. The scrape kept the two required
     * courses and two empty choices, so boards planned 6 of the 27 hours.
     */
    if (program.id === '77932') {
      const areas = (repaired.areas as Array<AreaShape & { groups: Array<{ label: string }> }>).map((area) => (area.label === 'Required Courses' && area.hours === 27 && area.groups.some((group) => group.label === 'General Sociology Track') ? {
        ...area,
        excludeCodes: ['SOCI 4905', 'SOCI 5500', 'SOCI 5510', 'SOCI 5520', 'POLS 4905', 'POLS 5500', 'POLS 5510', 'POLS 5520'],
        groups: [
          { label: 'General Sociology Track', choose: null, courses: courses([['SOCI 3220', 'Development of Sociological Theory', 3], ['SOCI 3580', 'Research Methods in Sociology', 3]]) },
          { label: 'General Sociology Track: one SOCI course at any level', choose: 1, courses: [
            { code: 'SOCI 2XXX', title: 'SOCI courses at any level', credits: 0, levelFrom: 1, levelTo: 5 },
          ] },
          { label: 'General Sociology Track: six SOCI courses numbered 3000 and above', choose: null, hours: 18, note: 'Choose a minimum of 6 SOCI courses numbered 3000 and above (not POLS(SOCI) 4905, 5500, 5510 or 5520); no more than six hours from SOCI 4900, 4960R, 4970R, 4980R and 4990R.', courses: [
            { code: 'SOCI 3XXX', title: 'SOCI courses numbered 3000 and above', credits: 0, levelTo: 5 },
            { code: 'SOCI 4XXX', title: 'SOCI 4000-level courses', credits: 0 },
          ] },
        ],
      } : area));
      // The track chosen as the degree path is the area above, not the two courses the scrape gave the option.
      type Emphasis = { id: string; options: Array<{ id: string; courses: unknown[]; parts?: Array<{ courses: unknown[] }> }> };
      const emphasisGroups = ((repaired as { emphasisGroups?: Emphasis[] }).emphasisGroups ?? []).map((group) => ({
        ...group,
        options: group.options.map((option) => (option.id === 'general-sociology-track' ? { ...option, courses: [], parts: (option.parts ?? []).map((part) => ({ ...part, courses: [] })) } : option)),
      }));
      repaired = { ...repaired, areas, emphasisGroups } as T;
    }
    /*
     * Electrical and Electronics Engineering BSEE: "Major Electives (12
     * hours). Choose at least four elective courses": at least one CSEE,
     * ECSE, ELEE or INFO course at the 3000 level or higher and at most three
     * of the other subjects listed (verified 2026-10-28,
     * bulletin.uga.edu/Program/Details/81996). Read as "choose 1", boards
     * planned 3 of the 12 hours. Twelve hours from both lists, the degree's
     * own subjects first.
     */
    if (program.id === '81996') {
      type Group = { courses: UgaRequirementCourse[] };
      const areas = (repaired.areas as Array<AreaShape & { groups: Group[] }>).map((area) => (area.label === 'Major Electives' && area.hours === 12 ? {
        ...area,
        groups: [{ label: 'Major Electives', choose: null, hours: 12, note: 'Choose at least four elective courses: at least one CSEE, ECSE, ELEE or INFO course at the 3000 level or higher, and at most three from the other subjects listed. At most 3 hours of undergraduate research and 3 of co-operative work or internship.', courses: [...new Map(area.groups.flatMap((group) => group.courses).map((row) => [row.code, row])).values()] }],
      } : area));
      repaired = { ...repaired, areas } as T;
    }
    /*
     * History AB's Required Courses (verified 2026-10-28,
     * bulletin.uga.edu/Program/Details/35426): HIST 4990, then "Choose 9
     * credit hours ... (At least one 3000/4000-level course in each of three
     * geographical areas.)" over seven regional lists, then 12 hours of major
     * courses. Each region was read as a list of its own owing one hour, so
     * every board took a course from all seven (a senior was sent to two
     * more) and the hours read 24 of 24 with a row still missing.
     */
    if (program.id === '35426') {
      type Group = { label: string; choose: number | null; hours?: number | null; courses: UgaRequirementCourse[] };
      const areas = (repaired.areas as Array<AreaShape & { groups: Group[] }>).map((area) => {
        if (area.label !== 'Required Courses' || area.hours !== 24) return area;
        const regions = area.groups.filter((group) => /^\d\.\s/.test(group.label) && group.courses.length > 0);
        if (regions.length < 3) return area;
        const rest = area.groups.filter((group) => !regions.includes(group) && !(group.courses.length === 0 && group.hours === 9));
        const union = [...new Map(regions.flatMap((group) => group.courses).map((row) => [row.code, row])).values()];
        // A constraint, not minimumAreas: that would ask the student to pick three areas in setup.
        const lists = regions.map((group) => ({ label: group.label, codes: group.courses.map((row) => row.code) }));
        const geography = { label: 'Three geographical areas', choose: null, hours: 9, note: 'Choose 9 hours: at least one 3000/4000-level course in each of three geographical areas.', lists, constraints: [{ text: 'At least one 3000/4000-level course in each of three geographical areas.', n: 3, lists, single: false, distinctLists: true }], courses: union };
        const at = rest.findIndex((group) => /major courses/i.test(group.label));
        return { ...area, groups: at < 0 ? [...rest, geography] : [...rest.slice(0, at), geography, ...rest.slice(at)] };
      });
      repaired = { ...repaired, areas } as T;
    }
    /*
     * Area VI's language row, a choice of one whose courses the scrape
     * lost (a list of subjects or a sentence, no course table), so the row
     * could never be met and complete seniors read "VI 15 of 18" (verified
     * 2026-10-28 on bulletin.uga.edu/Program/Details/46524 and 35426):
     * Political Science asks for the third semester course of a foreign
     * language, History for any foreign language course.
     */
    const languageRow = (rows: UgaRequirementCourse[], note: string) => {
      const areas = (repaired.areas as Array<AreaShape & { groups: Array<{ choose: number | null; courses: unknown[] }> }>).map((area) => {
        if (!/^VI\./.test(area.label)) return area;
        let done = false;
        return { ...area, groups: area.groups.map((group) => {
          if (done || group.choose !== 1 || group.courses.length > 0) return group;
          done = true;
          return { ...group, label: 'Foreign language', note, courses: rows };
        }) };
      });
      repaired = { ...repaired, areas } as T;
    };
    if (program.id === '46524') languageRow(THIRD_SEMESTER_LANGUAGE, 'The third semester course of a foreign language.');
    if (program.id === '35426') languageRow(LANGUAGE_SUBJECTS.map((subject) => ({ code: `${subject} 1XXX`, title: `${subject} courses`, credits: 0, levelTo: 4 })), 'Any foreign language course.');
    if (program.college === 'BUS' && program.degree === 'BBA') repaired = withAreaAfter(repaired, '', TERRY_GRADUATION, false);
    if (program.degree === 'AB' || /^B[A-Z]+$/.test(program.degree ?? '')) repaired = withAreaAfter(repaired, '', UNIVERSITY_WIDE, false);
    return repaired;
  });
}
