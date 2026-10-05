/**
 * Club recommendations, judged without a model (DESIGN 5.1 and 5.3).
 *
 * It loads the real public/illinois/clubs.json, builds each of the 24 practice
 * students in lib/planner/__clubs.personas.json the way the workspace will
 * (the goal reader interestProfile, the degree's subjects from its own
 * program file through degreeSubjects, the college from programs.json, first
 * year from enteringAsFirstYear), and runs recommendClubs from
 * lib/planner/clubs.ts for each. Every rule is something a student would
 * notice at a glance, and each one failed on the day-0 baseline
 * (clubs-design/eval/baseline.mjs, a naive recommender):
 *
 *   - a pre-law student was sent to the Black Law Students Association, a
 *     College of Law group; a pre-vet student to the Student AVMA, for
 *     students already in veterinary school;
 *   - a climate-policy student was handed two social fraternities whose pages
 *     mention sustainability;
 *   - a Grainger department office account sat beside the clubs;
 *   - five of 24 goals were heard as nothing and got no club and no message.
 *
 * Added after the 2026-10-05 review: no club may link a placeholder address
 * (one linked https://example.com/); a pre-vet student is not shown a general
 * pre-health club; a student who says they are still deciding is told the
 * list is for exploring, not that nothing matched; and, once the calendar is
 * read, every club carries its event counts from a calendar read in time.
 *
 * Added after the 2026-10-05 spot check (13 of 24 useful, 84.2% true why
 * lines): a club named for a whole family of goals (a general pre-health
 * club, a business fraternity, a national row with two or more goals) says
 * what it is, never "About nursing" or "a finance club"; and a student whose
 * goal the planner does not know is told so, never "A good first club while
 * you decide".
 *
 * Parts:
 *   A. the data file is whole, fresh and safe to ship
 *   B. nothing a student cannot join is matched to a goal
 *   C. every goal the planner knows has 3 clubs, or the card says it is thin
 *   D. each practice student's list follows the rules
 *   E. the scoreboard, with the bars to ship v1
 *
 *   export PATH=/opt/homebrew/bin:$PATH
 *   node lib/planner/__clubs.check.mjs                 (a second or two)
 *        [-v]                       every pick for every student
 *        [--grades spotcheck.json]  the stronger model's spot check (clubs-design/eval/spotcheck-grader.md)
 *        [--today 2026-10-05]       the day to judge freshness and events by
 *        [--data other-clubs.json]  another build of the file (to try the check on a broken one)
 *
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
const PUBLIC = join(ROOT, 'public');
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

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const VERBOSE = process.argv.includes('-v');
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = arg('today', localDay(new Date()));
const GRADES = arg('grades', null);

const { interestProfile, CAREER_TRACKS, INTEREST_TOPICS } = await import(join(HERE, 'career-tracks.ts'));
const C = await import(join(HERE, 'clubs.ts'));
const { runFindClubs } = await import(join(HERE, 'clubs-tool.ts'));
const { degreeSubjects } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow } = await import(join(HERE, 'illinois-load.ts'));
const { enteringAsFirstYear } = await import(join(HERE, 'review.ts'));

const FILE = arg('data', join(PUBLIC, 'illinois', 'clubs.json'));
if (!existsSync(FILE)) {
  console.log(`FAIL  ${FILE} is missing: run node scripts/illinois/clubs/build.mjs`);
  process.exit(1);
}
const raw = readFileSync(FILE, 'utf8');
const data = JSON.parse(raw);
const personas = JSON.parse(readFileSync(join(HERE, '__clubs.personas.json'), 'utf8')).personas;
const grades = GRADES && existsSync(GRADES) ? JSON.parse(readFileSync(GRADES, 'utf8')) : null;
if (GRADES && !grades) console.log(`note  --grades ${GRADES} not found; scoreboard lines 2 and 4 use the stand-in`);

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `\n          ${detail}` : ''}`);
  if (!ok) failed += 1;
  return ok;
};
const note = (label) => console.log(`  note  ${label}`);
const list = (xs, n = 6) => xs.slice(0, n).join('; ') + (xs.length > n ? `; ... ${xs.length - n} more` : '');

// ---- the rules, in one place ---------------------------------------------------
const GOALS = [...CAREER_TRACKS.map((t) => ({ id: t.id, label: t.name, track: t })), ...INTEREST_TOPICS.map((t) => ({ id: t.id, label: t.label, topic: t }))];
const GOAL_IDS = new Set(GOALS.map((g) => g.id));
const VOCAB = { tracks: CAREER_TRACKS, topics: INTEREST_TOPICS };
const MIN_CLUBS = 900;
const MIN_PER_GOAL = 3;
const BAR = { covered: 40, shown: personas.length, top3: 20, badPicks: 0, useful: 20, whyTrue: 0.95 };
const DIRECTORY = 'https://one.illinois.edu/club_signup';
/** Kinds never recommended from career evidence; a query that asks for them may return them (DESIGN 2.5). */
const ASKED_ONLY = new Set(['social', 'greek-social', 'faith', 'cultural', 'sport-recreation']);
/** Kinds that must carry no career goal at all (DESIGN 5.1 B). */
const NO_GOALS = new Set(['social', 'greek-social', 'faith']);
/** Words that mean the student named an identity, a faith or Greek life themselves. */
const SAID_IDENTITY = /\b(first[- ]gen|latin[aoxe]|hispanic|black|african|asian|indian|jewish|muslim|christian|catholic|hindu|lgbt|queer|gay|trans|women|woman|female|international student|veteran|sorority|fraternity|greek)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;
/** The why lines a club named for a whole family of goals may carry (clubs.ts familyLine), and how to spot one, written again here. */
const FAMILY_WHY = /^(A pre-health club for students heading to health professions|A professional business fraternity, for students heading into business careers|The .+ chapter, for students heading into .+)$/;
function isFamily(c) {
  const own = c.goals.filter((g) => g.from !== 'reading' && g.from !== 'list');
  return own.filter((g) => /^(pre-(?!law$|veterinary$)[a-z-]+|nursing)$/.test(g.id)).length >= 5 || own.filter((g) => g.from === 'national').length >= 2;
}
/** Who a group is for, by its name: clubs for students already in a graduate, law, medical or vet program. Pre-, Undergraduate and "Future X" are for undergraduates. */
const FOR_UNDERGRADS = /\bpre[-\s]|\bundergrad(uate)?s?\b|\bfuture\s+(?!of\b)[a-z]/i;
const NOT_UNDERGRAD = /\bgraduate students?\b|\bgrad students?\b|\blaw students?\b|\bcollege of law\b|\bstudent bar association\b|\bcollege of medicine\b|\bmedical students?\b|\bveterinary students?\b|\bavma\b|\bdvm\b|\bmba\b|\bdoctoral\b/i;

const byId = new Map(data.clubs.map((c) => [String(c.id), c]));
const nameKey = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/\b(uiuc|illinois|university of illinois( urbana-champaign)?|at|the|of|club|chapter|association|society|student|students|organization|inc)\b/g, '').replace(/[^a-z0-9]/g, '');
const traps = new Map(personas.flatMap((p) => p.traps.filter((t) => t.scope === 'never').map((t) => [t.id, t.reason])));
const ageDays = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Why an undergraduate who did not ask for it cannot be sent to this club, or null. */
function notJoinable(c) {
  if (!c) return 'not in the data file';
  if (!/^https?:\/\//.test(c.url ?? '')) return 'no link';
  if (c.audience !== 'undergrad' && c.audience !== 'both') return `audience '${c.audience}': may be for graduate or professional students`;
  if (traps.has(String(c.id))) return traps.get(String(c.id));
  if (C.inGraceWindow(c, data.checked) && ageDays(c.lastSeen, TODAY) > C.STALE_DAYS) return 'out of the directory for more than 120 days';
  return null;
}

// ---- A. the data file -----------------------------------------------------------
console.log('\nA. The data file');
const shipped = data.clubs.length;
check(shipped >= MIN_CLUBS, `at least ${MIN_CLUBS} clubs (${shipped})`, 'the directory read came back short: a crawl failure, not a quiet semester');
check(data.counts?.shipped === shipped, `counts.shipped matches the clubs in the file (${data.counts?.shipped} and ${shipped})`);
check(data.counts?.parsed === data.counts?.onPage, `every group the page counts was parsed (${data.counts?.parsed} of ${data.counts?.onPage})`);
{
  // The last build is the committed file, when there is one. The build's own guard compares against the file it replaces.
  const committed = spawnSync('git', ['show', 'HEAD:public/illinois/clubs.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let previous = null;
  try { previous = committed.status === 0 ? JSON.parse(committed.stdout).clubs.length : null; } catch { previous = null; }
  if (previous) check(Math.abs(shipped - previous) / previous <= 0.15, `within 15% of the last committed build (${shipped} against ${previous})`);
  else note('no committed clubs.json to compare against; build.mjs held the 15% guard against the file it replaced');
}
const ids = data.clubs.map((c) => String(c.id));
const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
check(dupIds.length === 0, 'club ids are unique', list(dupIds));
const noLink = data.clubs.filter((c) => !/^https?:\/\//.test(c.url ?? '')).map((c) => c.name);
check(noLink.length === 0, 'every club has a link', list(noLink));
const constructed = [];
for (const c of data.clubs) {
  let u;
  try { u = new URL(c.url); } catch { constructed.push(`${c.name}: ${c.url}`); continue; }
  if (u.host === data.source.host) {
    const slug = u.pathname.split('/').filter(Boolean)[0] ?? '';
    if (!slug || slug.includes('.') || c.url !== c.profile) constructed.push(`${c.name}: ${c.url}`);
  } else if (c.url !== c.website) constructed.push(`${c.name}: ${c.url} is not its website`);
  if (c.profile && !/^https:\/\/one\.illinois\.edu\/[^/.]+\/$/.test(c.profile)) constructed.push(`${c.name}: profile ${c.profile}`);
}
check(constructed.length === 0, 'no constructed link: a directory link is a profile with no dot in its slug, any other link is the club\'s own website', list(constructed));
// Reserved and test names (RFC 2606, RFC 6761), localhost and bare IPs: never a club's site (parse.mjs placeholderHost).
const PLACEHOLDER = /^https?:\/\/(([^/]*\.)?(example\.(com|net|org)|example|test|invalid|localhost)|localhost|\d{1,3}(\.\d{1,3}){3}|\[[^\]]*\])(:\d+)?(\/|$)/i;
const placeholder = data.clubs.filter((c) => [c.url, c.website, c.profile].some((u) => u && PLACEHOLDER.test(u))).map((c) => `${c.name}: ${c.url}`);
check(placeholder.length === 0, 'no club links a placeholder address (example.com, localhost, a bare IP ...)', list(placeholder));
if (data.calendar) {
  const calAge = ageDays(data.calendar.read, TODAY);
  check(/^\d{4}-\d{2}-\d{2}$/.test(data.calendar.read) && data.calendar.read >= data.checked && calAge <= C.STALE_DAYS, `the events calendar was read ${data.calendar.read}, ${calAge} days ago, no earlier than the directory (${C.STALE_DAYS} at most)`);
  const noEvents = data.clubs.filter((c) => !c.events || !Number.isInteger(c.events.n120)).map((c) => c.name);
  check(noEvents.length === 0, 'with the calendar read, every club carries its event counts (none means n120 0, ranked x0.9)', list(noEvents));
  const early = data.clubs.filter((c) => (c.events?.next ?? []).some((d) => d < data.calendar.read) || (c.events?.last && c.events.last >= data.calendar.read)).map((c) => c.name);
  check(early.length === 0, "next dates are on or after the day the calendar was read, last dates before it", list(early));
  const active = data.clubs.filter((c) => c.events?.n120 > 0).length;
  const coming = data.clubs.filter((c) => c.events?.next?.length).length;
  const idle = data.clubs.filter((c) => !ASKED_ONLY.has(c.kind) && !(c.events?.n120 > 0 || c.events?.next?.length)).length;
  console.log(`  info  calendar read ${data.calendar.read}: ${active} clubs with an event in the last 120 days, ${coming} with one coming up; ${idle} recommendable-kind clubs with neither (x0.9)`);
} else note('no events calendar in this build: no event dates, and no club is ranked down for having none');
const insecure = data.clubs.filter((c) => c.url.startsWith('http://')).map((c) => c.name);
if (insecure.length) note(`${insecure.length} club links are plain http (${list(insecure, 3)})`);
const leaks = [];
if (EMAIL.test(raw)) leaks.push(`an email address: ${raw.match(EMAIL)[0].replace(/^[^@]+/, '…')}`);
if (PHONE.test(raw)) leaks.push(`a phone number near "${raw.slice(Math.max(0, raw.search(PHONE) - 30), raw.search(PHONE)).replace(/\s+/g, ' ')}"`);
for (const bad of ['uid=', 'send_message', 'mailto:', 'tel:']) if (raw.includes(bad)) leaks.push(bad);
check(leaks.length === 0, 'no email address, phone number, uid= or send_message anywhere in the file', list(leaks));
const age = ageDays(data.checked, TODAY);
check(age <= C.STALE_DAYS, `the directory was read ${age} days ago (${C.STALE_DAYS} at most)`, `checked ${data.checked}: run the crawl and the build (scripts/illinois/clubs/README.md)`);
const longDoes = data.clubs.filter((c) => c.does && (c.does.split(/\s+/).length > 20 || c.does.length > 140)).map((c) => c.name);
check(longDoes.length === 0, `every description of our own is 20 words and 140 characters or fewer (${data.clubs.filter((c) => c.does).length} written)`, list(longDoes));
const badGoal = data.clubs.flatMap((c) => c.goals.filter((g) => !GOAL_IDS.has(g.id)).map((g) => `${c.name}: ${g.id}`));
check(badGoal.length === 0, `every goal tag is one of the ${GOAL_IDS.size} current track and topic ids`, list(badGoal));
const badList = data.clubs.filter((c) => [...(c.lists ?? []), ...c.goals.filter((g) => g.from === 'list').map((g) => g.list)].some((i) => !data.lists[i])).map((c) => c.name);
check(badList.length === 0, `every list a club is on is one of the file's ${data.lists.length} lists`, list(badList));
check(data.source?.url === DIRECTORY && data.source?.name === 'OneIllinois', `the source is ${data.source?.name} (${data.source?.url})`);

// ---- B. eligibility ---------------------------------------------------------------
console.log('\nB. Nothing a student cannot join is matched to a goal');
const notForUndergrads = data.clubs.filter((c) => !['undergrad', 'both', 'check'].includes(c.audience)).map((c) => `${c.name} (${c.audience})`);
check(notForUndergrads.length === 0, 'every club in the file is for undergraduates, or marked to check', list(notForUndergrads));
const byName = data.clubs.filter((c) => NOT_UNDERGRAD.test(c.name) && !FOR_UNDERGRADS.test(c.name) && c.audience !== 'check').map((c) => c.name);
check(byName.length === 0, 'no club named for graduate, law-school, medical-school or vet-school students ships as an undergraduate club', list(byName));
{
  // The office accounts by type, from the local directory read when there is one (data/clubs/ is not committed).
  const dir = join(ROOT, 'data', 'clubs', 'directory.json');
  if (existsSync(dir)) {
    const offices = JSON.parse(readFileSync(dir, 'utf8')).groups.filter((g) => g.office || /Departments & Programs|Student Services & Support/.test(g.type ?? ''));
    const shippedOffices = offices.filter((g) => byId.has(String(g.id))).map((g) => g.name);
    check(offices.length > 0 && shippedOffices.length === 0, `none of the directory's ${offices.length} office accounts ships`, list(shippedOffices));
  } else note('data/clubs/directory.json is not here, so office accounts are checked by the persona traps only');
}
const trapsShipped = [...traps].filter(([id]) => byId.has(id)).map(([id, why]) => `${byId.get(id).name} (${why})`);
check(trapsShipped.length === 0, `none of the ${traps.size} hand-checked 'never' traps is in the file`, list(trapsShipped));
const careerOnSocial = data.clubs.filter((c) => NO_GOALS.has(c.kind) && c.goals.length > 0).map((c) => `${c.name} [${c.kind}]: ${c.goals.map((g) => g.id).join(', ')}`);
check(careerOnSocial.length === 0, 'no social, Greek or faith club carries a career goal', list(careerOnSocial));
const askedOnlyGoals = data.clubs.filter((c) => ASKED_ONLY.has(c.kind) && !NO_GOALS.has(c.kind) && c.goals.length > 0).length;
if (askedOnlyGoals) note(`${askedOnlyGoals} cultural or sport clubs carry a goal tag; their kind factor is 0, so no career word reaches them`);
const recommendable = data.clubs.filter((c) => !ASKED_ONLY.has(c.kind) && !notJoinable(c));
console.log(`  info  ${recommendable.length} of ${shipped} clubs can be recommended from career words; the rest only when asked`);

// ---- C. coverage -------------------------------------------------------------------
console.log(`\nC. Every goal the planner knows has ${MIN_PER_GOAL} clubs a student can join, or the card says the list is thin`);
/** A student who names only this goal, as interestProfile would hear them: a track brings the topics it covers. */
function goalOnly(g) {
  const profile = g.track
    ? { tracks: [g.track], topics: INTEREST_TOPICS.filter((t) => g.track.related.includes(t.id)), heard: [g.track.name], words: [], subjects: [], courses: [], apply: [] }
    : { tracks: [], topics: [g.topic], heard: [g.topic.label], words: [], subjects: [], courses: [], apply: [] };
  return { careerText: g.label, profile, hear: () => profile, primary: null, subjects: [], majorName: null, college: null, firstYear: false, vocabulary: VOCAB };
}
const coverage = [];
for (const g of GOALS) {
  const student = goalOnly(g);
  const all = C.recommendClubs(data, student, { limit: 1000, perGoal: 1000, goalsOnly: true, communities: false, today: TODAY });
  const joinable = all.picks.filter((p) => !notJoinable(p.club));
  const rail = C.recommendClubs(data, student, { today: TODAY });
  const tool = runFindClubs({ goal: g.id }, student, data, { today: TODAY });
  const toolThin = tool.ok && (tool.thin ?? []).some((t) => t.id === g.id);
  const own = joinable.filter((p) => ['list', 'track', 'topic', 'covered', 'reading'].includes(p.basis)).length;
  coverage.push({ g, n: joinable.length, own, shown: all.picks.length, thin: rail.thin.includes(g.id), toolThin, matched: rail.matched[g.id] ?? 0, tool });
}
const covered = coverage.filter((x) => x.n >= MIN_PER_GOAL);
const short = coverage.filter((x) => x.n < MIN_PER_GOAL);
check(covered.length >= BAR.covered, `${covered.length} of ${GOALS.length} goals have ${MIN_PER_GOAL}+ joinable clubs (bar ${BAR.covered})`, `short: ${short.map((x) => `${x.g.id} ${x.n}`).join(', ')}`);
const silent = short.filter((x) => !x.thin || !x.toolThin);
check(silent.length === 0, `each of the ${short.length} goals under ${MIN_PER_GOAL} is in the card's thin list and in find_clubs's`, silent.map((x) => `${x.g.id}: card ${x.thin ? 'thin' : 'not thin'}, find_clubs ${x.toolThin ? 'thin' : 'not thin'}`).join('; '));
const badNote = short.filter((x) => {
  const n = C.thinNote(data, x.g.label, x.matched);
  return n.href !== DIRECTORY || !n.text.includes(String(x.matched || 'No club')) || !(x.tool.ok && x.tool.source.url === DIRECTORY);
});
check(badNote.length === 0, 'each thin goal\'s message gives the count and links the directory to browse', list(badNote.map((x) => x.g.id)));
const byFamily = coverage.filter((x) => x.n >= MIN_PER_GOAL && x.own < MIN_PER_GOAL).map((x) => `${x.g.id} (${x.own} named for it, ${x.n - x.own} from its field)`);
if (byFamily.length) note(`reach ${MIN_PER_GOAL} only with clubs for the wider field (a software engineering club for cybersecurity, DESIGN 3.3 family): ${byFamily.join(', ')}`);
const padded = coverage.filter((x) => x.n >= MIN_PER_GOAL && x.thin).map((x) => `${x.g.id} (${x.n} joinable, ${x.matched} matched)`);
if (padded.length) note(`said to be thin although 3 or more joinable clubs fit: ${list(padded)}`);
for (const x of short) console.log(`  thin  ${x.g.id.padEnd(26)} ${x.n} joinable: "${C.thinNote(data, x.g.label, x.matched).text}"`);

// ---- D. each practice student --------------------------------------------------------
console.log("\nD. Each practice student's list");
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const rows = JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'index.json'), 'utf8')).map(hydrateIndexRow);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const programs = new Map(JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'programs.json'), 'utf8')).map((p) => [p.id, p]));
/** The ClubStudent the workspace will build for this persona (DESIGN 3.1). */
function studentOf(p) {
  const s = p.programId ? programs.get(p.programId) : null;
  if (p.programId && !s) throw new Error(`${p.id}: program ${p.programId} is not in programs.json`);
  const blocks = s ? adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [JSON.parse(readFileSync(join(PUBLIC, 'illinois', 'program', `${s.id}.json`), 'utf8'))] }, new Map(byCode)).blocks.get(s.id) ?? [] : [];
  return C.clubStudentOf({
    careerText: p.after,
    hear: interestProfile,
    programName: s?.name ?? null,
    college: s?.college ?? null,
    degree: s ? degreeSubjects(blocks, s.name) : null,
    firstYear: enteringAsFirstYear(`${p.studying} ${p.after}`, null),
    vocabulary: VOCAB,
  });
}

let badPicks = 0;
let passing = 0;
let goldShown = 0;
let goldTop3 = 0;
let goldTop6 = 0;
const results = new Map();
for (const p of personas) {
  const student = studentOf(p);
  const r = C.recommendClubs(data, student, { today: TODAY });
  results.set(p.id, { r, student });
  const picks = r.picks;
  const said = `${p.studying} ${p.after}`;
  const asked = SAID_IDENTITY.test(said);
  const gold = new Set(p.gold.map((g) => g.id));
  const trapOf = new Map(p.traps.map((t) => [t.id, t.reason]));
  const heard = new Set(r.goals.map((g) => g.id));
  console.log(`\n ${p.id}  "${p.after}"  (${p.studying}; heard ${r.goals.map((g) => g.id).join(', ') || 'no goal'}; ${student.primary ?? 'no major'}${student.college ? `, ${student.college}` : ''}; ${picks.length} picks${r.communities.length ? `, ${r.communities.length} communities` : ''}${r.thin.length ? `, thin: ${r.thin.join(', ')}` : ''}${r.empty ? `, empty: ${r.empty}` : ''})`);
  for (const g of p.gold) {
    const c = byId.get(g.id);
    if (c && nameKey(c.name) !== nameKey(g.name)) note(`gold "${g.name}" is now "${c.name}" in the directory`);
  }
  const before = failed;

  // Per-pick rules: each pick that breaks one counts once as a bad pick.
  const keyOf = (x) => [nameKey(x.club.name), ...(x.club.national ? [`national:${x.club.national}`] : [])];
  const seen = new Set();
  const why = { join: [], trap: [], unasked: [], noWhy: [], dupes: [], career: [], field: [], family: [], decide: [] };
  const deciding = !p.after.trim() || C.soundsUndecided(p.after);
  // A pre-vet student (no human-health goal heard) is not sent to a general pre-health club.
  const vetOnly = heard.has('pre-veterinary') && ![...heard].some((g) => g !== 'pre-veterinary' && /^pre-(medicine|dental|physician|physical|occupational|pharmacy|optometry)/.test(g));
  picks.forEach((x) => {
    const broke = [];
    const nj = notJoinable(x.club);
    if (nj) broke.push(['join', `${x.club.name}: ${nj}`]);
    if (trapOf.has(x.club.id)) broke.push(['trap', `${x.club.name}: ${trapOf.get(x.club.id)}`]);
    if (!asked && (x.club.identity || ASKED_ONLY.has(x.club.kind))) broke.push(['unasked', `${x.club.name} [${x.club.kind}${x.club.identity ? ', identity' : ''}]`]);
    if (!x.why || x.why.length < 20 || x.why.length > C.WHY_MAX) broke.push(['noWhy', `${x.club.name}: "${x.why ?? ''}"`]);
    const keys = keyOf(x);
    if (keys.some((k) => seen.has(k))) broke.push(['dupes', x.club.name]);
    keys.forEach((k) => seen.add(k));
    if (p.goalKind === 'none' && x.goal !== 'starter') broke.push(['career', `${x.club.name} (${x.goal})`]);
    if (vetOnly && /pre[-\s]?health|health\s+professions?|alpha epsilon delta/i.test(x.club.name)) broke.push(['field', `${x.club.name} (${x.goal})`]);
    if (isFamily(x.club) && !FAMILY_WHY.test(x.why) && !x.why.startsWith('On ')) broke.push(['family', `${x.club.name}: "${x.why}"`]);
    if (!deciding && x.why === C.STARTER_WHY) broke.push(['decide', x.club.name]);
    for (const [k, msg] of broke) why[k].push(msg);
    if (broke.length) badPicks += 1;
  });
  // The folded communities row: identity-centered clubs only, matched by a goal the student named, never social, faith or Greek.
  const badCommunity = [];
  for (const x of r.communities) {
    const broke = [notJoinable(x.club), trapOf.get(x.club.id), !x.club.identity && 'not identity-centered', !heard.has(x.goal) && `matched by ${x.goal}, not a goal the student named`, NO_GOALS.has(x.club.kind) && `a ${x.club.kind} club`, isFamily(x.club) && !FAMILY_WHY.test(x.why) && `"${x.why}" for a club named for a family of goals`].filter(Boolean);
    if (broke.length) { badCommunity.push(`${x.club.name}: ${broke.join(', ')}`); badPicks += 1; }
  }

  const thinOk = r.thin.length > 0 && r.thin.every((g) => C.thinNote(data, g, r.matched[g] ?? 0).href === DIRECTORY);
  const emptyOk = (r.empty === 'unheard' || r.empty === 'no-words') && picks.length > 0;
  check(picks.length >= 3 || thinOk || emptyOk, 'three or more picks, or a plain message that the list is thin with the directory link', `${picks.length} picks${r.thin.length ? '' : ', and no thin message'}`);
  check(why.join.length === 0, 'every pick is a club the student can join', list(why.join));
  check(why.trap.length === 0, 'no trap', list(why.trap));
  check(why.unasked.length === 0, asked ? 'no asked-only club (the student named a community, so identity clubs may come up)' : 'no identity, faith, Greek, cultural or social club the student did not ask about', list(why.unasked));
  check(why.noWhy.length === 0, 'every pick says why, in 110 characters or fewer', list(why.noWhy));
  check(why.dupes.length === 0, 'no club twice, and no two chapters of one club', list(why.dupes));
  check(badCommunity.length === 0, `the communities row holds only identity-centered clubs matched by a named goal (${r.communities.length})`, list(badCommunity));
  if (p.goalKind === 'none') check(why.career.length === 0, 'an undecided student is not handed a career club', list(why.career));
  if (p.goalKind === 'none' && C.soundsUndecided(p.after)) {
    const said = C.emptyNote(r, student.careerText) ?? '';
    check(r.undecided === true && said.startsWith('You said you are still deciding, so here are clubs for exploring'), 'an undecided student is told the list is for exploring, not that nothing matched', said);
  }
  if (vetOnly) check(why.field.length === 0, 'a pre-vet student is not shown a general pre-health club', list(why.field));
  check(why.family.length === 0, 'a club named for a family of goals says what it is (a pre-health club, a business fraternity, a national chapter), never "About X"', list(why.family));
  if (!deciding) {
    check(why.decide.length === 0, 'a student who named a goal is never told "A good first club while you decide"', list(why.decide));
    if (r.goals.length === 0) {
      const said = C.emptyNote(r, student.careerText) ?? '';
      check(r.unknownGoal === true && /^(The planner does not know|Nothing in)/.test(said), 'a goal the planner does not know: the card says so plainly', said);
    }
  }
  const ids6 = picks.slice(0, 6).map((x) => x.club.id);
  const shownIds = [...picks.map((x) => x.club.id), ...r.communities.map((x) => x.club.id)];
  const isShown = shownIds.some((id) => gold.has(id));
  const in3 = picks.slice(0, 3).some((x) => gold.has(x.club.id));
  const in6 = ids6.some((id) => gold.has(id));
  goldShown += isShown ? 1 : 0;
  goldTop3 += in3 ? 1 : 0;
  goldTop6 += in6 ? 1 : 0;
  if (p.gold.length) check(in6, `a club an Illinois student would name first is in the first 6${in3 ? ' (in the first 3)' : ''}`, `any of: ${p.gold.map((g) => g.name).join(' | ')}; shown: ${isShown ? 'yes, lower down' : 'no'}`);
  if (picks.length >= 4) {
    const kinds = [...new Set(picks.map((x) => x.club.kind))];
    check(kinds.length >= 2, `a mix of kinds (${kinds.join(', ')})`);
  }
  if (VERBOSE) {
    for (const x of picks) console.log(`     ${x.score.toFixed(2)} ${gold.has(x.club.id) ? '*' : ' '} ${x.club.name} [${x.club.kind}] {${x.goal}} ${x.why}${x.cautions.length ? ` (${x.cautions[0]})` : ''}`);
    for (const x of r.communities) console.log(`   c ${x.score.toFixed(2)} ${gold.has(x.club.id) ? '*' : ' '} ${x.club.name} {${x.goal}} ${x.why}`);
  }
  if (failed === before) passing += 1;
}

// ---- E. the scoreboard -----------------------------------------------------------------
console.log('\nE. Scoreboard (DESIGN 5.3)');
const useful = grades ? grades.personas.filter((g) => g.verdict === 'useful').length : null;
const graded = grades ? grades.picks : null;
const whyTrue = graded?.length ? graded.filter((w) => w.whyTrue).length / graded.length : null;
const pad = (s) => s.padEnd(46, '.');
console.log(`  1. ${pad('Goals with 3+ joinable clubs ')} ${covered.length} of ${GOALS.length}  (bar ${BAR.covered}; the other ${short.length} show the thin message)`);
console.log(`  2. ${pad('Personas with a useful list ')} ${useful === null ? `model spot check not run; stand-in: ${passing} of ${personas.length} pass every D rule (bar ${personas.length})` : `${useful} of ${personas.length} (bar ${BAR.useful})`}`);
console.log(`  3. ${pad('Bad picks (rule breaks, all personas) ')} ${badPicks}  (bar ${BAR.badPicks})`);
console.log(`  4. ${pad('"Why" lines true to the listing ')} ${whyTrue === null ? 'model spot check not run' : `${graded.filter((w) => w.whyTrue).length} of ${graded.length}, ${(whyTrue * 100).toFixed(1)}% (bar 95%)`}`);
console.log(`  +  ${pad('Gold club shown / in first 3 / in first 6 ')} ${goldShown} / ${goldTop3} / ${goldTop6} of ${personas.length}  (bars ${BAR.shown} and ${BAR.top3})`);
check(goldShown >= BAR.shown, `every practice student is shown a gold club (${goldShown} of ${personas.length})`);
check(goldTop3 >= BAR.top3, `a gold club is in the first 3 for at least ${BAR.top3} of ${personas.length} (${goldTop3})`);
check(badPicks <= BAR.badPicks, `no bad picks (${badPicks})`);
check(useful === null ? passing === personas.length : useful >= BAR.useful, useful === null ? `every practice student passes every D rule (${passing} of ${personas.length})` : `at least ${BAR.useful} of ${personas.length} lists graded useful (${useful})`);
if (whyTrue !== null) check(whyTrue >= BAR.whyTrue, `at least 95% of graded why lines are true (${(whyTrue * 100).toFixed(1)}%)`);

console.log(failed ? `\n*** ${failed} check(s) failed ***` : '\nall club checks passed');
if (failed) process.exitCode = 1;
