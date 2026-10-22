/**
 * UGA clubs: public/uga/clubs.json, the rail's "Clubs for your goals" and
 * ARCH's find_clubs for a UGA student.
 *
 * The file is the staged UGA build (keep-planner/uga-staging/clubs), 272
 * organizations from official UGA pages, in the shape of
 * public/illinois/clubs.json. It is partial: UGA's own directory (the
 * Involvement Network) loads its list from an address its robots.txt
 * disallows, and Terry College's and some department pages could not be
 * read. So the check holds the planner to saying so:
 *
 *   A. the file is whole and safe to ship: no emails, phone numbers or
 *      people's names fields, every goal a goal the planner knows, every list
 *      index real, every link https;
 *   B. the loader fetches it for UGA and marks it partial, with one line that
 *      says it covers 272 clubs from official UGA pages and more are coming;
 *   C. five UGA students (pre-med, software, finance, law, data) built the way
 *      the workspace builds them (clubStudentFor): each gets clubs for the
 *      goal, or the card says the goal is thin "in this list", never in
 *      UGA's directory;
 *   D. find_clubs over the UGA file returns the same list, passes the partial
 *      line on, and ARCH has the tool, in UGA's words;
 *   E. the planner screen renders the card and runs find_clubs for UGA.
 *
 *   node lib/planner/__uga-clubs.check.mjs      [-v]  every pick
 *
 * Exits non-zero on any FAIL.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const VERBOSE = process.argv.includes('-v');
register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
      try { return await next(spec + '.tsx', ctx); } catch {}
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, ctx);
  }
`));

const C = await import(join(HERE, 'clubs.ts'));
const L = await import(join(HERE, 'clubs-load.ts'));
const TOOL = await import(join(HERE, 'clubs-tool.ts'));
const T = await import(join(HERE, 'career-tracks.ts'));
const A = await import(join(HERE, 'autoplan.ts'));
const ADV = await import(join(HERE, 'advisor.ts'));
const { enteringAsFirstYear } = await import(join(HERE, 'review.ts'));

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `\n          ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const TODAY = '2026-10-22';
const raw = readFileSync(join(PUBLIC, 'uga', 'clubs.json'), 'utf8');
const file = JSON.parse(raw);

// ---------------------------------------------------------------------------
console.log('\nA. public/uga/clubs.json');
{
  check(file.version === 1 && file.clubs.length === 272 && file.counts.shipped === 272, `version 1, ${file.clubs.length} clubs, counts.shipped ${file.counts.shipped}`);
  check(file.checked === '2026-10-20' && file.source.url === 'https://uga.campuslabs.com/engage/organizations' && file.source.name === 'UGA Involvement Network', `read ${file.checked}; "Browse every club" goes to ${file.source.name}`);
  check(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(raw) && !/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/.test(raw), 'no email address or phone number anywhere in the file');
  const SAFE = new Set(['id', 'name', 'url', 'profile', 'website', 'categories', 'kind', 'identity', 'audience', 'joining', 'goals', 'subjects', 'colleges', 'lists', 'thin', 'firstSeen', 'lastSeen']);
  const extra = [...new Set(file.clubs.flatMap((c) => Object.keys(c)))].filter((k) => !SAFE.has(k));
  check(extra.length === 0, 'each club holds only facts: name, links, kind, tags, dates (no officers, no club text)', extra.join(', '));
  const goalIds = new Set([...T.CAREER_TRACKS.map((t) => t.id), ...T.INTEREST_TOPICS.map((t) => t.id)]);
  const strayGoals = file.clubs.flatMap((c) => c.goals.filter((g) => !goalIds.has(g.id)).map((g) => `${c.name}: ${g.id}`));
  check(strayGoals.length === 0, 'every goal tag is a CAREER_TRACKS or INTEREST_TOPICS id', strayGoals.slice(0, 5).join('; '));
  const badLists = file.clubs.flatMap((c) => [...(c.lists ?? []), ...c.goals.filter((g) => g.list !== undefined).map((g) => g.list)].filter((i) => !file.lists[i]).map((i) => `${c.name}: ${i}`));
  check(badLists.length === 0, `every list index points at one of the ${file.lists.length} official lists`, badLists.slice(0, 5).join('; '));
  const links = file.clubs.flatMap((c) => [c.url, c.profile, c.website].filter(Boolean));
  const notWeb = links.filter((u) => !/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u) || /example\.(com|org)/i.test(u));
  check(notWeb.length === 0, `every one of the ${links.length} links is a real web address (${links.filter((u) => u.startsWith('http://')).length} are http, the club's own site)`, notWeb.slice(0, 5).join(', '));
  check(file.lists.every((l) => l.url.startsWith('https://') && /uga\.edu\//.test(l.url)), 'every list is an official uga.edu page');
  check(file.clubs.every((c) => c.audience === 'undergrad' || c.audience === 'both'), 'graduate and professional-school groups are not in the file');
  const ids = new Set(file.clubs.map((c) => c.id));
  check(ids.size === file.clubs.length, 'club ids are unique');
}

// ---------------------------------------------------------------------------
console.log('\nB. The loader');
{
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.window = {};
  globalThis.fetch = async (url, init) => {
    asked.push(`${url} ${init?.cache}`);
    const path = join(PUBLIC, String(url).replace(/^\//, ''));
    return new Response(readFileSync(path, 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  L.resetClubsCache();
  const [a, b] = await Promise.all([L.loadClubs('uga'), L.loadClubs('uga')]);
  const ill = await L.loadIllinoisClubs();
  check(a.ok && b === a && asked[0] === '/uga/clubs.json no-cache', 'UGA\'s file is fetched once, from /uga/clubs.json, revalidating', asked.join(' | '));
  check(ill.ok && !ill.value.partial && asked[1] === '/illinois/clubs.json no-cache' && ill.value.clubs.length > 1000, "Illinois's file is its own, and is not partial");
  const line = a.ok ? a.value.partial?.line ?? '' : '';
  check(line === "The UGA list covers 272 clubs from official UGA pages, and more are coming; for the rest, browse UGA's Involvement Network, its student-organization directory.", 'the UGA file is marked partial, with the one line', line);
  check(a.ok && a.value.clubs.length === 272 && JSON.stringify({ ...a.value, partial: undefined, lists: undefined }) === JSON.stringify({ ...file, partial: undefined, lists: undefined }), 'and is otherwise the file as shipped');
  const changed = a.ok ? a.value.lists.filter((l, i) => JSON.stringify(l) !== JSON.stringify(file.lists[i])) : [];
  check(changed.length === 1 && changed[0].id === 'ppao-prehealth' && JSON.stringify(changed[0].goals) === JSON.stringify(L.UGA_PRE_HEALTH_GOALS) && changed[0].weight === 0.85, "one list reads differently: PPAO's pre-health clubs, for the health tracks", JSON.stringify(changed));
  const goalIds = new Set(T.CAREER_TRACKS.map((t) => t.id).concat(T.INTEREST_TOPICS.map((t) => t.id)));
  check(L.UGA_PRE_HEALTH_GOALS.every((g) => goalIds.has(g)) && !L.UGA_PRE_HEALTH_GOALS.includes('pre-veterinary') && !L.UGA_PRE_HEALTH_GOALS.includes('pre-law'), 'those are goal ids, without pre-vet and pre-law');
  globalThis.fetch = realFetch;
  delete globalThis.window;
}

// ---------------------------------------------------------------------------
console.log('\nC. Five UGA students');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, '')), 'utf8'));
const U = await import(join(ROOT, 'components', 'planner', 'uga-source.tsx'));
const uga = await U.loadUgaData();
globalThis.fetch = realFetch;
const data = L.readUgaClubs(file);
const VOCAB = { tracks: T.CAREER_TRACKS, topics: T.INTEREST_TOPICS };
/** The workspace's clubStudentFor: goal words, the degree's subjects and college, first year. */
function studentOn(programName, careerText) {
  const program = uga.programs.find((p) => p.name === programName);
  const loaded = U.loadUgaProgram(uga, program, { emphasisSelections: Object.fromEntries(U.ugaSelectionRequirements(program).map((r) => [r.id, r.options.slice(0, r.minimum).map((o) => o.id)])) });
  return C.clubStudentOf({
    careerText, hear: A.interestProfileOf, programName: loaded.program.name, college: loaded.program.college,
    degree: A.degreeSubjects(loaded.blocks, loaded.program.name), firstYear: enteringAsFirstYear('first year', null), vocabulary: VOCAB,
  });
}
const STUDENTS = [
  { who: 'pre-med', program: 'Biology BS', words: 'I want to go to medical school', goal: 'pre-medicine' },
  { who: 'software', program: 'Computer Science BS', words: 'software engineer', goal: 'software-engineering' },
  { who: 'finance', program: 'Finance BBA', words: 'finance, maybe investment banking', goal: 'finance' },
  { who: 'law', program: 'Political Science AB', words: 'law school', goal: 'pre-law' },
  { who: 'data', program: 'Statistics BS', words: 'data science', goal: 'data-science' },
];
const results = [];
for (const s of STUDENTS) {
  const student = studentOn(s.program, s.words);
  const r = C.recommendClubs(data, student, { limit: 10, today: TODAY });
  const forGoal = r.picks.filter((p) => p.goal === s.goal);
  results.push({ ...s, r, forGoal });
  const thin = r.thin.includes(s.goal) ? C.thinNote(data, r.goals.find((g) => g.id === s.goal)?.label ?? s.goal, r.matched[s.goal] ?? 0, r.communityMatched?.[s.goal] ?? 0) : null;
  check(r.goals.some((g) => g.id === s.goal), `${s.who} (${s.program}): the goal is heard (${r.goals.map((g) => g.label).join(', ')})`);
  check(forGoal.length >= 3 || (thin && /in this list/.test(thin.text) && !thin.text.includes(data.source.name)), `${s.who}: ${forGoal.length} clubs for the goal${thin ? `; thin: "${thin.text}"` : ''}`, r.picks.map((p) => `${p.club.name} [${p.goal}]`).join('; '));
  check(r.picks.every((p) => p.why.length > 0 && p.why.length <= 110 && !/OneIllinois|Illinois/.test(p.why)), `${s.who}: every why line is short and names nothing of Illinois`, r.picks.map((p) => p.why).filter((w) => /Illinois/.test(w)).join(' | '));
  check(r.picks.every((p) => !/\b(FENGR|CAES|JOUR|FCS|PBHL|EDCN|FRS|ENV|ARTS|BUS)\b/.test(p.why)), `${s.who}: no why line shows a bare college code`, r.picks.map((p) => p.why).join(' | '));
  if (VERBOSE) for (const p of r.picks) console.log(`          ${p.goal.padEnd(22)} ${p.score.toFixed(2)}  ${p.club.name}  (${p.why})`);
}
{
  const med = results[0].forGoal.map((p) => p.club.name);
  check(med.slice(0, 5).some((n) => /Alpha Epsilon Delta|American Medical Student Association/.test(n)), `pre-med: a pre-medical society (AMSA or Alpha Epsilon Delta) is in the first five (${med.slice(0, 5).join('; ')})`);
  check(results[0].forGoal.some((p) => /Pre-Professional Advising Office's list of UGA pre-health clubs/.test(p.why)), "pre-med: clubs on PPAO's pre-health list say so");
  const law = results[3].forGoal;
  check(law.some((p) => p.basis === 'list' && /Pre-Professional Advising Office's list of student organizations popular with pre-law students/.test(p.why)), "law: clubs on PPAO's pre-law list say so", law.map((p) => p.why).join(' | '));
  check(results.every((x) => x.r.picks.every((p) => p.club.audience !== 'check')), 'no pick is a group that may be for graduate students');
}

// ---------------------------------------------------------------------------
console.log('\nD. find_clubs for ARCH');
{
  const s = results[0];
  const out = TOOL.runFindClubs({}, studentOn(s.program, s.words), data, { today: TODAY });
  const rail = C.recommendClubs(data, studentOn(s.program, s.words), { limit: 6, communities: false, today: TODAY }).picks.map((p) => p.club.name);
  check(out.ok && JSON.stringify(out.clubs.map((c) => c.name)) === JSON.stringify(rail), 'with no query, the same clubs as the rail', out.ok ? out.clubs.map((c) => c.name).join('; ') : out.reason);
  check(out.ok && out.note.includes(data.partial.line) && /give source\.url for clubs this list does not have/.test(out.note), 'its note passes the partial line on');
  const none = TOOL.runFindClubs({ query: 'underwater basket weaving guild' }, studentOn(s.program, s.words), data, { today: TODAY });
  check(none.ok && (none.clubs.length > 0 || /^No club in the planner's list matched/.test(none.none ?? '')), 'a query with no club says "the planner\'s list", not UGA\'s directory', none.ok ? none.none ?? none.clubs.map((c) => c.name).join('; ') : '');
  const tools = ADV.ugaAdvisorTools();
  const fc = tools.find((t) => t.name === 'find_clubs');
  check(Boolean(fc) && /partial UGA list/.test(fc.description) && !/Illinois/.test(fc.description) && JSON.stringify(fc.input_schema) === JSON.stringify(TOOL.FIND_CLUBS_TOOL.input_schema), "ARCH has find_clubs, described as UGA's partial list, with ALMA's inputs");
  check(TOOL.FIND_CLUBS_TOOL.description.includes('OneIllinois') && ADV.ADVISOR_TOOLS.find((t) => t.name === 'find_clubs') === TOOL.FIND_CLUBS_TOOL, "ALMA's find_clubs is untouched");
  const arch = ADV.advisorSystem('ARCH', 'University of Georgia', 'UGA');
  check(/find_clubs reads a partial UGA list/.test(arch) && !/no UGA student-organization list/.test(arch), "ARCH's prompt says the UGA list is partial, and no longer that there is none");
}

// ---------------------------------------------------------------------------
console.log('\nE. The planner screen');
{
  const src = readFileSync(join(ROOT, 'components', 'planner', 'planner-workspace.tsx'), 'utf8');
  check(/const clubSchool = isIllinois \? 'illinois' : isUga \? 'uga' : null;/.test(src), 'the screen knows each school\'s club file');
  check(/clubSchool \? \(\n\s+<ClubPicks\n\s+school=\{clubSchool\}/.test(src), 'it renders "Clubs for your goals" for UGA too, with UGA\'s file');
  check(/const clubs = await loadClubs\(clubSchool\);/.test(src), "find_clubs loads the student's school's file");
  const card = readFileSync(join(ROOT, 'components', 'planner', 'club-picks.tsx'), 'utf8');
  check(/data\.partial\s*\?\s*`\$\{data\.partial\.line\}/.test(card), 'the card shows the partial line under a UGA list');
}

console.log(failed ? `\n*** ${failed} UGA club check(s) failed ***` : '\nall UGA club checks passed');
if (failed) process.exitCode = 1;
