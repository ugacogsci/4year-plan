/**
 * UGA's pre-health career tracks: the goals CAREER_TRACKS names for Illinois
 * (same ids), with UGA's own course lists.
 *
 * Read on 2026-10-21 from UGA's Pre-Professional Advising Office (PPAO,
 * ppao.uga.edu, robots.txt allows everything, crawl delay honored) and, for
 * pre-pharmacy, the UGA College of Pharmacy's own prerequisite list (PPAO's
 * pre-pharmacy page links it). Each track's `source` and `alsoSee` are the
 * pages it was read from. Only facts are kept (course codes, how firmly each
 * is asked for, when); the `why` lines are our paraphrases. Pre-law has no
 * UGA list here: law schools require no course, so a UGA pre-law student's
 * goal shapes the electives the way any topic does, and nothing is booked.
 *
 * How a student names a goal does not depend on the school, so `detect` and
 * `unless` are the Illinois track's (career-tracks.ts adds them by id).
 *
 * Codes are in the planner's UGA form (uga-source.tsx listedUgaCourseCodes):
 * "CHEM 1211" for the catalog row "CHEM 1211-1211D", "PHYS 1111" for
 * "PHYS 1111-1111L" (UGA lists that lab inside the course), "BCMB 4010" for
 * "BCMB 4010/6010". Every code is in public/uga-catalog.json
 * (__career-tracks.check.mjs checks it).
 *
 * Two kinds of row need a word:
 *   - An alternative that counts only with a partner is written as the
 *     partner's second half, which the catalog will not admit without the
 *     first: BCMB 4020 lists BCMB 4010/6010 as its prerequisite and CBIO
 *     2210-2210L lists CBIO 2200-2200L, so a plan that holds or books BCMB
 *     4020 or CBIO 2210 holds the pair the guide names ("BCMB 4010 & 4020",
 *     "CBIO 2200 & 2210").
 *   - `variants` are UGA's honors versions of the same course, which the
 *     College of Pharmacy's list names as the same requirement ("CHEM 1211 &
 *     1211L or 1311H & 1311L") and the catalog's prerequisite lines accept in
 *     its place (CHEM 2211: "CHEM 1212-1212D or CHEM 1312H or CHEM 1412").
 *     One the student holds meets the row (autoplan.ts careerProfileOf); none
 *     is ever booked, since honors sections need Honors permission.
 *
 * PMCY 3000 Human Physiology is named by PPAO's MCAT page, its 2026 Quick
 * Facts and 2024 orientation (pre-med) and its vet page, but it is not in
 * public/uga-catalog.json under that number or any suffix, so no row holds
 * it: each track that names it says so in its note, and it is never booked.
 */
import type { CareerTrack, TrackCourse, TrackDue, TrackNeed, TrackSource } from './career-tracks.ts';

/** A UGA track: a CareerTrack without the words that detect it, which are the Illinois track's. */
export type UgaTrackData = Omit<CareerTrack, 'detect' | 'unless'>;

/**
 * The first half of each pair a row writes as its second half (see the
 * header): booking BCMB 4020 or CBIO 2210 for a row books this course first,
 * so it needs its real hours too (career-tracks.ts ugaTrackCodes).
 */
export const UGA_PAIR_FIRST: Readonly<Record<string, string>> = { 'BCMB 4020': 'BCMB 4010', 'CBIO 2210': 'CBIO 2200' };

const READ = '2026-10-21';
const PPAO = 'https://ppao.uga.edu';
const ppao = (path: string, title: string): TrackSource => ({ url: PPAO + path, title, read: READ });

const S = {
  medCourses: ppao('/programs/pre-medical/building-credentials-for-medical-school/', 'Building Credentials for Medical School (Course Requirements tab) - UGA Pre-Professional Advising Office'),
  mcat: ppao('/programs/pre-medical/how-to-apply-to-medical-school/mcat/', 'Medical College Admission Test (MCAT) - UGA Pre-Professional Advising Office'),
  quickFacts: ppao('/wp-content/uploads/Pre-Med-Quick-facts-2026.pdf', 'Pre-Med Quick Facts (2026), UGA Pre-Professional Advising Office'),
  orientation: ppao('/wp-content/uploads/2024Introductory_Orientation_Pre-Med.pdf', 'Introductory Orientation for 1st and 2nd year pre-med students (2024), UGA Pre-Professional Advising Office'),
  medHome: ppao('/programs/pre-medical/', 'Medical - UGA Pre-Professional Advising Office'),
  dental: ppao('/programs/dentistry/building-credentials-for-dental-school/course-requirements/', 'Dental School Course Requirements - UGA Pre-Professional Advising Office'),
  pa: ppao('/programs/allied-health/physician-associate/course-requirements/', 'Physician Associate Course Requirements - UGA Pre-Professional Advising Office'),
  pt: ppao('/programs/allied-health/physical-therapy/course-requirements/', 'Physical Therapy Course Requirements - UGA Pre-Professional Advising Office'),
  ot: ppao('/programs/allied-health/occupational-therapy/course-requirements/', 'Occupational Therapy Course Requirements - UGA Pre-Professional Advising Office'),
  optometry: ppao('/programs/optometry/building-credentials-for-optometry-school/course-requirements/', 'Optometry School Course Requirements - UGA Pre-Professional Advising Office'),
  vet: ppao('/programs/pre-veterinary/credentials/courses/', 'Veterinary School Course Requirements - UGA Pre-Professional Advising Office'),
  pharmacyAdvising: ppao('/about/pre-pharmacy/', 'UGA College of Pharmacy Advising - UGA Pre-Professional Advising Office'),
  pharmacy: { url: 'https://rx.uga.edu/wp-content/uploads/2025/08/Pre-Pharmacy-Coursework-2025-1.pdf', title: 'Required Pre-Pharmacy Coursework (updated June 2025), UGA College of Pharmacy', read: READ },
};

const HEALTH_NOTE =
  "Any major can apply: UGA has no pre-med or pre-health major, it is an intent. The lists are the UGA Pre-Professional Advising Office's (PPAO) general lists, not every school's; each professional school sets its own prerequisites, so the student checks each target school and meets a PPAO pre-health advisor (130 Memorial Hall).";
const AP_NOTE =
  'Some schools do not accept AP credit for prerequisites, especially biology, chemistry and sometimes physics; they usually accept upper-level courses with labs in that subject instead.';
const PMCY_3000 =
  "PPAO also names PMCY 3000 Human Physiology, which is not in the planner's UGA course list, so the plan names it here and never books it; ask PPAO whether it runs.";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const row = (codes: string[], need: TrackNeed, why: string, opts: { due?: TrackDue; variants?: string[] } = {}): TrackCourse => ({
  codes,
  need,
  why,
  ...(opts.due ? { due: opts.due } : {}),
  ...(opts.variants?.length ? { variants: opts.variants } : {}),
});
/** "The lab taken with X": labPartners reads the lecture from these words and keeps the pair in one term. */
const lab = (code: string, lecture: string, need: TrackNeed, opts: { due?: TrackDue; variants?: string[] } = {}): TrackCourse =>
  row([code], need, `The lab taken with ${lecture}.`, opts);

/** UGA's honors versions of each course (see the header). */
const HONORS: Record<string, string[]> = {
  'BIOL 1107': ['BIOL 2107H'], 'BIOL 1107L': ['BIOL 2107L'],
  'BIOL 1108': ['BIOL 2108H'], 'BIOL 1108L': ['BIOL 2108L'],
  'CHEM 1211': ['CHEM 1311H'], 'CHEM 1211L': ['CHEM 1311L'],
  'CHEM 1212': ['CHEM 1312H'], 'CHEM 1212L': ['CHEM 1312L'],
  'CHEM 2211': ['CHEM 2311H'], 'CHEM 2211L': ['CHEM 2311L'],
  'CHEM 2212': ['CHEM 2312H'], 'CHEM 2212L': ['CHEM 2312L'],
  'ENGL 1102': ['ENGL 1050H', 'ENGL 1060H'],
};
const honors = (code: string, due?: TrackDue) => ({ ...(due ? { due } : {}), variants: HONORS[code] ?? [] });

function biology(need: TrackNeed, due?: TrackDue, second = true): TrackCourse[] {
  return [
    row(['BIOL 1107'], need, 'General biology (one year with lab), first half: Principles of Biology I, with its lab BIOL 1107L.', honors('BIOL 1107', due)),
    lab('BIOL 1107L', 'BIOL 1107', need, honors('BIOL 1107L', due)),
    ...(second
      ? [
          row(['BIOL 1108'], need, 'General biology, second half: Principles of Biology II, with its lab BIOL 1108L.', honors('BIOL 1108', due)),
          lab('BIOL 1108L', 'BIOL 1108', need, honors('BIOL 1108L', due)),
        ]
      : []),
  ];
}

function generalChemistry(need: TrackNeed, due?: TrackDue): TrackCourse[] {
  return [
    row(['CHEM 1211'], need, 'General chemistry (one year with lab), first half, with its lab CHEM 1211L.', honors('CHEM 1211', due)),
    lab('CHEM 1211L', 'CHEM 1211', need, honors('CHEM 1211L', due)),
    row(['CHEM 1212'], need, 'General chemistry, second half, with its lab CHEM 1212L.', honors('CHEM 1212', due)),
    lab('CHEM 1212L', 'CHEM 1212', need, honors('CHEM 1212L', due)),
  ];
}

const organicOne = (need: TrackNeed, due?: TrackDue): TrackCourse[] => [
  row(['CHEM 2211'], need, 'Organic chemistry I, with its lab CHEM 2211L.', honors('CHEM 2211', due)),
  lab('CHEM 2211L', 'CHEM 2211', need, honors('CHEM 2211L', due)),
];

const organicTwo = (need: TrackNeed, due?: TrackDue): TrackCourse[] => [
  row(['CHEM 2212'], need, 'Organic chemistry II, after CHEM 2211, with its lab CHEM 2212L.', honors('CHEM 2212', due)),
  lab('CHEM 2212L', 'CHEM 2212', need, honors('CHEM 2212L', due)),
];

/*
 * UGA catalogs physics lecture and lab as one course, "PHYS 1111-1111L", so
 * the "with lab" PPAO writes is inside the row, not a second one. PHYS
 * 1211-1212 is the calculus-based sequence the medical, dental and
 * optometry pages name as the other. The PT and OT pages name PHYS 1111-1112
 * alone; PHYS 1211 is still listed second there, the way career-tracks.ts
 * lists PHYS 211 after PHYS 101, so a student whose degree takes the
 * calculus-based sequence is not told to add the other: UGA's catalog takes
 * either first half before PHYS 1112 (its prerequisite line reads "PHYS
 * 1111-1111L or PHYS 1211-1211L or ...").
 */
const OTHER_PHYSICS =
  " PHYS 1211-1212, the calculus-based sequence PPAO's medical page names as the other, is listed second for a student whose degree takes it; confirm that each target program accepts it.";
function physics(need: TrackNeed, opts: { due?: TrackDue; named?: boolean; extra?: string } = {}): TrackCourse[] {
  const both = opts.named === false ? OTHER_PHYSICS : ' PHYS 1211-1212 (the calculus-based sequence for scientists and engineers) is the other sequence the guide names.';
  const extra = opts.extra ? ` ${opts.extra}` : '';
  return [
    row(['PHYS 1111', 'PHYS 1211'], need, `General physics (one year with lab), first half; UGA lists the lab inside the course (PHYS 1111-1111L).${both}${extra}`, { due: opts.due }),
    row(['PHYS 1112', 'PHYS 1212'], need, `General physics, second half (PHYS 1112-1112L).${both}${extra}`, { due: opts.due }),
  ];
}

const english = (need: TrackNeed): TrackCourse[] => [
  row(['ENGL 1101'], need, 'English Composition I (one year of English).'),
  row(['ENGL 1102'], need, 'English Composition II.', honors('ENGL 1102')),
];

function anatomyPhysiology(need: TrackNeed, extra = ''): TrackCourse[] {
  return [
    row(['CBIO 2200'], need, `Anatomy and Physiology I with its lab; UGA lists the lab inside the course (CBIO 2200-2200L).${extra}`),
    row(['CBIO 2210'], need, `Anatomy and Physiology II with its lab (CBIO 2210-2210L), after CBIO 2200.${extra}`),
  ];
}

const psychology = (need: TrackNeed, due?: TrackDue) => row(['PSYC 1101'], need, 'Elementary (general) psychology.', { due });
const medicalTerminology = (need: TrackNeed, why = 'Medical terminology.') => row(['CLAS 1030'], need, why);
const abnormalPsychology = (need: TrackNeed) =>
  row(['PSYC 3230'], need, 'Abnormal psychology: the guide names PSYC 3230, which the UGA catalog titles Psychopathology.');
const lifespan = (need: TrackNeed) => row(['HDFS 2200'], need, 'Lifespan development.');

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export const UGA_TRACKS: UgaTrackData[] = [
  {
    id: 'pre-medicine',
    name: 'Pre-medicine (MD/DO)',
    // The MCAT page lists what to finish before the test; organic chemistry II
    // is required for medical school (Course Requirements, Quick Facts 2026)
    // but only "highly encouraged" before the MCAT, so it is due with the
    // application rather than the exam. Quick Facts 2026: study January to
    // May of year 3, take the MCAT April to early June, submit AMCAS/AACOMAS
    // in early June before year 4; many students take 12-13 hours the
    // semester they study for it.
    courses: [
      ...biology('required', 'exam'),
      ...generalChemistry('required', 'exam'),
      ...organicOne('required', 'exam'),
      ...organicTwo('required', 'application'),
      row(['BCMB 3100', 'BCMB 4020'], 'required',
        'One semester of biochemistry: BCMB 3100, or BCMB 4010 with BCMB 4020 (the guide names the two-course sequence, so BCMB 4010 alone does not count; BCMB 4020 follows BCMB 4010). PPAO encourages it for every pre-med because the MCAT covers it heavily.',
        { due: 'exam' }),
      ...physics('required', { due: 'exam' }),
      ...english('required'),
      // Course Requirements, the MCAT page and Quick Facts 2026.
      row(['STAT 2000', 'BIOS 2010'], 'required',
        'One semester of statistics: STAT 2000 or BIOS 2010. Not every medical school requires it, but the Medical College of Georgia does. PSYC 3990 does not count: the Math Department does not treat it as statistics.',
        { due: 'exam' }),
      psychology('recommended', 'exam'),
      row(['SOCI 1101'], 'recommended', "Introductory sociology, for the MCAT's psychological, social and biological foundations section.", { due: 'exam' }),
      row(['GENE 3200'], 'recommended', 'Genetics: highly encouraged before the MCAT.', { due: 'exam' }),
      row(['CBIO 3710', 'VPHY 3100', 'CBIO 2210'], 'recommended',
        `A physiology course before the MCAT: CBIO 3710, VPHY 3100, or CBIO 2200 with CBIO 2210 (the pair; CBIO 2210 follows CBIO 2200). ${PMCY_3000}`,
        { due: 'exam' }),
      row(['MATH 2250'], 'suggested', 'Calculus: some medical schools require it (Course Requirements); the 2024 orientation lists MATH 2250 among miscellaneous recommended courses.'),
      row(['CBIO 3400'], 'suggested', "Cell Biology: on the 2024 orientation's miscellaneous recommended list."),
    ],
    words: [],
    related: [],
    source: S.medCourses,
    alsoSee: [S.mcat, S.quickFacts, S.orientation, S.medHome],
    // Organic II, biochemistry, and the psychology and sociology the MCAT's behavioral section assumes.
    exam: { name: 'MCAT', content: ['CHEM 2212', 'BCMB 3100', 'BCMB 4010', 'BCMB 4020', 'PSYC 1101', 'SOCI 1101'] },
    note: `${HEALTH_NOTE} ${AP_NOTE} The 2024 orientation says the Medical College of Georgia does not accept AP credit for biology or chemistry. Other schools may also want calculus, behavioral sciences, upper-level biology or more humanities. ${PMCY_3000}`,
  },
  {
    id: 'pre-dental',
    name: 'Pre-dental (DDS/DMD)',
    courses: [
      ...generalChemistry('required'),
      ...organicOne('required'),
      ...organicTwo('required'),
      ...biology('required'),
      ...physics('required', { extra: 'The guide notes physics is not on the DAT.' }),
      ...english('required'),
      // The guide names these subjects without UGA codes ("some schools require
      // courses in biochemistry, microbiology, anatomy, physiology, calculus,
      // statistics, psychology ..."); the codes are the ones other PPAO pages
      // give for the same subject.
      row(['BCMB 3100'], 'suggested', "Biochemistry: some dental schools require it; BCMB 3100 is the course PPAO's pre-med page names."),
      row(['MIBO 2500', 'MIBO 3500'], 'suggested', "Microbiology: some dental schools require it; MIBO 2500 or MIBO 3500 are the courses PPAO's PA page names."),
      ...anatomyPhysiology('suggested', " Some dental schools require anatomy and physiology; this is the sequence PPAO's PA page names."),
      row(['STAT 2000', 'BIOS 2010'], 'suggested', "Statistics: some dental schools require it; STAT 2000 or BIOS 2010 as PPAO's pre-med page names."),
      psychology('suggested'),
    ],
    words: [],
    related: [],
    source: S.dental,
    note: `${HEALTH_NOTE} ${AP_NOTE} Most dental schools strongly recommend additional upper-division biology, and requirements can change from cycle to cycle (ADEA Official Guide to Dental Schools).`,
  },
  {
    id: 'pre-physician-assistant',
    name: 'Pre-physician assistant (PA)',
    courses: [
      ...anatomyPhysiology('required'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      ...biology('required'),
      row(['STAT 2000', 'BIOS 2010', 'BIOS 3000'], 'required', 'Statistics: STAT 2000, BIOS 2010 or BIOS 3000.'),
      row(['MIBO 2500', 'MIBO 3500'], 'required', 'Microbiology (one semester): MIBO 2500 with its lab MIBO 2500L, or MIBO 3500 with MIBO 3500L or MIBO 3510L.'),
      row(['MIBO 2500L', 'MIBO 3500L', 'MIBO 3510L'], 'required', 'The microbiology lab: MIBO 2500L with MIBO 2500; MIBO 3500L or MIBO 3510L with MIBO 3500.'),
      psychology('required'),
      abnormalPsychology('recommended'),
      medicalTerminology('recommended'),
      row(['BCMB 3100'], 'recommended', 'Biochemistry.'),
      row(['GENE 3200'], 'recommended', 'Genetics.'),
      row(['CHEM 2212'], 'recommended', 'Organic chemistry II (the guide names the lecture alone).', honors('CHEM 2212')),
    ],
    words: [],
    related: [],
    source: S.pa,
    note: `${HEALTH_NOTE} The guide says PA programs MAY require these and the list is not exhaustive; it suggests keeping a spreadsheet of target programs with deadlines, course requirements and health care experience requirements.`,
  },
  {
    id: 'pre-physical-therapy',
    name: 'Pre-physical therapy (DPT)',
    courses: [
      ...biology('required', undefined, false),
      ...biology('recommended').slice(2).map((r) => ({ ...r, why: `${r.why} The guide says BIOL 1108 with lab is required for most out-of-state programs.` })),
      ...generalChemistry('required'),
      ...physics('required', { named: false }),
      row(['STAT 2000'], 'required', 'Statistics.'),
      ...anatomyPhysiology('required'),
      psychology('required'),
      row(['SOCI 1101', 'ANTH 1102'], 'required', 'One behavioral science course: SOCI 1101 or ANTH 1102 are the ones the guide names (it says there are many other choices).'),
      medicalTerminology('recommended', 'Medical terminology: the guide says 43 PT programs in the United States require it.'),
      abnormalPsychology('recommended'),
      lifespan('recommended'),
      row(['NUTR 2100'], 'suggested', 'Fundamentals of Human Nutrition: the guide says only two PTCAS schools need it.'),
    ],
    words: [],
    related: [],
    source: S.pt,
    note: `${HEALTH_NOTE} The guide says PT programs MAY require these; check the PTCAS Summary of Prerequisite Courses for each program. Some PT programs accept AP credit for prerequisites; confirm with each one.`,
  },
  {
    id: 'pre-occupational-therapy',
    name: 'Pre-occupational therapy (OT)',
    courses: [
      ...anatomyPhysiology('required'),
      row(['PHYS 1111', 'PHYS 1211'], 'required', `Physics (one semester with lab); UGA lists the lab inside the course (PHYS 1111-1111L).${OTHER_PHYSICS}`),
      row(['STAT 2000'], 'required', 'Statistics.'),
      psychology('required'),
      abnormalPsychology('required'),
      lifespan('required'),
      medicalTerminology('required'),
      row(['ANTH 1102', 'SOCI 1101'], 'required', 'Anthropology or sociology: ANTH 1102 or SOCI 1101.'),
      row(['NUTR 2100'], 'required', 'Fundamentals of Human Nutrition.'),
    ],
    words: [],
    related: [],
    source: S.ot,
    note: `${HEALTH_NOTE} The guide says OT programs MAY require these and the list is not exhaustive. Its one list is what OT programs "typically include", so every row here is marked required.`,
  },
  {
    id: 'pre-optometry',
    name: 'Pre-optometry (OD)',
    courses: [
      ...generalChemistry('required'),
      ...organicOne('required'),
      ...biology('required'),
      ...physics('required'),
      ...english('required'),
      // "most schools also require or recommend one semester of anatomy,
      // physiology, biochemistry, microbiology, psychology, calculus, and statistics"
      row(['VPHY 3100', 'CBIO 3710', 'PMCY 4020', 'CBIO 2210'], 'recommended',
        'Physiology (one semester; the guide says physiology helps on the OAT): VPHY 3100, CBIO 3710 or PMCY 4020; or CBIO 2200 with CBIO 2210, which the guide says must both be taken to count for anatomy or physiology (CBIO 2210 follows CBIO 2200).'),
      row(['CBIO 3010', 'CBIO 3000'], 'recommended',
        'Anatomy (one semester, can come later in the plan): CBIO 3010 Functional Human Anatomy where a school requires vertebrate dissection, otherwise CBIO 3000 Comparative Vertebrate Anatomy; both are listed with their labs (CBIO 3010-3010L, CBIO 3000-3000L).'),
      row(['BCMB 3100'], 'recommended', "Biochemistry: most optometry schools require or recommend it; BCMB 3100 is the course PPAO's pre-med page names."),
      row(['MIBO 2500', 'MIBO 3500'], 'recommended', "Microbiology: MIBO 2500 or MIBO 3500, the courses PPAO's PA page names."),
      psychology('recommended'),
      row(['MATH 2250'], 'recommended', "Calculus: MATH 2250, the course PPAO's 2024 pre-med orientation names."),
      row(['STAT 2000', 'BIOS 2010'], 'recommended', "Statistics: STAT 2000 or BIOS 2010, as PPAO's pre-med page names."),
    ],
    words: [],
    related: [],
    source: S.optometry,
    note: `${HEALTH_NOTE} ${AP_NOTE} The guide points to ASCO's School and College Prerequisites list; students confirm with each school whether AP or online credit counts, and discuss how they will meet an anatomy and physiology requirement with the school before taking it.`,
  },
  {
    id: 'pre-veterinary',
    name: 'Pre-veterinary medicine (DVM)',
    courses: [
      ...biology('required'),
      ...generalChemistry('required'),
      ...organicOne('required'),
      ...organicTwo('required'),
      row(['BCMB 3100', 'BCMB 4020'], 'required', 'Biochemistry: BCMB 3100 or BCMB 4020 (BCMB 4020 follows BCMB 4010).'),
      ...english('required'),
      row(['CBIO 3000'], 'recommended', 'Anatomy: CBIO 3000 Comparative Vertebrate Anatomy (with its lab, CBIO 3000-3000L).'),
      row(['MIBO 3500', 'MIBO 3000', 'MIBO 2500'], 'recommended', 'Microbiology: MIBO 3500, MIBO 3000 (with lab, MIBO 3000-3000L) or MIBO 2500 with MIBO 2500L.'),
      row(['CBIO 3400'], 'recommended', 'Cell biology.'),
      row(['VPHY 3100', 'CBIO 3710'], 'recommended', `Physiology: VPHY 3100 or CBIO 3710. ${PMCY_3000}`),
      row(['GENE 3200'], 'recommended', 'Genetics.'),
      row(['CBIO 4100'], 'recommended', 'Immunology.'),
      psychology('recommended'),
    ],
    // The guide asks for at least 8 hours of 3000-level or higher biology
    // with general biology as a prerequisite (not behavior, production or
    // ecology courses); these are the subjects it recommends for them, and
    // each is a word in UGA course titles (physiology 86 titles, genetics 60,
    // microbiology 35, anatomy 32, immunology 16, cell biology 15).
    words: ['physiology', 'microbiology', 'immunology', 'genetics', 'cell biology', 'anatomy'],
    related: [],
    source: S.vet,
    note: `${HEALTH_NOTE} ${AP_NOTE} The UGA College of Veterinary Medicine accepts AP credit for prerequisites and electives when it is on the official college transcript. CAES Animal Health majors can apply to the UGA College of Veterinary Medicine after their third year. Physics is not on this general list; some schools ask for it, so check each one. The guide also asks for 8 hours of advanced biology (3000-level or higher, with general biology as a prerequisite; behavior, production and ecology courses do not count) and 14 hours of humanities or social studies; the planner does not count those hours, so check them with your advisor. ${PMCY_3000}`,
  },
  {
    id: 'pre-pharmacy',
    name: 'Pre-pharmacy (PharmD)',
    courses: [
      ...generalChemistry('required'),
      ...organicOne('required'),
      ...organicTwo('required'),
      row(['BCMB 3100', 'BCMB 4010'], 'required', 'Biochemistry: BCMB 3100 or BCMB 4010 (some sections have a lab; a lab is not required for admission).'),
      ...biology('required'),
      row(['MIBO 2500', 'MIBO 3000', 'MIBO 3500'], 'required', 'Microbiology: MIBO 2500, MIBO 3000 or MIBO 3500 (some sections have a lab; a lab is not required for admission).'),
      row(['PMCY 4050'], 'required', 'Human anatomy. At other schools, Anatomy & Physiology I and II (3 credits each) together are an accepted alternative.'),
      row(['PMCY 4020'], 'required', 'Human physiology.'),
      row(['MATH 2200', 'MATH 2250'], 'required', 'Calculus: MATH 2200 or MATH 2250.'),
      row(['STAT 2000', 'STAT 2100H'], 'required', 'Statistics: STAT 2000 or STAT 2100H.'),
      ...english('required'),
      row(['COMM 1110', 'COMM 1500', 'COMM 2150H', 'COMM 2550H'], 'required', 'Speech communication: COMM 1110, COMM 1500, COMM 2150H or COMM 2550H.'),
      row(['ECON 2105', 'ECON 2106', 'ECON 2105H', 'ECON 2106H'], 'required', 'Macroeconomics or microeconomics: ECON 2105 or ECON 2106 (or their honors versions).'),
    ],
    words: [],
    related: [],
    source: S.pharmacy,
    alsoSee: [S.pharmacyAdvising],
    note: "These are the UGA College of Pharmacy's own Pharm.D. prerequisites (updated June 2025), not a general list. They can be taken at any accredited institution; other schools of pharmacy set their own. Questions go to the College of Pharmacy's Pharm.D. admissions office. The Pharm.D. is a four-year professional program entered after these prerequisites. The list also asks for at least 69 pre-pharmacy hours (35 of them done when the student applies), 6 hours of social science and 9 of world language and culture (page 2 of the list names the subjects); the planner does not count those hours, so check them with your advisor. UGA's program pages print no hours for PMCY 4050, so the board counts the catalog's 3 for it; the Bulletin has the real number.",
  },
];
