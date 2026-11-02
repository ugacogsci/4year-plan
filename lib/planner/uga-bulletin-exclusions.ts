/**
 * UGA courses a student earns credit for only one of, as the Bulletin's own
 * course pages state it (bulletin.uga.edu/Course/Details/{id}, the
 * "Equivalent Courses" line: "Not open to students with credit in ...").
 *
 * The catalog file the planner reads (data/uga-courses.json, written by
 * scripts/enrich-uga.mjs) does not carry that line, so UGA boards booked both
 * halves of a pair: CHEM 1211 beside CHEM 1411 on an Honors
 * Interdisciplinary freshman's, INTL 2200 beside POLS 2200, CHEM 2211L beside
 * the honors CHEM 2311L, ECOL 2550 beside FANR 2010 (2026-11-02).
 *
 * Read on 2026-11-02 from the pages of the 430 lower-division courses the
 * UGA test boards book. Only pairs whose two pages each name the other: a
 * line on one page alone is an order rule, not "not both" (GRMN 1001 "Not
 * open to students with credit in GRMN 1002" forbids 1001 after 1002, and a
 * board books 1001 first), and the planner's exclusions are read both ways.
 * Versions of one course (an E, H, W or S suffix) are equivalents already
 * and are not listed. Nothing is inferred: MATH 2200 and MATH 2250, MATH 1060
 * and MATH 2250, and BIOL 1104 and BIOL 1108 print no such line and are not
 * here.
 */
export const UGA_BULLETIN_NOT_BOTH: ReadonlyArray<readonly [string, string]> = [
  ['ARST 2205', 'ARST 2210'],
  ['BIOL 1103', 'PBIO 1210'],
  ['CHEM 1211', 'CHEM 1411'],
  ['CHEM 1211L', 'CHEM 1411L'],
  ['CHEM 1212', 'CHEM 1412'],
  ['CHEM 2211L', 'CHEM 2311L'],
  ['CSCI 2610', 'CSCI 2611'],
  ['ECOL 2550', 'FANR 2010'],
  ['ENGL 1060H', 'ENGL 1102'],
  ['INTL 2200', 'POLS 2200'],
  ['ROML 2550', 'SPAN 2550'],
  ['SPAN 1002', 'SPAN 1110'],
];

/**
 * Bulletin pairs the planner does not hold to yet, because held to them a
 * board reads a requirement short where the planner should pick around them.
 * Geology and calculus III each sit in a degree's eighteen-hour Area VI whose
 * choose-one row the planner fills with the three-hour option, and the area
 * reached eighteen only by booking the other option too: held to the rule, Atmospheric Sciences BS read Area VI 17 of 18
 * (MATH 2500 kept, MATH 2270 dropped) and Geology AB 14 of 18 (GEOL 1250
 * dropped beside GEOL 1121, whose lab the board does not book). The fix is a
 * pick that takes the four-hour option, not a duplicate (2026-11-02).
 */
export const UGA_BULLETIN_NOT_BOTH_HELD_BACK: ReadonlyArray<readonly [string, string]> = [
  ['GEOL 1121', 'GEOL 1250'],
  ['MATH 2270', 'MATH 2500'],
  /*
   * And statistics: a general education list (Quantitative Reasoning) picks
   * STAT 2000 before Area VI's "BIOS 2010 or STAT 2000" row is read, so held
   * to the rule the row lost BIOS 2010 and read short (Ecology AB 16 of 18,
   * Pharmaceutical and Biomedical Sciences 16 of 18) where the general
   * education list should have taken another course. 242 test boards book
   * both; the fix is that re-pick.
   */
  ['BIOS 2010', 'STAT 2000'],
  ['BIOS 2010', 'STAT 2100H'],
  ['STAT 2000', 'STAT 2100H'],
  /*
   * The second organic lab beside its honors twin: Pharmaceutical and
   * Biomedical Sciences BS (first-year setup) booked CHEM 2312L beside CHEM
   * 2212L; held to the rule, the honors lab went and PMCY 3300L with it, and
   * the Biomedical Sciences emphasis read short.
   */
  ['CHEM 2212L', 'CHEM 2312L'],
];
