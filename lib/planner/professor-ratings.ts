/**
 * What students say about a professor on Rate My Professors, for ALMA and ARCH.
 *
 * Cameron collected each school's public profile summaries
 * (data/ratemyprofessors/<school>.json, scripts/ratemyprofessors/collect.mjs);
 * scripts/professor-ratings/build.mjs keeps the rated ones in a small file per
 * school, public/<school>/professor-ratings.json, read here. A profile holds
 * numbers only: the overall rating (1-5), the difficulty (1-5), the percent
 * who would take the professor again and how many ratings there are. There is
 * no review text, no tags and no per-course breakdown: every number covers
 * all of a professor's courses. So nothing here can say what students wrote,
 * or how a professor answers email; the advisors are told to say so.
 *
 * Matching an ORION instructor (a syllabus's "Geoffrey Challen", a section's
 * "Challen, G", the student's "My instructor") to a profile puts precision
 * before recall: a rating on the wrong person is worse than none.
 *   - The last name must agree (accents, case, hyphens and spaces aside; a
 *     two-part last name may match either part), and so must the first name:
 *     the same name, a nickname of it ("Mike", "Michael"), one the other starts
 *     with (three letters at least: "Dan", "Daniel"), or a middle name used as
 *     the first. A first initial alone ("Challen, G") is never enough by itself.
 *   - The course's subject settles which profile it is. The departments a
 *     subject's instructors are listed under on the site are learned at build
 *     time from names that match exactly one profile (and, for Illinois, from
 *     the catalog's subject names): subjectDepartments.
 *   - One profile: taken on a full first name, unless the course's subject is
 *     known and the profile's department is not one of its own (then not
 *     sure). On a first initial alone, taken only when it is the one profile
 *     at the school with that last name and initial, the department fits, and
 *     the school's own grade history and syllabi name no other person with
 *     that last name and initial (sameInitial, set at build time: "Singh, G"
 *     is not Guarav Singh for sure while the school also has a Gagandeep Singh).
 *   - More than one profile: the one whose department fits the course, when
 *     exactly one does; otherwise "not sure which professor", never a guess.
 *   - Profiles of one person the site lists twice (the same first and last
 *     name, and the same department or one inside the other, such as
 *     "Engineering" and "Mechanical Engineering") were merged at build time,
 *     their numbers weighted by each profile's count of ratings.
 *
 * The consensus sentence (ratingConsensus) is deterministic, from these
 * thresholds:
 *   - under 5 ratings: "too few to say much", and nothing more;
 *   - 5-9 "only N", 10 or more "N";
 *   - overall 4.0+ rated highly, 3.5-3.9 rated well, 2.6-3.4 mixed, 2.5 or lower low;
 *   - difficulty 4.0+ hard, 3.0-3.9 moderately hard, 2.5-2.9 about average,
 *     under 2.5 on the easier side;
 *   - would take again: 80%+ "most", under 50% "fewer than half", else the
 *     percent alone; left out when the site shows none.
 * "Based on 196 student ratings, students rate Ada Lovelace 4.4 of 5 overall
 * (rated highly), difficulty 3.5 of 5 (moderately hard), and most (90%)
 * would take the professor again." The one caveat, that the ratings are
 * self-selected and cover all of a professor's courses, comes once per result
 * (RATINGS_CAVEAT), not once per professor.
 *
 * The owner's rule (2026-10-27): nothing the advisors or a student see names
 * the site or links a profile. The numbers are "student ratings"; the file
 * keeps each profile's link for the build and the checks alone.
 *
 * For a course, professor_ratings gives a rundown (professorRatingsResult): its
 * instructors with the terms a class schedule names them for (UGA's Schedule
 * of Classes, Illinois's published sections), those teaching the term it leads
 * with first, and the highest rated of them as the pick.
 *
 * Pure apart from loadProfessorRatings: __professor-ratings.check.mjs and the
 * build script run the same code over the shipped files.
 */
import { readInstructorName, type InstructorName } from './instructors';

export type RatingsSchool = 'uga' | 'illinois';

/** One rated profile, or one person's merged profiles. */
export interface RatedProfile {
  id: number;
  first: string;
  last: string;
  /** The department the site lists the profile under (its largest one, when merged). */
  dept: string;
  /** Overall, 1-5. */
  rating: number;
  /** Difficulty, 1-5. */
  difficulty: number;
  /** Percent who would take the professor again; null when the site shows none. */
  again: number | null;
  count: number;
  url: string;
  /** The person's other profiles, merged into this one. */
  merged?: Array<{ id: number; dept: string; count: number; url: string }>;
  /**
   * Other people the school's grade history or syllabi name with this last
   * name and first initial ("Gagandeep Singh" beside a profile "Guarav Singh"):
   * a first initial alone is then not this profile for sure. Set at build time.
   */
  sameInitial?: string[];
}

export interface ProfessorRatingsFile {
  source: 'Rate My Professors';
  school: RatingsSchool;
  schoolName: string;
  /** The day the profiles were collected, YYYY-MM-DD. */
  collectedAt: string;
  profiles: RatedProfile[];
  /** Course subject to the site departments its instructors are listed under. */
  subjectDepartments: Record<string, string[]>;
  /** How many syllabus instructors matched, when the file was built. */
  coverage?: Record<string, number>;
}

/** The raw profile as data/ratemyprofessors/<school>.json holds it (only what is read). */
export interface RawProfile {
  id: number;
  firstName: string;
  lastName: string;
  department: string | null;
  averageRating: number | null;
  averageDifficulty: number | null;
  ratingCount: number | null;
  wouldTakeAgainPercent: number | null;
  profileUrl: string;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const fold = (s: string) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'");
const collapse = (s: string) => fold(s).replace(/[^a-z]/g, '');
const SUFFIX = /^(?:jr|sr|ii|iii|iv|phd|md|dr|prof)$/;

/** The words of a name part, folded, with suffixes and titles taken off. */
function nameWords(s: string, splitHyphens: boolean): string[] {
  return fold(s)
    .replace(/[().,"“”]/g, ' ')
    .split(splitHyphens ? /[\s-]+/ : /\s+/)
    .map(collapse)
    .filter((w) => w && !SUFFIX.test(w));
}

/** The forms a last name can be matched on: whole, and each end of a two-part one. */
function lastForms(words: string[]): string[] {
  if (words.length === 0) return [];
  const whole = words.join('');
  // A part on its own ("Cruz" of "De La Cruz") only when it is three letters or more.
  const parts = words.length > 1 ? [words[words.length - 1], words[0]].filter((w) => w.length >= 3) : [];
  return [...new Set([whole, ...parts])].filter((w) => w.length >= 2);
}

/** Common English nicknames, each group one name. */
const NICKNAMES: string[][] = [
  ['robert', 'bob', 'rob', 'bobby', 'robbie'], ['william', 'bill', 'will', 'billy', 'liam'], ['james', 'jim', 'jimmy', 'jamie'],
  ['michael', 'mike', 'mickey'], ['thomas', 'tom', 'tommy'], ['richard', 'rick', 'dick', 'rich', 'ricky'],
  ['elizabeth', 'liz', 'beth', 'betsy', 'lizzie', 'betty', 'eliza'], ['katherine', 'kathy', 'kate', 'katie', 'kathryn', 'catherine', 'cathy', 'kat'],
  ['joseph', 'joe', 'joey'], ['charles', 'chuck', 'charlie'], ['edward', 'ed', 'eddie', 'ted'], ['anthony', 'tony'],
  ['margaret', 'peggy', 'maggie', 'meg'], ['andrew', 'andy', 'drew'], ['steven', 'stephen', 'steve'], ['nicholas', 'nick'],
  ['alexander', 'alex'], ['alexandra', 'alex', 'sasha'], ['daniel', 'dan', 'danny'], ['david', 'dave'], ['matthew', 'matt'],
  ['christopher', 'chris'], ['christine', 'christina', 'chris'], ['patrick', 'pat'], ['patricia', 'pat', 'trish', 'patty'],
  ['susan', 'sue', 'suzy'], ['deborah', 'debbie', 'deb', 'debra'], ['jennifer', 'jen', 'jenny'], ['samuel', 'sam'],
  ['samantha', 'sam'], ['benjamin', 'ben'], ['gregory', 'greg'], ['jeffrey', 'jeff'], ['kenneth', 'ken'], ['ronald', 'ron'],
  ['donald', 'don'], ['timothy', 'tim'], ['zachary', 'zach', 'zack'], ['frederick', 'fred'], ['lawrence', 'larry'],
  ['gerald', 'jerry'], ['raymond', 'ray'], ['douglas', 'doug'], ['philip', 'phillip', 'phil'], ['jacob', 'jake'],
  ['rebecca', 'becky'], ['victoria', 'vicky', 'tori'], ['theodore', 'ted', 'theo'], ['abigail', 'abby'], ['cynthia', 'cindy'],
  ['pamela', 'pam'], ['barbara', 'barb'], ['judith', 'judy'], ['sandra', 'sandy'], ['kimberly', 'kim'], ['jonathan', 'jon'],
  ['nathaniel', 'nathan', 'nate'], ['joshua', 'josh'], ['anthony', 'tony'], ['albert', 'al'], ['eugene', 'gene'], ['harold', 'harry'],
];
const NICK = new Map<string, Set<string>>();
for (const group of NICKNAMES) for (const n of group) NICK.set(n, new Set([...(NICK.get(n) ?? []), ...group]));

const nicknameOf = (a: string, b: string) => Boolean(NICK.get(a)?.has(b));
const startsTheOther = (a: string, b: string) => Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a));

/** A name as ORION has it, read for matching. */
export interface WantedName {
  display: string;
  /** Full given names (two letters or more), first one first. */
  given: string[];
  initial: string | null;
  lastForms: string[];
}

/** "Challen, G", "Geoffrey Challen", "Dr. Eric G. Shaffer" read for matching; null for "TBA" or a placeholder. */
export function wantedName(raw: string): WantedName | null {
  if (/^(?:not named|course outline)/i.test(String(raw ?? '').trim())) return null;
  const n = readInstructorName(raw);
  if (!n) return null;
  const words = n.display.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  const before = words.slice(0, -1);
  // "Thelma Sanders Bustle": the last name may be "Bustle" or "Sanders Bustle".
  const two = before.length >= 2 && !/^[A-Za-z]\.?$/.test(before[before.length - 1]) ? [before[before.length - 1], last] : null;
  const forms = new Set([...lastForms(nameWords(last, true)), ...(two ? [collapse(two.join(''))] : [])]);
  const given = before.map(collapse).filter((w) => w.length >= 2 && !SUFFIX.test(w));
  return { display: n.display, given, initial: n.initial, lastForms: [...forms] };
}

type Fit = 'exact' | 'near' | 'initial';

/** How well a profile's first name fits the wanted one, or null when it does not. */
function firstFit(w: WantedName, p: RatedProfile): Fit | null {
  const words = nameWords(p.first, false);
  const full = words.filter((x) => x.length >= 2);
  if (w.given.length === 0) {
    if (!w.initial) return null;
    return (words[0] ?? '').startsWith(w.initial) ? 'initial' : null;
  }
  if (full.length === 0) return words[0] && words[0] === w.given[0].charAt(0) ? 'initial' : null;
  if (w.given[0] === full[0]) return 'exact';
  if (w.given.some((g) => full.includes(g))) return 'near';
  if (nicknameOf(w.given[0], full[0]) || startsTheOther(w.given[0], full[0])) return 'near';
  return null;
}

function lastFits(w: WantedName, p: RatedProfile): boolean {
  const forms = lastForms(nameWords(p.last, true));
  return w.lastForms.some((f) => forms.includes(f));
}

/** Whether a profile's department is one of a course subject's own. */
export function departmentFits(file: ProfessorRatingsFile, subject: string | null, dept: string): boolean {
  if (!subject) return false;
  return (file.subjectDepartments[subject.toUpperCase()] ?? []).includes(dept);
}

export type ProfileMatch =
  | { status: 'found'; profile: RatedProfile; on: Fit }
  | { status: 'none' }
  | { status: 'unsure'; departments: string[]; why: string }
  | { status: 'needs_first_name' };

/**
 * The profile that is this person at this school, given the course's
 * subject when there is one. See the header for the rules.
 */
export function matchProfessor(file: ProfessorRatingsFile, raw: string, subject: string | null = null): ProfileMatch {
  const w = wantedName(raw);
  if (!w) return { status: 'none' };
  if (w.given.length === 0 && !w.initial) return { status: 'needs_first_name' };
  const subj = subject ? subject.toUpperCase() : null;
  let hits = file.profiles
    .filter((p) => lastFits(w, p))
    .map((p) => ({ p, on: firstFit(w, p) }))
    .filter((h): h is { p: RatedProfile; on: Fit } => h.on !== null);
  if (hits.length === 0) return { status: 'none' };
  if (hits.some((h) => h.on === 'exact')) hits = hits.filter((h) => h.on === 'exact');
  const known = Boolean(subj && (file.subjectDepartments[subj] ?? []).length > 0);
  const fits = (p: RatedProfile) => departmentFits(file, subj, p.dept) || (p.merged ?? []).some((m) => departmentFits(file, subj, m.dept));
  const departments = [...new Set(hits.map((h) => h.p.dept))];
  // A first initial alone ("Liu, Y") is someone else as often as not: only one profile at the school may fit it.
  if (w.given.length === 0 && hits.length > 1) return { status: 'unsure', departments, why: `Only a first initial is known, and ${hits.length} rated professors share it.` };
  if (hits.length === 1) {
    const [h] = hits;
    if (h.on === 'initial') {
      // "Singh, G" when the school also has a Gagandeep Singh: the one rated profile may be the other person.
      const others = w.given.length === 0 ? (h.p.sameInitial ?? []).filter((o) => wantedName(o)?.lastForms.some((f) => w.lastForms.includes(f))) : [];
      if (others.length > 0) return { status: 'unsure', departments, why: `Only a first initial is known, and the school's grade history or syllabi also name ${others.slice(0, 2).join(' and ')}${others.length > 2 ? ' and others' : ''} with that last name and initial.` };
      return fits(h.p) ? { status: 'found', profile: h.p, on: 'initial' } : { status: 'unsure', departments, why: 'Only a first initial is known, and the course does not confirm the department.' };
    }
    if (known && !fits(h.p)) return { status: 'unsure', departments, why: `The one rated professor with this name is listed under ${h.p.dept}, not a department this course's instructors are listed under.` };
    return { status: 'found', profile: h.p, on: h.on };
  }
  const fitting = hits.filter((h) => fits(h.p));
  if (fitting.length === 1) return { status: 'found', profile: fitting[0].p, on: fitting[0].on };
  return { status: 'unsure', departments, why: subj ? `${hits.length} rated professors could be this person and the course does not settle which.` : `${hits.length} rated professors could be this person; the course would settle which.` };
}

// ---------------------------------------------------------------------------
// The consensus, in words
// ---------------------------------------------------------------------------

export const TOO_FEW = 5;

const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/** The short words for a profile: "rated highly; classes rated moderately hard; most (82%) would take again". */
export function ratingWords(p: RatedProfile): string {
  if (p.count < TOO_FEW) return 'too few ratings to say much';
  const overall = p.rating >= 4 ? 'rated highly' : p.rating >= 3.5 ? 'rated well' : p.rating > 2.5 ? 'mixed ratings' : 'rated low';
  const hard = p.difficulty >= 4 ? 'hard' : p.difficulty >= 3 ? 'moderately hard' : p.difficulty >= 2.5 ? 'about average in difficulty' : 'on the easier side';
  const again = p.again === null ? null : p.again >= 80 ? `most (${p.again}%) would take again` : p.again < 50 ? `fewer than half (${p.again}%) would take again` : `${p.again}% would take again`;
  return [overall, `classes rated ${hard}`, ...(again ? [again] : [])].join('; ');
}

/** The one short caveat an answer gives, once, however many professors it names. */
export const RATINGS_CAVEAT = "Student ratings are self-selected and cover all of a professor's courses, not one course.";

/**
 * The consensus sentence, with the count: "Based on 46 student ratings,
 * students rate Ada Lovelace 4.4 of 5 overall (rated highly), difficulty 3.5
 * of 5 (moderately hard), and most (90%) would take the professor again." It
 * never names the site the ratings come from or links it, and leaves the
 * caveat to RATINGS_CAVEAT.
 */
export function ratingConsensus(p: RatedProfile): string {
  const name = `${p.first} ${p.last}`.replace(/\s+/g, ' ').trim();
  const n = p.count;
  if (n < TOO_FEW) return `Only ${n} student rating${n === 1 ? '' : 's'} of ${name}, too few to say much.`;
  const lead = n >= 10 ? `Based on ${n} student ratings` : `Based on only ${n} student ratings`;
  const overall = p.rating >= 4 ? 'rated highly' : p.rating >= 3.5 ? 'rated well' : p.rating > 2.5 ? 'mixed' : 'rated low';
  const hard =
    p.difficulty >= 4 ? 'hard' : p.difficulty >= 3 ? 'moderately hard' : p.difficulty >= 2.5 ? 'about average' : 'on the easier side';
  const again =
    p.again === null ? '' : p.again >= 80 ? `, and most (${p.again}%) would take the professor again` : p.again < 50 ? `, and fewer than half (${p.again}%) would take the professor again` : `, and ${p.again}% would take the professor again`;
  return `${lead}, students rate ${name} ${one(p.rating)} of 5 overall (${overall}), difficulty ${one(p.difficulty)} of 5 (${hard})${again}.`;
}

// ---------------------------------------------------------------------------
// What the tools return
// ---------------------------------------------------------------------------

const SCHOOL_SHORT: Record<RatingsSchool, string> = { uga: 'UGA', illinois: 'Illinois' };

export function ratingsNote(file: ProfessorRatingsFile): string {
  return `Student ratings, collected ${file.collectedAt}: self-selected, numbers only (overall 1-5, difficulty 1-5, percent who would take the professor again, how many ratings), each covering all of a professor's courses, with no comments or tags. Give them as the consensus of those student ratings, with the count, and the caveat at most once in the answer; never name or link where they come from, never add what students wrote, and for anything the numbers do not cover (email, office hours, exams, grading) say the ratings do not cover it.`;
}

function foundEntry(asked: string, m: Extract<ProfileMatch, { status: 'found' }>): Record<string, unknown> {
  const p = m.profile;
  return {
    asked,
    status: 'found',
    professor: `${p.first} ${p.last}`.replace(/\s+/g, ' ').trim(),
    listed_under: p.dept,
    ratings: p.count,
    overall: p.rating,
    difficulty: p.difficulty,
    would_take_again_percent: p.again,
    consensus: ratingConsensus(p),
    ...(m.on === 'initial' ? { matched_on: 'last name, first initial and the course department' } : {}),
  };
}

function entryFor(file: ProfessorRatingsFile, asked: string, name: string, subject: string | null): Record<string, unknown> {
  const m = matchProfessor(file, name, subject);
  if (m.status === 'found') return foundEntry(asked, m);
  if (m.status === 'unsure') return { asked, status: 'not sure which professor', could_be_listed_under: m.departments, why: m.why };
  if (m.status === 'needs_first_name') return { asked, status: 'needs a first name or the course', why: 'A last name alone could be several people.' };
  return { asked, status: 'no student ratings found', why: `No student ratings at ${SCHOOL_SHORT[file.school]} were found for this name; that says nothing about the professor.` };
}

/** What a class schedule says about a course's instructors, for professor_ratings' rundown. */
export interface CourseSchedule {
  /** Where it comes from and what it covers: "UGA's Schedule of Classes, Spring 2026 to Summer 2027". */
  source: string;
  /** The term the rundown leads with: the course's own on the board when the schedule has it, else the next one students register for. */
  term: string | null;
  /** Everyone it names for the course, as courseInstructors writes them, with the terms they teach it in, newest first. */
  teaches: ReadonlyArray<{ name: string; terms: readonly string[] }>;
}

/** How many of a course's instructors the rundown lists; the rest are counted. */
const RUNDOWN = 12;

/** Ratings enough for the pick to rest on when someone has them: "5.0 from 5 ratings" does not outrank "4.4 from 196". */
const SOLID = 10;

const isRated = (e: Record<string, unknown>, least = TOO_FEW) => e.status === 'found' && Number(e.ratings) >= least;

/** 10 ratings or more first, then 5 or more; higher overall first within each, then more ratings. */
const byRating = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Number(isRated(b, SOLID)) - Number(isRated(a, SOLID)) || Number(isRated(b)) - Number(isRated(a)) || Number(b.overall) - Number(a.overall) || Number(b.ratings) - Number(a.ratings);

/** Whether a name the student typed has the first name of one the course lists: the same, a nickname, or one the other starts. */
function sameFirst(a: InstructorName, b: InstructorName | null): boolean {
  if (!b) return false;
  if (!a.fullFirst || !b.fullFirst) return !a.initial || !b.initial || a.initial === b.initial;
  const x = collapse(a.display.split(' ')[0] ?? '');
  const y = collapse(b.display.split(' ')[0] ?? '');
  return x === y || nicknameOf(x, y) || startsTheOther(x, y);
}

/**
 * The pick for a course: the highest rated of those teaching it in the lead
 * term, or of all its instructors when none of those has 5 ratings, among
 * those with 10 ratings or more when anyone has them, else with 5 or more.
 * Null when no instructor has 5 ratings.
 */
function pickOf(code: string, lead: string | null, rows: ReadonlyArray<{ e: Record<string, unknown>; t: readonly string[] }>): { name: string; words: string } | null {
  const inLead = lead ? rows.filter((r) => r.t.includes(lead)) : [];
  const fromLead = inLead.some((r) => isRated(r.e));
  const pool = (fromLead ? inLead : rows).map((r) => r.e);
  const least = pool.some((e) => isRated(e, SOLID)) ? SOLID : TOO_FEW;
  const ranked = pool.filter((e) => isRated(e, least)).sort(byRating);
  const [best, next] = ranked;
  if (!best) return null;
  // Each by the course's own name for them ("asked"), as the schedule and the picker write it.
  const who = (e: Record<string, unknown>) => String(e.asked);
  const numbers = (e: Record<string, unknown>) => `${one(Number(e.overall))} of 5 overall from ${String(e.ratings)} ratings`;
  const among = fromLead
    ? ranked.length === 1 ? `${who(best)} is the one teaching ${code} in ${lead} with ${least} or more student ratings` : `Of those teaching ${code} in ${lead} with ${least} or more student ratings, ${who(best)} is rated highest`
    : `${inLead.length > 0 ? `No one teaching ${code} in ${lead} has ${TOO_FEW} or more student ratings; of its other instructors with ${least} or more, ` : `Of ${code}'s instructors with ${least} or more student ratings, `}${who(best)} is rated highest`;
  const level = next && one(Number(next.overall)) === one(Number(best.overall)) ? ` ${who(next)} is level (${numbers(next)}).` : '';
  return { name: who(best), words: `${among}: ${numbers(best)}.${level}` };
}

/**
 * professor_ratings: one professor by name, or every instructor of a course.
 * courseInstructors are the names the planner knows for the course (its
 * schedule's, its syllabi's, the student's choice); a last name the student
 * typed is read as the one of them it fits, when exactly one does.
 * alsoKnownAs are fuller forms of those names (Illinois's grade history), see
 * fullerName. With a course alone it is a rundown, most useful first: the
 * student's own instructor (chosen), those the schedule names for the lead
 * term, its other terms' instructors, then the syllabi's names, the best
 * rated first within each; and the pick (pickOf). A course no schedule term
 * and no syllabus names anyone for says so, rather than asking the student.
 */
export function professorRatingsResult(
  file: ProfessorRatingsFile | null,
  input: { name?: string | null; code?: string | null },
  courseInstructors: readonly string[] = [],
  alsoKnownAs: readonly string[] = [],
  options: { schedule?: CourseSchedule | null; chosen?: string | null } = {},
): Record<string, unknown> {
  const name = (input.name ?? '').trim();
  const code = (input.code ?? '').trim().toUpperCase().replace(/\s+/g, ' ') || null;
  if (!file) return { ok: false, reason: 'The student ratings for this school could not be loaded.' };
  if (!name && !code) return { ok: false, reason: "Give a professor's name, a course code, or both." };
  const subject = code ? (code.split(' ')[0] ?? null) : null;
  // Each instructor once, under the fuller name the planner holds, keeping the name as given for the schedule's terms.
  const given = new Map<string, string>();
  for (const n of courseInstructors) {
    const k = fullerName(n.trim(), alsoKnownAs);
    if (k && !given.has(k)) given.set(k, n.trim());
  }
  const known = [...given.keys()];
  const schedule = options.schedule ?? null;
  const termsOf = new Map((schedule?.teaches ?? []).map((t) => [t.name.trim(), [...t.terms]]));
  const termsFor = (k: string) => termsOf.get(given.get(k) ?? k) ?? [];
  const lead = schedule?.term ?? null;
  // No source links: the chat never names or links the site the ratings come from.
  const head = { ok: true, school: SCHOOL_SHORT[file.school], course: code, ...(schedule ? { schedule: schedule.source } : {}) };
  if (name) {
    const typed = readInstructorName(name);
    const fits = typed ? known.filter((k) => {
      const x = readInstructorName(k);
      return Boolean(x && x.last === typed.last && (!typed.initial || !x.initial || typed.initial === x.initial));
    }) : [];
    // "Challen" with CS 124: the course's own Geoffrey Challen.
    const fuller = fits.length === 1 && (!typed?.fullFirst) ? fits[0] : name;
    const entry = entryFor(file, name, fuller, subject);
    // The schedule's terms only for the course's own person: "Yan Liu" typed is not the course's Yi Liu.
    const terms = fits.length === 1 && typed && sameFirst(typed, readInstructorName(fits[0])) ? termsFor(fits[0]) : [];
    return { ...head, professors: [terms.length > 0 ? { ...entry, teaches: terms } : entry], caveat: RATINGS_CAVEAT, note: ratingsNote(file) };
  }
  if (known.length === 0) {
    return {
      ...head,
      professors: [],
      note: schedule
        ? `No one on ${schedule.source} teaches ${code}, and no syllabus names an instructor for it. Say so plainly: no instructor is scheduled, so there is no one to rate yet. Never ask the student to look an instructor up.`
        : `The planner knows no instructor for ${code}: ask the student which professor they mean.`,
    };
  }
  const mine = options.chosen?.trim() ? fullerName(options.chosen.trim(), alsoKnownAs) : null;
  const rows = known.map((k, i) => {
    const t = termsFor(k);
    const e = entryFor(file, k, k, subject);
    return { i, k, t, e: t.length > 0 ? { ...e, teaches: t } : e };
  });
  const group = (r: (typeof rows)[number]) => (r.k === mine ? 0 : lead && r.t.includes(lead) ? 1 : r.t.length > 0 ? 2 : 3);
  rows.sort((a, b) => group(a) - group(b) || Number(isRated(b.e)) - Number(isRated(a.e)) || (isRated(a.e) ? byRating(a.e, b.e) : 0) || a.i - b.i);
  const inLead = lead ? rows.filter((r) => r.t.includes(lead)).length : 0;
  const scheduled = rows.some((r) => r.t.length > 0);
  const scheduleNote = !schedule
    ? null
    : !scheduled
      ? `No one on ${schedule.source} teaches ${code}: these names are from its syllabi, not a term's schedule.`
      : lead && inLead === 0
        ? `No one on ${schedule.source} teaches ${code} in ${lead}; teaches gives the terms each instructor is scheduled for.`
        : null;
  const pick = code ? pickOf(code, lead, rows) : null;
  return {
    ...head,
    ...(lead ? { term: lead, teaching_that_term: inLead } : {}),
    ...(scheduleNote ? { schedule_note: scheduleNote } : {}),
    highest_rated: pick?.name ?? null,
    pick: pick?.words ?? `None of ${code}'s instructors has ${TOO_FEW} or more student ratings, so the ratings point to no one.`,
    professors: rows.slice(0, RUNDOWN).map((r) => r.e),
    ...(rows.length > RUNDOWN ? { more_instructors: rows.length - RUNDOWN } : {}),
    caveat: RATINGS_CAVEAT,
    note: ratingsNote(file),
  };
}

/**
 * "Challen, G" as a fuller name the planner also holds for the course (an
 * Illinois grade-history "Challen, Geoffrey"), when exactly one fits; else as it was.
 */
export function fullerName(raw: string, alsoKnownAs: readonly string[]): string {
  const w = readInstructorName(raw);
  if (!w || w.fullFirst) return raw;
  const fits = new Map<string, string>();
  for (const n of alsoKnownAs) {
    const r = readInstructorName(n);
    if (r && r.fullFirst && r.last === w.last && (!w.initial || r.initial === w.initial)) fits.set(r.display, n);
  }
  return fits.size === 1 ? [...fits.values()][0] : raw;
}

/** The ratings an instructor entry carries in course_syllabus and term_syllabi, or null when no profile is sure. */
export function instructorRatings(file: ProfessorRatingsFile, instructor: string, code: string, alsoKnownAs: readonly string[] = []): Record<string, unknown> | null {
  const subject = code.trim().toUpperCase().split(/\s+/)[0] ?? null;
  const m = matchProfessor(file, fullerName(instructor, alsoKnownAs), subject);
  if (m.status !== 'found') return null;
  const p = m.profile;
  return {
    ratings: p.count,
    ...(p.count >= TOO_FEW ? { overall: p.rating, difficulty: p.difficulty, would_take_again_percent: p.again } : {}),
    words: ratingWords(p),
  };
}

/**
 * A course_syllabus or term_syllabi result with student_ratings on each
 * instructor entry a profile surely matches, and one note saying what they
 * are. Entries with no sure profile are left as they were.
 */
export function withStudentRatings<T extends Record<string, unknown>>(
  result: T,
  file: ProfessorRatingsFile | null,
  code?: string,
  alsoKnownAs: (courseCode: string) => readonly string[] = () => [],
): T {
  if (!file || !result || result.ok === false) return result;
  let added = 0;
  const mark = (entries: unknown, courseCode: string) => {
    if (!Array.isArray(entries)) return entries;
    return entries.map((e) => {
      if (!e || typeof e !== 'object' || typeof (e as { instructor?: unknown }).instructor !== 'string') return e;
      const r = instructorRatings(file, (e as { instructor: string }).instructor, courseCode, alsoKnownAs(courseCode));
      if (!r) return e;
      added += 1;
      return { ...e, student_ratings: r };
    });
  };
  const out: Record<string, unknown> = { ...result };
  if (Array.isArray(out.by_instructor) && code) out.by_instructor = mark(out.by_instructor, code);
  if (Array.isArray(out.courses)) {
    out.courses = (out.courses as Array<Record<string, unknown>>).map((c) => (c && typeof c.code === 'string' && Array.isArray(c.instructors) ? { ...c, instructors: mark(c.instructors, c.code) } : c));
  }
  if (added === 0) return result;
  out.student_ratings_note = `${ratingsNote(file)} student_ratings appears only where the ratings surely belong to the instructor; words is the consensus to give, with the count. For more, call professor_ratings.`;
  return out as T;
}

// ---------------------------------------------------------------------------
// Building the file (scripts/professor-ratings/build.mjs)
// ---------------------------------------------------------------------------

const LANGUAGE = /^(?:french|spanish|german|italian|portuguese|russian|chinese|japanese|korean|arabic|hebrew|latin|greek)$/;

/** Whether two departments of one name are obviously one person's: the same, one inside the other, or a language beside "Languages". */
function sameField(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const inside = (s: string, t: string) => new RegExp(`(?:^|\\s)${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`).test(t);
  if (inside(x, y) || inside(y, x)) return true;
  const generic = (s: string) => /\blanguages?\b|\bromance\b/.test(s);
  return (generic(x) && LANGUAGE.test(y)) || (generic(y) && LANGUAGE.test(x));
}

const weighted = (parts: Array<{ v: number | null; n: number }>): number | null => {
  const have = parts.filter((p) => p.v !== null && p.v >= 0 && p.n > 0);
  const total = have.reduce((s, p) => s + p.n, 0);
  return total === 0 ? null : have.reduce((s, p) => s + (p.v as number) * p.n, 0) / total;
};

/** The rated profiles, one person's obvious duplicates merged. */
export function ratedProfiles(raw: readonly RawProfile[]): RatedProfile[] {
  const rated = raw.filter((p) => (p.ratingCount ?? 0) > 0 && p.averageRating !== null && p.averageDifficulty !== null && p.firstName && p.lastName);
  const groups: RawProfile[][] = [];
  const byName = new Map<string, RawProfile[][]>();
  for (const p of [...rated].sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0) || a.id - b.id)) {
    const key = `${collapse(p.firstName)}|${collapse(p.lastName)}`;
    const same = byName.get(key) ?? [];
    const g = same.find((members) => members.every((m) => sameField(m.department ?? '', p.department ?? '')));
    if (g) g.push(p);
    else {
      const fresh = [p];
      same.push(fresh);
      groups.push(fresh);
      byName.set(key, same);
    }
  }
  return groups.map((g) => {
    const [top, ...rest] = g;
    const parts = (f: (p: RawProfile) => number | null) => g.map((p) => ({ v: f(p), n: p.ratingCount ?? 0 }));
    const again = weighted(parts((p) => p.wouldTakeAgainPercent));
    return {
      id: top.id,
      // "Dr. Cynthia" as the site shows some names: the title is not the name.
      first: top.firstName.trim().replace(/^(?:dr|prof|professor)\.?\s+/i, ''),
      last: top.lastName.trim(),
      dept: (top.department ?? '').trim(),
      rating: Math.round((weighted(parts((p) => p.averageRating)) ?? 0) * 10) / 10,
      difficulty: Math.round((weighted(parts((p) => p.averageDifficulty)) ?? 0) * 10) / 10,
      again: again === null ? null : Math.round(again),
      count: g.reduce((s, p) => s + (p.ratingCount ?? 0), 0),
      url: top.profileUrl,
      ...(rest.length > 0 ? { merged: rest.map((p) => ({ id: p.id, dept: (p.department ?? '').trim(), count: p.ratingCount ?? 0, url: p.profileUrl })) } : {}),
    };
  });
}

/**
 * Course subject to departments, learned from instructor names that match
 * exactly one profile on an exact first and last name: a department counts
 * for a subject when at least two such people are listed under it and they
 * are a tenth of the subject's matches or more. namedBy, when given, adds a
 * department whose name the subject's own name or course titles match, for
 * every subject in allSubjects too (the catalog's).
 */
export function learnSubjectDepartments(
  profiles: readonly RatedProfile[],
  names: ReadonlyArray<{ subject: string; name: string }>,
  namedBy?: (subject: string, dept: string) => boolean,
  allSubjects: readonly string[] = [],
): Record<string, string[]> {
  const blank: ProfessorRatingsFile = { source: 'Rate My Professors', school: 'uga', schoolName: '', collectedAt: '', profiles: [...profiles], subjectDepartments: {} };
  const tally = new Map<string, Map<string, Set<number>>>();
  const seen = new Set<string>();
  for (const { subject, name } of names) {
    const subj = subject.toUpperCase();
    const w = wantedName(name);
    if (!w || w.given.length === 0) continue;
    const key = `${subj}|${w.given[0]}|${w.lastForms[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const exact = blank.profiles.filter((p) => lastFits(w, p) && firstFit(w, p) === 'exact');
    if (exact.length !== 1) continue;
    const m = tally.get(subj) ?? new Map<string, Set<number>>();
    m.set(exact[0].dept, (m.get(exact[0].dept) ?? new Set()).add(exact[0].id));
    tally.set(subj, m);
  }
  const depts = [...new Set(profiles.map((p) => p.dept).filter(Boolean))];
  const subjects = new Set([...tally.keys(), ...names.map((n) => n.subject.toUpperCase()), ...allSubjects.map((x) => x.toUpperCase())]);
  const out: Record<string, string[]> = {};
  for (const subj of [...subjects].sort()) {
    const m = tally.get(subj) ?? new Map<string, Set<number>>();
    const total = [...m.values()].reduce((s, v) => s + v.size, 0);
    const learned = [...m.entries()].filter(([, v]) => v.size >= 2 && v.size >= total * 0.1).sort((a, b) => b[1].size - a[1].size).map(([d]) => d);
    const named = namedBy ? depts.filter((d) => namedBy(subj, d)) : [];
    const all = [...new Set([...learned, ...named])];
    if (all.length > 0) out[subj] = all;
  }
  return out;
}

/**
 * Each profile with sameInitial: the people the school's own records (names,
 * from its grade history and syllabi) give a full first name that starts with
 * the profile's first initial, under its last name, and that is not the
 * profile's first name (firstFit). A profile none of them clash with is
 * returned without the field.
 */
export function markSameInitial(profiles: readonly RatedProfile[], names: readonly string[]): RatedProfile[] {
  const byLast = new Map<string, WantedName[]>();
  const seen = new Set<string>();
  for (const n of names) {
    const w = wantedName(n);
    if (!w || w.given.length === 0) continue;
    const key = `${w.given.join(' ')}|${w.lastForms.join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const f of w.lastForms) {
      const list = byLast.get(f) ?? [];
      list.push(w);
      byLast.set(f, list);
    }
  }
  return profiles.map((p) => {
    const { sameInitial: _old, ...rest } = p;
    const initial = nameWords(p.first, false)[0]?.charAt(0);
    if (!initial) return rest;
    const others = new Set<string>();
    for (const f of lastForms(nameWords(p.last, true))) {
      for (const q of byLast.get(f) ?? []) if (q.given[0].charAt(0) === initial && firstFit(q, p) === null) others.add(q.display);
    }
    return others.size > 0 ? { ...rest, sameInitial: [...others].sort() } : rest;
  });
}

// ---------------------------------------------------------------------------
// Loading (browser)
// ---------------------------------------------------------------------------

const cache = new Map<RatingsSchool, Promise<ProfessorRatingsFile | null>>();

/** public/<school>/professor-ratings.json, fetched once; null when it cannot be read. */
export function loadProfessorRatings(school: RatingsSchool): Promise<ProfessorRatingsFile | null> {
  let hit = cache.get(school);
  if (!hit) {
    hit = fetch(`/${school}/professor-ratings.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ProfessorRatingsFile>) : null))
      .catch(() => null);
    void hit.then((v) => { if (!v) cache.delete(school); });
    cache.set(school, hit);
  }
  return hit;
}
