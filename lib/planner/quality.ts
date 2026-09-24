/**
 * How good a course is for one student, in one number and in words.
 *
 * Five measures, each 0 to 1 or unknown, each weighted by the student's own
 * priorities, averaged over the measures that are known. A measure the data
 * cannot speak to is left out of the average and named in `unknown`, never
 * filled in with a middle value: a course with no grade history is not a
 * medium-difficulty course, it is a course whose difficulty nobody here can
 * state, and the two must not sort the same.
 *
 * The five:
 *   workload   from the registrar's grade history: difficulty, withdrawals
 *   teaching   from the university's own Teachers Ranked as Excellent lists:
 *              whether this course's instructors made it recently, and whether
 *              one of them is teaching it in the crawled term
 *   relevance  the student's own words against the course's subject and title
 *   coverage   a general education category the course also carries
 *   schedule   sections this term, at hours and in a format the student wants
 *
 * Every number here is a statement about the past or about a catalog page,
 * and the reason strings say which, so a card can show them as they are.
 */
import type { Priorities } from './priorities';
import { ILLINOIS_SUBJECT_NAMES } from './illinois-subjects';

export interface ExcellentInstructor {
  /** As the section crawl spells it: "Alt, M". */
  name: string;
  /** Terms ranked, newest first: "sp2025". */
  terms: string[];
  outstanding: boolean;
  ta: boolean;
}

/** One course's history on the Teachers Ranked as Excellent lists. */
export interface ExcellentSummary {
  /** Terms in which any instructor of this course made the list, newest first. */
  terms: string[];
  instructors: ExcellentInstructor[];
}

export interface QualityCourse {
  code: string;
  title: string;
  cluster: string;
  tags: string[];
  credits: number;
}

/**
 * Words a student writes that name no field. "I'm studying computer science
 * in Grainger and want a job after" has one interest word in it, computer,
 * and every other word here matched a department by accident: science took
 * in Speech and Hearing Science, Information Sciences and Health Sciences,
 * which is how a computer science student's first elective slot was offered
 * Communication and Aging as "a subject you said you want".
 */
export const INTEREST_STOPWORDS = new Set([
  'about', 'after', 'again', 'along', 'already', 'always', 'anything', 'around', 'because', 'before', 'being',
  'between', 'career', 'careers', 'class', 'classes', 'college', 'course', 'courses', 'credit', 'credits',
  'currently', 'declared', 'degree', 'doing', 'double', 'field', 'fields', 'finish', 'first', 'freshman',
  'general', 'going', 'graduate', 'graduating', 'grainger', 'having', 'honestly', 'hours', 'illinois',
  'interested', 'interests', 'intro', 'introduction', 'junior', 'later', 'learn', 'learning', 'liberal',
  'major', 'majors', 'maybe', 'minor', 'minors', 'money', 'other', 'people', 'pretty', 'probably',
  'program', 'programs', 'really', 'school', 'schools', 'science', 'sciences', 'semester', 'semesters',
  'senior', 'should', 'since', 'something', 'sophomore', 'sounds', 'still', 'student', 'studies', 'study',
  'studying', 'stuff', 'taken', 'taking', 'their', 'there', 'these', 'thing', 'things', 'think', 'thinking',
  'those', 'though', 'through', 'torn', 'transfer', 'university', 'urbana', 'which', 'while', 'working',
  'would', 'years',
]);

/** The words in what a student wrote that could name a field or a topic. */
export function interestWordsFrom(text: string | undefined): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5 && !INTEREST_STOPWORDS.has(w));
}

/** "ALVARADO, N" as the section crawl shouts it, printed as a name. */
export function prettyName(name: string): string {
  const spaced = name.replace(/,(\S)/, ', $1');
  if (spaced !== spaced.toUpperCase()) return spaced;
  return spaced.replace(/[A-Z][A-Z'-]*/g, (w) => (w.length === 1 ? w : w[0] + w.slice(1).toLowerCase()));
}

export interface QualityInputs {
  priorities: Priorities;
  /** Lower-cased words from what the student said they study and want. */
  interestWords: string[];
  /** The subject the degree is in, and the subjects it draws on. */
  primarySubject: string | null;
  degreeSubjects: Set<string>;
  /** General education categories the plan still needs, by catalog tag. */
  wantedTags: Set<string>;
  /**
   * What lib/planner/career-tracks.ts recognised in the student's words:
   * title words checked against the catalog (short ones like "ux" and "law"
   * included), subjects that are about the topic as a whole, and the courses
   * a student with that goal should see first.
   */
  curatedWords?: string[];
  interestSubjects?: Set<string>;
  interestCourses?: Set<string>;
  grades?: Map<string, { difficulty: number | null; withdrawPct: number | null }>;
  bands?: { typical: number; harder: number; hardest: number } | null;
  sections?: Map<string, {
    total: number;
    earliest: string | null;
    onlineOnly: boolean;
    instructors: Array<{ name: string; sections?: number }>;
    /** Distinct meeting signatures per section type ("MWF@540-590;M@1080-1190", "ARR"), when the build has them. */
    meet?: Record<string, string[]>;
    /** Every section type has a section starting at 9 a.m. or later (or with no set time). */
    lateOption?: boolean;
  }>;
  excellent?: Map<string, ExcellentSummary>;
  /** Terms covered by the excellent lists, newest first, so "recent" has a meaning. */
  excellentTerms?: string[];
  /** The term the sections were crawled for, "Fall 2026", so a reason can name it. */
  nowLabel?: string | null;
}

export interface QualityResult {
  /** 0 to 1 over the known measures; 0 when nothing is known and nothing is asked. */
  score: number;
  /** How many weighted measures had data. Ties break toward more evidence. */
  known: number;
  reasons: string[];
  unknown: string[];
  /**
   * What counts against the course under the student's priorities, kept apart
   * from `reasons` so a list headed "Chosen for" never says "hardest band by
   * grade history" about a course picked for a student who asked for balance.
   */
  cautions?: string[];
  /**
   * A clash with something the student said outright: online only when they
   * asked for in person, no section inside the hours or days they gave. A
   * pick weighs these far more than a preference, because the student cannot
   * register around them.
   */
  conflicts?: string[];
  /** The relevance knob's weight when the course matches what the student said they want, else 0. */
  interest?: number;
}

/**
 * Words that name a field so broadly that one of them alone says little:
 * "physical" pulled Physical Meteorology into a pre-PT plan, "research" a
 * research-methods course into a machine-learning one, "company" reached
 * Comparative Literature through a five-letter stem. They count in a title
 * only beside another word the student said, and never name a whole subject.
 */
const LOW_INFORMATION = new Set([
  'research', 'physical', 'change', 'public', 'experience', 'company', 'management', 'design', 'policy', 'health',
  'writing', 'science', 'systems', 'system', 'development', 'business', 'social', 'global', 'international', 'modern',
  'theory', 'practice', 'analysis', 'introduction', 'advanced', 'special', 'topics', 'human', 'world', 'culture',
]);

const escapeWord = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a word the student said names a subject: a whole word of the
 * department's name, or the first six or more letters of one. Substring
 * matching made "mental" name Environmental Studies and "company"
 * Comparative Literature; search keeps its looser matcher, this is only for
 * ranking a student's picks.
 */
function namesSubject(cluster: string, word: string): boolean {
  if (LOW_INFORMATION.has(word)) return false;
  const name = (ILLINOIS_SUBJECT_NAMES[cluster] ?? '').toLowerCase();
  const stem = word.slice(0, Math.max(6, word.length - 3));
  return name.split(/[^a-z]+/).some((part) => part === word || (part.length >= 6 && part.startsWith(stem) && stem.length >= 6));
}

/**
 * Whether one registration fits a student's time window: for every section
 * type some section whose meetings all start at or after `notBefore`, end by
 * `notAfter` and avoid the free days. A section with no set time ("ARR",
 * online and asynchronous) always fits. Null when the build carries no
 * meeting data for the course.
 */
export function registrationFits(
  meet: Record<string, string[]> | undefined,
  want: { notBefore?: number | null; notAfter?: number | null; freeDays?: string[] },
): boolean | null {
  if (!meet) return null;
  const entries = Object.entries(meet);
  if (entries.length === 0) return null;
  const free = new Set(want.freeDays ?? []);
  const fits = (signature: string): boolean =>
    signature === 'ARR' ||
    signature.split(';').every((meeting) => {
      const m = meeting.match(/^([A-Z]*)@(\d+)-(\d+)$/);
      if (!m) return true;
      const [, days, start, end] = m;
      if (want.notBefore != null && Number(start) < want.notBefore) return false;
      if (want.notAfter != null && Number(end) > want.notAfter) return false;
      return !days.split('').some((d) => free.has(d));
    });
  /**
   * An "Online" section type is another way to take the course, not a part
   * of every registration: ECON 490 runs in-person Lecture-Discussion
   * sections and one Online section, and a student takes one or the other.
   * The in-person path fits when every other type has a fitting section.
   */
  const online = entries.filter(([type]) => /online/i.test(type)).map(([, signatures]) => signatures);
  const inPerson = entries.filter(([type]) => !/online/i.test(type)).map(([, signatures]) => signatures);
  const inPersonFits = inPerson.length > 0 && inPerson.every((signatures) => signatures.some(fits));
  return inPersonFits || online.some((signatures) => signatures.some(fits));
}

/** "9:00AM" -> 540. Null for anything else. */
export function minutesOfDay(clock: string | null | undefined): number | null {
  const m = (clock ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(m[2]);
}

/** "sp2025" -> "Spring 2025". */
export function termWord(term: string): string {
  const m = term.match(/^(sp|su|fa|wi)(\d{4})$/);
  if (!m) return term;
  return `${{ sp: 'Spring', su: 'Summer', fa: 'Fall', wi: 'Winter' }[m[1]]} ${m[2]}`;
}

const normName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z, ]/g, '').replace(/\s+/g, ' ').trim();

/** Whether a section instructor ("Solomon, B") is one the excellent list names ("Solomon,B"). */
export function sameInstructor(a: string, b: string): boolean {
  const [la, fa] = normName(a).split(',').map((s) => s.trim());
  const [lb, fb] = normName(b).split(',').map((s) => s.trim());
  if (!la || !lb || la !== lb) return false;
  if (!fa || !fb) return true;
  return fa[0] === fb[0];
}

export function scoreQuality(course: QualityCourse, q: QualityInputs): QualityResult {
  const p = q.priorities;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const conflicts: string[] = [];
  const unknown: string[] = [];
  let weighted = 0;
  let weightSum = 0;
  let known = 0;
  const take = (weight: 0 | 1 | 2, value: number | null, name: string) => {
    if (weight === 0) return;
    if (value === null) { unknown.push(name); return; }
    weighted += weight * value;
    weightSum += weight;
    known += 1;
  };
  const code = course.code;

  // workload: grade history is the registrar's, and it is about the past.
  const g = q.grades?.get(code);
  if (p.workload > 0) {
    /**
     * Scaled to this school's own bands. Illinois difficulty runs from about 4
     * to 46 for nineteen courses in twenty, so 1 - d/100 put the lightest and
     * the hardest course 0.42 apart, and "I want easy classes" at double
     * weight moved plans less than the teaching measure did at single weight.
     * Against 1.2 times the hardest band a light course scores about 0.94 and
     * a hardest-band course under 0.1.
     */
    const top = 1.2 * (q.bands?.hardest ?? 40);
    if (g && g.difficulty !== null) {
      let v = Math.max(0, Math.min(1, 1 - g.difficulty / top));
      const w = g.withdrawPct ?? 0;
      if (w >= 8) { v = Math.max(0, v - Math.min(0.3, (w - 8) / 40)); }
      const band = q.bands;
      const word = band
        ? g.difficulty >= band.hardest ? 'hardest band' : g.difficulty >= band.harder ? 'harder than most' : g.difficulty <= band.typical ? 'light' : 'typical'
        : `difficulty ${Math.round(g.difficulty)}`;
      const line = `${word} by grade history (difficulty ${Math.round(g.difficulty)} of 100${w >= 8 ? `, ${Math.round(w)}% withdrew` : ''})`;
      if (band && g.difficulty >= band.harder) cautions.push(line);
      else reasons.push(line);
      take(p.workload, v, 'grade history');
    } else {
      /**
       * No grade history is not a light course. Leaving the measure out gave
       * the course the average of its other measures, so an ungraded course
       * with a well-liked instructor outranked a graded light one for a
       * student who asked for light. It is weighed at the harder band and
       * still listed as unknown.
       */
      const v = Math.max(0, 1 - (q.bands?.harder ?? 28) / top);
      weighted += p.workload * v;
      weightSum += p.workload;
      unknown.push('grade history');
    }
  }

  // teaching: the university's own list, and whether one of those instructors runs it this term.
  if (p.teaching > 0) {
    if (q.excellent && q.excellentTerms && q.excellentTerms.length > 0) {
      const ex = q.excellent.get(code);
      // The last four regular terms. Summer lists name about sixty courses
      // against a thousand in a fall or spring, and counting them as recent
      // terms shortened the window without saying so.
      const recent = q.excellentTerms.filter((t) => !t.startsWith('su')).slice(0, 4);
      // A term counts in full when an instructor made the list and half when
      // only a teaching assistant did: the same list, but a TA runs the
      // discussion section and not the course.
      const byInstructor = new Set(ex ? ex.instructors.filter((i) => !i.ta).flatMap((i) => i.terms) : []);
      const hits = ex ? ex.terms.filter((t) => recent.includes(t)) : [];
      const full = hits.filter((t) => byInstructor.has(t)).length;
      const taOnly = hits.length - full;
      let v = Math.min(1, (full + 0.5 * taOnly) / 3) * 0.7;
      const thisTerm = ex && q.sections?.get(code)
        ? ex.instructors.filter((i) => q.sections!.get(code)!.instructors.some((s) => sameInstructor(s.name, i.name)))
        : [];
      if (thisTerm.length > 0) {
        // Weighted by the share of sections those instructors teach: one
        // listed instructor among 43 CHEM 101 instructors is not "the course
        // is taught by an excellent instructor".
        const rows = q.sections!.get(code)!.instructors;
        const all = rows.reduce((n, r) => n + (r.sections ?? 1), 0);
        const listed = rows.filter((r) => thisTerm.some((i) => sameInstructor(r.name, i.name))).reduce((n, r) => n + (r.sections ?? 1), 0);
        const share = all > 0 ? Math.min(1, listed / all) : 1;
        v = Math.max(v, 0.85 * share + (1 - share) * v);
        const one = thisTerm[0];
        reasons.push(`${prettyName(one.name)} ranked ${one.outstanding ? 'outstanding' : 'excellent'} by students in ${termWord(one.terms[0])} and is teaching it${q.nowLabel ? ` in ${q.nowLabel}` : ' this term'}${share < 1 ? ` (${listed} of ${all} sections)` : ''}`);
      } else if (hits.length > 0) {
        const who = full > 0 ? 'instructors' : 'teaching assistants';
        reasons.push(`${who} ranked excellent by students in ${hits.length === 1 ? termWord(hits[0]) : `${hits.length} of the last ${recent.length} terms`}`);
      }
      take(p.teaching, v, 'teaching ratings');
    } else {
      take(p.teaching, null, 'teaching ratings');
    }
  }

  // relevance: the student's words against courses, titles and subjects; the degree's own subjects count too.
  let interest = 0;
  if (p.relevance > 0) {
    let v = 0;
    const title = course.title.toLowerCase();
    const free = q.interestWords.filter((w) => w.length >= 5 && !INTEREST_STOPWORDS.has(w));
    const curated = q.curatedWords ?? [];
    // A word that names the student's own major says nothing a course in the
    // major does not already carry: "computer" from "computer science" made
    // CS 415 Game Development as relevant to machine learning as CS 446.
    const namesMajor = (w: string) => q.primarySubject !== null && namesSubject(q.primarySubject, w);
    const inTitle = (w: string, whole: boolean) => new RegExp(`\\b${escapeWord(w)}${whole ? '\\b' : ''}`).test(title);
    const curatedHits = curated.filter((w) => inTitle(w, w.length < 5));
    // Nor does it make a title relevant: "computer" from "Computer
    // engineering" matched every "...for Computer Vision" course as well as
    // the hardware courses the student asked about.
    const freeHits = free.filter((w) => !namesMajor(w) && inTitle(w, false));
    const strongFree = freeHits.filter((w) => !LOW_INFORMATION.has(w));
    const titleHit = curatedHits.length > 0 || strongFree.length > 0 || freeHits.length >= 2;
    const subjectHit =
      Boolean(q.interestSubjects?.has(course.cluster)) ||
      free.some((w) => !namesMajor(w) && namesSubject(course.cluster, w));
    const courseHit = Boolean(q.interestCourses?.has(code));
    if (courseHit) { v = 1; reasons.push('named for the goal you gave'); }
    else if (titleHit && subjectHit) { v = 1; reasons.push('its title and subject match what you said you want'); }
    else if (titleHit) { v = 0.9; reasons.push('its title matches what you said you want'); }
    else if (subjectHit) { v = 0.75; reasons.push('in a subject you said you want'); }
    else if (course.cluster === q.primarySubject) { v = 0.6; reasons.push('in your major'); }
    else if (q.degreeSubjects.has(course.cluster)) { v = 0.4; reasons.push("in one of your degree's subjects"); }
    if (courseHit || titleHit || (subjectHit && course.cluster !== q.primarySubject)) interest = p.relevance;
    take(p.relevance, v, 'relevance');
  }

  // coverage: a category the plan still needs, or any category at all.
  if (p.coverage > 0) {
    const wanted = course.tags.filter((t) => q.wantedTags.has(t));
    let v = 0;
    if (wanted.length > 0) { v = 1; reasons.push(`also covers ${wanted[0]}`); }
    else if (course.tags.length > 0) { v = 0.4; reasons.push(`carries ${course.tags[0]}`); }
    take(p.coverage, v, 'requirement coverage');
  }

  // schedule: sections in the crawled term, and what the student asked of them.
  if (p.schedule > 0) {
    const notBefore = p.notBefore ?? (p.noEarly ? 540 : null);
    const notAfter = p.notAfter ?? null;
    const freeDays = p.freeDays ?? [];
    const windowAsked = notBefore !== null || notAfter !== null || freeDays.length > 0;
    const asked = windowAsked || p.format !== 'any';
    const s = q.sections?.get(code);
    const term = q.nowLabel ? `${q.nowLabel} sections` : "this term's sections";
    if (!asked) {
      // Nothing asked of sections. "Runs this term" used to score a flat 0.7
      // for every course with a section, which is no preference at all and
      // only diluted the ones the student did state.
    } else if (!s || s.total === 0) {
      /**
       * Only one term is crawled. Nothing is known about this course's times
       * or format, and a student who asked for them has no evidence it
       * meets them: weighed at the middle rather than left out, so "online
       * if possible" stops favouring courses with no sections at all.
       */
      weighted += p.schedule * 0.5;
      weightSum += p.schedule;
      unknown.push(term);
    } else {
      let v = 0.7;
      const start = minutesOfDay(s.earliest);
      const asynchronous = s.onlineOnly && start === null;
      if (windowAsked) {
        // A course is not "an 8 a.m. course" because one of its twenty
        // sections starts at 8: what matters is whether a whole registration
        // fits, which the build computes per section type.
        const fits = asynchronous ? true : registrationFits(s.meet, { notBefore, notAfter, freeDays });
        const said = [
          notBefore !== null ? `nothing before ${clockOf(notBefore)}` : null,
          notAfter !== null ? `nothing after ${clockOf(notAfter)}` : null,
          freeDays.length > 0 ? `${freeDays.join('')} free` : null,
        ].filter(Boolean).join(', ');
        if (fits === true) { v += 0.2; reasons.push(asynchronous ? 'online, no set meeting time' : `can be taken with ${said} (${term})`); }
        else if (fits === false) { v -= 0.45; conflicts.push(`no ${term.replace(/s$/, '')} fits ${said}`); }
        else if (notBefore !== null && start !== null) {
          // No per-section data: the course-level earliest is all there is.
          if (start >= notBefore) { v += 0.15; reasons.push(`earliest section ${s.earliest}`); }
          else if (s.lateOption === false) { v -= 0.35; cautions.push(`a section starts at ${s.earliest}`); }
        }
      }
      if (p.format === 'online') {
        if (s.onlineOnly) { v += 0.15; reasons.push('online'); } else { v -= 0.2; cautions.push(`in person in ${q.nowLabel ?? 'this term'}`); }
      } else if (p.format === 'in-person') {
        if (s.onlineOnly) { v -= 0.45; conflicts.push(`online only in ${q.nowLabel ?? 'this term'}`); } else { v += 0.1; }
      }
      take(p.schedule, Math.max(0, Math.min(1, v)), term);
    }
  }

  return { score: weightSum > 0 ? weighted / weightSum : 0, known, reasons, unknown, cautions, conflicts, interest };
}

function clockOf(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h >= 12 ? 'p.m.' : 'a.m.'}`;
}

/**
 * The one sentence every surface prints about a course's teaching record, so
 * the detail panel, the bot and the card dropdown never disagree about it.
 *
 * Returns null when no list is loaded at all. With a list and no entry it
 * says so for the terms the list covers, which is a fact; it does not say the
 * teaching is poor, which the list cannot show. Names are printed as the
 * university prints them.
 */
export function describeExcellent(
  summary: ExcellentSummary | null | undefined,
  listTerms: string[] | null | undefined,
  teachingNow: Array<{ name: string }> | null | undefined,
  nowLabel: string | null | undefined,
): string | null {
  if (!listTerms || listTerms.length === 0) return null;
  const span =
    listTerms.length === 1
      ? termWord(listTerms[0])
      : `${termWord(listTerms[listTerms.length - 1])} to ${termWord(listTerms[0])}`;
  if (!summary || summary.terms.length === 0) {
    return `No instructor of this course is on the Teachers Ranked as Excellent list for ${span}.`;
  }
  const names = summary.instructors
    .slice()
    .sort((a, b) => Number(a.ta) - Number(b.ta) || b.terms.length - a.terms.length || a.name.localeCompare(b.name))
    .slice(0, 4)
    .map((i) => `${prettyName(i.name)}${i.outstanding ? ' (outstanding)' : ''}${i.ta ? ' (TA)' : ''}`);
  const more = summary.instructors.length > 4 ? ` and ${summary.instructors.length - 4} more` : '';
  const when = summary.terms.slice(0, 4).map(termWord).join(', ') + (summary.terms.length > 4 ? ` and ${summary.terms.length - 4} more terms` : '');
  const now = (teachingNow ?? [])
    .filter((t) => summary.instructors.some((i) => sameInstructor(i.name, t.name)))
    .map((t) => prettyName(t.name));
  const head = `On the Teachers Ranked as Excellent list in ${when}: ${names.join('; ')}${more}.`;
  const tail =
    now.length > 0 && nowLabel
      ? ` ${now.join(' and ')} ${now.length === 1 ? 'is' : 'are'} on it and teaching this in ${nowLabel}.`
      : '';
  return head + tail;
}
