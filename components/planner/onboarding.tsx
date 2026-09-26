'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, Moon, Sun } from 'lucide-react';
import { ProgramPicker, type ProgramOption } from './program-picker';
import { PriorCredit } from './prior-credit';
import { EmphasisPicker, emphasisSelectionsComplete } from './emphasis-picker';
import {
  isUgaGraduateDegree,
  isUgaUndergraduateDegree,
  applyUgaProgramOverrides,
  ugaSelectionRequirements,
  type UgaProgram,
  type UgaSelectionRequirement,
} from './uga-source';
import {
  EMPTY_ANSWERS,
  UNDECIDED_PROGRAM_ID,
  availablePlanningTerms,
  inferAcademicYear,
  inferGraduationTarget,
  isGraduationTermPast,
  questionsFor,
  readySchools,
  schoolById,
  saveAnswers,
  type AcademicYear,
  type GraduationSeason,
  type OnboardingAnswers,
  type ProgramLevel,
  type SchoolId,
} from '@/lib/planner/onboarding';
import { transcriptCodes } from '@/lib/planner/transcript';
import {
  findUgaCollege,
  normalizeUgaCollegeId,
  UGA_COLLEGES,
} from '@/lib/planner/uga-colleges';
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
 * The middle screen is deliberately three open text boxes rather than a form.
 * Someone who has failed calculus once and is deciding between two majors
 * cannot express that in dropdowns, and that context is exactly what makes
 * the resulting plan worth anything.
 */
/** What the credit step has so far, for the line between Back and Build. */
function priorSummary(a: OnboardingAnswers): string {
  const parts: string[] = [];
  const fromTranscript = transcriptCodes(a.transcript).length;
  if (fromTranscript > 0) {
    parts.push(`${fromTranscript} course${fromTranscript === 1 ? '' : 's'} from your transcript`);
  }
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
        !/general education|core curriculum/i.test(area.label),
    )
    .reduce((sum, area) => sum + Math.max(0, area.hours), 0);
}

function feasibilityWarning(
  answers: OnboardingAnswers,
  catalog: ProgramCatalog | null,
  now: Date,
): { title: string; message: string } | null {
  if (
    !catalog ||
    answers.programIds.includes(UNDECIDED_PROGRAM_ID) ||
    !answers.graduationSeason ||
    !answers.graduationYear ||
    isGraduationTermPast(answers.graduationSeason, answers.graduationYear, now)
  ) {
    return null;
  }

  const terms = availablePlanningTerms(
    answers.graduationSeason,
    answers.graduationYear,
    now,
  );
  const capacity = terms * 18;
  if (terms === 0) return null;

  const degreeOptions = answers.programLevel === 'graduate'
    ? catalog.graduateDegrees
    : catalog.undergraduateDegrees;
  const certificateOptions = answers.programLevel === 'graduate'
    ? catalog.graduateCertificates
    : catalog.undergraduateCertificates;
  const degrees = answers.programIds
    .map((id) => degreeOptions.find((program) => program.id === id))
    .filter((program): program is ProgramOption => Boolean(program));
  const additions = [...answers.minorIds, ...answers.certificateIds]
    .map((id) => [...catalog.minors, ...certificateOptions].find((program) => program.id === id))
    .filter((program): program is ProgramOption => Boolean(program));
  const primaryCredits = answers.programLevel === 'graduate'
    ? Math.max(
        0,
        ...degrees.map(
          (program) => program.totalCredits ?? program.additionalCredits ?? 0,
        ),
      )
    : Math.max(120, ...degrees.map((program) => program.totalCredits ?? 0));
  const additionalDegreeCredits = degrees
    .slice(1)
    .reduce((sum, program) => sum + (program.additionalCredits ?? 30), 0);
  const additionalProgramCredits = additions.reduce(
    (sum, program) => sum + (program.additionalCredits ?? 12),
    0,
  );
  const estimatedCredits = primaryCredits + additionalDegreeCredits + additionalProgramCredits;

  if (primaryCredits > capacity) {
    return {
      title: 'The graduation date does not leave enough terms',
      message: `${terms} ${terms === 1 ? 'term is' : 'terms are'} available through ${answers.graduationSeason} ${answers.graduationYear}. Even at 18 credits per term, that is ${capacity} credits of room for a degree requiring at least ${primaryCredits}, before completed or transfer credit is counted. Choose a later date or add your prior credit on the next screen.`,
    };
  }

  if (estimatedCredits > capacity) {
    return {
      title: 'This program combination is unlikely to fit',
      message: `${degrees.length} degree ${degrees.length === 1 ? 'program' : 'programs'} and ${additions.length} additional ${additions.length === 1 ? 'program' : 'programs'} represent roughly ${estimatedCredits} credits before shared courses and prior credit are counted. The ${terms} available terms hold at most ${capacity} credits at 18 per term. The planner can still build a draft, but expect unmet requirements unless substantial coursework overlaps or is already complete.`,
    };
  }

  return null;
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
  const [catalog, setCatalog] = useState<ProgramCatalog | null>(null);
  const [theme, setTheme] = useState<PlannerTheme>(readStoredTheme);
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => {
    const base = initial ? { ...EMPTY_ANSWERS, ...initial } : EMPTY_ANSWERS;
    const programIds = base.programIds?.length ? base.programIds : [UNDECIDED_PROGRAM_ID];
    return onlySchool
      ? { ...base, schoolId: onlySchool.id, programIds }
      : { ...base, programIds };
  });
  const today = useMemo(() => new Date(), []);

  const school = schoolById(answers.schoolId);
  const questions = questionsFor(school);
  const answered = questions.filter((q) => answers[q.key].trim().length > 0).length;
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
  const programChoicesReady = answers.schoolId !== 'uga' || catalog !== null;
  const detailsComplete =
    Boolean(answers.academicYear) &&
    Boolean(answers.graduationSeason) &&
    Boolean(answers.graduationYear) &&
    !graduationInPast &&
    (answers.schoolId !== 'uga' || undecided || Boolean(answers.collegeId)) &&
    emphasesComplete;
  const missingDetails = [
    !answers.academicYear,
    !answers.graduationSeason || !answers.graduationYear || graduationInPast,
    answers.schoolId === 'uga' && !undecided && !answers.collegeId,
    !emphasesComplete,
  ].filter(Boolean).length;
  const setupWarning = useMemo(
    () => feasibilityWarning(answers, catalog, today),
    [answers, catalog, today],
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
        const majors = (Array.isArray(raw) ? raw : [])
          .filter((program: { degree?: string; dataStatus?: string; courseCount?: number }) =>
            /^(AB|BA|BS|BFA|BLA|BMUS|BSLAS|BSW)$/i.test(program.degree ?? '') &&
            program.dataStatus === 'catalog' &&
            (program.courseCount ?? 0) > 0,
          )
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
      programLevel: id === 'uga' ? a.programLevel : 'undergraduate',
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
    setAnswers((current) => {
      const text = [current.studying, current.timeline, current.after].join(' ');
      const graduation = inferGraduationTarget(current.timeline);
      const inferredGraduationIsPast = isGraduationTermPast(
        graduation.season,
        graduation.year,
        today,
      );
      const shouldInferGraduation =
        !current.graduationSeason && !current.graduationYear && !inferredGraduationIsPast;
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
        academicYear: current.academicYear || inferAcademicYear(current.timeline),
        graduationSeason:
          current.graduationSeason || (shouldInferGraduation ? graduation.season : ''),
        graduationYear:
          current.graduationYear ?? (shouldInferGraduation ? graduation.year : null),
        emphasisSelections: inferredProgramSelections(
          emphasisRequirements,
          current.emphasisSelections,
          text,
        ),
      };
    });
    setStep(3);
  }

  function finish() {
    setStep(5);
    saveAnswers(answers);
    window.setTimeout(() => onDone(answers), 1400);
  }

  return (
    <div className="onb" data-theme={theme} style={school ? ({ ['--school' as string]: school.accent }) : undefined}>
      <header className="onb-header">
        <div className="onb-brand" aria-label="ORION">
          <Image src="/orion-logo.png" alt="" width={48} height={48} priority />
          <span>ORION</span>
        </div>
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
          <span>{SETUP_STEPS[step]}</span>
          <small>{step + 1} / {SETUP_STEPS.length}</small>
          <i aria-hidden="true"><b style={{ width: `${((step + 1) / SETUP_STEPS.length) * 100}%` }} /></i>
        </div>

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
            <div className="onb-university-picker">
              <label htmlFor="university">University</label>
              <select
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
              </select>
              {school && (
                <p>
                  {school.short} data comes from its published course catalog, degree requirements,
                  prerequisites, and exam-credit policy.
                </p>
              )}
            </div>
            <div className="onb-actions onb-university-actions">
              <span />
              <button className="onb-next" onClick={() => setStep(1)} disabled={!answers.schoolId}>
                Choose programs
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="onb-step">
            <h1>What are you studying?</h1>
            <p className="onb-sub">
              {answers.programLevel === 'graduate'
                ? 'Choose one or more graduate or professional degrees. Graduate certificates are optional.'
                : 'Choose one or more majors. Minors and certificates are optional.'}
            </p>
            {answers.schoolId === 'uga' && (
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
              {answers.schoolId === 'uga' && (
                <>
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
                onClick={() => setStep(2)}
                disabled={!programChoicesReady}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onb-step">
            <h1>Tell us where you are{school ? ` at ${school.short}` : ''}.</h1>
            <p className="onb-sub">
              A few sentences help ORION shape the plan. You can revise them later.
            </p>
            <div className="onb-questions">
              {questions.map((q) => (
                <label key={q.key} className="onb-q">
                  <span className="onb-q-label">{q.label}</span>
                  <span className="onb-q-hint">{q.hint}</span>
                  <textarea
                    rows={3}
                    value={answers[q.key]}
                    placeholder={q.placeholder}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="onb-actions">
              {/* No school step to go back to when there was no school to choose. */}
              <button className="onb-back" onClick={() => setStep(1)}>Back</button>
              <span className="onb-count">{answered} of 3 answered</span>
              <button className="onb-next" onClick={prepareDetails} disabled={answered === 0}>
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
                  onChange={(event) => setAnswers((current) => ({
                    ...current,
                    academicYear: event.target.value as AcademicYear,
                  }))}
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
                <legend>When do you intend to graduate?</legend>
                <span className="onb-q-hint">The planner will not schedule courses beyond this term.</span>
                <div>
                  <label>
                    <span>Term</span>
                    <select
                      value={answers.graduationSeason}
                      onChange={(event) => setAnswers((current) => ({
                        ...current,
                        graduationSeason:
                          isGraduationTermPast(
                            event.target.value as GraduationSeason,
                            current.graduationYear,
                            today,
                          )
                            ? ''
                            : event.target.value as GraduationSeason,
                      }))}
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
                      onChange={(event) => setAnswers((current) => ({
                        ...current,
                        graduationYear: event.target.value ? Number(event.target.value) : null,
                        graduationSeason:
                          event.target.value && isGraduationTermPast(
                            current.graduationSeason,
                            Number(event.target.value),
                            today,
                          )
                            ? ''
                            : current.graduationSeason,
                      }))}
                    >
                      <option value="">Select year</option>
                      {graduationYears.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>

              {graduationInPast && (
                <div className="onb-feasibility" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <span>
                    <strong>That graduation term has already passed</strong>
                    Choose the current term or a future term before continuing.
                  </span>
                </div>
              )}

              {setupWarning && (
                <div className="onb-feasibility" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <span>
                    <strong>{setupWarning.title}</strong>
                    {setupWarning.message}
                  </span>
                </div>
              )}

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
              onChange={(next) => setAnswers((a) => ({ ...a, ...next }))}
              transcript={answers.transcript ?? null}
              onTranscriptChange={(transcript) => setAnswers((a) => ({ ...a, transcript }))}
              alreadyTakenCourseCodes={answers.alreadyTakenCourseCodes}
              onAlreadyTakenChange={(alreadyTakenCourseCodes) =>
                setAnswers((a) => ({ ...a, alreadyTakenCourseCodes }))
              }
            />
            <div className="onb-actions">
              <button className="onb-back" onClick={() => setStep(3)}>Back</button>
              <span className="onb-count">{priorSummary(answers)}</span>
              <button className="onb-next" onClick={finish}>
                {initial ? 'Build my plan again' : 'Build my plan'}
              </button>
            </div>
            <p className="onb-skip">
              <button onClick={finish}>I am starting from zero</button>
            </p>
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
      </div>
    </div>
  );
}
