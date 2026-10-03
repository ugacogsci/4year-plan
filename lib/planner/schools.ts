/** Canonical school identity and supported features, shared by client and server. */
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
    name: 'University of Illinois Urbana-Champaign',
    short: 'Illinois',
    bot: 'ALMA',
    people: 'Illini',
    accent: '#FF5F05',
    portal: 'Student Self-Service',
    colleges: 'LAS, Grainger, Gies',
    town: 'Urbana-Champaign',
    feeders: 'Parkland College, Harper, College of DuPage',
    dropTerm: 'withdrawal',
    catalog: '/illinois/index.json',
    examCredit: '/illinois-exam-credit.json',
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


export type SupportedSchoolId = 'illinois' | 'uga';

export function isSupportedSchool(id: unknown): id is SupportedSchoolId {
  return id === 'illinois' || id === 'uga';
}

/** Capabilities describe data and policy actually shipped for this school. */
export interface SchoolCapabilities {
  graduatePrograms: boolean;
  minorsAndCertificates: boolean;
  languagePolicy: boolean;
  admissionRoutes: boolean;
  transferGenEdGuide: boolean;
  syllabi: boolean;
  teachingRatings: boolean;
}

export const SCHOOL_CAPABILITIES: Record<SupportedSchoolId, SchoolCapabilities> = {
  illinois: { graduatePrograms: false, minorsAndCertificates: false, languagePolicy: true, admissionRoutes: true, transferGenEdGuide: true, syllabi: true, teachingRatings: true },
  uga: { graduatePrograms: true, minorsAndCertificates: true, languagePolicy: false, admissionRoutes: false, transferGenEdGuide: false, syllabi: false, teachingRatings: false },
};
