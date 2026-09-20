import type { SchoolId } from './onboarding';
import type { SemesterSeason } from './types';
import type { GradeRow, ProgramRequirements } from './scheduler';
import { areaProgress, termLoad } from './scheduler';
import { DEADLINE_DISCLAIMER } from './autoplan';
import {
  STANDING_HOURS,
  THIN_SAMPLE,
  creditLabel,
  difficultyLabel,
  missingPrerequisiteGroups,
  partOfTermLine,
  termCreditRange,
  type CourseFacts,
  type IllinoisData,
  type PrereqGroup,
  type PrereqSpec,
  type RawSection,
  type RawSectionFile,
  type SectionSummary,
} from './illinois-data';

/**
 * Which side of the product answers a question.
 *
 * TRU is good at Illinois's published pages and bad at the student's own board:
 * it holds no section, building, meeting-time or part-of-term data at all, its
 * catalog chunks lose retrieval to faculty bio pages, and three planner-shaped
 * phrasings ("is my schedule too hard") trip its personal-record guard. The
 * planner is the opposite. So questions are ROUTED rather than forwarded with a
 * context block attached, and each one goes to whichever side holds the data.
 *
 * Six measured reasons against prepending the board to the question string, all
 * from TRU's own request handler:
 *
 *   1. the question is silently cut at 1,000 characters, so the block survives
 *      and the student's actual sentence is what gets truncated
 *   2. anything over 120 characters is treated as a hard question and gets an
 *      adaptive-thinking call, on every question including "when is tuition due"
 *   3. the extractive fallback refuses questions over 20 words, so the moment
 *      the daily model cap is hit every planner question declines instead of
 *      degrading to a sourced extract
 *   4. the answer cache key is the question text, so two students with different
 *      boards never share an entry and every ask is a fresh model call
 *   5. the guards run on the whole string and are tuned for student prose, not
 *      for a generated list
 *   6. the question text is logged, so a prepended board would put real student
 *      schedules in TRU's operational log
 *
 * The last one is the one that settles it. Nothing about a student leaves this
 * device. Only a short self-contained sentence is ever forwarded.
 *
 * Every local answer carries the real page each fact came from, in the same
 * shape the ask bar already renders, so "every answer ships with its source"
 * stays true on both sides of the router.
 */

// ---------------------------------------------------------------------------
// What the router may read
// ---------------------------------------------------------------------------

/** A course as it sits on the board: the code, and which column it is in. */
export interface PlannedCourse {
  /** The catalog's own spelling, "CS 225". */
  code: string;
  title: string;
  credits: number;
  /** autoplan writes these as `${season.toLowerCase()}-${year}`, so "spring-2027". */
  termId: string;
  /** "Spring 2027". */
  termLabel: string;
  season: SemesterSeason;
  /** The calendar year, not the year of study. A five-year plan is normal. */
  year: number;
  /** Position in chronological term order, so "before this one" is decidable. */
  index: number;
}

/**
 * Everything the router may read. All of it is already in the browser: the
 * board from the workspace's own state, the data from the fetches that already
 * run there. Nothing in here is ever sent upstream.
 */
export interface AskContext {
  schoolId: SchoolId;
  /**
   * Whatever buildIllinoisData returned. Passing the whole thing rather than
   * eight separate maps is deliberate: the caller cannot then assemble a
   * context whose grades and bands came from different loads, which would make
   * every difficulty label wrong by a silent amount.
   */
  data: IllinoisData;
  /**
   * Per-course section rows, straight out of illinois-sections.json. IllinoisData
   * keeps only the summary, and a summary cannot answer "which section and what
   * CRN". Build it with sectionRowsFrom().
   */
  sectionRows: Map<string, RawSection[]>;
  /** Chronological, earliest term first. */
  planned: PlannedCourse[];
  /** Prior credit plus anything marked complete. */
  completedCodes: Set<string>;
  /** The open card, which is what resolves "this one". */
  selectedCode: string | null;
  /** The column in view, which is what resolves "my spring". */
  focusTermId: string | null;
  program: ProgramRequirements | null;
  /**
   * The program's own catalog page. ProgramRequirements carries no url, and an
   * answer about a degree has to cite the degree page it was measured against.
   * IllinoisData.requirementBlocks holds it, on every block for that program.
   */
  programUrl: string | null;
}

export interface Source {
  n: number;
  title: string;
  url: string;
  host: string;
}

/** Same shape the ask bar already renders, so both paths look identical. */
export interface LocalAnswer {
  text: string;
  sources: Source[];
  /** False when the honest answer is that the planner does not hold the fact. */
  grounded: boolean;
  contacts: never[];
  /** Always true. No model call happened, which is the whole point. */
  locked: true;
}

export type LocalShape =
  | 'section'
  /** What a course is, from the catalog row rather than a retrieval guess. */
  | 'course'
  | 'load'
  | 'prereq'
  | 'requirements'
  /** Two candidates and no way to choose. The bar renders the ask-back. */
  | 'clarify';

export type UpstreamShape = 'grade' | 'general';

/**
 * A compound question can need both sides. "How hard is CS 225 and what are its
 * prerequisites?" fills all eight of TRU's retrieval slots with grade chunks and
 * answers only the first half, so the prerequisite half is answered here and
 * only the grade half is forwarded.
 *
 * The extra field is optional on purpose: a bar that only reads `kind` still
 * answers the half it handles and never shows anything wrong.
 */
export type Routed =
  | { kind: 'local'; shape: LocalShape; answer: LocalAnswer; alsoUpstream?: string }
  | { kind: 'upstream'; shape: UpstreamShape; question: string; alsoLocal?: LocalAnswer };

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Codes are compared after collapsing internal whitespace, never raw. */
const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** "CS 225" -> ["CS", "225"]. */
function splitCode(code: string): [string, string] {
  const m = /^([A-Z]{2,4})\s*(\d{3})$/.exec(normCode(code));
  return m ? [m[1], m[2]] : [normCode(code), ''];
}

function sourceOf(n: number, title: string, url: string): Source {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    // A malformed url would throw inside the render, which loses the whole
    // answer over a cosmetic field. An empty host just renders as empty.
    host = '';
  }
  return { n, title, url, host };
}

function local(shape: LocalShape, text: string, sources: Source[], grounded = true): Routed {
  return {
    kind: 'local',
    shape,
    answer: { text: text.trim(), sources, grounded, contacts: [], locked: true },
  };
}

/** "a, b and c". Never an Oxford comma; the product's copy does not use one. */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The same list when it has been cut short. "and N more" is already the final
 * conjunction, so the named items stay comma separated; joining them with "and"
 * as well produced "Davenport Hall, Gregory Hall and Lincoln Hall and 6 more".
 */
function joinWithMore(items: string[], rest: number): string {
  if (rest <= 0) return joinList(items);
  return `${items.join(', ')} and ${rest} more`;
}

const DAY_WORDS: Record<string, string> = {
  M: 'Monday',
  T: 'Tuesday',
  W: 'Wednesday',
  R: 'Thursday',
  F: 'Friday',
  S: 'Saturday',
};

/**
 * "MWF" -> "Monday, Wednesday and Friday".
 *
 * Anything that is not a clean run of day letters is printed verbatim. The
 * scraper concatenates two meetings into one cell often enough ("TR R") that
 * expanding a mangled cell would show a student a meeting pattern that does not
 * exist.
 */
function dayWords(days: string | null): string | null {
  const d = (days ?? '').trim();
  if (!d || d.toLowerCase() === 'n.a.') return null;
  if (!/^[MTWRFS]+$/.test(d)) return d;
  return joinList([...d].map((c) => DAY_WORDS[c] ?? c));
}

/** "9:00AM" and "10:50AM" -> "9:00AM to 10:50AM". Times are printed as published. */
function timeRange(start: string | null, end: string | null): string | null {
  const a = (start ?? '').trim();
  const b = (end ?? '').trim();
  if (!a && !b) return null;
  if (a && !b) return a;
  if (!a && b) return b;
  if (!/^\d/.test(a)) return a; // "ARRANGED" is not a time and has no range
  return `${a} to ${b}`;
}

/** Illinois publishes a word, not a seat count. Anything unexpected is dropped. */
function availabilityWord(availability: string | null): string | null {
  const a = (availability ?? '').trim();
  if (/^(?:CrossList)?Open\b/i.test(a)) return 'open';
  if (/^Closed\b/i.test(a)) return 'closed';
  return null;
}

/** A location cell that names no building. Printing it would invent a room. */
const NOT_A_BUILDING = /^(?:location pending|arr|arranged|n\.?a\.?|online|to be announced|tbd)$/i;

/**
 * A readable building name, or null when the cell names no building.
 *
 * summariseSections drops the obvious junk but three shapes get past it and
 * reach the page as a building that does not exist: "Location Pending n.a.",
 * "Speech & Hearing Science Bldg Location Pending" and
 * "0027/1025 Campus Instructional Facility", which is a room list glued to a
 * name. Street-number names like "1010 W Nevada" are real Illinois buildings,
 * so a leading digit on its own is not evidence of anything.
 */
function cleanBuilding(raw: string | null): string | null {
  let b = (raw ?? '').trim();
  if (!b) return null;
  b = b.replace(/\s*n\.?a\.?$/i, '').trim();
  b = b.replace(/location pending/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  b = b.replace(/^\d[\dA-Za-z]*(?:\/[\dA-Za-z]+)+\s+/, '').trim();
  if (!b || NOT_A_BUILDING.test(b)) return null;
  return b;
}

function placeOf(row: RawSection): string {
  const room = (row.room ?? '').trim();
  const building = cleanBuilding(row.building);
  if (/^location pending$/i.test((row.building ?? '').trim())) return 'location not assigned yet';
  if (!building) return 'location not listed';
  return room && !building.startsWith(room) ? `${room} ${building}` : building;
}

/**
 * Where a course usually meets, recounted over cleaned building names.
 *
 * Not illinois-data's buildingLine: that one counts the raw cells, so CS 233
 * renders as "Spread across Campus Instructional Facility, Location Pending
 * n.a." and names a building nobody can walk to.
 */
function buildingSentence(summary: SectionSummary): string {
  const counts = new Map<string, number>();
  let located = 0;
  for (const entry of summary.buildings) {
    const name = cleanBuilding(entry.building);
    if (!name) continue;
    located += entry.count;
    counts.set(name, (counts.get(name) ?? 0) + entry.count);
  }
  if (summary.onlineOnly) return 'Taught online. No room listed.';
  if (located === 0) return 'No room listed for this course.';

  const ranked = [...counts.entries()]
    .map(([building, count]) => ({ building, count }))
    .sort((a, b) => b.count - a.count || a.building.localeCompare(b.building));

  // The claim "usually in X" sends a student to one building, so it takes a
  // real majority before it is made at all. At ACCY 201's 0.59 share it would
  // be wrong for nearly half the sections.
  const top = ranked[0];
  if (top && located >= 3 && top.count / located >= 0.8) {
    return `Usually in ${top.building} (${top.count} of ${located} sections).`;
  }
  const named = ranked.slice(0, 3).map((b) => b.building);
  return `Spread across ${joinWithMore(named, ranked.length - named.length)}.`;
}

/** "2026-09-20T02:53:18Z" -> "20 Sep 2026". Provenance, never a deadline. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function readOn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Per-course section rows, keyed by normalised code.
 *
 * The router needs the rows themselves, not summariseSections's digest, because
 * "which section, what CRN, what room" is answerable only from a row. Kept here
 * so the component does not hand-roll the normalisation and end up with a map
 * whose keys are "CS225" while every lookup asks for "CS 225".
 */
export function sectionRowsFrom(file: RawSectionFile | null | undefined): Map<string, RawSection[]> {
  const out = new Map<string, RawSection[]>();
  for (const course of file?.courses ?? []) {
    if (!course?.code) continue;
    out.set(normCode(course.code), course.sections ?? []);
  }
  return out;
}

/**
 * The subjects the schedule crawl actually reached.
 *
 * The crawl walks subjects alphabetically and is written after every one, so a
 * partial file is normal and is always valid JSON. Without this set a course in
 * an uncrawled subject reads as "not offered", which is a fabricated fact about
 * the university and exactly the failure the house rules name.
 */
function crawledSubjects(ctx: AskContext): Set<string> {
  const out = new Set<string>();
  for (const code of ctx.sectionRows.keys()) out.add(splitCode(code)[0]);
  return out;
}

/** The page the section facts were actually read from. */
function scheduleUrlFor(ctx: AskContext, code: string): string | null {
  const term = ctx.data.sectionTerm;
  if (!term) return null;
  const [subject, number] = splitCode(code);
  if (!subject || !number) return null;
  return `https://courses.illinois.edu/schedule/${term.year}/${String(term.term).toLowerCase()}/${subject}/${number}`;
}

function scheduleTermUrl(ctx: AskContext): string | null {
  const term = ctx.data.sectionTerm;
  if (!term) return null;
  return `https://courses.illinois.edu/schedule/${term.year}/${String(term.term).toLowerCase()}`;
}

/**
 * The registrar's own grade distribution product. Every grade number in this
 * module came from the file that page publishes, so it is the only page a grade
 * claim may cite.
 */
const DAIR = {
  title: 'Grade Distribution, University of Illinois Data, Analytics and Institutional Research',
  url: 'https://dair.illinois.edu/access-data/grade-distribution/',
};

/** History, never prediction. This sentence ships with every grade number. */
function gradeHistoryLine(ctx: AskContext): string {
  const terms = ctx.data.gradeProvenance?.terms;
  return terms
    ? `These are grades students actually got, ${terms}. History, not a prediction about you.`
    : 'These are grades students actually got. History, not a prediction about you.';
}

// ---------------------------------------------------------------------------
// Shape detectors, first match wins
// ---------------------------------------------------------------------------

/**
 * Where and when a section meets, who is assigned to it, and which part of term
 * it runs in. TRU's Illinois corpus has none of this: its courses.illinois.edu
 * pages are subject indexes carrying a code and a title and nothing else, so
 * forwarding one of these guarantees a decline.
 *
 * "who teaches" is here and "who taught" is not. The schedule names the
 * instructor assigned to the crawled term, which is a fact only this side has.
 * Past grading by instructor is history, which is TRU's.
 */
const SECTION_SHAPE =
  /\b(building|buildings|room|classroom|where is|where does|where do|where are|what time|when does|when do|when is|meeting time|meets|meet)\b|\b(what|which|how many|list)\b[^?]{0,40}\b(sections?|crn|part of term|parts of term|days)\b|\bwho (teaches|is teaching)\b|\b(conflict|conflicts|overlap|overlaps|clash|clashes|back.?to.?back)\b|\bcan i get (from|to)\b|\bwalk\b[^?]{0,20}\bbetween\b|\bin person or online\b|\bonline or in person\b|\bhow many seats?\b|\bwaitlist\b|\b(is|are) (it|this|that) (open|closed|full|online)\b/i;

/**
 * Words that are a section question only once a course is on the table.
 *
 * "Online" on its own is a question about how Illinois runs online courses,
 * which is TRU's. "Is CS 128 online" is a question about a row in the Fall 2026
 * schedule, which is this side's, and the difference is entirely the code.
 */
const SECTION_SHAPE_WITH_COURSE =
  /\bonline\b|\bin person\b|\bwhat days?\b|\bhow many sections?\b|\bcrn\b|\blecture\b|\bdiscussion\b|\blab\b|\bopen or closed\b/i;

/**
 * How heavy a term is. TRU cannot see a board at all, and its hardest-courses
 * answerer would reply with the eight lowest-GPA courses at the whole
 * university, which is a confident answer to a question nobody asked.
 *
 * The last alternative reads a superlative against a plain noun, because "what
 * is the easiest class in fall 2027" carried no possessive and so matched none
 * of the others and went upstream. It cannot swallow "the hardest class at
 * Illinois", because the caller still requires the question to point at the
 * student or at a term before this detector is allowed to answer.
 */
const LOAD_SHAPE =
  /\b(too (hard|much|heavy|light|many)|workload|course ?load|overload\w*|balanced|manageable|doable|survive)\b|\b(hard|heavy|light|tough|brutal|rough|packed|easy|busy)\b[^?]{0,25}\b(term|semester|schedule|spring|fall|summer|year|load)\b|\b(term|semester|schedule|spring|fall|summer|load)\b[^?]{0,25}\b(hard|hardest|heavy|heaviest|light|lightest|tough|toughest|brutal|rough|packed|easy|easiest|busy|busiest|worst)\b|\b(hardest|toughest|easiest|worst)\b[^?]{0,25}\b(of\s+)?(my|these|this|the)\b|\b(my|these|this)\b[^?]{0,25}\b(hardest|toughest|easiest|worst)\b|\b(hardest|toughest|easiest|worst)\b[^?]{0,30}\b(class|classes|course|courses|term|semester|spring|fall|summer|winter)\b/i;

/**
 * A superlative aimed at the columns rather than at the cards in them.
 *
 * "Which term is hardest?" is one of the four questions the ask bar offers, and
 * it used to go upstream to an engine that cannot see a board: the possessive
 * was the only thing the load detector read, and this phrasing has none. It
 * also has to be told apart from "which of my classes is hardest", because
 * answering a question about terms with the name of a course answers something
 * nobody asked.
 */
const TERM_SUPERLATIVE =
  /\b(hardest|toughest|heaviest|easiest|lightest|busiest|worst)\b[^?]{0,20}\b(terms?|semesters?)\b|\b(terms?|semesters?)\b[^?]{0,20}\b(hardest|toughest|heaviest|easiest|lightest|busiest|worst)\b/i;

/**
 * "My first class", which names a course without naming one.
 *
 * The ask bar offers this question too, and it used to come back with the
 * course picker, which is not an answer to it. The board knows which column
 * comes first; what it cannot know is which class in that column starts
 * earliest in the day, because it holds courses and not sections. The answer
 * says both.
 */
const FIRST_CLASS_SHAPE = /\b(first|earliest)\s+(class|course)\b/i;

/**
 * Ordering. prereqCodes here are parsed from the registrar's own sentence and
 * prereqText is that sentence verbatim, while TRU's catalog chunk is titled
 * "Course Catalog (part N)" with no course-code boost and loses retrieval to
 * faculty biography pages on the same question.
 */
const PREREQ_SHAPE =
  /\bprereq\w*\b|\bpre.?requisite\w*\b|\bwhat do i need (before|first|to take)\b|\b(need|take|do) .{0,24}\bbefore\b|\bam i ready for\b|\bcan i take\b|\bunlocks?\b|\bopens? up\b|\bcomes? first\b|\bdo i need .{0,30}\bfirst\b|\bwhat (?:does|do|would) [^?]{0,30}\b(?:need|require)\s*(?:first|before (?:it|this|that)|to take|in order|\?|$)/i;

/**
 * Ordering words that are a prerequisite question only once a course is named.
 *
 * "What does CS 225 need first?" is the product's own suggested question and it
 * went upstream, because PREREQ_SHAPE only knew "what do I need first". A bare
 * "what do I need first" with no course is a question about orientation or
 * paperwork and belongs upstream, so the course is what makes the difference,
 * the same way SECTION_SHAPE_WITH_COURSE works.
 */
const PREREQ_SHAPE_WITH_COURSE =
  /\bneeds? (first|before|to be taken)\b|\brequires?\b|\brequired (first|before)\b|\bcomes? before\b|\bbefore (it|this|that|i take)\b|\bwhat (?:do i|should i) take first\b|\bhave to take\b/i;

/**
 * Things a course can require that are not other courses.
 *
 * "What textbook does CS 225 require" matches the ordering wording above and
 * would be answered with a list of prerequisite courses, which answers a
 * question the student did not ask. The planner holds no textbook, fee or
 * equipment data at all, so these go upstream.
 */
const NOT_A_PREREQ_OBJECT =
  /\b(textbook|books?|laptop|computer|calculator|materials?|supplies|software|fees?|deposit|uniform|immunization|vaccine|clicker)\b/i;

/**
 * Registrar verbs. A question built from one of these, with no course named, is
 * about the process rather than about the ordering of two courses.
 */
const REGISTRAR_ACTION =
  /\b(drop|dropping|add|adding|withdraw\w*|swap|register|registering|registration|enroll\w*|sign up|waitlist|deadline|refund|petition|override|transcript|hold)\b/i;

/**
 * Whether the board itself is in a legal order. Checked before the single
 * course prerequisite shape, which owns the phrase "the right order" too.
 */
const ORDER_SHAPE =
  /\bin (the )?right order\b|\bin order\b|\bdoes my (plan|board|schedule) work\b|\bis my (plan|board|schedule) (ok|okay|valid|right|legal)\b|\bany prereq\w* (problems?|issues?)\b|\bdid i (mess|screw) (it |this )?up\b/i;

/**
 * Degree progress. Deterministic in scheduler.areaProgress, and an LLM must
 * never be the thing that tells somebody they are on track to graduate.
 */
const REQUIREMENT_SHAPE =
  /\b(on track|behind|still need|left to take|left to go|how many credits?|credits? (left|to go|short)|am i (missing|done|finished)|requirements?|gen ?eds?|general education|degree audit|graduate (on time|in \d)|finish (on time|in \d))\b/i;

/**
 * Progress words, which only mean anything against a board.
 *
 * "What are the general education requirements" is a question about a published
 * page and belongs upstream. "What gen eds are left" cannot be asked of a page
 * at all. Without this the second one needs a pronoun to be routed correctly,
 * and students do not put one there.
 */
const PROGRESS_WORD =
  /\b(left|remaining|still|on track|behind|so far|already|done|covered|missing|short)\b/i;

/**
 * A course overview. TRU cannot answer this at Illinois: its catalog chunks are
 * titled "Course Catalog (part N)" with no course-code boost, and I measured
 * "Tell me about CS 225" returning two faculty biography pages above anything
 * about the course.
 */
const COURSE_SHAPE =
  /\btell me about\b|\bwhat is\b|\bwhat'?s\b|\bwhat are\b|\bwhat does .{0,20}\bcover\b|\bhow many credits?\b|\bhow many hours?\b|\bwhat level\b|\bcross.?listed\b|\bsame as\b|\bdescription\b|\bwhat.{0,12}\babout\b|\bcount as\b|\bcounts? for\b|\bgen ?ed\b/i;

/**
 * Grade history for one named course. TRU owns this one outright: it has the
 * DAIR chunk, it slices exactly that course's block into the excerpt, and its
 * prompt carries the plus/minus and withdrawal rules that govern the prose.
 */
const GRADE_SHAPE =
  /\bhow hard\b|\bgrade distribution\b|\baverage gpa\b|\b(which|what|who|best|good)\b[^?]{0,30}\b(instructors?|professors?|prof|teacher)\b|\bwho taught\b|\beasy a'?s?\b|\bgpa booster\b|\bwithdrawal rate\b|\bhow many (people|students) (fail|drop|withdraw)\b|\bfail rate\b|\bcurved?\b|\bgrades? easier\b/i;

/**
 * Plain difficulty wording, which is a grade question once a course is named
 * and no column is.
 *
 * GRADE_SHAPE carries "how hard" and nothing looser, so "is CS 225 too hard"
 * fell through to the load detector, matched its "too hard" branch, and was
 * answered with the weight of whatever column was open. Guarded by the caller
 * on a named course and the absence of any term reference, because "is my
 * spring too hard" is the same words about a different thing.
 */
const COURSE_DIFFICULTY_SHAPE = /\b(hard|tough|brutal|difficult|easy|rough|heavy|a lot of work)\b/i;

/**
 * Whether the question is about this student rather than about the university.
 *
 * "What are the general education requirements at Illinois" is TRU's: it is a
 * question about a published page. "What gen eds do I still need" is this
 * side's: it is a measurement of the board. Same nouns, different question, and
 * the pronoun is the only thing that separates them.
 */
const SELF_SCOPE = /\b(i|i'm|im|i've|ive|my|mine|me|we|our)\b/i;

/**
 * The opposite: the question says out loud that it is about everybody else.
 *
 * "Is the fall semester busy for everyone" names a season, and naming a season
 * is otherwise enough for the load detector to claim a question. It is a
 * question about the university and it belongs upstream, so the phrase that
 * says so is read rather than ignored.
 */
const WORLD_SCOPE =
  /\bat (illinois|uiuc|u of i)\b|\bfor (everyone|everybody|most people|most students|students|freshmen|freshman)\b|\bin general\b|\bgenerally\b|\bon average\b/i;

const BOARD_SCOPE =
  /\b(my|mine|these|this (term|semester|spring|fall|summer|year|schedule|plan)|next (term|semester|spring|fall|summer|year)|on my (board|plan|schedule))\b/i;

/**
 * "This one", "it", "its prerequisites": meaningless off the board, so never
 * forwarded unresolved.
 *
 * Bare "this" and "that" only count when nothing follows them, or when they
 * follow a word that makes them the object. Matching every "this" turned "is
 * there a career fair this fall?" into "is there a career fair CS 225 fall?"
 * and sent the open card upstream inside an unrelated question.
 */
const PRONOUN_SHAPE =
  /\b(this|that) (one|class|course)\b|\b(this|that|it)\s*[?.!,]|\b(this|that|it)$|\b(for|before|after|about|take|taking|drop|is|are|was|were) (it|this|that)\b|\b(its|their) \w+/i;

const CODE_RE = /\b([A-Z]{2,4})\s?(\d{3})\b/g;

// ---------------------------------------------------------------------------
// Reference resolution, run before the detectors
// ---------------------------------------------------------------------------

export interface ResolvedCourse {
  code: string;
  /** How it was found. Only a pronoun or a title gets rewritten before sending. */
  via: 'code' | 'selected' | 'only-planned' | 'title';
  /** The question with any pronoun replaced by the code. */
  rewritten: string;
  /** True when the code is in none of the four data files. */
  unknown: boolean;
}

/** Every code in the text that any of the four files knows about. */
function codesInText(raw: string, ctx: AskContext): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const m of raw.toUpperCase().matchAll(CODE_RE)) {
    const code = `${m[1]} ${m[2]}`;
    if (seen.has(code)) continue;
    seen.add(code);
    // The catalog drops graduate and independent-study rows, so byCode alone
    // would report CS 598 as a course that does not exist. Any file knowing the
    // code is enough to treat it as real.
    const real =
      ctx.data.byCode.has(code) ||
      ctx.data.facts.has(code) ||
      ctx.data.grades.has(code) ||
      ctx.sectionRows.has(code);
    (real ? known : unknown).push(code);
  }
  return { known, unknown };
}

/**
 * Which course the question is about.
 *
 * Resolution order is deliberate. An explicit code always wins, because a
 * student who typed one meant it. A pronoun falls back to the open card, which
 * is the thing TRU structurally cannot know. A title match is last and only when
 * it is unambiguous. Two candidates is never a guess; the caller asks back.
 */
export function resolveCourse(raw: string, ctx: AskContext): ResolvedCourse | null {
  const found = codesInText(raw, ctx);
  if (found.known.length > 0) {
    return { code: found.known[0], via: 'code', rewritten: raw, unknown: false };
  }
  if (found.unknown.length > 0) {
    return { code: found.unknown[0], via: 'code', rewritten: raw, unknown: true };
  }

  if (!PRONOUN_SHAPE.test(raw)) {
    // A title the student typed out, but only when exactly one board course
    // answers to it. "data structures" with two matching courses is a guess.
    const lowered = raw.toLowerCase();
    const hits = ctx.planned.filter(
      (p) => p.title.length >= 6 && lowered.includes(p.title.toLowerCase()),
    );
    const codes = new Set(hits.map((h) => normCode(h.code)));
    if (codes.size === 1) {
      const code = [...codes][0];
      return { code, via: 'title', rewritten: substituteCode(raw, code), unknown: false };
    }
    return null;
  }

  if (ctx.selectedCode) {
    const code = normCode(ctx.selectedCode);
    return { code, via: 'selected', rewritten: substituteCode(raw, code), unknown: false };
  }

  const boardCodes = new Set(ctx.planned.map((p) => normCode(p.code)));
  if (boardCodes.size === 1) {
    const code = [...boardCodes][0];
    return { code, via: 'only-planned', rewritten: substituteCode(raw, code), unknown: false };
  }

  return null;
}

/** Replace the pronoun with the code, once, so nothing ambiguous goes upstream. */
function substituteCode(raw: string, code: string): string {
  if (/\b(its|their)\s+\w/i.test(raw)) return raw.replace(/\b(its|their)\b/i, `${code}'s`);
  const phrase = /\b(this one|that one|this class|this course|that class|that course)\b/i;
  if (phrase.test(raw)) return raw.replace(phrase, code);
  return raw.replace(/\b(this|that|it)\b/i, code);
}

export interface ResolvedTerm {
  termId: string;
  label: string;
  /**
   * How the column was found. The caller uses this to tell a term the student
   * pointed at from the column that merely happens to be in view, which is the
   * difference between answering their question and answering a different one.
   */
  via: 'explicit' | 'focus' | 'only' | 'next' | 'ordinal' | 'last' | 'first';
}

/**
 * Why no single column could be named.
 *
 * These are five different situations and they need five different sentences.
 * Collapsing them into one is what produced "Nothing is on the board yet, so
 * there is no term to weigh." for a student whose board held twenty one courses:
 * the resolver had failed to work out which column "my summer" meant, and the
 * answer reported that as the student having no plan. Not being able to read a
 * question is never evidence about the student's own work.
 */
export type TermMissReason =
  /** ctx.planned really is empty. The only case where emptiness may be claimed. */
  | 'empty-board'
  /** The student named a term the board does not run, "my summer" or "fall 2031". */
  | 'not-on-board'
  /** Several columns answer to what was named, "my spring" on a four year plan. */
  | 'ambiguous'
  /** "Next term" asked from the last column, which has nothing after it. */
  | 'past-end'
  /** No term reference at all, and more than one column to choose from. */
  | 'unclear';

export interface TermMiss {
  reason: TermMissReason;
  /**
   * The term the student appeared to name, already written the way the answer
   * should print it, so the reply can hand their own words back to them.
   */
  asked: string | null;
  /** The columns worth listing in an ask-back. Empty when listing them helps nobody. */
  candidates: PlannedCourse[];
}

const SEASON_WORD = /\b(spring|fall|autumn|summer|winter)\b/i;
const YEAR_WORD = /\b(20\d{2})\b/;

/** "my third semester". A board is ordered, so an ordinal names exactly one column. */
const ORDINAL_TERM =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+(?:term|semester)\b/i;

const ORDINAL_NUMBER: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  sixth: 6,
  '6th': 6,
  seventh: 7,
  '7th': 7,
  eighth: 8,
  '8th': 8,
  ninth: 9,
  '9th': 9,
  tenth: 10,
  '10th': 10,
};

/**
 * "My last semester" and "my final term".
 *
 * A plan holds no past, so there is no earlier term for "last" to point at and
 * the only reading left is the final column. The answer always prints the term
 * label first, so a student who meant something else sees it immediately.
 */
const LAST_TERM = /\b(?:last|final)\s+(?:term|semester)\b/i;
const NEXT_TERM = /\bnext\s+(?:term|semester)\b/i;
const THIS_TERM = /\b(?:this|current)\s+(?:term|semester)\b/i;

/**
 * Whether the question points at a column at all.
 *
 * The load answer needs this, because "is this too hard" about CS 225 and "is
 * my spring too hard" are different questions and the column in view is not
 * what separates them. Without it, a difficulty question about one course was
 * answered with the weight of whichever column happened to be open.
 */
export const TERM_REFERENCE = new RegExp(
  [SEASON_WORD, YEAR_WORD, ORDINAL_TERM, LAST_TERM, NEXT_TERM, THIS_TERM].map((r) => r.source).join('|'),
  'i',
);

/** "spring" -> "Spring", for printing a season back to the student. */
function seasonTitle(season: string): string {
  return season.charAt(0).toUpperCase() + season.slice(1);
}

function termOf(row: PlannedCourse, via: ResolvedTerm['via']): ResolvedTerm {
  return { termId: row.termId, label: row.termLabel, via };
}

/**
 * Which column the question is about.
 *
 * Returns three things rather than two. `term` is the column when there is
 * exactly one. `candidates` is what an ask-back should list, kept for callers
 * that only ever read those two. `miss` says WHY there is no column, which is
 * the field that stops a failed resolution being reported to the student as an
 * empty board.
 */
export function resolveTerm(
  raw: string,
  ctx: AskContext,
): { term: ResolvedTerm | null; candidates: PlannedCourse[]; miss: TermMiss | null } {
  const terms = uniqueTerms(ctx);
  const hit = (row: PlannedCourse, via: ResolvedTerm['via']) => ({
    term: termOf(row, via),
    candidates: [],
    miss: null,
  });
  const missed = (reason: TermMissReason, asked: string | null, candidates: PlannedCourse[] = []) => ({
    term: null,
    candidates,
    miss: { reason, asked, candidates },
  });

  if (terms.length === 0) return missed('empty-board', null);

  const yearMatch = YEAR_WORD.exec(raw);
  const seasonMatch = SEASON_WORD.exec(raw);
  const season = seasonMatch ? seasonMatch[1].toLowerCase().replace('autumn', 'fall') : null;

  if (season || yearMatch) {
    let matches = terms;
    if (season) matches = matches.filter((t) => t.season.toLowerCase() === season);
    if (yearMatch) matches = matches.filter((t) => String(t.year) === yearMatch[1]);

    if (matches.length === 1) return hit(matches[0], 'explicit');
    if (matches.length > 1) {
      // "My spring" on a four year board names four columns. The one in view
      // breaks the tie; otherwise the caller asks back rather than picking.
      const focused = matches.find((t) => t.termId === ctx.focusTermId);
      if (focused) return hit(focused, 'focus');
      return missed('ambiguous', null, matches);
    }

    // Named a term the board does not run. This is the case that used to be
    // reported as "nothing is on the board yet", which is a false statement
    // about the student's own work whenever the board holds anything at all.
    const asked =
      season && yearMatch
        ? `${seasonTitle(season)} ${yearMatch[1]}`
        : season
          ? `${seasonTitle(season)} term`
          : `term in ${yearMatch![1]}`;
    return missed('not-on-board', asked);
  }

  if (ORDINAL_TERM.test(raw)) {
    const word = ORDINAL_TERM.exec(raw)![1].toLowerCase();
    const n = ORDINAL_NUMBER[word] ?? 0;
    const row = terms[n - 1];
    if (row) return hit(row, 'ordinal');
    // Asking about the fifth term of a four term board. Saying which columns
    // exist is more use than a list to choose from.
    return missed('not-on-board', `${word} term`);
  }

  if (LAST_TERM.test(raw)) return hit(terms[terms.length - 1], 'last');

  if (NEXT_TERM.test(raw)) {
    const from = terms.findIndex((t) => t.termId === ctx.focusTermId);
    // Asked from the final column there is no next one. Falling through to the
    // column in view answered "next term" with the current term's weight and
    // labelled it as if it were the next, which is the wrong term entirely.
    if (from >= 0 && from + 1 >= terms.length) return missed('past-end', terms[from].termLabel);
    const next = from >= 0 ? terms[from + 1] : terms[0];
    if (next) return hit(next, 'next');
  }

  if (THIS_TERM.test(raw)) {
    const focused = terms.find((t) => t.termId === ctx.focusTermId);
    if (focused) return hit(focused, 'focus');
    if (terms.length === 1) return hit(terms[0], 'only');
    // Every column on a plan is still ahead of the student, so there is no
    // "current" one to pick. Guessing the first would answer about a term they
    // may not have meant.
    return missed('unclear', null, terms);
  }

  if (ctx.focusTermId) {
    const focused = terms.find((t) => t.termId === ctx.focusTermId);
    if (focused) return hit(focused, 'focus');
  }

  if (terms.length === 1) return hit(terms[0], 'only');

  return missed('unclear', null, terms);
}

/** One row per column, in board order. */
function uniqueTerms(ctx: AskContext): PlannedCourse[] {
  const seen = new Set<string>();
  const out: PlannedCourse[] = [];
  for (const course of ctx.planned) {
    if (seen.has(course.termId)) continue;
    seen.add(course.termId);
    out.push(course);
  }
  return out.sort((a, b) => a.index - b.index);
}

function coursesInTerm(ctx: AskContext, termId: string): PlannedCourse[] {
  return ctx.planned.filter((p) => p.termId === termId);
}

// ---------------------------------------------------------------------------
// Local answer 1: sections
// ---------------------------------------------------------------------------

type SectionFocus = 'building' | 'time' | 'instructor' | 'part' | 'online' | 'seats' | 'general';

function sectionFocusOf(raw: string): SectionFocus {
  if (/\b(seats?|full|waitlist|spots?)\b/i.test(raw)) return 'seats';
  if (/\bparts? of term\b/i.test(raw)) return 'part';
  if (/\bwho (teaches|is teaching)\b|\binstructors?\b|\bprofessors?\b/i.test(raw)) return 'instructor';
  if (/\b(building|room|classroom|where)\b/i.test(raw)) return 'building';
  if (/\bonline\b|\bin person\b/i.test(raw)) return 'online';
  if (/\b(what time|when|days?|meets?|meeting)\b/i.test(raw)) return 'time';
  return 'general';
}

/** "Section AL1, Lecture. Monday, Wednesday and Friday, 11:00AM to 11:50AM. ..." */
function describeSection(row: RawSection): string {
  const bits: string[] = [];
  const head = [row.section ? `Section ${row.section}` : null, row.type ?? null]
    .filter(Boolean)
    .join(', ');
  if (head) bits.push(head);
  const days = dayWords(row.days);
  const time = timeRange(row.start, row.end);
  if (days && time) bits.push(`${days}, ${time}`);
  else if (days) bits.push(days);
  else if (time) bits.push(time);
  bits.push(placeOf(row));
  if (row.instructors?.length) bits.push(joinList(row.instructors));
  if (row.crn) bits.push(`CRN ${row.crn}`);
  const avail = availabilityWord(row.availability);
  if (avail) bits.push(avail);
  return `${bits.join('. ')}.`;
}

/** One line per section type once there are too many sections to list. */
function digestByType(rows: RawSection[]): string[] {
  const byType = new Map<string, RawSection[]>();
  for (const row of rows) {
    const key = (row.type ?? 'Section').trim() || 'Section';
    const list = byType.get(key);
    if (list) list.push(row);
    else byType.set(key, [row]);
  }
  return [...byType.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([type, list]) => {
      const patterns = new Map<string, number>();
      for (const row of list) {
        const days = dayWords(row.days);
        const time = timeRange(row.start, row.end);
        if (!days) continue;
        const key = time ? `${days}, ${time}` : days;
        patterns.set(key, (patterns.get(key) ?? 0) + 1);
      }
      const top = [...patterns.entries()].sort((a, b) => b[1] - a[1])[0];
      const count = `${list.length} section${list.length === 1 ? '' : 's'}`;
      // Only name a time when most of the type meets at it. CS 225 runs ten
      // Thursday labs at five different times, and naming the most common of
      // them would be wrong for eight of the ten.
      if (top && top[1] / list.length >= 0.6) return `${type}, ${count}. Mostly ${top[0]}.`;
      return `${type}, ${count}.`;
    });
}

function answerSection(code: string, raw: string, ctx: AskContext): Routed {
  const term = ctx.data.sectionTerm;
  const rows = ctx.sectionRows.get(code) ?? [];
  const summary: SectionSummary | undefined = ctx.data.sections.get(code);
  const [subject] = splitCode(code);

  if (!term) {
    return local('section', 'No class schedule is loaded, so I cannot say where or when anything meets.', [], false);
  }

  if (rows.length === 0) {
    const url = scheduleTermUrl(ctx);
    const sources = url ? [sourceOf(1, `${term.label} Schedule`, url)] : [];
    if (!crawledSubjects(ctx).has(subject)) {
      // Silence here is the crawl's, not the university's. Reporting it as "not
      // offered" would be a fabricated fact about Illinois.
      return local(
        'section',
        `The ${term.label} schedule for ${subject} has not been read yet, so I have no sections for ${code}. Check the schedule page.`,
        sources,
        false,
      );
    }
    return local(
      'section',
      `The ${term.label} schedule does not list ${code}. That is the only term I have, so it may still run in another one.`,
      sources,
      false,
    );
  }

  const focus = sectionFocusOf(raw);
  const lines: string[] = [];
  const catalogTitle = ctx.data.byCode.get(code)?.title ?? null;

  if (focus === 'seats') {
    // Illinois publishes an availability word and nothing else. Inventing a
    // number here is the exact class of defect the house rules name.
    lines.push(
      `Illinois publishes no seat counts and no waitlist, so I cannot tell you how full ${code} is. The schedule marks each section open or closed and that is all it gives.`,
    );
  } else if (focus === 'part' && summary) {
    lines.push(`${code}, ${term.label}. ${partOfTermLine(summary)}`);
  } else if (focus === 'building' && summary) {
    lines.push(`${code}: ${buildingSentence(summary)}`);
  } else if (focus === 'instructor') {
    const names = summary?.instructors ?? [];
    if (names.length === 0) {
      lines.push(`The ${term.label} schedule lists no instructor for ${code} yet.`);
    } else {
      const top = names.slice(0, 4).map((i) => `${i.name} (${i.sections})`);
      lines.push(
        `${code} in ${term.label}: ${joinWithMore(top, names.length - top.length)}. The number is sections assigned.`,
      );
    }
  } else if (focus === 'online' && summary) {
    lines.push(
      summary.onlineOnly
        ? `Every ${term.label} section of ${code} is online.`
        : `${code} has in-person sections in ${term.label}. ${buildingSentence(summary)}`,
    );
  } else if (focus === 'time' && summary && summary.dayPatterns.length > 0) {
    // "When does it meet" is answered by the meeting pattern, so that is the
    // first line rather than a section count the student did not ask for.
    const named = summary.dayPatterns.slice(0, 3).map((p) => {
      const days = dayWords(p.pattern) ?? p.pattern;
      const time = timeRange(p.start, p.end);
      return time ? `${days} ${time} (${p.count})` : `${days} (${p.count})`;
    });
    // Semicolons, because a pattern spelled out as "Monday, Wednesday and
    // Friday" already contains the separator a comma list would use.
    const rest = summary.dayPatterns.length - named.length;
    const body = rest > 0 ? `${named.join('; ')}; and ${rest} more` : named.join('; ');
    lines.push(`${code} meets ${body}. The number in brackets is how many sections.`);
  } else if (catalogTitle) {
    lines.push(`${code}, ${catalogTitle}. ${rows.length} section${rows.length === 1 ? '' : 's'} in ${term.label}.`);
  } else {
    lines.push(`${code}. ${rows.length} section${rows.length === 1 ? '' : 's'} in ${term.label}.`);
  }

  // Four is where a list stops being readable. CS 225 has 44 sections, and a
  // wall of them is not an answer.
  if (rows.length <= 4) lines.push(rows.map(describeSection).join('\n'));
  else lines.push(digestByType(rows).join('\n'));

  if (summary) {
    if (summary.multiMeeting > 0) {
      lines.push(
        `${summary.multiMeeting} section${summary.multiMeeting === 1 ? ' has' : 's have'} two meetings in one row on the schedule page, so read those there rather than here.`,
      );
    }
    if (summary.restrictions.length > 0) {
      lines.push(`Restrictions on some sections: ${joinList(summary.restrictions.slice(0, 3))}.`);
    }
    // Illinois runs several parts of term inside one semester and the drop,
    // refund, credit/no-credit and grade-replacement dates are different for
    // each. No section answer ships without saying so.
    lines.push(focus === 'part' ? DEADLINE_DISCLAIMER : `${partOfTermLine(summary)} ${DEADLINE_DISCLAIMER}`);
  }

  const read = readOn(term.fetchedAt);
  lines.push(`Read from the ${term.label} schedule${read ? ` on ${read}` : ''}.`);

  const url = scheduleUrlFor(ctx, code);
  const sources = url ? [sourceOf(1, `${term.label} Schedule, ${code}`, url)] : [];
  return local('section', lines.join('\n\n'), sources);
}

/**
 * Time conflicts, which the planner deliberately cannot answer.
 *
 * The board holds courses, not sections, and CS 225 alone has 44 of them at
 * different hours. Picking one to check against would be a guess, and a guess
 * about whether two classes collide is the kind of answer a student registers
 * on.
 */
function answerConflicts(ctx: AskContext, term: ResolvedTerm | null): Routed {
  const url = scheduleTermUrl(ctx);
  const label = ctx.data.sectionTerm?.label ?? 'the published term';
  const where = term ? term.label : 'your board';
  const sources = url ? [sourceOf(1, `${label} Schedule`, url)] : [];
  return local(
    'section',
    `The board holds courses, not sections, so I cannot check ${where} for time conflicts. Most courses run many sections at different hours. Ask about one course and I will list when each of its sections meets.`,
    sources,
    false,
  );
}

/**
 * Where the earliest term's classes meet.
 *
 * "Where does my first class meet?" is one of the four questions the bar offers
 * and it used to return the course picker, which is not an answer to it. The
 * board settles which column comes first. It cannot settle which class in that
 * column starts earliest in the day, because a board holds courses and a course
 * runs many sections at different hours, so the answer says that out loud
 * instead of picking one and sending a student to the wrong building.
 */
function answerFirstClass(ctx: AskContext, term: ResolvedTerm | null, raw: string): Routed {
  const terms = uniqueTerms(ctx);
  if (terms.length === 0) {
    return local('section', 'Nothing is on the board yet, so there is no first class to place.', [], false);
  }

  // A term the student named out loud beats the first column. "Where does my
  // first class in spring 2028 meet" is a question about spring 2028.
  const column = term && term.via === 'explicit' ? term : termOf(terms[0], 'first');
  const courses = coursesInTerm(ctx, column.termId);
  if (courses.length === 0) {
    return local('section', `${column.label} has no courses in it yet.`, [], false);
  }
  // One course in the column is the whole answer, and the section answer is a
  // better one than anything this function would write.
  if (courses.length === 1) return answerSection(normCode(courses[0].code), raw, ctx);

  const schedule = ctx.data.sectionTerm;
  if (!schedule) {
    return local(
      'section',
      `${column.label} is the first term on your board, with ${courses.length} courses. No class schedule is loaded, so I cannot say where any of them meets.`,
      [],
      false,
    );
  }

  const lines: string[] = [];
  lines.push(
    `${column.label} is the first term on your board, with ${courses.length} courses. The board holds courses, not sections, so nothing here knows which one starts earliest in the day. Where each one meets:`,
  );

  const crawled = crawledSubjects(ctx);
  const shown = courses.slice(0, 6);
  for (const course of shown) {
    const code = normCode(course.code);
    const summary = ctx.data.sections.get(code);
    if (summary) {
      lines.push(`${code}: ${buildingSentence(summary)}`);
      continue;
    }
    // Silence here is the crawl's or the term's, never the university saying
    // the course does not run. Both sentences say which one it is.
    lines.push(
      crawled.has(splitCode(code)[0])
        ? `${code}: the ${schedule.label} schedule does not list it.`
        : `${code}: the ${schedule.label} schedule for ${splitCode(code)[0]} has not been read yet.`,
    );
  }
  if (courses.length > shown.length) {
    lines.push(`${courses.length - shown.length} more in that term. Ask about one by code.`);
  }

  const read = readOn(schedule.fetchedAt);
  lines.push(
    column.label === schedule.label
      ? `Read from the ${schedule.label} schedule${read ? ` on ${read}` : ''}.`
      : `Those rooms are the ${schedule.label} schedule's${read ? `, read on ${read}` : ''}. It is the only term I have, and rooms move.`,
  );

  const url = scheduleTermUrl(ctx);
  return local('section', lines.join('\n\n'), url ? [sourceOf(1, `${schedule.label} Schedule`, url)] : []);
}

// ---------------------------------------------------------------------------
// Local answer 2: how heavy a term is
// ---------------------------------------------------------------------------

const VERDICT_WORD: Record<string, string> = {
  light: 'reads light',
  normal: 'reads normal',
  heavy: 'reads heavy',
  brutal: 'reads brutal',
};

function gradeDetail(row: GradeRow | undefined): string {
  if (!row) return '';
  const bits: string[] = [];
  if (row.gpa !== null) bits.push(`${row.gpa.toFixed(2)} average GPA`);
  if (row.dfPct !== null) bits.push(`${row.dfPct}% D or F`);
  if (row.withdrawPct !== null) bits.push(`${row.withdrawPct}% withdrew`);
  if (row.n < THIN_SAMPLE) bits.push(`only ${row.n} grades`);
  return bits.join(', ');
}

function answerLoad(ctx: AskContext, term: ResolvedTerm): Routed {
  const courses = coursesInTerm(ctx, term.termId);
  if (courses.length === 0) {
    return local('load', `${term.label} is empty. Nothing to weigh yet.`, [], false);
  }

  const codes = courses.map((c) => normCode(c.code));
  const creditsByCode = new Map<string, number>();
  for (const code of codes) {
    const range = ctx.data.facts.get(code)?.creditRange;
    if (range?.known) creditsByCode.set(code, range.credits);
  }

  const load = termLoad(codes, ctx.data.grades, { bands: ctx.data.bands, creditsByCode });
  const credits = termCreditRange(
    codes.map((code) => ctx.data.byCode.get(code) ?? { id: code, code }),
    ctx.data.facts,
  );

  const lines: string[] = [];
  const creditText = credits.variable
    ? `${credits.min} to ${credits.max} credits`
    : `${credits.min} credit${credits.min === 1 ? '' : 's'}`;
  const unknownText = credits.unknown > 0 ? `, plus ${credits.unknown} whose credit hours the catalog does not list` : '';
  lines.push(
    `${term.label}: ${courses.length} course${courses.length === 1 ? '' : 's'}, ${creditText}${unknownText}.`,
  );

  if (load.avgDifficulty === null) {
    lines.push(
      `None of them has a grade row, so I have nothing to weigh the term with. Credit hours are all I can count here.`,
    );
    const sources = [sourceOf(1, DAIR.title, DAIR.url)];
    return local('load', lines.join('\n\n'), sources, false);
  }

  lines.push(
    `Average difficulty ${load.avgDifficulty} out of 100, which ${VERDICT_WORD[load.verdict] ?? 'reads normal'} against Illinois's own spread.`,
  );

  if (load.hard.length > 0) {
    const named = load.hard.slice(0, 3).map((code) => {
      const detail = gradeDetail(ctx.data.grades.get(code));
      return detail ? `${code} (${detail})` : code;
    });
    lines.push(
      `${load.hard.length === 1 ? 'One sits' : `${load.hard.length} sit`} in Illinois's hardest band: ${joinList(named)}.`,
    );
  } else {
    lines.push("None of them is in Illinois's hardest band.");
  }

  const unweighed = codes.length - load.weighed;
  if (unweighed > 0) {
    const missing = codes.filter((code) => !ctx.data.grades.has(code));
    lines.push(
      `${load.weighed} of ${codes.length} were weighed. No grade history for ${joinWithMore(missing.slice(0, 4), missing.length - Math.min(missing.length, 4))}, so ${missing.length === 1 ? 'it is' : 'they are'} not in that average.`,
    );
  }

  lines.push(
    `${gradeHistoryLine(ctx)} The spread between instructors inside one course is usually wider than the gap between courses.`,
  );

  return local('load', lines.join('\n\n'), [sourceOf(1, DAIR.title, DAIR.url)]);
}

/** "Which of my classes is hardest", ranked, over one term or the whole board. */
function answerHardest(ctx: AskContext, term: ResolvedTerm | null, easiest: boolean): Routed {
  const pool = term ? coursesInTerm(ctx, term.termId) : ctx.planned;
  const where = term ? term.label : 'your board';
  if (pool.length === 0) {
    return local('load', `Nothing is on ${where} yet.`, [], false);
  }

  const scored = pool
    .map((course) => {
      const code = normCode(course.code);
      const row = ctx.data.grades.get(code);
      const label = difficultyLabel(row, ctx.data.bands);
      return { course, code, row, difficulty: label.kind === 'band' ? label.difficulty : null };
    })
    .filter((x) => x.difficulty !== null)
    .sort((a, b) => (easiest ? (a.difficulty! - b.difficulty!) : (b.difficulty! - a.difficulty!)));

  const unscored = pool.length - scored.length;
  if (scored.length === 0) {
    return local(
      'load',
      `None of the ${pool.length} course${pool.length === 1 ? '' : 's'} on ${where} has a grade row, so I cannot rank them.`,
      [sourceOf(1, DAIR.title, DAIR.url)],
      false,
    );
  }

  const lines: string[] = [];
  const top = scored[0];
  const detail = gradeDetail(top.row);
  lines.push(
    `${easiest ? 'Easiest' : 'Hardest'} on ${where} by grade history: ${top.code}${detail ? `, ${detail}` : ''}.`,
  );

  if (scored.length > 1) {
    lines.push(
      scored
        .slice(0, 5)
        .map((x, i) => `${i + 1}. ${x.code}, difficulty ${x.difficulty} out of 100.`)
        .join('\n'),
    );
  }

  if (unscored > 0) {
    lines.push(
      `${unscored} course${unscored === 1 ? '' : 's'} on it ${unscored === 1 ? 'has' : 'have'} no grade row, so ${unscored === 1 ? 'it is' : 'they are'} not in that ranking.`,
    );
  }

  if (top.row && top.row.n < THIN_SAMPLE) {
    lines.push(`That top row is built on ${top.row.n} grades, which is a small sample.`);
  }

  lines.push(gradeHistoryLine(ctx));
  return local('load', lines.join('\n\n'), [sourceOf(1, DAIR.title, DAIR.url)]);
}

/**
 * "Which term is hardest", one column against another.
 *
 * Kept apart from answerHardest on purpose. That one ranks the cards, and it is
 * the right answer to "which of my classes is hardest". A student asking which
 * TERM is hardest is asking which column to be careful about, and handing them
 * the name of a course instead is an answer to a question they did not ask.
 */
function answerHardestTerm(ctx: AskContext, easiest: boolean): Routed {
  const terms = uniqueTerms(ctx);
  if (terms.length === 0) {
    return local('load', 'Nothing is on the board yet, so there is no term to weigh.', [], false);
  }
  // One column is not a comparison. Weighing it is what the student wanted to
  // know anyway, and calling it the hardest of one term would be silly.
  if (terms.length === 1) return answerLoad(ctx, termOf(terms[0], 'only'));

  const weighed = terms.map((row) => {
    const codes = coursesInTerm(ctx, row.termId).map((c) => normCode(c.code));
    const creditsByCode = new Map<string, number>();
    for (const code of codes) {
      const range = ctx.data.facts.get(code)?.creditRange;
      if (range?.known) creditsByCode.set(code, range.credits);
    }
    return {
      row,
      courses: codes.length,
      load: termLoad(codes, ctx.data.grades, { bands: ctx.data.bands, creditsByCode }),
    };
  });

  const ranked = weighed
    .filter((t) => t.load.avgDifficulty !== null)
    .sort((a, b) =>
      easiest
        ? a.load.avgDifficulty! - b.load.avgDifficulty!
        : b.load.avgDifficulty! - a.load.avgDifficulty!,
    );

  const sources = [sourceOf(1, DAIR.title, DAIR.url)];
  if (ranked.length === 0) {
    return local(
      'load',
      `No course on your ${terms.length} terms has a grade row, so there is nothing to rank them by. Credit hours are all I can count here.`,
      sources,
      false,
    );
  }

  const lines: string[] = [];
  const top = ranked[0];
  lines.push(
    `${easiest ? 'Lightest' : 'Hardest'} term on your board by grade history: ${top.row.termLabel}, average difficulty ${top.load.avgDifficulty} out of 100, which ${VERDICT_WORD[top.load.verdict] ?? 'reads normal'} against Illinois's own spread.`,
  );

  // How much of each term the average actually rests on. "1 of its 1 course"
  // is what counting alone produces, and it reads like a machine.
  // Only terms with a grade row reach this list, so a one-course term here
  // always has that one course weighed.
  const fromCount = (weighedCount: number, courses: number): string => {
    if (courses === 1) return 'from its one course';
    if (weighedCount === courses) return `from all ${courses} of its courses`;
    return `from ${weighedCount} of its ${courses} courses`;
  };

  lines.push(
    ranked
      .map(
        (t, i) =>
          `${i + 1}. ${t.row.termLabel}, ${t.load.avgDifficulty} out of 100, ${fromCount(t.load.weighed, t.courses)}.`,
      )
      .join('\n'),
  );

  if (top.load.hard.length > 0) {
    lines.push(
      `${top.load.hard.length === 1 ? 'One course' : `${top.load.hard.length} courses`} in ${top.row.termLabel} sit${top.load.hard.length === 1 ? 's' : ''} in Illinois's hardest band: ${joinList(top.load.hard.slice(0, 4))}.`,
    );
  }

  const silent = weighed.filter((t) => t.load.avgDifficulty === null);
  if (silent.length > 0) {
    lines.push(
      `${joinList(silent.map((t) => t.row.termLabel))} ${silent.length === 1 ? 'has' : 'have'} no course with a grade row, so ${silent.length === 1 ? 'it is' : 'they are'} not in that ranking.`,
    );
  }

  lines.push(
    `${gradeHistoryLine(ctx)} A term average is only as good as the courses under it, and courses with no grade row are not in one.`,
  );

  return local('load', lines.join('\n\n'), sources);
}

// ---------------------------------------------------------------------------
// Local answer 3: prerequisites
// ---------------------------------------------------------------------------

/**
 * Words in a prerequisite sentence that name something the catalog cannot be
 * checked against.
 *
 * CS 124 reads "Three years of high school mathematics or MATH 112", and the
 * parser keeps only the code, so a board with no MATH 112 on it looks short
 * when the student may well have satisfied it in high school. MATH 257's "CS
 * 101 or equivalent programming experience" is the same shape. Saying "you are
 * short MATH 112" with no warning is a fabricated fact about the student.
 */
const UNCHECKABLE =
  /\b(high school|placement|proficienc\w+|equivalent|experience|consent|permission|standing|approval|department)\b/i;

/** "CS 173, MATH 213 or MATH 347". The alternatives inside one group are ORs. */
function joinOr(codes: string[]): string {
  if (codes.length <= 1) return codes[0] ?? '';
  return `${codes.slice(0, -1).join(', ')} or ${codes[codes.length - 1]}`;
}

function groupWords(group: PrereqGroup): string {
  const body = group.any.length > 1 ? `one of ${joinOr(group.any)}` : group.any[0];
  return group.concurrent ? `${body} (the same term is allowed)` : body;
}

/**
 * Groups are ANDed, alternatives inside a group are ORed, and the two joins
 * have to look different. Rendering both with "and" produced "CS 374 needs one
 * of CS 173 and MATH 213 and CS 225", which reads as three alternatives and is
 * the opposite of what the catalog says.
 */
function groupsSentence(groups: PrereqGroup[]): string {
  const parts = groups.map(groupWords);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}`;
}

/**
 * The class standing a course requires, said plainly and without a verdict.
 *
 * The verdict is deliberately missing. Standing is earned hours, and earned
 * hours include transfer and test credit that the board does not carry, so
 * counting the cards and announcing "you will be a junior by then" would be a
 * fabricated fact about the student. The requirement and the threshold are both
 * published, so both are printed, and the arithmetic is left to the student.
 */
function standingSentence(spec: PrereqSpec): string | null {
  if (!spec.standing) return null;
  return `It also needs ${spec.standing} standing, which Illinois counts from ${STANDING_HOURS[spec.standing]} earned hours. Your board does not say how many hours you have banked, so that part is yours to check.`;
}

function answerPrereq(code: string, ctx: AskContext): Routed {
  const facts: CourseFacts | undefined = ctx.data.facts.get(code);
  if (!facts) {
    return local(
      'prereq',
      `${code} is not in the catalog I have, so I cannot read its prerequisites.`,
      [],
      false,
    );
  }

  const catalogSource = [sourceOf(1, `${splitCode(code)[0]} courses, Illinois catalog`, facts.catalogUrl)];
  const spec = facts.prereq;

  if (!spec || spec.groups.length === 0) {
    // A course with no parsed group can still have a real requirement. CS 497
    // requires junior standing and CS 498 says the prerequisites are in the
    // class schedule, and calling either of them "no prerequisite" is the
    // false statement this branch exists to avoid.
    const lines: string[] = [];
    if (spec?.standing) {
      const hours = STANDING_HOURS[spec.standing];
      lines.push(
        `${code} needs ${spec.standing} standing, which Illinois counts from ${hours} earned hours. Your board does not say how many hours you have banked, so that part is yours to check.`,
      );
    }
    if (spec?.note) {
      // 51 courses, CS 498 among them, whose page says the prerequisites are
      // published per topic somewhere this product does not crawl. "The catalog
      // lists no course prerequisite" would be a false statement about every
      // one of them, so the note gets its own sentence and its own link.
      lines.push(
        `${code} has prerequisites and the catalog does not print them. Its page reads: "${spec.note}" Each topic sets its own, so look up the section you want in the class schedule.`,
      );
      const scheduleUrl = scheduleUrlFor(ctx, code);
      const sources = scheduleUrl
        ? [
            ...catalogSource,
            sourceOf(
              catalogSource.length + 1,
              `${ctx.data.sectionTerm?.label ?? 'Class'} Schedule, ${code}`,
              scheduleUrl,
            ),
          ]
        : catalogSource;
      return local('prereq', lines.join('\n\n'), sources);
    }
    lines.push(
      spec?.text
        ? `The catalog lists no course prerequisite for ${code}. Its own sentence reads: "${spec.text}"`
        : `The catalog lists no prerequisite for ${code}.`,
    );
    return local('prereq', lines.join('\n\n'), catalogSource);
  }

  // Everything scheduled before this course counts, plus anything completed.
  // A course in the same term counts only where the catalog allows concurrent
  // registration, which missingPrerequisiteGroups already enforces.
  const placed = ctx.planned.find((p) => normCode(p.code) === code) ?? null;
  const earlier = new Set<string>([...ctx.completedCodes].map(normCode));
  const sameTerm = new Set<string>();
  if (placed) {
    for (const course of ctx.planned) {
      const other = normCode(course.code);
      if (other === code) continue;
      if (course.index < placed.index) earlier.add(other);
      else if (course.index === placed.index) sameTerm.add(other);
    }
  } else {
    for (const course of ctx.planned) earlier.add(normCode(course.code));
  }

  const { missing, uncertain, priorLearning } = missingPrerequisiteGroups(
    spec,
    earlier,
    sameTerm,
    ctx.data.equivalents,
  );

  const lines: string[] = [];
  lines.push(`${code} needs ${groupsSentence(spec.groups)}.`);

  // Said before the board is measured, so a student reading "as planned, Fall
  // 2028 works" has already been told that the course also gates on standing.
  const standing = standingSentence(spec);
  if (standing) lines.push(standing);

  if (placed) {
    // priorLearning counts here as well as missing. "Everything it needs comes
    // earlier on your board" is a false sentence about CS 124 in a first fall:
    // MATH 112 is not on the board, and whether the student needs it is a
    // question about their school years that nothing here can answer.
    if (missing.length === 0 && uncertain.length === 0 && priorLearning.length === 0) {
      lines.push(`As planned, ${placed.termLabel} works. Everything it needs comes earlier on your board.`);
    } else if (missing.length === 0 && priorLearning.length > 0) {
      lines.push(
        `Nothing on your board blocks ${placed.termLabel}. What is still open is the line below, and it is about your own school record rather than your board.`,
      );
    } else if (missing.length > 0) {
      lines.push(
        `Before ${placed.termLabel} you are short ${groupsSentence(missing)}. Nothing earlier on your board covers that.`,
      );
    }
    if (uncertain.length > 0) {
      lines.push(
        `I could not read ${joinList(uncertain.map((g) => g.source.trim()))} well enough to decide. Take that one to an advisor rather than my reading of it.`,
      );
    }
  } else {
    const have = spec.groups.filter((g) => g.any.some((c) => earlier.has(normCode(c))));
    if (have.length > 0) lines.push(`Your board already covers ${groupsSentence(have)}.`);
    if (missing.length > 0) lines.push(`It does not yet cover ${groupsSentence(missing)}.`);
  }

  // The one part of a prerequisite this product cannot check, said plainly
  // rather than passed over. Nothing in the catalog or the schedule records
  // what a student did before university.
  for (const group of priorLearning) {
    lines.push(
      `The catalog also accepts ${group.priorLearning} instead of ${joinList(group.any)}. You are the only one who knows whether you have that.`,
    );
  }

  if (spec.escape === 'consent') {
    lines.push('The catalog also allows departmental consent instead.');
  } else if (spec.escape === 'standing') {
    lines.push('The catalog also allows it on standing instead.');
  } else if (spec.escape === 'either') {
    lines.push('The catalog also allows consent or standing instead.');
  }

  // The parser drops things a sentence really says, "Permission of department"
  // among them, so the registrar's own words are printed every time and are not
  // optional.
  if (spec.text) lines.push(`The catalog's own sentence: "${spec.text}"`);
  if (spec.text && UNCHECKABLE.test(spec.text)) {
    lines.push('That sentence names something the catalog cannot be checked against, so read it before you count on my answer.');
  }
  if (spec.confidence === 'low') {
    lines.push('That sentence is written in a shape I read with low confidence, so check it against the catalog.');
  }

  return local('prereq', lines.join('\n\n'), catalogSource);
}

/**
 * Whether the board's own order is legal, end to end.
 *
 * This is the question a student actually means by "does my plan work", and it
 * is the one TRU cannot touch: it needs every course on the board, in order,
 * checked against the catalog's own prerequisite sentences.
 */
function answerOrder(ctx: AskContext): Routed {
  if (ctx.planned.length === 0) {
    return local('prereq', 'Nothing is on the board yet, so there is no order to check.', [], false);
  }

  const problems: string[] = [];
  const unreadable: string[] = [];
  /** Prerequisites the catalog lets school work satisfy. Only the student knows. */
  const yourCall: string[] = [];
  let checked = 0;

  for (const course of ctx.planned) {
    const code = normCode(course.code);
    const spec = ctx.data.facts.get(code)?.prereq;
    if (!spec || spec.groups.length === 0) continue;
    checked += 1;

    const earlier = new Set<string>([...ctx.completedCodes].map(normCode));
    const sameTerm = new Set<string>();
    for (const other of ctx.planned) {
      const c = normCode(other.code);
      if (c === code) continue;
      if (other.index < course.index) earlier.add(c);
      else if (other.index === course.index) sameTerm.add(c);
    }

    const { missing, uncertain, priorLearning } = missingPrerequisiteGroups(
      spec,
      earlier,
      sameTerm,
      ctx.data.equivalents,
    );
    if (missing.length > 0) {
      const caveat = UNCHECKABLE.test(spec.text)
        ? `\n  The catalog: "${spec.text}" Part of that is something I cannot check.`
        : `\n  The catalog: "${spec.text}"`;
      problems.push(`${code} in ${course.termLabel}: nothing earlier covers ${groupsSentence(missing)}.${caveat}`);
    }
    if (uncertain.length > 0) {
      unreadable.push(`${code} in ${course.termLabel}`);
    }
    // Not a problem with the order of the board. It is a question about the
    // student that this product has no answer to, so it is listed apart from
    // the ordering errors rather than counted as one.
    for (const group of priorLearning) {
      yourCall.push(
        `${code} in ${course.termLabel}: ${group.priorLearning}, or ${joinList(group.any)}. Nothing on your board covers the course, and I cannot see what you did in school.`,
      );
    }
  }

  const lines: string[] = [];
  lines.push(
    `${ctx.planned.length} courses across ${uniqueTerms(ctx).length} terms. ${checked} of them publish a prerequisite.`,
  );
  if (problems.length === 0) {
    // Narrower wording when something is still open. "Nothing runs before
    // something it needs" would cover the school-work line below and deny it.
    lines.push(
      yourCall.length === 0
        ? 'Nothing on the board runs before something it needs.'
        : 'No course on the board runs before another course it needs.',
    );
  } else {
    lines.push(problems.slice(0, 6).join('\n'));
    if (problems.length > 6) lines.push(`${problems.length - 6} more like that.`);
  }
  if (unreadable.length > 0) {
    lines.push(
      `I could not read the prerequisite sentence for ${joinWithMore(unreadable.slice(0, 4), unreadable.length - Math.min(unreadable.length, 4))} well enough to decide. Take those to an advisor rather than my reading of them.`,
    );
  }
  if (yourCall.length > 0) {
    lines.push(`These depend on what you did before university:\n${yourCall.slice(0, 4).join('\n')}`);
  }
  if (problems.length > 0) {
    lines.push('Ask about one of those by code and I will show what your board already covers.');
  }

  return local('prereq', lines.join('\n\n'), [
    sourceOf(1, 'Courses of Instruction, Illinois catalog', 'https://catalog.illinois.edu/courses-of-instruction/'),
  ]);
}

// ---------------------------------------------------------------------------
// Local answer 4: what a course is
// ---------------------------------------------------------------------------

/** The first sentence or two of the catalog description, never a paraphrase. */
function shortDescription(text: string, limit = 260): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= limit) return clean;
  const cut = clean.lastIndexOf('. ', limit);
  return cut > 60 ? clean.slice(0, cut + 1) : `${clean.slice(0, limit).trim()}...`;
}

/**
 * The grade row a cross-listed course's numbers really came from.
 *
 * A class taught under two codes is reported to the registrar under one of
 * them, so CS 468 has no row of its own while the identical ADV 492 has 114
 * grades. 503 undergraduate courses are in that position. Reading the twin's
 * row is right, because it is the same class and the same students; saying
 * nothing about whose row it is would let a student think Illinois published
 * these numbers under the code they are looking at.
 */
function twinGradeRow(
  code: string,
  facts: CourseFacts,
  ctx: AskContext,
): { code: string; row: GradeRow; difficulty: number } | null {
  const twins = [...(facts.equivalents ?? []), ...(ctx.data.equivalents.get(code) ?? [])];
  for (const raw of twins) {
    const twin = normCode(raw);
    if (twin === code) continue;
    const row = ctx.data.grades.get(twin);
    const label = difficultyLabel(row, ctx.data.bands);
    if (row && label.kind === 'band') return { code: twin, row, difficulty: label.difficulty };
  }
  return null;
}

/**
 * What a course is, from the catalog.
 *
 * Measured on TRU's real Illinois corpus: "Tell me about CS 225 at Illinois"
 * returns two faculty biography pages and a "Courses (part 1)" chunk, because
 * the catalog is chunked with generic titles and no course-code boost. The
 * planner holds the row itself.
 */
function answerCourse(code: string, raw: string, ctx: AskContext): Routed {
  const facts: CourseFacts | undefined = ctx.data.facts.get(code);
  const course = ctx.data.byCode.get(code);
  if (!facts || !course) {
    return local('course', `${code} is not in the undergraduate catalog I have.`, [], false);
  }

  const sources: Source[] = [
    sourceOf(1, `${splitCode(code)[0]} courses, Illinois catalog`, facts.catalogUrl),
  ];
  const lines: string[] = [];

  // A gen-ed question gets the gen-ed answer first. Burying it under the title
  // and the credit line answers a question the student did not ask.
  if (/\bgen ?ed\b|\bgeneral education\b|\bcounts? (for|as|toward)\b/i.test(raw)) {
    lines.push(
      facts.genEd.length > 0
        ? `${code} counts as ${joinList(facts.genEd)}.`
        : `The catalog gives ${code} no gen-ed tag.`,
    );
  }

  const head = [`${code}, ${course.title}`, creditLabel(facts.creditRange).toLowerCase()];
  lines.push(`${head.join('. ')}.`);

  const description = shortDescription(course.description);
  if (description) lines.push(description);

  const extras: string[] = [];
  if (facts.genEd.length > 0 && lines.length > 0 && !/counts as/.test(lines[0])) {
    extras.push(`Counts as ${joinList(facts.genEd)}.`);
  }
  if (facts.equivalents.length > 0) extras.push(`Same course as ${joinList(facts.equivalents)}.`);
  if (facts.exclusions.length > 0) {
    extras.push(`No credit for both this and ${joinList(facts.exclusions)}.`);
  }
  if (extras.length > 0) lines.push(extras.join(' '));

  if (facts.prereq && facts.prereq.groups.length > 0) {
    const standing = standingSentence(facts.prereq);
    lines.push(`Needs ${groupsSentence(facts.prereq.groups)}.${standing ? ` ${standing}` : ''}`);
  } else if (facts.prereq?.note) {
    // Before the plain sentence branch, because these 51 pages are the ones a
    // reader is most likely to mistake for a course with nothing in front of
    // it. The page says the requirement exists and is published per topic.
    lines.push(
      `It has prerequisites and the catalog does not print them: "${facts.prereq.note}" The class schedule carries them topic by topic.`,
    );
  } else if (facts.prereq?.text) {
    lines.push(`The catalog's own prerequisite sentence: "${facts.prereq.text}"`);
  } else {
    lines.push('The catalog lists no prerequisite.');
  }

  const summary = ctx.data.sections.get(code);
  const term = ctx.data.sectionTerm;
  if (summary && term) {
    lines.push(`${summary.total} section${summary.total === 1 ? '' : 's'} in ${term.label}. ${buildingSentence(summary)}`);
    const url = scheduleUrlFor(ctx, code);
    if (url) sources.push(sourceOf(sources.length + 1, `${term.label} Schedule, ${code}`, url));
  }

  const row = ctx.data.grades.get(code);
  const label = difficultyLabel(row, ctx.data.bands);
  const borrowed = row ? null : twinGradeRow(code, facts, ctx);
  if (row && label.kind === 'band') {
    const detail = gradeDetail(row);
    lines.push(`Grade history: ${detail || `difficulty ${label.difficulty} out of 100`}. ${gradeHistoryLine(ctx)}`);
    sources.push(sourceOf(sources.length + 1, DAIR.title, DAIR.url));
  } else if (borrowed) {
    // The registrar files one cross-listed class under whichever code reported
    // it, so 503 courses have real history under a name that is not their own.
    // Printing the numbers silently hides that; printing nothing would tell a
    // student no grades exist when they do.
    lines.push(
      `Grade history: ${gradeDetail(borrowed.row) || `difficulty ${borrowed.difficulty} out of 100`}. The registrar filed those under ${borrowed.code}, which is this same class under its other code. ${gradeHistoryLine(ctx)}`,
    );
    sources.push(sourceOf(sources.length + 1, DAIR.title, DAIR.url));
  } else {
    // A course with no grade row gets no difficulty claim, not a hedge.
    lines.push('No grade history is published for this course.');
  }

  return local('course', lines.join('\n\n'), sources);
}

// ---------------------------------------------------------------------------
// Local answer 5: degree progress
// ---------------------------------------------------------------------------

const SELF_SERVICE =
  'This is the published requirement list measured against your board. The degree audit in Student Self-Service is the record that counts.';

function answerRequirements(ctx: AskContext): Routed {
  const program = ctx.program;
  if (!program) {
    return local('requirements', 'No degree program is set on the board, so there is nothing to measure against.', [], false);
  }

  const have = new Set<string>();
  for (const code of ctx.completedCodes) {
    const c = normCode(code);
    have.add(c);
    for (const alias of ctx.data.equivalents.get(c) ?? []) have.add(alias);
  }
  for (const course of ctx.planned) {
    const c = normCode(course.code);
    have.add(c);
    for (const alias of ctx.data.equivalents.get(c) ?? []) have.add(alias);
  }

  // The alias map goes in because `have` above was built with aliases in it.
  // Without it GER 261 and JS 261, one class under two codes, are counted as
  // two courses and the general education row reads nine hours too high.
  const progress = areaProgress(program, have, ctx.data.equivalents);
  const done = progress.filter((p) => p.satisfied);
  const open = progress.filter((p) => !p.satisfied && p.area.hours > 0).sort((a, b) => a.percent - b.percent);
  const unmeasured = progress.filter((p) => p.area.hours === 0);

  const lines: string[] = [];
  lines.push(
    done.length === 0
      ? `${program.name}. None of its ${progress.length} requirement areas is complete on your board yet.`
      : `${program.name}. ${done.length} of ${progress.length} requirement areas are complete on your board.`,
  );

  if (open.length > 0) {
    lines.push(
      open
        .slice(0, 5)
        .map((p) => `${p.area.label}: ${p.earned} of ${p.area.hours} hours.`)
        .join('\n'),
    );
    if (open.length > 5) lines.push(`${open.length - 5} more area${open.length - 5 === 1 ? ' is' : 's are'} still open.`);
  } else {
    lines.push('Every area with published hours is covered.');
  }

  if (unmeasured.length > 0) {
    lines.push(
      `${unmeasured.length} area${unmeasured.length === 1 ? '' : 's'} on that page publish no hour total, so I cannot measure ${unmeasured.length === 1 ? 'it' : 'them'}: ${joinList(unmeasured.slice(0, 3).map((p) => p.area.label))}.`,
    );
    // Hours against no target read as nothing at all, and general education is
    // usually one of these areas. The hours are still real and still on the
    // board, so they are named rather than left at a bare "cannot measure".
    const earnedHere = unmeasured.filter((p) => p.earned > 0);
    if (earnedHere.length > 0) {
      lines.push(
        `Your board still has hours in ${earnedHere.length === 1 ? 'one of those' : 'those'}: ${earnedHere
          .slice(0, 3)
          .map((p) => `${p.area.label}, ${p.earned} hours`)
          .join('; ')}.`,
      );
    }
  }

  // Every row in the program file arrives with credits null and the adapter
  // backfills from the catalog, so a course the catalog does not carry counts
  // as zero hours. That undercounts, which is the safe direction, but a reader
  // has to be told the number can only be low.
  //
  // Printed lists only, which is what `broad` is filtered out for. A general
  // education group holds a whole campus category, hundreds of courses that are
  // not rows on this degree page, and counting those would make the sentence
  // below a false claim about the page.
  const zeroRows = program.areas.reduce(
    (sum, area) =>
      sum +
      area.groups
        .filter((g) => !g.broad)
        .reduce((n, g) => n + g.courses.filter((c) => !c.credits).length, 0),
    0,
  );
  if (zeroRows > 0) {
    lines.push(`${zeroRows} course rows on that page carry no credit hours, so these totals count low, never high.`);
  }

  if (program.totalCredits !== null) {
    lines.push(`The degree total is ${program.totalCredits} hours.`);
  }

  lines.push(SELF_SERVICE);

  const sources = ctx.programUrl
    ? [sourceOf(1, `${program.name}, Illinois catalog`, ctx.programUrl)]
    : [];
  return local('requirements', lines.join('\n\n'), sources, sources.length > 0);
}

// ---------------------------------------------------------------------------
// The upstream branch
// ---------------------------------------------------------------------------

/** TRU cuts the question at 1,000 characters with no warning. Stay well under. */
const UPSTREAM_MAX = 900;

/**
 * Turn the student's sentence into something TRU can retrieve on.
 *
 * Four rules, each enforcing something measured in TRU's own handler:
 *   a. never a bare code. Its clarify card refuses any question with no
 *      three-letter run, which rejects "CS 225", "ME 200", "IB 150", "AE 202",
 *      "PS 101", "NE 201", "SE 101" and "CW 104".
 *   b. every pronoun already carries the resolved code, done in resolveCourse.
 *   c. no "at Illinois" suffix. The tenant is fixed by the route path and the
 *      token only adds noise to BM25.
 *   d. under 900 characters, because the 1,000 cut is silent and the half that
 *      gets cut is the student's actual question.
 */
export function rewriteForUpstream(raw: string, resolved: ResolvedCourse | null): string {
  let q = (resolved?.rewritten ?? raw).replace(/\s+/g, ' ').trim();

  if (!/[a-z]{3,}/i.test(q)) {
    const code = resolved?.code ?? q;
    q = `What should I know about ${code}?`;
  }

  if (q.length > UPSTREAM_MAX) {
    const cut = q.lastIndexOf(' ', UPSTREAM_MAX);
    q = q.slice(0, cut > 200 ? cut : UPSTREAM_MAX).trim();
  }

  return q;
}

/**
 * Split a compound question when each half wants a different side.
 *
 * Measured: "How hard is CS 225 and what are its prerequisites?" fills all
 * eight of TRU's retrieval slots with grade chunks and answers only the first
 * half. Splitting is the only way the second half gets an answer at all.
 */
export function splitCompound(raw: string): string[] {
  const parts = raw.split(/,?\s+and\s+(?=what|when|where|who|which|how|is|are|do|does|can|am)/i);
  return parts.length === 2 ? parts.map((p) => p.trim()).filter(Boolean) : [raw.trim()];
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

function clarifyCourse(): Routed {
  return local('clarify', 'Which course? Tap the card, or type the code, like CS 225.', [], false);
}

function clarifyTerm(candidates: PlannedCourse[]): Routed {
  const labels = candidates.map((c) => c.termLabel);
  return local(
    'clarify',
    `Which term? ${joinList(labels.slice(0, 6))}${labels.length > 6 ? ' or another' : ''}.`,
    [],
    false,
  );
}

/** "Fall 2026 through Spring 2030", or the one label when there is only one. */
function boardSpan(terms: PlannedCourse[]): string {
  if (terms.length === 0) return '';
  if (terms.length === 1) return terms[0].termLabel;
  return `${terms[0].termLabel} through ${terms[terms.length - 1].termLabel}`;
}

/**
 * What to say when the question is about a term and no single column answers.
 *
 * Every branch here is a different true sentence. The one that claims the board
 * is empty is reached only when ctx.planned really is empty, which is the whole
 * point of this function: the old code asserted emptiness the moment the
 * resolver returned null, and told students with a full board that they had no
 * plan. A resolver that cannot read a question knows nothing about the board.
 */
function answerTermMiss(ctx: AskContext, miss: TermMiss): Routed {
  const terms = uniqueTerms(ctx);

  if (miss.reason === 'empty-board' || terms.length === 0) {
    return local('load', 'Nothing is on the board yet, so there is no term to weigh.', [], false);
  }

  if (miss.reason === 'not-on-board') {
    const count = `${ctx.planned.length} course${ctx.planned.length === 1 ? '' : 's'} across ${terms.length} term${terms.length === 1 ? '' : 's'}`;
    return local(
      'load',
      `Your board has no ${miss.asked ?? 'term like that'}. It runs ${boardSpan(terms)}, ${count}. Ask about one of those and I will weigh it.`,
      [],
      false,
    );
  }

  if (miss.reason === 'past-end') {
    return local(
      'load',
      `${miss.asked} is the last term on your board, so there is nothing after it yet. Add a term and I will weigh it.`,
      [],
      false,
    );
  }

  return clarifyTerm(miss.candidates.length > 0 ? miss.candidates : terms);
}

/**
 * One question in, one side of the product out.
 *
 * Order matters and is not alphabetical. Sections come first because they are
 * the one thing TRU structurally cannot answer. A named course with a grade
 * question goes upstream before the load detector can claim it, so "is CS 225
 * hard" reaches the DAIR chunk instead of being answered as a term. Load,
 * prerequisite and requirement follow. Anything left is a genuine university
 * question and is forwarded verbatim.
 */
export function routeQuestion(rawInput: string, ctx: AskContext): Routed {
  const raw = (rawInput ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return local('clarify', 'Ask something.', [], false);

  const halves = splitCompound(raw);
  if (halves.length === 2) {
    // The code usually sits in the first half and the second half says "its".
    // Resolving once over the whole sentence is what lets the second half find
    // the course at all.
    const anchor = resolveCourse(raw, ctx);
    const half = anchor ? { ...ctx, selectedCode: anchor.code } : ctx;
    const first = routeOne(halves[0], half);
    const second = routeOne(halves[1], half);
    // Only a genuinely mixed compound is worth splitting. Two upstream halves
    // are one question TRU handles better whole, and two local halves would
    // show the student two cards for one sentence.
    if (first.kind === 'local' && second.kind === 'upstream' && first.shape !== 'clarify') {
      return { ...first, alsoUpstream: second.question };
    }
    if (first.kind === 'upstream' && second.kind === 'local' && second.shape !== 'clarify') {
      return { ...first, alsoLocal: second.answer };
    }
  }

  return routeOne(raw, ctx);
}

function routeOne(raw: string, ctx: AskContext): Routed {
  const course = resolveCourse(raw, ctx);
  const { term, miss } = resolveTerm(raw, ctx);
  const selfScoped = SELF_SCOPE.test(raw) || BOARD_SCOPE.test(raw);
  /**
   * Whether the student pointed at a column, rather than one being in view.
   * "Is CS 225 too hard" carries no term reference, and answering it with the
   * weight of the open column answers a question nobody asked.
   */
  const termNamed = TERM_REFERENCE.test(raw);

  // 1. Sections. The planner holds building, room, days, times, CRN, instructor
  //    and part of term for the crawled term. TRU holds none of it.
  const sectionShaped =
    SECTION_SHAPE.test(raw) || (course !== null && SECTION_SHAPE_WITH_COURSE.test(raw));
  if (sectionShaped) {
    if (/\b(conflict|conflicts|overlap|overlaps|clash|clashes|back.?to.?back)\b|\bcan i get (from|to)\b|\bwalk\b/i.test(raw)) {
      return answerConflicts(ctx, term);
    }
    if (course && !course.unknown) return answerSection(course.code, raw, ctx);
    if (course?.unknown) return { kind: 'upstream', shape: 'general', question: rewriteForUpstream(raw, course) };
    // "My first class" points at a column, not at a card, so the course picker
    // is the wrong reply. Checked before the picker for that reason.
    if (FIRST_CLASS_SHAPE.test(raw) && selfScoped) return answerFirstClass(ctx, term, raw);
    if (PRONOUN_SHAPE.test(raw) || /\bmy\b/i.test(raw)) return clarifyCourse();
    return { kind: 'upstream', shape: 'general', question: rewriteForUpstream(raw, null) };
  }

  // 2. Grade history for one named course, before the load detector can take
  //    it. "Is CS 225 hard" is TRU's; "is my spring hard" is ours, and the only
  //    difference is whether the question is about a course or about a column.
  //
  //    The second test is the plain difficulty wording. "Is CS 225 too hard"
  //    names a course and no column, and the load detector used to claim it and
  //    answer with whichever term was open.
  const courseDifficulty =
    course && !termNamed && !selfScoped && COURSE_DIFFICULTY_SHAPE.test(raw);
  if ((GRADE_SHAPE.test(raw) || courseDifficulty) && course && !BOARD_SCOPE.test(raw)) {
    return { kind: 'upstream', shape: 'grade', question: rewriteForUpstream(raw, course) };
  }

  // 3. How heavy a term is. Needs a board reference or a term the student named
  //    out loud, otherwise it is a question about the university's hardest
  //    courses, which TRU answers deterministically.
  //
  //    `termNamed` is here because a load question about a term the board does
  //    not run still belongs on this side. "How heavy is fall 2031" went
  //    upstream to an engine that cannot see a board at all, when the honest
  //    answer, that the board does not run that term, is right here.
  //
  //    `termSuperlative` is the third way in. "Which term is hardest" carries
  //    no possessive and names no season, so neither of the other two saw it,
  //    and one of the four questions the bar offers went upstream to an engine
  //    with no board. A question about the university's hardest semester says
  //    so, and WORLD_SCOPE is what reads that.
  const termSuperlative = TERM_SUPERLATIVE.test(raw) && !WORLD_SCOPE.test(raw);
  if (LOAD_SHAPE.test(raw) && (selfScoped || termSuperlative || (termNamed && !WORLD_SCOPE.test(raw)))) {
    if (termSuperlative) {
      // Terms ranked against each other, not the courses inside one of them.
      return answerHardestTerm(ctx, /\b(easiest|lightest)\b/i.test(raw));
    }
    if (/\b(hardest|toughest|easiest|worst)\b/i.test(raw)) {
      const easiest = /\beasiest\b/i.test(raw);
      // The whole board unless the student named a column. "Which of my classes
      // is hardest" is a question about all of them, and silently narrowing it
      // to the column in view answers a question nobody asked.
      const named =
        term && (term.via === 'explicit' || term.via === 'next' || term.via === 'ordinal' || term.via === 'last' || /\bthis (term|semester)\b/i.test(raw))
          ? term
          : null;
      return answerHardest(ctx, named, easiest);
    }
    if (!term) return answerTermMiss(ctx, miss ?? { reason: 'unclear', asked: null, candidates: [] });
    return answerLoad(ctx, term);
  }

  // 4. The board's own order, before the single-course prerequisite shape,
  //    which owns the phrase "the right order" as well.
  if (ORDER_SHAPE.test(raw)) return answerOrder(ctx);

  // 5. Ordering for one course. The catalog's parsed groups plus its own
  //    sentence, verbatim, because the parser drops "Permission of department"
  //    and that is a real prerequisite.
  if (
    PREREQ_SHAPE.test(raw) ||
    (course !== null && PREREQ_SHAPE_WITH_COURSE.test(raw) && !NOT_A_PREREQ_OBJECT.test(raw))
  ) {
    if (course && !course.unknown) return answerPrereq(course.code, ctx);
    if (course?.unknown) return { kind: 'upstream', shape: 'general', question: rewriteForUpstream(raw, course) };
    if (REQUIREMENT_SHAPE.test(raw) && (selfScoped || PROGRESS_WORD.test(raw))) return answerRequirements(ctx);
    // "How do I drop a class before the deadline" reads as an ordering question
    // and names no course, so the ask-back offered a course picker to somebody
    // asking about the registrar. Dropping, adding and deadlines are TRU's, and
    // Illinois runs four parts of term with four sets of them.
    if (REGISTRAR_ACTION.test(raw)) {
      return { kind: 'upstream', shape: 'general', question: rewriteForUpstream(raw, null) };
    }
    if (PRONOUN_SHAPE.test(raw) || selfScoped) return clarifyCourse();
    return { kind: 'upstream', shape: 'general', question: rewriteForUpstream(raw, null) };
  }

  // 6. Degree progress, measured rather than described.
  if (REQUIREMENT_SHAPE.test(raw) && (selfScoped || PROGRESS_WORD.test(raw))) {
    return answerRequirements(ctx);
  }

  // 7. A grade question that named a course but also carried a board word.
  if (GRADE_SHAPE.test(raw) && course) {
    return { kind: 'upstream', shape: 'grade', question: rewriteForUpstream(raw, course) };
  }

  // 8. What a course is. Last of the local shapes because its wording is the
  //    broadest, so everything more specific gets first refusal.
  if (COURSE_SHAPE.test(raw) && course && !course.unknown) {
    return answerCourse(course.code, raw, ctx);
  }

  // 9. Everything else is a genuine university question, which is what TRU is
  //    good at. It goes as a short self-contained sentence and nothing else.
  return {
    kind: 'upstream',
    shape: GRADE_SHAPE.test(raw) ? 'grade' : 'general',
    question: rewriteForUpstream(raw, course),
  };
}

// ---------------------------------------------------------------------------
// What the bar is allowed to offer
// ---------------------------------------------------------------------------

/**
 * The questions the ask bar puts on its chips, built from this board.
 *
 * The chips used to be a list typed into the component. Three of the four
 * promised something the router did not answer: two went upstream and came back
 * with the cannot-reach-upstream line, and one came back with the course
 * picker. A hand-written list and a router are two things that drift apart, so
 * the list is generated here and every entry is routed before it is returned.
 * A chip that does not reach a grounded local answer on this student's own
 * board is dropped rather than shown, which is why this cannot drift again.
 *
 * Local only, and deliberately. Whether TRU can be reached is not knowable from
 * here, so a chip that needs it is a promise this side cannot keep. The ask bar
 * offers the university's own openers when there is no board to build these
 * from, which is the case where upstream is the only answerer anyway.
 */
export function suggestedQuestions(ctx: AskContext | null): string[] {
  if (!ctx) return [];

  const candidates: string[] = [];
  if (ctx.planned.length > 0) candidates.push('Where does my first class meet?');
  if (uniqueTerms(ctx).length > 1) candidates.push('Which term is hardest?');

  // A course whose catalog sentence parsed into real groups, so the answer is
  // the ordering rather than a sentence saying the ordering lives elsewhere.
  const gated = ctx.planned.find(
    (p) => (ctx.data.facts.get(normCode(p.code))?.prereq?.groups.length ?? 0) > 0,
  );
  if (gated) candidates.push(`What do I need before ${normCode(gated.code)}?`);

  if (ctx.program) candidates.push('Am I on track to graduate?');

  return candidates.filter((question) => {
    const routed = routeQuestion(question, ctx);
    // Grounded as well as local: a chip whose answer has no page behind it is
    // still a chip the student tapped for nothing.
    return routed.kind === 'local' && routed.shape !== 'clarify' && routed.answer.grounded;
  });
}
