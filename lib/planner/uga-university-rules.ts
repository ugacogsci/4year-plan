/*
 * UGA's university-wide and college-wide graduation rules, which no program
 * page's degree table carries, read 2026-10-29 from the Bulletin's
 * Undergraduate Graduation Requirements and Degree Hour Requirements pages,
 * the School/College Cultural Diversity and Environmental Awareness lists,
 * Franklin College's degree requirements (osas.franklin.uga.edu) and the
 * College-wide Requirements printed on the program pages. The audit of all
 * 161 bachelor's degrees found them planned on none (2026-10-29): a
 * Franklin board could read complete with no language past a first
 * semester, no literature and no multicultural course; a business board
 * with two lecture-only sciences; no board booked the one hour of physical
 * education.
 *
 * Each rule is an area of the degree that courses counted elsewhere meet,
 * as the Terry and University-Wide areas are (uga-program-overrides.ts):
 * the core's and the major's courses count, and a course is booked only
 * where none on the board does. The foreign language is the exception: it
 * is a sequence, planned in order from the level the student starts at
 * (expandUgaLanguage). Physical education is booked outside the 120 hours
 * (withUgaUniversityRows), and the upper-division and residence hours are
 * audit lines (ugaUniversityIssues).
 */
import type { AutoplanInput, LanguagePlan, LanguageTable, PlanCourseChoice, PlanPrereq, PlanRequirement } from './autoplan';
import type { PlanIssue } from './types';
import { ugaAreaFamily } from './uga-program-overrides';
import {
  FRANKLIN_BIOLOGICAL_SCIENCES,
  FRANKLIN_FINE_ARTS,
  FRANKLIN_HISTORY,
  FRANKLIN_LITERATURE,
  FRANKLIN_MULTICULTURAL,
  FRANKLIN_PHYSICAL_SCIENCES,
  FRANKLIN_SOCIAL_SCIENCES,
  ODUM_FINE_ARTS,
  ODUM_LITERATURE,
  ODUM_SOCIAL_SCIENCES,
  SPIA_FINE_ARTS,
  SPIA_LITERATURE,
  UGA_CULTURAL_DIVERSITY,
  UGA_ENVIRONMENTAL_AWARENESS,
  type UgaRuleList,
} from './uga-university-rule-lists';

type RuleRow = { code: string; title: string; credits: number };
type RuleGroup = { label: string; choose: number; hours?: number | null; note?: string; courses: RuleRow[] };
type RuleArea = { label: string; hours: number; groups: RuleGroup[] };
type ProgramRecord = { id: string; areas: unknown[]; college?: string; degree?: string; name?: string };
type CatalogCourse = { code: string; title: string; credits: number };

const norm = (code: string) => code.replace(/\s+/g, ' ').trim().toUpperCase();
/** A UGA code without its online, honors, service-learning or writing suffix (SPAN 1001E -> SPAN 1001). */
const baseCode = (code: string) => norm(code).replace(/^([A-Z]{2,5} \d{4})[EHSW]$/, '$1');
const numberOf = (code: string) => Number(code.match(/ (\d{4})/)?.[1] ?? 0);

const UNIVERSITY_PAGE = 'https://bulletin.uga.edu/UnivInfo/content/university-info-undergrad-graduation-requirements.html';
const FRANKLIN_PAGE = 'https://osas.franklin.uga.edu/franklin-college-degree-requirements';

// ---------------------------------------------------------------------------
// The foreign language sequence
// ---------------------------------------------------------------------------

/*
 * UGA's languages as sequences, first semester first: 1001, 1002, then the
 * third semester (2001, or 2003 where the department numbers it so), the
 * fourth, and the conversation level the International Business co-majors
 * ask for ("ARAB 3005, CHNS 3010, FREN 3010 ... KREN 3001, PORT 3010, RUSS
 * 3001, SPAN 3010 ... VIET 3001, YORB 3001", bulletin.uga.edu/Program/Details/17378).
 * Scandinavian and Slavic stop at the second semester and cannot meet a
 * third-semester rule, so they are not here. American Sign Language counts
 * for Franklin's requirement, not for Area IV (Franklin College Foreign
 * Language Requirement, updated 07.28.2026).
 */
const UGA_LANGUAGE_ROWS: Array<[name: string, levels: string[]]> = [
  ['Spanish', ['SPAN 1001', 'SPAN 1002', 'SPAN 2001', 'SPAN 2002', 'SPAN 3010']],
  ['French', ['FREN 1001', 'FREN 1002', 'FREN 2001', 'FREN 2002', 'FREN 3010']],
  ['German', ['GRMN 1001', 'GRMN 1002', 'GRMN 2001', 'GRMN 2002', 'GRMN 3010']],
  ['Italian', ['ITAL 1001', 'ITAL 1002', 'ITAL 2001', 'ITAL 2002', 'ITAL 3010']],
  ['Portuguese', ['PORT 1001', 'PORT 1002', 'PORT 2001', 'PORT 2002', 'PORT 3010']],
  ['Chinese', ['CHNS 1001', 'CHNS 1002', 'CHNS 2001', 'CHNS 2002', 'CHNS 3010']],
  ['Japanese', ['JPNS 1001', 'JPNS 1002', 'JPNS 2001', 'JPNS 2002', 'JPNS 3010']],
  ['Korean', ['KREN 1001', 'KREN 1002', 'KREN 2001', 'KREN 2002', 'KREN 3001']],
  ['Arabic', ['ARAB 1001', 'ARAB 1002', 'ARAB 2003', 'ARAB 2004', 'ARAB 3005']],
  ['Russian', ['RUSS 1001', 'RUSS 1002', 'RUSS 2001', 'RUSS 2002', 'RUSS 3001']],
  ['Vietnamese', ['VIET 1001', 'VIET 1002', 'VIET 2001', 'VIET 2002', 'VIET 3001']],
  ['Yoruba', ['YORB 1010', 'YORB 1020', 'YORB 2010', 'YORB 2020', 'YORB 3001']],
  ['Latin', ['LATN 1001', 'LATN 1002', 'LATN 2001', 'LATN 2002']],
  ['Greek', ['GREK 1001', 'GREK 1002', 'GREK 2001', 'GREK 2002']],
  ['Hebrew', ['HEBR 1001', 'HEBR 1002', 'HEBR 2003', 'HEBR 2004']],
  ['American Sign Language', ['AMSL 1010', 'AMSL 1020', 'AMSL 2010', 'AMSL 2020']],
  ['Hindi', ['HNDI 1001', 'HNDI 1002', 'HNDI 2001', 'HNDI 2002']],
  ['Urdu', ['URDU 1001', 'URDU 1002', 'URDU 2003', 'URDU 2004']],
  ['Bengali', ['BENG 1001', 'BENG 1002', 'BENG 2003', 'BENG 2004']],
  ['Persian', ['PERS 1001', 'PERS 1002', 'PERS 2003', 'PERS 2004']],
  ['Turkish', ['TURK 1001', 'TURK 1002', 'TURK 2003', 'TURK 2004']],
  ['Indonesian', ['INDO 1001', 'INDO 1002', 'INDO 2003', 'INDO 2004']],
  ['Pashto', ['PASH 1001', 'PASH 1002', 'PASH 2003', 'PASH 2004']],
  ['Swahili', ['SWAH 1010', 'SWAH 1020', 'SWAH 2010', 'SWAH 2020']],
  ['Hausa', ['HAUS 1010', 'HAUS 1020', 'HAUS 2010', 'HAUS 2020']],
  ['Amharic', ['AMHA 1001', 'AMHA 1002', 'AMHA 2001', 'AMHA 2002']],
  ['Zulu', ['ZULU 1001', 'ZULU 1002', 'ZULU 2001', 'ZULU 2002']],
  ['Quechua', ['QUEC 1001', 'QUEC 1002', 'QUEC 2001', 'QUEC 2002']],
];

/*
 * Accelerated courses that are two semesters in one: Accelerated Elementary
 * Spanish (SPAN 1110) is the first two, Accelerated Intermediate Italian
 * (ITAL 2110) the third and fourth. Held, they count as the last level they
 * cover; the plan never books one (they are for students with some of the
 * language already).
 */
const ACCELERATED: Record<string, number> = {
  'SPAN 1110': 2, 'FREN 1110': 2, 'GRMN 1110': 2, 'ITAL 1110': 2, 'PORT 1110': 2,
  'GRMN 2110': 4, 'ITAL 2110': 4, 'FREN 2120H': 4, 'PORT 2120': 4,
};

/** UGA's language table for the planner (PlanningContext.languages): one option a level, the course itself. */
export function ugaLanguageTable(catalog: ReadonlyArray<{ code: string }>): LanguageTable {
  const known = new Set(catalog.map((course) => norm(course.code)));
  return {
    languages: UGA_LANGUAGE_ROWS.filter(([, levels]) => levels.slice(0, 3).every((code) => known.has(code))).map(([name, levels]) => ({
      name,
      levels: levels.filter((code) => known.has(code)).map((code) => [[code]]),
      note: null,
    })),
  };
}

/*
 * Each semester of a sequence after the one before it, where the catalog
 * file gives it no such prerequisite (KREN 1002 to 3001, VIET 2001, AMSL
 * 2010 and 2020, whose line reads "Permission of department"): planned
 * without one, a Journalism freshman's AMSL 2010 sat in her first term
 * beside AMSL 1010 (2026-10-29). `prereqs` is changed in place.
 */
export function withUgaLanguageOrder(prereqs: Map<string, PlanPrereq>, table: LanguageTable): void {
  for (const language of table.languages) {
    const codes = language.levels.map((options) => options[0]?.[0]).filter((code): code is string => Boolean(code));
    codes.forEach((code, i) => {
      if (i === 0) return;
      const before = codes[i - 1];
      const known = prereqs.get(code);
      if (known?.groups.some((group) => group.any.includes(before))) return;
      const group = { any: [before], concurrent: false, confidence: 'high' as const, source: `${before} (the semester before it in the ${language.name} sequence)` };
      prereqs.set(code, known
        ? { ...known, groups: [...known.groups, group], parsed: true }
        : { groups: [group], escape: null, text: group.source, parsed: true, confidence: 'high', standing: null });
    });
  }
}

/** The language names, for the setup's picker. */
export const UGA_LANGUAGE_NAMES: readonly string[] = UGA_LANGUAGE_ROWS.map(([name]) => name);

/** What a degree asks for, by the semesters it takes: "through the third semester". */
const LEVEL_NAMES = ['first semester', 'second semester', 'third semester', 'fourth semester', 'conversation level (3000)'];
const FOREIGN_LANGUAGE_LABEL = 'Foreign Language Requirement';

/*
 * The level each degree asks for. Franklin College asks every AB and BS,
 * and the BMus in Composition, Performance and Theory, for "the third
 * semester level course in a single foreign language" (Franklin College
 * Requirements, updated 10.23.2026); so do SPIA ("the third term course of
 * one foreign language"), the Odum School ("completion of the third
 * semester"), Social Studies Education ("a foreign language through the
 * third level", the College of Education's college-wide requirements), the
 * Economics AB (Terry's page sends it to Franklin's rules) and the Grady
 * ABs' Area VI ("Any foreign language including AMSL at the 2000-level or
 * above"). Higher on the degree's own page: International Affairs and
 * Communication Studies the fourth term, Classics and Linguistics a
 * fourth-semester course, and the International Business co-majors
 * "proficiency to the conversation level (3000-level)".
 */
const FRANKLIN_ONLY_MULTICULTURAL = /^(?:BFA|BSCHEM)$/;
const FRANKLIN_ONLY_MULTICULTURAL_IDS = new Set(['22148', '11719']); // BMus Music Education, Music Therapy
const LANGUAGE_FOURTH = new Set(['24662', '52209', '82769', '84398']);
const LANGUAGE_THIRD = new Set(['46524', '12235', '38829', '86043', '79831', '77024', '84144', '98779', '63054', '60174']);
const INTERNATIONAL_BUSINESS = /international business co-major/i;

function franklinDegree(program: ProgramRecord): 'all' | 'multicultural' | null {
  if (program.id === '77024') return 'all';
  if (program.college !== 'ARTS') return null;
  if (FRANKLIN_ONLY_MULTICULTURAL.test(program.degree ?? '') || FRANKLIN_ONLY_MULTICULTURAL_IDS.has(program.id)) return 'multicultural';
  return 'all';
}

/** The semesters of one language a degree asks for, or 0. */
function languageLevelOf(program: ProgramRecord): number {
  if (INTERNATIONAL_BUSINESS.test(program.name ?? '')) return 5;
  if (LANGUAGE_FOURTH.has(program.id)) return 4;
  if (LANGUAGE_THIRD.has(program.id) || franklinDegree(program) === 'all') return 3;
  return 0;
}

// ---------------------------------------------------------------------------
// The rule areas
// ---------------------------------------------------------------------------

/** Labels of the areas this module adds, each met by courses counted elsewhere. */
const FRANKLIN_FAMILY = 'Franklin College';
const RULE_LABELS = new Set<string>();
const label = (text: string) => {
  RULE_LABELS.add(text);
  return text;
};
const CULTURAL_DIVERSITY_LABEL = label('Cultural Diversity Requirement');
const ENVIRONMENTAL_LABEL = label('Environmental Awareness Requirement');
const LAB_SCIENCE_LABEL = label('Core Area II Laboratory Science');
const FRANKLIN_LABELS = {
  literature: label('Franklin College Literature Requirement'),
  fineArts: label('Franklin College Fine Arts, Philosophy and Religion Requirement'),
  history: label('Franklin College History Requirement'),
  socialSciences: label('Franklin College Social Sciences Requirement'),
  biological: label('Franklin College Biological Sciences Requirement'),
  physical: label('Franklin College Physical Sciences Requirement'),
};
const MULTICULTURAL_LABEL = label('Franklin College Multicultural Requirement');
const SPIA_LITERATURE_LABEL = label('SPIA Literature Requirement');
const SPIA_FINE_ARTS_PHILOSOPHY_AND_RELIGION_LABEL = label('SPIA Fine Arts, Philosophy and Religion Requirement');
const SPIA_ECONOMICS_LABEL = label('SPIA Economics Requirement');
const SPIA_STATISTICS_OR_MATHEMATICS_LABEL = label('SPIA Statistics or Mathematics Requirement');
const ODUM_SCHOOL_FINE_ARTS_PHILOSOPHY_AND_RELIGION_LABEL = label('Odum School Fine Arts, Philosophy and Religion Requirement');
const ODUM_SCHOOL_LITERATURE_LABEL = label('Odum School Literature Requirement');
const ODUM_SCHOOL_SOCIAL_SCIENCES_LABEL = label('Odum School Social Sciences Requirement');
const CAES_PRE_CALCULUS_LABEL = label('CAES Pre-calculus Requirement');
const CAES_CHEMISTRY_OR_CALCULUS_LABEL = label('CAES Chemistry or Calculus Requirement');
const CAES_BIOLOGY_OR_BOTANY_LABEL = label('CAES Biology or Botany Requirement');
const CAES_SPEECH_LABEL = label('CAES Speech Requirement');
const WARNELL_STATISTICS_LABEL = label('Warnell Statistics Requirement');
const WARNELL_MATHEMATICS_LABEL = label('Warnell Mathematics Requirement');
const WARNELL_BIOLOGY_I_LABEL = label('Warnell Biology I Requirement');
const WARNELL_BIOLOGY_II_LABEL = label('Warnell Biology II Requirement');
const WARNELL_CHEMISTRY_LABEL = label('Warnell Chemistry Requirement');
const WARNELL_PRE_CALCULUS_LABEL = label('Warnell Pre-calculus Requirement');
const WARNELL_CALCULUS_LABEL = label('Warnell Calculus Requirement');
const PUBLIC_HEALTH_SPEECH_LABEL = label('Public Health Speech Requirement');
const PUBLIC_HEALTH_STATISTICS_LABEL = label('Public Health Statistics Requirement');

/** The area label without a second program's "Program name: " prefix. */
const ownLabel = (areaLabel: string) => {
  const cut = areaLabel.lastIndexOf(': ');
  return cut >= 0 ? areaLabel.slice(cut + 2) : areaLabel;
};

/** Whether an area is one of this module's rules that courses counted elsewhere meet (not the language sequence). */
export function ugaRuleArea(areaLabel: string): boolean {
  return RULE_LABELS.has(ownLabel(areaLabel));
}

/** Whether an area is the Area II laboratory science rule. */
export function ugaLabArea(areaLabel: string): boolean {
  return ownLabel(areaLabel) === LAB_SCIENCE_LABEL;
}

/** Whether an area is the foreign language requirement this module adds (planned as a sequence). */
export function ugaLanguageArea(areaLabel: string): boolean {
  return ownLabel(areaLabel) === FOREIGN_LANGUAGE_LABEL;
}

/**
 * ugaAreaFamily for the areas here: each rule is a family of its own, so
 * one course can meet the environmental awareness rule and a core area and
 * a major area at once, as UGA lets it; Franklin's breadth requirements are
 * one family, since a course meets one of them only ("can satisfy only one
 * Franklin College requirement, with the exception of some courses
 * approved for the Multicultural requirement"), and Multicultural one of
 * its own. Any other area as ugaAreaFamily reads it.
 */
export function ugaRuleFamily(areaLabel: string): string {
  const own = ownLabel(areaLabel);
  const program = areaLabel.length > own.length ? areaLabel.slice(0, areaLabel.length - own.length - 2) : '';
  if (Object.values(FRANKLIN_LABELS).includes(own)) return `${program}|${FRANKLIN_FAMILY}`;
  if (RULE_LABELS.has(own) || own === FOREIGN_LANGUAGE_LABEL) return `${areaLabel}|own`;
  return ugaAreaFamily(areaLabel);
}

/** A rule's courses: the list's own and its subject ranges read against the catalog, the page's exclusions out. */
function listCourses(list: UgaRuleList, catalog: ReadonlyMap<string, CatalogCourse>, threeHour = true): RuleRow[] {
  const excluded = new Set(list.excluded ?? []);
  const out = new Map<string, RuleRow>();
  const add = (course: CatalogCourse | undefined) => {
    if (!course || excluded.has(course.code) || out.has(course.code)) return;
    if (threeHour && course.credits < 3) return;
    out.set(course.code, { code: course.code, title: course.title, credits: course.credits });
  };
  for (const code of list.codes) add(catalog.get(code));
  for (const range of list.ranges ?? []) {
    for (const course of catalog.values()) {
      if (!course.code.startsWith(`${range.subject} `)) continue;
      const number = numberOf(course.code);
      if (number >= range.from && number <= range.to) add(course);
    }
  }
  return [...out.values()];
}

const codesCourses = (codes: string[], catalog: ReadonlyMap<string, CatalogCourse>): RuleRow[] =>
  codes.map((code) => catalog.get(code)).filter((course): course is CatalogCourse => course !== undefined).map((course) => ({ code: course.code, title: course.title, credits: course.credits }));

const oneCourse = (areaLabel: string, groupLabel: string, note: string, courses: RuleRow[], choose = 1): RuleArea => ({
  label: areaLabel,
  hours: choose * 3,
  groups: [{ label: groupLabel, choose, note, courses }],
});

/** The cultural diversity list a college's students choose from. */
function culturalDiversityCourses(college: string, catalog: ReadonlyMap<string, CatalogCourse>): RuleRow[] | null {
  const own = UGA_CULTURAL_DIVERSITY[college];
  if (!own) return null;
  // "will permit the Cultural Diversity requirement to be satisfied by any course that appears on this list or on any of the lists of approved courses maintained by other colleges" (Terry, Veterinary Medicine).
  const codes = college === 'BUS' || college === 'VET' ? Object.values(UGA_CULTURAL_DIVERSITY).flat() : [...own];
  const ranges = college === 'SSW' ? [{ subject: 'AFAM', from: 1000, to: 5999 }] : []; // "Any African American Studies Course"
  return listCourses({ codes, ranges }, catalog, false);
}

/** The lab courses of a degree's two Area II lists (and its 4-hour sciences, whose lab is part of the course). */
function labCourses(program: ProgramRecord, catalog: ReadonlyMap<string, CatalogCourse>): RuleRow[] {
  type Area = { label: string; groups: Array<{ courses: Array<{ code: string }> }> };
  const listed = new Set((program.areas as Area[]).filter((area) => /^II\./.test(area.label.trim())).flatMap((area) => area.groups.flatMap((group) => group.courses.map((row) => norm(row.code)))));
  const out: RuleRow[] = [];
  for (const code of listed) {
    const course = catalog.get(code);
    if (!course) continue;
    const lab = /^[A-Z]{2,5} \d{4}L$/.test(code) && listed.has(code.slice(0, -1));
    if (lab || course.credits >= 4) out.push({ code: course.code, title: course.title, credits: course.credits });
  }
  return out;
}

const mathCourses = (codes: string[], catalog: ReadonlyMap<string, CatalogCourse>) => codesCourses(codes, catalog);
const PRECALCULUS = ['MATH 1113', 'MATH 1113E', 'MATH 2110', 'MATH 2200', 'MATH 2250', 'MATH 2250E', 'MATH 2260', 'MATH 2270', 'MATH 2300H', 'MATH 2310H', 'MATH 2400', 'MATH 2410', 'MATH 2500', 'MATH 3000'];
const COLLEGE_PAGE = (id: string, college: string) => `bulletin.uga.edu/Program/Details/${id}?IDc=${college}#college-requirements`;

/** The college-wide areas the program pages print, by college (Terry's are uga-program-overrides.ts TERRY_GRADUATION). */
function collegeAreas(program: ProgramRecord, catalog: ReadonlyMap<string, CatalogCourse>): RuleArea[] {
  const franklin = franklinDegree(program);
  const out: RuleArea[] = [];
  if (franklin === 'all') {
    const note = `Franklin College: one course meets one Franklin requirement, at least 3 hours, numbered 1000-5999 (${FRANKLIN_PAGE}).`;
    // Narrow lists first, as the audit spends a course on the first Franklin row that lists it: ANTH 2045 is Biological and Social Sciences both.
    out.push(
      oneCourse(FRANKLIN_LABELS.biological, 'One biological science course', note, listCourses(FRANKLIN_BIOLOGICAL_SCIENCES, catalog)),
      oneCourse(FRANKLIN_LABELS.physical, 'One physical science course', `${note} Any ASTR, CHEM, GEOL or PHYS course, or one from the college's list.`, listCourses(FRANKLIN_PHYSICAL_SCIENCES, catalog)),
      oneCourse(FRANKLIN_LABELS.literature, 'One literature course', `${note} Any 2000-level ENGL course or one from the college's list.`, listCourses(FRANKLIN_LITERATURE, catalog)),
      oneCourse(FRANKLIN_LABELS.fineArts, 'Two fine arts, philosophy or religion courses', `${note} Any ARHI, ARTS, PHIL or RELI course (not PHIL 2500, 4510 or 4530) or one from the college's list.`, listCourses(FRANKLIN_FINE_ARTS, catalog), 2),
      oneCourse(FRANKLIN_LABELS.socialSciences, 'Two social science courses from two departments', `${note} Two courses from two different departments, not HIST: any ANTH, ECON, POLS, PSYC or SOCI course, or one from the college's list.`, listCourses(FRANKLIN_SOCIAL_SCIENCES, catalog), 2),
      oneCourse(FRANKLIN_LABELS.history, 'One history course', `${note} Any 3-hour HIST course; the US/Georgia history exam does not count.`, listCourses(FRANKLIN_HISTORY, catalog)),
    );
  }
  if (franklin) out.push(oneCourse(MULTICULTURAL_LABEL, 'One multicultural course', `A course with a significant focus on African American, Asian American, Hispanic American or Native American cultures (${FRANKLIN_PAGE}/multicultural). It may also meet another Franklin requirement.`, listCourses(FRANKLIN_MULTICULTURAL, catalog)));
  if (program.college === 'SPIA') {
    const page = COLLEGE_PAGE('46524', 'SPIA');
    out.push(
      oneCourse(SPIA_LITERATURE_LABEL, 'One literature course', `School of Public and International Affairs college-wide requirement (${page}).`, listCourses(SPIA_LITERATURE, catalog, false)),
      oneCourse(SPIA_FINE_ARTS_PHILOSOPHY_AND_RELIGION_LABEL, 'Two fine arts, philosophy or religion courses', `Any 3-hour MUSI, ARTS, ARHI, FILM, THEA, PHIL or RELI course, or one from the list (${page}).`, listCourses(SPIA_FINE_ARTS, catalog), 2),
      oneCourse(SPIA_ECONOMICS_LABEL, 'ECON 2105 or ECON 2106', `(${page})`, codesCourses(['ECON 2105', 'ECON 2106'], catalog)),
      oneCourse(SPIA_STATISTICS_OR_MATHEMATICS_LABEL, 'A statistics or mathematics course', `Any 1000- or 2000-level STAT course, MATH 1060, or a course from MATH 2200 to MATH 2400 (${page}).`, [
        ...[...catalog.values()].filter((course) => /^STAT [12]\d{3}[A-Z]?$/.test(course.code)).map((course) => ({ code: course.code, title: course.title, credits: course.credits })),
        ...[...catalog.values()].filter((course) => course.code === 'MATH 1060' || (/^MATH \d{4}[A-Z]?$/.test(course.code) && numberOf(course.code) >= 2200 && numberOf(course.code) <= 2400)).map((course) => ({ code: course.code, title: course.title, credits: course.credits })),
      ]),
    );
  }
  if (program.college === 'ECOL') {
    // The page names no number of courses for these three; one course each is the reading that asks for nothing it does not print.
    const note = `Odum School of Ecology college-wide requirement (${COLLEGE_PAGE('86043', 'ECOL')}); core courses may meet it.`;
    out.push(
      oneCourse(ODUM_SCHOOL_FINE_ARTS_PHILOSOPHY_AND_RELIGION_LABEL, 'A fine arts, philosophy or religion course', note, listCourses(ODUM_FINE_ARTS, catalog)),
      oneCourse(ODUM_SCHOOL_LITERATURE_LABEL, 'A literature course', note, listCourses(ODUM_LITERATURE, catalog)),
      oneCourse(ODUM_SCHOOL_SOCIAL_SCIENCES_LABEL, 'A social science course', `${note} Any HIST course but HIST 2111 and 2112, or any ANTH, ECON, POLS, PSYC or SOCI course.`, listCourses(ODUM_SOCIAL_SCIENCES, catalog)),
    );
  }
  if (program.college === 'CAES') {
    const note = `College of Agricultural and Environmental Sciences college-wide requirement (${COLLEGE_PAGE('33716', 'CAES')}).`;
    out.push(
      oneCourse(CAES_PRE_CALCULUS_LABEL, 'MATH 1113 or a higher course that has it as a prerequisite', note, mathCourses(PRECALCULUS, catalog)),
      oneCourse(CAES_CHEMISTRY_OR_CALCULUS_LABEL, 'CHEM 1211 or 1411 (with its lab), or MATH 2200 or 2250', note, codesCourses(['CHEM 1211', 'CHEM 1411', 'MATH 2200', 'MATH 2250'], catalog)),
      oneCourse(CAES_BIOLOGY_OR_BOTANY_LABEL, 'BIOL 1103, BIOL 1107 or PBIO 1210 (with its lab)', note, codesCourses(['BIOL 1103', 'BIOL 1103E', 'BIOL 1107', 'BIOL 1107E', 'PBIO 1210'], catalog)),
      oneCourse(CAES_SPEECH_LABEL, 'AGCM 2200, COMM 1110 or COMM 2150H', `${note} Applied Biotechnology may take BTEC 3000.`, codesCourses(['AGCM 2200', 'COMM 1110', 'COMM 2150H', ...(program.id === '47637' ? ['BTEC 3000'] : [])], catalog)),
    );
  }
  if (program.college === 'FRS') {
    const note = `Warnell School of Forestry and Natural Resources college-wide requirement (${COLLEGE_PAGE('61717', 'FRS')}).`;
    const statistics = oneCourse(WARNELL_STATISTICS_LABEL, 'STAT 2000, BIOS 2010, BUSN 3000 or FANR 2010', note, codesCourses(['STAT 2000', 'BIOS 2010', 'BUSN 3000', 'BUSN 3000E', 'BUSN 3000H', 'FANR 2010'], catalog));
    if (program.id === '99141') {
      // Parks, Recreation, and Tourism Management: its own list, MATH 1101 or higher and no calculus.
      out.push(
        oneCourse(WARNELL_MATHEMATICS_LABEL, 'MATH 1101 or a higher MATH course', note, mathCourses(['MATH 1101', 'MATH 1113', 'MATH 1113E', 'MATH 2200', 'MATH 2250', 'MATH 2250E'], catalog)),
        oneCourse(WARNELL_BIOLOGY_I_LABEL, 'BIOL 1103 or BIOL 1107 (with its lab)', note, codesCourses(['BIOL 1103', 'BIOL 1103H', 'BIOL 1107', 'BIOL 1107E', 'BIOL 2107H'], catalog)),
        oneCourse(WARNELL_BIOLOGY_II_LABEL, 'BIOL 1104 or BIOL 1108 (with its lab)', note, codesCourses(['BIOL 1104', 'BIOL 1108', 'BIOL 2108H'], catalog)),
        oneCourse(WARNELL_CHEMISTRY_LABEL, 'CHEM 1110, 1210, 1211 or 1411', note, codesCourses(['CHEM 1110', 'CHEM 1210', 'CHEM 1210E', 'CHEM 1211', 'CHEM 1311H', 'CHEM 1411'], catalog)),
        statistics,
      );
    } else {
      out.push(
        oneCourse(WARNELL_PRE_CALCULUS_LABEL, 'MATH 1113 or a higher MATH course', note, mathCourses(PRECALCULUS, catalog)),
        // The Pre-Vet Wildlife Sciences emphasis of Fisheries and Wildlife asks for no calculus.
        oneCourse(WARNELL_CALCULUS_LABEL, 'MATH 2200, 2250 or 2300H', `${note} Not asked of the Pre-Vet Wildlife Sciences emphasis.`, mathCourses(['MATH 2200', 'MATH 2250', 'MATH 2250E', 'MATH 2300H'], catalog)),
        oneCourse(WARNELL_CHEMISTRY_LABEL, 'CHEM 1211, 1311H or 1411 (with its lab)', note, codesCourses(['CHEM 1211', 'CHEM 1311H', 'CHEM 1411'], catalog)),
        oneCourse(WARNELL_BIOLOGY_I_LABEL, 'BIOL 1107 (with its lab)', note, codesCourses(['BIOL 1107', 'BIOL 1107E', 'BIOL 2107H'], catalog)),
        oneCourse(WARNELL_BIOLOGY_II_LABEL, 'BIOL 1108 (with its lab)', note, codesCourses(['BIOL 1108', 'BIOL 2108H'], catalog)),
        statistics,
      );
    }
  }
  if (program.college === 'PBHL') {
    const note = `College of Public Health college-wide requirement (${COLLEGE_PAGE('33197', 'PBHL')}).`;
    out.push(
      oneCourse(PUBLIC_HEALTH_SPEECH_LABEL, 'COMM 1110', note, codesCourses(['COMM 1110'], catalog)),
      oneCourse(PUBLIC_HEALTH_STATISTICS_LABEL, 'BIOS 2010 or STAT 2000', note, codesCourses(['BIOS 2010', 'STAT 2000'], catalog)),
    );
  }
  return out;
}

/** The language area: met by the course of the level asked for (or a higher one) in any one language. */
function languageArea(level: number, catalog: ReadonlyMap<string, CatalogCourse>): RuleArea {
  const codes = UGA_LANGUAGE_ROWS.flatMap(([, levels]) => levels.slice(level - 1));
  return {
    label: FOREIGN_LANGUAGE_LABEL,
    hours: 3,
    groups: [{
      label: `A foreign language through the ${LEVEL_NAMES[level - 1]}`,
      choose: 1,
      note: `Courses in one language in order, from 1001 through the ${LEVEL_NAMES[level - 1]}, starting at the level the placement test (or credit already earned) puts you in. American Sign Language counts for this requirement but not for Area IV.`,
      courses: codesCourses(codes, catalog),
    }],
  };
}

const isBachelor = (program: ProgramRecord) => program.degree === 'AB' || /^B[A-Z]+$/.test(program.degree ?? '');

/**
 * Each bachelor's degree with the university-wide rules (cultural
 * diversity from its college's list, environmental awareness, a lab
 * science in Area II), its college's rules and the foreign language its
 * college or page asks for, as areas after the page's own. They ask for no
 * hours of their own: the degree's total is unchanged. `catalog` gives
 * the subject-wide lines their courses and each row the course's hours.
 */
export function applyUgaUniversityRules<T extends ProgramRecord>(programs: T[], catalog: ReadonlyArray<CatalogCourse>): T[] {
  const byCode = new Map(catalog.map((course) => [norm(course.code), course]));
  const environmental = codesCourses([...UGA_ENVIRONMENTAL_AWARENESS], byCode);
  const diversity = new Map<string, RuleRow[] | null>();
  return programs.map((program) => {
    if (!isBachelor(program)) return program;
    const college = program.college ?? '';
    if (!diversity.has(college)) diversity.set(college, culturalDiversityCourses(college, byCode));
    const rows = diversity.get(college) ?? null;
    const level = languageLevelOf(program);
    const added: RuleArea[] = [
      ...(level > 0 ? [languageArea(level, byCode)] : []),
      ...collegeAreas(program, byCode),
      ...(rows ? [oneCourse(CULTURAL_DIVERSITY_LABEL, 'One cultural diversity course', `UGA's Cultural Diversity Requirement, from your college's approved list (${UNIVERSITY_PAGE}).`, rows)] : []),
      oneCourse(ENVIRONMENTAL_LABEL, 'One environmental awareness course', `UGA's Environmental Awareness Requirement, one course from the approved list for students entering fall 2020 or later (${UNIVERSITY_PAGE}).`, environmental),
      { label: LAB_SCIENCE_LABEL, hours: 1, groups: [{ label: 'One Area II science with its lab', choose: 1, note: 'Area II is 7-8 hours, and at least one of its two sciences must have a laboratory (Bulletin, General Education Core Curriculum).', courses: labCourses(program, byCode) }] },
    ];
    const own = new Set((program.areas as Array<{ label: string }>).map((area) => area.label));
    const areas = [...program.areas, ...added.filter((area) => !own.has(area.label) && area.groups.every((group) => group.courses.length > 0))];
    return { ...program, areas };
  });
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/*
 * A rule's choices for the planner: the courses that are lower-division
 * (1000-2999) and not honors, which a rule books where nothing on the
 * board meets it, and the ones another row of the degree names or the
 * student holds, which it counts. The audit reads the whole list (the degree's areas);
 * five Franklin lists of a thousand courses each made every choice row's
 * sort read each of them (2026-10-29).
 */
function plannable(requirement: PlanRequirement, named: Set<string>, held: Set<string>): PlanRequirement {
  if (requirement.rule.kind !== 'choose') return requirement;
  // An honors course only where the student holds it: Warnell's calculus took MATH 2300H Honors Calculus.
  const choices = requirement.rule.choices.filter((choice) => choice.codes.some((code) => {
    const c = norm(code);
    if (held.has(c) || held.has(baseCode(c))) return true;
    return !/\d{4}H$/.test(c) && (numberOf(c) < 3000 || named.has(c));
  }));
  if (choices.length === requirement.rule.choices.length || choices.length < requirement.rule.n) return requirement;
  return { ...requirement, rule: { ...requirement.rule, choices } };
}

/*
 * One hour of basic physical education, PEDB 1010-1990, for a first
 * bachelor's degree, outside the 120 ("This total does not include the
 * 1-hour P.E. requirement", every program page; "physical education
 * courses designated PEDB 1010-1990 shall not be counted in the hours
 * required", Undergraduate Graduation Requirements). No board booked it
 * (0 of 47 review boards, 2026-10-29). PEDB 1010, Adapted Physical
 * Education, needs the Disability Resource Center's referral; Army ROTC's
 * MILS 3010 and 3020 meet the requirement.
 */
function physicalEducation(input: AutoplanInput): PlanRequirement | null {
  const held = input.prior.courseCodes.map(norm);
  if (held.some((code) => /^PEDB /.test(code)) || (held.includes('MILS 3010') && held.includes('MILS 3020'))) return null;
  const choices: PlanCourseChoice[] = input.context.courses
    .filter((course) => /^PEDB 1\d{3}$/.test(course.code) && course.code !== 'PEDB 1010')
    .map((course) => ({ codes: [course.code], credits: course.credits, substitutes: [] }));
  if (choices.length === 0) return null;
  return {
    id: 'uga::physical-education',
    areaId: 'uga::physical-education',
    areaLabel: 'Physical Education',
    label: 'Physical Education (one hour, outside the 120)',
    hours: null,
    rule: { kind: 'choose', n: 1, choices },
    note: 'UGA requires one hour of basic physical education (PEDB 1010-1990) for a first bachelor\'s degree. It does not count toward the 120 hours; any PEDB course meets it.',
    url: UNIVERSITY_PAGE,
  };
}

/**
 * The degree's rows as the UGA planner reads them: the rules' rows cut to
 * the courses they could book or count (plannable), and the one hour of
 * physical education (physicalEducation) for a bachelor's degree, which
 * these rules mark.
 */
export function withUgaUniversityRows(requirements: PlanRequirement[], input: AutoplanInput): PlanRequirement[] {
  if (input.context.schoolId !== 'uga' || !requirements.some((r) => ugaRuleArea(r.areaLabel))) return requirements;
  const named = new Set(requirements.filter((r) => !ugaRuleArea(r.areaLabel) && (r.rule.kind === 'all' || r.rule.kind === 'choose' || r.rule.kind === 'pool')).flatMap((r) => ('choices' in r.rule ? r.rule.choices.flatMap((choice) => choice.codes.map(norm)) : [])));
  const held = new Set(input.prior.courseCodes.flatMap((code) => [norm(code), baseCode(code)]));
  const rows = requirements.map((r) => (ugaRuleArea(r.areaLabel) ? plannable(r, named, held) : r));
  const pe = physicalEducation(input);
  return pe ? [...rows, pe] : rows;
}

/** The lecture of a lab (BIOL 1103 for BIOL 1103L), or null: the Area II rule takes the lab whose lecture the board has. */
export function ugaLabOf(code: string): string | null {
  return /^[A-Z]{2,5} \d{4}L$/.test(code) ? code.slice(0, -1) : null;
}

/*
 * UGA's laboratories with their lectures (BIOL 1103L with BIOL 1103), for
 * the placer to keep in one term (PlanningContext.trackLabs): the
 * catalog gives a lab no prerequisite, so nothing held ECOL 1000L to ECOL
 * 1000, and the Area II lab rule's lab sat two years before its lecture
 * (2026-10-29).
 */
export function ugaLabPairs(catalog: ReadonlyArray<{ code: string; title: string }>): Map<string, string> {
  const codes = new Set(catalog.map((course) => norm(course.code)));
  const out = new Map<string, string>();
  for (const course of catalog) {
    const code = norm(course.code);
    const lecture = ugaLabOf(code);
    if (lecture && codes.has(lecture) && /\blab(?:oratory)?\b/i.test(course.title)) out.set(code, lecture);
  }
  return out;
}

const levelsRead = new WeakMap<LanguageTable, Map<string, { name: string; level: number }>>();
/** Each language's levels (0 is the first semester) by course, accelerated courses at the last level they cover. */
function levelsByCode(table: LanguageTable): Map<string, { name: string; level: number }> {
  const known = levelsRead.get(table);
  if (known) return known;
  const out = new Map<string, { name: string; level: number }>();
  levelsRead.set(table, out);
  for (const language of table.languages) language.levels.forEach((options, level) => { for (const option of options) for (const code of option) out.set(code, { name: language.name, level }); });
  for (const [code, top] of Object.entries(ACCELERATED)) {
    const subject = code.split(' ')[0];
    const language = table.languages.find((l) => l.levels.some((options) => options.some((option) => option.some((c) => c.startsWith(`${subject} `)))));
    if (language) out.set(code, { name: language.name, level: top - 1 });
  }
  return out;
}

/** Whether a course is one of a language's sequence courses (SPAN 1001, ARAB 2003), for the core lists' picks. */
export function ugaLanguageCourse(table: LanguageTable | undefined, code: string): boolean {
  if (!table) return false;
  const level = levelsByCode(table).get(baseCode(code));
  return level !== undefined;
}

const LANGUAGE_WORDS: Array<[RegExp, string]> = [
  [/\bspanish\b/i, 'Spanish'], [/\bfrench\b/i, 'French'], [/\bgerman\b/i, 'German'], [/\bitalian\b/i, 'Italian'],
  [/\bportuguese\b/i, 'Portuguese'], [/\b(?:mandarin|chinese)\b/i, 'Chinese'], [/\bjapanese\b/i, 'Japanese'], [/\bkorean\b/i, 'Korean'],
  [/\barabic\b/i, 'Arabic'], [/\brussian\b/i, 'Russian'], [/\bvietnamese\b/i, 'Vietnamese'], [/\byoruba\b/i, 'Yoruba'],
  [/\blatin\b(?! america)/i, 'Latin'], [/\b(?:ancient |classical )?greek\b/i, 'Greek'], [/\bhebrew\b/i, 'Hebrew'],
  [/\b(?:asl|sign language)\b/i, 'American Sign Language'], [/\bhindi\b/i, 'Hindi'], [/\burdu\b/i, 'Urdu'], [/\bbengali\b/i, 'Bengali'],
  [/\b(?:persian|farsi)\b/i, 'Persian'], [/\bturkish\b/i, 'Turkish'], [/\bindonesian\b/i, 'Indonesian'], [/\bpashto\b/i, 'Pashto'],
  [/\bswahili\b/i, 'Swahili'], [/\bhausa\b/i, 'Hausa'], [/\bamharic\b/i, 'Amharic'], [/\bzulu\b/i, 'Zulu'], [/\bquechua\b/i, 'Quechua'],
];

/**
 * The language requirement as courses, for UGA (autoplan.ts
 * expandLanguageRequirement is Illinois's). UGA counts no high school
 * years: a placement test (or credit already earned) decides where a
 * student starts, so the semesters behind the student are the level the
 * student said they start at (PriorCredit.languageSemesters, from setup)
 * or the highest one they hold, and a student who has not said starts at
 * 1001, told to take the test. The rest is planned in one language, in
 * order: 1001, 1002, the third semester and on to the level the degree
 * asks for, the row first among the degree's, so the core's World
 * Languages list and a page's own language row count its courses rather
 * than booking others. Three first semesters of three languages, and no
 * second semester of any, was an Elementary Education board's World
 * Languages core (2026-10-28).
 *
 * Which language: the one the student named; else one they hold; else the
 * one the degree's own rows are in (French for a French AB); else one
 * their words name; else Spanish, the one most UGA students take, marked
 * so a tap on any of its cards changes the language of the whole sequence.
 */
export function expandUgaLanguage(input: AutoplanInput): { requirements: PlanRequirement[]; language: LanguagePlan | null; satisfied: { requirementId: string; label: string; codes: string[] } | null; notes: string[]; exempt: string[] } {
  const rows = input.requirements.filter((r) => ugaLanguageArea(r.areaLabel) && r.rule.kind === 'choose');
  const table = input.context.languages;
  if (rows.length === 0 || !table || table.languages.length === 0) return { requirements: input.requirements, language: null, satisfied: null, notes: [], exempt: [] };
  const rule = rows.reduce((best, r) => (ugaLanguageLevelOf(r.label) > ugaLanguageLevelOf(best.label) ? r : best), rows[0]);
  const semesters = ugaLanguageLevelOf(rule.label);
  const rest = input.requirements.filter((r) => !rows.includes(r));
  const levels = levelsByCode(table);
  const held = new Map<string, number>();
  for (const code of [...input.prior.courseCodes, ...input.prior.exemptCodes]) {
    const at = levels.get(baseCode(code)) ?? levels.get(norm(code));
    if (at) held.set(at.name, Math.max(held.get(at.name) ?? 0, at.level + 1));
  }
  const notes: string[] = [];
  const said = input.prior.languageSemesters;
  const placed = said === undefined || said === null ? null : Math.max(0, said);
  let chosen: LanguageTable['languages'][number] | undefined;
  let from: LanguagePlan['from'] = placed !== null && placed > 0 ? 'high school' : 'none';
  let why = '';
  const byName = (name: string) => table.languages.find((l) => l.name === name);
  const named = (input.prior.languageName ?? '').trim();
  if (named) {
    chosen = table.languages.find((l) => l.name.toLowerCase() === named.toLowerCase()) ?? byName(LANGUAGE_WORDS.find(([re]) => re.test(named))?.[1] ?? '');
    if (chosen) why = `You said ${chosen.name}.`;
  }
  if (!chosen) {
    const top = [...held].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      chosen = byName(top[0]);
      from = 'college';
      if (chosen) why = `You already hold ${top[1]} semester${top[1] === 1 ? '' : 's'} of ${chosen.name}.`;
    }
  }
  if (!chosen) {
    // The degree's own language: the one its other rows name most, in rows of one language only (FREN for a French AB, GREK where a Classics emphasis books GREK 1001; a row of every language, "any foreign language at the 2000-level", names none), so the board holds one language.
    const count = new Map<string, number>();
    const languageOf = (code: string) => {
      const subject = norm(code).split(' ')[0];
      return table.languages.find((l) => l.levels.some((options) => options.some((option) => option.some((c) => c.startsWith(`${subject} `)))))?.name;
    };
    for (const r of rest) {
      if (!('choices' in r.rule) || ugaRuleArea(r.areaLabel) || r.rule.choices.length > 40) continue;
      const names = r.rule.choices.flatMap((choice) => choice.codes.map(languageOf)).filter((name): name is string => Boolean(name));
      if (new Set(names).size !== 1) continue;
      count.set(names[0], (count.get(names[0]) ?? 0) + names.length);
    }
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      chosen = byName(top[0]);
      if (chosen) why = `Your degree's own courses are in ${chosen.name}.`;
    }
  }
  if (!chosen) {
    const hit = LANGUAGE_WORDS.find(([re]) => re.test(input.interests ?? ''));
    chosen = hit ? byName(hit[1]) : undefined;
    if (chosen) why = `You mentioned ${chosen.name}.`;
  }
  if (!chosen) {
    chosen = byName('Spanish') ?? table.languages[0];
    why = `No language was given, so ${chosen.name} is planned, the language most UGA students take. Tap any language card to choose another; the rest of the sequence follows.`;
  }
  const completed = Math.min(semesters, Math.max(placed ?? 0, held.get(chosen.name) ?? 0));
  if (placed === null && completed === 0) {
    notes.push(`Language: the plan starts ${chosen.name} at the first semester (${chosen.levels[0]?.[0]?.[0] ?? ''}) because no starting level was given. If you studied a language before, take UGA's placement test: you may start higher and need fewer courses. Set your language and where you start under Credit.`);
  }
  if (completed >= semesters) {
    const codes = chosen.levels.flat().flat().filter((code) => input.prior.courseCodes.some((c) => baseCode(c) === code));
    return {
      requirements: rest,
      language: null,
      satisfied: { requirementId: rule.id, label: `Foreign language: met (${completed} semester${completed === 1 ? '' : 's'}${named || held.has(chosen.name) ? ` of ${chosen.name}` : ''})`, codes },
      notes: [...notes, codes.length > 0
        ? `The foreign language requirement is met by the ${chosen.name} you already hold. No language courses are planned.`
        : `The foreign language requirement is met at the level you said you place past (semester ${completed}${named ? ` of ${chosen.name}` : ''}). No language courses are planned; your placement or proficiency result must be on your UGA record.`],
      exempt: [],
    };
  }
  const chain: string[] = [];
  const choices: PlanCourseChoice[] = [];
  for (let level = completed; level < semesters; level += 1) {
    const code = chosen.levels[level]?.[0]?.[0];
    if (!code) break;
    choices.push({ codes: [code], credits: null, substitutes: [] });
    chain.push(code);
  }
  if (completed > 0 && placed !== null && placed >= completed) {
    notes.push(`Language: ${semesters - completed} more semester${semesters - completed === 1 ? '' : 's'} of ${chosen.name} ${semesters - completed === 1 ? 'is' : 'are'} planned from where you said you start (${chain[0]}). UGA places you by its placement test; if it puts you elsewhere, change the starting level under Credit.`);
  }
  const expanded: PlanRequirement = {
    ...rule,
    label: `Foreign language through the ${LEVEL_NAMES[semesters - 1]}`,
    rule: { kind: 'all', choices },
  };
  // The levels behind the student clear the chain's prerequisites without earning hours (SPAN 2001 needs SPAN 1002).
  const exempt = chosen.levels.slice(0, completed).flat().flat();
  return {
    requirements: [expanded, ...rest],
    language: { name: chosen.name, semesters, completed, from, codes: chain, why },
    satisfied: null,
    notes,
    exempt,
  };
}

const UPPER_DIVISION_HOURS = 39;

/** Upper-division hours (3000-5999) a UGA bachelor's degree still needs among `codes`, of the 39 the Degree Hour Requirements set. */
export function ugaUpperDivisionShort(codes: Iterable<string>, creditsOf: (code: string) => number): number {
  let hours = 0;
  const seen = new Set<string>();
  for (const raw of codes) {
    const code = baseCode(raw);
    if (seen.has(code)) continue;
    seen.add(code);
    const number = numberOf(code);
    if (number >= 3000 && number <= 5999) hours += creditsOf(raw);
  }
  return Math.max(0, UPPER_DIVISION_HOURS - hours);
}


// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * The lines the board's audit adds for these rules (uga-board-audit.ts):
 * physical education when no PEDB course is on the board or record, the 39
 * upper-division hours of a bachelor's degree (Degree Hour Requirements:
 * "at least 39 semester hours of upper division work overall"), Franklin's
 * two social sciences from two departments, CAES's six hours of
 * internship, Grady's preferred 48 hours in the college, and 45 of the
 * last 60 hours at UGA (Resident Requirement), which a transfer's last
 * terms can miss.
 */
export function ugaUniversityIssues(input: {
  areaLabels: string[];
  boardCodes: string[];
  priorCodes: string[];
  creditsOf: (code: string) => number;
  /** Hours the record holds with no UGA course behind them (transfer and exam credit), counted before the board's terms. */
  transferHours: number;
  /** Hours of the record's UGA courses. */
  residentHeldHours: number;
  /** The board's planned hours, all at UGA. */
  plannedHours: number;
  college?: string;
}): PlanIssue[] {
  const own = input.areaLabels.map(ownLabel);
  if (!own.includes(ENVIRONMENTAL_LABEL)) return [];
  const issues: PlanIssue[] = [];
  const all = [...input.priorCodes, ...input.boardCodes].map(norm);
  if (!all.some((code) => /^PEDB /.test(code)) && !(all.includes('MILS 3010') && all.includes('MILS 3020'))) {
    issues.push({ id: 'uga-rule-pe', severity: 'warning', termId: '', title: 'Physical education', message: 'UGA requires one hour of basic physical education (any PEDB 1010-1990 course) for a bachelor\'s degree, outside the 120 hours. None is on this plan or your record.' });
  }
  const short = ugaUpperDivisionShort(all, input.creditsOf);
  if (short > 0) {
    const have = UPPER_DIVISION_HOURS - short;
    issues.push({ id: 'uga-rule-upper-division', severity: 'warning', termId: '', title: 'Upper-division hours', message: `UGA's bachelor's degrees need at least 39 hours of upper-division work (courses numbered 3000-5999). This plan has ${have}. Make ${short} more ${short === 1 ? 'hour' : 'hours'} of electives 3000-level or above.` });
  }
  if (own.includes(FRANKLIN_LABELS.socialSciences)) {
    const subjects = new Set(all.filter((code) => /^(?:ANTH|ECON|POLS|PSYC|SOCI|GEOG|AFAM|AFST|CLAS|LACS|WMST) /.test(code)).map((code) => code.split(' ')[0]));
    if (subjects.size === 1) issues.push({ id: 'uga-rule-franklin-departments', severity: 'warning', termId: '', title: 'Franklin social sciences', message: `Franklin College asks for two social science courses from two different departments; every one on this plan is ${[...subjects][0]}. Make one of them a course in another department (ANTH, ECON, POLS, PSYC or SOCI, or one on the college's list).` });
  }
  // Grady: "preferring 72 hours outside the college and no more than 48 hours in the college", a preference, so information (bulletin.uga.edu/Program/Details/84144?IDc=JOUR#college-requirements).
  if (input.college === 'JOUR') {
    const grady = all.filter((code) => /^(?:ADPR|EMST|JOUR|JRLC|JRMC|NMIX) /.test(code)).reduce((sum, code) => sum + input.creditsOf(code), 0);
    if (grady > 48) issues.push({ id: 'uga-rule-grady-hours', severity: 'info', termId: '', title: 'Hours in Grady College', message: `Grady College prefers no more than 48 of a degree's hours in the college (ADPR, EMST, JOUR, JRLC, JRMC and NMIX courses); this plan has ${grady}.` });
  }
  if (input.college === 'CAES') {
    const internship = all.filter((code) => /^(?:AAEC|ENVM|ADSC|AESC|AGCM|ALDR|BTEC|CRSS|ENTO|FDST|HORT|PATH|POUL) 39[1-3]0$|^BIOL 4940$|^[A-Z]{4} 4261$/.test(code)).reduce((sum, code) => sum + input.creditsOf(code), 0);
    if (internship > 6) issues.push({ id: 'uga-rule-caes-internship', severity: 'warning', termId: '', title: 'Internship hours', message: `The College of Agricultural and Environmental Sciences counts no more than 6 hours of internship toward graduation; this plan has ${internship}.` });
  }
  /*
   * The last 60 hours in the order they are earned: the board's terms last,
   * the record's UGA courses before them, its transfer hours before those
   * (a record's own order is not read, so this can only miss a case, never
   * invent one).
   */
  const total = input.transferHours + input.residentHeldHours + input.plannedHours;
  const residentInLast = Math.min(60, input.plannedHours + Math.min(input.residentHeldHours, Math.max(0, 60 - input.plannedHours)));
  if (total >= 60 && residentInLast < 45) {
    issues.push({ id: 'uga-rule-residence', severity: 'warning', termId: '', title: '45 of the last 60 hours at UGA', message: `UGA asks for at least 45 of a degree's last 60 hours to be taken at UGA (or on a UGA-approved program). On this plan ${Math.round(residentInLast)} of the last 60 are. Ask an advisor before taking more credit elsewhere.` });
  }
  return issues;
}

/** The level a degree's language row asks for, read from its label ("through the third semester"; 3 when unsure). */
export function ugaLanguageLevelOf(groupLabel: string): number {
  return Math.max(3, LEVEL_NAMES.findIndex((name) => groupLabel.includes(`through the ${name}`)) + 1);
}

/**
 * Whether a placement the student reported (setup's language level,
 * PriorCredit.languageSemesters) meets a degree's language area: the
 * audit counts courses, and a student placed past the level asks for none.
 */
export function ugaLanguagePlaced(area: { label: string; groups: Array<{ label: string }> }, languagePlaced: number | null | undefined): boolean {
  if (!languagePlaced || !ugaLanguageArea(area.label)) return false;
  return languagePlaced >= ugaLanguageLevelOf(area.groups[0]?.label ?? '');
}
