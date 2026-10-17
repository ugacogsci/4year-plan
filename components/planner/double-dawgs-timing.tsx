'use client';

import type { OnboardingAnswers } from '@/lib/planner/onboarding';
import {
  defaultGraduateFinish,
  degreeTermOrder,
} from '@/lib/planner/double-dawgs';
import type { SemesterSeason } from '@/lib/planner/types';

export function doubleDawgsTimingValid(answers: OnboardingAnswers): boolean {
  if (!answers.doubleDawgsPathwayId) return true;
  if (!answers.graduationSeason || !answers.graduationYear) return false;
  const finish = {
    season: answers.graduationSeason,
    year: answers.graduationYear,
  };
  const graduate =
    answers.doubleDawgsGraduateSeason && answers.doubleDawgsGraduateYear
      ? {
          season: answers.doubleDawgsGraduateSeason,
          year: answers.doubleDawgsGraduateYear,
        }
      : defaultGraduateFinish(finish);
  const first =
    finish.season === 'Fall'
      ? { season: 'Spring' as const, year: finish.year + 1 }
      : { season: 'Fall' as const, year: finish.year };
  return degreeTermOrder(graduate) >= degreeTermOrder(first);
}

export function DoubleDawgsTiming({
  answers,
  onChange,
}: {
  answers: OnboardingAnswers;
  onChange: (answers: OnboardingAnswers) => void;
}) {
  if (!answers.graduationSeason || !answers.graduationYear) return null;
  const suggested = defaultGraduateFinish({
    season: answers.graduationSeason,
    year: answers.graduationYear,
  });
  const season = answers.doubleDawgsGraduateSeason || suggested.season;
  const year = answers.doubleDawgsGraduateYear || suggested.year;
  return (
    <fieldset className="onb-graduation double-dawgs-timing">
    <legend>Master&apos;s completion</legend>
      <div>
        <label>
          <span>Term</span>
          <select
            aria-label="Master's completion term"
            value={season}
            onChange={(event) =>
              onChange({
                ...answers,
                doubleDawgsGraduateSeason: event.target.value as SemesterSeason,
                doubleDawgsGraduateYear: year,
              })
            }
          >
            {(['Spring', 'Summer', 'Fall'] as const).map((term) => (
              <option key={term}>{term}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Year</span>
          <select
            aria-label="Master's completion year"
            value={year}
            onChange={(event) =>
              onChange({
                ...answers,
                doubleDawgsGraduateSeason: season,
                doubleDawgsGraduateYear: Number(event.target.value),
              })
            }
          >
            {Array.from(
              { length: 11 },
              (_, index) => answers.graduationYear! + index,
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      {!doubleDawgsTimingValid(answers) && (
        <p role="alert">
          Allow at least one fall or spring graduate term after finishing your
          bachelor&apos;s degree.
        </p>
      )}
    </fieldset>
  );
}
