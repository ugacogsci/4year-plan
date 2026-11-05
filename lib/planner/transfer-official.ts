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

import { loadUgaSisters, type UgaSisterTable } from './transfer-sisters';

export const UGA_TRANSFER_PORTAL = 'https://apply.uga.edu/portal/transfer-equivalency';
export const UGA_TRANSFER_GUIDE = 'https://transfer.uga.edu/wp-content/uploads/Transfer-Planning-Guide.pdf';
export const UGA_TRANSFER_FAQ = 'https://admissions.uga.edu/apply/transfer-applicants/transfer-faqs/';
export const ILLINOIS_TRANSFER_POLICIES = 'https://admissions.illinois.edu/transfer-admission-policies/';
export const ILLINOIS_TRANSFERRING_CREDIT = 'https://admissions.illinois.edu/transferring-credit/';
/** Illinois's Gen Ed office: IAI GECC courses are applied to campus gen eds course by course. */
export const ILLINOIS_GENED_TRANSFER = 'https://gened.illinois.edu/choosing/first-year-transfer-students/';
/** iTransfer: the Illinois A.A. carries the full GECC; the A.S. a modified one (two courses left for after transfer). */
export const IAI_ASSOCIATE_DEGREES = 'https://www.itransfer.org/about/';
/**
 * McHenry County College's UIUC transfer guide, one of the community colleges'
 * own guides: a completed GECC meets UIUC's lower-division campus gen eds
 * except Advanced Composition, Cultural Studies, language and Quantitative
 * Reasoning II. Not an illinois.edu page; the conservative reading of the
 * exceptions Illinois's own pages leave unstated.
 */
export const IAI_GECC_EXCEPTIONS_GUIDE = 'https://insidemcc.mchenry.edu/pubwebapp/uploadfile/transferguide/UIUCtrngd19.pdf';

/**
 * UGA Bulletin, Undergraduate Graduation Requirements: the core curriculum
 * was set up within the University System of Georgia to carry credit between
 * its schools, and every course completed in the core of any System school is
 * accepted and transferable to the others. Its legislative requirements: the
 * U.S. and Georgia history examination, exempted by HIST 2111, HIST 2112 or
 * HIST 3080H; the constitution examinations, which POLS 1101 exempts "if
 * taken in Georgia" (a POLS 1101 transferred from outside the state still
 * owes the Georgia constitution).
 */
export const UGA_GRADUATION_REQUIREMENTS = 'https://bulletin.uga.edu/UnivInfo/content/university-info-undergrad-graduation-requirements.html';
/**
 * The UGA Registrar's crosswalk of USG Core IMPACTS to UGA's current core
 * (read 2026-11-02): Mathematics & Quantitative Skills (MATH 1101, MATH 1113)
 * goes to Area I: Foundation Courses; Political Science: U.S. and Georgia
 * History & Constitution (HIST 2111, HIST 2112, POLS 1101) to Area V; Area III
 * Quantitative Reasoning takes CSCI 1301 and PHIL 2500 from the Technology,
 * Mathematics & Sciences domain; "UGA grants transfer credit in the most
 * appropriate core area".
 */
export const UGA_CORE_CROSSWALK = 'https://reg.uga.edu/wp-content/uploads/USG_Core_IMPACTS-UGA_Current_Core-Common_Courses_Crosswalk.pdf';
/**
 * USG Transfer Hub (read 2026-11-02): a course completed in a sending
 * school's Core IMPACTS domain gets full credit at another System school,
 * domain to domain rather than course to course; excess hours in a domain go
 * to a domain where the receiving school asks for more; Field of Study
 * courses keep full credit only while the student keeps the same major; and
 * Technical College System of Georgia courses transfer only as the USG-TCSG
 * articulation lists name them, with no system-wide rule beyond those.
 */
export const USG_TRANSFER_HUB = 'https://www.usg.edu/curriculum/transfer-hub/';

/**
 * A finished University System of Georgia core on a transfer record.
 *
 * 'complete': the record itself prints the core as completed ("Core
 * Curriculum Complete", "Core IMPACTS Completed", "Core Areas A-E Complete")
 * and the school is a USG school, so UGA's Areas I to V are met: full credit
 * domain to domain (USG_TRANSFER_HUB), every completed core course accepted
 * (UGA_GRADUATION_REQUIREMENTS), the domains landing in UGA's areas
 * (UGA_CORE_CROSSWALK). Area VI, the major's own courses, stays course by
 * course: Field of Study credit holds only for the same major.
 *
 * 'confirm': a USG associate degree printed without a core notation. No page
 * this planner may read says an associate degree is the completed core, so
 * the board keeps the areas course by course and says how to confirm it.
 *
 * Never for a technical college or a school outside the USG: the area-to-area
 * rule is the System's own (a technical college's courses count only as
 * UGA's list names them, course by course).
 */
export interface UsgCoreCompletion {
  status: 'complete' | 'confirm';
  /** The record's own words. */
  evidence: string;
  school: string;
  /** One plain paragraph for the record's notes and the core areas' rows. */
  text: string;
  sources: string[];
}

/** Read a USG core completion from the credentials a transfer record prints. */
export function usgCoreCompletion(
  credentials: string[] | null | undefined,
  school: string | null | undefined,
  index: UgaTransferIndex | null | undefined,
): UsgCoreCompletion | null {
  const entry = ugaSchoolEntry(index, school);
  if (!entry || entry.system !== 'usg' || !school) return null;
  const unfinished = /\b(not|in progress|incomplete|partial(ly)?|pending|remaining|expected|anticipated|candidate|pursuing|working toward|needed)\b/i;
  let confirm: string | null = null;
  for (const raw of credentials ?? []) {
    const text = raw.trim();
    if (!text || unfinished.test(text)) continue;
    if (/\bcore\b/i.test(text) && /\b(complete[ds]?|completion|satisfied|fulfilled|met)\b/i.test(text)) {
      return {
        status: 'complete',
        evidence: text,
        school: entry.name,
        text: `Your ${entry.name} record shows your core curriculum completed ("${text}"). Within the University System of Georgia a completed core earns full credit at the next school, area to area, so UGA's core Areas I to V count as met and the plan books no course for them. Area VI and your major's own courses are still checked course by course (System credit for them holds only in the same major), and so are UGA's U.S. history and constitution requirements. UGA's evaluation after admission decides.`,
        sources: [USG_TRANSFER_HUB, UGA_GRADUATION_REQUIREMENTS, UGA_CORE_CROSSWALK],
      };
    }
    if (!confirm && !/\bapplied\b/i.test(text) && /\bassociate (in|of) (arts|science)\b|^a\.? ?[as]\.?(\s|$)/i.test(text)) confirm = text;
  }
  if (!confirm) return null;
  return {
    status: 'confirm',
    evidence: confirm,
    school: entry.name,
    text: `Your ${entry.name} record shows "${confirm}" but does not say your core curriculum is complete. If your transcript or UGA's evaluation says it is, UGA counts its core Areas I to V as met (a completed University System core earns full credit area to area); until then the plan checks each core area course by course.`,
    sources: [USG_TRANSFER_HUB, UGA_GRADUATION_REQUIREMENTS],
  };
}

/** What a line became, why, and where that answer came from, for the review list. */
export interface TransferBasis {
  /**
   * Whose answer: the document's own, the university's official list, UGA's
   * lists for the same course number at sister schools (transfer-sisters.ts),
   * a published rule, or none yet.
   */
  from: 'document' | 'official' | 'sisters' | 'rule' | 'none';
  /** One badge per line. */
  badge: 'course' | 'core' | 'elective' | 'none' | 'not-evaluated';
  /** One plain sentence. */
  text: string;
  /** The page that says so. */
  source?: string | null;
  /** When that page was read, for a table the planner keeps a copy of. */
  checked?: string | null;
  /** The sister schools whose UGA lists gave a 'sisters' answer, every one of them (the text names a few). */
  schools?: string[];
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
  /** UGA's answers at sister schools for the groups the record's schools belong to (transfer-sisters.ts). */
  sisters?: UgaSisterTable | null;
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
 * planner holds no list for simply has none. The sister-school answers for
 * the groups those schools belong to come with them (transfer-sisters.ts);
 * when they cannot be loaded, the record is matched without them.
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
  const sisters = await loadUgaSisters(names, (n) => ugaSchoolEntry(index, n)).catch(() => null);
  return { index, schools, sisters };
}
