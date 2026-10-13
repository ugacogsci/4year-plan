/**
 * Whether a term's courses can be registered together without two classes
 * at the same hour.
 *
 * Illinois will not register a student into two sections that meet at once.
 * A board can put PORT 150 and REL 260 in the same spring and look fine
 * while their only sections both meet Monday and Wednesday at 2:00 (67 swept
 * boards did, 2026-10-08). This reads
 * the published class times of the terms Illinois has posted (Fall 2026 and
 * Spring 2027, sections.json and sections/spring-2027.json) and asks one
 * question per term: is there any choice of sections, one of every type a
 * student registers for (a lecture and its discussion, lab or quiz), that
 * keeps the week free of overlaps?
 *
 * It only reports. The planner never moves a course because of it, and a
 * later column, whose schedule is not published, is not checked: a fall
 * timetable four years out is a guess.
 *
 * What it reads. Each course's meet map (illinois-data.ts summariseSections):
 * every distinct weekly timetable per section type, "MW@660-710" for Monday
 * and Wednesday 11:00 to 11:50. The ways of taking a course, in person or
 * online, start from registrationPaths in meeting-fit.ts, the rule the
 * time-window check uses, loosened in two places where that rule would
 * invent a clash (alternativesOn and withoutOnlineCompanions below).
 *
 * What it does not claim. Unknown is unknown, not a clash:
 *   - a course with no sections in that term's schedule, or with meetings the
 *     build could not read, is left out and named;
 *   - an arranged or online meeting with no hour blocks nothing;
 *   - a course whose own sections never fit together (its one lecture on top
 *     of its one lab, which is how some crawls list a combined meeting) is
 *     left out, since the crawl does not say which sections go together;
 *   - half-term courses: a first-half (A) and a second-half (B) course at the
 *     same hour do not meet in the same weeks. A course that runs sections in
 *     more than one part of the term is only counted against full-term
 *     courses, which share weeks with every part.
 * It does not know which lecture a discussion belongs to, nor which sections
 * are full or restricted, so "fits" means the published times allow it.
 *
 * Fast: the ways of taking each course, and which ways of two courses can
 * sit together, are worked out once per term schedule; a term's answer once
 * per set of courses. Every Fall 2026 and Spring 2027 term of a both-start
 * sweep (5,544 terms) takes under two seconds, the slowest about 30 ms.
 */
import { meetingKinds, registrationPaths } from './meeting-fit.ts';

/** The parts of a section summary this reads. SectionSummary has both. */
export interface WeeklySectionSummary {
  meet?: Record<string, string[]> | null;
  partsOfTerm?: ReadonlyArray<{ id: string }> | null;
}

/** One term's schedule, by normalised course code ("CHEM 102"). */
export type WeeklySchedule = ReadonlyMap<string, WeeklySectionSummary>;

export interface WeeklyFit {
  /**
   * fits: some choice of sections keeps every checked course apart.
   * clash: no choice does.
   * unknown: nothing could be checked (no course has readable times), or the
   * search ran past its budget.
   */
  status: 'fits' | 'clash' | 'unknown';
  /** The short line a term column, the review and ALMA print. Null when there is nothing to say. */
  line: string | null;
  /** The smallest set of courses no choice of sections fits together, when status is clash. */
  clash: string[];
  /** Courses left out because their times are not known for this term. */
  unknown: string[];
  /** How many courses were checked against each other. */
  checked: number;
}

interface Meeting {
  /** Bit per day, M=1 … U=64. Zero for a meeting that names no day. */
  days: number;
  start: number;
  end: number;
}

type Part = 'full' | 'A' | 'B' | 'mixed';

interface CourseWays {
  code: string;
  part: Part;
  /** Every distinct way of registering, as its meetings. An empty list is a way with no set hour. */
  ways: Meeting[][];
}

const DAY_BIT: Record<string, number> = { M: 1, T: 2, W: 4, R: 8, F: 16, S: 32, U: 64 };
const TOKEN = /^([MTWRFSU]*)@(\d+)-(\d+)$/;
/** More ways than this for one course and it is reported as unknown rather than guessed at. */
const WAYS_CAP = 3000;
/** Search steps per question before the answer is unknown. A board term takes a few hundred. */
const STEP_BUDGET = 200000;

/** "MW@660-710;F@600-650" -> its meetings; ARR adds none. Null for a token the build did not write. */
function meetingsOf(signature: string): Meeting[] | null {
  const out: Meeting[] = [];
  for (const token of signature.split(';')) {
    if (token === 'ARR') continue;
    const m = TOKEN.exec(token);
    if (!m) return null;
    let days = 0;
    for (const d of m[1]) days |= DAY_BIT[d] ?? 0;
    out.push({ days, start: Number(m[2]), end: Number(m[3]) });
  }
  return out;
}

function overlaps(a: Meeting, b: Meeting): boolean {
  return (a.days & b.days) !== 0 && a.start < b.end && b.start < a.end;
}

function anyOverlap(a: readonly Meeting[], b: readonly Meeting[]): boolean {
  for (const x of a) for (const y of b) if (overlaps(x, y)) return true;
  return false;
}

/** Full term ("1"), one half (A or B), or sections in more than one part. */
function partOf(summary: WeeklySectionSummary): Part {
  const ids = new Set((summary.partsOfTerm ?? []).map((p) => p.id));
  if (ids.size === 0 || (ids.size === 1 && ids.has('1'))) return 'full';
  if (ids.size === 1 && ids.has('A')) return 'A';
  if (ids.size === 1 && ids.has('B')) return 'B';
  return 'mixed';
}

/**
 * Whether two courses are in class in the same weeks. A full-term course
 * shares weeks with every part; two halves only with the same half. A course
 * with sections in several parts is counted against full-term courses only,
 * since which part its chosen section runs in is not known.
 */
function shareWeeks(a: Part, b: Part): boolean {
  if (a === 'full' || b === 'full') return true;
  return a === b && a !== 'mixed';
}

/**
 * The registrations one path of meeting-fit.ts allows, as lists of section
 * types.
 *
 * A path names every type a student might register for, and most courses
 * need one of each: CHEM 102 in person is a lecture, a discussion and a
 * quiz. But a path with two kinds of lecture section offers two different
 * courses of study, and requiring both would invent clashes. ADV 150 runs a
 * lecture with discussions (AL1 and the AB rows) and, separately, two
 * Lecture-Discussion sections (MAJ, MJ2) that are the whole course on their
 * own; ACES 102 runs three self-contained sections, two typed Lecture and one
 * Lecture-Discussion; THEA 110's Spring Lecture-Discussion (CHP, Tuesday and
 * Thursday) stands apart from its Monday-Friday lecture and Wednesday lab.
 *
 * So when a path holds more than one type that carries a lecture, each of
 * them is a registration of its own, joined by the other types whose kind of
 * meeting it does not already include: a plain lecture takes its discussions
 * and labs, a Lecture-Discussion takes a separate quiz or lab but not the
 * discussions or lab-discussions meant for the plain lecture. With one
 * lecture type or none, the path stands as meeting-fit.ts reads it.
 *
 * This leans toward "fits": the crawl does not say which sections are linked,
 * and an invented clash is worse than a missed one.
 */
function alternativesOn(path: string[]): string[][] {
  const kinds = new Map(path.map((type) => [type, meetingKinds(type)]));
  const anchors = path.filter((type) => kinds.get(type)?.includes('lecture'));
  if (anchors.length < 2) return [path];
  const others = path.filter((type) => !anchors.includes(type));
  return anchors.map((anchor) => {
    const own = new Set(kinds.get(anchor));
    return [anchor, ...others.filter((type) => !(kinds.get(type) ?? []).some((k) => own.has(k)))];
  });
}

/**
 * The in-person path without the online discussions, labs and quizzes
 * meeting-fit.ts adds to it. That rule adds an online type to the in-person
 * path whenever its kind of meeting has no in-person form, which keeps a
 * time window honest (AAS 310's lecture is only online, and its in-person
 * students still take it). For a clash it invents one: CHEM 102's Spring
 * Online Discussion (Monday and Wednesday at 10) belongs to the online
 * section, and reading it into the in-person path put every in-person CHEM
 * 102 student on top of ESL 111. An online lecture stays, since without it
 * the path has no lecture at all. A path with nothing in person is left as
 * it is.
 */
function withoutOnlineCompanions(path: string[]): string[] {
  if (!path.some((type) => !/online/i.test(type))) return path;
  return path.filter((type) => !/online/i.test(type) || meetingKinds(type).includes('lecture'));
}

/**
 * Every distinct way of taking one course: on each registration path, one
 * timetable of every section type, keeping only the choices whose own
 * meetings do not collide. Null when the course cannot be read: no meet, a
 * token the build did not write, too many ways, or no way without a
 * collision of its own.
 */
function waysOf(code: string, summary: WeeklySectionSummary | undefined): CourseWays | null {
  const meet = summary?.meet;
  if (!summary || !meet || Object.keys(meet).length === 0) return null;
  const seen = new Set<string>();
  const ways: Meeting[][] = [];
  const pathsSeen = new Set<string>();
  const [inPersonPath, onlinePath] = registrationPaths(meet);
  for (const path of [...alternativesOn(withoutOnlineCompanions(inPersonPath)), ...alternativesOn(onlinePath)]) {
    const key = [...path].sort().join('|');
    if (pathsSeen.has(key)) continue;
    pathsSeen.add(key);
    const domains: Meeting[][][] = [];
    for (const type of path) {
      const list: Meeting[][] = [];
      for (const sig of meet[type] ?? []) {
        const ms = meetingsOf(sig);
        if (!ms) return null;
        list.push(ms);
      }
      if (list.length === 0) return null;
      domains.push(list);
    }
    let capped = false;
    const walk = (i: number, chosen: Meeting[]) => {
      if (capped) return;
      if (i === domains.length) {
        const id = chosen
          .map((m) => `${m.days}@${m.start}-${m.end}`)
          .sort()
          .join(';');
        if (seen.has(id)) return;
        seen.add(id);
        ways.push(chosen);
        if (ways.length > WAYS_CAP) capped = true;
        return;
      }
      for (const option of domains[i]) {
        if (anyOverlap(option, chosen)) continue;
        walk(i + 1, [...chosen, ...option]);
      }
    };
    walk(0, []);
    if (capped) return null;
  }
  if (ways.length === 0) return null;
  // A way with no set hour (fully online) can never collide, so it is the only one worth keeping.
  const free = ways.find((w) => w.length === 0);
  return { code, part: partOf(summary), ways: free ? [free] : ways };
}

const pairCache = new WeakMap<WeeklySchedule, Map<string, Uint32Array[] | null>>();

/**
 * For each way of taking a, the ways of b it leaves open, as a bitset over
 * b's ways; null when no way of a ever collides with a way of b (different
 * halves of the term, or simply never at the same hour). Cached per schedule
 * and pair, since a board edit asks about the same pairs again: PHYS 211 has
 * about 2,200 ways in Spring 2027, and rebuilding its table for every subset
 * the clash search tries took a quarter of a second.
 */
function pairOpen(schedule: WeeklySchedule, a: CourseWays, b: CourseWays): Uint32Array[] | null {
  let byPair = pairCache.get(schedule);
  if (!byPair) {
    byPair = new Map();
    pairCache.set(schedule, byPair);
  }
  const key = `${a.code}|${b.code}`;
  const hit = byPair.get(key);
  if (hit !== undefined) return hit;
  let rows: Uint32Array[] | null = null;
  if (shareWeeks(a.part, b.part)) {
    const words = Math.ceil(b.ways.length / 32);
    let any = false;
    rows = a.ways.map((x) => {
      const bits = new Uint32Array(words);
      b.ways.forEach((y, k) => {
        if (!anyOverlap(x, y)) bits[k >>> 5] |= 1 << (k & 31);
        else any = true;
      });
      return bits;
    });
    if (!any) rows = null;
  }
  byPair.set(key, rows);
  return rows;
}

/**
 * Is there a choice of one way per course with no two courses in class at
 * once? True, false, or null when the step budget runs out.
 *
 * Backtracking with forward checking: for every pair of courses that share
 * weeks, which of the second's ways each of the first's ways leaves open, as
 * a bitset; choosing a way narrows every course still to place, and an empty
 * course ends that branch at once. The course with the fewest ways left goes
 * next. A pre-med fall of CHEM 102, CHEM 103, IB 150, IB 151 and MCB 150 takes
 * a few hundred steps this way and ran past 200,000 without it.
 */
function fitsTogether(courses: readonly CourseWays[], schedule: WeeklySchedule): boolean | null {
  const words = courses.map((c) => Math.ceil(c.ways.length / 32));
  // open[i][j][a]: the ways of j that way a of i leaves open; null when i and j never collide.
  const open = courses.map((ci, i) => courses.map((cj, j) => (i === j ? null : pairOpen(schedule, ci, cj))));
  const full = courses.map((c, j) => {
    const bits = new Uint32Array(words[j]);
    for (let k = 0; k < c.ways.length; k += 1) bits[k >>> 5] |= 1 << (k & 31);
    return bits;
  });
  const count = (bits: Uint32Array) => {
    let total = 0;
    for (let w of bits) {
      while (w) {
        w &= w - 1;
        total += 1;
      }
    }
    return total;
  };
  let steps = 0;
  const place = (domains: Uint32Array[], left: number[]): boolean | null => {
    if (left.length === 0) return true;
    let pick = left[0];
    let fewest = Infinity;
    for (const j of left) {
      const c = count(domains[j]);
      if (c < fewest) {
        fewest = c;
        pick = j;
      }
    }
    if (fewest === 0) return false;
    const rest = left.filter((j) => j !== pick);
    const dom = domains[pick];
    for (let k = 0; k < courses[pick].ways.length; k += 1) {
      if (!(dom[k >>> 5] & (1 << (k & 31)))) continue;
      steps += 1;
      if (steps > STEP_BUDGET) return null;
      const next = domains.slice();
      let dead = false;
      for (const j of rest) {
        const rows = open[pick][j];
        if (!rows) continue;
        const narrowed = new Uint32Array(words[j]);
        let some = false;
        for (let w = 0; w < words[j]; w += 1) {
          narrowed[w] = domains[j][w] & rows[k][w];
          if (narrowed[w]) some = true;
        }
        if (!some) {
          dead = true;
          break;
        }
        next[j] = narrowed;
      }
      if (dead) continue;
      const r = place(next, rest);
      if (r !== false) return r;
    }
    return false;
  };
  return place(full, courses.map((_, i) => i));
}

/** "A", "A and B", "A, B and C". */
function listInWords(codes: readonly string[]): string {
  if (codes.length <= 1) return codes.join('');
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
}

const waysCache = new WeakMap<WeeklySchedule, Map<string, CourseWays | null>>();
const answerCache = new WeakMap<WeeklySchedule, Map<string, WeeklyFit>>();

function cachedWays(schedule: WeeklySchedule, code: string): CourseWays | null {
  let byCode = waysCache.get(schedule);
  if (!byCode) {
    byCode = new Map();
    waysCache.set(schedule, byCode);
  }
  if (!byCode.has(code)) byCode.set(code, waysOf(code, schedule.get(code)));
  return byCode.get(code) ?? null;
}

/** "chem 102" and "CHEM  102" -> "CHEM 102", the key the section maps use. */
function keyOf(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * The weekly answer for one term's courses against that term's published
 * schedule. Codes as the board shows them; order does not matter. Cached per
 * schedule and set of codes, so a board can ask on every render.
 */
export function weeklyFit(codes: readonly string[], schedule: WeeklySchedule): WeeklyFit {
  const keys = [...new Set(codes.map(keyOf))].sort();
  let answers = answerCache.get(schedule);
  if (!answers) {
    answers = new Map();
    answerCache.set(schedule, answers);
  }
  const cacheKey = keys.join('|');
  const hit = answers.get(cacheKey);
  if (hit) return hit;

  const unknown: string[] = [];
  const known: CourseWays[] = [];
  for (const key of keys) {
    const ways = cachedWays(schedule, key);
    if (ways) known.push(ways);
    else unknown.push(key);
  }
  const unknownNote = unknown.length > 0 ? ` (no times to check for ${listInWords(unknown)})` : '';

  let result: WeeklyFit;
  if (known.length === 0) {
    result = { status: 'unknown', line: null, clash: [], unknown, checked: 0 };
  } else {
    const all = fitsTogether(known, schedule);
    if (all === null) {
      result = { status: 'unknown', line: 'Weekly schedule not checked: too many section combinations', clash: [], unknown, checked: known.length };
    } else if (all) {
      result = { status: 'fits', line: `These fit in a weekly schedule${unknownNote}`, clash: [], unknown, checked: known.length };
    } else {
      // The smallest set that still cannot be fit. Two courses that can
      // never be apart are the usual answer and the cheapest to find; past
      // that, drop each course in turn and keep it out whenever the rest
      // still collide.
      let pair: CourseWays[] | null = null;
      for (let i = 0; i < known.length && !pair; i += 1) {
        for (let j = i + 1; j < known.length && !pair; j += 1) {
          if (fitsTogether([known[i], known[j]], schedule) === false) pair = [known[i], known[j]];
        }
      }
      let core: CourseWays[] = pair ?? [...known];
      if (!pair) {
        for (const course of known) {
          const rest: CourseWays[] = core.filter((c) => c !== course);
          if (rest.length > 0 && fitsTogether(rest, schedule) === false) core = rest;
        }
      }
      const names = core.map((c) => c.code);
      const line =
        names.length === 2
          ? `No section combination fits: ${names[0]} and ${names[1]} meet at the same time`
          : `No section combination fits: ${listInWords(names)} overlap in every combination of their sections`;
      result = { status: 'clash', line, clash: names, unknown, checked: known.length };
    }
  }
  answers.set(cacheKey, result);
  return result;
}
