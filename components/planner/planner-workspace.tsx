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
import { toast, Toaster } from '@/components/ui/toast';
import { BotLauncher, BotPanel } from './advisor';
import { CourseExplorer } from './course-explorer';
import { ElectivePools } from './elective-pools';
import { groupIssues, PlanHealthList } from './plan-health';
import { SemesterColumn } from './semester-column';
import { illinoisProgress } from './illinois-progress';
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
  interestProfileOf,
  offeredLine,
  qualityScorer,
  awayCredits,
  describeCreditProgress,
  describeCreditTotal,
  extendForAway,
  generatePlan,
  planCreditRange,
  spreadHardOutcome,
  validatePlan,
  type AutoplanInput,
  type AwayKind,
  type AwayTerm,
  type CreditTotal,
  type GeneratedPlan,
  type LanguagePlan,
  type NotPlaced,
  type PlanningContext,
  type PoolReport,
  type UnsatisfiedRequirement,
} from '@/lib/planner/autoplan';
import { livePools, poolShortfalls } from './live-pools';
import { careerWordsAfter, trackRequiredStatus, type InterestsMode } from '@/lib/planner/career-tracks';
import { describeExcellent, interestWordsFrom, sectionTimes } from '@/lib/planner/quality';
import {
  DEFAULT_PRIORITIES,
  describePriorities,
  normalizePriorities,
  PRIORITY_PRESETS,
  type Priorities,
} from '@/lib/planner/priorities';
import type { Alternative, ElectiveOf } from './course-card';
import { plural } from './words';
import { alignExamsToCollege, examCourses, examCreditNotes, examElectiveHours, examGenEdCredits, examSchedule, matchDocumentExams, useExamCredit } from './exam-credit';
import { areaProgress } from '@/lib/planner/scheduler';
import { admissionGoal, chooseAdmission, describeAdmissionChoice, goalFromQuery, readEntry, type AdmissionChoice } from '@/lib/planner/admission-route';
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
import type { Course, PlanIssue, PlanState, PlanTerm, SemesterSeason } from '@/lib/planner/types';
import { clearAnswers, schoolById, summarize, type ExamCreditEntry, type OnboardingAnswers } from '@/lib/planner/onboarding';
import {
  normalizeCourseCode,
  normalizeTerm,
  transcriptGenEdCredits,
  transcriptCodes,
  transcriptCreditAdjustment,
  transcriptHours,
  transcriptIndirectCodes,
  transcriptOpenLines,
  transcriptResidentHours,
  type TranscriptCourseRecord,
  type TranscriptRecord,
} from '@/lib/planner/transcript';
import { proposeEquivalents, type CatalogLite } from '@/lib/planner/transfer-match';
import { distinctHeld, heldTowardDegree, type GenEdCredit, type Horizon, type PlanRequirement, type PriorCredit } from '@/lib/planner/autoplan';
import { boardChecker, genEdCandidates, genEdWhy, planMarks, repickBoard, repickSignature, type RepickChange } from '@/lib/planner/repick';
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
  /**
   * Courses the plan chose to reach the degree total, each with its reason,
   * and the career track it was booked for when there is one.
   */
  electives: Array<{ code: string; why: string; track?: string }>;
  firstTermId: string;
  /** The language sequence the plan booked, or null. */
  language: LanguagePlan | null;
  /** The college admission route the plan front-loads, or null. */
  admission: GeneratedPlan['admission'];
  /** Requirements the generation found already met by held credit. */
  satisfiedByPriorCredit: GeneratedPlan['satisfiedByPriorCredit'];
  /** The residency rule against the plan, or null. */
  residency: GeneratedPlan['residency'] | null;
  /** Which requirement each booked course was chosen for; null for a prerequisite or an elective. */
  bookedFor: Record<string, string | null>;
  /** Courses the catalog requires first that the degree page does not list, and what needs them. */
  addedPrerequisites: Array<{ code: string; requiredBy: string }>;
  /** The planner's picks for general education categories, each with its category. */
  genEdPicks: NonNullable<GeneratedPlan['genEdPicks']>;
  /** Terms away and what each earns. They have no column, so the headline and the validator read them here. */
  away?: NonNullable<GeneratedPlan['away']>;
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
  /** True when the student dropped their goal; absent on boards saved before ALMA could. */
  careerCleared?: boolean;
  /** Absent on boards saved before the knobs existed, which means balanced. */
  priorities?: Priorities;
  /** Absent on boards saved before ALMA could shape the timeline. */
  planShape?: PlanShape;
}

/**
 * What the student asked of the plan's shape beyond their credit load: a
 * finish term, terms away (study abroad, a co-op), summers they will take
 * classes in, and whether hard courses should be spread one per term. Set by
 * ALMA's set_plan_shape and applied on every build, so a rebuild keeps it.
 */
interface PlanShape {
  finish: { season: SemesterSeason; year: number } | null;
  /** Each may say what it is and what it earns; a plain term (older saves) earns nothing. */
  away: AwayTerm[];
  summers: number[];
  spreadHard: boolean;
}

const NO_SHAPE: PlanShape = { finish: null, away: [], summers: [], spreadHard: false };
const AWAY_KINDS: AwayKind[] = ['study_abroad', 'co_op', 'internship', 'gap'];

/** "Spring 2029 (study abroad, 15 hours)", for ALMA. */
function describeAway(a: AwayTerm): string {
  const what = a.kind ? `${a.kind.replace('_', ' ').replace('co op', 'co-op')}, ` : '';
  return `${a.season} ${a.year} (${what}${awayCredits(a)} hours)`;
}

/** The plan shape in a sentence for ALMA's board description. Empty when nothing is set. */
function describeShape(shape: PlanShape): string {
  const parts = [
    shape.finish ? `finish by ${shape.finish.season} ${shape.finish.year}` : null,
    shape.away.length > 0 ? `away ${shape.away.map(describeAway).join(', ')}` : null,
    shape.summers.length > 0 ? `summer classes in ${shape.summers.join(', ')}` : null,
    shape.spreadHard ? 'hard courses spread one a term where possible' : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` Shape set with the student: ${parts.join('; ')}.` : '';
}

/** What the planner could make of a student's words about what they want to do, for ALMA to say back. */
function heardInterests(text: string): string[] {
  const profile = interestProfileOf(text);
  return profile.heard.length > 0 ? profile.heard : interestWordsFrom(text);
}

/**
 * What the student said they study and want to do, for ALMA's board
 * description, with the goals the planner reads from the career words. ALMA
 * could not see that "pre-med" was still stored after the student moved on to
 * UX research, and the pre-medicine track kept first claim on the electives.
 */
function describeGoals(studying: string, career: string): string {
  const profile = interestProfileOf(career);
  const tracks = profile.tracks.map((track) => track.name);
  const topics = profile.topics.map((topic) => topic.label);
  return `What the student said they study: ${studying.trim() || 'nothing yet'}. Career words the planner reads goals from: ${career.trim() ? `"${career.trim()}"` : 'none'}. Career tracks active: ${tracks.join(', ') || 'none'}. Interest topics active: ${topics.join(', ') || 'none'}.`;
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
  /**
   * Cards the student or ALMA put on the board since the plan was built. A
   * card is "added" only when it is in here; before, every card the planner
   * booked without a list mark (its gen-ed picks, the prerequisites it added,
   * the second course of a required group) was described as the student's.
   */
  const studentAdded = useRef<Set<string>>(new Set());
  /**
   * The priorities and words the board was last built or re-picked for
   * (repickSignature), or null for a board restored from this device. A
   * re-pick for the same ones is a no-op: pressing Re-pick on a fresh
   * balanced board used to move 21 of a pre-med student's courses, because
   * the fill and the re-pick rank a little differently, and pressing it
   * again moved more.
   */
  const repickedFor = useRef<string | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [targetTermCredits, setTargetTermCredits] = useState<number | null>(null);
  const [priorities, setPriorities] = useState<Priorities>(DEFAULT_PRIORITIES);

  const [careerInterests, setCareerInterests] = useState(answers?.after ?? '');
  /**
   * The student dropped their goal through ALMA. careerInterests starts as the
   * About-you "after" answer and an empty one falls back to it, so without
   * this a student who said "I'm not pre-med anymore" saw the rail cleared
   * while the planner went on reading "pre-med" from About you.
   */
  const [careerCleared, setCareerCleared] = useState(false);
  /** What the student said they want to do: the only words career tracks and topics are read from. */
  const careerText = careerInterests || (careerCleared ? '' : answers?.after || '');
  const [planShape, setPlanShape] = useState<PlanShape>(NO_SHAPE);
  /** Set by ALMA's set_plan_shape so the next shape change rebuilds the board. */
  const rebuildForShape = useRef(false);
  // The latest values, for tool calls that run between renders.
  const planShapeRef = useRef(planShape);
  const careerTextRef = useRef(careerText);
  useEffect(() => {
    planShapeRef.current = planShape;
    careerTextRef.current = careerText;
  }, [planShape, careerText]);
  const [status_, setStatus] = useState('');
  /**
   * The status line is read by screen readers and nobody else. Anything a
   * student pressed a button for is told back on screen as well.
   */
  function notify(title: string, description?: string, type: 'success' | 'info' = 'success') {
    setStatus(description ? `${title} ${description}` : title);
    toast.add({ title, description, type, timeout: 9000 });
  }
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
      setPlanShape(parsed.planShape ?? NO_SHAPE);
      setPriorities(normalizePriorities(parsed.priorities));
      if (parsed.careerInterests) setCareerInterests(parsed.careerInterests);
      setCareerCleared(parsed.careerCleared === true);
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

  /**
   * The student's exams, priced from the table for the college of the degree
   * being planned. Calculus has a Grainger table and one for everyone else,
   * and the student picked one before the plan knew their college.
   */
  const examsAligned = useMemo(
    () => alignExamsToCollege(answers?.exams ?? [], examCredit.entries, /engineering/i.test(loaded?.program.college ?? '')),
    [answers, examCredit, loaded],
  );
  const exams = examsAligned.exams;
  /** Catalog hours by code, for pricing exam and transfer credit against the catalog. */
  const catalogCredits = useCallback((code: string): number | null => byCode.get(normCode(code))?.credits ?? null, [byCode]);

  /**
   * The college the student is trying to get into, when their own words say
   * they are not in it yet: "transfer into Gies", "switch to engineering",
   * "LAS undeclared, want business". The route is the college's published
   * one that fits how the student entered Illinois: a Psychology first-year
   * who wants mechanical engineering gets Engineering Undeclared, a student
   * coming from Parkland gets Grainger's transfer admission, and only a route
   * taken here is front-loaded onto the board (admission-route.ts).
   */
  const admissionChoice = useMemo((): AdmissionChoice | null => {
    const table = core?.admission;
    if (!table || !loaded) return null;
    const words = [answers?.studying ?? '', answers?.timeline ?? '', answers?.after ?? '', careerInterests].join(' ');
    const goal = admissionGoal(table, { college: loaded.program.college, programId: loaded.summary.id, programName: loaded.program.name }, words, answers?.transcript);
    if (!goal) return null;
    const horizon = horizonFor(answers, core?.meta?.term?.year ?? new Date().getFullYear(), planShape);
    const start = { season: horizon.startSeason, year: horizon.startYear };
    return chooseAdmission(table, goal, readEntry(words, answers?.transcript, start), start);
  }, [core, loaded, answers, careerInterests, planShape]);
  const admissionRoute = admissionChoice?.front ? admissionChoice.route : null;
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
      repickedFor.current = null;
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

    const prior = withGenEdCredit(readPriorCredit(
      answers?.transferText ?? '',
      answers?.exams.length ?? 0,
      byCode,
      // The exams the student reported, priced against the registrar's own
      // table and handed to the scheduler as courses already earned. Without
      // this the picker was decoration: a student could name four AP passes and
      // still be planned as though they were starting from nothing. The
      // transcript's lines ride in the same list, already matched against the
      // catalog and checked by the student when they reviewed the reading.
      [...examCourses(exams, examCredit.entries, (code) => byCode.has(code)), ...transcriptCodes(answers?.transcript)],
      Boolean(answers?.transcript),
      // Hours with no course to hold them: AP credit granted as "ECON 1--",
      // and every transfer line the student is counting as hours toward the
      // total, which is what Illinois grants a transferable course at minimum.
      priorHoursOf(answers, exams, examCredit.entries, catalogCredits),
      answers?.languageYears ?? null,
      answers?.language ?? null,
    ), answers, exams, examCredit.entries, catalogCredits);
    const horizon = horizonFor(answers, core?.meta?.term?.year ?? new Date().getFullYear(), planShape);

    const publishedTotal = loaded.summary.totalCredits || loaded.program.totalCredits || null;
    const planInput: AutoplanInput = {
      requirements: loaded.blocks,
      context,
      prior,
      horizon,
      preferences: { creditsPerTerm: { min: minimumTermCredits, target: targetTermCredits, max: 18 }, priorities },
      programId: loaded.summary.id,
      // The published total is what the plan must reach; the blocks alone
      // name 82 of Finance's 124 credits. The student's own words rank the
      // electives that fill the rest.
      // A published total of 0 is a page the crawl could not read a total from,
      // not a degree of no credits: English BALAS planned 2 terms and 28 hours.
      degreeTotal: publishedTotal || (isIllinois ? 120 : null),
      interests: [answers?.studying ?? '', careerText].join(' '),
      // Goals come from what the student wants to do, never from the major's
      // name: "Psychology" alone was booking psychopathology as their goal.
      career: careerText,
      programName: loaded.program.name,
      programCollege: loaded.program.college,
      admissionRoute,
      // Illinois's residency rule, from its transfer-credit page: 45 hours at
      // Illinois, 21 of them at the 300 level or above. What the student has
      // already taken here comes from their own record; transfer and exam
      // credit is not residence, whatever course it became.
      residency: isIllinois
        ? {
            hours: 45,
            upperLevel: 21,
            heldHours: transcriptResidentHours(answers?.transcript).total,
            heldUpper: transcriptResidentHours(answers?.transcript).upper,
            source: 'https://admissions.illinois.edu/transferring-credit/',
          }
        : null,
    };
    let generated = generatePlan(planInput);
    /**
     * "Spread my hard classes out": one hardest-band course a term, kept only
     * when it costs nothing. At one a term a Computer Engineering plan with
     * six required hardest-band courses and six terms had nowhere for a
     * seventh, grew two terms and nineteen credits, and said nothing about
     * why. spreadHardOutcome decides, and its note names the check that
     * failed or says what the kept plan really does.
     */
    if (planShape.spreadHard) {
      const spread = generatePlan({ ...planInput, preferences: { ...planInput.preferences, maxHardCourses: 1 } });
      const outcome = spreadHardOutcome(generated, spread, {
        difficulty: (code) => context.grades?.get(code)?.difficulty ?? null,
        bands: context.bands ?? null,
      });
      if (outcome.adopt) generated = spread;
      generated.notes.push(outcome.note);
    }

    if (!publishedTotal && isIllinois) {
      generated.notes.push(`The catalog page for ${loaded.program.name} states no total, so this plan aims at 120 hours, the minimum most Illinois bachelor's degrees state (las.illinois.edu/academics/requirements/minimum). Ask your advisor for this degree's own total.`);
    }
    /**
     * Which route in, and why: the windows and the competitive-major limit
     * for a student EU is open to, and for one it is not (a transfer, a
     * junior, a student aiming at Computer Science) the page's own reason.
     * Gies's single route already says all it has in the note above.
     */
    if (admissionChoice && !(admissionChoice.front && !admissionChoice.route?.applySemesters)) {
      generated.notes.push(describeAdmissionChoice(admissionChoice));
    }
    generated.notes.push(
      ...examCreditNotes({
        words: [answers?.studying ?? '', answers?.timeline ?? '', answers?.after ?? '', careerInterests].join(' '),
        examCodes: examCourses(exams, examCredit.entries, (code) => byCode.has(code)),
        transcriptCodes: transcriptCodes(answers?.transcript),
      }),
    );
    /**
     * "Kinesiology, BS" is four degrees with a shared core, and its page says
     * "Required Concentration. Choose one below" and lists the four by name.
     * Each is a program of its own here, so the student is told which ones
     * exist and that this plan covers only the shared part.
     */
    const concentrations = (core?.programs ?? []).filter((candidate) => candidate.id.startsWith(`${loaded.summary.id}/`));
    if (concentrations.length > 0 && loaded.blocks.some((block) => block.rule.kind === 'unparsed' && /\bconcentration\b/i.test(`${block.areaLabel} ${block.label}`))) {
      generated.notes.push(`${loaded.program.name} requires a concentration, and each one has its own plan here: ${concentrations.map((c) => c.name).join('; ')}. Choose yours as your program to plan its courses. This plan covers only what every concentration shares.`);
    }
    for (const s of examsAligned.switched) {
      generated.notes.push(`Your ${s.from.replace(/\s+-\s+Entering.*$/, '')} credit is priced from the table for students entering ${s.to.endsWith('Entering Grainger') ? 'Grainger' : 'colleges other than Grainger'}, the college of this degree.`);
    }
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
      language: generated.language,
      admission: generated.admission,
      satisfiedByPriorCredit: generated.satisfiedByPriorCredit,
      residency: generated.residency ?? null,
      bookedFor: generated.bookedFor ?? {},
      addedPrerequisites: generated.addedPrerequisites,
      genEdPicks: generated.genEdPicks ?? [],
      away: generated.away ?? [],
      firstTermId: generated.plan.terms[0]?.id ?? '',
    });
    repickedFor.current = repickSignature(priorities, planInput.interests ?? '');
    studentAdded.current = new Set();
    setUndoStack([]);
    setStatus(
      generated.unsatisfied.length || generated.notPlaced.length
        ? 'Plan built. Open the review list to see what it could not do.'
        : 'Plan built. Nothing to review.',
    );
  }, [isCatalogSchool, core, context, loaded, answers, byCode, minimumTermCredits, targetTermCredits, examCredit, careerInterests, careerText, priorities, admissionRoute, admissionChoice, isIllinois, exams, examsAligned, catalogCredits, planShape]);

  /**
   * Credit that changes after the board exists rebuilds the board.
   *
   * A transcript uploaded from the rail, a course the student typed there, or
   * one ALMA recorded used to change the numbers in the rail and nothing on
   * the board, because the board is generated once and then edited. Now a
   * change in what the student holds regenerates the plan: on its own when
   * the student has not touched the board, and after they have, only when
   * the bot recorded the credit at their request (the toast says the edits
   * were replaced). Otherwise the rail tells them to press Rebuild.
   */
  const creditKey = [
    ...transcriptCodes(answers?.transcript).sort(),
    `h${transcriptHours(answers?.transcript)}|${transcriptCreditAdjustment(answers?.transcript)}`,
    ...exams.map((e) => `${e.kind}|${e.exam}|${e.score}`),
    answers?.transferText ?? '',
    String(answers?.languageYears ?? ''),
    answers?.language ?? '',
  ].join(';');
  const lastCreditKey = useRef<string | null>(null);
  const rebuildForCredit = useRef(false);
  /**
   * ALMA's set_plan_shape changes the load or the timeline and asks for a
   * rebuild. State lands on the next render, so the rebuild runs here, once
   * the new values are what buildPlan reads.
   */
  const shapeKey = JSON.stringify([planShape, minimumTermCredits, targetTermCredits]);
  useEffect(() => {
    if (!rebuildForShape.current) return;
    rebuildForShape.current = false;
    if (!plan || !context || !loaded) return;
    // A one-off rebuild ALMA asked for, gated by the ref so it runs once per
    // request; the same pattern as the credit rebuild below.
    // oxlint-disable-next-line react/react-compiler
    buildPlan();
    notify('Plan rebuilt to your new shape', undoStack.length > 0 ? 'Your earlier edits to the board were replaced.' : undefined, 'info');
    // Keyed on the shape; the rest is read fresh when it fires.
  }, [shapeKey, plan, context, loaded, undoStack.length, buildPlan]);
  useEffect(() => {
    if (lastCreditKey.current === null) {
      lastCreditKey.current = creditKey;
      return;
    }
    if (lastCreditKey.current === creditKey) return;
    lastCreditKey.current = creditKey;
    if (!plan || !context || !loaded) return;
    const forced = rebuildForCredit.current;
    rebuildForCredit.current = false;
    if (forced || undoStack.length === 0) {
      buildPlan();
      notify('Plan rebuilt around your credit', forced && undoStack.length > 0 ? 'Your earlier edits to the board were replaced.' : undefined, 'info');
    } else {
      notify('Your credit changed', 'Press Rebuild to plan around it; your edits to the board would be replaced.', 'info');
    }
    // Only a change in the key does anything; the other dependencies are read
    // fresh when it does and are otherwise a no-op through the early return.
  }, [creditKey, plan, context, loaded, undoStack.length, buildPlan]);

  useEffect(() => {
    if (plan) return;
    // A saved board wins over a fresh generation, but only for this school.
    if (restored.current) {
      const saved = restored.current;
      restored.current = null;
      repickedFor.current = null;
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

  /**
   * Every hour the student holds, as the registrar would count it: each held
   * class once at its catalog hours (none the plan forfeited), plus exam and
   * transfer hours with no course. The headline, the class standing checks
   * and the bot all read this one number; the standing check used to count
   * only courses and told transfer students with elective-hour credit that
   * they were not yet juniors.
   */
  const priorCreditHours = useMemo(() => {
    if (!context) return 0;
    const forfeited = new Set((report?.forfeited ?? []).map((f) => normCode(f.held)));
    const once = distinctHeld([...completedCodes].filter((code) => !forfeited.has(code)), context).codes;
    return planCreditRange(once, context).min + priorHoursOf(answers, exams, examCredit.entries, catalogCredits);
  }, [context, report, completedCodes, answers, exams, examCredit, catalogCredits]);

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
      // The college the student is trying to get into: an application with
      // its own courses and deadline, put where the student reads what the
      // plan wants from them, not only in the caveats.
      ...(report.admission
        ? [
            {
              id: 'admission-route',
              severity: 'warning' as const,
              title: `Getting into ${report.admission.name}`,
              message: `${report.admission.path}: ${report.admission.eligibility.join(' ')} Its courses (${report.admission.codes.join(', ')}) are placed first, to be done by ${report.admission.requiredBy}. ${report.admission.notes[0] ?? ''} Source: ${report.admission.source}`,
              termId: firstTerm,
            },
          ]
        : []),
      // The college the student named, with no route the board can take: a
      // transfer student Engineering Undeclared does not admit, a junior past
      // its window, a student aiming at Computer Science, which is closed to
      // on-campus transfer. Saying nothing here read as "no application needed".
      ...(admissionChoice && !admissionChoice.front
        ? [
            {
              id: 'admission-route',
              severity: 'warning' as const,
              title: admissionChoice.closed
                ? `${admissionChoice.closed.major} is closed to students already at Illinois`
                : admissionChoice.route
                  ? `Getting into ${admissionChoice.route.name}: ${admissionChoice.route.path}`
                  : `Getting into ${admissionChoice.name}: no published route fits you`,
              message: describeAdmissionChoice(admissionChoice),
              termId: firstTerm,
            },
          ]
        : []),
      // Hours the student says they have that nothing recorded explains. A
      // plan built as if they were starting from zero is wrong from the first
      // term, and the fix is one upload away.
      ...(() => {
        const said = statedHours(answers?.timeline ?? '');
        if (said === null) return [];
        const recorded =
          (context ? planCreditRange(distinctHeld([...completedCodes], context).codes, context).min : 0) +
          priorHoursOf(answers, exams, examCredit.entries, catalogCredits);
        if (recorded >= said - 6) return [];
        return [
          {
            id: 'stated-hours',
            severity: 'warning' as const,
            title: `You said about ${said} credits; ${recorded > 0 ? `${recorded} are` : 'none are'} recorded`,
            message: `The plan counts only credit it can see. Upload your transcript or academic history (a screenshot works), pick your AP or IB exams, or tell ${school?.bot ?? 'the assistant'} what you took, and the plan is rebuilt around it.`,
            termId: firstTerm,
          },
        ];
      })(),
      // The campus residency rule, when the plan falls short of it. A transfer
      // student with ninety hours reaches the degree total in three terms and
      // still owes Illinois forty-five of its own; that belongs where the
      // other things to act on are.
      ...(report.residency && !report.residency.ok
        ? [
            {
              id: 'residency',
              severity: 'warning' as const,
              title: 'Residency: hours that must be taken at Illinois',
              message: report.residency.shortfall ?? '',
              termId: firstTerm,
            },
          ]
        : []),
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
  }, [report, pools, answers, examCredit, completedCodes, context, school, exams, catalogCredits, admissionChoice]);

  const issues = useMemo(() => {
    if (!plan) return [];
    const validation = context
      ? validatePlan(plan, context, { minimumTermCredits, programName: loaded?.program.name, programCollege: loaded?.program.college, priorCredits: priorCreditHours, away: report?.away }).filter(
          (issue) => !isUga || !issue.id.startsWith('ap-weighed-'),
        )
      : [];
    const rows = context
      ? [...unmet, ...validation]
      : getPlanIssues(plan, catalog, { minimumTermCredits });
    return rows.map((issue) => ({ ...issue, message: withCourseCodes(issue.message) }));
  }, [plan, context, isUga, unmet, minimumTermCredits, catalog, loaded, priorCreditHours, report]);

  /** The degree on screen, from whichever source this school has. */
  const activeProgramName =
    loaded?.program.name ?? programOptions.find((p) => p.id === programId)?.name ?? null;
  const activeProgramTotal =
    loaded?.program.totalCredits ||
    samplePrograms.find((p) => p.id === programId)?.totalCredits ||
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
    // Everything the student holds, counted once (see priorCreditHours).
    const prior = priorCreditHours;
    // A semester abroad has no column but earns its hours, and the plan
    // reached its total counting them.
    const away = (report?.away ?? []).reduce((sum, a) => sum + a.credits, 0);
    return {
      planned,
      prior,
      ...(away > 0 ? { away } : {}),
      total: {
        min: planned.min + prior + away,
        max: planned.max + prior + away,
        variable: planned.variable,
        unknown: planned.unknown,
      },
      ...shell,
    };
  }, [plan, context, boardCodes, activeProgramTotal, priorCreditHours, report]);

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
    context && (credits.prior > 0 || (credits.away ?? 0) > 0)
      ? describeCreditProgress(credits, activeProgramTotal)
      : null;

  const areas: AreaRow[] = useMemo(() => {
    if (!loaded || !plan) return [];
    /**
     * Illinois gets one row per requirement block, in the unit the page sized
     * it in, because its pages print no hour total on their areas and a bar
     * per area read "28 hr" with nothing to be a fraction of. Georgia's pages
     * do print one per area, so its rows stay per area.
     */
    if (isIllinois) {
      // Each held class once, none forfeited, only one of a pair that does not
      // both earn credit, and none the college gives no degree hours for: the
      // same set the headline counts.
      const towardDegree = heldTowardDegree(
        distinctHeld([...completedCodes].filter((code) => !(report?.forfeited ?? []).some((f) => normCode(f.held) === code)), context ?? { courses: [], equivalents: undefined, exclusions: undefined }).codes,
        loaded.program.college,
        loaded.blocks as unknown as PlanRequirement[],
      );
      return illinoisProgress({
        blocks: loaded.blocks,
        boardCodes,
        priorCodes: towardDegree.codes,
        byCode,
        pools,
        language: report?.language ?? null,
        satisfiedByPriorCredit: report?.satisfiedByPriorCredit ?? [],
        languages: core?.languages ?? null,
        equivalents: core?.equivalents ?? undefined,
        degreeTotal: activeProgramTotal,
        priorHours: priorHoursOf(answers, exams, examCredit.entries, catalogCredits) - towardDegree.hoursOff,
        genEdCredits: genEdCreditsOf(answers, exams, examCredit.entries, catalogCredits),
        programName: loaded.program.name,
      });
    }
    const have = new Set<string>(completedCodes);
    for (const term of plan.terms) {
      for (const id of term.courseIds) {
        const course = courseIndex.get(id);
        if (course) have.add(normCode(course.code));
      }
    }
    return areaProgress(loaded.program, have);
  }, [loaded, plan, completedCodes, courseIndex, isIllinois, core, boardCodes, byCode, pools, report, activeProgramTotal, answers, examCredit, exams, catalogCredits, context]);

  /**
   * Which pool each planned course is filling, and what that pool still wants.
   *
   * Counted off the pool report rather than off Course.pathwayRole, because
   * pathwayRole only says "choice" and a student looking at CS 483 in their
   * spring needs to know it is one of six technical electives and that eighteen
   * hours were asked for. The same map says which cards are the planner's
   * slots, gen-ed picks, language and booked prerequisites, and which are
   * booked for the student's career track. It is built by planMarks in
   * lib/planner/repick.ts, so the re-pick and its regression check read
   * exactly the marks the board shows.
   */
  const electiveOf = useMemo(
    (): Map<string, ElectiveOf> =>
      planMarks(
        {
          pools,
          language: report?.language ?? null,
          electives: report?.electives ?? [],
          genEdPicks: report?.genEdPicks ?? [],
          addedPrerequisites: report?.addedPrerequisites ?? [],
        },
        byCode,
      ),
    [pools, byCode, report],
  );

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
    if (termId !== 'completed') studentAdded.current.add(courseId);
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
  /** What the student walks in with, as the option lists and the re-pick read it. */
  const priorForOptions = useMemo(
    () =>
      withGenEdCredit(readPriorCredit(
        answers?.transferText ?? '',
        answers?.exams.length ?? 0,
        byCode,
        [...examCourses(exams, examCredit.entries, (code) => byCode.has(code)), ...transcriptCodes(answers?.transcript)],
        Boolean(answers?.transcript),
        priorHoursOf(answers, exams, examCredit.entries, catalogCredits),
        answers?.languageYears ?? null,
        answers?.language ?? null,
      ), answers, exams, examCredit.entries, catalogCredits),
    [answers, byCode, examCredit, exams, catalogCredits],
  );
  // careerInterests starts as the 'after' answer and replaces it once edited;
  // joining both counted the same words twice. The studying answer adds free
  // words and subjects here; goals are read from careerText alone.
  const interestsText = [answers?.studying ?? '', careerText].join(' ');

  const chooserOptions = useMemo((): { options: Course[]; whys: Map<string, string> } => {
    if (!chooser || !plan || !context || !loaded) return { options: [], whys: new Map() };
    const options: Course[] = [];
    const whys = new Map<string, string>();
    for (const option of electiveOptions({
      context,
      requirements: loaded.blocks,
      plan,
      termId: chooser.termId,
      prior: priorForOptions,
      interests: interestsText,
      career: careerText,
      programName: loaded.program.name,
      programCollege: loaded.program.college,
      priorities,
      limit: 80,
    })) {
      const course = byCode.get(normCode(option.code));
      if (!course) continue;
      options.push(course);
      whys.set(course.id, option.reasons.length > 0 ? option.reasons.slice(0, 3).join('; ') : option.why);
    }
    return { options, whys };
  }, [chooser, plan, context, loaded, byCode, priorForOptions, interestsText, careerText, priorities]);

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

  /**
   * An elective slot keeps being a slot after its course is swapped. A course
   * put in for a career track keeps the track: MCB 150 swapped into a slot
   * for a pre-PT student is still "for Pre-physical therapy (DPT)", so the
   * next re-pick for easier classes leaves it where it is.
   */
  function noteElectiveSwap(oldCode: string, newCode: string, why: string, track?: string) {
    setReport((current) =>
      current
        ? {
            ...current,
            electives: current.electives.map((e) =>
              normCode(e.code) === normCode(oldCode) ? { code: newCode, why, reasons: [], ...(track ? { track } : {}) } : e,
            ),
            genEdPicks: current.genEdPicks.map((g) => (normCode(g.code) === normCode(oldCode) ? { ...g, code: newCode } : g)),
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
   * The scorer the bot and the card dropdown read, over the priorities as
   * they stand. Rebuilt when the board moves, because a category a new card
   * covers stops being wanted.
   */
  const quality = useMemo(
    () =>
      context && loaded
        ? qualityScorer({
            context,
            requirements: loaded.blocks,
            interests: interestsText,
            career: careerText,
            programName: loaded.program.name,
            priorities,
            carriedCodes: [...boardCodes, ...completedCodes],
          })
        : null,
    [context, loaded, interestsText, careerText, priorities, boardCodes, completedCodes],
  );

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
    priorities,
    quality,
    priorForOptions,
    interestsText,
    careerText,
    pools,
    language: report?.language ?? null,
    admission: report?.admission ?? null,
    admissionChoice,
    answers: answers ?? null,
    onAnswersChange: onAnswersChange ?? null,
    report,
    examTable: examCredit.entries,
    priorCreditHours,
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
      priorities,
      quality,
      priorForOptions,
      interestsText,
      careerText,
      pools,
      language: report?.language ?? null,
      admission: report?.admission ?? null,
      admissionChoice,
      answers: answers ?? null,
      onAnswersChange: onAnswersChange ?? null,
      report,
      examTable: examCredit.entries,
      priorCreditHours,
    };
  });

  /** Why a candidate board is not allowed for a course in a term, or what to warn about if it is. */
  function checkPlacement(candidate: PlanState, course: Course, termId: string) {
    const L = live.current;
    const ctx = L.context;
    if (!ctx) return { blocking: ['The catalog is not loaded yet.'], warnings: [] as string[], credits: '' };
    const found = validatePlan(candidate, ctx, { minimumTermCredits: L.minimumTermCredits, maxTermCredits: 18, programName: L.loaded?.program.name, programCollege: L.loaded?.program.college, priorCredits: L.priorCreditHours, away: L.report?.away });
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
  }

  /**
   * Cameron's dropdown: what else could sit where this card sits. For an
   * elective slot, the best of everything eligible in the term under the
   * student's priorities; for a from-a-list card, the rest of its list that
   * passes the same checks, best first. Ranks the catalog, so it runs when
   * the menu opens and not on render.
   */
  /**
   * The board's elective-slot courses, by code, for the per-subject cap. The
   * courses booked for a career track count too, as they do in the fill.
   */
  function electiveCodesOn(board: PlanState): string[] {
    const L = live.current;
    return board.terms
      .flatMap((t) => t.courseIds)
      .filter((id) => ['elective', 'track'].includes(L.electiveOf.get(id)?.kind ?? ''))
      .map((id) => L.courseIndex.get(id)?.code ?? '')
      .filter(Boolean);
  }

  /** The published total a swap must not take the plan below, read the way buildPlan reads it. */
  function degreeTotalNow(): number | null {
    const loadedNow = live.current.loaded;
    if (!loadedNow) return null;
    return loadedNow.summary.totalCredits || loadedNow.program.totalCredits || (isIllinois ? 120 : null);
  }

  /**
   * The whole-board check a swap on this board has to pass: nothing on the
   * board loses a prerequisite or its standing, the course coming in runs
   * that term and is open to this student, the term stays within 18 (9 in a
   * summer) and above the minimum, and the plan stays at its total.
   */
  function swapCheckOn(board: PlanState) {
    const L = live.current;
    if (!L.context || !L.loaded) return null;
    return boardChecker({
      context: L.context,
      board,
      requirements: L.loaded.blocks,
      minimumTermCredits: L.minimumTermCredits,
      priorCredits: L.priorCreditHours,
      degreeTotal: degreeTotalNow(),
      programName: L.loaded.program.name,
      programCollege: L.loaded.program.college,
    });
  }

  /**
   * Other courses that could take a gen-ed pick's place, best first: the
   * candidates genEdCandidates allows (every category the pick carries, at
   * least its hours, never half of a two-course sequence such as CMN 111 for
   * RHET 105), each one passing the whole-board check where the pick sits.
   */
  function genEdAlternatives(courseId: string, termId: string, limit: number): Array<Alternative & { score: number }> {
    const L = live.current;
    const board = planRef.current;
    if (!board || !L.context || !L.loaded || !L.quality) return [];
    const me = L.courseIndex.get(courseId);
    const check = swapCheckOn(board);
    if (!me || !check) return [];
    const out: Array<Alternative & { score: number }> = [];
    let tries = 0;
    for (const { course, q, categories } of genEdCandidates({ context: L.context, requirements: L.loaded.blocks, board, courseId, scorer: L.quality })) {
      if (out.length >= limit || tries >= limit * 4) break;
      tries += 1;
      const candidate: PlanState = {
        ...board,
        terms: board.terms.map((t) => (t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === courseId ? course.id : id)) } : t)),
      };
      if (check(candidate, board, termId, course, me) !== null) continue;
      out.push({ course, score: q.score, why: genEdWhy(q, categories) });
    }
    return out;
  }

  function alternativesFor(courseId: string, termId: string): Alternative[] {
    const L = live.current;
    const board = planRef.current;
    if (!board || !L.context || !L.loaded) return [];
    const mark = L.electiveOf.get(courseId);
    if (!mark) return [];
    const reason = (reasons: string[], fallback: string) => (reasons.length > 0 ? reasons.slice(0, 2).join('; ') : fallback);
    if (mark.kind === 'language') {
      const lang = L.language;
      const table = L.core?.languages;
      const me = L.courseIndex.get(courseId);
      if (!lang || !table || !me) return [];
      const level = lang.completed + lang.codes.findIndex((code) => normCode(code) === normCode(me.code));
      if (level < lang.completed) return [];
      const out: Alternative[] = [];
      for (const other of table.languages) {
        if (other.name === lang.name) continue;
        const code = other.levels[level]?.flat().find((c) => L.byCode.has(normCode(c)));
        const course = code ? L.byCode.get(normCode(code)) : undefined;
        if (!course) continue;
        out.push({ course, why: `${other.name}, semester ${level + 1}. Choosing it switches the rest of the sequence to ${other.name}.` });
      }
      return out;
    }
    if (mark.kind === 'gened') return genEdAlternatives(courseId, termId, 7);
    // A track card is there for the student's goal, not to be traded for a
    // better-rated elective; the card offers no dropdown for it.
    if (mark.kind === 'prerequisite' || mark.kind === 'track') return [];
    if (mark.kind === 'elective') {
      return electiveOptions({
        context: L.context,
        requirements: L.loaded.blocks,
        plan: board,
        termId,
        prior: L.priorForOptions,
        interests: L.interestsText,
        career: L.careerText,
        programName: L.loaded.program.name,
        programCollege: L.loaded.program.college,
        priorities: L.priorities,
        electiveCodes: electiveCodesOn(board),
        limit: 7,
      })
        .map((o) => {
          const course = L.byCode.get(normCode(o.code));
          return course ? { course, why: reason(o.reasons, o.why) } : null;
        })
        .filter((a): a is Alternative => a !== null);
    }
    const pool = L.pools.find((p) => p.picked.some((code) => L.byCode.get(normCode(code))?.id === courseId));
    const scorer = L.quality;
    if (!pool || !scorer) return [];
    const onBoard = new Set(board.terms.flatMap((t) => t.courseIds));
    const ranked = pool.alternatives
      .map((code) => L.byCode.get(normCode(code)))
      .filter((c): c is Course => c !== undefined)
      .filter((c) => !onBoard.has(c.id) && !board.completedCourseIds.includes(c.id))
      .map((c) => ({ c, q: scorer(normCode(c.code)) }))
      .sort((a, b) => b.q.score - a.q.score || b.q.known - a.q.known || a.c.code.localeCompare(b.c.code));
    const out: Alternative[] = [];
    for (const { c, q } of ranked) {
      if (out.length >= 7) break;
      const candidate: PlanState = {
        ...board,
        terms: board.terms.map((t) =>
          t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === courseId ? c.id : id)) } : t,
        ),
      };
      if (checkPlacement(candidate, c, termId).blocking.length > 0) continue;
      out.push({ course: c, why: reason(q.reasons, `On the list ${pool.label}.`) });
    }
    return out;
  }

  /**
   * Switch the language: the tapped card and every later card of the
   * sequence become the same semesters of the new language, so the student
   * never ends up with two semesters of Spanish and one of French.
   */
  function switchLanguage(courseId: string, replacementId: string) {
    const lang = report?.language;
    const table = core?.languages;
    const replacement = courseIndex.get(replacementId);
    if (!plan || !lang || !table || !replacement) return;
    const other = table.languages.find((l) => l.levels.some((lv) => lv.flat().some((c) => normCode(c) === normCode(replacement.code))));
    if (!other) return;
    const startIndex = lang.codes.findIndex((code) => byCode.get(normCode(code))?.id === courseId);
    if (startIndex < 0) return;
    const swaps = new Map<string, string>();
    const newCodes = lang.codes.slice();
    for (let i = startIndex; i < lang.codes.length; i += 1) {
      const level = lang.completed + i;
      const code = other.levels[level]?.flat().find((c) => byCode.has(normCode(c)));
      const oldCourse = byCode.get(normCode(lang.codes[i]));
      const newCourse = code ? byCode.get(normCode(code)) : undefined;
      if (!oldCourse || !newCourse) continue;
      swaps.set(oldCourse.id, newCourse.id);
      newCodes[i] = newCourse.code;
    }
    if (swaps.size === 0) return;
    commit({
      ...plan,
      terms: plan.terms.map((t) => ({ ...t, courseIds: t.courseIds.map((id) => swaps.get(id) ?? id) })),
    });
    setReport((current) => (current && current.language ? { ...current, language: { ...current.language, name: other.name, codes: newCodes, why: `You chose ${other.name}.` } } : current));
    setSelectedCourseId(replacementId);
    notify(`${other.name} replaces ${lang.name}`, `${swaps.size} language ${plural(swaps.size, 'card')} switched: ${[...swaps.values()].map((id) => courseIndex.get(id)?.code).filter(Boolean).join(', ')}.`);
  }

  /** Put a course from the dropdown where the card is. A slot stays a slot; a list card stays on its list. */
  function swapCourse(courseId: string, termId: string, replacementId: string) {
    if (electiveOf.get(courseId)?.kind === 'language') {
      switchLanguage(courseId, replacementId);
      return;
    }
    if (electiveOf.get(courseId)?.kind === 'elective') {
      chooseElective(termId, courseId, replacementId);
      return;
    }
    if (!plan) return;
    const oldCourse = courseIndex.get(courseId);
    const course = courseIndex.get(replacementId);
    if (!course) return;
    if (plannedCourseIds.has(replacementId) || plan.completedCourseIds.includes(replacementId)) {
      setStatus(`${course.code} is already in the plan.`);
      return;
    }
    commit({
      ...plan,
      terms: plan.terms.map((t) =>
        t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === courseId ? replacementId : id)) } : t,
      ),
    });
    setSelectedCourseId(replacementId);
    const mark = electiveOf.get(courseId);
    const list = mark?.label;
    if (mark?.kind === 'gened' && oldCourse) noteElectiveSwap(oldCourse.code, course.code, `You chose it for ${mark.label}.`);
    notify(
      `${course.code} replaces ${oldCourse?.code ?? 'the course'}`,
      `In ${plan.terms.find((t) => t.id === termId)?.label ?? 'that term'}${list ? `, still ${mark?.kind === 'gened' ? 'counting for' : 'filling the list'} ${list}` : ''}.`,
    );
  }

  /**
   * Re-choose the planner's own picks under a set of priorities: a named
   * career track's required courses first, then every elective slot, gen-ed
   * pick (never Composition I) and from-a-list course the page's sub-rules
   * do not pin, each at most once. The logic and its safety rules live in
   * repickBoard (lib/planner/repick.ts), where __repick.check.mjs replays it:
   * every swap is checked against the whole board, track cards never move,
   * and a re-pick for the priorities the board was last built or re-picked
   * for moves nothing (`unchanged`). This commits the result and keeps the
   * report's marks in step with it.
   */
  function repickElectives(next: Priorities): { changes: RepickChange[]; unchanged: boolean } {
    const L = live.current;
    const board = planRef.current;
    if (!board || !L.context || !L.loaded) return { changes: [], unchanged: false };
    const result = repickBoard({
      context: L.context,
      requirements: L.loaded.blocks,
      board,
      marks: L.electiveOf,
      pools: L.pools,
      prior: L.priorForOptions,
      interests: L.interestsText,
      career: L.careerText,
      programName: L.loaded.program.name,
      programCollege: L.loaded.program.college,
      priorities: next,
      minimumTermCredits: L.minimumTermCredits,
      priorCredits: L.priorCreditHours,
      degreeTotal: degreeTotalNow(),
      trackPicks: (L.report?.electives ?? []).filter((e) => e.track).map((e) => e.code),
      lastSignature: repickedFor.current,
    });
    repickedFor.current = result.signature;
    if (result.changes.length === 0) return { changes: [], unchanged: result.unchanged };
    commit(result.board);
    planRef.current = result.board;
    for (const c of result.changes) {
      if (c.from) noteElectiveSwap(c.from, c.to, c.kind === 'track' ? c.why : `Picked for your priorities: ${c.why}`, c.track);
    }
    const added = result.changes.filter((c) => !c.from);
    if (added.length > 0) {
      setReport((current) => (current ? { ...current, electives: [...current.electives, ...added.map((c) => ({ code: c.to, why: c.why, reasons: [], track: c.track }))] } : current));
    }
    return { changes: result.changes, unchanged: false };
  }

  type Role = 'required' | 'from a list' | 'elective slot' | 'career track' | 'language' | 'gen ed pick' | 'prerequisite' | 'added';
  function roleOf(course: Course): Role {
    const L = live.current;
    const slot = L.electiveOf.get(course.id);
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
    const booked = L.report?.bookedFor?.[normCode(course.code)];
    if (booked && !studentAdded.current.has(course.id)) {
      const block = L.loaded?.blocks.find((b) => b.id === booked);
      if (block && (block.rule.kind === 'all' || block.rule.kind === 'choose')) return 'required';
    }
    return 'added';
  }
  function markOf(course: Course): string {
    const role = roleOf(course);
    if (role === 'from a list') return `from a list: ${live.current.electiveOf.get(course.id)?.label ?? ''}`;
    if (role === 'career track') return `career track: ${live.current.electiveOf.get(course.id)?.track ?? ''}`;
    return role;
  }
  /**
   * The row of the student's career track a course fills, with its other
   * codes: PHYS 101's row also takes PHYS 211. Null when no track the
   * student names asks for it.
   */
  function trackRowOf(code: string, trackName: string | undefined): string[] | null {
    const track = interestProfileOf(live.current.careerText).tracks.find((t) => t.name === trackName);
    const row = track?.courses.find((c) => c.codes.some((x) => normCode(x) === normCode(code)));
    return row ? row.codes.map(normCode) : null;
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
      'Marks: [required] the degree page names it. [from a list: X] fills the list X. [elective slot] the planner picked it to reach the total; swap it freely. [career track: X] a course the student\'s career track X requires; keep it unless they drop the goal, and ask before removing or replacing it. [language] part of the language sequence for the language requirement; the language is the student\'s choice, the level is not. [gen ed pick] the planner chose it for a general education category; swap it for another course that carries the same categories. [prerequisite] the planner booked it because a later course needs it. [added] the student or you put it there.',
    );
    const taken = board.completedCourseIds
      .map((id) => L.courseIndex.get(id)?.code)
      .filter((code): code is string => Boolean(code));
    lines.push(`Already taken, counted but not on the board: ${taken.length > 0 ? taken.join(', ') : 'none'}.`);
    lines.push(describeCredit(L.answers?.transcript ?? null, L.priorForOptions, L.report?.residency ?? null));
    lines.push(
      `Credit load: at least ${L.minimumTermCredits} credits a term, aim ${L.targetTermCredits ?? 'an even share of what is left'}, never above 18.${describeShape(planShapeRef.current)} Section times on cards come from ${L.core?.meta?.term?.label ?? 'one crawled term'}.`,
    );
    lines.push(describeGoals(L.answers?.studying ?? '', L.careerText));
    lines.push(`Priorities, which decide the elective picks and the order of choices: ${describePriorities(L.priorities)}`);
    if (L.language) lines.push(`Language requirement: ${L.language.name}, semesters ${L.language.completed + 1} to ${L.language.semesters} planned (${L.language.codes.join(', ')}). ${L.language.why}`);
    if (L.admission) lines.push(`Getting into ${L.admission.name} (${L.admission.path}): the student is not in this college yet. Its courses (${L.admission.codes.join(', ')}) are placed first, due by ${L.admission.requiredBy}. ${L.admission.eligibility.join(' ')} Source: ${L.admission.source}`);
    // Why this route and not the other, or why none: ALMA should not offer
    // a transfer student the EU windows, or a CS hopeful any route at all.
    const choice = L.admissionChoice;
    if (choice && (!choice.front || choice.route?.applySemesters)) {
      lines.push(`Which route in, from how the student entered Illinois: ${describeAdmissionChoice(choice)}`);
    }
    for (const term of board.terms) {
      const courses = term.courseIds
        .map((id) => L.courseIndex.get(id))
        .filter((c): c is Course => Boolean(c));
      const credits = L.context
        ? describeCreditTotal(planCreditRange(courses.map((c) => c.code), L.context)).replace(/ credits?$/, ' cr')
        : `${courses.reduce((n, c) => n + c.credits, 0)} cr`;
      const hardCut = L.context?.bands?.hardest ?? null;
      const hard = courses.filter((c) => {
        const d = L.core?.grades?.get(normCode(c.code))?.difficulty ?? null;
        return hardCut !== null && d !== null && d >= hardCut;
      }).length;
      const dormant = courses.filter((c) => L.context?.offeringTerms?.length && (L.context.offerings?.get(normCode(c.code)) ?? []).length === 0).map((c) => c.code);
      const read = [hard >= 2 ? `${hard} hardest-band courses together` : null, dormant.length ? `not run recently: ${dormant.join(', ')}` : null].filter(Boolean).join('; ');
      lines.push(
        `${term.label} (${credits}${read ? `; ${read}` : ''}): ${
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
    /** How the course reads against the student's priorities, in their words. */
    const fitOf = (c: Course) => {
      if (!L.quality) return null;
      const q = L.quality(normCode(c.code));
      return { score_0_to_1: Math.round(q.score * 100) / 100, reasons: q.reasons, not_known: q.unknown };
    };
    const describe = (c: Course) => ({
      code: c.code,
      title: c.title,
      credits: creditsOf(c),
      subject: subjectName(c.cluster),
      gen_ed: c.tags,
      difficulty_0_to_100: L.core?.grades?.get(normCode(c.code))?.difficulty ?? null,
      on_board_in: holding(c.id)?.label ?? null,
      already_taken: L.completedCodes.has(normCode(c.code)),
      teaching: describeExcellent(
        L.core?.excellent?.get(normCode(c.code)) ?? null,
        L.core?.excellentTerms,
        L.core?.sections?.get(normCode(c.code))?.instructors ?? null,
        L.core?.meta?.term?.label ?? null,
      ),
      recent_terms_it_ran: offeredLine(ctx, normCode(c.code)),
      fit: fitOf(c),
    });
    /** The planner's read of one term: credits, how heavy, what stacks. */
    const termRead = (t: PlanTerm) => {
      const courses = t.courseIds.map((id) => L.courseIndex.get(id)).filter((x): x is Course => Boolean(x));
      const credits = describeCreditTotal(planCreditRange(courses.map((x) => x.code), ctx));
      const hardCut = ctx.bands?.hardest ?? null;
      const hard = courses.filter((x) => {
        const d = L.core?.grades?.get(normCode(x.code))?.difficulty ?? null;
        return hardCut !== null && d !== null && d >= hardCut;
      });
      const weighed = courses.filter((x) => (L.core?.grades?.get(normCode(x.code))?.difficulty ?? null) !== null);
      const avg = weighed.length
        ? Math.round(weighed.reduce((n, x) => n + (L.core?.grades?.get(normCode(x.code))?.difficulty ?? 0), 0) / weighed.length)
        : null;
      const dormant = courses.filter((x) => ctx.offeringTerms?.length && (ctx.offerings?.get(normCode(x.code)) ?? []).length === 0).map((x) => x.code);
      const wrongSeason = courses
        .filter((x) => x.offeringKnown && x.offeredIn.length > 0 && !x.offeredIn.includes(t.season))
        .map((x) => `${x.code} (has run in ${x.offeredIn.join(' and ')} only)`);
      const load =
        hard.length >= 3 || (avg !== null && ctx.bands && avg >= ctx.bands.hardest)
          ? 'brutal'
          : hard.length === 2 || (avg !== null && ctx.bands && avg >= ctx.bands.harder)
            ? 'heavy'
            : avg !== null && ctx.bands && avg <= ctx.bands.typical
              ? 'light'
              : 'typical';
      return {
        term: t.label,
        credits,
        load_by_grade_history: weighed.length ? load : 'not known',
        average_difficulty_0_to_100: avg,
        courses_weighed: `${weighed.length} of ${courses.length}`,
        hardest_band_courses: hard.map((x) => x.code),
        not_run_recently: ctx.offeringTerms?.length ? dormant : 'not known: no offering history is loaded',
        season_mismatch: wrongSeason,
        review: L.issues.filter((i) => i.termId === t.id && i.severity !== 'info').map((i) => `${i.severity}: ${i.message}`),
      };
    };
    /** Runners-up for a slot or a list pick, with reasons. */
    const runnersUp = (c: Course, t: PlanTerm, limit: number) =>
      alternativesFor(c.id, t.id)
        .slice(0, limit)
        .map((a) => ({ code: a.course.code, title: a.course.title, credits: creditsOf(a.course), why: a.why, fit: fitOf(a.course) }));
    const withCourseIn = (base: PlanState, courseId: string, termId: string): PlanState => ({
      ...base,
      terms: base.terms.map((t) => (t.id === termId ? { ...t, courseIds: [...t.courseIds, courseId] } : t)),
    });
    const without = (base: PlanState, courseId: string): PlanState => ({
      ...base,
      terms: base.terms.map((t) => ({ ...t, courseIds: t.courseIds.filter((id) => id !== courseId) })),
    });
    const check = checkPlacement;
    /**
     * A term an edit leaves under the student's minimum. Full-time status is
     * what a scholarship, a visa or financial aid is measured on, and moving
     * a course out of a term only reported the term it went to.
     */
    const underMinimum = (next: PlanState, termId: string) => {
      const t = next.terms.find((x) => x.id === termId);
      // A summer carries 9 credits at most by design, and a term away holds
      // nothing on purpose; neither is "under the minimum".
      if (!t || t.season === 'Summer') return {};
      if ((L.report?.away ?? []).some((a) => a.label === t.label)) return {};
      // An emptied fall or spring is the strongest case, not a quiet one: no
      // enrolment at all that term.
      if (t.courseIds.length === 0) {
        return { below_minimum: `${t.label} now holds nothing, which is a fall or spring with no enrolment. Say so; offer to move a course back, or if the student means to be away that term, set it with set_plan_shape away.` };
      }
      const range = planCreditRange(t.courseIds.map((id) => L.courseIndex.get(id)?.code ?? ''), ctx);
      return range.max < L.minimumTermCredits
        ? { below_minimum: `${t.label} now holds ${describeCreditTotal(range)}, under the ${L.minimumTermCredits} the student set as a minimum. Say so and offer an elective to bring it back up.` }
        : {};
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
      if ((role === 'required' || role === 'from a list' || role === 'career track' || role === 'language' || role === 'gen ed pick' || role === 'prerequisite') && input.confirmed !== true) {
        const mark = L.electiveOf.get(course.id);
        const why =
          role === 'required'
            ? `${course.code} is required by this degree`
            : role === 'career track'
              ? `${course.code} is booked for the student's goal, ${mark?.track ?? 'their career track'}: ${mark?.detail.replace(/^For [^:]*:\s*/, '') ?? 'the track asks for it'} It stays unless they drop that goal`
            : role === 'language'
              ? `${course.code} is part of the language sequence that meets the degree's language requirement (another language can take its place; use replace_course with the same semester's course in that language)`
              : role === 'gen ed pick'
                ? `${course.code} is the planner's pick for ${L.electiveOf.get(course.id)?.label ?? 'a general education category'} (a course carrying the same categories can take its place; removing it leaves the category open)`
                : role === 'prerequisite'
                  ? `${course.code} is booked because ${L.electiveOf.get(course.id)?.detail.replace(/^.*before /, '').replace(/\.$/, '') ?? 'a later course'} needs it first`
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
            const fit = (c: Course) => (L.quality ? L.quality(normCode(c.code)).score : 0);
            return score(b) - score(a) || fit(b) - fit(a) || a.code.localeCompare(b.code);
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
        // The window the scorer weighs, read the way quality.ts reads it, so
        // ALMA's answer for this course is the card's answer.
        const p = L.priorities;
        const wanted = { notBefore: p.notBefore ?? (p.noEarly ? 540 : null), notAfter: p.notAfter ?? null, freeDays: p.freeDays ?? [] };
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
          ...sectionTimes(detail?.sections?.sections ?? [], L.core?.sections?.get(key)?.meet, L.core?.meta?.term?.label ?? null, wanted),
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
            studentAdded.current.add(c.id);
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
        const knockOn = validatePlan(candidate, ctx, { minimumTermCredits: L.minimumTermCredits, maxTermCredits: 18, programName: L.loaded?.program.name, programCollege: L.loaded?.program.college, priorCredits: L.priorCreditHours, away: L.report?.away })
          .filter((i) => i.severity === 'error' && /^ap-prereq-(?!check)/.test(i.id))
          .map((i) => i.message);
        apply(candidate, t.id, null, `${c.code} removed from ${t.label} by ${botName}.`);
        const left = candidate.terms.find((x) => x.id === t.id);
        const credits = describeCreditTotal(planCreditRange((left?.courseIds ?? []).map((id) => L.courseIndex.get(id)?.code ?? ''), ctx));
        return { ok: true, summary: `${c.code} removed from ${t.label}`, term: t.label, term_credits: credits, now_missing_a_prerequisite: knockOn, ...underMinimum(candidate, t.id) };
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
        const oldRole = roleOf(oldC);
        const oldMark = L.electiveOf.get(oldC.id);
        if (oldRole === 'elective slot' || oldRole === 'gen ed pick') noteElectiveSwap(oldC.code, newC.code, `${botName} chose it for this ${oldRole === 'gen ed pick' ? 'category' : 'elective slot'}.`);
        // PHYS 211 in place of PHYS 101 still meets the track's physics row,
        // so it stays a track course; anything else is the student's own.
        else if (oldRole === 'career track' && trackRowOf(oldC.code, oldMark?.track)?.includes(normCode(newC.code))) noteElectiveSwap(oldC.code, newC.code, oldMark?.detail ?? `For ${oldMark?.track}.`, oldMark?.track);
        else studentAdded.current.add(newC.id);
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
        return { ok: true, summary: `${c.code} moved from ${from.label} to ${to.label}`, term_credits: verdict.credits, warnings: verdict.warnings, ...underMinimum(candidate, from.id) };
      }
      case 'compare_courses': {
        const raw = Array.isArray(input.codes) ? (input.codes as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const found = raw.map((x) => ({ asked: x, course: courseOf(x) }));
        const missing = found.filter((f) => !f.course).map((f) => f.asked);
        const courses = found.map((f) => f.course).filter((x): x is Course => Boolean(x));
        if (courses.length < 2) return { ok: false, reason: `Name at least two courses in the catalog.${missing.length ? ` Not in the catalog: ${missing.join(', ')}.` : ''}` };
        const term = str('term') ? termOf(str('term')) : null;
        if (str('term') && !term) return { ok: false, reason: `No term called "${str('term')}" is on the board. The terms are ${termList}.` };
        const rows = [];
        for (const c of courses) {
          const key = normCode(c.code);
          const prereq = L.core?.prereqs?.get(key);
          const grade = L.core?.grades?.get(key);
          const detail = await loadIllinoisCourseDetail(c.code);
          const verdict = term && !holding(c.id) ? check(withCourseIn(board, c.id, term.id), c, term.id) : null;
          rows.push({
            ...describe(c),
            role_on_board: holding(c.id) ? roleOf(c) : null,
            description: (detail?.course?.description ?? '').slice(0, 400) || null,
            prerequisite_sentence: prereq?.text || detail?.course?.prereqText || null,
            grade_history: grade ? { gpa: grade.gpa, a_percent: grade.aPct, drop_percent: grade.withdrawPct, students: grade.n } : null,
            sections_in_crawled_term: L.core?.sections?.get(key)?.total ?? 0,
            earliest_section: L.core?.sections?.get(key)?.earliest ?? null,
            ...(term ? { in_term: term.label, eligible: verdict ? verdict.blocking.length === 0 : holding(c.id) ? 'already on the board' : null, blocked_by: verdict?.blocking ?? [], warnings: verdict?.warnings ?? [] } : {}),
          });
        }
        return { ok: true, priorities: describePriorities(L.priorities), courses: rows, not_in_catalog: missing, note: 'Weigh these for the student in their own terms; do not just relist them.' };
      }
      case 'explain_choice': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the Illinois catalog.` };
        const t = holding(c.id);
        if (!t) return { ok: false, reason: `${c.code} is not on the board.` };
        const role = roleOf(c);
        const key = normCode(c.code);
        // What later courses on the board need it first.
        const unlocks: string[] = [];
        for (const later of board.terms) {
          for (const id of later.courseIds) {
            const other = L.courseIndex.get(id);
            if (!other || other.id === c.id) continue;
            const groups = L.core?.prereqs?.get(normCode(other.code))?.groups ?? [];
            if (groups.some((g) => g.any.map(normCode).includes(key))) unlocks.push(`${other.code} in ${later.label}`);
          }
        }
        const base = { ok: true, ...describe(c), term: t.label, role, unlocks_later_on_the_board: unlocks };
        if (role === 'required') {
          const names = L.loaded.blocks
            .filter((b) => (b.rule.kind === 'all' || b.rule.kind === 'choose' || b.rule.kind === 'pool') && b.rule.choices.some((ch) => ch.codes.map(normCode).includes(key)))
            .map((b) => `${b.areaLabel}: ${b.label}`);
          return { ...base, named_by: names, why: 'The degree page names it. Moving it is fine when the checks allow; removing it needs the student\'s yes.' };
        }
        if (role === 'added') return { ...base, why: 'The student or you put it there.' };
        if (role === 'gen ed pick') return { ...base, why: L.electiveOf.get(c.id)?.detail ?? 'The planner chose it for a general education category.', alternatives_same_categories: genEdAlternatives(c.id, t.id, 5).map((a) => `${a.course.code}: ${a.why}`) };
        if (role === 'prerequisite') return { ...base, why: L.electiveOf.get(c.id)?.detail ?? 'A later course on the board needs it first.' };
        const mark = L.electiveOf.get(c.id);
        if (role === 'career track') {
          return {
            ...base,
            why: mark?.detail ?? 'Booked for the career goal the student named.',
            career_track: mark?.track ?? null,
            same_row_alternatives: (trackRowOf(c.code, mark?.track) ?? []).filter((code) => code !== normCode(c.code)),
            note: 'The student\'s career track requires it. Keep it unless they drop the goal; a re-pick never moves it.',
          };
        }
        if (role === 'language') {
          return {
            ...base,
            why: mark?.detail ?? 'Part of the language sequence.',
            language_plan: L.language,
            other_languages_same_semester: runnersUp(c, t, 30),
            note: 'The level is required; the language is the student\'s choice. Switching one card switches the rest of the sequence.',
          };
        }
        return {
          ...base,
          list: mark?.kind === 'pool' ? mark.label : null,
          chosen_for: mark?.detail ?? null,
          runners_up: runnersUp(c, t, 6),
          note: 'Runners-up are what the planner would offer in its place under the current priorities, best first; a swap needs a clear reason.',
        };
      }
      case 'what_if': {
        const changes = Array.isArray(input.changes) ? (input.changes as Array<Record<string, unknown>>) : [];
        if (changes.length === 0) return { ok: false, reason: 'Give at least one change.' };
        let candidate: PlanState = board;
        const applied: string[] = [];
        const refused: string[] = [];
        const added: Course[] = [];
        const holdingIn = (b: PlanState, id: string) => b.terms.find((x) => x.courseIds.includes(id)) ?? null;
        for (const ch of changes) {
          const op = typeof ch.op === 'string' ? ch.op : '';
          const c = typeof ch.code === 'string' ? courseOf(ch.code) : null;
          if (!c) { refused.push(`${typeof ch.code === 'string' ? ch.code : 'that course'}: not in the catalog`); continue; }
          if (op === 'add') {
            const to = typeof ch.term === 'string' ? termOf(ch.term) : null;
            if (!to) { refused.push(`add ${c.code}: give a term on the board`); continue; }
            if (holdingIn(candidate, c.id)) { refused.push(`add ${c.code}: already on the board`); continue; }
            candidate = withCourseIn(candidate, c.id, to.id); added.push(c); applied.push(`add ${c.code} to ${to.label}`);
          } else if (op === 'remove') {
            if (!holdingIn(candidate, c.id)) { refused.push(`remove ${c.code}: not on the board`); continue; }
            candidate = without(candidate, c.id); applied.push(`remove ${c.code}`);
          } else if (op === 'replace') {
            const n = typeof ch.add === 'string' ? courseOf(ch.add) : null;
            const from = holdingIn(candidate, c.id);
            if (!from) { refused.push(`replace ${c.code}: not on the board`); continue; }
            if (!n) { refused.push(`replace ${c.code}: the replacement is not in the catalog`); continue; }
            if (holdingIn(candidate, n.id)) { refused.push(`replace ${c.code} with ${n.code}: ${n.code} is already on the board`); continue; }
            candidate = { ...candidate, terms: candidate.terms.map((x) => (x.id === from.id ? { ...x, courseIds: x.courseIds.map((id) => (id === c.id ? n.id : id)) } : x)) };
            added.push(n); applied.push(`replace ${c.code} with ${n.code} in ${from.label}`);
          } else if (op === 'move') {
            const to = typeof ch.term === 'string' ? termOf(ch.term) : null;
            const from = holdingIn(candidate, c.id);
            if (!from) { refused.push(`move ${c.code}: not on the board`); continue; }
            if (!to) { refused.push(`move ${c.code}: give a term on the board`); continue; }
            candidate = withCourseIn(without(candidate, c.id), c.id, to.id); applied.push(`move ${c.code} from ${from.label} to ${to.label}`);
          } else refused.push(`${c.code}: unknown op ${op}`);
        }
        const before = validatePlan(board, ctx, { minimumTermCredits: L.minimumTermCredits, maxTermCredits: 18, programName: L.loaded?.program.name, programCollege: L.loaded?.program.college, priorCredits: L.priorCreditHours, away: L.report?.away });
        const after = validatePlan(candidate, ctx, { minimumTermCredits: L.minimumTermCredits, maxTermCredits: 18, programName: L.loaded?.program.name, programCollege: L.loaded?.program.college, priorCredits: L.priorCreditHours, away: L.report?.away });
        const keyOf = (i: PlanIssue) => `${i.id}|${i.message}`;
        const was = new Set(before.map(keyOf));
        const newIssues = after.filter((i) => !was.has(keyOf(i)) && i.severity !== 'info').map((i) => `${i.severity}: ${i.message}`);
        const gone = new Set(after.map(keyOf));
        const resolved = before.filter((i) => !gone.has(keyOf(i)) && i.severity !== 'info').map((i) => i.message);
        const terms = candidate.terms.map((x) => ({
          term: x.label,
          credits: describeCreditTotal(planCreditRange(x.courseIds.map((id) => L.courseIndex.get(id)?.code ?? '').filter(Boolean), ctx)),
        }));
        return {
          ok: true,
          simulated: true,
          note: 'Nothing on the board changed. Use add_course, remove_course, replace_course or move_course to make it real.',
          applied,
          refused,
          new_problems: newIssues,
          problems_resolved: resolved,
          terms_after: terms,
          new_courses_fit: added.map((c) => ({ code: c.code, fit: fitOf(c), recent_terms_it_ran: offeredLine(ctx, normCode(c.code)) })),
        };
      }
      case 'review_board': {
        const terms = board.terms.map(termRead);
        const heaviest = terms
          .filter((t) => t.average_difficulty_0_to_100 !== null)
          .sort((a, b) => (b.average_difficulty_0_to_100 ?? 0) - (a.average_difficulty_0_to_100 ?? 0))[0]?.term ?? null;
        const groups = groupIssues(L.issues).filter((g) => g.severity !== 'info');
        const open = L.issues.filter((i) => /^(unsatisfied|pool|ap-missing)/.test(i.id) || /not (yet )?(met|satisfied)|still needs|short/i.test(i.title)).map((i) => i.message.slice(0, 200));
        const dormant = terms.flatMap((t) => (Array.isArray(t.not_run_recently) ? t.not_run_recently : []).map((code) => `${code} in ${t.term}`));
        const stacked = terms.filter((t) => t.hardest_band_courses.length >= 2).map((t) => `${t.term}: ${t.hardest_band_courses.join(', ')}`);
        const suggestions: string[] = [];
        for (const t of terms) {
          // A term "brutal" on its average alone (MCB 354, PHYS 102 and a
          // difficulty-64 MATH 220 together) got no suggestion before; only
          // two hardest-band courses did.
          const brutal = t.load_by_grade_history === 'brutal';
          if (t.hardest_band_courses.length >= 2 || brutal) {
            const own = board.terms.find((x) => x.label === t.term)?.courseIds.map((id) => L.courseIndex.get(id)).find((c) => c && ['elective', 'gened'].includes(L.electiveOf.get(c.id)?.kind ?? ''));
            const what = t.hardest_band_courses.length >= 2 ? `stacks ${t.hardest_band_courses.length} hardest-band courses` : `averages ${t.average_difficulty_0_to_100} by grade history, the heaviest reading there is`;
            if (own) suggestions.push(`${t.term} ${what} and holds one of the planner's own picks (${own.code}); a lighter course there, or moving one hard course to a lighter term, would spread the load. set_plan_shape spread_hard can try the whole plan.`);
            else suggestions.push(`${t.term} ${what}; consider moving one course to a lighter term if prerequisites allow (what_if first), or set_plan_shape spread_hard.`);
          }
        }
        for (const d of dormant) suggestions.push(`${d} has not run in any recent term; ask the department or pick a course that has.`);
        return {
          ok: true,
          degree: L.loaded.program.name,
          total_planned: L.totalCredits,
          published_total: L.activeProgramTotal,
          priorities: describePriorities(L.priorities),
          terms,
          heaviest_term_by_grade_history: heaviest,
          terms_stacking_hard_courses: stacked,
          not_run_recently: ctx.offeringTerms?.length ? dormant : 'not known: no offering history is loaded, so do not claim every course is offered',
          open_requirements: open.slice(0, 12),
          review_flags: groups.slice(0, 12).map((g) => `${g.severity}: ${g.title}: ${g.message.slice(0, 200)}`),
          suggestions,
          note: 'Give the student your own judgement from this: what is fine, what to change, and why. Not a list.',
        };
      }
      case 'program_admission': {
        const table = L.core?.admission;
        if (!table) return { ok: false, reason: 'No admission routes are loaded in this build.' };
        const goal = goalFromQuery(table, str('college'), str('major'), { college: L.loaded.program.college, programId: L.loaded.summary.id, programName: L.loaded.program.name });
        if (!goal) return { ok: false, reason: `No published route is loaded for "${[str('college'), str('major')].filter(Boolean).join(', ')}". Loaded: ${[...new Set(Object.values(table.colleges).map((r) => r.name))].join('; ')}. Use university_answer for other colleges.` };
        /**
         * The route from the student's situation, not from the college name
         * alone: "engineering" used to return Grainger's transfer admission
         * (3.00 GPA, Calc III, opening January 15) to a Psychology
         * first-year, whose route is Engineering Undeclared. The semester is
         * read against the board's first term, the one the plan starts in.
         */
        const words = [L.answers?.studying ?? '', L.answers?.timeline ?? '', L.answers?.after ?? '', L.careerText].join(' ');
        const firstLabel = board.terms[0]?.label ?? '';
        const labelled = firstLabel.match(/\b(Fall|Spring) (\d{4})\b/);
        const fallback = horizonFor(L.answers, L.core?.meta?.term?.year ?? new Date().getFullYear(), planShapeRef.current);
        const start = labelled ? { season: labelled[1] as 'Fall' | 'Spring', year: Number(labelled[2]) } : { season: fallback.startSeason, year: fallback.startYear };
        const entry = readEntry(words, L.answers?.transcript, start);
        const choice = chooseAdmission(table, goal, entry, start);
        const notFor = choice.notFor
          .filter((n) => n.key !== choice.key)
          .map((n) => ({ route: n.path, why_not: n.reason, source: n.source }));
        const readAs = entry.entry === 'transfer'
          ? `a transfer student, ${entry.arriving ? 'still coming from another school' : 'already at Illinois'} (${entry.why})`
          : entry.entry === 'first-year'
            ? `entered Illinois as a first-year; ${entry.semester ? `${start.season} ${start.year} is semester ${entry.semester}` : 'semester unknown'} (${entry.why})`
            : `not said (${entry.why})`;
        if (choice.closed) {
          return {
            ok: true,
            college: choice.name,
            major: choice.closed.major,
            closed_to_students_already_here: choice.closed.text,
            what_the_pages_offer_instead: choice.closed.offers,
            student_read_as: readAs,
            sources: choice.closed.sources,
            as_of: choice.closed.readAt ?? table.fetchedAt,
            note: 'Say plainly that this major cannot be reached from another college on campus, and offer what the pages offer. Do not suggest Engineering Undeclared as a way into it.',
          };
        }
        const route = choice.route;
        if (!route) {
          return {
            ok: true,
            college: choice.name,
            route: null,
            why: choice.why,
            not_for_you: notFor,
            student_read_as: readAs,
            as_of: table.fetchedAt,
            note: 'Tell the student no published route fits them and why, in the page\'s own words, and who to ask.',
          };
        }
        const onBoardTerm = (c: string) => {
          const course = courseOf(c);
          return course ? holding(course.id)?.label ?? null : null;
        };
        /**
         * "CHEM 102 and CHEM 103" is met by both, not either: one of the
         * options and every course it must be taken with. A held CHEM 103
         * alone read as General Chemistry 1 done.
         */
        const status = route.required.map((item) => {
          const options = item.options ?? [];
          const together = item.with ?? [];
          const isHeld = (c: string) => L.completedCodes.has(normCode(c));
          const isPlanned = (c: string) => isHeld(c) || Boolean(onBoardTerm(c));
          const held = [...options, ...together].filter(isHeld);
          const planned = [...options, ...together].map((c) => [c, onBoardTerm(c)] as const).filter((x) => x[1]);
          const done = options.some(isHeld) && together.every(isHeld);
          const covered = options.some(isPlanned) && together.every(isPlanned);
          const missing = [...(options.some(isPlanned) ? [] : [options.join(' or ')]), ...together.filter((c) => !isPlanned(c))].filter(Boolean);
          return {
            requirement: item.label,
            already_have: held,
            on_the_board: planned.map(([c, t]) => `${c} in ${t}`),
            status: done ? 'done' : covered ? 'planned' : item.genEd ? 'a general education category; check the board for a course carrying it' : held.length || planned.length ? `partly: ${missing.join(', ')} not on the board` : 'missing',
          };
        });
        return {
          ok: true,
          college: route.name,
          route: route.path,
          why_this_route: choice.why,
          student_read_as: readAs,
          not_for_you: notFor,
          who_it_is_for: route.who,
          eligibility: route.eligibility,
          required_by: route.requiredBy,
          required: status,
          application_windows: choice.windows.map((w) => ({ semester: w.semester, term: w.term, dates: w.dates, admits_for: w.admits })),
          competitive_majors: choice.competitive,
          plus_for_data_science_majors: route.dataScienceExtra ?? [],
          recommended: route.recommended,
          notes: route.notes,
          contact: route.contact,
          source: route.source,
          other_sources: (route.sources ?? []).map((x) => x.url).filter((u) => u !== route.source),
          as_of: route.readAt ?? table.fetchedAt,
          note: choice.front
            ? 'Read this against the student\'s actual term of study and hours. Say which route this is and why, what is done, what is planned and when, what is missing, the windows, and that the application itself is competitive.'
            : 'This route is applied for before the student arrives at Illinois, so the board does not carry its courses. Say which route this is and why, and what the college expects done before applying.',
        };
      }
      case 'set_priorities': {
        const presetName =
          typeof input.preset === 'string' && input.preset in PRIORITY_PRESETS
            ? (input.preset as keyof typeof PRIORITY_PRESETS)
            : null;
        const base = presetName ? PRIORITY_PRESETS[presetName] : L.priorities;
        const knobs: Record<string, unknown> = {};
        for (const key of ['workload', 'teaching', 'relevance', 'coverage', 'schedule', 'noEarly', 'format'] as const) {
          if (input[key] !== undefined) knobs[key] = input[key];
        }
        for (const key of ['notBefore', 'notAfter', 'freeDays'] as const) {
          if (input[key] !== undefined) knobs[key] = input[key];
        }
        const next = normalizePriorities({ ...base, noEarly: L.priorities.noEarly, format: L.priorities.format, notBefore: L.priorities.notBefore, notAfter: L.priorities.notAfter, freeDays: L.priorities.freeDays, ...knobs });
        setPriorities(next);
        live.current = { ...live.current, priorities: next };
        /**
         * The student's own words about what they want, written where the
         * planner reads them. Before this, "I want to go into machine
         * learning" said in chat never reached the scorer: set_priorities had
         * no field for it and the only place it could go was the rail.
         *
         * Added to what is stored unless ALMA says the goal changed (replace)
         * or was dropped (clear): "pre-med" stored first and "I want UX
         * research instead" said later kept the pre-medicine track on every
         * rebuild.
         */
        const mode: InterestsMode = input.interests_mode === 'replace' || input.interests_mode === 'clear' ? input.interests_mode : 'add';
        const said = typeof input.interests === 'string' ? input.interests.trim() : '';
        const tracksBefore = interestProfileOf(careerTextRef.current).tracks;
        let heard: string[] | null = null;
        let stored: string | null = null;
        if (said || mode === 'clear') {
          stored = careerWordsAfter(careerTextRef.current, said, mode);
          setCareerInterests(stored);
          setCareerCleared(stored === '');
          careerTextRef.current = stored;
          live.current = { ...live.current, interestsText: [L.answers?.studying ?? '', stored].join(' '), careerText: stored };
          if (said) heard = heardInterests(stored);
        }
        const outcome = input.repick === false ? { changes: [], unchanged: false } : repickElectives(next);
        // Net changes, one per course that left or joined the board.
        const repicked = outcome.changes.map((c) => ({ term: c.term, from: c.from, to: c.to, why: c.why, ...(c.track ? { career_track: c.track } : {}) }));
        const profile = interestProfileOf(live.current.careerText);
        const dropped = tracksBefore.filter((track) => !profile.tracks.includes(track)).map((track) => track.name);
        /**
         * The re-pick books a track's required courses first, one slot at a
         * time, and brought three of the twelve a Rebuild books for a pre-PT
         * Kinesiology student. So the result says which are on the board and
         * which are not, and ALMA offers a Rebuild for the rest.
         */
        let trackCourses: Array<{ track: string; on_the_board: string[]; already_taken: string[]; not_on_the_board: string[] }> = [];
        if (heard !== null && profile.tracks.length > 0) {
          const termOf = new Map<string, string>();
          for (const term of planRef.current?.terms ?? []) {
            for (const id of term.courseIds) {
              const course = L.courseIndex.get(id);
              if (course) termOf.set(normCode(course.code), term.label);
            }
          }
          trackCourses = profile.tracks.map((track) => {
            const status = trackRequiredStatus(track, (code) => termOf.get(normCode(code)) ?? null, (code) => L.completedCodes.has(normCode(code)));
            return { track: track.name, on_the_board: status.planned, already_taken: status.held, not_on_the_board: status.missing };
          });
        }
        const missingTrackCourses = trackCourses.some((t) => t.not_on_the_board.length > 0);
        if (repicked.length > 0) {
          notify(
            `ALMA re-picked ${repicked.length} ${plural(repicked.length, 'course')}`,
            repicked.map((c) => (c.from ? `${c.to} for ${c.from} in ${c.term}` : `${c.to} added in ${c.term}`)).join('; ') + '.',
          );
        } else if (input.repick === false) {
          notify('ALMA saved your priorities', 'The board was not changed. Re-pick or Rebuild applies them.', 'info');
        } else if (outcome.unchanged) {
          notify('ALMA kept your priorities', 'The board was built, or last re-picked, for exactly these, so nothing moved.', 'info');
        } else {
          notify('ALMA updated your priorities', 'Every pick already held the best course for them that the board can take.', 'info');
        }
        const interestsNotes = [
          mode === 'replace' && !said ? 'interests_mode replace needs the new words in interests, so the stored career words were kept; use clear to drop the goal.' : null,
          dropped.length > 0 ? `No longer a goal: ${dropped.join(', ')}. Courses booked for it that are still on the board are ordinary elective slots now, and pressing Rebuild plans without them; say so.` : null,
          missingTrackCourses
            ? 'track_courses lists each course the track requires: on the board, already taken, or not on the board. The re-pick books them first, but only into elective slots it can swap. Tell the student which are not on the board, and that pressing Rebuild books the track\'s required courses before any other elective and places them earliest; the plan\'s notes name any it still cannot fit, and a Rebuild replaces their own edits to the board.'
            : null,
        ].filter(Boolean);
        return {
          ok: true,
          priorities: describePriorities(next),
          ...(heard !== null ? { interests_heard: heard.length > 0 ? heard : 'nothing the planner can match to courses; use search_courses for this topic and replace elective slots by hand' } : {}),
          ...(stored !== null || (mode === 'replace' && !said)
            ? {
                career_words: live.current.careerText || 'none',
                active_tracks: profile.tracks.map((track) => track.name),
                active_topics: profile.topics.map((topic) => topic.label),
              }
            : {}),
          ...(trackCourses.length > 0 ? { track_courses: trackCourses } : {}),
          repicked,
          note:
            (repicked.length > 0
              ? `The courses listed were swapped; required courses, career-track courses and anything the student added were not touched, and no swap left a course without its prerequisites, pushed a term over 18 credits or put a course in a term it does not run. Tell the student each swap and its reason.${repicked.some((c) => 'career_track' in c) ? ' Entries with career_track book a course that track requires (an empty "from" means it was added beside its lecture); these come before a wish for lighter electives, so say that once, and say the other picks were kept light.' : ''}`
              : input.repick === false
                ? 'Saved. The board was not re-picked.'
                : outcome.unchanged
                  ? 'Saved. Nothing moved because the board already reflects these priorities: it was built, or last re-picked, for exactly these priorities and these interests. Say so; do not call set_priorities again for the same wish.'
                  : 'Saved. Every one of the planner\'s picks already held the best course under these priorities that the board can take (a better-rated course that would break a prerequisite, overload a term or not run that term is never swapped in), so nothing on the board moved.') +
            (interestsNotes.length > 0 ? ` ${interestsNotes.join(' ')}` : ''),
        };
      }
      case 'set_plan_shape': {
        const termOfWords = (raw: unknown): { season: SemesterSeason; year: number } | null => {
          if (typeof raw !== 'string') return null;
          const m = raw.trim().match(/^(fall|spring|summer)\s+(20\d\d)$/i);
          return m ? { season: (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as SemesterSeason, year: Number(m[2]) } : null;
        };
        const nextShape: PlanShape = { ...planShapeRef.current };
        let nextMin = L.minimumTermCredits;
        let nextTarget = L.targetTermCredits ?? null;
        const problems: string[] = [];
        if (input.min_credits !== undefined) {
          const n = Number(input.min_credits);
          if (Number.isInteger(n) && n >= 6 && n <= 18) nextMin = n;
          else problems.push('min_credits must be a whole number from 6 to 18.');
        }
        if (input.target_credits !== undefined) {
          if (input.target_credits === null) nextTarget = null;
          else {
            const n = Number(input.target_credits);
            if (Number.isInteger(n) && n >= 6 && n <= 18) nextTarget = n;
            else problems.push('target_credits must be a whole number from 6 to 18, or null for an even share.');
          }
        }
        if (input.finish !== undefined) {
          if (input.finish === null || input.finish === 'default') nextShape.finish = null;
          else {
            const t = termOfWords(input.finish);
            if (t) nextShape.finish = t;
            else problems.push('finish must be a term like "Spring 2029".');
          }
        }
        /**
         * A term away is "Spring 2029", or { term, kind, credits }: a
         * semester abroad earns 15 hours unless the student says otherwise,
         * anything else nothing unless they say so.
         */
        const awayOf = (raw: unknown): AwayTerm | null => {
          const given = typeof raw === 'string' ? { term: raw } : raw && typeof raw === 'object' ? (raw as { term?: unknown; kind?: unknown; credits?: unknown }) : null;
          const t = given ? termOfWords(given.term) : null;
          if (!given || !t || t.season === 'Summer') return null;
          const kind = AWAY_KINDS.find((k) => k === given.kind);
          if (given.kind !== undefined && given.kind !== null && !kind) return null;
          const hours = given.credits === undefined || given.credits === null ? undefined : Number(given.credits);
          if (hours !== undefined && !(Number.isInteger(hours) && hours >= 0 && hours <= 18)) return null;
          return { ...t, ...(kind ? { kind } : {}), ...(hours !== undefined ? { credits: hours } : {}) };
        };
        if (Array.isArray(input.away)) {
          const terms = input.away.map(awayOf);
          if (terms.every((t) => t !== null)) nextShape.away = terms as AwayTerm[];
          else problems.push('away must be fall or spring terms like "Spring 2029", or objects like {"term": "Spring 2029", "kind": "study_abroad", "credits": 15} with kind study_abroad, co_op, internship or gap and credits from 0 to 18.');
        }
        if (Array.isArray(input.summers)) {
          const years = input.summers.map((v) => (typeof v === 'number' ? v : Number(String(v).replace(/^summer\s+/i, ''))));
          if (years.every((y) => Number.isInteger(y) && y >= 2020 && y <= 2040)) nextShape.summers = years;
          else problems.push('summers must be years like 2027 or terms like "Summer 2027".');
        }
        if (input.spread_hard !== undefined) nextShape.spreadHard = input.spread_hard === true;
        /**
         * Terms outside the plan are refused, not saved. "Away Spring 2035"
         * and "summers 2032" came back ok, the board rebuilt identical to the
         * default, and ALMA told the student it was done. The range is the
         * one the build will use: the finish (the new one, if this call sets
         * it), moved past terms away when the student never dated it.
         */
        if (problems.length === 0 && (Array.isArray(input.away) || Array.isArray(input.summers) || input.finish !== undefined)) {
          const span = extendForAway(horizonFor(L.answers, L.core?.meta?.term?.year ?? new Date().getFullYear(), { ...nextShape, summers: [] }));
          const first = termOrd(span.startSeason, span.startYear);
          const last = termOrd(span.gradSeason, span.gradYear);
          const range = `${span.startSeason} ${span.startYear} to ${span.gradSeason} ${span.gradYear}`;
          for (const a of nextShape.away) {
            const at = termOrd(a.season, a.year);
            if (at < first || at > last) problems.push(`${a.season} ${a.year} is outside this plan, which runs ${range}, so it cannot be a term away. Check the term with the student, or set finish as well if the plan should run past it.`);
          }
          for (const y of nextShape.summers) {
            const at = termOrd('Summer', y);
            if (at <= first || at > last) problems.push(`Summer ${y} is outside this plan, which runs ${range}; a summer of classes has to come after the first term and no later than the finish.`);
          }
        }
        if (problems.length > 0) return { ok: false, reason: problems.join(' ') };
        const changed =
          JSON.stringify(nextShape) !== JSON.stringify(planShapeRef.current) || nextMin !== L.minimumTermCredits || nextTarget !== (L.targetTermCredits ?? null);
        if (!changed) return { ok: true, note: 'Nothing changed; the board already has this shape.' };
        if (undoStack.length > 0 && input.confirmed !== true) {
          return {
            ok: false,
            needs_confirmation: true,
            reason: 'Changing the load or the timeline rebuilds the board, which replaces the edits the student made by hand. Tell them and ask; call again with confirmed true only after they say yes.',
          };
        }
        rebuildForShape.current = true;
        planShapeRef.current = nextShape;
        setPlanShape(nextShape);
        setMinimumTermCredits(nextMin);
        setTargetTermCredits(nextTarget);
        return {
          ok: true,
          summary: [
            `at least ${nextMin} credits a term, aim ${nextTarget ?? 'an even share'}`,
            nextShape.finish ? `finish by ${nextShape.finish.season} ${nextShape.finish.year}` : 'finish date from what the student said',
            nextShape.away.length > 0 ? `away: ${nextShape.away.map(describeAway).join(', ')}` : null,
            nextShape.summers.length > 0 ? `summer classes: ${nextShape.summers.join(', ')}` : null,
            nextShape.spreadHard ? 'hard courses spread one a term where the degree allows' : null,
          ].filter(Boolean).join('; '),
          note: 'The board rebuilds now. Call review_board next and tell the student what changed: the terms, the credits per term, and any note the plan adds (a lighter load needs a later finish; a term away is left empty on the board, and a semester abroad counts its hours toward the total; a summer carries at most 9 credits; summers make falls and springs lighter, so if the student wanted to finish earlier instead, confirm it and set finish).',
        };
      }
      case 'exam_credit': {
        const grainger = /engineering/i.test(L.loaded.program.college ?? '');
        const schedule = examSchedule(str('exam'), str('kind') || null, L.examTable, grainger);
        if (!schedule) return { ok: false, reason: `${str('exam')} is not in the registrar's AP and IB table. Check the name, or it may earn no credit at Illinois.` };
        const held = (L.answers?.exams ?? []).filter((e) => e.exam === schedule.exam);
        return {
          ok: true,
          ...schedule,
          priced_for: /Entering/.test(schedule.exam) ? (grainger ? 'students entering Grainger (this degree)' : 'students entering a college other than Grainger (this degree)') : 'every college',
          student_has: held.map((e) => `${e.kind} ${e.exam}${e.level ? ` ${e.level}` : ''}: ${e.score}`),
          source: 'https://citl.illinois.edu/current-cutoff-scores (policies for students entering Summer 2026, Fall 2026 or Spring 2027)',
        };
      }
      case 'prior_credit': {
        const record = L.answers?.transcript ?? null;
        const exams = L.answers?.exams ?? [];
        const counted = (record?.courses ?? [])
          .filter((c) => c.use && c.counts === 'course' && c.matched)
          .map((c) => ({
            code: c.matched,
            also: c.also ?? [],
            as_printed: c.code,
            title: c.title,
            credits: c.credits,
            grade: c.grade,
            term: c.term,
            status: c.status,
            from: c.from ?? (record?.home === false ? record.institution : null),
            how: c.matchedBy === 'code' ? 'Illinois code on the record' : c.matchedBy === 'printed' ? 'equivalent printed on the document (confirmed)' : c.matchedBy === 'proposal' ? 'likely equivalent from the catalog (not confirmed)' : 'entered by the student or in chat',
          }));
        const hoursLines = (record?.courses ?? [])
          .filter((c) => c.use && c.counts === 'hours')
          .map((c) => ({ as_printed: c.code, title: c.title, hours: c.equivalentCredits ?? c.credits, from: c.from ?? (record?.home === false ? record.institution : null), status: c.status, likely_equivalents: (c.proposals ?? []).map((p) => `${p.code} ${p.title} (${p.confidence})`) }));
        const notCounted = (record?.courses ?? [])
          .filter((c) => !c.use)
          .map((c) => ({ as_printed: c.code, title: c.title, status: c.status, why: c.status === 'no_credit' ? 'the document says it earns no credit' : c.status === 'withdrawn' ? 'withdrawn' : c.status === 'failed' ? 'failed' : 'turned off by the student' }));
        const examCodes = L.priorForOptions.courseCodes.filter((code) => !transcriptCodes(record).includes(code));
        return {
          ok: true,
          known: L.priorForOptions.known,
          record: record ? { institution: record.institution, kind: record.kind ?? null, files: record.files ?? [record.fileName], read_at: record.readAt, home: record.home !== false } : null,
          courses_counted: counted,
          courses_from_exams_or_typed_codes: examCodes,
          exams_named: exams.map((e) => `${e.kind} ${e.exam}${e.score !== '' ? ` (${e.score})` : ' (no score given)'}`),
          hours_toward_total_without_a_course: L.priorForOptions.unmatchedCredits,
          lines_counted_as_hours: hoursLines,
          lines_not_counted: notCounted,
          open_lines_to_settle: transcriptOpenLines(record).map((c) => ({ as_printed: c.code, title: c.title, hours: c.credits, likely_equivalents: (c.proposals ?? []).map((p) => ({ code: p.code, title: p.title, credits: p.credits, confidence: p.confidence, why: p.why })) })),
          language: L.answers ? { high_school_years: L.answers.languageYears ?? null, language: L.answers.language || null } : null,
          residency: L.report?.residency ?? null,
          rule: 'Illinois decides equivalency: Transferology is the estimate, the Transfer Evaluation Report the decision. Every transferable course counts at least as elective hours toward the total. Residency: 45 hours at Illinois, 21 at the 300 level or above (admissions.illinois.edu/transferring-credit/).',
        };
      }
      case 'find_equivalent': {
        const title = str('title');
        if (!title) return { ok: false, reason: 'Give the course title as printed or as the student said it.' };
        const lite = catalogLiteOf(L.catalog);
        const proposals = proposeEquivalents({ code: str('code').toUpperCase(), title, credits: typeof input.credits === 'number' ? input.credits : null }, lite, 5);
        return {
          ok: true,
          course: { code: str('code') || null, title, credits: typeof input.credits === 'number' ? input.credits : null, school: str('school') || null },
          likely_equivalents: proposals.map((p) => ({ code: p.code, title: p.title, credits: p.credits, confidence: p.confidence, why: p.why, on_board_or_held: holding(courseOf(p.code)?.id ?? '') || L.completedCodes.has(normCode(p.code)) })),
          note: proposals.length === 0
            ? 'Nothing in the catalog reads as the same course. It still transfers as elective hours if it is college-level; record it as hours.'
            : 'These come from the catalog\'s titles and a table of common equivalents, not from Illinois\'s evaluation. Present the top one as likely, confirm with the student, then record it.',
        };
      }
      case 'record_prior_credit': {
        if (!L.onAnswersChange || !L.answers) return { ok: false, reason: 'Credit cannot be recorded on this screen.' };
        const code = str('code') ? normCode(str('code')) : '';
        const hours = typeof input.hours === 'number' && Number.isFinite(input.hours) ? input.hours : null;
        const title = str('title') || null;
        const from = str('from') || null;
        const inProgress = input.in_progress === true;
        let course: Course | null = null;
        if (code) {
          course = courseOf(code);
          if (!course) return { ok: false, reason: `${code} is not in the Illinois catalog. If it is another school's course, call find_equivalent with its title first.` };
        } else if (hours === null || hours <= 0) {
          return { ok: false, reason: 'Give an Illinois course code, or the hours it transferred as.' };
        }
        const record = L.answers.transcript;
        if (course && (transcriptCodes(record).includes(normCode(course.code)) || L.completedCodes.has(normCode(course.code)))) {
          return { ok: true, changed: false, message: `${course.code} is already counted as taken.` };
        }
        const line: TranscriptCourseRecord = course
          ? { code: course.code, title: title ?? course.title, credits: course.credits, grade: null, term: null, status: inProgress ? 'in_progress' : from && !/^(illinois|uiuc|urbana)/i.test(from) ? 'transfer' : 'completed', from, equivalent: null, matched: normCode(course.code), matchedBy: 'student', use: true, counts: 'course', illinoisCredits: course.credits }
          : { code: title?.match(/^[A-Z]{2,5}\s?\d{3,4}[A-Z]?/i)?.[0].toUpperCase() ?? 'TRANSFER', title, credits: hours, grade: null, term: null, status: 'transfer', from, equivalent: null, matched: null, matchedBy: null, use: true, counts: 'hours' };
        const base: TranscriptRecord = record ?? { fileName: 'Told to ALMA', readAt: new Date().toISOString(), institution: null, kind: 'course_list', home: true, files: [], courses: [], exams: [], notes: [] };
        rebuildForCredit.current = true;
        L.onAnswersChange({ ...L.answers, transcript: { ...base, courses: [...base.courses, line] } });
        return {
          ok: true,
          changed: true,
          recorded: course ? `${course.code} ${course.title} (${course.credits} cr) as already taken${from ? `, from ${from}` : ''}${inProgress ? ', in progress' : ''}` : `${hours} hours toward the total${title ? ` for ${title}` : ''}${from ? ` from ${from}` : ''}`,
          message: 'Recorded. The plan is being rebuilt around it now; call review_board or term_summary in your next step to see the new board before describing it. Any edits the student made to the board by hand were replaced by the rebuild.',
        };
      }
      case 'drop_prior_credit': {
        if (!L.onAnswersChange || !L.answers?.transcript) return { ok: false, reason: 'There is no recorded credit to drop.' };
        const code = str('code') ? normCode(str('code')) : '';
        const title = str('title').toLowerCase();
        const record = L.answers.transcript;
        const index = record.courses.findIndex((c) => c.use && ((code && (c.matched === code || normCode(c.code) === code)) || (title && (c.title ?? '').toLowerCase() === title)));
        if (index < 0) {
          const fromExam = code && L.priorForOptions.courseCodes.includes(code);
          return { ok: false, reason: fromExam ? `${code} comes from an exam the student chose under Credit, not from a recorded line; change the exam's score there to drop it.` : `No counted line matches ${code || title}.` };
        }
        const dropped = record.courses[index];
        rebuildForCredit.current = true;
        L.onAnswersChange({ ...L.answers, transcript: { ...record, courses: record.courses.map((c, i) => (i === index ? { ...c, use: false, counts: 'none', matched: null, matchedBy: null } : c)) } });
        return { ok: true, changed: true, dropped: `${dropped.matched ?? dropped.code}${dropped.title ? ` ${dropped.title}` : ''}`, message: 'Dropped. The plan is being rebuilt; call review_board in your next step to see it.' };
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
      careerCleared,
      priorities,
      planShape,
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
      <Toaster />

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
        priorCount={context ? distinctHeld([...completedCodes], context).codes.length : (plan?.completedCourseIds.length ?? 0)}
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
            onExams={(found) => {
              if (!answers || !onAnswersChange) return 0;
              const grainger = /engineering/i.test(loaded?.program.college ?? '');
              const priced = matchDocumentExams(found, examCredit.entries, grainger).filter(
                (e) => !answers.exams.some((have) => have.kind === e.kind && have.exam === e.exam),
              );
              if (priced.length > 0) onAnswersChange({ ...answers, exams: [...answers.exams, ...priced] });
              return priced.length;
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
        priorities={priorities}
        onPrioritiesChange={setPriorities}
        onRepick={() => {
          const { changes: changed, unchanged } = repickElectives(priorities);
          const picks = [...electiveOf.values()].length;
          if (unchanged) {
            notify('Nothing to re-pick', 'The board was built, or last re-picked, for these priorities, so it already reflects them. Change a knob first, or open a card\'s chevron to see the runners-up.', 'info');
          } else if (changed.length > 0) {
            notify(
              `Re-picked ${changed.length} ${plural(changed.length, 'course')}`,
              changed.map((c) => (c.from ? `${c.to} for ${c.from} in ${c.term}` : `${c.to} added in ${c.term}`)).join('; ') + '.',
            );
          } else {
            notify(
              'Nothing to swap',
              `Each of the planner's ${picks} ${plural(picks, 'pick')} already holds the best course for these priorities. Change a knob and try again, or open a card's chevron to see the runners-up.`,
              'info',
            );
          }
        }}
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
                alternativesFor={alternativesFor}
                onSwapCourse={swapCourse}
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
                options: chooserOptions.options,
                whys: chooserOptions.whys,
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

/**
 * What the student walked in with, in the words the bot reads before
 * advising. Every count here is the planner's own: the codes it treats as
 * earned, the hours it counts with no course, the lines it left open, and the
 * residency rule against the plan.
 */
function describeCredit(record: TranscriptRecord | null, prior: PriorCredit, residency: GeneratedPlan['residency'] | null): string {
  const parts: string[] = [];
  if (!prior.known) parts.push('The student said they have credit but nothing usable was recorded, so the plan assumes a clean start.');
  if (record) {
    const source = record.home === false ? `${record.institution ?? 'another school'}'s ${record.kind === 'transfer_report' ? 'evaluation report' : record.kind === 'degree_audit' ? 'degree audit' : record.kind === 'course_list' ? 'course list' : 'transcript'}` : record.kind === 'course_list' && record.courses.every((c) => c.matchedBy === 'student') ? 'courses the student typed or told the bot' : `the student's Illinois ${record.kind === 'degree_audit' ? 'degree audit' : record.kind === 'transfer_report' ? 'evaluation report' : 'record'}`;
    const likely = record.courses.filter((c) => c.use && c.counts === 'course' && c.matchedBy === 'proposal').map((c) => `${c.code} as ${c.matched}`);
    const open = transcriptOpenLines(record).map((c) => `${c.code}${c.title ? ` ${c.title}` : ''}${c.proposals?.[0] ? ` (likely ${c.proposals[0].code})` : ''}`);
    parts.push(`Credit read from ${source} (${record.courses.length} lines).`);
    if (likely.length) parts.push(`Likely equivalents filled in from the catalog, not confirmed by Illinois: ${likely.join(', ')}.`);
    if (open.length) parts.push(`Lines counted as hours only, with an Illinois course still to settle: ${open.join('; ')}.`);
  }
  if (prior.unmatchedCredits > 0) parts.push(`${prior.unmatchedCredits} hours count toward the total with no course code.`);
  if (residency) {
    parts.push(
      residency.ok
        ? `Residency (45 hours at Illinois, 21 at the 300 level or above) is met: ${residency.heldHours + residency.plannedHours} Illinois hours, ${residency.heldUpper + residency.plannedUpper} upper-level.`
        : residency.shortfall ?? '',
    );
  }
  return parts.length ? `Credit coming in: ${parts.join(' ')}` : 'Credit coming in: none recorded.';
}

let liteCache: { source: Course[]; lite: CatalogLite[] } | null = null;
/** The catalog in the matcher's shape, built once per catalog. */
function catalogLiteOf(catalog: Course[]): CatalogLite[] {
  if (liteCache && liteCache.source === catalog) return liteCache.lite;
  const lite = catalog.map((c) => ({
    code: normCode(c.code),
    title: c.title,
    credits: c.credits,
    level: Number(c.code.match(/\b(\d)\d\d[A-Z]?$/)?.[1] ?? 0) * 100,
    cluster: c.cluster,
    tags: c.tags,
  }));
  liteCache = { source: catalog, lite };
  return lite;
}

/**
 * Hours the student holds that no course code on the board carries: exam
 * credit granted by subject ("ECON 1--"), transcript lines counted as hours,
 * and the difference between what a transferred course earned and the
 * catalog hours of the Illinois course it counts as. An exam the student's
 * own record already lists as a test-credit line is not counted twice.
 */
function priorHoursOf(
  answers: OnboardingAnswers | null | undefined,
  exams: OnboardingAnswers['exams'],
  table: ExamCreditEntry[],
  creditsOf: (code: string) => number | null,
): number {
  const record = answers?.transcript ?? null;
  return (
    examElectiveHours(exams, table, transcriptIndirectCodes(record), creditsOf) +
    transcriptHours(record) +
    transcriptCreditAdjustment(record)
  );
}

function termOrd(season: SemesterSeason, year: number): number {
  return year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
}

/**
 * The horizon a build plans over: the student's own words, what they asked
 * ALMA for on top, and a start moved past a term they are taking now. One
 * function, so set_plan_shape checks a term against the range the build will
 * use rather than a copy of it.
 */
function horizonFor(answers: OnboardingAnswers | null | undefined, nowYear: number, shape: PlanShape): Horizon {
  const read = readHorizon(answers?.timeline ?? '', { season: 'Fall', year: nowYear });
  /**
   * A record with courses in progress in the plan's first term means the
   * student is taking that term now: those courses are counted as done, so
   * planning another full load in the same term books the term twice. The
   * plan starts the term after the last one in progress.
   */
  const busy = latestInProgressTerm(answers?.transcript);
  const startOrd = termOrd(read.startSeason, read.startYear);
  const horizon: Horizon = { ...read };
  // What the student asked ALMA for wins over what the About-you words said.
  if (shape.finish) {
    horizon.gradSeason = shape.finish.season;
    horizon.gradYear = shape.finish.year;
    horizon.stated = true;
  }
  // A term ALMA was told about replaces what About you said of the same term
  // ("it's a co-op, not abroad" changes what the term earns), and a plain
  // "Spring 2029" from ALMA keeps what About you said it was.
  const sameTerm = (a: { season: SemesterSeason; year: number }, b: { season: SemesterSeason; year: number }) => a.season === b.season && a.year === b.year;
  const said = horizon.away ?? [];
  horizon.away = [
    ...said.filter((a) => !shape.away.some((b) => sameTerm(a, b))),
    ...shape.away.map((a) => {
      const before = said.find((b) => sameTerm(a, b));
      return before && a.kind === undefined && a.credits === undefined ? { ...before, ...a } : a;
    }),
  ];
  horizon.summers = [...new Set([...(horizon.summers ?? []), ...shape.summers])];
  if (busy && termOrd(busy.season, busy.year) >= startOrd) {
    const next = busy.season === 'Fall' ? { season: 'Spring' as const, year: busy.year + 1 } : { season: 'Fall' as const, year: busy.year };
    horizon.startSeason = next.season;
    horizon.startYear = next.year;
    if (termOrd(horizon.gradSeason, horizon.gradYear) <= termOrd(next.season, next.year)) {
      horizon.gradSeason = 'Spring';
      horizon.gradYear = next.year + 4;
      horizon.stated = false;
    }
  }
  return horizon;
}

/** The latest term with a course the student is taking now, from their record. */
function latestInProgressTerm(record: TranscriptRecord | null | undefined): { season: SemesterSeason; year: number } | null {
  let best: { season: SemesterSeason; year: number } | null = null;
  for (const c of record?.courses ?? []) {
    if (!c.use || c.status !== 'in_progress') continue;
    const m = (normalizeTerm(c.term) ?? '').match(/^(Fall|Spring|Summer) (\d{4})$/);
    if (!m) continue;
    const t = { season: m[1] as SemesterSeason, year: Number(m[2]) };
    if (!best || termOrd(t.season, t.year) > termOrd(best.season, best.year)) best = t;
  }
  return best;
}

/** "About 45 credits", "I have 60 hours", "30 credit hours": what the student says they hold, or null. */
function statedHours(text: string): number | null {
  const m = text.match(/\b(\d{1,3})\s*(?:\+\s*)?(?:credit hours|credits|hours|hrs|cr)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 6 && n <= 150 ? n : null;
}

/** Gen-ed categories met by held credit that holds no Illinois course: transfer lines and exams. */
function genEdCreditsOf(
  answers: OnboardingAnswers | null | undefined,
  exams: OnboardingAnswers['exams'],
  table: ExamCreditEntry[],
  creditsOf: (code: string) => number | null,
): GenEdCredit[] {
  return [...transcriptGenEdCredits(answers?.transcript), ...examGenEdCredits(exams, table, creditsOf)];
}

function withGenEdCredit(
  prior: PriorCredit,
  answers: OnboardingAnswers | null | undefined,
  exams: OnboardingAnswers['exams'],
  table: ExamCreditEntry[],
  creditsOf: (code: string) => number | null,
): PriorCredit {
  const genEdCredits = genEdCreditsOf(answers, exams, table, creditsOf);
  return genEdCredits.length > 0 ? { ...prior, genEdCredits } : prior;
}
