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
import { subjectMatches } from './illinois-subjects';

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
  grades?: Map<string, { difficulty: number | null; withdrawPct: number | null }>;
  bands?: { typical: number; harder: number; hardest: number } | null;
  sections?: Map<string, { total: number; earliest: string | null; onlineOnly: boolean; instructors: Array<{ name: string }> }>;
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
    if (g && g.difficulty !== null) {
      let v = 1 - g.difficulty / 100;
      const w = g.withdrawPct ?? 0;
      if (w >= 8) { v = Math.max(0, v - Math.min(0.3, (w - 8) / 40)); }
      const band = q.bands;
      const word = band
        ? g.difficulty >= band.hardest ? 'hardest band' : g.difficulty >= band.harder ? 'harder than most' : g.difficulty <= band.typical ? 'light' : 'typical'
        : `difficulty ${Math.round(g.difficulty)}`;
      reasons.push(`${word} by grade history (difficulty ${Math.round(g.difficulty)} of 100${w >= 8 ? `, ${Math.round(w)}% withdrew` : ''})`);
      take(p.workload, v, 'grade history');
    } else {
      take(p.workload, null, 'grade history');
    }
  }

  // teaching: the university's own list, and whether one of those instructors runs it this term.
  if (p.teaching > 0) {
    if (q.excellent && q.excellentTerms && q.excellentTerms.length > 0) {
      const ex = q.excellent.get(code);
      const recent = q.excellentTerms.slice(0, 6);
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
        v = Math.max(v, 0.85);
        const one = thisTerm[0];
        reasons.push(`${prettyName(one.name)} ranked ${one.outstanding ? 'outstanding' : 'excellent'} by students in ${termWord(one.terms[0])} and is teaching it${q.nowLabel ? ` in ${q.nowLabel}` : ' this term'}`);
      } else if (hits.length > 0) {
        const who = full > 0 ? 'instructors' : 'teaching assistants';
        reasons.push(`${who} ranked excellent by students in ${hits.length === 1 ? termWord(hits[0]) : `${hits.length} of the last ${recent.length} terms`}`);
      }
      take(p.teaching, v, 'teaching ratings');
    } else {
      take(p.teaching, null, 'teaching ratings');
    }
  }

  // relevance: the student's words against subject and title; the degree's own subjects count too.
  if (p.relevance > 0) {
    let v = 0;
    const title = course.title.toLowerCase();
    const words = q.interestWords.filter((w) => w.length >= 5 && !INTEREST_STOPWORDS.has(w));
    const interestHit = words.some((w) => subjectMatches(course.cluster, w));
    const titleHit = words.some((w) => new RegExp(`\\b${w}`).test(title));
    if (interestHit) { v = 1; reasons.push('in a subject you said you want'); }
    else if (titleHit) { v = 0.75; reasons.push('its title matches what you said you want'); }
    else if (course.cluster === q.primarySubject) { v = 0.6; reasons.push('in your major'); }
    else if (q.degreeSubjects.has(course.cluster)) { v = 0.4; reasons.push("in one of your degree's subjects"); }
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
    const s = q.sections?.get(code);
    if (!s || s.total === 0) {
      // Only one term is crawled. A course with no section in it may simply
      // run in the other season, which the offering history and the season
      // check handle; here it is not known, not marked down.
      take(p.schedule, null, 'this term\'s sections');
    } else {
      let v = 0.7;
      const start = minutesOfDay(s.earliest);
      if (p.noEarly) {
        if (start !== null && start >= 9 * 60) { v += 0.15; reasons.push(`earliest section ${s.earliest}`); }
        else if (start !== null) { v -= 0.35; reasons.push(`a section starts at ${s.earliest}`); }
      }
      if (p.format === 'online') {
        if (s.onlineOnly) { v += 0.15; reasons.push('online'); } else { v -= 0.2; }
      } else if (p.format === 'in-person') {
        if (s.onlineOnly) { v -= 0.35; reasons.push('online only'); } else { v += 0.1; }
      }
      take(p.schedule, Math.max(0, Math.min(1, v)), 'this term\'s sections');
    }
  }

  return { score: weightSum > 0 ? weighted / weightSum : 0, known, reasons, unknown };
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
