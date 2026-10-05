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
  expect(why['Finance Club'] === 'A finance club; investment banking/corporate finance is part of finance', 'the parent field counts as family evidence, with a true why line');
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
  const fy = rec(data, student('CPA', { firstYear: true }));
  expect(!names(fy.picks).includes('Accounting Honor Society'), 'a first-year sees honor societies at half weight (here, under the cutoff)');
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
  expect(r.picks[4].why === 'The ASME student chapter, for Mechanical Engineering students', 'the major why line names the national body and the major');
  expect(r.picks.filter((p) => p.goal === 'consulting').length === 4 && r.picks.length === 8, 'past the per-goal cap, the rest still fill the list rather than leave rows empty');
  const groups = C.groupPicks(r);
  expect(groups.map((g) => g.heading).join(' | ') === 'For consulting | For marketing/advertising | For your major', 'groupPicks: one heading per goal, then "For your major"', groups.map((g) => g.heading).join(' | '));
  const again = rec(file([...consulting, ...marketing, asme]), s);
  expect(JSON.stringify(again) === JSON.stringify(r), 'the same inputs give the same list');
}
{
  const starters = ['Exploratory Students Association', 'Campus Volunteer Leadership Association'].map((n) => club(n, { starter: true, kind: n.startsWith('Exp') ? 'social' : 'academic' }));
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
  expect(chemPhd.picks[0]?.club.name === 'American Chemical Society' && chemPhd.empty === undefined, 'a goal the planner cannot hear falls back to the major: the ACS for a chemistry PhD');
  expect(chemPhd.picks.slice(1).every((p) => p.goal === 'starter'), 'fewer than three major clubs: the starters follow them');
  expect(C.emptyNote(chemPhd, 'get a PhD and do research in chemistry') === null, 'the major fallback for a goal the planner cannot hear: no note above the list');
  const decidingChem = rec(data, student("I'm still figuring it out", { programName: 'Chemistry, BS', degree: { primary: 'CHEM', subjects: ['CHEM'] } }));
  const decidingNote = C.emptyNote(decidingChem, "I'm still figuring it out") ?? '';
  expect(decidingChem.picks[0]?.club.name === 'American Chemical Society' && decidingChem.empty === undefined && decidingChem.undecided === true && decidingNote.startsWith('You said you are still deciding, so here are clubs for exploring'), 'still deciding, with a major: its clubs, and the card says the same as find_clubs (clubs for exploring)', decidingNote);
  const noMatch = rec(data, student('game design'));
  expect(noMatch.empty === 'no-match' && noMatch.picks.length === 0 && noMatch.thin.join() === 'game-design' && noMatch.matched['game-design'] === 0, 'a goal with no club and no major: no starters, and the goal is listed as thin');
  const retract = rec(file([club('Pre-Med Society', { kind: 'pre-professional', goals: named('pre-medicine') }), club('UX Club', { goals: named('ux-hci') })]), student("pre-med actually I don't want to do pre-med anymore, I want UX research"));
  expect(names(retract.picks).join() === 'UX Club', 'a goal the student took back is not a goal: no pre-med club', names(retract.picks).join('; '));
  const sister = rec(file([club('Pre-Law Society', { kind: 'pre-professional', goals: named('pre-law') })]), student('my sister is pre-law, I want to build bridges'));
  expect(sister.picks.every((p) => p.goal === 'starter'), "someone else's goal is not the student's: no pre-law club");
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
  const consulting = T.runFindClubs({ query: 'which clubs should I join for consulting?' }, on('las/economics-balas', 'ECON', 'management consulting'), data, { today: TODAY });
  expect(consulting.ok && consulting.clubs.length >= 3 && consulting.goals_used[0]?.id === 'consulting' && consulting.sources.length === consulting.clubs.length, 'find_clubs "consulting": three or more consulting clubs, each with a source link');
  const latina = T.runFindClubs({ query: 'any Latina business groups?' }, on('bus/finance-bs', 'FIN', ''), data, { today: TODAY });
  console.log(`  info  "any Latina business groups?" returns: ${latina.ok ? latina.clubs.map((c) => c.name).join('; ') || '(none)' : latina.reason}`);
  const t0 = performance.now();
  for (let i = 0; i < 50; i += 1) rec(data, on('bus/finance-bs', 'FIN', 'investment banking and consulting'));
  const ms = (performance.now() - t0) / 50;
  expect(ms < 25, `one recommendation over ${data.clubs.length} clubs takes ${ms.toFixed(1)} ms`);
}

console.log(failures ? `\n*** ${failures} check(s) failed ***` : '\nall club matching checks passed');
if (failures) process.exitCode = 1;
