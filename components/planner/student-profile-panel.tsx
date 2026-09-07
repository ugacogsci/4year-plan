'use client';

import {
  BookCheck,
  BriefcaseBusiness,
  GraduationCap,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import type {
  OptionDefinition,
  ProgramDefinition,
  RequirementProgress,
  StudentProfile,
} from '@/lib/planner/types';

interface StudentProfilePanelProps {
  profile: StudentProfile;
  programs: ProgramDefinition[];
  secondaryMajors: OptionDefinition[];
  minors: OptionDefinition[];
  certificates: OptionDefinition[];
  graduationOptions: string[];
  activeProgram: ProgramDefinition;
  requirementProgress: RequirementProgress[];
  plannedCredits: number;
  completedCount: number;
  onProfileChange: <Key extends keyof StudentProfile>(
    field: Key,
    value: StudentProfile[Key],
  ) => void;
  onPrimaryMajorChange: (programId: string) => void;
  onAddCompletedCourse: () => void;
}

export function StudentProfilePanel({
  profile,
  programs,
  secondaryMajors,
  minors,
  certificates,
  graduationOptions,
  activeProgram,
  requirementProgress,
  plannedCredits,
  completedCount,
  onProfileChange,
  onPrimaryMajorChange,
  onAddCompletedCourse,
}: StudentProfilePanelProps) {
  const degreePercent = Math.min(
    100,
    Math.round((plannedCredits / activeProgram.totalCredits) * 100),
  );

  return (
    <aside className="profile-panel" aria-label="Student and program setup">
      <div className="profile-panel-heading">
        <div>
          <p className="eyebrow">Student profile</p>
          <h2>Build your path</h2>
        </div>
        <span className="sample-chip">Demo inputs</span>
      </div>

      <section className="profile-section" aria-labelledby="program-heading">
        <div className="section-label-row">
          <GraduationCap className="size-3.5" />
          <h3 id="program-heading">Programs</h3>
        </div>
        <Field label="Primary major">
          <NativeSelect
            value={profile.primaryMajorId}
            onChange={(event) => onPrimaryMajorChange(event.target.value)}
          >
            {programs.map((program) => (
              <NativeSelectOption key={program.id} value={program.id}>
                {program.name}, {program.degree}
                {program.dataStatus === 'placeholder' ? ' (sample)' : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Second major">
          <NativeSelect
            value={profile.secondaryMajorId}
            onChange={(event) =>
              onProfileChange('secondaryMajorId', event.target.value)
            }
          >
            {secondaryMajors.map((option) => (
              <NativeSelectOption
                key={option.id}
                value={option.id}
                disabled={option.id === profile.primaryMajorId}
              >
                {option.label}
                {option.status === 'placeholder' ? ' (sample)' : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="profile-field-grid">
          <Field label="Minor">
            <NativeSelect
              value={profile.minorId}
              onChange={(event) =>
                onProfileChange('minorId', event.target.value)
              }
            >
              {minors.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                  {option.status === 'placeholder' ? ' *' : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Certificate">
            <NativeSelect
              value={profile.certificateId}
              onChange={(event) =>
                onProfileChange('certificateId', event.target.value)
              }
            >
              {certificates.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                  {option.status === 'placeholder' ? ' *' : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Intended graduation">
          <NativeSelect
            value={profile.graduationLabel}
            onChange={(event) =>
              onProfileChange('graduationLabel', event.target.value)
            }
          >
            {graduationOptions.map((label) => (
              <NativeSelectOption key={label} value={label}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </section>

      <section className="profile-section" aria-labelledby="goals-heading">
        <div className="section-label-row">
          <BriefcaseBusiness className="size-3.5" />
          <h3 id="goals-heading">Goals & preferences</h3>
        </div>
        <Field label="Career interests">
          <textarea
            value={profile.careerInterests}
            rows={2}
            placeholder="e.g. UX research, clinical work"
            onChange={(event) =>
              onProfileChange('careerInterests', event.target.value)
            }
          />
        </Field>
        <div className="profile-field-grid">
          <Field label="Format">
            <NativeSelect
              value={profile.preferredFormat}
              onChange={(event) =>
                onProfileChange(
                  'preferredFormat',
                  event.target.value as StudentProfile['preferredFormat'],
                )
              }
            >
              {['Any', 'In person', 'Online', 'Hybrid'].map((format) => (
                <NativeSelectOption key={format} value={format}>
                  {format}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Class time">
            <NativeSelect
              value={profile.preferredTime}
              onChange={(event) =>
                onProfileChange(
                  'preferredTime',
                  event.target.value as StudentProfile['preferredTime'],
                )
              }
            >
              {['Any', 'Morning', 'Midday', 'Afternoon'].map((time) => (
                <NativeSelectOption key={time} value={time}>
                  {time}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <p className="capture-note">
          Captured and saved in this MVP; preference-based plan ranking is not
          connected yet.
        </p>
      </section>

      <section
        className="profile-section"
        aria-labelledby="constraints-heading"
      >
        <div className="section-label-row">
          <SlidersHorizontal className="size-3.5" />
          <h3 id="constraints-heading">Scholarship constraints</h3>
          <span className="placeholder-mark">sample</span>
        </div>
        <Field label="Scholarship plan">
          <NativeSelect
            value={profile.scholarshipPlan}
            onChange={(event) =>
              onProfileChange(
                'scholarshipPlan',
                event.target.value as StudentProfile['scholarshipPlan'],
              )
            }
          >
            <NativeSelectOption value="none">
              No tracked scholarship
            </NativeSelectOption>
            <NativeSelectOption value="hope">
              HOPE Scholarship
            </NativeSelectOption>
            <NativeSelectOption value="zell">
              Zell Miller Scholarship
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <div className="profile-field-grid">
          <Field label="Min. credits / term">
            <input
              type="number"
              min={0}
              max={18}
              value={profile.minimumTermCredits}
              disabled={profile.scholarshipPlan === 'none'}
              onChange={(event) =>
                onProfileChange(
                  'minimumTermCredits',
                  Number(event.target.value),
                )
              }
            />
          </Field>
          <Field label="Target GPA">
            <input
              type="number"
              min={0}
              max={4}
              step={0.1}
              value={profile.targetGpa}
              disabled={profile.scholarshipPlan === 'none'}
              onChange={(event) =>
                onProfileChange('targetGpa', Number(event.target.value))
              }
            />
          </Field>
        </div>
        <p className="capture-note">
          Minimum credits drives live warnings. GPA is capture-only until
          academic records are connected.
        </p>
      </section>

      <section className="profile-section" aria-labelledby="progress-heading">
        <div className="section-label-row">
          <BookCheck className="size-3.5" />
          <h3 id="progress-heading">Degree progress</h3>
          <span className="section-value">{degreePercent}%</span>
        </div>
        <div className="total-progress">
          <div>
            <strong>{plannedCredits}</strong>
            <span> / {activeProgram.totalCredits} credits</span>
          </div>
          <Progress value={degreePercent} />
        </div>
        <div className="requirement-list">
          {requirementProgress.map(({ requirement, credits, percent }) => (
            <div key={requirement.id} className="requirement-row">
              <div>
                <span>{requirement.label}</span>
                <span>
                  {credits}/{requirement.targetCredits}
                </span>
              </div>
              <Progress value={percent} />
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-3 w-full"
          onClick={onAddCompletedCourse}
        >
          <Plus /> Add prior coursework
          {completedCount > 0 && <span>({completedCount})</span>}
        </Button>
      </section>

      <p className="placeholder-note">
        <strong>Prototype data:</strong> Computer Science and Psychology rules,
        all second majors, minors, certificates, scholarship thresholds, and
        live section signals are placeholders. Confirm plans in the UGA Bulletin
        and DegreeWorks.
      </p>
    </aside>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
