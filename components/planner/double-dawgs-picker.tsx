'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { loadUgaData, loadUgaProgram, type UgaData } from './uga-source';
import {
  doubleDawgsCourseList,
  selectSharedCourses,
  sharedCreditLimit,
} from '@/lib/planner/double-dawgs';
import {
  loadUgaPlanningGuidance,
  pathwaysFor,
  type UgaPlanningGuidance,
} from '@/lib/planner/uga-planning-guidance';

export function DoubleDawgsPicker({
  programIds,
  selectedId,
  onChange,
  sharedCodes,
  onSharedChange,
  completedCodes,
  emphasisSelections,
}: {
  programIds: string[];
  selectedId?: string | null;
  onChange: (id: string | null) => void;
  sharedCodes?: string[];
  onSharedChange?: (codes: string[]) => void;
  completedCodes?: string[];
  emphasisSelections?: Record<string, string[]>;
}) {
  const [guidance, setGuidance] = useState<UgaPlanningGuidance | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [courseQuery, setCourseQuery] = useState('');
  const [data, setData] = useState<UgaData | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadUgaPlanningGuidance().then((data) => {
      if (!cancelled) {
        setGuidance(data);
        setLoading(false);
      }
    });
    void loadUgaData().then((data) => {
      if (!cancelled) setData(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const pathways = pathwaysFor(guidance, programIds);
  const selected = pathways.find((pathway) => pathway.id === selectedId);
  // The adapter mutates only the isolated preview copy inside this memo.
  // oxlint-disable-next-line react/react-compiler
  const listings = useMemo(() => {
    if (!data || !selected) return [];
    const ug = data.programs.find((program) =>
      selected.undergraduateProgramIds.includes(program.id),
    );
    const gr =
      selected.graduateProgramIds.length === 1
        ? data.programs.find(
            (program) => program.id === selected.graduateProgramIds[0],
          )
        : null;
    if (!ug || !gr) return [];
    // Previewing choices must not mutate the active plan's requirement marks or credits.
    const courses = data.courses.map((course) => ({
      ...course,
      requirementIds: [...course.requirementIds],
    }));
    const copy = {
      ...data,
      courses,
      byCode: new Map(courses.map((course) => [course.code, course])),
      context: {
        ...data.context,
        courses,
        creditRanges: new Map(data.context.creditRanges),
      },
    };
    loadUgaProgram(copy, ug, { emphasisSelections });
    const graduate = loadUgaProgram(copy, gr, {
      resetRequirements: false,
      emphasisSelections,
    });
    return doubleDawgsCourseList(
      selected,
      graduate,
      copy.byCode,
      copy.dualLevelCourses,
    );
  // oxlint-disable-next-line react/react-compiler
  }, [data, selected, emphasisSelections]);
  const options = listings.flatMap((row) => row.option ?? []);
  const courseWords = courseQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const shownCourses = listings.filter((course) => courseWords.every((word) => `${course.code} ${course.title}`.toLowerCase().includes(word)));
  const shared = selected
    ? selectSharedCourses(selected, options, sharedCodes, completedCodes)
    : [];
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = pathways.filter((pathway) =>
    words.every((word) => pathway.name.toLowerCase().includes(word)),
  );
  return (
    <details className="double-dawgs" open={Boolean(selectedId) || undefined}>
      <summary>
        {selected ? 'Double Dawgs pathway' : 'Considering Double Dawgs?'}
      </summary>
      {loading ? (
        <output>Reading UGA pathways...</output>
      ) : !guidance ? (
        <p>
          Pathways could not be loaded.{' '}
          <a
            href="https://doubledawgs.uga.edu/ProgramList"
            target="_blank"
            rel="noreferrer"
          >
            Browse UGA&apos;s directory
          </a>
          .
        </p>
      ) : pathways.length === 0 ? (
        <p>
          No published pathway is linked to your selected major in this
          snapshot.{' '}
          <a
            href="https://doubledawgs.uga.edu/ProgramList"
            target="_blank"
            rel="noreferrer"
          >
            Check UGA&apos;s directory
          </a>{' '}
          for other options.
        </p>
      ) : (
        <>
          <label className="guidance-search">
            <span>Graduate pathway</span>
            <input
              type="search"
              aria-label="Search Double Dawgs pathways"
              placeholder="Search pathways"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div
            className="double-dawgs-options"
            role="radiogroup"
            aria-label="Double Dawgs pathway"
          >
            <label>
              <input
                type="radio"
                name="double-dawgs"
                checked={!selected}
                onChange={() => onChange(null)}
              />
              <span>No pathway selected</span>
            </label>
            {matches.map((pathway) => (
              <label key={pathway.id}>
                <input
                  type="radio"
                  name="double-dawgs"
                  checked={selected?.id === pathway.id}
                  onChange={() => onChange(pathway.id)}
                />
                <span>{pathway.name}</span>
              </label>
            ))}
            {matches.length === 0 && <p>No matching pathways.</p>}
          </div>
          {selected && (
            <div className="double-dawgs-summary">
              <p>
                <strong>{selected.name}</strong>
              </p>
              <p>
                Plan both degrees, with separate completion dates. Shared
                graduate courses appear once and count toward both stages.
              </p>
              <p>
                Up to {sharedCreditLimit(selected)} approved credits may be
                shared. Graduate admission and your program of study still need
                approval.
              </p>
              {!selected.graduateProgramIds.length && (
                <p role="alert">
                  This pathway&apos;s graduate degree is not yet linked to a
                  curriculum. A combined schedule cannot be generated for it
                  yet.
                </p>
              )}
              {onSharedChange && listings.length > 0 && (
                <fieldset className="double-dawgs-shared">
                  <legend>
                    Proposed shared courses (
                    {shared.reduce((sum, course) => sum + course.credits, 0)}{' '}
                    cr)
                  </legend>
                  <input type="search" aria-label="Search shared graduate courses" placeholder="Search course codes or titles" value={courseQuery} onChange={(event) => setCourseQuery(event.target.value)} />
                  <div className="double-dawgs-course-list">
                  {shownCourses.map((listing) => {
                    const course = listing.option;
                    if (!course) return <div className="double-dawgs-course-review" key={listing.code}>
                      <span>{listing.code} · {listing.title}</span>
                      <small>{listing.reason}</small>
                    </div>;
                    const checked = shared.some(
                      (row) => row.code === course.code,
                    );
                    const held = course.undergraduateCode !== course.code && completedCodes?.includes(
                      course.undergraduateCode,
                    );
                    const next = selectSharedCourses(
                      selected,
                      options,
                      [...shared.map((row) => row.code), course.code],
                      completedCodes,
                    );
                    return (
                      <label
                        key={course.code}
                        title={
                          held
                            ? 'Already earned as undergraduate credit; it cannot be converted into graduate credit.'
                            : `${course.code}: pathway approval required.`
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={
                            !checked &&
                            !next.some((row) => row.code === course.code)
                          }
                          onChange={() =>
                            onSharedChange(
                              checked
                                ? shared
                                    .filter((row) => row.code !== course.code)
                                    .map((row) => row.code)
                                : next.map((row) => row.code),
                            )
                          }
                        />
                        <span>
                          {course.code} · {listing.title}{' '}
                          <small>
                            {course.credits} cr · {course.undergraduateCode === course.code ? 'Shared upper-division credit' : `replaces ${course.undergraduateCode}`}
                            {held ? ' · Already on your undergraduate record; cannot be converted' : !checked && !next.some((row) => row.code === course.code) ? ' · Shared-credit limit reached' : ''}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                  {shownCourses.length === 0 && <p>No matching graduate courses.</p>}
                  </div>
                </fieldset>
              )}
              {data &&
                options.length === 0 &&
                selected.graduateProgramIds.length > 0 && (
                  <p>
                    No shared substitution can be verified from both degree
                    pages in this snapshot. Both stages will be planned without
                    subtracting shared credit; review the pathway&apos;s course list
                    with your advisor.
                  </p>
                )}
              {selected.curriculum && (
                <details>
                  <summary>Published shared-credit rules</summary>
                  <p style={{ whiteSpace: 'pre-line' }}>
                    {selected.curriculum}
                  </p>
                </details>
              )}
              <a href={selected.url} target="_blank" rel="noreferrer">
                Pathway requirements and advisor{' '}
                <ExternalLink aria-hidden="true" />
              </a>
              <a
                href="https://doubledawgs.uga.edu/faq.html"
                target="_blank"
                rel="noreferrer"
              >
                UGA&apos;s Double Dawgs guidance{' '}
                <ExternalLink aria-hidden="true" />
              </a>
            </div>
          )}
        </>
      )}
    </details>
  );
}
