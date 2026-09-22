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

const CODE_IN_TEXT = /\b([A-Z]{2,4})\s?(\d{3})\b/g;

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
    creditRanges,
    bands: core.meta?.bands ?? null,
    // Illinois publishes no offering term anywhere, so no course is ever refused
    // a term for being "spring only".
    offeringPublished: new Set<string>(),
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

const SEASON_WORD = /\b(fall|spring|summer)\s*(20\d\d)\b/gi;

/** Words that mark a date as the END of the plan. */
const GRAD_CUE = /\b(graduat\w*|finish\w*|done|complete\w*|walk|out by|degree by|by the end of|aiming for|target\w*)\b/i;
/** Words that mark a date as the BEGINNING of it. */
const START_CUE = /\b(start\w*|begin\w*|began|entering|enter|arriv\w*|incoming|first (semester|term|year)|freshman|transferr?\w* in|since)\b/i;

const WORD_YEARS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

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
 * So every date in the sentence is classified by the words in front of it, and
 * a relative span ("in four years") is honoured when no end date is named.
 * Nothing is inferred from silence.
 */
export function readHorizon(
  timeline: string,
  startTerm: { season: SemesterSeason; year: number },
): { startSeason: SemesterSeason; startYear: number; gradSeason: SemesterSeason; gradYear: number; stated: boolean } {
  const found: Array<{ season: SemesterSeason; year: number; cue: 'grad' | 'start' | null }> = [];
  for (const m of timeline.matchAll(SEASON_WORD)) {
    // The clause in front of the date is what says which end it is. 40
    // characters covers "I want to graduate by" without reaching the previous
    // sentence's cue word.
    const before = timeline.slice(Math.max(0, m.index - 40), m.index);
    found.push({
      season: (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as SemesterSeason,
      year: Number(m[2]),
      cue: GRAD_CUE.test(before) ? 'grad' : START_CUE.test(before) ? 'start' : null,
    });
  }

  const named = found.find((f) => f.cue === 'start');
  const startSeason = named?.season ?? startTerm.season;
  const startYear = named?.year ?? startTerm.year;

  // "finish in four years" is a real constraint even with no end date in it.
  const spanM = timeline.match(/\bin\s+(\d|one|two|three|four|five|six)\s*(?:more\s*)?years?\b/i);
  const span = spanM
    ? (WORD_YEARS[spanM[1].toLowerCase() as keyof typeof WORD_YEARS] ?? Number(spanM[1]))
    : null;

  // An unlabelled date is a graduation date only when it is the only one, since
  // "I'm a sophomore, graduating 2029" leaves the year bare more often than not.
  const grad =
    found.find((f) => f.cue === 'grad') ??
    (found.filter((f) => f.cue !== 'start').length === 1
      ? found.find((f) => f.cue !== 'start')
      : undefined);

  let gradSeason = grad?.season ?? ('Spring' as SemesterSeason);
  let gradYear = grad?.year ?? (span ? startYear + span : startYear + 4);
  let stated = Boolean(grad) || span !== null;

  // A graduation on or before the first term is a misread, not a plan, and
  // shipping it produced a one-semester degree. Fall back rather than show it.
  const ord = (season: SemesterSeason, year: number) =>
    year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
  if (ord(gradSeason, gradYear) <= ord(startSeason, startYear) || gradYear > startYear + 8) {
    gradSeason = 'Spring';
    gradYear = startYear + 4;
    stated = false;
  }

  return { startSeason, startYear, gradSeason, gradYear, stated };
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
export function useCourseDetail(code: string | null): DetailState {
  const [state, setState] = useState<DetailState>({ code: null, loading: false, detail: null });
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    wanted.current = code;
    if (!code) return;
    void import('@/lib/planner/illinois-load').then(({ loadIllinoisCourseDetail }) =>
      loadIllinoisCourseDetail(code).then((detail) => {
        // A slow shard for a course the student has already clicked away from
        // must not overwrite the one they are looking at now.
        if (wanted.current !== code) return;
        setState({ code, loading: false, detail });
      }),
    );
  }, [code]);

  /**
   * "Loading" is derived from the gap between the code asked for and the code
   * in hand, not written into state when the fetch starts. Writing it would
   * show the previous course's description for one frame under the new
   * course's heading, and it is a synchronous setState inside an effect.
   */
  if (state.code !== code) return { code, loading: code !== null, detail: null };
  return state;
}
