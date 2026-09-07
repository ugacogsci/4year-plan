export type SemesterSeason = 'Fall' | 'Spring';
export type CourseCluster =
  | 'Foundations'
  | 'Computation'
  | 'Mind & Brain'
  | 'Language'
  | 'Philosophy'
  | 'University Core';

export type SectionStatus = 'open' | 'almost-full' | 'waitlist' | 'unknown';

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
  description: string;
  cluster: CourseCluster;
  requirementIds: string[];
  prerequisites: string[];
  offeredIn: SemesterSeason[];
  format: 'In person' | 'Online' | 'Hybrid';
  tags: string[];
  section?: CourseSectionSnapshot;
  mapPosition?: MapPosition;
  pathwayRole?: 'required' | 'choice';
}

export interface PlanTerm {
  id: string;
  label: string;
  year: 1 | 2 | 3 | 4;
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
  dataStatus: 'reviewed-demo' | 'placeholder';
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
