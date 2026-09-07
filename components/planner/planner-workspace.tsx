'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Check, RotateCcw, Save, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CourseExplorer } from './course-explorer';
import { PlanHealth } from './plan-health';
import { SemesterColumn } from './semester-column';
import { StudentProfilePanel } from './student-profile-panel';
import {
  certificateOptions,
  createSamplePlan,
  createSampleProfile,
  graduationOptions,
  minorOptions,
  relabelPlanForGraduation,
  sampleCourses,
  samplePrograms,
  secondaryMajorOptions,
} from '@/lib/planner/sample-data';
import {
  getPlanCredits,
  getPlanIssues,
  getPlannedCourseIds,
  getRequirementProgress,
  indexCourses,
  isPlanState,
} from '@/lib/planner/rules';
import type { PlanIssue, PlanState, StudentProfile } from '@/lib/planner/types';

const STORAGE_KEY = 'four-year-planner-demo-v2';
const years = [1, 2, 3, 4] as const;

interface StoredWorkspace {
  schemaVersion: 2;
  plan: PlanState;
  profile: StudentProfile;
}

export function PlannerWorkspace() {
  const [plan, setPlan] = useState<PlanState>(() => createSamplePlan());
  const [profile, setProfile] = useState<StudentProfile>(() =>
    createSampleProfile(),
  );
  const [undoStack, setUndoStack] = useState<PlanState[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [targetTermId, setTargetTermId] = useState('2026-fall');
  const [searchQuery, setSearchQuery] = useState('');
  const [mapExpanded, setMapExpanded] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Sample plan ready');

  const courseIndex = useMemo(() => indexCourses(sampleCourses), []);
  const activeProgram =
    samplePrograms.find((program) => program.id === profile.primaryMajorId) ??
    samplePrograms[0];
  const planCredits = useMemo(
    () => getPlanCredits(plan, sampleCourses),
    [plan],
  );
  const requirementProgress = useMemo(
    () => getRequirementProgress(plan, activeProgram, sampleCourses),
    [activeProgram, plan],
  );
  const issues = useMemo(
    () =>
      getPlanIssues(plan, sampleCourses, {
        minimumTermCredits:
          profile.scholarshipPlan === 'none'
            ? undefined
            : profile.minimumTermCredits,
      }),
    [plan, profile.minimumTermCredits, profile.scholarshipPlan],
  );
  const plannedCourseIds = useMemo(() => getPlannedCourseIds(plan), [plan]);

  useEffect(() => {
    let restored: StoredWorkspace | null = null;
    let restoreFailed = false;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (isStoredWorkspace(parsed)) {
        restored = parsed;
      }
    } catch {
      restoreFailed = true;
    }

    const timeout = window.setTimeout(() => {
      if (restored) {
        setPlan(restored.plan);
        setProfile(restored.profile);
        setStatusMessage('Saved workspace restored from this device');
      } else if (restoreFailed) {
        setStatusMessage('Could not restore the saved sample workspace');
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function commitPlan(nextPlan: PlanState) {
    setUndoStack((current) => [...current.slice(-19), plan]);
    setPlan(nextPlan);
  }

  function updateProfile<Key extends keyof StudentProfile>(
    field: Key,
    value: StudentProfile[Key],
  ) {
    setProfile((current) => ({ ...current, [field]: value }));
    if (field === 'graduationLabel' && typeof value === 'string') {
      commitPlan(relabelPlanForGraduation(plan, value));
      setStatusMessage(`Plan dates updated for ${value}`);
    } else {
      setStatusMessage('Student preferences updated');
    }
  }

  function changePrimaryMajor(programId: string) {
    const program = samplePrograms.find(
      (candidate) => candidate.id === programId,
    );
    if (!program) return;
    setProfile((current) => ({ ...current, primaryMajorId: programId }));
    commitPlan({ ...plan, programId });
    setStatusMessage(`${program.name} requirement view selected`);
  }

  function addCourse(courseId: string, termId: string) {
    const course = courseIndex.get(courseId);
    if (!course) return;
    if (plannedCourseIds.has(courseId)) {
      setStatusMessage(`${course.code} is already included`);
      return;
    }

    const nextPlan =
      termId === 'completed'
        ? {
            ...plan,
            completedCourseIds: [...plan.completedCourseIds, courseId],
          }
        : {
            ...plan,
            terms: plan.terms.map((term) =>
              term.id === termId
                ? { ...term, courseIds: [...term.courseIds, courseId] }
                : term,
            ),
          };
    commitPlan(nextPlan);
    setSelectedCourseId(courseId);
    setSelectedTermId(termId === 'completed' ? null : termId);
    setTargetTermId(termId);
    setStatusMessage(
      termId === 'completed'
        ? `${course.code} marked as prior coursework`
        : `${course.code} added to ${findTerm(plan, termId)?.label ?? 'the plan'}`,
    );
  }

  function removeCourse(courseId: string, termId: string) {
    const course = courseIndex.get(courseId);
    commitPlan({
      ...plan,
      terms: plan.terms.map((term) =>
        term.id === termId
          ? {
              ...term,
              courseIds: term.courseIds.filter((id) => id !== courseId),
            }
          : term,
      ),
    });
    if (selectedCourseId === courseId) {
      setSelectedCourseId(null);
      setSelectedTermId(null);
    }
    setStatusMessage(`${course?.code ?? 'Course'} removed from the plan`);
  }

  function moveCourse(courseId: string, fromTermId: string, toTermId: string) {
    const destination = findTerm(plan, toTermId);
    if (!destination || fromTermId === toTermId) return;
    const course = courseIndex.get(courseId);
    commitPlan({
      ...plan,
      terms: plan.terms.map((term) => {
        if (term.id === fromTermId) {
          return {
            ...term,
            courseIds: term.courseIds.filter((id) => id !== courseId),
          };
        }
        if (term.id === toTermId) {
          return { ...term, courseIds: [...term.courseIds, courseId] };
        }
        return term;
      }),
    });
    setTargetTermId(toTermId);
    setSelectedCourseId(courseId);
    setSelectedTermId(toTermId);
    setStatusMessage(
      `${course?.code ?? 'Course'} moved to ${destination.label}`,
    );
  }

  function swapCourse(
    fromCourseId: string,
    toCourseId: string,
    termId: string,
  ) {
    const replacement = courseIndex.get(toCourseId);
    commitPlan({
      ...plan,
      terms: plan.terms.map((term) =>
        term.id === termId
          ? {
              ...term,
              courseIds: term.courseIds.map((courseId) =>
                courseId === fromCourseId ? toCourseId : courseId,
              ),
            }
          : term,
      ),
    });
    setSelectedCourseId(toCourseId);
    setSelectedTermId(termId);
    setStatusMessage(
      `Swapped in ${replacement?.code ?? 'the selected course'}`,
    );
  }

  function selectPlannedCourse(courseId: string, termId: string) {
    setSelectedCourseId(courseId);
    setSelectedTermId(termId);
    setTargetTermId(termId);
    setMapExpanded(true);
    revealCourseFinder();
  }

  function findAlternatives(courseId: string, termId: string) {
    setSelectedCourseId(courseId);
    setSelectedTermId(termId);
    setTargetTermId(termId);
    setSearchQuery('');
    setMapExpanded(true);
    setStatusMessage('Showing alternatives that satisfy the same sample area');
    revealCourseFinder();
  }

  function openCourseFinder(termId: string) {
    setTargetTermId(termId);
    setSelectedCourseId(null);
    setSelectedTermId(null);
    setSearchQuery('');
    setMapExpanded(true);
    setStatusMessage(
      `Course finder opened for ${findTerm(plan, termId)?.label}`,
    );
    revealCourseFinder();
  }

  function addCompletedCourse() {
    setTargetTermId('completed');
    setSelectedCourseId(null);
    setSelectedTermId(null);
    setSearchQuery('');
    setMapExpanded(true);
    setStatusMessage('Choose prior coursework from the course map');
    revealCourseFinder();
  }

  function selectIssue(issue: PlanIssue) {
    if (issue.courseId) {
      setSelectedCourseId(issue.courseId);
      setSelectedTermId(issue.termId);
    }
    document
      .getElementById(
        issue.courseId
          ? `planned-${issue.termId}-${issue.courseId}`
          : `term-${issue.termId}`,
      )
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
  }

  function undoPlanChange() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setPlan(previous);
    setUndoStack((current) => current.slice(0, -1));
    setSelectedCourseId(null);
    setSelectedTermId(null);
    setStatusMessage('Last plan change undone');
  }

  function saveWorkspace() {
    const workspace: StoredWorkspace = {
      schemaVersion: 2,
      plan,
      profile,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    setStatusMessage('Workspace saved on this device');
  }

  function resetWorkspace() {
    const nextPlan = createSamplePlan();
    const nextProfile = createSampleProfile();
    setPlan(nextPlan);
    setProfile(nextProfile);
    setUndoStack([]);
    setSelectedCourseId(null);
    setSelectedTermId(null);
    setTargetTermId(nextPlan.terms[0].id);
    setSearchQuery('');
    setMapExpanded(true);
    setStatusMessage('Sample workspace regenerated');
  }

  return (
    <main className="planner-app">
      <output aria-live="polite" className="sr-only">
        {statusMessage}
      </output>

      <header className="app-header">
        <a className="brand" href="#top" aria-label="Four Year Planner home">
          <Image
            src="/constellation-logo.png"
            alt=""
            width={36}
            height={36}
            priority
          />
          <span>
            <strong>UGA Four Year Planner</strong>
            <small>from the Semantic Course Map</small>
          </span>
        </a>
        <div className="header-status" aria-hidden="true">
          <span className="status-light" />
          {statusMessage}
        </div>
        <div className="header-actions">
          <Button
            variant="outline"
            size="icon"
            title="Undo last plan change"
            aria-label="Undo last plan change"
            disabled={undoStack.length === 0}
            onClick={undoPlanChange}
          >
            <Undo2 />
          </Button>
          <Button variant="outline" onClick={saveWorkspace}>
            <Save /> <span>Save</span>
          </Button>
        </div>
      </header>

      <div id="top" className="planner-layout">
        <StudentProfilePanel
          profile={profile}
          programs={samplePrograms}
          secondaryMajors={secondaryMajorOptions}
          minors={minorOptions}
          certificates={certificateOptions}
          graduationOptions={graduationOptions}
          activeProgram={activeProgram}
          requirementProgress={requirementProgress}
          plannedCredits={planCredits.total}
          completedCount={plan.completedCourseIds.length}
          onProfileChange={updateProfile}
          onPrimaryMajorChange={changePrimaryMajor}
          onAddCompletedCourse={addCompletedCourse}
        />

        <section className="plan-surface" aria-labelledby="plan-title">
          <header className="plan-heading">
            <div>
              <p className="eyebrow">
                My degree path / {profile.graduationLabel}
              </p>
              <h1 id="plan-title">Plan every semester in one place</h1>
              <p>
                Drag courses between terms, open the map to find alternatives,
                and review conflicts as the path changes.
              </p>
            </div>
            <div className="plan-heading-actions">
              <Button
                variant="outline"
                size="icon"
                title="Reset sample workspace"
                aria-label="Reset sample workspace"
                onClick={resetWorkspace}
              >
                <RotateCcw />
              </Button>
              <Button onClick={resetWorkspace}>
                <Sparkles /> Generate sample plan
              </Button>
            </div>
          </header>

          <div className="plan-metrics" aria-label="Plan summary">
            <div>
              <span>Degree</span>
              <strong>
                {activeProgram.name}, {activeProgram.degree}
              </strong>
            </div>
            <div>
              <span>Credits mapped</span>
              <strong>
                {planCredits.total} / {activeProgram.totalCredits}
              </strong>
            </div>
            <div>
              <span>Graduation</span>
              <strong>{profile.graduationLabel}</strong>
            </div>
            <div>
              <span>Prior courses</span>
              <strong>{plan.completedCourseIds.length}</strong>
            </div>
          </div>

          <PlanHealth issues={issues} onSelectIssue={selectIssue} />

          <div className="plan-board" aria-label="Four year course plan">
            {years.map((year) => {
              const terms = plan.terms.filter((term) => term.year === year);
              return (
                <section
                  className="plan-year"
                  key={year}
                  aria-label={`Year ${year}`}
                >
                  <header className="year-heading">
                    <span>0{year}</span>
                    <div>
                      <p>Year {year}</p>
                      <strong>
                        {terms
                          .map((term) => term.label.split(' ')[1])
                          .join(' / ')}
                      </strong>
                    </div>
                  </header>
                  <div className="year-terms">
                    {terms.map((term) => (
                      <div id={`term-${term.id}`} key={term.id}>
                        <SemesterColumn
                          term={term}
                          allTerms={plan.terms}
                          courseIndex={courseIndex}
                          issues={issues}
                          selectedCourseId={selectedCourseId}
                          minimumCredits={
                            profile.scholarshipPlan === 'none'
                              ? 0
                              : profile.minimumTermCredits
                          }
                          onSelectCourse={selectPlannedCourse}
                          onMoveCourse={moveCourse}
                          onRemoveCourse={removeCourse}
                          onAddCourse={openCourseFinder}
                          onDropCourse={addCourse}
                          onFindAlternatives={findAlternatives}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="plan-footnote">
            <span>
              <Check /> Drag-and-drop and menu actions update every check.
            </span>
            <span>
              All changes stay on this device until a backend is connected.
            </span>
          </div>

          <CourseExplorer
            courses={sampleCourses}
            terms={plan.terms}
            plannedCourseIds={plannedCourseIds}
            selectedCourseId={selectedCourseId}
            selectedTermId={selectedTermId}
            targetTermId={targetTermId}
            searchQuery={searchQuery}
            expanded={mapExpanded}
            onExpandedChange={setMapExpanded}
            onSearchChange={setSearchQuery}
            onTargetTermChange={setTargetTermId}
            onSelectCourse={(courseId) => {
              setSelectedCourseId(courseId);
              setSelectedTermId(findTermForCourse(plan, courseId)?.id ?? null);
            }}
            onAddCourse={addCourse}
            onSwapCourse={swapCourse}
          />

          <footer className="data-disclosure">
            <strong>What is placeholder data in this MVP?</strong>
            Computer Science and Psychology requirements; every second-major,
            minor, and certificate rule; scholarship thresholds; course
            capacity, meeting, location, and travel signals; and the generated
            plan itself. Cognitive Science content is reviewed demo material,
            but the official UGA Bulletin and advisor remain the source of
            truth.
          </footer>
        </section>
      </div>
    </main>
  );
}

function findTerm(plan: PlanState, termId: string) {
  return plan.terms.find((term) => term.id === termId);
}

function findTermForCourse(plan: PlanState, courseId: string) {
  return plan.terms.find((term) => term.courseIds.includes(courseId));
}

function revealCourseFinder() {
  window.setTimeout(() => {
    document
      .getElementById('course-finder')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

function isStoredWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredWorkspace>;
  const profile = candidate.profile as Partial<StudentProfile> | undefined;
  return (
    candidate.schemaVersion === 2 &&
    isPlanState(candidate.plan) &&
    !!profile &&
    typeof profile.primaryMajorId === 'string' &&
    typeof profile.graduationLabel === 'string' &&
    typeof profile.careerInterests === 'string'
  );
}
