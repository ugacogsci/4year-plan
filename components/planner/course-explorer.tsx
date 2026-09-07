'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  MapPin,
  Network,
  Plus,
  Search,
  Shuffle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import type {
  Course,
  CourseCluster,
  MapPosition,
  PlanTerm,
} from '@/lib/planner/types';

const clusterColors: Record<CourseCluster, string> = {
  Foundations: '#e6bd54',
  Computation: '#62b9ea',
  'Mind & Brain': '#ef7294',
  Language: '#a68af5',
  Philosophy: '#f28b57',
  'University Core': '#8b98a8',
};

const clusters = Object.keys(clusterColors) as CourseCluster[];

const constellationPoints = Array.from({ length: 260 }, (_, index) => ({
  id: index,
  x: 2 + ((index * 37 + (index % 7) * 11) % 96),
  y: 3 + ((index * 53 + (index % 13) * 7) % 94),
  size: index % 17 === 0 ? 2.2 : index % 5 === 0 ? 1.5 : 1,
  opacity: 0.18 + ((index * 29) % 44) / 100,
  color: clusterColors[clusters[index % clusters.length]],
}));

interface CourseExplorerProps {
  courses: Course[];
  terms: PlanTerm[];
  plannedCourseIds: Set<string>;
  selectedCourseId: string | null;
  selectedTermId: string | null;
  targetTermId: string;
  searchQuery: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSearchChange: (query: string) => void;
  onTargetTermChange: (termId: string) => void;
  onSelectCourse: (courseId: string) => void;
  onAddCourse: (courseId: string, termId: string) => void;
  onSwapCourse: (
    fromCourseId: string,
    toCourseId: string,
    termId: string,
  ) => void;
}

export function CourseExplorer({
  courses,
  terms,
  plannedCourseIds,
  selectedCourseId,
  selectedTermId,
  targetTermId,
  searchQuery,
  expanded,
  onExpandedChange,
  onSearchChange,
  onTargetTermChange,
  onSelectCourse,
  onAddCourse,
  onSwapCourse,
}: CourseExplorerProps) {
  const [visibleClusters, setVisibleClusters] = useState<Set<CourseCluster>>(
    () => new Set(clusters),
  );
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const coursePositions = useMemo(
    () =>
      new Map(
        courses.map((course, index) => [
          course.id,
          course.mapPosition ?? fallbackPosition(course.id, index),
        ]),
      ),
    [courses],
  );
  const visibleCourses = courses.filter((course) =>
    visibleClusters.has(course.cluster),
  );
  const matchingIds = new Set(
    normalizedQuery
      ? visibleCourses
          .filter((course) =>
            courseSearchText(course).includes(normalizedQuery),
          )
          .map((course) => course.id)
      : visibleCourses.map((course) => course.id),
  );
  const selectedCourse = courses.find(
    (course) => course.id === selectedCourseId,
  );
  const targetLabel =
    targetTermId === 'completed'
      ? 'Prior coursework'
      : (terms.find((term) => term.id === targetTermId)?.label ?? 'a term');
  const alternatives = selectedCourse
    ? courses
        .filter(
          (course) =>
            course.id !== selectedCourse.id &&
            !plannedCourseIds.has(course.id) &&
            course.requirementIds.some((id) =>
              selectedCourse.requirementIds.includes(id),
            ),
        )
        .slice(0, 4)
    : [];

  function toggleCluster(cluster: CourseCluster) {
    setVisibleClusters((current) => {
      const next = new Set(current);
      if (next.has(cluster)) next.delete(cluster);
      else next.add(cluster);
      return next;
    });
  }

  return (
    <section
      id="course-finder"
      className={cn('course-finder', expanded && 'course-finder-expanded')}
      aria-labelledby="course-finder-title"
    >
      <header className="course-finder-header">
        <div className="course-finder-title">
          <span className="map-mark" aria-hidden="true">
            <Network />
          </span>
          <div>
            <p className="eyebrow">Semantic course map</p>
            <h2 id="course-finder-title">Course finder</h2>
          </div>
          <span className="map-count">{courses.length} demo courses</span>
        </div>

        <div className="course-finder-controls">
          <label className="map-search" htmlFor="map-course-search">
            <span className="sr-only">Search courses</span>
            <Search />
            <Input
              id="map-course-search"
              value={searchQuery}
              placeholder="Search code, title, or interest"
              onChange={(event) => onSearchChange(event.target.value)}
              onFocus={() => onExpandedChange(true)}
            />
          </label>
          <div className="map-target">
            <label htmlFor="map-target-term">Add to</label>
            <NativeSelect
              id="map-target-term"
              value={targetTermId}
              onChange={(event) => onTargetTermChange(event.target.value)}
            >
              <NativeSelectOption value="completed">
                Prior coursework
              </NativeSelectOption>
              {terms.map((term) => (
                <NativeSelectOption key={term.id} value={term.id}>
                  {term.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label={expanded ? 'Minimize course map' : 'Open course map'}
            title={expanded ? 'Minimize course map' : 'Open course map'}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? <ChevronDown /> : <ChevronUp />}
          </Button>
        </div>
      </header>

      {!expanded && (
        <button
          type="button"
          className="course-finder-peek"
          onClick={() => onExpandedChange(true)}
        >
          <span>{matchingIds.size} courses match the current filters</span>
          <span>
            Open map <ChevronUp />
          </span>
        </button>
      )}

      {expanded && (
        <div className="course-map-layout">
          <aside className="map-legend" aria-label="Course clusters">
            <div className="map-legend-heading">
              <span>Departments & areas</span>
              <span>
                {visibleClusters.size}/{clusters.length}
              </span>
            </div>
            <div className="map-legend-list">
              {clusters.map((cluster) => {
                const visible = visibleClusters.has(cluster);
                const count = courses.filter(
                  (course) => course.cluster === cluster,
                ).length;
                return (
                  <button
                    key={cluster}
                    type="button"
                    className={cn(!visible && 'is-muted')}
                    aria-pressed={visible}
                    onClick={() => toggleCluster(cluster)}
                  >
                    <span
                      className="legend-dot"
                      style={{ backgroundColor: clusterColors[cluster] }}
                    />
                    <span>{cluster}</span>
                    <span>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="map-legend-key">
              <span>
                <i className="node-key node-key-required" /> Required
              </span>
              <span>
                <i className="node-key" /> Choice
              </span>
              <span>
                <i className="node-key node-key-planned" /> In plan
              </span>
            </div>
            <p>Drag any course node directly into a semester.</p>
          </aside>

          <div className="map-stage" aria-label="Semantic course map">
            <fieldset className="map-field" aria-label="Course nodes">
              {constellationPoints.map((point) => (
                <span
                  key={point.id}
                  className="constellation-point"
                  style={{
                    left: `${point.x}%`,
                    top: `${point.y}%`,
                    width: point.size,
                    height: point.size,
                    opacity: point.opacity,
                    backgroundColor: point.color,
                  }}
                />
              ))}

              <svg
                className="map-paths"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {courses.flatMap((course) =>
                  course.prerequisites.map((prerequisiteId) => {
                    const from = coursePositions.get(prerequisiteId);
                    const to = coursePositions.get(course.id);
                    if (!from || !to) return null;
                    return (
                      <line
                        key={`${prerequisiteId}-${course.id}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                      />
                    );
                  }),
                )}
              </svg>

              {visibleCourses.map((course) => {
                const position = coursePositions.get(course.id)!;
                const isSelected = course.id === selectedCourseId;
                const isPlanned = plannedCourseIds.has(course.id);
                const isMatch = matchingIds.has(course.id);
                return (
                  <button
                    key={course.id}
                    type="button"
                    draggable
                    title={`${course.code}: ${course.title}. Drag into a semester or select for details.`}
                    aria-label={`${course.code}, ${course.title}`}
                    aria-pressed={isSelected}
                    className={cn(
                      'map-course-node',
                      isSelected && 'is-selected',
                      isPlanned && 'is-planned',
                      course.pathwayRole === 'required' && 'is-required',
                      normalizedQuery && !isMatch && 'is-search-muted',
                      normalizedQuery && isMatch && 'is-search-match',
                    )}
                    style={
                      {
                        left: `${position.x}%`,
                        top: `${position.y}%`,
                        '--node-color': clusterColors[course.cluster],
                      } as CSSProperties
                    }
                    onClick={() => onSelectCourse(course.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        'application/x-course-id',
                        course.id,
                      );
                      event.dataTransfer.setData('application/x-source', 'map');
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <span className="map-node-core" />
                    {(isSelected || (normalizedQuery && isMatch)) && (
                      <span className="map-node-label">{course.code}</span>
                    )}
                  </button>
                );
              })}

              <div className="map-stage-caption">
                <span>{matchingIds.size} visible</span>
                <span>Lines show prerequisite paths</span>
              </div>
            </fieldset>
          </div>

          <aside className="map-inspector" aria-live="polite">
            {selectedCourse ? (
              <>
                <div className="inspector-heading">
                  <span
                    className="inspector-dot"
                    style={{
                      backgroundColor: clusterColors[selectedCourse.cluster],
                    }}
                  />
                  <div>
                    <p>{selectedCourse.cluster}</p>
                    <h3>{selectedCourse.code}</h3>
                  </div>
                  {selectedCourse.pathwayRole && (
                    <span className="pathway-chip">
                      {selectedCourse.pathwayRole}
                    </span>
                  )}
                </div>
                <h4>{selectedCourse.title}</h4>
                <p className="course-description">
                  {selectedCourse.description}
                </p>
                <dl className="course-facts">
                  <div>
                    <dt>Credits</dt>
                    <dd>{selectedCourse.credits}</dd>
                  </div>
                  <div>
                    <dt>Usually offered</dt>
                    <dd>{selectedCourse.offeredIn.join(' / ')}</dd>
                  </div>
                  <div>
                    <dt>Format</dt>
                    <dd>{selectedCourse.format}</dd>
                  </div>
                  <div>
                    <dt>Prerequisites</dt>
                    <dd>
                      {selectedCourse.prerequisites.length
                        ? selectedCourse.prerequisites
                            .map(
                              (id) =>
                                courses.find((course) => course.id === id)
                                  ?.code ?? id,
                            )
                            .join(', ')
                        : 'None listed'}
                    </dd>
                  </div>
                </dl>

                {selectedCourse.section && (
                  <div className="section-signal">
                    <div>
                      <span>Sample section signal</span>
                      <strong>
                        {selectedCourse.section.status.replace('-', ' ')}
                      </strong>
                    </div>
                    {selectedCourse.section.meeting && (
                      <p>
                        <Clock3 /> {selectedCourse.section.meeting}
                      </p>
                    )}
                    {selectedCourse.section.location && (
                      <p>
                        <MapPin /> {selectedCourse.section.location}
                      </p>
                    )}
                  </div>
                )}

                <Button
                  className="inspector-add-button"
                  disabled={plannedCourseIds.has(selectedCourse.id)}
                  onClick={() => onAddCourse(selectedCourse.id, targetTermId)}
                >
                  {plannedCourseIds.has(selectedCourse.id) ? (
                    <>
                      <Check /> Already in plan
                    </>
                  ) : targetTermId === 'completed' ? (
                    <>
                      <ArrowDownToLine /> Mark completed
                    </>
                  ) : (
                    <>
                      <Plus /> Add to {targetLabel}
                    </>
                  )}
                </Button>

                {selectedTermId && alternatives.length > 0 && (
                  <div className="alternative-list">
                    <div>
                      <Shuffle /> Other courses that fit
                    </div>
                    {alternatives.map((course) => (
                      <button
                        key={course.id}
                        type="button"
                        onClick={() =>
                          onSwapCourse(
                            selectedCourse.id,
                            course.id,
                            selectedTermId,
                          )
                        }
                      >
                        <span>
                          <strong>{course.code}</strong>
                          {course.title}
                        </span>
                        <span>Swap</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="inspector-empty">
                <Network />
                <h3>Select a course</h3>
                <p>
                  Choose a point to inspect details, or drag it directly into a
                  semester.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function courseSearchText(course: Course) {
  return `${course.code} ${course.title} ${course.cluster} ${course.tags.join(' ')}`.toLowerCase();
}

function fallbackPosition(id: string, index: number): MapPosition {
  const hash = Array.from(id).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 10_007,
    index + 17,
  );
  return {
    x: 6 + (hash % 88),
    y: 7 + ((hash * 47 + index * 13) % 84),
  };
}
