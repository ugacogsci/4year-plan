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
  Info,
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
import { BotLauncher, BotPanel } from './advisor';
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
  guessUgaProgram,
  loadUgaProgram,
  useUgaData,
  type UgaLoadedProgram,
} from './uga-source';
import {
  electiveOptions,
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
import { examCourses, examElectiveHours, useExamCredit } from './exam-credit';
import { areaProgress } from '@/lib/planner/scheduler';
import { routeQuestion, sectionRowsFrom, type AskContext, type PlannedCourse } from '@/lib/planner/ask-router';
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
import { normalizeCourseCode, transcriptCodes } from '@/lib/planner/transcript';
import { subjectMatches, subjectName } from '@/lib/planner/illinois-subjects';
import { TranscriptUpload } from './transcript-upload';
import { loadIllinoisCourseDetail } from '@/lib/planner/illinois-load';
import type { AdvisorExecutor } from '@/lib/planner/advisor';

const STORAGE_KEY = 'four-year-planner-v3';

/**
 * Whether a course answers a search: by code, by title, or by the name of its
 * department, so "accounting" finds ACCY and not only the titles that spell it.
 */
function matchesQuery(course: Course, q: string): boolean {
  return (
    course.code.toLowerCase().includes(q) ||
    course.title.toLowerCase().includes(q) ||
    subjectMatches(course.cluster, q)
  );
}

/** Forget the board saved on this device. Onboarding calls it, so a new setup builds a new plan. */
export function clearSavedPlan(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to forget */
  }
}

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
/**
 * How loudly each kind of shortfall is said.
 *
 * Every unsatisfied requirement used to be an error, so a student saw thirteen
 * red rows where two needed a decision and the rest were the page's own words
 * and the hours the elective slots had already filled. The catalog's quoted
 * sentence and a filled hours block are notes; a course the credit rule shut
 * out is a warning; a list the plan could not fill is the error it always was.
 */
const SEVERITY_BY_REASON: Record<string, PlanIssue['severity']> = {
  'not-parsed': 'info',
  'filled-by-electives': 'info',
  'no-course-data': 'warning',
  excluded: 'warning',
  'constraint-unmet': 'warning',
  'no-candidates': 'error',
  'hours-short': 'error',
  'did-not-fit': 'error',
};

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
  /** Held credit a required course displaced. Out of the headline, and in the review list. */
  forfeited: Array<{ held: string; for: string }>;
  /** Courses the plan chose to reach the degree total, each with its reason. */
  electives: Array<{ code: string; why: string }>;
  firstTermId: string;
}

interface Stored {
  schemaVersion: 3;
  schoolId: string;
  programId: string | null;
  plan: PlanState;
  minimumTermCredits: number;
  /** Null, or absent on boards saved before the control existed, means balanced. */
  targetTermCredits?: number | null;
  careerInterests: string;
}

export function PlannerWorkspace({
  answers,
  onAnswersChange,
}: {
  answers?: OnboardingAnswers;
  /** The shell owns the answers. A transcript added from the rail goes back through here. */
  onAnswersChange?: (next: OnboardingAnswers) => void;
}) {
  const school = schoolById(answers?.schoolId ?? null);
  const isIllinois = school?.id === 'illinois';
  const isUga = school?.id === 'uga';
  const isCatalogSchool = isIllinois || isUga;
  const { status: illinoisStatus, core, coverage: illinoisCoverage } = useIllinoisCore(Boolean(isIllinois));
  const { status: ugaStatus, data: uga, coverage: ugaCoverage } = useUgaData(Boolean(isUga));
  const status = isIllinois ? illinoisStatus : isUga ? ugaStatus : 'unavailable';
  const coverage = isIllinois ? illinoisCoverage : isUga ? ugaCoverage : '';
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
  const [fetched, setFetched] = useState<{
    id: string;
    value: LoadedProgram | UgaLoadedProgram | null;
  } | null>(null);
  const [planNotes, setPlanNotes] = useState<string[]>([]);
  const [report, setReport] = useState<PlanReport | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [focusTermId, setFocusTermId] = useState<string | null>(null);
  const [targetTermId, setTargetTermId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [finderOpen, setFinderOpen] = useState(false);
  /** The bot's column. Opening it folds the finder, so the board keeps its room. */
  const [chatOpen, setChatOpen] = useState(false);
  const botName = school?.bot ?? 'Assistant';
  const [dragUsable, setDragUsable] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [minimumTermCredits, setMinimumTermCredits] = useState(12);
  /** The elective slot being chosen for, if any. Drives the finder's list. */
  const [chooser, setChooser] = useState<{ termId: string; courseId: string } | null>(null);
  /**
   * The board as of the last commit, for the advisor's tools.
   *
   * Two tool calls in one step run back to back, and the second has to see
   * the board the first one changed. React state has not re-rendered by then,
   * so every commit the advisor makes writes here as well, and every read of
   * the board by a tool comes from here.
   */
  const planRef = useRef<PlanState | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [targetTermCredits, setTargetTermCredits] = useState<number | null>(null);
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
    () => (isIllinois ? (core?.index ?? []) : isUga ? (uga?.courses ?? []) : sampleCourses),
    [isIllinois, isUga, core, uga],
  );
  const courseIndex = useMemo(() => indexCourses(catalog), [catalog]);
  const byCode = useMemo(() => {
    const map = new Map<string, Course>();
    for (const course of catalog) map.set(normCode(course.code), course);
    return map;
  }, [catalog]);

  const programOptions = useMemo(() => {
    if (isIllinois) {
      return (core?.programs ?? [])
        .filter(plannableProgram)
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (isUga) return (uga?.programs ?? []).map((program) => ({ id: program.id, name: program.name }));
    return samplePrograms.map((p) => ({ id: p.id, name: `${p.name}, ${p.degree}` }));
  }, [isIllinois, isUga, core, uga]);

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
      setTargetTermCredits(parsed.targetTermCredits ?? null);
      if (parsed.careerInterests) setCareerInterests(parsed.careerInterests);
    } catch {
      /* a corrupt entry is not worth failing the app over; a fresh plan follows */
    }
  }, [school]);

  // ---- pick a degree -------------------------------------------------------

  useEffect(() => {
    if (programId) return;
    const guess = isIllinois && core
      ? guessProgram(answers?.studying ?? '', (core.programs ?? []).filter(plannableProgram))
      : isUga && uga
        ? guessUgaProgram(answers?.studying ?? '', uga.programs)
        : null;
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
  }, [isIllinois, isUga, core, uga, programId, answers]);

  useEffect(() => {
    if (!programId) return;
    if (isUga && uga) {
      const program = uga.programs.find((candidate) => candidate.id === programId);
      if (program) {
        // The UGA degree file is already in memory, so there is no asynchronous
        // page fetch to subscribe to as there is for an Illinois shard.
        // oxlint-disable-next-line react/react-compiler
        setFetched({ id: programId, value: loadUgaProgram(uga, program) });
      }
      return;
    }
    if (!isIllinois || !core) return;
    const summary = (core.programs ?? []).find((candidate) => candidate.id === programId);
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
  }, [isIllinois, isUga, core, uga, programId]);

  const loaded = fetched?.id === programId ? fetched.value : null;
  const programBusy = Boolean(isCatalogSchool && programId) && fetched?.id !== programId;

  // ---- the planning context -------------------------------------------------

  const context: PlanningContext | null = useMemo(() => {
    if (isIllinois && core) return buildContext(core, loaded?.blocks ?? [], null).context;
    if (isUga && uga) return uga.context;
    return null;
  }, [isIllinois, isUga, core, uga, loaded]);

  // ---- the plan -------------------------------------------------------------

  const buildPlan = useCallback(() => {
    if (!isCatalogSchool) {
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
    if (!context || !loaded) return;

    const prior = readPriorCredit(
      answers?.transferText ?? '',
      answers?.exams.length ?? 0,
      byCode,
      // The exams the student reported, priced against the registrar's own
      // table and handed to the scheduler as courses already earned. Without
      // this the picker was decoration: a student could name four AP passes and
      // still be planned as though they were starting from nothing. The
      // transcript's lines ride in the same list, already matched against the
      // catalog and checked by the student when they reviewed the reading.
      [...examCourses(answers?.exams ?? [], examCredit.entries), ...transcriptCodes(answers?.transcript)],
      Boolean(answers?.transcript),
      examElectiveHours(answers?.exams ?? [], examCredit.entries),
    );
    const term = core?.meta?.term;
    const horizon = readHorizon(answers?.timeline ?? '', {
      season: 'Fall',
      year: term?.year ?? new Date().getFullYear(),
    });

    const generated = generatePlan({
      requirements: loaded.blocks,
      context,
      prior,
      horizon,
      preferences: { creditsPerTerm: { min: minimumTermCredits, target: targetTermCredits, max: 18 } },
      programId: loaded.summary.id,
      // The published total is what the plan must reach; the blocks alone
      // name 82 of Finance's 124 credits. The student's own words rank the
      // electives that fill the rest.
      degreeTotal: loaded.summary.totalCredits ?? loaded.program.totalCredits ?? null,
      interests: [answers?.studying ?? '', answers?.after ?? '', careerInterests].join(' '),
      programName: loaded.program.name,
    });

    setPlan(generated.plan);
    setChooser(null);
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
      forfeited: generated.forfeited,
      electives: generated.electives,
      firstTermId: generated.plan.terms[0]?.id ?? '',
    });
    setUndoStack([]);
    setStatus(
      generated.unsatisfied.length || generated.notPlaced.length
        ? 'Plan built. Open the review list to see what it could not do.'
        : 'Plan built. Nothing to review.',
    );
  }, [isCatalogSchool, core, context, loaded, answers, byCode, minimumTermCredits, targetTermCredits, examCredit, careerInterests]);

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
    if (!isCatalogSchool || (context && loaded)) buildPlan();
  }, [plan, isCatalogSchool, context, loaded, buildPlan]);

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
      // Held credit the plan gave up for a required course. A student who sees
      // MATH 221 booked next to the MATH 234 they marked as taken needs the
      // reason where the other reasons are, not only in the caveats.
      ...report.forfeited.map((f) => ({
        id: `ap-forfeit-${f.held}`,
        severity: 'info' as const,
        title: 'Credit that will not count',
        message: `${f.for} is required, and the catalog says credit is not given for both ${f.for} and ${f.held}. Your ${f.held} will not count toward this degree once ${f.for} is taken, so it is left out of the total.`,
        termId: firstTerm,
      })),
      ...[
        ...report.unsatisfied.filter((u) => !poolIds.has(u.requirementId)),
        ...poolShortfalls(pools),
      ].map((u) => ({
        // The reason is part of the id because one requirement can be reported
        // twice: once for having no candidate courses and once for not fitting.
        id: `unmet-${u.requirementId}-${u.reason}`,
        severity: SEVERITY_BY_REASON[u.reason] ?? ('error' as const),
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
    const validation = context
      ? validatePlan(plan, context, { minimumTermCredits }).filter(
          (issue) => !isUga || !issue.id.startsWith('ap-weighed-'),
        )
      : [];
    const rows = context
      ? [...unmet, ...validation]
      : getPlanIssues(plan, catalog, { minimumTermCredits });
    return rows.map((issue) => ({ ...issue, message: withCourseCodes(issue.message) }));
  }, [plan, context, isUga, unmet, minimumTermCredits, catalog]);

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
      if (context) {
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
    [context, courseIndex],
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
    // Hours the student holds are the hours of the courses they marked, plus
    // the exam credit the registrar grants by subject rather than by course
    // ("ECON 1--"), which is real credit with no card to sit on. Nothing is
    // assumed from a transfer line the catalog could not match.
    const forfeited = new Set((report?.forfeited ?? []).map((f) => normCode(f.held)));
    const prior =
      planCreditRange([...completedCodes].filter((code) => !forfeited.has(code)), context).min +
      examElectiveHours(answers?.exams ?? [], examCredit.entries);
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
  }, [plan, context, boardCodes, completedCodes, activeProgramTotal, answers, examCredit, report]);

  /** The short form, for the board bar and the rail's big number. */
  const totalCredits = useMemo(() => {
    if (!plan) return '0 cr';
    if (context) {
      return describeCreditTotal(credits.total).replace(/ credits?$/, ' cr');
    }
    return `${getPlanCredits(plan, catalog).total} cr`;
  }, [plan, context, credits, catalog]);

  /**
   * The long form, shown only when the two halves differ.
   *
   * describeCreditProgress writes the sentence; a student with no prior credit
   * gets nothing extra, because "88 of 128, 0 of those you already have" is
   * noise.
   */
  const creditNote =
    context && credits.prior > 0
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
    return areaProgress(loaded.program, have, isIllinois ? (core?.equivalents ?? undefined) : undefined);
  }, [loaded, plan, completedCodes, courseIndex, isIllinois, core]);

  /**
   * Which pool each planned course is filling, and what that pool still wants.
   *
   * Counted off the pool report rather than off Course.pathwayRole, because
   * pathwayRole only says "choice" and a student looking at CS 483 in their
   * spring needs to know it is one of six technical electives and that eighteen
   * hours were asked for.
   */
  const electiveOf = useMemo(() => {
    const map = new Map<string, { label: string; detail: string; kind?: 'pool' | 'elective' }>();
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
        if (course) map.set(course.id, { label: pool.label, detail, kind: 'pool' });
      }
    }
    // The plan's own fillers, so a student can tell a suggestion from a rule.
    for (const pick of report?.electives ?? []) {
      const course = byCode.get(normCode(pick.code));
      if (course && !map.has(course.id)) map.set(course.id, { label: 'Elective', detail: pick.why, kind: 'elective' });
    }
    return map;
  }, [pools, byCode, report]);

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
    for (const c of catalog) if (matchesQuery(c, q)) n += 1;
    return n;
  }, [catalog, searchQuery]);

  /**
   * The matches themselves, as a list the student can read.
   *
   * The map answers a search by lighting dots, and forty accountancy courses
   * light one cluster the size of a thumbnail. The list is the same matches
   * with their codes and titles, catalog-wide rather than capped at the 240 the
   * map paints. Code matches first, because a student who typed "ACCY 3" wants
   * ACCY 301 above a title that mentions accountancy.
   */
  const searchResults = useMemo((): Course[] => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const byCodeHit: Course[] = [];
    const byTitleHit: Course[] = [];
    const bySubjectHit: Course[] = [];
    for (const c of catalog) {
      if (c.code.toLowerCase().includes(q)) byCodeHit.push(c);
      else if (c.title.toLowerCase().includes(q)) byTitleHit.push(c);
      else if (subjectMatches(c.cluster, q)) bySubjectHit.push(c);
      if (byCodeHit.length + byTitleHit.length + bySubjectHit.length >= 400) break;
    }
    return [...byCodeHit, ...byTitleHit, ...bySubjectHit].slice(0, 80);
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
        if (matchesQuery(course, query)) take(course);
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

  /**
   * The slot's chooser: everything the student could take in that term, best
   * fit first, read off the board as it stands. Built only while a slot is open,
   * because it walks the whole catalog against the board's prerequisites.
   */
  const chooserOptions = useMemo((): Course[] => {
    if (!chooser || !plan || !context || !loaded) return [];
    const prior = readPriorCredit(
      answers?.transferText ?? '',
      answers?.exams.length ?? 0,
      byCode,
      [...examCourses(answers?.exams ?? [], examCredit.entries), ...transcriptCodes(answers?.transcript)],
      Boolean(answers?.transcript),
      examElectiveHours(answers?.exams ?? [], examCredit.entries),
    );
    return electiveOptions({
      context,
      requirements: loaded.blocks,
      plan,
      termId: chooser.termId,
      prior,
      interests: [answers?.studying ?? '', answers?.after ?? '', careerInterests].join(' '),
      programName: loaded.program.name,
      limit: 80,
    })
      .map((option) => byCode.get(normCode(option.code)))
      .filter((course): course is Course => Boolean(course));
  }, [chooser, plan, context, loaded, answers, byCode, examCredit, careerInterests]);

  function openChooser(courseId: string, termId: string) {
    setChooser({ termId, courseId });
    setSearchQuery('');
    setFinderOpen(true);
  }

  /** Put the course the student chose into the slot, in place of the plan's suggestion. */
  function chooseElective(termId: string, oldId: string, newId: string) {
    if (!plan) return;
    const oldCourse = courseIndex.get(oldId);
    const course = courseIndex.get(newId);
    if (!course) return;
    if (plannedCourseIds.has(newId) || plan.completedCourseIds.includes(newId)) {
      setStatus(`${course.code} is already in the plan.`);
      return;
    }
    commit({
      ...plan,
      terms: plan.terms.map((t) =>
        t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === oldId ? newId : id)) } : t,
      ),
    });
    // The slot stays an elective slot, now holding what the student chose.
    noteElectiveSwap(oldCourse?.code ?? '', course.code, 'You chose it for this elective slot.');
    setChooser(null);
    setSelectedCourseId(newId);
    setStatus(`${course.code} replaces ${oldCourse?.code ?? 'the elective'} in ${plan.terms.find((t) => t.id === termId)?.label ?? 'that term'}.`);
  }

  /** An elective slot keeps being a slot after its course is swapped. */
  function noteElectiveSwap(oldCode: string, newCode: string, why: string) {
    setReport((current) =>
      current
        ? {
            ...current,
            electives: current.electives.map((e) =>
              normCode(e.code) === normCode(oldCode) ? { code: newCode, why } : e,
            ),
          }
        : current,
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

  // ---- the advisor's hands and eyes ----------------------------------------

  /**
   * Everything a tool reads, as of the last render. A ref rather than a
   * closure so that an executor created on one render does not answer from a
   * board three edits old.
   */
  const live = useRef({
    courseIndex,
    byCode,
    context,
    loaded,
    catalog,
    electiveOf,
    issues,
    core,
    completedCodes,
    minimumTermCredits,
    targetTermCredits,
    totalCredits,
    activeProgramTotal,
  });
  useEffect(() => {
    live.current = {
      courseIndex,
      byCode,
      context,
      loaded,
      catalog,
      electiveOf,
      issues,
      core,
      completedCodes,
      minimumTermCredits,
      targetTermCredits,
      totalCredits,
      activeProgramTotal,
    };
  });

  type Role = 'required' | 'from a list' | 'elective slot' | 'added';
  function roleOf(course: Course): Role {
    const slot = live.current.electiveOf.get(course.id);
    if (slot?.kind === 'elective') return 'elective slot';
    if (slot?.kind === 'pool') return 'from a list';
    if (course.pathwayRole === 'required') return 'required';
    return 'added';
  }
  function markOf(course: Course): string {
    const role = roleOf(course);
    return role === 'from a list' ? `from a list: ${live.current.electiveOf.get(course.id)?.label ?? ''}` : role;
  }
  function creditsOf(course: Course): string {
    const max = course.creditsMax ?? course.credits;
    return max > course.credits ? `${course.credits} to ${max} cr` : `${course.credits} cr`;
  }

  /**
   * The board, written for the advisor before every step.
   *
   * Every card carries why it is there, because that is what decides what
   * the advisor may touch: an elective slot is fair game, a required course
   * needs the student's yes. The review list is summarised so a question
   * about a flag can be answered from what the flag says.
   */
  function describeBoard(): string {
    const L = live.current;
    const board = planRef.current;
    if (!board || !L.loaded) return 'No plan is on the board yet.';
    const lines: string[] = [];
    const last = board.terms[board.terms.length - 1]?.label ?? '';
    lines.push(
      `Degree: ${L.loaded.program.name}, University of Illinois. Published total: ${L.activeProgramTotal ?? 'not published'} credits. Plan: ${L.totalCredits} through ${last}.`,
    );
    lines.push(
      'Marks: [required] the degree page names it. [from a list: X] fills the list X. [elective slot] the planner picked it to reach the total; swap it freely. [added] the student put it there.',
    );
    const taken = board.completedCourseIds
      .map((id) => L.courseIndex.get(id)?.code)
      .filter((code): code is string => Boolean(code));
    lines.push(`Already taken, counted but not on the board: ${taken.length > 0 ? taken.join(', ') : 'none'}.`);
    lines.push(
      `Preferences: at least ${L.minimumTermCredits} credits a term, aim ${L.targetTermCredits ?? 'balanced'}, never above 18.`,
    );
    for (const term of board.terms) {
      const courses = term.courseIds
        .map((id) => L.courseIndex.get(id))
        .filter((c): c is Course => Boolean(c));
      const credits = L.context
        ? describeCreditTotal(planCreditRange(courses.map((c) => c.code), L.context)).replace(/ credits?$/, ' cr')
        : `${courses.reduce((n, c) => n + c.credits, 0)} cr`;
      lines.push(
        `${term.label} (${credits}): ${
          courses.length > 0
            ? courses.map((c) => `${c.code} [${markOf(c)}] ${creditsOf(c)} ${c.title}`).join('; ')
            : 'empty'
        }`,
      );
    }
    const groups = groupIssues(L.issues);
    const toReview = groups.filter((g) => g.severity !== 'info');
    const notes = groups.length - toReview.length;
    lines.push(`Review list: ${toReview.length} to review, ${notes} notes.`);
    for (const g of groups.slice(0, 10)) {
      lines.push(`- [${g.severity}] ${g.title}: ${g.message.slice(0, 160)}`);
    }
    return lines.join('\n');
  }

  /**
   * One tool, run against the real board.
   *
   * Every change goes through validatePlan and the same credit rules the
   * board applies to a drag, so the advisor cannot place a course the finder
   * would refuse. What it cannot decide is whether a required course should
   * go, and that is the `confirmed` flag the model may only set after the
   * student has said yes.
   */
  const advisorExecute: AdvisorExecutor = async (name, input) => {
    const L = live.current;
    const board = planRef.current;
    const ctx = L.context;
    if (!board || !ctx || !L.loaded) return { ok: false, error: 'The board is not loaded yet.' };
    const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string).trim() : '');
    const termList = board.terms.map((t) => t.label).join(', ');
    const termOf = (label: string) => {
      const want = label.toLowerCase().replace(/\s+/g, ' ').trim();
      return (
        board.terms.find((t) => t.label.toLowerCase() === want) ??
        board.terms.find((t) => t.label.toLowerCase().includes(want) || want.includes(t.label.toLowerCase())) ??
        null
      );
    };
    const courseOf = (raw: string) => L.byCode.get(normalizeCourseCode(raw)) ?? null;
    const holding = (courseId: string) => board.terms.find((t) => t.courseIds.includes(courseId)) ?? null;
    const describe = (c: Course) => ({
      code: c.code,
      title: c.title,
      credits: creditsOf(c),
      subject: subjectName(c.cluster),
      gen_ed: c.tags,
      difficulty_0_to_100: L.core?.grades?.get(normCode(c.code))?.difficulty ?? null,
      on_board_in: holding(c.id)?.label ?? null,
      already_taken: L.completedCodes.has(normCode(c.code)),
    });
    const withCourseIn = (base: PlanState, courseId: string, termId: string): PlanState => ({
      ...base,
      terms: base.terms.map((t) => (t.id === termId ? { ...t, courseIds: [...t.courseIds, courseId] } : t)),
    });
    const without = (base: PlanState, courseId: string): PlanState => ({
      ...base,
      terms: base.terms.map((t) => ({ ...t, courseIds: t.courseIds.filter((id) => id !== courseId) })),
    });
    /** Why a candidate board is not allowed, or what to warn about if it is. */
    const check = (candidate: PlanState, course: Course, termId: string) => {
      const found = validatePlan(candidate, ctx, { minimumTermCredits: L.minimumTermCredits, maxTermCredits: 18 });
      const mine = found.filter((i) => i.courseId === course.id && i.termId === termId);
      const blocking = mine
        .filter((i) => /^ap-(prereq-(?!check)|standing-|exclusion-|duplicate-)/.test(i.id) && i.severity !== 'info')
        .map((i) => i.message);
      for (const i of mine) if (i.id.startsWith('ap-exclusion-')) blocking.push(i.message);
      const warnings = mine.filter((i) => !blocking.includes(i.message)).map((i) => i.message);
      const term = candidate.terms.find((t) => t.id === termId);
      const codes = (term?.courseIds ?? []).map((id) => L.courseIndex.get(id)?.code).filter((c): c is string => Boolean(c));
      const credits = planCreditRange(codes, ctx);
      if (credits.min > 18) blocking.push(`${term?.label ?? 'That term'} would be ${describeCreditTotal(credits)}, over the 18 allowed.`);
      return { blocking: [...new Set(blocking)], warnings: [...new Set(warnings)], credits: describeCreditTotal(credits) };
    };
    const apply = (next: PlanState, focusTerm: string | null, select: string | null, status: string) => {
      commit(next);
      planRef.current = next;
      if (select) setSelectedCourseId(select);
      if (focusTerm) setFocusTermId(focusTerm);
      setStatus(status);
    };
    const guard = (course: Course, verb: string) => {
      const role = roleOf(course);
      if ((role === 'required' || role === 'from a list') && input.confirmed !== true) {
        const why =
          role === 'required'
            ? `${course.code} is required by this degree`
            : `${course.code} fills the list "${L.electiveOf.get(course.id)?.label ?? ''}"`;
        return {
          ok: false,
          needs_confirmation: true,
          reason: `${why}. Tell the student that and ask whether they want it ${verb} anyway; call again with confirmed true only after they say yes.`,
        };
      }
      return null;
    };

    switch (name) {
      case 'search_courses': {
        const q = str('query').toLowerCase();
        if (!q) return { ok: false, reason: 'Give a query.' };
        const limit = Math.min(Math.max(Number(input.limit) || 12, 1), 40);
        const term = str('term') ? termOf(str('term')) : null;
        if (str('term') && !term) return { ok: false, reason: `No term called "${str('term')}" is on the board. The terms are ${termList}.` };
        const subjects = new Set(
          L.loaded.blocks.flatMap((b) => (b.rule.kind === 'all' || b.rule.kind === 'choose' || b.rule.kind === 'pool' ? b.rule.choices.flatMap((c) => c.codes) : [])).map((code) => normCode(code).split(' ')[0]),
        );
        const hits = L.catalog
          .filter((c) => matchesQuery(c, q))
          .sort((a, b) => {
            const score = (c: Course) =>
              (c.code.toLowerCase().includes(q) ? 4 : 0) +
              (c.title.toLowerCase().includes(q) ? 2 : 0) +
              (subjects.has(c.cluster) ? 1 : 0) +
              (c.tags.length > 0 ? 1 : 0) -
              (holding(c.id) || L.completedCodes.has(normCode(c.code)) ? 3 : 0);
            return score(b) - score(a) || a.code.localeCompare(b.code);
          });
        if (!term) return { ok: true, matches: hits.length, results: hits.slice(0, limit).map(describe) };
        const results: Array<ReturnType<typeof describe> & { eligible_in: string; warnings: string[] }> = [];
        const refused: string[] = [];
        for (const c of hits) {
          if (results.length >= limit || refused.length > 40) break;
          if (holding(c.id) || L.completedCodes.has(normCode(c.code))) continue;
          const verdict = check(withCourseIn(board, c.id, term.id), c, term.id);
          if (verdict.blocking.length === 0) results.push({ ...describe(c), eligible_in: term.label, warnings: verdict.warnings });
          else refused.push(`${c.code}: ${verdict.blocking[0]}`);
        }
        return {
          ok: true,
          matches: hits.length,
          note: `Only courses the student could take in ${term.label} are listed.`,
          results,
          not_eligible: refused.slice(0, 6),
        };
      }
      case 'course_details': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the Illinois catalog.` };
        const detail = await loadIllinoisCourseDetail(c.code);
        const key = normCode(c.code);
        const grade = L.core?.grades?.get(key);
        const prereq = L.core?.prereqs?.get(key);
        return {
          ok: true,
          ...describe(c),
          role_on_board: holding(c.id) ? roleOf(c) : null,
          description: detail?.course?.description ?? null,
          prerequisite_sentence: prereq?.text || detail?.course?.prereqText || null,
          prerequisite_groups: prereq?.groups?.map((g) => g.any) ?? [],
          standing_required: prereq?.standing ?? null,
          grade_history: grade
            ? { gpa: grade.gpa, a_percent: grade.aPct, drop_percent: grade.withdrawPct, difficulty_0_to_100: grade.difficulty, students: grade.n }
            : null,
          sections_in_crawled_term: L.core?.sections?.get(key)?.total ?? 0,
          does_not_count_with: L.core?.exclusions?.get(key) ?? [],
        };
      }
      case 'term_summary': {
        const term = termOf(str('term'));
        if (!term) return { ok: false, reason: `No term called "${str('term')}" is on the board. The terms are ${termList}.` };
        const courses = term.courseIds.map((id) => L.courseIndex.get(id)).filter((c): c is Course => Boolean(c));
        const credits = describeCreditTotal(planCreditRange(courses.map((c) => c.code), ctx));
        let load: string | null = null;
        const ask = await askContext();
        if (ask) {
          const routed = routeQuestion(`How does ${term.label} look?`, ask);
          if (routed.kind === 'local') load = routed.answer.text;
        }
        return {
          ok: true,
          term: term.label,
          credits,
          courses: courses.map((c) => ({ ...describe(c), role: roleOf(c) })),
          review: L.issues.filter((i) => i.termId === term.id).map((i) => ({ severity: i.severity, title: i.title, message: i.message })),
          load,
        };
      }
      case 'add_course': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the Illinois catalog.` };
        const already = holding(c.id);
        if (already) return { ok: false, reason: `${c.code} is already on the board in ${already.label}.` };
        if (board.completedCourseIds.includes(c.id)) return { ok: false, reason: `${c.code} is marked as already taken.` };
        const wanted = str('term') ? termOf(str('term')) : null;
        if (str('term') && !wanted) return { ok: false, reason: `No term called "${str('term')}" is on the board. The terms are ${termList}.` };
        const refusals: string[] = [];
        for (const t of wanted ? [wanted] : board.terms) {
          const candidate = withCourseIn(board, c.id, t.id);
          const verdict = check(candidate, c, t.id);
          if (verdict.blocking.length === 0) {
            apply(candidate, t.id, c.id, `${c.code} added to ${t.label} by ${botName}.`);
            return { ok: true, summary: `${c.code} added to ${t.label}`, term: t.label, term_credits: verdict.credits, warnings: verdict.warnings };
          }
          refusals.push(`${t.label}: ${verdict.blocking[0]}`);
        }
        return { ok: false, reason: wanted ? refusals[0].slice(refusals[0].indexOf(': ') + 2) : `${c.code} is not eligible in any term. ${refusals.join(' ')}` };
      }
      case 'remove_course': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the Illinois catalog.` };
        const t = holding(c.id);
        if (!t) return { ok: false, reason: `${c.code} is not on the board.` };
        const stop = guard(c, 'removed');
        if (stop) return stop;
        const candidate = without(board, c.id);
        const knockOn = validatePlan(candidate, ctx, { minimumTermCredits: L.minimumTermCredits, maxTermCredits: 18 })
          .filter((i) => i.severity === 'error' && /^ap-prereq-(?!check)/.test(i.id))
          .map((i) => i.message);
        apply(candidate, t.id, null, `${c.code} removed from ${t.label} by ${botName}.`);
        const left = candidate.terms.find((x) => x.id === t.id);
        const credits = describeCreditTotal(planCreditRange((left?.courseIds ?? []).map((id) => L.courseIndex.get(id)?.code ?? ''), ctx));
        return { ok: true, summary: `${c.code} removed from ${t.label}`, term: t.label, term_credits: credits, now_missing_a_prerequisite: knockOn };
      }
      case 'replace_course': {
        const oldC = courseOf(str('remove'));
        const newC = courseOf(str('add'));
        if (!oldC) return { ok: false, reason: `${str('remove') || 'That'} is not in the Illinois catalog.` };
        if (!newC) return { ok: false, reason: `${str('add') || 'That'} is not in the Illinois catalog.` };
        const t = holding(oldC.id);
        if (!t) return { ok: false, reason: `${oldC.code} is not on the board.` };
        const already = holding(newC.id);
        if (already) return { ok: false, reason: `${newC.code} is already on the board in ${already.label}.` };
        if (board.completedCourseIds.includes(newC.id)) return { ok: false, reason: `${newC.code} is marked as already taken.` };
        const stop = guard(oldC, 'replaced');
        if (stop) return stop;
        const candidate: PlanState = {
          ...board,
          terms: board.terms.map((x) => (x.id === t.id ? { ...x, courseIds: x.courseIds.map((id) => (id === oldC.id ? newC.id : id)) } : x)),
        };
        const verdict = check(candidate, newC, t.id);
        if (verdict.blocking.length > 0) return { ok: false, reason: `${newC.code} cannot go in ${t.label}: ${verdict.blocking.join(' ')}` };
        if (roleOf(oldC) === 'elective slot') noteElectiveSwap(oldC.code, newC.code, `${botName} chose it for this elective slot.`);
        apply(candidate, t.id, newC.id, `${newC.code} replaces ${oldC.code} in ${t.label}.`);
        return { ok: true, summary: `${oldC.code} → ${newC.code} in ${t.label}`, term: t.label, term_credits: verdict.credits, warnings: verdict.warnings };
      }
      case 'move_course': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the Illinois catalog.` };
        const from = holding(c.id);
        if (!from) return { ok: false, reason: `${c.code} is not on the board.` };
        const to = termOf(str('term'));
        if (!to) return { ok: false, reason: `No term called "${str('term')}" is on the board. The terms are ${termList}.` };
        if (to.id === from.id) return { ok: false, reason: `${c.code} is already in ${to.label}.` };
        const candidate = withCourseIn(without(board, c.id), c.id, to.id);
        const verdict = check(candidate, c, to.id);
        if (verdict.blocking.length > 0) return { ok: false, reason: `${c.code} cannot move to ${to.label}: ${verdict.blocking.join(' ')}` };
        apply(candidate, to.id, c.id, `${c.code} moved to ${to.label} by ${botName}.`);
        return { ok: true, summary: `${c.code} moved from ${from.label} to ${to.label}`, term_credits: verdict.credits, warnings: verdict.warnings };
      }
      case 'planner_answer': {
        const ask = await askContext();
        if (!ask) return { handled: false, note: 'The planner data is not loaded.' };
        const routed = routeQuestion(str('question'), ask);
        if (routed.kind === 'local') {
          return { handled: true, text: routed.answer.text, sources: routed.answer.sources, grounded: routed.answer.grounded };
        }
        return { handled: false, note: 'Not a question the board can answer. Try university_answer.' };
      }
      case 'university_answer': {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: str('question'), school: school?.id ?? 'illinois' }),
        });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string; sources?: unknown; grounded?: boolean };
        return { ok: res.ok, text: data.text || data.error || 'No answer came back.', sources: Array.isArray(data.sources) ? data.sources : [], grounded: Boolean(data.grounded) };
      }
      default:
        return { ok: false, error: `Unknown tool ${String(name)}.` };
    }
  };

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
      targetTermCredits,
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

  if (isCatalogSchool && status === 'loading') {
    return (
      <main className="planner-loading">
        <div>
          <h1>Reading the {school?.short} catalog</h1>
          <p>
            {isIllinois
              ? 'Courses, requirements, prerequisites, grade history and Fall 2026 sections.'
              : 'Courses, degree requirements, prerequisites, offering patterns and exam credit.'}
          </p>
        </div>
      </main>
    );
  }

  if (isCatalogSchool && status === 'unavailable') {
    return (
      <main className="planner-loading">
        <div>
          <h1>{school?.short} data is not loaded</h1>
          <p>
            The catalog or degree data is missing from this build. Reload after the data files are
            restored; nothing here will guess at a course list.
          </p>
        </div>
      </main>
    );
  }

  if (isCatalogSchool && !programId) {
    return (
      <main className="planner-loading">
        <div>
          <h1>Which degree are you planning?</h1>
          <p>
            Your answers did not point clearly at one of the {programOptions.length} {school?.short}
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
  const actionable = grouped.filter((g) => g.severity !== 'info').length;
  const errors = grouped.filter((g) => g.severity === 'error').length;
  const warnings = grouped.filter((g) => g.severity === 'warning').length;
  const years = plan ? [...new Set(plan.terms.map((t) => t.year))] : [];

  const caveats = [
    ...(activeProgramTotal && plan ? overTotal(totalCredits, activeProgramTotal) : []),
    ...planNotes,
    ...(core?.meta?.notes ?? []).map(studentWording),
    ...(isUga
      ? [
          'UGA requirements and prerequisite sentences were mechanically parsed from the Bulletin. Confirm the finished plan in DegreeWorks with an advisor.',
          'UGA offering terms are catalog patterns, not live section availability. Grade history, instructors, meeting times, rooms, and open seats are not loaded in this prototype.',
        ]
      : []),
    'Prerequisites are parsed from catalog sentences. Anything about placement or consent is not checked here.',
  ];

  return (
    <main
      className="planner-app"
      data-finder={finderOpen ? 'open' : 'closed'}
      data-chat={chatOpen ? 'open' : 'closed'}
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
        <p className="header-coverage">{isCatalogSchool ? coverage : 'Demo catalog'}</p>
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
        transcript={
          <TranscriptUpload
            school={school}
            record={answers?.transcript ?? null}
            compact
            onChange={(next) => {
              if (!answers || !onAnswersChange) return;
              onAnswersChange({ ...answers, transcript: next });
              // Prior credit changed, so the board is rebuilt from it. The same
              // move as choosing a different degree.
              setPlan(null);
            }}
          />
        }
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
        targetTermCredits={targetTermCredits}
        onTargetChange={setTargetTermCredits}
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

          {isIllinois && (
            <BotLauncher
              botName={botName}
              open={chatOpen}
              onToggle={() => {
                if (!chatOpen) setFinderOpen(false);
                setChatOpen((current) => !current);
              }}
            />
          )}

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
              {/* Only errors and warnings are "to review". The rest are notes:
                  the catalog's own words and where the elective hours went, and
                  a red "13 to review" over nine of those sent students hunting
                  for problems that were not there. */}
              {grouped.length === 0 ? (
                <>
                  <CheckCircle2 /> Nothing to review
                </>
              ) : actionable === 0 ? (
                <>
                  <Info /> {grouped.length} {grouped.length === 1 ? 'note' : 'notes'}
                </>
              ) : (
                <>
                  {errors ? <AlertCircle /> : <AlertTriangle />} {actionable} to review
                  {grouped.length > actionable ? `, ${grouped.length - actionable} ${grouped.length - actionable === 1 ? 'note' : 'notes'}` : ''}
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
                onChooseElective={openChooser}
                electiveOf={electiveOf}
              />
            );
          })}
        </div>
      </section>

      <CourseExplorer
        searchHits={searchHits}
        results={searchResults}
        chooser={
          chooser && plan
            ? {
                termLabel: plan.terms.find((t) => t.id === chooser.termId)?.label ?? 'that term',
                replacing: courseIndex.get(chooser.courseId)?.code ?? 'the elective',
                options: chooserOptions,
                onPick: (courseId) => chooseElective(chooser.termId, chooser.courseId, courseId),
                onCancel: () => setChooser(null),
              }
            : null
        }
        courses={mapCourses}
        catalogSize={catalog.length}
        core={core}
        schoolId={school?.id ?? null}
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

      {/**
        * Keyed on the degree, so changing it starts the bar over.
        *
        * The panel holds the last answer in component state, and state survives
        * a prop change. Switching from Community Health back to Computer
        * Science left the Community Health graduation answer on screen,
        * measured against a degree the student had just left, with the old
        * degree's name in the first line. A key is the whole fix: React
        * discards the instance, the panel closes, the suggestion chips are
        * rebuilt from the new board, and an answer still in flight from the old
        * degree resolves into an unmounted component and is dropped.
        */}
      {isIllinois && (
        <BotPanel
          key={programId ?? 'no-degree'}
          botName={botName}
          schoolShort={school?.short ?? 'your school'}
          programId={programId}
          board={describeBoard}
          execute={advisorExecute}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          openers={[
            'How do I drop a class?',
            'When is tuition due?',
            'Where do I find my academic advisor?',
            'I really like history. Can you work some in?',
            'Which term is hardest?',
          ]}
          ready={Boolean(plan && context && loaded)}
        />
      )}
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
    const total = Number(rows[2]);
    return `Illinois degree pages leave the credit hours blank on ${Number(rows[1]).toLocaleString()} of the ${total.toLocaleString()} course ${plural(total, 'line')} they print, so a total built from them can come out low.`;
  }
  const positions = note.match(/^(\d+) indexed courses have no map position\.$/);
  if (positions) {
    const n = Number(positions[1]);
    return `${n.toLocaleString()} ${plural(n, 'course')} ${n === 1 ? 'is' : 'are'} missing from the map. ${n === 1 ? 'It is' : 'They are'} still in the plan and in search.`;
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
    const n = Number(subjects[1]);
    return `${n} ${plural(n, 'subject')} ${n === 1 ? 'is' : 'are'} missing from this copy of the catalog, so ${n === 1 ? 'its' : 'their'} courses have no page here.`;
  }
  const programs = note.match(/^Skipped (\d+) program files whose id is not a safe path\.$/);
  if (programs) {
    const n = Number(programs[1]);
    return `${n} ${plural(n, 'degree')} ${n === 1 ? 'is' : 'are'} missing from this copy of the catalog and cannot be planned here.`;
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
