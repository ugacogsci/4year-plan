/**
 * Which engine plans a school, and what a CourseLeaf school switches on.
 *
 * ORION has two planning engines. UGA has its own (uga-*.ts, the UGA audit).
 * Illinois and Georgia Tech share the "CourseLeaf engine": the Illinois
 * adapters in illinois-data.ts, the loader in illinois-load.ts and the
 * plan-build worker, because both catalogs are CourseLeaf sites with the same
 * requirement tables. Names like `illinois-data.ts` and `useIllinoisCore`
 * mean "the CourseLeaf engine", not "Illinois only".
 *
 * What is really Illinois-only (its campus gen-ed table, the language
 * requirement, college rules like Grainger's, minors, graduate programs,
 * clubs, syllabi, ratings, the career matcher's course vectors) is switched
 * per school here, so a Georgia Tech board never inherits an Illinois rule.
 *
 * This module imports nothing, so every layer (scripts, the worker, React,
 * API routes) can use it without cycles.
 */

export type SchoolKey = 'uga' | 'illinois' | 'gatech';
export type CourseleafId = 'illinois' | 'gatech';
export type Engine = 'uga' | 'courseleaf';

export interface CourseleafSchool {
  id: CourseleafId;
  /** Where build-index writes the slim artifacts the browser loads, e.g. '/gatech'. */
  base: string;
  /** Prefix of the raw crawl files in public/, e.g. 'gatech' for public/gatech-catalog.json. */
  rawPrefix: string;
  /** Digits in a course number: Illinois 'CS 225' has 3, Georgia Tech 'CS 1331' has 4. */
  numberDigits: 3 | 4;
  /** Numbers may end in a letter (Georgia Tech 'CHEM 1211K'). */
  letterSuffix: boolean;
  /** Lowest course number that is graduate level (Illinois 500, Georgia Tech 6000). */
  graduateFrom: number;

  // What this school's data supports. Off means the feature is hidden, never faked.
  campusGenEd: boolean;
  languageRule: boolean;
  collegeRules: boolean;
  momentumReview: boolean;
  minors: boolean;
  graduate: boolean;
  clubs: boolean;
  syllabi: boolean;
  ratings: boolean;
  careerVectors: boolean;
  careerTracks: boolean;
  transferAi: boolean;
  transferGenEdGuide: boolean;

  /** Hours that must be taken at the school, overall and upper level; null when not modelled. */
  residency: { hours: number; upperLevel: number } | null;
  /** The degree total to assume when a program page does not state one; null to use the page's own. */
  defaultDegreeTotal: number | null;
  /** Recognises the school's own name on a transcript. */
  home: RegExp;
  /** The campus time zone, for "today" and registration dates. */
  timeZone: string;
}

const COURSELEAF: Record<CourseleafId, CourseleafSchool> = {
  illinois: {
    id: 'illinois',
    base: '/illinois',
    rawPrefix: 'illinois',
    numberDigits: 3,
    letterSuffix: false,
    graduateFrom: 500,
    campusGenEd: true,
    languageRule: true,
    collegeRules: true,
    momentumReview: true,
    minors: true,
    graduate: true,
    clubs: true,
    syllabi: true,
    ratings: true,
    careerVectors: true,
    careerTracks: true,
    transferAi: true,
    transferGenEdGuide: true,
    residency: { hours: 45, upperLevel: 21 },
    defaultDegreeTotal: 120,
    home: /university of illinois|\buiuc\b|urbana[- ]champaign/i,
    timeZone: 'America/Chicago',
  },
  gatech: {
    id: 'gatech',
    base: '/gatech',
    rawPrefix: 'gatech',
    numberDigits: 4,
    letterSuffix: true,
    graduateFrom: 6000,
    campusGenEd: false,
    languageRule: false,
    collegeRules: false,
    momentumReview: false,
    minors: false,
    graduate: false,
    clubs: false,
    syllabi: false,
    ratings: false,
    careerVectors: true,
    careerTracks: false,
    transferAi: false,
    transferGenEdGuide: false,
    residency: null,
    defaultDegreeTotal: null,
    home: /georgia (institute of )?tech|\bgatech\b/i,
    timeZone: 'America/New_York',
  },
};

export function engineOf(id: string | null | undefined): Engine | null {
  if (id === 'uga') return 'uga';
  if (id === 'illinois' || id === 'gatech') return 'courseleaf';
  return null;
}

export function courseleafOf(id: string | null | undefined): CourseleafSchool | null {
  return id === 'illinois' || id === 'gatech' ? COURSELEAF[id] : null;
}

export function isCourseleaf(id: string | null | undefined): id is CourseleafId {
  return id === 'illinois' || id === 'gatech';
}
