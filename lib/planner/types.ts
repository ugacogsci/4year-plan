/**
 * Summer is here because leaving it out was a product gap, not a simplification.
 * It is the normal way a transfer student catches up and the normal way a failed
 * sequence gets back on track, which are two of the cases this planner exists for.
 */
export type SemesterSeason = 'Fall' | 'Spring' | 'Summer';
/**
 * Widened from the six demo clusters to the course's own department.
 * The real catalog has ~200 subject prefixes, and inventing six buckets for
 * them would be fiction of exactly the kind this project tries to avoid.
 * The demo names still work, since they are just strings.
 */
export type CourseCluster = string;

// Illinois publishes an availability word per section and 'Closed' is one of
// them. Illinois publishes no seat counts and no waitlist, so 'almost-full'
// and 'waitlist' are unreachable there and must not be inferred.
export type SectionStatus = 'open' | 'closed' | 'almost-full' | 'waitlist' | 'unknown';

export interface CourseSectionSnapshot {
  termId: string;
  status: SectionStatus;
  seatsRemaining?: number;
  meeting?: string;
  location?: string;
  travelNote?: string;
  capturedAt: string;
}

export interface MapPosition {
  x: number;
  y: number;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  credits: number;
  /** Upper bound for a variable-credit course. 2,605 Illinois courses have one,
   *  and reading "1 to 4 hours" as 1 undercounts a term by three hours. */
  creditsMax?: number;
  description: string;
  cluster: CourseCluster;
  requirementIds: string[];
  prerequisites: string[];
  /** The registrar's original prerequisite sentence, where the source publishes one. */
  prerequisiteText?: string;
  offeredIn: SemesterSeason[];
  /** False when no section data exists for this course, so offeredIn is a
   *  default rather than an observation. A planner that cannot tell those two
   *  apart tells a student a course runs in spring when nobody knows. */
  offeringKnown?: boolean;
  format: 'In person' | 'Online' | 'Hybrid';
  tags: string[];
  section?: CourseSectionSnapshot;
  mapPosition?: MapPosition;
  pathwayRole?: 'required' | 'choice';
}

export interface PlanTerm {
  id: string;
  label: string;
  // Not 1|2|3|4. A transfer student with a five-year plan, or anyone taking a
  // light load, runs past year four, and the narrow type silently saturated
  // the label rather than showing the real year.
  year: number;
  season: SemesterSeason;
  courseIds: string[];
}

export interface PlanState {
  schemaVersion: 1;
  programId: string;
  graduationLabel: string;
  completedCourseIds: string[];
  terms: PlanTerm[];
}

export interface ProgramRequirement {
  id: string;
  label: string;
  targetCredits: number;
  description: string;
}

export interface ProgramDefinition {
  id: string;
  name: string;
  degree: string;
  totalCredits: number;
  requirements: ProgramRequirement[];
  /** 'catalog' means the requirements came from the university's own catalog. */
  dataStatus: 'reviewed-demo' | 'placeholder' | 'catalog';
}

export interface StudentProfile {
  primaryMajorId: string;
  secondaryMajorId: string;
  minorId: string;
  certificateId: string;
  graduationLabel: string;
  careerInterests: string;
  scholarshipPlan: 'none' | 'hope' | 'zell';
  minimumTermCredits: number;
  targetGpa: number;
  preferredFormat: 'Any' | Course['format'];
  preferredTime: 'Any' | 'Morning' | 'Midday' | 'Afternoon';
}

export interface OptionDefinition {
  id: string;
  label: string;
  status: 'placeholder' | 'none';
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface PlanIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  message: string;
  termId: string;
  courseId?: string;
}

export interface RequirementProgress {
  requirement: ProgramRequirement;
  credits: number;
  percent: number;
}
