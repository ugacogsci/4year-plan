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
  describeCreditTotal,
  generatePlan,
  planCreditRange,
  validatePlan,
  type PlanningContext,
  type PoolReport,
} from '@/lib/planner/autoplan';
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

/** What the constellation paints. See mapCourses below for why it is bounded. */
const MAP_LIMIT = 240;

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** autoplan's NotPlaced reasons, in the product's own words. */
const NOT_PLACED_WORD: Record<string, string> = {
  'chain-too-long': 'the prerequisite chain does not fit in the years left',
  'no-room': 'no term had room before graduation',
  'prereq-unmet': 'a prerequisite is not met',
  'offering-conflict': 'not offered in any remaining term',
};

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

  const [plan, setPlan] = useState<PlanState | null>(null);
  const [undoStack, setUndoStack] = useState<PlanState[]>([]);
  const [programId, setProgramId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedProgram | null>(null);
  const [programBusy, setProgramBusy] = useState(false);
  const [planNotes, setPlanNotes] = useState<string[]>([]);
  const [unmet, setUnmet] = useState<PlanIssue[]>([]);
  const [pools, setPools] = useState<PoolReport[]>([]);
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
      setProgramId(guess.id);
      setStatus(`Planning ${guess.name}`);
    }
  }, [isIllinois, core, programId, answers]);

  useEffect(() => {
    if (!isIllinois || !core || !programId) return;
    const summary = (core.programs ?? []).find((p) => p.id === programId);
    if (!summary) return;
    let cancelled = false;
    setProgramBusy(true);
    void loadProgram(core, summary).then((result) => {
      if (cancelled) return;
      setLoaded(result);
      setProgramBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isIllinois, core, programId]);

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
      setUnmet([]);
      setPools([]);
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
      [],
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
    setPools(generated.pools);

    /**
     * What the scheduler could not do, promoted into the review list.
     *
     * A plan that quietly drops a requirement it could not fill looks finished
     * and is not. Each unsatisfied requirement is its own row and carries the
     * catalog's own sentence so a human can check the thing the parser could not.
     *
     * Courses that did not fit are grouped by reason rather than listed one per
     * row. Thirty-seven rows reading "CS 4xx did not fit" is one fact printed
     * thirty-seven times, and it buries the two prerequisite conflicts that are
     * the rows a student has to act on.
     */
    const firstTerm = generated.plan.terms[0]?.id ?? '';
    const byReason = new Map<string, typeof generated.notPlaced>();
    for (const row of generated.notPlaced) {
      const list = byReason.get(row.reason);
      if (list) list.push(row);
      else byReason.set(row.reason, [row]);
    }

    const shortfalls: PlanIssue[] = [
      ...generated.unsatisfied.map((u) => ({
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
        title: `${rows.length} course${rows.length === 1 ? '' : 's'} left out: ${NOT_PLACED_WORD[reason] ?? reason}`,
        message: `${rows.slice(0, 8).map((r) => r.code).join(', ')}${
          rows.length > 8 ? ` and ${rows.length - 8} more` : ''
        }. ${rows[0].message}`,
        termId: firstTerm,
      })),
    ];
    setUnmet(shortfalls);
    setUndoStack([]);
    setStatus(
      shortfalls.length
        ? 'Plan built. Open the review list to see what it could not do.'
        : 'Plan built. Nothing to review.',
    );
  }, [isIllinois, core, context, loaded, answers, byCode, minimumTermCredits]);

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

  const issues = useMemo(() => {
    if (!plan) return [];
    if (isIllinois && context) {
      return [...unmet, ...validatePlan(plan, context, { minimumTermCredits })];
    }
    return getPlanIssues(plan, catalog, { minimumTermCredits });
  }, [plan, isIllinois, context, unmet, minimumTermCredits, catalog]);

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

  const totalCredits = useMemo(() => {
    if (!plan) return '0 cr';
    if (isIllinois && context) {
      const codes = plan.terms
        .flatMap((t) => t.courseIds)
        .map((id) => courseIndex.get(id)?.code)
        .filter((c): c is string => Boolean(c));
      return describeCreditTotal(planCreditRange(codes, context)).replace(/ credits?$/, ' cr');
    }
    return `${getPlanCredits(plan, catalog).total} cr`;
  }, [plan, isIllinois, context, courseIndex, catalog]);

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
      const wanted = [
        pool.hoursTarget !== null ? `${pool.hoursTarget} hours` : null,
        pool.countTarget !== null ? `${pool.countTarget} courses` : null,
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
  const mapCourses = useMemo(() => {
    const picked = new Map<string, Course>();
    const take = (c?: Course) => {
      if (c && !picked.has(c.id)) picked.set(c.id, c);
    };
    plannedCourseIds.forEach((id) => take(courseIndex.get(id)));
    if (loaded) {
      const wanted = new Set(loaded.blocks.map((b) => b.areaId));
      for (const course of catalog) {
        if (picked.size >= MAP_LIMIT) break;
        if (course.requirementIds.some((id) => wanted.has(id))) take(course);
      }
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      for (const course of catalog) {
        if (picked.size >= MAP_LIMIT) break;
        if (`${course.code} ${course.title}`.toLowerCase().includes(query)) take(course);
      }
    }
    for (const course of catalog) {
      if (picked.size >= MAP_LIMIT) break;
      take(course);
    }
    return [...picked.values()];
  }, [catalog, courseIndex, loaded, plannedCourseIds, searchQuery]);

  const selectedCourse = selectedCourseId ? courseIndex.get(selectedCourseId) : undefined;

  /** The degree on screen, from whichever source this school has. */
  const activeProgramName =
    loaded?.program.name ?? programOptions.find((p) => p.id === programId)?.name ?? null;
  const activeProgramTotal =
    loaded?.program.totalCredits ??
    samplePrograms.find((p) => p.id === programId)?.totalCredits ??
    null;

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
          year: term.year,
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
    ...(core?.meta?.notes ?? []),
    'Prerequisites are parsed from catalog sentences. Anything about placement, consent or standing is not checked here.',
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
        degreeTotal={activeProgramTotal}
        priorCount={plan?.completedCourseIds.length ?? 0}
        areas={areas}
        programs={programOptions}
        programId={programId}
        onProgramChange={(id) => {
          setProgramId(id || null);
          setPlan(null);
          setLoaded(null);
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
                  <span key={year} style={{ width: count * 260 + (count - 1) * 12 }}>
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
function overTotal(planned: string, degreeTotal: number): string[] {
  const low = Number(planned.split(' ')[0]);
  if (!Number.isFinite(low) || low <= degreeTotal) return [];
  return [
    `This plan is ${planned}, over the ${degreeTotal} hours the degree page lists. Where a requirement offers a choice between lists, the scheduler filled every list rather than guess which one you want.`,
  ];
}
