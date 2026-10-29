'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, Moon, Sun } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { ProgramPicker, type ProgramOption } from './program-picker';
import { PriorCredit } from './prior-credit';
import { EmphasisPicker, emphasisSelectionsComplete } from './emphasis-picker';
import { ugaOverlapArea } from '@/lib/planner/uga-program-overrides';
import {
  isUgaGraduateDegree,
  isUgaUndergraduateDegree,
  applyUgaProgramOverrides,
  ugaSelectionRequirements,
  type UgaProgram,
  type UgaSelectionRequirement,
} from './uga-source';
import { SiteFooter } from './site-notice';
import { loadIllinoisMinorFile, firstFallOf, openProgram } from './illinois-source';
import { illinoisMinorOptions } from '@/lib/planner/illinois-minors';
import { graduateProgramOptions, loadIllinoisGraduatePrograms } from '@/lib/planner/illinois-graduate';
import type { IllinoisProgramSummary } from '@/lib/planner/illinois-load';
import {
  EMPTY_ANSWERS,
  UNDECIDED_PROGRAM_ID,
  applyExamCredit,
  defaultProgramYears,
  inferAcademicYear,
  inferGraduationTarget,
  isGraduationTermPast,
  setupResponse,
  withSetupResponse,
  readySchools,
  schoolById,
  saveAnswers,
  suggestGraduationTarget,
  type AcademicYear,
  type GraduationSeason,
  type OnboardingAnswers,
  type ProgramLevel,
  type SchoolId,
} from '@/lib/planner/onboarding';
import { transcriptCodes, transcriptHours } from '@/lib/planner/transcript';
import { clearPlannerStorage, createSetupResetSequence } from '@/lib/planner/setup-reset';
import { setInsightScreen, track, trackContent, trackTranscript } from '@/lib/insights/client';
import { SCREENS } from '@/lib/insights/schema';
import {
  findUgaCollege,
  normalizeUgaCollegeId,
  UGA_COLLEGES,
} from '@/lib/planner/uga-colleges';
import {
  creditFitNote,
  essentialsFitNote,
  type FitCatalog,
  type FitNote,
} from '@/lib/planner/graduation-fit';
import { useExamCredit } from './exam-credit';
import { DoubleDawgsPicker } from './double-dawgs-picker';
import { GuidedSetup } from './guided-setup';
import { openAccount } from './account-controls';
import { DoubleDawgsTiming, doubleDawgsTimingValid } from './double-dawgs-timing';
import {
  PLANNER_THEME_STORAGE_KEY,
  readStoredTheme,
  type PlannerTheme,
} from '@/lib/planner/theme';

/**
 * Six screens before the planner: pick a school, explicitly choose one or
 * more programs, describe the situation, confirm inferred details, then add
 * prior credit.
 *
 * The middle screen is deliberately one open response rather than a form.
 * Someone who has failed calculus once and is deciding between two majors
 * cannot express that in dropdowns, and that context is exactly what makes
 * the resulting plan worth anything.
 */
/** What the credit step has so far, for the line between Back and Build. */
function priorSummary(a: OnboardingAnswers): string {
  const parts: string[] = [];
  const fromTranscript = transcriptCodes(a.transcript).length;
  if (fromTranscript > 0) {
    parts.push(`${fromTranscript} course${fromTranscript === 1 ? '' : 's'} from your record`);
  }
  const hours = transcriptHours(a.transcript);
  if (hours > 0) parts.push(`${hours} hours as electives`);
  if (a.exams.length > 0) parts.push(`${a.exams.length} exam${a.exams.length === 1 ? '' : 's'} added`);
  if (a.alreadyTakenCourseCodes.length > 0) {
    parts.push(
      `${a.alreadyTakenCourseCodes.length} UGA course${a.alreadyTakenCourseCodes.length === 1 ? '' : 's'} added`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nothing added yet';
}

interface ProgramCatalog {
  undergraduateDegrees: ProgramOption[];
  graduateDegrees: ProgramOption[];
  minors: ProgramOption[];
  undergraduateCertificates: ProgramOption[];
  graduateCertificates: ProgramOption[];
  requirements: UgaSelectionRequirement[];
  ugaPrograms: UgaProgram[];
}

const UNDECIDED_PROGRAM: ProgramOption = {
  id: UNDECIDED_PROGRAM_ID,
  name: 'Undecided / exploring programs',
  totalCredits: null,
  additionalCredits: null,
};

function ugaMajorCredits(program: UgaProgram): number {
  if (
    isUgaGraduateDegree(program) &&
    program.areas.length === 0 &&
    program.totalCredits !== null
  ) {
    return program.totalCredits;
  }
  return program.areas
    .filter(
      (area) =>
        !/^(?:I|II|III|IV|V)\./.test(area.label.trim()) &&
        !/^(?:general|free) electives?\b/i.test(area.label.trim()) &&
        !/general education|core curriculum/i.test(area.label) &&
        !ugaOverlapArea(area.label),
    )
    .reduce((sum, area) => sum + Math.max(0, area.hours), 0);
}

/** The menus the fit check reads: degrees at the student's level, then minors and certificates. */
function fitCatalog(answers: OnboardingAnswers, catalog: ProgramCatalog | null): FitCatalog | null {
  if (!catalog) return null;
  const graduate = answers.programLevel === 'graduate';
  return {
    degrees: graduate ? catalog.graduateDegrees : catalog.undergraduateDegrees,
    additions: [
      ...catalog.minors,
      ...(graduate ? catalog.graduateCertificates : catalog.undergraduateCertificates),
    ],
  };
}

/** A fit note: soft notes read as a heads-up, a warning as an alert. */
function FitNoteBox({ note }: { note: FitNote }) {
  return (
    <div
      className={`onb-feasibility${note.tone === 'soft' ? ' is-soft' : ''}`}
      role={note.tone === 'warn' ? 'alert' : 'status'}
    >
      <AlertTriangle aria-hidden="true" />
      <span>
        <strong>{note.title}</strong>
        {note.message}
      </span>
    </div>
  );
}

const ACADEMIC_YEAR_OPTIONS: Array<{ value: Exclude<AcademicYear, ''>; label: string }> = [
  { value: 'first', label: 'First year' },
  { value: 'second', label: 'Second year' },
  { value: 'third', label: 'Third year' },
  { value: 'fourth', label: 'Fourth year' },
  { value: 'fifth-plus', label: 'Fifth year or later' },
];

const GRADUATION_SEASONS: Exclude<GraduationSeason, ''>[] = ['Spring', 'Summer', 'Fall'];
const SETUP_STEPS = ['University', 'Programs', 'About you', 'Details', 'Credit', 'Plan'];

function normalizedChoice(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bpsychological\b/g, 'psychology')
    .replace(/\bphilosophical\b/g, 'philosophy')
    .replace(/\bcultural\b/g, 'culture')
    .replace(/\bfoundations?\b/g, ' ')
    .replace(/\bareas?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferredProgramSelections(
  requirements: UgaSelectionRequirement[],
  current: Record<string, string[]>,
  text: string,
): Record<string, string[]> {
  const haystack = ` ${normalizedChoice(text)} `;
  const mentionsAi = /\bai\b/i.test(text);
  const next = { ...current };
  for (const requirement of requirements) {
    const existing = next[requirement.id] ?? [];
    if (existing.length >= requirement.minimum) continue;
    const matches = requirement.options.filter((option) => {
      const label = normalizedChoice(option.label.replace(/\([^)]*\)/g, ' '));
      if (!label) return false;
      if (haystack.includes(` ${label} `)) return true;
      if (mentionsAi && label.includes('artificial intelligence')) return true;
      const words = label.split(' ').filter((word) => word.length >= 5);
      return words.length > 0 && words.every((word) => haystack.includes(` ${word} `));
    });
    if (matches.length >= requirement.minimum && matches.length <= requirement.maximum) {
      next[requirement.id] = matches.map((option) => option.id);
    }
  }
  return next;
}

export function Onboarding({
  onDone,
  initial = null,
  onResume,
}: {
  onDone: (a: OnboardingAnswers) => void;
  /** Last time's answers, so a returning student edits rather than retypes. */
  initial?: OnboardingAnswers | null;
  /** Skips the questions and opens the saved plan. Offered only when there is one. */
  onResume?: () => void;
}) {
  /**
   * The school question is only asked when there is a choice to make.
   *
   * With Illinois the only school this build can plan, the first screen used to
   * be five buttons, four of which led to a demo catalog wearing another
   * university's name. Now it starts on "About you" with Illinois chosen, and
   * the school step comes back on its own the day a second school is ready.
   */
  const ready = readySchools();
  const onlySchool = ready.length === 1 ? ready[0] : null;
  const [step, setStep] = useState(onlySchool ? 1 : 0);
  const [guided, setGuided] = useState(true);
  const [resetError, setResetError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ProgramCatalog | null>(null);
  const [theme, setTheme] = useState<PlannerTheme>(readStoredTheme);
  const [graduationEdited, setGraduationEdited] = useState(
    Boolean(initial?.graduationSeason || initial?.graduationYear),
  );
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => {
    const base = initial ? { ...EMPTY_ANSWERS, ...initial } : EMPTY_ANSWERS;
    const programIds = base.programIds?.length ? base.programIds : [UNDECIDED_PROGRAM_ID];
    return onlySchool
      ? { ...base, schoolId: onlySchool.id, programIds }
      : { ...base, programIds };
  });
  const today = useMemo(() => new Date(), []);

  const school = schoolById(answers.schoolId);
  const response = setupResponse(answers);
  useEffect(() => { setInsightScreen(SCREENS[step] ?? 'university', answers.schoolId); }, [step, answers.schoolId]);
  const emphasisRequirements = useMemo(
    () =>
      (catalog?.requirements ?? []).filter((requirement) =>
        answers.programIds.includes(requirement.programId),
      ),
    [catalog, answers.programIds],
  );
  const degreeOptions = useMemo(
    () =>
      answers.programLevel === 'graduate'
        ? catalog?.graduateDegrees ?? [UNDECIDED_PROGRAM]
        : catalog?.undergraduateDegrees ?? [UNDECIDED_PROGRAM],
    [answers.programLevel, catalog],
  );
  const certificateOptions = useMemo(
    () =>
      answers.programLevel === 'graduate'
        ? catalog?.graduateCertificates ?? []
        : catalog?.undergraduateCertificates ?? [],
    [answers.programLevel, catalog],
  );
  const programYears = defaultProgramYears(
    answers.programLevel,
    degreeOptions
      .filter((program) => answers.programIds.includes(program.id) && program.degree)
      .map((program) => program.degree!),
  );
  const emphasesComplete = emphasisSelectionsComplete(
    emphasisRequirements,
    answers.emphasisSelections,
  );
  const undecided = answers.programIds.includes(UNDECIDED_PROGRAM_ID);
  const graduationInPast = isGraduationTermPast(
    answers.graduationSeason,
    answers.graduationYear,
    today,
  );
  const programChoicesReady =
    (answers.schoolId !== 'uga' && !(answers.schoolId === 'illinois' && answers.programLevel === 'graduate')) || catalog !== null;
  const detailsComplete =
    Boolean(answers.academicYear) &&
    Boolean(answers.graduationSeason) &&
    Boolean(answers.graduationYear) &&
    !graduationInPast && doubleDawgsTimingValid(answers) &&
    (answers.schoolId !== 'uga' || undecided || Boolean(answers.collegeId)) &&
    emphasesComplete;
  const missingDetails = [
    !answers.academicYear,
    !answers.graduationSeason || !answers.graduationYear || graduationInPast,
    answers.schoolId === 'uga' && !undecided && !answers.collegeId,
    !emphasesComplete,
  ].filter(Boolean).length;
  // Before any credit is entered: judged on the stated year, never an error.
  const essentialsNote = useMemo(
    () => essentialsFitNote(answers, fitCatalog(answers, catalog), today),
    [answers, catalog, today],
  );
  // After the Credit step: judged on the credit actually added.
  const examTable = useExamCredit(school);
  const examCredits = useMemo(
    () => applyExamCredit(answers.exams, examTable.entries).credits,
    [answers.exams, examTable],
  );
  const creditNote = useMemo(
    () => creditFitNote(answers, fitCatalog(answers, catalog), examCredits, today),
    [answers, catalog, examCredits, today],
  );
  const graduationYears = useMemo(() => {
    const current = today.getFullYear();
    const years = Array.from({ length: 9 }, (_, index) => current + index);
    if (
      answers.graduationYear &&
      answers.graduationYear >= current &&
      !years.includes(answers.graduationYear)
    ) {
      years.push(answers.graduationYear);
      years.sort((left, right) => left - right);
    }
    return years;
  }, [answers.graduationYear, today]);

  useEffect(() => {
    document.documentElement.dataset.plannerTheme = theme;
    window.localStorage.setItem(PLANNER_THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (step !== 0) return;
    const nextKey = createSetupResetSequence();
    const cancel = () => { nextKey(''); };
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof Element && event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
      );
      if (editing || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
        cancel();
        return;
      }
      if (!nextKey(event.key)) return;
      event.preventDefault();
      try {
        clearPlannerStorage(window.localStorage);
        clearPlannerStorage(window.sessionStorage);
        window.location.reload();
      } catch {
        setResetError('Could not clear all saved data. Check this site\'s storage permissions and try again.');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', cancel);
    };
  }, [step]);

  useEffect(() => {
    if (!answers.schoolId) return;
    let cancelled = false;
    const url = answers.schoolId === 'uga' ? '/uga-programs.json' : '/illinois/programs.json';
    void fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((raw: unknown) => {
        if (cancelled) return;
        if (answers.schoolId === 'uga') {
          const rows = applyUgaProgramOverrides(
            (raw as { programs?: UgaProgram[] } | null)?.programs ?? [],
          ).filter(
            (program) =>
              (isUgaGraduateDegree(program) &&
                ((program.areas.length > 0 && program.areaHours > 0) ||
                  (program.totalCredits ?? 0) > 0)) ||
              (!isUgaGraduateDegree(program) &&
                program.areas.length > 0 &&
                program.areaHours > 0),
          );
          const options = (programs: UgaProgram[], kind: 'degree' | 'addition') =>
            programs
              .map((program) => ({
                id: program.id,
                name: program.name,
                degree: program.degree,
                totalCredits: program.totalCredits,
                additionalCredits:
                  kind === 'degree' ? ugaMajorCredits(program) : program.areaHours,
              }))
              .sort((a, b) => a.name.localeCompare(b.name));
          const undergraduateDegrees = rows.filter(isUgaUndergraduateDegree);
          const graduateDegrees = rows.filter(isUgaGraduateDegree);
          setCatalog({
            undergraduateDegrees: [
              UNDECIDED_PROGRAM,
              ...options(undergraduateDegrees, 'degree'),
            ],
            graduateDegrees: [
              UNDECIDED_PROGRAM,
              ...options(graduateDegrees, 'degree'),
            ],
            minors: options(rows.filter((program) => program.degree === 'MINOR' && program.areaHours > 0), 'addition'),
            undergraduateCertificates: options(rows.filter((program) => program.degree === 'CERT-UG' && program.areaHours > 0), 'addition'),
            graduateCertificates: options(rows.filter((program) => program.degree === 'CERT-GM' && program.areaHours > 0), 'addition'),
            requirements: [...undergraduateDegrees, ...graduateDegrees].flatMap(ugaSelectionRequirements),
            ugaPrograms: rows,
          });
          return;
        }
        // The same degrees the planner's own Illinois menu offers: every
        // undergraduate degree it can plan (BALAS, BLS, BME and the rest too),
        // less those closed to new students.
        const majors = (Array.isArray(raw) ? raw : [])
          .filter((program: IllinoisProgramSummary) => openProgram(program))
          .map((program: { id: string; name: string; totalCredits?: number | null }) => ({
            id: program.id,
            name: program.name,
            totalCredits: program.totalCredits ?? null,
            additionalCredits: 30,
          }))
          .sort((a: ProgramOption, b: ProgramOption) => a.name.localeCompare(b.name));
        setCatalog({
          undergraduateDegrees: [UNDECIDED_PROGRAM, ...majors],
          graduateDegrees: [UNDECIDED_PROGRAM],
          minors: [],
          undergraduateCertificates: [],
          graduateCertificates: [],
          requirements: [],
          ugaPrograms: [],
        });
        // Every Illinois minor but the teacher-education ones (beta); those the
        // planner has not checked say so in their name. Certificates stay empty:
        // the catalog lists no undergraduate certificate.
        void loadIllinoisMinorFile().then((file) => {
          if (cancelled || !file) return;
          const minors = illinoisMinorOptions(file).map(({ id, name, totalCredits, additionalCredits }) => ({ id, name, totalCredits, additionalCredits }));
          setCatalog((current) => (current ? { ...current, minors } : current));
        });
        // Graduate and professional programs (beta); those not checked yet say so in their name.
        void loadIllinoisGraduatePrograms().then((rows) => {
          if (cancelled || rows.length === 0) return;
          const grad = graduateProgramOptions(rows);
          setCatalog((current) =>
            current
              ? { ...current, graduateDegrees: [UNDECIDED_PROGRAM, ...grad.graduateDegrees], graduateCertificates: grad.graduateCertificates }
              : current,
          );
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog({
            undergraduateDegrees: [UNDECIDED_PROGRAM],
            graduateDegrees: [UNDECIDED_PROGRAM],
            minors: [],
            undergraduateCertificates: [],
            graduateCertificates: [],
            requirements: [],
            ugaPrograms: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [answers.schoolId]);

  function pick(id: SchoolId) {
    if (answers.schoolId !== id) setCatalog(null);
    setAnswers((a) => ({
      ...a,
      schoolId: id,
      setupConversation: a.schoolId === id ? a.setupConversation : undefined,
      setupConfirmations: a.schoolId === id ? a.setupConfirmations : undefined,
      doubleDawgsPathwayId: a.schoolId === id ? a.doubleDawgsPathwayId : null,
      programLevel: id === 'uga' || id === 'illinois' ? a.programLevel : 'undergraduate',
      programIds: a.schoolId === id ? a.programIds : [UNDECIDED_PROGRAM_ID],
      minorIds: a.schoolId === id ? a.minorIds : [],
      certificateIds: a.schoolId === id ? a.certificateIds : [],
      emphasisSelections: a.schoolId === id ? a.emphasisSelections : {},
      collegeId: a.schoolId === id ? a.collegeId : '',
      alreadyTakenCourseCodes: a.schoolId === id ? a.alreadyTakenCourseCodes : [],
    }));
  }

  function changeProgramLevel(programLevel: ProgramLevel) {
    setAnswers((current) => ({
      ...current,
      programLevel,
      doubleDawgsPathwayId: null,
      programIds: [UNDECIDED_PROGRAM_ID],
      minorIds: [],
      certificateIds: [],
      emphasisSelections: {},
      collegeId: '',
    }));
  }

  function updateMajors(programIds: string[]) {
    setAnswers((current) => {
      let next = programIds;
      if (next.length === 0) next = [UNDECIDED_PROGRAM_ID];
      else if (next.includes(UNDECIDED_PROGRAM_ID) && next.length > 1) {
        next = current.programIds.includes(UNDECIDED_PROGRAM_ID)
          ? next.filter((id) => id !== UNDECIDED_PROGRAM_ID)
          : [UNDECIDED_PROGRAM_ID];
      }
      const selected = new Set(next);
      return {
        ...current,
        programIds: next,
        doubleDawgsPathwayId: null,
        collegeId: '',
        emphasisSelections: Object.fromEntries(
          Object.entries(current.emphasisSelections).filter(([key]) =>
            [...selected].some((id) => key.startsWith(`${id}::`)),
          ),
        ),
      };
    });
  }

  function prepareDetails() {
    trackContent('setup', response);
    const mentionedGraduation = inferGraduationTarget(answers.timeline);
    const useMentionedGraduation = !graduationEdited &&
      Boolean(mentionedGraduation.season || mentionedGraduation.year) &&
      !isGraduationTermPast(mentionedGraduation.season, mentionedGraduation.year, today);
    if (useMentionedGraduation) setGraduationEdited(true);
    setAnswers((current) => {
      const text = [current.studying, current.timeline, current.after].join(' ');
      const academicYear = current.academicYear || inferAcademicYear(current.timeline);
      const suggestedGraduation = suggestGraduationTarget(academicYear, programYears, today, firstFallOf(current.timeline, today));
      const selectedPrograms = (catalog?.ugaPrograms ?? []).filter((program) =>
        current.programIds.includes(program.id),
      );
      const selectedColleges = [
        ...new Set(
          selectedPrograms.map((program) => normalizeUgaCollegeId(program.college)),
        ),
      ];
      const mentionedCollege = findUgaCollege(text);
      const collegeId = current.collegeId ||
        (selectedColleges.length === 1
          ? selectedColleges[0]
          : mentionedCollege && selectedColleges.includes(mentionedCollege.id)
            ? mentionedCollege.id
            : '');
      return {
        ...current,
        collegeId,
        academicYear,
        graduationSeason:
          useMentionedGraduation ? mentionedGraduation.season
            : graduationEdited ? current.graduationSeason : suggestedGraduation.season,
        graduationYear:
          useMentionedGraduation ? mentionedGraduation.year
            : graduationEdited ? current.graduationYear : suggestedGraduation.year,
        emphasisSelections: inferredProgramSelections(
          emphasisRequirements,
          current.emphasisSelections,
          text,
        ),
      };
    });
    setStep(3);
  }

  function finish(next = answers) {
    if (next.transcript) trackTranscript(next.transcript);
    track('setup_submitted', { level: next.programLevel, majors: next.programIds.filter((id) => id !== UNDECIDED_PROGRAM_ID).length, minors: next.minorIds.length, certificates: next.certificateIds.length });
    setStep(5);
    saveAnswers(next);
    window.setTimeout(() => onDone(next), 1400);
  }

  return (
    <div className="onb" data-theme={theme} style={school ? ({ ['--school' as string]: school.accent }) : undefined}>
      <header className="onb-header">
        <div className="onb-brand" aria-label="ORION">
          <Image src="/orion-logo.png" alt="" width={48} height={48} priority />
          <span>ORION</span>
        </div>
        <button className="onb-back onb-account" onClick={openAccount}>Sign in / saved plans</button>
        <button
          type="button"
          className="onb-theme"
          aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}
          onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </button>
      </header>
      <div className="onb-inner">
        <div className="onb-progress" aria-label={`Setup step ${step + 1} of ${SETUP_STEPS.length}: ${SETUP_STEPS[step]}`}>
          <span>{guided && step === 1 ? 'About you' : SETUP_STEPS[step]}</span>
          {!guided && <small>{step + 1} / {SETUP_STEPS.length}</small>}
          <i aria-hidden="true"><b style={{ width: `${((step + 1) / SETUP_STEPS.length) * 100}%` }} /></i>
        </div>

        {!guided && step > 0 && step < 5 && <div className="guided-actions"><button className="setup-mode-link" onClick={() => {
          setAnswers((current) => ({ ...current, setupConfirmations: {
            programConfirmed: Boolean(current.setupConfirmations?.programConfirmed || step > 1 || current.programIds.some((id) => id !== UNDECIDED_PROGRAM_ID)),
            graduationConfirmed: Boolean(current.setupConfirmations?.graduationConfirmed || graduationEdited || step > 3),
            creditReviewed: Boolean(current.setupConfirmations?.creditReviewed || current.transcript || current.exams.length || current.alreadyTakenCourseCodes.length || current.transferText.trim()),
          } }));
          setGuided(true); setStep(1);
        }}>Use the setup assistant</button></div>}
        {onResume && programChoicesReady && detailsComplete && step < 5 && (
          <p className="onb-resume">
            Your answers from last time are filled in below.{' '}
            <button type="button" onClick={onResume}>
              Continue with my saved plan
            </button>{' '}
            or change anything and build it again.
          </p>
        )}

        {step === 0 && (
          <section className="onb-step">
            <h1>Choose your university</h1>
            <p className="onb-sub">Course data, degree rules and recommendations follow this choice.</p>
            {resetError && <p className="onb-feasibility" role="alert">{resetError}</p>}
            <div className="onb-university-picker">
              <label htmlFor="university">University</label>
              <NativeSelect
                className="onb-university-select"
                id="university"
                value={answers.schoolId ?? ''}
                onChange={(event) => pick(event.target.value as SchoolId)}
              >
                <option value="">Select a university</option>
                {ready.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </NativeSelect>
              {school && (
                <p>
                  {school.short} data comes from its published course catalog, degree requirements,
                  prerequisites, and exam-credit policy.
                </p>
              )}
            </div>
            <div className="onb-actions onb-university-actions">
              <span />
              <button className="onb-next" onClick={() => { setGuided(true); setStep(1); }} disabled={!answers.schoolId}>
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 1 && guided && <GuidedSetup key={answers.schoolId} answers={answers} catalog={catalog} onChange={setAnswers}
          onManual={() => { setGraduationEdited(Boolean(answers.graduationYear)); setGuided(false); }} onBack={() => setStep(0)} onFinish={finish} />}

        {step === 1 && !guided && (
          <section className="onb-step">
            <h1>What are you studying?</h1>
            <p className="onb-sub">
              {answers.programLevel === 'graduate'
                ? 'Choose one or more graduate or professional degrees. Graduate certificates are optional.'
                : 'Choose one or more majors. Minors and certificates are optional.'}
            </p>
            {(answers.schoolId === 'uga' || answers.schoolId === 'illinois') && (
              <fieldset className="onb-level-toggle">
                <legend className="sr-only">Program level</legend>
                <button
                  type="button"
                  aria-pressed={answers.programLevel === 'undergraduate'}
                  onClick={() => changeProgramLevel('undergraduate')}
                >
                  Undergraduate
                </button>
                <button
                  type="button"
                  aria-pressed={answers.programLevel === 'graduate'}
                  onClick={() => changeProgramLevel('graduate')}
                >
                  Graduate &amp; professional
                </button>
              </fieldset>
            )}
            <div className="onb-program-groups">
              <section>
                <h2>{answers.programLevel === 'graduate' ? 'Degree programs' : 'Majors'}</h2>
                <ProgramPicker
                  options={degreeOptions}
                  selectedIds={answers.programIds}
                  onChange={updateMajors}
                  loading={catalog === null}
                  kindLabel={answers.programLevel === 'graduate' ? 'degree' : 'major'}
                />
              </section>
              {answers.schoolId === 'illinois' && answers.programLevel === 'undergraduate' && (
                <details className="onb-optional-programs" open={answers.minorIds.length > 0 || undefined}>
                  <summary>Add a minor</summary>
                  <ProgramPicker
                    options={catalog?.minors ?? []}
                    selectedIds={answers.minorIds}
                    onChange={(minorIds) => setAnswers((current) => ({ ...current, minorIds }))}
                    loading={catalog === null}
                    kindLabel="minor"
                    emptyMessage="The Illinois minor list did not load."
                  />
                  <p className="onb-q-hint">
                    Beta. Your degree comes first; a minor goes in the room it leaves. Minors marked
                    &ldquo;not checked yet&rdquo; are shown with their catalog page but not planned.
                  </p>
                </details>
              )}
              {answers.schoolId === 'illinois' && answers.programLevel === 'graduate' && (
                <details className="onb-optional-programs" open={answers.certificateIds.length > 0 || undefined}>
                  <summary>Add a graduate certificate</summary>
                  <ProgramPicker
                    options={certificateOptions}
                    selectedIds={answers.certificateIds}
                    onChange={(certificateIds) => setAnswers((current) => ({ ...current, certificateIds }))}
                    loading={catalog === null}
                    kindLabel="certificate"
                    emptyMessage="The Illinois graduate certificate list did not load."
                  />
                </details>
              )}
              {answers.schoolId === 'uga' && (
                <>
                  {answers.programLevel === 'undergraduate' && (
                    <DoubleDawgsPicker
                      programIds={answers.programIds}
                      selectedId={answers.doubleDawgsPathwayId}
                      sharedCodes={answers.doubleDawgsSharedCodes}
                      completedCodes={[...answers.alreadyTakenCourseCodes, ...transcriptCodes(answers.transcript)]}
                      emphasisSelections={answers.emphasisSelections}
                      onSharedChange={(doubleDawgsSharedCodes) => setAnswers((current) => ({ ...current, doubleDawgsSharedCodes }))}
                      onChange={(doubleDawgsPathwayId) => setAnswers((current) => ({ ...current, doubleDawgsPathwayId, doubleDawgsSharedCodes: undefined }))}
                    />
                  )}
                  {answers.programLevel === 'undergraduate' && (
                    <details className="onb-optional-programs" open={answers.minorIds.length > 0 || undefined}>
                      <summary>Add a minor</summary>
                      <ProgramPicker
                        options={catalog?.minors ?? []}
                        selectedIds={answers.minorIds}
                        onChange={(minorIds) => setAnswers((current) => ({ ...current, minorIds }))}
                        loading={catalog === null}
                        kindLabel="minor"
                        emptyMessage="No parsed UGA minors are available."
                      />
                    </details>
                  )}
                  <details className="onb-optional-programs" open={answers.certificateIds.length > 0 || undefined}>
                    <summary>
                      Add {answers.programLevel === 'graduate' ? 'a graduate certificate' : 'a certificate'}
                    </summary>
                    <ProgramPicker
                      options={certificateOptions}
                      selectedIds={answers.certificateIds}
                      onChange={(certificateIds) => setAnswers((current) => ({ ...current, certificateIds }))}
                      loading={catalog === null}
                      kindLabel="certificate"
                      emptyMessage={`No parsed UGA ${answers.programLevel === 'graduate' ? 'graduate ' : ''}certificates are available.`}
                    />
                  </details>
                </>
              )}
            </div>
            <div className="onb-actions">
              {!onlySchool && <button className="onb-back" onClick={() => setStep(0)}>Back</button>}
              <span className="onb-count">
                {undecided
                  ? 'Undecided - start with an open plan'
                  : `${answers.programIds.length} ${answers.programLevel === 'graduate' ? 'degree program' : 'major'}${answers.programIds.length === 1 ? '' : 's'} selected`}
              </span>
              <button
                className="onb-next"
                onClick={() => response.trim() ? prepareDetails() : setStep(2)}
                disabled={!programChoicesReady}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onb-step">
            <h1 id="onb-response-label">What else should your plan make room for?</h1>
            <p id="onb-response-hint" className="onb-sub">
              Tell us where you are now, what interests you, when you hope to finish, and what you would like to do afterwards.
            </p>
            <div className="onb-questions">
              <div className="onb-q">
                <textarea
                  rows={7}
                  value={response}
                  aria-labelledby="onb-response-label"
                  aria-describedby="onb-response-hint"
                  placeholder={`I'm in my second year${school ? ` at ${school.short}` : ''} with about 45 credits. I'd like to finish in two years, explore psychology and linguistics, and work in data science. I also need time for a part-time job.`}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAnswers((current) => withSetupResponse(current, value));
                  }}
                />
              </div>
            </div>
            <div className="onb-actions">
              {/* No school step to go back to when there was no school to choose. */}
              <button className="onb-back" onClick={() => setStep(1)}>Back</button>
              <button className="onb-next" onClick={prepareDetails} disabled={!response.trim()}>
                Next
              </button>
            </div>
            <p className="onb-skip">
              <button onClick={prepareDetails}>Skip for now</button>
            </p>
          </section>
        )}

        {step === 3 && (
          <section className="onb-step">
            <h1>Check the essentials.</h1>
            <p className="onb-sub">
              Review what ORION inferred and fill anything still blank.
            </p>
            <div className="onb-details-grid">
              <label className="onb-q">
                <span className="onb-q-label">What year of your program are you in?</span>
                <span className="onb-q-hint">This helps us interpret how much time and prior credit the plan should account for.</span>
                <select
                  value={answers.academicYear}
                  onChange={(event) => {
                    const academicYear = event.target.value as AcademicYear;
                    const target = suggestGraduationTarget(academicYear, programYears, today, firstFallOf(answers.timeline, today));
                    setGraduationEdited(false);
                    setAnswers((current) => ({
                      ...current,
                      academicYear,
                      graduationSeason: target.season,
                      graduationYear: target.year,
                    }));
                  }}
                >
                  <option value="">Select your current year</option>
                  {ACADEMIC_YEAR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              {answers.schoolId === 'uga' && !undecided && (
                <label className="onb-q">
                  <span className="onb-q-label">Which college owns your primary program?</span>
                  <span className="onb-q-hint">
                    {answers.programLevel === 'graduate'
                      ? 'Usually inferred from your degree. All 20 UGA schools and colleges are listed.'
                      : 'Usually inferred from your major. UGA has 20 schools and colleges; five do not currently own a standalone bachelor\'s major in this planner.'}
                  </span>
                  <select
                    value={answers.collegeId}
                    onChange={(event) => setAnswers((current) => ({
                      ...current,
                      collegeId: event.target.value,
                    }))}
                  >
                    <option value="">Select your primary college</option>
                    {UGA_COLLEGES.map((college) => (
                      <option
                        key={college.id}
                        value={college.id}
                        disabled={
                          answers.programLevel === 'undergraduate' &&
                          !college.hasBaccalaureateProgram
                        }
                      >
                        {college.name}
                        {answers.programLevel === 'undergraduate' && !college.hasBaccalaureateProgram
                          ? ' — no standalone bachelor’s major'
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <fieldset className="onb-graduation">
                <legend>{answers.doubleDawgsPathwayId ? "When do you intend to finish your bachelor's degree?" : 'When do you intend to graduate?'}</legend>
                <span className="onb-q-hint">
                  {!graduationEdited && answers.academicYear
                    ? `Suggested using a ${programYears}-year program. Adjust for your pace.`
                    : answers.doubleDawgsPathwayId ? "The master's stage starts after this term." : 'The planner will not schedule courses beyond this term.'}
                </span>
                <div>
                  <label>
                    <span>Term</span>
                    <select
                      value={answers.graduationSeason}
                      onChange={(event) => {
                        const season = event.target.value as GraduationSeason;
                        setGraduationEdited(true);
                        setAnswers((current) => ({
                          ...current,
                          graduationSeason: isGraduationTermPast(season, current.graduationYear, today)
                            ? '' : season,
                        }));
                      }}
                    >
                      <option value="">Select term</option>
                      {GRADUATION_SEASONS.map((season) => (
                        <option
                          key={season}
                          value={season}
                          disabled={isGraduationTermPast(season, answers.graduationYear, today)}
                        >
                          {season}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Year</span>
                    <select
                      value={answers.graduationYear ?? ''}
                      onChange={(event) => {
                        const year = event.target.value ? Number(event.target.value) : null;
                        setGraduationEdited(true);
                        setAnswers((current) => ({
                          ...current,
                          graduationYear: year,
                          graduationSeason: isGraduationTermPast(current.graduationSeason, year, today)
                            ? '' : current.graduationSeason,
                        }));
                      }}
                    >
                      <option value="">Select year</option>
                      {graduationYears.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>

              {answers.doubleDawgsPathwayId && <DoubleDawgsTiming answers={answers} onChange={setAnswers} />}

              {graduationInPast && (
                <div className="onb-feasibility" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <span>
                    <strong>That graduation term has already passed</strong>
                    Choose the current term or a future term before continuing.
                  </span>
                </div>
              )}

              {essentialsNote && <FitNoteBox note={essentialsNote} />}

              <EmphasisPicker
                requirements={emphasisRequirements}
                selections={answers.emphasisSelections}
                onChange={(emphasisSelections) =>
                  setAnswers((current) => ({ ...current, emphasisSelections }))
                }
              />
            </div>
            <div className="onb-actions">
              <button className="onb-back" onClick={() => setStep(2)}>Back</button>
              <span className="onb-count">
                {missingDetails === 0
                  ? 'Ready to review prior credit'
                  : `${missingDetails} detail${missingDetails === 1 ? '' : 's'} still needed`}
              </span>
              <button className="onb-next" onClick={() => setStep(4)} disabled={!detailsComplete}>
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="onb-step">
            <h1>What do you already have?</h1>
            <p className="onb-sub">
              Add completed work so ORION does not schedule it again.
            </p>
            <PriorCredit
              school={school}
              exams={answers.exams}
              transferText={answers.transferText}
              languageYears={answers.languageYears ?? null}
              language={answers.language ?? ''}
              onChange={(next) => setAnswers((a) => ({ ...a, ...next }))}
              transcript={answers.transcript ?? null}
              onTranscriptChange={(transcript) => setAnswers((a) => ({ ...a, transcript }))}
              grainger={answers.programIds.some((id) => id.startsWith('engineering/'))}
              graduate={answers.schoolId === 'illinois' && answers.programLevel === 'graduate'}
              alreadyTakenCourseCodes={answers.alreadyTakenCourseCodes}
              onAlreadyTakenChange={(alreadyTakenCourseCodes) =>
                setAnswers((a) => ({ ...a, alreadyTakenCourseCodes }))
              }
            />
            {creditNote && <FitNoteBox note={creditNote} />}
            <div className="onb-actions">
              <button className="onb-back" onClick={() => setStep(3)}>Back</button>
              <span className="onb-count">{priorSummary(answers)}</span>
              <button className="onb-next" onClick={() => finish()}>
                {initial ? 'Build my plan again' : 'Build my plan'}
              </button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="onb-step onb-building">
            <div className="onb-spinner" aria-hidden="true" />
            <h1>Drawing your plan</h1>
            <p className="onb-sub">
              Reading {school?.short ?? 'your university'}&rsquo;s catalog, requirements and prerequisites.
            </p>
          </section>
        )}
        <SiteFooter schoolName={school?.name ?? null} bot={school?.bot ?? 'the assistant'} />
      </div>
    </div>
  );
}
