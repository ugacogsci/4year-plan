type UgaRequirementCourse = {
  code: string;
  title: string;
  credits: number;
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
};

const courses = (
  rows: Array<[code: string, title: string, credits: number]>,
): UgaRequirementCourse[] =>
  rows.map(([code, title, credits]) => ({ code, title, credits }));

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

/** Apply narrow, source-backed repairs for UGA program pages the generic parser misses. */
export function applyUgaProgramOverrides<T extends UgaProgramRecord>(
  programs: T[],
): T[] {
  return programs.map((program) => {
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
    return program;
  });
}
