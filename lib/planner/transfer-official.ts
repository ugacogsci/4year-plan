/**
 * What a university itself says about another school's course.
 *
 * transfer-match.ts guesses (a curated table, then titles). This file holds
 * only official answers and published rules, so matchTranscript can try
 * them first and fall back to a labelled guess only when there is none:
 *
 *   1. the document's own answer (a UGA record prints "HIST 1GHX" or "NTFR");
 *   2. the university's own table: UGA's Transfer Equivalency Search, read
 *      one sending school per file into public/uga-transfer/ (see
 *      scripts/data/uga-transfer.mjs); Illinois publishes none we may read
 *      (Transferology needs an account and refuses robots);
 *   3. published "no credit" rules: remedial courses, technical-college
 *      courses that are not general education (UGA), vocational courses
 *      (Illinois), physical education past one hour (UGA);
 *   4. otherwise hours, labelled "not yet evaluated".
 *
 * Every answer carries the page it came from, so the student can check it.
 */

export const UGA_TRANSFER_PORTAL = 'https://apply.uga.edu/portal/transfer-equivalency';
export const UGA_TRANSFER_GUIDE = 'https://transfer.uga.edu/wp-content/uploads/Transfer-Planning-Guide.pdf';
export const UGA_TRANSFER_FAQ = 'https://admissions.uga.edu/apply/transfer-applicants/transfer-faqs/';
export const ILLINOIS_TRANSFER_POLICIES = 'https://admissions.illinois.edu/transfer-admission-policies/';
export const ILLINOIS_TRANSFERRING_CREDIT = 'https://admissions.illinois.edu/transferring-credit/';

/** What a line became, why, and where that answer came from, for the review list. */
export interface TransferBasis {
  /** Whose answer: the document's own, the university's official list, a published rule, or none yet. */
  from: 'document' | 'official' | 'rule' | 'none';
  /** One badge per line. */
  badge: 'course' | 'core' | 'elective' | 'none' | 'not-evaluated';
  /** One plain sentence. */
  text: string;
  /** The page that says so. */
  source?: string | null;
  /** When that page was read, for a table the planner keeps a copy of. */
  checked?: string | null;
}

export interface UgaTransferIndexEntry {
  key: string;
  name: string;
  system: 'usg' | 'tcsg' | 'other';
  /** Lower-case words that identify the school on a transcript. */
  match: string[];
  /** Words that mean a different campus or school with a similar name ("chattanooga"). */
  not?: string[];
  readAt: string;
  rows: number;
  courses: number;
}

export interface UgaTransferIndex {
  source: string;
  note?: string;
  schools: UgaTransferIndexEntry[];
}

export interface UgaTransferSchool {
  school: string;
  key: string;
  system: 'usg' | 'tcsg' | 'other';
  source: string;
  readAt: string;
  /** Sending code with no space ("BIOL2107K") to UGA results ("BIOL 1107", "MATH 1GXX", "NTFR"). */
  courses: Record<string, string[]>;
}

/** The index and the school files a record needs, loaded together. */
export interface UgaTransferTable {
  index: UgaTransferIndex | null;
  schools: Record<string, UgaTransferSchool>;
}

/** A UGA designation: credit that is not one UGA course. */
export interface UgaDesignation {
  kind: 'core' | 'core-us-history' | 'elective' | 'none';
  subject: string | null;
  code: string;
}

/**
 * "MATH 1GXX" (core elective), "HIST 1GHX" (core elective that also meets the
 * U.S. history requirement), "ARTS 3TXX" (elective credit only) and "NTFR"
 * (does not transfer), as UGA's guide and equivalency list define them.
 */
export function ugaDesignation(raw: string | null | undefined): UgaDesignation | null {
  const code = String(raw ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!code) return null;
  if (/^NTFR\b/.test(code) || /NOT TRANSFERR?ABLE/.test(code)) return { kind: 'none', subject: null, code: 'NTFR' };
  // "SPAN 1G1X" is a core elective at a stated language level; "CHEM 1GXXL"
  // its lab; "FILM 2TXXW" a writing-intensive elective; "EDUC 6TXX" graduate.
  const m = code.match(/^([A-Z]{2,5}) ?(\d)(GHX|G[X0-9]X|TXX)([A-Z]?)$/);
  if (!m) return null;
  const kind = m[3] === 'GHX' ? 'core-us-history' : m[3].startsWith('G') ? 'core' : 'elective';
  return { kind, subject: m[1], code: `${m[1]} ${m[2]}${m[3]}${m[4]}` };
}

/**
 * The UGA core area a core elective in this subject usually fills. UGA's list
 * does not say, so the line says "usually" and asks the student to confirm.
 * Area names are the ones UGA's degree pages use.
 */
export function ugaCoreArea(subject: string | null): string | null {
  const s = subject ?? '';
  if (/^(ENGL)$/.test(s)) return 'I. Foundation Courses or IV. Humanities and the Arts';
  if (/^(MATH|STAT|MATS)$/.test(s)) return 'III. Quantitative Reasoning';
  if (/^(CHEM|PHYS|ASTR|GEOL|PHSC|ATSC|GEOG)$/.test(s)) return 'II. Physical Sciences';
  if (/^(BIOL|BIOS|ECOL|PBIO|GENE|CBIO|MIBO|ENTO|FANR|PLBI|PHYB)$/.test(s)) return 'II. Life Sciences';
  if (/^(HIST|POLS|PSYC|SOCI|ECON|ANTH|INTL|WMST|AFAM|CRJU)$/.test(s)) return 'V. Social Sciences';
  if (/^(SPAN|FREN|GRMN|ITAL|CHNS|JPNS|KREN|ARAB|RUSS|PORT|LATN|GREK|HEBR)$/.test(s)) return 'IV. World Languages and Global Culture';
  if (/^(ARTS|ARST|ARTH|ARTI|MUSI|THEA|FILM|PHIL|RELI|COMM|CMLT|CLAS|DANC|HUMN|ENGL)$/.test(s)) return 'IV. Humanities and the Arts';
  return null;
}

/** The index entry for a school named on a transcript, or null. */
export function ugaSchoolEntry(index: UgaTransferIndex | null | undefined, name: string | null | undefined): UgaTransferIndexEntry | null {
  if (!index || !name) return null;
  const n = name.toLowerCase().replace(/\s+/g, ' ');
  // Longest match first: "west georgia technical" before "west georgia".
  let best: UgaTransferIndexEntry | null = null;
  let bestLen = 0;
  for (const s of index.schools) {
    if ((s.not ?? []).some((word) => n.includes(word))) continue;
    for (const word of s.match) {
      if (n.includes(word) && word.length > bestLen) {
        best = s;
        bestLen = word.length;
      }
    }
  }
  return best;
}

/** UGA's own result(s) for a sending course, or null when its list has none. */
export function ugaLookup(
  table: UgaTransferTable | null | undefined,
  school: string | null | undefined,
  code: string,
): { entry: UgaTransferIndexEntry; file: UgaTransferSchool; results: string[] } | null {
  const entry = ugaSchoolEntry(table?.index, school);
  if (!entry) return null;
  const file = table?.schools[entry.key];
  if (!file) return null;
  const key = code.toUpperCase().replace(/\s+/g, '');
  const results = file.courses[key];
  return results && results.length > 0 ? { entry, file, results } : null;
}

/** Whether the sending school is a technical college (UGA takes only its general-education courses). */
export function isTechnicalCollege(name: string | null | undefined, entry?: UgaTransferIndexEntry | null): boolean {
  if (entry) return entry.system === 'tcsg';
  return /\btechnical college\b|\btechnical institute\b/i.test(name ?? '');
}

/**
 * A subject a technical college teaches as general education (the TCSG
 * courses that apply to the USG core): English, math, the sciences, the
 * social sciences, speech, the humanities.
 */
export function isGeneralEducationSubject(prefix: string): boolean {
  return /^(ENGL|MATH|STAT|HIST|POLS|PSYC|SOCI|ECON|BIOL|CHEM|PHYS|ASTR|GEOL|GEOG|SPCH|COMM|ARTS|ARTH|MUSC|MUSI|HUMN|PHIL|RELI|SPAN|FREN|ANTH|ENVS|LITR|THEA)$/.test(prefix);
}

/**
 * A physical activity course: the kind UGA counts for one hour at most. By
 * subject (UGA's PEDB, the common PE prefixes) or by an activity title.
 */
export function isPhysicalActivity(code: string, title: string | null): boolean {
  const prefix = code.split(' ')[0] ?? '';
  if (/^(PE|PED|PEDB|PEDH|PEAC|PHED|PEX|KPE|PEA)$/.test(prefix)) return true;
  return /\b(physical activity|physical education|weight training|weightlifting|tennis|golf|swimming|yoga|aerobics|fitness|jogging|bowling|racquetball|pilates|badminton|pickleball|karate|self[- ]defense)\b/i.test(title ?? '');
}

/**
 * Illinois: "remedial and vocational courses do not transfer" (its transfer
 * admission policies). Community colleges teach career programs under their
 * own prefixes; this is a short list of the clear ones, read as "probably
 * does not transfer" and always left for the student to change.
 */
export function isVocational(code: string, title: string | null): boolean {
  const prefix = code.split(' ')[0] ?? '';
  if (/^(AUT|AUTO|AUTB|ATT|WELD|WLD|HVAC|HVA|CCS|COS|COSM|CUL|CULA|CUA|BAR|BARB|DIES|DSL|MACH|MFG|CNC|CARP|PLMB|ELTR|ELT|TRK|TRUCK|FIRE|EMS|PHLB|MLT|DENT|DHY|SURG|HLTHS|CNA|AMT|COSMT|ESTH)$/.test(prefix)) return true;
  return /\b(automotive|welding|cosmetology|culinary|hvac|diesel|machining|barbering|phlebotomy|nursing assistant|medical terminology|truck driving|fire science|emergency medical)\b/i.test(title ?? '');
}

/**
 * UGA courses an equivalency list still names by an older number. UGA's own
 * lists show the change: the same statewide technical-college course, SPCH
 * 1101 Public Speaking, is COMM 1100 on 13 lists, SPCM 1100 on one and COMM
 * 1110 on eight, and COMM 1110 is the Introduction to Public Speaking in
 * UGA's current catalog. Used only when the old number is not in the
 * catalog and the new one is.
 */
export const UGA_RENUMBERED: Record<string, { now: string; title: string }> = {
  'COMM 1100': { now: 'COMM 1110', title: 'Introduction to Public Speaking' },
  'SPCM 1100': { now: 'COMM 1110', title: 'Introduction to Public Speaking' },
};

/** A D, as printed on a sending school's line ("D", "D+", "TD"). */
export function isDGrade(grade: string | null | undefined): boolean {
  return /^T?D[+-]?$/i.test(String(grade ?? '').trim());
}

let indexCache: Promise<UgaTransferIndex | null> | null = null;
const schoolCache = new Map<string, Promise<UgaTransferSchool | null>>();

/**
 * UGA's equivalency list for the schools a reading names, loaded in the
 * browser. Only the files for those schools are fetched; a school the
 * planner holds no list for simply has none.
 */
export async function loadUgaTransfer(names: Array<string | null | undefined>): Promise<UgaTransferTable> {
  if (!indexCache) {
    indexCache = fetch('/uga-transfer/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<UgaTransferIndex>) : null))
      .catch(() => {
        indexCache = null;
        return null;
      });
  }
  const index = await indexCache;
  const schools: Record<string, UgaTransferSchool> = {};
  if (!index) return { index: null, schools };
  const keys = new Set(names.map((n) => ugaSchoolEntry(index, n)?.key).filter((k): k is string => Boolean(k)));
  await Promise.all(
    [...keys].map(async (key) => {
      if (!schoolCache.has(key)) {
        schoolCache.set(
          key,
          fetch(`/uga-transfer/${key}.json`)
            .then((r) => (r.ok ? (r.json() as Promise<UgaTransferSchool>) : null))
            .catch(() => {
              schoolCache.delete(key);
              return null;
            }),
        );
      }
      const file = await schoolCache.get(key);
      if (file) schools[key] = file;
    }),
  );
  return { index, schools };
}
