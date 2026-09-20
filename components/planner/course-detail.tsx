'use client';

/**
 * What a course is, how hard it has been, what it needs first, and where it
 * meets. Four questions, four blocks, and a visible absence wherever Illinois
 * publishes nothing.
 *
 * Every number here is read from a crawled Illinois page. Where there is no
 * row, the panel says there is no row. It never fills a gap with a hedge,
 * because a student reads a hedge as an answer.
 */

import { clusterColor } from './cluster-color';
import { useCourseDetail } from './illinois-source';
import { plural } from './words';
import { DEADLINE_DISCLAIMER, DEFAULT_STANDING_HOURS } from '@/lib/planner/autoplan';
import {
  difficultyLabel,
  partOfTermLine,
  prettyDateRange,
  THIN_SAMPLE,
  visibleInstructors,
} from '@/lib/planner/illinois-data';
import type { IllinoisCore } from '@/lib/planner/illinois-load';
import { toGradeRow } from '@/lib/planner/illinois-load';
import type { RawSection } from '@/lib/planner/illinois-data';
import type { Course } from '@/lib/planner/types';

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Where the course sits in Illinois's own distribution, not a verdict about it.
 *
 * The bands are the 25th, 75th and 90th percentiles of every Illinois course
 * with grade history, so these say exactly that and nothing more. "Harder than
 * most" next to a 3.44 average and 68% A grades reads as a contradiction; "in
 * the harder quarter" is the same number said accurately.
 */
const BAND_WORD: Record<string, string> = {
  easier: 'In the easiest quarter of Illinois courses by grade history',
  typical: 'In the middle half of Illinois courses by grade history',
  harder: 'In the harder quarter of Illinois courses by grade history',
  hardest: 'In the hardest tenth of Illinois courses by grade history',
};

const DAY_WORDS: Record<string, string> = {
  M: 'Mon',
  T: 'Tue',
  W: 'Wed',
  R: 'Thu',
  F: 'Fri',
  S: 'Sat',
};

/** The class standings the catalog names, written the way a student says them. */
const STANDING_ARTICLE: Record<string, string> = {
  freshman: 'a freshman',
  sophomore: 'a sophomore',
  junior: 'a junior',
  senior: 'a senior',
};

/** How Illinois writes "this section has no weekly day pattern" in the day cell. */
const NO_DAYS = 'n.a.';
/** How Illinois writes "the meeting time is settled with the instructor". */
const ARRANGED = 'ARRANGED';

/** "MWF" -> "Mon Wed Fri". Anything that is not a clean run is printed as-is,
 *  because the scraper concatenates two meetings into one cell often enough
 *  that expanding a mangled cell would show a meeting pattern that does not exist. */
function days(pattern: string | null): string | null {
  const value = (pattern ?? '').trim();
  /**
   * 2,752 of the 12,832 Fall 2026 sections carry the literal string "n.a." in
   * the day cell, which is the schedule saying there is no weekly pattern, not
   * a pattern. Printing it gave lines like "SHS 222 C01 (Online) n.a. ARRANGED",
   * which reads as a day of the week nobody has heard of. illinois-data drops
   * the same value when it summarises; this drops it too.
   */
  if (!value || value.toLowerCase() === NO_DAYS) return null;
  if (!/^[MTWRFS]+$/.test(value)) return value;
  return value.split('').map((d) => DAY_WORDS[d] ?? d).join(' ');
}

/**
 * When a section meets, in one phrase, or nothing at all.
 *
 * Illinois writes ARRANGED in the start-time cell for a section whose time is
 * settled with the instructor. That is a real fact about the section and worth
 * saying, but it is a time, not a clock reading, so it does not get an "and
 * ends at" after it. 100 sections pair it with a real day pattern and 2,752
 * have no day pattern at all.
 */
function when(section: RawSection): string {
  const pattern = days(section.days);
  const arranged = (section.start ?? '').trim().toUpperCase() === ARRANGED;
  const clock = arranged
    ? 'time arranged with the instructor'
    : [section.start, section.end].filter(Boolean).join(' to ');
  const parts = [pattern, clock].filter(Boolean);
  if (parts.length === 0) return 'Days and times not listed';
  return parts.join(' ');
}

function where(section: RawSection): string {
  const building = section.building?.trim();
  const room = section.room?.trim();
  if (building && room) return `${building} ${room}`;
  if (building) return building;
  if (room) return `Room ${room}`;
  return 'Location not listed';
}

export function CourseDetail({
  course,
  core,
  completed,
}: {
  course: Course;
  core: IllinoisCore | null;
  completed: boolean;
}) {
  const code = normCode(course.code);
  const { detail, loading } = useCourseDetail(code);
  const spec = core?.prereqs?.get(code) ?? null;
  const summary = core?.grades?.get(code) ?? null;
  const sections = core?.sections?.get(code) ?? null;
  const bands = core?.meta?.bands ?? null;
  const term = core?.meta?.term ?? null;

  const grade =
    summary && bands
      ? difficultyLabel(toGradeRow(summary, course.title, detail?.instructors ?? []), bands)
      : { kind: 'none' as const };

  const rows = detail?.sections?.sections ?? [];
  const max = course.creditsMax ?? course.credits;

  return (
    <>
      <div className="inspector-heading">
        <span
          className="inspector-dot"
          style={{ backgroundColor: clusterColor(course.cluster) }}
        />
        <div>
          <p>{course.cluster}</p>
          <h3>{course.code}</h3>
        </div>
      </div>
      <h4>{course.title}</h4>

      {loading && <p className="course-description quiet">Reading the catalog page.</p>}
      {!loading && detail?.course?.description && (
        <p className="course-description">{detail.course.description}</p>
      )}
      {!loading && detail && !detail.course?.description && (
        <p className="course-description quiet">
          The catalog page has no description for this course.
        </p>
      )}

      <dl className="course-facts">
        <div>
          <dt>Credit hours</dt>
          <dd>{max > course.credits ? `${course.credits} to ${max}` : course.credits}</dd>
        </div>
        {course.tags.length > 0 && (
          <div>
            <dt>Gen ed</dt>
            <dd>{course.tags.join(', ')}</dd>
          </div>
        )}
        {completed && (
          <div>
            <dt>You marked this</dt>
            <dd>Already taken</dd>
          </div>
        )}
      </dl>

      <section className="inspector-block">
        <h5>What it needs first</h5>
        {!core?.prereqs && <p className="quiet">Prerequisites have not loaded.</p>}
        {/**
          * Said only when the catalog page really is silent.
          *
          * Every course on this board that has a prerequisite line, or a
          * sentence saying its prerequisites live in the class schedule, has an
          * entry here, so an absent entry is an absent line on the page rather
          * than a line nobody could parse. The description is named anyway,
          * because three Illinois pages put an enrolment restriction there and
          * nowhere else.
          */}
        {core?.prereqs && !spec && (
          <p className="quiet">
            The catalog page for this course lists nothing that has to come first. Read the
            description above as well, in case it names one.
          </p>
        )}
        {spec && (
          <>
            {/* The catalog's own sentence. For the 51 courses whose page says
                the prerequisites are published elsewhere, this IS that
                sentence, which is why it prints before anything else. */}
            <p>{spec.text}</p>
            {spec.standing && (
              <p className="quiet">
                You need to be {STANDING_ARTICLE[spec.standing]}, which Illinois counts as{' '}
                {DEFAULT_STANDING_HOURS[spec.standing]} earned hours. The plan holds this course
                back until you get there.
              </p>
            )}
            {spec.note && (
              <p className="quiet">
                The course list itself does not name the prerequisites, so nothing here can check
                them. Look up the section you want in the class schedule.
              </p>
            )}
            {/* Half true for the 419 courses with a class standing: the standing
                IS checked even when the course list around it could not be read.
                Saying nothing is checked would send a student to verify work the
                plan already did. */}
            {!spec.parsed && !spec.note && (
              <p className="quiet">
                {spec.standing
                  ? 'Apart from the class standing, that sentence could not be read as a list of courses, so nothing here checks the rest of it for you.'
                  : 'That sentence could not be read as a list of courses, so nothing here checks it for you.'}
              </p>
            )}
          </>
        )}
      </section>

      <section className="inspector-block">
        <h5>How it has gone</h5>
        {grade.kind === 'none' ? (
          <p className="quiet">No grade history is published for this course.</p>
        ) : (
          <>
            <p>
              {BAND_WORD[grade.band]}. Average GPA {grade.gpa ?? 'not published'}
              {grade.aPct !== null && `, ${grade.aPct}% A grades`}
              {grade.withdrawPct !== null && `, ${grade.withdrawPct}% withdrew`}.
            </p>
            <p className="quiet">
              {grade.n.toLocaleString()} {plural(grade.n, 'student')} across {grade.sections}{' '}
              {plural(grade.sections, 'section')}.
              {grade.thin && ` Fewer than ${THIN_SAMPLE} students, so read it loosely.`}
            </p>
            {detail?.instructors && detail.instructors.length > 0 && (
              <p className="quiet">
                {visibleInstructors(
                  toGradeRow(summary!, course.title, detail.instructors),
                )
                  .slice(0, 4)
                  .map(
                    (i) =>
                      `${i.name} ${i.gpa} GPA over ${i.sections} ${plural(i.sections, 'section')}`,
                  )
                  .join('. ')}
                .
              </p>
            )}
            <p className="quiet">{core?.meta?.gradeFootnote}</p>
          </>
        )}
      </section>

      <section className="inspector-block">
        <h5>Where and when</h5>
        {!core?.sections && <p className="quiet">The schedule has not loaded.</p>}
        {core?.sections && !sections && (
          <p className="quiet">
            {term ? `No ${term.label} section has been read for this course.` : 'No sections read.'}
          </p>
        )}
        {sections && (
          <>
            <p>
              {sections.total} {plural(sections.total, 'section')} in {sections.termLabel}.
            </p>
            {rows.slice(0, 5).map((row) => (
              <p key={row.crn} className="quiet">
                {row.section ?? row.crn} {row.type ? `(${row.type}) ` : ''}
                {when(row)}, {where(row)}
                {row.instructors.length > 0 && `, ${row.instructors.join(', ')}`}
                {row.partOfTerm && `. Part of term ${row.partOfTerm}`}
                {prettyDateRange(row.dateRange) && `, ${prettyDateRange(row.dateRange)}`}.
              </p>
            ))}
            {rows.length > 5 && (
              <p className="quiet">
                And {rows.length - 5} more {plural(rows.length - 5, 'section')}.
              </p>
            )}
            {rows.length === 0 && !loading && (
              <p className="quiet">The schedule for this subject has not loaded.</p>
            )}
            <p className="quiet">{partOfTermLine(sections)}</p>
            <p className="quiet">{DEADLINE_DISCLAIMER}</p>
          </>
        )}
      </section>
    </>
  );
}
