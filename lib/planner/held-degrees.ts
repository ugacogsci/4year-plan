/**
 * The per-degree hold of the Illinois fix plan (Families 2 and 3,
 * 2026-10-06).
 *
 * The fix branch reads option lists inside degree tables as choices and
 * plans with engine fixes for what that reading asks; a board it builds is
 * kept only where the owner's three-level rule accepts it against the
 * illinois-fixes release (scripts/dev/sweep/gate.mjs). Where a degree's
 * board, at either start (Fall 2026, Spring 2027), with any goal (none,
 * pre-med, pre-PT) and either language start, would be blocked or sent back
 * for engine work, the degree is held here until it passes:
 *
 *   - READ_AS_RELEASED: the degree page is read as the release read it
 *     (illinois-data.ts adaptIllinoisPrograms: no option lists split out of
 *     a table, no "one of N tracks" or "within or across" reading, the gen
 *     ed headings found as before). Its boards keep the engine's fixes.
 *   - PLANNED_AS_RELEASED: also planned by the release's engine
 *     (autoplan-release.ts), for a degree whose boards the engine's fixes
 *     alone would leave blocked or for engine work on the release's
 *     reading. Its boards are the release's boards.
 *
 * Each id says why it is held (the start, goal and language of the first
 * board that did not pass). A degree leaves the list once its boards pass
 * on the new reading; autoplan-release.ts goes with the last one planned
 * by it.
 */

/** Read as the illinois-fixes release read them. */
export const READ_AS_RELEASED = new Set<string>([
  'aces/agricultural-consumer-economics-bs', // extra students, a transfer with 60 hours: blocked (meets fewer of the degree's real requirements)
  'aces/agricultural-consumer-economics-bs/agri-accounting', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/environmental-economics-policy', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/farm-management', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/finance-agribusiness', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/financial-planning', // Fall 2026 start, pre-med, 4 language semesters: engine work (credits past the total it did not need, a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-leadership-education-communications-bs/organizational-community-leadership', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'aces/dietetics-nutrition-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'aces/engineering-technology-management-agricultural-systems-bs/digital-precision-agriculture', // Fall 2026 start, pre-med, 2 language semesters: engine work (credits past the total it did not need); on the release reading too
  'aces/financial-planning-bs', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'aces/food-science-bs', // Fall 2026 start, pre-med, 4 language semesters: engine work (credits past the total it did not need, three hardest courses in one term)
  'aces/nutrition-health-bs', // Fall 2026 start, pre-PT, 4 language semesters: engine work (credits past the total it did not need)
  'aces/public-policy-law-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'aces/sustainability-food-environmental-systems-bs', // Spring 2027 start, pre-PT, 2 language semesters: engine work (under 21 hours at the 300 level)
  'bus/accountancy-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'education/computer-science-education-bs/learning-sciences', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'education/computer-science-education-bs/secondary-education', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'education/secondary-education-bs/mathematics', // Spring 2027 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'education/special-education-bs', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it); extra students, a pre-pharmacy student: engine work (a pre-med/PT course late or off with room for it)
  'engineering/computer-engineering-bs', // Fall 2026 start, pre-med, 2 language semesters: blocked (a course before its prerequisite, a pre-med/PT course late or off with room for it); on the release reading too
  'engineering/mechanical-engineering-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'faa/architectural-studies-bs', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'faa/art-art-history-bfa', // Fall 2026 start, pre-med, 2 language semesters: engine work (credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'faa/industrial-design-bfa', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/fashion', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/illustration', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/painting', // Spring 2027 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/photography', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/printmaking', // Spring 2027 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/sculpture', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'faa/theatre-bfa/lighting-design-technology', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it)
  'las/actuarial-science-bslas', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'las/chemistry-bs/environmental-chemistry', // extra students, a pre-med student with AP credit: blocked (a course before its prerequisite)
  'las/geology-bslas', // Spring 2027 start, pre-med, 2 language semesters: engine work (credits past the total it did not need)
  'las/integrative-biology-bslas/honors', // Spring 2027 start, no goal, 4 language semesters: blocked (a lab apart from its lecture)
  'las/political-science-balas/civic-leadership', // Spring 2027 start, pre-PT, 2 language semesters: engine work (credits past the total it did not need)
  'las/sociology-balas', // extra students, a pre-PT transfer with 60 hours: engine work (a pre-med/PT course late or off with room for it)
  'socw/social-work-bsw', // extra students, a pre-med sophomore: engine work (a pre-med/PT course late or off with room for it)
]);

/** Planned by the illinois-fixes release's engine as well (autoplan-release.ts). */
export const PLANNED_AS_RELEASED = new Set<string>([
  'aces/agricultural-consumer-economics-bs', // extra students, a transfer with 60 hours: blocked (meets fewer of the degree's real requirements)
  'aces/agricultural-consumer-economics-bs/agri-accounting', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/environmental-economics-policy', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/farm-management', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/finance-agribusiness', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'aces/agricultural-consumer-economics-bs/financial-planning', // Fall 2026 start, pre-med, 4 language semesters: engine work (credits past the total it did not need, a pre-med/PT course late or off with room for it); on the release reading too
  'aces/engineering-technology-management-agricultural-systems-bs/digital-precision-agriculture', // Fall 2026 start, pre-med, 2 language semesters: engine work (credits past the total it did not need); on the release reading too
  'education/secondary-education-bs/mathematics', // Spring 2027 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'education/special-education-bs', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it); extra students, a pre-pharmacy student: engine work (a pre-med/PT course late or off with room for it)
  'engineering/computer-engineering-bs', // Fall 2026 start, pre-med, 2 language semesters: blocked (a course before its prerequisite, a pre-med/PT course late or off with room for it); on the release reading too
  'engineering/mechanical-engineering-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'faa/architectural-studies-bs', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'las/actuarial-science-bslas', // Fall 2026 start, pre-med, 4 language semesters: engine work (a pre-med/PT course late or off with room for it); on the release reading too
  'las/chemistry-bs/environmental-chemistry', // extra students, a pre-med student with AP credit: blocked (a course before its prerequisite)
  'las/sociology-balas', // extra students, a pre-PT transfer with 60 hours: engine work (a pre-med/PT course late or off with room for it)
  'socw/social-work-bsw', // extra students, a pre-med sophomore: engine work (a pre-med/PT course late or off with room for it)
]);
