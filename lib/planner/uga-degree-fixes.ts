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

const area = (label: string, hours: number, groups: UgaRequirementGroup[]): UgaRequirementArea => ({ label, hours, groups });

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
};

const CORE_AREA = /^(?:I|II|III|IV|V)\.\s/;
const AREA_SIX = /^VI\.\s/;

/** `program` with its written areas, where this file writes the degree (`overlap`: an area courses counted elsewhere meet). */
export function writtenUgaDegree<T extends UgaProgramRecord>(program: T, overlap: (label: string) => boolean): T {
  const written = WRITTEN[program.id];
  if (!written) return program;
  const areas = program.areas as UgaRequirementArea[];
  const core = areas.filter((existing) => CORE_AREA.test(existing.label));
  const six = written.areaSix ?? areas.find((existing) => AREA_SIX.test(existing.label));
  const kept = areas.filter((existing) => overlap(existing.label));
  const next = [...core, ...(six ? [six] : []), ...written.major, ...kept];
  const hours = next.filter((existing) => !overlap(existing.label)).reduce((sum, existing) => sum + existing.hours, 0);
  return { ...program, areas: next, areaHours: hours, totalCredits: written.total ?? program.totalCredits, emphasisGroups: [] } as T;
}
