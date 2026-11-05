/**
 * Whether the difficulty estimates from student ratings of the instructors
 * who teach a course reach the plans the planner builds.
 *
 * UGA publishes no grade history, so every UGA difficulty is such an
 * estimate (uga-difficulty.ts, public/uga/course-difficulty.json); Illinois
 * has grade history and estimates only the 499 courses that lack it
 * (public/illinois/course-difficulty-ratings.json). Fed straight into the
 * engine on 2026-11-04 they made 129 UGA harness boards meet fewer
 * requirements: every board the engine weighs a new one against was built
 * with the estimates too, so nothing held the new board to the old one.
 *
 * Since 2026-11-05 they reach plans only through autoplan.ts
 * difficultyGated, whose floor is the board built without them (the board
 * the planner built before), and which keeps a board built with them only
 * where it loses the student no required course, no requirement, no term
 * and no warning against that floor. These stay as kill switches: false
 * builds every plan exactly as before the estimates existed.
 *
 * In lib/ rather than in the sources so the node harnesses can read them.
 */
export const UGA_DIFFICULTY_IN_PLANS = true;
export const ILLINOIS_RATINGS_IN_PLANS = true;

/**
 * Whether student ratings of the instructors who teach a course reach the
 * "Highly rated teaching" priority (course-teaching.ts): at UGA, which has
 * no list of excellent teachers, for every course; at Illinois only where
 * the Teachers Ranked as Excellent list is silent. Like the difficulty
 * estimates they reach plans only through difficultyGated, whose floor is
 * built without them (floorContextOf). False reads teaching as before.
 */
export const UGA_TEACHING_IN_PLANS = true;
export const ILLINOIS_TEACHING_RATINGS_IN_PLANS = true;
