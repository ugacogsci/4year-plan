/**
 * Which UGA courses run in which terms, as UGA's own Schedule of Classes
 * lists them: how many sections, how full, on which campus, and who teaches.
 *
 * scripts/uga/schedule-build.mjs reads the Registrar's Schedule of Classes
 * files (one per term, the newest five) into public/uga/course-offerings.json,
 * read here. A term is in the file only when its whole schedule was read, so
 * a course missing from a final or running term did not run that term; a
 * term missing from the file is unknown, never "not offered" (offeredIn says
 * null). An upcoming term is the schedule as posted so far: departments add
 * sections until classes begin, so a course missing from it is not offered
 * yet, and in a subject that has posted well under last year's sections
 * (stillPosting) not known yet (null again).
 *
 * Codes are the planner's own (lib/planner/uga-course-codes.ts):
 *   - the online, honors, writing-intensive and service-learning versions of
 *     a course ("MATH 2250E", "CSCI 1302H", "MATH 3200W", "ARED 2110S") are
 *     counted under the course itself, with each version's sections and
 *     instructors noted apart (versions);
 *   - a lab or discussion section the catalog books with its lecture
 *     ("PHYS 1111-1111L", "GENE 3200-3200D") is counted apart (parts), not as
 *     a section, a seat or an instructor of the course: students take both;
 *   - a lab the catalog lists as a course of its own ("CHEM 1211L") is one;
 *   - a code the catalog does not list stays as the schedule prints it and
 *     is named in notInCatalog.
 *
 * Numbers, per course per term, active sections only (cancelled and pending
 * ones left out):
 *   - enrolled is how many students the sections hold, summed; it is left
 *     out for a term whose registration has not opened (every section at 0).
 *     A term in session counts students on the day it was read, not its final total;
 *   - seats sums each section's enrollment limit; a section with no set limit
 *     (the schedule prints 999, as for thesis and research hours) is counted
 *     in noLimit instead;
 *   - instructors are each section's primary instructor ("First Last"), with
 *     how many sections each teaches; teaching assistants and co-instructors
 *     are not on the schedule. A section with no one named yet is unnamed;
 *   - individual marks a course whose every section is one the schedule
 *     stars as arranged one to one (directed study, research, thesis,
 *     internship, practicum): its instructors are the faculty who supervise.
 *     A graduate one (6000 and up: thesis, dissertation, research hours)
 *     keeps only how many supervise (supervisors), not their names;
 *   - campuses is left out when every section is on the Athens campus.
 *
 * Pure apart from loadUgaOfferings: __uga-offerings.check.mjs and the build
 * script run the same code over the shipped file.
 */
import { canonicalUgaCode, normUgaCode } from './uga-course-codes';

export const UGA_OFFERINGS_URL = '/uga/course-offerings.json';

/** UGA's main campus code on the schedule. */
export const MAIN_CAMPUS = 'ATH';

/** One person and how many sections they teach. */
export type InstructorCount = [name: string, sections: number];

export interface OfferingsTerm {
  /** "Fall 2026", as the schedule names it. */
  label: string;
  /** The Registrar's term code: "202608". */
  period: string;
  /**
   * final: over, or read from the Registrar's frozen final file;
   * in session: begun and not over on the day the file was read;
   * upcoming: not begun (the schedule can still change).
   */
  status: 'final' | 'in session' | 'upcoming';
  /** Where the term's schedule was read. */
  url: string;
  /** The day it was read, YYYY-MM-DD. */
  fetchedAt: string;
  /** Students enrolled across the term's sections; 0 while registration has not opened. */
  enrolled: number;
  courses: number;
  sections: number;
  instructors: number;
  /** Upcoming only: subjects with well under last year's sections posted so far. */
  stillPosting?: string[];
}

export interface VersionOffering {
  sections: number;
  instructors?: InstructorCount[];
}

export interface TermOffering {
  sections: number;
  /** Absent when the term's registration has not opened. */
  enrolled?: number;
  seats: number;
  noLimit?: number;
  /** Sections per campus code ("ATH", "ONL", "GWN"), names in UgaOfferingsFile.campuses; absent: all on the Athens campus. */
  campuses?: Record<string, number>;
  /** Most sections first; absent for a graduate one-to-one course (supervisors). */
  instructors?: InstructorCount[];
  /** How many faculty supervise a graduate one-to-one course's sections. */
  supervisors?: number;
  unnamed?: number;
  /** "E", "H", "W", "S": sections of each version, inside the course's own count. */
  versions?: Record<string, VersionOffering>;
  /** "L", "D": lab or discussion sections, outside the course's own count. */
  parts?: Record<string, number>;
  individual?: true;
}

export interface UgaOfferingsFile {
  school: 'uga';
  source: string;
  /** The Registrar's Schedule of Classes page, for a person to look at. */
  page: string;
  /** The day the newest term was read, YYYY-MM-DD. */
  collectedAt: string;
  /** Newest first. */
  terms: OfferingsTerm[];
  /** Campus code to the schedule's name for it. */
  campuses: Record<string, string>;
  /** Codes on the schedule that the planner's catalog does not list. */
  notInCatalog: string[];
  /**
   * Of those, the ones the schedule runs as one class with a catalog course
   * (a cross-listing): "ATSC 1112" -> "GEOG 1112". Absent in a file built
   * before 2026-10-28.
   */
  crossListed?: Record<string, string>;
  /** Each subject's name as the schedule prints it ("ENTR": "Entrepreneurship"); absent before 2026-10-28. */
  subjects?: Record<string, string>;
  courses: Record<string, Record<string, TermOffering>>;
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** Online, honors, writing-intensive and service-learning versions of one course. */
const VERSION = /^(\S+ \d{4})([EHWS])$/;
/** A lab or discussion section of a course the catalog books with its lecture. */
const PART = /^(\S+ \d{4})([LD])$/;

export interface OfferingKey {
  /** The code the file keeps the course under. */
  key: string;
  version?: string;
  part?: string;
}

/**
 * Where a schedule code is counted, given which codes the planner's catalog
 * books. Used by the build (known: the catalog) and by the lookups below
 * (known: the file's own courses), so both read a code the same way.
 */
export function offeringKeyOf(code: string, known: (code: string) => boolean): OfferingKey {
  const c = canonicalUgaCode(normUgaCode(code));
  const version = c.match(VERSION);
  if (version && known(version[1])) return { key: version[1], version: version[2] };
  if (known(c)) return { key: c };
  const part = c.match(PART);
  if (part && known(part[1])) return { key: part[1], part: part[2] };
  return { key: c };
}

const keyIn = (file: UgaOfferingsFile, code: string): OfferingKey => offeringKeyOf(code, (c) => Boolean(file.courses[c]));

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface CourseOfferings extends OfferingKey {
  /** Term label to what ran, newest term first; a term the course did not run in is absent. */
  byTerm: Record<string, TermOffering>;
}

/** Everything the schedule says about a course, or null when no term in the file lists it. */
export function offeringsFor(file: UgaOfferingsFile, code: string): CourseOfferings | null {
  const k = keyIn(file, code);
  const record = file.courses[k.key];
  if (!record) return null;
  const byTerm: Record<string, TermOffering> = {};
  for (const t of file.terms) if (record[t.label]) byTerm[t.label] = record[t.label];
  return { ...k, byTerm };
}

/** What ran in one term, narrowed to a version when the code names one ("MATH 2250E"). */
function ranIn(k: OfferingKey, offering: TermOffering | undefined): boolean {
  if (!offering) return false;
  if (k.version) return (offering.versions?.[k.version]?.sections ?? 0) > 0;
  if (k.part) return (offering.parts?.[k.part] ?? 0) > 0;
  return offering.sections > 0;
}

/**
 * Whether the course has a section in that term ("Spring 2027"): true when
 * the schedule lists one; false when it lists none; null for a term the file
 * does not cover, or an upcoming one whose departments are still posting the
 * course's subject.
 */
export function offeredIn(file: UgaOfferingsFile, code: string, termLabel: string): boolean | null {
  const term = file.terms.find((t) => t.label === termLabel);
  if (!term) return null;
  const k = keyIn(file, code);
  if (ranIn(k, file.courses[k.key]?.[termLabel])) return true;
  return term.stillPosting?.includes(k.key.split(' ')[0]) ? null : false;
}

/** The covered terms a course ran in, newest first. */
export function termsOffered(file: UgaOfferingsFile, code: string): string[] {
  const k = keyIn(file, code);
  const record = file.courses[k.key];
  return record ? file.terms.filter((t) => ranIn(k, record[t.label])).map((t) => t.label) : [];
}

export interface Enrollment {
  term: string;
  status: OfferingsTerm['status'];
  sections: number;
  enrolled: number;
  seats: number;
  noLimit: number;
}

/**
 * How full the course's sections are: in the term asked, or else the newest
 * term with enrollment counted that the course ran in. Null when there is
 * none (not run, or registration not open yet).
 */
export function enrollmentOf(file: UgaOfferingsFile, code: string, termLabel?: string): Enrollment | null {
  const k = keyIn(file, code);
  const record = file.courses[k.key];
  if (!record) return null;
  for (const t of file.terms) {
    if (termLabel && t.label !== termLabel) continue;
    const o = record[t.label];
    if (!o || o.enrolled === undefined) continue;
    return { term: t.label, status: t.status, sections: o.sections, enrolled: o.enrolled, seats: o.seats, noLimit: o.noLimit ?? 0 };
  }
  return null;
}

export interface InstructorOffering {
  name: string;
  sections: number;
  /** The terms they teach it in, newest first. */
  terms: string[];
}

/**
 * Who teaches the course: in one term, or across every term in the file
 * (sections summed). A version code ("MATH 2250E") answers for that version.
 * Most sections first, then the most recent.
 */
export function instructorsFor(file: UgaOfferingsFile, code: string, termLabel?: string): InstructorOffering[] {
  const k = keyIn(file, code);
  const record = file.courses[k.key];
  if (!record || k.part) return [];
  const out = new Map<string, InstructorOffering>();
  for (const t of file.terms) {
    if (termLabel && t.label !== termLabel) continue;
    const o = record[t.label];
    const list = k.version ? o?.versions?.[k.version]?.instructors : o?.instructors;
    for (const [name, sections] of list ?? []) {
      const hit = out.get(name);
      if (hit) {
        hit.sections += sections;
        hit.terms.push(t.label);
      } else out.set(name, { name, sections, terms: [t.label] });
    }
  }
  const newest = (i: InstructorOffering) => file.terms.findIndex((t) => t.label === i.terms[0]);
  return [...out.values()].sort((a, b) => b.sections - a.sections || newest(a) - newest(b) || a.name.localeCompare(b.name));
}

const SEASON_OF = /^(Fall|Spring|Summer) \d{4}$/;

/** The terms the file covers, oldest to newest: "Spring 2026 to Summer 2027". */
export function termSpan(file: UgaOfferingsFile): string {
  const terms = [...file.terms].sort((a, b) => a.period.localeCompare(b.period));
  return terms.length > 1 ? `${terms[0].label} to ${terms[terms.length - 1].label}` : (terms[0]?.label ?? '');
}

/**
 * The term students register for next: the earliest upcoming one (Spring 2027
 * while Fall 2026 is in session). Null when the file has none upcoming.
 */
export function nextRegistrationTerm(file: UgaOfferingsFile): string | null {
  const upcoming = file.terms.filter((t) => t.status === 'upcoming').sort((a, b) => a.period.localeCompare(b.period));
  return upcoming[0]?.label ?? null;
}

/**
 * The file's term that answers who teaches a course in a board term: that
 * term when the file covers it, else the newest of its season ("Fall 2027"
 * reads Fall 2026, labelled as such by the caller); with no term, the next
 * one students register for. Null when the file has no such term.
 */
export function scheduleTermFor(file: UgaOfferingsFile, termLabel: string | null): string | null {
  if (!termLabel) return nextRegistrationTerm(file);
  if (file.terms.some((t) => t.label === termLabel)) return termLabel;
  const season = termLabel.match(SEASON_OF)?.[1];
  return file.terms.find((t) => t.label.match(SEASON_OF)?.[1] === season)?.label ?? null;
}

/**
 * Students a year in each course: enrollment summed over the newest fall,
 * spring and summer whose registration has opened (Spring, Summer and Fall
 * 2026 in this file), keyed by the file's course code. What the planner's
 * free choices read as "commonly taken" (autoplan.ts freeChoiceSignals); a course
 * the schedule does not list is absent, not 0.
 */
export function takenPerYear(file: UgaOfferingsFile): Map<string, number> {
  const counted = new Map<string, string>();
  for (const t of file.terms) {
    const season = t.label.match(SEASON_OF)?.[1];
    if (!season || counted.has(season) || t.enrolled <= 0) continue;
    counted.set(season, t.label);
  }
  const out = new Map<string, number>();
  for (const [code, byTerm] of Object.entries(file.courses)) {
    let n = 0;
    let ran = false;
    for (const label of counted.values()) {
      n += byTerm[label]?.enrolled ?? 0;
      if ((byTerm[label]?.sections ?? 0) > 0) ran = true;
    }
    // A course with sections in those terms and no one in them is 0, not unknown: DIGI 3100's one
    // Fall 2026 section, no seats and no students, was a filler elective on 207 boards (2026-10-28).
    if (n > 0 || ran) out.set(code, n);
  }
  return out;
}

/**
 * The courses a student cannot simply sign up for: in every term the file
 * lists them, every section is one the schedule stars as arranged one to
 * one (TermOffering.individual: directed study, research, internships), or
 * the sections hold no seats and no students (a section posted with no
 * enrollment limit, DIGI 3100's in Fall 2026). A student arranges one with a
 * faculty member; it is never the planner's own pick for a list or an
 * elective (SWAH 3990 Directed Study in Swahili was a filler on 57 boards).
 */
export function arrangedOnly(file: UgaOfferingsFile): Set<string> {
  const out = new Set<string>();
  for (const [code, byTerm] of Object.entries(file.courses)) {
    const ran = Object.values(byTerm).filter((o) => o.sections > 0);
    const open = ran.some((o) => !o.individual && (o.seats > 0 || (o.noLimit ?? 0) > 0 || (o.enrolled ?? 0) > 0));
    if (ran.length > 0 && !open) out.add(code);
  }
  return out;
}

/**
 * The seasons each course has a section in, over every term in the file,
 * for the course and for each version that ran apart ("MATH 2250E"). A
 * course the file does not list has run in none of its terms.
 */
export function seasonsRun(file: UgaOfferingsFile): Map<string, Array<'Fall' | 'Spring' | 'Summer'>> {
  const out = new Map<string, Set<'Fall' | 'Spring' | 'Summer'>>();
  const add = (code: string, season: 'Fall' | 'Spring' | 'Summer') => {
    const set = out.get(code) ?? new Set();
    set.add(season);
    out.set(code, set);
  };
  for (const [code, byTerm] of Object.entries(file.courses)) {
    for (const [label, o] of Object.entries(byTerm)) {
      const season = label.match(SEASON_OF)?.[1] as 'Fall' | 'Spring' | 'Summer' | undefined;
      if (!season || o.sections <= 0) continue;
      add(code, season);
      for (const [version, v] of Object.entries(o.versions ?? {})) if (v.sections > 0) add(`${code}${version}`, season);
    }
  }
  return new Map([...out].map(([code, set]) => [code, [...set]]));
}

/** Whether any of the course's sections that term are on the Athens campus. */
export function onMainCampus(file: UgaOfferingsFile, code: string, termLabel: string): boolean {
  const o = file.courses[keyIn(file, code).key]?.[termLabel];
  if (!o || o.sections === 0) return false;
  return !o.campuses || (o.campuses[MAIN_CAMPUS] ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let pending: Promise<UgaOfferingsFile | null> | null = null;

/** The shipped file, fetched once; null when it could not be read (asked again next time). */
export function loadUgaOfferings(): Promise<UgaOfferingsFile | null> {
  if (!pending) {
    pending = fetch(UGA_OFFERINGS_URL)
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as UgaOfferingsFile;
        return Array.isArray(data.terms) && data.courses ? data : null;
      })
      .catch(() => null)
      .then((data) => {
        if (!data) pending = null;
        return data;
      });
  }
  return pending;
}
