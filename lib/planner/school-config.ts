/**
 * Which engine plans a school, and what a CourseLeaf school switches on.
 *
 * ORION has two planning engines. UGA has its own (uga-*.ts, the UGA audit).
 * Illinois and Georgia Tech share the "CourseLeaf engine": the Illinois
 * adapters in illinois-data.ts, the loader in illinois-load.ts and the
 * plan-build worker, because both catalogs are CourseLeaf sites with the same
 * requirement tables. Names like `illinois-data.ts` and `useIllinoisCore`
 * mean "the CourseLeaf engine", not "Illinois only".
 *
 * What is really Illinois-only (its campus gen-ed table, the language
 * requirement, college rules like Grainger's, minors, graduate programs,
 * clubs, syllabi, ratings, the career matcher's course vectors) is switched
 * per school here, so a Georgia Tech board never inherits an Illinois rule.
 *
 * This module imports nothing, so every layer (scripts, the worker, React,
 * API routes) can use it without cycles.
 */

export type SchoolKey = 'uga' | 'illinois' | 'gatech';
export type CourseleafId = 'illinois' | 'gatech';
export type Engine = 'uga' | 'courseleaf';

export interface CourseleafSchool {
  id: CourseleafId;
  /** Where build-index writes the slim artifacts the browser loads, e.g. '/gatech'. */
  base: string;
  /** Prefix of the raw crawl files in public/, e.g. 'gatech' for public/gatech-catalog.json. */
  rawPrefix: string;
  /** Digits in a course number: Illinois 'CS 225' has 3, Georgia Tech 'CS 1331' has 4. */
  numberDigits: 3 | 4;
  /** Numbers may end in a letter (Georgia Tech 'CHEM 1211K'). */
  letterSuffix: boolean;
  /** Lowest course number that is graduate level (Illinois 500, Georgia Tech 6000). */
  graduateFrom: number;
  /**
   * Between a row's alternatives ("CS 3750 or CS 3751"), the planner takes
   * one that has run in a season the board holds before one whose crawled
   * offering history (offerings.json) has it only in seasons the board lacks.
   * Georgia Tech's CS 3750 has run in one summer of nine terms and CS 3751 in
   * every fall and spring; taking CS 3750 left the People thread unplaced on
   * twelve boards with no summer. Off for Illinois, whose boards stay exactly
   * as they were (autoplan.ts seasonless; UGA keeps its Bulletin reading).
   */
  seasonAwareChoices: boolean;
  /**
   * Each course counts toward one requirement of the degree. Georgia Tech's
   * area hours add up to the degree total only that way: Architecture's 6
   * hours of Any HUM are not the ARCH 2111 and 2112 its Field of Study and
   * Major Requirements already require, and an AP student's MATH 1552 is
   * Mathematics and Quantitative Skills, not also a Technical Elective. So a
   * list leaves a row's required course to the row, a row with alternatives
   * takes one no other requirement has, and held credit counts once
   * (autoplan.ts, the requirement loop). The board's rail already counts this
   * way (illinois-progress.ts). Off for Illinois, where a major course may
   * also meet a general education category.
   */
  countOnce: boolean;
  /**
   * A lecture and its lab the page prints as one row of a list ("BIOS 1107
   * Principles of Biology I and Principles of Biology I Laboratory", 4) are
   * worth the row's hours in that list, the lab's included: on the plan, so
   * Lab Science's 8 hours are two such rows, and on the rail
   * (live-pools.ts, illinois-progress.ts), where the labs fell to Free
   * Electives and Lab Science read 6 of 8.
   */
  pairHours: boolean;
  /**
   * A list whose heading names a level ("Biology Electives 3000-level or
   * higher", "ME 3000-level Electives") holds only courses at that level or
   * above, whatever the crawled list printed under it (illinois-data.ts).
   * Georgia Tech's crawl lists every BIOS course under Biology's heading.
   */
  listLevelFromHeading: boolean;
  /**
   * A row headed "Free Electives" takes any spare course on the rail, even
   * inside a concentration's area, and with no level of its own it is the
   * hours that reach the degree total, as the page prints it
   * (illinois-progress.ts): Finance's Free Electives sit under "Finance
   * Concentration", and read 7 of 10 with the board at the degree total
   * because only business courses counted.
   */
  freeElectivesAnySubject: boolean;
  /**
   * A language list whose footnote holds it to one language ("Students must
   * complete twelve credit hours of the same language") books one language's
   * courses and counts only one language's on the rail (illinois-data.ts
   * inOneLanguage, a single-list constraint sized in hours).
   */
  oneLanguageLists: boolean;
  /**
   * A first-year in their first semester with none of its classes entered
   * gets that semester planned as the board's first term (autoplan.ts
   * withEmptyCurrentTermPlanned), with the courses the degree starts with,
   * in place of about 15 credits of nothing in particular: those left seven
   * terms for every required course, and a third of Georgia Tech's degrees
   * could not finish (2026-11-09 browser test).
   */
  planEmptyCurrentTerm: boolean;
  /**
   * The open picks read the catalog and the goal (autoplan.ts openPickMisfit,
   * closenessKey). In a long list across departments (Georgia Tech's Any HUM
   * and Any SS, each about 195 courses) the courses closest to the student's
   * career goal by meaning go first (career-embedding.ts CareerFit.closeness),
   * where before the alphabet decided: every Georgia Tech board took ARBC
   * 1501, CP 2020 and CP 2233 whatever the goal. A course for heritage
   * learners (index.json `audience`, or its title) and a learning-support
   * course numbered below 1000 go last on any list and are no free elective;
   * on a long list so do a second part ("Elementary Chinese II") whose first
   * part the board lacks and a world language's course past its first
   * semester for a student with none of that language. A course for
   * first-year students (`audience` 'first-year': CS 1100) is a first-term
   * course (firstTermCourse). And of a row's sets (resolveBundles), the one
   * whose courses have run lately: CS Junior Design's CS 3311 and LMC 3432
   * last ran in Fall 2024. Off for Illinois, whose boards stay exactly as
   * they were.
   *
   * With it, autoplan.ts also: places a list pick or free elective in the
   * season it runs in, where it seldom runs in the other (seldomSeason);
   * with no goal, orders Any HUM and Any SS by how often a course runs, not
   * the alphabet; books an Ethics course in the core lists where the page
   * asks for one and nothing else gives it; takes a list's courses big
   * enough to reach its hours in its count ("Choose two", eight hours);
   * leaves a met "select N" row's other courses out of the free electives;
   * and rounds the free electives to the degree total (choose's toTotal,
   * no landThreeHour).
   */
  openPicks: boolean;
  /**
   * A prerequisite group ("ME 3180 or ME 4315") counts as covered by a
   * course the board books only where that course can come before the one
   * asking for it on this board, by its own chain and the seasons it runs
   * in (autoplan.ts the closure, cannotPrecede). Where it cannot, the
   * closure books an alternative that can. Mechanical Engineering's ME 4182
   * read its group as met by the concentration's ME 4315, which needs ME
   * 3345 and so lands in the last term, and ME 4182 never fit; ME 3180 needs
   * only ME 2110 and COE 3001. Nuclear Engineering's NRE 4351 leaned on NRE
   * 4214, a fall course its chain pushes past the board, where NRE 4328
   * fits (2026-11-09). Off for Illinois, whose boards stay as they were.
   */
  feasibleRoutes: boolean;
  /**
   * A row of hours at a level ("Free Electives (2000-level or higher)", 9)
   * is met course by course, as the rail counts it, not by the degree total:
   * the footnote's lower courses count toward the hours it allows them
   * (illinois-data.ts levelAllowanceIn: "four of these 9 credit hours may be
   * satisfied with ... BIOS 1107 / BIOS 1107L"), the rail fills the highest
   * level's row first and a list sized in hours with the board's courses
   * that fill it with the fewest hours past it (illinois-progress.ts), and
   * the elective fill keeps
   * booking courses at that level past the total while the row is short
   * (autoplan.ts levelOwed). A ten-exam student's held 1000-level courses
   * reached Nuclear Engineering's 126 hours with that row at 4 of 9
   * (2026-11-09). Off for Illinois, whose boards stay as they were.
   */
  levelRowsExact: boolean;
  /**
   * A row of hours whose own words name the subject of its courses ("AE
   * Options: AE courses from list supplied by School", 6) counts courses of
   * that subject only (illinois-data.ts subjectsNamedIn): the rail counted
   * MATH 3012 there as a stand-in, and the elective fill books courses of
   * that subject for it while it is short (autoplan.ts levelOwed). Off for
   * Illinois, whose boards stay as they were.
   */
  openRowSubjects: boolean;

  // What this school's data supports. Off means the feature is hidden, never faked.
  campusGenEd: boolean;
  languageRule: boolean;
  collegeRules: boolean;
  momentumReview: boolean;
  minors: boolean;
  graduate: boolean;
  clubs: boolean;
  syllabi: boolean;
  ratings: boolean;
  /**
   * Past grades per course (Illinois grades.json). Off, no course can be
   * weighed for workload: the review list does not add "Some courses could
   * not be weighed" to every term (autoplan.ts validatePlan), and Preferences
   * hides the workload and teaching knobs with ratings off too.
   */
  gradeData: boolean;
  /**
   * Published class sections: times, rooms, formats, instructors. Off, the
   * board offers no instructor picker (unless syllabi name instructors) and
   * Preferences no time-of-day or format filter, since nothing could meet them.
   */
  sections: boolean;
  /** What the school calls a student's ID, the advisor packet's blank to fill in. */
  studentIdName: string;
  /**
   * The note on degree-page course lines printed with blank credit hours
   * (build-index's "N of M program course rows have no credits"). Illinois
   * leaves a third of its lines blank, which can make a total come out low;
   * Georgia Tech leaves under 1%, and the note only read as a statistic.
   */
  blankHoursNote: boolean;
  /**
   * The course map's popup prints the course's catalog description, read
   * from its subject's shard (index.json carries none). Its "Course details"
   * prerequisite line says "read the description above", and at Georgia Tech
   * there was none above. Off for Illinois, whose popup stays as it was.
   */
  popupDescription: boolean;
  /**
   * The hours a build assumes for a term in progress with no classes entered
   * (about 15 for an empty Fall 2026, plan-start.ts horizonFor) count on the
   * board the way they counted when the build placed courses: the review's
   * standing check (Georgia Tech's CS 4723 read "75 before Spring 2029" when
   * placing it had counted 90), and a note's "the N hours you bring" names
   * them apart from credit held ("the 9 hours you bring and about 15 counted
   * for Fall 2026", not "the 24 hours you bring"). planner-workspace.tsx.
   * Off for Illinois, whose board reads as it did.
   */
  countAssumedHours: boolean;
  /**
   * Plainer wording for what the planner says at this school
   * (planner-workspace.tsx): a standing read from a course's title says the
   * title suggests it, not that the course "needs" a standing the catalog
   * does not state; the advisor packet leaves out a placement-score note for
   * a course whose prerequisite a held or earlier course already meets
   * (MATH 1554 after AP credit for MATH 1551); a setup goal loses a stray
   * "Started." left by a start date; and TOWER's board text names year one
   * and asks for tools by what they did, not by name. Off for Illinois.
   */
  plainNotes: boolean;
  /**
   * TOWER's replace_course and move_course check the board's rail before
   * the change is applied (illinoisProgressGuard, the check the card's own
   * swap menu already runs, illinois-progress.ts with live-pools.ts): a
   * change that takes a requirement row backward is refused with the row's
   * name, as UGA's audit refuses one (planner-workspace.tsx). Off for
   * Illinois, whose TOWER edits stay as they were.
   */
  towerProgressCheck: boolean;
  /**
   * "N credit hours are open on the catalog page" (a row of hours the page
   * names no course for) is said only while the board's rail shows that row
   * short. Once the board books its hours, the review row names the courses
   * standing in for them and sends the student to an advisor, and a Free
   * Electives row says nothing (planner-workspace.tsx). Off for Illinois.
   */
  openHoursFollowBoard: boolean;
  /**
   * A board its settings cannot finish tries the fixes as soon as it is
   * shown, smallest first and stopping at the first that works (the same
   * quick pass TOWER's board read runs), so the bar says what fixes it
   * ("Adding Summer 2027 fits everything") without a press; and where the
   * student holds no exam credit, one build with the exam credit for the
   * first courses of the stuck class's prerequisite chain says whether that
   * credit would let it fit (planner-workspace.tsx). Off for Illinois, where
   * "Find a fix" tries them on a press, as before.
   */
  fixesOnOpen: boolean;
  /**
   * A course's popup reads offerings.json's `notYetOffered` (a course with
   * no section in any crawled term whose catalog record begins inside them)
   * and says "New course, not offered yet" where it said "Has not run in
   * any term" (course-detail.tsx): AECT 3100, 3400, 3500, 4000 and 4500 of
   * Georgia Tech's newest degree. Off for Illinois, whose build writes no
   * such field and whose popup stays as it was.
   */
  newCourses: boolean;
  /**
   * The setup assistant's reply, where exams with scores are already entered
   * under "Add prior credit": a sentence sending the student to add exams or
   * scores there ("This chat can't record exam scores, so please add your AP
   * Chemistry 5 under ...", with that exam already filled in) says which
   * are entered instead, and is saved that way in the conversation TOWER
   * shows on the board (guided-setup.tsx, 2026-11-09 browser QA). Off for
   * Illinois, whose setup replies stay as they were.
   */
  setupSaysExamsEntered: boolean;
  /**
   * The start note says "registration for Fall 2026 has closed" where it
   * said "adding Fall 2026 classes has closed", beside the board's own "Add
   * them in the Fall 2026 column" (plan-start.ts). Off for Illinois.
   */
  registrationWording: boolean;
  careerVectors: boolean;
  careerTracks: boolean;
  transferAi: boolean;
  transferGenEdGuide: boolean;

  /** Hours that must be taken at the school, overall and upper level; null when not modelled. */
  residency: { hours: number; upperLevel: number } | null;
  /** The degree total to assume when a program page does not state one; null to use the page's own. */
  defaultDegreeTotal: number | null;
  /** Recognises the school's own name on a transcript. */
  home: RegExp;
  /** The campus time zone, for "today" and registration dates. */
  timeZone: string;
}

const COURSELEAF: Record<CourseleafId, CourseleafSchool> = {
  illinois: {
    id: 'illinois',
    base: '/illinois',
    rawPrefix: 'illinois',
    numberDigits: 3,
    letterSuffix: false,
    graduateFrom: 500,
    seasonAwareChoices: false,
    countOnce: false,
    pairHours: false,
    listLevelFromHeading: false,
    freeElectivesAnySubject: false,
    oneLanguageLists: false,
    planEmptyCurrentTerm: false,
    openPicks: false,
    feasibleRoutes: false,
    levelRowsExact: false,
    openRowSubjects: false,
    campusGenEd: true,
    languageRule: true,
    collegeRules: true,
    momentumReview: true,
    minors: true,
    graduate: true,
    clubs: true,
    syllabi: true,
    ratings: true,
    gradeData: true,
    sections: true,
    studentIdName: 'NetID',
    blankHoursNote: true,
    popupDescription: false,
    countAssumedHours: false,
    plainNotes: false,
    towerProgressCheck: false,
    openHoursFollowBoard: false,
    fixesOnOpen: false,
    newCourses: false,
    setupSaysExamsEntered: false,
    registrationWording: false,
    careerVectors: true,
    careerTracks: true,
    transferAi: true,
    transferGenEdGuide: true,
    residency: { hours: 45, upperLevel: 21 },
    defaultDegreeTotal: 120,
    home: /university of illinois|\buiuc\b|urbana[- ]champaign/i,
    timeZone: 'America/Chicago',
  },
  gatech: {
    id: 'gatech',
    base: '/gatech',
    rawPrefix: 'gatech',
    numberDigits: 4,
    letterSuffix: true,
    graduateFrom: 6000,
    seasonAwareChoices: true,
    countOnce: true,
    pairHours: true,
    listLevelFromHeading: true,
    freeElectivesAnySubject: true,
    oneLanguageLists: true,
    planEmptyCurrentTerm: true,
    openPicks: true,
    feasibleRoutes: true,
    levelRowsExact: true,
    openRowSubjects: true,
    campusGenEd: false,
    languageRule: false,
    collegeRules: false,
    momentumReview: false,
    minors: false,
    graduate: false,
    clubs: false,
    syllabi: false,
    ratings: false,
    gradeData: false,
    sections: false,
    studentIdName: 'GTID',
    blankHoursNote: false,
    popupDescription: true,
    countAssumedHours: true,
    plainNotes: true,
    towerProgressCheck: true,
    openHoursFollowBoard: true,
    fixesOnOpen: true,
    newCourses: true,
    setupSaysExamsEntered: true,
    registrationWording: true,
    careerVectors: true,
    careerTracks: false,
    transferAi: false,
    transferGenEdGuide: false,
    residency: null,
    defaultDegreeTotal: null,
    home: /georgia (institute of )?tech|\bgatech\b/i,
    timeZone: 'America/New_York',
  },
};

export function engineOf(id: string | null | undefined): Engine | null {
  if (id === 'uga') return 'uga';
  if (id === 'illinois' || id === 'gatech') return 'courseleaf';
  return null;
}

export function courseleafOf(id: string | null | undefined): CourseleafSchool | null {
  return id === 'illinois' || id === 'gatech' ? COURSELEAF[id] : null;
}

export function isCourseleaf(id: string | null | undefined): id is CourseleafId {
  return id === 'illinois' || id === 'gatech';
}
