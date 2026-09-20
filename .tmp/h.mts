type SemesterSeason = 'Fall' | 'Spring' | 'Summer';
const SEASON_WORD = /\b(fall|spring|summer)\s*(20\d\d)\b/gi;

/** Words that mark a date as the END of the plan. */
const GRAD_CUE = /\b(graduat\w*|finish\w*|done|complete\w*|walk|out by|degree by|by the end of|aiming for|target\w*)\b/i;
/** Words that mark a date as the BEGINNING of it. */
const START_CUE = /\b(start\w*|begin\w*|began|entering|enter|arriv\w*|incoming|first (semester|term|year)|freshman|transferr?\w* in|since)\b/i;

const WORD_YEARS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * The student's own timeline where they gave one, the crawled term otherwise.
 *
 * The hard part is telling a start date from an end date, and the first version
 * did not try: it took the first season and year anywhere in the answer and
 * called it graduation. Onboarding asks "When do you want to finish, and where
 * are you now?", which invites both dates in one sentence, so an incoming
 * freshman who wrote "starting fall 2026, want to finish in four years" got a
 * horizon of Fall 2026 to Fall 2026 and a ONE SEMESTER plan presented as a
 * finished four-year plan.
 *
 * So every date in the sentence is classified by the words in front of it, and
 * a relative span ("in four years") is honoured when no end date is named.
 * Nothing is inferred from silence.
 */
function readHorizon(
  timeline: string,
  startTerm: { season: SemesterSeason; year: number },
): { startSeason: SemesterSeason; startYear: number; gradSeason: SemesterSeason; gradYear: number; stated: boolean } {
  const fallback = {
    startSeason: startTerm.season,
    startYear: startTerm.year,
    gradSeason: 'Spring' as SemesterSeason,
    gradYear: startTerm.year + 4,
    stated: false,
  };

  const found: Array<{ season: SemesterSeason; year: number; cue: 'grad' | 'start' | null }> = [];
  for (const m of timeline.matchAll(SEASON_WORD)) {
    // The clause in front of the date is what says which end it is. 40
    // characters covers "I want to graduate by" without reaching the previous
    // sentence's cue word.
    const before = timeline.slice(Math.max(0, m.index - 40), m.index);
    found.push({
      season: (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as SemesterSeason,
      year: Number(m[2]),
      cue: GRAD_CUE.test(before) ? 'grad' : START_CUE.test(before) ? 'start' : null,
    });
  }

  const named = found.find((f) => f.cue === 'start');
  const startSeason = named?.season ?? startTerm.season;
  const startYear = named?.year ?? startTerm.year;

  // "finish in four years" is a real constraint even with no end date in it.
  const spanM = timeline.match(/\bin\s+(\d|one|two|three|four|five|six)\s*(?:more\s*)?years?\b/i);
  const span = spanM
    ? (WORD_YEARS[spanM[1].toLowerCase() as keyof typeof WORD_YEARS] ?? Number(spanM[1]))
    : null;

  // An unlabelled date is a graduation date only when it is the only one, since
  // "I'm a sophomore, graduating 2029" leaves the year bare more often than not.
  const grad =
    found.find((f) => f.cue === 'grad') ??
    (found.filter((f) => f.cue !== 'start').length === 1
      ? found.find((f) => f.cue !== 'start')
      : undefined);

  let gradSeason = grad?.season ?? ('Spring' as SemesterSeason);
  let gradYear = grad?.year ?? (span ? startYear + span : startYear + 4);
  let stated = Boolean(grad) || span !== null;

  // A graduation on or before the first term is a misread, not a plan, and
  // shipping it produced a one-semester degree. Fall back rather than show it.
  const ord = (season: SemesterSeason, year: number) =>
    year * 3 + (season === 'Spring' ? 0 : season === 'Summer' ? 1 : 2);
  if (ord(gradSeason, gradYear) <= ord(startSeason, startYear) || gradYear > startYear + 8) {
    gradSeason = 'Spring';
    gradYear = startYear + 4;
    stated = false;
  }

  return { startSeason, startYear, gradSeason, gradYear, stated };
}

const START = { season: 'Fall' as SemesterSeason, year: 2026 };
const cases: Array<[string, string]> = [
  ['Incoming freshman starting fall 2026, zero college credit. Want to finish in four years.', 'Spring 2030'],
  ['starting fall 2026', 'Spring 2030'],
  ['Second year, about 30 credits done. I want to graduate spring 2030.', 'Spring 2030'],
  ['I want to graduate in spring 2029', 'Spring 2029'],
  ['Transferred in fall 2026, hoping to be done by spring 2029', 'Spring 2029'],
  ['I started fall 2025 and want to finish fall 2029', 'Fall 2029'],
  ['no idea honestly', 'Spring 2030'],
  ['finish in 3 years', 'Spring 2029'],
  ['graduate spring 2026', 'Spring 2030'],
];
let bad = 0;
for (const [text, want] of cases) {
  const h = readHorizon(text, START);
  const got = `${h.gradSeason} ${h.gradYear}`;
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  start ${(h.startSeason + ' ' + h.startYear).padEnd(11)} grad ${got.padEnd(12)} stated=${String(h.stated).padEnd(5)} "${text.slice(0, 56)}"`);
}
console.log(bad ? `*** ${bad} FAILURES ***` : `all ${cases.length} correct`);
