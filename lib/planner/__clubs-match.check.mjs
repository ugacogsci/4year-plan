/**
 * The club matcher (lib/planner/clubs.ts), its loader (clubs-load.ts) and
 * ALMA's find_clubs (clubs-tool.ts), on made-up clubs first, then on the real
 * public/illinois/clubs.json when the build has written it.
 *
 * Each case is something a prototype or the design review caught:
 *   - a Psychology student who wants HR was shown the Pre-Health Psychology
 *     Association because it shares the major;
 *   - an umbrella pre-health society outranked the Pre-Physical Therapy Club
 *     for a pre-PT student;
 *   - fraternities, faith and identity groups surfaced from career words;
 *   - a student who said "pre-med, actually not anymore" still got pre-med clubs;
 *   - with no calendar read, every club would have been ranked down as idle;
 *   - a missing club file must hide the rail section, not show "no clubs";
 *   - a student who said they are still deciding was told "Nothing in ...
 *     matched", as if their answer were a miss (review, 2026-10-05);
 *   - a pre-vet student was shown general pre-health clubs "for your goal".
 *
 *   node lib/planner/__clubs-match.check.mjs        (a second or two)
 *
 * The 24-persona scoreboard is lib/planner/__clubs.check.mjs (DESIGN step 11).
 * Exits non-zero on any FAIL.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const { interestProfile, CAREER_TRACKS, INTEREST_TOPICS } = await import(join(HERE, 'career-tracks.ts'));
const C = await import(join(HERE, 'clubs.ts'));
const L = await import(join(HERE, 'clubs-load.ts'));
const T = await import(join(HERE, 'clubs-tool.ts'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? ` (${detail})` : ''}`));

const TODAY = '2026-10-05';
const VOCAB = { tracks: CAREER_TRACKS, topics: INTEREST_TOPICS };
let nextId = 60000;
const club = (name, o = {}) => {
  const id = String(nextId++);
  const profile = o.website ? undefined : `https://one.illinois.edu/C${id}/`;
  return { id, name, url: profile ?? o.website, ...(profile ? { profile } : {}), categories: [], kind: 'academic', identity: false, audience: 'undergrad', joining: 'open', goals: [], firstSeen: '2026-10-04', lastSeen: '2026-10-04', ...o };
};
const named = (...ids) => ids.map((id) => ({ id, from: 'name' }));
const LISTS = [
  { id: 'prelaw', title: '2025 – 2026 Pre-Law Student Orgs', short: "Pre-Law Advising's 2025–26 list of pre-law student orgs", url: 'https://publish.illinois.edu/prelawadvising/x/', read: '2026-10-04', goal: 'pre-law', weight: 1 },
  { id: 'ec', title: 'Affiliated Societies', short: "Engineering Council's affiliated societies", url: 'https://www.ecillinois.org/affiliated-societies', read: '2026-10-04', college: 'engineering' },
  { id: 'siebel', title: 'Student Organizations', short: "the Siebel School's student groups", url: 'https://siebelschool.illinois.edu/x', read: '2026-10-04', subject: 'CS' },
];
const file = (clubs, extra = {}) => ({
  version: 1, builtAt: '2026-10-05T00:00:00.000Z', checked: '2026-10-04',
  source: { name: 'OneIllinois', url: 'https://one.illinois.edu/club_signup', host: 'one.illinois.edu' },
  calendar: null, lists: LISTS,
  counts: { onPage: clubs.length, parsed: clubs.length, shipped: clubs.length, dropped: { office: 0, graduate: 0, law: 0, medical: 0, veterinary: 0 }, unlisted: 0 },
  clubs, ...extra,
});
const student = (careerText, o = {}) => C.clubStudentOf({ careerText, hear: interestProfile, vocabulary: VOCAB, firstYear: false, ...o });
const names = (picks) => picks.map((p) => p.club.name);
const rec = (data, s, o = {}) => C.recommendClubs(data, s, { today: TODAY, ...o });

// ---------------------------------------------------------------------------
console.log('\nThe student');

expect(C.majorNameOf('Political Science: General Political Science, BALAS') === 'Political Science', 'the major is the program name before its concentration and degree');
expect(C.majorNameOf('Molecular & Cellular Biology, BSLAS') === 'Molecular & Cellular Biology' && C.majorNameOf(null) === null, '"Molecular & Cellular Biology, BSLAS" reads as its name; no program, no major');
const psych = student('HR, industrial organizational psychology', { programName: 'Psychology, BSLAS', college: 'las', degree: { primary: 'PSYC', subjects: new Set(['PSYC', 'STAT']) } });
expect(psych.primary === 'PSYC' && psych.subjects.join() === 'PSYC,STAT' && psych.majorName === 'Psychology' && psych.profile.heard.length === 1, 'clubStudentOf reads the goal from the career words and the major from the degree');
expect(student('  ').careerText === '' && student(undefined).careerText === '', 'blank or missing career words are no words');

// ---------------------------------------------------------------------------
console.log('\nEvidence and score');

{
  const onList = club('Undergraduate Mock Trial', { lists: [0], goals: [{ id: 'pre-law', from: 'list', list: 0 }] });
  const preLaw = club('Pre-Law Society', { kind: 'pre-professional', goals: named('pre-law') });
  const lawTopic = club('Law and Society Club', { goals: named('law') });
  const r = rec(file([onList, preLaw, lawTopic]), student('law school'));
  const by = new Map(r.picks.map((p) => [p.club.name, p]));
  expect(r.goals.map((g) => g.id).join() === 'pre-law' && r.goals[0].label === 'Pre-law (JD)', '"law school" is heard as the pre-law track');
  expect(by.get('Undergraduate Mock Trial')?.why === "On Pre-Law Advising's 2025–26 list of pre-law student orgs" && by.get('Undergraduate Mock Trial')?.basis === 'list', 'a club on Pre-Law Advising\'s list says so');
  expect(by.get('Pre-Law Society')?.why === 'For your goal: Pre-law (JD)' && Math.abs(by.get('Pre-Law Society').score - 1.05) < 1e-9, 'a club named for the track: 1.0 + 0.05 for being specific');
  expect(by.get('Law and Society Club')?.why === 'About law/legal, part of Pre-law (JD)' && Math.abs(by.get('Law and Society Club').score - 0.63) < 1e-9, 'a law club for a pre-law student is "covered" evidence: 0.7 x 0.9');
}
{
  const fin = club('Finance Club', { goals: named('finance') });
  const markets = club('Markets Club', { goals: named('markets') });
  const ib = club('Mergers Club', { kind: 'consulting-investing', goals: named('investment-banking') });
  const r = rec(file([fin, markets, ib]), student('investment banking'));
  const why = Object.fromEntries(r.picks.map((p) => [p.club.name, p.why]));
  expect(why['Mergers Club'] === 'About investment banking/corporate finance, which you said you want', 'a club named for the topic: "About ..., which you said you want"');
  // Changed after the round-2 spot check: the wider field says it is close, never that one field "is part of" another.
  expect(why['Finance Club'] === 'A finance club, close to investment banking/corporate finance', 'the parent field counts as family evidence, with a true why line ("close to", not "is part of")', why['Finance Club']);
  expect(why['Markets Club'] === 'An asset management/markets/trading club, close to investment banking/corporate finance', 'a sibling in the family says it is a sibling, not "a finance club"');
  const score = Object.fromEntries(r.picks.map((p) => [p.club.name, p.score]));
  expect(Math.abs(score['Finance Club'] - 0.75 * 0.9) < 1e-9 && Math.abs(score['Markets Club'] - 0.6 * 0.9) < 1e-9, 'the field itself (0.75) outranks a sibling field (0.6): a finance club before a real-estate club for investment banking', JSON.stringify(score));
}
{
  const hp = club('Pre-Health Psychology Association', { kind: 'pre-professional', subjects: ['PSYC'], goals: named('pre-medicine', 'pre-dental', 'nursing') });
  const psyClub = club('Undergraduate Psychology Association', { subjects: ['PSYC'] });
  const hr = club('HR Society', { goals: named('io-psychology-hr') });
  const r = rec(file([hp, psyClub, hr]), psych);
  expect(!names(r.picks).includes('Pre-Health Psychology Association'), "a club tagged for someone else's goal gets no major evidence: no pre-health club for a Psychology student who wants HR", names(r.picks).join('; '));
  expect(r.picks.find((p) => p.club.name === 'Undergraduate Psychology Association')?.why === 'Named for Psychology, your major', 'a club named for the major still shows, "Named for Psychology, your major"');
  const noGoal = rec(file([hp, psyClub]), student('', { programName: 'Psychology, BSLAS', degree: { primary: 'PSYC', subjects: ['PSYC'] } }));
  expect(names(noGoal.picks).includes('Pre-Health Psychology Association'), 'with no goal heard, the major counts for every club named for it');
}
{
  const aed = club('Alpha Epsilon Delta Pre-Health Society', { kind: 'professional-society', national: 'AED', goals: ['pre-medicine', 'pre-dental', 'pre-physician-assistant', 'pre-physical-therapy', 'pre-occupational-therapy', 'nursing'].map((id) => ({ id, from: 'national' })) });
  const pt = club('Pre-Physical Therapy Club', { kind: 'pre-professional', goals: named('pre-physical-therapy') });
  const r = rec(file([aed, pt]), student('physical therapy school'));
  expect(names(r.picks).join('; ') === 'Pre-Physical Therapy Club; Alpha Epsilon Delta Pre-Health Society', 'an umbrella named for 5+ goals comes after the club for this goal alone (-0.1)', names(r.picks).join('; '));
  expect(Math.abs(r.picks[1].score - 0.93) < 1e-9, 'the umbrella: 1.0 - 0.1 + 0.03 for a national chapter');
}
{
  const greek = club('Delta Finance Fraternity', { kind: 'greek-social', goals: named('finance') });
  const faith = club('Christian Business Fellowship', { kind: 'faith', goals: named('finance') });
  const community = club('Women in Finance', { kind: 'professional-society', identity: true, goals: named('finance') });
  const majorOnly = club('Society of Women Economists', { kind: 'professional-society', identity: true, subjects: ['ECON'] });
  const plain = club('Finance Society', { kind: 'professional-society', goals: named('finance') });
  const s = student('finance', { programName: 'Economics, BALAS', degree: { primary: 'ECON', subjects: ['ECON'] } });
  const r = rec(file([greek, faith, community, majorOnly, plain]), s);
  expect(names(r.picks).join() === 'Finance Society', 'social Greek, faith and identity clubs never come from career words into the main list', names(r.picks).join('; '));
  expect(names(r.communities).join() === 'Women in Finance', 'an identity-centered club matched by the goal goes to the communities row; a major match alone never does', names(r.communities).join('; '));
  expect(rec(file([community, plain]), s, { communities: false }).communities.length === 0, 'communities: false turns the row off');
}

// ---------------------------------------------------------------------------
console.log('\nHow open and how live a club is');

{
  const base = { kind: 'professional-society', goals: named('accounting') };
  const open = club('Accounting Society A', base);
  const closed = club('Accounting Society B', { ...base, joining: 'closed' });
  const check = club('Accounting Society C', { ...base, audience: 'check' });
  const honor = club('Accounting Honor Society', { ...base, kind: 'honor' });
  const thin = club('Accounting Society D', { ...base, thin: true });
  const grace = club('Accounting Society E', { ...base, lastSeen: '2026-08-01' });
  const data = file([open, closed, check, honor, thin, grace]);
  const rail = rec(data, student('CPA'));
  expect(!names(rail.picks).includes('Accounting Society C') && names(rail.picks).includes('Accounting Society A'), "the rail leaves out a club that may be for graduate or professional students: recommendable means an undergraduate can join (DESIGN 5.3)");
  const r = rec(data, student('CPA'), { includeCheck: true });
  const p = Object.fromEntries(r.picks.map((x) => [x.club.name, x]));
  const s0 = p['Accounting Society A'].score;
  expect(Math.abs(s0 - 0.95) < 1e-9, 'the open club: topic 0.9 + 0.05 specific', String(s0));
  expect(Math.abs(p['Accounting Society B'].score - s0 * 0.8) < 1e-9 && p['Accounting Society B'].cautions[0] === 'Not taking sign-ups on OneIllinois now; its page says how to join', 'closed: x0.8 and "Not taking sign-ups on OneIllinois now"');
  expect(Math.abs(p['Accounting Society C'].score - s0 * 0.6) < 1e-9 && p['Accounting Society C'].cautions[0] === 'May be for graduate or professional students; check its page', "audience check, in ALMA's search: x0.6 and the caution");
  expect(Math.abs(p['Accounting Society D'].score - s0 * 0.85) < 1e-9, 'a thin description: x0.85');
  expect(Math.abs(p['Accounting Society E'].score - s0 * 0.7) < 1e-9 && p['Accounting Society E'].cautions[0] === 'Not in the directory since Aug 1, 2026; clubs re-register each year', 'in the grace window: x0.7 and a dated note');
  expect(p['Accounting Honor Society']?.cautions[0] === 'By invitation, usually by GPA or standing' && Math.abs(p['Accounting Honor Society'].score - s0 * 0.6) < 1e-9, 'an honor society: x0.6 and "By invitation"');
  // Changed after the round-2 spot check (Beta Alpha Psi was missing for a future CPA): the first-year half
  // weight comes after the cutoff, so it orders the honor society after the clubs they can join, never hides it.
  const fy = rec(data, student('CPA', { firstYear: true }));
  const fyHonor = fy.picks.find((x) => x.club.name === 'Accounting Honor Society');
  expect(fyHonor && Math.abs(fyHonor.score - s0 * 0.6 * 0.5) < 1e-9 && names(fy.picks).indexOf('Accounting Honor Society') > names(fy.picks).indexOf('Accounting Society A'), 'a first-year sees an honor society at half weight, after the clubs they can join now, but still shown', names(fy.picks).join('; '));
  const quiet = club('Accounting Society F', base);
  const busy = club('Accounting Society G', { ...base, events: { n120: 4, next: ['2026-10-09'] } });
  const noCal = rec(file([quiet, busy]), student('CPA'));
  expect(noCal.picks.every((x) => Math.abs(x.score - s0) < 1e-9), 'with no calendar read, no club is ranked down for having no events');
  const withCal = rec(file([quiet, busy], { calendar: { url: 'u', lastModified: null, read: '2026-10-04' } }), student('CPA'));
  const q = withCal.picks.find((x) => x.club.name === 'Accounting Society F');
  expect(Math.abs(q.score - s0 * 0.9) < 1e-9 && withCal.picks[0].club.name === 'Accounting Society G', 'with the calendar read, no events in 120 days and none coming: x0.9, a tiebreak');
  expect(withCal.picks[0].event === 'Next event Oct 9', 'the event line: "Next event Oct 9"');
}
{
  const c = (events) => club('X', { events });
  expect(C.eventLine(c({ n120: 1, next: ['2026-10-03', '2026-10-09'] }), TODAY) === 'Next event Oct 9', 'the first upcoming date still ahead');
  expect(C.eventLine(c({ n120: 1, last: '2026-04-12', next: ['2026-10-01'] }), TODAY) === 'Last event Apr 2026', 'no date ahead: the last one, within 180 days');
  expect(C.eventLine(c({ n120: 0, last: '2026-03-01' }), TODAY) === undefined && C.eventLine(club('Y'), TODAY) === undefined, 'older than 180 days, or no events: nothing (never "Active")');
  const f = C.freshness({ checked: '2026-10-04' }, TODAY);
  const old = C.freshness({ checked: '2026-10-04' }, '2027-02-05');
  expect(f.label === 'Oct 4, 2026' && f.stale === false && old.stale === true && old.days === 124, 'freshness: "Oct 4, 2026", stale after 120 days');
  expect(C.cautionsOf(club('P', { kind: 'professional-fraternity', joining: 'application' })).join(' | ') === 'Recruits once a semester; check its page for dates | By application', 'a professional fraternity recruits once a semester; "By application" from the reading pass');
}

// ---------------------------------------------------------------------------
console.log('\nOrder and count');

{
  const consulting = [1, 2, 3, 4].map((i) => club(`Consulting Group ${i}`, { kind: 'consulting-investing', goals: named('consulting') }));
  const marketing = [1, 2, 3].map((i) => club(`Marketing Association ${i}`, { kind: 'professional-society', goals: named('marketing') }));
  const asme = club('American Society of Mechanical Engineers', { kind: 'professional-society', national: 'ASME', subjects: ['ME'], colleges: ['engineering'], lists: [1] });
  const s = student('consulting or marketing', { programName: 'Mechanical Engineering, BS', college: 'engineering', degree: { primary: 'ME', subjects: ['ME', 'TAM'] } });
  const r = rec(file([...consulting, ...marketing, asme]), s);
  expect(r.goals.map((g) => g.id).join() === 'consulting,marketing', 'goals in the order named');
  expect(r.picks.slice(0, 4).map((p) => p.goal).join() === 'consulting,marketing,consulting,marketing', 'rotation: one club per goal per round');
  expect(r.picks[4]?.club.name === 'American Society of Mechanical Engineers' && r.picks[4].goal === 'major', 'the goals filled the visible rows, so the last visible row goes to the major club', names(r.picks).join('; '));
  expect(r.picks[4].why === 'The American Society of Mechanical Engineers student chapter, for Mechanical Engineering students', 'the major why line names the national body, spelled out as the club\'s name gives it, and the major', r.picks[4].why);
  expect(r.picks.filter((p) => p.goal === 'consulting').length === 4 && r.picks.length === 8, 'past the per-goal cap, the rest still fill the list rather than leave rows empty');
  const groups = C.groupPicks(r);
  expect(groups.map((g) => g.heading).join(' | ') === 'For consulting | For marketing/advertising | For your major', 'groupPicks: one heading per goal, then "For your major"', groups.map((g) => g.heading).join(' | '));
  const again = rec(file([...consulting, ...marketing, asme]), s);
  expect(JSON.stringify(again) === JSON.stringify(r), 'the same inputs give the same list');
}
{
  const starters = ['Exploratory Students Association', 'Campus Volunteer Leadership Association'].map((n) => club(n, { starter: n.startsWith('Exp') ? 'undeclared' : true, kind: n.startsWith('Exp') ? 'social' : 'academic' }));
  const chem = club('American Chemical Society', { kind: 'professional-society', national: 'ACS', subjects: ['CHEM'] });
  const data = file([...starters, chem]);
  const none = rec(data, student(''));
  expect(none.empty === 'no-words' && none.picks.every((p) => p.goal === 'starter') && none.picks.length === 2, 'no words, no major: the starter clubs, and the card asks for a goal');
  const unheard = rec(data, student('I have no idea yet'));
  expect(unheard.empty === 'unheard' && unheard.picks.every((p) => p.goal === 'starter' && p.why === 'A good first club while you decide'), 'words that name no goal and no major: "unheard", the starters');
  const deciding = C.emptyNote(unheard, 'I have no idea yet');
  expect(unheard.undecided === true && deciding.startsWith('You said you are still deciding, so here are clubs for exploring') && !/Nothing|matched/.test(deciding), 'a student who says they are still deciding is told the list is for exploring, not that nothing matched', deciding);
  const pastry = rec(data, student('be a pastry chef'));
  const pastryNote = C.emptyNote(pastry, 'be a pastry chef');
  expect(pastry.empty === 'unheard' && !pastry.undecided && pastryNote.startsWith('Nothing in “be a pastry chef” matched a goal the planner knows yet.'), 'words that name a goal the planner does not know still say so, with examples', pastryNote);
  expect(C.emptyNote(none, '') === 'Say what you want to do after you graduate, and clubs for it show up here.' && C.emptyNote({ empty: undefined }, 'x') === null, 'no words: ask for a goal; a list: no note');
  for (const words of ['undecided', "I'm not sure yet", 'still deciding', "I don't know what I want to do", 'idk', 'exploring my options', 'no clue']) {
    expect(rec(data, student(words)).undecided === true, `"${words}" reads as still deciding`);
  }
  for (const words of ["I don't know how to cook but I want to be a pastry chef", 'be a pastry chef']) {
    expect(!rec(data, student(words)).undecided, `"${words}" does not`);
  }
  const weighing = rec(data, student('not sure if pre-med or pre-PT'));
  expect(weighing.goals.length === 2 && !weighing.undecided, '"not sure if pre-med or pre-PT" names two goals: weighing them is not undecided');
  const toolNote = T.runFindClubs({}, student('I have no idea yet'), data, { today: TODAY });
  expect(toolNote.ok && /still deciding/.test(toolNote.note) && !/name no goal/.test(toolNote.note), "ALMA's find_clubs tells it the student is still deciding, not that their words named nothing", toolNote.note);
  const chemPhd = rec(data, student('get a PhD and do research in chemistry', { programName: 'Chemistry, BS', degree: { primary: 'CHEM', subjects: ['CHEM'] } }));
  expect(chemPhd.picks[0]?.club.name === 'American Chemical Society' && chemPhd.empty === undefined && chemPhd.unknownGoal === true, 'a goal the planner cannot hear falls back to the major: the ACS for a chemistry PhD, marked unknownGoal');
  // Changed after the 2026-10-05 spot check: a student who named a goal is never told "while you decide".
  expect(chemPhd.picks.slice(1).length === 1 && chemPhd.picks.slice(1).every((p) => p.goal === 'general' && p.why === C.GENERAL_WHY), 'fewer than three clubs: general starters follow, labelled general (not the starter for undeclared students, to a declared major)', chemPhd.picks.map((p) => `${p.club.name}: ${p.why}`).join('; '));
  const chemNote = C.emptyNote(chemPhd, 'get a PhD and do research in chemistry') ?? '';
  expect(chemNote.startsWith('The planner does not know “get a PhD and do research in chemistry” as a goal yet, so the clubs below are for your major.'), 'the major fallback for a goal the planner cannot hear: the note says plainly the planner does not know the goal', chemNote);
  const decidingChem = rec(data, student("I'm still figuring it out", { programName: 'Chemistry, BS', degree: { primary: 'CHEM', subjects: ['CHEM'] } }));
  const decidingNote = C.emptyNote(decidingChem, "I'm still figuring it out") ?? '';
  expect(decidingChem.picks[0]?.club.name === 'American Chemical Society' && decidingChem.empty === undefined && decidingChem.undecided === true && decidingNote.startsWith('You said you are still deciding, so here are clubs for exploring'), 'still deciding, with a major: its clubs, and the card says the same as find_clubs (clubs for exploring)', decidingNote);
  const noMatch = rec(data, student('game design'));
  expect(noMatch.empty === 'no-match' && noMatch.picks.length === 0 && noMatch.thin.join() === 'game-design' && noMatch.matched['game-design'] === 0, 'a goal with no club and no major: no starters, and the goal is listed as thin');
  const retract = rec(file([club('Pre-Med Society', { kind: 'pre-professional', goals: named('pre-medicine') }), club('UX Club', { goals: named('ux-hci') })]), student("pre-med actually I don't want to do pre-med anymore, I want UX research"));
  expect(names(retract.picks).join() === 'UX Club', 'a goal the student took back is not a goal: no pre-med club', names(retract.picks).join('; '));
  const sister = rec(file([club('Pre-Law Society', { kind: 'pre-professional', goals: named('pre-law') }), ...starters]), student('my sister is pre-law, I want to build bridges'));
  expect(sister.picks.length > 0 && sister.picks.every((p) => p.goal === 'general'), "someone else's goal is not the student's: no pre-law club, only general clubs", names(sister.picks).join('; '));
}
{
  const a = club('ASME UIUC', { kind: 'professional-society', goals: named('robotics') });
  const b = club('ASME at Illinois', { kind: 'professional-society', goals: named('robotics') });
  const r = rec(file([a, b]), student('robotics'));
  expect(r.picks.length === 1, 'two near-identical names are one club');
  const long = club(`The Extremely Long Named Society for the Advancement of Robotics, Automation, Mechatronics and Everything Else Under the Sun`, { kind: 'professional-society', goals: named('robotics') });
  const longList = { ...LISTS[0], short: 'a list whose short title is long enough that the why line built from it would run past the limit of the rail' };
  const lr = rec(file([long, club('Robo', { goals: [{ id: 'pre-law', from: 'list', list: 0 }], lists: [0] })], { lists: [longList, LISTS[1], LISTS[2]] }), student('pre-law and robotics'));
  expect(lr.picks.every((p) => p.why.length <= 110), 'every why line is at most 110 characters', lr.picks.map((p) => p.why.length).join(','));
}

// ---------------------------------------------------------------------------
console.log('\nAfter the 2026-10-05 spot check: why lines for a family of goals (a)');

const HEALTH = ['pre-medicine', 'pre-dental', 'pre-physician-assistant', 'pre-physical-therapy', 'pre-occupational-therapy', 'pre-pharmacy', 'pre-optometry', 'nursing'];
const BUSINESS = ['finance', 'consulting', 'accounting', 'marketing'];
const from = (src, ...ids) => ids.map((id) => ({ id, from: src }));
{
  const hands = club('Hands of Health', { kind: 'pre-professional', goals: from('override', ...HEALTH) });
  const aed = club('Alpha Epsilon Delta Pre-Health Society', { kind: 'professional-society', national: 'AED', goals: from('national', ...HEALTH) });
  const pph = club('Pre-Health Psychology Association', { kind: 'pre-professional', goals: from('name', ...HEALTH) });
  const sna = club("Student Nurses' Association", { kind: 'pre-professional', goals: named('nursing') });
  const frat = club('Phi Chi Theta Professional Business Fraternity', { kind: 'professional-fraternity', national: 'Phi Chi Theta', goals: from('national', ...BUSINESS) });
  const alpfa = club('ALPFA Illinois', { kind: 'professional-society', national: 'ALPFA', goals: from('national', 'accounting', 'finance') });
  const acct = club('Accounting Club', { kind: 'professional-society', goals: named('accounting') });
  const ib = club('Prime Mergers & Acquisitions', { kind: 'professional-society', goals: named('investment-banking') });
  const cons = club('Illinois Consulting Group', { kind: 'consulting-investing', goals: named('consulting') });
  const data = file([hands, aed, pph, sna, frat, alpfa, acct, ib, cons]);
  const whyOf = (r) => Object.fromEntries(r.picks.map((p) => [p.club.name, p.why]));
  const nurse = whyOf(rec(data, student('I want to be a nurse')));
  expect(nurse["Student Nurses' Association"] === 'About nursing, which you said you want', 'a nursing club is "About nursing"');
  expect(['Hands of Health', 'Alpha Epsilon Delta Pre-Health Society', 'Pre-Health Psychology Association'].every((n) => nurse[n] === C.PRE_HEALTH_WHY), `a general pre-health club (override, national or name) says what it is: "${C.PRE_HEALTH_WHY}", never "About nursing"`, JSON.stringify(nurse));
  const premed = whyOf(rec(data, student('medical school')));
  expect(premed['Alpha Epsilon Delta Pre-Health Society'] === C.PRE_HEALTH_WHY, 'the same line for a pre-med student');
  const cpa = whyOf(rec(data, student('CPA at a Big Four firm')));
  expect(cpa['Accounting Club'] === 'About accounting/CPA, which you said you want' && cpa['Phi Chi Theta Professional Business Fraternity'] === C.BUSINESS_FRATERNITY_WHY, `a business fraternity is "${C.BUSINESS_FRATERNITY_WHY}", not "About accounting/CPA"`, JSON.stringify(cpa));
  expect(cpa['ALPFA Illinois'] === 'The ALPFA chapter, for students heading into accounting/CPA and finance', 'any other national row with two or more goals names the chapter and its fields', cpa['ALPFA Illinois']);
  const banker = whyOf(rec(data, student('investment banking')));
  expect(banker['Phi Chi Theta Professional Business Fraternity'] === C.BUSINESS_FRATERNITY_WHY && banker['Prime Mergers & Acquisitions'] === 'About investment banking/corporate finance, which you said you want', 'for investment banking: the fraternity is not "a finance club"; the M&A club is about investment banking', JSON.stringify(banker));
  const consultant = whyOf(rec(data, student('management consulting')));
  expect(consultant['Phi Chi Theta Professional Business Fraternity'] === C.BUSINESS_FRATERNITY_WHY && consultant['Illinois Consulting Group'] === 'About consulting, which you said you want', 'for consulting: the fraternity is not "About consulting"', JSON.stringify(consultant));
  expect(C.familyLine(sna, (x) => x) === null && C.familyLine(acct, (x) => x) === null, 'a club named for one goal has no family line');
}

// ---------------------------------------------------------------------------
console.log('\nAfter the 2026-10-05 spot check: a goal the planner does not know (b)');

{
  expect(C.stem('nonprofits') === C.stem('nonprofit') && C.stem('orchestral') === C.stem('orchestra') && C.stem('musicians') === C.stem('music') && C.stem('advertising') === C.stem('advertisement'), 'the stem: plurals and endings ("orchestral" is "orchestra", "musicians" is "music")');
  expect(C.stem('policy') !== C.stem('police') && C.stem('kids') === C.stem('children'), '"policy" is never "police"; "kids" is "children"');
  const words = C.studentWords('my sister is pre-law, I want to build bridges', interestProfile).map((w) => w.word);
  expect(!words.includes('law') && !words.includes('sister') && words.includes('bridges'), 'a word the goal reader set aside ("pre-law" for a sister) and family words are not matched', words.join(','));
  // Review, 2026-10-05: words club lines use in passing, in too few clubs for the count to rule out, and stems that fold one word into another.
  const passing = ['make money', 'open a bakery', 'travel the world', 'change the world', 'work remotely', 'coach basketball', 'save lives'].flatMap((t) => C.studentWords(t, interestProfile).map((w) => w.word));
  expect(passing.every((w) => ['bakery', 'basketball'].includes(w)), 'generic words of a goal sentence are not matched ("money", "open", "travel", "change", "remotely", "coach", "lives")', passing.join(','));
  expect(C.stem('planes') !== C.stem('plans') && C.stem('planes') === C.stem('plane') && C.stem('news') !== C.stem('new') && C.stem('anime') !== C.stem('animals') && C.stem('minority') !== C.stem('minors'), 'the stem keeps "planes" from "plans", "news" from "new", "anime" from "animals", "minority" from "minors"');
  const lab = Array.from({ length: 32 }, (_, i) => club(`Lab Circle ${i}`, { kind: 'academic', categories: ['Life & Physical Sciences'], does: 'Members read papers and do research together.' }));
  const scno = club('Students Consulting for Nonprofit Organizations', { kind: 'consulting-investing', categories: ['Business'], does: 'Student teams take on consulting projects for local groups.' });
  const kids = club('Cards for Kids', { kind: 'service', categories: ['Community Service & Philanthropy'], does: 'Members run games at a hospital.' });
  const tutor = club('Reading Buddies', { kind: 'service', categories: ['Community Service & Philanthropy'], does: 'Members tutor local children after school.' });
  const engineering = club('Prototype Lab', { kind: 'academic', categories: ['Technology, Engineering & Mathematics'], does: 'Members build devices for nonprofit partners.' });
  const soc = club('Sociology Student Organization', { kind: 'academic', subjects: ['SOC'] });
  const exploratory = club('Exploratory Students Association', { kind: 'academic', starter: 'undeclared' });
  const volunteer = club('Campus Volunteer Leadership Association', { kind: 'service', starter: true });
  const data = file([...lab, scno, kids, tutor, engineering, soc, exploratory, volunteer]);
  const sociology = { programName: 'Sociology, BALAS', degree: { primary: 'SOC', subjects: ['SOC'] } };
  const r = rec(data, student('work for a nonprofit that helps kids', sociology), { limit: 6 });
  const order = names(r.picks);
  expect(r.unknownGoal === true && !r.undecided && r.empty === undefined && r.goals.length === 0, 'words that name no goal the planner knows: unknownGoal, not undecided');
  expect(!r.picks.some((p) => p.why === C.STARTER_WHY), 'never "A good first club while you decide" for a student who named a goal');
  const firstMajor = r.picks.findIndex((p) => p.goal === 'major');
  const lastWords = r.picks.map((p) => p.goal).lastIndexOf('words');
  expect(lastWords >= 0 && firstMajor > lastWords && r.picks.every((p, i) => p.goal !== 'general' || i > firstMajor), 'their words\' clubs first, then their major\'s, then general clubs', order.join('; '));
  const why = Object.fromEntries(r.picks.map((p) => [p.club.name, p.why]));
  expect(why['Students Consulting for Nonprofit Organizations'] === 'Its name has "nonprofit", from what you wrote' && why['Cards for Kids'] === 'Its name has "kids", from what you wrote' && why['Reading Buddies'] === 'Its OneIllinois page mentions "children", close to what you wrote', 'the why line quotes the club\'s own word, and says "close to" for a word close to theirs', JSON.stringify(why));
  expect(order.indexOf('Students Consulting for Nonprofit Organizations') < order.indexOf('Reading Buddies'), 'a word in the name before one in our line about the club; their own word before a word close to it');
  expect(!order.some((n) => n.startsWith('Lab Circle')), 'one generic word ("research", in more than 30 clubs) never makes a match');
  const note = C.emptyNote(r, 'work for a nonprofit that helps kids') ?? '';
  expect(note.startsWith('The planner does not know “work for a nonprofit that helps kids” as a goal yet, so the clubs below match your own words or your major.'), 'the card says plainly the planner does not know the goal, and where the clubs came from', note);
  const research = rec(data, student('do research in a lab', sociology));
  expect(!names(research.picks).some((n) => n.startsWith('Lab Circle')) && research.unknownGoal === true, '"do research in a lab": no club matched on "research" alone', names(research.picks).join('; '));
  const general = rec(data, student('be a pastry chef', sociology));
  expect(general.picks.filter((p) => p.goal === 'general').every((p) => p.why === C.GENERAL_WHY) && general.picks.some((p) => p.goal === 'general') && !names(general.picks).includes('Exploratory Students Association'), `starters for a goal the planner does not know are labelled general ("${C.GENERAL_WHY}"); the group for undeclared students is not shown to a declared major`, general.picks.map((p) => `${p.club.name}: ${p.why}`).join('; '));
  const undeclared = rec(data, student('be a pastry chef'));
  expect(names(undeclared.picks).includes('Exploratory Students Association') && undeclared.empty === 'unheard', 'with no major, the group for undeclared students is a general club too');
  expect(C.groupPicks(r).map((g) => g.heading).join(' | ') === 'From what you wrote | For your major', 'groupPicks: "From what you wrote" before "For your major"', C.groupPicks(r).map((g) => g.heading).join(' | '));
  const tool = T.runFindClubs({}, student('work for a nonprofit that helps kids', sociology), data, { today: TODAY });
  expect(tool.ok && /no goal the planner knows yet: say so plainly/.test(tool.note) && tool.clubs[0]?.for_goal === 'what you wrote' && tool.summary.endsWith('for what you wrote'), "find_clubs tells ALMA the goal is unknown, and which clubs came from the student's words", tool.ok ? `${tool.summary} | ${tool.note}` : '');
  const bridges = file([club('Steel Bridge', { kind: 'academic', subjects: ['CEE'], categories: ['Technology, Engineering & Mathematics'] }), club('Life-Line Bridge Foundation', { kind: 'service', categories: ['Community Service & Philanthropy'], does: 'Members fundraise for families in poverty.' }), club('American Society of Civil Engineers', { kind: 'professional-society', national: 'ASCE', subjects: ['CEE'], categories: ['Technology, Engineering & Mathematics'] })]);
  const civil = rec(bridges, student('my sister is pre-law, I want to build bridges', { programName: 'Civil Engineering, BS', degree: { primary: 'CEE', subjects: ['CEE'] } }));
  expect(names(civil.picks).join('; ') === 'Steel Bridge; American Society of Civil Engineers; Life-Line Bridge Foundation', 'a word match outside the major\'s field (a charity named "Bridge" for a civil engineer) does not come first', names(civil.picks).join('; '));
}

// ---------------------------------------------------------------------------
console.log('\nAfter the 2026-10-05 spot check: consulting, the fill, venture capital (c, d, e)');

{
  const cubed = club('Business Consulting Club', { kind: 'consulting-investing', goals: named('consulting'), does: 'Teams do projects for local businesses.' });
  const icg = club('Illinois Consulting Group', { kind: 'consulting-investing', goals: named('consulting'), does: 'Teams do management consulting projects for clients.' });
  const r = rec(file([cubed, icg]), student('management consulting'));
  expect(names(r.picks).join('; ') === 'Illinois Consulting Group; Business Consulting Club', 'a goal heard: the student\'s other words ("management") in a club\'s facts break a tie', names(r.picks).join('; '));
  expect(r.picks[0].score - r.picks[1].score <= 2 * C.WORDS_TIE + 1e-9, 'the words tiebreak is small: at most two WORDS_TIE');

  const robots = [1, 2, 3, 4, 5, 6].map((i) => club(`Robotics Team ${i}`, { kind: 'competition-team', goals: named('robotics') }));
  const asme = club('American Society of Mechanical Engineers', { kind: 'professional-society', national: 'ASME', subjects: ['ME'] });
  const rail = [1, 2, 3].map((i) => club(`Railway Society ${i}`, { kind: 'professional-society', subjects: ['CEE'], colleges: ['engineering'] }));
  const me = rec(file([...robots, asme, ...rail]), student('design robots', { programName: 'Mechanical Engineering, BS', college: 'engineering', degree: { primary: 'ME', subjects: ['ME', 'CEE'] } }));
  const goalsAt = me.picks.map((p, i) => (p.goal === 'robotics' ? i : -1)).filter((i) => i >= 0);
  const fillAt = me.picks.findIndex((p) => p.basis === 'degree-subject');
  expect(goalsAt.length === 6 && fillAt > Math.max(...goalsAt) && me.picks.length === 10, 'another subject of the degree fills only after every club for the goal: six robotics teams before the railway societies', me.picks.map((p) => `${p.club.name} (${p.basis})`).join('; '));
  expect(me.picks.slice(0, 5).some((p) => p.club.name === 'American Society of Mechanical Engineers'), 'the major club keeps its visible row');
}

// ---------------------------------------------------------------------------
console.log('\nAfter the round-2 spot check: a goal\'s own clubs first, family clubs after, thin goals said so');

{
  const frat = (n) => club(`${n} Professional Business Fraternity`, { kind: 'professional-fraternity', national: n, goals: from('national', ...BUSINESS) });
  const fraternities = ['Alpha Beta', 'Gamma Delta', 'Epsilon Zeta'].map(frat);
  const mergers = club('Mergers Group', { kind: 'consulting-investing', goals: named('investment-banking') });
  const deals = club('Deal Team', { kind: 'consulting-investing', goals: from('override', 'investment-banking') });
  const pitch = club('Stock Pitch Club', { kind: 'consulting-investing', goals: named('markets') });
  const finance = club('Finance Society', { kind: 'professional-society', goals: named('finance') });
  const estate = club('Real Estate Club', { kind: 'professional-society', goals: named('real-estate') });
  const r = rec(file([...fraternities, mergers, deals, pitch, finance, estate]), student('investment banking'));
  const order = names(r.picks);
  expect(order.join('; ') === 'Deal Team; Mergers Group; Stock Pitch Club; Finance Society; Alpha Beta Professional Business Fraternity; Real Estate Club; Epsilon Zeta Professional Business Fraternity; Gamma Delta Professional Business Fraternity', 'investment banking: its own clubs, then a markets club (a near sibling), then the finance club with one business fraternity, then real estate, then the other fraternities', order.join('; '));
  expect(r.picks.slice(0, 5).filter((p) => p.why === C.BUSINESS_FRATERNITY_WHY).length <= 1, 'at most one business fraternity in the first five while the goal\'s own clubs remain');
  expect(r.picks.find((p) => p.club.name === 'Stock Pitch Club')?.why === 'An asset management/markets/trading club, close to investment banking/corporate finance', 'the near sibling still says "close to": a markets club is not an investment banking club');
  expect((C.NEAR_SIBLINGS?.['investment-banking'] ?? []).includes('markets') && !(C.NEAR_SIBLINGS?.['investment-banking'] ?? []).includes('real-estate'), 'markets is near investment banking; real estate is not');
}
{
  const pt = club('Pre-PT Society', { kind: 'pre-professional', goals: named('pre-physical-therapy') });
  const generalists = [1, 2, 3, 4, 5].map((i) => club(`Pre-Health Circle ${i}`, { kind: 'pre-professional', goals: from('name', ...HEALTH) }));
  const ksa = club('Kinesiology Student Association', { kind: 'academic', subjects: ['HK'], majors: ['Kinesiology'] });
  const women = club('Women in Physical Therapy', { kind: 'professional-society', identity: true, goals: named('pre-physical-therapy') });
  const data = file([pt, ...generalists, ksa, women]);
  const kin = { programName: 'Kinesiology: Applied Exercise Science, BS', college: 'ahs', degree: { primary: 'HK', subjects: ['HK'] } };
  const r = rec(data, student('physical therapy school', kin));
  expect(r.thin.includes('pre-physical-therapy') && r.matched['pre-physical-therapy'] === 1, 'one pre-PT club and five general pre-health clubs: the goal is thin (1 of its own), however many family clubs follow', JSON.stringify(r.matched));
  expect(r.picks[0]?.club.name === 'Pre-PT Society' && r.picks.filter((p) => p.goal === 'pre-physical-therapy').slice(1).every((p) => p.why === C.PRE_HEALTH_WHY), 'the pre-PT club first; the general pre-health clubs after it, saying what they are');
  const ksaPick = r.picks.findIndex((p) => p.club.name === 'Kinesiology Student Association');
  expect(ksaPick >= 0 && ksaPick < 5 && r.picks[ksaPick].why === 'Named for Kinesiology, your major', 'the major\'s own club (set for Kinesiology by `majors`) keeps a visible row', names(r.picks).join('; '));
  const note = C.thinNote(data, 'pre-physical therapy (DPT)', r.matched['pre-physical-therapy'], r.communityMatched?.['pre-physical-therapy'] ?? 0);
  expect(note.text === `Only 1 club in OneIllinois matched pre-physical therapy (DPT), plus 1 in “${C.COMMUNITIES_HEADING}” below.`, 'the thin message counts the goal\'s clubs in the communities row, so it never says "only 1" above two', note.text);
  const none = C.thinNote(data, 'athletic training', 0, 2).text;
  expect(none === `No club in OneIllinois matched athletic training yet, except 2 in “${C.COMMUNITIES_HEADING}” below.`, 'none of its own but 2 in the communities row: "except 2", never "No club ... plus 2" (review, round 3)', none);
  const ch = rec(data, student('physical therapy school', { programName: 'Community Health, BS', college: 'ahs', degree: { primary: 'HK', subjects: ['HK'] } }));
  expect(!names(ch.picks).includes('Kinesiology Student Association'), 'a club set for the Kinesiology major is not a Community Health student\'s, though both majors are HK');
  const fsci = club('Food Technologists', { kind: 'professional-society', subjects: ['FSHN'], majors: ['Food Science'] });
  const food = rec(file([fsci]), student('', { programName: 'Food Science, BS', degree: { primary: 'FSHN', subjects: ['FSHN'] } }));
  const hosp = rec(file([fsci]), student('', { programName: 'Hospitality Management, BS', degree: { primary: 'FSHN', subjects: ['FSHN'] } }));
  expect(food.picks[0]?.why === 'A professional society for students in Food Science, your major' && !names(hosp.picks).includes('Food Technologists'), 'FSHN: a food science club is for Food Science students, "for students in" their major, and not for Hospitality Management');
}
{
  const acct = club('Accounting Society', { kind: 'professional-society', goals: named('accounting'), colleges: ['bus'] });
  const bap = club('Beta Alpha Psi', { kind: 'honor', national: 'Beta Alpha Psi', subjects: ['ACCY'], goals: from('national', 'accounting') });
  const frats = ['Alpha Beta', 'Gamma Delta'].map((n) => club(`${n} Professional Business Fraternity`, { kind: 'professional-fraternity', national: n, goals: from('national', ...BUSINESS) }));
  const s = student('CPA at a Big Four firm', { programName: 'Accountancy, BS', college: 'bus', degree: { primary: 'ACCY', subjects: ['ACCY'] }, firstYear: true });
  const r = rec(file([acct, bap, ...frats]), s);
  expect(names(r.picks).join('; ') === 'Accounting Society; Beta Alpha Psi; Alpha Beta Professional Business Fraternity; Gamma Delta Professional Business Fraternity', 'a first-year future CPA: the accounting club and the accounting honor society, then the business fraternities', names(r.picks).join('; '));
  expect(r.picks[1].cautions[0] === 'By invitation, usually by GPA or standing', 'the honor society keeps its caution');
}
{
  const science = { kind: 'professional-society', subjects: ['NRES'], categories: ['Environmental & Sustainability', 'Life & Physical Sciences'] };
  const fish = club('Fisheries Society', { ...science, national: 'FS', goals: from('national', 'climate-environment') });
  const wild = club('Wildlife Society', { ...science, national: 'WS', goals: from('national', 'climate-environment') });
  const advocacy = club('Students for Clean Air', { kind: 'government-advocacy', categories: ['Advocacy & Activism', 'Environmental & Sustainability', 'Ideology & Politics'], goals: named('climate-environment') });
  const council = club('Green Council', { kind: 'government-advocacy', categories: ['Advocacy & Activism', 'Environmental & Sustainability'], goals: from('reading', 'climate-environment') });
  const policy = club('Policy Leaders', { kind: 'professional-society', categories: ['Ideology & Politics'], goals: named('public-policy') });
  const s = student('climate policy for the government', { programName: 'Earth, Society, & Environmental Sustainability, BSLAS', degree: { primary: 'ESE', subjects: ['ESE', 'NRES'] } });
  const r = rec(file([fish, wild, advocacy, council, policy]), s);
  const at = (n) => names(r.picks).indexOf(n);
  expect(r.goals.map((g) => g.id).join() === 'climate-environment,public-policy,politics', '"climate policy for the government" hears climate, public policy and politics');
  expect(at('Students for Clean Air') === 0 && at('Green Council') >= 0 && at('Green Council') < at('Fisheries Society') && at('Policy Leaders') < at('Fisheries Society') && at('Green Council') < at('Wildlife Society'), 'a policy goal: environmental advocacy groups (one tagged only by the reading pass) and the policy club before fisheries and wildlife science societies', names(r.picks).join('; '));
  const plain = rec(file([fish, wild, advocacy, council]), student('environmental science', { programName: 'Earth, Society, & Environmental Sustainability, BSLAS', degree: { primary: 'ESE', subjects: ['ESE', 'NRES'] } }));
  expect(plain.goals.map((g) => g.id).join() === 'climate-environment' && names(plain.picks)[0] === 'Fisheries Society' && !names(plain.picks).includes('Green Council'), 'one goal, no policy in it: nothing changes (the science society named for it may lead; the reading-only council stays under the cutoff)', names(plain.picks).join('; '));
}
{
  const latina = club('ALPFA Illinois', { kind: 'professional-society', identity: true, national: 'ALPFA', does: 'Members build professional skills in events rooted in Latino heritage.', goals: from('national', 'accounting', 'finance') });
  const black = club('Black Finance Students', { kind: 'professional-society', identity: true, goals: named('finance') });
  const mergers = club('Mergers Group', { kind: 'consulting-investing', goals: named('investment-banking') });
  const data = file([latina, black, mergers]);
  const r = rec(data, student("I'm a first-gen Latina student and I want to work in corporate finance"));
  expect(names(r.picks).includes('ALPFA Illinois') && !names(r.communities).includes('ALPFA Illinois') && names(r.communities).join() === 'Black Finance Students', 'a community the student says they belong to joins the main list; another community\'s club stays in the folded row', `${names(r.picks).join('; ')} | ${names(r.communities).join('; ')}`);
  const consult = file([club('Women in Consulting', { kind: 'professional-society', identity: true, goals: named('consulting') }), club('International Consulting Society', { kind: 'professional-society', identity: true, goals: named('consulting') }), club('Consulting Group', { kind: 'consulting-investing', goals: named('consulting') })]);
  expect(names(rec(consult, student('As a woman in tech I want to do consulting')).picks).includes('Women in Consulting'), '"As a woman in tech ...": she said it of herself');
  // Review, round 3: what follows "I'm" is about the student only up to a joining word, a preposition, a verb or a "no".
  const notSaid = ["I'm interested in women's health and I want to do consulting", "I'm not a woman, I want to do consulting", 'I want to do consulting, such as a women-led firm'].filter((t) => names(rec(consult, student(t)).picks).includes('Women in Consulting'));
  expect(notSaid.length === 0, '"I\'m interested in women\'s health", "I\'m not a woman", "such as a women-led firm": none says who the student is, so no identity club joins the main list', notSaid.join(' | '));
  const curly = rec(data, student('I’m a first-gen Latina student and I want to work in corporate finance'));
  expect(names(curly.picks).includes('ALPFA Illinois'), 'a curly apostrophe ("I’m", as phones type it) is read as "I\'m"', names(curly.picks).join('; '));
  expect(!names(rec(data, student("I'm not Latina, but I want to work in corporate finance")).picks).includes('ALPFA Illinois'), '"I\'m not Latina": not a self-description, ALPFA stays in the folded row');
  const field = rec(consult, student('international business consulting'));
  expect(names(field.picks).join() === 'Consulting Group', '"international business consulting" names a field, not the student: no identity club comes up', names(field.picks).join('; '));
}
{
  const computing = club('Computing Society', { kind: 'professional-society', goals: named('software-engineering') });
  const dataClub = club('Data Club', { kind: 'academic', goals: named('data-science') });
  const whyOf = (r) => Object.fromEntries(r.picks.map((p) => [p.club.name, p.why]));
  const ds = whyOf(rec(file([computing, dataClub]), student('data analyst')));
  const swe = whyOf(rec(file([computing, dataClub]), student('software engineer')));
  expect(ds['Computing Society'] === 'A software engineering club, close to data science/analytics' && swe['Data Club'] === 'A data science/analytics club, close to software engineering', 'the wider field says what the club is and that it is close, never "data science is part of software engineering"', `${ds['Computing Society']} | ${swe['Data Club']}`);
  const band = club('National Band Association, UIUC Collegiate Chapter', { kind: 'professional-society', national: 'NBA', subjects: ['MUS'] });
  const heat = club('American Society of the Heating, Refrigeration & Air-Conditioning Engineers', { kind: 'professional-society', national: 'ASHRAE', subjects: ['ME'] });
  const music = rec(file([band]), student('', { programName: 'Instrumental Music, BMUS', degree: { primary: 'MUS', subjects: ['MUS'] } }));
  const me = rec(file([heat]), student('', { programName: 'Mechanical Engineering, BS', degree: { primary: 'ME', subjects: ['ME'] } }));
  expect(music.picks[0]?.why === 'The National Band Association student chapter, for Instrumental Music students', 'a national body\'s letters the club\'s name does not use are spelled out: never "the NBA student chapter"', music.picks[0]?.why);
  expect(me.picks[0]?.why === 'The ASHRAE student chapter, for Mechanical Engineering students', 'a name too long for the line keeps its letters, and a comma inside the name is not cut', me.picks[0]?.why);
  expect(C.nationalName({ name: 'ALPFA Illinois', national: 'ALPFA' }) === 'ALPFA' && C.nationalName({ name: 'The Wildlife Society, University of Illinois at Urbana-Champaign Student Chapter', national: 'TWS' }) === 'Wildlife Society' && C.nationalName({ name: 'American Fisheries Society, U of I Student Subunit', national: 'AFS' }) === 'American Fisheries Society', 'nationalName: letters the name uses; otherwise the body\'s name without the campus or chapter');
}
{
  const robots = [1, 2, 3, 4, 5].map((i) => club(`Robotics Team ${i}`, { kind: 'competition-team', goals: named('robotics') }));
  const asme = club('American Society of Mechanical Engineers', { kind: 'professional-society', national: 'ASME', subjects: ['ME'] });
  const hvac = club('Heating Engineers Society', { kind: 'professional-society', national: 'HES', subjects: ['ME'] });
  const r = rec(file([...robots, asme, hvac]), student('design robots', { programName: 'Mechanical Engineering, BS', degree: { primary: 'ME', subjects: ['ME'] } }));
  const order = names(r.picks);
  expect(order.indexOf('American Society of Mechanical Engineers') < 5 && order.indexOf('Heating Engineers Society') > Math.max(...robots.map((c) => order.indexOf(c.name))), 'a goal heard: the major\'s best club keeps a visible row, its second waits behind every club for the goal (ASHRAE had row five for "design robots")', order.join('; '));
}
{
  expect(!/\bpilot\b/.test(C.withoutOtherSense('Members run a pilot plant and a pilot program.')) && /\bpilots\b/.test(C.withoutOtherSense('Members train drone pilots.')), 'withoutOtherSense: "pilot plant", "pilot program" drop the word; "drone pilots" keeps it');
  expect(!/\bspace\b/i.test(C.withoutOtherSense('A welcoming space for students; a space to relax. Product Space')) && /\bSpace\b/.test(C.withoutOtherSense('Illinois Space Society')), 'withoutOtherSense: "a space for", "welcoming space", "Product Space" drop it; "Illinois Space Society" keeps it');
  const biodiesel = club('Biodiesel Initiative', { kind: 'academic', categories: ['Environmental & Sustainability'], does: 'Members make fuel from cooking oil in a pilot plant on campus.' });
  const drones = club('Drone Team', { kind: 'competition-team', categories: ['Technology, Engineering & Mathematics'], does: 'Members build drones and train as drone pilots.' });
  const comedy = club('Comedy Hour', { kind: 'arts-performance', categories: ['Performance Arts'], does: 'A space for students to try stand-up.' });
  const product = club('Product Space UIUC', { kind: 'consulting-investing', categories: ['Business'], does: 'Members learn product management.' });
  const rockets = club('Illinois Space Society', { kind: 'professional-society', categories: ['Technology, Engineering & Mathematics'], does: 'Members build rockets and payloads.' });
  const data = file([biodiesel, drones, comedy, product, rockets]);
  const pilot = rec(data, student('become a pilot')).picks.filter((p) => p.goal === 'words');
  const space = rec(data, student('work in space')).picks.filter((p) => p.goal === 'words');
  expect(names(pilot).join() === 'Drone Team' && names(space).join() === 'Illinois Space Society', 'a word with a common other sense matches only where it means the goal: no pilot plant for "become a pilot", no "a space for" or Product Space for "work in space"', `${names(pilot).join('; ')} | ${names(space).join('; ')}`);
  expect(!names(C.searchClubs(data, 'space', student('')).picks).includes('Comedy Hour'), "ALMA's search reads the same senses");
}

// ---------------------------------------------------------------------------
console.log("\nALMA's search");

{
  const pl = [1, 2, 3].map((i) => club(`Pre-Law Club ${i}`, { kind: 'pre-professional', goals: named('pre-law') }));
  const cap = club('Illini A Cappella', { kind: 'arts-performance', categories: ['Performance Arts'] });
  const chess = club('Chess Club', { kind: 'social', categories: ['Social & Leisure'] });
  const frat = club('Alpha Beta Fraternity', { kind: 'greek-social', categories: ['Social Fraternities & Sororities'] });
  const latina = club('Latinas in Business', { kind: 'professional-society', identity: true, categories: ['Business', 'Identity & Culture'] });
  const biz = club('Business Society', { kind: 'professional-society', categories: ['Business'] });
  const fin = club('Finance Society', { kind: 'professional-society', goals: named('finance') });
  const nsbe = club('National Society of Black Finance Students', { kind: 'professional-society', identity: true, goals: named('finance') });
  const shpe = club('Hispanic Finance Association', { kind: 'professional-society', identity: true, goals: named('finance') });
  const data = file([...pl, cap, chess, frat, latina, biz, fin, nsbe, shpe]);
  const s = student('');
  const q = C.searchClubs(data, 'pre-law', s, { today: TODAY });
  const rail = rec(data, student('pre-law'), { limit: 6 });
  expect(names(q.picks).join() === names(rail.picks).join() && q.goals[0].id === 'pre-law', 'a query that names a goal ranks exactly as the rail does for it');
  expect(names(C.searchClubs(data, 'a cappella groups', s).picks).join() === 'Illini A Cappella', '"a cappella" finds the a cappella group by its name');
  {
    const groups = file([club('Improv Troupe', { kind: 'arts-performance' }), club('Ballet Club', { kind: 'arts-performance' }), club('Treble A Cappella', { kind: 'arts-performance', joining: 'closed' }), club('Off The Record', { kind: 'arts-performance', does: 'Members sing in a co-ed a cappella group.' }), club('Open A Cappella', { kind: 'arts-performance' })]);
    const found = C.searchClubs(groups, 'a cappella', s);
    expect(names(found.picks).slice(0, 3).join('; ') === 'Open A Cappella; Treble A Cappella; Off The Record', 'every a cappella group (one not taking sign-ups, one named only in our line) before groups that are only the kind asked for', names(found.picks).join('; '));
    expect(found.picks[2].why === 'An arts and performance group; its OneIllinois page describes a cappella' && found.picks[0].why === 'Its name matches "a cappella"', 'the why says "a cappella", as the student wrote it', found.picks.map((p) => p.why).join(' | '));
  }
  expect(names(C.searchClubs(data, 'is there a chess club?', s).picks).join() === 'Chess Club', 'a social club comes back when the student names it');
  expect(names(C.searchClubs(data, 'fraternity', s).picks).join() === 'Alpha Beta Fraternity', '"fraternity" asks for Greek life, so it comes back');
  const bizOnly = C.searchClubs(data, 'business clubs', s);
  expect(!names(bizOnly.picks).includes('Latinas in Business') && names(bizOnly.picks).includes('Business Society'), 'an identity-centered club does not come back for "business" alone');
  expect(names(C.searchClubs(data, 'any Latina business groups?', s).picks).join() === 'Latinas in Business', '"Latina business": the identity group the student asked for, matched on both words');
  const finQ = C.searchClubs(data, 'finance', s);
  expect(finQ.communities.length === 0 && names(finQ.picks).join() === 'Finance Society', 'a goal query returns no communities unless the student asked for one');
  const latFin = C.searchClubs(data, 'Latina finance', s);
  expect(names(latFin.communities).join() === 'Hispanic Finance Association', '"Latina finance": the community the student named, not every identity group in finance', names(latFin.communities).join('; '));
  const eng = file([club('Latinx Society', { kind: 'cultural', identity: true, categories: ['Identity & Culture'] }), club('Engineering Society', { kind: 'professional-society', categories: ['Technology, Engineering & Mathematics'] }), club('Black Engineers Association', { kind: 'professional-society', identity: true, categories: ['Technology, Engineering & Mathematics'] })]);
  expect(names(C.searchClubs(eng, 'Latina engineering groups', s).picks).join() === 'Latinx Society', 'a community the student named must match: not another community\'s engineering group, not a general one', names(C.searchClubs(eng, 'Latina engineering groups', s).picks).join('; '));
  const nothing = C.searchClubs(data, 'pastry chef', s);
  expect(nothing.picks.length === 0 && nothing.empty === 'no-match', 'nothing matched: an empty list, said plainly');
  // A kind found by its kind alone gets a noun: "An arts and performance group", not "An arts and performance".
  const byKind = file([club('Improv Troupe', { kind: 'arts-performance' }), club('Campus Radio', { kind: 'media' }), club('Voter Project', { kind: 'government-advocacy' }), club('Ultimate Frisbee', { kind: 'sport-recreation' }), club('Helping Hands', { kind: 'service' })]);
  const kindWhy = ['dance', 'podcast', 'advocacy', 'intramural', 'volunteer'].map((q) => C.searchClubs(byKind, q, s).picks[0]?.why ?? '');
  expect(kindWhy.join(' | ') === 'An arts and performance group | A student media group | A government and advocacy group | A sport and recreation club | A service club', 'a club matched by its kind alone is called "a ... group" or "a ... club"', kindWhy.join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\nfind_clubs');

{
  expect(T.FIND_CLUBS_TOOL.name === 'find_clubs' && T.FIND_CLUBS_TOOL.input_schema.properties.limit.maximum === 10 && !('required' in T.FIND_CLUBS_TOOL.input_schema), 'the tool: find_clubs, every input optional, at most 10');
  expect(T.CLUBS_RULES.split('\n').length === 9 && T.CLUBS_RULES.split('\n').every((l) => l.startsWith('- ')) && /set_priorities/.test(T.CLUBS_RULES) && /at most 4 clubs/.test(T.CLUBS_RULES), 'nine rules, in the ILLINOIS_RULES style, including "at most 4" and the set_priorities trap');
  const consulting = [1, 2, 3].map((i) => club(`Consulting Group ${i}`, { kind: 'consulting-investing', goals: named('consulting'), events: { n120: 1, next: ['2026-10-20'], last: '2026-09-30' } }));
  const comm = club('Women in Consulting', { kind: 'professional-society', identity: true, goals: named('consulting') });
  const web = club('Strategy Club', { kind: 'consulting-investing', goals: named('consulting'), website: 'https://strategy.example.org' });
  const data = file([...consulting, comm, web]);
  const s = student('management consulting');
  const r = T.runFindClubs({}, s, data, { today: TODAY });
  const rail = rec(data, s, { limit: 6, communities: false });
  expect(r.ok && r.clubs.map((c) => c.name).join() === names(rail.picks).join(), 'no query: exactly the rail\'s list');
  expect(r.ok && !r.communities && r.summary === '4 clubs for consulting', 'no query: no communities row for ALMA (identity groups only when asked); the summary counts the clubs', r.ok ? r.summary : '');
  const first = r.ok ? r.clubs.find((c) => c.name === 'Consulting Group 1') : null;
  expect(first?.kind === 'Consulting or investing club' && first.for_goal === 'consulting' && first.next_event === '2026-10-20' && first.last_event === '2026-09-30', 'each club: kind label, the goal it is for, next and last event dates');
  expect(r.ok && r.sources.length === 4 && r.sources.every((x, i) => x.n === i + 1 && x.title && x.url && x.host) && r.sources.some((x) => x.host === 'strategy.example.org'), 'sources in the ask-router shape { n, title, url, host }, one per club, the club\'s own site when it has no profile');
  expect(r.ok && r.source.name === 'OneIllinois' && r.source.checked === '2026-10-04' && r.source.stale === false, 'the source comes from the file, with its date');
  const lim = T.runFindClubs({ limit: 2 }, s, data, { today: TODAY });
  const big = T.runFindClubs({ limit: 99 }, s, data, { today: TODAY });
  expect(lim.ok && lim.clubs.length === 2 && big.ok && big.clubs.length === 4, 'limit is honored and clamped to 10');
  const goal = T.runFindClubs({ goal: 'consulting' }, s, data, { today: TODAY });
  expect(goal.ok && goal.goals_used[0].id === 'consulting' && goal.clubs.length === 4, 'goal: more clubs for one of the board\'s goals');
  const asked = T.runFindClubs({ query: 'women in consulting' }, s, data, { today: TODAY });
  expect(asked.ok && (asked.communities ?? []).map((c) => c.name).join() === 'Women in Consulting', 'a query that asks for a community gets the communities row');
  const none = T.runFindClubs({ query: 'pastry chef' }, s, data, { today: TODAY });
  expect(none.ok && none.clubs.length === 0 && /No club in OneIllinois matched "pastry chef"/.test(none.none ?? '') && none.sources[0].url === 'https://one.illinois.edu/club_signup', 'nothing matched: says so and gives the directory as the source');
  const missing = T.runFindClubs({}, s, null);
  expect(!missing.ok && missing.sources.length === 0 && /did not load/.test(missing.reason), 'no file: not ok, and no club named');
  const stale = T.runFindClubs({}, s, data, { today: '2027-03-01' });
  expect(stale.ok && stale.source.stale && /may be out of date/.test(stale.note), 'after 120 days the result says the list may be out of date');
  const nobody = T.runFindClubs({}, null, file([club('Starter Club', { starter: true })]), { today: TODAY });
  expect(nobody.ok && nobody.clubs[0]?.for_goal === 'a first club while you decide', 'no student yet: the starters');
}

// ---------------------------------------------------------------------------
console.log('\nThe loader');

{
  const realFetch = globalThis.fetch;
  const hadWindow = 'window' in globalThis;
  let calls = 0;
  let answer = () => new Response('{}', { status: 404 });
  globalThis.window = {};
  globalThis.fetch = async (url, init) => { calls += 1; expect(url === '/illinois/clubs.json' && init?.cache === 'no-cache', 'it fetches /illinois/clubs.json, revalidating'); return answer(); };
  const good = file([club('A')]);
  const json = (v, status = 200, type = 'application/json') => new Response(JSON.stringify(v), { status, headers: { 'content-type': type } });

  L.resetClubsCache(); calls = 0; answer = () => new Response('not found', { status: 404 });
  const [a, b] = await Promise.all([L.loadIllinoisClubs(), L.loadIllinoisClubs()]);
  const c = await L.loadIllinoisClubs();
  expect(!a.ok && a.reason === 'missing' && b === a && c === a && calls === 1, 'a 404 settles as missing, is shared by concurrent callers and is never fetched again');
  L.resetClubsCache(); calls = 0; answer = () => json({}, 500);
  const e1 = await L.loadIllinoisClubs();
  answer = () => json(good);
  const e2 = await L.loadIllinoisClubs();
  expect(!e1.ok && e1.reason === 'error' && e2.ok && e2.value.clubs.length === 1 && calls === 2, 'a 500 is forgotten, so the next call (the card\'s "Try again") fetches again');
  L.resetClubsCache(); calls = 0; answer = () => { throw new TypeError('network down'); };
  const e3 = await L.loadIllinoisClubs();
  expect(!e3.ok && e3.reason === 'error', 'a dropped connection is an error, not missing');
  L.resetClubsCache(); answer = () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const h = await L.loadIllinoisClubs();
  expect(!h.ok && h.reason === 'missing', 'a host that answers with the app\'s HTML page: missing');
  L.resetClubsCache(); answer = () => json({ ...good, version: 2 });
  const v2 = await L.loadIllinoisClubs();
  expect(!v2.ok && v2.reason === 'missing', 'a file this code cannot read: missing, not retried');
  L.resetClubsCache(); delete globalThis.window;
  const server = await L.loadIllinoisClubs();
  expect(!server.ok && server.reason === 'server', 'on the server: no fetch, "server"');
  globalThis.fetch = realFetch;
  if (hadWindow) globalThis.window = {};
}

// ---------------------------------------------------------------------------
const REAL = join(ROOT, 'public', 'illinois', 'clubs.json');
if (!existsSync(REAL)) {
  console.log('\n(no public/illinois/clubs.json: run scripts/illinois/clubs/build.mjs for the real-data checks)');
} else {
  console.log('\nThe real file (public/illinois/clubs.json)');
  const data = JSON.parse(readFileSync(REAL, 'utf8'));
  const programs = new Map(JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'programs.json'), 'utf8')).map((p) => [p.id, p]));
  const on = (programId, primary, words, firstYear = true) => {
    const p = programId ? programs.get(programId) : null;
    return student(words, { programName: p?.name ?? null, college: p?.college ?? null, degree: primary ? { primary, subjects: [primary] } : null, firstYear });
  };
  const lawGroup = /\blaw students?\b|\bcollege of law\b|\blaw school\b|\bstudent bar\b/i;

  const prelaw = rec(data, on('las/political-science-balas/general-political-science', 'PS', 'law school'));
  expect(prelaw.picks.length >= 3 && !prelaw.picks.some((p) => lawGroup.test(p.club.name)) && prelaw.picks[0].basis === 'list', '"law school" on Political Science: no law-school group; the first pick is on Pre-Law Advising\'s list', names(prelaw.picks).slice(0, 3).join('; '));
  const swe = rec(data, on('engineering/computer-science-bs', 'CS', 'software engineer at a big tech company'));
  expect(names(swe.picks).slice(0, 3).includes('Association for Computing Machinery'), '"software engineer" on Computer Science: ACM in the first three');
  const undecided = rec(data, on(null, null, 'I have no idea yet'));
  expect(undecided.picks.length > 0 && undecided.picks.every((p) => p.club.starter), '"I have no idea yet" with no degree: the starter clubs only', names(undecided.picks).join('; '));
  expect(undecided.undecided === true && C.emptyNote(undecided, 'I have no idea yet').startsWith('You said you are still deciding, so here are clubs for exploring'), '... and the card says they are clubs for exploring');
  const vet = rec(data, on('aces/animal-sciences-bs/science-pre-veterinary--medical', 'ANSC', 'vet school'));
  const general = /pre[-\s]?health|health\s+professions?|alpha epsilon delta/i;
  const vetPicks = vet.picks.filter((p) => p.goal === 'pre-veterinary');
  expect(vetPicks[0]?.club.name === 'Pre-Vet Club' && !vetPicks.some((p) => general.test(p.club.name)) && !vet.picks.some((p) => general.test(p.club.name) && /For your goal/.test(p.why)) && !vet.thin.includes('pre-veterinary'), '"vet school" on Animal Sciences: the Pre-Vet Club first, no general pre-health club "for your goal", and pre-vet is not thin', names(vet.picks).join('; '));
  const retract = rec(data, on('las/psychology-bslas', 'PSYC', "pre-med actually I don't want to do pre-med anymore, I want UX research"));
  expect(!retract.picks.some((p) => p.club.goals.some((g) => g.id === 'pre-medicine')), '"not pre-med anymore, UX research" on Psychology: no pre-med club');
  const robots = rec(data, on('engineering/mechanical-engineering-bs', 'ME', 'design robots'));
  expect(names(robots.picks).slice(0, 5).includes('American Society of Mechanical Engineers') && robots.picks.filter((p) => p.goal === 'robotics').length >= 2, '"design robots" on Mechanical Engineering: ASME in the first five, and robotics teams', names(robots.picks).slice(0, 5).join('; '));
  const bridges = rec(data, on('engineering/civil-engineering-bs', 'CEE', 'my sister is pre-law, I want to build bridges'));
  expect(!bridges.picks.some((p) => p.club.goals.some((g) => g.id === 'pre-law')) && names(bridges.picks).includes('American Society of Civil Engineers'), '"my sister is pre-law" on Civil Engineering: no pre-law club; ASCE from the major');
  const all = [prelaw, swe, undecided, retract, robots, bridges];
  expect(all.every((r) => r.picks.every((p) => !p.club.identity && !['social', 'greek-social', 'faith', 'cultural', 'sport-recreation'].includes(p.club.kind) || p.goal === 'starter')), 'no identity, social, Greek, faith, cultural or sport club among these picks (starters aside)');
  expect(all.every((r) => r.picks.every((p) => p.why && p.why.length <= 110)), 'every pick has a why line of at most 110 characters');
  // After the 2026-10-05 spot check (a)-(e) and the a cappella search.
  const familyWhy = /^(A pre-health club for students heading to health professions|A professional business fraternity, for students heading into business careers|The .+ chapter, for students heading into .+)$/;
  const isFamily = (c) => {
    const own = c.goals.filter((g) => g.from !== 'reading' && g.from !== 'list');
    return own.filter((g) => /^(pre-(?!law$|veterinary$)[a-z-]+|nursing)$/.test(g.id)).length >= 5 || own.filter((g) => g.from === 'national').length >= 2;
  };
  const nurse = rec(data, on('ahs/community-health-bs', 'HK', 'I want to be a nurse'));
  const aboutNursing = nurse.picks.filter((p) => p.why.startsWith('About nursing')).map((p) => p.club.name);
  expect(aboutNursing.every((n) => /nurs/i.test(n)) && nurse.picks.filter((p) => isFamily(p.club)).every((p) => familyWhy.test(p.why)), '(a) "I want to be a nurse": "About nursing" only on nursing clubs; every general pre-health club says what it is', aboutNursing.join('; '));
  const cpa = rec(data, on('bus/accountancy-bs', 'ACCY', 'CPA at a Big Four firm'));
  const banker = rec(data, on('bus/finance-bs', 'FIN', 'Investment banking in Chicago'));
  const familyPicks = [...cpa.picks, ...cpa.communities, ...banker.picks, ...banker.communities].filter((p) => isFamily(p.club));
  expect(familyPicks.length >= 4 && familyPicks.every((p) => familyWhy.test(p.why)), '(a) business fraternities and multi-goal national chapters (ALPFA) say what they are, not "a finance club" or "About accounting/CPA"', familyPicks.filter((p) => !familyWhy.test(p.why)).map((p) => `${p.club.name}: ${p.why}`).join('; '));
  const unheard = [
    ['las/sociology-balas', 'SOC', 'work for a nonprofit that helps kids', /nonprofit/i],
    ['faa/instrumental-music-bmus', 'MUS', 'play trumpet professionally in an orchestra', /orchestra/i],
    ['media/advertising-bs', 'ADV', 'creative director at an ad agency', /advertising/i],
  ];
  for (const [program, primary, words, first] of unheard) {
    const r = rec(data, on(program, primary, words));
    const note = C.emptyNote(r, words) ?? '';
    expect(r.unknownGoal === true && !r.picks.some((p) => p.why === C.STARTER_WHY) && note.startsWith('The planner does not know') && r.picks.slice(0, 3).some((p) => first.test(p.club.name)) && !r.picks.some((p) => p.club.name === 'Exploratory Students Association'), `(b) "${words}": said plainly the goal is unknown; a club whose facts hold their words in the first three; no "while you decide", no group for undeclared students`, `${names(r.picks).slice(0, 5).join('; ')} | ${note}`);
  }
  const junk = ['make money', 'open a bakery', 'I want to travel the world', 'fly planes'].map((w) => [w, rec(data, on(null, null, w)).picks.filter((p) => p.goal === 'words')]);
  expect(junk.every(([w, ps]) => ps.every((p) => w === 'fly planes' && /"fly"/i.test(p.why))), '(b) on the real file, a generic word never brings a club: no charity for "make money", no tango club for "open", no "plan" for "planes"', junk.map(([w, ps]) => `${w}: ${ps.map((p) => `${p.club.name} (${p.why})`).join('; ')}`).join(' | '));
  const phd = rec(data, on('las/chemistry-bs', 'CHEM', 'get a PhD and do research in chemistry'));
  expect(phd.picks.every((p) => p.goal !== 'words' || !/"research"/.test(p.why)) && names(phd.picks).includes('Undergraduate Pre-PhD Society'), '(b) "a PhD and research in chemistry": no club matched on "research" alone; the Pre-PhD Society from "PhD"', names(phd.picks).join('; '));
  const mgmt = rec(data, on('las/economics-balas', 'ECON', 'management consulting'));
  expect(mgmt.picks[0]?.club.name === 'Illinois Consulting Group' && !mgmt.picks.some((p) => /political/i.test(p.club.name)), '(c) "management consulting": Illinois Consulting Group first, no political consulting club', names(mgmt.picks).slice(0, 4).join('; '));
  const pol = rec(data, on('las/earth-society-environmental-sustainability-bslas', 'ESE', 'climate policy for the government'));
  expect(pol.picks.some((p) => p.club.name === 'Illinois Political Consulting' && p.goal === 'politics'), '(c) Illinois Political Consulting is still there for politics');
  // The degree's other subjects, as degreeSubjects reads the Mechanical Engineering program (the practice student p16).
  const meProgram = programs.get('engineering/mechanical-engineering-bs');
  const meFull = rec(data, student('design robots', { programName: meProgram.name, college: meProgram.college, degree: { primary: 'ME', subjects: ['ME', 'CHEM', 'CEE', 'PHYS', 'MATH', 'TAM', 'ECE', 'CS'] }, firstYear: true }));
  const robotsAll = meFull.picks.filter((p) => p.goal === 'robotics').length;
  const lastRobot = meFull.picks.map((p) => p.goal).lastIndexOf('robotics');
  const firstFill = meFull.picks.findIndex((p) => p.basis === 'degree-subject' || p.basis === 'college');
  expect(robotsAll >= 6 && (firstFill === -1 || firstFill > lastRobot), '(d) "design robots" with the whole degree\'s subjects: six or more robotics teams, and no degree-subject or college fill before them', meFull.picks.map((p) => `${p.club.name} (${p.basis})`).join('; '));
  const vca = data.clubs.find((c) => c.name === 'Venture Capital Association');
  const ibWords = /investment bank|mergers|acquisitions|corporate finance/i;
  const ibLines = banker.picks.filter((p) => /investment banking/i.test(p.why) && !/close to|part of/.test(p.why));
  expect(vca && !vca.goals.some((g) => g.id === 'investment-banking') && ibLines.every((p) => ibWords.test(`${p.club.name} ${p.club.does ?? ''}`)), '(e) no "About investment banking" line unless the club\'s own facts say so; the Venture Capital Association is not tagged investment banking', ibLines.map((p) => p.club.name).join('; '));
  const vc = rec(data, on('bus/finance-bs', 'FIN', 'venture capital'));
  expect(vc.picks.some((p) => p.club.name === 'Venture Capital Association'), '(e) a student who says "venture capital" still finds it');
  const cap = C.searchClubs(data, 'a cappella', on(null, null, ''), { limit: 10, today: TODAY });
  const capNamed = data.clubs.filter((c) => /cappella/i.test(c.name) && (!c.identity || c.kind === 'arts-performance')).map((c) => c.name);
  expect(capNamed.length >= 5 && capNamed.every((n) => names(cap.picks).slice(0, capNamed.length).includes(n)), `"a cappella": all ${capNamed.length} groups named for it come first`, names(cap.picks).join('; '));
  const consulting = T.runFindClubs({ query: 'which clubs should I join for consulting?' }, on('las/economics-balas', 'ECON', 'management consulting'), data, { today: TODAY });
  expect(consulting.ok && consulting.clubs.length >= 3 && consulting.goals_used[0]?.id === 'consulting' && consulting.sources.length === consulting.clubs.length, 'find_clubs "consulting": three or more consulting clubs, each with a source link');
  const latina = T.runFindClubs({ query: 'any Latina business groups?' }, on('bus/finance-bs', 'FIN', ''), data, { today: TODAY });
  console.log(`  info  "any Latina business groups?" returns: ${latina.ok ? latina.clubs.map((c) => c.name).join('; ') || '(none)' : latina.reason}`);
  // After the round-2 spot check (18 of 24 lists useful): the six mixed lists, on the real file.
  const byName = new Map(data.clubs.map((c) => [c.name, c]));
  const FINANCE_CAREER = /^(finance|investment-banking|markets|financial-planning|real-estate|commercial-banking)$/;
  const literacy = ['Personal Finance Club', 'NextGen Finance Initiative', 'Illinois Personal Wealth Management Club', 'Sprout UIUC'].map((n) => byName.get(n));
  expect(literacy.every((c) => c && !c.goals.some((g) => FINANCE_CAREER.test(g.id)) && !(c.subjects ?? []).includes('FIN')), '1. personal-finance literacy clubs carry no finance-career goal and no FIN subject (judged from their name and our own line)', literacy.map((c) => `${c?.name}: ${c?.goals.map((g) => g.id).join(',')}`).join(' | '));
  const corporate = rec(data, on('bus/finance-bs', 'FIN', "I'm a first-gen Latina student and I want to work in corporate finance"));
  for (const [who, r] of [['investment banking', banker], ['corporate finance', corporate]]) {
    const first5 = names(r.picks).slice(0, 5);
    const first6 = names(r.picks).slice(0, 6);
    const lit = r.picks.filter((p) => literacy.some((c) => c?.id === p.club.id));
    expect(lit.length === 0 && ['Vantage Acquisitions Group', 'Illini Business Forum'].every((n) => first5.includes(n)) && first6.includes('Equity Research Association') && r.picks.slice(0, 5).filter((p) => isFamily(p.club) && familyWhy.test(p.why)).length <= 1, `1. "${who}" on Finance: no personal-finance club; Vantage and Illini Business Forum in the first five, Equity Research Association in the first six; at most one fraternity or family club in the first five`, first6.join('; '));
  }
  expect(names(banker.picks).slice(0, 5).includes('Equity Research Association') && !banker.picks.slice(0, 5).some((p) => familyWhy.test(p.why)), '1. "Investment banking in Chicago": Equity Research Association in the first five, and no fraternity there while the goal\'s own clubs remain', names(banker.picks).slice(0, 5).join('; '));
  expect(names(corporate.picks).slice(0, 3).includes('ALPFA Illinois') && !names(corporate.communities).includes('ALPFA Illinois'), '1. "I\'m a first-gen Latina student": ALPFA in the main list, in the first three, not folded away', names(corporate.picks).slice(0, 3).join('; '));
  const cpaOrder = names(cpa.picks);
  const firstFrat = cpa.picks.findIndex((p) => p.why === C.BUSINESS_FRATERNITY_WHY);
  expect(cpaOrder.includes('Beta Alpha Psi') && cpaOrder.indexOf('Beta Alpha Psi') < firstFrat && cpaOrder.indexOf('Accounting Club') < firstFrat, '2. "CPA at a Big Four firm" (first-year): Beta Alpha Psi shown, and every accounting club before the business fraternities', cpaOrder.join('; '));
  const nursing = nurse.picks.filter((p) => /nurs/i.test(p.club.name));
  const firstPreHealth = nurse.picks.findIndex((p) => p.why === C.PRE_HEALTH_WHY);
  expect(nursing.length >= 2 && nursing.every((p) => nurse.picks.indexOf(p) < firstPreHealth) && nurse.thin.includes('nursing'), '3. "I want to be a nurse": every nursing club not centered on one community in the main list, before the general pre-health clubs, and the goal said to be thin', `${names(nurse.picks).slice(0, 4).join('; ')} | thin: ${nurse.thin.join(',')}`);
  expect(data.clubs.filter((c) => /nurs/i.test(c.name) && c.goals.some((g) => g.id === 'nursing') && c.identity).every((c) => /black|hispanic|latin/i.test(c.name)), '3. the only nursing clubs left in the communities row name a community');
  const kin = rec(data, on('ahs/kinesiology-bs/applied-exercise-science', 'HK', 'physical therapy school'));
  expect(kin.picks[0]?.club.name === 'Pre-Physical Therapy Club' && kin.thin.includes('pre-physical-therapy') && names(kin.picks).slice(0, 5).includes('Kinesiology Student Association') && kin.picks.slice(0, 5).filter((p) => p.why === C.PRE_HEALTH_WHY).length <= 3, '3. "physical therapy school" on Kinesiology: the pre-PT club first, the thin message, the Kinesiology Student Association in the first five', names(kin.picks).slice(0, 5).join('; '));
  expect(!names(nurse.picks).includes('Kinesiology Student Association'), '3. the Kinesiology Student Association is not a Community Health student\'s major club (both are HK)');
  const climate = names(pol.picks);
  const science = climate.filter((n) => /fisheries|wildlife society/i.test(n));
  const advocacy = ['Students for Environmental Concerns', 'Green Leadership Council'];
  expect(advocacy.every((n) => climate.includes(n)) && science.every((n) => advocacy.every((a) => climate.indexOf(a) < climate.indexOf(n))) && climate.slice(0, 5).includes('Public Policy Leaders'), '4. "climate policy for the government": Students for Environmental Concerns and Green Leadership Council shown, ahead of any fisheries or wildlife society; Public Policy Leaders in the first five', climate.join('; '));
  expect(data.clubs.filter((c) => /\b(republicans?|democrats|socialists?|turning point|young americans for liberty)\b/i.test(c.name)).every((c) => c.goals.length === 0), '4. party groups carry no career goal, so no policy or politics student is sent to one');
  const fshn = [['aces/food-science-bs', 'Association of Food Technologists'], ['aces/hospitality-management-bs', 'Hospitality Management Association'], ['aces/dietetics-nutrition-bs', 'Student Dietetic Association']].map(([p, club]) => [club, rec(data, on(p, 'FSHN', 'be a pastry chef'))]);
  expect(fshn.every(([club, r]) => r.picks.some((p) => p.club.name === club && p.goal === 'major')) && !names(fshn[0][1].picks).includes('Hospitality Management Association') && !names(fshn[1][1].picks).includes('Association of Food Technologists'), '5. FSHN majors get their own club ("be a pastry chef"): food science, hospitality and dietetics each their own, not each other\'s', fshn.map(([c, r]) => `${c}: ${names(r.picks).slice(0, 3).join(', ')}`).join(' | '));
  const pilot = rec(data, on(null, null, 'become a pilot'));
  const space = rec(data, on(null, null, 'work in space'));
  expect(!names(pilot.picks).includes('Illinois Biodiesel Initiative') && names(pilot.picks).includes('UAV@Illinois'), '5. "become a pilot": no biodiesel club for its pilot plant; the drone-piloting team still comes up', names(pilot.picks).join('; '));
  expect(!names(space.picks).some((n) => /product space|sibshops|painting|comedy/i.test(n)) && names(space.picks).includes('Illinois Space Society'), '5. "work in space": no Product Space, no club offering "a space for" or "a supportive space"; the Illinois Space Society still comes up', names(space.picks).join('; '));
  const band = rec(data, on('faa/instrumental-music-bmus', 'MUS', 'play trumpet professionally in an orchestra')).picks.find((p) => p.club.name.startsWith('National Band Association'));
  expect(band?.why === 'The National Band Association student chapter, for Instrumental Music students', '5. the National Band Association is spelled out, never "the NBA student chapter"', band?.why);
  const swe14 = rec(data, on('ischool/information-sciences-data-science-bs', 'IS', 'data analyst for a pro sports team'));
  const partOf = [...swe14.picks, ...swe.picks].filter((p) => /\bis part of\b|part of software engineering|part of finance/.test(p.why));
  expect(partOf.length === 0, '5. no why line says one field "is part of" another', partOf.map((p) => `${p.club.name}: ${p.why}`).join(' | '));
  const prePT = rec(data, on('ahs/kinesiology-bs', 'KIN', 'physical therapist'));
  const faithFolded = prePT.communities.filter((p) => p.club.kind === 'faith' || p.club.categories.includes('Faith, Religion & Spirituality'));
  expect(faithFolded.length === 0, 'decision 5: no faith club in the folded communities row for a student who never mentioned faith', faithFolded.map((p) => p.club.name).join('; '));
  const t0 = performance.now();
  for (let i = 0; i < 50; i += 1) rec(data, on('bus/finance-bs', 'FIN', 'investment banking and consulting'));
  const ms = (performance.now() - t0) / 50;
  expect(ms < 25, `one recommendation over ${data.clubs.length} clubs takes ${ms.toFixed(1)} ms`);
}

console.log(failures ? `\n*** ${failures} check(s) failed ***` : '\nall club matching checks passed');
if (failures) process.exitCode = 1;
