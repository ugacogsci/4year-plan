'use client';

/**
 * The planner, in one screen.
 *
 * Five regions in a 100dvh grid: head, rail, board, finder, ask. Nothing about
 * the page scrolls. The board scrolls sideways, the rail and the finder scroll
 * inside themselves, and each semester column scrolls its own courses.
 *
 * The layout is not cosmetic. The previous surface was 1887px tall with the map
 * in a full-width band above the board, which put the map stage at y 315-695 and
 * the first semester column at y 1051-1349: 1034px apart in a 950px viewport,
 * so there was no scroll position that showed a drag source and a drop target at
 * the same time. Dragging a course out of the map into a semester, which is the
 * thing this product is for, could not be performed at all. Map and board are
 * now sibling columns of the same frame.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Save,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AskBar } from './ask-bar';
import { CourseExplorer } from './course-explorer';
import { ElectivePools } from './elective-pools';
import { groupIssues, PlanHealthList } from './plan-health';
import { SemesterColumn } from './semester-column';
import { StudentProfilePanel, type AreaRow } from './student-profile-panel';
import {
  buildContext,
  guessProgram,
  loadFullIllinois,
  loadProgram,
  plannableProgram,
  readHorizon,
  readPriorCredit,
  useIllinoisCore,
  type LoadedProgram,
} from './illinois-source';
import {
  describeCreditProgress,
  describeCreditTotal,
  generatePlan,
  planCreditRange,
  validatePlan,
  type CreditTotal,
  type GeneratedPlan,
  type NotPlaced,
  type PlanningContext,
  type PoolReport,
  type UnsatisfiedRequirement,
} from '@/lib/planner/autoplan';
import { livePools, poolShortfalls } from './live-pools';
import { plural } from './words';
import { examCourses, useExamCredit } from './exam-credit';
import { areaProgress } from '@/lib/planner/scheduler';
import { sectionRowsFrom, type AskContext, type PlannedCourse } from '@/lib/planner/ask-router';
import { createSamplePlan, sampleCourses, samplePrograms } from '@/lib/planner/sample-data';
import {
  getPlanCredits,
  getPlanIssues,
  getPlannedCourseIds,
  getTermCredits,
  indexCourses,
  isPlanState,
} from '@/lib/planner/rules';
import type { Course, PlanIssue, PlanState } from '@/lib/planner/types';
import { clearAnswers, schoolById, summarize, type OnboardingAnswers } from '@/lib/planner/onboarding';

const STORAGE_KEY = 'four-year-planner-v3';

/**
 * The calendar year of a term, from its id ("2027-spring") or its label
 * ("Spring 2027"). PlanTerm carries the year of study, which is a different
 * number and not the one a student types into the ask bar.
 */
function calendarYearOf(term: { id: string; label: string; year: number }): number {
  const fromId = term.id.match(/\b(20\d\d)\b/);
  if (fromId) return Number(fromId[1]);
  const fromLabel = term.label.match(/\b(20\d\d)\b/);
  return fromLabel ? Number(fromLabel[1]) : term.year;
}


/** What the constellation paints. See mapCourses below for why it is bounded. */
const MAP_LIMIT = 240;

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * autoplan's NotPlaced reasons, in the product's own words.
 *
 * Every reason the scheduler can report needs a line here. The fallback prints
 * the reason itself, and a student who saw "standing-unmet" was reading a field
 * name out of somebody's source code.
 */
const NOT_PLACED_WORD: Record<string, string> = {
  'chain-too-long': 'the prerequisite chain does not fit in the years left',
  'no-room': 'no term had room before graduation',
  'prereq-unmet': 'a prerequisite is not met',
  'offering-conflict': 'not offered in any remaining term',
  'standing-unmet': 'you are not far enough through the degree yet',
};

/**
 * What the last generation said, kept so every panel can be recounted.
 *
 * The pool panel and the review list used to be written once, when the plan was
 * built, and never again. The student then moved a course and both went on
 * printing numbers about a board that no longer existed. This holds only the
 * parts a board edit cannot change: which pools the degree has, what each one
 * asked for, and which requirements the scheduler could not fill at all.
 * Everything countable is counted again from the terms on screen.
 */
interface PlanReport {
  pools: PoolReport[];
  unsatisfied: UnsatisfiedRequirement[];
  notPlaced: NotPlaced[];
  firstTermId: string;
}

interface Stored {
  schemaVersion: 3;
  schoolId: string;
  programId: string | null;
  plan: PlanState;
  minimumTermCredits: number;
  careerInterests: string;
}

export function PlannerWorkspace({ answers }: { answers?: OnboardingAnswers }) {
  const school = schoolById(answers?.schoolId ?? null);
  const isIllinois = school?.id === 'illinois';
  const { status, core, coverage } = useIllinoisCore(Boolean(isIllinois));
  /**
   * The AP and IB credit the registrar grants, so the plan starts where the
   * student starts. Naming the exams in onboarding and then planning as if they
   * had not happened is the same bug as ignoring a transcript.
   */
  const examCredit = useExamCredit(school);

  const [plan, setPlan] = useState<PlanState | null>(null);
  const [undoStack, setUndoStack] = useState<PlanState[]>([]);
  const [programId, setProgramId] = useState<string | null>(null);
  /**
   * The degree page, tagged with the degree it belongs to.
   *
   * The id travels with the value so that a render between "the student picked
   * a new degree" and "its page finished loading" cannot hand the previous
   * degree's requirements to the board, and so that "still loading" is a
   * comparison rather than a second piece of state set inside an effect.
   */
  const [fetched, setFetched] = useState<{ id: string; value: LoadedProgram | null } | null>(null);
  const [planNotes, setPlanNotes] = useState<string[]>([]);
  const [report, setReport] = useState<PlanReport | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [focusTermId, setFocusTermId] = useState<string | null>(null);
  const [targetTermId, setTargetTermId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [finderOpen, setFinderOpen] = useState(false);
  const [dragUsable, setDragUsable] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [minimumTermCredits, setMinimumTermCredits] = useState(12);
  const [careerInterests, setCareerInterests] = useState(answers?.after ?? '');
  const [status_, setStatus] = useState('');
  const restored = useRef<Stored | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const lastBucket = useRef<string | null>(null);

  /**
   * The finder opens itself on a wide screen and stays shut on a narrow one.
   *
   * The declutter spec wanted it collapsed everywhere. It is open here at 1280px
   * and up for one reason: the user's hard requirement is dragging a course out
   * of the map into a semester, and a map behind a click reads as a map that was
   * removed. Below 1100px the column cannot fit, drag has nowhere to land, and
   * the finder overlays the board instead.
   *
   * Only a change of bucket moves it. Setting it on every resize event would
   * reopen a finder the student had just closed, or shut one they had just
   * opened, every time the window moved a pixel.
   */
  useEffect(() => {
    const bucketOf = (w: number) => (w >= 1280 ? 'wide' : w >= 1100 ? 'medium' : 'narrow');
    const measure = () => {
      const bucket = bucketOf(window.innerWidth);
      setDragUsable(bucket !== 'narrow');
      setNarrow(window.innerWidth < 900);
      if (bucket === lastBucket.current) return;
      lastBucket.current = bucket;
      // 'medium' is 1100 to 1280, which is a 13 inch laptop, and leaving the
      // finder shut there meant the map was not on the page at all on a very
      // common screen. Drag from the map is the feature; it opens by default
      // anywhere it can actually be used.
      if (bucket === 'wide' || bucket === 'medium') setFinderOpen(true);
      // An overlay on top of the board is not somewhere to leave a panel the
      // student did not ask for.
      if (bucket === 'narrow') setFinderOpen(false);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ---- catalog -------------------------------------------------------------

  const catalog: Course[] = useMemo(
    () => (isIllinois ? (core?.index ?? []) : sampleCourses),
    [isIllinois, core],
  );
  const courseIndex = useMemo(() => indexCourses(catalog), [catalog]);
  const byCode = useMemo(() => {
    const map = new Map<string, Course>();
    for (const course of catalog) map.set(normCode(course.code), course);
    return map;
  }, [catalog]);

  const programOptions = useMemo(() => {
    if (!isIllinois) return samplePrograms.map((p) => ({ id: p.id, name: `${p.name}, ${p.degree}` }));
    return (core?.programs ?? [])
      .filter(plannableProgram)
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [isIllinois, core]);

  // ---- restore -------------------------------------------------------------

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      if (parsed.schemaVersion !== 3 || !isPlanState(parsed.plan)) return;
      if (parsed.schoolId !== (school?.id ?? '')) return;
      restored.current = parsed as Stored;
      /**
       * Set here and not derived, because localStorage cannot be read while
       * rendering: the server renders without it and the first client render
       * has to match. This runs once per school and seeds three fields the
       * student then owns, so the cascade the compiler warns about is one
       * extra render on arrival and never again.
       */
      // oxlint-disable-next-line react/react-compiler
      setProgramId(parsed.programId ?? null);
      setMinimumTermCredits(parsed.minimumTermCredits ?? 12);
      if (parsed.careerInterests) setCareerInterests(parsed.careerInterests);
    } catch {
      /* a corrupt entry is not worth failing the app over; a fresh plan follows */
    }
  }, [school]);

  // ---- pick a degree -------------------------------------------------------

  useEffect(() => {
    if (!isIllinois || !core || programId) return;
    const plannable = (core.programs ?? []).filter(plannableProgram);
    const guess = guessProgram(answers?.studying ?? '', plannable);
    if (guess) {
      /**
       * A guess, not a derivation. The student can change it in the rail and
       * that choice has to survive, so this writes the degree once when the
       * catalog lands and never overrules them afterwards.
       */
      // oxlint-disable-next-line react/react-compiler
      setProgramId(guess.id);
      setStatus(`Planning ${guess.name}`);
    }
  }, [isIllinois, core, programId, answers]);

  useEffect(() => {
    if (!isIllinois || !core || !programId) return;
    const summary = (core.programs ?? []).find((p) => p.id === programId);
    if (!summary) return;
    let cancelled = false;
    void loadProgram(core, summary).then((result) => {
      if (cancelled) return;
      // Recorded even when the page could not be read, so the board stops
      // saying "Reading the degree page" about a page that is not coming.
      setFetched({ id: programId, value: result });
    });
    return () => {
      cancelled = true;
    };
  }, [isIllinois, core, programId]);

  const loaded = fetched?.id === programId ? fetched.value : null;
  const programBusy = Boolean(isIllinois && programId) && fetched?.id !== programId;

  // ---- the planning context -------------------------------------------------

  const context: PlanningContext | null = useMemo(() => {
    if (!isIllinois || !core) return null;
    return buildContext(core, loaded?.blocks ?? [], null).context;
  }, [isIllinois, core, loaded]);

  // ---- the plan -------------------------------------------------------------

  const buildPlan = useCallback(() => {
    if (!isIllinois) {
      const sample = createSamplePlan();
      setPlan(sample);
      setPlanNotes([]);
      setReport(null);
      setTargetTermId(sample.terms[0]?.id ?? '');
      // The demo plan names its own program. Without this the rail reads
      // "No degree chosen" above a board full of that degree's courses.
      setProgramId((current) => current ?? sample.programId);
      return;
    }
    if (!core || !context || !loaded) return;

    const prior = readPriorCredit(
      answers?.transferText ?? '',
      answers?.exams.length ?? 0,
      byCode,
      // The exams the student reported, priced against the registrar's own
      // table and handed to the scheduler as courses already earned. Without
      // this the picker was decoration: a student could name four AP passes and
      // still be planned as though they were starting from nothing.
      examCourses(answers?.exams ?? [], examCredit.entries),
    );
    const term = core.meta?.term;
    const horizon = readHorizon(answers?.timeline ?? '', {
      season: 'Fall',
      year: term?.year ?? new Date().getFullYear(),
    });

    const generated = generatePlan({
      requirements: loaded.blocks,
      context,
      prior,
      horizon,
      preferences: { creditsPerTerm: { min: minimumTermCredits, target: 15, max: 18 } },
      programId: loaded.summary.id,
    });

    setPlan(generated.plan);
    setTargetTermId(generated.plan.terms[0]?.id ?? '');
    setPlanNotes(generated.notes);
    /**
     * Only the parts of the report a board edit cannot change are kept. The
     * pool counts and the pool shortfalls are derived from the board below, so
     * that moving a course moves the numbers about it.
     */
    setReport({
      pools: generated.pools,
      unsatisfied: generated.unsatisfied,
      notPlaced: generated.notPlaced,
      firstTermId: generated.plan.terms[0]?.id ?? '',
    });
    setUndoStack([]);
    setStatus(
      generated.unsatisfied.length || generated.notPlaced.length
        ? 'Plan built. Open the review list to see what it could not do.'
        : 'Plan built. Nothing to review.',
    );
  }, [isIllinois, core, context, loaded, answers, byCode, minimumTermCredits, examCredit]);

  useEffect(() => {
    if (plan) return;
    // A saved board wins over a fresh generation, but only for this school.
    if (restored.current) {
      const saved = restored.current;
      restored.current = null;
      setPlan(saved.plan);
      setTargetTermId(saved.plan.terms[0]?.id ?? '');
      setStatus('Your saved plan, restored from this device.');
      return;
    }
    if (!isIllinois || (core && context && loaded)) buildPlan();
  }, [plan, isIllinois, core, context, loaded, buildPlan]);

  // ---- derived --------------------------------------------------------------

  const plannedCourseIds = useMemo(
    () => (plan ? getPlannedCourseIds(plan) : new Set<string>()),
    [plan],
  );

  const completedCodes = useMemo(() => {
    const out = new Set<string>();
    if (!plan) return out;
    for (const id of plan.completedCourseIds) {
      const course = courseIndex.get(id);
      if (course) out.add(normCode(course.code));
    }
    return out;
  }, [plan, courseIndex]);

  /** Every course code on the board, in term order. */
  const boardCodes = useMemo(() => {
    if (!plan) return [];
    return plan.terms
      .flatMap((term) => term.courseIds)
      .map((id) => courseIndex.get(id)?.code)
      .filter((code): code is string => Boolean(code))
      .map(normCode);
  }, [plan, courseIndex]);

  /**
   * The pools, counted off the board rather than off the generation.
   *
   * This is what makes the panel move. Adding a course to a pool's list used to
   * leave the panel reading the old count, and the same stale array decided
   * which cards on the board wore a "from a list" chip.
   */
  const pools = useMemo(() => {
    if (!report || !context) return [];
    return livePools({
      base: report.pools,
      blocks: loaded?.blocks ?? [],
      boardCodes,
      priorCodes: [...completedCodes],
      context,
    });
  }, [report, context, loaded, boardCodes, completedCodes]);

  /**
   * The review list, rebuilt whenever the board moves.
   *
   * A pool's own rows are regenerated from the live counts. Everything else is
   * a statement about what the scheduler could not do at generation time, which
   * no board edit can answer, so those are carried through as written.
   *
   * Courses that did not fit are grouped by reason rather than listed one per
   * row. Thirty-seven rows reading "CS 4xx did not fit" is one fact printed
   * thirty-seven times, and it buries the two prerequisite conflicts that are
   * the rows a student has to act on.
   */
  const unmet: PlanIssue[] = useMemo(() => {
    if (!report) return [];
    const poolIds = new Set(report.pools.map((p) => p.requirementId));
    const firstTerm = report.firstTermId;
    const byReason = new Map<string, NotPlaced[]>();
    for (const row of report.notPlaced) {
      const list = byReason.get(row.reason);
      if (list) list.push(row);
      else byReason.set(row.reason, [row]);
    }
    return [
      ...[
        ...report.unsatisfied.filter((u) => !poolIds.has(u.requirementId)),
        ...poolShortfalls(pools),
      ].map((u) => ({
        // The reason is part of the id because one requirement can be reported
        // twice: once for having no candidate courses and once for not fitting.
        id: `unmet-${u.requirementId}-${u.reason}`,
        severity: 'error' as const,
        // An area-wide requirement carries the area's own name as its label, so
        // the pair would read "Technical Electives: Technical Electives".
        title: u.label && u.label !== u.areaLabel ? `${u.areaLabel}: ${u.label}` : u.areaLabel,
        message: u.message,
        termId: firstTerm,
      })),
      ...[...byReason.entries()].map(([reason, rows]) => ({
        id: `notplaced-${reason}`,
        severity: 'warning' as const,
        title: `${rows.length} ${plural(rows.length, 'course')} left out: ${NOT_PLACED_WORD[reason] ?? reason}`,
        message: `${rows.slice(0, 8).map((r) => r.code).join(', ')}${
          rows.length > 8 ? ` and ${rows.length - 8} more` : ''
        }. ${rows[0].message}`,
        termId: firstTerm,
      })),
    ];
  }, [report, pools]);

  const issues = useMemo(() => {
    if (!plan) return [];
    const rows =
      isIllinois && context
        ? [...unmet, ...validatePlan(plan, context, { minimumTermCredits })]
        : getPlanIssues(plan, catalog, { minimumTermCredits });
    return rows.map((issue) => ({ ...issue, message: withCourseCodes(issue.message) }));
  }, [plan, isIllinois, context, unmet, minimumTermCredits, catalog]);

  /** The degree on screen, from whichever source this school has. */
  const activeProgramName =
    loaded?.program.name ?? programOptions.find((p) => p.id === programId)?.name ?? null;
  const activeProgramTotal =
    loaded?.program.totalCredits ??
    samplePrograms.find((p) => p.id === programId)?.totalCredits ??
    null;

  /** Credits for one term, as a range whenever anything in it is variable. */
  const termCredits = useCallback(
    (courseIds: string[]): { label: string; heavy: boolean } => {
      if (isIllinois && context) {
        const codes = courseIds
          .map((id) => courseIndex.get(id)?.code)
          .filter((c): c is string => Boolean(c));
        const total = planCreditRange(codes, context);
        return {
          label: describeCreditTotal(total).replace(/ credits?$/, ' cr'),
          heavy: total.min > 18,
        };
      }
      const credits = getTermCredits(courseIds, courseIndex);
      return { label: `${credits} cr`, heavy: credits > 18 };
    },
    [isIllinois, context, courseIndex],
  );

  /**
   * Everything that counts toward the degree: the board plus what the student
   * walked in with.
   *
   * The board alone was the headline before, and for a transfer student that is
   * a number the app's own data says is wrong. Somebody with five courses
   * already earned saw "68 to 71 cr of 128" three lines above "Already taken 5
   * courses", with those same five counted in the requirement bars. Eighteen
   * hours were missing from the one number a student reads.
   *
   * Counted here rather than taken from the generated plan so that marking a
   * course as already taken, or dragging one off the board, moves it.
   */
  const credits = useMemo((): GeneratedPlan['credits'] => {
    const empty: CreditTotal = { min: 0, max: 0, variable: false, unknown: 0 };
    const shell = { degreeTotal: activeProgramTotal, unaccounted: null };
    if (!plan || !context) return { planned: empty, prior: 0, total: empty, ...shell };
    const planned = planCreditRange(boardCodes, context);
    // Illinois credit for work done elsewhere is only ever counted through a
    // course code the catalog lists, so hours the student holds are the hours
    // of the courses they marked. Nothing is assumed from an unmatched line.
    const prior = planCreditRange([...completedCodes], context).min;
    return {
      planned,
      prior,
      total: {
        min: planned.min + prior,
        max: planned.max + prior,
        variable: planned.variable,
        unknown: planned.unknown,
      },
      ...shell,
    };
  }, [plan, context, boardCodes, completedCodes, activeProgramTotal]);

  /** The short form, for the board bar and the rail's big number. */
  const totalCredits = useMemo(() => {
    if (!plan) return '0 cr';
    if (isIllinois && context) {
      return describeCreditTotal(credits.total).replace(/ credits?$/, ' cr');
    }
    return `${getPlanCredits(plan, catalog).total} cr`;
  }, [plan, isIllinois, context, credits, catalog]);

  /**
   * The long form, shown only when the two halves differ.
   *
   * describeCreditProgress writes the sentence; a student with no prior credit
   * gets nothing extra, because "88 of 128, 0 of those you already have" is
   * noise.
   */
  const creditNote =
    isIllinois && context && credits.prior > 0
      ? describeCreditProgress(credits, activeProgramTotal)
      : null;

  const areas: AreaRow[] = useMemo(() => {
    if (!loaded || !plan) return [];
    const have = new Set<string>(completedCodes);
    for (const term of plan.terms) {
      for (const id of term.courseIds) {
        const course = courseIndex.get(id);
        if (course) have.add(normCode(course.code));
      }
    }
    return areaProgress(loaded.program, have);
  }, [loaded, plan, completedCodes, courseIndex]);

  /**
   * Which pool each planned course is filling, and what that pool still wants.
   *
   * Counted off the pool report rather than off Course.pathwayRole, because
   * pathwayRole only says "choice" and a student looking at CS 483 in their
   * spring needs to know it is one of six technical electives and that eighteen
   * hours were asked for.
   */
  const electiveOf = useMemo(() => {
    const map = new Map<string, { label: string; detail: string }>();
    for (const pool of pools) {
      // Written with the number each half carries. Hardcoding "courses" made
      // every one-course list read "1 courses from this list", and 63 pools
      // across 36 Illinois degrees ask for exactly one.
      const wanted = [
        pool.hoursTarget !== null ? `${pool.hoursTarget} ${plural(pool.hoursTarget, 'hour')}` : null,
        pool.countTarget !== null ? `${pool.countTarget} ${plural(pool.countTarget, 'course')}` : null,
      ].filter(Boolean).join(' and ');
      const detail = wanted
        ? `${wanted} from this list, ${pool.count} chosen.`
        : `${pool.count} chosen from this list. The catalog does not say how many to take.`;
      for (const code of pool.picked) {
        const course = byCode.get(normCode(code));
        if (course) map.set(course.id, { label: pool.label, detail });
      }
    }
    return map;
  }, [pools, byCode]);

  /**
   * What the map paints, in priority order, capped at 240.
   *
   * The old slice took every Nth course out of the catalog and labelled the
   * result "881 courses", which reads as the whole catalog and is not. A map a
   * student can act on shows what their own degree and their own search point
   * at, and the count below it says how many of how many.
   */
  /** Whether the query matches anything at all, so the panel can say when it does not. */
  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    let n = 0;
    for (const c of catalog) if (`${c.code} ${c.title}`.toLowerCase().includes(q)) n += 1;
    return n;
  }, [catalog, searchQuery]);

  const mapCourses = useMemo(() => {
    const picked = new Map<string, Course>();
    const take = (c?: Course) => {
      if (c && !picked.has(c.id)) picked.set(c.id, c);
    };
    plannedCourseIds.forEach((id) => take(courseIndex.get(id)));

    // What the student searched for goes on before the degree fill, not after.
    // The degree lists alone exhaust MAP_LIMIT on Computer Science, so the
    // search loop used to break on its first iteration and 5,870 of the 6,110
    // courses could never be found at all. A search that silently returns the
    // same 240 dots is worse than no search.
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      for (const course of catalog) {
        if (picked.size >= MAP_LIMIT) break;
        if (`${course.code} ${course.title}`.toLowerCase().includes(query)) take(course);
      }
    }

    if (loaded) {
      const wanted = new Set(loaded.blocks.map((b) => b.areaId));
      for (const course of catalog) {
        if (picked.size >= MAP_LIMIT) break;
        if (course.requirementIds.some((id) => wanted.has(id))) take(course);
      }
    }
    for (const course of catalog) {
      if (picked.size >= MAP_LIMIT) break;
      take(course);
    }
    return [...picked.values()];
  }, [catalog, courseIndex, loaded, plannedCourseIds, searchQuery]);

  const selectedCourse = selectedCourseId ? courseIndex.get(selectedCourseId) : undefined;

  // ---- plan edits -----------------------------------------------------------

  function commit(next: PlanState) {
    if (!plan) return;
    setUndoStack((current) => [...current.slice(-19), plan]);
    setPlan(next);
  }

  function addCourse(courseId: string, termId: string) {
    if (!plan) return;
    const course = courseIndex.get(courseId);
    if (!course) return;
    if (plannedCourseIds.has(courseId) || plan.completedCourseIds.includes(courseId)) {
      setStatus(`${course.code} is already in the plan.`);
      return;
    }
    commit(
      termId === 'completed'
        ? { ...plan, completedCourseIds: [...plan.completedCourseIds, courseId] }
        : {
            ...plan,
            terms: plan.terms.map((term) =>
              term.id === termId ? { ...term, courseIds: [...term.courseIds, courseId] } : term,
            ),
          },
    );
    setSelectedCourseId(courseId);
    setFocusTermId(termId === 'completed' ? null : termId);
    setStatus(
      termId === 'completed'
        ? `${course.code} marked as already taken.`
        : `${course.code} added to ${plan.terms.find((t) => t.id === termId)?.label ?? 'the plan'}.`,
    );
  }

  function removeCourse(courseId: string, termId: string) {
    if (!plan) return;
    const course = courseIndex.get(courseId);
    commit({
      ...plan,
      terms: plan.terms.map((term) =>
        term.id === termId
          ? { ...term, courseIds: term.courseIds.filter((id) => id !== courseId) }
          : term,
      ),
    });
    if (selectedCourseId === courseId) setSelectedCourseId(null);
    setStatus(`${course?.code ?? 'Course'} removed.`);
  }

  function moveCourse(courseId: string, fromTermId: string, toTermId: string) {
    if (!plan || fromTermId === toTermId) return;
    const destination = plan.terms.find((t) => t.id === toTermId);
    if (!destination) return;
    const course = courseIndex.get(courseId);
    commit({
      ...plan,
      terms: plan.terms.map((term) => {
        if (term.id === fromTermId) {
          return { ...term, courseIds: term.courseIds.filter((id) => id !== courseId) };
        }
        if (term.id === toTermId) {
          return { ...term, courseIds: [...term.courseIds, courseId] };
        }
        return term;
      }),
    });
    setSelectedCourseId(courseId);
    setFocusTermId(toTermId);
    setStatus(`${course?.code ?? 'Course'} moved to ${destination.label}.`);
  }

  function selectPlanned(courseId: string, termId: string) {
    setSelectedCourseId(courseId);
    setFocusTermId(termId);
    setTargetTermId(termId);
    setFinderOpen(true);
  }

  function openFinderFor(termId: string) {
    setTargetTermId(termId);
    setFocusTermId(termId);
    setSelectedCourseId(null);
    setFinderOpen(true);
  }

  function selectIssue(issue: PlanIssue) {
    if (issue.courseId) setSelectedCourseId(issue.courseId);
    setFocusTermId(issue.termId);
    document
      .getElementById(issue.courseId ? `planned-${issue.termId}-${issue.courseId}` : `term-${issue.termId}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setPlan(previous);
    setUndoStack((current) => current.slice(0, -1));
    setStatus('Last change undone.');
  }

  function save() {
    if (!plan) return;
    const stored: Stored = {
      schemaVersion: 3,
      schoolId: school?.id ?? '',
      programId,
      plan,
      minimumTermCredits,
      careerInterests,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    setStatus('Saved on this device.');
  }

  function exportPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify({ school: school?.id, programId, plan }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${school?.id ?? 'plan'}-plan.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importPlan() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as { plan?: unknown; programId?: unknown };
        if (isPlanState(parsed.plan)) {
          setPlan(parsed.plan);
          setStatus('Plan loaded from the file.');
        }
        if (typeof parsed.programId === 'string') setProgramId(parsed.programId);
      } catch {
        setStatus('That file could not be read as a plan.');
      }
    };
    input.click();
  }

  async function sharePlan() {
    if (!plan) return;
    const encoded = btoa(encodeURIComponent(JSON.stringify({ programId, plan })));
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}#plan=${encoded}`,
      );
      setStatus('Link copied.');
    } catch {
      setStatus('The clipboard is blocked. Use Download instead.');
    }
  }

  function startOver() {
    clearAnswers();
    window.localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }

  // ---- the ask router's context ---------------------------------------------

  /**
   * Built on demand, because it needs the full adapter over the raw crawl files
   * and that costs about three seconds. Starting it on load would make every
   * student wait for a question most of them will never ask.
   */
  const askContext = useCallback(async (): Promise<AskContext | null> => {
    if (!isIllinois || !plan) return null;
    const full = await loadFullIllinois();
    if (!full) return null;

    const planned: PlannedCourse[] = [];
    plan.terms.forEach((term, index) => {
      for (const id of term.courseIds) {
        const course = courseIndex.get(id);
        if (!course) continue;
        planned.push({
          code: normCode(course.code),
          title: course.title,
          credits: course.credits,
          termId: term.id,
          termLabel: term.label,
          season: term.season,
          // PlanTerm.year is the year of STUDY (1, 2, 3...), but PlannedCourse.year
          // is documented as the calendar year and the ask router compares it to
          // what the student typed. Passing the study year straight through made
          // every question naming a year answer "Your board has no Fall 2026. It
          // runs Fall 2026 through Fall 2029", one sentence denying and confirming
          // the same term. The calendar year is in the id and the label; the id
          // wins because it is not localised.
          year: calendarYearOf(term),
          index,
        });
      }
    });

    return {
      schoolId: 'illinois',
      data: full.data,
      sectionRows: sectionRowsFrom(full.sections),
      planned,
      completedCodes,
      selectedCode: selectedCourse ? normCode(selectedCourse.code) : null,
      focusTermId,
      program: loaded?.program ?? null,
      programUrl: loaded?.url ?? null,
    };
  }, [isIllinois, plan, courseIndex, completedCodes, selectedCourse, focusTermId, loaded]);

  // ---- render ---------------------------------------------------------------

  if (isIllinois && status === 'loading') {
    return (
      <main className="planner-loading">
        <div>
          <h1>Reading the Illinois catalog</h1>
          <p>Courses, requirements, prerequisites, grade history and Fall 2026 sections.</p>
        </div>
      </main>
    );
  }

  if (isIllinois && status === 'unavailable') {
    return (
      <main className="planner-loading">
        <div>
          <h1>Illinois data is not loaded</h1>
          <p>
            The build step has not run, or its output is not deployed. Run npm run
            build:illinois and reload. Nothing here will guess at a course list.
          </p>
        </div>
      </main>
    );
  }

  if (isIllinois && !programId) {
    return (
      <main className="planner-loading">
        <div>
          <h1>Which degree are you planning?</h1>
          <p>
            Your answers did not point clearly at one of the {programOptions.length} Illinois
            degrees with published course lists, so pick it rather than have one picked wrong.
          </p>
          <select
            className="prior-search"
            aria-label="Pick your degree"
            defaultValue=""
            onChange={(event) => setProgramId(event.target.value || null)}
          >
            <option value="">Pick a degree</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </main>
    );
  }

  const grouped = groupIssues(issues);
  const errors = grouped.filter((g) => g.severity === 'error').length;
  const warnings = grouped.filter((g) => g.severity === 'warning').length;
  const years = plan ? [...new Set(plan.terms.map((t) => t.year))] : [];

  const caveats = [
    ...(activeProgramTotal && plan ? overTotal(totalCredits, activeProgramTotal) : []),
    ...planNotes,
    ...(core?.meta?.notes ?? []).map(studentWording),
    'Prerequisites are parsed from catalog sentences. Anything about placement or consent is not checked here.',
  ];

  return (
    <main
      className="planner-app"
      data-finder={finderOpen ? 'open' : 'closed'}
      data-rail={railOpen ? 'open' : 'closed'}
    >
      <output aria-live="polite" className="sr-only">
        {status_}
      </output>

      <header className="app-header">
        <a className="brand" href="#top" aria-label="Four Year Planner home">
          <Image src="/constellation-logo.png" alt="" width={30} height={30} priority />
          <span>
            {/* The school comes from the student's own choice. Hardcoding one
                university's name over another's catalog was a false statement
                on the first line of the page. */}
            <strong>{school?.short ?? 'Four Year'} Planner</strong>
            <small>from the Semantic Course Map</small>
          </span>
        </a>
        <p className="header-coverage">{isIllinois ? coverage : 'Demo catalog'}</p>
        <div className="header-actions">
          {narrow && (
            <Button
              variant="outline"
              aria-expanded={railOpen}
              onClick={() => setRailOpen((open) => !open)}
            >
              Progress
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            title="Undo the last change"
            aria-label="Undo the last change"
            disabled={undoStack.length === 0}
            onClick={undo}
          >
            <Undo2 />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              Plan <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={save}>
                <Save /> Save on this device
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportPlan}>Download as JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={importPlan}>Load from a file</DropdownMenuItem>
              <DropdownMenuItem onClick={sharePlan}>Copy a link</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <StudentProfilePanel
        schoolName={school?.name ?? 'Your university'}
        schoolShort={school?.short ?? 'Your school'}
        portal={school?.portal ?? 'your student portal'}
        programName={activeProgramName}
        programUrl={loaded?.url ?? null}
        digest={answers ? summarize(answers) : ''}
        onStartOver={startOver}
        plannedCredits={totalCredits}
        creditNote={creditNote}
        degreeTotal={activeProgramTotal}
        priorCount={plan?.completedCourseIds.length ?? 0}
        areas={areas}
        programs={programOptions}
        programId={programId}
        onProgramChange={(id) => {
          setProgramId(id || null);
          // The board is rebuilt for the new degree; `loaded` follows the id
          // on its own, so there is nothing else to clear here.
          setPlan(null);
        }}
        minimumTermCredits={minimumTermCredits}
        onMinimumChange={setMinimumTermCredits}
        careerInterests={careerInterests}
        onCareerChange={setCareerInterests}
        caveats={caveats}
        pools={
          <ElectivePools
            pools={pools}
            byCode={byCode}
            plannedCourseIds={plannedCourseIds}
            targetTermId={targetTermId}
            targetLabel={
              plan?.terms.find((t) => t.id === targetTermId)?.label ?? 'a term'
            }
            dragUsable={dragUsable}
            onAddCourse={addCourse}
            onSelectCourse={(courseId) => {
              setSelectedCourseId(courseId);
              setFinderOpen(true);
            }}
          />
        }
      />

      <section className="board-region" aria-label="Your semesters">
        <div className="board-bar">
          <div className="board-bar-facts">
            <strong>{activeProgramName ?? 'Your plan'}</strong>
            <span>{totalCredits}</span>
            {plan && plan.terms.length > 0 && (
              <span>through {plan.terms[plan.terms.length - 1].label}</span>
            )}
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`Review ${grouped.length} thing${grouped.length === 1 ? '' : 's'} in this plan`}
                  className={`review-chip${errors ? ' has-error' : warnings ? ' has-warning' : ''}`}
                />
              }
            >
              {grouped.length === 0 ? (
                <>
                  <CheckCircle2 /> Nothing to review
                </>
              ) : errors ? (
                <>
                  <AlertCircle /> {grouped.length} to review
                </>
              ) : (
                <>
                  <AlertTriangle /> {grouped.length} to review
                </>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <PlanHealthList groups={grouped} onSelectIssue={selectIssue} />
            </PopoverContent>
          </Popover>

          <Button variant="outline" onClick={buildPlan} disabled={programBusy}>
            <Sparkles /> Rebuild
          </Button>
        </div>

        {plan && plan.terms.length > 0 && (
          /* The ruler is outside the board's scroller, so its offset is copied
             from the board on every scroll. Without that the labels stay put
             while the columns move and the ruler names the wrong year. */
          <div className="year-ruler" aria-hidden="true" ref={rulerRef}>
            <div className="year-ruler-track">
              {years.map((year) => {
                const count = plan.terms.filter((t) => t.year === year).length;
                return (
                  /* Measured in the same two tokens the board's columns use, so
                     that a breakpoint which narrows a column moves the year
                     label with it. Hard-coding 260 and 12 here put the ruler
                     over the wrong columns on any screen where they changed,
                     which is a year label naming a semester it is not above. */
                  <span
                    key={year}
                    style={{
                      width: `calc(${count} * var(--col-w) + ${count - 1} * var(--col-gap))`,
                    }}
                  >
                    {year}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div
          className="plan-board"
          aria-label="Four year course plan"
          onScroll={(event) => {
            if (rulerRef.current) rulerRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
        >
          {!plan && (
            <p className="board-empty">
              {programBusy ? 'Reading the degree page.' : 'Building your plan.'}
            </p>
          )}
          {plan?.terms.map((term) => {
            const credits = termCredits(term.courseIds);
            return (
              <SemesterColumn
                key={term.id}
                term={term}
                allTerms={plan.terms}
                courseIndex={courseIndex}
                issues={issues}
                selectedCourseId={selectedCourseId}
                credits={credits.label}
                heavy={credits.heavy}
                onSelectCourse={selectPlanned}
                onMoveCourse={moveCourse}
                onRemoveCourse={removeCourse}
                onAddCourse={openFinderFor}
                onDropCourse={addCourse}
                onFindAlternatives={selectPlanned}
                electiveOf={electiveOf}
              />
            );
          })}
        </div>
      </section>

      <CourseExplorer
        searchHits={searchHits}
        courses={mapCourses}
        catalogSize={catalog.length}
        core={core}
        terms={plan?.terms ?? []}
        plannedCourseIds={plannedCourseIds}
        completedCodes={completedCodes}
        selectedCourseId={selectedCourseId}
        targetTermId={targetTermId}
        searchQuery={searchQuery}
        open={finderOpen}
        dragUsable={dragUsable}
        onOpenChange={setFinderOpen}
        onSearchChange={setSearchQuery}
        onTargetTermChange={setTargetTermId}
        onSelectCourse={setSelectedCourseId}
        onAddCourse={addCourse}
      />

      <AskBar school={school} buildContext={askContext} />
    </main>
  );
}

/**
 * A plan longer than the degree, said out loud.
 *
 * The Computer Science page splits technical electives into eight focus-area
 * tables and the rule is "at least three from one of them", not "one from each".
 * The parser cannot see that, so the scheduler fills all eight and the plan runs
 * over the published total. Saying nothing would show a student twenty-seven
 * hours they do not have to take.
 */
/**
 * The internal id of a course, turned back into the code on the timetable.
 *
 * A course the plan holds and the catalog no longer lists is reported as
 * "illinois-cs-124 is in the plan but not in the current catalog snapshot",
 * which names a key out of this app's own storage. The id is only ever the
 * code with its punctuation flattened, so the code is recoverable, and this
 * rewrites only the exact shape it produces: two to five letters, a hyphen,
 * three digits. Anything else is left alone rather than guessed at.
 */
function withCourseCodes(message: string): string {
  return message.replace(/\b([a-z]{2,5})-(\d{3})\b/g, (_, subject: string, number: string) =>
    `${subject.toUpperCase()} ${number}`,
  );
}

/**
 * A build note, said to a student instead of to whoever ran the build.
 *
 * meta.json's notes are written by the indexer for the person watching it run,
 * and they went straight into the "What is estimated?" panel. A student opened
 * it and read "4310 of 13276 program course rows have no credits.", which names
 * a data structure nobody outside this repository has heard of. The facts are
 * right and worth showing, so they are re-worded here rather than dropped, and
 * every number is carried through unchanged.
 *
 * The set of notes build-index.mjs can emit is closed and short, so each one
 * gets a line. An unrecognised note is still shown as written: a caveat the
 * student never sees would be a worse failure than one worded for a developer,
 * and the fix for that case is another line here.
 */
function studentWording(note: string): string {
  const rows = note.match(/^(\d+) of (\d+) program course rows have no credits\.$/);
  if (rows) {
    return `Illinois degree pages leave the credit hours blank on ${Number(rows[1]).toLocaleString()} of the ${Number(rows[2]).toLocaleString()} course lines they print, so a total built from them can come out low.`;
  }
  const positions = note.match(/^(\d+) indexed courses have no map position\.$/);
  if (positions) {
    return `${Number(positions[1]).toLocaleString()} courses are missing from the map. They are still in the plan and in search.`;
  }
  if (note === 'No program course row carries credits in this crawl, so requirement hours cannot be summed.') {
    return 'No course on the degree pages has credit hours printed in this copy of the catalog, so no requirement can be added up.';
  }
  if (note === 'No program course row carries a title in this crawl, only codes.') {
    return 'The degree pages in this copy of the catalog list course codes with no names.';
  }
  if (note === 'No section data in this build. No building, day, time or part of term can be shown.') {
    return 'No class schedule was loaded, so no meeting day, time, room or part of term is shown.';
  }
  if (note === 'No map data in this build. The constellation has no positions.') {
    return 'The map has no course positions in this copy of the data.';
  }
  const subjects = note.match(/^Skipped (\d+) subject shards whose prefix is not a safe filename\.$/);
  if (subjects) {
    return `${subjects[1]} subjects are missing from this copy of the catalog, so their courses have no page here.`;
  }
  const programs = note.match(/^Skipped (\d+) program files whose id is not a safe path\.$/);
  if (programs) {
    return `${programs[1]} degrees are missing from this copy of the catalog and cannot be planned here.`;
  }
  const file = note.match(/^illinois-([a-z]+)\.json is (.+)\.$/);
  if (file) {
    const what: Record<string, string> = {
      catalog: 'course catalog',
      programs: 'degree pages',
      sections: 'class schedule',
      grades: 'grade history',
      map: 'course map',
    };
    return `The ${what[file[1]] ?? file[1]} did not load, so nothing here can show it.`;
  }
  return note;
}

function overTotal(planned: string, degreeTotal: number): string[] {
  const low = Number(planned.split(' ')[0]);
  if (!Number.isFinite(low) || low <= degreeTotal) return [];
  return [
    `This plan is ${planned}, over the ${degreeTotal} hours the degree page lists. Where a requirement offers a choice between lists, this plan filled every list rather than guess which one you want.`,
  ];
}
