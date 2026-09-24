/**
 * Which of a college's published routes in fits this student, and why.
 *
 * Grainger publishes two, and they are for different people. A student who
 * started at Illinois as a first-year applies to Engineering Undeclared (EU)
 * in their second or third semester: Calculus 1 and General Chemistry 1, a
 * 3.30 cumulative GPA, windows in May and November. A student coming from
 * another school applies for transfer admission: Calculus III, PHYS 212,
 * CHEM 104/105, a 3.00 GPA, opening January 15. Before this file every
 * student got the second. A Fall 2026 Psychology first-year who wrote "I
 * want to switch into mechanical engineering" was told the wrong GPA, the
 * wrong courses and the wrong window, and an ME board had MCB 150 forced
 * into her first term by a list EU never asks for.
 *
 * So the route is chosen from how the student entered Illinois (their words
 * and their record say which) and which semester the plan starts in, and
 * every answer says why. A transfer student is told the page's own sentence:
 * EU is not open to them. Computer Science, CS + Bioengineering and CS +
 * Physics are closed to on-campus transfer, and a student aiming at them is
 * told that and what the Siebel School offers instead, never a route.
 *
 * Pure data and pure functions, so __plan-audit.check.mjs can hold every
 * choice to the page.
 */
import type { AdmissionRoute, AdmissionTable } from './autoplan';
import { FROM_ANOTHER_COLLEGE, internalTransferIntent, lineIsForeign, normalizeTerm, transcriptResidentHours, type TranscriptRecord } from './transcript';

type Season = 'Fall' | 'Spring';
export interface TermRef {
  season: 'Fall' | 'Spring' | 'Summer';
  year: number;
}

/** How the student entered, or will enter, Illinois, and which semester the plan's first term is. */
export interface EntryReading {
  entry: 'first-year' | 'transfer' | 'unknown';
  /** For a transfer: still coming from another school (true), or already here (false). */
  arriving: boolean;
  /** The fall or spring semester of enrollment at Illinois the plan's first term is (1 = the first), when known. */
  semester: number | null;
  /** What said so, in a clause the explanation can quote. */
  why: string;
}

/** The college a student is trying to get into, and the major they named (or the board's degree). */
export interface AdmissionGoal {
  college: string;
  major: string | null;
  programId: string | null;
}

export interface AdmissionWindow {
  semester: number;
  /** The plan term the window falls in, "Spring 2027". */
  term: string;
  termIndex: number;
  /** "May 1 – May 15, 2027". */
  dates: string;
  /** The term it admits for, "Fall 2027". */
  admits: string;
}

export interface AdmissionChoice {
  college: string;
  /** The college's name as its routes print it, "The Grainger College of Engineering". */
  name: string;
  major: string | null;
  /** The table key of the route chosen, or null when no published route fits. */
  key: string | null;
  /** The route, with its deadline set for this student's semester. */
  route: AdmissionRoute | null;
  /** Whether the plan places the route's courses first: only a route the student takes at Illinois. */
  front: boolean;
  why: string;
  /** Routes this student is not eligible for, with the page's reason. */
  notFor: Array<{ key: string; path: string; reason: string; source: string }>;
  closed: { major: string; text: string; offers: string[]; sources: string[]; readAt: string | null } | null;
  competitive: string | null;
  windows: AdmissionWindow[];
  entry: EntryReading;
}

// ---------------------------------------------------------------------------
// How the student entered
// ---------------------------------------------------------------------------

const TRANSFER_WORDS =
  /\btransfer student\b|\b(?:came|come|coming|entered|entering|admitted) (?:in |to illinois |here )?as an? (?:transfer|junior transfer|sophomore transfer)\b|\btransferr?\w* (?:to|into|in to) (?:the )?(?:illinois|uiuc|u of i|university of illinois|urbana)\b|\bassociate'?s(?: degree)?\b/i;
/** Past tense: the transfer already happened, and the student is at Illinois now. */
const TRANSFERRED_ALREADY =
  /\btransferred (?:in|here|to (?:the )?(?:illinois|uiuc|u of i|university of illinois|urbana))\b|\b(?:came|entered) (?:in |to illinois |here )?as an? (?:junior |sophomore )?transfer\b|\bwas a transfer student\b|\bi'?m a transfer student (?:at|in)\b/i;
/**
 * A class year said as the student's own: "I'm a sophomore", "freshman". Not
 * "junior year" or "senior year", which are when something happens ("abroad
 * junior year"), and read as a class year put a freshman past EU's window.
 */
const FIRST_YEAR_WORDS = /\b(?:freshman|freshmen|first[- ]year|1st[- ]year|sophomore(?! year)|junior(?! year| transfer)|senior(?! year))\b/i;
const INCOMING = /\b(?:incoming|entering|starting|will start|start(?:s|ing)? (?:at|in)|beginning|new|high school senior|admitted as a (?:freshman|first[- ]year))\b/i;
const NTH_SEMESTER: Array<[RegExp, number]> = [
  [/\b(?:first|1st) semester\b/i, 1],
  [/\b(?:second|2nd) semester\b/i, 2],
  [/\b(?:third|3rd) semester\b/i, 3],
  [/\b(?:fourth|4th) semester\b/i, 4],
  [/\b(?:fifth|5th) semester\b/i, 5],
  [/\b(?:sixth|6th) semester\b/i, 6],
];

const termOrd = (season: TermRef['season'], year: number) => year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);

/** Fall and spring terms at Illinois the record shows the student in, before the plan starts. */
function illinoisSemestersBefore(record: TranscriptRecord | null | undefined, start: TermRef): number {
  if (!record) return 0;
  const seen = new Set<string>();
  for (const c of record.courses) {
    if (!c.use || (c.status !== 'completed' && c.status !== 'in_progress')) continue;
    if (lineIsForeign(record, c) || c.matchedBy === 'student') continue;
    const m = (normalizeTerm(c.term) ?? '').match(/^(Fall|Spring) (\d{4})$/);
    if (!m) continue;
    if (termOrd(m[1] as Season, Number(m[2])) >= termOrd(start.season, start.year)) continue;
    seen.add(m[0]);
  }
  return seen.size;
}

/**
 * Transfer or first-year, from the words first and the record second.
 *
 * The words decide when they say it ("transfer student", "finishing my
 * associate's at Parkland", "incoming freshman"). A record from another
 * school with nothing taught at Illinois is a transfer on its way. The
 * semester is counted from the Illinois terms on the record when there are
 * any, and otherwise from the class year the student gave: a freshman in a
 * fall is in their first semester, a sophomore in a fall their third.
 */
export function readEntry(words: string, record: TranscriptRecord | null | undefined, start: TermRef): EntryReading {
  const recordFromElsewhere = Boolean(record) && (record?.kind === 'transfer_report' || record?.home === false) && transcriptResidentHours(record).total === 0;
  const saidTransfer = TRANSFER_WORDS.test(words) || FROM_ANOTHER_COLLEGE.test(words);
  const doneHere = illinoisSemestersBefore(record, start);
  if (saidTransfer || recordFromElsewhere) {
    const already = TRANSFERRED_ALREADY.test(words) || (saidTransfer && doneHere > 0);
    const cue = (words.match(TRANSFER_WORDS) ?? words.match(FROM_ANOTHER_COLLEGE))?.[0];
    return {
      entry: 'transfer',
      arriving: !already,
      semester: null,
      why: cue ? `you wrote "${cue.trim()}"` : 'your record is from another school with nothing taken at Illinois',
    };
  }
  const fall = start.season !== 'Spring';
  let semester: number | null = null;
  let why = '';
  if (doneHere > 0) {
    semester = doneHere + 1;
    why = `your Illinois record shows ${doneHere} semester${doneHere === 1 ? '' : 's'} before ${start.season} ${start.year}`;
  } else {
    for (const [re, n] of NTH_SEMESTER) {
      const m = words.match(re);
      if (m) { semester = n; why = `you wrote "${m[0]}"`; break; }
    }
  }
  const year = words.match(FIRST_YEAR_WORDS);
  if (semester === null && year && !/high school senior/i.test(words)) {
    const word = year[0].toLowerCase();
    const base = /sophomore/.test(word) ? 3 : /junior/.test(word) ? 5 : /senior/.test(word) ? 7 : 1;
    semester = base === 1 && INCOMING.test(words) ? 1 : base + (fall ? 0 : 1);
    why = `you wrote "${year[0]}"`;
  } else if (semester === null && /high school senior/i.test(words)) {
    semester = 1;
    why = 'you wrote "high school senior"';
  }
  if (year || semester !== null) {
    return { entry: 'first-year', arriving: false, semester, why };
  }
  return { entry: 'unknown', arriving: false, semester: null, why: 'nothing you wrote says how you entered Illinois or which semester you are in' };
}

// ---------------------------------------------------------------------------
// Which college, which major
// ---------------------------------------------------------------------------

/**
 * "Switch into mechanical engineering", "get into Grainger", "transfer to
 * CS": a move into engineering in the student's own words. The words after
 * "into" name the major. Chemical engineering is an LAS major and software
 * engineering is a job, so neither is a move into Grainger; "math and
 * computer science" and "CS + Economics" are blended majors in other
 * colleges, so they are not either.
 */
const INTO_ENGINEERING =
  /\b(?:transfer(?:ring)?|switch(?:ing)?|mov(?:e|ing)|chang(?:e|ing)(?:\s+(?:my\s+)?majors?)?|get(?:ting)?|apply(?:ing)?|ict(?:ing)?)\s+(?:in)?to\s+((?:[a-z&,]+\s+){0,4}?)(grainger|engineering|computer\s+science|cs)\b((?:\s*(?:\+|and|&)\s*[a-z]+)?)/gi;
const LEAVING_ENGINEERING = /\b(?:switch\w*|transfer\w*|mov\w*|chang\w*|leav\w*)\s+(?:out of|from)\s+(?:[a-z&]+\s+){0,3}?(?:engineering|grainger)\b/i;
const NOT_GRAINGER_PREFIX = /\b(?:chemical|software|math|mathematics|statistics|stats?)\b/i;
const FILLER = /^(?:the|an?|my|our|major|majors|program|degree|in)$/i;

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

export function intoEngineering(words: string): { major: string | null } | null {
  for (const m of words.matchAll(INTO_ENGINEERING)) {
    const prefix = m[1].trim().split(/\s+/).filter((w) => w && !FILLER.test(w));
    const hit = m[2].toLowerCase().replace(/\s+/g, ' ');
    const suffix = m[3].trim().toLowerCase();
    if (prefix.some((w) => NOT_GRAINGER_PREFIX.test(w))) continue;
    if (hit === 'computer science' || hit === 'cs') {
      if (prefix.length > 0) continue;
      if (!suffix) return { major: 'Computer Science' };
      if (/bioengineering/.test(suffix)) return { major: 'Computer Science + Bioengineering' };
      if (/physics/.test(suffix)) return { major: 'Computer Science + Physics' };
      continue;
    }
    if (hit === 'grainger') return { major: null };
    return { major: prefix.length > 0 ? titleCase(`${prefix.join(' ')} engineering`) : null };
  }
  return null;
}

/** Every route a table publishes into one college, keyed by table key. */
export function routesInto(table: AdmissionTable, college: string): Array<[string, AdmissionRoute]> {
  return Object.entries(table.colleges).filter(([key, route]) => (route.college ?? key) === college);
}

/**
 * The college the student is trying to get into, if their words say they are
 * not in it yet.
 *
 * The degree on the board is the goal when the student's words ask for a
 * transfer into it (the same reading as before, which Gies keeps). A move
 * into engineering named in the words is a goal whatever the board: a
 * Psychology first-year who wants mechanical engineering keeps Psychology on
 * the board while she takes what EU asks for, and the board has to carry it.
 */
export function admissionGoal(
  table: AdmissionTable,
  board: { college: string | null | undefined; programId: string | null | undefined; programName: string | null | undefined },
  words: string,
  record: TranscriptRecord | null | undefined,
): AdmissionGoal | null {
  // "Switch out of mechanical engineering into psychology" is an ME student
  // leaving, and front-loading EU onto their ME board would be backwards.
  const leaving = LEAVING_ENGINEERING.test(words);
  const named = leaving ? null : intoEngineering(words);
  const college = board.college ?? '';
  if (college && routesInto(table, college).length > 0 && !(college === 'engineering' && leaving)) {
    if (internalTransferIntent(words, record) || (college === 'engineering' && named)) {
      return { college, major: board.programName ?? named?.major ?? null, programId: board.programId ?? null };
    }
  }
  if (named && routesInto(table, 'engineering').length > 0 && college !== 'engineering') {
    return { college: 'engineering', major: named.major, programId: null };
  }
  return null;
}

/**
 * The college and major a program_admission question is about: "engineering",
 * "grainger", "mechanical engineering", "computer science", "gies".
 */
export function goalFromQuery(table: AdmissionTable, college: string, major: string, board: { college?: string | null; programId?: string | null; programName?: string | null }): AdmissionGoal | null {
  const q = `${college} ${major}`.toLowerCase();
  let code: string | null = null;
  if (/\bgies\b|\bbus(iness)?\b/.test(q)) code = 'bus';
  else if (/computer science|\bcs\b/.test(q)) {
    const plus = q.match(/(?:computer science|\bcs)\s*(?:\+|and|&)\s*([a-z]+)/);
    if (!plus || /bioengineering|physics/.test(plus[1])) code = 'engineering';
  } else if (/grainger|engineer|\beu\b/.test(q) && !/chemical engineering/.test(q)) code = 'engineering';
  else code = Object.keys(table.colleges).find((k) => q.includes(k)) ?? null;
  if (!code || routesInto(table, code).length === 0) return null;
  const onBoard = board.college === code;
  const named = major.trim() || (intoEngineering(`switch into ${college}`)?.major ?? null);
  return {
    college: code,
    major: named || (onBoard ? board.programName ?? null : null),
    programId: !major.trim() && onBoard ? board.programId ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// The choice
// ---------------------------------------------------------------------------

function step(start: TermRef, n: number): { season: Season; year: number } {
  let season: Season = start.season === 'Spring' ? 'Spring' : 'Fall';
  let year = start.year;
  for (let i = 0; i < n; i++) {
    if (season === 'Fall') { season = 'Spring'; year += 1; } else season = 'Fall';
  }
  return { season, year };
}

/**
 * The route's windows for this student: the semesters it lets them apply in,
 * the plan term each falls in, its dates, and the term it admits for. A
 * Fall 2026 first-year's second semester is Spring 2027, whose window is May
 * 1 to 15, 2027, for Fall 2027; the third is Fall 2027's November window.
 */
export function windowsFor(route: AdmissionRoute, semesterAtStart: number, start: TermRef): AdmissionWindow[] {
  const out: AdmissionWindow[] = [];
  for (const semester of route.applySemesters ?? []) {
    if (semester < semesterAtStart) continue;
    const index = semester - semesterAtStart;
    const term = step(start, index);
    const w = route.windows?.find((x) => x.applyIn === term.season);
    if (!w) continue;
    const admits = w.admitTerm === 'Fall' ? { season: 'Fall', year: term.year } : { season: 'Spring', year: term.season === 'Fall' ? term.year + 1 : term.year };
    out.push({
      semester,
      term: `${term.season} ${term.year}`,
      termIndex: index,
      dates: `${w.opens} – ${w.closes}, ${term.year}`,
      admits: `${admits.season} ${admits.year}`,
    });
  }
  return out;
}

const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;

function closedFor(route: AdmissionRoute | undefined, goal: AdmissionGoal): AdmissionChoice['closed'] {
  const list = route?.closedMajors;
  if (!list) return null;
  const hit = list.majors.find((m) => (goal.programId && m.programId === goal.programId) || (goal.major && m.name.toLowerCase() === goal.major.toLowerCase().replace(/,\s*bs$/, '')));
  if (!hit) return null;
  return { major: hit.name, text: list.text, offers: list.offers, sources: list.sources.map((s) => s.url), readAt: list.sources[0]?.read ?? null };
}

function competitiveFor(route: AdmissionRoute, major: string | null): string | null {
  const c = route.competitive;
  if (!c) return null;
  const name = major?.replace(/,\s*bs$/i, '').toLowerCase() ?? '';
  const hit = c.majors.find((m) => m.toLowerCase() === name);
  return hit
    ? `${hit} is one of the page's competitive majors (${c.majors.join(', ')}). ${c.text}`
    : `${c.text} The competitive majors are ${c.majors.join(', ')}.`;
}

/**
 * Pick the route for a student and say why.
 *
 * A transfer is never given an internal route: EU's page says transfer
 * students are not eligible, so one still coming from another school gets
 * the college's transfer admission, and one already here as a transfer gets
 * the college's sentence that they cannot apply. A first-year past the
 * route's last semester is told the same. Otherwise the internal route, with
 * its deadline moved to the semester this student first applies in, and the
 * external route named as not theirs.
 */
export function chooseAdmission(table: AdmissionTable, goal: AdmissionGoal, entry: EntryReading, start: TermRef): AdmissionChoice {
  const routes = routesInto(table, goal.college);
  const internal = routes.find(([, r]) => r.for !== 'external');
  const external = routes.find(([, r]) => r.for === 'external');
  const name = (internal ?? external)?.[1].name ?? goal.college;
  // "so the Grainger College of Engineering's route", mid-sentence.
  const named = name.replace(/^The\b/, 'the');
  const base: AdmissionChoice = {
    college: goal.college,
    name,
    major: goal.major,
    key: null,
    route: null,
    front: false,
    why: '',
    notFor: [],
    closed: null,
    competitive: null,
    windows: [],
    entry,
  };

  // Only a route that says who may use it turns a transfer away. Gies's
  // route names no entry rule, and it keeps the reading it always had.
  if (entry.entry === 'transfer' && (!internal || internal[1].entry === 'first-year')) {
    if (internal) {
      base.notFor.push({
        key: internal[0],
        path: internal[1].path,
        reason: internal[1].notEligible ?? internal[1].who,
        source: internal[1].source,
      });
    }
    if (entry.arriving && external) {
      return {
        ...base,
        key: external[0],
        route: external[1],
        why: `You are coming to Illinois from another school (${entry.why}), so ${named}'s route for you is ${external[1].path}: you apply to the college directly, before you transfer. ${external[1].who}`,
      };
    }
    const already = internal?.[1].transferEntry ?? external?.[1].who ?? '';
    return {
      ...base,
      why: `You entered Illinois as a transfer student (${entry.why}). ${already}`.trim(),
    };
  }

  const closed = closedFor(internal?.[1], goal);
  if (closed) {
    return {
      ...base,
      closed,
      why: `${closed.text} ${closed.offers.join(' ')}`,
    };
  }

  if (!internal) {
    // Only an external route: nothing a student already here can take.
    return external
      ? { ...base, notFor: [{ key: external[0], path: external[1].path, reason: external[1].who, source: external[1].source }], why: `${name} publishes only ${external[1].path} for students coming from another school. Ask the college about moving in from another college on campus.` }
      : base;
  }

  const [key, route] = internal;
  const externalNotFor = external ? [{ key: external[0], path: external[1].path, reason: external[1].who, source: external[1].source }] : [];
  if (!route.applySemesters?.length) {
    // Gies: the route carries its own deadline, "the end of your first spring".
    return {
      ...base,
      key,
      route,
      front: true,
      notFor: externalNotFor,
      why: `${route.path} is ${named}'s route for students already at Illinois. ${route.who}`,
    };
  }

  const assumed = entry.semester === null;
  const semesterAtStart = entry.semester ?? 1;
  const windows = windowsFor(route, semesterAtStart, start);
  const lastSemester = Math.max(...route.applySemesters);
  if (windows.length === 0) {
    return {
      ...base,
      notFor: [{ key, path: route.path, reason: route.notEligible ?? route.who, source: route.source }],
      why: `${route.path} takes applications only in a student's ${route.applySemesters.map(ordinal).join(' or ')} semester, and ${start.season} ${start.year} is your ${ordinal(semesterAtStart)} (${entry.why}). ${route.notEligible ?? ''} Ask ${route.contact ?? 'the college'} whether any other path is open to you.`.replace(/\s+/g, ' ').trim(),
    };
  }
  const first = windows[0];
  const personal: AdmissionRoute = {
    ...route,
    dueTermIndex: first.termIndex,
    requiredBy: `${first.term}, the semester of your first application window (${first.dates}, for ${first.admits})`,
    notes: [
      ...route.notes,
      `The plan has these courses done by the end of ${first.term}, the semester you first apply in.`,
    ],
  };
  const when = windows.map((w) => `${w.dates} in your ${ordinal(w.semester)} semester (${w.term}, for ${w.admits})`).join(', or ');
  const who = entry.entry === 'first-year'
    ? `You entered Illinois as a first-year student (${entry.why}), so`
    : `Nothing you wrote says how you entered Illinois. If you entered as a first-year student,`;
  const semesterNote = assumed
    ? ` The plan assumes ${start.season} ${start.year} is your first semester; if it is not, tell ALMA which semester you are in, because the route closes after your ${ordinal(lastSemester)}.`
    : ` ${start.season} ${start.year} is your ${ordinal(semesterAtStart)} semester.`;
  return {
    ...base,
    key,
    route: personal,
    front: true,
    windows,
    competitive: competitiveFor(route, goal.major),
    notFor: externalNotFor,
    why: `${who} ${named}'s route for you is ${route.path}, not its transfer admission for students from other schools.${entry.entry === 'first-year' ? '' : ` ${route.notEligible ?? ''}`}${semesterNote} You can apply ${when}.`.replace(/\s+/g, ' '),
  };
}

/** One paragraph for the plan's notes and the review list: the route, why, and what is not open. */
export function describeAdmissionChoice(choice: AdmissionChoice): string {
  const parts: string[] = [choice.why];
  if (choice.competitive) parts.push(choice.competitive);
  // A route the plan takes already says which one it is not; a transfer or a
  // student past the window is told each closed route in the page's words.
  if (!choice.front) {
    for (const n of choice.notFor) {
      if (n.key === choice.key || choice.why.includes(n.reason)) continue;
      parts.push(`${n.path} is not open to you: ${n.reason} (${n.source})`);
    }
  }
  const source = choice.route?.source ?? choice.closed?.sources[0] ?? null;
  if (source) parts.push(`Source: ${source}`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
