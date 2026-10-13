/**
 * Hand-written readings (Illinois fix plan, Family 4b; the owner's approval
 * (i) of 2026-10-06): degree pages whose tables no general reading rule can
 * read safely, read here as their live catalog pages state them.
 *
 * Each reading replaces the blocks the general rules built for some of the
 * page's areas, keeping each block's group index (so its requirement id)
 * wherever the page's row is the same row. A reading checks that the crawled
 * page still prints what it was written against (`expect`): when a recrawl
 * changes the table, the general reading stands and nothing here applies.
 * Every course a reading names comes from the page; a pool's choices are
 * the catalog's courses only (a code the catalog does not carry, PS 323, is
 * left out rather than booked as "no course data").
 *
 * What a reading cannot say it leaves to the plan's free electives and says
 * so in the block's note: "no more than two introductory courses" (a pool
 * constraint can only ask for at least N), "at least 12 hours outside
 * political science" (an hours block cannot rule out a subject), and the
 * repeat sections of MSE 404 (one catalog course).
 *
 * illinois-data.ts adaptIllinoisPrograms applies these to a degree read with
 * Family 4's readings (not held at the release's reading or in
 * HEADER_LISTS_HELD) and not in HAND_READINGS_HELD (held-degrees.ts).
 */
import type { AreaRuleBlock, AreaRules, CatalogRowLookup, CourseChoice, PoolConstraint, PoolList } from './illinois-data.ts';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

interface Tools {
  /** A catalog course as one choice, or null where the catalog has no such course. */
  choice(code: string): CourseChoice | null;
  /** The catalog's courses of a subject at these levels (100, 200, ...), less the codes given. */
  level(subject: string, levels: number[], except?: string[]): CourseChoice[];
  /** The area's block from the general reading by group index and suffix. */
  block(area: number, group: number, suffix?: string): AreaRuleBlock | undefined;
}

interface HandReading {
  /** The live page and the day it was read against it. */
  source: string;
  checked: string;
  /** Codes the general reading must still find on the page, by requirement (`area::group[::suffix]`). */
  expect: Record<string, string[]>;
  /** The blocks each area reads as, from the general reading's (`t.block`). */
  areas: Record<number, (t: Tools) => AreaRuleBlock[]>;
}

const codesIn = (b: AreaRuleBlock | undefined): string[] =>
  !b || !('choices' in b.rule) ? [] : b.rule.choices.flatMap((c) => [...c.codes, ...(c.bundles ?? []).flat()]).map(norm);

function pool(group: number, label: string, hours: number, choices: CourseChoice[], lists: PoolList[], constraints: PoolConstraint[], note: string, idSuffix?: string): AreaRuleBlock {
  return {
    groupIndex: group,
    label,
    hours,
    note,
    rows: 0,
    ...(idSuffix ? { idSuffix } : {}),
    rule: { kind: 'pool', hours, n: null, choices, lists, constraints, from: 'group', label },
  };
}
const listOf = (label: string, choices: CourseChoice[]): PoolList => ({ label, codes: choices.map((c) => c.codes[0]) });
const present = (xs: Array<CourseChoice | null>): CourseChoice[] => xs.filter((c): c is CourseChoice => c !== null);

// ---- Political Science: the four concentrations with a list rule -----------

/** Never counted toward a concentration's lists or levels (the page's Restrictions), and PS 496, the honors thesis outside the 45 hours. */
const PS_OUTSIDE = ['PS 490', 'PS 491', 'PS 492', 'PS 496'];
/** Count only toward "any level" hours, outside the General and Civic Leadership concentrations. */
const PS_ANY_LEVEL_ONLY = ['PS 191', 'PS 291', 'PS 292'];
const PS_OUTSIDE_NOTE = 'The page also asks for a second major, a minor or at least 12 hours of thematically related coursework outside political science, chosen with an advisor; the plan leaves those hours to its free electives.';

/**
 * A concentration's three hour rules: 6 hours of 100- and 200-level PS, 6
 * hours at any level (with `anyFromList` hours of them from the list), and
 * 15 hours at the 300 and 400 levels, 9 of them from the list's own 300- and
 * 400-level courses (`within`: at least one course from each named sub-list).
 */
function psHours(t: Tools, o: {
  name: string;
  list: string[];
  named: string[];
  anyFromList: boolean;
  within?: Array<{ label: string; codes: string[] }>;
  lowerExcept?: string[];
}): { lower: AreaRuleBlock; any: AreaRuleBlock | null; upper: AreaRuleBlock } {
  const list = present([...new Set(o.list)].map(t.choice));
  const upperList = list.filter((c) => Number(c.codes[0].split(' ')[1]) >= 300);
  const lower = t.level('PS', [100, 200], [...o.named, ...PS_OUTSIDE, ...(o.lowerExcept ?? PS_ANY_LEVEL_ONLY)]);
  const upper = t.level('PS', [300, 400], PS_OUTSIDE);
  const anyLevel = t.level('PS', [100, 200, 300, 400], [...o.named, ...PS_OUTSIDE]);
  const upperConstraints: PoolConstraint[] = [
    { text: `at least nine hours of which come from the ${o.name} Concentration list`, n: 3, lists: [listOf(`${o.name} Concentration list (300 and 400 level)`, upperList)], single: false },
    ...(o.within ?? []).map((w) => ({ text: `at least one course from ${w.label}`, n: 1, lists: [listOf(w.label, present(w.codes.map(t.choice)))], single: false })),
  ];
  return {
    lower: pool(0, 'Select any additional 100- or 200-level Political Science courses', 6, lower, [listOf('100- and 200-level Political Science', lower)], [], PS_OUTSIDE_NOTE, 'level'),
    any: pool(
      0,
      o.anyFromList ? `Select Political Science courses at any level, at least three hours of which come from the ${o.name} Concentration list` : 'Select any additional Political Science courses at any level',
      6,
      anyLevel,
      [listOf('Political Science, any level', anyLevel), ...(o.anyFromList ? [listOf(`${o.name} Concentration list`, list)] : [])],
      o.anyFromList ? [{ text: `at least three hours of which come from the ${o.name} Concentration list`, n: 1, lists: [listOf(`${o.name} Concentration list`, list)], single: false }] : [],
      '',
      'any',
    ),
    upper: pool(1, `Select 300- or 400-level Political Science courses, at least nine hours of which come from the ${o.name} Concentration list`, 15, upper, [listOf('300- and 400-level Political Science', upper), listOf(`${o.name} Concentration list`, upperList)], upperConstraints, ''),
  };
}

const CITIZEN_LIST = ['PS 101', 'PS 201', 'PS 202', 'PS 230', 'PS 231', 'PS 240', 'PS 241', 'PS 300', 'PS 311', 'PS 312', 'PS 314', 'PS 315', 'PS 316', 'PS 317', 'PS 318', 'PS 319', 'PS 320', 'PS 323', 'PS 328', 'PS 329', 'PS 330', 'PS 331', 'PS 357', 'PS 358', 'PS 411', 'PS 456', 'PS 494'];
const CIVIC_LIST = ['PS 201', 'PS 202', 'PS 220', 'PS 270', 'PS 300', 'PS 315', 'PS 316', 'PS 317', 'PS 321', 'PS 322', 'PS 371', 'PS 372', 'PS 373', 'PS 374', 'PS 376', 'PS 494'];
const IR_LIST = ['PS 180', 'PS 230', 'PS 231', 'PS 280', 'PS 281', 'PS 282', 'PS 283', 'PS 300', 'PS 340', 'PS 379', 'PS 380', 'PS 382', 'PS 384', 'PS 386', 'PS 387', 'PS 390', 'PS 391', 'PS 392', 'PS 393', 'PS 394', 'PS 395', 'PS 396', 'PS 398', 'PS 399', 'PS 457', 'PS 480', 'PS 494'];
const LAW_JUDICIAL = ['PS 170', 'PS 230', 'PS 231', 'PS 300', 'PS 301', 'PS 302', 'PS 305', 'PS 306', 'PS 322', 'PS 323', 'PS 386', 'PS 494'];
const LAW_THEORY = ['PS 370', 'PS 371', 'PS 372', 'PS 373', 'PS 374', 'PS 375', 'PS 376', 'PS 377', 'PS 413', 'PS 494'];

/** Area 0's first block and its one-of option list as the general reading has them, then the three hour rules. */
function psArea0(t: Tools, hours: ReturnType<typeof psHours>, keep: string[]): AreaRuleBlock[] {
  const kept = keep.map((suffix) => t.block(0, 0, suffix || undefined)).filter((b): b is AreaRuleBlock => b !== undefined);
  return [...kept, hours.lower, ...(hours.any ? [hours.any] : [])];
}

// ---- ETMA: the Department Foundation every concentration shares ------------

/** The Department Foundation's four option lists, in the page's order, and the rows taken by every student. */
const ETMA_COMMUNICATION = ['CMN 101', 'ALEC 115', 'CMN 111'];
const ETMA_ADVANCED_COMMUNICATION = ['AGCM 220', 'BADM 340', 'BTW 250', 'BTW 261', 'ECE 316', 'ESE 360', 'ETMA 311', 'NRES 419', 'PLPA 200'];
const ETMA_STATISTICS = ['ACE 262', 'CPSC 241', 'ECON 202', 'STAT 107'];
const ETMA_SCIENCE_II = ['CHEM 104', 'PHYS 102'];
const ETMA_REQUIRED = ['MATH 234', 'CHEM 102', 'PHYS 101', 'ECON 102'];
const ETMA_FOUNDATION = [...ETMA_COMMUNICATION, ...ETMA_ADVANCED_COMMUNICATION, ...ETMA_STATISTICS, ...ETMA_REQUIRED, ...ETMA_SCIENCE_II];

/**
 * Engineering Technology & Management for Agricultural Systems: the
 * Department Foundation is one table on every ETMA page. MATH 234, CHEM 102
 * & 103, PHYS 101 and ECON 102 (or ACE 100) are taken by every student; the
 * rest are four lists of one each: a communication option (CMN 101, ALEC 115,
 * or CMN 111 & 112), an advanced communication option (nine courses), a
 * statistics option (four), and CHEM 104 & 105 or PHYS 102. The general
 * reading took all 22 rows (optionListsIn reads the lists, then stops at the
 * "OR" between CHEM 104 and PHYS 102 with required rows around it), 11 to 15
 * credits past the degree total on the sweep's boards. Area 1's Major Core
 * and Business Electives stay as the general reading has them.
 */
function etmaFoundation(t: Tools): AreaRuleBlock[] {
  const first = t.block(1, 0) as AreaRuleBlock;
  const choices = 'choices' in first.rule ? first.rule.choices : [];
  const of = (codes: string[]): CourseChoice[] => codes.map((code) => choices.find((c) => norm(c.codes[0]) === code)).filter((c): c is CourseChoice => c !== undefined);
  const option = (k: number, text: string, hours: number, codes: string[]): AreaRuleBlock => ({
    groupIndex: 0,
    idSuffix: `opt${k}`,
    label: `Department Foundation: ${text}`,
    hours,
    note: text,
    rule: { kind: 'choose', n: 1, choices: of(codes), list: true },
    rows: codes.length,
  });
  const core: AreaRuleBlock = { ...first, note: 'Every student takes these; the communication, advanced communication and statistics options and the second science course are one course each, below.', rule: { kind: 'all', choices: of(ETMA_REQUIRED) }, rows: ETMA_REQUIRED.length };
  const rest = [t.block(1, 1), t.block(1, 2)].filter((b): b is AreaRuleBlock => b !== undefined);
  return [
    core,
    option(1, 'Communication Option', 3, ETMA_COMMUNICATION),
    option(2, 'Advanced ETMA Communication Option - Select one of the following', 3, ETMA_ADVANCED_COMMUNICATION),
    option(3, 'Statistics Option - Select one of the following', 3, ETMA_STATISTICS),
    option(4, 'Select one of the following', 4, ETMA_SCIENCE_II),
    ...rest,
  ];
}

const etmaReading = (concentration: string): HandReading => ({
  source: `https://catalog.illinois.edu/undergraduate/aces/engineering-technology-management-agricultural-systems-bs/${concentration ? `${concentration}/` : ''}`,
  checked: '2026-10-11',
  expect: { '1::0': ETMA_FOUNDATION, '1::1': ['CS 105', 'ETMA 100', 'ETMA 430', 'ETMA 439'] },
  areas: { 1: etmaFoundation },
});

/** The page's "All Other Areas" topical lecture list (the crawl also carries ABE 482, which the live page no longer prints). */
const MSE_OTHER_AREAS = ['MSE 403', 'MSE 421', 'MSE 422', 'MSE 440', 'MSE 443', 'MSE 453', 'MSE 455', 'MSE 456', 'MSE 457', 'MSE 458', 'MSE 460', 'MSE 461', 'MSE 464', 'MSE 466', 'MSE 480', 'MSE 481', 'MSE 485', 'MSE 487', 'MSE 488', 'MSE 489', 'MSE 498', 'ABE 483', 'CEE 401', 'CEE 460', 'CHBE 458', 'ECE 441', 'ECE 443', 'ECE 444', 'ECE 481', 'ECE 487', 'ECE 488', 'ECE 495', 'ES 470', 'IE 431', 'ME 431', 'ME 472', 'ME 487', 'SE 412', 'TAM 451', 'TAM 456'];

export const HAND_READINGS: Record<string, HandReading> = {
  /*
   * Only Agricultural Production & Processing for now: the three-level gate
   * (2026-10-11, subset sweeps of the five ETMA degrees at both starts)
   * accepted all six of its boards at both starts. The same reading on the
   * plain degree and Construction Management, Digital & Precision Agriculture
   * and Energy & Environment asked for engine work first (pre-med and pre-PT
   * boards picking PHYS 102 over the track's CHEM 104 & 105, and course pairs
   * split across terms), so those four keep the general reading until then.
   */
  'aces/engineering-technology-management-agricultural-systems-bs/agricultural-production-processing': etmaReading('agricultural-production-processing'),
  /*
   * Citizen Politics: PS 100; one of PS 101, PS 240, PS 241; 6 hours of
   * 100- and 200-level PS; 15 hours at 300 and 400 level, 9 from the list; 6
   * hours at any level, 3 from the list; 12 hours outside PS. The general
   * reading had one course of any level for the 6 hours and the 15-hour
   * list as a pool with no size, which no board could meet.
   */
  'las/political-science-balas/citizen-politics': {
    source: 'https://catalog.illinois.edu/undergraduate/las/political-science-balas/citizen-politics/',
    checked: '2026-10-08',
    expect: { '0::0': ['PS 100'], '0::0::opt1': ['PS 101', 'PS 240', 'PS 241'], '1::0': ['PS 311', 'PS 456'] },
    areas: {
      0: (t) => psArea0(t, psHours(t, { name: 'Citizen Politics', list: CITIZEN_LIST, named: ['PS 100', 'PS 101', 'PS 240', 'PS 241'], anyFromList: true }), ['', 'opt1']),
      1: (t) => [psHours(t, { name: 'Citizen Politics', list: CITIZEN_LIST, named: ['PS 100', 'PS 101', 'PS 240', 'PS 241'], anyFromList: true }).upper],
    },
  },
  /*
   * Civic Leadership (applies once the degree leaves READ_AS_RELEASED, where
   * Families 0-3 hold it): PS 100, PS 101, PS 125 or PS 191, PS 291 or PS 491;
   * 6 hours of 100- and 200-level PS; 15 hours at 300 and 400 level, 9 from
   * the list; up to 2 more PS hours; 12 hours outside PS. The general reading
   * required all six of the first rows, both sides of both "or"s, and every
   * course of the list (48 hours).
   */
  'las/political-science-balas/civic-leadership': {
    source: 'https://catalog.illinois.edu/undergraduate/las/political-science-balas/civic-leadership/',
    checked: '2026-10-08',
    expect: { '0::0': ['PS 100', 'PS 101', 'PS 125', 'PS 191', 'PS 291', 'PS 491'], '1::0': ['PS 321', 'PS 376'] },
    areas: {
      0: (t) => {
        const first = t.block(0, 0) as AreaRuleBlock;
        const pick = (codes: string[]): CourseChoice | null => {
          const [head, ...rest] = present(codes.map(t.choice));
          return head ? { ...head, codes: [head.codes[0], ...rest.map((c) => c.codes[0])], title: [head, ...rest].map((c) => c.title).join(' or ') } : null;
        };
        const core: AreaRuleBlock = { ...first, rule: { kind: 'all', choices: present([t.choice('PS 100'), t.choice('PS 101'), pick(['PS 125', 'PS 191']), pick(['PS 291', 'PS 491'])]) } };
        const hours = psHours(t, { name: 'Civic Leadership', list: CIVIC_LIST, named: ['PS 100', 'PS 101', 'PS 125', 'PS 191', 'PS 291', 'PS 491'], anyFromList: false, lowerExcept: [] });
        return [core, hours.lower];
      },
      1: (t) => [psHours(t, { name: 'Civic Leadership', list: CIVIC_LIST, named: ['PS 100', 'PS 101', 'PS 125', 'PS 191', 'PS 291', 'PS 491'], anyFromList: false, lowerExcept: [] }).upper],
    },
  },
  /*
   * International Relations: PS 100; one of PS 280, PS 281, PS 282; 6 hours
   * of 100- and 200-level PS; 15 hours at 300 and 400 level, 9 from the list;
   * 6 more PS hours at any level; 12 hours outside PS.
   */
  'las/political-science-balas/international-relations': {
    source: 'https://catalog.illinois.edu/undergraduate/las/political-science-balas/international-relations/',
    checked: '2026-10-08',
    expect: { '0::0': ['PS 100'], '0::0::opt1': ['PS 280', 'PS 281', 'PS 282'], '1::0': ['PS 379', 'PS 480'] },
    areas: {
      0: (t) => psArea0(t, psHours(t, { name: 'International Relations', list: IR_LIST, named: ['PS 100', 'PS 280', 'PS 281', 'PS 282'], anyFromList: false }), ['', 'opt1']),
      1: (t) => [psHours(t, { name: 'International Relations', list: IR_LIST, named: ['PS 100', 'PS 280', 'PS 281', 'PS 282'], anyFromList: false }).upper],
    },
  },
  /*
   * Law and Power: PS 100, PS 270; 6 hours of 100- and 200-level PS; 15
   * hours at 300 and 400 level, 9 from the list, at least one course from
   * Law/Judicial Politics and one from Political Theory; 6 hours at any
   * level, 3 from the list; 12 hours outside PS. The general reading required
   * all 21 courses of the list and no hours rule at all.
   */
  'las/political-science-balas/law-power': {
    source: 'https://catalog.illinois.edu/undergraduate/las/political-science-balas/law-power/',
    checked: '2026-10-08',
    expect: { '0::0': ['PS 100', 'PS 270'], '1::0': ['PS 301', 'PS 377', 'PS 413'] },
    areas: {
      0: (t) => {
        const hours = psHours(t, { name: 'Law and Power', list: [...LAW_JUDICIAL, ...LAW_THEORY], named: ['PS 100', 'PS 270'], anyFromList: true });
        return psArea0(t, hours, ['']);
      },
      1: (t) => [
        psHours(t, {
          name: 'Law and Power',
          list: [...new Set([...LAW_JUDICIAL, ...LAW_THEORY])],
          named: ['PS 100', 'PS 270'],
          anyFromList: true,
          within: [
            { label: 'Law/Judicial Politics', codes: LAW_JUDICIAL.filter((c) => Number(c.split(' ')[1]) >= 300) },
            { label: 'Political Theory', codes: LAW_THEORY },
          ],
        }).upper,
      ],
    },
  },
  /*
   * Civil Engineering: the page offers a primary field (31 hours) and a
   * secondary field (6), each of fifteen and eighteen fields its own table,
   * or "instead of choosing separate primary and secondary field options",
   * the General Civil Engineering Option (37 hours): one science elective,
   * seven of the eight core courses, and four advanced technical courses
   * from the seven areas, no more than one from each (Option I; Option II
   * allows two from one area). The plan follows the General Option, the
   * four courses read as four of the seven areas. The general reading
   * required something of every field (177 courses not placed on the
   * sweep's boards).
   */
  'engineering/civil-engineering-bs': {
    source: 'https://catalog.illinois.edu/undergraduate/engineering/civil-engineering-bs/',
    checked: '2026-10-08',
    expect: {
      '5::84': ['GEOL 107', 'CHEM 232', 'ME 200', 'STAT 420'],
      '5::85': ['CEE 300', 'CEE 310', 'CEE 320', 'CEE 330', 'CEE 340', 'CEE 350', 'CEE 360', 'CEE 380'],
      '5::87': ['CEE 420', 'CEE 421', 'CEE 422'],
      '5::92': ['CEE 405', 'CEE 418'],
      '5::93': ['CEE 451', 'CEE 453'],
    },
    areas: {
      5: (t) => {
        const science = t.block(5, 84) as AreaRuleBlock;
        const core = t.block(5, 85) as AreaRuleBlock;
        const areas: Array<[string, string[]]> = [
          ['Construction', ['CEE 420', 'CEE 421', 'CEE 422']],
          ['Environmental', ['CEE 437', 'CEE 440', 'CEE 441']],
          ['Geotechnical', ['CEE 483', 'CEE 484']],
          ['Materials', ['CEE 401']],
          ['Structures', ['CEE 460', 'CEE 461']],
          ['Transportation', ['CEE 405', 'CEE 406', 'CEE 407', 'CEE 408', 'CEE 409', 'CEE 410', 'CEE 411', 'CEE 412', 'CEE 415', 'CEE 416', 'CEE 417', 'CEE 418']],
          ['Water Resources', ['CEE 451', 'CEE 453']],
        ];
        const choices = areas
          .map(([label, codes]): CourseChoice | null => {
            const here = present(codes.map(t.choice));
            return here.length > 0 ? { ...here[0], codes: here.map((c) => c.codes[0]), title: `${label}: ${here.map((c) => c.codes[0]).join(', ')}` } : null;
          })
          .filter((c): c is CourseChoice => c !== null);
        const ate: AreaRuleBlock = {
          groupIndex: 86,
          label: 'Advanced Technical Courses: select 4 courses from the areas below, no more than 1 from each area',
          hours: null,
          note: 'The General Civil Engineering Option, which this plan follows. The page offers a primary field (31 hours) and a secondary field (6 hours) instead; it also allows two courses from one area (Option II).',
          rows: 0,
          rule: { kind: 'choose', n: 4, choices },
        };
        return [
          { ...science, note: 'The General Civil Engineering Option (37 hours), which this plan follows instead of a primary and a secondary field.' },
          core,
          ate,
        ];
      },
    },
  },
  /*
   * Materials Science & Engineering: the page offers two areas, and the
   * student follows one. "For All Other Areas" (IE 300 or STAT 400, MSE 304,
   * MSE 405; four sections of MSE 404; 6 hours of technical electives; 12
   * hours of topical lectures) is the plan's; "For the Biomaterials Area"
   * (CHEM 232, IE 300, MCB 150, MCB 450, MCB 252, MSE 470; two sections of
   * MSE 404; 5 hours of biomaterials topical lectures and 6 outside) is named
   * in the note. The general reading required both areas and all five
   * topical lists (88 courses).
   */
  'engineering/materials-science-engineering-bs': {
    source: 'https://catalog.illinois.edu/undergraduate/engineering/materials-science-engineering-bs/',
    checked: '2026-10-08',
    expect: {
      '4::0': ['CHEM 232', 'MCB 150', 'MCB 450', 'MCB 252', 'MSE 470'],
      '5::0': ['MSE 304', 'MSE 405'],
      '6::0': ['MSE 404'],
      '7::0': ['MSE 404'],
      '8::0': ['MSE 420', 'MSE 441', 'MSE 450', 'MSE 470', 'ECE 340'],
      '8::1': ['MSE 473', 'BIOE 416'],
      '8::2': ['BIOC 446', 'BIOC 455', 'BIOP 401'],
      '8::3': ['MSE 403', 'TAM 456'],
      '8::4': ['CHEM 436', 'PHYS 487'],
    },
    areas: {
      4: () => [],
      5: (t) => {
        const b = t.block(5, 0) as AreaRuleBlock;
        return [{ ...b, note: 'For All Other Areas, the area this plan follows. The page offers the Biomaterials Area instead: CHEM 232, IE 300, MCB 150, MCB 450, MCB 252 and MSE 470, two sections of MSE 404, and 5 hours of biomaterials topical lectures with 6 outside them.' }];
      },
      6: () => [],
      7: (t) => {
        const b = t.block(7, 0) as AreaRuleBlock;
        return [{ ...b, note: 'The page asks for four unique sections of MSE 404 (6 hours) and 6 hours of technical electives at the 200 level or higher from ABE, AE, BIOC, BIOE, BIOP, CHBE, CHEM, CEE, CS, CSE, ECE, IE, MATH, MCB, ME, MSE, NPRE, PHYS, SE, TAM and TE; the plan books MSE 404 once and leaves the rest to its electives.' }];
      },
      8: (t) => {
        const choices = present(MSE_OTHER_AREAS.map(t.choice));
        return [
          pool(
            3,
            'Topical lecture courses (All Other Areas)',
            12,
            choices,
            [listOf('All Other Areas', choices)],
            [],
            'The page lets up to two Introductory courses (MSE 420, MSE 441, MSE 450, MSE 470, ECE 340) and one Science course (CHEM 436, CHEM 483, PHYS 485, PHYS 486, PHYS 487) count here too; the plan picks from the All Other Areas list.',
          ),
        ];
      },
    },
  },
};

/**
 * The general reading's areas with the hand-written reading for this degree
 * applied, or null where there is none or the page no longer prints what the
 * reading was written against.
 */
export function handReading(id: string, areas: AreaRules[], byCode: CatalogRowLookup): AreaRules[] | null {
  const reading = HAND_READINGS[id];
  if (!reading) return null;
  const find = (area: number, group: number, suffix?: string) => areas[area]?.blocks.find((b) => b.groupIndex === group && (b.idSuffix ?? '') === (suffix ?? ''));
  for (const [key, codes] of Object.entries(reading.expect)) {
    const [area, group, suffix] = key.split('::');
    const have = new Set(codesIn(find(Number(area), Number(group), suffix)));
    if (!codes.every((c) => have.has(norm(c)))) return null;
  }
  const rows = typeof byCode.values === 'function' ? [...byCode.values()] : [];
  const tools: Tools = {
    choice(code) {
      const row = byCode.get(norm(code));
      return row ? { codes: [norm(code)], title: row.title, credits: row.credits, creditsMax: row.creditsMax ?? null, substitutes: [] } : null;
    },
    level(subject, levels, except = []) {
      const out = new Set(except.map(norm));
      return rows
        .filter((r) => {
          const [s, n] = norm(r.code).split(' ');
          return s === subject && levels.includes(Math.floor(Number(n) / 100) * 100) && !out.has(norm(r.code));
        })
        .map((r) => ({ codes: [norm(r.code)], title: r.title, credits: r.credits, creditsMax: r.creditsMax ?? null, substitutes: [] }))
        .sort((a, b) => a.codes[0].localeCompare(b.codes[0]));
    },
    block: find,
  };
  return areas.map((rules, index) => {
    const area = reading.areas[index];
    if (!area) return rules;
    const blocks = area(tools);
    return { ...rules, blocks, pools: blocks.filter((b) => b.rule.kind === 'pool').length };
  });
}
