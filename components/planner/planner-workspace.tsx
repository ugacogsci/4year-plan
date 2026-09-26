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

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import {
  FolderPlus,
  GripVertical,
  Moon,
  Plus,
  Save,
  Sun,
  Undo2,
  User,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BotLauncher, BotPanel } from './advisor';
import { CourseExplorer } from './course-explorer';
import { ElectivePools } from './elective-pools';
import { IssueBadge } from './issue-badge';
import { groupIssues, isTermIssue } from './plan-health';
import { SemesterColumn } from './semester-column';
import { StudentProfilePanel, type AreaRow } from './student-profile-panel';
import { ProgramPicker } from './program-picker';
import { EmphasisPicker, emphasisSelectionsComplete } from './emphasis-picker';
import {
  buildContext,
  loadFullIllinois,
  loadProgram,
  plannableProgram,
  readHorizon,
  readPriorCredit,
  useIllinoisCore,
  type LoadedProgram,
} from './illinois-source';
import {
  isUgaGraduateDegree,
  isUgaUndergraduateDegree,
  loadUgaProgram,
  ugaSelectionRequirements,
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
import { areaProgress, type ProgramRequirements } from '@/lib/planner/scheduler';
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
import type { Course, IssueSeverity, PlanIssue, PlanState, PlanTerm, SemesterSeason } from '@/lib/planner/types';
import {
  UNDECIDED_PROGRAM_ID,
  clearAnswers,
  schoolById,
  timelineForPlanning,
  type OnboardingAnswers,
  type ProgramLevel,
} from '@/lib/planner/onboarding';
import { normalizeCourseCode, transcriptCodes } from '@/lib/planner/transcript';
import { degreeCompletionIssue } from '@/lib/planner/completion';
import {
  PLANNER_THEME_STORAGE_KEY,
  readStoredTheme,
  type PlannerTheme,
} from '@/lib/planner/theme';
import { subjectMatches, subjectName } from '@/lib/planner/illinois-subjects';
import { TranscriptUpload } from './transcript-upload';
import { loadIllinoisCourseDetail } from '@/lib/planner/illinois-load';
import type { AdvisorExecutor } from '@/lib/planner/advisor';
import type { RequirementBlock } from '@/lib/planner/illinois-data';

const STORAGE_KEY = 'four-year-planner-v3';
const UNDECIDED_PROGRAM = {
  id: UNDECIDED_PROGRAM_ID,
  name: 'Undecided / exploring programs',
};

function openPlanThrough(
  horizon: {
    startSeason: SemesterSeason;
    startYear: number;
    gradSeason: SemesterSeason;
    gradYear: number;
  },
  completedCourseIds: string[],
): PlanState {
  const terms: PlanTerm[] = [];
  let season = horizon.startSeason;
  let year = horizon.startYear;
  for (let index = 0; index < 32; index += 1) {
    terms.push({
      id: `${year}-${season.toLowerCase()}`,
      label: `${season} ${year}`,
      year: Math.min(4, Math.floor(index / 2) + 1),
      season,
      courseIds: [],
    });
    if (season === horizon.gradSeason && year === horizon.gradYear) break;
    if (season === 'Fall') {
      season = 'Spring';
      year += 1;
    } else if (
      season === 'Spring' &&
      horizon.gradSeason === 'Summer' &&
      year === horizon.gradYear
    ) {
      season = 'Summer';
    } else {
      season = 'Fall';
    }
  }
  return {
    schemaVersion: 1,
    programId: UNDECIDED_PROGRAM_ID,
    graduationLabel: `${horizon.gradSeason} ${horizon.gradYear}`,
    completedCourseIds,
    terms,
  };
}

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


const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

interface ReplacementScope {
  /** Null means a true open elective; a set means stay inside this requirement. */
  codes: Set<string> | null;
  label: string;
}

function choiceCodes(block: RequirementBlock): Set<string> {
  const out = new Set<string>();
  if (block.rule.kind !== 'all' && block.rule.kind !== 'choose' && block.rule.kind !== 'pool') {
    return out;
  }
  for (const choice of block.rule.choices) {
    for (const code of [...choice.codes, ...choice.substitutes]) out.add(normCode(code));
  }
  return out;
}

/** The academically meaningful boundary around one replacement list. */
function replacementScope(input: {
  course: Course;
  blocks: RequirementBlock[];
  pools: PoolReport[];
  isOpenElective: boolean;
  isPrerequisite: boolean;
  catalog: Course[];
}): ReplacementScope {
  const code = normCode(input.course.code);
  if (input.isOpenElective) {
    return {
      codes: null,
      label: 'Any course that fits this term and still counts toward the degree total.',
    };
  }

  // A replacement also has to preserve downstream prerequisites. Until the
  // planner can re-solve those dependencies after a swap, do not offer a
  // same-area course that would make a later card invalid.
  if (input.isPrerequisite) {
    return {
      codes: new Set([code]),
      label: 'This course is needed as a prerequisite for another course in the plan.',
    };
  }

  const pool = input.pools.find((candidate) =>
    candidate.picked.some((picked) => normCode(picked) === code),
  );
  if (pool) {
    const block = input.blocks.find((candidate) => candidate.id === pool.requirementId);
    const codes = block ? choiceCodes(block) : new Set(
      [...pool.picked, ...pool.alternatives, ...pool.fromPriorCredit].map(normCode),
    );
    return { codes, label: `Courses published for ${pool.label}.` };
  }

  // An "all" row is the narrowest rule: only the alternatives printed on
  // that row can stand in for it. Check these before broader choose/pool lists.
  for (const block of input.blocks) {
    if (block.rule.kind !== 'all') continue;
    const row = block.rule.choices.find((choice) =>
      [...choice.codes, ...choice.substitutes].some((candidate) => normCode(candidate) === code),
    );
    if (!row) continue;
    return {
      codes: new Set([...row.codes, ...row.substitutes].map(normCode)),
      label: `Catalog-listed alternatives for ${block.label || block.areaLabel}.`,
    };
  }

  for (const block of input.blocks) {
    if (block.rule.kind !== 'choose' && block.rule.kind !== 'pool') continue;
    const codes = choiceCodes(block);
    if (codes.has(code)) {
      return { codes, label: `Courses published for ${block.label || block.areaLabel}.` };
    }
  }

  // General education choices are attached to an area rather than an
  // explicit course list. Courses tagged for the same area are the honest set.
  for (const block of input.blocks) {
    if (block.rule.kind !== 'gened') continue;
    if (!input.course.requirementIds.includes(block.areaId) &&
        !input.course.requirementIds.includes(block.id)) continue;
    const codes = input.catalog
      .filter((candidate) =>
        candidate.requirementIds.includes(block.areaId) || candidate.requirementIds.includes(block.id),
      )
      .map((candidate) => normCode(candidate.code));
    return { codes: new Set(codes), label: `Courses that fulfill ${block.label || block.areaLabel}.` };
  }

  if (input.course.pathwayRole === 'required') {
    return {
      codes: new Set([code]),
      label: 'This course is fixed by the published degree requirements.',
    };
  }

  return {
    codes: null,
    label: 'Other courses that fit this term and count toward the degree total.',
  };
}

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
  programIds?: string[];
  minorIds?: string[];
  certificateIds?: string[];
  emphasisSelections?: Record<string, string[]>;
  /** Kept so plans saved by the previous release still open. */
  programId: string | null;
  plan: PlanState;
  minimumTermCredits: number;
  /** Null, or absent on boards saved before the control existed, means balanced. */
  targetTermCredits?: number | null;
  careerInterests: string;
  plans?: PlanTab[];
  planGroups?: PlanGroup[];
  activePlanId?: string;
}

interface PlanTab {
  id: string;
  name: string;
  groupId: string;
  plan: PlanState;
  /** Cached so inactive alternatives retain their latest plan-wide status. */
  issueSeverity?: IssueSeverity | null;
}

interface PlanGroup {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_PLAN_GROUP: PlanGroup = {
  id: 'group-1',
  name: 'Group 1',
  color: '#7a8b9b',
};

const PLAN_GROUP_COLORS = [
  '#7a8b9b',
  '#b44d54',
  '#3f7f72',
  '#b08332',
  '#5b75a6',
  '#8564a8',
];

interface UndoSnapshot {
  plan: PlanState;
  alreadyTakenCourseCodes: string[];
}

type SourceProgram = LoadedProgram | UgaLoadedProgram;

/** One or more catalog degree pages presented to the planner as one board. */
interface LoadedBundle {
  summary: { id: string; name: string; totalCredits: number | null };
  program: ProgramRequirements;
  blocks: RequirementBlock[];
  sources: SourceProgram[];
  urls: Array<{ name: string; url: string }>;
  electiveHours?: number;
  fillToDegreeTotal?: boolean;
}

/** Campus-wide requirements a double major completes once, not once per page. */
function isSharedCoreArea(label: string): boolean {
  return (
    /general education|core curriculum/i.test(label) ||
    /^(?:i\. foundation courses|ii\. physical sciences|ii\. life sciences|iii\. quantitative reasoning|iv\. world languages|iv\. humanities|v\. social sciences)\b/i.test(label.trim())
  );
}

function combinePrograms(sources: SourceProgram[]): LoadedBundle | null {
  if (sources.length === 0) return null;
  const multiple = sources.length > 1;
  const names = sources.map((source) => source.program.name);
  const totalCredits = sources.reduce<number | null>((largest, source) => {
    const total = source.summary.totalCredits ?? source.program.totalCredits;
    if (total === null) return largest;
    return Math.max(largest ?? 0, total);
  }, null);
  const qualify = (source: SourceProgram, label: string) =>
    multiple ? `${source.program.name}: ${label}` : label;
  const blocks = sources.flatMap((source, sourceIndex) =>
    source.blocks
      .filter(
        (block) =>
          !multiple || (
            !(sourceIndex > 0 && (block.rule.kind === 'gened' || isSharedCoreArea(block.areaLabel))) &&
            (block.rule.kind !== 'hours' || block.rule.source !== 'explicit-elective')
          ),
      )
      .map((block) => ({
        ...block,
        areaLabel: qualify(source, block.areaLabel),
      })),
  );
  const program: ProgramRequirements = {
    id: sources.map((source) => source.program.id).join('+'),
    college: [...new Set(sources.map((source) => source.program.college))].join(' + '),
    degree: [...new Set(sources.map((source) => source.program.degree))].join(' + '),
    name: names.join(' + '),
    areas: sources.flatMap((source, sourceIndex) =>
      source.program.areas
        .filter(
          (area) =>
            !multiple || (
              !/^(?:general|free) electives?\b/i.test(area.label) &&
              !(sourceIndex > 0 && isSharedCoreArea(area.label))
            ),
        )
        .map((area) => ({
          ...area,
          label: qualify(source, area.label),
        })),
    ),
    totalCredits,
    areaHours: sources.reduce((sum, source) => sum + source.program.areaHours, 0),
  };
  const electiveHours = sources.reduce(
    (sum, source) => sum + ('electiveHours' in source ? source.electiveHours : 0),
    0,
  );
  return {
    summary: { id: program.id, name: program.name, totalCredits },
    program,
    blocks,
    sources,
    urls: sources.map((source) => ({ name: source.program.name, url: source.url })),
    // A second major replaces free-elective room rather than adding another
    // degree's full elective allowance. Leaving the cap undefined lets the
    // combined requirements fill naturally to the shared degree total.
    electiveHours: multiple ? undefined : electiveHours,
    fillToDegreeTotal:
      sources.some(
        (source) => 'fillToDegreeTotal' in source && source.fillToDegreeTotal,
      ),
  };
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
  const programLevel: ProgramLevel = answers?.programLevel ?? 'undergraduate';
  const isGraduatePlan = isUga && programLevel === 'graduate';
  const defaultMinimumTermCredits = isGraduatePlan ? 9 : 12;
  const defaultTargetTermCredits = isGraduatePlan ? 9 : null;
  const isCatalogSchool = isIllinois || isUga;
  const { status: illinoisStatus, core } = useIllinoisCore(Boolean(isIllinois));
  const { status: ugaStatus, data: uga } = useUgaData(Boolean(isUga));
  const status = isIllinois ? illinoisStatus : isUga ? ugaStatus : 'unavailable';
  /**
   * The AP and IB credit the registrar grants, so the plan starts where the
   * student starts. Naming the exams in onboarding and then planning as if they
   * had not happened is the same bug as ignoring a transcript.
   */
  const examCredit = useExamCredit(school);

  const [plan, setPlan] = useState<PlanState | null>(null);
  const [planTabs, setPlanTabs] = useState<PlanTab[]>([]);
  const [planGroups, setPlanGroups] = useState<PlanGroup[]>([{ ...DEFAULT_PLAN_GROUP }]);
  const [draggingPlanTabId, setDraggingPlanTabId] = useState<string | null>(null);
  const [dragOverPlanGroupId, setDragOverPlanGroupId] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState('plan-1');
  const [termWidths, setTermWidths] = useState<Record<string, number>>({});
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [programIds, setProgramIds] = useState<string[]>(() => answers?.programIds ?? []);
  const [minorIds, setMinorIds] = useState<string[]>(() => answers?.minorIds ?? []);
  const [certificateIds, setCertificateIds] = useState<string[]>(() => answers?.certificateIds ?? []);
  const programId = programIds[0] ?? null;
  const isUndecided = programIds.includes(UNDECIDED_PROGRAM_ID);
  const emphasisKey = JSON.stringify(
    Object.entries(answers?.emphasisSelections ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  const selectedProgramIds = useMemo(
    () => [...programIds, ...minorIds, ...certificateIds],
    [programIds, minorIds, certificateIds],
  );
  const programKey = [
    `level:${programLevel}`,
    `degree:${programIds.join(',')}`,
    `minor:${minorIds.join(',')}`,
    `certificate:${certificateIds.join(',')}`,
    `emphasis:${emphasisKey}`,
  ].join('|');
  /**
   * The degree page, tagged with the degree it belongs to.
   *
   * The id travels with the value so that a render between "the student picked
   * a new degree" and "its page finished loading" cannot hand the previous
   * degree's requirements to the board, and so that "still loading" is a
   * comparison rather than a second piece of state set inside an effect.
   */
  const [fetched, setFetched] = useState<{
    key: string;
    value: LoadedBundle | null;
  } | null>(null);
  const [planNotes, setPlanNotes] = useState<string[]>([]);
  const [report, setReport] = useState<PlanReport | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [focusTermId, setFocusTermId] = useState<string | null>(null);
  const [targetTermId, setTargetTermId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [finderOpen, setFinderOpen] = useState(false);
  const [mapHeight, setMapHeight] = useState<number | null>(null);
  /** The guide opens beside the board when there is room, never over it on arrival. */
  const [chatOpen, setChatOpen] = useState(false);
  const [theme, setTheme] = useState<PlannerTheme>(readStoredTheme);
  const botName = school?.bot ?? 'Assistant';
  const [dragUsable, setDragUsable] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [minimumTermCredits, setMinimumTermCredits] = useState(
    defaultMinimumTermCredits,
  );
  /** The elective slot being chosen for, if any. Drives the finder's list. */
  const [chooser, setChooser] = useState<{ termId: string; courseId: string } | null>(null);
  const [chooserOnMap, setChooserOnMap] = useState(false);
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
  const [targetTermCredits, setTargetTermCredits] = useState<number | null>(
    defaultTargetTermCredits,
  );
  const [careerInterests, setCareerInterests] = useState(answers?.after ?? '');
  const [status_, setStatus] = useState('');
  const restored = useRef<Stored | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const lastBucket = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.plannerTheme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(PLANNER_THEME_STORAGE_KEY, theme);
    return () => {
      delete document.documentElement.dataset.plannerTheme;
      document.documentElement.style.colorScheme = '';
    };
  }, [theme]);

  /**
   * The finder stays present at every useful width. The layout alone decides
   * whether progress and chat are columns or drawers, so resizing cannot strand
   * the map or leave a hidden side panel without a matching button.
   *
   * Only a change of bucket moves it. Setting it on every resize event would
   * reopen a finder the student had just closed, or shut one they had just
   * opened, every time the window moved a pixel.
   */
  useEffect(() => {
    const bucketOf = (w: number) => (w >= 1280 ? 'wide' : w > 1180 ? 'medium' : 'narrow');
    const measure = () => {
      const bucket = bucketOf(window.innerWidth);
      const firstMeasure = lastBucket.current === null;
      setDragUsable(window.innerWidth >= 700);
      if (bucket === lastBucket.current) return;
      lastBucket.current = bucket;
      // Keep the map open when it is part of the page. At compact widths it is
      // still the first block in the center flow rather than a side overlay.
      if (firstMeasure || bucket === 'wide' || bucket === 'medium') setFinderOpen(true);
      if (firstMeasure && (bucket === 'wide' || bucket === 'medium')) {
        setChatOpen(true);
        setRailOpen(true);
      }
      // An overlay on top of the board is not somewhere to leave a panel the
      // student did not ask for.
      if (bucket === 'narrow') {
        setChatOpen(false);
        setRailOpen(false);
      }
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
      return [UNDECIDED_PROGRAM, ...(core?.programs ?? [])
        .filter(plannableProgram)
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name))];
    }
    if (isUga) {
      return [UNDECIDED_PROGRAM, ...(uga?.programs ?? [])
        .filter((program) =>
          programLevel === 'graduate'
            ? isUgaGraduateDegree(program)
            : isUgaUndergraduateDegree(program),
        )
        .map((program) => ({ id: program.id, name: program.name }))
        .sort((left, right) => left.name.localeCompare(right.name))];
    }
    return samplePrograms.map((p) => ({ id: p.id, name: `${p.name}, ${p.degree}` }));
  }, [isIllinois, isUga, core, uga, programLevel]);

  const minorOptions = useMemo(
    () =>
      isUga && !isGraduatePlan
        ? (uga?.programs ?? [])
            .filter((program) => program.degree === 'MINOR' && program.areaHours > 0)
            .map((program) => ({ id: program.id, name: program.name }))
        : [],
    [isUga, isGraduatePlan, uga],
  );
  const certificateOptions = useMemo(
    () =>
      isUga
        ? (uga?.programs ?? [])
            .filter(
              (program) =>
                program.degree === (isGraduatePlan ? 'CERT-GM' : 'CERT-UG') &&
                program.areaHours > 0,
            )
            .map((program) => ({ id: program.id, name: program.name }))
        : [],
    [isUga, isGraduatePlan, uga],
  );
  const emphasisRequirements = useMemo(
    () =>
      isUga
        ? (uga?.programs ?? [])
            .filter((program) => programIds.includes(program.id))
            .flatMap(ugaSelectionRequirements)
        : [],
    [isUga, uga, programIds],
  );
  const emphasesComplete = emphasisSelectionsComplete(
    emphasisRequirements,
    answers?.emphasisSelections ?? {},
  );

  const resetProgramPlan = useCallback(() => {
    setFetched(null);
    setPlan(null);
    setReport(null);
    setPlanNotes([]);
    setPlanTabs([]);
    setPlanGroups([{ ...DEFAULT_PLAN_GROUP }]);
    setDraggingPlanTabId(null);
    setDragOverPlanGroupId(null);
    setActivePlanId('plan-1');
    setTermWidths({});
  }, []);

  const changeProgramLevel = useCallback(
    (nextLevel: ProgramLevel) => {
      if (nextLevel === programLevel) return;
      const nextProgramIds = [UNDECIDED_PROGRAM_ID];
      setProgramIds(nextProgramIds);
      setMinorIds([]);
      setCertificateIds([]);
      setMinimumTermCredits(nextLevel === 'graduate' ? 9 : 12);
      setTargetTermCredits(nextLevel === 'graduate' ? 9 : null);
      resetProgramPlan();
      if (answers && onAnswersChange) {
        onAnswersChange({
          ...answers,
          programLevel: nextLevel,
          programIds: nextProgramIds,
          minorIds: [],
          certificateIds: [],
          emphasisSelections: {},
          collegeId: '',
        });
      }
    },
    [answers, onAnswersChange, programLevel, resetProgramPlan],
  );

  const changePrograms = useCallback((ids: string[]) => {
    let next = ids;
    if (next.length === 0) next = [UNDECIDED_PROGRAM_ID];
    else if (next.includes(UNDECIDED_PROGRAM_ID) && next.length > 1) {
      next = programIds.includes(UNDECIDED_PROGRAM_ID)
        ? next.filter((id) => id !== UNDECIDED_PROGRAM_ID)
        : [UNDECIDED_PROGRAM_ID];
    }
    setProgramIds(next);
    resetProgramPlan();
    if (answers && onAnswersChange) {
      const selected = new Set(next);
      const emphasisSelections = Object.fromEntries(
        Object.entries(answers.emphasisSelections).filter(([key]) =>
          [...selected].some((id) => key.startsWith(`${id}::`)),
        ),
      );
      onAnswersChange({ ...answers, programIds: next, emphasisSelections });
    }
  }, [answers, onAnswersChange, programIds, resetProgramPlan]);

  const changeMinors = useCallback((ids: string[]) => {
    setMinorIds(ids);
    resetProgramPlan();
    if (answers && onAnswersChange) onAnswersChange({ ...answers, minorIds: ids });
  }, [answers, onAnswersChange, resetProgramPlan]);

  const changeCertificates = useCallback((ids: string[]) => {
    setCertificateIds(ids);
    resetProgramPlan();
    if (answers && onAnswersChange) onAnswersChange({ ...answers, certificateIds: ids });
  }, [answers, onAnswersChange, resetProgramPlan]);

  const changeEmphases = useCallback((emphasisSelections: Record<string, string[]>) => {
    resetProgramPlan();
    if (answers && onAnswersChange) onAnswersChange({ ...answers, emphasisSelections });
  }, [answers, onAnswersChange, resetProgramPlan]);

  const replaceActivePlan = useCallback((next: PlanState) => {
    setPlan(next);
    setPlanTabs((current) => {
      if (current.length === 0) {
        return [{ id: activePlanId, name: 'Plan 1', groupId: DEFAULT_PLAN_GROUP.id, plan: next }];
      }
      return current.map((candidate) =>
        candidate.id === activePlanId ? { ...candidate, plan: next } : candidate,
      );
    });
  }, [activePlanId]);

  // ---- restore -------------------------------------------------------------

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      if (parsed.schemaVersion !== 3 || !isPlanState(parsed.plan)) return;
      if (parsed.schoolId !== (school?.id ?? '')) return;
      const savedProgramIds = Array.isArray(parsed.programIds) && parsed.programIds.length > 0
        ? parsed.programIds
        : parsed.programId
          ? [parsed.programId]
          : [];
      const savedMinorIds = Array.isArray(parsed.minorIds) ? parsed.minorIds : [];
      const savedCertificateIds = Array.isArray(parsed.certificateIds) ? parsed.certificateIds : [];
      const savedEmphasisKey = JSON.stringify(
        Object.entries(parsed.emphasisSelections ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      );
      if (
        savedProgramIds.join('|') !== programIds.join('|') ||
        savedMinorIds.join('|') !== minorIds.join('|') ||
        savedCertificateIds.join('|') !== certificateIds.join('|') ||
        savedEmphasisKey !== emphasisKey
      ) return;
      restored.current = parsed as Stored;
      /**
       * Set here and not derived, because localStorage cannot be read while
       * rendering: the server renders without it and the first client render
       * has to match. This runs once per school and seeds three fields the
       * student then owns, so the cascade the compiler warns about is one
       * extra render on arrival and never again.
       */
      // oxlint-disable-next-line react/react-compiler
      setMinimumTermCredits(
        parsed.minimumTermCredits ?? defaultMinimumTermCredits,
      );
      setTargetTermCredits(
        'targetTermCredits' in parsed
          ? parsed.targetTermCredits ?? null
          : defaultTargetTermCredits,
      );
      if (parsed.careerInterests) setCareerInterests(parsed.careerInterests);
    } catch {
      /* a corrupt entry is not worth failing the app over; a fresh plan follows */
    }
  }, [
    school,
    programKey,
    programIds,
    minorIds,
    certificateIds,
    emphasisKey,
    defaultMinimumTermCredits,
    defaultTargetTermCredits,
  ]);

  // ---- load the explicitly selected degree pages ---------------------------

  useEffect(() => {
    if (programIds.length === 0) return;
    if (isUndecided) return;
    if (isUga && !emphasesComplete) return;
    if (isUga && uga) {
      const selected = selectedProgramIds
        .map((id) => uga.programs.find((candidate) => candidate.id === id))
        .filter((program): program is NonNullable<typeof program> => Boolean(program));
      const sources = selected.map((program, index) =>
        loadUgaProgram(uga, program, {
          resetRequirements: index === 0,
          emphasisSelections: answers?.emphasisSelections,
        }),
      );
      // oxlint-disable-next-line react/react-compiler
      setFetched({ key: programKey, value: sources.length === selectedProgramIds.length ? combinePrograms(sources) : null });
      return;
    }
    if (!isIllinois || !core) return;
    const summaries = programIds
      .map((id) => (core.programs ?? []).find((candidate) => candidate.id === id))
      .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
    for (const course of core.index) {
      course.requirementIds = [];
      course.pathwayRole = undefined;
    }
    let cancelled = false;
    void Promise.all(summaries.map((summary) => loadProgram(core, summary))).then((results) => {
      if (cancelled) return;
      const sources = results.filter((result): result is LoadedProgram => Boolean(result));
      setFetched({
        key: programKey,
        value:
          summaries.length === programIds.length && sources.length === programIds.length
            ? combinePrograms(sources)
            : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isIllinois, isUga, isUndecided, core, uga, programIds, selectedProgramIds, programKey, emphasisKey, answers?.emphasisSelections, emphasesComplete]);

  const loaded = fetched?.key === programKey ? fetched.value : null;
  const programBusy = Boolean(isCatalogSchool && programIds.length > 0 && !isUndecided) && fetched?.key !== programKey;

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
      replaceActivePlan(sample);
      setPlanNotes([]);
      setReport(null);
      setTargetTermId(sample.terms[0]?.id ?? '');
      // The demo plan names its own program. Without this the rail reads
      // "No degree chosen" above a board full of that degree's courses.
      setProgramIds((current) => current.length > 0 ? current : [sample.programId]);
      return;
    }
    if (!context) return;

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
      [
        ...examCourses(answers?.exams ?? [], examCredit.entries),
        ...transcriptCodes(answers?.transcript),
        ...(answers?.alreadyTakenCourseCodes ?? []),
      ],
      Boolean(answers?.transcript),
      examElectiveHours(answers?.exams ?? [], examCredit.entries),
    );
    const term = core?.meta?.term;
    const horizon = readHorizon(answers ? timelineForPlanning(answers) : '', {
      season: 'Fall',
      year: term?.year ?? new Date().getFullYear(),
    });

    if (isUndecided) {
      const completedCourseIds = prior.courseCodes
        .map((code) => byCode.get(normCode(code))?.id)
        .filter((id): id is string => Boolean(id));
      const openPlan = openPlanThrough(horizon, completedCourseIds);
      replaceActivePlan(openPlan);
      setChooser(null);
      setChooserOnMap(false);
      setTargetTermId(openPlan.terms[0]?.id ?? '');
      setPlanNotes([
        'This is an open plan because no degree program is selected. Add courses from the map, or choose a program in Preferences to rebuild against published requirements.',
      ]);
      setReport(null);
      setUndoStack([]);
      setStatus('Open plan built. Choose courses from the map or select a degree program in Preferences.');
      return;
    }

    if (!loaded) return;

    let generated: GeneratedPlan;
    try {
      generated = generatePlan({
        requirements: loaded.blocks,
        context,
        prior,
        horizon,
        preferences: { creditsPerTerm: { min: minimumTermCredits, target: targetTermCredits, max: 18 } },
        programId: loaded.summary.id,
        // The published total is what the plan must reach; the blocks alone
        // name 82 of Finance's 124 credits. The student's own words rank the
        // electives that fill the rest.
        degreeTotal:
          loaded.summary.totalCredits ?? loaded.program.totalCredits ?? null,
        electiveHoursLimit:
          isUga && 'electiveHours' in loaded ? loaded.electiveHours : undefined,
        fillToDegreeTotal:
          isUga && 'fillToDegreeTotal' in loaded
            ? loaded.fillToDegreeTotal
            : undefined,
        interests: [
          loaded.program.name,
          answers?.studying ?? '',
          answers?.after ?? '',
          careerInterests,
        ].join(' '),
        programName: loaded.program.name,
        standingHours: isGraduatePlan
          ? { freshman: 0, sophomore: 0, junior: 0, senior: 0 }
          : undefined,
        electiveLevelRange: isGraduatePlan
          ? { min: 600, maxExclusive: 1000 }
          : undefined,
        autoPrerequisiteLevelRange: isGraduatePlan
          ? { min: 600, maxExclusive: 1000 }
          : undefined,
      });
    } catch (error) {
      console.error('Could not generate plan', error);
      setStatus(
        `The draft could not be generated: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return;
    }

    replaceActivePlan(generated.plan);
    setChooser(null);
    setChooserOnMap(false);
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
    const needsAttention =
      generated.notPlaced.length > 0 ||
      generated.unsatisfied.some(
        (row) =>
          row.reason !== 'filled-by-electives' && row.reason !== 'not-parsed',
      );
    setStatus(
      needsAttention
        ? 'Draft built. Review the items that still need attention.'
        : 'Plan built. Nothing needs attention.',
    );
  }, [
    isCatalogSchool,
    isUga,
    isGraduatePlan,
    isUndecided,
    core,
    context,
    loaded,
    answers,
    byCode,
    minimumTermCredits,
    targetTermCredits,
    examCredit,
    careerInterests,
    replaceActivePlan,
  ]);

  useEffect(() => {
    if (plan) return;
    // A saved board wins over a fresh generation, but only for this school.
    if (restored.current) {
      const saved = restored.current;
      restored.current = null;
      const rawSavedPlans = (saved.plans ?? []).filter(
        (candidate) =>
          candidate &&
          typeof candidate.id === 'string' &&
          typeof candidate.name === 'string' &&
          isPlanState(candidate.plan),
      );
      const savedGroups = (saved.planGroups ?? []).filter(
        (candidate) =>
          candidate &&
          typeof candidate.id === 'string' &&
          typeof candidate.name === 'string' &&
          typeof candidate.color === 'string' &&
          /^#[0-9a-f]{6}$/i.test(candidate.color),
      );
      const restoredGroups = savedGroups.length > 0
        ? savedGroups
        : [{ ...DEFAULT_PLAN_GROUP }];
      const restoredGroupIds = new Set(restoredGroups.map((group) => group.id));
      const fallbackGroupId = restoredGroups[0].id;
      const savedPlans = rawSavedPlans.map((candidate) => ({
        ...candidate,
        groupId:
          typeof candidate.groupId === 'string' && restoredGroupIds.has(candidate.groupId)
            ? candidate.groupId
            : fallbackGroupId,
      }));
      const activeId = savedPlans.some(
        (candidate) => candidate.id === saved.activePlanId,
      )
        ? (saved.activePlanId as string)
        : savedPlans[0]?.id ?? 'plan-1';
      const activePlan =
        savedPlans.find((candidate) => candidate.id === activeId)?.plan ??
        saved.plan;
      setPlanTabs(
        savedPlans.length > 0
          ? savedPlans
          : [{ id: activeId, name: 'Plan 1', groupId: fallbackGroupId, plan: activePlan }],
      );
      setPlanGroups(restoredGroups);
      setActivePlanId(activeId);
      setPlan(activePlan);
      setTargetTermId(activePlan.terms[0]?.id ?? '');
      setStatus('Your saved plan, restored from this device.');
      return;
    }
    if (!isCatalogSchool || (context && (loaded || isUndecided))) buildPlan();
  }, [plan, isCatalogSchool, isUndecided, context, loaded, buildPlan]);

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

  const completedCourses = useMemo(
    () =>
      (plan?.completedCourseIds ?? [])
        .map((id) => courseIndex.get(id))
        .filter((course): course is Course => Boolean(course))
        .map((course) => ({ code: course.code, title: course.title })),
    [plan, courseIndex],
  );

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

  /** The degree on screen, from whichever source this school has. */
  const activeProgramName =
    loaded?.program.name ??
    (programIds
        .map((id) => programOptions.find((program) => program.id === id)?.name)
        .filter((name): name is string => Boolean(name))
        .join(' + ') || null);
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
    const progress = areaProgress(
      loaded.program,
      have,
      context?.equivalents,
      { allowCrossAreaOverlap: isUga },
    );
    if (!isUga) return progress;

    // UGA's General Electives row is the degree credit left after the named
    // areas have claimed their capped hours. That includes editable elective
    // cards and the extra hour of a four-credit course filling a three-credit
    // area. Counting only cards labelled "elective" understated this row even
    // when the board had reached the published degree total.
    const namedCredits = progress
      .filter((row) => !/^(?:general|free) electives?\b/i.test(row.area.label))
      .reduce((sum, row) => sum + row.earned, 0);
    const unassignedCredits = Math.max(0, credits.total.min - namedCredits);
    return progress.map((row) => {
      if (!/^(?:general|free) electives?\b/i.test(row.area.label)) return row;
      const earned = Math.min(row.area.hours, unassignedCredits);
      return {
        ...row,
        earned,
        percent: row.area.hours
          ? Math.round((earned / row.area.hours) * 100)
          : 0,
        satisfied: row.area.hours > 0 && earned >= row.area.hours,
      };
    });
  }, [
    loaded,
    plan,
    completedCodes,
    courseIndex,
    isUga,
    context?.equivalents,
    credits.total.min,
  ]);

  /**
   * The review list follows the edited board, not only the generation report.
   * A plan may be valid when generated and stop being valid after a course is
   * removed or replaced, so the first red row gives the overall consequence
   * before the specific prerequisite and requirement details below it.
   */
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
    const currentCredits = context ? credits.total.min : getPlanCredits(plan, catalog).total;
    const incompleteAreas = areas.filter((row) => row.area.hours > 0 && !row.satisfied);
    const incompletePools = pools.filter(
      (pool) =>
        (pool.hoursTarget !== null && pool.hours < pool.hoursTarget) ||
        (pool.countTarget !== null && pool.count < pool.countTarget),
    );
    const completionIssue = degreeCompletionIssue({
      currentCredits,
      requiredCredits: activeProgramTotal,
      incompleteRequirementNames: [
        ...incompleteAreas.map((row) => row.area.label).filter(Boolean),
        ...incompletePools.map((pool) => pool.label).filter(Boolean),
      ],
      termId: plan.terms[0]?.id ?? '',
    });
    return [completionIssue, ...rows]
      .filter((issue): issue is PlanIssue => Boolean(issue))
      .map((issue) => ({ ...issue, message: withCourseCodes(issue.message) }));
  }, [
    plan,
    context,
    isUga,
    unmet,
    minimumTermCredits,
    catalog,
    credits.total.min,
    activeProgramTotal,
    areas,
    pools,
  ]);

  const planWideIssues = useMemo(
    () => groupIssues(issues.filter((issue) => !issue.courseId && !isTermIssue(issue))),
    [issues],
  );
  const planWideSeverity = planWideIssues[0]?.severity ?? null;
  const tabIssueSeverity = (candidate: PlanTab) =>
    candidate.id === activePlanId ? planWideSeverity : (candidate.issueSeverity ?? null);

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
   * with their codes and titles. Code matches first, because a student who typed "ACCY 3" wants
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

  const selectedCourse = selectedCourseId ? courseIndex.get(selectedCourseId) : undefined;

  // ---- plan edits -----------------------------------------------------------

  const clonePlan = (source: PlanState): PlanState => ({
    ...source,
    completedCourseIds: [...source.completedCourseIds],
    terms: source.terms.map((term) => ({
      ...term,
      courseIds: [...term.courseIds],
    })),
  });

  function switchPlanTab(id: string) {
    if (id === activePlanId) return;
    const target = planTabs.find((candidate) => candidate.id === id);
    if (!target) return;
    setPlanTabs((current) =>
      current.map((candidate) =>
        candidate.id === activePlanId && plan
          ? { ...candidate, plan, issueSeverity: planWideSeverity }
          : candidate,
      ),
    );
    setActivePlanId(id);
    setPlan(target.plan);
    setUndoStack([]);
    setSelectedCourseId(null);
    setFocusTermId(null);
    setTargetTermId(target.plan.terms[0]?.id ?? '');
    setStatus(`${target.name} is open.`);
  }

  function duplicatePlanTab(groupId?: string) {
    if (!plan) return;
    const used = new Set(planTabs.map((candidate) => candidate.name));
    let number = planTabs.length + 1;
    while (used.has(`Plan ${number}`)) number += 1;
    const copy = clonePlan(plan);
    const id = `plan-${Date.now().toString(36)}-${number}`;
    const destinationGroupId = groupId ??
      planTabs.find((candidate) => candidate.id === activePlanId)?.groupId ??
      planGroups[0]?.id ??
      DEFAULT_PLAN_GROUP.id;
    setPlanTabs((current) => [
      ...current.map((candidate) =>
        candidate.id === activePlanId
          ? { ...candidate, plan, issueSeverity: planWideSeverity }
          : candidate,
      ),
      {
        id,
        name: `Plan ${number}`,
        groupId: destinationGroupId,
        plan: copy,
        issueSeverity: planWideSeverity,
      },
    ]);
    setActivePlanId(id);
    setPlan(copy);
    setUndoStack([]);
    setSelectedCourseId(null);
    setStatus(`Plan ${number} created from the current plan.`);
  }

  function createPlanGroup() {
    if (!plan) return;
    const used = new Set(planGroups.map((group) => group.name));
    let number = planGroups.length + 1;
    while (used.has(`Group ${number}`)) number += 1;
    const group: PlanGroup = {
      id: `group-${Date.now().toString(36)}-${number}`,
      name: `Group ${number}`,
      color: PLAN_GROUP_COLORS[planGroups.length % PLAN_GROUP_COLORS.length],
    };
    setPlanGroups((current) => [...current, group]);
    duplicatePlanTab(group.id);
  }

  function renamePlanTab(id: string, name: string) {
    setPlanTabs((current) =>
      current.map((candidate) => candidate.id === id ? { ...candidate, name } : candidate),
    );
  }

  function renamePlanGroup(id: string, name: string) {
    setPlanGroups((current) =>
      current.map((group) => group.id === id ? { ...group, name } : group),
    );
  }

  function recolorPlanGroup(id: string, color: string) {
    setPlanGroups((current) =>
      current.map((group) => group.id === id ? { ...group, color } : group),
    );
  }

  function movePlanTabToGroup(tabId: string, targetGroupId: string) {
    const moving = planTabs.find((candidate) => candidate.id === tabId);
    if (!moving || moving.groupId === targetGroupId) return;
    const sourceGroupId = moving.groupId;
    const next = planTabs.filter((candidate) => candidate.id !== tabId);
    next.push({
      ...moving,
      groupId: targetGroupId,
      plan: moving.id === activePlanId && plan ? plan : moving.plan,
    });
    setPlanTabs(next);
    if (!next.some((candidate) => candidate.groupId === sourceGroupId)) {
      setPlanGroups((current) => current.filter((group) => group.id !== sourceGroupId));
    }
    const targetName = planGroups.find((group) => group.id === targetGroupId)?.name ?? 'the group';
    setStatus(`${moving.name} moved to ${targetName}.`);
  }

  function movePlanTabToAdjacentGroup(tabId: string, direction: -1 | 1) {
    const moving = planTabs.find((candidate) => candidate.id === tabId);
    if (!moving) return;
    const sourceIndex = planGroups.findIndex((group) => group.id === moving.groupId);
    const target = planGroups[sourceIndex + direction];
    if (target) movePlanTabToGroup(tabId, target.id);
  }

  function closePlanTab(id: string) {
    if (planTabs.length <= 1) return;
    const index = planTabs.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    const remaining = planTabs.filter((candidate) => candidate.id !== id);
    setPlanTabs(remaining);
    const remainingGroupIds = new Set(remaining.map((candidate) => candidate.groupId));
    setPlanGroups((current) => current.filter((group) => remainingGroupIds.has(group.id)));
    if (id !== activePlanId) return;
    const next = remaining[Math.min(index, remaining.length - 1)];
    setActivePlanId(next.id);
    setPlan(next.plan);
    setUndoStack([]);
    setSelectedCourseId(null);
    setTargetTermId(next.plan.terms[0]?.id ?? '');
    setStatus(`${next.name} is open.`);
  }

  function resizeTerm(termId: string, width: number) {
    setTermWidths((current) =>
      current[termId] === width ? current : { ...current, [termId]: width },
    );
  }

  function commit(next: PlanState, nextAlreadyTakenCourseCodes?: string[]) {
    if (!plan) return;
    setUndoStack((current) => [
      ...current.slice(-19),
      { plan, alreadyTakenCourseCodes: answers?.alreadyTakenCourseCodes ?? [] },
    ]);
    replaceActivePlan(next);
    if (nextAlreadyTakenCourseCodes && answers && onAnswersChange) {
      onAnswersChange({ ...answers, alreadyTakenCourseCodes: nextAlreadyTakenCourseCodes });
    }
  }

  function markCourseCompleted(courseId: string, termId: string) {
    if (!plan) return;
    const course = courseIndex.get(courseId);
    if (!course) return;
    const completedCodes = [...new Set([
      ...(answers?.alreadyTakenCourseCodes ?? []),
      course.code,
    ])];
    commit(
      {
        ...plan,
        completedCourseIds: plan.completedCourseIds.includes(courseId)
          ? plan.completedCourseIds
          : [...plan.completedCourseIds, courseId],
        terms: plan.terms.map((term) => ({
          ...term,
          courseIds: term.courseIds.filter((id) => id !== courseId),
        })),
      },
      completedCodes,
    );
    setSelectedCourseId(null);
    setFocusTermId(null);
    setStatus(
      `${course.code} is now already taken. It was removed from ${plan.terms.find((term) => term.id === termId)?.label ?? 'the schedule'} and still counts toward your requirements.`,
    );
  }

  function addCourse(courseId: string, termId: string) {
    if (!plan) return;
    const course = courseIndex.get(courseId);
    if (!course) return;
    if (plannedCourseIds.has(courseId) || plan.completedCourseIds.includes(courseId)) {
      setStatus(`${course.code} is already in the plan.`);
      return;
    }
    const asCompleted = termId === 'completed';
    commit(
      asCompleted
        ? { ...plan, completedCourseIds: [...plan.completedCourseIds, courseId] }
        : {
            ...plan,
            terms: plan.terms.map((term) =>
              term.id === termId ? { ...term, courseIds: [...term.courseIds, courseId] } : term,
            ),
      },
      asCompleted
        ? [...new Set([...(answers?.alreadyTakenCourseCodes ?? []), course.code])]
        : undefined,
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
   * Eligible replacements for one card. First establish which published
   * requirement the card is filling, then apply the term's prerequisite,
   * offering, standing, duplicate-credit and already-planned checks.
   */
  const chooserData = useMemo((): { label: string; options: Course[] } | null => {
    if (!chooser || !plan || !context || !loaded) return null;
    const oldCourse = courseIndex.get(chooser.courseId);
    if (!oldCourse) return null;
    const isPrerequisite = plan.terms.some((term) =>
      term.courseIds.some((id) => courseIndex.get(id)?.prerequisites.includes(oldCourse.id)),
    );
    const scope = replacementScope({
      course: oldCourse,
      blocks: loaded.blocks,
      pools,
      isOpenElective: electiveOf.get(oldCourse.id)?.kind === 'elective',
      isPrerequisite,
      catalog,
    });
    const prior = readPriorCredit(
      answers?.transferText ?? '',
      answers?.exams.length ?? 0,
      byCode,
      [
        ...examCourses(answers?.exams ?? [], examCredit.entries),
        ...transcriptCodes(answers?.transcript),
        ...(answers?.alreadyTakenCourseCodes ?? []),
      ],
      Boolean(answers?.transcript),
      examElectiveHours(answers?.exams ?? [], examCredit.entries),
    );
    const planWithoutCourse: PlanState = {
      ...plan,
      terms: plan.terms.map((term) =>
        term.id === chooser.termId
          ? { ...term, courseIds: term.courseIds.filter((id) => id !== chooser.courseId) }
          : term,
      ),
    };
    const options = electiveOptions({
      context,
      requirements: loaded.blocks,
      plan: planWithoutCourse,
      termId: chooser.termId,
      prior,
      // Replacements are constrained by the requirement and term. Career text
      // influences the next generated plan, but should not rescore an already
      // open chooser while the student is editing that text.
      interests: [answers?.studying ?? '', answers?.after ?? ''].join(' '),
      programName: loaded.program.name,
      standingHours: isGraduatePlan
        ? { freshman: 0, sophomore: 0, junior: 0, senior: 0 }
        : undefined,
      electiveLevelRange: isGraduatePlan
        ? { min: 600, maxExclusive: 1000 }
        : undefined,
      candidateCodes: scope.codes ?? undefined,
      limit: scope.codes === null ? catalog.length : Math.max(800, scope.codes.size),
    })
      .filter((option) => normCode(option.code) !== normCode(oldCourse.code))
      .filter((option) => scope.codes === null || scope.codes.has(normCode(option.code)))
      .map((option) => byCode.get(normCode(option.code)))
      .filter((course): course is Course => Boolean(course));
    return { label: scope.label, options };
  }, [
    chooser,
    plan,
    context,
    loaded,
    courseIndex,
    pools,
    electiveOf,
    catalog,
    answers,
    byCode,
    examCredit,
    isGraduatePlan,
  ]);

  const chooserOptions = chooserData?.options ?? [];
  const replacementCourseIds = useMemo(
    () => new Set((chooserOnMap ? chooserData?.options ?? [] : []).map((course) => course.id)),
    [chooserData, chooserOnMap],
  );

  function prepareReplacement(courseId: string, termId: string) {
    setChooser({ termId, courseId });
    setChooserOnMap(false);
  }

  function openChooser(courseId: string, termId: string) {
    prepareReplacement(courseId, termId);
    setSearchQuery('');
    setChooserOnMap(true);
    setFinderOpen(true);
  }

  function showReplacementCourse(courseId: string) {
    const course = courseIndex.get(courseId);
    if (!course) return;
    setSelectedCourseId(courseId);
    setSearchQuery(course.code);
    setChooserOnMap(true);
    setFinderOpen(true);
  }

  function showReplacements() {
    setSearchQuery('');
    setChooserOnMap(true);
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
    // A true open-elective card remains an open-elective card after a swap.
    if (oldCourse && electiveOf.get(oldCourse.id)?.kind === 'elective') {
      noteElectiveSwap(oldCourse.code, course.code, 'You chose it for this elective slot.');
    }
    setChooser(null);
    setChooserOnMap(false);
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

  function moveCourse(
    courseId: string,
    fromTermId: string,
    toTermId: string,
    targetCourseId?: string,
    placeAfter = false,
  ) {
    if (!plan || targetCourseId === courseId) return;
    const destination = plan.terms.find((t) => t.id === toTermId);
    if (!destination) return;
    const course = courseIndex.get(courseId);
    const reordered = destination.courseIds.filter((id) => id !== courseId);
    const targetIndex = targetCourseId ? reordered.indexOf(targetCourseId) : -1;
    if (targetIndex === -1) reordered.push(courseId);
    else reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, courseId);
    if (
      fromTermId === toTermId &&
      destination.courseIds.every((id, index) => reordered[index] === id)
    ) {
      return;
    }
    commit({
      ...plan,
      terms: plan.terms.map((term) => {
        if (fromTermId === toTermId && term.id === toTermId) {
          return { ...term, courseIds: reordered };
        }
        if (term.id === fromTermId) {
          return { ...term, courseIds: term.courseIds.filter((id) => id !== courseId) };
        }
        if (term.id === toTermId) {
          return { ...term, courseIds: reordered };
        }
        return term;
      }),
    });
    setSelectedCourseId(courseId);
    setFocusTermId(toTermId);
    setStatus(
      fromTermId === toTermId
        ? `${course?.code ?? 'Course'} reordered within ${destination.label}.`
        : `${course?.code ?? 'Course'} moved to ${destination.label}.`,
    );
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
      `Degree: ${L.loaded.program.name}, ${school?.name ?? 'selected university'}. Published total: ${L.activeProgramTotal ?? 'not published'} credits. Plan: ${L.totalCredits} through ${last}.`,
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
    const ctx = L.context;
    if (!ctx || !L.loaded) return { ok: false, error: 'The course catalog is not loaded yet.' };
    const board = planRef.current ?? {
      schemaVersion: 1,
      programId: L.loaded.program.id,
      graduationLabel: '',
      completedCourseIds: [],
      terms: [],
    } satisfies PlanState;
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
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
        const detail = isIllinois ? await loadIllinoisCourseDetail(c.code) : null;
        const key = normCode(c.code);
        const grade = L.core?.grades?.get(key);
        const prereq = L.core?.prereqs?.get(key);
        return {
          ok: true,
          ...describe(c),
          role_on_board: holding(c.id) ? roleOf(c) : null,
          description: detail?.course?.description || c.description || null,
          prerequisite_sentence: prereq?.text || detail?.course?.prereqText || c.prerequisiteText || null,
          prerequisite_groups: prereq?.groups?.map((g) => g.any) ?? (c.prerequisites.length > 0 ? [c.prerequisites] : []),
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
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
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
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
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
        if (!oldC) return { ok: false, reason: `${str('remove') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
        if (!newC) return { ok: false, reason: `${str('add') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
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
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
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
    replaceActivePlan(previous.plan);
    if (answers && onAnswersChange) {
      onAnswersChange({
        ...answers,
        alreadyTakenCourseCodes: previous.alreadyTakenCourseCodes,
      });
    }
    setUndoStack((current) => current.slice(0, -1));
    setStatus('Last change undone.');
  }

  function save() {
    if (!plan) return;
    const stored: Stored = {
      schemaVersion: 3,
      schoolId: school?.id ?? '',
      programIds,
      minorIds,
      certificateIds,
      emphasisSelections: answers?.emphasisSelections ?? {},
      programId,
      plan,
      minimumTermCredits,
      targetTermCredits,
      careerInterests,
      plans: planTabs.map((candidate) =>
        candidate.id === activePlanId
          ? { ...candidate, plan, issueSeverity: planWideSeverity }
          : candidate,
      ),
      planGroups,
      activePlanId,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    setStatus('Saved on this device.');
  }

  function exportPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify({
      school: school?.id,
      programIds,
      minorIds,
      certificateIds,
      emphasisSelections: answers?.emphasisSelections ?? {},
      programId,
      plan,
      plans: planTabs.map((candidate) =>
        candidate.id === activePlanId
          ? { ...candidate, plan, issueSeverity: planWideSeverity }
          : candidate,
      ),
      planGroups,
      activePlanId,
    }, null, 2)], {
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
        const parsed = JSON.parse(await file.text()) as {
          plan?: unknown;
          programId?: unknown;
          programIds?: unknown;
          minorIds?: unknown;
          certificateIds?: unknown;
          emphasisSelections?: unknown;
          plans?: unknown;
          planGroups?: unknown;
          activePlanId?: unknown;
        };
        if (isPlanState(parsed.plan)) {
          setPlan(parsed.plan);
          setPlanTabs([{
            id: 'plan-1',
            name: 'Plan 1',
            groupId: DEFAULT_PLAN_GROUP.id,
            plan: parsed.plan,
          }]);
          setPlanGroups([{ ...DEFAULT_PLAN_GROUP }]);
          setActivePlanId('plan-1');
          setStatus('Plan loaded from the file.');
        }
        if (Array.isArray(parsed.programIds) && parsed.programIds.every((id) => typeof id === 'string')) {
          setProgramIds(parsed.programIds);
        } else if (typeof parsed.programId === 'string') {
          setProgramIds([parsed.programId]);
        }
        if (Array.isArray(parsed.minorIds) && parsed.minorIds.every((id) => typeof id === 'string')) {
          setMinorIds(parsed.minorIds);
        }
        if (Array.isArray(parsed.certificateIds) && parsed.certificateIds.every((id) => typeof id === 'string')) {
          setCertificateIds(parsed.certificateIds);
        }
      } catch {
        setStatus('That file could not be read as a plan.');
      }
    };
    input.click();
  }

  async function sharePlan() {
    if (!plan) return;
    const encoded = btoa(encodeURIComponent(JSON.stringify({
      programIds,
      minorIds,
      certificateIds,
      emphasisSelections: answers?.emphasisSelections ?? {},
      programId,
      plan,
    })));
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
      programUrl: loaded?.urls[0]?.url ?? null,
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

  if (isCatalogSchool && programIds.length === 0) {
    return (
      <main className="planner-loading">
        <div>
          <h1>Choose your degree program</h1>
          <p>
            Select a program explicitly. Add another to build a combined plan from both
            published requirement pages.
          </p>
          <ProgramPicker
            options={programOptions}
            selectedIds={programIds}
            onChange={changePrograms}
          />
        </div>
      </main>
    );
  }

  if (isUga && !emphasesComplete) {
    return (
      <main className="planner-loading">
        <div>
          <h1>Choose your required program paths</h1>
          <p>
            This degree has named choices that change which courses belong in the plan. Select them before the schedule is generated.
          </p>
          <EmphasisPicker
            requirements={emphasisRequirements}
            selections={answers?.emphasisSelections ?? {}}
            onChange={changeEmphases}
          />
        </div>
      </main>
    );
  }

  const years = plan ? [...new Set(plan.terms.map((t) => t.year))] : [];

  const caveats = [
    ...(activeProgramTotal && plan ? overTotal(totalCredits, activeProgramTotal) : []),
    ...planNotes,
    ...(core?.meta?.notes ?? []).map(studentWording),
    ...(isUga
      ? [
          'This planning draft uses requirements and prerequisites from the UGA Bulletin. DegreeWorks and your advisor remain the official check for graduation.',
          'Course availability is based on catalog patterns, not live registration. This prototype does not yet know current instructors, meeting times, rooms, or open seats.',
          ...(isGraduatePlan
            ? [
                'UGA considers 9 graduate credits a normal full-time fall or spring load. Some assistantships require 12; change Preferences if that applies to you.',
              ]
            : []),
        ]
      : []),
    ...(programIds.length > 1
      ? [
          isGraduatePlan
            ? 'This combined graduate draft includes every named requirement from the selected degree pages and counts shared courses once. Dual-degree approval, residency, and program-of-study rules still need advisor confirmation.'
            : 'This double-major draft combines every named requirement from the selected degree pages and counts shared courses once. College residency rules and whether the pairing is one degree or two still need advisor confirmation.',
        ]
      : []),
    ...(minorIds.length + certificateIds.length > 0
      ? [
          'Selected minors and certificates are planned from their published requirement pages and share courses where the catalog allows. Residency, grade, and application rules still need advisor confirmation.',
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
      data-theme={theme}
      style={mapHeight === null ? undefined : ({ '--map-row-h': `${mapHeight}px` } as CSSProperties)}
    >
      <output aria-live="polite" className="sr-only">
        {status_}
      </output>

      <header className="app-header">
        <a className="brand" href="#top" aria-label="ORION planner home">
          <Image src="/orion-logo.png" alt="" width={44} height={44} priority />
          <span className="brand-name">ORION</span>
        </a>
        <div className="header-actions">
          <Button
            variant="outline"
            className="rail-toggle"
            aria-expanded={railOpen}
            aria-controls="planner-progress"
            aria-label={railOpen ? 'Close progress' : 'Open progress'}
            title={railOpen ? 'Close progress' : 'Open progress'}
            onClick={() => setRailOpen((open) => !open)}
          >
            <Image
              className={`rail-toggle-school-logo${isIllinois && !railOpen ? ' is-illinois-original' : ''}`}
              src={
                isUga
                  ? railOpen
                    ? '/uga-toggle-logo.png'
                    : '/uga-school-logo.png'
                  : isIllinois
                    ? railOpen
                      ? '/illinois-toggle-logo.png'
                      : '/illinois-school-logo.png'
                    : '/orion-logo.png'
              }
              alt=""
              width={28}
              height={28}
              aria-hidden="true"
            />
          </Button>
          {isCatalogSchool && (
            <BotLauncher
              open={chatOpen}
              onToggle={() => setChatOpen((current) => !current)}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="profile-menu-trigger"
                  aria-label="Profile and settings"
                  title="Profile and settings"
                />
              }
            >
              <User />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 profile-menu">
              <DropdownMenuItem disabled={undoStack.length === 0} onClick={undo}>
                <Undo2 /> Undo last change
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}>
                {theme === 'light' ? <Moon /> : <Sun />} Use {theme === 'light' ? 'dark' : 'light'} mode
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setRailOpen(true);
                  requestAnimationFrame(() => {
                    const details = document.getElementById('rail-programs') as HTMLDetailsElement | null;
                    if (details) details.open = true;
                    details?.scrollIntoView({ block: 'nearest' });
                  });
                }}
              >
                Change majors and programs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={startOver}>Change university</DropdownMenuItem>
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
        programUrls={loaded?.urls ?? []}
        digest={answers ? [school?.short, activeProgramName].filter(Boolean).join(' · ') : ''}
        onStartOver={startOver}
        onClose={() => setRailOpen(false)}
        plannedCredits={totalCredits}
        creditNote={creditNote}
        degreeTotal={activeProgramTotal}
        priorCount={plan?.completedCourseIds.length ?? 0}
        priorCourses={completedCourses}
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
              setPlanTabs([]);
              setPlanGroups([{ ...DEFAULT_PLAN_GROUP }]);
              setActivePlanId('plan-1');
            }}
          />
        }
        areas={areas}
        programLevel={programLevel}
        supportsGraduatePrograms={isUga}
        onProgramLevelChange={changeProgramLevel}
        programs={programOptions}
        programIds={programIds}
        onProgramsChange={changePrograms}
        minors={minorOptions}
        minorIds={minorIds}
        onMinorsChange={changeMinors}
        certificates={certificateOptions}
        certificateIds={certificateIds}
        onCertificatesChange={changeCertificates}
        emphasisRequirements={emphasisRequirements}
        emphasisSelections={answers?.emphasisSelections ?? {}}
        onEmphasisChange={changeEmphases}
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
        <div
          className="plan-tabs"
          role="tablist"
          tabIndex={-1}
          aria-label="Degree plan alternatives"
          onDragOver={(event) => {
            if (!draggingPlanTabId) return;
            const group = (event.target as HTMLElement).closest<HTMLElement>('[data-plan-group-id]');
            const groupId = group?.dataset.planGroupId;
            if (!groupId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDragOverPlanGroupId(groupId);
          }}
          onDrop={(event) => {
            if (!draggingPlanTabId) return;
            const group = (event.target as HTMLElement).closest<HTMLElement>('[data-plan-group-id]');
            const groupId = group?.dataset.planGroupId;
            if (!groupId) return;
            event.preventDefault();
            const tabId = event.dataTransfer.getData('application/x-orion-plan-tab') || draggingPlanTabId;
            movePlanTabToGroup(tabId, groupId);
            setDraggingPlanTabId(null);
            setDragOverPlanGroupId(null);
          }}
        >
          {planGroups.map((group) => {
            const groupTabs = planTabs.filter((candidate) => candidate.groupId === group.id);
            if (groupTabs.length === 0) return null;
            return (
              <fieldset
                key={group.id}
                className="plan-tab-group"
                data-plan-group-id={group.id}
                data-drop-target={dragOverPlanGroupId === group.id ? 'true' : undefined}
                style={{ '--plan-group-color': group.color } as CSSProperties}
              >
                <legend className="sr-only">{group.name} plan group</legend>
                <label className="plan-group-color" title={`Change ${group.name} color`}>
                  <span className="sr-only">Change {group.name} color</span>
                  <input
                    type="color"
                    value={group.color}
                    onChange={(event) => recolorPlanGroup(group.id, event.target.value)}
                  />
                </label>
                <input
                  className="plan-group-name"
                  aria-label={`Rename ${group.name}`}
                  value={group.name}
                  onChange={(event) => renamePlanGroup(group.id, event.target.value)}
                  onBlur={(event) => renamePlanGroup(group.id, event.target.value.trim() || 'Untitled group')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                {groupTabs.map((candidate) => (
                  <div
                    key={candidate.id}
                    className="plan-tab-shell"
                    data-active={candidate.id === activePlanId ? 'true' : undefined}
                    data-dragging={candidate.id === draggingPlanTabId ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      className="plan-tab-drag-handle"
                      draggable
                      aria-label={`Move ${candidate.name} to another group`}
                      title="Drag to another group. Keyboard: Alt + Left or Right Arrow."
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('application/x-orion-plan-tab', candidate.id);
                        setDraggingPlanTabId(candidate.id);
                        setDragOverPlanGroupId(null);
                      }}
                      onDragEnd={() => {
                        setDraggingPlanTabId(null);
                        setDragOverPlanGroupId(null);
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                        event.preventDefault();
                        movePlanTabToAdjacentGroup(candidate.id, event.key === 'ArrowLeft' ? -1 : 1);
                      }}
                    >
                      <GripVertical aria-hidden="true" />
                    </button>
                    <div className="plan-tab-label">
                      <input
                        role="tab"
                        aria-selected={candidate.id === activePlanId}
                        aria-label={`Rename ${candidate.name}${tabIssueSeverity(candidate) ? `, has a ${tabIssueSeverity(candidate)} plan-wide note` : ''}`}
                        className="plan-tab-button"
                        value={candidate.name}
                        onFocus={() => switchPlanTab(candidate.id)}
                        onChange={(event) => renamePlanTab(candidate.id, event.target.value)}
                        onBlur={(event) => renamePlanTab(candidate.id, event.target.value.trim() || 'Untitled plan')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                      {tabIssueSeverity(candidate) && (
                        <span
                          className={`plan-tab-issue-dot is-${tabIssueSeverity(candidate)}`}
                          title={`This plan has a ${tabIssueSeverity(candidate)} plan-wide note`}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      className="plan-tab-close"
                      aria-label={`Close ${candidate.name}`}
                      title={`Close ${candidate.name}`}
                      disabled={planTabs.length <= 1}
                      onClick={() => closePlanTab(candidate.id)}
                    >
                      <X />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="plan-tab-add"
                  aria-label={`Add a plan to ${group.name}`}
                  title={`Duplicate the current plan in ${group.name}`}
                  disabled={!plan}
                  onClick={() => duplicatePlanTab(group.id)}
                >
                  <Plus />
                </button>
              </fieldset>
            );
          })}
          <button
            type="button"
            className="plan-group-add"
            aria-label="Create a new plan group"
            title="Create a color-coded plan group"
            disabled={!plan}
            onClick={createPlanGroup}
          >
            <FolderPlus />
          </button>
        </div>
        <div className="board-bar">
          {planWideIssues.length > 0 && (
            <div className="plan-wide-issues" aria-label="Plan-wide notes">
              {planWideIssues.map((group) => (
                <IssueBadge
                  key={group.key}
                  title={
                    group.count > 1
                      ? `${group.title} and ${group.count - 1} more like it`
                      : group.title
                  }
                  message={group.message}
                  severity={group.severity}
                  side="bottom"
                  onClick={() => selectIssue(group.issue)}
                />
              ))}
            </div>
          )}

          <Button variant="outline" onClick={buildPlan} disabled={programBusy}>
            Rebuild
          </Button>
        </div>

        {plan && plan.terms.length > 0 && (
          /* The ruler is outside the board's scroller, so its offset is copied
             from the board on every scroll. Without that the labels stay put
             while the columns move and the ruler names the wrong year. */
          <div className="year-ruler" aria-hidden="true" ref={rulerRef}>
            <div className="year-ruler-track">
              {years.map((year) => {
                const termsInYear = plan.terms.filter((t) => t.year === year);
                const count = termsInYear.length;
                const custom = termsInYear.filter((term) => termWidths[term.id] !== undefined);
                const customWidth = custom.reduce(
                  (sum, term) => sum + (termWidths[term.id] ?? 0),
                  0,
                );
                const defaults = count - custom.length;
                return (
                  /* Measured in the same two tokens the board's columns use, so
                     that a breakpoint which narrows a column moves the year
                     label with it. Hard-coding 260 and 12 here put the ruler
                     over the wrong columns on any screen where they changed,
                     which is a year label naming a semester it is not above. */
                  <span
                    key={year}
                    style={{
                      width: `calc(${defaults} * var(--col-w) + ${customWidth}px + ${count - 1} * var(--col-gap))`,
                    }}
                  >
                    Year {year}
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
                onMarkCourseCompleted={markCourseCompleted}
                onAddCourse={openFinderFor}
                onDropCourse={addCourse}
                replacement={
                  chooser && chooserData
                    ? {
                        courseId: chooser.courseId,
                        termId: chooser.termId,
                        label: chooserData.label,
                        options: chooserData.options,
                      }
                    : null
                }
                onPrepareReplacement={prepareReplacement}
                onReplaceCourse={chooseElective}
                onShowReplacementCourse={showReplacementCourse}
                onShowReplacements={showReplacements}
                onChooseElective={openChooser}
                electiveOf={electiveOf}
                width={termWidths[term.id]}
                onWidthChange={resizeTerm}
              />
            );
          })}
        </div>
      </section>

      <CourseExplorer
        searchHits={searchHits}
        results={searchResults}
        chooser={
          chooser && chooserOnMap && plan
            ? {
                termLabel: plan.terms.find((t) => t.id === chooser.termId)?.label ?? 'that term',
                replacing: courseIndex.get(chooser.courseId)?.code ?? 'the elective',
                options: chooserOptions,
                onPick: (courseId) => chooseElective(chooser.termId, chooser.courseId, courseId),
                onCancel: () => {
                  setChooser(null);
                  setChooserOnMap(false);
                },
              }
            : null
        }
        courses={catalog}
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
        theme={theme}
        dragUsable={dragUsable}
        onHeightChange={setMapHeight}
        onOpenChange={setFinderOpen}
        onSearchChange={setSearchQuery}
        onTargetTermChange={setTargetTermId}
        onSelectCourse={setSelectedCourseId}
        onAddCourse={addCourse}
        onRemoveCourse={removeCourse}
        highlightedCourseIds={replacementCourseIds}
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
      {isCatalogSchool && (
        <BotPanel
          key={programKey || 'no-degree'}
          botName={botName}
          schoolId={school?.id ?? null}
          schoolName={school?.name ?? 'your university'}
          schoolShort={school?.short ?? 'your school'}
          programId={programKey || null}
          board={describeBoard}
          execute={advisorExecute}
          open={chatOpen}
          onOpen={() => setChatOpen(true)}
          onClose={() => setChatOpen(false)}
          openers={[
            'Does this plan meet my degree requirements?',
            `How do I find my ${school?.short ?? 'university'} advisor?`,
            'Can you suggest an elective based on my interests?',
            'Which term is hardest?',
          ]}
          ready={Boolean(context)}
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
