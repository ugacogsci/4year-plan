/**
 * The career goals students actually type, and what each one means for a plan.
 *
 * interestWordsFrom in quality.ts keeps words of five letters or more that
 * are not stopwords. That is right for "biology" or "accounting" and wrong for
 * almost every way a student names a goal:
 *
 *   "I want to go to PT school after"   -> nothing (pt is two letters, school a stopword)
 *   "pre-law, maybe politics"           -> politics (pre and law are three letters)
 *   "AI" / "UX" / "a data job"          -> nothing
 *   "data science"                      -> nothing (science is a stopword)
 *   "machine learning"                  -> machine, which is the first word of
 *                                          ABE 361 Agricultural Machine Systems and
 *                                          ETMA 262 Agricultural Machine Systems Mgmt
 *
 * And nothing in the planner knew that a pre-med student needs CHEM 232, or
 * that law schools require no course at all. This file is that knowledge:
 *
 *   CAREER_TRACKS    pre-professional goals (medicine, dental, PA, PT, OT, vet,
 *                    pharmacy, optometry, law) with the Illinois courses the
 *                    Illinois advising office lists for each, and the page it
 *                    is listed on.
 *   INTEREST_TOPICS  career and interest phrases (AI, UX, finance, climate ...)
 *                    with title words that really occur in Illinois course
 *                    titles, the subject prefixes that are about the topic,
 *                    and a short list of the most relevant courses.
 *   interestProfile  what a sentence of the student's names, in those terms.
 *
 * Pure data and pure functions. Every course code here exists in
 * public/illinois/index.json and every title word hits at least one title
 * there (checked on 2026-09-24; the check script lives outside the repo).
 */

/** A page a list was taken from, and the day it was read. */
export interface TrackSource {
  url: string;
  title: string;
  read: string;
}

/**
 * How firmly the source asks for a course.
 *   required     the source's "Required" column
 *   recommended  its "Strongly Recommended" column
 *   suggested    named in the source's text, or chosen here for a skill the
 *                source names; never a requirement
 */
export type TrackNeed = 'required' | 'recommended' | 'suggested';

export interface TrackCourse {
  /** Illinois alternatives, the one the source prefers first. One slot, not a sequence. */
  codes: string[];
  need: TrackNeed;
  why: string;
}

export interface CareerTrack {
  id: string;
  name: string;
  /** Regex sources, matched case-insensitively against what the student wrote. */
  detect: string[];
  /**
   * Regex sources blanked out before `detect` runs, for phrases that contain a
   * detect word and mean something else: "animal doctor" is not medicine,
   * "physician assistant" is not a physician.
   */
  unless?: string[];
  courses: TrackCourse[];
  /** Title words for electives the source names beyond the course list (may be empty). */
  words: string[];
  /** INTEREST_TOPICS ids this track already covers: folded in, not announced twice. */
  related: string[];
  source: TrackSource;
  alsoSee?: TrackSource[];
  note: string;
}

export interface InterestTopic {
  id: string;
  /** What the student will read back: "AI/machine learning". */
  label: string;
  detect: string[];
  unless?: string[];
  /**
   * Lower-case title fragments, each matched the way quality.ts matches, as the
   * start of a word in a lower-cased course title (`\b${w}`). Some are phrases,
   * because the single word spills: "machine" alone is agricultural machinery.
   */
  words: string[];
  /** Subject prefixes that are about this topic as a whole, not merely near it. */
  subjects: string[];
  /** The few courses a student with this interest should see first. */
  courses: string[];
  note?: string;
  source?: TrackSource;
}

export interface InterestProfile {
  tracks: CareerTrack[];
  topics: InterestTopic[];
  words: string[];
  subjects: string[];
  courses: string[];
  heard: string[];
}

const READ = '2026-09-24';
const r = String.raw;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/*
 * The Career Center's Health Professions Advising publishes one preparation
 * guide per profession. The current editions sit on the Pre-Health SharePoint,
 * which asks for an Illinois login (careercenter.illinois.edu/healthprofessions/medicine
 * says so); the 2021-2022 editions below are the newest ones on the open web.
 * Each marks every course Required or Strongly Recommended, which is where
 * `need` comes from. The catalog's preprofessional pages add only that any
 * major can apply.
 */
const GUIDE_BASE = 'https://www.careercenter.illinois.edu/sites/default/files/2023-05/';
const guide = (file: string, name: string): TrackSource => ({
  url: GUIDE_BASE + file,
  title: `The Career Center, ${name} (2021-2022 edition), Pre-Requisite Information`,
  read: READ,
});
const catalogPage = (slug: string, name: string): TrackSource => ({
  url: `https://catalog.illinois.edu/undergraduate/preprofessional/${slug}/`,
  title: `${name} | 2026-2027 Course Catalog | University of Illinois Urbana-Champaign`,
  read: READ,
});

const HEALTH_NOTE =
  'Any major can apply. The lists are the Career Center\'s public 2021-2022 guide; the current guide is on the Pre-Health SharePoint (Illinois login), and every professional school sets its own requirements, so the student checks each school and meets with Health Professions Advising (pre-health@illinois.edu).';

// ---------------------------------------------------------------------------
// Course slots shared by the health guides
// ---------------------------------------------------------------------------

const c = (codes: string[], need: TrackNeed, why: string): TrackCourse => ({ codes, need, why });

/** MCB 150 and IB 150 with their labs: the guides' two-semester general biology. */
function generalBiology(need: TrackNeed, span = 'two semesters'): TrackCourse[] {
  return [
    c(['MCB 150'], need, `General biology (${span}), first half: molecular and cellular biology, with its lab MCB 151.`),
    c(['MCB 151'], need, 'The lab taken with MCB 150.'),
    c(['IB 150'], need, `General biology (${span}), second half: organismal and evolutionary biology, with its lab IB 151.`),
    c(['IB 151'], need, 'The lab taken with IB 150.'),
  ];
}

function generalChemistry(need: TrackNeed, span = 'two semesters'): TrackCourse[] {
  return [
    c(['CHEM 102'], need, `General chemistry (${span}), first half, with its lab CHEM 103.`),
    c(['CHEM 103'], need, 'The lab taken with CHEM 102.'),
    c(['CHEM 104'], need, `General chemistry (${span}), second half, with its lab CHEM 105.`),
    c(['CHEM 105'], need, 'The lab taken with CHEM 104.'),
  ];
}

function organicOne(need: TrackNeed): TrackCourse[] {
  return [
    c(['CHEM 232'], need, 'Organic chemistry I, with its lab CHEM 233.'),
    c(['CHEM 233'], need, 'The lab taken with CHEM 232.'),
  ];
}

const organicTwo = (need: TrackNeed) => c(['CHEM 332'], need, 'Organic chemistry II, after CHEM 232.');

const biochemistry = (need: TrackNeed) =>
  c(['MCB 354', 'MCB 450'], need, 'One semester of biochemistry; the guide accepts MCB 354 or MCB 450.');

/*
 * Every guide names PHYS 101 and 102, the algebra-based sequence. Engineering
 * and physical-science majors take PHYS 211 and 212 instead, which is why it
 * is listed second rather than left out: a student who already has 211 should
 * not be told to add 101.
 */
function physics(need: TrackNeed, span = 'two semesters'): TrackCourse[] {
  const alt = 'PHYS 211 (the calculus-based sequence engineering majors take) is listed second; it is usually accepted in its place, but confirm on each school\'s list.';
  return [
    c(['PHYS 101', 'PHYS 211'], need, `General physics (${span}), first half. ${alt}`),
    c(['PHYS 102', 'PHYS 212'], need, `General physics, second half. ${alt.replace('211', '212')}`),
  ];
}

const statistics = (need: TrackNeed) =>
  c(['STAT 100', 'STAT 200', 'STAT 212', 'PSYC 235'], need,
    'Statistics: the guide says "STAT 100 or equivalent". STAT 200, STAT 212 (Biostatistics) and PSYC 235 are the other Illinois introductory statistics courses; check that the target schools take them.');

const calculus = (need: TrackNeed) =>
  c(['MATH 220', 'MATH 221'], need, 'Calculus: the guide names MATH 220 (or equivalent); MATH 221 is the Calculus I for students who already had some calculus.');

const psychology = (need: TrackNeed) => c(['PSYC 100'], need, 'Introductory psychology.');
const sociology = (need: TrackNeed) => c(['SOC 100'], need, 'Introductory sociology.');

const composition = (need: TrackNeed) =>
  c(['RHET 105'], need,
    'Composition I. The guide asks for two semesters of communication, Composition I and Advanced Composition; RHET 105 is one way to meet Composition I (the CMN 111-112 sequence is another), and Advanced Composition is any course carrying that general education requirement.');

/** A&P as the medicine and dental guides list it: lecture courses, MCB or IB. */
function anatomyPhysiologyLecture(need: TrackNeed, extra = ''): TrackCourse[] {
  return [
    c(['MCB 244', 'IB 303'], need, `Anatomy and physiology, first half: MCB 244, or IB 303 (Anatomy).${extra}`),
    c(['MCB 246', 'IB 202'], need, `Anatomy and physiology, second half: MCB 246, or IB 202 (Physiology).${extra}`),
  ];
}

/** A&P with labs, as the PA, PT, OT and pharmacy guides list it. */
function anatomyPhysiologyWithLabs(need: TrackNeed): TrackCourse[] {
  return [
    c(['MCB 244'], need, 'Human anatomy and physiology I (two semesters with labs), with its lab MCB 245.'),
    c(['MCB 245'], need, 'The lab taken with MCB 244.'),
    c(['MCB 246'], need, 'Human anatomy and physiology II, with its lab MCB 247.'),
    c(['MCB 247'], need, 'The lab taken with MCB 246.'),
  ];
}

const genetics = (need: TrackNeed) => c(['MCB 250', 'IB 204'], need, 'Genetics: MCB 250 or IB 204.');

function microbiologyWithLab(need: TrackNeed, labNote = ''): TrackCourse[] {
  return [
    c(['MCB 100', 'MCB 300'], need, 'Microbiology (one semester): MCB 100, or MCB 300 for students further along in biology.'),
    c(['MCB 101', 'MCB 301'], need, `The microbiology lab: MCB 101 with MCB 100, MCB 301 with MCB 300.${labNote}`),
  ];
}

/*
 * The guides say "CLCV 102 or KIN 199". KIN is gone from the catalog; Health
 * and Kinesiology's medical terminology course is now HK 264, so that is the
 * second code rather than a code no search can find.
 */
const medicalTerminology = (need: TrackNeed) =>
  c(['CLCV 102', 'HK 264'], need,
    'Medical terminology: the guide names CLCV 102 or KIN 199; KIN 199 is no longer in the catalog, and HK 264 (Applied Medical Terminology for the Health Professional) is the course that now covers it.');

// ---------------------------------------------------------------------------
// Career tracks
// ---------------------------------------------------------------------------

/* "My mother in law is visiting": relatives, with or without the hyphens. */
const IN_LAWS = r`\b((mother|father|brother|sister|son|daughter|parent)s?[-\s])?in-laws?\b|\b(mother|father|brother|sister|son|daughter|parent)s?\s+in\s+laws?\b`;

/*
 * "PA or med school" and "PT/OT programs" name two goals and say "school"
 * once, after the second, so the short one never meets its noun. The patterns
 * that catch it need the second goal spelled out: "I work PT and school keeps
 * me busy" must stay part-time work.
 */
const OTHER_SCHOOL = r`(pa|pt|ot|med|medical|nursing|dental|pharmacy|pharm|vet|law|optometry|np|grad|graduate)`;

export const CAREER_TRACKS: CareerTrack[] = [
  {
    id: 'pre-medicine',
    name: 'Pre-medicine (MD/DO)',
    detect: [
      r`\bpre[-\s]?med(icine|ical)?\b`,
      r`\bmed(ical)?[-\s]?school\b`,
      r`\bmd\s*(\/|or|and|&)\s*do\b`,
      r`\bmd\s*\/\s*ph\.?d\b`,
      // "an MD", "my MD", "MD program": bare "md" is also Maryland, so only these.
      r`\b(an|my)\s+md\b`,
      r`\bmd\s+(program|programs|school|schools|degree)\b`,
      r`\bmcat\b`,
      r`\bdoctors?\b`,
      r`\bphysicians?\b`,
      r`\bmedicine\b`,
      r`\b(surgeon|neurosurgeon|pediatrician|cardiologist|dermatologist|psychiatrist|anesthesiologist|radiologist|oncologist|neurologist|internist|ob-?gyn)s?\b`,
    ],
    unless: [
      r`\b(animal|eye|tooth|teeth|plant|tree|dog|cat|pet|spin|vet|computer|script)\s+doctors?\b`,
      r`\bdoctors?\s+of\s+(physical|occupational|pharmacy|optometry|veterinary|dental|audiology|chiropractic|nursing|philosophy|education|psychology)\b`,
      r`\bdoctor'?s\s+(appointment|office|note|visit|orders?)\b`,
      r`\bphysicians?('s|s')?\s*(assistant|associate)s?\b`,
      r`\b(veterinary|vet|sports|animal|herbal|chinese|alternative)\s+medicine\b`,
      // "I'm taking medicine for my allergies" is a patient.
      r`\b(take|takes|taking|took|need|needs)\s+(my\s+|some\s+|the\s+|allergy\s+|cold\s+)?medicines?\b`,
    ],
    courses: [
      ...generalBiology('required'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      organicTwo('recommended'),
      biochemistry('required'),
      ...physics('required'),
      composition('required'),
      ...anatomyPhysiologyLecture('recommended'),
      genetics('recommended'),
      psychology('recommended'),
      sociology('recommended'),
    ],
    words: [],
    related: [],
    source: guide('Medicine%20Guide%202021-2022%20FINAL.pdf', 'Pre-Medicine Guide'),
    alsoSee: [
      { url: 'https://www.careercenter.illinois.edu/healthprofessions/medicine', title: 'Health Professions: Medicine | The Career Center | UIUC', read: READ },
      catalogPage('medicine', 'Medicine'),
    ],
    note: `${HEALTH_NOTE} The guide warns that medical schools read prerequisites three ways: specific courses, credit hours in a discipline, or competencies.`,
  },
  {
    id: 'pre-dental',
    name: 'Pre-dental (DDS/DMD)',
    detect: [
      r`\bpre[-\s]?dent(al|istry)?\b`,
      r`\bdent(al)?\s+school\b`,
      r`\bdentist(s|ry)?\b`,
      r`\borthodont(ist|ists|ics)\b`,
      r`\b(dds|dmd)\b`,
      r`\bdat\s+(exam|prep|score)\b`,
      r`\b(take|taking|study|studying)\s+(for\s+)?the\s+dat\b`,
      r`\btooth\s+doctor\b`,
    ],
    courses: [
      ...generalBiology('required'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      organicTwo('recommended'),
      biochemistry('required'),
      ...physics('required'),
      composition('required'),
      ...anatomyPhysiologyLecture('recommended', ' The guide notes MCB may be preferred.'),
      genetics('recommended'),
      c(['MCB 100', 'MCB 300'], 'recommended', 'Microbiology: MCB 100 or MCB 300.'),
      psychology('recommended'),
      sociology('recommended'),
      c(['STAT 100'], 'suggested', 'The guide says additional coursework may include statistics (and humanities).'),
    ],
    words: [],
    related: [],
    source: guide('Dental%20Guide%202021-2022%20FINAL.pdf', 'Pre-Dental Guide'),
    alsoSee: [catalogPage('dentistry', 'Dentistry')],
    note: `${HEALTH_NOTE} The guide says many dental schools have minimum requirements plus strongly recommended coursework needed to be competitive.`,
  },
  {
    id: 'pre-physician-assistant',
    name: 'Pre-physician assistant (PA)',
    detect: [
      r`\bpre[-\s]?pa\b`,
      r`\bpa\s+(school|schools|program|programs|student)\b`,
      // "PA or med school", "med school or PA": the shared noun sits on the other goal.
      r`\bpa\s*(\/|or|and|vs\.?)\s*${OTHER_SCHOOL}\s+(school|schools|program|programs)\b`,
      r`\b(school|schools|program|programs)\s*(\/|or|vs\.?)\s*pa\b`,
      r`\bphysicians?('s|s')?\s*(assistant|associate)s?\b`,
      r`\b(be|become|becoming)\s+an?\s+pa\b`,
      r`\bpa-c\b`,
      r`\b(pance|pa-cat)\b`,
    ],
    courses: [
      ...generalBiology('required'),
      ...anatomyPhysiologyWithLabs('required'),
      ...microbiologyWithLab('required'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      biochemistry('required'),
      statistics('required'),
      composition('required'),
      psychology('recommended'),
      sociology('recommended'),
      medicalTerminology('recommended'),
    ],
    words: [],
    related: [],
    source: guide('PA%20Guide%202021-2022%20FINAL.pdf', 'Pre-Physician Assistant Guide'),
    alsoSee: [catalogPage('physician-assistant', 'Physician Assistant')],
    note: `${HEALTH_NOTE} The guide adds that applicants do better after a gap year spent on patient-care experience.`,
  },
  {
    id: 'pre-physical-therapy',
    name: 'Pre-physical therapy (DPT)',
    detect: [
      r`\bpre[-\s]?pt\b`,
      r`\bpre[-\s]?physical\s+therapy\b`,
      r`\bpt\s+(school|schools|program|programs|student)\b`,
      r`\bpt\s*(\/|or|and|vs\.?)\s*${OTHER_SCHOOL}\s+(school|schools|program|programs)\b`,
      r`\b(school|schools|program|programs)\s*(\/|or|vs\.?)\s*pt\b`,
      r`\bphysical\s+therap(y|ist|ists)\b`,
      r`\bphysio(therapy|therapist|therapists)?\b`,
      r`\bd\.?p\.?t\b`,
      r`\b(be|become|becoming)\s+an?\s+pt\b`,
    ],
    courses: [
      ...generalBiology('required', 'one to two semesters; the guide\'s timeline takes IB 150 only if needed'),
      ...anatomyPhysiologyWithLabs('required'),
      ...generalChemistry('required', 'one to two semesters'),
      ...physics('required'),
      statistics('required'),
      psychology('required'),
      c(['PSYC 238'], 'required', 'The second psychology course the guide names (Psychopathology and Problems in Living).'),
      composition('required'),
      calculus('recommended'),
      sociology('recommended'),
      medicalTerminology('recommended'),
    ],
    // The guide: "Additional courses may be required or recommended, including
    // Kinesiology, Upper-Level Psychology, and science." These are the
    // kinesiology titles; the psychology ones come from the course list above.
    words: ['biomechanics', 'exercise', 'rehabilitation', 'musculoskeletal'],
    related: [],
    source: guide('PT%20Guide%202021-2022%20FINAL(1).pdf', 'Pre-Physical Therapy Guide'),
    alsoSee: [catalogPage('physical-therapy', 'Physical Therapy')],
    note: `${HEALTH_NOTE} The guide says programs may also want kinesiology, upper-level psychology and more science.`,
  },
  {
    id: 'pre-occupational-therapy',
    name: 'Pre-occupational therapy (OT)',
    detect: [
      r`\bpre[-\s]?ot\b`,
      r`\bpre[-\s]?occupational\b`,
      r`\bot\s+(school|schools|program|programs|student)\b`,
      r`\bot\s*(\/|or|and|vs\.?)\s*${OTHER_SCHOOL}\s+(school|schools|program|programs)\b`,
      r`\b(school|schools|program|programs)\s*(\/|or|vs\.?)\s*ot\b`,
      r`\boccupational\s+therap(y|ist|ists)\b`,
      r`\botd\b`,
      r`\b(be|become|becoming)\s+an?\s+ot\b`,
    ],
    courses: [
      ...anatomyPhysiologyWithLabs('required'),
      statistics('required'),
      psychology('required'),
      c(['PSYC 238'], 'required', 'The second psychology course the guide names (Psychopathology and Problems in Living).'),
      c(['HDFS 105'], 'required', 'Lifespan development: the guide names HDFS 105 (Intro to Human Development) or a psychology course.'),
      composition('required'),
      c(['MCB 150', 'IB 150'], 'recommended', 'One semester of general biology: MCB 150 or IB 150, each with its lab.'),
      c(['MCB 151', 'IB 151'], 'recommended', 'The lab for whichever general biology was taken.'),
      c(['CHEM 101', 'CHEM 102'], 'recommended', 'One semester of general chemistry: CHEM 101, or CHEM 102 with its lab CHEM 103.'),
      c(['CHEM 103'], 'recommended', 'The lab taken with CHEM 102; not needed after CHEM 101.'),
      sociology('recommended'),
      medicalTerminology('recommended'),
      c(['PHYS 101'], 'suggested', 'The guide\'s timeline adds PHYS 101 "if needed" by a target program.'),
    ],
    words: ['human development'],
    related: [],
    source: guide('OT%20Guide%202021-2022%20FINAL(1)%20(1).pdf', 'Pre-Occupational Therapy Guide'),
    alsoSee: [catalogPage('occupational-therapy', 'Occupational Therapy')],
    note: `${HEALTH_NOTE} The guide says programs may also want more behavioral science, math and science.`,
  },
  {
    id: 'pre-veterinary',
    name: 'Pre-veterinary medicine (DVM)',
    detect: [
      r`\bpre[-\s]?vet(erinary)?\b`,
      r`\bvet(erinary)?\s+(school|schools|med|medicine|program|programs|student|tech|technician)\b`,
      r`\bveterinar(y|ian|ians)\b`,
      r`\bdvm\b`,
      r`\b(be|become|becoming)\s+an?\s+vet\b`,
      r`\b(animal|zoo|equine|large[-\s]animal|small[-\s]animal)\s+(doctor|vet|medicine)s?\b`,
    ],
    courses: [
      ...generalBiology('required'),
      ...microbiologyWithLab('required', ' The guide says a lab may be required.'),
      c(['MCB 250', 'IB 204', 'ANSC 221'], 'required', 'Genetics (one semester): MCB 250 (with lab MCB 251), IB 204, or ANSC 221.'),
      c(['MCB 251'], 'required', 'The lab taken with MCB 250; the guide says a genetics lab may be required.'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      biochemistry('required'),
      ...physics('required', 'one to two semesters; Illinois\'s own DVM program asks for 8 hours with labs, which is both'),
      statistics('required'),
      composition('recommended'),
      c(['CMN 101'], 'suggested', 'Illinois\'s DVM admissions page lets one semester of speech replace the second semester of composition (Plan B).'),
    ],
    // The Illinois College of Veterinary Medicine encourages further work in
    // anatomy, physiology, microbiology, immunology, cell and molecular
    // biology and genetics, and lists nutrition among suggested electives.
    // "anatomy" alone is left out: it also opens ARCH 231 Anatomy of Buildings.
    words: ['physiology', 'microbiology', 'immunology', 'genetics', 'cell biology', 'nutrition'],
    related: [],
    source: guide('Vet%20Med%20Guide%202021-2022%20FINAL.pdf', 'Pre-Veterinary Medicine Guide'),
    alsoSee: [
      { url: 'https://vetmed.illinois.edu/prospective-students/admissions/prereqs/', title: 'PreReqs - Veterinary Medicine at Illinois', read: READ },
      catalogPage('vetmed', 'Veterinary Medicine'),
    ],
    note: `${HEALTH_NOTE} Illinois's own DVM program (Plan A, with a bachelor's degree) requires 8 semester hours of biological science with labs, 15 of chemistry including general, organic and biochemistry (at least 3 hours of chemistry lab), and 8 of physics with labs; pass/fail courses do not count, and biology older than 10 years is not considered from the 2026-27 cycle. The guide also recommends 2-4 courses across behavioral science, humanities and communication.`,
  },
  {
    id: 'pre-pharmacy',
    name: 'Pre-pharmacy (PharmD)',
    detect: [
      r`\bpre[-\s]?pharm(acy)?\b`,
      r`\bpharm(acy)?\s+school\b`,
      r`\bpharmac(y|ies|ist|ists)\b`,
      r`\bpharm\.?\s?d\b`,
      r`\bpcat\b`,
    ],
    courses: [
      ...generalBiology('required'),
      ...anatomyPhysiologyWithLabs('required'),
      c(['MCB 100', 'MCB 300'], 'required', 'Microbiology (one semester): MCB 100 or MCB 300.'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      organicTwo('required'),
      biochemistry('required'),
      ...physics('required', 'one to two semesters; the timeline takes PHYS 102 only if needed'),
      statistics('required'),
      calculus('required'),
      c(['PSYC 100', 'SOC 100'], 'required', 'Psychology or sociology, one to two semesters.'),
      c(['ECON 102'], 'required', 'Economics (one to two semesters): microeconomics.'),
      c(['ECON 103'], 'required', 'Economics, second semester if a school wants two: macroeconomics.'),
      composition('required'),
      c(['CMN 101'], 'required', 'Public speaking.'),
    ],
    words: [],
    related: [],
    source: guide('Pharmacy%20Guide%202021-2022%20FINAL.pdf', 'Pre-Pharmacy Guide'),
    alsoSee: [catalogPage('pharmacy', 'Pharmacy')],
    note: `${HEALTH_NOTE} The guide also requires 1-3 humanities courses (philosophy, history, English and the like); any course with that general education attribute counts, so none is named here.`,
  },
  {
    id: 'pre-optometry',
    name: 'Pre-optometry (OD)',
    detect: [
      r`\bpre[-\s]?opt(om|ometry)?\b`,
      r`\boptometr(y|ist|ists)\b`,
      r`\beye\s+doctors?\b`,
      r`\boat\s+(exam|prep|score)\b`,
    ],
    courses: [
      ...generalBiology('required', 'one to two semesters'),
      ...microbiologyWithLab('required', ' The guide says a lab may be required.'),
      c(['MCB 244', 'IB 303'], 'required', 'Anatomy and physiology (one to two semesters): MCB 244 with lab MCB 245, or IB 303.'),
      c(['MCB 245'], 'required', 'The lab taken with MCB 244.'),
      c(['MCB 246', 'IB 202'], 'required', 'Anatomy and physiology, second semester: MCB 246 with lab MCB 247, or IB 202.'),
      c(['MCB 247'], 'required', 'The lab taken with MCB 246.'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      biochemistry('required'),
      ...physics('required', 'one to two semesters'),
      statistics('required'),
      calculus('required'),
      psychology('required'),
      composition('required'),
    ],
    words: [],
    related: [],
    source: guide('Optometry%20Guide%202021-2022%20FINAL.pdf', 'Pre-Optometry Guide'),
    alsoSee: [catalogPage('optometry', 'Optometry')],
    note: `${HEALTH_NOTE} The guide also strongly recommends 1-2 more behavioral science courses and 1-3 humanities courses.`,
  },
  {
    id: 'pre-law',
    name: 'Pre-law (JD)',
    detect: [
      r`\bpre[-\s]?law\b`,
      r`\blaw\s+schools?\b`,
      r`\blawyers?\b`,
      r`\battorneys?\b`,
      r`\bjd\b`,
      r`\blsat\b`,
      r`\b(go|going|get|getting)\s+into\s+law\b`,
      r`\b(practice|practicing|study|studying|career\s+in|work\s+in)\s+law\b`,
      r`\b(prosecutor|public\s+defender|litigator)s?\b`,
      r`\blegal\s+career\b`,
      r`\b(corporate|immigration|criminal|environmental|patent|family|civil\s+rights|sports|entertainment|tax|international|constitutional|health|intellectual\s+property)\s+law(yer|yers)?\b`,
    ],
    unless: [IN_LAWS],
    courses: [
      c(['CMN 111'], 'suggested', 'Oral & Written Communication I. A PLAS Advisory Council member recommends CMN 111-112 for research, logical reasoning, writing and speaking.'),
      c(['CMN 112'], 'suggested', 'Oral & Written Communication II, the second half of that sequence.'),
      c(['PHIL 102', 'PHIL 103'], 'suggested', 'Logic and Reasoning, for the analytical and critical thinking PLAS names first; the LSAT tests logical reasoning. Chosen here for that skill, not named in the post.'),
      c(['PS 301'], 'suggested', 'The US Constitution I: named in the post as an introduction to cases met again in law school, with practice writing about them.'),
      c(['LAW 304'], 'suggested', 'Introduction to Legal Research, for the research and writing PLAS names.'),
      c(['LAW 301'], 'suggested', 'Introduction to Law, for the legal topics PLAS suggests exploring.'),
      c(['BADM 300'], 'suggested', 'The Legal Environment of Business: named in the post for corporate and business law.'),
      c(['PSYC 468'], 'suggested', 'Psychology and Law: named in the post.'),
      c(['SOC 275'], 'suggested', 'Criminology: named in the post for students drawn to criminal law.'),
      c(['RST 354'], 'suggested', 'Legal Aspects of Sport: named in the post for sports law.'),
    ],
    words: ['legal', 'argumentation', 'constitution'],
    related: ['law'],
    source: { url: 'https://prelaw.illinois.edu/about/becoming-pre-law/', title: 'Becoming Pre-Law – Pre-Law Advising Services | Illinois', read: READ },
    alsoSee: [
      { url: 'https://publish.illinois.edu/prelawadvising/2025/10/24/spring-2026-course-recommendations/', title: 'Spring 2026 Course Recommendations – Pre-Law Advising Services Blog', read: READ },
      catalogPage('prelaw', 'Law'),
    ],
    note:
      'Law schools require no specific courses or major. At Illinois pre-law is a designation, not a major (Pre-Law Advising Services, PLAS), and PLAS says "there are no required courses for law school". Every course here is a suggestion for the skills PLAS names (analytical and critical thinking, communication, research and writing) or a legal topic; none should be placed as a requirement. PS 323 Law and Representation, also named in the post, is not in the current course index. Illinois offers a Legal Studies minor; PLAS runs its information sessions.',
  },
];

// ---------------------------------------------------------------------------
// Interest topics
// ---------------------------------------------------------------------------

/*
 * Words are for courses outside `subjects`: a JOUR course already counts as
 * "in a subject you said you want", so a journalism word only earns its place
 * by finding journalism outside JOUR (AFRO 482 Immersion Journalism). That is
 * also why "reporting" is not a journalism word: outside JOUR the only title
 * it starts a word in is ACCY 410 Advanced Financial Reporting.
 */
export const INTEREST_TOPICS: InterestTopic[] = [
  {
    id: 'ai-ml',
    label: 'AI/machine learning',
    detect: [
      r`\bai\b`,
      r`\ba\.i\b`,
      r`\bartificial\s+intelligence\b`,
      r`\bmachine\s+learning\b`,
      r`\bml\b`,
      r`\bdeep\s+learning\b`,
      r`\bneural\s+net(work)?s?\b`,
      r`\bllms?\b`,
      r`\blarge\s+language\s+models?\b`,
      r`\bcomputer\s+vision\b`,
      r`\bnatural\s+language\s+processing\b`,
      r`\bnlp\b`,
      r`\bgen\s?ai\b`,
      r`\bgenerative\s+models?\b`,
      r`\breinforcement\s+learning\b`,
    ],
    words: ['artificial intelligence', 'machine learning', 'deep learning', 'computer vision', 'natural language', 'statistical learning', 'neural network'],
    subjects: ['CS'],
    courses: ['CS 440', 'CS 446', 'CS 441', 'CS 444', 'CS 447', 'ECE 448', 'ECE 449', 'STAT 432'],
  },
  {
    id: 'data-science',
    label: 'data science/analytics',
    detect: [
      r`\bdata\b`,
      r`\banalytics\b`,
      r`\bstatistic(s|al|ian|ians)\b`,
      r`\bbusiness\s+intelligence\b`,
    ],
    // A statistics requirement and a phone plan are not a data career: "I still
    // need statistics for my major", "my phone ran out of data".
    unless: [
      r`\bdata\s+structures?\b`,
      r`\b(out\s+of|phone|cell|mobile|cellular)\s+data\b`,
      r`\bdata\s+(plan|plans|cap|usage|entry)\b`,
      r`\b(need|needs|needed|take|takes|taking|took|require|requires|required|finish|finished|pass|passed|fail|failed|failing)\s+(a\s+|the\s+|my\s+|intro\s+|basic\s+)?(stats?|statistics)\b`,
    ],
    words: ['data science', 'data analytics', 'data analysis', 'analytics', 'statistical', 'data mining', 'data visualization', 'big data'],
    subjects: ['STAT'],
    courses: ['STAT 107', 'STAT 207', 'STAT 200', 'STAT 385', 'STAT 432', 'CS 412', 'CS 416', 'BADM 356'],
  },
  {
    id: 'ux-hci',
    label: 'UX/HCI design',
    detect: [
      r`\bux\b`,
      r`\bui\s+(design|designer|designers|development)\b`,
      r`\buser\s+(experience|interface|interfaces|research|researcher|centered)\b`,
      r`\bhci\b`,
      r`\bhuman[-\s]computer\s+interaction\b`,
      r`\binteraction\s+design(er|ers)?\b`,
      r`\busability\b`,
      r`\bhuman[-\s]centered\s+design\b`,
      r`\bdesign\s+thinking\b`,
      r`\bproduct\s+design(er|ers)?\b`,
    ],
    words: ['user experience', 'user interface', 'user research', 'ux', 'ui/ux', 'hci', 'interaction design', 'human-centered design', 'human-centered product', 'usable'],
    subjects: ['DTX'],
    courses: ['IS 226', 'IS 236', 'CS 465', 'IS 316', 'INFO 333', 'ARTD 218', 'DTX 310', 'BADM 371'],
  },
  {
    id: 'software-engineering',
    label: 'software engineering',
    detect: [
      r`\bsoftware\b`,
      r`\b(swe|sde)\b`,
      r`\b(web|app|mobile|full[-\s]?stack|back[-\s]?end|front[-\s]?end)\s+(developer|developers|development|dev|engineer|engineers|engineering)\b`,
      r`\bcod(ing|er|ers)\b`,
      r`\bprogramm(er|ers|ing)\b`,
      r`\bcomputer\s+science\b`,
      r`\bcs\b`,
    ],
    // "programming" alone also opens MATH 482 Linear Programming, MATH 484
    // Nonlinear Programming and RST 300 Leisure Programming, so it is kept only
    // in the phrases that are about writing code.
    words: ['software', 'programming for', 'programming methods', 'programming language', 'parallel programming', 'system programming', 'systems & programming', 'computer programming', 'algorithms', 'data structures', 'database', 'web programming', 'web development'],
    subjects: ['CS'],
    courses: ['CS 124', 'CS 128', 'CS 225', 'CS 222', 'CS 340', 'CS 427', 'CS 411', 'CS 409'],
  },
  {
    id: 'cybersecurity',
    label: 'cybersecurity',
    detect: [
      r`\bcyber\s*-?\s*security\b`,
      r`\bcyber\b`,
      r`\binfo\s*sec\b`,
      r`\b(information|computer|network|software|internet|cloud|application)\s+security\b`,
      r`\bsecurity\s+(analyst|analysts|engineer|engineers|engineering|research|researcher)\b`,
      r`\bethical\s+hack(ing|er|ers)?\b`,
      r`\bhack(ing|er|ers)\b`,
      r`\bpen(etration)?\s*-?\s*test(ing|er|ers)?\b`,
      r`\bcryptograph(y|ic|er|ers)\b`,
      r`\bmalware\b`,
    ],
    words: ['computer security', 'cybersecurity', 'information security', 'security laboratory', 'cryptography', 'privacy'],
    subjects: [],
    courses: ['CS 461', 'CS 463', 'CS 460', 'CS 407', 'IS 234', 'IS 334', 'BADM 370', 'CS 438'],
  },
  {
    id: 'game-design',
    label: 'game design',
    detect: [
      r`\bgame\s+(design|designer|designers|development|developer|developers|dev|studies|industry|art|artist|programming|programmer|studio|studios|writing|writer)\b`,
      r`\bvideo\s*-?\s*games?\b`,
      r`\bgamedev\b`,
      r`\bgaming\b`,
      r`\b(make|making|build|building|design|designing|create|creating)\s+(video\s+)?games\b`,
    ],
    // Playing is not making: "I like playing video games in my free time".
    unless: [r`\b(play|plays|playing|played)\s+([\w-]+\s+){0,2}(video\s*-?\s*games?|videogames?|games)\b`],
    words: ['game design', 'game development', 'game studies', 'video game', 'videogame', 'games', 'gaming', 'computer graphics'],
    subjects: ['GSD'],
    courses: ['GSD 101', 'GSD 103', 'GSD 102', 'GSD 405', 'GSD 409', 'CS 415', 'CS 418'],
  },
  {
    id: 'robotics',
    label: 'robotics',
    detect: [
      r`\brobot(s|ic|ics)?\b`,
      r`\bmechatronics?\b`,
      r`\bautonomous\s+(vehicles?|systems?|driving|cars?|robots?)\b`,
      r`\bself[-\s]driving\b`,
      r`\bdrones?\b`,
      r`\bcontrols?\s+engineer(ing)?\b`,
    ],
    words: ['robot', 'mechatronics', 'autonomous', 'autonomy'],
    subjects: [],
    courses: ['ECE 470', 'ME 445', 'AE 482', 'CS 452', 'ECE 484', 'SE 423', 'AE 483', 'ECE 486'],
  },
  // Added after the scenario runs: a Computer Engineering student who said
  // "hardware and embedded systems" got graphics, networks and security as
  // technical electives, because no topic named the hardware side.
  {
    id: 'hardware',
    label: 'computer hardware/embedded systems',
    // "My laptop hardware broke" is a repair, not a goal.
    unless: [
      r`\b(my|a|the)\s+(laptop|computer|pc|phone|tablet|mac)('s)?\s+hardware\b`,
      r`\bhardware\s+(store|stores|issues?|problems?|broke|broken|failure|failed)\b`,
    ],
    detect: [
      r`\b(computer\s+)?hardware\b`,
      r`\bembedded(\s+systems?)?\b`,
      r`\bvlsi\b`,
      r`\bchip\s+design\b`,
      r`\b(computer|processor)\s+architecture\b`,
      r`\bfpgas?\b`,
      r`\bdigital\s+(design|logic|systems?)\b`,
      r`\bmicrocontrollers?\b`,
    ],
    words: ['embedded', 'vlsi', 'computer organization', 'computer architecture', 'digital systems'],
    subjects: [],
    courses: ['ECE 411', 'CS 431', 'ECE 425', 'ECE 427', 'ECE 385', 'ECE 420', 'CS 233'],
  },
  {
    id: 'speech-language-pathology',
    label: 'speech-language pathology/audiology',
    detect: [
      r`\bspeech(-|\s+)(language\s+)?patholog(y|ist|ists)\b`,
      r`\bspeech\s+therap(y|ist|ists)\b`,
      r`\baudiolog(y|ist|ists)\b`,
      r`\bslp\b`,
    ],
    words: ['speech', 'hearing', 'phonetics', 'language disorders'],
    subjects: ['SHS'],
    courses: ['SHS 150', 'SHS 200', 'SHS 301', 'SHS 431'],
  },
  {
    id: 'athletic-training',
    label: 'athletic training/sports medicine',
    detect: [
      r`\bathletic\s+train(er|ers|ing)\b`,
      r`\bsports?\s+medicine\b`,
      r`\bstrength\s+(and|&)\s+conditioning\b`,
    ],
    words: ['sports medicine', 'biomechanics', 'strength & conditioning'],
    subjects: [],
    courses: ['HK 152', 'HK 353', 'HK 454', 'HK 458'],
  },
  {
    id: 'finance',
    label: 'finance/investment banking',
    detect: [
      r`\bfinance\b`,
      r`\bfinancial\s+(analyst|analysts|analysis|advisor|advisors|adviser|planning|planner|services|markets?|modeling|engineering)\b`,
      r`\binvestments?\b`,
      r`\binvest(ing|or|ors)\b`,
      r`\bi-?bank(ing|er|ers)\b`,
      r`\bprivate\s+equity\b`,
      r`\bhedge\s+funds?\b`,
      r`\bwall\s+street\b`,
      r`\b(asset|wealth)\s+management\b`,
      r`\btrad(ing|er|ers)\b`,
      r`\bquant(s|itative\s+finance)?\b`,
      r`\bstock\s+market\b`,
      r`\bventure\s+capital\b`,
      r`\breal\s+estate\b`,
      r`\bfintech\b`,
    ],
    // "Can I trade my class for a later section" is a swap, not the markets.
    unless: [r`\btrad(e|es|ed|ing)\s+(my\s+|a\s+|this\s+|that\s+|the\s+)?(class|classes|course|courses|section|sections|seat|seats|spot|spots|shift|shifts|cards?)\b`],
    words: ['finance', 'financial', 'investment', 'banking', 'derivative', 'real estate', 'private equity'],
    subjects: ['FIN'],
    courses: ['FIN 221', 'FIN 300', 'FIN 321', 'FIN 411', 'FIN 418', 'FIN 463', 'FIN 391', 'ACCY 201'],
  },
  {
    id: 'accounting',
    label: 'accounting/CPA',
    detect: [
      r`\baccount(ing|ant|ants|ancy)\b`,
      r`\bcpa\b`,
      // Bare "audit" is the planner's own word: "my degree audit", "can I audit
      // a class". Only the accounting senses count.
      r`\baudit(ing|or|ors)\b`,
      r`\b(go|going|work|working|career|job|jobs|internship|intern)\s+(in|into)\s+audit\b`,
      r`\baudit\s*(and|or|&|\/)\s*(tax|advisory|assurance)\b`,
      r`\b(tax|advisory|assurance)\s*(and|or|&|\/)\s*audit\b`,
      r`\baudit\s+(intern|interns|internship|internships|associate|associates|firm|firms|career|practice)\b`,
      r`\b(external|internal|public|financial)\s+audit\b`,
      r`\btaxation\b`,
      r`\btax\s+(accounting|accountant|accountants|advisor|adviser|preparation|preparer|law|policy|season)\b`,
      r`\bbig\s*(4|four)\b`,
    ],
    words: ['accounting', 'accountancy', 'auditing', 'taxation', 'tax'],
    subjects: ['ACCY'],
    courses: ['ACCY 201', 'ACCY 202', 'ACCY 301', 'ACCY 302', 'ACCY 303', 'ACCY 312', 'ACCY 405', 'ACCY 415'],
  },
  {
    id: 'marketing',
    label: 'marketing/advertising',
    detect: [
      r`\bmarketing\b`,
      r`\badvertis(ing|ement|ements|er|ers)\b`,
      r`\bbrand(ing|s)\b`,
      r`\bbrand\s+(management|manager|strategy|marketing)\b`,
      r`\bsocial\s+media\b`,
      r`\bpublic\s+relations\b`,
      r`\bmarket\s+research\b`,
      r`\bsales\b`,
      r`\bconsumer\s+(behavior|insights?|research)\b`,
    ],
    // "I spend way too much time on social media" is a habit.
    unless: [
      r`\b(time|hours)\s+([\w-]+\s+)?on\s+social\s+media\b`,
      r`\b(scroll|scrolling|doomscrolling|addicted\s+to|addiction\s+to|get\s+off|got\s+off)\s+social\s+media\b`,
    ],
    words: ['marketing', 'advertising', 'brand', 'consumer behavior', 'sales', 'social media', 'public relations'],
    subjects: ['ADV'],
    courses: ['BADM 320', 'BADM 322', 'BADM 325', 'BADM 360', 'BADM 361', 'BADM 330', 'ADV 150', 'ADV 310'],
  },
  {
    id: 'consulting',
    label: 'consulting',
    detect: [
      r`\bconsult(ing|ant|ants|ancy)\b`,
      r`\bmbb\b`,
      r`\b(mckinsey|bcg|deloitte|accenture)\b`,
    ],
    // "I was consulting my advisor" is asking for advice, not a career.
    unless: [r`\bconsult(ing|ed|s)?\s+(with\s+)?(my|your|our|the|an?)\s+([\w-]+\s+)?(advisors?|advisers?|counsell?ors?|doctors?|professors?|deans?|parents?|tas?|tutors?|mentors?)\b`],
    words: ['consulting', 'strategic management', 'business analytics'],
    subjects: [],
    courses: ['BADM 445', 'BADM 449', 'BADM 341', 'BADM 210', 'BADM 211', 'IS 380'],
  },
  {
    id: 'supply-chain',
    label: 'supply chain/operations',
    detect: [
      r`\bsupply\s*-?\s*chains?\b`,
      r`\blogistics\b`,
      r`\boperations\s+(management|manager|managers|research|analyst|analysts)\b`,
      r`\bprocurement\b`,
    ],
    // "logistics" is left to the course list: as a title word it also opens
    // BIOE 489, a course on machine learning in medicine.
    words: ['supply chain', 'operations management', 'operations research', 'operations and supply'],
    subjects: [],
    courses: ['BADM 275', 'BADM 335', 'BADM 336', 'BADM 338', 'BADM 378', 'BADM 375', 'IE 310'],
  },
  {
    id: 'entrepreneurship',
    label: 'entrepreneurship/startups',
    detect: [
      r`\bentrepreneur(s|ship|ial)?\b`,
      r`\bstart[-\s]?ups?\b`,
      r`\bstart\s+(a|my\s+own|our\s+own|an)\s+(business|company|brand|firm)\b`,
      r`\bown\s+(business|company)\b`,
      r`\bfounders?\b`,
      r`\bfound(ing)?\s+a\s+(company|startup)\b`,
      r`\bventure\s+capital\b`,
      r`\bsmall\s+business\b`,
    ],
    words: ['entrepreneur', 'startup', 'venture', 'small business'],
    subjects: ['TE'],
    courses: ['BADM 346', 'BADM 446', 'TE 100', 'TE 250', 'TE 450', 'FIN 423', 'BADM 447'],
  },
  {
    id: 'sports-business',
    label: 'sports management/business',
    detect: [
      r`\bsports?\s+(management|manager|managers|business|marketing|industry|agent|agents|agency|analytics|admin|administration|media|broadcasting|law|analyst|analysts|franchise|team|teams|organization|organizations)\b`,
      r`\bathletics?\s+(director|directors|department|departments|administration|administrator)\b`,
      r`\bfront\s+office\b`,
      r`\bwork(ing)?\s+(in|for)\s+(an?\s+|the\s+)?(pro(fessional)?\s+)?sports?\b`,
      r`\b(nba|nfl|mlb|nhl|mls|wnba|ncaa|espn)\b`,
      r`\besports\b`,
    ],
    // RST (Recreation, Sport, and Tourism) is where sport management lives at
    // Illinois, so the subject carries most of it. "sport" alone would also
    // open HK 355 Injuries in Sport and HK 242 Sport Psychology, which are
    // kinesiology, so the words are the business titles outside and inside RST.
    words: ['sport mgt', 'sport brand', 'sport analytics', 'front office', 'esports', 'sports media', 'sports advertising', 'sports public relations', 'intercollegiate athletics'],
    subjects: ['RST'],
    courses: ['RST 130', 'RST 238', 'RST 301', 'RST 325', 'RST 354', 'RST 407', 'RST 240', 'ADV 214'],
  },
  {
    id: 'public-health',
    label: 'public health',
    detect: [
      r`\bpublic\s+health\b`,
      r`\bepidemiolog(y|ist|ists|ical)\b`,
      r`\bglobal\s+health\b`,
      r`\bcommunity\s+health\b`,
      r`\bhealth\s+(policy|administration|equity|promotion|education|educator|management|informatics|disparities)\b`,
      r`\bmph\b`,
      r`\bhealth\s*care\s+(administration|management|policy|consulting)\b`,
      r`\bhospital\s+administrat(ion|or|ors)\b`,
      r`\bbiostatistic(s|ian|ians)\b`,
    ],
    words: ['public health', 'epidemiology', 'global health', 'community health', 'health policy', 'health care', 'biostatistics'],
    // HK (Health and Kinesiology) holds most public health courses but also
    // bowling and team sport activities, so it is not a public health subject.
    subjects: [],
    courses: ['HK 111', 'HK 207', 'HK 206', 'HK 305', 'HK 410', 'HK 209', 'GLBL 240', 'STAT 212'],
  },
  {
    id: 'clinical-psychology',
    label: 'psychology/counseling/therapy',
    // Not bare "psychology" or "psych": that is the name of a major and of
    // half a dozen careers. A Psychology student who wrote "HR, industrial
    // organizational psychology" was booked PSYC 238 Psychopathology and PSYC
    // 379 Clinical Lab as "named for the goal you gave". "Psychologist" alone
    // stays, since most students who say it mean a clinician, and the
    // research and workplace kinds are blanked out below.
    detect: [
      r`\btherap(y|ist|ists)\b`,
      r`\bpsychotherap(y|ist|ists)\b`,
      r`\bcounsel(ing|ling|or|ors|lor|lors)\b`,
      r`\bmental\s+health\b`,
      // "clinical/community psychology" is how the Psychology concentration names it.
      r`\b(clinical|counseling|counselling|school|child|abnormal)([-\s/]+(and\s+|&\s*)?(community|counseling|counselling|clinical))?\s+psych(ology|ologist|ologists)?\b`,
      r`\bpsychologists?\b`,
      r`\bpsy\.?\s?d\b`,
      r`\bpsychiatr(y|ist|ists|ic)\b`,
      r`\bsocial\s+work(er|ers)?\b`,
      r`\blcsw\b`,
      r`\bmarriage\s+and\s+family\b`,
    ],
    // "Physical therapist" is PT, "gene therapy" is biotech and a camp
    // counselor is a summer job; each has its own home or none.
    unless: [
      r`\b(physical|occupational|speech|respiratory|radiation|gene|massage|recreational|recreation|drug|hormone|cell|infusion|light)\s+therap(y|ist|ists)\b`,
      r`\btherapy\s+(dogs?|animals?|horses?)\b`,
      r`\b(camp|financial|legal)\s+counsel(ing|ling|or|ors|lor|lors)\b`,
      // The planner's own counselors: "my academic counselor told me to take
      // CHEM 102". A school or career counselor is a counseling career, so
      // those two stay.
      r`\b(academic|admissions?|transfer|orientation|financial\s+aid|study\s+abroad|residence|resident)\s+counsel(ing|ling|or|ors|lor|lors)\b`,
      r`\bcounsel(ing|ling)\s+(center|centre|services)\b`,
      // "An industrial-organizational psychologist", "a cognitive
      // psychologist": psychology that is not therapy.
      r`\b(industrial|organi[sz]ational|i\s*[-/]\s*o|io|cognitive|developmental|social|experimental|research|quantitative|engineering|consumer|sports?|evolutionary|comparative)([-\s/]+(and\s+|&\s*)?(industrial|organi[sz]ational|cognitive|developmental|social))?[-\s/]+psych(ology|ologist|ologists)?\b`,
    ],
    words: ['psychopathology', 'psychotherapy', 'counseling', 'mental health', 'clinical/abnormal', 'clin/comm', 'community psych', 'personality'],
    subjects: ['PSYC', 'SOCW'],
    courses: ['PSYC 100', 'PSYC 238', 'PSYC 324', 'PSYC 336', 'PSYC 379', 'PSYC 420', 'PSYC 365', 'SOCW 200'],
  },
  // Added for the Psychology student who wants HR, industrial-organizational
  // psychology: no topic named the workplace side, so the clinical one took
  // the words. Illinois teaches it in PSYC (245 Industrial Org Psych, 455
  // Organizational Psych, 475 Personnel Psych), in LER, the School of Labor
  // and Employment Relations (182 Introduction to Human Resource, 228 Human
  // Resources Career Development, 358 HR Leadership & Org Development), and in
  // BADM (310 Mgmt and Organizational Beh, 313 Strategic Human Resource
  // Management).
  {
    id: 'io-psychology-hr',
    label: 'industrial-organizational psychology/HR',
    detect: [
      r`\bindustrial[-\s/]*(and\s+|&\s*)?organi[sz]ational\b`,
      r`\b(i\s*[-/]\s*o|io)\s+psych(ology|ologist|ologists)?\b`,
      r`\borgani[sz]ational\s+(psychology|psychologist|psychologists|behaviou?r|development|effectiveness)\b`,
      r`\bhuman\s+resources?\b`,
      r`\bhr\b`,
      r`\bpeople\s+(analytics|operations|ops)\b`,
      r`\btalent\s+(acquisition|management|development)\b`,
      r`\brecruiters?\b`,
      r`\b(labor|labour|employment|employee|industrial)\s+relations\b`,
      r`\bpersonnel\b`,
      r`\bworkplace\s+(psychology|behaviou?r|culture)\b`,
    ],
    // "hr" is also hours: "15 hr semesters", "12 credit hr", "an hr a week".
    unless: [
      r`\b\d+(\.\d+)?\s*-?\s*(credit\s+|cr\s+)?hrs?\b`,
      r`\b(credit|contact|office|per|rush|happy|twelve|fifteen|sixteen|seventeen|eighteen)\s+hrs?\b`,
      r`\bhrs?\s+(a|per|each|every)\s+(week|day|term|semester)\b`,
    ],
    words: ['industrial org', 'organizational psych', 'organizational beh', 'personnel', 'human resource', 'hr leadership'],
    subjects: [],
    courses: ['PSYC 245', 'PSYC 455', 'PSYC 475', 'LER 182', 'LER 228', 'LER 358', 'BADM 310', 'BADM 313'],
  },
  {
    id: 'neuroscience',
    label: 'neuroscience',
    detect: [
      // Not \bneuro\w*, which is also "neurotic about my GPA"; and "brain"
      // only as a subject of study, not "I have no brain for math".
      r`\bneuro(science|sciences|scientists?|biology|biologist|logy|logist|logists|psych\w*|imaging|engineering)?\b`,
      r`\bneurons?\b`,
      r`\b(the|human|animal)\s+brains?\b`,
      r`\bbrains?\s+(science|sciences|research|health|imaging|injur(y|ies)|development|and\s+(behavior|cognition|mind))\b`,
      r`\b(study|studying|research|researching|understand|understanding)\s+brains\b`,
      r`\bcognitive\s+(science|neuroscience|psychology)\b`,
    ],
    words: ['neuroscience', 'neurobio', 'brain', 'cognitive neuroscience', 'neuropsych'],
    subjects: ['NEUR', 'BCOG'],
    courses: ['PSYC 204', 'PSYC 210', 'NEUR 314', 'NEUR 405', 'NEUR 302', 'MCB 461', 'BCOG 100', 'NEUR 462'],
  },
  {
    id: 'climate-environment',
    label: 'climate/sustainability/environment',
    detect: [
      r`\bclimate\b`,
      r`\bsustainab(le|ility)\b`,
      // Bare "environment" is more often a setting ("a small class environment",
      // "the environment in my dorm is loud") than nature, so it counts only
      // after a verb or preposition that points at nature, or beside another
      // word of this topic.
      r`\benvironment(al|ally|alism|alist|alists)\b`,
      r`\b(protect|protecting|save|saving|help|helping|preserve|preserving|about|for|with|on)\s+(the\s+)?environment\b`,
      r`\benvironment\s*(,|and|&|\/)\s*(sustainab\w*|climate|energy|conservation|ecology|nature|natural)\b`,
      r`\b(sustainability|climate|energy|conservation|ecology|nature)\s*(,|and|&|\/)\s*(the\s+)?environment\b`,
      r`\brenewables?\b`,
      r`\b(clean|green|solar|wind)\s+(energy|power|tech|technology)\b`,
      r`\bconservation\b`,
      r`\becolog(y|ical|ist|ists)\b`,
      r`\bcarbon\b`,
      r`\besg\b`,
      r`\bglobal\s+warming\b`,
      r`\bwildlife\b`,
      r`\bnatural\s+resources?\b`,
    ],
    unless: [r`\b(work|working|learning|team|office|fast[-\s]paced|collaborative|supportive|school|home)\s+environments?\b`],
    words: ['climate', 'sustainability', 'sustainable', 'environmental', 'renewable', 'conservation', 'ecology', 'global change'],
    subjects: ['ENSU', 'ENVS', 'ESE', 'NRES'],
    courses: ['ATMS 140', 'ESE 100', 'ENSU 300', 'ENVS 210', 'NRES 224', 'ESE 466', 'ENSU 310', 'ACE 417'],
  },
  {
    id: 'public-policy',
    label: 'public policy',
    detect: [
      r`\bpublic\s+policy\b`,
      r`\bpolic(y|ies)\b`,
      r`\bthink\s+tanks?\b`,
      r`\blegislat(ion|ive|or|ors|ure)\b`,
      r`\bgovernment\s+(job|jobs|work|agency|agencies)\b`,
      r`\bpublic\s+(sector|service|administration|affairs)\b`,
    ],
    unless: [r`\b(insurance|privacy|return|refund|attendance|company|school|university|cookie)\s+polic(y|ies)\b`],
    // "policy" alone is in forty-five titles from Ag Policy & Leadership to
    // Business Policy and Strategy; only the paired phrase is kept.
    words: ['public policy'],
    subjects: [],
    courses: ['PS 220', 'PS 321', 'PS 322', 'ACE 203', 'CMN 220', 'HDFS 420', 'UP 101'],
  },
  {
    id: 'politics',
    label: 'politics/government',
    detect: [
      r`\bpolitic(s|al|ian|ians)\b`,
      r`\bpoli\s*-?\s*sci\b`,
      r`\bgovernment\b`,
      // Bare "campaigns" is as often marketing ("run ad campaigns") as politics.
      r`\b(political|election|electoral|presidential|congressional|senate|mayoral|gubernatorial)\s+campaigns?\b`,
      r`\bcampaign\s+(manager|managers|staff|staffer|staffers|trail)\b`,
      r`\b(elections?|congress|senate|white\s+house|capitol\s+hill)\b`,
      r`\b(diplomat|diplomats|diplomacy|foreign\s+service|international\s+relations)\b`,
    ],
    // "government" is not a word here: it starts ACCY 419 Financial Accounting
    // for Governmental and Nonprofit Entities.
    words: ['politics', 'political', 'international relations', 'congress', 'elections'],
    subjects: ['PS'],
    courses: ['PS 100', 'PS 101', 'PS 220', 'PS 280', 'PS 301', 'PS 303', 'PS 319'],
  },
  {
    id: 'journalism',
    label: 'journalism',
    detect: [
      r`\bjournalis(m|t|ts)\b`,
      r`\breporters?\b`,
      r`\bnews\s+(anchor|anchors|reporter|writer|writing|media|industry|outlet|outlets|station|organization)\b`,
      r`\bnews(paper|room|caster|casting)s?\b`,
      r`\bbroadcast(ing|er|ers)?\b`,
      r`\bmagazines?\b`,
      r`\beditor(s|ial)?\b`,
      r`\bpodcast(s|ing|er|ers)?\b`,
      r`\bsports\s*(writer|writers|writing|caster|casters|casting)\b`,
    ],
    // A video editor is film work, a code editor a tool.
    unless: [r`\b(video|film|photo|code|text|sound|audio|music)\s+editors?\b`],
    words: ['journalism', 'journalist', 'news', 'broadcast'],
    subjects: ['JOUR'],
    courses: ['JOUR 200', 'JOUR 210', 'JOUR 215', 'JOUR 220', 'JOUR 250', 'JOUR 315', 'JOUR 311'],
  },
  {
    id: 'film-media',
    label: 'film/media production',
    detect: [
      r`\bfilm(s|making|maker|makers)?\b`,
      r`\bcinema(tography|tographer|tographers)?\b`,
      r`\bmovies?\b`,
      r`\bvideo\s+(production|editing|editor|editors)\b`,
      r`\bvideograph(y|er|ers)\b`,
      r`\bscreenwrit(ing|er|ers)\b`,
      r`\bmedia\s+production\b`,
      r`\bdocumentar(y|ies)\b`,
      r`\bcontent\s+creat(ion|or|ors)\b`,
      r`\btv\b`,
      r`\btelevision\b`,
      r`\byoutube(r|rs)?\b`,
      r`\banimation\b`,
      r`\bpost[-\s]?production\b`,
      r`\bhollywood\b`,
      r`\bentertainment\s+industry\b`,
    ],
    // Watching is not making: "I watch a lot of TV".
    unless: [r`\b(watch|watches|watching|watched|binge|binges|binging|bingeing|binged)\s+([\w-]+\s+){0,3}(tv|television|movies?|films?|youtube|netflix|shows?|documentar(y|ies)|animation|anime)\b`],
    words: ['film', 'cinema', 'screenwriting', 'media production', 'documentary', 'post-production', 'digital video', 'television', 'filmmaking', 'cinematography'],
    subjects: ['MACS'],
    courses: ['MACS 150', 'MACS 260', 'MACS 104', 'MACS 370', 'MACS 371', 'MACS 372', 'MACS 480', 'JOUR 240'],
  },
  {
    id: 'education',
    label: 'education/teaching',
    detect: [
      r`\bteach(er|ers|ing)?\b`,
      r`\beducators?\b`,
      // Not bare "classroom": "I prefer small classrooms" is a preference.
      r`\b(my\s+own|run\s+a|lead\s+a|teach\s+(in\s+)?a)\s+classroom\b`,
      r`\bspecial\s+ed(ucation)?\b`,
      r`\bearly\s+childhood\b`,
      r`\b(go|going)\s+into\s+education\b`,
      r`\bwork(ing)?\s+in\s+education\b`,
      r`\beducation\s+(major|policy|career|field)\b`,
      r`\btutor(s|ing)?\b`,
    ],
    // Getting help is not giving it: "I need a tutor for calc", "I go to
    // tutoring", "my TA" (a teaching assistant is a course role, not a career).
    unless: [
      r`\b(need|needs|needed|get|getting|got|find|finding|hire|hired|see|seeing|saw)\s+(an?\s+|some\s+)?([\w-]+\s+)?tutor(s|ing)?\b`,
      r`\b(go|going|went|goes)\s+to\s+tutoring\b`,
      r`\btutoring\s+(center|centre|sessions?|services|help)\b`,
      r`\bteaching\s+assistants?\b`,
    ],
    words: ['teaching', 'teacher', 'classroom', 'curriculum', 'early childhood', 'special education'],
    subjects: ['CI', 'EDUC', 'EDPR', 'SPED'],
    courses: ['EDUC 201', 'EDUC 202', 'EDUC 205', 'EPSY 201', 'CI 401', 'CI 404', 'SPED 405'],
  },
  {
    id: 'nursing',
    label: 'nursing',
    detect: [
      r`\bnurs(e|es|ing)\b`,
      r`\bbsn\b`,
      r`\bcrna\b`,
      r`\bmidwi(fe|fery|ves)\b`,
      r`\b(be|become|becoming)\s+an?\s+rn\b`,
      r`\brn\s+(program|license|licensure)\b`,
      r`\bnclex\b`,
    ],
    // No Illinois title contains "nursing"; these are the prerequisite areas,
    // narrowed to people: "anatomy" alone opens ARCH 231 Anatomy of Buildings
    // and "nutrition" alone ANSC 420 Ruminant Nutrition.
    words: ['human anatomy', 'microbiology', 'human nutrition', 'human development', 'health care'],
    subjects: [],
    courses: ['CHEM 102', 'CHEM 103', 'MCB 244', 'MCB 245', 'MCB 246', 'MCB 247', 'MCB 100', 'MCB 101', 'HDFS 105', 'STAT 100', 'FSHN 120', 'PSYC 100', 'SOC 100', 'RHET 105'],
    note:
      'Urbana-Champaign has no BSN of its own. Students complete the prerequisites here and transfer to the UIC College of Nursing, which teaches its BSN on the Urbana campus: general chemistry with lab, anatomy and physiology I and II with labs, microbiology, lifespan development, statistics and nutrition, inside 57 hours of college coursework. The codes are the Illinois courses in those areas (HDFS 105 is the lifespan course the Career Center\'s OT guide names); UIC decides equivalence through Transferology, so a student confirms each with conapply@uic.edu.',
    source: { url: 'https://nursing.uic.edu/programs/bsn-all/bsn/admissions-applying/admission-requirements', title: 'Admission Requirements | College of Nursing | University of Illinois Chicago', read: READ },
  },
  {
    id: 'biotech',
    label: 'biotech',
    detect: [
      r`\bbiotech(nology)?\b`,
      r`\bbio\s*-?\s*pharma(ceutical|ceuticals)?\b`,
      r`\bpharmaceutical\s+(industry|company|companies|research|science|sciences)\b`,
      r`\bpharma\b`,
      r`\bgenetic\s+engineering\b`,
      r`\bgene\s+(editing|therapy)\b`,
      r`\bcrispr\b`,
      r`\bbioengineer(ing)?\b`,
      r`\bbiomedical\s+(engineering|research|industry|devices?)\b`,
      r`\bgenomics?\b`,
      r`\bbioinformatics\b`,
      r`\bdrug\s+(discovery|development|design)\b`,
      r`\bsynthetic\s+biology\b`,
    ],
    words: ['biotech', 'genetic engineering', 'gene editing', 'genomics', 'bioinformatics', 'bioprocessing', 'biochemical engineering', 'molecular genetics'],
    subjects: ['BIOE'],
    courses: ['BIOC 455', 'CPSC 261', 'CPSC 265', 'MCB 250', 'MCB 251', 'BIOE 460', 'CS 466', 'CHBE 471'],
  },
  {
    id: 'law',
    label: 'law/legal',
    detect: [
      r`\blaws?\b`,
      r`\bprelaw\b`,
      r`\blegal\b`,
      r`\blawyers?\b`,
      r`\battorneys?\b`,
      r`\bparalegals?\b`,
      r`\bcriminal\s+justice\b`,
      r`\bconstitution(al)?\b`,
      r`\bsupreme\s+court\b`,
      r`\bcourt\s*rooms?\b`,
    ],
    // "Is it legal to take 21 hours?" asks about a rule, not a career.
    unless: [IN_LAWS, r`\bmurphy'?s\s+law\b`, r`\blegal\s+(to|name|guardian|age|drinking)\b`, r`\b(is\s+(it|that|this)|it's|that's|isn't\s+it)\s+(even\s+|still\s+)?legal\b`],
    words: ['law', 'legal', 'constitution', 'criminal justice', 'judicial', 'supreme court', 'criminology'],
    subjects: ['LAW'],
    courses: ['LAW 301', 'LAW 304', 'LAW 306', 'PS 301', 'PS 305', 'BADM 300', 'SOC 275', 'PSYC 468'],
  },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const COMPILED = new Map<string, RegExp>();

/** One compiled, global, case-insensitive regex per source; matchAll copies it, so sharing is safe. */
function compiled(source: string): RegExp {
  let re = COMPILED.get(source);
  if (!re) {
    re = new RegExp(source, 'gi');
    COMPILED.set(source, re);
  }
  return re;
}

/** Lower case, straight apostrophes and hyphens, so "Pre–Med" and "doctor’s" match like their plain forms. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[‐-―]/g, '-');
}

/** `text` with every match of `unless` replaced by spaces of the same length, so indices still line up. */
function masked(text: string, unless: string[] | undefined): string {
  if (!unless || unless.length === 0) return text;
  let out = text;
  for (const source of unless) out = out.replace(compiled(source), (m) => ' '.repeat(m.length));
  return out;
}

/*
 * A goal the student is turning away from is not a goal. "I don't want to go
 * to med school anymore" names medical school and means the opposite, and
 * "I used to want to be a doctor, now I want PT" means PT alone. So a match is
 * dropped when its own clause says no before it, within eight words: far
 * enough for "I don't think I want to be a doctor", near enough that "I don't
 * have a car and I want to be a doctor" keeps the doctor.
 *
 * Doubt is not refusal. "not sure if pre-med or pre-PT" and "I don't know
 * whether law school is for me" keep both goals: the student is weighing them.
 */
const CLAUSE_BREAK = /[.;!?\n,]|\b(but|however|though|although|now)\b/g;
const NEGATION = /\b(not|never|no longer|no way|no (interest|desire|plans?)|don't|dont|do not|doesn't|doesnt|didn't|didnt|won't|wont|wouldn't|hate|dislike|rather than|instead of|anything but|other than|except|quit|quitting|dropped|dropping|switched (out of|from|away from)|used to|done with|gave up( on)?|giving up( on)?|(never\s?mind|changed my mind|forget) (about|on|regarding))\b/;
const DOUBT = /\b(not sure|not certain|not decided|not yet|don't know|dont know|do not know|not only|not just|or not|if|whether|undecided)\b/;
/* "no med school for me", "no more pre-med": a bare "no" counts only right before the goal, so "no idea, maybe med school" keeps it. */
const NO_RIGHT_BEFORE = /\bno(\s+more)?\s*$/;
/*
 * A refusal after the goal: "med school is not for me", "law school isn't my
 * thing", "pre-med? nah", "PT? No." Up to two more words of the goal's own
 * phrase come first, so the "law" of "law school is not for me" is refused
 * with it. A "no" on its own needs the punctuation, so "UX, no question"
 * keeps UX.
 */
const REFUSED_AFTER = new RegExp(
  r`^([-\s]+[\w'-]+){0,2}?\s*[?,:-]?\s*((is|are|was|seems)\s+)?(not|isn't|isnt|wasn't|wasnt|aren't|arent|no\s+longer)\s+(really\s+|actually\s+|for\s+sure\s+)?(for\s+me|my\s+thing|happening|an\s+option|the\s+plan|what\s+i\s+want)\b` +
    r`|^([-\s]+[\w'-]+){0,2}?\s*[?,:-]\s*(nope|nah|no)(?=\s*([,.;!?]|$))`,
);
/*
 * A refusal that also takes back what came before it. "I want to go to med
 * school but not to be a surgeon" refuses surgery and keeps medicine; "I'm
 * not pre-med anymore", "no med school for me" and "actually I don't want
 * law" take the goal back wherever it was said earlier, which is what a
 * student means when ALMA's stored words still hold last week's "pre-med".
 */
const RETRACT = /\b(anymore|any\s+more|no\s+longer|for\s+me|actually|instead|used\s+to|switch(ed|ing)|drop(ped|ping)|quit(ting)?|gave\s+up|giving\s+up|done\s+with|never\s?mind|changed\s+my\s+mind|forget\s+about|decided)\b/;

/*
 * Changing one's mind about everything said so far: "physical therapy school,
 * actually I changed my mind, I'd rather do sports management", "pre-med
 * never mind, not pre-med". Whatever came before the last of these is not a
 * goal any more. "I've never changed my mind" is not one, and "never mind
 * about pre-med" takes back pre-med alone (NEGATION above).
 */
const CHANGED_MIND = /(?<!\b(never|not|haven't|havent|hasn't|hasnt|didn't|didnt|don't|dont|won't|wont|wouldn't|wouldnt|can't|cant)\s+)\b(never\s?mind|changed\s+my\s+mind|change\s+of\s+heart|scratch\s+that|on\s+second\s+thoughts?)\b(?!\s+(about|on|regarding|with)\b)/g;

/** `text` with everything up to the end of the last change of mind blanked, indices kept. */
function afterChangeOfMind(text: string): string {
  let end = 0;
  for (const m of text.matchAll(CHANGED_MIND)) end = (m.index ?? 0) + m[0].length;
  return end === 0 ? text : ' '.repeat(end) + text.slice(end);
}

/*
 * Someone else's job is not the student's goal. "My dad is a lawyer but I want
 * engineering", "my roommate is premed" and "my sister wants to be a lawyer"
 * name a career right after a relative or friend and a verb, so the match is
 * dropped. It stays when the sentence goes on to claim it ("my mom is a nurse
 * so I want to be one"), and a second mention in the student's own voice is
 * found on its own ("my dad's a doctor so I've always wanted to be a doctor").
 */
const SOMEONE_ELSE = /\b(mom|mother|mum|dad|father|parents?|step-?(mom|mother|dad|father)|sister|brother|siblings?|aunt|uncle|grandma|grandmother|grandpa|grandfather|grandparents?|cousin|friend|roommate|boyfriend|girlfriend|wife|husband|family|neighbor)s?([-\s]in[-\s]laws?)?('s|\s+(is|was|are|were|became|has been|had been|works as|worked as|works in|worked in|wants? to be|wanted to be|wants? to go to|wanted to go to|goes|went|got into|gets into|studies|studied|applies|applied|attends|attended))\s+(an?\s+)?([\w-]+\s+){0,2}$/;
const ME_TOO = /\b(too|also|as well|like (him|her|them)|same|follow(ing)? in|so (am|do|will) i|(be|become|becoming) one)\b/;

/** Whether the student refuses the goal matched at [index, end), and whether that refusal takes back earlier mentions. */
function stance(text: string, index: number, end: number): { negated: boolean; retracts: boolean } {
  // The whole word is judged, not the part a pattern matched: the law topic
  // matches the "law" of "pre-law", and "my sister is pre-" is no relative
  // and a verb, so "my sister is pre-law" gave the student a law topic.
  const wordStart = index - (text.slice(0, index).match(/[\w'-]*$/)?.[0].length ?? 0);
  const before = text.slice(0, wordStart);
  let start = 0;
  for (const m of before.matchAll(CLAUSE_BREAK)) start = (m.index ?? 0) + m[0].length;
  const clause = before.slice(start);
  const sentence = text.slice(index).split(/[.;!?\n]/)[0];
  if (SOMEONE_ELSE.test(clause) && !ME_TOO.test(sentence)) return { negated: true, retracts: false };
  const words = clause.trim().split(/\s+/).filter(Boolean);
  const near = words.slice(-8).join(' ');
  // Not cut at "?": "pre-med? nah" answers its own question.
  const after = text.slice(end).split(/[.;!\n]/)[0];
  const negated = (NEGATION.test(near) && !DOUBT.test(near)) || NO_RIGHT_BEFORE.test(clause) || REFUSED_AFTER.test(after);
  return { negated, retracts: negated && (RETRACT.test(near) || RETRACT.test(after)) };
}

/*
 * Phrases where the student is the patient or the client, blanked out for
 * every track and topic before anything is matched: "my doctor said I should
 * reduce stress" is not pre-med, "my academic counselor told me to take CHEM
 * 102" is not counseling, "I have a dentist appointment" is not pre-dental and
 * "take my dog to the veterinarian" is not pre-vet. "The vet school" and "a
 * pharmacy program" are goals, so a school or program right after keeps them.
 */
const PROFESSIONAL = r`(doctors?|physicians?|dentists?|orthodontists?|optometrists?|eye\s+doctors?|pharmacists?|therapists?|psychiatrists?|psychologists?|counsell?ors?|nurses?|vets?|veterinarians?|lawyers?|attorneys?|accountants?|teachers?|tutors?|pts?|pas?)`;
/* "My PT school applications", "my vet tech job", "my pre PA classes": the student's own path. */
const STILL_A_GOAL = r`(?!\s+(school|schools|program|programs|application|applications|apps|prereqs?|prerequisites|track|path|requirements|classes|courses|tech|techs|technician|technicians|student|students|med|medicine|degree|career|major))`;
const NOT_A_GOAL: string[] = [
  r`\b(my|our|his|her|their|your)\s+((?!pre\b)[\w-]+\s+){0,2}${PROFESSIONAL}\b${STILL_A_GOAL}`,
  r`\b(to|at|from)\s+(the|a|my)\s+(doctor|dentist|orthodontist|optometrist|eye\s+doctor|vet|veterinarian|pharmacy|pharmacist|therapist|psychiatrist)('?s)?\b${STILL_A_GOAL}`,
  r`\b(doctor|dentist|orthodontist|optometrist|eye\s+doctor|vet|veterinarian|therapy|therapist|counseling|counselor|psychiatrist)('?s)?\s+(appointments?|office|offices|visits?|bills?|notes?|orders?|check-?ups?|sessions?)\b`,
  r`\b(i'm|i\s+am|i've\s+been|been|was|currently)\s+in\s+therapy\b`,
  r`\b(go|going|went|goes|get|getting|got)\s+to\s+therapy\b`,
];

/**
 * Where the student names this as their own goal, or -1: the earliest match
 * not masked away and not refused, after the last mention that takes it back.
 * "pre-med ... actually I don't want to do pre-med anymore, I want UX
 * research" names pre-med twice and keeps neither.
 */
function firstMention(text: string, detect: string[], unless: string[] | undefined): number {
  const t = masked(text, unless);
  const kept: number[] = [];
  let takenBack = -1;
  for (const source of detect) {
    for (const m of t.matchAll(compiled(source))) {
      if (m[0].length === 0) continue;
      const at = m.index ?? 0;
      const { negated, retracts } = stance(t, at, at + m[0].length);
      if (retracts) takenBack = Math.max(takenBack, at);
      if (!negated) kept.push(at);
    }
  }
  const after = kept.filter((at) => at > takenBack);
  return after.length > 0 ? Math.min(...after) : -1;
}

function pushAll(into: string[], seen: Set<string>, items: Iterable<string>): void {
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    into.push(item);
  }
}

/**
 * What a student's own sentence names, in the planner's terms.
 *
 *   interestProfile("I want to go to PT school after, maybe something with AI")
 *     tracks  [pre-physical-therapy]
 *     topics  [AI/machine learning]
 *     heard   ["pre-physical-therapy", "AI/machine learning"]
 *     courses the PT list (every alternative, the preferred one first), then CS 440 ...
 *
 * Tracks and topics come back in the order the student named them. A topic a
 * detected track already covers (pre-law covers law/legal) is folded into
 * `topics`, `words` and `subjects` but not repeated in `heard`, so the bot
 * does not read back "pre-law, law/legal". Deterministic: the same text always
 * gives the same profile.
 *
 * `text` is what the student said they want to do, not what they study: the
 * name of a major is not a goal ("Psychology" is not counseling, "Computer
 * science" is not software engineering), so callers pass the career words
 * alone (see interestProfileOf in autoplan.ts).
 */
export function interestProfile(text: string): InterestProfile {
  const t = masked(afterChangeOfMind(normalize(text ?? '')), NOT_A_GOAL);
  const byPosition = <T extends { detect: string[]; unless?: string[] }>(list: T[]) =>
    list
      .map((item, order) => ({ item, order, at: firstMention(t, item.detect, item.unless) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at || a.order - b.order)
      .map((x) => x.item);

  const tracks = byPosition(CAREER_TRACKS);
  const named = byPosition(INTEREST_TOPICS);
  const covered = new Set(tracks.flatMap((tr) => tr.related));
  const topics = [...named];
  for (const id of covered) {
    const topic = INTEREST_TOPICS.find((x) => x.id === id);
    if (topic && !topics.includes(topic)) topics.push(topic);
  }

  const words: string[] = [];
  const subjects: string[] = [];
  const courses: string[] = [];
  const seenWords = new Set<string>();
  const seenSubjects = new Set<string>();
  const seenCourses = new Set<string>();
  for (const tr of tracks) {
    pushAll(words, seenWords, tr.words);
    pushAll(courses, seenCourses, tr.courses.flatMap((x) => x.codes));
  }
  for (const topic of topics) {
    pushAll(words, seenWords, topic.words);
    pushAll(subjects, seenSubjects, topic.subjects);
    pushAll(courses, seenCourses, topic.courses);
  }

  const heard = [...tracks.map((tr) => tr.id), ...named.filter((x) => !covered.has(x.id)).map((x) => x.label)];
  return { tracks, topics, words, subjects, courses, heard };
}

/** How ALMA's set_priorities writes the student's new words into the stored career words. */
export type InterestsMode = 'add' | 'replace' | 'clear';

/**
 * The career words to store once the student has said `said`.
 *
 *   add      appended as a sentence of its own, unless the words are
 *            already there and would change nothing heard
 *   replace  the new words alone: the student changed their goal
 *   clear    nothing: the student dropped their goal and named no other
 *
 * Appending was the only choice, so "pre-med" stored first and "I want UX
 * research instead" said later kept the pre-medicine track, and its first
 * claim on the free electives, on every rebuild. Replace with no words keeps
 * what is stored; there is nothing to replace it with.
 *
 * Each call is its own sentence: joined with a bare space, "not pre-med
 * anymore" and a later "pre-med" read as one clause and the "not" refused the
 * goal the student had just taken up again.
 */
export function careerWordsAfter(current: string, said: string, mode: InterestsMode): string {
  const words = said.trim();
  const now = current.trim();
  if (mode === 'clear') return '';
  if (!words) return now;
  if (mode === 'replace' || !now) return words;
  const appended = `${now}${/[.!?;]$/.test(now) ? '' : '.'} ${words}`;
  const heardSame = JSON.stringify(interestProfile(now).heard) === JSON.stringify(interestProfile(appended).heard);
  return now.toLowerCase().includes(words.toLowerCase()) && heardSame ? now : appended;
}

/**
 * Where each course a track marks required stands: planned (with the term
 * `plannedIn` names), already held, or missing. A row of alternatives ("MCB
 * 150 or IB 150") is one course, reported under the code that is there.
 *
 * For ALMA after a goal is said in chat: a Kinesiology student who told it
 * "I'm pre-PT" got three track courses from the re-pick where a Rebuild books
 * twelve, and ALMA had no way to know the other nine were missing.
 */
export function trackRequiredStatus(
  track: CareerTrack,
  plannedIn: (code: string) => string | null,
  held: (code: string) => boolean,
): { planned: string[]; held: string[]; missing: string[] } {
  const out = { planned: [] as string[], held: [] as string[], missing: [] as string[] };
  for (const need of track.courses) {
    if (need.need !== 'required') continue;
    const taken = need.codes.find(held);
    const placed = need.codes.map((code) => ({ code, term: plannedIn(code) })).find((x) => x.term !== null);
    if (taken) out.held.push(taken);
    else if (placed) out.planned.push(`${placed.code} in ${placed.term}`);
    else out.missing.push(need.codes.join(' or '));
  }
  return out;
}
