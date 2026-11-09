/**
 * The example in the setup assistant's first box (guided-setup.tsx): one of
 * five, picked at random each time the box opens, in the chosen school's own
 * words ("I'm a sophomore at UGA", "at Illinois"). The five cover the usual
 * students: a sophomore headed for medical school, an incoming freshman, a
 * transfer junior, an undecided first-year, and a junior with two majors who
 * wants to finish early.
 *
 * Each names only what setup acts on: the year, the majors and a minor,
 * career goals (they shape the electives) and when to finish. Each fits the
 * box (five lines) on a 320-pixel phone: at most 150 characters. Never AP
 * credit or study abroad: the box records no exam scores (they go under "Add
 * prior credit or upload a transcript", and saying them used to clear the
 * prior-credit reminder), and a term abroad is set later with the board's
 * assistant. Every major and minor named is in that school's catalog
 * (2026-11-09): UGA's Biology BS, Computer Science BS, Finance BBA, Economics
 * and Political Science and Minor in Mathematics; Illinois's Integrative
 * Biology, Computer Science, Finance, Economics, Political Science and
 * Mathematics Minor. A school without its own words here gets plain ones
 * with no minor, which not every school's data has.
 */

export interface ExampleWords {
  biology: string;
  computing: string;
  /** A minor the school's setup offers, or null. */
  minor: string | null;
  business: string;
  /** Two majors to name together, or one when the school has no clear pair. */
  majors: string;
  double: boolean;
}

/** Exported for the check (__setup-examples.check.mjs), which finds each of these in the school's catalog. */
export const EXAMPLE_WORDS: Record<string, ExampleWords> = {
  uga: { biology: 'biology', computing: 'computer science', minor: 'math', business: 'finance', majors: 'economics and political science', double: true },
  illinois: { biology: 'integrative biology', computing: 'computer science', minor: 'math', business: 'finance', majors: 'economics and political science', double: true },
};
export const PLAIN_WORDS: ExampleWords = { biology: 'biology', computing: 'computer science', minor: null, business: 'business', majors: 'economics', double: false };

export const SETUP_EXAMPLE_COUNT = 5;

/** The five examples for a school, by its id and short name ('uga', 'UGA'). */
export function setupExamples(schoolId: string | null | undefined, short: string | null | undefined): string[] {
  const w = (schoolId && EXAMPLE_WORDS[schoolId]) || PLAIN_WORDS;
  const at = short ? ` at ${short}` : '';
  const to = short ? ` to ${short}` : '';
  return [
    `I'm a sophomore${at} majoring in ${w.biology}. I want to go to medical school and graduate in four years.`,
    `I'm an incoming freshman${at} planning to major in ${w.computing}. I want to work in software engineering${w.minor ? ` and might add a minor in ${w.minor}` : ''}.`,
    `I'm a junior transferring${to} from a community college with about 60 credits. I'm majoring in ${w.business} and want to go into banking.`,
    `I'm a first-year${at} and haven't picked a major yet. I like psychology and economics, and I might want a career in marketing.`,
    `I'm a junior${at} ${w.double ? 'double majoring' : 'majoring'} in ${w.majors}. I want to go to law school and graduate a semester early.`,
  ];
}
