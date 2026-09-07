import type {
  Course,
  PlanIssue,
  PlanState,
  ProgramDefinition,
  RequirementProgress,
} from './types';

export function indexCourses(courses: Course[]) {
  return new Map(courses.map((course) => [course.id, course]));
}

export function getTermCredits(
  courseIds: string[],
  courseIndex: Map<string, Course>,
) {
  return courseIds.reduce(
    (total, courseId) => total + (courseIndex.get(courseId)?.credits ?? 0),
    0,
  );
}

export function getPlannedCourseIds(plan: PlanState) {
  return new Set([
    ...plan.completedCourseIds,
    ...plan.terms.flatMap((term) => term.courseIds),
  ]);
}

export function getPlanCredits(plan: PlanState, courses: Course[]) {
  const courseIndex = indexCourses(courses);
  const completed = getTermCredits(plan.completedCourseIds, courseIndex);
  const planned = plan.terms.reduce(
    (total, term) => total + getTermCredits(term.courseIds, courseIndex),
    0,
  );

  return { completed, planned, total: completed + planned };
}

export function getRequirementProgress(
  plan: PlanState,
  program: ProgramDefinition,
  courses: Course[],
): RequirementProgress[] {
  const courseIndex = indexCourses(courses);
  const allCourseIds = [
    ...plan.completedCourseIds,
    ...plan.terms.flatMap((term) => term.courseIds),
  ];

  return program.requirements.map((requirement) => {
    const credits = allCourseIds.reduce((total, courseId) => {
      const course = courseIndex.get(courseId);
      return course?.requirementIds.includes(requirement.id)
        ? total + course.credits
        : total;
    }, 0);

    return {
      requirement,
      credits,
      percent: Math.min(
        100,
        Math.round((credits / requirement.targetCredits) * 100),
      ),
    };
  });
}

export function getPlanIssues(
  plan: PlanState,
  courses: Course[],
  options?: { minimumTermCredits?: number },
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const courseIndex = indexCourses(courses);
  const previouslyTaken = new Set(plan.completedCourseIds);

  for (const term of plan.terms) {
    const termCredits = getTermCredits(term.courseIds, courseIndex);

    if (termCredits > 16) {
      issues.push({
        id: `load-${term.id}`,
        severity: 'warning',
        title: 'Heavy course load',
        message: `${term.label} has ${termCredits} credits. Consider balancing this term.`,
        termId: term.id,
      });
    }

    if (
      options?.minimumTermCredits &&
      termCredits < options.minimumTermCredits
    ) {
      issues.push({
        id: `minimum-load-${term.id}`,
        severity: 'warning',
        title: 'Below scholarship credit target',
        message: `${term.label} has ${termCredits} credits; the sample scholarship setting calls for at least ${options.minimumTermCredits}.`,
        termId: term.id,
      });
    }

    for (const courseId of term.courseIds) {
      const course = courseIndex.get(courseId);
      if (!course) {
        issues.push({
          id: `missing-${term.id}-${courseId}`,
          severity: 'error',
          title: 'Course data missing',
          message: `${courseId} is in the plan but not in the current catalog snapshot.`,
          termId: term.id,
          courseId,
        });
        continue;
      }

      const missingPrerequisites = course.prerequisites.filter(
        (prerequisiteId) => !previouslyTaken.has(prerequisiteId),
      );
      if (missingPrerequisites.length > 0) {
        const labels = missingPrerequisites.map(
          (id) => courseIndex.get(id)?.code ?? id,
        );
        issues.push({
          id: `prerequisite-${term.id}-${course.id}`,
          severity: 'error',
          title: 'Prerequisite conflict',
          message: `${course.code} needs ${labels.join(', ')} in an earlier term.`,
          termId: term.id,
          courseId: course.id,
        });
      }

      if (!course.offeredIn.includes(term.season)) {
        issues.push({
          id: `offering-${term.id}-${course.id}`,
          severity: 'warning',
          title: 'Typical offering mismatch',
          message: `${course.code} is not usually listed for ${term.season} in this sample.`,
          termId: term.id,
          courseId: course.id,
        });
      }

      if (
        course.section?.termId === term.id &&
        course.section.status === 'waitlist'
      ) {
        issues.push({
          id: `capacity-${term.id}-${course.id}`,
          severity: 'warning',
          title: 'Section currently waitlisted',
          message: `${course.code} has no open seats in the sample section snapshot.`,
          termId: term.id,
          courseId: course.id,
        });
      }

      if (course.section?.termId === term.id && course.section.travelNote) {
        issues.push({
          id: `travel-${term.id}-${course.id}`,
          severity: 'info',
          title: 'Tight campus transition',
          message: course.section.travelNote,
          termId: term.id,
          courseId: course.id,
        });
      }
    }

    term.courseIds.forEach((courseId) => previouslyTaken.add(courseId));
  }

  return issues;
}

export function isPlanState(value: unknown): value is PlanState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlanState>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.programId === 'string' &&
    typeof candidate.graduationLabel === 'string' &&
    Array.isArray(candidate.completedCourseIds) &&
    Array.isArray(candidate.terms)
  );
}
