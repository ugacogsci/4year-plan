/**
 * Who teaches a course, and what each instructor's own syllabus says.
 *
 * Two sources name instructors, each in its own way. Illinois's published
 * sections (Fall 2026, Spring 2027) write "Challen, G"; a syllabus writes
 * whatever its author typed: "Geoffrey Challen", "Dr. Amir Malvandi",
 * "Callaway, Todd", "Clark, Malissa (17223) TR 2:55-4:15", "Rodríguez".
 * This reads every form down to one person per last name (two people with
 * the same last name and different first initials stay two), with the
 * fullest clean name as the one shown.
 *
 * The student can say which instructor they have or will take, per course
 * per term. The choice lives on the plan (PlanState.instructors), so it is
 * saved, exported and shared with the board, and an older board without it
 * loads exactly as before. ALMA and ARCH read it in the board description and
 * in course_syllabus and term_syllabi, which group a course's syllabi by
 * instructor, newest first, and answer for the chosen one when there is one.
 *
 * Pure: no React, no fetch. The workspace loads the shards and hands them in,
 * so __instructors.check.mjs runs the same code over the shipped files.
 */
import type { IllinoisSyllabus } from './illinois-load';
import type { PlanState, PlanTerm } from './types';

export type SyllabusRecord = IllinoisSyllabus;

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export interface InstructorName {
  /** The name as shown: "Geoffrey Challen", or "G. Challen" when only an initial is known. */
  display: string;
  /** The last name, folded: "challen", "rodriguez", "laystrom-woodard". */
  last: string;
  /** The first initial, lower case, or null when the source gives only a last name. */
  initial: string | null;
  /** Whether the first name is more than an initial. */
  fullFirst: boolean;
}

const TITLE = /^(?:dr|prof|professor|mr|mrs|ms|mx|instructor|lecturer)\.?$/i;
const CREDENTIAL = /^(?:jr|sr|ii|iii|iv|phd|ph\.?\s?d|md|mba|ma|m\.a|ms|m\.s|msw|mph|mfa|edd|ed\.d|dvm|pharmd|jd|cpa|rn|lcsw|esq)\.?$/i;
const NOT_A_PERSON = /^(?:tba|tbd|staff|instructor|instructors|various|none|n\/?a|faculty|team|to be determined|determined|to)$/i;

/** "rodríguez" -> "rodriguez"; keeps letters, hyphens and apostrophes. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z'-]/g, '');
}

/** "HANAWALT" -> "Hanawalt"; a mixed-case word is left as written. */
function caseWord(w: string): string {
  if (w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w.charAt(0) + w.slice(1).toLowerCase();
  return w;
}

/** A name part with titles, nicknames, section numbers and meeting times taken off. */
function cleanPart(s: string): string[] {
  const cut = s.replace(/\([^)]*\)?/g, ' ').replace(/\s\d.*$/, ' ').replace(/^\d.*$/, '');
  let words = cut
    .split(/\s+/)
    .map((w) => w.replace(/^[.,;:]+|[,;:]+$/g, ''))
    .filter(Boolean);
  while (words.length > 0 && TITLE.test(words[0])) words.shift();
  while (words.length > 0 && CREDENTIAL.test(words[words.length - 1])) words.pop();
  // "Dixit, Heena (1st) PROD": a shouted word beside a written name is a label, not a name.
  const shouted = (w: string) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w);
  if (words.some((w) => !shouted(w))) words = words.filter((w) => !shouted(w));
  return words.map(caseWord);
}

/**
 * One instructor's name as a source wrote it, read into a person. Null for
 * a placeholder ("TBA", "Staff", "Determined, To") or nothing at all.
 */
export function readInstructorName(raw: string): InstructorName | null {
  const text = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text || /@/.test(text)) return null;
  let first: string[] = [];
  let last: string[] = [];
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const head = cleanPart(parts[0] ?? '');
  const rest = parts.slice(1).map(cleanPart).filter((w) => w.length > 0 && !w.every((x) => CREDENTIAL.test(x)));
  if (rest.length > 0 && head.length > 0) {
    // "Callaway, Todd", "Challen, G", "Sanders Bustle, Thelma": last name first.
    last = head;
    // "Clark, Malissa (17223) TR 2:55-4:15": the first name, and a middle initial if one follows.
    first = rest[0].filter((w, i) => i === 0 || /^[A-Za-z]\.?$/.test(w));
  } else {
    // "Geoffrey Challen", "Joseph Watson, Jr.", "Laramie D. Lemon, Ph.D.".
    if (head.length === 0) return null;
    last = [head[head.length - 1]];
    first = head.slice(0, -1);
  }
  const all = [...first, ...last];
  if (all.length === 0 || all.every((w) => NOT_A_PERSON.test(w)) || (last.length === 1 && NOT_A_PERSON.test(last[0]))) return null;
  const lastWord = last[last.length - 1];
  const key = fold(lastWord);
  if (key.replace(/[-']/g, '').length < 2) return null;
  const firstWord = first[0] ?? '';
  const initial = fold(firstWord).charAt(0) || null;
  const fullFirst = fold(firstWord).replace(/[-']/g, '').length > 1;
  const shownFirst = first.map((w) => (/^[A-Za-z]$/.test(w) ? `${w.toUpperCase()}.` : w));
  return { display: [...shownFirst, ...last].join(' '), last: key, initial, fullFirst };
}

/** Whether two names can be the same person: the same last name, and no two different first initials. */
export function samePerson(a: InstructorName, b: InstructorName): boolean {
  return a.last === b.last && (!a.initial || !b.initial || a.initial === b.initial);
}

/** Whether a name the student typed or chose is this person. */
export function namesMatch(a: string, b: string): boolean {
  const x = readInstructorName(a);
  const y = readInstructorName(b);
  return Boolean(x && y && samePerson(x, y));
}

/** The better of two forms of one person's name: a full first name over an initial, then more of the name. */
function better(a: InstructorName, b: InstructorName): InstructorName {
  if (a.fullFirst !== b.fullFirst) return a.fullFirst ? a : b;
  if (Boolean(a.initial) !== Boolean(b.initial)) return a.initial ? a : b;
  return b.display.split(' ').length > a.display.split(' ').length ? b : a;
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

const SEASON_OF_CODE: Record<string, number> = { wi: 0, sp: 1, su: 2, fa: 3 };

/** "fa2025" -> a number that sorts terms; an undated record sorts last. */
export function syllabusTermRank(term: string | null | undefined): number {
  const m = String(term ?? '').match(/^(wi|sp|su|fa)(\d{4})$/);
  return m ? Number(m[2]) * 4 + SEASON_OF_CODE[m[1]] : -1;
}

/** "Fall 2026" -> "fa2026", the syllabus records' own form, for the term a card sits in. */
export function syllabusTermCodeOf(label: string): string | null {
  const m = label.match(/\b(Fall|Spring|Summer|Winter)\s+(20\d\d)\b/i);
  if (!m) return null;
  return `${{ fall: 'fa', spring: 'sp', summer: 'su', winter: 'wi' }[m[1].toLowerCase()]}${m[2]}`;
}

/** The term in progress on a date: spring through May, summer in June and July, fall from August. */
export function currentTermLabel(now: Date): string {
  const m = now.getMonth();
  const season = m <= 4 ? 'Spring' : m <= 6 ? 'Summer' : 'Fall';
  return `${season} ${now.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// The picker's choices
// ---------------------------------------------------------------------------

export interface InstructorOption {
  /** The name shown and saved. */
  name: string;
  /** Teaches a section in the published schedule of the card's term. */
  teaching: boolean;
  /** Terms of this instructor's syllabi for the course, newest first ("Fall 2025"). */
  syllabusTerms: string[];
}

interface Person {
  name: InstructorName;
  teaching: boolean;
  terms: Array<{ rank: number; label: string }>;
}

/** Each person once, the forms of their name merged, in the order first seen. */
function people(sectionNames: readonly string[], syllabi: readonly SyllabusRecord[]): Person[] {
  const out: Person[] = [];
  const add = (raw: string, teaching: boolean, term: { rank: number; label: string } | null) => {
    const name = readInstructorName(raw);
    if (!name) return;
    // A last name alone joins the person with that last name; two different initials stay two people.
    const same = out.filter((p) => samePerson(p.name, name));
    const hit = (name.initial ? same.find((p) => p.name.initial === name.initial) : null) ?? same[0];
    if (hit) {
      hit.name = better(hit.name, name);
      hit.teaching ||= teaching;
      if (term && !hit.terms.some((t) => t.label === term.label)) hit.terms.push(term);
    } else {
      out.push({ name, teaching, terms: term ? [term] : [] });
    }
  };
  for (const raw of sectionNames) add(raw, true, null);
  for (const s of syllabi) {
    const label = s.termLabel ?? (s.kind === 'master-outline' ? 'undated outline' : 'undated');
    for (const raw of s.instructors ?? []) add(raw, false, { rank: syllabusTermRank(s.term), label });
  }
  for (const p of out) p.terms.sort((a, b) => b.rank - a.rank);
  return out;
}

/**
 * Who the picker offers for a course in a term: everyone teaching a section
 * of it in that term's published schedule, then everyone named on one of its
 * syllabi, newest syllabus first. One entry per person.
 */
export function instructorOptions(sectionNames: readonly string[], syllabi: readonly SyllabusRecord[]): InstructorOption[] {
  return people(sectionNames, syllabi)
    .map((p) => ({ name: p.name.display, teaching: p.teaching, syllabusTerms: p.terms.map((t) => t.label), rank: p.terms[0]?.rank ?? -2 }))
    .sort((a, b) => Number(b.teaching) - Number(a.teaching) || b.rank - a.rank)
    .map(({ rank: _rank, ...option }) => option);
}

/**
 * The instructors on a term's sections, lectures first: a discussion or lab
 * at Illinois is often led by a teaching assistant, and the lecture's
 * instructor is the one whose syllabus it is.
 */
export function teachingNames(sections: ReadonlyArray<{ type?: string | null; instructors?: string[] }> | null | undefined): string[] {
  const rows = sections ?? [];
  const lectures = rows.filter((s) => !s.type || /lecture/i.test(s.type));
  return [...new Set((lectures.length > 0 ? lectures : rows).flatMap((s) => s.instructors ?? []))];
}

// ---------------------------------------------------------------------------
// The choice, saved on the plan
// ---------------------------------------------------------------------------

/** The student's instructor for a course in a term, or null for "not sure yet". */
export function chosenInstructor(plan: PlanState | null | undefined, termId: string, code: string): string | null {
  const byTerm = (plan as { instructors?: unknown } | null | undefined)?.instructors;
  if (!byTerm || typeof byTerm !== 'object' || Array.isArray(byTerm)) return null;
  const forTerm = (byTerm as Record<string, unknown>)[termId];
  if (!forTerm || typeof forTerm !== 'object' || Array.isArray(forTerm)) return null;
  const name = (forTerm as Record<string, unknown>)[normCode(code)];
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** The plan with that choice set, or cleared with null. Nothing else changes. */
export function withInstructor(plan: PlanState, termId: string, code: string, name: string | null): PlanState {
  const key = normCode(code);
  const current = { ...(plan.instructors ?? {}) };
  const forTerm = { ...(current[termId] ?? {}) };
  const clean = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (clean) forTerm[key] = clean;
  else delete forTerm[key];
  if (Object.keys(forTerm).length > 0) current[termId] = forTerm;
  else delete current[termId];
  const next: PlanState = { ...plan, instructors: current };
  if (Object.keys(current).length === 0) delete next.instructors;
  return next;
}

/**
 * A new board for the same student keeps their instructor choices for every
 * course still in the same term: a rebuild is the planner's change, and the
 * student's "I have Challen" should survive it.
 */
export function carryInstructors(previous: PlanState | null | undefined, next: PlanState, codeOf: (courseId: string) => string | null | undefined): PlanState {
  if (!previous?.instructors) return next;
  let out = next;
  for (const term of next.terms) {
    for (const id of term.courseIds) {
      const code = codeOf(id);
      if (!code) continue;
      const name = chosenInstructor(previous, term.id, code);
      if (name && !chosenInstructor(out, term.id, code)) out = withInstructor(out, term.id, code, name);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Syllabi by instructor
// ---------------------------------------------------------------------------

export interface InstructorGroup {
  /** The instructor, or null for syllabi that name none (and the course's undated outline). */
  instructor: string | null;
  chosen: boolean;
  teaching: boolean;
  /** Newest first. */
  syllabi: SyllabusRecord[];
}

/**
 * A course's syllabi grouped by instructor, newest syllabus first within
 * each. A co-taught syllabus sits under each of its instructors. The chosen
 * instructor comes first, then those teaching the term, then by each one's
 * newest syllabus; syllabi naming nobody come last. An instructor teaching
 * the term with no syllabus is a group with none.
 */
export function groupByInstructor(
  syllabi: readonly SyllabusRecord[],
  options: { teaching?: readonly string[]; chosen?: string | null } = {},
): InstructorGroup[] {
  const everyone = people(options.teaching ?? [], syllabi);
  const chosenName = options.chosen ? readInstructorName(options.chosen) : null;
  const sorted = [...syllabi].sort((a, b) => syllabusTermRank(b.term) - syllabusTermRank(a.term));
  const groups: InstructorGroup[] = everyone.map((p) => ({
    instructor: p.name.display,
    chosen: Boolean(chosenName && samePerson(chosenName, p.name)),
    teaching: p.teaching,
    syllabi: sorted.filter((s) => (s.instructors ?? []).some((raw) => {
      const n = readInstructorName(raw);
      return Boolean(n && samePerson(n, p.name));
    })),
  }));
  const unnamed = sorted.filter((s) => !(s.instructors ?? []).some((raw) => readInstructorName(raw)));
  const rank = (g: InstructorGroup) => syllabusTermRank(g.syllabi[0]?.term);
  groups.sort((a, b) => Number(b.chosen) - Number(a.chosen) || Number(b.teaching) - Number(a.teaching) || rank(b) - rank(a));
  if (unnamed.length > 0) groups.push({ instructor: null, chosen: false, teaching: false, syllabi: unnamed });
  return groups;
}

// ---------------------------------------------------------------------------
// What the advisor's tools return
// ---------------------------------------------------------------------------

/** The facts a question can ask for. 'all' is every one. */
export const SYLLABUS_FACTS = ['attendance', 'grading', 'exams', 'final', 'materials', 'late_work', 'makeups', 'other', 'all'] as const;
export type SyllabusFact = (typeof SYLLABUS_FACTS)[number];

/** The asked-for facts of one syllabus, with its term and link. */
export function syllabusFacts(s: SyllabusRecord, facts: readonly SyllabusFact[], forTermLabel: string | null): Record<string, unknown> {
  const want = new Set<SyllabusFact>(facts.length === 0 || facts.includes('all') ? SYLLABUS_FACTS : facts);
  const term = s.termLabel ?? (s.kind === 'master-outline' ? 'undated course outline' : 'undated');
  const out: Record<string, unknown> = {
    syllabus_term: term,
    ...(forTermLabel && s.termLabel !== forTermLabel ? { not_this_term: true } : {}),
    ...(s.kind !== 'syllabus' ? { kind: s.kind } : {}),
    link: s.url,
  };
  if (want.has('attendance')) out.attendance = s.attendance ?? null;
  if (want.has('grading')) {
    out.grading = {
      basis: s.grading?.basis ?? 'unknown',
      components: (s.grading?.components ?? []).map((c) => ({ item: c.item, weight: c.weight, unit: c.unit, ...(c.note ? { note: c.note } : {}) })),
      ...(s.grading?.scale ? { scale: s.grading.scale } : {}),
      ...(s.grading?.curve ? { curve: s.grading.curve } : {}),
      ...(s.grading?.drop ? { drop: s.grading.drop } : {}),
      ...(s.grading?.extraCredit ? { extra_credit: s.grading.extraCredit } : {}),
    };
  }
  if (want.has('exams')) out.exams = s.exams ?? [];
  if (want.has('exams') || want.has('final')) out.final_exam = s.finalExam ?? null;
  if (want.has('materials')) out.materials = s.materials ?? [];
  if (want.has('late_work')) out.late_work = s.lateWork ?? null;
  if (want.has('makeups')) out.makeups = s.makeups ?? null;
  if (want.has('other')) out.other = s.other ?? [];
  if (want.has('all') && s.objectives?.length) out.objectives = s.objectives;
  if (want.has('all') && s.topics?.length) out.topics = s.topics;
  return out;
}

/** What course_syllabus adds to its answer: the syllabi by instructor, and the student's choice. */
export function syllabiByInstructor(
  syllabi: readonly SyllabusRecord[],
  options: { teaching?: readonly string[]; chosen?: string | null; termLabel?: string | null },
): { chosen_instructor: string | null; chosen_has_syllabus: boolean | null; by_instructor: Array<Record<string, unknown>> } {
  const groups = groupByInstructor(syllabi, options);
  const chosen = options.chosen ?? null;
  return {
    chosen_instructor: chosen,
    chosen_has_syllabus: chosen ? groups.some((g) => g.chosen && g.syllabi.length > 0) : null,
    by_instructor: groups.slice(0, 10).map((g) => ({
      instructor: g.instructor ?? (g.syllabi.every((s) => s.kind === 'master-outline') ? 'course outline (no instructor)' : 'not named in the syllabus'),
      ...(g.chosen ? { chosen: true } : {}),
      ...(g.teaching && options.termLabel ? { teaches_in: options.termLabel } : {}),
      newest: g.syllabi[0] ? { term: g.syllabi[0].termLabel ?? 'undated', link: g.syllabi[0].url } : null,
      syllabi: g.syllabi.map((s) => ({ term: s.termLabel ?? 'undated', link: s.url })).slice(0, 4),
    })),
  };
}

/**
 * The six syllabi course_syllabus returns in full: the newest of each
 * instructor first (the chosen one's before anyone's), then the newest of
 * the rest, so a course with many instructors still shows each of them.
 */
export function syllabiToShow(syllabi: readonly SyllabusRecord[], options: { teaching?: readonly string[]; chosen?: string | null }, limit = 6): SyllabusRecord[] {
  const groups = groupByInstructor(syllabi, options);
  const out: SyllabusRecord[] = [];
  const push = (s: SyllabusRecord | undefined) => {
    if (s && out.length < limit && !out.includes(s)) out.push(s);
  };
  const chosen = groups.find((g) => g.chosen);
  if (chosen) chosen.syllabi.slice(0, 2).forEach(push);
  for (const g of groups) push(g.syllabi[0]);
  for (const s of [...syllabi].sort((a, b) => syllabusTermRank(b.term) - syllabusTermRank(a.term))) push(s);
  return out.sort((a, b) => syllabusTermRank(b.term) - syllabusTermRank(a.term));
}

// ---------------------------------------------------------------------------
// term_syllabi: many courses at once
// ---------------------------------------------------------------------------

const YEAR_WORDS: Array<[RegExp, number | 'last']> = [
  [/\b(freshman|first|1st)\s+year\b|\byear\s*(1|one)\b/i, 1],
  [/\b(sophomore|second|2nd)\s+year\b|\byear\s*(2|two)\b/i, 2],
  [/\b(junior|third|3rd)\s+year\b|\byear\s*(3|three)\b/i, 3],
  [/\b(senior|fourth|4th)\s+year\b|\byear\s*(4|four)\b/i, 4],
  [/\b(fifth|5th)\s+year\b|\byear\s*(5|five)\b/i, 5],
  [/\b(last|final)\s+year\b/i, 'last'],
];

/**
 * The board terms a request names: term labels ("Fall 2027"), a year of
 * study ("senior year", "year 2", "last year"), "this term", "next term" or
 * "all". A year of study is the board's own year number; a board with no
 * year 4 answers "senior year" with its last year.
 */
export function resolveTerms(terms: readonly PlanTerm[], asked: readonly string[], now: Date): { terms: PlanTerm[]; unknown: string[] } {
  const out: PlanTerm[] = [];
  const unknown: string[] = [];
  const add = (t: PlanTerm) => {
    if (!out.includes(t)) out.push(t);
  };
  const current = currentTermLabel(now).toLowerCase();
  const lastYear = terms.reduce((n, t) => Math.max(n, t.year), 0);
  for (const raw of asked) {
    const want = String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!want) continue;
    if (/^(all|every|whole|entire)\b|all (terms|semesters)|whole plan/.test(want)) {
      terms.forEach(add);
      continue;
    }
    if (/\b(this|current) (term|semester)\b|\bnow\b|\bcurrent\b/.test(want)) {
      const t = terms.find((x) => x.label.toLowerCase() === current) ?? terms[0];
      if (t) add(t);
      continue;
    }
    if (/\bnext (term|semester)\b/.test(want)) {
      const at = terms.findIndex((x) => x.label.toLowerCase() === current);
      const t = terms.slice(at + 1).find((x) => x.season !== 'Summer') ?? null;
      if (t) add(t);
      else unknown.push(raw);
      continue;
    }
    const exact = terms.find((t) => t.label.toLowerCase() === want || t.id === want);
    if (exact) {
      add(exact);
      continue;
    }
    const year = YEAR_WORDS.find(([re]) => re.test(want))?.[1];
    if (year !== undefined) {
      const n = year === 'last' ? lastYear : year;
      const inYear = terms.filter((t) => t.year === n);
      (inYear.length > 0 ? inYear : year === 4 ? terms.filter((t) => t.year === lastYear) : []).forEach(add);
      if (inYear.length === 0 && year !== 4) unknown.push(raw);
      continue;
    }
    const loose = terms.filter((t) => t.label.toLowerCase().includes(want) || want.includes(t.label.toLowerCase()));
    if (loose.length > 0) loose.forEach(add);
    else unknown.push(raw);
  }
  const order = new Map(terms.map((t, i) => [t, i]));
  return { terms: out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), unknown };
}

/** One course for term_syllabi, as the workspace loads it. */
export interface TermCourseInput {
  code: string;
  title: string;
  termLabel: string;
  chosen: string | null;
  /** The instructors on the term's published sections; null when that term's schedule is not loaded. */
  teaching: string[] | null;
  /** The term whose sections those are, when it is not the card's own ("Fall 2026's sections"). */
  teachingTermLabel?: string | null;
  syllabi: SyllabusRecord[];
}

/**
 * Every course asked about, each with the student's instructor or the list
 * of instructors, and each instructor's newest syllabus with the facts the
 * question asks for. A course with no syllabus is listed plainly.
 */
export function termSyllabiResult(courses: readonly TermCourseInput[], facts: readonly SyllabusFact[], options: { maxInstructors?: number } = {}): Array<Record<string, unknown>> {
  const max = options.maxInstructors ?? 6;
  return courses.map((c) => {
    const groups = groupByInstructor(c.syllabi, { teaching: c.teaching ?? [], chosen: c.chosen });
    const withSyllabus = groups.filter((g) => g.syllabi.length > 0);
    const base: Record<string, unknown> = { term: c.termLabel, code: c.code, title: c.title, chosen_instructor: c.chosen };
    if (c.syllabi.length === 0) {
      return {
        ...base,
        syllabus_found: false,
        ...(c.teaching && c.teaching.length > 0 ? { teaching: groups.map((g) => g.instructor).filter(Boolean).slice(0, max) } : {}),
      };
    }
    const entry = (g: InstructorGroup) => ({
      instructor: g.instructor ?? (g.syllabi.every((s) => s.kind === 'master-outline') ? 'course outline (no instructor)' : 'not named in the syllabus'),
      ...(g.chosen ? { chosen: true } : {}),
      ...(g.teaching ? { teaches_in: c.teachingTermLabel ?? c.termLabel } : {}),
      ...(g.syllabi[0] ? syllabusFacts(g.syllabi[0], facts, c.termLabel) : { syllabus: null }),
      ...(g.syllabi.length > 1 ? { older_syllabi: g.syllabi.length - 1 } : {}),
    });
    const chosen = groups.find((g) => g.chosen);
    if (c.chosen && chosen && chosen.syllabi.length > 0) {
      return { ...base, syllabus_found: true, instructors: [entry(chosen)], other_instructors: groups.filter((g) => g !== chosen && g.instructor).map((g) => g.instructor).slice(0, max) };
    }
    const shown = [...withSyllabus, ...groups.filter((g) => g.syllabi.length === 0)].slice(0, max);
    return {
      ...base,
      syllabus_found: true,
      ...(c.chosen ? { chosen_has_syllabus: false } : {}),
      instructors: shown.map(entry),
      ...(groups.length > shown.length ? { more_instructors: groups.length - shown.length } : {}),
    };
  });
}
