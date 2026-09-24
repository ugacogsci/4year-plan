'use client';

/**
 * Where the Illinois planner gets its facts.
 *
 * Two loads, deliberately separate, because they cost two very different
 * amounts and are needed at two very different moments.
 *
 *   FIRST   loadIllinoisCore() reads the six built artifacts in public/illinois.
 *           About 3.9 MB of already-adapted JSON and roughly a tenth of a
 *           second. It carries every course, its map position, its parsed
 *           prerequisites, its difficulty and its Fall 2026 section summary,
 *           which is everything the board, the map and the plan need.
 *
 *   SECOND  buildIllinoisData() re-reads the four raw crawl files and runs the
 *           whole adapter again. 9.3 MB and about three seconds of main thread
 *           on this machine. Only the ask router needs it, because AskContext
 *           takes a whole IllinoisData, so it is started when the student first
 *           touches the ask bar rather than on load. Making the board wait three
 *           seconds for a question nobody has asked yet is the opposite of what
 *           the redesign is for.
 *
 * Everything here runs in the browser and nothing about a student leaves it.
 */

import { useEffect, useRef, useState } from 'react';
import {
  coverageLine,
  loadIllinoisCore,
  loadIllinoisProgram,
  toGradeRow,
  type IllinoisCore,
  type IllinoisProgramSummary,
} from '@/lib/planner/illinois-load';
import {
  adaptIllinoisPrograms,
  attachRequirementIds,
  buildIllinoisData,
  missingPrerequisiteGroups,
  type CourseFacts,
  type IllinoisCourse,
  type IllinoisData,
  type RawCatalogFile,
  type RawGradeFile,
  type RawProgramFile,
  type PrereqSpec,
  type RawSectionFile,
  type RequirementBlock,
} from '@/lib/planner/illinois-data';
import type {
  PlanningContext,
  PlanPrereq,
  PlanRequirement,
  PriorCredit,
} from '@/lib/planner/autoplan';
import type { GradeRow, ProgramRequirements } from '@/lib/planner/scheduler';
import type { SemesterSeason } from '@/lib/planner/types';

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

// ---------------------------------------------------------------------------
// The first load
// ---------------------------------------------------------------------------

export type CoreStatus = 'loading' | 'ready' | 'unavailable';

export interface CoreState {
  status: CoreStatus;
  core: IllinoisCore | null;
  /** One sentence naming what loaded and what did not. Shown in the header. */
  coverage: string;
}

export function useIllinoisCore(enabled: boolean): CoreState {
  const [state, setState] = useState<CoreState>({
    status: enabled ? 'loading' : 'unavailable',
    core: null,
    coverage: '',
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadIllinoisCore().then((core) => {
      if (cancelled) return;
      // An empty index is a build that did not run, not a university with no
      // courses, and the board must say so rather than render nothing.
      const ok = core.index.length > 0;
      setState({
        status: ok ? 'ready' : 'unavailable',
        core: ok ? core : null,
        coverage: coverageLine(core),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

// ---------------------------------------------------------------------------
// The second load, for the ask router only
// ---------------------------------------------------------------------------

let fullPromise: Promise<{ data: IllinoisData; sections: RawSectionFile | null } | null> | null =
  null;

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    if ((res.headers.get('content-type') ?? '').includes('html')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The whole adapter over the raw crawl files, once per session.
 *
 * The raw section file is handed back alongside because the router needs the
 * individual rows (CRN, room, instructor) and IllinoisData keeps only a summary.
 */
export function loadFullIllinois(): Promise<{
  data: IllinoisData;
  sections: RawSectionFile | null;
} | null> {
  if (fullPromise) return fullPromise;
  fullPromise = (async () => {
    const [catalog, programs, grades, sections] = await Promise.all([
      readJson<RawCatalogFile>('/illinois-catalog.json'),
      readJson<RawProgramFile>('/illinois-programs.json'),
      readJson<RawGradeFile>('/illinois-grades.json'),
      readJson<RawSectionFile>('/illinois-sections.json'),
    ]);
    if (!catalog) {
      // Do not memoise a failure that a retry might fix.
      fullPromise = null;
      return null;
    }
    return { data: buildIllinoisData({ catalog, programs, grades, sections }), sections };
  })();
  return fullPromise;
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

/** Degrees a four-year planner can actually plan. */
const UNDERGRAD = /^(AB|BA|BS|BFA|BLA|BMUS|BSLAS|BSW)$/i;

export function plannableProgram(p: IllinoisProgramSummary): boolean {
  return UNDERGRAD.test(p.degree) && p.dataStatus === 'catalog' && p.courseCount > 0;
}

export interface LoadedProgram {
  summary: IllinoisProgramSummary;
  program: ProgramRequirements;
  blocks: RequirementBlock[];
  /** The degree page every requirement in this program was measured against. */
  url: string;
}

/**
 * One degree, adapted here rather than at build time.
 *
 * adaptIllinoisPrograms is run over the crawled bytes in the browser so that the
 * requirement ids match the ones the same function would produce anywhere else.
 * Precomputing them in a shard and hoping they still line up is how a saved plan
 * starts pointing at requirements that no longer exist.
 */
export async function loadProgram(
  core: IllinoisCore,
  summary: IllinoisProgramSummary,
): Promise<LoadedProgram | null> {
  const raw = await loadIllinoisProgram(summary.id);
  if (!raw) return null;
  const byCode: Map<string, IllinoisCourse> = new Map(core.byCode);
  const adapted = adaptIllinoisPrograms(
    { school: 'illinois', source: summary.url, fetchedAt: '', programs: [raw] },
    byCode,
  );
  const program = adapted.programs[0];
  const blocks = adapted.blocks.get(summary.id) ?? [];
  if (!program) return null;
  // Point each course at the areas that want it, which is what colours the map
  // and what lets the finder show "required" on a card.
  attachRequirementIds(core.index, blocks, factsFor(core));
  return { summary, program, blocks, url: raw.url || summary.url };
}

/**
 * A CourseFacts map built from the index rather than from the catalog.
 *
 * Only two of its fields are read downstream: genEd, which the index carries as
 * tags, and equivalents, which it does not. Cross-listing therefore does not
 * resolve until the second load lands, so a requirement written as AAS 200 will
 * not be matched by LLS 200 before then. That is a missed match, never a false
 * one, which is the safe direction for this to be wrong in.
 */
function factsFor(core: IllinoisCore): Map<string, CourseFacts> {
  const facts = new Map<string, CourseFacts>();
  for (const course of core.index) {
    const code = normCode(course.code);
    facts.set(code, {
      code,
      creditRange: {
        credits: course.credits,
        min: course.credits,
        max: course.creditsMax ?? course.credits,
        variable: (course.creditsMax ?? course.credits) > course.credits,
        known: true,
      },
      prereq: core.prereqs?.get(code) ?? null,
      genEd: course.tags,
      equivalents: core.equivalents?.get(code) ?? [],
      exclusions: [],
      offeringKnown: false,
      catalogUrl: '',
      scheduleUrl: '',
      level: course.level,
      noise: false,
    });
  }
  return facts;
}

/**
 * The degree a student's own words point at, or nothing.
 *
 * Two halves to the score, and the second one is what makes it usable. Matching
 * the student's words against the program name is not enough on its own: at
 * Illinois "computer science" is a substring of eight different degrees, so
 * every one of them ties and the guess is a coin flip between Computer Science
 * and Computer Science + Animal Sciences. Each word of the program name the
 * student did not say is therefore a penalty, which is what separates the degree
 * they named from the six joint degrees that merely contain it.
 *
 * It still returns nothing whenever the leader is not clearly ahead. A wrong
 * degree picked silently is worse than being asked, because every requirement,
 * every prerequisite and the whole board would then be about somebody else's
 * major.
 */
export function guessProgram(
  studying: string,
  programs: IllinoisProgramSummary[],
): IllinoisProgramSummary | null {
  const words = significant(studying);
  if (words.length === 0) return null;

  const scored = programs
    .map((p) => {
      const name = p.name.toLowerCase();
      const nameWords = significant(p.name);
      let matched = 0;
      for (const w of words) if (name.includes(w)) matched += w.length;
      const extra = nameWords.filter((nw) => !words.some((w) => nw.includes(w))).length;
      // A concentration is a narrower claim than the student made.
      return { p, score: matched - 3 * extra - (p.concentration ? 3 : 0) };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1]?.score ?? 0;
  if (!best || best.score < 6 || best.score - runnerUp < 3) return null;
  return best.p;
}

/** Content words. Degree suffixes and filler say nothing about which degree. */
function significant(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

const STOP = new Set([
  'about',
  'been',
  'bslas',
  'classes',
  'doing',
  'have',
  'into',
  'like',
  'liked',
  'major',
  'minor',
  'more',
  'much',
  'ones',
  'studying',
  'taken',
  'than',
  'that',
  'them',
  'they',
  'thinking',
  'this',
  'want',
  'with',
  'would',
]);

// ---------------------------------------------------------------------------
// Prior credit
// ---------------------------------------------------------------------------

const CODE_IN_TEXT = /\b([A-Z]{2,5})\s?(\d{3,4}[A-Z]?)\b/g;

/**
 * What the student walked in with, read out of what they typed.
 *
 * Only codes the Illinois catalog actually lists are accepted. A transfer
 * student typing their old college's codes ("ENGL 1101") gets no false match,
 * and `known` goes false so the plan says out loud that it was built without a
 * transcript instead of assuming a clean start.
 *
 * Illinois publishes no AP or IB equivalence table that has been crawled, so an
 * exam the student reports is counted as unknown rather than priced. Guessing
 * that a 4 on Calculus AB clears MATH 221 would be inventing a fact about a
 * university.
 */
export function readPriorCredit(
  transferText: string,
  examCount: number,
  byCode: Map<string, { code: string }>,
  alsoCompleted: string[],
  /**
   * True when the student uploaded a transcript. It counts as having said
   * something even when none of its lines matched, which is every transcript
   * from another school, so the plan says it was built without usable prior
   * credit instead of assuming a clean start.
   */
  saidMore = false,
  /** Hours earned with no course to hold them: AP credit granted as "ECON 1--". */
  unmatchedCredits = 0,
  /** Years of one language other than English in high school, and which. One year counts as one semester. */
  languageYears: number | null = null,
  languageName: string | null = null,
): PriorCredit {
  const found = new Set<string>(alsoCompleted.map(normCode));
  const saidSomething = transferText.trim().length > 0 || examCount > 0 || saidMore;
  CODE_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_IN_TEXT.exec(transferText.toUpperCase())) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (byCode.has(code)) found.add(code);
  }
  return {
    courseCodes: [...found],
    exemptCodes: [],
    unmatchedCredits,
    known: !saidSomething || found.size > 0 || unmatchedCredits > 0,
    languageSemesters: languageYears,
    languageName: languageName?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// The planning context
// ---------------------------------------------------------------------------

/**
 * Everything the scheduler plans against, assembled from the first load.
 *
 * The nulls matter. An absent prereqs map means "not checked", which validatePlan
 * reports as an info row rather than silently passing every course, and an absent
 * grades map means no difficulty judgement rather than a cheerful one.
 */
export function buildContext(
  core: IllinoisCore,
  blocks: RequirementBlock[],
  full: IllinoisData | null,
): { context: PlanningContext; requirements: PlanRequirement[] } {
  const grades = new Map<string, GradeRow>();
  if (core.grades) {
    for (const [code, summary] of core.grades) {
      grades.set(code, toGradeRow(summary, core.byCode.get(code)?.title ?? code, []));
    }
  }

  const creditRanges = new Map<
    string,
    { credits: number; min: number | null; max: number | null; variable: boolean; known: boolean }
  >();
  for (const course of core.index) {
    const max = course.creditsMax ?? course.credits;
    creditRanges.set(normCode(course.code), {
      credits: course.credits,
      min: course.credits,
      max,
      variable: max > course.credits,
      known: true,
    });
  }

  const season = (core.meta?.term?.term ?? 'fall').toLowerCase();
  const context: PlanningContext = {
    courses: core.index,
    prereqs: core.prereqs
      ? (core.prereqs as unknown as Map<string, PlanPrereq>)
      : undefined,
    grades: core.grades ? grades : undefined,
    sections: core.sections ?? undefined,
    // Cross-listings ship in the index now, so a held LLS 200 meets a row
    // written as AAS 200 from the first plan. The full catalog is the fallback
    // for an index built before the field existed.
    equivalents: core.equivalents ?? full?.equivalents,
    // Exclusions do NOT wait. They ship in the core index now, because a plan
    // generated without them books a course whose credit will not count and
    // then counts it. That is a wrong plan, not a missing nicety.
    exclusions: core.exclusions ?? (full ? exclusionsFrom(full) : undefined),
    // The excellent list rides with the core, small and optional. Absent, the
    // scorer reports teaching ratings as not known.
    excellent: core.excellent ?? undefined,
    excellentTerms: core.excellentTerms ?? undefined,
    creditRanges,
    bands: core.meta?.bands ?? null,
    // Illinois publishes no offering term anywhere, so no course is ever refused
    // a term for being "spring only".
    // Every course the offering crawl could speak to, which is every course
    // once the crawl exists: seen courses carry their seasons, unseen ones an
    // empty list the engine treats as dormant.
    offeringPublished: core.offeringTerms ? new Set(core.index.map((c) => normCode(c.code))) : new Set<string>(),
    offerings: core.offerings ?? undefined,
    offeringTerms: core.offeringTerms ?? undefined,
    offeringAliases: core.offeringAliases ?? undefined,
    languages: core.languages ?? undefined,
    snapshotTerm: core.meta?.term
      ? {
          id: core.meta.term.id,
          label: core.meta.term.label,
          season: (season === 'spring'
            ? 'Spring'
            : season === 'summer'
              ? 'Summer'
              : 'Fall') as SemesterSeason,
        }
      : null,
    gradeFootnote: core.meta?.gradeFootnote ?? null,
    /**
     * illinois-data owns the canonical prerequisite rule, so it is injected
     * rather than left to autoplan's own copy.
     *
     * The cast is real and narrow. PlanPrereqGroup is PrereqGroup without the
     * `shape` field, so the two types are not interchangeable in general, but
     * every spec that reaches this matcher came out of prereqs.json and is a
     * PrereqSpec. Anything else would be a caller handing the scheduler a
     * prerequisite the parser never produced.
     */
    prereqCheck: (spec, earlier, sameTerm, equivalents) =>
      missingPrerequisiteGroups(
        (spec ?? null) as PrereqSpec | null,
        earlier,
        sameTerm,
        equivalents,
      ),
  };

  return { context, requirements: blocks };
}

function exclusionsFrom(full: IllinoisData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [code, fact] of full.facts) {
    if (fact.exclusions.length) out.set(code, fact.exclusions);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Where the plan starts and ends
// ---------------------------------------------------------------------------

/**
 * A term in a student's own words: "fall 2027", "Spring '28", "May 2028"
 * (a May or December graduation is the spring or fall term), "Dec 2027".
 */
const SEASON_WORD = /\b(fall|spring|summer|may|december|dec|august|aug)\s*(?:of\s*)?('\d{2}|20\d\d)\b/gi;
const MONTH_SEASON: Record<string, SemesterSeason> = { fall: 'Fall', spring: 'Spring', summer: 'Summer', may: 'Spring', december: 'Fall', dec: 'Fall', august: 'Summer', aug: 'Summer' };

/** Words that mark a date as the END of the plan. */
const GRAD_CUE = /\b(graduat\w*|finish\w*|done|complete\w*|walk|out by|degree by|by the end of|aiming for|target\w*|class of)\b/gi;
/**
 * Words that mark a date as the BEGINNING of it. A transfer student names
 * their entry term far more often than their graduation ("transferring to
 * Illinois in Fall 2027"), and a start read as an end gave them a one-year
 * plan, so every way of saying they arrive is a start. "Enrolling at
 * Illinois in Fall 2027" is the same promise; "enrolled" is left out, because
 * "enrolled at Parkland until spring 2027" is where they are now.
 */
const START_CUE = /\b(start\w*|begin\w*|began|entering|enter|enroll(?:ing)? at|arriv\w*|incoming|first (semester|term|year)|freshman|transferr?\w*|admitted|admission|coming (in|to)|join\w*|moving (to|in)|since)\b/gi;
/**
 * Words that mark a date as a term AWAY from campus: study abroad, a co-op,
 * an internship, a gap semester, a leave. Nothing is booked in such a term and
 * it is never the end of the plan. Without this, "I'm a freshman and I'm
 * studying abroad in spring 2029" read as a Spring 2029 graduation and gave a
 * four-year student a five-term degree. "intern" is spelled out so that
 * "international student" and "internal transfer" are not trips away, and
 * "co-op" likewise so that "transferring from Cooper Union in fall 2027" is
 * still a start.
 */
const AWAY_CUE = /\b(abroad|overseas|co-?op(?:s|p?ing|p?ed)?\b|co op|cooperative education|intern(?:s|ing|ships?)?|externships?|gap (?:semester|term|year)|(?:semester|term|year|time) off|leave of absence|(?:on|take|taking|medical|personal|military|parental) leave|(?:be|being|am|['’]m|go|going) away|away (?:from (?:campus|school)|for)|mission\w*|exchange (?:program|semester|term|year)|on (?:an )?exchange|deploy\w*)\b/gi;
/**
 * A year away is two terms: "a gap year in fall 2027" is Fall 2027 and Spring
 * 2028, not one fall.
 */
const WHOLE_YEAR_AWAY = /\b(gap year|year (?:abroad|off|away|overseas)|(?:full|whole|entire|academic) year|for (?:a|one|the)(?: full| whole| academic)? year)\b/i;
/**
 * What makes a summer date a summer of classes ("summer 2027 classes", "take
 * courses in summer 2028"). Read only for summer dates: summers are planned
 * only when the student asks for one, and a summer named with none of these
 * words is not that ask.
 */
const CLASS_CUE = /\b(class\w*|courses?|school|sessions?|credits?|take|taking)\b/gi;
/**
 * A summer with no year: "I want to take summer classes", "I'll do summer
 * school", "four years including summers". That is every summer between the
 * first term and the last.
 */
const SUMMER_ASK = /\bsummer\s+(?:class\w*|courses?|school|sessions?|semesters?|terms?|coursework|credits?)\b|\b(?:class\w*|courses?)\s+(?:in|over|during)\s+(?:the\s+)?summers?\b(?!\s*(?:of\s*)?(?:'\d{2}|20\d\d))|\b(?:take|taking|use|using|including|plus|with)\s+(?:the\s+|some\s+)?summers\b(?!\s+off)/gi;
/**
 * "No summer classes", "I'd rather not take summer classes", and after the
 * ask as well as before it: "summer classes aren't an option for me" booked
 * every summer until "aren't" and "isn't" counted.
 */
const NEGATION = /\b(no|not|dont|do not|never|without|avoid\w*|rather not|wont|cant|cannot|skip\w*)\b|n['’]t\b/i;
/**
 * The words after a summer ask, up to where the next thought starts: in
 * "summer classes are fine so I don't overload" the "don't" belongs to the
 * overload, not to the summer.
 */
const AFTER_ASK = /^[^.;!?,]*?(?=[.;!?,]|\b(?:so|because|since|if|but|and|then)\b|$)/i;
/**
 * Another school's end. "Finishing my associate's at Parkland in spring 2027"
 * names when they leave Parkland, and reading it as graduation from Illinois
 * gave a two-term plan.
 */
const OTHER_SCHOOL = /\b(associate['’]?s?|high school|community college|junior college)\b/i;
/**
 * A date joined to the one before by nothing but "and"/"or" shares its
 * meaning ("a co-op in fall 2028 and spring 2029"). A bare comma alone does
 * not: "study abroad spring 2029, spring 2030" is two different things. A
 * comma does join when the run of dates ends in "and"/"or", since "co-op
 * spring 2028, fall 2028, and spring 2029" is one list of three co-op terms,
 * and reading only the first left the other two booked full.
 */
const LIST_JOIN = /^[\s,(]*(?:and|or|plus|&|\/|as well as)[\s,(]*(?:also\s+)?(?:(?:in|during)\s+)?(?:the\s+)?$/i;
const COMMA_JOIN = /^\s*,\s*$/;
/** "fall 2027 through spring 2029", "Fall 2027 - Spring 2029". */
const RANGE_JOIN = /^\s*(?:-|–|—|to|through|thru|until|till)\s*$/i;
const RELATIVE_TERM = /\b(this|next|coming)\s+(fall|spring|summer|semester|term)\b/gi;

const WORD_NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** The last match of a cue in a clause, as its end position, or -1. */
function lastCueAt(re: RegExp, clause: string): number {
  let at = -1;
  for (const m of clause.matchAll(re)) at = (m.index ?? 0) + m[0].length;
  return at;
}

/**
 * The fall or spring term `n` terms after the given one, summers skipped. A
 * summer counts as the fall after it, the way a summer start is planned.
 */
function stepTerms(season: SemesterSeason, year: number, n: number): { season: SemesterSeason; year: number } {
  const t = year * 2 + (season === 'Spring' ? 0 : 1) + n;
  return { season: t % 2 ? 'Fall' : 'Spring', year: Math.floor(t / 2) };
}

type DateCue = 'grad' | 'start' | 'away' | 'summer' | 'skip' | null;

/**
 * What one date in the answer is: the end, the start, a term away, a summer of
 * classes, a date about something else ('skip', never read as anything), or
 * unlabelled (null).
 *
 * The clause in front of the date decides first, and inside it the cue nearest
 * the date wins: in "Freshman. Planning to study abroad spring 2029,
 * graduating spring 2030" abroad owns 2029 and graduating owns 2030. That
 * clause stops at a sentence break, "and"/"but", or the date before, so one
 * date's word does not leak onto the next. Only when nothing in front speaks
 * do the words right after the date ("Spring 2027 start", "summer 2027
 * classes", "Fall 2028 co-op"), and a date followed by "off" is a term away
 * whatever came before it ("taking summer 2028 off"). `startsNow` says the
 * date is the term the plan starts from or earlier; `fromAfter` says the cue
 * came from the words after the date, which can then speak for the dates
 * listed before it.
 */
function cueOfDate(
  timeline: string,
  date: { at: number; end: number; season: SemesterSeason },
  prevEnd: number,
  nextAt: number,
  startsNow: boolean,
): { cue: DateCue; wholeYear: boolean; fromAfter: boolean } {
  const window = timeline.slice(Math.max(0, date.at - 70, prevEnd), date.at);
  const cut = Math.max(window.search(/[.;!?][^.;!?]*$/), ...[...window.matchAll(/\b(and|but)\b/gi)].map((b) => b.index ?? -1));
  const clause = cut >= 0 ? window.slice(cut) : window;
  const tail = timeline.slice(date.end, Math.min(date.end + 40, nextAt));
  const stop = tail.search(/[.;!?,]|\b(and|but|then|so|or|to|through|thru|until|till)\b|\s[-–—]|[–—]/i);
  const after = stop >= 0 ? tail.slice(0, stop) : tail;

  const kinds: Array<[RegExp, 'grad' | 'start' | 'away' | 'summer']> = [[GRAD_CUE, 'grad'], [START_CUE, 'start'], [AWAY_CUE, 'away']];
  if (date.season === 'Summer') kinds.push([CLASS_CUE, 'summer']);

  let cue: DateCue = null;
  let cueEnd = -1;
  for (const [re, kind] of kinds) {
    const p = lastCueAt(re, clause);
    if (p > cueEnd) {
      cueEnd = p;
      cue = kind;
    }
  }
  const fromClause = cue !== null;
  if (/^\s*(off|abroad|away|overseas)\b/i.test(after)) cue = 'away';
  else if (cue === null) {
    let first = Infinity;
    for (const [re, kind] of kinds) {
      const p = after.search(re);
      if (p >= 0 && p < first) {
        first = p;
        cue = kind;
      }
    }
  }

  if (fromClause) {
    const awayWord = [...clause.matchAll(AWAY_CUE)].pop();
    const awayEnd = awayWord ? (awayWord.index ?? 0) + awayWord[0].length : -1;
    // "study abroad for a year starting fall 2028", "my co-op begins spring
    // 2029": the start word begins the time away, not the degree, and reading
    // it as the start moved a freshman's whole plan two years out. Not when it
    // is who they are ("co-op student starting fall 2027"), when something
    // ends in between ("gap year done, starting fall 2027"), when the time
    // away is behind them ("after a gap year", "I took a gap year"), or when
    // the start is a new thought: "I'm taking a gap year then starting in fall
    // 2027" and "gap year first, then I start fall 2027" begin the degree, and
    // reading them as away kept the plan at Fall 2026 with a year cut out. A
    // comma is a new thought only after time off that comes before the degree
    // ("taking a gap year, starting fall 2027"); after a trip it is still the
    // trip ("co-op with John Deere, starting fall 2028"). Nor is the term the
    // plan starts in the start of a trip ("the co-op program, starting fall
    // 2026" is the degree), since that emptied the student's first term.
    if (cue === 'start' && awayWord && !startsNow) {
      const begin = [...clause.matchAll(START_CUE)].pop();
      const between = begin && (begin.index ?? 0) >= awayEnd ? clause.slice(awayEnd, begin.index) : null;
      if (
        begin &&
        between !== null &&
        /^(start|begin|began)/i.test(begin[0]) &&
        between.search(GRAD_CUE) < 0 &&
        !/\bstudents?\b/i.test(between) &&
        !/\b(then|first|afterwards?|i|i['’]m|i['’]ll|we)\b/i.test(between) &&
        !(/[,;:]/.test(between) && /\b(gap|off|leave|mission|deploy)/i.test(awayWord[0])) &&
        !/\b(after|following|post|back from|return\w*|took|did|had|spent|finished|completed|was|were)\b/i.test(clause.slice(0, awayWord.index))
      ) cue = 'away';
    }
    // "back from my co-op in spring 2029" is the term they return: not away,
    // and not the end either.
    if (cue === 'away' && awayWord && /\b(back from|return\w*(?: from)?)\s+(?:\S+\s+){0,2}$/i.test(clause.slice(0, awayWord.index))) cue = 'skip';
    if (cue === 'grad' && OTHER_SCHOOL.test(clause.slice(cueEnd))) cue = 'skip';
  }
  if (cue === 'summer' && NEGATION.test(`${clause} ${after}`)) cue = 'skip';
  // "I'll have my associate's by May 2027": another school's date, unlabelled
  // but not ours. Only when the school is right before the date, since
  // "transfer with an associate's degree, spring 2029" is about Illinois.
  if (cue === null && new RegExp(`${OTHER_SCHOOL.source}[^,.;!?]{0,25}$`, 'i').test(clause)) cue = 'skip';

  // A year away is read from the away phrase itself, not the whole clause:
  // in "I worked for a year, then co-op fall 2028" the year is behind them and
  // the co-op is one term.
  const firstAway = clause.search(AWAY_CUE);
  const lead = firstAway >= 0 ? clause.slice(0, firstAway) : clause;
  const phrase = clause.slice(Math.max(0, lead.search(/(?:[,;:]|\bthen\b)[^,;:]*$/)));
  return {
    cue,
    wholeYear: cue === 'away' && WHOLE_YEAR_AWAY.test(`${phrase} ${after}`),
    fromAfter: cue !== null && !fromClause,
  };
}

/**
 * A stated length, as the number of fall and spring terms it covers, or null.
 *
 * "Four years." and "4 years" are as much a span as "in four years", and
 * reading only the "in" form left the most common answer to onboarding's
 * timeline question ("Freshman fall 2026, four years.") unstated. Half years
 * count: "three and a half years", "3.5 years" and "4.5 years is fine" are 7
 * and 9 terms. "5 semesters" and "4 semesters left" are terms already.
 *
 * A number of years is also history as often as it is a plan, so these are
 * not spans: a past ("took two years at Parkland", "after two years", "for two
 * years"), an amount of something ("in 2 years of high school", "4 years of
 * Spanish"), an age ("18 years old"), an adjective ("a 2 year college", "a
 * four-year university"), and time away ("two semesters abroad"). "A semester
 * early" is read by earlyTerms.
 *
 * The past is not always the word right before the number: "I've been at
 * Illinois 1 year and want to graduate in 3 more years" read the 1 year as the
 * span and gave a two-term plan, and "I served 4 years in the Marines, want to
 * finish in 3 years" read the Marines. So a clause that tells what the student
 * did (been, took, spent, served, worked) is history unless a word of intent
 * follows it ("I've been hoping to finish in 4 years"). "N more years" and "N
 * years left" are plans whatever came before.
 */
function spanTerms(timeline: string): number | null {
  const SPAN = /\b(\d{1,2}(?:\.5)?|an?|one|two|three|four|five|six|seven|eight|nine|ten)((?:[\s-]+and[\s-]+a[\s-]+half)|\s*½|\s+1\/2)?(\s*-\s*|\s*)(?:more\s+|full\s+|academic\s+)?(years?|yrs?|semesters?|terms?)\b(\s+and\s+a\s+half)?/gi;
  for (const m of timeline.matchAll(SPAN)) {
    const at = m.index ?? 0;
    const word = m[1].toLowerCase();
    const half = Boolean(m[2] || m[5]);
    const unit = m[4].toLowerCase();
    const years = unit.startsWith('y');
    const n = (WORD_NUMBER[word] ?? Number(word)) + (half ? 0.5 : 0);
    const rest = timeline.slice(at + m[0].length, at + m[0].length + 30);
    const lead = timeline
      .slice(Math.max(0, at - 40), at)
      .replace(/(?:\b(?:about|around|almost|nearly|roughly|like|maybe|probably|over|under|just|only|the|my|another|other)\s*)+$/i, '');
    // "a year and a half" is a span; "a semester" and "a year" alone are not.
    if ((word === 'a' || word === 'an') && !half) continue;
    // An adjective, unless it is the plan itself ("a four-year plan").
    if ((m[3].includes('-') || (!unit.endsWith('s') && n > 1.5)) && !/^\s*(plan|track|timeline|graduation)\b/i.test(rest)) continue;
    if (/^\s*(?:of|ago|old|off|abroad|away|overseas|into|already|before|back|done|down|completed|finished|since|ahead|behind|early|earlier|sooner|so far|under my belt)\b|^\s*in\s*(?:[.,;!?)]|$)|^\s*at\s+(?!illinois|uiuc|u of i|the university|urbana)|^\s*as\s+an?\b|^\s*(?:in|with)\s+(?:the\s+)?(?:military|army|navy|marines?|marine corps|air force|coast guard|national guard|reserves?|peace corps|service|workforce)\b|^\s*(?:co-?op|internship|exchange|gap)\b/i.test(rest)) continue;
    if (/\b(took|spent|after|did|done|completed?|finished|had|been|was|were|attended|past|last|first|since)\s*$/i.test(lead)) continue;
    if (/\bfor\s*$/i.test(lead) && !/\b(aim\w*|go\w*|shoot\w*|hop\w*|plan\w*|look\w*)\s+for\s*$/i.test(lead)) continue;
    const plainly = /\bmore\b/i.test(m[0]) || /^\s*(?:left|remaining|to go)\b/i.test(rest);
    const clause = lead.slice(Math.max(lead.search(/[.,;:!?()][^.,;:!?()]*$/), ...[...lead.matchAll(/\b(and|but)\b/gi)].map((b) => b.index ?? -1), 0));
    const did = [...clause.matchAll(/\b(took|taken|spent|been|attended|served|worked|working|lived|did|after|used)\b/gi)].pop();
    if (!plainly && did && !/\b(graduat\w*|finish\w*|done|complet\w*|want\w*|plan\w*|hop\w*|aim\w*|need\w*|expect\w*|could|can|should|will|would|gonna|intend\w*|try\w*|take|takes|taking|like|told)\b/i.test(clause.slice((did.index ?? 0) + did[0].length))) continue;
    const terms = Math.round(years ? n * 2 : n);
    if (terms >= 1) return terms;
  }
  return null;
}

/**
 * "A semester early", "one semester early", "a year early": terms taken off a
 * four-year plan. "Graduate early" alone names no amount and changes nothing.
 */
function earlyTerms(timeline: string): number | null {
  const m = timeline.match(/\b(an?|one|two|three|\d)\s+(?:full\s+|whole\s+)?(semesters?|terms?|years?)\s+(?:early|earlier|sooner)\b|\bearly\s+by\s+(an?|one|two|three|\d)\s+(semesters?|terms?|years?)\b/i);
  if (!m) return null;
  const word = (m[1] ?? m[3]).toLowerCase();
  const unit = (m[2] ?? m[4]).toLowerCase();
  return (WORD_NUMBER[word] ?? Number(word)) * (unit.startsWith('y') ? 2 : 1);
}

/**
 * The student's own timeline where they gave one, the crawled term otherwise.
 *
 * The hard part is telling a start date from an end date, and the first version
 * did not try: it took the first season and year anywhere in the answer and
 * called it graduation. Onboarding asks "When do you want to finish, and where
 * are you now?", which invites both dates in one sentence, so an incoming
 * freshman who wrote "starting fall 2026, want to finish in four years" got a
 * horizon of Fall 2026 to Fall 2026 and a ONE SEMESTER plan presented as a
 * finished four-year plan.
 *
 * So every date is classified by the words of its own clause, and when a
 * clause has both kinds of word ("I start in Fall 2027 and want to graduate in
 * Spring 2029" is two clauses; "transferring in to graduate by Fall 2027" is
 * one) the cue nearest the date wins. A relative span ("in four years") is
 * honoured when no end date is named, and a start in the past ("I transferred
 * in fall 2025") is where the student began, not where the plan does: the plan
 * never starts before the current term. Nothing is inferred from silence.
 *
 * Not every date is a start or an end. A term away ("I might co-op in fall
 * 2028. Four years.") went into the only slot there was and became graduation,
 * a five-term plan for a student who had just said four years. Such dates are
 * now `away`: kept in the calendar with nothing booked. A summer internship is
 * dropped, since a summer is planned only when asked for, and "summer 2027
 * classes" or "I'll take summer classes" is that ask, returned in `summers`.
 * For the same reason a stated span outranks a date with no cue at all: "four
 * years" is a sentence about the end, a bare "spring 2029" may not be.
 */
export function readHorizon(
  timeline: string,
  startTerm: { season: SemesterSeason; year: number },
): {
  startSeason: SemesterSeason;
  startYear: number;
  gradSeason: SemesterSeason;
  gradYear: number;
  stated: boolean;
  away: Array<{ season: SemesterSeason; year: number }>;
  summers: number[];
} {
  const ordOf = (season: SemesterSeason, year: number) => year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
  const nowOrd = ordOf(startTerm.season, startTerm.year);

  // Every date in the answer, in the order written.
  const dates: Array<{ season: SemesterSeason; year: number; at: number; end: number; relative: boolean }> = [];
  for (const m of timeline.matchAll(SEASON_WORD)) {
    const at = m.index ?? 0;
    dates.push({
      season: MONTH_SEASON[m[1].toLowerCase()] ?? 'Fall',
      year: m[2].startsWith("'") ? 2000 + Number(m[2].slice(1)) : Number(m[2]),
      at,
      end: at + m[0].length,
      relative: false,
    });
  }
  // "next fall", "this spring": the first such term after the current one
  // (this fall, in a fall, is the current term). "Next semester" is the fall
  // or spring after this one.
  for (const m of timeline.matchAll(RELATIVE_TERM)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (dates.some((d) => d.at >= at && d.at < end)) continue;
    const word = m[2].toLowerCase();
    const which = m[1].toLowerCase();
    let term: { season: SemesterSeason; year: number };
    if (word === 'semester' || word === 'term') {
      term = which === 'this' ? { season: startTerm.season, year: startTerm.year } : stepTerms(startTerm.season === 'Summer' ? 'Spring' : startTerm.season, startTerm.year, 1);
    } else {
      const season = MONTH_SEASON[word];
      const order = { Spring: 0, Summer: 1, Fall: 2 } as const;
      const same = order[season] === order[startTerm.season];
      const later = order[season] < order[startTerm.season] || (same && which !== 'this');
      term = { season, year: startTerm.year + (later ? 1 : 0) };
    }
    dates.push({ ...term, at, end, relative: true });
  }
  dates.sort((a, b) => a.at - b.at);

  type Found = { season: SemesterSeason; year: number; cue: DateCue; wholeYear: boolean };
  const found: Found[] = [];
  // What a date takes from the list it is in. A summer of classes passes only
  // to another summer: in "classes in summer 2027 and fall 2028" the fall is
  // an ordinary term, and inheriting the cue booked it as Summer 2028.
  const inherit = (cue: DateCue, season: SemesterSeason): DateCue => (cue === 'summer' && season !== 'Summer' ? 'skip' : cue);
  // Unlabelled dates joined by bare commas after a term away or a summer of
  // classes, held until an "and"/"or" shows they were a list ("co-op spring
  // 2028, fall 2028, and spring 2029"). Only those two: a start or an end is
  // one date, and in "starting fall 2026, spring 2030 and fall 2030 both
  // work" carrying the start on would move the plan to Spring 2030.
  let pending: { head: Found; items: Found[] } | null = null;
  dates.forEach((d, i) => {
    const prev = i > 0 ? dates[i - 1] : null;
    const before = i > 0 ? found[i - 1] : null;
    const read = cueOfDate(timeline, d, prev?.end ?? 0, dates[i + 1]?.at ?? timeline.length, ordOf(d.season, d.year) <= nowOrd);
    let { cue, wholeYear } = read;
    const { fromAfter } = read;
    const between = prev ? timeline.slice(prev.end, d.at) : '';
    const chain = pending;
    pending = null;
    if (before && RANGE_JOIN.test(between) && ordOf(before.season, before.year) >= nowOrd) {
      // "fall 2027 through spring 2029" is a start and an end, unless it is
      // the length of a stay away ("abroad fall 2028 - spring 2029", or "fall
      // 2028 to spring 2029 abroad", where the word comes last and the first
      // date, read as the start, moved a freshman's plan two years out). A
      // range that begins in the past is history, not a plan.
      if (before.cue === 'away' || (before.cue === null && cue === 'away')) {
        if (before.cue === null) before.cue = 'away';
        cue = 'away';
        wholeYear = false;
      } else {
        if (before.cue === null) before.cue = 'start';
        if (cue === null) cue = 'grad';
      }
    } else if (cue === null && LIST_JOIN.test(between) && (before?.cue || chain)) {
      // "a co-op in fall 2028 and spring 2029": the second date says nothing of
      // its own, and read alone it was the only unlabelled date, which made it
      // graduation. Dates held by commas before it are in the same list. A
      // list names its own terms, so none of them is stretched to a year: "a
      // year abroad in fall 2028 and spring 2029" is those two terms, and
      // stretching each one marked Fall 2029 away as well.
      const head = before?.cue ? before : chain!.head;
      head.wholeYear = false;
      for (const p of chain?.items ?? []) {
        p.cue = inherit(head.cue, p.season);
        p.wholeYear = false;
      }
      cue = inherit(head.cue, d.season);
      wholeYear = false;
    } else if (fromAfter && before?.cue === null && LIST_JOIN.test(between)) {
      // The word can come after the whole list: "summer 2027 and summer 2028
      // classes", "fall 2028 and spring 2029 co-ops". Without this only the
      // last date was read and Summer 2027 was never planned.
      wholeYear = false;
      for (let j = i - 1; j >= 0 && found[j].cue === null; j--) {
        found[j].cue = inherit(cue, found[j].season);
        const join = j > 0 ? timeline.slice(dates[j - 1].end, dates[j].at) : '';
        if (!LIST_JOIN.test(join) && !COMMA_JOIN.test(join)) break;
      }
    }
    if (cue === null && d.relative) cue = 'start';
    const entry: Found = { season: d.season, year: d.year, cue, wholeYear };
    found.push(entry);
    const head = before?.cue === 'away' || before?.cue === 'summer' ? before : chain?.head;
    if (cue === null && head && COMMA_JOIN.test(between)) {
      pending = { head, items: [...(chain?.items ?? []), entry] };
    }
  });

  // A bare year after a graduation word ("class of 2029", "graduating 2028")
  // is that spring, the term Illinois holds its main commencement. Not when the
  // thing finishing is another school or a stay away ("finish my associate's
  // in 2027", "finish my co-op in 2028").
  for (const m of timeline.matchAll(/\b(class of|graduat\w*|finish\w*|done)\b[^.;!?\d]{0,20}(20\d\d)\b/gi)) {
    const year = Number(m[2]);
    const before = timeline.slice(Math.max(0, (m.index ?? 0) + m[0].length - 14), (m.index ?? 0) + m[0].length);
    if (/\b(fall|spring|summer|may|december|dec|august|aug)\b/i.test(before)) continue;
    if (OTHER_SCHOOL.test(m[0]) || m[0].search(AWAY_CUE) >= 0) continue;
    found.push({ season: 'Spring', year, cue: 'grad', wholeYear: false });
  }

  // A start in the past is where the student began; the plan starts now. The
  // first start still ahead is the one that counts, so "I started at Parkland
  // in fall 2024 and will transfer fall 2027" starts in Fall 2027.
  const future = found.find((f) => f.cue === 'start' && ordOf(f.season, f.year) > nowOrd);
  const startSeason = future ? (future.season === 'Summer' ? 'Fall' : future.season) : startTerm.season;
  const startYear = future?.year ?? startTerm.year;
  const startOrd = ordOf(startSeason, startYear);

  // The end, in order of how plainly the student said it: a date with a
  // graduation word; a span ("finish in four years", "two more years", "4.5
  // years is fine"), which are real constraints even with no end date in them;
  // "a semester early", counted back from the default end below (Spring of
  // the fourth year after the start), so it is always one term sooner than
  // the plan they would get otherwise, a spring start included; and last a
  // date with no cue at all, only when it is the only date that is not a
  // start, since "I'm a sophomore, spring 2029" leaves it bare more often
  // than not. A term away still counts against that: in "I leave for my
  // mission in spring 2027 and come back fall 2029" the second date is the
  // return, and it became graduation once the first stopped competing. A
  // graduation date on or before the start ("I'll finish at Parkland in spring 2027 and start at Illinois
  // fall 2027. Want to be done in two years.") is some other ending, so it
  // gives way to the span instead of sinking the whole answer.
  const fits = (f: { season: SemesterSeason; year: number }) => ordOf(f.season, f.year) > startOrd && f.year <= startYear + 8;
  const span = spanTerms(timeline);
  const early = earlyTerms(timeline);
  const notStart = found.filter((f) => f.cue !== 'start');
  const lone = notStart.length === 1 && notStart[0].cue === null && fits(notStart[0]) ? notStart[0] : null;
  const end =
    found.find((f) => f.cue === 'grad' && fits(f)) ??
    (span ? stepTerms(startSeason, startYear, span - 1) : null) ??
    (early ? stepTerms('Spring', startYear + 4, -early) : null) ??
    lone;

  let gradSeason: SemesterSeason = end?.season ?? 'Spring';
  let gradYear = end?.year ?? startYear + 4;
  let stated = Boolean(end);

  // A graduation on or before the first term is a misread, not a plan, and
  // shipping it produced a one-semester degree. Fall back rather than show it.
  if (ordOf(gradSeason, gradYear) <= startOrd || gradYear > startYear + 8) {
    gradSeason = 'Spring';
    gradYear = startYear + 4;
    stated = false;
  }
  const gradOrd = ordOf(gradSeason, gradYear);

  // Terms away inside the plan, in order. A summer away (the summer
  // internship) is not a fall or spring lost, so it is not listed.
  const awayBy = new Map<number, { season: SemesterSeason; year: number }>();
  for (const f of found) {
    if (f.cue !== 'away' || f.season === 'Summer') continue;
    for (const t of f.wholeYear ? [{ season: f.season, year: f.year }, stepTerms(f.season, f.year, 1)] : [{ season: f.season, year: f.year }]) {
      const o = ordOf(t.season, t.year);
      if (o >= startOrd && o <= gradOrd) awayBy.set(o, t);
    }
  }
  const away = [...awayBy.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);

  // Summers of classes: the ones named ("summer 2027 classes"), the summer of
  // a summer graduation ("August 2029" is finished in Summer 2029 classes), and
  // for a summer with no year ("I'll take summer classes") every summer
  // strictly between the first term and the last. A summer away is never one.
  const summerSet = new Set<number>();
  for (const f of found) if (f.cue === 'summer') summerSet.add(f.year);
  if (gradSeason === 'Summer') summerSet.add(gradYear);
  for (const m of timeline.matchAll(SUMMER_ASK)) {
    const at = m.index ?? 0;
    const lead = timeline.slice(Math.max(0, at - 40), at);
    const leadCut = Math.max(lead.search(/[.;!?,][^.;!?,]*$/), ...[...lead.matchAll(/\b(but|and|so)\b/gi)].map((b) => b.index ?? -1));
    if (NEGATION.test(leadCut >= 0 ? lead.slice(leadCut) : lead)) continue;
    if (NEGATION.test(timeline.slice(at + m[0].length).match(AFTER_ASK)?.[0] ?? '')) continue;
    const years = timeline.slice(at + m[0].length).match(/^\s*(?:(?:in|during|for)\s+)?(?:of\s+)?(20\d\d(?:\s*(?:,|and|&|or)\s*20\d\d)*)\b/i);
    if (years) {
      for (const y of years[1].match(/20\d\d/g) ?? []) summerSet.add(Number(y));
      continue;
    }
    for (let y = startYear; y <= gradYear; y++) {
      const o = ordOf('Summer', y);
      if (o > startOrd && o < gradOrd) summerSet.add(y);
    }
  }
  for (const f of found) if (f.cue === 'away' && f.season === 'Summer') summerSet.delete(f.year);
  const summers = [...summerSet].filter((y) => ordOf('Summer', y) > startOrd && ordOf('Summer', y) <= gradOrd).sort((a, b) => a - b);

  return { startSeason, startYear, gradSeason, gradYear, stated, away, summers };
}

// ---------------------------------------------------------------------------
// Course detail, one course at a time
// ---------------------------------------------------------------------------

export interface DetailState {
  code: string | null;
  loading: boolean;
  detail: Awaited<ReturnType<typeof import('@/lib/planner/illinois-load').loadIllinoisCourseDetail>>;
}

/**
 * The open card's description, its real sections and its per-instructor history.
 *
 * index.json carries no description at all, so a card that rendered its blank
 * field would show a course with nothing to say about itself. This fetches the
 * subject shard the first time a course in that subject is opened and never again.
 */
export function useCourseDetail(code: string | null, enabled = true): DetailState {
  const [state, setState] = useState<DetailState>({ code: null, loading: false, detail: null });
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    wanted.current = code;
    if (!code || !enabled) return;
    void import('@/lib/planner/illinois-load').then(({ loadIllinoisCourseDetail }) =>
      loadIllinoisCourseDetail(code).then((detail) => {
        // A slow shard for a course the student has already clicked away from
        // must not overwrite the one they are looking at now.
        if (wanted.current !== code) return;
        setState({ code, loading: false, detail });
      }),
    );
  }, [code, enabled]);

  /**
   * "Loading" is derived from the gap between the code asked for and the code
   * in hand, not written into state when the fetch starts. Writing it would
   * show the previous course's description for one frame under the new
   * course's heading, and it is a synchronous setState inside an effect.
   */
  if (!enabled) return { code, loading: false, detail: null };
  if (state.code !== code) return { code, loading: code !== null, detail: null };
  return state;
}
