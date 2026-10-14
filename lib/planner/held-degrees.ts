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

/**
 * Held from Family 4 alone (2026-10-08): "header then lists" ("18 hours from
 * the lists below" over several lists, one pool), "choose one field, track or
 * option" (one of them), and the smaller readings that came with it
 * (illinois-data.ts headedLists, fieldChoice, oneListOf, areaHeadingCount,
 * carriedHeader, hoursFromRowsOrLevel, SAMPLE_AREA). These degrees keep the
 * Families 0-3 reading until their boards pass the three-level gate on the
 * new one, at both starts and with the extra students. Each id says the first
 * board that did not pass.
 *
 * "Worse across the sweep": the board meets the same real requirements on
 * the new reading and is worse on a shape measure whose sweep-wide total is
 * worse too, so the gate sends it back for engine work. Most are boards that
 * booked every course of every list before (all fourteen Psychology breadth
 * courses where the page asks for three) and now book what the page asks,
 * with the freed hours shaped a little worse. The ten Psychology
 * concentrations' breadth groups were checked against the live catalog
 * pages on 2026-10-08 and read correctly; they wait for the engine work only.
 */
export const HEADER_LISTS_HELD = new Set<string>([
  'ahs/speech-hearing-science-bs', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'engineering/aerospace-engineering-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'engineering/engineering-mechanics-bs', // Fall 2026 start, no goal, 2 language semesters: blocked (TAM 252 a term after its lecture TAM 251, a sequence a term apart)
  'engineering/industrial-engineering-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, three hardest courses in one term)
  'engineering/neural-engineering-bs', // Spring 2027 start, no goal, 2 language semesters: engine work (same requirements met, a prerequisite to check, worse across the sweep)
  'engineering/physics-bs', // Spring 2027 start, no goal, 2 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'faa/fine-applied-arts-ba', // Fall 2026 start, pre-med, 2 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'las/african-american-studies-balas', // Fall 2026 start, pre-med, 2 language semesters: engine work (same requirements met, a pre-med/PT course late or off with room for it)
  'las/anthropology-balas', // Fall 2026 start, pre-med, 2 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'las/art-history-balas', // Fall 2026 start, no goal, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/communication-balas', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/earth-society-environmental-sustainability-bslas/society-the-environment', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'las/environmental-sustainability-bslas', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, the first math course later, worse across the sweep)
  'las/environmental-sustainability-bslas/science-of-the-earth-system', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'las/integrative-biology-bslas', // Fall 2026 start, pre-med, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, the first math course later, worse across the sweep)
  'las/psychology-bslas/behavioral-neuroscience', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/psychology-bslas/clinical-community-psychology', // Fall 2026 start, pre-PT, 2 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'las/psychology-bslas/cognitive-neuroscience', // Fall 2026 start, pre-PT, 2 language semesters: engine work (same requirements met, the first math course later, a momentum flag, worse across the sweep)
  'las/psychology-bslas/cognitive-psychology', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/psychology-bslas/developmental-psychology', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/psychology-bslas/diversity-science', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/psychology-bslas/intradisciplinary-psychology', // Fall 2026 start, pre-med, 2 language semesters: engine work (same requirements met, the first math course later, worse across the sweep)
  'las/psychology-bslas/organizational-psychology', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/psychology-bslas/personality-psychology', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/psychology-bslas/social-psychology', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'media/media-cinema-studies-bs', // Fall 2026 start, pre-PT, 2 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
]);

/**
 * Held from Family 4b alone (2026-10-08): degrees whose hand-written reading
 * (hand-readings.ts), checked against the live catalog page, is kept off
 * until their boards pass the three-level gate on it, at both starts and
 * with the extra students. Each id says the first board that did not pass.
 * Civic Leadership's reading waits on READ_AS_RELEASED above instead.
 */
export const HAND_READINGS_HELD = new Set<string>([
  'engineering/civil-engineering-bs', // Fall 2026 start, pre-PT, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'engineering/materials-science-engineering-bs', // extra students, a pre-vet freshman: engine work (more requirements met, but credits past the total it did not need and a pre-vet course off with room for it); every board also leaves MSE 404, MSE 494 and MSE 495 off, MSE 206 landing in Spring 2029 and the design chain running out of terms
  'las/political-science-balas/international-relations', // Fall 2026 start, pre-PT, 4 language semesters: engine work (same requirements met, the first math course later, worse across the sweep)
  'las/political-science-balas/law-power', // Fall 2026 start, pre-PT, 2 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
]);

/**
 * Held from the select-line readings of 2026-10-13 (w9-readings), found by
 * the official Sample Sequences yardstick (scripts/dev/sweep/compare-sample.mjs):
 * a table under one "Select four of the following:" read as that many of its
 * rows, not all of them; a "Select one of the following:" line inside a table
 * of required rows read as a choice among the rows under it, not among the
 * whole table (also on degrees read as released, whose comment rows are
 * otherwise left unread); an "OR" inside such a choice; a stacked
 * "Communications Requirement (3 hours)" over "Select from the following:";
 * and a level rule read from its own comment row ("11 additional hours of
 * economics at the 300- or 400-level", not the "Mathematics:" row after it).
 * These degrees keep the reading they had until their boards pass the
 * three-level gate on the new one, at both starts. Each id says the first
 * board that did not pass.
 */
export const SELECT_LINES_HELD = new Set<string>([
  'aces/agricultural-leadership-education-communications-bs/agricultural-communications', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'aces/animal-sciences-bs/food-animal-production-management', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a prerequisite to check, worse across the sweep)
  'aces/animal-sciences-bs/science-pre-veterinary--medical', // Fall 2026 start, pre-PT, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'aces/engineering-technology-management-agricultural-systems-bs/construction-management', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'aces/engineering-technology-management-agricultural-systems-bs/digital-precision-agriculture', // Fall 2026 start, pre-PT, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'aces/natural-resources-environmental-sciences-bs/ecosystem-stewardship-restoration-ecology', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'aces/natural-resources-environmental-sciences-bs/environmental-science-management', // Spring 2027 start, pre-PT, 4 language semesters: blocked (an error, a course before its prerequisite, a lab apart from its lecture or a finish after the target)
  'aces/natural-resources-environmental-sciences-bs/environmental-social-sciences', // Fall 2026 start, pre-med, 4 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'aces/natural-resources-environmental-sciences-bs/fish-wildlife-conservation-biology', // Fall 2026 start, pre-med, 4 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'bus/accountancy-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'bus/finance-data-science-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (same requirements met, a pre-med/PT course late or off)
  'education/middle-grades-education-bs/science', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'engineering/computer-science-bioengineering-bs', // Fall 2026 start, pre-med, 2 language semesters: blocked (an error, a course before its prerequisite, a lab apart from its lecture or a finish after the target)
  'engineering/computer-science-physics-bs', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'engineering/electrical-engineering-bs', // Spring 2027 start, pre-med, 4 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'faa/art-art-history-bfa', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'faa/industrial-design-bfa', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/fashion', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/illustration', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/painting', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/photography', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/printmaking', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'faa/studio-art-bfasa/sculpture', // Fall 2026 start, pre-med, 4 language semesters: engine work (more requirements met, but a pre-med/PT course late or off with room for it)
  'las/anthropology-balas/biological-anthropology', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, a momentum flag, worse across the sweep)
  'las/chemistry-bslas', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/communication-balas', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/econometrics-quantitative-economics-bslas', // Fall 2026 start, pre-med, 2 language semesters: engine work (more requirements met, but credits past the total it did not need, a pre-med/PT course late or off with room for it)
  'las/geography-geographic-information-science-balas/human-geography', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/geography-geographic-information-science-bslas/geographic-information-science', // Spring 2027 start, pre-med, 4 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'las/geography-geographic-information-science-bslas/physical-geography', // Fall 2026 start, pre-med, 2 language semesters: engine work (same requirements met, credits past the total)
  'las/geology-bs/geophysics', // Fall 2026 start, pre-PT, 2 language semesters: engine work (same requirements met, credits past the total, under 21 hours at the 300 level)
  'las/history-balas/history-teaching', // Fall 2026 start, pre-PT, 4 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'las/latina-latino-studies-balas', // Spring 2027 start, pre-med, 4 language semesters: engine work (same requirements met, a year-one term under 15 hours, a momentum flag, worse across the sweep)
  'las/linguistics-balas', // Spring 2027 start, pre-PT, 2 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
  'las/slavic-studies-balas/polish-studies', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'las/slavic-studies-balas/ukranian-studies', // Fall 2026 start, no goal, 2 language semesters: engine work (same requirements met, a year-one term under 15 hours, worse across the sweep)
  'media/journalism-bs', // Fall 2026 start, pre-med, 4 language semesters: engine work (same requirements met, a pre-med/PT course late or off)
  'media/media-cinema-studies-bs', // Spring 2027 start, pre-med, 4 language semesters: engine work (same requirements met, a momentum flag, worse across the sweep)
]);
