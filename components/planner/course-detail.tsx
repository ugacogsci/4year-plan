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
  sectionIsRestricted,
  THIN_SAMPLE,
  visibleInstructors,
} from '@/lib/planner/illinois-data';
import type { IllinoisCore } from '@/lib/planner/illinois-load';
import { toGradeRow } from '@/lib/planner/illinois-load';
import type { RawSection } from '@/lib/planner/illinois-data';
import type { Course } from '@/lib/planner/types';
import type { SchoolId } from '@/lib/planner/onboarding';

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Where the course sits in Illinois's own distribution, not a verdict about it.
 *
 * "Harder than most" next to a 3.44 average and 68% A grades reads as a
 * contradiction; a position in the distribution is the same number said
 * accurately. So these sentences are only worth printing if the cut points
 * behind them really are where they claim.
 *
 * HOW THE CUTS ARE DERIVED. computeDifficultyBands sorts the difficulties of
 * the courses in this index that have grade history and takes the values at
 * positions floor(n x 0.25), floor(n x 0.75) and floor(n x 0.90). Over the
 * 2,293 such rows in the September 2026 import that is 10, 28 and 39. The
 * shares those cuts carve out, which is what the four sentences below claim:
 * 26.6% at or below 10, 47.8% between, 25.6% at or above 28, and 10.3% at or
 * above 39. Difficulty is a whole number with heavy ties, so an exact quarter
 * is not reachable and the harness allows three points either way.
 *
 * The comment here used to say the same three positions over "every Illinois
 * course with grade history", and the code did exactly that: it read all 2,968
 * published rows, graduate courses included, and produced 10 / 28 / 39's older
 * siblings 9 / 26 / 37. Against the courses a student can actually take those
 * sit at the 18.8th, 70.1st and 88.2nd, so the first sentence below was told
 * to the easiest fifth while claiming a quarter. The fix was in the population,
 * not in the words, which is why this paragraph says which population.
 *
 * 'harder' and 'hardest' both sit above the 75th. The hardest tenth gets the
 * more specific sentence; everything else above the cut gets the general one.
 */
const BAND_WORD: Record<string, string> = {
  easier: 'In the easiest quarter of Illinois undergraduate courses by grade history',
  typical: 'In the middle half of Illinois undergraduate courses by grade history',
  harder: 'In the harder quarter of Illinois undergraduate courses by grade history',
  hardest: 'In the hardest tenth of Illinois undergraduate courses by grade history',
};

/**
 * What to say when the sample is too small to place the course.
 *
 * difficultyLabel holds a thin row back from 'harder' and 'hardest' rather
 * than letting 40 students decide a course is one of the hardest at Illinois.
 * 127 courses are held back that way, and printing the held-back band as a
 * position would tell those students they are in the middle half when their
 * number is in the top quarter.
 */
const HELD_BACK =
  'Too few students in the published history to say where this sits against other courses';

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
  schoolId,
  completed,
}: {
  course: Course;
  core: IllinoisCore | null;
  schoolId: SchoolId | null;
  completed: boolean;
}) {
  const code = normCode(course.code);
  const isIllinois = schoolId === 'illinois';
  const isUga = schoolId === 'uga';
  const { detail, loading } = useCourseDetail(code, isIllinois);
  const spec = core?.prereqs?.get(code) ?? null;
  const summary = core?.grades?.get(code) ?? null;
  const sections = core?.sections?.get(code) ?? null;
  const bands = core?.meta?.bands ?? null;
  const term = core?.meta?.term ?? null;

  /**
   * The grade row this course's numbers really come from.
   *
   * A class taught under two codes is reported to the registrar under one of
   * them. CS 468 has no row of its own while the identical ADV 492 has 114
   * grades, and 503 undergraduate courses are in that position: the index gives
   * them the twin's difficulty, so the board colours and sorts them, and this
   * panel used to say "No grade history is published for this course" three
   * inches away. Reading the twin's row here is right, because it is the same
   * class and the same students, and the line below says whose row it is.
   */
  const twin = summary
    ? null
    : (detail?.course?.sameAs ?? [])
        .map((code) => ({ code: normCode(code), row: core?.grades?.get(normCode(code)) ?? null }))
        .find((t) => t.row !== null) ?? null;
  const gradeRow = summary ?? twin?.row ?? null;

  /**
   * A course whose history is under a code this page cannot name.
   *
   * The catalog row lists the codes a class is also taught under, but not
   * always the one the registrar filed under: AAS 201's row names AFRO 201 and
   * the grades are under PS 201. The index knows, because the build reads the
   * whole cross-listing class, and it hands down a difficulty. So a difficulty
   * with no row to explain it means the history exists somewhere under this
   * class's other names, and "no grade history is published for this course"
   * would be the wrong thing to say about it.
   */
  const elsewhere =
    !gradeRow && !loading && core?.byCode.get(code)?.difficulty !== undefined;

  const grade =
    gradeRow && bands
      ? difficultyLabel(toGradeRow(gradeRow, course.title, detail?.instructors ?? []), bands)
      : { kind: 'none' as const };

  const rows = detail?.sections?.sections ?? [];
  /** Sections a student may not be allowed to register for. 42% of Illinois's are. */
  const restricted = rows.filter((row) => sectionIsRestricted(row.availability)).length;
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
      {!loading && (detail?.course?.description || course.description) && (
        <p className="course-description">{detail?.course?.description || course.description}</p>
      )}
      {!loading && isIllinois && detail && !detail.course?.description && (
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
        {isUga && course.prerequisiteText && <p>{course.prerequisiteText}</p>}
        {isUga && !course.prerequisiteText && (
          <p className="quiet">The UGA Bulletin lists no prerequisite sentence for this course.</p>
        )}
        {isIllinois && !core?.prereqs && <p className="quiet">Prerequisites have not loaded.</p>}
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
        {isIllinois && core?.prereqs && !spec && (
          <p className="quiet">
            The catalog page for this course lists nothing that has to come first. Read the
            description above as well, in case it names one.
          </p>
        )}
        {isIllinois && spec && (
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
        {isUga ? (
          <p className="quiet">Grade and instructor history is not loaded for UGA in this prototype.</p>
        ) : grade.kind === 'none' ? (
          /* Still the honest line where there is no row anywhere, and it waits
             for the shard: a course whose numbers are filed under its other
             code has none of them until the catalog row naming that code has
             loaded, and saying so in the meantime would be wrong for a second. */
          <p className="quiet">
            {loading
              ? 'Reading the grade history.'
              : elsewhere
                ? 'This class is taught under more than one code, and Illinois filed its grade history under one of the others. The numbers are not published under this code.'
                : 'No grade history is published for this course.'}
          </p>
        ) : (
          <>
            <p>
              {grade.placed ? BAND_WORD[grade.band] : HELD_BACK}. Average GPA{' '}
              {grade.gpa ?? 'not published'}
              {grade.aPct !== null && `, ${grade.aPct}% A grades`}
              {grade.withdrawPct !== null && `, ${grade.withdrawPct}% withdrew`}.
            </p>
            {twin && (
              <p className="quiet">
                Illinois filed those grades under {twin.code}. It is this same class under its
                other code.
              </p>
            )}
            <p className="quiet">
              {grade.n.toLocaleString()} {plural(grade.n, 'student')} across {grade.sections}{' '}
              {plural(grade.sections, 'section')}.
              {grade.thin && ` Fewer than ${THIN_SAMPLE} students, so read it loosely.`}
            </p>
            {detail?.instructors && detail.instructors.length > 0 && gradeRow && (
              <p className="quiet">
                {visibleInstructors(
                  toGradeRow(gradeRow, course.title, detail.instructors),
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
        {isUga && (
          <>
            <p>
              {course.offeringKnown
                ? `Catalog pattern: ${course.offeredIn.join(' and ')}.`
                : 'A specific offering pattern was not verified in this snapshot.'}
            </p>
            <p className="quiet">
              Live sections, meeting times, rooms, instructors, and open seats are not loaded for UGA yet.
            </p>
          </>
        )}
        {isIllinois && !core?.sections && <p className="quiet">The schedule has not loaded.</p>}
        {isIllinois && core?.sections && !sections && (
          <p className="quiet">
            {term ? `No ${term.label} section has been read for this course.` : 'No sections read.'}
          </p>
        )}
        {isIllinois && sections && (
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
                {/* Listing a section a student cannot register for, with no
                    mark on it, is the same as telling them they can have it. */}
                {sectionIsRestricted(row.availability) && (
                  <span className="section-restricted"> Restricted</span>
                )}
              </p>
            ))}
            {rows.length > 5 && (
              <p className="quiet">
                And {rows.length - 5} more {plural(rows.length - 5, 'section')}.
              </p>
            )}
            {restricted > 0 && (
              <p className="quiet">
                {restricted === rows.length
                  ? 'Every section is marked restricted on the schedule, so not everyone can register.'
                  : `${restricted} of the ${rows.length} sections ${
                      restricted === 1 ? 'is' : 'are'
                    } marked restricted on the schedule, so not everyone can register for ${
                      restricted === 1 ? 'it' : 'them'
                    }.`}{' '}
                {/* Illinois writes the restriction into the date cell for some
                    sections and publishes nothing for the rest. Guessing at the
                    rest would be inventing a rule the university never wrote. */}
                {sections.restrictions.length > 0
                  ? `Illinois says: ${sections.restrictions.slice(0, 2).join(' ')}`
                  : 'Illinois does not say who the restriction is for. Check the section on the schedule page before you plan around it.'}
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
