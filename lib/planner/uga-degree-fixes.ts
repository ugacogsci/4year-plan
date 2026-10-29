/**
 * UGA bachelor's degrees whose Bulletin page the reader (scripts/uga-programs.mjs)
 * cannot turn into a plan an advisor would give, written out from the page
 * itself (keep-planner/uga-audit/inventory.md, section 4 and patterns 13, 14
 * and 16, 2026-10-29). Each is keyed by program id and checked against
 * bulletin.uga.edu/Program/Details/<id>; the pages were read on 2026-10-25
 * and 2026-10-29.
 *
 * A written degree keeps the core curriculum the reader read (Areas I to V,
 * and Area VI unless it is written here too) and the graduation requirements
 * met by courses counted elsewhere (ugaOverlapArea), and replaces every other
 * area: the major as the page prints it, its general electives and its
 * degree total. So a later reading of the page cannot put back an area this
 * file left out on purpose (an optional certification, a second track), and
 * the page's areas of emphasis, where one must be picked, are a choice
 * setup asks about: groups labelled "Focus Area <n>: <name>" in one area
 * (uga-source.tsx namedProgramChoices), each emphasis its own rows.
 */

type UgaRequirementCourse = {
  code: string;
  title: string;
  credits: number;
  levelFrom?: number;
  levelTo?: number;
  /** A lab taken with the course before it ("AND CHEM 2211L" on the page). */
  andPrevious?: boolean;
};

type UgaRequirementGroup = {
  label: string;
  choose: number | null;
  hours?: number | null;
  note?: string;
  lists?: Array<{ label: string; codes: string[] }>;
  completeOneList?: boolean;
  constraints?: Array<{ text: string; n: number; lists: Array<{ label: string; codes: string[] }>; single: boolean; distinctLists?: boolean }>;
  courses: UgaRequirementCourse[];
};

type UgaRequirementArea = {
  label: string;
  hours: number;
  excludeCodes?: string[];
  groups: UgaRequirementGroup[];
};

type UgaProgramRecord = {
  id: string;
  areas: unknown[];
  totalCredits: number | null;
  areaHours: number;
  emphasisGroups?: unknown[];
};

const row = (code: string, title: string, credits: number): UgaRequirementCourse => ({ code, title, credits });
const lab = (code: string, title: string, credits: number): UgaRequirementCourse => ({ code, title, credits, andPrevious: true });

/** Every course listed. */
const all = (label: string, courses: UgaRequirementCourse[], note?: string): UgaRequirementGroup => ({ label, choose: null, ...(note ? { note } : {}), courses });
/** `n` of the courses listed. */
const choose = (label: string, n: number, courses: UgaRequirementCourse[], note?: string): UgaRequirementGroup => ({ label, choose: n, ...(note ? { note } : {}), courses });
/** `hours` of credit from the courses listed. */
const hoursFrom = (label: string, hours: number, courses: UgaRequirementCourse[], note?: string): UgaRequirementGroup => ({ label, choose: null, hours, ...(note ? { note } : {}), courses });
/** One of the course groups listed ("Choose 1 group(s)"), each a course and its lab. */
const oneGroup = (label: string, hours: number, groups: UgaRequirementCourse[][], note = 'Choose one complete course group.'): UgaRequirementGroup => ({
  label, choose: null, hours, note, completeOneList: true,
  lists: groups.map((courses) => ({ label: courses.map((course) => course.code).join(' and '), codes: courses.map((course) => course.code) })),
  courses: groups.flat(),
});

/** `hours` from named lists in any combination ("any combination of courses from Social Sciences, ..."), a course once. */
const hoursFromLists = (label: string, hours: number, lists: Record<string, UgaRequirementCourse[]>, note: string): UgaRequirementGroup => ({
  label, choose: null, hours, note,
  lists: Object.entries(lists).map(([name, courses]) => ({ label: name, codes: courses.map((course) => course.code) })),
  courses: [...new Map(Object.values(lists).flat().map((course) => [course.code, course])).values()],
});

/**
 * `hours` from the courses listed, where "only one of these courses can be
 * used": each such set is one list, every other course a list of its own,
 * and the picks come from `n` different lists (autoplan.ts distinctLists),
 * so a board does not book MATH 2200 and MATH 2250 for one requirement.
 */
const hoursFromDistinct = (label: string, hours: number, n: number, sets: UgaRequirementCourse[][], note: string): UgaRequirementGroup => {
  const lists = sets.map((courses) => ({ label: courses.map((course) => course.code).join(' or '), codes: courses.map((course) => course.code) }));
  return { label, choose: null, hours, note, lists, constraints: [{ text: note, n, lists, single: false, distinctLists: true }], courses: sets.flat() };
};

/**
 * A subject's courses from one level up ("ENTO courses at the 3000 level or
 * above"): the first row reads a held course at any of the levels
 * (levelTo, any-course.ts withHeldInRange), the others plan from each.
 */
const levels = (subject: string, from: number, to = 5): UgaRequirementCourse[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index).map((level, index) => ({
    code: `${subject} ${level}XXX`,
    title: index === 0 && to > from ? `${subject} courses at the ${level}000-${to}000 level` : `${subject} ${level}000-level courses`,
    credits: 0,
    ...(index === 0 && to > from ? { levelTo: to } : {}),
  }));

/** A subject's 1000- and 2000-level courses, as Area VI's lists of prefixes plan them; a held course of the subject at any level counts. */
const lowerLevels = (subjects: string[]): UgaRequirementCourse[] =>
  subjects.flatMap((subject) => [
    { code: `${subject} 1XXX`, title: `${subject} courses`, credits: 0, levelTo: 5 },
    { code: `${subject} 2XXX`, title: `${subject} 2000-level courses`, credits: 0 },
  ]);

const ANY_COURSE: UgaRequirementCourse = { code: 'ANY 1XXX', title: 'Any undergraduate course', credits: 0 };
const ANY_UPPER_COURSE: UgaRequirementCourse = { code: 'ANY 3XXX', title: 'Any upper-level course (3000-5999)', credits: 0 };

const area = (label: string, hours: number, groups: UgaRequirementGroup[]): UgaRequirementArea => ({ label, hours, groups });

/** "General Electives (N hours)", `upper` of them numbered 3000 or above. */
const generalElectives = (hours: number, upper = 0): UgaRequirementArea =>
  area('General Electives', hours, upper > 0 ? [hoursFrom('Upper-division general electives', upper, [ANY_UPPER_COURSE], `${upper} of the general elective hours numbered 3000 or above.`)] : []);

/** The label of one emphasis's rows inside an area of emphasis (uga-source.tsx namedChoiceFromLabel). */
const focus = (n: number, name: string, rows?: string) => `Focus Area ${n}: ${name}${rows ? `: ${rows}` : ''}`;

type WrittenDegree = {
  /** Area VI as the page prints it, where the reading lost or mangled it. */
  areaSix?: UgaRequirementArea;
  /** Every area after the core: the major, its electives. */
  major: UgaRequirementArea[];
  /** The page's "Total Major Hours", where the reading lost it. */
  total?: number;
};

const WRITTEN: Record<string, WrittenDegree> = {
  /*
   * Plant Biology BS (verified 2026-10-29, bulletin.uga.edu/Program/Details/62409):
   * Required Courses (33-36 hours) are the shared courses and one of three
   * areas of emphasis; the reading required all three (152 of 120 hours).
   * "* Only one" and "+ Only one" in Plant Biotechnology are a choice each.
   */
  '62409': {
    // Area VI's last two hours are general electives (the reading left them unnamed, so it never read complete): with the others, below.
    areaSix: area('VI. Courses Related to the Major', 16, [
      all('VI. Courses Related to the Major', [
        row('CHEM 1212', 'General Chemistry II', 3),
        lab('CHEM 1212L', 'General Chemistry Laboratory II', 1),
        row('CHEM 2211', 'Modern Organic Chemistry I', 3),
        lab('CHEM 2211L', 'Modern Organic Chemistry Laboratory I', 1),
      ]),
      choose('Calculus', 1, [
        row('MATH 2200', 'Analytic Geometry and Calculus', 4),
        row('MATH 2250', 'Calculus I for Science and Engineering', 4),
        row('MATH 2400', 'Differential Calculus with Theory', 4),
      ]),
      oneGroup('Organic chemistry, calculus or physics', 4, [
        [row('CHEM 2212', 'Modern Organic Chemistry II', 3), lab('CHEM 2212L', 'Modern Organic Chemistry Laboratory II', 1)],
        [row('MATH 2260', 'Calculus II for Science and Engineering', 4)],
        [row('MATH 2410', 'Integral Calculus with Theory', 4)],
        [row('PHYS 1111', 'Introductory Physics-Mechanics, Waves, Thermodynamics', 4)],
        [row('PHYS 1211', 'Principles of Physics for Scientists and Engineers-Mechanics, Waves, Thermodynamics', 4)],
        [row('PHYS 1311', 'Advanced Introductory Physics I', 4)],
      ], 'Choose 1 course (CHEM 2212 with its lab).'),
    ]),
    major: [
      area('Required Courses', 33, [
        all('Required Courses', [
          row('BIOL 1108', 'Principles of Biology II', 3),
          lab('BIOL 1108L', 'Principles of Biology II Laboratory', 1),
          row('GENE 3000', 'Evolutionary Biology', 4),
          row('GENE 3200', 'Genetics', 4),
          row('HORT 4430', 'Plant Physiology', 3),
          row('PBIO 4950', 'Capstone Skills in Plant Biology', 1),
        ]),
        choose('Statistics', 1, [
          row('BIOS 2010', 'Elementary Biostatistics', 4),
          row('STAT 2000', 'Introductory Statistics', 4),
        ]),
        all(focus(1, 'Plant Ecology and Environment'), [
          row('PBIO 3650', 'Plant Ecology', 4),
          row('PBIO 4650', 'Plant Biodiversity', 4),
        ]),
        choose(focus(1, 'Plant Ecology and Environment', 'quantitative or laboratory course'), 1, [
          row('BIOS 3000', 'Intermediate Biostatistics', 3),
          row('STAT 3110', 'Introduction to Statistics for Life Sciences', 3),
          row('GEOG 4370', 'Geographic Information Science', 3),
          row('HORT 4095', 'GPS/GIS Applications for Landscape Managers', 3),
          row('PBIO 3660L', 'Plant Biology Intensive Laboratory', 4),
        ]),
        choose(focus(1, 'Plant Ecology and Environment', 'internship or research'), 1, [
          row('ANTH 4261', 'Museum of Natural History Internship', 3),
          row('PBIO 4940', 'Internship in Plant Biology', 3),
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
        ]),
        all(focus(2, 'Plant Biotechnology and Bioinformatics'), [
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
        ]),
        choose(focus(2, 'Plant Biotechnology and Bioinformatics', 'bioinformatics course'), 1, [
          row('BINF 4550', 'Concepts in Bioinformatics and Omics', 3),
          row('BCMB 3600', 'Genomics and Bioinformatics', 3),
          row('GENE 4220L', 'Laboratory in Genetic Modeling', 3),
        ], 'Only one of these courses may be taken.'),
        choose(focus(2, 'Plant Biotechnology and Bioinformatics', 'methods laboratory'), 1, [
          row('BTEC 4000L', 'Methods in Biotechnology', 4),
          row('PBIO 3660L', 'Plant Biology Intensive Laboratory', 4),
        ], 'Only one of these courses may be taken.'),
        choose(focus(2, 'Plant Biotechnology and Bioinformatics', 'internship or research'), 1, [
          row('PBIO 4940', 'Internship in Plant Biology', 3),
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
        ]),
        all(focus(3, 'Plants and Microbes'), [
          row('PATH 3530', 'Introductory Plant Pathology', 3),
          row('PATH 4150', 'Plant Pathology Undergraduate Seminar', 1),
        ]),
        choose(focus(3, 'Plants and Microbes', 'mycology or microbiology'), 1, [
          row('PATH 4200', 'Mycology', 4),
          row('MIBO 3500', 'Introductory Microbiology', 3),
        ]),
        choose(focus(3, 'Plants and Microbes', 'soil, ecology or laboratory course'), 1, [
          row('CRSS 4610', 'Soil Microbiology', 4),
          row('PBIO 3650', 'Plant Ecology', 4),
          row('PBIO 3660L', 'Plant Biology Intensive Laboratory', 4),
        ]),
        choose(focus(3, 'Plants and Microbes', 'internship or research'), 1, [
          row('PBIO 4940', 'Internship in Plant Biology', 3),
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
        ]),
      ]),
      area('Major Electives', 9, [
        hoursFrom('Major Electives', 9, [
          row('ANTH 4261', 'Museum of Natural History Internship', 3),
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('BCMB 3600', 'Genomics and Bioinformatics', 3),
          row('BINF 4550', 'Concepts in Bioinformatics and Omics', 3),
          row('BIOS 3000', 'Intermediate Biostatistics', 3),
          row('BTEC 4000L', 'Methods in Biotechnology', 4),
          row('CBIO 4600', 'Biology of Protists', 3),
          lab('CBIO 4600L', 'Biology of Protists Laboratory', 1),
          row('CRSS 3060', 'Soils and Hydrology', 3),
          lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
          row('CRSS 4450', 'Crop Physiology', 3),
          row('CRSS 4590', 'Soil Fertility and Plant Nutrition', 3),
          lab('CRSS 4590L', 'Soil Fertility and Plant Nutrition Laboratory', 1),
          row('CRSS 4600', 'Soil Physics', 3),
          lab('CRSS 4600L', 'Soil Physics Laboratory', 1),
          row('CRSS 4610', 'Soil Microbiology', 4),
          row('ECOL 3500', 'Ecology', 3),
          lab('ECOL 3500L', 'Ecology Laboratory', 1),
          row('ECOL 4000', 'Population and Community Ecology', 3),
          row('ECOL 4500', 'Evolutionary Ecology', 4),
          row('FANR 4350', 'Conservation Genetics', 3),
          row('GENE 4220L', 'Laboratory in Genetic Modeling', 3),
          row('GEOG 4220', 'Ecological Biogeography', 3),
          row('GEOG 4240', 'Plant Geography', 3),
          row('GEOG 4370', 'Geographic Information Science', 3),
          row('HORT 3440', 'Herbs, Spices, and Medicinal Plants', 3),
          row('HORT 4095', 'GPS/GIS Applications for Landscape Managers', 3),
          row('HORT 4440', 'Environmental Physiology', 4),
          row('MIBO 3500', 'Introductory Microbiology', 3),
          row('PATH 3010', 'Fungi: Friends and Foes', 3),
          row('PATH 3530', 'Introductory Plant Pathology', 3),
          row('PATH 4150', 'Plant Pathology Undergraduate Seminar', 1),
          row('PATH 4200', 'Mycology', 4),
          row('PBGG 4140', 'Plant Breeding', 3),
          row('PBIO 3100', 'Plant-Microbe Interactions', 3),
          row('PBIO 3270', 'Flowers', 3),
          row('PBIO 3400', 'Plants and Society', 3),
          row('PBIO 3600', 'Plant Cell and Developmental Biology', 4),
          row('PBIO 3650', 'Plant Ecology', 4),
          row('PBIO 3660L', 'Plant Biology Intensive Laboratory', 4),
          row('PBIO 4500', 'Introduction to Gene Technology', 3),
          row('PBIO 4510', 'Genome Evolution Across the Tree of Life', 3),
          row('PBIO 4520', 'Plant-Animal Interactions', 3),
          row('PBIO 4650', 'Plant Biodiversity', 4),
          row('PBIO 4700', 'Computational Plant Science', 3),
          row('PBIO 4750', 'Tropical Ecology and Conservation', 3),
          row('PBIO 4940', 'Internship in Plant Biology', 3),
          row('PBIO 4960', 'Independent Research in Plant Biology', 4),
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('PBIO 4970R', 'Faculty-Mentored Undergraduate Research II', 3),
          row('STAT 3110', 'Introduction to Statistics for Life Sciences', 3),
          row('WASR 4110', 'Forest Hydrology', 4),
          row('WASR 4400', 'Wetland Management and Restoration', 3),
        ], 'Choose 9 to 12 hours.'),
      ]),
      // 12 to 18 hours, and Area VI's last 2.
      area('General Electives', 14, []),
    ],
  },
  /*
   * Natural Resource Management and Sustainability BSFR (verified
   * 2026-10-29, bulletin.uga.edu/Program/Details/51733): Required Courses
   * (60 hours) are the Common Curriculum (28) and one Area of Emphasis
   * (32); the reading required all three emphases (181 of 120 hours) and
   * lost Area VI's free elective and FANR 3950 (3 hours).
   */
  '51733': {
    // Area VI's free elective: with the general electives (an area of its own here, as the degree has none).
    areaSix: area('VI. Courses Related to the Major', 14, [
      all('VI. Courses Related to the Major', [
        row('BIOL 1108', 'Principles of Biology II', 3),
        lab('BIOL 1108L', 'Principles of Biology II Laboratory', 1),
        row('CHEM 1212', 'General Chemistry II', 3),
        lab('CHEM 1212L', 'General Chemistry Laboratory II', 1),
      ]),
      choose('Communication', 1, [
        row('AGCM 2200', 'Communicating in Agricultural and Environmental Sciences', 3),
        row('COMM 1110', 'Introduction to Public Speaking', 3),
        row('FANR 3950', 'Professional Communication and Development for Natural Resource Students', 3),
      ]),
      choose('Statistics', 1, [
        row('BIOS 2010', 'Elementary Biostatistics', 4),
        row('BUSN 3000', 'Applied Statistics and Data Analysis for Business', 3),
        row('FANR 2010', 'Introduction to Natural Resource Statistics', 4),
        row('STAT 2000', 'Introductory Statistics', 4),
      ]),
    ]),
    major: [
      area('General Electives', 4, []),
      area('Common Curriculum', 28, [
        all('Common Curriculum', [
          row('CRSS 3060', 'Soils and Hydrology', 3),
          lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
          row('FANR 3200W', 'Ecology of Natural Resources', 3),
          lab('FANR 3200L', 'Ecology of Natural Resources Laboratory', 1),
          row('FANR 3300', 'Economics of Renewable Resources', 2),
          lab('FANR 3400', 'Society and Natural Resources', 2),
          row('FANR 3700', 'Natural Resources Data Processing', 3),
          row('FANR 3800', 'Spatial Analysis of Natural Resources', 2),
          lab('FANR 3800L', 'Spatial Analysis of Natural Resources Laboratory', 1),
          row('FANR 4800W', 'Renewable Resources Policy', 2),
          row('FORS 4050', 'Forest Measurements and Sampling', 2),
          lab('FORS 4050L', 'Forest Measurements and Sampling Laboratory', 2),
        ]),
        hoursFrom('Capstone', 4, [
          row('FANR 4501', 'Senior Project in Natural Resources I', 1),
          lab('FANR 4502S', 'Senior Project in Natural Resources II', 3),
          row('FANR 4960R', 'Faculty-Mentored Undergraduate Research in Natural Resources I', 3),
          row('FANR 4970R', 'Faculty-Mentored Undergraduate Research in Natural Resources II', 3),
          row('FANR 4980R', 'Faculty-Mentored Undergraduate Research in Natural Resources III', 3),
          row('FANR 4990R', 'Senior Thesis in Natural Resources', 3),
        ], 'FANR 4501 and FANR 4502S (Senior Project), or 4 hours of faculty-mentored research or senior thesis.'),
      ]),
      area('Area of Emphasis', 32, [
        all(focus(1, 'Community Forestry and Arboriculture'), [
          row('COFA 3900', 'Community Forestry and Arboriculture Internship', 3),
          row('COFA 5010', 'Urban Tree Management II', 4),
          row('COFA 5301', 'Community and Urban Soils and Site Development - Service Learning', 4),
          row('COFA 5500', 'Community Forest Management', 3),
          row('FORS 3010', 'Dendrology', 2),
          lab('FORS 3010L', 'Dendrology Laboratory', 1),
          row('FORS 4210', 'Forest Health and Protection', 3),
          row('FORS 4650', 'Forestry Field Camp', 4),
        ]),
        hoursFrom(focus(1, 'Community Forestry and Arboriculture', 'electives'), 8, [
          row('AAEC 4040', 'Applied Statistics for Business Decisions', 4),
          row('ACCT 2101', 'Principles of Accounting I', 3),
          row('ACCT 2102', 'Principles of Accounting II', 3),
          row('CVLE 4770', 'Urban Infrastructure Systems', 3),
          row('ECOL 3770S', 'Urban Ecology - Service Learning', 3),
          row('ECOL 4220', 'Restoration Ecology', 3),
          row('ECON 4150', 'Environmental Economics', 3),
          row('ECON 4160', 'Urban Economics', 3),
          row('EDES 4650', 'City Planning', 3),
          row('ENTO 3740', 'Insect Pest Management', 4),
          row('ENTO 4500E', 'Biological Control', 3),
          row('ENTO 4740', 'Integrated Pest Management', 3),
          row('FANR 5620', 'GIS Applications in Natural Resources and Ecology', 3),
          row('FORS 4530', 'Wood Properties and Utilization', 3),
          row('FORS 5600', 'Wildland Fire', 3),
          row('GEOG 3630', 'Introduction to Urban Geography', 3),
          row('GEOG 4385', 'Community GIS (Service Learning)', 3),
          row('GEOG 4630', 'Advanced Urban Geography', 3),
          row('GEOG 4631', 'Race, Inequality, and the American City', 3),
          row('GEOG 4632', 'Urban Social Movements', 3),
          row('HIST 3170', 'History of American Cities', 3),
          row('HORT 4090', 'Sustainable Landscape Management and Design', 3),
          row('HORT 4430', 'Plant Physiology', 3),
          row('LAND 4360', 'Advanced Landscape Ecology', 3),
          row('POLS 4640', 'Urban Politics', 3),
          row('POLS 4645E', 'Applied Civic Engagement - Service Learning', 3),
          row('PRTM 3310', 'Humans, Nature, and Environmental Awareness', 3),
          row('PRTM 4400', 'Park Management', 3),
          row('PRTM 5900', 'Ecotourism and Sustainable Development', 3),
          row('SPAN 4150', 'Business Spanish', 3),
          row('STAT 4210', 'Statistical Methods', 3),
          row('WASR 4000', 'Forest Soil Management', 4),
          row('WASR 4110', 'Forest Hydrology', 4),
          row('WASR 4400', 'Wetland Management and Restoration', 3),
        ], 'Choose 8 hours, or a faculty mentor approved course.'),
        all(focus(2, 'Water and Soil Resources'), [
          row('CRSS 4670', 'Environmental Soil Chemistry', 3),
          row('PHYS 1111', 'Introductory Physics-Mechanics, Waves, Thermodynamics', 4),
          row('WASR 4110', 'Forest Hydrology', 4),
        ]),
        choose(focus(2, 'Water and Soil Resources', 'hydrology and soil physics'), 2, [
          row('CRSS 4600', 'Soil Physics', 3),
          lab('CRSS 4600L', 'Soil Physics Laboratory', 1),
          row('GEOL 4220', 'Hydrogeology', 3),
          row('WASR 4500', 'Quantitative Methods in Hydrology', 3),
        ]),
        choose(focus(2, 'Water and Soil Resources', 'earth surface processes'), 1, [
          row('ATSC 3110', 'Climatology', 3),
          row('CRSS 4540', 'Pedology', 4),
          row('GEOG 1111', 'Introduction to Physical Geography', 3),
          row('GEOG 1113', "Exploring Earth's Surface: Landforms and Environments", 3),
          row('GEOG 3010', 'General Geomorphology', 3),
          row('GEOL 1120', 'Environmental Geoscience and Sustainability', 3),
          row('GEOL 1250', 'Physical Geology', 4),
        ]),
        choose(focus(2, 'Water and Soil Resources', 'microbiology or freshwater ecosystems'), 1, [
          row('CRSS 4610', 'Soil Microbiology', 4),
          row('ECOL 4310', 'Freshwater Ecosystems', 3),
          lab('ECOL 4310L', 'Freshwater Ecosystems Lab', 1),
          row('EHSC 4310', 'Environmental Microbiology', 4),
        ]),
        hoursFrom(focus(2, 'Water and Soil Resources', 'electives'), 8, [
          row('COFA 5301', 'Community and Urban Soils and Site Development - Service Learning', 4),
          row('CRSS 2010', 'Crop Science', 3),
          row('CRSS 3540', 'Soil Morphology and Interpretation', 3),
          row('CRSS 4540', 'Pedology', 4),
          row('CRSS 4580', 'Soil Erosion and Conservation', 3),
          row('CRSS 4590', 'Soil Fertility and Plant Nutrition', 3),
          row('CRSS 4600', 'Soil Physics', 3),
          row('CRSS 4600L', 'Soil Physics Laboratory', 1),
          row('CRSS 4610', 'Soil Microbiology', 4),
          row('CRSS 4660', 'Hydrogeochemical Characterization of Environmental Field Sites', 3),
          row('ECOL 2100', 'Global Climate Change: Past, Present, and Future', 3),
          row('ECOL 3440', 'Science Communication for Ecologists', 3),
          row('ECOL 3530', 'Conservation Biology', 3),
          row('ECOL 4310', 'Freshwater Ecosystems', 3),
          lab('ECOL 4310L', 'Freshwater Ecosystems Lab', 1),
          row('EHSC 4610', 'Water Pollution and Human Health', 3),
          row('FANR 4271', 'People, Planet, and Profit', 3),
          row('FORS 3010', 'Dendrology', 2),
          lab('FORS 3010L', 'Dendrology Laboratory', 1),
          row('FORS 4700', 'Forest Economics', 3),
          row('FORS 5600', 'Wildland Fire', 3),
          row('GEOG 3010', 'General Geomorphology', 3),
          row('GEOG 4060', 'Field Methods: Environmental Monitoring and Assessment', 3),
          row('GEOG 4300', 'Data Science in Geography', 3),
          row('GEOG 4330', 'Aerial Photographs and Image Interpretation', 3),
          row('GEOG 4350', 'Remote Sensing of Environment', 3),
          row('GEOL 3010', 'Earth Materials', 4),
          row('GEOL 3020', 'Surficial and Near-Surficial Processes', 4),
          row('GEOL 3030', 'Elementary Oceanography', 3),
          row('HORT 3300E', 'Organic Gardening', 3),
          row('WASR 3900', 'Water and Soil Resources Internship', 3),
          row('WASR 4000', 'Forest Soil Management', 4),
          row('WASR 4500', 'Quantitative Methods in Hydrology', 3),
          row('WASR 4700L', 'Hydrology, Geology, and Soils of Georgia', 3),
          ...levels('WASR', 3),
        ], 'Choose 8 hours, or a faculty mentor approved course. No more than 3 hours of WASR 3900 count toward graduation.'),
        all(focus(3, 'Geospatial Information Science'), [
          row('FANR 5620', 'GIS Applications in Natural Resources and Ecology', 3),
          row('FANR 5630', 'Statistical Software for Natural Resource Management', 3),
          row('GEOG 4590', 'Programming for Geographic Information Science', 3),
        ]),
        choose(focus(3, 'Geospatial Information Science', 'remote sensing'), 1, [
          row('GEOG 4350', 'Remote Sensing of Environment', 3),
          row('GEOG 4460', 'Field Methods in Remote Sensing', 3),
        ]),
        hoursFrom(focus(3, 'Geospatial Information Science', 'natural resources electives'), 10, [
          row('ECOL 4310', 'Freshwater Ecosystems', 3),
          lab('ECOL 4310L', 'Freshwater Ecosystems Lab', 1),
          row('FANR 4271', 'People, Planet, and Profit', 3),
          row('FISH 4200', 'Aquatic Biology', 3),
          row('FISH 4200L', 'Aquatic Biology Lab', 1),
          row('FISH 4520', 'Conservation Decision-Making', 3),
          row('FORS 3010', 'Dendrology', 2),
          row('FORS 3010L', 'Dendrology Laboratory', 1),
          row('FORS 4270', 'Field Studies in Conservation', 3),
          row('FORS 4700', 'Forest Economics', 3),
          row('PRTM 3310', 'Humans, Nature, and Environmental Awareness', 3),
          row('PRTM 4400', 'Park Management', 3),
          row('PRTM 5410', 'Stewardship and Protection of Natural Resources', 3),
          row('WASR 3900', 'Water and Soil Resources Internship', 3),
          row('WASR 4110', 'Forest Hydrology', 4),
          row('WILD 3000W', 'Introduction to Fish and Wildlife Management', 2),
          row('WILD 4100', 'Principles of Wildlife Habitat and Management', 3),
          row('WILD 4400', 'Wildlife Physiology and Nutrition', 3),
          row('WILD 4740', 'Animal Behavior', 3),
          row('WILD 5700', 'Applied Population Dynamics', 2),
          row('WILD 5700L', 'Applied Population Dynamics Lab', 1),
        ], 'Choose 10 hours, or a faculty mentor approved course.'),
        hoursFrom(focus(3, 'Geospatial Information Science', 'geospatial electives'), 10, [
          row('ATSC 4140', 'Satellite Meteorology and Climatology', 3),
          row('CBIO 4835', 'Introduction to Computational Biology', 3),
          row('CRSS 4050', 'Improving Nutrient and Energy Efficiency with Geographic Information Systems', 4),
          row('ECOL 4450', 'GIS for Ecologists', 3),
          row('EDES 4270', 'Environmental Design Uses of Geographic Information Systems', 3),
          row('EDES 4280E', 'Environmental Design Uses of Geographic Information Systems', 3),
          row('ENGR 4390', 'CubeSats: Design, Integration, and Testing for Remote Sensing Satellites', 3),
          row('FANR 5620', 'GIS Applications in Natural Resources and Ecology', 3),
          row('FANR 5640', "Unmanned Aerial Systems' (UAS) Role in Natural Resource Management", 3),
          row('FORS 5650', 'Aerial Photogrammetry in Forestry', 3),
          row('GEOG 4330', 'Aerial Photographs and Image Interpretation', 3),
          row('GEOG 4370', 'Geographic Information Science', 3),
          row('GEOG 4375', 'GIS Applications in Agriculture', 4),
          row('GEOG 4380', 'Transportation Modeling and GIS', 3),
          row('GEOG 4385', 'Community GIS (Service Learning)', 3),
          row('GEOG 4410', 'Geovisualization and Data Visualization', 3),
          row('GEOG 4450', 'Digital Image Analysis', 3),
          row('GEOG 4460', 'Field Methods in Remote Sensing', 3),
          row('GEOG 4470', 'Advanced Geospatial Analysis and Spatial Statistics', 3),
          row('GEOG 4571', 'Geographic Information Systems for Health and the Environment', 3),
          row('GEOG 4591', 'Introduction to Geospatial Artificial Intelligence', 3),
          row('GEOG 4592', 'Advanced Geospatial Artificial Intelligence', 3),
          row('WASR 4500', 'Quantitative Methods in Hydrology', 3),
        ], 'Choose 10 hours, or a faculty mentor approved course.'),
      ]),
    ],
  },
  /*
   * Health and Physical Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/28666): Required Courses (60 hours) end
   * in the Teacher Certification Option or the Area of Emphasis in
   * Educational Studies, 13 hours either way; the reading required both
   * (143 of 120 hours) and booked student teaching (KINS 5460) at 3 hours,
   * not the 10 the option's 13 leave it. Area VI's last hour is a general
   * elective (a General Electives area of its own: an unnamed hour inside
   * Area VI could never read complete).
   */
  '28666': {
    areaSix: area('VI. Courses Related to the Major', 17, [
      all('VI. Courses Related to the Major', [
        row('CBIO 2200', 'Anatomy and Physiology I', 4),
        row('CBIO 2210', 'Anatomy and Physiology II', 4),
        row('EDUC 2120', 'Exploring Socio-Cultural Perspectives in Educational Contexts', 3),
        row('EDUC 2130', 'Exploring Learning and Teaching', 3),
        row('EDUC 2140', 'Foundations of Reading', 3),
      ], 'A grade of C or higher in EDUC 2120 and EDUC 2130.'),
    ]),
    major: [
      area('Required Courses', 60, [
        all('Required Courses', [
          row('KINS 3105', 'Teaching Methods for Fitness', 3),
          row('KINS 3110', 'Teaching of Net/Wall Activities', 3),
          row('KINS 3120', 'Teaching of Striking/Target Activities', 3),
          row('KINS 3210', 'Teaching of Individual Activities', 3),
          row('KINS 3220', 'Teaching of Invasion Activities', 3),
          row('KINS 3302S', 'Multicultural Service-Learning Practicum', 1),
          row('KINS 3720', 'Foundations of Teaching Physical Education', 3),
          row('KINS 4305', 'Physical Education in the Elementary School', 4),
          row('KINS 4330', 'Physical Education for the Middle/Secondary School', 3),
          row('KINS 4340', 'Basic Curriculum and Teaching Procedures in School Health Education', 3),
          row('KINS 4360', 'Curriculum and Assessment in Physical Education', 3),
          row('KINS 4760', 'Motor Skill Behavior', 3),
          row('KINS 5620', 'Pediatric Adapted Physical Activity', 3),
        ], 'Students also demonstrate eight sport competencies (PEDB classes, high school or club sport, or a skills test).'),
        choose('Substance use', 1, [
          row('HPRB 5210', 'Substance Use and Misuse', 3),
          row('ECHD 3170', 'Drug and Alcohol Abuse Issues', 3),
        ], 'HPRB 5210 preferred.'),
        choose('Biomechanics', 1, [
          row('KINS 3600', 'Applied Biomechanics', 3),
          row('KINS 4200', 'Biomechanics', 3),
        ]),
        choose('Exercise physiology', 1, [
          row('KINS 3700', 'Applied Exercise Physiology', 3),
          row('KINS 4630', 'Exercise Physiology', 3),
        ]),
        all(focus(1, 'Teacher Certification Option'), [
          row('HPRB 5060', 'Educational Strategies in Human Sexuality', 3),
          row('KINS 5460', 'Student Teaching in Physical Education', 10),
        ], 'Leads to teacher certification; see the Bulletin for the program completion requirements.'),
        hoursFrom(focus(2, 'Educational Studies in Health and Physical Education'), 13, [
          row('KINS 2100', 'Prevention and Care of Athletic Injuries', 3),
          lab('KINS 2100L', 'Prevention and Care of Athletic Injuries Laboratory', 1),
          row('KINS 2500', 'Exercise is Medicine', 3),
          row('KINS 3115E', 'Structural Kinesiology', 3),
          row('KINS 3415', 'Philosophy and Ethics in Sport', 3),
          row('KINS 3420', 'Managing the Legal Aspects of Sport', 3),
          row('KINS 3430', 'Introduction to Sport Management', 3),
          row('KINS 3450S', 'Practicum in Fitness and Conditioning', 3),
          row('KINS 3460', 'Practicum for Health Care Professionals', 3),
          row('KINS 3480', 'Practicum in Kinesiology Research', 3),
          row('KINS 3500', 'Personal Training', 3),
          row('KINS 3510', 'Group Exercise Instruction', 3),
          row('KINS 3830', 'Study Design and Statistics in Kinesiology', 3),
          row('KINS 4000', 'Directed Study in Kinesiology', 3),
          row('KINS 4250', 'Introduction to Sports Analytics', 3),
          row('KINS 4300', 'Exercise Epidemiology', 3),
          row('KINS 4310', 'Exercise Prescription for Special Populations', 3),
          row('KINS 4320', 'Habitual Movement and Successful Aging', 3),
          row('KINS 4350', 'European Perspectives in Kinesiology', 4),
          row('KINS 4400', 'Exercise and Sport Psychology', 3),
          row('KINS 4450E', 'Initiating Motivation for Change in Health, Exercise, and Sport', 3),
          row('KINS 4600', 'Measurement and Surveillance of Physical Activity', 3),
          row('KINS 4640', 'Scientific Principles of Conditioning and Fitness', 4),
          row('KINS 4750S', 'Service Learning in Kinesiology', 3),
          row('KINS 4820', 'Social Aspects of Sport', 3),
          row('KINS 4830', 'Sport Policy and Governance', 3),
          row('KINS 4840', 'Sport Event Management', 3),
          row('KINS 5120E', 'Analyzing Sport Pedagogy', 3),
          row('KINS 5180E', 'Injury Prevention for Coaches', 3),
          row('KINS 5190', 'Research in Coaching and Coach Education', 3),
          row('KINS 5210', 'Sport and the Mass Media', 3),
          row('KINS 5250', 'Gender and Sport', 3),
          row('KINS 5660', 'Athlete Development', 3),
          row('KINS 5930E', 'Research Literature in Sport Coaching and Coaching Education', 3),
          row('NUTR 4220', 'Nutrition in Physical Activity, Exercise, and Sport', 3),
        ], 'Does not lead to teacher certification. Choose 13 hours; other courses with advisor approval.'),
      ]),
      // Area VI's last hour.
      area('General Electives', 1, []),
    ],
  },
  /*
   * Music BMus - Music Performance (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/16876): the Elective Track is one of
   * Instrumental, Piano or Vocal Performance ("Choose 1 group"); the reading
   * required the Piano and Vocal tracks both and left 8 hours unnamed (132 of
   * 120 hours). MUSI 1810 is 4 hours (two semesters of 2).
   */
  '16876': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('MUSI 1100', 'Music Theory I', 2),
        row('MUSI 1110', 'Aural Skills I', 2),
        row('MUSI 1120', 'Music Theory II', 2),
        row('MUSI 1130', 'Aural Skills II', 2),
        row('MUSI 1810', 'Freshman Applied Instruction', 4),
        row('MUSI 2500', 'Piano Class I', 1),
        row('MUSI 2510', 'Piano Class II', 1),
      ]),
      hoursFrom('Large Ensembles', 4, [
        row('MUSI 4700', 'The UGA Glee Club', 1),
        row('MUSI 4710', 'The Georgia Treble Choir', 1),
        row('MUSI 4740', 'University Symphony Orchestra', 1),
        row('MUSI 4750', 'Georgia Choral Union', 1),
        row('MUSI 4755', 'Guitar Ensemble', 1),
        row('MUSI 4760', 'UGA Hodgson Singers', 1),
        row('MUSI 4838', 'Symphonic Band', 1),
        row('MUSI 4839', 'Wind Symphony', 1),
        row('MUSI 4840', 'Wind Ensemble', 1),
      ]),
    ]),
    major: [
      area('Required Courses', 40, [
        all('Applied Study', [
          row('MUSI 2810', 'Sophomore Applied Instruction', 2),
          row('MUSI 2820', 'Sophomore Applied Instruction and Recital', 2),
          row('MUSI 3810', 'Junior Applied Instruction', 2),
          row('MUSI 3820', 'Junior Applied Instruction and Recital', 2),
          row('MUSI 4280', 'Instrumental/Vocal/Wind/Choral Literature', 2),
          row('MUSI 4810', 'Senior Applied Instruction', 2),
          row('MUSI 4820', 'Senior Applied Instruction and Recital', 2),
        ]),
        choose('Pedagogy', 1, [
          row('MUSI 3831', 'Instrumental Pedagogy', 2),
          row('MUSI 3450S', 'Vocal Pedagogy', 2),
          row('MUSI 3460', 'Piano Pedagogy I', 2),
        ]),
        all('Music Theory/Ear Training', [
          row('MUSI 2100', 'Music Theory III', 2),
          row('MUSI 2110', 'Aural Skills III', 2),
        ]),
        choose('Upper Theory Elective', 1, [
          row('MUSI 4100', 'Interpreting Popular Music', 3),
          row('MUSI 4110', 'Modal Counterpoint', 3),
          row('MUSI 4120', 'Form and Analysis', 3),
          row('MUSI 4135', 'Jazz Theory', 3),
          row('MUSI 4140', 'Tonal Counterpoint', 3),
          row('MUSI 4145', 'Model Composition', 3),
          row('MUSI 4150', 'Analysis of Non-Tonal Music', 3),
          row('MUSI 4160', 'Analysis of Texted Music', 3),
          row('MUSI 4170', 'Dissolution of Tonality', 3),
          row('MUSI 4175', 'Exploring Math and Music', 3),
          row('MUSI 4190', 'Special Topics in Music Theory and Analysis', 3),
        ]),
        all('Music History', [
          row('MUSI 3030', 'Music in the United States', 3),
        ]),
        choose('Music History: two surveys', 2, [
          row('MUSI 3020', 'World Music Survey: Africa, Europe, and the Americas', 3),
          row('MUSI 3021', 'World Music Survey: Asia, Australia, and Oceania', 3),
          row('MUSI 3210', 'Music in the Western Tradition Pre-1750', 3),
          row('MUSI 3220', 'Music in the Western Tradition Post-1750', 3),
        ]),
        all('Conducting', [
          row('MUSI 3480', 'Introduction to Conducting', 2),
        ]),
        choose('Conducting: one more', 1, [
          row('MUSI 3490', 'Choral Conducting', 2),
          row('MUSI 3500', 'Band Conducting', 2),
          row('MUSI 3510', 'Orchestra Conducting', 2),
        ]),
        all('Keyboard Competency and Career Preparedness', [
          row('MUSI 2520', 'Piano Class III', 1),
          row('MUSI 4010', 'Introduction to Music Technology', 2),
          row('MUSI 4060', 'Music in the Real World', 1),
        ]),
      ]),
      area('Major Electives', 16, [
        hoursFrom('Large Ensembles', 4, [
          row('MUSI 4700', 'The UGA Glee Club', 1),
          row('MUSI 4710', 'The Georgia Treble Choir', 1),
          row('MUSI 4740', 'University Symphony Orchestra', 1),
          row('MUSI 4750', 'Georgia Choral Union', 1),
          row('MUSI 4755', 'Guitar Ensemble', 1),
          row('MUSI 4760', 'UGA Hodgson Singers', 1),
          row('MUSI 4838', 'Symphonic Band', 1),
          row('MUSI 4839', 'Wind Symphony', 1),
          row('MUSI 4840', 'Wind Ensemble', 1),
        ]),
        hoursFrom('Small Ensembles', 4, [
          row('MUSI 2860', 'African Music Ensemble', 1),
          row('MUSI 4730', 'African American Choral Ensemble', 1),
          row('MUSI 4775', 'Piano Ensemble', 1),
          row('MUSI 4781', 'Jazz Ensemble I', 1),
          row('MUSI 4785', 'Jazz Ensemble II', 1),
          row('MUSI 4790', 'Chamber Music Ensemble', 1),
          row('MUSI 4800', 'Contemporary Chamber Ensemble', 1),
          row('MUSI 4850', 'Opera Ensemble', 1),
          row('MUSI 4855', 'Opera Theater', 1),
          row('MUSI 4861', 'Applied Ethnomusicology: African Music', 1),
          row('MUSI 4870', 'Asian Music Ensemble', 1),
          row('MUSI 4880', 'Latin American Music Ensemble', 1),
          row('MUSI 4890', 'Middle East Music Ensemble', 1),
          row('MUSI 4910', 'Chamber Orchestra', 1),
          row('MUSI 5106', 'Jazz Combos', 1),
          row('MUSI 5200', 'Repertory Singers', 1),
          row('MUSI 5250', 'UGA Choral Project', 1),
        ]),
        hoursFrom(focus(1, 'Instrumental Performance'), 8, levels('MUSI', 3), 'MUSI courses 3000-level and above (8 hours).'),
        // A choice of every course listed: a list with no number to choose, in an area of electives, is read as hours to draw from.
        choose(focus(2, 'Piano Performance'), 1, [
          row('MUSI 3470', 'Keyboard Musicianship', 1),
        ]),
        hoursFrom(focus(2, 'Piano Performance', 'MUSI courses 3000-level and above'), 7, levels('MUSI', 3)),
        choose(focus(3, 'Vocal Performance'), 3, [
          row('MUSI 4461', 'English and Italian Lyric Diction', 2),
          row('MUSI 4463', 'French Lyric Diction', 1),
          row('MUSI 4464', 'German Lyric Diction', 1),
        ]),
        hoursFrom(focus(3, 'Vocal Performance', 'MUSI courses 3000-level and above'), 4, levels('MUSI', 3)),
      ]),
      area('General Electives', 4, []),
    ],
  },
  /*
   * Spanish AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/21871):
   * Required Courses are the General Spanish Track or the Area of Emphasis in
   * Spanish Interdisciplinary Studies; the reading required both. Area VI's
   * "SPAN 2001 AND SPAN 2002" was read as one course and its 9 to 12 hours
   * from related prefixes left unnamed. General electives: 9 of the 30
   * hours upper division.
   */
  '21871': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('SPAN 2550', 'Latino Literature, Language, and Culture', 3),
        row('SPAN 2001', 'Intermediate Spanish I', 3),
        row('SPAN 2002', 'Intermediate Spanish II', 3),
      ], 'SPAN 2120H (Honors) may replace SPAN 2001 and 2002, with 12 hours of related courses instead of 9.'),
      hoursFrom('Related courses', 9, lowerLevels(['AFAM', 'AFST', 'AMHA', 'ANTH', 'ARGD', 'ARHI', 'ARAB', 'ARID', 'ARST', 'ARTS', 'BENG', 'CHNS', 'CLAS', 'CMLT', 'COMM', 'ECON', 'ENGL', 'FILM', 'FREN', 'GEOG', 'GRMN', 'GREK', 'HIST', 'HEBR', 'HNDI', 'INDO', 'ITAL', 'JPNS', 'KREN', 'LACS', 'LATN', 'LING', 'LLED', 'MUSI', 'PASH', 'PERS', 'PHIL', 'POLS', 'PORT', 'PTSP', 'QUEC', 'RELI', 'ROML', 'RUSS', 'SCAN', 'SEMI', 'SLAV', 'SPAN', 'SWAH', 'THEA', 'TURK', 'URDU', 'VIET', 'WMST', 'YORB', 'ZULU']), 'Courses with these prefixes.'),
    ]),
    major: [
      area('Required Courses', 30, [
        all('Required Courses', [
          row('SPAN 3030', 'Texts in Global Contexts', 3),
          row('SPAN 3050', 'Introduction to Spanish Linguistics', 3),
          row('SPAN 3010', 'Spanish Cultural Dialogues', 3),
          row('SPAN 3020', 'Writing Critically in Spanish', 3),
        ], 'A grade of C or better in every major course; at least 15 major hours in residence. Heritage speakers may take SPAN 3011 in place of SPAN 3010 and 3020 (a SPAN 4000-level course instead where SPAN 3011 counted in Area IV).'),
        choose(focus(1, 'General Spanish Track'), 3, [
          row('SPAN 4030', 'Latinx in the United States', 3),
          row('SPAN 4040', 'Literary Adventures from Spain', 3),
          row('SPAN 4050', 'Exploring Modern Spain', 3),
          row('SPAN 4060', 'Cultures in Contact After 1492', 3),
          row('SPAN 4070', 'Latin American Voices of Change', 3),
          row('SPAN 4550', 'Introduction to the History of Spanish', 3),
          row('SPAN 4650', 'Spanish Phonetics and Language Variation', 3),
          row('SPAN 4651', 'Advanced Spanish Grammar', 3),
          row('SPAN 4652', 'Spanish Dialectology and Language Variation', 3),
        ], 'Fundamental courses in linguistics, literature and cultural studies.'),
        choose(focus(1, 'General Spanish Track', 'three more SPAN 4000-level courses'), 3, [
          row('SPAN 4003', 'Medical Spanish', 3),
          row('SPAN 4004', 'Introduction to Medical Interpreting, Ethics, and Intercultural Communication', 3),
          row('SPAN 4004S', 'Introduction to Medical Interpreting, Ethics, and Intercultural Communication', 3),
          row('SPAN 4005', 'Introduction to Translation', 3),
          row('SPAN 4005S', 'Introduction to Translation', 3),
          row('SPAN 4030', 'Latinx in the United States', 3),
          row('SPAN 4040', 'Literary Adventures from Spain', 3),
          row('SPAN 4050', 'Exploring Modern Spain', 3),
          row('SPAN 4060', 'Cultures in Contact After 1492', 3),
          row('SPAN 4070', 'Latin American Voices of Change', 3),
          row('SPAN 4080', 'Discovering Cultural Formation', 3),
          row('SPAN 4081', 'Spanish Film', 3),
          row('SPAN 4082', 'Latin American Film', 3),
          row('SPAN 4083S', 'Diversity Through Dance', 3),
          row('SPAN 4085', 'Studies in Hispanic Digital Culture', 3),
          row('SPAN 4090S', 'Practicum in Service Learning', 3),
          row('SPAN 4092', 'Archival and Special Collections Studies in Spanish', 3),
          row('SPAN 4100', 'Spanish Topics Across the Disciplines', 3),
          row('SPAN 4120', 'Exploring Cultures in Spanish', 3),
          row('SPAN 4121', 'Topics in Spanish-American Studies', 3),
          row('SPAN 4150', 'Business Spanish', 3),
          row('SPAN 4190', 'Internship in Spanish', 3),
          row('SPAN 4191', 'Internship in Spanish', 3),
          row('SPAN 4250', 'Advanced Business Spanish', 3),
          row('SPAN 4550', 'Introduction to the History of Spanish', 3),
          row('SPAN 4650', 'Spanish Phonetics and Language Variation', 3),
          row('SPAN 4651', 'Advanced Spanish Grammar', 3),
          row('SPAN 4652', 'Spanish Dialectology and Language Variation', 3),
          row('SPAN 4750', 'Spanish Syntax', 3),
        ], 'SPAN 4003 and SPAN 4250 are equivalent, as are SPAN 4004, 4004S and 4150: credit for one of each.'),
        choose(focus(2, 'Spanish Interdisciplinary Studies'), 2, [
          row('SPAN 4030', 'Latinx in the United States', 3),
          row('SPAN 4040', 'Literary Adventures from Spain', 3),
          row('SPAN 4050', 'Exploring Modern Spain', 3),
          row('SPAN 4060', 'Cultures in Contact After 1492', 3),
          row('SPAN 4070', 'Latin American Voices of Change', 3),
          row('SPAN 4550', 'Introduction to the History of Spanish', 3),
          row('SPAN 4650', 'Spanish Phonetics and Language Variation', 3),
          row('SPAN 4651', 'Advanced Spanish Grammar', 3),
          row('SPAN 4652', 'Spanish Dialectology and Language Variation', 3),
        ], 'Fundamental courses in linguistics, literature and cultural studies. The emphasis also asks for an immersion experience: an approved study abroad program in a Spanish-speaking country, the Mary Lyndon Residential Language Community (SPAN 2030), a SPAN service-learning course (SPAN 4090S, 4004S, 4005S or 4083S), or mentored research (SPAN 4960R, started two semesters before graduation).'),
        choose(focus(2, 'Spanish Interdisciplinary Studies', 'two more SPAN 4000-level courses'), 2, [
          row('SPAN 4003', 'Medical Spanish', 3),
          row('SPAN 4004', 'Introduction to Medical Interpreting, Ethics, and Intercultural Communication', 3),
          row('SPAN 4004S', 'Introduction to Medical Interpreting, Ethics, and Intercultural Communication', 3),
          row('SPAN 4005', 'Introduction to Translation', 3),
          row('SPAN 4005S', 'Introduction to Translation', 3),
          row('SPAN 4030', 'Latinx in the United States', 3),
          row('SPAN 4040', 'Literary Adventures from Spain', 3),
          row('SPAN 4050', 'Exploring Modern Spain', 3),
          row('SPAN 4060', 'Cultures in Contact After 1492', 3),
          row('SPAN 4070', 'Latin American Voices of Change', 3),
          row('SPAN 4080', 'Discovering Cultural Formation', 3),
          row('SPAN 4081', 'Spanish Film', 3),
          row('SPAN 4082', 'Latin American Film', 3),
          row('SPAN 4083S', 'Diversity Through Dance', 3),
          row('SPAN 4085', 'Studies in Hispanic Digital Culture', 3),
          row('SPAN 4090S', 'Practicum in Service Learning', 3),
          row('SPAN 4092', 'Archival and Special Collections Studies in Spanish', 3),
          row('SPAN 4100', 'Spanish Topics Across the Disciplines', 3),
          row('SPAN 4120', 'Exploring Cultures in Spanish', 3),
          row('SPAN 4121', 'Topics in Spanish-American Studies', 3),
          row('SPAN 4150', 'Business Spanish', 3),
          row('SPAN 4190', 'Internship in Spanish', 3),
          row('SPAN 4191', 'Internship in Spanish', 3),
          row('SPAN 4250', 'Advanced Business Spanish', 3),
          row('SPAN 4550', 'Introduction to the History of Spanish', 3),
          row('SPAN 4650', 'Spanish Phonetics and Language Variation', 3),
          row('SPAN 4651', 'Advanced Spanish Grammar', 3),
          row('SPAN 4652', 'Spanish Dialectology and Language Variation', 3),
          row('SPAN 4750', 'Spanish Syntax', 3),
        ], 'SPAN 4003 and SPAN 4250 are equivalent, as are SPAN 4004, 4004S and 4150: credit for one of each.'),
        hoursFrom(focus(2, 'Spanish Interdisciplinary Studies', 'interdisciplinary courses'), 6, [
          ...levels('ROML', 3),
          ...levels('SPAN', 4),
          ...levels('LACS', 3),
          row('ACCT 4900', 'International Accounting', 3),
          row('ANTH 3540', 'Multicultural Health Care', 3),
          row('ARHI 3020', 'Renaissance Art', 3),
          row('ARHI 3030', 'Baroque Art', 3),
          row('ARHI 3077', 'Latin American Modern Art', 3),
          row('ARHI 3940', 'Gender and Feminism and Art History', 3),
          row('ARHI 4060', 'Image in Space: Mural Painting and Architecture in Byzantium', 3),
          row('ARHI 4125', 'Intellectual Foundations of Medieval Art and Architecture', 3),
          row('ARHI 4230', 'Art of the Early Modern Hispanic World', 3),
          row('ARHI 4400', 'The Natural History of Art', 3),
          row('ARHI 4500', 'Realism and Impressionism', 3),
          row('BUSN 4650', 'Law, Culture, and Global Business', 3),
          row('CMLT 3200', 'Contemporary World Literature', 3),
          row('CRSS 4931', 'Agroecology of Tropical America Field Trip', 3),
          row('CMSD 3020', 'Language Science', 3),
          row('CMSD 3120', 'Study of Language Development', 3),
          row('CMSD 4010', 'Phonetics for Communication Sciences and Disorders', 3),
          row('CMSD 4110', 'Speech Disorders', 3),
          row('CMSD 4170', 'Language Disorders of Children and Adults', 3),
          row('ECON 4040', 'The International Business Environment', 3),
          row('ECON 4550', 'International Trade: Theory and Policy', 3),
          row('FINA 4810', 'International Finance', 3),
          row('FILM 4100', 'Latinx Film and Visual Culture', 3),
          row('GEOG 3640', 'The Geography of Human Rights', 3),
          row('GEOG 4694', 'Politics and the Modern European State', 3),
          row('GLOB 3100', 'Introduction to Global Health', 3),
          row('GLOB 3150', 'Culture and Global Health', 3),
          row('GLOB 3200', 'Global Health and the Links Among Food, Culture, and Disease', 3),
          row('HIST 3010', 'United States Immigration History', 3),
          row('HIST 3020', 'United States Foreign Relations Since 1914', 3),
          row('HIST 3056H', 'Multicultural America (Honors)', 3),
          row('HIST 3224', 'The U.S.-Mexico Border: From NAFTA to El Chapo', 3),
          row('HIST 3240', 'The Caribbean Area', 3),
          row('HIST 3242', 'Disasters in the Caribbean and Latin America', 3),
          row('HIST 3270', 'History of Argentina and Chile in the 20th Century', 3),
          row('HIST 3443', 'Spain in the Age of Cervantes', 3),
          row('HIST 3490', 'European Encounter with Islam', 3),
          row('HIST 3710', 'The Atlantic World, 1450-1750: Exchange, Conquest, and Empire', 3),
          row('HIST 4091', 'Problems in American Foreign Policy, 1776-Present', 3),
          row('HIST 4110', 'Multicultural Georgia', 3),
          row('HIST 4211', 'Cuba from Emancipation to Revolution', 3),
          row('HIST 4214', 'Introduction to the Religions of the Caribbean', 3),
          row('HIST 4220', 'The United States and Latin America', 3),
          row('HIST 4222', 'Mexico and the United States since 1821: Two Centuries of Entwined History', 3),
          row('HIST 4235', 'Pirates of the Caribbean', 3),
          row('ILAD 5610S', 'Inclusive Leadership', 3),
          row('INTB 4800', 'Internship and/or Cooperative Education in International Business', 3),
          row('INTB 5100', 'Special Topics in International Business', 3),
          row('INTL 4215', 'International Humanitarian Law', 3),
          row('INTL 4280', 'Nationalism and Ethnic Conflict', 3),
          row('INTL 4390', 'European Politics', 3),
          row('INTL 4410', 'Terrorism', 3),
          row('INTL 4620', 'Human Rights', 3),
          row('INTL 4630', 'Population, Immigration, and Politics', 3),
          row('INTL 4640', 'European Union', 3),
          row('INTL 4644', 'Human Rights in the European Union', 3),
          row('INTL 4650', 'Women and World Politics', 3),
          row('INTL 4675E', 'Music and Politics Around the World', 3),
          row('JOUR 5320', 'Journalism Ethics and Diversity', 3),
          row('JRLC 5080', 'International Mass Communication', 3),
          row('JRLC 5400', 'Race, Gender, and the Media', 3),
          row('JURI 3821', 'Race and Law', 3),
          row('LEGL 4900', 'International Legal Transactions for Business', 3),
          row('LING 3830', 'Languages of the World', 3),
          row('LING 3850', 'Language, Politics, and Identity', 3),
          row('LING 4015', 'Language, Race, and Ethnicity in the U.S.', 3),
          row('LING 4175', 'Second Language Acquisition', 3),
          row('LING 4870', 'Language, Gender, and Sexuality', 3),
          row('LLED 5040', 'Language and Culture in the Classroom', 3),
          row('LLED 5318', "Diverse Children's Literature, Grades P-8", 3),
          row('LLED 5540', 'Culture in the TESOL and World Language Classroom', 3),
          row('LLED 5730', 'First and Second Language Acquisition and Development', 3),
          row('MARK 4550', 'Multicultural Marketing', 3),
          row('MARK 4700', 'International Marketing', 3),
          row('MGMT 5560', 'International Strategic Management', 3),
          row('MIST 5780', 'Globalization and Information Systems', 3),
          row('MUSI 3020', 'World Music Survey: Africa, Europe, and the Americas', 3),
          row('SOCI 4040', 'Global Inequality and Social Change', 3),
          row('SOCI 3650', 'Colorism and Hairism in Communities of Color', 3),
        ], 'ROML or LACS courses at the 3000 level or above, SPAN at the 4000 level or above, or related international, cultural or linguistic courses with Romance Languages approval.'),
      ]),
      generalElectives(30, 9),
    ],
  },
  /*
   * Housing Management and Policy BSFCS (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/28344): Major Electives (33 hours) are
   * Option I (Housing Management and Policy) or Option II (Residential
   * Property Management); the reading required both. "Choose 1 credit
   * hour(s)" of FHCE 3200 or 3250 is one course.
   */
  '28344': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('ECON 2106', 'Principles of Microeconomics', 3),
        row('FHCE 2100', 'Introduction to Consumer Economics', 3),
      ]),
      hoursFromDistinct('VI. Courses Related to the Major: 12 hours', 12, 4, [
        [row('ACCT 2101', 'Principles of Accounting I', 3)],
        [row('ACCT 2102', 'Principles of Accounting II', 3)],
        [row('BUSN 3000', 'Applied Statistics and Data Analysis for Business', 3), row('STAT 2000', 'Introductory Statistics', 4), row('STAT 2100H', 'Introduction to Statistics and Computing (Honors)', 4)],
        [row('CSCI 1301', 'Introduction to Computing and Programming', 4)],
        [row('FHCE 1110', 'Consumers In Our Society', 3)],
        [row('HDFS 2100', 'Relationship Development, Maintenance, and Dissolution', 3)],
        [row('LEGL 2700', 'Legal and Regulatory Environment of Business', 3)],
        [row('MATH 1113', 'Precalculus', 3)],
        [row('MATH 2200', 'Analytic Geometry and Calculus', 4), row('MATH 2250', 'Calculus I for Science and Engineering', 4)],
        [row('MATH 2310H', 'Integral Calculus (Honors)', 4), row('MATH 2400', 'Differential Calculus with Theory', 4), row('MATH 2410', 'Integral Calculus with Theory', 4)],
        [row('NUTR 2100', 'Fundamentals of Human Nutrition', 3)],
        [row('PSYC 1101', 'Elementary Psychology', 3)],
        [row('SOCI 1101', 'Introductory Sociology', 3)],
        [row('TXMI 2100', 'Textiles for Consumers', 3)],
      ], 'Choose 12 hours. Only one of BUSN 3000, STAT 2000 and STAT 2100H counts; one of MATH 2200 and 2250; one of MATH 2310H, 2400 and 2410.'),
    ]),
    major: [
      area('Required Courses', 13, [
        all('Required Courses', [
          row('FACS 2000', 'Introduction to Family and Consumer Sciences', 1),
          row('FHCE 3100', 'Consumer Decision Making', 3),
        ]),
        choose('Personal finance', 1, [
          row('FHCE 3200', 'Introduction to Personal Finance', 3),
          row('FHCE 3250', 'Survey of Financial Planning', 3),
        ]),
        choose('Housing', 1, [
          row('FHCE 3300', 'Housing in Contemporary Society', 3),
          row('FHCE 3305', 'Housing in International Contemporary Societies', 3),
        ]),
        choose('Housing theory or policy', 1, [
          row('FHCE 4300', 'Advanced Housing Theories', 3),
          row('FHCE 4310', 'Housing Policy', 3),
          row('FHCE 4400', 'Family Demographics and Policy', 3),
        ]),
      ]),
      area('Major Electives', 33, [
        hoursFrom(focus(1, 'Housing Management and Policy'), 15, [
          row('FACS 5711', 'Study Tour in Family and Consumer Sciences', 3),
          row('FACS 5910', 'Internship in Family and Consumer Sciences', 3),
          row('FACS 5915', 'International Internship in Family and Consumer Sciences', 3),
          row('FACS 5950', 'International Study in Family and Consumer Sciences', 3),
          row('FHCE 3000', 'Family Resource Management', 3),
          row('FHCE 3005', 'International Family Resource Management', 3),
          row('FHCE 3305', 'Housing in International Contemporary Societies', 3),
          row('FHCE 3350', 'Introduction to Residential Property Management', 3),
          row('FHCE 4150', 'Women in the Global Economy', 3),
          row('FHCE 4300', 'Advanced Housing Theories', 3),
          row('FHCE 4310', 'Housing Policy', 3),
          row('FHCE 4320', 'Legal Issues in Residential Property Management', 3),
          row('FHCE 4330', 'Leasing Strategies for Residential Property Management', 3),
          row('FHCE 4340S', 'Housing and Community Development', 3),
          row('FHCE 4360', 'Rural Housing and Economic Development', 3),
          row('FHCE 4400', 'Family Demographics and Policy', 3),
          row('FHCE 4810', 'Housing for an Aging Population', 3),
          row('FHCE 5175', 'Poverty in America', 3),
          row('FHCE 5305', 'Housing Management and Policy Practicum', 3),
          row('FHCE 5310', 'Affordable Housing Development and Management', 3),
          row('FHCE 5320', 'Residential Property Management Technology and Simulation', 3),
          row('FHCE 5350S', 'Housing Counseling', 3),
          row('FHCE 5360S', 'Topics in Sustainable Housing', 3),
        ]),
        hoursFrom(focus(1, 'Housing Management and Policy', 'related courses'), 18, [
          row('BUSN 3000', 'Applied Statistics and Data Analysis for Business', 3),
          row('FACS 5711', 'Study Tour in Family and Consumer Sciences', 3),
          row('FACS 5910', 'Internship in Family and Consumer Sciences', 3),
          row('FACS 5915', 'International Internship in Family and Consumer Sciences', 3),
          row('FACS 5950', 'International Study in Family and Consumer Sciences', 3),
          row('GEOG 2011', 'Maps, Data, and Society', 3),
          row('HDFS 4500', 'Aging and the Family', 3),
          ...['ECON', 'ENTR', 'FHCE', 'GEOG', 'HIPR', 'INTL', 'LEGL', 'POLS', 'REAL', 'SOCI', 'STAT', 'TXMI'].flatMap((subject) => levels(subject, 3)),
        ], 'Or courses with the ECON, ENTR, FHCE, GEOG, HIPR, INTL, LEGL, POLS, REAL, SOCI, STAT or TXMI prefix at the 3000 level or above.'),
        // A choice of every course listed: a list with no number to choose, in an area of electives, is read as hours to draw from.
        choose(focus(2, 'Area of Emphasis in Residential Property Management'), 3, [
          row('FHCE 3350', 'Introduction to Residential Property Management', 3),
          row('FHCE 4320', 'Legal Issues in Residential Property Management', 3),
          row('FHCE 4330', 'Leasing Strategies for Residential Property Management', 3),
        ]),
        choose(focus(2, 'Area of Emphasis in Residential Property Management', 'affordable housing or technology'), 1, [
          row('FHCE 5310', 'Affordable Housing Development and Management', 3),
          row('FHCE 5320', 'Residential Property Management Technology and Simulation', 3),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Residential Property Management', 'housing course'), 3, [
          row('FHCE 3000', 'Family Resource Management', 3),
          row('FHCE 3005', 'International Family Resource Management', 3),
          row('FHCE 3305', 'Housing in International Contemporary Societies', 3),
          row('FHCE 4300', 'Advanced Housing Theories', 3),
          row('FHCE 4310', 'Housing Policy', 3),
          row('FHCE 4340S', 'Housing and Community Development', 3),
          row('FHCE 4360', 'Rural Housing and Economic Development', 3),
          row('FHCE 4400', 'Family Demographics and Policy', 3),
          row('FHCE 4810', 'Housing for an Aging Population', 3),
          row('FHCE 5175', 'Poverty in America', 3),
          row('FHCE 5305', 'Housing Management and Policy Practicum', 3),
          row('FHCE 5310', 'Affordable Housing Development and Management', 3),
          row('FHCE 5320', 'Residential Property Management Technology and Simulation', 3),
          row('FHCE 5350S', 'Housing Counseling', 3),
          row('FHCE 5360S', 'Topics in Sustainable Housing', 3),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Residential Property Management', 'related courses'), 18, [
          row('BUSN 3000', 'Applied Statistics and Data Analysis for Business', 3),
          row('FACS 5711', 'Study Tour in Family and Consumer Sciences', 3),
          row('FACS 5910', 'Internship in Family and Consumer Sciences', 3),
          row('FACS 5915', 'International Internship in Family and Consumer Sciences', 3),
          row('FACS 5950', 'International Study in Family and Consumer Sciences', 3),
          row('GEOG 2011', 'Maps, Data, and Society', 3),
          row('HDFS 4500', 'Aging and the Family', 3),
          ...['ECON', 'ENTR', 'FHCE', 'GEOG', 'HIPR', 'INTL', 'LEGL', 'POLS', 'REAL', 'SOCI', 'STAT', 'TXMI'].flatMap((subject) => levels(subject, 3)),
        ], 'Or courses with the ECON, ENTR, FHCE, GEOG, HIPR, INTL, LEGL, POLS, REAL, SOCI, STAT or TXMI prefix at the 3000 level or above.'),
      ]),
      generalElectives(14),
    ],
  },
  /*
   * Dance AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/71373):
   * the optional teacher certification (33 hours) is not part of the
   * degree; DANC 4800 or DANC 4810 ("only one of these courses can be
   * used"); "Required Courses (46 hours)" lists 42, which with Area VI, 4
   * hours of major electives and 14 of general electives make the 120.
   * Technique courses are repeatable, and a board books a course once: a
   * row asking for more hours than its courses carry books the higher
   * level at the repeated hours (Jazz Dance II, 4 hours: two semesters of
   * 2), so it can be met.
   */
  '71373': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('DANC 2000', 'Production Assignment I', 1),
        row('DANC 2300', 'Dance Improvisation I', 2),
        row('DANC 2600', 'Music for Dance', 2),
        row('DANC 2642', 'Jazz Dance II', 4),
      ], 'Technique placement is by audition. Jazz Dance II is repeatable: 4 hours, two semesters of 2.'),
      hoursFrom('Dance Elective', 1, [
        row('DANC 1617', 'Ballroom Foundations II - Lead/Male', 1),
        row('DANC 1618', 'Ballroom Foundations II - Follow/Female', 1),
        row('DANC 1671', 'Pointe I', 1),
        row('DANC 1680', 'Pas De Deux', 1),
        row('DANC 2020', 'Practicing Wellness', 1),
        row('DANC 2030', 'The Pilates Method I', 1),
        row('DANC 2040', 'Yoga: Asana Practice I', 1),
        row('DANC 2050', 'Training in Alternate Dance Forms I', 1),
        row('DANC 2060', 'Aerial Yoga Trapeze I', 1),
        row('DANC 2080', 'Aerial Dance I', 2),
        row('DANC 2250', 'Performance Company II', 2),
        row('DANC 2550', 'Dance Repertory Lab I', 1),
        row('DANC 2610', 'Tap Dance II', 1),
        row('DANC 2662L', 'Ballet II Lab', 1),
        row('DANC 2672', 'Pointe II', 1),
        row('DANC 2680', 'Pas De Deux', 1),
        row('DANC 2900', 'Student Performance I', 1),
        row('DANC 3010', 'Laban/Bartenieff Movement Studies', 2),
        row('DANC 3030', 'The Pilates Method II', 1),
        row('DANC 3040', 'Yoga: Asana Practice II', 1),
        row('DANC 3050', 'Training in Alternate Dance Forms II', 1),
        row('DANC 3060', 'Aerial Yoga Trapeze II', 1),
        row('DANC 3080', 'Aerial Dance II', 2),
        row('DANC 3200', 'Teaching Practicum in Dance I', 1),
        row('DANC 3210', 'Teaching Practicum in Dance II', 1),
        row('DANC 3220', 'Teaching Practicum in Dance III', 1),
        row('DANC 3250', 'Performance Company III', 2),
        row('DANC 3300', 'Ethical Reasoning: Mind, Body, and Decision', 3),
        row('DANC 3500', 'Seminar in Dance', 3),
        row('DANC 3510', 'Dance in New York City Field Study', 3),
        row('DANC 3520', 'Movement and Community in Ghana', 3),
        row('DANC 3550', 'Dance Repertory Lab II', 1),
        row('DANC 3610', 'Tap Dance III', 1),
        row('DANC 3620', 'Intermediate/Advanced West African Dance Forms and Styles', 2),
        row('DANC 3640', 'Intermediate/Advanced Hip-Hop Dance and Culture', 2),
        row('DANC 3643', 'Jazz Dance III', 2),
        row('DANC 3663L', 'Ballet III Lab', 1),
        row('DANC 3672', 'Pointe III and Variations', 1),
        row('DANC 3680', 'Pas De Deux', 1),
        row('DANC 3700', 'Teaching Dance for Children', 2),
        row('DANC 3800', 'Choreographic Lab', 1),
        row('DANC 3900', 'Student Performance II', 1),
        row('DANC 4000', 'Independent Study in Dance', 3),
        row('DANC 4010', 'Special Topics', 3),
        row('DANC 4020', 'Dance and Community', 3),
        row('DANC 4030', 'Contemporizing Ballet: Histories, Choreographies, and Pedagogies', 2),
        row('DANC 4080', 'Aerial Dance III', 2),
        row('DANC 4250', 'Performance Company IV', 2),
        row('DANC 4550', 'Dance Repertory Lab III', 1),
        row('DANC 4643', 'Jazz Dance III', 2),
        row('DANC 4664L', 'Ballet IV Lab', 1),
        row('DANC 4672', 'Pointe IV and Variations', 1),
        row('DANC 4680', 'Pas De Deux', 1),
        row('DANC 4754', 'Contemporary Modern Dance IV', 2),
        row('DANC 4764', 'Ballet IV', 2),
      ], 'Select 1 hour from the Major Technique Electives.'),
      hoursFrom('Contemporary Modern Dance', 4, [
        row('DANC 2652', 'Contemporary Modern Dance II', 2),
        row('DANC 3653', 'Contemporary Modern Dance III', 2),
      ], 'Repeatable; a minimum of 4 hours.'),
      hoursFrom('Ballet', 4, [
        row('DANC 2662', 'Ballet II', 2),
        row('DANC 3663', 'Ballet III', 2),
      ], 'Repeatable; a minimum of 4 hours.'),
    ]),
    major: [
      area('Dance Technique and Performance', 20, [
        choose('West African or Hip-Hop', 1, [
          row('DANC 2620', 'West African Dance Forms and Styles', 2),
          row('DANC 2640', 'Hip-Hop Dance and Culture', 2),
        ]),
        all('Contemporary Modern Dance III and IV', [
          row('DANC 3653', 'Contemporary Modern Dance III', 2),
          row('DANC 4654', 'Contemporary Modern Dance IV', 4),
        ], 'Repeatable; a minimum of 6 hours (Contemporary Modern Dance IV planned at 4 hours, two semesters of 2).'),
        all('Ballet III and IV', [
          row('DANC 3663', 'Ballet III', 2),
          row('DANC 4664', 'Ballet IV', 4),
        ], 'Repeatable; a minimum of 6 hours (Ballet IV planned at 4 hours, two semesters of 2).'),
        all('Performance Company', [
          row('DANC 2250', 'Performance Company II', 2),
          row('DANC 3250', 'Performance Company III', 2),
        ], 'Repeatable; 4 hours.'),
        hoursFrom('Technique Electives', 2, [
          row('DANC 1617', 'Ballroom Foundations II - Lead/Male', 1),
          row('DANC 1618', 'Ballroom Foundations II - Follow/Female', 1),
          row('DANC 1671', 'Pointe I', 1),
          row('DANC 1680', 'Pas De Deux', 1),
          row('DANC 2020', 'Practicing Wellness', 1),
          row('DANC 2030', 'The Pilates Method I', 1),
          row('DANC 2040', 'Yoga: Asana Practice I', 1),
          row('DANC 2050', 'Training in Alternate Dance Forms I', 1),
          row('DANC 2060', 'Aerial Yoga Trapeze I', 1),
          row('DANC 2080', 'Aerial Dance I', 2),
          row('DANC 2250', 'Performance Company II', 2),
          row('DANC 2550', 'Dance Repertory Lab I', 1),
          row('DANC 2610', 'Tap Dance II', 1),
          row('DANC 2662L', 'Ballet II Lab', 1),
          row('DANC 2672', 'Pointe II', 1),
          row('DANC 2680', 'Pas De Deux', 1),
          row('DANC 2900', 'Student Performance I', 1),
          row('DANC 3010', 'Laban/Bartenieff Movement Studies', 2),
          row('DANC 3030', 'The Pilates Method II', 1),
          row('DANC 3040', 'Yoga: Asana Practice II', 1),
          row('DANC 3050', 'Training in Alternate Dance Forms II', 1),
          row('DANC 3060', 'Aerial Yoga Trapeze II', 1),
          row('DANC 3080', 'Aerial Dance II', 2),
          row('DANC 3200', 'Teaching Practicum in Dance I', 1),
          row('DANC 3210', 'Teaching Practicum in Dance II', 1),
          row('DANC 3220', 'Teaching Practicum in Dance III', 1),
          row('DANC 3250', 'Performance Company III', 2),
          row('DANC 3300', 'Ethical Reasoning: Mind, Body, and Decision', 3),
          row('DANC 3500', 'Seminar in Dance', 3),
          row('DANC 3510', 'Dance in New York City Field Study', 3),
          row('DANC 3520', 'Movement and Community in Ghana', 3),
          row('DANC 3550', 'Dance Repertory Lab II', 1),
          row('DANC 3610', 'Tap Dance III', 1),
          row('DANC 3620', 'Intermediate/Advanced West African Dance Forms and Styles', 2),
          row('DANC 3640', 'Intermediate/Advanced Hip-Hop Dance and Culture', 2),
          row('DANC 3643', 'Jazz Dance III', 2),
          row('DANC 3663L', 'Ballet III Lab', 1),
          row('DANC 3672', 'Pointe III and Variations', 1),
          row('DANC 3680', 'Pas De Deux', 1),
          row('DANC 3700', 'Teaching Dance for Children', 2),
          row('DANC 3800', 'Choreographic Lab', 1),
          row('DANC 3900', 'Student Performance II', 1),
          row('DANC 4000', 'Independent Study in Dance', 3),
          row('DANC 4010', 'Special Topics', 3),
          row('DANC 4020', 'Dance and Community', 3),
          row('DANC 4030', 'Contemporizing Ballet: Histories, Choreographies, and Pedagogies', 2),
          row('DANC 4080', 'Aerial Dance III', 2),
          row('DANC 4250', 'Performance Company IV', 2),
          row('DANC 4550', 'Dance Repertory Lab III', 1),
          row('DANC 4643', 'Jazz Dance III', 2),
          row('DANC 4664L', 'Ballet IV Lab', 1),
          row('DANC 4672', 'Pointe IV and Variations', 1),
          row('DANC 4680', 'Pas De Deux', 1),
          row('DANC 4754', 'Contemporary Modern Dance IV', 2),
          row('DANC 4764', 'Ballet IV', 2),
        ], 'Repeatable; 2 hours.'),
      ]),
      area('Dance Theory', 12, [
        all('Dance Theory', [
          row('DANC 3020', 'Principles of Science and Somatics in Dance Training', 3),
          row('DANC 3400', 'Dance Composition', 3),
          row('DANC 4500', 'Studies in Dance History', 3),
          row('DANC 4700', 'Issues in Dance Education and Pedagogy', 3),
        ]),
      ]),
      area('Additional Requirements', 10, [
        all('Additional Requirements', [
          row('DANC 2900', 'Student Performance I', 1),
          row('DANC 3000', 'Production Assignment II', 1),
          row('DANC 3420', 'Digital Media for Dance', 1),
          row('DANC 3810E', 'Writing in Dance', 1),
          row('DANC 4910', 'Senior Seminar in Dance', 1),
        ]),
        choose('Senior project', 1, [
          row('DANC 4800', 'Senior Choreographic Project', 1),
          row('DANC 4810', 'Applied Research', 1),
        ], 'Only one of these courses can be used.'),
        choose('Movement studies or pedagogy', 2, [
          row('DANC 3010', 'Laban/Bartenieff Movement Studies', 2),
          row('DANC 3700', 'Teaching Dance for Children', 2),
          row('DANC 4030', 'Contemporizing Ballet: Histories, Choreographies, and Pedagogies', 2),
        ], 'A course here cannot also count as a Major Elective.'),
      ]),
      area('Major Electives', 4, [
        // Not the technique courses booked at their repeated hours above: a row's hours set the course's.
        hoursFrom('Major Electives', 4, [
          row('DANC 1617', 'Ballroom Foundations II - Lead/Male', 1),
          row('DANC 1618', 'Ballroom Foundations II - Follow/Female', 1),
          row('DANC 1671', 'Pointe I', 1),
          row('DANC 1680', 'Pas De Deux', 1),
          row('DANC 2020', 'Practicing Wellness', 1),
          row('DANC 2030', 'The Pilates Method I', 1),
          row('DANC 2040', 'Yoga: Asana Practice I', 1),
          row('DANC 2050', 'Training in Alternate Dance Forms I', 1),
          row('DANC 2060', 'Aerial Yoga Trapeze I', 1),
          row('DANC 2080', 'Aerial Dance I', 2),
          row('DANC 2250', 'Performance Company II', 2),
          row('DANC 2550', 'Dance Repertory Lab I', 1),
          row('DANC 2610', 'Tap Dance II', 1),
          row('DANC 2620', 'West African Dance Forms and Styles', 2),
          row('DANC 2640', 'Hip-Hop Dance and Culture', 2),
          row('DANC 2662L', 'Ballet II Lab', 1),
          row('DANC 2672', 'Pointe II', 1),
          row('DANC 2680', 'Pas De Deux', 1),
          row('DANC 2900', 'Student Performance I', 1),
          row('DANC 3010', 'Laban/Bartenieff Movement Studies', 2),
          row('DANC 3030', 'The Pilates Method II', 1),
          row('DANC 3040', 'Yoga: Asana Practice II', 1),
          row('DANC 3050', 'Training in Alternate Dance Forms II', 1),
          row('DANC 3060', 'Aerial Yoga Trapeze II', 1),
          row('DANC 3080', 'Aerial Dance II', 2),
          row('DANC 3200', 'Teaching Practicum in Dance I', 1),
          row('DANC 3210', 'Teaching Practicum in Dance II', 1),
          row('DANC 3220', 'Teaching Practicum in Dance III', 1),
          row('DANC 3250', 'Performance Company III', 2),
          row('DANC 3300', 'Ethical Reasoning: Mind, Body, and Decision', 3),
          row('DANC 3500', 'Seminar in Dance', 3),
          row('DANC 3510', 'Dance in New York City Field Study', 3),
          row('DANC 3520', 'Movement and Community in Ghana', 3),
          row('DANC 3550', 'Dance Repertory Lab II', 1),
          row('DANC 3610', 'Tap Dance III', 1),
          row('DANC 3620', 'Intermediate/Advanced West African Dance Forms and Styles', 2),
          row('DANC 3640', 'Intermediate/Advanced Hip-Hop Dance and Culture', 2),
          row('DANC 3643', 'Jazz Dance III', 2),
          row('DANC 3653', 'Contemporary Modern Dance III', 2),
          row('DANC 3663', 'Ballet III', 2),
          row('DANC 3663L', 'Ballet III Lab', 1),
          row('DANC 3672', 'Pointe III and Variations', 1),
          row('DANC 3680', 'Pas De Deux', 1),
          row('DANC 3700', 'Teaching Dance for Children', 2),
          row('DANC 3800', 'Choreographic Lab', 1),
          row('DANC 3900', 'Student Performance II', 1),
          row('DANC 4000', 'Independent Study in Dance', 3),
          row('DANC 4010', 'Special Topics', 3),
          row('DANC 4020', 'Dance and Community', 3),
          row('DANC 4030', 'Contemporizing Ballet: Histories, Choreographies, and Pedagogies', 2),
          row('DANC 4080', 'Aerial Dance III', 2),
          row('DANC 4250', 'Performance Company IV', 2),
          row('DANC 4550', 'Dance Repertory Lab III', 1),
          row('DANC 4643', 'Jazz Dance III', 2),
          row('DANC 4664L', 'Ballet IV Lab', 1),
          row('DANC 4672', 'Pointe IV and Variations', 1),
          row('DANC 4680', 'Pas De Deux', 1),
          row('DANC 4754', 'Contemporary Modern Dance IV', 2),
          row('DANC 4764', 'Ballet IV', 2),
        ], 'Technique electives; repeatable.'),
      ]),
      generalElectives(14),
    ],
  },
  /*
   * Environmental Economics and Management BSES (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/66704): Environmental Studies is 12
   * hours in any combination of its four lists; the reading required three
   * of the lists whole (about 34 courses) and made the fourth a 1-hour pool.
   * Major Electives: at least 3 courses at the 4000 level or above. Area
   * VI's listed courses come to 16 of its 18 hours; the other 2 are general
   * electives.
   */
  '66704': {
    areaSix: area('VI. Courses Related to the Major', 16, [
      all('VI. Courses Related to the Major', [
        row('ECON 2105', 'Principles of Macroeconomics', 3),
        row('STAT 2000', 'Introductory Statistics', 4),
      ], 'Any University System of Georgia STAT 1DXX or 2DXX may replace STAT 2000.'),
      choose('Microeconomics', 1, [
        row('AAEC 2580', 'Applied Microeconomic Principles', 3),
        row('ECON 2106', 'Principles of Microeconomics', 3),
      ]),
      choose('Computing or accounting', 1, [
        row('ACCT 1160', 'Survey of Accounting', 3),
        row('CSCI 1210', 'Computer Modeling and Science', 3),
        row('CSCI 1301', 'Introduction to Computing and Programming', 4),
      ]),
      choose('Quantitative tools', 1, [
        row('AAEC 3020', 'Analytical and Computational Tools for Applied Economics', 3),
        row('MATH 2110', 'Calculus for Economics', 3),
        row('MATH 2260', 'Calculus II for Science and Engineering', 4),
        row('MATH 2310H', 'Integral Calculus (Honors)', 4),
        row('MATH 2400H', 'Differential Calculus with Theory (Honors)', 4),
        row('MATH 2410H', 'Integral Calculus with Theory (Honors)', 4),
      ]),
    ]),
    major: [
      area('Required Courses', 32, [
        all('Required Courses', [
          row('AAEC 3580', 'Intermediate Economic Principles', 4),
          row('AAEC 4610', 'Applied Econometrics', 4),
          row('ENVM 3060', 'Principles of Resource Economics', 3),
          row('ENVM 3650', 'Environmental Economics', 3),
          row('ENVM 4380', 'Environmental Management and Sustainable Business Practices', 3),
          row('JURI 4810', 'Natural Resources Law', 3),
        ]),
        hoursFromLists('Environmental Studies', 12, {
          'Social Sciences': [
            row('ADPR 3850', 'Public Relations', 3),
            row('ANTH 3090', 'Past Peoples, Present Climates', 3),
            row('ANTH 3150E', 'Water Worlds', 3),
            row('ANTH 4075', 'Economic Anthropology', 3),
            row('CMLT 3210', 'Ecocriticism', 3),
            row('CRSS 4020S', 'Social Sustainability in Agricultural and Food Systems', 3),
            row('EDES 4650', 'City Planning', 3),
            row('EETH 5870', 'Environmental Dispute Resolution', 2),
            row('EHSC 4400', 'Environmental Issues in the Developing World', 3),
            row('FANR 3300', 'Economics of Renewable Resources', 2),
            row('FANR 3400', 'Society and Natural Resources', 2),
            row('FANR 4020', 'Sustainable Development', 3),
            row('GEOG 3620', 'Globalization and the Making of the Modern World', 3),
            row('GEOG 4620', 'Advanced Economic Geography', 3),
            row('HIST 3725', 'Environmental History of the Modern World', 3),
            row('PHIL 4220', 'Environmental Ethics', 3),
            row('PRTM 3310', 'Humans, Nature, and Environmental Awareness', 3),
            row('PRTM 4400', 'Park Management', 3),
            row('PRTM 5410', 'Stewardship and Protection of Natural Resources', 3),
            row('PRTM 5800S', 'Environmental Interpretation', 3),
            row('PRTM 5900', 'Ecotourism and Sustainable Development', 3),
          ],
          'Natural Sciences': [
            row('ATSC 3110', 'Climatology', 3),
            row('CRSS 3060', 'Soils and Hydrology', 3),
            lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
            row('ECOL 3500', 'Ecology', 3),
            lab('ECOL 3500L', 'Ecology Laboratory', 1),
            row('EHSC 3060', 'Foundations in Environmental Health', 3),
            row('GEOG 3180', 'Global Climate Change: Causes and Consequences', 3),
            row('GEOG 4330', 'Aerial Photographs and Image Interpretation', 3),
            row('GEOG 4370', 'Geographic Information Science', 3),
            row('GEOG 4810', 'Political Ecology and Environmental Governance', 3),
            row('HORT 4030S', 'Sustainable Community Food Production', 4),
            row('WASR 4700L', 'Hydrology, Geology, and Soils of Georgia', 3),
            row('WILD 3000W', 'Introduction to Fish and Wildlife Management', 2),
          ],
          Policy: [
            row('ANTH 4846', 'Environmental Governance', 3),
            row('FANR 4800W', 'Renewable Resources Policy', 2),
            row('PADP 3000', 'Public Administration: How Government Works', 3),
            row('PADP 3100', 'Introduction to Policy Analysis', 3),
            row('PADP 4630', 'Money and Power: Public Budgets', 3),
            row('PADP 4640', 'Mission and Meaning: The Nonprofit Sector in Action', 3),
            row('PADP 4650', 'Policymaking in Action', 3),
            row('PADP 4660', 'The Power of Evidence: Evaluating Public Programs', 3),
            row('PADP 4690', 'Administrative Law and the Regulatory State', 3),
          ],
          Methods: [
            row('AAEC 3690', 'Agribusiness Finance', 4),
            row('CVLE 4660', 'Sustainable Building Design', 3),
            row('FANR 3000', 'Field Orientation, Measurements, and Sampling in Forestry and Natural Resources', 2),
            row('FANR 3000L', 'Field Orientation, Measurements, and Sampling in Forestry and Natural Resources Laboratory', 2),
            row('FANR 3800', 'Spatial Analysis of Natural Resources', 2),
            row('FHCE 4000S', 'Consumer Analytics: Evidence-Based Strategy', 3),
            row('GEOG 4370', 'Geographic Information Science', 3),
            row('GEOG 4385', 'Community GIS (Service Learning)', 3),
            row('GEOG 4570', 'Advanced Geographic Information Science', 3),
            row('GEOG 4571', 'Geographic Information Systems for Health and the Environment', 3),
            row('MIST 4550', 'Energy Informatics', 3),
            row('SUST 4200', 'Interdisciplinary Sustainability Seminar', 1),
          ],
        }, 'Choose 12 hours, in any combination of courses from Social Sciences, Natural Sciences, Policy or Methods.'),
      ]),
      area('Major Electives', 15, [
        {
          ...hoursFrom('Major Electives', 15, [
            row('AAEC 3300S', 'Outreach and Service-Learning in Applied Economics', 3),
            row('AAEC 3600', 'Economics of Food Policy', 3),
            row('AAEC 3910', 'Internships', 3),
            row('AAEC 3911', 'International Agribusiness and Environmental Management', 3),
            row('AAEC 3990', 'Special Topics in Agricultural and Applied Economics', 3),
            row('AAEC 4510', 'Land Economics', 3),
            row('AAEC 4710', 'Rural Economic Development and Growth', 3),
            row('AAEC 4720', 'Applied International Development Economics', 3),
            row('AAEC 4730', 'The World Food Economy', 3),
            row('AAEC 4970R', 'Faculty-Mentored Undergraduate Research II', 3),
            row('ENVM 4150', 'Energy Economics', 3),
            row('ENVM 4660', 'Environmental Valuation: Methods and Applications', 3),
            row('ENVM 4800', 'Water Resource Economics and Management', 3),
            row('ENVM 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
            row('SUST 4500S', 'Interdisciplinary Sustainability Capstone', 3),
          ], 'Choose 15 hours; at least 3 of the courses at the 4000 level or above.'),
          constraints: [{ text: 'At least 3 of the courses must be 4000-level or above.', n: 3, lists: [{ label: '4000-level or above', codes: ['AAEC 4510', 'AAEC 4710', 'AAEC 4720', 'AAEC 4730', 'AAEC 4970R', 'ENVM 4150', 'ENVM 4660', 'ENVM 4800', 'ENVM 4960R', 'SUST 4500S'] }], single: false }],
        },
      ]),
      // 13 hours, and Area VI's last 2.
      generalElectives(15),
    ],
  },
  /*
   * Art: Interdisciplinary Art AB (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/86044): Area VI is five foundations
   * courses and "Choose 2 course(s)" from ten studio groups; the reading
   * required all 22. Required Courses (48 hours): 24 hours of art at the
   * 3000 level or above, a required studio, 6 hours of art history and a
   * 15-hour interdisciplinary elective; the reading left 24 hours unnamed.
   */
  '86044': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('ARST 1040', 'Proseminar in Studio Art', 1),
        row('ARST 1050', 'Drawing I: Observation and Visual Language', 3),
        row('ARST 1060', 'Color/Composition', 3),
        row('ARST 1080', 'Three-Dimensional Design', 3),
        row('ARST 2020', 'Ideation and Methodologies', 3),
      ]),
      choose('Two studio courses', 2, [
        row('ARST 2000', 'Introduction to Figure Drawing', 3),
        row('ARST 2010', 'Drawing and Visuality', 3),
        row('ARST 2100', 'Introduction to Painting and Visuality', 3),
        row('ARST 2110', 'Intermediate Painting', 3),
        row('ARST 2210', 'Introduction to Photography and Image Culture', 3),
        row('ARST 2810', 'Hypermedia', 3),
        row('ARST 2350', 'Introduction to Printmaking', 3),
        row('ARST 2400', 'Fundamentals of Sculpture', 3),
        row('ARST 2500', 'Introduction to Ceramics', 3),
        row('ARST 2550', 'Ceramics - Introductory Pottery', 3),
        row('ARST 2600', 'Jewelry and Metals: Design and Construction', 3),
        row('ARST 2700', 'Textile Foundations', 3),
        row('ARST 2710', 'Surface Design', 3),
        row('ARGD 2010', 'Graphic Design Survey', 3),
        row('ARGD 2030', 'Introduction to Typography in Visual Communication', 3),
        row('ARID 2110', 'Studio I: Single Family Residential Design', 3),
        row('ARID 2210', 'Concepts in Design', 3),
        row('ARST 2800', 'Introduction to Digital Imaging', 3),
      ], 'From Drawing and Painting, Photography and Expanded Media, Printmaking, Sculpture and Technology, Ceramics, Jewelry/Metalwork, Fabric Design, Graphic Design, Interior Design or Scientific Illustration (ARST 2205 with its lab may replace ARST 2210; only one counts).'),
    ]),
    major: [
      area('Required Courses', 48, [
        hoursFrom('Studio and design courses', 24, ['ARGD', 'ARHI', 'ARID', 'ARST', 'ARTS'].flatMap((subject) => levels(subject, 3)), 'ARGD, ARHI, ARID, ARST or ARTS courses at the 3000 level or above. A grade of C or better in major courses.'),
        choose('Required Studio', 1, [
          row('ARST 4915', 'Thematic Inquiry in Contemporary Art', 3),
          row('ARST 4920', 'IDEA Seminar: Innovation, Design, Entrepreneurship, and Art', 3),
          row('ARTS 4100', 'Art and Design in the City Intensive Field Study', 3),
        ]),
        hoursFrom('Art History', 6, [
          ...levels('ARHI', 3),
          row('ARGD 3070', 'The History of Graphic Design', 3),
          row('ARID 3210', 'Design History I', 3),
          row('ARID 3220', 'Design History II', 3),
        ]),
        hoursFrom('Interdisciplinary Elective: 3000-level or above', 9, [ANY_UPPER_COURSE], 'A certificate, minor or additional degree in a field outside the School of Art, or 15 hours of general electives, at least 9 of them at the 3000 level or above.'),
        hoursFrom('Interdisciplinary Elective', 6, [ANY_COURSE]),
      ]),
      generalElectives(12),
    ],
  },
  /*
   * Art History AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/66399):
   * Required Courses (30 hours of ARHI) are two or three 3000-level courses
   * in each period (Antiquity to 1700, 1700 to Contemporary: five in all),
   * the senior exit course and two 4000-level courses in each period; the
   * reading required all eleven Antiquity courses and made the other period
   * a 1-hour pool. Major Electives: two literature courses and 12 hours from
   * the page's subjects.
   */
  '66399': {
    major: [
      area('Required Courses', 30, [
        choose('3000-level Art History Antiquity to 1700', 2, [
          row('ARHI 3001', 'Ancient Art and Architecture', 3),
          row('ARHI 3002', 'Greek Art and Architecture', 3),
          row('ARHI 3004', 'Roman Art and Architecture', 3),
          row('ARHI 3008', 'Late Antique Art and Architecture, 3rd to 7th c. CE', 3),
          row('ARHI 3010', 'Medieval Art and Architecture', 3),
          row('ARHI 3020', 'Renaissance Art', 3),
          row('ARHI 3022', 'Art and Architecture of Byzantium - The Empire of the New Rome', 3),
          row('ARHI 3030', 'Baroque Art', 3),
          row('ARHI 3032', 'Art and Architecture of Russia', 3),
          row('ARHI 3090', 'Topics in Art History', 3),
          row('ARHI 3100', 'Asian Art and Architecture', 3),
        ], 'ARHI 3090 counts here when its topic is in this period. A grade of C or better in every ARHI course.'),
        choose('3000-level Art History 1700 to Contemporary', 2, [
          row('ARHI 3032', 'Art and Architecture of Russia', 3),
          row('ARHI 3041', 'Introduction to African American Art', 3),
          row('ARHI 3050', 'American Art', 3),
          row('ARHI 3054', 'Eighteenth-Century European Art', 3),
          row('ARHI 3056', 'Nineteenth-Century European Art', 3),
          row('ARHI 3065', 'Modern Art', 3),
          row('ARHI 3077', 'Latin American Modern Art', 3),
          row('ARHI 3080', 'Introduction to Contemporary Art', 3),
          row('ARHI 3300', 'History and Theory of Modern Design', 3),
          row('ARHI 3530', 'Modernist Photography', 3),
          row('ARHI 3940', 'Gender and Feminism and Art History', 3),
          row('HIST 3165', 'History of Art and Activism in the United States', 3),
        ], 'ARHI 3090 counts here when its topic is in this period.'),
        hoursFrom('One more 3000-level Art History course', 3, [
          row('ARHI 3001', 'Ancient Art and Architecture', 3),
          row('ARHI 3002', 'Greek Art and Architecture', 3),
          row('ARHI 3004', 'Roman Art and Architecture', 3),
          row('ARHI 3008', 'Late Antique Art and Architecture, 3rd to 7th c. CE', 3),
          row('ARHI 3010', 'Medieval Art and Architecture', 3),
          row('ARHI 3020', 'Renaissance Art', 3),
          row('ARHI 3022', 'Art and Architecture of Byzantium - The Empire of the New Rome', 3),
          row('ARHI 3030', 'Baroque Art', 3),
          row('ARHI 3032', 'Art and Architecture of Russia', 3),
          row('ARHI 3090', 'Topics in Art History', 3),
          row('ARHI 3100', 'Asian Art and Architecture', 3),
          row('ARHI 3032', 'Art and Architecture of Russia', 3),
          row('ARHI 3041', 'Introduction to African American Art', 3),
          row('ARHI 3050', 'American Art', 3),
          row('ARHI 3054', 'Eighteenth-Century European Art', 3),
          row('ARHI 3056', 'Nineteenth-Century European Art', 3),
          row('ARHI 3065', 'Modern Art', 3),
          row('ARHI 3077', 'Latin American Modern Art', 3),
          row('ARHI 3080', 'Introduction to Contemporary Art', 3),
          row('ARHI 3300', 'History and Theory of Modern Design', 3),
          row('ARHI 3530', 'Modernist Photography', 3),
          row('ARHI 3940', 'Gender and Feminism and Art History', 3),
          row('HIST 3165', 'History of Art and Activism in the United States', 3),
        ], 'Two or three 3000-level courses in each period: five in all.'),
        choose('Senior Exit Requirement', 1, [
          row('ARHI 4800', 'Senior Seminar: Methods of Art History', 3),
          row('ARHI 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
        ], 'Ideally in the last or second to last term.'),
        choose('4000-level Art History Antiquity to 1700', 2, [
          row('ARHI 4000', 'Hellenistic Greek Art', 3),
          row('ARHI 4002', 'Greek and Roman Painting', 3),
          row('ARHI 4004', 'The Roman Villa', 3),
          row('ARHI 4006', 'Color in Ancient Art', 3),
          row('ARHI 4008', 'Ancient Roman Sculpture', 3),
          row('ARHI 4050', 'Icons in Byzantium: Theory and Practice', 3),
          row('ARHI 4060', 'Image in Space: Mural Painting and Architecture in Byzantium', 3),
          row('ARHI 4100', 'Early Medieval Art', 3),
          row('ARHI 4110', 'Art and Architecture in the Eleventh and Twelfth Centuries', 3),
          row('ARHI 4120', 'Gothic Art and Architecture', 3),
          row('ARHI 4130', 'Late Gothic Art in Italy', 3),
          row('ARHI 4200', 'Early Renaissance in Italy', 3),
          row('ARHI 4210', 'High Renaissance and Mannerism in Italy', 3),
          row('ARHI 4220', 'Early Modern Prints and the Global World', 3),
          row('ARHI 4290', 'Renaissance and Baroque Sculpture', 3),
          row('ARHI 4300', 'Italian Baroque Art and Architecture', 3),
          row('ARHI 4310', 'Northern Baroque Art', 3),
          row('ARHI 4350', 'Art and Architecture of the City of Rome', 3),
          row('ARHI 4750', 'Topics in Museum Objects, Collections, Exhibitions', 3),
          row('ARHI 4800', 'Senior Seminar: Methods of Art History', 3),
          row('ARHI 4900', 'Topics in Ancient and Medieval Art', 3),
          row('ARHI 4910', 'Topics in Early Modern Art', 3),
          row('ARHI 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('RELI 4308', 'Islamic Calligraphic Art and the Vision of Islam', 3),
        ]),
        choose('4000-level Art History 1700 to Contemporary', 2, [
          row('ARHI 4400', 'The Natural History of Art', 3),
          row('ARHI 4410', 'American Art from Colonial Settlement through the Civil War', 3),
          row('ARHI 4420', 'American Art of the Fin de Sie`cle 1876-1913', 3),
          row('ARHI 4430', 'Shaping Material Culture: Sculpture in the 18th and 19th Centuries', 3),
          row('ARHI 4440', "American Modernism 1900-1946: Alfred Stieglitz's America", 3),
          row('ARHI 4490', 'Rococo and Co.', 3),
          row('ARHI 4500', 'Realism and Impressionism', 3),
          row('ARHI 4510', 'Modern Art in Europe from 1886 to 1918', 3),
          row('ARHI 4520', 'Interdisciplinary Modernisms', 3),
          row('ARHI 4530', 'Nineteenth-Century Photography', 3),
          row('ARHI 4540', 'European Art Between the Great Wars', 3),
          row('ARHI 4550', 'Art From 1940 to 1968', 3),
          row('ARHI 4570', 'Modern Art in the Realm of Dance', 3),
          row('ARHI 4575', "Artists' Writing", 3),
          row('ARHI 4580', 'Postmodern Visual Culture', 3),
          row('ARHI 4585', 'Art After Postmodernism: Art and Visual Culture from 1985-Present', 3),
          row('ARHI 4590', 'Millennial Culture and the Inhuman: Art and Culture in the Year 2000', 3),
          row('ARHI 4916', 'Topics in 18th- and 19th-Century Art', 3),
          row('ARHI 4920', 'Topics in Modern Art', 3),
          row('ARHI 4940', 'Gender Issues and Art History', 3),
          row('HIST 4022', 'Picturing America', 3),
          row('HIST 4027', 'American Museums, Parks, and Monuments', 3),
          row('HIST 4032', 'Black Skin, White Walls: African Americans and the Museum', 3),
        ], 'Plan no more than three ARHI courses, or two 4000-level ARHI courses, in a semester.'),
      ]),
      area('Major Electives', 18, [
        choose('Literature', 2, [
          row('ARAB 4100', 'Reading and Research in Arabic and Islamic Literature', 3),
          row('CLAS 1000', 'Greek Culture', 3),
          row('CLAS 1010', 'Roman Culture', 3),
          row('CLAS 1020', 'Classical Mythology', 3),
          row('CLAS 4260', 'Literature of the Classical Tradition', 3),
          row('FILM 5900', 'Film Theory', 3),
          row('FREN 3030', 'Texts and Contexts', 3),
          row('FREN 3040', 'Graphic Novel and Visual Culture', 3),
          row('FREN 4050', 'From Chivalry to Enlightenment', 3),
          row('FREN 4060', 'Revolutions, Romanticism, and Reinvention', 3),
          row('FREN 4070', 'World Literature in French', 3),
          row('FREN 4080', 'Studies in French Literature and Culture', 3),
          row('FREN 4170', 'Francophone Literature, Film, and Culture', 3),
          row('GRMN 3120', 'German Courtly Literature', 3),
          row('GRMN 3410', 'Revolution, Revolt, and Nationlism in the Nineteenth Century', 3),
          row('GRMN 3420', 'The German Romantic Age', 3),
          row('GRMN 3610', 'Discourses of Post-War Literature', 3),
          row('GRMN 3620H', 'The Wild Berlin of Bertolt Brecht (Honors)', 3),
          row('GRMN 3625', 'Post-War Women Writers', 3),
          row('GRMN 3630', 'Memory, History, Narrative', 3),
          row('GRMN 3710', 'The Wall', 3),
          row('GRMN 3830', "Children's and Youth Literature", 3),
          row('GRMN 3850', "Introduction to Goethe's Life and Works", 3),
          row('GRMN 3870', 'The German Fairy Tale Tradition', 3),
          row('GRMN 4015', 'Magic, Monsters, and the Occult in German Literature', 3),
          row('GRMN 4310', 'Germany and the French Revolution', 3),
          row('GRMN 4410', 'The Holocaust in German Literature and Film', 3),
          row('GRMN 4500', '20th- and 21st-Century Texts and Contexts', 3),
          row('GRMN 4610H', 'Elective Affinities: Literature and Philosophy in Dialogue (Honors)', 3),
          row('GRMN 4710', 'Vienna: Literature, Art, Music, Culture', 3),
          row('ITAL 3030', 'Introduction to Italian Literature and Culture', 3),
          row('ITAL 4030', 'Topics in the Literature and Culture of Italy', 3),
          row('ITAL 4050', 'Italian Literature and Culture from its Origins to 1400', 3),
          row('ITAL 4060', 'Italian Literature and Culture from 1400 to 1700', 3),
          row('ITAL 4070', 'Italian Literature and Culture from 1700 to the Present', 3),
          row('ITAL 4120', 'Topics in Italian Culture, Language, and Literature', 3),
          row('KREN 4011', 'Modern Korean Fiction', 3),
          row('LATN 2002', 'Intermediate Latin II: Golden Age Latin Literature', 3),
          row('RELI 4001', 'Old Testament/Hebrew Bible Literature', 3),
          row('RELI 4004', 'Psalms, Job, and Other Writings of the Hebrew Bible/Old Testament', 3),
          row('RELI 4006', 'Women and the Old Testament/Hebrew Bible', 3),
          row('RELI 4010', 'Modern Hebrew Literature', 3),
          row('RELI 4040', 'Apocalyptic Literature', 3),
          row('RELI 4080', 'New Testament Literature', 3),
          row('RELI 4106', 'Women in Early Christian Literature', 3),
          row('RUSS 3160', 'Madness, Desire, and Death in 19th-Century Russian Culture and Literature', 3),
          row('RUSS 3400', 'The Stuff of the Soul: Dostoevsky’s Prose and its Aesthetic and Ethical Influence', 3),
          row('RUSS 3500', 'The Russian Novel: Masterpieces of Russian Literature in the Age of Realism', 3),
          row('RUSS 4080', 'Nabokov', 3),
          row('RUSS 4090', 'Russia through the Eyes of Tolstoy and Dostoevsky', 3),
          row('RUSS 4250', 'Pushkin', 3),
          row('RUSS 4260', 'Masterpieces of Nineteenth-Century Russian Literature', 3),
          row('RUSS 4270', 'Masterpieces of Twentieth-Century Russian Literature', 3),
          row('RUSS 4280', 'Chekhov', 3),
          row('RUSS 4290', 'Politically Incorrect: Contemporary Russian Literature, Art, and Cinema', 3),
          row('SPAN 3030', 'Texts in Global Contexts', 3),
          row('SPAN 4040', 'Literary Adventures from Spain', 3),
          row('SPAN 4050', 'Exploring Modern Spain', 3),
          row('SPAN 4060', 'Cultures in Contact After 1492', 3),
          row('SPAN 4070', 'Latin American Voices of Change', 3),
          row('SPAN 4080', 'Discovering Cultural Formation', 3),
          row('SPAN 4120', 'Exploring Cultures in Spanish', 3),
          row('SLAV 3200', 'Literature and Moral Life: The Ethics of Fiction and Non-Fiction in East European Literature', 3),
          row('SLAV 3400', 'Kind of Human: Animals, Children, and Robots in Russian and East European Literature and Art', 3),
          row('WMST 3010', 'Critical Feminist Readings', 3),
        ], 'One literature course from the Franklin College list (if not already satisfied in the core) and a second from this list, or one the Art History area chair approves.'),
        hoursFrom('Additional major courses', 12, [
          ...['AFAM', 'ANTH', 'ARAB', 'ARHI', 'ARST', 'ARTS', 'ASTR', 'BCMB', 'BIOL', 'CBIO', 'CHEM', 'CHNS', 'CLAS', 'CMLT', 'COMM', 'CSCI', 'ECOL', 'ECON', 'EDES', 'ENGL', 'FREN', 'GENE', 'GEOG', 'GEOL', 'GREK', 'GRMN', 'HEBR', 'HIPR', 'HIST', 'ITAL', 'JPNS', 'KREN', 'LATN', 'LING', 'MARS', 'MATH', 'MIBO', 'PBIO', 'PHIL', 'PHYS', 'POLS', 'PORT', 'PSYC', 'RELI', 'ROML', 'RUSS', 'SEMI', 'SPAN', 'SOCI', 'STAT', 'SWAH', 'WMST', 'YORB'].flatMap((subject) => levels(subject, 1, 4)),
          row('LAND 2330', 'Place, Society, and Design', 3),
          row('LAND 2510', 'History of the Built Environment I: Landscape', 3),
          row('LAND 2520', 'History of the Built Environment II: Architecture', 3),
          row('LAND 4400', 'Plant Communities of the Southeast', 3),
          row('LAND 4580', 'Landscapes in Literature, the Arts, and Popular Culture', 3),
          row('ARHI 4990R', 'Undergraduate Research Thesis (or Final Project)', 3),
          row('ARHI 4995', 'Art History Museum Internship', 3),
        ], 'Courses with these subjects or the LAND courses listed; at most 3 more ARHI hours and 6 ARST hours (ARST 1050, 1060, 1080, 2200 and 4170 recommended). ARHI 4990R and ARHI 4995 (museum internship) with the area chair\'s approval.'),
      ]),
      generalElectives(12, 9),
    ],
  },
};

/**
 * Smaller repairs, where the reading is right but for a row or two: matched
 * by the rows' Bulletin labels, so they do nothing once a later reading
 * reads those rows another way.
 */
const REPAIRED: Record<string, (areas: UgaRequirementArea[]) => UgaRequirementArea[]> = {
  /*
   * Regenerative Bioscience BS (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/77774): the Laboratory requirement is
   * "EITHER Group A OR Group B", 3 to 4 hours of research or of one
   * laboratory course; the reading asked for 4 hours of Group A and all
   * eleven Group B labs (38 hours).
   */
  '77774': (areas) => areas.map((existing) => {
    const a = existing.groups.find((group) => group.label.trim() === 'Group A');
    const b = existing.groups.find((group) => group.label.trim() === 'Group B');
    if (!a || !b) return existing;
    const laboratory: UgaRequirementGroup = {
      label: 'Laboratory', choose: null, hours: 3, completeOneList: true,
      note: 'EITHER Group A (faculty-mentored research) OR Group B (a laboratory course): 3 to 4 hours from one group.',
      lists: [{ label: 'Group A', codes: a.courses.map((course) => course.code) }, { label: 'Group B', codes: b.courses.map((course) => course.code) }],
      courses: [...a.courses, ...b.courses],
    };
    return { ...existing, groups: existing.groups.flatMap((group) => (group === a ? [laboratory] : group === b ? [] : [group])) };
  }),
};

const CORE_AREA = /^(?:I|II|III|IV|V)\.\s/;
const AREA_SIX = /^VI\.\s/;

/**
 * Area I as the pages print it: ENGL 1101 and ENGL 1102, then "Choose
 * course(s) from the following" (no number) and the mathematics courses.
 * Read as one list of 9 hours, four degrees' boards (71747, 75605, 86044,
 * 99676) took MATH 1101, MATH 1113 and STAT 2000 and no English
 * composition (2026-10-29). Nothing changes where the list was read apart.
 */
function foundationRead(areas: UgaRequirementArea[]): UgaRequirementArea[] {
  return areas.map((existing) => {
    if (!/^I\.\s/.test(existing.label)) return existing;
    return { ...existing, groups: existing.groups.flatMap((group) => {
      const codes = group.courses.map((course) => course.code);
      if (group.choose !== null || group.hours != null || !codes.includes('ENGL 1101') || !codes.includes('ENGL 1102') || !codes.some((code) => /^(?:MATH|STAT) /.test(code))) return [group];
      const english = group.courses.filter((course) => /^ENGL 110[12]$/.test(course.code));
      return [{ ...group, courses: english }, { label: '', choose: 1, courses: group.courses.filter((course) => !english.includes(course)) }];
    }) };
  });
}

/** `program` with its written areas, or its repaired rows, where this file has them (`overlap`: an area courses counted elsewhere meet). */
export function fixedUgaDegree<T extends UgaProgramRecord>(program: T, overlap: (label: string) => boolean): T {
  const written = WRITTEN[program.id];
  const repair = REPAIRED[program.id];
  const areas = foundationRead(program.areas as UgaRequirementArea[]);
  if (!written) return { ...program, areas: repair ? repair(areas) : areas };
  const core = areas.filter((existing) => CORE_AREA.test(existing.label));
  const six = written.areaSix ?? areas.find((existing) => AREA_SIX.test(existing.label));
  const kept = areas.filter((existing) => overlap(existing.label));
  const next = [...core, ...(six ? [six] : []), ...written.major, ...kept];
  const hours = next.filter((existing) => !overlap(existing.label)).reduce((sum, existing) => sum + existing.hours, 0);
  return { ...program, areas: next, areaHours: hours, totalCredits: written.total ?? program.totalCredits, emphasisGroups: [] } as T;
}
