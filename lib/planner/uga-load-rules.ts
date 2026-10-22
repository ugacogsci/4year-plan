/**
 * UGA's own course-load rules for undergraduates, which ARCH relays and
 * set_plan_shape answers with at UGA. Illinois's come from its colleges
 * (college-rules.ts) and are never used for a UGA board.
 *
 * Each fact was read on the page beside it on 2026-10-20, quoted as printed:
 *
 *   https://reg.uga.edu/registration/schedule-adjustments/
 *     "Undergraduate students may register for a maximum of 18 hours during
 *     the fall, spring, and summer." One limit per term, the Athena credit
 *     limit. "Students may request a change in credit limit by obtaining
 *     approval from their advisors." The page names no ceiling above that
 *     and no grade-point rule; a college's own criteria were seen only
 *     through a search excerpt, so none is stated here.
 *   https://reg.uga.edu/student-records/enrollment-verifications/
 *     Undergraduates: "12 or more hours (full-time), 9 to 11.99 hours (3/4
 *     time), 6 to 8.99 hours (half-time)"; summer: "6 or more hours
 *     (fulltime), 3 to 5.99 (halftime)". The page warns that hours required
 *     for financial aid may vary.
 *   https://osfa.uga.edu/resources/policies/enrollment-financial-aid/enrollment-status-for-financial-aid-purposes/
 *     Financial aid counts 12 hours full time and 6 half time, summer too.
 *
 * The planner's summer ceiling (9 credits, SUMMER_MAX in autoplan.ts) sits
 * under UGA's 18 and is the planner's own choice: nothing here or in ARCH's
 * words calls it a UGA rule.
 *
 * Graduate students, read on 2026-10-22. set_plan_shape used to tell a
 * graduate student that 9 credits was under full time (three-quarter time),
 * the undergraduate rule; for a graduate student 9 is full time.
 *
 *   https://reg.uga.edu/registration/schedule-adjustments/
 *     "Professional students and graduate students should refer to their
 *     respective bulletins for minimum/maximum course loads policies."
 *   https://grad.uga.edu/handbook/ (Graduate Enrollment Policy)
 *     "The maximum semester course load for any student is 18 hours per
 *     semester." "A full-time course load is nine hours per semester during
 *     the academic year and six hours during the summer semester." A student
 *     holding an assistantship registers for "a minimum of 12 hours of
 *     graduate credit during the fall and spring semesters".
 *   https://reg.uga.edu/student-records/enrollment-verifications/
 *     Graduate, fall and spring: "9 or more hours (fulltime), 7 to 8.99 (3/4
 *     time), 5 to 6.99 (halftime)".
 *   The financial aid page above: graduate hours 9 full time and 5 half time
 *     in a fall or spring term.
 *
 * No imports, so the check harnesses can load it under plain node.
 */

/** The most an undergraduate may register for in a fall, spring or summer term without a higher credit limit. */
export const UGA_MAX_TERM_HOURS = 18;
/** Full time for an undergraduate in a fall or spring term (enrollment verification and financial aid alike). */
export const UGA_FULL_TIME_HOURS = 12;
export const UGA_LOAD_PAGE = 'https://reg.uga.edu/registration/schedule-adjustments/';
export const UGA_ENROLLMENT_PAGE = 'https://reg.uga.edu/student-records/enrollment-verifications/';
export const UGA_AID_PAGE = 'https://osfa.uga.edu/resources/policies/enrollment-financial-aid/enrollment-status-for-financial-aid-purposes/';
export const UGA_RULES_READ = '2026-10-20';

/** Full time for a graduate student in a fall or spring term (the Graduate School handbook, the Registrar, financial aid alike). */
export const UGA_GRADUATE_FULL_TIME_HOURS = 9;
/** The most any graduate student may take in a semester (the Graduate School handbook). */
export const UGA_GRADUATE_MAX_TERM_HOURS = 18;
export const UGA_GRADUATE_HANDBOOK = 'https://grad.uga.edu/handbook/';

/** What set_plan_shape tells ARCH for a UGA term above 18 hours, which the planner never builds. */
export function ugaOverloadAnswer(hours: number): string {
  return `${hours} hours is more than the ${UGA_MAX_TERM_HOURS} UGA lets an undergraduate register for in a fall, spring or summer term (the Registrar, ${UGA_LOAD_PAGE}), so the planner never builds it. A student may ask for a higher credit limit: with their academic advisor's approval the Registrar raises it. That page names no ceiling above 18 and no grade-point rule, so do not give one. Bring the plan and the reason to the academic advisor.`;
}

/** The note set_plan_shape carries at UGA when a fall or spring term is allowed or aimed under 12 hours. */
export function ugaUnderloadNote(hours: number): string {
  return [
    `${hours} credits in a fall or spring term is under the ${UGA_FULL_TIME_HOURS} hours UGA's Registrar counts as full time for an undergraduate (9 to 11.99 hours is three-quarter time, 6 to 8.99 half time; ${UGA_ENROLLMENT_PAGE}).`,
    `Financial aid also counts 12 hours as full time and 6 as half time (${UGA_AID_PAGE}), and the Registrar warns that the hours financial aid requires may vary.`,
    'Say this once, and have the student check with their academic advisor and the Office of Student Financial Aid before counting on a light term.',
  ].join(' ');
}

/** What set_plan_shape tells ARCH for a UGA graduate term above 18 hours, which the planner never builds. */
export function ugaGraduateOverloadAnswer(hours: number): string {
  return `${hours} hours is more than the ${UGA_GRADUATE_MAX_TERM_HOURS} the UGA Graduate School's handbook allows any student in a semester ("The maximum semester course load for any student is 18 hours per semester", ${UGA_GRADUATE_HANDBOOK}), so the planner never builds it. The Registrar sends graduate students to the Graduate School's own rules for course loads. Have the student ask their graduate program before counting on more; never give a rule the handbook does not state.`;
}

/** The note set_plan_shape carries at UGA for a graduate plan when a fall or spring term is allowed or aimed under 9 hours. */
export function ugaGraduateUnderloadNote(hours: number): string {
  return [
    `${hours} credits in a fall or spring term is under the ${UGA_GRADUATE_FULL_TIME_HOURS} hours that are a full-time graduate load at UGA (the Graduate School handbook, ${UGA_GRADUATE_HANDBOOK}; for the Registrar's enrollment verification 7 to 8.99 hours is three-quarter time and 5 to 6.99 half time, ${UGA_ENROLLMENT_PAGE}).`,
    `Financial aid counts 9 graduate hours as full time and 5 as half time (${UGA_AID_PAGE}), and a student holding an assistantship registers for at least 12 hours of graduate credit in a fall or spring term (the handbook).`,
    'Say this once, and have the student check with their graduate program and the Office of Student Financial Aid before counting on a light term.',
  ].join(' ');
}
