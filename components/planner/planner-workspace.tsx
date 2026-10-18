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

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import {
  FolderPlus,
  GripVertical,
  Moon,
  Plus,
  Save,
  Sun,
  Printer,
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
import { BotLauncher, BotPanel, type BotTurns } from './advisor';
import { CourseExplorer } from './course-explorer';
import { ElectivePools } from './elective-pools';
import { IssueBadge } from './issue-badge';
import { groupIssues, isTermIssue, reviewTitle } from './plan-health';
import { attentionItems, attentionLine, earlyFinishNote } from '@/lib/planner/attention';

import { toast, Toaster } from '@/components/ui/toast';
import { AdvisorPacketDialog } from './advisor-packet';
import { SemesterColumn } from './semester-column';
import { illinoisProgress, illinoisProgressGuard } from './illinois-progress';
import { StudentProfilePanel, type AreaRow } from './student-profile-panel';
import { DoubleDawgsPicker } from './double-dawgs-picker';
import { DoubleDawgsTiming } from './double-dawgs-timing';
import { defaultGraduateFinish, degreeTermOrder, doubleDawgsContext, doubleDawgsIssues, doubleDawgsLedger, doubleDawgsOptions, doubleDawgsProgress, generateDoubleDawgs, selectSharedCourses, sharedUndergraduateRequirements, withDoubleDawgsGraduateRules } from '@/lib/planner/double-dawgs';
import { pathwaysFor, sampleCoursesFor, samplePlansFor } from '@/lib/planner/uga-planning-guidance';
import { holdMaybe, maybeCodes, maybeIssues, maybeLines, openMaybeOnBoard, withoutMaybe } from '@/lib/planner/transfer-maybe';
import { ProgramPicker } from './program-picker';
import { EmphasisPicker, emphasisSelectionsComplete } from './emphasis-picker';
import {
  buildContext,
  loadFullIllinois,
  loadProgram,
  plannableProgram,
  openProgram,
  suspendedNotice,
  readHorizon,
  firstOpenTerm,
  calendarTerm,
  readPriorCredit,
  readPrograms,
  useIllinoisCore,
  loadIllinoisMinorFile,
  loadMinor,
  type LoadedMinor,
  type LoadedProgram,
} from './illinois-source';
import { illinoisMinorOptions, MINOR_ID_PREFIX, type RawMinorFile } from '@/lib/planner/illinois-minors';
import { majorCodesOf, minorPlanNotes, planBesideDegree, rowLabel, uncheckedMinorNote, upperApartNote, upperLevelApart, MINOR_UPPER_APART_HOURS } from '@/lib/planner/illinois-minor-plan';
import { comparePrograms, CS_MINOR, placementsOnBoard, resolveProgram, secondMajorsWithinReach, type ProgramSide } from '@/lib/planner/programs-compare';
import {
  isUgaGraduateDegree,
  isUgaUndergraduateDegree,
  loadUgaProgram,
  ugaSelectionRequirements,
  useUgaData,
  type UgaLoadedProgram,
} from './uga-source';
import {
  arrivalFromWords,
  degreeSubjects,
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
  prereqNeedsAdmission,
  spreadHardOutcome,
  validatePlan,
  type Arrival,
  type AutoplanInput,
  type AwayKind,
  type AwayTerm,
  type CreditTotal,
  type GeneratedPlan,
  type NotPlaced,
  type PlanningContext,
  type ValidateOptions,
  type PoolReport,
} from '@/lib/planner/autoplan';
import {
  forgetBoard,
  forgetChat,
  NO_SHAPE,
  pushUndo,
  readSavedBoard,
  repickInReport,
  reportOf,
  serializeBoard,
  swapInReport,
  writeSavedBoard,
  type BoardState,
  type BoardStorage,
  type PlanReport,
  type PlanSettings,
  type PlanShape,
  type SavedBoard,
  type UndoEntry,
} from '@/lib/planner/saved-board';
import { livePools, poolShortfalls } from './live-pools';
import { CAREER_TRACKS, careerWordsAfter, INTEREST_TOPICS, trackRequiredStatus, type InterestsMode } from '@/lib/planner/career-tracks';
import { collegeRulesFor, crncEligibility, describeApplicationPrograms, overloadAnswer, underloadNote } from '@/lib/planner/college-rules';
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
import { areaProgress, type ProgramRequirements } from '@/lib/planner/scheduler';
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
import type { Course, IssueSeverity, PlanIssue, PlanState, PlanTerm, SemesterSeason } from '@/lib/planner/types';
import {
  UNDECIDED_PROGRAM_ID,
  clearAnswers,
  schoolById,
  timelineForPlanning,
  type OnboardingAnswers,
  type ProgramLevel,
  type ExamCreditEntry,
} from '@/lib/planner/onboarding';

import { degreeCompletionIssue } from '@/lib/planner/completion';
import {
  PLANNER_THEME_STORAGE_KEY,
  readStoredTheme,
  type PlannerTheme,
} from '@/lib/planner/theme';
import {
  lineIsForeign,
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
import { UGA_TRANSFER_PORTAL, loadUgaTransfer, ugaDesignation, ugaLookup, ugaSchoolEntry } from '@/lib/planner/transfer-official';
import { withCoreCredit } from '@/lib/planner/transfer-core';
import { proposeEquivalents, type CatalogLite } from '@/lib/planner/transfer-match';
import { assumedHours as assumedHoursOf, recordCoverage, uncoveredTerms } from '@/lib/planner/start-term';
import { distinctHeld, heldTowardDegree, type GenEdCredit, type Horizon, type PlanRequirement, type PriorCredit } from '@/lib/planner/autoplan';
import { boardChecker, genEdCandidates, genEdWhy, notRegistrable, planMarks, repickBoard, repickSignature, type RepickChange } from '@/lib/planner/repick';
import { creditUse, editFlags, enteringAsFirstYear, flagsCaused, isEditFlag, momentumReview, priorCreditUse, summerSuggestions, withSummer } from '@/lib/planner/review';
import { buildAdvisorPacket, cardRole, type AdvisorPacket, type CardRole } from '@/lib/planner/advisor-packet';
import { subjectMatches, subjectName } from '@/lib/planner/illinois-subjects';
import { TranscriptUpload } from './transcript-upload';
import { loadIllinoisCourseDetail, loadIllinoisSectionTerms, loadIllinoisSyllabi, sectionTermsOf } from '@/lib/planner/illinois-load';
import { loadUgaSyllabi } from '@/lib/planner/uga-syllabi';
import {
  carryInstructors, chosenInstructor, currentTermLabel, instructorOptions, resolveTerms, SYLLABUS_FACTS, syllabiByInstructor,
  studyYearAtBoardStart, syllabiToShow, teachingNames, termSyllabiResult, withInstructor, type SyllabusFact, type SyllabusRecord, type TermCourseInput,
} from '@/lib/planner/instructors';
import type { InstructorControl } from './instructor-picker';
import type { IllinoisCore } from '@/lib/planner/illinois-load';
import {
  graduateOptionName, graduatePlanSettings, isIllinoisGraduateId, loadIllinoisGraduateCatalog,
  loadIllinoisGraduateForBoard, loadIllinoisGraduateNotChecked, loadIllinoisGraduatePrograms, withGraduateCourses,
  type IllinoisGraduateSummary, type LoadedGraduateProgram,
} from '@/lib/planner/illinois-graduate';
import { pickSectionTerm, sectionTermCaveat, termsInWords } from '@/lib/planner/section-terms';
import { weeklyFit, type WeeklyFit, type WeeklySchedule } from '@/lib/planner/weekly-fit';
import type { AdvisorExecutor } from '@/lib/planner/advisor';
import type { RequirementBlock } from '@/lib/planner/illinois-data';
import { ClubPicks } from './club-picks';
import { clubStudentOf, type ClubStudent, type IllinoisClubsFile } from '@/lib/planner/clubs';
import { loadIllinoisClubs } from '@/lib/planner/clubs-load';
import { runFindClubs } from '@/lib/planner/clubs-tool';
import { mayBookAgain } from '@/lib/planner/repeats';
import { UnofficialBadge } from './site-notice';
import { unofficialNotice } from '@/lib/planner/notices';

/** A term's courses less one sitting of a course: a course the catalog allows twice in one term (THEA 119) loses only the one the student moved or removed. */
function withoutOne(ids: string[], id: string): string[] {
  const at = ids.indexOf(id);
  return at < 0 ? ids : [...ids.slice(0, at), ...ids.slice(at + 1)];
}

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

/** This device's storage, or null where the browser refuses it (some private windows throw on the getter). */
function deviceStorage(): BoardStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Forget the board saved on this device and ALMA's conversation about it.
 * Onboarding calls it, so a new setup builds a new plan and starts a new
 * conversation rather than one about a board that is gone.
 */
export function clearSavedPlan(): void {
  forgetBoard(deviceStorage());
}

/**
 * What decides whether the student's credit changed: the record, the exams
 * and the words as they gave them. The exams go in as named, not as priced
 * for the degree's college, because the pricing waits on the degree page
 * and the exam table: read priced, a Grainger student's restored board saw
 * "Calculus BC" turn into its Grainger row the moment the page arrived, took
 * that for new credit and was rebuilt over the board they had saved.
 */
function creditKeyOf(answers: OnboardingAnswers | null | undefined): string {
  return [
    ...transcriptCodes(answers?.transcript).sort(),
    ...(answers?.alreadyTakenCourseCodes ?? []).slice().sort(),
    `h${transcriptHours(answers?.transcript)}|${transcriptCreditAdjustment(answers?.transcript)}`,
    // Only a record with an unconfirmed "may be" line adds this, so every
    // other student's saved board keeps its key.
    ...(maybeCodes(answers?.transcript).length > 0 ? [`maybe:${maybeCodes(answers?.transcript).sort().join(',')}`] : []),
    ...(answers?.exams ?? []).map((e) => `${e.kind}|${e.exam}|${e.score}`),
    answers?.transferText ?? '',
    String(answers?.languageYears ?? ''),
    answers?.language ?? '',
  ].join(';');
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
    for (const code of [...choice.codes, ...(choice.substitutes ?? [])]) out.add(normCode(code));
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
      [...choice.codes, ...(choice.substitutes ?? [])].some((candidate) => normCode(candidate) === code),
    );
    if (!row) continue;
    return {
      codes: new Set([...row.codes, ...(row.substitutes ?? [])].map(normCode)),
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

const AWAY_KINDS: AwayKind[] = ['study_abroad', 'co_op', 'internship', 'gap'];

/** "Spring 2029 (study abroad, 15 hours)", for ALMA. */
function describeAway(a: AwayTerm): string {
  const what = a.kind ? `${a.kind.replace('_', ' ').replace('co op', 'co-op')}, ` : '';
  return `${a.season} ${a.year} (${what}${awayCredits(a)} hours)`;
}

interface PlanTab {
  id: string;
  name: string;
  groupId: string;
  plan: PlanState;
  board?: BoardState;
  /** Cached so inactive alternatives retain their latest plan-wide status. */
  issueSeverity?: IssueSeverity | null;
  issueSummary?: string;
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

type SourceProgram = LoadedProgram | UgaLoadedProgram;

/** One or more catalog degree pages presented to the planner as one board. */
interface LoadedBundle {
  doubleDawgsGraduate?: UgaLoadedProgram;
  summary: { id: string; name: string; totalCredits: number | null };
  program: ProgramRequirements;
  blocks: RequirementBlock[];
  sources: SourceProgram[];
  urls: Array<{ name: string; url: string }>;
  electiveHours?: number;
  fillToDegreeTotal?: boolean;
  /**
   * Illinois minors on this board (beta), beside the degree and never merged
   * into it: summary, program and blocks stay the degree's own, so every
   * lookup by the degree's id, name or college works as it did (held
   * degrees, admission routes, college rules, compare_programs, clubs). Only
   * the plan build, the rail's rows, the notes, ALMA's description and the
   * packet read these. Absent for UGA, whose minors combinePrograms stacks.
   */
  minors?: LoadedMinor[];
}

/** An Illinois degree bundle with the student's minors beside it: the degree's own fields untouched, the minors' pages added to the rail's links. */
function withIllinoisMinors(bundle: LoadedBundle, minors: LoadedMinor[]): LoadedBundle {
  return { ...bundle, urls: [...bundle.urls, ...minors.map((minor) => ({ name: minor.name, url: minor.url }))], minors };
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
 * Who the student is as they start here, from their About-you answers and the
 * record they uploaded: a Parkland transfer's orientation row is LAS 102, not
 * LAS 100 or LAS 101.
 */
function arrivalOf(answers: OnboardingAnswers | null | undefined): Arrival {
  const record = answers?.transcript;
  const elsewhere = Boolean(record && (record.kind === 'transfer_report' || record.home === false));
  return arrivalFromWords([answers?.studying ?? '', answers?.timeline ?? '', answers?.after ?? ''].join(' '), elsewhere);
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
  // "Investment banking" is also a program Marcus applies to as a sophomore
  // (FIN 391), which no elective slot will ever book for him.
  const apply = describeApplicationPrograms(career);
  return `What the student said they study: ${studying.trim() || 'nothing yet'}. Career words the planner reads goals from: ${career.trim() ? `"${career.trim()}"` : 'none'}. Career tracks active: ${tracks.join(', ') || 'none'}. Interest topics active: ${topics.join(', ') || 'none'}.${apply ? ` ${apply}` : ''}`;
}

/** Goal names, for a club's why line about a goal the student did not name (a family's parent). */
const CLUB_VOCABULARY = { tracks: CAREER_TRACKS, topics: INTEREST_TOPICS };

/**
 * Who the clubs rail and find_clubs rank for (clubs-design DESIGN 3.1): goals
 * from the career words alone (never the major's name), the degree's subjects
 * and college, and whether they enter as a first-year, when honor societies
 * count half. Built the way __clubs.check.mjs builds its practice students.
 */
function clubStudentFor(careerText: string, board: LoadedBundle | SourceProgram | null, answers: OnboardingAnswers | null | undefined): ClubStudent {
  // A board of several programs reads its clubs from the first, the degree.
  const loaded = board && 'sources' in board ? (board.sources[0] ?? null) : board;
  return clubStudentOf({
    careerText,
    hear: interestProfileOf,
    programName: loaded?.program.name ?? null,
    college: loaded?.program.college ?? null,
    degree: loaded ? degreeSubjects(loaded.blocks, loaded.program.name) : null,
    firstYear: enteringAsFirstYear([answers?.studying ?? '', answers?.timeline ?? '', answers?.after ?? ''].join(' '), answers?.transcript),
    vocabulary: CLUB_VOCABULARY,
  });
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
  const isGraduatePlan = (isUga || isIllinois) && programLevel === 'graduate';
  const gradSettings = useMemo(() => graduatePlanSettings(isIllinois ? 'illinois' : 'uga'), [isIllinois]);
  const defaultMinimumTermCredits = isGraduatePlan ? gradSettings.minimumTermCredits : 12;
  const defaultTargetTermCredits = isGraduatePlan ? gradSettings.targetTermCredits : null;
  const isCatalogSchool = isIllinois || isUga;
  const { status: illinoisStatus, core } = useIllinoisCore(Boolean(isIllinois));
  const [gradMenu, setGradMenu] = useState<IllinoisGraduateSummary[] | null>(null);
  const [gradCore, setGradCore] = useState<IllinoisCore | null>(null);
  useEffect(() => {
    if (!isIllinois || !isGraduatePlan || !core) return;
    let cancelled = false;
    void Promise.all([loadIllinoisGraduatePrograms(), loadIllinoisGraduateCatalog()]).then(([menu, files]) => {
      if (cancelled) return;
      setGradMenu(menu);
      setGradCore(files ? withGraduateCourses(core, files) : null);
    });
    return () => { cancelled = true; };
  }, [isIllinois, isGraduatePlan, core]);
  /** The core a plan reads: with the graduate courses for an Illinois graduate plan. */
  const planCore = isIllinois && isGraduatePlan ? gradCore : core;
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
    `double-dawgs:${answers?.doubleDawgsPathwayId ?? ''}`,
  ].join('|');
  /**
   * Steps back, newest last. Each holds the whole board, report and all
   * (saved-board.ts UndoEntry), and one ALMA turn is one step however many
   * cards it moved.
   */
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  /**
   * Whether anyone has changed the board by hand since it was built. It
   * decides whether a change in credit rebuilds the board on its own or asks
   * first, and it is saved with the board: counting the undo stack instead
   * read a restored board, whose stack starts empty, as untouched.
   */
  const [boardEdited, setBoardEdited] = useState(false);
  /** ALMA turns the student undid this session, for the conversation's notes. */
  const [undoneTurns, setUndoneTurns] = useState<BotTurns['undone']>([]);
  /** Whether the board is on this device: nothing yet, saved, or refused by the browser. */
  const [saveState, setSaveState] = useState<'none' | 'saved' | 'failed'>('none');
  /** Bumped when a ref the save reads changes on its own (the re-pick signature). */
  const [saveTick, setSaveTick] = useState(0);
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
  /** The card's "Someone else (type a name)": the map popup opens with the name field ready. */
  const [instructorTyping, setInstructorTyping] = useState<{ courseId: string; termId: string } | null>(null);
  const [mapFocusRequest, setMapFocusRequest] = useState<{ courseId: string; sequence: number } | null>(null);
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
   * The advisor packet on screen, or null. Built when the student opens it
   * rather than on every render, because the backup for each of next term's
   * picks ranks the catalog against the board.
   */
  const [packet, setPacket] = useState<AdvisorPacket | null>(null);
  const closePacket = useCallback(() => setPacket(null), []);
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
   * (repickSignature), saved and restored with the board, or null for a
   * board from before it was saved (a v3 entry, a file). A
   * re-pick for the same ones is a no-op: pressing Re-pick on a fresh
   * balanced board used to move 21 of a pre-med student's courses, because
   * the fill and the re-pick rank a little differently, and pressing it
   * again moved more.
   */
  const repickedFor = useRef<string | null>(null);
  /**
   * The ALMA turn in flight, if any: the board, settings and record as they
   * were when the student sent the message, and what the turn has changed.
   * Its first change pushes one undo step; the rest of the turn joins it.
   */
  const almaTurn = useRef<{
    id: string;
    before: BoardState;
    settings: PlanSettings;
    transcript: TranscriptRecord | null;
    pushed: boolean;
    /** The tool call running now, which a change is filed under. */
    toolId: string | null;
    toolIds: string[];
    summary: string[];
  } | null>(null);
  /** Set by an ALMA tool that rebuilds the board, so the rebuild keeps the turn's undo step. */
  const keepUndoOnBuild = useRef(false);
  /** Set by an undo that put the credit back, so the credit watcher does not rebuild over it. */
  const creditRestored = useRef(false);
  /**
   * The input the board was last built from and what it built, or null for a
   * board restored from this device. compare_programs plans the student's
   * program and a second one together from it, so "what does Accountancy
   * cost me" is measured against the same student, horizon and priorities.
   */
  const lastBuild = useRef<{ input: AutoplanInput; plan: GeneratedPlan } | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [targetTermCredits, setTargetTermCredits] = useState<number | null>(
    defaultTargetTermCredits,
  );
  const [priorities, setPriorities] = useState<Priorities>({ ...DEFAULT_PRIORITIES });
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
  /** Set by buildPlan: the next render with the new board says what the build found. */
  const announceBuild = useRef(false);
  /**
   * The status line is read by screen readers and nobody else. Anything a
   * student pressed a button for is told back on screen as well.
   */
  function notify(title: string, description?: string, type: 'success' | 'info' = 'success') {
    setStatus(description ? `${title} ${description}` : title);
    toast.add({ title, description, type, timeout: 9000 });
  }
  const restored = useRef<SavedBoard | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const lastBucket = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.plannerTheme = theme;
    document.documentElement.style.colorScheme = theme;
    try { deviceStorage()?.setItem(PLANNER_THEME_STORAGE_KEY, theme); } catch { /* theme still applies for this session */ }
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
    () => (isIllinois ? (planCore?.index ?? []) : isUga ? (uga?.courses ?? []) : sampleCourses),
    [isIllinois, isUga, planCore, uga],
  );
  const courseIndex = useMemo(() => indexCourses(catalog), [catalog]);
  const byCode = useMemo(() => {
    const map = new Map<string, Course>();
    for (const course of catalog) map.set(normCode(course.code), course);
    return map;
  }, [catalog]);

  const programOptions = useMemo(() => {
    if (isIllinois) {
      if (isGraduatePlan) {
        return [UNDECIDED_PROGRAM, ...(gradMenu ?? [])
          .filter((p) => p.plannable && p.kind !== 'certificate' && p.kind !== 'minor')
          .map((p) => ({ id: p.id, name: graduateOptionName(p) }))
          .sort((a, b) => a.name.localeCompare(b.name))];
      }
      // A degree closed to new students stays in the menu only for a plan already on it.
      return [UNDECIDED_PROGRAM, ...(core?.programs ?? [])
        .filter((p) => openProgram(p) || (programIds.includes(p.id) && plannableProgram(p)))
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
  }, [isIllinois, isUga, core, uga, programLevel, programIds, isGraduatePlan, gradMenu]);

  /** The Illinois minor pages, for the rail's list (onboarding reads its own copy). */
  const [illinoisMinorFile, setIllinoisMinorFile] = useState<RawMinorFile | null>(null);
  useEffect(() => {
    if (!isIllinois) return;
    let cancelled = false;
    void loadIllinoisMinorFile().then((file) => {
      if (!cancelled) setIllinoisMinorFile(file);
    });
    return () => {
      cancelled = true;
    };
  }, [isIllinois]);
  const minorOptions = useMemo(
    () =>
      isIllinois && !isGraduatePlan
        ? illinoisMinorOptions(illinoisMinorFile).map((option) => ({ id: option.id, name: option.name }))
        : isUga && !isGraduatePlan
        ? (uga?.programs ?? [])
            .filter((program) => program.degree === 'MINOR' && program.areaHours > 0)
            .map((program) => ({ id: program.id, name: program.name }))
        : [],
    [isIllinois, illinoisMinorFile, isUga, isGraduatePlan, uga],
  );
  const certificateOptions = useMemo(
    () =>
      isIllinois && isGraduatePlan
        ? (gradMenu ?? []).filter((p) => p.kind === 'certificate' && p.plannable).map((p) => ({ id: p.id, name: graduateOptionName(p) }))
        : isUga
        ? (uga?.programs ?? [])
            .filter(
              (program) =>
                program.degree === (isGraduatePlan ? 'CERT-GM' : 'CERT-UG') &&
                program.areaHours > 0,
            )
            .map((program) => ({ id: program.id, name: program.name }))
        : [],
    [isUga, isGraduatePlan, uga, isIllinois, gradMenu],
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
    forgetBoard(deviceStorage());
    restored.current = null;
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
      setMinimumTermCredits(nextLevel === 'graduate' ? gradSettings.minimumTermCredits : 12);
      setTargetTermCredits(nextLevel === 'graduate' ? gradSettings.targetTermCredits : null);
      resetProgramPlan();
      if (answers && onAnswersChange) {
        onAnswersChange({
          ...answers,
          programLevel: nextLevel,
          doubleDawgsPathwayId: null,
          programIds: nextProgramIds,
          minorIds: [],
          certificateIds: [],
          emphasisSelections: {},
          collegeId: '',
        });
      }
    },
    [answers, onAnswersChange, programLevel, resetProgramPlan, gradSettings],
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
      onAnswersChange({ ...answers, programIds: next, emphasisSelections, doubleDawgsPathwayId: null });
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
    planRef.current = next;
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
      const parsed = readSavedBoard(deviceStorage(), school?.id ?? '');
      if (!parsed) { forgetChat(deviceStorage()); return; }
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
      restored.current = parsed;
      // Hydrate the browser-only saved settings after mount.
      // oxlint-disable-next-line react/react-compiler
      setMinimumTermCredits(parsed.settings.minimumTermCredits);
      setTargetTermCredits(parsed.settings.targetTermCredits);
      setPlanShape(parsed.settings.planShape);
      planShapeRef.current = parsed.settings.planShape;
      setPriorities(parsed.settings.priorities);
      setCareerInterests(parsed.settings.careerInterests);
      setCareerCleared(parsed.settings.careerCleared);
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
      const bundle = sources.length === selectedProgramIds.length ? combinePrograms(sources) : null;
      const pathway = pathwaysFor(uga.guidance, programIds).find((row) => row.id === answers?.doubleDawgsPathwayId);
      const graduate = pathway?.graduateProgramIds.length === 1 ? uga.programs.find((program) => program.id === pathway.graduateProgramIds[0] && isUgaGraduateDegree(program)) : undefined;
      if (bundle && graduate) {
        bundle.doubleDawgsGraduate = withDoubleDawgsGraduateRules(loadUgaProgram(uga, graduate, { resetRequirements: false, emphasisSelections: answers?.emphasisSelections }), uga.context);
        bundle.urls.push({ name: graduate.name, url: bundle.doubleDawgsGraduate.url });
      }
      setFetched({ key: programKey, value: bundle });
      return;
    }
    if (isIllinois && isGraduatePlan) {
      if (!gradCore || !gradMenu) return;
      const picked = [...programIds, ...certificateIds]
        .map((id) => gradMenu.find((row) => row.id === id))
        .filter((row): row is IllinoisGraduateSummary => Boolean(row));
      for (const course of gradCore.index) {
        // oxlint-disable-next-line react/react-compiler
        course.requirementIds = [];
        course.pathwayRole = undefined;
      }
      let cancelled = false;
      void Promise.all(picked.map((summary) => summary.status === 'reads right' ? loadIllinoisGraduateForBoard(gradCore, summary) : loadIllinoisGraduateNotChecked(gradCore, summary))).then((results) => {
        if (cancelled) return;
        const sources = results.filter((r): r is LoadedGraduateProgram => Boolean(r));
        setFetched({ key: programKey, value: sources.length === picked.length && sources.length > 0 ? combinePrograms(sources as LoadedProgram[]) : null });
      });
      return () => { cancelled = true; };
    }
    if (!isIllinois || !core) return;
    const summaries = programIds
      .map((id) => (core.programs ?? []).find((candidate) => candidate.id === id))
      .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
    for (const course of core.index) {
      // The catalog adapter owns these transient active-program marks.
      // oxlint-disable-next-line react/react-compiler
      course.requirementIds = [];
      course.pathwayRole = undefined;
    }
    let cancelled = false;
    void Promise.all(summaries.map((summary) => loadProgram(core, summary))).then(async (results) => {
      if (cancelled) return;
      const sources = results.filter((result): result is LoadedProgram => Boolean(result));
      const bundle =
        summaries.length === programIds.length && sources.length === programIds.length
          ? combinePrograms(sources)
          : null;
      // Minors (beta) sit beside the degree; a minor the crawl no longer has is dropped, never the board.
      const minorFile = bundle && minorIds.length > 0 ? await loadIllinoisMinorFile() : null;
      if (cancelled) return;
      const minors = minorFile
        ? minorIds.map((id) => loadMinor(core, minorFile, id)).filter((minor): minor is LoadedMinor => Boolean(minor))
        : [];
      setFetched({
        key: programKey,
        value: bundle && minors.length > 0 ? withIllinoisMinors(bundle, minors) : bundle,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isIllinois, isUga, isUndecided, core, uga, programIds, minorIds, selectedProgramIds, programKey, emphasisKey, answers?.emphasisSelections, emphasesComplete, isGraduatePlan, gradCore, gradMenu, certificateIds]);

  const fetchedLoaded = fetched?.key === programKey ? fetched.value : null;
  // UGA core electives the student already holds (a transfer line UGA gives
  // as "SOCI 1GXX") come off the core areas they usually fill, so the board
  // does not book a course there the student does not need (transfer-core.ts).
  // The same object when the record holds none, so no other board changes.
  const transcriptRecord = answers?.transcript ?? null;
  const coreCredit = useMemo(
    () => (isUga && fetchedLoaded ? withCoreCredit(fetchedLoaded.blocks, transcriptRecord) : null),
    [isUga, fetchedLoaded, transcriptRecord],
  );
  const loaded = useMemo(() => {
    if (!fetchedLoaded || !coreCredit || coreCredit.blocks === fetchedLoaded.blocks) return fetchedLoaded;
    return { ...fetchedLoaded, blocks: coreCredit.blocks };
  }, [fetchedLoaded, coreCredit]);
  const programBusy = Boolean(isCatalogSchool && programIds.length > 0 && !isUndecided) && fetched?.key !== programKey;


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
    if (isGraduatePlan) return null;
    const table = core?.admission;
    if (!table || !loaded) return null;
    const words = [answers?.studying ?? '', answers?.timeline ?? '', answers?.after ?? '', careerInterests].join(' ');
    const goal = admissionGoal(table, { college: loaded.program.college, programId: loaded.summary.id, programName: loaded.program.name }, words, answers?.transcript);
    if (!goal) return null;
    const horizon = horizonFor(answers, new Date(), planShape);
    const start = { season: horizon.startSeason, year: horizon.startYear };
    return chooseAdmission(table, goal, readEntry(words, answers?.transcript, start, horizon.began), start);
  }, [core, loaded, answers, careerInterests, planShape, isGraduatePlan]);
  const admissionRoute = admissionChoice?.front ? admissionChoice.route : null;

  // ---- the planning context -------------------------------------------------

  const ugaSamplePlans = useMemo(() => isUga && !isGraduatePlan
    ? samplePlansFor(uga?.guidance ?? null, programIds) : [], [isUga, isGraduatePlan, uga, programIds]);
  const doubleDawgsPathway = isUga && !isGraduatePlan
    ? pathwaysFor(uga?.guidance ?? null, programIds).find((pathway) => pathway.id === answers?.doubleDawgsPathwayId)
    : undefined;

  const context: PlanningContext | null = useMemo(() => {
    if (isIllinois && planCore) return buildContext(planCore, loaded?.blocks ?? [], null).context;
    if (isUga && uga) return {
      ...uga.context,
      samplePlanCourses: sampleCoursesFor(ugaSamplePlans, Object.fromEntries(programIds.map((id) => [id,
        emphasisRequirements.filter((requirement) => requirement.programId === id).flatMap((requirement) =>
          requirement.options.filter((option) => answers?.emphasisSelections[requirement.id]?.includes(option.id)).map((option) => option.label),
        ),
      ]))),
    };
    return null;
  }, [isIllinois, isUga, planCore, uga, loaded, ugaSamplePlans, programIds, emphasisRequirements, answers?.emphasisSelections]);
  const boardContext = useMemo(() => doubleDawgsContext(plan, context), [plan?.doubleDawgs, context]);

  // ---- clubs ----------------------------------------------------------------

  /**
   * Who "Clubs for your goals" ranks for, over the deferred career words: the
   * Illinois goal box commits on every keystroke, and the clubs follow the
   * words without re-ranking on each letter. Nothing here touches the board.
   */
  const deferredCareer = useDeferredValue(careerText);
  const clubStudent = useMemo(
    () => (isIllinois ? clubStudentFor(deferredCareer, loaded, answers) : null),
    [isIllinois, deferredCareer, loaded, answers],
  );
  /** The first goal the student named: ALMA's clubs opener asks about it in place of tuition. */
  const clubGoal = clubStudent ? (clubStudent.profile.tracks[0]?.name ?? clubStudent.profile.topics.find((t) => clubStudent.profile.heard.includes(t.label))?.label ?? null) : null;
  /** The club file once it has loaded, for describeBoard. The rail and find_clubs share its one fetch. */
  const clubFile = useRef<IllinoisClubsFile | null>(null);
  useEffect(() => {
    if (!isIllinois) return;
    void loadIllinoisClubs().then((r) => {
      if (r.ok) clubFile.current = r.value;
    });
  }, [isIllinois]);
  /** The clubs card's "Change my goals": the rail open, Preferences open, the cursor in the goals box. */
  function editGoals() {
    setRailOpen(true);
    requestAnimationFrame(() => {
      const preferences = document.getElementById('rail-preferences');
      if (preferences instanceof HTMLDetailsElement) preferences.open = true;
      document.getElementById('rail-career')?.focus();
    });
  }

  // ---- the plan -------------------------------------------------------------

  const buildPlan = useCallback(() => {
    if (!isCatalogSchool) {
      const sample = createSamplePlan();
      replaceActivePlan(sample);
      repickedFor.current = null;
      studentAdded.current = new Set();
      setPlanNotes([]);
      setReport(null);
      setBoardEdited(false);
      setTargetTermId(sample.terms[0]?.id ?? '');
      // The demo plan names its own program. Without this the rail reads
      // "No degree chosen" above a board full of that degree's courses.
      setProgramIds((current) => current.length > 0 ? current : [sample.programId]);
      return;
    }
    if (!context) return;

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
      [...examCourses(exams, examCredit.entries, (code) => byCode.has(code)), ...transcriptCodes(answers?.transcript), ...(answers?.alreadyTakenCourseCodes ?? [])],
      Boolean(answers?.transcript),
      // Hours with no course to hold them: AP credit granted as "ECON 1--",
      // and every transfer line the student is counting as hours toward the
      // total, which is what Illinois grants a transferable course at minimum.
      priorHoursOf(answers, exams, examCredit.entries, catalogCredits),
      answers?.languageYears ?? null,
      answers?.language ?? null,
    ), answers, exams, examCredit.entries, catalogCredits);
    const horizon = horizonFor(answers, new Date(), planShape);
    // Terms the student has been here with nothing on a record for them yet
    // count as about 15 credits each (horizonFor says which), so the terms
    // left are not loaded to 18 to fit the whole degree.
    const priorHere = horizon.assumedHours > 0 ? { ...prior, unmatchedCredits: prior.unmatchedCredits + horizon.assumedHours } : prior;

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
    if (doubleDawgsPathway && !loaded.doubleDawgsGraduate) {
      setStatus("This pathway's graduate degree is not linked to a catalog curriculum yet. Choose another pathway or remove it to build a bachelor's-only plan.");
      return;
    }


    const publishedTotal = loaded.summary.totalCredits || loaded.program.totalCredits || null;
    /**
     * An unstated finish counted from when the student began can leave too
     * few terms for one who is behind ("Senior, started fall 2023" with 72
     * hours got one term). The credit fit only ever shortens a plan, so it is
     * lengthened here, to the terms nearest 15 a term (never over 18) and
     * never past eight from the plan's start, and only when 18 a term could
     * not hold what is left.
     */
    if (isIllinois && !isGraduatePlan && !horizon.stated && horizon.began) {
      const held = priorHere.courseCodes.reduce((sum, code) => sum + (byCode.get(normCode(code))?.credits ?? 0), 0) + priorHere.unmatchedCredits;
      const left = (publishedTotal || 120) - held;
      const awayAt = new Set((horizon.away ?? []).map((a) => termOrd(a.season, a.year)));
      const campusUntil = (lastOrd: number) => {
        let n = 0;
        for (let k = 0; k < 40; k++) {
          const t = stepRegular({ season: horizon.startSeason, year: horizon.startYear }, k);
          if (termOrd(t.season, t.year) > lastOrd) break;
          if (!awayAt.has(termOrd(t.season, t.year))) n += 1;
        }
        return n;
      };
      const campusNow = campusUntil(termOrd(horizon.gradSeason, horizon.gradYear));
      const want = Math.min(8, Math.max(Math.ceil(left / 18), Math.round(left / 15)));
      if (left > campusNow * 18 && want > campusNow) {
        for (let k = 0, campus = 0; k < 40 && campus < want; k++) {
          const t = stepRegular({ season: horizon.startSeason, year: horizon.startYear }, k);
          if (awayAt.has(termOrd(t.season, t.year))) continue;
          campus += 1;
          horizon.gradSeason = t.season;
          horizon.gradYear = t.year;
        }
      }
    }
    let planInput: AutoplanInput = {
      requirements: loaded.blocks,
      context,
      prior: priorHere,
      horizon,
      preferences: { creditsPerTerm: { min: minimumTermCredits, target: targetTermCredits, max: 18 }, priorities },
      programId: loaded.summary.id,
        electiveHoursLimit:
          isUga && 'electiveHours' in loaded ? loaded.electiveHours : undefined,
        fillToDegreeTotal:
          isUga && 'fillToDegreeTotal' in loaded
            ? loaded.fillToDegreeTotal
            : undefined,
        standingHours: isGraduatePlan
          ? gradSettings.standingHours
          : undefined,
        electiveLevelRange: isGraduatePlan
          ? gradSettings.electiveLevelRange
          : undefined,
        autoPrerequisiteLevelRange: isGraduatePlan
          ? gradSettings.autoPrerequisiteLevelRange
          : undefined,

      // The published total is what the plan must reach; the blocks alone
      // name 82 of Finance's 124 credits. The student's own words rank the
      // electives that fill the rest.
      // A published total of 0 is a page the crawl could not read a total from,
      // not a degree of no credits: English BALAS planned 2 terms and 28 hours.
      degreeTotal: publishedTotal || (isIllinois && !isGraduatePlan ? 120 : null),
      interests: [answers?.studying ?? '', careerText].join(' '),
      // Goals come from what the student wants to do, never from the major's
      // name: "Psychology" alone was booking psychopathology as their goal.
      career: careerText,
      programName: loaded.program.name,
      programCollege: loaded.program.college,
      arrival: arrivalOf(answers),
      // The review's own rule, so the planner arranges year one for the
      // student the review measures it for, and no one else.
      firstYear: isIllinois && !isGraduatePlan && enteringAsFirstYear([answers?.studying ?? '', answers?.timeline ?? '', answers?.after ?? ''].join(' '), answers?.transcript),
      admissionRoute,
      // Illinois's residency rule, from its transfer-credit page: 45 hours at
      // Illinois, 21 of them at the 300 level or above. What the student has
      // already taken here comes from their own record; transfer and exam
      // credit is not residence, whatever course it became.
      residency: isIllinois && !isGraduatePlan
        ? {
            hours: 45,
            upperLevel: 21,
            heldHours: transcriptResidentHours(answers?.transcript).total,
            heldUpper: transcriptResidentHours(answers?.transcript).upper,
            source: 'https://admissions.illinois.edu/transferring-credit/',
          }
        : null,
    };
    /**
     * A transfer line the planner only thinks "may be" a course (Parkland's
     * BUS 101 "may be BUS 101"): where the board would book that course, it
     * is held for the build instead, with the hours held unchanged, so the
     * board does not schedule what the student may already have; the board
     * below then leaves its requirement open until the student confirms or
     * rejects the line (transfer-maybe.ts). No such line, the same one build.
     */
    let generated: GeneratedPlan;
    let maybe: { codes: string[] } = { codes: [] };
    try {
      const held = holdMaybe(planInput.prior, answers?.transcript, (code) => byCode.get(normCode(code))?.credits ?? null, (p) => {
        if (doubleDawgsPathway && loaded.doubleDawgsGraduate && uga) {
          const finish = { season: horizon.gradSeason, year: horizon.gradYear };
          const options = doubleDawgsOptions(doubleDawgsPathway, loaded, loaded.doubleDawgsGraduate, byCode, uga.dualLevelCourses);
          return generateDoubleDawgs({ undergraduate: { ...planInput, prior: p }, undergraduateProgram: loaded.program, graduate: loaded.doubleDawgsGraduate, pathway: doubleDawgsPathway,
            shared: selectSharedCourses(doubleDawgsPathway, options, answers?.doubleDawgsSharedCodes, p.courseCodes),
            graduateFinish: answers?.doubleDawgsGraduateSeason && answers?.doubleDawgsGraduateYear ? { season: answers.doubleDawgsGraduateSeason, year: answers.doubleDawgsGraduateYear } : defaultGraduateFinish(finish),
          });
        }
        return generatePlan({ ...planInput, prior: p });
      });
      if (held.codes.length > 0) planInput = { ...planInput, prior: held.prior };
      maybe = held;
      generated = held.generated;
    }
    catch (error) { setStatus(`The draft could not be generated: ${error instanceof Error ? error.message : 'unknown error'}`); return; }
    let builtFrom = planInput;
    /**
     * "Spread my hard classes out": one hardest-band course a term, kept only
     * when it costs nothing. At one a term a Computer Engineering plan with
     * six required hardest-band courses and six terms had nowhere for a
     * seventh, grew two terms and nineteen credits, and said nothing about
     * why. spreadHardOutcome decides, and its note names the check that
     * failed or says what the kept plan really does.
     */
    if (planShape.spreadHard && !doubleDawgsPathway) {
      const spreadInput = { ...planInput, preferences: { ...planInput.preferences, maxHardCourses: 1 } };
      const spread = generatePlan(spreadInput);
      const outcome = spreadHardOutcome(generated, spread, {
        difficulty: (code) => context.grades?.get(code)?.difficulty ?? null,
        bands: context.bands ?? null,
      });
      if (outcome.adopt) {
        generated = spread;
        builtFrom = spreadInput;
      }
      generated.notes.push(outcome.note);
    }

    // What compare_programs rebuilds with a second program's courses beside these.
    lastBuild.current = { input: builtFrom, plan: generated };

    /**
     * Illinois minors (beta), degree first: the plan above is the degree's
     * own, and planBesideDegree adds what fits of each checked minor without
     * costing the degree a row the rail shows met, a term over 18 or a term
     * past the finish. compare_programs keeps the degree's own plan above.
     */
    const minorsToPlan = isIllinois ? (loaded.minors ?? []).filter((minor) => minor.checked) : [];
    if (minorsToPlan.length > 0) {
      const heldCodes = priorHere.courseCodes.map(normCode);
      const codesOf = (g: GeneratedPlan) => g.terms.flatMap((term) => term.codes.map(normCode));
      const degreeRows = (g: GeneratedPlan) => illinoisProgress({
        blocks: loaded.blocks,
        boardCodes: codesOf(g),
        priorCodes: heldCodes,
        byCode,
        pools: livePools({ base: g.pools.filter((pool) => !pool.requirementId.startsWith(MINOR_ID_PREFIX)), blocks: loaded.blocks, boardCodes: codesOf(g), priorCodes: heldCodes, context }),
        language: g.language,
        satisfiedByPriorCredit: g.satisfiedByPriorCredit,
        languages: core?.languages ?? null,
        equivalents: core?.equivalents ?? undefined,
        degreeTotal: publishedTotal,
        programName: loaded.program.name,
      });
      const before = degreeRows(generated);
      const spreadNote = planShape.spreadHard ? (generated.notes[generated.notes.length - 1] ?? null) : null;
      const outcome = planBesideDegree(generatePlan, builtFrom, generated, minorsToPlan, {
        heldCodes,
        creditsOf: (code) => byCode.get(normCode(code))?.credits ?? null,
        degreeCheck: (g) => {
          const now = degreeRows(g);
          const lost = before.filter((row, index) => row.satisfied && !now[index]?.satisfied);
          return lost.length > 0 ? `it would leave ${lost.map((row) => row.area.label).join('; ')} short` : null;
        },
      });
      const chosen = outcome.generated;
      const notes = chosen === generated ? [...generated.notes] : [...chosen.notes, ...(spreadNote ? [spreadNote] : [])];
      // The minor's own rows are the rail's to show, with its name on them,
      // and what did not fit is in the notes: its pools, unmet rows and
      // unplaced courses would otherwise reach the review list as the degree's.
      generated = {
        ...chosen,
        pools: chosen.pools.filter((pool) => !pool.requirementId.startsWith(MINOR_ID_PREFIX)),
        unsatisfied: chosen.unsatisfied.filter((row) => !row.requirementId.startsWith(MINOR_ID_PREFIX)),
        notPlaced: chosen.notPlaced.filter((row) => !(row.requirementId ?? '').startsWith(MINOR_ID_PREFIX)),
        notes: [...notes, ...minorPlanNotes(outcome, minorsToPlan)],
      };
      const major = majorCodesOf(generated.bookedFor ?? {}, loaded.blocks);
      for (const minor of minorsToPlan) {
        const counted = illinoisProgress({
          blocks: minor.blocks, boardCodes: codesOf(generated), priorCodes: heldCodes, byCode, pools: [],
          language: null, satisfiedByPriorCredit: [], equivalents: core?.equivalents ?? undefined, degreeTotal: null, programName: minor.name,
        }).flatMap((row) => row.codes ?? []);
        const apart = upperLevelApart(counted, major, (code) => byCode.get(normCode(code))?.credits ?? null);
        if (apart.hours < MINOR_UPPER_APART_HOURS) generated.notes.push(upperApartNote(minor.name, apart));
      }
    }
    if (isIllinois) {
      for (const minor of loaded.minors ?? []) if (!minor.checked) generated.notes.push(uncheckedMinorNote(minor));
    }

    // A graduation already under way leaves a one-term board shown only in
    // case plans change; a shortfall against it is a finish nobody gave.
    if (horizon.gradPassed) generated.notes = generated.notes.filter((n) => !n.startsWith('Finishing by '));
    /**
     * A plan that ends before the finish the student named says how to use
     * every term to it instead, where the numbers under Preferences do that
     * (autoplan.ts earlyFinish). Illinois only: UGA's fill does not spread
     * to a lighter number yet (13 a term gave five terms of 15, one of 12
     * and a last term of 3), so its note gives the arithmetic alone.
     */
    const early = generated.earlyFinish;
    if (isIllinois && early?.settings) {
      const { target, minimum } = early.settings;
      const howTo = minimum === minimumTermCredits
        ? ` To plan it that way, put ${target} in Preferences under "Credits you want each term, about" and press Rebuild.`
        : ` To plan it that way, put ${target} in Preferences under "Credits you want each term, about" and ${minimum} under "at least", then press Rebuild.`;
      generated.notes = generated.notes.map((n) => (n === early.note ? n + howTo : n));
    }
    if (horizon.startNote) generated.notes.unshift(horizon.startNote);
    if (!publishedTotal && isIllinois && !isGraduatePlan) {
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
    if (maybe.codes.length > 0) {
      const keep = new Set(prior.courseCodes.map(normCode));
      generated = {
        ...generated,
        plan: openMaybeOnBoard(generated.plan, maybe.codes, (code) => byCode.get(normCode(code))?.id, (code) => context.equivalents?.get(code) ?? [], keep),
        satisfiedByPriorCredit: withoutMaybe(generated.satisfiedByPriorCredit, maybe.codes),
      };
    }
    // The student's instructor picks stay with every course still in the same term.
    const codeOfId = planRef.current?.instructors ? new Map([...byCode.values()].map((c) => [c.id, c.code])) : null;
    replaceActivePlan(codeOfId ? carryInstructors(planRef.current, generated.plan, (id) => codeOfId.get(id)) : generated.plan);
    setChooser(null);
    setChooserOnMap(false);
    setTargetTermId(generated.plan.terms[0]?.id ?? '');
    setPlanNotes(generated.notes);
    // Only the parts of the report a board edit cannot change (reportOf).
    setReport(reportOf(generated));
    repickedFor.current = repickSignature(priorities, planInput.interests ?? '');
    studentAdded.current = new Set();
    setBoardEdited(false);
    /**
     * A rebuild starts the undo history over, except one ALMA asked for in a
     * turn ("take summer classes in 2027", "I took CHEM 102 at Parkland"):
     * that turn's single step already holds the board from before it, and
     * "Undo these changes" has to be able to put it back.
     */
    if (keepUndoOnBuild.current) keepUndoOnBuild.current = false;
    else setUndoStack([]);
    // What the build says is decided once the board's own issues are
    // computed for it (the effect after `issues`): the all-clear follows
    // every check the board shows, not only unplaced courses.
    announceBuild.current = true;
  }, [isCatalogSchool, isUga, isGraduatePlan, isUndecided, core, context, loaded, answers, byCode, minimumTermCredits, targetTermCredits, examCredit, careerInterests, careerText, replaceActivePlan, priorities, admissionRoute, admissionChoice, isIllinois, exams, examsAligned, catalogCredits, planShape, doubleDawgsPathway, uga]);

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
  const creditKey = creditKeyOf(answers);
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
    notify('Plan rebuilt to your new shape', boardEdited ? 'Your earlier edits to the board were replaced.' : undefined, 'info');
    // Keyed on the shape; the rest is read fresh when it fires.
  }, [shapeKey, plan, context, loaded, boardEdited, buildPlan]);
  useEffect(() => {
    if (lastCreditKey.current === null) {
      lastCreditKey.current = creditKey;
      return;
    }
    if (lastCreditKey.current === creditKey) return;
    lastCreditKey.current = creditKey;
    // An undo put the record back together with the board built for it.
    if (creditRestored.current) {
      creditRestored.current = false;
      return;
    }
    if (!plan || !context || !loaded) return;
    const forced = rebuildForCredit.current;
    rebuildForCredit.current = false;
    if (forced || !boardEdited) {
      buildPlan();
      notify('Plan rebuilt around your credit', forced && boardEdited ? 'Your earlier edits to the board were replaced.' : undefined, 'info');
    } else {
      notify('Your credit changed', 'Press Rebuild to plan around it; your edits to the board would be replaced.', 'info');
    }
    // Only a change in the key does anything; the other dependencies are read
    // fresh when it does and are otherwise a no-op through the early return.
  }, [creditKey, plan, context, loaded, boardEdited, buildPlan]);

  /** Put a board back: an undo step, or the board saved on this device. */
  function applyBoard(state: BoardState) {
    planRef.current = state.plan;
    setPlan(state.plan);
    setReport(state.report);
    setPlanNotes(state.notes);
    studentAdded.current = new Set(state.studentAdded);
    repickedFor.current = state.repickedFor;
    setBoardEdited(state.edited);
    setChooser(null);
  }

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
        saved.board.plan;
      setPlanTabs(
        savedPlans.length > 0
          ? savedPlans
          : [{ id: activeId, name: 'Plan 1', groupId: fallbackGroupId, plan: activePlan }],
      );
      setPlanGroups(restoredGroups);
      setActivePlanId(activeId);
      setPlan(activePlan);
      planRef.current = activePlan;
      const activeBoard = savedPlans.find((candidate) => candidate.id === activeId)?.board ?? saved.board;
      setReport(activeBoard.report);
      setPlanNotes(activeBoard.notes);
      studentAdded.current = new Set(activeBoard.studentAdded);
      repickedFor.current = activeBoard.repickedFor;
      setBoardEdited(activeBoard.edited);
      setTargetTermId(activePlan.terms[0]?.id ?? '');
      setStatus('Your saved plan, restored from this device.');
      // A board saved before its first term's add deadline, reopened after it,
      // still books that term. Say so rather than rebuild without asking.
      const first = saved.board.plan.terms.find((t) => t.season !== 'Summer');
      const open = firstOpenTerm(new Date());
      const firstYear = Number(first?.label.match(/\b(20\d\d)\b/)?.[1] ?? NaN);
      if (isIllinois && first && Number.isFinite(firstYear) && termOrd(first.season, firstYear) < termOrd(open.season, open.year)) {
        // Autosave writes the notes back, so an earlier copy of this note is replaced, not stacked.
        const restoreNote = `This plan was saved when ${first.label} was still open. Adding ${first.label} classes has closed; press Rebuild to plan from ${open.season} ${open.year}, or keep this board if those are the classes you are taking.`;
        setPlanNotes([restoreNote, ...saved.board.notes.filter((n) => !n.startsWith('This plan was saved when '))]);
      }
      return;
    }
    if (!isCatalogSchool || (context && (loaded || isUndecided))) buildPlan();
  }, [plan, isCatalogSchool, isIllinois, isUndecided, context, loaded, buildPlan]);

  // ---- saved on this device -------------------------------------------------

  /**
   * The board is saved after every change, a moment after the last one, with
   * everything its cards are read through. It used to be saved only when the
   * student pressed "Save on this device", and then without its report: a
   * student who reloaded got a board rebuilt from the About-you answers, or
   * one with every slot, list chip and track mark gone, next to an ALMA
   * conversation about courses no longer on it.
   *
   * The write that is still waiting goes out when the page is hidden or
   * closed, so a reload straight after a change keeps it. Nothing asks
   * "Leave site?": there is nothing unsaved to warn about.
   */
  /** The write waiting to go out: the entry, and its body without the time, to compare the next one with. */
  const pendingSave = useRef<{ payload: string; body: string } | null>(null);
  const lastSaved = useRef<string | null>(null);
  /** Write what is waiting, if anything; false when the browser refused it. */
  const writePending = useCallback((): boolean | null => {
    const pending = pendingSave.current;
    if (!pending) return null;
    pendingSave.current = null;
    const ok = writeSavedBoard(deviceStorage(), pending.payload);
    if (ok) lastSaved.current = pending.body;
    return ok;
  }, []);
  useEffect(() => {
    if (!plan) {
      // Between a new degree or a new setup and its first board, the board
      // that was here is not written back.
      pendingSave.current = null;
      return;
    }
    const saved: Omit<SavedBoard, 'savedAt'> = {
      schemaVersion: 4,
      schoolId: school?.id ?? '',
      programId,
      programIds, minorIds, certificateIds,
      emphasisSelections: answers?.emphasisSelections ?? {},
      plans: planTabs.map((tab) => tab.id === activePlanId ? {
        ...tab, plan, board: { plan, report, notes: planNotes, studentAdded: [...studentAdded.current], repickedFor: repickedFor.current, edited: boardEdited },
      } : tab),
      planGroups, activePlanId,
      board: {
        plan,
        report,
        notes: planNotes,
        studentAdded: [...studentAdded.current],
        repickedFor: repickedFor.current,
        edited: boardEdited,
      },
      settings: { minimumTermCredits, targetTermCredits, careerInterests, careerCleared, priorities, planShape },
    };
    const body = JSON.stringify(saved);
    if (body === lastSaved.current) {
      // Back to what is on the device already (an undo before the write).
      pendingSave.current = null;
      return;
    }
    pendingSave.current = { payload: serializeBoard({ ...saved, savedAt: new Date().toISOString() }), body };
    const timer = window.setTimeout(() => {
      const ok = writePending();
      if (ok !== null) setSaveState(ok ? 'saved' : 'failed');
    }, 400);
    return () => window.clearTimeout(timer);
  }, [plan, report, planNotes, boardEdited, programId, programIds, minorIds, certificateIds, answers?.emphasisSelections, planTabs, planGroups, activePlanId, school, minimumTermCredits, targetTermCredits, careerInterests, careerCleared, priorities, planShape, saveTick, writePending]);
  useEffect(() => {
    const flush = () => {
      const ok = writePending();
      if (ok !== null) setSaveState(ok ? 'saved' : 'failed');
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [writePending]);

  /**
   * End this board on this device: the saved board and ALMA's conversation
   * about it, together, and any write still waiting, so a reload straight
   * after Start over does not put the old board back.
   */
  function forgetThisBoard() {
    pendingSave.current = null;
    lastSaved.current = null;
    forgetBoard(deviceStorage());
  }

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

  const completedCourses = useMemo(() => {
    const codes = (plan?.completedCourseIds ?? []).flatMap((id) => {
      const course = courseIndex.get(id);
      return course ? [course.code] : [];
    });
    const unique = context ? distinctHeld(codes, context).codes : codes;
    return unique.flatMap((code) => {
      const course = byCode.get(normCode(code));
      return course ? [{ code: course.code, title: course.title }] : [];
    });
  }, [plan, courseIndex, context, byCode]);
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
  /**
   * Terms the student has been here with nothing on the record for them, as
   * the build counts them (about 15 credits each, see horizonFor). The rail's
   * total and ALMA count them too, so a plan built to reach 120 with them
   * never reads as short.
   */
  const assumedCredit = useMemo(() => {
    if (!isIllinois || !loaded) return { hours: 0, terms: '' };
    const h = horizonFor(answers, new Date(), planShape);
    const names = h.assumedTerms.map((t) => `${t.season} ${t.year}`);
    return { hours: h.assumedHours, terms: names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '') };
  }, [isIllinois, loaded, answers, planShape]);

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
    if (plan?.doubleDawgs && loaded?.doubleDawgsGraduate) {
      const ledger = doubleDawgsLedger(plan, context, [...completedCodes]);
      if (!ledger) return [];
      const graduateIds = new Set(loaded.doubleDawgsGraduate.blocks.map((block) => block.id));
      return [
        ...livePools({ base: report.pools.filter((pool) => !graduateIds.has(pool.requirementId)), blocks: sharedUndergraduateRequirements(loaded.blocks, plan.doubleDawgs.shared.filter((row): row is { code: string; undergraduateCode: string; credits: number } => Boolean(row.undergraduateCode))), boardCodes: ledger.undergraduateCodes, priorCodes: [], context }),
        ...livePools({ base: report.pools.filter((pool) => graduateIds.has(pool.requirementId)), blocks: loaded.doubleDawgsGraduate.blocks, boardCodes: ledger.graduateCodes, priorCodes: [], context, reserveRequired: true, independentIds: new Set(['double-dawgs:ai-graduate-only']) }),
      ];
    }
    return livePools({
      base: report.pools,
      blocks: loaded?.blocks ?? [],
      boardCodes,
      priorCodes: [...completedCodes],
      context,
    });
  }, [report, context, loaded, boardCodes, completedCodes, plan]);

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
        // Terms assumed until the student adds them (assumedCredit) count toward what they said.
        if (recorded + assumedCredit.hours >= said - 6) return [];
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
      // A transfer line that only "may be" a course the board would have
      // booked: the course is not booked and its requirement is open until
      // the student says.
      ...maybeIssues(answers?.transcript, firstTerm, (plan?.maybeCourseIds ?? []).map((id) => courseIndex.get(id)?.code ?? '').filter(Boolean)),
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
        // Neither "Technical Electives: Technical Electives" nor "null: Core
        // Chemistry" (see reviewTitle).
        title: reviewTitle(u.areaLabel, u.label),
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
  }, [report, pools, answers, examCredit, completedCodes, context, school, exams, catalogCredits, admissionChoice, plan?.maybeCourseIds, courseIndex]);

  /**
   * Illinois's published class schedules by term id (Fall 2026, Spring 2027),
   * for the weekly clash check. The first is in the core already; the rest
   * load here once. Until they do, only the first term is checked.
   */
  const [weeklySchedules, setWeeklySchedules] = useState<Map<string, WeeklySchedule> | null>(null);
  useEffect(() => {
    if (!isIllinois || !core) return;
    let active = true;
    void loadIllinoisSectionTerms()
      .then((maps) => {
        if (active) setWeeklySchedules(maps);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isIllinois, core]);

  /**
   * For each board term whose class schedule is published, whether its
   * courses can be registered together without two classes at the same hour
   * (weekly-fit.ts). Shown on the column, in the review and to ALMA; it never
   * moves a course. Later terms have no published times and are not checked.
   */
  const weeklyFits = useMemo(() => {
    const out = new Map<string, WeeklyFit>();
    if (!plan || !isIllinois) return out;
    const first = core?.meta?.term?.id && core.sections ? new Map<string, WeeklySchedule>([[core.meta.term.id, core.sections]]) : null;
    const maps = weeklySchedules ?? first;
    if (!maps) return out;
    for (const term of plan.terms) {
      const schedule = maps.get(term.id);
      if (!schedule || term.courseIds.length === 0) continue;
      const codes = term.courseIds.map((id) => courseIndex.get(id)?.code).filter((c): c is string => Boolean(c));
      out.set(term.id, weeklyFit(codes, schedule));
    }
    return out;
  }, [plan, isIllinois, weeklySchedules, core, courseIndex]);
  /** The degree on screen, from whichever source this school has. */
  const activeProgramName =
    plan?.doubleDawgs?.pathwayName ?? loaded?.program.name ??
    (programIds
        .map((id) => programOptions.find((program) => program.id === id)?.name)
        .filter((name): name is string => Boolean(name))
        .join(' + ') || null);
  const combinedLedger = useMemo(() => plan && context ? doubleDawgsLedger(plan, context, [...completedCodes], Math.max(0, priorCreditHours - planCreditRange([...completedCodes], context).min)) : null, [plan, context, completedCodes, priorCreditHours]);
  const activeProgramTotal =
    combinedLedger?.requiredUniqueCredits || loaded?.program.totalCredits ||
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
    const assumed = assumedCredit.hours;
    return {
      planned,
      prior,
      ...(away > 0 ? { away } : {}),
      total: {
        min: planned.min + prior + away + assumed,
        max: planned.max + prior + away + assumed,
        variable: planned.variable,
        unknown: planned.unknown,
      },
      ...shell,
    };
  }, [plan, context, boardCodes, activeProgramTotal, priorCreditHours, report, assumedCredit]);

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
  const creditNote = combinedLedger && plan?.doubleDawgs
    ? `Bachelor's: ${combinedLedger.undergraduateCredits}/${plan.doubleDawgs.undergraduateCredits} credits. Master's: ${combinedLedger.graduateCredits}/${plan.doubleDawgs.graduateCredits}. ${combinedLedger.sharedCredits} shared credits count toward both; taken only once.`
    : context && assumedCredit.hours > 0
      ? `${describeCreditTotal(credits.total)}${activeProgramTotal === null ? '' : ` of the ${activeProgramTotal} this degree takes`}. ${[
          credits.prior > 0 ? `${credits.prior} of those you already have` : null,
          `about ${assumedCredit.hours} are counted for ${assumedCredit.terms} until you add those classes`,
          (credits.away ?? 0) > 0 ? `${credits.away} are expected from your time abroad` : null,
          `${describeCreditTotal(credits.planned)} are in the plan`,
        ].filter(Boolean).join(', ')}.`
      : context && (credits.prior > 0 || (credits.away ?? 0) > 0)
        ? describeCreditProgress(credits, activeProgramTotal)
        : null;

  const areas: AreaRow[] = useMemo(() => {
    if (!loaded || !plan) return [];
    if (plan.doubleDawgs && context && loaded.doubleDawgsGraduate) return doubleDawgsProgress(plan, context, loaded.program, loaded.doubleDawgsGraduate.program, [...completedCodes], Math.max(0, priorCreditHours - planCreditRange([...completedCodes], context).min));
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
      const degreeRows = illinoisProgress({
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
        genEdCredits: isGraduatePlan ? [] : genEdCreditsOf(answers, exams, examCredit.entries, catalogCredits),
        programName: loaded.program.name,
      });
      const plannedMinors = (loaded.minors ?? []).filter((minor) => minor.checked);
      if (plannedMinors.length === 0) return degreeRows;
      /**
       * A checked minor's rows follow the degree's, each with the minor's
       * name, counted on a ledger of their own: a course may count for the
       * degree and the minor at once (campus rule), so the degree's rows
       * never decide what the minor's may count. Then the campus rule the
       * plan cannot always arrange: 6 upper-level minor hours apart from the major.
       */
      const major = majorCodesOf(report?.bookedFor ?? {}, loaded.blocks);
      return [
        ...degreeRows,
        ...plannedMinors.flatMap((minor): AreaRow[] => {
          const rows = illinoisProgress({
            blocks: minor.blocks, boardCodes, priorCodes: towardDegree.codes, byCode, pools: [],
            language: null, satisfiedByPriorCredit: [], equivalents: core?.equivalents ?? undefined, degreeTotal: null, programName: minor.name,
          });
          const apart = upperLevelApart(rows.flatMap((row) => row.codes ?? []), major, (code) => byCode.get(normCode(code))?.credits ?? null);
          const earned = Math.min(MINOR_UPPER_APART_HOURS, apart.hours);
          return [
            ...rows.map((row) => ({ ...row, area: { ...row.area, label: `${minor.name} · ${row.area.label}` } })),
            {
              area: { label: `${minor.name} · 300/400-level hours not also used for your major (campus rule)`, hours: MINOR_UPPER_APART_HOURS, groups: [] },
              earned,
              percent: Math.round((earned / MINOR_UPPER_APART_HOURS) * 100),
              satisfied: apart.hours >= MINOR_UPPER_APART_HOURS,
              needed: MINOR_UPPER_APART_HOURS,
              unit: 'hr',
              note: apart.codes.length > 0 ? `Counting ${apart.codes.join(', ')}.` : 'No upper-level minor course apart from the major yet.',
              codes: apart.codes,
            },
          ];
        }),
      ];
    }
    const have = new Set<string>(completedCodes);
    for (const term of plan.terms) {
      for (const id of term.courseIds) {
        const course = courseIndex.get(id);
        if (course) have.add(normCode(course.code));
      }
    }
    const counted: AreaRow[] = areaProgress(
      loaded.program,
      have,
      context?.equivalents,
      { allowCrossAreaOverlap: isUga },
    );
    if (!isUga) return counted;
    // Core electives from transfer credit count toward the core area they
    // fill, as the plan build counted them (transfer-core.ts).
    const coreUsed = coreCredit?.used ?? [];
    const progress = coreUsed.length === 0 ? counted : counted.map((row) => {
      const mine = coreUsed.filter((u) => u.area === row.area.label);
      if (mine.length === 0) return row;
      const earned = Math.min(row.area.hours, row.earned + mine.reduce((sum, u) => sum + u.hours, 0));
      return {
        ...row,
        earned,
        percent: row.area.hours ? Math.round((earned / row.area.hours) * 100) : 0,
        satisfied: row.area.hours > 0 && earned >= row.area.hours,
        note: `${row.note ? `${row.note} ` : ''}Includes ${mine.map((u) => u.line).join(', ')} from your transfer credit.`,
      };
    });

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
    context,
    credits.total.min,
    isIllinois, core, boardCodes, byCode, pools, report, activeProgramTotal, answers, examCredit, exams, catalogCredits, coreCredit, priorCreditHours,
  ]);

  /**
   * The review list follows the edited board, not only the generation report.
   * A plan may be valid when generated and stop being valid after a course is
   * removed or replaced, so the first red row gives the overall consequence
   * before the specific prerequisite and requirement details below it.
   */
  const issues = useMemo(() => {
    if (!plan) return [];
    const validation = boardContext
      ? validatePlan(plan, boardContext, {
          minimumTermCredits, programName: loaded?.program.name, programCollege: isIllinois && !isGraduatePlan ? loaded?.program.college : undefined,
          standingHours: isGraduatePlan ? gradSettings.standingHours : undefined,
          priorCredits: priorCreditHours, away: report?.away, language: report?.language,
          firstYear: isIllinois && !isGraduatePlan ? enteringAsFirstYear([answers?.studying ?? '', answers?.timeline ?? '', answers?.after ?? ''].join(' '), answers?.transcript) : false,
          arrival: isIllinois && !isGraduatePlan ? arrivalOf(answers) : undefined,
        }).filter(
          (issue) => (!isUga || !issue.id.startsWith('ap-weighed-')) && !(plan.doubleDawgs && issue.id.startsWith('ap-minimum-') && plan.terms.some((term) => term.id === issue.termId && degreeTermOrder(term) > degreeTermOrder(plan.doubleDawgs!.undergraduateFinish))),
        )
      : [];
    // A term whose published class times leave no clash-free choice of
    // sections. Reported only: the plan is not changed for it.
    const clashes: PlanIssue[] = plan.terms.flatMap((term) => {
      const fit = weeklyFits.get(term.id);
      if (fit?.status !== 'clash' || !fit.line) return [];
      return [
        {
          id: `weekly-clash-${term.id}`,
          severity: 'warning' as const,
          title: 'Class times clash',
          message: `${term.label}: ${fit.line}. In Illinois's published ${term.label} class schedule no choice of their sections keeps them apart, and registration will not take two classes that meet at once. Move one to another term or swap it for another course.`,
          termId: term.id,
        },
      ];
    });
    const rows = context
      ? [...unmet, ...validation, ...clashes, ...doubleDawgsIssues(plan, context, [...completedCodes], Math.max(0, priorCreditHours - planCreditRange([...completedCodes], context).min))]
      : getPlanIssues(plan, catalog, { minimumTermCredits });
    if (isUga && (answers?.doubleDawgsPathwayId ?? null) !== (plan.doubleDawgs?.pathwayId ?? null)) {
      rows.push({
        id: 'double-dawgs-rebuild',
        termId: '',
        severity: 'warning',
        title: 'Apply your Double Dawgs pathway',
        message: answers?.doubleDawgsPathwayId
          ? 'This saved plan has not been built for the selected Double Dawgs pathway. Press Rebuild to generate both degree stages and their shared credits. Your current plan is unchanged until then.'
          : 'This plan still contains the previous Double Dawgs pathway. Press Rebuild to return to a bachelor\'s-only plan.',
      });
    }
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
    isIllinois, isGraduatePlan, loaded, priorCreditHours, report, answers, weeklyFits, completedCodes, boardContext,
  ]);

  const planWideIssues = useMemo(
    () => groupIssues(issues.filter((issue) => !issue.courseId && !isTermIssue(issue))),
    [issues],
  );
  /**
   * What needs attention on this board, in words on screen rather than only
   * behind the dots, and the all-clear only when every check passes
   * (attention.ts). A build announces it once its board's issues are in.
   */
  const attention = useMemo(() => attentionItems(issues), [issues]);
  const attentionText = attentionLine(attention);
  const earlyText = earlyFinishNote(planNotes);
  useEffect(() => {
    if (!announceBuild.current || !plan) return;
    announceBuild.current = false;
    const built = attention.length > 0 ? `Draft built. ${attentionText}` : 'Plan built. Nothing needs attention.';
    setStatus(earlyText ? `${built} ${earlyText}` : built);
  }, [attention, attentionText, earlyText, plan]);
  const planWideSeverity = planWideIssues[0]?.severity ?? null;
  const planWideSummary = planWideIssues.map((group) => `${group.title}: ${group.message}`).join('\n\n');
  const tabIssueSeverity = (candidate: PlanTab) =>
    candidate.id === activePlanId ? planWideSeverity : (candidate.issueSeverity ?? null);
  const tabIssueSummary = (candidate: PlanTab) => candidate.id === activePlanId
    ? planWideSummary
    : candidate.issueSummary || 'This plan has notes to review. Open the plan to refresh its warning details.';

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
    (): Map<string, ElectiveOf> => {
      const marks = planMarks(
        {
          pools,
          language: report?.language ?? null,
          electives: report?.electives ?? [],
          genEdPicks: report?.genEdPicks ?? [],
          addedPrerequisites: report?.addedPrerequisites ?? [],
        },
        byCode,
      );
      for (const shared of plan?.doubleDawgs?.shared ?? []) {
        const course = byCode.get(shared.code);
        if (course) marks.set(course.id, {
          kind: 'pool',
          label: 'Double Dawgs shared course',
          detail: `${shared.credits} proposed shared credits toward both degrees. Replaces ${shared.undergraduateCode}; pathway approval required.`,
        });
      }
      return marks;
    },
    [pools, byCode, report, plan?.doubleDawgs],
  );

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
          ? { ...candidate, plan, board: boardNow() ?? undefined, issueSeverity: planWideSeverity, issueSummary: planWideSummary }
          : candidate,
      ),
    );
    setActivePlanId(id);
    applyBoard(target.board ?? { plan: target.plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: true });
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
    // Event handler only; a new tab needs a new identity.
    // oxlint-disable-next-line react/react-compiler
    const id = `plan-${Date.now().toString(36)}-${number}`;
    const destinationGroupId = groupId ??
      planTabs.find((candidate) => candidate.id === activePlanId)?.groupId ??
      planGroups[0]?.id ??
      DEFAULT_PLAN_GROUP.id;
    setPlanTabs((current) => [
      ...current.map((candidate) =>
        candidate.id === activePlanId
          ? { ...candidate, plan, board: boardNow() ?? undefined, issueSeverity: planWideSeverity, issueSummary: planWideSummary }
          : candidate,
      ),
      {
        id,
        name: `Plan ${number}`,
        groupId: destinationGroupId,
        plan: copy,
        board: { ...boardNow()!, plan: copy },
        issueSeverity: planWideSeverity,
        issueSummary: planWideSummary,
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
      // oxlint-disable-next-line react/react-compiler
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
    applyBoard(next.board ?? { plan: next.plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: true });
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

  /**
   * The board as it stands, report and all: what one undo step puts back and
   * what the device keeps. Read from the refs and the last render, because
   * ALMA's tools run between renders.
   */
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
      { alreadyTaken: completedCodes },
    );
    setSelectedCourseId(null);
    setFocusTermId(null);
    setStatus(
      `${course.code} is now already taken. It was removed from ${plan.terms.find((term) => term.id === termId)?.label ?? 'the schedule'} and still counts toward your requirements.`,
    );
  }

  function boardNow(): BoardState | null {
    const board = planRef.current;
    if (!board) return null;
    const L = live.current;
    return {
      plan: board,
      report: L.report,
      notes: L.planNotes,
      studentAdded: [...studentAdded.current],
      repickedFor: repickedFor.current,
      edited: L.boardEdited,
    };
  }

  function settingsNow(): PlanSettings {
    const L = live.current;
    return {
      minimumTermCredits: L.minimumTermCredits,
      targetTermCredits: L.targetTermCredits,
      careerInterests: L.careerInterests,
      careerCleared: L.careerCleared,
      priorities: L.priorities,
      planShape: planShapeRef.current,
    };
  }

  /**
   * One change to the board, and its undo step. A student's edit is a step of
   * its own. ALMA's edits while it answers one message share the step the
   * turn's first change pushed (almaChanged), so "Undo these changes" takes
   * back the whole answer: three history courses in, three elective slots out.
   * `added` are cards that read "added" from now on.
   */
  function commit(next: PlanState, options: { by?: 'student' | 'alma'; summary?: string; added?: string[]; alreadyTaken?: string[] } = {}) {
    const before = boardNow();
    if (!before) return;
    if (options.by === 'alma' && almaTurn.current) almaChanged(options.summary ?? null);
    else setUndoStack((current) => pushUndo(current, { before, alreadyTakenCourseCodes: live.current.answers?.alreadyTakenCourseCodes ?? [] }));
    if (options.added?.length) studentAdded.current = new Set([...studentAdded.current, ...options.added]);
    planRef.current = next;
    replaceActivePlan(next);
    if (options.alreadyTaken && answers && onAnswersChange) {
      onAnswersChange({ ...answers, alreadyTakenCourseCodes: options.alreadyTaken });
    }
    setBoardEdited(true);
  }

  /**
   * A change ALMA made in the turn in flight, filed under the tool call that
   * made it. The turn's first change pushes its one undo step, holding the
   * board, settings and record from before the student's message.
   */
  function almaChanged(summary: string | null) {
    const turn = almaTurn.current;
    if (!turn) return;
    if (!turn.pushed) {
      turn.pushed = true;
      setUndoStack((current) => pushUndo(current, { before: turn.before, turn: { id: turn.id, toolIds: [], summary: [] } }));
    }
    if (turn.toolId && !turn.toolIds.includes(turn.toolId)) turn.toolIds.push(turn.toolId);
    if (summary) turn.summary.push(summary);
  }

  /** The student sent ALMA a message: what undoing the turn puts back is the board as it is now. */
  function beginAlmaTurn() {
    const before = boardNow();
    almaTurn.current = before
      ? {
          // oxlint-disable-next-line react/react-compiler
          id: `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          before,
          settings: settingsNow(),
          transcript: live.current.answers?.transcript ?? null,
          pushed: false,
          toolId: null,
          toolIds: [],
          summary: [],
        }
      : null;
  }

  /**
   * The turn is over. Its step learns which tool calls made it (so the reply
   * can offer the undo), what they did, and which settings and credit the
   * turn changed, as they were before it: undoing it puts back only those,
   * so a priority the student set by hand afterwards is not undone with it.
   */
  function endAlmaTurn() {
    const turn = almaTurn.current;
    almaTurn.current = null;
    if (!turn?.pushed) return;
    const after = settingsNow();
    const settings: Partial<PlanSettings> = {};
    for (const key of Object.keys(after) as Array<keyof PlanSettings>) {
      if (JSON.stringify(after[key]) !== JSON.stringify(turn.settings[key])) Object.assign(settings, { [key]: turn.settings[key] });
    }
    const transcriptNow = live.current.answers?.transcript ?? null;
    const record: NonNullable<UndoEntry['turn']> = {
      id: turn.id,
      toolIds: [...turn.toolIds],
      summary: [...turn.summary],
      ...(Object.keys(settings).length > 0 ? { settings } : {}),
      ...(transcriptNow !== turn.transcript ? { transcript: { value: turn.transcript } } : {}),
    };
    setUndoStack((current) => current.map((entry) => (entry.turn?.id === turn.id ? { ...entry, turn: record } : entry)));
  }

  function addCourse(courseId: string, termId: string) {
    if (!plan) return;
    const course = courseIndex.get(courseId);
    if (!course) return;
    // A course the catalog lets a student repeat may go on again (THEA 359 for Stage Management's 8 hours).
    const again = termId !== 'completed' && mayBookAgain(course, plan, courseId, termId);
    if ((plannedCourseIds.has(courseId) || plan.completedCourseIds.includes(courseId)) && !again) {
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
      { added: asCompleted ? [] : [courseId], alreadyTaken: asCompleted ? [...new Set([...(answers?.alreadyTakenCourseCodes ?? []), course.code])] : undefined },
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
  /** What the student walks in with, as the option lists and the re-pick read it. */
  const priorForOptions = useMemo(
    () =>
      withGenEdCredit(readPriorCredit(
        answers?.transferText ?? '',
        answers?.exams.length ?? 0,
        byCode,
        [...examCourses(exams, examCredit.entries, (code) => byCode.has(code)), ...transcriptCodes(answers?.transcript), ...(answers?.alreadyTakenCourseCodes ?? [])],
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

  const chooserData = useMemo((): { label: string; options: Course[]; whys: Map<string, string> } | null => {
    if (!chooser || !plan || !context || !loaded) return null;
    const oldCourse = courseIndex.get(chooser.courseId);
    if (!oldCourse) return null;
    const term = plan.terms.find((row) => row.id === chooser.termId);
    const graduateStage = Boolean(plan.doubleDawgs && term && degreeTermOrder(term) > degreeTermOrder(plan.doubleDawgs.undergraduateFinish));
    const sharedSlot = plan.doubleDawgs?.shared.find((row) => row.code === oldCourse.code);
    const source = graduateStage ? loaded.doubleDawgsGraduate ?? loaded : loaded;
    const blocks = plan.doubleDawgs && !graduateStage
      ? sharedUndergraduateRequirements(loaded.blocks, plan.doubleDawgs.shared.filter((row): row is { code: string; undergraduateCode: string; credits: number } => Boolean(row.undergraduateCode)))
      : source.blocks;
    const isPrerequisite = plan.terms.some((term) =>
      term.courseIds.some((id) => courseIndex.get(id)?.prerequisites.includes(oldCourse.id)),
    );
    const scope = replacementScope({
      course: oldCourse,
      blocks,
      pools,
      isOpenElective: electiveOf.get(oldCourse.id)?.kind === 'elective',
      isPrerequisite,
      catalog,
    });
    const prior = priorForOptions;
    const planWithoutCourse: PlanState = {
      ...plan,
      terms: plan.terms.map((term) =>
        term.id === chooser.termId
          ? { ...term, courseIds: term.courseIds.filter((id) => id !== chooser.courseId) }
          : term,
      ),
    };
    const ranked = electiveOptions({
      context: boardContext ?? context,
      requirements: blocks,
      plan: planWithoutCourse,
      termId: chooser.termId,
      prior,
      // Replacements are constrained by the requirement and term. Career text
      // influences the next generated plan, but should not rescore an already
      // open chooser while the student is editing that text.
      interests: [answers?.studying ?? '', answers?.after ?? ''].join(' '),
      programName: source.program.name,
      programCollege: isIllinois && !isGraduatePlan ? loaded.program.college : undefined,
      priorities,
      standingHours: graduateStage ? { freshman: 0, sophomore: 0, junior: 0, senior: 0 } : isGraduatePlan
        ? gradSettings.standingHours
        : undefined,
      electiveLevelRange: graduateStage ? { min: 600, maxExclusive: 1000 } : isGraduatePlan
        ? gradSettings.electiveLevelRange
        : undefined,
      candidateCodes: scope.codes ?? undefined,
      limit: scope.codes === null ? catalog.length : Math.max(800, scope.codes.size),
    });
    const options = ranked
      .filter((option) => !graduateStage || !plan.doubleDawgs?.graduateEligibleCodes || plan.doubleDawgs.graduateEligibleCodes.includes(option.code))
      .filter((option) => normCode(option.code) !== normCode(oldCourse.code))
      .filter((option) => scope.codes === null || scope.codes.has(normCode(option.code)))
      .map((option) => byCode.get(normCode(option.code)))
      .filter((course): course is Course => Boolean(course));
    return { label: sharedSlot ? `${scope.label} (replacing this course may remove shared credit)` : scope.label, options, whys: new Map(ranked.flatMap((option) => { const course = byCode.get(normCode(option.code)); return course ? [[course.id, option.reasons.slice(0, 2).join('; ') || option.why] as [string, string]] : []; })) };
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
    isGraduatePlan, isIllinois, priorities, priorForOptions, boardContext,
  ]);

  const chooserOptions = { options: chooserData?.options ?? [], whys: chooserData?.whys ?? new Map<string, string>() };
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

  /**
   * An elective slot keeps being a slot after its course is swapped, and a
   * track course keeps its track (swapInReport in lib/planner/saved-board.ts).
   */
  function noteElectiveSwap(oldCode: string, newCode: string, why: string, track?: string) {
    setReport((current) => (current ? swapInReport(current, oldCode, newCode, why, track) : current));
  }

  function removeCourse(courseId: string, termId: string) {
    if (!plan) return;
    const course = courseIndex.get(courseId);
    commit({
      ...plan,
      terms: plan.terms.map((term) =>
        term.id === termId
          ? { ...term, courseIds: withoutOne(term.courseIds, courseId) }
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
          return { ...term, courseIds: withoutOne(term.courseIds, courseId) };
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

  /**
   * "My instructor" on a card and in the map popup. The picker offers the
   * instructors on that term's published sections (Illinois's Fall 2026 and
   * Spring 2027) and everyone named on the course's syllabi (both schools);
   * the choice is saved on the plan by term and code, not as a board edit, so
   * it takes no undo step and does not mark the board as changed by hand.
   */
  function syllabiOf(code: string): Promise<SyllabusRecord[]> {
    const load = isIllinois ? loadIllinoisSyllabi(code) : school?.id === 'uga' ? loadUgaSyllabi(code) : Promise.resolve([]);
    return load.catch(() => []);
  }
  async function instructorChoices(courseId: string, termId: string) {
    const course = courseIndex.get(courseId);
    if (!course) return [];
    const [syllabi, detail] = await Promise.all([syllabiOf(course.code), isIllinois ? loadIllinoisCourseDetail(course.code).catch(() => null) : Promise.resolve(null)]);
    return instructorOptions(teachingNames(detail?.sectionsByTerm?.[termId]?.sections ?? null), syllabi);
  }
  function setInstructor(courseId: string, termId: string, name: string | null) {
    const board = planRef.current;
    const course = courseIndex.get(courseId);
    if (!board || !course) return;
    replaceActivePlan(withInstructor(board, termId, course.code, name));
    setInstructorTyping(null);
    const label = board.terms.find((t) => t.id === termId)?.label ?? 'that term';
    setStatus(name ? `${course.code}, ${label}: your instructor is ${name}.` : `${course.code}, ${label}: instructor not set.`);
  }
  const instructorControl: InstructorControl = {
    chosen: (courseId, termId) => {
      const course = courseIndex.get(courseId);
      return course ? chosenInstructor(plan, termId, course.code) : null;
    },
    options: instructorChoices,
    set: setInstructor,
    typeOwn: (courseId, termId) => {
      selectPlanned(courseId, termId);
      setInstructorTyping({ courseId, termId });
    },
  };

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

  function showWarningCourse(courseId: string) {
    if (!courseIndex.has(courseId)) return;
    setChooser(null);
    setChooserOnMap(false);
    setSearchQuery('');
    setSelectedCourseId(courseId);
    setFinderOpen(true);
    setMapFocusRequest((current) => ({ courseId, sequence: (current?.sequence ?? 0) + 1 }));
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
    assumedCredit,
    planNotes,
    boardEdited,
    careerInterests,
    careerCleared,
    areas,
  });
  useEffect(() => {
    live.current = {
      courseIndex,
      byCode,
      context: boardContext,
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
      assumedCredit,
      planNotes,
      boardEdited,
      careerInterests,
      careerCleared,
      areas,
    };
  });

  /**
   * The options every validatePlan call on the board uses, from the latest
   * render. One place, so the language rule (a language course every fall
   * and spring past 60 hours, in LAS and the iSchool) reaches the drag
   * check, what_if and the review alike.
   */
  function validateOptions(): ValidateOptions {
    const L = live.current;
    return {
      minimumTermCredits: L.minimumTermCredits,
      maxTermCredits: 18,
      programName: L.loaded?.program.name,
      programCollege: isIllinois && !isGraduatePlan ? L.loaded?.program.college : undefined,
      priorCredits: L.priorCreditHours,
      standingHours: isGraduatePlan ? gradSettings.standingHours : undefined,
      away: L.report?.away,
      language: L.language,
      // Read for this student: a transfer or a continuing sophomore is never
      // told a first-term seminar belongs in "the first year".
      firstYear: isIllinois && !isGraduatePlan && enteringAsFirstYear([L.answers?.studying ?? '', L.answers?.timeline ?? '', L.answers?.after ?? ''].join(' '), L.answers?.transcript),
      arrival: isIllinois && isGraduatePlan ? undefined : arrivalOf(L.answers),
    };
  }

  /**
   * The review flags on a board (lib/planner/review.ts): the validator's
   * edit flags (Composition I after the first year, no language course past
   * 60 hours) and the first-year momentum checks, with the Kentucky fact
   * when the student's own setting or edits made the first year light.
   * move_course and what_if run it before and after and report only what
   * the change caused.
   */
  function reviewFlagsOn(board: PlanState) {
    const L = live.current;
    if (!isIllinois || !L.context || !L.loaded) return { flags: [] as Array<{ id: string; message: string }>, momentum: [] as ReturnType<typeof momentumReview>['flags'], fact: null as string | null };
    const momentum = momentumReview({
      context: L.context,
      board,
      requirements: L.loaded.blocks,
      programName: L.loaded.program.name,
      firstYear: enteringAsFirstYear([L.answers?.studying ?? '', L.answers?.timeline ?? '', L.answers?.after ?? ''].join(' '), L.answers?.transcript),
      targetTermCredits: L.targetTermCredits ?? null,
      built: L.report?.builtTerms ?? null,
      planAim: L.report?.aim ?? null,
      heldCodes: [...L.completedCodes],
      genEdCredits: L.priorForOptions.genEdCredits ?? [],
    });
    return { flags: editFlags(validatePlan(board, L.context, validateOptions()), momentum.flags), momentum: momentum.flags, fact: momentum.fact };
  }

  /** Held courses as the headline counts them: each class once, none forfeited to a required course. */
  function heldNow(): string[] {
    const L = live.current;
    if (!L.context) return [];
    const forfeited = new Set((L.report?.forfeited ?? []).map((f) => normCode(f.held)));
    return distinctHeld([...L.completedCodes].filter((code) => !forfeited.has(code)), L.context).codes;
  }

  /** Why a candidate board is not allowed for a course in a term, or what to warn about if it is. */
  function checkPlacement(candidate: PlanState, course: Course, termId: string) {
    const L = live.current;
    const ctx = L.context;
    if (!ctx) return { blocking: ['The catalog is not loaded yet.'], warnings: [] as string[], credits: '' };
    const found = validatePlan(candidate, ctx, validateOptions());
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
    return loadedNow.summary.totalCredits || loadedNow.program.totalCredits || (isIllinois && !isGraduatePlan ? 120 : null);
  }

  function progressCheckOn(board: PlanState) {
    const L = live.current;
    if (!isIllinois || !L.loaded || !L.context) return undefined;
    const held = heldTowardDegree(
      distinctHeld([...L.completedCodes].filter((code) => !(L.report?.forfeited ?? []).some((f) => normCode(f.held) === code)), L.context).codes,
      L.loaded.program.college, L.loaded.blocks as unknown as PlanRequirement[],
    );
    return illinoisProgressGuard({
      board, context: L.context, blocks: L.loaded.blocks, byCode: L.byCode,
      priorCodes: held.codes, pools: L.pools, language: L.language,
      satisfiedByPriorCredit: L.report?.satisfiedByPriorCredit ?? [],
      languages: L.core?.languages, equivalents: L.context.equivalents,
      degreeTotal: degreeTotalNow(),
      priorHours: L.priorForOptions.unmatchedCredits - held.hoursOff,
      genEdCredits: isGraduatePlan ? [] : L.priorForOptions.genEdCredits,
      programName: L.loaded.program.name,
    });
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
      programCollege: isIllinois && !isGraduatePlan ? L.loaded.program.college : undefined,
      standingHours: isGraduatePlan ? gradSettings.standingHours : undefined,
      progressCheck: progressCheckOn(board),
      arrival: arrivalOf(L.answers),
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

  /**
   * Whether the student can simply register for a course the dropdown would
   * offer, by the rule the re-pick swaps by (notRegistrable): the gen-ed
   * branch reads it through swapCheckOn, and the slot and list branches here.
   * The list branch ran only the validator, and offered LAS 102 ("For
   * first-term LAS transfer students only") in place of a freshman's LAS
   * 100; the gen-ed branch offered ESL 115, behind the English Placement
   * Test, in place of RHET 105.
   */
  function registrableNow(): (course: Course) => boolean {
    const L = live.current;
    const ctx = L.context;
    if (!ctx || !L.loaded) return () => false;
    const who = {
      programName: L.loaded.program.name,
      programCollege: L.loaded.program.college,
      primary: degreeSubjects(L.loaded.blocks, L.loaded.program.name).primary,
      arrival: arrivalOf(L.answers),
    };
    return (course) => notRegistrable(course, ctx, who) === null;
  }

  function alternativesFor(courseId: string, termId: string): Alternative[] {
    const L = live.current;
    const board = planRef.current;
    if (!board || !L.context || !L.loaded) return [];
    const mark = L.electiveOf.get(courseId);
    if (!mark) return [];
    if (L.context.schoolId === 'uga') {
      const course = L.courseIndex.get(courseId);
      if (!course) return [];
      const term = board.terms.find((row) => row.id === termId);
      const graduateStage = Boolean(board.doubleDawgs && term && degreeTermOrder(term) > degreeTermOrder(board.doubleDawgs.undergraduateFinish));
      const source = graduateStage ? L.loaded.doubleDawgsGraduate ?? L.loaded : L.loaded;
      const blocks = board.doubleDawgs && !graduateStage
        ? sharedUndergraduateRequirements(L.loaded.blocks, board.doubleDawgs.shared.filter((row): row is { code: string; undergraduateCode: string; credits: number } => Boolean(row.undergraduateCode)))
        : source.blocks;
      const scope = replacementScope({
        course, blocks, pools: L.pools, catalog: L.catalog,
        isOpenElective: mark.kind === 'elective',
        isPrerequisite: board.terms.some((t) => t.courseIds.some((id) => L.courseIndex.get(id)?.prerequisites.includes(courseId))),
      });
      return electiveOptions({
        context: L.context, requirements: blocks,
        plan: { ...board, terms: board.terms.map((t) => t.id === termId ? { ...t, courseIds: t.courseIds.filter((id) => id !== courseId) } : t) },
        termId, prior: L.priorForOptions, interests: L.interestsText, priorities: L.priorities,
        programName: source.program.name, candidateCodes: scope.codes ?? undefined,
        standingHours: graduateStage ? { freshman: 0, sophomore: 0, junior: 0, senior: 0 } : isGraduatePlan ? gradSettings.standingHours : undefined,
        electiveLevelRange: graduateStage ? { min: 600, maxExclusive: 1000 } : isGraduatePlan ? gradSettings.electiveLevelRange : undefined,
        limit: 30,
      }).flatMap((option) => {
        if (graduateStage && board.doubleDawgs?.graduateEligibleCodes && !board.doubleDawgs.graduateEligibleCodes.includes(option.code)) return [];
        const replacement = L.byCode.get(normCode(option.code));
        return replacement && replacement.id !== courseId ? [{ course: replacement, why: option.reasons.slice(0, 2).join('; ') || option.why }] : [];
      }).slice(0, 7);
    }
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
    const registrable = registrableNow();
    if (mark.kind === 'elective') {
      const check = swapCheckOn(board);
      const removed = L.courseIndex.get(courseId);
      // Ranked past the seven shown, so the ones the re-pick would refuse
      // (every section closed to this major, "Consent of instructor.") leave
      // room for the next best rather than a shorter list.
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
        limit: 20,
      })
        .map((o) => {
          const course = L.byCode.get(normCode(o.code));
          if (!course || !removed || !registrable(course) || !check) return null;
          const candidate = { ...board, terms: board.terms.map((t) => t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => id === courseId ? course.id : id) } : t) };
          return check(candidate, board, termId, course, removed) === null ? { course, why: reason(o.reasons, o.why) } : null;
        })
        .filter((a): a is Alternative => a !== null)
        .slice(0, 7);
    }
    const pool = L.pools.find((p) => p.picked.some((code) => L.byCode.get(normCode(code))?.id === courseId));
    const scorer = L.quality;
    if (!pool || !scorer) return [];
    const onBoard = new Set(board.terms.flatMap((t) => t.courseIds));
    const ranked = pool.alternatives
      .map((code) => L.byCode.get(normCode(code)))
      .filter((c): c is Course => c !== undefined)
      .filter((c) => !onBoard.has(c.id) && !board.completedCourseIds.includes(c.id) && registrable(c))
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
  function repickElectives(next: Priorities, by: 'student' | 'alma' = 'student'): { changes: RepickChange[]; unchanged: boolean } {
    const L = live.current;
    const board = planRef.current;
    if (!board || !L.context || !L.loaded) return { changes: [], unchanged: false };
    if (board.doubleDawgs) { setStatus('Use Rebuild to apply preferences across both Double Dawgs stages, or replace a course individually.'); return { changes: [], unchanged: true }; }
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
      programCollege: isIllinois && !isGraduatePlan ? L.loaded.program.college : undefined,
      electiveLevelRange: isGraduatePlan ? gradSettings.electiveLevelRange : undefined,
      standingHours: isGraduatePlan ? gradSettings.standingHours : undefined,
      priorities: next,
      minimumTermCredits: L.minimumTermCredits,
      priorCredits: L.priorCreditHours,
      degreeTotal: degreeTotalNow(),
      trackPicks: (L.report?.electives ?? []).filter((e) => e.track).map((e) => e.code),
      progressCheck: progressCheckOn(board),
      lastSignature: repickedFor.current,
      arrival: arrivalOf(L.answers),
    });
    if (result.changes.length === 0) {
      repickedFor.current = result.signature;
      // Nothing on the board moved, but the signature did, and the device
      // keeps it: a second Re-pick after a reload is a no-op as well.
      setSaveTick((tick) => tick + 1);
      return { changes: [], unchanged: result.unchanged };
    }
    const n = result.changes.length;
    commit(result.board, { by, summary: `re-picked ${n} ${plural(n, 'course')}: ${result.changes.map((c) => (c.from ? `${c.to} for ${c.from}` : `${c.to} added`)).join(', ')}` });
    // After the commit, whose undo step keeps the signature from before it.
    repickedFor.current = result.signature;
    setReport((current) => (current ? repickInReport(current, result.changes) : current));
    return { changes: result.changes, unchanged: false };
  }

  /**
   * Why a card is on the board. The rules live in cardRole
   * (lib/planner/advisor-packet.ts) so the printed packet names every card
   * with the word ALMA and the board use for it.
   */
  function roleOf(course: Course): CardRole {
    const L = live.current;
    return cardRole(course, { marks: L.electiveOf, bookedFor: L.report?.bookedFor, blocks: L.loaded?.blocks, studentAdded: studentAdded.current });
  }
  function markOf(course: Course): string {
    const role = roleOf(course);
    // A course booked for an Illinois minor's row says whose it is, whatever its card shows.
    const bookedFor = isIllinois ? live.current.report?.bookedFor?.[normCode(course.code)] : null;
    if (bookedFor && bookedFor.startsWith(MINOR_ID_PREFIX) && role !== 'prerequisite') {
      const minor = live.current.loaded?.minors?.find((m) => bookedFor.startsWith(`${m.id}::`));
      if (minor) return `minor: ${minor.name}`;
    }
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
    // The model has no calendar. Asked in November whether a student could
    // still drop CHEM 102 without a W, it would have to guess whether Oct 16
    // had passed; with the student's own date it says so.
    const today = `Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
    if (!board || !L.loaded) return `${today}\nNo plan is on the board yet.`;
    const lines: string[] = [today];
    const last = board.terms[board.terms.length - 1]?.label ?? '';
    lines.push(
      `Degree: ${L.loaded.program.name}, ${school?.name ?? 'selected university'}. Published total: ${L.activeProgramTotal ?? 'not published'} credits. Plan: ${L.totalCredits} through ${last}.`,
    );
    if (doubleDawgsPathway) {
      lines.push(`Double Dawgs: ${doubleDawgsPathway.name}. Source: ${doubleDawgsPathway.url}. Combined draft: ${JSON.stringify(plan?.doubleDawgs ?? null)}. Current independent credit ledgers: ${JSON.stringify(combinedLedger)}. Shared courses must remain before the bachelor's milestone. Do not claim advisor approval or graduate admission.`);
    }
    if (ugaSamplePlans.length > 0) {
      lines.push(`Official UGA sample plans are final tie-breakers, not extra requirements: ${ugaSamplePlans.map((sample) => `${sample.programName} (${sample.url})`).join('; ')}.`);
    }
    // Who ALMA sends the student to for what it cannot decide: a Media student's
    // late drop is a petition at 119 Gregory Hall, not "your advisor".
    if (isIllinois) {
      const college = collegeRulesFor(L.loaded.program.college);
      lines.push(`College: ${college.name}. Its office for loads, CR/NC, grade replacement, late drops and petitions: ${college.office}.`);
      // Minors (beta): what each needs, and whether the planner checked it.
      for (const minor of L.loaded.minors ?? []) {
        if (minor.checked) {
          const rows = L.areas.filter((row) => row.area.label.startsWith(`${minor.name} · `));
          lines.push(`Minor on this board (beta): ${minor.name}, ${minor.totalCredits ?? 'no stated'} hours, page ${minor.url}. The planner read its page and checked this plan against it. What it asks for, in short: ${minor.inOwnWords} Its rows in the rail, after the degree's: ${rows.map((row) => `${row.area.label.slice(minor.name.length + 3)} ${row.earned}/${row.needed ?? '?'}${row.satisfied ? ' met' : ' not met'}`).join('; ') || 'none counted yet'}. Degree first: the plan gives a minor course no degree requirement's place and no term over 18 hours; rows that did not fit are named in the plan notes as needing a summer or an extra term. A course may count for the degree and the minor at once (campus rule); LAS lets a course count for at most two programs. Courses booked for it are marked [minor: ${minor.name}].`);
        } else {
          lines.push(`Minor picked but NOT checked by the planner: ${minor.name} (${minor.whyNotChecked ?? 'not on the checked list'}). None of its courses are on the board. What its page asks for, by the planner's rough reading: ${minor.inOwnWords} Page: ${minor.url}. Say plainly that the planner has not checked it, and send the student to the page and the department before planning around it.`);
        }
      }
    } else lines.push(`College: ${L.loaded.program.college}. Check current UGA policies with the college's advising office.`);
    lines.push(
      'Marks: [required] the degree page names it. [from a list: X] fills the list X. [elective slot] the planner picked it to reach the total; swap it freely. [career track: X] a course the student\'s career track X requires; keep it unless they drop the goal, and ask before removing or replacing it. [language] part of the language sequence for the language requirement; the language is the student\'s choice, the level is not. [gen ed pick] the planner chose it for a general education category; swap it for another course that carries the same categories. [prerequisite] the planner booked it because a later course needs it. [added] the student or you put it there.',
    );
    if (isIllinois && L.loaded.minors?.some((minor) => minor.checked)) lines.push('[minor: X] the planner booked it for the minor X; ask before removing it, since the minor then falls short.');
    const taken = board.completedCourseIds
      .map((id) => L.courseIndex.get(id)?.code)
      .filter((code): code is string => Boolean(code));
    lines.push(`Already taken, counted but not on the board: ${taken.length > 0 ? taken.join(', ') : 'none'}.`);
    lines.push(describeCredit(L.answers?.transcript ?? null, L.priorForOptions, L.report?.residency ?? null));
    lines.push(
      `Credit load: at least ${L.minimumTermCredits} credits a term, aim ${L.targetTermCredits ?? 'an even share of what is left'}, never above 18.${describeShape(planShapeRef.current)} ${scheduleSentence(sectionTermsOf(L.core?.meta), L.core?.meta?.term?.label ?? null)}`,
    );
    lines.push(isIllinois ? describeGoals(L.answers?.studying ?? '', L.careerText) : `Interests and goals: ${L.careerText || 'none recorded'}. No university-specific career track course list is loaded for UGA.`);
    // The rail's clubs, once the file has loaded, so ALMA and the rail name the same ones.
    const clubs = isIllinois && clubFile.current ? runFindClubs({}, clubStudentFor(L.careerText, L.loaded, L.answers), clubFile.current) : null;
    if (clubs?.ok && clubs.clubs.length > 0) {
      lines.push(`Clubs for your goals (rail): ${clubs.clubs.slice(0, 3).map((c) => c.name).join('; ')} for ${clubs.goals_used.map((g) => g.label).join(', ') || clubs.clubs[0].for_goal}, from ${clubs.source.name} checked ${clubs.source.checked}; find_clubs returns the same list.`);
    }
    lines.push(`Priorities, which decide the elective picks and the order of choices: ${describePriorities(L.priorities)}`);
    if (L.language) lines.push(`Language requirement: ${L.language.name}, semesters ${L.language.completed + 1} to ${L.language.semesters} planned (${L.language.codes.join(', ')}). ${L.language.why}`);
    if (L.admission) lines.push(`Getting into ${L.admission.name} (${L.admission.path}): the student is not in this college yet. Its courses (${L.admission.codes.join(', ')}) are placed first, due by ${L.admission.requiredBy}. ${L.admission.eligibility.join(' ')} Source: ${L.admission.source}`);
    // Why this route and not the other, or why none: ALMA should not offer
    // a transfer student the EU windows, or a CS hopeful any route at all.
    const choice = L.admissionChoice;
    if (choice && (!choice.front || choice.route?.applySemesters)) {
      lines.push(`Which route in, from how the student entered Illinois: ${describeAdmissionChoice(choice)}`);
    }
    lines.push(`Instructors: "(my instructor: X)" after a course is the instructor the student set for it in that term; a course without it is not set (the student sets it by clicking the course, then My instructor). The term in progress is ${currentTermLabel(new Date())}.`);
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
            ? courses.map((c) => {
                const who = chosenInstructor(board, term.id, c.code);
                return `${c.code} [${markOf(c)}] ${creditsOf(c)} ${c.title}${who ? ` (my instructor: ${who})` : ''}`;
              }).join('; ')
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
  const advisorExecute: AdvisorExecutor = async (name, input, call) => {
    // A change this call makes is filed under it, for the reply's undo.
    if (almaTurn.current) almaTurn.current.toolId = call?.id ?? null;
    const L = live.current;
    const ctx = L.context;
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    if (name === 'university_answer') {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, school: school?.id ?? 'illinois' }) });
      const data = await res.json().catch(() => ({})) as { text?: string; error?: string; sources?: unknown; grounded?: boolean };
      return { ok: res.ok, text: data.text || data.error || 'No answer came back.', sources: Array.isArray(data.sources) ? data.sources : [], grounded: Boolean(data.grounded) };
    }
    if (!ctx) return { ok: false, error: 'The course catalog is not loaded yet.' };
    if (!L.loaded) {
      if (name === 'search_courses') {
        const query = (typeof input.query === 'string' ? input.query : '').toLowerCase();
        return { ok: true, courses: L.catalog.filter((c) => matchesQuery(c, query)).slice(0, 30).map((c) => ({ code: c.code, title: c.title, credits: c.credits })) };
      }
      if (name === 'course_details') {
        const c = L.byCode.get(normalizeCourseCode(typeof input.code === 'string' ? input.code : ''));
        return c ? { ok: true, code: c.code, title: c.title, description: c.description, prerequisites: c.prerequisiteText, credits: c.credits } : { ok: false, reason: 'Course not found.' };
      }
      return { ok: false, reason: 'No degree is selected. You can explore courses or select a degree in Preferences to enable requirement-aware plan changes.' };
    }
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
    /**
     * Class times by the term that matters for each course (section-terms.ts):
     * the column it sits in when that term's schedule is published, the
     * latest schedule of the same season for a later column, and the newest
     * schedule for a course not on the board (or the term the tool was asked
     * about). The terms past the first load on the first ALMA call and are
     * cached after it. A term that did not load falls back to the first one,
     * labelled as such, rather than reading as a course with no sections.
     * What it shows only: the planner's choices still weigh Fall 2026.
     */
    const scheduleTerms = sectionTermsOf(L.core?.meta);
    const schedules = scheduleTerms.length > 1 ? await loadIllinoisSectionTerms().catch(() => null) : null;
    const scheduleOf = (c: Course, asked?: { id: string; label: string } | null) => {
      const at = holding(c.id);
      const pick = pickSectionTerm(scheduleTerms, at ? { id: at.id, label: at.label } : (asked ?? null));
      const coreId = L.core?.meta?.term?.id ?? null;
      const picked = !pick || pick.term.id === coreId ? (L.core?.sections ?? null) : (schedules?.get(pick.term.id) ?? null);
      const usable = picked !== null;
      const map = usable ? picked : (L.core?.sections ?? null);
      return {
        termId: usable && pick ? pick.term.id : coreId,
        label: usable && pick ? pick.term.label : (L.core?.meta?.term?.label ?? null),
        note: usable ? sectionTermCaveat(pick) : null,
        summary: map?.get(normCode(c.code)) ?? null,
      };
    };
    /**
     * Whether a board term's courses fit in one week, from that term's own
     * published class times (weekly-fit.ts, the check the column shows). A
     * term with no published schedule says so instead of guessing from
     * another term's times.
     */
    const weeklyOf = (t: PlanTerm) => {
      const coreId = L.core?.meta?.term?.id ?? null;
      const schedule = t.id === coreId ? (L.core?.sections ?? null) : (schedules?.get(t.id) ?? null);
      if (!schedule) {
        // Each school's own name: a UGA board was told "Illinois's ... class times" (audit, 2026-10-14).
        if (!isIllinois) return { checked: false, line: null, why: `${school?.short ?? 'This university'}'s class times are not loaded here, so whether these courses fit in one week is not checked.` };
        return { checked: false, line: null, why: `Illinois's ${t.label} class times are not published here, so whether these courses fit in one week is not checked.` };
      }
      const codes = t.courseIds.map((id) => L.courseIndex.get(id)?.code).filter((c): c is string => Boolean(c));
      const fit = weeklyFit(codes, schedule);
      return {
        checked: fit.status !== 'unknown',
        fits: fit.status === 'fits' ? true : fit.status === 'clash' ? false : null,
        line: fit.line,
        ...(fit.clash.length > 0 ? { clashing: fit.clash } : {}),
        ...(fit.unknown.length > 0 ? { no_published_times: fit.unknown } : {}),
        how: `From ${t.label}'s published sections: one section of every part each course registers (lecture with its discussion, lab or quiz), with no two meetings at the same hour. It does not know which sections are full or restricted.`,
      };
    };
    /** How the course reads against the student's priorities, in their words. */
    const fitOf = (c: Course) => {
      if (!L.quality) return null;
      const q = L.quality(normCode(c.code));
      return { score_0_to_1: Math.round(q.score * 100) / 100, reasons: q.reasons, not_known: q.unknown };
    };
    const describe = (c: Course) => {
      // FIN 391 "Admission by application only": the Investment Banking
      // Academy came back from a search for "investment banking" looking like
      // any other one-credit elective.
      const gate = prereqNeedsAdmission(ctx.prereqs?.get(normCode(c.code))?.text);
      const sched = scheduleOf(c);
      return {
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
          sched.summary?.instructors ?? null,
          sched.label,
        ),
        recent_terms_it_ran: offeredLine(ctx, normCode(c.code)),
        fit: fitOf(c),
        ...(gate
          ? { apply_first: `The catalog says "${gate}": a program the student applies to, not a class to book. Say it exists and how admission works; add it only after they say they were admitted.` }
          : {}),
      };
    };
    /**
     * Whether a card could be taken credit/no credit, from why it is on the
     * board: "can I take my gen ed pick CR/NC?" is a lookup on the card, and
     * the answer names whose rule it is.
     */
    const crncOf = (c: Course) => {
      const answer = crncAnswer(c);
      return { crnc_eligible: answer.eligible, crnc_why: answer.why };
    };
    const crncAnswer = (c: Course) => {
      if (!isIllinois) return { eligible: null, why: 'UGA credit/no-credit eligibility is not in this data; confirm with your advisor.' };
      if (!holding(c.id)) return crncEligibility({ role: null, tags: c.tags, college: L.loaded?.program.college });
      const role = roleOf(c);
      const code = normCode(c.code);
      // A course the student added that one of the degree's lists names likely
      // counts there, so it is not a free elective.
      const namedBy =
        role === 'added'
          ? (L.loaded?.blocks.find((b) =>
              (b.rule.kind === 'all' || b.rule.kind === 'choose' || b.rule.kind === 'pool') &&
              b.rule.choices.some((choice) => [...choice.codes, ...(choice.bundles ?? []).flat()].some((x) => normCode(x) === code)),
            )?.label ?? null)
          : null;
      return crncEligibility({ role, tags: c.tags, namedBy, college: L.loaded?.program.college, track: L.electiveOf.get(c.id)?.track ?? null });
    };
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
        weekly_schedule: weeklyOf(t).line ?? 'not checked: no published class times for these courses',
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
    /**
     * The review flags an edit causes, for its result: Composition I moved
     * past the first year, a fall or spring past 60 hours left without a
     * language course, a first-year term or year one made light. The fact
     * about light loads comes with the flag that first needs it, not again.
     */
    const causedBy = (before: PlanState, after: PlanState): { review_flags_caused?: string[]; momentum_fact_say_once?: string } => {
      const was = reviewFlagsOn(before);
      const now = reviewFlagsOn(after);
      const caused = flagsCaused(was.flags, now.flags);
      return caused.length === 0 ? {} : { review_flags_caused: caused, ...(now.fact && !was.fact ? { momentum_fact_say_once: now.fact } : {}) };
    };
    /**
     * A term on `b` by name, or a summer inside the plan that is not on the
     * board yet ("Summer 2027"), added empty so a suggested summer can be
     * tried with what_if and, once the student says yes, filled with
     * move_course.
     */
    const termOn = (b: PlanState, label: string): { board: PlanState; term: PlanTerm } | null => {
      const want = label.toLowerCase().replace(/\s+/g, ' ').trim();
      const found =
        b.terms.find((t) => t.label.toLowerCase() === want) ??
        b.terms.find((t) => t.label.toLowerCase().includes(want) || want.includes(t.label.toLowerCase()));
      if (want && found) return { board: b, term: found };
      const summer = want.match(/^summer (20\d\d)$/);
      const placed = summer ? withSummer(b, Number(summer[1])) : null;
      const term = placed?.board.terms.find((t) => t.id === placed.termId);
      return placed && term ? { board: placed.board, term } : null;
    };
    /** Make the change: one undo step for the whole turn, `added` cards read "added", `summary` is what ALMA hears if it is undone. */
    const apply = (next: PlanState, focusTerm: string | null, select: string | null, status: string, summary: string, added: string[] = []) => {
      commit(next, { by: 'alma', summary, added });
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
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
        const detail = isIllinois ? await loadIllinoisCourseDetail(c.code) : null;
        const key = normCode(c.code);
        const grade = L.core?.grades?.get(key);
        const prereq = L.core?.prereqs?.get(key);
        const sched = scheduleOf(c);
        const rows = (sched.termId ? detail?.sectionsByTerm?.[sched.termId]?.sections : detail?.sections?.sections) ?? [];
        // The window the scorer weighs, read the way quality.ts reads it, so
        // ALMA's answer for this course is the card's answer.
        const p = L.priorities;
        const wanted = { notBefore: p.notBefore ?? (p.noEarly ? 540 : null), notAfter: p.notAfter ?? null, freeDays: p.freeDays ?? [] };
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
          // The term that matters for this course: its column's term when that
          // schedule is published, else the one sections_note names.
          sections_in_crawled_term: sched.summary?.total ?? 0,
          sections_term: sched.label,
          ...(sched.note ? { sections_note: sched.note } : {}),
          ...sectionTimes(rows, sched.summary?.meet, sched.label, wanted),
          does_not_count_with: L.core?.exclusions?.get(key) ?? [],
        };
      }
      case 'course_syllabus': {
        const c = courseOf(str('code'));
        const ugaBoard = L.context?.schoolId === 'uga';
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${ugaBoard ? 'UGA' : 'Illinois'} catalog.` };
        // The student's own instructor for it, where they set one on the board.
        const at = holding(c.id);
        const chosen = at ? chosenInstructor(board, at.id, c.code) : null;
        const mine = at ? { on_board_in: at.label, chosen_instructor: chosen } : { on_board_in: null };
        const grouped = "by_instructor groups the syllabi by instructor, newest first; chosen marks the instructor the student set on the board (answer for that one alone), and an instructor with teaches_in teaches the course that term.";
        if (ugaBoard) {
          // UGA: the files instructors upload to the Syllabus System, as the Bulletin
          // publishes them per course, plus the Bulletin's own outline. No sections
          // are loaded for UGA, so there is no "who teaches it this term" to compare.
          const syllabi = await loadUgaSyllabi(c.code);
          if (syllabi.length === 0) {
            return { ok: true, code: c.code, found: 0, this_term: null, ...mine, note: `No syllabus for ${c.code} is posted on UGA's Bulletin page for the course, and the Bulletin publishes no outline for it. Instructors upload syllabi to UGA's Syllabus System; the course's eLC page or its instructor has the current one.` };
          }
          return {
            ok: true,
            code: c.code,
            found: syllabi.length,
            this_term: null,
            ...syllabiByInstructor(syllabi, { chosen, termLabel: at?.label ?? null }),
            on_board_in: at?.label ?? null,
            note: `Newest term first; an entry with objectives and topics and no grading is the Bulletin's master outline for the course. Weights and policies change by term, instructor and section; the syllabus a student gets on the first day is the final word. The instructor named is the one who uploaded the file. ${grouped}`,
            syllabi: syllabiToShow(syllabi, { chosen }),
          };
        }
        const [syllabi, detail] = await Promise.all([loadIllinoisSyllabi(c.code), loadIllinoisCourseDetail(c.code)]);
        // Who teaches it in the term that matters (its column's, or the newest
        // schedule), so a syllabus from another term or instructor can be told
        // apart from the one the student will get.
        const sched = scheduleOf(c);
        const termRows = sched.termId ? (detail?.sectionsByTerm?.[sched.termId] ?? null) : (detail?.sections ?? null);
        const lectures = (termRows?.sections ?? []).filter((s) => !s.type || /lecture/i.test(s.type));
        const teaching = [...new Set((lectures.length ? lectures : termRows?.sections ?? []).flatMap((s) => s.instructors ?? []))];
        const thisTerm = termRows
          ? { term: sched.label, ...(sched.note ? { note: sched.note } : {}), instructors: teaching.slice(0, 12), sections: lectures.slice(0, 12).map((s) => ({ section: s.section, instructors: s.instructors })) }
          : null;
        if (syllabi.length === 0) {
          return { ok: true, code: c.code, found: 0, this_term: thisTerm, ...mine, note: `No public syllabus for ${c.code} was found. Most Illinois syllabi are posted inside Canvas, behind a login; the course's Canvas page or its instructor has the current one.` };
        }
        return {
          ok: true,
          code: c.code,
          found: syllabi.length,
          this_term: thisTerm,
          ...syllabiByInstructor(syllabi, { teaching, chosen, termLabel: sched.label }),
          on_board_in: at?.label ?? null,
          note: `Newest term first. Weights and policies can change by term, instructor and section; the syllabus a student gets on the first day is the final word. A syllabus's instructors are the ones the reader found in it and may be incomplete. listedFor is the term a store filed it under when the document itself names another. ${grouped}`,
          // Six are plenty to answer from and keep the reply small: each instructor's newest first, then the newest of the rest.
          syllabi: syllabiToShow(syllabi, { teaching, chosen }),
        };
      }
      case 'term_syllabi': {
        const ugaBoard = L.context?.schoolId === 'uga';
        const list = (key: string) => (Array.isArray(input[key]) ? (input[key] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : typeof input[key] === 'string' && (input[key] as string).trim() ? [(input[key] as string).trim()] : []);
        const askedTerms = list('terms');
        const askedCodes = list('codes').map(normalizeCourseCode);
        const facts = list('facts').filter((f): f is SyllabusFact => (SYLLABUS_FACTS as readonly string[]).includes(f));
        const want: SyllabusFact[] = facts.length > 0 ? facts : ['attendance', 'grading', 'exams'];
        const today = new Date();
        // "Senior year" is the student's own: a senior's board starts in it.
        const saidAt = L.answers?.timelineAt ? new Date(L.answers.timelineAt) : today;
        const studyYearAtStart = studyYearAtBoardStart(L.answers?.academicYear, board.terms[0]?.label, Number.isNaN(saidAt.getTime()) ? today : saidAt);
        const picked = resolveTerms(board.terms, askedTerms.length > 0 ? askedTerms : askedCodes.length > 0 ? ['all'] : ['this term'], today, { studyYearAtStart });
        if (picked.terms.length === 0) return { ok: false, reason: `No term called ${askedTerms.join(', ') || 'that'} is on the board. ${picked.notes.join(' ')} The terms are ${termList}.`.replace(/\s+/g, ' '), terms_not_found: picked.unknown };
        const rows: Array<{ c: Course; term: PlanTerm }> = [];
        for (const term of picked.terms) {
          for (const id of term.courseIds) {
            const c = L.courseIndex.get(id);
            if (!c || (askedCodes.length > 0 && !askedCodes.includes(normalizeCourseCode(c.code)))) continue;
            if (!rows.some((r) => r.c.id === c.id && r.term.id === term.id)) rows.push({ c, term });
          }
        }
        const notOnBoard = askedCodes.filter((code) => !rows.some((r) => normalizeCourseCode(r.c.code) === code));
        const MAX = 24;
        const inputs: TermCourseInput[] = await Promise.all(rows.slice(0, MAX).map(async ({ c, term }) => {
          const syllabi = await syllabiOf(c.code);
          if (ugaBoard || !isIllinois) return { code: c.code, title: c.title, termLabel: term.label, chosen: chosenInstructor(board, term.id, c.code), teaching: null, syllabi };
          // The term's own published sections, or the latest of its season, labelled as such.
          const pick = pickSectionTerm(scheduleTerms, { id: term.id, label: term.label });
          const detail = pick ? await loadIllinoisCourseDetail(c.code).catch(() => null) : null;
          const sectionRows = pick ? (detail?.sectionsByTerm?.[pick.term.id]?.sections ?? null) : null;
          return {
            code: c.code,
            title: c.title,
            termLabel: term.label,
            chosen: chosenInstructor(board, term.id, c.code),
            teaching: sectionRows ? teachingNames(sectionRows) : null,
            teachingTermLabel: pick && pick.term.label !== term.label ? pick.term.label : null,
            syllabi,
          };
        }));
        const courses = termSyllabiResult(inputs, want);
        return {
          ok: true,
          school: ugaBoard ? 'UGA' : 'Illinois',
          terms: picked.terms.map((t) => t.label),
          ...(picked.notes.length > 0 ? { years_of_study: picked.notes } : {}),
          term_in_progress: currentTermLabel(today),
          facts: want,
          course_count: courses.length,
          courses,
          ...(rows.length > MAX ? { not_shown: rows.slice(MAX).map((r) => `${r.c.code} (${r.term.label})`) } : {}),
          ...(picked.unknown.length > 0 ? { terms_not_found: picked.unknown, board_terms: termList } : {}),
          ...(notOnBoard.length > 0 ? { codes_not_in_those_terms: notOnBoard } : {}),
          without_syllabus: inputs.filter((c) => c.syllabi.length === 0).map((c) => `${c.code} (${c.termLabel})`),
          note: `One entry per course in those terms, in board order: answer for all ${courses.length} of them, the ones without a syllabus included. chosen_instructor is the instructor the student set for it (then only that instructor is listed, with the others named in other_instructors); otherwise every instructor found is listed, each with the facts from their newest syllabus, its syllabus_term and link. not_this_term marks a syllabus from another term than the course's own: say it is likely similar, not certain. teaches_in names the published ${ugaBoard ? '' : 'class schedule '}term an instructor teaches it in.${ugaBoard ? " UGA's class schedule is not loaded, so no instructor is known to teach a given term; the names are the syllabi's." : ''} A course with syllabus_found false has no syllabus in the sources the planner reads; say so in one line. Weights and policies change by term, instructor and section; the syllabus on the first day is the final word.`,
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
          courses: courses.map((c) => ({ ...describe(c), role: roleOf(c), ...crncOf(c) })),
          weekly_schedule: weeklyOf(term),
          review: L.issues.filter((i) => i.termId === term.id).map((i) => ({ severity: i.severity, title: i.title, message: i.message })),
          load,
        };
      }
      case 'add_course': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
        const already = holding(c.id);
        const wanted = str('term') ? termOf(str('term')) : null;
        // A course the catalog lets a student repeat may go on again, in a term the catalog allows (repeats.ts).
        const again = wanted !== null && mayBookAgain(c, board, c.id, wanted.id);
        if (already && !again) return { ok: false, reason: `${c.code} is already on the board in ${already.label}.` };
        if (board.completedCourseIds.includes(c.id) && !again) return { ok: false, reason: `${c.code} is marked as already taken.` };
        if (str('term') && !wanted) return { ok: false, reason: `No term called "${str('term')}" is on the board. The terms are ${termList}.` };
        const refusals: string[] = [];
        for (const t of wanted ? [wanted] : board.terms) {
          const candidate = withCourseIn(board, c.id, t.id);
          const verdict = check(candidate, c, t.id);
          if (verdict.blocking.length === 0) {
            apply(candidate, t.id, c.id, `${c.code} added to ${t.label} by ${botName}.`, `${c.code} added to ${t.label}`, [c.id]);
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
        const knockOn = validatePlan(candidate, ctx, validateOptions())
          .filter((i) => i.severity === 'error' && /^ap-prereq-(?!check)/.test(i.id))
          .map((i) => i.message);
        const caused = causedBy(board, candidate);
        apply(candidate, t.id, null, `${c.code} removed from ${t.label} by ${botName}.`, `${c.code} removed from ${t.label}`);
        const left = candidate.terms.find((x) => x.id === t.id);
        const credits = describeCreditTotal(planCreditRange((left?.courseIds ?? []).map((id) => L.courseIndex.get(id)?.code ?? ''), ctx));
        return { ok: true, summary: `${c.code} removed from ${t.label}`, term: t.label, term_credits: credits, now_missing_a_prerequisite: knockOn, ...underMinimum(candidate, t.id), ...caused };
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
        const oldRole = roleOf(oldC);
        const oldMark = L.electiveOf.get(oldC.id);
        const keepsSlot = oldRole === 'elective slot' || oldRole === 'gen ed pick';
        // PHYS 211 in place of PHYS 101 still meets the track's physics row,
        // so it stays a track course; anything else is the student's own.
        const keepsTrack = oldRole === 'career track' && Boolean(trackRowOf(oldC.code, oldMark?.track)?.includes(normCode(newC.code)));
        const caused = causedBy(board, candidate);
        apply(candidate, t.id, newC.id, `${newC.code} replaces ${oldC.code} in ${t.label}.`, `${newC.code} in place of ${oldC.code} in ${t.label}`, keepsSlot || keepsTrack ? [] : [newC.id]);
        if (keepsSlot) noteElectiveSwap(oldC.code, newC.code, `${botName} chose it for this ${oldRole === 'gen ed pick' ? 'category' : 'elective slot'}.`);
        else if (keepsTrack) noteElectiveSwap(oldC.code, newC.code, oldMark?.detail ?? `For ${oldMark?.track}.`, oldMark?.track);
        return { ok: true, summary: `${oldC.code} → ${newC.code} in ${t.label}`, term: t.label, term_credits: verdict.credits, warnings: verdict.warnings, ...caused };
      }
      case 'move_course': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${school?.short ?? 'university'} catalog.` };
        const from = holding(c.id);
        if (!from) return { ok: false, reason: `${c.code} is not on the board.` };
        // A summer the plan does not have yet ("Summer 2027") is added with
        // the course, for a summer the student said yes to.
        const target = termOn(board, str('term'));
        if (!target) return { ok: false, reason: `No term called "${str('term')}" is on the board. The terms are ${termList}; a summer between them can be named too.` };
        const to = target.term;
        if (to.id === from.id) return { ok: false, reason: `${c.code} is already in ${to.label}.` };
        const candidate = withCourseIn(without(target.board, c.id), c.id, to.id);
        const verdict = check(candidate, c, to.id);
        if (verdict.blocking.length > 0) return { ok: false, reason: `${c.code} cannot move to ${to.label}: ${verdict.blocking.join(' ')}` };
        const caused = causedBy(board, candidate);
        apply(candidate, to.id, c.id, `${c.code} moved to ${to.label} by ${botName}.`, `${c.code} moved from ${from.label} to ${to.label}`);
        return {
          ok: true,
          summary: `${c.code} moved from ${from.label} to ${to.label}${target.board === board ? '' : `, a summer added to the board for it`}`,
          term_credits: verdict.credits,
          warnings: verdict.warnings.filter((w) => !(caused.review_flags_caused ?? []).includes(w)),
          ...underMinimum(candidate, from.id),
          ...caused,
        };
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
          // Illinois's course pages only; another school's board uses its own catalog.
          const detail = isIllinois ? await loadIllinoisCourseDetail(c.code) : null;
          const verdict = term && !holding(c.id) ? check(withCourseIn(board, c.id, term.id), c, term.id) : null;
          const sched = scheduleOf(c, term ? { id: term.id, label: term.label } : null);
          rows.push({
            ...describe(c),
            role_on_board: holding(c.id) ? roleOf(c) : null,
            description: (detail?.course?.description ?? '').slice(0, 400) || null,
            prerequisite_sentence: prereq?.text || detail?.course?.prereqText || null,
            grade_history: grade ? { gpa: grade.gpa, a_percent: grade.aPct, drop_percent: grade.withdrawPct, students: grade.n } : null,
            sections_in_crawled_term: sched.summary?.total ?? 0,
            sections_term: sched.label,
            ...(sched.note ? { sections_note: sched.note } : {}),
            earliest_section: sched.summary?.earliest ?? null,
            ...(term ? { in_term: term.label, eligible: verdict ? verdict.blocking.length === 0 : holding(c.id) ? 'already on the board' : null, blocked_by: verdict?.blocking ?? [], warnings: verdict?.warnings ?? [] } : {}),
          });
        }
        return { ok: true, priorities: describePriorities(L.priorities), courses: rows, not_in_catalog: missing, note: 'Weigh these for the student in their own terms; do not just relist them.' };
      }
      case 'explain_choice': {
        const c = courseOf(str('code'));
        if (!c) return { ok: false, reason: `${str('code') || 'That'} is not in the ${isIllinois ? 'Illinois' : (school?.short ?? 'university')} catalog.` };
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
            const target = typeof ch.term === 'string' ? termOn(candidate, ch.term) : null;
            if (!target) { refused.push(`add ${c.code}: give a term on the board, or a summer between them`); continue; }
            const to = target.term;
            if (holdingIn(candidate, c.id)) { refused.push(`add ${c.code}: already on the board`); continue; }
            candidate = withCourseIn(target.board, c.id, to.id); added.push(c); applied.push(`add ${c.code} to ${to.label}`);
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
            const target = typeof ch.term === 'string' ? termOn(candidate, ch.term) : null;
            const from = holdingIn(candidate, c.id);
            if (!from) { refused.push(`move ${c.code}: not on the board`); continue; }
            if (!target) { refused.push(`move ${c.code}: give a term on the board, or a summer between them`); continue; }
            const to = target.term;
            candidate = withCourseIn(without(target.board, c.id), c.id, to.id); applied.push(`move ${c.code} from ${from.label} to ${to.label}`);
          } else refused.push(`${c.code}: unknown op ${op}`);
        }
        const before = validatePlan(board, ctx, validateOptions());
        const after = validatePlan(candidate, ctx, validateOptions());
        const keyOf = (i: PlanIssue) => `${i.id}|${i.message}`;
        const was = new Set(before.map(keyOf));
        // The edit flags come back once, under review_flags_caused.
        const newIssues = after.filter((i) => !was.has(keyOf(i)) && i.severity !== 'info' && !isEditFlag(i)).map((i) => `${i.severity}: ${i.message}`);
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
          ...causedBy(board, candidate),
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
        /**
         * What an advisor adds (lib/planner/review.ts): the first year's
         * pace, credits that count toward nothing, and a summer where one
         * would buy time. Each key is left out when there is nothing to say,
         * since ALMA reads this every time it reviews the board.
         */
        const review = reviewFlagsOn(board);
        const use = creditUse({
          context: ctx,
          board,
          requirements: L.loaded.blocks,
          programCollege: L.loaded.program.college,
          programName: L.loaded.program.name,
          degreeTotal: degreeTotalNow(),
          priorCredits: L.priorCreditHours + L.assumedCredit.hours,
          awayCredits: (L.report?.away ?? []).reduce((n, a) => n + a.credits, 0),
          heldCodes: heldNow(),
          marks: L.electiveOf,
          studentAdded: studentAdded.current,
        });
        const wanted = horizonFor(L.answers, new Date(), planShapeRef.current);
        const summers = summerSuggestions({
          context: ctx,
          board,
          options: validateOptions(),
          marks: L.electiveOf,
          studentAdded: studentAdded.current,
          targetTermCredits: L.targetTermCredits ?? null,
          lightFirstYear: review.momentum.some((f) => f.cause !== 'plan' && /^momentum-(term|year)/.test(f.id)),
          finish: { season: wanted.gradSeason, year: wanted.gradYear },
        });
        return {
          ok: true,
          degree: L.loaded.program.name,
          total_planned: L.totalCredits,
          published_total: L.activeProgramTotal,
          ...(L.assumedCredit.hours > 0 ? { assumed_credits: `${L.assumedCredit.hours} of total_planned are assumed for ${L.assumedCredit.terms}, terms the student has been here with no classes on their record yet. Ask them to upload their record or tell you those classes; do not call those hours missing.` } : {}),
          priorities: describePriorities(L.priorities),
          terms,
          heaviest_term_by_grade_history: heaviest,
          terms_stacking_hard_courses: stacked,
          not_run_recently: ctx.offeringTerms?.length ? dormant : 'not known: no offering history is loaded, so do not claim every course is offered',
          open_requirements: open.slice(0, 12),
          review_flags: groups.slice(0, 12).map((g) => `${g.severity}: ${g.title}: ${g.message.slice(0, 200)}`),
          ...(review.momentum.length > 0 ? { first_year_momentum: review.momentum.map((f) => f.message) } : {}),
          ...(review.fact ? { momentum_fact_say_once: review.fact } : {}),
          ...(use.beyondTotal > 0 ? { credits_beyond_total: `${use.beyondTotal} credits planned past the ${degreeTotalNow()} the degree takes; they count toward nothing it requires.` } : {}),
          ...(use.countsNothing.length > 0 ? { counts_toward_nothing: use.countsNothing.map((c) => `${c.code} (${c.term}): ${c.why}`) } : {}),
          ...(use.freeElectives.length > 0
            ? { added_courses_filling_no_requirement: `${use.freeElectives.map((c) => `${c.code} (${c.term})`).join(', ')}: added by the student or you, each counts as free elective hours toward the total and fills no requirement. That is fine; say so rather than calling it wasted.` }
            : {}),
          ...(summers.length > 0 ? { summer_suggestions: summers.map((s) => s.text) } : {}),
          suggestions,
          note: `Give the student your own judgement from this: what is fine, what to change, and why. Not a list.${summers.length > 0 ? ' A summer is only a suggestion: add one only after the student says yes (move_course into "Summer 2027" adds it with the course, or set_plan_shape summers rebuilds around it); what_if can try it first.' : ''}`,
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
        const fallback = horizonFor(L.answers, new Date(), planShapeRef.current);
        const start = labelled ? { season: labelled[1] as 'Fall' | 'Spring', year: Number(labelled[2]) } : { season: fallback.startSeason, year: fallback.startYear };
        const entry = readEntry(words, L.answers?.transcript, start, fallback.began);
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
        // Publish once, then expose it to subsequent tools in the same turn.
        // oxlint-disable-next-line react/react-compiler
        setPriorities(next);
        // oxlint-disable-next-line react/react-compiler
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
        const outcome = input.repick === false ? { changes: [], unchanged: false } : repickElectives(next, 'alma');
        // Net changes, one per course that left or joined the board.
        const repicked = outcome.changes.map((c) => ({ term: c.term, from: c.from, to: c.to, why: c.why, ...(c.track ? { career_track: c.track } : {}) }));
        const profile = interestProfileOf(live.current.careerText);
        const dropped = tracksBefore.filter((track) => !profile.tracks.includes(track)).map((track) => track.name);
        /**
         * Programs the student's goals name that are entered by application,
         * not registration: FIN 391 Investment Banking Academy is "Admission
         * by application only". The planner never books them, so this is the
         * only way the student hears of them. Listed beside active_topics,
         * whenever the result reports the goals.
         */
        const applyTo = (stored !== null || (mode === 'replace' && !said) ? profile.apply : []).map((code) => ({
          course: code,
          title: L.byCode.get(normCode(code))?.title ?? null,
          for_goal: profile.topics.find((topic) => topic.apply?.includes(code))?.label ?? null,
          how_to_get_in: L.context?.prereqs?.get(normCode(code))?.text || null,
        }));
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
          applyTo.length > 0
            ? 'apply_to lists programs that fit the student\'s goal and are entered by application, not registration (how_to_get_in is the catalog\'s own sentence). The planner never books them. Mention them once as programs to apply to, with what the catalog says; do not add one to the board unless the student says they were admitted.'
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
                ...(applyTo.length > 0 ? { apply_to: applyTo } : {}),
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
        const college = L.loaded.program.college;
        /**
         * More than 18 is never planned. "Can I take 20 hours my first
         * semester?" from a Grainger freshman used to get a range error; the
         * answer is Grainger's own: no overload in a first semester.
         */
        let overload: number | null = null;
        /** Under 12 is planned when asked, with the registrar's warnings: six 9-hour terms used to come back without a word. */
        let underload: number | null = null;
        if (input.min_credits !== undefined) {
          const n = Number(input.min_credits);
          if (Number.isInteger(n) && n > 18) overload = Math.max(overload ?? 0, n);
          else if (Number.isInteger(n) && n >= 6) {
            nextMin = n;
            if (n < 12) underload = Math.min(underload ?? n, n);
          } else problems.push('min_credits must be a whole number from 6 to 18.');
        }
        if (input.target_credits !== undefined) {
          if (input.target_credits === null) nextTarget = null;
          else {
            const n = Number(input.target_credits);
            if (Number.isInteger(n) && n > 18) overload = Math.max(overload ?? 0, n);
            else if (Number.isInteger(n) && n >= 6) {
              nextTarget = n;
              if (n < 12) underload = Math.min(underload ?? n, n);
            } else problems.push('target_credits must be a whole number from 6 to 18, or null for an even share.');
          }
        }
        if (overload !== null) problems.unshift(`${overloadAnswer(college, overload)} Keep the plan at 18 or under, and tell the student this.`);
        const notes = underload !== null ? { underload: underloadNote(college, underload) } : {};
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
         * A finish before the plan's first term (after a term in progress) has
         * passed or is under way. One this call sets is refused; one saved
         * earlier is dropped, so it never blocks a change to the load, the
         * summers or the terms away.
         */
        if (nextShape.finish) {
          const from = horizonFor(L.answers, new Date(), { ...nextShape, finish: null, summers: [] });
          const finish = `${nextShape.finish.season} ${nextShape.finish.year}`;
          const first = `${from.startSeason} ${from.startYear}`;
          if (termOrd(nextShape.finish.season, nextShape.finish.year) < termOrd(from.startSeason, from.startYear)) {
            if (input.finish !== undefined && input.finish !== null && input.finish !== 'default') {
              problems.push(`${finish} has passed, is under way, or is already on the student's record; the first term this plan can book is ${first}. If the student finishes in ${finish}, there is nothing left to plan before it: tell them so rather than setting it.`);
            } else nextShape.finish = null;
          }
        }
        /**
         * Terms outside the plan are refused, not saved. "Away Spring 2035"
         * and "summers 2032" came back ok, the board rebuilt identical to the
         * default, and ALMA told the student it was done. The range is the
         * one the build will use: the finish (the new one, if this call sets
         * it), moved past terms away when the student never dated it.
         */
        if (problems.length === 0 && (Array.isArray(input.away) || Array.isArray(input.summers) || input.finish !== undefined)) {
          const span = extendForAway(horizonFor(L.answers, new Date(), { ...nextShape, summers: [] }));
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
        if (problems.length > 0) return { ok: false, reason: problems.join(' '), ...notes };
        const changed =
          JSON.stringify(nextShape) !== JSON.stringify(planShapeRef.current) || nextMin !== L.minimumTermCredits || nextTarget !== (L.targetTermCredits ?? null);
        if (!changed) return { ok: true, note: 'Nothing changed; the board already has this shape.', ...notes };
        /**
         * The summers after the second and third years are the internship
         * summers. When Marcus, a Finance freshman headed for investment
         * banking, says "I'll take summer classes", Summer 2028 and Summer 2029
         * would fill on the rebuild with nobody asking whether he wants one
         * for an internship; this stops for his answer first. Only a summer
         * this call adds, and only for a student with a career goal.
         */
        const start = horizonFor(L.answers, new Date(), { ...nextShape, summers: [] });
        const planYearBefore = (summer: number) => {
          let fallsAndSprings = 0;
          // Years of college, counted from the term the student began when that was before this plan.
          const from = start.began ?? { season: start.startSeason, year: start.startYear };
          for (let at = termOrd(from.season, from.year); at < termOrd('Summer', summer); at += 1) if (at % 3 !== 1) fallsAndSprings += 1;
          return Math.ceil(fallsAndSprings / 2);
        };
        const internship = L.careerText.trim()
          ? nextShape.summers.filter((y) => !planShapeRef.current.summers.includes(y) && (planYearBefore(y) === 2 || planYearBefore(y) === 3))
          : [];
        // Edits the student made before this message; ALMA's own in this turn are its to replace.
        const handEdited = almaTurn.current?.before.edited ?? L.boardEdited;
        if (internship.length > 0 && input.confirmed !== true) {
          return {
            ok: false,
            needs_confirmation: true,
            reason: `${internship.map((y) => `Summer ${y} comes after year ${planYearBefore(y)} of this plan`).join('; ')}: the usual internship summer for a student with a goal like "${L.careerText.trim()}". Ask whether they want that summer for an internship or for classes${handEdited ? ', and tell them the rebuild replaces the edits they made by hand' : ''}; call again with confirmed true only after they choose classes.`,
            ...notes,
          };
        }
        if (handEdited && input.confirmed !== true) {
          return {
            ok: false,
            needs_confirmation: true,
            reason: 'Changing the load or the timeline rebuilds the board, which replaces the edits the student made by hand. Tell them and ask; call again with confirmed true only after they say yes.',
            ...notes,
          };
        }
        rebuildForShape.current = true;
        // The rebuild is part of this turn's one undo step, which puts the
        // old shape back with the old board.
        const shaped = [
          `at least ${nextMin} credits a term, aim ${nextTarget ?? 'an even share'}`,
          nextShape.finish ? `finish by ${nextShape.finish.season} ${nextShape.finish.year}` : 'finish date from what the student said',
          nextShape.away.length > 0 ? `away: ${nextShape.away.map(describeAway).join(', ')}` : null,
          nextShape.summers.length > 0 ? `summer classes: ${nextShape.summers.join(', ')}` : null,
          nextShape.spreadHard ? 'hard courses spread one a term where the degree allows' : null,
        ].filter(Boolean).join('; ');
        almaChanged(`rebuilt the plan to a new shape: ${shaped}`);
        keepUndoOnBuild.current = almaTurn.current !== null;
        planShapeRef.current = nextShape;
        setPlanShape(nextShape);
        setMinimumTermCredits(nextMin);
        setTargetTermCredits(nextTarget);
        return {
          ok: true,
          summary: shaped,
          note: 'The board rebuilds now. Call review_board next and tell the student what changed: the terms, the credits per term, and any note the plan adds (a lighter load needs a later finish; a term away is left empty on the board, and a semester abroad counts its hours toward the total; a summer carries at most 9 credits; summers make falls and springs lighter, so if the student wanted to finish earlier instead, confirm it and set finish).',
          ...notes,
        };
      }
      case 'exam_credit': {
        // Grainger's calculus pricing is Illinois's; a UGA College of Engineering degree has none.
        const grainger = isIllinois && /engineering/i.test(L.loaded.program.college ?? '');
        const schedule = examSchedule(str('exam'), str('kind') || null, L.examTable, grainger);
        if (!schedule) return { ok: false, reason: `${str('exam')} is not in the registrar's AP and IB table. Check the name, or it may earn no credit at ${isIllinois ? 'Illinois' : (school?.short ?? 'this university')}.` };
        const held = (L.answers?.exams ?? []).filter((e) => e.exam === schedule.exam);
        return {
          ok: true,
          ...schedule,
          priced_for: isIllinois && /Entering/.test(schedule.exam) ? (grainger ? 'students entering Grainger (this degree)' : 'students entering a college other than Grainger (this degree)') : 'every college',
          student_has: held.map((e) => `${e.kind} ${e.exam}${e.level ? ` ${e.level}` : ''}: ${e.score}`),
          // Each school's own table: public/uga-exam-credit.json was read from UGA's Registrar page.
          source: isIllinois
            ? 'https://citl.illinois.edu/current-cutoff-scores (policies for students entering Summer 2026, Fall 2026 or Spring 2027)'
            : "https://reg.uga.edu/student-records/credit-from-testing (the UGA Registrar's credit-from-testing table)",
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
            how: c.matchedBy === 'code' ? `${isIllinois ? 'Illinois' : (school?.short ?? 'University')} code on the record` : c.matchedBy === 'printed' ? 'equivalent printed on the document (confirmed)' : c.matchedBy === 'official' ? "the university's own transfer equivalency list" : c.matchedBy === 'proposal' ? 'likely equivalent from the catalog (not confirmed)' : 'entered by the student or in chat',
            ...(c.basis ? { why: c.basis.text, source: c.basis.source ?? null } : {}),
          }));
        const hoursLines = (record?.courses ?? [])
          .filter((c) => c.use && c.counts === 'hours')
          .map((c) => ({ as_printed: c.code, title: c.title, hours: c.equivalentCredits ?? c.credits, from: c.from ?? (record?.home === false ? record.institution : null), status: c.status, likely_equivalents: (c.proposals ?? []).map((p) => `${p.code} ${p.title} (${p.confidence})`), ...(c.designation ? { designation: c.designation, core_area: c.coreArea ?? null } : {}), ...(c.basis ? { why: c.basis.text, source: c.basis.source ?? null } : {}) }));
        const notCounted = (record?.courses ?? [])
          .filter((c) => !c.use)
          .map((c) => ({ as_printed: c.code, title: c.title, status: c.status, why: c.basis?.badge === 'none' ? c.basis.text : c.status === 'no_credit' ? 'the document says it earns no credit' : c.status === 'withdrawn' ? 'withdrawn' : c.status === 'failed' ? 'failed' : 'turned off by the student' }));
        const examCodes = L.priorForOptions.courseCodes.filter((code) => !transcriptCodes(record).includes(code));
        /**
         * Hours in beside hours that fill something. Every transferable
         * course counts toward the total, and most transfer credit stops
         * there: ENG 101 alone from Parkland is 3 hours in and none toward a
         * requirement, since Composition I takes ENG 101 and 102.
         */
        const use = priorCreditUse({
          context: ctx,
          requirements: L.loaded.blocks,
          programName: L.loaded.program.name,
          programCollege: L.loaded.program.college,
          hoursIn: L.priorCreditHours,
          heldCodes: heldNow(),
          genEdCredits: L.priorForOptions.genEdCredits ?? [],
          satisfied: L.report?.satisfiedByPriorCredit ?? [],
        });
        const electiveHours = Math.max(0, use.hoursIn - use.hoursFilling - use.hoursNothing);
        return {
          ok: true,
          hours_in_and_what_they_fill: `${use.hoursIn} ${use.hoursIn === 1 ? 'hour' : 'hours'} brought in, ${use.hoursFilling} of them filling a requirement of this degree${electiveHours > 0 ? `; ${electiveHours} count as elective hours toward the total and fill nothing else` : ''}${use.hoursNothing > 0 ? `; ${use.hoursNothing} earn no hours toward this degree (${use.nothing.join(', ')}, by the college's rule) but still clear prerequisites` : ''}.`,
          ...(use.filling.length > 0 ? { filling_a_requirement: use.filling } : {}),
          ...(use.electiveOnly.length > 0 ? { courses_counting_as_elective_hours_only: use.electiveOnly } : {}),
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
          // Each school's own rule: a UGA student was about to be told Illinois's residency rule (audit, 2026-10-14).
          rule: isIllinois
            ? 'Illinois decides equivalency: Transferology is the estimate, the Transfer Evaluation Report the decision. Every transferable course counts at least as elective hours toward the total. Residency: 45 hours at Illinois, 21 at the 300 level or above (admissions.illinois.edu/transferring-credit/).'
            : `UGA decides equivalency. Its Transfer Equivalency Search (${UGA_TRANSFER_PORTAL}) is UGA's own list; a match marked "the university's own transfer equivalency list" comes from the copy the planner keeps, with its page. The planner does not check UGA's residency rule or how many transfer hours UGA accepts: use university_answer for those.`,
        };
      }
      case 'find_equivalent': {
        const title = str('title');
        if (!title) return { ok: false, reason: 'Give the course title as printed or as the student said it.' };
        const lite = catalogLiteOf(L.catalog);
        const proposals = proposeEquivalents({ code: str('code').toUpperCase(), title, credits: typeof input.credits === 'number' ? input.credits : null }, lite, 5);
        /**
         * UGA's own answer first: the planner keeps UGA's Transfer Equivalency
         * lists for 91 schools (public/uga-transfer/), the same lists the
         * transcript reader uses. A catalog guess is only the fallback.
         */
        let official: Record<string, unknown> | null = null;
        /** The list's own page, as a link under the reply (the panel shows a result's `sources`). */
        let officialSources: { n: number; title: string; url: string; host: string }[] = [];
        let listFor: string | null = null;
        if (!isIllinois && str('school')) {
          const table = await loadUgaTransfer([str('school')]).catch(() => null);
          listFor = ugaSchoolEntry(table?.index, str('school'))?.name ?? null;
          const hit = str('code') ? ugaLookup(table, str('school'), str('code')) : null;
          if (hit) {
            official = {
              school: hit.entry.name,
              uga_results: hit.results.map((r) => {
                const designation = ugaDesignation(r);
                const course = designation ? null : courseOf(r);
                return {
                  result: r,
                  ...(course ? { course: `${course.code} ${course.title} (${course.credits} cr)`, on_board: holding(course.id)?.label ?? null, already_held: L.completedCodes.has(normCode(course.code)) } : {}),
                  ...(designation ? { meaning: designation.kind === 'none' ? 'does not transfer (NTFR)' : designation.kind === 'elective' ? 'elective credit in the subject, not a single UGA course' : designation.kind === 'core-us-history' ? 'core credit that also meets the U.S. history requirement, not a single UGA course' : 'core credit in the subject, not a single UGA course' } : {}),
                };
              }),
              source: hit.file.source,
              read: hit.file.readAt,
            };
            try {
              officialSources = [{ n: 1, title: `UGA Transfer Equivalency: ${hit.entry.name}`, url: hit.file.source, host: new URL(hit.file.source).host }];
            } catch {
              /* a list without a readable page has no link */
            }
          }
        }
        return {
          ok: true,
          course: { code: str('code') || null, title, credits: typeof input.credits === 'number' ? input.credits : null, school: str('school') || null },
          likely_equivalents: proposals.map((p) => ({ code: p.code, title: p.title, credits: p.credits, confidence: p.confidence, why: p.why, on_board_or_held: holding(courseOf(p.code)?.id ?? '') || L.completedCodes.has(normCode(p.code)) })),
          ...(official ? { uga_official: official } : {}),
          ...(officialSources.length > 0 ? { sources: officialSources } : {}),
          note: !isIllinois
            ? official
              ? "uga_official is UGA's own Transfer Equivalency list for this school: say \"UGA's list says\" and give its page. A result like HIST 1GHX or MATH 1GXX is core credit in the subject (record it as hours), NTFR does not transfer. likely_equivalents below are only the catalog's guesses."
              : `${!str('school') ? 'No school was given, so UGA\'s own lists were not read; ask which school taught it.' : listFor ? `UGA's list for ${listFor} has no line for ${str('code') || 'this course'}${str('code') ? '' : ' (give its code)'}.` : 'The planner holds no UGA list for that school.'} The student can check UGA's Transfer Equivalency Search (${UGA_TRANSFER_PORTAL}). ${proposals.length === 0 ? 'Nothing in the catalog reads as the same course; if it is college-level it may come in as elective hours.' : 'likely_equivalents are the catalog\'s guesses, not UGA\'s evaluation: present the top one as likely, confirm with the student, then record it.'}`
            : proposals.length === 0
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
          if (!course) return { ok: false, reason: `${code} is not in the ${isIllinois ? 'Illinois' : (school?.short ?? 'university')} catalog. If it is another school's course, call find_equivalent with its title first.` };
        } else if (hours === null || hours <= 0) {
          return { ok: false, reason: `Give ${isIllinois ? 'an Illinois' : `a ${school?.short ?? 'university'}`} course code, or the hours it transferred as.` };
        }
        const record = L.answers.transcript;
        if (course && (transcriptCodes(record).includes(normCode(course.code)) || L.completedCodes.has(normCode(course.code)))) {
          return { ok: true, changed: false, message: `${course.code} is already counted as taken.` };
        }
        const line: TranscriptCourseRecord = course
          ? { code: course.code, title: title ?? course.title, credits: course.credits, grade: null, term: null, status: inProgress ? 'in_progress' : from && !(isIllinois ? /^(illinois|uiuc|urbana)/i : /^(uga|university of georgia)\b/i).test(from) ? 'transfer' : 'completed', from, equivalent: null, matched: normCode(course.code), matchedBy: 'student', use: true, counts: 'course', illinoisCredits: course.credits }
          : { code: title?.match(/^[A-Z]{2,5}\s?\d{3,4}[A-Z]?/i)?.[0].toUpperCase() ?? 'TRANSFER', title, credits: hours, grade: null, term: null, status: 'transfer', from, equivalent: null, matched: null, matchedBy: null, use: true, counts: 'hours' };
        const base: TranscriptRecord = record ?? { fileName: isIllinois ? 'Told to ALMA' : `Told to ${botName}`, readAt: new Date().toISOString(), institution: null, kind: 'course_list', home: true, files: [], courses: [], exams: [], notes: [] };
        rebuildForCredit.current = true;
        // The line and the rebuild around it are one undo step with the turn.
        almaChanged(`recorded ${course ? course.code : `${hours} hours`} as credit already held and rebuilt the plan`);
        keepUndoOnBuild.current = almaTurn.current !== null;
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
        almaChanged(`dropped ${dropped.matched ?? dropped.code} from the credit already held and rebuilt the plan`);
        keepUndoOnBuild.current = almaTurn.current !== null;
        L.onAnswersChange({ ...L.answers, transcript: { ...record, courses: record.courses.map((c, i) => (i === index ? { ...c, use: false, counts: 'none', matched: null, matchedBy: null } : c)) } });
        return { ok: true, changed: true, dropped: `${dropped.matched ?? dropped.code}${dropped.title ? ` ${dropped.title}` : ''}`, message: 'Dropped. The plan is being rebuilt; call review_board in your next step to see it.' };
      }
      case 'planner_answer': {
        const ask = await askContext();
        if (!ask) return { handled: false, note: 'The planner data is not loaded.' };
        const routed = routeQuestion(str('question'), ask);
        if (routed.kind === 'local') {
          const also = routed.alsoLocal;
          if (!also) return { handled: true, text: routed.answer.text, sources: routed.answer.sources, grounded: routed.answer.grounded };
          // Two local halves ("how hard is CS 225 and what are its prerequisites"): both answers, sources numbered on.
          const offset = routed.answer.sources.length;
          return {
            handled: true,
            text: `${routed.answer.text}\n\n${also.text}`,
            sources: [...routed.answer.sources, ...also.sources.map((s) => ({ ...s, n: s.n + offset }))],
            grounded: routed.answer.grounded && also.grounded,
          };
        }
        return { handled: false, note: 'Not a question the board can answer. Try university_answer.' };
      }
      case 'compare_programs': {
        if (!isIllinois || !L.core) return { ok: false, reason: 'Comparing programs needs the Illinois catalog, which is not loaded.' };
        const core = L.core;
        // Every crawled page with a course list, BALAS majors included: the
        // rail's program menu reads the degree field, which 89 LAS pages leave
        // empty, but a second major only needs the page's requirements.
        const catalogPrograms = (core.programs ?? []).filter((p) => p.dataStatus === 'catalog' && p.courseCount > 0);
        const primary: ProgramSide = {
          id: L.loaded.summary.id,
          name: L.loaded.program.name,
          college: L.loaded.program.college,
          url: L.loaded.urls[0]?.url ?? '',
          totalCredits: degreeTotalNow(),
          requirements: L.loaded.blocks,
        };
        const termOfCode = new Map<string, string>();
        for (const t of board.terms) for (const id of t.courseIds) {
          const code = L.courseIndex.get(id)?.code;
          if (code) termOfCode.set(normCode(code), t.label);
        }
        const boardCodes = board.terms.flatMap((t) => t.courseIds.map((id) => L.courseIndex.get(id)?.code ?? '')).filter(Boolean);
        const held = heldNow();
        const language = L.language ? { completed: L.language.completed, codes: L.language.codes } : null;
        const fit = L.quality ? (code: string) => L.quality?.(code).score ?? 0 : undefined;
        const noMinors =
          'The planner has no minor or certificate pages (the catalog crawl read the 308 degree pages only), so it cannot check a minor. For a minor, get its requirements with university_answer and try its courses with what_if.';
        const query = str('program');
        const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);

        if (!query || input.closest === true) {
          const candidates = await readPrograms(core, catalogPrograms.filter((p) => p.id !== primary.id));
          const near = secondMajorsWithinReach({ context: ctx, primary, candidates, heldCodes: held, boardCodes, language, limit });
          return {
            ok: true,
            simulated: true,
            closest_second_programs: near.map((n) => ({
              program: n.name,
              pair: n.kind,
              courses_away: n.coursesAway,
              courses_to_add: n.adds,
              ...(n.unnamedHours > 0 ? { plus_hours_the_page_names_no_courses_for: n.unnamedHours } : {}),
              courses_already_counting: n.alreadyCounting,
              ...(n.unread > 0 ? { rows_not_read: n.unread } : {}),
              ...(n.doubts.length > 0 ? { reading_doubts: n.doubts } : {}),
            })),
            minors: noMinors,
            note: 'Counted against the board and credit as they are, fewest courses first, double majors ahead of dual degrees (a dual degree is 30 more hours whatever the board covers). A count is a floor where a row was not read. Mention the closest one or two only when the student is weighing a second program; call compare_programs with a program for its cost and rules. Nothing on the board changed.',
          };
        }

        const found = resolveProgram(query, catalogPrograms);
        if (found.minor) {
          // "CS minor" is not Computer Science, BS: comparing the major would
          // answer a question the student did not ask, 30 hours bigger.
          return {
            ok: false,
            minors: noMinors,
            ...(/\b(computer science|cs)\b/i.test(query) ? { cs_minor: `${CS_MINOR.text} (${CS_MINOR.source})` } : {}),
            ...(found.match ? { major_of_that_name: `${found.match.name} is a major the planner can compare as a second major, if that is what the student means.` } : {}),
          };
        }
        if (!found.match) {
          return {
            ok: false,
            reason: found.candidates.length > 0 ? `"${query}" could name more than one program; ask which.` : `No degree page matches "${query}".`,
            closest_names: found.candidates.map((c) => c.name),
          };
        }
        const summary = catalogPrograms.find((p) => p.id === found.match?.id);
        const [second] = summary ? await readPrograms(core, [summary]) : [];
        if (!second) return { ok: false, reason: `The page for ${found.match.name} could not be read.` };
        const base = lastBuild.current && lastBuild.current.input.programId === primary.id ? lastBuild.current : null;
        const c = comparePrograms({ context: ctx, primary, second, heldCodes: held, boardCodes, language, fit, base });
        const concentrations = catalogPrograms.filter((p) => p.id.startsWith(`${second.id}/`));
        const placed = c.both ? placementsOnBoard({ context: ctx, board, placed: c.both.placed, options: validateOptions() }) : [];
        const onThisBoard = placed.filter((p) => !p.pastFinish);
        const pastFinish = placed.filter((p) => p.pastFinish);
        const unit = (o: { amount: number; unit: string } | null) => (o ? `${o.amount} ${o.unit === 'hr' ? 'hours' : o.unit === 'course' ? (o.amount === 1 ? 'course' : 'courses') : 'semesters'}` : '');
        return {
          ok: true,
          simulated: true,
          program: second.name,
          page: second.url,
          pair: c.pair.kind,
          pair_summary: c.pair.summary,
          rules: c.pair.rules.map((r) => `${r.text} (${r.source})`),
          ...(c.pageSentences.length > 0 ? { what_the_pages_say_about_a_second_major: c.pageSentences.map((r) => `${r.text} (${r.source})`) } : {}),
          already_counts: c.alreadyCounts.map(
            (a) => `${a.code} ${a.title}, ${a.credits} hr, for "${a.row}"; ${a.held ? 'already taken' : `on the board in ${termOfCode.get(a.code) ?? 'the plan'}`}${a.alsoMajor ? `; also counts for ${primary.name}` : ''}`,
          ),
          still_owed: c.open.map((row) => ({
            requirement: row.label,
            owed: unit(row.owed),
            ...(row.take.length > 0 ? { planner_picks: row.take } : {}),
            ...(row.options.length > 0 ? { other_choices: row.options } : {}),
            ...(row.note ? { note: row.note } : {}),
          })),
          courses_it_adds: c.adds,
          hours_it_adds: c.addsHours,
          ...(c.unnamedHours > 0 ? { hours_the_page_names_no_courses_for: c.unnamedHours } : {}),
          ...(c.unread.length > 0 ? { rows_not_read: c.unread.map((row) => `${row.label}${row.note ? `: ${row.note}` : ''}`) } : {}),
          ...(c.standIns.length > 0 ? { not_credited_together: c.standIns } : {}),
          general_education: c.genEd.open.length > 0 ? `Open for ${second.name}: ${c.genEd.open.join('; ')}.` : 'The campus categories are the same for both programs, and the board meets them.',
          ...(c.distinctAdvanced.asked !== null
            ? { distinct_advanced_hours: `${c.distinctAdvanced.hours} hours at the 300 level or above count for ${second.name} and not for ${primary.name}; the college asks for ${c.distinctAdvanced.asked}.` }
            : {}),
          overlap: `${Math.round(c.overlapShare * 100)}% of ${second.name}'s own course hours also count for ${primary.name}.`,
          ...(c.doubts.length > 0 ? { reading_doubts: c.doubts } : {}),
          ...(concentrations.length > 0 ? { concentrations: `${second.name} has concentrations with their own pages: ${concentrations.map((p) => p.name).join('; ')}. Compare the student's pick for its courses.` } : {}),
          cost: c.both
            ? {
                this_plan: `${c.both.base.terms} terms to ${c.both.base.last}, ${c.both.base.hours} hours, about ${c.both.base.pace} a fall or spring`,
                with_both: `${c.both.both.terms} terms to ${c.both.both.last}, ${c.both.both.hours} hours, about ${c.both.both.pace} a fall or spring`,
                extra_hours: c.both.extraHours,
                extra_terms: c.both.extraTerms,
                where_the_rebuilt_plan_puts_them: c.both.placed.map((p) => `${p.code} in ${p.term}${p.why === 'prerequisite' ? ' (a prerequisite)' : ''}`),
                ...(c.both.notPlaced.length > 0 ? { could_not_place: c.both.notPlaced } : {}),
                ...(c.both.shortOfTotal > 0 ? { short_of_total: c.both.shortOfTotal } : {}),
                prerequisite_problems: c.both.problems.length > 0 ? c.both.problems : 'none: on the rebuilt plan every added course comes after what it needs',
              }
            : 'This board was restored from the device, not built this session, so hours and terms were not measured. Rebuild measures them (it replaces the student\'s edits, so ask first).',
          ...(onThisBoard.length > 0
            ? { to_try_on_this_board: onThisBoard.map((p) => `${p.code} in ${p.term}${p.prerequisitesMet ? '' : ' (a prerequisite is still missing here)'}`) }
            : {}),
          ...(pastFinish.length > 0 ? { past_this_board_s_last_term: pastFinish.map((p) => `${p.code} (${p.term} on the rebuilt plan)`) } : {}),
          note: `Nothing on the board changed, and the board keeps planning ${primary.name} alone. Put none of these courses on the board unless the student says yes; then what_if (at most six changes a call) before add_course.`,
        };
      }
      case 'find_clubs': {
        // Read-only: no undo step, no confirmation. Ranked for the words as they are now, so a goal
        // set_priorities stored earlier in this turn counts. Its sources link each club under the reply.
        if (!isIllinois) return { ok: false, reason: 'The club directory is Illinois\'s; this school has none here.', sources: [] };
        const clubs = await loadIllinoisClubs();
        if (clubs.ok) clubFile.current = clubs.value;
        return runFindClubs(input, clubStudentFor(L.careerText, L.loaded, L.answers), clubs.ok ? clubs.value : null);
      }
      default:
        return { ok: false, error: `Unknown tool ${String(name)}.` };
    }
  };

  /**
   * One step back: the board with its report, so a swapped elective slot
   * comes back as a slot and not as "added". An ALMA turn also puts back the
   * settings and the record that turn changed, and its reply is told.
   */
  function undo() {
    const entry = undoStack.at(-1);
    if (!entry) return;
    if (entry.alreadyTakenCourseCodes && answers && onAnswersChange) {
      creditRestored.current = true;
      onAnswersChange({ ...answers, alreadyTakenCourseCodes: entry.alreadyTakenCourseCodes });
    }
    setUndoStack((current) => current.slice(0, -1));
    applyBoard(entry.before);
    const turn = entry.turn;
    if (turn) {
      if (turn.settings) {
        const s = turn.settings;
        if (s.minimumTermCredits !== undefined) setMinimumTermCredits(s.minimumTermCredits);
        if (s.targetTermCredits !== undefined) setTargetTermCredits(s.targetTermCredits);
        if (s.careerInterests !== undefined) setCareerInterests(s.careerInterests);
        if (s.careerCleared !== undefined) setCareerCleared(s.careerCleared);
        if (s.priorities !== undefined) setPriorities(s.priorities);
        if (s.planShape !== undefined) {
          planShapeRef.current = s.planShape;
          setPlanShape(s.planShape);
        }
      }
      const record = turn.transcript;
      if (record && answers && onAnswersChange && record.value !== (answers.transcript ?? null)) {
        const restoredAnswers = { ...answers, transcript: record.value };
        // The board being put back was built for this record already.
        if (creditKeyOf(restoredAnswers) !== creditKeyOf(answers)) creditRestored.current = true;
        onAnswersChange(restoredAnswers);
      }
      // Undone while the turn is still running: its next change starts a new step.
      const open = almaTurn.current;
      const done = open?.id === turn.id ? { id: turn.id, toolIds: [...open.toolIds], summary: [...open.summary] } : { id: turn.id, toolIds: turn.toolIds, summary: turn.summary };
      if (open?.id === turn.id) {
        open.pushed = false;
        open.toolIds = [];
        open.summary = [];
      }
      setUndoneTurns((list) => [...list, done]);
    }
    if (turn) notify(`${botName}'s changes undone`, 'The board is back to how it was before that message.', 'info');
    else setStatus('Last change undone.');
  }

  function save() { setSaveTick((tick) => tick + 1); }

  /** "Undo these changes" on an ALMA reply: only while that turn is still the newest step. */
  function undoAlmaTurn(id: string) {
    if (undoStack.at(-1)?.turn?.id !== id) return;
    undo();
  }

  const newestTurn = undoStack.at(-1)?.turn;
  const almaTurns: BotTurns = {
    begin: beginAlmaTurn,
    end: endAlmaTurn,
    latest: newestTurn && newestTurn.toolIds.length > 0 ? { id: newestTurn.id, toolIds: newestTurn.toolIds } : null,
    undo: undoAlmaTurn,
    undone: undoneTurns,
  };

  function exportPlan() {
    if (!plan) return;
    // The file says what it is, for whoever opens it later. A reader (importPlan) ignores the notice field.
    const blob = new Blob([JSON.stringify({
      notice: unofficialNotice(school?.name),
      school: school?.id,
      programIds,
      minorIds,
      certificateIds,
      emphasisSelections: answers?.emphasisSelections ?? {},
      programId,
      plan,
      plans: planTabs.map((candidate) =>
        candidate.id === activePlanId
          ? { ...candidate, plan, board: boardNow() ?? undefined, issueSeverity: planWideSeverity, issueSummary: planWideSummary }
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
          const before = boardNow();
          if (before) setUndoStack((current) => pushUndo(current, { before }));
          applyBoard({ plan: parsed.plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: true });
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
      setStatus('Link copied. It opens an unofficial plan: check it with your academic advisor.');
    } catch {
      setStatus('The clipboard is blocked. Use Download instead.');
    }
  }

  function startOver() {
    clearAnswers();
    forgetThisBoard();
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
      // Every crawled term, so "where does my first class meet" reads the
      // Spring 2027 column's own rooms, and a fall course reads fall times.
      schedules: full.schedules,
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
              ? 'Courses, requirements, prerequisites, grade history and class times.'
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
    ...(plan?.doubleDawgs ? [`Double Dawgs combines both degree stages. ${combinedLedger?.sharedCredits ?? 0} shared credits are scheduled once and counted toward both degrees. Graduate admission and the proposed program of study still require approval.`] : []),
    ...(ugaSamplePlans.length > 0 ? ["UGA's published sample plans break ties between otherwise equally suitable courses. They do not override prerequisites, your preferences, or degree requirements. Unnamed elective slots in those samples are not treated as named recommendations."] : []),
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
    ...(isIllinois && isGraduatePlan ? [gradSettings.caveat] : []),
    ...(programIds.length > 1
      ? [
          isGraduatePlan
            ? 'This combined graduate draft includes every named requirement from the selected degree pages and counts shared courses once. Dual-degree approval, residency, and program-of-study rules still need advisor confirmation.'
            : 'This double-major draft combines every named requirement from the selected degree pages and counts shared courses once. College residency rules and whether the pairing is one degree or two still need advisor confirmation.',
        ]
      : []),
    ...(minorIds.length + certificateIds.length > 0
      ? [
          isIllinois && !isGraduatePlan
            ? 'Minors are a beta: a minor the planner has checked is planned from its catalog page beside your degree, which always comes first; one it has not checked is named with its page and not planned. Campus rules: 16 to 21 hours, 6 of them at the 300 or 400 level apart from your major, courses taken for a grade, and the minor declared with the department that offers it.'
            : 'Selected minors and certificates are planned from their published requirement pages and share courses where the catalog allows. Residency, grade, and application rules still need advisor confirmation.',
        ]
      : []),
    'Prerequisites are parsed from catalog sentences. Anything about placement or consent is not checked here.',
  ];

  /**
   * "Print for my advisor": the board, what each course is for, a backup for
   * each of next term's picks, every assumption and flag, and the questions
   * for the college, built from what is on screen now. The backups are the
   * card dropdown's own runners-up (alternativesFor), the list ALMA's
   * explain_choice reads, so paper and screen offer the same course.
   */
  const openPacket = async () => {
    const board = planRef.current ?? plan;
    if (!board) return;
    // Every published class schedule, so the packet can say which terms are
    // not estimates and which of their courses the schedule does not list.
    // The terms past the first load here, once, if nothing has loaded them yet.
    const scheduleTerms = isIllinois ? sectionTermsOf(core?.meta) : [];
    const schedules = scheduleTerms.length > 0 ? await loadIllinoisSectionTerms().catch(() => null) : null;
    const packetSchedules = scheduleTerms.map((t) => {
      const map = schedules?.get(t.id) ?? null;
      return {
        id: t.id,
        label: t.label,
        year: t.year,
        term: t.term,
        listed: map ? new Set([...map].filter(([, row]) => row.total > 0).map(([code]) => code)) : null,
      };
    });
    const record = answers?.transcript ?? null;
    const known = (code: string) => byCode.has(normCode(code));
    const priced = exams.map((e) => {
      const codes = examCourses([e], examCredit.entries, known);
      const hours = examElectiveHours([e], examCredit.entries, transcriptIndirectCodes(record), catalogCredits);
      return {
        name: `${e.kind} ${e.exam.replace(/\s+-\s+Entering.*$/, '')}${e.level ? ` ${e.level}` : ''}, score ${e.score}`,
        codes,
        grants: [codes.join(', '), hours > 0 ? `${hours} elective ${plural(hours, 'hour')}` : ''].filter(Boolean).join(' and '),
      };
    });
    // Held codes no document shows: typed under Credit, or told to ALMA
    // without a record line. The record's own lines are listed from the record.
    const shown = new Set([...transcriptCodes(record), ...priced.flatMap((e) => e.codes)].map(normCode));
    const entered = [...completedCodes].filter((code) => !shown.has(code));
    setPacket(
      buildAdvisorPacket({
        school: {
          id: school?.id ?? 'demo',
          name: school?.name ?? 'Your university',
          short: school?.short ?? 'your university',
          audit: isIllinois ? 'uAchieve degree audit' : isUga ? 'DegreeWorks audit' : 'degree audit',
        },
        program: {
          name: loaded?.minors?.length
            ? `${activeProgramName ?? 'Your plan'}, with the ${loaded.minors.map((minor) => `${minor.name}${minor.checked ? '' : ' (not checked by the planner)'}`).join(' and the ')}`
            : activeProgramName ?? 'Your plan',
          college: loaded?.program.college ?? null,
          url: loaded?.urls[0]?.url ?? null,
          total: degreeTotalNow() ?? activeProgramTotal,
          totalPublished: !isCatalogSchool || Boolean(loaded?.summary.totalCredits || loaded?.program.totalCredits),
        },
        board,
        courseById: (id) => courseIndex.get(id),
        context,
        marks: electiveOf,
        // A minor's rows carry its name here, so a course booked for one says whose it is.
        blocks: loaded?.minors?.length
          ? [...loaded.blocks, ...loaded.minors.filter((minor) => minor.checked).flatMap((minor) => minor.blocks.map((block) => ({ ...block, label: `${minor.name}: ${rowLabel(block)}` })))]
          : loaded?.blocks ?? [],
        bookedFor: report?.bookedFor ?? {},
        studentAdded: studentAdded.current,
        creditsLine: context ? describeCreditProgress(credits, activeProgramTotal) : totalCredits,
        hoursWithoutCourse: priorHoursOf(answers, exams, examCredit.entries, catalogCredits),
        goal: careerText,
        language: report?.language ?? null,
        languageYears: answers?.languageYears ?? null,
        transcript: record,
        exams: priced.map(({ name, grants }) => ({ name, grants })),
        enteredCodes: entered,
        away: report?.away ?? [],
        residency: report?.residency ?? null,
        admission: report?.admission ?? null,
        flags: groupIssues(issues).map((g) => ({ severity: g.severity, title: g.title, message: g.message, count: g.count })),
        caveats,
        alternatives: alternativesFor,
        madeOn: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        ...(packetSchedules.length > 0 ? { schedules: packetSchedules } : {}),
      }),
    );
  };

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
      <Toaster />

      <header className="app-header">
        <a className="brand" href="#top" aria-label="ORION planner home">
          <Image src="/orion-logo.png" alt="" width={44} height={44} priority />
          <span className="brand-name">ORION</span>
        </a>
        {/* Always on screen: the planner is not the university's, and a plan is checked with an advisor. */}
        <UnofficialBadge schoolName={school?.name ?? null} bot={botName} />
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
              <DropdownMenuItem onClick={() => void openPacket()} disabled={!plan}><Printer /> Print for my advisor</DropdownMenuItem>
              <DropdownMenuItem disabled>{saveState === 'failed' ? 'Not saved on this device' : saveState === 'saved' ? 'Saved on this device' : 'Saves on this device as you go'}</DropdownMenuItem>
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
        combinedDegree={Boolean(plan?.doubleDawgs)}
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
        programLevel={programLevel}
        supportsGraduatePrograms={isUga || isIllinois}
        onProgramLevelChange={changeProgramLevel}
        programs={programOptions}
        programIds={programIds}
        onProgramsChange={changePrograms}
        programGuidance={isUga && !isGraduatePlan ? (
          <>
            <DoubleDawgsPicker
              programIds={programIds}
              selectedId={answers?.doubleDawgsPathwayId}
              sharedCodes={answers?.doubleDawgsSharedCodes}
              completedCodes={[...completedCodes]}
              emphasisSelections={answers?.emphasisSelections}
              onSharedChange={(doubleDawgsSharedCodes) => { if (answers && onAnswersChange) onAnswersChange({ ...answers, doubleDawgsSharedCodes }); }}
              onChange={(doubleDawgsPathwayId) => {
                if (answers && onAnswersChange) onAnswersChange({ ...answers, doubleDawgsPathwayId, doubleDawgsSharedCodes: undefined });
              }}
            />
            {answers?.doubleDawgsPathwayId && onAnswersChange && <DoubleDawgsTiming answers={answers} onChange={onAnswersChange} />}
            {ugaSamplePlans.length > 0 && (
              <div className="sample-plan-links">
                <p>Official sample plans guide otherwise tied suggestions.</p>
                {ugaSamplePlans.map((sample) => <a key={sample.programId} href={sample.url} target="_blank" rel="noreferrer">{sample.programName}: sample plan</a>)}
              </div>
            )}
          </>
        ) : undefined}
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
        priorities={priorities}
        onPrioritiesChange={setPriorities}
        onRepick={() => {
          const { changes: changed, unchanged } = repickElectives(priorities);
          const picks = [...electiveOf.values()].length;
          if (unchanged) {
            notify('Nothing to re-pick', 'The board was built, or last re-picked, for these priorities, so it already reflects them. Change a knob first, or open a card\'s Options menu to see the runners-up.', 'info');
          } else if (changed.length > 0) {
            notify(
              `Re-picked ${changed.length} ${plural(changed.length, 'course')}`,
              changed.map((c) => (c.from ? `${c.to} for ${c.from} in ${c.term}` : `${c.to} added in ${c.term}`)).join('; ') + '.',
            );
          } else {
            notify(
              'Nothing to swap',
              `Each of the planner's ${picks} ${plural(picks, 'pick')} already holds the best course for these priorities. Change a knob and try again, or open a card's Options menu to see the runners-up.`,
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
        clubs={
          isIllinois ? (
            <ClubPicks
              student={clubStudent}
              botName={botName}
              onEditGoals={editGoals}
              onOpenAlma={() => {
                setRailOpen(false);
                setFinderOpen(false);
                setChatOpen(true);
              }}
            />
          ) : undefined
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
                        <IssueBadge
                          variant="dot"
                          title={`${candidate.name}: plan-wide notes`}
                          message={tabIssueSummary(candidate)}
                          severity={tabIssueSeverity(candidate)!}
                          onClick={() => switchPlanTab(candidate.id)}
                          coursesByCode={byCode}
                          onShowCourse={(courseId) => {
                            switchPlanTab(candidate.id);
                            showWarningCourse(courseId);
                          }}
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
                  coursesByCode={byCode}
                  onShowCourse={showWarningCourse}
                />
              ))}
            </div>
          )}

          {plan && (attentionText || earlyText) && (
            <span className="board-bar-note" role="note">
              {[attentionText, earlyText].filter(Boolean).join(' ')}
            </span>
          )}
          {isIllinois && suspendedNotice(programId) && (
            <span className="board-bar-note" role="note">{suspendedNotice(programId)}</span>
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
              {programBusy ? 'Reading the degree page.' : doubleDawgsPathway && !loaded?.doubleDawgsGraduate
                ? "This pathway's graduate curriculum is not linked yet. Open Programs to choose another pathway or a bachelor's-only plan."
                : 'Building your plan.'}
            </p>
          )}
          {plan?.terms.map((term) => {
            const credits = termCredits(term.courseIds);
            return (
              <SemesterColumn
                key={term.id}
                term={term}
                degreeStage={plan.doubleDawgs ? (degreeTermOrder(term) <= degreeTermOrder(plan.doubleDawgs.undergraduateFinish) ? "Bachelor's" : "Master's") : undefined}
                allTerms={plan.terms}
                courseIndex={courseIndex}
                coursesByCode={byCode}
                onShowCourse={showWarningCourse}
                issues={issues}
                selectedCourseId={selectedCourseId}
                credits={credits.label}
                heavy={credits.heavy}
                weekly={weeklyFits.get(term.id) ?? null}
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
                alternativesFor={alternativesFor}
                onSwapCourse={swapCourse}
                electiveOf={electiveOf}
                instructors={instructorControl}
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
                options: chooserOptions.options,
                whys: chooserOptions.whys,
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
        focusRequest={mapFocusRequest}
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
        instructors={plan ? instructorControl : undefined}
        instructorTyping={instructorTyping}
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
            clubGoal ? `Which clubs should I join for ${clubGoal}?` : 'Can you suggest an elective based on my interests?',
            'Which term is hardest?',
          ]}
          ready={Boolean(context)}
          turns={almaTurns}
        />
      )}
      {packet && <AdvisorPacketDialog packet={packet} onClose={closePacket} />}
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
/**
 * The board description's line about class times, for ALMA: which schedules
 * are published, which term a card's times come from, and which term the
 * planner's own choices still weigh.
 */
function scheduleSentence(terms: Array<{ label: string; year: number; term: string }>, scoringLabel: string | null): string {
  if (terms.length === 0) return 'No class schedule is loaded, so cards show no section times.';
  if (terms.length === 1) return `Section times on cards come from ${terms[0].label}.`;
  return `Class schedules are published for ${termsInWords(terms)}. A card's section times come from its own term's schedule when that is published, else the latest schedule of the same season (the card says which); the planner's own choices still weigh ${scoringLabel ?? 'the first crawled term'}'s sections.`;
}

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
    `This plan is ${planned}, over the ${degreeTotal} hours the degree page lists. Course sizes and overlapping requirements can leave extra credits. Review optional courses with your advisor before removing them.`,
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
    const source = record.home === false ? `${record.institution ?? 'another school'}'s ${record.kind === 'transfer_report' ? 'evaluation report' : record.kind === 'degree_audit' ? 'degree audit' : record.kind === 'course_list' ? 'course list' : 'transcript'}` : record.kind === 'course_list' && record.courses.every((c) => c.matchedBy === 'student') ? 'courses the student typed or told the bot' : `the student's ${record.schoolId === 'uga' ? 'UGA' : 'Illinois'} ${record.kind === 'degree_audit' ? 'degree audit' : record.kind === 'transfer_report' ? 'evaluation report' : 'record'}`;
    const likely = record.courses.filter((c) => c.use && c.counts === 'course' && c.matchedBy === 'proposal').map((c) => `${c.code} as ${c.matched}`);
    const open = transcriptOpenLines(record).map((c) => `${c.code}${c.title ? ` ${c.title}` : ''}${c.proposals?.[0] ? ` (likely ${c.proposals[0].code})` : ''}`);
    parts.push(`Credit read from ${source} (${record.courses.length} lines).`);
    if (likely.length) parts.push(`Likely equivalents filled in from the catalog, not confirmed by the university: ${likely.join(', ')}.`);
    if (open.length) parts.push(`Lines counted as hours only, with a university course still to settle: ${open.join('; ')}.`);
    const maybe = maybeLines(record);
    if (maybe.length) parts.push(`Lines that only may be a course, unconfirmed: ${maybe.map((m) => `${m.lineCode} may be ${m.code}`).join('; ')}. The board does not book such a course; where the degree needs it, that requirement stays open until the student confirms or rejects the line in the transfer list.`);
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
    transcriptCreditAdjustment(record, creditsOf)
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
type StartHorizon = Horizon & {
  startNote: string | null;
  began: { season: SemesterSeason; year: number } | null;
  beganFrom: 'words' | 'record' | 'standing' | null;
  /** Falls and springs since `began` that nothing on the record holds, each assumed to have earned about 15 credits. */
  assumedTerms: Array<{ season: SemesterSeason; year: number }>;
  /** The hours assumed for them, less classes on the record with no term. */
  assumedHours: number;
  /** A graduation here that is under way, past, or already on the record: the board is one term in case plans change. */
  gradPassed: { season: SemesterSeason; year: number } | null;
};

function horizonFor(
  answers: OnboardingAnswers | null | undefined,
  today: Date,
  shape: PlanShape,
): StartHorizon {
  // The plan starts at the first term a student can still add classes to on
  // today's date, not the crawled term: in October that is Spring. "This
  // fall" and "incoming" in the student's words are read as of the day they
  // wrote them.
  //
  // UGA keeps the start Cameron's planner gives it: this year's fall, with
  // four years counted from there. The first-open-term start, and the terms
  // before it counted as about 15 credits each, are Illinois's: UGA's credit
  // and requirement counts do not add those assumed credits, so a UGA plan
  // that started in Spring read as 15 credits short of its degree.
  const uga = answers?.schoolId === 'uga';
  const open = uga ? { season: 'Fall' as const, year: today.getFullYear() } : firstOpenTerm(today);
  const stamped = answers?.timelineAt ? new Date(answers.timelineAt) : null;
  const written = stamped && !Number.isNaN(stamped.getTime()) ? stamped : today;
  const now = calendarTerm(today);
  /**
   * A record with courses in progress in the plan's first term means the
   * student is taking that term now: those courses are counted as done, so
   * planning another full load in the same term books the term twice. The
   * plan starts the term after the last one in progress. A term in progress
   * now or later also means they are enrolled, not incoming.
   */
  const busy = latestInProgressTerm(answers?.transcript);
  const readNow = readHorizon(
    answers ? timelineForPlanning(answers) : '',
    open,
    uga ? null : calendarTerm(written),
    {
      firstTermOnRecord: firstIllinoisTerm(answers?.transcript),
      enrolled: Boolean(busy && termOrd(busy.season, busy.year) >= termOrd(now.season, now.year)),
      openWhenWritten: uga ? null : firstOpenTerm(written),
    },
  );
  // At UGA a start the student only described (no record of it) is not
  // counted from: those terms would need the assumed credits UGA does not add.
  const ugaFromStart = uga && readNow.began && readNow.beganFrom !== 'record';
  const ugaEnd = ugaFromStart && !readNow.stated ? stepRegular({ season: readNow.startSeason, year: readNow.startYear }, 7) : null;
  const { began, beganFrom, datedStart, incoming, gradPassed: passedInWords, pastAway, ...read } = ugaFromStart
    ? { ...readNow, began: null, beganFrom: null, pastAway: [], ...(ugaEnd ? { gradSeason: ugaEnd.season, gradYear: ugaEnd.year } : {}) }
    : readNow;
  const startOrd = termOrd(read.startSeason, read.startYear);
  const horizon: StartHorizon = { ...read, startNote: null, began, beganFrom, assumedTerms: [], assumedHours: 0, gradPassed: passedInWords };
  // A graduation term picked in onboarding stands, when it is not before the plan's start.
  if (answers?.graduationSeason && answers.graduationYear &&
      termOrd(answers.graduationSeason, answers.graduationYear) >= startOrd) {
    horizon.gradSeason = answers.graduationSeason;
    horizon.gradYear = answers.graduationYear;
    horizon.stated = true;
  }
  // What the student asked ALMA for wins over what the About-you words said,
  // unless that term is before the plan's first (set_plan_shape refuses one
  // now; a board saved earlier may still carry it).
  const busyNext = busy && termOrd(busy.season, busy.year) >= startOrd
    ? (busy.season === 'Fall' ? { season: 'Spring' as const, year: busy.year + 1 } : { season: 'Fall' as const, year: busy.year })
    : null;
  const firstOrd = busyNext ? termOrd(busyNext.season, busyNext.year) : startOrd;
  const finishPassed = Boolean(shape.finish && termOrd(shape.finish.season, shape.finish.year) < firstOrd);
  if (shape.finish && !finishPassed) {
    horizon.gradSeason = shape.finish.season;
    horizon.gradYear = shape.finish.year;
    horizon.stated = true;
    horizon.gradPassed = null;
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
  if (busyNext) {
    const next = busyNext;
    horizon.startSeason = next.season;
    horizon.startYear = next.year;
    const nextOrd = termOrd(next.season, next.year);
    const gradOrd = termOrd(horizon.gradSeason, horizon.gradYear);
    if (gradOrd < nextOrd && horizon.stated) {
      // A finish they gave whose term is already on the record ("Senior,
      // graduating May 2027" with Spring 2027 registered): nothing is left to
      // plan, not a fresh four years.
      horizon.gradPassed ??= { season: horizon.gradSeason, year: horizon.gradYear };
      horizon.gradSeason = next.season;
      horizon.gradYear = next.year;
    } else if (gradOrd < nextOrd || (gradOrd === nextOrd && !horizon.stated)) {
      // A stated last term equal to the new first one stands (a senior's last semester).
      const from = began ?? next;
      let end = stepRegular(from, 7 + pastAway.length);
      if (termOrd(end.season, end.year) < nextOrd) end = stepRegular(next, 7);
      horizon.gradSeason = end.season;
      horizon.gradYear = end.year;
      horizon.stated = false;
    }
  }
  const label = (t: { season: SemesterSeason; year: number }) => `${t.season} ${t.year}`;
  const start = { season: horizon.startSeason, year: horizon.startYear };
  // Terms since they began that nothing on the record holds: about 15 credits
  // each, so the terms left are not loaded to 18. Not for a record's own
  // start (a term missing from a full record is a term off), and not for the
  // terms away they named.
  if (began && beganFrom !== 'record' && !horizon.gradPassed) {
    const coverage = recordCoverage(answers?.transcript);
    horizon.assumedTerms = uncoveredTerms(began, start, coverage.terms, pastAway);
    horizon.assumedHours = assumedHoursOf(horizon.assumedTerms, coverage.unplacedHours);
  }
  const assumedNames = horizon.assumedTerms.length === 1 ? label(horizon.assumedTerms[0]) : `${horizon.assumedTerms.slice(0, -1).map(label).join(', ')} and ${label(horizon.assumedTerms[horizon.assumedTerms.length - 1] ?? start)}`;
  const assumed = horizon.assumedHours <= 0 ? ''
    : horizon.assumedHours < horizon.assumedTerms.length * 15
      ? ` Until you do, this plan counts about ${horizon.assumedHours} more credits for ${assumedNames}, beyond the classes you have added.`
      : ` Until you do, this plan counts ${assumedNames} as about ${horizon.assumedHours} credits${horizon.assumedTerms.length > 1 ? ' in all' : ''}, the usual full load.`;
  // What the student is told about the first term, from the term the board starts in.
  const nowUnderWay = now.season !== 'Summer' && termOrd(now.season, now.year) < termOrd(start.season, start.year);
  if (horizon.gradPassed) {
    const p = horizon.gradPassed;
    const when = busy && termOrd(p.season, p.year) <= termOrd(busy.season, busy.year) && termOrd(p.season, p.year) > termOrd(now.season, now.year)
      ? 'and those classes are already on your record'
      : termOrd(p.season, p.year) >= termOrd(now.season, now.year) ? 'which is under way' : 'which has passed';
    horizon.startNote = `You said you finish in ${label(p)}, ${when}, so there is nothing left to plan before it. This board shows ${label(start)} only in case your plans change; tell ALMA a later finish if you need one.`;
  } else if (finishPassed && shape.finish) {
    horizon.startNote = `The finish set earlier, ${label(shape.finish)}, has passed, so this plan uses the finish from About you instead.`;
  } else if (beganFrom === 'record') {
    horizon.startNote = null;
  } else if (busyNext) {
    horizon.startNote = assumed ? `Your record does not show your classes from ${assumedNames} yet. Add them (upload your transcript or tell ALMA) so they count.${assumed}` : null;
  } else if (began) {
    horizon.startNote = nowUnderWay && termOrd(now.season, now.year) >= termOrd(began.season, began.year)
      ? `${label(now)} is under way and adding classes has closed, so this plan starts in ${label(start)}${sameTerm(now, began) ? '' : ` and counts your finish from ${label(began)}, when you started`}. Add the classes you are taking now (upload your schedule or tell ALMA) so they count.${assumed}`
      : `You started in ${label(began)}, so this plan starts in ${label(start)}, the next term you can sign up for, and counts your finish from ${label(began)}. Add the classes you have taken (upload a transcript or tell ALMA) so they count.${assumed}`;
  } else if (incoming) {
    horizon.startNote = `Students who have not started college yet begin in the fall, so this plan starts in ${label(start)}. If you start in ${label(open)} instead, say so in About you.`;
  } else if (!datedStart && nowUnderWay && sameTerm(start, open)) {
    horizon.startNote = `Adding ${label(now)} classes has closed, so this plan starts in ${label(start)}, the next term you can sign up for. If that is not right for you, change About you.`;
  }
  return horizon;
}

/** Eight falls and springs from a term is `n = 7` steps; summers are skipped. */
function stepRegular(t: { season: SemesterSeason; year: number }, n: number): { season: SemesterSeason; year: number } {
  const k = t.year * 2 + (t.season === 'Spring' ? 0 : 1) + n;
  return { season: k % 2 ? 'Fall' : 'Spring', year: Math.floor(k / 2) };
}

/** The first Illinois term on the student's record (a home record only), or null. */
function firstIllinoisTerm(record: TranscriptRecord | null | undefined): { season: SemesterSeason; year: number } | null {
  if (!record || record.home === false || record.kind === 'transfer_report') return null;
  let best: { season: SemesterSeason; year: number } | null = null;
  for (const c of record.courses ?? []) {
    // Taught at Illinois: not a transfer block, dual credit or exam line, nor a line the student typed.
    if (!c.use || (c.status !== 'completed' && c.status !== 'in_progress')) continue;
    if (lineIsForeign(record, c) || c.matchedBy === 'student') continue;
    const m = (normalizeTerm(c.term) ?? '').match(/^(Fall|Spring|Summer) (\d{4})$/);
    if (!m) continue;
    const t = { season: m[1] as SemesterSeason, year: Number(m[2]) };
    if (!best || termOrd(t.season, t.year) < termOrd(best.season, best.year)) best = t;
  }
  return best;
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
