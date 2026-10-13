/**
 * The club tagger (scripts/illinois/clubs/tag.mjs) and its hand-checked
 * tables, checked on made-up groups first, then on data/clubs/ when a crawl
 * has filled it.
 *
 * Each case is a way the prototypes or the research went wrong:
 *   - a pre-law student was sent to College of Law groups and a pre-vet
 *     student to the veterinary students' AVMA chapter;
 *   - three automatic list joins were wrong (Society of Physics Students to
 *     an office account, Women in Data Science to the Data Science Club, the
 *     Water Resources Association to a graduate group);
 *   - a self-chosen "Honorary" tag made an advertising club an honor society;
 *   - regex over mission text tagged a social fraternity as law;
 *   - a goal id renamed in career-tracks.ts would orphan every tag on it.
 *
 *   node lib/planner/__clubs-tag.check.mjs        (a second or two)
 *
 * Exits non-zero on any FAIL.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const T = await import(pathToFileURL(join(ROOT, 'scripts', 'illinois', 'clubs', 'tag.mjs')).href);

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? ` (${detail})` : ''}`));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

const group = (name, categories = [], extra = {}) => ({ id: extra.id ?? String(90000 + Math.floor(Math.random() * 9999)), name, type: 'Orange Student Organization', office: false, url: 'https://one.illinois.edu/X/', categories, membershipClosed: false, missionWords: 40, hash: 'h', firstSeen: '2026-10-04', lastSeen: '2026-10-04', ...extra });
const goalIds = (row) => row.goals.map((g) => g.id);

// ---------------------------------------------------------------------------
console.log('\nWho a group is for, by its name');

const aud = (name, cats = [], mission) => T.audienceOf(group(name, cats), mission).audience;
expect(aud('Black Law Students Association', ['Law']) === 'law', 'a law-students association is a College of Law group');
expect(aud('Phi Alpha Delta Law Fraternity, Magruder Chapter (Illinois Law School)', ['Law']) === 'law', 'the Magruder Chapter (Illinois Law School) is a College of Law group');
expect(aud('Phi Alpha Delta - Pre-Law Undergraduate Chapter', ['Law']) === 'undergrad', '"Pre-Law" keeps the undergraduate chapter');
expect(aud("Women's Undergraduate Law Society", ['Law']) === 'undergrad', '"Undergraduate" keeps the Women\'s Undergraduate Law Society');
expect(aud('Criminal Law Society', ['Law']) === 'law' && aud('Bankruptcy Law Society', ['Law']) === 'law', '"... Law Society" is a College of Law group');
expect(aud('Illinois Student American Veterinary Medical Association', ['Veterinary']) === 'vet', 'the AVMA student chapter is a veterinary-school group, not a medical one');
expect(aud('American Association of Zoo Veterinarians, Illinois Student Chapter', ['Veterinary']) === 'vet', 'the zoo veterinarians\' chapter is a veterinary-school group');
expect(aud('Christian Medical and Dental Association') === 'med', 'a medical and dental association is a medical-school group');
expect(aud('Medical Students for a Sustainable Future') === 'med', '"a Sustainable Future" does not count as "Future" the way "Future Attorneys" does');
expect(aud('Minority Association for Future Attorneys', ['Law']) === 'undergrad', '"Future Attorneys" is for undergraduates');
expect(aud('Statistics Doctoral Student Association') === 'grad', 'a doctoral student association is a graduate group');
expect(aud('Graduate Women in the Society of Women Engineers') === 'grad', '"Graduate ..." is a graduate group');
expect(aud('Pre-Physician Assistant Club', ['Health & Human Sciences', 'Graduate or Professional Student Focused']) === 'undergrad', 'the directory\'s graduate tag does not outweigh "Pre-"');
expect(aud('Lacuna', ['Humanities', 'Graduate or Professional Student Focused']) === 'check', 'the directory\'s graduate tag alone only raises a doubt');
expect(aud('Some Club', ['Humanities'], 'We bring together graduate students in history.') === 'check', 'a mission naming graduate students only raises a doubt');
expect(aud('Some Club', ['Humanities'], 'Open to undergraduate and graduate students.') === 'undergrad', 'a mission naming undergraduates and graduates is no doubt');

// ---------------------------------------------------------------------------
console.log('\nWhat kind of club');

const kind = (name, cats, opts) => T.kindOf(group(name, cats), opts).kind;
expect(kind('Student Media Marketing Association', ['Honorary', 'Media Arts']) !== 'honor', 'a self-chosen "Honorary" tag is not an honor society');
expect(kind('The Classics Club', ['Education, Pedagogy & Instruction', 'Honorary']) !== 'honor', 'the Classics Club is not an honor society either');
expect(kind('Tau Beta Pi Engineering Honor Society', ['Honorary', 'Technology, Engineering & Mathematics']) === 'honor', '"... Honor Society" is an honor society');
expect(kind('Sigma Chi Fraternity', ['Social Fraternities & Sororities']) === 'greek-social', 'a social fraternity is greek-social');
expect(kind('Alpha Omega Epsilon Engineering Sorority', ['Social Fraternities & Sororities', 'Technology, Engineering & Mathematics']) === 'professional-fraternity', 'an engineering sorority is professional');
expect(kind('OPERA- Organization for Prototyping, Experimentation, Realization, and Applications', ['Community Service & Philanthropy', 'Technology, Engineering & Mathematics']) !== 'arts-performance', 'an engineering club named OPERA is not an opera company');
expect(kind('Kick Brass - Brass Band', ['Performance Arts']) === 'arts-performance', 'a brass band is arts');
expect(kind('Xtension Chords A Cappella', ['Performance Arts', 'Social & Leisure']) === 'arts-performance', 'an a cappella group is arts');
expect(kind('Illinois Trial Team', ['Law']) === 'competition-team', 'the trial team is a competition team');
expect(kind('Illinois Club Golf Team', ['Athletic & Recreation', 'Club Sports']) === 'sport-recreation', 'a club sports "team" is sport, not a competition team');
expect(kind('Korean Student Association', ['Identity & Culture', 'Social & Leisure']) === 'cultural', 'a national-heritage student association is cultural');
expect(kind('UNICEF at UIUC', ['Advocacy & Activism', 'Community Service & Philanthropy', 'International']) === 'service', 'a service club that ticked International stays a service club');
expect(kind('Sociology Student Organization (SSO)', ['Social & Leisure']) === 'academic', 'a club named for a department is academic, whatever it ticked');
expect(kind('Chinese Engineering Students Association (CESA)', ['Identity & Culture', 'International', 'Social & Leisure'], { onList: true }) === 'academic', 'a group on a university office\'s list is not only cultural');
expect(kind('Illinois Consulting Group', ['Business', 'Social & Leisure']) === 'consulting-investing', 'a consulting club');
expect(kind('Society for Equity in Astronomy', ['Advocacy & Activism', 'Life & Physical Sciences']) !== 'consulting-investing', '"Equity" in astronomy is not equity research');
expect(kind('Catholic Illini Association', ['Faith, Religion & Spirituality', 'Community Service & Philanthropy']) === 'faith', 'a campus ministry is faith');
expect(kind('Any', ['Honorary'], { national: { kind: 'professional-society' } }) === 'professional-society', 'a national row\'s kind wins over the categories');

// ---------------------------------------------------------------------------
console.log('\nGoals, subjects and the tables');

const lists = [
  { id: 'prelaw', title: 'Pre-law list', short: 'a pre-law list', url: 'https://example.edu/p', read: '2026-10-04', goal: 'pre-law', count: 2, entries: ['Trial Team (TT)', 'Gone Club'] },
  { id: 'eng', title: 'Engineering list', short: 'an engineering list', url: 'https://example.edu/e', read: '2026-10-04', college: 'engineering', count: 1, entries: ['Robots'] },
];
const aliases = { prelaw: { 'Trial Team (TT)': { id: '1', name: 'Illinois Trial Team' }, 'Gone Club': { id: null, note: 'not in the directory' } }, eng: { Robots: { id: '2', name: 'Illini VEX Robotics' } } };
const nationals = [{ national: 'AED', match: 'alpha epsilon delta', goals: ['@health', 'nursing'], checked: { id: '3' } }, { national: 'ASME', match: 'american society of mechanical engineers', subjects: ['ME'], college: 'engineering', checked: { id: '4' } }];
const overrides = { 6: { name: 'Pre-Anesthesiologist Assistant Association', goalsRemove: ['pre-medicine'], note: 'not medical school' }, 7: { name: 'National Lawyers Guild', audience: 'law', note: 'College of Law' }, 8: { name: 'Exploratory Students Association', starter: true, note: 'a starter' } };
const tables = { lists, aliases, nationals, overrides };
expect(!throws(() => T.validateTables(tables), /./), 'well-formed tables pass the guard');
const SENTINEL = 'xylophone quartz meridian tangerine';
const directory = {
  vocabulary: { topical: ['Law'] },
  groups: [
    group('Illinois Trial Team', ['Law'], { id: '1' }),
    group('Illini VEX Robotics', ['Technology, Engineering & Mathematics'], { id: '2', affiliations: ['Grainger College of Engineering'] }),
    group('Alpha Epsilon Delta Pre-Health Society', ['Health & Wellness'], { id: '3' }),
    group('American Society of Mechanical Engineers', ['Technology, Engineering & Mathematics'], { id: '4' }),
    group('Japanese Animation Club', ['Identity & Culture', 'Social & Leisure'], { id: '5' }),
    group('Pre-Anesthesiologist Assistant Association', ['Health & Human Sciences'], { id: '6' }),
    group('National Lawyers Guild', ['Law'], { id: '7' }),
    group('Exploratory Students Association', ['Social & Leisure'], { id: '8' }),
    group('Grainger Computer Science', [], { id: '9', office: true, type: 'Grainger Departments & Programs' }),
    group('Female Future Health Professionals', ['Health & Wellness'], { id: '10' }),
    group('Pre-Health Psychology Association', ['Health & Human Sciences'], { id: '11' }),
    group('Pre-Vet Club', ['Veterinary'], { id: '12' }),
  ],
};
const { tagged, report } = T.tagAll({ directory, tables, texts: new Map([['1', `Our trial team ${SENTINEL} competes.`]]) });
const byId = new Map(tagged.map((c) => [c.id, c]));
expect(byId.get('1').goals.some((g) => g.id === 'pre-law' && g.from === 'list' && g.list === 0), 'a name on the pre-law list gets the pre-law goal, from the list', JSON.stringify(byId.get('1').goals));
expect(byId.get('2').colleges.includes('engineering') && byId.get('2').lists.includes(1), 'a name on a college list gets the college and the list index');
expect(byId.get('2').goals.some((g) => g.id === 'robotics' && g.from === 'name'), 'a club named for robotics gets robotics, from its name');
const health = T.HEALTH_TRACKS;
expect(health.length === 7 && !health.includes('pre-law') && !health.includes('pre-veterinary') && health.includes('pre-medicine'), 'the health tracks a general pre-health club is for: every track but pre-law and pre-veterinary (7)', health.join(','));
expect(health.every((h) => goalIds(byId.get('3')).includes(h)) && goalIds(byId.get('3')).includes('nursing') && byId.get('3').national === 'AED', 'AED carries every health track and nursing, as a national chapter');
expect(health.every((h) => goalIds(byId.get('10')).includes(h)), '"Health Professionals" in a name reads as every health track');
expect(['3', '10', '11'].every((id) => !goalIds(byId.get(id)).includes('pre-veterinary')), 'a general pre-health club (AED, "Health Professionals", "Pre-Health ...") is not tagged pre-veterinary', ['3', '10', '11'].map((id) => goalIds(byId.get(id)).join(',')).join(' | '));
expect(goalIds(byId.get('12')).includes('pre-veterinary'), 'the Pre-Vet Club still is');
expect(byId.get('4').subjects.includes('ME') && byId.get('4').kind === 'professional-society', 'ASME carries ME and is a professional society');
expect(byId.get('5').kind === 'cultural' && byId.get('5').goals.length === 0 && byId.get('5').goalsHeldBack?.includes('film-media'), 'an asked-only kind carries no goals (the anime club\'s film-media is held back)');
expect(!goalIds(byId.get('6')).includes('pre-medicine'), 'an override removes a wrong name goal');
expect(byId.get('7').dropped === 'law' && byId.get('7').audienceFrom === 'override', 'an override drops a College of Law group the name rules miss');
expect(byId.get('8').starter === true, 'an override marks a starter');
// After the 2026-10-05 spot check.
expect(!T.nameGoals('Illinois Political Consulting').includes('consulting') && T.nameGoals('Illinois Political Consulting').includes('politics') && T.nameGoals('Illinois Consulting Group').includes('consulting'), '"Political Consulting" in a name is politics, not management consulting; "Consulting Group" is consulting', T.nameGoals('Illinois Political Consulting').join(','));
expect(throws(() => T.validateTables({ ...tables, overrides: { 8: { name: 'x', starter: 'sometimes', note: 'n' } } }), /starter is true, false or 'undeclared'/), "the guard stops a starter that is neither true, false nor 'undeclared'");
{
  const { tagged: t2 } = T.tagAll({ directory, tables: { ...tables, overrides: { ...overrides, 8: { name: 'Exploratory Students Association', starter: 'undeclared', note: 'for undeclared students' } } } });
  expect(t2.find((c) => c.id === '8').starter === 'undeclared', "an override's starter 'undeclared' is tagged as such");
}
expect(byId.get('9').dropped === 'office' && byId.get('9').goals.length === 0, 'an office account is dropped as an office');
expect(tagged.every((c) => new Set(goalIds(c)).size === c.goals.length), 'one entry per goal id');
expect(!JSON.stringify(tagged).includes(SENTINEL), 'the mission text never reaches the output');
expect(report.lists[0].unmatched.includes('Gone Club') && report.lists[0].matched === 1, 'a list name with no id is reported, not guessed');

expect(throws(() => T.validateTables({ ...tables, nationals: [{ national: 'X', match: 'x', goals: ['research'] }] }), /"research" is not a current/), 'the goal-id guard stops a goal the planner does not have ("research")');
expect(throws(() => T.validateTables({ ...tables, lists: [{ ...lists[0], goal: 'prelaw' }, lists[1]] }), /"prelaw" is not a current/), 'the guard stops a misspelled list goal');
expect(throws(() => T.validateTables({ ...tables, overrides: { 1: { name: 'x', goalsAdd: ['performing-arts'], note: 'n' } } }), /"performing-arts" is not a current/), 'the guard stops an override goal the planner does not have');
expect(throws(() => T.validateTables(tables, { subjects: new Set(['CS']) }), /subject "ME" is not a course prefix/), 'the guard stops a subject that is not a course prefix');
expect(throws(() => T.validateTables({ ...tables, aliases: { ...aliases, prelaw: { 'Trial Team (TT)': aliases.prelaw['Trial Team (TT)'] } } }), /no row for "Gone Club"/), 'every list name needs an alias row');
expect(throws(() => T.validateTables({ ...tables, aliases: { ...aliases, prelaw: { ...aliases.prelaw, 'Gone Club': { id: null } } } }), /null without a note/), 'a null alias needs a note');
expect(throws(() => T.validateTables({ ...tables, overrides: { 1: { name: 'x', audience: 'grad' } } }), /says why/), 'an override needs a note');
const stray = { ...tables, overrides: { 1: { name: 'x', goalsAdd: ['not-a-goal'], note: 'n' } } };
expect(throws(() => T.tagAll({ directory, tables: stray }), /outside the planner's goal ids/), 'the output guard stops a stray goal even past the table guard');
expect(Object.keys(T.GOAL_CATEGORIES).length === T.GOAL_IDS.size && [...T.GOAL_IDS].every((id) => id in T.GOAL_CATEGORIES), `GOAL_CATEGORIES covers exactly the ${T.GOAL_IDS.size} goal ids`);
// After the round-2 spot check: an override can keep a subject several majors share to some of them (HK is
// Kinesiology and Community Health), and can give our own one-line description.
{
  const scoped = { ...tables, overrides: { ...overrides, 2: { name: 'Illini VEX Robotics', subjectsAdd: ['ME'], majors: ['Mechanical Engineering'], note: 'n' } } };
  expect(!throws(() => T.validateTables(scoped, { majors: new Set(['Mechanical Engineering']) }), /./), 'an override may set majors beside a subject');
  const vex = T.tagAll({ directory, tables: scoped }).tagged.find((c) => c.id === '2');
  expect(vex.majors?.join() === 'Mechanical Engineering' && vex.subjects.includes('ME'), 'majors and the subject reach the tagged row', JSON.stringify({ majors: vex.majors, subjects: vex.subjects }));
  expect(!('majors' in byId.get('1')), 'a row with no majors carries none');
  expect(throws(() => T.validateTables({ ...tables, overrides: { 2: { name: 'x', majors: ['Mechanical Engineering'], note: 'n' } } }), /needs subjectsAdd/), 'majors with no subject is refused: it only scopes a subject');
  expect(throws(() => T.validateTables(scoped, { majors: new Set(['Civil Engineering']) }), /is not a program name/), 'a major that is not a program name is refused');
  expect(throws(() => T.validateTables({ ...tables, overrides: { 2: { name: 'x', does: ' ', note: 'n' } } }), /does is our own/), 'an empty does line is refused');
}

// ---------------------------------------------------------------------------
const DATA = join(ROOT, 'data', 'clubs');
if (!existsSync(join(DATA, 'directory.json'))) {
  console.log('\n(no data/clubs/directory.json: run scripts/illinois/clubs/crawl.mjs to check the real tables)');
} else {
  console.log('\nThe real tables on data/clubs/directory.json');
  const dir = JSON.parse(readFileSync(join(DATA, 'directory.json'), 'utf8'));
  const index = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'index.json'), 'utf8'));
  const programs = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'programs.json'), 'utf8'));
  const { majorNameOf } = await import(pathToFileURL(join(ROOT, 'lib', 'planner', 'clubs.ts')).href);
  const vocab = { subjects: new Set(index.map((r) => String(r.code).split(' ')[0])), colleges: new Set(programs.map((p) => p.college)), majors: new Set(programs.map((p) => majorNameOf(p.name)).filter(Boolean)) };
  let real;
  try { real = T.loadTables(T.TABLES, vocab); ok('lists, aliases, nationals and overrides pass the guards against today\'s goal ids, prefixes, colleges and major names'); } catch (e) { fail(e.message); }
  if (real) {
    const texts = new Map();
    if (existsSync(join(DATA, 'texts.jsonl'))) for (const l of readFileSync(join(DATA, 'texts.jsonl'), 'utf8').split('\n')) if (l.trim()) { const t = JSON.parse(l); texts.set(t.id, [t.mission, t.benefits].filter(Boolean).join(' ')); }
    const { tagged: rt, report: rr, warnings } = T.tagAll({ directory: dir, texts, tables: real, subjects: vocab.subjects });
    const R = new Map(rt.map((c) => [c.id, c]));
    expect(warnings.length === 0, 'no warnings: every alias id and national row still matches, no override is stale', warnings.slice(0, 4).join(' | '));
    expect(rr.nationals.matched === real.nationals.length && rr.nationals.moved.length === 0, `every national row matches exactly the group it was checked against (${rr.nationals.matched} of ${real.nationals.length})`);
    const listCount = (id) => rr.lists.find((l) => l.id === id);
    for (const l of rr.lists) expect(l.matched > 0, `${l.id}: ${l.matched} of ${l.entries} names matched; unmatched ${l.unmatched.length}`);
    const a = JSON.parse(readFileSync(T.TABLES.aliases, 'utf8')).lists['engineering-council'];
    expect(a['Society of Physics Students (SPS)'].id !== '36902' && a['Women in Data Science (WiDS)'].id !== '35898' && a['Illinois Water Resources Association (IWRA)'].id === null, 'the three wrong automatic joins are not used (SPS to Grainger Physics, WiDS to the Data Science Club, IWRA nulled)');
    expect(listCount('prelaw-2025-26').entries === 16, 'the pre-law list has 16 names, re-counted from the page');

    // the persona traps no student may ever be shown (DESIGN 5.1 B), by id
    const NEVER = { 37115: 'Carle Illinois College of Medicine', 37113: 'Christian Medical and Dental Association', 35578: 'Black Law Students Association', 36134: 'Phi Alpha Delta Law Fraternity, Magruder Chapter', 35646: 'Criminal Law Society', 35559: 'Bankruptcy Law Society', 36900: 'Grainger Computer Science', 35696: 'Education Law and Policy Society', 35671: 'CHBE Graduate Student Advisory Council', 36256: 'Statistics Doctoral Student Association', 36906: 'Grainger Mechanical Science & Engineering', 35926: 'Illinois Student AVMA', 35506: 'American Association of Zoo Veterinarians', 35702: 'Energy and Environmental Law Society' };
    const kept = Object.entries(NEVER).filter(([id]) => R.get(id) && !R.get(id).dropped).map(([, n]) => n);
    const missing = Object.keys(NEVER).filter((id) => !R.get(id));
    expect(kept.length === 0, `the ${Object.keys(NEVER).length} never-shown persona traps are all dropped`, kept.join('; '));
    if (missing.length) console.log(`  note  ${missing.length} trap ids are not in this directory (re-registered or gone): ${missing.join(', ')}`);
    const asked = rt.filter((c) => !c.dropped && T.ASKED_ONLY_KINDS.has(c.kind) && c.goals.length);
    expect(asked.length === 0, 'no social, Greek, faith, cultural or sport club carries a career goal', asked.map((c) => c.name).slice(0, 4).join('; '));
    const stale = rt.flatMap((c) => c.goals).filter((g) => !T.GOAL_IDS.has(g.id));
    expect(stale.length === 0, 'every goal tag is a current goal id');
    const has = (id, test, msg) => { const c = R.get(id); expect(Boolean(c) && !c.dropped && test(c), msg, c ? `${c.kind} ${goalIds(c).join(',')} [${c.subjects.join(',')}]` : 'missing'); };
    has('35525', (c) => c.subjects.includes('ME') && c.national === 'ASME', 'ASME carries ME (the major signal for "design robots")');
    has('35545', (c) => c.subjects.includes('CS') && goalIds(c).includes('software-engineering') && c.lists.length === 2, 'ACM carries CS and software engineering, and is on the Engineering Council and Siebel lists');
    has('36178', (c) => goalIds(c).includes('pre-veterinary') && c.kind === 'pre-professional', 'the Pre-Vet Club is pre-veterinary and pre-professional');
    has('36133', (c) => c.goals.some((g) => g.id === 'pre-law' && g.from === 'list'), 'the undergraduate PAD chapter is pre-law from Pre-Law Advising\'s list');
    has('35504', (c) => c.kind === 'professional-society' && goalIds(c).includes('marketing') && c.subjects.includes('ADV'), 'the American Advertising Federation is a professional society for marketing and ADV, not an honor society');
    has('36271', (c) => c.kind !== 'honor', 'the Student Media Marketing Association is not an honor society');
    has('35483', (c) => T.HEALTH_TRACKS.every((h) => goalIds(c).includes(h)) && goalIds(c).includes('nursing') && !goalIds(c).includes('pre-veterinary'), 'AED carries every health track and nursing, but not pre-veterinary');
    const preHealthVet = rt.filter((c) => !c.dropped && /pre[-\s]?health|health\s+professions?|alpha epsilon delta/i.test(c.name) && goalIds(c).includes('pre-veterinary'));
    expect(preHealthVet.length === 0, 'no general pre-health club carries pre-veterinary', preHealthVet.map((c) => c.name).join('; '));
    const vet = rt.filter((c) => !c.dropped && !c.identity && c.audience !== 'check' && !T.ASKED_ONLY_KINDS.has(c.kind) && goalIds(c).includes('pre-veterinary')).map((c) => c.name).sort();
    expect(vet.length >= 3, `pre-veterinary keeps 3 or more joinable clubs of its own (${vet.join('; ')})`);
    expect(R.get('35452')?.dropped === 'office' && !R.get('35452')?.starter, 'the Illinois Leadership Center is an office account, dropped, and not a starter');
    const starters = rt.filter((c) => c.starter && !c.dropped).map((c) => c.name).sort();
    expect(starters.length === 3, `three starter clubs (${starters.join('; ')})`);
    // After the 2026-10-05 spot check: (b) the starter for undeclared students, (c) political consulting, (e) venture capital.
    has('36885', (c) => c.starter === 'undeclared', "the Exploratory Students Association is a starter for undeclared students only");
    has('37024', (c) => goalIds(c).includes('politics') && !goalIds(c).includes('consulting'), 'Illinois Political Consulting is politics, not consulting');
    has('36360', (c) => !goalIds(c).includes('investment-banking') && goalIds(c).includes('entrepreneurship'), 'the Venture Capital Association is not investment banking; it keeps entrepreneurship');

    // privacy: facts and our own words only
    const out = JSON.stringify(rt);
    expect(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(out) && !/uid=|send_message|\/upload\//i.test(out), 'no email address, uid=, message link or upload path in the tags');
    const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
    // Names and links are the directory's facts, and a long one ("... at the University of Illinois at
    // Urbana-Champaign") turns up in many missions; every other string in the tags must be ours.
    const FACTS = new Set(['name', 'url', 'profile', 'website']);
    const shingles = new Set();
    const walk = (v) => { if (typeof v === 'string') { const w = words(v); for (let i = 0; i + 8 <= w.length; i += 1) shingles.add(w.slice(i, i + 8).join(' ')); } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!FACTS.has(k)) walk(x); };
    walk(rt);
    let copied = 0;
    for (const text of texts.values()) {
      const w = words(text);
      for (let i = 0; i + 8 <= w.length; i += 1) if (shingles.has(w.slice(i, i + 8).join(' '))) { copied += 1; break; }
    }
    expect(copied === 0, `no run of 8 words from any club's own text appears in the tags outside names and links (${texts.size} texts checked)`);
  }
}

console.log(failures ? `\n*** ${failures} check(s) failed ***` : '\nall club tag checks passed');
if (failures) process.exitCode = 1;
