/**
 * The advisor packet: the plan as a page a student prints and brings to their
 * advisor.
 *
 * The only export used to be "Download as JSON", which no advisor opens.
 * Grainger asks students to arrive with a draft list and their questions
 * (advising.grainger.illinois.edu/advising/how-to-prepare), and the registrar
 * says the uAchieve audit is not a planning tool, so a meeting of fifteen
 * minutes goes to reading the board off a laptop. This builds everything the
 * packet prints, as plain data: the board term by term with what each course
 * counts for, next term's picks with a backup for each, every assumption the
 * plan leans on, the open review flags, and the questions only the college
 * can answer. The page (components/planner/advisor-packet.tsx) only lays it
 * out, and __advisor-packet.check.mjs builds and renders it for a freshman, a
 * Parkland transfer, a Chemistry board with flags of its own, a continuing
 * student's own record, and a board edited past the credit limits.
 *
 * Nothing here is stored or sent anywhere. The packet is built in the browser
 * from the board on screen and printed from there.
 */
import {
  describeCreditTotal,
  normaliseCode,
  planCreditRange,
  type LanguagePlan,
  type PlanningContext,
} from './autoplan';
import { restrictedToOthers, type PlanMark } from './repick';
import { transcriptOpenLines, type TranscriptRecord } from './transcript';
import type { Course, IssueSeverity, PlanState, SemesterSeason } from './types';

// ---------------------------------------------------------------------------
// What a card is
// ---------------------------------------------------------------------------

/**
 * Why a card is on the board, in the words the board and ALMA use. The
 * packet prints the same word the card wears, so an advisor reading "gen ed
 * pick" on paper and a student reading "gen ed · swap" on screen are looking
 * at the same fact.
 */
export type CardRole = 'required' | 'from a list' | 'elective slot' | 'career track' | 'language' | 'gen ed pick' | 'prerequisite' | 'added';

/** The requirement blocks, in the fields a role or a packet line reads. */
export interface PacketBlock {
  id: string;
  areaLabel: string;
  label: string;
  rule: { kind: string; choices?: Array<{ codes: string[] }> };
}

export interface CardRoleInput {
  marks: Map<string, PlanMark>;
  /** Which block each booked course was chosen for, by code (GeneratedPlan.bookedFor). */
  bookedFor?: Record<string, string | null>;
  blocks?: PacketBlock[];
  /** Cards the student or ALMA put on the board since it was built. */
  studentAdded?: Set<string>;
}

/**
 * The role of one card on the board. The workspace's roleOf, ALMA's marks
 * and the packet all read this.
 */
export function cardRole(course: Course, input: CardRoleInput): CardRole {
  const slot = input.marks.get(course.id);
  if (slot?.kind === 'elective') return 'elective slot';
  // Booked for the goal the student named: Aaliyah's PHYS 101 for physical
  // therapy school read "elective slot", and ALMA offered to swap it freely.
  if (slot?.kind === 'track') return 'career track';
  if (slot?.kind === 'pool') return 'from a list';
  if (slot?.kind === 'language') return 'language';
  if (slot?.kind === 'gened') return 'gen ed pick';
  if (slot?.kind === 'prerequisite') return 'prerequisite';
  if (course.pathwayRole === 'required') return 'required';
  // Booked for a take-all or choose row: the second course of a required
  // group ("CHEM 102, 103, 104 and 105") is required, whatever its card says.
  const booked = input.bookedFor?.[normaliseCode(course.code)];
  if (booked && !input.studentAdded?.has(course.id)) {
    const block = input.blocks?.find((b) => b.id === booked);
    if (block && (block.rule.kind === 'all' || block.rule.kind === 'choose')) return 'required';
  }
  return 'added';
}

// ---------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------

export interface PacketCourse {
  code: string;
  title: string;
  /** "3 cr", or "1 to 4 cr". */
  credits: string;
  role: CardRole;
  /** What it counts for, in the board's words: "Psychology Core: Foundation", "Humanities - Lit & Arts". */
  fills: string;
}

export interface PacketTerm {
  label: string;
  /** "15 credits", or for a term away what it earns. */
  credits: string;
  courses: PacketCourse[];
  /** A term away: "Study abroad, 15 hours toward the total. Courses need approval before you go." */
  away?: string;
  /** A load a college has to approve, said on the term: "Over 18 credits: an overload." */
  load?: string;
}

export interface PacketBackup {
  code: string;
  title: string;
  credits: string;
  why: string;
}

export interface PacketPick extends PacketCourse {
  /**
   * For a course the planner chose (an elective slot, a gen ed pick, a course
   * from a list), the best other course that passes the same checks and is
   * not already the backup for another pick. Null for a course the degree
   * names, and for a pick nothing else can take the place of.
   */
  backup: PacketBackup | null;
  /** True for the planner's own picks, which are the ones a backup is looked for. */
  chosen: boolean;
}

export type AssumptionKind =
  | 'likely-equivalent'
  | 'open-line'
  | 'transfer-hours'
  | 'entered'
  | 'in-progress'
  | 'exam'
  | 'language'
  | 'placement'
  | 'offering'
  | 'credit-range';

export interface PacketAssumption {
  kind: AssumptionKind;
  heading: string;
  items: string[];
  source?: string;
}

export interface PacketFlag {
  severity: IssueSeverity;
  title: string;
  message: string;
  /** Identical rows the review list folds into one. */
  count: number;
}

export interface PacketQuestion {
  /** Stable for checks: 'transfer', 'open-lines', 'language', 'placement', 'overload', 'underload', 'credit-no-credit', 'residency', 'admission', 'away', 'errors', 'total'. */
  topic: string;
  text: string;
  /** Who decides, when the planner knows. */
  who?: string;
  source?: string;
}

export interface AdvisorPacket {
  school: string;
  degree: string;
  college: string | null;
  degreeUrl: string | null;
  madeOn: string;
  /** The last term on the board. */
  finish: string;
  /** "120 credits of the 120 this degree takes. 50 of those you already have, ..." */
  credits: string;
  /** What the student said they want to do after, when they said. */
  goal: string | null;
  /** Credit the plan counts that is not on the board, in one line; null when none. */
  held: string | null;
  terms: PacketTerm[];
  next: { label: string; credits: string; courses: PacketPick[] } | null;
  assumptions: PacketAssumption[];
  /** Errors and warnings from the review list: what the chip calls "to review". */
  flags: PacketFlag[];
  /** The review list's notes. */
  notes: PacketFlag[];
  /** What the planner says about itself that the sections above do not already say. */
  plannerNotes: string[];
  questions: PacketQuestion[];
  /** "This plan is unofficial. Check it against your uAchieve degree audit; ..." */
  unofficial: string;
}

/** One exam as the plan priced it: "AP Psychology, score 5" and what it grants. */
export interface PacketExam {
  name: string;
  /** "PSYC 100", or "3 hours of ECON 1--". Empty when the score earns nothing. */
  grants: string;
}

export interface PacketAway {
  label: string;
  season: SemesterSeason;
  year: number;
  kind: string | null;
  credits: number;
}

export interface PacketInput {
  school: {
    /** 'illinois' adds the university's own sources and offices to the questions. */
    id: string;
    name: string;
    /** "Illinois": what a sentence calls the university. */
    short: string;
    /** "uAchieve degree audit", "DegreeWorks audit". */
    audit: string;
  };
  program: { name: string; college: string | null; url: string | null; total: number | null; totalPublished: boolean };
  board: PlanState;
  /** Every course the board or the record can name, by id. */
  courseById: (id: string) => Course | undefined;
  context: PlanningContext | null;
  marks: Map<string, PlanMark>;
  blocks: PacketBlock[];
  bookedFor: Record<string, string | null>;
  studentAdded: Set<string>;
  /** describeCreditProgress for the plan, the sentence the rail prints. */
  creditsLine: string;
  /** Hours the plan counts that no course on the board or the record carries. */
  hoursWithoutCourse: number;
  goal: string;
  language: LanguagePlan | null;
  /** Years of a language the student said they took in high school; null when they have not said. */
  languageYears: number | null;
  transcript: TranscriptRecord | null;
  exams: PacketExam[];
  /** Held codes that come from neither the record nor an exam: typed under Credit, or told to ALMA. */
  enteredCodes: string[];
  away: PacketAway[];
  residency: { ok: boolean; shortfall?: string | null } | null;
  admission: { name: string; path: string; requiredBy: string; source: string } | null;
  /** The review list, grouped the way the chip shows it (groupIssues). */
  flags: PacketFlag[];
  /** What the rail prints under "What is estimated?". */
  caveats: string[];
  /**
   * The runners-up for a card, best first: the card's own dropdown and
   * ALMA's explain_choice read the same list (alternativesFor).
   */
  alternatives: (courseId: string, termId: string) => Array<{ course: Course; why: string }>;
  madeOn: string;
}

const TERM_MAX = 18;
const SUMMER_MAX = 9;
const SEASON_PREFIX: Record<SemesterSeason, string> = { Fall: 'fa', Spring: 'sp', Summer: 'su' };
/** A planner pick a backup is looked for. The language is the student's to choose; a required course has no stand-in. */
const CHOSEN: ReadonlySet<CardRole> = new Set<CardRole>(['elective slot', 'gen ed pick', 'from a list']);
/** A prerequisite that is only a test result or somebody's permission: the ranker's "gated" (autoplan.ts makeRanker). */
const GATED = /placement|proficiency (?:test|exam)|by permission|consent of/i;

/**
 * Review-list notes that explain the board on screen and say nothing an
 * advisor acts on. Emma's first packet spent five of its eight notes on
 * "Some courses could not be weighed: Weighed 3 of 5 courses in Fall 2026"
 * and "Credit range in this term", which the credit-range assumption already
 * says course by course. Every error, every warning and every other note is
 * printed.
 */
export const SCREEN_ONLY_NOTES: ReadonlySet<string> = new Set(['Some courses could not be weighed', 'Credit range in this term']);

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);
const calendarOrd = (season: SemesterSeason, year: number) => year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
const yearOf = (label: string) => Number(label.match(/\b(20\d\d)\b/)?.[1] ?? NaN);

function creditLabel(course: Course): string {
  const max = course.creditsMax ?? course.credits;
  return max > course.credits ? `${course.credits} to ${max} cr` : `${course.credits} cr`;
}

/** The first sentence of a catalog line or a mark's detail, for a table cell. */
function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.;])(\s|$)/);
  return (m ? m[1] : text).replace(/[.;]$/, '').trim();
}

/** A catalog sentence shortened at a word, for a line that quotes it. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).replace(/[,;:]$/, '')}…`;
}

/**
 * "Area: requirement" for a block. An area the degree page prints no heading
 * for has a null label whatever the type says: 22 of Priya's Chemistry rows
 * read "null: Core Chemistry" before this.
 */
function blockName(b: PacketBlock): string {
  const area = b.areaLabel?.trim() ?? '';
  const label = b.label?.trim().replace(/:$/, '') ?? '';
  if (!label || label === area) return area || 'Named by the degree page';
  return area ? `${area}: ${label}` : label;
}

/** What a card counts for, in the words its chip and ALMA use. */
function fillsOf(course: Course, role: CardRole, input: PacketInput): string {
  const mark = input.marks.get(course.id);
  const code = normaliseCode(course.code);
  const named = blockName;
  switch (role) {
    case 'required': {
      const booked = input.bookedFor[code];
      const block = booked ? input.blocks.find((b) => b.id === booked) : undefined;
      if (block) return named(block);
      const listed = input.blocks.find((b) => (b.rule.choices ?? []).some((ch) => ch.codes.map(normaliseCode).includes(code)));
      return listed ? named(listed) : 'Named by the degree page';
    }
    case 'from a list':
      return mark?.label ?? 'A list on the degree page';
    case 'gen ed pick':
      return mark?.label ? `Gen ed: ${mark.label}` : 'A general education category';
    case 'career track':
      return `For ${mark?.track ?? mark?.label ?? 'the goal you named'}`;
    case 'language':
      return mark?.detail ? firstSentence(mark.detail) : 'The language requirement';
    case 'prerequisite': {
      const before = mark?.detail.match(/requires it before (.+?)\.?$/)?.[1];
      return before ? `Needed before ${before}` : 'Needed before a later course';
    }
    case 'elective slot':
      return input.program.total ? `Toward the ${input.program.total}-hour total` : 'Toward the degree total';
    default:
      return 'Added by you';
  }
}

function packetCourse(course: Course, input: PacketInput): PacketCourse {
  const role = cardRole(course, { marks: input.marks, bookedFor: input.bookedFor, blocks: input.blocks, studentAdded: input.studentAdded });
  return { code: course.code, title: course.title, credits: creditLabel(course), role, fills: fillsOf(course, role, input) };
}

/** A term's credits the way the board's column header counts them. */
function termCredits(courses: Course[], context: PlanningContext | null): { label: string; min: number; max: number } {
  if (context) {
    const range = planCreditRange(courses.map((c) => c.code), context);
    return { label: describeCreditTotal(range), min: range.min, max: range.max };
  }
  const n = courses.reduce((sum, c) => sum + c.credits, 0);
  return { label: `${n} ${plural(n, 'credit')}`, min: n, max: n };
}

const AWAY_WORD: Record<string, string> = { study_abroad: 'Study abroad', co_op: 'Co-op', internship: 'Internship', gap: 'Time away' };

/**
 * Build the packet from the board as it stands.
 *
 * Every list here is complete: an advisor who sees "likely equivalents" with
 * three of Jordan's nine Parkland courses on it would sign off on six nobody
 * showed them. What keeps it to about two pages is the layout and leaving
 * out what the rail says for the screen only (how many courses were weighed,
 * where the grade history comes from), never truncating a list.
 */
export function buildAdvisorPacket(input: PacketInput): AdvisorPacket {
  const { board } = input;
  const illinois = input.school.id === 'illinois';
  const coursesOf = (ids: string[]) => ids.map((id) => input.courseById(id)).filter((c): c is Course => Boolean(c));

  // --- the board, with terms away in calendar order ---------------------------
  const terms: Array<{ term: PacketTerm; ord: number }> = board.terms.map((t, index) => {
    const courses = coursesOf(t.courseIds);
    const credits = termCredits(courses, input.context);
    const cap = t.season === 'Summer' ? SUMMER_MAX : TERM_MAX;
    const load =
      credits.min > cap
        ? `Over ${cap} credits: ${t.season === 'Summer' ? 'past the summer maximum' : 'an overload your college has to approve'}.`
        : t.season !== 'Summer' && courses.length > 0 && credits.max < 12
          ? `Under 12 credits: part-time, which your college has to approve.`
          : undefined;
    const year = yearOf(t.label);
    return {
      term: {
        label: t.label,
        credits: credits.label,
        courses: courses.map((c) => packetCourse(c, input)),
        ...(load ? { load } : {}),
      },
      ord: Number.isFinite(year) ? calendarOrd(t.season, year) : index * 3,
    };
  });
  // A term away has no column on the board, and an advisor reading Fall 2028
  // then Fall 2029 with nothing between asks where the spring went.
  for (const a of input.away) {
    const what = a.kind ? AWAY_WORD[a.kind] ?? 'Away' : 'Away';
    terms.push({
      term: {
        label: a.label,
        credits: a.credits > 0 ? `${a.credits} ${plural(a.credits, 'hour')} expected` : 'no hours',
        courses: [],
        away: `${what}${a.credits > 0 ? `, ${a.credits} ${plural(a.credits, 'hour')} toward the total` : ', no courses here'}.${a.kind === 'study_abroad' ? ' Courses taken abroad count only once they are approved.' : ''}`,
      },
      ord: calendarOrd(a.season, a.year),
    });
  }
  terms.sort((a, b) => a.ord - b.ord);
  const boardTerms = terms.map((t) => t.term);

  // --- next term, with a backup for each of the planner's picks ---------------
  const first = board.terms.find((t) => t.courseIds.length > 0) ?? null;
  let next: AdvisorPacket['next'] = null;
  /**
   * A backup is what the student registers for when the pick is full, so it
   * has to be a course they can simply take. The card's runners-up are ranked
   * for choosing, and on Emma's freshman board they offered ESL 115 (gated on
   * the English Placement Test) behind RHET 105 and LAS 102 ("for first-term
   * LAS transfer students only") behind LAS 100. Printed, either sends her to
   * registration with a backup she cannot enrol in.
   */
  const who = { programName: input.program.name, programCollege: input.program.college ?? undefined };
  const registrable = (c: Course) => {
    const ctx = input.context;
    if (!ctx) return true;
    if (restrictedToOthers(c, ctx, who)) return false;
    const spec = ctx.prereqs?.get(normaliseCode(c.code));
    return !(spec && !spec.parsed && GATED.test(spec.text));
  };
  if (first) {
    const onBoard = new Set(board.terms.flatMap((t) => t.courseIds));
    const used = new Set<string>();
    const picks: PacketPick[] = [];
    for (const course of coursesOf(first.courseIds)) {
      const base = packetCourse(course, input);
      const chosen = CHOSEN.has(base.role);
      let backup: PacketBackup | null = null;
      if (chosen) {
        // Two elective slots in one term rank the same runners-up; each gets
        // its own, so the student is not left with one backup for two picks.
        const alt = input
          .alternatives(course.id, first.id)
          .find((a) => a.course.id !== course.id && !onBoard.has(a.course.id) && !board.completedCourseIds.includes(a.course.id) && !used.has(a.course.id) && registrable(a.course));
        if (alt) {
          used.add(alt.course.id);
          backup = { code: alt.course.code, title: alt.course.title, credits: creditLabel(alt.course), why: alt.why };
        }
      }
      picks.push({ ...base, chosen, backup });
    }
    next = { label: first.label, credits: termCredits(coursesOf(first.courseIds), input.context).label, courses: picks };
  }

  // --- assumptions --------------------------------------------------------------
  const assumptions: PacketAssumption[] = [];
  const record = input.transcript;
  const fromOf = (c: { from?: string | null }) => c.from ?? (record?.home === false ? record.institution : null);
  const lineName = (c: { code: string; title: string | null; from?: string | null; status?: string; term?: string | null }) => {
    const from = fromOf(c);
    const when = c.status === 'in_progress' ? `, in progress${c.term ? ` ${c.term}` : ''}` : '';
    return `${c.code}${c.title ? ` ${c.title}` : ''}${from || when ? ` (${[from, when.replace(/^, /, '')].filter(Boolean).join(', ')})` : ''}`;
  };
  const transferSource = illinois ? 'admissions.illinois.edu/transferring-credit' : undefined;
  const likely = (record?.courses ?? []).filter((c) => c.use && c.counts === 'course' && c.matchedBy === 'proposal' && c.matched);
  if (likely.length > 0) {
    assumptions.push({
      kind: 'likely-equivalent',
      heading: `Counted as ${input.school.short} courses the catalog's titles suggest. Likely, not confirmed: the Transfer Evaluation Report decides.`,
      items: likely.map((c) => `${lineName(c)} as ${[c.matched, ...(c.also ?? [])].join(' + ')}`),
      source: transferSource,
    });
  }
  const open = transcriptOpenLines(record);
  if (open.length > 0) {
    assumptions.push({
      kind: 'open-line',
      heading: 'Counted as elective hours only, with a course still to settle.',
      items: open.map((c) => {
        const best = c.proposals?.[0];
        const hours = c.equivalentCredits ?? c.assumedCredits ?? c.credits;
        return `${lineName(c)}: ${hours ?? '?'} ${plural(hours ?? 0, 'hour')}${best ? `; likely ${best.code} ${best.title}` : ''}${c.genEdTags?.length ? `; meets ${c.genEdTags.join(', ')}` : ''}`;
      }),
      source: transferSource,
    });
  }
  const openSet = new Set(open);
  const hoursOnly = (record?.courses ?? []).filter((c) => c.use && c.counts === 'hours' && !openSet.has(c) && fromOf(c));
  const assumedHours = (record?.courses ?? []).filter((c) => c.use && c.assumedCredits != null && !openSet.has(c) && !hoursOnly.includes(c));
  if (hoursOnly.length > 0 || assumedHours.length > 0) {
    assumptions.push({
      kind: 'transfer-hours',
      heading: 'Counted as hours toward the total, with no course named.',
      items: [
        ...hoursOnly.map((c) => `${lineName(c)}: ${c.equivalentCredits ?? c.assumedCredits ?? c.credits ?? '?'} hours${c.assumedCredits != null ? ' (assumed; the document prints none)' : ''}${c.genEdTags?.length ? `; meets ${c.genEdTags.join(', ')}` : ''}`),
        ...assumedHours.map((c) => `${lineName(c)}: 3 hours assumed; the document prints none`),
      ],
    });
  }
  const enteredLines = (record?.courses ?? []).filter((c) => c.use && c.matchedBy === 'student');
  const entered = [...enteredLines.map((c) => `${lineName(c)}${c.matched && c.matched !== c.code ? ` as ${c.matched}` : ''}`), ...input.enteredCodes];
  if (entered.length > 0) {
    assumptions.push({ kind: 'entered', heading: 'Credit you entered yourself. No document here shows it.', items: [...new Set(entered)] });
  }
  // A course still in progress counts as passed, on the student's own record
  // as much as on another school's. The lines above already say so of theirs.
  const listed = new Set([...likely, ...open, ...hoursOnly, ...assumedHours, ...enteredLines]);
  const inProgress = (record?.courses ?? []).filter((c) => c.use && c.status === 'in_progress' && !listed.has(c));
  if (inProgress.length > 0) {
    assumptions.push({
      kind: 'in-progress',
      heading: 'Courses still in progress, counted as passed.',
      items: inProgress.map((c) => `${lineName(c)}${c.matched && c.matched !== c.code ? ` as ${c.matched}` : ''}`),
    });
  }
  if (input.exams.length > 0) {
    assumptions.push({
      kind: 'exam',
      heading: 'AP and IB credit, from the registrar\'s table. It counts once your official scores reach the university.',
      items: input.exams.map((e) => `${e.name}: ${e.grants || 'no credit at this score'}`),
      source: illinois ? 'citl.illinois.edu/current-cutoff-scores' : undefined,
    });
  }
  const lang = input.language;
  /**
   * Where the plan starts the language, and on what. The plan takes the
   * larger of the student's high school years (two assumed when they have
   * not said) and the semesters their courses reach, so Jordan, with two
   * years of high school Spanish and Parkland's SPA 103 read as SPAN 201,
   * starts at semester 4 on the strength of a course, not a placement test:
   * his question is whether SPA 103 counts, which the transfer question asks.
   * A level that rests on high school years is a guess at the placement
   * test, and only then is the test the question.
   */
  let placementFromSchool = false;
  if (lang) {
    const years = input.languageYears ?? (lang.from === 'assumed' ? 2 : 0);
    const byCourses = lang.from === 'college' || lang.completed > years;
    placementFromSchool = lang.completed > 0 && !byCourses;
    const books = lang.codes.length > 0 ? ` It books ${lang.codes.join(', ')}.` : '';
    const start =
      lang.completed === 0
        ? `The plan starts you in semester 1 of ${lang.semesters} of ${lang.name}.${books}`
        : byCourses
          ? `The plan starts you at semester ${lang.completed + 1} of ${lang.semesters} of ${lang.name}, after the ${lang.name} courses it counts you as holding.${books} That holds only if those courses count as the plan counts them.`
          : `The plan assumes you place into semester ${lang.completed + 1} of ${lang.semesters} of ${lang.name}, from ${
              input.languageYears === null ? 'the two years of high school language Illinois requires for admission, because you have not said how many you took' : `your ${years} ${plural(years, 'year')} of high school ${lang.name}`
            }.${books} The placement test decides where you start.`;
    const exempt = coursesOf(board.exemptCourseIds ?? []).map((c) => c.code);
    assumptions.push({
      kind: 'language',
      heading: placementFromSchool ? 'Language placement.' : 'Language.',
      items: [
        start,
        ...(/\bno language was given\b/i.test(lang.why) ? [`${lang.name} is the planner's default; any language on the registrar's list meets the requirement at the same level.`] : []),
        ...(exempt.length > 0
          ? [`Skipped, not earned: ${exempt.join(', ')}. ${exempt.length === 1 ? 'It clears' : 'They clear'} prerequisites and ${exempt.length === 1 ? 'counts' : 'count'} no hours.`]
          : []),
      ],
    });
  }
  const ctx = input.context;
  const langCodes = new Set((lang?.codes ?? []).map(normaliseCode));
  const placed = board.terms.flatMap((t) => coursesOf(t.courseIds).map((c) => ({ c, t })));
  const gated = placed
    .filter(({ c }) => !langCodes.has(normaliseCode(c.code)))
    .map(({ c, t }) => {
      const text = ctx?.prereqs?.get(normaliseCode(c.code))?.text ?? c.prerequisiteText ?? '';
      const sentence = text.split(/(?<=[.;])\s+/).find((s) => /placement|\baleks\b|proficiency (?:test|exam)/i.test(s));
      return sentence ? `${c.code} in ${t.label}: "${clip(sentence, 150)}"` : null;
    })
    .filter((x): x is string => x !== null);
  if (gated.length > 0) {
    assumptions.push({ kind: 'placement', heading: 'Courses that depend on a placement score. The plan assumes you place in.', items: gated });
  }
  if (ctx?.offerings && (ctx.offeringTerms?.length ?? 0) > 0) {
    const window = ctx.offeringTerms ?? [];
    const word = (t: string) => {
      const m = t.match(/^(sp|su|fa|wi)(\d{4})$/);
      return m ? `${{ sp: 'Spring', su: 'Summer', fa: 'Fall', wi: 'Winter' }[m[1]]} ${m[2]}` : t;
    };
    const snapshot = ctx.snapshotTerm ?? null;
    const thin: string[] = [];
    for (const { c, t } of placed) {
      if (snapshot && snapshot.id === t.id) continue;
      const code = normaliseCode(c.code);
      const seasonTerms = window.filter((w) => w.startsWith(SEASON_PREFIX[t.season]));
      if (seasonTerms.length === 0) continue;
      const ran = (ctx.offerings.get(code) ?? []).filter((w) => w.startsWith(SEASON_PREFIX[t.season])).length;
      if (ran * 2 < seasonTerms.length) {
        thin.push(`${c.code} in ${t.label}: ran in ${ran} of the last ${seasonTerms.length} ${t.season.toLowerCase()} ${plural(seasonTerms.length, 'term')}`);
      }
    }
    assumptions.push({
      kind: 'offering',
      heading: `When courses run. No schedule is published past ${snapshot?.label ?? 'the current term'}${snapshot ? ', the term the section times on the board come from' : ''}, so every later term is an estimate: each course sits in a season it ran in between ${word(window[window.length - 1])} and ${word(window[0])}.${thin.length > 0 ? ' Where that record is thin:' : ' Every one ran in its planned season at least half the time.'}`,
      items: thin,
    });
  }
  if (ctx) {
    const ranged = placed.filter(({ c }) => (c.creditsMax ?? c.credits) > c.credits).map(({ c, t }) => `${c.code} in ${t.label}: ${c.credits} to ${c.creditsMax} credits`);
    if (ranged.length > 0) {
      assumptions.push({ kind: 'credit-range', heading: 'Courses with a range of credit. Totals show the range; choose the hours when you register.', items: ranged });
    }
  }

  // --- review flags ---------------------------------------------------------------
  // Every error and warning, as written. Of the notes, the two that explain
  // the screen rather than the plan stay there (see SCREEN_ONLY_NOTES).
  const flags = input.flags.filter((f) => f.severity !== 'info');
  const notes = input.flags.filter((f) => f.severity === 'info' && !SCREEN_ONLY_NOTES.has(f.title));

  // --- what the planner says about itself -------------------------------------
  /**
   * The rail's caveats, less what is said for the screen only and what the
   * sections above already say: the language notes are the language
   * assumption, and grade provenance, "weighed 40 of 44" and the credit aim
   * explain the board, not the plan an advisor signs off on. Anything not
   * recognised is kept: a note the advisor never sees is the worse failure.
   */
  const SCREEN_ONLY = [
    /^Language: \d+ more semesters? of /,
    /^You have not said how much of a language other than English/,
    /^Weighed \d+ of \d+ courses against grade history/,
    /^Grade Distribution, /,
    /^Terms aim for about \d+ credits/,
    /^\d+ slots? (?:is an elective|are electives) that fill/,
    /^\d+ courses? on the degree page counts? under more than one heading/,
  ];
  const residencyLine = input.residency?.shortfall?.trim() ?? null;
  const plannerNotes = [...new Set(input.caveats)].filter((note) => note.trim() && note.trim() !== residencyLine && !SCREEN_ONLY.some((re) => re.test(note.trim())));

  // --- questions only the college can answer ----------------------------------
  const questions: PacketQuestion[] = [];
  const college = (input.program.college ?? '').toLowerCase();
  const collegeWord = illinois
    ? ({ engineering: 'Grainger', bus: 'Gies', las: 'LAS', media: 'Media', aces: 'ACES', faa: 'FAA', ahs: 'AHS', education: 'Education', socw: 'Social Work', ischool: 'the iSchool' } as Record<string, string>)[college] ?? 'your college'
    : 'your college';
  if (likely.length > 0) {
    questions.push({
      topic: 'transfer',
      text: `Will ${input.school.short} count ${likely.map((c) => `${c.code} as ${c.matched}`).join(', ')}? The plan counts them as likely until the Transfer Evaluation Report prints them.`,
      who: illinois ? 'Undergraduate Admissions, through the Transfer Evaluation Report' : 'Admissions',
      source: transferSource,
    });
  }
  if (open.length > 0) {
    questions.push({
      topic: 'open-lines',
      text: `Which course, if any, do these count as: ${open.map((c) => `${c.code}${c.proposals?.[0] ? ` (likely ${c.proposals[0].code})` : ''}`).join(', ')}? A course that is not listed in Transferology is judged from its syllabus.`,
      who: illinois ? 'Undergraduate Admissions; bring the syllabi' : 'Admissions',
      source: transferSource,
    });
  }
  if (lang && lang.codes.length > 0 && placementFromSchool) {
    questions.push({
      topic: 'language',
      text: `Do I take the ${lang.name} placement test before ${lang.codes[0]}, and will I place into semester ${lang.completed + 1} as the plan assumes?`,
    });
  }
  const gatedCodes = [...new Set(gated.map((g) => g.slice(0, g.indexOf(' in '))))];
  if (gatedCodes.length > 0) {
    questions.push({ topic: 'placement', text: `Which placement score do I need for ${gatedCodes.join(', ')}, and when do I take the test?` });
  }
  const over = boardTerms.filter((t) => t.load?.startsWith('Over') && !t.load.includes('summer'));
  if (over.length > 0) {
    const rule = illinois
      ? ({
          engineering: ' Grainger usually wants a 3.5 GPA, approves none in a first semester, and takes requests until noon on the tenth day of classes.',
          bus: ' Gies wants a 3.00 for 19 or 20 hours and 3.50 above that, and allows none in a freshman\'s first two semesters.',
          las: ' LAS decides overloads the day before classes.',
          media: ' Media wants a 3.0 and an earlier term of 17 or 18 hours.',
        } as Record<string, string>)[college] ?? ''
      : '';
    questions.push({
      topic: 'overload',
      text: `${over.map((t) => `${t.label} (${t.credits})`).join(', ')} ${over.length === 1 ? 'is' : 'are'} over 18 credits. Would ${collegeWord} approve an overload, or which course should move?${rule}`,
      who: `${collegeWord} advising`,
      source: illinois ? 'registrar.illinois.edu/registration/registration-process/max-min-enrollment-levels/' : undefined,
    });
  }
  const under = boardTerms.filter((t) => t.load?.startsWith('Under'));
  if (under.length > 0) {
    questions.push({
      topic: 'underload',
      text: `${under.map((t) => `${t.label} (${t.credits})`).join(', ')} ${under.length === 1 ? 'is' : 'are'} under 12 credits, which is part-time. Would ${collegeWord} approve it, and does it change my financial aid, a scholarship or a visa?`,
      who: `${collegeWord} advising, and the financial aid office`,
      source: illinois ? 'registrar.illinois.edu/registration/registration-process/max-min-enrollment-levels/' : undefined,
    });
  }
  const free = (next?.courses ?? []).filter((p) => p.role === 'elective slot');
  if (free.length > 0) {
    questions.push({
      topic: 'credit-no-credit',
      text: `Could I take ${free.map((p) => p.code).join(' or ')} credit/no-credit, and by when do I ask? ${free.length === 1 ? 'It is a free elective' : 'They are free electives'} in ${next?.label}.`,
      who: `${collegeWord}; requests are due by the middle of the term`,
      source: illinois ? 'registrar.illinois.edu (undergraduate registration deadlines)' : undefined,
    });
  }
  if (input.residency && !input.residency.ok && input.residency.shortfall) {
    questions.push({ topic: 'residency', text: `How do I meet the residency rule? ${input.residency.shortfall}`, who: `${collegeWord} advising` });
  }
  if (input.admission) {
    questions.push({
      topic: 'admission',
      text: `I am not in ${input.admission.name} yet (${input.admission.path}). Its courses are placed first, to be done by ${input.admission.requiredBy}. What GPA and deadline should I plan for?`,
      who: input.admission.name,
      source: input.admission.source,
    });
  }
  const abroad = input.away.filter((a) => a.kind === 'study_abroad');
  if (abroad.length > 0) {
    questions.push({
      topic: 'away',
      text: `Which courses from ${abroad.map((a) => a.label).join(' and ')} away will count, and for what? The plan counts ${abroad.map((a) => `${a.credits} hours`).join(' and ')} with no course named.`,
      who: illinois ? 'Illinois Education Abroad\'s course approval, and your college' : 'Your college',
      source: illinois ? 'studyabroad.illinois.edu/outgoing-students/course-approval-process/' : undefined,
    });
  }
  const errors = flags.filter((f) => f.severity === 'error');
  if (errors.length > 0) {
    // With the flag's own first sentence: "Prerequisite conflict" alone does
    // not say that it is SPAN 203 ahead of SPAN 201.
    questions.push({
      topic: 'errors',
      text: `The plan could not settle ${errors.length === 1 ? 'this' : 'these'}: ${errors.map((f) => `${f.title.replace(/:\s*$/, '')} (${clip(firstSentence(f.message), 110)})`).join('; ')}. What should I do about ${errors.length === 1 ? 'it' : 'them'}?`,
    });
  }
  if (!input.program.totalPublished) {
    questions.push({ topic: 'total', text: `The degree page states no total, so the plan aims at ${input.program.total ?? 120} hours. What total does this degree take?` });
  }

  // --- what the plan counts that is not on the board ---------------------------
  const heldCodes = coursesOf(board.completedCourseIds).map((c) => c.code);
  const held =
    heldCodes.length > 0 || input.hoursWithoutCourse > 0
      ? `${heldCodes.length > 0 ? heldCodes.join(', ') : ''}${heldCodes.length > 0 && input.hoursWithoutCourse > 0 ? ', and ' : ''}${input.hoursWithoutCourse > 0 ? `${input.hoursWithoutCourse} ${plural(input.hoursWithoutCourse, 'hour')} with no ${input.school.short} course` : ''}`
      : null;

  return {
    school: input.school.name,
    degree: input.program.name,
    college: input.program.college,
    degreeUrl: input.program.url,
    madeOn: input.madeOn,
    finish: board.terms[board.terms.length - 1]?.label ?? '',
    credits: input.creditsLine,
    goal: input.goal.trim() || null,
    held,
    terms: boardTerms,
    next,
    assumptions,
    flags,
    notes,
    plannerNotes,
    questions,
    unofficial: `This plan is unofficial. Check it against your ${input.school.audit}: your college and your advisor decide what counts.`,
  };
}
