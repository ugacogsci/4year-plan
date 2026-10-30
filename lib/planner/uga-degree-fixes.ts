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
 *
 * Where the course catalog the planner reads numbers a Bulletin course
 * another way (EDSE 5020E, ESOC 4450L, MUSI 4500S, MUSI 5450, ENVM 4650 for
 * the Bulletin's ENVM 3650), a row uses the catalog's number: a course the
 * catalog does not have cannot be booked, and its row could never be met.
 */

/**
 * Degrees the degree picker leaves out for now, each a program id: a degree
 * whose plan is still not one an advisor would give. Empty: the owner
 * decides which degrees wait (keep-planner/sched-fix/coming-soon-proposal.md
 * lists the ones still not right). A saved plan of one still loads.
 */
export const UGA_COMING_SOON: ReadonlySet<string> = new Set<string>([]);

/** The line under the degree picker naming the degrees left out (none: no line). */
export function ugaComingSoonNote(names: string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `Coming soon: ${list}. ${names.length > 1 ? 'Their plans are' : 'Its plan is'} still being checked against the UGA Bulletin.`;
}

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
  bundleSize?: number;
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
/**
 * One of the course groups listed ("Choose 1 group(s)"), each a course and
 * its lab. Where every group has two courses, both come from the one group
 * (bundleSize): with one, a board took CHEM 2100 and CHEM 2211 for "organic
 * chemistry with its lab" and no lab.
 */
const oneGroup = (label: string, hours: number, groups: UgaRequirementCourse[][], note = 'Choose one complete course group.', bundleSize = Math.min(...groups.map((courses) => courses.length))): UgaRequirementGroup => ({
  label, choose: null, hours, note, completeOneList: true, ...(bundleSize > 1 ? { bundleSize } : {}),
  lists: groups.map((courses) => ({ label: courses.map((course) => course.code).join(' and '), codes: courses.map((course) => course.code) })),
  courses: groups.flat(),
});

/** `hours` from named lists in any combination ("any combination of courses from Social Sciences, ..."), a course once. */
const hoursFromLists = (label: string, hours: number, lists: Record<string, UgaRequirementCourse[]>, note: string): UgaRequirementGroup => ({
  label, choose: null, hours, note,
  lists: Object.entries(lists).map(([name, courses]) => ({ label: name, codes: courses.map((course) => course.code) })),
  courses: [...new Map(Object.values(lists).flat().map((course) => [course.code, course])).values()],
});

/** `group` with at least `n` of its picks from its list named `list` ("one course from List A"). */
const fromLists = (group: UgaRequirementGroup, n: number, text: string, list: string): UgaRequirementGroup => ({
  ...group,
  constraints: [...(group.constraints ?? []), { text, n, lists: (group.lists ?? []).filter((each) => each.label === list), single: false }],
});

/** `group` with at least one of its design courses among its picks ("at least one design course, indicated by an asterisk"). */
const withDesign = (group: UgaRequirementGroup, design: string[]): UgaRequirementGroup => {
  const lists = [{ label: 'Design courses', codes: design }];
  return { ...group, lists, constraints: [{ text: 'At least one design course (3 hours).', n: 1, lists, single: false }] };
};

/** `group` with `n` of its picks from one of its lists ("courses must all be selected from the same discipline"). */
const fromOneList = (group: UgaRequirementGroup, n: number, text: string): UgaRequirementGroup => ({
  ...group,
  constraints: [{ text, n, lists: group.lists ?? [], single: true }],
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

/** The third semester course of the languages most students bring from high school (as uga-program-overrides.ts THIRD_SEMESTER_LANGUAGE). */
const THIRD_SEMESTER_COURSES: UgaRequirementCourse[] = ['SPAN 2001', 'FREN 2001', 'GRMN 2001', 'ITAL 2001', 'LATN 2001', 'CHNS 2001', 'JPNS 2001', 'PORT 2001', 'RUSS 2001', 'ARAB 2003']
  .map((code) => ({ code, title: `${code.split(' ')[0]} third semester`, credits: 3 }));

const ANY_COURSE: UgaRequirementCourse = { code: 'ANY 1XXX', title: 'Any undergraduate course', credits: 0 };
const ANY_UPPER_COURSE: UgaRequirementCourse = { code: 'ANY 3XXX', title: 'Any upper-level course (3000-5999)', credits: 0 };

const area = (label: string, hours: number, groups: UgaRequirementGroup[]): UgaRequirementArea => ({ label, hours, groups });

/** "General Electives (N hours)", `upper` of them numbered 3000 or above. */
const generalElectives = (hours: number, upper = 0): UgaRequirementArea =>
  area('General Electives', hours, upper > 0 ? [hoursFrom('Upper-division general electives', upper, [ANY_UPPER_COURSE], `${upper} of the general elective hours numbered 3000 or above.`)] : []);

/** The label of one emphasis's rows inside an area of emphasis (uga-source.tsx namedChoiceFromLabel). */
const focus = (n: number, name: string, rows?: string) => `Focus Area ${n}: ${name}${rows ? `: ${rows}` : ''}`;

type WrittenDegree = {
  /** Area VI as the page prints it, where the reading lost or mangled it (null: the degree's paths each carry their own, in the major). */
  areaSix?: UgaRequirementArea | null;
  /** A core area (Areas I to V) as the page prints it, where the reading mangled it: in place of the read area of the same label. */
  core?: UgaRequirementArea[];
  /** Core areas the reading lost, by label: the campus's own list for each (ugaCampusCore), as every other degree's page prints it. */
  campusCore?: string[];
  /** Every area after the core: the major, its electives. */
  major: UgaRequirementArea[];
  /** The page's "Total Major Hours", where the reading lost it. */
  total?: number;
};

/** Film AB's Area VI list (bulletin.uga.edu/Program/Details/29901): its film production courses, and subjects at the 1000 to 3000 level (THEA 1000 or 2000). */
const FILM_AREA_SIX: UgaRequirementCourse[] = [
  row('FILM 2000', 'Introduction to On-Set Film Production', 6),
  row('FILM 2130', 'American Directors of Color', 3),
  row('FILM 2510', 'Set Construction and Scenic Painting', 6),
  row('FILM 2520', 'Electric and Lighting', 6),
  row('FILM 2530', 'Grip and Rigging', 6),
  row('FILM 2550', 'Introduction to Special Effects Makeup', 6),
  ...['ARHI', 'ARST', 'CLAS', 'CMLT', 'COMM', 'DANC', 'EMST', 'ENGL', 'HIST', 'JOUR', 'MUSI', 'NMIX', 'PHIL', 'PSYC', 'WMST'].flatMap((subject) => levels(subject, 1, 3)),
  ...levels('THEA', 1, 2),
];

/** Social Studies Education's Content Pedagogy courses (bulletin.uga.edu/Program/Details/79831), which count as emphasis courses. */
const SOCIAL_STUDIES_PEDAGOGY: UgaRequirementCourse[] = [
  row('ESOC 5010', 'Teaching Geography', 3),
  row('ESOC 5020', 'Teaching History', 3),
  row('ESOC 5030', 'Teaching Economics', 3),
  row('ESOC 5040', 'Teaching Politics, Government, and Citizenship', 3),
  row('ESOC 5060', 'Teaching World History', 3),
  row('ESOC 5070', 'Critical Race Theory in Social Studies Education', 3),
];

/** The CAES major electives' prefixes, at the 3000 level and above (Environmental Resource Science, 27349, and Agriscience, 47617). */
const CAES_ELECTIVE_SUBJECTS: UgaRequirementCourse[] = ['AAEC', 'ADSC', 'AENG', 'AESC', 'AEXT', 'AGCM', 'ALDR', 'ANNU', 'ANTH', 'BCMB', 'BINF', 'BIOL', 'BIOS', 'BTEC', 'CBIO', 'CHEM', 'CRSS', 'ECOL', 'EDES', 'EETH', 'EHSC', 'ENGR', 'ENTO', 'ENVM', 'FANR', 'FDST', 'FORS', 'GENE', 'GEOG', 'GEOL', 'HONS', 'HORT', 'LAND', 'MARS', 'MIBO', 'NUTR', 'PATH', 'PBGG', 'PBIO', 'PHYS', 'PLAN', 'POUL', 'SOCI', 'SUST', 'WASR', 'WILD']
  .flatMap((subject) => levels(subject, 3));

/** Theatre AB's "Course should be 3 credit hours and numbered 3000 and above: FILM prefix courses, THEA prefix courses" (bulletin.uga.edu/Program/Details/93915). */
const THEATRE_ELECTIVE: UgaRequirementCourse[] = [...levels('THEA', 3), ...levels('FILM', 3)];

/**
 * A major the student designs with a faculty advisor and committee
 * (Franklin's Interdisciplinary Studies and its Honors versions): its rows
 * hold the page's rules, and the courses the board books for them are
 * placeholders until the program of study is approved.
 */
const DESIGNED = 'A course the student chooses with the faculty advisor and advisory committee; the planned course is a placeholder to change.';

/** FACS, FHCE, HDFS, NUTR and TXMI courses at the 3000 level and above (Social Entrepreneurship for Consumer Well-Being, 77137). */
const FAMILY_CONSUMER_UPPER: UgaRequirementCourse[] = ['FACS', 'FHCE', 'HDFS', 'NUTR', 'TXMI'].flatMap((subject) => levels(subject, 3));

/** Romance Languages AB's language courses (bulletin.uga.edu/Program/Details/58425), each language's upper-division list. */
const ROMANCE_LISTS = {
  French: [
    row('FREN 3030', 'Texts and Contexts', 3),
    row('FREN 3040', 'Graphic Novel and Visual Culture', 3),
    row('FREN 3080', 'Topics in French Cultural Studies', 3),
    row('FREN 3090', 'Introduction to French Linguistics', 3),
    row('FREN 3100', 'Business French', 3),
    row('FREN 3150', 'French for International Affairs', 3),
    row('FREN 4050', 'From Chivalry to Enlightenment', 3),
    row('FREN 4060', 'Revolutions, Romanticism, and Reinvention', 3),
    row('FREN 4070', 'World Literature in French', 3),
    row('FREN 4080', 'Studies in French Literature and Culture', 3),
    row('FREN 4120', 'Topics in French Culture, Language, and Literature', 3),
    row('FREN 4150', 'French for the Global Economy', 3),
    row('FREN 4170', 'Francophone Literature, Film, and Culture', 3),
    row('FREN 4180I', 'Topics in French Studies', 3),
    row('FREN 4185I', 'Franco-American Exchange and Mutual (Mis-)Understanding', 3),
    row('FREN 4190', 'Internship in French', 3),
    row('FREN 4300', 'Studies in Medieval Literature and Culture', 3),
    row('FREN 4350', 'Studies in the French Renaissance', 3),
    row('FREN 4600', 'Studies in French-Language Film and Media', 3),
    row('FREN 4630', 'French Phonetics', 3),
    row('FREN 4800', 'French Syntax and Meaning', 3),
  ],
  Spanish: [
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
  ],
  Italian: [
    row('ITAL 3010', 'Italian Conversation and Composition', 3),
    row('ITAL 3030', 'Introduction to Italian Literature and Culture', 3),
    row('ITAL 4010', 'Advanced Conversation and Composition', 3),
    row('ITAL 4030', 'Topics in the Literature and Culture of Italy', 3),
    row('ITAL 4040', 'Topics in Italian Cinema', 3),
    row('ITAL 4050', 'Italian Literature and Culture from its Origins to 1400', 3),
    row('ITAL 4060', 'Italian Literature and Culture from 1400 to 1700', 3),
    row('ITAL 4070', 'Italian Literature and Culture from 1700 to the Present', 3),
    row('ITAL 4090', 'Internship in Italy', 3),
    row('ITAL 4120', 'Topics in Italian Culture, Language, and Literature', 3),
    row('ITAL 4150', 'Italian for Professional Uses', 3),
  ],
  Portuguese: [
    row('PORT 4010', 'Advanced Language, Literature, and Culture of the Portuguese-Speaking World', 3),
    row('PORT 4030', 'Brazilian Popular Music and the Invention of Brazil', 3),
    row('PORT 4040', 'Topics in Cinema, Music, Culture, and Literature in the Portuguese-Speaking World', 3),
    row('PORT 4045', 'Brazilian Culture and Society', 3),
    row('PORT 4050', 'Prose of the Portuguese-Speaking World', 3),
    row('PORT 4060', 'Poetry of the Portuguese-Speaking World', 3),
    row('PORT 4070', 'Theater of the Portuguese-Speaking World', 3),
    row('PORT 4080', 'Studies in Culture and Literature of the Portuguese-Speaking World', 3),
    row('PORT 4150', 'Business Portuguese', 3),
    row('PORT 4550', 'History of the Portuguese Language', 3),
    row('PORT 4950', 'Directed Reading and/or Projects', 3),
  ],
};

type RomanceLanguage = keyof typeof ROMANCE_LISTS;

const ROMANCE_SUBJECTS: Record<RomanceLanguage, string> = { French: 'FREN', Spanish: 'SPAN', Italian: 'ITAL', Portuguese: 'PORT' };

/** A Romance Languages major language's 18 hours. */
function romanceMajor(n: number, name: string, language: RomanceLanguage): UgaRequirementGroup[] {
  const label = (rows?: string) => focus(n, name, rows ? `major language, ${rows}` : undefined);
  if (language === 'French') {
    return [
      all(label(), [row('FREN 3010', 'Culture and Communication I', 3), row('FREN 3020', 'Culture and Communication II', 3)], 'Major language: French (18 hours). A grade of C or better in every major course; at least 15 major hours in residence.'),
      choose(label('four FREN courses'), 4, ROMANCE_LISTS.French, 'FREN 3080 only once; FREN 3030 and FREN 3090 are prerequisites for many upper-level FREN courses. ROML 4092 or 4120 may replace one.'),
    ];
  }
  if (language === 'Spanish') {
    return [
      all(label(), [row('SPAN 3020', 'Writing Critically in Spanish', 3), row('SPAN 3030', 'Texts in Global Contexts', 3), row('SPAN 3050', 'Introduction to Spanish Linguistics', 3)], 'Major language: Spanish (18 hours). A grade of C or better in every major course; at least 15 major hours in residence.'),
      choose(label('cultural dialogues'), 1, [row('SPAN 3010', 'Spanish Cultural Dialogues', 3), row('SPAN 3011', 'Cultural Dialogues and Critical Reading and Writing for Spanish Heritage Speakers I', 3)]),
      hoursFrom(label('SPAN 4000-level courses'), 6, [...ROMANCE_LISTS.Spanish, row('ROML 3000', 'Introduction to Romance Linguistics', 3), row('ROML 4092', 'Archival and Special Collections Studies', 3)], '3 to 6 hours of SPAN courses, and up to 3 of ROML or AFAM 4860.'),
    ];
  }
  if (language === 'Italian') {
    return [choose(label(), 6, ROMANCE_LISTS.Italian, 'Major language: Italian (18 hours). A grade of C or better in every major course; at least 15 major hours in residence.')];
  }
  return [
    all(label(), [row('PORT 3010', 'Portuguese Conversation and Composition', 3), row('PORT 3030', 'Introduction to Language, Literature, and Culture of the Portuguese-Speaking World', 3)], 'Major language: Portuguese (18 hours). A grade of C or better in every major course; at least 15 major hours in residence.'),
    hoursFrom(label('PORT 4000-level courses'), 12, [...ROMANCE_LISTS.Portuguese, row('ROML 4092', 'Archival and Special Collections Studies', 3)], '9 to 12 hours of PORT courses (at most 9 of any one repeatable course), and up to 3 of PORT 4040, ROML or AFAM 4860.'),
  ];
}

/** A Romance Languages minor language's 12 hours. */
function romanceMinor(n: number, name: string, language: RomanceLanguage): UgaRequirementGroup[] {
  const label = (rows: string) => focus(n, name, `minor language, ${rows}`);
  if (language === 'French') return [all(label('French'), [row('FREN 3010', 'Culture and Communication I', 3), row('FREN 3020', 'Culture and Communication II', 3)]), choose(label('two FREN courses'), 2, ROMANCE_LISTS.French)];
  if (language === 'Spanish') return [all(label('Spanish'), [row('SPAN 3020', 'Writing Critically in Spanish', 3), row('SPAN 3030', 'Texts in Global Contexts', 3), row('SPAN 3050', 'Introduction to Spanish Linguistics', 3)]), choose(label('cultural dialogues'), 1, [row('SPAN 3010', 'Spanish Cultural Dialogues', 3), row('SPAN 3011', 'Cultural Dialogues and Critical Reading and Writing for Spanish Heritage Speakers I', 3)])];
  if (language === 'Italian') return [choose(label('Italian'), 4, ROMANCE_LISTS.Italian)];
  return [all(label('Portuguese'), [row('PORT 3010', 'Portuguese Conversation and Composition', 3), row('PORT 3030', 'Introduction to Language, Literature, and Culture of the Portuguese-Speaking World', 3)]), choose(label('two PORT courses'), 2, ROMANCE_LISTS.Portuguese)];
}

const ROMANCE_AREA_SIX_SUBJECTS = ['AFAM', 'AFST', 'AMHA', 'ANTH', 'ARAB', 'ARGD', 'ARHI', 'ARID', 'ARST', 'ARTS', 'BENG', 'CHNS', 'CLAS', 'CMLT', 'COMM', 'ECON', 'ENGL', 'FILM', 'FREN', 'GEOG', 'GRMN', 'HEBR', 'HIST', 'HNDI', 'INDO', 'ITAL', 'JPNS', 'KREN', 'LACS', 'LATN', 'LING', 'LLED', 'MUSI', 'PASH', 'PERS', 'PHIL', 'POLS', 'PORT', 'PTSP', 'QUEC', 'RELI', 'ROML', 'RUSS', 'SCAN', 'SEMI', 'SLAV', 'SPAN', 'THEA', 'TURK', 'URDU', 'VIET', 'WMST', 'YORB', 'ZULU'];

/** Options I to V's Area VI: the major and minor languages' 2001 and 2002, and 6 hours from the page's prefixes. */
function romanceAreaSix(n: number, name: string, languages: RomanceLanguage[]): UgaRequirementGroup[] {
  return [
    all(focus(n, name, 'Area VI'), languages.flatMap((language) => [
      row(`${ROMANCE_SUBJECTS[language]} 2001`, `Intermediate ${language} I`, 3),
      row(`${ROMANCE_SUBJECTS[language]} 2002`, `Intermediate ${language} II`, 3),
    ]), 'Area VI: 2001 and 2002 in both languages.'),
    hoursFrom(focus(n, name, 'Area VI, 6 more hours'), 6, lowerLevels(ROMANCE_AREA_SIX_SUBJECTS), 'Area VI: courses with these prefixes.'),
  ];
}

/** Options I to IV: a major and a minor language, by the option's own rules. */
const ROMANCE_PAIRS: Array<[option: string, major: RomanceLanguage, minor: RomanceLanguage]> = [
  ['Option I', 'French', 'Spanish'], ['Option I', 'Spanish', 'French'],
  ['Option II', 'Italian', 'French'], ['Option II', 'Italian', 'Spanish'], ['Option II', 'Portuguese', 'French'], ['Option II', 'Portuguese', 'Spanish'],
  ['Option III', 'French', 'Italian'], ['Option III', 'French', 'Portuguese'], ['Option III', 'Spanish', 'Italian'], ['Option III', 'Spanish', 'Portuguese'],
  ['Option IV', 'Italian', 'Portuguese'], ['Option IV', 'Portuguese', 'Italian'],
];

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
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 4),
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
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 4),
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
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 4),
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
          row('PBIO 4960R', 'Faculty-Mentored Undergraduate Research I', 4),
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
          row('KINS 5450', 'Internship in Kinesiology', 3),
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
          // The Bulletin's ENVM 3650; the course catalog the planner reads has it as ENVM 4650 (and no ENVM 3650).
          row('ENVM 4650', 'Environmental Economics', 3),
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
          row('LAND 4620', 'American Architecture to 1900', 3),
          row('ARHI 4990R', 'Undergraduate Research Thesis (or Final Project)', 3),
          row('ARHI 4995', 'Art History Museum Internship', 3),
        ], 'Courses with these subjects or the LAND courses listed; at most 3 more ARHI hours and 6 ARST hours (ARST 1050, 1060, 1080, 2200 and 4170 recommended). ARHI 4990R and ARHI 4995 (museum internship) with the area chair\'s approval.'),
      ]),
      generalElectives(12, 9),
    ],
  },
  /*
   * Film AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/29901):
   * the General Program of Study, the Area of Emphasis in Film Studies or
   * the Area of Emphasis in Film Production, each with its own Area VI
   * selection, required courses, major electives and general electives; the
   * reading required all three at once (126 of 120 hours). The path's rows
   * are one choice here, Area VI's own 8 hours among them (FILM 2120 and 7
   * hours from the list are every path's).
   */
  '29901': {
    areaSix: area('VI. Courses Related to the Major', 10, [
      all('VI. Courses Related to the Major', [
        row('FILM 2120', 'Introduction to Cinema', 3),
      ]),
      hoursFrom('VI. Courses Related to the Major: 7 hours', 7, FILM_AREA_SIX, 'Only two of FILM 2000, 2510, 2520, 2530 and 2550 count in Area VI. ARHI, ARST, CLAS, CMLT, COMM, DANC, EMST, ENGL, HIST, JOUR, MUSI, NMIX, PHIL, PSYC and WMST courses at the 1000 to 3000 level, THEA at the 1000 or 2000 level.'),
    ]),
    major: [
      area('Program of Study', 50, [
        all(focus(1, 'General Program of Study'), [
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 5900', 'Film Theory', 3),
        ]),
        choose(focus(1, 'General Program of Study', 'film history or topics'), 1, [
          row('FILM 4100', 'Latinx Film and Visual Culture', 3),
          row('FILM 4270', 'History of Cinema III (1990-Present)', 3),
          row('FILM 4600', 'Women and Film', 3),
          row('FILM 4620', 'Genre Cinema', 3),
          row('FILM 4640', 'Latin American Film and Media', 3),
          row('FILM 4650', 'French Film History', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('FILM 4670', 'Film Technology and Style', 3),
          row('FILM 5481', 'Topics in Cinema', 3),
        ]),
        hoursFrom(focus(1, 'General Program of Study', 'Area VI, 8 more hours'), 8, FILM_AREA_SIX, 'With the 7 above: 15 hours from the Area VI list.'),
        hoursFrom(focus(1, 'General Program of Study', 'Major Electives'), 15, [
          row('CMLT 4210', 'Literature and Cinema', 3),
          row('CMLT 4220', 'East Asian Cinema', 3),
          row('CMLT 4230', 'African Cinema', 3),
          row('FILM 3110', 'Introduction to Screenwriting', 3),
          row('FILM 4100', 'Latinx Film and Visual Culture', 3),
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 4270', 'History of Cinema III (1990-Present)', 3),
          row('FILM 4600', 'Women and Film', 3),
          row('FILM 4620', 'Genre Cinema', 3),
          row('FILM 4640', 'Latin American Film and Media', 3),
          row('FILM 4650', 'French Film History', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('FILM 4670', 'Film Technology and Style', 3),
          row('FILM 4680', 'Introduction to DV Production', 3),
          row('FILM 5481', 'Topics in Cinema', 3),
          row('FILM 5640', 'Directing for the Cinema', 3),
          row('FILM 5680', 'Editing for Film and Video', 3),
          row('FILM 5690', 'Special Effects for Film and Video', 3),
          row('FILM 5700', 'Internship in Film/Media', 3),
          row('FILM 5810', 'Computer Animation for Dramatic Media I', 3),
          row('FILM 5820', 'Computer Animation for Dramatic Media II', 3),
          row('FILM 5830', 'Computer Animation for Dramatic Media III', 3),
          row('GRMN 3300', 'Introduction to German Cinema', 3),
          row('GRMN 3820', 'German Film', 3),
          row('ITAL 4040', 'Topics in Italian Cinema', 3),
          row('RUSS 3300', 'Introduction to Russian Cinema', 3),
          row('SPAN 4081', 'Spanish Film', 3),
          row('SPAN 4082', 'Latin American Film', 3),
          row('THEA 3020', 'Basic Dramatic Writing', 3),
          row('THEA 3300', 'Design Foundations', 3),
          row('THEA 3700', 'Design for Film and Television', 3),
          row('THEA 4000', 'Intermediate Dramatic Writing: The Short Script', 3),
          row('THEA 5620', 'Advanced Dramatic Writing: The Full-Length Script', 3),
        ], 'Only one of the courses marked on the Bulletin page counts.'),
        hoursFrom(focus(1, 'General Program of Study', 'general electives numbered 3000 and above'), 12, [ANY_UPPER_COURSE], '12 of the 33 general elective hours numbered 3000 and above; the other 21 at any level (Bulletin, checked again 2026-10-30).'),
        hoursFrom(focus(1, 'General Program of Study', 'general electives at any level'), 9, [ANY_COURSE], '9 more of the 21 general elective hours at any level (the rest are the plan\'s general electives).'),
        all(focus(2, 'Area of Emphasis in Film Studies'), [
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 5900', 'Film Theory', 3),
        ]),
        choose(focus(2, 'Area of Emphasis in Film Studies', 'film history or topics'), 1, [
          row('FILM 4100', 'Latinx Film and Visual Culture', 3),
          row('FILM 4270', 'History of Cinema III (1990-Present)', 3),
          row('FILM 4600', 'Women and Film', 3),
          row('FILM 4620', 'Genre Cinema', 3),
          row('FILM 4640', 'Latin American Film and Media', 3),
          row('FILM 4650', 'French Film History', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('FILM 4670', 'Film Technology and Style', 3),
          row('FILM 5481', 'Topics in Cinema', 3),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Film Studies', 'Area VI, 8 more hours'), 8, FILM_AREA_SIX, 'With the 7 above: 15 hours from the Area VI list.'),
        hoursFrom(focus(2, 'Area of Emphasis in Film Studies', 'Major Electives'), 15, [
          row('FILM 4100', 'Latinx Film and Visual Culture', 3),
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 4270', 'History of Cinema III (1990-Present)', 3),
          row('FILM 4600', 'Women and Film', 3),
          row('FILM 4620', 'Genre Cinema', 3),
          row('FILM 4640', 'Latin American Film and Media', 3),
          row('FILM 4650', 'French Film History', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('FILM 4670', 'Film Technology and Style', 3),
          row('FILM 5481', 'Topics in Cinema', 3),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Film Studies', 'general electives numbered 3000 and above'), 12, [ANY_UPPER_COURSE], '12 of the 33 general elective hours numbered 3000 and above; the other 21 at any level (Bulletin, checked again 2026-10-30).'),
        hoursFrom(focus(2, 'Area of Emphasis in Film Studies', 'general electives at any level'), 9, [ANY_COURSE], '9 more of the 21 general elective hours at any level (the rest are the plan\'s general electives).'),
        all(focus(3, 'Area of Emphasis in Film Production'), [
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 4680', 'Introduction to DV Production', 3),
          row('FILM 5640', 'Directing for the Cinema', 3),
          row('FILM 5680', 'Editing for Film and Video', 3),
          row('FILM 5900', 'Film Theory', 3),
          row('THEA 3340', 'Stagecraft', 3),
        ]),
        choose(focus(3, 'Area of Emphasis in Film Production', 'film history or topics'), 1, [
          row('FILM 4100', 'Latinx Film and Visual Culture', 3),
          row('FILM 4270', 'History of Cinema III (1990-Present)', 3),
          row('FILM 4600', 'Women and Film', 3),
          row('FILM 4620', 'Genre Cinema', 3),
          row('FILM 4640', 'Latin American Film and Media', 3),
          row('FILM 4650', 'French Film History', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('FILM 4670', 'Film Technology and Style', 3),
          row('FILM 5481', 'Topics in Cinema', 3),
        ]),
        choose(focus(3, 'Area of Emphasis in Film Production', 'design'), 1, [
          row('THEA 5330', 'Costume Design for the Entertainment Arts', 3),
          row('THEA 5351', 'Scenic Design for the Entertainment Arts', 3),
          row('THEA 5352', 'Lighting Design for the Entertainment Arts', 3),
        ]),
        all(focus(3, 'Area of Emphasis in Film Production', 'Area VI'), [
          row('THEA 3020', 'Basic Dramatic Writing', 3),
          row('THEA 3600', 'Fundamentals of Acting on Camera', 3),
          row('THEA 5051', 'Applied Drama Laboratory', 2),
        ], 'THEA 5570 may replace THEA 3600 for students dual majoring in Theatre.'),
        hoursFrom(focus(3, 'Area of Emphasis in Film Production', 'Major Electives'), 15, [
          row('CMLT 4210', 'Literature and Cinema', 3),
          row('CMLT 4220', 'East Asian Cinema', 3),
          row('CMLT 4230', 'African Cinema', 3),
          row('FILM 3110', 'Introduction to Screenwriting', 3),
          row('FILM 4100', 'Latinx Film and Visual Culture', 3),
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 4270', 'History of Cinema III (1990-Present)', 3),
          row('FILM 4600', 'Women and Film', 3),
          row('FILM 4620', 'Genre Cinema', 3),
          row('FILM 4640', 'Latin American Film and Media', 3),
          row('FILM 4650', 'French Film History', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('FILM 4670', 'Film Technology and Style', 3),
          row('FILM 4680', 'Introduction to DV Production', 3),
          row('FILM 5481', 'Topics in Cinema', 3),
          row('FILM 5690', 'Special Effects for Film and Video', 3),
          row('FILM 5700', 'Internship in Film/Media', 3),
          row('FILM 5810', 'Computer Animation for Dramatic Media I', 3),
          row('FILM 5820', 'Computer Animation for Dramatic Media II', 3),
          row('FILM 5830', 'Computer Animation for Dramatic Media III', 3),
          row('GRMN 3300', 'Introduction to German Cinema', 3),
          row('GRMN 3820', 'German Film', 3),
          row('ITAL 4040', 'Topics in Italian Cinema', 3),
          row('RUSS 3300', 'Introduction to Russian Cinema', 3),
          row('SPAN 4081', 'Spanish Film', 3),
          row('SPAN 4082', 'Latin American Film', 3),
          row('THEA 3290', 'Script Analysis', 3),
          row('THEA 3300', 'Design Foundations', 3),
          row('THEA 3700', 'Design for Film and Television', 3),
          row('THEA 4000', 'Intermediate Dramatic Writing: The Short Script', 3),
          row('THEA 5330', 'Costume Design for the Entertainment Arts', 3),
          row('THEA 5351', 'Scenic Design for the Entertainment Arts', 3),
          row('THEA 5352', 'Lighting Design for the Entertainment Arts', 3),
          row('THEA 5514', 'Performing Physical Violence and Weaponry', 3),
          row('THEA 5600', 'Play Direction', 3),
          row('THEA 5620', 'Advanced Dramatic Writing: The Full-Length Script', 3),
          row('THEA 5870', 'Performing with Media', 3),
        ], 'Only one of the courses marked on the Bulletin page counts.'),
      ]),
      // 12 of the General Program's and Film Studies' 33 hours (the other 21, upper division, are their rows above); Film Production's 18.
      generalElectives(12),
    ],
  },
  /*
   * Russian AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/76210):
   * Required Courses (24 hours) are the Russian and Slavic Studies Track or
   * the Intensive Russian Language Track; the reading required both (141 of
   * 120 hours) and left their RUSS and SLAV hours unnamed, and Area VI's 7
   * hours too. General Electives: 18 of the 36 hours upper division.
   */
  '76210': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('LING 2100', 'The Study of Language', 3),
      ]),
      choose('Intermediate Russian I', 1, [
        row('RUSS 2001', 'Intermediate Russian I', 4),
        row('RUSS 2011', 'Intensive Intermediate Russian I', 4),
      ]),
      choose('Intermediate Russian II', 1, [
        row('RUSS 2002', 'Intermediate Russian II', 4),
        row('RUSS 2012', 'Intensive Intermediate Russian II', 4),
      ]),
      hoursFrom('VI. Courses Related to the Major: 7 hours', 7, lowerLevels(['ANTH', 'ARGD', 'ARHI', 'ARID', 'ARST', 'ARTS', 'CMLT', 'COMM', 'ECON', 'ENGL', 'FILM', 'GEOG', 'HIST', 'INTL', 'LING', 'MUSI', 'PHIL', 'POLS', 'THEA', 'AMHA', 'AMSL', 'ARAB', 'BENG', 'CHNS', 'FREN', 'GRMN', 'GREK', 'HAUS', 'HEBR', 'HNDI', 'INDO', 'ITAL', 'JPNS', 'KREN', 'LATN', 'PASH', 'PERS', 'PORT', 'QUEC', 'SCAN', 'SLAV', 'SPAN', 'SWAH', 'TURK', 'URDU', 'VIET', 'YORB', 'ZULU']), 'Courses with these prefixes, or 1000/2000-level courses in a second foreign language.'),
    ]),
    major: [
      area('Required Courses', 24, [
        all('Required Courses', [
          row('RUSS 3011', 'Intensive Russian Conversation and Composition I', 3),
          row('RUSS 3012', 'Intensive Russian Conversation and Composition II', 3),
        ]),
        hoursFrom(focus(1, 'Russian and Slavic Studies Track'), 18, [...levels('RUSS', 3, 4), ...levels('SLAV', 3, 4)], 'RUSS or SLAV courses taught in Russian or English; these 18 hours may include no more than one 2000-level course.'),
        hoursFrom(focus(2, 'Intensive Russian Language Track'), 15, [
          row('RUSS 3001', 'Russian Conversation and Composition I', 3),
          row('RUSS 3002', 'Russian Conversation and Composition II', 3),
          row('RUSS 3050', 'Russian Through Films', 3),
          row('RUSS 3100', 'Approaches to Russian/English Translation: Cultural, Sociolinguistic, and Grammatical Issu', 3),
          row('RUSS 3911', 'Tutorial in Professional Russian I', 3),
          row('RUSS 3912', 'Tutorial in Professional Russian II', 3),
          row('RUSS 3990', 'Directed Study in Russian', 3),
          row('RUSS 4000L', 'Advanced Russian Conversation Practicum', 3),
          row('RUSS 4001', 'Advanced Russian Conversation and Composition', 3),
          row('RUSS 4002', 'Advanced Proficiency in Professional Russian', 3),
          row('RUSS 4250', 'Pushkin', 3),
          row('RUSS 4260', 'Masterpieces of Nineteenth-Century Russian Literature', 3),
          row('RUSS 4270', 'Masterpieces of Twentieth-Century Russian Literature', 3),
          row('RUSS 4510', 'Special Topics', 3),
          row('RUSS 4520', 'Contemporary Russian Culture', 3),
          row('RUSS 4911', 'Advanced Topics in Professional Russian I', 3),
          row('RUSS 4912', 'Advanced Topics in Professional Russian II', 3),
          row('SLAV 3070', 'Introduction to Slavic Linguistics', 3),
        ], 'RUSS or SLAV courses at the 3000/4000 level taught in Russian; no more than one directed study course.'),
        hoursFrom(focus(2, 'Intensive Russian Language Track', 'a course taught in English'), 3, [
          row('RUSS 2050', '20th-Century Russian Culture: The Soviet Experiment and its Aftermath', 3),
          row('RUSS 3150', 'The Russian Fairy Tales', 3),
          row('RUSS 3300', 'Introduction to Russian Cinema', 3),
          row('RUSS 3400', 'The Stuff of the Soul: Dostoevsky’s Prose and its Aesthetic and Ethical Influence', 3),
          row('RUSS 3500', 'The Russian Novel: Masterpieces of Russian Literature in the Age of Realism', 3),
          row('RUSS 3550', 'Contemporary Issues in Russian Society and Culture', 3),
          row('RUSS 3560', 'Armenia, Georgia, Russia: A Cross-Cultural Perspective', 3),
          row('RUSS 3600', 'Contemporary Ukrainian and Russian Cinema', 3),
          row('RUSS 4030', 'Ukraine and Russia: Conflicts in Representation', 3),
          row('RUSS 4040', 'Tolstoy on Page and Screen', 3),
          row('RUSS 4080', 'Nabokov', 3),
          row('RUSS 4090', 'Russia through the Eyes of Tolstoy and Dostoevsky', 3),
          row('RUSS 4280', 'Chekhov', 3),
          row('SLAV 2100', 'Slavic Folklore', 3),
          row('SLAV 3100H', 'The Balkans: Culture, Conflict, and the Construction of Identity (Honors)', 3),
          row('SLAV 3200', 'Literature and Moral Life: The Ethics of Fiction and Non-Fiction in East European Literature', 3),
          row('SLAV 3400', 'Kind of Human: Animals, Children, and Robots in Russian and East European Literature and Art', 3),
          row('SLAV 4510', 'Special Topics', 3),
          row('SLAV 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('SLAV 4970R', 'Faculty-Mentored Undergraduate Research II', 3),
          row('SLAV 4980R', 'Faculty-Mentored Undergraduate Research III', 3),
          row('SLAV 4990R', 'Undergraduate Research Thesis (or Final Project)', 3),
        ], 'Three hours of RUSS or SLAV courses taught in English.'),
      ]),
      generalElectives(36, 18),
    ],
  },
  /*
   * Comparative Literature and Intercultural Studies AB (verified
   * 2026-10-29, bulletin.uga.edu/Program/Details/47290): Required Courses
   * are CMLT 4010, CMLT 4020 and one of three options of six courses; the
   * reading required all three options (about 18 courses for 6) and lost
   * Area VI's language, CMLT and related-course rows.
   */
  '47290': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      choose('Foreign language through the third semester', 1, THIRD_SEMESTER_COURSES, 'The third semester course of a foreign language (and the courses before it, which count among the related courses below).'),
      choose('CMLT literature courses at the 2000 level', 2, levels('CMLT', 2, 2)),
      hoursFrom('Related courses', 9, lowerLevels(['ARAB', 'AFAM', 'ARTS', 'CLAS', 'CHNS', 'ENGL', 'FREN', 'GREK', 'GRMN', 'HEBR', 'HIST', 'HNDI', 'ITAL', 'JPNS', 'KREN', 'LACS', 'LATN', 'LING', 'MUSI', 'PHIL', 'PORT', 'RELI', 'ROML', 'RUSS', 'SPAN', 'SWAH', 'THEA', 'VIET', 'WMST', 'YORB']), 'At most 9 hours of courses with these prefixes at the 1000/2000 level.'),
    ]),
    major: [
      area('Required Courses', 24, [
        all('Required Courses', [
          row('CMLT 4010', 'Approaches in Comparative Literature', 3),
          row('CMLT 4020', 'Senior Seminar in Comparative Literature', 3),
        ]),
        hoursFrom(focus(1, 'Option One'), 18, levels('CMLT', 3), 'Six CMLT courses at the 3000 level and above.'),
        hoursFrom(focus(2, 'Option Two'), 9, levels('CMLT', 3), 'Three CMLT courses at the 3000 level and above.'),
        hoursFrom(focus(2, 'Option Two', 'literature in another department'), 9, [
          row('CHNS 4500', 'Readings in Chinese Literature', 3),
          row('JPNS 4500', 'Readings in Japanese Literature', 3),
          ...['ENGL', 'FREN', 'GREK', 'GRMN', 'ITAL', 'LATN', 'PORT', 'RUSS', 'SLAV', 'SPAN'].flatMap((subject) => levels(subject, 3)),
        ], 'Three literature courses at the 3000 level and above.'),
        hoursFrom(focus(3, 'Option Three'), 9, levels('CMLT', 3), 'Three CMLT courses at the 3000 level and above.'),
        fromOneList(hoursFromLists(focus(3, 'Option Three', 'three courses in one discipline'), 9, {
            Anthropology: [
              row('ANTH 3200', 'How the World Works: The Anthropology of Consumption and Globalization', 3),
              row('ANTH 3210', 'Archaeology of Warfare', 3),
              row('ANTH 3220', 'Introduction to Archaeological Theory and Methods', 3),
              row('ANTH 3250', 'Old World Archaeology', 3),
              row('ANTH 3290', 'Celtic and Pre-Celtic Prehistory', 3),
              row('ANTH 3310', 'Cultures of Southeast Asia', 3),
              row('ANTH 3410', 'Contemporary Native America', 3),
              row('ANTH 4050', 'Rethinking Humanity: A History of Cultural Anthropology', 3),
              row('ANTH 4070', 'Cultural Ecology', 3),
              row('ANTH 4085', 'Conservation on a Changing Planet', 3),
              row('ANTH 4230', 'Conceptual Foundations of Archaeology', 3),
              row('ANTH 4461', 'African Ethnography', 3),
              row('ANTH 4550', 'Ethnohistory', 3),
              row('ANTH 4850', 'Archaeology and Society', 3),
              row('CMLT 3001', 'Culture and Identity Linkages of the Swahili with the Outside World I', 3),
              row('CMLT 3020', 'Culture and Identity Linkages of the Swahili with the Outside World II', 3),
              row('CMLT 3030', 'Introduction to African Languages and Cultures', 3),
              row('CMLT 4245', 'Oral Literature in Africa', 3),
              row('LING 4860', 'Sociolinguistics', 3),
              row('RELI 4110', 'Anthropology and American Religion', 3),
              row('RELI 4640', 'Anthropology of Religion', 3),
            ],
            'Classical Culture': [
              row('ARHI 4002', 'Greek and Roman Painting', 3),
              row('ARHI 4004', 'The Roman Villa', 3),
              row('ARHI 4006', 'Color in Ancient Art', 3),
              row('ARHI 4008', 'Ancient Roman Sculpture', 3),
              row('CLAS 3000', 'Introduction to Classical Europe', 3),
              row('CLAS 3070', 'Classical Rhetoric', 3),
              row('CLAS 4010', 'Archaic Greece', 3),
              row('CLAS 4160', 'History of Late Antiquity', 3),
              row('CLAS 4200', 'Ancient Comedy', 3),
              row('CLAS 4210', 'Ancient Tragedy', 3),
              row('CLAS 4220', 'Classical Epic Poetry', 3),
              row('CLAS 4230W', 'Classical Rhetoric', 3),
              row('CLAS 4240', 'Analysis of Classical Mythology', 3),
              row('CLAS 4250', 'Ancient Novel', 3),
              row('CLAS 4260', 'Literature of the Classical Tradition', 3),
              row('CLAS 4300', 'Selected Topics in Ancient Civilization', 3),
              row('CLAS 4330', 'Greek Theater and Theatricality', 3),
              row('CLAS 4340', 'Ancient Athens', 3),
              row('CLAS 4360', 'An Introduction to Ancient Daily Life', 3),
              row('CLAS 4370', 'The Roman Theatre and Theatricality', 3),
              row('CLAS 4390', 'The Grand Tour: Visions and Revisions of Classical Antiquity', 3),
              row('CLAS 4395', 'The Legacy of Classical Antiquity', 3),
              row('COMM 4410', 'Rhetoric and Democracy in the Ancient World', 3),
              row('HIST 3311', 'Society and Culture of Ancient Greece', 3),
              row('HIST 3312', 'Society and Culture in the Roman World', 3),
              row('HIST 3321', 'History of Women in the Ancient World', 3),
              row('HIST 4225', 'Medicine, Healing, and the Body in Ancient Greece and Rome', 3),
              row('HIST 4320', 'Law and Society in the Greco-Roman World', 3),
              row('HIST 4329', 'Studies in Ancient Greek and Roman History', 3),
            ],
            Ecology: [
              row('ANTH 4290', 'Environmental Archaeology', 3),
              row('ECOL 3070', 'Environment and Humans', 3),
              row('ECOL 3480', 'Special Topics in Ecology', 3),
              row('ECOL 3770S', 'Urban Ecology - Service Learning', 3),
              row('ECOL 4270', 'Natural History for Educators', 3),
              row('ECOL 4560', 'Science and Art of Conservation', 4),
            ],
            Film: [
              row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
              row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
              row('FILM 4600', 'Women and Film', 3),
              row('FILM 4620', 'Genre Cinema', 3),
              row('FILM 4640', 'Latin American Film and Media', 3),
              row('FILM 4650', 'French Film History', 3),
              row('FILM 4660', 'History of Animation', 3),
              row('FILM 4670', 'Film Technology and Style', 3),
              row('FILM 5481', 'Topics in Cinema', 3),
            ],
            Geography: [
              row('CMLT 4260', 'The Black and Green Atlantic: Crosscurrents of the African and Irish Diasporas', 3),
              row('GEOG 3510', 'Cartography and Graphics', 3),
              row('GEOG 3640', 'The Geography of Human Rights', 3),
              row('GEOG 3690', 'Introduction to Political Geography', 3),
              row('GEOG 4620', 'Advanced Economic Geography', 3),
              row('GEOG 4630', 'Advanced Urban Geography', 3),
              row('GEOG 4632', 'Urban Social Movements', 3),
              row('GEOG 4633', 'Urban Political Ecology', 3),
              row('GEOG 4634', 'Paris and Modernity: Power, Politics, and Identity in the City', 3),
              row('GEOG 4670', 'Geography of Development', 3),
              row('GEOG 4680', 'Gender and Geography', 3),
              row('GEOG 4690', 'Power, Politics, and Place', 3),
              row('GEOG 4694', 'Politics and the Modern European State', 3),
              row('GEOG 4720', 'Geography of Latin America', 3),
              row('GEOG 4730', 'Geography of China', 3),
              row('GEOG 4740', 'Geography of East and Southeast Asia', 3),
              row('GEOG 4750', 'Geography of Europe', 3),
              row('GEOG 4840', 'Regenerative and Sustainable Development', 3),
            ],
            History: [
              row('ANTH 4470', 'Native American Histories and Archaeologies of the American Southeast', 3),
              row('CMLT 3245', 'World History and Fiction', 3),
              row('COMM 4635', 'Paris and its Symbols: Public Art and the Public Self', 3),
              row('GEOG 4634', 'Paris and Modernity: Power, Politics, and Identity in the City', 3),
              ...levels('HIST', 3, 4),
            ],
            Linguistics: [
              row('CMSD 3120', 'Study of Language Development', 3),
              row('ENGL 4005', 'History of the English Language', 3),
              row('ENGL 4010', 'American English', 3),
              row('ENGL 4040', 'Language Use in the African American Community', 3),
              row('ENGL 4060', 'Old English', 3),
              row('ENGL 4100', 'Lexicography', 3),
              row('ENGL 4110', 'English Grammar', 3),
              row('ENGL 4170', 'Second Language Acquisition', 3),
              row('ENGL 4190', 'Topics in the English Language', 3),
              row('ENGL 4195', 'Celtic Languages', 3),
              row('ENGL 4885', 'Introduction to Humanities Computing', 3),
              row('ENGL 4886', 'Text and Corpus Analysis', 3),
              row('ENGL 4889', 'Humanities Computing II: Applied Design', 3),
              row('FREN 3090', 'Introduction to French Linguistics', 3),
              row('FREN 4630', 'French Phonetics', 3),
              row('FREN 4800', 'French Syntax and Meaning', 3),
              row('GREK 4150', 'Comparative Grammar of Greek and Latin', 3),
              row('GRMN 3280', 'Contrastive Grammar: German - English', 3),
              row('GRMN 3770', 'Heritage German: Language Change and Language Shift', 3),
              row('GRMN 3860', 'The Evolution of German as a Standard Language', 3),
              row('GRMN 4380', 'Contrastive Grammar: German-English', 3),
              row('GRMN 4640', 'German Phonology and Morphology', 3),
              row('LING 3060', 'Phonetics and Phonology', 3),
              row('LING 3150', 'Generative Syntax', 3),
              row('LING 3250', 'Morphology', 3),
              row('LING 3830', 'Languages of the World', 3),
              row('LING 3850', 'Language, Politics, and Identity', 3),
              row('LING 4022', 'Advanced Phonetics and Phonology', 3),
              row('LING 4050', 'Structure of African American English', 3),
              row('LING 4080', 'Language and Complex Systems', 3),
              row('LING 4160', 'Compositional Semantics', 3),
              row('LING 4211', 'Introduction to Indo-European Studies', 3),
              row('LING 4400', 'Quantitative Methods in Linguistics', 3),
              row('LING 4690', 'Historical Linguistics', 3),
              row('LING 4710', 'Languages in Contact', 3),
              row('LING 4740', 'Discourse Analysis', 3),
              row('LING 4860', 'Sociolinguistics', 3),
              row('LING 4870', 'Language, Gender, and Sexuality', 3),
              row('LING 4900', 'Topics in Indo-European Linguistics', 3),
              row('LING 4940', 'Special Topics in Linguistics', 3),
              row('PHIL 4300', 'Philosophy of Language', 3),
              row('SLAV 3070', 'Introduction to Slavic Linguistics', 3),
              row('SPAN 3050', 'Introduction to Spanish Linguistics', 3),
              row('SPAN 4650', 'Spanish Phonetics and Language Variation', 3),
              row('SPAN 4651', 'Advanced Spanish Grammar', 3),
              row('SPAN 4652', 'Spanish Dialectology and Language Variation', 3),
            ],
            Music: [
              row('MUSI 3020', 'World Music Survey: Africa, Europe, and the Americas', 3),
              row('MUSI 3021', 'World Music Survey: Asia, Australia, and Oceania', 3),
              row('MUSI 3030', 'Music in the United States', 3),
              row('MUSI 3100', 'Creativity in Music', 3),
              row('MUSI 3210', 'Music in the Western Tradition Pre-1750', 3),
              row('MUSI 3220', 'Music in the Western Tradition Post-1750', 3),
              row('MUSI 4120', 'Form and Analysis', 3),
              row('MUSI 4135', 'Jazz Theory', 3),
              row('MUSI 4140', 'Tonal Counterpoint', 3),
              row('MUSI 4145', 'Model Composition', 3),
              row('MUSI 4150', 'Analysis of Non-Tonal Music', 3),
              row('MUSI 4160', 'Analysis of Texted Music', 3),
              row('MUSI 4170', 'Dissolution of Tonality', 3),
              row('MUSI 4175', 'Exploring Math and Music', 3),
              row('MUSI 4190', 'Special Topics in Music Theory and Analysis', 3),
              row('MUSI 4200', 'Ancient, Medieval, and Renaissance Music', 3),
              row('MUSI 4210', 'Late Renaissance and Baroque Music', 3),
              row('MUSI 4220', 'Music in the Classic Period', 3),
              row('MUSI 4230', 'Music in the Romantic Period', 3),
              row('MUSI 4240', 'Modern Music', 3),
              row('MUSI 4250', 'Women and Music', 3),
              row('MUSI 4260', 'History of Opera', 3),
              row('MUSI 4270', 'Topics in Musical Cultures of the World', 3),
              row('MUSI 4289', 'Selected Studies in Musicology', 3),
              row('MUSI 4290', 'Seminar in Musicology-Ethnomusicology', 3),
              row('MUSI 4291', 'African Music', 3),
              row('MUSI 4320', 'Women and Music', 3),
              row('MUSI 4420', 'Bollywood and Its Others: Cinema in South Asia', 3),
              row('MUSI 4430', 'Country Music, Race, and the Idea of America', 3),
              row('MUSI 4440', 'History of American Music', 3),
              row('WMST 4310', 'Gender and Music Video', 3),
            ],
            'Political Science': [
              row('POLS 3000', 'Introduction to Political Theory', 3),
              row('POLS 4010', 'Political Philosophy to Machiavelli', 3),
              row('POLS 4020', 'Political Philosophy: Hobbes to Nietzsche', 3),
              row('POLS 4030', 'Contemporary Political Thought', 3),
              row('POLS 4040', 'American Political Thought', 3),
              row('POLS 4080', 'Legal Theory', 3),
              row('POLS 4090', 'Social Justice', 3),
              row('POLS 4400', 'Political Psychology', 3),
              row('POLS 4550', 'Government and the Mass Media', 3),
              row('POLS 4615', 'Polarization of American Politics', 3),
              row('POLS 4690', 'Religion and American Politics', 3),
              row('POLS 4750', 'Gender, Law, and Politics', 3),
            ],
            Psychology: [
              row('AFAM 4500', 'Psychology of Prejudice', 3),
              row('ARTI 3550', 'Introduction to Cognitive Science', 3),
              row('PHIL 3400', 'Philosophical Psychology', 3),
              row('PSYC 3230', 'Psychopathology', 3),
              row('PSYC 3260', 'Human Sexuality', 3),
              row('PSYC 3300', 'Social and Personality Development', 3),
              row('PSYC 3600', 'Abnormal Psychology - Eastern and Western Approaches', 3),
              row('PSYC 4100', 'Cognitive Psychology', 3),
              row('PSYC 4220', 'Developmental Psychology', 3),
              row('PSYC 4600', 'Psychology of Women', 3),
              row('PSYC 4920', 'History of Psychology', 3),
              row('PSYC 4930', 'Systems of Psychology', 3),
            ],
            Religion: [
              row('AFST 3203', 'African Mythology', 3),
              row('HIST 3333', 'Christianity and Society from Constantine to Luther', 3),
              row('RELI 3000', 'The Bible in the Third World', 3),
              row('RELI 3030', 'Religion and the Media', 3),
              row('RELI 3150', 'Religion in the United States', 3),
              row('RELI 3202', 'African Concept of God and Humanity', 3),
              row('RELI 3300', 'Introduction to East Asian Religions', 3),
              row('RELI 4001', 'Old Testament/Hebrew Bible Literature', 3),
              row('RELI 4002', 'Prophetic Literature of the Old Testament/Hebrew Bible', 3),
              row('RELI 4003', 'Ancient Israelite Religion', 3),
              row('RELI 4004', 'Psalms, Job, and Other Writings of the Hebrew Bible/Old Testament', 3),
              row('RELI 4005', 'Topics in Hebrew Bible', 3),
              row('RELI 4040', 'Apocalyptic Literature', 3),
              row('RELI 4070', 'Judaism', 3),
              row('RELI 4071', 'The Holocaust', 3),
              row('RELI 4080', 'New Testament Literature', 3),
              row('RELI 4082', 'Life and Letters of Paul', 3),
              row('RELI 4083', 'The New Testament World', 3),
              row('RELI 4084', 'Gospels', 3),
              row('RELI 4085', 'The Gospel According to John', 3),
              row('RELI 4088', 'Topics in New Testament Studies and Early Christianity', 3),
              row('RELI 4304', 'The Koran, Sacred Text of Islam', 3),
              row('RELI 4307', 'Comparative Islamic Literature', 3),
              row('RELI 4410', 'Gandhi and Nonviolence: History, Theory, and Practice', 3),
              row('RELI 4500', 'Philosophy of Religion', 3),
              row('RELI 4600', 'Religion and Literature', 3),
            ],
            Sociology: [
              row('LACS 4111', 'Citizenship and Social Movements in Latin America and the Caribbean', 3),
              row('SOCI 3000', 'Sociology in Film', 3),
              row('SOCI 3010', 'Sociology of Culture', 3),
              row('SOCI 3020', 'Lives in Time and Place', 3),
              row('SOCI 3030', 'Sociology of Religion', 3),
              row('SOCI 3330', 'On the Road: Tourists, Travelers, Vacationers, Pilgrims, and Adventurers', 3),
              row('SOCI 3590', 'Qualitative Methods of Social Research', 3),
              row('SOCI 3830', 'Violence and Society', 3),
              row('SOCI 4010', 'Seminar in Culture', 3),
              row('SOCI 4055', 'Social Policy Storytelling: In and Around Athens', 3),
              row('SOCI 4280', 'Global Perspectives on Gender', 3),
              row('SOCI 4800', 'Sociology of Morality', 3),
            ],
            Theater: [
              row('THEA 4210', 'Theatre and Modernity', 3),
              row('THEA 4220', 'Theatre and Society', 3),
              row('THEA 4230', 'Theatre and Ritual', 3),
              row('THEA 4280', 'Women in Performance', 3),
              row('THEA 4300', 'Queer Theatre and Film', 3),
              row('THEA 4400', 'Asian Theatre and Drama', 3),
              row('THEA 4460', 'History of Dramatic Art: Special Topics', 3),
              row('THEA 4470', 'African Theatre: An Historical Overview', 3),
              row('THEA 4480', 'History of African American Drama and Theatre', 3),
              row('THEA 4500', 'The Broadway Musical and American Culture', 3),
              row('THEA 4800', 'Topics in History', 3),
              row('TXMI 4270', 'History of Dress: Antiquity to Nineteenth Century', 3),
            ],
            "Women's Studies": [
              row('WMST 3500', 'Women in the Caribbean', 3),
              row('WMST 4070', 'North American Asian Feminisms', 3),
              row('WMST 4140', 'French Feminisms', 3),
              row('WMST 4260', 'Women and Music', 3),
              row('WMST 4310', 'Gender and Music Video', 3),
              row('WMST 4500', 'Latina Studies', 3),
            ],
        }, 'Three courses from one discipline: these lists, or the 3000- and 4000-level courses of African American Studies, Communication Studies, International Affairs, Latin American and Caribbean Studies, Native American Studies or Philosophy, or ARHI 3000-4940 (not 4800).'), 3, 'Courses must all be selected from the same discipline.'),
      ]),
      generalElectives(36, 12),
    ],
  },
  /*
   * Special Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/90477): Required Courses (60 hours) are
   * one of three areas of emphasis, which the reading left optional (so a
   * board without a pick had no major courses) and whose student teaching
   * (EDSE 5460, 15 hours) it booked at 7. The graduate-level lists after
   * each emphasis are the Double Dawgs pathways' programs of study, not the
   * degree's. Area VI's last 6 hours are general electives.
   */
  '90477': {
    areaSix: area('VI. Courses Related to the Major', 12, [
      all('VI. Courses Related to the Major', [
        row('EDIT 5100E', 'Assistive and Learning Technologies', 3),
        row('EDSE 2000', 'Survey of Special Education', 3),
        row('EDUC 2120', 'Exploring Socio-Cultural Perspectives in Educational Contexts', 3),
        row('EDUC 2130', 'Exploring Learning and Teaching', 3),
      ], 'A grade of C or higher in EDUC 2120 and EDUC 2130.'),
    ]),
    major: [
      area('Required Courses', 60, [
        all(focus(1, 'Special Education Adapted Curriculum'), [
          row('EDSE 3030', 'Introduction to Assessing Individuals with Disabilities', 3),
          row('EDSE 3050', 'Classroom and Behavior Management for Individuals with Disabilities', 3),
          row('EDSE 4050', 'Managing Severe Aggressive Behavior in the Classroom and Community', 3),
          row('EDSE 4120', 'Instruction of Individuals with Moderate to Severe Disabilities', 3),
          row('EDSE 4220', 'Instruction of Students with High-Incidence Disabilities', 3),
          row('EDSE 4230', 'Content-Area Instruction for Students with Disabilities', 3),
          row('EDSE 4441', 'Practicum in Special Education I', 3),
          row('EDSE 4442', 'Practicum in Special Education II', 3),
          row('EDSE 4443', 'Practicum in Special Education III', 3),
          row('EDSE 5020E', 'Assessment of Students with Dyslexia and Other Learning Disabilities', 3),
          row('EDSE 5120', 'Dyslexia and Other Learning Disabilities', 3),
          row('EDSE 5150', 'Designing Reading Interventions for Special Education', 3),
          row('EDSE 5250', 'Teaching Writing to Students with Disabilities', 3),
          row('EDSE 5400', 'Collaboration and Professional Practice', 3),
          row('EDSE 5460', 'Student Teaching in Special Education', 15),
          row('EDSE 5770', 'Practicum in Intensive Reading Intervention', 3),
        ], 'A grade of C or higher; B- or higher in practicum and student teaching. Teacher certification also asks for the program completion requirements on the Bulletin page.'),
        all(focus(2, 'Special Education General Curriculum'), [
          row('EDSE 3030', 'Introduction to Assessing Individuals with Disabilities', 3),
          row('EDSE 3050', 'Classroom and Behavior Management for Individuals with Disabilities', 3),
          row('EDSE 4050', 'Managing Severe Aggressive Behavior in the Classroom and Community', 3),
          row('EDSE 4120', 'Instruction of Individuals with Moderate to Severe Disabilities', 3),
          row('EDSE 4220', 'Instruction of Students with High-Incidence Disabilities', 3),
          row('EDSE 4230', 'Content-Area Instruction for Students with Disabilities', 3),
          row('EDSE 4441', 'Practicum in Special Education I', 3),
          row('EDSE 4442', 'Practicum in Special Education II', 3),
          row('EDSE 4443', 'Practicum in Special Education III', 3),
          row('EDSE 5020E', 'Assessment of Students with Dyslexia and Other Learning Disabilities', 3),
          row('EDSE 5120', 'Dyslexia and Other Learning Disabilities', 3),
          row('EDSE 5150', 'Designing Reading Interventions for Special Education', 3),
          row('EDSE 5250', 'Teaching Writing to Students with Disabilities', 3),
          row('EDSE 5400', 'Collaboration and Professional Practice', 3),
          row('EDSE 5460', 'Student Teaching in Special Education', 15),
          row('EDSE 5770', 'Practicum in Intensive Reading Intervention', 3),
        ], 'A grade of C or higher; B- or higher in practicum and student teaching. Teacher certification also asks for the program completion requirements on the Bulletin page.'),
        all(focus(3, 'Educational Studies in Special Education'), [
          row('EDSE 3030', 'Introduction to Assessing Individuals with Disabilities', 3),
          row('EDSE 3050', 'Classroom and Behavior Management for Individuals with Disabilities', 3),
          row('EDSE 4010', 'Instructing Children with Autism Spectrum Disorders', 3),
          row('EDSE 4120', 'Instruction of Individuals with Moderate to Severe Disabilities', 3),
          row('EDSE 4220', 'Instruction of Students with High-Incidence Disabilities', 3),
          row('EDSE 5020E', 'Assessment of Students with Dyslexia and Other Learning Disabilities', 3),
          row('EDSE 5120', 'Dyslexia and Other Learning Disabilities', 3),
          row('EDSE 5150', 'Designing Reading Interventions for Special Education', 3),
          row('EDSE 5160', 'Communication and Language Development in Young Children', 3),
          row('EDSE 5200', 'Methods in Teaching Infants and Young Children with Developmental Delays Birth through 5', 3),
          row('EDSE 5250', 'Teaching Writing to Students with Disabilities', 3),
          row('EDSE 5400', 'Collaboration and Professional Practice', 3),
          row('EDSE 5770', 'Practicum in Intensive Reading Intervention', 3),
        ], 'Does not lead to teacher certification.'),
        choose(focus(3, 'Educational Studies in Special Education', 'inclusion'), 1, [
          row('EDSE 4020', 'Inclusion of Students with Disabilities: PreK-Grade 5', 3),
          row('EDSE 4030', 'Inclusion of Students with Disabilities: Grades 6-12', 3),
        ]),
        choose(focus(3, 'Educational Studies in Special Education', 'six more courses'), 6, [
          row('CMSD 3120', 'Study of Language Development', 3),
          row('EDIT 5100S', 'Assistive and Learning Technologies', 3),
          row('EDSE 4000', 'Directed Study in Special Education', 3),
          row('EDSE 4050', 'Managing Severe Aggressive Behavior in the Classroom and Community', 3),
          row('EDSE 4230', 'Content-Area Instruction for Students with Disabilities', 3),
          row('EDSE 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('EDSE 4970R', 'Faculty-Mentored Undergraduate Research II', 3),
          row('EDSE 4980R', 'Faculty-Mentored Undergraduate Research III', 3),
          row('EDSE 4990R', 'Undergraduate Research Thesis (or Final Project)', 3),
          row('EDSE 5170', 'Developmentally Appropriate Programming and Curricula for Infants and Toddlers', 3),
          row('EDSE 5200', 'Methods in Teaching Infants and Young Children with Developmental Delays Birth through 5', 3),
          row('EPSY 4061', 'Motivational Foundations for Education', 3),
          row('EPSY 4070', 'Prevention and Intervention with School-Age Youth', 3),
          row('EPSY 4170', 'Educational Psychology of Race and Racism', 3),
          row('EPSY 5120', 'Autism Spectrum Disorders', 3),
          row('LLED 3420', 'Reading Instruction in the Elementary School', 3),
          row('LLED 3520', 'Teaching Reading in the Middle School', 3),
          row('LLED 4010', 'The Teaching of Reading', 3),
          row('LLED 5040', 'Language and Culture in the Classroom', 3),
          row('LLED 5630', 'ESOL, Grades P-12', 3),
          row('LLED 5730', 'First and Second Language Acquisition and Development', 3),
          row('PSYC 3230', 'Psychopathology', 3),
        ], 'Or any other course the advisor approves.'),
      ]),
      // Area VI's 6 hours of general elective coursework.
      generalElectives(6),
    ],
  },
  /*
   * Asian Languages and Literature AB (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/88637): Required Courses (24 hours) are
   * the Area of Emphasis in Chinese, Japanese or Korean, which the reading
   * left optional (a board without a pick had no major courses), with each
   * emphasis's Area VI language courses (1001 and 1002) lost. General
   * Electives: 12 of the 36 hours upper division.
   */
  '88637': {
    // The three Area VI courses every emphasis takes; each emphasis's language courses are with its rows.
    areaSix: area('VI. Courses Related to the Major', 9, [
      choose('VI. Courses Related to the Major', 3, [
        row('CLAS 2010', 'The Nature of the English Vocabulary', 3),
        row('ENGL 2310', 'English Literature from the Beginnings to 1700', 3),
        row('ENGL 2320', 'British and Irish Literature from 1700 to the Present', 3),
        row('ENGL 2330', 'American Literature from the Beginnings to 1914', 3),
        row('ENGL 2340', 'American Literature from 1914 to the Present', 3),
        row('ENGL 2400', 'Multicultural Literature in America', 3),
        row('GRMN 2300', 'Introduction to German Culture Studies', 3),
        row('ITAL 2500', 'Italian Culture', 3),
        row('LING 2100', 'The Study of Language', 3),
        row('RELI 1002', 'Religions of India, China, and Japan', 3),
        row('HIST 2600', 'East Asia in the World', 3),
        row('RUSS 2050', '20th-Century Russian Culture: The Soviet Experiment and its Aftermath', 3),
        row('WMST 1110', 'Multicultural Perspectives on Women in the United States', 3),
        row('WMST 2010', "Introduction to Women's and Gender Studies", 3),
      ]),
    ]),
    major: [
      area('Required Courses', 32, [
        all(focus(1, 'Area of Emphasis in Chinese'), [
          row('CHNS 3010', 'Advanced Chinese I', 3),
          row('CHNS 3020', 'Advanced Chinese II', 3),
          row('CHNS 4110', 'Advanced Chinese III', 3),
        ], 'A grade of C or better in major courses; at least half of them in residence.'),
        all(focus(1, 'Area of Emphasis in Chinese', 'Area VI language courses'), [
          row('CHNS 1001', 'Elementary Chinese I', 4),
          row('CHNS 1002', 'Elementary Chinese II', 4),
        ]),
        choose(focus(1, 'Area of Emphasis in Chinese', 'Asian literature or cinema'), 4, [
          row('CHNS 4001', 'Advanced Chinese III: China Today', 3),
          row('CHNS 4120', 'Readings in Literary Chinese', 3),
          row('CHNS 4500', 'Readings in Chinese Literature', 3),
          row('CMLT 3120', 'Love and Friendship in East Asia', 3),
          row('CMLT 3220', 'Women and Writing in East Asia', 3),
          row('CMLT 3280', 'East Asian Thought', 3),
          row('CMLT 3600', 'Gods, Ghosts, and Demons in East Asian Literature', 3),
          row('CMLT 3650', 'Literary Foundations of East Asian Civilization', 3),
          row('CMLT 4190', 'Buddhism and Western Literature', 3),
          row('CMLT 4220', 'East Asian Cinema', 3),
          row('CMLT 4600', 'Pre-Modern East Asian Literature', 3),
          row('CMLT 4610', 'Modern East Asian Literature', 3),
          row('CMLT 4620', 'East Asian Novel', 3),
          row('CMLT 4640', 'War in East Asian Film and Literature', 3),
          row('CMLT 4680', 'Law and Culture in East Asia', 3),
          row('CMLT 4690', 'Markets, Merchants, and the World of Trade in China', 3),
        ]),
        choose(focus(1, 'Area of Emphasis in Chinese', 'Asian culture'), 1, [
          row('ARHI 3100', 'Asian Art and Architecture', 3),
          row('CMLT 3120', 'Love and Friendship in East Asia', 3),
          row('CMLT 3180', 'Introduction to East Asian Cultures', 3),
          row('CMLT 3220', 'Women and Writing in East Asia', 3),
          row('CMLT 3280', 'East Asian Thought', 3),
          row('CMLT 3600', 'Gods, Ghosts, and Demons in East Asian Literature', 3),
          row('CMLT 3650', 'Literary Foundations of East Asian Civilization', 3),
          row('CMLT 4060', 'Global Chinese Foodways', 3),
          row('CMLT 4190', 'Buddhism and Western Literature', 3),
          row('CMLT 4680', 'Law and Culture in East Asia', 3),
          row('CMLT 4690', 'Markets, Merchants, and the World of Trade in China', 3),
          row('CMLT 4710', 'Health and Narratives in Global Asias', 3),
          row('GEOG 4740', 'Geography of East and Southeast Asia', 3),
          row('HIST 3601', 'Premodern Japan: Foundations of Culture and State', 3),
          row('HIST 3602', 'Modern Japan: From Shogun to Superpower', 3),
          row('HIST 3610', 'Imperialism in East Asia', 3),
          row('HIST 3661', "China's Imperial Age", 3),
          row('HIST 3662', 'The Chinese Renaissance', 3),
          row('HIST 3663', 'Modern China', 3),
          row('HIST 3670H', 'Introduction to Chinese Civilization (Honors)', 3),
          row('HIST 3690', 'East Asian Cities: Urban Life in Premodern and Modern China and Japan', 3),
          row('HIST 4600', 'Studies in Asian History', 3),
          row('HIST 4610', 'The World of the Samurai', 3),
          row('HIST 4620', 'The Chinese Industrial Revolution', 3),
          row('HIST 4625', 'Everyday Life in Ming China', 3),
          row('HIST 4630', 'Japan: The Golden Age of the Imperial Court', 3),
          row('HIST 4640', 'Warriors and Warlords in Medieval Japan', 3),
          row('INTL 4360', 'East Asian Politics', 3),
          row('INTL 4361', 'Chinese Politics', 3),
          row('INTL 4364', 'Politics of Japan', 3),
          row('INTL 4366', 'Southeast Asian Politics', 3),
          row('INTL 4875', 'Chinese Foreign Policy in Historical Perspective', 3),
          row('KREN 4010', 'Special Topics in Korean Film', 3),
          row('PHIL 3040', 'Asian Philosophies', 3),
          row('PHIL 4045', 'Chinese Philosophy', 3),
          row('RELI 3300', 'Introduction to East Asian Religions', 3),
          row('RELI 4401', 'The Buddhist Tradition', 3),
          row('RELI 4402', 'Confucianism and Chinese Tradition', 3),
          row('RELI 4403', 'The Taoist Tradition', 3),
          row('RELI 4404', 'Japanese Religion', 3),
          row('RELI 4405', 'Buddhist Ritual Practices', 3),
          row('RELI 4406', 'The Hindu Tradition', 3),
          row('RELI 4407', 'East Asian Buddhism', 3),
          row('RELI 4910', 'Topics and Problems in Religions of India, China, and Japan', 3),
          row('THEA 4400', 'Asian Theatre and Drama', 3),
        ]),
        all(focus(2, 'Area of Emphasis in Japanese'), [
          row('JPNS 3010', 'Advanced Japanese I', 3),
          row('JPNS 3020', 'Advanced Japanese II', 3),
          row('JPNS 4110', 'Advanced Japanese III', 3),
        ], 'A grade of C or better in major courses; at least half of them in residence.'),
        all(focus(2, 'Area of Emphasis in Japanese', 'Area VI language courses'), [
          row('JPNS 1001', 'Elementary Japanese I', 4),
          row('JPNS 1002', 'Elementary Japanese II', 4),
        ]),
        choose(focus(2, 'Area of Emphasis in Japanese', 'Asian literature or cinema'), 4, [
          row('CMLT 3120', 'Love and Friendship in East Asia', 3),
          row('CMLT 3220', 'Women and Writing in East Asia', 3),
          row('CMLT 3280', 'East Asian Thought', 3),
          row('CMLT 3600', 'Gods, Ghosts, and Demons in East Asian Literature', 3),
          row('CMLT 3650', 'Literary Foundations of East Asian Civilization', 3),
          row('CMLT 4190', 'Buddhism and Western Literature', 3),
          row('CMLT 4220', 'East Asian Cinema', 3),
          row('CMLT 4600', 'Pre-Modern East Asian Literature', 3),
          row('CMLT 4610', 'Modern East Asian Literature', 3),
          row('CMLT 4620', 'East Asian Novel', 3),
          row('CMLT 4640', 'War in East Asian Film and Literature', 3),
          row('CMLT 4680', 'Law and Culture in East Asia', 3),
          row('JPNS 4500', 'Readings in Japanese Literature', 3),
        ]),
        choose(focus(2, 'Area of Emphasis in Japanese', 'Asian culture'), 1, [
          row('ARHI 3100', 'Asian Art and Architecture', 3),
          row('CMLT 3120', 'Love and Friendship in East Asia', 3),
          row('CMLT 3180', 'Introduction to East Asian Cultures', 3),
          row('CMLT 3220', 'Women and Writing in East Asia', 3),
          row('CMLT 3223', 'Contemporary Japanese Culture', 3),
          row('CMLT 3280', 'East Asian Thought', 3),
          row('CMLT 3600', 'Gods, Ghosts, and Demons in East Asian Literature', 3),
          row('CMLT 3650', 'Literary Foundations of East Asian Civilization', 3),
          row('CMLT 4190', 'Buddhism and Western Literature', 3),
          row('CMLT 4680', 'Law and Culture in East Asia', 3),
          row('CMLT 4690', 'Markets, Merchants, and the World of Trade in China', 3),
          row('GEOG 4740', 'Geography of East and Southeast Asia', 3),
          row('HIST 3601', 'Premodern Japan: Foundations of Culture and State', 3),
          row('HIST 3602', 'Modern Japan: From Shogun to Superpower', 3),
          row('HIST 3610', 'Imperialism in East Asia', 3),
          row('HIST 3661', "China's Imperial Age", 3),
          row('HIST 3662', 'The Chinese Renaissance', 3),
          row('HIST 3663', 'Modern China', 3),
          row('HIST 3670H', 'Introduction to Chinese Civilization (Honors)', 3),
          row('HIST 3690', 'East Asian Cities: Urban Life in Premodern and Modern China and Japan', 3),
          row('HIST 4600', 'Studies in Asian History', 3),
          row('HIST 4610', 'The World of the Samurai', 3),
          row('HIST 4620', 'The Chinese Industrial Revolution', 3),
          row('HIST 4625', 'Everyday Life in Ming China', 3),
          row('HIST 4630', 'Japan: The Golden Age of the Imperial Court', 3),
          row('HIST 4640', 'Warriors and Warlords in Medieval Japan', 3),
          row('INTL 4360', 'East Asian Politics', 3),
          row('INTL 4361', 'Chinese Politics', 3),
          row('KREN 4010', 'Special Topics in Korean Film', 3),
          row('INTL 4364', 'Politics of Japan', 3),
          row('INTL 4366', 'Southeast Asian Politics', 3),
          row('INTL 4875', 'Chinese Foreign Policy in Historical Perspective', 3),
          row('PHIL 3040', 'Asian Philosophies', 3),
          row('PHIL 4045', 'Chinese Philosophy', 3),
          row('RELI 3300', 'Introduction to East Asian Religions', 3),
          row('RELI 4401', 'The Buddhist Tradition', 3),
          row('RELI 4402', 'Confucianism and Chinese Tradition', 3),
          row('RELI 4403', 'The Taoist Tradition', 3),
          row('RELI 4404', 'Japanese Religion', 3),
          row('RELI 4405', 'Buddhist Ritual Practices', 3),
          row('RELI 4406', 'The Hindu Tradition', 3),
          row('RELI 4407', 'East Asian Buddhism', 3),
          row('RELI 4910', 'Topics and Problems in Religions of India, China, and Japan', 3),
          row('THEA 4400', 'Asian Theatre and Drama', 3),
        ]),
        all(focus(3, 'Area of Emphasis in Korean'), [
          row('KREN 3001', 'Advanced Korean I', 3),
          row('KREN 3002', 'Advanced Korean II', 3),
          row('KREN 4001', 'Business Korean', 3),
        ], 'A grade of C or better in major courses; at least half of them in residence.'),
        all(focus(3, 'Area of Emphasis in Korean', 'Area VI language courses'), [
          row('KREN 1001', 'Elementary Korean I', 4),
          row('KREN 1002', 'Elementary Korean II', 4),
        ]),
        choose(focus(3, 'Area of Emphasis in Korean', 'Asian literature or cinema'), 4, [
          row('CMLT 3120', 'Love and Friendship in East Asia', 3),
          row('CMLT 3130', 'Korean Culture through Film', 3),
          row('CMLT 3180', 'Introduction to East Asian Cultures', 3),
          row('CMLT 3220', 'Women and Writing in East Asia', 3),
          row('CMLT 3280', 'East Asian Thought', 3),
          row('CMLT 3600', 'Gods, Ghosts, and Demons in East Asian Literature', 3),
          row('CMLT 3650', 'Literary Foundations of East Asian Civilization', 3),
          row('CMLT 4190', 'Buddhism and Western Literature', 3),
          row('CMLT 4220', 'East Asian Cinema', 3),
          row('CMLT 4600', 'Pre-Modern East Asian Literature', 3),
          row('CMLT 4610', 'Modern East Asian Literature', 3),
          row('CMLT 4620', 'East Asian Novel', 3),
          row('CMLT 4640', 'War in East Asian Film and Literature', 3),
          row('CMLT 4680', 'Law and Culture in East Asia', 3),
          row('KREN 4002', 'Business Korean II', 3),
          row('KREN 4010', 'Special Topics in Korean Film', 3),
        ]),
        choose(focus(3, 'Area of Emphasis in Korean', 'Asian culture'), 1, [
          row('ARHI 3100', 'Asian Art and Architecture', 3),
          row('CMLT 3120', 'Love and Friendship in East Asia', 3),
          row('CMLT 3180', 'Introduction to East Asian Cultures', 3),
          row('CMLT 3220', 'Women and Writing in East Asia', 3),
          row('CMLT 3280', 'East Asian Thought', 3),
          row('CMLT 3600', 'Gods, Ghosts, and Demons in East Asian Literature', 3),
          row('CMLT 3650', 'Literary Foundations of East Asian Civilization', 3),
          row('CMLT 4190', 'Buddhism and Western Literature', 3),
          row('CMLT 4680', 'Law and Culture in East Asia', 3),
          row('CMLT 4690', 'Markets, Merchants, and the World of Trade in China', 3),
          row('GEOG 4740', 'Geography of East and Southeast Asia', 3),
          row('HIST 3601', 'Premodern Japan: Foundations of Culture and State', 3),
          row('HIST 3602', 'Modern Japan: From Shogun to Superpower', 3),
          row('HIST 3610', 'Imperialism in East Asia', 3),
          row('HIST 3661', "China's Imperial Age", 3),
          row('HIST 3662', 'The Chinese Renaissance', 3),
          row('HIST 3663', 'Modern China', 3),
          row('HIST 3670H', 'Introduction to Chinese Civilization (Honors)', 3),
          row('HIST 3690', 'East Asian Cities: Urban Life in Premodern and Modern China and Japan', 3),
          row('HIST 4600', 'Studies in Asian History', 3),
          row('HIST 4610', 'The World of the Samurai', 3),
          row('HIST 4620', 'The Chinese Industrial Revolution', 3),
          row('HIST 4625', 'Everyday Life in Ming China', 3),
          row('HIST 4630', 'Japan: The Golden Age of the Imperial Court', 3),
          row('HIST 4640', 'Warriors and Warlords in Medieval Japan', 3),
          row('INTL 4360', 'East Asian Politics', 3),
          row('INTL 4361', 'Chinese Politics', 3),
          row('INTL 4364', 'Politics of Japan', 3),
          row('INTL 4366', 'Southeast Asian Politics', 3),
          row('INTL 4875', 'Chinese Foreign Policy in Historical Perspective', 3),
          row('KREN 4000S', 'Internship in Korea', 3),
          row('KREN 4010', 'Special Topics in Korean Film', 3),
          row('KREN 4011', 'Modern Korean Fiction', 3),
          row('PHIL 3040', 'Asian Philosophies', 3),
          row('PHIL 4045', 'Chinese Philosophy', 3),
          row('RELI 3300', 'Introduction to East Asian Religions', 3),
          row('RELI 4401', 'The Buddhist Tradition', 3),
          row('RELI 4402', 'Confucianism and Chinese Tradition', 3),
          row('RELI 4403', 'The Taoist Tradition', 3),
          row('RELI 4404', 'Japanese Religion', 3),
          row('RELI 4405', 'Buddhist Ritual Practices', 3),
          row('RELI 4406', 'The Hindu Tradition', 3),
          row('RELI 4407', 'East Asian Buddhism', 3),
          row('RELI 4910', 'Topics and Problems in Religions of India, China, and Japan', 3),
          row('THEA 4400', 'Asian Theatre and Drama', 3),
        ]),
      ]),
      // 36 hours, and Area VI's last hour.
      generalElectives(37, 12),
    ],
  },
  /*
   * Fashion Merchandising BSFCS (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/48680): Major Electives (24 hours) are
   * one area of emphasis, Fashion Brand Management or Product Development
   * and Design, with 9 hours of professional electives; the reading left
   * the emphasis optional and the area off every board.
   */
  '48680': {
    major: [
      area('Required Courses', 32, [
        all('Required Courses', [
          row('FACS 2000', 'Introduction to Family and Consumer Sciences', 1),
          row('TXMI 3210', 'Fundamentals of Fashion Merchandising', 3),
          row('TXMI 3240', 'Retail Planning and Buying', 3),
          row('TXMI 3500', 'Textiles', 3),
          row('TXMI 3520', 'Textile Testing', 2),
          row('TXMI 3520L', 'Textile Testing Laboratory', 1),
          row('TXMI 3530', 'Apparel Quality Analysis', 3),
          row('TXMI 4230', 'Dress, Society, and Culture', 3),
          row('TXMI 4260', 'Global Sourcing and Logistics of Textile Products and Apparel', 3),
          row('TXMI 4290', 'History of Dress and Fashion: Nineteenth Century to the Present', 3),
          row('TXMI 4520', 'Apparel and Textile Economics', 3),
          row('TXMI 5900', 'Professional Development for the Fashion Industry', 1),
        ]),
        choose('Internship or capstone', 1, [
          row('TXMI 5910', 'Textiles, Merchandising and Interiors Internship', 3),
          row('TXMI 5950', 'Fashion Merchandising Capstone', 3),
        ]),
      ]),
      area('Major Electives', 24, [
        // A choice of every course listed: a list with no number to choose, in an area of electives, is read as hours to draw from.
        choose(focus(1, 'Area of Emphasis in Fashion Brand Management'), 5, [
          row('TXMI 4210', 'Trend Analysis and Forecasting', 3),
          row('TXMI 4240', 'Fashion Promotion and Visual Merchandising', 3),
          row('TXMI 5220', 'Fashion Product and Brand Management', 3),
          row('TXMI 5240', 'Retailing Apparel and Textiles', 3),
          row('TXMI 5540', 'Retail Analytics and Applications', 3),
        ]),
        hoursFrom(focus(1, 'Area of Emphasis in Fashion Brand Management', 'professional electives'), 9, [
          row('FACS 5711', 'Study Tour in Family and Consumer Sciences', 3),
          row('FACS 5910', 'Internship in Family and Consumer Sciences', 3),
          row('FACS 5915', 'International Internship in Family and Consumer Sciences', 3),
          row('FACS 5950', 'International Study in Family and Consumer Sciences', 3),
          row('TXMI 3220', 'Fashion Ethics and Sustainability', 3),
          row('TXMI 3230', 'Popular Culture and Fashion', 3),
          row('TXMI 3540', 'CAD for Apparel Design and Production', 3),
          row('TXMI 4160', 'Product Development in the Textile and Apparel Industries', 3),
          row('TXMI 4250', 'Survey of Apparel and Soft Goods Manufacturing', 3),
          row('TXMI 4270', 'History of Dress: Antiquity to Nineteenth Century', 3),
          row('TXMI 4280', 'Apparel Design Studio', 3),
          row('TXMI 4400', 'Entrepreneurship for Product Development', 3),
          row('TXMI 4640', 'Virtual Garment Prototyping', 3),
          row('TXMI 4900', 'Special Topics in Textiles, Merchandising and Interiors', 3),
          row('TXMI 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('TXMI 5260', 'Case Studies in the Retail Industry', 3),
          row('TXMI 5270', 'UX/UI Design Fundamentals in Fashion Branding', 3),
          row('TXMI 5280', 'Retail Entrepreneurship', 4),
          row('TXMI 5640', 'Textile Design and Fabrication', 3),
          row('TXMI 5710', 'Study Tour in Textiles, Merchandising and Interiors', 3),
          row('TXMI 5720', 'Social Entrepreneurship and Product Development in Ghana', 3),
          row('TXMI 5850', 'Museum Introduction in Clothing and Textiles', 3),
          row('TXMI 5910', 'Textiles, Merchandising and Interiors Internship', 3),
          row('TXMI 5950', 'Fashion Merchandising Capstone', 3),
        ], 'TXMI 5910 and 5950 if not taken in Required Courses; courses approved for a minor or certificate also count.'),
        choose(focus(2, 'Area of Emphasis in Product Development and Design'), 5, [
          row('TXMI 3540', 'CAD for Apparel Design and Production', 3),
          row('TXMI 3640', 'Digital Apparel Design and Development Applications', 3),
          row('TXMI 4160', 'Product Development in the Textile and Apparel Industries', 3),
          row('TXMI 4250', 'Survey of Apparel and Soft Goods Manufacturing', 3),
          row('TXMI 4280', 'Apparel Design Studio', 3),
        ], 'A high-demand emphasis: apply with a UGA GPA of 2.0 or higher and TXMI 2010 and TXMI 3210 at B- or higher.'),
        hoursFrom(focus(2, 'Area of Emphasis in Product Development and Design', 'professional electives'), 9, [
          row('FACS 5711', 'Study Tour in Family and Consumer Sciences', 3),
          row('FACS 5910', 'Internship in Family and Consumer Sciences', 3),
          row('FACS 5915', 'International Internship in Family and Consumer Sciences', 3),
          row('FACS 5950', 'International Study in Family and Consumer Sciences', 3),
          row('TXMI 3230', 'Popular Culture and Fashion', 3),
          row('TXMI 3640', 'Digital Apparel Design and Development Applications', 3),
          row('TXMI 4210', 'Trend Analysis and Forecasting', 3),
          row('TXMI 4240', 'Fashion Promotion and Visual Merchandising', 3),
          row('TXMI 4270', 'History of Dress: Antiquity to Nineteenth Century', 3),
          row('TXMI 4400', 'Entrepreneurship for Product Development', 3),
          row('TXMI 4640', 'Virtual Garment Prototyping', 3),
          row('TXMI 4900', 'Special Topics in Textiles, Merchandising and Interiors', 3),
          row('TXMI 5220', 'Fashion Product and Brand Management', 3),
          row('TXMI 5240', 'Retailing Apparel and Textiles', 3),
          row('TXMI 5260', 'Case Studies in the Retail Industry', 3),
          row('TXMI 5270', 'UX/UI Design Fundamentals in Fashion Branding', 3),
          row('TXMI 5280', 'Retail Entrepreneurship', 4),
          row('TXMI 5540', 'Retail Analytics and Applications', 3),
          row('TXMI 5640', 'Textile Design and Fabrication', 3),
          row('TXMI 5710', 'Study Tour in Textiles, Merchandising and Interiors', 3),
          row('TXMI 5720', 'Social Entrepreneurship and Product Development in Ghana', 3),
          row('TXMI 5850', 'Museum Introduction in Clothing and Textiles', 3),
          row('TXMI 5910', 'Textiles, Merchandising and Interiors Internship', 3),
          row('TXMI 5950', 'Fashion Merchandising Capstone', 3),
        ], 'TXMI 5910 and 5950 if not taken in Required Courses; courses approved for a minor or certificate also count.'),
      ]),
    ],
  },
  /*
   * Science Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/79643): Required Courses (55-59 hours)
   * are the ESCI sequence and one area of emphasis (Biology, Chemistry,
   * Earth Science or Physics, Biology with its two major electives); the
   * reading left the emphasis optional (a board had no science content) and
   * booked the school-based internship (ESCI 5460, 12 hours) at 1.
   */
  '79643': {
    major: [
      area('Required Courses', 55, [
        all('Required Courses', [
          row('ESCI 3450', 'Practicum in Science Education', 3),
          row('ESCI 4450', 'Science Curriculum and Learning', 3),
          row('ESCI 4460', 'Methods of Science Teaching', 3),
          row('ESCI 4480', 'Technological Capabilities for Science Teaching', 3),
          row('ESCI 5460', 'Science Education School-Based Internship', 12),
          row('ESCI 5470', 'Reflection on Science Teaching', 3),
        ], 'Entering the professional sequence asks for Core Areas I-V, a 2.8 GPA, the Area VI chemistry (or MATH 2260), physics, EDUC 2120 and EDUC 2130 at C or higher, and EDSE 4030 at B or higher.'),
        all(focus(1, 'Area of Emphasis in Biology'), [
          row('BIOL 1108', 'Principles of Biology II', 3),
          lab('BIOL 1108L', 'Principles of Biology II Laboratory', 1),
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('CHEM 2211', 'Modern Organic Chemistry I', 3),
          lab('CHEM 2211L', 'Modern Organic Chemistry Laboratory I', 1),
          row('ECOL 3500', 'Ecology', 3),
          lab('ECOL 3500L', 'Ecology Laboratory', 1),
          row('GENE 3000', 'Evolutionary Biology', 4),
          row('GENE 3200', 'Genetics', 4),
        ]),
        fromLists(hoursFromLists(focus(1, 'Area of Emphasis in Biology', 'Major Electives'), 6, {
          'List A (Laboratory Courses)': [
            row('BIOL 3110L', 'Applied Laboratory Research Techniques', 4),
            row('BIOL 4960', 'Undergraduate Research in Biology', 4),
            row('BTEC 4000L', 'Methods in Biotechnology', 4),
            row('CBIO 2200', 'Anatomy and Physiology I', 4),
            row('CBIO 2210', 'Anatomy and Physiology II', 4),
            row('CBIO 3000', 'Comparative Vertebrate Anatomy', 4),
            row('CBIO 3200L', 'Medical Anatomy', 3),
            row('CBIO 3410L', 'Laboratory in Cellular and Developmental Biology', 4),
            row('CBIO 4600', 'Biology of Protists', 3),
            lab('CBIO 4600L', 'Biology of Protists Laboratory', 1),
            row('ECOL 4010', 'Ecosystem Ecology', 3),
            row('ECOL 4050', 'Ichthyology', 4),
            row('ECOL 4070', 'Invertebrate Biology and Ecology', 4),
            row('ECOL 4150', 'Population Biology of Infectious Diseases', 4),
            row('ECOL 4225', 'Methods in Marine Ecology', 4),
            row('ECOL 4310', 'Freshwater Ecosystems', 3),
            lab('ECOL 4310L', 'Freshwater Ecosystems Lab', 1),
            row('ECOL 4330', 'Tropical Marine Invertebrates', 4),
            row('EHSC 4310', 'Environmental Microbiology', 4),
            row('ENTO 3140', 'Insect Natural History', 4),
            row('ENTO 3650', 'Medical Entomology', 3),
            lab('ENTO 3650L', 'Medical Entomology Lab', 1),
            row('ENTO 4000', 'General Entomology', 4),
            row('ENTO 4750', 'Forensic Entomology', 4),
            row('ENTO 5730', 'Entomology for Educators', 3),
            row('FANR 3200W', 'Ecology of Natural Resources', 3),
            lab('FANR 3200L', 'Ecology of Natural Resources Laboratory', 1),
            row('FDST 4120', 'Food Fermentations', 3),
            row('FISH 4200', 'Aquatic Biology', 3),
            lab('FISH 4200L', 'Aquatic Biology Lab', 1),
            row('FISH 4300', 'Environmental Biology of Fishes', 3),
            lab('FISH 4300L', 'Environmental Biology of Fishes Laboratory', 1),
            row('FISH 4500', 'Fish Physiology', 3),
            lab('FISH 4500L', 'Fish Physiology Lab', 1),
            row('GENE 3210L', 'Experimental Genetics', 3),
            row('GENE 4210L', 'Experimental Molecular Genetics Laboratory', 3),
            row('MARS 3450', 'Marine Biology', 3),
            lab('MARS 3450L', 'Marine Biology Laboratory', 1),
            row('MIBO 3000', 'Introductory Applied Microbiology', 4),
            row('MIBO 3510L', 'Introductory Microbiology Laboratory II', 3),
            row('MIBO 4450', 'Microbial Genetics and Genomics', 4),
            row('MIBO 4600L', 'Experimental Microbiology Laboratory', 4),
            row('PATH 3530', 'Introductory Plant Pathology', 3),
            row('PATH 4200', 'Mycology', 4),
            row('PATH 4400', 'Plant Pathology for Teachers', 3),
            row('PBIO 3660L', 'Plant Biology Intensive Laboratory', 4),
            row('PBIO 3700', 'Advanced Topics in Plant Biology', 3),
            row('PBIO 4650', 'Plant Biodiversity', 4),
            row('POUL 4200', 'Avian Anatomy and Physiology', 4),
            row('WILD 3580', 'Vertebrate Natural History', 3),
            lab('WILD 3580L', 'Vertebrate Natural History Laboratory', 1),
            row('WILD 4040', 'Herpetology', 4),
            row('WILD 4050', 'Mammalogy', 3),
            lab('WILD 4050L', 'Mammalogy Laboratory', 1),
            row('WILD 4060', 'Ornithology', 4),
            row('WILD 5700', 'Applied Population Dynamics', 2),
            lab('WILD 5700L', 'Applied Population Dynamics Lab', 1),
          ],
          'List B (Non-Laboratory Courses)': [
            row('ADSC 3130', 'Animal Biotechnology', 3),
            row('ADSC 3300', 'Animal Nutrition and Metabolism', 3),
            row('ADSC 3400', 'Physiology of Reproduction in Domestic Animals', 3),
            row('ANTH 4261', 'Museum of Natural History Internship', 3),
            row('BCMB 3433', 'Biology for Medicine', 4),
            row('BCMB 3600', 'Genomics and Bioinformatics', 3),
            row('BCMB 4010', 'Biochemistry and Molecular Biology I', 4),
            row('BCMB 4020', 'Biochemistry and Molecular Biology II', 3),
            row('BCMB 4120', 'Human Biochemistry and Disease', 4),
            row('BCMB 4200', 'Biotechnology', 3),
            row('BIOL 3910', 'Topics in Biology', 3),
            row('CBIO 3275', 'Medical Endocrinology', 3),
            row('CBIO 3400', 'Cell Biology', 4),
            row('CBIO 3600', 'Developmental Biology', 4),
            row('CBIO 3800', 'Neurobiology', 4),
            row('CBIO 4100', 'Immunology', 4),
            row('CBIO 4500', 'Medical Parasitology', 3),
            row('ECOL 3220', 'Biology and Conservation of Marine Mammals', 3),
            row('ECOL 3530', 'Conservation Biology', 3),
            row('ECOL 4540', 'Behavioral Ecology', 3),
            row('ECOL 4600', 'Ecotoxicology', 3),
            row('ENTO 3645', 'Medical Entomology Lecture', 3),
            row('EPID 4070', 'Fundamentals of Epidemiology', 3),
            row('FANR 3200W', 'Ecology of Natural Resources', 3),
            row('GENE 4200', 'Advanced Genetics', 3),
            row('HORT 3440', 'Herbs, Spices, and Medicinal Plants', 3),
            row('IDIS 3100', 'People, Parasites, and Plagues', 3),
            row('KINS 3700', 'Applied Exercise Physiology', 3),
            row('KINS 4300', 'Exercise Epidemiology', 3),
            row('MIBO 3500', 'Introductory Microbiology', 3),
            row('MIBO 4090', 'Prokaryotic Biology', 4),
            row('MIBO 4220', 'Pathogenic Bacteriology', 3),
            row('MIBO 4500', 'Bacterial Symbioses', 3),
            row('MIBO 4700', 'Medical Mycology', 3),
            row('NUTR 5040', 'Nutritional Epidemiology', 3),
            row('PATH 3010', 'Fungi: Friends and Foes', 3),
            row('PBIO 3400', 'Plants and Society', 3),
            row('PBIO 3600', 'Plant Cell and Developmental Biology', 4),
            row('PBIO 3650', 'Plant Ecology', 4),
            row('PBIO 4500', 'Introduction to Gene Technology', 3),
            row('PBIO 4510', 'Genome Evolution Across the Tree of Life', 3),
            row('POPH 4650', 'Introduction to Virology', 3),
            row('POUL 4060', 'Reproductive Endocrinology', 3),
            row('VPHY 3100', 'Elements of Physiology', 3),
            row('WILD 4400', 'Wildlife Physiology and Nutrition', 3),
            row('WILD 4740', 'Animal Behavior', 3),
            row('WILD 5100', 'Principles and Management of Wildlife Diseases', 3),
          ],
        }, 'Two courses from List A, or one from List A and one from List B.'), 1, 'At least one course from List A (Laboratory Courses).', 'List A (Laboratory Courses)'),
        all(focus(2, 'Area of Emphasis in Chemistry'), [
          row('CHEM 2211', 'Modern Organic Chemistry I', 3),
          lab('CHEM 2211L', 'Modern Organic Chemistry Laboratory I', 1),
          row('CHEM 2212', 'Modern Organic Chemistry II', 3),
          lab('CHEM 2212L', 'Modern Organic Chemistry Laboratory II', 1),
          row('CHEM 2300', 'Quantitative Analytical Chemistry', 3),
          lab('CHEM 2300L', 'Quantitative Analytical Chemistry Laboratory', 1),
          row('CHEM 3110', 'Fundamentals of Physical Chemistry', 3),
          row('MATH 2260', 'Calculus II for Science and Engineering', 4),
          row('PHYS 1212', 'Principles of Physics for Scientists and Engineers-Electricity and Magnetism, Optics, Modern Physics', 4),
        ]),
        choose(focus(2, 'Area of Emphasis in Chemistry', 'biochemistry or experimental methods'), 1, [
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('CHEM 3511', 'Experimental Methods I', 3),
        ]),
        choose(focus(2, 'Area of Emphasis in Chemistry', 'upper-level chemistry'), 1, [
          row('CHEM 3300', 'Modern Instrumental Methods of Analysis', 3),
          row('CHEM 3400', 'Modern Inorganic Chemistry', 3),
          ...levels('CHEM', 3),
        ], 'CHEM 3300, CHEM 3400 or another CHEM course at the 3000 level or above.'),
        all(focus(3, 'Area of Emphasis in Earth Science'), [
          row('GEOG 1112', 'Introduction to Weather and Climate', 3),
          lab('GEOG 1112L', 'Introduction to Weather and Climate Laboratory', 1),
        ]),
        oneGroup(focus(3, 'Area of Emphasis in Earth Science', 'astronomy or physics'), 4, [
          [row('ASTR 1010', 'Astronomy of the Solar System', 3), lab('ASTR 1010L', 'Astronomy of the Solar System Laboratory', 1)],
          [row('ASTR 1020', 'Stellar and Galactic Astronomy', 3), lab('ASTR 1020L', 'Stellar and Galactic Astronomy Laboratory', 1)],
          [row('PHYS 1112', 'Introductory Physics-Electricity and Magnetism, Optics, Modern Physics', 4)],
        ], 'Choose 1 course (with its lab).'),
        oneGroup(focus(3, 'Area of Emphasis in Earth Science', 'physical geology'), 4, [
          [row('GEOL 1121', 'Earth Processes and Environments', 3), lab('GEOL 1121L', 'Earth Processes and Environments Laboratory', 1)],
          [row('GEOL 1250', 'Physical Geology', 4)],
        ], 'Choose 1 course (with its lab).'),
        oneGroup(focus(3, 'Area of Emphasis in Earth Science', 'earth history'), 4, [
          [row('GEOL 1122', 'Earth’s History of Life and Global Change', 3), lab('GEOL 1122L', "Earth's History of Global Change Laboratory", 1)],
          [row('GEOL 1260', 'Foundations of Earth Systems History: Life, Climate, & Environmental Change', 4)],
        ], 'Choose 1 course (with its lab).'),
        choose(focus(3, 'Area of Emphasis in Earth Science', 'earth science course'), 1, [
          row('GEOL 1001', 'Natural Hazards', 3),
          row('ATSC 3110', 'Climatology', 3),
          row('GEOG 3010', 'General Geomorphology', 3),
          row('GEOL 3090', 'Gems and Gem Materials', 3),
          row('GEOL 3130', 'National Parks of the Western United States', 3),
          row('GEOL 3350', 'Dinosaurs - Lifestyles of the Big and Famous in the Mesozoic', 3),
        ]),
        hoursFrom(focus(3, 'Area of Emphasis in Earth Science', 'upper-level geology'), 9, [
          row('GEOL 3010', 'Earth Materials', 4),
          row('GEOL 3020', 'Surficial and Near-Surficial Processes', 4),
          row('GEOL 4010', 'Life and Ecologies of the Past', 3),
          row('GEOL 4020', 'Internal Earth Processes', 3),
          row('MARS 4100', 'Geological and Physical Oceanography', 3),
        ], 'Choose a minimum of 9 hours.'),
        all(focus(4, 'Area of Emphasis in Physics'), [
          row('MATH 2500', 'Accelerated Calculus III for Engineering Students', 3),
          row('MATH 2700', 'Elementary Differential Equations', 3),
          row('PHYS 1212', 'Principles of Physics for Scientists and Engineers-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 3700', 'Modern Physics', 3),
        ]),
        choose(focus(4, 'Area of Emphasis in Physics', 'five more courses'), 5, [
          row('CHEM 1212', 'General Chemistry II', 3),
          lab('CHEM 1212L', 'General Chemistry Laboratory II', 1),
          row('PHYS 3330', 'Modern Optics', 3),
          row('PHYS 3900', 'Mathematical Methods in Physics', 3),
          row('PHYS 4101', 'Theoretical Mechanics I', 3),
          row('PHYS 4201', 'Electricity and Magnetism I', 3),
          row('PHYS 4300', 'Thermodynamics and Kinetic Theory', 3),
          row('PHYS 4510', 'Introduction to Magnetic Resonance Imaging', 3),
          row('PHYS 4800', 'Introduction to Nanotechnology', 3),
          row('PHYS 4900', 'Special Topics in Physics', 3),
        ]),
      ]),
      generalElectives(1),
    ],
  },
  /*
   * English Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/20130): the degree total ("Total Major
   * Hours (120)") was not read, so boards planned 96 hours; Major Electives
   * (21 hours: British, American, world literature, language study and
   * three more) were lost; student teaching (LLED 5465) is 12 hours, not 3.
   * The Area of Emphasis in Educational Studies takes the place of LLED
   * 4240 and 5465 and does not lead to certification: one choice with the
   * certification path. LLED 3400 is an entrance requirement and EDUC 2140
   * a program completion requirement for certification; neither was on a
   * board.
   */
  '20130': {
    total: 120,
    major: [
      area('Entrance Requirements', 3, [
        all('Entrance Requirements', [
          row('LLED 3400', 'Current Issues in Secondary English Education', 3),
        ], 'By the start of the first semester of major coursework; with Core Areas I-V, two ENGL/CMLT 2000-level courses, EDUC 2130 and EDUC 2110, and a 3.0 GPA.'),
      ]),
      area('Required Courses', 39, [
        all('Required Courses', [
          row('LLED 4200', 'Methods in Teaching English Education I', 3),
          row('LLED 4210', 'English Education Practicum Seminar I', 3),
          row('LLED 4215', 'Practicum II Field Experience in Secondary English Education', 3),
          row('LLED 4220', 'Methods in Teaching English Education II', 3),
          row('LLED 4230', 'English Education Practicum Seminar II', 3),
          row('LLED 4250S', 'Service Learning in Secondary English Education', 3),
          row('LLED 4400', 'Planning Instruction in Secondary English Education', 3),
          row('LLED 4410', 'Adolescent and Young Adult Literature for a Changing World', 3),
        ], 'A grade of C or better. LLED 4250S before the first semester of the program.'),
        all(focus(1, 'Teacher Certification'), [
          row('LLED 4240', 'English Education Practicum Seminar III', 3),
          row('LLED 5465', 'Student Teaching in Secondary English Education', 12),
          row('EDUC 2140', 'Foundations of Reading', 3),
        ], 'EDUC 2140 (C or better) is a program completion requirement for teacher certification.'),
        all(focus(2, 'Educational Studies in English Education'), [
          row('LLED 4000', 'Directed Study in Language and Literacy Education', 3),
          row('LLED 4045', 'Special Topics in Language and Literacy Education', 3),
        ], 'In place of LLED 4240 and LLED 5465; does not lead to teacher certification.'),
        choose(focus(2, 'Educational Studies in English Education', 'education courses'), 2, [
          row('EPSY 3010', 'Child and Adolescent Development for Education', 3),
          row('EPSY 4000', 'Independent Study in Educational Psychology', 3),
          row('EPSY 4010', 'Research-Based Experiences in Educational Psychology', 3),
          row('EPSY 4061', 'Motivational Foundations for Education', 3),
          row('ETAP 4000', 'Issues in Education Theory and Practice', 3),
          row('ETAP 4515', 'History of African American Education', 3),
          row('LLED 5040', 'Language and Culture in the Classroom', 3),
        ]),
        hoursFrom(focus(2, 'Educational Studies in English Education', 'a third course'), 3, [
          row('EPSY 3010', 'Child and Adolescent Development for Education', 3),
          row('EPSY 4000', 'Independent Study in Educational Psychology', 3),
          row('EPSY 4010', 'Research-Based Experiences in Educational Psychology', 3),
          row('EPSY 4061', 'Motivational Foundations for Education', 3),
          row('ETAP 4000', 'Issues in Education Theory and Practice', 3),
          row('ETAP 4515', 'History of African American Education', 3),
          row('LLED 5040', 'Language and Culture in the Classroom', 3),
          ANY_UPPER_COURSE,
        ], 'A third course from the list above, or another relevant course at the 3000 level or above the advisor approves.'),
      ]),
      area('Major Electives', 21, [
        choose('Shakespeare or British Literature Requirement', 1, [
          row('ENGL 4210', 'Old English Literature', 3),
          row('ENGL 4220', 'Beowulf', 3),
          row('ENGL 4230', 'Medieval Literature, 1350-1500', 3),
          row('ENGL 4240', 'Chaucer', 3),
          row('ENGL 4270', 'Medieval Romance', 3),
          row('ENGL 4290', 'Topics in Medieval Literature', 3),
          row('ENGL 4295', 'Topics in Celtic Studies', 3),
          row('ENGL 4300', 'Elizabethan Poetry', 3),
          row('ENGL 4320', 'Shakespeare I: Selected Works', 3),
          row('ENGL 4330', 'Shakespeare II: Special Topics', 3),
          row('ENGL 4331', 'Shakespeare on Film', 3),
          row('ENGL 4332', 'Shakespeare and Media', 3),
          row('ENGL 4333E', 'Shakespeare in the Eighteenth Century', 3),
          row('ENGL 4334', 'Shakespeare through Multicultural American Literature and Performance', 3),
          row('ENGL 4335S', 'Shakespeare in the Classroom: Service-Learning', 3),
          row('ENGL 4340', 'Renaissance Drama', 3),
          row('ENGL 4350', 'Seventeenth-Century Poetry', 3),
          row('ENGL 4370', 'Milton', 3),
          row('ENGL 4390', 'Topics in Renaissance Literature', 3),
          row('ENGL 4400', 'Restoration and Eighteenth-Century English Drama', 3),
          row('ENGL 4420', 'Early Eighteenth-Century Prose and Poetry', 3),
          row('ENGL 4430', 'The Eighteenth-Century English Novel', 3),
          row('ENGL 4440', 'The Age of Johnson', 3),
          row('ENGL 4450', 'The Global Eighteenth Century', 3),
          row('ENGL 4460', 'Women in the Eighteenth Century', 3),
          row('ENGL 4480', 'Scottish Literature of the Eighteenth Century', 3),
          row('ENGL 4490', 'Topics in Eighteenth-Century Literature', 3),
          row('ENGL 4491', 'The Eighteenth Century on Film', 4),
          row('ENGL 4500', 'Romantic Literature', 3),
          row('ENGL 4501', 'Romantic Circles', 3),
          row('ENGL 4505', 'Single Author Study: Jane Austen', 3),
          row('ENGL 4510', 'Nineteenth-Century British Prose', 3),
          row('ENGL 4520', 'The Nineteenth-Century British Novel', 3),
          row('ENGL 4525W', 'Charles Dickens', 3),
          row('ENGL 4530', 'Victorian Literature', 3),
          row('ENGL 4540', 'Victorian Poetry', 3),
          row('ENGL 4550', 'Britain, Empire, and the Global Nineteenth Century', 3),
          row('ENGL 4590', 'Topics in Nineteenth-Century British Literature', 3),
          row('ENGL 4650', 'Modern Drama', 3),
          row('ENGL 4660', 'Twentieth-Century British and Irish Poetry', 3),
          row('ENGL 4670', 'The Twentieth-Century British and Irish Novel', 3),
          row('ENGL 4675', 'Twenty-First Century British Fiction', 3),
          row('ENGL 4680', 'Modern Irish Literature', 3),
          row('ENGL 4685', 'Postcolonial Literature', 3),
          row('ENGL 4690', 'Topics in Twentieth-Century British and Irish Literature', 3),
          row('ENGL 4698', 'Single Author Study: James Joyce', 3),
        ]),
        choose('American Literature Requirement', 1, [
          row('ENGL 4620', 'African American Poetry', 3),
          row('ENGL 4630', 'African American Fiction', 3),
          row('ENGL 4642', 'Films about the American South', 4),
          row('ENGL 4700', 'Early American Literature', 3),
          row('ENGL 4710', 'American Renaissance', 3),
          row('ENGL 4712', 'Edgar Allan Poe', 3),
          row('ENGL 4720', 'American Realism and Naturalism', 3),
          row('ENGL 4721', 'Mark Twain', 3),
          row('ENGL 4723', 'Herman Melville', 3),
          row('ENGL 4730', 'The American Novel to 1900', 3),
          row('ENGL 4740', 'Southern Literature', 3),
          row('ENGL 4742', 'Georgia Literature', 3),
          row('ENGL 4745', 'CircumCaribbean Literature', 3),
          row('ENGL 4750', 'American Modernism', 3),
          row('ENGL 4760', 'Contemporary American Literature', 3),
          row('ENGL 4770', 'Twentieth-Century American Poetry', 3),
          row('ENGL 4780', 'Twentieth-Century American Novel', 3),
          row('ENGL 4790', 'Topics in American Literature', 3),
          row('ENGL 4791', 'American Autobiography', 3),
          row('ENGL 4795', 'William Faulkner', 3),
          row('ENGL 4860', 'Multicultural Topics in American Literature', 3),
          row('ENGL 4874', 'Literature and the Civil War', 3),
          row('ENGL 4880', 'Topics in African American Literature', 3),
          row('ENGL 4882W', 'Black Film Matters: Studies in African American Film', 3),
          row('ENGL 4883W', 'From Be-Bop to Hip-Hop: Essential Voices in Modern Black Music', 3),
          row('ENGL 4884', 'Contemporary African American Writing', 3),
        ]),
        choose('World Literature Requirement', 1, [
          row('CMLT 4600', 'Pre-Modern East Asian Literature', 3),
          row('CMLT 4610', 'Modern East Asian Literature', 3),
          row('CMLT 4620', 'East Asian Novel', 3),
          row('CMLT 4880', 'The Origins of African Literature', 3),
          row('CMLT 4890', 'Postcolonial African Literature', 3),
          row('ENGL 4197', 'Middle Welsh', 3),
          row('ENGL 4210', 'Old English Literature', 3),
          row('ENGL 4220', 'Beowulf', 3),
          row('ENGL 4230', 'Medieval Literature, 1350-1500', 3),
          row('ENGL 4240', 'Chaucer', 3),
          row('ENGL 4270', 'Medieval Romance', 3),
          row('ENGL 4290', 'Topics in Medieval Literature', 3),
          row('ENGL 4295', 'Topics in Celtic Studies', 3),
          row('ENGL 4296', 'Literature of Medieval Wales', 3),
          row('ENGL 4300', 'Elizabethan Poetry', 3),
          row('ENGL 4320', 'Shakespeare I: Selected Works', 3),
          row('ENGL 4330', 'Shakespeare II: Special Topics', 3),
          row('ENGL 4331', 'Shakespeare on Film', 3),
          row('ENGL 4332', 'Shakespeare and Media', 3),
          row('ENGL 4333E', 'Shakespeare in the Eighteenth Century', 3),
          row('ENGL 4334', 'Shakespeare through Multicultural American Literature and Performance', 3),
          row('ENGL 4335S', 'Shakespeare in the Classroom: Service-Learning', 3),
          row('ENGL 4340', 'Renaissance Drama', 3),
          row('ENGL 4350', 'Seventeenth-Century Poetry', 3),
          row('ENGL 4370', 'Milton', 3),
          row('ENGL 4390', 'Topics in Renaissance Literature', 3),
          row('ENGL 4400', 'Restoration and Eighteenth-Century English Drama', 3),
          row('ENGL 4420', 'Early Eighteenth-Century Prose and Poetry', 3),
          row('ENGL 4430', 'The Eighteenth-Century English Novel', 3),
          row('ENGL 4440', 'The Age of Johnson', 3),
          row('ENGL 4450', 'The Global Eighteenth Century', 3),
          row('ENGL 4460', 'Women in the Eighteenth Century', 3),
          row('ENGL 4480', 'Scottish Literature of the Eighteenth Century', 3),
          row('ENGL 4490', 'Topics in Eighteenth-Century Literature', 3),
          row('ENGL 4491', 'The Eighteenth Century on Film', 4),
          row('ENGL 4500', 'Romantic Literature', 3),
          row('ENGL 4501', 'Romantic Circles', 3),
          row('ENGL 4520', 'The Nineteenth-Century British Novel', 3),
          row('ENGL 4525W', 'Charles Dickens', 3),
          row('ENGL 4530', 'Victorian Literature', 3),
          row('ENGL 4540', 'Victorian Poetry', 3),
          row('ENGL 4550', 'Britain, Empire, and the Global Nineteenth Century', 3),
          row('ENGL 4590', 'Topics in Nineteenth-Century British Literature', 3),
          row('ENGL 4620', 'African American Poetry', 3),
          row('ENGL 4630', 'African American Fiction', 3),
          row('ENGL 4642', 'Films about the American South', 4),
          row('ENGL 4660', 'Twentieth-Century British and Irish Poetry', 3),
          row('ENGL 4670', 'The Twentieth-Century British and Irish Novel', 3),
          row('ENGL 4675', 'Twenty-First Century British Fiction', 3),
          row('ENGL 4680', 'Modern Irish Literature', 3),
          row('ENGL 4685', 'Postcolonial Literature', 3),
          row('ENGL 4690', 'Topics in Twentieth-Century British and Irish Literature', 3),
          row('ENGL 4695', 'Topics in Postcolonial Literature', 3),
          row('ENGL 4698', 'Single Author Study: James Joyce', 3),
          row('ENGL 4700', 'Early American Literature', 3),
          row('ENGL 4710', 'American Renaissance', 3),
          row('ENGL 4712', 'Edgar Allan Poe', 3),
          row('ENGL 4720', 'American Realism and Naturalism', 3),
          row('ENGL 4721', 'Mark Twain', 3),
          row('ENGL 4723', 'Herman Melville', 3),
          row('ENGL 4730', 'The American Novel to 1900', 3),
          row('ENGL 4740', 'Southern Literature', 3),
          row('ENGL 4745', 'CircumCaribbean Literature', 3),
          row('ENGL 4750', 'American Modernism', 3),
          row('ENGL 4760', 'Contemporary American Literature', 3),
          row('ENGL 4770', 'Twentieth-Century American Poetry', 3),
          row('ENGL 4780', 'Twentieth-Century American Novel', 3),
          row('ENGL 4790', 'Topics in American Literature', 3),
          row('ENGL 4791', 'American Autobiography', 3),
          row('ENGL 4795', 'William Faulkner', 3),
          row('ENGL 4835', 'Environmental Literature', 3),
          row('ENGL 4860', 'Multicultural Topics in American Literature', 3),
          row('ENGL 4865', 'Special Topics in the Novel Before 1900', 3),
          row('ENGL 4866', 'Special Topics: Studies in the Novel after 1900', 3),
          row('ENGL 4870', 'Folklore Studies', 3),
          row('ENGL 4874', 'Literature and the Civil War', 3),
          row('ENGL 4880', 'Topics in African American Literature', 3),
          row('ENGL 4882W', 'Black Film Matters: Studies in African American Film', 3),
          row('ENGL 4883W', 'From Be-Bop to Hip-Hop: Essential Voices in Modern Black Music', 3),
          row('ENGL 4884', 'Contemporary African American Writing', 3),
        ]),
        choose('Language Study Requirement', 1, [
          row('ENGL 3030', 'World Englishes: Language, Literature, Pedagogy', 3),
          row('ENGL 3590W', 'Technical and Professional Communication', 3),
          row('ENGL 4005', 'History of the English Language', 3),
          row('ENGL 4010', 'American English', 3),
          row('ENGL 4110', 'English Grammar', 3),
          row('ENGL 4826', 'Style: Language, Genre, Cognition', 3),
          row('ENGL 4830W', 'Advanced Studies in Writing', 3),
          row('ENGL 4831W', 'Advanced Studies in Writing: The Critical Essay', 3),
          row('ENGL 4832W', 'Writing for the World Wide Web', 3),
          row('ENGL 4833W', 'Composition Theory and Pedagogy', 3),
          row('LLED 5730', 'First and Second Language Acquisition and Development', 3),
        ]),
        choose('Other Major Electives', 3, [
          row('CMLT 3200', 'Contemporary World Literature', 3),
          row('CMLT 4050', 'Literature and the Natural Environment', 3),
          row('CMLT 4400', 'East Central European Literature and Culture', 3),
          row('CMLT 4510', 'Literature and Music', 3),
          row('CMLT 4600', 'Pre-Modern East Asian Literature', 3),
          row('CMLT 4610', 'Modern East Asian Literature', 3),
          row('CMLT 4620', 'East Asian Novel', 3),
          row('CMLT 4880', 'The Origins of African Literature', 3),
          row('CMLT 4890', 'Postcolonial African Literature', 3),
          row('ENGL 4912S', 'Writing Center Theory and Practice (Writing Intensive)', 3),
          ...levels('CMLT', 3, 4),
          ...levels('ENGL', 3, 4),
        ], 'Students considering dual degrees in English (AB) and English Education should take ENGL courses.'),
      ]),
    ],
  },
  /*
   * Music BMus - Music Education (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/22148): Required Courses (63 hours),
   * Major Electives (4) and a general elective hour make the 128 with the
   * core. The reading ran into the Four-Year Program of Study and the
   * second-year review list, and four of its 1-hour rows could never be met.
   * MUSI 2810 is 4 hours (two semesters of 2); student teaching (EMUS 5460)
   * 12.
   */
  '22148': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('MUSI 1100', 'Music Theory I', 2),
        row('MUSI 1110', 'Aural Skills I', 2),
        row('MUSI 1120', 'Music Theory II', 2),
        row('MUSI 1130', 'Aural Skills II', 2),
        row('MUSI 1810', 'Freshman Applied Instruction', 4),
        row('MUSI 2500', 'Piano Class I', 1),
        row('MUSI 2510', 'Piano Class II', 1),
      ], 'MUSI 1810 is 4 hours: two semesters of 2.'),
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
      area('Required Courses', 63, [
        all('Applied Study', [
          row('MUSI 2810', 'Sophomore Applied Instruction', 4),
          row('MUSI 3810', 'Junior Applied Instruction', 2),
          row('MUSI 3820', 'Junior Applied Instruction and Recital', 2),
          row('MUSI 4810', 'Senior Applied Instruction', 2),
        ], 'MUSI 2810 is 4 hours: two semesters of 2.'),
        all('Music Theory/Ear Training', [
          row('MUSI 2100', 'Music Theory III', 2),
          row('MUSI 2110', 'Aural Skills III', 2),
        ]),
        all('Music History', [
          row('MUSI 3030', 'Music in the United States', 3),
        ]),
        choose('Music History: a survey', 1, [
          row('MUSI 3020', 'World Music Survey: Africa, Europe, and the Americas', 3),
          row('MUSI 3021', 'World Music Survey: Asia, Australia, and Oceania', 3),
          row('MUSI 3210', 'Music in the Western Tradition Pre-1750', 3),
          row('MUSI 3220', 'Music in the Western Tradition Post-1750', 3),
        ]),
        all('Music Education', [
          row('MUSI 2790', 'Introduction to Music Education', 3),
          row('MUSI 4385S', 'Foundations of Lesson Planning', 1),
          row('MUSI 4500S', 'Music Techniques and Experiences for Children', 3),
        ]),
        choose('Music Education: choral or instrumental techniques', 1, [
          row('MUSI 4520', 'Choral Techniques and Field Experience', 3),
          row('MUSI 4530', 'Instrumental Techniques and Field Experience', 3),
        ]),
        choose('Music Education: exceptional children', 1, [
          row('EDSE 2000', 'Survey of Special Education', 3),
          row('MUSI 5450', 'Music for Exceptional Children', 3),
        ], 'A grade of B or higher.'),
        all('Education', [
          row('EDUC 2120', 'Exploring Socio-Cultural Perspectives in Educational Contexts', 3),
          row('EDUC 2130', 'Exploring Learning and Teaching', 3),
        ], 'Music Education students take the section of EDUC 2120 reserved for them.'),
        all('Keyboard Competency', [
          row('MUSI 2520', 'Piano Class III', 1),
        ]),
        hoursFrom('Keyboard Competency: one more hour', 1, [
          row('MUSI 4510', 'Piano for Choral Music Educators', 1),
          ...levels('MUSI', 3),
        ], 'MUSI 4510 (choral education) or a MUSI upper-division elective of 1 hour (instrumental education).'),
        hoursFrom('Secondary Methods', 6, [
          row('MUSI 2400', 'Voice Class I', 1),
          row('MUSI 3240', 'Instrumentation and Arranging', 2),
          row('MUSI 3441', 'Jazz Pedagogy', 1),
          row('MUSI 3445', 'Vocal Pedagogy', 2),
          row('MUSI 4090', 'Vocal Diction Methods', 1),
          row('MUSI 4330', 'Guitar Techniques', 1),
          row('MUSI 4350', 'String Instrumental Techniques', 1),
          row('MUSI 4360', 'Woodwind Instrumental Techniques', 1),
          row('MUSI 4370', 'Brass Instrumental Techniques', 1),
          row('MUSI 4380', 'Percussion Techniques for Music Educators', 1),
          row('MUSI 4390', 'Pre-College Music Theory Pedagogy', 2),
          row('MUSI 4515', 'Piano for Music Therapists', 1),
        ], 'Two of these are part of the second-year review.'),
        all('Conducting', [
          row('MUSI 3480', 'Introduction to Conducting', 2),
        ]),
        choose('Conducting: one more', 1, [
          row('MUSI 3490', 'Choral Conducting', 2),
          row('MUSI 3500', 'Band Conducting', 2),
          row('MUSI 3510', 'Orchestra Conducting', 2),
        ]),
        all('Student Teaching Practicum', [
          row('EMUS 5460', 'Senior Practicum', 12),
        ], 'Teacher certification also asks for the program completion requirements on the Bulletin page.'),
      ]),
      area('Major Electives', 4, [
        hoursFrom('Large Ensembles', 3, [
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
        hoursFrom('Small Ensembles', 1, [
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
          row('MUSI 4900', 'British Brass Band', 1),
          row('MUSI 4910', 'Chamber Orchestra', 1),
          row('MUSI 5106', 'Jazz Combos', 1),
          row('MUSI 5200', 'Repertory Singers', 1),
          row('MUSI 5250', 'UGA Choral Project', 1),
        ]),
      ]),
      generalElectives(1),
    ],
  },
  /*
   * Art BFA - Animation (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/71747): the page's Required Courses
   * heading has no hour count and the reading skipped the whole section
   * (63 of 120 hours on a board). Its rows come to 60 hours.
   */
  '71747': {
    major: [
      area('Required Courses', 60, [
        all('Animation Requirements', [
          row('ARST 2010', 'Drawing and Visuality', 3),
          row('ARST 3800', 'Transmedia', 3),
          row('FILM 4680', 'Introduction to DV Production', 3),
          row('FILM 5810', 'Computer Animation for Dramatic Media I', 3),
          row('FILM 5820', 'Computer Animation for Dramatic Media II', 3),
          row('FILM 5830', 'Computer Animation for Dramatic Media III', 3),
          row('THEA 3020', 'Basic Dramatic Writing', 3),
          row('THEA 3300', 'Design Foundations', 3),
          row('THEA 5352', 'Lighting Design for the Entertainment Arts', 3),
        ]),
        choose('Capstone Project', 1, [
          row('ARST 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('THEA 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
        ]),
        choose('Animation Electives', 5, [
          row('ARGD 3050', 'Illustration', 3),
          row('ARST 2000', 'Introduction to Figure Drawing', 3),
          row('ARST 2100', 'Introduction to Painting and Visuality', 3),
          row('ARST 2810', 'Hypermedia', 3),
          row('ARST 3010', 'Advanced Drawing', 3),
          row('ARST 3205', 'Video Concepts and Practice', 3),
          row('ARST 3805', 'Animation - 2D and Experimental Motion Graphics', 3),
          row('ARST 3810', 'CAD and Fabrication I', 3),
          row('ARST 4020', 'Figure Drawing/Anatomy', 3),
          row('ARST 4215', 'Sound in Art', 3),
          row('ARST 4830', 'Advanced Video', 3),
          row('FILM 5640', 'Directing for the Cinema', 3),
          row('FILM 5690', 'Special Effects for Film and Video', 3),
          row('THEA 3330', 'Costume Crafts', 3),
          row('THEA 5330', 'Costume Design for the Entertainment Arts', 3),
          row('THEA 5351', 'Scenic Design for the Entertainment Arts', 3),
          row('THEA 5700', 'Internship in Theatre/Film/Animation', 3),
          row('THEA 5840', 'Technical Animation with Computers', 3),
          row('THEA 5880', 'Sound Effects for Stage and Screen', 3),
        ]),
        hoursFrom('Art History', 9, [
          ...levels('ARHI', 3, 4),
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('THEA 4210', 'Theatre and Modernity', 3),
          row('THEA 4220', 'Theatre and Society', 3),
        ], 'ARHI courses at the 3000 or 4000 level, or the film and theatre history courses listed.'),
        hoursFrom('Related Major Courses', 6, [
          row('ENGL 3410', 'Literature and Media', 3),
          row('ENGL 3560W', 'Writing Games', 3),
          row('ENGL 3570', 'Games and Culture', 3),
          ...['ARGD', 'ARID', 'ARST', 'ARTS', 'FILM', 'THEA'].flatMap((subject) => levels(subject, 2)),
        ], 'The ENGL courses listed, or ARGD, ARID, ARST, ARTS, FILM or THEA courses at the 2000 level or above.'),
      ]),
    ],
  },
  /*
   * Social Studies Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/79831): the reading lost Required
   * Courses (57 hours) whole: 21 hours of content courses in the student's
   * area of emphasis (Economics, Human Geography, History or Political
   * Science), the Blocks 1-3 ESOC courses with student teaching (12 hours),
   * and a foreign language through the third semester where Area IV did not
   * take it (57 of 120 hours on a board).
   */
  '79831': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('EDSE 4030', 'Inclusion of Students with Disabilities: Grades 6-12', 3),
        row('EDUC 2120', 'Exploring Socio-Cultural Perspectives in Educational Contexts', 3),
        row('EDUC 2130', 'Exploring Learning and Teaching', 3),
      ], 'A grade of C or higher in Area VI and every major course.'),
      hoursFromDistinct('VI. Courses Related to the Major: 9 hours', 9, 3, [
        [row('ECON 2105', 'Principles of Macroeconomics', 3), row('ECON 2106', 'Principles of Microeconomics', 3)],
        [row('GEOG 1101', 'Human Geography: People, Places, and Cultures', 3), row('GEOG 1103', 'Cultural Geography of the United States', 3)],
        [row('HIST 2111', 'American History to 1865', 3), row('HIST 2112', 'American History Since 1865', 3)],
        [row('POLS 1101', 'American Government', 3)],
      ], 'Courses not taken in Area V. The major asks for a course with each of the ECON, GEOG, HIST and POLS prefixes.'),
    ]),
    major: [
      area('Required Courses', 57, [
        all('Major Courses (Blocks 1-3)', [
          row('ESOC 3450', 'Initial Field Experience in Social Studies Education', 3),
          row('ESOC 3450L', 'Introduction to Social Studies Education Lab', 3),
          row('ESOC 4350', 'Study of Secondary Social Studies Curricula', 3),
          row('ESOC 4360', 'Communities, Identities, and Relationships in Secondary Social Studies Education', 3),
          row('ESOC 4450L', 'Senior Field Experience in Social Studies Education', 6),
          row('ESOC 4455', 'Planning and Teaching for Equity-Orientated Social Studies Classrooms', 3),
          row('ESOC 5560', 'Student Teaching Seminar', 3),
          row('ESOC 5460', 'Student Teaching in Social Science Education', 12),
        ], 'A grade of C or higher. Core Areas I-VI and every elective done before Block Two.'),
        choose('Foreign language through the third semester', 1, THIRD_SEMESTER_COURSES, 'If not taken in Area IV: one language through the third semester, C or higher in every semester (AMSL at the third level or above counts).'),
        hoursFrom(focus(1, 'Area of Emphasis in Economics'), 21, [...levels('ECON', 3, 4), ...SOCIAL_STUDIES_PEDAGOGY, row('FHCE 3200', 'Introduction to Personal Finance', 3)], 'ECON courses at the 3000/4000 level; one or more Content Pedagogy courses (ESOC 5010-5070) preferred, which count as emphasis courses.'),
        hoursFrom(focus(2, 'Area of Emphasis in Human Geography'), 21, [...levels('GEOG', 3, 4), ...SOCIAL_STUDIES_PEDAGOGY], 'GEOG courses at the 3000/4000 level; one or more Content Pedagogy courses (ESOC 5010-5070) preferred, which count as emphasis courses.'),
        hoursFrom(focus(3, 'Area of Emphasis in History'), 21, [...levels('HIST', 3, 4), ...SOCIAL_STUDIES_PEDAGOGY, row('HIST 4112', 'History for History Teachers: The U.S.-1865 to the Present', 3)], 'HIST courses at the 3000/4000 level; one or more Content Pedagogy courses (ESOC 5010-5070) preferred, which count as emphasis courses.'),
        hoursFrom(focus(4, 'Area of Emphasis in Political Science'), 21, [...levels('POLS', 3, 4), ...SOCIAL_STUDIES_PEDAGOGY], 'POLS courses at the 3000/4000 level; one or more Content Pedagogy courses (ESOC 5010-5070) preferred, which count as emphasis courses.'),
      ]),
    ],
  },
  /*
   * Environmental Resource Science BSES (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/27349): the Required Courses and Major
   * Electives headings carry no hour count and the reading skipped both (60
   * of 120 hours on a board). The General track and the Area of Emphasis in
   * Water and Soil Resources differ in the soil processes courses (one, or
   * all four), the analytical course and the Major Electives (12 hours, or
   * 3): one choice, those rows each path's own.
   */
  '27349': {
    major: [
      area('Required Courses', 53, [
        all('Required Courses', [
          row('CRSS 1200', 'Freshman and Transfer Student Seminar', 1),
          row('CRSS 2010', 'Crop Science', 3),
          lab('CRSS 2010L', 'Crop Science Laboratory', 1),
          row('CRSS 3060', 'Soils and Hydrology', 3),
          lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
        ]),
        hoursFrom('Internship or research', 3, [
          row('CRSS 3910', 'Crop Science Internship', 3),
          row('CRSS 3920', 'Environmental Soil Science Internship', 3),
          row('CRSS 3930', 'Turfgrass Management Internship', 3),
          row('CRSS 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
        ]),
        hoursFrom('Courses to Enhance Knowledge of Fundamental Science', 11, [
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('CHEM 2211', 'Modern Organic Chemistry I', 3),
          lab('CHEM 2211L', 'Modern Organic Chemistry Laboratory I', 1),
          row('CSCI 1100', 'Topics in Computing', 3),
          row('ENVE 2610', 'Introduction to Environmental Engineering and Sustainability', 3),
          row('GEOG 1112', 'Introduction to Weather and Climate', 3),
          row('GEOG 1112L', 'Introduction to Weather and Climate Laboratory', 1),
          row('GEOL 1121', 'Earth Processes and Environments', 3),
          row('GEOL 1121L', 'Earth Processes and Environments Laboratory', 1),
          row('GEOL 1250', 'Physical Geology', 4),
          row('MATH 2200', 'Analytic Geometry and Calculus', 4),
          row('MATH 2250', 'Calculus I for Science and Engineering', 4),
          row('MATH 2260', 'Calculus II for Science and Engineering', 4),
          row('PHYS 1111', 'Introductory Physics-Mechanics, Waves, Thermodynamics', 4),
          row('PHYS 1251', 'Introductory Studio Physics for Engineers I', 3),
        ], 'Choose 11 to 12 hours.'),
        choose('Courses to Enhance Knowledge of Landscape Processes', 1, [
          row('ATSC 3110', 'Climatology', 3),
          row('CRSS 4580', 'Soil Erosion and Conservation', 3),
          row('EHSC 4080', 'Environmental Air Quality', 3),
          row('GEOG 3010', 'General Geomorphology', 3),
          row('GEOL 4220', 'Hydrogeology', 3),
          row('WASR 4110', 'Forest Hydrology', 4),
          row('WASR 4700L', 'Hydrology, Geology, and Soils of Georgia', 3),
        ]),
        choose('Courses to Enhance Knowledge of Earth Systems', 1, [
          row('CRSS 4400', 'Agro-Ecology', 3),
          row('CRSS 4930', 'Agroecology of Tropical America', 3),
          row('ECOL 3500', 'Ecology', 3),
          lab('ECOL 3500L', 'Ecology Laboratory', 1),
          row('ECOL 3530', 'Conservation Biology', 3),
          row('ECOL 3770S', 'Urban Ecology - Service Learning', 3),
          row('ECOL 4160', 'Ecology of North America', 4),
          row('FANR 3200W', 'Ecology of Natural Resources', 3),
          lab('FANR 3200L', 'Ecology of Natural Resources Laboratory', 1),
        ]),
        choose('Courses to Enhance Knowledge of Human Dimensions and Policy', 1, [
          row('ADSC 4000', 'Sustainability of Resilient Global Food Systems', 3),
          row('AESC 3110', 'Recognizing the Multicultural History of American Agriculture', 3),
          row('ANTH 4255', 'Culture and Agriculture', 3),
          row('CRSS 4020S', 'Social Sustainability in Agricultural and Food Systems', 3),
          row('ECOL 4880', 'Environmental and Natural Resource Policy', 3),
          row('ENVM 4380', 'Environmental Management and Sustainable Business Practices', 3),
          row('ENVM 4930', 'Environmental Law and Governmental Regulation', 3),
          row('FANR 4271', 'People, Planet, and Profit', 3),
          row('GEOG 4890S', 'Athens Urban Food Collective (AUFC) Service-Learning', 3),
          row('JURI 4810', 'Natural Resources Law', 3),
          row('SOCI 3400', 'Environmental Sociology', 3),
        ]),
        choose('Courses to Enhance Knowledge of Applied Environmental Management', 1, [
          row('CRSS 3540', 'Soil Morphology and Interpretation', 3),
          row('CRSS 4010', 'Principles of Sustainable Management', 3),
          row('CRSS 4090', 'Turfgrass Physiology and Ecology', 3),
          row('CRSS 4580', 'Soil Erosion and Conservation', 3),
          row('CRSS 4590', 'Soil Fertility and Plant Nutrition', 3),
        ]),
        choose(focus(1, 'General track'), 1, [
          row('CRSS 4540', 'Pedology', 4),
          row('CRSS 4600', 'Soil Physics', 3),
          row('CRSS 4610', 'Soil Microbiology', 4),
          row('CRSS 4670', 'Environmental Soil Chemistry', 3),
        ], 'Courses to Enhance Knowledge of Soil Processes: one course.'),
        choose(focus(1, 'General track', 'analytical measurements'), 1, [
          row('CHEM 2300', 'Quantitative Analytical Chemistry', 3),
          lab('CHEM 2300L', 'Quantitative Analytical Chemistry Laboratory', 1),
          row('CHEM 3300', 'Modern Instrumental Methods of Analysis', 3),
          row('CRSS 3050', 'Introduction to Water Quality', 4),
          row('CRSS 4660', 'Hydrogeochemical Characterization of Environmental Field Sites', 3),
          row('WASR 4500', 'Quantitative Methods in Hydrology', 3),
        ]),
        hoursFrom(focus(1, 'General track', 'Major Electives'), 12, CAES_ELECTIVE_SUBJECTS, '3000- to 6000-level courses with the prefixes the Bulletin lists.'),
        all(focus(2, 'Area of Emphasis in Water and Soil Resources'), [
          row('CRSS 4540', 'Pedology', 4),
          row('CRSS 4600', 'Soil Physics', 3),
          row('CRSS 4610', 'Soil Microbiology', 4),
          row('CRSS 4670', 'Environmental Soil Chemistry', 3),
        ], 'Courses to Enhance Knowledge of Soil Processes: all four.'),
        choose(focus(2, 'Area of Emphasis in Water and Soil Resources', 'analytical measurements'), 1, [
          row('CRSS 3050', 'Introduction to Water Quality', 4),
          row('CRSS 4660', 'Hydrogeochemical Characterization of Environmental Field Sites', 3),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Water and Soil Resources', 'Major Electives'), 3, CAES_ELECTIVE_SUBJECTS, '3000- to 6000-level courses with the prefixes the Bulletin lists.'),
      ]),
      generalElectives(3),
    ],
  },
  /*
   * Food Science BSA (verified 2026-10-29, bulletin.uga.edu/Program/Details/35947):
   * Major Electives (25-26 hours) are the Area of Emphasis in Business or
   * the Area of Emphasis in Science, Technology, and Engineering; the
   * reading required both, with rows shifted between them. The Science,
   * Technology, and Engineering emphasis also asks for CHEM 2211 and MIBO
   * 3500 among Area VI's choices.
   */
  '35947': {
    // Area VI's lecture-and-lab choices, each pair one choice (read as lectures alone, the area read 14 of 18 hours).
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('CHEM 1212', 'General Chemistry II', 3),
        lab('CHEM 1212L', 'General Chemistry Laboratory II', 1),
      ]),
      choose('Statistics', 1, [
        row('BIOS 2010', 'Elementary Biostatistics', 4),
        row('STAT 2000', 'Introductory Statistics', 4),
      ], 'University System of Georgia STAT 1Dxx and STAT 2Dxx courses also count.'),
      oneGroup('Organic chemistry', 4, [
        [row('CHEM 2100', 'Elementary Organic Chemistry', 3), lab('CHEM 2100L', 'Elementary Organic Chemistry Laboratory', 1)],
        [row('CHEM 2211', 'Modern Organic Chemistry I', 3), lab('CHEM 2211L', 'Modern Organic Chemistry Laboratory I', 1)],
      ], 'CHEM 2211 with its lab for the Science, Technology, and Engineering emphasis.'),
      choose('Physics', 1, [
        row('PHYS 1111', 'Introductory Physics-Mechanics, Waves, Thermodynamics', 4),
        row('PHYS 1211', 'Principles of Physics for Scientists and Engineers-Mechanics, Waves, Thermodynamics', 4),
      ]),
      oneGroup('Microbiology', 4, [
        [row('MIBO 2500', 'Microbiology and Health Care', 3), lab('MIBO 2500L', 'Microbiology and Health Care Laboratory', 1)],
        [row('MIBO 3500', 'Introductory Microbiology', 3), lab('MIBO 3500L', 'Introductory Microbiology Laboratory I', 1)],
      ], 'MIBO 3500 with its lab for the Science, Technology, and Engineering emphasis.'),
    ]),
    major: [
      area('Required Courses', 22, [
        all('Required Courses', [
          row('FDST 1001', 'Careers in Food Science', 1),
          row('FDST 3000', 'Introduction to Food Science and Technology', 3),
          row('FDST 4011', 'Fundamentals of Food Process Engineering', 3),
          row('FDST 4030', 'Food Microbiology', 4),
          row('FDST 4040', 'Food Chemistry', 4),
          row('FDST 4090', 'Food Quality Control', 1),
          row('FDST 4240', 'Sensory and Consumer Sciences in Agriculture', 3),
          row('FDST 4250', 'Food Product Development', 3),
        ]),
      ]),
      // FDST 2010 counts in neither emphasis's FDST hours, the page says (a board booked it for the Business emphasis, 2026-10-30).
      { ...area('Major Electives', 25, [
        // A choice of every course listed: a list with no number to choose, in an area of electives, is read as hours to draw from.
        choose(focus(1, 'Area of Emphasis in Business'), 2, [
          row('FDST 4100', 'Governmental Regulation of Food Safety and Quality', 2),
          row('FDST 4320', 'Food Safety Control Programs', 3),
        ]),
        choose(focus(1, 'Area of Emphasis in Business', 'microeconomics'), 1, [
          row('AAEC 2580', 'Applied Microeconomic Principles', 3),
          row('ECON 2106', 'Principles of Microeconomics', 3),
        ]),
        choose(focus(1, 'Area of Emphasis in Business', 'marketing'), 1, [
          row('AAEC 3100', 'Food and Fiber Marketing', 3),
          row('MARK 3001', 'Principles of Marketing', 3),
        ]),
        choose(focus(1, 'Area of Emphasis in Business', 'management'), 1, [
          row('AAEC 3980', 'Introduction to Agribusiness Management', 3),
          row('MGMT 3001', 'Principles of Management', 3),
        ]),
        choose(focus(1, 'Area of Emphasis in Business', 'accounting'), 1, [
          row('ACCT 1160', 'Survey of Accounting', 3),
          row('ACCT 2101', 'Principles of Accounting I', 3),
        ]),
        choose(focus(1, 'Area of Emphasis in Business', 'food processing'), 1, [
          row('FDST 4012', 'Processing of Liquid Foods and Beverages', 3),
          row('FDST 4013', 'Food Processing', 3),
        ]),
        hoursFrom(focus(1, 'Area of Emphasis in Business', 'AAEC or FDST courses'), 6, [
          ...levels('AAEC', 3),
          ...levels('FDST', 2),
        ], 'AAEC courses at the 3000 level or above, or FDST courses (not FDST 2010): up to 3 hours at the 2000 level, the rest at 3000 or above.'),
        choose(focus(2, 'Area of Emphasis in Science, Technology, and Engineering'), 3, [
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('FDST 4070', 'Nutritional Quality and the Effect of Technology', 3),
          row('FDST 4080', 'Instrumental Methods of Food Analysis', 3),
        ], 'With CHEM 2211 and MIBO 3500 in Area VI.'),
        choose(focus(2, 'Area of Emphasis in Science, Technology, and Engineering', 'food processing'), 1, [
          row('FDST 4012', 'Processing of Liquid Foods and Beverages', 3),
          row('FDST 4013', 'Food Processing', 3),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Science, Technology, and Engineering', 'FDST courses'), 12, levels('FDST', 2), 'FDST courses (not FDST 2010): up to 3 hours at the 2000 level, the rest at 3000 or above.'),
      ]), excludeCodes: ['FDST 2010'] },
      generalElectives(11),
    ],
  },
  /*
   * Agricultural Engineering BSAE (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/29981): Required Courses (67 hours) are
   * the engineering core (ECSE 2170 or ENGR 2170, "only one") and one area
   * of emphasis of 27 hours: seven courses and 6 hours of electives with at
   * least one design course. The reading scrambled the six emphases' rows
   * across each other and left the choice optional.
   */
  '29981': {
    major: [
      area('Required Courses', 67, [
        all('Required Courses', [
          row('AENG 2100', 'Principles of Systems Engineering', 3),
          row('AENG 2920', 'Engineering Design Methodology', 2),
          row('AENG 3100', 'Motion and Time Studies', 3),
          row('AENG 4140', 'Systems Modeling', 3),
          row('AENG 4910', 'Capstone Design I', 2),
          row('AENG 4911', 'Capstone Design II', 2),
          row('ENGR 1920', 'Introduction to Engineering', 1),
          row('ENGR 2110', 'Engineering Decision Making', 3),
          row('ENGR 2120', 'Engineering Statics', 3),
          row('ENGR 3140', 'Engineering Thermodynamics', 3),
          row('ENGR 3150', 'Heat Transfer', 3),
          row('ENGR 3160', 'Fluid Mechanics', 3),
          row('ENVE 3510', 'Modeling, Statistical Analysis, and Uncertainty', 3),
          row('MCHE 3410', 'Numerical Methods in Mechanical Engineering', 3),
        ], 'Entering the major asks for ENGL 1101, ENGR 1120, 1140 and 2120, MATH 2250 and 2260 and PHYS 1211 (or 1251) at C or better, and a 2.75 GPA in ENGR 1120, 1140 and 2120.'),
        choose('Circuit analysis', 1, [
          row('ECSE 2170', 'Fundamentals of Circuit Analysis', 3),
          row('ENGR 2170', 'Applied Circuit Analysis', 3),
        ], 'Only one of these courses counts.'),
        all(focus(1, 'Area of Emphasis in Agricultural Systems Automation Engineering'), [
          row('ELEE 3270', 'Electronics I', 3),
          row('ELEE 4210', 'Linear Systems', 3),
          row('ELEE 4220', 'Feedback Control Systems', 3),
          row('ELEE 4230', 'Sensors and Transducers', 3),
          row('ELEE 4270', 'Electronics II', 3),
          row('ELEE 4280', 'Introduction to Robotics Engineering', 3),
          row('INFO 2000', 'Experiential Data Science Specialization - Foundations', 3),
        ]),
        withDesign(hoursFrom(focus(1, 'Area of Emphasis in Agricultural Systems Automation Engineering', 'electives'), 6, [
          row('AENG 3540', 'Physical Unit Operations', 3),
          row('AENG 4120', 'Introduction to Logistical Engineering', 3),
          row('AENG 4130', 'Precision Farming Controls and Sensors', 3),
          row('CSCI 3360', 'Data Science and Applied Machine Learning I', 4),
          row('CSEE 4620', 'Biomedical Imaging', 3),
          row('ELEE 4260', 'Introduction to Nanoelectronics', 3),
          row('ENGR 3620', 'Introduction to E-Mobility', 3),
          row('ENGR 4545', 'Engineering Entrepreneurship', 3),
          row('FANR 3800', 'Spatial Analysis of Natural Resources', 2),
          lab('FANR 3800L', 'Spatial Analysis of Natural Resources Laboratory', 1),
          row('FDST 3000', 'Introduction to Food Science and Technology', 3),
          row('FDST 4012', 'Processing of Liquid Foods and Beverages', 3),
          row('MCHE 3120', 'Mechanical Engineering CAD/CAE', 3),
          row('POUL 4860', 'Poultry Processing', 3),
        ], 'A minimum of 6 hours, at least one of them a design course.'), ['AENG 3540', 'AENG 4120', 'FDST 4012']),
        all(focus(2, 'Area of Emphasis in BioLogistics'), [
          row('AENG 3540', 'Physical Unit Operations', 3),
          row('AENG 4105', 'Postharvest Facilities Engineering', 3),
          row('AENG 4120', 'Introduction to Logistical Engineering', 3),
          row('AENG 4160', 'Introduction to Operations Research', 3),
          row('ELEE 3270', 'Electronics I', 3),
          row('ENGR 2140', 'Strength of Materials', 3),
          row('ENGR 4670', 'Quality Engineering', 3),
        ]),
        withDesign(hoursFrom(focus(2, 'Area of Emphasis in BioLogistics', 'electives'), 6, [
          row('CVLE 3730S', 'Civil Engineering Project Management', 2),
          row('ELEE 4210', 'Linear Systems', 3),
          row('ELEE 4230', 'Sensors and Transducers', 3),
          row('ENGR 3620', 'Introduction to E-Mobility', 3),
          row('ENGR 4350', 'Introduction to Finite Element Analysis', 3),
          row('ENGR 4490', 'Renewable Energy Engineering', 3),
          row('ENGR 4545', 'Engineering Entrepreneurship', 3),
          row('FDST 3000', 'Introduction to Food Science and Technology', 3),
          row('FDST 4012', 'Processing of Liquid Foods and Beverages', 3),
          row('HORT 4430', 'Plant Physiology', 3),
          row('MGMT 4000', 'Operations Management', 3),
          row('POUL 4860', 'Poultry Processing', 3),
          row('STAT 4260', 'Statistical Quality Assurance', 3),
        ], 'A minimum of 6 hours, at least one of them a design course.'), ['CVLE 3730S', 'ENGR 4490', 'FDST 4012']),
        all(focus(3, 'Area of Emphasis in Food Engineering'), [
          row('ELEE 3270', 'Electronics I', 3),
          row('ELEE 4230', 'Sensors and Transducers', 3),
          row('ENGR 2140', 'Strength of Materials', 3),
          row('FDST 4012', 'Processing of Liquid Foods and Beverages', 3),
          row('FDST 4013', 'Food Processing', 3),
          row('MCHE 3300', 'Machine Design I', 3),
          row('MCHE 4300', 'Mechanical Systems', 3),
        ]),
        withDesign(hoursFrom(focus(3, 'Area of Emphasis in Food Engineering', 'electives'), 6, [
          row('AENG 3540', 'Physical Unit Operations', 3),
          row('AENG 4105', 'Postharvest Facilities Engineering', 3),
          row('ELEE 4710', 'Fundamentals of Power Engineering', 3),
          row('ENGR 3620', 'Introduction to E-Mobility', 3),
          row('ENGR 4545', 'Engineering Entrepreneurship', 3),
          row('ENGR 4670', 'Quality Engineering', 3),
          row('FDST 3000', 'Introduction to Food Science and Technology', 3),
          row('FDST 4030', 'Food Microbiology', 4),
          row('FDST 4040', 'Food Chemistry', 4),
          row('FDST 4250', 'Food Product Development', 3),
          row('FDST 4320', 'Food Safety Control Programs', 3),
          row('MCHE 4650', 'HVAC Systems for Buildings and Industry', 3),
          row('PATH 3050', 'Viticulture and Enology in the Mediterranean Region', 4),
          row('POUL 4860', 'Poultry Processing', 3),
          row('STAT 4260', 'Statistical Quality Assurance', 3),
        ], 'A minimum of 6 hours, at least one of them a design course.'), ['AENG 3540', 'AENG 4105', 'MCHE 4650']),
        all(focus(4, 'Area of Emphasis in Mechanical Systems'), [
          row('ELEE 3270', 'Electronics I', 3),
          row('ENGR 2130', 'Dynamics', 3),
          row('ENGR 2140', 'Strength of Materials', 3),
          row('ENGR 4350', 'Introduction to Finite Element Analysis', 3),
          row('MCHE 3300', 'Machine Design I', 3),
          row('MCHE 4300', 'Mechanical Systems', 3),
          row('MCHE 4340', 'Machine Hydraulics', 3),
        ]),
        withDesign(hoursFrom(focus(4, 'Area of Emphasis in Mechanical Systems', 'electives'), 6, [
          row('AENG 3540', 'Physical Unit Operations', 3),
          row('CVLE 3460L', 'Civil Engineering Laboratory – Hydraulics', 1),
          row('CVLE 3470L', 'Civil Engineering Laboratory – Structural', 1),
          row('CVLE 3610', 'Structural Design', 3),
          row('CVLE 4660', 'Sustainable Building Design', 3),
          row('ELEE 4210', 'Linear Systems', 3),
          row('ELEE 4220', 'Feedback Control Systems', 3),
          row('ELEE 4230', 'Sensors and Transducers', 3),
          row('ENGR 3620', 'Introduction to E-Mobility', 3),
          row('ENGR 4490', 'Renewable Energy Engineering', 3),
          row('ENGR 4545', 'Engineering Entrepreneurship', 3),
          row('ENGR 4670', 'Quality Engineering', 3),
          row('ENVE 4470', 'Environmental Engineering Unit Operations', 3),
          row('MCHE 3120', 'Mechanical Engineering CAD/CAE', 3),
          row('MCHE 3150', 'Engineering Thermodynamics II', 3),
          row('MCHE 4390', 'Mechanical Vibration', 3),
          row('MCHE 4500', 'Advanced Thermal Fluid Systems', 3),
          row('MCHE 4530', 'Combustion and Flames', 3),
          row('MCHE 4650', 'HVAC Systems for Buildings and Industry', 3),
        ], 'A minimum of 6 hours, at least one of them a design course.'), ['AENG 3540', 'CVLE 3610', 'CVLE 4660', 'ELEE 4220', 'ENGR 4490', 'ENVE 4470', 'MCHE 4390', 'MCHE 4650']),
        all(focus(5, 'Area of Emphasis in Natural Resources Engineering'), [
          row('CVLE 3420', 'Introduction to Soil Mechanics', 3),
          row('CVLE 3440', 'Hydraulics of Closed Conduit Flow', 3),
          row('ENGR 2140', 'Strength of Materials', 3),
          row('ENVE 4435', 'Natural Resources Engineering', 3),
          row('ENVE 4470', 'Environmental Engineering Unit Operations', 3),
          row('ENVE 4710', 'GIS for Urban Engineering, Planning, and Development', 3),
          row('WASR 4700L', 'Hydrology, Geology, and Soils of Georgia', 3),
        ]),
        withDesign(hoursFrom(focus(5, 'Area of Emphasis in Natural Resources Engineering', 'electives'), 6, [
          row('AENG 4130', 'Precision Farming Controls and Sensors', 3),
          row('AENG 4150', 'Environmental Biophysics', 3),
          row('AENG 4161', 'Agricultural and Environmental Climatology', 3),
          row('AENG 4170', 'Wind and Water Erosion Prediction', 3),
          row('AENG 4180', 'Irrigation Systems Design', 3),
          row('CRSS 3060', 'Soils and Hydrology', 3),
          lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
          row('CRSS 4600', 'Soil Physics', 3),
          row('CVLE 2210', 'Surveying and Geomatics', 2),
          row('CVLE 3450L', 'Civil Engineering Laboratory – Soils', 1),
          row('CVLE 3460L', 'Civil Engineering Laboratory – Hydraulics', 1),
          row('CVLE 3610', 'Structural Design', 3),
          row('CVLE 4660', 'Sustainable Building Design', 3),
          row('CVLE 4780', 'Advanced Computer-Aided Design Civil 3D', 3),
          row('ELEE 4230', 'Sensors and Transducers', 3),
          row('ENGR 3620', 'Introduction to E-Mobility', 3),
          row('ENGR 4490', 'Renewable Energy Engineering', 3),
          row('ENGR 4545', 'Engineering Entrepreneurship', 3),
          row('ENVE 4410', 'Open Channel Hydraulics', 3),
          row('MCHE 4650', 'HVAC Systems for Buildings and Industry', 3),
          row('WASR 4500', 'Quantitative Methods in Hydrology', 3),
        ], 'A minimum of 6 hours, at least one of them a design course.'), ['AENG 4170', 'AENG 4180', 'CVLE 3610', 'CVLE 4660', 'ENGR 4490', 'ENVE 4410', 'MCHE 4650']),
        all(focus(6, 'Area of Emphasis in Structural Systems'), [
          row('CVLE 3420', 'Introduction to Soil Mechanics', 3),
          row('CVLE 3610', 'Structural Design', 3),
          row('CVLE 4530', 'Design of Reinforced Concrete Structures', 3),
          row('CVLE 4610', 'Design of Steel Structures', 3),
          row('CVLE 4660', 'Sustainable Building Design', 3),
          row('ENGR 2140', 'Strength of Materials', 3),
          row('MCHE 4650', 'HVAC Systems for Buildings and Industry', 3),
        ]),
        withDesign(hoursFrom(focus(6, 'Area of Emphasis in Structural Systems', 'electives'), 6, [
          row('CVLE 3440', 'Hydraulics of Closed Conduit Flow', 3),
          row('CVLE 3450L', 'Civil Engineering Laboratory – Soils', 1),
          row('CVLE 3470L', 'Civil Engineering Laboratory – Structural', 1),
          row('CVLE 3730S', 'Civil Engineering Project Management', 2),
          row('CVLE 4330', 'Advanced Structural Analysis', 3),
          row('CVLE 4450', 'Geotechnical Structures – Foundations and Retaining Walls', 3),
          row('CVLE 4720', 'Engineering Design of Residential Structures', 3),
          row('ENGR 3620', 'Introduction to E-Mobility', 3),
          row('ENGR 4350', 'Introduction to Finite Element Analysis', 3),
          row('ENGR 4545', 'Engineering Entrepreneurship', 3),
          row('ENVE 4435', 'Natural Resources Engineering', 3),
          row('ENVE 4470', 'Environmental Engineering Unit Operations', 3),
          row('ENVE 4710', 'GIS for Urban Engineering, Planning, and Development', 3),
          row('MCHE 3300', 'Machine Design I', 3),
        ], 'A minimum of 6 hours, at least one of them a design course.'), ['CVLE 3440', 'CVLE 3730S', 'CVLE 4330', 'ENVE 4435']),
      ]),
      area('Major Electives', 3, [
        choose('Major Electives', 1, [
          row('ANTH 1102', 'Introduction to Anthropology', 3),
          row('FANR 2200', 'International Issues in Natural Resources and Conservation', 3),
          row('GEOG 1125', 'Resources, Society, and the Environment', 3),
        ]),
      ]),
    ],
  },
  /*
   * Agriscience and Environmental Systems BSA (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/47617): the shared Required Courses,
   * then the General program or the Area of Emphasis in Plant Breeding and
   * Genetics, Precision Agriculture or Sustainable Agriculture, each with
   * its own courses and major electives (0 to 6 hours); the reading
   * required the General track and all three emphases (83 hours of rows for
   * 47).
   */
  '47617': {
    major: [
      area('Required Courses', 53, [
        all('Required Courses', [
          row('CRSS 1200', 'Freshman and Transfer Student Seminar', 1),
          row('CRSS 2010', 'Crop Science', 3),
          lab('CRSS 2010L', 'Crop Science Laboratory', 1),
          row('CRSS 3030', 'Principles of Precision Agriculture', 3),
          row('CRSS 3060', 'Soils and Hydrology', 3),
          lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
          row('CRSS 4010', 'Principles of Sustainable Management', 3),
          row('CRSS 4340', 'Weed Science', 3),
          lab('CRSS 4340L', 'Weed Science Laboratory', 1),
          row('CRSS 4590', 'Soil Fertility and Plant Nutrition', 3),
          row('ENTO 4000', 'General Entomology', 4),
          row('ENTO 4250', 'Pesticides and Transgenic Crops', 3),
          row('PATH 3530', 'Introductory Plant Pathology', 3),
        ]),
        hoursFrom('Internship or research', 3, [
          row('CRSS 3910', 'Crop Science Internship', 3),
          row('CRSS 3920', 'Environmental Soil Science Internship', 3),
          row('CRSS 3930', 'Turfgrass Management Internship', 3),
          row('CRSS 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
        ]),
        // The option's first row names it in setup.
        choose(focus(1, 'Agriscience and Environmental Systems (General)'), 1, [
          row('AAEC 3010', 'Farm Organization and Management', 3),
          row('AAEC 3040', 'Agribusiness Marketing', 3),
          row('AAEC 3100', 'Food and Fiber Marketing', 3),
          row('AAEC 3200', 'Selling in Agribusiness', 3),
          row('AAEC 3400', 'Introduction to Agricultural Policy', 3),
          row('AAEC 3600', 'Economics of Food Policy', 3),
          row('AAEC 3690', 'Agribusiness Finance', 4),
          row('AAEC 3980', 'Introduction to Agribusiness Management', 3),
          row('AAEC 4051E', 'Food Law and Regulation', 3),
          row('AAEC 4070', 'Livestock, Dairy, and Poultry Supply Chain Economics', 3),
          row('AAEC 4710', 'Rural Economic Development and Growth', 3),
          row('ENVM 3060', 'Principles of Resource Economics', 3),
        ], 'Agribusiness Courses: choose 1.'),
        choose(focus(1, 'Agriscience and Environmental Systems (General)', 'Social-Environmental Systems Courses'), 1, [
          row('ADSC 4000', 'Sustainability of Resilient Global Food Systems', 3),
          row('AESC 3110', 'Recognizing the Multicultural History of American Agriculture', 3),
          row('ANTH 4255', 'Culture and Agriculture', 3),
          row('CRSS 3050', 'Introduction to Water Quality', 4),
          row('CRSS 4020S', 'Social Sustainability in Agricultural and Food Systems', 3),
          row('CRSS 4540', 'Pedology', 4),
          row('CRSS 4580', 'Soil Erosion and Conservation', 3),
          row('CRSS 4600', 'Soil Physics', 3),
          row('CRSS 4610', 'Soil Microbiology', 4),
          row('CRSS 4670', 'Environmental Soil Chemistry', 3),
          row('CRSS 4750', 'Environmental Turfgrass Science', 3),
          row('ECOL 4880', 'Environmental and Natural Resource Policy', 3),
          row('EHSC 3060', 'Foundations in Environmental Health', 3),
          row('FANR 4271', 'People, Planet, and Profit', 3),
          row('GEOG 4890S', 'Athens Urban Food Collective (AUFC) Service-Learning', 3),
          row('SOCI 3400', 'Environmental Sociology', 3),
          row('WASR 4700L', 'Hydrology, Geology, and Soils of Georgia', 3),
        ]),
        choose(focus(1, 'Agriscience and Environmental Systems (General)', 'Production Management Courses'), 2, [
          row('ADSC 3300', 'Animal Nutrition and Metabolism', 3),
          row('ADSC 3400', 'Physiology of Reproduction in Domestic Animals', 3),
          row('ADSC 3600', 'Beef Cattle Production and Management', 3),
          row('ADSC 3620', 'Dairy Cattle Production and Management', 3),
          row('ADSC 3630', 'Horse Production and Management', 3),
          row('ADSC 4010', 'Issues in Animal Agriculture', 3),
          row('ADSC 4350', 'Grazing Animal Production and Management', 3),
          row('CRSS 3270', 'Turf Management', 3),
          row('CRSS 4030', 'Sensors in Precision Agriculture', 3),
          row('CRSS 4060', 'Advanced Topics in Precision Agriculture', 3),
          row('CRSS 4090', 'Turfgrass Physiology and Ecology', 3),
          row('CRSS 4260', 'Forage Management and Utilization', 3),
          row('CRSS 4310', 'Seed Technology', 3),
          row('CRSS 4350', 'Herbicide Technology', 3),
          row('CRSS 4450', 'Crop Physiology', 3),
          row('CRSS 4580', 'Soil Erosion and Conservation', 3),
          row('ENTO 4350', 'Crop-Specific Insect Management', 4),
          row('ENTO 4500E', 'Biological Control', 3),
          row('ENTO 4740', 'Integrated Pest Management', 3),
          row('GEOG 4370', 'Geographic Information Science', 3),
          row('HORT 3010', 'Introduction to Vegetable Crops', 3),
          row('HORT 3020', 'Introduction to Fruit Crops', 3),
          row('HORT 3300E', 'Organic Gardening', 3),
          row('HORT 4050', 'Greenhouse Management I', 4),
          row('HORT 4125', 'Organic Agricultural Systems', 4),
          row('HORT 4430', 'Plant Physiology', 3),
          row('HORT 4800', 'Agricultural Biotechnology', 3),
          row('PBIO 4500', 'Introduction to Gene Technology', 3),
          row('POUL 3750', 'Integrated Animal Nutrition', 4),
        ]),
        hoursFrom(focus(1, 'Agriscience and Environmental Systems (General)', 'Major Electives'), 6, CAES_ELECTIVE_SUBJECTS, '3000- to 6000-level courses with the prefixes the Bulletin lists.'),
        all(focus(2, 'Area of Emphasis in Plant Breeding and Genetics'), [
          row('GENE 3200', 'Genetics', 4),
          row('PBGG 4140', 'Plant Breeding', 3),
        ]),
        choose(focus(2, 'Area of Emphasis in Plant Breeding and Genetics', 'physiology'), 1, [
          row('CRSS 4450', 'Crop Physiology', 3),
          row('HORT 4430', 'Plant Physiology', 3),
        ], 'Only one of these courses counts.'),
        choose(focus(2, 'Area of Emphasis in Plant Breeding and Genetics', 'biotechnology'), 1, [
          row('HORT 4800', 'Agricultural Biotechnology', 3),
          row('PBIO 4500', 'Introduction to Gene Technology', 3),
        ], 'Only one of these courses counts.'),
        choose(focus(2, 'Area of Emphasis in Plant Breeding and Genetics', 'Plant Production Management Courses'), 1, [
          row('ADSC 4350', 'Grazing Animal Production and Management', 3),
          row('CRSS 3270', 'Turf Management', 3),
          row('CRSS 4090', 'Turfgrass Physiology and Ecology', 3),
          row('CRSS 4260', 'Forage Management and Utilization', 3),
          row('CRSS 4310', 'Seed Technology', 3),
          row('HORT 3010', 'Introduction to Vegetable Crops', 3),
          row('HORT 3020', 'Introduction to Fruit Crops', 3),
          row('HORT 3300E', 'Organic Gardening', 3),
          row('HORT 4050', 'Greenhouse Management I', 4),
          row('HORT 4125', 'Organic Agricultural Systems', 4),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Plant Breeding and Genetics', 'Major Electives'), 3, CAES_ELECTIVE_SUBJECTS, '3000- to 6000-level courses with the prefixes the Bulletin lists.'),
        all(focus(3, 'Area of Emphasis in Precision Agriculture'), [
          row('CRSS 4150', 'Principles of Remote Sensing for Agriculture Sciences', 3),
        ]),
        hoursFrom(focus(3, 'Area of Emphasis in Precision Agriculture', 'precision agriculture courses'), 9, [
          row('AESC 4200', 'Artificial Intelligence (AI) in Agriculture: Principles and Applications', 3),
          row('CRSS 4030', 'Sensors in Precision Agriculture', 3),
          row('CRSS 4060', 'Advanced Topics in Precision Agriculture', 3),
          row('CRSS 4070', 'UAV Technology for Crop Sciences', 3),
          row('CRSS 4280', 'Programming Precision Agriculture', 3),
          row('ECSE 4410', 'Pattern Recognition', 3),
          row('ECSE 4420', 'Deep Learning', 3),
          row('POUL 3270', 'Applied Digital Image Processing for Biological Systems', 3),
        ]),
        choose(focus(3, 'Area of Emphasis in Precision Agriculture', 'Agribusiness Courses'), 1, [
          row('AAEC 3010', 'Farm Organization and Management', 3),
          row('AAEC 3040', 'Agribusiness Marketing', 3),
          row('AAEC 3100', 'Food and Fiber Marketing', 3),
          row('AAEC 3200', 'Selling in Agribusiness', 3),
          row('AAEC 3400', 'Introduction to Agricultural Policy', 3),
          row('AAEC 3600', 'Economics of Food Policy', 3),
          row('AAEC 3690', 'Agribusiness Finance', 4),
          row('AAEC 3980E', 'Introduction to Agribusiness Management', 3),
          row('AAEC 4051E', 'Food Law and Regulation', 3),
          row('AAEC 4070', 'Livestock, Dairy, and Poultry Supply Chain Economics', 3),
          row('AAEC 4710', 'Rural Economic Development and Growth', 3),
          row('ENVM 3060', 'Principles of Resource Economics', 3),
        ]),
        choose(focus(3, 'Area of Emphasis in Precision Agriculture', 'Production Management Courses'), 2, [
          row('ADSC 3300', 'Animal Nutrition and Metabolism', 3),
          row('ADSC 3400', 'Physiology of Reproduction in Domestic Animals', 3),
          row('ADSC 3600', 'Beef Cattle Production and Management', 3),
          row('ADSC 3620', 'Dairy Cattle Production and Management', 3),
          row('ADSC 3630', 'Horse Production and Management', 3),
          row('ADSC 4010', 'Issues in Animal Agriculture', 3),
          row('ADSC 4350', 'Grazing Animal Production and Management', 3),
          row('CRSS 3270', 'Turf Management', 3),
          row('CRSS 4030', 'Sensors in Precision Agriculture', 3),
          row('CRSS 4060', 'Advanced Topics in Precision Agriculture', 3),
          row('CRSS 4090', 'Turfgrass Physiology and Ecology', 3),
          row('CRSS 4260', 'Forage Management and Utilization', 3),
          row('CRSS 4310', 'Seed Technology', 3),
          row('CRSS 4350', 'Herbicide Technology', 3),
          row('CRSS 4450', 'Crop Physiology', 3),
          row('CRSS 4580', 'Soil Erosion and Conservation', 3),
          row('ENTO 4350', 'Crop-Specific Insect Management', 4),
          row('ENTO 4500E', 'Biological Control', 3),
          row('ENTO 4740', 'Integrated Pest Management', 3),
          row('GEOG 4370', 'Geographic Information Science', 3),
          row('HORT 3010', 'Introduction to Vegetable Crops', 3),
          row('HORT 3020', 'Introduction to Fruit Crops', 3),
          row('HORT 3300E', 'Organic Gardening', 3),
          row('HORT 4050', 'Greenhouse Management I', 4),
          row('HORT 4125', 'Organic Agricultural Systems', 4),
          row('HORT 4430', 'Plant Physiology', 3),
          row('HORT 4800', 'Agricultural Biotechnology', 3),
          row('PBIO 4500', 'Introduction to Gene Technology', 3),
          row('POUL 3750', 'Integrated Animal Nutrition', 4),
        ]),
        fromLists(fromLists(hoursFromLists(focus(4, 'Area of Emphasis in Sustainable Agriculture'), 9, {
          'Section 1': [
            row('CRSS 3050', 'Introduction to Water Quality', 4),
            row('CRSS 4540', 'Pedology', 4),
            row('CRSS 4580', 'Soil Erosion and Conservation', 3),
            row('CRSS 4600', 'Soil Physics', 3),
            row('CRSS 4610', 'Soil Microbiology', 4),
            row('CRSS 4670', 'Environmental Soil Chemistry', 3),
            row('CRSS 4750', 'Environmental Turfgrass Science', 3),
            row('EHSC 3060', 'Foundations in Environmental Health', 3),
            row('WASR 4700L', 'Hydrology, Geology, and Soils of Georgia', 3),
          ],
          'Section 2': [
            row('ADSC 4000', 'Sustainability of Resilient Global Food Systems', 3),
            row('AESC 3110', 'Recognizing the Multicultural History of American Agriculture', 3),
            row('ANTH 4255', 'Culture and Agriculture', 3),
            row('CRSS 4020S', 'Social Sustainability in Agricultural and Food Systems', 3),
            row('ECOL 4880', 'Environmental and Natural Resource Policy', 3),
            row('FANR 4271', 'People, Planet, and Profit', 3),
            row('GEOG 4890S', 'Athens Urban Food Collective (AUFC) Service-Learning', 3),
            row('SOCI 3400', 'Environmental Sociology', 3),
          ],
        }, 'Three courses, at least one from Section 1 and one from Section 2.'), 1, 'At least one course from Section 1.', 'Section 1'), 1, 'At least one course from Section 2.', 'Section 2'),
        choose(focus(4, 'Area of Emphasis in Sustainable Agriculture', 'Agribusiness Courses'), 1, [
          row('AAEC 3010', 'Farm Organization and Management', 3),
          row('AAEC 3040', 'Agribusiness Marketing', 3),
          row('AAEC 3100', 'Food and Fiber Marketing', 3),
          row('AAEC 3200', 'Selling in Agribusiness', 3),
          row('AAEC 3400', 'Introduction to Agricultural Policy', 3),
          row('AAEC 3600', 'Economics of Food Policy', 3),
          row('AAEC 3690', 'Agribusiness Finance', 4),
          row('AAEC 3980', 'Introduction to Agribusiness Management', 3),
          row('AAEC 4051E', 'Food Law and Regulation', 3),
          row('AAEC 4070', 'Livestock, Dairy, and Poultry Supply Chain Economics', 3),
          row('AAEC 4710', 'Rural Economic Development and Growth', 3),
          row('AAEC 4720', 'Applied International Development Economics', 3),
          row('ENVM 3060', 'Principles of Resource Economics', 3),
          row('ENVM 4380', 'Environmental Management and Sustainable Business Practices', 3),
          row('ENVM 4930', 'Environmental Law and Governmental Regulation', 3),
        ]),
        choose(focus(4, 'Area of Emphasis in Sustainable Agriculture', 'Production Management Courses'), 2, [
          row('ADSC 3300', 'Animal Nutrition and Metabolism', 3),
          row('ADSC 3400', 'Physiology of Reproduction in Domestic Animals', 3),
          row('ADSC 3600', 'Beef Cattle Production and Management', 3),
          row('ADSC 3620', 'Dairy Cattle Production and Management', 3),
          row('ADSC 3630', 'Horse Production and Management', 3),
          row('ADSC 4010', 'Issues in Animal Agriculture', 3),
          row('ADSC 4350', 'Grazing Animal Production and Management', 3),
          row('CRSS 3270', 'Turf Management', 3),
          row('CRSS 4030', 'Sensors in Precision Agriculture', 3),
          row('CRSS 4060', 'Advanced Topics in Precision Agriculture', 3),
          row('CRSS 4090', 'Turfgrass Physiology and Ecology', 3),
          row('CRSS 4260', 'Forage Management and Utilization', 3),
          row('CRSS 4310', 'Seed Technology', 3),
          row('CRSS 4350', 'Herbicide Technology', 3),
          row('CRSS 4450', 'Crop Physiology', 3),
          row('CRSS 4580', 'Soil Erosion and Conservation', 3),
          row('ENTO 4350', 'Crop-Specific Insect Management', 4),
          row('ENTO 4500E', 'Biological Control', 3),
          row('ENTO 4740', 'Integrated Pest Management', 3),
          row('GEOG 4370', 'Geographic Information Science', 3),
          row('HORT 3010', 'Introduction to Vegetable Crops', 3),
          row('HORT 3020', 'Introduction to Fruit Crops', 3),
          row('HORT 3300E', 'Organic Gardening', 3),
          row('HORT 4050', 'Greenhouse Management I', 4),
          row('HORT 4125', 'Organic Agricultural Systems', 4),
          row('HORT 4430', 'Plant Physiology', 3),
          row('HORT 4800', 'Agricultural Biotechnology', 3),
          row('PBIO 4500', 'Introduction to Gene Technology', 3),
          row('POUL 3750', 'Integrated Animal Nutrition', 4),
        ]),
      ]),
      // 3 to 7 hours; Plant Breeding and Genetics 5 to 6, Precision Agriculture 0 to 3, Sustainable Agriculture 2 to 7, with advisor approval.
      generalElectives(3),
    ],
  },
  /*
   * Fisheries and Wildlife BSFR (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/70392): Required Courses (60 hours)
   * are the Fisheries and Wildlife Requirements (25 hours) and one Area of
   * Emphasis (35 hours: Aquatic Sciences, Wildlife Sciences, or Wildlife
   * Sciences Pre-Veterinary Medicine); the reading required all three (204
   * of 120 hours) and left 57 hours unnamed. The economics requirement is
   * met in the core or as a major elective.
   */
  '70392': {
    // Area VI's elective course: with the general electives (an area of its own here, as the degree has none).
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
      ], 'University System of Georgia STAT 1DXX and STAT 2DXX courses also count.'),
    ]),
    major: [
      area('General Electives', 4, []),
      area('Required Courses', 60, [
        choose('Economics Requirement', 1, [
          row('AAEC 2580', 'Applied Microeconomic Principles', 3),
          row('ECON 2100', 'Economics of Environmental Quality', 3),
          row('ECON 2105', 'Principles of Macroeconomics', 3),
          row('ECON 2106', 'Principles of Microeconomics', 3),
          row('ECON 2200', 'Economic Development of the United States', 3),
          row('FANR 3300', 'Economics of Renewable Resources', 2),
        ], 'As part of the core curriculum or as a major elective.'),
        all('Fisheries and Wildlife Requirements', [
          row('FANR 3800', 'Spatial Analysis of Natural Resources', 2),
          lab('FANR 3800L', 'Spatial Analysis of Natural Resources Laboratory', 1),
          row('FANR 4820', 'Human Dimensions of Natural Resources and Wildlife Conservation', 3),
          row('WILD 3001', 'Fish and Wildlife Policy', 1),
          row('WILD 3580', 'Vertebrate Natural History', 3),
          lab('WILD 3580L', 'Vertebrate Natural History Laboratory', 1),
          row('WILD 4110', 'Wildlife Science: Design, Sampling, Analyses, and Inferences for Fish and Wildlife Populations', 3),
          lab('WILD 4110L', 'Wildlife Science Lab', 1),
        ], 'Entering the major asks for BIOL 1107 and 1108, CHEM 1211 (with their labs), calculus, statistics, an application to Warnell and a 2.50 GPA.'),
        oneGroup('Fisheries and Wildlife Requirements: ecology', 4, [
          [row('FANR 3200W', 'Ecology of Natural Resources', 3), lab('FANR 3200L', 'Ecology of Natural Resources Laboratory', 1)],
          [row('ECOL 3500', 'Ecology', 3), lab('ECOL 3500L', 'Ecology Laboratory', 1)],
        ], 'Choose 1 course (with its lab).'),
        choose('Fisheries and Wildlife Requirements: fish and wildlife management', 1, [
          row('WILD 1100E', 'Wildlife in America', 2),
          row('WILD 3000W', 'Introduction to Fish and Wildlife Management', 2),
        ]),
        hoursFrom('Fisheries and Wildlife Requirements: capstone', 4, [
          row('FANR 4501', 'Senior Project in Natural Resources I', 1),
          lab('FANR 4502S', 'Senior Project in Natural Resources II', 3),
          row('FANR 4960R', 'Faculty-Mentored Undergraduate Research in Natural Resources I', 3),
          row('FANR 4970R', 'Faculty-Mentored Undergraduate Research in Natural Resources II', 3),
          row('FANR 4980R', 'Faculty-Mentored Undergraduate Research in Natural Resources III', 3),
          row('FANR 4990R', 'Senior Thesis in Natural Resources', 4),
        ], 'FANR 4501 and FANR 4502S (Senior Project), or faculty-mentored research or senior thesis (at least 1 hour of FANR 4990R).'),
        all(focus(1, 'Area of Emphasis in Aquatic Sciences'), [
          row('CRSS 3060', 'Soils and Hydrology', 3),
          lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
          row('FISH 4200', 'Aquatic Biology', 3),
          lab('FISH 4200L', 'Aquatic Biology Lab', 1),
          row('FISH 4300', 'Environmental Biology of Fishes', 3),
          lab('FISH 4300L', 'Environmental Biology of Fishes Laboratory', 1),
          row('FISH 4500', 'Fish Physiology', 3),
          lab('FISH 4500L', 'Fish Physiology Lab', 1),
          row('FISH 5360', 'Fisheries Management', 3),
          lab('FISH 5360L', 'Fisheries Management Laboratory', 1),
        ]),
        hoursFrom(focus(1, 'Area of Emphasis in Aquatic Sciences', 'Fisheries and Wildlife Sciences Restricted Elective'), 3, [
          row('FANR 4350', 'Conservation Genetics', 3),
          row('FISH 3900', 'Fisheries Internship', 3),
          row('FISH 4360', 'Fish Ecology', 4),
          row('FISH 4550', 'Sustainable Aquaculture', 4),
          row('FISH 4650L', 'Georgia Fishes Field Study', 4),
          row('FANR 5950', 'Special Topics in Forestry and Natural Resources', 3),
          row('WILD 4040', 'Herpetology', 4),
          row('WILD 4400', 'Wildlife Physiology and Nutrition', 3),
          row('WILD 5700', 'Applied Population Dynamics', 2),
          lab('WILD 5700L', 'Applied Population Dynamics Lab', 1),
        ]),
        hoursFrom(focus(1, 'Area of Emphasis in Aquatic Sciences', 'Aquatic Sciences Restricted Elective'), 3, [
          row('ECOL 3220', 'Biology and Conservation of Marine Mammals', 3),
          row('ECOL 4225', 'Methods in Marine Ecology', 4),
          row('ECOL 4330', 'Tropical Marine Invertebrates', 4),
          row('ENTO 4000', 'General Entomology', 4),
          row('ENTO 4940', 'Aquatic Entomology', 4),
          row('FANR 4350', 'Conservation Genetics', 3),
          row('MARS 3200', 'Fundamentals of Ocean Science', 3),
          row('MARS 4510', 'Field Study in Oceanography and Marine Methods: Independent Research', 3),
          row('MARS 4740L', 'Scientific Diving I', 2),
          row('MARS 4750', 'Scientific Diving II', 3),
          row('WASR 4110', 'Forest Hydrology', 4),
          row('WASR 4400', 'Wetland Management and Restoration', 3),
          row('WASR 4500', 'Quantitative Methods in Hydrology', 3),
          row('WILD 3900', 'Wildlife Internship', 3),
          row('WILD 4040', 'Herpetology', 4),
          row('WILD 4400', 'Wildlife Physiology and Nutrition', 3),
          row('WILD 5700', 'Applied Population Dynamics', 2),
          lab('WILD 5700L', 'Applied Population Dynamics Lab', 1),
        ], 'Or another course the advisor approves.'),
        hoursFrom(focus(1, 'Area of Emphasis in Aquatic Sciences', 'Open Major Electives'), 9, [
          row('BIOL 3720L', 'Field Animal Behavior', 3),
          row('CHEM 2212', 'Modern Organic Chemistry II', 3),
          lab('CHEM 2212L', 'Modern Organic Chemistry Laboratory II', 1),
          row('ECOL 3100', 'Tropical Field Ecology', 4),
          row('ECOL 3220', 'Biology and Conservation of Marine Mammals', 3),
          row('ECOL 3220L', 'Marine Mammals Laboratory', 1),
          row('ECOL 4010', 'Ecosystem Ecology', 3),
          row('ECOL 4225', 'Methods in Marine Ecology', 4),
          row('ECOL 4240', 'Physiological Ecology', 3),
          row('ECOL 4330', 'Tropical Marine Invertebrates', 4),
          row('ECOL 8060', 'Ecology Seminar Series', 1),
          row('ENTO 4000', 'General Entomology', 4),
          row('ENTO 4940', 'Aquatic Entomology', 4),
          row('GENE 3000', 'Evolutionary Biology', 4),
          row('MARS 3200', 'Fundamentals of Ocean Science', 3),
          row('MARS 3450', 'Marine Biology', 3),
          row('MARS 3450L', 'Marine Biology Laboratory', 1),
          row('MARS 4510', 'Field Study in Oceanography and Marine Methods: Independent Research', 3),
          row('MARS 4740L', 'Scientific Diving I', 2),
          row('MARS 4750', 'Scientific Diving II', 3),
          row('PHYS 1112', 'Introductory Physics-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1212', 'Principles of Physics for Scientists and Engineers-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1312', 'Advanced Introductory Physics II', 4),
          row('COFA 3900', 'Community Forestry and Arboriculture Internship', 3),
          row('FISH 3900', 'Fisheries Internship', 3),
          row('FORS 3900', 'Forestry Internship', 3),
          row('GISC 3900', 'Geospatial Information Science Internship', 3),
          row('PRTM 3900', 'Parks, Recreation, and Tourism Management Internship', 3),
          row('WASR 3900', 'Water and Soil Resources Internship', 3),
          row('WILD 3900', 'Wildlife Internship', 3),
        ], 'Not WILD(FISH) 3000W; at most 3 hours of one internship course.'),
        all(focus(2, 'Area of Emphasis in Wildlife Sciences'), [
          row('CRSS 3060', 'Soils and Hydrology', 3),
          lab('CRSS 3060L', 'Soils and Hydrology Laboratory', 1),
          row('FORS 3010', 'Dendrology', 2),
          lab('FORS 3010L', 'Dendrology Laboratory', 1),
          row('WILD 4100', 'Principles of Wildlife Habitat and Management', 3),
        ]),
        oneGroup(focus(2, 'Area of Emphasis in Wildlife Sciences', 'wildlife biology'), 4, [
          [row('WILD 4040', 'Herpetology', 4)],
          [row('WILD 4050', 'Mammalogy', 3), lab('WILD 4050L', 'Mammalogy Laboratory', 1)],
          [row('WILD 4060', 'Ornithology', 4)],
        ], 'Organismal Biology and Ecology: Wildlife Biology Elective (4 hours).'),
        hoursFrom(focus(2, 'Area of Emphasis in Wildlife Sciences', 'zoology'), 3, [
          row('BIOL 3720L', 'Field Animal Behavior', 3),
          row('ECOL 3220', 'Biology and Conservation of Marine Mammals', 3),
          row('ECOL 4050', 'Ichthyology', 4),
          row('ECOL 4240', 'Physiological Ecology', 3),
          row('ENTO 4000', 'General Entomology', 4),
          row('FANR 4350', 'Conservation Genetics', 3),
          row('FISH 4300', 'Environmental Biology of Fishes', 3),
          lab('FISH 4300L', 'Environmental Biology of Fishes Laboratory', 1),
          row('FISH 4650L', 'Georgia Fishes Field Study', 4),
          row('WILD 4040', 'Herpetology', 4),
          row('WILD 4050', 'Mammalogy', 3),
          lab('WILD 4050L', 'Mammalogy Laboratory', 1),
          row('WILD 4060', 'Ornithology', 4),
          row('WILD 4400', 'Wildlife Physiology and Nutrition', 3),
          row('WILD 4575', 'Conservation Medicine', 6),
          row('WILD 4740', 'Animal Behavior', 3),
          row('WILD 5100', 'Principles and Management of Wildlife Diseases', 3),
        ], 'Organismal Biology and Ecology: Zoology Elective (3 hours).'),
        oneGroup(focus(2, 'Area of Emphasis in Wildlife Sciences', 'population ecology'), 3, [
          [row('ECOL 4000', 'Population and Community Ecology', 3)],
          [row('WILD 5700', 'Applied Population Dynamics', 2), lab('WILD 5700L', 'Applied Population Dynamics Lab', 1)],
        ], 'Population Ecology, Conservation, and Management (3 hours).'),
        hoursFrom(focus(2, 'Area of Emphasis in Wildlife Sciences', 'policy, law and decision-making'), 2, [
          row('ECOL 4220', 'Restoration Ecology', 3),
          row('ENVM 4930', 'Environmental Law and Governmental Regulation', 3),
          row('FANR 3400', 'Society and Natural Resources', 2),
          row('FANR 4020', 'Sustainable Development', 3),
          row('FANR 4271', 'People, Planet, and Profit', 3),
          row('FANR 4800W', 'Renewable Resources Policy', 2),
          row('JURI 4810', 'Natural Resources Law', 3),
          row('WILD 4500', 'Nongame and Endangered Species Management', 3),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Wildlife Sciences', 'Open Major Electives'), 13, [
          row('BIOL 3720L', 'Field Animal Behavior', 3),
          row('CBIO 3710', 'Principles of Physiology', 3),
          row('CHEM 2212', 'Modern Organic Chemistry II', 3),
          lab('CHEM 2212L', 'Modern Organic Chemistry Laboratory II', 1),
          row('ECOL 3100', 'Tropical Field Ecology', 4),
          row('ECOL 3220', 'Biology and Conservation of Marine Mammals', 3),
          row('ECOL 3220L', 'Marine Mammals Laboratory', 1),
          row('ECOL 3510', 'Ecology Laboratory', 3),
          row('ECOL 3530', 'Conservation Biology', 3),
          row('ECOL 3770S', 'Urban Ecology - Service Learning', 3),
          row('ECOL 4010', 'Ecosystem Ecology', 3),
          row('ECOL 4160', 'Ecology of North America', 4),
          row('ECOL 4240', 'Physiological Ecology', 3),
          row('EHSC 4610', 'Water Pollution and Human Health', 3),
          row('ENTO 4000', 'General Entomology', 4),
          row('FANR 1100', 'Natural Resources Conservation', 3),
          row('FANR 1200', 'Natural History of Georgia', 3),
          row('GENE 3000', 'Evolutionary Biology', 4),
          row('GENE 3200', 'Genetics', 4),
          row('HORT 3620', 'Plant Propagation', 3),
          row('PHYS 1112', 'Introductory Physics-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1212', 'Principles of Physics for Scientists and Engineers-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1312', 'Advanced Introductory Physics II', 4),
          row('POUL 4060', 'Reproductive Endocrinology', 3),
          row('COFA 3900', 'Community Forestry and Arboriculture Internship', 3),
          row('FISH 3900', 'Fisheries Internship', 3),
          row('FORS 3900', 'Forestry Internship', 3),
          row('GISC 3900', 'Geospatial Information Science Internship', 3),
          row('PRTM 3900', 'Parks, Recreation, and Tourism Management Internship', 3),
          row('WILD 3900', 'Wildlife Internship', 3),
        ], 'Not WILD(FISH) 3000W; at most 3 hours of one internship course.'),
        all(focus(3, 'Area of Emphasis in Wildlife Sciences Pre-Veterinary Medicine'), [
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('FORS 3010', 'Dendrology', 2),
          lab('FORS 3010L', 'Dendrology Laboratory', 1),
          row('WILD 4100', 'Principles of Wildlife Habitat and Management', 3),
          row('WILD 5100', 'Principles and Management of Wildlife Diseases', 3),
        ], 'Veterinary school also asks for CHEM 2211, CHEM 2212 (with their labs) and two semesters of physics.'),
        oneGroup(focus(3, 'Area of Emphasis in Wildlife Sciences Pre-Veterinary Medicine', 'wildlife biology'), 4, [
          [row('WILD 4040', 'Herpetology', 4)],
          [row('WILD 4050', 'Mammalogy', 3), lab('WILD 4050L', 'Mammalogy Laboratory', 1)],
          [row('WILD 4060', 'Ornithology', 4)],
        ], 'Organismal Biology and Ecology: Wildlife Biology Elective (4 hours).'),
        hoursFrom(focus(3, 'Area of Emphasis in Wildlife Sciences Pre-Veterinary Medicine', 'zoology'), 3, [
          row('BIOL 3720L', 'Field Animal Behavior', 3),
          row('ECOL 3220', 'Biology and Conservation of Marine Mammals', 3),
          row('ECOL 4050', 'Ichthyology', 4),
          row('ECOL 4240', 'Physiological Ecology', 3),
          row('FANR 4350', 'Conservation Genetics', 3),
          row('FISH 4300', 'Environmental Biology of Fishes', 3),
          row('FISH 4650L', 'Georgia Fishes Field Study', 4),
          row('WILD 4040', 'Herpetology', 4),
          row('WILD 4050', 'Mammalogy', 3),
          lab('WILD 4050L', 'Mammalogy Laboratory', 1),
          row('WILD 4060', 'Ornithology', 4),
          row('WILD 4400', 'Wildlife Physiology and Nutrition', 3),
          row('WILD 4575', 'Conservation Medicine', 6),
          row('WILD 4740', 'Animal Behavior', 3),
          row('WILD 5100', 'Principles and Management of Wildlife Diseases', 3),
        ], 'Organismal Biology and Ecology: Zoology Elective (3 hours).'),
        oneGroup(focus(3, 'Area of Emphasis in Wildlife Sciences Pre-Veterinary Medicine', 'population ecology'), 3, [
          [row('ECOL 4000', 'Population and Community Ecology', 3)],
          [row('WILD 5700', 'Applied Population Dynamics', 2), lab('WILD 5700L', 'Applied Population Dynamics Lab', 1)],
        ], 'Population Ecology, Conservation, and Management (3 hours).'),
        hoursFrom(focus(3, 'Area of Emphasis in Wildlife Sciences Pre-Veterinary Medicine', 'policy, law and decision-making'), 2, [
          row('ECOL 4220', 'Restoration Ecology', 3),
          row('ENVM 4930', 'Environmental Law and Governmental Regulation', 3),
          row('FANR 3400', 'Society and Natural Resources', 2),
          row('FANR 4020', 'Sustainable Development', 3),
          row('FANR 4271', 'People, Planet, and Profit', 3),
          row('FANR 4800W', 'Renewable Resources Policy', 2),
          row('JURI 4810', 'Natural Resources Law', 3),
          row('WILD 4500', 'Nongame and Endangered Species Management', 3),
        ]),
        hoursFrom(focus(3, 'Area of Emphasis in Wildlife Sciences Pre-Veterinary Medicine', 'Open Major Electives'), 10, [
          row('BIOL 3720L', 'Field Animal Behavior', 3),
          row('CBIO 3710', 'Principles of Physiology', 3),
          row('CHEM 2212', 'Modern Organic Chemistry II', 3),
          lab('CHEM 2212L', 'Modern Organic Chemistry Laboratory II', 1),
          row('ECOL 3100', 'Tropical Field Ecology', 4),
          row('ECOL 3220', 'Biology and Conservation of Marine Mammals', 3),
          row('ECOL 3220L', 'Marine Mammals Laboratory', 1),
          row('ECOL 3510', 'Ecology Laboratory', 3),
          row('ECOL 3530', 'Conservation Biology', 3),
          row('ECOL 3770S', 'Urban Ecology - Service Learning', 3),
          row('ECOL 4010', 'Ecosystem Ecology', 3),
          row('ECOL 4160', 'Ecology of North America', 4),
          row('ECOL 4240', 'Physiological Ecology', 3),
          row('EHSC 4610', 'Water Pollution and Human Health', 3),
          row('ENTO 4000', 'General Entomology', 4),
          row('FANR 1100', 'Natural Resources Conservation', 3),
          row('FANR 1200', 'Natural History of Georgia', 3),
          row('GENE 3000', 'Evolutionary Biology', 4),
          row('GENE 3200', 'Genetics', 4),
          row('HORT 3620', 'Plant Propagation', 3),
          row('PHYS 1112', 'Introductory Physics-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1212', 'Principles of Physics for Scientists and Engineers-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1312', 'Advanced Introductory Physics II', 4),
          row('POUL 4060', 'Reproductive Endocrinology', 3),
          row('COFA 3900', 'Community Forestry and Arboriculture Internship', 3),
          row('FISH 3900', 'Fisheries Internship', 3),
          row('FORS 3900', 'Forestry Internship', 3),
          row('GISC 3900', 'Geospatial Information Science Internship', 3),
          row('PRTM 3900', 'Parks, Recreation, and Tourism Management Internship', 3),
          row('WILD 3900', 'Wildlife Internship', 3),
        ], 'Not WILD(FISH) 3000W; at most 3 hours of one internship course.'),
      ]),
    ],
  },
  /*
   * Health Promotion BSHP (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/33197): Area VI and the Required
   * Courses' last part depend on the student's Area of Emphasis (Health
   * Promotion, Health Services or Behavioral Medicine); the reading left the
   * choice optional, so a board without a pick had no Area VI, and misread
   * all three. PBHL 3100 and HPRB 5560S are required for the Health
   * Promotion and Health Services emphases only. Each emphasis's Area VI
   * courses are with its rows.
   */
  '33197': {
    areaSix: area('VI. Courses Related to the Major', 6, [
      all('VI. Courses Related to the Major', [
        row('HPRB 1710', 'Health and Wellness', 3),
      ], 'A grade of C or better in every Area VI course; see a Health Promotion advisor before completing Area VI.'),
      choose('Biostatistics', 1, [
        row('BIOS 2010', 'Elementary Biostatistics', 4),
        row('BIOS 7010', 'Fundamentals of Biostatistical Reasoning', 3),
      ], 'BIOS 7010 for Double Dawgs students.'),
    ]),
    major: [
      area('Required Courses', 69, [
        choose('Core - College of Public Health: biostatistics', 1, [
          row('BIOS 3000', 'Intermediate Biostatistics', 3),
        ], 'Double Dawgs students may take BIOS 7020 instead; the graduate-level choices of the college core are left off the plan (a freshman board booked EHSC 7010, 2026-10-30).'),
        choose('Core - College of Public Health: environmental health', 1, [
          row('EHSC 3060', 'Foundations in Environmental Health', 3),
        ], 'Double Dawgs students may take EHSC 7010 instead.'),
        choose('Core - College of Public Health: epidemiology', 1, [
          row('EPID 4070', 'Fundamentals of Epidemiology', 3),
        ], 'Double Dawgs students may take EPID 7010 instead.'),
        choose('Core - College of Public Health: health policy', 1, [
          row('HPAM 3600', 'Introduction to Health Policy', 3),
        ], 'Double Dawgs students may take HPAM 7010 instead (the graduate-level courses are preferred only for them).'),
        all('Core - Health Promotion and Behavior', [
          row('HPRB 3020', 'Foundations of Health Promotion Professional Practice', 3),
          row('HPRB 3700', 'Community Health', 3),
          row('HPRB 3850', 'Chronic Disease Prevention', 3),
          row('HPRB 4400', 'Health Promotion Program Development', 3),
          row('HPRB 5010', 'Research Design and Methods in Health Promotion', 3),
          row('HPRB 5410W', 'Professional Writing for Health Promotion', 3),
          row('HPRB 5900', 'Capstone in Health Promotion and Behavior', 1),
        ]),
        all(focus(1, 'Area of Emphasis in Health Promotion'), [
          row('PBHL 3100', 'Introduction to Public Health', 3),
          row('HPRB 5560S', 'Field Experience in Health Promotion', 6),
          row('COMM 1110', 'Introduction to Public Speaking', 3),
        ], 'COMM 1110 is an Area VI course.'),
        oneGroup(focus(1, 'Area of Emphasis in Health Promotion', 'Area VI pair'), 6, [
          [row('CBIO 2200', 'Anatomy and Physiology I', 4), row('CBIO 2210', 'Anatomy and Physiology II', 4)],
          [row('EPID 2100', 'Health Data Literacy for Public Health Research and Practice', 3), row('EPID 3100', 'Health Data Fluency and Management for Public Health Research and Practice', 3)],
          [row('PSYC 1101', 'Elementary Psychology', 3), row('PSYC 3230', 'Psychopathology', 3)],
        ], 'Area VI: one group of two courses.'),
        hoursFrom(focus(1, 'Area of Emphasis in Health Promotion', 'electives'), 20, [
          ...levels('HPRB', 3),
          ...['BIOS', 'DMAN', 'EHSC', 'EPID', 'GLOB', 'GRNT', 'HPAM'].flatMap((subject) => levels(subject, 3)),
          row('AFAM 4500', 'Psychology of Prejudice', 3),
          row('ANTH 3540', 'Multicultural Health Care', 3),
          row('COMM 3320', 'Environmental Communication', 3),
          row('COMM 3820', 'Ethnicity-Race Communication', 3),
          row('ECHD 3170', 'Drug and Alcohol Abuse Issues', 3),
          row('HIST 3740', 'Disease and Human History', 3),
          row('HORT 3440', 'Herbs, Spices, and Medicinal Plants', 3),
          row('IDIS 3100', 'People, Parasites, and Plagues', 3),
          row('KINS 3700', 'Applied Exercise Physiology', 3),
          row('KINS 4310', 'Exercise Prescription for Special Populations', 3),
          row('KINS 4320', 'Habitual Movement and Successful Aging', 3),
          row('KINS 4640', 'Scientific Principles of Conditioning and Fitness', 4),
          row('LAND 4120', 'Designing Healthy Places', 3),
          row('NUTR 4050', 'Optimal Nutrition for the Life Span', 3),
          row('NUTR 4510', 'Nutrition Related to the Human Life Cycle', 3),
          row('NUTR 4540', 'Public Health Nutrition', 3),
          row('NUTR 4560', 'Nutrition, Health, and Aging', 3),
          row('NUTR 4600', 'Food and Nutrition Policy', 2),
          row('NUTR 4630', 'Cultural Aspects of Foods and Nutrition', 3),
          row('NUTR 5710S', 'Study Tour in Nutritional Sciences', 3),
          row('PSYC 3230', 'Psychopathology', 3),
          row('PSYC 3260', 'Human Sexuality', 3),
          row('PSYC 3810', 'Health Psychology', 3),
          row('SOCI 3100', 'Medical Sociology', 3),
          row('SOCI 3110', 'Sociology of Health Care', 3),
          row('SOCI 3280', 'Sociology of Gender', 3),
          row('SOCI 3860', 'Sociology of Alcohol and Drug Use', 3),
          row('SOCI 4280', 'Global Perspectives on Gender', 3),
        ], 'At least 9 hours of upper-level HPRB (not HPRB 3010 or 3010E); 3000-5999-level BIOS, DMAN, EHSC, EPID, GLOB, GRNT or HPAM courses (not research, independent study or internship courses without an advisor); or the pre-approved courses outside the college. Chosen with the major advisor, to prepare for the internship.'),
        all(focus(2, 'Area of Emphasis in Health Services'), [
          row('PBHL 3100', 'Introduction to Public Health', 3),
          row('HPRB 5560S', 'Field Experience in Health Promotion', 6),
          row('COMM 1110', 'Introduction to Public Speaking', 3),
          row('BIOL 1108', 'Principles of Biology II', 3),
          lab('BIOL 1108L', 'Principles of Biology II Laboratory', 1),
          row('CHEM 1212', 'General Chemistry II', 3),
          lab('CHEM 1212L', 'General Chemistry Laboratory II', 1),
          row('CHEM 2211', 'Modern Organic Chemistry I', 3),
          lab('CHEM 2211L', 'Modern Organic Chemistry Laboratory I', 1),
        ], 'COMM 1110 is an Area VI course.'),
        oneGroup(focus(2, 'Area of Emphasis in Health Services', 'Area VI pair'), 8, [
          [row('CBIO 2200', 'Anatomy and Physiology I', 4), row('CBIO 2210', 'Anatomy and Physiology II', 4)],
          [row('PHYS 1111', 'Introductory Physics-Mechanics, Waves, Thermodynamics', 4), row('PHYS 1112', 'Introductory Physics-Electricity and Magnetism, Optics, Modern Physics', 4)],
          [row('PHYS 1211', 'Principles of Physics for Scientists and Engineers-Mechanics, Waves, Thermodynamics', 4), row('PHYS 1212', 'Principles of Physics for Scientists and Engineers-Electricity and Magnetism, Optics, Modern Physics', 4)],
          [row('PHYS 1311', 'Advanced Introductory Physics I', 4), row('PHYS 1312', 'Advanced Introductory Physics II', 4)],
        ], 'Area VI: one group of two courses.'),
        hoursFrom(focus(2, 'Area of Emphasis in Health Services', 'electives'), 8, [
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('CBIO 3000', 'Comparative Vertebrate Anatomy', 4),
          row('CBIO 3010', 'Functional Human Anatomy', 4),
          row('CBIO 3200L', 'Medical Anatomy', 3),
          row('CBIO 3400', 'Cell Biology', 4),
          row('GENE 3200', 'Genetics', 4),
          row('HPRB 3150', "Women's Health", 3),
          row('HPRB 3480S', 'Practicum in Health Promotion and Services', 3),
          row('HPRB 3750', 'Injury and Violence Prevention', 3),
          row('HPRB 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('HPRB 5060', 'Educational Strategies in Human Sexuality', 3),
          row('HPRB 5210', 'Substance Use and Misuse', 3),
          row('HPRB 5310', 'Strategies for Effective Public Health Communication', 3),
          row('IDIS 3100', 'People, Parasites, and Plagues', 3),
          row('MIBO 3500', 'Introductory Microbiology', 3),
          row('MIBO 3500L', 'Introductory Microbiology Laboratory I', 1),
          row('MIBO 3510L', 'Introductory Microbiology Laboratory II', 3),
          row('PMCY 4020', 'Human Physiology', 3),
          row('VPHY 3100', 'Elements of Physiology', 3),
        ], 'Chosen with the major advisor; only one of each marked pair counts.'),
        all(focus(3, 'Area of Emphasis in Behavioral Medicine'), [
          row('CHEM 1212', 'General Chemistry II', 3),
          lab('CHEM 1212L', 'General Chemistry Laboratory II', 1),
          row('BCMB 3100', 'Introductory Biochemistry and Molecular Biology', 4),
          row('BIOL 1108', 'Principles of Biology II', 3),
          lab('BIOL 1108L', 'Principles of Biology II Laboratory', 1),
          row('CHEM 2211', 'Modern Organic Chemistry I', 3),
          lab('CHEM 2211L', 'Modern Organic Chemistry Laboratory I', 1),
          row('CHEM 2212', 'Modern Organic Chemistry II', 3),
          lab('CHEM 2212L', 'Modern Organic Chemistry Laboratory II', 1),
          row('GENE 3200', 'Genetics', 4),
          row('HPRB 3100', 'Introduction to Behavioral Medicine', 3),
          row('HPRB 3480S', 'Practicum in Health Promotion and Services', 3),
          row('VPHY 3100', 'Elements of Physiology', 3),
        ], 'CHEM 1212 and its lab are Area VI courses.'),
        choose(focus(3, 'Area of Emphasis in Behavioral Medicine', 'physics I'), 1, [
          row('PHYS 1111', 'Introductory Physics-Mechanics, Waves, Thermodynamics', 4),
          row('PHYS 1211', 'Principles of Physics for Scientists and Engineers-Mechanics, Waves, Thermodynamics', 4),
          row('PHYS 1311', 'Advanced Introductory Physics I', 4),
        ], 'An Area VI course.'),
        choose(focus(3, 'Area of Emphasis in Behavioral Medicine', 'physics II'), 1, [
          row('PHYS 1112', 'Introductory Physics-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1212', 'Principles of Physics for Scientists and Engineers-Electricity and Magnetism, Optics, Modern Physics', 4),
          row('PHYS 1312', 'Advanced Introductory Physics II', 4),
        ], 'An Area VI course.'),
      ]),
    ],
  },
  /*
   * Theatre AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/93915):
   * Major Electives (15-21 hours) are one group: Group One (five FILM or
   * THEA courses at the 3000 level and above) or one of six areas of
   * emphasis; the reading left them off a board without a pick and made a
   * picked emphasis require every course listed.
   */
  '93915': {
    major: [
      area('Required Courses', 18, [
        all('Required Courses', [
          row('THEA 3300', 'Design Foundations', 3),
          row('THEA 3340', 'Stagecraft', 3),
          row('THEA 3500', 'Acting I: Foundations of Acting', 3),
        ], 'At least 21 major hours in residence; no non-equivalent transfer credit counts toward the major.'),
        choose('Theatre history', 1, [
          row('THEA 4210', 'Theatre and Modernity', 3),
          row('THEA 4220', 'Theatre and Society', 3),
          row('THEA 4230', 'Theatre and Ritual', 3),
        ]),
        choose('Stage management or play direction', 1, [
          row('THEA 5110', 'Stage Management', 3),
          row('THEA 5600', 'Play Direction', 3),
        ]),
        choose('One more theatre history or theory course', 1, [
          row('THEA 4210', 'Theatre and Modernity', 3),
          row('THEA 4220', 'Theatre and Society', 3),
          row('THEA 4230', 'Theatre and Ritual', 3),
          row('THEA 4280', 'Women in Performance', 3),
          row('THEA 4300', 'Queer Theatre and Film', 3),
          row('THEA 4400', 'Asian Theatre and Drama', 3),
          row('THEA 4460', 'History of Dramatic Art: Special Topics', 3),
          row('THEA 4470', 'African Theatre: An Historical Overview', 3),
          row('THEA 4480', 'History of African American Drama and Theatre', 3),
          row('THEA 4490', 'Latin American and Caribbean Theatre and Performance', 3),
          row('THEA 4500', 'The Broadway Musical and American Culture', 3),
          row('THEA 4700', 'Dramaturgy', 3),
          row('THEA 4750', 'Performance Studies', 3),
          row('THEA 4800', 'Topics in History', 3),
          row('THEA 5710S', 'Community-Based Theatre', 3),
          row('THEA 5870', 'Performing with Media', 3),
        ], 'A 3000-5999-level course not already taken (not THEA 4700 with the Dramatic Writing emphasis).'),
      ]),
      area('Major Electives', 15, [
        hoursFrom(focus(1, 'Group One'), 15, THEATRE_ELECTIVE, 'Five FILM or THEA courses of 3 hours, numbered 3000 and above.'),
        // A choice of every course listed: a list with no number to choose, in an area of electives, is read as hours to draw from.
        choose(focus(2, 'Area of Emphasis in Acting'), 2, [
          row('THEA 5010', 'Acting II: Scene Study', 3),
          row('THEA 5053', 'Senior Seminar', 1),
        ]),
        hoursFrom(focus(2, 'Area of Emphasis in Acting', 'a FILM or THEA course'), 3, THEATRE_ELECTIVE, 'A FILM or THEA course of 3 hours, numbered 3000 and above.'),
        choose(focus(2, 'Area of Emphasis in Acting', 'acting courses'), 4, [
          row('THEA 5080', 'Production Practicum', 3),
          row('THEA 5331', 'Shakespeare', 3),
          row('THEA 5335', 'Shakespeare Practicum', 3),
          row('THEA 5500', 'Acting III: Advanced Acting', 3),
          row('THEA 5510', 'Actor Training I: Physical Actor', 3),
          row('THEA 5530', 'Actor Training II: Voice for the Actor', 3),
          row('THEA 5550', 'Musical Theatre Performance Styles', 3),
          row('THEA 5565', 'The Meisner Technique', 3),
          row('THEA 5570', 'Acting for the Camera', 3),
        ]),
        choose(focus(3, 'Area of Emphasis in Design'), 1, [
          row('THEA 5970', 'Design Portfolio', 1),
        ]),
        choose(focus(3, 'Area of Emphasis in Design', 'design'), 1, [
          row('THEA 5330', 'Costume Design for the Entertainment Arts', 3),
          row('THEA 5351', 'Scenic Design for the Entertainment Arts', 3),
          row('THEA 5352', 'Lighting Design for the Entertainment Arts', 3),
        ]),
        hoursFrom(focus(3, 'Area of Emphasis in Design', 'a FILM or THEA course'), 3, THEATRE_ELECTIVE, 'A FILM or THEA course of 3 hours, numbered 3000 and above.'),
        choose(focus(3, 'Area of Emphasis in Design', 'design and technology courses'), 4, [
          row('THEA 3330', 'Costume Crafts', 3),
          row('THEA 3350', 'Lighting Technology', 3),
          row('THEA 3520', 'Makeup for the Entertainment Arts', 3),
          row('THEA 5310', 'Technical Problems', 3),
          row('THEA 5315', 'CAD 2-D, Drafting for Stage and Production Design', 3),
          row('THEA 5320', 'CAD, 3-D, Modeling, and Visualization for Stage and Production Design', 3),
          row('THEA 5330', 'Costume Design for the Entertainment Arts', 3),
          row('THEA 5340', 'History of Costume and Adornment', 3),
          row('THEA 5341', 'History of Architecture and Decoration', 3),
          row('THEA 5351', 'Scenic Design for the Entertainment Arts', 3),
          row('THEA 5352', 'Lighting Design for the Entertainment Arts', 3),
          row('THEA 5372', 'Scenic Painting', 3),
          row('THEA 5380', 'Design 3D Manufacturing and Technology for the Entertainment Arts', 3),
          row('THEA 5381', 'Entertainment Technology and Skills: Metals and Plastics', 3),
          row('THEA 5382', 'Entertainment Technology and Skills: Rigging, Facilities, and Safety', 3),
          row('THEA 5383', 'Management and Production for Theatre', 3),
          row('THEA 5480', 'Topics in Design', 3),
          row('THEA 5730', 'Advanced Costume Design for the Performance Arts', 3),
          row('THEA 5732', 'Cutting and Draping Patterns for Costuming', 3),
          row('THEA 5733', 'Millinery', 3),
          row('THEA 5734', 'Stage and Screen Fabric Modification', 3),
          row('THEA 5751', 'Advanced Scenic Design for the Entertainment Arts', 3),
          row('THEA 5752', 'Advanced Lighting Design for the Entertainment Arts', 3),
          row('THEA 5756', 'Lighting Controls and Previsualization', 3),
          row('THEA 5757', 'Lighting Design Outside the Theatre', 3),
          row('THEA 5758', 'Architectural and Themed Lighting', 3),
          row('THEA 5880', 'Sound Effects for Stage and Screen', 3),
          row('THEA 5110', 'Stage Management', 3),
        ]),
        choose(focus(4, 'Area of Emphasis in Directing and Stage Management'), 1, [
          row('THEA 5080', 'Production Practicum', 3),
        ]),
        choose(focus(4, 'Area of Emphasis in Directing and Stage Management', 'project or seminar'), 1, [
          row('THEA 4960', 'Directed Readings or Projects', 3),
          row('THEA 4960R', 'Faculty-Mentored Undergraduate Research I', 3),
          row('THEA 5053', 'Senior Seminar', 1),
        ]),
        choose(focus(4, 'Area of Emphasis in Directing and Stage Management', 'stage management or play direction'), 1, [
          row('THEA 5110', 'Stage Management', 3),
          row('THEA 5600', 'Play Direction', 3),
        ]),
        hoursFrom(focus(4, 'Area of Emphasis in Directing and Stage Management', 'a FILM or THEA course'), 3, THEATRE_ELECTIVE, 'A FILM or THEA course of 3 hours, numbered 3000 and above.'),
        choose(focus(4, 'Area of Emphasis in Directing and Stage Management', 'directing and production courses'), 3, [
          row('FILM 4680', 'Introduction to DV Production', 3),
          row('FILM 5640', 'Directing for the Cinema', 3),
          row('THEA 4700', 'Dramaturgy', 3),
          row('THEA 5010', 'Acting II: Scene Study', 3),
          row('THEA 5330', 'Costume Design for the Entertainment Arts', 3),
          row('THEA 5352', 'Lighting Design for the Entertainment Arts', 3),
          row('THEA 5565', 'The Meisner Technique', 3),
          row('THEA 5570', 'Acting for the Camera', 3),
          row('THEA 5610', 'Play Direction Laboratory', 3),
          row('THEA 5630', 'Producing the New Script', 3),
          row('THEA 5710S', 'Community-Based Theatre', 3),
          row('THEA 5880', 'Sound Effects for Stage and Screen', 3),
        ]),
        choose(focus(5, 'Area of Emphasis in Dramatic Media'), 1, [
          row('THEA 5590', 'Special Projects in Drama', 3),
        ]),
        hoursFrom(focus(5, 'Area of Emphasis in Dramatic Media', 'a FILM or THEA course'), 3, THEATRE_ELECTIVE, 'A FILM or THEA course of 3 hours, numbered 3000 and above.'),
        choose(focus(5, 'Area of Emphasis in Dramatic Media', 'media courses'), 5, [
          row('FILM 4680', 'Introduction to DV Production', 3),
          row('FILM 5640', 'Directing for the Cinema', 3),
          row('FILM 5810', 'Computer Animation for Dramatic Media I', 3),
          row('FILM 5820', 'Computer Animation for Dramatic Media II', 3),
          row('FILM 5830', 'Computer Animation for Dramatic Media III', 3),
          row('THEA 4750', 'Performance Studies', 3),
          row('THEA 5310', 'Technical Problems', 3),
          row('THEA 5700', 'Internship in Theatre/Film/Animation', 3),
          row('THEA 5780', 'Topics in Computer Technology', 3),
          row('THEA 5840', 'Technical Animation with Computers', 3),
          row('THEA 5850', 'Motion Capture for Animation and Media', 3),
          row('THEA 5860', 'Interactive Media as Drama I', 3),
          row('THEA 5861', 'Interactive Media as Drama II', 3),
          row('THEA 5870', 'Performing with Media', 3),
          row('THEA 5880', 'Sound Effects for Stage and Screen', 3),
        ]),
        choose(focus(6, 'Area of Emphasis in Dramatic Writing'), 4, [
          row('THEA 3020', 'Basic Dramatic Writing', 3),
          row('THEA 4000', 'Intermediate Dramatic Writing: The Short Script', 3),
          row('THEA 4700', 'Dramaturgy', 3),
          row('THEA 5630', 'Producing the New Script', 3),
        ]),
        choose(focus(6, 'Area of Emphasis in Dramatic Writing', 'advanced writing'), 1, [
          row('THEA 5620', 'Advanced Dramatic Writing: The Full-Length Script', 3),
          row('THEA 5680', 'Topics in Dramatic Writing', 3),
        ]),
        hoursFrom(focus(6, 'Area of Emphasis in Dramatic Writing', 'a FILM or THEA course'), 3, THEATRE_ELECTIVE, 'A FILM or THEA course of 3 hours, numbered 3000 and above.'),
        choose(focus(7, 'Area of Emphasis in Theatre Theory and History'), 1, [
          row('THEA 4960', 'Directed Readings or Projects', 3),
          row('THEA 4970R', 'Faculty-Mentored Undergraduate Research II', 3),
          row('THEA 4980R', 'Faculty-Mentored Undergraduate Research III', 3),
        ], 'Directed readings or faculty-mentored research.'),
        hoursFrom(focus(7, 'Area of Emphasis in Theatre Theory and History', 'a FILM or THEA course'), 3, THEATRE_ELECTIVE, 'A FILM or THEA course of 3 hours, numbered 3000 and above.'),
        choose(focus(7, 'Area of Emphasis in Theatre Theory and History', 'theory and history courses'), 4, [
          row('THEA 4230', 'Theatre and Ritual', 3),
          row('THEA 4280', 'Women in Performance', 3),
          row('THEA 4300', 'Queer Theatre and Film', 3),
          row('THEA 4400', 'Asian Theatre and Drama', 3),
          row('THEA 4460', 'History of Dramatic Art: Special Topics', 3),
          row('THEA 4470', 'African Theatre: An Historical Overview', 3),
          row('THEA 4480', 'History of African American Drama and Theatre', 3),
          row('THEA 4490', 'Latin American and Caribbean Theatre and Performance', 3),
          row('THEA 4500', 'The Broadway Musical and American Culture', 3),
          row('THEA 4700', 'Dramaturgy', 3),
          row('THEA 4750', 'Performance Studies', 3),
          row('THEA 4800', 'Topics in History', 3),
          row('THEA 5710S', 'Community-Based Theatre', 3),
          row('FILM 4250', 'History of Cinema I (1895-1945)', 3),
          row('FILM 4260', 'History of Cinema II (1945-1990)', 3),
          row('FILM 4270', 'History of Cinema III (1990-Present)', 3),
          row('FILM 4600', 'Women and Film', 3),
          row('FILM 4620', 'Genre Cinema', 3),
          row('FILM 4640', 'Latin American Film and Media', 3),
          row('FILM 4650', 'French Film History', 3),
          row('FILM 4660', 'History of Animation', 3),
          row('FILM 4670', 'Film Technology and Style', 3),
          row('FILM 5481', 'Topics in Cinema', 3),
          row('FILM 5900', 'Film Theory', 3),
        ], 'Up to two of them from the courses outside THEA the Bulletin lists.'),
      ]),
      generalElectives(21),
    ],
  },
  /*
   * Interdisciplinary Studies BS and Honors Interdisciplinary Studies BS
   * (verified 2026-10-29, bulletin.uga.edu/Program/Details/21398 and
   * 70139): a program of study the student plans with a faculty advisor
   * and committee, at least 24 hours of courses (15 of them in Franklin
   * College departments) and a Fourth-year Thesis (3 hours); Area VI is
   * 1000-2999-level courses chosen to prepare for them. The pages name no
   * course, so boards held only the core.
   */
  '21398': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      hoursFrom('VI. Courses Related to the Major', 18, [ANY_COURSE], `Courses numbered 1000-2999 that prepare for the major. ${DESIGNED}`),
    ]),
    major: [
      area('Required Courses', 27, [
        hoursFrom('Interdisciplinary Studies major courses', 24, [ANY_UPPER_COURSE], `At least 24 hours, 15 of them from Franklin College departments; at least 21 upper division. ${DESIGNED} Applicants need 30 to 75 college hours and a 3.0 GPA.`),
        choose('Fourth-year Thesis', 1, [row('IDIS 4990R', 'Undergraduate Research Thesis (or Final Project)', 3)], 'A thesis on a topic of special interest, planned with the faculty advisor.'),
      ]),
      generalElectives(33),
    ],
  },
  '70139': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      hoursFrom('VI. Courses Related to the Major', 18, [ANY_COURSE], `Courses numbered 1000-2999 that prepare for the major, chosen with the major professor. ${DESIGNED}`),
    ]),
    major: [
      area('Required Courses', 27, [
        hoursFrom('Interdisciplinary Studies major courses', 24, [ANY_UPPER_COURSE], `Major courses chosen with the major professor; open to Honors Program participants. ${DESIGNED}`),
        choose('Fourth-year Thesis', 1, [row('IDIS 4990R', 'Undergraduate Research Thesis (or Final Project)', 3)], 'A thesis on a topic of special interest, planned with the faculty advisor.'),
      ]),
      generalElectives(33),
    ],
  },
  /*
   * Honors Interdisciplinary Studies AB (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/71506): Required Courses (30 hours)
   * are four 3000-level courses in one department and six related courses
   * at that level from at least two other departments; the reading kept
   * neither (69 of 120 hours on a board).
   */
  '71506': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      hoursFrom('VI. Courses Related to the Major', 18, [ANY_COURSE], `Courses numbered 1000-2999 that prepare for the major, chosen with the major professor. ${DESIGNED}`),
    ]),
    major: [
      area('Required Courses', 30, [
        hoursFrom('Primary Subject', 12, [ANY_UPPER_COURSE], `Four courses at the 3000 level and above in one department; a grade of C or better. ${DESIGNED}`),
        hoursFrom('Secondary Subjects', 18, [ANY_UPPER_COURSE], `Six related courses at the 3000 level and above (research and thesis may count; at least two other departments represented). ${DESIGNED}`),
      ]),
      generalElectives(30),
    ],
  },
  /*
   * Interdisciplinary Studies BFA (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/73709): 12 hours of senior-division
   * courses in one primary subject, 18 hours of related subjects (9 of them
   * senior division) and 30 hours of general electives (18 upper division).
   */
  '73709': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      hoursFrom('VI. Courses Related to the Major', 18, [ANY_COURSE], `Courses that prepare for the major. ${DESIGNED}`),
    ]),
    major: [
      area('Required Courses', 12, [
        hoursFrom('Primary Subject', 12, [ANY_UPPER_COURSE], `Senior-division courses in one subject, chosen with the department in which the major is taken. ${DESIGNED}`),
      ]),
      area('Major Electives', 18, [
        hoursFrom('Related Subjects: senior division', 9, [ANY_UPPER_COURSE], DESIGNED),
        hoursFrom('Related Subjects', 9, [ANY_COURSE], DESIGNED),
      ]),
      generalElectives(30, 18),
    ],
  },
  /*
   * Honors Interdisciplinary Studies BSA (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/92067): Area VI's lower-division
   * science courses, 12 hours of senior-division courses in one primary
   * subject, 18 hours of related subjects (9 senior division) and 30 hours
   * of general electives.
   */
  '92067': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      hoursFrom('VI. Courses Related to the Major', 18, lowerLevels(['AAEC', 'ADSC', 'CHEM', 'CRSS', 'CSCI', 'EHSC', 'ENGR', 'FDST', 'GENE', 'GEOL', 'HORT', 'PBIO', 'PHYS', 'POUL', 'STAT']), `Lower-division science courses related to the major, such as those with these prefixes. ${DESIGNED}`),
    ]),
    major: [
      area('Required Courses', 12, [
        hoursFrom('Primary Subject', 12, [ANY_UPPER_COURSE], `Senior-division courses in one subject, chosen with the department in which the major is taken. ${DESIGNED}`),
      ]),
      area('Major Electives', 18, [
        hoursFrom('Related Subjects: senior division', 9, [ANY_UPPER_COURSE], DESIGNED),
        hoursFrom('Related Subjects', 9, [ANY_COURSE], DESIGNED),
      ]),
      generalElectives(30, 18),
    ],
  },
  /*
   * Interdisciplinary Studies AB (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/76673): the Athens campus major (a
   * designed program of study and thesis) or a Griffin campus Psychology or
   * Sociology concentration, each with its own Area VI, major and elective
   * hours; the reading put all three on the board at once. One choice, each
   * path its own Area VI.
   */
  '76673': {
    areaSix: null,
    major: [
      area('Program of Study', 57, [
        hoursFrom(focus(1, 'Athens Campus'), 24, [ANY_UPPER_COURSE], `At least 24 hours, 15 of them from Franklin College departments; at least 21 upper division. ${DESIGNED}`),
        hoursFrom(focus(1, 'Athens Campus', 'Area VI'), 18, [ANY_COURSE], `Courses that prepare for the major. ${DESIGNED}`),
        choose(focus(1, 'Athens Campus', 'Fourth-year Thesis'), 1, [row('IDIS 4990R', 'Undergraduate Research Thesis (or Final Project)', 3)]),
        hoursFrom(focus(1, 'Athens Campus', 'general electives'), 12, [ANY_COURSE], 'With the general electives below: 33 hours, chosen with the academic advisor.'),
        all(focus(2, 'Griffin Campus - Psychology Concentration'), [
          row('PSYC 3980', 'Research Design in Psychology', 3),
          row('PSYC 3990', 'Research Analysis in Psychology', 4),
        ]),
        choose(focus(2, 'Griffin Campus - Psychology Concentration', 'cognitive or biological psychology'), 1, [
          row('PSYC 4100', 'Cognitive Psychology', 3),
          row('PSYC 4110', 'Learning', 3),
          row('PSYC 4120', 'Sensation and Perception', 3),
          row('PSYC 4130', 'Physiological and Comparative Psychology', 3),
          row('PSYC 4140', 'Cognitive Neuroscience', 3),
          row('PSYC 4150', 'Biological Foundations of Health Psychology', 3),
        ]),
        choose(focus(2, 'Griffin Campus - Psychology Concentration', 'social or clinical psychology'), 1, [
          row('PSYC 3230', 'Psychopathology', 3),
          row('PSYC 3260', 'Human Sexuality', 3),
          row('PSYC 3300', 'Social and Personality Development', 3),
          row('PSYC 4200', 'Social Psychology', 3),
          row('PSYC 4210', 'Psychological Testing', 3),
          row('PSYC 4220', 'Developmental Psychology', 3),
          row('PSYC 4230', 'Psychology of the Workplace', 3),
        ]),
        hoursFrom(focus(2, 'Griffin Campus - Psychology Concentration', 'PSYC courses'), 9, levels('PSYC', 3), 'Three PSYC courses numbered 3000 and above.'),
        all(focus(2, 'Griffin Campus - Psychology Concentration', 'Area VI'), [
          row('COMM 1110', 'Introduction to Public Speaking', 3),
          row('PSYC 1101', 'Elementary Psychology', 3),
          row('STAT 2000', 'Introductory Statistics', 4),
        ]),
        choose(focus(2, 'Griffin Campus - Psychology Concentration', 'Area VI foreign language'), 1, THIRD_SEMESTER_COURSES, 'A foreign language course.'),
        oneGroup(focus(2, 'Griffin Campus - Psychology Concentration', 'Area VI biology'), 4, [
          [row('BIOL 1103', 'Concepts in Biology', 3), lab('BIOL 1103L', 'Concepts in Biology Laboratory', 1)],
          [row('BIOL 1107', 'Principles of Biology I', 3), lab('BIOL 1107L', 'Principles of Biology I Laboratory', 1)],
        ], 'Choose 1 course (with its lab).'),
        choose(focus(2, 'Griffin Campus - Psychology Concentration', 'Area VI economics'), 1, [
          row('ECON 2105', 'Principles of Macroeconomics', 3),
          row('ECON 2106', 'Principles of Microeconomics', 3),
        ]),
        hoursFrom(focus(2, 'Griffin Campus - Psychology Concentration', 'Major Electives'), 12, [ANY_COURSE], 'Major electives chosen with the academic advisor.'),
        hoursFrom(focus(2, 'Griffin Campus - Psychology Concentration', 'general electives numbered 3000 and above'), 5, [ANY_UPPER_COURSE], '5 of the 26 general elective hours at the 3000 level or above.'),
        all(focus(3, 'Griffin Campus - Sociology Concentration'), [
          row('SOCI 3220', 'Development of Sociological Theory', 3),
        ]),
        choose(focus(3, 'Griffin Campus - Sociology Concentration', 'research methods'), 1, [
          row('SOCI 3580', 'Research Methods in Sociology', 3),
          row('SOCI 3590', 'Qualitative Methods of Social Research', 3),
        ]),
        hoursFrom(focus(3, 'Griffin Campus - Sociology Concentration', 'SOCI courses'), 15, levels('SOCI', 3), 'Five SOCI courses numbered 3000 and above.'),
        all(focus(3, 'Griffin Campus - Sociology Concentration', 'Area VI'), [
          row('COMM 1110', 'Introduction to Public Speaking', 3),
          row('PSYC 1101', 'Elementary Psychology', 3),
          row('SOCI 1101', 'Introductory Sociology', 3),
          row('STAT 2000', 'Introductory Statistics', 4),
        ]),
        choose(focus(3, 'Griffin Campus - Sociology Concentration', 'Area VI foreign language'), 1, THIRD_SEMESTER_COURSES, 'A foreign language course.'),
        choose(focus(3, 'Griffin Campus - Sociology Concentration', 'Area VI economics'), 1, [
          row('ECON 2105', 'Principles of Macroeconomics', 3),
          row('ECON 2106', 'Principles of Microeconomics', 3),
        ]),
        hoursFrom(focus(3, 'Griffin Campus - Sociology Concentration', 'Major Electives'), 12, [ANY_COURSE], 'Major electives chosen with the academic advisor.'),
        hoursFrom(focus(3, 'Griffin Campus - Sociology Concentration', 'general electives numbered 3000 and above'), 6, [ANY_UPPER_COURSE], '6 of the 27 general elective hours at the 3000 level or above.'),
      ]),
      // The Griffin concentrations' other general elective hours (21 of 26 or 27), and 21 of the Athens campus's 33.
      generalElectives(21),
    ],
  },
  /*
   * Art BFA - Photography and Expanded Media (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/74546): Required Courses (60 hours)
   * with the Studio Electives (18 hours of ARGD, ARID, ARST or ARTS at the
   * 2000 level or above), which the reading lost, and Art History as ARHI
   * courses at the 3000 or 4000 level (read as 9 hours from two courses,
   * which could never be met).
   */
  '74546': {
    major: [
      area('Required Courses', 60, [
        all('Required Studio Courses', [
          row('ARST 4200', 'Advanced Workshop in Photography and Expanded Media', 3),
          row('ARST 4201', 'Advanced Workshop in Photography and Expanded Media II', 3),
          row('ARST 4915', 'Thematic Inquiry in Contemporary Art', 3),
          row('ARST 4995', 'Capstone Exhibition and Professional Practices', 3),
        ], 'A grade of C or better.'),
        hoursFromDistinct('Photography and Expanded Media Courses', 15, 5, [
          [row('ARST 2810', 'Hypermedia', 3)],
          [row('ARST 3200', 'Black and White Photography', 3)],
          [row('ARST 3205', 'Video Concepts and Practice', 3)],
          [row('ARST 3210', 'Color Photography', 3)],
          [row('ARST 3220', 'Advanced Film and Camera', 3)],
          [row('ARST 3250', 'Constructed Image in Photography', 3), row('ARST 4250', 'Constructed Image in Photography', 3)],
          [row('ARST 3800', 'Transmedia', 3)],
          [row('ARST 4830', 'Advanced Video', 3)],
        ], 'Choose 15 hours. Only one of ARST 3250 and ARST 4250.'),
        hoursFrom('Photography and Expanded Media Electives', 6, [
          row('ARST 2810', 'Hypermedia', 3),
          row('ARST 3200', 'Black and White Photography', 3),
          row('ARST 3210', 'Color Photography', 3),
          row('ARST 3220', 'Advanced Film and Camera', 3),
          row('ARST 3221', 'Large Format Photography II', 3),
          row('ARST 3250', 'Constructed Image in Photography', 3),
          row('ARST 3345', 'Digital Printmaking', 3),
          row('ARST 3800', 'Transmedia', 3),
          row('ARST 3840', 'Interdisciplinary Art I', 3),
          row('ARST 3850', 'Interactive Art I', 3),
          row('ARST 3870', 'E-Gadgets for Experimental Media', 3),
          row('ARST 4210', 'Special Topics in Photography', 3),
          row('ARST 4215', 'Sound in Art', 3),
          row('ARST 4225', 'Photography Practice and Theory', 3),
          row('ARST 4251', 'Constructed Image in Photograpy II', 3),
          row('ARST 4270', 'Social Documentary Photography and Video', 3),
          row('ARST 4280', 'Directed Study in Photography', 3),
          row('ARST 4285', 'Alternative Photography', 3),
          row('ARST 4290', 'Landscape Photography', 3),
          row('ARST 4800', 'Special Topics in Art and Technology', 3),
          row('ARST 4810', 'CAD and Fabrication', 3),
          row('ARST 4830', 'Advanced Video', 3),
          row('ARST 4840', 'Interdisciplinary Art II', 3),
          row('ARST 4850', 'Interactive Art II', 3),
          row('ARST 4860', 'Video Installation', 3),
          row('ARST 4865', 'Internet Art Studio', 3),
          row('ARST 4870', 'Web Site Design for Artists', 3),
          row('ARST 4930', 'Internship in Art', 3),
          row('ARTS 4000', "Artist's Research Methods", 3),
          row('ARTS 4100', 'Art and Design in the City Intensive Field Study', 3),
          row('ARTS 4900', 'Professional Practices: The Business Side of Art', 3),
          row('ARTS 4920', 'Seminar in Contemporary Art', 3),
        ]),
        hoursFrom('Studio Electives', 18, ['ARGD', 'ARID', 'ARST', 'ARTS'].flatMap((subject) => levels(subject, 2)), 'ARGD, ARID, ARST or ARTS courses at the 2000 level or above.'),
        hoursFrom('Art History', 9, [
          ...levels('ARHI', 3, 4),
          row('ARGD 3070', 'The History of Graphic Design', 3),
          row('ARST 4225', 'Photography Practice and Theory', 3),
        ], 'ARHI courses at the 3000 or 4000 level (two 3000-level ARHI courses before any 4000-level one), ARGD 3070 or ARST 4225.'),
      ]),
    ],
  },
  /*
   * Social Entrepreneurship for Consumer Well-Being BSFCS (verified
   * 2026-10-29, bulletin.uga.edu/Program/Details/77137): the reading left
   * Area VI's open rows and 24 of the 37 required hours unnamed, and read
   * Major Electives' "6 hours of 3000-level or above courses" as 6 hours
   * from IDEA 4000 (a 3-hour course: a row that could never be met).
   */
  '77137': {
    areaSix: area('VI. Courses Related to the Major', 18, [
      all('VI. Courses Related to the Major', [
        row('FHCE 2100', 'Introduction to Consumer Economics', 3),
        row('HDFS 2100', 'Relationship Development, Maintenance, and Dissolution', 3),
      ]),
      choose('Nutrition or textiles', 1, [
        row('NUTR 2100', 'Fundamentals of Human Nutrition', 3),
        row('TXMI 2100', 'Textiles for Consumers', 3),
      ]),
      hoursFrom('A W-suffix course', 3, [ANY_COURSE], 'Any 3-hour W-suffix (writing intensive) course.'),
      hoursFrom('Perspective and Professional Innovation courses', 6, [ANY_COURSE], 'Two 3-hour courses at the 2000 level or higher: a Perspective course (a topic from multiple perspectives) and a Professional Innovation course (a skill for your professional interest).'),
    ]),
    major: [
      area('Required Courses', 37, [
        all('Required Courses', [
          row('FACS 2000', 'Introduction to Family and Consumer Sciences', 1),
          row('FHCE 4010', 'Introduction to Social Entrepreneurship', 3),
          row('FHCE 4011', 'Social Entrepreneurship: Strategic Storytelling', 3),
          row('FHCE 4051', 'Social Entrepreneurship: Social Impact Communication', 3),
          row('FHCE 5011', 'Social Entrepreneurship Capstone', 3),
        ], 'A grade of C or higher in each course.'),
        hoursFrom('Focus area courses', 15, [ANY_UPPER_COURSE], '3000-level or above courses in your chosen focus area.'),
        hoursFrom('Family and consumer sciences courses', 9, FAMILY_CONSUMER_UPPER, 'FACS, FHCE, HDFS, NUTR or TXMI courses at the 3000 level or above.'),
      ]),
      area('Major Electives', 12, [
        hoursFrom('Major Electives: family and consumer sciences', 6, FAMILY_CONSUMER_UPPER, 'FACS, FHCE, HDFS, NUTR or TXMI courses at the 3000 level or above.'),
        hoursFrom('Major Electives: 3000-level or above', 6, [row('IDEA 4000', 'Innovation Catalyst and Design', 3), ANY_UPPER_COURSE], 'Any courses at the 3000 level or above (IDEA 4000 suggested); they may count toward a minor.'),
      ]),
      generalElectives(11),
    ],
  },
  /*
   * Economics AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/77024):
   * "Required Courses (30 hours)" is BUSN 5000, ECON 4010 and 4020, four
   * ECON electives (or an area of emphasis whose courses are among them)
   * and the Major Electives (9 hours), which the page prints as sections of
   * their own; the reading counted the 30 and the sections again (129 of
   * 120 hours) and lost the Major Electives and Area VI's language. The areas
   * of emphasis (Consulting, Public Policy, Business Analytics) are optional
   * and their courses count among these rows.
   */
  '77024': {
    areaSix: area('VI. Courses Related to the Major', 16, [
      all('VI. Courses Related to the Major', [
        row('BUSN 3000', 'Applied Statistics and Data Analysis for Business', 3),
        row('ECON 2105', 'Principles of Macroeconomics', 3),
        row('ECON 2106', 'Principles of Microeconomics', 3),
      ], 'A grade of C or better in ECON 2105 and ECON 2106.'),
      choose('Foreign language', 1, THIRD_SEMESTER_COURSES, 'This major requires a foreign language through the third semester.'),
      choose('Calculus', 1, [
        row('MATH 2200', 'Analytic Geometry and Calculus', 4),
        row('MATH 2250', 'Calculus I for Science and Engineering', 4),
      ]),
    ]),
    major: [
      area('Required Courses', 9, [
        all('Required Courses', [
          row('BUSN 5000', 'Introduction to Data Science for Business and Economics', 3),
          row('ECON 4010', 'Intermediate Microeconomics', 3),
          row('ECON 4020', 'Intermediate Macroeconomics', 3),
        ]),
      ]),
      area('ECON Electives', 12, [
        choose('ECON Electives', 4, [
          row('ECON 4100', 'Monetary Economics', 3),
          row('ECON 4150', 'Environmental Economics', 3),
          row('ECON 4160', 'Urban Economics', 3),
          row('ECON 4200', 'Economic Growth and Development', 3),
          row('ECON 4250', 'Economics of Education', 3),
          row('ECON 4300', 'Public Sector Economics', 3),
          row('ECON 4310', 'Health Economics', 3),
          row('ECON 4350', 'Industrial Economics', 3),
          row('ECON 4360', 'Game Theory', 3),
          row('ECON 4450', 'Economic Analysis of Law', 3),
          row('ECON 4460', 'Sports Economics', 3),
          row('ECON 4500', 'Monetary Policy', 3),
          row('ECON 4550', 'International Trade: Theory and Policy', 3),
          row('ECON 4600', 'Labor Economics', 3),
          row('ECON 4650', 'Economics of Organizations and Management', 3),
          row('ECON 4700', 'Economic History of the United States', 3),
          row('ECON 4710', 'Topics in Economic History', 3),
          row('ECON 4750', 'Introduction to Econometrics', 3),
          row('ECON 4760', 'Time Series Analysis', 3),
          row('ECON 4850', 'Special Topics for Economics', 3),
          row('ECON 4950', 'Competitive Strategy', 3),
          row('ECON 5900', 'Senior Thesis', 3),
        ], 'Or one area of emphasis (Consulting or Public Policy courses count as ECON electives; Business Analytics courses do not).'),
      ]),
      area('Major Electives', 9, [
        choose('Major Electives', 3, [
          row('ACCT 1160', 'Survey of Accounting', 3),
          row('ACCT 2101', 'Principles of Accounting I', 3),
          row('ACCT 2102', 'Principles of Accounting II', 3),
          row('AFST 2100', 'Introduction to Africa', 3),
          row('BUSN 4000', 'Optimization and Applied Regression Analysis', 3),
          row('BUSN 4650', 'Law, Culture, and Global Business', 3),
          row('BUSN 4900', 'Communicating for Business Effectiveness', 3),
          row('BUSN 4940', 'Generative AI in Business Communications', 3),
          row('COMM 3200', 'Business and Professional Communication', 3),
          row('ECOL 3070', 'Environment and Humans', 3),
          row('ENGL 3590W', 'Technical and Professional Communication', 3),
          row('ENGL 3600W', 'Advanced Composition', 3),
          row('ENTR 5500', 'Introduction to Entrepreneurship', 3),
          row('ENTR 5505', 'Funding the Entrepreneurial Venture', 3),
          row('ENTR 5525', 'Managing the Entrepreneurial Venture', 3),
          row('FINA 3000', 'Financial Management', 3),
          row('FINA 3001', 'Financial Management', 3),
          row('FINA 4050', 'Capitalism', 3),
          row('GEOG 2610', 'Geography of Georgia', 3),
          row('GEOG 3620', 'Globalization and the Making of the Modern World', 3),
          row('GEOG 3630', 'Introduction to Urban Geography', 3),
          row('GEOG 4610', 'Location Analysis', 3),
          row('GEOG 4620', 'Advanced Economic Geography', 3),
          row('GEOG 4630', 'Advanced Urban Geography', 3),
          row('GEOG 4640', 'Population Geography', 3),
          row('GEOG 4650', 'Industrial Geography', 3),
          row('GEOG 4660', 'Urban and Regional Development', 3),
          row('GEOG 4670', 'Geography of Development', 3),
          row('GEOG 4710', 'Geography of Sub-Saharan Africa', 3),
          row('GEOG 4720', 'Geography of Latin America', 3),
          row('GEOG 4730', 'Geography of China', 3),
          row('GEOG 4740', 'Geography of East and Southeast Asia', 3),
          row('HIST 3071', 'Origins of Modern America', 3),
          row('HIST 3072', 'The United States Between the Wars, 1914-1945', 3),
          row('HIST 3073', 'Modern America, 1945 to Present', 3),
          row('HIST 3421', 'History of Ancient and Medieval Science', 3),
          row('HIST 3432', 'History of Science and Society in the Modern World', 3),
          row('HIST 4074', 'The South Since Reconstruction', 3),
          row('INTB 5100', 'Special Topics in International Business', 3),
          row('LEGL 2700', 'Legal and Regulatory Environment of Business', 3),
          row('MARK 3000', 'Principles of Marketing', 3),
          row('MARK 3001', 'Principles of Marketing', 3),
          row('MBUS 3000', 'Business Fundamentals as Applied to the Music Industry', 3),
          row('MIST 2090', 'Introduction to Information Systems in Business', 3),
          row('MGMT 3000', 'Principles of Management', 3),
          row('REAL 4000', 'Real Estate', 3),
          row('RMIN 4000', 'Risk Management and Insurance', 3),
          row('SOCI 3070', 'Juvenile Delinquency', 3),
          row('SOCI 3290', 'Gender and Work', 3),
          row('SOCI 3750', 'Sociology of Work and Industry', 3),
        ]),
      ]),
      // 30 hours, and Area VI's last 2.
      generalElectives(32),
    ],
  },
  /*
   * Mathematics Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/79641): student teaching (EMAT 5460)
   * is 12 hours, not 1, and EDUC 2140 (C or higher) is a program completion
   * requirement for certification; the Area of Emphasis in Educational
   * Studies replaces student teaching with 15 hours of EMAT courses (one
   * choice). Major Electives (12 hours): a mathematics or statistics course
   * and EMAT courses at the 4000 level or above; read as two courses.
   */
  '79641': {
    major: [
      area('Required Content Courses', 12, [
        all('Required Content Courses', [
          row('MATH 4000', 'Modern Algebra I', 3),
          row('MATH 5200', 'Foundations of Geometry I', 3),
        ]),
        choose('Linear algebra', 1, [
          row('MATH 3000', 'Introduction to Linear Algebra', 3),
          row('MATH 3300', 'Applied Linear Algebra', 3),
        ]),
        choose('Probability or statistics', 1, [
          row('MATH 4600', 'Probability', 3),
          row('STAT 4070', 'Statistics for Secondary Teachers', 3),
          row('STAT 4210', 'Statistical Methods', 3),
        ]),
      ]),
      area('Required Professional Courses', 36, [
        all('Required Professional Courses', [
          row('EMAT 4800', 'Teaching Secondary School Mathematics I', 3),
          lab('EMAT 4800L', 'Field Experience in Secondary School Mathematics I', 1),
          row('EMAT 4810', 'Connections in Secondary Mathematics I', 3),
          row('EMAT 4850', 'Teaching Secondary School Mathematics II', 3),
          lab('EMAT 4850L', 'Field Experience in Secondary School Mathematics II', 1),
          row('EMAT 4860', 'Connections in Secondary Mathematics II', 3),
          row('EMAT 4900', 'Teaching Secondary School Mathematics III', 3),
          lab('EMAT 4900L', 'Field Experience in Secondary School Mathematics III', 1),
          row('EMAT 4910', 'Connections in Secondary Mathematics III', 3),
          row('EMAT 4950', 'Professional Seminar in Teaching Mathematics', 3),
        ]),
        all(focus(1, 'Teacher Certification'), [
          row('EMAT 5460', 'Student Teaching in Secondary School Mathematics', 12),
          row('EDUC 2140', 'Foundations of Reading', 3),
        ], 'EDUC 2140 (C or higher) is a program completion requirement for teacher certification, with the trainings and assessments on the Bulletin page.'),
        hoursFrom(focus(2, 'Area of Emphasis in Educational Studies in Mathematics Education'), 15, levels('EMAT', 3), 'In place of student teaching: EMAT courses chosen with program faculty. Does not lead to teacher certification.'),
      ]),
      area('Major Electives', 12, [
        choose('Major Electives: mathematics or statistics', 1, [
          row('MATH 2270', 'Calculus III for Science and Mathematics', 4),
          row('MATH 2700', 'Elementary Differential Equations', 3),
          ...levels('MATH', 3),
          row('STAT 4070', 'Statistics for Secondary Teachers', 3),
          row('STAT 4210', 'Statistical Methods', 3),
          row('STAT 4220', 'Applied Experimental Designs', 3),
        ], 'MATH 2270 preferred (not with MATH 2500); not MATH 3200, the MATH(EMAT) 5000-level courses for teachers, or a course taken for the required courses.'),
        hoursFrom('Major Electives: EMAT courses', 9, levels('EMAT', 4), 'EMAT courses at the 4000 level or above (not EMAT 5280, 5290 or 5320).'),
      ]),
    ],
  },
  /*
   * Sociology AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/77932):
   * Required Courses (27 hours) are the General Sociology Track or the Area
   * of Emphasis in Sociological Methodology. Picked, the methodology
   * emphasis was one 27-hour pool of its eight listed courses (24 hours),
   * which could never be met; it is SOCI 3220, SOCI 3580, three methods
   * courses, one SOCI course at any level and three at 3000 and above.
   * (The General Sociology Track is as uga-program-overrides.ts read it.)
   */
  '77932': {
    major: [
      {
        ...area('Required Courses', 27, [
          all('Required Courses', [
            row('SOCI 3220', 'Development of Sociological Theory', 3),
            row('SOCI 3580', 'Research Methods in Sociology', 3),
          ]),
          choose(focus(1, 'General Sociology Track'), 1, [
            { code: 'SOCI 2XXX', title: 'SOCI courses at any level', credits: 0, levelFrom: 1, levelTo: 5 },
          ], 'One SOCI course at any level.'),
          hoursFrom(focus(1, 'General Sociology Track', 'six SOCI courses numbered 3000 and above'), 18, levels('SOCI', 3), 'A minimum of 6 SOCI courses numbered 3000 and above (not POLS(SOCI) 4905, 5500, 5510 or 5520); no more than six hours from SOCI 4900, 4960R, 4970R, 4980R and 4990R.'),
          choose(focus(2, 'Area of Emphasis in Sociological Methodology'), 3, [
            row('POLS 3700', 'Research Methods in Criminal Justice', 3),
            row('SOCI 3590', 'Qualitative Methods of Social Research', 3),
            row('SOCI 3610', 'Quantitative Methods of Social Research', 3),
            row('SOCI 4055', 'Social Policy Storytelling: In and Around Athens', 3),
            row('SOCI 4250', 'Social Networks', 3),
            row('SOCI 4930', 'Experimental Research in Sociology', 3),
          ], 'With the advisor\'s and instructor\'s approval, SOCI 6600, 6620, 6630 or 6750 may count.'),
          choose(focus(2, 'Area of Emphasis in Sociological Methodology', 'one SOCI course at any level'), 1, [
            { code: 'SOCI 2XXX', title: 'SOCI courses at any level', credits: 0, levelFrom: 1, levelTo: 5 },
          ]),
          hoursFrom(focus(2, 'Area of Emphasis in Sociological Methodology', 'three SOCI courses numbered 3000 and above'), 9, levels('SOCI', 3), 'A minimum of 3 SOCI courses numbered 3000 and above (not POLS(SOCI) 4905, 5500, 5510 or 5520); no more than six hours from SOCI 4900, 4960R, 4970R, 4980R and 4990R.'),
        ]),
        excludeCodes: ['SOCI 4905', 'SOCI 5500', 'SOCI 5510', 'SOCI 5520', 'POLS 4905', 'POLS 5500', 'POLS 5510', 'POLS 5520'],
      },
      generalElectives(33),
    ],
  },
  /*
   * Romance Languages AB (verified 2026-10-29, bulletin.uga.edu/Program/Details/58425):
   * Required Courses are one of seven options: a major and a minor language
   * (Options I to IV, French, Spanish, Italian or Portuguese by the
   * option's rules), Ibero-American Comparative Studies (V), Italian
   * Studies (VI) or Portuguese and Brazilian Studies (VII), each with its
   * own Area VI. The reading put eight language blocks on every board (183
   * of 120 hours) and lost Area VI. One choice, each path its own Area VI.
   */
  '58425': {
    areaSix: null,
    major: [
      area('Required Courses', 45, [
        ...ROMANCE_PAIRS.flatMap(([option, major, minor], index) => {
          const name = `${option}: ${major} major, ${minor} minor`;
          return [...romanceMajor(index + 1, name, major), ...romanceMinor(index + 1, name, minor), ...romanceAreaSix(index + 1, name, [major, minor])];
        }),
        all(focus(13, 'Option V: Ibero-American Comparative Studies'), [
          row('PORT 3010', 'Portuguese Conversation and Composition', 3),
          row('PORT 3030', 'Introduction to Language, Literature, and Culture of the Portuguese-Speaking World', 3),
          row('SPAN 3010', 'Spanish Cultural Dialogues', 3),
          row('SPAN 3030', 'Texts in Global Contexts', 3),
          row('AFAM 4860', 'Topics in Afro-Hispanic Identity', 3),
          row('PTSP 4900', 'Ibero-American Senior Seminar', 3),
        ], 'Core and comparative courses.'),
        hoursFrom(focus(13, 'Option V: Ibero-American Comparative Studies', 'focus courses'), 9, [...levels('PORT', 4, 4), ...levels('SPAN', 4, 4), ...levels('LING', 4, 4)], 'Three 4000-level courses: one PORT, one SPAN (or LING cross-listed with SPAN), and one more of either.'),
        choose(focus(13, 'Option V: Ibero-American Comparative Studies', 'elective'), 1, [
          row('ANTH 4460', 'The Aztecs and the Maya', 3),
          row('CMLT 4010', 'Approaches in Comparative Literature', 3),
          row('GEOG 4720', 'Geography of Latin America', 3),
          row('HIST 3220', 'History of Mexico', 3),
          row('HIST 3240', 'The Caribbean Area', 3),
          row('HIST 3270', 'History of Argentina and Chile in the 20th Century', 3),
          row('HIST 3443', 'Spain in the Age of Cervantes', 3),
          row('HIST 4200', 'Studies in Latin American History', 3),
          row('HIST 4211', 'Cuba from Emancipation to Revolution', 3),
          row('HIST 4214', 'Introduction to the Religions of the Caribbean', 3),
          row('HIST 4220', 'The United States and Latin America', 3),
          row('HIST 4230', 'Supernatural Latin America: Readings on Witchcraft, Shamanism, and Popular Religion', 3),
          row('HIST 4250', 'Race, Nation, and Popular Culture in Latin America', 3),
          row('INTL 4270', 'Inter-American Relations', 3),
          row('INTL 4380', 'Latin American Politics', 3),
          row('LACS 4900', 'Special Topics in Latin American and Caribbean Studies', 3),
          row('LLED 4530', 'TESOL and World Language Curriculum and Methods, Grades P-5', 3),
          row('LLED 4531', 'TESOL and World Language Curriculum and Methods, Grades 6-12', 3),
          row('LLED 4730', 'Methods and Material for Community-Based Language Teaching', 3),
          row('SOCI 4290', 'Sociology of Latin America', 3),
          row('WMST 3500', 'Women in the Caribbean', 3),
        ]),
        ...romanceAreaSix(13, 'Option V: Ibero-American Comparative Studies', ['Spanish', 'Portuguese']),
        all(focus(14, 'Option VI: Italian Studies'), [
          row('ITAL 2001', 'Intermediate Italian', 3),
          row('ITAL 2002', 'Intermediate Italian', 3),
        ]),
        choose(focus(14, 'Option VI: Italian Studies', 'ITAL courses'), 7, ROMANCE_LISTS.Italian),
        hoursFrom(focus(14, 'Option VI: Italian Studies', 'Area VI'), 18, lowerLevels(ROMANCE_AREA_SIX_SUBJECTS), 'Area VI: 18 hours of courses with these prefixes (not ITAL 2001, 2002 or 2600).'),
        all(focus(15, 'Option VII: Portuguese and Brazilian Studies'), [
          row('PORT 3010', 'Portuguese Conversation and Composition', 3),
          row('PORT 3030', 'Introduction to Language, Literature, and Culture of the Portuguese-Speaking World', 3),
        ]),
        oneGroup(focus(15, 'Option VII: Portuguese and Brazilian Studies', 'intermediate Portuguese'), 6, [
          [row('PORT 2001', 'Intermediate Portuguese', 3), row('PORT 2002', 'Intermediate Portuguese', 3)],
          [row('PORT 2030', 'Practical Portuguese Conversation', 2), row('PORT 2120', 'Accelerated Intermediate Portuguese', 4)],
        ]),
        hoursFrom(focus(15, 'Option VII: Portuguese and Brazilian Studies', 'PORT courses'), 15, ROMANCE_LISTS.Portuguese, 'At most 9 hours of any one repeatable course (6 of PORT 4040).'),
        hoursFrom(focus(15, 'Option VII: Portuguese and Brazilian Studies', 'Area VI'), 18, lowerLevels(ROMANCE_AREA_SIX_SUBJECTS), 'Area VI: 18 hours of courses with these prefixes (not PORT 2001, 2002, 2030 or 2120).'),
      ]),
    ],
  },
  /*
   * TESOL and World Language Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/42194): Required Courses (39-60
   * hours) are the LLED sequence and one area of emphasis (French, German,
   * Latin or Spanish Education, TESOL, or Educational Studies, which
   * replaces LLED 5560 and 5570 and does not lead to certification), each
   * with its own Area VI course; the reading required every language and
   * every emphasis. (The reading also lost core Areas IV Humanities and V;
   * they are the Bulletin reader's.)
   */
  '42194': {
    campusCore: ['IV. Humanities and the Arts', 'V. Social Sciences'],
    // Area IV's preferred courses are the emphasis language's 1001, 1002 and 2001; read as every language's (44 hours in a 9-hour area).
    core: [area('IV. World Languages and Global Culture', 9, [
      fromOneList(hoursFromLists('World Languages and Global Culture', 9, {
        French: [row('FREN 1001', 'Elementary French I', 4), row('FREN 1002', 'Elementary French II', 4), row('FREN 2001', 'Intermediate French I', 3)],
        German: [row('GRMN 1001', 'Elementary German I', 4), row('GRMN 1002', 'Elementary German II', 4), row('GRMN 2001', 'Intermediate German I', 3)],
        Latin: [row('LATN 1001', 'Elementary Latin I', 4), row('LATN 1002', 'Elementary Latin II', 4), row('LATN 2001', 'Intermediate Latin I', 3)],
        Spanish: [row('SPAN 1001', 'Elementary Spanish I', 4), row('SPAN 1002', 'Elementary Spanish II', 4), row('SPAN 2001', 'Intermediate Spanish I', 3)],
      }, 'Preferred: 1001, 1002 and 2001 of the emphasis language (or the courses that place past them).'), 2, 'Courses of one language.'),
    ])],
    areaSix: area('VI. Courses Related to the Major', 15, [
      all('VI. Courses Related to the Major', [
        row('EDUC 2120', 'Exploring Socio-Cultural Perspectives in Educational Contexts', 3),
        row('EDUC 2130', 'Exploring Learning and Teaching', 3),
        row('EDUC 2140', 'Foundations of Reading', 3),
        row('LING 2100', 'The Study of Language', 3),
      ], 'EDUC 2140 (C or higher) is also a program completion requirement for certification.'),
      choose('Inclusion', 1, [
        row('EDSE 4020', 'Inclusion of Students with Disabilities: PreK-Grade 5', 3),
        row('EDSE 4030', 'Inclusion of Students with Disabilities: Grades 6-12', 3),
      ]),
    ]),
    major: [
      area('Required Courses', 42, [
        all('Required Courses', [
          row('LLED 4530', 'TESOL and World Language Curriculum and Methods, Grades P-5', 3),
          row('LLED 4531', 'TESOL and World Language Curriculum and Methods, Grades 6-12', 3),
          row('LLED 5040', 'Language and Culture in the Classroom', 3),
          row('LLED 5530', 'Introduction to Language Teaching', 3),
          row('LLED 5540', 'Culture in the TESOL and World Language Classroom', 3),
          row('LLED 5550', 'Field-Based Practicum in TESOL or World Language Education, Grades P-12', 3),
          row('LLED 5730', 'First and Second Language Acquisition and Development', 3),
        ], 'A grade of C or higher; a 2.6 GPA overall and in the teaching field, and 6 of 9 teaching field courses before the TE courses. LLED 5040 and LLED 5730 before the major classes.'),
        ...([
          [1, 'French Education', [row('FREN 2002', 'Intermediate French', 3)], [row('FREN 3010', 'Culture and Communication I', 3), row('FREN 3020', 'Culture and Communication II', 3), row('FREN 3030', 'Texts and Contexts', 3)], levels('FREN', 3, 4), 'Five FREN courses at the 3000/4000 level.'],
          [2, 'German Education', [row('GRMN 2002', 'Intermediate German II', 3), row('GRMN 2110', 'Accelerated Intermediate German', 3)], [row('GRMN 3010', 'Language: Culture and Society I', 3), row('GRMN 3020', 'Language: Culture and Society II', 3), row('GRMN 4001', 'Advanced German Conversation and Composition', 3)], [row('GRMN 4380', 'Contrastive Grammar: German-English', 3), ...levels('GRMN', 3, 4)], 'Five GRMN courses at the 3000/4000 level (not GRMN 3500; one may be taught in translation; GRMN 4380 strongly encouraged).'],
          [3, 'Spanish Education', [row('SPAN 2002', 'Intermediate Spanish II', 3), row('SPAN 3011', 'Cultural Dialogues and Critical Reading and Writing for Spanish Heritage Speakers I', 3)], [row('SPAN 3030', 'Texts in Global Contexts', 3), row('SPAN 3050', 'Introduction to Spanish Linguistics', 3), row('SPAN 3020', 'Writing Critically in Spanish', 3)], levels('SPAN', 4, 4), 'Four SPAN courses at the 4000 level (with SPAN 3010 or 3011 below).'],
        ] as Array<[number, string, UgaRequirementCourse[], UgaRequirementCourse[], UgaRequirementCourse[], string]>).flatMap(([n, name, six, required, electives, note]) => [
          all(focus(n, `Area of Emphasis in ${name}`), [
            row('LLED 5560', 'Full-Time Clinical Practice in TESOL or World Language Education, Grades P-12', 12),
            row('LLED 5570', 'Student Teaching Seminar in World Language and TESOL Education Grades P-12', 3),
            ...required,
          ]),
          ...(name === 'Spanish Education' ? [choose(focus(n, `Area of Emphasis in ${name}`, 'cultural dialogues'), 1, [row('SPAN 3010', 'Spanish Cultural Dialogues', 3), row('SPAN 3011', 'Cultural Dialogues and Critical Reading and Writing for Spanish Heritage Speakers I', 3)])] : []),
          hoursFrom(focus(n, `Area of Emphasis in ${name}`, 'electives'), name === 'Spanish Education' ? 12 : 15, electives, note),
          choose(focus(n, `Area of Emphasis in ${name}`, 'Area VI'), 1, six, 'An Area VI course.'),
        ]),
        all(focus(4, 'Area of Emphasis in Latin Education'), [
          row('LLED 5560', 'Full-Time Clinical Practice in TESOL or World Language Education, Grades P-12', 12),
          row('LLED 5570', 'Student Teaching Seminar in World Language and TESOL Education Grades P-12', 3),
          row('LATN 2002', 'Intermediate Latin II: Golden Age Latin Literature', 3),
        ], 'LATN 2002 is an Area VI course.'),
        hoursFrom(focus(4, 'Area of Emphasis in Latin Education', 'LATN courses'), 12, levels('LATN', 4, 4), 'Four LATN courses at the 4000 level.'),
        hoursFrom(focus(4, 'Area of Emphasis in Latin Education', 'classics courses'), 12, [...levels('CLAS', 4, 4), ...levels('GREK', 4, 4), ...levels('LATN', 4, 4)], 'Four more CLAS, GREK or LATN courses at the 4000 level.'),
        all(focus(5, 'Area of Emphasis in TESOL'), [
          row('LLED 5560', 'Full-Time Clinical Practice in TESOL or World Language Education, Grades P-12', 12),
          row('LLED 5570', 'Student Teaching Seminar in World Language and TESOL Education Grades P-12', 3),
          row('LING 3150', 'Generative Syntax', 3),
          row('LLED 5630', 'ESOL, Grades P-12', 3),
          row('LING 3060', 'Phonetics and Phonology', 3),
        ], 'LING 3060 is an Area VI course.'),
        choose(focus(5, 'Area of Emphasis in TESOL', 'linguistics and ESOL'), 2, [
          row('CMSD 3120', 'Study of Language Development', 3),
          row('ENGL 4170', 'Second Language Acquisition', 3),
          row('LING 3250', 'Morphology', 3),
          row('LING 3830', 'Languages of the World', 3),
          row('LING 4022', 'Advanced Phonetics and Phonology', 3),
          row('LING 4400', 'Quantitative Methods in Linguistics', 3),
          row('LING 4710', 'Languages in Contact', 3),
          row('LING 4860', 'Sociolinguistics', 3),
          row('LLED 4620E', 'ESOL Service Learning', 3),
          row('LLED 4620S', 'ESOL Service Learning', 3),
          row('LLED 5502', 'ESOL and World Language Assessment', 3),
        ]),
        hoursFrom(focus(5, 'Area of Emphasis in TESOL', 'LING courses'), 6, levels('LING', 3, 4), 'Two LING courses at the 3000/4000 level.'),
        hoursFrom(focus(5, 'Area of Emphasis in TESOL', 'language courses'), 6, ['AMHA', 'AMSL', 'ARAB', 'BENG', 'CHNS', 'FREN', 'GREK', 'GRMN', 'HEBR', 'HNDI', 'INDO', 'ITAL', 'JPNS', 'KREN', 'LATN', 'PASH', 'PERS', 'PORT', 'QUEC', 'RUSS', 'SCAN', 'SEMI', 'SLAV', 'SPAN', 'SWAH', 'TURK', 'URDU', 'VIET', 'YORB', 'ZULU'].flatMap((subject) => levels(subject, 2, 4)), 'Two language courses at the 2001 level or higher.'),
        all(focus(6, 'Area of Emphasis in Educational Studies in Language Education'), [
          row('EPSY 4061', 'Motivational Foundations for Education', 3),
          row('LLED 4620E', 'ESOL Service Learning', 3),
          row('LLED 5630', 'ESOL, Grades P-12', 3),
        ], 'In place of LLED 5560 and LLED 5570; does not lead to teacher certification.'),
        choose(focus(6, 'Area of Emphasis in Educational Studies in Language Education', 'linguistics'), 2, [
          row('CMSD 3120', 'Study of Language Development', 3),
          row('ENGL 4170', 'Second Language Acquisition', 3),
          row('LING 3250', 'Morphology', 3),
          row('LING 3830', 'Languages of the World', 3),
          row('LING 4022', 'Advanced Phonetics and Phonology', 3),
          row('LING 4400', 'Quantitative Methods in Linguistics', 3),
          row('LING 4710', 'Languages in Contact', 3),
          row('LING 4860', 'Sociolinguistics', 3),
        ]),
        choose(focus(6, 'Area of Emphasis in Educational Studies in Language Education', 'history'), 1, [
          row('HIST 3010', 'United States Immigration History', 3),
          row('HIST 3020', 'United States Foreign Relations Since 1914', 3),
          row('HIST 3220', 'History of Mexico', 3),
          row('HIST 3230', 'History of Brazil', 3),
          row('HIST 3270', 'History of Argentina and Chile in the 20th Century', 3),
          row('HIST 3311', 'Society and Culture of Ancient Greece', 3),
          row('HIST 3312', 'Society and Culture in the Roman World', 3),
          row('HIST 3321', 'History of Women in the Ancient World', 3),
          row('HIST 3381', 'Old Regime and Revolutionary France', 3),
          row('HIST 3382', 'Modern France Since 1799', 3),
          row('HIST 3390', 'Germany Since 1789', 3),
          row('HIST 3443', 'Spain in the Age of Cervantes', 3),
          row('HIST 4211', 'Cuba from Emancipation to Revolution', 3),
          row('HIST 4220', 'The United States and Latin America', 3),
          row('HIST 4225', 'Medicine, Healing, and the Body in Ancient Greece and Rome', 3),
          row('HIST 4230', 'Supernatural Latin America: Readings on Witchcraft, Shamanism, and Popular Religion', 3),
          row('HIST 4240', 'Citizenship and Social Movements in Latin America and the Caribbean', 3),
          row('HIST 4250', 'Race, Nation, and Popular Culture in Latin America', 3),
          row('HIST 4320', 'Law and Society in the Greco-Roman World', 3),
          row('HIST 4329', 'Studies in Ancient Greek and Roman History', 3),
          row('HIST 4391', 'The French Revolution and the First Empire', 3),
          row('HIST 4392', 'Twentieth-Century France', 3),
        ]),
        hoursFrom(focus(6, 'Area of Emphasis in Educational Studies in Language Education', 'Area VI'), 3, ['FREN', 'GRMN', 'ITAL', 'LATN', 'PORT', 'SPAN', 'CHNS', 'JPNS', 'KREN', 'ARAB', 'RUSS'].flatMap((subject) => levels(subject, 3, 4)), 'Area VI: a 3000-level or higher language course.'),
      ]),
    ],
  },
};

/**
 * EDUC 2140 Foundations of Reading (C or higher), which the education
 * pages list among the program completion requirements for teacher
 * certification and their four-year plans book (verified 2026-10-29 on
 * bulletin.uga.edu/Program/Details/90610, 68952 and 93788); no row named it.
 */
const withFoundationsOfReading = (areas: UgaRequirementArea[]): UgaRequirementArea[] =>
  areas.some((existing) => existing.groups.some((group) => group.courses.some((course) => course.code === 'EDUC 2140')))
    ? areas
    : [...areas, area('Program Completion Requirements', 3, [
      all('Program Completion Requirements', [row('EDUC 2140', 'Foundations of Reading', 3)], 'A grade of C or higher, for teacher certification; with the trainings and assessments the Bulletin page lists.'),
    ])];

/**
 * Smaller repairs, where the reading is right but for a row or two: matched
 * by the rows' Bulletin labels, so they do nothing once a later reading
 * reads those rows another way.
 */
const REPAIRED: Record<string, (areas: UgaRequirementArea[]) => UgaRequirementArea[]> = {
  /*
   * Elementary Education BSED (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/90610): "EDEL 5460 (12 hours)", read
   * at its catalog minimum of 3 (a board about 15 hours short of the degree).
   */
  '90610': (areas) => withFoundationsOfReading(areas.map((existing) => ({
    ...existing,
    groups: existing.groups.map((group) => ({ ...group, courses: group.courses.map((course) => (course.code === 'EDEL 5460' && course.credits < 12 ? { ...course, credits: 12 } : course)) })),
  }))),
  /*
   * Computer Systems Engineering BSCSE (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/45516): "Major Electives (12 hours).
   * Choose at least four elective courses" from its subject lists, as
   * Electrical Engineering's (uga-program-overrides.ts, 81996); read as
   * "choose 1", boards planned 3 of the 12 hours.
   */
  '45516': (areas) => areas.map((existing) => (existing.label === 'Major Electives' && existing.hours === 12
    ? { ...existing, groups: [hoursFrom('Major Electives', 12, [...new Map(existing.groups.flatMap((group) => group.courses).map((course) => [course.code, course])).values()], 'Choose at least four elective courses, at least one with the CSEE, ECSE, ELEE or INFO prefix at the 3000 level or above. At most 3 hours of undergraduate research and 3 of co-operative work or internship.')] }
    : existing)),
  /*
   * Arabic AB (verified 2026-10-30, bulletin.uga.edu/Program/Details/98747):
   * Required Courses (21 hours) are "a minimum of 9 credit hours" of ARAB
   * 3005, 3006, 4960R or ARAB courses at the 3000 level or above, and "a
   * maximum of 12 credit hours" from the second list. Read as one 21-hour
   * pool with "three courses from the first list", boards booked ARAB 3005,
   * 3006 and a 1-hour ARAB 4960R (7 of the 9 hours) and never met it.
   */
  '98747': (areas) => areas.map((existing) => {
    if (existing.label !== 'Required Courses' || existing.hours !== 21) return existing;
    const pool = existing.groups.find((group) => group.hours === 21 && (group.lists ?? []).length === 2);
    if (!pool) return existing;
    const [first, second] = pool.lists!;
    const of = (codes: string[]) => pool.courses.filter((course) => codes.includes(course.code) && !/XXX$/.test(course.code));
    const arab = [
      ...of(first.codes).filter((course) => course.code !== 'ARAB 4960R'),
      ...levels('ARAB', 3),
      ...of(['ARAB 4960R']),
    ];
    return {
      ...existing,
      groups: [
        hoursFrom('ARAB courses numbered 3000 and above', 9, arab, 'A minimum of 9 hours from ARAB 3005, ARAB 3006, ARAB 4960R or ARAB courses at the 3000 level or above.'),
        hoursFrom('More ARAB courses or the second list', 12, [...levels('ARAB', 3), ...of(second.codes)], 'The other 12 hours: more ARAB courses at the 3000 level or above, or at most 12 hours from the second list.'),
      ],
    };
  }),
  /*
   * Animal Health BSA (verified 2026-10-30, bulletin.uga.edu/Program/Details/18956):
   * "Major Electives (13 hours). Choose 13 credit hour(s) from the
   * following: Major Elective courses", with no list; the page says the
   * coursework of the first year of the UGA D.V.M. program completes "the
   * remaining hours of the Major Electives and General Electives". Read as
   * a 13-hour row with no courses, every board left it 0 of 13. Planned
   * instead as the General Electives are (filled by electives toward the
   * degree total), with the page's 13 hours named in that area.
   */
  '18956': (areas) => {
    const major = areas.find((existing) => existing.label === 'Major Electives' && existing.groups.every((group) => group.courses.length === 0));
    const general = areas.find((existing) => existing.label === 'General Electives');
    if (!major || !general) return areas;
    const named: UgaRequirementGroup = { label: 'Major Electives', choose: null, hours: major.hours, note: `The page's Major Electives (${major.hours} hours) list no courses: the first year of the UGA D.V.M. program completes them and the General Electives. Until then, electives chosen with your advisor.`, courses: [] };
    return areas.flatMap((existing) => (existing === major ? [] : existing === general ? [{ ...general, hours: general.hours + major.hours, groups: [...general.groups, named] }] : [existing]));
  },
  /*
   * Human Development and Family Science BSFCS (verified 2026-10-30,
   * bulletin.uga.edu/Program/Details/67554): "Required Courses (60 hours)"
   * is the whole major: the required courses proper (one experiential
   * option, 7 hours; Development Courses, 6; one Focus Area, 21: 34
   * hours), Major Electives (9 hours from the page's HDFS and FACS list)
   * and General Electives (17 hours). The reading kept the 60-hour heading
   * on the 34 hours of rows and lost the other two, so every board read
   * Required Courses 34 of 60.
   */
  '67554': (areas) => {
    if (areas.some((existing) => existing.label === 'Major Electives')) return areas;
    const at = areas.findIndex((existing) => existing.label === 'Required Courses' && existing.hours === 60);
    if (at < 0) return areas;
    const hdfs = (number: string, title: string) => row(`HDFS ${number}`, title, 3);
    const majorElectives = area('Major Electives', 9, [hoursFrom('Major Electives', 9, [
      hdfs('3000', 'Introduction to Behavioral Health'), hdfs('3010', 'Directed Study in Human Development and Family Science'),
      hdfs('3200', 'Substance Use and Other Addictive Behaviors within Family Systems'), hdfs('3700', 'Adolescent Development'),
      hdfs('3900', 'Infant and Toddler Development'), hdfs('3920', 'Issues in Family Systems'),
      hdfs('3930', 'It’s Complicated: Intimate Relationships in the 21st Century'), hdfs('4130', 'Family Policy: Bridging Theory and Practice'),
      hdfs('4140E', 'Medical Terminology for Healthcare Professionals'), hdfs('4200', 'Health Technology, Ethics, and Human Development'),
      hdfs('4610', 'The Family'), hdfs('4620', 'Women in the Family and Society'),
      hdfs('4700', 'Creativity and Mindfulness in Behavioral Health'), hdfs('4810', 'Hospitalized Child and the Family'),
      hdfs('4820', 'Child Life Theory and Practice'), hdfs('4830', 'Grief, Loss, and Bereavement'),
      hdfs('4860', 'Parenting and Child Guidance'), hdfs('4880', 'Family Life Education Methodology'),
      hdfs('4890S', 'More than a Four-Legged Friend: The Benefits of Animal-Assisted Interventions'), hdfs('4900', 'Seminar in Human Development and Family Science'),
      hdfs('4910', 'Early and Middle Childhood Development'), hdfs('4960R', 'Faculty-Mentored Undergraduate Research I'),
      hdfs('4970R', 'Faculty-Mentored Undergraduate Research II'), hdfs('4980R', 'Faculty-Mentored Undergraduate Research III'),
      hdfs('4990R', 'Undergraduate Research Thesis (or Final Project)'), hdfs('5100', 'Prevention and Intervention in Human Development and Family Science'),
      hdfs('5110', 'Research Methods in Human Development and Family Science'), hdfs('5130', 'Therapeutic Benefits of Play'),
      hdfs('5150', 'Families, Schools, and Communities'), hdfs('5710', 'Study Tour in Human Development and Family Science'),
      row('FACS 5711', 'Study Tour in Family and Consumer Sciences', 3), row('FACS 5910', 'Internship in Family and Consumer Sciences', 3),
      row('FACS 5915', 'International Internship in Family and Consumer Sciences', 3), row('FACS 5950', 'International Study in Family and Consumer Sciences', 3),
    ], 'Choose 9 credit hours from the page\'s Major Electives list (a course counts once: not one taken for the required courses).')]);
    return [
      ...areas.slice(0, at),
      { ...areas[at], hours: 34 },
      majorElectives,
      ...(areas.some((existing) => /^General Electives/.test(existing.label)) ? [] : [generalElectives(17)]),
      ...areas.slice(at + 1),
    ];
  },
  '68952': withFoundationsOfReading,
  '93788': withFoundationsOfReading,
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
  /*
   * Computer Science BS (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/73962): CSCI 2610 is an entrance
   * requirement and one of the courses of the 19-hour rule ("CSCI 2610,
   * MATH 2250, and the Major Related Electives"); no row named it, so no
   * board had it. (The Teamwork Requirement, one of CSCI 4050, 4300, 4370,
   * 4530 or 4800, is met by most boards' Application Design Group course.)
   */
  '73962': (areas) => areas.map((existing) => (existing.label === 'Major Related Electives' && !existing.groups.some((group) => group.courses.some((course) => course.code === 'CSCI 2610'))
    ? { ...existing, groups: [
      // A choice of the one course: a list with no number to choose, in an area of electives, is read as hours to draw from.
      choose('Discrete Mathematics', 1, [row('CSCI 2610', 'Discrete Mathematics for Computer Science', 4)], 'An entrance requirement for the major (C or better, within two attempts); with MATH 2250 and the Major Related Electives, at least 19 hours.'),
      ...existing.groups,
    ] }
    : existing)),
  /*
   * Electrical and Electronics Engineering BSEE (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/81996): the core's starred courses are
   * "required for this major": MATH 2250 in Area I, MATH 2260 in Area III,
   * COMM 1110 in Area IV. Read as preferred choices inside the core lists,
   * a board could leave each out (MATH 2260 is a prerequisite for the
   * upper-division courses).
   */
  '81996': (areas) => areas.map((existing) => {
    if (/^I\.\s/.test(existing.label)) {
      return { ...existing, groups: existing.groups.map((group) => (group.choose === 1 && group.courses.some((course) => course.code === 'MATH 2250')
        ? { ...group, label: 'Calculus I', choose: null, note: 'MATH 2250 is required for this major.', courses: group.courses.filter((course) => course.code === 'MATH 2250') }
        : group)) };
    }
    if (!/^III\.\s|^IV\. Humanities/.test(existing.label)) return existing;
    return { ...existing, groups: existing.groups.map((group) => (/^preferred courses?/i.test(group.label.trim()) && group.courses.every((course) => /^(?:MATH 2260|COMM 1110)$/.test(course.code))
      ? { ...group, label: 'Required for this major', note: 'This course is required for this major.' }
      : group)) };
  }),
  /*
   * Mechanical Engineering BSME (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/20122): "Required Courses (70 hours)"
   * holds the Mechanical Engineering Electives (15 hours) the page prints
   * as a section of its own; read as both, a board carried 14 unnamed
   * hours on top (about 142 of 130).
   */
  '20122': (areas) => {
    const electives = areas.find((existing) => existing.label === 'Mechanical Engineering Electives');
    const read = electives ? areas.map((existing) => (existing.label === 'Required Courses' && existing.hours === 70 ? { ...existing, hours: existing.hours - electives.hours } : existing)) : areas;
    /*
     * Area VI's heading says 18 hours, its rows 16: ENGR 1120 (2), ENGR 1140
     * (2), MATH 2500 (3), MATH 2700 (3) and two physics courses, which the
     * Bulletin's own four-year plan takes as PHYS 1251 and 1252, three hours
     * each (verified 2026-10-29, bulletin.uga.edu/Program/Details/20122).
     * Every board that booked exactly that read "VI 16 of 18".
     */
    return read.map((existing) => (AREA_SIX.test(existing.label) && existing.hours === 18 ? { ...existing, hours: 16 } : existing));
  },
  /*
   * Art BFA - Graphic Design (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/79344). Design Focus Tracks /
   * Professional Electives: "a second major, certificate, or minor OR a
   * minimum of nine (9) credit hours in one of the following associated
   * subject areas", read as "choose 9 courses" over every subject's list,
   * 27 hours from three subjects: 9 hours from the first list (Art, Design,
   * and Architectural History) unless the student names another. And Area
   * VI's photography, "ARST 2205 with its lab, or ARST 2210", never reached
   * a term: the three-hour ARST 2210.
   */
  '79344': (areas) => areas.map((existing) => {
    if (AREA_SIX.test(existing.label)) {
      return { ...existing, groups: existing.groups.map((group) => (group.choose === 1 && group.courses.some((course) => course.code === 'ARST 2210') && group.courses.some((course) => course.code === 'ARST 2205')
        ? { ...group, label: 'Photography', choose: null, courses: group.courses.filter((course) => course.code === 'ARST 2210'), note: 'ARST 2210, or ARST 2205 with its lab ARST 2205L.' }
        : group)) };
    }
    if (existing.label !== 'Major Electives') return existing;
    return { ...existing, groups: existing.groups.map((group) => {
      if (!/^Design Focus Tracks/.test(group.label) || group.choose !== 9) return group;
      const end = group.courses.findIndex((course) => course.code === 'TXMI 4360');
      if (end < 0) return group;
      return { ...group, label: 'Design Focus: Art, Design, and Architectural History', choose: null, hours: 9, courses: group.courses.slice(0, end + 1), note: 'A second major, certificate or minor, or at least 9 hours in one associated subject area (at least 6 at the 2000 level or above). Planned from Art, Design, and Architectural History; Communications and Media, Cultural Studies, Interaction and Computing, Marketing and Strategy and the others on the Bulletin page count as well.' };
    }) };
  }),
  /*
   * Atmospheric Sciences BS (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/29248): General Electives (28 hours)
   * are electives; the list under them is the major courses'
   * prerequisites (calculus and physics), which the reading made a 28-hour
   * pool of 23 hours of courses that could never be met. The planner books
   * a major course's prerequisites as it does any course's.
   */
  '29248': (areas) => areas.map((existing) => (/^General Electives\b/.test(existing.label) && existing.groups.some((group) => group.courses.some((course) => /^(?:MATH|PHYS) /.test(course.code)))
    ? { ...existing, groups: [] }
    : existing)),
  /*
   * Biochemistry and Molecular Biology BS (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/95737): Major Electives (12 hours) are
   * CHEM 2212 with its lab, MATH 2260 or STAT 2000, and a second semester of
   * physics. A list with no number to choose, in an area of electives, is
   * read as hours to draw from, so CHEM 2212 and its lab were a 12-hour
   * pool of 4 hours that could never be met: they are a choice of both.
   */
  /*
   * And Area VI's last line, "Choose 2 credit hours: 1000/2000-level
   * electives", came out a 2-hour group of no courses: every board read VI
   * 16 of 18 (2026-10-29). Any course numbered 1000 to 2999.
   */
  '95737': (areas) => areas.map((existing) => (existing.label === 'Major Electives'
    ? { ...existing, groups: existing.groups.map((group) => (group.choose === null && group.hours == null && group.courses.length === 2 && group.courses.every((course) => /^CHEM 2212L?$/.test(course.code))
      ? { ...group, label: 'Organic Chemistry II', choose: 2 }
      : group)) }
    : AREA_SIX.test(existing.label)
      ? { ...existing, groups: existing.groups.map((group) => (group.courses.length === 0 && group.hours === 2 ? hoursFrom('1000/2000-level electives', 2, [{ ...ANY_COURSE, levelTo: 2 } as UgaRequirementCourse], 'Any course numbered 1000 to 2999.') : group)) }
      : existing)),
  /*
   * English AB (verified 2026-10-30, bulletin.uga.edu/Program/Details/86328):
   * Major Electives are "five 3-hour ENGL electives at the 3000/4000 levels,
   * at least one course at the 4000 level"; the reading kept one 15-hour
   * pool, and a board booked five 3000-level courses. One of the five at the
   * 4000 level, the other four at either.
   */
  /*
   * Political Science BS (verified 2026-10-30,
   * bulletin.uga.edu/Program/Details/12235): Area VI asks for one of HIST
   * 2111 and 2112 (with ECON 2105 and 2106, a statistics course, calculus
   * and a PHIL course). Area V's social sciences took both histories, so
   * Area VI had none left and every board read "VI 16 of 18" and "does not
   * finish". Area V plans its social sciences from the rest of its list;
   * the history Area VI books also meets the U.S. and Georgia history
   * requirement.
   */
  '12235': (areas) => areas.map((existing) => (/^V\.\s/.test(existing.label) ? { ...existing, excludeCodes: [...new Set([...(existing.excludeCodes ?? []), 'HIST 2111', 'HIST 2112'])] } : existing)),
  '86328': (areas) => areas.map((existing) => {
    if (existing.label !== 'Major Electives') return existing;
    const pool = existing.groups.find((group) => group.choose === null && group.hours === 15 && group.courses.some((course) => course.code === 'ENGL 4XXX'));
    if (!pool) return existing;
    const upper = pool.courses.filter((course) => /^ENGL 4/.test(course.code));
    return { ...existing, groups: [
      hoursFrom('Major Electives: one at the 4000 level', 3, upper, 'At least one of the five major electives at the 4000 level.'),
      hoursFrom('Major Electives', 12, pool.courses, 'Four more 3-hour ENGL electives at the 3000 or 4000 level.'),
      ...existing.groups.filter((group) => group !== pool),
    ] };
  }),
  /*
   * Civil Engineering BSCE (verified 2026-10-29,
   * bulletin.uga.edu/Program/Details/79689): Major Electives are six courses
   * from at least two of the four tracks, at least three of them design
   * courses (ENVE 4410 or ENVE 6430, only one); the reading made each track
   * a pool of its own (20, 2, 1 and 1 hours, the 20 from 18 hours of
   * courses: never met). The heading's 20 hours are the six courses' 18.
   * The reader since 2026-10-29 reads one "choose 6" over all four tracks,
   * which loses the two-track and design rules and asks 20 hours of six
   * three-hour courses: the same repair applies to either reading.
   */
  '79689': (areas) => areas.map((existing) => {
    if (existing.label !== 'Major Electives' || !existing.groups.some((group) => /^Geotechnical/.test(group.label) || group.courses.some((course) => course.code === 'CVLE 4420'))) return existing;
    const tracks = {
      Geotechnical: [
        row('CVLE 4420', 'Advanced Soil Mechanics', 3),
        row('CVLE 4430', 'Groundwater Engineering', 3),
        row('CVLE 4440', 'Design with Geosynthetics', 3),
        row('CVLE 4450', 'Geotechnical Structures – Foundations and Retaining Walls', 3),
        row('CVLE 4470', 'Pavement Design', 3),
        row('GEOL 4360', 'Introduction to Rock Mechanics', 3),
      ],
      Hydraulics: [
        row('CVLE 3440', 'Hydraulics of Closed Conduit Flow', 3),
        row('ENVE 4410', 'Open Channel Hydraulics', 3),
        row('ENVE 6430', 'Advanced Open Channel Design', 3),
        row('WASR 4500', 'Quantitative Methods in Hydrology', 3),
      ],
      'Infrastructure Engineering': [
        row('CVLE 4220', 'Highway Design and Traffic Safety', 3),
        row('CVLE 4660', 'Sustainable Building Design', 3),
        row('CVLE 4730', 'Project Estimating and Planning', 3),
        row('CVLE 4750', 'Building Information Modeling (BIM)', 3),
        row('CVLE 4760', 'Commercial Building Systems', 3),
        row('CVLE 4780', 'Advanced Computer-Aided Design Civil 3D', 3),
        row('ENGR 3620', 'Introduction to E-Mobility', 3),
        row('ENVE 4470', 'Environmental Engineering Unit Operations', 3),
        row('ENVE 4550', 'Environmental Life Cycle Analysis', 3),
        row('ENVE 4710', 'GIS for Urban Engineering, Planning, and Development', 3),
        row('ENVE 4720', 'Urban Infrastructure Planning and Development', 3),
        row('MCHE 4400', 'Air Pollution Engineering', 3),
      ],
      'Structural Engineering': [
        row('CVLE 4330', 'Advanced Structural Analysis', 3),
        row('CVLE 4340', 'Design of Bridges', 3),
        row('CVLE 4530', 'Design of Reinforced Concrete Structures', 3),
        row('CVLE 4610', 'Design of Steel Structures', 3),
        row('CVLE 4720', 'Engineering Design of Residential Structures', 3),
        row('CVLE 4810', 'Design of Wood Structures', 3),
        row('ENGR 4350', 'Introduction to Finite Element Analysis', 3),
      ],
    };
    const group = hoursFromLists('Major Electives', 18, tracks, 'Six courses from at least two of the tracks (Geotechnical, Hydraulics, Infrastructure Engineering, Structural Engineering), at least three of them design courses; only one of ENVE 4410 and ENVE 6430.');
    const design = ['CVLE 4440', 'CVLE 4450', 'CVLE 4470', 'CVLE 3440', 'ENVE 4410', 'ENVE 6430', 'CVLE 4760', 'CVLE 4780', 'MCHE 4400', 'CVLE 4340', 'CVLE 4530', 'CVLE 4610', 'CVLE 4720', 'CVLE 4810'];
    const lists = group.lists ?? [];
    return { ...existing, hours: 18, groups: [{
      ...group,
      constraints: [
        { text: 'From at least two of the tracks.', n: 2, lists, single: false, distinctLists: true },
        { text: 'At least 3 design courses.', n: 3, lists: [{ label: 'Design courses', codes: design }], single: false },
      ],
    }] };
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
      // Not the campus's Foundation Core Courses list, which the page repeats after its own rows (the adapter reads it as a reference list).
      if (/core courses?/i.test(group.label) || group.choose !== null || group.hours != null || !codes.includes('ENGL 1101') || !codes.includes('ENGL 1102') || !codes.some((code) => /^(?:MATH|STAT) /.test(code))) return [group];
      const english = group.courses.filter((course) => /^ENGL 110[12]$/.test(course.code));
      return [{ ...group, courses: english }, { label: '', choose: 1, courses: group.courses.filter((course) => !english.includes(course)) }];
    }) };
  });
}

/**
 * The campus core areas every degree page repeats (Areas II to V, each its
 * "Core Courses" list), read from the degrees whose page has them: for a
 * degree whose reading lost one (WrittenDegree.campusCore).
 */
export function ugaCampusCore(programs: UgaProgramRecord[]): Map<string, UgaRequirementArea> {
  const found = new Map<string, UgaRequirementArea>();
  for (const program of programs) {
    for (const existing of program.areas as UgaRequirementArea[]) {
      if (!CORE_AREA.test(existing.label) || found.has(existing.label)) continue;
      const list = existing.groups.find((group) => /core courses$/i.test(group.label.trim()));
      if (list) found.set(existing.label, { label: existing.label, hours: existing.hours, groups: [list] });
    }
  }
  return found;
}

/** `program` with its written areas, or its repaired rows, where this file has them (`overlap`: an area courses counted elsewhere meet; `campusCore`: ugaCampusCore). */
export function fixedUgaDegree<T extends UgaProgramRecord>(program: T, overlap: (label: string) => boolean, campusCore: Map<string, UgaRequirementArea> = new Map()): T {
  const written = WRITTEN[program.id];
  const repair = REPAIRED[program.id];
  const areas = foundationRead(program.areas as UgaRequirementArea[]);
  if (!written) {
    if (!repair) return { ...program, areas };
    const repaired = repair(areas);
    const hoursOf = (list: UgaRequirementArea[]) => list.reduce((sum, existing) => sum + existing.hours, 0);
    return { ...program, areas: repaired, areaHours: program.areaHours + hoursOf(repaired) - hoursOf(areas) };
  }
  const read = areas.filter((existing) => CORE_AREA.test(existing.label)).map((existing) => written.core?.find((own) => own.label === existing.label) ?? existing);
  const lost = (written.campusCore ?? []).filter((label) => !read.some((existing) => existing.label === label)).flatMap((label) => campusCore.get(label) ?? []);
  // In the core's own order (I to V), as the pages print it.
  const order = (label: string) => ['I.', 'II. Physical', 'II. Life', 'III.', 'IV. World', 'IV. Humanities', 'V.'].findIndex((start) => label.startsWith(start));
  const core = [...read, ...lost].sort((a, b) => order(a.label) - order(b.label));
  const six = written.areaSix === undefined ? areas.find((existing) => AREA_SIX.test(existing.label)) : written.areaSix;
  const kept = areas.filter((existing) => overlap(existing.label));
  const next = [...core, ...(six ? [six] : []), ...written.major, ...kept];
  const hours = next.filter((existing) => !overlap(existing.label)).reduce((sum, existing) => sum + existing.hours, 0);
  return { ...program, areas: next, areaHours: hours, totalCredits: written.total ?? program.totalCredits, emphasisGroups: [] } as T;
}
